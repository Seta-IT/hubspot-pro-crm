// ============================================================================
// HubSpot Pro CRM - PostgreSQL Persistence & Relational BI Sync Layer
// ============================================================================

import { Pool, PoolClient } from 'pg';
import { CrmDatabaseState } from './types';
import { createInitialSeedState } from './seed';

let pgPool: Pool | null = null;
let schemaEnsured = false;

export function isPostgresEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0);
}

export function getPostgresPool(): Pool | null {
  if (!isPostgresEnabled()) return null;
  if (!pgPool) {
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl:
        process.env.PGSSLMODE === 'require' ||
        (process.env.DATABASE_URL?.includes('sslmode=require') ?? false)
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

  schemaEnsured = true;
}

export async function syncStateToPostgres(state: CrmDatabaseState): Promise<void> {
  const pool = getPostgresPool();
  if (!pool) return;

  await ensurePostgresSchema(pool);
  const client = await pool.connect();

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

    // 2. Sync relational mirror tables for SQL & BI tools
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

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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
