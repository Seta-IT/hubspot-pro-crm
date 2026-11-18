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

export type ApiCallRequest = { method: 'GET' | 'POST'; path: string; body?: Record<string, unknown> };
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
      /** Unico texto que volta ao modelo depois da execucao (sem dados de clientes). */
      resumoParaModelo: string;
    }
  | { ok: false; status: number; mensagem: string; resumoParaModelo: string };

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

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD');
const shortText = (max: number) => z.string().trim().min(1).max(max);

// ---------------------------------------------------------------------------
// Entidades consultaveis
// ---------------------------------------------------------------------------
export const ENTIDADES = ['contratos', 'vendas', 'ordens_servico', 'empresas', 'contatos', 'faturas', 'negocios'] as const;
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
    texto: (r) => [r.contractNumber, r.gestaoClickCode, r.title, r.companyName],
    colunas: ['Número', 'Cliente', 'Situação', 'Mensal', 'Início'],
    linha: (r) => [cut(r.contractNumber || r.gestaoClickCode, 24), cut(r.companyName, 50), statusLabel(r.status), formatBRL(r.monthlyValue), formatDateBr(r.startDate)],
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
    status: (r) => r.status,
    texto: (r) => [r.documentNumber, r.companyName, r.documentType],
    colunas: ['Documento', 'Cliente', 'Situação', 'Valor', 'Emissão', 'Vencimento'],
    linha: (r) => [cut(r.documentNumber, 24), cut(r.companyName, 50), statusLabel(r.status), formatBRL(r.grossAmount), formatDateBr(r.issueDate), formatDateBr(r.dueDate)],
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
  const res = await api({ method: 'GET', path: def.path });
  if (res.status < 200 || res.status >= 300) return { ok: false, res };
  const all = Array.isArray(def.pick(res.body)) ? def.pick(res.body) : [];
  const busca = f.busca ? compact(f.busca) : '';
  const status = f.status ? fold(f.status) : '';
  const rows = all.filter((r: any) => {
    if (!r || typeof r !== 'object') return false;
    if (busca && !buscaCombina(f.busca || '', def.texto(r))) return false;
    if (status && def.status && fold(def.status(r)) !== status && !fold(def.status(r)).startsWith(status)) return false;
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
  rotas: ['GET /api/erp/contracts', 'GET /api/erp/overview', 'GET /api/companies', 'GET /api/contacts', 'GET /api/erp/invoices', 'GET /api/deals'],
  disponivel: (u) => u.moduleAccess.crm || u.moduleAccess.erp || u.moduleAccess.chamados,
  descricao:
    'Lista registros do STI-hub (contratos, vendas, ordens_servico, empresas, contatos, faturas, negocios) com filtros opcionais de busca, situação e período. Só leitura.',
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
        : `Nenhum registro de ${r.def.rotulo} encontrado com esses filtros.`,
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
  rotas: ['GET /api/erp/contracts', 'GET /api/erp/overview', 'GET /api/companies', 'GET /api/contacts', 'GET /api/erp/invoices', 'GET /api/deals'],
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
  let r = await buscar(`/api/companies?search=${encodeURIComponent(termo)}&limit=20`);
  if ('erro' in r) return { ok: false, candidatos: [], result: apiError(r.erro, 'consultar o cadastro de empresas') };
  let list = r.list;
  const filtra = (l: any[]) => l.filter((c) => c && (buscaCombina(termo, [c.name, c.tradeName, c.legalName]) || (cnpj && String(c.cnpj || '').replace(/\D+/g, '') === cnpj)));
  let cands = filtra(list);
  if (!cands.length) {
    r = await buscar('/api/companies');
    if ('erro' in r) return { ok: false, candidatos: [], result: apiError(r.erro, 'consultar o cadastro de empresas') };
    list = r.list;
    cands = filtra(list);
  }
  const porCnpj = cnpj ? list.filter((c) => String(c?.cnpj || '').replace(/\D+/g, '') === cnpj) : [];
  if (porCnpj.length === 1) return { ok: true, company: porCnpj[0] };
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
    tipo: z.enum(['locacao', 'servico', 'produto']).optional(),
  })
  .strict();
const propostaSchema = z
  .object({
    cliente: shortText(160),
    titulo: z.string().trim().max(160).optional(),
    prazo_meses: z.number().int().min(1).max(120).optional(),
    itens: z.array(itemSchema).min(1).max(30),
    observacoes: z.string().trim().max(1000).optional(),
  })
  .strict();
type PropostaArgs = z.infer<typeof propostaSchema>;

const NATUREZA: Record<string, string> = { locacao: 'LOCACAO_BENS_MOVEIS', servico: 'SERVICO_TECNICO_TI_TELECOM', produto: 'VENDA_EQUIPAMENTO' };
const totalProposta = (a: PropostaArgs) => a.itens.reduce((s, i) => s + i.quantidade * (i.valor_unitario || 0), 0);
const semValor = (a: PropostaArgs) => a.itens.some((i) => !i.valor_unitario);
const tituloProposta = (a: PropostaArgs) => a.titulo || `Proposta${a.prazo_meses ? ` de ${a.prazo_meses} meses` : ''}`;

const criarRascunhoProposta: AssistenteTool<PropostaArgs> = {
  name: 'criar_rascunho_proposta',
  rotas: ['GET /api/companies', 'POST /api/erp/proposals'],
  disponivel: (u) => u.moduleAccess.erp,
  preparar: prepararCliente,
  descricao:
    'Cria uma proposta/orçamento como RASCUNHO no ERP (não envia ao cliente). Use direto quando pedirem proposta/orçamento: passe o cliente como o usuário escreveu (o sistema identifica a empresa), os itens com quantidade e, se houver, o prazo em meses. Valor unitário é opcional: sem valor, o item fica a definir.',
  tipo: 'gravacao',
  parameters: {
    type: 'object',
    properties: {
      cliente: { type: 'string', description: 'Nome ou CNPJ do cliente, como o usuário escreveu.' },
      titulo: { type: 'string', description: 'Título curto da proposta (opcional).' },
      prazo_meses: { type: 'integer', minimum: 1, maximum: 120, description: 'Prazo do contrato em meses (ex.: 36), se informado.' },
      itens: {
        type: 'array',
        minItems: 1,
        maxItems: 30,
        items: {
          type: 'object',
          properties: {
            descricao: { type: 'string' },
            quantidade: { type: 'number' },
            valor_unitario: { type: 'number', description: 'Valor unitário mensal em reais (opcional; omita se não informado).' },
            tipo: { type: 'string', enum: ['locacao', 'servico', 'produto'], description: 'Padrão locacao.' },
          },
          required: ['descricao', 'quantidade'],
          additionalProperties: false,
        },
      },
      observacoes: { type: 'string', description: 'Observações internas (opcional).' },
    },
    required: ['cliente', 'itens'],
    additionalProperties: false,
  },
  schema: propostaSchema,
  modulos: () => ['erp'],
  resumo: (a) => ({
    titulo: 'Criar rascunho de proposta',
    linhas: [
      `Cliente: ${a.cliente}`,
      `Título: ${tituloProposta(a)}`,
      ...(a.prazo_meses ? [`Prazo: ${a.prazo_meses} meses`] : []),
      ...a.itens.map((i) => `${i.quantidade} x ${i.descricao} (${i.tipo || 'locacao'}) a ${i.valor_unitario ? formatBRL(i.valor_unitario) : 'valor a definir'}`),
      `Total${a.itens.some((i) => (i.tipo || 'locacao') === 'locacao') ? ' mensal' : ''}: ${formatBRL(totalProposta(a))}${semValor(a) ? ' (há itens sem valor; preencha no ERP)' : ''}`,
      ...(a.observacoes ? [`Observações: ${cut(a.observacoes, 200)}`] : []),
      'Situação: rascunho (nada é enviado ao cliente)',
    ],
  }),
  async executar(a, api) {
    const emp = await resolverEmpresa(a.cliente, api);
    if (!emp.ok) return emp.result;
    const tipos = new Set(a.itens.map((i) => i.tipo || 'locacao'));
    const budgetType = tipos.size > 1 ? 'CONJUNTO' : tipos.has('servico') ? 'SERVICOS' : tipos.has('produto') ? 'PRODUTOS' : 'LOCACAO';
    const stamp = Date.now();
    const body: Record<string, unknown> = {
      title: tituloProposta(a),
      status: 'RASCUNHO',
      ...(a.prazo_meses ? { contractMonths: a.prazo_meses } : {}),
      budgetType,
      companyId: emp.company.id,
      companyName: emp.company.name,
      companyCnpj: emp.company.cnpj || '',
      items: a.itens.map((i, idx) => {
        const tipo = i.tipo || 'locacao';
        return {
          id: `pi-${stamp}-${idx + 1}`,
          sku: '',
          description: i.descricao,
          itemType: tipo === 'servico' ? 'SERVICE' : 'PRODUCT',
          fiscalNature: NATUREZA[tipo],
          ncmOrServiceCode: '',
          quantity: i.quantidade,
          unitPrice: i.valor_unitario || 0,
          discountPercent: 0,
          isRecurring: tipo === 'locacao',
          totalMonthly: Math.round(i.quantidade * (i.valor_unitario || 0) * 100) / 100,
        };
      }),
      ...(a.observacoes || semValor(a)
        ? { internalNotes: [a.observacoes, semValor(a) ? 'Criada pelo assistente de IA: há itens sem valor unitário, preencher.' : ''].filter(Boolean).join('\n') }
        : {}),
    };
    const res = await api({ method: 'POST', path: '/api/erp/proposals', body });
    if (res.status < 200 || res.status >= 300) return apiError(res, 'criar a proposta');
    const p = res.body?.data || {};
    return {
      ok: true,
      mensagem: `Rascunho de proposta ${p.code ? `#${p.code} ` : ''}criado para ${cut(emp.company.name, 60)}, no total de ${formatBRL(totalProposta(a))}. Nada foi enviado ao cliente.`,
      registro: { tipo: 'proposta', id: String(p.id || ''), codigo: p.code ? String(p.code) : undefined },
      resumoParaModelo: `Rascunho de proposta criado (código ${p.code || 'n/d'}). Não crie outra para o mesmo pedido.`,
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
  descricao: 'Abre um chamado (ticket) no módulo Chamados. Não envia mensagem ao cliente.',
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
// Registro
// ---------------------------------------------------------------------------
export const ASSISTENTE_TOOLS: AssistenteTool[] = [consultar, relatorio, criarRascunhoProposta, abrirChamado, abrirOs];

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
