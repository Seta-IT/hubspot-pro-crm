// ============================================================================
// STI-hub — E-mail individual do CRM pela caixa Outlook 365 do usuario (04/11/2026).
// Conexao OAuth (state + PKCE), tokens cifrados, envio pelo Graph (mock, sem rede), linha do
// tempo, aberturas/cliques, lista "Nunca registrar", sincronizacao de respostas, encaixe da
// importacao do HubSpot e padrao visual dos componentes.
// ============================================================================
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { CrmApiRouter } from '../src/api/router';
import { createInMemoryRepository } from './helpers/legacy-proposal-fixtures';
import { isNeverLogAddress, normalizeNeverLogPattern, shouldLogEmail, DEFAULT_NEVER_LOG_PATTERNS } from '../src/modules/email/never-log';
import { openMailboxSecret, sealMailboxSecret } from '../src/modules/email/mailbox-crypto';
import { buildTrackedEmailBody, isSafeRedirectTarget, newTrackingId, parseTrackingPath, OPEN_GRACE_MS, trackingSignature } from '../src/modules/email/mail-tracking';
import { SlidingWindowRateLimiter } from '../src/api/password-reset';
import { isPublicStiHubPath } from '../src/middleware';
import { MemoryMailboxStore, type CrmEmailMessage } from '../src/modules/email/mailbox-store';
import { importHubSpotEmailHistory, mapHubSpotEmail, type HubSpotEmailPage } from '../src/modules/email/hubspot-email-history';
import { buildGraphRequestHeaders, GraphError, isMailboxFeatureEnabled, parseGraphErrorCode } from '../src/modules/email/ms-graph';
import { MAILBOX_MESSAGES, userFacingMailboxSendFailure } from '../src/api/mailbox-routes';
import { handleEmailTrackRequest } from '../src/app/lib/email-track-route';
import { mailboxSendDisabledReason } from '../src/app/components/email/mailbox-client';
const oPath = (id: string) => `/api/email-track/o/${id}/${trackingSignature(id)}`;
const cPath = (id: string, n: number) => `/api/email-track/c/${id}/${n}/${trackingSignature(id, n)}`;

const HTTP = { _fromHttpBridge: '1' };
const tok = (uid: string, email: string, roleId: string, extra: Record<string, unknown> = {}) =>
  signStiHubSessionToken({
    uid, email, name: 'Teste', roleId, scope: roleId === 'SUPER_ADMIN' ? 'TODOS' : 'PROPRIOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000, ...extra,
  } as Parameters<typeof signStiHubSessionToken>[0]);
const ADMIN = () => ({ ...HTTP, _sessionToken: tok('usr-seta-01', 'marcelo.mira@setatelecom.com.br', 'SUPER_ADMIN', { canManageUsersRbac: true }) });
const SELLER = () => ({ ...HTTP, _sessionToken: tok('usr-seta-03', 'marialuiza@setatelecom.com.br', 'VENDEDOR_SALES') });

const KEY = crypto.randomBytes(32).toString('base64url');
function enableEnv() {
  process.env.MS_CLIENT_ID = '11111111-2222-3333-4444-555555555555';
  process.env.MS_CLIENT_SECRET = 'segredo-de-teste';
  process.env.MS_TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  process.env.STI_HUB_MAILBOX_ENC_KEY = KEY;
}
function disableEnv() {
  for (const k of ['MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'MS_TENANT_ID', 'STI_HUB_MAILBOX_ENC_KEY']) delete process.env[k];
}

type Call = { url: string; method: string; body?: string; headers?: Record<string, string> };
function graphMock(opts: { me?: string; inbox?: unknown[]; sent?: unknown[]; sendStatus?: number; sendError?: unknown; draftStatus?: number; draftError?: unknown } = {}) {
  const calls: Call[] = [];
  let lastSend: { subject: string; to: string[] } | null = null;
  const res = (status: number, json: unknown) => ({ ok: status < 400, status, json: async () => json, text: async () => JSON.stringify(json) });
  const fetchFn = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init?.method || 'GET', body: init?.body, headers: init?.headers });
    if (url.includes('/oauth2/v2.0/token')) return res(200, { access_token: 'at-123', refresh_token: 'rt-456', expires_in: 3600, scope: 'Mail.Send Mail.Read' });
    if (url.includes('/me?$select')) return res(200, { mail: opts.me || 'marcelo.mira@setatelecom.com.br', displayName: 'Marcelo Mira' });
    if (url.includes('/me/sendMail') && init?.method === 'POST') {
      const status = opts.sendStatus || opts.draftStatus;
      if (status && status >= 400) return res(status, opts.sendError ?? opts.draftError ?? { error: { code: 'ErrorAccessDenied' } });
      try {
        const raw = JSON.parse(String(init?.body || '{}')) as { message?: { subject?: string; toRecipients?: Array<{ emailAddress?: { address?: string } }> } };
        lastSend = {
          subject: String(raw.message?.subject || ''),
          to: (raw.message?.toRecipients || []).map((r) => String(r.emailAddress?.address || '').toLowerCase()).filter(Boolean),
        };
      } catch {
        lastSend = null;
      }
      return res(202, null);
    }
    if (url.endsWith('/me/messages') && init?.method === 'POST') {
      return res(403, { error: { code: 'ErrorAccessDenied' } });
    }
    if (/\/me\/messages\/[^/]+\/send$/.test(url)) {
      return res(403, { error: { code: 'ErrorAccessDenied' } });
    }
    if (url.includes('/mailFolders/inbox/')) return res(200, { value: opts.inbox || [] });
    if (url.includes('/mailFolders/sentitems/')) {
      const auto = lastSend
        ? [{
            id: 'msg-1',
            conversationId: 'conv-1',
            internetMessageId: '<a@b>',
            subject: lastSend.subject,
            bodyPreview: '',
            from: { emailAddress: { address: opts.me || 'marcelo.mira@setatelecom.com.br', name: 'Marcelo Mira' } },
            toRecipients: lastSend.to.map((address) => ({ emailAddress: { address } })),
            ccRecipients: [],
            sentDateTime: new Date().toISOString(),
          }]
        : [];
      return res(200, { value: opts.sent || auto });
    }
    return res(404, {});
  };
  return { calls, fetchFn };
}

function setup(mockOpts: Parameters<typeof graphMock>[0] = {}) {
  const repo = createInMemoryRepository();
  const store = new MemoryMailboxStore();
  const mock = graphMock(mockOpts);
  const router = new CrmApiRouter(repo, { mailboxStore: store, mailboxFetch: mock.fetchFn });
  const contact = repo.listContacts().find((c) => c.email && !/setatelecom/i.test(c.email))!;
  return { repo, store, mock, router, contact };
}

async function connect(router: CrmApiRouter, q = ADMIN()) {
  const c = await router.dispatch({ method: 'POST', path: '/api/mailbox/connect', query: q, body: {} });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const url = new URL((c.body as { data: { authorizeUrl: string } }).data.authorizeUrl);
  const state = url.searchParams.get('state')!;
  const done = await router.dispatch({ method: 'POST', path: '/api/mailbox/oauth/complete', query: q, body: { code: 'codigo', state } });
  return { url, state, done };
}

describe('Nunca registrar', () => {
  it('padroes iniciais e normalizacao', () => {
    assert.deepEqual([...DEFAULT_NEVER_LOG_PATTERNS], ['*@setatelecom.com', '*@setatelecom.com.br']);
    assert.equal(normalizeNeverLogPattern('Empresa.com.br'), '*@empresa.com.br');
    assert.equal(normalizeNeverLogPattern('@empresa.com'), '*@empresa.com');
    assert.equal(normalizeNeverLogPattern(' Pessoa@Empresa.com '), 'pessoa@empresa.com');
    for (const bad of ['', 'x', '*@', 'a@b@c.com', '<script>@a.com', 'a b@c.com']) assert.equal(normalizeNeverLogPattern(bad), null, bad);
  });
  it('casamento por dominio exato e por endereco', () => {
    const p = [...DEFAULT_NEVER_LOG_PATTERNS, 'joao@cliente.com'];
    assert.ok(isNeverLogAddress('Marcelo@SetaTelecom.com.br', p));
    assert.ok(isNeverLogAddress('x@setatelecom.com', p));
    assert.ok(!isNeverLogAddress('x@sub.setatelecom.com.br', p));
    assert.ok(isNeverLogAddress('joao@cliente.com', p));
    assert.ok(!isNeverLogAddress('maria@cliente.com', p));
    assert.equal(shouldLogEmail(['a@setatelecom.com.br', 'b@setatelecom.com'], p), false);
    assert.equal(shouldLogEmail(['a@setatelecom.com.br', 'cliente@acme.com'], p), true);
  });
});

describe('Cifra dos tokens', () => {
  it('ida e volta com AAD; AAD diferente falha', () => {
    const key = crypto.randomBytes(32);
    const sealed = sealMailboxSecret('{"refreshToken":"x"}', 'mbx-1', key);
    assert.ok(!sealed.includes('refreshToken'));
    assert.equal(openMailboxSecret(sealed, 'mbx-1', key), '{"refreshToken":"x"}');
    assert.throws(() => openMailboxSecret(sealed, 'mbx-2', key));
  });
});

describe('Rastreio de aberturas e cliques', () => {
  beforeEach(() => enableEnv());
  it('corpo escapado, links pelo redirecionamento e pixel', () => {
    const id = newTrackingId();
    const b = buildTrackedEmailBody({ body: 'Olá <b>cliente</b>\nVeja https://setatelecom.com.br/proposta?id=1.', signature: 'Marcelo\nSeta', trackingId: id, origin: 'https://sti-hub.vercel.app' });
    assert.ok(b.html.includes('&lt;b&gt;cliente&lt;/b&gt;'));
    assert.ok(!b.html.includes('<b>cliente'));
    assert.deepEqual(b.links, ['https://setatelecom.com.br/proposta?id=1']);
    assert.ok(b.html.includes(`https://sti-hub.vercel.app${cPath(id, 0)}`));
    assert.ok(b.html.includes(`https://sti-hub.vercel.app${oPath(id)}`));
    assert.ok(b.text.endsWith('Marcelo\nSeta'));
    const plain = buildTrackedEmailBody({ body: 'Veja https://a.com/x', trackingId: null });
    assert.equal(plain.links.length, 0);
    assert.ok(!plain.html.includes('/api/email-track/'));
  });
  it('caminhos publicos e destino seguro', () => {
    const id = newTrackingId();
    assert.deepEqual(parseTrackingPath(oPath(id)), { kind: 'OPEN', trackingId: id });
    assert.deepEqual(parseTrackingPath(cPath(id, 3)), { kind: 'CLICK', trackingId: id, linkIndex: 3 });
    const forged = 'A'.repeat(22);
    for (const bad of [
      '/api/email-track/o/abc', `/api/email-track/o/${id}`, `/api/email-track/c/${id}/3`, `/api/email-track/c/${id}/x/${forged}`,
      `/api/email-track/o/${id}/${forged}`, `/api/email-track/c/${id}/3/${forged}`,
      `/api/email-track/c/${id}/4/${trackingSignature(id, 3)}`, `/api/email-track/o/${id}/${trackingSignature(id, 0)}`,
      `/api/email-track/o/${newTrackingId()}/${trackingSignature(id)}`, '/api/email-track/z/1',
    ]) assert.equal(parseTrackingPath(bad), null, bad);
    // sem chave: nada e assinado nem aceito, e o corpo sai sem rastreio
    disableEnv();
    assert.equal(trackingSignature(id), null);
    assert.equal(parseTrackingPath(`/api/email-track/o/${id}/${forged}`), null);
    assert.ok(!buildTrackedEmailBody({ body: 'https://a.com/x', trackingId: id }).html.includes('/api/email-track/'));
    assert.ok(isSafeRedirectTarget('https://a.com'));
    assert.ok(!isSafeRedirectTarget('javascript:alert(1)'));
  });
  it('rota publica: abertura conta depois da carencia; clique redireciona so ao link gravado; id desconhecido nao revela nada', async () => {
    const store = new MemoryMailboxStore();
    const trackingId = newTrackingId();
    const msg: CrmEmailMessage = {
      id: 'eml-1', accountId: 'mbx', ownerEmail: 'a@setatelecom.com.br', externalId: 'graph:1', conversationId: 'c', internetMessageId: null,
      direction: 'ENVIADO', source: 'STI_HUB', fromAddress: 'a@setatelecom.com.br', fromName: 'A', to: ['x@acme.com'], cc: [], subject: 'S', bodyPreview: '',
      occurredAt: new Date(Date.now() - OPEN_GRACE_MS - 1000).toISOString(), contactId: 'c1', companyId: null, dealId: null, trackingId,
      links: ['https://acme.com/doc'], openCount: 0, clickCount: 0, lastOpenedAt: null, lastClickedAt: null, createdAt: new Date().toISOString(),
    };
    await store.insertMessage(msg);
    const o = await handleEmailTrackRequest(oPath(trackingId), store);
    assert.equal(o.status, 200);
    assert.equal(o.headers.get('content-type'), 'image/gif');
    assert.match(String(o.headers.get('cache-control')), /no-store/);
    assert.equal(store.messages[0].openCount, 1);
    const c = await handleEmailTrackRequest(cPath(trackingId, 0), store);
    assert.equal(c.status, 302);
    assert.equal(c.headers.get('location'), 'https://acme.com/doc');
    assert.equal(store.messages[0].clickCount, 1);
    const unknownOpen = await handleEmailTrackRequest(oPath(newTrackingId()), store);
    assert.equal(unknownOpen.status, 200);
    const unknownClick = await handleEmailTrackRequest(cPath(trackingId, 7), store);
    assert.equal(unknownClick.status, 302);
    assert.equal(unknownClick.headers.get('location'), 'https://sti-hub.vercel.app');
    // abertura dentro da carencia (varredura do provedor) nao conta
    const fresh = { ...msg, id: 'eml-2', externalId: 'graph:2', trackingId: newTrackingId(), occurredAt: new Date().toISOString() };
    await store.insertMessage(fresh);
    await handleEmailTrackRequest(oPath(fresh.trackingId!), store);
    assert.equal(store.messages[1].openCount, 0);
  });
  it('CISO 04/11: assinatura invalida nao grava nem redireciona para fora; limite por IP; middleware so libera o formato assinado', async () => {
    const store = new MemoryMailboxStore();
    const trackingId = newTrackingId();
    await store.insertMessage({
      id: 'eml-9', accountId: 'mbx', ownerEmail: 'a@setatelecom.com.br', externalId: 'graph:9', conversationId: 'c', internetMessageId: null,
      direction: 'ENVIADO', source: 'STI_HUB', fromAddress: 'a@setatelecom.com.br', fromName: 'A', to: ['x@acme.com'], cc: [], subject: 'S', bodyPreview: '',
      occurredAt: new Date(Date.now() - OPEN_GRACE_MS - 1000).toISOString(), contactId: 'c1', companyId: null, dealId: null, trackingId,
      links: ['https://acme.com/doc'], openCount: 0, clickCount: 0, lastOpenedAt: null, lastClickedAt: null, createdAt: new Date().toISOString(),
    });
    const forged = 'A'.repeat(22);
    const badO = await handleEmailTrackRequest(`/api/email-track/o/${trackingId}/${forged}`, store);
    assert.equal(badO.status, 200);
    assert.equal(badO.headers.get('content-type'), 'image/gif');
    assert.equal(badO.headers.get('location'), null);
    const badC = await handleEmailTrackRequest(`/api/email-track/c/${trackingId}/0/${forged}`, store);
    assert.equal(badC.status, 200, 'clique com assinatura invalida nao redireciona');
    assert.equal(badC.headers.get('location'), null);
    assert.equal(store.messages[0].openCount, 0);
    assert.equal(store.messages[0].clickCount, 0);
    const lim = new SlidingWindowRateLimiter(1, 60_000);
    await handleEmailTrackRequest(oPath(trackingId), store, '1.2.3.4', lim);
    const over = await handleEmailTrackRequest(cPath(trackingId, 0), store, '1.2.3.4', lim);
    assert.equal(over.status, 302);
    assert.equal(over.headers.get('location'), 'https://sti-hub.vercel.app');
    assert.equal(store.messages[0].clickCount, 0);
    assert.equal(isPublicStiHubPath(oPath(trackingId), 'GET'), true);
    assert.equal(isPublicStiHubPath(cPath(trackingId, 0), 'GET'), true);
    for (const p of ['/api/email-track', '/api/email-track/o', `/api/email-track/o/${trackingId}`, `/api/email-track/c/${trackingId}/0`, `/api/email-track/x/${trackingId}/${forged}`, '/api/mailbox/status']) {
      assert.equal(isPublicStiHubPath(p, 'GET'), false, p);
    }
    assert.equal(isPublicStiHubPath(oPath(trackingId), 'POST'), false);
  });
});

describe('Rotas /api/mailbox', () => {
  beforeEach(() => disableEnv());

  it('sem sessao => 401; sem app da Microsoft => status desligado com aviso neutro e envio 503', async () => {
    const { router, contact } = setup();
    const anon = await router.dispatch({ method: 'GET', path: '/api/mailbox/status', query: { ...HTTP } });
    assert.equal(anon.status, 401);
    assert.equal(isMailboxFeatureEnabled(), false);
    const st = await router.dispatch({ method: 'GET', path: '/api/mailbox/status', query: ADMIN() });
    assert.equal(st.status, 200);
    const d = (st.body as { data: { enabled: boolean; message: string } }).data;
    assert.equal(d.enabled, false);
    assert.doesNotMatch(d.message, /MS_|CLIENT|TENANT|Azure|variável/i);
    const send = await router.dispatch({ method: 'POST', path: '/api/mailbox/send', query: ADMIN(), body: { to: 'x@acme.com', subject: 'a', body: 'b', contactId: contact.id } });
    assert.equal(send.status, 503);
  });

  it('conectar: URL da Microsoft com escopos, PKCE S256 e state de uso unico; resposta sem tokens', async () => {
    enableEnv();
    const { router, store, mock } = setup();
    const { url, state, done } = await connect(router);
    assert.equal(url.origin, 'https://login.microsoftonline.com');
    assert.ok(url.pathname.startsWith('/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/'));
    assert.equal(url.searchParams.get('scope'), 'offline_access User.Read Mail.Send Mail.Read');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://sti-hub.vercel.app/conta/email/retorno');
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const text = JSON.stringify(done.body);
    assert.ok(!/at-123|rt-456|tokenCipher/.test(text));
    const accounts = await store.listAccounts('marcelo.mira@setatelecom.com.br');
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].status, 'ATIVADO');
    assert.ok(accounts[0].tokenCipher && !accounts[0].tokenCipher.includes('rt-456'));
    const tokenCall = mock.calls.find((c) => c.url.includes('/token'))!;
    assert.match(String(tokenCall.body), /code_verifier=/);
    // reuso do state => recusado
    const again = await router.dispatch({ method: 'POST', path: '/api/mailbox/oauth/complete', query: ADMIN(), body: { code: 'codigo', state } });
    assert.equal(again.status, 400);
    // status nao expoe token
    const st = await router.dispatch({ method: 'GET', path: '/api/mailbox/status', query: ADMIN() });
    assert.ok(!/tokenCipher|rt-456|at-123/.test(JSON.stringify(st.body)));
  });

  it('state de outro usuario nao conecta caixa', async () => {
    enableEnv();
    const { router, store } = setup();
    const c = await router.dispatch({ method: 'POST', path: '/api/mailbox/connect', query: ADMIN(), body: {} });
    const state = new URL((c.body as { data: { authorizeUrl: string } }).data.authorizeUrl).searchParams.get('state');
    const r = await router.dispatch({ method: 'POST', path: '/api/mailbox/oauth/complete', query: SELLER(), body: { code: 'x', state } });
    assert.equal(r.status, 400);
    assert.equal((await store.listAllAccounts()).length, 0);
  });

  it('enviar pela caixa do usuario: Graph /me/sendMail, assinatura, pixel, linha do tempo e contadores', async () => {
    enableEnv();
    const { router, store, mock, contact } = setup();
    await connect(router);
    await router.dispatch({ method: 'PUT', path: '/api/mailbox/signature', query: ADMIN(), body: { signature: 'Marcelo Mira\nSeta Telecom' } });
    const s = await router.dispatch({
      method: 'POST', path: '/api/mailbox/send', query: ADMIN(),
      body: { to: contact.email, cc: '', subject: 'Proposta', body: 'Segue o link https://setatelecom.com.br/p/4704', contactId: contact.id },
    });
    assert.equal(s.status, 201, JSON.stringify(s.body));
    const data = (s.body as { data: { logged: boolean; tracked: boolean; email: Record<string, unknown> } }).data;
    assert.equal(data.logged, true);
    assert.equal(data.tracked, true);
    assert.ok(!('trackingId' in data.email) && !('links' in data.email));
    const sendCall = mock.calls.find((c) => c.url.includes('/me/sendMail') && c.method === 'POST')!;
    const raw = JSON.parse(String(sendCall.body));
    assert.equal(raw.saveToSentItems, true);
    const payload = raw.message;
    assert.equal(payload.body.contentType, 'HTML');
    assert.ok(payload.body.content.includes('/api/email-track/o/'));
    assert.ok(payload.body.content.includes('/api/email-track/c/'));
    assert.ok(payload.body.content.includes('Marcelo Mira<br>Seta Telecom'));
    assert.equal(sendCall.headers?.Authorization, 'Bearer at-123');
    assert.equal(sendCall.headers?.['Content-Type'], 'application/json');
    assert.equal(mock.calls.some((c) => c.url.endsWith('/me/messages') && c.method === 'POST'), false);
    assert.equal(mock.calls.some((c) => /\/me\/messages\/[^/]+\/send$/.test(c.url)), false);
    const tl = await router.dispatch({ method: 'GET', path: '/api/mailbox/timeline', query: { ...ADMIN(), contactId: contact.id } });
    const list = (tl.body as { data: Array<Record<string, unknown>> }).data;
    assert.equal(list.length, 1);
    assert.equal(list[0].direction, 'ENVIADO');
    assert.equal(list[0].openCount, 0);
    assert.ok(!JSON.stringify(list).includes(store.messages[0].trackingId!));
  });

  it('bcc vai em bccRecipients do Graph e nao e mesclado em cc', async () => {
    enableEnv();
    const { router, mock, contact } = setup();
    await connect(router);
    const s = await router.dispatch({
      method: 'POST', path: '/api/mailbox/send', query: ADMIN(),
      body: {
        to: contact.email,
        cc: 'copia@cliente.com',
        bcc: 'oculto@interno.setatelecom.com.br',
        subject: 'Proposta com Cco',
        body: 'Corpo',
        contactId: contact.id,
      },
    });
    assert.equal(s.status, 201, JSON.stringify(s.body));
    const sendCall = mock.calls.find((c) => c.url.includes('/me/sendMail') && c.method === 'POST')!;
    const payload = JSON.parse(String(sendCall.body)).message;
    const toAddrs = (payload.toRecipients || []).map((r: { emailAddress: { address: string } }) => r.emailAddress.address);
    const ccAddrs = (payload.ccRecipients || []).map((r: { emailAddress: { address: string } }) => r.emailAddress.address);
    const bccAddrs = (payload.bccRecipients || []).map((r: { emailAddress: { address: string } }) => r.emailAddress.address);
    assert.deepEqual(toAddrs, [contact.email.toLowerCase()]);
    assert.deepEqual(ccAddrs, ['copia@cliente.com']);
    assert.deepEqual(bccAddrs, ['oculto@interno.setatelecom.com.br']);
    assert.ok(!ccAddrs.includes('oculto@interno.setatelecom.com.br'), 'Cco nao pode aparecer em Cc');
  });

  it('destinatarios so da lista Nunca registrar: envia, mas nao registra nem rastreia', async () => {
    enableEnv();
    const { router, store, mock, contact } = setup();
    await connect(router);
    const s = await router.dispatch({ method: 'POST', path: '/api/mailbox/send', query: ADMIN(), body: { to: 'colega@setatelecom.com.br', subject: 'Interno', body: 'https://a.com', contactId: contact.id } });
    assert.equal(s.status, 201);
    assert.equal((s.body as { data: { logged: boolean } }).data.logged, false);
    assert.equal(store.messages.length, 0);
    const sendCall = mock.calls.find((c) => c.url.includes('/me/sendMail') && c.method === 'POST')!;
    assert.ok(!String(sendCall.body).includes('/api/email-track/'));
  });

  it('validacao e RBAC do envio: sem ficha, ficha inexistente, sem caixa', async () => {
    enableEnv();
    const { router, contact } = setup();
    const noAcc = await router.dispatch({ method: 'POST', path: '/api/mailbox/send', query: ADMIN(), body: { to: 'x@acme.com', subject: 'a', body: 'b', contactId: contact.id } });
    assert.equal(noAcc.status, 409);
    await connect(router);
    const noRec = await router.dispatch({ method: 'POST', path: '/api/mailbox/send', query: ADMIN(), body: { to: 'x@acme.com', subject: 'a', body: 'b' } });
    assert.equal(noRec.status, 400);
    const ghost = await router.dispatch({ method: 'POST', path: '/api/mailbox/send', query: ADMIN(), body: { to: 'x@acme.com', subject: 'a', body: 'b', contactId: 'nao-existe' } });
    assert.equal(ghost.status, 404);
    const badTo = await router.dispatch({ method: 'POST', path: '/api/mailbox/send', query: ADMIN(), body: { to: 'nao-e-email', subject: 'a', body: 'b', contactId: contact.id } });
    assert.equal(badTo.status, 400);
    const extra = await router.dispatch({ method: 'POST', path: '/api/mailbox/send', query: ADMIN(), body: { to: 'x@acme.com', subject: 'a', body: 'b', contactId: contact.id, from: 'ceo@x.com' } });
    assert.equal(extra.status, 400, 'campo desconhecido (ex.: from) recusado');
  });

  it('Nunca registrar: leitura para todos, alteracao so admin', async () => {
    enableEnv(); // CISO 04/11: desligado => 503 sem tocar o banco
    const { router } = setup();
    const g = await router.dispatch({ method: 'GET', path: '/api/mailbox/never-log', query: SELLER() });
    assert.equal(g.status, 200);
    assert.deepEqual((g.body as { data: Array<{ pattern: string }> }).data.map((e) => e.pattern).sort(), ['*@setatelecom.com', '*@setatelecom.com.br']);
    const denied = await router.dispatch({ method: 'POST', path: '/api/mailbox/never-log', query: SELLER(), body: { pattern: 'acme.com' } });
    assert.equal(denied.status, 403);
    const ok = await router.dispatch({ method: 'POST', path: '/api/mailbox/never-log', query: ADMIN(), body: { pattern: 'acme.com' } });
    assert.equal(ok.status, 201);
    const del = await router.dispatch({ method: 'DELETE', path: `/api/mailbox/never-log/${encodeURIComponent('*@acme.com')}`, query: ADMIN() });
    assert.equal(del.status, 200);
    const delDefault = await router.dispatch({ method: 'DELETE', path: `/api/mailbox/never-log/${encodeURIComponent('*@setatelecom.com')}`, query: ADMIN() });
    assert.equal(delDefault.status, 200);
  });

  it('sincronizacao: resposta na mesma conversa entra na ficha; remetente interno e ignorado', async () => {
    enableEnv();
    const { router, store, contact } = setup({
      inbox: [
        { id: 'in-1', conversationId: 'conv-1', subject: 'RE: Proposta', bodyPreview: 'Aprovado', from: { emailAddress: { address: 'outro@cliente-novo.com', name: 'Cliente' } }, toRecipients: [], ccRecipients: [], receivedDateTime: new Date().toISOString() },
        { id: 'in-2', conversationId: 'conv-x', subject: 'Interno', bodyPreview: '', from: { emailAddress: { address: 'colega@setatelecom.com.br' } }, toRecipients: [], ccRecipients: [], receivedDateTime: new Date().toISOString() },
        { id: 'in-3', conversationId: 'conv-y', subject: 'Contato direto', bodyPreview: 'Oi', from: { emailAddress: { address: '' } }, toRecipients: [], ccRecipients: [], receivedDateTime: new Date().toISOString() },
      ],
    });
    await connect(router);
    await router.dispatch({ method: 'POST', path: '/api/mailbox/send', query: ADMIN(), body: { to: contact.email, subject: 'Proposta', body: 'x', contactId: contact.id } });
    const r = await router.dispatch({ method: 'POST', path: '/api/mailbox/sync', query: ADMIN(), body: {} });
    assert.equal(r.status, 200);
    assert.equal((r.body as { data: { received: number } }).data.received, 1);
    const reply = store.messages.find((m) => m.externalId === 'graph:in-1')!;
    assert.equal(reply.direction, 'RECEBIDO');
    assert.equal(reply.contactId, contact.id);
    assert.ok(!store.messages.some((m) => m.externalId === 'graph:in-2'));
    // repetir nao duplica
    await router.dispatch({ method: 'POST', path: '/api/mailbox/sync', query: ADMIN(), body: {} });
    assert.equal(store.messages.filter((m) => m.externalId === 'graph:in-1').length, 1);
  });

  it('desconectar so a propria caixa', async () => {
    enableEnv();
    const { router, store } = setup();
    await connect(router);
    const acc = (await store.listAllAccounts())[0];
    const other = await router.dispatch({ method: 'DELETE', path: `/api/mailbox/accounts/${acc.id}`, query: SELLER() });
    assert.equal(other.status, 404);
    const own = await router.dispatch({ method: 'DELETE', path: `/api/mailbox/accounts/${acc.id}`, query: ADMIN() });
    assert.equal(own.status, 200);
    assert.equal((await store.listAllAccounts()).length, 0);
  });

  it('Graph 401 no envio: pede para reconectar e nao usa a mensagem generica', async () => {
    enableEnv();
    const { router, store, contact } = setup({
      sendStatus: 401,
      sendError: { error: { code: 'InvalidAuthenticationToken', message: 'token for marcelo.mira@setatelecom.com.br expired' } },
    });
    await connect(router);
    const s = await router.dispatch({
      method: 'POST', path: '/api/mailbox/send', query: ADMIN(),
      body: { to: contact.email, subject: 'Proposta', body: 'Olá', contactId: contact.id },
    });
    assert.equal(s.status, 409, JSON.stringify(s.body));
    const body = s.body as { error: string; code: string };
    assert.equal(body.code, 'MAILBOX_RECONNECT');
    assert.equal(body.error, MAILBOX_MESSAGES.reconnect);
    assert.doesNotMatch(body.error, /Tente novamente em instantes/);
    assert.doesNotMatch(JSON.stringify(s.body), /InvalidAuthenticationToken|expired|graph\.microsoft/i);
    const acc = (await store.listAllAccounts())[0];
    assert.equal(acc.status, 'RECONECTAR');
  });

  it('Graph 403 no /me/sendMail: avisa falta de permissao de envio', async () => {
    enableEnv();
    const { router, contact } = setup({
      sendStatus: 403,
      sendError: { error: { code: 'ErrorAccessDenied', message: 'Access is denied. Check credentials and try again.' } },
    });
    await connect(router);
    const s = await router.dispatch({
      method: 'POST', path: '/api/mailbox/send', query: ADMIN(),
      body: { to: contact.email, subject: 'Proposta', body: 'Olá', contactId: contact.id },
    });
    assert.equal(s.status, 403, JSON.stringify(s.body));
    const body = s.body as { error: string; code: string };
    assert.equal(body.code, 'MAILBOX_SEND_FORBIDDEN');
    assert.equal(body.error, MAILBOX_MESSAGES.sendForbidden);
    assert.doesNotMatch(JSON.stringify(s.body), /ErrorAccessDenied|credentials|graph\.microsoft/i);
  });

  it('Graph 400 ErrorInvalidRecipients: pede para conferir os destinatarios', async () => {
    enableEnv();
    const { router, contact } = setup({
      sendStatus: 400,
      sendError: { error: { code: 'ErrorInvalidRecipients', message: 'One or more recipients are invalid: secret@cliente.com' } },
    });
    await connect(router);
    const s = await router.dispatch({
      method: 'POST', path: '/api/mailbox/send', query: ADMIN(),
      body: { to: contact.email, subject: 'Proposta', body: 'Olá', contactId: contact.id },
    });
    assert.equal(s.status, 400, JSON.stringify(s.body));
    const body = s.body as { error: string; code: string };
    assert.equal(body.code, 'MAILBOX_INVALID_RECIPIENTS');
    assert.equal(body.error, MAILBOX_MESSAGES.invalidRecipients);
    assert.doesNotMatch(JSON.stringify(s.body), /secret@cliente\.com|ErrorInvalidRecipients/);
  });
});

describe('Traducao dos erros do Graph no envio', () => {
  it('parseia so o code do Graph e mapeia 401/403/413/destinatarios', () => {
    assert.equal(parseGraphErrorCode({ error: { code: 'ErrorAccessDenied', message: 'x@y.com' } }), 'ErrorAccessDenied');
    assert.equal(parseGraphErrorCode({ error: { code: 'Nope with space' } }), null);
    assert.equal(parseGraphErrorCode({ message: 'internal' }), null);
    const rec = userFacingMailboxSendFailure(new GraphError('GRAPH_UNAUTHORIZED', 401, 'InvalidAuthenticationToken'));
    assert.equal(rec.code, 'MAILBOX_RECONNECT');
    assert.match(rec.error, /Reconecte/);
    const forb = userFacingMailboxSendFailure(new GraphError('GRAPH_REQUEST_FAILED', 403, 'ErrorAccessDenied'));
    assert.equal(forb.code, 'MAILBOX_SEND_FORBIDDEN');
    const big = userFacingMailboxSendFailure(new GraphError('GRAPH_REQUEST_FAILED', 413, 'ErrorMessageSizeExceeded'));
    assert.equal(big.code, 'MAILBOX_SEND_TOO_LARGE');
    const other = userFacingMailboxSendFailure(new GraphError('GRAPH_REQUEST_FAILED', 500, 'UnknownError'));
    assert.equal(other.code, 'MAILBOX_SEND_FAILED');
    assert.equal(other.error, MAILBOX_MESSAGES.sendFailed);
    const headers = buildGraphRequestHeaders('POST', false);
    assert.ok(!headers['Content-Type']);
    assert.equal(buildGraphRequestHeaders('POST', true)['Content-Type'], 'application/json');
  });
});

describe('Encaixe da importacao do historico de e-mails do HubSpot (sem rodar)', () => {
  const ids = { contact: (id: string) => (id === '101' ? 'ct-1' : null), company: () => null, deal: (id: string) => (id === '9' ? 'deal-1' : null) };
  it('mapeia o engajamento e respeita Nunca registrar; idempotente', async () => {
    const store = new MemoryMailboxStore();
    const page: HubSpotEmailPage = {
      results: [
        { id: 'e1', properties: { hs_timestamp: '2026-10-01T12:00:00Z', hs_email_direction: 'EMAIL', hs_email_subject: 'Proposta 4704', hs_email_from_email: 'marcelo@setatelecom.com.br', hs_email_to_email: 'leonardo@cliente.com', hs_email_open_count: '3' }, associations: { contacts: { results: [{ id: '101' }] }, deals: { results: [{ id: '9' }] } } },
        { id: 'e2', properties: { hs_timestamp: '2026-10-02T12:00:00Z', hs_email_direction: 'INCOMING_EMAIL', hs_email_from_email: 'colega@setatelecom.com', hs_email_to_email: 'marcelo@setatelecom.com.br' }, associations: { contacts: { results: [{ id: '101' }] } } },
        { id: 'e3', properties: { hs_timestamp: 'invalida' } },
      ],
      nextAfter: null,
    };
    const m = mapHubSpotEmail(page.results[0], ids)!;
    assert.equal(m.source, 'HUBSPOT');
    assert.equal(m.externalId, 'hubspot:e1');
    assert.equal(m.contactId, 'ct-1');
    assert.equal(m.dealId, 'deal-1');
    assert.equal(m.openCount, 3);
    const dry = await importHubSpotEmailHistory({ store, fetchPage: async () => page, ids, dryRun: true });
    assert.deepEqual([dry.imported, dry.skippedNeverLog, dry.invalid], [1, 1, 1]);
    assert.equal(store.messages.length, 0);
    const r1 = await importHubSpotEmailHistory({ store, fetchPage: async () => page, ids });
    const r2 = await importHubSpotEmailHistory({ store, fetchPage: async () => page, ids });
    assert.equal(r1.imported, 1);
    assert.equal(r2.duplicates, 1);
    assert.equal(store.messages.length, 1);
  });
  it('nao esta ligado a nenhuma rota', () => {
    const router = readFileSync(join(process.cwd(), 'src/api/router.ts'), 'utf8');
    assert.ok(!router.includes('hubspot-email-history'));
  });
});

describe('Padrao visual e encaixe nas fichas', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  const files = ['CrmRecordEmailSection', 'MailboxConnectionsPanel', 'NeverLogPanel', 'mailbox-client'].map((f) => [f, src(`src/app/components/email/${f}.${f === 'mailbox-client' ? 'ts' : 'tsx'}`)] as const);
  it('so azul-marinho como destaque, sem laranja/verde, sem emojis e sem textos tecnicos', () => {
    for (const [name, s] of files) {
      assert.doesNotMatch(s, /#ff7a59|#e86646|#0091ae|bg-emerald|bg-orange|bg-amber|bg-indigo|bg-green|bg-red/i, name);
      assert.doesNotMatch(s, /\p{Extended_Pictographic}/u, name);
      assert.doesNotMatch(s.replace(/\/\/.*$/gm, ''), />[^<]*(MS_CLIENT|TENANT|Graph|OAuth|token|Azure)[^<]*</i, name);
    }
    const client = src('src/app/components/email/mailbox-client.ts');
    assert.match(client, /BTN_PRIMARY =\s*\n?\s*'[^']*bg-accent/);
    assert.match(client, /BTN_OUTLINE =\s*\n?\s*'[^']*border-slate-300 bg-white/);
    assert.match(client, /TAG_GRAY = '[^']*bg-slate-100 text-slate-600/);
  });
  it('botao E-mail nas fichas de contato, empresa e negocio; telas de configuracao', () => {
    assert.match(src('src/app/components/email/CrmRecordEmailSection.tsx'), /<Mail className="w-3.5 h-3.5" \/> E-mail/);
    assert.match(src('src/app/components/ContactDetailDrawer.tsx'), /<CrmRecordEmailSection[\s\S]*?contactId: contactDetail.id/);
    assert.match(src('src/app/components/ContactsCompaniesTab.tsx'), /<CrmRecordEmailSection[\s\S]*?companyId: companyDetail.id/);
    assert.match(src('src/app/components/DealRecordDrawer.tsx'), /<CrmEmailComposerModal[\s\S]*?dealId: deal.id/);
    assert.match(src('src/app/components/DealsKanbanTab.tsx'), /DealRecordDrawer/);
    assert.match(src('src/app/components/UserAccountModal.tsx'), /<MailboxConnectionsPanel compact \/>/);
    assert.match(src('src/app/components/StiHubAdminRbacPanel.tsx'), /subView === 'EMAIL_MAILBOXES'[\s\S]*?<NeverLogPanel \/>/);
  });
  it('tokens nunca no navegador', () => {
    for (const [name, s] of files) assert.doesNotMatch(s, /localStorage|sessionStorage/, name);
    assert.doesNotMatch(src('src/app/conta/email/retorno/page.tsx'), /localStorage|sessionStorage|access_token/);
  });
});

describe('t127u: envio Outlook nas fichas + feedback do Enviar', () => {
  const readSrc = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  it('mailboxSendDisabledReason cobre Para, Assunto e caixa não conectada', () => {
    assert.equal(
      mailboxSendDisabledReason({ enabled: true, activeAccountCount: 1, to: 'a@b.com', subject: 'Oi' }),
      null
    );
    assert.match(
      mailboxSendDisabledReason({ enabled: false, activeAccountCount: 0, to: 'a@b.com', subject: 'Oi' }) || '',
      /não liberada|Minha Conta|administrador/i
    );
    assert.match(
      mailboxSendDisabledReason({ enabled: true, activeAccountCount: 0, to: 'a@b.com', subject: 'Oi' }) || '',
      /Conecte sua caixa|Minha Conta/
    );
    assert.match(
      mailboxSendDisabledReason({ enabled: true, activeAccountCount: 1, to: '', subject: 'Oi' }) || '',
      /Para/
    );
    assert.match(
      mailboxSendDisabledReason({ enabled: true, activeAccountCount: 1, to: 'a@b.com', subject: '  ' }) || '',
      /assunto/i
    );
  });

  it('compositor mostra motivo do Enviar desabilitado e erros com role=alert', () => {
    const s = readSrc('src/app/components/email/CrmEmailComposerModal.tsx');
    assert.match(s, /mailboxSendDisabledReason/);
    assert.match(s, /data-testid="crm-mail-send-reason"/);
    assert.match(s, /role="alert"/);
    assert.match(s, /title=\{sendDisabledReason/);
  });

  it('HubSpotCardEmailComposer some quando Outlook/Graph está ativo', () => {
    const s = readSrc('src/app/components/HubSpotEmailAndTasksPanel.tsx');
    assert.match(s, /mailboxApi<MailboxStatusView>\('\/status'\)/);
    assert.match(s, /if \(outlookReady\) return null;/);
  });

  it('fichas associam envio ao registro e pré-preenchem Para', () => {
    const contact = readSrc('src/app/components/ContactDetailDrawer.tsx');
    assert.match(contact, /contactId: contactDetail\.id, companyId: contactDetail\.companyId/);
    assert.match(contact, /defaultTo=\{contactDetail\.email\}/);

    const company = readSrc('src/app/components/ContactsCompaniesTab.tsx');
    assert.match(company, /companyId: companyDetail\.id/);
    assert.match(company, /contactId: companyDetail\.contacts\?\.\[0\]\?\.id/);
    assert.match(company, /defaultTo=\{companyDetail\.contacts\?\.\[0\]\?\.email/);

    const deal = readSrc('src/app/components/DealRecordDrawer.tsx');
    assert.match(deal, /dealId: deal\.id/);
    assert.match(deal, /defaultTo=\{deal\.contact\?\.email/);
    assert.match(deal, /associatedContacts=\{associatedContacts\}/);
    assert.match(deal, /canSendEmail=\{canSendEmail\}/);
  });
});
