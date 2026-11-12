// ============================================================================
// SetaDesk - Camada de dados dos chamados no PostgreSQL
// ----------------------------------------------------------------------------
// Ativa somente quando DATABASE_URL (ou DATABASE_POSTGRES_URL) existe. Sem ela,
// o repositorio continua no comportamento atual (estado em memoria + arquivo
// JSON + snapshot crm_kv_store), sem nenhuma chamada a este modulo.
//
// Modelo de uso por requisicao (router.handle):
//   1. loadSetaDeskTickets(): le os chamados das tabelas setadesk_* (fonte de
//      verdade) e devolve uma "linha de base" (fingerprint por chamado).
//      Roda em rotas autenticadas de chamados (/api/tickets*) e, com permissao de
//      Chamados, na carga do /api/bootstrap e /api/state. Nunca em rota publica.
//   2. reserveSetaDeskTicketKeys(n): reserva chaves SD-<n> na sequencia propria
//      antes de rotas que criam chamados;
//   3. syncSetaDeskTickets(): grava apenas chamados novos/alterados (upsert por
//      id), comentarios novos (insert idempotente por id), historico de campos
//      e notificacao de chamado novo; remove os que foram apagados.
//   4. reconcileFromLegacyState nunca copia os 5 chamados demo JSM-101..105.
// ============================================================================

import crypto from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { getPostgresPool, isPostgresEnabled } from './postgres';
import {
  alignPipelineSequenceSql,
  applySetaDeskMigrations,
  formatSetaDeskTicketKey,
  isAllowedPipelinePrefix,
  jiraImportSpec,
  pipelineSequenceNameFromPrefix,
  SETADESK_DEFAULT_PIPELINE_ID,
  SETADESK_DEFAULT_TICKET_PREFIX,
  SETADESK_JIRA_IMPORT_PROJECT,
  SETADESK_JIRA_IMPORT_PROJECTS,
  SETADESK_SEED_PIPELINES,
  SETADESK_TICKET_KEY_PREFIX,
  SETADESK_TICKET_SEQUENCE,
} from './setadesk-schema';
import type { SetaDeskPipeline } from './types';
import { assertUniquePipelineMailbox, PIPELINE_MAILBOX_DUPLICATE_ERROR } from '../api/setadesk-pipeline-guards';
import {
  planSetaDeskTicketPurge,
  SETADESK_PURGE_DELETE_TICKETS_SQL,
  SETADESK_PURGE_DELETE_TOMBSTONES_SQL,
  SETADESK_PURGE_PROTECTED_TABLES,
  SETADESK_PURGE_PROTECTED_TICKET_IDS_SQL,
} from './setadesk-purge';

import {
  JIRA_IMPORT_SOURCE,
  planJiraImport,
  type ExistingImportRow,
  type ImportPlanItem,
  type JiraAttachmentRef,
  type JiraHistoryEntry,
} from './setadesk-jira-map';
import type { ServiceTicket, TicketComment } from './types';

import {
  isLegacyDemoServiceTicket,
  SETADESK_LEGACY_DEMO_TICKET_IDS,
  SETADESK_LEGACY_DEMO_TICKET_KEYS,
} from './setadesk-demo';

export {
  isLegacyDemoServiceTicket,
  SETADESK_LEGACY_DEMO_TICKET_IDS,
  SETADESK_LEGACY_DEMO_TICKET_KEYS,
};


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

export function formatReservedTicketKey(prefix: string, n: number | string): string {
  return formatSetaDeskTicketKey(prefix, n);
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
    pipelineId: (r.pipeline_id as string | null) ?? null,
    legacyKey: (r.legacy_key as string | null) ?? null,
    jiraKey: (r.jira_key as string | null) ?? null,
    jiraId: (r.jira_id as string | null) ?? null,
    jiraProjectKey: (r.jira_project_key as string | null) ?? null,
    jiraUrl: (r.jira_url as string | null) ?? null,
    externalCreatedAt: iso(r.external_created_at),
    externalUpdatedAt: iso(r.external_updated_at),
    externalResolvedAt: iso(r.external_resolved_at),
    importedAt: iso(r.imported_at),
    importHash: (r.import_hash as string | null) ?? null,
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
  'source', 'pipeline_id', 'queue', 'assignee_agent', 'requester_email', 'requester_name', 'cc_emails',
  'contact_id', 'company_id', 'deal_id', 'contract_id', 'service_order_id', 'equipment_serial',
  'tags', 'resolution', 'sla_status', 'sla_first_response_due_at', 'sla_resolution_due_at',
  'sla_paused_at', 'total_paused_minutes', 'first_responded_at', 'resolved_at', 'closed_at',
  'csat_score', 'jira_key', 'jira_id', 'jira_project_key', 'jira_url',
  'external_created_at', 'external_updated_at', 'external_resolved_at',
  'imported_at', 'import_hash', 'created_at', 'updated_at',
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
    t.pipelineId ?? null,
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
    t.jiraProjectKey ?? null,
    t.jiraUrl ?? null,
    ts(t.externalCreatedAt) || ts(t.createdAt),
    ts(t.externalUpdatedAt) || ts(t.updatedAt),
    ts(t.externalResolvedAt) || null,
    ts(t.importedAt),
    t.importHash ?? null,
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
 * datas. Copia os que faltam (exceto os apagados no SetaDesk, via tombstone, e
 * os 5 chamados demo JSM-101..105 do seed) e atualiza os que estao mais novos
 * no legado (ex.: editados por uma versao anterior do app antes do deploy).
 * Nao e importacao do Jira.
 * Retorna quantos chamados foram gravados.
 */
async function reconcileFromLegacyState(
  client: PoolClient,
  legacyTickets: ServiceTicket[],
  current: Map<string, string>
): Promise<number> {
  if (!legacyTickets.length) return 0;
  const candidates = legacyTickets.filter((t) => {
    if (isLegacyDemoServiceTicket(t)) return false;
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

function sanitizeSequenceName(name: string): string {
  const s = String(name || '').replace(/[^a-zA-Z0-9_]/g, '');
  if (!s) throw new Error('Nome de sequencia invalido.');
  return s;
}

async function loadPipelineRows(client: PoolClient): Promise<SetaDeskPipeline[]> {
  const r = await client.query(
    `SELECT id, name, prefix, mailbox, jira_project_key, sequence_name, is_active, sort_order, created_at, updated_at
     FROM setadesk_pipelines ORDER BY sort_order ASC, name ASC`
  );
  return r.rows.map(rowToPipeline);
}

export function rowToPipeline(r: Record<string, unknown>): SetaDeskPipeline {
  return {
    id: String(r.id),
    name: String(r.name),
    prefix: String(r.prefix).toUpperCase().replace(/-$/, ''),
    mailbox: (r.mailbox as string | null) ?? null,
    jiraProjectKey: (r.jira_project_key as string | null) ?? null,
    sequenceName: String(r.sequence_name),
    isActive: r.is_active !== false,
    sortOrder: Number(r.sort_order ?? 0),
    createdAt: iso(r.created_at) || '',
    updatedAt: iso(r.updated_at) || '',
  };
}

/** Alinha a sequencia de cada fila e, por compatibilidade, a sequencia global legada. */
export async function alignSequenceWithExistingKeys(client: PoolClient) {
  const pipelines = await loadPipelineRows(client).catch(() => [] as SetaDeskPipeline[]);
  for (const pl of pipelines) {
    await client.query(alignPipelineSequenceSql({
      sequenceName: sanitizeSequenceName(pl.sequenceName),
      prefix: pl.prefix,
      jiraProjectKey: pl.jiraProjectKey,
    }));
  }
  // Sequencia global legada (setadesk_ticket_seq): acompanha a fila TEC, se existir.
  const tec = pipelines.find((p) => p.id === SETADESK_DEFAULT_PIPELINE_ID) || pipelines.find((p) => p.prefix === 'TEC');
  if (tec) {
    await client.query(alignPipelineSequenceSql({
      sequenceName: SETADESK_TICKET_SEQUENCE,
      prefix: tec.prefix,
      jiraProjectKey: tec.jiraProjectKey,
    }));
  }
}

/**
 * Alinha a sequencia da fila para max(chaves existentes, minNextValue).
 * minNextValue e o proximo numero desejado (ex.: max(STT)+1 = 249).
 * Idempotente: nunca reduz a sequencia. is_called=false => proximo nextval devolve esse valor.
 */
export async function alignPipelineSequenceToAtLeast(
  client: PoolClient,
  pipeline: { sequenceName: string; prefix: string; jiraProjectKey?: string | null },
  minNextValue: number
): Promise<number> {
  const seq = sanitizeSequenceName(pipeline.sequenceName);
  await client.query(
    alignPipelineSequenceSql({
      sequenceName: seq,
      prefix: pipeline.prefix,
      jiraProjectKey: pipeline.jiraProjectKey,
    })
  );
  const floor = Math.max(1, Math.floor(Number(minNextValue) || 0));
  if (floor > 1) {
    await client.query(
      `SELECT setval('${seq}', GREATEST(
        (SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END FROM ${seq}),
        $1::bigint - 1,
        0) + 1, false)`,
      [floor]
    );
  }
  const r = await client.query<{ n: string }>(
    `SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END::text AS n FROM ${seq}`
  );
  return Number(r.rows[0]?.n || floor);
}

/** @deprecated Use alignPipelineSequenceToAtLeast. Alinha a fila padrao TEC. */
export async function alignSequenceToAtLeast(client: PoolClient, minNextValue: number): Promise<number> {
  await alignSequenceWithExistingKeys(client);
  return alignPipelineSequenceToAtLeast(
    client,
    {
      sequenceName: SETADESK_TICKET_SEQUENCE,
      prefix: SETADESK_DEFAULT_TICKET_PREFIX,
      jiraProjectKey: SETADESK_JIRA_IMPORT_PROJECT,
    },
    minNextValue
  );
}

export type LoadSetaDeskTicketsOptions = {
  /** Padrao true. No bootstrap da fila, false evita trazer o historico de cada chamado. */
  includeComments?: boolean;
  /** Padrao true. No bootstrap da fila, false evita gravar legado/seed nesta leitura. */
  reconcileLegacy?: boolean;
};

/** Le os chamados das tabelas SetaDesk. */
export async function loadSetaDeskTickets(
  legacyTickets: ServiceTicket[] = [],
  options?: LoadSetaDeskTicketsOptions
): Promise<{ tickets: ServiceTicket[]; baseline: SetaDeskBaseline } | null> {
  const includeComments = options?.includeComments !== false;
  const reconcileLegacy = options?.reconcileLegacy !== false;
  const pool = getPostgresPool();
  if (!pool) return null;
  await ensureSetaDeskSchema(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const readAll = async () => ({
      t: await client.query(`SELECT * FROM setadesk_tickets ORDER BY created_at DESC, key DESC`),
      c: includeComments
        ? await client.query(`SELECT * FROM setadesk_ticket_comments ORDER BY created_at ASC, id ASC`)
        : { rows: [] as Record<string, unknown>[] },
    });
    let { t: tRes, c: cRes } = await readAll();
    const current = new Map<string, string>(
      tRes.rows.map((r) => [String(r.id), iso(r.updated_at) || ''])
    );
    if (reconcileLegacy && (await reconcileFromLegacyState(client, legacyTickets, current))) {
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

async function resolvePipelineForReserve(
  client: Pool | PoolClient,
  pipelineId?: string | null
): Promise<{ id: string; prefix: string; sequenceName: string }> {
  const id = String(pipelineId || SETADESK_DEFAULT_PIPELINE_ID).trim() || SETADESK_DEFAULT_PIPELINE_ID;
  const r = await client.query<{ id: string; prefix: string; sequence_name: string }>(
    `SELECT id, prefix, sequence_name FROM setadesk_pipelines WHERE id = $1 LIMIT 1`,
    [id]
  );
  if (r.rows[0]) {
    return {
      id: r.rows[0].id,
      prefix: String(r.rows[0].prefix).toUpperCase().replace(/-$/, ''),
      sequenceName: sanitizeSequenceName(r.rows[0].sequence_name),
    };
  }
  const seed = SETADESK_SEED_PIPELINES.find((p) => p.id === SETADESK_DEFAULT_PIPELINE_ID)!;
  return { id: seed.id, prefix: seed.prefix, sequenceName: seed.sequenceName };
}

/** Reserva `count` chaves PREFIX-<n> na sequencia da fila (numeros nao usados viram lacunas). */
export async function reserveSetaDeskTicketKeys(
  count: number,
  pipelineId?: string | null
): Promise<string[]> {
  const pool = getPostgresPool();
  if (!pool || count <= 0) return [];
  await ensureSetaDeskSchema(pool);
  const n = Math.min(Math.max(1, Math.floor(count)), 500);
  const pl = await resolvePipelineForReserve(pool, pipelineId);
  const r = await pool.query<{ n: string }>(
    `SELECT nextval('${pl.sequenceName}')::text AS n FROM generate_series(1, $1)`,
    [n]
  );
  return r.rows.map((row) => formatSetaDeskTicketKey(pl.prefix, row.n));
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
          const pl = await resolvePipelineForReserve(client, t.pipelineId);
          const r = await client.query<{ n: string }>(`SELECT nextval('${pl.sequenceName}')::text AS n`);
          if (!t.legacyKey) t.legacyKey = null;
          t.key = formatSetaDeskTicketKey(pl.prefix, r.rows[0].n);
          t.pipelineId = pl.id;
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

const INSERT_ATTACHMENT_SQL = `
INSERT INTO setadesk_ticket_attachments
  (id, ticket_id, filename, mime_type, size_bytes, storage, url, source, external_id, created_at)
VALUES ($1, $2, $3, $4, $5, 'JIRA_REF', $6, $7, $8, $9)
ON CONFLICT DO NOTHING`;

const INSERT_HISTORY_SQL = `
INSERT INTO setadesk_ticket_history
  (ticket_id, field, old_value, new_value, actor, source, external_id, changed_at)
VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8)
ON CONFLICT DO NOTHING`;

async function insertJiraAttachments(client: PoolClient, ticketId: string, attachments: JiraAttachmentRef[]) {
  for (const a of attachments || []) {
    const externalId = a.id ? String(a.id) : null;
    const id = `jira-a-${ticketId}-${a.id || a.filename}`;
    await client.query(INSERT_ATTACHMENT_SQL, [
      id,
      ticketId,
      a.filename || 'anexo',
      a.mimeType ?? null,
      a.size ?? null,
      a.url ?? null,
      a.source || JIRA_IMPORT_SOURCE,
      externalId,
      ts(a.createdAt) || new Date().toISOString(),
    ]);
  }
}

async function insertJiraHistory(client: PoolClient, ticketId: string, changelog: JiraHistoryEntry[]) {
  for (const h of changelog || []) {
    await client.query(INSERT_HISTORY_SQL, [
      ticketId,
      h.field || 'unknown',
      JSON.stringify(h.oldValue ?? null),
      JSON.stringify(h.newValue ?? null),
      h.actor ?? null,
      JIRA_IMPORT_SOURCE,
      h.externalId ?? null,
      ts(h.changedAt) || new Date().toISOString(),
    ]);
  }
}

export interface ApplyJiraImportResult {
  created: number;
  updated: number;
  skipped: number;
  nextSequenceValue: number;
  nextSequenceByPipeline: Record<string, { pipelineId: string; prefix: string; nextSequenceValue: number }>;
}

export function allowedJiraImportProjects(project?: string | null): string[] {
  const raw = String(project || 'ALL').trim().toUpperCase();
  if (!raw || raw === 'ALL' || raw === 'STT,AF' || raw === 'AF,STT') {
    return [...SETADESK_JIRA_IMPORT_PROJECTS];
  }
  const list = raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const unknown = list.filter((p) => !SETADESK_JIRA_IMPORT_PROJECTS.includes(p));
  if (unknown.length) {
    throw new Error(
      `Projeto(s) fora do escopo da importacao: ${unknown.join(', ')}. Permitidos: ${SETADESK_JIRA_IMPORT_PROJECTS.join(', ')}.`
    );
  }
  return list;
}

/**
 * Grava o plano de importacao STT -> TEC- e AF -> FIN- (idempotente por jira_key / import_hash).
 * Replaneja contra o estado atual do banco, insere comentarios/anexos/historico
 * com ON CONFLICT DO NOTHING, e realinha a sequencia de cada fila para max(projeto)+1.
 * Nao altera o Jira.
 */
export async function applyJiraImport(
  items: ImportPlanItem[],
  opts: { maxStt?: number; maxByProject?: Record<string, number>; project?: string }
): Promise<ApplyJiraImportResult> {
  const allowed = allowedJiraImportProjects(opts.project);
  const mapped = (items || [])
    .map((it) => it.mapped)
    .filter((m) => {
      const key = String(m.mapping.jiraKey || '').toUpperCase();
      return allowed.some((p) => key.startsWith(`${p}-`));
    });
  const pool = getPostgresPool();
  if (!pool) {
    throw new Error('Recusado: --apply exige DATABASE_URL. Nada foi gravado.');
  }
  await ensureSetaDeskSchema(pool);
  const client = await pool.connect();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const nextSequenceByPipeline: ApplyJiraImportResult['nextSequenceByPipeline'] = {};
  let nextSequenceValue = Math.max(1, Math.floor(Number(opts.maxStt) || 0) + 1);
  try {
    await client.query('BEGIN');
    const existingRes = await client.query<{
      id: string;
      jira_key: string;
      import_hash: string | null;
      external_updated_at: Date | string | null;
    }>(
      `SELECT id, jira_key, import_hash, external_updated_at FROM setadesk_tickets WHERE jira_key IS NOT NULL`
    );
    const existing = new Map<string, ExistingImportRow & { id: string }>();
    for (const row of existingRes.rows) {
      const k = String(row.jira_key || '').toUpperCase();
      existing.set(k, {
        id: row.id,
        jiraKey: k,
        importHash: row.import_hash,
        externalUpdatedAt: iso(row.external_updated_at),
      });
    }
    const planned = planJiraImport(mapped, existing);
    const importedAt = new Date().toISOString();
    for (const it of planned) {
      if (it.action === 'skip') {
        skipped += 1;
        continue;
      }
      const prev = existing.get(it.mapped.mapping.jiraKey.toUpperCase());
      const ticket = { ...it.mapped.ticket, importedAt };
      if (prev?.id) ticket.id = prev.id;
      await client.query(UPSERT_TICKET_SQL, ticketToParams(ticket));
      await insertComments(client, ticket.id, ticket.comments || []);
      await insertJiraAttachments(client, ticket.id, it.mapped.attachments || []);
      await insertJiraHistory(client, ticket.id, it.mapped.changelog || []);
      if (it.action === 'create') created += 1;
      else updated += 1;
    }

    const pipelines = await loadPipelineRows(client);
    const maxByProject: Record<string, number> = { ...(opts.maxByProject || {}) };
    if (opts.maxStt != null && maxByProject.STT == null) maxByProject.STT = Number(opts.maxStt) || 0;
    for (const pl of pipelines) {
      const jira = (pl.jiraProjectKey || '').toUpperCase();
      const floor = (jira && maxByProject[jira] != null ? Number(maxByProject[jira]) : 0) + 1;
      const next = await alignPipelineSequenceToAtLeast(client, pl, floor);
      nextSequenceByPipeline[pl.id] = { pipelineId: pl.id, prefix: pl.prefix, nextSequenceValue: next };
      if (pl.id === SETADESK_DEFAULT_PIPELINE_ID) nextSequenceValue = next;
    }
    await client.query('COMMIT');
    return { created, updated, skipped, nextSequenceValue, nextSequenceByPipeline };
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

export async function listSetaDeskPipelines(): Promise<SetaDeskPipeline[] | null> {
  const pool = getPostgresPool();
  if (!pool) return null;
  await ensureSetaDeskSchema(pool);
  const client = await pool.connect();
  try {
    return await loadPipelineRows(client);
  } finally {
    client.release();
  }
}

export interface SetaDeskPipelineInput {
  name: string;
  prefix: string;
  mailbox?: string | null;
  jiraProjectKey?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

function normalizePrefix(raw: string): string {
  return String(raw || '').trim().toUpperCase().replace(/-$/, '');
}

export async function createSetaDeskPipeline(input: SetaDeskPipelineInput): Promise<SetaDeskPipeline> {
  const pool = getPostgresPool();
  if (!pool) throw new Error('Pipelines persistentes exigem DATABASE_URL.');
  await ensureSetaDeskSchema(pool);
  const name = String(input.name || '').trim();
  const prefix = normalizePrefix(input.prefix);
  if (!name) throw new Error('O nome da fila e obrigatorio.');
  if (!isAllowedPipelinePrefix(prefix)) {
    throw new Error('Prefixo invalido. Use 1 a 8 caracteres A-Z/0-9, comecando por letra (ex.: TEC, FIN, SAC).');
  }
  const sequenceName = pipelineSequenceNameFromPrefix(prefix);
  const id = `pl-${prefix.toLowerCase()}`;
  const mailbox = input.mailbox ? String(input.mailbox).trim().toLowerCase() : null;
  const jiraProjectKey = input.jiraProjectKey ? String(input.jiraProjectKey).trim().toUpperCase() : null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SEQUENCE IF NOT EXISTS ${sanitizeSequenceName(sequenceName)} AS BIGINT START WITH 1 INCREMENT BY 1 MINVALUE 1`);
    const existing = await loadPipelineRows(client);
    assertUniquePipelineMailbox(mailbox, existing);
    const r = await client.query(
      `INSERT INTO setadesk_pipelines (id, name, prefix, mailbox, jira_project_key, sequence_name, is_active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [id, name, prefix, mailbox, jiraProjectKey, sequenceName, input.isActive !== false, Number(input.sortOrder ?? 100)]
    );
    await client.query('COMMIT');
    return rowToPipeline(r.rows[0]);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignora */ }
    const msg = String((err as Error)?.message || err);
    if (/setadesk_pipelines_prefix_uidx|duplicate key.*prefix/i.test(msg)) {
      throw new Error('Ja existe uma fila com este prefixo.');
    }
    if (/setadesk_pipelines_name_uidx|duplicate key.*name/i.test(msg)) {
      throw new Error('Ja existe uma fila com este nome.');
    }
    if (/setadesk_pipelines_mailbox_uidx|duplicate key.*mailbox/i.test(msg)) {
      throw new Error(PIPELINE_MAILBOX_DUPLICATE_ERROR);
    }
    if (/setadesk_pipelines_pkey|duplicate key/i.test(msg)) {
      throw new Error('Ja existe uma fila com este identificador.');
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function updateSetaDeskPipeline(
  id: string,
  patch: Partial<SetaDeskPipelineInput>
): Promise<SetaDeskPipeline | null> {
  const pool = getPostgresPool();
  if (!pool) throw new Error('Pipelines persistentes exigem DATABASE_URL.');
  await ensureSetaDeskSchema(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(`SELECT * FROM setadesk_pipelines WHERE id = $1 FOR UPDATE`, [id]);
    if (!cur.rowCount) {
      await client.query('ROLLBACK');
      return null;
    }
    const row = cur.rows[0] as Record<string, unknown>;
    let prefix = String(row.prefix);
    if (patch.prefix != null) {
      const next = normalizePrefix(patch.prefix);
      if (!isAllowedPipelinePrefix(next)) {
        throw new Error('Prefixo invalido. Use 1 a 8 caracteres A-Z/0-9, comecando por letra.');
      }
      if (next !== prefix) {
        const used = await client.query(`SELECT 1 FROM setadesk_tickets WHERE pipeline_id = $1 LIMIT 1`, [id]);
        if (used.rowCount) {
          throw new Error('Nao e permitido alterar o prefixo de uma fila que ja possui chamados.');
        }
        prefix = next;
      }
    }
    const name = patch.name != null ? String(patch.name).trim() : String(row.name);
    if (!name) throw new Error('O nome da fila e obrigatorio.');
    const mailbox =
      patch.mailbox !== undefined
        ? (patch.mailbox ? String(patch.mailbox).trim().toLowerCase() : null)
        : ((row.mailbox as string | null) ?? null);
    const jiraProjectKey =
      patch.jiraProjectKey !== undefined
        ? (patch.jiraProjectKey ? String(patch.jiraProjectKey).trim().toUpperCase() : null)
        : ((row.jira_project_key as string | null) ?? null);
    const isActive = patch.isActive !== undefined ? Boolean(patch.isActive) : row.is_active !== false;
    const sortOrder = patch.sortOrder !== undefined ? Number(patch.sortOrder) : Number(row.sort_order ?? 0);
    const others = (await loadPipelineRows(client)).filter((p) => p.id !== id);
    assertUniquePipelineMailbox(mailbox, others, id);
    const r = await client.query(
      `UPDATE setadesk_pipelines
       SET name = $2, prefix = $3, mailbox = $4, jira_project_key = $5, is_active = $6, sort_order = $7, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, name, prefix, mailbox, jiraProjectKey, isActive, sortOrder]
    );
    await client.query('COMMIT');
    return rowToPipeline(r.rows[0]);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignora */ }
    const msg = String((err as Error)?.message || err);
    if (/setadesk_pipelines_prefix_uidx/i.test(msg)) throw new Error('Ja existe uma fila com este prefixo.');
    if (/setadesk_pipelines_name_uidx/i.test(msg)) throw new Error('Ja existe uma fila com este nome.');
    if (/setadesk_pipelines_mailbox_uidx/i.test(msg)) throw new Error(PIPELINE_MAILBOX_DUPLICATE_ERROR);
    throw err;
  } finally {
    client.release();
  }
}

export interface SetaDeskPurgeCounts {
  tickets: number;
  comments: number;
  attachments: number;
  history: number;
  related: number;
  notifications: number;
  emailMessages: number;
  emailOutbox: number;
  integrationOutbox: number;
  tombstones: number;
}

const SETADESK_TICKET_DEPENDENT_COUNTS_SQL = `
SELECT
  (SELECT count(*)::int FROM setadesk_tickets) AS tickets,
  (SELECT count(*)::int FROM setadesk_ticket_comments) AS comments,
  (SELECT count(*)::int FROM setadesk_ticket_attachments) AS attachments,
  (SELECT count(*)::int FROM setadesk_ticket_history) AS history,
  (SELECT count(*)::int FROM setadesk_related_tickets) AS related,
  (SELECT count(*)::int FROM setadesk_notifications) AS notifications,
  (SELECT count(*)::int FROM setadesk_email_messages WHERE ticket_id IS NOT NULL) AS email_messages,
  (SELECT count(*)::int FROM setadesk_email_outbox WHERE ticket_id IS NOT NULL) AS email_outbox,
  (SELECT count(*)::int FROM setadesk_integration_outbox WHERE ticket_id IS NOT NULL) AS integration_outbox,
  (SELECT count(*)::int FROM setadesk_ticket_tombstones) AS tombstones
`;

export async function countSetaDeskTicketDependents(client?: PoolClient | Pool): Promise<SetaDeskPurgeCounts> {
  const db = client || getPostgresPool();
  if (!db) throw new Error('Contagem exige DATABASE_URL.');
  const r = await db.query(SETADESK_TICKET_DEPENDENT_COUNTS_SQL);
  const row = r.rows[0] || {};
  return {
    tickets: Number(row.tickets || 0),
    comments: Number(row.comments || 0),
    attachments: Number(row.attachments || 0),
    history: Number(row.history || 0),
    related: Number(row.related || 0),
    notifications: Number(row.notifications || 0),
    emailMessages: Number(row.email_messages || 0),
    emailOutbox: Number(row.email_outbox || 0),
    integrationOutbox: Number(row.integration_outbox || 0),
    tombstones: Number(row.tombstones || 0),
  };
}

export interface SetaDeskPurgeReport {
  deleted: SetaDeskPurgeCounts;
  skippedTickets: Array<{ id: string; key: string }>;
  skippedReason: string;
  preserved: {
    emailMessages: number;
    emailOutbox: number;
    integrationOutbox: number;
    tables: readonly string[];
  };
}

async function loadSetaDeskPurgePlan(client: PoolClient) {
  const tickets = await client.query<{ id: string; key: string }>(`SELECT id, key FROM setadesk_tickets`);
  const protectedRows = await client.query<{ id: string }>(SETADESK_PURGE_PROTECTED_TICKET_IDS_SQL);
  const plan = planSetaDeskTicketPurge({
    tickets: tickets.rows,
    protectedTicketIds: protectedRows.rows.map((r) => r.id),
  });
  return plan;
}

function emptyPurgeCounts(): SetaDeskPurgeCounts {
  return {
    tickets: 0,
    comments: 0,
    attachments: 0,
    history: 0,
    related: 0,
    notifications: 0,
    emailMessages: 0,
    emailOutbox: 0,
    integrationOutbox: 0,
    tombstones: 0,
  };
}

function diffPurgeCounts(before: SetaDeskPurgeCounts, after: SetaDeskPurgeCounts): SetaDeskPurgeCounts {
  return {
    tickets: Math.max(0, before.tickets - after.tickets),
    comments: Math.max(0, before.comments - after.comments),
    attachments: Math.max(0, before.attachments - after.attachments),
    history: Math.max(0, before.history - after.history),
    related: Math.max(0, before.related - after.related),
    notifications: Math.max(0, before.notifications - after.notifications),
    emailMessages: 0,
    emailOutbox: 0,
    integrationOutbox: 0,
    tombstones: Math.max(0, before.tombstones - after.tombstones),
  };
}

export async function previewSetaDeskTicketPurge(): Promise<SetaDeskPurgeReport> {
  const pool = getPostgresPool();
  if (!pool) throw new Error('A previa da limpeza exige DATABASE_URL.');
  await ensureSetaDeskSchema(pool);
  const client = await pool.connect();
  try {
    const plan = await loadSetaDeskPurgePlan(client);
    const counts = await countSetaDeskTicketDependents(client);
    return {
      deleted: emptyPurgeCounts(),
      skippedTickets: plan.skipped,
      skippedReason: plan.skippedReason,
      preserved: {
        emailMessages: counts.emailMessages,
        emailOutbox: counts.emailOutbox,
        integrationOutbox: counts.integrationOutbox,
        tables: SETADESK_PURGE_PROTECTED_TABLES,
      },
    };
  } finally {
    client.release();
  }
}

/**
 * Apaga somente chamados SetaDesk e dependentes em cascata (comentarios, anexos,
 * historico, relacionados, notificacoes). Nao toca em tabelas que nao sejam setadesk_*.
 * Nao apaga pipelines, filas NOC, meta, mail_sync_state nem o registro de migracoes.
 * Nunca apaga setadesk_email_messages, setadesk_email_outbox ou setadesk_integration_outbox.
 * Chamados com linha vinculada nessas tabelas sao pulados e relatados.
 */
export async function purgeSetaDeskTickets(): Promise<SetaDeskPurgeReport> {
  const pool = getPostgresPool();
  if (!pool) throw new Error('A limpeza exige DATABASE_URL. Nada foi apagado.');
  await ensureSetaDeskSchema(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await countSetaDeskTicketDependents(client);
    const plan = await loadSetaDeskPurgePlan(client);
    if (plan.purgeIds.length) {
      await client.query(SETADESK_PURGE_DELETE_TICKETS_SQL, [plan.purgeIds]);
      await client.query(SETADESK_PURGE_DELETE_TOMBSTONES_SQL, [plan.purgeIds, plan.purgeKeys]);
    }
    const after = await countSetaDeskTicketDependents(client);
    await client.query('COMMIT');
    return {
      deleted: diffPurgeCounts(before, after),
      skippedTickets: plan.skipped,
      skippedReason: plan.skippedReason,
      preserved: {
        emailMessages: after.emailMessages,
        emailOutbox: after.emailOutbox,
        integrationOutbox: after.integrationOutbox,
        tables: SETADESK_PURGE_PROTECTED_TABLES,
      },
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignora */ }
    throw err;
  } finally {
    client.release();
  }
}
