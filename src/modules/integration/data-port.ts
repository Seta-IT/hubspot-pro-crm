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
  Pipeline,
  ServiceTicket,
  SetaDeskPipeline,
  StiHubUserRecord,
  TimelineEvent,
} from '../../db/types';
import type { CrmApiRouter } from '../../api/router';
import { TRUSTED_INTERNAL_CONTEXT } from '../../api/router';
import { buildDefaultCrmPermissionsForRole } from '../erp/rbac-seed';
import { isPortfolioScope, type PortfolioScope } from './scopes';
import { IntegrationStoreUnavailableError } from './store-errors';

export interface IntegrationUser {
  id: string;
  name: string;
  email: string;
  hubspotOwnerId: string | null;
  active: boolean;
  moduleAccess: { crm: boolean; chamados: boolean };
  portfolioScope: PortfolioScope;
  /** Nivel de acesso do CRM do usuario (VIEW/EDIT/FULL/NONE) quando definido. */
  crmAccess: { contacts?: string; companies?: string; deals?: string; tickets?: string };
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

export type DataDomain = 'crm' | 'tickets';

export interface IntegrationDataPort {
  /** Snapshot (copiado) do CRM ou dos chamados; reaproveitado na mesma requisicao ate a proxima escrita. */
  snapshot(domain: 'crm'): Promise<CrmSnapshot>;
  snapshot(domain: 'tickets'): Promise<TicketSnapshot>;
  snapshot(domain: DataDomain): Promise<CrmSnapshot | TicketSnapshot>;
  listTicketQueues(): Promise<SetaDeskPipeline[]>;
  /** Usuarios (cadastro vivo do IAM) — teto de carteira/modulos/alcada no consentimento OAuth. */
  listUsers(): Promise<IntegrationUser[]>;
  /** Escrita via rota interna existente (POST/PATCH apenas). */
  write(method: 'POST' | 'PATCH', path: string, body: Record<string, unknown>): Promise<DataWriteResult>;
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
  return {
    id: String(u.id),
    name: String(u.name || ''),
    email: String(u.email || '').toLowerCase(),
    hubspotOwnerId: u.hubspotOwnerId ? String(u.hubspotOwnerId) : null,
    active: u.active !== false,
    moduleAccess: { crm: ma.crm === true, chamados: ma.chamados === true },
    portfolioScope: isPortfolioScope(scopeRaw) ? scopeRaw : 'PROPRIOS',
    crmAccess: {
      contacts: u.crmPermissions?.contactsAccess ?? preset.contactsAccess,
      companies: u.crmPermissions?.companiesAccess ?? preset.companiesAccess,
      deals: u.crmPermissions?.dealsFunnelAccess ?? preset.dealsFunnelAccess,
      tickets: u.crmPermissions?.ticketsServiceDeskAccess ?? preset.ticketsServiceDeskAccess,
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
];

export class RouterDataPort implements IntegrationDataPort {
  private cache: { crm?: CrmSnapshot; tickets?: TicketSnapshot } = {};

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
  snapshot(domain: DataDomain): Promise<CrmSnapshot | TicketSnapshot>;
  async snapshot(domain: DataDomain): Promise<CrmSnapshot | TicketSnapshot> {
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
