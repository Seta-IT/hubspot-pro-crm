// ============================================================================
// Fase 5 (19/11/2026) — Analytics: engajamento humano x abertura observada (MPP/proxies/scanners),
// 20 perguntas com drill-down, conversao por passo de cadencia e por caminho A/B, receita
// influenciada (somente leitura), coortes e exportacao CSV/XLSX/PDF com RBAC e LGPD.
// Sem rede, sem e-mail real; contatos sinteticos.
// ============================================================================
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository, type CrmRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';
import { MemoryMailboxStore, type CrmEmailMessage } from '../src/modules/email/mailbox-store';
import { MemoryMarketingStore, type MarketingSend } from '../src/modules/marketing/marketing-store';
import { MemoryWorkflowStore } from '../src/modules/workflows/dag/store';
import { MemoryLockStore } from '../src/db/distributed-lock';
import { classifyReply, classifySignal, ipInCidr, truncateIp, FAST_CLICK_SECONDS } from '../src/modules/analytics/signal-classifier';
import { MemorySignalStore, type EngagementSignal } from '../src/modules/analytics/signal-store';
import { syncSequenceEngagement } from '../src/modules/analytics/engagement-sync';
import { ANALYTICS_QUESTIONS } from '../src/modules/analytics/analytics-engine';
import { crc32, safeCell, toCsv, toPdf, toXlsx } from '../src/modules/analytics/export-formats';
import { handleEmailTrackRequest } from '../src/app/lib/email-track-route';
import { newTrackingId, trackingSignature, OPEN_GRACE_MS } from '../src/modules/email/mail-tracking';
import { normalizeResendEvent } from '../src/modules/marketing/resend-webhook';
import { maskEmail, parsePeriod } from '../src/api/analytics-routes';
import { SlidingWindowRateLimiter } from '../src/api/password-reset';

const HTTP = { _fromHttpBridge: '1' };
const tok = (uid: string, email: string, roleId: string, extra: Record<string, unknown> = {}) =>
  signStiHubSessionToken({
    uid, email, name: 'Teste', roleId, scope: roleId === 'SUPER_ADMIN' ? 'TODOS' : 'PROPRIOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000, ...extra,
  } as Parameters<typeof signStiHubSessionToken>[0]);
const ADMIN = () => ({ ...HTTP, _sessionToken: tok('usr-seta-01', 'marcelo.mira@setatelecom.com.br', 'SUPER_ADMIN', { canManageUsersRbac: true }) });
const SELLER = (extra: Record<string, unknown> = {}) => ({ ...HTTP, _sessionToken: tok('usr-seta-03', 'marialuiza@setatelecom.com.br', 'VENDEDOR_SALES', extra) });

const KEY_SAVED = process.env.STI_HUB_MAILBOX_ENC_KEY;
beforeEach(() => {
  process.env.STI_HUB_MAILBOX_ENC_KEY = crypto.randomBytes(32).toString('base64url');
});
afterEach(() => {
  if (KEY_SAVED === undefined) delete process.env.STI_HUB_MAILBOX_ENC_KEY;
  else process.env.STI_HUB_MAILBOX_ENC_KEY = KEY_SAVED;
});

const NOW = Date.parse('2026-11-19T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const DAY = 86400000;
const SENT = Date.parse('2026-11-01T12:00:00.000Z');
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function sig(p: Partial<EngagementSignal> & Pick<EngagementSignal, 'kind' | 'classification' | 'at' | 'contactId'>): EngagementSignal {
  return { id: `sig-${crypto.randomUUID()}`, source: 'TRACKING', reasons: ['teste'], trackingId: null, campaignId: null, messageSource: 'MARKETING', url: null, linkIndex: null, uaFamily: 'Navegador', ipNetwork: null, secondsSinceSent: null, ...p };
}

async function scenario() {
  const repo: CrmRepository = createInMemoryRepository();
  const contacts = repo.listContacts().slice(0, 4);
  contacts.forEach((c, i) => {
    c.email = `qa${i + 1}@example.test`;
    c.firstName = `Sintetico${i + 1}`;
    c.lastName = 'Teste';
    c.phone = '+55 11 90000-000' + i;
    c.subscriptionStatus = 'SUBSCRIBED';
    c.ownerId = i === 0 ? 'usr-seta-03' : 'usr-seta-01';
  });
  const st = repo.getState() as any;
  st.suppressionList = [{ id: 'sup-1', email: contacts[1].email, contactId: contacts[1].id, reason: 'UNSUBSCRIBED_MARKETING', scope: 'MARKETING_ONLY', createdAt: iso(SENT + 2 * DAY), source: 'teste' }];
  st.timelineEvents = (st.timelineEvents || []).filter((t: any) => !contacts.some((c) => c.id === t.contactId));
  st.formSubmissions = (st.formSubmissions || []).filter((f: any) => !contacts.some((c) => c.id === f.contactId));
  st.sequenceEnrollments = [];
  st.deals = (st.deals || []).filter((d: any) => !contacts.some((c) => c.id === d.contactId));
  const camp = repo.createMarketingCampaign({ name: 'Campanha Fibra Sintetica' });
  const mstore = new MemoryMarketingStore();
  const send = (c: (typeof contacts)[number], tid: string): MarketingSend => ({
    campaignId: camp.id, contactId: c.id, email: c.email, templateId: 'mtpl-1', templateVersion: 1, purpose: 'MARKETING' as any, status: 'SENT' as any, reason: null, attempts: 1,
    provider: 'resend', providerMessageId: `pm-${tid}`, trackingId: tid, queuedAt: iso(SENT), nextAttemptAt: iso(SENT), sentAt: iso(SENT), deliveredAt: iso(SENT + 1000),
    bouncedAt: null, complainedAt: null, unsubscribedAt: null, updatedAt: iso(SENT),
  });
  await mstore.enqueueSends([send(contacts[0], 't0'), send(contacts[1], 't1'), send(contacts[2], 't2')]);
  const signals = new MemorySignalStore();
  // c0: clique humano; c1: abertura MPP + clique de scanner; c2: nada (cadencia responde)
  await signals.record(sig({ kind: 'CLICK', classification: 'CLICK_HUMAN', at: iso(SENT + 3600000), contactId: contacts[0].id, trackingId: 't0', campaignId: camp.id, url: 'https://setatelecom.com.br/fibra' }));
  await signals.record(sig({ kind: 'OPEN', classification: 'OPEN_MACHINE', at: iso(SENT + 5000), contactId: contacts[1].id, trackingId: 't1', campaignId: camp.id, reasons: ['Rede Apple (Mail Privacy Protection)'] }));
  await signals.record(sig({ kind: 'CLICK', classification: 'CLICK_BOT', at: iso(SENT + 6000), contactId: contacts[1].id, trackingId: 't1', campaignId: camp.id, url: 'https://setatelecom.com.br/fibra', reasons: ['User-agent de scanner'] }));
  // cadencia real (Fase 2) para c2 com resposta positiva e abertura observada no passo 1
  const seq = repo.listSequences()[0];
  repo.saveSequenceEnrollment({
    id: 'enr-f5-1', sequenceId: seq.id, contactId: contacts[2].id, dealId: null, status: 'REPLIED' as any, currentStepOrder: 1, stepsCompleted: 1, sentCount: 1, openCount: 0, clickCount: 0,
    repliedAt: iso(SENT + 2 * DAY), replySnippet: 'Tenho interesse, podemos agendar uma conversa?', nextStepDueAt: null, exitReasonTrigger: 'CONTACT_REPLIED' as any, exitReasonDetail: 'Resposta detectada', exitedAt: iso(SENT + 2 * DAY),
    senderOwnerEmail: 'marialuiza@setatelecom.com.br',
    stepDeliveries: [{ stepOrder: 1, idempotencyKey: 'k1', status: 'SENT' as any, attempts: 1, senderOwnerEmail: 'marialuiza@setatelecom.com.br', trackingId: 't3', sentAt: iso(SENT + DAY), updatedAt: iso(SENT + DAY) }],
    history: [], enrolledAt: iso(SENT), updatedAt: iso(SENT + 2 * DAY),
  } as any);
  await signals.record(sig({ kind: 'OPEN', classification: 'OPEN_OBSERVED', at: iso(SENT + DAY + 3600000), contactId: contacts[2].id, trackingId: 't3', messageSource: 'CRM' }));
  await signals.record(sig({ kind: 'CLICK', classification: 'CLICK_HUMAN', at: iso(SENT + DAY + 7200000), contactId: contacts[2].id, trackingId: 't3', messageSource: 'CRM', url: 'https://setatelecom.com.br/proposta' }));
  // negocio ganho de c0 (influenciado pela campanha) e aberto de c2 (pela cadencia)
  const won = repo.createDeal({ title: 'Fibra 1G Sintetica', value: 12000, contactId: contacts[0].id, status: 'WON' as any });
  const open = repo.createDeal({ title: 'Link dedicado Sintetico', value: 8000, contactId: contacts[2].id });
  const fix = (id: string, p: Record<string, unknown>) => Object.assign(st.deals.find((d: any) => d.id === id), p);
  fix(won.id, { status: 'WON', createdAt: iso(SENT + 3 * DAY), closedAt: iso(SENT + 10 * DAY) });
  fix(open.id, { status: 'OPEN', createdAt: iso(SENT + 3 * DAY), closedAt: null });
  // workflow com teste A/B: c0 no caminho A, c1 no caminho B
  const store = new MemoryWorkflowStore();
  const graph = { trigger: { type: 'CONTACT_CREATED', config: {} }, startNodeId: 'ab', reentry: { mode: 'NEVER', cooldownDays: 0 }, nodes: [{ id: 'ab', kind: 'ACTION', action: 'AB_TEST', label: 'Assunto', config: { variants: [{ id: 'A', label: 'Assunto A', percent: 50 }, { id: 'B', label: 'Assunto B', percent: 50 }] }, next: null, branches: { A: null, B: null } }] } as any;
  await store.saveDefinition({ id: 'wfd-f5', name: 'Fluxo AB Sintetico', description: '', status: 'ACTIVE', version: 1, activeVersion: 1, graph, lastSimulation: null, createdBy: 'x', updatedBy: 'x', activatedBy: 'x', activatedAt: iso(SENT), createdAt: iso(SENT), updatedAt: iso(SENT) });
  await store.insertVersion({ workflowId: 'wfd-f5', version: 1, graph, createdBy: 'x', createdAt: iso(SENT) });
  const run = (id: string, c: string, v: string) => store.createRun({ id, workflowId: 'wfd-f5', workflowName: 'Fluxo AB Sintetico', version: 1, contactId: c, status: 'COMPLETED', currentNodeId: null, wakeAt: iso(SENT), waitStartedAt: null, triggerEventId: `ev-${id}`, triggerType: 'CONTACT_CREATED' as any, depth: 0, variants: { ab: v }, lastError: null, startedAt: iso(SENT - 3600000), updatedAt: iso(SENT), completedAt: iso(SENT) });
  await run('run-a', contacts[0].id, 'A');
  await run('run-b', contacts[1].id, 'B');
  const router = new CrmApiRouter(repo, {
    mailboxStore: new MemoryMailboxStore(),
    marketing: { store: mstore, env: {}, lock: new MemoryLockStore(), now: () => new Date(NOW) },
    workflows: { store, env: {}, lock: new MemoryLockStore(), now: () => new Date(NOW) },
    signalStore: signals,
  });
  return { repo, contacts, camp, mstore, signals, store, router, won, open };
}

const get = (router: CrmApiRouter, p: string, query: Record<string, string>) => router.dispatch({ method: 'GET', path: p, query: { from: '2026-08-21', to: '2026-11-19', ...query } });

// ----------------------------------------------------------------------------
describe('Fase 5 — classificacao de sinais', () => {
  it('abertura: Apple MPP (rede e UA), proxy do Gmail, sem UA e abertura imediata sao automaticas; navegador e observada', () => {
    const sentAt = iso(SENT);
    const at = iso(SENT + 3600000);
    assert.equal(classifySignal({ kind: 'OPEN', userAgent: 'Mozilla/5.0', ip: '17.58.10.20', sentAt, at }).classification, 'OPEN_MACHINE');
    assert.equal(classifySignal({ kind: 'OPEN', userAgent: 'Mozilla/5.0', ip: '200.1.2.3', sentAt, at }).classification, 'OPEN_MACHINE');
    const g = classifySignal({ kind: 'OPEN', userAgent: 'Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)', ip: '66.102.8.1', sentAt, at });
    assert.equal(g.classification, 'OPEN_MACHINE');
    assert.ok(g.reasons.length >= 1);
    assert.equal(classifySignal({ kind: 'OPEN', userAgent: null, ip: '200.1.2.3', sentAt, at }).classification, 'OPEN_MACHINE');
    assert.equal(classifySignal({ kind: 'OPEN', userAgent: CHROME, ip: '200.1.2.3', sentAt, at: iso(SENT + 10_000) }).classification, 'OPEN_MACHINE');
    const h = classifySignal({ kind: 'OPEN', userAgent: CHROME, ip: '200.1.2.3', sentAt, at });
    assert.equal(h.classification, 'OPEN_OBSERVED');
    assert.equal(h.ipNetwork, '200.1.2.0/24');
    assert.equal(h.secondsSinceSent, 3600);
  });
  it('clique: HEAD, scanner, rede Microsoft EOP, clique rapido e rajada sao robo; navegador depois de minutos e humano', () => {
    const sentAt = iso(SENT);
    const at = iso(SENT + 600_000);
    assert.equal(classifySignal({ kind: 'CLICK', userAgent: CHROME, ip: '200.1.2.3', sentAt, at, method: 'HEAD' }).classification, 'CLICK_BOT');
    assert.equal(classifySignal({ kind: 'CLICK', userAgent: 'Mozilla/5.0 (compatible; Barracuda Sentinel)', ip: '200.1.2.3', sentAt, at }).classification, 'CLICK_BOT');
    assert.equal(classifySignal({ kind: 'CLICK', userAgent: 'python-requests/2.31', ip: '200.1.2.3', sentAt, at }).classification, 'CLICK_BOT');
    assert.equal(classifySignal({ kind: 'CLICK', userAgent: CHROME, ip: '40.107.1.2', sentAt, at }).classification, 'CLICK_BOT');
    const fast = classifySignal({ kind: 'CLICK', userAgent: CHROME, ip: '200.1.2.3', sentAt, at: iso(SENT + (FAST_CLICK_SECONDS - 5) * 1000) });
    assert.equal(fast.classification, 'CLICK_BOT');
    assert.ok(fast.reasons.some((r) => /s/.test(r)));
    assert.equal(classifySignal({ kind: 'CLICK', userAgent: CHROME, ip: '200.1.2.3', sentAt, at, priorClickTimes: [iso(SENT + 599_500)] }).classification, 'CLICK_BOT');
    const human = classifySignal({ kind: 'CLICK', userAgent: CHROME, ip: '200.1.2.3', sentAt, at });
    assert.equal(human.classification, 'CLICK_HUMAN');
    assert.ok(human.reasons.length >= 1, 'motivo sempre registrado');
    // faixa extra por variavel de ambiente
    assert.equal(classifySignal({ kind: 'CLICK', userAgent: CHROME, ip: '203.0.113.9', sentAt, at, env: { ANALYTICS_PROXY_CIDRS: '203.0.113.0/24' } }).classification, 'CLICK_BOT');
  });
  it('LGPD: IP truncado (/24 e /48); CIDR; resposta positiva/negativa por termos com motivo', () => {
    assert.equal(truncateIp('189.10.20.30'), '189.10.20.0/24');
    assert.equal(truncateIp('2804:14c:abcd:1234::1'), '2804:14c:abcd::/48');
    assert.equal(truncateIp('lixo'), null);
    assert.ok(ipInCidr('17.1.2.3', '17.0.0.0/8'));
    assert.ok(!ipInCidr('18.1.2.3', '17.0.0.0/8'));
    assert.equal(classifyReply('Tenho interesse, podemos agendar?').sentiment, 'POSITIVE');
    assert.equal(classifyReply('Não tenho interesse, remova meu e-mail').sentiment, 'NEGATIVE');
    assert.equal(classifyReply('Recebido.').sentiment, 'NEUTRAL');
    assert.ok(classifyReply('Tenho interesse').reason.length > 0);
  });
});

describe('Fase 5 — sinais rastreados e contadores das cadencias', () => {
  it('rota publica /api/email-track grava o sinal classificado (sem mudar a resposta) e o IP sai truncado', async () => {
    const store = new MemoryMailboxStore();
    const signals = new MemorySignalStore();
    const trackingId = newTrackingId();
    const msg: CrmEmailMessage = {
      id: 'eml-f5', accountId: 'mbx', ownerEmail: 'a@setatelecom.com.br', externalId: 'mkt:mcmp-1:c1', conversationId: 'c', internetMessageId: null,
      direction: 'ENVIADO', source: 'STI_HUB', fromAddress: 'a@setatelecom.com.br', fromName: 'A', to: ['qa@example.test'], cc: [], subject: 'S', bodyPreview: '',
      occurredAt: new Date(Date.now() - OPEN_GRACE_MS - 600_000).toISOString(), contactId: 'c1', companyId: null, dealId: null, trackingId,
      links: ['https://setatelecom.com.br/fibra'], openCount: 0, clickCount: 0, lastOpenedAt: null, lastClickedAt: null, createdAt: new Date().toISOString(),
    };
    await store.insertMessage(msg);
    const lim = () => new SlidingWindowRateLimiter(100, 60000);
    const o = await handleEmailTrackRequest(`/api/email-track/o/${trackingId}/${trackingSignature(trackingId)}`, store, '17.58.1.2', lim(), { userAgent: 'Mozilla/5.0', method: 'GET', signals });
    assert.equal(o.status, 200);
    const c = await handleEmailTrackRequest(`/api/email-track/c/${trackingId}/0/${trackingSignature(trackingId, 0)}`, store, '189.10.20.30', lim(), { userAgent: CHROME, method: 'GET', signals });
    assert.equal(c.status, 302);
    assert.equal(c.headers.get('location'), 'https://setatelecom.com.br/fibra');
    const list = await signals.listByTracking([trackingId]);
    assert.equal(list.length, 2);
    const open = list.find((s) => s.kind === 'OPEN')!;
    const click = list.find((s) => s.kind === 'CLICK')!;
    assert.equal(open.classification, 'OPEN_MACHINE');
    assert.equal(click.classification, 'CLICK_HUMAN');
    assert.equal(click.campaignId, 'mcmp-1');
    assert.equal(click.url, 'https://setatelecom.com.br/fibra');
    assert.equal(click.ipNetwork, '189.10.20.0/24');
    assert.ok(!JSON.stringify(list).includes('189.10.20.30'), 'IP completo nunca gravado');
    // falha no armazenamento de sinais nao muda a resposta
    const broken = { record: async () => { throw new Error('x'); }, listByTracking: async () => [], listSince: async () => [], listByContact: async () => [] } as any;
    const c2 = await handleEmailTrackRequest(`/api/email-track/c/${trackingId}/0/${trackingSignature(trackingId, 0)}`, store, '189.10.20.30', lim(), { userAgent: CHROME, signals: broken });
    assert.equal(c2.status, 302);
  });
  it('webhook Resend: clique traz user-agent/IP para classificar', () => {
    const ev = normalizeResendEvent('evt-1', { type: 'email.clicked', created_at: '2026-11-02T10:00:00.000Z', data: { email_id: 'pm-1', to: ['qa@example.test'], click: { link: 'https://setatelecom.com.br/x', userAgent: 'Barracuda', ipAddress: '1.2.3.4' } } });
    assert.ok(ev);
    assert.equal(ev!.type, 'CLICKED');
    assert.equal(ev!.userAgent, 'Barracuda');
    assert.equal(ev!.ip, '1.2.3.4');
  });
  it('sincroniza aberturas/cliques classificados nos contadores da cadencia (idempotente; aberturas automaticas nao contam)', async () => {
    const { repo, signals, contacts } = await scenario();
    await signals.record(sig({ kind: 'OPEN', classification: 'OPEN_MACHINE', at: iso(SENT + DAY + 10), contactId: contacts[2].id, trackingId: 't3' }));
    const a = await syncSequenceEngagement(repo, signals);
    assert.equal(a.enrollmentsUpdated, 1);
    const e = repo.listSequenceEnrollments().find((x) => x.id === 'enr-f5-1')!;
    assert.equal(e.openCount, 1);
    assert.equal(e.clickCount, 1);
    const eng = (e.stepDeliveries![0] as any).engagement;
    assert.deepEqual([eng.opensObserved, eng.opensMachine, eng.clicksHuman, eng.clicksBot], [1, 1, 1, 0]);
    const b = await syncSequenceEngagement(repo, signals);
    assert.equal(b.enrollmentsUpdated, 0, 'segunda execucao nao altera nada');
  });
});

describe('Fase 5 — 20 perguntas, drill-down e relatorios', () => {
  it('responde as 20 perguntas com contadores separados (humano x observado) e drill-down ate o contato', async () => {
    const { router, contacts, camp } = await scenario();
    const r = await get(router, '/api/analytics/overview', ADMIN());
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const d = (r.body as any).data;
    assert.equal(d.questions.length, 20);
    assert.deepEqual(d.questions.map((q: any) => q.id), ANALYTICS_QUESTIONS.map((q) => q.id));
    assert.equal(d.counters.clicksHuman, 2);
    assert.equal(d.counters.clicksBot, 1);
    assert.equal(d.counters.opensMachine, 1);
    assert.equal(d.counters.opensObserved, 1);
    assert.ok(d.counters.classificationReasons.some((x: any) => /Apple/.test(x.reason)));
    const q = (id: number) => d.questions.find((x: any) => x.id === id);
    assert.equal(q(1).groups.find((g: any) => g.key === 'ALL').count, 4 - 1, 'tres contatos receberam (campanha + cadencia)');
    assert.equal(q(3).groups.find((g: any) => g.key === 'CLICK_HUMAN').count, 2);
    assert.equal(q(3).groups.find((g: any) => g.key === 'CLICK_BOT_ONLY').count, 1);
    assert.equal(q(6).groups[0].count, 1);
    assert.equal(q(11).groups[0].count, 1);
    // drill-down: clique humano lista os contatos
    const dr = await get(router, '/api/analytics/drill', { ...ADMIN(), q: '3', group: 'CLICK_HUMAN' });
    assert.equal(dr.status, 200);
    const ids = (dr.body as any).data.rows.map((x: any) => x.contactId).sort();
    assert.deepEqual(ids, [contacts[0].id, contacts[2].id].sort());
    assert.ok(!JSON.stringify((dr.body as any).data.rows).includes('90000-000'), 'drill-down sem telefone');
    // Q7: quem nunca engajou (so abertura automatica / clique de robo) = c1
    const never = await get(router, '/api/analytics/drill', { ...ADMIN(), q: '7', group: 'NEVER' });
    assert.deepEqual((never.body as any).data.rows.map((x: any) => x.contactId), [contacts[1].id]);
    // Q15/Q19: campanha influenciou o negocio ganho; receita linear
    const q15 = q(15).groups.find((g: any) => g.key.includes(camp.id));
    assert.ok(q15 && q15.count >= 1, JSON.stringify(q(15)));
    const q19 = q(19).groups.find((g: any) => g.key.includes(camp.id));
    assert.ok(q19, JSON.stringify(q(19)));
    assert.equal(q19.value, 12000);
  });
  it('LGPD: contato suprimido aparece com e-mail mascarado e o motivo; nunca telefone', async () => {
    const { router, contacts } = await scenario();
    const dr = await get(router, '/api/analytics/drill', { ...ADMIN(), q: '11', group: 'ALL' });
    const row = (dr.body as any).data.rows[0];
    assert.equal(row.contactId, contacts[1].id);
    assert.equal(row.email, maskEmail(contacts[1].email));
    assert.ok(row.email.startsWith('q***@'));
    assert.equal(row.suppressed, true);
    assert.match(row.suppressionReason, /Descadastrado/);
    assert.ok(!('phone' in row));
  });
  it('RBAC: vendedor (escopo proprios) ve so os proprios contatos; sem acesso ao ERP a pergunta 16 fica indisponivel', async () => {
    const { router, contacts } = await scenario();
    const r = await get(router, '/api/analytics/overview', SELLER());
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const d = (r.body as any).data;
    assert.equal(d.scope.restricted, true);
    assert.equal(d.questions.find((x: any) => x.id === 1).groups.find((g: any) => g.key === 'ALL').count, 1);
    const dr = await get(router, '/api/analytics/drill', { ...SELLER(), q: '3', group: 'CLICK_HUMAN' });
    assert.deepEqual((dr.body as any).data.rows.map((x: any) => x.contactId), [contacts[0].id]);
    const other = await get(router, `/api/analytics/contacts/${contacts[2].id}/signals`, SELLER());
    assert.equal(other.status, 404, 'contato de outro vendedor nao vaza');
    const noErp = await get(router, '/api/analytics/overview', SELLER({ moduleAccess: { crm: true, erp: false, chamados: true }, enabledModules: ['CRM'] }));
    assert.equal(noErp.status, 200, JSON.stringify(noErp.body));
    assert.equal((noErp.body as any).data.scope.erpAllowed, false);
    assert.equal((noErp.body as any).data.questions.find((x: any) => x.id === 16).available, false);
    const admin = await get(router, '/api/analytics/overview', ADMIN());
    assert.equal((admin.body as any).data.questions.find((x: any) => x.id === 16).available, true);
    // sem sessao / sem 2FA / sem CRM
    assert.equal((await get(router, '/api/analytics/overview', { ...HTTP })).status, 401);
    assert.equal((await get(router, '/api/analytics/overview', SELLER({ mfaVerified: false }))).status, 401);
    assert.equal((await get(router, '/api/analytics/overview', SELLER({ moduleAccess: { crm: false, erp: false, chamados: true }, enabledModules: ['CHAMADOS'] }))).status === 200, false);
  });
  it('conversao por passo de cadencia, caminhos A/B do workflow e coortes', async () => {
    const { router } = await scenario();
    const s = await get(router, '/api/analytics/sequences', ADMIN());
    const step = (s.body as any).data.sequences[0].steps.find((p: any) => p.stepOrder === 1);
    assert.equal(step.sent, 1);
    assert.equal(step.opensObserved, 1);
    assert.equal(step.clicksHuman, 1);
    assert.equal(step.replies, 1);
    assert.equal(step.opportunities, 1);
    const w = await get(router, '/api/analytics/workflows', ADMIN());
    const split = (w.body as any).data.splits[0];
    assert.equal(split.workflowName, 'Fluxo AB Sintetico');
    const A = split.variants.find((v: any) => v.id === 'A');
    const B = split.variants.find((v: any) => v.id === 'B');
    assert.deepEqual([A.runs, A.humanEngaged, A.opportunities, A.wonValue], [1, 1, 1, 12000]);
    assert.deepEqual([B.runs, B.humanEngaged, B.opportunities, B.wonValue], [1, 0, 0, 0], 'clique de scanner nao conta como engajamento');
    const c = await get(router, '/api/analytics/cohorts', ADMIN());
    const nov = (c.body as any).data.cohorts.find((k: any) => k.cohort === '2026-11');
    assert.equal(nov.size, 3);
    assert.equal(nov.humanEngagedPct[0], 66.7);
  });
  it('registros simulados so entram com o filtro ligado', async () => {
    const { router, repo, contacts } = await scenario();
    const seq = repo.listSequences()[0];
    repo.saveSequenceEnrollment({ id: 'enr-sim', sequenceId: seq.id, contactId: contacts[3].id, dealId: null, status: 'ACTIVE' as any, currentStepOrder: 1, stepsCompleted: 1, sentCount: 1, openCount: 1, clickCount: 0, repliedAt: null, replySnippet: null, nextStepDueAt: null, history: [{ stepOrder: 1, action: 'SENT', timestamp: iso(SENT), detail: 'sim' }, { stepOrder: 1, action: 'OPENED', timestamp: iso(SENT + 1000), detail: 'sim' }], enrolledAt: iso(SENT), updatedAt: iso(SENT) } as any);
    const off = await get(router, '/api/analytics/overview', ADMIN());
    const on = await get(router, '/api/analytics/overview', { ...ADMIN(), includeSimulated: '1' });
    const n = (r: any) => r.body.data.questions[0].groups.find((g: any) => g.key === 'ALL').count;
    assert.equal(n(off), 3);
    assert.equal(n(on), 4);
  });
  it('periodo: AAAA-MM-DD em horario de Brasilia; invalido ou maior que 2 anos e recusado', async () => {
    const p = parsePeriod({ from: '2026-11-01', to: '2026-11-19' }, new Date(NOW))!;
    assert.equal(p.from, '2026-11-01T03:00:00.000Z');
    assert.equal(p.to, '2026-11-20T02:59:59.999Z');
    assert.equal(parsePeriod({ from: '2020-01-01', to: '2026-11-19' }, new Date(NOW)), null);
    assert.equal(parsePeriod({ from: '2026-11-19', to: '2026-11-01' }, new Date(NOW)), null);
    const { router } = await scenario();
    assert.equal((await get(router, '/api/analytics/overview', { ...ADMIN(), from: '2020-01-01' })).status, 400);
  });
});

describe('Fase 5 — exportacao', () => {
  it('CSV/XLSX/PDF validos; formula injection neutralizada', () => {
    assert.equal(safeCell('=HYPERLINK("x")'), "'=HYPERLINK(\"x\")");
    assert.equal(safeCell('+1'), "'+1");
    assert.equal(safeCell(10), '10');
    const t = { title: 'Teste', subtitle: 'Sub', columns: ['A', 'B'], rows: [['=1+1', 2], ['ação', null]] as Array<Array<string | number | null>> };
    const csv = toCsv(t).toString('utf8');
    assert.ok(csv.startsWith('\uFEFF'));
    assert.ok(csv.includes("'=1+1"));
    assert.ok(csv.includes('ação'));
    const x = toXlsx(t);
    assert.equal(x.subarray(0, 2).toString('latin1'), 'PK');
    // le a central directory e confere o CRC de cada arquivo
    const names: string[] = [];
    let off = 0;
    while (x.readUInt32LE(off) === 0x04034b50) {
      const method = x.readUInt16LE(off + 8);
      const crc = x.readUInt32LE(off + 14);
      const csize = x.readUInt32LE(off + 18);
      const nlen = x.readUInt16LE(off + 26);
      const elen = x.readUInt16LE(off + 28);
      const name = x.subarray(off + 30, off + 30 + nlen).toString('utf8');
      const raw = x.subarray(off + 30 + nlen + elen, off + 30 + nlen + elen + csize);
      const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
      assert.equal(crc32(data), crc, name);
      if (name === 'xl/worksheets/sheet1.xml') assert.ok(data.toString('utf8').includes("'=1+1"));
      names.push(name);
      off += 30 + nlen + elen + csize;
    }
    assert.ok(names.includes('[Content_Types].xml') && names.includes('xl/workbook.xml') && names.includes('xl/worksheets/sheet1.xml'));
    const pdf = toPdf(t).toString('latin1');
    assert.ok(pdf.startsWith('%PDF-'));
    assert.ok(pdf.trimEnd().endsWith('%%EOF'));
  });
  it('exportacao pela API: escopo/LGPD aplicados, auditoria registrada e nada criado no ERP (sem fatura/NF)', async () => {
    const { router, repo, contacts } = await scenario();
    const invoicesBefore = repo.listInvoices().length;
    const contractsBefore = repo.listRentalContracts().length;
    const dealsBefore = repo.listDeals().length;
    for (const format of ['csv', 'xlsx', 'pdf']) {
      for (const report of ['questions', 'sequences', 'workflows', 'cohorts']) {
        const r = await router.dispatch({ method: 'POST', path: '/api/analytics/export', query: ADMIN(), body: { format, report, from: '2026-08-21', to: '2026-11-19' } });
        assert.equal(r.status, 200, `${format}/${report}: ${JSON.stringify(r.body)}`);
        assert.ok((r.body as any).data.base64.length > 10);
      }
    }
    const drill = await router.dispatch({ method: 'POST', path: '/api/analytics/export', query: ADMIN(), body: { format: 'csv', report: 'drill', q: 11, group: 'ALL', from: '2026-08-21', to: '2026-11-19' } });
    const csv = Buffer.from((drill.body as any).data.base64, 'base64').toString('utf8');
    assert.ok(csv.includes(maskEmail(contacts[1].email)));
    assert.ok(!csv.includes(contacts[1].email), 'e-mail do suprimido nao sai inteiro');
    assert.ok(!csv.includes('90000-000'));
    const seller = await router.dispatch({ method: 'POST', path: '/api/analytics/export', query: SELLER(), body: { format: 'csv', report: 'drill', q: 1, group: 'ALL', from: '2026-08-21', to: '2026-11-19' } });
    const scsv = Buffer.from((seller.body as any).data.base64, 'base64').toString('utf8');
    assert.ok(scsv.includes(contacts[0].email) && !scsv.includes(contacts[2].email), 'vendedor exporta so os proprios');
    const logs = repo.listSecurityAuditLogs(200) as any;
    const items = Array.isArray(logs) ? logs : logs.items || logs.logs || [];
    assert.ok(items.some((l: any) => l.action === 'ANALYTICS_EXPORT'), 'exportacao auditada');
    assert.ok(!JSON.stringify(items.filter((l: any) => l.action === 'ANALYTICS_EXPORT')).includes('example.test'), 'auditoria sem e-mail de contato');
    assert.equal((await router.dispatch({ method: 'POST', path: '/api/analytics/export', query: ADMIN(), body: { format: 'docx', report: 'questions' } })).status, 400);
    assert.equal(repo.listInvoices().length, invoicesBefore);
    assert.equal(repo.listRentalContracts().length, contractsBefore);
    assert.equal(repo.listDeals().length, dealsBefore);
  });
  it('isolamento: modulos de analytics nao importam ERP nem escrevem no ERP; UI sem emojis; middleware protege /api/analytics como CRM', () => {
    const dir = path.join(process.cwd(), 'src/modules/analytics');
    const files = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n') + fs.readFileSync(path.join(process.cwd(), 'src/api/analytics-routes.ts'), 'utf8');
    for (const bad of ['createInvoice', 'createRentalContract', 'issueNfse', 'emitNf', 'createProposal(', 'updateDeal(', 'createDeal(']) assert.ok(!files.includes(bad), bad);
    const ui = fs.readFileSync(path.join(process.cwd(), 'src/app/components/AnalyticsEngagementTab.tsx'), 'utf8');
    assert.ok(!/\p{Extended_Pictographic}/u.test(ui), 'sem emojis');
    const mw = fs.readFileSync(path.join(process.cwd(), 'src/middleware.ts'), 'utf8');
    assert.ok(mw.includes("clean.startsWith('/api/analytics/')"));
  });
});
