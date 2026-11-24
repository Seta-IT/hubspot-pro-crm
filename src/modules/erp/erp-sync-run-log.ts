// ============================================================================
// STI-hub — Log persistente das sincronizacoes GestaoClick -> STI-hub (Neon).
// Cada execucao (cron da Vercel, chave de servico ou botao admin) grava
// timestamp, contagens por entidade, status, erro e o delta em relacao a
// execucao anterior. A tabela erp_sync_run_log e criada por
// scripts/erp-sync/create-erp-sync-run-log.sql (migracao manual; este modulo
// NAO cria a tabela). Sem banco ou com a tabela ausente, a sync nao falha.
// Em NODE_ENV=test so usa o query injetado (nunca o pool real).
// ============================================================================
import { getPostgresPool } from '../../db/postgres';

export const ERP_SYNC_RUN_LOG_TABLE = 'erp_sync_run_log';

export type ErpSyncTrigger = 'vercel_cron' | 'service_key' | 'admin';
export type ErpSyncLogStatus = 'SUCCESS' | 'PARTIAL' | 'ERROR';

export interface ErpSyncRunLogRow {
  id: string;
  runAt: string;
  trigger: ErpSyncTrigger;
  status: ErpSyncLogStatus;
  error: string | null;
  durationMs: number | null;
  liveConnected: boolean | null;
  counts: Record<string, number>;
  previousRunAt: string | null;
  countsDelta: Record<string, number> | null;
  source: string | null;
}

export interface PersistErpSyncRunLogInput {
  trigger: ErpSyncTrigger;
  status: ErpSyncLogStatus;
  error?: string | null;
  durationMs?: number | null;
  liveConnected?: boolean | null;
  counts?: Record<string, number>;
  source?: string | null;
}

export type PersistErpSyncRunLogResult =
  | { ok: true; record: ErpSyncRunLogRow }
  | { ok: false; reason: 'no_db' | 'table_missing' | 'error' };

export type ErpSyncLogQuery = (
  text: string,
  params?: unknown[]
) => Promise<{ rows: Array<Record<string, unknown>> }>;

const COUNT_KEY = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
const MAX_COUNT_KEYS = 40;
const MAX_ERROR_CHARS = 500;
const TRIGGERS = new Set<ErpSyncTrigger>(['vercel_cron', 'service_key', 'admin']);
const STATUSES = new Set<ErpSyncLogStatus>(['SUCCESS', 'PARTIAL', 'ERROR']);

let testQuery: ErpSyncLogQuery | null = null;

/** So em testes: injeta o acesso ao banco (nunca o pool de producao). */
export function setErpSyncRunLogQueryForTests(query: ErpSyncLogQuery | null): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('setErpSyncRunLogQueryForTests so pode ser usado com NODE_ENV=test.');
  }
  testQuery = query;
}

export function sanitizeSyncCounts(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, n] of Object.entries(raw as Record<string, unknown>)) {
    if (!COUNT_KEY.test(k) || typeof n !== 'number' || !Number.isFinite(n)) continue;
    out[k] = n;
    if (Object.keys(out).length >= MAX_COUNT_KEYS) break;
  }
  return out;
}

export function computeCountsDelta(
  current: Record<string, number>,
  previous: Record<string, number> | null | undefined
): Record<string, number> {
  const keys = new Set([...Object.keys(current), ...Object.keys(previous || {})]);
  const delta: Record<string, number> = {};
  for (const k of keys) {
    if (!COUNT_KEY.test(k)) continue;
    delta[k] = (current[k] ?? 0) - (previous?.[k] ?? 0);
  }
  return delta;
}

function isUndefinedTable(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: string }).code === '42P01');
}

function safeError(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = String(text).replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR_CHARS);
  return trimmed || null;
}

async function resolveQuery(): Promise<ErpSyncLogQuery | null> {
  // Testes nunca usam o pool real (evita gravar no Neon por acidente).
  if (process.env.NODE_ENV === 'test') return testQuery;
  const pool = getPostgresPool();
  if (!pool) return null;
  return (text, params) => pool.query(text, params);
}

function mapRow(row: Record<string, unknown>): ErpSyncRunLogRow {
  const trigger = TRIGGERS.has(row.trigger as ErpSyncTrigger) ? (row.trigger as ErpSyncTrigger) : 'admin';
  const status = STATUSES.has(row.status as ErpSyncLogStatus) ? (row.status as ErpSyncLogStatus) : 'ERROR';
  const runAt = row.run_at instanceof Date ? row.run_at.toISOString() : String(row.run_at || '');
  const previousRunAt = row.previous_run_at
    ? row.previous_run_at instanceof Date
      ? row.previous_run_at.toISOString()
      : String(row.previous_run_at)
    : null;
  return {
    id: String(row.id || ''),
    runAt,
    trigger,
    status,
    error: typeof row.error === 'string' ? row.error : null,
    durationMs: typeof row.duration_ms === 'number' ? row.duration_ms : row.duration_ms == null ? null : Number(row.duration_ms),
    liveConnected: typeof row.live_connected === 'boolean' ? row.live_connected : null,
    counts: sanitizeSyncCounts(row.counts),
    previousRunAt,
    countsDelta: row.counts_delta == null ? null : sanitizeSyncCounts(row.counts_delta),
    source: typeof row.source === 'string' ? row.source : null,
  };
}

/** Ultima execucao gravada, ou null se a tabela estiver vazia. */
export async function loadLatestErpSyncRunLog(): Promise<PersistErpSyncRunLogResult | { ok: true; record: ErpSyncRunLogRow | null }> {
  const query = await resolveQuery();
  if (!query) return { ok: false, reason: 'no_db' };
  try {
    const res = await query(
      `SELECT id, run_at, trigger, status, error, duration_ms, live_connected, counts, previous_run_at, counts_delta, source
         FROM ${ERP_SYNC_RUN_LOG_TABLE}
        ORDER BY run_at DESC
        LIMIT 1`
    );
    const row = res.rows[0];
    return { ok: true, record: row ? mapRow(row) : null };
  } catch (err) {
    if (isUndefinedTable(err)) return { ok: false, reason: 'table_missing' };
    return { ok: false, reason: 'error' };
  }
}

/** Grava a execucao e devolve o delta em relacao a anterior. Nunca lanca. */
export async function persistErpSyncRunLog(input: PersistErpSyncRunLogInput): Promise<PersistErpSyncRunLogResult> {
  const query = await resolveQuery();
  if (!query) return { ok: false, reason: 'no_db' };
  if (!TRIGGERS.has(input.trigger) || !STATUSES.has(input.status)) return { ok: false, reason: 'error' };
  const counts = sanitizeSyncCounts(input.counts);
  try {
    const prevRes = await query(
      `SELECT run_at, counts FROM ${ERP_SYNC_RUN_LOG_TABLE} ORDER BY run_at DESC LIMIT 1`
    );
    const prev = prevRes.rows[0];
    const previousCounts = prev ? sanitizeSyncCounts(prev.counts) : null;
    const previousRunAt = prev?.run_at instanceof Date ? prev.run_at.toISOString() : prev?.run_at ? String(prev.run_at) : null;
    const countsDelta = previousCounts ? computeCountsDelta(counts, previousCounts) : null;
    const inserted = await query(
      `INSERT INTO ${ERP_SYNC_RUN_LOG_TABLE}
         (trigger, status, error, duration_ms, live_connected, counts, previous_run_at, counts_delta, source)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9)
       RETURNING id, run_at, trigger, status, error, duration_ms, live_connected, counts, previous_run_at, counts_delta, source`,
      [
        input.trigger,
        input.status,
        safeError(input.error),
        input.durationMs ?? null,
        input.liveConnected ?? null,
        JSON.stringify(counts),
        previousRunAt,
        countsDelta ? JSON.stringify(countsDelta) : null,
        input.source ?? null,
      ]
    );
    const row = inserted.rows[0];
    if (!row) return { ok: false, reason: 'error' };
    return { ok: true, record: mapRow(row) };
  } catch (err) {
    if (isUndefinedTable(err)) return { ok: false, reason: 'table_missing' };
    return { ok: false, reason: 'error' };
  }
}
