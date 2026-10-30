// ============================================================================
// STI-hub — setup global dos testes (carregado via NODE_OPTIONS=--import em CADA processo
// do node --test). Garante que a suite NUNCA chama a Resend de verdade:
//  1. NODE_ENV=test e remocao de RESEND_API_KEY / RESEND_ADMIN_API_KEY do ambiente;
//  2. fetch global com guarda: chamada a api.resend.com que nao foi mockada pelo proprio
//     teste e BLOQUEADA (sem rede) e registrada em arquivo; o pos-check da suite falha se
//     houver qualquer registro (tests/setup/assert-no-resend.ts).
// ============================================================================
import fs from 'node:fs';

export const RESEND_ATTEMPTS_FILE = process.env.STI_HUB_TEST_RESEND_LOG || '/tmp/stihub-test-resend-attempts.log';

(process.env as Record<string, string>).NODE_ENV = 'test';
delete process.env.RESEND_API_KEY;
delete process.env.RESEND_ADMIN_API_KEY;

const realFetch = globalThis.fetch;
const guardedFetch = (async (input: unknown, init?: unknown) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String((input as { url?: string })?.url || '');
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = '';
  }
  if (host === 'api.resend.com' || host.endsWith('.resend.com')) {
    const hdrs = (init as { headers?: Record<string, string> } | undefined)?.headers || {};
    const selfTest = hdrs['x-stihub-guard-selftest'] === '1';
    if (!selfTest) try {
      fs.appendFileSync(RESEND_ATTEMPTS_FILE, `${new Date().toISOString()} ${process.argv[1] || ''} ${host}\n`);
    } catch {
      // registro opcional
    }
    return new Response(JSON.stringify({ message: 'Bloqueado no ambiente de testes (sem rede real).', name: 'test_network_blocked' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }
  return realFetch(input as Parameters<typeof fetch>[0], init as Parameters<typeof fetch>[1]);
}) as typeof fetch;
(guardedFetch as unknown as { __stihubResendGuard: boolean }).__stihubResendGuard = true;
globalThis.fetch = guardedFetch;
