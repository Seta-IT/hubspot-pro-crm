// ============================================================================
// STI-hub — revogacao best-effort de sessao no logout (Pacote C), em modulo proprio desde o
// Pacote N (D-M2) para ser lido tambem pelo teto de corpo (bridge e dispatch) sem import circular.
// Denylist do SHA-256 do token ate o exp, em MEMORIA DA INSTANCIA (processo/lambda). LIMITACAO:
// sem armazenamento duravel, outra instancia da Vercel ou um cold start NAO conhecem a revogacao;
// o middleware (Edge) tambem nao. Mitigacao: o cookie e apagado no navegador no logout.
// ============================================================================
import { createHash } from 'crypto';

const REVOKED_SESSION_MAX_ENTRIES = 10_000;
const revokedSessionTokenHashes = new Map<string, number>();
function sessionTokenHash(token: string): string {
  return createHash('sha256').update(String(token)).digest('hex');
}
export function revokeSessionTokenBestEffort(token: string | null | undefined, expMs: number): void {
  if (!token) return;
  const now = Date.now();
  for (const [h, exp] of revokedSessionTokenHashes) if (exp <= now) revokedSessionTokenHashes.delete(h);
  if (revokedSessionTokenHashes.size >= REVOKED_SESSION_MAX_ENTRIES) {
    const oldest = revokedSessionTokenHashes.keys().next().value;
    if (oldest) revokedSessionTokenHashes.delete(oldest);
  }
  revokedSessionTokenHashes.set(sessionTokenHash(token), Number.isFinite(expMs) && expMs > now ? expMs : now + 24 * 3600 * 1000);
}
export function isSessionTokenRevoked(token: string | null | undefined): boolean {
  if (!token) return false;
  const h = sessionTokenHash(token);
  const exp = revokedSessionTokenHashes.get(h);
  if (exp === undefined) return false;
  if (exp <= Date.now()) {
    revokedSessionTokenHashes.delete(h);
    return false;
  }
  return true;
}
