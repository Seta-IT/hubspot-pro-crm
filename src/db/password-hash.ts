// ============================================================================
// STI-hub — Hash de senha (Pacote E, 29/10/2026). SOMENTE SERVIDOR (node:crypto).
// Formato novo: scrypt$1$<N>$<r>$<p>$<sal base64url 16B>$<hash base64url 32B> (sal por usuario).
// Legado: SHA-256 com sal fixo (hashCorporatePassword) continua ACEITO no login; quando confere,
// needsRehash=true e o login regrava em scrypt (sem mexer em passwordChangedAt => nenhuma
// sessao e invalidada e nenhum token de redefinicao muda). O hash so viaja dentro do iamSeal
// (AES-256-GCM do servidor); nunca em claro para o navegador.
// ============================================================================
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { verifyCorporatePassword } from '../app/lib/auth';

const PREFIX = 'scrypt$1$';
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;

function b64u(b: Buffer): string {
  return b.toString('base64url');
}

export function isScryptPasswordHash(stored: unknown): boolean {
  return typeof stored === 'string' && stored.startsWith(PREFIX);
}

export function hashPasswordScrypt(password: string): string {
  const clean = String(password ?? '').trim();
  const salt = randomBytes(16);
  const dk = scryptSync(clean, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `${PREFIX}${N}$${R}$${P}$${b64u(salt)}$${b64u(dk)}`;
}

/**
 * Verifica a senha contra o hash armazenado (scrypt ou legado SHA-256).
 * Senhas existentes curtas (>= 6, regra antiga) continuam aceitas: nada e invalidado.
 */
export function verifyStoredPassword(
  password: string | undefined,
  stored: string | undefined | null
): { ok: boolean; needsRehash: boolean } {
  const clean = String(password ?? '').trim();
  if (clean.length < 6 || !stored) return { ok: false, needsRehash: false };
  if (isScryptPasswordHash(stored)) {
    try {
      const parts = String(stored).slice(PREFIX.length).split('$');
      if (parts.length !== 5) return { ok: false, needsRehash: false };
      const [n, r, p, saltB, hashB] = parts;
      const nN = Number(n);
      const nR = Number(r);
      const nP = Number(p);
      if (![nN, nR, nP].every((x) => Number.isInteger(x) && x > 0) || nN > 1 << 20) return { ok: false, needsRehash: false };
      const salt = Buffer.from(saltB, 'base64url');
      const want = Buffer.from(hashB, 'base64url');
      if (salt.length < 16 || want.length !== KEYLEN) return { ok: false, needsRehash: false };
      const got = scryptSync(clean, salt, want.length, { N: nN, r: nR, p: nP, maxmem: MAXMEM });
      const ok = timingSafeEqual(got, want);
      return { ok, needsRehash: ok && (nN !== N || nR !== R || nP !== P) };
    } catch {
      return { ok: false, needsRehash: false };
    }
  }
  // Legado (SHA-256, sal fixo): aceito e marcado para regravacao.
  const ok = verifyCorporatePassword(clean, String(stored));
  return { ok, needsRehash: ok };
}
