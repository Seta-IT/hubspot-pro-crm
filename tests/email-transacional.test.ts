// STI-hub — e-mails transacionais (Resend): remetente por variavel e nada de link/codigo nas respostas
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryRepository } from '../src/db/repository';
import {
  buildInviteEmailHtml,
  CrmApiRouter,
  resolveTransactionalEmailFrom,
  STI_HUB_DEFAULT_EMAIL_FROM,
} from '../src/api/router';
import { signMfaChallengeToken, signStiHubSessionToken } from '../src/app/lib/auth';

const ADMIN = 'marcelo.mira@setatelecom.com.br';

function adminToken() {
  return signStiHubSessionToken({
    uid: 'usr-seta-01', email: ADMIN, name: 'Marcelo', roleId: 'SUPER_ADMIN', scope: 'TODOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now(), exp: Date.now() + 60_000,
  });
}

async function withResendMock<T>(status: number, fn: (calls: Array<Record<string, unknown>>) => Promise<T>): Promise<T> {
  const prevFetch = globalThis.fetch;
  const prevKey = process.env.RESEND_API_KEY;
  const prevFrom = process.env.RESEND_FROM_EMAIL;
  const calls: Array<Record<string, unknown>> = [];
  process.env.RESEND_API_KEY = 're_test_dummy_key_nao_real';
  process.env.RESEND_FROM_EMAIL = 'STI-hub <no-reply@notificacoes.setatelecom.com.br>';
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    calls.push(JSON.parse(String(init?.body || '{}')));
    return new Response(
      status === 200 ? JSON.stringify({ id: 'email-test' }) : JSON.stringify({ message: 'You can only send testing emails to your own email address (dono@exemplo.com).' }),
      { status }
    );
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = prevKey;
    if (prevFrom === undefined) delete process.env.RESEND_FROM_EMAIL; else process.env.RESEND_FROM_EMAIL = prevFrom;
  }
}

describe('E-mail transacional: remetente e template', () => {
  it('remetente vem de RESEND_FROM_EMAIL; padrao onboarding@resend.dev', () => {
    const prev = process.env.RESEND_FROM_EMAIL;
    const prev2 = process.env.STI_HUB_FROM_EMAIL;
    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.STI_HUB_FROM_EMAIL;
    assert.equal(resolveTransactionalEmailFrom(), STI_HUB_DEFAULT_EMAIL_FROM);
    process.env.RESEND_FROM_EMAIL = 'STI-hub <no-reply@notificacoes.setatelecom.com.br>';
    assert.equal(resolveTransactionalEmailFrom(), 'STI-hub <no-reply@notificacoes.setatelecom.com.br>');
    if (prev === undefined) delete process.env.RESEND_FROM_EMAIL; else process.env.RESEND_FROM_EMAIL = prev;
    if (prev2 !== undefined) process.env.STI_HUB_FROM_EMAIL = prev2;
  });

  it('template HTML do convite tem titulo, botao "Definir senha" e validade de 72h, com link escapado', () => {
    const html = buildInviteEmailHtml({ userName: 'Ana <b>', inviteUrl: 'https://sti-hub.vercel.app/login?invite=a"b', expiresAt: new Date().toISOString() });
    assert.ok(html.includes('Convite de acesso ao STI-hub'));
    assert.ok(html.includes('Definir senha'));
    assert.ok(html.includes('72 horas'));
    assert.ok(!html.includes('Ana <b>'));
    assert.ok(html.includes('invite=a&quot;b'));
  });
});

describe('E-mail transacional: nada de link ou codigo nas respostas', () => {
  it('convite entregue => resposta sem inviteUrl/inviteToken; e-mail usa o remetente configurado e HTML', async () => {
    await withResendMock(200, async (calls) => {
      const router = new CrmApiRouter(createInMemoryRepository());
      const res = await router.dispatch({ method: 'POST', path: '/api/admin/users/usr-seta-02/invite', query: { _fromHttpBridge: '1', _sessionToken: adminToken() }, body: {} });
      assert.equal(res.status, 200);
      const json = JSON.stringify(res.body);
      assert.equal(json.includes('inviteUrl'), false, json.slice(0, 400).replace(/INV-[A-Za-z0-9_.-]+/g, 'INV-***'));
      assert.equal(json.includes('inviteToken'), false);
      assert.equal(/invite=|"INV-/.test(json), false);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].from, 'STI-hub <no-reply@notificacoes.setatelecom.com.br>');
      assert.ok(String(calls[0].html).includes('Definir senha'));
    });
  });

  it('OTP por e-mail: resposta nunca traz o codigo nem o erro bruto do provedor', async () => {
    await withResendMock(403, async () => {
      const router = new CrmApiRouter(createInMemoryRepository());
      const challengeId = signMfaChallengeToken({ cid: 'MFA-T', uid: 'usr-seta-01', email: ADMIN, mfaMethod: 'TOTP_AUTHENTICATOR', totpSecret: '', iat: Date.now(), exp: Date.now() + 60_000 });
      const res = await router.dispatch({ method: 'POST', path: '/api/auth/send-email-otp', query: { _fromHttpBridge: '1' }, body: { email: ADMIN, challengeId } });
      assert.equal(res.status, 503);
      const json = JSON.stringify(res.body);
      assert.equal(json.includes('dono@exemplo.com'), false, 'nao vazar e-mail do dono da conta Resend');
      assert.equal(/\b\d{6}\b/.test(json.replace(/"protocol":"[^"]*"/, '')), false, 'nao vazar o codigo OTP');
      assert.equal(json.includes('devOtpPreview'), false);
    });
    await withResendMock(200, async (calls) => {
      const router = new CrmApiRouter(createInMemoryRepository());
      const challengeId = signMfaChallengeToken({ cid: 'MFA-T2', uid: 'usr-seta-01', email: ADMIN, mfaMethod: 'TOTP_AUTHENTICATOR', totpSecret: '', iat: Date.now(), exp: Date.now() + 60_000 });
      const res = await router.dispatch({ method: 'POST', path: '/api/auth/send-email-otp', query: { _fromHttpBridge: '1' }, body: { email: ADMIN, challengeId } });
      assert.equal(res.status, 200);
      const code = String(calls[0].subject).match(/(\d{6})/)?.[1];
      assert.ok(code);
      assert.equal(JSON.stringify(res.body).includes(code!), false);
    });
  });
});
