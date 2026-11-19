// ============================================================================
// STI-hub — Fase 5: Analytics de engajamento (20 perguntas com drill-down, conversao por passo de
// cadencia, caminhos A/B das automacoes, receita influenciada, coortes).
//  - Somente leitura: nada e gravado no CRM nem no ERP (propostas/contratos so lidos, e apenas para
//    quem tem acesso ao ERP).
//  - Abertura nunca conta como engajamento humano. "Humano confirmado" = clique humano provavel,
//    resposta, reuniao ou formulario.
//  - Registros simulados (cadencias em modo simulacao) so entram se pedido (includeSimulated).
//  - Escopo: o chamador passa canSee(contactId); dados de contatos fora do escopo nao entram.
// ============================================================================
import type { CrmRepository } from '../../db/repository';
import type { Contact, Deal, SequenceEnrollment } from '../../db/types';
import type { MarketingStore } from '../marketing/marketing-store';
import type { WorkflowStore } from '../workflows/dag/store';
import { classifyReply, type SignalClass } from './signal-classifier';
import type { EngagementSignal, SignalStore } from './signal-store';

export const ATTRIBUTION_WINDOW_DAYS = 90;
export const RECENT_DAYS = 14;
export const LOSING_RECENT_DAYS = 30;
export const SCORE_HALF_LIFE_DAYS = 30;
const DAY = 86400000;

export const ANALYTICS_QUESTIONS: Array<{ id: number; question: string }> = [
  { id: 1, question: 'Quem recebeu meus e-mails?' },
  { id: 2, question: 'Quem abriu, segundo o rastreamento disponível?' },
  { id: 3, question: 'Quem clicou?' },
  { id: 4, question: 'Em quais links?' },
  { id: 5, question: 'Quem respondeu?' },
  { id: 6, question: 'Quem respondeu positivamente?' },
  { id: 7, question: 'Quem nunca demonstrou engajamento?' },
  { id: 8, question: 'Quem está engajando recentemente?' },
  { id: 9, question: 'Quem saiu de uma cadência?' },
  { id: 10, question: 'Por qual motivo saiu?' },
  { id: 11, question: 'Quem solicitou descadastro?' },
  { id: 12, question: 'Quem foi bloqueado por bounce?' },
  { id: 13, question: 'Quem agendou reunião?' },
  { id: 14, question: 'Quais clientes estão mais interessados?' },
  { id: 15, question: 'Quais campanhas geraram oportunidades?' },
  { id: 16, question: 'Quais campanhas geraram contratos?' },
  { id: 17, question: 'Qual vendedor tem maior taxa de resposta?' },
  { id: 18, question: 'Qual sequência gera mais oportunidades?' },
  { id: 19, question: 'Qual é a receita atribuída a cada campanha?' },
  { id: 20, question: 'Quais contatos estão perdendo engajamento?' },
];

export const EXIT_REASON_LABELS: Record<string, string> = {
  CONTACT_REPLIED: 'Respondeu',
  MEETING_BOOKED: 'Agendou reunião',
  STOP_REQUESTED: 'Pediu para parar',
  HIGH_INTENT_LINK_CLICKED: 'Clicou em link de alta intenção',
  OPPORTUNITY_CREATED: 'Oportunidade criada',
  DEAL_STAGE_CHANGED: 'Mudança de etapa',
  DEAL_WON_OR_LOST: 'Negócio ganho/perdido',
  CONTACT_DISQUALIFIED: 'Contato desqualificado',
  MOVED_TO_INCOMPATIBLE_SEQUENCE: 'Movido para outra cadência',
  HARD_BOUNCE: 'Hard bounce',
  SPAM_COMPLAINT: 'Reclamação de spam',
  CONSENT_WITHDRAWN: 'Consentimento retirado',
};

// ----------------------------------------------------------------------------
export type Channel = 'CAMPANHA' | 'CADENCIA';
export interface Touch {
  contactId: string;
  channel: Channel;
  refId: string;
  refName: string;
  at: string;
  simulated: boolean;
  stepOrder?: number;
  enrollmentId?: string;
  trackingId?: string | null;
  senderEmail?: string | null;
}
export type EngType = 'OPEN_OBSERVED' | 'OPEN_MACHINE' | 'CLICK_HUMAN' | 'CLICK_BOT' | 'REPLY' | 'MEETING' | 'FORM';
export interface EngEvent {
  contactId: string;
  at: string;
  type: EngType;
  simulated: boolean;
  reason: string;
  url?: string | null;
  trackingId?: string | null;
  sentiment?: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  enrollmentId?: string;
  campaignId?: string | null;
}
const HUMAN: Set<EngType> = new Set(['CLICK_HUMAN', 'REPLY', 'MEETING', 'FORM']);
export const isHuman = (e: EngEvent) => HUMAN.has(e.type);

export interface AnalyticsOptions {
  from: string;
  to: string;
  includeSimulated: boolean;
  canSee: (contactId: string) => boolean;
  /** ERP (propostas/contratos) so para quem tem acesso ao ERP. */
  erpAllowed: boolean;
}
export interface AnalyticsDeps {
  signals: SignalStore;
  marketing?: MarketingStore | null;
  workflows?: WorkflowStore | null;
}

export interface Dataset {
  opts: AnalyticsOptions;
  contacts: Map<string, Contact>;
  touches: Touch[];
  events: EngEvent[];
  enrollments: SequenceEnrollment[];
  deals: Deal[];
  signals: EngagementSignal[];
  unsubscribes: Array<{ contactId: string; at: string; reason: string }>;
  bounces: Array<{ contactId: string; at: string; reason: string }>;
  suppressed: Map<string, string>;
}

const inRange = (at: string | null | undefined, o: { from: string; to: string }) => Boolean(at) && at! >= o.from && at! <= o.to;
const SIGNAL_TO_ENG: Record<SignalClass, EngType> = { OPEN_MACHINE: 'OPEN_MACHINE', OPEN_OBSERVED: 'OPEN_OBSERVED', CLICK_BOT: 'CLICK_BOT', CLICK_HUMAN: 'CLICK_HUMAN' };

export async function buildDataset(repo: CrmRepository, deps: AnalyticsDeps, opts: AnalyticsOptions): Promise<Dataset> {
  const contacts = new Map<string, Contact>();
  for (const c of repo.listContacts()) if (opts.canSee(c.id)) contacts.set(c.id, c);
  const seen = (id: string | null | undefined): id is string => Boolean(id) && contacts.has(id!);
  const touches: Touch[] = [];
  const events: EngEvent[] = [];
  const histFrom = new Date(Date.parse(opts.from) - ATTRIBUTION_WINDOW_DAYS * DAY).toISOString();

  // Campanhas (Fase 3): envios reais.
  const campaigns = repo.listMarketingCampaigns();
  if (deps.marketing) {
    for (const c of campaigns) {
      for (const s of await deps.marketing.listSendsByCampaign(c.id)) {
        if (!seen(s.contactId) || !s.sentAt) continue;
        touches.push({ contactId: s.contactId, channel: 'CAMPANHA', refId: c.id, refName: c.name, at: s.sentAt, simulated: false, trackingId: s.trackingId });
      }
    }
  }
  // Cadencias (Fase 2): entregas reais (stepDeliveries) e, se pedido, passos simulados.
  const sequences = new Map(repo.listSequences().map((s) => [s.id, s]));
  const enrollments = repo.listSequenceEnrollments().filter((e) => seen(e.contactId));
  for (const e of enrollments) {
    const seqName = sequences.get(e.sequenceId)?.name || e.sequenceId;
    const realSteps = new Set<number>();
    for (const d of e.stepDeliveries || []) {
      if (d.status !== 'SENT' || !d.sentAt) continue;
      realSteps.add(d.stepOrder);
      touches.push({ contactId: e.contactId, channel: 'CADENCIA', refId: e.sequenceId, refName: seqName, at: d.sentAt, simulated: false, stepOrder: d.stepOrder, enrollmentId: e.id, trackingId: d.trackingId || null, senderEmail: d.senderOwnerEmail || null });
    }
    for (const h of e.history || []) {
      if (!opts.includeSimulated) break;
      if (h.action === 'SENT' && !realSteps.has(h.stepOrder)) {
        touches.push({ contactId: e.contactId, channel: 'CADENCIA', refId: e.sequenceId, refName: seqName, at: h.timestamp, simulated: true, stepOrder: h.stepOrder, enrollmentId: e.id });
      } else if (h.action === 'OPENED' || h.action === 'CLICKED') {
        events.push({ contactId: e.contactId, at: h.timestamp, type: h.action === 'OPENED' ? 'OPEN_OBSERVED' : 'CLICK_HUMAN', simulated: true, reason: 'Interação registrada na simulação da cadência', enrollmentId: e.id });
      }
    }
    // Respostas: registro do CRM (detectada na caixa ou registrada pelo vendedor) = engajamento humano.
    const replyAt = e.repliedAt || (e.history || []).find((h) => h.action === 'REPLIED')?.timestamp || null;
    if (replyAt) {
      const r = classifyReply(e.replySnippet);
      events.push({ contactId: e.contactId, at: replyAt, type: 'REPLY', simulated: false, reason: r.reason, sentiment: r.sentiment, enrollmentId: e.id });
    }
    if ((e.status === 'MEETING_BOOKED' || e.status === 'MEETING_SCHEDULED') && e.updatedAt) {
      events.push({ contactId: e.contactId, at: e.updatedAt, type: 'MEETING', simulated: false, reason: 'Cadência marcada como reunião agendada', enrollmentId: e.id });
    }
  }
  // Sinais classificados (rastreio proprio e ESP).
  const toIso = opts.to;
  const signals = (await deps.signals.listSince(histFrom, toIso, 50000)).filter((s) => seen(s.contactId));
  for (const s of signals) {
    events.push({ contactId: s.contactId!, at: s.at, type: SIGNAL_TO_ENG[s.classification], simulated: false, reason: s.reasons.join('; '), url: s.url, trackingId: s.trackingId, campaignId: s.campaignId });
  }
  // Reunioes (linha do tempo) e formularios.
  for (const t of repo.listTimelineEvents()) {
    if (t.type === 'MEETING' && seen(t.contactId)) events.push({ contactId: t.contactId!, at: t.createdAt, type: 'MEETING', simulated: false, reason: `Reunião: ${t.title}`.slice(0, 160) });
  }
  for (const f of repo.listFormSubmissions()) {
    if (seen(f.contactId)) events.push({ contactId: f.contactId!, at: f.submittedAt, type: 'FORM', simulated: false, reason: `Formulário: ${f.formName}`.slice(0, 160) });
  }
  // Supressao (descadastro, bounce) — LGPD: so o necessario (motivo e data).
  const suppressed = new Map<string, string>();
  const unsubscribes: Dataset['unsubscribes'] = [];
  const bounces: Dataset['bounces'] = [];
  const byEmail = new Map([...contacts.values()].map((c) => [String(c.email || '').toLowerCase(), c.id]));
  for (const s of repo.listSuppressionEntries()) {
    const cid = s.contactId && contacts.has(s.contactId) ? s.contactId : byEmail.get(String(s.email || '').toLowerCase());
    if (!cid) continue;
    suppressed.set(cid, s.reason);
    if (s.reason === 'HARD_BOUNCE') bounces.push({ contactId: cid, at: s.createdAt, reason: 'Hard bounce (supressão permanente)' });
    else if (s.reason === 'UNSUBSCRIBED_MARKETING' || s.reason === 'LGPD_REVOCATION') unsubscribes.push({ contactId: cid, at: s.createdAt, reason: s.reason === 'LGPD_REVOCATION' ? 'Revogação LGPD' : 'Descadastro de marketing' });
  }
  for (const c of contacts.values()) {
    if (!suppressed.has(c.id) && c.subscriptionStatus && c.subscriptionStatus !== 'SUBSCRIBED') suppressed.set(c.id, String(c.subscriptionStatus));
  }
  if (deps.marketing) {
    for (const c of campaigns) {
      for (const s of await deps.marketing.listSendsByCampaign(c.id)) {
        if (!seen(s.contactId)) continue;
        if (s.unsubscribedAt) unsubscribes.push({ contactId: s.contactId, at: s.unsubscribedAt, reason: `Descadastro pela campanha "${c.name}"` });
        if (s.bouncedAt) bounces.push({ contactId: s.contactId, at: s.bouncedAt, reason: `Bounce na campanha "${c.name}"${s.reason ? ` (${s.reason})` : ''}` });
      }
    }
  }
  for (const e of enrollments) {
    if ((e.status === 'BOUNCED' || e.exitReasonTrigger === 'HARD_BOUNCE') && (e.exitedAt || e.updatedAt)) {
      bounces.push({ contactId: e.contactId, at: e.exitedAt || e.updatedAt, reason: `Bounce na cadência ${sequences.get(e.sequenceId)?.name || e.sequenceId}` });
    }
  }
  const deals = repo.listDeals().filter((d) => d.contactId && contacts.has(d.contactId));
  return {
    opts,
    contacts,
    touches: touches.filter((t) => opts.includeSimulated || !t.simulated),
    events: events.filter((e) => opts.includeSimulated || !e.simulated),
    enrollments,
    deals,
    signals,
    unsubscribes,
    bounces,
    suppressed,
  };
}

// ----------------------------------------------------------------------------
export interface AnswerGroup {
  key: string;
  label: string;
  count: number;
  value?: number;
  detail?: string;
}
export interface Answer {
  id: number;
  question: string;
  headline: string;
  method: string;
  groups: AnswerGroup[];
  available: boolean;
}
/** Linha do drill-down antes do mascaramento (o roteador aplica escopo/LGPD). */
export interface DrillHit {
  contactId: string;
  at: string | null;
  detail: string;
  value?: number;
}
interface Computed {
  answer: Answer;
  drill: Map<string, DrillHit[]>;
}

const fmtBrl = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const uniq = (hits: DrillHit[]) => {
  const m = new Map<string, DrillHit>();
  for (const h of hits) {
    const cur = m.get(h.contactId);
    const value = h.value === undefined && cur?.value === undefined ? undefined : (cur?.value || 0) + (h.value || 0);
    const latest = !cur || (h.at || '') > (cur.at || '') ? h : cur;
    m.set(h.contactId, { ...latest, ...(value === undefined ? {} : { value }) });
  }
  return [...m.values()];
};
function group(drill: Map<string, DrillHit[]>, key: string, label: string, hits: DrillHit[], extra: Partial<AnswerGroup> = {}): AnswerGroup {
  const u = uniq(hits);
  drill.set(key, u);
  return { key, label, count: u.length, ...extra };
}

function engagementScore(events: EngEvent[], nowMs: number): number {
  let score = 0;
  let openPts = 0;
  for (const e of events) {
    const age = Math.max(0, (nowMs - Date.parse(e.at)) / DAY);
    const decay = Math.pow(0.5, age / SCORE_HALF_LIFE_DAYS);
    let pts = 0;
    if (e.type === 'CLICK_HUMAN') pts = 3;
    else if (e.type === 'REPLY') pts = e.sentiment === 'POSITIVE' ? 10 : e.sentiment === 'NEGATIVE' ? 1 : 5;
    else if (e.type === 'MEETING') pts = 10;
    else if (e.type === 'FORM') pts = 4;
    else if (e.type === 'OPEN_OBSERVED' && openPts < 2) {
      pts = 0.5;
      openPts += 0.5;
    }
    score += pts * decay;
  }
  return Math.round(score * 10) / 10;
}

/** Negocios criados para o contato ate N dias depois do toque (influencia). */
function dealsAfter(ds: Dataset, contactId: string, atIso: string): Deal[] {
  const t = Date.parse(atIso);
  return ds.deals.filter((d) => d.contactId === contactId && Date.parse(d.createdAt) >= t && Date.parse(d.createdAt) - t <= ATTRIBUTION_WINDOW_DAYS * DAY);
}

export function computeAnswers(repo: CrmRepository, ds: Dataset): Computed[] {
  const o = ds.opts;
  const out: Computed[] = [];
  const add = (id: number, headline: string, method: string, build: (drill: Map<string, DrillHit[]>) => AnswerGroup[], available = true) => {
    const drill = new Map<string, DrillHit[]>();
    const groups = available ? build(drill) : [];
    out.push({ answer: { id, question: ANALYTICS_QUESTIONS[id - 1].question, headline, method, groups, available }, drill });
  };
  const periodTouches = ds.touches.filter((t) => inRange(t.at, o));
  const periodEvents = ds.events.filter((e) => inRange(e.at, o));
  const toMs = Date.parse(o.to);
  const contactsWith = (pred: (e: EngEvent) => boolean, list = periodEvents) => new Set(list.filter(pred).map((e) => e.contactId));

  // 1
  {
    const byRef = new Map<string, Touch[]>();
    for (const t of periodTouches) byRef.set(`${t.channel}:${t.refId}`, [...(byRef.get(`${t.channel}:${t.refId}`) || []), t]);
    const n = new Set(periodTouches.map((t) => t.contactId)).size;
    add(1, `${n} contato(s) receberam e-mails no período`, 'Envios reais de campanhas (Fase 3) e passos de cadência enviados (Fase 2). E-mails avulsos da caixa não entram.', (d) => [
      group(d, 'ALL', 'Todos', periodTouches.map((t) => ({ contactId: t.contactId, at: t.at, detail: `${t.channel === 'CAMPANHA' ? 'Campanha' : 'Cadência'}: ${t.refName}${t.simulated ? ' (simulado)' : ''}` }))),
      ...[...byRef.entries()].map(([k, ts]) => group(d, k, `${ts[0].channel === 'CAMPANHA' ? 'Campanha' : 'Cadência'}: ${ts[0].refName}`, ts.map((t) => ({ contactId: t.contactId, at: t.at, detail: t.stepOrder ? `Passo ${t.stepOrder}` : 'Envio' })))),
    ]);
  }
  // 2
  {
    const obs = periodEvents.filter((e) => e.type === 'OPEN_OBSERVED');
    const mach = periodEvents.filter((e) => e.type === 'OPEN_MACHINE');
    const obsSet = new Set(obs.map((e) => e.contactId));
    add(2, `${obsSet.size} com abertura observada; ${new Set(mach.map((e) => e.contactId)).size} com abertura automática (proxy/MPP). Abertura não prova leitura.`, 'Pixel de rastreio classificado: proxies de imagem, Apple MPP (user-agent genérico ou IP Apple) e pré-carregamento logo após o envio contam como automáticas.', (d) => [
      group(d, 'OPEN_OBSERVED', 'Abertura observada', obs.map((e) => ({ contactId: e.contactId, at: e.at, detail: e.reason }))),
      group(d, 'OPEN_MACHINE_ONLY', 'Só abertura automática', mach.filter((e) => !obsSet.has(e.contactId)).map((e) => ({ contactId: e.contactId, at: e.at, detail: e.reason }))),
    ]);
  }
  // 3
  {
    const hum = periodEvents.filter((e) => e.type === 'CLICK_HUMAN');
    const bot = periodEvents.filter((e) => e.type === 'CLICK_BOT');
    const humSet = new Set(hum.map((e) => e.contactId));
    add(3, `${humSet.size} com clique humano provável; ${new Set(bot.map((e) => e.contactId)).size} só com cliques de robô/scanner`, 'Clique classificado por user-agent, faixas de IP de scanners, tempo desde o envio e rajada de cliques.', (d) => [
      group(d, 'CLICK_HUMAN', 'Clique humano provável', hum.map((e) => ({ contactId: e.contactId, at: e.at, detail: e.url || e.reason }))),
      group(d, 'CLICK_BOT_ONLY', 'Só cliques de robô/scanner', bot.filter((e) => !humSet.has(e.contactId)).map((e) => ({ contactId: e.contactId, at: e.at, detail: e.reason }))),
    ]);
  }
  // 4
  {
    const clicks = periodEvents.filter((e) => (e.type === 'CLICK_HUMAN' || e.type === 'CLICK_BOT') && e.url);
    const byUrl = new Map<string, EngEvent[]>();
    for (const e of clicks) byUrl.set(e.url!, [...(byUrl.get(e.url!) || []), e]);
    add(4, `${byUrl.size} link(s) clicado(s) no período`, 'Destino gravado no envio (o clique redireciona só para ele). Contagem humana e de robôs separadas; o drill-down lista quem clicou como humano.', (d) =>
      [...byUrl.entries()]
        .map(([url, es]) => {
          const h = es.filter((e) => e.type === 'CLICK_HUMAN');
          return group(d, `url:${url}`, url, h.map((e) => ({ contactId: e.contactId, at: e.at, detail: url })), { detail: `${h.length} clique(s) humano(s), ${es.length - h.length} de robô` });
        })
        .sort((a, b) => b.count - a.count)
    );
  }
  // 5, 6
  {
    const rep = periodEvents.filter((e) => e.type === 'REPLY');
    add(5, `${new Set(rep.map((e) => e.contactId)).size} contato(s) responderam`, 'Respostas detectadas na caixa do vendedor ou registradas na cadência.', (d) => [
      group(d, 'ALL', 'Responderam', rep.map((e) => ({ contactId: e.contactId, at: e.at, detail: e.reason }))),
      group(d, 'POSITIVE', 'Positivas', rep.filter((e) => e.sentiment === 'POSITIVE').map((e) => ({ contactId: e.contactId, at: e.at, detail: e.reason }))),
      group(d, 'NEGATIVE', 'Negativas', rep.filter((e) => e.sentiment === 'NEGATIVE').map((e) => ({ contactId: e.contactId, at: e.at, detail: e.reason }))),
      group(d, 'NEUTRAL', 'Neutras', rep.filter((e) => e.sentiment === 'NEUTRAL').map((e) => ({ contactId: e.contactId, at: e.at, detail: e.reason }))),
    ]);
    const pos = rep.filter((e) => e.sentiment === 'POSITIVE');
    add(6, `${new Set(pos.map((e) => e.contactId)).size} resposta(s) positiva(s)`, 'Classificação por termos de interesse ou recusa no texto da resposta; o motivo fica registrado. Revise antes de agir.', (d) => [
      group(d, 'POSITIVE', 'Positivas', pos.map((e) => ({ contactId: e.contactId, at: e.at, detail: e.reason }))),
    ]);
  }
  // 7
  {
    const touched = new Set(ds.touches.filter((t) => t.at <= o.to).map((t) => t.contactId));
    const engaged = contactsWith(isHuman, ds.events.filter((e) => e.at <= o.to));
    const never = [...touched].filter((c) => !engaged.has(c));
    add(7, `${never.length} contato(s) receberam e-mails e nunca demonstraram engajamento humano`, 'Recebeu ao menos um e-mail e não tem clique humano, resposta, reunião nem formulário. Aberturas não contam.', (d) => [
      group(d, 'NEVER', 'Sem engajamento observável', never.map((c) => ({ contactId: c, at: null, detail: ds.events.some((e) => e.contactId === c && e.type.startsWith('OPEN')) ? 'Só aberturas registradas' : 'Nenhum sinal' }))),
    ]);
  }
  // 8
  {
    const since = new Date(toMs - RECENT_DAYS * DAY).toISOString();
    const rec = ds.events.filter((e) => isHuman(e) && e.at >= since && e.at <= o.to);
    add(8, `${new Set(rec.map((e) => e.contactId)).size} contato(s) com engajamento humano nos últimos ${RECENT_DAYS} dias`, 'Clique humano, resposta, reunião ou formulário recentes.', (d) => [
      group(d, 'RECENT', `Últimos ${RECENT_DAYS} dias`, rec.map((e) => ({ contactId: e.contactId, at: e.at, detail: e.reason }))),
    ]);
  }
  // 9, 10
  {
    const exited = ds.enrollments.filter((e) => inRange(e.exitedAt, o));
    const seqName = new Map(repo.listSequences().map((s) => [s.id, s.name]));
    add(9, `${new Set(exited.map((e) => e.contactId)).size} contato(s) saíram de cadências`, 'Inscrições com data de saída no período.', (d) => [
      group(d, 'ALL', 'Saíram', exited.map((e) => ({ contactId: e.contactId, at: e.exitedAt!, detail: `${seqName.get(e.sequenceId) || e.sequenceId}: ${EXIT_REASON_LABELS[String(e.exitReasonTrigger)] || e.exitReasonTrigger || 'sem motivo'}` }))),
    ]);
    const byReason = new Map<string, SequenceEnrollment[]>();
    for (const e of exited) byReason.set(String(e.exitReasonTrigger || 'SEM_MOTIVO'), [...(byReason.get(String(e.exitReasonTrigger || 'SEM_MOTIVO')) || []), e]);
    add(10, `${byReason.size} motivo(s) de saída`, 'Regra de saída registrada na inscrição (exitReasonTrigger) e o detalhe gravado.', (d) =>
      [...byReason.entries()].map(([k, es]) => group(d, k, EXIT_REASON_LABELS[k] || (k === 'SEM_MOTIVO' ? 'Sem motivo registrado' : k), es.map((e) => ({ contactId: e.contactId, at: e.exitedAt!, detail: e.exitReasonDetail || '' })))).sort((a, b) => b.count - a.count)
    );
  }
  // 11, 12
  {
    const un = ds.unsubscribes.filter((u) => inRange(u.at, o));
    add(11, `${new Set(un.map((u) => u.contactId)).size} pedido(s) de descadastro`, 'Lista de supressão (descadastro/revogação LGPD) e descadastros pelas campanhas. Só motivo e data.', (d) => [
      group(d, 'ALL', 'Descadastros', un.map((u) => ({ contactId: u.contactId, at: u.at, detail: u.reason }))),
    ]);
    const bo = ds.bounces.filter((b) => inRange(b.at, o));
    add(12, `${new Set(bo.map((b) => b.contactId)).size} contato(s) bloqueados por bounce`, 'Hard bounce (supressão permanente), bounces das campanhas e cadências encerradas por bounce.', (d) => [
      group(d, 'ALL', 'Bounces', bo.map((b) => ({ contactId: b.contactId, at: b.at, detail: b.reason }))),
    ]);
  }
  // 13
  {
    const m = periodEvents.filter((e) => e.type === 'MEETING');
    add(13, `${new Set(m.map((e) => e.contactId)).size} contato(s) com reunião agendada`, 'Reuniões na linha do tempo do contato e cadências marcadas como reunião agendada.', (d) => [
      group(d, 'ALL', 'Reunião agendada', m.map((e) => ({ contactId: e.contactId, at: e.at, detail: e.reason }))),
    ]);
  }
  // 14
  {
    const byC = new Map<string, EngEvent[]>();
    for (const e of periodEvents) byC.set(e.contactId, [...(byC.get(e.contactId) || []), e]);
    const scored = [...byC.entries()].map(([c, es]) => ({ c, s: engagementScore(es, toMs), es })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    add(14, scored.length ? `${scored.length} contato(s) com interesse; maior pontuação ${scored[0].s}` : 'Nenhum contato com interesse no período', 'Pontuação: clique humano 3, resposta 5 (positiva 10, negativa 1), reunião 10, formulário 4, abertura observada 0,5 (máx. 2). Meia-vida de 30 dias. Aberturas automáticas e cliques de robô valem 0.', (d) => [
      group(d, 'HIGH', 'Alto interesse (10+)', scored.filter((x) => x.s >= 10).map((x) => ({ contactId: x.c, at: x.es[x.es.length - 1]?.at || null, detail: `Pontuação ${x.s}`, value: x.s }))),
      group(d, 'MEDIUM', 'Interesse moderado (3 a 10)', scored.filter((x) => x.s >= 3 && x.s < 10).map((x) => ({ contactId: x.c, at: x.es[x.es.length - 1]?.at || null, detail: `Pontuação ${x.s}`, value: x.s }))),
      group(d, 'LOW', 'Pouco interesse (< 3)', scored.filter((x) => x.s < 3).map((x) => ({ contactId: x.c, at: x.es[x.es.length - 1]?.at || null, detail: `Pontuação ${x.s}`, value: x.s }))),
    ]);
  }
  // 15, 16, 18, 19 (influencia/atribuicao)
  const perRef = (channel: Channel) => {
    const m = new Map<string, Touch[]>();
    for (const t of periodTouches.filter((x) => x.channel === channel)) m.set(t.refId, [...(m.get(t.refId) || []), t]);
    return m;
  };
  {
    const groups = (d: Map<string, DrillHit[]>, channel: Channel) =>
      [...perRef(channel).entries()]
        .map(([ref, ts]) => {
          const hits: DrillHit[] = [];
          const dealIds = new Set<string>();
          for (const t of ts) for (const deal of dealsAfter(ds, t.contactId, t.at)) {
            if (dealIds.has(deal.id)) continue;
            dealIds.add(deal.id);
            hits.push({ contactId: t.contactId, at: deal.createdAt, detail: `Oportunidade "${deal.title}" (${fmtBrl(deal.value || 0)})`, value: deal.value || 0 });
          }
          return group(d, `${channel}:${ref}`, ts[0].refName, hits, { value: hits.reduce((s, h) => s + (h.value || 0), 0), detail: `${dealIds.size} oportunidade(s)` });
        })
        .sort((a, b) => (b.value || 0) - (a.value || 0));
    add(15, 'Campanhas com oportunidades criadas até 90 dias após o envio', `Influência: oportunidade do contato criada até ${ATTRIBUTION_WINDOW_DAYS} dias depois de um envio da campanha. Somente leitura.`, (d) => groups(d, 'CAMPANHA'));
    add(18, 'Cadências com oportunidades criadas até 90 dias após o envio', `Influência: oportunidade do contato criada até ${ATTRIBUTION_WINDOW_DAYS} dias depois de um passo enviado da cadência.`, (d) => groups(d, 'CADENCIA'));
  }
  {
    const contracts = o.erpAllowed ? repo.listRentalContracts() : [];
    add(
      16,
      o.erpAllowed ? 'Campanhas com contratos de locação iniciados até 90 dias após o envio' : 'Requer acesso ao ERP',
      'Contrato do contato (ou do negócio influenciado) com início até 90 dias depois do envio. Leitura do ERP sem gerar nada; visível só para quem tem acesso ao ERP.',
      (d) =>
        [...perRef('CAMPANHA').entries()]
          .map(([ref, ts]) => {
            const hits: DrillHit[] = [];
            const seenC = new Set<string>();
            for (const t of ts) {
              const dealIds = new Set(dealsAfter(ds, t.contactId, t.at).map((x) => x.id));
              const tms = Date.parse(t.at);
              for (const c of contracts) {
                const start = Date.parse(c.startDate || (c as { createdAt?: string }).createdAt || '');
                const linked = c.contactId === t.contactId || (c.dealId && dealIds.has(c.dealId));
                if (!linked || seenC.has(c.id) || !(start >= tms && start - tms <= ATTRIBUTION_WINDOW_DAYS * DAY)) continue;
                seenC.add(c.id);
                hits.push({ contactId: t.contactId, at: c.startDate, detail: `Contrato ${c.contractNumber} (${fmtBrl(c.monthlyValue || 0)}/mês)`, value: c.monthlyValue || 0 });
              }
            }
            return group(d, `CAMPANHA:${ref}`, ts[0].refName, hits, { value: hits.reduce((s, h) => s + (h.value || 0), 0), detail: `${seenC.size} contrato(s), valor mensal` });
          })
          .sort((a, b) => (b.value || 0) - (a.value || 0)),
      o.erpAllowed
    );
  }
  // 17
  {
    const bySeller = new Map<string, { enrolled: Set<string>; replied: Set<string>; hitsAll: DrillHit[] }>();
    const tByEnr = new Map<string, Touch[]>();
    for (const t of periodTouches) if (t.enrollmentId) tByEnr.set(t.enrollmentId, [...(tByEnr.get(t.enrollmentId) || []), t]);
    for (const e of ds.enrollments) {
      const ts = tByEnr.get(e.id);
      if (!ts) continue;
      const c = ds.contacts.get(e.contactId);
      const seller = String(ts.find((t) => t.senderEmail)?.senderEmail || c?.ownerName || 'Sem vendedor');
      const g = bySeller.get(seller) || { enrolled: new Set(), replied: new Set(), hitsAll: [] };
      g.enrolled.add(e.contactId);
      const rep = periodEvents.find((x) => x.type === 'REPLY' && x.enrollmentId === e.id);
      if (rep) {
        g.replied.add(e.contactId);
        g.hitsAll.push({ contactId: e.contactId, at: rep.at, detail: rep.reason });
      }
      bySeller.set(seller, g);
    }
    add(17, 'Taxa de resposta por vendedor (cadências)', 'Contatos que responderam / contatos que receberam passos da cadência no período, por caixa remetente (ou proprietário do contato nos registros simulados).', (d) =>
      [...bySeller.entries()]
        .map(([s, g]) => group(d, `seller:${s}`, s, g.hitsAll, { value: g.enrolled.size ? Math.round((g.replied.size / g.enrolled.size) * 1000) / 10 : 0, detail: `${g.replied.size}/${g.enrolled.size} responderam` }))
        .sort((a, b) => (b.value || 0) - (a.value || 0))
    );
  }
  // 19
  {
    const won = ds.deals.filter((dd) => dd.status === 'WON' && inRange(dd.closedAt || dd.updatedAt, o));
    const agg = new Map<string, { label: string; attributed: number; influenced: number; deals: Set<string>; hits: DrillHit[] }>();
    for (const deal of won) {
      const end = Date.parse(deal.closedAt || deal.updatedAt);
      const ts = ds.touches.filter((t) => t.contactId === deal.contactId && Date.parse(t.at) <= end && end - Date.parse(t.at) <= ATTRIBUTION_WINDOW_DAYS * DAY);
      const refs = new Map(ts.map((t) => [`${t.channel}:${t.refId}`, t]));
      if (!refs.size) continue;
      const share = (deal.value || 0) / refs.size;
      for (const [k, t] of refs) {
        const a = agg.get(k) || { label: `${t.channel === 'CAMPANHA' ? 'Campanha' : 'Cadência'}: ${t.refName}`, attributed: 0, influenced: 0, deals: new Set<string>(), hits: [] };
        a.attributed += share;
        a.influenced += deal.value || 0;
        a.deals.add(deal.id);
        a.hits.push({ contactId: deal.contactId!, at: deal.closedAt || deal.updatedAt, detail: `Ganho "${deal.title}" ${fmtBrl(deal.value || 0)} dividido entre ${refs.size} toque(s)`, value: share });
        agg.set(k, a);
      }
    }
    const total = [...agg.values()].reduce((s, a) => s + a.attributed, 0);
    add(19, `${fmtBrl(total)} atribuídos a campanhas e cadências`, `Modelo linear: cada negócio ganho no período tem o valor dividido igualmente entre as campanhas/cadências que tocaram o contato nos ${ATTRIBUTION_WINDOW_DAYS} dias antes do fechamento. "Influenciada" = valor total dos negócios tocados. Somente leitura; fatura/NF não entram.`, (d) =>
      [...agg.entries()].map(([k, a]) => group(d, k, a.label, a.hits, { value: Math.round(a.attributed * 100) / 100, detail: `${a.deals.size} negócio(s); influenciada ${fmtBrl(a.influenced)}` })).sort((a, b) => (b.value || 0) - (a.value || 0))
    );
  }
  // 20
  {
    const recentFrom = toMs - LOSING_RECENT_DAYS * DAY;
    const prevFrom = toMs - ATTRIBUTION_WINDOW_DAYS * DAY;
    const prev = new Map<string, string>();
    const recent = new Set<string>();
    for (const e of ds.events) {
      if (!isHuman(e)) continue;
      const t = Date.parse(e.at);
      if (t >= recentFrom && t <= toMs) recent.add(e.contactId);
      else if (t >= prevFrom && t < recentFrom && (prev.get(e.contactId) || '') < e.at) prev.set(e.contactId, e.at);
    }
    const losing = [...prev.entries()].filter(([c]) => !recent.has(c));
    add(20, `${losing.length} contato(s) perdendo engajamento`, `Tinham engajamento humano entre ${ATTRIBUTION_WINDOW_DAYS} e ${LOSING_RECENT_DAYS} dias atrás e nenhum nos últimos ${LOSING_RECENT_DAYS} dias.`, (d) => [
      group(d, 'LOSING', 'Perdendo engajamento', losing.map(([c, at]) => ({ contactId: c, at, detail: `Último engajamento humano em ${at.slice(0, 10)}` }))),
    ]);
  }
  return out.sort((a, b) => a.answer.id - b.answer.id);
}

// ----------------------------------------------------------------------------
// Contadores separados (abertura observada x automatica, clique humano x robo)
// ----------------------------------------------------------------------------
export function engagementCounters(ds: Dataset) {
  const ev = ds.events.filter((e) => inRange(e.at, ds.opts));
  const n = (t: EngType) => ev.filter((e) => e.type === t).length;
  const u = (t: EngType) => new Set(ev.filter((e) => e.type === t).map((e) => e.contactId)).size;
  const reasons = new Map<string, number>();
  for (const s of ds.signals.filter((x) => inRange(x.at, ds.opts))) for (const r of s.reasons) {
    const k = `${s.classification}|${r.replace(/\d+s/g, 'Ns')}`;
    reasons.set(k, (reasons.get(k) || 0) + 1);
  }
  return {
    sent: ds.touches.filter((t) => inRange(t.at, ds.opts)).length,
    opensObserved: n('OPEN_OBSERVED'),
    opensMachine: n('OPEN_MACHINE'),
    uniqueOpensObserved: u('OPEN_OBSERVED'),
    clicksHuman: n('CLICK_HUMAN'),
    clicksBot: n('CLICK_BOT'),
    uniqueClicksHuman: u('CLICK_HUMAN'),
    replies: n('REPLY'),
    positiveReplies: ev.filter((e) => e.type === 'REPLY' && e.sentiment === 'POSITIVE').length,
    meetings: n('MEETING'),
    forms: n('FORM'),
    humanConfirmedContacts: new Set(ev.filter(isHuman).map((e) => e.contactId)).size,
    classificationReasons: [...reasons.entries()].map(([k, count]) => ({ classification: k.split('|')[0], reason: k.split('|')[1], count })).sort((a, b) => b.count - a.count).slice(0, 30),
  };
}

// ----------------------------------------------------------------------------
// Conversao por passo de cadencia
// ----------------------------------------------------------------------------
export function sequenceStepReport(repo: CrmRepository, ds: Dataset) {
  const out: Array<{ sequenceId: string; sequenceName: string; steps: Array<{ stepOrder: number; subject: string; sent: number; opensObserved: number; opensMachine: number; clicksHuman: number; clicksBot: number; replies: number; exits: number; opportunities: number; replyRate: number; humanClickRate: number }> }> = [];
  const byTracking = new Map<string, EngEvent[]>();
  for (const e of ds.events) if (e.trackingId) byTracking.set(e.trackingId, [...(byTracking.get(e.trackingId) || []), e]);
  for (const seq of repo.listSequences()) {
    const touches = ds.touches.filter((t) => t.channel === 'CADENCIA' && t.refId === seq.id && inRange(t.at, ds.opts));
    if (!touches.length) continue;
    const steps = new Map<number, ReturnType<typeof emptyStep>>();
    function emptyStep(order: number) {
      return { stepOrder: order, subject: seq.steps.find((s) => s.stepOrder === order)?.subject || '', sent: 0, opensObserved: 0, opensMachine: 0, clicksHuman: 0, clicksBot: 0, replies: 0, exits: 0, opportunities: 0, replyRate: 0, humanClickRate: 0 };
    }
    const get = (o: number) => {
      if (!steps.has(o)) steps.set(o, emptyStep(o));
      return steps.get(o)!;
    };
    const byEnr = new Map<string, Touch[]>();
    for (const t of touches) byEnr.set(t.enrollmentId!, [...(byEnr.get(t.enrollmentId!) || []), t]);
    for (const [enrId, ts] of byEnr) {
      ts.sort((a, b) => a.at.localeCompare(b.at));
      const enr = ds.enrollments.find((e) => e.id === enrId);
      /** Passo "vigente" num instante = ultimo passo enviado antes dele. */
      const stepAt = (iso: string) => [...ts].reverse().find((t) => t.at <= iso)?.stepOrder;
      for (const t of ts) {
        const s = get(t.stepOrder || 0);
        s.sent++;
        const evs = t.trackingId ? byTracking.get(t.trackingId) || [] : [];
        if (evs.some((e) => e.type === 'OPEN_OBSERVED')) s.opensObserved++;
        else if (evs.some((e) => e.type === 'OPEN_MACHINE')) s.opensMachine++;
        if (evs.some((e) => e.type === 'CLICK_HUMAN')) s.clicksHuman++;
        else if (evs.some((e) => e.type === 'CLICK_BOT')) s.clicksBot++;
      }
      // Simulados: interacoes sem trackingId, atribuidas ao passo vigente.
      for (const e of ds.events.filter((x) => x.enrollmentId === enrId && x.simulated)) {
        const o = stepAt(e.at);
        if (o === undefined) continue;
        if (e.type === 'OPEN_OBSERVED') get(o).opensObserved++;
        if (e.type === 'CLICK_HUMAN') get(o).clicksHuman++;
      }
      const rep = ds.events.find((x) => x.type === 'REPLY' && x.enrollmentId === enrId);
      if (rep) {
        const o = stepAt(rep.at);
        if (o !== undefined) get(o).replies++;
      }
      if (enr?.exitedAt) {
        const o = stepAt(enr.exitedAt);
        if (o !== undefined) get(o).exits++;
      }
      const firstDeal = dealsAfter(ds, ts[0].contactId, ts[0].at)[0];
      if (firstDeal) {
        const o = stepAt(firstDeal.createdAt);
        if (o !== undefined) get(o).opportunities++;
      }
    }
    const list = [...steps.values()].sort((a, b) => a.stepOrder - b.stepOrder);
    for (const s of list) {
      s.replyRate = s.sent ? Math.round((s.replies / s.sent) * 1000) / 10 : 0;
      s.humanClickRate = s.sent ? Math.round((s.clicksHuman / s.sent) * 1000) / 10 : 0;
    }
    out.push({ sequenceId: seq.id, sequenceName: seq.name, steps: list });
  }
  return out;
}

// ----------------------------------------------------------------------------
// Caminhos A/B e divisoes das automacoes (Fase 4)
// ----------------------------------------------------------------------------
export async function workflowVariantReport(ds: Dataset, workflows: WorkflowStore | null | undefined) {
  if (!workflows) return [];
  const out: Array<{ workflowId: string; workflowName: string; nodeId: string; nodeLabel: string; kind: string; variants: Array<{ id: string; label: string; percent: number; runs: number; completed: number; humanEngaged: number; opportunities: number; wonValue: number; humanRate: number; opportunityRate: number }> }> = [];
  for (const def of await workflows.listDefinitions()) {
    const runs = (await workflows.listRunsByWorkflow(def.id, 5000)).filter((r) => ds.contacts.has(r.contactId) && inRange(r.startedAt, ds.opts));
    const versions = new Map<number, Awaited<ReturnType<WorkflowStore['getVersion']>>>();
    for (const r of runs) if (!versions.has(r.version)) versions.set(r.version, await workflows.getVersion(def.id, r.version));
    const nodes = new Map<string, { label: string; kind: string; variants: Map<string, { label: string; percent: number }> }>();
    for (const v of versions.values()) for (const n of v?.graph.nodes || []) {
      if (n.action !== 'AB_TEST' && n.action !== 'PERCENT_SPLIT') continue;
      const cur = nodes.get(n.id) || { label: n.label || (n.action === 'AB_TEST' ? 'Teste A/B' : 'Divisão percentual'), kind: n.action, variants: new Map() };
      for (const vv of (n.config.variants || []) as Array<{ id: string; label: string; percent: number }>) cur.variants.set(vv.id, { label: vv.label, percent: vv.percent });
      nodes.set(n.id, cur);
    }
    for (const [nodeId, n] of nodes) {
      const vs = [...n.variants.entries()].map(([id, meta]) => {
        const rs = runs.filter((r) => r.variants?.[nodeId] === id);
        let human = 0;
        let opp = 0;
        let won = 0;
        for (const r of rs) {
          const st = Date.parse(r.startedAt);
          if (ds.events.some((e) => e.contactId === r.contactId && isHuman(e) && Date.parse(e.at) >= st && Date.parse(e.at) - st <= ATTRIBUTION_WINDOW_DAYS * DAY)) human++;
          const deals = dealsAfter(ds, r.contactId, r.startedAt);
          if (deals.length) opp++;
          won += deals.filter((x) => x.status === 'WON').reduce((s, x) => s + (x.value || 0), 0);
        }
        return { id, label: meta.label, percent: meta.percent, runs: rs.length, completed: rs.filter((r) => r.status === 'COMPLETED').length, humanEngaged: human, opportunities: opp, wonValue: won, humanRate: rs.length ? Math.round((human / rs.length) * 1000) / 10 : 0, opportunityRate: rs.length ? Math.round((opp / rs.length) * 1000) / 10 : 0 };
      });
      out.push({ workflowId: def.id, workflowName: def.name, nodeId, nodeLabel: n.label, kind: n.kind, variants: vs });
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// Coortes: mes do primeiro envio -> % com engajamento humano / oportunidade por mes seguinte
// ----------------------------------------------------------------------------
const monthKey = (iso: string) => {
  const d = new Date(Date.parse(iso) - 3 * 3600000); // America/Sao_Paulo (UTC-3, sem horario de verao)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const monthDiff = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5)) - Number(a.slice(5));

export function cohortReport(ds: Dataset, months = 6) {
  const first = new Map<string, string>();
  for (const t of ds.touches) if (t.at <= ds.opts.to && (!first.has(t.contactId) || t.at < first.get(t.contactId)!)) first.set(t.contactId, t.at);
  const cohorts = new Map<string, string[]>();
  for (const [c, at] of first) if (at >= ds.opts.from) cohorts.set(monthKey(at), [...(cohorts.get(monthKey(at)) || []), c]);
  return [...cohorts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, members]) => {
      const engagedBy = Array.from({ length: months }, () => 0);
      const oppBy = Array.from({ length: months }, () => 0);
      for (const c of members) {
        const ev = ds.events.filter((e) => e.contactId === c && isHuman(e));
        const firstEng = ev.map((e) => monthDiff(month, monthKey(e.at))).filter((m) => m >= 0).sort((a, b) => a - b)[0];
        const firstOpp = ds.deals.filter((d) => d.contactId === c && d.createdAt >= first.get(c)!).map((d) => monthDiff(month, monthKey(d.createdAt))).sort((a, b) => a - b)[0];
        for (let m = 0; m < months; m++) {
          if (firstEng !== undefined && firstEng <= m) engagedBy[m]++;
          if (firstOpp !== undefined && firstOpp <= m) oppBy[m]++;
        }
      }
      const pct = (n: number) => Math.round((n / members.length) * 1000) / 10;
      return { cohort: month, size: members.length, humanEngagedPct: engagedBy.map(pct), opportunityPct: oppBy.map(pct) };
    });
}
