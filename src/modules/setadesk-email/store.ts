// ============================================================================
// SetaDesk - Entrada de e-mail: contrato de persistencia + implementacao em memoria
// (usada nos testes). A implementacao real (Postgres) fica em store-postgres.ts.
// ============================================================================

import crypto from 'node:crypto';
import type { InboundAttachmentMeta } from './parse';
import type { SetaDeskAutoEmailKind } from './templates';

export interface IntakePipeline {
  id: string;
  name: string;
  prefix: string;
  mailbox: string | null;
  sequenceName: string;
  isActive: boolean;
}

export interface StoredTicket {
  id: string;
  key: string;
  pipelineId: string | null;
  status: string;
  channel: string;
  source: string;
  subject: string;
  requesterEmail: string | null;
  ccEmails: string[];
  contactId: string | null;
  createdAt: string;
  firstViewedAt: string | null;
  firstViewedBy: string | null;
}

export interface NewEmailTicket {
  id: string;
  key: string;
  pipelineId: string;
  subject: string;
  description: string;
  category: 'SUPPORT' | 'BILLING';
  priority: 'MEDIUM';
  queue: string;
  requesterEmail: string;
  requesterName: string | null;
  ccEmails: string[];
  contactId: string | null;
  companyId: string | null;
  slaFirstResponseDueAt: string;
  slaResolutionDueAt: string;
  createdAt: string;
}

export interface NewComment {
  id: string;
  ticketId: string;
  author: string;
  authorEmail: string | null;
  authorRole: 'AGENT' | 'CUSTOMER';
  isInternal: boolean;
  body: string;
  bodyHtml: string | null;
  source: 'EMAIL';
  emailMessageId: string | null;
  createdAt: string;
}

export interface EmailMessageRecord {
  id: string;
  ticketId: string | null;
  commentId: string | null;
  direction: 'INBOUND' | 'OUTBOUND';
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  conversationId: string | null;
  provider: 'GRAPH';
  providerMessageId: string | null;
  mailbox: string;
  fromEmail: string | null;
  fromName: string | null;
  to: string[];
  cc: string[];
  subject: string | null;
  kind: string;
  isAutoSubmitted: boolean;
  processingStatus: string;
  linkedBy: string | null;
  headers: Record<string, string>;
  receivedAt: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  attachments: InboundAttachmentMeta[];
}

export interface OutboxRecord {
  id: string;
  ticketId: string;
  kind: SetaDeskAutoEmailKind;
  dedupeKey: string;
  to: string[];
  cc: string[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
  inReplyTo: string | null;
  references: string[];
  fromMailbox: string;
  replyToProviderMessageId: string | null;
  status: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'CANCELLED';
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  sentAt: string | null;
}

export interface SyncState {
  deltaLink: string | null;
  intakeStartedAt: string | null;
}

export interface SetaDeskEmailTx {
  /** Insere a mensagem; false se o Message-ID ja existe (deduplicacao por indice unico). */
  claimEmailMessage(row: EmailMessageRecord): Promise<boolean>;
  updateEmailMessage(id: string, patch: { ticketId?: string | null; commentId?: string | null; processingStatus: string; linkedBy?: string | null }): Promise<void>;
  findTicketIdsByMessageIds(messageIds: string[]): Promise<string[]>;
  getTicketById(id: string): Promise<StoredTicket | null>;
  getTicketByKey(key: string): Promise<StoredTicket | null>;
  contactEmailOf(contactId: string | null): Promise<string | null>;
  nextTicketKey(pipeline: IntakePipeline): Promise<string>;
  insertTicket(t: NewEmailTicket): Promise<void>;
  insertComment(c: NewComment): Promise<void>;
  setTicketStatus(id: string, from: string, to: string, actor: string): Promise<void>;
  touchTicket(id: string): Promise<void>;
  findRecentRequesterTickets(email: string, sinceIso: string, excludeId: string): Promise<StoredTicket[]>;
  insertRelatedSuggestion(ticketId: string, relatedId: string, reason: string, score: number): Promise<void>;
  /** false se ja existe item com a mesma dedupe_key (um por chamado e tipo). */
  enqueueOutbox(row: OutboxRecord): Promise<boolean>;
  insertNotification(type: string, ticketId: string, title: string, body: string, dedupeKey: string): Promise<void>;
  /** E-mail de entrada que abriu o chamado (para responder em cima dele). */
  originalInboundMessage(ticketId: string): Promise<{ messageId: string; providerMessageId: string | null; references: string[]; mailbox: string } | null>;
  getPipelineById(id: string | null): Promise<IntakePipeline | null>;
}

export interface SetaDeskEmailStore {
  listPipelines(): Promise<IntakePipeline[]>;
  withTx<T>(fn: (tx: SetaDeskEmailTx) => Promise<T>): Promise<T>;
  getSyncState(mailbox: string): Promise<SyncState | null>;
  saveSyncState(mailbox: string, patch: { deltaLink?: string | null; intakeStartedAt?: string; errorCode?: string | null }): Promise<void>;
  /** Reivindica itens PENDING vencidos (status -> SENDING, attempts + 1). */
  claimDueOutbox(limit: number, nowIso: string): Promise<OutboxRecord[]>;
  completeOutbox(id: string, r: { status: 'SENT' | 'PENDING' | 'FAILED'; nextAttemptAt?: string; lastError?: string | null; sentAt?: string }): Promise<void>;
  /** Itens presos em SENDING ha mais de staleMinutes viram FAILED (nunca reenviados: evita duplicar). */
  failStaleSending(staleMinutes: number, nowIso: string): Promise<number>;
  /** Grava first_viewed_at/by somente na primeira vez (atomico). */
  markFirstViewed(idOrKey: string, viewer: string, nowIso: string): Promise<{ ticket: StoredTicket; firstTime: boolean } | null>;
  getTicketByIdOrKey(idOrKey: string): Promise<StoredTicket | null>;
}

export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;

// ---------------------------------------------------------------------------
// Implementacao em memoria (testes / desenvolvimento sem banco).
// ---------------------------------------------------------------------------
export interface MemoryState {
  pipelines: IntakePipeline[];
  tickets: Array<StoredTicket & Partial<NewEmailTicket> & { updatedAt?: string }>;
  comments: NewComment[];
  emailMessages: EmailMessageRecord[];
  outbox: OutboxRecord[];
  related: Array<{ ticketId: string; relatedId: string; reason: string; score: number }>;
  notifications: Array<{ type: string; ticketId: string; dedupeKey: string }>;
  history: Array<{ ticketId: string; field: string; from: string; to: string; actor: string }>;
  contacts: Array<{ id: string; email: string }>;
  sync: Map<string, SyncState & { errorCode?: string | null }>;
  sequences: Map<string, number>;
}

export function createMemorySetaDeskEmailStore(init?: Partial<MemoryState>): SetaDeskEmailStore & { state: MemoryState } {
  const state: MemoryState = {
    pipelines: init?.pipelines || [],
    tickets: init?.tickets || [],
    comments: init?.comments || [],
    emailMessages: init?.emailMessages || [],
    outbox: init?.outbox || [],
    related: init?.related || [],
    notifications: init?.notifications || [],
    history: init?.history || [],
    contacts: init?.contacts || [],
    sync: init?.sync || new Map(),
    sequences: init?.sequences || new Map(),
  };
  const byKey = (key: string) => state.tickets.find((t) => t.key.toUpperCase() === key.toUpperCase()) || null;
  const byId = (id: string) => state.tickets.find((t) => t.id === id) || null;
  const tx: SetaDeskEmailTx = {
    async claimEmailMessage(row) {
      if (state.emailMessages.some((m) => m.messageId.toLowerCase() === row.messageId.toLowerCase())) return false;
      state.emailMessages.push({ ...row });
      return true;
    },
    async updateEmailMessage(id, patch) {
      const m = state.emailMessages.find((x) => x.id === id);
      if (!m) return;
      if (patch.ticketId !== undefined) m.ticketId = patch.ticketId;
      if (patch.commentId !== undefined) m.commentId = patch.commentId;
      if (patch.linkedBy !== undefined) m.linkedBy = patch.linkedBy;
      m.processingStatus = patch.processingStatus;
    },
    async findTicketIdsByMessageIds(ids) {
      const set = new Set(ids.map((i) => i.toLowerCase()));
      return [...new Set(state.emailMessages.filter((m) => m.ticketId && set.has(m.messageId.toLowerCase())).map((m) => m.ticketId!))];
    },
    async getTicketById(id) {
      return byId(id);
    },
    async getTicketByKey(key) {
      return byKey(key);
    },
    async contactEmailOf(contactId) {
      return (contactId && state.contacts.find((c) => c.id === contactId)?.email) || null;
    },
    async nextTicketKey(pl) {
      const n = (state.sequences.get(pl.sequenceName) || 0) + 1;
      state.sequences.set(pl.sequenceName, n);
      return `${pl.prefix}-${n}`;
    },
    async insertTicket(t) {
      state.tickets.push({
        ...t,
        status: 'OPEN',
        channel: 'EMAIL',
        source: 'EMAIL',
        firstViewedAt: null,
        firstViewedBy: null,
      });
    },
    async insertComment(c) {
      if (!state.comments.some((x) => x.id === c.id)) state.comments.push(c);
    },
    async setTicketStatus(id, from, to, actor) {
      const t = byId(id);
      if (t && t.status === from) {
        t.status = to;
        state.history.push({ ticketId: id, field: 'status', from, to, actor });
      }
    },
    async touchTicket(id) {
      const t = byId(id);
      if (t) t.updatedAt = new Date().toISOString();
    },
    async findRecentRequesterTickets(email, sinceIso, excludeId) {
      return state.tickets.filter(
        (t) => t.id !== excludeId && (t.requesterEmail || '').toLowerCase() === email.toLowerCase() && t.createdAt >= sinceIso
      );
    },
    async insertRelatedSuggestion(ticketId, relatedId, reason, score) {
      if (!state.related.some((r) => r.ticketId === ticketId && r.relatedId === relatedId)) state.related.push({ ticketId, relatedId, reason, score });
    },
    async enqueueOutbox(row) {
      if (state.outbox.some((o) => o.dedupeKey === row.dedupeKey)) return false;
      state.outbox.push({ ...row });
      return true;
    },
    async insertNotification(type, ticketId, _title, _body, dedupeKey) {
      if (!state.notifications.some((n) => n.dedupeKey === dedupeKey)) state.notifications.push({ type, ticketId, dedupeKey });
    },
    async originalInboundMessage(ticketId) {
      const m = state.emailMessages.find((x) => x.ticketId === ticketId && x.direction === 'INBOUND' && x.linkedBy === 'NEW_TICKET');
      return m ? { messageId: m.messageId, providerMessageId: m.providerMessageId, references: m.references, mailbox: m.mailbox } : null;
    },
    async getPipelineById(id) {
      return state.pipelines.find((p) => p.id === id) || null;
    },
  };
  return {
    state,
    async listPipelines() {
      return state.pipelines;
    },
    async withTx(fn) {
      // Sem rollback real: suficiente para os testes (cada caso usa um store novo).
      return fn(tx);
    },
    async getSyncState(mailbox) {
      return state.sync.get(mailbox) || null;
    },
    async saveSyncState(mailbox, patch) {
      const cur = state.sync.get(mailbox) || { deltaLink: null, intakeStartedAt: null };
      state.sync.set(mailbox, {
        deltaLink: patch.deltaLink !== undefined ? patch.deltaLink : cur.deltaLink,
        intakeStartedAt: cur.intakeStartedAt || patch.intakeStartedAt || null,
        errorCode: patch.errorCode !== undefined ? patch.errorCode : (cur as { errorCode?: string | null }).errorCode ?? null,
      });
    },
    async claimDueOutbox(limit, nowIso) {
      const due = state.outbox.filter((o) => o.status === 'PENDING' && o.nextAttemptAt <= nowIso).slice(0, limit);
      for (const o of due) {
        o.status = 'SENDING';
        o.attempts += 1;
      }
      return due.map((o) => ({ ...o }));
    },
    async completeOutbox(id, r) {
      const o = state.outbox.find((x) => x.id === id);
      if (!o) return;
      o.status = r.status;
      if (r.nextAttemptAt) o.nextAttemptAt = r.nextAttemptAt;
      if (r.lastError !== undefined) o.lastError = r.lastError;
      if (r.sentAt) o.sentAt = r.sentAt;
    },
    async failStaleSending() {
      return 0;
    },
    async markFirstViewed(idOrKey, viewer, nowIso) {
      const t = byId(idOrKey) || byKey(idOrKey);
      if (!t) return null;
      if (t.firstViewedAt) return { ticket: { ...t }, firstTime: false };
      t.firstViewedAt = nowIso;
      t.firstViewedBy = viewer;
      return { ticket: { ...t }, firstTime: true };
    },
    async getTicketByIdOrKey(idOrKey) {
      return byId(idOrKey) || byKey(idOrKey);
    },
  };
}
