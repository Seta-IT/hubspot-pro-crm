// ============================================================================
// STI-hub — Fase 3: envio REAL de campanhas de marketing via ESP (fila com limite de taxa).
//
// Garantias por e-mail (todas obrigatorias, fail-closed):
//   - MARKETING_LIVE_SEND ligado; sem ele o /api/marketing/campaigns/dispatch segue simulando.
//   - configuracao completa (provedor, remetente, endereco fisico, segredo do descadastro, chave de rastreio);
//   - dominio remetente com SPF + DKIM + DMARC (DNS) aprovados;
//   - modelo APROVADO (versao aprovada congelada no enfileiramento);
//   - LGPD: fora da supressao, consentimento ativo e a FINALIDADE da campanha nas categorias do contato;
//   - allowlist MARKETING_TEST_RECIPIENTS (homologacao) quando definida;
//   - List-Unsubscribe + List-Unsubscribe-Post (one-click) com token assinado, link visivel e endereco
//     fisico no rodape; rastreio de abertura e clique;
//   - idempotencia por (campanha, contato) na fila + chave de idempotencia no ESP + reserva global
//     (mktsend:<campanha>:<contato>) antes do envio; trava global do cron (marketing:run).
// Sem rotacao de conta/dominio/provedor: limite ou erro do provedor => a fila espera.
// ============================================================================
import type { CrmRepository } from '../../db/repository';
import type { Contact } from '../../db/types';
import { getDefaultLockStore, newLockOwnerId, type DistributedLockStore } from '../../db/distributed-lock';
import { buildTrackedEmailBody, newTrackingId, publicOrigin, trackingSignature, escapeHtml } from '../email/mail-tracking';
import { newMailboxId, type CrmEmailMessage, type MailboxStore } from '../email/mailbox-store';
import {
  MARKETING_PURPOSE_LABELS,
  isMarketingLiveSendEnabled,
  marketingConfigProblems,
  resolveMarketingSenderConfig,
  resolveMarketingTestRecipients,
  type MarketingPurpose,
  type MarketingSenderConfig,
} from './marketing-config';
import { checkDomainAuthCached, type DomainAuthResult, type TxtResolver } from './domain-auth';
import { EspSendError, resolveEspAdapter, type EspAdapter, type EspMessage, type EspResolveDeps } from './esp-adapters';
import type { MarketingEvent, MarketingSend, MarketingStore, MarketingTemplateVersion } from './marketing-store';
import { renderBlocksHtml, renderBlocksText, type TemplateVars } from './template-blocks';
import { getSendableVersion, TemplateWorkflowError } from './template-service';
import { buildUnsubscribeUrl, resolveUnsubscribeSecret, signUnsubscribeToken, type UnsubscribeClaims } from './unsubscribe-token';
import type { NormalizedEspEvent } from './resend-webhook';

export const MARKETING_CRON_PATH = '/api/cron/marketing';
export const MARKETING_RUN_LOCK_KEY = 'marketing:run';
export const MARKETING_RUN_LOCK_TTL_MS = 10 * 60 * 1000;
export const MARKETING_SEND_CLAIM_TTL_MS = 45 * 24 * 60 * 60 * 1000;
export const MARKETING_SEND_CLAIM_STALE_MS = 60 * 60 * 1000;
export const MARKETING_MAX_ATTEMPTS = 3;
export const MARKETING_RUN_BUDGET_MS = 240 * 1000;

export function marketingSendClaimKey(campaignId: string, contactId: string, generation = 0): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9:._@-]/g, '_').slice(0, 90);
  return `mktsend:${safe(campaignId)}:${safe(contactId)}${generation > 0 ? `:g${generation}` : ''}`;
}

export const MARKETING_REVIEW_QUEUE = 'Campanhas de Marketing';

/**
 * Envio interrompido (pode ter saido ou nao): vira NEEDS_REVIEW com tarefa para o dono da campanha.
 * Nunca reenvia sozinho; a pessoa decide (marcar como enviado, liberar reenvio ou descartar).
 */
async function markNeedsReview(repo: CrmRepository, deps: MarketingDeps, send: MarketingSend, reason: string, nowIso: string): Promise<void> {
  const campaign = repo.getMarketingCampaignById(send.campaignId);
  const contact = repo.getContactById(send.contactId);
  let taskId: string | null = send.reviewTaskId || null;
  if (!taskId) {
    try {
      taskId = repo.createTask({
        title: `Conferir envio da campanha "${campaign?.name || send.campaignId}" para ${send.email}`,
        notes:
          'O envio foi interrompido no meio e pode ou não ter saído. Confira no painel do provedor (ESP) e decida em ' +
          'E-mail Marketing > Funil de entregabilidade > Envios para revisar: marcar como enviado, liberar reenvio ou descartar. ' +
          'O sistema não reenvia automaticamente.',
        type: 'TODO',
        priority: 'HIGH',
        status: 'NOT_STARTED',
        queueName: MARKETING_REVIEW_QUEUE,
        dueDate: nowIso.slice(0, 10),
        dueTime: '10:00',
        assignedTo: campaign?.ownerName || contact?.ownerName || 'Marcelo Lopes Mira',
        contactId: contact?.id ?? null,
        companyId: contact?.companyId ?? null,
      }).id;
    } catch {
      taskId = null;
    }
  }
  await deps.store.updateSend(send.campaignId, send.contactId, { status: 'NEEDS_REVIEW', reason, reviewTaskId: taskId, updatedAt: nowIso });
}

export type ReviewDecision = 'MARK_SENT' | 'REQUEUE' | 'DISCARD';

/** Decisao humana sobre um envio em revisao. REQUEUE usa nova geracao da reserva (a antiga fica). */
export async function resolveReviewSend(
  repo: CrmRepository,
  deps: MarketingDeps,
  input: { campaignId: string; contactId: string; decision: ReviewDecision; actor: string }
): Promise<{ ok: boolean; error?: string; status?: MarketingSend['status'] }> {
  const send = await deps.store.getSend(input.campaignId, input.contactId);
  if (!send) return { ok: false, error: 'Envio não encontrado.' };
  if (send.status !== 'NEEDS_REVIEW') return { ok: false, error: 'Este envio não está em revisão.' };
  const iso = (deps.now || (() => new Date()))().toISOString();
  const base = { reviewedBy: input.actor, reviewedAt: iso, updatedAt: iso };
  let status: MarketingSend['status'];
  if (input.decision === 'MARK_SENT') {
    status = 'SENT';
    await deps.store.updateSend(send.campaignId, send.contactId, { ...base, status, reason: 'CONFIRMADO_MANUALMENTE', sentAt: send.sentAt || send.updatedAt });
    const campaign = repo.getMarketingCampaignById(send.campaignId);
    if (campaign) repo.updateMarketingCampaign(campaign.id, { sentCount: (campaign.sentCount || 0) + 1 });
  } else if (input.decision === 'REQUEUE') {
    status = 'QUEUED';
    await deps.store.updateSend(send.campaignId, send.contactId, {
      ...base,
      status,
      reason: 'REENVIO_LIBERADO',
      nextAttemptAt: iso,
      claimGeneration: (send.claimGeneration || 0) + 1,
    });
  } else {
    status = 'FAILED';
    await deps.store.updateSend(send.campaignId, send.contactId, { ...base, status, reason: 'DESCARTADO_NA_REVISAO' });
  }
  if (send.reviewTaskId) {
    try {
      repo.updateTask(send.reviewTaskId, { status: 'COMPLETED' });
    } catch {
      // tarefa pode ter sido removida
    }
  }
  return { ok: true, status };
}

export interface MarketingDeps {
  store: MarketingStore;
  mailbox: MailboxStore;
  env?: NodeJS.ProcessEnv;
  esp: EspResolveDeps;
  lock?: DistributedLockStore;
  resolver?: TxtResolver;
  now?: () => Date;
  lockClock?: () => number;
  /** Espera entre envios (ritmo da fila). Testes: no-op. */
  sleep?: (ms: number) => Promise<void>;
  /** Rele o estado do Postgres depois de obter a trava (consentimento/supressao atualizados). */
  reloadState?: () => Promise<void>;
  origin?: string;
}

export interface MarketingPreflight {
  liveEnabled: boolean;
  ready: boolean;
  problems: string[];
  config: MarketingSenderConfig;
  domain: DomainAuthResult | null;
  allowlistActive: boolean;
  trackingEnabled: boolean;
}

/** Nunca devolve chaves; so nomes de variaveis e o diagnostico do dominio. */
export async function marketingPreflight(deps: MarketingDeps, opts: { forceDns?: boolean; requireLiveFlag?: boolean } = {}): Promise<MarketingPreflight> {
  const env = deps.env || process.env;
  const config = resolveMarketingSenderConfig(env);
  const liveEnabled = isMarketingLiveSendEnabled(env);
  const problems = [...marketingConfigProblems(config, env)];
  if (opts.requireLiveFlag !== false && !liveEnabled) problems.unshift('MARKETING_LIVE_SEND desligado (modo simulação).');
  const adapter = resolveEspAdapter(config.provider, env, deps.esp);
  if (config.provider && adapter.problem) problems.push(adapter.problem);
  const trackingEnabled = Boolean(trackingSignature('preflight-probe-0000'));
  if (!trackingEnabled) problems.push('Rastreio de abertura/clique indisponível (STI_HUB_MAILBOX_ENC_KEY).');
  let domain: DomainAuthResult | null = null;
  if (config.fromDomain) {
    domain = await checkDomainAuthCached(config.fromDomain, {
      dkimSelectors: config.dkimSelectors,
      spfHost: config.spfHost,
      resolver: deps.resolver,
      force: opts.forceDns,
    });
    if (!domain.pass) {
      const miss = [!domain.spf.ok && 'SPF', !domain.dkim.ok && 'DKIM', !domain.dmarc.ok && 'DMARC'].filter(Boolean).join(', ');
      problems.push(`Domínio ${config.fromDomain} não passou na verificação (${miss}).`);
    }
  }
  return {
    liveEnabled,
    ready: problems.length === 0,
    problems,
    config,
    domain,
    allowlistActive: resolveMarketingTestRecipients(env) !== null,
    trackingEnabled,
  };
}

// ----------------------------------------------------------------------------
// Elegibilidade (LGPD por finalidade)
// ----------------------------------------------------------------------------
export function checkMarketingEligibility(
  repo: CrmRepository,
  contact: Contact,
  purpose: MarketingPurpose,
  allowlist: Set<string> | null
): { allowed: true } | { allowed: false; reason: string } {
  const base = repo.canSendMarketingEmailToContact(contact.id);
  if (!base.allowed) return { allowed: false, reason: base.reason };
  if (contact.lgpdConsent !== true) return { allowed: false, reason: 'Sem consentimento LGPD registrado.' };
  if (!(contact.communicationCategories || []).includes(purpose)) {
    return { allowed: false, reason: `Sem consentimento para a finalidade ${MARKETING_PURPOSE_LABELS[purpose]}.` };
  }
  if (allowlist && !allowlist.has(String(contact.email || '').trim().toLowerCase())) {
    return { allowed: false, reason: 'Fora da allowlist de homologação (MARKETING_TEST_RECIPIENTS).' };
  }
  return { allowed: true };
}

// ----------------------------------------------------------------------------
// Composicao do e-mail
// ----------------------------------------------------------------------------
export interface ComposedMarketingEmail {
  message: EspMessage;
  trackingId: string;
  links: string[];
  unsubscribeUrl: string;
}

export function composeMarketingEmail(input: {
  config: MarketingSenderConfig;
  version: MarketingTemplateVersion;
  purpose: MarketingPurpose;
  campaignId: string;
  contactId: string;
  to: string;
  vars: TemplateVars;
  unsubscribeSecret: string;
  origin: string;
  idempotencyKey: string;
  subjectPrefix?: string;
}): ComposedMarketingEmail {
  const { config, version } = input;
  const trackingId = newTrackingId();
  const claims: UnsubscribeClaims = { contactId: input.contactId, campaignId: input.campaignId, purpose: input.purpose };
  const unsubscribeUrl = buildUnsubscribeUrl(input.origin, signUnsubscribeToken(claims, input.unsubscribeSecret));
  const built = buildTrackedEmailBody({
    body: renderBlocksHtml(version.blocks, input.vars),
    bodyFormat: 'html',
    trackingId,
    origin: input.origin,
  });
  const purposeLabel = MARKETING_PURPOSE_LABELS[input.purpose];
  const address = config.postalAddress || '';
  const preheader = version.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(version.preheader)}</div>`
    : '';
  // Link de descadastro DIRETO (sem redirecionamento de rastreio) e endereco fisico no rodape.
  const footerHtml =
    `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;font-family:Segoe UI,Arial,sans-serif;font-size:12px;line-height:1.5;color:#64748b">` +
    `Você recebe este e-mail porque autorizou comunicações de ${escapeHtml(purposeLabel)} da ${escapeHtml(config.fromName)}. ` +
    `<a href="${escapeHtml(unsubscribeUrl)}" style="color:#334155">Descadastrar-se</a>.<br>` +
    `${escapeHtml(config.fromName)} - ${escapeHtml(address)}</div>`;
  const footerText = `Você recebe este e-mail porque autorizou comunicações de ${purposeLabel} da ${config.fromName}.\nDescadastrar-se: ${unsubscribeUrl}\n${config.fromName} - ${address}`;
  const fromName = config.fromName.replace(/["<>\r\n]/g, '');
  const subject = `${input.subjectPrefix || ''}${version.subject}`.replace(/[\r\n]+/g, ' ');
  const message: EspMessage = {
    from: `${fromName} <${config.fromEmail}>`,
    to: input.to,
    subject: subject.replace(/\{\{\s*(firstName|lastName|companyName)\s*\}\}/g, (_, k: keyof TemplateVars) => String(input.vars[k] || '')),
    html: `${preheader}${built.html}${footerHtml}`,
    text: `${renderBlocksText(version.blocks, input.vars)}\n\n--\n${footerText}`,
    replyTo: config.replyTo,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    idempotencyKey: input.idempotencyKey,
    tags: { campaign_id: input.campaignId, contact_id: input.contactId, purpose: input.purpose },
  };
  return { message, trackingId, links: built.links, unsubscribeUrl };
}

function contactVars(repo: CrmRepository, c: Contact): TemplateVars {
  const company = c.companyId ? repo.getCompanyById(c.companyId) : undefined;
  return { firstName: c.firstName || '', lastName: c.lastName || '', companyName: (company as { name?: string } | undefined)?.name || '' };
}

// ----------------------------------------------------------------------------
// Enfileirar
// ----------------------------------------------------------------------------
export interface EnqueueResult {
  campaignId: string;
  templateId: string;
  templateVersion: number;
  purpose: MarketingPurpose;
  queuedCount: number;
  alreadyQueuedCount: number;
  blockedCount: number;
  blockedContacts: Array<{ id: string; email: string; reason: string }>;
}

export async function enqueueCampaign(
  repo: CrmRepository,
  deps: MarketingDeps,
  input: { campaignId: string; templateId: string; contacts: Contact[] }
): Promise<EnqueueResult> {
  const env = deps.env || process.env;
  const now = (deps.now || (() => new Date()))();
  const { template, version } = await getSendableVersion(deps.store, input.templateId);
  const campaign = repo.getMarketingCampaignById(input.campaignId);
  if (!campaign) throw new TemplateWorkflowError('Campanha não encontrada.', 404);
  const allowlist = resolveMarketingTestRecipients(env);
  const rows: MarketingSend[] = [];
  const blocked: EnqueueResult['blockedContacts'] = [];
  for (const c of input.contacts) {
    const elig = checkMarketingEligibility(repo, c, template.purpose, allowlist);
    if (!elig.allowed) {
      blocked.push({ id: c.id, email: c.email, reason: elig.reason });
      continue;
    }
    rows.push({
      campaignId: campaign.id,
      contactId: c.id,
      email: c.email.trim().toLowerCase(),
      templateId: template.id,
      templateVersion: version.version,
      purpose: template.purpose,
      status: 'QUEUED',
      reason: null,
      attempts: 0,
      provider: null,
      providerMessageId: null,
      trackingId: null,
      queuedAt: now.toISOString(),
      nextAttemptAt: now.toISOString(),
      sentAt: null,
      deliveredAt: null,
      bouncedAt: null,
      complainedAt: null,
      unsubscribedAt: null,
      updatedAt: now.toISOString(),
    });
  }
  const r = await deps.store.enqueueSends(rows);
  return {
    campaignId: campaign.id,
    templateId: template.id,
    templateVersion: version.version,
    purpose: template.purpose,
    queuedCount: r.inserted,
    alreadyQueuedCount: r.existing,
    blockedCount: blocked.length,
    blockedContacts: blocked,
  };
}

// ----------------------------------------------------------------------------
// Processar a fila (cron /api/cron/marketing ou acao do administrador)
// ----------------------------------------------------------------------------
export type MarketingRunSkip =
  | 'LIVE_SEND_DISABLED'
  | 'NOT_READY'
  | 'RUN_LOCK_UNAVAILABLE'
  | 'RUN_LOCKED_ELSEWHERE'
  | 'STATE_RELOAD_FAILED';

export interface MarketingRunResult {
  mode: 'LIVE' | 'SIMULATION';
  skipped: MarketingRunSkip | null;
  problems: string[];
  examined: number;
  sent: number;
  skippedContacts: number;
  failed: number;
  requeued: number;
  needsReview: number;
  stoppedReason: string | null;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function processMarketingQueue(repo: CrmRepository, deps: MarketingDeps, opts: { maxSends?: number } = {}): Promise<MarketingRunResult> {
  const result: MarketingRunResult = { mode: 'SIMULATION', skipped: null, problems: [], examined: 0, sent: 0, skippedContacts: 0, failed: 0, requeued: 0, needsReview: 0, stoppedReason: null };
  const env = deps.env || process.env;
  if (!isMarketingLiveSendEnabled(env)) {
    result.skipped = 'LIVE_SEND_DISABLED';
    return result;
  }
  result.mode = 'LIVE';
  const pre = await marketingPreflight(deps);
  if (!pre.ready) {
    result.skipped = 'NOT_READY';
    result.problems = pre.problems;
    return result;
  }
  const lock = deps.lock || getDefaultLockStore();
  const owner = newLockOwnerId('mkt');
  let got = false;
  try {
    got = await lock.acquire(MARKETING_RUN_LOCK_KEY, owner, MARKETING_RUN_LOCK_TTL_MS);
  } catch {
    result.skipped = 'RUN_LOCK_UNAVAILABLE';
    return result;
  }
  if (!got) {
    result.skipped = 'RUN_LOCKED_ELSEWHERE';
    return result;
  }
  try {
    if (deps.reloadState) {
      try {
        await deps.reloadState();
      } catch {
        result.skipped = 'STATE_RELOAD_FAILED';
        return result;
      }
    }
    await runQueue(repo, deps, pre.config, lock, owner, result, opts);
    return result;
  } finally {
    await lock.release(MARKETING_RUN_LOCK_KEY, owner).catch(() => undefined);
  }
}

async function runQueue(
  repo: CrmRepository,
  deps: MarketingDeps,
  config: MarketingSenderConfig,
  lock: DistributedLockStore,
  owner: string,
  result: MarketingRunResult,
  opts: { maxSends?: number }
): Promise<void> {
  const env = deps.env || process.env;
  const nowFn = deps.now || (() => new Date());
  const lockClock = deps.lockClock || (() => Date.now());
  const sleep = deps.sleep || realSleep;
  const started = Date.now();
  const resolved = resolveEspAdapter(config.provider, env, deps.esp);
  if (!resolved.adapter) {
    result.stoppedReason = 'ESP_NOT_CONFIGURED';
    return;
  }
  const adapter: EspAdapter = resolved.adapter;
  const secret = resolveUnsubscribeSecret(env)!;
  const origin = deps.origin || publicOrigin();
  const allowlist = resolveMarketingTestRecipients(env);
  const maxSends = Math.min(opts.maxSends || config.maxPerRun, config.maxPerRun);
  const spacingMs = Math.ceil(60000 / config.maxPerMinute);
  const versions = new Map<string, MarketingTemplateVersion | null>();

  // Envios presos em SENDING ha mais de 1h (execucao caiu no meio): revisao humana, nunca reenvio.
  const staleBefore = new Date(nowFn().getTime() - MARKETING_SEND_CLAIM_STALE_MS).toISOString();
  for (const stuck of await deps.store.listStaleSending(staleBefore, 200)) {
    await markNeedsReview(repo, deps, stuck, 'SEND_INTERRUPTED', nowFn().toISOString());
    result.needsReview++;
  }

  const due = await deps.store.listDueSends(nowFn().toISOString(), maxSends);
  for (const queued of due) {
    if (result.sent >= maxSends) break;
    if (Date.now() - started > MARKETING_RUN_BUDGET_MS) {
      result.stoppedReason = 'RUN_TIME_BUDGET';
      break;
    }
    // Limite de taxa global (todas as instancias): envios do ultimo minuto.
    const nowIso = nowFn().toISOString();
    const lastMinute = await deps.store.countSentSince(new Date(nowFn().getTime() - 60000).toISOString());
    if (lastMinute >= config.maxPerMinute) {
      result.stoppedReason = 'RATE_LIMIT';
      break;
    }
    result.examined++;
    const send = await deps.store.getSend(queued.campaignId, queued.contactId);
    if (!send || send.status !== 'QUEUED') continue;

    const skip = async (reason: string) => {
      await deps.store.updateSend(send.campaignId, send.contactId, { status: 'SKIPPED', reason, updatedAt: nowIso });
      result.skippedContacts++;
    };
    const contact = repo.getContactById(send.contactId);
    const campaign = repo.getMarketingCampaignById(send.campaignId);
    if (!contact || !campaign) {
      await skip(!contact ? 'Contato removido.' : 'Campanha removida.');
      continue;
    }
    if (contact.email.trim().toLowerCase() !== send.email) {
      await skip('E-mail do contato mudou desde o enfileiramento.');
      continue;
    }
    const elig = checkMarketingEligibility(repo, contact, send.purpose, allowlist);
    if (!elig.allowed) {
      await skip(elig.reason);
      continue;
    }
    const vKey = `${send.templateId}#${send.templateVersion}`;
    if (!versions.has(vKey)) versions.set(vKey, await deps.store.getVersion(send.templateId, send.templateVersion));
    const version = versions.get(vKey);
    if (!version) {
      await skip('Versão do modelo não encontrada.');
      continue;
    }

    // Reserva global por (campanha, contato) ANTES do envio.
    const claimKey = marketingSendClaimKey(send.campaignId, send.contactId, send.claimGeneration || 0);
    let claimed = false;
    try {
      claimed = await lock.acquire(claimKey, owner, MARKETING_SEND_CLAIM_TTL_MS);
    } catch {
      result.stoppedReason = 'CLAIM_UNAVAILABLE';
      break;
    }
    if (!claimed) {
      const info = await lock.peek(claimKey).catch(() => null);
      if (info && lockClock() - info.acquiredAt > MARKETING_SEND_CLAIM_STALE_MS) {
        // Reservado ha mais de 1h sem confirmacao: pode ter saido. Revisao humana, nunca reenvia.
        await markNeedsReview(repo, deps, send, 'SEND_UNCERTAIN', nowIso);
        result.needsReview++;
      }
      continue;
    }

    const composed = composeMarketingEmail({
      config,
      version,
      purpose: send.purpose,
      campaignId: send.campaignId,
      contactId: send.contactId,
      to: send.email,
      vars: contactVars(repo, contact),
      unsubscribeSecret: secret,
      origin,
      idempotencyKey: `mkt-${send.campaignId}-${send.contactId}`.slice(0, 250),
    });
    await deps.store.updateSend(send.campaignId, send.contactId, { status: 'SENDING', attempts: send.attempts + 1, trackingId: composed.trackingId, updatedAt: nowIso });
    try {
      const sent = await adapter.send(composed.message);
      const sentIso = nowFn().toISOString();
      await deps.store.updateSend(send.campaignId, send.contactId, {
        status: 'SENT',
        reason: null,
        provider: sent.provider,
        providerMessageId: sent.providerMessageId,
        sentAt: sentIso,
        updatedAt: sentIso,
      });
      const rec: CrmEmailMessage = {
        id: newMailboxId('eml'),
        accountId: null,
        ownerEmail: null,
        externalId: `mkt:${send.campaignId}:${send.contactId}`,
        conversationId: null,
        internetMessageId: null,
        direction: 'ENVIADO',
        source: 'STI_HUB',
        fromAddress: config.fromEmail || '',
        fromName: config.fromName,
        to: [send.email],
        cc: [],
        subject: composed.message.subject,
        bodyPreview: composed.message.text.replace(/\s+/g, ' ').trim().slice(0, 500),
        occurredAt: sentIso,
        contactId: contact.id,
        companyId: contact.companyId || null,
        dealId: null,
        trackingId: composed.trackingId,
        links: composed.links,
        openCount: 0,
        clickCount: 0,
        lastOpenedAt: null,
        lastClickedAt: null,
        createdAt: sentIso,
      };
      await deps.mailbox.insertMessage(rec).catch(() => false);
      repo.updateMarketingCampaign(campaign.id, { sentCount: (campaign.sentCount || 0) + 1 });
      result.sent++;
    } catch (err) {
      const e = err instanceof EspSendError ? err : new EspSendError('ESP_ERROR', 0, true);
      const failIso = nowFn().toISOString();
      const authProblem = e.status === 401 || e.status === 403;
      const attempts = send.attempts + 1;
      if (authProblem || (e.retryable && attempts < MARKETING_MAX_ATTEMPTS)) {
        const backoffMs = authProblem ? 15 * 60000 : 5 * 60000 * attempts;
        await deps.store.updateSend(send.campaignId, send.contactId, {
          status: 'QUEUED',
          reason: e.code,
          nextAttemptAt: new Date(nowFn().getTime() + backoffMs).toISOString(),
          updatedAt: failIso,
        });
        await lock.release(claimKey, owner).catch(() => undefined);
        result.requeued++;
        if (authProblem || e.status === 429) {
          result.stoppedReason = authProblem ? 'ESP_AUTH' : 'ESP_RATE_LIMIT';
          break;
        }
      } else {
        // Erro permanente: mantem a reserva (nao reenvia sozinho).
        await deps.store.updateSend(send.campaignId, send.contactId, { status: 'FAILED', reason: e.code, updatedAt: failIso });
        result.failed++;
      }
      continue;
    }
    if (spacingMs > 0) await sleep(spacingMs);
  }
}

// ----------------------------------------------------------------------------
// Envio de teste (modelo em qualquer status) para endereco da allowlist
// ----------------------------------------------------------------------------
export async function sendMarketingTest(
  deps: MarketingDeps,
  input: { templateId: string; version?: number; to: string; actor: string }
): Promise<{ ok: true; provider: string; providerMessageId: string | null } | { ok: false; status: number; problems: string[] }> {
  const env = deps.env || process.env;
  const to = String(input.to || '').trim().toLowerCase();
  const allowlist = resolveMarketingTestRecipients(env);
  if (!allowlist || allowlist.size === 0) return { ok: false, status: 409, problems: ['Defina MARKETING_TEST_RECIPIENTS para enviar testes.'] };
  if (!allowlist.has(to)) return { ok: false, status: 403, problems: ['Destinatário fora da allowlist de testes (MARKETING_TEST_RECIPIENTS).'] };
  const pre = await marketingPreflight(deps, { requireLiveFlag: false });
  if (!pre.ready) return { ok: false, status: 409, problems: pre.problems };
  const t = await deps.store.getTemplate(input.templateId);
  if (!t) return { ok: false, status: 404, problems: ['Modelo não encontrado.'] };
  const version = await deps.store.getVersion(t.id, input.version || t.currentVersion);
  if (!version) return { ok: false, status: 404, problems: ['Versão não encontrada.'] };
  const resolved = resolveEspAdapter(pre.config.provider, env, deps.esp);
  if (!resolved.adapter) return { ok: false, status: 409, problems: [resolved.problem] };
  const minute = Math.floor((deps.now || (() => new Date()))().getTime() / 60000);
  const composed = composeMarketingEmail({
    config: pre.config,
    version,
    purpose: t.purpose,
    campaignId: 'teste',
    contactId: `teste-${to.replace(/[^a-z0-9]/g, '_').slice(0, 60)}`,
    to,
    vars: { firstName: 'Teste', lastName: '', companyName: 'Empresa Teste' },
    unsubscribeSecret: resolveUnsubscribeSecret(env)!,
    origin: deps.origin || publicOrigin(),
    idempotencyKey: `mkt-test-${t.id}-${version.version}-${minute}-${to}`.slice(0, 250),
    subjectPrefix: '[TESTE] ',
  });
  composed.message.tags = { campaign_id: 'teste', template_id: t.id };
  try {
    const r = await resolved.adapter.send(composed.message);
    return { ok: true, provider: r.provider, providerMessageId: r.providerMessageId };
  } catch (err) {
    const code = err instanceof EspSendError ? err.code : 'ESP_ERROR';
    return { ok: false, status: 502, problems: [`Falha no provedor (${code}).`] };
  }
}

// ----------------------------------------------------------------------------
// Eventos do ESP (webhook) => funil e supressao
// ----------------------------------------------------------------------------
export async function applyEspEvent(
  repo: CrmRepository,
  deps: MarketingDeps,
  ev: NormalizedEspEvent
): Promise<{ duplicate: boolean; matched: boolean; suppressed: boolean; contactId: string | null; campaignId: string | null }> {
  const store = deps.store;
  let send: MarketingSend | null = null;
  if (ev.providerMessageId) send = await store.findSendByProviderMessageId(ev.providerMessageId);
  if (!send && ev.campaignId && ev.contactId) send = await store.getSend(ev.campaignId, ev.contactId);
  const iso = ev.at;
  const campaign = send ? repo.getMarketingCampaignById(send.campaignId) : undefined;
  let suppressed = false;
  // Supressao e idempotente e SEMPRE aplicada (mesmo em reentrega), inclusive sem envio associado.
  const target = send ? { contactId: send.contactId } : ev.recipient ? { email: ev.recipient } : null;
  if (ev.type === 'BOUNCED_HARD' && target) {
    repo.updateContactSubscriptionPreference({ ...target, action: 'RECORD_HARD_BOUNCE', reason: `Hard bounce (ESP)${ev.detail ? `: ${ev.detail}` : ''}` });
    suppressed = true;
  }
  if (ev.type === 'COMPLAINED' && target) {
    repo.updateContactSubscriptionPreference({ ...target, action: 'RECORD_SPAM_COMPLAINT', reason: 'Reclamação de spam (feedback loop do ESP)' });
    suppressed = true;
  }
  if (send) {
    if (ev.type === 'DELIVERED' && !send.deliveredAt) {
      await store.updateSend(send.campaignId, send.contactId, { status: send.status === 'SENT' ? 'DELIVERED' : send.status, deliveredAt: iso, updatedAt: iso });
      if (campaign) repo.updateMarketingCampaign(campaign.id, { deliveredCount: (campaign.deliveredCount || 0) + 1 });
    } else if (ev.type === 'BOUNCED_HARD' && !send.bouncedAt) {
      await store.updateSend(send.campaignId, send.contactId, { status: 'BOUNCED', bouncedAt: iso, reason: ev.detail || 'HARD_BOUNCE', updatedAt: iso });
      if (campaign) repo.updateMarketingCampaign(campaign.id, { bouncesCount: (campaign.bouncesCount || 0) + 1 });
    } else if (ev.type === 'COMPLAINED' && !send.complainedAt) {
      await store.updateSend(send.campaignId, send.contactId, { status: 'COMPLAINED', complainedAt: iso, updatedAt: iso });
    }
  }
  const record: MarketingEvent = {
    id: `mev-${ev.providerEventId}`.slice(0, 200),
    providerEventId: ev.providerEventId,
    campaignId: send?.campaignId || null,
    contactId: send?.contactId || null,
    type: ev.type,
    at: iso,
    detail: ev.detail,
  };
  const fresh = await store.recordEvent(record);
  return { duplicate: !fresh, matched: Boolean(send), suppressed, contactId: send?.contactId || null, campaignId: send?.campaignId || null };
}

// ----------------------------------------------------------------------------
// Descadastro (link do rodape / List-Unsubscribe one-click)
// ----------------------------------------------------------------------------
export async function applyUnsubscribe(
  repo: CrmRepository,
  deps: MarketingDeps,
  claims: UnsubscribeClaims,
  scope: 'PURPOSE' | 'ALL_MARKETING'
): Promise<{ ok: boolean; purposeLabel: string }> {
  const contact = repo.getContactById(claims.contactId);
  const purposeLabel = MARKETING_PURPOSE_LABELS[claims.purpose];
  if (!contact) return { ok: false, purposeLabel };
  if (scope === 'ALL_MARKETING') {
    repo.updateContactSubscriptionPreference({ contactId: contact.id, action: 'UNSUBSCRIBE_MARKETING', reason: 'Descadastro de todo o marketing (link do e-mail)' });
  } else {
    repo.updateContactSubscriptionPreference({ contactId: contact.id, action: 'UNSUBSCRIBE_PURPOSE', categories: [claims.purpose], reason: 'Descadastro one-click (List-Unsubscribe / link do e-mail)' });
  }
  const iso = (deps.now || (() => new Date()))().toISOString();
  const send = await deps.store.getSend(claims.campaignId, claims.contactId);
  if (send && !send.unsubscribedAt) {
    await deps.store.updateSend(send.campaignId, send.contactId, { unsubscribedAt: iso, updatedAt: iso });
    const campaign = repo.getMarketingCampaignById(send.campaignId);
    if (campaign) repo.updateMarketingCampaign(campaign.id, { unsubscribesCount: (campaign.unsubscribesCount || 0) + 1 });
  }
  await deps.store.recordEvent({
    id: `mev-unsub-${claims.campaignId}-${claims.contactId}-${scope}`.slice(0, 200),
    providerEventId: `unsub:${claims.campaignId}:${claims.contactId}:${scope}`,
    campaignId: send ? claims.campaignId : null,
    contactId: claims.contactId,
    type: 'UNSUBSCRIBED',
    at: iso,
    detail: scope,
  });
  return { ok: true, purposeLabel };
}

// ----------------------------------------------------------------------------
// Funil de entregabilidade por campanha
// ----------------------------------------------------------------------------
export interface CampaignFunnel {
  campaignId: string;
  queued: number;
  sent: number;
  delivered: number;
  bounces: number;
  complaints: number;
  opens: number;
  clicks: number;
  unsubscribes: number;
  skipped: number;
  failed: number;
  needsReview: number;
  reviewItems: Array<{ contactId: string; email: string; reason: string | null; updatedAt: string; reviewTaskId: string | null }>;
  rates: { delivery: number; bounce: number; complaint: number; open: number; click: number; unsubscribe: number };
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

export async function campaignFunnel(deps: MarketingDeps, campaignId: string): Promise<CampaignFunnel> {
  const sends = await deps.store.listSendsByCampaign(campaignId);
  const events = await deps.store.listEvents(campaignId);
  const ids = sends.map((s) => s.trackingId).filter((x): x is string => Boolean(x)).slice(0, 5000);
  const stats = ids.length ? await deps.mailbox.trackingStats(ids) : [];
  const byTracking = new Map(stats.map((s) => [s.trackingId, s]));
  const openers = new Set<string>();
  const clickers = new Set<string>();
  for (const s of sends) {
    const st = s.trackingId ? byTracking.get(s.trackingId) : undefined;
    if (st && st.openCount > 0) openers.add(s.contactId);
    if (st && st.clickCount > 0) {
      clickers.add(s.contactId);
      openers.add(s.contactId); // clique implica abertura
    }
  }
  for (const e of events) {
    if (!e.contactId) continue;
    if (e.type === 'OPENED') openers.add(e.contactId);
    if (e.type === 'CLICKED') {
      clickers.add(e.contactId);
      openers.add(e.contactId);
    }
  }
  const sent = sends.filter((s) => s.sentAt).length;
  const delivered = sends.filter((s) => s.deliveredAt).length;
  const bounces = sends.filter((s) => s.bouncedAt).length;
  const complaints = sends.filter((s) => s.complainedAt).length;
  const unsubscribes = sends.filter((s) => s.unsubscribedAt).length;
  const base = delivered || sent;
  return {
    campaignId,
    queued: sends.filter((s) => s.status === 'QUEUED' || s.status === 'SENDING').length,
    sent,
    delivered,
    bounces,
    complaints,
    opens: openers.size,
    clicks: clickers.size,
    unsubscribes,
    skipped: sends.filter((s) => s.status === 'SKIPPED').length,
    failed: sends.filter((s) => s.status === 'FAILED').length,
    needsReview: sends.filter((s) => s.status === 'NEEDS_REVIEW').length,
    reviewItems: sends
      .filter((s) => s.status === 'NEEDS_REVIEW')
      .slice(0, 200)
      .map((s) => ({ contactId: s.contactId, email: s.email, reason: s.reason, updatedAt: s.updatedAt, reviewTaskId: s.reviewTaskId || null })),
    rates: {
      delivery: pct(delivered, sent),
      bounce: pct(bounces, sent),
      complaint: pct(complaints, base),
      open: pct(openers.size, base),
      click: pct(clickers.size, base),
      unsubscribe: pct(unsubscribes, base),
    },
  };
}
