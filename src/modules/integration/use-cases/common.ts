// Utilitarios compartilhados pelos casos de uso (CRM e Chamados).
import type { DataWriteResult, IntegrationUser } from '../data-port';
import { UseCaseError, type UseCaseContext } from './types';

const ACCESS_RANK: Record<string, number> = { NONE: 0, VIEW: 1, EDIT: 2, FULL: 3 };

export type CrmArea = keyof IntegrationUser['crmAccess'];

/**
 * Alcada do usuario no CRM/Chamados. Valor ausente/desconhecido => NEGA (fail-closed).
 * (toIntegrationUser ja preenche lacunas com o preset restrito do papel.)
 */
export function userHasAccess(user: Pick<IntegrationUser, 'crmAccess'>, area: CrmArea, level: 'VIEW' | 'EDIT'): boolean {
  const v = user.crmAccess?.[area];
  if (typeof v !== 'string' || !(v in ACCESS_RANK)) return false;
  return ACCESS_RANK[v] >= ACCESS_RANK[level];
}

/** Alcada do dono da credencial — a credencial nunca excede o usuario. */
export function requireOwnerAccess(ctx: Pick<UseCaseContext, 'owner'>, area: CrmArea, level: 'VIEW' | 'EDIT'): void {
  if (!userHasAccess(ctx.owner, area, level)) {
    throw new UseCaseError(403, 'OWNER_ACCESS_INSUFFICIENT', 'O usuario dono desta credencial nao tem alcada para esta operacao.', {
      area,
      requiredLevel: level,
    });
  }
}

/** Areas de alcada exigidas por um escopo (qualquer uma basta quando ha mais de uma). */
export function areasForScope(scope: string): { areas: CrmArea[]; level: 'VIEW' | 'EDIT' } | null {
  const level: 'VIEW' | 'EDIT' = scope.endsWith(':write') ? 'EDIT' : 'VIEW';
  if (scope.startsWith('crm:contacts:')) return { areas: ['contacts'], level };
  if (scope.startsWith('crm:companies:')) return { areas: ['companies'], level };
  if (scope.startsWith('crm:deals:') || scope === 'crm:pipelines:read') return { areas: ['deals'], level };
  if (scope.startsWith('crm:activities:')) return { areas: ['contacts', 'companies', 'deals'], level };
  if (scope.startsWith('tickets:')) return { areas: ['tickets'], level };
  return null;
}

// ---------------------------------------------------------------------------
// Fase 2 / Lote 1: alcadas de TELA do ERP replicadas no conector (fail-closed).
// O RouterDataPort usa TRUSTED_INTERNAL_CONTEXT (pula a sessao do router); por isso toda
// permissao de tela relevante e conferida AQUI, antes de qualquer leitura.
// ---------------------------------------------------------------------------
export type ErpArea = 'proposals' | 'contracts' | 'stockOsSales' | 'finance' | 'fiscal';

/** Alcada do ERP: valor ausente/desconhecido => NEGA. */
export function userHasErpAccess(user: Pick<IntegrationUser, 'erpAccess'>, area: ErpArea, level: 'VIEW' | 'EDIT'): boolean {
  const v = user.erpAccess?.[area];
  if (typeof v !== 'string' || !(v in ACCESS_RANK)) return false;
  return ACCESS_RANK[v] >= ACCESS_RANK[level];
}

/** Administrador para dados sensiveis do ERP (colaboradores): SUPER_ADMIN ou DIRETORIA. */
export function isErpAdmin(user: Pick<IntegrationUser, 'roleId'>): boolean {
  return user.roleId === 'SUPER_ADMIN' || user.roleId === 'DIRETORIA';
}

type ScopeUser = Pick<IntegrationUser, 'crmAccess' | 'erpAccess' | 'roleId'>;

/**
 * O usuario dono atende a alcada exigida pelo escopo? (escopos sem regra => true).
 * Usado no preauthorize (toda chamada), no consentimento OAuth e na criacao de chave.
 */
export function ownerMeetsScope(user: ScopeUser, scope: string): boolean {
  const need = areasForScope(scope);
  if (need) return need.areas.some((a) => userHasAccess(user, a, need.level));
  const erp = (a: ErpArea) => userHasErpAccess(user, a, 'VIEW');
  switch (scope) {
    case 'crm:tasks:read':
      return (['contacts', 'companies', 'deals'] as CrmArea[]).some((a) => userHasAccess(user, a, 'VIEW'));
    case 'crm:automation:read':
    case 'crm:marketing:read':
      return userHasAccess(user, 'marketing', 'VIEW');
    case 'crm:analytics:read':
      return userHasAccess(user, 'deals', 'VIEW');
    case 'crm:data_health:read':
      return userHasAccess(user, 'contacts', 'VIEW');
    case 'erp:dashboard:read':
    case 'erp:proposals:read':
      return erp('proposals');
    case 'erp:contracts:read':
      return erp('contracts');
    case 'erp:orders:read':
      return erp('stockOsSales');
    case 'erp:catalog:read':
      return erp('proposals') || erp('contracts') || erp('stockOsSales');
    case 'erp:records:read':
      return erp('stockOsSales') || erp('finance');
    case 'erp:financial:read':
      return erp('finance');
    case 'erp:banks:read':
      return erp('finance') && user.erpAccess?.canViewBankBalances === true;
    case 'erp:fiscal:read':
      return erp('fiscal');
    default:
      return true;
  }
}

/** Lanca 403 quando o dono nao atende a alcada do escopo (defesa em profundidade nos handlers). */
export function requireOwnerScope(ctx: Pick<UseCaseContext, 'owner'>, scope: string): void {
  if (!ownerMeetsScope(ctx.owner, scope)) {
    throw new UseCaseError(403, 'OWNER_ACCESS_INSUFFICIENT', 'O usuario dono desta credencial nao tem alcada para esta operacao.', { scope });
  }
}

/** Dados de empresa inteira (agregados, financeiro, fiscal): exige carteira efetiva TODOS. */
export function requireAllPortfolio(ctx: Pick<UseCaseContext, 'auth'>, what: string): void {
  if (ctx.auth.portfolioScope !== 'TODOS') {
    throw new UseCaseError(403, 'PORTFOLIO_ALL_REQUIRED', `${what} exige carteira TODOS (credencial e usuario dono).`, { requiredPortfolio: 'TODOS' });
  }
}

/** Escopos acima da alcada (RBAC) do usuario — usados no consentimento OAuth e na criacao de chave. */
export function scopesAboveUserAccess(scopes: readonly string[], user: ScopeUser): string[] {
  return scopes.filter((s) => !ownerMeetsScope(user, s));
}

/** Converte a resposta da rota interna em erro tipado (sem ecoar corpo do cliente). */
export function unwrapWrite(res: DataWriteResult, what: string): any {
  if (res.status >= 200 && res.status < 300) {
    const data = res.body && typeof res.body === 'object' ? (res.body as { data?: unknown }).data : undefined;
    if (!data) throw new UseCaseError(500, 'WRITE_EMPTY_RESULT', `Falha ao gravar ${what}.`);
    return data;
  }
  const msg = res.body && typeof res.body === 'object' && typeof (res.body as { error?: unknown }).error === 'string'
    ? String((res.body as { error: string }).error).slice(0, 300)
    : `Falha ao gravar ${what}.`;
  const code = res.body && typeof res.body === 'object' && typeof (res.body as { code?: unknown }).code === 'string'
    ? String((res.body as { code: string }).code).slice(0, 80)
    : 'WRITE_REJECTED';
  if (res.status === 404) throw new UseCaseError(404, 'NOT_FOUND', `${what} nao encontrado(a).`);
  if (res.status >= 400 && res.status < 500) throw new UseCaseError(res.status === 400 ? 422 : res.status, code, msg);
  throw new UseCaseError(502, 'UPSTREAM_ERROR', `Falha interna ao gravar ${what}.`);
}

export const sortByUpdatedDesc = <T extends { id: string; updatedAt?: string; createdAt?: string }>(list: T[]): T[] =>
  [...list].sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')) || a.id.localeCompare(b.id));

export const includesText = (q: string | undefined, ...fields: Array<unknown>): boolean => {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return true;
  return fields.some((f) => String(f ?? '').toLowerCase().includes(needle));
};

export function sourceMetadata(ctx: UseCaseContext): Record<string, unknown> {
  return {
    source: ctx.auth.channel === 'mcp' ? 'STIHUB_MCP' : 'STIHUB_API_V1',
    integrationKeyId: ctx.auth.keyId,
    oauthClientId: ctx.auth.oauthClientId,
    requestId: ctx.auth.requestId,
  };
}
