// ============================================================================
// STI-hub ERP - Configurações gerais (modelo, padrões e funções puras)
// Persistência: as preferências vão em generalParameters.erpConfigGerais pelo
// PUT /api/admin/settings já existente (handleSaveAdminSettings). Esse endpoint
// guarda as configurações na instância do roteador, igual às demais
// configurações administrativas; ainda NÃO há tabela durável própria.
// Segredos NUNCA entram neste modelo (não há senha SMTP: o envio é pela Resend).
// ============================================================================

export type ErpGeneralSectionId =
  | 'GERAL'
  | 'NUMERACOES'
  | 'IMPRESSAO'
  | 'TEXTOS'
  | 'PDV'
  | 'COMPRAS'
  | 'FISCAL'
  | 'EMAILS'
  | 'DOMINIO';

export interface ErpGeneralSectionMeta {
  id: ErpGeneralSectionId;
  title: string;
  subtitle: string;
  keywords: string[];
}

/**
 * Seção PDV oculta na interface por decisão do Marcéllo (02/11/2026). O tipo, o
 * renderizador e os dados salvos (pdv) continuam intactos; para reexibir, volte a
 * incluir ERP_GENERAL_HIDDEN_SECTIONS na lista abaixo.
 */
export const ERP_GENERAL_HIDDEN_SECTIONS: ErpGeneralSectionMeta[] = [
  { id: 'PDV', title: 'PDV', subtitle: 'Caixa e cupom das vendas de balcão', keywords: ['balcão', 'caixa', 'cupom'] },
];

export const ERP_GENERAL_SECTIONS: ErpGeneralSectionMeta[] = [
  { id: 'GERAL', title: 'Geral', subtitle: 'Números, vendas e cadastros', keywords: ['casas decimais', 'registros', 'estoque', 'pagamento', 'cpf', 'cnpj', 'custo'] },
  { id: 'NUMERACOES', title: 'Numerações', subtitle: 'Próximo número de cada cadastro', keywords: ['número', 'sequência', 'clientes', 'orçamentos', 'vendas', 'contratos'] },
  { id: 'IMPRESSAO', title: 'Impressão', subtitle: 'Formato e o que sai no papel', keywords: ['a4', 'fonte', 'cupom', 'presente', 'documentos', 'pdf'] },
  { id: 'TEXTOS', title: 'Textos padrão', subtitle: 'Observações de cada documento', keywords: ['observações', 'introdução', 'garantia', 'texto'] },
  { id: 'COMPRAS', title: 'Compras', subtitle: 'Importação do XML da nota', keywords: ['xml', 'frete', 'desconto', 'impostos', 'nota'] },
  { id: 'FISCAL', title: 'Fiscal', subtitle: 'NF-e, NFC-e e NFS-e', keywords: ['nf-e', 'nfs-e', 'nfcom', 'série', 'certificado', 'sefaz', 'ambiente'] },
  { id: 'EMAILS', title: 'E-mails', subtitle: 'Por onde saem os e-mails', keywords: ['smtp', 'servidor', 'resend', 'remetente', 'envio'] },
  { id: 'DOMINIO', title: 'Domínio próprio', subtitle: 'Endereço personalizado', keywords: ['domínio', 'endereço', 'cores', 'marca', 'nome'] },
];

const norm = (s: string) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/** Filtro do campo "Buscar configuração": título, subtítulo e palavras-chave, sem acento. */
export function filterGeneralSections(query: string, sections: ErpGeneralSectionMeta[] = ERP_GENERAL_SECTIONS): ErpGeneralSectionMeta[] {
  const q = norm(query).trim();
  if (!q) return sections;
  return sections.filter((s) => [s.title, s.subtitle, ...s.keywords].some((t) => norm(t).includes(q)));
}

// ---------------------------------------------------------------------------
// Numerações
// ---------------------------------------------------------------------------
export interface NumberingRowMeta {
  key: string;
  label: string;
  description: string;
  group: 'CADASTROS' | 'VENDAS_SERVICOS' | 'ESTOQUE_COMPRAS' | 'FINANCEIRO';
}

export const NUMBERING_GROUP_LABELS: Record<NumberingRowMeta['group'], string> = {
  CADASTROS: 'Cadastros - vale para próximos clientes',
  VENDAS_SERVICOS: 'Vendas e serviços',
  ESTOQUE_COMPRAS: 'Estoque e compras',
  FINANCEIRO: 'Financeiro',
};

export const NUMBERING_ROWS: NumberingRowMeta[] = [
  { key: 'clientes', label: 'Clientes', description: 'Código de cada cliente novo.', group: 'CADASTROS' },
  { key: 'fornecedores', label: 'Fornecedores', description: 'Código de cada fornecedor novo.', group: 'CADASTROS' },
  { key: 'transportadoras', label: 'Transportadoras', description: 'Código de cada transportadora nova.', group: 'CADASTROS' },
  { key: 'orcamentos', label: 'Orçamentos', description: 'Número de cada orçamento criado.', group: 'VENDAS_SERVICOS' },
  { key: 'vendas', label: 'Vendas', description: 'Número de cada venda criada.', group: 'VENDAS_SERVICOS' },
  { key: 'ordensServico', label: 'Ordens de serviço', description: 'Número de cada ordem de serviço.', group: 'VENDAS_SERVICOS' },
  { key: 'contratos', label: 'Contratos', description: 'Número de cada contrato de serviço.', group: 'VENDAS_SERVICOS' },
  { key: 'locacoes', label: 'Locações', description: 'Número de cada contrato de locação.', group: 'VENDAS_SERVICOS' },
  { key: 'atendimentos', label: 'Atendimentos', description: 'Número de cada atendimento aberto.', group: 'VENDAS_SERVICOS' },
  { key: 'cotacoes', label: 'Cotações', description: 'Número de cada cotação a fornecedores.', group: 'ESTOQUE_COMPRAS' },
  { key: 'compras', label: 'Compras', description: 'Número de cada compra registrada.', group: 'ESTOQUE_COMPRAS' },
  { key: 'ajustesEstoque', label: 'Ajustes de estoque', description: 'Número de cada ajuste manual de estoque.', group: 'ESTOQUE_COMPRAS' },
  { key: 'transferenciasEstoque', label: 'Transferências de estoque', description: 'Número de cada transferência entre lojas.', group: 'ESTOQUE_COMPRAS' },
  { key: 'lancamentosFinanceiros', label: 'Lançamentos financeiros', description: 'Código de cada conta a pagar ou a receber.', group: 'FINANCEIRO' },
];

/** Maior número no fim dos códigos reais (ex.: "PROP-2026-0042" => 42). null se não houver. */
export function lastNumberFromCodes(codes: Array<string | number | null | undefined>): number | null {
  let max: number | null = null;
  for (const c of codes || []) {
    if (c === null || c === undefined) continue;
    const m = String(c).match(/(\d+)\s*$/);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isSafeInteger(n) && (max === null || n > max)) max = n;
  }
  return max;
}

export function nextNumberLabel(last: number | null | undefined): string {
  return typeof last === 'number' && Number.isFinite(last) && last >= 0 ? `Próximo - ${last + 1}` : 'Próximo - sem base';
}

// ---------------------------------------------------------------------------
// Impressão: campos que aparecem nos documentos
// ---------------------------------------------------------------------------
export type PrintDocKey = 'ORCAMENTO' | 'VENDA' | 'OS' | 'COMPRA' | 'COTACAO';
export const PRINT_DOCS: Array<{ key: PrintDocKey; label: string }> = [
  { key: 'ORCAMENTO', label: 'Orçamento' },
  { key: 'VENDA', label: 'Venda' },
  { key: 'OS', label: 'OS' },
  { key: 'COMPRA', label: 'Compra' },
  { key: 'COTACAO', label: 'Cotação' },
];

export interface PrintFieldMeta {
  key: string;
  label: string;
  group: 'PRODUTOS' | 'SERVICOS' | 'ANEXOS';
  docs: PrintDocKey[];
}

export const PRINT_FIELDS: PrintFieldMeta[] = [
  { key: 'numeroItem', label: 'Número do item', group: 'PRODUTOS', docs: ['ORCAMENTO', 'VENDA', 'OS', 'COMPRA', 'COTACAO'] },
  { key: 'codigoProduto', label: 'Código do produto', group: 'PRODUTOS', docs: ['ORCAMENTO', 'VENDA', 'OS', 'COMPRA', 'COTACAO'] },
  { key: 'unidade', label: 'Unidade', group: 'PRODUTOS', docs: ['ORCAMENTO', 'VENDA', 'OS', 'COMPRA', 'COTACAO'] },
  { key: 'imagemProduto', label: 'Imagem do produto', group: 'PRODUTOS', docs: ['ORCAMENTO', 'VENDA', 'OS', 'COMPRA', 'COTACAO'] },
  { key: 'descricaoProduto', label: 'Descrição do produto', group: 'PRODUTOS', docs: ['ORCAMENTO', 'VENDA', 'OS', 'COMPRA'] },
  { key: 'ncm', label: 'NCM', group: 'PRODUTOS', docs: ['ORCAMENTO', 'VENDA', 'OS', 'COMPRA'] },
  { key: 'valorUnitario', label: 'Valor unitário', group: 'PRODUTOS', docs: ['ORCAMENTO', 'VENDA', 'OS', 'COMPRA'] },
  { key: 'subtotal', label: 'Subtotal', group: 'PRODUTOS', docs: ['ORCAMENTO', 'VENDA', 'OS', 'COMPRA'] },
  { key: 'descricaoServico', label: 'Descrição do serviço', group: 'SERVICOS', docs: ['ORCAMENTO', 'VENDA', 'OS'] },
  { key: 'imagemServico', label: 'Imagem do serviço', group: 'SERVICOS', docs: ['ORCAMENTO', 'VENDA', 'OS'] },
  { key: 'atividadesOs', label: 'Atividades da OS', group: 'SERVICOS', docs: ['OS'] },
  { key: 'anexosPedido', label: 'Anexos do pedido', group: 'ANEXOS', docs: ['ORCAMENTO', 'VENDA', 'OS'] },
  { key: 'imagemAnexo', label: 'Imagem do anexo', group: 'ANEXOS', docs: ['ORCAMENTO', 'VENDA', 'OS'] },
];

/** Resumo exibido no modo Básico: "Em todos os documentos", "Personalizado - 2 de 4", "Desligado". */
export function printFieldSummary(field: PrintFieldMeta, perDoc: Partial<Record<PrintDocKey, boolean>> | undefined): { state: 'ALL' | 'NONE' | 'CUSTOM'; label: string } {
  const on = field.docs.filter((d) => perDoc?.[d] === true).length;
  if (on === field.docs.length) return { state: 'ALL', label: 'Em todos os documentos' };
  if (on === 0) return { state: 'NONE', label: 'Desligado' };
  return { state: 'CUSTOM', label: `Personalizado - ${on} de ${field.docs.length}` };
}

// ---------------------------------------------------------------------------
// Textos padrão
// ---------------------------------------------------------------------------
export const DEFAULT_TEXT_ITEMS: Array<{ key: string; group: string; label: string; description: string }> = [
  { key: 'orcamentoIntroducao', group: 'Orçamentos', label: 'Introdução', description: 'Abertura de cada orçamento novo.' },
  { key: 'orcamentoObservacoes', group: 'Orçamentos', label: 'Observações', description: 'Fechamento de cada orçamento novo.' },
  { key: 'vendaObservacoesExternas', group: 'Vendas', label: 'Observações externas', description: 'Em toda venda nova, visível para o cliente.' },
  { key: 'osObservacoesExternas', group: 'Ordens de serviço', label: 'Observações externas', description: 'Em toda OS nova, visível para o cliente.' },
  { key: 'osTermosGarantia', group: 'Ordens de serviço', label: 'Termos de garantia', description: 'Impressos em toda OS.' },
  { key: 'contratoServicos', group: 'Contratos', label: 'Serviços', description: 'Observações de todo contrato de serviço novo.' },
  { key: 'contratoLocacoes', group: 'Contratos', label: 'Locações', description: 'Observações de todo contrato de locação novo.' },
  { key: 'contratoAssinaturas', group: 'Contratos', label: 'Assinaturas', description: 'Observações de toda assinatura nova.' },
  { key: 'compras', group: 'Compras e cotações', label: 'Compras', description: 'Observações de toda compra nova.' },
  { key: 'cotacoes', group: 'Compras e cotações', label: 'Cotações', description: 'Observações de toda cotação enviada ao fornecedor.' },
  { key: 'faturas', group: 'Financeiro', label: 'Faturas', description: 'Observações impressas nas faturas.' },
];

// ---------------------------------------------------------------------------
// Modelo salvo (sem segredos)
// ---------------------------------------------------------------------------
export interface ErpGeneralSettings {
  geral: {
    valueDecimals: number;
    quantityDecimals: number;
    recordsPerPage: number;
    sellWithoutStock: boolean;
    sellWithoutPaymentCondition: boolean;
    compositionStock: boolean;
    purchaseCostUpdate: 'NAO_ATUALIZAR' | 'ULTIMO_CUSTO' | 'CUSTO_MEDIO';
    blockDuplicateDocument: boolean;
  };
  /** Ajustes manuais do último número usado (null = usar a base real). */
  numeracoes: Record<string, number | null>;
  impressao: {
    a4Format: 'PDF' | 'HTML';
    a4FontSize: '10px' | '11px' | '12px' | '13px' | '14px';
    couponFontSize: '10px' | '11px' | '12px' | '13px' | '14px';
    giftCoupon: boolean;
    fields: Record<string, Partial<Record<PrintDocKey, boolean>>>;
  };
  textos: Record<string, string>;
  pdv: {
    autoPrintCoupon: boolean;
    allowAnonymousCustomer: boolean;
    askDocumentOnCoupon: boolean;
  };
  compras: {
    considerFreight: boolean;
    considerDiscount: boolean;
    considerTaxes: boolean;
    considerOtherExpenses: boolean;
    linkProductsBy: 'NOME' | 'CODIGO_FORNECEDOR' | 'CODIGO_BARRAS';
  };
  /** Informativo: o envio é pela Resend (variável de ambiente no servidor). SMTP próprio ainda não existe. */
  emails: {
    mode: 'SISTEMA';
  };
  dominio: {
    customDomain: string;
    primaryColor: string;
    secondaryColor: string;
    systemName: string;
  };
}

const allDocs = (docs: PrintDocKey[]) => Object.fromEntries(docs.map((d) => [d, true])) as Partial<Record<PrintDocKey, boolean>>;

export function buildDefaultErpGeneralSettings(): ErpGeneralSettings {
  return {
    geral: {
      valueDecimals: 2,
      quantityDecimals: 2,
      recordsPerPage: 20,
      sellWithoutStock: false,
      sellWithoutPaymentCondition: false,
      compositionStock: false,
      purchaseCostUpdate: 'NAO_ATUALIZAR',
      blockDuplicateDocument: true,
    },
    numeracoes: {},
    impressao: {
      a4Format: 'PDF',
      a4FontSize: '12px',
      couponFontSize: '12px',
      giftCoupon: false,
      fields: Object.fromEntries(PRINT_FIELDS.map((f) => [f.key, allDocs(f.docs)])),
    },
    textos: {},
    pdv: { autoPrintCoupon: true, allowAnonymousCustomer: true, askDocumentOnCoupon: false },
    compras: {
      considerFreight: false,
      considerDiscount: false,
      considerTaxes: false,
      considerOtherExpenses: false,
      linkProductsBy: 'NOME',
    },
    emails: { mode: 'SISTEMA' },
    dominio: { customDomain: '', primaryColor: '#1F2B68', secondaryColor: '#000000', systemName: 'ERP Seta Telecom' },
  };
}

const SECRET_KEY_RE = /pass|senha|secret|token/i;

/** Mescla o salvo com os padrões e descarta qualquer chave com cara de segredo. */
export function mergeErpGeneralSettings(saved: unknown): ErpGeneralSettings {
  const base = buildDefaultErpGeneralSettings();
  if (!saved || typeof saved !== 'object') return base;
  const s = saved as Partial<Record<keyof ErpGeneralSettings, Record<string, unknown>>>;
  const pick = <T extends object>(def: T, inc: unknown): T => {
    if (!inc || typeof inc !== 'object') return def;
    const out: Record<string, unknown> = { ...(def as unknown as Record<string, unknown>) };
    for (const [k, v] of Object.entries(inc as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k)) continue;
      out[k] = v;
    }
    return out as T;
  };
  return {
    geral: pick(base.geral, s.geral),
    numeracoes: pick(base.numeracoes, s.numeracoes),
    impressao: { ...pick(base.impressao, s.impressao), fields: { ...base.impressao.fields, ...((s.impressao?.fields as object) || {}) } },
    textos: pick(base.textos, s.textos),
    pdv: pick(base.pdv, s.pdv),
    compras: pick(base.compras, s.compras),
    emails: { mode: 'SISTEMA' },
    dominio: pick(base.dominio, s.dominio),
  };
}

/** Payload para o PUT /api/admin/settings: só preferências, sem segredos. */
export function sanitizeErpGeneralSettingsForSave(settings: ErpGeneralSettings): ErpGeneralSettings {
  return mergeErpGeneralSettings(JSON.parse(JSON.stringify(settings)));
}

export function isValidHexColor(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(String(v || ''));
}
