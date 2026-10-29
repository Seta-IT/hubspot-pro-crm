// ============================================================================
// STI-hub — Conta de servico "Assistente de Vendas" (29/10/2026)
// Autenticacao por Bearer `stihub_svc_<base64url 32 bytes>`, comparada por SHA-256
// com STI_HUB_SALES_AGENT_TOKEN_SHA256 (lista separada por virgula = rotacao).
// INERTE: sem a variavel de ambiente, todo Bearer de servico recebe 401.
// Compartilhado entre o middleware (Edge) e o router (Node): sem APIs do Node aqui.
// ============================================================================
import { constantTimeEqual, sha256Hex } from './auth';

export const SALES_AGENT_SERVICE_ID = 'svc-assistente-vendas';
export const SALES_AGENT_ACTOR_NAME = 'Assistente de Vendas (serviço)';
export const SALES_AGENT_ACTOR_EMAIL = 'svc-assistente-vendas@servico.sti-hub';
export const SALES_AGENT_TOKEN_ENV = 'STI_HUB_SALES_AGENT_TOKEN_SHA256';
export const SERVICE_TOKEN_PREFIX = 'stihub_svc_';
/** 32 bytes em base64url sem padding = 43 caracteres. */
export const SERVICE_TOKEN_REGEX = /^stihub_svc_[A-Za-z0-9_-]{43}$/;
export const SERVICE_MAX_BODY_BYTES = 32 * 1024;
export const SERVICE_RATE_PER_MINUTE = 60;
export const SERVICE_CREATES_PER_DAY = 500;
export const SERVICE_LIST_DEFAULT_LIMIT = 25;
export const SERVICE_LIST_MAX_LIMIT = 50;

/**
 * Extrai o token de servico do header Authorization.
 * - null  => nao e uma tentativa de autenticacao de servico (header ausente ou outro esquema);
 * - ''    => "Bearer stihub_svc_..." em formato invalido (sera recusado com 401);
 * - token => formato valido (ainda precisa conferir o hash).
 */
export function parseServiceBearer(authorization: string | null | undefined): string | null {
  const raw = String(authorization || '').trim();
  const m = raw.match(/^Bearer\s+(\S+)$/i);
  if (!m) return null;
  const tok = m[1];
  if (!tok.startsWith(SERVICE_TOKEN_PREFIX)) return null;
  return SERVICE_TOKEN_REGEX.test(tok) ? tok : '';
}

export function hashServiceToken(token: string): string {
  return sha256Hex(token).toLowerCase();
}

/** Hashes SHA-256 (hex) aceitos; lista vazia => autenticacao de servico desativada. */
export function getConfiguredSalesAgentTokenHashes(
  env: Record<string, string | undefined> | undefined = typeof process !== 'undefined' ? process.env : undefined
): string[] {
  const raw = String(env?.[SALES_AGENT_TOKEN_ENV] || '');
  return raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => /^[0-9a-f]{64}$/.test(h))
    .slice(0, 5);
}

/** Compara o hash com TODOS os configurados, em tempo constante (sem curto-circuito). */
export function isAcceptedServiceTokenHash(tokenHash: string, configured: string[]): boolean {
  const h = String(tokenHash || '').toLowerCase();
  let ok = false;
  for (const c of configured) {
    if (constantTimeEqual(h, c)) ok = true;
  }
  return configured.length > 0 && /^[0-9a-f]{64}$/.test(h) && ok;
}

const RESERVED_IDS = new Set(['merge', 'export', 'bulk', 'import', 'batch', 'all', 'search']);
const ID_RE = /^[A-Za-z0-9._-]{1,80}$/;
const isId = (s: string | undefined) => !!s && ID_RE.test(s) && !RESERVED_IDS.has(s.toLowerCase());

export type ServiceRouteKind = 'READ' | 'CREATE';

/**
 * Allowlist estrita (metodo + rota) do Assistente de Vendas. Qualquer outra combinacao => 403.
 */
export function classifySalesAgentRoute(
  method: string,
  pathname: string
): { allowed: true; kind: ServiceRouteKind; resource: 'PROPOSAL' | 'COMPANY' | 'CONTACT' } | { allowed: false } {
  const m = String(method || '').toUpperCase();
  const clean = (String(pathname || '/').split('?')[0].replace(/\/+$/, '') || '/');
  if (clean !== clean.trim() || clean.includes('//') || clean.includes('..') || clean.includes('%')) {
    return { allowed: false };
  }
  const seg = clean.split('/').filter(Boolean);
  if (seg[0] !== 'api') return { allowed: false };

  // Propostas: GET/POST lista, GET :id, GET :id/acceptance-status
  if (seg[1] === 'erp' && seg[2] === 'proposals') {
    if (seg.length === 3 && (m === 'GET' || m === 'POST')) {
      return { allowed: true, kind: m === 'POST' ? 'CREATE' : 'READ', resource: 'PROPOSAL' };
    }
    if (seg.length === 4 && m === 'GET' && isId(seg[3])) return { allowed: true, kind: 'READ', resource: 'PROPOSAL' };
    if (seg.length === 5 && m === 'GET' && isId(seg[3]) && seg[4] === 'acceptance-status') {
      return { allowed: true, kind: 'READ', resource: 'PROPOSAL' };
    }
    return { allowed: false };
  }
  // Empresas e contatos: GET/POST lista, GET :id
  if ((seg[1] === 'companies' || seg[1] === 'contacts') && seg.length <= 3) {
    const resource = seg[1] === 'companies' ? 'COMPANY' : 'CONTACT';
    if (seg.length === 2 && (m === 'GET' || m === 'POST')) {
      return { allowed: true, kind: m === 'POST' ? 'CREATE' : 'READ', resource };
    }
    if (seg.length === 3 && m === 'GET' && isId(seg[2])) return { allowed: true, kind: 'READ', resource };
  }
  return { allowed: false };
}

/** Decisao do middleware (Edge): autenticacao e allowlist. Status da conta e checado no router. */
export function evaluateServiceBearerAtEdge(input: {
  method: string;
  pathname: string;
  token: string;
  env?: Record<string, string | undefined>;
}): { allowed: boolean; status: 200 | 401 | 403; code: string } {
  const hashes = getConfiguredSalesAgentTokenHashes(input.env);
  if (hashes.length === 0) return { allowed: false, status: 401, code: 'SVC_AUTH_DISABLED' };
  if (!input.token || !isAcceptedServiceTokenHash(hashServiceToken(input.token), hashes)) {
    return { allowed: false, status: 401, code: 'SVC_TOKEN_INVALID' };
  }
  if (!classifySalesAgentRoute(input.method, input.pathname).allowed) {
    return { allowed: false, status: 403, code: 'SVC_ROUTE_FORBIDDEN' };
  }
  return { allowed: true, status: 200, code: 'SVC_AUTHENTICATED' };
}
