// ============================================================================
// STI-hub — Pacote C (1): a suite de testes NUNCA chama api.resend.com de verdade.
// Prova: setup global ativo (NODE_ENV=test, chaves removidas, fetch com guarda), chave
// "real" ignorada em runtime de teste, fluxos de e-mail sem nenhuma chamada a Resend, e o
// pos-check do npm test (assert-no-resend) falha se qualquer teste tentar sem mock.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter, isTestRuntime, resolveResendApiKey } from '../src/api/router';

const HTTP = { _fromHttpBridge: '1' };

async function withFetchSpy<T>(fn: (calls: string[]) => Promise<T>): Promise<T> {
  const prev = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    const url = typeof input === 'string' ? input : String((input as { href?: string; url?: string })?.href || (input as { url?: string })?.url || '');
    calls.push(url);
    return prev(input as Parameters<typeof fetch>[0], init as Parameters<typeof fetch>[1]);
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = prev;
  }
}

describe('Pacote C (1): testes sem chamadas reais a Resend', () => {
  it('setup global ativo: NODE_ENV=test, RESEND_API_KEY/RESEND_ADMIN_API_KEY ausentes e fetch com guarda', () => {
    assert.equal(process.env.NODE_ENV, 'test');
    assert.equal(isTestRuntime(), true);
    assert.equal(process.env.RESEND_API_KEY, undefined);
    assert.equal(process.env.RESEND_ADMIN_API_KEY, undefined);
    assert.equal((globalThis.fetch as unknown as { __stihubResendGuard?: boolean }).__stihubResendGuard, true);
  });

  it('em runtime de teste, chave com cara de real (env ou painel) e ignorada; so dummy re_test_ vale', () => {
    const prev = process.env.RESEND_API_KEY;
    try {
      process.env.RESEND_API_KEY = 're_AbCdEfGh12345678_parece_real';
      assert.equal(resolveResendApiKey(), '');
      assert.equal(resolveResendApiKey('re_ChaveDoPainel12345678'), '');
      process.env.RESEND_API_KEY = 're_test_dummy_key_nao_real';
      assert.equal(resolveResendApiKey(), 're_test_dummy_key_nao_real');
    } finally {
      if (prev === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = prev;
    }
  });

  it('guarda do fetch bloqueia api.resend.com sem rede (503 test_network_blocked)', async () => {
    const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'x-stihub-guard-selftest': '1' }, body: '{}' });
    assert.equal(res.status, 503);
    assert.equal(((await res.json()) as { name: string }).name, 'test_network_blocked');
  });

  it('fluxos que enviam e-mail (esqueci a senha, login) nao chamam api.resend.com mesmo com chave real no env', async () => {
    const prev = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = 're_AbCdEfGh12345678_parece_real';
    try {
      await withFetchSpy(async (calls) => {
        const repo = createInMemoryRepository();
        const router = new CrmApiRouter(repo);
        await router.dispatch({ method: 'POST', path: '/api/auth/forgot-password', query: { ...HTTP, _clientIp: '10.0.0.1' }, body: { email: 'marcelo.mira@setatelecom.com.br' } });
        await router.dispatch({ method: 'POST', path: '/api/auth/login', query: { ...HTTP }, body: { email: 'marcelo.mira@setatelecom.com.br', password: 'qualquer-senha-errada' } });
        assert.equal(calls.filter((u) => u.includes('resend.com')).length, 0, 'nenhuma chamada a Resend');
      });
    } finally {
      if (prev === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = prev;
    }
  });
});
