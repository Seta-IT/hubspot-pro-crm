// ============================================================================
// STI-hub — Pacote A (29/10/2026): hardening
// A1: checagem IAM central vale para TODA chamada; _fromHttpBridge/_cronAuthorized/_sessionToken
//     nao podem ser injetados pelo cliente (query nem corpo); so contexto interno confiavel (Symbol).
// A2: desafios de e-mail separados por fluxo (OTP-MAIL-LOGIN- x OTP-MAIL-STEPUP-), sem cruzamento.
// A3: token de sessao so no cookie HttpOnly (nunca no JSON); front-end nao le/grava stihub_session.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import {
  computeRfc6238Totp,
  mfaChallengeFlowOf,
  signMfaChallengeToken,
  signStiHubSessionToken,
  STIHUB_TOTP_ROTATION_EPOCH,
} from '../src/app/lib/auth';
import { createInMemoryRepository } from '../src/db/repository';
import { BRIDGE_RESERVED_KEYS, CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import { deriveServerTotpSecret } from '../src/db/iam-security';
import { forwardToCrmRouter, stripReservedBodyKeys } from '../src/app/api/_bridge';

const EMAIL = 'marcelo.mira@setatelecom.com.br';
const PASSWORD = 'SenhaPropria#2026';
const HTTP = { _fromHttpBridge: '1' };
const ROOT = process.cwd();
const src = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function sessionFromCookie(res: { headers?: Record<string, string> }): string {
  const m = String(res.headers?.['Set-Cookie'] || '').match(/stihub_session=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : '';
}
function freshRouter(opts: { paired?: boolean } = {}) {
  const repo = createInMemoryRepository();
  repo.upsertRbacUser({ email: EMAIL, password: PASSWORD });
  if (opts.paired) repo.upsertRbacUser({ email: EMAIL, totpConfigured: true, totpEpoch: STIHUB_TOTP_ROTATION_EPOCH });
  return { repo, router: new CrmApiRouter(repo) };
}
function session(uid: string, email: string, roleId: string, extra: Record<string, unknown> = {}) {
  return signStiHubSessionToken({
    uid, email, name: 'Teste', roleId, scope: roleId === 'SUPER_ADMIN' ? 'TODOS' : 'PROPRIOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now(), exp: Date.now() + 120_000, ...extra,
  } as Parameters<typeof signStiHubSessionToken>[0]);
}
const adminTok = () => session('usr-seta-01', EMAIL, 'SUPER_ADMIN', { canManageUsersRbac: true });
const vendTok = () => session('usr-seta-02', 'evelyn.santos@setatelecom.com.br', 'VENDEDOR_SALES');
async function safeWindow(): Promise<void> {
  const rem = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (rem < 4) await new Promise((r) => setTimeout(r, rem * 1000 + 300));
}

describe('Pacote A1: checagem IAM central para toda chamada + chaves internas nao injetaveis', () => {
  const IAM_CALLS: Array<[string, string, Record<string, unknown>?]> = [
    ['GET', '/api/admin/users'],
    ['GET', '/api/rbac/users'],
    ['GET', '/api/iam/users'],
    ['POST', '/api/rbac/users', { email: 'x.novo@setatelecom.com.br', name: 'X', roleId: 'SUPER_ADMIN' }],
    ['PUT', '/api/admin/users/usr-seta-02', { roleId: 'SUPER_ADMIN' }],
    ['GET', '/api/admin/rbac'],
    ['GET', '/api/admin/audit-logs'],
  ];

  it('chamada INTERNA (sem _fromHttpBridge) sem sessao e sem contexto confiavel => negada; IAM inalterado', async () => {
    const { router, repo } = freshRouter();
    for (const [method, p, body] of IAM_CALLS) {
      const res = await router.dispatch({ method, path: p, body: body || {} });
      assert.ok([401, 403].includes(res.status), `${method} ${p} interno sem sessao => ${res.status}`);
    }
    assert.notEqual(repo.findRbacUserRecord('usr-seta-02', '')?.roleId, 'SUPER_ADMIN', 'papel do usuario preservado');
  });

  it('chamada interna com sessao de VENDEDOR => 403; com sessao admin => 200', async () => {
    const { router } = freshRouter();
    const v = await router.dispatch({ method: 'GET', path: '/api/admin/users', query: { _sessionToken: vendTok() } });
    assert.equal(v.status, 403);
    const a = await router.dispatch({ method: 'GET', path: '/api/admin/users', query: { _sessionToken: adminTok() } });
    assert.equal(a.status, 200);
  });

  it('so o Symbol TRUSTED_INTERNAL_CONTEXT libera a chamada interna (string/JSON nao servem)', async () => {
    const { router } = freshRouter();
    const ok = await router.dispatch({ method: 'GET', path: '/api/admin/users', context: TRUSTED_INTERNAL_CONTEXT });
    assert.equal(ok.status, 200);
    const forged = JSON.parse(JSON.stringify({ context: 'stihub.trustedInternalContext' }));
    const bad = await router.dispatch({ method: 'GET', path: '/api/admin/users', ...forged });
    assert.equal(bad.status, 401);
    const viaBody = await router.dispatch({ method: 'GET', path: '/api/admin/users', body: { context: 'x', _trustedInternal: '1' } });
    assert.equal(viaBody.status, 401);
  });

  it('dispatch ignora chaves _* na query string do caminho (_fromHttpBridge=0, _sessionToken, _cronAuthorized)', async () => {
    const { router } = freshRouter();
    const a = await router.dispatch({ method: 'GET', path: `/api/admin/users?_sessionToken=${encodeURIComponent(adminTok())}` });
    assert.equal(a.status, 401, 'token via query string do caminho nao vale');
    const b = await router.dispatch({ method: 'GET', path: '/api/deals?_fromHttpBridge=0', query: { ...HTTP } });
    assert.equal(b.status, 401, '_fromHttpBridge=0 na URL nao desliga a exigencia de sessao');
    const c = await router.dispatch({ method: 'GET', path: '/api/erp/daily-sync?_cronAuthorized=1', query: { ...HTTP } });
    assert.equal(c.status, 401, '_cronAuthorized na URL nao autoriza o cron');
  });

  it('bridge HTTP: query e corpo com _fromHttpBridge/_cronAuthorized/_sessionToken sao removidos/sobrescritos', async () => {
    const admin = adminTok();
    const q = await forwardToCrmRouter(new NextRequest(`https://sti-hub.local/api/admin/users?_fromHttpBridge=0&_sessionToken=${encodeURIComponent(admin)}`));
    assert.equal(q.status, 401, 'token na query da URL ignorado');
    const cron = await forwardToCrmRouter(new NextRequest('https://sti-hub.local/api/erp/daily-sync?_cronAuthorized=1&_fromHttpBridge=0'));
    assert.equal(cron.status, 401, 'cron so com Bearer CRON_SECRET');
    const body = await forwardToCrmRouter(new NextRequest('https://sti-hub.local/api/admin/users', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ _sessionToken: admin, _fromHttpBridge: '0', _cronAuthorized: '1', email: 'injetado@setatelecom.com.br', name: 'Injetado', roleId: 'SUPER_ADMIN' }),
    }));
    assert.equal(body.status, 401, '_sessionToken no corpo nao autentica');
    const cronBody = await forwardToCrmRouter(new NextRequest('https://sti-hub.local/api/erp/daily-sync', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ _cronAuthorized: '1' }),
    }));
    assert.equal(cronBody.status, 401);
    const stripped = stripReservedBodyKeys({ _fromHttpBridge: '0', _cronAuthorized: '1', _sessionToken: 't', _svcBearer: '1', _origin: 'x', _reconcileJournal: [1], name: 'ok' }) as Record<string, unknown>;
    for (const k of BRIDGE_RESERVED_KEYS) assert.equal(k in stripped, false, `${k} removido`);
    assert.deepEqual(stripped, { _reconcileJournal: [1], name: 'ok' });
  });

  it('servidor standalone (npm start) remove chaves _* e marca a origem HTTP', () => {
    const s = src('src/api/server.ts');
    assert.ok(s.includes("if (!k.startsWith('_')) query[k] = v;"));
    assert.ok(s.includes("query._fromHttpBridge = '1';"));
    assert.ok(s.includes('BRIDGE_RESERVED_KEYS'));
  });
});

describe('Pacote A2: desafio de e-mail do login x do step-up (sem cruzamento)', () => {
  it('prefixos por fluxo; OTP-MAIL- legado nao vale em nenhum', () => {
    const { repo } = freshRouter({ paired: true });
    const l = repo.createEmailOtpChallenge(EMAIL, undefined, 'LOGIN');
    const s = repo.createEmailOtpChallenge(EMAIL, undefined, 'STEPUP');
    const cidOf = (t: string) => JSON.parse(Buffer.from(t.slice(4).split('.')[0], 'base64url').toString()).cid as string;
    assert.match(cidOf(l.challengeId!), /^OTP-MAIL-LOGIN-/);
    assert.match(cidOf(s.challengeId!), /^OTP-MAIL-STEPUP-/);
    assert.equal(mfaChallengeFlowOf('OTP-MAIL-usr-seta-01-X'), null);
    assert.equal(mfaChallengeFlowOf('OTP-MAIL-LOGIN-usr'), 'LOGIN');
    assert.equal(mfaChallengeFlowOf('OTP-MAIL-STEPUP-usr'), 'STEPUP');
    assert.equal(mfaChallengeFlowOf('STEPUP-usr'), 'STEPUP');
    assert.equal(mfaChallengeFlowOf('MFA-usr'), 'LOGIN');
  });

  it('desafio/codigo de STEP-UP nao faz login (verify-mfa) e desafio/codigo de LOGIN nao faz step-up', async () => {
    const { router, repo } = freshRouter({ paired: true });
    const t = adminTok();
    const login = repo.createEmailOtpChallenge(EMAIL, undefined, 'LOGIN');
    const step = repo.createEmailOtpChallenge(EMAIL, undefined, 'STEPUP');
    assert.ok(login.ok && step.ok && login.otpCode && step.otpCode);

    const stepAsLogin = await router.dispatch({ method: 'POST', path: '/api/auth/verify-mfa', query: { ...HTTP }, body: { email: EMAIL, challengeId: step.challengeId, code: step.otpCode, mfaMethod: 'EMAIL_OTP' } });
    assert.equal(stepAsLogin.status, 401, 'OTP-MAIL-STEPUP no login => 401');
    const stepCodeInLoginChallenge = await router.dispatch({ method: 'POST', path: '/api/auth/verify-mfa', query: { ...HTTP }, body: { email: EMAIL, challengeId: login.challengeId, code: step.otpCode, mfaMethod: 'EMAIL_OTP' } });
    if (step.otpCode !== login.otpCode) assert.equal(stepCodeInLoginChallenge.status, 401, 'codigo do step-up no desafio de login => 401');
    const loginAsStep = await router.dispatch({ method: 'POST', path: '/api/auth/step-up/verify', query: { ...HTTP, _sessionToken: t }, body: { challengeId: login.challengeId, code: login.otpCode } });
    assert.equal(loginAsStep.status, 401, 'OTP-MAIL-LOGIN no step-up => 401');
    const loginCodeInStep = await router.dispatch({ method: 'POST', path: '/api/auth/step-up/verify', query: { ...HTTP, _sessionToken: t }, body: { challengeId: step.challengeId, code: login.otpCode } });
    if (step.otpCode !== login.otpCode) assert.equal(loginCodeInStep.status, 401, 'codigo do login no desafio de step-up => 401');
    // repositorio: mesmo sem desafio assinado, o codigo do step-up nao entra no fluxo de login
    const internal = repo.verifyMfaAndCreateSession({ email: EMAIL, code: step.otpCode!, mfaMethod: 'EMAIL_OTP' });
    if (step.otpCode !== login.otpCode) assert.equal(internal.ok, false);

    // controles positivos: cada desafio no seu proprio fluxo
    const okStep = await router.dispatch({ method: 'POST', path: '/api/auth/step-up/verify', query: { ...HTTP, _sessionToken: t }, body: { challengeId: step.challengeId, code: step.otpCode } });
    assert.equal(okStep.status, 200, 'OTP-MAIL-STEPUP no step-up => 200');
    const okLogin = await router.dispatch({ method: 'POST', path: '/api/auth/verify-mfa', query: { ...HTTP }, body: { email: EMAIL, challengeId: login.challengeId, code: login.otpCode, mfaMethod: 'EMAIL_OTP' } });
    assert.equal(okLogin.status, 200, 'OTP-MAIL-LOGIN no login => 200');
  });

  it('desafio OTP-MAIL- legado (sem fluxo) e STEPUP TOTP no login => 401', async () => {
    const { router } = freshRouter({ paired: true });
    const legacy = signMfaChallengeToken({ cid: 'OTP-MAIL-usr-seta-01-LEGADO', uid: 'usr-seta-01', email: EMAIL, mfaMethod: 'EMAIL_OTP', totpSecret: '', iat: Date.now(), exp: Date.now() + 60_000 });
    await safeWindow();
    const code = computeRfc6238Totp(deriveServerTotpSecret(EMAIL)).code;
    const a = await router.dispatch({ method: 'POST', path: '/api/auth/verify-mfa', query: { ...HTTP }, body: { email: EMAIL, challengeId: legacy, code, mfaMethod: 'TOTP_AUTHENTICATOR' } });
    assert.equal(a.status, 401);
    const b = await router.dispatch({ method: 'POST', path: '/api/auth/step-up/verify', query: { ...HTTP, _sessionToken: adminTok() }, body: { challengeId: legacy, code } });
    assert.equal(b.status, 401);
  });
});

describe('Pacote A3: token da sessao so no cookie HttpOnly', () => {
  it('login completo (senha + TOTP) => Set-Cookie HttpOnly e JSON sem sessionToken', async () => {
    const { router } = freshRouter({ paired: true });
    const s1 = await router.dispatch({ method: 'POST', path: '/api/auth/login', query: { ...HTTP }, body: { email: EMAIL, password: PASSWORD } });
    assert.equal(s1.status, 200);
    const cid = (s1.body as { data: { challengeId: string } }).data.challengeId;
    await safeWindow();
    const v = await router.dispatch({ method: 'POST', path: '/api/auth/verify-mfa', query: { ...HTTP }, body: { email: EMAIL, challengeId: cid, code: computeRfc6238Totp(deriveServerTotpSecret(EMAIL)).code, mfaMethod: 'TOTP_AUTHENTICATOR' } });
    assert.equal(v.status, 200);
    assert.equal(JSON.stringify(v.body).includes('sessionToken'), false);
    assert.match(String(v.headers?.['Set-Cookie']), /^stihub_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax/);
    const me = await router.dispatch({ method: 'GET', path: '/api/auth/me', query: { ...HTTP, _sessionToken: sessionFromCookie(v) } });
    assert.equal(me.status, 200);
  });

  it('front-end (login, convite, redefinir-senha, Minha Conta) nao le sessionToken nem grava stihub_session', () => {
    for (const f of ['src/app/login/page.tsx', 'src/app/convite/page.tsx', 'src/app/redefinir-senha/page.tsx', 'src/app/components/UserAccountModal.tsx']) {
      const s = src(f);
      assert.equal(/\.sessionToken\b/.test(s), false, `${f} nao le sessionToken do JSON`);
      assert.equal(/document\.cookie\s*=\s*`stihub_session=\$\{/.test(s), false, `${f} nao grava o token no cookie via JS`);
    }
    assert.ok(src('src/app/redefinir-senha/page.tsx').includes("fetch('/api/auth/logout'"), 'logout no servidor apaga o cookie HttpOnly');
  });
});
