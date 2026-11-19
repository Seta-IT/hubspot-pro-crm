// ============================================================================
// Perf 19/11/2026 (lote 1): /api/bootstrap NAO faz mais a carga ao vivo do GestaoClick.
// Antes, toda instancia fria esperava contratos/vendas/O.S. paginados a 3 req/s dentro da
// abertura do app (p50 9,6 s / p95 46,7 s em producao). O GC segue pelo cron diario, pelo
// sync manual e pela ingestao /api/v1/erp/sync/run. BOOTSTRAP_LIVE_GESTAOCLICK=1 religa.
// ============================================================================
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT, isBootstrapLiveGestaoClickEnabled } from '../src/api/router';

const saved = {
  flag: process.env.BOOTSTRAP_LIVE_GESTAOCLICK,
  token: process.env.GESTAOCLICK_ACCESS_TOKEN,
};

afterEach(() => {
  if (saved.flag === undefined) delete process.env.BOOTSTRAP_LIVE_GESTAOCLICK;
  else process.env.BOOTSTRAP_LIVE_GESTAOCLICK = saved.flag;
  if (saved.token === undefined) delete process.env.GESTAOCLICK_ACCESS_TOKEN;
  else process.env.GESTAOCLICK_ACCESS_TOKEN = saved.token;
});

/** Router "singleton" sobre repositorio em memoria, com o sync ao vivo instrumentado. */
function setup() {
  const repo = createInMemoryRepository();
  let liveCalls = 0;
  (repo as unknown as { syncLiveGestaoClick: () => Promise<unknown> }).syncLiveGestaoClick = async () => {
    liveCalls++;
    return repo.getErpOverview().gestaoClickConfig;
  };
  const router = new CrmApiRouter(repo);
  // O ramo do GC so existe no repositorio singleton (producao); sem DATABASE_URL nada vai ao banco.
  (router as unknown as { isSingletonRepo: boolean }).isSingletonRepo = true;
  return { router, calls: () => liveCalls };
}

const bootstrap = (router: CrmApiRouter) =>
  router.dispatch({ method: 'POST', path: '/api/bootstrap', query: {}, body: {}, context: TRUSTED_INTERNAL_CONTEXT });

describe('Perf lote 1: bootstrap sem GestaoClick ao vivo', () => {
  it('flag desligada por padrao; so "1"/"true" religam', () => {
    assert.equal(isBootstrapLiveGestaoClickEnabled({}), false);
    assert.equal(isBootstrapLiveGestaoClickEnabled({ BOOTSTRAP_LIVE_GESTAOCLICK: '0' }), false);
    assert.equal(isBootstrapLiveGestaoClickEnabled({ BOOTSTRAP_LIVE_GESTAOCLICK: 'nao' }), false);
    assert.equal(isBootstrapLiveGestaoClickEnabled({ BOOTSTRAP_LIVE_GESTAOCLICK: '1' }), true);
    assert.equal(isBootstrapLiveGestaoClickEnabled({ BOOTSTRAP_LIVE_GESTAOCLICK: ' TRUE ' }), true);
  });

  it('com token do GC configurado, o bootstrap NAO chama syncLiveGestaoClick por padrao', async () => {
    delete process.env.BOOTSTRAP_LIVE_GESTAOCLICK;
    process.env.GESTAOCLICK_ACCESS_TOKEN = 'token-de-teste';
    const { router, calls } = setup();
    const res = await bootstrap(router);
    assert.equal(res.status, 200);
    assert.equal(calls(), 0);
  });

  it('BOOTSTRAP_LIVE_GESTAOCLICK=1 religa (uma vez por instancia, como antes)', async () => {
    process.env.BOOTSTRAP_LIVE_GESTAOCLICK = '1';
    process.env.GESTAOCLICK_ACCESS_TOKEN = 'token-de-teste';
    const { router, calls } = setup();
    assert.equal((await bootstrap(router)).status, 200);
    assert.equal((await bootstrap(router)).status, 200);
    assert.equal(calls(), 1);
  });

  it('o sync manual (/api/erp/gestaoclick/sync) e o cron (/api/erp/daily-sync) continuam chamando o GC', () => {
    const router = readFileSync(join(process.cwd(), 'src/api/router.ts'), 'utf8');
    assert.match(router, /syncLiveGestaoClick\(\{ forceRefresh: true \}\)/);
    assert.match(router, /runIncrementalDailySync\(/);
    const vercel = readFileSync(join(process.cwd(), 'vercel.json'), 'utf8');
    assert.match(vercel, /\/api\/erp\/daily-sync/);
  });
});
