// ============================================================================
// STI-hub — teto de corpo por requisicao (rebase v5 sobre o pacote M, 01/11/2026).
// Mesma regra do bridge do Next (src/app/api/_bridge.ts -> bridgeBodyCapFor), para o dispatch do
// roteador e o servidor standalone: 4 MiB (BRIDGE_LARGE_BODY_BYTES) so nas rotas de
// BRIDGE_LARGE_BODY_ROUTES com sessao assinada valida; 1 MiB (BRIDGE_MAX_BODY_BYTES) no resto.
// As constantes e a lista de rotas sao as do pacote M (src/app/lib/bridge-body-limit.ts): fonte
// unica. Um corpo aceito pelo bridge nunca recebe 413 no dispatch (a estimativa do dispatch e
// cota inferior exata do JSON real).
// ============================================================================
import { verifyStiHubSessionToken } from './auth';
import { BRIDGE_LARGE_BODY_BYTES, BRIDGE_MAX_BODY_BYTES, isLargeBodyRoute } from './bridge-body-limit';

export function requestBodyCapFor(method: string, path: string, sessionToken: string | null | undefined): number {
  if (!isLargeBodyRoute(method, String(path || '').split('?')[0]) || !sessionToken) return BRIDGE_MAX_BODY_BYTES;
  try {
    return verifyStiHubSessionToken(String(sessionToken)).valid ? BRIDGE_LARGE_BODY_BYTES : BRIDGE_MAX_BODY_BYTES;
  } catch {
    return BRIDGE_MAX_BODY_BYTES;
  }
}
