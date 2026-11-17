// ============================================================================
// SetaDesk - Entrada de e-mail: persistencia no PostgreSQL (tabelas setadesk_*).
// Escreve direto nas tabelas (sem passar pelo estado em memoria do router).
// Cada e-mail e processado numa transacao propria.
// ============================================================================

import type { Pool, PoolClient } from 'pg';
import { formatSetaDeskTicketKey } from '../../db/setadesk-schema';
import type {
  EmailMessageRecord,
  IntakePipeline,
  OutboxRecord,
  SetaDeskEmailStore,
  SetaDeskEmailTx,
  StoredTicket,
} from './store';

type Q = Pick<PoolClient, 'query'>;

const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

function rowToStoredTicket(r: Record<string, unknown>): StoredTicket {
  return {
    id: String(r.id),
    key: String(r.key),
    pipelineId: (r.pipeline_id as string | null) ?? null,
    status: String(r.status),
    channel: String(r.channel),
    source: String(r.source || ''),
    subject: String(r.subject || ''),
    requesterEmail: (r.requester_email as string | null) ?? null,
    ccEmails: (r.cc_emails as string[]) || [],
    contactId: (r.contact_id as string | null) ?? null,
    createdAt: iso(r.created_at) || '',
    firstViewedAt: iso(r.first_viewed_at),
    firstViewedBy: (r.first_viewed_by as string | null) ?? null,
  };
}

function rowToOutbox(r: Record<string, unknown>): OutboxRecord {
  return {
    id: String(r.id),
    ticketId: String(r.ticket_id || ''),
    kind: r.kind as OutboxRecord['kind'],
    dedupeKey: String(r.dedupe_key),
    to: (r.to_emails as string[]) || [],
    cc: (r.cc_emails as string[]) || [],
    subject: String(r.subject),
    bodyText: String(r.body_text || ''),
    bodyHtml: String(r.body_html || ''),
    inReplyTo: (r.in_reply_to as string | null) ?? null,
    references: (r.references_ids as string[]) || [],
    fromMailbox: String(r.from_mailbox || ''),
    replyToProviderMessageId: (r.reply_to_provider_message_id as string | null) ?? null,
    status: r.status as OutboxRecord['status'],
    attempts: Number(r.attempts || 0),
    nextAttemptAt: iso(r.next_attempt_at) || '',
    lastError: (r.last_error as string | null) ?? null,
    sentAt: iso(r.sent_at),
  };
}

const rowToPipeline = (r: Record<string, unknown>): IntakePipeline => ({
  id: String(r.id),
  name: String(r.name),
  prefix: String(r.prefix).toUpperCase().replace(/-$/, ''),
  mailbox: (r.mailbox as string | null) ?? null,
  sequenceName: String(r.sequence_name),
  isActive: r.is_active !== false,
});

const syncId = (mailbox: string) => `GRAPH:${mailbox.trim().toLowerCase()}`;

function makeTx(c: Q, contactEmailOf: (id: string) => string | null): SetaDeskEmailTx {
  return {
    async claimEmailMessage(row: EmailMessageRecord) {
      const r = await c.query(
        `INSERT INTO setadesk_email_messages
          (id, ticket_id, comment_id, direction, message_id, in_reply_to, references_ids, conversation_id, provider,
           provider_message_id, mailbox, from_email, from_name, to_emails, cc_emails, subject, kind, is_auto_submitted,
           processing_status, linked_by, headers, received_at, body_text, body_html, attachments)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22,$23,$24,$25::jsonb)
         ON CONFLICT DO NOTHING RETURNING id`,
        [
          row.id, row.ticketId, row.commentId, row.direction, row.messageId, row.inReplyTo, row.references, row.conversationId,
          row.provider, row.providerMessageId, row.mailbox, row.fromEmail, row.fromName, row.to, row.cc, row.subject, row.kind,
          row.isAutoSubmitted, row.processingStatus, row.linkedBy, JSON.stringify(row.headers || {}), row.receivedAt,
          row.bodyText, row.bodyHtml, JSON.stringify(row.attachments || []),
        ]
      );
      return Boolean(r.rowCount);
    },
    async updateEmailMessage(id, patch) {
      await c.query(
        `UPDATE setadesk_email_messages
         SET ticket_id = COALESCE($2, ticket_id), comment_id = COALESCE($3, comment_id),
             processing_status = $4, linked_by = COALESCE($5, linked_by)
         WHERE id = $1`,
        [id, patch.ticketId ?? null, patch.commentId ?? null, patch.processingStatus, patch.linkedBy ?? null]
      );
    },
    async findTicketIdsByMessageIds(ids) {
      if (!ids.length) return [];
      const r = await c.query<{ ticket_id: string }>(
        `SELECT ticket_id FROM setadesk_email_messages
         WHERE LOWER(message_id) = ANY($1::text[]) AND ticket_id IS NOT NULL
         ORDER BY created_at ASC`,
        [ids.map((i) => i.toLowerCase())]
      );
      return [...new Set(r.rows.map((x) => x.ticket_id))];
    },
    async getTicketById(id) {
      const r = await c.query(`SELECT * FROM setadesk_tickets WHERE id = $1`, [id]);
      return r.rows[0] ? rowToStoredTicket(r.rows[0]) : null;
    },
    async getTicketByKey(key) {
      const r = await c.query(`SELECT * FROM setadesk_tickets WHERE UPPER(key) = UPPER($1)`, [key]);
      return r.rows[0] ? rowToStoredTicket(r.rows[0]) : null;
    },
    async contactEmailOf(contactId) {
      return contactId ? contactEmailOf(contactId) : null;
    },
    async nextTicketKey(pl) {
      const seq = pl.sequenceName.replace(/[^a-zA-Z0-9_]/g, '');
      if (!seq) throw new Error('SEQUENCE_INVALID');
      const r = await c.query<{ n: string }>(`SELECT nextval('${seq}')::text AS n`);
      return formatSetaDeskTicketKey(pl.prefix, r.rows[0].n);
    },
    async insertTicket(t) {
      await c.query(
        `INSERT INTO setadesk_tickets
          (id, key, subject, description, category, priority, status, channel, source, pipeline_id, queue,
           requester_email, requester_name, cc_emails, contact_id, company_id, tags, sla_status,
           sla_first_response_due_at, sla_resolution_due_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,'OPEN','EMAIL','EMAIL',$7,$8,$9,$10,$11,$12,$13,$14,'ON_TRACK',$15,$16,$17,$17)`,
        [
          t.id, t.key, t.subject, t.description, t.category, t.priority, t.pipelineId, t.queue,
          t.requesterEmail.toLowerCase(), t.requesterName, t.ccEmails, t.contactId, t.companyId,
          [t.category, t.priority, 'EMAIL'], t.slaFirstResponseDueAt, t.slaResolutionDueAt, t.createdAt,
        ]
      );
    },
    async insertComment(cm) {
      await c.query(
        `INSERT INTO setadesk_ticket_comments
          (id, ticket_id, author, author_email, author_role, is_internal, body, body_html, source, email_message_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
        [cm.id, cm.ticketId, cm.author, cm.authorEmail, cm.authorRole, cm.isInternal, cm.body, cm.bodyHtml, cm.source, cm.emailMessageId, cm.createdAt]
      );
    },
    async setTicketStatus(id, from, to, actor) {
      const r = await c.query(`UPDATE setadesk_tickets SET status = $3, updated_at = NOW() WHERE id = $1 AND status = $2`, [id, from, to]);
      if (r.rowCount) {
        await c.query(
          `INSERT INTO setadesk_ticket_history (ticket_id, field, old_value, new_value, actor, source)
           VALUES ($1, 'status', $2::jsonb, $3::jsonb, $4, 'EMAIL')`,
          [id, JSON.stringify(from), JSON.stringify(to), actor]
        );
      }
    },
    async touchTicket(id) {
      await c.query(`UPDATE setadesk_tickets SET updated_at = NOW() WHERE id = $1`, [id]);
    },
    async findRecentRequesterTickets(email, sinceIso, excludeId) {
      const r = await c.query(
        `SELECT * FROM setadesk_tickets
         WHERE LOWER(requester_email) = LOWER($1) AND created_at >= $2 AND id <> $3
         ORDER BY created_at DESC LIMIT 20`,
        [email, sinceIso, excludeId]
      );
      return r.rows.map(rowToStoredTicket);
    },
    async insertRelatedSuggestion(ticketId, relatedId, reason, score) {
      await c.query(
        `INSERT INTO setadesk_related_tickets (ticket_id, related_ticket_id, reason, score, status, suggested_by)
         VALUES ($1, $2, $3, $4, 'SUGGESTED', 'SYSTEM') ON CONFLICT DO NOTHING`,
        [ticketId, relatedId, reason, score]
      );
    },
    async enqueueOutbox(o) {
      const r = await c.query(
        `INSERT INTO setadesk_email_outbox
          (id, ticket_id, kind, dedupe_key, to_emails, cc_emails, subject, body_text, body_html, in_reply_to,
           references_ids, status, attempts, next_attempt_at, from_mailbox, reply_to_provider_message_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PENDING',0,$12,$13,$14)
         ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
        [o.id, o.ticketId, o.kind, o.dedupeKey, o.to, o.cc, o.subject, o.bodyText, o.bodyHtml, o.inReplyTo, o.references, o.nextAttemptAt, o.fromMailbox, o.replyToProviderMessageId]
      );
      return Boolean(r.rowCount);
    },
    async insertNotification(type, ticketId, title, body, dedupeKey) {
      await c.query(
        `INSERT INTO setadesk_notifications (type, ticket_id, title, body, dedupe_key) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [type, ticketId, title, body, dedupeKey]
      );
    },
    async originalInboundMessage(ticketId) {
      const r = await c.query(
        `SELECT message_id, provider_message_id, references_ids, mailbox FROM setadesk_email_messages
         WHERE ticket_id = $1 AND direction = 'INBOUND' AND linked_by = 'NEW_TICKET' ORDER BY created_at ASC LIMIT 1`,
        [ticketId]
      );
      const row = r.rows[0];
      return row
        ? { messageId: String(row.message_id), providerMessageId: row.provider_message_id ?? null, references: row.references_ids || [], mailbox: String(row.mailbox || '') }
        : null;
    },
    async getPipelineById(id) {
      if (!id) return null;
      const r = await c.query(`SELECT * FROM setadesk_pipelines WHERE id = $1`, [id]);
      return r.rows[0] ? rowToPipeline(r.rows[0]) : null;
    },
  };
}

export function createPostgresSetaDeskEmailStore(
  pool: Pool,
  opts: { contactEmailOf?: (contactId: string) => string | null } = {}
): SetaDeskEmailStore {
  const contactEmailOf = opts.contactEmailOf || (() => null);
  return {
    async listPipelines() {
      const r = await pool.query(`SELECT * FROM setadesk_pipelines ORDER BY sort_order ASC, name ASC`);
      return r.rows.map(rowToPipeline);
    },
    async withTx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(makeTx(client, contactEmailOf));
        await client.query('COMMIT');
        return out;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // conexao perdida
        }
        throw err;
      } finally {
        client.release();
      }
    },
    async getSyncState(mailbox) {
      const r = await pool.query(`SELECT delta_link, intake_started_at FROM setadesk_mail_sync_state WHERE id = $1`, [syncId(mailbox)]);
      const row = r.rows[0];
      return row ? { deltaLink: row.delta_link ?? null, intakeStartedAt: iso(row.intake_started_at) } : null;
    },
    async saveSyncState(mailbox, patch) {
      await pool.query(
        `INSERT INTO setadesk_mail_sync_state (id, provider, mailbox, delta_link, intake_started_at, last_error_code, last_polled_at, last_success_at, updated_at)
         VALUES ($1, 'GRAPH', $2, $4, COALESCE($5::timestamptz, NOW()), $7, NOW(), CASE WHEN $6 AND $7::text IS NULL THEN NOW() END, NOW())
         ON CONFLICT (id) DO UPDATE SET
           delta_link = CASE WHEN $3 THEN EXCLUDED.delta_link ELSE setadesk_mail_sync_state.delta_link END,
           intake_started_at = COALESCE(setadesk_mail_sync_state.intake_started_at, EXCLUDED.intake_started_at),
           last_error_code = CASE WHEN $6 THEN $7 ELSE setadesk_mail_sync_state.last_error_code END,
           last_success_at = CASE WHEN $6 AND $7::text IS NULL THEN NOW() ELSE setadesk_mail_sync_state.last_success_at END,
           last_polled_at = NOW(),
           updated_at = NOW()`,
        [
          syncId(mailbox),
          mailbox.trim().toLowerCase(),
          patch.deltaLink !== undefined,
          patch.deltaLink ?? null,
          patch.intakeStartedAt ?? null,
          patch.errorCode !== undefined,
          patch.errorCode ?? null,
        ]
      );
    },
    async claimDueOutbox(limit, nowIso) {
      const r = await pool.query(
        `UPDATE setadesk_email_outbox SET status = 'SENDING', attempts = attempts + 1, sending_started_at = NOW()
         WHERE id IN (
           SELECT id FROM setadesk_email_outbox
           WHERE status = 'PENDING' AND next_attempt_at <= $2 AND from_mailbox IS NOT NULL AND ticket_id IS NOT NULL
           ORDER BY next_attempt_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED)
         RETURNING *`,
        [limit, nowIso]
      );
      return r.rows.map(rowToOutbox);
    },
    async completeOutbox(id, res) {
      await pool.query(
        `UPDATE setadesk_email_outbox
         SET status = $2, next_attempt_at = COALESCE($3::timestamptz, next_attempt_at), last_error = $4,
             sent_at = COALESCE($5::timestamptz, sent_at), sending_started_at = NULL
         WHERE id = $1 AND status = 'SENDING'`,
        [id, res.status, res.nextAttemptAt ?? null, res.lastError ?? null, res.sentAt ?? null]
      );
    },
    async failStaleSending(staleMinutes, nowIso) {
      const r = await pool.query(
        `UPDATE setadesk_email_outbox SET status = 'FAILED', last_error = 'SENDING_TIMEOUT', sending_started_at = NULL
         WHERE status = 'SENDING' AND sending_started_at < ($1::timestamptz - make_interval(mins => $2::int))`,
        [nowIso, staleMinutes]
      );
      return r.rowCount || 0;
    },
    async markFirstViewed(idOrKey, viewer, nowIso) {
      const r = await pool.query(
        `UPDATE setadesk_tickets SET first_viewed_at = $3, first_viewed_by = $2
         WHERE (id = $1 OR UPPER(key) = UPPER($1)) AND first_viewed_at IS NULL
         RETURNING *`,
        [idOrKey, viewer, nowIso]
      );
      if (r.rows[0]) return { ticket: rowToStoredTicket(r.rows[0]), firstTime: true };
      const cur = await pool.query(`SELECT * FROM setadesk_tickets WHERE id = $1 OR UPPER(key) = UPPER($1) LIMIT 1`, [idOrKey]);
      return cur.rows[0] ? { ticket: rowToStoredTicket(cur.rows[0]), firstTime: false } : null;
    },
    async getTicketByIdOrKey(idOrKey) {
      const r = await pool.query(`SELECT * FROM setadesk_tickets WHERE id = $1 OR UPPER(key) = UPPER($1) LIMIT 1`, [idOrKey]);
      return r.rows[0] ? rowToStoredTicket(r.rows[0]) : null;
    },
  };
}
