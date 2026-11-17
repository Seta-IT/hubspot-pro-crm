// ============================================================================
// STI-hub — CISO 17/11/2026: GET /api/tickets/email-intake/poll liberado SO para o Vercel Cron,
// no mesmo padrao do /api/erp/daily-sync: Authorization: Bearer <CRON_SECRET> (SHA-256 +
// timingSafeEqual no bridge, comparacao constante no middleware), fail-closed sem CRON_SECRET
// ou com menos de 16 caracteres. Nenhuma outra rota de chamados fica acessivel pelo Bearer.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { middleware } from '../src/middleware';
import { forwardToCrmRouter } from '../src/app/api/_bridge';
import { CrmApiRouter, isAuthorizedSetaDeskEmailPollCron, shouldPersistAfterDispatch } from '../src/api/router';
import { isSetaDeskEmailDirectRoute } from '../src/modules/setadesk-email/routes';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository } from './helpers/legacy-proposal-fixtures';

const BASE = 'https://sti-hub.vercel.app';
const URL_POLL = `${BASE}/api/tickets/email-intake/poll`;
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

const bearer = (v: string) => ({ headers: { authorization: v } });
const OFF = { CRON_SECRET: SECRET, SETADESK_EMAIL_INTAKE_ENABLED: undefined };

describe('CISO 17/11: cron da entrada de e-mail (GET /api/tickets/email-intake/poll)', () => {
  it('sem header => 401 (middleware e bridge)', async () => {
    await withEnv(OFF, async () => {
      assert.equal(middleware(new NextRequest(URL_POLL)).status, 401);
      assert.equal((await forwardToCrmRouter(new NextRequest(URL_POLL))).status, 401);
    });
  });

  it('Bearer errado => 401 (middleware e bridge)', async () => {
    await withEnv(OFF, async () => {
      for (const auth of ['Bearer cron-secret-de-teste-com-32-caracteres-xyZ', SECRET, 'Bearer ', `bearer ${SECRET}`]) {
        assert.equal(middleware(new NextRequest(URL_POLL, bearer(auth))).status, 401, auth);
        assert.equal((await forwardToCrmRouter(new NextRequest(URL_POLL, bearer(auth)))).status, 401, auth);
      }
    });
  });

  it('CRON_SECRET ausente ou curto => fail-closed (401) mesmo com Bearer', async () => {
    for (const secret of [undefined, 'curto-15-chars!']) {
      await withEnv({ CRON_SECRET: secret, VERCEL_ENV: 'production' }, async () => {
        for (const auth of ['Bearer ', 'Bearer undefined', `Bearer ${secret ?? SECRET}`]) {
          const mw = middleware(new NextRequest(URL_POLL, bearer(auth)));
          assert.equal(mw.status, 401, auth);
          assert.notEqual(mw.headers.get('x-stihub-auth-guard'), 'cron-secret-allowed');
          assert.equal((await forwardToCrmRouter(new NextRequest(URL_POLL, bearer(auth)))).status, 401, auth);
        }
      });
    }
  });

  it('Bearer correto => middleware libera e o bridge executa (flag desligada => 200 { enabled: false })', async () => {
    await withEnv(OFF, async () => {
      const mw = middleware(new NextRequest(URL_POLL, bearer(`Bearer ${SECRET}`)));
      assert.equal(mw.headers.get('x-stihub-auth-guard'), 'cron-secret-allowed');
      const res = await forwardToCrmRouter(new NextRequest(URL_POLL, bearer(`Bearer ${SECRET}`)));
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { data: { enabled: false } });
    });
  });

  it('Bearer correto com a flag ligada passa da autenticacao (sem banco => 503 EMAIL_INTAKE_NO_DATABASE)', async () => {
    await withEnv({ CRON_SECRET: SECRET, SETADESK_EMAIL_INTAKE_ENABLED: 'true' }, async () => {
      const router = new CrmApiRouter(createInMemoryRepository());
      const r = await router.dispatch({ method: 'GET', path: '/api/tickets/email-intake/poll', query: { ...HTTP, _cronAuthorized: '1' } });
      assert.equal(r.status, 503);
      assert.equal((r.body as { code: string }).code, 'EMAIL_INTAKE_NO_DATABASE');
    });
  });

  it('o Bearer do cron NAO abre nenhuma outra rota de chamados (nem POST no poll)', async () => {
    await withEnv(OFF, async () => {
      const others: Array<[string, string]> = [
        ['GET', '/api/tickets'],
        ['GET', '/api/tickets/TEC-1'],
        ['GET', '/api/tickets/email-intake/poll/x'],
        ['GET', '/api/tickets/email-intake'],
        ['POST', '/api/tickets/email-intake/poll'],
        ['POST', '/api/tickets/TEC-1/mark-viewed'],
        ['POST', '/api/tickets'],
      ];
      for (const [method, path] of others) {
        const init = { method, headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) };
        const mw = middleware(new NextRequest(`${BASE}${path}`, init));
        assert.equal(mw.status, 401, `middleware ${method} ${path}`);
        const br = await forwardToCrmRouter(new NextRequest(`${BASE}${path}`, init));
        assert.equal(br.status, 401, `bridge ${method} ${path}`);
      }
    });
  });

  it('GET com sessao (sem Bearer) nunca dispara a leitura: 405; sem sessao: 401', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    const withSession = await router.dispatch({ method: 'GET', path: '/api/tickets/email-intake/poll', query: { ...HTTP, _sessionToken: adminToken() } });
    assert.equal(withSession.status, 405);
    const anon = await router.dispatch({ method: 'GET', path: '/api/tickets/email-intake/poll', query: { ...HTTP } });
    assert.equal(anon.status, 401);
  });

  it('POST manual continua exigindo admin/coordenador; _cronAuthorized forjado nao vale para POST', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    const forged = await router.dispatch({ method: 'POST', path: '/api/tickets/email-intake/poll', query: { ...HTTP, _cronAuthorized: '1' }, body: {} });
    assert.equal(forged.status, 401);
    await withEnv({ SETADESK_EMAIL_INTAKE_ENABLED: undefined }, async () => {
      const admin = await router.dispatch({ method: 'POST', path: '/api/tickets/email-intake/poll', query: { ...HTTP, _sessionToken: adminToken() }, body: {} });
      assert.equal(admin.status, 409, 'admin autenticado chega na checagem da flag');
    });
  });

  it('flag _cronAuthorized so vale no GET exato vindo do bridge; a rota nunca regrava o snapshot', () => {
    assert.equal(isAuthorizedSetaDeskEmailPollCron('GET', '/api/tickets/email-intake/poll', { ...HTTP, _cronAuthorized: '1' }), true);
    assert.equal(isAuthorizedSetaDeskEmailPollCron('GET', '/api/tickets/email-intake/poll', { _cronAuthorized: '1' }), false);
    assert.equal(isAuthorizedSetaDeskEmailPollCron('GET', '/api/tickets/email-intake/poll', { ...HTTP }), false);
    assert.equal(isAuthorizedSetaDeskEmailPollCron('POST', '/api/tickets/email-intake/poll', { ...HTTP, _cronAuthorized: '1' }), false);
    assert.equal(isAuthorizedSetaDeskEmailPollCron('GET', '/api/tickets', { ...HTTP, _cronAuthorized: '1' }), false);
    assert.equal(shouldPersistAfterDispatch('GET', '/api/tickets/email-intake/poll', { ...HTTP, _cronAuthorized: '1' }, 200), false);
    assert.equal(isSetaDeskEmailDirectRoute('GET', '/api/tickets/email-intake/poll'), true);
    assert.equal(isSetaDeskEmailDirectRoute('GET', '/api/tickets'), false);
  });

  it('vercel.json nao agenda o poll enquanto o projeto estiver no plano Hobby (cron so diario)', () => {
    const cfg = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: Array<{ path: string; schedule: string }> };
    const c = cfg.crons.find((x) => x.path === '/api/tickets/email-intake/poll');
    assert.equal(c, undefined);
  });
});
