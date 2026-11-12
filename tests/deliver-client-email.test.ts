// ============================================================================
// STI-hub — Envio único ERP/CRM: POST /me/sendMail (Mail.Send) e a mesma caixa
// Outlook (crm_mailbox_accounts). Sem caixa, o ERP continua no Resend.
// ============================================================================
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { CrmApiRouter } from '../src/api/router';
import { createInMemoryRepository } from './helpers/legacy-proposal-fixtures';
import { MemoryMailboxStore } from '../src/modules/email/mailbox-store';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deliverClientEmail, canSafelyFallbackToResend, resolveSendReplyTo } from '../src/modules/email/deliver-client-email';
import { GraphError, sendGraphMail, GRAPH_SCOPES } from '../src/modules/email/ms-graph';
import { MAILBOX_MESSAGES, userFacingClientSendFailure } from '../src/api/mailbox-routes';
import { EMAIL_OUTLOOK_FALLBACK_NOTICE } from '../src/app/lib/client-email-send-ui';

const HTTP = { _fromHttpBridge: '1' };
const ADMIN_EMAIL = 'marcelo.mira@setatelecom.com.br';
const tok = () =>
  signStiHubSessionToken({
    uid: 'usr-seta-01', email: ADMIN_EMAIL, name: 'Marcelo Mira', roleId: 'SUPER_ADMIN', scope: 'TODOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000,
    canManageUsersRbac: true,
  } as Parameters<typeof signStiHubSessionToken>[0]);
const ADMIN = () => ({ ...HTTP, _sessionToken: tok() });

const KEY = crypto.randomBytes(32).toString('base64url');
const prevEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ['MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'MS_TENANT_ID', 'STI_HUB_MAILBOX_ENC_KEY', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL'];

function snapshotEnv() {
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
}
function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (prevEnv[k] === undefined) delete process.env[k];
    else process.env[k] = prevEnv[k];
  }
}
function enableOutlookEnv() {
  process.env.MS_CLIENT_ID = '11111111-2222-3333-4444-555555555555';
  process.env.MS_CLIENT_SECRET = 'segredo-de-teste';
  process.env.MS_TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  process.env.STI_HUB_MAILBOX_ENC_KEY = KEY;
}

type Call = { url: string; method: string; body?: string };
function graphMock(opts: { sendStatus?: number; sendError?: unknown; sendThrow?: Error } = {}) {
  const calls: Call[] = [];
  const res = (status: number, json: unknown) => ({ ok: status < 400, status, json: async () => json, text: async () => JSON.stringify(json) });
  const fetchFn = async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, method: init?.method || 'GET', body: init?.body });
    if (url.includes('/oauth2/v2.0/token')) return res(200, { access_token: 'at-123', refresh_token: 'rt-456', expires_in: 3600, scope: 'Mail.Send Mail.Read' });
    if (url.includes('/me?$select')) return res(200, { mail: ADMIN_EMAIL, displayName: 'Marcelo Mira' });
    if (url.includes('/me/sendMail') && init?.method === 'POST') {
      if (opts.sendThrow) throw opts.sendThrow;
      if (opts.sendStatus && opts.sendStatus >= 400) return res(opts.sendStatus, opts.sendError ?? { error: { code: 'ErrorAccessDenied' } });
      return res(202, null);
    }
    if (url.includes('/mailFolders/sentitems/')) {
      return res(200, {
        value: [{
          id: 'msg-1', conversationId: 'conv-1', internetMessageId: '<a@b>',
          subject: 'Proposta', bodyPreview: 'corpo',
          from: { emailAddress: { address: ADMIN_EMAIL, name: 'Marcelo Mira' } },
          toRecipients: [{ emailAddress: { address: 'cliente@exemplo.invalid' } }],
          ccRecipients: [], sentDateTime: new Date().toISOString(),
        }],
      });
    }
    if (url.includes('api.resend.com')) return res(200, { id: 're-1' });
    return res(404, {});
  };
  return { calls, fetchFn };
}

describe('Envio unificado ERP/CRM (mesma função e mesma caixa Outlook)', () => {
  beforeEach(() => {
    snapshotEnv();
    for (const k of ENV_KEYS) delete process.env[k];
  });
  afterEach(() => restoreEnv());

  it('escopos Graph não incluem Mail.ReadWrite; sendGraphMail usa só /me/sendMail', async () => {
    assert.deepEqual([...GRAPH_SCOPES], ['offline_access', 'User.Read', 'Mail.Send', 'Mail.Read']);
    assert.ok(!GRAPH_SCOPES.includes('Mail.ReadWrite' as (typeof GRAPH_SCOPES)[number]));
    const mock = graphMock();
    const sent = await sendGraphMail(mock.fetchFn, 'at-123', {
      to: ['cliente@exemplo.invalid'], cc: [], subject: 'Proposta', html: '<p>corpo</p>',
    });
    assert.equal(sent.id, 'msg-1');
    assert.equal(sent.conversationId, 'conv-1');
    assert.ok(mock.calls.some((c) => c.url.includes('/me/sendMail') && c.method === 'POST'));
    assert.equal(mock.calls.some((c) => c.url.endsWith('/me/messages') && c.method === 'POST'), false);
    assert.equal(mock.calls.some((c) => /\/me\/messages\/[^/]+\/send$/.test(c.url)), false);
  });

  it('deliverClientEmail prefere Outlook e não chama Resend quando a caixa está disponível', async () => {
    const mock = graphMock();
    process.env.RESEND_API_KEY = 're_test_dummy_key_nao_real';
    const r = await deliverClientEmail({
      fetch: mock.fetchFn,
      outlook: { accessToken: 'at-123', mailboxAddress: ADMIN_EMAIL },
      resend: { apiKey: 're_test_dummy_key_nao_real', from: 'STI-hub <no-reply@notificacoes.setatelecom.com.br>' },
      message: { to: ['cliente@exemplo.invalid'], subject: 'Proposta', html: '<p>corpo</p>', text: 'corpo' },
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.relay, 'OUTLOOK');
    assert.equal(r.fallback, false);
    assert.equal(r.mailboxAddress, ADMIN_EMAIL);
    assert.equal(mock.calls.some((c) => c.url.includes('api.resend.com')), false);
  });

  it('deliverClientEmail cai no Resend quando não há caixa Outlook', async () => {
    const mock = graphMock();
    const r = await deliverClientEmail({
      fetch: mock.fetchFn,
      outlook: null,
      resend: { apiKey: 're_test_dummy_key_nao_real', from: 'STI-hub <no-reply@notificacoes.setatelecom.com.br>' },
      message: { to: ['cliente@exemplo.invalid'], subject: 'Proposta', html: '<p>corpo</p>', text: 'corpo' },
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.relay, 'RESEND');
    assert.equal(r.fallback, false);
    assert.equal(mock.calls.some((c) => c.url.includes('/me/sendMail')), false);
    assert.equal(mock.calls.filter((c) => c.url.includes('api.resend.com')).length, 1);
  });

  it('POST /api/communications/send-email usa a mesma caixa e o mesmo /me/sendMail do CRM', async () => {
    enableOutlookEnv();
    process.env.RESEND_API_KEY = 're_test_dummy_key_nao_real';
    process.env.RESEND_FROM_EMAIL = 'STI-hub <no-reply@notificacoes.setatelecom.com.br>';
    const repo = createInMemoryRepository();
    const store = new MemoryMailboxStore();
    const mock = graphMock();
    const router = new CrmApiRouter(repo, { mailboxStore: store, mailboxFetch: mock.fetchFn });
    const c = await router.dispatch({ method: 'POST', path: '/api/mailbox/connect', query: ADMIN(), body: {} });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    const state = new URL((c.body as { data: { authorizeUrl: string } }).data.authorizeUrl).searchParams.get('state')!;
    const done = await router.dispatch({ method: 'POST', path: '/api/mailbox/oauth/complete', query: ADMIN(), body: { code: 'codigo', state } });
    assert.equal(done.status, 200, JSON.stringify(done.body));

    const sent = await router.dispatch({
      method: 'POST',
      path: '/api/communications/send-email',
      query: ADMIN(),
      body: { to: 'cliente@exemplo.invalid', subject: 'Proposta', body: 'corpo' },
    });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    const data = (sent.body as { data: { externalRelay: string } }).data;
    assert.equal(data.externalRelay, 'SENT_VIA_OUTLOOK');
    assert.equal((sent.body as { data: { relay: string; fallback: boolean } }).data.relay, 'outlook');
    assert.equal((sent.body as { data: { relay: string; fallback: boolean } }).data.fallback, false);
    const sendCall = mock.calls.find((c) => c.url.includes('/me/sendMail') && c.method === 'POST');
    assert.ok(sendCall, 'ERP deve chamar POST /me/sendMail');
    const payload = JSON.parse(String(sendCall!.body));
    assert.equal(payload.saveToSentItems, true);
    assert.equal(payload.message.subject, 'Proposta');
    assert.equal(mock.calls.some((c) => c.url.includes('api.resend.com')), false);
    assert.equal(mock.calls.some((c) => c.url.endsWith('/me/messages') && c.method === 'POST'), false);
  });
});

const RESEND = { apiKey: 're_test_dummy_key_nao_real', from: 'STI-hub <no-reply@notificacoes.setatelecom.com.br>' };
const BASE_MSG = { to: ['cliente@exemplo.invalid'], subject: 'Proposta', html: '<p>corpo</p>', text: 'corpo' };
const OUTLOOK = { accessToken: 'at-123', mailboxAddress: ADMIN_EMAIL };

describe('CISO: fallback só com certeza de que nada saiu; reply_to da sessão/caixa', () => {
  beforeEach(() => {
    snapshotEnv();
    for (const k of ENV_KEYS) delete process.env[k];
  });
  afterEach(() => restoreEnv());

  it('canSafelyFallbackToResend só em Graph 401/403', () => {
    assert.equal(canSafelyFallbackToResend(new GraphError('GRAPH_UNAUTHORIZED', 401, 'InvalidAuthenticationToken')), true);
    assert.equal(canSafelyFallbackToResend(new GraphError('GRAPH_REQUEST_FAILED', 403, 'ErrorAccessDenied')), true);
    assert.equal(canSafelyFallbackToResend(new GraphError('GRAPH_REQUEST_FAILED', 500, 'UnknownError')), false);
    assert.equal(canSafelyFallbackToResend(new GraphError('GRAPH_REQUEST_FAILED', 429, 'ApplicationThrottled')), false);
    assert.equal(canSafelyFallbackToResend(new GraphError('GRAPH_REQUEST_FAILED', 404, 'ItemNotFound')), false);
    assert.equal(canSafelyFallbackToResend(new GraphError('GRAPH_REQUEST_FAILED', 409, 'ErrorFolderExists')), false);
    assert.equal(canSafelyFallbackToResend(new Error('timeout')), false);
    assert.equal(canSafelyFallbackToResend(new Error('network')), false);
  });

  it('Graph 401/403 com Resend: cai no Resend, fallback true e reply_to da caixa', async () => {
    for (const status of [401, 403]) {
      const mock = graphMock({ sendStatus: status, sendError: { error: { code: status === 401 ? 'InvalidAuthenticationToken' : 'ErrorAccessDenied' } } });
      const r = await deliverClientEmail({
        fetch: mock.fetchFn,
        outlook: OUTLOOK,
        resend: RESEND,
        replyTo: ADMIN_EMAIL,
        message: { ...BASE_MSG, ...( { replyTo: 'atacante@evil.invalid', reply_to: 'atacante@evil.invalid' } as object) },
      });
      assert.equal(r.ok, true, `status ${status}`);
      if (!r.ok) return;
      assert.equal(r.relay, 'RESEND');
      assert.equal(r.fallback, true);
      const resendCall = mock.calls.find((c) => c.url.includes('api.resend.com'));
      assert.ok(resendCall, `Resend deveria ser chamado após ${status}`);
      const payload = JSON.parse(String(resendCall!.body));
      assert.equal(payload.reply_to, ADMIN_EMAIL);
      assert.notEqual(payload.reply_to, 'atacante@evil.invalid');
    }
  });

  it('sem caixa: Resend com reply_to da sessão e fallback false; ignora reply_to do corpo', async () => {
    const mock = graphMock();
    const r = await deliverClientEmail({
      fetch: mock.fetchFn,
      outlook: null,
      resend: RESEND,
      replyTo: ADMIN_EMAIL,
      message: { ...BASE_MSG, ...( { reply_to: 'atacante@evil.invalid', replyTo: 'atacante@evil.invalid' } as object) },
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.relay, 'RESEND');
    assert.equal(r.fallback, false);
    const payload = JSON.parse(String(mock.calls.find((c) => c.url.includes('api.resend.com'))!.body));
    assert.equal(payload.reply_to, ADMIN_EMAIL);
    assert.equal(payload.from, RESEND.from);
    assert.equal(resolveSendReplyTo(ADMIN_EMAIL, undefined), ADMIN_EMAIL);
    assert.equal(resolveSendReplyTo(undefined, '  Marcelo.Mira@SetaTelecom.com.br  '), ADMIN_EMAIL);
    assert.equal(resolveSendReplyTo('nao-e-email', '  '), undefined);
  });

  for (const [label, opts, expectedCode] of [
    ['5xx', { sendStatus: 500, sendError: { error: { code: 'ErrorServerBusy' } } }, 'MAILBOX_SEND_UNCONFIRMED'],
    ['429', { sendStatus: 429, sendError: { error: { code: 'ApplicationThrottled' } } }, 'MAILBOX_RATE_LIMITED'],
    ['404', { sendStatus: 404, sendError: { error: { code: 'ItemNotFound' } } }, 'MAILBOX_SEND_NOT_FOUND'],
    ['409', { sendStatus: 409, sendError: { error: { code: 'ErrorItemSave' } } }, 'MAILBOX_SEND_CONFLICT'],
  ] as const) {
    it(`Graph ${label}: erro específico e nenhum envio pelo Resend`, async () => {
      const mock = graphMock(opts);
      const r = await deliverClientEmail({
        fetch: mock.fetchFn,
        outlook: OUTLOOK,
        resend: RESEND,
        replyTo: ADMIN_EMAIL,
        message: BASE_MSG,
      });
      assert.equal(r.ok, false, label);
      if (r.ok) return;
      assert.equal(mock.calls.some((c) => c.url.includes('api.resend.com')), false, label);
      const mapped = userFacingClientSendFailure(r.graphError);
      assert.equal(mapped.code, expectedCode, label);
    });
  }

  it('timeout e erro de rede: erro específico, sem Resend', async () => {
    const timeoutErr = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    const netErr = new Error('falha de rede');
    for (const [err, code] of [[timeoutErr, 'MAILBOX_SEND_TIMEOUT'], [netErr, 'MAILBOX_SEND_NETWORK']] as const) {
      const mock = graphMock({ sendThrow: err });
      const r = await deliverClientEmail({
        fetch: mock.fetchFn,
        outlook: OUTLOOK,
        resend: RESEND,
        replyTo: ADMIN_EMAIL,
        message: BASE_MSG,
      });
      assert.equal(r.ok, false, err.message);
      if (r.ok) return;
      assert.equal(mock.calls.some((c) => c.url.includes('api.resend.com')), false, err.message);
      assert.equal(userFacingClientSendFailure(r.graphError).code, code, err.message);
    }
  });

  it('userFacingClientSendFailure cobre 404/409/5xx/timeout/rede', () => {
    assert.equal(userFacingClientSendFailure(new GraphError('GRAPH_REQUEST_FAILED', 404, 'ItemNotFound')).code, 'MAILBOX_SEND_NOT_FOUND');
    assert.equal(userFacingClientSendFailure(new GraphError('GRAPH_REQUEST_FAILED', 409, 'ErrorItemSave')).error, MAILBOX_MESSAGES.sendConflict);
    assert.equal(userFacingClientSendFailure(new GraphError('GRAPH_REQUEST_FAILED', 503, 'ErrorServerBusy')).code, 'MAILBOX_SEND_UNCONFIRMED');
    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
    assert.equal(userFacingClientSendFailure(aborted).code, 'MAILBOX_SEND_TIMEOUT');
    assert.equal(userFacingClientSendFailure(new Error('ECONNRESET')).code, 'MAILBOX_SEND_NETWORK');
  });

  it('POST /api/communications/send-email com 403 no Outlook: fallback, relay resend e reply_to da caixa', async () => {
    enableOutlookEnv();
    process.env.RESEND_API_KEY = 're_test_dummy_key_nao_real';
    process.env.RESEND_FROM_EMAIL = RESEND.from;
    const repo = createInMemoryRepository();
    const store = new MemoryMailboxStore();
    const mock = graphMock({ sendStatus: 403, sendError: { error: { code: 'ErrorAccessDenied' } } });
    const router = new CrmApiRouter(repo, { mailboxStore: store, mailboxFetch: mock.fetchFn });
    const c = await router.dispatch({ method: 'POST', path: '/api/mailbox/connect', query: ADMIN(), body: {} });
    const state = new URL((c.body as { data: { authorizeUrl: string } }).data.authorizeUrl).searchParams.get('state')!;
    const done = await router.dispatch({ method: 'POST', path: '/api/mailbox/oauth/complete', query: ADMIN(), body: { code: 'codigo', state } });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const sent = await router.dispatch({
      method: 'POST',
      path: '/api/communications/send-email',
      query: ADMIN(),
      body: { to: 'cliente@exemplo.invalid', subject: 'Proposta', body: 'corpo', replyTo: 'atacante@evil.invalid', reply_to: 'atacante@evil.invalid' },
    });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    const data = (sent.body as { data: { externalRelay: string; relay: string; fallback: boolean } }).data;
    assert.equal(data.externalRelay, 'SENT_VIA_RESEND');
    assert.equal(data.relay, 'resend');
    assert.equal(data.fallback, true);
    const payload = JSON.parse(String(mock.calls.find((c) => c.url.includes('api.resend.com'))!.body));
    assert.equal(payload.reply_to, ADMIN_EMAIL);
    assert.notEqual(payload.reply_to, 'atacante@evil.invalid');
  });

  it('POST /api/communications/send-email com Graph 500 não cai no Resend e devolve erro específico', async () => {
    enableOutlookEnv();
    process.env.RESEND_API_KEY = 're_test_dummy_key_nao_real';
    process.env.RESEND_FROM_EMAIL = RESEND.from;
    const repo = createInMemoryRepository();
    const store = new MemoryMailboxStore();
    const mock = graphMock({ sendStatus: 500, sendError: { error: { code: 'ErrorServerBusy' } } });
    const router = new CrmApiRouter(repo, { mailboxStore: store, mailboxFetch: mock.fetchFn });
    const c = await router.dispatch({ method: 'POST', path: '/api/mailbox/connect', query: ADMIN(), body: {} });
    const state = new URL((c.body as { data: { authorizeUrl: string } }).data.authorizeUrl).searchParams.get('state')!;
    await router.dispatch({ method: 'POST', path: '/api/mailbox/oauth/complete', query: ADMIN(), body: { code: 'codigo', state } });
    const sent = await router.dispatch({
      method: 'POST',
      path: '/api/communications/send-email',
      query: ADMIN(),
      body: { to: 'cliente@exemplo.invalid', subject: 'Proposta', body: 'corpo' },
    });
    assert.equal(sent.status, 502, JSON.stringify(sent.body));
    assert.equal((sent.body as { code: string }).code, 'MAILBOX_SEND_UNCONFIRMED');
    assert.match((sent.body as { error: string }).error, /pode já ter saído/);
    assert.equal(mock.calls.some((x) => x.url.includes('api.resend.com')), false);
  });

  it('POST /api/mailbox/send com 403 e Resend: 201, relay resend, fallback true', async () => {
    enableOutlookEnv();
    process.env.RESEND_API_KEY = 're_test_dummy_key_nao_real';
    process.env.RESEND_FROM_EMAIL = RESEND.from;
    const repo = createInMemoryRepository();
    const store = new MemoryMailboxStore();
    const mock = graphMock({ sendStatus: 403, sendError: { error: { code: 'ErrorAccessDenied' } } });
    const router = new CrmApiRouter(repo, { mailboxStore: store, mailboxFetch: mock.fetchFn });
    const c = await router.dispatch({ method: 'POST', path: '/api/mailbox/connect', query: ADMIN(), body: {} });
    const state = new URL((c.body as { data: { authorizeUrl: string } }).data.authorizeUrl).searchParams.get('state')!;
    await router.dispatch({ method: 'POST', path: '/api/mailbox/oauth/complete', query: ADMIN(), body: { code: 'codigo', state } });
    const contact = repo.listContacts().find((x) => x.email && !/setatelecom/i.test(x.email))!;
    const sent = await router.dispatch({
      method: 'POST',
      path: '/api/mailbox/send',
      query: ADMIN(),
      body: { to: contact.email, subject: 'Proposta', body: 'corpo', contactId: contact.id },
    });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    const data = (sent.body as { data: { relay: string; fallback: boolean } }).data;
    assert.equal(data.relay, 'resend');
    assert.equal(data.fallback, true);
    const payload = JSON.parse(String(mock.calls.find((x) => x.url.includes('api.resend.com'))!.body));
    assert.equal(payload.reply_to, ADMIN_EMAIL);
    assert.equal(payload.reply_to === 'atacante@evil.invalid', false);
  });

  it('compositores do CRM e do ERP mostram o aviso de fallback', () => {

    const crm = readFileSync(join(process.cwd(), 'src/app/components/email/CrmEmailComposerModal.tsx'), 'utf8');
    const erp = readFileSync(join(process.cwd(), 'src/app/components/ClientEmailComposerModal.tsx'), 'utf8');
    for (const src of [crm, erp]) {
      assert.match(src, /EMAIL_OUTLOOK_FALLBACK_NOTICE/);
      assert.match(src, /data-testid="email-fallback-notice"/);
      assert.match(src, /fallbackNotice/);
    }
    assert.match(EMAIL_OUTLOOK_FALLBACK_NOTICE, /servidor/);
    assert.match(EMAIL_OUTLOOK_FALLBACK_NOTICE, /Outlook/);
  });
});
