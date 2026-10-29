// STI-hub — Esqueci minha senha, OTP por e-mail (chave Resend) e pareamento TOTP so apos a senha do convite
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter, normalizeResendApiKey } from '../src/api/router';
import {
  isPasswordResetTokenStale,
  signPasswordResetToken,
  verifyPasswordResetToken,
} from '../src/api/password-reset';
import { signMfaChallengeToken, signStiHubSessionToken } from '../src/app/lib/auth';
import { isPublicStiHubPath } from '../src/middleware';

const ADMIN = 'marcelo.mira@setatelecom.com.br';
const FROM = 'STI-hub <no-reply@notificacoes.setatelecom.com.br>';

type Call = Record<string, unknown>;
async function withResend<T>(
  opts: { status?: number; body?: string; key?: string },
  fn: (calls: Call[]) => Promise<T>
): Promise<T> {
  const prevFetch = globalThis.fetch;
  const prevKey = process.env.RESEND_API_KEY;
  const prevFrom = process.env.RESEND_FROM_EMAIL;
  const calls: Call[] = [];
  process.env.RESEND_API_KEY = opts.key ?? 're_test_dummy_key_nao_real';
  process.env.RESEND_FROM_EMAIL = FROM;
  globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => {
    calls.push(JSON.parse(String(init?.body || '{}')));
    const st = opts.status ?? 200;
    return new Response(opts.body ?? (st === 200 ? JSON.stringify({ id: 'email-test' }) : '{}'), { status: st });
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = prevKey;
    if (prevFrom === undefined) delete process.env.RESEND_FROM_EMAIL; else process.env.RESEND_FROM_EMAIL = prevFrom;
  }
}

const http = (router: CrmApiRouter, method: string, path: string, body: Record<string, unknown> = {}, extra: Record<string, string> = {}) =>
  router.dispatch({ method, path, query: { _fromHttpBridge: '1', _clientIp: extra.ip || '10.0.0.1', ...extra }, body });

function sessionFor(uid: string, email: string, iat: number) {
  return signStiHubSessionToken({
    uid, email, name: 'Teste', roleId: 'SUPER_ADMIN', scope: 'TODOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat, exp: iat + 3_600_000,
  });
}

function tokenFromEmail(call: Call): string {
  const m = String(call.html).match(/redefinir-senha\?token=([^"&]+)/);
  assert.ok(m, 'link de redefinicao no e-mail');
  return decodeURIComponent(m![1]);
}

describe('Chave Resend: normalizacao', () => {
  it('aceita re_..., remove aspas/Bearer e rejeita placeholders', () => {
    assert.equal(normalizeResendApiKey('re_abcdefgh123'), 're_abcdefgh123');
    assert.equal(normalizeResendApiKey('  "re_abcdefgh123" '), 're_abcdefgh123');
    assert.equal(normalizeResendApiKey('Bearer re_abcdefgh123'), 're_abcdefgh123');
    assert.equal(normalizeResendApiKey('[REDACTED]'), '');
    assert.equal(normalizeResendApiKey(''), '');
  });

  it('OTP por e-mail: chave invalida no provedor => 503 com causa clara, sem codigo', async () => {
    await withResend({ status: 400, body: JSON.stringify({ message: 'API key is invalid', name: 'validation_error' }) }, async (calls) => {
      const router = new CrmApiRouter(createInMemoryRepository());
      const challengeId = signMfaChallengeToken({ cid: 'MFA-K', uid: 'usr-seta-01', email: ADMIN, mfaMethod: 'TOTP_AUTHENTICATOR', totpSecret: '', iat: Date.now(), exp: Date.now() + 60_000 });
      const res = await http(router, 'POST', '/api/auth/send-email-otp', { email: ADMIN, challengeId });
      assert.equal(res.status, 503);
      const body = res.body as { error: string };
      assert.match(body.error, /chave da API de e-mail/i);
      assert.equal(calls.length, 1, 'nao insiste com outro remetente quando a chave e invalida');
      const code = String(calls[0].subject).match(/(\d{6})/)?.[1];
      assert.equal(JSON.stringify(res.body).includes(code!), false);
    });
  });

  it('OTP por e-mail: chave valida => entregue com remetente notificacoes, codigo fora da resposta', async () => {
    await withResend({}, async (calls) => {
      const router = new CrmApiRouter(createInMemoryRepository());
      const challengeId = signMfaChallengeToken({ cid: 'MFA-K2', uid: 'usr-seta-01', email: ADMIN, mfaMethod: 'TOTP_AUTHENTICATOR', totpSecret: '', iat: Date.now(), exp: Date.now() + 60_000 });
      const res = await http(router, 'POST', '/api/auth/send-email-otp', { email: ADMIN, challengeId });
      assert.equal(res.status, 200);
      assert.equal(calls[0].from, FROM);
      const code = String(calls[0].subject).match(/(\d{6})/)?.[1];
      assert.equal(JSON.stringify(res.body).includes(code!), false);
    });
  });
});

describe('Convite: pareamento TOTP so depois da senha', () => {
  it('GET /api/auth/invite nao devolve segredo/otpauth/QR; POST accept-invite devolve', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const inv = repo.createUserInvite('usr-seta-02');
    assert.ok(inv.inviteToken);
    const g = await http(router, 'GET', '/api/auth/invite', {}, { token: inv.inviteToken! });
    assert.equal(g.status, 200);
    const gj = JSON.stringify(g.body);
    for (const k of ['totpPairing', 'totpSecret', 'otpauth', 'qrCodeSvgDataUrl']) assert.equal(gj.includes(k), false, k);
    assert.ok((g.body as { data: { user: { email: string } } }).data.user.email);
    const p = await http(router, 'POST', '/api/auth/accept-invite', { token: inv.inviteToken, password: 'SenhaNova#2026' });
    assert.equal(p.status, 200);
    const pd = (p.body as { data: { totpPairing?: { otpauthUri?: string; qrCodeSvgDataUrl?: string } } }).data;
    assert.ok(pd.totpPairing?.otpauthUri?.startsWith('otpauth://'));
    assert.ok(pd.totpPairing?.qrCodeSvgDataUrl);
  });
});

describe('Esqueci minha senha', () => {
  it('rotas publicas so as telas necessarias', () => {
    assert.equal(isPublicStiHubPath('/esqueci-senha'), true);
    assert.equal(isPublicStiHubPath('/redefinir-senha'), true);
    assert.equal(isPublicStiHubPath('/api/auth/forgot-password', 'POST'), true);
    assert.equal(isPublicStiHubPath('/api/auth/reset-password', 'POST'), true);
    assert.equal(isPublicStiHubPath('/redefinir-senha-admin'), false);
  });

  it('resposta generica e identica para e-mail existente, inexistente e inativo; nunca expoe token/link', async () => {
    await withResend({}, async (calls) => {
      const repo = createInMemoryRepository();
      repo.upsertRbacUser({ id: 'usr-seta-03', active: false });
      const router = new CrmApiRouter(repo);
      const a = await http(router, 'POST', '/api/auth/forgot-password', { email: 'naoexiste@setatelecom.com.br' }, { ip: '10.1.0.1' });
      const inactiveEmail = repo.findRbacUserRecord('usr-seta-03', '')!.email;
      const b = await http(router, 'POST', '/api/auth/forgot-password', { email: inactiveEmail }, { ip: '10.1.0.2' });
      assert.equal(calls.length, 0, 'sem e-mail para inexistente/inativo');
      const c = await http(router, 'POST', '/api/auth/forgot-password', { email: ADMIN.toUpperCase() }, { ip: '10.1.0.3' });
      assert.equal(calls.length, 1);
      assert.deepEqual(a, b);
      assert.deepEqual(a.body, c.body);
      assert.equal(a.status, 200);
      const cj = JSON.stringify(c);
      assert.equal(/PWR1-|token|redefinir-senha\?/.test(cj), false);
      assert.equal(calls[0].from, FROM);
      assert.deepEqual(calls[0].to, [ADMIN]);
      assert.ok(String(calls[0].html).includes('Redefinir senha'));
      assert.ok(String(calls[0].html).includes('30 minutos'));
      assert.ok(String(calls[0].html).startsWith('<!doctype html>'));
      assert.ok(String(calls[0].html).includes('https://sti-hub.vercel.app/redefinir-senha?token='));
    });
  });

  it('link usa origem fixa do servidor (ignora _origin/Host da requisicao)', async () => {
    await withResend({}, async (calls) => {
      const router = new CrmApiRouter(createInMemoryRepository());
      await http(router, 'POST', '/api/auth/forgot-password', { email: ADMIN }, { ip: '10.2.0.1', _origin: 'https://evil.example' });
      assert.equal(String(calls[0].html).includes('evil.example'), false);
    });
  });

  it('rate-limit por e-mail (3/15min) e por IP (10/15min)', async () => {
    await withResend({}, async (calls) => {
      const router = new CrmApiRouter(createInMemoryRepository());
      for (let i = 0; i < 4; i++) {
        const r = await http(router, 'POST', '/api/auth/forgot-password', { email: ADMIN }, { ip: `10.3.0.${i}` });
        assert.equal(r.status, 200);
      }
      assert.equal(calls.length, 3, 'quarto pedido para o mesmo e-mail nao envia');
    });
  });

  it('redefinicao: politica de senha, uso unico, nao loga direto, invalida sessoes antigas e login exige 2FA', async () => {
    await withResend({}, async (calls) => {
      const repo = createInMemoryRepository();
      const router = new CrmApiRouter(repo);
      const oldSession = sessionFor('usr-seta-01', ADMIN, Date.now() - 5_000);
      const before = await http(router, 'GET', '/api/companies', {}, { _sessionToken: oldSession });
      assert.equal(before.status, 200, 'sessao antiga valida antes da redefinicao');

      await http(router, 'POST', '/api/auth/forgot-password', { email: ADMIN }, { ip: '10.4.0.1' });
      const token = tokenFromEmail(calls[0]);

      const weak = await http(router, 'POST', '/api/auth/reset-password', { token, password: '123' });
      assert.equal(weak.status, 400);

      const tampered = await http(router, 'POST', '/api/auth/reset-password', { token: token.slice(0, -2) + 'xx', password: 'NovaSenha#2026' });
      assert.equal(tampered.status, 400);

      const ok = await http(router, 'POST', '/api/auth/reset-password', { token, password: 'NovaSenha#2026' });
      assert.equal(ok.status, 200);
      const okj = JSON.stringify(ok.body);
      assert.equal(okj.includes('sessionToken'), false, 'nao loga direto');
      assert.equal(/passwordHash|NovaSenha/.test(okj), false);
      assert.match(String(ok.headers?.['Set-Cookie']), /stihub_session=;.*Max-Age=0/);
      assert.equal((ok.body as { data: { loginRequired: boolean } }).data.loginRequired, true);

      const reuse = await http(router, 'POST', '/api/auth/reset-password', { token, password: 'OutraSenha#2026' });
      assert.equal(reuse.status, 400, 'token de uso unico');

      const after = await http(router, 'GET', '/api/companies', {}, { _sessionToken: oldSession });
      assert.equal(after.status, 401, 'sessao emitida antes da redefinicao e invalidada');
      const fresh = await http(router, 'GET', '/api/companies', {}, { _sessionToken: sessionFor('usr-seta-01', ADMIN, Date.now() + 1) });
      assert.equal(fresh.status, 200);

      const loginOld = await http(router, 'POST', '/api/auth/login', { email: ADMIN, password: 'OutraSenha#2026' });
      assert.notEqual(loginOld.status, 200);
      const login = await http(router, 'POST', '/api/auth/login', { email: ADMIN, password: 'NovaSenha#2026' });
      assert.equal(login.status, 200);
      const ld = (login.body as { data: { mfaRequired: boolean; sessionToken?: string } }).data;
      assert.equal(ld.mfaRequired, true, 'login apos redefinicao exige 2FA');
      assert.equal(ld.sessionToken, undefined);
    });
  });

  it('token expira em 30 min e fica obsoleto se a senha mudar depois da emissao', () => {
    const t0 = Date.now();
    const { token, claims } = signPasswordResetToken({ uid: 'u1', email: 'a@b.com', pv: '', now: t0 });
    assert.equal(verifyPasswordResetToken(token, t0 + 29 * 60_000).ok, true);
    const exp = verifyPasswordResetToken(token, t0 + 31 * 60_000);
    assert.equal(exp.ok, false);
    assert.equal(isPasswordResetTokenStale(claims, { passwordChangedAt: new Date(t0 - 60_000).toISOString() }), false);
    assert.equal(isPasswordResetTokenStale(claims, { passwordChangedAt: new Date(t0 + 1_000).toISOString() }), true);
    assert.equal(verifyPasswordResetToken(signStiHubSessionToken({
      uid: 'u1', email: 'a@b.com', name: 'x', roleId: 'SUPER_ADMIN', scope: 'TODOS', enabledModules: [], moduleAccess: { crm: true, erp: true, chamados: true },
      mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: t0, exp: t0 + 1000,
    })).ok, false, 'token de sessao nao serve como token de redefinicao');
  });
});
