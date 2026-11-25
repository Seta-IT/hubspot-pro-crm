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
  };
  /** Papel do IAM (SUPER_ADMIN/DIRETORIA = administrador para dados sensiveis do ERP). */
  roleId: string;
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
  write(method: 'POST' | 'PATCH', path: string, body: Record<string, unknown>): Promise<DataWriteResult>;
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
    },
    roleId: String(u.roleId || ''),
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
];

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

  async write(method: 'POST' | 'PATCH', path: string, body: Record<string, unknown>): Promise<DataWriteResult> {
    if (!ALLOWED_WRITE_PATHS.some((re) => re.test(path))) {
      throw new Error('Escrita interna fora da allowlist da API v1.');
    }
    this.cache = {};
    const res = await this.trusted(method, path, {}, body);
    return { status: res.status, body: res.body };
  }
}
