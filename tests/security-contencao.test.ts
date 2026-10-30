// ============================================================================
// STI-hub — Contencao de emergencia (29/10/2026): regressao de seguranca
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { evaluateStiHubRouteProtection, middleware } from '../src/middleware';
import {
  generateTotpSecretBase32,
  hashCorporatePassword,
  resolveStiHubSigningSecret,
  signStiHubSessionToken,
  StiHubSignedSessionClaims,
  STIHUB_TOTP_ROTATION_EPOCH,
  verifyCorporatePassword,
  verifyStiHubSessionToken,
} from '../src/app/lib/auth';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';
import { deriveServerTotpSecret, sealIamRecord } from '../src/db/iam-security';
import { forwardToCrmRouter } from '../src/app/api/_bridge';

const ADMIN_EMAIL = 'marcelo.mira@setatelecom.com.br';
const HTTP = { _fromHttpBridge: '1' };

function token(overrides: Partial<StiHubSignedSessionClaims> = {}): string {
  return signStiHubSessionToken({
    uid: 'usr-seta-01',
    email: ADMIN_EMAIL,
    name: 'Marcelo Lopes Mira',
    roleId: 'SUPER_ADMIN',
    scope: 'TODOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'],
    moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true,
    mfaMethod: 'TOTP_AUTHENTICATOR',
    iat: Date.now(),
    exp: Date.now() + 60_000,
    ...overrides,
  });
}

const SECRET_KEYS = ['"totpSecret"', '"passwordHash"', '"totpSecretFormatted"', '"currentTotpCode"', '"demoTotpCode"', '"smtpPass"', '"resendApiKey"'];

function assertNoSecrets(body: unknown, label: string) {
  const json = JSON.stringify(body);
  for (const k of SECRET_KEYS) {
    assert.equal(json.includes(k), false, `${label}: resposta nao pode conter ${k}`);
  }
}

describe('Contencao: API anonima => 401 (sem DEFAULT_ADMIN_SESSION_FALLBACK)', () => {
  it('middleware nega toda /api nao publica sem sessao, mesmo com enforceStrictLock=false', () => {
    for (const [p, m] of [
      ['/api/admin/users', 'GET'],
      ['/api/contacts', 'GET'],
      ['/api/erp/proposals', 'GET'],
      ['/api/admin/security', 'GET'],
      ['/api/erp/proposals/prop-seta-001', 'PATCH'],
      ['/api/erp/proposals/prop-seta-001/restore-version', 'POST'],
    ]) {
      const d = evaluateStiHubRouteProtection({ pathname: p, method: m, sessionToken: null, enforceStrictLock: false });
      assert.equal(d.allowed, false, `${m} ${p}`);
      assert.equal(d.statusCode, 401, `${m} ${p}`);
      assert.notEqual(d.reason, 'DEFAULT_ADMIN_SESSION_FALLBACK');
    }
    assert.equal(evaluateStiHubRouteProtection({ pathname: '/api/erp/proposals/prop-seta-001', method: 'GET', sessionToken: null }).allowed, true);
    assert.equal(evaluateStiHubRouteProtection({ pathname: '/api/erp/proposals/prop-seta-001/approve', method: 'POST', sessionToken: null }).allowed, true);
  });

  it('middleware HTTP: referer de mesma origem nao concede acesso', () => {
    const req = new NextRequest('https://sti-hub.vercel.app/api/contacts', {
      headers: { referer: 'https://sti-hub.vercel.app/', host: 'sti-hub.vercel.app' },
    });
    const res = middleware(req);
    assert.equal(res.status, 401);
  });

  it('router (defesa em profundidade): requisicao HTTP sem sessao => 401; GET proposta :id sem link assinado => 404', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    for (const [p, m] of [
      ['/api/admin/users', 'GET'],
      ['/api/contacts', 'GET'],
      ['/api/erp/proposals', 'GET'],
      ['/api/erp/proposals/prop-seta-001', 'PATCH'],
      ['/api/erp/proposals/prop-seta-001/restore-version', 'POST'],
    ]) {
      const res = await router.dispatch({ method: m, path: p, query: { ...HTTP }, body: {} });
      assert.equal(res.status, 401, `${m} ${p}`);
    }
    const forged = Buffer.from(JSON.stringify({ email: ADMIN_EMAIL, mfaVerified: true })).toString('base64url');
    const forgedRes = await router.dispatch({ method: 'GET', path: '/api/admin/users', query: { ...HTTP, _sessionToken: forged } });
    assert.equal(forgedRes.status, 401);
    // Link assinado (29/10/2026): GET anonimo sem token => 404 generico (sem DTO parcial).
    const pub = await router.dispatch({ method: 'GET', path: '/api/erp/proposals/prop-seta-001', query: { ...HTTP } });
    assert.equal(pub.status, 404);
  });

  it('bridge descarta chaves internas _* vindas da URL (_sessionToken, _fromHttpBridge, _origin)', async () => {
    const t = token();
    const res = await forwardToCrmRouter(
      new NextRequest(`https://sti-hub.vercel.app/api/admin/users?_sessionToken=${encodeURIComponent(t)}&_fromHttpBridge=0`)
    );
    assert.equal(res.status, 401, '_sessionToken pela URL nao autentica e _fromHttpBridge=0 nao desliga a protecao');
  });

  it('PATCH/restore-version com sessao sem perfil ERP_ADMIN/ERP_COMMERCIAL => 403 tambem no router', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    const finance = token({ uid: 'usr-fin-x', email: 'fin.x@setatelecom.com.br', roleId: 'FINANCEIRO_FATURAMENTO', erpRole: 'ERP_FINANCE' });
    const patch = await router.dispatch({ method: 'PATCH', path: '/api/erp/proposals/prop-seta-001', query: { ...HTTP, _sessionToken: finance }, body: { title: 'x' } });
    assert.equal(patch.status, 403);
    const put = await router.dispatch({ method: 'PUT', path: '/api/erp/proposals/prop-seta-001', query: { ...HTTP, _sessionToken: finance }, body: { title: 'x' } });
    assert.equal(put.status, 403);
    const restore = await router.dispatch({ method: 'POST', path: '/api/erp/proposals/prop-seta-001/restore-version', query: { ...HTTP, _sessionToken: finance }, body: { targetVersion: 1 } });
    assert.equal(restore.status, 403);
  });
});

describe('Contencao: respostas sem segredos', () => {
  it('/api/admin/users, /api/auth/me e /api/bootstrap nao expõem totpSecret/passwordHash', async () => {
    const repo = createInMemoryRepository();
    repo.upsertRbacUser({ email: ADMIN_EMAIL, password: 'SenhaPropria#2026' });
    const router = new CrmApiRouter(repo);
    const t = token();
    const users = await router.dispatch({ method: 'GET', path: '/api/admin/users', query: { ...HTTP, _sessionToken: t } });
    assert.equal(users.status, 200);
    assertNoSecrets(users.body, '/api/admin/users');
    const list = (users.body as { data: Array<Record<string, unknown>> }).data;
    assert.ok(list.length > 0);
    assert.ok(list.every((u) => typeof u.iamSeal === 'string'), 'cada usuario deve vir com iamSeal opaco');
    for (const p of ['/api/auth/me', '/api/auth/session', '/api/bootstrap', '/api/admin/security']) {
      const r = await router.dispatch({ method: 'GET', path: p, query: { ...HTTP, _sessionToken: t } });
      assertNoSecrets(r.body, p);
    }
  });
});

describe('Contencao: override IAM do cliente', () => {
  it('override cru (body/header) antes da autenticacao e ignorado', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const attack = [{ id: 'usr-hacker', email: 'hacker@evil.com', roleId: 'SUPER_ADMIN', password: 'Hacker#12345', active: true }];
    const res = await router.dispatch({
      method: 'POST',
      path: '/api/auth/login',
      query: { ...HTTP },
      body: { email: 'hacker@evil.com', password: 'Hacker#12345', iamUsersOverride: attack, iamDeletedUsersOverride: ['usr-seta-01'] },
    });
    assert.equal(res.status, 401);
    assert.equal(repo.findRbacUserRecord('usr-hacker', 'hacker@evil.com'), undefined);
    assert.ok(repo.findRbacUserRecord('usr-seta-01', ADMIN_EMAIL), 'exclusao via override anonimo nao pode valer');

    // Via header x-stihub-iam-users no bridge
    const hdrReq = new NextRequest('https://sti-hub.vercel.app/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-stihub-iam-users': encodeURIComponent(JSON.stringify(attack)) },
      body: JSON.stringify({ email: 'hacker@evil.com', password: 'Hacker#12345' }),
    });
    const hdrRes = await forwardToCrmRouter(hdrReq);
    assert.equal(hdrRes.status, 401);
  });

  it('override cru com sessao NAO-admin e ignorado; com admin de usuarios e aplicado sem campos de 2FA', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const seller = token({ uid: 'usr-vend-x', email: 'vend.x@setatelecom.com.br', roleId: 'VENDEDOR_SALES' });
    const attack = [{ id: 'usr-hacker2', email: 'hacker2@evil.com', roleId: 'SUPER_ADMIN', password: 'Hacker#12345' }];
    await router.dispatch({ method: 'GET', path: '/api/contacts', query: { ...HTTP, _sessionToken: seller }, body: { iamUsersOverride: attack } });
    assert.equal(repo.findRbacUserRecord('usr-hacker2', 'hacker2@evil.com'), undefined);

    const admin = token();
    // Pacote G: segredo TOTP aninhado no override em rota IAM admin => 400 e nada aplicado.
    const nested = await router.dispatch({
      method: 'PUT',
      path: '/api/admin/users/usr-seta-01',
      query: { ...HTTP, _sessionToken: admin },
      body: { iamUsersOverride: [{ id: 'usr-novo-1', email: 'novo1@setatelecom.com.br', name: 'Novo', roleId: 'VENDEDOR_SALES', totpSecret: 'JBSWY3DPEHPK3PXP', totpConfigured: true }] },
    });
    assert.equal(nested.status, 400);
    assert.equal(repo.findRbacUserRecord('usr-novo-1', 'novo1@setatelecom.com.br'), undefined);
    // Em rota nao-IAM o override cru do admin segue aplicado, com os campos de 2FA descartados.
    await router.dispatch({
      method: 'GET',
      path: '/api/contacts',
      query: { ...HTTP, _sessionToken: admin },
      body: { iamUsersOverride: [{ id: 'usr-novo-1', email: 'novo1@setatelecom.com.br', name: 'Novo', roleId: 'VENDEDOR_SALES', totpSecret: 'JBSWY3DPEHPK3PXP', totpConfigured: true }] },
    });
    const created = repo.findRbacUserRecord('usr-novo-1', 'novo1@setatelecom.com.br');
    assert.ok(created);
    assert.notEqual(created!.totpSecret, 'JBSWY3DPEHPK3PXP');
    assert.equal(created!.totpConfigured, false);
  });
});

describe('Contencao: senhas-mestras e rotacao TOTP', () => {
  it('senhas-mestras e "qualquer senha sem hash" sao rejeitadas', async () => {
    for (const pw of ['Seta@2026', 'Seta@2026#StiHub', 'StiHub@2026', 'SetaTelecom#118887', 'qualquer123']) {
      assert.equal(verifyCorporatePassword(pw, undefined), false, pw);
      assert.equal(verifyCorporatePassword(pw, hashCorporatePassword('OutraSenha#1')), false, pw);
    }
    assert.equal(verifyCorporatePassword('OutraSenha#1', hashCorporatePassword('OutraSenha#1')), true);
    const router = new CrmApiRouter(createInMemoryRepository());
    const res = await router.dispatch({ method: 'POST', path: '/api/auth/login', query: { ...HTTP }, body: { email: ADMIN_EMAIL, password: 'Seta@2026#StiHub' } });
    assert.equal(res.status, 401);
    const noPw = await router.dispatch({ method: 'POST', path: '/api/auth/login', query: { ...HTTP }, body: { email: ADMIN_EMAIL } });
    assert.equal(noPw.status, 401);
  });

  it('segredo TOTP derivado no servidor (diferente do legado) e todos os pareamentos antigos invalidados', () => {
    const repo = createInMemoryRepository();
    const users = repo.getRbacState().users;
    assert.ok(users.length >= 10);
    const rec = repo.findRbacUserRecord('usr-seta-01', ADMIN_EMAIL)!;
    assert.equal(rec.totpSecret, deriveServerTotpSecret(ADMIN_EMAIL));
    assert.notEqual(rec.totpSecret, generateTotpSecretBase32(ADMIN_EMAIL), 'segredo legado (salt publico) nao pode mais ser usado');
    assert.equal(rec.totpConfigured, false);
    for (const u of users) assert.equal(u.totpConfigured, false, u.email);
  });

  it('selo IAM antigo/forjado nao reinjeta segredo nem pareamento; selo valido preserva papel, modulos e senha', () => {
    const repo = createInMemoryRepository();
    const rec = repo.findRbacUserRecord('usr-seta-01', ADMIN_EMAIL)!;
    const sealed = sealIamRecord({
      ...rec,
      roleId: 'DIRETORIA',
      enabledModules: ['CRM', 'ERP'],
      passwordHash: hashCorporatePassword('SenhaPropria#2026'),
      totpSecret: 'JBSWY3DPEHPK3PXP',
      totpConfigured: true,
      totpEpoch: 'epoca-antiga',
    } as typeof rec);
    const repo2 = createInMemoryRepository();
    repo2.applySealedIamOverrides([{ id: rec.id, email: rec.email, iamSeal: sealed, totpSecret: 'JBSWY3DPEHPK3PXP' }]);
    const after = repo2.findRbacUserRecord('usr-seta-01', ADMIN_EMAIL)!;
    assert.equal(after.roleId, 'DIRETORIA');
    assert.deepEqual(after.enabledModules, ['CRM', 'ERP']);
    assert.equal(verifyCorporatePassword('SenhaPropria#2026', after.passwordHash), true);
    assert.equal(after.totpSecret, deriveServerTotpSecret(ADMIN_EMAIL));
    assert.equal(after.totpConfigured, false, 'pareamento de epoca antiga nao vale');

    const repo3 = createInMemoryRepository();
    repo3.applySealedIamOverrides([{ id: rec.id, email: rec.email, roleId: 'VENDEDOR_SALES', iamSeal: 'SEAL1.forjado' }]);
    assert.equal(repo3.findRbacUserRecord('usr-seta-01', ADMIN_EMAIL)!.roleId, rec.roleId);

    const repo4 = createInMemoryRepository();
    const sealedNow = sealIamRecord({ ...rec, totpConfigured: true, totpEpoch: STIHUB_TOTP_ROTATION_EPOCH } as typeof rec);
    repo4.applySealedIamOverrides([{ iamSeal: sealedNow }]);
    assert.equal(repo4.findRbacUserRecord('usr-seta-01', ADMIN_EMAIL)!.totpConfigured, true);
  });

  it('segredo HMAC falha fechado em producao sem STI_HUB_SESSION_SECRET', () => {
    const prev = { s: process.env.STI_HUB_SESSION_SECRET, n: process.env.NEXTAUTH_SECRET, a: process.env.AUTH_SECRET, v: process.env.VERCEL_ENV };
    const t = token();
    try {
      delete process.env.STI_HUB_SESSION_SECRET;
      delete process.env.NEXTAUTH_SECRET;
      delete process.env.AUTH_SECRET;
      process.env.VERCEL_ENV = 'production';
      assert.throws(() => resolveStiHubSigningSecret());
      assert.equal(verifyStiHubSessionToken(t).valid, false);
    } finally {
      for (const [k, v] of [['STI_HUB_SESSION_SECRET', prev.s], ['NEXTAUTH_SECRET', prev.n], ['AUTH_SECRET', prev.a], ['VERCEL_ENV', prev.v]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe('Contencao: Vercel Cron (CRON_SECRET) preservado', () => {
  it('GET /api/erp/daily-sync com Bearer CRON_SECRET passa no middleware e no router; sem Bearer => 401', async () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'cron-secret-de-teste-com-32-caracteres-abc';
    try {
      const ok = middleware(new NextRequest('https://sti-hub.vercel.app/api/erp/daily-sync', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
      assert.equal(ok.headers.get('x-stihub-auth-guard'), 'cron-secret-allowed');
      const bad = middleware(new NextRequest('https://sti-hub.vercel.app/api/erp/daily-sync', { headers: { authorization: 'Bearer errado' } }));
      assert.equal(bad.status, 401);
      const none = middleware(new NextRequest('https://sti-hub.vercel.app/api/erp/daily-sync'));
      assert.equal(none.status, 401);

      const router = new CrmApiRouter(createInMemoryRepository());
      const r401 = await router.dispatch({ method: 'GET', path: '/api/erp/daily-sync', query: { ...HTTP } });
      assert.equal(r401.status, 401);
      const viaBridge = await forwardToCrmRouter(
        new NextRequest('https://sti-hub.vercel.app/api/erp/daily-sync', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })
      );
      assert.notEqual(viaBridge.status, 401);
      const forgedFlag = await forwardToCrmRouter(new NextRequest('https://sti-hub.vercel.app/api/erp/daily-sync?_cronAuthorized=1'));
      assert.equal(forgedFlag.status, 401);
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });
});

describe('Contencao: fluxo do Marcéllo apos a rotacao (convite -> senha -> QR -> login em instancia fria)', () => {
  it('convite define senha propria, pareia QR e o login funciona em outra instancia via selo IAM', async () => {
    const { computeRfc6238Totp } = await import('../src/app/lib/auth');
    const repoA = createInMemoryRepository();
    const routerA = new CrmApiRouter(repoA);
    const inv = repoA.createUserInvite('usr-seta-01');
    assert.ok(inv.ok && inv.inviteToken);

    const accepted = await routerA.dispatch({ method: 'POST', path: '/api/auth/accept-invite', query: { ...HTTP }, body: { token: inv.inviteToken, password: 'SenhaPropria#2026' } });
    assert.equal(accepted.status, 200);
    // accept-invite pode devolver o material de pareamento (QR) do proprio usuario, mas nunca hash/segredo no registro.
    assert.equal(JSON.stringify(accepted.body).includes('"passwordHash"'), false);
    const accUser = (accepted.body as { data: { user?: Record<string, unknown> } }).data.user;
    assert.equal(accUser?.totpSecret, undefined);

    const login = await routerA.dispatch({ method: 'POST', path: '/api/auth/login', query: { ...HTTP }, body: { email: ADMIN_EMAIL, password: 'SenhaPropria#2026' } });
    assert.equal(login.status, 200);
    const ld = (login.body as { data: { challengeId: string; totpConfigured: boolean; totpPairing?: { totpSecret: string } } }).data;
    assert.equal(ld.totpConfigured, false, 'apos rotacao o 1o login exige pareamento (QR)');
    assert.equal(ld.totpPairing?.totpSecret, deriveServerTotpSecret(ADMIN_EMAIL));

    const verify = await routerA.dispatch({
      method: 'POST',
      path: '/api/auth/verify-mfa',
      query: { ...HTTP },
      body: { email: ADMIN_EMAIL, challengeId: ld.challengeId, code: computeRfc6238Totp(ld.totpPairing!.totpSecret).code },
    });
    assert.equal(verify.status, 200);
    assertNoSecrets(verify.body, 'verify-mfa');
    const vUser = (verify.body as { data: { user: Record<string, unknown> } }).data.user;
    assert.equal(typeof vUser.iamSeal, 'string');

    // Instancia fria: o navegador reenvia o registro selado no login.
    const repoB = createInMemoryRepository();
    const routerB = new CrmApiRouter(repoB);
    const loginB = await routerB.dispatch({
      method: 'POST',
      path: '/api/auth/login',
      query: { ...HTTP },
      body: { email: ADMIN_EMAIL, password: 'SenhaPropria#2026', iamUsersOverride: [{ ...vUser, password: 'SenhaPropria#2026' }] },
    });
    assert.equal(loginB.status, 200);
    const lb = (loginB.body as { data: { totpConfigured: boolean; totpPairing?: unknown } }).data;
    assert.equal(lb.totpConfigured, true, 'pareamento preservado pelo selo');
    assert.equal(lb.totpPairing, undefined, 'QR nao pode ser reexibido apos pareado');
    const wrong = await new CrmApiRouter(createInMemoryRepository()).dispatch({
      method: 'POST', path: '/api/auth/login', query: { ...HTTP },
      body: { email: ADMIN_EMAIL, password: 'Seta@2026', iamUsersOverride: [vUser] },
    });
    assert.equal(wrong.status, 401);
  });
});

describe('Contencao: /api/auth/setup-totp nao entrega QR sem autenticacao', () => {
  it('anonimo ou sessao de outro usuario => 401; desafio de senha do proprio usuario => 200', async () => {
    const repo = createInMemoryRepository();
    repo.upsertRbacUser({ email: ADMIN_EMAIL, password: 'SenhaPropria#2026' });
    const router = new CrmApiRouter(repo);
    const anon = await router.dispatch({ method: 'POST', path: '/api/auth/setup-totp', query: { ...HTTP }, body: { email: ADMIN_EMAIL } });
    assert.equal(anon.status, 401);
    assertNoSecrets(anon.body, 'setup-totp anonimo');
    const other = token({ uid: 'usr-vend-y', email: 'vend.y@setatelecom.com.br', roleId: 'VENDEDOR_SALES' });
    const otherRes = await router.dispatch({ method: 'POST', path: '/api/auth/setup-totp', query: { ...HTTP, _sessionToken: other }, body: { email: ADMIN_EMAIL } });
    assert.equal(otherRes.status, 401);
    const login = await router.dispatch({ method: 'POST', path: '/api/auth/login', query: { ...HTTP }, body: { email: ADMIN_EMAIL, password: 'SenhaPropria#2026' } });
    const challengeId = (login.body as { data: { challengeId: string } }).data.challengeId;
    assert.equal(JSON.stringify(Buffer.from(challengeId.slice(4).split('.')[0], 'base64url').toString()).includes(deriveServerTotpSecret(ADMIN_EMAIL)), false, 'segredo nao pode ir dentro do challengeId');
    const ok = await router.dispatch({ method: 'POST', path: '/api/auth/setup-totp', query: { ...HTTP }, body: { email: ADMIN_EMAIL, challengeId } });
    assert.equal(ok.status, 200);
  });
});

describe('Contencao: verify-mfa exige o desafio da senha', () => {
  it('codigo TOTP valido sem challengeId (sem senha) => 401', async () => {
    const { computeRfc6238Totp } = await import('../src/app/lib/auth');
    const router = new CrmApiRouter(createInMemoryRepository());
    const res = await router.dispatch({
      method: 'POST',
      path: '/api/auth/verify-mfa',
      query: { ...HTTP },
      body: { email: ADMIN_EMAIL, code: computeRfc6238Totp(deriveServerTotpSecret(ADMIN_EMAIL)).code },
    });
    assert.equal(res.status, 401);
  });
});
