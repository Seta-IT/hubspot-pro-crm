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

// ----------------------------------------------------------------------------
// Ajustes do CISO: transporte sem escalada e "selo mais recente vence"
// ----------------------------------------------------------------------------
import { mergeIamCacheEntries } from '../src/app/lib/iam-seal-cache';

const tick = () => new Promise((r) => setTimeout(r, 5));

function sealOf(res: { body: unknown }): string {
  const seal = (res.body as { data: { user: { iamSeal?: string } } }).data.user.iamSeal;
  assert.ok(seal, 'resposta deve trazer o selo');
  return seal as string;
}

describe('API homeScreen - transporte nao permite escalada', () => {
  it('usuario comum com iamUsersOverride cru (sem selo) como SUPER_ADMIN: papel e permissoes nao mudam', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const t = token(SELLER);
    await router.dispatch({ method: 'GET', path: '/api/me/preferences', query: { ...HTTP, _sessionToken: t } });
    const before = JSON.parse(JSON.stringify(repo.findRbacUserRecord('usr-seta-03', SELLER.email)));
    assert.notEqual(before.roleId, 'SUPER_ADMIN');
    const res = await router.dispatch({
      method: 'PATCH',
      path: '/api/me/preferences',
      query: { ...HTTP, _sessionToken: t },
      body: {
        homeScreen: 'CRM_DEALS',
        iamUsersOverride: [
          {
            id: 'usr-seta-03',
            email: SELLER.email,
            roleId: 'SUPER_ADMIN',
            scope: 'TODOS',
            enabledModules: ['CRM', 'ERP', 'CHAMADOS'],
            moduleAccess: { crm: true, erp: true, chamados: true },
            crmRole: 'CRM_ADMIN',
            erpRole: 'ERP_ADMIN',
            actionGuardsOverride: { canManageUsersRbac: true },
            homeScreen: 'ERP_CONTRACTS',
          },
        ],
      },
    });
    assert.equal(res.status, 200);
    const after = repo.findRbacUserRecord('usr-seta-03', SELLER.email) as unknown as Record<string, unknown>;
    assert.equal(after.homeScreen, 'CRM_DEALS', 'somente o homeScreen do corpo e gravado');
    for (const k of ['roleId', 'scope', 'enabledModules', 'moduleAccess', 'crmRole', 'erpRole', 'crmPermissions', 'erpPermissions', 'actionGuardsOverride']) {
      assert.deepEqual(after[k], before[k], `registro: ${k} inalterado`);
    }
    const sealed = unsealIamRecord(sealOf(res))!;
    assert.ok(sealed);
    assert.equal(sealed.user.roleId, before.roleId);
    assert.deepEqual(sealed.user.enabledModules, before.enabledModules);
    assert.deepEqual(sealed.user.moduleAccess, before.moduleAccess);
    assert.deepEqual(sealed.user.crmPermissions, before.crmPermissions);
    assert.deepEqual(sealed.user.erpPermissions, before.erpPermissions);
    assert.deepEqual((sealed.user as Record<string, unknown>).actionGuardsOverride, before.actionGuardsOverride);
    const session = repo.resolveSessionFromToken(t);
    assert.equal(session.effectiveActionGuards.canManageUsersRbac, false);
  });
});

describe('API homeScreen - o selo mais recente vence', () => {
  async function scenario() {
    const admin = token();
    const yTok = token(SELLER);
    // Instancia A: Y define a propria tela (selo antigo, versao v1)
    const repoA = createInMemoryRepository();
    const routerA = new CrmApiRouter(repoA);
    const r1 = await routerA.dispatch({
      method: 'PATCH',
      path: '/api/me/preferences',
      query: { ...HTTP, _sessionToken: yTok },
      body: { homeScreen: 'CRM_CONTACTS' },
    });
    assert.equal(r1.status, 200);
    const oldSeal = sealOf(r1);
    await tick();
    // Admin define a tela de Y (selo novo, versao v2)
    const r2 = await routerA.dispatch({
      method: 'PATCH',
      path: '/api/iam/users/usr-seta-03/home-screen',
      query: { ...HTTP, _sessionToken: admin },
      body: { homeScreen: 'CHAMADOS_QUEUE' },
    });
    assert.equal(r2.status, 200);
    const newSeal = sealOf(r2);
    return { admin, yTok, repoA, routerA, oldSeal, newSeal };
  }

  it('selo carrega a versao do homeScreen', async () => {
    const { oldSeal, newSeal } = await scenario();
    const o = unsealIamRecord(oldSeal)!.user as Record<string, unknown>;
    const n = unsealIamRecord(newSeal)!.user as Record<string, unknown>;
    assert.ok(Date.parse(String(n.homeScreenUpdatedAt)) > Date.parse(String(o.homeScreenUpdatedAt)));
  });

  it('(a) admin define a tela de Y e o navegador de Y envia o selo antigo: a tela do admin e mantida', async () => {
    const { yTok, routerA, oldSeal } = await scenario();
    // Mesma instancia
    const g = await routerA.dispatch({
      method: 'GET',
      path: '/api/me/preferences',
      query: { ...HTTP, _sessionToken: yTok },
      body: { iamUsersOverride: [{ id: 'usr-seta-03', email: SELLER.email, iamSeal: oldSeal }] },
    });
    assert.equal((g.body as { data: { homeScreen: string } }).data.homeScreen, 'CHAMADOS_QUEUE');
  });

  it('(a) em outra instancia: selo antigo re-selado depois do novo nao sobrescreve a tela', async () => {
    const { yTok, oldSeal, newSeal } = await scenario();
    // Instancia B (fria) so conhece o selo antigo e o re-sela mais tarde (sealedAt mais novo, dado antigo)
    const repoB = createInMemoryRepository();
    const routerB = new CrmApiRouter(repoB);
    await tick();
    const gB = await routerB.dispatch({
      method: 'GET',
      path: '/api/me/preferences',
      query: { ...HTTP, _sessionToken: yTok },
      body: { iamUsersOverride: [{ id: 'usr-seta-03', email: SELLER.email, iamSeal: oldSeal }] },
    });
    assert.equal((gB.body as { data: { homeScreen: string } }).data.homeScreen, 'CRM_CONTACTS');
    const staleResealed = sealOf(gB);
    assert.ok(unsealIamRecord(staleResealed)!.sealedAt > unsealIamRecord(newSeal)!.sealedAt);
    // Instancia C (fria) recebe o selo novo e depois o antigo re-selado
    const repoC = createInMemoryRepository();
    repoC.applySealedIamOverrides([{ iamSeal: newSeal }]);
    repoC.applySealedIamOverrides([{ iamSeal: staleResealed }]);
    assert.equal(repoC.findRbacUserRecord('usr-seta-03', '')!.homeScreen, 'CHAMADOS_QUEUE');
    // Ordem inversa na mesma requisicao tambem preserva a mais nova
    const repoD = createInMemoryRepository();
    repoD.applySealedIamOverrides([{ iamSeal: staleResealed }, { iamSeal: newSeal }]);
    assert.equal(repoD.findRbacUserRecord('usr-seta-03', '')!.homeScreen, 'CHAMADOS_QUEUE');
  });

  it('(b) o selo novo substitui o antigo', async () => {
    const { oldSeal, newSeal } = await scenario();
    const repoE = createInMemoryRepository();
    repoE.applySealedIamOverrides([{ iamSeal: oldSeal }]);
    assert.equal(repoE.findRbacUserRecord('usr-seta-03', '')!.homeScreen, 'CRM_CONTACTS');
    repoE.applySealedIamOverrides([{ iamSeal: newSeal }]);
    assert.equal(repoE.findRbacUserRecord('usr-seta-03', '')!.homeScreen, 'CHAMADOS_QUEUE');
  });

  it('limpar a tela (null) com selo mais novo tambem prevalece sobre o selo antigo', async () => {
    const { admin, routerA, oldSeal } = await scenario();
    await tick();
    const r = await routerA.dispatch({
      method: 'PATCH',
      path: '/api/iam/users/usr-seta-03/home-screen',
      query: { ...HTTP, _sessionToken: admin },
      body: { homeScreen: null },
    });
    const clearedSeal = sealOf(r);
    const repoF = createInMemoryRepository();
    repoF.applySealedIamOverrides([{ iamSeal: oldSeal }]);
    repoF.applySealedIamOverrides([{ iamSeal: clearedSeal }]);
    assert.equal(repoF.findRbacUserRecord('usr-seta-03', '')!.homeScreen, undefined);
  });

  it('override cru de admin nao grava homeScreen fora da allowlist', async () => {
    const repo = createInMemoryRepository();
    repo.applyIamUsersOverride([{ id: 'usr-seta-03', email: SELLER.email, homeScreen: 'https://evil.example' }]);
    assert.equal(repo.findRbacUserRecord('usr-seta-03', '')!.homeScreen, undefined);
  });
});

describe('Cache IAM do navegador - o selo mais recente vence', () => {
  const older = { id: 'u1', email: 'u1@x', iamSeal: 'SEAL1.old', homeScreen: 'CRM_DEALS', homeScreenUpdatedAt: '2026-10-29T10:00:00.000Z' };
  const newer = { id: 'u1', email: 'u1@x', iamSeal: 'SEAL1.new', homeScreen: 'ERP_CONTRACTS', homeScreenUpdatedAt: '2026-10-29T12:00:00.000Z' };
  const other = { id: 'u2', email: 'u2@x', iamSeal: 'SEAL1.u2' };

  it('(b) registro com homeScreen mais novo substitui o antigo', () => {
    const { entries, result } = mergeIamCacheEntries([older, other], newer);
    assert.equal(result, 'REPLACED');
    assert.deepEqual(entries.filter((e) => e.id === 'u1').map((e) => e.iamSeal), ['SEAL1.new']);
    assert.ok(entries.some((e) => e.id === 'u2'));
  });

  it('(a) registro com homeScreen mais antigo nao apaga o mais novo: ficam os dois, o mais novo primeiro', () => {
    const { entries, result } = mergeIamCacheEntries([newer, other], { ...older, iamSeal: 'SEAL1.stale' });
    assert.equal(result, 'KEPT_NEWER');
    assert.deepEqual(entries.filter((e) => e.id === 'u1').map((e) => e.iamSeal), ['SEAL1.new', 'SEAL1.stale']);
  });

  it('nunca guarda senha ou segredo TOTP', () => {
    const { entries } = mergeIamCacheEntries([], { ...newer, password: 'x', passwordHash: 'h', totpSecret: 's' });
    assert.equal('password' in entries[0], false);
    assert.equal('passwordHash' in entries[0], false);
    assert.equal('totpSecret' in entries[0], false);
  });
});
