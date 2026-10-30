// ============================================================================
// STI-hub — HOTFIX 29/10/2026: escalada de privilegio via aliases /api/rbac/* e
// /api/auth/send-invite. Autorizacao IAM por colecao normalizada (router + middleware).
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { middleware } from '../src/middleware';
import { signStiHubSessionToken, StiHubSignedSessionClaims } from '../src/app/lib/auth';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';
import { claimsMayManageIam, isIamAdminRoute, normalizeApiPathForAuthz } from '../src/app/lib/iam-admin-routes';

const HTTP = { _fromHttpBridge: '1' };
const ADMIN_EMAIL = 'marcelo.mira@setatelecom.com.br';

function session(o: Partial<StiHubSignedSessionClaims> = {}): string {
  return signStiHubSessionToken({
    uid: 'usr-seta-01', email: ADMIN_EMAIL, name: 'Marcelo Lopes Mira', roleId: 'SUPER_ADMIN', scope: 'TODOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now(), exp: Date.now() + 120_000, ...o,
  });
}
const seller = () => session({ uid: 'usr-vend-x', email: 'vend.x@setatelecom.com.br', name: 'Vendedor X', roleId: 'VENDEDOR_SALES', scope: 'PROPRIOS', canManageUsersRbac: false });
const sellerNoClaim = () => session({ uid: 'usr-vend-y', email: 'vend.y@setatelecom.com.br', name: 'Vendedor Y', roleId: 'VENDEDOR_SALES', scope: 'PROPRIOS' });

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const FAMILIES = ['admin', 'rbac'] as const;
const VARIANT_PATHS = [
  '/API/RBAC/users', '/api/Rbac/Users/usr-seta-03', '/api/rbac/users/', '//api//rbac//users',
  '/api/rbac%2Fusers', '/api/rbac%2fusers%2fusr-seta-03', '/api/%72bac/users', '/api/rbac/./users',
  '/api/x/../rbac/users', '/api\\rbac\\users', '/api/rbac/users/usr-seta-02/reset-mfa',
  '/api/rbac/users/usr-seta-02/invite', '/api/rbac/users/usr-seta-02/full-control', '/api/rbac/users/usr-seta-02/delete',
  '/api/rbac/roles/VENDEDOR_SALES', '/api/rbac', '/api/admin/rbac', '/api/admin/security', '/api/admin/settings',
  '/api/admin/audit-logs', '/api/iam/service-accounts', '/api/iam/users/usr-seta-03/home-screen', '/api/auth/send-invite',
  '/API/AUTH/SEND-INVITE/',
];

function bodyFor(method: string, path: string): Record<string, unknown> {
  if (method === 'GET' || method === 'DELETE') return {};
  if (/\/users$/.test(path)) return { email: 'novo.admin@evil.com', name: 'Evil', roleId: 'SUPER_ADMIN', password: 'Evil#12345' };
  return { roleId: 'SUPER_ADMIN', userId: 'usr-seta-02', email: ADMIN_EMAIL };
}

function snapshot(repo: ReturnType<typeof createInMemoryRepository>) {
  return JSON.stringify(repo.getRbacState().users.map((u) => [u.id, u.email, u.roleId, u.active, u.totpConfigured]).sort());
}

describe('HOTFIX IAM: normalizacao de caminho', () => {
  it('pega todas as variantes e nao pega rotas de self-service', () => {
    assert.equal(normalizeApiPathForAuthz('//API//Rbac%2FUsers/'), '/api/rbac/users');
    assert.equal(normalizeApiPathForAuthz('/api/x/../rbac/./users?x=1'), '/api/rbac/users');
    for (const p of [...VARIANT_PATHS, '/api/admin/users', '/api/rbac/users/usr-seta-03']) assert.equal(isIamAdminRoute(p), true, p);
    for (const p of ['/api/me/preferences', '/api/auth/me', '/api/auth/login', '/api/auth/verify-mfa', '/api/contacts', '/api/erp/proposals', '/api/administrativo-x', '/api/bootstrap']) {
      assert.equal(isIamAdminRoute(p), false, p);
    }
    assert.equal(claimsMayManageIam({ roleId: 'SUPER_ADMIN' }), true, 'sessao antiga de SUPER_ADMIN');
    assert.equal(claimsMayManageIam({ roleId: 'SUPER_ADMIN', canManageUsersRbac: false }), false, 'claim assinada vence');
    assert.equal(claimsMayManageIam({ roleId: 'VENDEDOR_SALES' }), false);
  });
});

describe('HOTFIX IAM: router (servidor e autoritativo)', () => {
  it('VENDEDOR => 403 em GET/POST/PUT/PATCH/DELETE nas familias /api/admin e /api/rbac, sem alterar ninguem', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    await router.dispatch({ method: 'GET', path: '/api/contacts', query: { ...HTTP, _sessionToken: seller() } }); // hidrata o vendedor
    const before = snapshot(repo);
    for (const fam of FAMILIES) {
      for (const p of [`/api/${fam}/users`, `/api/${fam}/users/usr-seta-03`, `/api/${fam}/users/usr-seta-02`]) {
        for (const m of METHODS) {
          for (const tok of [seller(), sellerNoClaim()]) {
            const r = await router.dispatch({ method: m, path: p, query: { ...HTTP, _sessionToken: tok }, body: bodyFor(m, p) });
            assert.equal(r.status, 403, `${m} ${p}`);
            assert.equal((r.body as { code?: string }).code, 'IAM_ADMIN_FORBIDDEN', `${m} ${p}`);
          }
        }
      }
    }
    for (const p of VARIANT_PATHS) {
      for (const m of METHODS) {
        const r = await router.dispatch({ method: m, path: p, query: { ...HTTP, _sessionToken: seller() }, body: bodyFor(m, p) });
        assert.equal(r.status, 403, `${m} ${p}`);
      }
    }
    const after = snapshot(repo).replace(/,\["usr-vend-y"[^\]]*\]/, '');
    assert.equal(after.replace(/,\["usr-vend-y"[^\]]*\]/, ''), before.replace(/,\["usr-vend-y"[^\]]*\]/, ''), 'nenhum usuario promovido/criado/apagado');
    assert.equal(repo.findRbacUserRecord('usr-seta-03', '')?.roleId === 'SUPER_ADMIN', false);
    assert.ok(repo.findRbacUserRecord('usr-seta-02', ''), 'usr-seta-02 nao pode ter sido apagado');
    assert.equal(repo.findRbacUserRecord('', 'novo.admin@evil.com'), undefined);
  });

  it('anonimo => 401 em todas as rotas IAM, inclusive /api/auth/send-invite (sem link de convite)', async () => {
    delete process.env.RESEND_API_KEY;
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const before = snapshot(repo);
    for (const p of [...VARIANT_PATHS, '/api/admin/users', '/api/rbac/users', '/api/rbac/users/usr-seta-03']) {
      for (const m of METHODS) {
        const r = await router.dispatch({ method: m, path: p, query: { ...HTTP }, body: bodyFor(m, p) });
        assert.equal(r.status, 401, `${m} ${p}`);
        assert.equal(/invite(Url|Token)|conviteUrl/.test(JSON.stringify(r.body)), false);
      }
    }
    assert.equal(snapshot(repo), before, 'convite anonimo nao pode resetar 2FA nem alterar usuario');
  });

  it('SUPER_ADMIN => 200/201 nas duas familias (GET, POST, PUT, PATCH, DELETE)', async () => {
    for (const fam of FAMILIES) {
      const repo = createInMemoryRepository();
      const router = new CrmApiRouter(repo);
      const t = session();
      const q = { ...HTTP, _sessionToken: t };
      assert.equal((await router.dispatch({ method: 'GET', path: `/api/${fam}/users`, query: q })).status, 200);
      assert.equal((await router.dispatch({ method: 'POST', path: `/api/${fam}/users`, query: q, body: { email: `novo.${fam}@setatelecom.com.br`, name: 'Novo', roleId: 'VENDEDOR_SALES' } })).status, 201);
      assert.equal((await router.dispatch({ method: 'PUT', path: `/api/${fam}/users/usr-seta-03`, query: q, body: { jobTitle: 'Cargo A' } })).status, 200);
      assert.equal((await router.dispatch({ method: 'PATCH', path: `/api/${fam}/users/usr-seta-03`, query: q, body: { jobTitle: 'Cargo B' } })).status, 200);
      assert.equal((await router.dispatch({ method: 'DELETE', path: `/api/${fam}/users/usr-seta-02`, query: q })).status, 200);
    }
  });

  it('self-service /api/me/preferences nao e bloqueado pela regra IAM', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    const r = await router.dispatch({ method: 'GET', path: '/api/me/preferences', query: { ...HTTP, _sessionToken: seller() } });
    assert.notEqual((r.body as { code?: string }).code, 'IAM_ADMIN_FORBIDDEN');
  });
});

describe('HOTFIX IAM: middleware (defesa em profundidade)', () => {
  const req = (p: string, m: string, cookie?: string, extra: Record<string, string> = {}) =>
    new NextRequest(`https://sti-hub.vercel.app${p}`, {
      method: m,
      headers: { ...(cookie ? { cookie: `stihub_session=${cookie}` } : {}), ...extra },
      ...(m === 'GET' || m === 'DELETE' ? {} : { body: '{}' }),
    });

  it('anonimo 401; VENDEDOR 403; SUPER_ADMIN passa (inclusive sessao antiga sem a claim)', () => {
    for (const fam of FAMILIES) {
      for (const p of [`/api/${fam}/users`, `/api/${fam}/users/usr-seta-03`]) {
        for (const m of METHODS) {
          assert.equal(middleware(req(p, m)).status, 401, `anon ${m} ${p}`);
          assert.equal(middleware(req(p, m, seller())).status, 403, `vend ${m} ${p}`);
          assert.equal(middleware(req(p, m, sellerNoClaim())).status, 403, `vend(sem claim) ${m} ${p}`);
          const ok = middleware(req(p, m, session({ canManageUsersRbac: true })));
          assert.notEqual(ok.status, 401); assert.notEqual(ok.status, 403);
          const legacy = middleware(req(p, m, session()));
          assert.notEqual(legacy.status, 403, 'SUPER_ADMIN com sessao emitida antes do hotfix');
        }
      }
    }
    for (const p of ['/api/auth/send-invite', '/API/RBAC/users', '/api/rbac%2Fusers', '//api//rbac//users/', '/api/iam/service-accounts']) {
      assert.equal(middleware(req(p, 'POST')).status, 401, `anon ${p}`);
      assert.equal(middleware(req(p, 'POST', seller())).status, 403, `vend ${p}`);
    }
    // rotas publicas de login continuam publicas
    assert.equal(middleware(req('/api/auth/login', 'POST')).headers.get('x-stihub-auth-guard'), 'public-allowed');
  });

  it('token da conta de servico => 403 nas rotas IAM', () => {
    const tok = `stihub_svc_${crypto.randomBytes(32).toString('base64url')}`;
    const prev = process.env.STI_HUB_SALES_AGENT_TOKEN_SHA256;
    process.env.STI_HUB_SALES_AGENT_TOKEN_SHA256 = crypto.createHash('sha256').update(tok).digest('hex');
    try {
      for (const [p, m] of [['/api/rbac/users', 'GET'], ['/api/rbac/users/usr-seta-03', 'PUT'], ['/api/admin/users', 'GET'], ['/api/auth/send-invite', 'POST']] as const) {
        assert.equal(middleware(req(p, m, undefined, { authorization: `Bearer ${tok}` })).status, 403, `${m} ${p}`);
      }
    } finally {
      if (prev === undefined) delete process.env.STI_HUB_SALES_AGENT_TOKEN_SHA256;
      else process.env.STI_HUB_SALES_AGENT_TOKEN_SHA256 = prev;
    }
  });
});
