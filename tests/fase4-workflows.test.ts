// ============================================================================
// Fase 4 (19/11/2026) — Automacoes visuais duraveis (DAG). Trava, ESP, webhook e relogio SEMPRE
// injetados. Nenhum e-mail real e nenhuma chamada de rede; contatos sinteticos.
// ============================================================================
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository, type CrmRepository } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT, isAuthorizedWorkflowsCron, shouldPersistAfterDispatch } from '../src/api/router';
import { MemoryLockStore } from '../src/db/distributed-lock';
import { MemoryMailboxStore } from '../src/modules/email/mailbox-store';
import { MemoryMarketingStore } from '../src/modules/marketing/marketing-store';
import { WF_ACTIONS, WF_TRIGGERS } from '../src/modules/workflows/dag/catalog';
import { findWorkflowReferenceCycle, validateWorkflowGraph, type WfGraph, type WfNode } from '../src/modules/workflows/dag/graph';
import { MemoryWorkflowStore } from '../src/modules/workflows/dag/store';
import { evaluateWfCondition, pickVariant, runWorkflowsTick, type WebhookFetch, type WorkflowDeps } from '../src/modules/workflows/dag/engine';
import type { HttpFetch } from '../src/modules/marketing/esp-adapters';

const HTTP = { _fromHttpBridge: '1' };
const tok = (uid: string, email: string, roleId: string, extra: Record<string, unknown> = {}) =>
  signStiHubSessionToken({
    uid, email, name: 'Teste', roleId, scope: roleId === 'SUPER_ADMIN' ? 'TODOS' : 'PROPRIOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000, ...extra,
  } as Parameters<typeof signStiHubSessionToken>[0]);
const ADMIN = () => ({ ...HTTP, _sessionToken: tok('usr-seta-01', 'marcelo.mira@setatelecom.com.br', 'SUPER_ADMIN', { canManageUsersRbac: true }) });
const SELLER = () => ({ ...HTTP, _sessionToken: tok('usr-seta-03', 'marialuiza@setatelecom.com.br', 'VENDEDOR_SALES') });
const CRON = () => ({ ...HTTP, _cronAuthorized: '1' });

const KEY_SAVED = process.env.STI_HUB_MAILBOX_ENC_KEY;
beforeEach(() => {
  process.env.STI_HUB_MAILBOX_ENC_KEY = crypto.randomBytes(32).toString('base64url');
});
afterEach(() => {
  if (KEY_SAVED === undefined) delete process.env.STI_HUB_MAILBOX_ENC_KEY;
  else process.env.STI_HUB_MAILBOX_ENC_KEY = KEY_SAVED;
});

const MKT_DOMAIN = 'news.setatelecom.com.br';
function mktEnv(live: boolean): Record<string, string> {
  return {
    MARKETING_LIVE_SEND: live ? 'true' : 'false',
    MARKETING_ESP_PROVIDER: 'resend',
    MARKETING_RESEND_API_KEY: 're_teste_nunca_real',
    MARKETING_FROM_EMAIL: `news@${MKT_DOMAIN}`,
    MARKETING_FROM_NAME: 'Seta Telecom',
    MARKETING_POSTAL_ADDRESS: 'Rua Exemplo, 100 - Sao Paulo/SP - CEP 01000-000',
    MARKETING_UNSUBSCRIBE_SECRET: 'u'.repeat(40),
    MARKETING_TEST_RECIPIENTS: 'qa1@example.test,qa2@example.test',
  };
}
const GOOD_DNS: Record<string, string[][]> = {
  [`send.${MKT_DOMAIN}`]: [['v=spf1 include:amazonses.com ~all']],
  [`resend._domainkey.${MKT_DOMAIN}`]: [['p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC1234567890abcdef']],
  [`_dmarc.${MKT_DOMAIN}`]: [['v=DMARC1; p=quarantine; rua=mailto:dmarc@setatelecom.com.br']],
};

class Clock {
  t = Date.parse('2026-11-19T12:00:00.000Z');
  now = () => new Date(this.t);
  advance(min: number) {
    this.t += min * 60000;
  }
}

function setup(opts: { live?: boolean; mktLive?: boolean; env?: Record<string, string> } = {}) {
  const repo = createInMemoryRepository();
  const contacts = repo.listContacts().slice(0, 3);
  contacts.forEach((c, i) => {
    c.email = `qa${i + 1}@example.test`;
    c.lgpdConsent = true;
    c.subscriptionStatus = 'SUBSCRIBED';
    c.isValidEmail = true;
    c.isDisposableEmail = false;
    c.communicationCategories = ['NEWSLETTER_TECNICA'];
    c.customProperties = {};
    c.leadScore = 40;
  });
  const st = repo.getState() as { suppressionList?: Array<{ email: string; contactId: string | null }> };
  st.suppressionList = (st.suppressionList || []).filter((s) => !contacts.some((c) => c.id === s.contactId || c.email === s.email));
  const env: NodeJS.ProcessEnv = { ...mktEnv(Boolean(opts.mktLive)), ...(opts.live ? { WORKFLOWS_LIVE: 'true' } : {}), ...(opts.env || {}) };
  const clock = new Clock();
  const lock = new MemoryLockStore();
  const store = new MemoryWorkflowStore();
  const mstore = new MemoryMarketingStore();
  const espCalls: string[] = [];
  const espFetch: HttpFetch = async (url) => {
    espCalls.push(url);
    return { ok: true, status: 200, json: async () => ({ id: 'x' }), text: async () => '{}', headers: { get: () => null } };
  };
  const hooks: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const webhookFetch: WebhookFetch = async (url, init) => {
    hooks.push({ url, headers: init.headers, body: init.body });
    return { ok: true, status: 200 };
  };
  const router = new CrmApiRouter(repo, {
    mailboxStore: new MemoryMailboxStore(),
    marketing: { store: mstore, env, espFetch, lock, resolver: async (h) => GOOD_DNS[h] || [], sleep: async () => undefined, origin: 'https://sti-hub.example.test', now: clock.now },
    workflows: { store, env, lock, now: clock.now, webhookFetch },
  });
  return { repo, contacts, env, clock, lock, store, mstore, espCalls, hooks, webhookFetch, router };
}

const act = (id: string, action: WfNode['action'], config: Record<string, unknown>, next: string | null = null, branches?: Record<string, string | null>): WfNode => ({
  id, kind: 'ACTION', action, config, next, ...(branches ? { branches } : {}),
});
const delay = (id: string, minutes: number, next: string | null): WfNode => ({ id, kind: 'DELAY', config: { minutes }, next });
const graph = (trigger: WfGraph['trigger']['type'], nodes: WfNode[], extra: Partial<WfGraph> = {}): WfGraph => ({
  trigger: { type: trigger, config: {} },
  startNodeId: nodes[0]?.id || null,
  nodes,
  reentry: { mode: 'NEVER', cooldownDays: 0 },
  ...extra,
});

async function createActive(router: CrmApiRouter, g: WfGraph, contactId: string, name = 'Fluxo teste'): Promise<string> {
  const c = await router.dispatch({ method: 'POST', path: '/api/workflows/v2', query: ADMIN(), body: { name, graph: g } });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const id = (c.body as any).data.id as string;
  const s = await router.dispatch({ method: 'POST', path: `/api/workflows/v2/${id}/simulate`, query: ADMIN(), body: { contactId } });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.ok((s.body as any).data.simulation.ok, JSON.stringify((s.body as any).data.simulation));
  const a = await router.dispatch({ method: 'POST', path: `/api/workflows/v2/${id}/activate`, query: ADMIN(), body: {} });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  return id;
}

const cron = async (router: CrmApiRouter) => {
  const r = await router.dispatch({ method: 'GET', path: '/api/cron/workflows', query: CRON() });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return (r.body as any).data;
};
const emit = (router: CrmApiRouter, type: string, contactId: string, extra: Record<string, unknown> = {}) =>
  router.dispatch({ method: 'POST', path: '/api/workflows/v2/events', query: ADMIN(), body: { type, contactId, ...extra } });

// ----------------------------------------------------------------------------
describe('Fase 4: catálogo e validação do grafo', () => {
  it('20 gatilhos e 17 ações do roadmap', () => {
    assert.equal(WF_TRIGGERS.length, 20);
    assert.equal(WF_ACTIONS.length, 17);
    assert.equal(new Set(WF_TRIGGERS).size, 20);
    assert.equal(new Set(WF_ACTIONS).size, 17);
  });

  it('detecta ciclo (com o caminho), auto-ligação, nó solto, percentuais e campo protegido', () => {
    const cyc = validateWorkflowGraph(graph('CONTACT_CREATED', [act('a', 'TAG', { tag: 'x', mode: 'ADD' }, 'b'), act('b', 'NOTIFY_SELLER', { message: 'oi' }, 'a')]));
    assert.equal(cyc.ok, false);
    assert.deepEqual(cyc.cycle, ['a', 'b', 'a']);
    const self = validateWorkflowGraph(graph('CONTACT_CREATED', [act('a', 'TAG', { tag: 'x', mode: 'ADD' }, 'a')]));
    assert.ok(self.errors.some((e) => e.includes('ele mesmo')));
    const loose = validateWorkflowGraph(graph('CONTACT_CREATED', [act('a', 'END_FLOW', {}), act('b', 'NOTIFY_SELLER', { message: 'oi' })]));
    assert.ok(loose.errors.some((e) => e.includes('não é alcançável')));
    const pct = validateWorkflowGraph(graph('CONTACT_CREATED', [act('s', 'PERCENT_SPLIT', { variants: [{ id: 'a', label: 'A', percent: 50 }, { id: 'b', label: 'B', percent: 40 }] }, null, { a: null, b: null })]));
    assert.ok(pct.errors.some((e) => e.includes('somam 90%')));
    const prot = validateWorkflowGraph(graph('CONTACT_CREATED', [act('u', 'UPDATE_PROPERTY', { field: 'email', value: 'x@y.z' })]));
    assert.ok(prot.errors.some((e) => e.includes('protegidos')));
    const lgpd = validateWorkflowGraph(graph('CONTACT_CREATED', [act('u', 'UPDATE_PROPERTY', { field: 'lgpdConsent', value: 'true' })]));
    assert.equal(lgpd.ok, false);
    const hook = validateWorkflowGraph(graph('CONTACT_CREATED', [act('w', 'SEND_WEBHOOK', { url: 'http://inseguro.example.test' })]));
    assert.ok(hook.errors.some((e) => e.includes('https')));
    const reentry = validateWorkflowGraph(graph('CONTACT_CREATED', [act('a', 'END_FLOW', {})], { reentry: { mode: 'ALWAYS', cooldownDays: 0 } }));
    assert.ok(reentry.errors.some((e) => e.includes('Reentrada')));
  });

  it('ciclo entre fluxos pela reativação (A -> B -> A)', () => {
    const edges = new Map([['wfd-a', ['wfd-b']], ['wfd-b', ['wfd-a']]]);
    assert.deepEqual(findWorkflowReferenceCycle(edges, 'wfd-a'), ['wfd-a', 'wfd-b', 'wfd-a']);
    assert.equal(findWorkflowReferenceCycle(new Map([['wfd-a', ['wfd-b']]]), 'wfd-a'), null);
  });

  it('condições (inclusive tag e custom) e divisão determinística ~proporcional', () => {
    const { contacts } = setup();
    const c = contacts[0];
    c.customProperties = { tags: ['VIP'], segmento: 'isp' };
    assert.ok(evaluateWfCondition(c, { field: 'tags', operator: 'HAS_TAG', value: 'vip' }));
    assert.ok(evaluateWfCondition(c, { field: 'custom.segmento', operator: 'EQUALS', value: 'ISP' }));
    assert.ok(evaluateWfCondition(c, { field: 'leadScore', operator: 'GREATER_THAN', value: 10 }));
    const vs = [{ id: 'a', label: 'A', percent: 20 }, { id: 'b', label: 'B', percent: 80 }];
    assert.equal(pickVariant('c1:n1', vs).id, pickVariant('c1:n1', vs).id);
    let a = 0;
    for (let i = 0; i < 2000; i++) if (pickVariant(`c${i}:n1`, vs).id === 'a') a++;
    assert.ok(a > 300 && a < 500, `fração A=${a}/2000`);
  });
});

describe('Fase 4: construtor, simulação e ativação (API)', () => {
  it('vendedor sem controle total não cria; ativar exige simulação da versão atual', async () => {
    const { router, contacts } = setup();
    const g = graph('CONTACT_CREATED', [act('t', 'TAG', { tag: 'novo', mode: 'ADD' }, 'e'), act('e', 'END_FLOW', {})]);
    const denied = await router.dispatch({ method: 'POST', path: '/api/workflows/v2', query: SELLER(), body: { name: 'x', graph: g } });
    assert.equal(denied.status, 403);
    const c = await router.dispatch({ method: 'POST', path: '/api/workflows/v2', query: ADMIN(), body: { name: 'Boas-vindas', graph: g } });
    assert.equal(c.status, 201);
    const id = (c.body as any).data.id;
    const a0 = await router.dispatch({ method: 'POST', path: `/api/workflows/v2/${id}/activate`, query: ADMIN(), body: {} });
    assert.equal(a0.status, 409);
    assert.match((a0.body as any).error, /Simule/);
    const s = await router.dispatch({ method: 'POST', path: `/api/workflows/v2/${id}/simulate`, query: ADMIN(), body: { contactId: contacts[0].id } });
    const sim = (s.body as any).data.simulation;
    assert.equal(sim.ok, true);
    assert.equal(sim.liveEnabled, false);
    assert.deepEqual(sim.steps.map((x: any) => x.outcome), ['EXECUTARIA', 'FIM']);
    assert.deepEqual(contacts[0].customProperties, {}, 'simulação não altera o contato');
    const a1 = await router.dispatch({ method: 'POST', path: `/api/workflows/v2/${id}/activate`, query: ADMIN(), body: {} });
    assert.equal(a1.status, 200);
    // Editar => nova versão; ativar de novo exige nova simulação.
    const e = await router.dispatch({ method: 'PUT', path: `/api/workflows/v2/${id}`, query: ADMIN(), body: { graph: g } });
    assert.equal((e.body as any).data.version, 2);
    assert.equal((e.body as any).data.activeVersion, 1);
    const a2 = await router.dispatch({ method: 'POST', path: `/api/workflows/v2/${id}/activate`, query: ADMIN(), body: {} });
    assert.equal(a2.status, 409);
  });

  it('não ativa grafo com ciclo nem reativação circular entre fluxos', async () => {
    const { router, contacts } = setup();
    const bad = graph('CONTACT_CREATED', [act('a', 'TAG', { tag: 'x', mode: 'ADD' }, 'b'), act('b', 'TAG', { tag: 'y', mode: 'ADD' }, 'a')]);
    const c = await router.dispatch({ method: 'POST', path: '/api/workflows/v2', query: ADMIN(), body: { name: 'ciclo', graph: bad } });
    const id = (c.body as any).data.id;
    assert.equal((c.body as any).data.validation.ok, false);
    await router.dispatch({ method: 'POST', path: `/api/workflows/v2/${id}/simulate`, query: ADMIN(), body: { contactId: contacts[0].id } });
    const a = await router.dispatch({ method: 'POST', path: `/api/workflows/v2/${id}/activate`, query: ADMIN(), body: {} });
    assert.equal(a.status, 409);

    const idB = await createActive(router, graph('CUSTOM_EVENT', [act('e', 'END_FLOW', {})]), contacts[0].id, 'B');
    const idA = await createActive(router, graph('CUSTOM_EVENT', [act('r', 'START_REACTIVATION', { workflowId: idB, minInactiveDays: 30 })]), contacts[0].id, 'A');
    // B passa a reativar A => ciclo A -> B -> A.
    await router.dispatch({ method: 'PUT', path: `/api/workflows/v2/${idB}`, query: ADMIN(), body: { graph: graph('CUSTOM_EVENT', [act('r', 'START_REACTIVATION', { workflowId: idA, minInactiveDays: 30 })]) } });
    await router.dispatch({ method: 'POST', path: `/api/workflows/v2/${idB}/simulate`, query: ADMIN(), body: { contactId: contacts[0].id } });
    const loop = await router.dispatch({ method: 'POST', path: `/api/workflows/v2/${idB}/activate`, query: ADMIN(), body: {} });
    assert.equal(loop.status, 409);
    assert.match((loop.body as any).error, /Ciclo entre fluxos/);
  });

  it('simulação percorre if/else, divisão e atraso com tempo simulado', async () => {
    const { router, contacts } = setup();
    contacts[0].customProperties = { tags: ['VIP'] };
    const g = graph('FORM_SUBMITTED', [
      act('if', 'IF_ELSE', { condition: { field: 'tags', operator: 'HAS_TAG', value: 'VIP' } }, null, { yes: 'd', no: 'end' }),
      delay('d', 120, 'ab'),
      act('ab', 'AB_TEST', { variants: [{ id: 'a', label: 'Assunto A', percent: 50 }, { id: 'b', label: 'Assunto B', percent: 50 }] }, null, { a: 'sa', b: 'sb' }),
      act('sa', 'APPLY_LEAD_SCORE', { points: 10 }, 'end'),
      act('sb', 'APPLY_LEAD_SCORE', { points: 5 }, 'end'),
      act('end', 'END_FLOW', {}),
    ]);
    const c = await router.dispatch({ method: 'POST', path: '/api/workflows/v2', query: ADMIN(), body: { name: 'sim', graph: g } });
    const id = (c.body as any).data.id;
    const s = await router.dispatch({ method: 'POST', path: `/api/workflows/v2/${id}/simulate`, query: ADMIN(), body: { contactId: contacts[0].id } });
    const steps = (s.body as any).data.simulation.steps;
    assert.deepEqual(steps.map((x: any) => x.nodeId).slice(0, 3), ['if', 'd', 'ab']);
    assert.equal(steps[0].port, 'yes');
    assert.equal(Date.parse(steps[2].at) - Date.parse(steps[0].at), 120 * 60000);
    assert.equal(contacts[0].leadScore, 40, 'simulação não grava pontuação');
  });
});

describe('Fase 4: WORKFLOWS_LIVE desligado (padrão) = só simulação', () => {
  it('eventos não são gravados e o cron não executa nada', async () => {
    const { router, store, contacts, repo } = setup();
    await createActive(router, graph('CONTACT_CREATED', [act('t', 'CREATE_TASK', { title: 'Ligar' })]), contacts[0].id);
    const tasks0 = repo.listTasks().length;
    const created = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: '/api/contacts', body: { email: 'novo.flag@example.test', firstName: 'Novo', lastName: 'Flag' } });
    assert.equal(created.status, 201);
    const ev = await emit(router, 'CUSTOM_EVENT', contacts[0].id);
    assert.equal((ev.body as any).data.recorded, false);
    assert.equal((await store.listPendingEvents(100)).length, 0);
    const r = await cron(router);
    assert.equal(r.skipped, 'LIVE_DISABLED');
    assert.equal(repo.listTasks().length, tasks0);
  });
});

describe('Fase 4: execução durável (cron + trava global)', () => {
  it('contato criado -> tag, atraso, tarefa; idempotente entre execuções; histórico por contato', async () => {
    const { router, clock, repo } = setup({ live: true });
    const sample = repo.listContacts()[0].id;
    await createActive(router, graph('CONTACT_CREATED', [act('t', 'TAG', { tag: 'novo', mode: 'ADD' }, 'd'), delay('d', 60, 'k'), act('k', 'CREATE_TASK', { title: 'Ligar para o lead', dueInDays: 1 })]), sample);
    const created = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: '/api/contacts', body: { email: 'lead.wf@example.test', firstName: 'Lead', lastName: 'Fluxo' } });
    const cid = (created.body as any).data.id;
    const tasks0 = repo.listTasks().filter((t) => t.contactId === cid).length;
    const r1 = await cron(router);
    assert.equal(r1.runsStarted, 1);
    assert.equal(r1.runsWaiting, 1);
    assert.deepEqual(repo.getContactById(cid)!.customProperties!.tags, ['novo']);
    const r2 = await cron(router);
    assert.equal(r2.runsStarted, 0, 'mesmo evento não abre outra execução');
    assert.equal(r2.stepsExecuted, 0);
    clock.advance(61);
    const r3 = await cron(router);
    assert.equal(r3.runsCompleted, 1);
    await cron(router);
    assert.equal(repo.listTasks().filter((t) => t.contactId === cid && t.title === 'Ligar para o lead').length, tasks0 + 1, 'tarefa criada uma única vez');
    const hist = await router.dispatch({ method: 'GET', path: `/api/workflows/v2/contacts/${cid}/runs`, query: ADMIN() });
    const runs = (hist.body as any).data;
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, 'COMPLETED');
    assert.deepEqual(runs[0].steps.map((s: any) => [s.nodeId, s.outcome]), [['t', 'DONE'], ['d', 'DONE'], ['k', 'DONE']]);
  });

  it('reentrada: NEVER bloqueia; AFTER_COMPLETION respeita intervalo; nunca 2 execuções ativas', async () => {
    const { router, clock, contacts, store } = setup({ live: true });
    const c = contacts[0].id;
    const never = await createActive(router, graph('CUSTOM_EVENT', [delay('d', 30, 'e'), act('e', 'END_FLOW', {})]), c, 'never');
    const again = await createActive(router, graph('CUSTOM_EVENT', [delay('d', 30, 'e'), act('e', 'END_FLOW', {})], { reentry: { mode: 'AFTER_COMPLETION', cooldownDays: 1 } }), c, 'again');
    await emit(router, 'CUSTOM_EVENT', c);
    await cron(router);
    await emit(router, 'CUSTOM_EVENT', c);
    const r = await cron(router);
    assert.equal(r.runsStarted, 0, 'sem segunda execução enquanto a primeira está ativa');
    clock.advance(31);
    await cron(router);
    clock.advance(24 * 60);
    await emit(router, 'CUSTOM_EVENT', c);
    await cron(router);
    assert.equal((await store.listRunsFor(never, c)).length, 1, 'NEVER: só uma vez');
    assert.equal((await store.listRunsFor(again, c)).length, 2, 'AFTER_COMPLETION: volta após o intervalo');
  });

  it('dois crons simultâneos: a trava deixa um só executar; ação acontece uma vez', async () => {
    const { router, repo, contacts, store, lock, env, clock } = setup({ live: true });
    const c = contacts[0].id;
    await createActive(router, graph('CUSTOM_EVENT', [act('k', 'CREATE_TASK', { title: 'Tarefa única' })]), c);
    await emit(router, 'CUSTOM_EVENT', c);
    const deps: WorkflowDeps = { store, env, lock, now: clock.now };
    const [a, b] = await Promise.all([runWorkflowsTick(repo, deps), runWorkflowsTick(repo, deps)]);
    assert.ok([a.skipped, b.skipped].includes('RUN_LOCKED_ELSEWHERE'));
    await runWorkflowsTick(repo, deps);
    assert.equal(repo.listTasks().filter((t) => t.title === 'Tarefa única').length, 1);
  });

  it('execução que caiu no meio da ação vira "para revisar" com tarefa; não repete sozinha', async () => {
    const { router, repo, contacts, store, clock } = setup({ live: true });
    const c = contacts[0].id;
    const wf = await createActive(router, graph('CUSTOM_EVENT', [act('k', 'CREATE_TASK', { title: 'Ação crítica' }, 'n'), act('n', 'NOTIFY_SELLER', { message: 'seguir' })]), c);
    await emit(router, 'CUSTOM_EVENT', c);
    // Simula queda: execução criada e nó reservado (STARTED) sem concluir.
    const ev = (await store.listPendingEvents(10))[0];
    const iso = clock.now().toISOString();
    await store.createRun({ id: 'wfr-crash', workflowId: wf, workflowName: 'Fluxo teste', version: 1, contactId: c, status: 'ACTIVE', currentNodeId: 'k', wakeAt: iso, waitStartedAt: null, triggerEventId: ev.id, triggerType: 'CUSTOM_EVENT', depth: 0, variants: {}, lastError: null, startedAt: iso, updatedAt: iso, completedAt: null });
    await store.markEventProcessed(ev.id, iso);
    await store.claimStep({ runId: 'wfr-crash', nodeId: 'k', seq: 0, kind: 'ACTION', action: 'CREATE_TASK', outcome: 'STARTED', message: '', port: null, at: iso, finishedAt: null });
    const r = await cron(router);
    assert.equal(r.runsNeedingReview, 1);
    assert.equal(repo.listTasks().filter((t) => t.title === 'Ação crítica').length, 0, 'não reexecutou');
    assert.ok(repo.listTasks().some((t) => t.queueName === 'Automações' && t.title.startsWith('Conferir automação')));
    assert.equal((await store.getRun('wfr-crash'))!.status, 'NEEDS_REVIEW');
    const seller = await router.dispatch({ method: 'POST', path: '/api/workflows/v2/runs/wfr-crash/review', query: SELLER(), body: { decision: 'CONTINUE' } });
    assert.equal(seller.status, 403);
    const ok = await router.dispatch({ method: 'POST', path: '/api/workflows/v2/runs/wfr-crash/review', query: ADMIN(), body: { decision: 'CONTINUE' } });
    assert.equal(ok.status, 200);
    await cron(router);
    const run = (await store.getRun('wfr-crash'))!;
    assert.equal(run.status, 'COMPLETED');
    assert.equal(repo.listTasks().filter((t) => t.title === 'Ação crítica').length, 0);
  });

  it('esperar condição: segue por "atendida" quando a propriedade muda, ou por "prazo esgotado"', async () => {
    const { router, repo, contacts, clock } = setup({ live: true });
    const [c1, c2] = contacts;
    await createActive(router, graph('CUSTOM_EVENT', [
      act('w', 'WAIT_CONDITION', { condition: { field: 'lifecycleStage', operator: 'EQUALS', value: 'OPPORTUNITY' }, timeoutMinutes: 60 }, null, { met: 'm', timeout: 't' }),
      act('m', 'TAG', { tag: 'virou-oportunidade', mode: 'ADD' }),
      act('t', 'TAG', { tag: 'sem-resposta', mode: 'ADD' }),
    ]), c1.id);
    repo.updateContact(c1.id, { lifecycleStage: 'LEAD' } as any);
    repo.updateContact(c2.id, { lifecycleStage: 'LEAD' } as any);
    await emit(router, 'CUSTOM_EVENT', c1.id);
    await emit(router, 'CUSTOM_EVENT', c2.id);
    await cron(router);
    repo.updateContact(c1.id, { lifecycleStage: 'OPPORTUNITY' } as any);
    clock.advance(16);
    await cron(router);
    assert.deepEqual(repo.getContactById(c1.id)!.customProperties!.tags, ['virou-oportunidade']);
    clock.advance(60);
    await cron(router);
    assert.deepEqual(repo.getContactById(c2.id)!.customProperties!.tags, ['sem-resposta']);
  });

  it('divisão percentual grava o caminho sorteado na execução', async () => {
    const { router, contacts, store } = setup({ live: true });
    const c = contacts[0].id;
    const wf = await createActive(router, graph('CUSTOM_EVENT', [
      act('s', 'PERCENT_SPLIT', { variants: [{ id: 'a', label: 'A', percent: 30 }, { id: 'b', label: 'B', percent: 70 }] }, null, { a: 'ea', b: 'eb' }),
      act('ea', 'END_FLOW', {}),
      act('eb', 'END_FLOW', {}),
    ]), c);
    await emit(router, 'CUSTOM_EVENT', c);
    await cron(router);
    const run = (await store.listRunsFor(wf, c))[0];
    assert.equal(run.status, 'COMPLETED');
    assert.equal(run.variants.s, pickVariant(`${c}:s`, [{ id: 'a', label: 'A', percent: 30 }, { id: 'b', label: 'B', percent: 70 }]).id);
  });
});

describe('Fase 4: e-mail só pelos caminhos da Fase 3 (LGPD, flags, allowlist)', () => {
  async function approvedTemplate(router: CrmApiRouter) {
    const blocks = [{ id: 'h', type: 'heading', text: 'Novidades' }, { id: 't', type: 'text', text: 'Olá {{firstName}}' }];
    const c = await router.dispatch({ method: 'POST', path: '/api/marketing/templates', query: ADMIN(), body: { name: 'News', purpose: 'NEWSLETTER_TECNICA', subject: 'Novidades', blocks } });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    const id = (c.body as any).data.template.id as string;
    await router.dispatch({ method: 'POST', path: `/api/marketing/templates/${id}/submit`, query: SELLER(), body: {} });
    const a = await router.dispatch({ method: 'POST', path: `/api/marketing/templates/${id}/approve`, query: ADMIN(), body: {} });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    return id;
  }

  it('MARKETING_LIVE_SEND desligado: ação bloqueada, nada enfileirado, ESP intocado', async () => {
    const { router, contacts, mstore, espCalls, store } = setup({ live: true, mktLive: false });
    const tpl = await approvedTemplate(router);
    const wf = await createActive(router, graph('CUSTOM_EVENT', [act('m', 'SEND_EMAIL', { campaignId: 'cmp-1', templateId: tpl })]), contacts[0].id);
    await emit(router, 'CUSTOM_EVENT', contacts[0].id);
    await cron(router);
    const run = (await store.listRunsFor(wf, contacts[0].id))[0];
    const steps = await store.listSteps(run.id);
    assert.equal(steps[0].outcome, 'BLOCKED');
    assert.match(steps[0].message, /MARKETING_LIVE_SEND/);
    assert.equal(await mstore.getSend('cmp-1', contacts[0].id), null);
    assert.equal(espCalls.length, 0);
  });

  it('com envio real ligado: elegível entra na fila da campanha (sem envio direto); sem consentimento é bloqueado', async () => {
    const { router, contacts, mstore, espCalls, store } = setup({ live: true, mktLive: true });
    const tpl = await approvedTemplate(router);
    contacts[1].lgpdConsent = false;
    const wf = await createActive(router, graph('CUSTOM_EVENT', [act('m', 'SEND_EMAIL', { campaignId: 'cmp-1', templateId: tpl })]), contacts[0].id);
    await emit(router, 'CUSTOM_EVENT', contacts[0].id);
    await emit(router, 'CUSTOM_EVENT', contacts[1].id);
    await cron(router);
    const s0 = await mstore.getSend('cmp-1', contacts[0].id);
    assert.equal(s0?.status, 'QUEUED');
    assert.equal(await mstore.getSend('cmp-1', contacts[1].id), null);
    const r1 = (await store.listRunsFor(wf, contacts[1].id))[0];
    assert.equal((await store.listSteps(r1.id))[0].outcome, 'BLOCKED');
    assert.equal(espCalls.length, 0, 'automação não chama o ESP; quem envia é a fila de marketing');
  });
});

describe('Fase 4: webhook, isolamento e cron', () => {
  it('webhook só para host permitido, com chave de idempotência e sem dados pessoais', async () => {
    const { router, contacts, hooks, store } = setup({ live: true, env: { WORKFLOWS_WEBHOOK_ALLOWED_HOSTS: 'hooks.example.test' } });
    const c = contacts[0];
    const wf = await createActive(router, graph('CUSTOM_EVENT', [act('ok', 'SEND_WEBHOOK', { url: 'https://hooks.example.test/in' }, 'no'), act('no', 'SEND_WEBHOOK', { url: 'https://evil.example.test/in' })]), c.id);
    await emit(router, 'CUSTOM_EVENT', c.id);
    await cron(router);
    assert.equal(hooks.length, 1);
    assert.equal(hooks[0].url, 'https://hooks.example.test/in');
    assert.ok(hooks[0].headers['Idempotency-Key']);
    assert.ok(!hooks[0].body.includes(String(c.email)));
    const run = (await store.listRunsFor(wf, c.id))[0];
    assert.equal((await store.listSteps(run.id))[1].outcome, 'BLOCKED');
  });

  it('ações não geram fatura/NF nem tocam ERP/Chamados', async () => {
    const { router, contacts, repo, store } = setup({ live: true });
    const inv0 = repo.listInvoices().length;
    const tickets0 = (repo.getState().serviceTickets || []).length;
    const c = contacts[0].id;
    const wf = await createActive(router, graph('CUSTOM_EVENT', [
      act('d', 'CREATE_DEAL', { title: 'Oportunidade automática', value: 1000 }, 'o'),
      act('o', 'CHANGE_OWNER', { ownerId: 'usr-seta-03', ownerName: 'Maria Luiza' }, 'p'),
      act('p', 'UPDATE_PROPERTY', { field: 'leadStatus', value: 'IN_PROGRESS' }, 's'),
      act('s', 'APPLY_LEAD_SCORE', { points: 15 }, 'n'),
      act('n', 'NOTIFY_SELLER', { message: 'Lead quente' }),
    ]), c);
    await emit(router, 'CUSTOM_EVENT', c);
    await cron(router);
    assert.ok(repo.listDeals().some((d) => d.title === 'Oportunidade automática' && d.contactId === c));
    const steps = await store.listSteps((await store.listRunsFor(wf, c))[0].id);
    assert.ok(steps.every((x) => x.outcome === 'DONE'), JSON.stringify(steps));
    assert.match(steps.find((x) => x.nodeId === 's')!.message, /Lead score \d+ -> \d+/);
    assert.equal(repo.getContactById(c)!.ownerId, 'usr-seta-03');
    assert.equal(repo.listInvoices().length, inv0);
    assert.equal((repo.getState().serviceTickets || []).length, tickets0);
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src/modules/workflows/dag/engine.ts'), 'utf8');
    assert.ok(!/createInvoice|issueNfse|emitNf|\/api\/erp\//i.test(src), 'motor não chama rotas/funções fiscais');
  });

  it('cron: só com CRON_SECRET via bridge; grava estado; vercel/middleware/bridge registrados', async () => {
    const { router } = setup({ live: true });
    const anon = await router.dispatch({ method: 'GET', path: '/api/cron/workflows', query: { ...HTTP } });
    assert.ok([401, 403].includes(anon.status));
    assert.ok(isAuthorizedWorkflowsCron('GET', '/api/cron/workflows', CRON()));
    assert.equal(shouldPersistAfterDispatch('GET', '/api/cron/workflows', CRON(), 200), false, 'flag desligada: nao persiste');
    assert.ok(shouldPersistAfterDispatch('GET', '/api/cron/workflows', CRON(), 200, { WORKFLOWS_LIVE: 'true' }));
    const root = path.join(__dirname, '..', '..');
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')) as { crons: Array<{ path: string; schedule: string }> };
    assert.equal(cfg.crons.find((c) => c.path === '/api/cron/workflows')!.schedule, '*/5 * * * *');
    assert.ok(fs.readFileSync(path.join(root, 'src/app/api/_bridge.ts'), 'utf8').includes("cronPath === '/api/cron/workflows'"));
    assert.ok(fs.readFileSync(path.join(root, 'src/middleware.ts'), 'utf8').includes("pathname === '/api/cron/workflows'"));
  });

  it('negócio ganho e mudança de etapa disparam fluxos (eventos gravados pelo CRM)', async () => {
    const { router, repo, contacts, store } = setup({ live: true });
    const deal = repo.listDeals().find((d) => d.status === 'OPEN' && d.contactId)!;
    const wf = await createActive(router, graph('DEAL_WON', [act('n', 'NOTIFY_SELLER', { message: 'Ganhou' })]), contacts[0].id);
    const r = await router.dispatch({ method: 'PATCH', path: `/api/deals/${deal.id}`, query: ADMIN(), body: { status: 'WON' } });
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
    await cron(router);
    assert.equal((await store.listRunsFor(wf, deal.contactId!)).length, 1);
  });
});
