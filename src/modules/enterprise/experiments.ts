// ============================================================================
// STI-hub — Fase 6: motor dos testes A/B e multivariados das campanhas.
//  - Variantes = modelos APROVADOS (Fase 3) e/ou assuntos alternativos; multivariado = combinacao
//    assunto x modelo (ate 6 variantes). Mesma finalidade LGPD em todas.
//  - Sorteio deterministico (hash do teste + contato) do grupo de teste; restante aguarda o vencedor.
//  - Metrica padrao: clique humano confirmado (Fase 5). Abertura observada so como opcao, com aviso
//    (Apple MPP / proxies inflam aberturas). Aberturas automaticas e cliques de robo nunca contam.
//  - Vencedor manual ou automatico (so com significancia, depois do tempo minimo). Sem
//    significancia ao fim do prazo: "aguardando decisao" + tarefa; nada e enviado sozinho.
//  - Envio ao restante pela fila da Fase 3 (elegibilidade LGPD conferida de novo, MARKETING_LIVE_SEND,
//    allowlist, dominio, reserva por contato).
// ============================================================================
import crypto from 'node:crypto';
import type { CrmRepository } from '../../db/repository';
import type { Contact } from '../../db/types';
import { checkMarketingEligibility, MARKETING_REVIEW_QUEUE } from '../marketing/campaign-dispatcher';
import { resolveMarketingTestRecipients, type MarketingPurpose } from '../marketing/marketing-config';
import type { MarketingSend, MarketingStore } from '../marketing/marketing-store';
import { getSendableVersion, TemplateWorkflowError } from '../marketing/template-service';
import type { SignalStore } from '../analytics/signal-store';
import { evaluateVariants, sampleSizePerVariant, type ExperimentDecision, type VariantResult } from './ab-stats';
import type { Experiment, ExperimentMetric, ExperimentStore, ExperimentVariant } from './experiment-store';

export const EXPERIMENT_MAX_VARIANTS = 6;
export const EXPERIMENT_DEFAULT_BASELINE = 0.02;
export const EXPERIMENT_METRIC_LABELS: Record<ExperimentMetric, string> = {
  HUMAN_CLICK: 'Clique humano confirmado (recomendado)',
  OPEN_OBSERVED: 'Abertura observada (não recomendado: Apple MPP e proxies inflam aberturas)',
};

export interface ExperimentDeps {
  store: MarketingStore;
  experiments: ExperimentStore;
  signals: SignalStore;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export type ScheduleFor = (contactId: string) => { at: string; by: 'AGENDAMENTO' | 'HORARIO_OTIMIZADO' } | null;

const LETTERS = 'ABCDEF';
const clampNum = (v: unknown, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const cleanSubject = (s: unknown) =>
  String(s ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .trim()
    .slice(0, 200);

/** Taxa historica de clique humano das campanhas (180 dias); padrao 2% com pouca amostra. */
export async function historicalHumanClickRate(repo: CrmRepository, deps: Pick<ExperimentDeps, 'store' | 'signals'>, now: Date): Promise<{ rate: number; source: string }> {
  const since = new Date(now.getTime() - 180 * 86400000).toISOString();
  let n = 0;
  const sentKeys = new Set<string>();
  for (const c of repo.listMarketingCampaigns()) {
    for (const s of await deps.store.listSendsByCampaign(c.id)) {
      if (s.sentAt && s.sentAt >= since && !s.bouncedAt) {
        n++;
        sentKeys.add(`${s.campaignId}|${s.contactId}`);
      }
    }
  }
  const clicked = new Set<string>();
  for (const sig of await deps.signals.listSince(since, now.toISOString(), 50000)) {
    const k = `${sig.campaignId}|${sig.contactId}`;
    if (sig.classification === 'CLICK_HUMAN' && sentKeys.has(k)) clicked.add(k);
  }
  if (n < 200 || clicked.size === 0) return { rate: EXPERIMENT_DEFAULT_BASELINE, source: `Padrão de ${EXPERIMENT_DEFAULT_BASELINE * 100}% (histórico insuficiente: ${n} envio(s))` };
  return { rate: clicked.size / n, source: `Histórico de 180 dias: ${clicked.size} clique(s) humano(s) em ${n} envio(s)` };
}

export interface CreateExperimentInput {
  campaignId: string;
  name?: string;
  metric?: ExperimentMetric;
  variants?: Array<{ label?: string; templateId: string; subjectOverride?: string | null }>;
  factors?: { subjects?: string[]; templateIds?: string[] };
  testPercent?: number;
  alpha?: number;
  power?: number;
  baselineRate?: number;
  minDetectableLift?: number;
  winnerMode?: 'MANUAL' | 'AUTO';
  minHoursBeforeDecision?: number;
  maxTestHours?: number;
  sendTimeOptimization?: boolean;
  testSendAt?: string | null;
}

export async function createExperiment(
  repo: CrmRepository,
  deps: ExperimentDeps,
  input: CreateExperimentInput,
  audience: Contact[],
  actor: string
): Promise<Experiment> {
  const now = (deps.now || (() => new Date()))();
  const campaign = repo.getMarketingCampaignById(input.campaignId);
  if (!campaign) throw new TemplateWorkflowError('Campanha não encontrada.', 404);
  const existing = await deps.experiments.getByCampaign(campaign.id);
  if (existing && existing.status !== 'DRAFT' && existing.status !== 'CANCELLED') throw new TemplateWorkflowError('Esta campanha já tem um teste em andamento ou concluído.', 409);
  // Rascunho nao tem envios; qualquer envio existente significa campanha ja disparada.
  if ((await deps.store.listSendsByCampaign(campaign.id)).length > 0) throw new TemplateWorkflowError('A campanha já tem envios na fila; crie o teste numa campanha nova.', 409);

  // Variantes: lista explicita ou fatores (assunto x modelo).
  let raw: Array<{ label?: string; templateId: string; subjectOverride?: string | null }> = [];
  let kind: Experiment['kind'] = 'AB';
  if (input.factors && (input.factors.subjects?.length || input.factors.templateIds?.length)) {
    const subjects = (input.factors.subjects || []).map(cleanSubject).filter(Boolean);
    const tpls = (input.factors.templateIds || []).map(String).filter(Boolean);
    if (!tpls.length) throw new TemplateWorkflowError('Informe ao menos um modelo aprovado.', 400);
    const subjList: Array<string | null> = subjects.length ? subjects : [null];
    for (const t of tpls) for (const s of subjList) raw.push({ templateId: t, subjectOverride: s });
    kind = subjList.length > 1 && tpls.length > 1 ? 'MULTIVARIATE' : 'AB';
  } else {
    raw = (input.variants || []).map((v) => ({ label: v.label, templateId: String(v.templateId || ''), subjectOverride: v.subjectOverride ? cleanSubject(v.subjectOverride) : null }));
  }
  if (raw.length < 2) throw new TemplateWorkflowError('O teste precisa de ao menos 2 variantes.', 400);
  if (raw.length > EXPERIMENT_MAX_VARIANTS) throw new TemplateWorkflowError(`No máximo ${EXPERIMENT_MAX_VARIANTS} variantes (combinações).`, 400);
  const variants: ExperimentVariant[] = [];
  let purpose: string | null = null;
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const { template, version } = await getSendableVersion(deps.store, raw[i].templateId);
    if (purpose && template.purpose !== purpose) throw new TemplateWorkflowError('Todas as variantes precisam ter a mesma finalidade (LGPD).', 400);
    purpose = template.purpose;
    const key = `${template.id}#${version.version}#${raw[i].subjectOverride || ''}`;
    if (seen.has(key)) throw new TemplateWorkflowError('Há variantes repetidas (mesmo modelo e assunto).', 400);
    seen.add(key);
    const subj = raw[i].subjectOverride || version.subject;
    variants.push({
      id: LETTERS[i],
      label: String(raw[i].label || '').trim().slice(0, 60) || `Variante ${LETTERS[i]}: ${template.name} / ${subj}`.slice(0, 120),
      templateId: template.id,
      templateVersion: version.version,
      subjectOverride: raw[i].subjectOverride || null,
    });
  }
  const metric: ExperimentMetric = input.metric === 'OPEN_OBSERVED' ? 'OPEN_OBSERVED' : 'HUMAN_CLICK';
  const alpha = [0.01, 0.05, 0.1].includes(Number(input.alpha)) ? Number(input.alpha) : 0.05;
  const power = [0.8, 0.9].includes(Number(input.power)) ? Number(input.power) : 0.8;
  const hist = input.baselineRate ? { rate: clampNum(input.baselineRate, EXPERIMENT_DEFAULT_BASELINE, 0.001, 0.9), source: 'Informada no teste' } : await historicalHumanClickRate(repo, deps, now);
  const minDetectableLift = clampNum(input.minDetectableLift, 0.3, 0.05, 5);
  const minPerVariant = sampleSizePerVariant({ baselineRate: hist.rate, minDetectableLift, alpha, power, variants: variants.length });
  const testPercent = Math.round(clampNum(input.testPercent, 20, 5, 100));
  const testSendAt = input.testSendAt && Number.isFinite(Date.parse(input.testSendAt)) && Date.parse(input.testSendAt) > now.getTime() ? new Date(input.testSendAt).toISOString() : null;
  const warnings: string[] = [];
  const testGroup = Math.round((audience.length * testPercent) / 100);
  if (testGroup < minPerVariant * variants.length) {
    warnings.push(`Audiência pequena: o grupo de teste (~${testGroup}) não alcança a amostra mínima (${minPerVariant} por variante, ${minPerVariant * variants.length} no total). O vencedor automático não será escolhido sem significância; decida manualmente ou aumente a audiência/percentual.`);
  }
  if (metric === 'OPEN_OBSERVED') warnings.push('Métrica por abertura observada: Apple MPP e proxies abrem e-mails sozinhos; prefira clique humano confirmado.');
  const exp: Experiment = {
    id: existing?.id || `mexp-${crypto.randomUUID()}`,
    campaignId: campaign.id,
    name: String(input.name || `Teste ${kind === 'MULTIVARIATE' ? 'multivariado' : 'A/B'} - ${campaign.name}`).slice(0, 160),
    kind,
    metric,
    purpose: purpose!,
    variants,
    testPercent,
    alpha,
    power,
    baselineRate: Math.round(hist.rate * 10000) / 10000,
    baselineSource: hist.source,
    minDetectableLift,
    minPerVariant,
    winnerMode: input.winnerMode === 'AUTO' ? 'AUTO' : 'MANUAL',
    minHoursBeforeDecision: Math.round(clampNum(input.minHoursBeforeDecision, 4, 1, 72)),
    maxTestHours: Math.round(clampNum(input.maxTestHours, 72, 4, 336)),
    sendTimeOptimization: input.sendTimeOptimization === true,
    testSendAt,
    audienceContactIds: audience.map((c) => c.id).slice(0, 50000),
    status: 'DRAFT',
    testStartedAt: null,
    testContacts: 0,
    holdoutContactIds: [],
    blockedAtStart: 0,
    winnerVariantId: null,
    decisionMode: null,
    decidedBy: null,
    decidedAt: null,
    decision: null,
    rolloutQueued: 0,
    rolloutBlocked: 0,
    reviewTaskId: null,
    lastEvaluatedAt: null,
    warnings,
    createdBy: actor,
    createdAt: existing?.createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await deps.experiments.save(exp);
  return exp;
}

const bucketHash = (expId: string, contactId: string) => crypto.createHash('sha256').update(`${expId}:${contactId}`).digest('hex');

function sendRow(exp: Experiment, c: Contact, v: ExperimentVariant, phase: 'TEST' | 'ROLLOUT', nowIso: string, sched: ReturnType<ScheduleFor>): MarketingSend {
  const at = sched && Date.parse(sched.at) > Date.parse(nowIso) ? new Date(sched.at).toISOString() : nowIso;
  return {
    campaignId: exp.campaignId,
    contactId: c.id,
    email: c.email.trim().toLowerCase(),
    templateId: v.templateId,
    templateVersion: v.templateVersion,
    purpose: exp.purpose as MarketingPurpose,
    status: 'QUEUED',
    reason: null,
    attempts: 0,
    provider: null,
    providerMessageId: null,
    trackingId: null,
    queuedAt: nowIso,
    nextAttemptAt: at,
    sentAt: null,
    deliveredAt: null,
    bouncedAt: null,
    complainedAt: null,
    unsubscribedAt: null,
    updatedAt: nowIso,
    experimentId: exp.id,
    variantId: v.id,
    abPhase: phase,
    subjectOverride: v.subjectOverride,
    scheduledBy: at !== nowIso ? sched!.by : null,
  };
}

/** Inicia o teste: sorteia o grupo de teste entre os elegiveis e enfileira as variantes. */
export async function startExperiment(repo: CrmRepository, deps: ExperimentDeps, id: string, scheduleFor?: ScheduleFor): Promise<Experiment> {
  const now = (deps.now || (() => new Date()))();
  const nowIso = now.toISOString();
  const exp = await deps.experiments.get(id);
  if (!exp) throw new TemplateWorkflowError('Teste não encontrado.', 404);
  if (exp.status !== 'DRAFT') throw new TemplateWorkflowError('O teste já foi iniciado.', 409);
  for (const v of exp.variants) {
    const { version } = await getSendableVersion(deps.store, v.templateId);
    if (version.version !== v.templateVersion) throw new TemplateWorkflowError(`O modelo da ${v.label} mudou de versão aprovada; recrie o teste.`, 409);
  }
  const allowlist = resolveMarketingTestRecipients(deps.env || process.env);
  const eligible: Contact[] = [];
  let blocked = 0;
  for (const cid of exp.audienceContactIds) {
    const c = repo.getContactById(cid);
    if (!c || !checkMarketingEligibility(repo, c, exp.purpose as MarketingPurpose, allowlist).allowed) {
      blocked++;
      continue;
    }
    eligible.push(c);
  }
  const k = exp.variants.length;
  if (eligible.length < k) throw new TemplateWorkflowError(`Contatos elegíveis insuficientes (${eligible.length}) para ${k} variantes.`, 409);
  eligible.sort((a, b) => bucketHash(exp.id, a.id).localeCompare(bucketHash(exp.id, b.id)));
  const testCount = exp.testPercent >= 100 ? eligible.length : Math.min(eligible.length, Math.max(k, Math.round((eligible.length * exp.testPercent) / 100)));
  const testGroup = eligible.slice(0, testCount);
  const holdout = eligible.slice(testCount);
  const fixedAt: ScheduleFor | undefined = exp.testSendAt ? () => ({ at: exp.testSendAt!, by: 'AGENDAMENTO' }) : undefined;
  const sched: ScheduleFor = (cid) => (exp.sendTimeOptimization && scheduleFor ? scheduleFor(cid) : null) || (fixedAt ? fixedAt(cid) : null);
  // CAS antes de enfileirar: dois cliques simultaneos => um so inicio.
  const started = await deps.experiments.transition(exp.id, ['DRAFT'], {
    status: 'TESTING',
    testStartedAt: exp.testSendAt && Date.parse(exp.testSendAt) > now.getTime() ? exp.testSendAt : nowIso,
    testContacts: testGroup.length,
    holdoutContactIds: holdout.map((c) => c.id),
    blockedAtStart: blocked,
    updatedAt: nowIso,
  });
  if (!started) throw new TemplateWorkflowError('O teste já foi iniciado.', 409);
  const rows = testGroup.map((c, i) => sendRow(exp, c, exp.variants[i % k], 'TEST', nowIso, sched(c.id)));
  await deps.store.enqueueSends(rows);
  return started;
}

export interface ExperimentResults {
  variants: Array<VariantResult & { queued: number; sent: number; opensObserved: number; opensMachine: number; clicksHuman: number; clicksBot: number; subject: string | null; templateId: string }>;
  decision: ExperimentDecision;
  firstSentAt: string | null;
  rollout: { queued: number; sent: number };
}

/** Resultados por variante (so o grupo de teste). Conversao = contato com o sinal da metrica. */
export async function experimentResults(deps: ExperimentDeps, exp: Experiment): Promise<ExperimentResults> {
  const now = (deps.now || (() => new Date()))();
  const sends = await deps.store.listSendsByCampaign(exp.campaignId);
  const test = sends.filter((s) => s.experimentId === exp.id && s.abPhase === 'TEST');
  const since = exp.testStartedAt || exp.createdAt;
  const sigs = (await deps.signals.listSince(new Date(Date.parse(since) - 3600000).toISOString(), now.toISOString(), 50000)).filter((s) => s.campaignId === exp.campaignId);
  const byContact = new Map<string, typeof sigs>();
  for (const s of sigs) if (s.contactId) byContact.set(s.contactId, [...(byContact.get(s.contactId) || []), s]);
  const conversionClass = exp.metric === 'OPEN_OBSERVED' ? 'OPEN_OBSERVED' : 'CLICK_HUMAN';
  const variants = exp.variants.map((v) => {
    const vs = test.filter((s) => s.variantId === v.id);
    const delivered = vs.filter((s) => s.sentAt && !s.bouncedAt);
    let conversions = 0;
    let opensObserved = 0;
    let opensMachine = 0;
    let clicksHuman = 0;
    let clicksBot = 0;
    for (const s of delivered) {
      const list = (byContact.get(s.contactId) || []).filter((x) => x.at >= s.sentAt!);
      if (list.some((x) => x.classification === conversionClass)) conversions++;
      opensObserved += list.filter((x) => x.classification === 'OPEN_OBSERVED').length;
      opensMachine += list.filter((x) => x.classification === 'OPEN_MACHINE').length;
      clicksHuman += list.filter((x) => x.classification === 'CLICK_HUMAN').length;
      clicksBot += list.filter((x) => x.classification === 'CLICK_BOT').length;
    }
    const n = delivered.length;
    return {
      id: v.id,
      label: v.label,
      conversions,
      n,
      rate: n ? conversions / n : 0,
      queued: vs.filter((s) => s.status === 'QUEUED').length,
      sent: vs.filter((s) => s.sentAt).length,
      opensObserved,
      opensMachine,
      clicksHuman,
      clicksBot,
      subject: v.subjectOverride,
      templateId: v.templateId,
    };
  });
  const decision = evaluateVariants(variants, { alpha: exp.alpha, minPerVariant: exp.minPerVariant });
  const firstSentAt = test.map((s) => s.sentAt).filter((x): x is string => Boolean(x)).sort()[0] || null;
  const rollout = sends.filter((s) => s.experimentId === exp.id && s.abPhase === 'ROLLOUT');
  return { variants, decision, firstSentAt, rollout: { queued: rollout.filter((s) => s.status === 'QUEUED').length, sent: rollout.filter((s) => s.sentAt).length } };
}

/** Escolhe o vencedor (CAS) e enfileira o vencedor ao restante (elegibilidade conferida de novo). */
export async function selectWinner(
  repo: CrmRepository,
  deps: ExperimentDeps,
  id: string,
  input: { variantId: string; actor: string; mode: 'AUTO' | 'MANUAL'; confirmNotSignificant?: boolean; scheduleFor?: ScheduleFor }
): Promise<{ experiment: Experiment; rolloutQueued: number; rolloutBlocked: number }> {
  const now = (deps.now || (() => new Date()))();
  const nowIso = now.toISOString();
  const exp = await deps.experiments.get(id);
  if (!exp) throw new TemplateWorkflowError('Teste não encontrado.', 404);
  if (exp.status !== 'TESTING' && exp.status !== 'NEEDS_DECISION') throw new TemplateWorkflowError('O teste não está aguardando vencedor.', 409);
  const winner = exp.variants.find((v) => v.id === input.variantId);
  if (!winner) throw new TemplateWorkflowError('Variante inválida.', 400);
  const results = await experimentResults(deps, exp);
  if (input.mode === 'AUTO' && (!results.decision.significant || results.decision.winnerId !== winner.id)) throw new TemplateWorkflowError('Vencedor automático só com significância estatística.', 409);
  if (input.mode === 'MANUAL' && !results.decision.significant && !input.confirmNotSignificant) {
    throw new TemplateWorkflowError(`Resultado ainda sem significância (${results.decision.reason}). Confirme para escolher mesmo assim.`, 409);
  }
  const selected = await deps.experiments.transition(exp.id, ['TESTING', 'NEEDS_DECISION'], {
    status: 'WINNER_SELECTED',
    winnerVariantId: winner.id,
    decisionMode: input.mode,
    decidedBy: input.actor,
    decidedAt: nowIso,
    decision: results.decision,
    updatedAt: nowIso,
  });
  if (!selected) throw new TemplateWorkflowError('O vencedor já foi escolhido por outra execução.', 409);
  // Envios de teste ainda na fila (agendados) continuam: o grupo de teste recebe a variante sorteada.
  const allowlist = resolveMarketingTestRecipients(deps.env || process.env);
  const rows: MarketingSend[] = [];
  let blocked = 0;
  for (const cid of selected.holdoutContactIds) {
    const c = repo.getContactById(cid);
    if (!c || !checkMarketingEligibility(repo, c, selected.purpose as MarketingPurpose, allowlist).allowed) {
      blocked++;
      continue;
    }
    rows.push(sendRow(selected, c, winner, 'ROLLOUT', nowIso, selected.sendTimeOptimization && input.scheduleFor ? input.scheduleFor(c.id) : null));
  }
  const r = rows.length ? await deps.store.enqueueSends(rows) : { inserted: 0, existing: 0 };
  const done = await deps.experiments.transition(exp.id, ['WINNER_SELECTED'], { status: 'COMPLETED', rolloutQueued: r.inserted, rolloutBlocked: blocked, updatedAt: nowIso });
  return { experiment: done || selected, rolloutQueued: r.inserted, rolloutBlocked: blocked };
}

export async function cancelExperiment(deps: ExperimentDeps, id: string, actor: string): Promise<Experiment> {
  const nowIso = (deps.now || (() => new Date()))().toISOString();
  const exp = await deps.experiments.transition(id, ['DRAFT', 'TESTING', 'NEEDS_DECISION'], { status: 'CANCELLED', decidedBy: actor, decidedAt: nowIso, updatedAt: nowIso });
  if (!exp) throw new TemplateWorkflowError('O teste não pode mais ser cancelado.', 409);
  for (const s of await deps.store.listSendsByCampaign(exp.campaignId)) {
    if (s.experimentId === exp.id && s.status === 'QUEUED') await deps.store.updateSend(s.campaignId, s.contactId, { status: 'SKIPPED', reason: 'Teste A/B cancelado.', updatedAt: nowIso });
  }
  return exp;
}

/**
 * Avaliacao periodica (cron de marketing, dentro da trava): vencedor automatico com significancia;
 * fim do prazo sem significancia => aguardando decisao + tarefa. Modo manual: so avisa.
 */
export async function tickExperiments(repo: CrmRepository, deps: ExperimentDeps, scheduleFor?: ScheduleFor): Promise<{ evaluated: number; winners: number; needsDecision: number }> {
  const now = (deps.now || (() => new Date()))();
  const nowIso = now.toISOString();
  const out = { evaluated: 0, winners: 0, needsDecision: 0 };
  for (const exp of await deps.experiments.listByStatus(['TESTING'])) {
    const res = await experimentResults(deps, exp);
    out.evaluated++;
    await deps.experiments.transition(exp.id, ['TESTING'], { decision: res.decision, lastEvaluatedAt: nowIso });
    if (!res.firstSentAt) continue;
    const hours = (now.getTime() - Date.parse(res.firstSentAt)) / 3600000;
    if (hours < exp.minHoursBeforeDecision) continue;
    if (exp.winnerMode === 'AUTO' && res.decision.significant && res.decision.winnerId) {
      try {
        await selectWinner(repo, deps, exp.id, { variantId: res.decision.winnerId, actor: 'Sistema STI-hub (vencedor automático)', mode: 'AUTO', scheduleFor });
        out.winners++;
      } catch {
        // outra execucao decidiu antes (CAS) — nada a fazer
      }
      continue;
    }
    const campaign = repo.getMarketingCampaignById(exp.campaignId);
    const expired = hours >= exp.maxTestHours;
    const manualReady = exp.winnerMode === 'MANUAL' && res.decision.significant;
    if (expired || manualReady) {
      let taskId = exp.reviewTaskId;
      if (!taskId) {
        try {
          taskId = repo.createTask({
            title: `Decidir o vencedor do teste "${exp.name}"`,
            notes: `${res.decision.reason} Abra E-mail Marketing > Recursos avançados > Testes A/B para escolher a variante. Nada é enviado ao restante da audiência sem decisão.`,
            type: 'TODO',
            priority: 'MEDIUM',
            status: 'NOT_STARTED',
            queueName: MARKETING_REVIEW_QUEUE,
            dueDate: nowIso.slice(0, 10),
            dueTime: '10:00',
            assignedTo: campaign?.ownerName || 'Marcelo Lopes Mira',
            contactId: null,
            companyId: null,
          }).id;
        } catch {
          taskId = null;
        }
      }
      if (expired && !res.decision.significant) {
        if (await deps.experiments.transition(exp.id, ['TESTING'], { status: 'NEEDS_DECISION', reviewTaskId: taskId, updatedAt: nowIso })) out.needsDecision++;
      } else if (taskId !== exp.reviewTaskId) {
        await deps.experiments.transition(exp.id, ['TESTING'], { reviewTaskId: taskId, updatedAt: nowIso });
      }
    }
  }
  return out;
}
