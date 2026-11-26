// ============================================================================
// Trava de origem do Cloud Run (Edge-safe, sem node:crypto).
// O Worker sti-hub-proxy envia X-STI-Origin-Auth = STI_HUB_ORIGIN_SHARED_SECRET.
// Em Cloud Run (K_SERVICE ou CLOUD_RUN_JOB) toda requisicao sem o cabecalho
// valido e recusada (403). Sem o secret configurado, falha fechado.
// Excecao: rotas de cron do Cloud Scheduler com Bearer em forma de JWT quando
// o OIDC esta configurado (a assinatura e conferida no bridge).
// Este modulo NUNCA registra o secret nem o valor do cabecalho.
// ============================================================================

import { constantTimeEqual } from './auth';
import { isCronOidcConfigured, looksLikeBearerJwt } from './cron-oidc-config';
import { isCloudRunRuntime } from '../../lib/platform';

export const ORIGIN_AUTH_HEADER = 'x-sti-origin-auth';
export const ORIGIN_AUTH_ENV = 'STI_HUB_ORIGIN_SHARED_SECRET';
export const ORIGIN_AUTH_MIN_LENGTH = 16;

export type OriginLockDecision = {
  allowed: boolean;
  status: 200 | 403;
  code: 'ORIGIN_AUTH_OK' | 'ORIGIN_AUTH_BYPASS' | 'ORIGIN_LOCK_OFF' | 'ORIGIN_AUTH_FORBIDDEN' | 'ORIGIN_AUTH_NOT_CONFIGURED';
};

/** A trava vale em todo runtime Cloud Run (servico ou Job). */
export function isOriginLockEngaged(env: NodeJS.ProcessEnv = process.env): boolean {
  return isCloudRunRuntime(env);
}

export function resolveOriginSharedSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = String(env.STI_HUB_ORIGIN_SHARED_SECRET || '').trim();
  if (raw.length < ORIGIN_AUTH_MIN_LENGTH) return null;
  return raw;
}

/**
 * Os 6 GETs do Cloud Scheduler (tres deles nao vivem sob /api/cron/*, mas sao
 * o mesmo conjunto autenticado por OIDC). Qualquer outro caminho exige o cabecalho.
 */
export function isOriginLockCronPath(pathname: string, method = 'GET'): boolean {
  if (String(method || 'GET').toUpperCase() !== 'GET') return false;
  const p = (pathname || '/').replace(/\/+$/, '') || '/';
  return (
    p === '/api/erp/daily-sync' ||
    p === '/api/crm/proposal-followup' ||
    p === '/api/tickets/email-intake/poll' ||
    p === '/api/cron/sequences' ||
    p === '/api/cron/marketing' ||
    p === '/api/cron/workflows'
  );
}

function readOriginAuthHeader(headers: { get(name: string): string | null } | Headers | Record<string, string | undefined>): string {
  if (headers && typeof (headers as { get?: unknown }).get === 'function') {
    return String((headers as { get(name: string): string | null }).get(ORIGIN_AUTH_HEADER) || '').trim();
  }
  const rec = headers as Record<string, string | undefined>;
  return String(rec[ORIGIN_AUTH_HEADER] || rec['X-STI-Origin-Auth'] || '').trim();
}

/**
 * Decide se a requisicao passa a trava de origem.
 * Compara o cabecalho em tempo constante. Nao registra secret nem cabecalho.
 */
export function evaluateOriginLock(input: {
  pathname: string;
  method?: string;
  authorization?: string | null;
  headers?: { get(name: string): string | null } | Headers | Record<string, string | undefined>;
  originAuthHeader?: string | null;
  env?: NodeJS.ProcessEnv;
}): OriginLockDecision {
  const env = input.env || process.env;
  if (!isOriginLockEngaged(env)) {
    return { allowed: true, status: 200, code: 'ORIGIN_LOCK_OFF' };
  }
  const method = input.method || 'GET';
  const authorization = input.authorization ?? null;
  if (
    isOriginLockCronPath(input.pathname, method) &&
    isCronOidcConfigured(env) &&
    looksLikeBearerJwt(authorization)
  ) {
    return { allowed: true, status: 200, code: 'ORIGIN_AUTH_BYPASS' };
  }
  const secret = resolveOriginSharedSecret(env);
  if (!secret) {
    return { allowed: false, status: 403, code: 'ORIGIN_AUTH_NOT_CONFIGURED' };
  }
  const provided =
    input.originAuthHeader != null
      ? String(input.originAuthHeader).trim()
      : input.headers
        ? readOriginAuthHeader(input.headers)
        : '';
  if (!constantTimeEqual(provided, secret)) {
    return { allowed: false, status: 403, code: 'ORIGIN_AUTH_FORBIDDEN' };
  }
  return { allowed: true, status: 200, code: 'ORIGIN_AUTH_OK' };
}
