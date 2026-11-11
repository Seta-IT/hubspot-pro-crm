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
import { deliverClientEmail } from '../src/modules/email/deliver-client-email';
import { sendGraphMail, GRAPH_SCOPES } from '../src/modules/email/ms-graph';

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
function graphMock() {
  const calls: Call[] = [];
  const res = (status: number, json: unknown) => ({ ok: status < 400, status, json: async () => json, text: async () => JSON.stringify(json) });
  const fetchFn = async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, method: init?.method || 'GET', body: init?.body });
    if (url.includes('/oauth2/v2.0/token')) return res(200, { access_token: 'at-123', refresh_token: 'rt-456', expires_in: 3600, scope: 'Mail.Send Mail.Read' });
    if (url.includes('/me?$select')) return res(200, { mail: ADMIN_EMAIL, displayName: 'Marcelo Mira' });
    if (url.includes('/me/sendMail') && init?.method === 'POST') return res(202, null);
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
    const sendCall = mock.calls.find((c) => c.url.includes('/me/sendMail') && c.method === 'POST');
    assert.ok(sendCall, 'ERP deve chamar POST /me/sendMail');
    const payload = JSON.parse(String(sendCall!.body));
    assert.equal(payload.saveToSentItems, true);
    assert.equal(payload.message.subject, 'Proposta');
    assert.equal(mock.calls.some((c) => c.url.includes('api.resend.com')), false);
    assert.equal(mock.calls.some((c) => c.url.endsWith('/me/messages') && c.method === 'POST'), false);
  });
});
