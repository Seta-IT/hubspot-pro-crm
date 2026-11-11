// Lógica pura do compositor de e-mail do CRM (padrão HubSpot).
// Sem I/O: dias úteis da tarefa, destinatários por tipo de registro e associação na timeline.

import { FOLLOWUP_HOLIDAYS } from '../../modules/deals/proposal-followup-config';

export const COMPOSER_TIMEZONE = 'America/Sao_Paulo';

export type FollowUpPreset =
  | 'tomorrow'
  | 'business_2'
  | 'business_3'
  | 'week_1'
  | 'week_2'
  | 'month_1'
  | 'custom';

export const FOLLOW_UP_PRESETS: ReadonlyArray<{ id: FollowUpPreset; label: string }> = [
  { id: 'tomorrow', label: 'Amanhã' },
  { id: 'business_2', label: 'Em 2 dias úteis' },
  { id: 'business_3', label: 'Em 3 dias úteis' },
  { id: 'week_1', label: 'Em 1 semana' },
  { id: 'week_2', label: 'Em 2 semanas' },
  { id: 'month_1', label: 'Em 1 mês' },
  { id: 'custom', label: 'Data personalizada' },
];

const WEEKDAYS_PT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;

export function todayYmd(now: Date = new Date(), timeZone: string = COMPOSER_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

export function addCalendarDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map((n) => Number(n));
  if (!y || !m || !d) throw new Error('Data inválida.');
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function addCalendarMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map((n) => Number(n));
  if (!y || !m || !d) throw new Error('Data inválida.');
  const dt = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(d, lastDay));
  return dt.toISOString().slice(0, 10);
}

export function weekdayIndex(ymd: string): number {
  const [y, m, d] = ymd.split('-').map((n) => Number(n));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isWeekendOrHolidayYmd(
  ymd: string,
  holidays: readonly string[] = FOLLOWUP_HOLIDAYS
): boolean {
  const dow = weekdayIndex(ymd);
  if (dow === 0 || dow === 6) return true;
  return holidays.includes(ymd);
}

/** Soma n dias úteis (pula sábados, domingos e feriados nacionais/SP). */
export function addBusinessDays(
  ymd: string,
  days: number,
  holidays: readonly string[] = FOLLOWUP_HOLIDAYS
): string {
  if (!Number.isFinite(days) || days === 0) return ymd;
  const step = days > 0 ? 1 : -1;
  let left = Math.abs(Math.trunc(days));
  let cur = ymd;
  while (left > 0) {
    cur = addCalendarDays(cur, step);
    if (!isWeekendOrHolidayYmd(cur, holidays)) left -= 1;
  }
  return cur;
}

export function followUpDueYmd(
  preset: FollowUpPreset,
  fromYmd: string,
  customYmd?: string | null,
  holidays: readonly string[] = FOLLOWUP_HOLIDAYS
): string {
  switch (preset) {
    case 'tomorrow':
      return addCalendarDays(fromYmd, 1);
    case 'business_2':
      return addBusinessDays(fromYmd, 2, holidays);
    case 'business_3':
      return addBusinessDays(fromYmd, 3, holidays);
    case 'week_1':
      return addCalendarDays(fromYmd, 7);
    case 'week_2':
      return addCalendarDays(fromYmd, 14);
    case 'month_1':
      return addCalendarMonths(fromYmd, 1);
    case 'custom': {
      const raw = String(customYmd || '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
      throw new Error('Informe uma data personalizada.');
    }
    default:
      return addBusinessDays(fromYmd, 2, holidays);
  }
}

export function formatYmdPt(ymd: string): string {
  const [, m, d] = ymd.split('-');
  return `${d}/${m}`;
}

export function formatFollowUpOptionLabel(
  preset: FollowUpPreset,
  fromYmd: string,
  customYmd?: string | null,
  holidays: readonly string[] = FOLLOWUP_HOLIDAYS
): string {
  const base = FOLLOW_UP_PRESETS.find((p) => p.id === preset)?.label || 'Em 2 dias úteis';
  if (preset === 'custom' && !customYmd) return base;
  const due = followUpDueYmd(preset, fromYmd, customYmd, holidays);
  const wd = WEEKDAYS_PT[weekdayIndex(due)] || '';
  return `${base} (${wd}, ${formatYmdPt(due)})`;
}

export type ComposerRecordKind = 'contact' | 'company' | 'deal';

export interface ComposerContactInput {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  companyId?: string | null;
  companyName?: string | null;
}

export interface ComposerRecipient {
  email: string;
  name: string;
  contactId: string | null;
}

function contactDisplayName(c: ComposerContactInput): string {
  const joined = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  return joined || String(c.name || '').trim();
}

function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

export function recipientFromContact(contact: ComposerContactInput | null | undefined): ComposerRecipient | null {
  const email = String(contact?.email || '').trim();
  if (!email || !email.includes('@')) return null;
  return {
    email,
    name: contact ? contactDisplayName(contact) : '',
    contactId: contact?.id || null,
  };
}

/**
 * Destinatários padrão do campo Para:
 * - contato: o e-mail do próprio registro;
 * - empresa ou negócio: o contato principal e os demais contatos associados com e-mail.
 */
export function defaultRecipientsForRecord(input: {
  kind: ComposerRecordKind;
  contact?: ComposerContactInput | null;
  associatedContacts?: ComposerContactInput[];
}): ComposerRecipient[] {
  const seen = new Set<string>();
  const out: ComposerRecipient[] = [];
  const add = (c?: ComposerContactInput | null) => {
    const rec = recipientFromContact(c);
    if (!rec) return;
    const key = normalizeEmail(rec.email);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(rec);
  };
  if (input.kind === 'contact') {
    add(input.contact);
    return out;
  }
  add(input.contact);
  for (const c of input.associatedContacts || []) add(c);
  return out;
}

export interface TimelineAssociations {
  contactId: string | null;
  contactLabel: string | null;
  companyId: string | null;
  companyLabel: string | null;
  dealId: string | null;
  dealLabel: string | null;
}

export function emptyTimelineAssociations(): TimelineAssociations {
  return {
    contactId: null,
    contactLabel: null,
    companyId: null,
    companyLabel: null,
    dealId: null,
    dealLabel: null,
  };
}

export function defaultTimelineAssociations(input: {
  kind: ComposerRecordKind;
  deal?: { id: string; title?: string | null } | null;
  contact?: { id: string; firstName?: string | null; lastName?: string | null; name?: string | null; email?: string | null } | null;
  company?: { id: string; name?: string | null } | null;
}): TimelineAssociations {
  const contactLabel = input.contact
    ? [input.contact.firstName, input.contact.lastName].filter(Boolean).join(' ').trim() ||
      String(input.contact.name || input.contact.email || '').trim() ||
      null
    : null;
  const base = emptyTimelineAssociations();
  if (input.kind === 'deal' || input.deal) {
    base.dealId = input.deal?.id || null;
    base.dealLabel = input.deal?.title || null;
  }
  if (input.kind === 'company' || input.kind === 'deal' || input.company) {
    base.companyId = input.company?.id || null;
    base.companyLabel = input.company?.name || null;
  }
  if (input.kind === 'contact' || input.contact) {
    base.contactId = input.contact?.id || null;
    base.contactLabel = contactLabel;
  }
  // Empresa: associa a empresa e o contato principal, se houver.
  if (input.kind === 'company') {
    base.dealId = null;
    base.dealLabel = null;
  }
  if (input.kind === 'contact') {
    base.dealId = null;
    base.dealLabel = null;
    if (!input.company) {
      base.companyId = null;
      base.companyLabel = null;
    }
  }
  return base;
}

export function countTimelineAssociations(a: TimelineAssociations): number {
  return [a.contactId, a.companyId, a.dealId].filter(Boolean).length;
}

export function associationsForMailboxSend(a: TimelineAssociations): {
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
} {
  return {
    contactId: a.contactId || null,
    companyId: a.companyId || null,
    dealId: a.dealId || null,
  };
}

/** O mesmo evento, com os 3 ids, aparece na timeline de cada registro associado. */
export function timelineEventAppearsOn(
  event: { contactId?: string | null; companyId?: string | null; dealId?: string | null },
  record: { contactId?: string | null; companyId?: string | null; dealId?: string | null }
): boolean {
  if (record.contactId && event.contactId === record.contactId) return true;
  if (record.companyId && event.companyId === record.companyId) return true;
  if (record.dealId && event.dealId === record.dealId) return true;
  return false;
}

export interface TemplateVarContext {
  contact?: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    name?: string | null;
    jobTitle?: string | null;
  } | null;
  company?: { name?: string | null; domain?: string | null } | null;
  deal?: { title?: string | null; value?: number | null } | null;
  sender?: { name?: string | null; email?: string | null } | null;
}

export function fillTemplateVars(text: string, ctx: TemplateVarContext): string {
  const contactName =
    [ctx.contact?.firstName, ctx.contact?.lastName].filter(Boolean).join(' ').trim() ||
    String(ctx.contact?.name || '');
  const vars: Record<string, string> = {
    'contact.firstName': String(ctx.contact?.firstName || ''),
    'contact.lastName': String(ctx.contact?.lastName || ''),
    'contact.email': String(ctx.contact?.email || ''),
    'contact.name': contactName,
    'contact.jobTitle': String(ctx.contact?.jobTitle || ''),
    firstName: String(ctx.contact?.firstName || ''),
    'company.name': String(ctx.company?.name || ''),
    companyName: String(ctx.company?.name || ''),
    'company.domain': String(ctx.company?.domain || ''),
    'deal.title': String(ctx.deal?.title || ''),
    'deal.name': String(ctx.deal?.title || ''),
    'deal.value': ctx.deal?.value != null ? String(ctx.deal.value) : '',
    'sender.name': String(ctx.sender?.name || ''),
    'sender.email': String(ctx.sender?.email || ''),
  };
  return String(text || '').replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key: string) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : `{{${key}}}`;
  });
}

export function canSendCrmEmailFromPermissions(
  user?: {
    moduleAccess?: { crm?: boolean } | null;
    crmPermissions?: {
      contactsAccess?: string;
      companiesAccess?: string;
      dealsFunnelAccess?: string;
    } | null;
  } | null,
  kind?: ComposerRecordKind
): boolean {
  if (!user) return false;
  if (user.moduleAccess && user.moduleAccess.crm === false) return false;
  const perms = user.crmPermissions;
  if (!perms) return false;
  const allowed = (level?: string) => String(level || 'NONE').toUpperCase() !== 'NONE';
  if (kind === 'contact') return allowed(perms.contactsAccess);
  if (kind === 'company') return allowed(perms.companiesAccess);
  if (kind === 'deal') return allowed(perms.dealsFunnelAccess);
  return allowed(perms.contactsAccess) || allowed(perms.companiesAccess) || allowed(perms.dealsFunnelAccess);
}

export const NO_SEND_PERMISSION_REASON = 'Seu perfil não tem permissão para enviar e-mail do CRM.';
