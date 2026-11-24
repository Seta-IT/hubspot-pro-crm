// ============================================================================
// STI-hub — Log persistente da sincronizacao diaria (tabela erp_sync_run_log).
// ============================================================================
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeCountsDelta,
  persistErpSyncRunLog,
  loadLatestErpSyncRunLog,
  sanitizeSyncCounts,
  setErpSyncRunLogQueryForTests,
  type ErpSyncLogQuery,
} from '../src/modules/erp/erp-sync-run-log';

function memoryLog(): { query: ErpSyncLogQuery; rows: Array<Record<string, unknown>> } {
  const rows: Array<Record<string, unknown>> = [];
  const query: ErpSyncLogQuery = async (text, params = []) => {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('SELECT') && sql.includes('ORDER BY run_at DESC')) {
      const last = rows.length ? rows[rows.length - 1] : undefined;
      return { rows: last ? [last] : [] };
    }
    if (sql.startsWith('INSERT')) {
      const [
        trigger,
        status,
        error,
        durationMs,
        liveConnected,
        countsJson,
        previousRunAt,
        countsDeltaJson,
        source,
      ] = params;
      const row = {
        id: `run-${rows.length + 1}`,
        run_at: new Date('2026-11-24T12:00:00.000Z'),
        trigger,
        status,
        error,
        duration_ms: durationMs,
        live_connected: liveConnected,
        counts: JSON.parse(String(countsJson || '{}')),
        previous_run_at: previousRunAt ? new Date(String(previousRunAt)) : null,
        counts_delta: countsDeltaJson ? JSON.parse(String(countsDeltaJson)) : null,
        source,
      };
      // Segunda insercao avanca 1 dia para diferenciar run_at.
      if (rows.length) row.run_at = new Date('2026-11-25T12:00:00.000Z');
      rows.push(row);
      return { rows: [row] };
    }
    throw new Error(`query inesperada: ${sql}`);
  };
  return { query, rows };
}

describe('erp-sync-run-log: sanitizacao e delta', () => {
  it('sanitizeSyncCounts ignora chave invalida, nao-numero e teto de 40', () => {
    assert.deepEqual(sanitizeSyncCounts({ companies: 1181, contacts: 28, 'bad-key': 1, x: 'no' }), {
      companies: 1181,
      contacts: 28,
    });
    const many: Record<string, number> = {};
    for (let i = 0; i < 50; i++) many[`k${i}`] = i;
    assert.equal(Object.keys(sanitizeSyncCounts(many)).length, 40);
    assert.deepEqual(sanitizeSyncCounts(null), {});
  });

  it('computeCountsDelta compara com a execucao anterior, inclusive chaves novas ou sumidas', () => {
    assert.deepEqual(
      computeCountsDelta({ companies: 1181, contacts: 28 }, { companies: 1180, contacts: 27, catalog: 10 }),
      { companies: 1, contacts: 1, catalog: -10 }
    );
    assert.deepEqual(computeCountsDelta({ companies: 5 }, null), { companies: 5 });
  });
});

describe('erp-sync-run-log: persistencia (query injetado, sem banco real)', () => {
  beforeEach(() => setErpSyncRunLogQueryForTests(null));
  afterEach(() => setErpSyncRunLogQueryForTests(null));

  it('sem query injetado em NODE_ENV=test => no_db (nao usa o pool real)', async () => {
    const res = await persistErpSyncRunLog({ trigger: 'vercel_cron', status: 'SUCCESS', counts: { companies: 1 } });
    assert.deepEqual(res, { ok: false, reason: 'no_db' });
    const latest = await loadLatestErpSyncRunLog();
    assert.deepEqual(latest, { ok: false, reason: 'no_db' });
  });

  it('primeira execucao grava sem delta; a segunda compara com a anterior', async () => {
    const mem = memoryLog();
    setErpSyncRunLogQueryForTests(mem.query);
    const first = await persistErpSyncRunLog({
      trigger: 'vercel_cron',
      status: 'SUCCESS',
      durationMs: 12000,
      liveConnected: true,
      counts: { companies: 1180, contacts: 27 },
      source: 'gestaoclick_live',
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.record.previousRunAt, null);
    assert.equal(first.record.countsDelta, null);
    assert.deepEqual(first.record.counts, { companies: 1180, contacts: 27 });
    assert.equal(first.record.trigger, 'vercel_cron');

    const second = await persistErpSyncRunLog({
      trigger: 'vercel_cron',
      status: 'SUCCESS',
      durationMs: 11000,
      liveConnected: true,
      counts: { companies: 1181, contacts: 28 },
      source: 'gestaoclick_live',
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.record.previousRunAt, '2026-11-24T12:00:00.000Z');
    assert.deepEqual(second.record.countsDelta, { companies: 1, contacts: 1 });
    const latest = await loadLatestErpSyncRunLog();
    assert.equal(latest.ok, true);
    if (!latest.ok) return;
    assert.equal(latest.record?.id, second.record.id);
  });

  it('tabela ausente (42P01) => table_missing, sem lancar', async () => {
    const missing: ErpSyncLogQuery = async () => {
      const err = new Error('relation "erp_sync_run_log" does not exist') as Error & { code: string };
      err.code = '42P01';
      throw err;
    };
    setErpSyncRunLogQueryForTests(missing);
    const res = await persistErpSyncRunLog({ trigger: 'admin', status: 'ERROR', error: 'falhou' });
    assert.deepEqual(res, { ok: false, reason: 'table_missing' });
  });

  it('erro generico no banco => error, sem lancar e sem ecoar a mensagem', async () => {
    const boom: ErpSyncLogQuery = async () => {
      throw new Error('senha=nao-deve-aparecer');
    };
    setErpSyncRunLogQueryForTests(boom);
    const res = await persistErpSyncRunLog({ trigger: 'service_key', status: 'SUCCESS' });
    assert.deepEqual(res, { ok: false, reason: 'error' });
    assert.ok(!JSON.stringify(res).includes('senha'));
  });
});

describe('erp-sync-run-log: artefatos do cron', () => {
  it('vercel.json agenda /api/erp/daily-sync as 12:00 UTC (07:00 ET no inverno)', () => {
    const raw = readFileSync(join(process.cwd(), 'vercel.json'), 'utf8');
    const cfg = JSON.parse(raw) as { crons: Array<{ path: string; schedule: string }> };
    const daily = cfg.crons.find((c) => c.path === '/api/erp/daily-sync');
    assert.ok(daily, 'cron daily-sync presente');
    assert.equal(daily?.schedule, '0 12 * * *');
  });

  it('SQL da migracao pendente cria erp_sync_run_log e nao e autoexecutado no schema', () => {
    const sql = readFileSync(join(process.cwd(), 'scripts/erp-sync/create-erp-sync-run-log.sql'), 'utf8');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS erp_sync_run_log/);
    assert.match(sql, /counts_delta/);
    const schema = readFileSync(join(process.cwd(), 'src/db/postgres.ts'), 'utf8');
    assert.equal(schema.includes('erp_sync_run_log'), false, 'ensurePostgresSchema nao cria a tabela sozinho');
  });
});
