// ============================================================================
// STI-hub - API da tela inicial padrao (homeScreen no IAM)
//   GET/PATCH /api/me/preferences e PATCH /api/iam/users/:id/home-screen
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signStiHubSessionToken, StiHubSignedSessionClaims } from '../src/app/lib/auth';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';
import { unsealIamRecord } from '../src/db/iam-security';
import { evaluateStiHubRouteProtection } from '../src/middleware';

const HTTP = { _fromHttpBridge: '1' };

function token(overrides: Partial<StiHubSignedSessionClaims> = {}): string {
  return signStiHubSessionToken({
    uid: 'usr-seta-01',
    email: 'marcelo.mira@setatelecom.com.br',
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

const SELLER = {
  uid: 'usr-seta-03',
  email: 'marialuiza@setatelecom.com.br',
  name: 'Maria Luiza',
  roleId: 'VENDEDOR_SALES',
  scope: 'PROPRIOS',
  enabledModules: ['CRM', 'CHAMADOS'] as StiHubSignedSessionClaims['enabledModules'],
  moduleAccess: { crm: true, erp: false, chamados: true },
};

function assertNoSecrets(body: unknown) {
  const json = JSON.stringify(body);
  for (const k of ['"totpSecret"', '"passwordHash"', '"totpSecretFormatted"', '"currentTotpCode"']) {
    assert.equal(json.includes(k), false, `resposta nao pode conter ${k}`);
  }
}

describe('API homeScreen - autenticacao', () => {
  it('sem sessao => 401 no router (GET/PATCH preferences e PATCH admin)', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    for (const [m, p] of [
      ['GET', '/api/me/preferences'],
      ['PATCH', '/api/me/preferences'],
      ['PATCH', '/api/iam/users/usr-seta-03/home-screen'],
    ]) {
      const res = await router.dispatch({ method: m, path: p, query: { ...HTTP }, body: { homeScreen: 'ERP_CONTRACTS' } });
      assert.equal(res.status, 401, `${m} ${p}`);
    }
    // Chamada interna sem token tambem nao passa.
    const internal = await router.dispatch({ method: 'GET', path: '/api/me/preferences', query: {} });
    assert.equal(internal.status, 401);
  });

  it('sessao sem MFA verificado => 401', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    const res = await router.dispatch({
      method: 'GET',
      path: '/api/me/preferences',
      query: { ...HTTP, _sessionToken: token({ mfaVerified: false }) },
    });
    assert.equal(res.status, 401);
  });

  it('middleware: rotas novas exigem sessao (401 sem cookie)', () => {
    for (const [p, m] of [
      ['/api/me/preferences', 'GET'],
      ['/api/me/preferences', 'PATCH'],
      ['/api/iam/users/x/home-screen', 'PATCH'],
    ]) {
      const d = evaluateStiHubRouteProtection({ pathname: p, method: m, sessionToken: null });
      assert.equal(d.allowed, false, `${m} ${p}`);
      assert.equal(d.statusCode, 401, `${m} ${p}`);
    }
  });
});

describe('API homeScreen - /api/me/preferences', () => {
  it('GET devolve a preferencia e a tela efetiva, sem segredos', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    const res = await router.dispatch({ method: 'GET', path: '/api/me/preferences', query: { ...HTTP, _sessionToken: token() } });
    assert.equal(res.status, 200);
    const data = (res.body as { data: Record<string, unknown> }).data;
    assert.equal(data.homeScreen, null);
    assert.equal(data.effectiveHomeScreen, 'CRM_OVERVIEW');
    assertNoSecrets(res.body);
  });

  it('PATCH salva somente homeScreen, preserva o restante do registro e sela o campo', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const before = JSON.parse(JSON.stringify(repo.findRbacUserRecord('usr-seta-01', 'marcelo.mira@setatelecom.com.br')));
    const res = await router.dispatch({
      method: 'PATCH',
      path: '/api/me/preferences',
      query: { ...HTTP, _sessionToken: token() },
      body: { homeScreen: 'ERP_CONTRACTS' },
    });
    assert.equal(res.status, 200);
    const data = (res.body as { data: { homeScreen: string; effectiveHomeScreen: string; user: Record<string, unknown> } }).data;
    assert.equal(data.homeScreen, 'ERP_CONTRACTS');
    assert.equal(data.effectiveHomeScreen, 'ERP_CONTRACTS');
    assertNoSecrets(res.body);
    const after = repo.findRbacUserRecord('usr-seta-01', 'marcelo.mira@setatelecom.com.br') as unknown as Record<string, unknown>;
    assert.equal(after.homeScreen, 'ERP_CONTRACTS');
    for (const k of ['name', 'email', 'roleId', 'scope', 'enabledModules', 'moduleAccess', 'crmPermissions', 'erpPermissions', 'passwordHash']) {
      assert.deepEqual(after[k], before[k], `campo ${k} preservado`);
    }
    const sealed = unsealIamRecord(data.user.iamSeal);
    assert.ok(sealed, 'resposta traz o registro selado');
    assert.equal(sealed!.user.homeScreen, 'ERP_CONTRACTS');
    const log = repo.listSecurityAuditLogs(5).logs.find((l: { action: string }) => l.action === 'IAM_USER_HOME_SCREEN_UPDATED');
    assert.ok(log, 'auditoria registrada');
    assert.match(log!.details, /marcelo\.mira@setatelecom\.com\.br/);
  });

  it('PATCH com chave extra => 400', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    const res = await router.dispatch({
      method: 'PATCH',
      path: '/api/me/preferences',
      query: { ...HTTP, _sessionToken: token() },
      body: { homeScreen: 'CRM_DEALS', roleId: 'SUPER_ADMIN' },
    });
    assert.equal(res.status, 400);
    assert.equal((res.body as { code: string }).code, 'HOME_SCREEN_EXTRA_KEYS');
  });

  it('PATCH com tela fora da allowlist, URL ou caminho => 400', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    for (const bad of ['https://evil.example', '//evil.example', '/proposta/abc', 'crm_overview', 'ADMIN_RBAC', 42, '']) {
      const res = await router.dispatch({
        method: 'PATCH',
        path: '/api/me/preferences',
        query: { ...HTTP, _sessionToken: token() },
        body: { homeScreen: bad },
      });
      assert.equal(res.status, 400, `valor ${String(bad)}`);
    }
    const missing = await router.dispatch({
      method: 'PATCH',
      path: '/api/me/preferences',
      query: { ...HTTP, _sessionToken: token() },
      body: {},
    });
    assert.equal(missing.status, 400);
  });

  it('PATCH de tela de sistema sem acesso => 400; null limpa a preferencia', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const t = token(SELLER);
    const forbidden = await router.dispatch({
      method: 'PATCH',
      path: '/api/me/preferences',
      query: { ...HTTP, _sessionToken: t },
      body: { homeScreen: 'ERP_PROPOSALS' },
    });
    assert.equal(forbidden.status, 400);
    assert.equal((forbidden.body as { code: string }).code, 'HOME_SCREEN_MODULE_FORBIDDEN');
    const ok = await router.dispatch({
      method: 'PATCH',
      path: '/api/me/preferences',
      query: { ...HTTP, _sessionToken: t },
      body: { homeScreen: 'CHAMADOS_QUEUE' },
    });
    assert.equal(ok.status, 200);
    const cleared = await router.dispatch({
      method: 'PATCH',
      path: '/api/me/preferences',
      query: { ...HTTP, _sessionToken: t },
      body: { homeScreen: null },
    });
    assert.equal(cleared.status, 200);
    assert.equal((cleared.body as { data: { homeScreen: unknown } }).data.homeScreen, null);
  });

  it('tela salva de sistema que o usuario perdeu => efetiva cai no primeiro permitido', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    repo.setUserHomeScreen('usr-seta-03', 'ERP_CONTRACTS');
    const res = await router.dispatch({ method: 'GET', path: '/api/me/preferences', query: { ...HTTP, _sessionToken: token(SELLER) } });
    assert.equal(res.status, 200);
    const data = (res.body as { data: { homeScreen: string; effectiveHomeScreen: string } }).data;
    assert.equal(data.homeScreen, 'ERP_CONTRACTS');
    assert.equal(data.effectiveHomeScreen, 'CRM_OVERVIEW');
  });

  it('o usuario so altera a si mesmo: userId no corpo e recusado', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    const res = await router.dispatch({
      method: 'PATCH',
      path: '/api/me/preferences',
      query: { ...HTTP, _sessionToken: token(SELLER) },
      body: { homeScreen: 'CRM_DEALS', userId: 'usr-seta-01' },
    });
    assert.equal(res.status, 400);
  });
});

describe('API homeScreen - PATCH /api/iam/users/:id/home-screen (admin)', () => {
  it('nao-admin => 403 e tentativa auditada', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const res = await router.dispatch({
      method: 'PATCH',
      path: '/api/iam/users/usr-seta-01/home-screen',
      query: { ...HTTP, _sessionToken: token(SELLER) },
      body: { homeScreen: 'CRM_DEALS' },
    });
    assert.equal(res.status, 403);
    assert.equal((repo.findRbacUserRecord('usr-seta-01', '') as { homeScreen?: string }).homeScreen, undefined);
    assert.ok(repo.listSecurityAuditLogs(5).logs.some((l: { action: string }) => l.action === 'IAM_USER_HOME_SCREEN_FORBIDDEN'));
  });

  it('SUPER_ADMIN define a tela de outro usuario, validada contra os modulos do alvo', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    // Garante os modulos do alvo (CRM + Chamados) no registro.
    await router.dispatch({ method: 'GET', path: '/api/me/preferences', query: { ...HTTP, _sessionToken: token(SELLER) } });
    const admin = token();
    const forbidden = await router.dispatch({
      method: 'PATCH',
      path: '/api/iam/users/usr-seta-03/home-screen',
      query: { ...HTTP, _sessionToken: admin },
      body: { homeScreen: 'ERP_CONTRACTS' },
    });
    assert.equal(forbidden.status, 400);
    const extra = await router.dispatch({
      method: 'PATCH',
      path: '/api/iam/users/usr-seta-03/home-screen',
      query: { ...HTTP, _sessionToken: admin },
      body: { homeScreen: 'CRM_DEALS', enabledModules: ['ERP'] },
    });
    assert.equal(extra.status, 400);
    const ok = await router.dispatch({
      method: 'PATCH',
      path: '/api/iam/users/usr-seta-03/home-screen',
      query: { ...HTTP, _sessionToken: admin },
      body: { homeScreen: 'CHAMADOS_QUEUE' },
    });
    assert.equal(ok.status, 200);
    assertNoSecrets(ok.body);
    const target = repo.findRbacUserRecord('usr-seta-03', '') as unknown as Record<string, unknown>;
    assert.equal(target.homeScreen, 'CHAMADOS_QUEUE');
    assert.equal(target.roleId, 'VENDEDOR_SALES');
    const log = repo.listSecurityAuditLogs(5).logs.find((l: { action: string }) => l.action === 'IAM_USER_HOME_SCREEN_UPDATED');
    assert.ok(log);
    assert.match(log!.details, /marcelo\.mira@setatelecom\.com\.br alterou a tela inicial padrão de marialuiza@setatelecom\.com\.br/);
  });

  it('usuario-alvo inexistente => 404', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    const res = await router.dispatch({
      method: 'PATCH',
      path: '/api/iam/users/usr-nao-existe/home-screen',
      query: { ...HTTP, _sessionToken: token() },
      body: { homeScreen: 'CRM_DEALS' },
    });
    assert.equal(res.status, 404);
  });
});
