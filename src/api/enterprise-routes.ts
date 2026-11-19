// ============================================================================
// STI-hub — Fase 6: rotas dos recursos avancados de marketing.
//   Testes A/B e multivariados     /api/marketing/experiments[...]
//   Otimizacao de horario          /api/marketing/send-time/...
//   Agendamento (cancelar)         /api/marketing/campaigns/:id/cancel-scheduled
//   IA comercial e de marketing    /api/marketing/ai/...      (AI_MARKETING_ENABLED)
//   Central de preferencias        /api/marketing/preferences-state|preferences-apply (so contexto interno)
// Alcada: criar/iniciar/decidir teste, cancelar agendamento e ligar otimizacao na cadencia =
// admin ou controle total do CRM com 2FA. Leitura e IA: sessao com 2FA + CRM, no escopo do usuario.
// ============================================================================
import type { CrmRepository } from '../db/repository';
import type { Contact } from '../db/types';
import { SlidingWindowRateLimiter } from './password-reset';
import { resolveActor, type Actor } from './analytics-routes';
import { marketingPreflight, applyUnsubscribe, type MarketingDeps } from '../modules/marketing/campaign-dispatcher';
import { MARKETING_PURPOSES, MARKETING_PURPOSE_LABELS, isMarketingLiveSendEnabled, isMarketingPurpose, type MarketingPurpose } from '../modules/marketing/marketing-config';
import { TemplateWorkflowError } from '../modules/marketing/template-service';
import type { SignalStore } from '../modules/analytics/signal-store';
import { sampleSizePerVariant } from '../modules/enterprise/ab-stats';
import type { ExperimentStore } from '../modules/enterprise/experiment-store';
import {
  cancelExperiment,
  createExperiment,
  EXPERIMENT_METRIC_LABELS,
  experimentResults,
  selectWinner,
  startExperiment,
  type ScheduleFor,
} from '../modules/enterprise/experiments';
import {
  collectHumanEngagement,
  resolveSendWindow,
  SEND_TIME_SOURCE_LABELS,
  suggestForContact,
  suggestSendTime,
  type SendTimeSource,
} from '../modules/enterprise/send-time';
import {
  AI_KIND_LABELS,
  AiMarketingError,
  generateAiSuggestion,
  isAiMarketingEnabled,
  type AiKind,
  type AiSuggestionStore,
} from '../modules/enterprise/ai-marketing';
import { LlmError, type LlmClient } from '../modules/assistente/omniroute-client';

type Query = Record<string, string | undefined>;
type Resp = { status: number; body: unknown };
type Priv = { allowed: boolean; authenticated: boolean; actor: string };

export interface EnterpriseRouteDeps {
  marketing: MarketingDeps;
  experiments: ExperimentStore;
  signals: SignalStore;
  ai: AiSuggestionStore;
  /** Cliente do provedor de IA (OmniRoute do Assistente); null = nao configurado. Testes: mock. */
  llm: () => LlmClient | null;
  env: NodeJS.ProcessEnv;
  now: () => Date;
  privilege: () => Priv;
  audit: (entry: { actorEmail: string; action: string; resource: string; status: 'SUCCESS' | 'BLOCKED' | 'WARNING'; details: string }) => void;
}

export const AI_RATE_LIMIT = { max: 20, windowMs: 3600_000 };
const aiLimiter = new SlidingWindowRateLimiter(AI_RATE_LIMIT.max, AI_RATE_LIMIT.windowMs);

const forbidden = (p: Priv): Resp => ({ status: p.authenticated ? 403 : 401, body: { error: 'Ação restrita a administradores ou ao controle total do CRM (com 2FA).' } });

/** Audiencia por segmento ou lista de contatos (mesma regra do disparo real da Fase 3). */
export function resolveAudience(repo: CrmRepository, body: Record<string, unknown>): Contact[] | Resp {
  let contacts = repo.listContacts();
  if (Array.isArray(body.contactIds) && body.contactIds.length > 0) {
    const ids = new Set(body.contactIds.map((x) => String(x)));
    contacts = contacts.filter((c) => ids.has(c.id));
  } else if (body.segmentId) {
    const seg = repo.listMarketingSegments().find((x) => x.id === String(body.segmentId));
    if (!seg) return { status: 404, body: { error: 'Segmento não encontrado.' } };
    const ids = new Set(seg.matchedContactIds || []);
    contacts = contacts.filter((c) => ids.has(c.id));
  } else {
    return { status: 400, body: { error: 'Informe o segmento (segmentId) ou os contatos (contactIds).' } };
  }
  return contacts;
}

/** Agendador por contato com otimizacao de horario (engajamento humano; segmento = a audiencia). */
export async function buildSendTimeScheduler(repo: CrmRepository, signals: SignalStore, env: NodeJS.ProcessEnv, now: Date, audienceIds: string[]): Promise<{ scheduleFor: ScheduleFor; sources: Record<SendTimeSource, number> }> {
  const eng = await collectHumanEngagement(repo, signals, now);
  const window = resolveSendWindow(env);
  const segmentEvents = audienceIds.flatMap((id) => eng.byContact.get(id) || []);
  const sources: Record<SendTimeSource, number> = { CONTATO: 0, SEGMENTO: 0, BASE: 0, PADRAO: 0 };
  const scheduleFor: ScheduleFor = (cid) => {
    const s = suggestSendTime({ contactEvents: eng.byContact.get(cid) || [], segmentEvents, globalEvents: eng.all, notBefore: now, window });
    sources[s.source]++;
    return { at: s.at, by: 'HORARIO_OTIMIZADO' };
  };
  return { scheduleFor, sources };
}

const maskEmail = (e: string) => {
  const [u, d] = String(e || '').split('@');
  return d ? `${u.slice(0, 1)}***@${d}` : '***';
};

export async function handleEnterpriseRoute(repo: CrmRepository, method: string, cleanPath: string, query: Query, body: Record<string, unknown>, ctx: { trustedInternal: boolean }, deps: EnterpriseRouteDeps): Promise<Resp | null> {
  const isOurs =
    cleanPath.startsWith('/api/marketing/experiments') ||
    cleanPath.startsWith('/api/marketing/send-time/') ||
    cleanPath.startsWith('/api/marketing/ai/') ||
    cleanPath === '/api/marketing/enterprise/status' ||
    cleanPath === '/api/marketing/preferences-state' ||
    cleanPath === '/api/marketing/preferences-apply' ||
    /^\/api\/marketing\/campaigns\/[^/]+\/cancel-scheduled$/.test(cleanPath);
  if (!isOurs) return null;
  const wrap = async (fn: () => Promise<Resp>): Promise<Resp> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof TemplateWorkflowError) return { status: err.status, body: { error: err.message } };
      if (err instanceof AiMarketingError) return { status: err.status, body: { error: err.message } };
      if (err instanceof LlmError) return { status: err.code === 'LLM_RATE_LIMITED' ? 429 : 503, body: { error: err.message, code: err.code } };
      throw err;
    }
  };
  const now = deps.now();
  const expDeps = { store: deps.marketing.store, experiments: deps.experiments, signals: deps.signals, env: deps.env, now: deps.now };

  // Central de preferencias (rota publica assinada chama por despacho interno) ----------------
  if (cleanPath === '/api/marketing/preferences-state' || cleanPath === '/api/marketing/preferences-apply') {
    if (!ctx.trustedInternal || method !== 'POST') return { status: 404, body: { error: 'Not found' } };
    const c = body.claims as { contactId?: unknown; campaignId?: unknown; purpose?: unknown } | undefined;
    if (!c || typeof c.contactId !== 'string' || typeof c.campaignId !== 'string' || !isMarketingPurpose(c.purpose)) return { status: 400, body: { error: 'pedido inválido' } };
    const contact = repo.getContactById(c.contactId);
    if (!contact) return { status: 404, body: { error: 'Contato não encontrado.' } };
    const suppressedAll = !repo.canSendMarketingEmailToContact(contact.id).allowed;
    const current = new Set((contact.communicationCategories || []).filter(isMarketingPurpose));
    const state = () => ({
      maskedEmail: maskEmail(contact.email),
      globallyUnsubscribed: suppressedAll,
      purposes: MARKETING_PURPOSES.map((id) => ({ id, label: MARKETING_PURPOSE_LABELS[id], subscribed: !suppressedAll && (repo.getContactById(contact.id)?.communicationCategories || []).includes(id) })),
    });
    if (cleanPath === '/api/marketing/preferences-state') return { status: 200, body: { data: state() } };
    if (body.unsubscribeAll === true) {
      await applyUnsubscribe(repo, deps.marketing, { contactId: contact.id, campaignId: c.campaignId, purpose: c.purpose }, 'ALL_MARKETING');
      return { status: 200, body: { data: { ...state(), changed: ['ALL'] } } };
    }
    const wanted = new Set((Array.isArray(body.purposes) ? body.purposes : []).map(String).filter(isMarketingPurpose));
    const removed = [...current].filter((p) => !wanted.has(p));
    const added = [...wanted].filter((p) => !current.has(p));
    if (removed.length) repo.updateContactSubscriptionPreference({ contactId: contact.id, action: 'UNSUBSCRIBE_PURPOSE', categories: removed, reason: 'Central de preferências (link assinado do e-mail)' });
    let addedApplied: MarketingPurpose[] = [];
    let note: string | null = null;
    if (added.length) {
      if (suppressedAll) {
        // Descadastro total/supressao: reinscricao so com consentimento registrado pela equipe.
        note = 'Você está descadastrado de todo o marketing. Para voltar a receber, fale com a Seta Telecom.';
      } else {
        const fresh = repo.getContactById(contact.id)!;
        repo.updateContact(contact.id, {
          communicationCategories: [...new Set([...(fresh.communicationCategories || []), ...added])],
          lgpdConsent: true,
          lgpdConsentAt: now.toISOString(),
          lgpdLegalBasis: 'CONSENTIMENTO_OPT_IN',
        });
        repo.createTimelineEvent({
          type: 'HEALTH_ALERT',
          title: 'Consentimento por finalidade registrado (central de preferências)',
          body: `O contato optou por receber: ${added.map((p) => MARKETING_PURPOSE_LABELS[p]).join(', ')}. Origem: link assinado enviado por e-mail.`,
          contactId: contact.id,
          companyId: contact.companyId,
          actor: 'Central de preferências LGPD',
          metadata: { action: 'OPT_IN_PURPOSE', categories: added },
        });
        addedApplied = added;
      }
    }
    if (removed.length) {
      const send = await deps.marketing.store.getSend(c.campaignId, contact.id);
      if (send && removed.includes(send.purpose) && !send.unsubscribedAt) await deps.marketing.store.updateSend(send.campaignId, send.contactId, { unsubscribedAt: now.toISOString(), updatedAt: now.toISOString() });
    }
    return { status: 200, body: { data: { ...state(), removed, added: addedApplied, note } } };
  }

  const actorOr = resolveActor(repo, query, ctx);
  if ('status' in actorOr) return actorOr;
  const actor: Actor = actorOr;

  if (cleanPath === '/api/marketing/enterprise/status' && method === 'GET') {
    const w = resolveSendWindow(deps.env);
    return {
      status: 200,
      body: {
        data: {
          aiEnabled: isAiMarketingEnabled(deps.env),
          aiConfigured: Boolean(deps.llm()),
          liveEnabled: isMarketingLiveSendEnabled(deps.env),
          sendWindow: { ...w, timezone: 'America/Sao_Paulo' },
          metrics: EXPERIMENT_METRIC_LABELS,
          aiKinds: AI_KIND_LABELS,
          canManage: deps.privilege().allowed,
        },
      },
    };
  }

  // Testes A/B e multivariados --------------------------------------------------------------
  if (cleanPath === '/api/marketing/experiments/sample-size' && method === 'POST') {
    const n = sampleSizePerVariant({ baselineRate: Number(body.baselineRate) || 0.02, minDetectableLift: Number(body.minDetectableLift) || 0.3, alpha: Number(body.alpha) || 0.05, power: Number(body.power) || 0.8, variants: Number(body.variants) || 2 });
    return { status: 200, body: { data: { perVariant: n, total: n * (Number(body.variants) || 2) } } };
  }
  if (cleanPath === '/api/marketing/experiments' && method === 'GET') {
    const list = await deps.experiments.list();
    return { status: 200, body: { data: list.map(({ audienceContactIds, holdoutContactIds, ...e }) => ({ ...e, audienceSize: audienceContactIds.length, holdoutSize: holdoutContactIds.length })) } };
  }
  if (cleanPath === '/api/marketing/experiments' && method === 'POST') {
    const priv = deps.privilege();
    if (!priv.allowed) return forbidden(priv);
    const audience = resolveAudience(repo, body);
    if (!Array.isArray(audience)) return audience;
    return wrap(async () => {
      const e = await createExperiment(repo, expDeps, body as never, audience, priv.actor);
      deps.audit({ actorEmail: priv.actor, action: 'MARKETING_EXPERIMENT_CREATE', resource: `experiment:${e.id}`, status: 'SUCCESS', details: `${e.kind} com ${e.variants.length} variantes; métrica ${e.metric}; vencedor ${e.winnerMode}.` });
      const { audienceContactIds, holdoutContactIds, ...rest } = e;
      return { status: 201, body: { data: { ...rest, audienceSize: audienceContactIds.length } } };
    });
  }
  const em = cleanPath.match(/^\/api\/marketing\/experiments\/(mexp-[A-Za-z0-9-]{1,60})(?:\/(start|winner|cancel))?$/);
  if (em) {
    const id = em[1];
    if (!em[2] && method === 'GET') {
      const e = await deps.experiments.get(id);
      if (!e) return { status: 404, body: { error: 'Teste não encontrado.' } };
      const results = await experimentResults(expDeps, e);
      const { audienceContactIds, holdoutContactIds, ...rest } = e;
      return { status: 200, body: { data: { experiment: { ...rest, audienceSize: audienceContactIds.length, holdoutSize: holdoutContactIds.length }, results } } };
    }
    if (method !== 'POST' || !em[2]) return { status: 405, body: { error: 'Método não permitido.' } };
    const priv = deps.privilege();
    if (!priv.allowed) return forbidden(priv);
    return wrap(async () => {
      if (em[2] === 'start') {
        const pre = await marketingPreflight(deps.marketing);
        if (!pre.ready) return { status: 409, body: { error: 'Envio real bloqueado.', problems: pre.problems } };
        const draft = await deps.experiments.get(id);
        if (!draft) return { status: 404, body: { error: 'Teste não encontrado.' } };
        const sched = draft.sendTimeOptimization ? await buildSendTimeScheduler(repo, deps.signals, deps.env, now, draft.audienceContactIds) : null;
        const e = await startExperiment(repo, expDeps, id, sched?.scheduleFor);
        deps.audit({ actorEmail: priv.actor, action: 'MARKETING_EXPERIMENT_START', resource: `experiment:${id}`, status: 'SUCCESS', details: `Grupo de teste ${e.testContacts}; restante ${e.holdoutContactIds.length}; bloqueados ${e.blockedAtStart}.` });
        return { status: 200, body: { data: { status: e.status, testContacts: e.testContacts, holdout: e.holdoutContactIds.length, blocked: e.blockedAtStart, sendTimeSources: sched?.sources || null } } };
      }
      if (em[2] === 'winner') {
        const draft = await deps.experiments.get(id);
        if (!draft) return { status: 404, body: { error: 'Teste não encontrado.' } };
        const sched = draft.sendTimeOptimization ? await buildSendTimeScheduler(repo, deps.signals, deps.env, now, draft.audienceContactIds) : null;
        const r = await selectWinner(repo, expDeps, id, { variantId: String(body.variantId || ''), actor: priv.actor, mode: 'MANUAL', confirmNotSignificant: body.confirmNotSignificant === true, scheduleFor: sched?.scheduleFor });
        deps.audit({ actorEmail: priv.actor, action: 'MARKETING_EXPERIMENT_WINNER', resource: `experiment:${id}`, status: 'SUCCESS', details: `Vencedor ${r.experiment.winnerVariantId} (manual${r.experiment.decision?.significant ? ', significativo' : ', sem significância confirmada'}); ${r.rolloutQueued} envio(s) ao restante; ${r.rolloutBlocked} bloqueado(s).` });
        return { status: 200, body: { data: { status: r.experiment.status, winnerVariantId: r.experiment.winnerVariantId, rolloutQueued: r.rolloutQueued, rolloutBlocked: r.rolloutBlocked } } };
      }
      const e = await cancelExperiment(expDeps, id, priv.actor);
      deps.audit({ actorEmail: priv.actor, action: 'MARKETING_EXPERIMENT_CANCEL', resource: `experiment:${id}`, status: 'SUCCESS', details: 'Teste cancelado; envios ainda na fila descartados.' });
      return { status: 200, body: { data: { status: e.status } } };
    });
  }

  // Agendamento: cancelar envios agendados ainda na fila --------------------------------------
  const cs = cleanPath.match(/^\/api\/marketing\/campaigns\/([A-Za-z0-9_.:-]{1,120})\/cancel-scheduled$/);
  if (cs && method === 'POST') {
    const priv = deps.privilege();
    if (!priv.allowed) return forbidden(priv);
    let n = 0;
    for (const s of await deps.marketing.store.listSendsByCampaign(cs[1])) {
      if (s.status === 'QUEUED' && Date.parse(s.nextAttemptAt) > now.getTime() && s.attempts === 0) {
        await deps.marketing.store.updateSend(s.campaignId, s.contactId, { status: 'SKIPPED', reason: 'Agendamento cancelado.', updatedAt: now.toISOString() });
        n++;
      }
    }
    deps.audit({ actorEmail: priv.actor, action: 'MARKETING_SCHEDULE_CANCEL', resource: `campaign:${cs[1]}`, status: 'SUCCESS', details: `${n} envio(s) agendado(s) cancelado(s).` });
    return { status: 200, body: { data: { cancelled: n } } };
  }

  // Otimizacao de horario ----------------------------------------------------------------------
  const stc = cleanPath.match(/^\/api\/marketing\/send-time\/contact\/([^/]{1,120})$/);
  if (stc && method === 'GET') {
    const cid = decodeURIComponent(stc[1]);
    if (!repo.getContactById(cid) || !actor.canSee(cid)) return { status: 404, body: { error: 'Contato não encontrado.' } };
    const eng = await collectHumanEngagement(repo, deps.signals, now);
    const s = suggestForContact(repo, eng, cid, now, resolveSendWindow(deps.env));
    return { status: 200, body: { data: { ...s, sourceLabel: SEND_TIME_SOURCE_LABELS[s.source] } } };
  }
  if (cleanPath === '/api/marketing/send-time/segment' && method === 'POST') {
    const audience = resolveAudience(repo, body);
    if (!Array.isArray(audience)) return audience;
    const visible = audience.filter((c) => actor.canSee(c.id));
    const eng = await collectHumanEngagement(repo, deps.signals, now);
    const window = resolveSendWindow(deps.env);
    const segEvents = visible.flatMap((c) => eng.byContact.get(c.id) || []);
    const segment = suggestSendTime({ segmentEvents: segEvents, globalEvents: eng.all, notBefore: now, window });
    const sources: Record<SendTimeSource, number> = { CONTATO: 0, SEGMENTO: 0, BASE: 0, PADRAO: 0 };
    const hours = new Map<number, number>();
    for (const c of visible) {
      const s = suggestSendTime({ contactEvents: eng.byContact.get(c.id) || [], segmentEvents: segEvents, globalEvents: eng.all, notBefore: now, window });
      sources[s.source]++;
      hours.set(s.hour, (hours.get(s.hour) || 0) + 1);
    }
    return {
      status: 200,
      body: { data: { segment: { ...segment, sourceLabel: SEND_TIME_SOURCE_LABELS[segment.source] }, contacts: visible.length, sources, byHour: [...hours.entries()].sort((a, b) => a[0] - b[0]).map(([hour, count]) => ({ hour, count })), window: { ...window, timezone: 'America/Sao_Paulo' } } },
    };
  }
  const sts = cleanPath.match(/^\/api\/marketing\/send-time\/sequence\/([^/]{1,120})$/);
  if (sts && method === 'POST') {
    const priv = deps.privilege();
    if (!priv.allowed) return forbidden(priv);
    const seqId = decodeURIComponent(sts[1]);
    const updated = repo.updateSequence(seqId, { sendTimeOptimization: body.enabled === true });
    if (!updated) return { status: 404, body: { error: 'Cadência não encontrada.' } };
    deps.audit({ actorEmail: priv.actor, action: 'SEQUENCE_SEND_TIME_OPTIMIZATION', resource: `sequence:${seqId}`, status: 'SUCCESS', details: `Otimização de horário ${updated.sendTimeOptimization ? 'ligada' : 'desligada'}.` });
    return { status: 200, body: { data: { sequenceId: seqId, sendTimeOptimization: updated.sendTimeOptimization === true } } };
  }

  // IA comercial e de marketing ---------------------------------------------------------------
  if (cleanPath.startsWith('/api/marketing/ai/')) {
    if (!isAiMarketingEnabled(deps.env)) return { status: 403, body: { error: 'IA de marketing desligada (AI_MARKETING_ENABLED).', code: 'AI_MARKETING_DISABLED' } };
    if (cleanPath === '/api/marketing/ai/suggest' && method === 'POST') {
      const kind = String(body.kind || '') as AiKind;
      if (!AI_KIND_LABELS[kind]) return { status: 400, body: { error: 'Tipo de sugestão inválido.' } };
      const contactId = body.contactId ? String(body.contactId) : undefined;
      const companyId = body.companyId ? String(body.companyId) : undefined;
      if (kind === 'NEXT_STEP' && (!contactId || !actor.canSee(contactId))) return { status: 404, body: { error: 'Contato não encontrado.' } };
      if (kind === 'ACCOUNT_SUMMARY' && (!companyId || !actor.canSeeCompany(companyId))) return { status: 404, body: { error: 'Empresa não encontrada.' } };
      const llm = deps.llm();
      if (!llm) return { status: 503, body: { error: 'Provedor de IA não configurado (OMNIROUTE_BASE_URL / OMNIROUTE_API_KEY).', code: 'AI_NOT_CONFIGURED' } };
      if (!aiLimiter.hit(`ai-mkt:${actor.email}`)) return { status: 429, body: { error: `Limite de ${AI_RATE_LIMIT.max} sugestões por hora atingido.` } };
      return wrap(async () => {
        try {
          const s = await generateAiSuggestion(repo, { store: deps.marketing.store, signals: deps.signals, llm, suggestions: deps.ai }, { kind, templateId: body.templateId ? String(body.templateId) : undefined, brief: body.brief ? String(body.brief) : undefined, purpose: body.purpose ? String(body.purpose) : undefined, contactId, companyId }, actor.email, now);
          // Auditoria sem conteudo pessoal nem texto gerado: tipo, alvo (id), modelo, confianca e contagens.
          deps.audit({ actorEmail: actor.email, action: 'AI_MARKETING_SUGGEST', resource: `ai:${kind}:${s.target.type}:${s.target.id || '-'}`, status: 'SUCCESS', details: `Modelo ${s.model}; ${s.items.length} sugestão(ões); confiança ${s.confidence} (${s.confidenceLevel}); ${s.evidence.length} evidência(s); aguardando aprovação humana.` });
          return { status: 201, body: { data: s } };
        } catch (e) {
          deps.audit({ actorEmail: actor.email, action: 'AI_MARKETING_SUGGEST', resource: `ai:${kind}`, status: 'WARNING', details: `Falha: ${e instanceof LlmError ? e.code : e instanceof AiMarketingError ? `HTTP ${e.status}` : 'erro interno'}.` });
          throw e;
        }
      });
    }
    if (cleanPath === '/api/marketing/ai/suggestions' && method === 'GET') {
      const all = deps.privilege().allowed && query.all === '1';
      return { status: 200, body: { data: await deps.ai.list({ createdBy: all ? undefined : actor.email, limit: 50 }) } };
    }
    const am = cleanPath.match(/^\/api\/marketing\/ai\/suggestions\/(aisg-[A-Za-z0-9-]{1,60})\/(approve|reject)$/);
    if (am && method === 'POST') {
      const s = await deps.ai.get(am[1]);
      if (!s) return { status: 404, body: { error: 'Sugestão não encontrada.' } };
      const priv = deps.privilege();
      if (s.createdBy !== actor.email && !priv.allowed) return { status: 404, body: { error: 'Sugestão não encontrada.' } };
      const approve = am[2] === 'approve';
      const done = await deps.ai.transition(s.id, ['PENDING_APPROVAL'], {
        status: approve ? 'APPROVED' : 'REJECTED',
        decidedBy: actor.email,
        decidedAt: now.toISOString(),
        decisionNote: body.note ? String(body.note).replace(/\p{Extended_Pictographic}/gu, '').slice(0, 300) : null,
      });
      if (!done) return { status: 409, body: { error: 'A sugestão já foi decidida.' } };
      deps.audit({ actorEmail: actor.email, action: approve ? 'AI_MARKETING_APPROVE' : 'AI_MARKETING_REJECT', resource: `ai-suggestion:${s.id}`, status: 'SUCCESS', details: `${AI_KIND_LABELS[s.kind]}; confiança ${s.confidence}. A IA não aplica nada: uso manual pelo usuário.` });
      return { status: 200, body: { data: done } };
    }
    return { status: 404, body: { error: 'Not found' } };
  }
  return { status: 404, body: { error: 'Not found' } };
}
