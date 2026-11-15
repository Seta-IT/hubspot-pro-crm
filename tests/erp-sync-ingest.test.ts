// ============================================================================
// STI-hub — Chave de servico da sincronizacao ERP (POST /api/v1/erp/sync/run).
// Sem rede e sem Postgres real: store de integracao em memoria (somente teste) e
// runner injetado; um caso usa o CrmApiRouter real com repositorio em memoria.
// ============================================================================
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { middleware } from '../src/middleware';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import { TestOnlyMemoryIntegrationStore } from '../src/modules/integration/store-memory';
import { setIntegrationDepsForTests } from '../src/modules/integration/runtime';
import type { IntegrationHttpRequest } from '../src/modules/integration/http';
import {
  ERP_SYNC_AUDIT_ACTION,
  ERP_SYNC_KEY_ENV,
  ERP_SYNC_KEY_PREVIOUS_ENV,
  ERP_SYNC_RATE_PER_IP_PER_MINUTE,
  ERP_SYNC_RATE_PER_KEY_PER_MINUTE,
  ERP_SYNC_ROUTE,
  erpSyncKeyFingerprint,
  handleErpSyncRun,
  matchErpSyncKey,
  readErpSyncKeyConfig,
  setErpSyncRunnerForTests,
  type ErpSyncDeps,
  type ErpSyncRunner,
} from '../src/modules/integration/erp-sync-service';
import * as runRoute from '../src/app/api/v1/erp/sync/run/route';

const newKey = () => `stihub_sync_${randomBytes(32).toString('base64url')}`;
const CURRENT = newKey();
const PREVIOUS = newKey();

const okRunner: ErpSyncRunner = async () => ({
  status: 200,
  body: {
    data: {
      syncedAt: '2026-11-15T12:00:00.000Z',
      storeId: '118887',
      counts: { companies: 23, rentalContracts: 18, financialEntries: 299 },
      lastSyncEntry: { id: 'sync-gc-live-1', recordsSynced: 4923, summary: 'Cliente ACME CNPJ 11.222.333/0001-81' },
      companies: [{ name: 'PII nunca deve aparecer' }],
    },
  },
});

function makeDeps(over: Partial<ErpSyncDeps> & { envOver?: Record<string, string | undefined> } = {}) {
  const store = new TestOnlyMemoryIntegrationStore();
  const calls: Array<{ forceRefresh: boolean }> = [];
  const runner: ErpSyncRunner = over.runner || okRunner;
  const deps: ErpSyncDeps = {
    store,
    now: () => new Date('2026-11-15T13:00:10.000Z'),
    env: { NODE_ENV: 'production', [ERP_SYNC_KEY_ENV]: CURRENT, ...(over.envOver || {}) } as NodeJS.ProcessEnv,
    runner: async (i) => { calls.push(i); return runner(i); },
  };
  return { deps, store, calls };
}

function req(opts: { method?: string; auth?: string; body?: unknown; ip?: string; cookie?: string } = {}): IntegrationHttpRequest {
  const headers: Record<string, string> = {};
  if (opts.auth !== undefined) headers.authorization = opts.auth;
  return {
    method: opts.method || 'POST',
    path: ERP_SYNC_ROUTE,
    headers,
    query: {},
    body: opts.body,
    cookies: opts.cookie ? { stihub_session: opts.cookie } : {},
    ip: opts.ip || '203.0.113.7',
    origin: '',
  };
}

const ctype = (r: { headers: Record<string, string> }) => r.headers['Content-Type'] || '';

describe('ERP sync service key: autenticacao', () => {
  it('sem chave => 401 problem+json com WWW-Authenticate; runner nao roda', async () => {
    const { deps, calls, store } = makeDeps();
    const r = await handleErpSyncRun(req(), deps);
    assert.equal(r.status, 401);
    assert.match(ctype(r), /application\/problem\+json/);
    assert.match(r.headers['WWW-Authenticate'], /^Bearer/);
    assert.equal(calls.length, 0);
    assert.equal(store.audit.at(-1)?.errorCode, 'MISSING_BEARER');
  });

  it('cookie de sessao nao autentica (so Bearer)', async () => {
    const { deps, calls } = makeDeps();
    const r = await handleErpSyncRun(req({ cookie: 'qualquer.sessao.valida' }), deps);
    assert.equal(r.status, 401);
    assert.equal(calls.length, 0);
  });

  it('chave errada / formato errado / outro esquema => 401 auditado', async () => {
    const { deps, calls, store } = makeDeps();
    for (const auth of [`Bearer ${newKey()}`, 'Bearer stihub_sync_curta', `Basic ${CURRENT}`, CURRENT, `Bearer ${CURRENT}x`, `Bearer stihub_svc_${'a'.repeat(43)}`]) {
      const r = await handleErpSyncRun(req({ auth }), deps);
      assert.equal(r.status, 401, auth.slice(0, 20));
    }
    assert.equal(calls.length, 0);
    assert.ok(store.audit.every((a) => a.statusCode === 401 && a.action === ERP_SYNC_AUDIT_ACTION));
  });

  it('chave atual => 200, slot current; chave previous aceita (slot previous) na janela de rotacao', async () => {
    const { deps, calls, store } = makeDeps({ envOver: { [ERP_SYNC_KEY_PREVIOUS_ENV]: PREVIOUS } });
    const a = await handleErpSyncRun(req({ auth: `Bearer ${CURRENT}` }), deps);
    assert.equal(a.status, 200);
    assert.match(ctype(a), /application\/json/);
    const b = await handleErpSyncRun(req({ auth: `Bearer ${PREVIOUS}`, body: { forceRefresh: false } }), deps);
    assert.equal(b.status, 200);
    assert.deepEqual(calls, [{ forceRefresh: true }, { forceRefresh: false }]);
    const ok = store.audit.filter((x) => x.statusCode === 200);
    assert.equal(ok[0].details?.slot, 'current');
    assert.equal(ok[1].details?.slot, 'previous');
    assert.equal(ok[0].details?.fingerprint, erpSyncKeyFingerprint(CURRENT));
    assert.equal(ok[0].keyId, `erp_sync:current:${erpSyncKeyFingerprint(CURRENT)}`);
  });

  it('previous sem current nao vale; previous igual/curta e ignorada', () => {
    assert.equal(readErpSyncKeyConfig({ [ERP_SYNC_KEY_PREVIOUS_ENV]: PREVIOUS } as NodeJS.ProcessEnv).configured, false);
    const cfg = readErpSyncKeyConfig({ [ERP_SYNC_KEY_ENV]: CURRENT, [ERP_SYNC_KEY_PREVIOUS_ENV]: 'stihub_sync_curta' } as NodeJS.ProcessEnv);
    assert.equal(cfg.previous, null);
    assert.equal(matchErpSyncKey('stihub_sync_curta', cfg), null);
  });

  it('env ausente ou curta em producao => 503 fail-closed (antes de tocar store/runner)', async () => {
    for (const v of [undefined, '', 'stihub_sync_abc', `stihub_svc_${'a'.repeat(43)}`, 'x'.repeat(64)]) {
      const { deps, calls, store } = makeDeps({ envOver: { [ERP_SYNC_KEY_ENV]: v } });
      const r = await handleErpSyncRun(req({ auth: `Bearer ${CURRENT}` }), deps);
      assert.equal(r.status, 503, String(v));
      assert.equal((r.body as { code: string }).code, 'ERP_SYNC_KEY_NOT_CONFIGURED');
      assert.equal(calls.length, 0);
      assert.equal(store.audit.length, 0);
    }
  });

  it('sem Postgres (store null) => 503 INTEGRATION_STORE_UNAVAILABLE', async () => {
    const { deps } = makeDeps();
    const r = await handleErpSyncRun(req({ auth: `Bearer ${CURRENT}` }), { ...deps, store: null });
    assert.equal(r.status, 503);
    assert.equal((r.body as { code: string }).code, 'INTEGRATION_STORE_UNAVAILABLE');
  });
});

describe('ERP sync service key: escopo minimo, validacao e limites', () => {
  it('metodo errado => 405 com Allow: POST', async () => {
    const { deps, calls } = makeDeps();
    for (const m of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      const r = await handleErpSyncRun(req({ method: m, auth: `Bearer ${CURRENT}` }), deps);
      assert.equal(r.status, 405, m);
      assert.equal(r.headers.Allow, 'POST');
    }
    assert.equal(calls.length, 0);
  });

  it('corpo invalido (dados de negocio, campo extra, tipo errado, JSON invalido, array) => 400', async () => {
    const bad: unknown[] = [null, [], 'x', { forceRefresh: 'sim' }, { companies: [{ name: 'X' }] }, { forceRefresh: true, path: '/api/iam/users' }, { rentalContracts: [] }];
    for (const body of bad) {
      const { deps, calls } = makeDeps();
      const r = await handleErpSyncRun(req({ auth: `Bearer ${CURRENT}`, body }), deps);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.match(ctype(r), /problem\+json/);
      assert.equal(calls.length, 0);
    }
  });

  it('corpo invalido sem autenticar => 401 (nao vaza validacao antes da auth)', async () => {
    const { deps } = makeDeps();
    const r = await handleErpSyncRun(req({ body: { companies: [] } }), deps);
    assert.equal(r.status, 401);
  });

  it('rate-limit por chave => 429 com Retry-After', async () => {
    const { deps, calls, store } = makeDeps();
    let last;
    for (let i = 0; i < ERP_SYNC_RATE_PER_KEY_PER_MINUTE + 1; i++) last = await handleErpSyncRun(req({ auth: `Bearer ${CURRENT}` }), deps);
    assert.equal(last!.status, 429);
    assert.ok(Number(last!.headers['Retry-After']) >= 1);
    assert.equal(calls.length, ERP_SYNC_RATE_PER_KEY_PER_MINUTE);
    assert.equal(store.audit.at(-1)?.errorCode, 'RATE_LIMITED_KEY');
  });

  it('rate-limit por IP conta tentativas sem chave (forca bruta) => 429', async () => {
    const { deps } = makeDeps();
    let last;
    for (let i = 0; i < ERP_SYNC_RATE_PER_IP_PER_MINUTE + 1; i++) last = await handleErpSyncRun(req({ auth: `Bearer ${newKey()}`, ip: '198.51.100.9' }), deps);
    assert.equal(last!.status, 429);
    assert.ok(last!.headers['Retry-After']);
    // mesmo com a chave certa, o IP bloqueado continua 429 nesta janela
    const r = await handleErpSyncRun(req({ auth: `Bearer ${CURRENT}`, ip: '198.51.100.9' }), deps);
    assert.equal(r.status, 429);
    // outro IP segue normal
    assert.equal((await handleErpSyncRun(req({ auth: `Bearer ${CURRENT}`, ip: '198.51.100.10' }), deps)).status, 200);
  });

  it('resposta so com contagens (sem registros/PII); falha do caso de uso => 502; GestaoClick indisponivel => 502', async () => {
    const { deps } = makeDeps();
    const r = await handleErpSyncRun(req({ auth: `Bearer ${CURRENT}` }), deps);
    const s = JSON.stringify(r.body);
    assert.ok(!s.includes('PII'));
    assert.ok(!s.includes('11.222.333'));
    assert.deepEqual(Object.keys((r.body as { data: Record<string, unknown> }).data).sort(), ['counts', 'durationMs', 'recordsSynced', 'requestId', 'source', 'status', 'storeId', 'syncedAt']);

    const fail = makeDeps({ runner: async () => ({ status: 500, body: { error: 'x' } }) });
    assert.equal((await handleErpSyncRun(req({ auth: `Bearer ${CURRENT}` }), fail.deps)).status, 502);
    const fallback = makeDeps({ runner: async () => ({ status: 200, body: { data: { lastSyncEntry: { id: 'sync-gc-123' }, counts: {} } } }) });
    const fb = await handleErpSyncRun(req({ auth: `Bearer ${CURRENT}` }), fallback.deps);
    assert.equal(fb.status, 502);
    assert.equal((fb.body as { code: string }).code, 'GESTAOCLICK_UNAVAILABLE');
  });

  it('auditoria sem segredo: nunca grava chave, hash completo, corpo ou PII', async () => {
    const { deps, store } = makeDeps({ envOver: { [ERP_SYNC_KEY_PREVIOUS_ENV]: PREVIOUS } });
    const wrong = newKey();
    await handleErpSyncRun(req({ auth: `Bearer ${CURRENT}`, body: { forceRefresh: true } }), deps);
    await handleErpSyncRun(req({ auth: `Bearer ${wrong}` }), deps);
    await handleErpSyncRun(req({ auth: `Bearer ${CURRENT}`, body: { companies: [{ name: 'ACME' }] } }), deps);
    const dump = JSON.stringify(store.audit);
    const { createHash } = await import('node:crypto');
    for (const secret of [CURRENT, PREVIOUS, wrong, CURRENT.slice(12), createHash('sha256').update(CURRENT).digest('hex'), createHash('sha256').update(CURRENT).digest('hex').slice(0, 16)]) {
      assert.ok(!dump.includes(secret));
    }
    assert.ok(!dump.includes('ACME'));
    assert.ok(!dump.includes('11.222.333'));
    assert.ok(!dump.includes(erpSyncKeyFingerprint(wrong)), 'falha de auth nao registra fingerprint do valor tentado');
    const ok = store.audit.find((a) => a.statusCode === 200)!;
    assert.equal(ok.action, 'erp_sync.ingest');
    assert.equal(ok.channel, 'rest_v1');
    assert.equal(ok.authType, 'service_key');
    assert.equal(ok.ipAddress, '203.0.113.7');
    assert.deepEqual(ok.details?.counts, { companies: 23, rentalContracts: 18, financialEntries: 299 });
    assert.equal(typeof ok.details?.durationMs, 'number');
    assert.equal(store.audit.filter((a) => a.statusCode === 401).length, 1);
  });
});

describe('ERP sync service key: caso de uso real (router em memoria) preserva IAM/permissoes', () => {
  it('dispara SO o POST /api/erp/daily-sync interno; sem credencial GestaoClick => 502 e usuarios/permissoes intactos', async () => {
    const saved = { a: process.env.GESTAOCLICK_ACCESS_TOKEN, s: process.env.GESTAOCLICK_SECRET_ACCESS_TOKEN };
    delete process.env.GESTAOCLICK_ACCESS_TOKEN;
    delete process.env.GESTAOCLICK_SECRET_ACCESS_TOKEN;
    try {
      const repo = createInMemoryRepository();
      const router = new CrmApiRouter(repo);
      const before = JSON.stringify(repo.getRbacState());
      const paths: string[] = [];
      const orig = router.dispatch.bind(router);
      router.dispatch = async (r) => { paths.push(`${r.method} ${r.path}`); return orig(r); };
      const runner: ErpSyncRunner = async ({ forceRefresh }) => {
        const res = await router.dispatch({ method: 'POST', path: '/api/erp/daily-sync', body: { forceRefresh }, context: TRUSTED_INTERNAL_CONTEXT });
        return { status: res.status, body: res.body };
      };
      const { deps } = makeDeps({ runner });
      const r = await handleErpSyncRun(req({ auth: `Bearer ${CURRENT}` }), deps);
      assert.equal(r.status, 502);
      assert.deepEqual(paths, ['POST /api/erp/daily-sync']);
      assert.equal(JSON.stringify(repo.getRbacState()), before);
    } finally {
      if (saved.a !== undefined) process.env.GESTAOCLICK_ACCESS_TOKEN = saved.a;
      if (saved.s !== undefined) process.env.GESTAOCLICK_SECRET_ACCESS_TOKEN = saved.s;
    }
  });
});

describe('ERP sync service key: middleware e rota Next', () => {
  const run = (path: string, method = 'POST', headers: Record<string, string> = {}) =>
    middleware(new NextRequest(new URL(`https://sti-hub.vercel.app${path}`), { method, headers }));

  it('POST /api/v1/erp/sync/run chega ao handler sem sessao (sem redirect/401 do middleware)', () => {
    const res = run(ERP_SYNC_ROUTE, 'POST', { authorization: `Bearer ${CURRENT}` });
    assert.equal(res.headers.get('x-stihub-auth-guard'), 'integration-self-auth');
    assert.equal(res.headers.get('location'), null);
    assert.ok(res.status < 300);
  });

  it('a chave de sync NAO libera rotas vizinhas/antigas de sessao', () => {
    const auth = { authorization: `Bearer ${CURRENT}` };
    for (const [p, m] of [
      ['/api/erp/daily-sync', 'POST'],
      ['/api/erp/daily-sync', 'GET'],
      ['/api/erp/gestaoclick/sync', 'POST'],
      ['/api/erp/financial', 'GET'],
      ['/api/companies', 'GET'],
      ['/api/iam/users', 'GET'],
      ['/api/v1%2F..%2Ferp/daily-sync', 'POST'],
      ['/API/V1/erp/sync/run', 'POST'],
    ] as const) {
      const res = run(p, m, auth);
      assert.ok(res.status === 401 || res.status === 403 || res.status === 307, `${m} ${p} => ${res.status}`);
    }
  });

  describe('route handler', () => {
    let store: TestOnlyMemoryIntegrationStore;
    const savedKey = process.env[ERP_SYNC_KEY_ENV];
    beforeEach(() => {
      store = new TestOnlyMemoryIntegrationStore();
      setIntegrationDepsForTests({ store });
      setErpSyncRunnerForTests(okRunner);
      process.env[ERP_SYNC_KEY_ENV] = CURRENT;
    });
    afterEach(() => {
      setIntegrationDepsForTests(null);
      setErpSyncRunnerForTests(null);
      if (savedKey === undefined) delete process.env[ERP_SYNC_KEY_ENV];
      else process.env[ERP_SYNC_KEY_ENV] = savedKey;
    });
    const nreq = (method: string, init: { body?: string; headers?: Record<string, string> } = {}) =>
      new NextRequest(new URL(`https://sti-hub.vercel.app${ERP_SYNC_ROUTE}`), { method, body: init.body, headers: init.headers });

    it('GET/DELETE => 405 problem+json; POST com chave => 200', async () => {
      const g = await runRoute.GET(nreq('GET'));
      assert.equal(g.status, 405);
      assert.equal(g.headers.get('allow'), 'POST');
      assert.match(g.headers.get('content-type') || '', /problem\+json/);
      assert.equal((await runRoute.DELETE(nreq('DELETE'))).status, 405);
      const ok = await runRoute.POST(nreq('POST', { headers: { authorization: `Bearer ${CURRENT}`, 'content-type': 'application/json' }, body: '{"forceRefresh":true}' }));
      assert.equal(ok.status, 200);
      assert.equal(ok.headers.get('set-cookie'), null);
    });

    it('corpo acima de 4 KiB => 413; JSON invalido autenticado => 400', async () => {
      const big = await runRoute.POST(nreq('POST', { headers: { authorization: `Bearer ${CURRENT}` }, body: JSON.stringify({ x: 'a'.repeat(5000) }) }));
      assert.equal(big.status, 413);
      const bad = await runRoute.POST(nreq('POST', { headers: { authorization: `Bearer ${CURRENT}` }, body: '{nao-json' }));
      assert.equal(bad.status, 400);
    });

    it('sessao por cookie sem Bearer => 401', async () => {
      const r = await runRoute.POST(nreq('POST', { headers: { cookie: 'stihub_session=abc.def' } }));
      assert.equal(r.status, 401);
    });
  });
});
