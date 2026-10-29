// ============================================================================
// STI-hub — Contencao de seguranca IAM (29/10/2026)
//  - Segredo TOTP derivado no servidor (HMAC com STI_HUB_SESSION_SECRET), sem
//    estado: igual em todas as instancias serverless e rotacionado por epoca.
//  - "Selo" IAM (AES-256-GCM) para persistir configuracoes de usuario no cliente
//    sem expor passwordHash e sem permitir forjar usuarios/papeis.
//  - Sanitizacao de TODAS as respostas da API (sem totpSecret/passwordHash etc.).
// Somente servidor (Node.js runtime).
// ============================================================================
import crypto from 'crypto';
import { resolveStiHubSigningSecret, STIHUB_TOTP_ROTATION_EPOCH } from '../app/lib/auth';
import type { StiHubUserRecord } from './types';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

const totpCache = new Map<string, string>();

/** Segredo TOTP (Base32, 160 bits) derivado da chave do servidor + epoca + e-mail. */
export function deriveServerTotpSecret(email: string): string {
  const secret = resolveStiHubSigningSecret();
  const norm = String(email || '').trim().toLowerCase();
  const cacheKey = `${crypto.createHash('sha256').update(secret).digest('hex').slice(0, 16)}:${norm}`;
  const cached = totpCache.get(cacheKey);
  if (cached) return cached;
  const digest = crypto
    .createHmac('sha256', secret)
    .update(`STIHUB-TOTP-V2:${STIHUB_TOTP_ROTATION_EPOCH}:${norm}`)
    .digest();
  const out = encodeBase32(new Uint8Array(digest.subarray(0, 20)));
  totpCache.set(cacheKey, out);
  return out;
}

// ---------------------------------------------------------------------------
// Selo IAM
// ---------------------------------------------------------------------------
const SEAL_PREFIX = 'SEAL1.';
const SEAL_MAX_AGE_MS = 180 * 24 * 3600 * 1000;

function sealKey(): Buffer {
  return crypto
    .createHash('sha256')
    .update(`STIHUB-IAM-SEAL-V1:${resolveStiHubSigningSecret()}`)
    .digest();
}

export interface SealedIamRecord {
  user: Partial<StiHubUserRecord> & { id: string; email: string };
  sealedAt: number;
}

const NEVER_SEALED_KEYS = ['totpSecret', 'totpSecretFormatted', 'lastUsedTotpTimeStep', 'password', 'iamSeal'];

export function sealIamRecord(user: StiHubUserRecord): string | undefined {
  try {
    const clean: Record<string, unknown> = { ...(user as unknown as Record<string, unknown>) };
    for (const k of NEVER_SEALED_KEYS) delete clean[k];
    const payload: SealedIamRecord = {
      user: clean as SealedIamRecord['user'],
      sealedAt: Date.now(),
    };
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', sealKey(), iv);
    const ct = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return SEAL_PREFIX + Buffer.concat([iv, tag, ct]).toString('base64url');
  } catch {
    return undefined;
  }
}

export function unsealIamRecord(seal: unknown): SealedIamRecord | null {
  if (typeof seal !== 'string' || !seal.startsWith(SEAL_PREFIX) || seal.length > 20000) return null;
  try {
    const raw = Buffer.from(seal.slice(SEAL_PREFIX.length), 'base64url');
    if (raw.length < 29) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', sealKey(), iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(pt) as SealedIamRecord;
    if (!parsed || !parsed.user || !parsed.user.id || !parsed.user.email) return null;
    if (typeof parsed.sealedAt !== 'number' || Date.now() - parsed.sealedAt > SEAL_MAX_AGE_MS) return null;
    for (const k of NEVER_SEALED_KEYS) delete (parsed.user as Record<string, unknown>)[k];
    return parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sanitizacao das respostas HTTP
// ---------------------------------------------------------------------------
/** Nunca saem em nenhuma resposta. */
export const ALWAYS_STRIPPED_RESPONSE_KEYS = [
  'passwordHash',
  'password',
  'lastUsedTotpTimeStep',
  'smtpPass',
  'resendApiKey',
  'demoTotpCode',
  'currentTotpCode',
  'devOtpPreview',
  'emailOtpHash',
  'otpCode',
];

/** Material de pareamento TOTP: so pode sair nas rotas de pareamento /api/auth/*. */
const TOTP_MATERIAL_KEYS = ['totpSecret', 'totpSecretFormatted', 'otpauthUri', 'qrCodeSvgDataUrl'];

function looksLikeUserRecord(o: Record<string, unknown>): boolean {
  return (
    typeof o.email === 'string' &&
    typeof o.id === 'string' &&
    ('roleId' in o || 'mfaEnabled' in o || 'totpConfigured' in o)
  );
}

export function sanitizeApiResponseBody<T>(
  body: T,
  opts: {
    path: string;
    lookupUser?: (id: string, email: string) => StiHubUserRecord | undefined;
  }
): T {
  const allowPairingMaterial = opts.path.startsWith('/api/auth/');
  const seen = new WeakSet<object>();
  const walk = (node: unknown, depth: number): unknown => {
    if (depth > 40 || node === null || typeof node !== 'object') return node;
    if (seen.has(node as object)) return node;
    seen.add(node as object);
    if (Array.isArray(node)) return node.map((x) => walk(x, depth + 1));
    const src = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const isUser = looksLikeUserRecord(src);
    for (const [k, v] of Object.entries(src)) {
      if (ALWAYS_STRIPPED_RESPONSE_KEYS.includes(k)) continue;
      if (TOTP_MATERIAL_KEYS.includes(k) && (isUser || !allowPairingMaterial)) continue;
      out[k] = walk(v, depth + 1);
    }
    if (isUser && opts.lookupUser) {
      const rec = opts.lookupUser(String(src.id), String(src.email));
      if (rec) {
        const seal = sealIamRecord(rec);
        if (seal) out.iamSeal = seal;
      }
    }
    return out;
  };
  return walk(body, 0) as T;
}
