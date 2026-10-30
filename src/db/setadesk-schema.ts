// ============================================================================
// SetaDesk - Esquema PostgreSQL (migracoes idempotentes e versionadas)
// ----------------------------------------------------------------------------
// Cada migracao roda UMA vez (registrada em setadesk_schema_migrations), dentro
// de transacao e sob advisory lock, e o SQL tambem usa IF NOT EXISTS: reexecutar
// e seguro. Nunca editar uma migracao ja aplicada; criar uma nova.
// ============================================================================

import type { Pool, PoolClient } from 'pg';

export const SETADESK_TICKET_KEY_PREFIX = 'SD';
export const SETADESK_TICKET_SEQUENCE = 'setadesk_ticket_seq';
/** Chave arbitraria (int8) do pg_advisory_xact_lock que serializa migracoes concorrentes. */
const SETADESK_MIGRATION_LOCK_KEY = 794301120261029;

export interface SetaDeskMigration {
  id: string;
  description: string;
  sql: string;
}

export const SETADESK_MIGRATIONS: SetaDeskMigration[] = [
  {
    id: '0001_setadesk_core',
    description:
      'Tickets (chave SD- por sequencia propria), comentarios, anexos, historico, e-mails, outbox, notificacoes',
    sql: `
CREATE SEQUENCE IF NOT EXISTS setadesk_ticket_seq AS BIGINT START WITH 1 INCREMENT BY 1 MINVALUE 1;

CREATE TABLE IF NOT EXISTS setadesk_meta (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS setadesk_queues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS setadesk_tickets (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  legacy_key TEXT,
  subject TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'SUPPORT',
  priority TEXT NOT NULL DEFAULT 'MEDIUM',
  status TEXT NOT NULL DEFAULT 'OPEN',
  channel TEXT NOT NULL DEFAULT 'WEB_PORTAL',
  source TEXT NOT NULL DEFAULT 'STIHUB',
  queue TEXT,
  assignee_agent TEXT,
  requester_email TEXT,
  requester_name TEXT,
  cc_emails TEXT[] NOT NULL DEFAULT '{}',
  contact_id TEXT,
  company_id TEXT,
  deal_id TEXT,
  contract_id TEXT,
  service_order_id TEXT,
  equipment_serial TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  resolution TEXT,
  sla_status TEXT NOT NULL DEFAULT 'ON_TRACK',
  sla_first_response_due_at TIMESTAMPTZ,
  sla_resolution_due_at TIMESTAMPTZ,
  sla_paused_at TIMESTAMPTZ,
  total_paused_minutes INTEGER NOT NULL DEFAULT 0,
  first_responded_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  csat_score INTEGER,
  jira_key TEXT,
  jira_id TEXT,
  jira_project_key TEXT,
  jira_url TEXT,
  external_created_at TIMESTAMPTZ,
  external_updated_at TIMESTAMPTZ,
  external_resolved_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ,
  import_hash TEXT,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT setadesk_tickets_csat_chk CHECK (csat_score IS NULL OR csat_score BETWEEN 1 AND 5)
);
CREATE UNIQUE INDEX IF NOT EXISTS setadesk_tickets_key_uidx ON setadesk_tickets (UPPER(key));
CREATE UNIQUE INDEX IF NOT EXISTS setadesk_tickets_legacy_key_uidx ON setadesk_tickets (UPPER(legacy_key)) WHERE legacy_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS setadesk_tickets_jira_key_uidx ON setadesk_tickets (UPPER(jira_key)) WHERE jira_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS setadesk_tickets_jira_id_uidx ON setadesk_tickets (jira_id) WHERE jira_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS setadesk_tickets_status_idx ON setadesk_tickets (status);
CREATE INDEX IF NOT EXISTS setadesk_tickets_queue_idx ON setadesk_tickets (queue);
CREATE INDEX IF NOT EXISTS setadesk_tickets_requester_idx ON setadesk_tickets (LOWER(requester_email));
CREATE INDEX IF NOT EXISTS setadesk_tickets_company_idx ON setadesk_tickets (company_id);
CREATE INDEX IF NOT EXISTS setadesk_tickets_created_idx ON setadesk_tickets (created_at DESC);

CREATE TABLE IF NOT EXISTS setadesk_ticket_tombstones (
  id TEXT PRIMARY KEY,
  key TEXT,
  deleted_by TEXT,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS setadesk_ticket_comments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES setadesk_tickets(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  author_email TEXT,
  author_role TEXT NOT NULL DEFAULT 'AGENT',
  is_internal BOOLEAN NOT NULL DEFAULT FALSE,
  body TEXT NOT NULL,
  body_html TEXT,
  source TEXT NOT NULL DEFAULT 'STIHUB',
  external_id TEXT,
  email_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS setadesk_comments_external_uidx ON setadesk_ticket_comments (source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS setadesk_comments_ticket_idx ON setadesk_ticket_comments (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS setadesk_email_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT REFERENCES setadesk_tickets(id) ON DELETE SET NULL,
  comment_id TEXT REFERENCES setadesk_ticket_comments(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('INBOUND', 'OUTBOUND')),
  message_id TEXT NOT NULL,
  in_reply_to TEXT,
  references_ids TEXT[] NOT NULL DEFAULT '{}',
  conversation_id TEXT,
  provider TEXT,
  provider_message_id TEXT,
  mailbox TEXT,
  from_email TEXT,
  from_name TEXT,
  to_emails TEXT[] NOT NULL DEFAULT '{}',
  cc_emails TEXT[] NOT NULL DEFAULT '{}',
  subject TEXT,
  kind TEXT NOT NULL DEFAULT 'CUSTOMER',
  is_auto_submitted BOOLEAN NOT NULL DEFAULT FALSE,
  processing_status TEXT NOT NULL DEFAULT 'RECEIVED',
  linked_by TEXT,
  error TEXT,
  headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS setadesk_email_message_id_uidx ON setadesk_email_messages (LOWER(message_id));
CREATE UNIQUE INDEX IF NOT EXISTS setadesk_email_provider_uidx ON setadesk_email_messages (provider, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS setadesk_email_ticket_idx ON setadesk_email_messages (ticket_id);
CREATE INDEX IF NOT EXISTS setadesk_email_conversation_idx ON setadesk_email_messages (conversation_id) WHERE conversation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS setadesk_ticket_attachments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES setadesk_tickets(id) ON DELETE CASCADE,
  comment_id TEXT REFERENCES setadesk_ticket_comments(id) ON DELETE SET NULL,
  email_message_pk TEXT REFERENCES setadesk_email_messages(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  sha256 TEXT,
  storage TEXT NOT NULL CHECK (storage IN ('BLOB', 'JIRA_REF', 'EXTERNAL_URL')),
  blob_pathname TEXT,
  url TEXT,
  content_id TEXT,
  is_inline BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT NOT NULL DEFAULT 'STIHUB',
  external_id TEXT,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS setadesk_attachments_external_uidx ON setadesk_ticket_attachments (source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS setadesk_attachments_ticket_idx ON setadesk_ticket_attachments (ticket_id);

CREATE TABLE IF NOT EXISTS setadesk_ticket_history (
  id BIGSERIAL PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES setadesk_tickets(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  actor TEXT,
  source TEXT NOT NULL DEFAULT 'STIHUB',
  external_id TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS setadesk_history_external_uidx ON setadesk_ticket_history (source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS setadesk_history_ticket_idx ON setadesk_ticket_history (ticket_id, changed_at);

CREATE TABLE IF NOT EXISTS setadesk_related_tickets (
  ticket_id TEXT NOT NULL REFERENCES setadesk_tickets(id) ON DELETE CASCADE,
  related_ticket_id TEXT NOT NULL REFERENCES setadesk_tickets(id) ON DELETE CASCADE,
  reason TEXT,
  score NUMERIC(5,4),
  status TEXT NOT NULL DEFAULT 'SUGGESTED' CHECK (status IN ('SUGGESTED', 'CONFIRMED', 'DISMISSED')),
  suggested_by TEXT NOT NULL DEFAULT 'SYSTEM',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticket_id, related_ticket_id),
  CONSTRAINT setadesk_related_not_self CHECK (ticket_id <> related_ticket_id)
);

CREATE TABLE IF NOT EXISTS setadesk_email_outbox (
  id TEXT PRIMARY KEY,
  ticket_id TEXT REFERENCES setadesk_tickets(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  to_emails TEXT[] NOT NULL DEFAULT '{}',
  cc_emails TEXT[] NOT NULL DEFAULT '{}',
  subject TEXT NOT NULL,
  body_text TEXT,
  body_html TEXT,
  in_reply_to TEXT,
  references_ids TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS setadesk_outbox_dedupe_uidx ON setadesk_email_outbox (dedupe_key);
CREATE INDEX IF NOT EXISTS setadesk_outbox_pending_idx ON setadesk_email_outbox (status, next_attempt_at);

CREATE TABLE IF NOT EXISTS setadesk_integration_outbox (
  id BIGSERIAL PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('SLACK', 'CLICKUP')),
  event TEXT NOT NULL,
  ticket_id TEXT REFERENCES setadesk_tickets(id) ON DELETE SET NULL,
  dedupe_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'CANCELLED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  external_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS setadesk_integration_dedupe_uidx ON setadesk_integration_outbox (dedupe_key);

CREATE TABLE IF NOT EXISTS setadesk_notifications (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  ticket_id TEXT REFERENCES setadesk_tickets(id) ON DELETE CASCADE,
  audience TEXT NOT NULL DEFAULT 'CHAMADOS',
  title TEXT NOT NULL,
  body TEXT,
  dedupe_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS setadesk_notifications_dedupe_uidx ON setadesk_notifications (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS setadesk_notifications_created_idx ON setadesk_notifications (created_at DESC);

CREATE TABLE IF NOT EXISTS setadesk_notification_reads (
  notification_id BIGINT NOT NULL REFERENCES setadesk_notifications(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notification_id, user_id)
);

CREATE TABLE IF NOT EXISTS setadesk_mail_sync_state (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  mailbox TEXT NOT NULL,
  subscription_id TEXT,
  subscription_expires_at TIMESTAMPTZ,
  delta_link TEXT,
  last_polled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`,
  },
];

/**
 * Aplica as migracoes pendentes. Idempotente e segura com varias instancias
 * serverless subindo ao mesmo tempo (advisory lock transacional).
 * Retorna os ids aplicados nesta chamada.
 */
export async function applySetaDeskMigrations(db: Pool | PoolClient): Promise<string[]> {
  const isPool = typeof (db as Pool).connect === 'function' && !(db as PoolClient).release;
  const client: PoolClient = isPool ? await (db as Pool).connect() : (db as PoolClient);
  const applied: string[] = [];
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [SETADESK_MIGRATION_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS setadesk_schema_migrations (
        id TEXT PRIMARY KEY,
        description TEXT,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    const done = await client.query<{ id: string }>('SELECT id FROM setadesk_schema_migrations');
    const doneIds = new Set(done.rows.map((r) => r.id));
    for (const m of SETADESK_MIGRATIONS) {
      if (doneIds.has(m.id)) continue;
      await client.query(m.sql);
      await client.query(
        'INSERT INTO setadesk_schema_migrations (id, description) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
        [m.id, m.description]
      );
      applied.push(m.id);
    }
    await client.query('COMMIT');
    return applied;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // conexao ja perdida
    }
    throw err;
  } finally {
    if (isPool) client.release();
  }
}
