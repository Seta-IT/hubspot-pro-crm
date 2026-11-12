// ============================================================================
// SetaDesk - Entrada de e-mail: normalizacao e regras puras (sem I/O).
// ============================================================================

import { htmlToPlainText, sanitizeEmailHtml } from '../email/email-html';
import type { GraphMessage, GraphRecipient } from './graph-app-client';

export const INBOUND_BODY_TEXT_MAX = 20_000;
export const INBOUND_SUBJECT_MAX = 300;

export interface InboundAttachmentMeta {
  name: string;
  contentType: string | null;
  size: number | null;
  isInline: boolean;
}

export interface InboundEmail {
  providerMessageId: string;
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  conversationId: string | null;
  fromEmail: string | null;
  fromName: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  receivedAt: string | null;
  headers: Record<string, string>;
  attachments: InboundAttachmentMeta[];
  isEventMessage: boolean;
  isDraft: boolean;
}

/** Cabecalhos guardados (minusculos). Nada de Received/Authentication-Results com IPs internos. */
const KEPT_HEADERS = new Set([
  'message-id', 'in-reply-to', 'references', 'auto-submitted', 'x-auto-response-suppress', 'precedence',
  'x-autoreply', 'x-autorespond', 'x-autoresponder', 'list-id', 'list-unsubscribe', 'return-path',
  'content-type', 'x-ms-exchange-generated-message-source', 'x-failed-recipients',
]);

const addr = (r: GraphRecipient | undefined): string | null => {
  const a = String(r?.emailAddress?.address || '').trim().toLowerCase();
  return a.includes('@') ? a.slice(0, 254) : null;
};

const addrs = (list: GraphRecipient[] | undefined): string[] =>
  [...new Set((list || []).map(addr).filter((a): a is string => Boolean(a)))];

/** Extrai ids <...> de um cabecalho References/In-Reply-To (minusculos, ate 50). */
export function parseMessageIdList(raw: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of String(raw || '').matchAll(/<([^<>\s]{1,500})>/g)) {
    const id = `<${m[1]}>`.toLowerCase();
    if (!out.includes(id)) out.push(id);
    if (out.length >= 50) break;
  }
  return out;
}

export function normalizeMessageId(raw: string | null | undefined): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  const ids = parseMessageIdList(s);
  if (ids.length) return ids[0];
  return /^[^<>\s]{1,500}$/.test(s) ? `<${s.toLowerCase()}>` : null;
}

export function normalizeGraphMessage(m: GraphMessage): InboundEmail {
  const headers: Record<string, string> = {};
  for (const h of m.internetMessageHeaders || []) {
    const name = String(h?.name || '').trim().toLowerCase();
    if (!name || !KEPT_HEADERS.has(name)) continue;
    headers[name] = String(h?.value ?? '').slice(0, 2000);
  }
  const messageId =
    normalizeMessageId(m.internetMessageId) || normalizeMessageId(headers['message-id']) || `<graph-${m.id}@setadesk.invalid>`.toLowerCase();
  const isHtml = String(m.body?.contentType || '').toLowerCase() === 'html';
  const raw = String(m.body?.content || '');
  const bodyHtml = isHtml ? sanitizeEmailHtml(raw) : null;
  const bodyText = (isHtml ? htmlToPlainText(bodyHtml || '') : raw).trim().slice(0, INBOUND_BODY_TEXT_MAX);
  return {
    providerMessageId: m.id,
    messageId,
    inReplyTo: parseMessageIdList(headers['in-reply-to'])[0] || null,
    references: parseMessageIdList(headers['references']),
    conversationId: m.conversationId ? String(m.conversationId).slice(0, 500) : null,
    fromEmail: addr(m.from) || addr(m.sender),
    fromName: m.from?.emailAddress?.name ? String(m.from.emailAddress.name).slice(0, 200) : null,
    to: addrs(m.toRecipients),
    cc: addrs(m.ccRecipients),
    bcc: addrs(m.bccRecipients),
    subject: String(m.subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, INBOUND_SUBJECT_MAX) || '(sem assunto)',
    bodyText,
    bodyHtml,
    receivedAt: m.receivedDateTime ? new Date(Date.parse(m.receivedDateTime) || Date.now()).toISOString() : null,
    headers,
    attachments: (m.attachments || []).slice(0, 50).map((a) => ({
      name: String(a?.name || 'anexo').slice(0, 255),
      contentType: a?.contentType ? String(a.contentType).slice(0, 120) : null,
      size: Number.isFinite(Number(a?.size)) ? Number(a?.size) : null,
      isInline: Boolean(a?.isInline),
    })),
    isEventMessage: /eventMessage/i.test(String(m['@odata.type'] || '')),
    isDraft: Boolean(m.isDraft),
  };
}

export type IgnoreReason = 'AUTO_REPLY' | 'BOUNCE' | 'OWN_MAILBOX' | 'NO_SENDER' | 'NOT_A_MESSAGE';

const BOUNCE_SENDER_RE = /^(mailer-daemon|postmaster|microsoftexchange[0-9a-f]*|mail-daemon)@/i;
const BOUNCE_SUBJECT_RE =
  /^(undeliverable|undelivered mail|delivery status notification|mail delivery (failed|subsystem)|returned mail|n[aã]o foi poss[ií]vel entregar|falha na entrega|delivery has failed)/i;
const AUTO_SUBJECT_RE = /^(automatic reply|auto(matic)?[- ]?reply|out of office|resposta autom[aá]tica|ausente|fora do escrit[oó]rio)\s*:/i;

/** Regras anti-loop: auto-respostas, bounces, a propria caixa (ou outra caixa de fila) e nao-mensagens. */
export function classifyIgnorable(email: InboundEmail, ownMailboxes: readonly string[]): IgnoreReason | null {
  if (email.isEventMessage || email.isDraft) return 'NOT_A_MESSAGE';
  if (!email.fromEmail) return 'NO_SENDER';
  const own = ownMailboxes.map((m) => m.toLowerCase());
  if (own.includes(email.fromEmail)) return 'OWN_MAILBOX';
  const h = email.headers;
  const ct = String(h['content-type'] || '').toLowerCase();
  if (
    BOUNCE_SENDER_RE.test(email.fromEmail) ||
    /multipart\/report/.test(ct) ||
    /report-type=delivery-status/.test(ct) ||
    h['x-failed-recipients'] !== undefined ||
    String(h['return-path'] || '').trim() === '<>' ||
    BOUNCE_SUBJECT_RE.test(email.subject)
  ) {
    return 'BOUNCE';
  }
  const autoSubmitted = String(h['auto-submitted'] || '').trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') return 'AUTO_REPLY';
  if (h['x-auto-response-suppress'] !== undefined && String(h['x-auto-response-suppress']).trim() !== '') return 'AUTO_REPLY';
  const precedence = String(h['precedence'] || '').trim().toLowerCase();
  if (['bulk', 'list', 'junk', 'auto_reply'].includes(precedence)) return 'AUTO_REPLY';
  if (h['x-autoreply'] !== undefined || h['x-autorespond'] !== undefined || h['x-autoresponder'] !== undefined) return 'AUTO_REPLY';
  if (h['list-id'] !== undefined) return 'AUTO_REPLY';
  if (AUTO_SUBJECT_RE.test(email.subject)) return 'AUTO_REPLY';
  return null;
}

/** Chaves [PREFIX-n] no assunto, so de prefixos de filas conhecidas (maiusculas, sem repeticao). */
export function extractSubjectTicketKeys(subject: string, prefixes: readonly string[]): string[] {
  const allowed = new Set(prefixes.map((p) => p.toUpperCase().replace(/-$/, '')));
  const out: string[] = [];
  for (const m of String(subject || '').matchAll(/\[\s*([A-Za-z][A-Za-z0-9]{0,7})-(\d{1,9})\s*\]/g)) {
    const p = m[1].toUpperCase();
    if (!allowed.has(p)) continue;
    const key = `${p}-${Number(m[2])}`;
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

/** Assunto normalizado para sugestao de relacao (sem RE:/ENC:/[CHAVE], minusculo, sem acentos). */
export function normalizeSubjectForSimilarity(subject: string): string[] {
  const s = String(subject || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/^(\s*(re|res|fw|fwd|enc|tr|aw|wg)\s*:\s*)+/i, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return [...new Set(s.split(/[^a-z0-9]+/).filter((w) => w.length >= 3))];
}

export function subjectSimilarity(a: string, b: string): number {
  const x = new Set(normalizeSubjectForSimilarity(a));
  const y = new Set(normalizeSubjectForSimilarity(b));
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter += 1;
  return inter / (x.size + y.size - inter);
}

/**
 * Pacote H do CISO: mensagem de saida so e PUBLICA se TODOS os destinatarios (to, cc, bcc)
 * forem o solicitante ou o contato do chamado. Caso contrario, interna.
 */
export function isOutboundPublic(
  recipients: { to?: string[]; cc?: string[]; bcc?: string[] },
  participants: { requesterEmail?: string | null; contactEmail?: string | null }
): boolean {
  const allowed = new Set(
    [participants.requesterEmail, participants.contactEmail].map((e) => String(e || '').trim().toLowerCase()).filter(Boolean)
  );
  const all = [...(recipients.to || []), ...(recipients.cc || []), ...(recipients.bcc || [])]
    .map((e) => String(e || '').trim().toLowerCase())
    .filter(Boolean);
  return all.length > 0 && allowed.size > 0 && all.every((e) => allowed.has(e));
}

export interface LinkContact { id: string; email: string | null | undefined; companyId: string | null | undefined }
export interface LinkCompany { id: string; cnpj: string | null | undefined }

/**
 * Vincula solicitante a contato/empresa SO por e-mail exato. Mais de um contato com o mesmo
 * e-mail: so vincula a empresa se todos apontarem para a MESMA empresa; empresas diferentes
 * (CNPJs diferentes ou nao) => sem vinculo. Nunca mescla nada.
 */
export function resolveRequesterLink(
  email: string | null | undefined,
  contacts: readonly LinkContact[],
  companies: readonly LinkCompany[]
): { contactId: string | null; companyId: string | null } {
  const e = String(email || '').trim().toLowerCase();
  const none = { contactId: null, companyId: null };
  if (!e) return none;
  const hits = contacts.filter((c) => String(c.email || '').trim().toLowerCase() === e);
  if (!hits.length) return none;
  const companyIds = [...new Set(hits.map((c) => c.companyId || null))];
  const companyExists = (id: string | null) => Boolean(id && companies.some((co) => co.id === id));
  if (hits.length === 1) {
    const cid = hits[0].companyId || null;
    return { contactId: hits[0].id, companyId: companyExists(cid) ? cid : null };
  }
  if (companyIds.length === 1 && companyExists(companyIds[0])) return { contactId: null, companyId: companyIds[0] };
  return none;
}
