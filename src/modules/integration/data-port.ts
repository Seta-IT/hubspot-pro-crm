// ============================================================================
// STI-hub — API v1 + MCP: porta de dados (CRM + Chamados) usada pelos casos de uso.
//
// Implementacao unica (RouterDataPort): leituras e escritas passam pelo CrmApiRouter
// com o contexto interno confiavel (Symbol nao forjavel). Assim a API v1 e o MCP usam
// o MESMO carregamento do Postgres (crm_state_v1 / tabelas setadesk_*), a MESMA
// persistencia pos-mutacao, reserva de chaves TEC-/FIN- e sincronizacao do SetaDesk
// que a aplicacao. O contexto confiavel dispensa a sessao do router; por isso TODA a
// autorizacao (escopo, carteira, moduleAccess, campos permitidos) e feita ANTES, na
// camada de casos de uso. Nenhuma rota de DELETE/merge/sequencias/fiscal e chamada daqui.
// ============================================================================
import type {
  Company,
  Contact,
  Deal,
  ErpBankAccount,
  ErpCatalogItem,
  ErpEmployeeRecord,
  ErpFinancialEntry,
  ErpFiscalInvoice,
  ErpPurchaseOrder,
  ErpRentalContract,
  ErpSaleOrder,
  ErpSupplierRecord,
  FiscalDocumentSettings,
  GestaoClickConfig,
  Pipeline,
  ServiceTicket,
  SetaDeskPipeline,
  StiHubUserRecord,
  TimelineEvent,
} from '../../db/types';
import type { CrmApiRouter } from '../../api/router';
import { TRUSTED_INTERNAL_CONTEXT } from '../../api/router';
import { buildDefaultCrmPermissionsForRole, buildDefaultErpPermissionsForRole } from '../erp/rbac-seed';
import { isPortfolioScope, type PortfolioScope } from './scopes';
import { IntegrationStoreUnavailableError } from './store-errors';

export interface IntegrationUser {
  id: string;
  name: string;
  email: string;
  hubspotOwnerId: string | null;
  active: boolean;
  moduleAccess: { crm: boolean; chamados: boolean; erp: boolean };
  portfolioScope: PortfolioScope;
  /** Nivel de acesso do CRM do usuario (VIEW/EDIT/FULL/NONE) quando definido. */
  crmAccess: { contacts?: string; companies?: string; deals?: string; tickets?: string; marketing?: string };
  /**
   * Fase 2 / Lote 1: alcadas de TELA do ERP (StiHubErpPermissions) replicadas no conector.
   * Ausente no cadastro => preset RESTRITO do papel; valor desconhecido => NEGA (fail-closed).
   */
  erpAccess: {
    proposals?: string;
    contracts?: string;
    stockOsSales?: string;
    finance?: string;
    fiscal?: string;
    canViewBankBalances: boolean;
    /** Lote 2: teto de desconto (%) do cadastro (fallback preset do papel; invalido => 0). */
    maxDiscountPercent?: number;
  };
  /** Papel do IAM (SUPER_ADMIN/DIRETORIA = administrador para dados sensiveis do ERP). */
  roleId: string;
  /**
   * Fase 2 / Lote 3: permissoes de ACAO da tela (so `true` explicito no cadastro do usuario ou no
   * preset do papel quando ausente). Os guards de papel (actionGuards) NAO liberam no conector:
   * mais restrito que a tela (fail-closed).
   */
  guards: {
    canDeleteCrmRecords: boolean;
    canMergeCrmRecords: boolean;
    canDeleteErpRecords: boolean;
    canApproveProposals: boolean;
    canIssueFiscalDocuments: boolean;
  };
}

export interface CrmSnapshot {
  contacts: Contact[];
  companies: Company[];
  deals: Deal[];
  pipelines: Pipeline[];
  timeline: TimelineEvent[];
  users: IntegrationUser[];
}

export interface TicketSnapshot {
  tickets: ServiceTicket[];
  contacts: Contact[];
  companies: Company[];
  deals: Deal[];
  users: IntegrationUser[];
}

export interface DataWriteResult {
  status: number;
  body: any;
}

export type DataDomain = 'crm' | 'tickets' | 'erp';

/** Snapshot minimo do dominio ERP: so o cadastro de usuarios (teto de carteira/alcada). */
export interface ErpUsersSnapshot {
  users: IntegrationUser[];
}

export interface ErpReadResult {
  status: number;
  body: any;
}

export interface IntegrationDataPort {
  /** Snapshot (copiado) do CRM ou dos chamados; reaproveitado na mesma requisicao ate a proxima escrita. */
  snapshot(domain: 'crm'): Promise<CrmSnapshot>;
  snapshot(domain: 'tickets'): Promise<TicketSnapshot>;
  snapshot(domain: 'erp'): Promise<ErpUsersSnapshot>;
  snapshot(domain: DataDomain): Promise<CrmSnapshot | TicketSnapshot | ErpUsersSnapshot>;
  /**
   * Fase 2 / Lote 1: LEITURA (GET) de rota interna existente do ERP/CRM, por allowlist.
   * Falha 5xx => IntegrationStoreUnavailableError (503), nunca dados vazios.
   */
  read(path: string, query?: Record<string, string>): Promise<ErpReadResult>;
  /**
   * Colecoes do ERP guardadas no estado (contratos, notas, catalogo, financeiro, contas,
   * pedidos, fornecedores, colaboradores, configuracoes fiscais). Copia profunda.
   */
  erpCollections(): Promise<ErpCollections>;
  listTicketQueues(): Promise<SetaDeskPipeline[]>;
  /** Usuarios (cadastro vivo do IAM) — teto de carteira/modulos/alcada no consentimento OAuth. */
  listUsers(): Promise<IntegrationUser[]>;
  /** Escrita via rota interna existente (POST/PATCH apenas). */
  write(method: 'POST' | 'PATCH', path: string, body: Record<string, unknown>, opts?: { actorUserId?: string }): Promise<DataWriteResult>;
  /**
   * Fase 2 / Lote 3: operacao PERIGOSA (excluir/mesclar/enviar/emitir/baixar...). Allowlist propria
   * (metodo + rota) separada da escrita reversivel; so chamada pelo *_commit apos o token de
   * confirmacao. `actorUserId` = dono da credencial como ator (honrado so no contexto interno).
   */
  dangerous(method: 'POST' | 'PATCH' | 'DELETE', path: string, body: Record<string, unknown>, opts?: { actorUserId?: string }): Promise<DataWriteResult>;
}

export interface ErpCollections {
  rentalContracts: ErpRentalContract[];
  invoices: ErpFiscalInvoice[];
  catalog: ErpCatalogItem[];
  financialEntries: ErpFinancialEntry[];
  bankAccounts: ErpBankAccount[];
  salesOrders: ErpSaleOrder[];
  suppliers: ErpSupplierRecord[];
  employees: ErpEmployeeRecord[];
  purchaseOrders: ErpPurchaseOrder[];
  fiscalDocumentSettings: FiscalDocumentSettings | null;
  gestaoClickConfig: GestaoClickConfig | null;
}

export function toIntegrationUser(u: StiHubUserRecord): IntegrationUser {
  const enabled = Array.isArray(u.enabledModules) ? u.enabledModules : null;
  const ma = u.moduleAccess || {
    crm: enabled ? enabled.includes('CRM') : false,
    erp: false,
    chamados: enabled ? enabled.includes('CHAMADOS') : false,
  };
  const scopeRaw = u.crmPermissions?.portfolioScope || u.scope;
  // Alcada ausente no cadastro => preset RESTRITO do papel (nunca "libera tudo").
  const preset = buildDefaultCrmPermissionsForRole((u.roleId || 'SEM_PAPEL') as StiHubUserRecord['roleId']);
  const erpPreset = buildDefaultErpPermissionsForRole((u.roleId || 'SEM_PAPEL') as StiHubUserRecord['roleId']);
  const ep = u.erpPermissions;
  return {
    id: String(u.id),
    name: String(u.name || ''),
    email: String(u.email || '').toLowerCase(),
    hubspotOwnerId: u.hubspotOwnerId ? String(u.hubspotOwnerId) : null,
    active: u.active !== false,
    moduleAccess: { crm: ma.crm === true, chamados: ma.chamados === true, erp: (ma as { erp?: unknown }).erp === true },
    portfolioScope: isPortfolioScope(scopeRaw) ? scopeRaw : 'PROPRIOS',
    crmAccess: {
      contacts: u.crmPermissions?.contactsAccess ?? preset.contactsAccess,
      companies: u.crmPermissions?.companiesAccess ?? preset.companiesAccess,
      deals: u.crmPermissions?.dealsFunnelAccess ?? preset.dealsFunnelAccess,
      tickets: u.crmPermissions?.ticketsServiceDeskAccess ?? preset.ticketsServiceDeskAccess,
      marketing: u.crmPermissions?.marketingAutomationAccess ?? preset.marketingAutomationAccess,
    },
    erpAccess: {
      proposals: ep?.proposalsQuotesAccess ?? erpPreset.proposalsQuotesAccess,
      contracts: ep?.rentalContractsAccess ?? erpPreset.rentalContractsAccess,
      stockOsSales: ep?.stockOsSalesAccess ?? erpPreset.stockOsSalesAccess,
      finance: ep?.financeBanksAccess ?? erpPreset.financeBanksAccess,
      fiscal: ep?.fiscalIssuanceAccess ?? erpPreset.fiscalIssuanceAccess,
      // Booleano sensivel: so true explicito (cadastro ou preset do papel).
      canViewBankBalances: (ep ? ep.canViewBankBalances : erpPreset.canViewBankBalances) === true,
      // Lote 2: teto de desconto (%) do cadastro/preset; invalido => 0 (fail-closed).
      maxDiscountPercent: (() => {
        const v = Number(ep?.maxDiscountPercent ?? erpPreset.maxDiscountPercent);
        return Number.isFinite(v) && v >= 0 ? Math.min(100, v) : 0;
      })(),
    },
    roleId: String(u.roleId || ''),
    guards: {
      canDeleteCrmRecords: (u.crmPermissions ? u.crmPermissions.canDeleteCrmRecords : preset.canDeleteCrmRecords) === true,
      canMergeCrmRecords: (u.crmPermissions ? u.crmPermissions.canMergeCrmRecords : preset.canMergeCrmRecords) === true,
      canDeleteErpRecords: (ep ? ep.canDeleteErpRecords : erpPreset.canDeleteErpRecords) === true,
      canApproveProposals: (ep ? ep.canApproveProposals : erpPreset.canApproveProposals) === true,
      canIssueFiscalDocuments: (ep ? ep.canIssueFiscalDocuments : erpPreset.canIssueFiscalDocuments) === true,
    },
  };
}

const ALLOWED_WRITE_PATHS: RegExp[] = [
  /^\/api\/contacts$/,
  /^\/api\/contacts\/[A-Za-z0-9._-]{1,80}$/,
  /^\/api\/companies$/,
  /^\/api\/companies\/[A-Za-z0-9._-]{1,80}$/,
  /^\/api\/deals$/,
  /^\/api\/deals\/[A-Za-z0-9._-]{1,80}$/,
  /^\/api\/timeline$/,
  /^\/api\/tickets$/,
  /^\/api\/tickets\/[A-Za-z0-9._-]{1,80}$/,
  /^\/api\/tickets\/[A-Za-z0-9._-]{1,80}\/comments$/,
  // --- Fase 2 / Lote 2: escritas reversiveis (POST/PATCH). Nada de excluir, emitir, baixar,
  // aprovar/aceitar, gerar link publico, enviar, ativar/disparar, importar XML ou sincronizar.
  /^\/api\/erp\/proposals$/,
  /^\/api\/erp\/proposals\/[A-Za-z0-9._-]{1,80}$/,
  /^\/api\/erp\/proposals\/[A-Za-z0-9._-]{1,80}\/restore-version$/,
  /^\/api\/erp\/rental-contracts$/,
  /^\/api\/erp\/rental-contracts\/[A-Za-z0-9._-]{1,80}$/,
  /^\/api\/erp\/rental-contracts\/[A-Za-z0-9._-]{1,80}\/(restore-version|renew)$/,
  /^\/api\/erp\/service-orders$/,
  /^\/api\/erp\/service-orders\/[A-Za-z0-9._-]{1,80}\/(status|duplicate)$/,
  /^\/api\/tickets\/[A-Za-z0-9._-]{1,80}\/create-os$/,
  /^\/api\/erp\/records\/(salesOrders|purchaseOrders|suppliers)$/,
  /^\/api\/erp\/records\/(salesOrders|purchaseOrders|suppliers)\/[A-Za-z0-9._-]{1,80}$/,
  /^\/api\/erp\/catalog$/,
  /^\/api\/erp\/catalog\/[A-Za-z0-9._-]{1,80}$/,
  /^\/api\/erp\/aux-lists$/,
  /^\/api\/erp\/aux-lists\/[A-Za-z0-9._-]{1,80}$/,
  /^\/api\/erp\/financial$/,
  /^\/api\/erp\/financial\/[A-Za-z0-9._-]{1,80}$/,
  /^\/api\/tasks$/,
  /^\/api\/tasks\/[A-Za-z0-9._-]{1,80}$/,
  /^\/api\/tasks\/[A-Za-z0-9._-]{1,80}\/complete$/,
  /^\/api\/sequences$/,
  /^\/api\/workflows$/,
  /^\/api\/workflows\/[A-Za-z0-9._-]{1,80}$/,
  /^\/api\/marketing\/campaigns$/,
];

/**
 * Fase 2 / Lote 2: travas de corpo na porta (defesa em profundidade alem do Zod strict dos casos
 * de uso). Qualquer violacao => erro interno (nunca grava).
 */
function assertSafeWriteBody(method: 'POST' | 'PATCH', path: string, body: Record<string, unknown>): void {
  const fail = (why: string) => {
    throw new Error(`Escrita interna recusada pela trava da API v1: ${why}.`);
  };
  // Nenhuma escrita gera fatura/NF/remessa nem envia e-mail automatico.
  for (const k of ['generateNextInvoiceOnSave', 'autoSendEmailOnBilling', 'dunningRuleEnabled', 'emitReturnNfe', 'emitProRataInvoice', 'createCrmDeal']) {
    if (body[k] === true) fail(k);
  }
  if (/^\/api\/(sequences|workflows)/.test(path)) {
    if ('action' in body || 'entityId' in body || 'workflowId' in body) fail('acao de automacao');
    if (body.isActive !== false && (method === 'POST' || 'isActive' in body)) fail('automacao ativa');
  }
  if (path === '/api/marketing/campaigns' && body.status !== 'PAUSED') fail('campanha nao pausada');
  if (/^\/api\/erp\/financial/.test(path) && (body.status === 'PAGO' || (body.paidAt !== undefined && body.paidAt !== null))) fail('baixa financeira');
  if (/^\/api\/erp\/proposals/.test(path) && /^(APROVADA|CONVERTIDA_CONTRATO)$/.test(String(body.status ?? ''))) fail('aprovacao/conversao de proposta');
  // Correcoes CISO (Lote 2): defesa em profundidade (o caso de uso ja recusa antes).
  if (/^\/api\/erp\/records\/(salesOrders|purchaseOrders)/.test(path) && body.status !== undefined && isForbiddenOrderStatus(body.status)) fail('situacao de pedido faturada/paga/aprovada');
  if (/^\/api\/erp\/proposals/.test(path) && Object.values(body).some((v) => typeof v === 'string' && hasServiceAccountMarker(v))) fail('marcador da conta de servico');
  if (/^\/api\/erp\/rental-contracts$/.test(path) && method === 'POST' && !['EM_IMPLANTACAO', 'PENDENTE_ASSINATURA'].includes(String(body.status ?? ''))) fail('contrato nasce ATIVO/SUSPENSO');
}

/** Comparacao normalizada (sem caixa/acentos/pontuacao). */
export function normalizeStatusText(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
/** Situacoes de pedido que a integracao nunca grava (faturado/pago/aprovado e equivalentes). */
const FORBIDDEN_ORDER_STATUS_RE =
  /\b(faturad[oa]s?|fatura|nf emitida|nota emitida|emitid[oa]|pag[oa]s?|pagamento|quitad[oa]|baixad[oa]|liquidad[oa]|recebid[oa]|aprovad[oa]s?|aprovacao|autorizad[oa]|concretizad[oa]|confirmad[oa]|conclui?d[oa]|finalizad[oa]|entregue|invoiced|paid|approved|billed|settled)\b/;
export function isForbiddenOrderStatus(v: unknown): boolean {
  return FORBIDDEN_ORDER_STATUS_RE.test(normalizeStatusText(v));
}
/** Marcador que o app usa para "criada pela conta de servico" (visivel/editavel por todos). */
export function hasServiceAccountMarker(v: unknown): boolean {
  return normalizeStatusText(v).includes('criada por assistente de vendas');
}

/**
 * Fase 2 / Lote 1: rotas internas de LEITURA permitidas (GET). Nada de escrita, emissao,
 * envio, merge, exclusao, GestaoClick (sync/config) ou IAM passa por aqui.
 */
const ALLOWED_READ_PATHS: RegExp[] = [
  /^\/api\/erp\/dashboard$/,
  /^\/api\/erp\/proposals$/,
  /^\/api\/erp\/proposals\/[A-Za-z0-9._-]{1,80}$/,
  /^\/api\/erp\/proposals\/[A-Za-z0-9._-]{1,80}\/versions$/,
  /^\/api\/erp\/proposals\/[A-Za-z0-9._-]{1,80}\/acceptance-status$/,
  /^\/api\/erp\/service-orders$/,
  /^\/api\/erp\/aux-lists$/,
  /^\/api\/erp\/financial\/dre$/,
  /^\/api\/tasks$/,
  /^\/api\/sequences$/,
  /^\/api\/workflows$/,
  /^\/api\/marketing\/campaigns$/,
  /^\/api\/marketing\/segments$/,
  /^\/api\/forms$/,
  /^\/api\/ai-insights$/,
  /^\/api\/data-health\/summary$/,
  /^\/api\/data-health\/duplicates$/,
];

/** Parametros internos (so honrados no contexto interno) aceitos pela porta. */
const ALLOWED_READ_QUERY = /^(q|status|type|companyId|dealId|limit|offset|mes|competenceMonth|_integrationOwnerId|_integrationOwnerEmail|_integrationIncludeFinance)$/;

const ID = '[A-Za-z0-9._-]{1,80}';
/** Lote 3: allowlist FECHADA de operacoes perigosas (metodo + rota). */
const ALLOWED_DANGEROUS: Array<{ method: 'POST' | 'PATCH' | 'DELETE'; re: RegExp }> = [
  // 3a: exclusao, merge, data health, enriquecimento
  { method: 'DELETE', re: new RegExp(`^/api/(contacts|companies|deals|tasks)/${ID}$`) },
  { method: 'DELETE', re: new RegExp(`^/api/erp/(proposals|rental-contracts|financial|catalog|aux-lists)/${ID}$`) },
  { method: 'DELETE', re: new RegExp(`^/api/erp/records/(suppliers|salesOrders|purchaseOrders|serviceOrders|bankAccounts)/${ID}$`) },
  { method: 'POST', re: /^\/api\/(companies\/merge|data-health\/merge|data-health\/auto-clean|data-health\/reassign-orphans|enrichment\/run)$/ },
  // 3b: envios, aceite/aprovacao, links publicos, ativacao/disparo
  { method: 'POST', re: /^\/api\/mailbox\/send$/ },
  { method: 'POST', re: /^\/api\/sequences\/enroll$/ },
  { method: 'POST', re: new RegExp(`^/api/deals/${ID}/proposal-followup$`) },
  { method: 'POST', re: new RegExp(`^/api/erp/proposals/${ID}/(approve|public-link)$`) },
  { method: 'POST', re: new RegExp(`^/api/erp/invoices/${ID}/public-link$`) },
  { method: 'PATCH', re: new RegExp(`^/api/workflows/${ID}$`) },
  { method: 'POST', re: /^\/api\/workflows\/trigger$/ },
  { method: 'POST', re: /^\/api\/marketing\/campaigns\/dispatch$/ },
  { method: 'POST', re: /^\/api\/erp\/rental-contracts\/batch-email$/ },
  // 3c: financeiro
  { method: 'POST', re: new RegExp(`^/api/erp/(financial|invoices)/${ID}/pay$`) },
  { method: 'POST', re: /^\/api\/erp\/financial\/(reconcile-ofx|import-document|import-document\/confirm)$/ },
  { method: 'POST', re: /^\/api\/erp\/purchases\/import-xml$/ },
  { method: 'POST', re: /^\/api\/erp\/records\/bankAccounts$/ },
  { method: 'PATCH', re: new RegExp(`^/api/erp/records/bankAccounts/${ID}$`) },
  // 3d: fiscal
  { method: 'POST', re: /^\/api\/erp\/invoices$/ },
  { method: 'POST', re: new RegExp(`^/api/erp/rental-contracts/${ID}/(generate-invoice|generate-remessa|partial-return|readjust)$`) },
  { method: 'POST', re: /^\/api\/erp\/rental-contracts\/batch-billing$/ },
  { method: 'POST', re: /^\/api\/erp\/nfe-importacao\/(calculate|emit)$/ },
  { method: 'PATCH', re: new RegExp(`^/api/erp/invoices/${ID}$`) },
  { method: 'DELETE', re: new RegExp(`^/api/erp/invoices/${ID}$`) },
];

export function isAllowedDangerousRoute(method: string, path: string): boolean {
  return ALLOWED_DANGEROUS.some((r) => r.method === method && r.re.test(path));
}

export class RouterDataPort implements IntegrationDataPort {
  private cache: { crm?: CrmSnapshot; tickets?: TicketSnapshot; erp?: ErpUsersSnapshot; erpCollections?: ErpCollections } = {};

  constructor(private readonly router: CrmApiRouter) {}

  private async trusted(method: string, path: string, query: Record<string, string> = {}, body?: unknown) {
    return this.router.dispatch({ method, path, query, body, context: TRUSTED_INTERNAL_CONTEXT });
  }

  /** Leitura de carga: falha 5xx (ex.: Postgres fora) => 503, nunca dados vazios/antigos. */
  private async load(path: string, query: Record<string, string> = {}) {
    const res = await this.trusted('GET', path, query);
    if (res.status >= 500) throw new IntegrationStoreUnavailableError();
    return res;
  }

  private users(): IntegrationUser[] {
    const rbac = this.router.getRepository().getRbacState();
    return (rbac.users || []).map(toIntegrationUser);
  }

  snapshot(domain: 'crm'): Promise<CrmSnapshot>;
  snapshot(domain: 'tickets'): Promise<TicketSnapshot>;
  snapshot(domain: 'erp'): Promise<ErpUsersSnapshot>;
  snapshot(domain: DataDomain): Promise<CrmSnapshot | TicketSnapshot | ErpUsersSnapshot>;
  async snapshot(domain: DataDomain): Promise<CrmSnapshot | TicketSnapshot | ErpUsersSnapshot> {
    if (domain === 'erp') {
      if (this.cache.erp) return this.cache.erp;
      await this.load('/api/pipelines');
      const snap: ErpUsersSnapshot = structuredClone({ users: this.users() });
      this.cache.erp = snap;
      return snap;
    }
    if (domain === 'crm') {
      if (this.cache.crm) return this.cache.crm;
      // GET leve: o dispatch carrega o estado do Postgres (mesmo caminho da aplicacao).
      await this.load('/api/pipelines');
      const repo = this.router.getRepository();
      const snap: CrmSnapshot = structuredClone({
        contacts: repo.listContacts(),
        companies: repo.listCompanies(),
        deals: repo.listDeals(),
        pipelines: repo.listPipelines(),
        timeline: repo.listTimelineEvents(),
        users: this.users(),
      });
      this.cache.crm = snap;
      return snap;
    }
    if (this.cache.tickets) return this.cache.tickets;
    // GET /api/tickets carrega os chamados das tabelas setadesk_* (fonte de verdade com Postgres).
    // O filtro impossivel evita montar a lista enriquecida no router; os dados brutos vem do repo.
    await this.load('/api/tickets', { status: '__NONE__' });
    const repo = this.router.getRepository();
    const snap: TicketSnapshot = structuredClone({
      tickets: repo.listServiceTickets(),
      contacts: repo.listContacts(),
      companies: repo.listCompanies(),
      deals: repo.listDeals(),
      users: this.users(),
    });
    this.cache.tickets = snap;
    return snap;
  }

  async listUsers(): Promise<IntegrationUser[]> {
    if (this.cache.crm) return structuredClone(this.cache.crm.users);
    await this.load('/api/pipelines');
    return structuredClone(this.users());
  }

  async read(path: string, query: Record<string, string> = {}): Promise<ErpReadResult> {
    if (!ALLOWED_READ_PATHS.some((re) => re.test(path))) {
      throw new Error('Leitura interna fora da allowlist da API v1.');
    }
    const q: Record<string, string> = {};
    for (const [k, v] of Object.entries(query)) {
      if (!ALLOWED_READ_QUERY.test(k)) throw new Error('Parametro de leitura interna fora da allowlist.');
      if (v !== undefined && v !== null && v !== '') q[k] = String(v);
    }
    const res = await this.load(path, q);
    return { status: res.status, body: structuredClone(res.body) };
  }

  async erpCollections(): Promise<ErpCollections> {
    if (this.cache.erpCollections) return structuredClone(this.cache.erpCollections);
    // GET leve que carrega o estado do Postgres (crm_state_v1) pelo mesmo caminho da tela.
    await this.load('/api/pipelines');
    const erp = this.router.getRepository().getErpState();
    const snap: ErpCollections = structuredClone({
      rentalContracts: erp.rentalContracts || [],
      invoices: erp.invoices || [],
      catalog: erp.catalog || [],
      financialEntries: erp.financialEntries || [],
      bankAccounts: erp.bankAccounts || [],
      salesOrders: erp.salesOrders || [],
      suppliers: erp.suppliers || [],
      employees: erp.employees || [],
      purchaseOrders: erp.purchaseOrders || [],
      fiscalDocumentSettings: erp.fiscalDocumentSettings || null,
      gestaoClickConfig: erp.gestaoClickConfig || null,
    });
    this.cache.erpCollections = snap;
    return structuredClone(snap);
  }

  async listTicketQueues(): Promise<SetaDeskPipeline[]> {
    const res = await this.load('/api/tickets/pipelines');
    const data = (res.body as { data?: SetaDeskPipeline[] })?.data;
    return Array.isArray(data) ? structuredClone(data) : [];
  }

  async write(method: 'POST' | 'PATCH', path: string, body: Record<string, unknown>, opts: { actorUserId?: string } = {}): Promise<DataWriteResult> {
    if (!ALLOWED_WRITE_PATHS.some((re) => re.test(path))) {
      throw new Error('Escrita interna fora da allowlist da API v1.');
    }
    assertSafeWriteBody(method, path, body);
    this.cache = {};
    // Correcao CISO (Lote 2, 3): dono da credencial como ator (so honrado no contexto interno).
    const query: Record<string, string> = opts.actorUserId ? { _integrationActorId: opts.actorUserId } : {};
    const res = await this.trusted(method, path, query, body);
    return { status: res.status, body: res.body };
  }

  async dangerous(method: 'POST' | 'PATCH' | 'DELETE', path: string, body: Record<string, unknown>, opts: { actorUserId?: string } = {}): Promise<DataWriteResult> {
    if (!isAllowedDangerousRoute(method, path)) {
      throw new Error('Operacao perigosa fora da allowlist da API v1 (Lote 3).');
    }
    this.cache = {};
    const query: Record<string, string> = opts.actorUserId ? { _integrationActorId: opts.actorUserId } : {};
    if (opts.actorUserId && path === '/api/mailbox/send') query._integrationMailboxSend = '1';
    const res = await this.trusted(method, path, query, method === 'DELETE' ? {} : body);
    return { status: res.status, body: res.body };
  }
}
