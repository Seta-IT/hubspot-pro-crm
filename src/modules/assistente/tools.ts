// ============================================================================
// STI-hub — Assistente de IA (etapa 1): ferramentas.
//
// Cada ferramenta so chama as MESMAS rotas /api que a tela usa, com a sessao do usuario
// logado (ApiCaller). Nao ha contexto interno confiavel nem atalho no repositorio: o RBAC,
// a carteira, os modulos e as travas do roteador valem igual a um clique na interface.
// O modelo nunca recebe os dados devolvidos; recebe so um resumo minimo (resumoParaModelo):
// contagens e, para empresas, nome e CNPJ (dado cadastral publico) para escolher o cliente.
//
// Catalogo extensivel: cada acao declara a rota da tela que usa, os modulos exigidos
// (mesmo RBAC), quando aparece para o usuario (disponivel) e, se precisar, um passo de
// preparo so-leitura (preparar) que roda ANTES do cartao de confirmacao. Para uma acao
// nova: escreva o AssistenteTool e inclua em ASSISTENTE_TOOLS; a confirmacao, a
// auditoria e os limites vem do service sem codigo extra.
// Fora da etapa 1: nota fiscal, recibo e mensagens a clientes.
// ============================================================================
import { z } from 'zod';
import type { LlmToolDefinition } from './omniroute-client';
import { nextServiceOrderCode } from '../erp/service-order-workflow';
import { extractGcProposalNumber, formatProposalDisplayCode } from '../../app/lib/proposal-number';
import { buildProposalInstallments, computeProposalTotals, isAvulsoServiceProposal, proposalSetupFeeLabel, resolveEffectiveProposalBudgetType, resolveProposalAmountDisplay } from '../../app/lib/proposal-share';
import type { ErpCommercialProposal } from '../../db/types';
import { isProposalValidityExpired, formatProposalValidUntilPtBr } from '../../app/lib/proposal-validity';
import {
  FORMA_PAGAMENTO_ERP, INDICES_REAJUSTE, MENSAGEM_SEM_CARTAO, PERGUNTA_SERVICO_MODO, PERGUNTA_TIPO_PROPOSTA, ROTULO_FORMA_PAGAMENTO, ROTULO_INDICE,
  ROTULO_TIPO_PROPOSTA, TIPOS_PROPOSTA, normalizarFormaPagamento, normalizarIndice, normalizarTipoProposta, perguntaCamposDoTipo,
  type FormaPagamento, type IndiceReajuste, type TipoProposta,
} from './proposta-tipo';
import { extrairIdentificadores, foldTexto, formatarCnpj, soDigitos, type Identificador } from './identificadores';

export type ApiCallRequest = { method: 'GET' | 'POST' | 'PATCH'; path: string; body?: Record<string, unknown> };
export type ApiCallResponse = { status: number; body: any };
/** Chamada a uma rota /api COMO o usuario logado (mesma sessao, mesmo RBAC). */
export type ApiCaller = (req: ApiCallRequest) => Promise<ApiCallResponse>;

export type ModuleKey = 'crm' | 'erp' | 'chamados';

export interface AssistenteUser {
  uid: string;
  email: string;
  name: string;
  roleId: string;
  moduleAccess: { crm: boolean; erp: boolean; chamados: boolean };
}

export interface ToolTable {
  colunas: string[];
  linhas: string[][];
}

export type ToolResult =
  | {
      ok: true;
      mensagem: string;
      tabela?: ToolTable;
      totais?: Array<{ rotulo: string; valor: string }>;
      registro?: { tipo: string; id: string; codigo?: string };
      /** Ficha completa do registro encontrado (mostrada ao usuario; nao vai ao modelo). */
      detalhes?: DetalheRegistro[];
      /** Botoes do registro: abrir, link do cliente, Versao contrato, PDF (sem token: o link e gerado no clique). */
      acoes?: AcaoRegistro[];
      /** Unico texto que volta ao modelo depois da execucao (sem dados de clientes). */
      resumoParaModelo: string;
    }
  | { ok: false; status: number; mensagem: string; resumoParaModelo: string };

export interface DetalheRegistro {
  rotulo: string;
  valor: string;
}

/** Alvo dentro da tela (mesmo mecanismo da busca global do cabecalho). */
export interface AlvoRegistro {
  type: 'PROPOSAL' | 'CONTRACT' | 'INVOICE' | 'SERVICE_ORDER' | 'CUSTOMER' | 'TICKET';
  id: string;
  query?: string;
}

/**
 * Acoes do registro no chat. Nenhuma carrega token: o link do cliente (assinado) e pedido ao
 * servidor no clique, com a sessao/MFA e o RBAC do usuario (mesma rota do botao da lista).
 */
export type AcaoRegistro =
  | { tipo: 'abrir'; rotulo: string; alvo: AlvoRegistro; href: string }
  | { tipo: 'link_cliente_proposta'; rotulo: string; propostaId: string }
  | { tipo: 'link_cliente_fatura'; rotulo: string; faturaId: string }
  | { tipo: 'versao_contrato'; rotulo: string; href: string }
  | { tipo: 'pdf_proposta'; rotulo: string; propostaId: string }
  | { tipo: 'link_pdf'; rotulo: string; href: string }
  | { tipo: 'aviso'; rotulo: string };

export interface ToolSummary {
  titulo: string;
  linhas: string[];
}

export interface AssistenteTool<A = any> {
  name: string;
  descricao: string;
  tipo: 'leitura' | 'gravacao';
  parameters: Record<string, unknown>;
  schema: z.ZodType<A>;
  /** Modulos exigidos (todos). Pre-checagem; a decisao final e do middleware/roteador. */
  modulos(args: A): ModuleKey[];
  resumo(args: A): ToolSummary;
  executar(args: A, api: ApiCaller): Promise<ToolResult>;
  /** Rotas da tela que a acao usa (documentacao do catalogo). */
  rotas: string[];
  /** Se a acao aparece para este usuario. Padrao: algum modulo exigido pelo tipo de acao. */
  disponivel(user: AssistenteUser): boolean;
  /**
   * Preparo so-leitura antes do cartao (ex.: identificar a empresa). Pode completar os
   * argumentos ou devolver uma pergunta ao usuario (ex.: "qual das 2 empresas?").
   */
  preparar?(args: A, api: ApiCaller): Promise<{ ok: true; args: A } | { ok: false; texto: string }>;
  /** Normaliza argumentos do modelo antes do zod (ex.: "2.800,00" => 2800). */
  coagir?(args: any): any;
  /** Antes do zod: pergunta ao usuario o que falta (ex.: o tipo da proposta), ou null. */
  faltando?(args: any): string | null;
}

// ---------------------------------------------------------------------------
// Utilitarios
// ---------------------------------------------------------------------------
export function fold(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\s]+/g, ' ')
    .trim()
    .toLowerCase();
}

/** So letras e numeros, sem acento, minusculo: "A3CLOUD.IT Ltda" => "a3clouditltda". */
export function compact(v: unknown): string {
  return fold(v).replace(/[^a-z0-9]+/g, '');
}

const STOPWORDS = new Set(['ltda', 'sa', 'me', 'epp', 'eireli', 'mei', 'cia', 'de', 'da', 'do', 'das', 'dos', 'e', 'empresa', 'cliente']);

/**
 * Busca tolerante: ignora espacos, pontuacao, acentos e maiusculas. Combina se o texto
 * compacto contem a busca compacta, ou se contem todas as palavras da busca.
 * "A3C cloud" combina com "A3CLOUD.IT LTDA" e com "A3 CLOUD TECNOLOGIA".
 */
export function buscaCombina(busca: string, textos: unknown[]): boolean {
  const q = compact(busca);
  if (!q) return true;
  const alvo = textos.map(compact).join(' ');
  if (alvo.includes(q)) return true;
  const toks = fold(busca)
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOPWORDS.has(t));
  const fortes = toks.filter((t) => t.length >= 2);
  if (!fortes.length) return false;
  return fortes.every((t) => alvo.includes(t));
}

const CNPJ_RE = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/;

/** 'YYYY-MM-DD...' ou 'DD/MM/YYYY' => 'YYYY-MM-DD' (ou '' se nao reconhecer). */
export function toIsoDate(v: unknown): string {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return '';
}

export function formatBRL(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDateBr(v: unknown): string {
  const iso = toIsoDate(v);
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function todayBr(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(now.getDate())}/${p(now.getMonth() + 1)}/${now.getFullYear()}`;
}

const cut = (v: unknown, n = 80) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s || '-';
};

const statusLabel = (v: unknown) => cut(String(v ?? '').replace(/_/g, ' '), 40);

function apiError(res: ApiCallResponse, acao: string): ToolResult {
  const raw = res.body && typeof res.body === 'object' ? String(res.body.error || res.body.title || '') : '';
  const mensagem =
    res.status === 401
      ? 'Sua sessão expirou. Entre de novo no STI-hub.'
      : res.status === 403
        ? `Permissão negada: seu usuário não pode ${acao}.${raw ? ` (${cut(raw, 160)})` : ''}`
        : raw
          ? cut(raw, 200)
          : `Não foi possível ${acao} (código ${res.status}).`;
  return { ok: false, status: res.status, mensagem, resumoParaModelo: `Falhou: não foi possível ${acao} (HTTP ${res.status}).` };
}

/**
 * Numero em formato brasileiro ou simples: "2.800,00", "2800,00", "R$ 2.800", "2800.5", 2800.
 * Devolve o valor original quando nao reconhece (o zod recusa).
 */
export function parseNumeroBR(v: unknown): unknown {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return v;
  let t = v.trim().replace(/^R\$\s*/i, '').replace(/\s+/g, '');
  if (!t) return v;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) || /^-?\d+,\d+$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : v;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD');
const shortText = (max: number) => z.string().trim().min(1).max(max);

// ---------------------------------------------------------------------------
// Entidades consultaveis
// ---------------------------------------------------------------------------
export const ENTIDADES = [
  'contratos', 'vendas', 'ordens_servico', 'empresas', 'contatos', 'faturas', 'negocios',
  'notas_fiscais', 'contas_receber', 'contas_pagar', 'produtos', 'estoque', 'chamados', 'fornecedores',
] as const;
export type Entidade = (typeof ENTIDADES)[number];

interface EntidadeDef {
  rotulo: string;
  modulos: ModuleKey[];
  path: string;
  pick(body: any): any[];
  data(r: any): unknown;
  valor?(r: any): number;
  status?(r: any): unknown;
  texto(r: any): unknown[];
  /** Identificacao minima de um registro para o modelo (so onde ajuda a escolher). */
  paraModelo?(r: any): string;
  colunas: string[];
  linha(r: any): string[];
  /** Valores financeiros: so com alcada financeira (financeVisible do painel), igual a tela. */
  financeiro?: boolean;
}

/** Hoje (AAAA-MM-DD) no fuso de Brasilia, para "vencido". */
function hojeBr(now = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
  const g = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

/** Situacao da fatura/nota com o vencimento aplicado: EMITIDA vencida => VENCIDA. */
function statusFatura(r: any): string {
  const st = String(r?.status || '');
  const due = toIsoDate(r?.dueDate);
  if (st === 'EMITIDA' && due && due < hojeBr()) return 'VENCIDA';
  return st;
}

/** Situacao do lancamento financeiro: ABERTO vencido => ATRASADO. */
function statusLancamento(r: any): string {
  const st = String(r?.status || '');
  const due = toIsoDate(r?.dueDate);
  if (st === 'ABERTO' && due && due < hojeBr()) return 'ATRASADO';
  return st;
}

const TICKET_STATUS_ROTULO: Record<string, string> = { OPEN: 'Aberto', IN_PROGRESS: 'Em andamento', WAITING_CUSTOMER: 'Aguardando cliente', RESOLVED: 'Resolvido', CLOSED: 'Fechado' };
const TICKET_PRIORIDADE_ROTULO: Record<string, string> = { CRITICAL: 'Crítica', HIGH: 'Alta', MEDIUM: 'Média', LOW: 'Baixa' };
export const statusChamado = (v: unknown) => TICKET_STATUS_ROTULO[String(v || '')] || statusLabel(v);

const DOC_FISCAL_ROTULO: Record<string, string> = {
  FATURA_LOCACAO: 'Fatura de locação', NFSE_SERVICO: 'NFS-e', NFE_REMESSA_LOCACAO: 'NF-e remessa', NFE_VENDA_PRODUTO: 'NF-e venda',
  NFCE_CONSUMIDOR: 'NFC-e', NFCOM_TELECOM: 'NFCom', NFE_IMPORTACAO: 'NF-e importação', NFE_RETORNO_LOCACAO: 'NF-e retorno', ENTRADA_REGISTRADA: 'Entrada',
};
export const tipoDocumentoFiscal = (v: unknown) => DOC_FISCAL_ROTULO[String(v || '')] || statusLabel(v);
const ehNotaFiscal = (r: any) => String(r?.documentType || '') !== 'FATURA_LOCACAO';

function statusEstoque(r: any): string {
  if (r?.isActive === false) return 'Inativo';
  const disp = Number(r?.stockAvailable || 0);
  if (r?.movesStock === false && !disp) return 'Não controla estoque';
  if (disp <= 0) return 'Sem estoque';
  if (Number(r?.minStock) > 0 && disp < Number(r.minStock)) return 'Abaixo do mínimo';
  return 'Disponível';
}

/**
 * Filtro de situacao tolerante: "vencido" pega VENCIDA/ATRASADO; "aberto" pega o que nao
 * foi pago, concluido, cancelado ou encerrado; o resto compara sem acento pelo inicio.
 */
export function statusCombina(filtro: string, valor: unknown): boolean {
  const f = fold(filtro).replace(/_/g, ' ');
  const v = fold(valor).replace(/_/g, ' ');
  if (!f) return true;
  if (/^(vencid|atrasad|em atraso|inadimpl)/.test(f)) return /venc|atras|overdue|breach/.test(v);
  if (/^(aberto|aberta|em aberto|pendente|nao pag)/.test(f)) return !/pag|paid|cancel|encerr|conclu|resolv|fech|closed|recusad|convertid|inativ/.test(v);
  if (/^(pago|paga|quitad|recebid|liquidad)/.test(f)) return /^pag|paid|quitad|liquid/.test(v);
  if (/^cancel/.test(f)) return /cancel/.test(v);
  if (/^(conclu|finaliz)/.test(f)) return /conclu|finaliz|encerr/.test(v);
  if (/^(resolvid|fechad)/.test(f)) return /resolv|fech|closed/.test(v);
  if (/^ativ/.test(f)) return /^ativ|^dispon/.test(v);
  if (/^inativ/.test(f)) return /inativ/.test(v);
  if (/^sem estoque|^zerad|^esgotad/.test(f)) return /sem estoque/.test(v);
  if (/^abaixo/.test(f)) return /abaixo|sem estoque/.test(v);
  return v === f || v.startsWith(f);
}

const ENTIDADE_DEFS: Record<Entidade, EntidadeDef> = {
  contratos: {
    rotulo: 'contratos',
    modulos: ['erp'],
    path: '/api/erp/contracts',
    pick: (b) => b?.data,
    data: (r) => r.startDate,
    valor: (r) => Number(r.monthlyValue) || 0,
    status: (r) => r.status,
    texto: (r) => [r.contractNumber, r.gestaoClickCode, r.externalContractNumber, r.proposalNumber, r.title, r.companyName, r.companyCnpj, soDigitos(r.companyCnpj)],
    colunas: ['Número', 'Cliente', 'Situação', 'Mensal', 'Início', 'Fim', 'Reajuste'],
    linha: (r) => [
      cut(r.contractNumber || r.gestaoClickCode, 24), cut(r.companyName, 50), statusLabel(r.status), formatBRL(r.monthlyValue), formatDateBr(r.startDate), formatDateBr(r.endDate),
      cut(`${r.readjustmentIndex || '-'}${r.lastReadjustmentDate ? ` (último ${formatDateBr(r.lastReadjustmentDate)})` : ''}`, 40),
    ],
  },
  vendas: {
    rotulo: 'vendas',
    modulos: ['erp'],
    path: '/api/erp/overview',
    pick: (b) => b?.data?.salesOrders,
    data: (r) => r.date,
    valor: (r) => Number(r.totalAmount) || 0,
    status: (r) => r.status,
    texto: (r) => [r.code, r.companyName, r.sellerName, r.itemsSummary],
    colunas: ['Código', 'Cliente', 'Vendedor', 'Situação', 'Total', 'Data'],
    linha: (r) => [cut(r.code, 20), cut(r.companyName, 50), cut(r.sellerName, 30), statusLabel(r.status), formatBRL(r.totalAmount), formatDateBr(r.date)],
  },
  ordens_servico: {
    rotulo: 'ordens de serviço',
    modulos: ['erp'],
    path: '/api/erp/overview',
    pick: (b) => b?.data?.serviceOrders,
    data: (r) => r.entryDate,
    valor: (r) => Number(r.totalAmount) || 0,
    status: (r) => r.status,
    texto: (r) => [r.code, r.companyName, r.technicianName, r.description, r.equipmentName],
    colunas: ['OS', 'Cliente', 'Técnico', 'Situação', 'Total', 'Entrada'],
    linha: (r) => [cut(r.code, 20), cut(r.companyName, 50), cut(r.technicianName, 30), statusLabel(r.status), formatBRL(r.totalAmount), formatDateBr(r.entryDate)],
  },
  empresas: {
    rotulo: 'empresas',
    modulos: [],
    path: '/api/companies',
    pick: (b) => b?.data,
    data: (r) => r.createdAt,
    texto: (r) => [r.name, r.cnpj, r.domain, r.city],
    paraModelo: (r) => `${cut(r.name, 70)}${r.cnpj ? ` (CNPJ ${cut(r.cnpj, 20)})` : ''}`,
    colunas: ['Empresa', 'CNPJ', 'Cidade', 'UF'],
    linha: (r) => [cut(r.name, 60), cut(r.cnpj, 20), cut(r.city, 30), cut(r.state, 4)],
  },
  contatos: {
    rotulo: 'contatos',
    modulos: ['crm'],
    path: '/api/contacts',
    pick: (b) => b?.data,
    data: (r) => r.createdAt,
    texto: (r) => [r.firstName, r.lastName, r.email, r.jobTitle, r.companyName, r.company?.name],
    colunas: ['Nome', 'E-mail', 'Cargo', 'Empresa'],
    linha: (r) => [cut(`${r.firstName || ''} ${r.lastName || ''}`, 50), cut(r.email, 50), cut(r.jobTitle, 30), cut(r.companyName || r.company?.name, 40)],
  },
  faturas: {
    rotulo: 'faturas',
    modulos: ['erp'],
    path: '/api/erp/invoices',
    pick: (b) => b?.data,
    data: (r) => r.issueDate,
    valor: (r) => Number(r.grossAmount) || 0,
    status: (r) => statusFatura(r),
    texto: (r) => [r.documentNumber, r.companyName, r.documentType, r.companyCnpj, soDigitos(r.companyCnpj), r.contractNumber, r.proposalNumber],
    colunas: ['Documento', 'Cliente', 'Situação', 'Valor', 'Emissão', 'Vencimento'],
    linha: (r) => [cut(r.documentNumber, 24), cut(r.companyName, 50), statusLabel(statusFatura(r)), formatBRL(r.grossAmount), formatDateBr(r.issueDate), formatDateBr(r.dueDate)],
  },
  negocios: {
    rotulo: 'negócios',
    modulos: ['crm'],
    path: '/api/deals',
    pick: (b) => b?.data,
    data: (r) => r.createdAt,
    valor: (r) => Number(r.value) || 0,
    status: (r) => r.stageName || r.status,
    texto: (r) => [r.title, r.ownerName, r.companyName, r.company?.name, r.stageName],
    colunas: ['Negócio', 'Etapa', 'Responsável', 'Valor', 'Previsão'],
    linha: (r) => [cut(r.title, 50), statusLabel(r.stageName || r.status), cut(r.ownerName, 30), formatBRL(r.value), formatDateBr(r.expectedCloseDate)],
  },
  notas_fiscais: {
    rotulo: 'notas fiscais',
    modulos: ['erp'],
    path: '/api/erp/fiscal-documents',
    pick: (b) => (Array.isArray(b?.data) ? b.data.filter(ehNotaFiscal) : []),
    data: (r) => r.issueDate,
    valor: (r) => Number(r.grossAmount) || 0,
    status: (r) => statusFatura(r),
    texto: (r) => [r.documentNumber, r.companyName, r.companyCnpj, soDigitos(r.companyCnpj), tipoDocumentoFiscal(r.documentType), r.verificationCodeOrKey],
    colunas: ['Número', 'Tipo', 'Cliente', 'Situação', 'Valor', 'Emissão'],
    linha: (r) => [cut(r.documentNumber, 24), tipoDocumentoFiscal(r.documentType), cut(r.companyName, 50), statusLabel(statusFatura(r)), formatBRL(r.grossAmount), formatDateBr(r.issueDate)],
  },
  contas_receber: {
    rotulo: 'contas a receber',
    modulos: ['erp'],
    financeiro: true,
    path: '/api/erp/financial',
    pick: (b) => (Array.isArray(b?.data) ? b.data.filter((r: any) => r?.type === 'RECEBER') : []),
    data: (r) => r.dueDate,
    valor: (r) => Number(r.amount) || 0,
    status: (r) => statusLancamento(r),
    texto: (r) => [r.description, r.companyName, r.category, r.costCenter, r.paymentMethod],
    colunas: ['Descrição', 'Cliente', 'Situação', 'Valor', 'Vencimento', 'Pago em'],
    linha: (r) => [cut(r.description, 50), cut(r.companyName, 40), statusLabel(statusLancamento(r)), formatBRL(r.amount), formatDateBr(r.dueDate), formatDateBr(r.paidAt)],
  },
  contas_pagar: {
    rotulo: 'contas a pagar',
    modulos: ['erp'],
    financeiro: true,
    path: '/api/erp/financial',
    pick: (b) => (Array.isArray(b?.data) ? b.data.filter((r: any) => r?.type === 'PAGAR') : []),
    data: (r) => r.dueDate,
    valor: (r) => Number(r.amount) || 0,
    status: (r) => statusLancamento(r),
    texto: (r) => [r.description, r.companyName, r.category, r.costCenter, r.paymentMethod],
    colunas: ['Descrição', 'Fornecedor', 'Situação', 'Valor', 'Vencimento', 'Pago em'],
    linha: (r) => [cut(r.description, 50), cut(r.companyName, 40), statusLabel(statusLancamento(r)), formatBRL(r.amount), formatDateBr(r.dueDate), formatDateBr(r.paidAt)],
  },
  produtos: {
    rotulo: 'produtos e serviços',
    modulos: ['erp'],
    path: '/api/erp/catalog',
    pick: (b) => b?.data,
    data: () => '',
    valor: (r) => Number(r.monthlyRentalPrice) || Number(r.saleOrSetupPrice) || 0,
    status: (r) => (r.isActive === false ? 'Inativo' : 'Ativo'),
    texto: (r) => [r.name, r.gestaoClickCode, r.brand, r.modelName, r.productGroup, r.barcodeEan, r.category],
    colunas: ['Código', 'Nome', 'Locação/mês', 'Venda/setup', 'Estoque', 'Situação'],
    linha: (r) => [cut(r.gestaoClickCode, 16), cut(r.name, 60), formatBRL(r.monthlyRentalPrice), formatBRL(r.saleOrSetupPrice), String(Number(r.stockAvailable || 0)), r.isActive === false ? 'Inativo' : 'Ativo'],
  },
  estoque: {
    rotulo: 'itens de estoque',
    modulos: ['erp'],
    path: '/api/erp/catalog',
    pick: (b) => b?.data,
    data: () => '',
    status: (r) => statusEstoque(r),
    texto: (r) => [r.name, r.gestaoClickCode, r.brand, r.modelName, r.productGroup, r.barcodeEan, r.warehouseLocation],
    colunas: ['Código', 'Produto', 'Disponível', 'Em clientes', 'Mínimo', 'Situação'],
    linha: (r) => [cut(r.gestaoClickCode, 16), cut(r.name, 60), String(Number(r.stockAvailable || 0)), String(Number(r.stockRentedInClients || 0)), r.minStock ? String(r.minStock) : '-', statusEstoque(r)],
  },
  chamados: {
    rotulo: 'chamados',
    modulos: ['chamados'],
    path: '/api/tickets?limit=500',
    pick: (b) => b?.data,
    data: (r) => r.createdAt,
    status: (r) => statusChamado(r.status),
    texto: (r) => [r.key, r.legacyKey, r.jiraKey, r.subject, r.requesterName, r.requesterEmail, r.company?.name, r.assignee, r.queue],
    colunas: ['Chave', 'Assunto', 'Cliente', 'Situação', 'Prioridade', 'Aberto em'],
    linha: (r) => [cut(r.key, 20), cut(r.subject, 60), cut(r.company?.name || r.requesterName, 40), statusChamado(r.status), TICKET_PRIORIDADE_ROTULO[String(r.priority || '')] || '-', formatDateBr(r.createdAt)],
  },
  fornecedores: {
    rotulo: 'fornecedores',
    modulos: ['erp'],
    path: '/api/erp/overview',
    pick: (b) => b?.data?.suppliers,
    data: () => '',
    status: (r) => (r.active === false ? 'Inativo' : 'Ativo'),
    texto: (r) => [r.name, r.legalName, r.cnpj, soDigitos(r.cnpj), r.email, r.phone, r.cityState, r.supplierType],
    paraModelo: (r) => `${cut(r.name, 70)}${r.cnpj ? ` (CNPJ ${cut(r.cnpj, 20)})` : ''}`,
    colunas: ['Fornecedor', 'CNPJ', 'Telefone', 'E-mail', 'Cidade/UF'],
    linha: (r) => [cut(r.name || r.legalName, 60), cut(r.cnpj, 20), cut(r.phone, 20), cut(r.email, 40), cut(r.cityState, 30)],
  },
};

const filtroSchema = {
  entidade: z.enum(ENTIDADES),
  busca: z.string().trim().max(80).optional(),
  status: z.string().trim().max(40).optional(),
  de: isoDate.optional(),
  ate: isoDate.optional(),
};

const filtroParams = {
  entidade: { type: 'string', enum: [...ENTIDADES], description: 'Tipo de registro.' },
  busca: { type: 'string', description: 'Texto para filtrar por nome, código, cliente etc. (opcional).' },
  status: { type: 'string', description: 'Situação, por exemplo ATIVO, ENCERRADO, Em aberto, PAGA (opcional).' },
  de: { type: 'string', description: 'Data inicial AAAA-MM-DD (opcional).' },
  ate: { type: 'string', description: 'Data final AAAA-MM-DD (opcional).' },
};

type Filtro = { entidade: Entidade; busca?: string; status?: string; de?: string; ate?: string };

async function carregarFiltrado(f: Filtro, api: ApiCaller): Promise<{ ok: true; rows: any[]; def: EntidadeDef } | { ok: false; res: ApiCallResponse }> {
  const def = ENTIDADE_DEFS[f.entidade];
  if (def.financeiro) {
    // Mesma alcada da tela: sem permissao financeira, o painel devolve financeVisible=false.
    const gate = await api({ method: 'GET', path: '/api/erp/dashboard' });
    if (gate.status < 200 || gate.status >= 300) return { ok: false, res: gate };
    if (gate.body?.data?.financeVisible !== true) {
      return { ok: false, res: { status: 403, body: { error: 'Seu perfil não tem alçada financeira (Financeiro/Bancos).' } } };
    }
  }
  const res = await api({ method: 'GET', path: def.path });
  if (res.status < 200 || res.status >= 300) return { ok: false, res };
  const all = Array.isArray(def.pick(res.body)) ? def.pick(res.body) : [];
  const busca = f.busca ? compact(f.busca) : '';
  const status = f.status ? fold(f.status) : '';
  const rows = all.filter((r: any) => {
    if (!r || typeof r !== 'object') return false;
    if (busca && !buscaCombina(f.busca || '', def.texto(r))) return false;
    if (status && def.status && !statusCombina(f.status || '', def.status(r))) return false;
    if (f.de || f.ate) {
      const d = toIsoDate(def.data(r));
      if (!d) return false;
      if (f.de && d < f.de) return false;
      if (f.ate && d > f.ate) return false;
    }
    return true;
  });
  return { ok: true, rows, def };
}

function descreverFiltro(f: Filtro): string[] {
  const out = [`Tipo: ${ENTIDADE_DEFS[f.entidade].rotulo}`];
  if (f.busca) out.push(`Busca: "${f.busca}"`);
  if (f.status) out.push(`Situação: ${f.status}`);
  if (f.de || f.ate) out.push(`Período: ${f.de ? formatDateBr(f.de) : 'início'} a ${f.ate ? formatDateBr(f.ate) : 'hoje'}`);
  return out;
}

const ROTAS_ENTIDADES = [...new Set(Object.values(ENTIDADE_DEFS).map((d) => `GET ${d.path.split('?')[0]}`)), 'GET /api/erp/dashboard'];

function modulosEntidade(e: Entidade): ModuleKey[] {
  return ENTIDADE_DEFS[e].modulos;
}

// ---------------------------------------------------------------------------
// 1) consultar
// ---------------------------------------------------------------------------
const consultarSchema = z.object({ ...filtroSchema, limite: z.number().int().min(1).max(50).optional() }).strict();
type ConsultarArgs = z.infer<typeof consultarSchema>;

const consultar: AssistenteTool<ConsultarArgs> = {
  name: 'consultar',
  rotas: [...ROTAS_ENTIDADES],
  disponivel: (u) => u.moduleAccess.crm || u.moduleAccess.erp || u.moduleAccess.chamados,
  descricao:
    'Lista registros do STI-hub com filtros opcionais de busca, situação (ex.: vencido, aberto, pago, ATIVO, sem estoque) e período: contratos (vigência e reajuste), vendas, ordens_servico, empresas (clientes), fornecedores, contatos, faturas, notas_fiscais (NF-e/NFS-e/NFCom), contas_receber, contas_pagar, produtos (catálogo), estoque, chamados, negocios do CRM. Para propostas ou orçamentos use consultar_propostas; para um número/código/CNPJ/link use buscar. Só leitura.',
  tipo: 'leitura',
  parameters: {
    type: 'object',
    properties: { ...filtroParams, limite: { type: 'integer', minimum: 1, maximum: 50, description: 'Máximo de linhas (padrão 20).' } },
    required: ['entidade'],
    additionalProperties: false,
  },
  schema: consultarSchema,
  modulos: (a) => modulosEntidade(a.entidade),
  resumo: (a) => ({ titulo: `Consultar ${ENTIDADE_DEFS[a.entidade].rotulo}`, linhas: [...descreverFiltro(a), `Máximo de linhas: ${a.limite || 20}`] }),
  async executar(a, api) {
    const r = await carregarFiltrado(a, api);
    if (!r.ok) return apiError(r.res, `consultar ${ENTIDADE_DEFS[a.entidade].rotulo}`);
    const limite = a.limite || 20;
    const rows = [...r.rows].sort((x, y) => toIsoDate(r.def.data(y)).localeCompare(toIsoDate(r.def.data(x))));
    const shown = rows.slice(0, limite);
    return {
      ok: true,
      mensagem: rows.length
        ? `${rows.length} ${r.def.rotulo} encontrados${rows.length > shown.length ? `, mostrando os ${shown.length} mais recentes` : ''}.`
        : `Nenhum registro de ${r.def.rotulo} encontrado com esses filtros.${a.busca || a.status || a.de || a.ate ? ' Tente sem algum filtro, outro período, ou peça "buscar <nome, CNPJ ou número>" para procurar em todo o sistema.' : ''}`,
      tabela: shown.length ? { colunas: r.def.colunas, linhas: shown.map((x) => r.def.linha(x)) } : undefined,
      resumoParaModelo: r.def.paraModelo
        ? `Consulta de ${r.def.rotulo}: ${rows.length} encontrados${rows.length ? `: ${rows.slice(0, 5).map((x) => r.def.paraModelo!(x)).join('; ')}${rows.length > 5 ? '; ...' : ''}` : ''}.`
        : `Consulta de ${r.def.rotulo} executada: ${rows.length} registros (exibidos ao usuário, não enviados a você).`,
    };
  },
};

// ---------------------------------------------------------------------------
// 2) relatorio (totais por situacao ou por mes)
// ---------------------------------------------------------------------------
const relatorioSchema = z.object({ ...filtroSchema, agrupar_por: z.enum(['status', 'mes']).optional() }).strict();
type RelatorioArgs = z.infer<typeof relatorioSchema>;

const relatorio: AssistenteTool<RelatorioArgs> = {
  name: 'relatorio',
  rotas: [...ROTAS_ENTIDADES],
  disponivel: (u) => u.moduleAccess.crm || u.moduleAccess.erp || u.moduleAccess.chamados,
  descricao:
    'Relatório simples: quantidade e soma de valores de um tipo de registro, agrupados por situação (status) ou por mês, com filtros opcionais. Só leitura.',
  tipo: 'leitura',
  parameters: {
    type: 'object',
    properties: { ...filtroParams, agrupar_por: { type: 'string', enum: ['status', 'mes'], description: 'Agrupar por situação ou por mês (padrão status).' } },
    required: ['entidade'],
    additionalProperties: false,
  },
  schema: relatorioSchema,
  modulos: (a) => modulosEntidade(a.entidade),
  resumo: (a) => ({
    titulo: `Gerar o relatório de ${ENTIDADE_DEFS[a.entidade].rotulo}`,
    linhas: [...descreverFiltro(a), `Agrupado por: ${a.agrupar_por === 'mes' ? 'mês' : 'situação'}`],
  }),
  async executar(a, api) {
    const r = await carregarFiltrado(a, api);
    if (!r.ok) return apiError(r.res, `gerar o relatório de ${ENTIDADE_DEFS[a.entidade].rotulo}`);
    const porMes = a.agrupar_por === 'mes';
    const groups = new Map<string, { qtd: number; valor: number }>();
    let total = 0;
    for (const row of r.rows) {
      const key = porMes ? toIsoDate(r.def.data(row)).slice(0, 7) || 'sem data' : statusLabel(r.def.status ? r.def.status(row) : '-');
      const g = groups.get(key) || { qtd: 0, valor: 0 };
      g.qtd += 1;
      const v = r.def.valor ? r.def.valor(row) : 0;
      g.valor += v;
      total += v;
      groups.set(key, g);
    }
    const ordered = [...groups.entries()].sort((x, y) => (porMes ? y[0].localeCompare(x[0]) : y[1].qtd - x[1].qtd));
    const temValor = !!r.def.valor;
    return {
      ok: true,
      mensagem: `Relatório de ${r.def.rotulo}: ${r.rows.length} registros${temValor ? `, total de ${formatBRL(total)}` : ''}.`,
      totais: [
        { rotulo: 'Registros', valor: String(r.rows.length) },
        ...(temValor ? [{ rotulo: 'Valor total', valor: formatBRL(total) }] : []),
      ],
      tabela: ordered.length
        ? {
            colunas: [porMes ? 'Mês' : 'Situação', 'Quantidade', ...(temValor ? ['Valor'] : [])],
            linhas: ordered.slice(0, 60).map(([k, g]) => [k, String(g.qtd), ...(temValor ? [formatBRL(g.valor)] : [])]),
          }
        : undefined,
      resumoParaModelo: `Relatório de ${r.def.rotulo} gerado com ${ordered.length} grupos (exibido ao usuário, não enviado a você).`,
    };
  },
};

// ---------------------------------------------------------------------------
// Resolucao de empresa (cadastro) pela rota da tela, com a sessao do usuario
// ---------------------------------------------------------------------------
type ResolucaoEmpresa = { ok: true; company: any } | { ok: false; candidatos: any[]; result: ToolResult };

/**
 * Identifica a empresa pelo nome ou CNPJ com a rota da tela (sessao do usuario).
 * Ordem: CNPJ exato; nome compacto igual; uma unica candidata pela busca tolerante.
 * Se a busca do servidor nao achar nada, filtra a lista completa localmente.
 */
export async function resolverEmpresa(nome: string, api: ApiCaller): Promise<ResolucaoEmpresa> {
  const cnpjMatch = String(nome || '').match(CNPJ_RE);
  const cnpj = cnpjMatch ? cnpjMatch[0].replace(/\D+/g, '') : String(nome || '').replace(/\D+/g, '').length === 14 ? String(nome).replace(/\D+/g, '') : '';
  const semCnpj = cnpjMatch ? String(nome).replace(cnpjMatch[0], '').replace(/\bCNPJ\b/gi, '').replace(/[()—–-]+\s*$/g, '').trim() : String(nome || '');
  const termo = semCnpj || nome;
  const buscar = async (path: string): Promise<{ erro: ApiCallResponse } | { list: any[] }> => {
    const res = await api({ method: 'GET', path });
    if (res.status < 200 || res.status >= 300) return { erro: res };
    return { list: Array.isArray(res.body?.data) ? res.body.data : [] };
  };
  const digits = (v: unknown) => String(v || '').replace(/\D+/g, '');
  let r = await buscar(`/api/companies?search=${encodeURIComponent(termo)}&limit=20`);
  if ('erro' in r) return { ok: false, candidatos: [], result: apiError(r.erro, 'consultar o cadastro de empresas') };
  let list = r.list;
  const filtra = (l: any[]) => l.filter((c) => c && (buscaCombina(termo, [c.name, c.tradeName, c.legalName]) || (cnpj && digits(c.cnpj) === cnpj)));
  let cands = filtra(list);
  const porCnpjEm = (l: any[]) => (cnpj ? l.filter((c) => digits(c?.cnpj) === cnpj) : []);
  // Com CNPJ, se a busca por nome não trouxer a empresa certa, amplia para a lista visível.
  if (!cands.length || (cnpj && porCnpjEm(list).length !== 1)) {
    r = await buscar('/api/companies');
    if ('erro' in r) return { ok: false, candidatos: [], result: apiError(r.erro, 'consultar o cadastro de empresas') };
    list = r.list;
    cands = filtra(list);
  }
  const porCnpj = porCnpjEm(list);
  // CNPJ nos argumentos (cartão/token) prevalece: nunca cai no nome de outra empresa.
  if (cnpj) {
    if (porCnpj.length === 1) return { ok: true, company: porCnpj[0] };
    const identCnpj = (c: any) => `${cut(c?.name, 60)}${c?.cnpj ? ` (CNPJ ${cut(c.cnpj, 20)})` : ''}`;
    const msgCnpj = porCnpj.length
      ? `Encontrei ${porCnpj.length} empresas com o CNPJ informado: ${porCnpj.slice(0, 5).map((c, i) => `${i + 1}) ${identCnpj(c)}`).join('; ')}. Qual delas?`
      : 'Não encontrei a empresa com o CNPJ informado no cadastro visível. Informe o nome completo ou confira o CNPJ.';
    return {
      ok: false,
      candidatos: porCnpj,
      result: { ok: false, status: 404, mensagem: msgCnpj, resumoParaModelo: `Empresa não identificada pelo CNPJ (${porCnpj.length} candidatas).` },
    };
  }
  const alvo = compact(termo);
  const exact = cands.filter((c) => compact(c?.name) === alvo);
  const pick = exact.length === 1 ? exact[0] : cands.length === 1 ? cands[0] : null;
  if (pick) return { ok: true, company: pick };
  const ident = (c: any) => `${cut(c?.name, 60)}${c?.cnpj ? ` (CNPJ ${cut(c.cnpj, 20)})` : ''}`;
  const msg = cands.length
    ? `Encontrei ${cands.length} empresas para "${cut(termo, 60)}": ${cands.slice(0, 5).map((c, i) => `${i + 1}) ${ident(c)}`).join('; ')}. Qual delas?`
    : `Não encontrei a empresa "${cut(termo, 60)}" no cadastro. Informe o nome completo ou o CNPJ.`;
  return {
    ok: false,
    candidatos: cands,
    result: { ok: false, status: 404, mensagem: msg, resumoParaModelo: `Empresa não identificada (${cands.length} candidatas). ${msg}` },
  };
}

/** Texto canonico do cliente depois de identificado (o CNPJ evita ambiguidade na execucao). */
const clienteCanonico = (c: any) => (c?.cnpj ? `${String(c.name || '').trim()} — CNPJ ${String(c.cnpj).trim()}` : String(c?.name || '').trim());

/** preparar() comum das acoes com cliente: identifica a empresa ou pergunta qual. */
async function prepararCliente<A extends { cliente: string }>(a: A, api: ApiCaller): Promise<{ ok: true; args: A } | { ok: false; texto: string }> {
  const emp = await resolverEmpresa(a.cliente, api);
  if (!emp.ok) return { ok: false, texto: emp.result.mensagem };
  return { ok: true, args: { ...a, cliente: clienteCanonico(emp.company) } };
}

// ---------------------------------------------------------------------------
// 3) criar_rascunho_proposta (orcamento em RASCUNHO; nunca envia)
// ---------------------------------------------------------------------------
const itemSchema = z
  .object({
    descricao: shortText(200),
    quantidade: z.number().positive().max(100000),
    /** Opcional: sem valor, o item fica "a definir" (R$ 0) para preencher no ERP. */
    valor_unitario: z.number().min(0).max(100_000_000).optional(),
    /** Legado (o tipo agora e da proposta inteira, em tipo_proposta): aceito e ignorado. */
    tipo: z.enum(['locacao', 'servico', 'produto']).optional(),
    /** Codigo do produto no cadastro (quando escolhido na lista de modelos). */
    codigo: z.string().trim().max(60).optional(),
  })
  .strict();
const propostaSchema = z
  .object({
    cliente: shortText(160),
    /** Obrigatorio (24/11/2026): o assistente pergunta o tipo antes de montar o rascunho. */
    tipo_proposta: z.enum(['produtos', 'servico_pontual', 'servico_mensal', 'locacao']),
    titulo: z.string().trim().max(160).optional(),
    prazo_meses: z.number().int().min(1).max(120).optional(),
    itens: z.array(itemSchema).min(1).max(30),
    /** Setup / ativacao (locacao) ou implantacao (servico mensal): valor unico, a parte da mensalidade. */
    setup: z.number().min(0).max(100_000_000).optional(),
    indice_reajuste: z.enum(INDICES_REAJUSTE).optional(),
    frete: z.number().min(0).max(10_000_000).optional(),
    /** Frete incluso no preco (sem cobranca a parte). */
    frete_incluso: z.boolean().optional(),
    prazo_entrega: z.string().trim().max(120).optional(),
    forma_pagamento: z.enum(['boleto', 'pix', 'ted']).optional(),
    observacoes: z.string().trim().max(1000).optional(),
  })
  .strict()
  .superRefine((a, ctx) => {
    const recorrente = a.tipo_proposta === 'locacao' || a.tipo_proposta === 'servico_mensal';
    if (recorrente && !a.prazo_meses) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['prazo_meses'], message: 'Prazo em meses obrigatório para locação e serviço mensal.' });
    if (!recorrente && a.setup) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['setup'], message: 'Setup só em locação ou serviço mensal.' });
    if (!recorrente && a.indice_reajuste) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['indice_reajuste'], message: 'Reajuste só em locação ou serviço mensal.' });
    if (a.frete && a.tipo_proposta !== 'produtos' && a.tipo_proposta !== 'locacao') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['frete'], message: 'Frete só em produtos ou locação.' });
  });
type PropostaArgs = z.infer<typeof propostaSchema>;

const NATUREZA: Record<string, string> = { locacao: 'LOCACAO_BENS_MOVEIS', servico: 'SERVICO_TECNICO_TI_TELECOM', produto: 'VENDA_EQUIPAMENTO' };

/** Como o tipo da proposta vira orcamento no ERP (mesmas regras da tela de Orcamentos). */
const TIPO_ERP: Record<TipoProposta, { budgetType: 'PRODUTOS' | 'SERVICOS' | 'LOCACAO'; itemType: 'PRODUCT' | 'SERVICE'; fiscalNature: string; recorrente: boolean }> = {
  produtos: { budgetType: 'PRODUTOS', itemType: 'PRODUCT', fiscalNature: 'VENDA_EQUIPAMENTO', recorrente: false },
  // Servico pontual = SERVICOS com prazo 1 (avulso, pagamento unico), igual a tela.
  servico_pontual: { budgetType: 'SERVICOS', itemType: 'SERVICE', fiscalNature: 'SERVICO_TECNICO_TI_TELECOM', recorrente: true },
  servico_mensal: { budgetType: 'SERVICOS', itemType: 'SERVICE', fiscalNature: 'SERVICO_TECNICO_TI_TELECOM', recorrente: true },
  locacao: { budgetType: 'LOCACAO', itemType: 'PRODUCT', fiscalNature: 'LOCACAO_BENS_MOVEIS', recorrente: true },
};
const mensalTipo = (t: TipoProposta) => t === 'locacao' || t === 'servico_mensal';
const totalProposta = (a: PropostaArgs) => a.itens.reduce((s, i) => s + i.quantidade * (i.valor_unitario || 0), 0);
const semValor = (a: PropostaArgs) => a.itens.some((i) => !i.valor_unitario);
const mesesDaProposta = (a: PropostaArgs) => (mensalTipo(a.tipo_proposta) ? a.prazo_meses || 1 : 1);
const tituloProposta = (a: PropostaArgs) => {
  if (a.titulo) return a.titulo;
  if (a.tipo_proposta === 'locacao') return `Proposta de Locação${a.prazo_meses ? ` — ${a.prazo_meses} meses` : ''}`;
  if (a.tipo_proposta === 'servico_mensal') return `Proposta de Serviços${a.prazo_meses ? ` — ${a.prazo_meses} meses` : ''}`;
  if (a.tipo_proposta === 'servico_pontual') return 'Proposta de Serviços';
  return 'Proposta de Produtos';
};

/** Corpo do POST /api/erp/proposals (exportado para teste). */
export function corpoRascunhoProposta(a: PropostaArgs, company: { id: string; name: string; cnpj?: string }, agora = Date.now()): Record<string, unknown> {
  const cfg = TIPO_ERP[a.tipo_proposta];
  const forma = (a.forma_pagamento || 'boleto') as FormaPagamento;
  const meses = mesesDaProposta(a);
  const items = a.itens.map((i, idx) => ({
    id: `pi-${agora}-${idx + 1}`,
    sku: i.codigo || '',
    description: i.descricao,
    itemType: cfg.itemType,
    fiscalNature: cfg.fiscalNature,
    ncmOrServiceCode: '',
    quantity: i.quantidade,
    unitPrice: i.valor_unitario || 0,
    discountPercent: 0,
    isRecurring: cfg.recorrente,
    totalMonthly: Math.round(i.quantidade * (i.valor_unitario || 0) * 100) / 100,
  }));
  const base: Record<string, unknown> = {
    title: tituloProposta(a),
    status: 'RASCUNHO',
    budgetType: cfg.budgetType,
    contractMonths: meses,
    companyId: company.id,
    companyName: company.name,
    companyCnpj: company.cnpj || '',
    items,
    // Setup sempre separado da mensalidade (nunca somado no valor mensal).
    setupFee: mensalTipo(a.tipo_proposta) ? a.setup || 0 : 0,
    shippingCost: a.frete || 0,
    ...(mensalTipo(a.tipo_proposta) ? { readjustmentIndex: a.indice_reajuste || 'IPCA' } : {}),
    ...(a.prazo_entrega ? { deliveryLeadTime: a.prazo_entrega, deliveryForecast: a.prazo_entrega } : {}),
  };
  const rotulo = ROTULO_FORMA_PAGAMENTO[forma];
  if (semValor(a)) {
    // Sem todos os valores nao gera parcelas (ficariam zeradas); so a forma escolhida.
    base.paymentCondition = `${rotulo} — valores a definir`;
  } else {
    const totais = computeProposalTotals({ ...base, contractMonths: meses } as unknown as ErpCommercialProposal);
    const firstDue = new Date(agora + 15 * 86_400_000).toISOString().slice(0, 10);
    const built = buildProposalInstallments(totais, { count: 1, method: FORMA_PAGAMENTO_ERP[forma], firstDueDate: firstDue, methodLabel: rotulo });
    base.installments = built.installments;
    base.paymentCondition = built.paymentCondition.includes(rotulo) ? built.paymentCondition : `${rotulo} — ${built.paymentCondition}`;
  }
  const notas = [a.observacoes, a.frete_incluso ? 'Frete incluso no preço.' : '', semValor(a) ? 'Criada pelo assistente de IA: há itens sem valor unitário, preencher.' : ''].filter(Boolean).join('\n');
  if (notas) base.internalNotes = notas;
  return base;
}

/**
 * Antes do zod: sem tipo, pergunta o tipo; com tipo, pede so os campos que faltam para ele.
 * Cartao nunca: so Boleto, Pix ou Ted / Transferencia.
 */
function faltandoProposta(a: any): string | null {
  const tipo = a?.tipo_proposta;
  if (tipo === 'servico') return PERGUNTA_SERVICO_MODO;
  if (!tipo || !(TIPOS_PROPOSTA as readonly string[]).includes(tipo)) return PERGUNTA_TIPO_PROPOSTA;
  if (a.forma_pagamento === 'cartao') return MENSAGEM_SEM_CARTAO;
  const faltam: string[] = [];
  if (!a.cliente || !String(a.cliente).trim()) faltam.push('o cliente (nome ou CNPJ)');
  if (!Array.isArray(a.itens) || !a.itens.length) {
    faltam.push(tipo === 'produtos' ? 'os itens com quantidade' : tipo === 'locacao' ? 'os equipamentos com quantidade' : 'a descrição do serviço');
  }
  if (mensalTipo(tipo) && !a.prazo_meses) faltam.push('o prazo do contrato em meses');
  if (!faltam.length) return null;
  return `${perguntaCamposDoTipo(tipo as TipoProposta)}\nAinda falta: ${faltam.join(', ')}.`;
}

function coagirProposta(a: any): any {
  if (!a || typeof a !== 'object') return a;
  const out = { ...a };
  if ('tipo_proposta' in out) out.tipo_proposta = normalizarTipoProposta(out.tipo_proposta) ?? out.tipo_proposta;
  if ('forma_pagamento' in out) out.forma_pagamento = normalizarFormaPagamento(out.forma_pagamento) ?? out.forma_pagamento;
  if ('indice_reajuste' in out) out.indice_reajuste = normalizarIndice(out.indice_reajuste) ?? out.indice_reajuste;
  for (const k of ['setup', 'frete'] as const) if (k in out) out[k] = parseNumeroBR(out[k]);
  // Setup 0 / frete 0 ("sem setup") = sem o campo.
  if (out.setup === 0) delete out.setup;
  if (out.frete === 0) delete out.frete;
  if (out.frete_incluso !== true) delete out.frete_incluso;
  if (out.frete_incluso) delete out.frete;
  // Servico pontual e produtos nao tem prazo de contrato (pagamento unico).
  if (out.tipo_proposta === 'servico_pontual' || out.tipo_proposta === 'produtos') {
    delete out.prazo_meses;
    delete out.indice_reajuste;
  }
  if (out.tipo_proposta === 'servico_pontual' || out.tipo_proposta === 'servico_mensal') {
    delete out.frete;
    delete out.frete_incluso;
  }
  return out;
}

const criarRascunhoProposta: AssistenteTool<PropostaArgs> = {
  name: 'criar_rascunho_proposta',
  rotas: ['GET /api/companies', 'POST /api/erp/proposals'],
  disponivel: (u) => u.moduleAccess.erp,
  preparar: prepararCliente,
  faltando: faltandoProposta,
  coagir: coagirProposta,
  descricao:
    'Cria uma proposta/orçamento como RASCUNHO no ERP (não envia ao cliente). Exige tipo_proposta: se o usuário não disse o tipo (Produtos, Serviços pontual ou mensal, Locação), NÃO chame esta ferramenta; pergunte o tipo primeiro. ' +
    'Campos por tipo: locacao = prazo_meses, valor mensal por item, setup (ativação, valor único à parte) e indice_reajuste; servico_mensal = prazo_meses, valor mensal, setup opcional, indice_reajuste; servico_pontual = valor do serviço (pagamento único), sem prazo; produtos = itens com quantidade e valor, frete e prazo_entrega. ' +
    'forma_pagamento só boleto, pix ou ted (Ted / Transferência); nunca cartão. Valor unitário é opcional: sem valor, o item fica a definir.',
  tipo: 'gravacao',
  parameters: {
    type: 'object',
    properties: {
      cliente: { type: 'string', description: 'Nome ou CNPJ do cliente, como o usuário escreveu.' },
      tipo_proposta: {
        type: 'string',
        enum: ['produtos', 'servico_pontual', 'servico_mensal', 'locacao'],
        description: 'Tipo escolhido pelo usuário. Obrigatório: nunca suponha; pergunte se não foi dito.',
      },
      titulo: { type: 'string', description: 'Título curto da proposta (opcional).' },
      prazo_meses: { type: 'integer', minimum: 1, maximum: 120, description: 'Prazo do contrato em meses. Obrigatório em locacao e servico_mensal; não use em produtos nem servico_pontual.' },
      itens: {
        type: 'array',
        minItems: 1,
        maxItems: 30,
        items: {
          type: 'object',
          properties: {
            descricao: { type: 'string' },
            quantidade: { type: 'number' },
            valor_unitario: { type: 'number', description: 'Locação e serviço mensal: valor MENSAL (sem o setup). Serviço pontual: valor do serviço. Produtos: preço unitário. Omita se não informado.' },
          },
          required: ['descricao', 'quantidade'],
          additionalProperties: false,
        },
      },
      setup: { type: 'number', description: 'Setup / ativação (locação) ou implantação (serviço mensal): valor único, cobrado à parte da mensalidade. Nunca some na mensalidade.' },
      indice_reajuste: { type: 'string', enum: [...INDICES_REAJUSTE], description: 'Índice de reajuste (locação e serviço mensal). Padrão IPCA.' },
      frete: { type: 'number', description: 'Valor do frete (produtos ou locação).' },
      frete_incluso: { type: 'boolean', description: 'true quando o usuário disser frete incluso.' },
      prazo_entrega: { type: 'string', description: 'Prazo de entrega (produtos), ex.: "10 dias úteis".' },
      forma_pagamento: { type: 'string', enum: ['boleto', 'pix', 'ted'], description: 'Boleto, Pix ou Ted / Transferência. Padrão boleto.' },
      observacoes: { type: 'string', description: 'Observações internas (opcional).' },
    },
    required: ['cliente', 'tipo_proposta', 'itens'],
    additionalProperties: false,
  },
  schema: propostaSchema as unknown as z.ZodType<PropostaArgs>,
  modulos: () => ['erp'],
  resumo: (a) => {
    const mensal = mensalTipo(a.tipo_proposta);
    const pontual = a.tipo_proposta === 'servico_pontual';
    const total = totalProposta(a);
    return {
      titulo: 'Criar rascunho de proposta',
      linhas: [
        `Tipo: ${ROTULO_TIPO_PROPOSTA[a.tipo_proposta]}`,
        `Cliente: ${a.cliente}`,
        `Título: ${tituloProposta(a)}`,
        ...(mensal ? [`Prazo: ${a.prazo_meses} meses`] : []),
        ...a.itens.map((i) => `${i.quantidade} x ${i.descricao} a ${i.valor_unitario ? `${formatBRL(i.valor_unitario)}${mensal ? '/mês' : ''}` : 'valor a definir'}`),
        mensal
          ? `${a.tipo_proposta === 'locacao' ? 'Mensalidade' : 'Valor mensal'}: ${formatBRL(total)}`
          : `${pontual ? 'Valor do serviço (pagamento único)' : 'Total dos itens'}: ${formatBRL(total)}`,
        ...(mensal ? [`${a.tipo_proposta === 'locacao' ? 'Setup / ativação' : 'Setup / implantação'}: ${a.setup ? `${formatBRL(a.setup)} (pagamento único, à parte da mensalidade)` : 'sem setup'}`] : []),
        ...(mensal ? [`Índice de reajuste: ${ROTULO_INDICE[(a.indice_reajuste || 'IPCA') as IndiceReajuste]}${a.indice_reajuste ? '' : ' (padrão)'}`] : []),
        ...(a.tipo_proposta === 'produtos' || a.tipo_proposta === 'locacao'
          ? [`Frete: ${a.frete_incluso ? 'incluso (sem cobrança à parte)' : a.frete ? formatBRL(a.frete) : 'a definir (padrão; ajuste se precisar)'}`]
          : []),
        ...(a.prazo_entrega
          ? [`Prazo de entrega: ${a.prazo_entrega}`]
          : a.tipo_proposta === 'produtos' || a.tipo_proposta === 'locacao'
            ? ['Prazo de entrega: conforme disponibilidade (padrão do sistema)']
            : []),
        `Forma de pagamento: ${ROTULO_FORMA_PAGAMENTO[(a.forma_pagamento || 'boleto') as FormaPagamento]}${a.forma_pagamento ? '' : ' (padrão; pode ser Pix ou Ted / Transferência)'}`,
        ...(semValor(a) ? ['Há itens sem valor: preencha no ERP.'] : []),
        ...(a.observacoes ? [`Observações: ${cut(a.observacoes, 200)}`] : []),
        'Situação: rascunho (nada é enviado ao cliente)',
      ],
    };
  },
  async executar(a, api) {
    const emp = await resolverEmpresa(a.cliente, api);
    if (!emp.ok) return emp.result;
    const body = corpoRascunhoProposta(a, { id: String(emp.company.id), name: String(emp.company.name || ''), cnpj: emp.company.cnpj });
    const res = await api({ method: 'POST', path: '/api/erp/proposals', body });
    if (res.status < 200 || res.status >= 300) return apiError(res, 'criar a proposta');
    const p = res.body?.data || {};
    return {
      ok: true,
      mensagem: `Rascunho de proposta ${p.code ? `#${p.code} ` : ''}(${ROTULO_TIPO_PROPOSTA[a.tipo_proposta]}) criado para ${cut(emp.company.name, 60)}. Nada foi enviado ao cliente.`,
      registro: { tipo: 'proposta', id: String(p.id || ''), codigo: p.code ? String(p.code) : undefined },
      resumoParaModelo: `Rascunho de proposta criado (código ${p.code || 'n/d'}, tipo ${a.tipo_proposta}). Não crie outra para o mesmo pedido.`,
    };
  },
};

// ---------------------------------------------------------------------------
// 4) abrir_chamado
// ---------------------------------------------------------------------------
const PRIORIDADE_CHAMADO: Record<string, string> = { baixa: 'LOW', media: 'MEDIUM', alta: 'HIGH', critica: 'CRITICAL' };
const CATEGORIA_CHAMADO: Record<string, string> = { suporte: 'SUPPORT', incidente: 'INCIDENT', financeiro: 'BILLING', bug: 'BUG', melhoria: 'FEATURE_REQUEST' };
const chamadoSchema = z
  .object({
    assunto: shortText(200),
    descricao: z.string().trim().max(4000).optional(),
    prioridade: z.enum(['baixa', 'media', 'alta', 'critica']).optional(),
    categoria: z.enum(['suporte', 'incidente', 'financeiro', 'bug', 'melhoria']).optional(),
    empresa: z.string().trim().max(120).optional(),
  })
  .strict();
type ChamadoArgs = z.infer<typeof chamadoSchema>;

const abrirChamado: AssistenteTool<ChamadoArgs> = {
  name: 'abrir_chamado',
  rotas: ['GET /api/companies', 'POST /api/tickets'],
  disponivel: (u) => u.moduleAccess.chamados,
  descricao: 'Abre um chamado (ticket) no STI HUB Desk Service. Não envia mensagem ao cliente.',
  tipo: 'gravacao',
  parameters: {
    type: 'object',
    properties: {
      assunto: { type: 'string' },
      descricao: { type: 'string' },
      prioridade: { type: 'string', enum: ['baixa', 'media', 'alta', 'critica'] },
      categoria: { type: 'string', enum: ['suporte', 'incidente', 'financeiro', 'bug', 'melhoria'] },
      empresa: { type: 'string', description: 'Empresa cliente cadastrada (opcional).' },
    },
    required: ['assunto'],
    additionalProperties: false,
  },
  schema: chamadoSchema,
  modulos: () => ['chamados'],
  resumo: (a) => ({
    titulo: 'Abrir chamado',
    linhas: [
      `Assunto: ${a.assunto}`,
      ...(a.descricao ? [`Descrição: ${cut(a.descricao, 240)}`] : []),
      `Prioridade: ${a.prioridade || 'media'}`,
      `Categoria: ${a.categoria || 'suporte'}`,
      ...(a.empresa ? [`Empresa: ${a.empresa}`] : []),
    ],
  }),
  async executar(a, api) {
    let companyId: string | null = null;
    let aviso = '';
    if (a.empresa) {
      const emp = await resolverEmpresa(a.empresa, api);
      if (emp.ok) companyId = String(emp.company.id);
      else aviso = ' A empresa não foi vinculada porque não foi identificada no cadastro.';
    }
    const res = await api({
      method: 'POST',
      path: '/api/tickets',
      body: {
        subject: a.assunto,
        ...(a.descricao ? { description: a.descricao } : {}),
        priority: PRIORIDADE_CHAMADO[a.prioridade || 'media'],
        category: CATEGORIA_CHAMADO[a.categoria || 'suporte'],
        ...(companyId ? { companyId } : {}),
      },
    });
    if (res.status < 200 || res.status >= 300) return apiError(res, 'abrir o chamado');
    const t = res.body?.data || {};
    return {
      ok: true,
      mensagem: `Chamado ${t.key || ''} aberto: ${cut(a.assunto, 80)}.${aviso}`.replace('  ', ' '),
      registro: { tipo: 'chamado', id: String(t.id || ''), codigo: t.key ? String(t.key) : undefined },
      resumoParaModelo: `Chamado aberto (chave ${t.key || 'n/d'}).`,
    };
  },
};

// ---------------------------------------------------------------------------
// 5) abrir_os
// ---------------------------------------------------------------------------
const PRIORIDADE_OS: Record<string, string> = { baixa: 'BAIXA', normal: 'NORMAL', alta: 'ALTA', critica: 'CRITICA' };
const osSchema = z
  .object({
    cliente: shortText(120),
    descricao: shortText(2000),
    tecnico: z.string().trim().max(80).optional(),
    prioridade: z.enum(['baixa', 'normal', 'alta', 'critica']).optional(),
    equipamento: z.string().trim().max(120).optional(),
    numero_serie: z.string().trim().max(60).optional(),
  })
  .strict();
type OsArgs = z.infer<typeof osSchema>;

const abrirOs: AssistenteTool<OsArgs> = {
  name: 'abrir_os',
  rotas: ['GET /api/companies', 'GET /api/erp/overview', 'POST /api/erp/service-orders'],
  disponivel: (u) => u.moduleAccess.erp,
  preparar: prepararCliente,
  descricao: 'Abre uma ordem de serviço (OS) "Em aberto" no ERP para uma empresa cliente cadastrada.',
  tipo: 'gravacao',
  parameters: {
    type: 'object',
    properties: {
      cliente: { type: 'string', description: 'Nome (ou CNPJ) da empresa cliente cadastrada.' },
      descricao: { type: 'string' },
      tecnico: { type: 'string' },
      prioridade: { type: 'string', enum: ['baixa', 'normal', 'alta', 'critica'] },
      equipamento: { type: 'string' },
      numero_serie: { type: 'string' },
    },
    required: ['cliente', 'descricao'],
    additionalProperties: false,
  },
  schema: osSchema,
  modulos: () => ['erp'],
  resumo: (a) => ({
    titulo: 'Abrir ordem de serviço',
    linhas: [
      `Cliente: ${a.cliente}`,
      `Descrição: ${cut(a.descricao, 240)}`,
      `Prioridade: ${a.prioridade || 'normal'}`,
      ...(a.tecnico ? [`Técnico: ${a.tecnico}`] : []),
      ...(a.equipamento ? [`Equipamento: ${a.equipamento}`] : []),
      ...(a.numero_serie ? [`Número de série: ${a.numero_serie}`] : []),
      'Situação: Em aberto',
    ],
  }),
  async executar(a, api) {
    const emp = await resolverEmpresa(a.cliente, api);
    if (!emp.ok) return emp.result;
    const ov = await api({ method: 'GET', path: '/api/erp/overview' });
    if (ov.status < 200 || ov.status >= 300) return apiError(ov, 'consultar as ordens de serviço');
    const orders: any[] = Array.isArray(ov.body?.data?.serviceOrders) ? ov.body.data.serviceOrders : [];
    const ids = new Set(orders.map((o) => String(o?.id)));
    let id = '';
    do id = `os-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; while (ids.has(id));
    const code = nextServiceOrderCode(orders);
    const res = await api({
      method: 'POST',
      path: '/api/erp/service-orders',
      body: {
        id,
        code,
        status: 'Em aberto',
        companyId: emp.company.id,
        companyName: emp.company.name,
        companyCnpj: emp.company.cnpj || '',
        description: a.descricao,
        technicianName: a.tecnico || '',
        sellerName: '',
        priority: PRIORIDADE_OS[a.prioridade || 'normal'],
        equipmentName: a.equipamento || '',
        serialNumber: a.numero_serie || '',
        entryDate: todayBr(),
        exitDate: '',
        totalAmount: 0,
        technicalReport: '',
      },
    });
    if (res.status < 200 || res.status >= 300) return apiError(res, 'abrir a ordem de serviço');
    const os = res.body?.data || {};
    return {
      ok: true,
      mensagem: `OS #${os.code || code} aberta para ${cut(emp.company.name, 60)}, situação Em aberto.`,
      registro: { tipo: 'ordem_servico', id: String(os.id || id), codigo: String(os.code || code) },
      resumoParaModelo: `Ordem de serviço aberta (código ${os.code || code}).`,
    };
  },
};

// ---------------------------------------------------------------------------
// Orcamentos / propostas: mesma fonte da tela (GET /api/erp/proposals?q= e /:id)
// ---------------------------------------------------------------------------
/** Situacoes em que a proposta nao e editada pelo assistente. */
export const PROPOSTA_STATUS_BLOQUEADOS = ['APROVADA', 'CONVERTIDA_CONTRATO', 'RECUSADA'] as const;

/** Proposta que veio do GestaoClick (id prop-gc-<id> ou gcSource): nao ha sincronizacao de volta. */
export function propostaDoGestaoClick(p: any): boolean {
  return Boolean((p?.gcSource && p.gcSource.id) || /^prop-gc-\d+$/.test(String(p?.id || '')));
}

const numeroProposta = (p: any) => formatProposalDisplayCode(p?.code) || String(p?.code || p?.id || '');
const STATUS_PROPOSTA_ROTULO: Record<string, string> = {
  RASCUNHO: 'Rascunho', ENVIADA: 'Enviada', EM_NEGOCIACAO: 'Em negociação', APROVADA: 'Aprovada', CONVERTIDA_CONTRATO: 'Convertida em contrato', RECUSADA: 'Recusada',
};
const statusProposta = (v: unknown) => STATUS_PROPOSTA_ROTULO[String(v || '')] || statusLabel(v);
const totalPropostaRegistro = (p: any) => Number(p?.totalContractValue ?? 0) || Number(p?.monthlyRecurringTotal || 0) + Number(p?.oneTimeSetupTotal || 0) + Number(p?.shippingCost || 0);

/** "proposta 4709", "#4709", "GC-ORC-4709" => "4709" (ou o texto limpo). */
export function refProposta(v: unknown): string {
  return String(v ?? '').trim().replace(/^(?:a\s+)?(?:proposta|or[cç]amento)\s*(?:n[ºo°.]*\s*)?/i, '').replace(/^#\s*/, '').trim();
}

/** Id interno do STI-hub (ex.: prop-1795473263142-d5b63b). */
export function pareceIdProposta(v: unknown): boolean {
  return /^prop-[a-z0-9-]+$/i.test(refProposta(v));
}


function mesmaProposta(p: any, ref: string): boolean {
  const r = refProposta(ref);
  if (!r) return false;
  if (String(p?.id || '') === r) return true;
  if (compact(p?.code) === compact(r)) return true;
  const n = extractGcProposalNumber(r);
  return n !== null && extractGcProposalNumber(p?.code) === n;
}

type PropostaLocalizada = { ok: true; proposta: any } | { ok: false; texto: string; status: number };

/** Acha UMA proposta pelo numero/codigo exato e devolve o registro completo (GET /:id). */
export async function localizarProposta(ref: string, api: ApiCaller): Promise<PropostaLocalizada> {
  const r = refProposta(ref);
  if (!r) return { ok: false, status: 400, texto: 'Informe o número da proposta.' };
  if (pareceIdProposta(r)) {
    const full = await api({ method: 'GET', path: `/api/erp/proposals/${encodeURIComponent(r)}` });
    if (full.status >= 200 && full.status < 300 && full.body?.data && !Array.isArray(full.body.data)) {
      return { ok: true, proposta: full.body.data };
    }
    if (full.status === 403 || full.status === 401) return { ok: false, status: full.status, texto: apiError(full, 'abrir a proposta').mensagem };
    return {
      ok: false,
      status: full.status || 404,
      texto:
        full.status === 404
          ? `Não encontrei a proposta ${cut(r, 30)}. Confira o número na tela de Orçamentos.`
          : `Não consegui abrir a proposta ${cut(r, 30)}.`,
    };
  }
  const qs = new URLSearchParams({ q: r, limit: '20', offset: '0', status: 'TODOS', type: 'TODOS' });
  const res = await api({ method: 'GET', path: `/api/erp/proposals?${qs.toString()}` });
  if (res.status < 200 || res.status >= 300) {
    const e = apiError(res, 'consultar as propostas');
    return { ok: false, status: res.status, texto: e.mensagem };
  }
  const list: any[] = Array.isArray(res.body?.data) ? res.body.data : [];
  const exatas = list.filter((p) => mesmaProposta(p, r));
  if (!exatas.length) return { ok: false, status: 404, texto: `Não encontrei a proposta ${cut(r, 30)}. Confira o número na tela de Orçamentos.` };
  if (exatas.length > 1) {
    return {
      ok: false,
      status: 409,
      texto: `Há ${exatas.length} propostas com o número ${cut(r, 30)}: ${exatas.slice(0, 5).map((p, i) => `${i + 1}) ${cut(p.code, 24)} de ${cut(p.companyName, 50)}`).join('; ')}. Qual delas?`,
    };
  }
  const full = await api({ method: 'GET', path: `/api/erp/proposals/${encodeURIComponent(String(exatas[0].id))}` });
  if (full.status < 200 || full.status >= 300 || !full.body?.data || Array.isArray(full.body.data)) {
    if (full.status === 403 || full.status === 401) return { ok: false, status: full.status, texto: apiError(full, 'abrir a proposta').mensagem };
    return { ok: false, status: full.status || 404, texto: `Não consegui abrir a proposta ${cut(r, 30)}.` };
  }
  return { ok: true, proposta: full.body.data };
}

const cobrancaItem = (i: any) => (i?.isRecurring === false ? 'única' : 'mensal');
const resumoItens = (p: any, max = 10) =>
  (Array.isArray(p?.items) ? p.items : [])
    .slice(0, max)
    .map((i: any, idx: number) => `${idx + 1}) ${cut(i.description, 60)} x${Number(i.quantity || 1)} a ${formatBRL(i.unitPrice)} (${cobrancaItem(i)})`)
    .join('; ');

const propostasSchema = z
  .object({
    busca: z.string().trim().max(80).optional(),
    status: z.enum(['RASCUNHO', 'ENVIADA', 'EM_NEGOCIACAO', 'APROVADA', 'CONVERTIDA_CONTRATO', 'RECUSADA']).optional(),
    limite: z.number().int().min(1).max(50).optional(),
    /** Periodo pela data de criacao (AAAA-MM-DD), para "orçamentos de outubro". */
    de: isoDate.optional(),
    ate: isoDate.optional(),
  })
  .strict();
type PropostasArgs = z.infer<typeof propostasSchema>;

const consultarPropostas: AssistenteTool<PropostasArgs> = {
  name: 'consultar_propostas',
  descricao:
    'Consulta orçamentos/propostas comerciais do ERP (mesma lista da tela de Orçamentos) pelo número/código (ex.: 4709), cliente, título ou situação. Com um número exato, traz os itens. Use para "proposta" ou "orçamento", nunca consultar negócios. Só leitura.',
  tipo: 'leitura',
  rotas: ['GET /api/erp/proposals', 'GET /api/erp/proposals/:id'],
  disponivel: (u) => u.moduleAccess.erp,
  parameters: {
    type: 'object',
    properties: {
      busca: { type: 'string', description: 'Número/código da proposta (ex.: 4709), nome do cliente ou parte do título.' },
      status: { type: 'string', enum: ['RASCUNHO', 'ENVIADA', 'EM_NEGOCIACAO', 'APROVADA', 'CONVERTIDA_CONTRATO', 'RECUSADA'], description: 'Situação (opcional).' },
      limite: { type: 'integer', minimum: 1, maximum: 50, description: 'Máximo de linhas (padrão 20).' },
      de: { type: 'string', description: 'Criadas a partir de AAAA-MM-DD (opcional).' },
      ate: { type: 'string', description: 'Criadas até AAAA-MM-DD (opcional).' },
    },
    additionalProperties: false,
  },
  schema: propostasSchema,
  modulos: () => ['erp'],
  coagir: (a) => (a && 'limite' in a ? { ...a, limite: parseNumeroBR(a.limite) } : a),
  resumo: (a) => ({
    titulo: 'Consultar propostas',
    linhas: [
      ...(a.busca ? [`Busca: "${a.busca}"`] : []),
      ...(a.status ? [`Situação: ${statusProposta(a.status)}`] : []),
      ...(a.de || a.ate ? [`Criadas: ${a.de ? formatDateBr(a.de) : 'início'} a ${a.ate ? formatDateBr(a.ate) : 'hoje'}`] : []),
      `Máximo de linhas: ${a.limite || 20}`,
    ],
  }),
  async executar(a, api) {
    // Numero exato => a proposta completa com os itens.
    if (a.busca && (extractGcProposalNumber(refProposta(a.busca)) !== null || pareceIdProposta(a.busca))) {
      const loc = await localizarProposta(a.busca, api);
      if (loc.ok) {
        const p = loc.proposta;
        const itens: any[] = Array.isArray(p.items) ? p.items : [];
        return {
          ok: true,
          mensagem: `Proposta ${numeroProposta(p)} de ${cut(p.companyName, 60)}: ${statusProposta(p.status)}, ${resumoValorProposta(p)}, ${itens.length} ${itens.length === 1 ? 'item' : 'itens'}.${p.validUntil ? ` Validade ${formatProposalValidUntilPtBr(p.validUntil) || formatDateBr(p.validUntil)}.` : ''} Os links e o PDF estão nos botões abaixo.`,
          totais: [
            { rotulo: 'Número', valor: numeroProposta(p) },
            { rotulo: 'Cliente', valor: cut(p.companyName, 60) },
            { rotulo: 'Situação', valor: statusProposta(p.status) },
            ...(isAvulsoServiceProposal(p)
              ? [{ rotulo: 'Pagamento único', valor: formatBRL(totalPropostaRegistro(p)) }]
              : [
                  { rotulo: 'Mensal', valor: formatBRL(p.monthlyRecurringTotal) },
                  { rotulo: 'Valores únicos', valor: formatBRL(Number(p.oneTimeSetupTotal || 0) + Number(p.shippingCost || 0)) },
                  { rotulo: 'Total do contrato', valor: formatBRL(totalPropostaRegistro(p)) },
                ]),
          ],
          tabela: itens.length
            ? {
                colunas: ['Item', 'Descrição', 'Qtd', 'Unitário', 'Cobrança', 'Subtotal'],
                linhas: itens.slice(0, 60).map((i, idx) => [String(idx + 1), cut(i.description, 70), String(i.quantity ?? 1), formatBRL(i.unitPrice), cobrancaItem(i), formatBRL(i.subtotal ?? i.totalMonthly ?? Number(i.unitPrice || 0) * Number(i.quantity || 1))]),
              }
            : undefined,
          detalhes: detalhesProposta(p),
          acoes: acoesProposta(p),
          registro: { tipo: 'proposta', id: String(p.id || ''), codigo: p.code ? String(p.code) : undefined },
          resumoParaModelo: `Proposta ${numeroProposta(p)} encontrada: cliente ${cut(p.companyName, 60)}; situação ${statusProposta(p.status)}; total ${formatBRL(totalPropostaRegistro(p))}; ${isAvulsoServiceProposal(p) ? 'pagamento único; ' : `prazo ${Number(p.contractMonths || 0)} meses; `}${propostaDoGestaoClick(p) ? 'importada do ERP de origem; ' : ''}itens: ${resumoItens(p) || 'nenhum'}.`,
        };
      }
      if (loc.status !== 404) return { ok: false, status: loc.status, mensagem: loc.texto, resumoParaModelo: `Falhou: ${loc.texto}` };
    }
    const comPeriodo = Boolean(a.de || a.ate);
    // Com periodo, traz uma pagina maior (mais recentes primeiro) e filtra pela data de criacao.
    const qs = new URLSearchParams({ limit: String(comPeriodo ? 200 : a.limite || 20), offset: '0', status: a.status || 'TODOS', type: 'TODOS' });
    if (a.busca) qs.set('q', refProposta(a.busca) || a.busca);
    const res = await api({ method: 'GET', path: `/api/erp/proposals?${qs.toString()}` });
    if (res.status < 200 || res.status >= 300) return apiError(res, 'consultar as propostas');
    let rows: any[] = Array.isArray(res.body?.data) ? res.body.data : [];
    // Fonte em memoria (sem busca no servidor): aplica o mesmo filtro tolerante aqui.
    if (a.busca) rows = rows.filter((p) => mesmaProposta(p, a.busca!) || buscaCombina(refProposta(a.busca!), [p.code, numeroProposta(p), p.title, p.companyName, p.companyCnpj, p.sellerName]));
    if (a.status) rows = rows.filter((p) => String(p.status || '') === a.status);
    if (comPeriodo) {
      rows = rows.filter((p) => {
        const d = toIsoDate(p.createdAt);
        return !!d && (!a.de || d >= a.de) && (!a.ate || d <= a.ate);
      });
    }
    // Nada na lista de Orcamentos: amplia para a busca universal antes de dizer "nada encontrado".
    if (!rows.length && a.busca && !a.status && !comPeriodo) return buscaUniversal({ termo: a.busca }, api);
    const total = comPeriodo ? rows.length : Math.max(rows.length, Number(res.body?.total) || 0);
    const shown = rows.slice(0, a.limite || 20);
    return {
      ok: true,
      mensagem: shown.length ? `${total} propostas encontradas${total > shown.length ? `, mostrando ${shown.length}` : ''}.` : 'Nenhuma proposta encontrada com esses filtros. Tente outro período ou situação, o nome do cliente (pode ser parte, sem acento) ou o CNPJ.',
      tabela: shown.length
        ? { colunas: ['Número', 'Cliente', 'Situação', 'Total', 'Itens'], linhas: shown.map((p) => [cut(numeroProposta(p), 20), cut(p.companyName, 50), statusProposta(p.status), formatBRL(totalPropostaRegistro(p)), String(Array.isArray(p.items) ? p.items.length : '-')]) }
        : undefined,
      resumoParaModelo: `Consulta de propostas: ${total} encontradas${shown.length ? `: ${shown.slice(0, 5).map((p) => `${numeroProposta(p)} — ${cut(p.companyName, 50)} — ${statusProposta(p.status)} — ${formatBRL(totalPropostaRegistro(p))}`).join('; ')}` : ''}.`,
    };
  },
};

// ---------------------------------------------------------------------------
// editar_proposta: acrescenta itens/despesas, altera quantidade/valor e campos da tela
// ---------------------------------------------------------------------------
const novoItemSchema = z
  .object({
    descricao: shortText(200),
    quantidade: z.number().positive().max(100000).optional(),
    valor_unitario: z.number().min(0).max(100_000_000),
    tipo: z.enum(['locacao', 'servico', 'produto', 'despesa']).optional(),
    cobranca: z.enum(['mensal', 'unica']).optional(),
  })
  .strict();
const alterarItemSchema = z
  .object({
    item: z.number().int().min(1).max(500),
    descricao: z.string().trim().min(1).max(200).optional(),
    quantidade: z.number().positive().max(100000).optional(),
    valor_unitario: z.number().min(0).max(100_000_000).optional(),
  })
  .strict();
const alvoSchema = z
  .object({
    id: z.string().min(1).max(120),
    code: z.string().max(60),
    updatedAt: z.string().max(60),
    linhas: z.array(z.string().max(300)).max(60),
  })
  .strict();
const editarPropostaSchema = z
  .object({
    proposta: shortText(60),
    adicionar_itens: z.array(novoItemSchema).max(20).optional(),
    alterar_itens: z.array(alterarItemSchema).max(30).optional(),
    titulo: z.string().trim().min(1).max(160).optional(),
    prazo_meses: z.number().int().min(1).max(120).optional(),
    validade: isoDate.optional(),
    condicao_pagamento: z.string().trim().min(1).max(200).optional(),
    frete: z.number().min(0).max(10_000_000).optional(),
    observacoes_comerciais: z.string().trim().max(2000).optional(),
    /** Preenchido SO pelo servidor no preparo (id, codigo e versao exatos do cartao). */
    alvo: alvoSchema.optional(),
  })
  .strict();
type EditarPropostaArgs = z.infer<typeof editarPropostaSchema>;

const NATUREZA_ITEM: Record<string, string> = { ...NATUREZA, despesa: 'SERVICO_TECNICO_TI_TELECOM' };

/** Aplica as mudancas pedidas a uma copia da proposta. Deterministico (preparo e execucao). */
export function aplicarEdicaoProposta(p: any, a: EditarPropostaArgs, stamp: string): { ok: true; patch: Record<string, unknown>; mudancas: string[]; depois: any } | { ok: false; texto: string } {
  const itens: any[] = (Array.isArray(p?.items) ? p.items : []).map((i: any) => ({ ...i }));
  const mudancas: string[] = [];
  for (const alt of a.alterar_itens || []) {
    const it = itens[alt.item - 1];
    if (!it) return { ok: false, texto: `A proposta ${numeroProposta(p)} não tem o item ${alt.item} (tem ${itens.length}).` };
    const antes = `${cut(it.description, 50)} x${Number(it.quantity || 1)} a ${formatBRL(it.unitPrice)}`;
    if (alt.descricao) it.description = alt.descricao;
    if (alt.quantidade !== undefined) it.quantity = alt.quantidade;
    if (alt.valor_unitario !== undefined) it.unitPrice = alt.valor_unitario;
    delete it.subtotal;
    mudancas.push(`Alterar item ${alt.item}: ${antes} → ${cut(it.description, 50)} x${Number(it.quantity || 1)} a ${formatBRL(it.unitPrice)}`);
  }
  (a.adicionar_itens || []).forEach((n, idx) => {
    const tipo = n.tipo || 'despesa';
    const unica = n.cobranca ? n.cobranca === 'unica' : tipo === 'despesa' || tipo === 'produto';
    const qtd = n.quantidade ?? 1;
    itens.push({
      id: `pi-${stamp}-${idx + 1}`,
      sku: '',
      description: n.descricao,
      itemType: tipo === 'produto' || tipo === 'locacao' ? 'PRODUCT' : 'SERVICE',
      fiscalNature: NATUREZA_ITEM[tipo],
      ncmOrServiceCode: '',
      quantity: qtd,
      unitPrice: n.valor_unitario,
      discountPercent: 0,
      isRecurring: !unica,
      totalMonthly: Math.round(qtd * n.valor_unitario * 100) / 100,
    });
    mudancas.push(`Adicionar: ${cut(n.descricao, 60)} x${qtd} a ${formatBRL(n.valor_unitario)} (${unica ? 'cobrança única' : 'mensal'})`);
  });
  const patch: Record<string, unknown> = {};
  if (a.adicionar_itens?.length || a.alterar_itens?.length) patch.items = itens;
  const campo = (rot: string, de: unknown, para: unknown) => mudancas.push(`${rot}: ${cut(de ?? '-', 60) || '-'} → ${cut(para, 60)}`);
  if (a.titulo !== undefined) { campo('Título', p.title, a.titulo); patch.title = a.titulo; }
  if (a.prazo_meses !== undefined) { campo('Prazo (meses)', p.contractMonths, a.prazo_meses); patch.contractMonths = a.prazo_meses; }
  if (a.validade !== undefined) { campo('Validade', p.validUntil, a.validade); patch.validUntil = a.validade; }
  if (a.condicao_pagamento !== undefined) { campo('Condição de pagamento', p.paymentCondition, a.condicao_pagamento); patch.paymentCondition = a.condicao_pagamento; }
  if (a.frete !== undefined) { campo('Frete', formatBRL(p.shippingCost || 0), formatBRL(a.frete)); patch.shippingCost = a.frete; }
  if (a.observacoes_comerciais !== undefined) { campo('Observações comerciais', p.commercialNotes, a.observacoes_comerciais); patch.commercialNotes = a.observacoes_comerciais; }
  if (!mudancas.length) return { ok: false, texto: 'Diga o que mudar na proposta (item, quantidade, valor ou outro campo).' };
  // O tipo do orcamento (locacao/produtos/...) nao muda por acrescentar uma despesa: fixa o
  // tipo atual para a previa usar a mesma regra de total da tela.
  const tipoAtual = p?.budgetType || computeProposalTotals({ ...p, items: (p?.items || []).map((i: any) => ({ ...i })) } as ErpCommercialProposal).budgetType;
  const depois = computeProposalTotals({ ...p, ...patch, items: itens, budgetType: tipoAtual } as ErpCommercialProposal);
  return { ok: true, patch, mudancas, depois };
}

function bloqueioEdicao(p: any): string | null {
  const n = numeroProposta(p);
  if ((PROPOSTA_STATUS_BLOQUEADOS as readonly string[]).includes(String(p?.status || '')) || p?.convertedContractId || p?.convertedInvoiceId) {
    return `A proposta ${n} está ${statusProposta(p?.status).toLowerCase()} e não pode ser editada pelo assistente. Para mudar, use a tela de Orçamentos (as regras de aprovação continuam valendo).`;
  }
  // Propostas do GestaoClick: editaveis SO no STI-hub (decisao do Marcello, 19/11/2026). Nao ha
  // sincronizacao de volta, e o sync diario so insere orcamentos novos (nao sobrescreve este).
  return null;
}

export const AVISO_PROPOSTA_GESTAOCLICK = 'Atenção: proposta importada do ERP de origem. A alteração fica só no STI HUB ERP e não vai para o sistema de origem.';

const totaisLinha = (rot: string, t: any) =>
  isAvulsoServiceProposal(t || {})
    ? `${rot}: pagamento único ${formatBRL(t?.totalContractValue || t?.monthlyRecurringTotal)}`
    : `${rot}: mensal ${formatBRL(t?.monthlyRecurringTotal)}, único ${formatBRL(Number(t?.oneTimeSetupTotal || 0) + Number(t?.shippingCost || 0))}, contrato ${formatBRL(t?.totalContractValue)}`;

const editarProposta: AssistenteTool<EditarPropostaArgs> = {
  name: 'editar_proposta',
  descricao:
    'Edita um orçamento/proposta existente pelo número (ex.: 4709): acrescenta item ou despesa (ex.: locomoção e hospedagem R$ 2.800,00), altera descrição, quantidade ou valor de um item (pela posição) e campos como título, prazo, validade, condição de pagamento, frete e observações. Valores em reais como número (2800.00).',
  tipo: 'gravacao',
  rotas: ['GET /api/erp/proposals', 'GET /api/erp/proposals/:id', 'PATCH /api/erp/proposals/:id'],
  disponivel: (u) => u.moduleAccess.erp,
  parameters: {
    type: 'object',
    properties: {
      proposta: { type: 'string', description: 'Número/código da proposta, ex.: "4709".' },
      adicionar_itens: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          properties: {
            descricao: { type: 'string' },
            quantidade: { type: 'number', description: 'Padrão 1.' },
            valor_unitario: { type: 'number', description: 'Valor unitário em reais, ex.: 2800.00.' },
            tipo: { type: 'string', enum: ['locacao', 'servico', 'produto', 'despesa'], description: 'Padrão despesa.' },
            cobranca: { type: 'string', enum: ['mensal', 'unica'], description: 'Despesa e produto: padrão única.' },
          },
          required: ['descricao', 'valor_unitario'],
          additionalProperties: false,
        },
      },
      alterar_itens: {
        type: 'array',
        maxItems: 30,
        items: {
          type: 'object',
          properties: {
            item: { type: 'integer', minimum: 1, description: 'Posição do item na proposta (1 = primeiro).' },
            descricao: { type: 'string' },
            quantidade: { type: 'number' },
            valor_unitario: { type: 'number' },
          },
          required: ['item'],
          additionalProperties: false,
        },
      },
      titulo: { type: 'string' },
      prazo_meses: { type: 'integer', minimum: 1, maximum: 120 },
      validade: { type: 'string', description: 'AAAA-MM-DD' },
      condicao_pagamento: { type: 'string' },
      frete: { type: 'number' },
      observacoes_comerciais: { type: 'string' },
    },
    required: ['proposta'],
    additionalProperties: false,
  },
  schema: editarPropostaSchema,
  modulos: () => ['erp'],
  coagir(a) {
    if (!a || typeof a !== 'object') return a;
    const out: any = { ...a };
    delete out.alvo; // so o servidor preenche
    if (typeof out.proposta === 'number') out.proposta = String(out.proposta);
    for (const k of ['prazo_meses', 'frete']) if (k in out) out[k] = parseNumeroBR(out[k]);
    if (Array.isArray(out.adicionar_itens)) out.adicionar_itens = out.adicionar_itens.map((i: any) => (i && typeof i === 'object' ? { ...i, quantidade: i.quantidade === undefined ? undefined : parseNumeroBR(i.quantidade), valor_unitario: parseNumeroBR(i.valor_unitario) } : i));
    if (Array.isArray(out.alterar_itens)) out.alterar_itens = out.alterar_itens.map((i: any) => (i && typeof i === 'object' ? { ...i, item: parseNumeroBR(i.item), ...(i.quantidade !== undefined ? { quantidade: parseNumeroBR(i.quantidade) } : {}), ...(i.valor_unitario !== undefined ? { valor_unitario: parseNumeroBR(i.valor_unitario) } : {}) } : i));
    return out;
  },
  async preparar(a, api) {
    const loc = await localizarProposta(a.proposta, api);
    if (!loc.ok) return { ok: false, texto: loc.texto };
    const p = loc.proposta;
    const bloqueio = bloqueioEdicao(p);
    if (bloqueio) return { ok: false, texto: bloqueio };
    const ed = aplicarEdicaoProposta(p, { ...a, alvo: undefined }, 'previa');
    if (!ed.ok) return { ok: false, texto: ed.texto };
    const linhas = [
      `Proposta: ${numeroProposta(p)}`,
      `Cliente: ${cut(p.companyName, 70)}${p.companyCnpj ? ` — CNPJ ${cut(p.companyCnpj, 20)}` : ''}`,
      `Situação: ${statusProposta(p.status)}`,
      ...(propostaDoGestaoClick(p) ? [AVISO_PROPOSTA_GESTAOCLICK] : []),
      ...ed.mudancas,
      totaisLinha('Antes', computeProposalTotals({ ...p, items: (p.items || []).map((i: any) => ({ ...i })) } as ErpCommercialProposal)),
      totaisLinha('Depois', ed.depois),
    ];
    return { ok: true, args: { ...a, proposta: numeroProposta(p), alvo: { id: String(p.id), code: String(p.code || ''), updatedAt: String(p.updatedAt || ''), linhas } } };
  },
  resumo: (a) => ({
    titulo: `Editar a proposta ${a.alvo?.code ? formatProposalDisplayCode(a.alvo.code) : a.proposta}`,
    linhas: a.alvo?.linhas?.length ? a.alvo.linhas : [`Proposta: ${a.proposta}`],
  }),
  async executar(a, api) {
    if (!a.alvo) return { ok: false, status: 400, mensagem: 'Ação sem a proposta identificada. Peça de novo ao assistente.', resumoParaModelo: 'Falhou: proposta não identificada.' };
    // Trava: grava SO na proposta exata do cartao (id + codigo + versao).
    const res = await api({ method: 'GET', path: `/api/erp/proposals/${encodeURIComponent(a.alvo.id)}` });
    if (res.status < 200 || res.status >= 300 || !res.body?.data) return apiError(res, 'abrir a proposta');
    const p = res.body.data;
    if (String(p.id) !== a.alvo.id || String(p.code || '') !== a.alvo.code) {
      return { ok: false, status: 409, mensagem: 'A proposta encontrada não é a mesma do cartão. Nada foi gravado.', resumoParaModelo: 'Falhou: proposta diferente da do cartão.' };
    }
    if (String(p.updatedAt || '') !== a.alvo.updatedAt) {
      return { ok: false, status: 409, mensagem: `A proposta ${numeroProposta(p)} foi alterada depois que o cartão foi montado. Nada foi gravado; peça de novo para ver os valores atuais.`, resumoParaModelo: 'Falhou: a proposta mudou depois do cartão.' };
    }
    const bloqueio = bloqueioEdicao(p);
    if (bloqueio) return { ok: false, status: 409, mensagem: bloqueio, resumoParaModelo: 'Falhou: edição bloqueada.' };
    const ed = aplicarEdicaoProposta(p, a, String(Date.now()));
    if (!ed.ok) return { ok: false, status: 400, mensagem: ed.texto, resumoParaModelo: `Falhou: ${ed.texto}` };
    const put = await api({ method: 'PATCH', path: `/api/erp/proposals/${encodeURIComponent(a.alvo.id)}`, body: { ...ed.patch, expectedUpdatedAt: a.alvo.updatedAt } });
    if (put.status < 200 || put.status >= 300) return apiError(put, 'gravar a proposta');
    const d = put.body?.data || {};
    return {
      ok: true,
      mensagem: `Proposta ${numeroProposta(p)} atualizada. Total do contrato: ${formatBRL(d.totalContractValue ?? ed.depois.totalContractValue)}. Nada foi enviado ao cliente.${propostaDoGestaoClick(p) ? ' A alteração ficou só no STI HUB ERP; o sistema de origem não foi alterado.' : ''}`,
      registro: { tipo: 'proposta', id: String(p.id), codigo: String(p.code || '') },
      resumoParaModelo: `Proposta ${numeroProposta(p)} atualizada (${ed.mudancas.length} mudanças). Não repita a edição.`,
    };
  },
};

// ---------------------------------------------------------------------------
// buscar: busca universal por qualquer identificador (com fallback amplo)
// ---------------------------------------------------------------------------
type TipoAchado = 'Orçamento' | 'Contrato' | 'Fatura' | 'Nota fiscal' | 'OS' | 'Chamado' | 'Cliente' | 'Contato' | 'Fornecedor' | 'Produto' | 'Venda';
interface Achado {
  tipo: TipoAchado;
  numero: string;
  descricao: string;
  situacao: string;
  valor: string;
  data: string;
  chave: string;
  bruto: any;
}

const PROPOSTA_LIST_QS = (q: string, limit = 20) => new URLSearchParams({ q, limit: String(limit), offset: '0', status: 'TODOS', type: 'TODOS' }).toString();

/** Leitor com cache por caminho e registro dos modulos negados (RBAC da propria rota). */
function criarLeitor(api: ApiCaller) {
  const cache = new Map<string, Promise<ApiCallResponse>>();
  const negados = new Set<string>();
  const falhas = new Set<string>();
  const get = (path: string): Promise<ApiCallResponse> => {
    let p = cache.get(path);
    if (!p) {
      p = api({ method: 'GET', path }).catch(() => ({ status: 500, body: null }));
      cache.set(path, p);
    }
    return p;
  };
  const lista = async (path: string, rotulo: string, pick: (b: any) => unknown = (b) => b?.data): Promise<any[]> => {
    const res = await get(path);
    if (res.status === 401 || res.status === 403) {
      negados.add(rotulo);
      return [];
    }
    if (res.status < 200 || res.status >= 300) {
      if (res.status !== 404) falhas.add(rotulo);
      return [];
    }
    const v = pick(res.body);
    return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [];
  };
  return { get, lista, negados, falhas };
}
type Leitor = ReturnType<typeof criarLeitor>;

const semZeros = (v: unknown) => compact(v).replace(/^0+(?=\d)/, '');
const igualCodigo = (a: unknown, b: unknown) => {
  const x = semZeros(a);
  return !!x && x === semZeros(b);
};
/** "LOC-2026-101" casa com "101" (ultimo bloco) e com o codigo inteiro. */
const casaNumero = (codigo: unknown, n: string) => {
  const c = String(codigo ?? '').trim();
  if (!c) return false;
  if (igualCodigo(c, n)) return true;
  const blocos = c.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return blocos.length > 1 && semZeros(blocos[blocos.length - 1]) === semZeros(n);
};
const ultimos = (v: unknown, n: number) => soDigitos(v).slice(-n);

function achadoProposta(p: any): Achado {
  const avulso = isAvulsoServiceProposal(p);
  const mensal = Number(p?.monthlyRecurringTotal || 0);
  return {
    tipo: 'Orçamento',
    numero: numeroProposta(p),
    descricao: cut(p?.companyName || p?.title, 60),
    situacao: statusProposta(p?.status),
    valor: avulso || !mensal ? formatBRL(totalPropostaRegistro(p)) : `${formatBRL(mensal)}/mês`,
    data: formatDateBr(p?.createdAt),
    chave: `proposta:${p?.id}`,
    bruto: p,
  };
}
const achadoContrato = (c: any): Achado => ({
  tipo: 'Contrato',
  numero: cut(c.contractNumber || c.gestaoClickCode, 24),
  descricao: cut(c.companyName || c.title, 60),
  situacao: statusLabel(c.status),
  valor: `${formatBRL(c.monthlyValue)}/mês`,
  data: `${formatDateBr(c.startDate)} a ${formatDateBr(c.endDate)}`,
  chave: `contrato:${c.id}`,
  bruto: c,
});
const achadoFatura = (f: any): Achado => ({
  tipo: ehNotaFiscal(f) ? 'Nota fiscal' : 'Fatura',
  numero: cut(f.documentNumber, 24),
  descricao: `${cut(f.companyName, 50)}${ehNotaFiscal(f) ? ` (${tipoDocumentoFiscal(f.documentType)})` : ''}`,
  situacao: statusLabel(statusFatura(f)),
  valor: formatBRL(f.grossAmount),
  data: `venc. ${formatDateBr(f.dueDate)}`,
  chave: `fatura:${f.id}`,
  bruto: f,
});
const achadoOs = (o: any): Achado => ({
  tipo: 'OS',
  numero: cut(o.code, 20),
  descricao: cut(`${o.companyName || ''}${o.description ? ` — ${o.description}` : ''}`, 60),
  situacao: statusLabel(o.status),
  valor: formatBRL(o.totalAmount),
  data: formatDateBr(o.entryDate),
  chave: `os:${o.id}`,
  bruto: o,
});
const achadoChamado = (t: any): Achado => ({
  tipo: 'Chamado',
  numero: cut(t.key, 20),
  descricao: cut(`${t.subject || ''}${t.company?.name ? ` — ${t.company.name}` : ''}`, 60),
  situacao: statusChamado(t.status),
  valor: '-',
  data: formatDateBr(t.createdAt),
  chave: `chamado:${t.id}`,
  bruto: t,
});
const achadoEmpresa = (c: any): Achado => ({
  tipo: 'Cliente',
  numero: cut(c.cnpj ? formatarCnpj(c.cnpj) : '-', 20),
  descricao: cut(c.name || c.legalName, 60),
  situacao: cut([c.city, c.state].filter(Boolean).join('/') || '-', 30),
  valor: '-',
  data: formatDateBr(c.createdAt),
  chave: `empresa:${c.id}`,
  bruto: c,
});
const achadoContato = (c: any): Achado => ({
  tipo: 'Contato',
  numero: cut(c.email, 40),
  descricao: cut(`${c.firstName || ''} ${c.lastName || ''}${c.companyName || c.company?.name ? ` — ${c.companyName || c.company?.name}` : ''}`, 60),
  situacao: cut(c.jobTitle, 30),
  valor: '-',
  data: formatDateBr(c.createdAt),
  chave: `contato:${c.id}`,
  bruto: c,
});
const achadoFornecedor = (f: any): Achado => ({
  tipo: 'Fornecedor',
  numero: cut(f.cnpj || '-', 20),
  descricao: cut(f.name || f.legalName, 60),
  situacao: f.active === false ? 'Inativo' : 'Ativo',
  valor: '-',
  data: '-',
  chave: `fornecedor:${f.id}`,
  bruto: f,
});
const achadoProduto = (p: any): Achado => ({
  tipo: 'Produto',
  numero: cut(p.gestaoClickCode || '-', 16),
  descricao: cut(p.name, 60),
  situacao: statusEstoque(p),
  valor: Number(p.monthlyRentalPrice) ? `${formatBRL(p.monthlyRentalPrice)}/mês` : formatBRL(p.saleOrSetupPrice),
  data: `estoque ${Number(p.stockAvailable || 0)}`,
  chave: `produto:${p.id}`,
  bruto: p,
});
const achadoVenda = (v: any): Achado => ({
  tipo: 'Venda',
  numero: cut(v.code, 20),
  descricao: cut(v.companyName, 60),
  situacao: statusLabel(v.status),
  valor: formatBRL(v.totalAmount),
  data: formatDateBr(v.date),
  chave: `venda:${v.id || v.code}`,
  bruto: v,
});

const overviewPick = (k: string) => (b: any) => b?.data?.[k];

async function propostaPorId(id: string, L: Leitor): Promise<any | null> {
  const res = await L.get(`/api/erp/proposals/${encodeURIComponent(id)}`);
  if (res.status === 401 || res.status === 403) {
    L.negados.add('Orçamentos');
    return null;
  }
  if (res.status >= 200 && res.status < 300 && res.body?.data && !Array.isArray(res.body.data)) return res.body.data;
  // Fallback: a lista da tela tambem acha pelo id (linhas novas) ou pelo codigo.
  const list = await L.lista(`/api/erp/proposals?${PROPOSTA_LIST_QS(id)}`, 'Orçamentos');
  return list.find((p) => String(p.id).toLowerCase() === id.toLowerCase()) || null;
}

async function resolverIdentificador(id: Identificador, L: Leitor): Promise<Achado[]> {
  const out: Achado[] = [];
  const v = id.valor;
  const propostasQ = (q: string) => L.lista(`/api/erp/proposals?${PROPOSTA_LIST_QS(q)}`, 'Orçamentos');
  const contratos = () => L.lista('/api/erp/contracts', 'Contratos');
  const faturas = () => L.lista('/api/erp/invoices', 'Faturas e notas');
  const ordens = () => L.lista('/api/erp/overview', 'Ordens de serviço', overviewPick('serviceOrders'));
  const fornecedores = () => L.lista('/api/erp/overview', 'Fornecedores', overviewPick('suppliers'));
  const vendas = () => L.lista('/api/erp/overview', 'Vendas', overviewPick('salesOrders'));
  const chamados = (q: string) => L.lista(`/api/tickets?${new URLSearchParams({ search: q, limit: '50' }).toString()}`, 'Chamados');
  const empresas = (q?: string) => L.lista(q ? `/api/companies?search=${encodeURIComponent(q)}&limit=20` : '/api/companies', 'Clientes');
  const contatos = () => L.lista('/api/contacts', 'Contatos');
  switch (id.tipo) {
    case 'link_proposta':
    case 'id_proposta': {
      if (id.link?.area === 'curto') break;
      const p = await propostaPorId(v, L);
      if (p) out.push(achadoProposta(p));
      break;
    }
    case 'proposta': {
      const n = extractGcProposalNumber(v);
      for (const p of await propostasQ(v)) if (n !== null ? extractGcProposalNumber(p.code) === n : igualCodigo(p.code, v)) out.push(achadoProposta(p));
      break;
    }
    case 'contrato':
      for (const c of await contratos()) {
        if ([c.contractNumber, c.gestaoClickCode, c.externalContractNumber, c.proposalNumber].some((x) => igualCodigo(x, v) || casaNumero(x, v))) out.push(achadoContrato(c));
      }
      break;
    case 'fatura':
    case 'nota':
      for (const f of await faturas()) {
        if (id.tipo === 'nota' && !ehNotaFiscal(f) && !igualCodigo(f.documentNumber, v)) continue;
        if (igualCodigo(f.documentNumber, v) || casaNumero(f.documentNumber, v) || semZeros(soDigitos(f.documentNumber)) === semZeros(soDigitos(v))) out.push(achadoFatura(f));
      }
      break;
    case 'chave_nfe':
      for (const f of await faturas()) if (soDigitos(f.verificationCodeOrKey) === v || soDigitos(f.importMetadata?.accessKey) === v) out.push(achadoFatura(f));
      break;
    case 'os':
      for (const o of await ordens()) if (igualCodigo(o.code, v) || casaNumero(o.code, v)) out.push(achadoOs(o));
      break;
    case 'chamado': {
      const up = v.toUpperCase();
      for (const t of await chamados(v)) {
        const keys = [t.key, t.legacyKey, t.jiraKey].map((k) => String(k || '').toUpperCase());
        if (keys.includes(up) || (/^\d+$/.test(up) && keys.some((k) => k.endsWith(`-${up}`)))) out.push(achadoChamado(t));
      }
      break;
    }
    case 'cnpj':
    case 'cpf': {
      for (const c of await empresas(v)) if (soDigitos(c.cnpj) === v || soDigitos(c.cpf) === v) out.push(achadoEmpresa(c));
      if (!out.length) for (const c of await empresas()) if (soDigitos(c.cnpj) === v || soDigitos(c.cpf) === v) out.push(achadoEmpresa(c));
      for (const f of await fornecedores()) if (soDigitos(f.cnpj) === v) out.push(achadoFornecedor(f));
      for (const p of await propostasQ(v)) if (soDigitos(p.companyCnpj) === v) out.push(achadoProposta(p));
      for (const c of await contratos()) if (soDigitos(c.companyCnpj) === v) out.push(achadoContrato(c));
      for (const f of await faturas()) if (soDigitos(f.companyCnpj) === v) out.push(achadoFatura(f));
      break;
    }
    case 'email': {
      const e = v.toLowerCase();
      for (const c of await contatos()) if (String(c.email || '').toLowerCase() === e) out.push(achadoContato(c));
      for (const c of await empresas(e)) if (String(c.email || '').toLowerCase() === e) out.push(achadoEmpresa(c));
      for (const f of await fornecedores()) if (String(f.email || '').toLowerCase() === e) out.push(achadoFornecedor(f));
      for (const t of await chamados(e)) if (String(t.requesterEmail || '').toLowerCase() === e) out.push(achadoChamado(t));
      if (!out.length) {
        // Dominio do e-mail => empresa pelo dominio do site.
        const dom = e.split('@')[1] || '';
        if (dom && !/^(gmail|hotmail|outlook|yahoo|uol|bol|live|icloud)\./.test(dom)) for (const c of await empresas(dom)) if (String(c.domain || '').toLowerCase().includes(dom)) out.push(achadoEmpresa(c));
      }
      break;
    }
    case 'telefone': {
      const fim = v.slice(-8);
      const casa = (...xs: unknown[]) => xs.some((x) => ultimos(x, 8) === fim);
      for (const c of await contatos()) if (casa(c.phone, c.mobilePhone, c.whatsapp)) out.push(achadoContato(c));
      for (const c of await empresas()) if (casa(c.phone)) out.push(achadoEmpresa(c));
      for (const f of await fornecedores()) if (casa(f.phone)) out.push(achadoFornecedor(f));
      break;
    }
    case 'codigo':
    case 'numero': {
      const n = extractGcProposalNumber(v);
      if (n !== null) for (const p of await propostasQ(v)) if (extractGcProposalNumber(p.code) === n) out.push(achadoProposta(p));
      if (id.tipo === 'codigo') for (const p of await propostasQ(v)) if (igualCodigo(p.code, v)) out.push(achadoProposta(p));
      for (const c of await contratos()) if ([c.contractNumber, c.gestaoClickCode, c.externalContractNumber].some((x) => igualCodigo(x, v) || (id.tipo === 'numero' && casaNumero(x, v)))) out.push(achadoContrato(c));
      for (const f of await faturas()) if (igualCodigo(f.documentNumber, v) || (id.tipo === 'numero' && casaNumero(f.documentNumber, v))) out.push(achadoFatura(f));
      for (const o of await ordens()) if (igualCodigo(o.code, v)) out.push(achadoOs(o));
      for (const s of await vendas()) if (igualCodigo(s.code, v)) out.push(achadoVenda(s));
      const up = v.toUpperCase();
      for (const t of await chamados(v)) {
        const keys = [t.key, t.legacyKey, t.jiraKey].map((k) => String(k || '').toUpperCase());
        if (keys.includes(up) || (id.tipo === 'numero' && keys.some((k) => k.endsWith(`-${up}`)))) out.push(achadoChamado(t));
      }
      for (const p of await L.lista('/api/erp/catalog', 'Produtos')) if (igualCodigo(p.gestaoClickCode, v) || igualCodigo(p.barcodeEan, v)) out.push(achadoProduto(p));
      break;
    }
  }
  return out;
}

/** Busca por nome/texto livre (parcial, sem acento) em todos os cadastros e documentos. */
async function buscarTexto(termo: string, L: Leitor): Promise<Achado[]> {
  const out: Achado[] = [];
  const combina = (...xs: unknown[]) => buscaCombina(termo, xs);
  const emp = await L.lista(`/api/companies?search=${encodeURIComponent(termo)}&limit=20`, 'Clientes');
  let empresas = emp.filter((c) => combina(c.name, c.tradeName, c.legalName, c.domain));
  if (!empresas.length) empresas = (await L.lista('/api/companies', 'Clientes')).filter((c) => combina(c.name, c.tradeName, c.legalName, c.domain));
  out.push(...empresas.slice(0, 10).map(achadoEmpresa));
  // A lista de Orcamentos busca por trecho exato: tenta o termo, o nome da empresa achada e a palavra mais longa.
  const qsProp = [termo, ...empresas.slice(0, 2).map((c) => String(c.name || '')), [...termo.split(/\s+/)].sort((x, y) => y.length - x.length)[0] || ''].filter((x, i, arr) => x && x.length >= 3 && arr.indexOf(x) === i);
  const propostas: any[] = [];
  for (const q of qsProp.slice(0, 3)) {
    const achadas = (await L.lista(`/api/erp/proposals?${PROPOSTA_LIST_QS(q, 10)}`, 'Orçamentos')).filter((p) => combina(p.code, p.title, p.companyName, p.companyCnpj, p.sellerName, p.contactName));
    propostas.push(...achadas);
    if (propostas.length) break;
  }
  out.push(...propostas.slice(0, 10).map(achadoProposta));
  out.push(...(await L.lista('/api/erp/contracts', 'Contratos')).filter((c) => combina(c.contractNumber, c.title, c.companyName)).slice(0, 10).map(achadoContrato));
  out.push(...(await L.lista('/api/erp/invoices', 'Faturas e notas')).filter((f) => combina(f.documentNumber, f.companyName)).slice(0, 10).map(achadoFatura));
  out.push(...(await L.lista('/api/erp/overview', 'Ordens de serviço', overviewPick('serviceOrders'))).filter((o) => combina(o.code, o.companyName, o.description, o.equipmentName)).slice(0, 10).map(achadoOs));
  out.push(...(await L.lista('/api/erp/overview', 'Fornecedores', overviewPick('suppliers'))).filter((f) => combina(f.name, f.legalName)).slice(0, 10).map(achadoFornecedor));
  out.push(...(await L.lista('/api/erp/catalog', 'Produtos')).filter((p) => combina(p.name, p.brand, p.modelName, p.gestaoClickCode)).slice(0, 10).map(achadoProduto));
  out.push(...(await L.lista('/api/contacts', 'Contatos')).filter((c) => combina(c.firstName, c.lastName, `${c.firstName || ''} ${c.lastName || ''}`, c.email)).slice(0, 10).map(achadoContato));
  out.push(...(await L.lista(`/api/tickets?${new URLSearchParams({ search: termo, limit: '20' }).toString()}`, 'Chamados')).filter((t) => combina(t.key, t.subject, t.company?.name, t.requesterName)).slice(0, 10).map(achadoChamado));
  return out;
}

const PALAVRAS_TIPO = /\b(proposta|propostas|orcamento|orcamentos|contrato|contratos|fatura|faturas|nota|notas|fiscal|os|chamado|chamados|cliente|clientes|empresa|empresas|fornecedor|fornecedores|produto|produtos|cnpj|cpf|telefone|email|e-mail|numero|codigo|link|comercial|do|da|de|o|a)\b/g;

/** Texto livre que sobra do termo (sem identificadores e palavras de tipo). */
function textoLivre(termo: string, ids: Identificador[]): string {
  let t = String(termo || '');
  t = t.replace(/https?:\/\/\S+/g, ' ').replace(/\/(?:interno\/)?proposta\/\S+/g, ' ').replace(/\/p\/\S+/g, ' ');
  for (const i of ids) t = t.split(i.valor).join(' ');
  t = foldTexto(t).replace(/[#:;,.!?()\[\]"]/g, ' ').replace(PALAVRAS_TIPO, ' ').replace(/\s+/g, ' ').trim();
  return t.length >= 3 ? t : '';
}

/** Explicacao para o "nao abre / nao localizada" de uma proposta encontrada. */
function diagnosticoProposta(p: any, link: Identificador | undefined, a: { contexto?: string; link_com_assinatura?: boolean }): string[] {
  const out: string[] = [];
  const num = numeroProposta(p);
  if (link?.link?.area === 'interno') {
    out.push(`A Versão contrato (/interno/proposta/...) só abre para quem está logado no STI-hub com acesso ao ERP e à proposta. Abra pela lista de Orçamentos (busque ${num}) e use o botão "Versão contrato".`);
  } else if (a.link_com_assinatura || link?.link?.comToken) {
    out.push('O link tinha a assinatura do cliente. Se mesmo assim não abre, a assinatura venceu (validade da proposta) ou foi trocada: gere um novo em "Copiar link do cliente" na lista de Orçamentos.');
  } else if (a.contexto === 'nao_abre' || link) {
    out.push(`Por que não abre: o endereço /proposta/${cut(p.id, 60)} colado sem a assinatura do cliente (o trecho #t=... do link) não abre, por segurança (a página mostra "Link inválido ou sem permissão"). Para abrir, use o botão "Copiar link do cliente" abaixo (gera o link assinado, com a sua permissão) ou o mesmo botão na lista de Orçamentos (busque ${num}).`);
  }
  if (p.validUntil && isProposalValidityExpired(p.validUntil) && !['APROVADA', 'CONVERTIDA_CONTRATO', 'RECUSADA'].includes(String(p.status))) {
    out.push(`A validade venceu em ${formatProposalValidUntilPtBr(p.validUntil)}: a proposta abre com o aviso de revalidação; atualize a validade para o cliente aceitar.`);
  }
  if (propostaDoGestaoClick(p)) out.push('Foi importada do ERP de origem (a sincronização é só de lá para o STI HUB ERP).');
  return out;
}

// ---------------------------------------------------------------------------
// Ficha completa e acoes do registro encontrado (pedido do Marcéllo, 24/11/2026:
// "sempre trazer as informações na forma mais completa possível, junto com links e
// opções para copiar PDFs"). So leitura: nada aqui grava. O link do cliente nao sai
// daqui (seria token): o chat pede ao servidor no clique, com a sessao e o RBAC do usuario.
// ---------------------------------------------------------------------------
const TIPO_ORCAMENTO_ROTULO: Record<string, string> = {
  LOCACAO: 'Locação',
  SERVICOS: 'Serviços',
  PRODUTOS: 'Venda de produtos',
  CONJUNTO: 'Conjunto (locação + serviços/produtos)',
  SPARE_PARTS: 'Spare parts',
};
const docCnpj = (v: unknown) => {
  const d = soDigitos(v);
  return d.length === 14 ? formatarCnpj(d) : cut(v, 24);
};
const add = (out: DetalheRegistro[], rotulo: string, valor: unknown) => {
  const v = String(valor ?? '').replace(/\s+/g, ' ').trim();
  if (v && v !== '-' && v !== 'R$ 0,00' && v !== '0') out.push({ rotulo, valor: v.length > 300 ? `${v.slice(0, 299)}…` : v });
};
const comEmail = (nome: unknown, email: unknown) => [String(nome || '').trim(), email ? `<${String(email).trim()}>` : ''].filter(Boolean).join(' ');
const caminhoInterno = (id: string) => `/interno/proposta/${encodeURIComponent(id)}`;

export function tipoOrcamento(p: any): string {
  if (isAvulsoServiceProposal(p)) return 'Serviço pontual (pagamento único)';
  let t = String(p?.budgetType || '');
  try {
    t = resolveEffectiveProposalBudgetType(p);
  } catch {
    // tipo gravado
  }
  return TIPO_ORCAMENTO_ROTULO[t] || statusLabel(t);
}

/** Valores pelas regras do resumo: servico pontual sem /mes; locacao com setup e frete separados. */
export function valoresProposta(p: any): DetalheRegistro[] {
  const out: DetalheRegistro[] = [];
  const meses = Math.max(1, Number(p?.contractMonths || 1));
  let v: ReturnType<typeof resolveProposalAmountDisplay> | null = null;
  try {
    v = resolveProposalAmountDisplay({ ...p, items: Array.isArray(p?.items) ? p.items : [] });
  } catch {
    v = null;
  }
  if (isAvulsoServiceProposal(p) || v?.oneTime) {
    add(out, isAvulsoServiceProposal(p) ? 'Pagamento único' : 'Valor total', formatBRL(v?.totalAmount || totalPropostaRegistro(p)));
    if (Number(p?.shippingCost) > 0) add(out, 'Frete (incluso)', formatBRL(p.shippingCost));
    return out;
  }
  const mensal = Number(v?.monthlyAmount || p?.monthlyRecurringTotal || 0);
  add(out, 'Mensal', `${formatBRL(mensal)}/mês`);
  add(out, 'Prazo', `${meses} ${meses === 1 ? 'mês' : 'meses'}`);
  const setup = Number(v?.setupAmount ?? p?.oneTimeSetupTotal ?? 0);
  if (setup > 0) add(out, `${proposalSetupFeeLabel(p)} (valor único, separado)`, formatBRL(setup));
  if (Number(p?.shippingCost) > 0) add(out, 'Frete (valor único)', formatBRL(p.shippingCost));
  add(out, 'Total do contrato', formatBRL(Number(p?.totalContractValue) || v?.totalAmount || totalPropostaRegistro(p)));
  return out;
}

/** "R$ 2.350,00/mês por 36 meses (total R$ 84.600,00)" ou "R$ 18.600,00 em pagamento único". */
export function resumoValorProposta(p: any): string {
  const v = valoresProposta(p);
  const get = (r: string) => v.find((x) => x.rotulo === r)?.valor;
  if (get('Pagamento único')) return `${get('Pagamento único')} em pagamento único`;
  if (get('Valor total')) return `total ${get('Valor total')}`;
  const meses = Math.max(1, Number(p?.contractMonths || 1));
  const setup = v.find((x) => x.rotulo.includes('valor único, separado'));
  return `${get('Mensal') || '-'} por ${meses} ${meses === 1 ? 'mês' : 'meses'}${setup ? ` + ${setup.valor} de ${setup.rotulo.replace(/ \(valor único, separado\)/, '').toLowerCase()} (único)` : ''} (total ${get('Total do contrato') || formatBRL(totalPropostaRegistro(p))})`;
}

export function detalhesProposta(p: any): DetalheRegistro[] {
  const out: DetalheRegistro[] = [];
  add(out, 'Orçamento', numeroProposta(p));
  add(out, 'Cliente', p?.companyName);
  add(out, 'CNPJ', p?.companyCnpj ? docCnpj(p.companyCnpj) : '');
  add(out, 'Contato', comEmail(p?.careOf || p?.contactName, p?.contactEmail));
  add(out, 'Situação', statusProposta(p?.status));
  add(out, 'Tipo', tipoOrcamento(p));
  add(out, 'Título', p?.title);
  if (p?.serviceType) add(out, 'Tipo de serviço', p.serviceType);
  out.push(...valoresProposta(p));
  add(out, 'Pagamento', p?.paymentCondition);
  if (p?.validUntil) {
    const venc = isProposalValidityExpired(p.validUntil) && !['APROVADA', 'CONVERTIDA_CONTRATO', 'RECUSADA'].includes(String(p.status));
    add(out, 'Validade', `${formatProposalValidUntilPtBr(p.validUntil) || formatDateBr(p.validUntil)}${venc ? ' (vencida: precisa revalidar)' : ''}`);
  }
  add(out, 'Vendedor', comEmail(p?.sellerName, p?.sellerEmail));
  add(out, 'Criada em', formatDateBr(p?.createdAt || p?.proposalDate));
  if (p?.updatedAt) add(out, 'Atualizada em', formatDateBr(p.updatedAt));
  if (p?.lastEmailSentAt) add(out, 'Último envio por e-mail', formatDateBr(p.lastEmailSentAt));
  if (p?.readjustmentIndex) add(out, 'Reajuste', p.readjustmentIndex === 'IST_ANATEL' ? 'IST (Anatel)' : p.readjustmentIndex);
  if (p?.convertedContractId) add(out, 'Contrato gerado', 'sim (veja em Contratos)');
  const itens: any[] = Array.isArray(p?.items) ? p.items : [];
  if (itens.length) add(out, 'Itens', `${itens.length} ${itens.length === 1 ? 'item' : 'itens'}: ${resumoItens(p, 6)}`);
  if (propostaDoGestaoClick(p)) add(out, 'Origem', 'Importada do ERP de origem');
  return out;
}

export function acoesProposta(p: any): AcaoRegistro[] {
  const id = String(p?.id || '').trim();
  if (!id) return [];
  const out: AcaoRegistro[] = [{ tipo: 'abrir', rotulo: 'Abrir no sistema', alvo: { type: 'PROPOSAL', id }, href: '/?tela=ERP_PROPOSALS' }];
  // Emitir o link de um RASCUNHO muda a situacao para Enviada (regra da rota): o chat nao faz isso.
  if (String(p?.status || '') === 'RASCUNHO') {
    out.push({ tipo: 'aviso', rotulo: 'Rascunho: o link do cliente sai quando a proposta for enviada (gerar o link pela lista muda a situação para Enviada).' });
  } else {
    out.push({ tipo: 'link_cliente_proposta', rotulo: 'Copiar link do cliente', propostaId: id });
  }
  out.push(
    { tipo: 'versao_contrato', rotulo: 'Versão contrato', href: caminhoInterno(id) },
    { tipo: 'pdf_proposta', rotulo: 'Baixar PDF', propostaId: id },
    { tipo: 'link_pdf', rotulo: 'Copiar link do PDF', href: `${caminhoInterno(id)}?pdf=1` },
  );
  return out;
}

export function detalhesContrato(c: any): DetalheRegistro[] {
  const out: DetalheRegistro[] = [];
  add(out, 'Contrato', c?.contractNumber || c?.gestaoClickCode);
  add(out, 'Cliente', c?.companyName);
  add(out, 'CNPJ', c?.companyCnpj ? docCnpj(c.companyCnpj) : '');
  add(out, 'Situação', statusLabel(c?.status));
  add(out, 'Título', c?.title);
  add(out, 'Mensal', `${formatBRL(c?.monthlyValue)}/mês`);
  add(out, 'Vigência', `${formatDateBr(c?.startDate)} a ${formatDateBr(c?.endDate)}`);
  if (c?.contractMonths) add(out, 'Prazo', `${Number(c.contractMonths)} meses`);
  if (c?.dueDay) add(out, 'Dia de vencimento', String(c.dueDay));
  add(out, 'Reajuste', c?.readjustmentIndex || 'não informado');
  if (c?.lastReadjustmentDate) add(out, 'Último reajuste', `${formatDateBr(c.lastReadjustmentDate)}${c.lastReadjustmentPercent != null ? ` (${c.lastReadjustmentPercent}%)` : ''}`);
  if (c?.nextDueDate) add(out, 'Próximo vencimento', formatDateBr(c.nextDueDate));
  if (c?.lastBilledCompetence) add(out, 'Último faturamento', c.lastBilledCompetence);
  if (c?.proposalNumber || c?.proposalId) add(out, 'Orçamento de origem', c.proposalNumber || c.proposalId);
  add(out, 'Vendedor', c?.sellerName);
  const eq: any[] = Array.isArray(c?.equipments) ? c.equipments : [];
  if (eq.length) add(out, 'Equipamentos', `${eq.length}: ${eq.slice(0, 5).map((e) => cut(e?.description || e?.name || e?.model || e?.serialNumber, 40)).join('; ')}`);
  return out;
}

export function detalhesFatura(f: any): DetalheRegistro[] {
  const out: DetalheRegistro[] = [];
  add(out, ehNotaFiscal(f) ? 'Nota' : 'Fatura', f?.documentNumber);
  add(out, 'Tipo', tipoDocumentoFiscal(f?.documentType));
  add(out, 'Cliente', f?.companyName);
  add(out, 'CNPJ', f?.companyCnpj ? docCnpj(f.companyCnpj) : '');
  add(out, 'Situação', statusLabel(statusFatura(f)));
  add(out, 'Valor', formatBRL(f?.grossAmount));
  if (Number(f?.netAmount) && Number(f.netAmount) !== Number(f.grossAmount)) add(out, 'Valor líquido', formatBRL(f.netAmount));
  if (f?.competenceMonth) add(out, 'Competência', f.competenceMonth);
  add(out, 'Emissão', formatDateBr(f?.issueDate));
  add(out, 'Vencimento', formatDateBr(f?.dueDate));
  if (f?.paidAt) add(out, 'Pagamento', `${formatDateBr(f.paidAt)}${f.paymentMethod ? ` (${f.paymentMethod})` : ''}`);
  if (f?.contractNumber) add(out, 'Contrato', f.contractNumber);
  if (f?.proposalNumber) add(out, 'Orçamento', f.proposalNumber);
  if (f?.verificationCodeOrKey) add(out, ehNotaFiscal(f) ? 'Chave / verificação' : 'Código', f.verificationCodeOrKey);
  if (f?.boletoDigitableLine) add(out, 'Linha digitável', f.boletoDigitableLine);
  if (f?.itemsDescription || f?.description) add(out, 'Descrição', f.itemsDescription || f.description);
  return out;
}

export function detalhesOs(o: any): DetalheRegistro[] {
  const out: DetalheRegistro[] = [];
  add(out, 'OS', o?.code);
  add(out, 'Cliente', o?.companyName);
  add(out, 'CNPJ', o?.companyCnpj ? docCnpj(o.companyCnpj) : '');
  add(out, 'Situação', statusLabel(o?.status));
  add(out, 'Descrição', o?.description);
  add(out, 'Equipamento', [o?.equipmentName, o?.serialNumber ? `série ${o.serialNumber}` : ''].filter(Boolean).join(', '));
  add(out, 'Técnico', o?.technicianName);
  add(out, 'Vendedor', o?.sellerName);
  add(out, 'Valor', formatBRL(o?.totalAmount));
  add(out, 'Entrada', formatDateBr(o?.entryDate));
  if (o?.exitDate) add(out, 'Saída', formatDateBr(o.exitDate));
  if (o?.technicalReport) add(out, 'Laudo', o.technicalReport);
  return out;
}

export function detalhesChamado(t: any): DetalheRegistro[] {
  const out: DetalheRegistro[] = [];
  add(out, 'Chamado', t?.key);
  add(out, 'Assunto', t?.subject);
  add(out, 'Situação', statusChamado(t?.status));
  add(out, 'Prioridade', TICKET_PRIORIDADE_ROTULO[String(t?.priority || '')] || t?.priority);
  add(out, 'Cliente', t?.company?.name || t?.companyName);
  add(out, 'Solicitante', comEmail(t?.requesterName, t?.requesterEmail));
  add(out, 'Responsável', t?.assigneeName || t?.assignee?.name);
  add(out, 'Aberto em', formatDateBr(t?.createdAt));
  if (t?.updatedAt) add(out, 'Atualizado em', formatDateBr(t.updatedAt));
  return out;
}

export function detalhesEmpresa(c: any): DetalheRegistro[] {
  const out: DetalheRegistro[] = [];
  add(out, 'Cliente', c?.name || c?.legalName);
  if (c?.legalName && c.legalName !== c.name) add(out, 'Razão social', c.legalName);
  add(out, 'CNPJ', c?.cnpj ? docCnpj(c.cnpj) : '');
  add(out, 'Cidade/UF', [c?.city, c?.state].filter(Boolean).join('/'));
  add(out, 'Telefone', c?.phone);
  add(out, 'E-mail', c?.email);
  return out;
}

/** Ficha, acoes e registro (para o contexto da conversa) de um achado da busca. */
function fichaDoAchado(x: Achado): { detalhes: DetalheRegistro[]; acoes: AcaoRegistro[]; registro?: { tipo: string; id: string; codigo?: string } } {
  const b = x.bruto || {};
  const id = String(b.id || '');
  switch (x.tipo) {
    case 'Orçamento':
      return { detalhes: detalhesProposta(b), acoes: acoesProposta(b), registro: { tipo: 'proposta', id, codigo: b.code ? String(b.code) : undefined } };
    case 'Contrato':
      return {
        detalhes: detalhesContrato(b),
        acoes: id ? [{ tipo: 'abrir', rotulo: 'Abrir no sistema', alvo: { type: 'CONTRACT', id }, href: '/?tela=ERP_CONTRACTS' }] : [],
        registro: { tipo: 'contrato', id, codigo: b.contractNumber ? String(b.contractNumber) : undefined },
      };
    case 'Fatura':
    case 'Nota fiscal': {
      const acoes: AcaoRegistro[] = id ? [{ tipo: 'abrir', rotulo: 'Abrir no sistema', alvo: { type: 'INVOICE', id }, href: '/?tela=ERP_OVERVIEW' }] : [];
      if (id && !ehNotaFiscal(b) && !['RASCUNHO', 'CANCELADA'].includes(String(b.status || ''))) {
        acoes.push({ tipo: 'link_cliente_fatura', rotulo: 'Copiar link da fatura (cliente)', faturaId: id });
      }
      return { detalhes: detalhesFatura(b), acoes, registro: { tipo: ehNotaFiscal(b) ? 'nota' : 'fatura', id, codigo: b.documentNumber ? String(b.documentNumber) : undefined } };
    }
    case 'OS':
      return {
        detalhes: detalhesOs(b),
        acoes: id ? [{ tipo: 'abrir', rotulo: 'Abrir no sistema', alvo: { type: 'SERVICE_ORDER', id, query: String(b.code || '') }, href: '/?tela=ERP_OVERVIEW' }] : [],
        registro: { tipo: 'ordem_servico', id, codigo: b.code ? String(b.code) : undefined },
      };
    case 'Chamado':
      return {
        detalhes: detalhesChamado(b),
        acoes: id ? [{ tipo: 'abrir', rotulo: 'Abrir no STI HUB Desk Service', alvo: { type: 'TICKET', id, query: String(b.key || '') }, href: '/?tela=CHAMADOS_QUEUE' }] : [],
        registro: { tipo: 'chamado', id, codigo: b.key ? String(b.key) : undefined },
      };
    case 'Cliente':
      return {
        detalhes: detalhesEmpresa(b),
        acoes: id ? [{ tipo: 'abrir', rotulo: 'Abrir cadastro', alvo: { type: 'CUSTOMER', id }, href: '/?tela=ERP_OVERVIEW' }] : [],
      };
    default:
      return { detalhes: [], acoes: [] };
  }
}

/** Tabela de itens do orcamento (mesma do consultar_propostas). */
function tabelaItensProposta(p: any): ToolTable | undefined {
  const itens: any[] = Array.isArray(p?.items) ? p.items : [];
  if (!itens.length) return undefined;
  return {
    colunas: ['Item', 'Descrição', 'Qtd', 'Unitário', 'Cobrança', 'Subtotal'],
    linhas: itens.slice(0, 60).map((i, idx) => [String(idx + 1), cut(i.description, 70), String(i.quantity ?? 1), formatBRL(i.unitPrice), cobrancaItem(i), formatBRL(i.subtotal ?? i.totalMonthly ?? Number(i.unitPrice || 0) * Number(i.quantity || 1))]),
  };
}

const buscarSchema = z
  .object({
    termo: shortText(300),
    contexto: z.enum(['nao_abre']).optional(),
    link_com_assinatura: z.boolean().optional(),
  })
  .strict();
type BuscarArgs = z.infer<typeof buscarSchema>;

export async function buscaUniversal(a: BuscarArgs, api: ApiCaller): Promise<ToolResult> {
  const L = criarLeitor(api);
  const ids = extrairIdentificadores(a.termo);
  const livre = textoLivre(a.termo, ids);
  let achados: Achado[] = [];
  for (const id of ids.slice(0, 4)) achados.push(...(await resolverIdentificador(id, L)));
  let amplo = false;
  if (!achados.length && livre) achados.push(...(await buscarTexto(livre, L)));
  // Fallback amplo: o numero/codigo procurado em todos os recursos (ex.: "orçamento 123" que e uma OS).
  if (!achados.length && ids.length) {
    for (const id of ids.slice(0, 3)) {
      if (['proposta', 'contrato', 'fatura', 'nota', 'os', 'chamado'].includes(id.tipo)) {
        achados.push(...(await resolverIdentificador({ ...id, tipo: 'numero' }, L)));
      }
    }
    amplo = achados.length > 0;
  }
  // Fallback por palavras: cada palavra com 4+ letras separadamente.
  if (!achados.length && !ids.length && livre.includes(' ')) {
    for (const w of livre.split(' ').filter((x) => x.length >= 4).slice(0, 3)) achados.push(...(await buscarTexto(w, L)));
    amplo = achados.length > 0;
  }
  const vistos = new Set<string>();
  achados = achados.filter((x) => (vistos.has(x.chave) ? false : (vistos.add(x.chave), true)));

  const link = ids.find((i) => i.tipo === 'link_proposta');
  const negados = [...L.negados];
  const avisoNegado = negados.length ? ` Seu usuário não tem acesso a: ${negados.join(', ')} (por isso não procurei lá).` : '';
  const avisoFalha = L.falhas.size ? ` Não consegui consultar agora: ${[...L.falhas].join(', ')}.` : '';
  const procurado = ids.length ? ids.map((i) => i.rotulo).join(', ') : `"${cut(a.termo, 60)}"`;

  if (!achados.length) {
    const dicas: string[] = [];
    if (link?.link?.area === 'curto') {
      dicas.push('O link curto /p/... é o link do cliente: se não abre, ele expirou com a validade da proposta ou foi substituído. Gere outro em "Copiar link do cliente" na lista de Orçamentos.');
    } else if (link || ids.some((i) => i.tipo === 'id_proposta')) {
      dicas.push('Se a proposta existe e você não a vê, ela pode ser de outra carteira (seu perfil só vê os orçamentos liberados para você) ou ainda não ter sido sincronizada do ERP de origem.');
      dicas.push('O endereço /proposta/<id> sem a assinatura do cliente (#t=...) não abre: use "Copiar link do cliente" na lista de Orçamentos.');
    }
    dicas.push('Confira o número; procure pelo nome do cliente (pode ser parte do nome, sem acento), pelo CNPJ ou pelo e-mail.');
    if (ids.some((i) => i.tipo === 'chamado' || i.tipo === 'codigo')) dicas.push('Para chamados, use a chave completa (ex.: SETA-123).');
    return {
      ok: true,
      mensagem: `Não encontrei ${procurado} em orçamentos, contratos, faturas, notas, OS, chamados, clientes, fornecedores e produtos.${avisoNegado}${avisoFalha} ${dicas.join(' ')}`.replace(/\s+/g, ' ').trim(),
      resumoParaModelo: `Busca universal sem resultado (${ids.map((i) => i.tipo).join(', ') || 'texto'}). Sugestões mostradas ao usuário.`,
    };
  }

  const tabela: ToolTable = {
    colunas: ['Tipo', 'Número', 'Cliente / descrição', 'Situação', 'Valor', 'Data'],
    linhas: achados.slice(0, 30).map((x) => [x.tipo, x.numero, x.descricao, x.situacao, x.valor, x.data]),
  };
  const contagem = Object.entries(achados.reduce<Record<string, number>>((acc, x) => ((acc[x.tipo] = (acc[x.tipo] || 0) + 1), acc), {}))
    .map(([k, n]) => `${n} ${k.toLowerCase()}${n > 1 ? 's' : ''}`)
    .join(', ');

  if (achados.length === 1) {
    const x = achados[0];
    // Orcamento: a ficha completa (com os itens) vem do GET por id, com o mesmo RBAC da tela.
    if (x.tipo === 'Orçamento' && x.bruto?.id && !(Array.isArray(x.bruto.items) && x.bruto.items.length)) {
      const full = await api({ method: 'GET', path: `/api/erp/proposals/${encodeURIComponent(String(x.bruto.id))}` });
      if (full.status >= 200 && full.status < 300 && full.body?.data && !Array.isArray(full.body.data)) x.bruto = { ...x.bruto, ...full.body.data };
    }
    const ficha = fichaDoAchado(x);
    const linhas: string[] = [];
    let registro: { tipo: string; id: string; codigo?: string } | undefined;
    const totais: Array<{ rotulo: string; valor: string }> = [];
    if (x.tipo === 'Orçamento') {
      const p = x.bruto;
      const avulso = isAvulsoServiceProposal(p);
      linhas.push(`Encontrei o orçamento ${x.numero} de ${x.descricao}: ${x.situacao}, ${avulso ? `${formatBRL(totalPropostaRegistro(p))} em pagamento único` : x.valor}${!avulso && Number(p.contractMonths) > 1 ? ` por ${Number(p.contractMonths)} meses` : ''}.`);
      linhas.push(...diagnosticoProposta(p, link, a));
      registro = { tipo: 'proposta', id: String(p.id || ''), codigo: p.code ? String(p.code) : undefined };
      totais.push({ rotulo: 'Número', valor: x.numero }, { rotulo: 'Cliente', valor: x.descricao }, { rotulo: 'Situação', valor: x.situacao }, { rotulo: avulso ? 'Pagamento único' : 'Valor', valor: avulso ? formatBRL(totalPropostaRegistro(p)) : x.valor });
      if (p.validUntil) totais.push({ rotulo: 'Validade', valor: formatProposalValidUntilPtBr(p.validUntil) || '-' });
    } else if (x.tipo === 'Contrato') {
      const c = x.bruto;
      linhas.push(`Encontrei o contrato ${x.numero} de ${x.descricao}: ${x.situacao}, ${x.valor}, vigência ${x.data}${c.contractMonths ? ` (${c.contractMonths} meses)` : ''}, reajuste ${c.readjustmentIndex || 'não informado'}${c.lastReadjustmentDate ? ` (último em ${formatDateBr(c.lastReadjustmentDate)}${c.lastReadjustmentPercent != null ? `, ${c.lastReadjustmentPercent}%` : ''})` : ''}.`);
      registro = { tipo: 'contrato', id: String(c.id || ''), codigo: c.contractNumber ? String(c.contractNumber) : undefined };
    } else {
      linhas.push(`Encontrei ${x.tipo === 'OS' ? 'a OS' : x.tipo === 'Fatura' || x.tipo === 'Nota fiscal' || x.tipo === 'Venda' ? `a ${x.tipo.toLowerCase()}` : `o ${x.tipo.toLowerCase()}`} ${x.numero !== '-' ? `${x.numero} ` : ''}— ${x.descricao}: ${x.situacao}${x.valor !== '-' ? `, ${x.valor}` : ''}${x.data !== '-' ? `, ${x.data}` : ''}.`);
    }
    if (amplo) linhas.push(`(Não achei como o tipo pedido; este é o registro com esse número.)`);
    registro = registro || ficha.registro;
    const tabelaFinal = x.tipo === 'Orçamento' ? tabelaItensProposta(x.bruto) : ficha.detalhes.length ? undefined : tabela;
    return {
      ok: true,
      mensagem: `${linhas.join(' ')}${avisoNegado}`.trim(),
      ...(tabelaFinal ? { tabela: tabelaFinal } : {}),
      ...(totais.length ? { totais } : {}),
      ...(registro ? { registro } : {}),
      ...(ficha.detalhes.length ? { detalhes: ficha.detalhes } : {}),
      ...(ficha.acoes.length ? { acoes: ficha.acoes } : {}),
      resumoParaModelo: `Busca universal: 1 registro (${x.tipo}) mostrado ao usuário${x.tipo === 'Orçamento' ? `, número ${x.numero}` : ''}.`,
    };
  }
  const prop = achados.filter((x) => x.tipo === 'Orçamento');
  const diag = prop.length === 1 && (a.contexto === 'nao_abre' || link) ? ` ${diagnosticoProposta(prop[0].bruto, link, a).join(' ')}` : '';
  return {
    ok: true,
    mensagem: `Encontrei ${achados.length} registros para ${procurado}${amplo ? ' (busca ampliada)' : ''}: ${contagem}${achados.length > 30 ? '; mostrando 30' : ''}.${diag}${avisoNegado}`.trim(),
    tabela,
    resumoParaModelo: `Busca universal: ${achados.length} registros (${contagem}) mostrados ao usuário, não enviados a você.`,
  };
}

const buscar: AssistenteTool<BuscarArgs> = {
  name: 'buscar',
  descricao:
    'Busca universal só leitura: acha qualquer registro pelo que o usuário mandar (número de orçamento/proposta, id prop-..., link colado /proposta/... ou /interno/proposta/..., número de contrato, fatura, nota NF-e/NFS-e/NFCom ou chave de 44 dígitos, OS, chave de chamado como SETA-123, CNPJ/CPF com ou sem máscara, e-mail, telefone, nome parcial sem acento). Procura em todos os módulos que o usuário pode ver e amplia a busca antes de dizer que não achou. Use também quando perguntarem por que um registro ou link "não abre" ou "não foi localizado" (contexto nao_abre).',
  tipo: 'leitura',
  rotas: [
    'GET /api/erp/proposals', 'GET /api/erp/proposals/:id', 'GET /api/erp/contracts', 'GET /api/erp/invoices', 'GET /api/erp/overview',
    'GET /api/erp/catalog', 'GET /api/companies', 'GET /api/contacts', 'GET /api/tickets',
  ],
  disponivel: (u) => u.moduleAccess.crm || u.moduleAccess.erp || u.moduleAccess.chamados,
  parameters: {
    type: 'object',
    properties: {
      termo: { type: 'string', description: 'O que procurar, como o usuário escreveu (número, código, link, CNPJ, e-mail, telefone ou nome).' },
      contexto: { type: 'string', enum: ['nao_abre'], description: 'Use nao_abre quando o usuário diz que o registro ou link não abre / não foi localizado.' },
    },
    required: ['termo'],
    additionalProperties: false,
  },
  schema: buscarSchema,
  modulos: () => [],
  resumo: (a) => ({
    titulo: 'Buscar no STI-hub',
    linhas: [`Procurar: ${cut(a.termo, 120)}`, ...(a.contexto === 'nao_abre' ? ['Explicar por que não abre'] : []), 'Onde: todos os módulos que você pode ver (só leitura)'],
  }),
  executar: (a, api) => buscaUniversal(a, api),
};

// ---------------------------------------------------------------------------
// painel: feitas x aprovadas, faturado, vendas e (com alcada) financeiro do mes
// ---------------------------------------------------------------------------
const painelSchema = z.object({ mes: z.string().regex(/^\d{4}-\d{2}$/, 'Use AAAA-MM').optional() }).strict();
type PainelArgs = z.infer<typeof painelSchema>;
const fmtCount = (c: any) => `${Number(c?.count || 0)} (${formatBRL(c?.value || 0)})`;

const painel: AssistenteTool<PainelArgs> = {
  name: 'painel',
  descricao:
    'Painel do ERP de um mês (padrão: mês atual): propostas feitas x aprovadas (quantidade e valor), taxa de aprovação, faturado, vendas e, para quem tem alçada financeira, recebido e pago. Conta os negócios do STI-hub. Só leitura.',
  tipo: 'leitura',
  rotas: ['GET /api/erp/dashboard'],
  disponivel: (u) => u.moduleAccess.erp,
  parameters: {
    type: 'object',
    properties: { mes: { type: 'string', description: 'Mês AAAA-MM (opcional; padrão mês atual).' } },
    additionalProperties: false,
  },
  schema: painelSchema,
  modulos: () => ['erp'],
  resumo: (a) => ({ titulo: 'Ver o painel do ERP', linhas: [`Mês: ${a.mes ? `${a.mes.slice(5)}/${a.mes.slice(0, 4)}` : 'atual'}`] }),
  async executar(a, api) {
    const res = await api({ method: 'GET', path: `/api/erp/dashboard${a.mes ? `?mes=${encodeURIComponent(a.mes)}` : ''}` });
    if (res.status < 200 || res.status >= 300) return apiError(res, 'abrir o painel');
    const d = res.body?.data || {};
    const pr = d.proposals || {};
    const mesTxt = d.monthLabel || a.mes || d.month || 'mês atual';
    const totais = [
      { rotulo: 'Propostas feitas', valor: fmtCount(pr.made) },
      { rotulo: 'Aprovadas', valor: fmtCount(pr.approved) },
      { rotulo: 'Taxa de aprovação', valor: pr.approvalRate == null ? '-' : `${String(pr.approvalRate).replace('.', ',')}%` },
      ...(d.invoiced ? [{ rotulo: 'Faturado', valor: fmtCount(d.invoiced) }] : []),
      { rotulo: 'Vendas do mês', valor: formatBRL(d.sales?.monthTotal || 0) },
      ...(d.financeVisible
        ? [
            { rotulo: 'Recebido (pelo vencimento)', valor: formatBRL(d.summary?.receivedMonth || 0) },
            { rotulo: 'Pago (pelo vencimento)', valor: formatBRL(d.summary?.paidMonth || 0) },
          ]
        : []),
    ];
    const meses: any[] = Array.isArray(d.monthly) ? d.monthly : [];
    return {
      ok: true,
      mensagem: `Painel de ${mesTxt} (negócios do STI-hub): ${Number(pr.made?.count || 0)} propostas feitas e ${Number(pr.approved?.count || 0)} aprovadas${d.invoiced ? `, ${formatBRL(d.invoiced.value || 0)} faturado` : ''}.${d.financeVisible ? '' : ' Valores financeiros só aparecem com alçada financeira.'}`,
      totais,
      tabela: meses.length
        ? {
            colunas: ['Mês', 'Feitas', 'Aprovadas', 'Faturado', 'Vendas'],
            linhas: meses.slice(-12).map((m) => [String(m.month || ''), fmtCount(m.proposalsMade), fmtCount(m.proposalsApproved), m.invoiced ? fmtCount(m.invoiced) : '-', formatBRL(m.vendas || 0)]),
          }
        : undefined,
      resumoParaModelo: `Painel de ${a.mes || 'mês atual'} mostrado ao usuário (não enviado a você).`,
    };
  },
};

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------
export const ASSISTENTE_TOOLS: AssistenteTool[] = [buscar, consultar, consultarPropostas, relatorio, painel, criarRascunhoProposta, editarProposta, abrirChamado, abrirOs];

export function getTool(name: string): AssistenteTool | undefined {
  return ASSISTENTE_TOOLS.find((t) => t.name === name);
}

export function userCanUseTool(tool: AssistenteTool, args: unknown, user: AssistenteUser): boolean {
  return tool.modulos(args).every((m) => user.moduleAccess[m] === true);
}

/** Ferramentas oferecidas ao modelo: so as disponiveis para os modulos do usuario. */
export function toolDefinitionsFor(user: AssistenteUser): LlmToolDefinition[] {
  return ASSISTENTE_TOOLS.filter((t) => t.disponivel(user)).map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.descricao, parameters: t.parameters },
  }));
}

/** Catalogo legivel (acao, tipo, modulos e rotas) para documentacao e auditoria. */
export function catalogoAcoes(): Array<{ acao: string; tipo: 'leitura' | 'gravacao'; rotas: string[] }> {
  return ASSISTENTE_TOOLS.map((t) => ({ acao: t.name, tipo: t.tipo, rotas: [...t.rotas] }));
}
