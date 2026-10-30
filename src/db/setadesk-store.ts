// ============================================================================
// SetaDesk - Camada de dados dos chamados no PostgreSQL
// ----------------------------------------------------------------------------
// Ativa somente quando DATABASE_URL (ou DATABASE_POSTGRES_URL) existe. Sem ela,
// o repositorio continua no comportamento atual (estado em memoria + arquivo
// JSON + snapshot crm_kv_store), sem nenhuma chamada a este modulo.
//
// Modelo de uso por requisicao (router.handle):
//   1. loadSetaDeskTickets(): le os chamados das tabelas setadesk_* (fonte de
//      verdade) e devolve uma "linha de base" (fingerprint por chamado);
//   2. reserveSetaDeskTicketKeys(n): reserva chaves SD-<n> na sequencia propria
//      antes de rotas que criam chamados;
//   3. syncSetaDeskTickets(): grava apenas chamados novos/alterados (upsert por
//      id), comentarios novos (insert idempotente por id), historico de campos
//      e notificacao de chamado novo; remove os que foram apagados.
// ============================================================================

import crypto from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { getPostgresPool, isPostgresEnabled } from './postgres';
import {
  applySetaDeskMigrations,
  SETADESK_TICKET_KEY_PREFIX,
  SETADESK_TICKET_SEQUENCE,
} from './setadesk-schema';
import type { ServiceTicket, TicketComment } from './types';

let schemaReady: Promise<string[]> | null = null;

export function isSetaDeskPostgresEnabled(): boolean {
  return isPostgresEnabled();
}

/** Garante as migracoes uma vez por processo (reexecuta se a anterior falhou). */
export async function ensureSetaDeskSchema(pool?: Pool): Promise<string[]> {
  const db = pool || getPostgresPool();
  if (!db) return [];
  if (!schemaReady) {
    schemaReady = applySetaDeskMigrations(db).catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

/** Somente para testes. */
export function resetSetaDeskSchemaCache(): void {
  schemaReady = null;
}

export function formatSetaDeskTicketKey(n: number | string): string {
  return `${SETADESK_TICKET_KEY_PREFIX}-${n}`;
}

export function fingerprintTicket(t: ServiceTicket): string {
  return crypto.createHash('sha1').update(JSON.stringify(t)).digest('hex');
}

export type SetaDeskBaseline = Map<string, string>;

export function buildBaseline(tickets: ServiceTicket[]): SetaDeskBaseline {
  return new Map(tickets.map((t) => [t.id, fingerprintTicket(t)]));
}

/** Calcula o que mudou desde a linha de base (puro; testavel sem banco). */
export function diffTicketsAgainstBaseline(
  tickets: ServiceTicket[],
  baseline: SetaDeskBaseline
): { changed: ServiceTicket[]; deletedIds: string[] } {
  const changed: ServiceTicket[] = [];
  const present = new Set<string>();
  for (const t of tickets) {
    present.add(t.id);
    const fp = baseline.get(t.id);
    if (fp === undefined || fp !== fingerprintTicket(t)) changed.push(t);
  }
  const deletedIds = [...baseline.keys()].filter((id) => !present.has(id));
  return { changed, deletedIds };
}

const iso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
};

const ts = (v: string | null | undefined): string | null => {
  if (!v) return null;
  const d = Date.parse(v);
  return Number.isFinite(d) ? new Date(d).toISOString() : null;
};

const normEmail = (e: string | null | undefined): string | null => {
  const v = (e || '').trim().toLowerCase();
  return v ? v : null;
};

type TicketRow = Record<string, unknown>;
type CommentRow = Record<string, unknown>;

export function rowToServiceTicket(r: TicketRow, comments: TicketComment[]): ServiceTicket {
  const queue = (r.queue as string | null) ?? '';
  const t: ServiceTicket = {
    id: String(r.id),
    key: String(r.key),
    subject: String(r.subject),
    description: String(r.description ?? ''),
    category: r.category as ServiceTicket['category'],
    priority: r.priority as ServiceTicket['priority'],
    status: r.status as ServiceTicket['status'],
    channel: r.channel as ServiceTicket['channel'],
    contactId: (r.contact_id as string | null) ?? null,
    companyId: (r.company_id as string | null) ?? null,
    dealId: (r.deal_id as string | null) ?? null,
    assignee: queue,
    contractId: (r.contract_id as string | null) ?? null,
    serviceOrderId: (r.service_order_id as string | null) ?? null,
    equipmentSerial: (r.equipment_serial as string | null) ?? null,
    slaPausedAt: iso(r.sla_paused_at),
    totalPausedMinutes: Number(r.total_paused_minutes ?? 0),
    resolution: (r.resolution as string | null) ?? null,
    slaFirstResponseDueAt: iso(r.sla_first_response_due_at) || iso(r.created_at) || '',
    slaResolutionDueAt: iso(r.sla_resolution_due_at) || iso(r.created_at) || '',
    firstRespondedAt: iso(r.first_responded_at),
    resolvedAt: iso(r.resolved_at),
    slaStatus: r.sla_status as ServiceTicket['slaStatus'],
    csatScore: r.csat_score === null || r.csat_score === undefined ? null : Number(r.csat_score),
    tags: (r.tags as string[]) || [],
    comments,
    createdAt: iso(r.created_at) || '',
    updatedAt: iso(r.updated_at) || '',
    queue: queue || null,
    assigneeAgent: (r.assignee_agent as string | null) ?? null,
    requesterEmail: (r.requester_email as string | null) ?? null,
    requesterName: (r.requester_name as string | null) ?? null,
    ccEmails: (r.cc_emails as string[]) || [],
    source: String(r.source || 'STIHUB'),
    legacyKey: (r.legacy_key as string | null) ?? null,
    jiraKey: (r.jira_key as string | null) ?? null,
    jiraId: (r.jira_id as string | null) ?? null,
    closedAt: iso(r.closed_at),
  };
  return t;
}

export function rowToComment(r: CommentRow): TicketComment {
  return {
    id: String(r.id),
    author: String(r.author),
    authorRole: (r.author_role as TicketComment['authorRole']) || 'AGENT',
    isInternal: Boolean(r.is_internal),
    body: String(r.body),
    createdAt: iso(r.created_at) || '',
    authorEmail: (r.author_email as string | null) ?? null,
    source: String(r.source || 'STIHUB'),
    externalId: (r.external_id as string | null) ?? null,
    emailMessageId: (r.email_message_id as string | null) ?? null,
  };
}

const TICKET_COLUMNS = [
  'id', 'key', 'legacy_key', 'subject', 'description', 'category', 'priority', 'status', 'channel',
  'source', 'queue', 'assignee_agent', 'requester_email', 'requester_name', 'cc_emails',
  'contact_id', 'company_id', 'deal_id', 'contract_id', 'service_order_id', 'equipment_serial',
  'tags', 'resolution', 'sla_status', 'sla_first_response_due_at', 'sla_resolution_due_at',
  'sla_paused_at', 'total_paused_minutes', 'first_responded_at', 'resolved_at', 'closed_at',
  'csat_score', 'jira_key', 'jira_id', 'created_at', 'updated_at',
] as const;

function ticketToParams(t: ServiceTicket): unknown[] {
  const isSdKey = new RegExp(`^${SETADESK_TICKET_KEY_PREFIX}-\\d+$`, 'i').test(t.key);
  const closedAt =
    t.closedAt !== undefined ? ts(t.closedAt) : t.status === 'CLOSED' ? ts(t.updatedAt) : null;
  return [
    t.id,
    t.key,
    t.legacyKey ?? (isSdKey ? null : t.key),
    t.subject,
    t.description ?? '',
    t.category,
    t.priority,
    t.status,
    t.channel,
    t.source || 'STIHUB',
    t.assignee || t.queue || null,
    t.assigneeAgent ?? null,
    normEmail(t.requesterEmail),
    t.requesterName ?? null,
    (t.ccEmails || []).map((e) => e.trim().toLowerCase()).filter(Boolean),
    t.contactId ?? null,
    t.companyId ?? null,
    t.dealId ?? null,
    t.contractId ?? null,
    t.serviceOrderId ?? null,
    t.equipmentSerial ?? null,
    t.tags || [],
    t.resolution ?? null,
    t.slaStatus || 'ON_TRACK',
    ts(t.slaFirstResponseDueAt),
    ts(t.slaResolutionDueAt),
    ts(t.slaPausedAt),
    Math.round(Number(t.totalPausedMinutes || 0)),
    ts(t.firstRespondedAt),
    ts(t.resolvedAt),
    closedAt,
    t.csatScore ?? null,
    t.jiraKey ?? null,
    t.jiraId ?? null,
    ts(t.createdAt) || new Date().toISOString(),
    ts(t.updatedAt) || new Date().toISOString(),
  ];
}

const UPSERT_TICKET_SQL = `
INSERT INTO setadesk_tickets (${TICKET_COLUMNS.join(', ')})
VALUES (${TICKET_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')})
ON CONFLICT (id) DO UPDATE SET
${TICKET_COLUMNS.filter((c) => c !== 'id' && c !== 'created_at')
  .map((c) => `  ${c} = EXCLUDED.${c}`)
  .join(',\n')}`;

const INSERT_COMMENT_SQL = `
INSERT INTO setadesk_ticket_comments
  (id, ticket_id, author, author_email, author_role, is_internal, body, source, external_id, email_message_id, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT DO NOTHING`;

// Comentarios sao append-only no Postgres: ON CONFLICT DO NOTHING impede que um estado
// em memoria altere corpo, autor, papel ou visibilidade (isInternal) de comentario ja gravado.
async function insertComments(client: PoolClient, ticketId: string, comments: TicketComment[]) {
  for (const c of comments) {
    await client.query(INSERT_COMMENT_SQL, [
      c.id,
      ticketId,
      c.author || 'Sistema',
      normEmail(c.authorEmail),
      c.authorRole || 'AGENT',
      Boolean(c.isInternal),
      c.body ?? '',
      c.source || 'STIHUB',
      c.externalId ?? null,
      c.emailMessageId ?? null,
      ts(c.createdAt) || new Date().toISOString(),
    ]);
  }
}

/**
 * Reconcilia os chamados que vivem no snapshot legado (crm_kv_store / arquivo)
 * com as tabelas SetaDesk, preservando id, chave original (como legacy_key) e
 * datas. Copia os que faltam (exceto os apagados no SetaDesk, via tombstone) e
 * atualiza os que estao mais novos no legado (ex.: editados por uma versao
 * anterior do app antes do deploy). Nao e importacao do Jira.
 * Retorna quantos chamados foram gravados.
 */
async function reconcileFromLegacyState(
  client: PoolClient,
  legacyTickets: ServiceTicket[],
  current: Map<string, string>
): Promise<number> {
  if (!legacyTickets.length) return 0;
  const candidates = legacyTickets.filter((t) => {
    const at = current.get(t.id);
    if (at === undefined) return true;
    return Date.parse(t.updatedAt) > Date.parse(at);
  });
  if (!candidates.length) return 0;
  await client.query('SELECT pg_advisory_xact_lock($1)', [794301120261030]);
  const tomb = await client.query<{ id: string }>(
    `SELECT id FROM setadesk_ticket_tombstones WHERE id = ANY($1::text[])`,
    [candidates.map((t) => t.id)]
  );
  const dead = new Set(tomb.rows.map((r) => r.id));
  let written = 0;
  for (const t of candidates) {
    if (dead.has(t.id)) continue;
    const r = current.has(t.id)
      ? await client.query(`${UPSERT_TICKET_SQL} WHERE setadesk_tickets.updated_at < EXCLUDED.updated_at`, ticketToParams(t))
      : await client.query(`${UPSERT_TICKET_SQL.split('ON CONFLICT')[0]} ON CONFLICT DO NOTHING`, ticketToParams(t));
    if (r.rowCount) {
      written += 1;
      await insertComments(client, t.id, t.comments || []);
    }
  }
  if (written) {
    await alignSequenceWithExistingKeys(client);
    await client.query(
      `INSERT INTO setadesk_meta (key, value, updated_at) VALUES ('legacy_reconcile', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify({ written, at: new Date().toISOString() })]
    );
  }
  return written;
}

/** Garante que a sequencia nunca emita uma chave SD- ja usada. */
async function alignSequenceWithExistingKeys(client: PoolClient) {
  await client.query(
    `SELECT setval('${SETADESK_TICKET_SEQUENCE}', GREATEST(
       (SELECT COALESCE(MAX((substring(key FROM '^${SETADESK_TICKET_KEY_PREFIX}-([0-9]+)$'))::bigint), 0) FROM setadesk_tickets),
       (SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END FROM ${SETADESK_TICKET_SEQUENCE}),
       0) + 1, false)`
  );
}

/** Le todos os chamados (com comentarios) das tabelas SetaDesk. */
export async function loadSetaDeskTickets(
  legacyTickets: ServiceTicket[] = []
): Promise<{ tickets: ServiceTicket[]; baseline: SetaDeskBaseline } | null> {
  const pool = getPostgresPool();
  if (!pool) return null;
  await ensureSetaDeskSchema(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const readAll = async () => ({
      t: await client.query(`SELECT * FROM setadesk_tickets ORDER BY created_at DESC, key DESC`),
      c: await client.query(`SELECT * FROM setadesk_ticket_comments ORDER BY created_at ASC, id ASC`),
    });
    let { t: tRes, c: cRes } = await readAll();
    const current = new Map<string, string>(
      tRes.rows.map((r) => [String(r.id), iso(r.updated_at) || ''])
    );
    if (await reconcileFromLegacyState(client, legacyTickets, current)) {
      ({ t: tRes, c: cRes } = await readAll());
    }
    await client.query('COMMIT');
    const byTicket = new Map<string, TicketComment[]>();
    for (const row of cRes.rows) {
      const list = byTicket.get(String(row.ticket_id)) || [];
      list.push(rowToComment(row));
      byTicket.set(String(row.ticket_id), list);
    }
    const tickets = tRes.rows.map((r) => rowToServiceTicket(r, byTicket.get(String(r.id)) || []));
    return { tickets, baseline: buildBaseline(tickets) };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignora
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Reserva `count` chaves SD-<n> na sequencia (numeros nao usados viram lacunas, como em qualquer sequencia). */
export async function reserveSetaDeskTicketKeys(count: number): Promise<string[]> {
  const pool = getPostgresPool();
  if (!pool || count <= 0) return [];
  await ensureSetaDeskSchema(pool);
  const n = Math.min(Math.max(1, Math.floor(count)), 500);
  const r = await pool.query<{ n: string }>(
    `SELECT nextval('${SETADESK_TICKET_SEQUENCE}')::text AS n FROM generate_series(1, $1)`,
    [n]
  );
  return r.rows.map((row) => formatSetaDeskTicketKey(row.n));
}

const HISTORY_FIELDS: Array<{ field: string; col: string; get: (t: ServiceTicket) => unknown }> = [
  { field: 'status', col: 'status', get: (t) => t.status },
  { field: 'priority', col: 'priority', get: (t) => t.priority },
  { field: 'category', col: 'category', get: (t) => t.category },
  { field: 'queue', col: 'queue', get: (t) => t.assignee || t.queue || null },
  { field: 'assigneeAgent', col: 'assignee_agent', get: (t) => t.assigneeAgent ?? null },
  { field: 'slaStatus', col: 'sla_status', get: (t) => t.slaStatus },
  // Defesa/auditoria: campos sensiveis que so mudam por caminhos proprios (CSAT do portal, triagem).
  { field: 'csatScore', col: 'csat_score', get: (t) => t.csatScore ?? null },
  { field: 'contactId', col: 'contact_id', get: (t) => t.contactId ?? null },
];

/** Grava chamados novos/alterados e remove os apagados, numa unica transacao. */
export async function syncSetaDeskTickets(
  tickets: ServiceTicket[],
  baseline: SetaDeskBaseline,
  actor?: string | null
): Promise<{ upserted: number; deleted: number }> {
  const { changed, deletedIds } = diffTicketsAgainstBaseline(tickets, baseline);
  if (changed.length === 0 && deletedIds.length === 0) return { upserted: 0, deleted: 0 };
  const pool = getPostgresPool();
  if (!pool) return { upserted: 0, deleted: 0 };
  await ensureSetaDeskSchema(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const prev = new Map<string, TicketRow>();
    if (changed.length) {
      const r = await client.query(`SELECT * FROM setadesk_tickets WHERE id = ANY($1::text[]) FOR UPDATE`, [
        changed.map((t) => t.id),
      ]);
      for (const row of r.rows) prev.set(String(row.id), row);
    }
    for (const t of changed) {
      if (!prev.has(t.id)) {
        // Chamado novo cuja chave colide com outro (ex.: chave local de fallback): reemite pela sequencia.
        const clash = await client.query(
          `SELECT 1 FROM setadesk_tickets WHERE UPPER(key) = UPPER($1) AND id <> $2 LIMIT 1`,
          [t.key, t.id]
        );
        if (clash.rowCount) {
          const r = await client.query<{ n: string }>(`SELECT nextval('${SETADESK_TICKET_SEQUENCE}')::text AS n`);
          if (!t.legacyKey) t.legacyKey = null;
          t.key = formatSetaDeskTicketKey(r.rows[0].n);
        }
      }
      await client.query(UPSERT_TICKET_SQL, ticketToParams(t));
      await insertComments(client, t.id, t.comments || []);
      const old = prev.get(t.id);
      if (!old) {
        await client.query(
          `INSERT INTO setadesk_notifications (type, ticket_id, title, body, dedupe_key)
           VALUES ('TICKET_CREATED', $1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [t.id, `Novo chamado ${t.key}`, t.subject, `TICKET_CREATED:${t.id}`]
        );
        continue;
      }
      for (const h of HISTORY_FIELDS) {
        const before = (old[h.col] as unknown) ?? null;
        const after = h.get(t) ?? null;
        if (String(before ?? '') !== String(after ?? '')) {
          await client.query(
            `INSERT INTO setadesk_ticket_history (ticket_id, field, old_value, new_value, actor, source)
             VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, 'STIHUB')`,
            [t.id, h.field, JSON.stringify(before), JSON.stringify(after), actor || null]
          );
        }
      }
    }
    if (deletedIds.length) {
      await client.query(
        `INSERT INTO setadesk_ticket_tombstones (id, key, deleted_by)
         SELECT id, key, $2 FROM setadesk_tickets WHERE id = ANY($1::text[])
         ON CONFLICT (id) DO NOTHING`,
        [deletedIds, actor || null]
      );
      await client.query(`DELETE FROM setadesk_tickets WHERE id = ANY($1::text[])`, [deletedIds]);
    }
    await client.query('COMMIT');
    for (const t of changed) baseline.set(t.id, fingerprintTicket(t));
    for (const id of deletedIds) baseline.delete(id);
    return { upserted: changed.length, deleted: deletedIds.length };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignora
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Quantas chaves reservar antes da rota (somente rotas que criam chamados). */
export function ticketKeysNeededForRoute(
  method: string,
  cleanPath: string,
  body: Record<string, unknown>
): number {
  if (method !== 'POST') return 0;
  if (cleanPath === '/api/tickets' || cleanPath === '/api/portal/tickets' || cleanPath === '/api/forms/submit') {
    return 1;
  }
  if (cleanPath === '/api/migration/hubspot') {
    const n = Array.isArray(body.tickets) ? body.tickets.length : 0;
    return Math.max(1, Math.min(n, 500));
  }
  return 0;
}
