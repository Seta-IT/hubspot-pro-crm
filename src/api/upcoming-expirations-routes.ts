// ============================================================================
// GET /api/erp/vencimentos — faixa do topo com vencimentos nos próximos 30 dias.
// Consulta agregada (contagens), cache curto por usuário e permissões, sem devolver
// a lista completa. Sessão obrigatória. Cada tipo só entra se o usuário puder vê-lo.
// ============================================================================
import type { CrmRepository } from '../db/repository';
import type { PgQ } from '../db/proposal-store';
import { countProposalsExpiringUntil } from '../db/proposal-store';
import { buildDefaultErpItemPermissions, ERP_ROLES_CATALOG, type ErpAccountRole } from '../app/lib/rbac';
import {
  toCertificateView,
  type CertificateStore,
} from '../modules/erp/certificate-a1';
import { todayInSaoPaulo } from '../modules/erp/dashboard-metrics';
import {
  EXPIRATION_WINDOW_DAYS,
  buildUpcomingExpirations,
  expirationUntilDate,
  readExpirationCache,
  writeExpirationCache,
  type ExpirationAccess,
  type UpcomingExpirationsResult,
} from '../modules/erp/upcoming-expirations';

export interface UpcomingExpirationsRouteDeps {
  repo: CrmRepository;
  certificateStore?: CertificateStore | null;
  proposalsTableEnabled: boolean;
  proposalsDb?: () => PgQ;
  proposalOwner: (query: Record<string, string | undefined>, ctx: { trustedInternal: boolean; serviceAccount?: boolean }) => { id: string; email: string } | null;
  proposalScopeDenied: (query: Record<string, string | undefined>, ctx: { trustedInternal: boolean; serviceAccount?: boolean }) => boolean;
}

type Resp = { status: number; body: Record<string, unknown> };

function levelAllows(level: unknown): boolean {
  const v = String(level || 'NONE').toUpperCase();
  return v === 'VIEW' || v === 'EDIT' || v === 'FULL';
}

function resolveExpirationAccess(
  repo: CrmRepository,
  query: Record<string, string | undefined>,
  ctx: { trustedInternal: boolean; serviceAccount?: boolean }
): { authenticated: boolean; cacheKey: string | null; access: ExpirationAccess } | { authenticated: false } {
  if (ctx.trustedInternal && !query._sessionToken) {
    const access: ExpirationAccess = {
      contracts: true,
      invoices: true,
      receivables: true,
      payables: true,
      proposals: true,
      certificate: true,
    };
    return { authenticated: true, cacheKey: null, access };
  }
  const sess = query._sessionToken ? repo.resolveSessionFromToken(query._sessionToken) : null;
  if (!sess || !sess.authenticated || !sess.user) return { authenticated: false };
  const user = sess.user as {
    id?: string;
    email?: string;
    roleId?: string;
    moduleAccess?: { erp?: boolean };
  };
  const moduleAccess = user.moduleAccess;
  const roleId = String(user.roleId || '');
  const isAdmin =
    Boolean(sess.effectiveActionGuards?.canManageUsersRbac) || roleId === 'SUPER_ADMIN' || roleId === 'DIRETORIA';
  const erpEnabled = isAdmin || moduleAccess?.erp === true;
  const rec = repo.findRbacUserRecord(user.id || '', user.email || '');
  const erpRoleRaw = String(rec?.erpRole || sess.erpPermissions?.erpRole || sess.role?.erpRole || 'ERP_NONE');
  const erpRole = (erpRoleRaw in ERP_ROLES_CATALOG ? erpRoleRaw : 'ERP_NONE') as ErpAccountRole;
  const items: Record<string, { view?: boolean }> = {
    ...buildDefaultErpItemPermissions(erpRole),
    ...(sess.role?.erpItemPermissions || {}),
    ...(rec?.erpItemPermissions || {}),
  };
  const perms = sess.erpPermissions;
  const access: ExpirationAccess = {
    contracts:
      erpEnabled && (isAdmin || levelAllows(perms?.rentalContractsAccess) || Boolean(items['erp.contratos_locacoes']?.view)),
    invoices:
      erpEnabled && (isAdmin || levelAllows(perms?.fiscalIssuanceAccess) || Boolean(items['erp.fiscal_notas']?.view)),
    receivables:
      erpEnabled && (isAdmin || levelAllows(perms?.financeBanksAccess) || Boolean(items['erp.financeiro_pagar_receber']?.view)),
    payables:
      erpEnabled && (isAdmin || levelAllows(perms?.financeBanksAccess) || Boolean(items['erp.financeiro_pagar_receber']?.view)),
    proposals:
      erpEnabled && (isAdmin || levelAllows(perms?.proposalsQuotesAccess) || Boolean(items['erp.orcamentos_propostas']?.view)),
    certificate:
      erpEnabled &&
      (isAdmin ||
        levelAllows(perms?.fiscalIssuanceAccess) ||
        Boolean(items['erp.fiscal_notas']?.view) ||
        Boolean(items['erp.configuracoes_empresa']?.view)),
  };
  const cacheKey = [
    String(user.id || user.email || 'anon'),
    access.contracts ? 'c' : '',
    access.invoices ? 'i' : '',
    access.receivables ? 'r' : '',
    access.payables ? 'p' : '',
    access.proposals ? 'o' : '',
    access.certificate ? 'a' : '',
  ].join('|');
  return { authenticated: true, cacheKey, access };
}

export async function handleUpcomingExpirationsRoute(
  deps: UpcomingExpirationsRouteDeps,
  query: Record<string, string | undefined>,
  ctx: { trustedInternal: boolean; serviceAccount?: boolean }
): Promise<Resp> {
  const resolved = resolveExpirationAccess(deps.repo, query, ctx);
  if (!resolved.authenticated) {
    return { status: 401, body: { error: 'Sessão expirada. Entre de novo.', code: 'SESSION_REQUIRED' } };
  }
  const today = todayInSaoPaulo();
  const cacheKey = resolved.cacheKey ? `${resolved.cacheKey}|${today}` : null;
  if (cacheKey) {
    const cached = readExpirationCache(cacheKey);
    if (cached) return { status: 200, body: { data: cached, cached: true } };
  }

  const access = resolved.access;
  const empty = access.contracts || access.invoices || access.receivables || access.payables || access.proposals || access.certificate;
  if (!empty) {
    const data: UpcomingExpirationsResult = { windowDays: EXPIRATION_WINDOW_DAYS, today, text: '', items: [] };
    if (cacheKey) writeExpirationCache(cacheKey, data);
    return { status: 200, body: { data } };
  }

  const erp = deps.repo.getErpOverview();
  let proposals: number | Array<{ validUntil?: unknown; status?: unknown }> = [];
  if (access.proposals && !deps.proposalScopeDenied(query, ctx)) {
    const owner = deps.proposalOwner(query, ctx);
    if (deps.proposalsTableEnabled && deps.proposalsDb) {
      try {
        proposals = await countProposalsExpiringUntil(deps.proposalsDb(), expirationUntilDate(today), owner);
      } catch {
        return { status: 503, body: { error: 'Não foi possível consultar os vencimentos agora. Tente de novo em instantes.', code: 'VENCIMENTOS_UNAVAILABLE' } };
      }
    } else {
      proposals = deps.repo.listProposals();
    }
  } else {
    proposals = 0;
  }

  let certificate = null;
  if (access.certificate && deps.certificateStore) {
    try {
      certificate = toCertificateView(await deps.certificateStore.load());
    } catch {
      certificate = null;
    }
  }

  const data = buildUpcomingExpirations({
    today,
    access: {
      ...access,
      proposals: access.proposals && !deps.proposalScopeDenied(query, ctx),
    },
    contracts: access.contracts ? erp.rentalContracts || [] : [],
    invoices: access.invoices ? erp.invoices || [] : [],
    financial: access.receivables || access.payables ? erp.financialEntries || [] : [],
    proposals,
    certificate,
  });
  if (cacheKey) writeExpirationCache(cacheKey, data);
  return { status: 200, body: { data } };
}
