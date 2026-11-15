// ============================================================================
// STI-hub — Autenticacao do Vercel Cron (CISO 15/11/2026).
// A Vercel envia Authorization: Bearer <CRON_SECRET>. Comparacao em tempo constante sobre o
// SHA-256 dos dois lados (timingSafeEqual, tamanho fixo). Fail-closed: sem CRON_SECRET (ou com
// menos de 16 caracteres) nenhum pedido e autorizado como cron. Nunca registra o segredo.
// Runtime Node (bridge); o middleware Edge mantem a sua propria checagem constante.
// ============================================================================
import { createHash, timingSafeEqual } from 'node:crypto';

export const CRON_SECRET_MIN_LENGTH = 16;

/** CRON_SECRET valido do ambiente, ou null (ausente/curto => nenhum cron autorizado). */
export function resolveCronSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const s = env.CRON_SECRET?.trim();
  return s && s.length >= CRON_SECRET_MIN_LENGTH ? s : null;
}

/** true somente se o header for exatamente "Bearer <CRON_SECRET>" e o segredo estiver configurado. */
export function isValidCronBearer(authorizationHeader: string | null | undefined, secret: string | null): boolean {
  if (!secret) return false;
  const got = createHash('sha256').update(String(authorizationHeader ?? ''), 'utf8').digest();
  const want = createHash('sha256').update(`Bearer ${secret}`, 'utf8').digest();
  return timingSafeEqual(got, want);
}
