// ============================================================================
// SetaDesk - Esquema PostgreSQL (migracoes idempotentes e versionadas)
// ----------------------------------------------------------------------------
// Cada migracao roda UMA vez (registrada em setadesk_schema_migrations), dentro
// de transacao e sob advisory lock, e o SQL tambem usa IF NOT EXISTS: reexecutar
// e seguro. Nunca editar uma migracao ja aplicada; criar uma nova.
// ============================================================================

import type { Pool, PoolClient } from 'pg';

export const SETADESK_TICKET_SEQUENCE = 'setadesk_ticket_seq';
/** Prefixo padrao (fila Suporte Tecnico). O prefixo SD- saiu em 11/11/2026. */
export const SETADESK_DEFAULT_TICKET_PREFIX = 'TEC';
/** @deprecated Use SETADESK_DEFAULT_TICKET_PREFIX. Mantido como alias do prefixo padrao TEC. */
export const SETADESK_TICKET_KEY_PREFIX = SETADESK_DEFAULT_TICKET_PREFIX;
export const SETADESK_DEFAULT_PIPELINE_ID = 'pl-tec';
/** Projetos Jira importaveis (Service Management). DEV e os demais ficam de fora. */
export const SETADESK_JIRA_IMPORT_PROJECT = 'STT';

export interface SetaDeskPipelineSeed {
  id: string;
  name: string;
  prefix: string;
  mailbox: string;
  jiraProjectKey: string;
  sequenceName: string;
  sortOrder: number;
}

export const SETADESK_SEED_PIPELINES: readonly SetaDeskPipelineSeed[] = [
  {
    id: 'pl-tec',
    name: 'Suporte Técnico',
    prefix: 'TEC',
    mailbox: 'suporte-sti@setatelecom.com.br',
    jiraProjectKey: 'STT',
    sequenceName: 'setadesk_ticket_seq_tec',
    sortOrder: 1,
  },
  {
    id: 'pl-fin',
    name: 'Financeiro',
    prefix: 'FIN',
    mailbox: 'financeiro-sti@setatelecom.com.br',
    jiraProjectKey: 'AF',
    sequenceName: 'setadesk_ticket_seq_fin',
    sortOrder: 2,
  },
] as const;

export const SETADESK_JIRA_IMPORT_PROJECTS = SETADESK_SEED_PIPELINES.map((p) => p.jiraProjectKey);

export function jiraImportSpec(jiraProjectKey: string | null | undefined): SetaDeskPipelineSeed | null {
  const key = String(jiraProjectKey || '').trim().toUpperCase();
  return SETADESK_SEED_PIPELINES.find((p) => p.jiraProjectKey === key) || null;
}

export function pipelineSeedById(id: string | null | undefined): SetaDeskPipelineSeed | null {
  const k = String(id || '').trim();
  return SETADESK_SEED_PIPELINES.find((p) => p.id === k) || null;
}

export function pipelineSeedByPrefix(prefix: string | null | undefined): SetaDeskPipelineSeed | null {
  const p = String(prefix || '').trim().toUpperCase().replace(/-$/, '');
  return SETADESK_SEED_PIPELINES.find((s) => s.prefix === p) || null;
}

/** Prefixo de sequencia gerada para uma fila nova: so [a-z0-9_], max 24. */
export function pipelineSequenceNameFromPrefix(prefix: string): string {
  const slug = String(prefix || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  if (!slug) throw new Error('Prefixo de pipeline invalido.');
  return `setadesk_ticket_seq_${slug}`;
}

export function isAllowedPipelinePrefix(prefix: string): boolean {
  return /^[A-Z][A-Z0-9]{0,7}$/.test(String(prefix || '').trim().toUpperCase());
}

export function formatSetaDeskTicketKey(prefix: string, n: number | string): string {
  return `${String(prefix).trim().toUpperCase().replace(/-$/, '')}-${n}`;
}

/** Chave arbitraria (int8) do pg_advisory_xact_lock que serializa migracoes concorrentes. */
const SETADESK_MIGRATION_LOCK_KEY = 794301120261029;

/** Numero de uma chave PREFIX-n (TEC-123, STT-123, FIN-45). Outros prefixos retornam null. */
export function parseTicketKeyNumber(key: string | null | undefined, prefix: string): number | null {
  const p = String(prefix || '').trim().toUpperCase().replace(/-$/, '');
  if (!p) return null;
  const m = String(key || '').trim().toUpperCase().match(new RegExp(`^${p}-([0-9]+)$`));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Maior numero reservado na fila padrao (TEC / STT).
 * Prefixo legado SD- ainda conta, para nao reemitir um numero ja usado antes da troca.
 * JSM-/DEV-/FIN- nao entram nesta conta.
 */
export function allocatedSetaDeskNumber(ticket: { key?: string | null; jiraKey?: string | null }): number {
  return allocatedNumberForPipeline(ticket, {
    prefix: SETADESK_DEFAULT_TICKET_PREFIX,
    jiraProjectKey: SETADESK_JIRA_IMPORT_PROJECT,
  });
}

export function allocatedNumberForPipeline(
  ticket: { key?: string | null; jiraKey?: string | null },
  pipeline: { prefix: string; jiraProjectKey?: string | null }
): number {
  const prefix = String(pipeline.prefix || '').trim().toUpperCase().replace(/-$/, '');
  const jira = String(pipeline.jiraProjectKey || '').trim().toUpperCase();
  return Math.max(
    parseTicketKeyNumber(ticket.key, prefix) || 0,
    prefix === 'TEC' ? parseTicketKeyNumber(ticket.key, 'SD') || 0 : 0,
    jira ? parseTicketKeyNumber(ticket.jiraKey, jira) || 0 : 0,
    jira ? parseTicketKeyNumber(ticket.key, jira) || 0 : 0
  );
}

export function maxAllocatedSetaDeskNumber(
  tickets: Array<{ key?: string | null; jiraKey?: string | null }>
): number {
  return maxAllocatedNumberForPipeline(tickets, {
    prefix: SETADESK_DEFAULT_TICKET_PREFIX,
    jiraProjectKey: SETADESK_JIRA_IMPORT_PROJECT,
  });
}

export function maxAllocatedNumberForPipeline(
  tickets: Array<{ key?: string | null; jiraKey?: string | null }>,
  pipeline: { prefix: string; jiraProjectKey?: string | null }
): number {
  let max = 0;
  for (const t of tickets) max = Math.max(max, allocatedNumberForPipeline(t, pipeline));
  return max;
}

export function alignPipelineSequenceSql(opts: {
  sequenceName: string;
  prefix: string;
  jiraProjectKey?: string | null;
}): string {
  const seq = opts.sequenceName.replace(/[^a-zA-Z0-9_]/g, '');
  const prefix = String(opts.prefix || '').trim().toUpperCase().replace(/-$/, '').replace(/[^A-Z0-9]/g, '');
  const jira = String(opts.jiraProjectKey || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const jiraMax = jira
    ? `(SELECT COALESCE(MAX((substring(jira_key FROM '^${jira}-([0-9]+)$'))::bigint), 0) FROM setadesk_tickets)`
    : '0';
  const sdLegacy =
    prefix === 'TEC'
      ? `(SELECT COALESCE(MAX((substring(key FROM '^SD-([0-9]+)$'))::bigint), 0) FROM setadesk_tickets)`
      : '0';
  return `
SELECT setval('${seq}', GREATEST(
  (SELECT COALESCE(MAX((substring(key FROM '^${prefix}-([0-9]+)$'))::bigint), 0) FROM setadesk_tickets),
  ${sdLegacy},
  ${jiraMax},
  (SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END FROM ${seq}),
  0) + 1, false)
`.trim();
}

/**
 * Alinha setadesk_ticket_seq para max(SD-n, STT-n em jira_key, valor atual)+1.
 * Idempotente (nunca reduz a sequencia). is_called=false: o proximo nextval devolve esse valor.
 */
export const SETADESK_ALIGN_SEQUENCE_SQL = `
SELECT setval('${SETADESK_TICKET_SEQUENCE}', GREATEST(
  (SELECT COALESCE(MAX((substring(key FROM '^${SETADESK_TICKET_KEY_PREFIX}-([0-9]+)$'))::bigint), 0) FROM setadesk_tickets),
  (SELECT COALESCE(MAX((substring(jira_key FROM '^${SETADESK_JIRA_IMPORT_PROJECT}-([0-9]+)$'))::bigint), 0) FROM setadesk_tickets),
  (SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END FROM ${SETADESK_TICKET_SEQUENCE}),
  0) + 1, false)
`;

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
  {
    id: '0002_align_seq_stt',
    description:
      'Sequencia de chamados novos comeca em max(SD-, STT- em jira_key)+1 para nao colidir com a importacao',
    sql: SETADESK_ALIGN_SEQUENCE_SQL,
  },
  {
    id: '0003_comments_internal_default',
    description:
      'Comentarios novos sao internos por padrao (fail-closed); altera somente setadesk_ticket_comments.is_internal',
    sql: `
ALTER TABLE IF EXISTS setadesk_ticket_comments
  ALTER COLUMN is_internal SET DEFAULT TRUE;
`,
  },
  {
    id: '0004_pipelines_and_history_uidx',
    description:
      'Filas (pipelines) configuraveis com prefixo, caixa e sequencia proprias; pipeline_id nos tickets; indice unico do historico inclui o ticket (corrige colisao de changelog entre STT-112 e STT-113). SD- sai: as chaves passam a ser PREFIX-n (TEC-, FIN-).',
    sql: `
CREATE TABLE IF NOT EXISTS setadesk_pipelines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  mailbox TEXT,
  jira_project_key TEXT,
  sequence_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT setadesk_pipelines_prefix_chk CHECK (prefix ~ '^[A-Z][A-Z0-9]{0,7}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS setadesk_pipelines_prefix_uidx ON setadesk_pipelines (UPPER(prefix));
CREATE UNIQUE INDEX IF NOT EXISTS setadesk_pipelines_name_uidx ON setadesk_pipelines (LOWER(name));

CREATE SEQUENCE IF NOT EXISTS setadesk_ticket_seq_tec AS BIGINT START WITH 1 INCREMENT BY 1 MINVALUE 1;
CREATE SEQUENCE IF NOT EXISTS setadesk_ticket_seq_fin AS BIGINT START WITH 1 INCREMENT BY 1 MINVALUE 1;

INSERT INTO setadesk_pipelines (id, name, prefix, mailbox, jira_project_key, sequence_name, is_active, sort_order)
VALUES
  ('pl-tec', 'Suporte Técnico', 'TEC', 'suporte-sti@setatelecom.com.br', 'STT', 'setadesk_ticket_seq_tec', TRUE, 1),
  ('pl-fin', 'Financeiro', 'FIN', 'financeiro-sti@setatelecom.com.br', 'AF', 'setadesk_ticket_seq_fin', TRUE, 2)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE IF EXISTS setadesk_tickets
  ADD COLUMN IF NOT EXISTS pipeline_id TEXT REFERENCES setadesk_pipelines(id);
CREATE INDEX IF NOT EXISTS setadesk_tickets_pipeline_idx ON setadesk_tickets (pipeline_id);

DROP INDEX IF EXISTS setadesk_history_external_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS setadesk_history_external_uidx
  ON setadesk_ticket_history (ticket_id, source, external_id) WHERE external_id IS NOT NULL;
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
