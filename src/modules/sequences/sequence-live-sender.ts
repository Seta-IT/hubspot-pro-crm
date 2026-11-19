// ============================================================================
// STI-hub — Fase 2 (19/11/2026): executor real das cadencias comerciais.
// Envia os passos de e-mail automaticos pela caixa Outlook 365 do dono da inscricao (Microsoft Graph,
// /me/sendMail), com rastreamento (/api/email-track) e registro na linha do tempo do contato.
//
// Garantias:
//  - SEQUENCES_LIVE_SEND desligado => nada e enviado (cadencias seguem so simuladas).
//  - Antes de cada envio: LGPD (supressao/descadastro/hard bounce), estado da inscricao, regras de saida,
//    allowlist de teste, janela comercial (dias uteis + fuso) e limites por caixa (hora/dia).
//  - Idempotencia: chave `${enrollmentId}:${stepOrder}`. O passo e marcado SENDING e gravado ANTES da
//    chamada ao Graph; um passo SENT ou SENDING nunca e reenviado (SENDING orfao vira erro + tarefa).
//  - Caixa desconectada / token expirado / recurso desligado: nao envia, passo PENDENTE com motivo,
//    UMA tarefa para o vendedor e nova tentativa na proxima janela. A cadencia nao quebra.
//  - Respostas: le a Caixa de Entrada do dono (Mail.Read) e aplica PAUSED_ON_REPLY.
//  - Nunca registra token nem corpo de e-mail em log.
// ============================================================================
import type { CrmRepository } from '../../db/repository';
import type { EmailSequence, SequenceEnrollment, SequenceStep, SequenceStepDelivery, SequenceStepDeliveryReasonCode } from '../../db/types';
import { getAccessToken, type MailboxDeps } from '../../api/mailbox-routes';
import { isMailboxFeatureEnabled, listGraphFolderSince, sendGraphMail, type GraphListedMessage } from '../email/ms-graph';
import { buildTrackedEmailBody, newTrackingId } from '../email/mail-tracking';
import { newMailboxId, type CrmEmailMessage } from '../email/mailbox-store';
import { shouldLogEmail } from '../email/never-log';
import { SequenceService, formatLocalYmd } from './sequence-service';
import {
  isAutoEmailStep,
  isManualEmailStep,
  isSequenceLiveSendEnabled,
  resolveMailboxSendLimits,
  resolveSequenceTestRecipients,
  stepIdempotencyKey,
} from './sequence-live-config';
import { resolveEnrollmentOwnerEmail } from './sequence-service';

export const SEQUENCE_CRON_PATH = '/api/cron/sequences';
export const SEQUENCE_MAX_SENDS_PER_RUN = 25;
export const SEQUENCE_MAX_PROVIDER_ATTEMPTS = 3;
const REPLY_LOOKBACK_DAYS = 30;
const DEFAULT_TZ = 'America/Sao_Paulo';

// ---------------------------------------------------------------------------
// Caixa remetente (injetavel nos testes)
// ---------------------------------------------------------------------------
export interface ResolvedMailbox {
  ok: true;
  accountId: string;
  ownerEmail: string;
  mailboxAddress: string;
  displayName: string;
  /** So em memoria durante a execucao; nunca persistido nem registrado. */
  accessToken: string;
}
export type MailboxResolution =
  | ResolvedMailbox
  | { ok: false; code: 'MAILBOX_FEATURE_DISABLED' | 'MAILBOX_NOT_CONNECTED' | 'MAILBOX_TOKEN_EXPIRED'; detail: string };

export interface SequenceMailSendInput {
  mailbox: ResolvedMailbox;
  to: string;
  subject: string;
  text: string;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
}
export interface SequenceMailSendResult {
  messageId: string;
  conversationId: string | null;
  internetMessageId: string | null;
  trackingId: string | null;
}

export interface SequenceMailer {
  resolveMailbox(ownerEmail: string): Promise<MailboxResolution>;
  send(input: SequenceMailSendInput): Promise<SequenceMailSendResult>;
  listInboxSince(mailbox: ResolvedMailbox, sinceIso: string): Promise<GraphListedMessage[]>;
}

export const MAILBOX_REASON_TEXT: Record<'MAILBOX_FEATURE_DISABLED' | 'MAILBOX_NOT_CONNECTED' | 'MAILBOX_TOKEN_EXPIRED' | 'NO_OWNER', string> = {
  MAILBOX_FEATURE_DISABLED: 'Envio pelo Outlook desligado no STI-hub (integração Microsoft não configurada).',
  MAILBOX_NOT_CONNECTED: 'O dono da inscrição não tem caixa Outlook conectada ao STI-hub.',
  MAILBOX_TOKEN_EXPIRED: 'A conexão da caixa Outlook do dono expirou. É preciso reconectar a caixa.',
  NO_OWNER: 'Não foi possível identificar o usuário dono da inscrição (caixa remetente).',
};

/** Implementacao real: caixas conectadas (store cifrado) + Microsoft Graph. */
export function createGraphSequenceMailer(deps: MailboxDeps, origin?: string): SequenceMailer {
  return {
    async resolveMailbox(ownerEmail) {
      if (!isMailboxFeatureEnabled()) return { ok: false, code: 'MAILBOX_FEATURE_DISABLED', detail: MAILBOX_REASON_TEXT.MAILBOX_FEATURE_DISABLED };
      const all = await deps.store.listAccounts(ownerEmail);
      const active = all.filter((a) => a.status === 'ATIVADO');
      if (!active.length) {
        return all.length
          ? { ok: false, code: 'MAILBOX_TOKEN_EXPIRED', detail: MAILBOX_REASON_TEXT.MAILBOX_TOKEN_EXPIRED }
          : { ok: false, code: 'MAILBOX_NOT_CONNECTED', detail: MAILBOX_REASON_TEXT.MAILBOX_NOT_CONNECTED };
      }
      const account = active[0];
      const token = await getAccessToken(deps, account).catch(() => null);
      if (!token) return { ok: false, code: 'MAILBOX_TOKEN_EXPIRED', detail: MAILBOX_REASON_TEXT.MAILBOX_TOKEN_EXPIRED };
      return {
        ok: true,
        accountId: account.id,
        ownerEmail: account.ownerEmail,
        mailboxAddress: account.mailboxAddress,
        displayName: account.displayName || account.ownerEmail,
        accessToken: token,
      };
    },
    async send(input) {
      const patterns = (await deps.store.listNeverLog()).map((e) => e.pattern);
      const logIt = shouldLogEmail([input.to], patterns);
      const trackingId = logIt ? newTrackingId() : null;
      const signature = await deps.store.getSignature(input.mailbox.ownerEmail).catch(() => '');
      const built = buildTrackedEmailBody({ body: input.text, signature, trackingId, origin });
      const sent = await sendGraphMail(deps.fetch, input.mailbox.accessToken, {
        to: [input.to],
        cc: [],
        subject: input.subject,
        html: built.html,
      });
      if (logIt) {
        const nowIso = new Date().toISOString();
        const rec: CrmEmailMessage = {
          id: newMailboxId('eml'),
          accountId: input.mailbox.accountId,
          ownerEmail: input.mailbox.ownerEmail,
          externalId: `graph:${sent.id}`,
          conversationId: sent.conversationId,
          internetMessageId: sent.internetMessageId,
          direction: 'ENVIADO',
          source: 'STI_HUB',
          fromAddress: input.mailbox.mailboxAddress,
          fromName: input.mailbox.displayName,
          to: [input.to],
          cc: [],
          subject: input.subject,
          bodyPreview: built.text.replace(/\s+/g, ' ').trim().slice(0, 500),
          occurredAt: nowIso,
          contactId: input.contactId,
          companyId: input.companyId,
          dealId: input.dealId,
          trackingId,
          links: built.links,
          openCount: 0,
          clickCount: 0,
          lastOpenedAt: null,
          lastClickedAt: null,
          createdAt: nowIso,
        };
        await deps.store.insertMessage(rec);
      }
      return { messageId: sent.id, conversationId: sent.conversationId, internetMessageId: sent.internetMessageId, trackingId };
    },
    async listInboxSince(mailbox, sinceIso) {
      return listGraphFolderSince(deps.fetch, mailbox.accessToken, 'inbox', sinceIso, 200);
    },
  };
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------
export interface SequenceRunResult {
  mode: 'LIVE' | 'SIMULATION';
  testAllowlistActive: boolean;
  due: number;
  sent: number;
  pending: number;
  errors: number;
  blocked: number;
  deferred: number;
  nonEmailStepsAdvanced: number;
  tasksCreated: number;
  repliesDetected: number;
  skippedReasons: Record<string, number>;
}

export interface SequenceRunDeps {
  mailer: SequenceMailer;
  /** Grava o estado (Postgres) antes do envio, para a marca SENDING sobreviver a falhas. */
  persist?: () => Promise<void>;
  now?: Date;
  service?: SequenceService;
  maxSends?: number;
  env?: NodeJS.ProcessEnv;
}

let runInProgress = false;

function emptyResult(mode: 'LIVE' | 'SIMULATION', allowlist: boolean): SequenceRunResult {
  return { mode, testAllowlistActive: allowlist, due: 0, sent: 0, pending: 0, errors: 0, blocked: 0, deferred: 0, nonEmailStepsAdvanced: 0, tasksCreated: 0, repliesDetected: 0, skippedReasons: {} };
}

function bump(out: SequenceRunResult, code: string) {
  out.skippedReasons[code] = (out.skippedReasons[code] || 0) + 1;
}

function getDelivery(enr: SequenceEnrollment, stepOrder: number): SequenceStepDelivery | undefined {
  return (enr.stepDeliveries || []).find((d) => d.stepOrder === stepOrder);
}

function upsertDelivery(enr: SequenceEnrollment, d: SequenceStepDelivery): SequenceStepDelivery {
  const list = enr.stepDeliveries || (enr.stepDeliveries = []);
  const idx = list.findIndex((x) => x.stepOrder === d.stepOrder);
  if (idx === -1) list.push(d);
  else list[idx] = d;
  return d;
}

function pushLog(enr: SequenceEnrollment, step: SequenceStep, action: SequenceEnrollment['history'][number]['action'], details: string, at: string, mailbox?: string | null) {
  enr.history.push({ stepOrder: step.stepOrder, stepType: step.stepType, dayOffset: step.dayOffset, subject: step.subject, action, timestamp: at, details, ...(mailbox ? { executedByMailbox: mailbox } : {}) });
  enr.stepHistory = enr.history;
  enr.updatedAt = at;
}

const VALID_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Mapeia o motivo da supressao LGPD para a regra de saida correspondente. */
export function suppressionExitTrigger(reason: string): 'HARD_BOUNCE' | 'SPAM_COMPLAINT' | 'CONSENT_WITHDRAWN' | 'ENTERED_SUPPRESSION_LIST' {
  const r = reason.toLowerCase();
  if (r.includes('bounce')) return 'HARD_BOUNCE';
  if (r.includes('spam')) return 'SPAM_COMPLAINT';
  if (r.includes('consent') || r.includes('revog') || r.includes('lgpd')) return 'CONSENT_WITHDRAWN';
  return 'ENTERED_SUPPRESSION_LIST';
}

/** Conta envios reais (SENT) de uma caixa na ultima hora e no dia local corrente. */
export function countMailboxSends(repo: CrmRepository, mailboxAddress: string, now: Date, tz = DEFAULT_TZ): { lastHour: number; today: number } {
  const key = mailboxAddress.trim().toLowerCase();
  const hourAgo = now.getTime() - 60 * 60 * 1000;
  const today = formatLocalYmd(now, tz);
  let lastHour = 0;
  let todayCount = 0;
  for (const e of repo.listSequenceEnrollments()) {
    for (const d of e.stepDeliveries || []) {
      if (d.status !== 'SENT' || !d.sentAt || String(d.mailboxAddress || '').toLowerCase() !== key) continue;
      const t = Date.parse(d.sentAt);
      if (t >= hourAgo && t <= now.getTime()) lastHour++;
      if (formatLocalYmd(new Date(t), tz) === today) todayCount++;
    }
  }
  return { lastHour, today: todayCount };
}

/**
 * Detecta respostas do contato na Caixa de Entrada do dono (mesma conversa ou e-mail do contato
 * depois do primeiro envio) e aplica PAUSED_ON_REPLY. Pedido de descadastro na resposta => STOP_REQUESTED.
 */
export async function detectSequenceReplies(
  repo: CrmRepository,
  mailer: SequenceMailer,
  svc: SequenceService,
  now: Date,
  mailboxCache: Map<string, MailboxResolution>
): Promise<number> {
  const candidates = repo
    .listSequenceEnrollments()
    .filter((e) => svc.isEnrollmentActive(e.status) && (e.stepDeliveries || []).some((d) => d.status === 'SENT' && d.sentAt));
  if (!candidates.length) return 0;
  const byOwner = new Map<string, SequenceEnrollment[]>();
  for (const e of candidates) {
    const owner = String(e.senderOwnerEmail || (e.stepDeliveries || []).find((d) => d.senderOwnerEmail)?.senderOwnerEmail || '').toLowerCase();
    if (!owner) continue;
    const arr = byOwner.get(owner) || [];
    arr.push(e);
    byOwner.set(owner, arr);
  }
  let replies = 0;
  for (const [owner, list] of byOwner) {
    let mb = mailboxCache.get(owner);
    if (!mb) {
      mb = await mailer.resolveMailbox(owner);
      mailboxCache.set(owner, mb);
    }
    if (!mb.ok) continue;
    const firstSent = Math.min(
      ...list.flatMap((e) => (e.stepDeliveries || []).filter((d) => d.status === 'SENT' && d.sentAt).map((d) => Date.parse(d.sentAt!)))
    );
    const since = new Date(Math.max(firstSent, now.getTime() - REPLY_LOOKBACK_DAYS * 86400000)).toISOString();
    let inbox: GraphListedMessage[] = [];
    try {
      inbox = await mailer.listInboxSince(mb, since);
    } catch {
      continue; // falha de leitura nao bloqueia o executor
    }
    for (const e of list) {
      const contact = repo.getContactById(e.contactId);
      const contactEmail = String(contact?.email || '').trim().toLowerCase();
      const sent = (e.stepDeliveries || []).filter((d) => d.status === 'SENT' && d.sentAt);
      const convs = new Set(sent.map((d) => d.conversationId).filter(Boolean) as string[]);
      const first = Math.min(...sent.map((d) => Date.parse(d.sentAt!)));
      const hit = inbox.find((m) => {
        const from = String(m.from || '').toLowerCase();
        if (from === String(mb && mb.ok ? mb.mailboxAddress : '').toLowerCase()) return false;
        if (m.conversationId && convs.has(m.conversationId)) return true;
        return Boolean(contactEmail) && from === contactEmail && Date.parse(m.at) > first;
      });
      e.lastReplyCheckAt = now.toISOString();
      if (!hit) {
        repo.saveSequenceEnrollment(e);
        continue;
      }
      const snippet = String(hit.bodyPreview || hit.subject || '').replace(/\s+/g, ' ').trim().slice(0, 280);
      if (/(descadastr|remover|remova|unsubscribe|n[aã]o (quero|desejo) (mais )?receber)/i.test(snippet)) {
        svc.evaluateExitRule(repo, { enrollmentId: e.id, trigger: 'STOP_REQUESTED', reasonDetail: 'O contato pediu, na resposta, para não receber mais a cadência.', replySnippet: snippet });
      } else {
        svc.recordInteraction(repo, { enrollmentId: e.id, interactionType: 'REPLY', replySnippet: snippet || 'Resposta recebida na caixa Outlook.' });
      }
      replies++;
    }
  }
  return replies;
}

function createSellerTask(repo: CrmRepository, enr: SequenceEnrollment, seq: EmailSequence, step: SequenceStep, title: string, notes: string, now: Date): string | null {
  const contact = repo.getContactById(enr.contactId);
  try {
    const task = repo.createTask({
      title,
      notes,
      type: 'TODO',
      priority: 'HIGH',
      status: 'NOT_STARTED',
      queueName: 'Cadências Comerciais',
      dueDate: formatLocalYmd(now, DEFAULT_TZ),
      dueTime: '10:00',
      assignedTo: enr.assignedSeller || contact?.ownerName || 'Marcelo Lopes Mira',
      contactId: enr.contactId,
      companyId: contact?.companyId ?? null,
      dealId: enr.dealId,
    });
    void seq;
    void step;
    return task.id;
  } catch {
    return null;
  }
}

/**
 * Um ciclo do executor (chamado pelo Vercel Cron em /api/cron/sequences).
 * Desligado (SEQUENCES_LIVE_SEND) => devolve mode SIMULATION e nao toca em nada.
 */
export async function runSequenceScheduler(repo: CrmRepository, deps: SequenceRunDeps): Promise<SequenceRunResult> {
  const env = deps.env || process.env;
  const allowlist = resolveSequenceTestRecipients(env);
  if (!isSequenceLiveSendEnabled(env)) return emptyResult('SIMULATION', Boolean(allowlist));
  if (runInProgress) {
    const out = emptyResult('LIVE', Boolean(allowlist));
    bump(out, 'RUN_ALREADY_IN_PROGRESS');
    return out;
  }
  runInProgress = true;
  try {
    return await runLive(repo, deps, allowlist);
  } finally {
    runInProgress = false;
  }
}

async function runLive(repo: CrmRepository, deps: SequenceRunDeps, allowlist: Set<string> | null): Promise<SequenceRunResult> {
  const now = deps.now || new Date();
  const nowIso = now.toISOString();
  const svc = deps.service || new SequenceService();
  const out = emptyResult('LIVE', Boolean(allowlist));
  const maxSends = deps.maxSends ?? SEQUENCE_MAX_SENDS_PER_RUN;
  const mailboxCache = new Map<string, MailboxResolution>();
  const persist = async () => {
    if (deps.persist) await deps.persist();
  };

  // 1) Respostas primeiro: quem respondeu nao recebe o proximo passo.
  try {
    out.repliesDetected = await detectSequenceReplies(repo, deps.mailer, svc, now, mailboxCache);
  } catch {
    bump(out, 'REPLY_CHECK_FAILED');
  }

  // 2) Passos vencidos.
  const due = repo
    .listSequenceEnrollments()
    // So inscricoes criadas no modo real (com stepDeliveries). Inscricoes antigas/simuladas (inclusive
    // dados de demonstracao) nunca passam a enviar e-mail de verdade ao ligar a flag.
    .filter((e) => Array.isArray(e.stepDeliveries) && svc.isEnrollmentActive(e.status) && e.nextStepDueAt && Date.parse(e.nextStepDueAt) <= now.getTime())
    .sort((a, b) => Date.parse(a.nextStepDueAt!) - Date.parse(b.nextStepDueAt!));
  out.due = due.length;

  for (const enr0 of due) {
    if (out.sent >= maxSends) {
      bump(out, 'MAX_SENDS_PER_RUN');
      break;
    }
    const enr = repo.getSequenceEnrollmentById(enr0.id);
    if (!enr || !svc.isEnrollmentActive(enr.status)) continue;
    const seq = repo.getSequenceById(enr.sequenceId);
    if (!seq) continue;
    const step = seq.steps.find((s) => s.stepOrder === enr.currentStepOrder + 1);

    // Sem proximo passo, ou passo que nao e e-mail (tarefa, ligacao, ramificacao, nutricao): motor atual.
    if (!step || (!isAutoEmailStep(step) && !isManualEmailStep(step))) {
      svc.advanceStep(repo, enr.id, { now, skipMailboxLimit: true });
      out.nonEmailStepsAdvanced++;
      continue;
    }

    const key = stepIdempotencyKey(enr.id, step.stepOrder);
    const prev = getDelivery(enr, step.stepOrder);

    // Idempotencia: ja enviado (falha depois do envio) => so conclui o avanco, sem reenviar.
    if (prev?.status === 'SENT') {
      svc.advanceStep(repo, enr.id, { now, skipMailboxLimit: true, liveOutcome: { kind: 'SENT', delivery: prev } });
      bump(out, 'ALREADY_SENT');
      continue;
    }
    // Envio interrompido no meio (SENDING orfao): pode ter saido. Nunca reenvia; avisa o vendedor.
    if (prev?.status === 'SENDING') {
      const reason = 'Envio interrompido no meio do processamento; pode ter saído. Confira a pasta Itens Enviados antes de reenviar manualmente.';
      const taskId = createSellerTask(repo, enr, seq, step, `[Cadência] Conferir envio do passo ${step.stepOrder}: ${seq.name}`, reason, now);
      upsertDelivery(enr, { ...prev, status: 'ERROR', reasonCode: 'SEND_UNCERTAIN', reason, taskId: taskId || prev.taskId || null, updatedAt: nowIso });
      repo.saveSequenceEnrollment(enr);
      svc.advanceStep(repo, enr.id, { now, skipMailboxLimit: true, liveOutcome: { kind: 'NOT_SENT', reason } });
      if (taskId) out.tasksCreated++;
      out.errors++;
      continue;
    }

    const contact = repo.getContactById(enr.contactId);
    const rendered = svc.renderStepForContact(repo, enr.contactId, step);
    const base: SequenceStepDelivery = prev || {
      stepOrder: step.stepOrder,
      idempotencyKey: key,
      status: 'SCHEDULED',
      attempts: 0,
      updatedAt: nowIso,
    };
    base.idempotencyKey = key;
    base.subject = rendered.subject;
    base.recipient = contact?.email || null;

    const reschedule = (delayDays: number, delayHours = 0) => {
      const calc = svc.calculateNextBusinessExecutionWindow({ baseDate: now, delayDays, delayHours, sendingWindow: seq.sendingWindow, recipientTimezone: enr.recipientTimezone || DEFAULT_TZ });
      enr.nextStepDueAt = calc.scheduledAtIso;
      enr.nextScheduledExecutionAt = calc.scheduledAtIso;
      return calc;
    };
    const markPending = (code: SequenceStepDeliveryReasonCode, reason: string, opts: { task?: boolean; delayDays?: number; logAction?: 'LIVE_SEND_PENDING' | 'LIVE_SEND_BLOCKED' } = {}) => {
      const changed = base.reasonCode !== code;
      let taskId = base.taskId || null;
      if (opts.task && (!taskId || changed)) {
        taskId = createSellerTask(
          repo,
          enr,
          seq,
          step,
          `[Cadência] Passo ${step.stepOrder} não enviado: ${seq.name}`,
          `${reason} Contato: ${contact?.email || enr.contactId}. Assunto: ${rendered.subject}. O passo será tentado de novo na próxima janela de envio.`,
          now
        );
        if (taskId) out.tasksCreated++;
      }
      const calc = reschedule(opts.delayDays ?? 1);
      upsertDelivery(enr, { ...base, status: 'PENDING', reasonCode: code, reason, taskId, updatedAt: nowIso });
      if (changed) pushLog(enr, step, opts.logAction || 'LIVE_SEND_PENDING', `${reason} Nova tentativa em ${calc.scheduledLocalDisplay} (${calc.timezoneUsed}).`, nowIso);
      repo.saveSequenceEnrollment(enr);
      out.pending++;
      bump(out, code);
    };

    // a) Janela comercial (dias uteis, feriados, fuso do destinatario ou America/Sao_Paulo).
    const win = svc.calculateNextBusinessExecutionWindow({ baseDate: now, delayDays: 0, delayHours: 0, sendingWindow: seq.sendingWindow, recipientTimezone: enr.recipientTimezone || DEFAULT_TZ });
    if (Date.parse(win.scheduledAtIso) > now.getTime() + 60_000) {
      enr.nextStepDueAt = win.scheduledAtIso;
      enr.nextScheduledExecutionAt = win.scheduledAtIso;
      upsertDelivery(enr, { ...base, status: 'SCHEDULED', reasonCode: 'OUTSIDE_SENDING_WINDOW', reason: `Fora da janela de envio; agendado para ${win.scheduledLocalDisplay} (${win.timezoneUsed}).`, updatedAt: nowIso });
      repo.saveSequenceEnrollment(enr);
      out.deferred++;
      bump(out, 'OUTSIDE_SENDING_WINDOW');
      continue;
    }

    // b) LGPD: supressao, descadastro, hard bounce, consentimento revogado.
    const elig = repo.canSendMarketingEmailToContact(enr.contactId);
    if (!elig.allowed) {
      upsertDelivery(enr, { ...base, status: 'BLOCKED', reasonCode: 'SUPPRESSED_LGPD', reason: elig.reason, updatedAt: nowIso });
      repo.saveSequenceEnrollment(enr);
      svc.evaluateExitRule(repo, { enrollmentId: enr.id, trigger: suppressionExitTrigger(elig.reason), reasonDetail: `Envio bloqueado antes do disparo: ${elig.reason}` });
      out.blocked++;
      bump(out, 'SUPPRESSED_LGPD');
      continue;
    }

    // c) Regras de saida verificaveis antes do envio (negocio ganho/perdido).
    if (enr.dealId) {
      const deal = repo.getDealById(enr.dealId) as { status?: string } | undefined;
      if (deal && (deal.status === 'WON' || deal.status === 'LOST')) {
        upsertDelivery(enr, { ...base, status: 'BLOCKED', reasonCode: 'EXIT_RULE', reason: `Negócio ${deal.status === 'WON' ? 'ganho' : 'perdido'}; cadência encerrada antes do envio.`, updatedAt: nowIso });
        repo.saveSequenceEnrollment(enr);
        svc.evaluateExitRule(repo, { enrollmentId: enr.id, trigger: 'DEAL_WON_OR_LOST', reasonDetail: 'Negócio fechado antes do envio do próximo passo.' });
        out.blocked++;
        bump(out, 'EXIT_RULE');
        continue;
      }
    }

    // d) Destinatario valido.
    const to = String(contact?.email || '').trim().toLowerCase();
    if (!VALID_EMAIL_RE.test(to)) {
      markPending('INVALID_RECIPIENT', 'O contato não tem e-mail válido.', { task: true, delayDays: 1 });
      continue;
    }

    // e) Passo de e-mail manual: vira tarefa do vendedor e a cadencia segue.
    if (isManualEmailStep(step)) {
      const reason = `Passo de e-mail manual: tarefa criada para o vendedor enviar "${rendered.subject}" pela própria caixa.`;
      const taskId = createSellerTask(repo, enr, seq, step, `[Cadência] Enviar e-mail manual: ${rendered.subject}`, `${rendered.body}\n\nPara: ${to}`, now);
      if (taskId) out.tasksCreated++;
      upsertDelivery(enr, { ...base, status: 'PENDING', reasonCode: 'MANUAL_STEP', reason, taskId, updatedAt: nowIso });
      repo.saveSequenceEnrollment(enr);
      svc.advanceStep(repo, enr.id, { now, skipMailboxLimit: true, liveOutcome: { kind: 'MANUAL_TASK', reason } });
      bump(out, 'MANUAL_STEP');
      continue;
    }

    // f) Allowlist de teste (homologacao).
    if (allowlist && !allowlist.has(to)) {
      markPending('NOT_IN_TEST_ALLOWLIST', 'Destinatário fora da lista de teste (SEQUENCES_TEST_RECIPIENTS); envio real retido.', { delayDays: 1, logAction: 'LIVE_SEND_BLOCKED' });
      continue;
    }

    // g) Dono e caixa Outlook.
    const ownerEmail =
      String(enr.senderOwnerEmail || '').trim().toLowerCase() ||
      resolveEnrollmentOwnerEmail(repo, { assignedSeller: enr.assignedSeller, contactId: enr.contactId, dealId: enr.dealId, preferAssignedSeller: seq.leadRoutingMode === 'ROUND_ROBIN' });
    if (!ownerEmail) {
      markPending('NO_OWNER', MAILBOX_REASON_TEXT.NO_OWNER, { task: true });
      continue;
    }
    if (!enr.senderOwnerEmail) enr.senderOwnerEmail = ownerEmail;
    let mb = mailboxCache.get(ownerEmail);
    if (!mb) {
      try {
        mb = await deps.mailer.resolveMailbox(ownerEmail);
      } catch {
        mb = { ok: false, code: 'MAILBOX_TOKEN_EXPIRED', detail: MAILBOX_REASON_TEXT.MAILBOX_TOKEN_EXPIRED };
      }
      mailboxCache.set(ownerEmail, mb);
    }
    if (!mb.ok) {
      base.senderOwnerEmail = ownerEmail;
      markPending(mb.code, mb.detail, { task: true });
      continue;
    }

    // h) Limites por caixa (protecao do dominio).
    const limits = resolveMailboxSendLimits(seq, deps.env);
    const counts = countMailboxSends(repo, mb.mailboxAddress, now, seq.sendingWindow?.defaultTimezone || DEFAULT_TZ);
    if (counts.today >= limits.perDay) {
      markPending('MAILBOX_DAILY_LIMIT', `Limite diário da caixa ${mb.mailboxAddress} (${limits.perDay} envios de cadência/dia) atingido.`, { delayDays: 1 });
      out.pending--;
      out.deferred++;
      continue;
    }
    if (counts.lastHour >= limits.perHour) {
      // Fica vencido; sai na proxima execucao do cron depois que a janela de 1 hora aliviar.
      upsertDelivery(enr, { ...base, status: 'SCHEDULED', reasonCode: 'MAILBOX_HOURLY_LIMIT', reason: `Limite por hora da caixa ${mb.mailboxAddress} (${limits.perHour}/h) atingido; aguardando.`, updatedAt: nowIso });
      repo.saveSequenceEnrollment(enr);
      out.deferred++;
      bump(out, 'MAILBOX_HOURLY_LIMIT');
      continue;
    }

    // i) Reserva idempotente gravada ANTES do envio.
    const attempt = (base.attempts || 0) + 1;
    upsertDelivery(enr, { ...base, status: 'SENDING', reasonCode: null, reason: null, attempts: attempt, senderOwnerEmail: ownerEmail, mailboxAddress: mb.mailboxAddress, updatedAt: nowIso });
    repo.saveSequenceEnrollment(enr);
    try {
      await persist();
    } catch {
      // Sem conseguir gravar a reserva nao e seguro enviar (risco de duplicar).
      upsertDelivery(enr, { ...base, status: base.status === 'SCHEDULED' ? 'SCHEDULED' : base.status, updatedAt: nowIso });
      repo.saveSequenceEnrollment(enr);
      bump(out, 'PERSIST_FAILED');
      break;
    }

    try {
      const res = await deps.mailer.send({
        mailbox: mb,
        to,
        subject: rendered.subject,
        text: rendered.body,
        contactId: enr.contactId,
        companyId: contact?.companyId ?? null,
        dealId: enr.dealId,
      });
      const delivery = upsertDelivery(enr, {
        ...base,
        status: 'SENT',
        reasonCode: null,
        reason: null,
        attempts: attempt,
        senderOwnerEmail: ownerEmail,
        mailboxAddress: mb.mailboxAddress,
        recipient: to,
        messageId: res.messageId,
        conversationId: res.conversationId,
        internetMessageId: res.internetMessageId,
        trackingId: res.trackingId,
        sentAt: nowIso,
        updatedAt: nowIso,
      });
      repo.saveSequenceEnrollment(enr);
      svc.advanceStep(repo, enr.id, { now, skipMailboxLimit: true, liveOutcome: { kind: 'SENT', delivery } });
      out.sent++;
      try {
        await persist();
      } catch {
        bump(out, 'PERSIST_AFTER_SEND_FAILED');
      }
    } catch (err) {
      const code = String((err as { code?: string })?.code || 'GRAPH_ERROR').replace(/[^A-Za-z0-9_]/g, '').slice(0, 60);
      const status = Number((err as { status?: number })?.status || 0);
      if (status === 401) {
        // Token recusado: trata como caixa a reconectar.
        mailboxCache.set(ownerEmail, { ok: false, code: 'MAILBOX_TOKEN_EXPIRED', detail: MAILBOX_REASON_TEXT.MAILBOX_TOKEN_EXPIRED });
        base.attempts = attempt;
        markPending('MAILBOX_TOKEN_EXPIRED', MAILBOX_REASON_TEXT.MAILBOX_TOKEN_EXPIRED, { task: true });
        continue;
      }
      const reason = `Falha do provedor ao enviar (código ${code}${status ? `, HTTP ${status}` : ''}), tentativa ${attempt} de ${SEQUENCE_MAX_PROVIDER_ATTEMPTS}.`;
      if (attempt >= SEQUENCE_MAX_PROVIDER_ATTEMPTS) {
        const taskId = createSellerTask(repo, enr, seq, step, `[Cadência] Falha no envio do passo ${step.stepOrder}: ${seq.name}`, `${reason} O passo foi marcado como não enviado e a cadência seguiu.`, now);
        if (taskId) out.tasksCreated++;
        upsertDelivery(enr, { ...base, status: 'ERROR', reasonCode: 'PROVIDER_ERROR', reason, attempts: attempt, taskId, updatedAt: nowIso });
        repo.saveSequenceEnrollment(enr);
        svc.advanceStep(repo, enr.id, { now, skipMailboxLimit: true, liveOutcome: { kind: 'NOT_SENT', reason } });
      } else {
        const calc = reschedule(0, 1);
        upsertDelivery(enr, { ...base, status: 'ERROR', reasonCode: 'PROVIDER_ERROR', reason, attempts: attempt, updatedAt: nowIso });
        pushLog(enr, step, 'LIVE_SEND_ERROR', `${reason} Nova tentativa em ${calc.scheduledLocalDisplay}.`, nowIso, mb.mailboxAddress);
        repo.saveSequenceEnrollment(enr);
      }
      out.errors++;
      bump(out, 'PROVIDER_ERROR');
      try {
        await persist();
      } catch {
        bump(out, 'PERSIST_AFTER_SEND_FAILED');
      }
    }
  }
  return out;
}

/** Situacao da caixa do dono para a interface (sem tokens). */
export async function describeOwnerMailboxes(
  repo: CrmRepository,
  mailer: Pick<SequenceMailer, 'resolveMailbox'> | null,
  listAccounts: (ownerEmail: string) => Promise<Array<{ status: string; mailboxAddress: string }>>,
  enrollments: SequenceEnrollment[]
): Promise<Record<string, { connected: boolean; status: 'CONECTADA' | 'RECONECTAR' | 'NAO_CONECTADA' | 'RECURSO_DESLIGADO'; mailboxAddress: string | null }>> {
  void repo;
  void mailer;
  const out: Record<string, { connected: boolean; status: 'CONECTADA' | 'RECONECTAR' | 'NAO_CONECTADA' | 'RECURSO_DESLIGADO'; mailboxAddress: string | null }> = {};
  const owners = [...new Set(enrollments.map((e) => String(e.senderOwnerEmail || '').toLowerCase()).filter(Boolean))].slice(0, 50);
  const enabled = isMailboxFeatureEnabled();
  for (const o of owners) {
    if (!enabled) {
      out[o] = { connected: false, status: 'RECURSO_DESLIGADO', mailboxAddress: null };
      continue;
    }
    try {
      const accs = await listAccounts(o);
      const active = accs.find((a) => a.status === 'ATIVADO');
      out[o] = active
        ? { connected: true, status: 'CONECTADA', mailboxAddress: active.mailboxAddress }
        : { connected: false, status: accs.length ? 'RECONECTAR' : 'NAO_CONECTADA', mailboxAddress: null };
    } catch {
      out[o] = { connected: false, status: 'NAO_CONECTADA', mailboxAddress: null };
    }
  }
  return out;
}
