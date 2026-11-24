// ============================================================================
// Perf 24/11/2026: com MARKETING_LIVE_SEND / WORKFLOWS_LIVE / SEQUENCES_LIVE_SEND
// desligados, os crons autenticados devolvem 200 sem ler nem gravar o crm_state_v1
// (mesmo padrao do poll de e-mail). A autenticacao do cron permanece obrigatória.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInMemoryRepository } from '../src/db/repository';
import {
  CrmApiRouter,
  isAuthorizedMarketingCron,
  isAuthorizedSequencesCron,
  isAuthorizedWorkflowsCron,
  shouldPersistAfterDispatch,
  shouldSkipCrmStateLoad,
} from '../src/api/router';
import type { CrmDatabaseState } from '../src/db/types';

const HTTP = { _fromHttpBridge: '1' };
const CRON = { ...HTTP, _cronAuthorized: '1' };
const PATHS = [
  { path: '/api/cron/marketing' as const, flag: 'MARKETING_LIVE_SEND', auth: isAuthorizedMarketingCron },
  { path: '/api/cron/workflows' as const, flag: 'WORKFLOWS_LIVE', auth: isAuthorizedWorkflowsCron },
  { path: '/api/cron/sequences' as const, flag: 'SEQUENCES_LIVE_SEND', auth: isAuthorizedSequencesCron },
];

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

/** Router singleton simulado: Postgres "ligado", carga e gravacao instrumentadas. Sem DATABASE_URL. */
function instrumentedRouter() {
  const repo = createInMemoryRepository();
  const router = new CrmApiRouter(repo);
  const counts = { loads: 0, writes: 0 };
  const hooks = router as unknown as {
    isSingletonRepo: boolean;
    stateStoreEnabled: () => boolean;
    loadStateFromStore: () => Promise<CrmDatabaseState | null>;
    writeStateToStore: (state: CrmDatabaseState) => Promise<void>;
    repo: { syncFromDisk: () => void };
  };
  hooks.isSingletonRepo = true;
  hooks.stateStoreEnabled = () => true;
  hooks.repo.syncFromDisk = () => undefined;
  hooks.loadStateFromStore = async () => {
    counts.loads += 1;
    return repo.getState();
  };
  hooks.writeStateToStore = async () => {
    counts.writes += 1;
  };
  return { router, counts };
}

describe('Perf 24/11: crons com flag LIVE desligada nao leem nem gravam o estado', () => {
  it('shouldSkipCrmStateLoad so com cron autenticado e flag desligada', () => {
    for (const { path, flag, auth } of PATHS) {
      assert.equal(auth('GET', path, CRON), true, path);
      assert.equal(shouldSkipCrmStateLoad('GET', path, CRON), true, `${path} padrao`);
      assert.equal(shouldSkipCrmStateLoad('GET', path, HTTP), false, `${path} sem _cronAuthorized`);
      assert.equal(shouldSkipCrmStateLoad('GET', path, CRON, { [flag]: 'true' }), false, `${path} flag ligada`);
      assert.equal(shouldPersistAfterDispatch('GET', path, CRON, 200), false, `${path} nao persiste`);
      assert.equal(shouldPersistAfterDispatch('GET', path, CRON, 200, { [flag]: 'true' }), true, `${path} persiste com flag`);
    }
    assert.equal(shouldSkipCrmStateLoad('GET', '/api/bootstrap', CRON), false);
  });

  it('cron autenticado com flag desligada: 200, zero load, zero persist', async () => {
    const off: Record<string, undefined> = {
      MARKETING_LIVE_SEND: undefined,
      WORKFLOWS_LIVE: undefined,
      SEQUENCES_LIVE_SEND: undefined,
    };
    await withEnv(off, async () => {
      const { router, counts } = instrumentedRouter();
      for (const { path } of PATHS) {
        const before = { ...counts };
        const res = await router.dispatch({ method: 'GET', path, query: { ...CRON } });
        assert.equal(res.status, 200, path);
        assert.equal(counts.loads, before.loads, `load ${path}`);
        assert.equal(counts.writes, before.writes, `persist ${path}`);
      }
      assert.equal(counts.loads, 0);
      assert.equal(counts.writes, 0);
    });
  });

  it('sem autenticacao do cron: 401/403 (nao abre atalho) e a flag desligada nao muda isso', async () => {
    await withEnv({ MARKETING_LIVE_SEND: undefined, WORKFLOWS_LIVE: undefined, SEQUENCES_LIVE_SEND: undefined }, async () => {
      const { router, counts } = instrumentedRouter();
      for (const { path } of PATHS) {
        const res = await router.dispatch({ method: 'GET', path, query: { ...HTTP } });
        assert.ok([401, 403].includes(res.status), `${path} ${res.status}`);
      }
      // Sem _cronAuthorized o skip nao se aplica: a carga ocorre (auth e depois).
      assert.equal(counts.loads, PATHS.length);
      assert.equal(counts.writes, 0);
    });
  });

  it('com a flag LIVE ligada o cron autenticado passa a carregar o estado', async () => {
    for (const { path, flag } of PATHS) {
      await withEnv({ [flag]: 'true' }, async () => {
        const { router, counts } = instrumentedRouter();
        const res = await router.dispatch({ method: 'GET', path, query: { ...CRON } });
        assert.equal(res.status, 200, path);
        assert.equal(counts.loads, 1, `load ${path}`);
      });
    }
  });

  it('vercel.json dos tres crons permanece inalterado', () => {
    const cfg = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    assert.equal(cfg.crons.find((c) => c.path === '/api/cron/marketing')?.schedule, '*/5 * * * *');
    assert.equal(cfg.crons.find((c) => c.path === '/api/cron/workflows')?.schedule, '*/5 * * * *');
    assert.equal(cfg.crons.find((c) => c.path === '/api/cron/sequences')?.schedule, '*/15 * * * 1-5');
  });
});
