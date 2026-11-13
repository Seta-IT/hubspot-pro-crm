// ============================================================================
// STI-hub — API v1 + MCP: autenticacao (Bearer de integracao / OAuth / sessao) e
// contexto de autorizacao aplicado no servidor.
// ============================================================================
import { claimsMayManageIam } from '../../app/lib/iam-admin-routes';
import { isSessionTokenRevoked } from '../../app/lib/session-revocation';
import { verifyStiHubSessionToken, type StiHubSignedSessionClaims } from '../../app/lib/auth';
import type { IntegrationUser } from './data-port';
import {
  moduleForScope,
  narrowestPortfolio,
  normalizeModuleAccess,
  sanitizeRuntimeScopes,
  type IntegrationModuleAccess,
  type IntegrationScope,
  type PortfolioScope,
} from './scopes';
import type { IntegrationStore } from './store';
import { classifyBearer, sha256Hex } from './tokens';

export type IntegrationChannel = 'rest_v1' | 'mcp';

export interface AuthContext {
  channel: IntegrationChannel;
  authType: 'api_key' | 'oauth';
  keyId: string | null;
  oauthClientId: string | null;
  oauthTokenId: string | null;
  /** Usuario dono da chave / que autorizou o OAuth (carteira e alcada derivam dele). */
  actorUserId: string;
  scopes: Set<IntegrationScope>;
  portfolioScope: PortfolioScope;
  moduleAccess: IntegrationModuleAccess;
  teamMemberIds: string[];
  /** Rotulo do autor nos registros (timeline, comentarios). */
  actorLabel: string;
  requestId: string;
  ip: string;
}

export type AuthFailure = { ok: false; status: 401 | 403; code: string; title: string };
export type AuthSuccess = { ok: true; ctx: AuthContext };

/** Valida o Bearer (chave de integracao ou token OAuth) consultando SOMENTE o hash no Postgres. */
export async function authenticateBearer(
  store: IntegrationStore,
  authorization: string | null | undefined,
  opts: { channel: IntegrationChannel; requestId: string; ip: string; now: Date }
): Promise<AuthSuccess | AuthFailure> {
  const bearer = classifyBearer(authorization);
  if (bearer.kind === 'none') {
    return { ok: false, status: 401, code: 'AUTH_REQUIRED', title: 'Autenticacao obrigatoria: envie Authorization: Bearer <chave de integracao ou token OAuth>.' };
  }
  if (bearer.kind === 'invalid') {
    return { ok: false, status: 401, code: 'TOKEN_INVALID', title: 'Credencial invalida.' };
  }
  const nowIso = opts.now.toISOString();
  const hash = sha256Hex(bearer.token);
  if (bearer.kind === 'api_key') {
    const key = await store.getApiKeyByHash(hash);
    if (!key) return { ok: false, status: 401, code: 'TOKEN_INVALID', title: 'Credencial invalida.' };
    if (key.revokedAt) return { ok: false, status: 401, code: 'TOKEN_REVOKED', title: 'Chave de integracao revogada.' };
    if (key.expiresAt && key.expiresAt <= nowIso) return { ok: false, status: 401, code: 'TOKEN_EXPIRED', title: 'Chave de integracao expirada.' };
    await store.touchApiKey(key.id, nowIso).catch(() => undefined);
    return {
      ok: true,
      ctx: {
        channel: opts.channel,
        authType: 'api_key',
        keyId: key.id,
        oauthClientId: null,
        oauthTokenId: null,
        actorUserId: key.ownerUserId,
        scopes: new Set(sanitizeRuntimeScopes(key.scopes)),
        portfolioScope: key.portfolioScope,
        moduleAccess: normalizeModuleAccess(key.moduleAccess),
        teamMemberIds: key.teamMemberIds.slice(0, 200),
        actorLabel: `Integracao API: ${key.name}`.slice(0, 120),
        requestId: opts.requestId,
        ip: opts.ip,
      },
    };
  }
  const tok = await store.getTokenByAccessHash(hash);
  if (!tok) return { ok: false, status: 401, code: 'TOKEN_INVALID', title: 'Credencial invalida.' };
  if (tok.revokedAt) return { ok: false, status: 401, code: 'TOKEN_REVOKED', title: 'Token OAuth revogado.' };
  if (tok.expiresAt <= nowIso) return { ok: false, status: 401, code: 'TOKEN_EXPIRED', title: 'Token OAuth expirado.' };
  const client = await store.getOAuthClient(tok.clientId);
  if (!client || client.revokedAt) return { ok: false, status: 401, code: 'CLIENT_REVOKED', title: 'Cliente OAuth revogado.' };
  return {
    ok: true,
    ctx: {
      channel: opts.channel,
      authType: 'oauth',
      keyId: null,
      oauthClientId: tok.clientId,
      oauthTokenId: tok.id,
      actorUserId: tok.userId,
      scopes: new Set(sanitizeRuntimeScopes(tok.scope)),
      portfolioScope: tok.portfolioScope,
      moduleAccess: normalizeModuleAccess(tok.moduleAccess),
      teamMemberIds: tok.teamMemberIds.slice(0, 200),
      actorLabel: `Integracao OAuth: ${client.clientName}`.slice(0, 120),
      requestId: opts.requestId,
      ip: opts.ip,
    },
  };
}

/**
 * Revalida o dono da credencial contra o cadastro ATUAL (a cada requisicao):
 *  - usuario inexistente/inativo => 401;
 *  - carteira efetiva = a mais restritiva entre credencial e usuario;
 *  - moduleAccess efetivo = intersecao credencial x usuario.
 */
export function applyOwnerCeiling(ctx: AuthContext, users: IntegrationUser[]): AuthFailure | { ok: true; owner: IntegrationUser } {
  const owner = users.find((u) => u.id === ctx.actorUserId);
  if (!owner || !owner.active) {
    return { ok: false, status: 401, code: 'CREDENTIAL_OWNER_INACTIVE', title: 'O usuario dono desta credencial nao existe ou esta inativo.' };
  }
  ctx.portfolioScope = narrowestPortfolio(ctx.portfolioScope, owner.portfolioScope);
  ctx.moduleAccess = {
    crm: ctx.moduleAccess.crm && owner.moduleAccess.crm,
    chamados: ctx.moduleAccess.chamados && owner.moduleAccess.chamados,
  };
  return { ok: true, owner };
}

export function hasScope(ctx: AuthContext, scope: IntegrationScope): boolean {
  if (!ctx.scopes.has(scope)) return false;
  const mod = moduleForScope(scope);
  if (mod === 'crm' && !ctx.moduleAccess.crm) return false;
  if (mod === 'chamados' && !ctx.moduleAccess.chamados) return false;
  return true;
}

export interface SessionCheck {
  ok: boolean;
  status: 200 | 401 | 403;
  code: string;
  claims: StiHubSignedSessionClaims | null;
}

/** Sessao STI-hub assinada, com 2FA verificado e nao revogada nesta instancia. */
export function verifyMfaSession(token: string | null | undefined): SessionCheck {
  if (!token) return { ok: false, status: 401, code: 'MFA_AUTH_REQUIRED', claims: null };
  if (isSessionTokenRevoked(token)) return { ok: false, status: 401, code: 'MFA_SESSION_INVALID', claims: null };
  const v = verifyStiHubSessionToken(token);
  if (!v.valid || !v.claims || !v.claims.mfaVerified) return { ok: false, status: 401, code: 'MFA_SESSION_INVALID', claims: null };
  return { ok: true, status: 200, code: 'MFA_SESSION_VERIFIED', claims: v.claims };
}

/** Sessao 2FA + alcada ADMIN de IAM (canManageUsersRbac assinado). */
export function verifyIamAdminSession(token: string | null | undefined): SessionCheck {
  const s = verifyMfaSession(token);
  if (!s.ok) return s;
  if (!claimsMayManageIam(s.claims)) return { ok: false, status: 403, code: 'IAM_ADMIN_FORBIDDEN', claims: s.claims };
  return s;
}
