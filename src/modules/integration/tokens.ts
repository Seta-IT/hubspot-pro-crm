// ============================================================================
// STI-hub — API v1 + MCP: formato e hash de credenciais de integracao.
//  - Chave de integracao: stihub_int_<prefix 12 hex>_<segredo base64url 32 bytes>
//  - Token OAuth de acesso: stihub_oat_<base64url 32 bytes>; refresh: stihub_ort_<...>
//  - Codigo de autorizacao OAuth: stihub_oac_<base64url 32 bytes>
// No banco vai SOMENTE o SHA-256 (hex) — e o prefixo publico da chave, para listagem.
// Nenhuma funcao daqui loga valores.
// ============================================================================
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const INTEGRATION_KEY_PREFIX = 'stihub_int_';
export const OAUTH_ACCESS_PREFIX = 'stihub_oat_';
export const OAUTH_REFRESH_PREFIX = 'stihub_ort_';
export const OAUTH_CODE_PREFIX = 'stihub_oac_';
export const OAUTH_CLIENT_ID_PREFIX = 'stihub_ocl_';
export const OAUTH_CLIENT_SECRET_PREFIX = 'stihub_ocs_';

export const INTEGRATION_KEY_REGEX = /^stihub_int_([0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;
const OPAQUE_REGEX = (prefix: string) => new RegExp(`^${prefix}[A-Za-z0-9_-]{43}$`);
export const OAUTH_ACCESS_REGEX = OPAQUE_REGEX(OAUTH_ACCESS_PREFIX);
export const OAUTH_REFRESH_REGEX = OPAQUE_REGEX(OAUTH_REFRESH_PREFIX);
export const OAUTH_CODE_REGEX = OPAQUE_REGEX(OAUTH_CODE_PREFIX);

export function sha256Hex(value: string): string {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export function constantTimeHexEqual(a: string, b: string): boolean {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

function opaque(prefix: string): string {
  return `${prefix}${randomBytes(32).toString('base64url')}`;
}

export function generateIntegrationKey(): { token: string; prefix: string; hash: string } {
  const prefix = randomBytes(6).toString('hex');
  const token = `${INTEGRATION_KEY_PREFIX}${prefix}_${randomBytes(32).toString('base64url')}`;
  return { token, prefix, hash: sha256Hex(token) };
}

export const generateOAuthAccessToken = () => opaque(OAUTH_ACCESS_PREFIX);
export const generateOAuthRefreshToken = () => opaque(OAUTH_REFRESH_PREFIX);
export const generateOAuthCode = () => opaque(OAUTH_CODE_PREFIX);
export const generateOAuthClientId = () => `${OAUTH_CLIENT_ID_PREFIX}${randomBytes(16).toString('hex')}`;
export const generateOAuthClientSecret = () => opaque(OAUTH_CLIENT_SECRET_PREFIX);
export const generateId = (prefix: string) => `${prefix}_${randomBytes(12).toString('hex')}`;

export type BearerKind = 'api_key' | 'oauth' | 'invalid' | 'none';

/**
 * Classifica o header Authorization:
 *  - none: sem header ou outro esquema;
 *  - invalid: Bearer em formato nao reconhecido (401);
 *  - api_key / oauth: formato valido (ainda precisa conferir o hash no Postgres).
 */
export function classifyBearer(authorization: string | null | undefined): { kind: BearerKind; token: string } {
  const raw = String(authorization || '').trim();
  const m = raw.match(/^Bearer\s+(\S+)$/i);
  if (!m) return { kind: raw ? 'invalid' : 'none', token: '' };
  const tok = m[1];
  if (INTEGRATION_KEY_REGEX.test(tok)) return { kind: 'api_key', token: tok };
  if (OAUTH_ACCESS_REGEX.test(tok)) return { kind: 'oauth', token: tok };
  return { kind: 'invalid', token: '' };
}

/** PKCE S256: BASE64URL(SHA256(code_verifier)) == code_challenge. */
export function pkceS256(verifier: string): string {
  return createHash('sha256').update(String(verifier), 'ascii').digest('base64url');
}

export const PKCE_VERIFIER_REGEX = /^[A-Za-z0-9._~-]{43,128}$/;
export const PKCE_CHALLENGE_REGEX = /^[A-Za-z0-9_-]{43}$/;
