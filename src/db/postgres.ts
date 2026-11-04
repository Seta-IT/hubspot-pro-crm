// ============================================================================
// HubSpot Pro CRM - PostgreSQL Persistence & Relational BI Sync Layer
// ============================================================================

import { createHash } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { CrmDatabaseState } from './types';
import { createInitialSeedState } from './seed';

let pgPool: Pool | null = null;
let schemaEnsured = false;

export function getDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL || process.env.DATABASE_POSTGRES_URL || "";
  return url.trim().length > 0 ? url.trim() : null;
}

export function isPostgresEnabled(): boolean {
  return getDatabaseUrl() !== null;
}

export function getPostgresPool(): Pool | null {
  const connStr = getDatabaseUrl();
  if (!connStr) return null;
  if (!pgPool) {
    pgPool = new Pool({
      connectionString: connStr,
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl:
        process.env.PGSSLMODE === 'require' ||
        (connStr.includes('sslmode=require'))
          ? { rejectUnauthorized: false }
          : undefined,
    });
  }
  return pgPool;
}

export async function closePostgresPool(): Promise<void> {
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
    schemaEnsured = false;
  }
}

export async function ensurePostgresSchema(poolOrClient?: Pool | PoolClient): Promise<void> {
  const executor = poolOrClient || getPostgresPool();
  if (!executor) return;
  if (schemaEnsured && !poolOrClient) return;

  await executor.query(`
    CREATE TABLE IF NOT EXISTS crm_kv_store (
      key TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS crm_companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT,
      cnpj TEXT,
      industry TEXT,
      completeness_score INT NOT NULL DEFAULT 0,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_crm_companies_domain ON crm_companies(domain);
    CREATE INDEX IF NOT EXISTS idx_crm_companies_cnpj ON crm_companies(cnpj);

    CREATE TABLE IF NOT EXISTS crm_contacts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      company_id TEXT,
      lifecycle_stage TEXT,
      lead_score INT NOT NULL DEFAULT 0,
      completeness_score INT NOT NULL DEFAULT 0,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_crm_contacts_email ON crm_contacts(email);
    CREATE INDEX IF NOT EXISTS idx_crm_contacts_company_id ON crm_contacts(company_id);
    CREATE INDEX IF NOT EXISTS idx_crm_contacts_lead_score ON crm_contacts(lead_score);

    CREATE TABLE IF NOT EXISTS crm_pipelines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      currency TEXT NOT NULL DEFAULT 'BRL',
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS crm_deals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      value DOUBLE PRECISION NOT NULL DEFAULT 0,
      pipeline_id TEXT,
      stage_id TEXT,
      status TEXT,
      probability INT NOT NULL DEFAULT 0,
      contact_id TEXT,
      company_id TEXT,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_crm_deals_stage_id ON crm_deals(stage_id);
    CREATE INDEX IF NOT EXISTS idx_crm_deals_status ON crm_deals(status);
    CREATE INDEX IF NOT EXISTS idx_crm_deals_value ON crm_deals(value);

    CREATE TABLE IF NOT EXISTS crm_timeline_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      contact_id TEXT,
      company_id TEXT,
      deal_id TEXT,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_crm_timeline_contact ON crm_timeline_events(contact_id);
    CREATE INDEX IF NOT EXISTS idx_crm_timeline_deal ON crm_timeline_events(deal_id);

    CREATE TABLE IF NOT EXISTS crm_workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      enrolled_count INT NOT NULL DEFAULT 0,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS crm_sequences (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      enrolled_count INT NOT NULL DEFAULT 0,
      reply_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS crm_data_health_issues (
      id TEXT PRIMARY KEY,
      issue_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      primary_entity_id TEXT NOT NULL,
      status TEXT NOT NULL,
      confidence_score INT NOT NULL DEFAULT 100,
      data JSONB NOT NULL,
      detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_crm_health_status ON crm_data_health_issues(status);

    CREATE TABLE IF NOT EXISTS crm_web_forms (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      target_type TEXT NOT NULL,
      submissions_count INT NOT NULL DEFAULT 0,
      conversion_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS crm_service_tickets (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      subject TEXT NOT NULL,
      category TEXT NOT NULL,
      priority TEXT NOT NULL,
      status TEXT NOT NULL,
      sla_status TEXT NOT NULL,
      contact_id TEXT,
      company_id TEXT,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_crm_tickets_key ON crm_service_tickets(key);
    CREATE INDEX IF NOT EXISTS idx_crm_tickets_status ON crm_service_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_crm_tickets_priority ON crm_service_tickets(priority);
  `);

  // Coluna aditiva usada pela gravação incremental do espelho (idempotente).
  await executor.query(
    MIRROR_TABLES.map((t) => `ALTER TABLE ${t.table} ADD COLUMN IF NOT EXISTS row_hash TEXT;`).join('\n')
  );

  schemaEnsured = true;
}

// ---------------------------------------------------------------------------
// Espelho relacional (crm_companies, crm_contacts, ...): gravação incremental.
//
// Antes cada save fazia DELETE FROM <tabela> + 1 INSERT por linha (~1.200
// inserts só em crm_companies). Agora, por tabela:
//  1. lê do banco (id, row_hash) — 1 SELECT leve;
//  2. calcula o hash (sha1 do JSON do registro) de cada linha do estado;
//  3. faz upsert multi-linha (INSERT ... ON CONFLICT (id) DO UPDATE) só das
//     linhas novas ou alteradas, em lotes;
//  4. apaga só as linhas explicitamente removidas pelo app: ids que estavam no
//     último snapshot conhecido deste processo (load/save anterior) e não
//     estão mais no estado. Sem snapshot => não apaga nada. Lista atual vazia
//     com snapshot grande => não apaga (proteção contra apagar em massa).
// O snapshot completo continua em crm_kv_store (fonte da verdade).
// ---------------------------------------------------------------------------

export interface PgQueryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
}
export interface PgClientLike extends PgQueryable {
  release: () => void;
}
export interface PgPoolLike extends PgQueryable {
  connect: () => Promise<PgClientLike>;
}

type AnyRow = Record<string, any>;

interface MirrorTableSpec {
  table: string;
  columns: string[]; // sem a coluna row_hash (acrescentada automaticamente)
  casts: Record<string, string>;
  rows: (state: CrmDatabaseState) => AnyRow[];
  values: (r: AnyRow) => unknown[];
}

const nowIso = () => new Date().toISOString();

export const MIRROR_TABLES: MirrorTableSpec[] = [
  {
    table: 'crm_companies',
    columns: ['id', 'name', 'domain', 'cnpj', 'industry', 'completeness_score', 'data', 'updated_at'],
    casts: { data: 'jsonb', updated_at: 'timestamptz' },
    rows: (s) => s.companies || [],
    values: (c) => [c.id, c.name, c.domain, c.cnpj, c.industry, c.completenessScore, JSON.stringify(c), c.updatedAt || nowIso()],
  },
  {
    table: 'crm_contacts',
    columns: ['id', 'email', 'first_name', 'last_name', 'company_id', 'lifecycle_stage', 'lead_score', 'completeness_score', 'data', 'updated_at'],
    casts: { data: 'jsonb', updated_at: 'timestamptz' },
    rows: (s) => s.contacts || [],
    values: (c) => [c.id, c.email, c.firstName, c.lastName, c.companyId, c.lifecycleStage, c.leadScore, c.completenessScore, JSON.stringify(c), c.updatedAt || nowIso()],
  },
  {
    table: 'crm_pipelines',
    columns: ['id', 'name', 'is_default', 'currency', 'data', 'updated_at'],
    casts: { data: 'jsonb', updated_at: 'timestamptz' },
    rows: (s) => s.pipelines || [],
    values: (p) => [p.id, p.name, p.isDefault, p.currency, JSON.stringify(p), p.updatedAt || nowIso()],
  },
  {
    table: 'crm_deals',
    columns: ['id', 'title', 'value', 'pipeline_id', 'stage_id', 'status', 'probability', 'contact_id', 'company_id', 'data', 'updated_at'],
    casts: { data: 'jsonb', updated_at: 'timestamptz' },
    rows: (s) => s.deals || [],
    values: (d) => [d.id, d.title, d.value, d.pipelineId, d.stageId, d.status, d.probability, d.contactId, d.companyId, JSON.stringify(d), d.updatedAt || nowIso()],
  },
  {
    table: 'crm_timeline_events',
    columns: ['id', 'type', 'title', 'contact_id', 'company_id', 'deal_id', 'data', 'created_at'],
    casts: { data: 'jsonb', created_at: 'timestamptz' },
    rows: (s) => s.timelineEvents || [],
    values: (e) => [e.id, e.type, e.title, e.contactId, e.companyId, e.dealId, JSON.stringify(e), e.createdAt || nowIso()],
  },
  {
    table: 'crm_workflows',
    columns: ['id', 'name', 'trigger_type', 'is_active', 'enrolled_count', 'data', 'updated_at'],
    casts: { data: 'jsonb', updated_at: 'timestamptz' },
    rows: (s) => s.workflows || [],
    values: (w) => [w.id, w.name, w.triggerType, w.isActive, w.enrolledCount, JSON.stringify(w), w.updatedAt || nowIso()],
  },
  {
    table: 'crm_sequences',
    columns: ['id', 'name', 'category', 'is_active', 'enrolled_count', 'reply_rate', 'data', 'updated_at'],
    casts: { data: 'jsonb', updated_at: 'timestamptz' },
    rows: (s) => s.sequences || [],
    values: (q) => [q.id, q.name, q.category, q.isActive, q.enrolledCount, q.replyRate, JSON.stringify(q), q.updatedAt || nowIso()],
  },
  {
    table: 'crm_data_health_issues',
    columns: ['id', 'issue_type', 'severity', 'entity_type', 'primary_entity_id', 'status', 'confidence_score', 'data', 'detected_at'],
    casts: { data: 'jsonb', detected_at: 'timestamptz' },
    rows: (s) => s.dataHealthIssues || [],
    values: (i) => [i.id, i.issueType, i.severity, i.entityType, i.primaryEntityId, i.status, i.confidenceScore, JSON.stringify(i), i.detectedAt || nowIso()],
  },
  {
    table: 'crm_web_forms',
    columns: ['id', 'slug', 'name', 'target_type', 'submissions_count', 'conversion_rate', 'is_active', 'data', 'updated_at'],
    casts: { data: 'jsonb', updated_at: 'timestamptz' },
    rows: (s) => s.webForms || [],
    values: (f) => [f.id, f.slug, f.name, f.targetType, f.submissionsCount, f.conversionRate, f.isActive, JSON.stringify(f), f.updatedAt || nowIso()],
  },
  {
    table: 'crm_service_tickets',
    columns: ['id', 'key', 'subject', 'category', 'priority', 'status', 'sla_status', 'contact_id', 'company_id', 'data', 'updated_at'],
    casts: { data: 'jsonb', updated_at: 'timestamptz' },
    rows: (s) => s.serviceTickets || [],
    values: (t) => [t.id, t.key, t.subject, t.category, t.priority, t.status, t.slaStatus, t.contactId, t.companyId, JSON.stringify(t), t.updatedAt || nowIso()],
  },
];

/** Tamanho do lote de upsert multi-linha (≤ 11 colunas => bem abaixo de 65535 params). */
export const MIRROR_UPSERT_BATCH = 250;

/** Snapshot (ids conhecidos) por tabela, do último load/save deste processo. */
const mirrorSnapshots = new Map<string, Set<string>>();

export function resetMirrorSnapshots(): void {
  mirrorSnapshots.clear();
}

export function mirrorRowHash(row: AnyRow): string {
  // Hash só do registro (não do updated_at de fallback, que muda a cada save).
  return createHash('sha1').update(JSON.stringify(row)).digest('hex');
}

/** Guarda os ids do estado carregado como snapshot (base das deleções explícitas). */
export function primeMirrorSnapshots(state: CrmDatabaseState): void {
  for (const spec of MIRROR_TABLES) {
    mirrorSnapshots.set(spec.table, new Set(spec.rows(state).map((r) => String(r.id))));
  }
}

export interface MirrorSyncStats {
  table: string;
  upserted: number;
  deleted: number;
  unchanged: number;
  skippedDeletes?: string;
}

async function syncMirrorTable(client: PgQueryable, spec: MirrorTableSpec, state: CrmDatabaseState): Promise<MirrorSyncStats> {
  const rows = spec.rows(state).filter((r) => r && r.id !== undefined && r.id !== null);
  const current = new Map<string, { row: AnyRow; hash: string }>();
  for (const r of rows) current.set(String(r.id), { row: r, hash: mirrorRowHash(r) });

  const dbRes = await client.query(`SELECT id, row_hash FROM ${spec.table}`);
  const dbHash = new Map<string, string | null>();
  for (const r of dbRes.rows || []) dbHash.set(String(r.id), r.row_hash ?? null);

  const changed: Array<{ row: AnyRow; hash: string }> = [];
  for (const [id, entry] of current) {
    if (dbHash.get(id) !== entry.hash) changed.push(entry);
  }

  const cols = [...spec.columns, 'row_hash'];
  const updateSet = cols.filter((c) => c !== 'id').map((c) => `${c} = EXCLUDED.${c}`).join(', ');
  for (let i = 0; i < changed.length; i += MIRROR_UPSERT_BATCH) {
    const batch = changed.slice(i, i + MIRROR_UPSERT_BATCH);
    const params: unknown[] = [];
    const tuples = batch.map(({ row, hash }) => {
      const vals = [...spec.values(row), hash];
      const ph = vals.map((v, j) => {
        params.push(v);
        const cast = spec.casts[cols[j]];
        return `$${params.length}${cast ? `::${cast}` : ''}`;
      });
      return `(${ph.join(', ')})`;
    });
    await client.query(
      `INSERT INTO ${spec.table} (${cols.join(', ')}) VALUES ${tuples.join(', ')} ON CONFLICT (id) DO UPDATE SET ${updateSet}`,
      params
    );
  }

  // Deleções: só o que o app removeu explicitamente (estava no snapshot, saiu do estado).
  const prev = mirrorSnapshots.get(spec.table);
  let deleted = 0;
  let skippedDeletes: string | undefined;
  if (!prev) {
    skippedDeletes = 'sem snapshot carregado neste processo';
  } else {
    const removed = [...prev].filter((id) => !current.has(id) && dbHash.has(id));
    if (removed.length > 0 && current.size === 0 && prev.size > 10) {
      skippedDeletes = `lista atual vazia e snapshot com ${prev.size} linhas: deleção em massa bloqueada`;
      console.warn(`[postgres] ${spec.table}: ${skippedDeletes}`);
    } else if (removed.length > 0) {
      await client.query(`DELETE FROM ${spec.table} WHERE id = ANY($1::text[])`, [removed]);
      deleted = removed.length;
    }
  }

  return { table: spec.table, upserted: changed.length, deleted, unchanged: current.size - changed.length, skippedDeletes };
}

export async function syncStateToPostgres(
  state: CrmDatabaseState,
  options?: { pool?: PgPoolLike }
): Promise<MirrorSyncStats[]> {
  const pool: PgPoolLike | null = options?.pool || (getPostgresPool() as unknown as PgPoolLike | null);
  if (!pool) return [];

  await ensurePostgresSchema(pool as unknown as Pool);
  const client = await pool.connect();
  const stats: MirrorSyncStats[] = [];

  try {
    await client.query('BEGIN');

    // 1. Atomic full state snapshot in crm_kv_store
    await client.query(
      `INSERT INTO crm_kv_store (key, payload, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE
       SET payload = EXCLUDED.payload, updated_at = NOW()`,
      ['crm_state_v1', JSON.stringify(state)]
    );

    // 2. Espelho relacional para SQL/BI: só linhas novas/alteradas/removidas
    for (const spec of MIRROR_TABLES) {
      stats.push(await syncMirrorTable(client, spec, state));
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Só depois do COMMIT o estado salvo vira o novo snapshot.
  primeMirrorSnapshots(state);
  return stats;
}

export async function loadStateFromPostgres(options?: {
  forceReset?: boolean;
}): Promise<CrmDatabaseState | null> {
  const pool = getPostgresPool();
  if (!pool) return null;

  await ensurePostgresSchema(pool);

  if (!options?.forceReset) {
    const res = await pool.query<{ payload: CrmDatabaseState }>(
      `SELECT payload FROM crm_kv_store WHERE key = $1 LIMIT 1`,
      ['crm_state_v1']
    );
    if (res.rows.length > 0 && res.rows[0].payload) {
      primeMirrorSnapshots(res.rows[0].payload);
      return res.rows[0].payload;
    }
  }

  const seed = createInitialSeedState();
  await syncStateToPostgres(seed);
  return seed;
}

export async function checkPostgresHealth(): Promise<{
  enabled: boolean;
  connected: boolean;
  mode: 'postgresql' | 'file-json';
  latencyMs?: number;
  error?: string;
}> {
  if (!isPostgresEnabled()) {
    return {
      enabled: false,
      connected: false,
      mode: 'file-json',
    };
  }

  const pool = getPostgresPool();
  if (!pool) {
    return {
      enabled: true,
      connected: false,
      mode: 'file-json',
      error: 'Pool PostgreSQL não inicializado.',
    };
  }

  const start = Date.now();
  try {
    await pool.query('SELECT 1');
    return {
      enabled: true,
      connected: true,
      mode: 'postgresql',
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      enabled: true,
      connected: false,
      mode: 'file-json',
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Falha na conexão PostgreSQL',
    };
  }
}
