// ============================================================================
// SetaDesk e-mail - CISO 17/11/2026: lacunas anti-loop e escopo de caixas.
// Dados sinteticos (example.com). Sem rede.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { allowedIntakeMailboxes, isMailboxPermitted, SETADESK_EMAIL_PRODUCTION_MAILBOXES } from '../src/modules/setadesk-email/config';
import type { GraphMessage } from '../src/modules/setadesk-email/graph-app-client';
import { classifyIgnorable, normalizeGraphMessage } from '../src/modules/setadesk-email/parse';
import { CONFIRMATIONS_MAX_PER_SENDER_PER_HOUR, processInboundEmail } from '../src/modules/setadesk-email/processor';
import { createMemorySetaDeskEmailStore, type IntakePipeline } from '../src/modules/setadesk-email/store';
import { processSetaDeskOutbox } from '../src/modules/setadesk-email/outbox';

const TEC_BOX = 'suporte@desk.example.com';
const PIPELINES: IntakePipeline[] = [
  { id: 'pl-tec', name: 'Suporte Técnico', prefix: 'TEC', mailbox: TEC_BOX, sequenceName: 'setadesk_ticket_seq_tec', isActive: true },
];
const NOW = new Date('2026-11-17T15:00:00.000Z');
let seq = 0;
function msg(over: { from?: string; headers?: Record<string, string>; html?: string; subject?: string } = {}): GraphMessage {
  seq += 1;
  const headers = { 'Message-ID': `<ciso-${seq}@mail.example.com>`, ...(over.headers || {}) };
  return {
    id: `AAMk-ciso-${seq}`,
    internetMessageId: headers['Message-ID'],
    subject: over.subject || `Problema ${seq}`,
    from: { emailAddress: { address: over.from || 'cliente@example.com', name: 'Cliente' } },
    toRecipients: [{ emailAddress: { address: TEC_BOX } }],
    ccRecipients: [],
    receivedDateTime: NOW.toISOString(),
    internetMessageHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })),
    body: { contentType: 'html', content: over.html || '<p>texto</p>' },
    attachments: [],
  } as GraphMessage;
}
const classify = (m: GraphMessage) => classifyIgnorable(normalizeGraphMessage(m), [TEC_BOX]);
function memStore() {
  const s = createMemorySetaDeskEmailStore({ pipelines: PIPELINES });
  s.state.sequences.set('setadesk_ticket_seq_tec', 100);
  return s;
}
function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
  return Promise.resolve().then(fn).finally(() => {
    for (const [k, v] of Object.entries(prev)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
  });
}

describe('CISO 17/11: remetentes e cabecalhos ignorados', () => {
  it('no-reply e variacoes => AUTO_REPLY; remetente normal segue', () => {
    for (const from of ['noreply@example.com', 'no-reply@example.com', 'no_reply+abc@example.com', 'donotreply@example.com', 'do-not-reply@example.com', 'naoresponda@example.com', 'nao-responda@example.com']) {
      assert.equal(classify(msg({ from })), 'AUTO_REPLY', from);
    }
    assert.equal(classify(msg({ from: 'reply.team@example.com' })), null);
    assert.equal(classify(msg({ from: 'noreplyable@example.com' })), null);
  });
  it('List-Unsubscribe (sem List-Id) => AUTO_REPLY', () => {
    assert.equal(classify(msg({ headers: { 'List-Unsubscribe': '<mailto:sair@example.com>' } })), 'AUTO_REPLY');
  });
  it('dominio de envio do STI-hub (notificacoes.setatelecom.com.br) => OWN_MAILBOX (anti-loop)', () => {
    assert.equal(classify(msg({ from: 'avisos@notificacoes.setatelecom.com.br' })), 'OWN_MAILBOX');
    assert.equal(classify(msg({ from: 'x@mail.notificacoes.setatelecom.com.br' })), 'OWN_MAILBOX');
    assert.equal(classify(msg({ from: 'x@fakenotificacoes.setatelecom.com.br' })), null);
  });
});

describe('CISO 17/11: escopo de caixas (lista fixa em producao)', () => {
  it('em producao so suporte-sti@ e financeiro-sti@, mesmo que a env traga outras', () => {
    const env = { VERCEL_ENV: 'production', SETADESK_EMAIL_INTAKE_MAILBOXES: `diretoria@setatelecom.com.br,${SETADESK_EMAIL_PRODUCTION_MAILBOXES.join(',')},x@example.com` };
    assert.deepEqual(allowedIntakeMailboxes(env), [...SETADESK_EMAIL_PRODUCTION_MAILBOXES]);
    assert.equal(isMailboxPermitted('diretoria@setatelecom.com.br', { VERCEL_ENV: 'production' }), false);
    assert.equal(isMailboxPermitted('SUPORTE-STI@setatelecom.com.br', { VERCEL_ENV: 'production' }), true);
    assert.equal(isMailboxPermitted('suporte@desk.example.com', { NODE_ENV: 'test' }), true);
  });
  it('outbox recusa enviar por caixa fora da lista em producao (FAILED, sem chamar o Graph)', async () => {
    const s = memStore();
    const r = await processInboundEmail(s, normalizeGraphMessage(msg()), { mailbox: TEC_BOX, pipelines: PIPELINES, now: () => NOW });
    assert.equal(r.action, 'CREATED');
    let calls = 0;
    const graph = { sendReply: async () => { calls += 1; return { mode: 'REPLY' as const }; } } as never;
    await withEnv({ VERCEL_ENV: 'production' }, async () => {
      const out = await processSetaDeskOutbox(s, graph, { now: () => NOW });
      assert.equal(out.failed, 1);
      assert.equal(calls, 0);
    });
    assert.equal(s.state.outbox[0].status, 'FAILED');
    assert.equal(s.state.outbox[0].lastError, 'MAILBOX_NOT_ALLOWED');
  });
});

describe('CISO 17/11: limite de confirmacoes por remetente (anti-loop/backscatter)', () => {
  it(`a partir do ${CONFIRMATIONS_MAX_PER_SENDER_PER_HOUR + 1}o chamado na mesma hora o chamado abre, mas sem confirmacao`, async () => {
    const s = memStore();
    const results = [];
    for (let i = 0; i < CONFIRMATIONS_MAX_PER_SENDER_PER_HOUR + 2; i += 1) {
      results.push(await processInboundEmail(s, normalizeGraphMessage(msg({ from: 'robo@example.com', subject: `Assunto distinto ${i} ${seq}` })), { mailbox: TEC_BOX, pipelines: PIPELINES, now: () => NOW }));
    }
    assert.ok(results.every((r) => r.action === 'CREATED'));
    const queued = results.map((r) => (r as { confirmationQueued: boolean }).confirmationQueued);
    assert.deepEqual(queued, [true, true, true, false, false]);
    assert.equal(s.state.outbox.length, CONFIRMATIONS_MAX_PER_SENDER_PER_HOUR);
  });
});
