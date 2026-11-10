// STI-hub — motor da sequência de follow-up da etapa "Proposta Enviada".
// Funções de agenda, parada e inscrição são puras ou usam o repositório; o envio
// de e-mail passa por deps injetadas (Outlook 365 / Graph no runtime, mock nos testes).

import type { CrmRepository } from '../../db/repository';
import { newTrackingId } from '../email/mail-tracking';
import type { Company, Contact, Deal, Pipeline, ProposalFollowupEnrollment, FollowupEnrollmentStatus, FollowupStopReason, FollowupSentStep } from '../../db/types';
export type { ProposalFollowupEnrollment, FollowupEnrollmentStatus, FollowupStopReason, FollowupSentStep };
import {
  FOLLOWUP_BUSINESS_END,
  FOLLOWUP_BUSINESS_START,
  FOLLOWUP_DEFAULT_TEMPLATES,
  FOLLOWUP_HOLIDAYS,
  FOLLOWUP_MAX_SENDS_PER_RUN,
  FOLLOWUP_SCHEDULE_OFFSET_DAYS,
  FOLLOWUP_STOP_LABEL,
  FOLLOWUP_TEMPLATE_IDS,
  FOLLOWUP_TIMEZONE,
  FOLLOWUP_TRIGGER_STAGES,
  isProposalFollowupEnabled,
} from './proposal-followup-config';

export interface FollowupStatusView {
  enabled: boolean;
  enrollment: ProposalFollowupEnrollment | null;
  statusLabel: string;
  nextSendLabel: string | null;
  sentLabel: string;
  stopLabel: string | null;
  canPause: boolean;
  canResume: boolean;
}

export interface FollowupTemplateVars {
  contato: string;
  empresa: string;
  negocio: string;
  link_proposta: string;
  vendedor: string;
}

export interface FollowupSendDeps {
  listAccounts(ownerEmail: string): Promise<{ id: string; ownerEmail: string; mailboxAddress: string; displayName?: string; status: string }[]>;
  sendMail(input: {
    ownerEmail: string;
    accountId: string;
    to: string[];
    subject: string;
    html: string;
    text: string;
    dealId: string;
    contactId: string | null;
    companyId: string | null;
    trackingId: string;
  }): Promise<{ id: string; conversationId?: string | null; internetMessageId?: string | null; trackingId?: string | null }>;
  listDealMessages?(dealId: string): Promise<Array<{
    direction: string;
    conversationId?: string | null;
    trackingId?: string | null;
    clickCount?: number;
    dealId?: string | null;
  }>>;
}

const TZ = FOLLOWUP_TIMEZONE;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Data civil YYYY-MM-DD no fuso de São Paulo. */
export function civilDateInTimezone(at: Date, timeZone = TZ): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const g = (t: string) => parts.find((p) => p.type === t)?.value || '00';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

function civilTimeInTimezone(at: Date, timeZone = TZ): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  return { hour: g('hour'), minute: g('minute') };
}

function weekdayInTimezone(at: Date, timeZone = TZ): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(at);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
}

/** Instante UTC correspondente a YYYY-MM-DD HH:MM no fuso informado. */
export function zonedCivilToUtc(ymd: string, hm: string, timeZone = TZ): Date {
  const [y, mo, d] = ymd.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  let utc = Date.UTC(y, mo - 1, d, h, mi, 0);
  for (let i = 0; i < 3; i++) {
    const cur = civilDateInTimezone(new Date(utc), timeZone);
    const tm = civilTimeInTimezone(new Date(utc), timeZone);
    const got = Date.UTC(
      Number(cur.slice(0, 4)),
      Number(cur.slice(5, 7)) - 1,
      Number(cur.slice(8, 10)),
      tm.hour,
      tm.minute,
      0
    );
    const want = Date.UTC(y, mo - 1, d, h, mi, 0);
    utc += want - got;
  }
  return new Date(utc);
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, mo, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function isWeekendOrHoliday(ymd: string, holidays: readonly string[] = FOLLOWUP_HOLIDAYS): boolean {
  const [y, mo, d] = ymd.split('-').map(Number);
  const wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // civil date as UTC noon-safe
  // weekday of a Y-M-D civil date is the UTC weekday of that Y-M-D (calendar, not timezone)
  // For Brazil this matches because we pass the already-zoned civil date.
  if (wd === 0 || wd === 6) return true;
  return holidays.includes(ymd);
}

/** Empurra para o próximo horário comercial (seg–sex, 08:30–18:00, America/Sao_Paulo). */
export function nextBusinessInstant(at: Date, now?: Date): Date {
  const base = now && at.getTime() < now.getTime() ? now : at;
  let ymd = civilDateInTimezone(base);
  let { hour, minute } = civilTimeInTimezone(base);
  const [endH, endM] = FOLLOWUP_BUSINESS_END.split(':').map(Number);
  const [startH, startM] = FOLLOWUP_BUSINESS_START.split(':').map(Number);
  const minutes = hour * 60 + minute;
  if (isWeekendOrHoliday(ymd) || minutes >= endH * 60 + endM) {
    do {
      ymd = addDaysYmd(ymd, 1);
    } while (isWeekendOrHoliday(ymd));
    return zonedCivilToUtc(ymd, FOLLOWUP_BUSINESS_START);
  }
  if (minutes < startH * 60 + startM) {
    return zonedCivilToUtc(ymd, FOLLOWUP_BUSINESS_START);
  }
  return base;
}

/** Agenda o passo `stepIndex` (0..8) a partir de `enteredAt`, já no horário comercial. */
export function scheduleFollowupStep(enteredAt: Date, stepIndex: number, now?: Date): Date {
  const days = FOLLOWUP_SCHEDULE_OFFSET_DAYS[stepIndex];
  if (days == null) throw new Error(`Passo de follow-up inválido: ${stepIndex}`);
  const enteredYmd = civilDateInTimezone(enteredAt);
  const dueYmd = addDaysYmd(enteredYmd, days);
  const due = zonedCivilToUtc(dueYmd, FOLLOWUP_BUSINESS_START);
  return nextBusinessInstant(due, now);
}

export function isFollowupTriggerStage(
  pipelineId: string | null | undefined,
  stageId: string | null | undefined,
  pipelines?: readonly Pipeline[]
): boolean {
  if (!stageId) return false;
  if (FOLLOWUP_TRIGGER_STAGES.some((s) => s.stageId === stageId && (!pipelineId || s.pipelineId === pipelineId))) {
    return true;
  }
  if (!pipelines) return false;
  const pipe = pipelines.find((p) => p.id === pipelineId) || pipelines.find((p) => p.stages.some((s) => s.id === stageId));
  const st = pipe?.stages.find((s) => s.id === stageId);
  if (!st || st.isClosed || st.isWon) return false;
  const name = st.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // Funis customizados: etapa cujo nome evoca proposta enviada / de aditivo, nunca funil de compras.
  if (pipe?.name.toLowerCase().includes('fornecedor') || pipe?.name.toLowerCase().includes('compra')) return false;
  return name.includes('proposta') && (name.includes('enviad') || name.includes('aditivo') || name.includes('simulacao'));
}

/** Substitui {var} e {{var}} (e aliases no estilo do painel de modelos). */
export function renderFollowupTemplate(text: string, vars: FollowupTemplateVars): string {
  const aliases: Record<string, string> = {
    contato: vars.contato,
    empresa: vars.empresa,
    negocio: vars.negocio,
    negócio: vars.negocio,
    link_proposta: vars.link_proposta,
    vendedor: vars.vendedor,
    'contact.firstName': vars.contato,
    'company.name': vars.empresa,
    'deal.title': vars.negocio,
    'sender.name': vars.vendedor,
    'proposta.link': vars.link_proposta,
  };
  return String(text || '').replace(/\{\{?\s*([a-zA-Z0-9_./]+)\s*\}?\}/g, (raw, key: string) => {
    const v = aliases[key] ?? aliases[key.toLowerCase()];
    return v != null ? v : raw;
  });
}

export function formatFollowupStatus(enrollment: ProposalFollowupEnrollment | null, enabled: boolean): FollowupStatusView {
  if (!enabled && !enrollment) {
    return {
      enabled,
      enrollment: null,
      statusLabel: 'Recurso desligado',
      nextSendLabel: null,
      sentLabel: '',
      stopLabel: null,
      canPause: false,
      canResume: false,
    };
  }
  if (!enrollment) {
    return {
      enabled,
      enrollment: null,
      statusLabel: 'Não iniciada',
      nextSendLabel: null,
      sentLabel: '0 de 9 enviados',
      stopLabel: null,
      canPause: false,
      canResume: false,
    };
  }
  const total = FOLLOWUP_SCHEDULE_OFFSET_DAYS.length;
  const sentLabel = `${enrollment.sentCount} de ${total} enviados`;
  if (enrollment.status === 'ACTIVE') {
    return {
      enabled,
      enrollment,
      statusLabel: 'Ativa',
      nextSendLabel: enrollment.nextSendAt
        ? new Date(enrollment.nextSendAt).toLocaleString('pt-BR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' })
        : null,
      sentLabel,
      stopLabel: null,
      canPause: true,
      canResume: false,
    };
  }
  if (enrollment.status === 'PAUSED') {
    return {
      enabled,
      enrollment,
      statusLabel: 'Pausada',
      nextSendLabel: enrollment.nextSendAt
        ? new Date(enrollment.nextSendAt).toLocaleString('pt-BR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' })
        : null,
      sentLabel,
      stopLabel: enrollment.stopReason ? FOLLOWUP_STOP_LABEL[enrollment.stopReason] : FOLLOWUP_STOP_LABEL.MANUAL_PAUSE,
      canPause: false,
      canResume: enabled,
    };
  }
  if (enrollment.status === 'COMPLETED') {
    return {
      enabled,
      enrollment,
      statusLabel: 'Concluída',
      nextSendLabel: null,
      sentLabel,
      stopLabel: FOLLOWUP_STOP_LABEL.COMPLETED,
      canPause: false,
      canResume: false,
    };
  }
  return {
    enabled,
    enrollment,
    statusLabel: 'Parada',
    nextSendLabel: null,
    sentLabel,
    stopLabel: enrollment.stopReason ? FOLLOWUP_STOP_LABEL[enrollment.stopReason] : enrollment.stopDetail,
    canPause: false,
    canResume: false,
  };
}

function newId(): string {
  return `pfu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ensureFollowupTemplates(repo: CrmRepository, nowIso = new Date().toISOString()): number {
  let created = 0;
  const existing = new Set(repo.listEmailTemplates().map((t) => t.id));
  for (const tpl of FOLLOWUP_DEFAULT_TEMPLATES) {
    if (existing.has(tpl.id)) continue;
    repo.createEmailTemplate({
      id: tpl.id,
      name: tpl.name,
      category: 'FOLLOW_UP',
      subject: tpl.subject,
      body: tpl.body,
      createdBy: 'Sistema',
      usageCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    created += 1;
  }
  return created;
}

function resolveTemplate(repo: CrmRepository, stepIndex: number): { id: string; subject: string; body: string } {
  const id = FOLLOWUP_TEMPLATE_IDS[stepIndex];
  const found = repo.listEmailTemplates().find((t) => t.id === id);
  const fallback = FOLLOWUP_DEFAULT_TEMPLATES[stepIndex];
  return {
    id,
    subject: found?.subject || fallback.subject,
    body: found?.body || fallback.body,
  };
}

export function resolveDealOwner(repo: CrmRepository, deal: Deal): { email: string; name: string } | null {
  const resolved = repo.resolveDealOwnerUser?.(deal);
  if (resolved?.email) return resolved;
  return deal.ownerName ? { email: '', name: deal.ownerName } : null;
}

function proposalLinkForDeal(repo: CrmRepository, deal: Deal): string {
  try {
    const list = repo.listProposals?.() || [];
    const prop = list.find((p: { dealId?: string | null }) => p.dealId === deal.id) || list.find((p: { companyId?: string | null }) => deal.companyId && p.companyId === deal.companyId);
    if (!prop) return '';
    const code = (prop as { publicCode?: string; shortCode?: string; code?: string }).publicCode
      || (prop as { shortCode?: string }).shortCode
      || (prop as { code?: string }).code;
    const origin = String(process.env.STI_HUB_PUBLIC_ORIGIN || 'https://sti-hub.vercel.app').replace(/\/+$/, '');
    return code ? `${origin}/p/${code}` : '';
  } catch {
    return '';
  }
}

function buildVars(repo: CrmRepository, deal: Deal, contact: Contact | null, company: Company | null): FollowupTemplateVars {
  const owner = resolveDealOwner(repo, deal);
  const contato = contact ? `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.email : 'olá';
  return {
    contato,
    empresa: company?.name || deal.title || 'sua empresa',
    negocio: deal.title || 'nossa proposta',
    link_proposta: proposalLinkForDeal(repo, deal),
    vendedor: owner?.name || deal.ownerName || 'Seta Telecom',
  };
}

export function isContactEligibleForFollowup(repo: CrmRepository, contact: Contact | null): { ok: boolean; reason?: FollowupStopReason; detail?: string } {
  if (!contact || !contact.email?.trim()) return { ok: false, reason: 'NO_VALID_EMAIL', detail: 'Negócio sem contato com e-mail.' };
  const check = repo.canSendMarketingEmailToContact(contact.id);
  if (!check.allowed) {
    const unsub = /inscri|lgpd|supress|unsub|consent/i.test(check.reason);
    return { ok: false, reason: unsub ? 'UNSUBSCRIBED' : 'NO_VALID_EMAIL', detail: check.reason };
  }
  if (!contact.isValidEmail || contact.isDisposableEmail) {
    return { ok: false, reason: 'NO_VALID_EMAIL', detail: 'E-mail inválido ou descartável.' };
  }
  return { ok: true };
}

export function syncProposalFollowupOnDealChange(repo: CrmRepository, previous: Deal, updated: Deal, now = new Date()): void {
  const nowIso = now.toISOString();
  const enteredTrigger = isFollowupTriggerStage(updated.pipelineId, updated.stageId, repo.listPipelines?.() || []);
  const leftTrigger =
    previous.stageId !== updated.stageId &&
    isFollowupTriggerStage(previous.pipelineId, previous.stageId, repo.listPipelines?.() || []) &&
    !enteredTrigger;
  const won = updated.status === 'WON' && previous.status !== 'WON';
  const lost = updated.status === 'LOST' && previous.status !== 'LOST';

  if (leftTrigger || won || lost) {
    const reason: FollowupStopReason = won ? 'DEAL_WON' : lost ? 'DEAL_LOST' : 'STAGE_CHANGED';
    stopFollowupForDeal(repo, updated.id, reason, undefined, now);
  }

  if (!isProposalFollowupEnabled()) return;
  if (!enteredTrigger) return;
  if (previous.stageId === updated.stageId && previous.status === updated.status) return;

  const existing = repo.getActiveProposalFollowup?.(updated.id);
  if (existing && existing.triggerStageId === updated.stageId && existing.status === 'ACTIVE') return;

  const contact = updated.contactId ? repo.getContactById(updated.contactId) || null : null;
  const eligibility = isContactEligibleForFollowup(repo, contact);
  ensureFollowupTemplates(repo, nowIso);
  const enrollment: ProposalFollowupEnrollment = {
    id: newId(),
    dealId: updated.id,
    contactId: updated.contactId,
    companyId: updated.companyId,
    pipelineId: updated.pipelineId,
    triggerStageId: updated.stageId,
    enteredAt: updated.stageEnteredAt || nowIso,
    status: eligibility.ok ? 'ACTIVE' : 'STOPPED',
    sentCount: 0,
    nextStepIndex: 0,
    nextSendAt: eligibility.ok ? scheduleFollowupStep(new Date(updated.stageEnteredAt || nowIso), 0, now).toISOString() : null,
    stopReason: eligibility.ok ? null : eligibility.reason || 'NO_VALID_EMAIL',
    stopDetail: eligibility.ok ? null : eligibility.detail || null,
    stoppedAt: eligibility.ok ? null : nowIso,
    lastError: null,
    sentSteps: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  repo.saveProposalFollowupEnrollment(enrollment);
}

export function stopFollowupForDeal(
  repo: CrmRepository,
  dealId: string,
  reason: FollowupStopReason,
  detail?: string,
  now = new Date()
): ProposalFollowupEnrollment | null {
  const enr = repo.getActiveProposalFollowup?.(dealId) || repo.getLatestProposalFollowup?.(dealId);
  if (!enr) return null;
  if (enr.status === 'STOPPED' || enr.status === 'COMPLETED') return enr;
  // Abertura (pixel) nunca para a sequência: quem chama com motivo inválido é ignorado.
  if ((reason as string) === 'EMAIL_OPEN') return enr;
  const nowIso = now.toISOString();
  enr.status = reason === 'MANUAL_PAUSE' ? 'PAUSED' : 'STOPPED';
  enr.stopReason = reason;
  enr.stopDetail = detail || FOLLOWUP_STOP_LABEL[reason];
  enr.stoppedAt = nowIso;
  if (reason !== 'MANUAL_PAUSE') enr.nextSendAt = null;
  enr.updatedAt = nowIso;
  repo.saveProposalFollowupEnrollment(enr);
  return enr;
}

export function stopFollowupForProposal(
  repo: CrmRepository,
  proposal: { dealId?: string | null; companyId?: string | null; id?: string },
  reason: 'PROPOSAL_VIEW' | 'PROPOSAL_ACCEPT',
  now = new Date()
): void {
  if (proposal.dealId) {
    stopFollowupForDeal(repo, proposal.dealId, reason, undefined, now);
    return;
  }
  if (!proposal.companyId) return;
  for (const enr of repo.listProposalFollowupEnrollments?.() || []) {
    if (enr.companyId === proposal.companyId && (enr.status === 'ACTIVE' || enr.status === 'PAUSED')) {
      stopFollowupForDeal(repo, enr.dealId, reason, undefined, now);
    }
  }
}

export function pauseFollowup(repo: CrmRepository, dealId: string, now = new Date()): ProposalFollowupEnrollment | null {
  return stopFollowupForDeal(repo, dealId, 'MANUAL_PAUSE', undefined, now);
}

export function resumeFollowup(repo: CrmRepository, dealId: string, now = new Date()): ProposalFollowupEnrollment | null {
  if (!isProposalFollowupEnabled()) return repo.getLatestProposalFollowup?.(dealId) || null;
  const enr = repo.getLatestProposalFollowup?.(dealId);
  if (!enr || enr.status !== 'PAUSED') return enr || null;
  const deal = repo.getDealById(dealId);
  if (!deal || !isFollowupTriggerStage(deal.pipelineId, deal.stageId, repo.listPipelines?.() || [])) return enr;
  const contact = deal.contactId ? repo.getContactById(deal.contactId) || null : null;
  const eligibility = isContactEligibleForFollowup(repo, contact);
  if (!eligibility.ok) {
    return stopFollowupForDeal(repo, dealId, eligibility.reason || 'NO_VALID_EMAIL', eligibility.detail, now) || enr;
  }
  const nowIso = now.toISOString();
  enr.status = 'ACTIVE';
  enr.stopReason = null;
  enr.stopDetail = null;
  enr.stoppedAt = null;
  if (enr.nextStepIndex >= FOLLOWUP_SCHEDULE_OFFSET_DAYS.length) {
    enr.status = 'COMPLETED';
    enr.stopReason = 'COMPLETED';
    enr.nextSendAt = null;
  } else {
    enr.nextSendAt = scheduleFollowupStep(new Date(enr.enteredAt), enr.nextStepIndex, now).toISOString();
  }
  enr.updatedAt = nowIso;
  repo.saveProposalFollowupEnrollment(enr);
  return enr;
}

export function getFollowupStatus(repo: CrmRepository, dealId: string): FollowupStatusView {
  return formatFollowupStatus(repo.getLatestProposalFollowup?.(dealId) || null, isProposalFollowupEnabled());
}

async function detectMailboxStops(repo: CrmRepository, deps: FollowupSendDeps, enr: ProposalFollowupEnrollment, now: Date): Promise<boolean> {
  if (!deps.listDealMessages) return false;
  const msgs = await deps.listDealMessages(enr.dealId);
  const ourConversations = new Set(enr.sentSteps.map((s) => s.conversationId).filter(Boolean) as string[]);
  const ourTracking = new Set(enr.sentSteps.map((s) => s.trackingId).filter(Boolean) as string[]);
  const replied = msgs.some((m) => m.direction === 'RECEBIDO' && m.conversationId && ourConversations.has(m.conversationId));
  if (replied) {
    stopFollowupForDeal(repo, enr.dealId, 'EMAIL_REPLY', undefined, now);
    return true;
  }
  const clicked = msgs.some((m) => (m.clickCount || 0) > 0 && m.trackingId && ourTracking.has(m.trackingId));
  if (clicked) {
    stopFollowupForDeal(repo, enr.dealId, 'EMAIL_CLICK', undefined, now);
    return true;
  }
  return false;
}

export type FollowupSkipReason =
  | 'NO_OWNER_EMAIL'
  | 'MAILBOX_NOT_CONNECTED'
  | 'ALREADY_SENT'
  | 'RUN_LIMIT';

export interface FollowupRunResult {
  enabled: boolean;
  scanned: number;
  sent: number;
  skipped: number;
  skippedByReason: Partial<Record<FollowupSkipReason, number>>;
  stopped: number;
  errors: number;
}

function redactEmails(text: string): string {
  return String(text || '').replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted]');
}

function logFollowup(dealId: string, reason: string, detail?: string): void {
  const clean = detail ? redactEmails(detail) : '';
  console.info(`[STI-hub follow-up] deal=${dealId} ${reason}${clean ? `: ${clean}` : ''}`);
}

function bumpSkip(out: FollowupRunResult, reason: FollowupSkipReason): void {
  out.skipped += 1;
  out.skippedByReason[reason] = (out.skippedByReason[reason] || 0) + 1;
}

export async function processDueFollowups(
  repo: CrmRepository,
  deps: FollowupSendDeps,
  now = new Date(),
  maxSends = FOLLOWUP_MAX_SENDS_PER_RUN
): Promise<FollowupRunResult> {
  const out: FollowupRunResult = { enabled: isProposalFollowupEnabled(), scanned: 0, sent: 0, skipped: 0, skippedByReason: {}, stopped: 0, errors: 0 };
  if (!out.enabled) return out;
  ensureFollowupTemplates(repo, now.toISOString());
  const active = (repo.listProposalFollowupEnrollments?.() || []).filter((e) => e.status === 'ACTIVE');
  // Sinais de parada (clique/resposta) são conferidos em toda inscrição ativa, não só nas vencidas.
  for (const enr of active) {
    if (await detectMailboxStops(repo, deps, enr, now)) out.stopped += 1;
  }
  const due = (repo.listProposalFollowupEnrollments?.() || []).filter((e) => e.status === 'ACTIVE' && e.nextSendAt && Date.parse(e.nextSendAt) <= now.getTime());
  out.scanned = due.length;
  for (const enr of due) {
    if (out.sent >= maxSends) {
      bumpSkip(out, 'RUN_LIMIT');
      logFollowup(enr.dealId, 'RUN_LIMIT', 'envio adiado para a próxima execução');
      continue;
    }
    const fresh = repo.getLatestProposalFollowup?.(enr.dealId);
    if (!fresh || fresh.status !== 'ACTIVE') continue;
    if (fresh.sentSteps.some((s) => s.stepIndex === fresh.nextStepIndex)) {
      // Idempotência: esta etapa já foi enviada; avança o ponteiro se ficou inconsistente.
      fresh.nextStepIndex += 1;
      fresh.sentCount = fresh.sentSteps.length;
      if (fresh.nextStepIndex >= FOLLOWUP_SCHEDULE_OFFSET_DAYS.length) {
        fresh.status = 'COMPLETED';
        fresh.stopReason = 'COMPLETED';
        fresh.stopDetail = FOLLOWUP_STOP_LABEL.COMPLETED;
        fresh.stoppedAt = now.toISOString();
        fresh.nextSendAt = null;
      } else {
        fresh.nextSendAt = scheduleFollowupStep(new Date(fresh.enteredAt), fresh.nextStepIndex, now).toISOString();
      }
      fresh.updatedAt = now.toISOString();
      repo.saveProposalFollowupEnrollment(fresh);
      bumpSkip(out, 'ALREADY_SENT');
      logFollowup(fresh.dealId, 'ALREADY_SENT', 'etapa já enviada; ponteiro avançado');
      continue;
    }
    if (await detectMailboxStops(repo, deps, fresh, now)) {
      out.stopped += 1;
      continue;
    }
    const deal = repo.getDealById(fresh.dealId);
    if (!deal) {
      stopFollowupForDeal(repo, fresh.dealId, 'STAGE_CHANGED', 'Negócio não encontrado.', now);
      out.stopped += 1;
      continue;
    }
    if (deal.status === 'WON' || deal.status === 'LOST' || !isFollowupTriggerStage(deal.pipelineId, deal.stageId, repo.listPipelines?.() || [])) {
      stopFollowupForDeal(repo, deal.id, deal.status === 'WON' ? 'DEAL_WON' : deal.status === 'LOST' ? 'DEAL_LOST' : 'STAGE_CHANGED', undefined, now);
      out.stopped += 1;
      continue;
    }
    const contact = deal.contactId ? repo.getContactById(deal.contactId) || null : null;
    const eligibility = isContactEligibleForFollowup(repo, contact);
    if (!eligibility.ok) {
      stopFollowupForDeal(repo, deal.id, eligibility.reason || 'NO_VALID_EMAIL', eligibility.detail, now);
      out.stopped += 1;
      continue;
    }
    const owner = resolveDealOwner(repo, deal);
    if (!owner?.email) {
      fresh.lastError = 'Proprietário do negócio sem e-mail no IAM; envio adiado.';
      fresh.updatedAt = now.toISOString();
      repo.saveProposalFollowupEnrollment(fresh);
      bumpSkip(out, 'NO_OWNER_EMAIL');
      logFollowup(deal.id, 'NO_OWNER_EMAIL', fresh.lastError);
      continue;
    }
    const accounts = (await deps.listAccounts(owner.email)).filter((a) => a.status === 'ATIVADO');
    const account = accounts[0];
    if (!account) {
      fresh.lastError = 'Caixa Outlook 365 do proprietário não está conectada; envio adiado.';
      fresh.updatedAt = now.toISOString();
      repo.saveProposalFollowupEnrollment(fresh);
      bumpSkip(out, 'MAILBOX_NOT_CONNECTED');
      logFollowup(deal.id, 'MAILBOX_NOT_CONNECTED', fresh.lastError);
      continue;
    }
    const company = deal.companyId ? repo.getCompanyById(deal.companyId) || null : null;
    const vars = buildVars(repo, deal, contact, company);
    const tpl = resolveTemplate(repo, fresh.nextStepIndex);
    const subject = renderFollowupTemplate(tpl.subject, vars);
    const text = renderFollowupTemplate(tpl.body, vars);
    const trackingId = newTrackingId();
    try {
      const sent = await deps.sendMail({
        ownerEmail: owner.email,
        accountId: account.id,
        to: [contact!.email],
        subject,
        html: text.replace(/\n/g, '<br/>'),
        text,
        dealId: deal.id,
        contactId: deal.contactId,
        companyId: deal.companyId,
        trackingId,
      });
      const stepIndex = fresh.nextStepIndex;
      fresh.sentSteps.push({
        stepIndex,
        offsetDays: FOLLOWUP_SCHEDULE_OFFSET_DAYS[stepIndex],
        templateId: tpl.id,
        sentAt: now.toISOString(),
        to: contact!.email,
        subject,
        mailboxId: account.id,
        trackingId: sent.trackingId || trackingId,
        conversationId: sent.conversationId || null,
        messageId: sent.id,
      });
      fresh.sentCount = fresh.sentSteps.length;
      fresh.nextStepIndex = stepIndex + 1;
      fresh.lastError = null;
      if (fresh.nextStepIndex >= FOLLOWUP_SCHEDULE_OFFSET_DAYS.length) {
        fresh.status = 'COMPLETED';
        fresh.stopReason = 'COMPLETED';
        fresh.stopDetail = FOLLOWUP_STOP_LABEL.COMPLETED;
        fresh.stoppedAt = now.toISOString();
        fresh.nextSendAt = null;
      } else {
        fresh.nextSendAt = scheduleFollowupStep(new Date(fresh.enteredAt), fresh.nextStepIndex, now).toISOString();
      }
      fresh.updatedAt = now.toISOString();
      repo.saveProposalFollowupEnrollment(fresh);
      repo.createTimelineEvent({
        type: 'EMAIL',
        title: `Follow-up da proposta enviado (${fresh.sentCount}/9)`,
        body: `Assunto: ${subject}\nPara: ${contact!.email}\nEtapa ${stepIndex + 1} da sequência automática (D${FOLLOWUP_SCHEDULE_OFFSET_DAYS[stepIndex]}).`,
        contactId: deal.contactId,
        companyId: deal.companyId,
        dealId: deal.id,
        actor: owner.name,
        metadata: { followup: true, stepIndex, templateId: tpl.id, trackingId: sent.trackingId || trackingId },
      });
      try {
        repo.incrementEmailTemplateUsage?.(tpl.id);
      } catch { /* uso do modelo é informativo */ }
      out.sent += 1;
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Falha no envio pela caixa Outlook.';
      fresh.lastError = redactEmails(raw) || 'Falha no envio pela caixa Outlook.';
      fresh.updatedAt = now.toISOString();
      repo.saveProposalFollowupEnrollment(fresh);
      out.errors += 1;
      logFollowup(deal.id, 'SEND_FAILED', fresh.lastError);
    }
  }
  return out;
}

// Keep the unused import referenced for typings in some tsconfigs.
void weekdayInTimezone;
