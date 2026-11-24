// ============================================================================
// Fase 6 (19/11/2026) — Recursos avancados: testes A/B e multivariados, otimizacao de horario,
// agendamento, IA comercial com aprovacao humana (provedor SEMPRE simulado) e central de
// preferencias. Sem rede, sem e-mail real, sem chamada a IA paga; contatos sinteticos.
// ============================================================================
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository, type CrmRepository } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import { MemoryLockStore } from '../src/db/distributed-lock';
import { MemoryMailboxStore } from '../src/modules/email/mailbox-store';
import { MemoryMarketingStore } from '../src/modules/marketing/marketing-store';
import { MARKETING_REVIEW_QUEUE } from '../src/modules/marketing/campaign-dispatcher';
import type { HttpFetch } from '../src/modules/marketing/esp-adapters';
import { MemorySignalStore, type EngagementSignal } from '../src/modules/analytics/signal-store';
import { chiSquarePValue, chiSquareTest, evaluateVariants, normalCdf, normalInv, sampleSizePerVariant, twoProportionZTest } from '../src/modules/enterprise/ab-stats';
import { MemoryExperimentStore } from '../src/modules/enterprise/experiment-store';
import { selectWinner } from '../src/modules/enterprise/experiments';
import { resolveSendWindow, spParts, suggestSendTime } from '../src/modules/enterprise/send-time';
import { scrubPii, isAiMarketingEnabled } from '../src/modules/enterprise/ai-marketing';
import type { LlmClient, LlmMessage } from '../src/modules/assistente/omniroute-client';
import { SequenceService } from '../src/modules/sequences/sequence-service';
import { runSequenceScheduler, type SequenceMailer, type SequenceMailSendInput } from '../src/modules/sequences/sequence-live-sender';
import { handleUnsubscribeRequest } from '../src/app/lib/marketing-public-routes';
import { signUnsubscribeToken } from '../src/modules/marketing/unsubscribe-token';

const HTTP = { _fromHttpBridge: '1' };
const tok = (uid: string, email: string, roleId: string, extra: Record<string, unknown> = {}) =>
  signStiHubSessionToken({
    uid, email, name: 'Teste', roleId, scope: roleId === 'SUPER_ADMIN' ? 'TODOS' : 'PROPRIOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000, ...extra,
  } as Parameters<typeof signStiHubSessionToken>[0]);
const ADMIN = () => ({ ...HTTP, _sessionToken: tok('usr-seta-01', 'marcelo.mira@setatelecom.com.br', 'SUPER_ADMIN', { canManageUsersRbac: true }) });
const SELLER = () => ({ ...HTTP, _sessionToken: tok('usr-seta-03', 'marialuiza@setatelecom.com.br', 'VENDEDOR_SALES') });

const ENV_KEYS = ['STI_HUB_MAILBOX_ENC_KEY', 'SEQUENCES_LIVE_SEND', 'SEQUENCES_TEST_RECIPIENTS'];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  delete process.env.SEQUENCES_LIVE_SEND;
  delete process.env.SEQUENCES_TEST_RECIPIENTS;
  process.env.STI_HUB_MAILBOX_ENC_KEY = crypto.randomBytes(32).toString('base64url');
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const MKT_DOMAIN = 'news.setatelecom.com.br';
const GOOD_DNS: Record<string, string[][]> = {
  [`send.${MKT_DOMAIN}`]: [['v=spf1 include:amazonses.com ~all']],
  [`resend._domainkey.${MKT_DOMAIN}`]: [['p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC1234567890abcdef']],
  [`_dmarc.${MKT_DOMAIN}`]: [['v=DMARC1; p=quarantine; rua=mailto:dmarc@setatelecom.com.br']],
};
// Quinta 19/11/2026 09:00 em Sao Paulo.
const T0 = Date.parse('2026-11-19T12:00:00.000Z');
const HOUR = 3600_000;

class Clock {
  t = T0;
  now = () => new Date(this.t);
  advanceH(h: number) {
    this.t += h * HOUR;
  }
}

function sig(p: Partial<EngagementSignal> & Pick<EngagementSignal, 'kind' | 'classification' | 'at' | 'contactId'>): EngagementSignal {
  return { id: `sig-${crypto.randomUUID()}`, source: 'TRACKING', reasons: ['teste'], trackingId: null, campaignId: null, messageSource: 'MARKETING', url: null, linkIndex: null, uaFamily: 'Navegador', ipNetwork: null, secondsSinceSent: null, ...p };
}

class MockLlm implements LlmClient {
  calls: LlmMessage[][] = [];
  constructor(public reply: string = JSON.stringify({ suggestions: [{ text: 'Fibra dedicada: estabilidade para sua operacao', rationale: 'Assunto objetivo' }], summary: null, confidence: 0.9, basedOn: ['historicoAssuntos'], caveats: [] })) {}
  async complete(messages: LlmMessage[]) {
    this.calls.push(messages);
    return { text: this.reply, toolCalls: [], model: 'modelo-simulado' };
  }
}

function setup(opts: { n?: number; env?: Record<string, string>; llm?: LlmClient | null } = {}) {
  const repo: CrmRepository = createInMemoryRepository();
  const n = opts.n ?? 80;
  const contacts = Array.from({ length: n }, (_, i) =>
    repo.createContact({
      firstName: `Sintetico${i}`,
      lastName: 'Teste',
      email: `ab${i}@example.test`,
      lgpdConsent: true,
      subscriptionStatus: 'SUBSCRIBED',
      isValidEmail: true,
      isDisposableEmail: false,
      communicationCategories: ['NEWSLETTER_TECNICA'],
      ownerId: 'usr-seta-01',
    } as never)
  );
  const env: NodeJS.ProcessEnv = {
    MARKETING_LIVE_SEND: 'true',
    MARKETING_ESP_PROVIDER: 'resend',
    MARKETING_RESEND_API_KEY: 're_teste_nunca_real',
    MARKETING_FROM_EMAIL: `news@${MKT_DOMAIN}`,
    MARKETING_FROM_NAME: 'Seta Telecom',
    MARKETING_POSTAL_ADDRESS: 'Rua Exemplo, 100 - Sao Paulo/SP - CEP 01000-000',
    MARKETING_UNSUBSCRIBE_SECRET: 'u'.repeat(40),
    MARKETING_TEST_RECIPIENTS: contacts.map((c) => c.email).join(','),
    MARKETING_MAX_PER_MINUTE: '500',
    ...(opts.env || {}),
  };
  const clock = new Clock();
  const mstore = new MemoryMarketingStore();
  const signals = new MemorySignalStore();
  const experiments = new MemoryExperimentStore();
  const esp: Array<{ url: string; body: any }> = [];
  const espFetch: HttpFetch = async (url, init) => {
    esp.push({ url, body: JSON.parse(String((init as { body?: string })?.body || '{}')) });
    return { ok: true, status: 200, json: async () => ({ id: `re-${esp.length}` }), text: async () => '{}', headers: { get: () => null } };
  };
  const router = new CrmApiRouter(repo, {
    mailboxStore: new MemoryMailboxStore(),
    marketing: { store: mstore, env, espFetch, lock: new MemoryLockStore(), resolver: async (h) => GOOD_DNS[h] || [], sleep: async () => undefined, origin: 'https://sti-hub.example.test', now: clock.now },
    signalStore: signals,
    enterprise: { experiments, llm: opts.llm === undefined ? null : opts.llm },
  });
  return { repo, contacts, env, clock, mstore, signals, experiments, esp, router };
}

async function approvedTemplate(router: CrmApiRouter, name: string, subject: string) {
  const blocks = [{ id: 'h', type: 'heading', text: 'Novidades' }, { id: 't', type: 'text', text: 'Olá {{firstName}}' }];
  const c = await router.dispatch({ method: 'POST', path: '/api/marketing/templates', query: ADMIN(), body: { name, purpose: 'NEWSLETTER_TECNICA', subject, blocks } });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const id = (c.body as any).data.template.id as string;
  await router.dispatch({ method: 'POST', path: `/api/marketing/templates/${id}/submit`, query: SELLER(), body: {} });
  const a = await router.dispatch({ method: 'POST', path: `/api/marketing/templates/${id}/approve`, query: ADMIN(), body: {} });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  return id;
}
const post = (router: CrmApiRouter, p: string, body: Record<string, unknown>, q = ADMIN()) => router.dispatch({ method: 'POST', path: p, query: q, body });
const get = (router: CrmApiRouter, p: string, q: Record<string, string> = ADMIN()) => router.dispatch({ method: 'GET', path: p, query: q });
const processQueue = (router: CrmApiRouter) => post(router, '/api/marketing/queue/process', {});

async function abScenario(extra: Record<string, unknown> = {}) {
  const s = setup();
  const t1 = await approvedTemplate(s.router, 'Fibra A', 'Assunto A');
  const t2 = await approvedTemplate(s.router, 'Fibra B', 'Assunto B');
  const camp = s.repo.createMarketingCampaign({ name: 'Campanha AB Sintetica' });
  const c = await post(s.router, '/api/marketing/experiments', {
    campaignId: camp.id,
    contactIds: s.contacts.map((x) => x.id),
    variants: [{ templateId: t1 }, { templateId: t2, subjectOverride: 'Assunto B alternativo' }],
    testPercent: 50,
    baselineRate: 0.1,
    minDetectableLift: 5,
    winnerMode: 'AUTO',
    minHoursBeforeDecision: 1,
    maxTestHours: 6,
    ...extra,
  });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  return { ...s, t1, t2, camp, exp: (c.body as any).data };
}

// ----------------------------------------------------------------------------
describe('Fase 6 — estatística', () => {
  it('normal, qui-quadrado e teste z batem com valores de referência', () => {
    assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-3);
    assert.ok(Math.abs(normalInv(0.975) - 1.959964) < 1e-4);
    assert.ok(Math.abs(chiSquarePValue(3.841, 1) - 0.05) < 1e-3);
    assert.ok(Math.abs(chiSquarePValue(5.991, 2) - 0.05) < 1e-3);
    const chi = chiSquareTest([{ conversions: 20, n: 100 }, { conversions: 35, n: 100 }]);
    assert.ok(Math.abs(chi.chi2 - 5.6426) < 1e-3, String(chi.chi2));
    assert.ok(Math.abs(chi.pValue - 0.0175) < 5e-4, String(chi.pValue));
    const z = twoProportionZTest({ conversions: 35, n: 100 }, { conversions: 20, n: 100 });
    assert.ok(Math.abs(Math.abs(z.z) - 2.3754) < 1e-3, String(z.z));
    assert.ok(Math.abs(z.pValue - chi.pValue) < 1e-6, 'z^2 = qui-quadrado com 1 gl');
  });

  it('tamanho de amostra: 10% -> 15% (alfa 0,05, poder 80%) ~ 683 por variante; mais variantes = correção de Bonferroni', () => {
    const n2 = sampleSizePerVariant({ baselineRate: 0.1, minDetectableLift: 0.5, alpha: 0.05, power: 0.8, variants: 2 });
    assert.ok(n2 >= 680 && n2 <= 690, String(n2));
    assert.ok(sampleSizePerVariant({ baselineRate: 0.1, minDetectableLift: 0.5, variants: 4 }) > n2);
  });

  it('decisão: exige amostra mínima, qui-quadrado e z corrigido; empate não tem vencedor', () => {
    const v = (id: string, conversions: number, n: number) => ({ id, label: id, conversions, n, rate: conversions / n });
    assert.equal(evaluateVariants([v('A', 3, 10), v('B', 0, 10)], { alpha: 0.05, minPerVariant: 50 }).reachedSample, false);
    const sig = evaluateVariants([v('A', 40, 200), v('B', 15, 200)], { alpha: 0.05, minPerVariant: 100 });
    assert.equal(sig.significant, true);
    assert.equal(sig.winnerId, 'A');
    const tie = evaluateVariants([v('A', 20, 200), v('B', 21, 200)], { alpha: 0.05, minPerVariant: 100 });
    assert.equal(tie.significant, false);
    assert.equal(tie.winnerId, null);
  });
});

describe('Fase 6 — testes A/B pela API', () => {
  it('ciclo completo: teste -> cliques humanos -> vencedor automático -> restante recebe o vencedor; MPP e robôs não contam', async () => {
    const s = await abScenario();
    assert.equal(s.exp.kind, 'AB');
    assert.equal(s.exp.metric, 'HUMAN_CLICK');
    assert.ok(s.exp.minPerVariant > 0 && s.exp.minPerVariant <= 20, String(s.exp.minPerVariant));
    const st = await post(s.router, `/api/marketing/experiments/${s.exp.id}/start`, {});
    assert.equal(st.status, 200, JSON.stringify(st.body));
    assert.equal((st.body as any).data.testContacts, 40);
    assert.equal((st.body as any).data.holdout, 40);
    const p1 = await processQueue(s.router);
    assert.equal((p1.body as any).data.sent, 40, JSON.stringify(p1.body));
    const sends = (await s.mstore.listSendsByCampaign(s.camp.id)).filter((x) => x.abPhase === 'TEST');
    const byVar = (v: string) => sends.filter((x) => x.variantId === v);
    assert.equal(byVar('A').length, 20);
    assert.equal(byVar('B').length, 20);
    assert.ok(s.esp.some((e) => e.body.subject === 'Assunto B alternativo'), 'variante B usa o assunto alternativo');
    const at = new Date(s.clock.t + 30 * 60_000).toISOString();
    // A: 12 cliques humanos. B: 1 clique humano + aberturas MPP e cliques de scanner (não contam).
    for (const x of byVar('A').slice(0, 12)) await s.signals.record(sig({ kind: 'CLICK', classification: 'CLICK_HUMAN', at, contactId: x.contactId, campaignId: s.camp.id }));
    for (const x of byVar('B')) {
      await s.signals.record(sig({ kind: 'OPEN', classification: 'OPEN_MACHINE', at, contactId: x.contactId, campaignId: s.camp.id }));
      await s.signals.record(sig({ kind: 'CLICK', classification: 'CLICK_BOT', at, contactId: x.contactId, campaignId: s.camp.id }));
    }
    await s.signals.record(sig({ kind: 'CLICK', classification: 'CLICK_HUMAN', at, contactId: byVar('B')[0].contactId, campaignId: s.camp.id }));
    s.clock.advanceH(0.75);
    await processQueue(s.router);
    let g = await get(s.router, `/api/marketing/experiments/${s.exp.id}`);
    assert.equal((g.body as any).data.experiment.status, 'TESTING', 'não decide antes do prazo mínimo');
    const res = (g.body as any).data.results;
    const b = res.variants.find((x: any) => x.id === 'B');
    assert.equal(b.conversions, 1);
    assert.equal(b.opensMachine, 20);
    assert.equal(b.clicksBot, 20);
    s.clock.advanceH(1);
    await processQueue(s.router);
    g = await get(s.router, `/api/marketing/experiments/${s.exp.id}`);
    const e = (g.body as any).data.experiment;
    assert.equal(e.status, 'COMPLETED');
    assert.equal(e.winnerVariantId, 'A');
    assert.equal(e.decisionMode, 'AUTO');
    assert.equal(e.rolloutQueued, 40);
    const rollout = (await s.mstore.listSendsByCampaign(s.camp.id)).filter((x) => x.abPhase === 'ROLLOUT');
    assert.equal(rollout.length, 40);
    assert.ok(rollout.every((x) => x.variantId === 'A' && x.templateId === s.t1));
    assert.ok((g.body as any).data.results.rollout.sent >= 0);
    const again = await post(s.router, `/api/marketing/experiments/${s.exp.id}/winner`, { variantId: 'B', confirmNotSignificant: true });
    assert.equal(again.status, 409, 'vencedor não é escolhido duas vezes');
    const audit = s.repo.listSecurityAuditLogs(200).logs.filter((l: any) => String(l.action).startsWith('MARKETING_EXPERIMENT'));
    assert.ok(audit.length >= 2);
  });

  it('manual sem significância exige confirmação; CAS impede dois vencedores simultâneos', async () => {
    const s = await abScenario({ winnerMode: 'MANUAL' });
    await post(s.router, `/api/marketing/experiments/${s.exp.id}/start`, {});
    await processQueue(s.router);
    const r = await post(s.router, `/api/marketing/experiments/${s.exp.id}/winner`, { variantId: 'B' });
    assert.equal(r.status, 409);
    assert.match(String((r.body as any).error), /significância/);
    const deps = { store: s.mstore, experiments: s.experiments, signals: s.signals, env: s.env, now: s.clock.now };
    const out = await Promise.allSettled([
      selectWinner(s.repo, deps, s.exp.id, { variantId: 'A', actor: 'x', mode: 'MANUAL', confirmNotSignificant: true }),
      selectWinner(s.repo, deps, s.exp.id, { variantId: 'B', actor: 'y', mode: 'MANUAL', confirmNotSignificant: true }),
    ]);
    assert.equal(out.filter((o) => o.status === 'fulfilled').length, 1);
    const rollout = (await s.mstore.listSendsByCampaign(s.camp.id)).filter((x) => x.abPhase === 'ROLLOUT');
    assert.equal(new Set(rollout.map((x) => x.variantId)).size, 1, 'um único vencedor enviado');
  });

  it('prazo esgotado sem significância: aguardando decisão + tarefa na fila de revisão; nada vai ao restante', async () => {
    const s = await abScenario();
    await post(s.router, `/api/marketing/experiments/${s.exp.id}/start`, {});
    await processQueue(s.router);
    s.clock.advanceH(7);
    await processQueue(s.router);
    const g = await get(s.router, `/api/marketing/experiments/${s.exp.id}`);
    assert.equal((g.body as any).data.experiment.status, 'NEEDS_DECISION');
    const task = s.repo.listTasks().find((t) => t.queueName === MARKETING_REVIEW_QUEUE && t.title.includes('Decidir o vencedor'));
    assert.ok(task);
    assert.equal((await s.mstore.listSendsByCampaign(s.camp.id)).filter((x) => x.abPhase === 'ROLLOUT').length, 0);
    const w = await post(s.router, `/api/marketing/experiments/${s.exp.id}/winner`, { variantId: 'A', confirmNotSignificant: true });
    assert.equal(w.status, 200, JSON.stringify(w.body));
    assert.equal((w.body as any).data.rolloutQueued, 40);
  });

  it('cancelar descarta envios na fila; vendedor não cria nem decide; multivariado gera combinações', async () => {
    const s = await abScenario({ testSendAt: new Date(T0 + 48 * HOUR).toISOString() });
    await post(s.router, `/api/marketing/experiments/${s.exp.id}/start`, {});
    assert.equal((await processQueue(s.router)).body && ((await processQueue(s.router)).body as any).data.sent, 0, 'teste agendado não sai antes da hora');
    const sellerWinner = await post(s.router, `/api/marketing/experiments/${s.exp.id}/winner`, { variantId: 'A' }, SELLER());
    assert.equal(sellerWinner.status, 403);
    const c = await post(s.router, `/api/marketing/experiments/${s.exp.id}/cancel`, {});
    assert.equal(c.status, 200);
    const rows = await s.mstore.listSendsByCampaign(s.camp.id);
    assert.ok(rows.length > 0 && rows.every((x) => x.status === 'SKIPPED'));
    const camp2 = s.repo.createMarketingCampaign({ name: 'Campanha MV' });
    const sellerCreate = await post(s.router, '/api/marketing/experiments', { campaignId: camp2.id, contactIds: [s.contacts[0].id], factors: { subjects: ['X', 'Y'], templateIds: [s.t1] } }, SELLER());
    assert.equal(sellerCreate.status, 403);
    const mv = await post(s.router, '/api/marketing/experiments', { campaignId: camp2.id, contactIds: s.contacts.map((x) => x.id), factors: { subjects: ['Assunto 1', 'Assunto 2'], templateIds: [s.t1, s.t2] }, metric: 'OPEN_OBSERVED' });
    assert.equal(mv.status, 201, JSON.stringify(mv.body));
    assert.equal((mv.body as any).data.kind, 'MULTIVARIATE');
    assert.equal((mv.body as any).data.variants.length, 4);
    assert.ok((mv.body as any).data.warnings.some((w: string) => /MPP/.test(w)));
    const tooMany = await post(s.router, '/api/marketing/experiments', { campaignId: s.repo.createMarketingCampaign({ name: 'X' }).id, contactIds: [s.contacts[0].id], factors: { subjects: ['1', '2', '3', '4'], templateIds: [s.t1, s.t2] } });
    assert.equal(tooMany.status, 400);
    const st = await get(s.router, '/api/marketing/enterprise/status', SELLER());
    assert.equal(st.status, 200);
    assert.equal((st.body as any).data.canManage, false);
    assert.equal((st.body as any).data.aiEnabled, false);
  });
});

describe('Fase 6 — agendamento e horário de envio', () => {
  it('agendamento por data/hora (Brasília): não sai antes; cancelar agendados; data passada recusada', async () => {
    const s = setup({ n: 3 });
    const tpl = await approvedTemplate(s.router, 'Agendada', 'Novidades');
    const camp = s.repo.createMarketingCampaign({ name: 'Agendada' });
    const bad = await post(s.router, '/api/marketing/campaigns/dispatch', { campaignId: camp.id, templateId: tpl, contactIds: s.contacts.map((c) => c.id), scheduleAt: '2026-11-18T10:00' });
    assert.equal(bad.status, 400);
    const d = await post(s.router, '/api/marketing/campaigns/dispatch', { campaignId: camp.id, templateId: tpl, contactIds: s.contacts.map((c) => c.id), scheduleAt: '2026-11-20T10:00' });
    assert.equal(d.status, 200, JSON.stringify(d.body));
    assert.equal((d.body as any).data.scheduledAt, '2026-11-20T13:00:00.000Z');
    const rows = await s.mstore.listSendsByCampaign(camp.id);
    assert.ok(rows.every((r) => r.nextAttemptAt === '2026-11-20T13:00:00.000Z' && r.scheduledBy === 'AGENDAMENTO'));
    assert.equal(((await processQueue(s.router)).body as any).data.sent, 0);
    s.clock.t = Date.parse('2026-11-20T13:01:00.000Z');
    assert.equal(((await processQueue(s.router)).body as any).data.sent, 3);
    const camp2 = s.repo.createMarketingCampaign({ name: 'Agendada 2' });
    await post(s.router, '/api/marketing/campaigns/dispatch', { campaignId: camp2.id, templateId: tpl, contactIds: s.contacts.map((c) => c.id), scheduleAt: '2026-11-25T09:00' });
    const sellerCancel = await post(s.router, `/api/marketing/campaigns/${camp2.id}/cancel-scheduled`, {}, SELLER());
    assert.equal(sellerCancel.status, 403);
    const cc = await post(s.router, `/api/marketing/campaigns/${camp2.id}/cancel-scheduled`, {});
    assert.equal((cc.body as any).data.cancelled, 3);
  });

  it('sugestão: contato, segmento, base e padrão; janela comercial, dias úteis, feriados e UTC-3', () => {
    const w = resolveSendWindow({});
    assert.deepEqual([w.startHour, w.endHour, w.weekdays], [8, 18, [1, 2, 3, 4, 5]]);
    const notBefore = new Date(T0); // qui 09:00 SP
    const at15 = ['2026-11-10T18:10:00Z', '2026-11-11T18:20:00Z', '2026-11-12T18:40:00Z']; // 15h SP
    const c = suggestSendTime({ contactEvents: at15, notBefore, window: w });
    assert.equal(c.source, 'CONTATO');
    assert.equal(c.at, '2026-11-19T18:00:00.000Z');
    assert.equal(c.hour, 15);
    const seg = suggestSendTime({ contactEvents: at15.slice(0, 1), segmentEvents: Array(10).fill('2026-11-10T14:30:00Z'), notBefore, window: w });
    assert.equal(seg.source, 'SEGMENTO');
    assert.equal(spParts(Date.parse(seg.at)).hour, 11);
    const late = suggestSendTime({ globalEvents: Array(20).fill('2026-11-10T01:00:00Z'), notBefore, window: w }); // 22h SP -> 17h
    assert.equal(late.source, 'BASE');
    assert.equal(late.hour, 17);
    const def = suggestSendTime({ notBefore, window: w });
    assert.equal(def.source, 'PADRAO');
    assert.equal(def.at, '2026-11-19T13:00:00.000Z');
    assert.ok(def.confidence < c.confidence);
    const sat = suggestSendTime({ notBefore: new Date('2026-11-21T15:00:00Z'), window: w });
    assert.equal(sat.at, '2026-11-23T13:00:00.000Z', 'sábado -> segunda 10h');
    const hol = suggestSendTime({ notBefore, window: resolveSendWindow({ SEND_TIME_HOLIDAYS: '2026-11-19,2026-11-20', SEND_TIME_WINDOW: '9-12' }) });
    assert.equal(hol.at, '2026-11-23T13:00:00.000Z', 'feriados pulados');
    assert.equal(resolveSendWindow({ SEND_TIME_WINDOW: 'x', SEND_TIME_WEEKDAYS: '1,3' }).weekdays.join(','), '1,3');
  });

  it('rotas: contato no escopo, segmento, disparo com horário otimizado e opção na cadência', async () => {
    const s = setup({ n: 4 });
    for (let d = 1; d <= 3; d++) await s.signals.record(sig({ kind: 'CLICK', classification: 'CLICK_HUMAN', at: `2026-11-1${d}T18:15:00Z`, contactId: s.contacts[0].id }));
    // abertura nunca conta para horário
    for (let d = 1; d <= 5; d++) await s.signals.record(sig({ kind: 'OPEN', classification: 'OPEN_OBSERVED', at: `2026-11-1${d}T11:15:00Z`, contactId: s.contacts[1].id }));
    const r = await get(s.router, `/api/marketing/send-time/contact/${s.contacts[0].id}`);
    assert.equal(r.status, 200);
    assert.equal((r.body as any).data.source, 'CONTATO');
    assert.equal((r.body as any).data.at, '2026-11-19T18:00:00.000Z');
    const r1 = await get(s.router, `/api/marketing/send-time/contact/${s.contacts[1].id}`);
    assert.equal((r1.body as any).data.source, 'PADRAO');
    const sellerView = await get(s.router, `/api/marketing/send-time/contact/${s.contacts[0].id}`, SELLER());
    assert.equal(sellerView.status, 404, 'fora do escopo do vendedor');
    const seg = await post(s.router, '/api/marketing/send-time/segment', { contactIds: s.contacts.map((c) => c.id) });
    assert.equal(seg.status, 200);
    assert.equal((seg.body as any).data.sources.CONTATO, 1);
    const tpl = await approvedTemplate(s.router, 'STO', 'Novidades');
    const camp = s.repo.createMarketingCampaign({ name: 'STO' });
    const d = await post(s.router, '/api/marketing/campaigns/dispatch', { campaignId: camp.id, templateId: tpl, contactIds: s.contacts.map((c) => c.id), sendTimeOptimization: true });
    assert.equal(d.status, 200, JSON.stringify(d.body));
    const rows = await s.mstore.listSendsByCampaign(camp.id);
    assert.equal(rows.find((x) => x.contactId === s.contacts[0].id)!.nextAttemptAt, '2026-11-19T18:00:00.000Z');
    assert.equal(rows.find((x) => x.contactId === s.contacts[0].id)!.scheduledBy, 'HORARIO_OTIMIZADO');
    const seq = s.repo.listSequences()[0];
    assert.equal((await post(s.router, `/api/marketing/send-time/sequence/${seq.id}`, { enabled: true }, SELLER())).status, 403);
    const on = await post(s.router, `/api/marketing/send-time/sequence/${seq.id}`, { enabled: true });
    assert.equal((on.body as any).data.sendTimeOptimization, true);
    assert.equal(s.repo.getSequenceById(seq.id)!.sendTimeOptimization, true);
  });

  it('cadência com horário otimizado: adia uma vez (até 24 h) e envia no horário sugerido', async () => {
    process.env.SEQUENCES_LIVE_SEND = 'true';
    const repo = createInMemoryRepository();
    const SEQ = 'seq-seta-21d-prospeccao';
    const OWNER = 'marcelo.mira@setatelecom.com.br';
    const WED_14H = new Date('2026-11-18T17:00:00.000Z');
    repo.updateSequence(SEQ, { sendTimeOptimization: true });
    assert.equal(repo.getSequenceById(SEQ)!.sendTimeOptimization, true);
    const svc = new SequenceService();
    const { enrollment } = svc.enrollContact(repo, { sequenceId: SEQ, contactId: 'cont-marina', forceMoveFromConflicting: true, allowReentryOverride: true, enrolledByEmail: OWNER });
    const e0 = repo.getSequenceEnrollmentById(enrollment.id)!;
    e0.nextStepDueAt = new Date(WED_14H.getTime() - 60_000).toISOString();
    repo.saveSequenceEnrollment(e0);
    const sends: SequenceMailSendInput[] = [];
    const mailer: SequenceMailer = {
      async resolveMailbox() {
        return { ok: true, accountId: 'mbx-1', ownerEmail: OWNER, mailboxAddress: OWNER, displayName: 'M', accessToken: 'tok-nunca-registrar' };
      },
      async send(input) {
        sends.push(input);
        return { messageId: `g-${sends.length}`, conversationId: 'c', internetMessageId: '<m@x>', trackingId: 't'.repeat(22) };
      },
      async listInboxSince() {
        return [];
      },
    };
    const target = new Date(WED_14H.getTime() + 2 * HOUR).toISOString();
    let asked = 0;
    const sendTimeFor = async () => {
      asked++;
      return { at: target, localDisplay: '18/11/2026 16:00', source: 'Histórico do contato' };
    };
    const r1 = await runSequenceScheduler(repo, { mailer, now: WED_14H, sendTimeFor });
    assert.equal(sends.length, 0, JSON.stringify(r1));
    const d = repo.getSequenceEnrollmentById(enrollment.id)!.stepDeliveries!.find((x) => x.stepOrder === 1)!;
    assert.equal(d.status, 'SCHEDULED');
    assert.equal(d.reasonCode, 'SEND_TIME_OPTIMIZED');
    await runSequenceScheduler(repo, { mailer, now: new Date(Date.parse(target) + 60_000), sendTimeFor });
    assert.equal(sends.length, 1, 'envia no horário sugerido sem adiar de novo');
    assert.equal(asked, 1);
  });
});

describe('Fase 6 — IA comercial e de marketing (provedor simulado)', () => {
  function aiSetup(llm: LlmClient | null = new MockLlm()) {
    const s = setup({ n: 3, env: { AI_MARKETING_ENABLED: 'true' }, llm });
    const company = s.repo.listCompanies()[0];
    const [a, b] = s.contacts;
    s.repo.updateContact(a.id, { companyId: company.id, phone: '+55 11 98888-7777', jobTitle: 'Gerente de TI' } as never);
    s.repo.updateContact(b.id, { companyId: company.id } as never);
    const st = s.repo.getState() as any;
    st.suppressionList = [...(st.suppressionList || []), { id: 'sup-f6', email: b.email, contactId: b.id, reason: 'UNSUBSCRIBED_MARKETING', scope: 'MARKETING_ONLY', createdAt: new Date(T0 - 86400000).toISOString(), source: 'teste' }];
    return { ...s, company, a, b, llm };
  }

  it('flag desligada por padrão: 403 e nenhuma chamada ao provedor; sem provedor: 503', async () => {
    assert.equal(isAiMarketingEnabled({}), false);
    const llm = new MockLlm();
    const off = setup({ n: 1, llm });
    const r = await post(off.router, '/api/marketing/ai/suggest', { kind: 'SUBJECT', brief: 'fibra' });
    assert.equal(r.status, 403);
    assert.equal(llm.calls.length, 0);
    const none = setup({ n: 1, env: { AI_MARKETING_ENABLED: 'true' } }); // NODE_ENV=test: nunca cria cliente real
    const r2 = await post(none.router, '/api/marketing/ai/suggest', { kind: 'SUBJECT', brief: 'fibra' });
    assert.equal(r2.status, 503);
  });

  it('próximo passo: só dados agregados vão à IA; resultado aguarda aprovação com confiança e evidências', async () => {
    const s = aiSetup();
    await s.signals.record(sig({ kind: 'CLICK', classification: 'CLICK_HUMAN', at: new Date(T0 - 2 * 86400000).toISOString(), contactId: s.a.id }));
    const r = await post(s.router, '/api/marketing/ai/suggest', { kind: 'NEXT_STEP', contactId: s.a.id });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const sg = (r.body as any).data;
    assert.equal(sg.status, 'PENDING_APPROVAL');
    assert.ok(['ALTA', 'MEDIA', 'BAIXA'].includes(sg.confidenceLevel));
    assert.ok(sg.confidence <= 0.9);
    assert.ok(sg.evidence.some((e: any) => e.key === 'engajamento'));
    const sent = JSON.stringify((s.llm as MockLlm).calls[0]);
    const contact = s.repo.getContactById(s.a.id)!;
    for (const pii of [contact.email, contact.firstName, contact.lastName, '98888-7777', s.company.name]) assert.ok(!sent.includes(String(pii)), `não envia ${pii}`);
    assert.match(sent, /cliquesHumanos90d\\":1/);
    // suprimido: só o fato da supressão
    const r2 = await post(s.router, '/api/marketing/ai/suggest', { kind: 'NEXT_STEP', contactId: s.b.id });
    assert.equal(r2.status, 201);
    const sent2 = JSON.stringify((s.llm as MockLlm).calls[1]);
    assert.match(sent2, /supressaoMarketing/);
    assert.ok(!/cliquesHumanos90d/.test(sent2));
    assert.match(sent2, /SUPRIMIDO/);
    // aprovação humana; nada é aplicado automaticamente
    const ap = await post(s.router, `/api/marketing/ai/suggestions/${sg.id}/approve`, {});
    assert.equal(ap.status, 200);
    assert.equal((ap.body as any).data.status, 'APPROVED');
    assert.equal((await post(s.router, `/api/marketing/ai/suggestions/${sg.id}/reject`, {})).status, 409);
    const rj = await post(s.router, `/api/marketing/ai/suggestions/${(r2.body as any).data.id}/reject`, {});
    assert.equal((rj.body as any).data.status, 'REJECTED');
    assert.equal(s.esp.length, 0, 'IA não envia nada');
    const logs = s.repo.listSecurityAuditLogs(200).logs.filter((l: any) => String(l.action).startsWith('AI_MARKETING'));
    assert.ok(logs.length >= 2);
    const auditText = JSON.stringify(logs);
    assert.ok(!auditText.includes('Fibra dedicada') && !auditText.includes(contact.email), 'auditoria sem conteúdo');
  });

  it('resumo da conta exclui engajamento de suprimidos; saída da IA sem e-mail/telefone/emoji', async () => {
    const llm = new MockLlm(JSON.stringify({ suggestions: [{ text: 'Ligar para fulano@cliente.com.br ou (11) 98888-7777 \u{1F680}', rationale: 'x' }], summary: 'Conta engajada', confidence: 0.95, basedOn: ['engajamento'], caveats: [] }));
    const s = aiSetup(llm);
    const at = new Date(T0 - 86400000).toISOString();
    await s.signals.record(sig({ kind: 'CLICK', classification: 'CLICK_HUMAN', at, contactId: s.a.id }));
    for (let i = 0; i < 5; i++) await s.signals.record(sig({ kind: 'CLICK', classification: 'CLICK_HUMAN', at, contactId: s.b.id }));
    const r = await post(s.router, '/api/marketing/ai/suggest', { kind: 'ACCOUNT_SUMMARY', companyId: s.company.id });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const payload = JSON.parse(JSON.parse(JSON.stringify(llm.calls[0][1].content)));
    assert.equal(payload.dados.engajamento.cliquesHumanos90d, 1, 'só o contato não suprimido');
    assert.ok(payload.dados.contatosSuprimidos >= 1);
    const text = (r.body as any).data.items[0].text as string;
    assert.ok(!text.includes('@') && !text.includes('98888') && !/\p{Extended_Pictographic}/u.test(text), text);
    assert.equal(scrubPii('cnpj 12.345.678/0001-90 cpf 123.456.789-09'), 'cnpj [CNPJ removido] cpf [CPF removido]');
  });

  it('escopo do vendedor e limite por hora', async () => {
    const s = aiSetup();
    const notMine = await post(s.router, '/api/marketing/ai/suggest', { kind: 'NEXT_STEP', contactId: s.a.id }, SELLER());
    assert.equal(notMine.status, 404);
    const own = await post(s.router, '/api/marketing/ai/suggest', { kind: 'SUBJECT', brief: 'Nova oferta de fibra para escritórios, contato joao@x.com' }, SELLER());
    assert.equal(own.status, 201, JSON.stringify(own.body));
    assert.ok(!JSON.stringify((s.llm as MockLlm).calls.at(-1)).includes('joao@x.com'), 'briefing sem e-mail');
    const adm = await post(s.router, '/api/marketing/ai/suggest', { kind: 'SUBJECT', brief: 'Evento ABM' });
    const list = await get(s.router, '/api/marketing/ai/suggestions', SELLER());
    assert.ok((list.body as any).data.every((x: any) => x.createdBy === 'marialuiza@setatelecom.com.br'));
    const steal = await post(s.router, `/api/marketing/ai/suggestions/${(adm.body as any).data.id}/approve`, {}, SELLER());
    assert.equal(steal.status, 404);
    let limited = false;
    for (let i = 0; i < 25 && !limited; i++) limited = (await post(s.router, '/api/marketing/ai/suggest', { kind: 'SUBJECT', brief: 'teste' }, SELLER())).status === 429;
    assert.ok(limited, 'limite de 20 por hora');
  });
});

describe('Fase 6 — central de preferências', () => {
  it('GET mostra caixas por finalidade; SAVE tira e adiciona com consentimento; descadastro total não volta pelo link', async () => {
    const s = setup({ n: 1 });
    const c = s.contacts[0];
    const camp = s.repo.createMarketingCampaign({ name: 'Pref' });
    const dispatch = ((p: string, b: Record<string, unknown>) => s.router.dispatch({ method: 'POST', path: p, query: {}, body: b, context: TRUSTED_INTERNAL_CONTEXT })) as never;
    const token = signUnsubscribeToken({ contactId: c.id, campaignId: camp.id, purpose: 'NEWSLETTER_TECNICA' }, 'u'.repeat(40));
    const g = await handleUnsubscribeRequest({ method: 'GET', token }, dispatch, s.env);
    assert.equal(g.status, 200);
    assert.ok(g.body.includes('<form method="post">'));
    assert.ok(g.body.includes('name="purpose" value="NEWSLETTER_TECNICA" checked'));
    assert.ok(g.body.includes('value="EVENTOS_ABM">'));
    assert.ok(!g.body.includes(c.email), 'e-mail mascarado');
    const save = await handleUnsubscribeRequest({ method: 'POST', token, formBody: 'action=SAVE&purpose=EVENTOS_ABM&purpose=OFERTAS_COMERCIAIS' }, dispatch, s.env);
    assert.equal(save.status, 200);
    const after = s.repo.getContactById(c.id)!;
    assert.deepEqual([...after.communicationCategories!].sort(), ['EVENTOS_ABM', 'OFERTAS_COMERCIAIS']);
    assert.equal(after.lgpdLegalBasis, 'CONSENTIMENTO_OPT_IN');
    assert.ok(s.repo.listTimelineEvents().some((t) => t.contactId === c.id && /Consentimento por finalidade/.test(t.title)));
    await handleUnsubscribeRequest({ method: 'POST', token, formBody: 'scope=ALL_MARKETING' }, dispatch, s.env);
    const back = await handleUnsubscribeRequest({ method: 'POST', token, formBody: 'action=SAVE&purpose=NEWSLETTER_TECNICA' }, dispatch, s.env);
    assert.match(back.body, /descadastrado de todo o marketing/);
    assert.ok(!s.repo.getContactById(c.id)!.communicationCategories!.includes('NEWSLETTER_TECNICA'));
    assert.equal(s.repo.canSendMarketingEmailToContact(c.id).allowed, false);
    const g2 = await handleUnsubscribeRequest({ method: 'GET', token }, dispatch, s.env);
    assert.ok(g2.body.includes('disabled'));
    const http = await s.router.dispatch({ method: 'POST', path: '/api/marketing/preferences-apply', query: ADMIN(), body: { claims: { contactId: c.id, campaignId: camp.id, purpose: 'NEWSLETTER_TECNICA' }, purposes: ['NEWSLETTER_TECNICA'] } });
    assert.equal(http.status, 404, 'rota interna nunca por HTTP');
  });
});

describe('Fase 6 — UI e isolamento', () => {
  const root = process.cwd();
  const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
  it('telas sem emojis; módulos sem escrita em fatura/ERP/Chamados', () => {
    for (const f of ['src/app/components/MarketingEnterprisePanel.tsx', 'src/app/components/MarketingCampaignStudio.tsx', 'src/app/lib/marketing-public-routes.ts']) {
      assert.ok(!/\p{Extended_Pictographic}/u.test(read(f)), f);
    }
    for (const f of ['src/modules/enterprise/ab-stats.ts', 'src/modules/enterprise/send-time.ts', 'src/modules/enterprise/experiments.ts', 'src/modules/enterprise/experiment-store.ts', 'src/modules/enterprise/ai-marketing.ts', 'src/api/enterprise-routes.ts']) {
      const src = read(f);
      assert.ok(!/invoice|fatura|nfse|nota fiscal|chamados?\//i.test(src.replace(/\/\/.*$/gm, '')), f);
      assert.ok(!/from '\.\.\/(?:\.\.\/)?modules\/(erp|billing|tickets|chamados)/.test(src), f);
    }
  });
});
