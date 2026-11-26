// ============================================================================
// STI-hub — flags neutras de plataforma (Vercel e Cloud Run).
// Sem variaveis definidas, em producao o comportamento continua seguro:
// cookie Secure ligado e regras de OAuth / origem publica de producao.
// VERCEL=1 permanece compativel enquanto a migracao nao termina.
// Este modulo e propositalmente livre de APIs so de Node (pode ir ao Edge).
// ============================================================================

export type TrustedProxyMode = 'vercel' | 'cloudrun' | 'none';

const TRUTHY = new Set(['1', 'true', 'on', 'yes']);
const FALSY = new Set(['0', 'false', 'off', 'no']);

function envFlag(raw: string | undefined): boolean | undefined {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return undefined;
  if (TRUTHY.has(v)) return true;
  if (FALSY.has(v)) return false;
  return undefined;
}

/**
 * Cloud Run service: K_SERVICE. Cloud Run Job: CLOUD_RUN_JOB
 * (o Job de migracao nao define K_SERVICE).
 */
export function isCloudRunRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(String(env.K_SERVICE || '').trim() || String(env.CLOUD_RUN_JOB || '').trim());
}

/**
 * Runtime de producao para OAuth, origem publica e cookies.
 * Sinais: NODE_ENV=production, VERCEL=1, VERCEL_ENV=production|preview,
 * TRUSTED_PROXY_MODE=cloudrun, K_SERVICE ou CLOUD_RUN_JOB.
 */
export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.VERCEL === '1') return true;
  const vercelEnv = String(env.VERCEL_ENV || '').toLowerCase();
  if (vercelEnv === 'production' || vercelEnv === 'preview') return true;
  if (String(env.TRUSTED_PROXY_MODE || '').trim().toLowerCase() === 'cloudrun') return true;
  if (isCloudRunRuntime(env)) return true;
  return env.NODE_ENV === 'production';
}

/**
 * Runtime em que segredos de sessao/link nao podem cair no fallback de desenvolvimento.
 * Igual a isProductionRuntime, exceto quando STI_HUB_ALLOW_DEV_SECRET=true
 * (somente para homologacao local com NODE_ENV=production).
 */
export function isSecretProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  if (typeof process === 'undefined' || !env) return false;
  const vercelEnv = String(env.VERCEL_ENV || '').toLowerCase();
  if (vercelEnv === 'production' || vercelEnv === 'preview') return true;
  // Cloud Run (servico ou Job) nunca aceita o segredo de desenvolvimento.
  if (isCloudRunRuntime(env) || String(env.TRUSTED_PROXY_MODE || '').trim().toLowerCase() === 'cloudrun') return true;
  return env.NODE_ENV === 'production' && env.STI_HUB_ALLOW_DEV_SECRET !== 'true';
}

/**
 * Cookie Secure.
 * Em producao o atributo Secure fica SEMPRE ligado: SECURE_COOKIES=0/false/off e ignorado.
 * Fora de producao: SECURE_COOKIES=1/true/on liga; 0/false/off desliga; sem a variavel, desligado.
 */
export function useSecureCookies(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isProductionRuntime(env)) return true;
  const explicit = envFlag(env.SECURE_COOKIES);
  if (explicit !== undefined) return explicit;
  return false;
}

/**
 * TRUSTED_PROXY_MODE=vercel|cloudrun|none.
 * Sem a variavel: vercel se VERCEL=1; cloudrun se K_SERVICE ou CLOUD_RUN_JOB; senao none.
 * Com K_SERVICE ou CLOUD_RUN_JOB, o modo vercel e recusado (ele confia em X-Real-IP,
 * forjavel no Cloud Run) e o modo e forçado para cloudrun. none explicito permanece
 * fail-closed.
 */
export function resolveTrustedProxyMode(env: NodeJS.ProcessEnv = process.env): TrustedProxyMode {
  const raw = String(env.TRUSTED_PROXY_MODE || '').trim().toLowerCase();
  if (isCloudRunRuntime(env)) {
    if (raw === 'none') return 'none';
    return 'cloudrun';
  }
  if (raw === 'vercel' || raw === 'cloudrun' || raw === 'none') return raw;
  if (env.VERCEL === '1') return 'vercel';
  return 'none';
}

/**
 * Quantos proxies confiaveis contar a partir da direita no X-Forwarded-For.
 * TRUSTED_PROXY_HOPS (1–10).
 *  - Padrao 1: so o Google Front End (URL run.app do Cloud Run).
 *  - 2: load balancer HTTPS externo ou o Worker sti-hub-proxy na frente do
 *    Cloud Run (o proxy/LB acrescenta o IP do cliente; o GFE acrescenta o IP
 *    do proxy). A entrada correta e a segunda a partir da direita.
 * Com a trava de origem ativa (K_SERVICE ou CLOUD_RUN_JOB), hops fica
 * forcado em 2 — o TRUSTED_PROXY_HOPS do ambiente e ignorado.
 */
export function resolveTrustedProxyHops(env: NodeJS.ProcessEnv = process.env): number {
  if (isCloudRunRuntime(env)) return 2;
  const n = Number(env.TRUSTED_PROXY_HOPS);
  if (Number.isFinite(n) && n >= 1 && n <= 10) return Math.floor(n);
  return 1;
}

/** Filesystem efemero (Vercel / Cloud Run service ou Job): o JSON store, se usado, vai para /tmp. */
export function usesEphemeralFilesystem(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL === '1' || resolveTrustedProxyMode(env) === 'cloudrun' || isCloudRunRuntime(env);
}

/** Interpreta STI_HUB_PUBLIC_ORIGIN (ou outro raw) como origem http(s), sem caminho. */
export function parseHttpOrigin(raw: unknown): string | null {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Origem publica configurada em STI_HUB_PUBLIC_ORIGIN.
 * Em producao precisa ser https; valor ausente ou invalido => null (fail-closed).
 */
export function resolveConfiguredPublicOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  const origin = parseHttpOrigin(env.STI_HUB_PUBLIC_ORIGIN);
  if (!origin) return null;
  if (isProductionRuntime(env) && !origin.startsWith('https:')) return null;
  return origin;
}

/**
 * Origem para links (proposta, convite). Com NODE_ENV=production: SOMENTE
 * STI_HUB_PUBLIC_ORIGIN. Sem ela, null (fail-closed) — ignora o Host / origem
 * da requisicao. A regra usa so NODE_ENV=production (nao VERCEL=1 / K_SERVICE):
 * o container e a Vercel de producao ja definem essa variavel, e os testes
 * paralelos ligam os outros sinais para cookies/IP.
 * Fora de producao: env, depois a origem da requisicao.
 */
export function resolvePublicOriginForLinks(requestOrigin?: string | null, env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = resolveConfiguredPublicOrigin(env);
  if (configured) return configured;
  if (env.NODE_ENV === 'production') return null;
  return parseHttpOrigin(requestOrigin);
}

const DEV_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
] as const;

/**
 * Allowlist de CORS. So entra STI_HUB_PUBLIC_ORIGIN (validada).
 * Fora de producao, tambem localhost. Sem a variavel em producao: conjunto vazio
 * (falha fechada, sem curinga e sem dominio fixo).
 */
export function allowedCorsOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const set = new Set<string>();
  const configured = resolveConfiguredPublicOrigin(env);
  if (configured) set.add(configured);
  if (!isProductionRuntime(env)) {
    for (const o of DEV_CORS_ORIGINS) set.add(o);
  }
  return set;
}

/**
 * Valor de Access-Control-Allow-Origin para a origem da requisicao, ou undefined
 * se ela nao estiver na allowlist (nao reflete o pedido e nao usa curinga).
 */
export function corsAllowOrigin(requestOrigin: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const origin = String(requestOrigin || '').trim();
  if (!origin) return undefined;
  return allowedCorsOrigins(env).has(origin) ? origin : undefined;
}
