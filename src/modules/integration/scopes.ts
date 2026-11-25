// ============================================================================
// STI-hub — API v1 + MCP (Fase 1): catalogo FECHADO de escopos de integracao.
// Regra CISO: so escopos desta lista existem. Qualquer escopo de IAM/Admin, DELETE,
// merge, Sequencias, escrita Fiscal/Financeira ou escrita GestaoClick e RECUSADO na
// criacao de chave, no DCR e em runtime (nunca e concedido nem exposto).
// ============================================================================

export const INTEGRATION_SCOPES = [
  'crm:contacts:read',
  'crm:contacts:write',
  'crm:companies:read',
  'crm:companies:write',
  'crm:deals:read',
  'crm:deals:write',
  'crm:activities:read',
  'crm:activities:write',
  'crm:pipelines:read',
  'tickets:read',
  'tickets:write',
  'tickets:internal_notes:read',
  'tickets:internal_notes:write',
  'openapi:read',
  // --- Fase 2 / Lote 1 (24/11/2026): SOMENTE LEITURA do ERP e do CRM restante ---
  'crm:tasks:read',
  'crm:automation:read',
  'crm:marketing:read',
  'crm:analytics:read',
  'crm:data_health:read',
  'erp:dashboard:read',
  'erp:proposals:read',
  'erp:contracts:read',
  'erp:orders:read',
  'erp:catalog:read',
  'erp:records:read',
  'erp:financial:read',
  'erp:banks:read',
  'erp:fiscal:read',
  // --- Fase 2 / Lote 2 (24/11/2026): ESCRITAS REVERSIVEIS (sem exclusao, emissao, baixa, envio ou ativacao) ---
  'erp:proposals:write',
  'erp:contracts:write',
  'erp:orders:write',
  'erp:catalog:write',
  'erp:records:write',
  'erp:financial:write',
  'crm:tasks:write',
  'crm:automation:write',
  'crm:marketing:write',
] as const;

/** Todos os escopos novos do Lote 1 (somente leitura). */
export const LOTE1_SCOPES: ReadonlySet<string> = new Set([
  'crm:tasks:read',
  'crm:automation:read',
  'crm:marketing:read',
  'crm:analytics:read',
  'crm:data_health:read',
  'erp:dashboard:read',
  'erp:proposals:read',
  'erp:contracts:read',
  'erp:orders:read',
  'erp:catalog:read',
  'erp:records:read',
  'erp:financial:read',
  'erp:banks:read',
  'erp:fiscal:read',
]);

/**
 * Escopos de LEITURA do Lote 1 que casam com padroes bloqueados (erp/fiscal/financial/banks).
 * Sao liberados um a um, de forma explicita; qualquer variacao (ex.: erp:fiscal:write) segue
 * bloqueada. Nenhum escopo de escrita do ERP existe nesta versao.
 */
export const LOTE1_READ_SCOPES: ReadonlySet<string> = new Set([
  'erp:dashboard:read',
  'erp:proposals:read',
  'erp:contracts:read',
  'erp:orders:read',
  'erp:catalog:read',
  'erp:records:read',
  'erp:financial:read',
  'erp:banks:read',
  'erp:fiscal:read',
]);

/**
 * Fase 2 / Lote 2: escopos de ESCRITA reversivel, liberados um a um (explicitamente). Qualquer
 * outra variacao (erp:fiscal:write, erp:banks:write, erp:*:delete...) segue bloqueada.
 */
export const LOTE2_WRITE_SCOPES: ReadonlySet<string> = new Set([
  'erp:proposals:write',
  'erp:contracts:write',
  'erp:orders:write',
  'erp:catalog:write',
  'erp:records:write',
  'erp:financial:write',
  'crm:tasks:write',
  'crm:automation:write',
  'crm:marketing:write',
]);

export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number];

export const PORTFOLIO_SCOPES = ['PROPRIOS', 'EQUIPE', 'TODOS'] as const;
export type PortfolioScope = (typeof PORTFOLIO_SCOPES)[number];

export type IntegrationModule = 'crm' | 'chamados' | 'erp';
export interface IntegrationModuleAccess {
  crm: boolean;
  chamados: boolean;
  /** Fase 2 / Lote 1: modulo ERP (somente leitura). Ausente em credenciais antigas => false. */
  erp: boolean;
}

export const SCOPE_DESCRIPTIONS: Record<IntegrationScope, string> = {
  'crm:contacts:read': 'Ler contatos do CRM (respeita a carteira).',
  'crm:contacts:write': 'Criar e editar contatos do CRM (sem exclusao).',
  'crm:companies:read': 'Ler empresas do CRM (respeita a carteira).',
  'crm:companies:write': 'Criar e editar empresas do CRM (sem exclusao).',
  'crm:deals:read': 'Ler negocios do CRM (respeita a carteira).',
  'crm:deals:write': 'Criar e editar negocios, inclusive mudanca de etapa (sem exclusao).',
  'crm:activities:read': 'Ler notas e atividades da linha do tempo.',
  'crm:activities:write': 'Registrar notas e atividades na linha do tempo.',
  'crm:pipelines:read': 'Ler pipelines e etapas (somente leitura).',
  'tickets:read': 'Ler chamados do SetaDesk (mascarados) e filas.',
  'tickets:write': 'Abrir chamados TEC-/FIN-, editar (PATCH strict) e comentar publicamente.',
  'tickets:internal_notes:read': 'Ver comentarios internos dos chamados.',
  'tickets:internal_notes:write': 'Registrar comentarios internos nos chamados.',
  'openapi:read': 'Ler a especificacao OpenAPI 3.1 da API v1.',
  'crm:tasks:read': 'Ler tarefas do CRM (respeita a carteira).',
  'crm:automation:read': 'Ler workflows e sequences (definicoes e execucoes; sem ativar, inscrever ou enviar).',
  'crm:marketing:read': 'Ler campanhas, formularios e segmentos de marketing (sem disparo).',
  'crm:analytics:read': 'Ler relatorios agregados e insights do funil (exige carteira TODOS).',
  'crm:data_health:read': 'Ler resumo de saude da base e duplicados (exige carteira TODOS; sem merge).',
  'erp:dashboard:read': 'Ler o painel do ERP e o status da sincronizacao (exige carteira TODOS; financeiro so com alcada).',
  'erp:proposals:read': 'Ler orcamentos/propostas, versoes e status de aceite (respeita a carteira).',
  'erp:contracts:read': 'Ler contratos de locacao e versoes (respeita a carteira).',
  'erp:orders:read': 'Ler ordens de servico, pedidos de venda e pedidos de compra.',
  'erp:catalog:read': 'Ler produtos/servicos do catalogo e listas auxiliares.',
  'erp:records:read': 'Ler cadastros de fornecedores e colaboradores (colaboradores: so administrador).',
  'erp:financial:read': 'Ler lancamentos financeiros e DRE (exige carteira TODOS + alcada Financeiro).',
  'erp:banks:read': 'Ler contas e saldos bancarios (exige carteira TODOS + permissao de ver saldos).',
  'erp:fiscal:read': 'Ler notas fiscais e configuracoes fiscais mascaradas (exige carteira TODOS + alcada Fiscal).',
  'erp:proposals:write': 'Criar, editar e restaurar versao de orcamentos/propostas (sem aprovar, aceitar, gerar link publico ou enviar).',
  'erp:contracts:write': 'Criar, editar, restaurar versao e renovar contratos (nunca gera fatura, remessa ou NF).',
  'erp:orders:write': 'Criar OS, mudar situacao, duplicar, abrir OS a partir de chamado; criar/editar pedidos de venda e compra (sem importar XML).',
  'erp:catalog:write': 'Criar e editar produtos/servicos e listas auxiliares.',
  'erp:records:write': 'Criar e editar fornecedores.',
  'erp:financial:write': 'Criar e editar lancamentos financeiros em aberto (sem baixa/pagamento; exige carteira TODOS + edicao Financeiro).',
  'crm:tasks:write': 'Criar, editar e concluir tarefas do CRM.',
  'crm:automation:write': 'Criar rascunhos INATIVOS de sequences e workflows (sem ativar, disparar ou inscrever).',
  'crm:marketing:write': 'Criar rascunhos PAUSADOS de campanhas (sem disparo).',
};

/** Modulo exigido por escopo (moduleAccess e aplicado no servidor). */
export function moduleForScope(scope: IntegrationScope): IntegrationModule | null {
  if (scope.startsWith('crm:')) return 'crm';
  if (scope.startsWith('tickets:')) return 'chamados';
  if (scope.startsWith('erp:')) return 'erp';
  return null;
}

/**
 * Padroes de escopo BLOQUEADOS na v1 (trava CISO). Usados para dar um erro explicito
 * (SCOPE_BLOCKED) quando alguem tenta pedir um deles, alem do catalogo fechado.
 */
const BLOCKED_SCOPE_PATTERNS: RegExp[] = [
  /(^|:)(iam|admin|rbac|users?|roles?|security)(:|$)/i,
  /(^|:)delete(:|$)/i,
  /(^|:)merge(:|$)/i,
  /(^|:)(sequences?|sequencias?|cadences?|cadencias?)(:|$)/i,
  /(^|:)(fiscal|financeiro|financial|finance|nfe|nfse|invoices?|faturas?|banks?)(:|$)/i,
  /(^|:)(gestaoclick|gc)(:|$)/i,
  /(^|:)(erp)(:|$)/i,
  /\*/,
];

export function isBlockedScope(raw: string): boolean {
  const s = String(raw || '').trim();
  if (LOTE1_READ_SCOPES.has(s) || LOTE2_WRITE_SCOPES.has(s)) return false;
  return BLOCKED_SCOPE_PATTERNS.some((re) => re.test(s));
}

export function isKnownScope(raw: string): raw is IntegrationScope {
  return (INTEGRATION_SCOPES as readonly string[]).includes(raw);
}

/** Separa por espaco (OAuth) ou aceita array; remove duplicados. */
export function splitScopeInput(input: unknown): string[] {
  const arr = Array.isArray(input) ? input.map(String) : String(input ?? '').split(/[\s,]+/);
  return [...new Set(arr.map((s) => s.trim()).filter(Boolean))];
}

export type ScopeValidation =
  | { ok: true; scopes: IntegrationScope[] }
  | { ok: false; code: 'SCOPE_BLOCKED' | 'SCOPE_UNKNOWN' | 'SCOPE_EMPTY'; invalid: string[] };

export function validateRequestedScopes(input: unknown, opts: { allowEmpty?: boolean } = {}): ScopeValidation {
  const list = splitScopeInput(input);
  if (list.length === 0) {
    return opts.allowEmpty ? { ok: true, scopes: [] } : { ok: false, code: 'SCOPE_EMPTY', invalid: [] };
  }
  const blocked = list.filter((s) => isBlockedScope(s) && !isKnownScope(s));
  if (blocked.length) return { ok: false, code: 'SCOPE_BLOCKED', invalid: blocked.map((s) => s.slice(0, 80)) };
  const unknown = list.filter((s) => !isKnownScope(s));
  if (unknown.length) return { ok: false, code: 'SCOPE_UNKNOWN', invalid: unknown.map((s) => s.slice(0, 80)) };
  return { ok: true, scopes: list as IntegrationScope[] };
}

/** Em runtime: descarta qualquer escopo fora do catalogo (defesa em profundidade). */
export function sanitizeRuntimeScopes(input: unknown): IntegrationScope[] {
  return splitScopeInput(input).filter((s): s is IntegrationScope => isKnownScope(s) && !isBlockedScope(s));
}

export function normalizeModuleAccess(input: unknown): IntegrationModuleAccess {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return { crm: o.crm === true, chamados: o.chamados === true, erp: o.erp === true };
}

const PORTFOLIO_RANK: Record<PortfolioScope, number> = { PROPRIOS: 0, EQUIPE: 1, TODOS: 2 };

export function isPortfolioScope(v: unknown): v is PortfolioScope {
  return typeof v === 'string' && (PORTFOLIO_SCOPES as readonly string[]).includes(v);
}

/** Menor (mais restritiva) das carteiras. */
export function narrowestPortfolio(a: PortfolioScope, b: PortfolioScope): PortfolioScope {
  return PORTFOLIO_RANK[a] <= PORTFOLIO_RANK[b] ? a : b;
}

export function portfolioExceeds(requested: PortfolioScope, ceiling: PortfolioScope): boolean {
  return PORTFOLIO_RANK[requested] > PORTFOLIO_RANK[ceiling];
}
