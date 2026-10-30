// ============================================================================
// STI-hub — setup global dos testes (carregado via NODE_OPTIONS=--import em CADA processo
// do node --test). Garante que a suite NUNCA chama a Resend de verdade:
//  1. NODE_ENV=test e remocao de RESEND_API_KEY / RESEND_ADMIN_API_KEY do ambiente;
//  2. fetch global com guarda: chamada a api.resend.com que nao foi mockada pelo proprio
//     teste e BLOQUEADA (sem rede) e registrada em arquivo; o pos-check da suite falha se
//     houver qualquer registro (tests/setup/assert-no-resend.ts).
//  3. brasilapi.com.br / receitaws.com.br / publica.cnpj.ws: mock local 404 (sem rede).
//  4. Pacote F: DENY-BY-DEFAULT para fetch — so 127.0.0.1/localhost/::1 passam; o resto recebe
//     503 bloqueado e e registrado em /tmp/stihub-test-net-blocked.log.
// ============================================================================
import fs from 'node:fs';

export const CNPJ_HOSTS = ['brasilapi.com.br', 'receitaws.com.br', 'publica.cnpj.ws'];
export const CNPJ_ATTEMPTS_FILE = process.env.STI_HUB_TEST_CNPJ_LOG || '/tmp/stihub-test-cnpj-mocked.log';
export const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1', '[::1]'];
export const NET_BLOCKED_FILE = process.env.STI_HUB_TEST_NET_LOG || '/tmp/stihub-test-net-blocked.log';
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
  // HOTFIX 29/10 (menor b): APIs publicas de CNPJ (cnpj-lookup-service.ts) NUNCA vao a rede
  // nos testes. Mock deterministico 404 => o servico cai no cadastro local/fallback.
  if (CNPJ_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    try {
      fs.appendFileSync(CNPJ_ATTEMPTS_FILE, `${new Date().toISOString()} ${process.argv[1] || ''} ${host}\n`);
    } catch {
      // registro opcional
    }
    return new Response(JSON.stringify({ message: 'CNPJ mockado no ambiente de testes (sem rede real).', name: 'test_network_mocked' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }
  // Pacote F: DENY-BY-DEFAULT. So loopback (127.0.0.1 / localhost / ::1) vai a rede real;
  // qualquer outro host e bloqueado (503) e registrado em NET_BLOCKED_FILE.
  if (LOOPBACK_HOSTS.includes(host)) {
    return realFetch(input as Parameters<typeof fetch>[0], init as Parameters<typeof fetch>[1]);
  }
  try {
    fs.appendFileSync(NET_BLOCKED_FILE, `${new Date().toISOString()} ${process.argv[1] || ''} ${host || '(url invalida)'}\n`);
  } catch {
    // registro opcional
  }
  return new Response(JSON.stringify({ message: 'Rede externa bloqueada no ambiente de testes (deny-by-default).', name: 'test_network_blocked' }), {
    status: 503,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;
(guardedFetch as unknown as { __stihubResendGuard: boolean }).__stihubResendGuard = true;
globalThis.fetch = guardedFetch;
