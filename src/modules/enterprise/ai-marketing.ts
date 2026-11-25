// ============================================================================
// STI-hub — Fase 6: IA comercial e de marketing (reaproveita o provedor do Assistente: OmniRoute,
// API compativel com a OpenAI; OMNIROUTE_BASE_URL / OMNIROUTE_API_KEY).
//  - Sugestoes de assunto, texto e proximo passo; resumo de engajamento por conta.
//  - Sempre com nivel de confianca (o menor entre o declarado pelo modelo e o volume de dados) e
//    evidencias (quais dados agregados embasaram), calculadas AQUI, nunca pelo modelo.
//  - Aprovacao humana obrigatoria: a IA nao envia, nao agenda e nao altera nada. A sugestao fica
//    "aguardando aprovacao"; so depois de aprovada a tela libera copiar o texto.
//  - Minimizacao (LGPD): ao provedor vao so agregados e campos de negocio (cargo, etapa, setor);
//    nunca nome, e-mail, telefone, notas ou texto de respostas. Contato suprimido: so o fato da
//    supressao, sem historico de engajamento. Textos livres passam por remocao de e-mail/telefone/CPF/CNPJ.
//  - Interruptor AI_MARKETING_ENABLED (desligado por padrao).
// ============================================================================
import crypto from 'node:crypto';
import type { CrmRepository } from '../../db/repository';
import { getPostgresPool, isPostgresEnabled, type PgQueryable } from '../../db/postgres';
import type { LlmClient } from '../assistente/omniroute-client';
import type { MarketingStore } from '../marketing/marketing-store';
import { MARKETING_PURPOSE_LABELS, isMarketingPurpose } from '../marketing/marketing-config';
import type { SignalStore } from '../analytics/signal-store';
import { classifyReply } from '../analytics/signal-classifier';
import { runGuardedDdl } from '../../db/schema-guard';

export type AiKind = 'SUBJECT' | 'COPY' | 'NEXT_STEP' | 'ACCOUNT_SUMMARY';
export const AI_KIND_LABELS: Record<AiKind, string> = {
  SUBJECT: 'Sugestões de assunto',
  COPY: 'Sugestões de texto',
  NEXT_STEP: 'Próximo passo comercial',
  ACCOUNT_SUMMARY: 'Resumo de engajamento da conta',
};
export type AiStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';

export function isAiMarketingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AI_MARKETING_ENABLED || '').trim().toLowerCase() === 'true';
}

export interface AiEvidence {
  key: string;
  label: string;
  value: string;
}

export interface AiSuggestion {
  id: string;
  kind: AiKind;
  status: AiStatus;
  target: { type: 'TEMPLATE' | 'BRIEF' | 'CONTACT' | 'COMPANY'; id: string | null };
  items: Array<{ text: string; rationale: string }>;
  summary: string | null;
  confidence: number;
  confidenceLevel: 'ALTA' | 'MEDIA' | 'BAIXA';
  modelConfidence: number | null;
  dataConfidence: number;
  evidence: AiEvidence[];
  basedOn: string[];
  caveats: string[];
  model: string;
  createdBy: string;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

// ----------------------------------------------------------------------------
// Armazenamento (ai_marketing_suggestions)
// ----------------------------------------------------------------------------
export interface AiSuggestionStore {
  save(s: AiSuggestion): Promise<void>;
  get(id: string): Promise<AiSuggestion | null>;
  list(filter: { createdBy?: string; limit: number }): Promise<AiSuggestion[]>;
  transition(id: string, from: AiStatus[], patch: Partial<AiSuggestion>): Promise<AiSuggestion | null>;
}
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
export class MemoryAiSuggestionStore implements AiSuggestionStore {
  items = new Map<string, AiSuggestion>();
  async save(s: AiSuggestion) {
    this.items.set(s.id, clone(s));
  }
  async get(id: string) {
    const s = this.items.get(id);
    return s ? clone(s) : null;
  }
  async list(f: { createdBy?: string; limit: number }) {
    return [...this.items.values()].filter((s) => !f.createdBy || s.createdBy === f.createdBy).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, f.limit).map(clone);
  }
  async transition(id: string, from: AiStatus[], patch: Partial<AiSuggestion>) {
    const cur = this.items.get(id);
    if (!cur || !from.includes(cur.status)) return null;
    const next = { ...cur, ...clone(patch), id: cur.id };
    this.items.set(id, next);
    return clone(next);
  }
}
export const AI_TABLES_DDL = `
CREATE TABLE IF NOT EXISTS ai_marketing_suggestions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_marketing_suggestions_owner_idx ON ai_marketing_suggestions (created_by, created_at DESC);
`;
export class PostgresAiSuggestionStore implements AiSuggestionStore {
  private ready: Promise<void> | null = null;
  constructor(private readonly pool: PgQueryable) {}
  private async db(): Promise<PgQueryable> {
    if (!this.ready) {
      this.ready = runGuardedDdl(this.pool, AI_TABLES_DDL).then(() => undefined);
      this.ready.catch(() => {
        this.ready = null;
      });
    }
    await this.ready;
    return this.pool;
  }
  async save(s: AiSuggestion) {
    await (await this.db()).query(
      `INSERT INTO ai_marketing_suggestions (id, kind, status, created_by, created_at, data) VALUES ($1, $2, $3, $4, $5::timestamptz, $6::jsonb)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, data = EXCLUDED.data`,
      [s.id, s.kind, s.status, s.createdBy, s.createdAt, JSON.stringify(s)]
    );
  }
  async get(id: string) {
    const r = await (await this.db()).query(`SELECT data FROM ai_marketing_suggestions WHERE id = $1`, [id]);
    return (r.rows[0]?.data as AiSuggestion) || null;
  }
  async list(f: { createdBy?: string; limit: number }) {
    const lim = Math.max(1, Math.min(f.limit, 200));
    const r = f.createdBy
      ? await (await this.db()).query(`SELECT data FROM ai_marketing_suggestions WHERE created_by = $1 ORDER BY created_at DESC LIMIT $2::int`, [f.createdBy, lim])
      : await (await this.db()).query(`SELECT data FROM ai_marketing_suggestions ORDER BY created_at DESC LIMIT $1::int`, [lim]);
    return r.rows.map((x: { data: AiSuggestion }) => x.data);
  }
  async transition(id: string, from: AiStatus[], patch: Partial<AiSuggestion>) {
    const safe = { ...patch } as Record<string, unknown>;
    delete safe.id;
    const r = await (await this.db()).query(
      `UPDATE ai_marketing_suggestions SET data = data || $3::jsonb, status = COALESCE($3::jsonb->>'status', status)
       WHERE id = $1 AND status = ANY($2::text[]) RETURNING data`,
      [id, from, JSON.stringify(safe)]
    );
    return (r.rows[0]?.data as AiSuggestion) || null;
  }
}
let defaultStore: AiSuggestionStore | null = null;
export function getDefaultAiSuggestionStore(): AiSuggestionStore {
  if (!defaultStore) {
    const pool = isPostgresEnabled() ? getPostgresPool() : null;
    defaultStore = pool ? new PostgresAiSuggestionStore(pool as unknown as PgQueryable) : new MemoryAiSuggestionStore();
  }
  return defaultStore;
}

// ----------------------------------------------------------------------------
// Minimizacao e contexto
// ----------------------------------------------------------------------------
/** Remove e-mails, telefones, CPF e CNPJ de textos livres antes de ir ao provedor (e na volta). */
export function scrubPii(text: string): string {
  return String(text || '')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[e-mail removido]')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[CNPJ removido]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF removido]')
    .replace(/(\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, '[telefone removido]');
}
const noEmoji = (s: string) => s.replace(/\p{Extended_Pictographic}/gu, '').replace(/\uFE0F/g, '');
const stripHtml = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

export interface AiContext {
  payload: Record<string, unknown>;
  evidence: AiEvidence[];
  dataPoints: number;
  suppressed: boolean;
}

const daysAgo = (iso: string | null | undefined, now: Date) => (iso ? Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 86400000)) : null);
const bucketValue = (v: number) => (v >= 100000 ? 'acima de R$ 100 mil' : v >= 20000 ? 'R$ 20 mil a 100 mil' : v >= 5000 ? 'R$ 5 mil a 20 mil' : 'até R$ 5 mil');

async function engagementFor(repo: CrmRepository, signals: SignalStore, contactIds: Set<string>, now: Date) {
  const since = new Date(now.getTime() - 90 * 86400000).toISOString();
  const sig = (await signals.listSince(since, now.toISOString(), 50000)).filter((s) => s.contactId && contactIds.has(s.contactId));
  const replies = repo.listSequenceEnrollments().filter((e) => contactIds.has(e.contactId) && e.repliedAt && e.repliedAt >= since);
  const forms = repo.listFormSubmissions().filter((f) => f.contactId && contactIds.has(f.contactId) && f.submittedAt >= since);
  const meetings = repo.listTimelineEvents().filter((t) => t.type === 'MEETING' && t.contactId && contactIds.has(t.contactId) && t.createdAt >= since);
  const sentiments = replies.map((r) => classifyReply(r.replySnippet).sentiment);
  const human = [...sig.filter((s) => s.classification === 'CLICK_HUMAN').map((s) => s.at), ...replies.map((r) => r.repliedAt!), ...forms.map((f) => f.submittedAt), ...meetings.map((m) => m.createdAt)].sort();
  return {
    cliquesHumanos90d: sig.filter((s) => s.classification === 'CLICK_HUMAN').length,
    cliquesRoboIgnorados90d: sig.filter((s) => s.classification === 'CLICK_BOT').length,
    aberturasObservadas90d_sinalFraco: sig.filter((s) => s.classification === 'OPEN_OBSERVED').length,
    respostas90d: replies.length,
    respostasPositivas: sentiments.filter((x) => x === 'POSITIVE').length,
    respostasNegativas: sentiments.filter((x) => x === 'NEGATIVE').length,
    formularios90d: forms.length,
    reunioes90d: meetings.length,
    diasDesdeUltimoEngajamentoHumano: daysAgo(human[human.length - 1], now),
    pontos: sig.filter((s) => s.classification === 'CLICK_HUMAN').length + replies.length + forms.length + meetings.length,
  };
}

function suppressionOf(repo: CrmRepository, contactId: string): string | null {
  const c = repo.getContactById(contactId);
  if (!c) return null;
  const s = repo.listSuppressionEntries().find((x) => x.contactId === c.id || x.email.toLowerCase() === String(c.email || '').toLowerCase());
  if (s) return s.reason;
  return c.subscriptionStatus && c.subscriptionStatus !== 'SUBSCRIBED' ? String(c.subscriptionStatus) : null;
}

async function campaignPerformance(repo: CrmRepository, store: MarketingStore, signals: SignalStore, now: Date) {
  const since = new Date(now.getTime() - 180 * 86400000).toISOString();
  const clicks = new Set((await signals.listSince(since, now.toISOString(), 50000)).filter((s) => s.classification === 'CLICK_HUMAN').map((s) => `${s.campaignId}|${s.contactId}`));
  const out: Array<{ assunto: string; envios: number; taxaCliqueHumano: number }> = [];
  for (const c of repo.listMarketingCampaigns()) {
    const sends = (await store.listSendsByCampaign(c.id)).filter((s) => s.sentAt && s.sentAt >= since && !s.bouncedAt);
    if (sends.length < 20) continue;
    const bySubject = new Map<string, { n: number; x: number }>();
    for (const s of sends) {
      const v = s.subjectOverride || (await store.getVersion(s.templateId, s.templateVersion))?.subject || '';
      const cur = bySubject.get(v) || { n: 0, x: 0 };
      cur.n++;
      if (clicks.has(`${s.campaignId}|${s.contactId}`)) cur.x++;
      bySubject.set(v, cur);
    }
    for (const [subj, v] of bySubject) if (subj && v.n >= 20) out.push({ assunto: scrubPii(subj).slice(0, 160), envios: v.n, taxaCliqueHumano: Math.round((v.x / v.n) * 10000) / 100 });
  }
  return out.sort((a, b) => b.taxaCliqueHumano - a.taxaCliqueHumano).slice(0, 8);
}

export interface AiRequest {
  kind: AiKind;
  templateId?: string;
  brief?: string;
  purpose?: string;
  contactId?: string;
  companyId?: string;
}

export async function buildAiContext(repo: CrmRepository, deps: { store: MarketingStore; signals: SignalStore }, req: AiRequest, now: Date): Promise<AiContext> {
  const evidence: AiEvidence[] = [];
  if (req.kind === 'SUBJECT' || req.kind === 'COPY') {
    const payload: Record<string, unknown> = {};
    let dataPoints = 0;
    if (req.templateId) {
      const t = await deps.store.getTemplate(req.templateId);
      if (!t) throw Object.assign(new Error('Modelo não encontrado.'), { status: 404 });
      const v = await deps.store.getVersion(t.id, t.approvedVersion || t.currentVersion);
      payload.finalidade = MARKETING_PURPOSE_LABELS[t.purpose];
      payload.assuntoAtual = scrubPii(v?.subject || '').slice(0, 200);
      payload.preheader = scrubPii(v?.preheader || '').slice(0, 200);
      payload.textoAtual = scrubPii((v?.blocks || []).filter((b) => b.type === 'heading' || b.type === 'text' || b.type === 'button').map((b) => stripHtml(b.text || '')).join('\n')).slice(0, 3000);
      evidence.push({ key: 'modelo', label: 'Modelo usado como base', value: `${t.name} (versão ${v?.version ?? '-'})` });
      dataPoints += 1;
    }
    if (req.brief) {
      payload.briefing = scrubPii(String(req.brief)).slice(0, 1000);
      evidence.push({ key: 'briefing', label: 'Briefing informado', value: `${String(payload.briefing).length} caractere(s), dados pessoais removidos` });
    }
    if (!payload.finalidade && isMarketingPurpose(req.purpose)) payload.finalidade = MARKETING_PURPOSE_LABELS[req.purpose];
    if (!req.templateId && !req.brief) throw Object.assign(new Error('Informe um modelo ou um briefing.'), { status: 400 });
    const perf = await campaignPerformance(repo, deps.store, deps.signals, now);
    payload.historicoAssuntos = perf;
    if (perf.length) {
      evidence.push({ key: 'historicoAssuntos', label: 'Assuntos com histórico (180 dias)', value: `${perf.length} assunto(s); melhor taxa de clique humano ${perf[0].taxaCliqueHumano}% (${perf[0].envios} envios)` });
      dataPoints += perf.reduce((s, p) => s + Math.min(20, Math.round(p.envios / 50)), 0);
    } else {
      evidence.push({ key: 'historicoAssuntos', label: 'Assuntos com histórico (180 dias)', value: 'Sem campanhas com amostra suficiente (mínimo de 20 envios por assunto)' });
    }
    return { payload, evidence, dataPoints, suppressed: false };
  }
  if (req.kind === 'NEXT_STEP') {
    const c = req.contactId ? repo.getContactById(req.contactId) : undefined;
    if (!c) throw Object.assign(new Error('Contato não encontrado.'), { status: 404 });
    const company = c.companyId ? repo.getCompanyById(c.companyId) : undefined;
    const sup = suppressionOf(repo, c.id);
    const pipelines = repo.listPipelines();
    const stageName = (pid: string, sid: string) => pipelines.find((p) => p.id === pid)?.stages.find((s) => s.id === sid)?.name || sid;
    const deals = repo.listDeals().filter((d) => d.contactId === c.id);
    const payload: Record<string, unknown> = {
      cargo: c.jobTitle ? scrubPii(c.jobTitle).slice(0, 80) : null,
      etapaDoCiclo: c.lifecycleStage,
      pontuacaoLead: c.leadScore,
      setorEmpresa: company?.industry || null,
      porteEmpresa: company?.size || null,
      negocios: deals.slice(0, 5).map((d) => ({ etapa: stageName(d.pipelineId, d.stageId), status: d.status, faixaValor: bucketValue(d.value || 0), diasAberto: daysAgo(d.createdAt, now) })),
      cadenciaAtiva: repo.listSequenceEnrollments().some((e) => e.contactId === c.id && e.status === 'ACTIVE'),
    };
    evidence.push({ key: 'perfil', label: 'Perfil comercial', value: `Etapa ${c.lifecycleStage}, pontuação ${c.leadScore}${company?.industry ? `, setor ${company.industry}` : ''}` });
    evidence.push({ key: 'negocios', label: 'Negócios do contato', value: deals.length ? `${deals.length} negócio(s): ${deals.slice(0, 3).map((d) => `${stageName(d.pipelineId, d.stageId)} (${d.status})`).join(', ')}` : 'Nenhum negócio' });
    let dataPoints = 1 + deals.length;
    if (sup) {
      // LGPD: suprimido => so o fato da supressao; nada de historico de engajamento.
      payload.supressaoMarketing = sup;
      evidence.push({ key: 'supressao', label: 'Supressão de marketing', value: `Contato suprimido (${sup}); histórico de engajamento não enviado à IA` });
    } else {
      const eng = await engagementFor(repo, deps.signals, new Set([c.id]), now);
      const { pontos, ...rest } = eng;
      payload.engajamento = rest;
      dataPoints += pontos;
      evidence.push({ key: 'engajamento', label: 'Engajamento humano (90 dias)', value: `${eng.cliquesHumanos90d} clique(s) humano(s), ${eng.respostas90d} resposta(s) (${eng.respostasPositivas} positiva(s)), ${eng.formularios90d} formulário(s), ${eng.reunioes90d} reunião(ões); aberturas não contam` });
    }
    return { payload, evidence, dataPoints, suppressed: Boolean(sup) };
  }
  // ACCOUNT_SUMMARY
  const company = req.companyId ? repo.getCompanyById(req.companyId) : undefined;
  if (!company) throw Object.assign(new Error('Empresa não encontrada.'), { status: 404 });
  const contacts = repo.listContacts().filter((c) => c.companyId === company.id);
  const active = contacts.filter((c) => !suppressionOf(repo, c.id));
  const suppressedCount = contacts.length - active.length;
  const eng = await engagementFor(repo, deps.signals, new Set(active.map((c) => c.id)), now);
  const roles = new Map<string, number>();
  for (const c of active) {
    const r = c.jobTitle ? scrubPii(c.jobTitle).slice(0, 60) : 'Sem cargo';
    roles.set(r, (roles.get(r) || 0) + 1);
  }
  const deals = repo.listDeals().filter((d) => d.companyId === company.id || (d.contactId && contacts.some((c) => c.id === d.contactId)));
  const { pontos, ...rest } = eng;
  const payload = {
    setor: company.industry || null,
    porte: company.size || null,
    contatos: contacts.length,
    contatosSuprimidos: suppressedCount,
    cargos: [...roles.entries()].map(([cargo, n]) => ({ cargo, n })).slice(0, 15),
    engajamento: rest,
    negocios: { abertos: deals.filter((d) => d.status === 'OPEN').length, ganhos: deals.filter((d) => d.status === 'WON').length, perdidos: deals.filter((d) => d.status === 'LOST').length, faixaValorAberto: bucketValue(deals.filter((d) => d.status === 'OPEN').reduce((s, d) => s + (d.value || 0), 0)) },
  };
  evidence.push({ key: 'contatos', label: 'Contatos da conta', value: `${contacts.length} contato(s); ${suppressedCount} suprimido(s) ficaram de fora do engajamento` });
  evidence.push({ key: 'engajamento', label: 'Engajamento humano (90 dias, não suprimidos)', value: `${eng.cliquesHumanos90d} clique(s) humano(s), ${eng.respostas90d} resposta(s), ${eng.formularios90d} formulário(s), ${eng.reunioes90d} reunião(ões)` });
  evidence.push({ key: 'negocios', label: 'Negócios da conta', value: `${payload.negocios.abertos} aberto(s), ${payload.negocios.ganhos} ganho(s), ${payload.negocios.perdidos} perdido(s)` });
  return { payload, evidence, dataPoints: pontos + deals.length + 1, suppressed: false };
}

// ----------------------------------------------------------------------------
// Chamada ao modelo e montagem da sugestao
// ----------------------------------------------------------------------------
export function dataConfidence(points: number): number {
  return points >= 50 ? 0.85 : points >= 20 ? 0.7 : points >= 5 ? 0.5 : points >= 1 ? 0.35 : 0.2;
}
const level = (c: number): AiSuggestion['confidenceLevel'] => (c >= 0.7 ? 'ALTA' : c >= 0.45 ? 'MEDIA' : 'BAIXA');

function systemPrompt(kind: AiKind, suppressed: boolean): string {
  const tarefa: Record<AiKind, string> = {
    SUBJECT: 'Sugira até 5 assuntos de e-mail B2B (até 70 caracteres), claros e sem sensacionalismo, para a Seta Telecom (telecom e TI).',
    COPY: 'Sugira até 3 versões curtas do texto do e-mail (até 900 caracteres cada), tom consultivo B2B, com uma chamada para ação.',
    NEXT_STEP: 'Sugira até 3 próximos passos comerciais concretos para o vendedor, em ordem de prioridade.',
    ACCOUNT_SUMMARY: 'Resuma o engajamento da conta em até 6 frases e liste até 3 recomendações.',
  };
  return [
    'Você é um assistente comercial e de marketing do STI-hub. Responda em português do Brasil.',
    tarefa[kind],
    'Use SOMENTE os dados fornecidos. Não invente números, nomes ou fatos. Sem emojis. Não inclua dados pessoais.',
    'Abertura de e-mail é sinal fraco (Apple Mail Privacy Protection abre sozinho); priorize cliques humanos, respostas, formulários e reuniões.',
    suppressed ? 'O contato está SUPRIMIDO para marketing: não sugira e-mails de marketing nem novas campanhas para ele.' : '',
    'Responda APENAS com JSON: {"suggestions":[{"text":"...","rationale":"..."}],"summary":"... ou null","confidence":0.0-1.0,"basedOn":["chaves dos dados usados"],"caveats":["limitações"]}',
  ]
    .filter(Boolean)
    .join('\n');
}

function parseModelJson(text: string): Record<string, unknown> | null {
  const t = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(t.slice(start, end + 1));
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export class AiMarketingError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export async function generateAiSuggestion(
  repo: CrmRepository,
  deps: { store: MarketingStore; signals: SignalStore; llm: LlmClient; suggestions: AiSuggestionStore },
  req: AiRequest,
  actor: string,
  now: Date
): Promise<AiSuggestion> {
  let ctx: AiContext;
  try {
    ctx = await buildAiContext(repo, deps, req, now);
  } catch (e) {
    throw new AiMarketingError((e as { status?: number }).status || 400, (e as Error).message);
  }
  const res = await deps.llm.complete(
    [
      { role: 'system', content: systemPrompt(req.kind, ctx.suppressed) },
      { role: 'user', content: JSON.stringify({ tarefa: AI_KIND_LABELS[req.kind], dados: ctx.payload }) },
    ],
    []
  );
  const j = parseModelJson(res.text);
  if (!j) throw new AiMarketingError(502, 'A IA respondeu num formato inesperado. Tente de novo.');
  const maxLen = req.kind === 'SUBJECT' ? 120 : req.kind === 'COPY' ? 1500 : 600;
  const maxItems = req.kind === 'SUBJECT' ? 5 : 3;
  const items = (Array.isArray(j.suggestions) ? j.suggestions : [])
    .map((x): Record<string, unknown> => (x && typeof x === 'object' ? (x as Record<string, unknown>) : { text: x }))
    .map((x) => ({ text: noEmoji(scrubPii(String(x.text || ''))).trim().slice(0, maxLen), rationale: noEmoji(scrubPii(String(x.rationale || ''))).trim().slice(0, 400) }))
    .filter((x) => x.text)
    .slice(0, maxItems);
  const summary = typeof j.summary === 'string' && j.summary.trim() ? noEmoji(scrubPii(j.summary)).trim().slice(0, 1500) : null;
  if (!items.length && !summary) throw new AiMarketingError(502, 'A IA não trouxe sugestões. Tente de novo.');
  const mc = Number(j.confidence);
  const modelConfidence = Number.isFinite(mc) ? Math.min(1, Math.max(0, mc)) : null;
  const dc = dataConfidence(ctx.dataPoints);
  const confidence = Math.round(Math.min(modelConfidence ?? 0.5, dc) * 100) / 100;
  const validKeys = new Set(ctx.evidence.map((e) => e.key));
  const caveats = (Array.isArray(j.caveats) ? j.caveats : []).map((c) => noEmoji(scrubPii(String(c))).slice(0, 200)).filter(Boolean).slice(0, 5);
  if (dc < 0.5) caveats.unshift('Poucos dados de engajamento humano: trate como hipótese.');
  const s: AiSuggestion = {
    id: `aisg-${crypto.randomUUID()}`,
    kind: req.kind,
    status: 'PENDING_APPROVAL',
    target: req.templateId ? { type: 'TEMPLATE', id: req.templateId } : req.contactId ? { type: 'CONTACT', id: req.contactId } : req.companyId ? { type: 'COMPANY', id: req.companyId } : { type: 'BRIEF', id: null },
    items,
    summary,
    confidence,
    confidenceLevel: level(confidence),
    modelConfidence,
    dataConfidence: dc,
    evidence: ctx.evidence,
    basedOn: (Array.isArray(j.basedOn) ? j.basedOn : []).map(String).filter((k) => validKeys.has(k) || Object.prototype.hasOwnProperty.call(ctx.payload, k)).slice(0, 10),
    caveats,
    model: String(res.model || '').slice(0, 80),
    createdBy: actor,
    createdAt: now.toISOString(),
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
  };
  await deps.suggestions.save(s);
  return s;
}
