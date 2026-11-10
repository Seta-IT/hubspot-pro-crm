// ============================================================================
// SetaDesk - mapeamento Jira STT -> chamado SD- (puro, testavel, sem I/O)
// ----------------------------------------------------------------------------
// Decisoes (Marcéllo, 10/11/2026): prefixo SD-; SD-n usa o numero da chave STT
// (STT-123 -> SD-123); somente o projeto STT; Jira permanece somente leitura.
// Mapeamentos de status/prioridade: plano.md (aprovados).
// ============================================================================

import crypto from 'crypto';
import {
  parseTicketKeyNumber,
  SETADESK_JIRA_IMPORT_PROJECT,
  SETADESK_TICKET_KEY_PREFIX,
} from './setadesk-schema';
import type {
  ServiceTicket,
  TicketCategory,
  TicketChannel,
  TicketComment,
  TicketPriority,
  TicketSlaStatus,
  TicketStatus,
} from './types';

export const JIRA_IMPORT_SOURCE = 'JIRA';
export const JIRA_SITE = 'https://setatelecom.atlassian.net';

const STATUS_MAP: Record<string, { status: TicketStatus; tags?: string[] }> = {
  'aguardando suporte': { status: 'OPEN' },
  open: { status: 'OPEN' },
  reopened: { status: 'OPEN' },
  processando: { status: 'IN_PROGRESS' },
  'work in progress': { status: 'IN_PROGRESS' },
  escalated: { status: 'IN_PROGRESS', tags: ['ESCALADO'] },
  'aguardando cliente': { status: 'WAITING_CUSTOMER' },
  'rma enviado': { status: 'IN_PROGRESS', tags: ['RMA_ENVIADO'] },
  'rma em rota / devolvido': { status: 'IN_PROGRESS', tags: ['RMA_EM_ROTA'] },
  'rma em rota': { status: 'IN_PROGRESS', tags: ['RMA_EM_ROTA'] },
  'rma recebido / resolvido': { status: 'RESOLVED' },
  'rma recebido': { status: 'RESOLVED' },
  fechado: { status: 'CLOSED' },
  done: { status: 'CLOSED' },
  declined: { status: 'CLOSED', tags: ['DECLINED'] },
  failed: { status: 'CLOSED', tags: ['FAILED'] },
  completed: { status: 'CLOSED', tags: ['COMPLETED'] },
};

const PRIORITY_MAP: Record<string, TicketPriority> = {
  highest: 'CRITICAL',
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
  lowest: 'LOW',
};

export function toIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const fixed = s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const ms = Date.parse(fixed);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function adfOrHtmlToText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return htmlToText(value).trim();
  if (typeof value === 'object') return adfToText(value).trim();
  return String(value).trim();
}

function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

function adfToText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(adfToText).join('');
  if (typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; content?: unknown[]; attrs?: Record<string, unknown> };
  if (n.type === 'text') return n.text || '';
  if (n.type === 'hardBreak' || n.type === 'rule') return '\n';
  if (n.type === 'mention') return String(n.attrs?.text || n.attrs?.id || '');
  if (n.type === 'emoji') return String(n.attrs?.shortName || n.attrs?.text || '');
  if (n.type === 'inlineCard' || n.type === 'blockCard') return String(n.attrs?.url || '');
  const inner = (n.content || []).map(adfToText).join('');
  if (
    n.type === 'paragraph' ||
    n.type === 'heading' ||
    n.type === 'listItem' ||
    n.type === 'blockquote' ||
    n.type === 'codeBlock'
  ) {
    return inner + '\n';
  }
  return inner;
}

export function mapJiraStatus(name: string | null | undefined): { status: TicketStatus; tags: string[] } {
  const key = String(name || '').trim().toLowerCase();
  const hit = STATUS_MAP[key];
  if (hit) return { status: hit.status, tags: [...(hit.tags || [])] };
  return { status: 'OPEN', tags: [] };
}

export function mapJiraPriority(name: string | null | undefined): TicketPriority {
  const key = String(name || '').trim().toLowerCase();
  return PRIORITY_MAP[key] || 'MEDIUM';
}

export function mapJiraCategory(issueType: string | null | undefined): { category: TicketCategory; tags: string[] } {
  const t = String(issueType || '').trim().toLowerCase();
  if (t.includes('incident')) return { category: 'INCIDENT', tags: [] };
  if (t === 'rma' || t.endsWith(' rma') || t.startsWith('rma ')) return { category: 'SUPPORT', tags: ['RMA'] };
  return { category: 'SUPPORT', tags: [] };
}

export function mapJiraChannel(requestTypeName: string | null | undefined): TicketChannel {
  const t = String(requestTypeName || '').trim().toLowerCase();
  if (t.includes('e-mail') || t.includes('email')) return 'EMAIL';
  return 'WEB_PORTAL';
}

export function sdKeyFromStt(jiraKey: string): string | null {
  const n = parseTicketKeyNumber(jiraKey, SETADESK_JIRA_IMPORT_PROJECT);
  return n ? `${SETADESK_TICKET_KEY_PREFIX}-${n}` : null;
}

export function extractEquipmentSerial(...texts: Array<string | null | undefined>): string | null {
  const blob = texts.filter(Boolean).join('\n');
  const m = blob.match(/\b(?:S\/?N|N\/S|serial(?:\s*number)?)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,})\b/i);
  return m ? m[1].toUpperCase() : null;
}

function fieldName(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const p of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function pickName(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  if (typeof o.name === 'string' && o.name.trim()) return o.name.trim();
  if (typeof o.displayName === 'string' && o.displayName.trim()) return o.displayName.trim();
  if (o.value != null) return pickName(o.value);
  if (o.requestType != null) return pickName(o.requestType);
  return null;
}

function pickEmail(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  const e = typeof o.emailAddress === 'string' ? o.emailAddress.trim().toLowerCase() : '';
  return e || null;
}

function pickCustom(fields: Record<string, unknown>, ...names: string[]): unknown {
  const cf = (fields.customFields && typeof fields.customFields === 'object'
    ? (fields.customFields as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  for (const name of names) {
    if (fields[name] != null) return fields[name];
    if (cf[name] != null) return cf[name];
  }
  const keys = [...Object.keys(fields), ...Object.keys(cf)];
  for (const name of names) {
    const hit = keys.find((k) => k.toLowerCase() === name.toLowerCase());
    if (hit) return hit in fields ? fields[hit] : cf[hit];
  }
  return undefined;
}

function customScalar(value: unknown): unknown {
  if (value && typeof value === 'object' && 'value' in (value as object)) {
    return (value as { value: unknown }).value;
  }
  return value;
}

function requestTypeName(fields: Record<string, unknown>): string | null {
  const raw = pickCustom(fields, 'customfield_10010', 'Request Type');
  const unwrapped = customScalar(raw);
  if (unwrapped && typeof unwrapped === 'object' && 'requestType' in (unwrapped as object)) {
    return pickName((unwrapped as { requestType: unknown }).requestType);
  }
  return pickName(unwrapped) || pickName(raw);
}

function firstResponseAt(fields: Record<string, unknown>): string | null {
  const raw = pickCustom(fields, 'customfield_10024', '[CHART] Date of First Response', 'Date of First Response');
  const val = customScalar(raw);
  if (typeof val === 'string') return toIso(val);
  if (val && typeof val === 'object') {
    const o = val as Record<string, unknown>;
    return toIso((o.iso8601 || o.jira || o.value || o.epochMillis) as string | undefined);
  }
  return null;
}

function participantEmails(fields: Record<string, unknown>): string[] {
  const raw = pickCustom(fields, 'Request participants', 'customfield_10001');
  const val = customScalar(raw);
  const list = Array.isArray(val) ? val : val ? [val] : [];
  return [...new Set(list.map(pickEmail).filter((e): e is string => Boolean(e)))];
}

export interface JiraAttachmentRef {
  id: string;
  filename: string;
  mimeType: string | null;
  size: number | null;
  url: string | null;
  source: 'JIRA_REF';
  createdAt: string | null;
}

export interface JiraHistoryEntry {
  externalId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  actor: string | null;
  changedAt: string | null;
}

export interface JiraMappedTicket {
  ticket: ServiceTicket;
  attachments: JiraAttachmentRef[];
  changelog: JiraHistoryEntry[];
  mapping: {
    jiraKey: string;
    jiraId: string;
    sdKey: string;
    jiraStatus: string | null;
    status: TicketStatus;
    jiraPriority: string | null;
    priority: TicketPriority;
    jiraType: string | null;
    category: TicketCategory;
    requestType: string | null;
    channel: TicketChannel;
  };
  missingFields: string[];
  importHash: string;
}

function issueFields(issue: Record<string, unknown>): Record<string, unknown> {
  return ((issue.fields as Record<string, unknown>) || issue) as Record<string, unknown>;
}

export function mapJiraComments(issue: Record<string, unknown>): TicketComment[] {
  const fields = issueFields(issue);
  const block = fields.comment as { comments?: unknown[] } | unknown[] | undefined;
  const list = Array.isArray(block) ? block : Array.isArray(block?.comments) ? block!.comments! : [];
  return list.map((raw, idx) => {
    const c = (raw || {}) as Record<string, unknown>;
    const author = (c.author || {}) as Record<string, unknown>;
    const accountType = String(author.accountType || '').toLowerCase();
    const isCustomer = accountType === 'customer';
    const jsdPublic = c.jsdPublic;
    const isInternal = jsdPublic === false || jsdPublic === 'false';
    const created = toIso(c.created as string) || new Date(0).toISOString();
    return {
      id: `jira-c-${c.id || idx}`,
      author: pickName(author) || 'Jira',
      authorEmail: pickEmail(author),
      authorRole: isCustomer ? 'CUSTOMER' : 'AGENT',
      isInternal,
      body: adfOrHtmlToText(c.body),
      createdAt: created,
      source: JIRA_IMPORT_SOURCE,
      externalId: c.id != null ? String(c.id) : null,
    };
  });
}

export function mapJiraAttachments(issue: Record<string, unknown>): JiraAttachmentRef[] {
  const fields = issueFields(issue);
  const list = Array.isArray(fields.attachment) ? fields.attachment : [];
  return list.map((raw, idx) => {
    const a = (raw || {}) as Record<string, unknown>;
    return {
      id: String(a.id || `att-${idx}`),
      filename: String(a.filename || a.name || `anexo-${idx}`),
      mimeType: a.mimeType ? String(a.mimeType) : null,
      size: typeof a.size === 'number' ? a.size : a.size != null ? Number(a.size) || null : null,
      url: a.content ? String(a.content) : a.url ? String(a.url) : null,
      source: 'JIRA_REF',
      createdAt: toIso(a.created as string),
    };
  });
}

export function mapJiraChangelog(raw: unknown, issueKey?: string): JiraHistoryEntry[] {
  const out: JiraHistoryEntry[] = [];
  const root = raw as Record<string, unknown> | unknown[] | null | undefined;
  let values: unknown[] = [];
  if (Array.isArray(root)) values = root;
  else if (root && typeof root === 'object') {
    const o = root as Record<string, unknown>;
    if (Array.isArray(o.values)) values = o.values as unknown[];
    if (Array.isArray(o.histories)) values = (o.histories as unknown[]).concat(values);
    if (Array.isArray(o.items) && !values.length) values = [o];
  }
  for (const entry of values) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const items = Array.isArray(e.items) ? e.items : [];
    const when = toIso((e.created || e.createdAt) as string);
    const actor = pickName(e.author) || pickName(e.authorDisplayName) || (typeof e.author === 'string' ? e.author : null);
    const hid = e.id != null ? String(e.id) : `${issueKey || 'chg'}-${when || out.length}`;
    items.forEach((it, idx) => {
      if (!it || typeof it !== 'object') return;
      const item = it as Record<string, unknown>;
      const field = String(item.field || item.fieldId || 'unknown');
      out.push({
        externalId: `${hid}:${idx}:${field}`,
        field,
        oldValue: item.fromString != null ? String(item.fromString) : item.from != null ? String(item.from) : null,
        newValue: item.toString != null ? String(item.toString) : item.to != null ? String(item.to) : null,
        actor,
        changedAt: when,
      });
    });
  }
  return out;
}

function pauseFromChangelog(changelog: JiraHistoryEntry[], currentStatus: TicketStatus): {
  slaPausedAt: string | null;
  totalPausedMinutes: number;
} {
  const isWait = (name: string | null) => String(name || '').trim().toLowerCase() === 'aguardando cliente';
  let pausedAt: string | null = null;
  let total = 0;
  let openStart: string | null = null;
  const ordered = [...changelog]
    .filter((c) => c.field.toLowerCase() === 'status')
    .sort((a, b) => String(a.changedAt || '').localeCompare(String(b.changedAt || '')));
  for (const ev of ordered) {
    if (isWait(ev.newValue) && !openStart) openStart = ev.changedAt;
    if (openStart && !isWait(ev.newValue)) {
      const a = Date.parse(openStart);
      const b = ev.changedAt ? Date.parse(ev.changedAt) : NaN;
      if (Number.isFinite(a) && Number.isFinite(b) && b > a) total += Math.round((b - a) / 60000);
      openStart = null;
    }
  }
  if (currentStatus === 'WAITING_CUSTOMER') {
    pausedAt = openStart || (ordered.filter((e) => isWait(e.newValue)).pop()?.changedAt ?? null);
  }
  return { slaPausedAt: pausedAt, totalPausedMinutes: total };
}

function historicalSla(opts: {
  createdAt: string;
  firstRespondedAt: string | null;
  resolvedAt: string | null;
}): { slaFirstResponseDueAt: string; slaResolutionDueAt: string; slaStatus: TicketSlaStatus } {
  const createdMs = Date.parse(opts.createdAt);
  const far = new Date((Number.isFinite(createdMs) ? createdMs : Date.now()) + 100 * 365.25 * 24 * 3600 * 1000).toISOString();
  const firstDue = opts.firstRespondedAt || opts.resolvedAt || far;
  const resolveDue = opts.resolvedAt || far;
  return { slaFirstResponseDueAt: firstDue, slaResolutionDueAt: resolveDue, slaStatus: 'ON_TRACK' };
}

function collectMissing(parts: Record<string, boolean>): string[] {
  return Object.entries(parts)
    .filter(([, missing]) => missing)
    .map(([name]) => name);
}

export function mapJiraIssue(
  issue: Record<string, unknown>,
  opts: { changelog?: unknown; now?: Date } = {}
): JiraMappedTicket {
  const fields = issueFields(issue);
  const jiraKey = String(issue.key || fields.key || '');
  const jiraId = String(issue.id || fields.id || '');
  const sdKey = sdKeyFromStt(jiraKey);
  const jiraStatus = pickName(fields.status);
  const statusMap = mapJiraStatus(jiraStatus);
  const jiraPriority = pickName(fields.priority);
  const priority = mapJiraPriority(jiraPriority);
  const jiraType = pickName(fields.issuetype) || pickName(fields.issueType);
  const catMap = mapJiraCategory(jiraType);
  const requestType = requestTypeName(fields);
  const channel = mapJiraChannel(requestType);
  const createdAt = toIso(fields.created as string) || new Date(0).toISOString();
  const updatedAt = toIso(fields.updated as string) || createdAt;
  const resolvedAt =
    toIso(fields.resolutiondate as string) ||
    toIso(fields.resolutionDate as string) ||
    (statusMap.status === 'RESOLVED' || statusMap.status === 'CLOSED' ? updatedAt : null);
  const resolutionName = pickName(fields.resolution);
  const firstRespondedAt = firstResponseAt(fields);
  const description = adfOrHtmlToText(fields.description);
  const subject = String(fields.summary || '').trim() || jiraKey;
  const comments = mapJiraComments(issue);
  const attachments = mapJiraAttachments(issue);
  const changelog = mapJiraChangelog(opts.changelog ?? issue.changelog, jiraKey);
  const pause = pauseFromChangelog(changelog, statusMap.status);
  const reporter = fields.reporter;
  const assignee = fields.assignee;
  const labels = Array.isArray(fields.labels) ? fields.labels.map((l) => String(l)).filter(Boolean) : [];
  const tags = [
    'JIRA',
    `JIRA:${SETADESK_JIRA_IMPORT_PROJECT}`,
    ...statusMap.tags,
    ...catMap.tags,
    ...labels,
  ];
  const uniqueTags = [...new Set(tags)];
  const sla = historicalSla({ createdAt, firstRespondedAt, resolvedAt });
  const requesterEmail = pickEmail(reporter);
  const requesterName = pickName(reporter);
  const assigneeAgent = pickName(assignee);
  const serial = extractEquipmentSerial(subject, description);
  const closedAt = statusMap.status === 'CLOSED' ? resolvedAt || updatedAt : null;

  const missingFields = collectMissing({
    description: !description,
    requesterEmail: !requesterEmail,
    firstRespondedAt: !firstRespondedAt,
    assignee: !assignee,
    changelog: changelog.length === 0,
    slaPausedAt: statusMap.status === 'WAITING_CUSTOMER' && !pause.slaPausedAt,
  });
  if (!sdKey) missingFields.push('sdKey');

  const ticket: ServiceTicket = {
    id: `tkt-jira-${jiraId || jiraKey}`,
    key: sdKey || jiraKey,
    subject,
    description,
    category: catMap.category,
    priority,
    status: statusMap.status,
    channel,
    contactId: null,
    companyId: null,
    dealId: null,
    assignee: assigneeAgent || '',
    queue: null,
    assigneeAgent,
    equipmentSerial: serial,
    slaPausedAt: pause.slaPausedAt,
    totalPausedMinutes: pause.totalPausedMinutes,
    resolution: resolutionName,
    slaFirstResponseDueAt: sla.slaFirstResponseDueAt,
    slaResolutionDueAt: sla.slaResolutionDueAt,
    firstRespondedAt,
    resolvedAt,
    slaStatus: sla.slaStatus,
    csatScore: null,
    tags: uniqueTags,
    comments,
    createdAt,
    updatedAt,
    requesterEmail,
    requesterName,
    ccEmails: participantEmails(fields),
    source: JIRA_IMPORT_SOURCE,
    jiraKey,
    jiraId: jiraId || null,
    jiraProjectKey: SETADESK_JIRA_IMPORT_PROJECT,
    jiraUrl: `${JIRA_SITE}/browse/${jiraKey}`,
    externalCreatedAt: createdAt,
    externalUpdatedAt: updatedAt,
    externalResolvedAt: resolvedAt,
    closedAt,
  };

  const importHash = hashMappedTicket(ticket, attachments, changelog);
  ticket.importHash = importHash;
  return {
    ticket,
    attachments,
    changelog,
    mapping: {
      jiraKey,
      jiraId,
      sdKey: ticket.key,
      jiraStatus,
      status: statusMap.status,
      jiraPriority,
      priority,
      jiraType,
      category: catMap.category,
      requestType,
      channel,
    },
    missingFields,
    importHash,
  };
}

export function hashMappedTicket(
  ticket: ServiceTicket,
  attachments: JiraAttachmentRef[],
  changelog: JiraHistoryEntry[]
): string {
  const payload = {
    key: ticket.key,
    jiraKey: ticket.jiraKey,
    jiraId: ticket.jiraId,
    subject: ticket.subject,
    description: ticket.description,
    status: ticket.status,
    priority: ticket.priority,
    category: ticket.category,
    channel: ticket.channel,
    updatedAt: ticket.externalUpdatedAt || ticket.updatedAt,
    comments: (ticket.comments || []).map((c) => ({ id: c.externalId, body: c.body, at: c.createdAt })),
    attachments: attachments.map((a) => ({ id: a.id, name: a.filename, size: a.size })),
    changelog: changelog.map((c) => c.externalId),
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export type ImportAction = 'create' | 'update' | 'skip';

export interface ExistingImportRow {
  jiraKey: string;
  importHash?: string | null;
  externalUpdatedAt?: string | null;
}

export interface ImportPlanItem {
  action: ImportAction;
  reason: string;
  mapped: JiraMappedTicket;
}

export function planJiraImport(
  mapped: JiraMappedTicket[],
  existingByJiraKey: Map<string, ExistingImportRow>
): ImportPlanItem[] {
  return mapped.map((m) => {
    const key = (m.mapping.jiraKey || '').toUpperCase();
    const prev = existingByJiraKey.get(key);
    if (!prev) return { action: 'create', reason: 'jira_key ausente no SetaDesk', mapped: m };
    const incoming = Date.parse(m.ticket.externalUpdatedAt || m.ticket.updatedAt || '');
    const stored = Date.parse(prev.externalUpdatedAt || '');
    if (prev.importHash && prev.importHash === m.importHash) {
      return { action: 'skip', reason: 'import_hash identico', mapped: m };
    }
    if (Number.isFinite(incoming) && Number.isFinite(stored) && incoming <= stored) {
      return { action: 'skip', reason: 'jira.updated <= external_updated_at', mapped: m };
    }
    return { action: 'update', reason: 'jira.updated mais recente (upsert por jira_key)', mapped: m };
  });
}
