// ============================================================================
// Validacao criptografica do token OIDC do Cloud Scheduler (Node only).
// iss Google, aud configurada, email = service account, email_verified, exp,
// assinatura RS256 contra JWKS publico do Google. Sem dependencias novas.
// Injetar fetchJwks / now nos testes — nunca bate na rede no unitario.
// ============================================================================

import { createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import { isCronOidcConfigured } from './cron-oidc-config';
import { resolveConfiguredPublicOrigin } from '../../lib/platform';

export const GOOGLE_JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';
export const GOOGLE_OIDC_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export interface CronOidcConfig {
  audience: string;
  serviceAccount: string;
}

export interface GoogleJwk {
  kty?: string;
  kid?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
  [k: string]: unknown;
}

export interface CronOidcDeps {
  now?: () => number;
  fetchJwks?: (uri: string) => Promise<{ keys: GoogleJwk[] }>;
}

const CLOCK_SKEW_MS = 60_000;

export function resolveCronOidcConfig(env: NodeJS.ProcessEnv = process.env): CronOidcConfig | null {
  if (!isCronOidcConfigured(env)) return null;
  const serviceAccount = String(env.CRON_OIDC_SERVICE_ACCOUNT || '').trim();
  const audience =
    String(env.CRON_OIDC_AUDIENCE || '').trim() || resolveConfiguredPublicOrigin(env) || '';
  if (!serviceAccount || !audience) return null;
  return { audience, serviceAccount };
}

function b64urlToBuffer(seg: string): Buffer {
  const padded = seg.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (seg.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

function safeJson(buf: Buffer): unknown {
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
}

function safeEqualString(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}

function audienceMatches(aud: unknown, expected: string): boolean {
  if (typeof aud === 'string') return safeEqualString(aud, expected);
  if (Array.isArray(aud)) return aud.some((item) => typeof item === 'string' && safeEqualString(item, expected));
  return false;
}

async function loadJwk(kid: string, deps: CronOidcDeps): Promise<GoogleJwk | null> {
  const fetchJwks = deps.fetchJwks;
  if (!fetchJwks) return null;
  const body = await fetchJwks(GOOGLE_JWKS_URI);
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  return keys.find((k) => k && k.kid === kid && k.kty === 'RSA') || null;
}

export async function verifyGoogleOidcToken(
  token: string,
  cfg: CronOidcConfig,
  deps: CronOidcDeps = {}
): Promise<boolean> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [hSeg, pSeg, sSeg] = parts;
    const header = safeJson(b64urlToBuffer(hSeg)) as { alg?: string; typ?: string; kid?: string } | null;
    const payload = safeJson(b64urlToBuffer(pSeg)) as Record<string, unknown> | null;
    if (!header || !payload) return false;
    if (header.alg !== 'RS256') return false;
    if (!header.kid || typeof header.kid !== 'string') return false;
    if (typeof payload.iss !== 'string' || !GOOGLE_OIDC_ISSUERS.has(payload.iss)) return false;
    if (!audienceMatches(payload.aud, cfg.audience)) return false;
    if (typeof payload.email !== 'string' || !safeEqualString(payload.email, cfg.serviceAccount)) return false;
    if (payload.email_verified !== true && payload.email_verified !== 'true') return false;

    const now = (deps.now || Date.now)();
    const expMs = Number(payload.exp) * 1000;
    const nbfMs = payload.nbf != null ? Number(payload.nbf) * 1000 : undefined;
    const iatMs = payload.iat != null ? Number(payload.iat) * 1000 : undefined;
    if (!Number.isFinite(expMs) || now - CLOCK_SKEW_MS >= expMs) return false;
    if (nbfMs != null && Number.isFinite(nbfMs) && now + CLOCK_SKEW_MS < nbfMs) return false;
    if (iatMs != null && Number.isFinite(iatMs) && iatMs - CLOCK_SKEW_MS > now) return false;

    const jwk = await loadJwk(header.kid, deps);
    if (!jwk || !jwk.n || !jwk.e) return false;
    const key = createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' });
    const sig = b64urlToBuffer(sSeg);
    return verify('RSA-SHA256', Buffer.from(`${hSeg}.${pSeg}`), key, sig);
  } catch {
    return false;
  }
}

/**
 * Aceita Authorization: Bearer <JWT OIDC do Cloud Scheduler> quando
 * CRON_OIDC_SERVICE_ACCOUNT e a audience estiverem configurados.
 * Fail-closed: qualquer erro, config incompleta ou JWKS ausente => false.
 */
export async function isValidCronOidcBearer(
  authorizationHeader: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  deps: CronOidcDeps = {}
): Promise<boolean> {
  const cfg = resolveCronOidcConfig(env);
  if (!cfg) return false;
  const m = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(
    String(authorizationHeader || '')
  );
  if (!m) return false;
  // Sem injecao de JWKS no runtime, busca o endpoint publico do Google.
  const fetchJwks = deps.fetchJwks ?? defaultFetchJwks;
  return verifyGoogleOidcToken(m[1], cfg, { ...deps, fetchJwks });
}

async function defaultFetchJwks(uri: string): Promise<{ keys: GoogleJwk[] }> {
  const res = await fetch(uri, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('jwks_unavailable');
  const body = (await res.json()) as { keys?: GoogleJwk[] };
  if (!Array.isArray(body.keys)) throw new Error('jwks_invalid');
  return { keys: body.keys };
}
