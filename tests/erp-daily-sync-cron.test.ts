// ============================================================================
// STI-hub — CISO 15/11/2026: o Vercel Cron (GET /api/erp/daily-sync) executa e GRAVA no banco
// do mesmo jeito que o botao Sincronizar (POST), so com Authorization: Bearer <CRON_SECRET>
// (SHA-256 + timingSafeEqual, fail-closed). GET com cookie de sessao nunca grava (anti-CSRF).
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { middleware } from '../src/middleware';
import { forwardToCrmRouter } from '../src/app/api/_bridge';
import { CrmApiRouter, isAuthorizedDailySyncCron, shouldPersistAfterDispatch } from '../src/api/router';
import { isValidCronBearer, resolveCronSecret } from '../src/app/lib/cron-auth';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository } from './helpers/legacy-proposal-fixtures';

const URL_CRON = 'https://sti-hub.vercel.app/api/erp/daily-sync';
const SECRET = 'cron-secret-de-teste-com-32-caracteres-xyz';
const HTTP = { _fromHttpBridge: '1' };
const adminToken = () =>
  signStiHubSessionToken({
    uid: 'usr-seta-01', email: 'marcelo.mira@setatelecom.com.br', name: 'Teste', roleId: 'SUPER_ADMIN', scope: 'TODOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true }, canManageUsersRbac: true,
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000,
  } as Parameters<typeof signStiHubSessionToken>[0]);

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  const restore = () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve().then(fn).finally(restore);
}

/** Router com repositorio em memoria e gravacao no Postgres substituida por um contador. */
function routerWithPersistSpy() {
  const repo = createInMemoryRepository();
  const router = new CrmApiRouter(repo);
  const spy = { calls: 0 };
  const r = router as unknown as { canPersistToPostgres: () => boolean; persistStateToPostgres: () => Promise<null> };
  r.canPersistToPostgres = () => true;
  r.persistStateToPostgres = async () => {
    spy.calls++;
    return null;
  };
  return { repo, router, spy };
}

describe('CISO 15/11: cron-auth (SHA-256 + timingSafeEqual, fail-closed)', () => {
  it('so aceita "Bearer <CRON_SECRET>" exato; sem segredo ou segredo curto => nada autoriza', () => {
    assert.equal(isValidCronBearer(`Bearer ${SECRET}`, SECRET), true);
    assert.equal(isValidCronBearer(null, SECRET), false);
    assert.equal(isValidCronBearer('', SECRET), false);
    assert.equal(isValidCronBearer('Bearer errado', SECRET), false);
    assert.equal(isValidCronBearer(SECRET, SECRET), false);
    assert.equal(isValidCronBearer(`Bearer ${SECRET} `, SECRET), false);
    assert.equal(isValidCronBearer('Bearer ', null), false);
    assert.equal(resolveCronSecret({ CRON_SECRET: undefined } as NodeJS.ProcessEnv), null);
    assert.equal(resolveCronSecret({ CRON_SECRET: 'curto' } as NodeJS.ProcessEnv), null);
    assert.equal(resolveCronSecret({ CRON_SECRET: `  ${SECRET}  ` } as NodeJS.ProcessEnv), SECRET);
  });
});

describe('CISO 15/11: GET /api/erp/daily-sync do Vercel Cron', () => {
  it('sem header => 401 (middleware e bridge), nada executa', async () => {
    await withEnv({ CRON_SECRET: SECRET }, async () => {
      assert.equal(middleware(new NextRequest(URL_CRON)).status, 401);
      assert.equal((await forwardToCrmRouter(new NextRequest(URL_CRON))).status, 401);
    });
  });

  it('secret errado => 401 (middleware e bridge)', async () => {
    await withEnv({ CRON_SECRET: SECRET }, async () => {
      const h = { headers: { authorization: 'Bearer cron-secret-de-teste-com-32-caracteres-xyZ' } };
      assert.equal(middleware(new NextRequest(URL_CRON, h)).status, 401);
      assert.equal((await forwardToCrmRouter(new NextRequest(URL_CRON, h))).status, 401);
    });
  });

  it('CRON_SECRET ausente em producao => fail-closed (401), mesmo com Bearer qualquer ou vazio', async () => {
    await withEnv({ CRON_SECRET: undefined, VERCEL_ENV: 'production' }, async () => {
      for (const auth of ['Bearer ', 'Bearer undefined', `Bearer ${SECRET}`]) {
        const h = { headers: { authorization: auth } };
        const mw = middleware(new NextRequest(URL_CRON, h));
        assert.equal(mw.status, 401, auth);
        assert.notEqual(mw.headers.get('x-stihub-auth-guard'), 'cron-secret-allowed');
        assert.equal((await forwardToCrmRouter(new NextRequest(URL_CRON, h))).status, 401, auth);
      }
    });
  });

  it('secret correto => middleware libera, a sync executa e GRAVA (persistStateToPostgres), com auditoria e resposta so com contagens', async () => {
    await withEnv({ CRON_SECRET: SECRET }, async () => {
      const ok = middleware(new NextRequest(URL_CRON, { headers: { authorization: `Bearer ${SECRET}` } }));
      assert.equal(ok.headers.get('x-stihub-auth-guard'), 'cron-secret-allowed');
    });
    const { repo, router, spy } = routerWithPersistSpy();
    const res = await router.dispatch({ method: 'GET', path: '/api/erp/daily-sync', query: { ...HTTP, _cronAuthorized: '1' } });
    assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 200));
    assert.equal(spy.calls, 1, 'cron grava no banco');
    const data = (res.body as { data: Record<string, unknown> }).data;
    assert.deepEqual(Object.keys(data).sort(), ['counts', 'liveConnected', 'syncedAt']);
    for (const v of Object.values(data.counts as Record<string, unknown>)) assert.equal(typeof v, 'number');
    assert.ok(repo.listSecurityAuditLogs(10000).logs.some((l) => l.action === 'ERP_DAILY_SYNC_CRON' && l.actorEmail === 'vercel-cron@sti-hub.local'));
  });

  it('botao Sincronizar (POST admin) continua gravando do mesmo jeito', async () => {
    const { router, spy } = routerWithPersistSpy();
    const res = await router.dispatch({ method: 'POST', path: '/api/erp/daily-sync', query: { ...HTTP, _sessionToken: adminToken() }, body: { mode: 'DAILY_INCREMENTAL_SYNC' } });
    assert.equal(res.status, 200);
    assert.equal(spy.calls, 1);
  });

  it('GET com cookie de sessao (admin) mas sem Bearer => nao grava (com ou sem ?trigger=1) e nao vira cron', async () => {
    const { repo, router, spy } = routerWithPersistSpy();
    for (const q of [{}, { trigger: '1' }]) {
      const r = await router.dispatch({ method: 'GET', path: '/api/erp/daily-sync', query: { ...HTTP, _sessionToken: adminToken(), ...q } });
      assert.equal(r.status, 200);
      const data = (r.body as { data: Record<string, unknown> }).data;
      assert.ok('scheduleCron' in data, 'resposta normal da sessao, nao a do cron');
    }
    assert.equal(spy.calls, 0, 'GET com cookie nunca grava');
    assert.ok(!repo.listSecurityAuditLogs(10000).logs.some((l) => l.action === 'ERP_DAILY_SYNC_CRON'));

    // Pelo bridge real: cookie de sessao sem Bearer nao vira cron.
    await withEnv({ CRON_SECRET: SECRET }, async () => {
      const req = new NextRequest(URL_CRON, { headers: { cookie: `stihub_session=${adminToken()}` } });
      const res = await forwardToCrmRouter(req);
      const body = (await res.json()) as { data?: Record<string, unknown> };
      assert.ok(!body.data || 'scheduleCron' in body.data || !('counts' in body.data && Object.keys(body.data).length === 3), 'resposta nao e a do cron');
    });
  });

  it('_cronAuthorized forjado (sem bridge, POST, outra rota) nao autoriza nem grava via GET', () => {
    assert.equal(isAuthorizedDailySyncCron('GET', '/api/erp/daily-sync', { _cronAuthorized: '1' }), false);
    assert.equal(isAuthorizedDailySyncCron('GET', '/api/erp/daily-sync', { ...HTTP }), false);
    assert.equal(isAuthorizedDailySyncCron('GET', '/api/erp/overview', { ...HTTP, _cronAuthorized: '1' }), false);
    assert.equal(shouldPersistAfterDispatch('GET', '/api/erp/daily-sync', { ...HTTP, _sessionToken: 'x' }, 200), false);
    assert.equal(shouldPersistAfterDispatch('GET', '/api/erp/daily-sync', { ...HTTP, _cronAuthorized: '1' }, 200), true);
    assert.equal(shouldPersistAfterDispatch('GET', '/api/erp/daily-sync', { ...HTTP, _cronAuthorized: '1' }, 401), false);
    assert.equal(shouldPersistAfterDispatch('POST', '/api/erp/daily-sync', {}, 200), true);
    assert.equal(shouldPersistAfterDispatch('POST', '/api/erp/daily-sync', {}, 403), false);
  });
});
