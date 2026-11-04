// ============================================================================
// STI-hub — Armazenamento do e-mail individual do CRM (04/11/2026).
// Tabelas proprias no Postgres (fora do crm_state_v1, nunca no bootstrap):
//   crm_mailbox_accounts       caixas conectadas (tokens SO cifrados, AES-256-GCM)
//   crm_mailbox_oauth_states   state + verificador PKCE (cifrado), uso unico, 10 min
//   crm_email_messages         e-mails enviados/recebidos ligados a contato/empresa/negocio
//   crm_email_tracking_events  aberturas e cliques
//   crm_email_never_log        lista "Nunca registrar" (remocao logica; padroes iniciais nao voltam)
//   crm_email_signatures       assinatura de cada usuario
// Sem DATABASE_URL (testes/local): implementacao em memoria com o mesmo contrato.
// ============================================================================
import crypto from 'node:crypto';
import { getPostgresPool, isPostgresEnabled } from '../../db/postgres';
import { DEFAULT_NEVER_LOG_PATTERNS } from './never-log';
import { OPEN_GRACE_MS } from './mail-tracking';

export type MailboxStatus = 'ATIVADO' | 'RECONECTAR';

export interface MailboxAccount {
  id: string;
  ownerEmail: string;
  mailboxAddress: string;
  displayName: string;
  status: MailboxStatus;
  tokenCipher: string | null;
  tokenExpiresAt: number;
  lastSyncInboxAt: string | null;
  lastSyncSentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** O que pode sair em resposta HTTP (sem tokens). */
export type PublicMailboxAccount = Pick<MailboxAccount, 'id' | 'mailboxAddress' | 'displayName' | 'status' | 'createdAt'> & {
  lastSyncAt: string | null;
};

export function toPublicAccount(a: MailboxAccount): PublicMailboxAccount {
  const last = [a.lastSyncInboxAt, a.lastSyncSentAt].filter(Boolean).sort().pop() || null;
  return { id: a.id, mailboxAddress: a.mailboxAddress, displayName: a.displayName, status: a.status, createdAt: a.createdAt, lastSyncAt: last };
}

export interface OAuthStateRecord {
  state: string;
  ownerEmail: string;
  verifierCipher: string;
  expiresAt: number;
}

export type EmailDirection = 'ENVIADO' | 'RECEBIDO';
export type EmailSource = 'STI_HUB' | 'OUTLOOK' | 'HUBSPOT';

export interface CrmEmailMessage {
  id: string;
  accountId: string | null;
  ownerEmail: string | null;
  externalId: string | null; // 'graph:<id imutavel>' ou 'hubspot:<id>' (unico)
  conversationId: string | null;
  internetMessageId: string | null;
  direction: EmailDirection;
  source: EmailSource;
  fromAddress: string;
  fromName: string;
  to: string[];
  cc: string[];
  subject: string;
  bodyPreview: string;
  occurredAt: string;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  trackingId: string | null;
  links: string[];
  openCount: number;
  clickCount: number;
  lastOpenedAt: string | null;
  lastClickedAt: string | null;
  createdAt: string;
}

/** Item da linha do tempo (sem id de rastreio nem links internos). */
export type TimelineEmail = Omit<CrmEmailMessage, 'trackingId' | 'links' | 'externalId' | 'internetMessageId' | 'accountId'> & {
  tracked: boolean;
};

export function toTimelineEmail(m: CrmEmailMessage): TimelineEmail {
  const { trackingId, links, externalId, internetMessageId, accountId, ...rest } = m;
  void links; void externalId; void internetMessageId; void accountId;
  return { ...rest, tracked: Boolean(trackingId) };
}

export interface NeverLogEntry {
  pattern: string;
  createdBy: string;
  createdAt: string;
}

export interface RecordRef {
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
}

export interface MailboxStore {
  listAccounts(ownerEmail: string): Promise<MailboxAccount[]>;
  listAllAccounts(): Promise<MailboxAccount[]>;
  getAccount(id: string): Promise<MailboxAccount | null>;
  /** Insere ou atualiza pela dupla (dono, endereco). Retorna o registro final. */
  upsertAccount(a: Omit<MailboxAccount, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<MailboxAccount>;
  updateAccount(id: string, patch: Partial<Pick<MailboxAccount, 'status' | 'tokenCipher' | 'tokenExpiresAt' | 'lastSyncInboxAt' | 'lastSyncSentAt' | 'displayName'>>): Promise<void>;
  deleteAccount(id: string, ownerEmail: string): Promise<boolean>;

  saveOAuthState(r: OAuthStateRecord): Promise<void>;
  /** Uso unico: remove e retorna (null se nao existe ou expirou). */
  consumeOAuthState(state: string): Promise<OAuthStateRecord | null>;

  getSignature(ownerEmail: string): Promise<string>;
  setSignature(ownerEmail: string, signature: string): Promise<void>;

  listNeverLog(): Promise<NeverLogEntry[]>;
  addNeverLog(pattern: string, by: string): Promise<boolean>;
  removeNeverLog(pattern: string): Promise<boolean>;

  /** Ignora duplicado (mesmo externalId). Retorna true se gravou. */
  insertMessage(m: CrmEmailMessage): Promise<boolean>;
  findByConversation(conversationId: string): Promise<CrmEmailMessage | null>;
  listForRecord(ref: RecordRef, limit?: number): Promise<CrmEmailMessage[]>;

  /** Registra abertura. Retorna sempre void (a rota publica nao revela nada). */
  recordOpen(trackingId: string, now?: number): Promise<void>;
  /** Registra clique e retorna o destino gravado (ou null). */
  recordClick(trackingId: string, linkIndex: number, now?: number): Promise<string | null>;
}

export function newMailboxId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

// ----------------------------------------------------------------------------
// Memoria
// ----------------------------------------------------------------------------
export class MemoryMailboxStore implements MailboxStore {
  accounts = new Map<string, MailboxAccount>();
  states = new Map<string, OAuthStateRecord>();
  signatures = new Map<string, string>();
  neverLog = new Map<string, NeverLogEntry & { deleted: boolean }>();
  messages: CrmEmailMessage[] = [];
  events: Array<{ trackingId: string; kind: 'OPEN' | 'CLICK'; linkIndex: number | null; at: string }> = [];

  constructor() {
    const at = new Date().toISOString();
    for (const p of DEFAULT_NEVER_LOG_PATTERNS) this.neverLog.set(p, { pattern: p, createdBy: 'Padrão Seta Telecom', createdAt: at, deleted: false });
  }

  async listAccounts(ownerEmail: string) {
    return [...this.accounts.values()].filter((a) => a.ownerEmail === ownerEmail.toLowerCase()).map((a) => ({ ...a }));
  }
  async listAllAccounts() {
    return [...this.accounts.values()].map((a) => ({ ...a }));
  }
  async getAccount(id: string) {
    const a = this.accounts.get(id);
    return a ? { ...a } : null;
  }
  async upsertAccount(a: Omit<MailboxAccount, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
    const owner = a.ownerEmail.toLowerCase();
    const addr = a.mailboxAddress.toLowerCase();
    const existing = [...this.accounts.values()].find((x) => x.ownerEmail === owner && x.mailboxAddress === addr);
    const now = new Date().toISOString();
    const rec: MailboxAccount = {
      ...a,
      ownerEmail: owner,
      mailboxAddress: addr,
      id: existing?.id || a.id || newMailboxId('mbx'),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    this.accounts.set(rec.id, rec);
    return { ...rec };
  }
  async updateAccount(id: string, patch: Partial<MailboxAccount>) {
    const a = this.accounts.get(id);
    if (a) this.accounts.set(id, { ...a, ...patch, updatedAt: new Date().toISOString() });
  }
  async deleteAccount(id: string, ownerEmail: string) {
    const a = this.accounts.get(id);
    if (!a || a.ownerEmail !== ownerEmail.toLowerCase()) return false;
    return this.accounts.delete(id);
  }
  async saveOAuthState(r: OAuthStateRecord) {
    this.states.set(r.state, { ...r });
  }
  async consumeOAuthState(state: string) {
    const r = this.states.get(state);
    this.states.delete(state);
    if (!r || r.expiresAt < Date.now()) return null;
    return r;
  }
  async getSignature(ownerEmail: string) {
    return this.signatures.get(ownerEmail.toLowerCase()) || '';
  }
  async setSignature(ownerEmail: string, signature: string) {
    this.signatures.set(ownerEmail.toLowerCase(), signature);
  }
  async listNeverLog() {
    return [...this.neverLog.values()].filter((e) => !e.deleted).map(({ deleted, ...e }) => (void deleted, e));
  }
  async addNeverLog(pattern: string, by: string) {
    const cur = this.neverLog.get(pattern);
    if (cur && !cur.deleted) return false;
    this.neverLog.set(pattern, { pattern, createdBy: by, createdAt: new Date().toISOString(), deleted: false });
    return true;
  }
  async removeNeverLog(pattern: string) {
    const cur = this.neverLog.get(pattern);
    if (!cur || cur.deleted) return false;
    cur.deleted = true;
    return true;
  }
  async insertMessage(m: CrmEmailMessage) {
    if (m.externalId && this.messages.some((x) => x.externalId === m.externalId)) return false;
    if (m.trackingId && this.messages.some((x) => x.trackingId === m.trackingId)) return false;
    this.messages.push({ ...m });
    return true;
  }
  async findByConversation(conversationId: string) {
    return this.messages.find((m) => m.conversationId === conversationId && (m.contactId || m.companyId || m.dealId)) || null;
  }
  async listForRecord(ref: RecordRef, limit = 100) {
    const hit = (m: CrmEmailMessage) =>
      (ref.contactId && m.contactId === ref.contactId) || (ref.companyId && m.companyId === ref.companyId) || (ref.dealId && m.dealId === ref.dealId);
    return this.messages
      .filter(hit)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, limit)
      .map((m) => ({ ...m }));
  }
  async recordOpen(trackingId: string, now = Date.now()) {
    const m = this.messages.find((x) => x.trackingId === trackingId);
    if (!m || now - Date.parse(m.occurredAt) < OPEN_GRACE_MS) return;
    m.openCount += 1;
    m.lastOpenedAt = new Date(now).toISOString();
    this.events.push({ trackingId, kind: 'OPEN', linkIndex: null, at: m.lastOpenedAt });
  }
  async recordClick(trackingId: string, linkIndex: number, now = Date.now()) {
    const m = this.messages.find((x) => x.trackingId === trackingId);
    const url = m?.links[linkIndex];
    if (!m || !url) return null;
    m.clickCount += 1;
    m.lastClickedAt = new Date(now).toISOString();
    this.events.push({ trackingId, kind: 'CLICK', linkIndex, at: m.lastClickedAt });
    return url;
  }
}

// ----------------------------------------------------------------------------
// Postgres
// ----------------------------------------------------------------------------
export const MAILBOX_TABLES_DDL = `
CREATE TABLE IF NOT EXISTS crm_mailbox_accounts (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  mailbox_address TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ATIVADO',
  token_cipher TEXT,
  token_expires_at BIGINT NOT NULL DEFAULT 0,
  last_sync_inbox_at TIMESTAMPTZ,
  last_sync_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_crm_mailbox_owner_addr ON crm_mailbox_accounts (owner_email, mailbox_address);
CREATE TABLE IF NOT EXISTS crm_mailbox_oauth_states (
  state TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  verifier_cipher TEXT NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS crm_email_messages (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  owner_email TEXT,
  source TEXT NOT NULL,
  external_id TEXT,
  conversation_id TEXT,
  internet_message_id TEXT,
  direction TEXT NOT NULL,
  from_address TEXT NOT NULL DEFAULT '',
  from_name TEXT NOT NULL DEFAULT '',
  to_addresses JSONB NOT NULL DEFAULT '[]'::jsonb,
  cc_addresses JSONB NOT NULL DEFAULT '[]'::jsonb,
  subject TEXT NOT NULL DEFAULT '',
  body_preview TEXT NOT NULL DEFAULT '',
  occurred_at TIMESTAMPTZ NOT NULL,
  contact_id TEXT,
  company_id TEXT,
  deal_id TEXT,
  tracking_id TEXT,
  links JSONB NOT NULL DEFAULT '[]'::jsonb,
  open_count INTEGER NOT NULL DEFAULT 0,
  click_count INTEGER NOT NULL DEFAULT 0,
  last_opened_at TIMESTAMPTZ,
  last_clicked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_crm_email_external ON crm_email_messages (external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_crm_email_tracking ON crm_email_messages (tracking_id) WHERE tracking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_email_contact ON crm_email_messages (contact_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_email_company ON crm_email_messages (company_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_email_deal ON crm_email_messages (deal_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_email_conversation ON crm_email_messages (conversation_id);
CREATE TABLE IF NOT EXISTS crm_email_tracking_events (
  id BIGSERIAL PRIMARY KEY,
  tracking_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  link_index INTEGER,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_email_tracking_events ON crm_email_tracking_events (tracking_id);
CREATE TABLE IF NOT EXISTS crm_email_never_log (
  pattern TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS crm_email_signatures (
  owner_email TEXT PRIMARY KEY,
  signature TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

function rowToAccount(r: any): MailboxAccount {
  return {
    id: r.id,
    ownerEmail: r.owner_email,
    mailboxAddress: r.mailbox_address,
    displayName: r.display_name,
    status: r.status === 'RECONECTAR' ? 'RECONECTAR' : 'ATIVADO',
    tokenCipher: r.token_cipher,
    tokenExpiresAt: Number(r.token_expires_at) || 0,
    lastSyncInboxAt: iso(r.last_sync_inbox_at),
    lastSyncSentAt: iso(r.last_sync_sent_at),
    createdAt: iso(r.created_at) || new Date().toISOString(),
    updatedAt: iso(r.updated_at) || new Date().toISOString(),
  };
}

function rowToMessage(r: any): CrmEmailMessage {
  return {
    id: r.id,
    accountId: r.account_id,
    ownerEmail: r.owner_email,
    externalId: r.external_id,
    conversationId: r.conversation_id,
    internetMessageId: r.internet_message_id,
    direction: r.direction === 'RECEBIDO' ? 'RECEBIDO' : 'ENVIADO',
    source: r.source,
    fromAddress: r.from_address,
    fromName: r.from_name,
    to: Array.isArray(r.to_addresses) ? r.to_addresses : [],
    cc: Array.isArray(r.cc_addresses) ? r.cc_addresses : [],
    subject: r.subject,
    bodyPreview: r.body_preview,
    occurredAt: iso(r.occurred_at) || new Date().toISOString(),
    contactId: r.contact_id,
    companyId: r.company_id,
    dealId: r.deal_id,
    trackingId: r.tracking_id,
    links: Array.isArray(r.links) ? r.links : [],
    openCount: Number(r.open_count) || 0,
    clickCount: Number(r.click_count) || 0,
    lastOpenedAt: iso(r.last_opened_at),
    lastClickedAt: iso(r.last_clicked_at),
    createdAt: iso(r.created_at) || new Date().toISOString(),
  };
}

type Q = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export class PostgresMailboxStore implements MailboxStore {
  private ready: Promise<void> | null = null;
  constructor(private readonly q: Q | null = getPostgresPool()) {}

  private async db(): Promise<Q> {
    if (!this.q) throw new Error('MAILBOX_STORE_UNAVAILABLE');
    if (!this.ready) {
      this.ready = (async () => {
        await this.q!.query(MAILBOX_TABLES_DDL);
        for (const p of DEFAULT_NEVER_LOG_PATTERNS) {
          await this.q!.query(
            `INSERT INTO crm_email_never_log (pattern, created_by) VALUES ($1, 'Padrão Seta Telecom') ON CONFLICT (pattern) DO NOTHING`,
            [p]
          );
        }
      })().catch((e) => {
        this.ready = null;
        throw e;
      });
    }
    await this.ready;
    return this.q;
  }

  async listAccounts(ownerEmail: string) {
    const r = await (await this.db()).query(`SELECT * FROM crm_mailbox_accounts WHERE owner_email = $1 ORDER BY created_at`, [ownerEmail.toLowerCase()]);
    return r.rows.map(rowToAccount);
  }
  async listAllAccounts() {
    const r = await (await this.db()).query(`SELECT * FROM crm_mailbox_accounts ORDER BY created_at`);
    return r.rows.map(rowToAccount);
  }
  async getAccount(id: string) {
    const r = await (await this.db()).query(`SELECT * FROM crm_mailbox_accounts WHERE id = $1`, [id]);
    return r.rows[0] ? rowToAccount(r.rows[0]) : null;
  }
  async upsertAccount(a: Omit<MailboxAccount, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
    const r = await (await this.db()).query(
      `INSERT INTO crm_mailbox_accounts (id, owner_email, mailbox_address, display_name, status, token_cipher, token_expires_at, last_sync_inbox_at, last_sync_sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (owner_email, mailbox_address) DO UPDATE SET
         display_name = EXCLUDED.display_name, status = EXCLUDED.status, token_cipher = EXCLUDED.token_cipher,
         token_expires_at = EXCLUDED.token_expires_at, updated_at = NOW()
       RETURNING *`,
      [a.id || newMailboxId('mbx'), a.ownerEmail.toLowerCase(), a.mailboxAddress.toLowerCase(), a.displayName, a.status, a.tokenCipher, a.tokenExpiresAt, a.lastSyncInboxAt, a.lastSyncSentAt]
    );
    return rowToAccount(r.rows[0]);
  }
  async updateAccount(id: string, patch: Partial<MailboxAccount>) {
    const cols: Record<string, string> = {
      status: 'status', tokenCipher: 'token_cipher', tokenExpiresAt: 'token_expires_at',
      lastSyncInboxAt: 'last_sync_inbox_at', lastSyncSentAt: 'last_sync_sent_at', displayName: 'display_name',
    };
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, col] of Object.entries(cols)) {
      if (k in patch) {
        vals.push((patch as Record<string, unknown>)[k]);
        sets.push(`${col} = $${vals.length}`);
      }
    }
    if (!sets.length) return;
    vals.push(id);
    await (await this.db()).query(`UPDATE crm_mailbox_accounts SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length}`, vals);
  }
  async deleteAccount(id: string, ownerEmail: string) {
    const r = await (await this.db()).query(`DELETE FROM crm_mailbox_accounts WHERE id = $1 AND owner_email = $2`, [id, ownerEmail.toLowerCase()]);
    return (r.rowCount || 0) > 0;
  }
  async saveOAuthState(s: OAuthStateRecord) {
    const db = await this.db();
    await db.query(`DELETE FROM crm_mailbox_oauth_states WHERE expires_at < $1`, [Date.now()]);
    await db.query(`INSERT INTO crm_mailbox_oauth_states (state, owner_email, verifier_cipher, expires_at) VALUES ($1,$2,$3,$4)`, [s.state, s.ownerEmail, s.verifierCipher, s.expiresAt]);
  }
  async consumeOAuthState(state: string) {
    const r = await (await this.db()).query(`DELETE FROM crm_mailbox_oauth_states WHERE state = $1 RETURNING *`, [state]);
    const row = r.rows[0];
    if (!row || Number(row.expires_at) < Date.now()) return null;
    return { state: row.state, ownerEmail: row.owner_email, verifierCipher: row.verifier_cipher, expiresAt: Number(row.expires_at) };
  }
  async getSignature(ownerEmail: string) {
    const r = await (await this.db()).query(`SELECT signature FROM crm_email_signatures WHERE owner_email = $1`, [ownerEmail.toLowerCase()]);
    return r.rows[0]?.signature || '';
  }
  async setSignature(ownerEmail: string, signature: string) {
    await (await this.db()).query(
      `INSERT INTO crm_email_signatures (owner_email, signature) VALUES ($1,$2) ON CONFLICT (owner_email) DO UPDATE SET signature = EXCLUDED.signature, updated_at = NOW()`,
      [ownerEmail.toLowerCase(), signature]
    );
  }
  async listNeverLog() {
    const r = await (await this.db()).query(`SELECT * FROM crm_email_never_log WHERE deleted_at IS NULL ORDER BY pattern`);
    return r.rows.map((x) => ({ pattern: x.pattern, createdBy: x.created_by, createdAt: iso(x.created_at) || '' }));
  }
  async addNeverLog(pattern: string, by: string) {
    const r = await (await this.db()).query(
      `INSERT INTO crm_email_never_log (pattern, created_by) VALUES ($1,$2)
       ON CONFLICT (pattern) DO UPDATE SET deleted_at = NULL, created_by = EXCLUDED.created_by, created_at = NOW()
       WHERE crm_email_never_log.deleted_at IS NOT NULL`,
      [pattern, by]
    );
    return (r.rowCount || 0) > 0;
  }
  async removeNeverLog(pattern: string) {
    const r = await (await this.db()).query(`UPDATE crm_email_never_log SET deleted_at = NOW() WHERE pattern = $1 AND deleted_at IS NULL`, [pattern]);
    return (r.rowCount || 0) > 0;
  }
  async insertMessage(m: CrmEmailMessage) {
    const r = await (await this.db()).query(
      `INSERT INTO crm_email_messages (id, account_id, owner_email, source, external_id, conversation_id, internet_message_id, direction,
         from_address, from_name, to_addresses, cc_addresses, subject, body_preview, occurred_at, contact_id, company_id, deal_id, tracking_id, links)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20::jsonb)
       ON CONFLICT DO NOTHING`,
      [m.id, m.accountId, m.ownerEmail, m.source, m.externalId, m.conversationId, m.internetMessageId, m.direction, m.fromAddress, m.fromName,
        JSON.stringify(m.to), JSON.stringify(m.cc), m.subject, m.bodyPreview, m.occurredAt, m.contactId, m.companyId, m.dealId, m.trackingId, JSON.stringify(m.links)]
    );
    return (r.rowCount || 0) > 0;
  }
  async findByConversation(conversationId: string) {
    const r = await (await this.db()).query(
      `SELECT * FROM crm_email_messages WHERE conversation_id = $1 AND (contact_id IS NOT NULL OR company_id IS NOT NULL OR deal_id IS NOT NULL) ORDER BY occurred_at LIMIT 1`,
      [conversationId]
    );
    return r.rows[0] ? rowToMessage(r.rows[0]) : null;
  }
  async listForRecord(ref: RecordRef, limit = 100) {
    const conds: string[] = [];
    const vals: unknown[] = [];
    for (const [k, col] of [['contactId', 'contact_id'], ['companyId', 'company_id'], ['dealId', 'deal_id']] as const) {
      if (ref[k]) {
        vals.push(ref[k]);
        conds.push(`${col} = $${vals.length}`);
      }
    }
    if (!conds.length) return [];
    vals.push(Math.min(Math.max(1, limit), 200));
    const r = await (await this.db()).query(`SELECT * FROM crm_email_messages WHERE ${conds.join(' OR ')} ORDER BY occurred_at DESC LIMIT $${vals.length}`, vals);
    return r.rows.map(rowToMessage);
  }
  async recordOpen(trackingId: string, now = Date.now()) {
    const db = await this.db();
    const r = await db.query(
      `UPDATE crm_email_messages SET open_count = open_count + 1, last_opened_at = to_timestamp($2 / 1000.0)
       WHERE tracking_id = $1 AND occurred_at < to_timestamp(($2 - $3) / 1000.0) RETURNING id`,
      [trackingId, now, OPEN_GRACE_MS]
    );
    if (r.rowCount) await db.query(`INSERT INTO crm_email_tracking_events (tracking_id, kind) VALUES ($1, 'OPEN')`, [trackingId]);
  }
  async recordClick(trackingId: string, linkIndex: number, now = Date.now()) {
    const db = await this.db();
    const r = await db.query(
      `UPDATE crm_email_messages SET click_count = click_count + 1, last_clicked_at = to_timestamp($3 / 1000.0)
       WHERE tracking_id = $1 AND jsonb_array_length(links) > $2 RETURNING links ->> $2::int AS url`,
      [trackingId, linkIndex, now]
    );
    const url = r.rows[0]?.url;
    if (!url) return null;
    await db.query(`INSERT INTO crm_email_tracking_events (tracking_id, kind, link_index) VALUES ($1, 'CLICK', $2)`, [trackingId, linkIndex]);
    return String(url);
  }
}

let defaultStore: MailboxStore | null = null;
export function getDefaultMailboxStore(): MailboxStore {
  if (!defaultStore) defaultStore = isPostgresEnabled() ? new PostgresMailboxStore() : new MemoryMailboxStore();
  return defaultStore;
}
