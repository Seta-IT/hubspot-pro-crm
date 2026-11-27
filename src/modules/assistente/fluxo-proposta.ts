// ============================================================================
// STI-hub — Assistente: fluxo guiado do rascunho de proposta (25/11/2026).
//
// Pedidos do Marcéllo (t171u, t172u, t173u):
//  - "gere uma proposta de 1 switch cisco 3850": busca no cadastro de produtos e ABRE A LISTA
//    dos modelos (código, descrição, preço, estoque); depois de escolher, SUGERE acessórios
//    compatíveis que existem no cadastro (fontes, ópticos, uplink) por regras de família de
//    part number (tabela editável) + aprendizado (aceitos/recusados). Nunca inventa item.
//  - Tipo inferido pela frase (venda => Produtos; instalação => Serviço pontual; suporte =>
//    Serviço mensal; alugar => Locação); só pergunta quando não dá para inferir.
//  - Quantidade dita é aproveitada; valor unitário vem do cadastro (editável); frete, prazo
//    de entrega e forma de pagamento usam padrões e aparecem no cartão, sem bloquear.
//  - Estado do fluxo pendente por conversa (slot-filling): respostas curtas/numeradas
//    ("1 Venda / 1 C3850 / 3 incluso / 4 ok / 5 Boleto") preenchem os campos e continuam
//    a proposta. Só troca de intenção quando a mensagem é claramente um pedido novo.
// Pedido do Marcéllo (t195u, 27/11/2026): "gere uma proposta para a MK Jacuipe de locação de um
// cabo stack cisco de 1m por 24 meses no valor de 45,00/m6es" virou consulta de faturas depois de
// "IGP-M" / "boleto". Agora o pedido detalhado também é guiado quando o item está no cadastro:
// o rascunho (tipo, cliente, item, prazo, valor) fica no estado da conversa; respostas curtas
// ("boleto", "pix", "IGP-M", "sim", número) preenchem o que falta e nunca viram outra intenção;
// repetir o pedido reaproveita o rascunho; conversa antiga/reaberta é remontada pelo histórico.
// A gravação continua só pelo cartão de confirmação (criar_rascunho_proposta).
// ============================================================================
import { z } from 'zod';
import { foldTexto, formatarCnpj } from './identificadores';
import {
  FORMAS_PAGAMENTO, INDICES_REAJUSTE, PERGUNTA_TIPO_PROPOSTA, ROTULO_FORMA_PAGAMENTO, ROTULO_TIPO_PROPOSTA, TIPOS_PROPOSTA,
  MENSAGEM_SEM_CARTAO, normalizarFormaPagamento, normalizarIndice, pedidoNovaProposta, tipoPropostaDaConversa, tipoPropostaNoTexto,
  type FormaPagamento, type IndiceReajuste, type TipoProposta,
} from './proposta-tipo';
import { formatBRL, parseNumeroBR, resolverEmpresa, type ApiCaller } from './tools';
import type { CategoriaAcessorio, MemoriaAprendida, RegraAcessorio } from './conversas-store';

type Msg = { papel: 'usuario' | 'assistente'; texto: string };

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
export const CAMPOS_FLUXO = ['tipo', 'cliente', 'produto', 'quantidade', 'valor', 'frete', 'prazo', 'forma', 'meses', 'setup', 'indice'] as const;
export type CampoFluxo = (typeof CAMPOS_FLUXO)[number];
export const ETAPAS_FLUXO = ['tipo', 'cliente', 'produto', 'modelo', 'acessorios', 'meses', 'pronto'] as const;

const itemFluxoSchema = z.object({
  codigo: z.string().trim().max(60).optional(),
  descricao: z.string().trim().min(1).max(200),
  quantidade: z.number().positive().max(100000),
  valor: z.number().min(0).max(100_000_000).optional(),
});
export const fluxoSchema = z.object({
  v: z.literal(1),
  tipo: z.enum(TIPOS_PROPOSTA as unknown as [TipoProposta, ...TipoProposta[]]).nullable(),
  etapa: z.enum(ETAPAS_FLUXO),
  cliente: z.string().trim().max(160).optional(),
  /** Como o usuário chamou o cliente (ex.: "MK Jacuipe"): repetir o pedido não reabre a escolha. */
  clienteDito: z.string().trim().max(160).optional(),
  /** Valor unitário dito antes de o item ser escolhido (aplicado ao item do cadastro). */
  valor: z.number().min(0).max(100_000_000).optional(),
  clienteOk: z.string().trim().max(220).optional(),
  candidatos: z.array(z.object({ nome: z.string().max(160), cnpj: z.string().max(30).optional() })).max(5).optional(),
  termo: z.string().trim().max(80).optional(),
  quantidade: z.number().positive().max(100000).optional(),
  itens: z.array(itemFluxoSchema).max(30),
  base: z.string().trim().max(60).optional(),
  opcoes: z.array(z.string().max(60)).max(20).optional(),
  sugeridos: z.array(z.string().max(60)).max(40).optional(),
  freteIncluso: z.boolean().optional(),
  frete: z.number().min(0).max(10_000_000).optional(),
  prazoEntrega: z.string().trim().max(120).optional(),
  forma: z.enum(FORMAS_PAGAMENTO as unknown as [FormaPagamento, ...FormaPagamento[]]).optional(),
  prazoMeses: z.number().int().min(1).max(120).optional(),
  setup: z.number().min(0).max(100_000_000).optional(),
  indice: z.enum(INDICES_REAJUSTE).optional(),
  pergunta: z.array(z.enum(CAMPOS_FLUXO)).max(8).optional(),
});
export type FluxoProposta = z.infer<typeof fluxoSchema>;
export type ItemFluxo = z.infer<typeof itemFluxoSchema>;

export const selecaoSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('modelo'), codigo: z.string().trim().min(1).max(60), quantidade: z.number().positive().max(100000).optional(), valor: z.number().min(0).max(100_000_000).optional() }),
  z.object({
    tipo: z.literal('acessorios'),
    itens: z.array(z.object({ codigo: z.string().trim().min(1).max(60), quantidade: z.number().positive().max(100000), valor: z.number().min(0).max(100_000_000).optional() })).max(30),
  }),
  z.object({ tipo: z.literal('cliente'), indice: z.number().int().min(0).max(9) }),
  z.object({ tipo: z.literal('tipo_proposta'), valor: z.enum(TIPOS_PROPOSTA as unknown as [TipoProposta, ...TipoProposta[]]) }),
]);
export type SelecaoFluxo = z.infer<typeof selecaoSchema>;

export const novoFluxo = (tipo: TipoProposta | null = null): FluxoProposta => ({ v: 1, tipo, etapa: tipo ? 'produto' : 'tipo', itens: [] });

// ---------------------------------------------------------------------------
// Cadastro de produtos
// ---------------------------------------------------------------------------
export interface ProdutoCatalogo {
  id: string;
  codigo: string;
  descricao: string;
  venda: number;
  locacao: number;
  estoque: number;
  ativo: boolean;
  /** Part number compacto (maiusculo, sem espacos) para casar padroes. */
  pn: string;
  /** Texto compacto de busca (codigo + nome + modelo + marca). */
  busca: string;
}

const compactPn = (v: unknown) => String(v ?? '').toUpperCase().replace(/[\s?]+/g, '');

export function normalizarProduto(p: any): ProdutoCatalogo | null {
  if (!p || typeof p !== 'object') return null;
  const codigo = String(p.gestaoClickCode || '').trim();
  const nome = String(p.name || '').replace(/\s+/g, ' ').trim();
  if (!codigo && !nome) return null;
  const primeiro = nome.split(/\s+[-–—]\s+|\s{2,}/)[0] || '';
  const pn = compactPn(codigo || primeiro);
  return {
    id: String(p.id || codigo),
    codigo: codigo || primeiro,
    descricao: nome || codigo,
    venda: Number(p.saleOrSetupPrice) || 0,
    locacao: Number(p.monthlyRentalPrice) || 0,
    estoque: Number(p.stockAvailable) || 0,
    ativo: p.isActive !== false,
    pn,
    busca: compactPn([codigo, primeiro, nome, p.modelName, p.brand].filter(Boolean).join(' ')),
  };
}

export async function carregarCatalogo(api: ApiCaller): Promise<ProdutoCatalogo[] | null> {
  const r = await api({ method: 'GET', path: '/api/erp/catalog' });
  if (r.status < 200 || r.status >= 300) return null;
  const lista = Array.isArray(r.body?.data) ? r.body.data : [];
  return lista.map(normalizarProduto).filter((p: ProdutoCatalogo | null): p is ProdutoCatalogo => !!p && p.ativo);
}

/** Padrao com * (ex.: WS-C3850-*) casando o part number compacto. */
export function casaPadrao(pn: string, padrao: string | null | undefined): boolean {
  const p = compactPn(padrao);
  if (!p) return false;
  const re = new RegExp(`^${p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return re.test(compactPn(pn));
}

const precoDoTipo = (p: ProdutoCatalogo, tipo: TipoProposta | null) => (tipo === 'locacao' ? p.locacao : p.venda) || undefined;

const PALAVRAS_RUIDO = new Set(
  ('gere gera gerar crie cria criar monte monta montar faca faz fazer elabore elaborar prepare preparar emita emitir quero queria gostaria preciso ' +
    'proposta propostas orcamento orcamentos cotacao uma um uns umas de do da dos das para pra pro com o a os as e em no na por favor pf ' +
    'venda vender vendas compra comprar produto produtos item itens equipamento equipamentos unidade unidades un pcs peca pecas ' +
    'modelo modelos novo nova cisco switch switches roteador roteadores catalyst cliente empresa locacao aluguel alugar sim ok ' +
    'mes meses mensal mensais mensalidade reais valor preco prazo contrato durante').split(' '),
);

/** Medida no nome do item (1m, 50cm, 3m, 715w, 10g): ajuda a escolher o item certo. */
const MEDIDA_RE = /^\d+(?:[.,]\d+)?(?:m|cm|mm|w|g)$/;

/**
 * Sinônimos e abreviações de rede (pt/en) => trechos que aparecem nos códigos e nomes do cadastro.
 * Ex.: "cabo stack 1m" acha STACK-T1-1M ("StackWise-480 1m stacking cable"). Só amplia a busca:
 * o item continua tendo de existir no cadastro.
 */
export const SINONIMOS_PRODUTO: Record<string, string[]> = {
  CABO: ['CABO', 'CABLE', 'CAB-', 'CBL'],
  CABOS: ['CABO', 'CABLE', 'CAB-', 'CBL'],
  STACK: ['STACK', 'STK'],
  EMPILHAMENTO: ['STACK', 'STK'],
  STACKWISE: ['STACKWISE', 'STACK-T'],
  STACKPOWER: ['STACKPOWER', 'SPWR'],
  FONTE: ['FONTE', 'PWR', 'POWERSUPPLY', 'POWER'],
  FONTES: ['FONTE', 'PWR', 'POWERSUPPLY', 'POWER'],
  REDUNDANTE: ['PWR', 'POWER', 'REDUNDANT', 'FONTE'],
  SFP: ['SFP', 'GLC-'],
  'SFP+': ['SFP-10G', 'SFP+'],
  GBIC: ['GBIC', 'WS-G', 'GLC-', 'SFP'],
  MINIGBIC: ['GBIC', 'GLC-', 'SFP'],
  TRANSCEIVER: ['TRANSCEIVER', 'TRANSCEPTOR', 'SFP', 'GLC-'],
  TRANSCEPTOR: ['TRANSCEIVER', 'TRANSCEPTOR', 'SFP', 'GLC-'],
  OPTICO: ['SFP', 'GLC-', 'GBIC', 'TRANSCEIVER'],
  UPLINK: ['-NM-', 'UPLINK', 'NETWORKMODULE'],
  MODULO: ['MODULE', 'MODULO', '-NM-'],
  RACK: ['RACK', 'RCKMNT'],
  TRILHO: ['TRILHO', 'RAIL'],
  TRILHOS: ['TRILHO', 'RAIL'],
  SERVIDOR: ['SERVIDOR', 'SERVER', 'POWEREDGE', 'PROLIANT'],
  LICENCA: ['LICENCA', 'LICENSE', 'LIC-'],
  AP: ['AP-', 'ACCESSPOINT', 'AIR-'],
};

/** Termo de produto a partir do texto livre (tira verbos, quantidade, cliente e palavras genéricas). */
export function termoProduto(texto: string): string {
  const t = foldTexto(texto)
    .replace(/\b(?:para|pra|pro)\s+(?:a|o)?\s*(?:cliente|empresa)?\s*[a-z0-9][^,;\n]*$/, ' ')
    .replace(/[^a-z0-9\-/ ]+/g, ' ');
  const palavras = t.split(/\s+/).filter(Boolean);
  const fortes = palavras.filter((w) => /\d/.test(w) && /[a-z0-9]{3,}/.test(w) && !/^\d{1,2}$/.test(w) && !MEDIDA_RE.test(w));
  if (fortes.length) return fortes.join(' ').slice(0, 80);
  // Sem part number: palavras descritivas + medida ("cabo stack 1m", "fonte 715w").
  return palavras.filter((w) => MEDIDA_RE.test(w) || (w.length > 2 && !PALAVRAS_RUIDO.has(w) && !/^\d+$/.test(w))).join(' ').slice(0, 80);
}

/** Modelos do cadastro para o termo (só modelos base quando há regras para a família). */
export function buscarModelos(catalogo: ProdutoCatalogo[], termo: string, regras: RegraAcessorio[], limite = 12): ProdutoCatalogo[] {
  const tokens = foldTexto(termo).split(/\s+/).filter(Boolean).map(compactPn);
  if (!tokens.length) return [];
  const fortes = tokens.filter((w) => /\d/.test(w) && !MEDIDA_RE.test(w.toLowerCase()));
  const casa = (p: ProdutoCatalogo, w: string) => (SINONIMOS_PRODUTO[w] || [w]).some((x) => p.busca.includes(x));
  // 1) Todas as palavras (com sinônimos); 2) só os part numbers ditos (como antes).
  let achados = catalogo.filter((p) => tokens.every((w) => casa(p, w)));
  if (!achados.length && fortes.length) achados = catalogo.filter((p) => fortes.every((w) => p.busca.includes(w)));
  if (!achados.length) return [];
  const usar = fortes.length ? fortes : tokens;
  const ativas = regras.filter((r) => r.ativa);
  const ehAcessorio = (p: ProdutoCatalogo) => ativas.some((r) => casaPadrao(p.pn, r.padrao));
  const ehBase = (p: ProdutoCatalogo) => ativas.some((r) => casaPadrao(p.pn, r.familia));
  const bases = achados.filter(ehBase);
  // Pedido de acessório ("cabo stack", "fonte 1100w"): lista os acessórios; pedido de modelo: só os modelos base.
  const pediuAcessorio = tokens.some((w) => SINONIMOS_PRODUTO[w] && !['SERVIDOR', 'AP'].includes(w));
  const naoAcessorios = achados.filter((p) => !ehAcessorio(p));
  const lista = bases.length ? bases : pediuAcessorio || !naoAcessorios.length ? achados : naoAcessorios;
  const exato = (p: ProdutoCatalogo) => usar.some((w) => p.pn === w);
  return lista
    .sort((a, b) => Number(exato(b)) - Number(exato(a)) || Number(b.estoque > 0) - Number(a.estoque > 0) || a.codigo.localeCompare(b.codigo))
    .slice(0, limite);
}

// ---------------------------------------------------------------------------
// Acessórios compatíveis (regras + aprendizado)
// ---------------------------------------------------------------------------
export const ROTULO_CATEGORIA: Record<CategoriaAcessorio, string> = {
  fonte: 'Fontes redundantes',
  uplink: 'Módulos de uplink',
  optico: 'Conectores ópticos (SFP / SFP+ / GBIC)',
  acessorio: 'Outros acessórios',
};

export interface SugestaoAcessorio {
  codigo: string;
  descricao: string;
  preco: number | null;
  estoque: number;
  categoria: CategoriaAcessorio;
  observacao: string;
  marcado: boolean;
  quantidade: number;
  /** Saldo aprendido (aceitos - recusados) para esta família. */
  saldo: number;
}

export const textoMemoriaSugestao = (familia: string, item: string) => `Sugestão de acessório para ${familia}: ${item}`;

/** Saldo aprendido por item para a família (memórias tipo "sugestao" do usuário). */
export function saldoAprendido(memorias: MemoriaAprendida[], familia: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of memorias) {
    if (!m.ativa || m.tipo !== 'sugestao' || !m.dados?.item) continue;
    if (compactPn(m.dados.base) !== compactPn(familia)) continue;
    const saldo = Number(m.dados.aceitos || 0) - Number(m.dados.recusados || 0);
    out.set(compactPn(m.dados.item), saldo);
  }
  return out;
}

const MAX_POR_CATEGORIA = 6;
const QTD_PADRAO: Record<CategoriaAcessorio, number> = { fonte: 1, uplink: 1, optico: 2, acessorio: 1 };

export function familiasDoModelo(base: string, regras: RegraAcessorio[]): string[] {
  return [...new Set(regras.filter((r) => r.ativa && casaPadrao(base, r.familia)).map((r) => r.familia))];
}

/**
 * Acessórios do cadastro compatíveis com o modelo base. Só itens reais (do catálogo).
 * Aprendizado: aceitos sobem e já vêm marcados; recusados descem; saldo <= -3 sai da lista.
 */
export function sugerirAcessorios(base: ProdutoCatalogo, catalogo: ProdutoCatalogo[], regras: RegraAcessorio[], memorias: MemoriaAprendida[], tipo: TipoProposta | null): SugestaoAcessorio[] {
  const aplicaveis = regras.filter((r) => r.ativa && casaPadrao(base.pn, r.familia)).sort((a, b) => a.ordem - b.ordem);
  const vistos = new Set<string>([base.pn]);
  const porCategoria = new Map<CategoriaAcessorio, SugestaoAcessorio[]>();
  for (const r of aplicaveis) {
    const saldos = saldoAprendido(memorias, r.familia);
    for (const p of catalogo) {
      if (vistos.has(p.pn) || !casaPadrao(p.pn, r.padrao) || (r.excluir && casaPadrao(p.pn, r.excluir))) continue;
      const saldo = saldos.get(p.pn) || 0;
      if (saldo <= -3) continue;
      vistos.add(p.pn);
      const lista = porCategoria.get(r.categoria) || [];
      lista.push({
        codigo: p.codigo,
        descricao: p.descricao,
        preco: precoDoTipo(p, tipo) ?? null,
        estoque: p.estoque,
        categoria: r.categoria,
        observacao: r.observacao,
        marcado: saldo > 0,
        quantidade: QTD_PADRAO[r.categoria],
        saldo,
      });
      porCategoria.set(r.categoria, lista);
    }
  }
  const ordem: CategoriaAcessorio[] = ['fonte', 'uplink', 'optico', 'acessorio'];
  return ordem.flatMap((c) =>
    (porCategoria.get(c) || [])
      .sort((a, b) => b.saldo - a.saldo || Number(b.estoque > 0) - Number(a.estoque > 0) || a.codigo.localeCompare(b.codigo))
      .slice(0, MAX_POR_CATEGORIA),
  );
}

// ---------------------------------------------------------------------------
// Slot-filling: respostas curtas, numeradas ou em linhas
// ---------------------------------------------------------------------------
export interface Slots {
  tipo?: TipoProposta | 'servico';
  cliente?: string;
  termo?: string;
  quantidade?: number;
  valor?: number;
  frete?: number;
  freteIncluso?: boolean;
  freteADefinir?: boolean;
  prazoEntrega?: string;
  forma?: FormaPagamento | 'cartao';
  prazoMeses?: number;
  setup?: number;
  semSetup?: boolean;
  indice?: IndiceReajuste;
  aceitar?: boolean;
  escolha?: number;
  recusar?: boolean;
}

const num = (v: string): number | undefined => {
  const n = parseNumeroBR(v);
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

const ACEITAR_RE = /^(?:ok|okay|sim|s|pode ser|pode|padrao|o padrao|default|isso|beleza|blz|certo|confirmo|tanto faz|mantem|manter|manter padrao|aceito|esse mesmo|perfeito|segue|pode seguir)$/;
const RECUSAR_RE = /^(?:nao|n|nenhum|nenhuma|sem acessorios?|nao quero|dispenso|pular|pula|seguir sem|seguir sem acessorios?|sem nenhum acessorio|sem)$/;
const CLIENTE_FIM = String.raw`(?=\s+(?:com|frete|prazo|pagamento|forma|no boleto|via|valor|preco|no valor|pelo valor|por \d|durante|de (?:loca|alug|venda|vender|servi|suporte|instala|um|uma|\d)|\d+\s*(?:x|un)|e \d)|[,;.\n]|$)`;

/**
 * "/mês", "/mes", "/m6es" (erro de digitação), "p/ mês", "ao mês", "mensais" => "por mes".
 * Também "R$45,00" => "r$ 45,00". Entrada já sem acento e minúscula.
 */
export function normalizarMensal(t: string): string {
  return t
    .replace(/(\d)\s*\/\s*(?:m[a-z0-9]{0,4}s?|mensal)(?![a-z0-9])/g, '$1 por mes')
    .replace(/\b(?:p\/|ao|por|pelo)\s*m[e0-9]{1,2}s\b/g, 'por mes')
    .replace(/(\d)\s*(?:reais\s*)?(?:mensais|mensal|mensalmente)\b/g, '$1 por mes')
    .replace(/r\$\s*(?=\d)/g, 'r$ ');
}

function prazoTexto(n: number, uteis: boolean): string {
  return `${n} ${n === 1 ? 'dia' : 'dias'}${uteis ? ' úteis' : ''} após o aceite`;
}

/** Interpreta UMA linha (ou a mensagem toda) e devolve os campos reconhecidos. */
export function lerLinha(linhaBruta: string, campo?: CampoFluxo, etapa?: FluxoProposta['etapa'], tipoAtual?: TipoProposta | null): Slots {
  const s: Slots = {};
  const bruto = String(linhaBruta || '').trim();
  let t = normalizarMensal(foldTexto(bruto).replace(/\s+/g, ' ').trim());
  if (!t) return s;
  const consumir = (re: RegExp) => { t = t.replace(re, ' ').replace(/\s+/g, ' ').trim(); };

  if (ACEITAR_RE.test(t.replace(/[.!]+$/, ''))) return { aceitar: true };
  if (RECUSAR_RE.test(t.replace(/[.!]+$/, ''))) return { recusar: true };

  // Campo pedido + resposta só com número ("3 0", "2 5", "4 10").
  if (campo && /^\d[\d.,]*$/.test(t)) {
    const n = num(t);
    if (n !== undefined) {
      if (campo === 'quantidade' && n > 0) return { quantidade: n };
      if (campo === 'valor') return { valor: n };
      if (campo === 'frete') return n === 0 ? { freteIncluso: true } : { frete: n };
      if (campo === 'prazo') return { prazoEntrega: prazoTexto(n, true) };
      if (campo === 'meses' && Number.isInteger(n)) return { prazoMeses: n };
      if (campo === 'setup') return n === 0 ? { semSetup: true } : { setup: n };
      if (campo === 'tipo' && n >= 1 && n <= 4) return { tipo: TIPOS_PROPOSTA[n - 1] };
    }
  }
  if (!campo && (etapa === 'modelo' || etapa === 'cliente') && /^(?:opcao\s*)?\d{1,2}$/.test(t)) return { escolha: Number(t.replace(/\D+/g, '')) };
  if (campo === 'tipo' || etapa === 'tipo') {
    const tp = tipoPropostaNoTexto(t, true);
    if (tp) s.tipo = tp;
  }

  // Forma de pagamento
  const forma = normalizarFormaPagamento(t);
  if (forma && /\b(boleto|pix|ted|transferencia|doc|cartao|credito|debito)\b/.test(t)) {
    s.forma = forma;
    consumir(/\b(?:forma de pagamento|pagamento|forma|via|no|em|por)?\s*(?:boleto bancario|boleto|pix|ted|transferencia(?: bancaria)?|doc|cartao(?: de credito| de debito)?|credito|debito)\b/g);
  }
  // Frete
  if (/\b(?:frete\s*)?(?:incluso|incluido|inclusa|incluida|gratis|gratuito|cif)\b|\bsem (?:custo de )?frete\b|\bfrete (?:zero|0)\b/.test(t)) {
    s.freteIncluso = true;
    consumir(/\b(?:o\s+)?(?:frete\s*)?(?:e\s+|ja\s+|esta\s+)?(?:incluso|incluido|inclusa|incluida|gratis|gratuito|cif)\b|\bsem (?:custo de )?frete\b|\bfrete (?:zero|0)\b/g);
  } else if (/\bfrete\s*(?:a definir|fob|por conta do cliente)\b/.test(t)) {
    s.freteADefinir = true;
    consumir(/\bfrete\s*(?:a definir|fob|por conta do cliente)\b/g);
  } else {
    const fm = t.match(/\bfrete\s*(?:de\s*)?(?:r\$\s*)?(\d[\d.,]*)/);
    if (fm) {
      const v = num(fm[1]);
      if (v !== undefined) { if (v === 0) s.freteIncluso = true; else s.frete = v; }
      consumir(/\bfrete\s*(?:de\s*)?(?:r\$\s*)?\d[\d.,]*/g);
    }
  }
  // Prazo em meses (locação / serviço mensal)
  const mm = t.match(/\b(\d{1,3})\s*meses\b/);
  if (mm) { s.prazoMeses = Number(mm[1]); consumir(/\b(?:prazo\s*(?:de)?\s*)?\d{1,3}\s*meses\b/g); }
  // Prazo de entrega
  const pz = t.match(/\b(?:prazo(?: de entrega)?|entrega)\s*(?:de|em|:)?\s*(\d{1,3})\s*dias?(\s*uteis)?/) || t.match(/\b(\d{1,3})\s*dias?(\s*uteis)?\b/);
  if (pz) {
    s.prazoEntrega = prazoTexto(Number(pz[1]), !!pz[2] || campo === 'prazo');
    consumir(/\b(?:(?:prazo(?: de entrega)?|entrega)\s*(?:de|em|:)?\s*)?\d{1,3}\s*dias?(?:\s*uteis)?(?:\s*apos o aceite)?/g);
  } else if (/\b(imediat[oa]|pronta entrega|a pronta entrega)\b/.test(t)) {
    s.prazoEntrega = 'Imediato (pronta entrega)';
    consumir(/\b(?:prazo(?: de entrega)?\s*)?(?:a\s+)?(?:imediat[oa]|pronta entrega)\b/g);
  }
  // Setup / índice
  if (/\bsem setup\b/.test(t)) { s.semSetup = true; consumir(/\bsem setup\b/g); }
  const sm = t.match(/\b(?:setup|ativacao|implantacao)\s*(?:de\s*)?(?:r\$\s*)?(\d[\d.,]*)/);
  if (sm) { const v = num(sm[1]); if (v !== undefined) s.setup = v; consumir(/\b(?:setup|ativacao|implantacao)\s*(?:de\s*)?(?:r\$\s*)?\d[\d.,]*/g); }
  const im = t.match(/\b(ipca|igp-?m|ist(?: anatel)?|anatel|fixo|sem reajuste)\b/);
  if (im && (campo === 'indice' || tipoAtual === 'locacao' || tipoAtual === 'servico_mensal' || /reajuste|indice/.test(t))) {
    s.indice = normalizarIndice(im[1]);
    consumir(/\b(?:indice(?: de reajuste)?|reajuste)?\s*(?:ipca|igp-?m|ist(?: anatel)?|anatel|fixo|sem reajuste)\b/g);
  }
  // Valor unitário
  const vm = t.match(/\b(?:valor(?: unitario)?|preco(?: unitario)?|unitario|mensalidade|r\$)\s*(?:de\s*|:\s*)?(?:r\$\s*)?(\d[\d.,]*)/);
  if (vm) { const v = num(vm[1]); if (v !== undefined) s.valor = v; consumir(/\b(?:no |pelo )?(?:valor(?: unitario)?|preco(?: unitario)?|unitario|mensalidade|r\$)\s*(?:de\s*|:\s*)?(?:r\$\s*)?\d[\d.,]*(?:\s*por mes)?/g); }
  else {
    const vpm = t.match(/(?:^|\s)(\d[\d.,]*)\s*(?:reais\s*)?por mes\b/);
    if (vpm) { const v = num(vpm[1]); if (v !== undefined) s.valor = v; consumir(/(?:^|\s)\d[\d.,]*\s*(?:reais\s*)?por mes\b/g); }
  }
  consumir(/\b(?:no |pelo )?(?:valor\s*)?por mes\b/g);
  // Cliente (CNPJ, "cliente X", "para a X")
  const cnpj = bruto.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/);
  if (cnpj) {
    s.cliente = formatarCnpj(cnpj[0].replace(/\D+/g, ''));
    consumir(/\b(?:cnpj\s*)?\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g);
  } else {
    const cm = bruto.match(new RegExp(String.raw`\b(?:cliente|empresa)\s*[:=-]?\s*(.+?)${CLIENTE_FIM}`, 'i')) ||
      bruto.match(new RegExp(String.raw`\b(?:para|pra|pro)\s+(?:(?:a|o)\s+)?(?:(?:cliente|empresa)\s+)?([A-Za-zÀ-ÿ0-9][^,;\n]*?)${CLIENTE_FIM}`, 'i'));
    if (cm && cm[1] && !/^\d+$/.test(cm[1].trim())) {
      const nome = cm[1].replace(/\s+/g, ' ').trim().replace(/^(?:a|o)\s+/i, '');
      if (nome && !/^(?:venda|locacao|locação|aluguel|servico|serviço)$/i.test(nome)) {
        s.cliente = nome.slice(0, 160);
        const f = foldTexto(nome).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        consumir(new RegExp(String.raw`\b(?:(?:para|pra|pro)\s+(?:(?:a|o)\s+)?)?(?:(?:cliente|empresa)\s*[:=-]?\s*)?(?:(?:a|o)\s+)?${f}`, 'g'));
      }
    } else if (campo === 'cliente' && t.length >= 2) {
      s.cliente = bruto.replace(/^\s*\d{1,2}\s*[).:\-–]?\s*/, '').slice(0, 160);
      return s;
    }
  }
  // Tipo pela frase (só quando ainda não há tipo, ou a linha é curta e clara)
  if (!s.tipo) {
    const curta = t.split(' ').length <= 3;
    const tp = tipoPropostaNoTexto(t);
    if (tp && (!tipoAtual || campo === 'tipo' || (curta && /^(?:proposta de |de |e )?(?:venda|vender|vendas|produtos?|locacao|aluguel|alugar|servicos?|instalacao|suporte|pontual|mensal)\b/.test(t)))) s.tipo = tp;
  }
  // Quantidade + produto no que sobrou
  const qtd = t.match(/\b(?:qtd|quantidade)\s*[:=]?\s*(\d{1,5})\b/) || t.match(/(?:^|\s)(\d{1,5})\s*(?:x\s+|un\w*\s+|pecas?\s+|pcs\s+)?(?=[a-z])(?!(?:m|cm|mm|w|g|gb|tb)\b)/);
  if (qtd) {
    const n = Number(qtd[1]);
    if (n > 0 && n <= 100000) s.quantidade = n;
    consumir(/\b(?:qtd|quantidade)\s*[:=]?\s*\d{1,5}\b/);
    t = t.replace(new RegExp(String.raw`(?:^|\s)${qtd[1]}\s*(?:x\s+|un\w*\s+|pecas?\s+|pcs\s+)?(?=[a-z])(?!(?:m|cm|mm|w|g|gb|tb)\b)`), ' ').trim();
  } else if (campo === 'quantidade' && /^\d{1,5}$/.test(t)) {
    s.quantidade = Number(t);
    t = '';
  }
  const termo = termoProduto(t);
  if (termo && (campo === 'produto' || etapa === 'produto' || etapa === 'modelo' || /\d/.test(termo))) s.termo = termo;
  return s;
}

/** Divide a mensagem em linhas ("1 Venda / 1 C3850 / 3 incluso") e lê cada uma. */
export function lerResposta(texto: string, fluxo: Pick<FluxoProposta, 'pergunta' | 'etapa' | 'tipo'>): Slots {
  const linhas = String(texto || '')
    .split(/\n|\s+\/\s+|;|\s+\|\s+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: Slots = {};
  linhas.forEach((linha, idx) => {
    const pos = idx + 1;
    let campo: CampoFluxo | undefined;
    let resto = linha;
    const m = linha.match(/^\s*(\d{1,2})\s*(?:([).:\-–])\s*|\s+)(.+)$/);
    if (m && linhas.length >= 2) {
      const n = Number(m[1]);
      const explicito = !!m[2];
      // "1 C3850" na 2a linha: o 1 e a quantidade (nao e o numero do campo).
      if (explicito || n === pos) {
        resto = m[3];
        campo = fluxo.pergunta?.[n - 1];
      }
    }
    const s = lerLinha(resto, campo, linhas.length > 1 ? undefined : fluxo.etapa, fluxo.tipo);
    for (const [k, v] of Object.entries(s)) {
      if (v === undefined) continue;
      if (k === 'termo' && out.termo) continue;
      if (k === 'aceitar' && Object.keys(out).length && linhas.length > 1) continue; // "4 ok" = manter o padrao daquele campo
      (out as any)[k] = v;
    }
  });
  if (linhas.length > 1) delete out.aceitar;
  return out;
}

const VAZIO = (s: Slots) => Object.values(s).every((v) => v === undefined);

/** Mensagem claramente nova (consulta, dúvida do sistema, outro registro): sai do fluxo. */
export function pedidoNovoForaDoFluxo(texto: string): boolean {
  const t = foldTexto(texto).trim();
  if (/^(?:liste|listar|lista|mostre|mostrar|mostra|quais|quantos|quantas|consulte|consultar|consulta|busque|buscar|busca|procure|procurar|localize|localizar|abra|abrir|como|onde|por que|porque|o que|qual (?:e|o|a) (?:status|situacao)|traga|me (?:mostre|traga|de|diga)|relatorio|painel|status|situacao|edite|editar|altere|alterar|adicione|acrescente)\b/.test(t)) return true;
  if (/\b(?:proposta|orcamento|contrato|fatura|nota|os|chamado)\s*(?:n[o°º.]*\s*|#\s*)?\d{3,}\b|\bseta-\d+\b|prop-[a-z0-9]|\/p\/|\/proposta\//.test(t)) return true;
  if (/\b(?:boletos?|faturas?|notas? fisca\w*)\s+(?:vencid|em aberto|abert|pag[oa]s?|do mes)/.test(t)) return true;
  return false;
}

export const CANCELAR_RE = /^(?:cancel(?:a|e|ar)(?: (?:a|o|essa|esse) (?:proposta|rascunho|orcamento))?|esquec[ea](?: isso)?|deixa (?:pra|para) la|desist[oi]|para(?: tudo)?|pare)$/;

/** O assistente pediu campos de proposta numerados (fluxo antigo, sem estado salvo)? */
export function camposPedidosNoTexto(textoAssistente: string): CampoFluxo[] | null {
  const t = String(textoAssistente || '');
  const f = foldTexto(t);
  if (!/(proposta|orcamento|rascunho)/.test(f)) return null;
  const linhas = t.split('\n').map((l) => foldTexto(l).trim()).filter((l) => /^(?:\d{1,2}\s*[).:\-–]|[-•*]\s)/.test(l));
  if (linhas.length < 2) return null;
  const mapa: Array<[RegExp, CampoFluxo]> = [
    [/\btipo\b/, 'tipo'],
    [/\bfrete\b/, 'frete'],
    [/\bprazo de entrega|\bentrega\b/, 'prazo'],
    [/\bforma de pagamento|\bpagamento\b/, 'forma'],
    [/\bmeses\b|\bprazo do contrato\b/, 'meses'],
    [/\bsetup|ativacao|implantacao\b/, 'setup'],
    [/\breajuste|indice\b/, 'indice'],
    [/\bvalor|preco|mensalidade\b/, 'valor'],
    [/\bquantidade\b/, 'quantidade'],
    [/\bcliente|empresa\b/, 'cliente'],
    [/\bitens?|produtos?|equipamentos?|modelo|servicos?\b/, 'produto'],
  ];
  const campos = linhas.map((l) => mapa.find(([re]) => re.test(l))?.[1]).filter((c): c is CampoFluxo => !!c);
  return campos.length >= 2 ? campos.slice(0, 8) : null;
}

/** Remonta o fluxo a partir do histórico (conversa antiga, antes do estado salvo). */
export function fluxoDoHistorico(mensagens: Msg[]): FluxoProposta | null {
  const anterior = mensagens.length >= 2 ? mensagens[mensagens.length - 2] : null;
  if (!anterior || anterior.papel !== 'assistente') return null;
  const campos = camposPedidosNoTexto(anterior.texto);
  if (!campos) return null;
  const f = novoFluxo(tipoPropostaDaConversa(mensagens.slice(0, -1)));
  f.pergunta = campos;
  // Cliente e produto ditos antes, desde o pedido que abriu a proposta.
  for (let k = mensagens.length - 2; k >= 0 && k >= mensagens.length - 12; k--) {
    const m = mensagens[k];
    if (m.papel !== 'usuario') continue;
    const s = lerLinha(m.texto, undefined, undefined, f.tipo);
    if (!f.cliente && s.cliente) f.cliente = s.cliente;
    if (!f.termo && s.termo) f.termo = s.termo;
    if (!f.quantidade && s.quantidade) f.quantidade = s.quantidade;
    if (!f.tipo && s.tipo && s.tipo !== 'servico') f.tipo = s.tipo;
    if (pedidoNovaProposta(m.texto)) break;
  }
  return f;
}

/** O pedido novo é o mesmo do rascunho atual (mesmo tipo, cliente e item)? */
export function mesmoPedido(f: FluxoProposta, s: Slots): boolean {
  if (s.tipo && s.tipo !== 'servico' && f.tipo && s.tipo !== f.tipo) return false;
  const ditos = [f.clienteDito, f.cliente, f.clienteOk?.split(' — ')[0]];
  if (s.cliente && !ditos.some((d) => mesmoTexto(s.cliente, d))) return false;
  if (s.termo && !mesmoTexto(s.termo, f.termo) && !f.itens.some((i) => compactPn(i.codigo) === compactPn(s.termo))) return false;
  return !!(s.cliente || s.termo);
}

/** Resposta curta de campo ("boleto", "pix", "IGP-M", "sim", "24 meses", "36")? */
export function respostaCurtaDeCampo(texto: string): boolean {
  const t = foldTexto(texto).replace(/[.!]+$/, '').trim();
  if (!t || t.split(/\s+/).length > 5 || pedidoNovoForaDoFluxo(texto) || pedidoNovaProposta(texto)) return false;
  if (/^\d[\d.,]*$/.test(t)) return true;
  const s = lerLinha(texto, undefined, undefined, 'locacao');
  return !!(s.forma || s.indice || s.aceitar || s.prazoMeses || s.valor !== undefined || s.freteIncluso || s.frete !== undefined || s.prazoEntrega || s.setup !== undefined || s.semSetup);
}

/**
 * Conversa sem estado salvo (reaberta, ou de quando o pedido ia para o modelo): remonta o
 * rascunho com o último pedido de proposta e as respostas dadas depois dele.
 */
export async function fluxoPendenteDoHistorico(texto: string, mensagens: Msg[], ctx: CtxFluxo): Promise<FluxoProposta | null> {
  if (!respostaCurtaDeCampo(texto)) return null;
  const respostas: string[] = [];
  let pedido: string | null = null;
  for (let k = mensagens.length - 2; k >= 0 && k >= mensagens.length - 20; k--) {
    const m = mensagens[k];
    if (m.papel === 'assistente') {
      if (/rascunho de proposta[^\n]*criado/i.test(m.texto) || /\bcancelei esse rascunho\b/i.test(m.texto)) return null;
      continue;
    }
    if (pedidoNovaProposta(m.texto)) { pedido = m.texto; break; }
    if (pedidoNovoForaDoFluxo(m.texto)) return null;
    respostas.unshift(m.texto);
  }
  if (!pedido) return null;
  const base = await avancarFluxo({ texto: pedido, mensagens: [] }, { ...ctx, aprender: undefined });
  if (!base || !('fluxo' in base) || !base.fluxo) return null;
  const f = base.fluxo;
  for (const r of respostas) {
    const s = lerResposta(r, f);
    aplicarSlots(f, { ...s, termo: undefined, escolha: undefined, aceitar: undefined, recusar: undefined, cliente: undefined });
  }
  return f;
}

// ---------------------------------------------------------------------------
// Passo do fluxo
// ---------------------------------------------------------------------------
export interface CtxFluxo {
  api: ApiCaller;
  memorias: MemoriaAprendida[];
  regras: RegraAcessorio[];
  /** Grava aceite/recusa de sugestão (aprendizado). */
  aprender?(ev: { familia: string; item: string; aceito: boolean }): Promise<void>;
}

export interface OpcaoModelo { codigo: string; descricao: string; preco: number | null; estoque: number }

export type SaidaFluxo =
  | { tipo: 'texto'; texto: string; fluxo: FluxoProposta | null }
  | { tipo: 'escolha_produto'; texto: string; opcoes: OpcaoModelo[]; quantidade: number; precoRotulo: string; fluxo: FluxoProposta }
  | { tipo: 'sugestao_acessorios'; texto: string; base: { codigo: string; descricao: string }; grupos: Array<{ categoria: CategoriaAcessorio; rotulo: string; itens: SugestaoAcessorio[] }>; fluxo: FluxoProposta }
  | { tipo: 'escolha_cliente'; texto: string; opcoes: Array<{ indice: number; nome: string; cnpj: string }>; fluxo: FluxoProposta }
  | { tipo: 'cartao'; args: Record<string, unknown>; texto: string; fluxo: FluxoProposta }
  /** Serviço: segue o fluxo antigo (modelo monta o rascunho com o tipo). */
  | { tipo: 'servico'; tipoProposta: TipoProposta | 'servico' }
  /** Pedido já detalhado (valores, prazo em meses, itens livres): o modelo monta o rascunho, como antes. */
  | { tipo: 'legado' };

export interface EntradaFluxo {
  texto: string;
  selecao?: SelecaoFluxo | null;
  fluxo?: FluxoProposta | null;
  mensagens: Msg[];
}

const textoSaida = (texto: string, fluxo: FluxoProposta | null): SaidaFluxo => ({ tipo: 'texto', texto, fluxo });

/** Pedido que já traz valores ou prazo do contrato (o modelo extrai os itens livres com os valores). */
export function pedidoDetalhado(texto: string): boolean {
  const t = foldTexto(texto);
  return /r\$|\b\d{1,3}(?:\.\d{3})*,\d{2}\b|\b(?:valor|mensalidade|setup|ativacao|implantacao|preco)\s*(?:de\s*|:\s*)?(?:r\$\s*)?\d|\bpor mes\b|\b\d{1,3}\s*meses\b/.test(t);
}

function aplicarSlots(f: FluxoProposta, s: Slots): string[] {
  const anotado: string[] = [];
  if (s.tipo && s.tipo !== 'servico' && s.tipo !== f.tipo) f.tipo = s.tipo;
  if (s.cliente && s.cliente !== f.cliente && !mesmoTexto(s.cliente, f.clienteDito) && !mesmoTexto(s.cliente, f.clienteOk?.split(' — ')[0])) {
    f.cliente = s.cliente;
    f.clienteDito = s.cliente.slice(0, 160);
    delete f.clienteOk;
    delete f.candidatos;
  }
  if (s.quantidade) {
    f.quantidade = s.quantidade;
    if (f.itens.length && !s.termo) { f.itens[0].quantidade = s.quantidade; }
    anotado.push(`quantidade ${s.quantidade}`);
  }
  const sufixo = f.tipo === 'locacao' || f.tipo === 'servico_mensal' ? '/mês' : '';
  if (s.valor !== undefined && f.itens.length) { f.itens[0].valor = s.valor; anotado.push(`valor unitário ${formatBRL(s.valor)}${sufixo}`); }
  else if (s.valor !== undefined) { f.valor = s.valor; anotado.push(`valor ${formatBRL(s.valor)}${sufixo}`); }
  if (s.freteIncluso) { f.freteIncluso = true; delete f.frete; anotado.push('frete incluso'); }
  if (s.frete !== undefined) { f.frete = s.frete; delete f.freteIncluso; anotado.push(`frete ${formatBRL(s.frete)}`); }
  if (s.freteADefinir) { delete f.frete; delete f.freteIncluso; anotado.push('frete a definir'); }
  if (s.prazoEntrega) { f.prazoEntrega = s.prazoEntrega; anotado.push(`prazo de entrega ${s.prazoEntrega}`); }
  if (s.forma && s.forma !== 'cartao') { f.forma = s.forma; anotado.push(`pagamento ${ROTULO_FORMA_PAGAMENTO[s.forma]}`); }
  if (s.prazoMeses) { f.prazoMeses = s.prazoMeses; anotado.push(`${s.prazoMeses} meses`); }
  if (s.setup !== undefined) { f.setup = s.setup; anotado.push(`setup ${formatBRL(s.setup)}`); }
  if (s.semSetup) { delete f.setup; anotado.push('sem setup'); }
  if (s.indice) { f.indice = s.indice; anotado.push(`reajuste ${s.indice}`); }
  return anotado;
}

const mesmoTexto = (a?: string, b?: string) => !!a && !!b && compactPn(foldTexto(a)) === compactPn(foldTexto(b));

const anotacao = (a: string[]) => (a.length ? `Anotei: ${a.join(', ')}.\n` : '');

function opcaoModelo(p: ProdutoCatalogo, tipo: TipoProposta | null): OpcaoModelo {
  return { codigo: p.codigo, descricao: p.descricao, preco: precoDoTipo(p, tipo) ?? null, estoque: p.estoque };
}

const achaNoCatalogo = (catalogo: ProdutoCatalogo[], codigo: string) => {
  const c = compactPn(codigo);
  return catalogo.find((p) => p.pn === c || compactPn(p.codigo) === c) || null;
};

function itemDoProduto(p: ProdutoCatalogo, quantidade: number, tipo: TipoProposta | null, valor?: number): ItemFluxo {
  const v = valor ?? precoDoTipo(p, tipo);
  return { codigo: p.codigo, descricao: p.descricao.slice(0, 200), quantidade, ...(v !== undefined ? { valor: v } : {}) };
}

/** Avança o fluxo. null = não é (mais) fluxo de proposta: segue o roteamento normal. */
export async function avancarFluxo(e: EntradaFluxo, ctx: CtxFluxo): Promise<SaidaFluxo | null> {
  const texto = String(e.texto || '').trim();
  let f: FluxoProposta | null = e.fluxo ? (JSON.parse(JSON.stringify(e.fluxo)) as FluxoProposta) : null;
  let anotado: string[] = [];

  if (e.selecao) {
    if (!f) return textoSaida('Essa lista expirou. Peça a proposta de novo.', null);
    return aplicarSelecao(f, e.selecao, ctx);
  }

  const novaProposta = pedidoNovaProposta(texto) || (!f && /^(?:quero |preciso )?(?:vender|alugar)\b/.test(foldTexto(texto)));
  const sNova = novaProposta ? lerLinha(texto, undefined, undefined, null) : null;
  // t195u: o mesmo pedido repetido (mesmo tipo, cliente e item) reaproveita o rascunho da conversa.
  const repetido = !!(f && sNova && mesmoPedido(f, sNova));
  if (novaProposta && sNova && !repetido) {
    const s = sNova;
    if (s.tipo === 'servico' || s.tipo === 'servico_pontual' || s.tipo === 'servico_mensal') return { tipo: 'servico', tipoProposta: s.tipo };
    if (s.forma === 'cartao') return textoSaida(MENSAGEM_SEM_CARTAO, { ...novoFluxo(s.tipo ?? null), ...(s.cliente ? { cliente: s.cliente, clienteDito: s.cliente } : {}), ...(s.termo ? { termo: s.termo } : {}), ...(s.quantidade ? { quantidade: s.quantidade } : {}), pergunta: ['forma'] });
    if (s.tipo === 'locacao' || pedidoDetalhado(texto)) {
      // Pedido com valores/prazo ou de locação: guiado quando o item está no cadastro (o rascunho
      // fica no estado da conversa). Item livre (servidor sob medida, nuvem) segue com o modelo, como antes.
      const catalogo = s.termo ? await carregarCatalogo(ctx.api) : null;
      if (!s.termo || !catalogo || !buscarModelos(catalogo, s.termo, ctx.regras).length) return { tipo: 'legado' };
    }
    f = novoFluxo(s.tipo ?? null);
    anotado = aplicarSlots(f, { ...s, tipo: undefined });
    if (s.termo) f.termo = s.termo;
    anotado = anotado.filter((a) => !a.startsWith('quantidade'));
  } else {
    if (!f && !novaProposta) {
      f = fluxoDoHistorico(e.mensagens);
      // Recuperação de conversa antiga só para Produtos (locação/serviço seguem com o modelo).
      if (f && f.tipo && f.tipo !== 'produtos') f = null;
      // t195u: resposta curta ("boleto", "IGP-M", "sim", número) numa conversa sem estado salvo
      // (reaberta ou de antes): remonta o rascunho a partir do pedido e das respostas anteriores.
      if (!f) f = await fluxoPendenteDoHistorico(texto, e.mensagens, ctx);
    }
    if (!f) return null;

    const t = foldTexto(texto).replace(/[.!]+$/, '').trim();
    if (CANCELAR_RE.test(t)) return textoSaida('Ok, cancelei esse rascunho de proposta. Nada foi gravado.', null);
    if (pedidoNovoForaDoFluxo(texto)) return null;
    const s = repetido && sNova ? { ...sNova, tipo: undefined } : lerResposta(texto, f);
    // Etapa com resposta livre: o texto todo é o dado pedido.
    if (VAZIO(s)) {
      if (f.etapa === 'cliente' && texto.length >= 2 && texto.split(/\s+/).length <= 8) s.cliente = texto.slice(0, 160);
      else if ((f.etapa === 'produto' || f.etapa === 'modelo') && termoProduto(texto)) s.termo = termoProduto(texto);
      else if (texto.split(/\s+/).length > 10) return null; // frase longa sem nenhum dado do fluxo: pedido novo
    }
    if (f.etapa === 'tipo' && s.tipo) {
      if (s.tipo === 'servico' || s.tipo === 'servico_pontual' || s.tipo === 'servico_mensal') return { tipo: 'servico', tipoProposta: s.tipo };
    }
    if (s.forma === 'cartao') return textoSaida(MENSAGEM_SEM_CARTAO, { ...f, pergunta: ['forma'] });
    // Escolha por número na lista.
    if (s.escolha && f.etapa === 'modelo' && f.opcoes?.[s.escolha - 1]) {
      return aplicarSelecao(f, { tipo: 'modelo', codigo: f.opcoes[s.escolha - 1] }, ctx);
    }
    if (s.escolha && f.etapa === 'cliente' && f.candidatos?.[s.escolha - 1]) {
      return aplicarSelecao(f, { tipo: 'cliente', indice: s.escolha - 1 }, ctx);
    }
    if (f.etapa === 'acessorios') {
      if (s.recusar) return aplicarSelecao(f, { tipo: 'acessorios', itens: [] }, ctx);
      if (s.aceitar) return aplicarSelecao(f, { tipo: 'acessorios', itens: [], aceitarMarcados: true } as any, ctx);
    }
    if (f.etapa === 'pronto' && s.aceitar && VAZIO({ ...s, aceitar: undefined })) {
      // "sim"/"ok" com tudo preenchido: mostra o cartão de novo (a gravação continua no Confirmar).
      return continuar(f, ctx, ['tudo certo; é só clicar em Confirmar']);
    }
    // Número solto sem pergunta pendente: não adivinha o campo (nem vira outra consulta).
    if (VAZIO(s) && /^\d[\d.,]*$/.test(foldTexto(texto).trim()) && !f.pergunta?.length && (f.etapa === 'pronto' || f.etapa === 'acessorios')) {
      const mensal = f.tipo === 'locacao' || f.tipo === 'servico_mensal';
      return textoSaida(`"${texto.trim()}" é para qual campo? Diga, por exemplo: ${mensal ? '"24 meses", "valor 45,00"' : '"quantidade 2", "valor 3.500"'} ou "frete 150".`, f);
    }
    anotado = aplicarSlots(f, s);
    if (repetido) anotado = ['reaproveitei o rascunho desta conversa'];
    // Produto novo dito (diferente do já escolhido): volta para a lista de modelos.
    if (s.termo) {
      const jaTem = f.itens.some((i) => compactPn(i.codigo).includes(compactPn(s.termo)) || compactPn(s.termo).includes(compactPn(i.codigo)));
      const mesmo = f.termo && compactPn(f.termo) === compactPn(s.termo);
      if (!jaTem && !(mesmo && f.etapa !== 'produto' && f.etapa !== 'modelo')) {
        // Codigo exato de uma opcao da lista = escolha direta.
        const exato = f.opcoes?.find((c) => compactPn(c) === compactPn(s.termo));
        if (exato && f.etapa === 'modelo') {
          f.termo = s.termo;
          return aplicarSelecao(f, { tipo: 'modelo', codigo: exato, ...(s.quantidade ? { quantidade: s.quantidade } : {}) }, ctx, anotado.filter((a) => !a.startsWith('quantidade')));
        }
        if (f.etapa === 'pronto' || f.etapa === 'acessorios') f.itens = [];
        f.termo = s.termo;
        delete f.base;
        delete f.opcoes;
      }
    }
  }
  delete f.pergunta;
  return continuar(f, ctx, anotado);
}

async function aplicarSelecao(f: FluxoProposta, sel: SelecaoFluxo & { aceitarMarcados?: boolean }, ctx: CtxFluxo, anotado: string[] = []): Promise<SaidaFluxo> {
  if (sel.tipo === 'tipo_proposta') {
    if (sel.valor === 'servico_pontual' || sel.valor === 'servico_mensal') return { tipo: 'servico', tipoProposta: sel.valor };
    f.tipo = sel.valor;
    return continuar(f, ctx, anotado);
  }
  if (sel.tipo === 'cliente') {
    const c = f.candidatos?.[sel.indice];
    if (!c) return textoSaida('Opção de empresa inválida. Informe o nome ou o CNPJ.', { ...f, etapa: 'cliente' });
    f.cliente = c.cnpj ? `${c.nome} — CNPJ ${c.cnpj}` : c.nome;
    delete f.candidatos;
    delete f.clienteOk;
    return continuar(f, ctx, anotado);
  }
  const catalogo = await carregarCatalogo(ctx.api);
  if (!catalogo) return textoSaida('Não consegui consultar o cadastro de produtos agora. Tente de novo.', f);
  if (sel.tipo === 'modelo') {
    // Só item real do cadastro (nunca o que veio do navegador sem conferir).
    const p = achaNoCatalogo(catalogo, sel.codigo);
    if (!p) return textoSaida(`O código ${sel.codigo} não está no cadastro de produtos. Escolha um modelo da lista.`, f);
    const qtd = sel.quantidade || f.quantidade || 1;
    f.itens = [itemDoProduto(p, qtd, f.tipo, sel.valor ?? f.valor)];
    delete f.valor;
    f.base = p.codigo;
    delete f.opcoes;
    const sugestoes = sugerirAcessorios(p, catalogo, ctx.regras, ctx.memorias, f.tipo);
    if (sugestoes.length) {
      f.etapa = 'acessorios';
      f.sugeridos = sugestoes.map((x) => x.codigo);
      const grupos = (['fonte', 'uplink', 'optico', 'acessorio'] as CategoriaAcessorio[])
        .map((categoria) => ({ categoria, rotulo: ROTULO_CATEGORIA[categoria], itens: sugestoes.filter((x) => x.categoria === categoria) }))
        .filter((g) => g.itens.length);
      return {
        tipo: 'sugestao_acessorios',
        texto: `${anotacao(anotado)}Modelo: ${p.codigo} (${qtd} un.). Acessórios compatíveis no cadastro — marque os que quer incluir e ajuste a quantidade:`,
        base: { codigo: p.codigo, descricao: p.descricao },
        grupos,
        fluxo: f,
      };
    }
    return continuar(f, ctx, [...anotado, `modelo ${p.codigo}`]);
  }
  // Acessórios escolhidos
  const base = f.base ? achaNoCatalogo(catalogo, f.base) : null;
  const sugestoes = base ? sugerirAcessorios(base, catalogo, ctx.regras, ctx.memorias, f.tipo) : [];
  const permitidos = new Map(sugestoes.map((x) => [compactPn(x.codigo), x]));
  const escolhidos = sel.aceitarMarcados
    ? sugestoes.filter((x) => x.marcado).map((x) => ({ codigo: x.codigo, quantidade: x.quantidade, valor: undefined as number | undefined }))
    : sel.itens;
  const novos: ItemFluxo[] = [];
  for (const it of escolhidos) {
    const sug = permitidos.get(compactPn(it.codigo));
    const p = achaNoCatalogo(catalogo, it.codigo);
    if (!sug || !p) continue; // nunca inclui item fora da sugestão / fora do cadastro
    novos.push(itemDoProduto(p, it.quantidade, f.tipo, it.valor));
  }
  const baseItem = f.itens.find((i) => base && compactPn(i.codigo) === base.pn) || f.itens[0];
  f.itens = [...(baseItem ? [baseItem] : []), ...novos].slice(0, 30);
  // Aprendizado: aceitos e recusados (os que estavam na lista e não foram marcados).
  if (base && ctx.aprender) {
    const familias = familiasDoModelo(base.pn, ctx.regras);
    const familia = familias[0];
    if (familia) {
      const aceitos = new Set(novos.map((n) => compactPn(n.codigo)));
      for (const sug of sugestoes) {
        const aceito = aceitos.has(compactPn(sug.codigo));
        // Recusa só conta para o que veio marcado (sugestão aprendida recusada) ou quando o usuário escolheu outro da mesma categoria.
        const mesmaCategoriaEscolhida = novos.some((n) => permitidos.get(compactPn(n.codigo || ''))?.categoria === sug.categoria);
        if (aceito || sug.marcado || mesmaCategoriaEscolhida) {
          await ctx.aprender({ familia, item: sug.codigo, aceito }).catch(() => undefined);
        }
      }
    }
  }
  delete f.sugeridos;
  f.etapa = 'pronto';
  return continuar(f, ctx, [...anotado, novos.length ? `${novos.length} acessório(s)` : 'sem acessórios']);
}

async function continuar(f: FluxoProposta, ctx: CtxFluxo, anotado: string[]): Promise<SaidaFluxo> {
  delete f.pergunta;
  // 1) Tipo
  if (!f.tipo) {
    f.etapa = 'tipo';
    f.pergunta = ['tipo'];
    return textoSaida(`${anotacao(anotado)}${PERGUNTA_TIPO_PROPOSTA}`, f);
  }
  // 2a) Item dito que só tem um modelo no cadastro (sem acessórios a sugerir): já entra no
  //     rascunho, antes de perguntar a unidade do cliente (t195u: "cabo stack 1m" => STACK-T1-1M).
  if (f.cliente && !f.clienteOk && !f.itens.length && f.termo) {
    const catalogo = await carregarCatalogo(ctx.api);
    const modelos = catalogo ? buscarModelos(catalogo, f.termo, ctx.regras) : [];
    if (catalogo && modelos.length === 1 && !sugerirAcessorios(modelos[0], catalogo, ctx.regras, ctx.memorias, f.tipo).length) {
      f.itens = [itemDoProduto(modelos[0], f.quantidade || 1, f.tipo, f.valor)];
      f.base = modelos[0].codigo;
      delete f.valor;
      anotado = [...anotado, `item ${modelos[0].codigo}`];
    }
  }
  // 2) Cliente dito: identifica no cadastro logo (se houver mais de um, lista para escolher).
  if (f.cliente && !f.clienteOk) {
    const emp = await resolverEmpresa(f.cliente, ctx.api).catch(() => null);
    if (!emp) return textoSaida('Não consegui consultar o cadastro de empresas agora. Tente de novo.', f);
    if (emp.ok) {
      const c = emp.company;
      f.clienteOk = c?.cnpj ? `${String(c.name || '').trim()} — CNPJ ${String(c.cnpj).trim()}` : String(c?.name || '').trim();
      delete f.candidatos;
    } else if (emp.candidatos.length > 1) {
      f.etapa = 'cliente';
      f.candidatos = emp.candidatos.slice(0, 5).map((c: any) => ({ nome: String(c?.name || '').slice(0, 160), ...(c?.cnpj ? { cnpj: String(c.cnpj).slice(0, 30) } : {}) }));
      return {
        tipo: 'escolha_cliente',
        texto: `${anotacao(anotado)}Encontrei ${emp.candidatos.length} empresas para "${f.cliente}". Qual delas?`,
        opcoes: f.candidatos.map((c, indice) => ({ indice, nome: c.nome, cnpj: c.cnpj || '' })),
        fluxo: f,
      };
    } else {
      const quem = f.cliente;
      delete f.cliente;
      f.etapa = 'cliente';
      f.pergunta = ['cliente'];
      return textoSaida(`${anotacao(anotado)}Não encontrei a empresa "${quem}" no cadastro. Informe o nome completo ou o CNPJ.`, f);
    }
  }
  // 3) Produto: busca no cadastro e abre a lista de modelos.
  if (!f.itens.length) {
    if (!f.termo) {
      f.etapa = 'produto';
      f.pergunta = ['produto'];
      const quem = f.clienteOk ? ` para ${f.clienteOk.split(' — ')[0]}` : '';
      return textoSaida(
        `${anotacao(anotado)}Proposta de ${ROTULO_TIPO_PROPOSTA[f.tipo]}${quem}. Qual produto e quantidade? (ex.: 1 switch Cisco 3850)\n` +
          'Eu busco no cadastro e mostro os modelos para você escolher. Frete, prazo de entrega e forma de pagamento usam o padrão e aparecem no cartão para ajuste.',
        f,
      );
    }
    const catalogo = await carregarCatalogo(ctx.api);
    if (!catalogo) return textoSaida('Não consegui consultar o cadastro de produtos agora. Tente de novo.', f);
    const modelos = buscarModelos(catalogo, f.termo, ctx.regras);
    if (!modelos.length) {
      const termo = f.termo;
      delete f.termo;
      f.etapa = 'produto';
      f.pergunta = ['produto'];
      return textoSaida(`${anotacao(anotado)}Não encontrei "${termo}" no cadastro de produtos. Confira o modelo ou o código (ex.: WS-C3850-48P-S).`, f);
    }
    if (modelos.length === 1) return aplicarSelecao(f, { tipo: 'modelo', codigo: modelos[0].codigo }, ctx, anotado);
    f.etapa = 'modelo';
    f.opcoes = modelos.map((m) => m.codigo);
    const qtd = f.quantidade || 1;
    return {
      tipo: 'escolha_produto',
      texto: `${anotacao(anotado)}Encontrei ${modelos.length} modelos de "${f.termo}" no cadastro. Escolha um (quantidade ${qtd}; o valor vem do cadastro e pode ser ajustado):`,
      opcoes: modelos.map((m) => opcaoModelo(m, f.tipo)),
      quantidade: qtd,
      precoRotulo: f.tipo === 'locacao' ? 'Locação/mês' : 'Preço de venda',
      fluxo: f,
    };
  }
  if (f.etapa === 'acessorios') {
    // Ajuste de campo durante a sugestão: repete a sugestão.
    return aplicarSelecao(f, { tipo: 'modelo', codigo: f.base || f.itens[0].codigo || '', quantidade: f.itens[0].quantidade, valor: f.itens[0].valor }, ctx, anotado);
  }
  // 4) Cliente ainda não dito.
  if (!f.clienteOk) {
    f.etapa = 'cliente';
    f.pergunta = ['cliente'];
    return textoSaida(`${anotacao(anotado)}Para qual cliente é a proposta? (nome ou CNPJ)`, f);
  }
  // 5) Locação: prazo em meses.
  if (f.tipo === 'locacao' && !f.prazoMeses) {
    f.etapa = 'meses';
    f.pergunta = ['meses'];
    return textoSaida(`${anotacao(anotado)}Qual o prazo do contrato de locação em meses? (ex.: 12, 24, 36)`, f);
  }
  // 6) Cartão de confirmação (frete, prazo e forma com padrão, ajustáveis).
  f.etapa = 'pronto';
  const args: Record<string, unknown> = {
    cliente: f.clienteOk,
    tipo_proposta: f.tipo,
    itens: f.itens.map((i) => ({ descricao: i.descricao, quantidade: i.quantidade, ...(i.valor ? { valor_unitario: i.valor } : {}), ...(i.codigo ? { codigo: i.codigo } : {}) })),
    ...(f.freteIncluso ? { frete_incluso: true } : f.frete ? { frete: f.frete } : {}),
    ...(f.prazoEntrega ? { prazo_entrega: f.prazoEntrega } : {}),
    ...(f.forma ? { forma_pagamento: f.forma } : {}),
    ...(f.tipo === 'locacao' ? { prazo_meses: f.prazoMeses, ...(f.setup ? { setup: f.setup } : {}), ...(f.indice ? { indice_reajuste: f.indice } : {}) } : {}),
  };
  return {
    tipo: 'cartao',
    args,
    texto: `${anotacao(anotado)}Preparei o rascunho para você conferir. Para ajustar, é só dizer (ex.: "frete 150", "prazo 10 dias", "pix", "valor 3.500").`,
    fluxo: f,
  };
}

export const __test = { compactPn };
