// ============================================================================
// HubSpot Pro CRM - PostgreSQL Persistence & Relational BI Sync Layer
// ============================================================================

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

/**
 * TLS do Postgres (Neon: certificado publico, validado pela cadeia padrao do Node).
 * Antes: TLS com rejectUnauthorized=false — na pratica ja era ignorado quando a URL trazia
 * sslmode=require (o pg-connection-string 2.x sobrepoe o `ssl` explicito e valida o certificado),
 * mas valeria se so PGSSLMODE estivesse definido. Agora a validacao e sempre explicita.
 * Excecao so fora de producao/preview: STI_HUB_PG_TLS_INSECURE=1 (Postgres local com certificado proprio).
 */
export function resolvePostgresSsl(connStr: string): false | { rejectUnauthorized: boolean } {
  const wantsTls =
    process.env.PGSSLMODE === 'require' ||
    process.env.PGSSLMODE === 'verify-full' ||
    /[?&]sslmode=(require|verify-ca|verify-full|prefer)\b/.test(connStr) ||
    /\.neon\.tech\b/i.test(connStr);
  if (!wantsTls) return false;
  const insecureAllowed = process.env.STI_HUB_PG_TLS_INSECURE === '1' && !isPersistenceFailClosed();
  return { rejectUnauthorized: !insecureAllowed };
}

/** Retira da URL os parametros sslmode/uselibpqcompat para que o `ssl` explicito acima valha. */
export function stripSslParams(connStr: string): string {
  try {
    const u = new URL(connStr);
    u.searchParams.delete('sslmode');
    u.searchParams.delete('uselibpqcompat');
    return u.toString();
  } catch {
    return connStr;
  }
}

export function getPostgresPool(): Pool | null {
  const connStr = getDatabaseUrl();
  if (!connStr) return null;
  if (!pgPool) {
    const ssl = resolvePostgresSsl(connStr);
    pgPool = new Pool({
      connectionString: ssl ? stripSslParams(connStr) : connStr,
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: ssl || undefined,
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

  // Neon Free (01/11/2026): o DDL roda numa transacao com advisory lock (serializa instancias
  // frias concorrentes). So aditivo e idempotente.
  const ownClient = executor instanceof Pool ? await executor.connect() : null;
  const c = (ownClient || executor) as Pool | PoolClient;
  try {
    await c.query('BEGIN');
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('sti_hub_schema_v1'))`);
    await runSchemaDdl(c);
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    ownClient?.release();
  }
  schemaEnsured = true;
}

/**
 * DDL aditivo da versao do estado (Neon Free): coluna `version` em crm_kv_store e trigger que
 * a incrementa em QUALQUER UPDATE (inclusive o upsert do codigo antigo durante o corte e um
 * rollback para o deploy anterior). Nada e apagado nem renomeado.
 */
const STATE_VERSION_DDL = `
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'crm_kv_store' AND column_name = 'version'
    ) THEN
      ALTER TABLE crm_kv_store ADD COLUMN version BIGINT NOT NULL DEFAULT 1;
    END IF;
  END
  $$;

  CREATE OR REPLACE FUNCTION crm_kv_store_bump_version() RETURNS trigger AS $$
  BEGIN
    NEW.version := COALESCE(OLD.version, 0) + 1;
    RETURN NEW;
  END
  $$ LANGUAGE plpgsql;

  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE t.tgname = 'crm_kv_store_version_bump' AND c.relname = 'crm_kv_store' AND NOT t.tgisinternal
    ) THEN
      CREATE TRIGGER crm_kv_store_version_bump
        BEFORE UPDATE ON crm_kv_store
        FOR EACH ROW EXECUTE FUNCTION crm_kv_store_bump_version();
    END IF;
  END
  $$;
`;

async function runSchemaDdl(executor: Pool | PoolClient): Promise<void> {
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
  await executor.query(STATE_VERSION_DDL);
}

export const CRM_STATE_KEY = 'crm_state_v1';

/**
 * Producao/preview (Vercel) ou STI_HUB_PG_FAIL_CLOSED=1: banco vazio, falha de leitura ou de
 * gravacao viram 503 — nunca seed, nunca /tmp em silencio.
 */
export function isPersistenceFailClosed(): boolean {
  const vercelEnv = String(process.env.VERCEL_ENV || '').toLowerCase();
  return vercelEnv === 'production' || vercelEnv === 'preview' || process.env.STI_HUB_PG_FAIL_CLOSED === '1';
}

/** Espelhos relacionais (crm_companies...) so com STI_HUB_PG_RELATIONAL_MIRROR=1: nenhum codigo os le. */
export function isRelationalMirrorEnabled(): boolean {
  return process.env.STI_HUB_PG_RELATIONAL_MIRROR === '1';
}

export class PersistenceUnavailableError extends Error {
  readonly code: string;
  constructor(code: 'PG_STATE_MISSING' | 'PG_READ_FAILED' | 'PG_WRITE_FAILED' | 'PG_WRITE_CONFLICT', message: string) {
    super(message);
    this.code = code;
    this.name = 'PersistenceUnavailableError';
  }
}

/** Le so a versao do estado (alguns bytes). null = linha inexistente. */
export async function readStateVersion(): Promise<number | null> {
  const pool = getPostgresPool();
  if (!pool) return null;
  await ensurePostgresSchema();
  const res = await pool.query<{ version: string }>(
    `SELECT version FROM crm_kv_store WHERE key = $1`,
    [CRM_STATE_KEY]
  );
  return res.rows.length ? Number(res.rows[0].version) : null;
}

/**
 * Hash (md5 do texto JSONB) de cada "segmento" do estado: chaves de 1o nivel e, para `erp` e
 * `rbac` (objetos grandes), as de 2o nivel ("erp.invoices"...). ~3 KB no total. Permite que uma
 * instancia releia so os segmentos que outra instancia alterou.
 */
const SEGMENT_HASHES_SQL = (payloadExpr: string) => `(
  SELECT COALESCE(jsonb_object_agg(s.seg, s.h), '{}'::jsonb) FROM (
    SELECT e.key AS seg, md5(e.value::text) AS h FROM jsonb_each(${payloadExpr}) e
      WHERE e.key NOT IN ('erp', 'rbac') OR jsonb_typeof(e.value) <> 'object'
    UNION ALL
    SELECT 'erp.' || x.key, md5(x.value::text) FROM jsonb_each(
      CASE WHEN jsonb_typeof(${payloadExpr}->'erp') = 'object' THEN ${payloadExpr}->'erp' ELSE '{}'::jsonb END) x
    UNION ALL
    SELECT 'rbac.' || x.key, md5(x.value::text) FROM jsonb_each(
      CASE WHEN jsonb_typeof(${payloadExpr}->'rbac') = 'object' THEN ${payloadExpr}->'rbac' ELSE '{}'::jsonb END) x
  ) s
)`;

export type SegmentHashes = Record<string, string>;

/** Le o estado inteiro com a versao e os hashes dos segmentos. null = linha inexistente. */
export async function readStateWithVersion(): Promise<{ state: CrmDatabaseState; version: number; hashes: SegmentHashes } | null> {
  const pool = getPostgresPool();
  if (!pool) return null;
  await ensurePostgresSchema();
  const res = await pool.query<{ payload: CrmDatabaseState; version: string; hashes: SegmentHashes }>(
    `SELECT payload, version, ${SEGMENT_HASHES_SQL('payload')} AS hashes FROM crm_kv_store WHERE key = $1`,
    [CRM_STATE_KEY]
  );
  if (!res.rows.length || !res.rows[0].payload) return null;
  return { state: res.rows[0].payload, version: Number(res.rows[0].version), hashes: res.rows[0].hashes || {} };
}

/** So a versao e os hashes dos segmentos (~3 KB). */
export async function readSegmentHashes(): Promise<{ version: number; hashes: SegmentHashes } | null> {
  const pool = getPostgresPool();
  if (!pool) return null;
  await ensurePostgresSchema();
  const res = await pool.query<{ version: string; hashes: SegmentHashes }>(
    `SELECT version, ${SEGMENT_HASHES_SQL('payload')} AS hashes FROM crm_kv_store WHERE key = $1`,
    [CRM_STATE_KEY]
  );
  if (!res.rows.length) return null;
  return { version: Number(res.rows[0].version), hashes: res.rows[0].hashes || {} };
}

/**
 * Le so os segmentos pedidos ("contacts", "erp.invoices"...), desde que a versao ainda seja
 * `expectedVersion`. null = a versao mudou no meio (o chamador rele tudo).
 */
export async function readSegments(paths: string[], expectedVersion: number): Promise<Record<string, unknown> | null> {
  const pool = getPostgresPool();
  if (!pool) return null;
  await ensurePostgresSchema();
  const res = await pool.query<{ segs: Record<string, unknown> | null }>(
    `SELECT (SELECT jsonb_object_agg(p, payload #> string_to_array(p, '.')) FROM unnest($3::text[]) p) AS segs
       FROM crm_kv_store WHERE key = $1 AND version = $2`,
    [CRM_STATE_KEY, expectedVersion, paths]
  );
  if (!res.rows.length) return null;
  return res.rows[0].segs || {};
}

/**
 * Grava o snapshot so se a versao no banco ainda for `expectedVersion` (UPDATE condicional;
 * o trigger incrementa a versao). expectedVersion null => cria a linha (so se nao existir).
 * Retorna a nova versao, ou null em conflito (outra instancia gravou antes).
 */
export async function writeStateIfVersion(
  json: string,
  expectedVersion: number | null,
  state?: CrmDatabaseState
): Promise<{ version: number; hashes: SegmentHashes } | null> {
  const pool = getPostgresPool();
  if (!pool) return null;
  await ensurePostgresSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res =
      expectedVersion === null
        ? await client.query<{ version: string; hashes: SegmentHashes }>(
            `INSERT INTO crm_kv_store AS k (key, payload, updated_at) VALUES ($1, $2::jsonb, NOW())
             ON CONFLICT (key) DO NOTHING RETURNING version, ${SEGMENT_HASHES_SQL('k.payload')} AS hashes`,
            [CRM_STATE_KEY, json]
          )
        : await client.query<{ version: string; hashes: SegmentHashes }>(
            `UPDATE crm_kv_store AS k SET payload = $2::jsonb, updated_at = NOW()
             WHERE key = $1 AND version = $3 RETURNING version, ${SEGMENT_HASHES_SQL('k.payload')} AS hashes`,
            [CRM_STATE_KEY, json, expectedVersion]
          );
    if (!res.rows.length) {
      await client.query('ROLLBACK');
      return null;
    }
    if (state && isRelationalMirrorEnabled()) {
      await syncRelationalMirrors(client, state);
    }
    await client.query('COMMIT');
    return { version: Number(res.rows[0].version), hashes: res.rows[0].hashes || {} };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Upsert incondicional (CLI de migracao/seed). O app usa writeStateIfVersion. */
export async function syncStateToPostgres(state: CrmDatabaseState): Promise<void> {
  const pool = getPostgresPool();
  if (!pool) return;

  await ensurePostgresSchema();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO crm_kv_store (key, payload, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE
       SET payload = EXCLUDED.payload, updated_at = NOW()`,
      [CRM_STATE_KEY, JSON.stringify(state)]
    );
    if (isRelationalMirrorEnabled()) {
      await syncRelationalMirrors(client, state);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Espelhos relacionais para SQL/BI (DELETE + INSERT de tudo). Desligados por padrao desde
 * 01/11/2026: nenhum codigo do app os le (busca em src/, scripts/, tests/), e regrava-los a cada
 * escrita custava compute e historico no Neon Free. As tabelas continuam existindo (nada apagado);
 * com STI_HUB_PG_RELATIONAL_MIRROR=1 voltam a ser sincronizadas.
 */
async function syncRelationalMirrors(client: PoolClient, state: CrmDatabaseState): Promise<void> {
  {
    await client.query('DELETE FROM crm_companies');
    for (const comp of state.companies) {
      await client.query(
        `INSERT INTO crm_companies (id, name, domain, cnpj, industry, completeness_score, data, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz)`,
        [
          comp.id,
          comp.name,
          comp.domain,
          comp.cnpj,
          comp.industry,
          comp.completenessScore,
          JSON.stringify(comp),
          comp.updatedAt || new Date().toISOString(),
        ]
      );
    }

    await client.query('DELETE FROM crm_contacts');
    for (const c of state.contacts) {
      await client.query(
        `INSERT INTO crm_contacts (id, email, first_name, last_name, company_id, lifecycle_stage, lead_score, completeness_score, data, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::timestamptz)`,
        [
          c.id,
          c.email,
          c.firstName,
          c.lastName,
          c.companyId,
          c.lifecycleStage,
          c.leadScore,
          c.completenessScore,
          JSON.stringify(c),
          c.updatedAt || new Date().toISOString(),
        ]
      );
    }

    await client.query('DELETE FROM crm_pipelines');
    for (const p of state.pipelines) {
      await client.query(
        `INSERT INTO crm_pipelines (id, name, is_default, currency, data, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)`,
        [
          p.id,
          p.name,
          p.isDefault,
          p.currency,
          JSON.stringify(p),
          p.updatedAt || new Date().toISOString(),
        ]
      );
    }

    await client.query('DELETE FROM crm_deals');
    for (const d of state.deals) {
      await client.query(
        `INSERT INTO crm_deals (id, title, value, pipeline_id, stage_id, status, probability, contact_id, company_id, data, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::timestamptz)`,
        [
          d.id,
          d.title,
          d.value,
          d.pipelineId,
          d.stageId,
          d.status,
          d.probability,
          d.contactId,
          d.companyId,
          JSON.stringify(d),
          d.updatedAt || new Date().toISOString(),
        ]
      );
    }

    await client.query('DELETE FROM crm_timeline_events');
    for (const evt of state.timelineEvents) {
      await client.query(
        `INSERT INTO crm_timeline_events (id, type, title, contact_id, company_id, deal_id, data, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz)`,
        [
          evt.id,
          evt.type,
          evt.title,
          evt.contactId,
          evt.companyId,
          evt.dealId,
          JSON.stringify(evt),
          evt.createdAt || new Date().toISOString(),
        ]
      );
    }

    await client.query('DELETE FROM crm_workflows');
    for (const wf of state.workflows) {
      await client.query(
        `INSERT INTO crm_workflows (id, name, trigger_type, is_active, enrolled_count, data, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)`,
        [
          wf.id,
          wf.name,
          wf.triggerType,
          wf.isActive,
          wf.enrolledCount,
          JSON.stringify(wf),
          wf.updatedAt || new Date().toISOString(),
        ]
      );
    }

    await client.query('DELETE FROM crm_sequences');
    for (const seq of state.sequences) {
      await client.query(
        `INSERT INTO crm_sequences (id, name, category, is_active, enrolled_count, reply_rate, data, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz)`,
        [
          seq.id,
          seq.name,
          seq.category,
          seq.isActive,
          seq.enrolledCount,
          seq.replyRate,
          JSON.stringify(seq),
          seq.updatedAt || new Date().toISOString(),
        ]
      );
    }

    await client.query('DELETE FROM crm_data_health_issues');
    for (const iss of state.dataHealthIssues) {
      await client.query(
        `INSERT INTO crm_data_health_issues (id, issue_type, severity, entity_type, primary_entity_id, status, confidence_score, data, detected_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::timestamptz)`,
        [
          iss.id,
          iss.issueType,
          iss.severity,
          iss.entityType,
          iss.primaryEntityId,
          iss.status,
          iss.confidenceScore,
          JSON.stringify(iss),
          iss.detectedAt || new Date().toISOString(),
        ]
      );
    }

    await client.query('DELETE FROM crm_web_forms');
    for (const f of state.webForms || []) {
      await client.query(
        `INSERT INTO crm_web_forms (id, slug, name, target_type, submissions_count, conversion_rate, is_active, data, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::timestamptz)`,
        [
          f.id,
          f.slug,
          f.name,
          f.targetType,
          f.submissionsCount,
          f.conversionRate,
          f.isActive,
          JSON.stringify(f),
          f.updatedAt || new Date().toISOString(),
        ]
      );
    }

    await client.query('DELETE FROM crm_service_tickets');
    for (const t of state.serviceTickets || []) {
      await client.query(
        `INSERT INTO crm_service_tickets (id, key, subject, category, priority, status, sla_status, contact_id, company_id, data, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::timestamptz)`,
        [
          t.id,
          t.key,
          t.subject,
          t.category,
          t.priority,
          t.status,
          t.slaStatus,
          t.contactId,
          t.companyId,
          JSON.stringify(t),
          t.updatedAt || new Date().toISOString(),
        ]
      );
    }

  }
}

export async function loadStateFromPostgres(options?: {
  forceReset?: boolean;
  /** Seed so com intencao explicita (CLI). Em producao/preview, banco vazio => erro, nunca seed. */
  allowSeed?: boolean;
}): Promise<CrmDatabaseState | null> {
  const pool = getPostgresPool();
  if (!pool) return null;

  await ensurePostgresSchema();

  if (!options?.forceReset) {
    const row = await readStateWithVersion();
    if (row) return row.state;
  }

  const seedAllowed = options?.allowSeed === true || !isPersistenceFailClosed();
  if (!seedAllowed) {
    throw new PersistenceUnavailableError(
      'PG_STATE_MISSING',
      'Estado do STI-hub ausente no PostgreSQL: recusado aplicar o seed em producao/preview.'
    );
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
