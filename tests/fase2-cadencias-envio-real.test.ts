// ============================================================================
// Fase 2 (19/11/2026) — Cadencias enviando de verdade pela caixa Outlook do dono (Microsoft Graph).
// Graph SEMPRE mockado (fetch injetado / mailer falso). Nenhum e-mail real sai destes testes.
// ============================================================================
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import { SequenceService } from '../src/modules/sequences/sequence-service';
import {
  createGraphSequenceMailer,
  runSequenceScheduler,
  suppressionExitTrigger,
  type MailboxResolution,
  type ResolvedMailbox,
  type SequenceMailer,
  type SequenceMailSendInput,
} from '../src/modules/sequences/sequence-live-sender';
import {
  isSequenceLiveSendEnabled,
  resolveMailboxSendLimits,
  resolveSequenceTestRecipients,
} from '../src/modules/sequences/sequence-live-config';
import { MemoryMailboxStore } from '../src/modules/email/mailbox-store';
import { sealMailboxSecret } from '../src/modules/email/mailbox-crypto';
import { deliveryStatusLabel } from '../src/app/components/SequenceLiveSendPanel';
import type { GraphListedMessage } from '../src/modules/email/ms-graph';

const SEQ = 'seq-seta-21d-prospeccao';
const CONTACT = 'cont-marina';
const OWNER = 'marcelo.mira@setatelecom.com.br';
// Quarta-feira 18/11/2026 14:00 em Sao Paulo (17:00 UTC), dia util e dentro da janela 08:30-18:00.
const WED_14H = new Date('2026-11-18T17:00:00.000Z');

const ENV_KEYS = ['SEQUENCES_LIVE_SEND', 'SEQUENCES_TEST_RECIPIENTS', 'SEQUENCES_MAX_PER_MAILBOX_HOUR', 'SEQUENCES_MAX_PER_MAILBOX_DAY', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'MS_TENANT_ID', 'STI_HUB_MAILBOX_ENC_KEY'];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function live() {
  process.env.SEQUENCES_LIVE_SEND = 'true';
}

type FakeOpts = { resolution?: MailboxResolution; inbox?: GraphListedMessage[]; failSend?: { code: string; status: number } };
function fakeMailer(opts: FakeOpts = {}) {
  const sends: SequenceMailSendInput[] = [];
  let resolves = 0;
  const mb: ResolvedMailbox = { ok: true, accountId: 'mbx-1', ownerEmail: OWNER, mailboxAddress: OWNER, displayName: 'Marcelo', accessToken: 'tok-nunca-registrar' };
  const mailer: SequenceMailer = {
    async resolveMailbox() {
      resolves++;
      return opts.resolution || mb;
    },
    async send(input) {
      if (opts.failSend) throw Object.assign(new Error('falha'), opts.failSend);
      sends.push(input);
      return { messageId: `graph-${sends.length}`, conversationId: `conv-${sends.length}`, internetMessageId: `<m${sends.length}@x>`, trackingId: 't'.repeat(22) };
    },
    async listInboxSince() {
      return opts.inbox || [];
    },
  };
  return { mailer, sends, get resolves() { return resolves; } };
}

function enroll(repo = createInMemoryRepository(), contactId = CONTACT) {
  const svc = new SequenceService();
  const { enrollment } = svc.enrollContact(repo, {
    sequenceId: SEQ,
    contactId,
    forceMoveFromConflicting: true,
    allowReentryOverride: true,
    enrolledByEmail: OWNER,
  });
  // Torna o passo 1 vencido no relogio fixo do teste.
  const e = repo.getSequenceEnrollmentById(enrollment.id)!;
  e.nextStepDueAt = new Date(WED_14H.getTime() - 60_000).toISOString();
  repo.saveSequenceEnrollment(e);
  return { repo, svc, id: enrollment.id };
}

describe('Fase 2 envio real — interruptor e configuracao', () => {
  it('SEQUENCES_LIVE_SEND desligado por padrao; allowlist e limites', () => {
    assert.equal(isSequenceLiveSendEnabled({}), false);
    assert.equal(isSequenceLiveSendEnabled({ SEQUENCES_LIVE_SEND: 'false' }), false);
    assert.equal(isSequenceLiveSendEnabled({ SEQUENCES_LIVE_SEND: 'true' }), true);
    assert.equal(resolveSequenceTestRecipients({}), null);
    assert.deepEqual([...resolveSequenceTestRecipients({ SEQUENCES_TEST_RECIPIENTS: 'A@x.com; b@y.com.br,invalido' })!], ['a@x.com', 'b@y.com.br']);
    assert.deepEqual(resolveMailboxSendLimits({ sendingWindow: { dailyMailboxSendLimit: 50 } as never }, {}), { perHour: 20, perDay: 50 });
    assert.deepEqual(resolveMailboxSendLimits(null, { SEQUENCES_MAX_PER_MAILBOX_HOUR: '5', SEQUENCES_MAX_PER_MAILBOX_DAY: '30' }), { perHour: 5, perDay: 30 });
    assert.equal(suppressionExitTrigger('Hard bounce registrado'), 'HARD_BOUNCE');
    assert.equal(suppressionExitTrigger('Contato bloqueado pela Lista de Supressão (UNSUBSCRIBED).'), 'ENTERED_SUPPRESSION_LIST');
  });

  it('flag desligada: inscricao simula como antes e o executor nao envia nada', async () => {
    const repo = createInMemoryRepository();
    const svc = new SequenceService();
    const { enrollment } = svc.enrollContact(repo, { sequenceId: SEQ, contactId: CONTACT, forceMoveFromConflicting: true, allowReentryOverride: true, enrolledByEmail: OWNER });
    assert.equal(enrollment.sentCount, 1, 'passo 1 simulado na inscricao (comportamento anterior)');
    assert.equal(enrollment.stepDeliveries, undefined);
    const f = fakeMailer();
    const res = await runSequenceScheduler(repo, { mailer: f.mailer, now: WED_14H });
    assert.equal(res.mode, 'SIMULATION');
    assert.equal(f.sends.length, 0);
    assert.equal(f.resolves, 0);
  });
});

describe('Fase 2 envio real — executor', () => {
  it('envio ok: passo 1 agendado na inscricao e enviado pela caixa do dono, com timeline e proximo passo agendado', async () => {
    live();
    const { repo, id } = enroll();
    const before = repo.getSequenceEnrollmentById(id)!;
    assert.equal(before.sentCount, 0, 'nada sai na inscricao no modo real');
    assert.equal(before.stepDeliveries?.[0].status, 'SCHEDULED');
    assert.equal(before.senderOwnerEmail, OWNER);

    const f = fakeMailer();
    const persisted: number[] = [];
    const res = await runSequenceScheduler(repo, { mailer: f.mailer, now: WED_14H, persist: async () => void persisted.push(1) });
    assert.equal(res.mode, 'LIVE');
    assert.equal(res.sent, 1);
    assert.equal(f.sends.length, 1);
    assert.equal(f.sends[0].to, 'marina.costa@nubank.com.br');
    assert.match(f.sends[0].subject, /Locação de Servidores/);
    assert.ok(!f.sends[0].subject.includes('{{'), 'variaveis renderizadas');
    assert.ok(persisted.length >= 2, 'reserva gravada antes do envio e resultado depois');

    const e = repo.getSequenceEnrollmentById(id)!;
    const d = e.stepDeliveries!.find((x) => x.stepOrder === 1)!;
    assert.equal(d.status, 'SENT');
    assert.equal(d.mailboxAddress, OWNER);
    assert.equal(d.conversationId, 'conv-1');
    assert.equal(d.idempotencyKey, `${id}:1`);
    assert.equal(e.currentStepOrder, 1);
    assert.equal(e.sentCount, 1);
    assert.ok(Date.parse(e.nextStepDueAt!) > WED_14H.getTime(), 'passo 2 agendado no futuro');
    assert.ok(e.history.some((h) => h.action === 'SENT' && h.executedByMailbox === OWNER));
    const tl = repo.listTimelineEvents().find((t) => (t.metadata as { enrollmentId?: string }).enrollmentId === id && (t.metadata as { liveSend?: boolean }).liveSend);
    assert.ok(tl, 'evento na linha do tempo do contato');
    assert.equal(tl!.contactId, CONTACT);
  });

  it('idempotencia: reexecucao nao reenvia; SENT sem avanco so conclui; SENDING orfao vira erro com tarefa', async () => {
    live();
    const { repo, id } = enroll();
    const f = fakeMailer();
    await runSequenceScheduler(repo, { mailer: f.mailer, now: WED_14H });
    await runSequenceScheduler(repo, { mailer: f.mailer, now: WED_14H });
    await runSequenceScheduler(repo, { mailer: f.mailer, now: new Date(WED_14H.getTime() + 5 * 60_000) });
    assert.equal(f.sends.length, 1, 'mesmo passo nunca sai duas vezes');

    // Queda depois do envio e antes do avanco: estado SENT com o passo ainda pendente.
    const r2 = enroll();
    const e2 = r2.repo.getSequenceEnrollmentById(r2.id)!;
    e2.stepDeliveries![0] = { ...e2.stepDeliveries![0], status: 'SENT', sentAt: WED_14H.toISOString(), mailboxAddress: OWNER };
    r2.repo.saveSequenceEnrollment(e2);
    const f2 = fakeMailer();
    await runSequenceScheduler(r2.repo, { mailer: f2.mailer, now: WED_14H });
    assert.equal(f2.sends.length, 0);
    assert.equal(r2.repo.getSequenceEnrollmentById(r2.id)!.currentStepOrder, 1);

    // Queda no meio do envio: SENDING orfao.
    const r3 = enroll();
    const e3 = r3.repo.getSequenceEnrollmentById(r3.id)!;
    e3.stepDeliveries![0] = { ...e3.stepDeliveries![0], status: 'SENDING', attempts: 1 };
    r3.repo.saveSequenceEnrollment(e3);
    const tasksBefore = r3.repo.listTasks({ contactId: CONTACT }).length;
    const f3 = fakeMailer();
    const res3 = await runSequenceScheduler(r3.repo, { mailer: f3.mailer, now: WED_14H });
    assert.equal(f3.sends.length, 0, 'nunca reenvia um envio incerto');
    const d3 = r3.repo.getSequenceEnrollmentById(r3.id)!.stepDeliveries![0];
    assert.equal(d3.status, 'ERROR');
    assert.equal(d3.reasonCode, 'SEND_UNCERTAIN');
    assert.equal(r3.repo.listTasks({ contactId: CONTACT }).length, tasksBefore + 1);
    assert.equal(res3.tasksCreated, 1);
  });

  it('supressao LGPD (descadastro) bloqueia antes do envio e encerra a inscricao', async () => {
    live();
    const { repo, id } = enroll();
    const c = repo.getContactById(CONTACT)!;
    c.subscriptionStatus = 'UNSUBSCRIBED_MARKETING';
    c.lgpdConsent = false;
    const f = fakeMailer();
    const res = await runSequenceScheduler(repo, { mailer: f.mailer, now: WED_14H });
    assert.equal(f.sends.length, 0);
    assert.equal(res.blocked, 1);
    const e = repo.getSequenceEnrollmentById(id)!;
    assert.equal(e.stepDeliveries![0].status, 'BLOCKED');
    assert.equal(e.stepDeliveries![0].reasonCode, 'SUPPRESSED_LGPD');
    assert.ok(!['ACTIVE', 'IN_SEQUENCE', 'WAITING_NEXT_STEP'].includes(e.status));
  });

  it('hard bounce registrado: nenhum envio', async () => {
    live();
    const { repo } = enroll();
    repo.updateContactSubscriptionPreference({ contactId: CONTACT, action: 'RECORD_HARD_BOUNCE', reason: 'Hard bounce de teste' });
    const f = fakeMailer();
    await runSequenceScheduler(repo, { mailer: f.mailer, now: WED_14H });
    assert.equal(f.sends.length, 0);
  });

  it('caixa desconectada: nao envia, passo pendente com motivo, UMA tarefa e nova tentativa no proximo dia util', async () => {
    live();
    const { repo, id } = enroll();
    const tasksBefore = repo.listTasks({ contactId: CONTACT }).length;
    const f = fakeMailer({ resolution: { ok: false, code: 'MAILBOX_NOT_CONNECTED', detail: 'O dono da inscrição não tem caixa Outlook conectada ao STI-hub.' } });
    const res = await runSequenceScheduler(repo, { mailer: f.mailer, now: WED_14H });
    assert.equal(f.sends.length, 0);
    assert.equal(res.pending, 1);
    const e = repo.getSequenceEnrollmentById(id)!;
    const d = e.stepDeliveries![0];
    assert.equal(d.status, 'PENDING');
    assert.equal(d.reasonCode, 'MAILBOX_NOT_CONNECTED');
    assert.match(d.reason || '', /não tem caixa Outlook conectada/);
    assert.equal(e.status, 'ACTIVE', 'a cadencia nao quebra');
    assert.equal(repo.listTasks({ contactId: CONTACT }).length, tasksBefore + 1);
    // Proxima tentativa: no proximo dia util, no mesmo horario (quinta 19/11 14:00 em Sao Paulo).
    assert.equal(e.nextStepDueAt, '2026-11-19T17:00:00.000Z');
    // Segunda tentativa ainda sem caixa: nao cria outra tarefa.
    const r2 = await runSequenceScheduler(repo, { mailer: f.mailer, now: new Date('2026-11-19T17:05:00.000Z') });
    assert.equal(r2.pending, 1);
    assert.equal(repo.listTasks({ contactId: CONTACT }).length, tasksBefore + 1);
    // Caixa conectada depois: envia normalmente.
    const ok = fakeMailer();
    await runSequenceScheduler(repo, { mailer: ok.mailer, now: new Date('2026-11-23T12:00:00.000Z') });
    assert.equal(ok.sends.length, 1);
  });

  it('inscricoes antigas/simuladas (sem stepDeliveries) nunca passam a enviar ao ligar a flag', async () => {
    const repo = createInMemoryRepository();
    const svc = new SequenceService();
    const { enrollment } = svc.enrollContact(repo, { sequenceId: SEQ, contactId: CONTACT, forceMoveFromConflicting: true, allowReentryOverride: true });
    const e = repo.getSequenceEnrollmentById(enrollment.id)!;
    e.nextStepDueAt = new Date(WED_14H.getTime() - 60_000).toISOString();
    repo.saveSequenceEnrollment(e);
    live();
    const f = fakeMailer();
    const res = await runSequenceScheduler(repo, { mailer: f.mailer, now: WED_14H });
    assert.equal(f.sends.length, 0);
    assert.equal(res.due, 0);
  });

  it('avancar passo manualmente no modo real nao simula envio: antecipa para o executor', () => {
    live();
    const { repo, svc, id } = enroll();
    const before = repo.getSequenceEnrollmentById(id)!;
    before.nextStepDueAt = '2030-01-01T12:00:00.000Z';
    repo.saveSequenceEnrollment(before);
    const res = svc.advanceStep(repo, id);
    assert.equal(res.enrollment.sentCount, 0);
    assert.equal(res.enrollment.currentStepOrder, 0);
    assert.ok(Date.parse(res.enrollment.nextStepDueAt!) <= Date.now());
  });

  it('token expirado e recurso desligado tambem ficam pendentes com motivo claro', async () => {
    live();
    for (const code of ['MAILBOX_TOKEN_EXPIRED', 'MAILBOX_FEATURE_DISABLED'] as const) {
      const { repo, id } = enroll();
      const f = fakeMailer({ resolution: { ok: false, code, detail: `motivo ${code}` } });
      await runSequenceScheduler(repo, { mailer: f.mailer, now: WED_14H });
      const d = repo.getSequenceEnrollmentById(id)!.stepDeliveries![0];
      assert.equal(d.status, 'PENDING');
      assert.equal(d.reasonCode, code);
      assert.equal(f.sends.length, 0);
    }
  });

  it('dias uteis e fuso America/Sao_Paulo: sabado e noite nao enviam e reagendam para a janela', async () => {
    live();
    // Sabado 21/11/2026 10:00 em Sao Paulo => segunda 23/11 08:30 (11:30 UTC).
    const sat = new Date('2026-11-21T13:00:00.000Z');
    const a = enroll();
    const fa = fakeMailer();
    await runSequenceScheduler(a.repo, { mailer: fa.mailer, now: sat });
    assert.equal(fa.sends.length, 0);
    const ea = a.repo.getSequenceEnrollmentById(a.id)!;
    assert.equal(ea.nextStepDueAt, '2026-11-23T11:30:00.000Z');
    assert.equal(ea.stepDeliveries![0].reasonCode, 'OUTSIDE_SENDING_WINDOW');
    // Quarta 22:00 em Sao Paulo (quinta 01:00 UTC) => quinta 08:30.
    const b = enroll();
    const fb = fakeMailer();
    await runSequenceScheduler(b.repo, { mailer: fb.mailer, now: new Date('2026-11-19T01:00:00.000Z') });
    assert.equal(fb.sends.length, 0);
    assert.equal(b.repo.getSequenceEnrollmentById(b.id)!.nextStepDueAt, '2026-11-19T11:30:00.000Z');
    // Feriado de 20/11 (Consciencia Negra) no calendario da cadencia => segunda 23/11.
    const c = enroll();
    const fc = fakeMailer();
    await runSequenceScheduler(c.repo, { mailer: fc.mailer, now: new Date('2026-11-20T14:00:00.000Z') });
    assert.equal(fc.sends.length, 0);
    assert.equal(c.repo.getSequenceEnrollmentById(c.id)!.nextStepDueAt, '2026-11-23T11:30:00.000Z');
  });

  it('pausa por resposta: resposta na mesma conversa aplica PAUSED_ON_REPLY e o passo seguinte nao sai', async () => {
    live();
    const { repo, id } = enroll();
    const f = fakeMailer();
    await runSequenceScheduler(repo, { mailer: f.mailer, now: WED_14H });
    assert.equal(f.sends.length, 1);
    // Forca o passo 2 vencido e simula a resposta do contato na Caixa de Entrada.
    const e = repo.getSequenceEnrollmentById(id)!;
    e.nextStepDueAt = new Date(WED_14H.getTime() + 60 * 60_000).toISOString();
    repo.saveSequenceEnrollment(e);
    const reply: GraphListedMessage = {
      id: 'in-1', conversationId: 'conv-1', internetMessageId: '<r@x>', subject: 'RE: Locação', bodyPreview: 'Olá, podemos conversar na sexta?',
      from: 'marina.costa@nubank.com.br', fromName: 'Marina', to: [OWNER], cc: [], at: new Date(WED_14H.getTime() + 30 * 60_000).toISOString(),
    };
    const f2 = fakeMailer({ inbox: [reply] });
    const res = await runSequenceScheduler(repo, { mailer: f2.mailer, now: new Date(WED_14H.getTime() + 2 * 60 * 60_000) });
    assert.equal(res.repliesDetected, 1);
    assert.equal(f2.sends.length, 0);
    const after = repo.getSequenceEnrollmentById(id)!;
    assert.equal(after.status, 'PAUSED_ON_REPLY');
    assert.match(after.replySnippet || '', /podemos conversar/);
  });

  it('allowlist de teste retem destinatarios fora da lista', async () => {
    live();
    process.env.SEQUENCES_TEST_RECIPIENTS = 'teste.autorizado@setatelecom.com.br';
    const { repo, id } = enroll();
    const f = fakeMailer();
    const res = await runSequenceScheduler(repo, { mailer: f.mailer, now: WED_14H });
    assert.equal(res.testAllowlistActive, true);
    assert.equal(f.sends.length, 0);
    assert.equal(repo.getSequenceEnrollmentById(id)!.stepDeliveries![0].reasonCode, 'NOT_IN_TEST_ALLOWLIST');
  });

  it('limite por caixa por hora protege o dominio', async () => {
    live();
    process.env.SEQUENCES_MAX_PER_MAILBOX_HOUR = '1';
    const { repo } = enroll();
    const other = repo.createContact({ firstName: 'Teste', lastName: 'Sintetico', email: 'sintetico.cadencia@exemplo.com.br' });
    enroll(repo, other.id);
    const f = fakeMailer();
    const res = await runSequenceScheduler(repo, { mailer: f.mailer, now: WED_14H, env: process.env });
    assert.equal(f.sends.length, 1);
    assert.equal(res.skippedReasons.MAILBOX_HOURLY_LIMIT, 1);
  });

  it('falha do provedor: tenta de novo e, apos 3 tentativas, marca erro, cria tarefa e segue a cadencia', async () => {
    live();
    const { repo, id } = enroll();
    const f = fakeMailer({ failSend: { code: 'ErrorServerBusy', status: 503 } });
    let now = WED_14H;
    for (let i = 0; i < 3; i++) {
      await runSequenceScheduler(repo, { mailer: f.mailer, now });
      const e = repo.getSequenceEnrollmentById(id)!;
      now = new Date(Math.max(Date.parse(e.nextStepDueAt!), now.getTime()) + 60_000);
    }
    const e = repo.getSequenceEnrollmentById(id)!;
    const d = e.stepDeliveries!.find((x) => x.stepOrder === 1)!;
    assert.equal(d.status, 'ERROR');
    assert.equal(d.attempts, 3);
    assert.equal(e.currentStepOrder, 1, 'cadencia avancou sem o passo');
    assert.equal(e.sentCount, 0);
    assert.ok(!JSON.stringify(e).includes('tok-nunca-registrar'), 'token nunca persistido');
  });
});

describe('Fase 2 envio real — Graph mockado de ponta a ponta', () => {
  const KEY = crypto.randomBytes(32).toString('base64url');
  function enableGraph() {
    process.env.MS_CLIENT_ID = '11111111-2222-3333-4444-555555555555';
    process.env.MS_CLIENT_SECRET = 'segredo-de-teste';
    process.env.MS_TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    process.env.STI_HUB_MAILBOX_ENC_KEY = KEY;
  }
  function graphFetch() {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    let last: { subject: string; to: string[] } | null = null;
    const res = (status: number, json: unknown) => ({ ok: status < 400, status, json: async () => json, text: async () => JSON.stringify(json) });
    const fetchFn = async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url, method: init?.method || 'GET', body: init?.body });
      if (url.includes('/me/sendMail')) {
        const raw = JSON.parse(String(init?.body || '{}'));
        last = { subject: raw.message.subject, to: raw.message.toRecipients.map((r: { emailAddress: { address: string } }) => r.emailAddress.address) };
        return res(202, null);
      }
      if (url.includes('/mailFolders/sentitems/')) {
        return res(200, { value: last ? [{ id: 'g-1', conversationId: 'conv-g', internetMessageId: '<g@x>', subject: last.subject, from: { emailAddress: { address: OWNER } }, toRecipients: last.to.map((address) => ({ emailAddress: { address } })), ccRecipients: [], sentDateTime: new Date().toISOString() }] : [] });
      }
      if (url.includes('/mailFolders/inbox/')) return res(200, { value: [] });
      return res(404, {});
    };
    return { calls, fetchFn };
  }

  it('sem recurso configurado => MAILBOX_FEATURE_DISABLED; sem caixa => MAILBOX_NOT_CONNECTED', async () => {
    const repo = createInMemoryRepository();
    const store = new MemoryMailboxStore();
    const g = graphFetch();
    const mailer = createGraphSequenceMailer({ repo, store, fetch: g.fetchFn, sendLimiter: undefined as never });
    assert.equal(((await mailer.resolveMailbox(OWNER)) as { code: string }).code, 'MAILBOX_FEATURE_DISABLED');
    enableGraph();
    assert.equal(((await mailer.resolveMailbox(OWNER)) as { code: string }).code, 'MAILBOX_NOT_CONNECTED');
    assert.equal(g.calls.length, 0);
  });

  it('cadencia envia via /me/sendMail com pixel de rastreio e registra o e-mail na timeline do contato', async () => {
    enableGraph();
    live();
    const { repo, id } = enroll();
    const store = new MemoryMailboxStore();
    const acc = await store.upsertAccount({ id: 'mbx-test', ownerEmail: OWNER, mailboxAddress: OWNER, displayName: 'Marcelo', status: 'ATIVADO', tokenCipher: null, tokenExpiresAt: 0, lastSyncInboxAt: null, lastSyncSentAt: null });
    const tokens = { accessToken: 'at-mock', refreshToken: 'rt-mock', expiresAt: Date.now() + 3_600_000 };
    await store.updateAccount(acc.id, { tokenCipher: sealMailboxSecret(JSON.stringify(tokens), acc.id), tokenExpiresAt: tokens.expiresAt });
    const g = graphFetch();
    const mailer = createGraphSequenceMailer({ repo, store, fetch: g.fetchFn, sendLimiter: undefined as never }, 'https://sti-hub.setatelecom.com.br');
    const res = await runSequenceScheduler(repo, { mailer, now: WED_14H });
    assert.equal(res.sent, 1);
    const send = g.calls.find((c) => c.url.includes('/me/sendMail'))!;
    assert.ok(send, 'chamou o Graph mockado');
    assert.match(String(send.body), /\/api\/email-track\/o\//, 'pixel de abertura');
    assert.match(String(send.body), /marina\.costa@nubank\.com\.br/);
    const msgs = await store.listForRecord({ contactId: CONTACT });
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].direction, 'ENVIADO');
    assert.ok(msgs[0].trackingId);
    const d = repo.getSequenceEnrollmentById(id)!.stepDeliveries![0];
    assert.equal(d.status, 'SENT');
    assert.equal(d.conversationId, 'conv-g');
  });
});

describe('Fase 2 envio real — rota do cron, vercel.json e interface', () => {
  it('GET /api/cron/sequences exige o cron autenticado; com a flag desligada so simula', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo, { mailboxStore: new MemoryMailboxStore(), mailboxFetch: (async () => { throw new Error('rede proibida'); }) as never });
    const anon = await router.dispatch({ method: 'GET', path: '/api/cron/sequences', query: { _fromHttpBridge: '1' } });
    assert.ok([401, 403].includes(anon.status));
    const cron = await router.dispatch({ method: 'GET', path: '/api/cron/sequences', query: { _fromHttpBridge: '1', _cronAuthorized: '1' } });
    assert.equal(cron.status, 200);
    assert.equal((cron.body as { data: { mode: string } }).data.mode, 'SIMULATION');
    const internal = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'GET', path: '/api/cron/sequences', query: {} });
    assert.equal(internal.status, 200);
  });

  it('vercel.json agenda o executor sem remover os crons existentes; bridge e middleware liberam so o GET', () => {
    const root = process.cwd();
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')) as { crons: Array<{ path: string; schedule: string }> };
    const paths = cfg.crons.map((c) => c.path);
    for (const p of ['/api/erp/daily-sync', '/api/crm/proposal-followup', '/api/tickets/email-intake/poll', '/api/cron/sequences']) assert.ok(paths.includes(p), p);
    assert.equal(cfg.crons.find((c) => c.path === '/api/cron/sequences')!.schedule, '*/15 * * * 1-5');
    assert.ok(fs.readFileSync(path.join(root, 'src/app/api/_bridge.ts'), 'utf8').includes("cronPath === '/api/cron/sequences'"));
    assert.ok(fs.readFileSync(path.join(root, 'src/middleware.ts'), 'utf8').includes("pathname === '/api/cron/sequences'"));
  });

  it('painel do envio real: rotulos de status e sem emojis', () => {
    assert.equal(deliveryStatusLabel({ status: 'SENT' }), 'Enviado');
    assert.equal(deliveryStatusLabel({ status: 'PENDING' }), 'Pendente');
    assert.equal(deliveryStatusLabel({ status: 'ERROR' }), 'Erro');
    const src = fs.readFileSync(path.join(process.cwd(), 'src/app/components/SequenceLiveSendPanel.tsx'), 'utf8');
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{FE0F}]/u;
    assert.ok(!emoji.test(src));
    assert.ok(src.includes('Caixa Outlook não conectada'));
    assert.ok(src.includes('cadence-owner-mailbox-warning'));
  });
});
