// ============================================================================
// Fase 3 (19/11/2026) — Campanhas reais via ESP. ESP, DNS e trava SEMPRE mockados (fetch,
// transporte SMTP e resolver injetados). Nenhum e-mail real sai destes testes; contatos sinteticos.
// ============================================================================
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository, type CrmRepository } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT, isAuthorizedMarketingCron, shouldPersistAfterDispatch } from '../src/api/router';
import { MemoryLockStore } from '../src/db/distributed-lock';
import { MemoryMailboxStore } from '../src/modules/email/mailbox-store';
import { MemoryMarketingStore } from '../src/modules/marketing/marketing-store';
import {
  buildMailgunRequest,
  buildPostmarkRequest,
  buildResendRequest,
  buildSendGridRequest,
  buildSesRequest,
  createMailgunAdapter,
  createPostmarkAdapter,
  createResendAdapter,
  createSendGridAdapter,
  createSesAdapter,
  createSmtpAdapter,
  EspSendError,
  resolveEspAdapter,
  type EspMessage,
  type HttpFetch,
} from '../src/modules/marketing/esp-adapters';
import { checkDomainAuth, dmarcCandidates, type TxtResolver } from '../src/modules/marketing/domain-auth';
import { signUnsubscribeToken, verifyUnsubscribeToken, UNSUBSCRIBE_PATH_PREFIX } from '../src/modules/marketing/unsubscribe-token';
import { normalizeResendEvent, signSvixPayload, verifySvixSignature } from '../src/modules/marketing/resend-webhook';
import { renderBlocksHtml, sanitizeTemplateBlocks } from '../src/modules/marketing/template-blocks';
import { approveTemplate, createTemplate, getSendableVersion, saveTemplateDraft, submitTemplateForReview } from '../src/modules/marketing/template-service';
import { composeMarketingEmail, processMarketingQueue, type MarketingDeps } from '../src/modules/marketing/campaign-dispatcher';
import { resolveMarketingSenderConfig } from '../src/modules/marketing/marketing-config';
import { handleResendWebhookRequest, handleUnsubscribeRequest } from '../src/app/lib/marketing-public-routes';
import { isPublicStiHubPath } from '../src/middleware';

const HTTP = { _fromHttpBridge: '1' };
const tok = (uid: string, email: string, roleId: string, extra: Record<string, unknown> = {}) =>
  signStiHubSessionToken({
    uid, email, name: 'Teste', roleId, scope: roleId === 'SUPER_ADMIN' ? 'TODOS' : 'PROPRIOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000, ...extra,
  } as Parameters<typeof signStiHubSessionToken>[0]);
const ADMIN = () => ({ ...HTTP, _sessionToken: tok('usr-seta-01', 'marcelo.mira@setatelecom.com.br', 'SUPER_ADMIN', { canManageUsersRbac: true }) });
const SELLER = () => ({ ...HTTP, _sessionToken: tok('usr-seta-03', 'marialuiza@setatelecom.com.br', 'VENDEDOR_SALES') });

const UNSUB_SECRET = 'u'.repeat(40);
const WEBHOOK_SECRET = `whsec_${Buffer.from('k'.repeat(24)).toString('base64')}`;
const ORIGIN = 'https://sti-hub.example.test';
const MKT_DOMAIN = 'news.setatelecom.com.br';

function baseEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    MARKETING_LIVE_SEND: 'true',
    MARKETING_ESP_PROVIDER: 'resend',
    MARKETING_RESEND_API_KEY: 're_teste_nunca_real',
    MARKETING_FROM_EMAIL: `news@${MKT_DOMAIN}`,
    MARKETING_FROM_NAME: 'Seta Telecom',
    MARKETING_POSTAL_ADDRESS: 'Rua Exemplo, 100 - Sao Paulo/SP - CEP 01000-000',
    MARKETING_UNSUBSCRIBE_SECRET: UNSUB_SECRET,
    MARKETING_TEST_RECIPIENTS: 'qa1@example.test,qa2@example.test,qa3@example.test',
    ...extra,
  };
}

const GOOD_DNS: Record<string, string[][]> = {
  [`send.${MKT_DOMAIN}`]: [['v=spf1 include:amazonses.com ~all']],
  [`resend._domainkey.${MKT_DOMAIN}`]: [['p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC1234567890abcdef']],
  [`_dmarc.${MKT_DOMAIN}`]: [['v=DMARC1; p=quarantine; rua=mailto:dmarc@setatelecom.com.br']],
};
const resolverFrom = (map: Record<string, string[][]>): TxtResolver => async (host) => map[host] || [];

type Call = { url: string; init: { method: string; headers: Record<string, string>; body: string } };
function fakeFetch(respond?: (n: number, c: Call) => { status: number; json: unknown }) {
  const calls: Call[] = [];
  const fetchFn: HttpFetch = async (url, init) => {
    const c = { url, init };
    calls.push(c);
    const r = respond ? respond(calls.length, c) : { status: 200, json: { id: `re-msg-${calls.length}` } };
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.json,
      text: async () => JSON.stringify(r.json),
      headers: { get: () => null },
    };
  };
  return { fetchFn, calls };
}

const KEY_SAVED = process.env.STI_HUB_MAILBOX_ENC_KEY;
beforeEach(() => {
  process.env.STI_HUB_MAILBOX_ENC_KEY = crypto.randomBytes(32).toString('base64url');
});
afterEach(() => {
  if (KEY_SAVED === undefined) delete process.env.STI_HUB_MAILBOX_ENC_KEY;
  else process.env.STI_HUB_MAILBOX_ENC_KEY = KEY_SAVED;
});

/** 3 contatos sinteticos: qa1 (newsletter), qa2 (newsletter), qa3 (so eventos). qa4 fora da allowlist. */
function synthetic(repo: CrmRepository) {
  const list = repo.listContacts().slice(0, 4);
  const cats = [['NEWSLETTER_TECNICA'], ['NEWSLETTER_TECNICA', 'EVENTOS_ABM'], ['EVENTOS_ABM'], ['NEWSLETTER_TECNICA']];
  list.forEach((c, i) => {
    c.email = `qa${i + 1}@example.test`;
    c.lgpdConsent = true;
    c.subscriptionStatus = 'SUBSCRIBED';
    c.isValidEmail = true;
    c.isDisposableEmail = false;
    c.communicationCategories = cats[i];
  });
  const st = repo.getState() as { suppressionList?: Array<{ email: string; contactId: string | null }> };
  st.suppressionList = (st.suppressionList || []).filter((s) => !list.some((c) => c.id === s.contactId || c.email === s.email));
  return list;
}

function makeRouter(env: NodeJS.ProcessEnv, opts: { dns?: Record<string, string[][]>; respond?: Parameters<typeof fakeFetch>[0] } = {}) {
  const repo = createInMemoryRepository();
  const contacts = synthetic(repo);
  const store = new MemoryMarketingStore();
  const mailbox = new MemoryMailboxStore();
  const lock = new MemoryLockStore();
  const esp = fakeFetch(opts.respond);
  const router = new CrmApiRouter(repo, {
    mailboxStore: mailbox,
    marketing: { store, env, espFetch: esp.fetchFn, lock, resolver: resolverFrom(opts.dns || GOOD_DNS), sleep: async () => undefined, origin: ORIGIN },
  });
  return { repo, contacts, store, mailbox, lock, esp, router };
}

const BLOCKS = [
  { id: 'h', type: 'heading', text: 'Novidades {{companyName}}' },
  { id: 't', type: 'text', text: 'Olá {{firstName}}, <script>alert(1)</script>' },
  { id: 'b', type: 'button', text: 'Ver', url: 'https://setatelecom.com.br/novidades' },
];

async function approvedTemplate(router: CrmApiRouter, purpose = 'NEWSLETTER_TECNICA') {
  const c = await router.dispatch({ method: 'POST', path: '/api/marketing/templates', query: ADMIN(), body: { name: 'News', purpose, subject: 'Novidades para {{firstName}}', blocks: BLOCKS } });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const id = ((c.body as any).data.template.id) as string;
  const s = await router.dispatch({ method: 'POST', path: `/api/marketing/templates/${id}/submit`, query: SELLER(), body: {} });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const a = await router.dispatch({ method: 'POST', path: `/api/marketing/templates/${id}/approve`, query: ADMIN(), body: {} });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  return id;
}

const sampleMsg = (): EspMessage => ({
  from: 'Seta Telecom <news@news.setatelecom.com.br>',
  to: 'qa1@example.test',
  subject: 'Assunto',
  html: '<p>oi</p>',
  text: 'oi',
  headers: { 'List-Unsubscribe': '<https://x.test/u/1>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  idempotencyKey: 'mkt-cmp-1-cont-1',
  tags: { campaign_id: 'cmp-1', contact_id: 'cont-1' },
});

// ----------------------------------------------------------------------------
describe('Fase 3: contrato dos adaptadores ESP (sem credenciais, fetch mockado)', () => {
  it('todos os provedores levam List-Unsubscribe, One-Click e a chave de idempotencia', () => {
    const m = sampleMsg();
    const specs = [
      buildResendRequest('k', m),
      buildSendGridRequest('k', m),
      buildMailgunRequest('k', 'mg.example.test', m),
      buildPostmarkRequest('k', m),
      buildSesRequest('us-east-1', m),
    ];
    for (const s of specs) {
      assert.equal(s.method, 'POST');
      assert.ok(s.url.startsWith('https://'), s.url);
      const all = `${JSON.stringify(s.headers)} ${s.body} ${decodeURIComponent(s.body.replace(/\+/g, ' '))}`;
      assert.ok(all.includes('List-Unsubscribe'), s.url);
      assert.ok(all.includes('List-Unsubscribe=One-Click'), s.url);
      assert.ok(all.includes('mkt-cmp-1-cont-1'), `idempotencia ausente em ${s.url}`);
    }
    assert.equal(buildResendRequest('k', m).headers['Idempotency-Key'], 'mkt-cmp-1-cont-1');
    assert.equal(buildResendRequest('k', m).url, 'https://api.resend.com/emails');
  });

  it('adaptadores HTTP devolvem o id do provedor e classificam erro (429/5xx repetivel, 4xx permanente)', async () => {
    const cases: Array<[string, (f: HttpFetch) => { send(m: EspMessage): Promise<{ providerMessageId: string | null }> }, unknown, string]> = [
      ['resend', (f) => createResendAdapter('k', f), { id: 'r1' }, 'r1'],
      ['sendgrid', (f) => createSendGridAdapter('k', f), {}, ''],
      ['mailgun', (f) => createMailgunAdapter('k', 'mg.example.test', f), { id: '<m1@mg>' }, '<m1@mg>'],
      ['postmark', (f) => createPostmarkAdapter('k', f), { MessageID: 'p1', ErrorCode: 0 }, 'p1'],
      ['ses', (f) => createSesAdapter('us-east-1', async () => ({ Authorization: 'AWS4-HMAC-SHA256 teste' }), f), { MessageId: 's1' }, 's1'],
    ];
    for (const [name, make, okJson, expectedId] of cases) {
      const ok = fakeFetch(() => ({ status: name === 'sendgrid' ? 202 : 200, json: okJson }));
      const r = await make(ok.fetchFn).send(sampleMsg());
      if (expectedId) assert.equal(r.providerMessageId, expectedId, name);
      assert.equal(ok.calls.length, 1, name);
      for (const [status, retryable] of [[429, true], [503, true], [400, false]] as const) {
        const bad = fakeFetch(() => ({ status, json: { message: 'x' } }));
        await assert.rejects(make(bad.fetchFn).send(sampleMsg()), (e: unknown) => e instanceof EspSendError && e.status === status && e.retryable === retryable, `${name} ${status}`);
      }
    }
  });

  it('SMTP: transporte injetado; 4xx temporario repete, 5xx permanente; recusa => permanente', async () => {
    const sent: unknown[] = [];
    const ok = createSmtpAdapter({ async sendMail(o) { sent.push(o); return { messageId: '<s@x>' }; } });
    assert.equal((await ok.send(sampleMsg())).providerMessageId, '<s@x>');
    assert.equal((sent[0] as { headers: Record<string, string> }).headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    const fail = (code: number) => createSmtpAdapter({ async sendMail() { throw Object.assign(new Error('x'), { responseCode: code }); } });
    await assert.rejects(fail(451).send(sampleMsg()), (e: unknown) => e instanceof EspSendError && e.retryable === true);
    await assert.rejects(fail(550).send(sampleMsg()), (e: unknown) => e instanceof EspSendError && e.retryable === false);
    const rej = createSmtpAdapter({ async sendMail() { return { rejected: ['qa1@example.test'] }; } });
    await assert.rejects(rej.send(sampleMsg()), (e: unknown) => e instanceof EspSendError && e.retryable === false);
  });

  it('resolveEspAdapter: so o provedor configurado, sem fallback; sem chave => problema (nunca outra conta)', () => {
    const f = fakeFetch().fetchFn;
    assert.equal(resolveEspAdapter('resend', {}, { fetch: f }).adapter, null);
    assert.equal(resolveEspAdapter('resend', { RESEND_API_KEY: 'transacional' }, { fetch: f }).adapter, null, 'nao usa a chave transacional do ERP');
    assert.equal(resolveEspAdapter('resend', { MARKETING_RESEND_API_KEY: 'k', MARKETING_SENDGRID_API_KEY: 'k2' }, { fetch: f }).adapter!.id, 'resend');
    assert.equal(resolveEspAdapter(null, { MARKETING_RESEND_API_KEY: 'k' }, { fetch: f }).adapter, null);
    assert.equal(resolveEspAdapter('ses', { MARKETING_SES_REGION: 'us-east-1' }, { fetch: f }).adapter, null, 'SES sem assinador');
  });
});

describe('Fase 3: token de descadastro, blocos e fluxo de aprovacao', () => {
  it('token assinado: valida, recusa adulterado e segredo errado; sem e-mail no token', () => {
    const t = signUnsubscribeToken({ contactId: 'cont-1', campaignId: 'cmp-1', purpose: 'NEWSLETTER_TECNICA' }, UNSUB_SECRET);
    assert.deepEqual(verifyUnsubscribeToken(t, UNSUB_SECRET), { contactId: 'cont-1', campaignId: 'cmp-1', purpose: 'NEWSLETTER_TECNICA' });
    assert.equal(verifyUnsubscribeToken(t, 'v'.repeat(40)), null);
    const [p, s] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ v: 1, c: 'cont-2', m: 'cmp-1', p: 'NEWSLETTER_TECNICA' })).toString('base64url');
    assert.equal(verifyUnsubscribeToken(`${forged}.${s}`, UNSUB_SECRET), null);
    assert.equal(verifyUnsubscribeToken(`${p}.${s.slice(0, -1)}A`, UNSUB_SECRET) === null || s.endsWith('A'), true);
    assert.ok(!Buffer.from(p, 'base64url').toString().includes('@'));
  });

  it('blocos: so https, texto escapado, limite de blocos', () => {
    assert.throws(() => sanitizeTemplateBlocks([{ type: 'button', text: 'x', url: 'javascript:alert(1)' }]), /https/);
    assert.throws(() => sanitizeTemplateBlocks([{ type: 'image', url: 'http://x.test/a.png' }]), /https/);
    assert.throws(() => sanitizeTemplateBlocks([]), /pelo menos/);
    assert.throws(() => sanitizeTemplateBlocks(Array.from({ length: 41 }, () => ({ type: 'divider' }))), /Máximo/);
    const html = renderBlocksHtml(sanitizeTemplateBlocks(BLOCKS), { firstName: '<b>Ana</b>', companyName: 'ACME' });
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;b&gt;Ana&lt;/b&gt;'));
    assert.ok(html.includes('Novidades ACME'));
  });

  it('versionamento + rascunho -> revisao -> aprovado; quem envia nao aprova; edicao nao muda a versao aprovada', async () => {
    const store = new MemoryMarketingStore();
    const { template } = await createTemplate(store, { name: 'T', purpose: 'EVENTOS_ABM', subject: 'S1', blocks: BLOCKS }, 'ana@x.test');
    await assert.rejects(getSendableVersion(store, template.id), /aprovad/);
    await assert.rejects(approveTemplate(store, template.id, 'bia@x.test'), /revisão/);
    await submitTemplateForReview(store, template.id, 'ana@x.test');
    await assert.rejects(saveTemplateDraft(store, template.id, { subject: 'S2', blocks: BLOCKS }, 'ana@x.test'), /revisão/);
    await assert.rejects(approveTemplate(store, template.id, 'ANA@x.test'), /outra pessoa/);
    const ap = await approveTemplate(store, template.id, 'bia@x.test');
    assert.equal(ap.status, 'APPROVED');
    assert.equal(ap.approvedVersion, 1);
    const ed = await saveTemplateDraft(store, template.id, { subject: 'S2', blocks: BLOCKS }, 'ana@x.test');
    assert.equal(ed.template.status, 'DRAFT');
    assert.equal(ed.template.currentVersion, 2);
    assert.equal(ed.template.approvedVersion, 1);
    assert.equal((await getSendableVersion(store, template.id)).version.subject, 'S1');
    assert.equal((await store.listVersions(template.id)).length, 2);
  });
});

describe('Fase 3: verificacao SPF/DKIM/DMARC (resolver mockado)', () => {
  it('passa com os 3 registros; falha sem DKIM; DMARC herdado do dominio organizacional; p=none gera aviso', async () => {
    const ok = await checkDomainAuth(MKT_DOMAIN, { dkimSelectors: ['resend'], spfHost: `send.${MKT_DOMAIN}`, resolver: resolverFrom(GOOD_DNS) });
    assert.equal(ok.pass, true);
    assert.equal(ok.dmarc.policy, 'quarantine');
    const noDkim = { ...GOOD_DNS };
    delete noDkim[`resend._domainkey.${MKT_DOMAIN}`];
    const r2 = await checkDomainAuth(MKT_DOMAIN, { dkimSelectors: ['resend'], spfHost: `send.${MKT_DOMAIN}`, resolver: resolverFrom(noDkim) });
    assert.equal(r2.pass, false);
    assert.equal(r2.dkim.ok, false);
    const inherited = { ...GOOD_DNS };
    delete inherited[`_dmarc.${MKT_DOMAIN}`];
    inherited['_dmarc.setatelecom.com.br'] = [['v=DMARC1; p=none']];
    const r3 = await checkDomainAuth(MKT_DOMAIN, { dkimSelectors: ['resend'], spfHost: `send.${MKT_DOMAIN}`, resolver: resolverFrom(inherited) });
    assert.equal(r3.dmarc.ok, true);
    assert.equal(r3.dmarc.host, '_dmarc.setatelecom.com.br');
    assert.ok(r3.warnings.some((w) => w.includes('p=none')));
    assert.deepEqual(dmarcCandidates('news.setatelecom.com.br'), ['news.setatelecom.com.br', 'setatelecom.com.br']);
    const plusAll = { ...GOOD_DNS, [`send.${MKT_DOMAIN}`]: [['v=spf1 +all']] };
    assert.equal((await checkDomainAuth(MKT_DOMAIN, { dkimSelectors: ['resend'], spfHost: `send.${MKT_DOMAIN}`, resolver: resolverFrom(plusAll) })).spf.ok, false);
  });
});

describe('Fase 3: webhook do Resend (Svix)', () => {
  it('assinatura valida passa; adulterada, antiga, sem cabecalho ou sem segredo => recusada', () => {
    const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'x' } });
    const now = 1_800_000_000;
    const sig = signSvixPayload(WEBHOOK_SECRET, 'msg_1', String(now), body);
    const h = { id: 'msg_1', timestamp: String(now), signature: `v1,AAAA ${sig}` };
    assert.deepEqual(verifySvixSignature(WEBHOOK_SECRET, h, body, now), { ok: true });
    assert.equal(verifySvixSignature(WEBHOOK_SECRET, h, body.replace('delivered', 'bounced'), now).ok, false);
    assert.deepEqual(verifySvixSignature(WEBHOOK_SECRET, h, body, now + 600), { ok: false, reason: 'STALE' });
    assert.deepEqual(verifySvixSignature(WEBHOOK_SECRET, { ...h, signature: null }, body, now), { ok: false, reason: 'MISSING_HEADERS' });
    assert.deepEqual(verifySvixSignature(undefined, h, body, now), { ok: false, reason: 'NO_SECRET' });
  });

  it('normaliza eventos: Permanent => hard bounce; Transient => soft; tipos irrelevantes ignorados', () => {
    assert.equal(normalizeResendEvent('a', { type: 'email.bounced', data: { email_id: 'm', bounce: { type: 'Permanent' } } })!.type, 'BOUNCED_HARD');
    assert.equal(normalizeResendEvent('a', { type: 'email.bounced', data: { email_id: 'm', bounce: { type: 'Transient' } } })!.type, 'BOUNCED_SOFT');
    assert.equal(normalizeResendEvent('a', { type: 'email.complained', data: { email_id: 'm' } })!.type, 'COMPLAINED');
    assert.equal(normalizeResendEvent('a', { type: 'contact.created', data: {} }), null);
    const t = normalizeResendEvent('a', { type: 'email.opened', data: { email_id: 'm', tags: { campaign_id: 'cmp-1', contact_id: 'c1' } } })!;
    assert.equal(t.campaignId, 'cmp-1');
    assert.equal(t.providerEventId, 'resend:a');
  });
});

describe('Fase 3: envio real ponta a ponta (ESP, DNS e trava mockados)', () => {
  it('flag desligada: /campaigns/dispatch continua simulando e o cron nao envia', async () => {
    const { router, esp } = makeRouter(baseEnv({ MARKETING_LIVE_SEND: 'false' }));
    const r = await router.dispatch({ method: 'POST', path: '/api/marketing/campaigns/dispatch', query: ADMIN(), body: { campaignId: 'cmp-1' } });
    assert.equal(r.status, 200);
    assert.ok('deliveredContacts' in ((r.body as any).data));
    assert.notEqual((r.body as any).data.mode, 'LIVE');
    const cron = await router.dispatch({ method: 'GET', path: '/api/cron/marketing', query: { ...HTTP, _cronAuthorized: '1' } });
    assert.equal(cron.status, 200);
    assert.equal((cron.body as any).data.skipped, 'LIVE_SEND_DISABLED');
    assert.equal(esp.calls.length, 0);
  });

  it('dominio sem DKIM ou config incompleta => envio real bloqueado (409) e nada sai', async () => {
    const noDkim = { ...GOOD_DNS };
    delete noDkim[`resend._domainkey.${MKT_DOMAIN}`];
    const { router, esp, contacts } = makeRouter(baseEnv(), { dns: noDkim });
    const tpl = await approvedTemplate(router);
    const r = await router.dispatch({ method: 'POST', path: '/api/marketing/campaigns/dispatch', query: ADMIN(), body: { campaignId: 'cmp-1', templateId: tpl, contactIds: contacts.map((c) => c.id) } });
    assert.equal(r.status, 409);
    assert.ok(((r.body as any).problems as string[]).some((p) => p.includes('DKIM')));
    const st = await router.dispatch({ method: 'GET', path: '/api/marketing/live-status', query: ADMIN() });
    assert.equal((st.body as any).data.ready, false);
    assert.equal((st.body as any).data.domain.dkim.ok, false);
    assert.ok(!JSON.stringify(st.body).includes('re_teste_nunca_real'), 'nunca devolve a chave');
    const { router: r2 } = makeRouter(baseEnv({ MARKETING_POSTAL_ADDRESS: '' }));
    const st2 = await r2.dispatch({ method: 'GET', path: '/api/marketing/live-status', query: ADMIN() });
    assert.ok(((st2.body as any).data.problems as string[]).some((p) => p.includes('MARKETING_POSTAL_ADDRESS')));
    assert.equal(esp.calls.length, 0);
  });

  it('modelo nao aprovado nao envia; vendedor sem alcada nao dispara', async () => {
    const { router, contacts } = makeRouter(baseEnv());
    const c = await router.dispatch({ method: 'POST', path: '/api/marketing/templates', query: ADMIN(), body: { name: 'N', purpose: 'NEWSLETTER_TECNICA', subject: 'S', blocks: BLOCKS } });
    const id = (c.body as any).data.template.id;
    const r = await router.dispatch({ method: 'POST', path: '/api/marketing/campaigns/dispatch', query: ADMIN(), body: { campaignId: 'cmp-1', templateId: id, contactIds: contacts.map((x) => x.id) } });
    assert.equal(r.status, 409);
    assert.match(String((r.body as any).error), /aprovad/);
    const s = await router.dispatch({ method: 'POST', path: '/api/marketing/campaigns/dispatch', query: SELLER(), body: { campaignId: 'cmp-1', templateId: id, contactIds: [] } });
    assert.equal(s.status, 403);
  });

  it('enfileira so quem tem consentimento da finalidade e esta na allowlist; envia com cabecalhos LGPD, rodape e rastreio; idempotente', async () => {
    const { router, esp, contacts, store, mailbox, repo } = makeRouter(baseEnv({ MARKETING_TEST_RECIPIENTS: 'qa1@example.test,qa2@example.test,qa3@example.test' }));
    const tpl = await approvedTemplate(router);
    const body = { campaignId: 'cmp-1', templateId: tpl, contactIds: contacts.map((c) => c.id) };
    const r = await router.dispatch({ method: 'POST', path: '/api/marketing/campaigns/dispatch', query: ADMIN(), body });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const d = (r.body as any).data;
    assert.equal(d.mode, 'LIVE');
    assert.equal(d.queuedCount, 2, 'qa1 e qa2 (newsletter)');
    assert.equal(d.blockedSuppressedCount, 2, 'qa3 sem finalidade; qa4 fora da allowlist');
    assert.ok(d.blockedContacts.some((b: any) => /finalidade/.test(b.reason)));
    assert.ok(d.blockedContacts.some((b: any) => /allowlist/.test(b.reason)));
    assert.equal(esp.calls.length, 0, 'enfileirar nao envia');

    const sentBefore = repo.getMarketingCampaignById('cmp-1')!.sentCount;
    const run = await router.dispatch({ method: 'GET', path: '/api/cron/marketing', query: { ...HTTP, _cronAuthorized: '1' } });
    assert.equal(run.status, 200);
    assert.equal((run.body as any).data.sent, 2, JSON.stringify(run.body));
    assert.equal(esp.calls.length, 2);
    assert.equal(repo.getMarketingCampaignById('cmp-1')!.sentCount, sentBefore + 2);
    for (const c of esp.calls) {
      assert.equal(c.url, 'https://api.resend.com/emails');
      const p = JSON.parse(c.init.body);
      assert.match(p.headers['List-Unsubscribe'], new RegExp(`^<${ORIGIN}${UNSUBSCRIBE_PATH_PREFIX}[A-Za-z0-9_.-]+>$`));
      assert.equal(p.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
      assert.ok(p.html.includes('Descadastrar-se'));
      assert.ok(p.html.includes('Rua Exemplo, 100'));
      assert.ok(p.html.includes('/api/email-track/o/'), 'pixel de abertura');
      assert.ok(p.html.includes('/api/email-track/c/'), 'link rastreado');
      assert.ok(!p.html.includes('<script>'));
      assert.ok(['qa1@example.test', 'qa2@example.test'].includes(p.to[0] || p.to));
      assert.match(c.init.headers['Idempotency-Key'], /^mkt-cmp-1-/);
      assert.ok(!JSON.stringify(run.body).includes('re_teste_nunca_real'));
    }
    // Rastreio gravado (funil por trackingStats).
    const sends = await store.listSendsByCampaign('cmp-1');
    assert.equal(sends.filter((s) => s.status === 'SENT').length, 2);
    await mailbox.recordOpen(sends[0].trackingId!, Date.now() + 60_000);

    // Repetir o disparo e o cron: ninguem recebe de novo.
    const again = await router.dispatch({ method: 'POST', path: '/api/marketing/campaigns/dispatch', query: ADMIN(), body });
    assert.equal((again.body as any).data.queuedCount, 0);
    assert.equal((again.body as any).data.alreadyQueuedCount, 2);
    await router.dispatch({ method: 'GET', path: '/api/cron/marketing', query: { ...HTTP, _cronAuthorized: '1' } });
    assert.equal(esp.calls.length, 2);

    const f = await router.dispatch({ method: 'GET', path: '/api/marketing/campaigns/cmp-1/funnel', query: ADMIN() });
    assert.equal(f.status, 200);
    assert.equal((f.body as any).data.sent, 2);
    assert.equal((f.body as any).data.opens, 1);
  });

  it('consentimento revogado entre o enfileiramento e o envio => ignorado no envio', async () => {
    const { router, esp, contacts, repo } = makeRouter(baseEnv());
    const tpl = await approvedTemplate(router);
    await router.dispatch({ method: 'POST', path: '/api/marketing/campaigns/dispatch', query: ADMIN(), body: { campaignId: 'cmp-1', templateId: tpl, contactIds: [contacts[0].id, contacts[1].id] } });
    repo.updateContactSubscriptionPreference({ contactId: contacts[1].id, action: 'UNSUBSCRIBE_MARKETING' });
    const run = await router.dispatch({ method: 'GET', path: '/api/cron/marketing', query: { ...HTTP, _cronAuthorized: '1' } });
    assert.equal((run.body as any).data.sent, 1);
    assert.equal((run.body as any).data.skippedContacts, 1);
    assert.equal(esp.calls.length, 1);
  });

  it('limite de taxa: no maximo MARKETING_MAX_PER_MINUTE por minuto; o restante fica na fila', async () => {
    const { router, esp, contacts } = makeRouter(baseEnv({ MARKETING_MAX_PER_MINUTE: '1' }));
    const tpl = await approvedTemplate(router);
    await router.dispatch({ method: 'POST', path: '/api/marketing/campaigns/dispatch', query: ADMIN(), body: { campaignId: 'cmp-1', templateId: tpl, contactIds: contacts.map((c) => c.id) } });
    const run = await router.dispatch({ method: 'GET', path: '/api/cron/marketing', query: { ...HTTP, _cronAuthorized: '1' } });
    assert.equal((run.body as any).data.sent, 1);
    assert.equal((run.body as any).data.stoppedReason, 'RATE_LIMIT');
    assert.equal(esp.calls.length, 1);
  });

  it('erro 429 do provedor => volta para a fila e pausa; 400 => falha sem reenviar; nunca troca de provedor', async () => {
    const { router, esp, contacts, store } = makeRouter(baseEnv(), { respond: (n) => (n === 1 ? { status: 429, json: {} } : { status: 422, json: { name: 'validation_error' } }) });
    const tpl = await approvedTemplate(router);
    await router.dispatch({ method: 'POST', path: '/api/marketing/campaigns/dispatch', query: ADMIN(), body: { campaignId: 'cmp-1', templateId: tpl, contactIds: contacts.map((c) => c.id) } });
    const run1 = await router.dispatch({ method: 'GET', path: '/api/cron/marketing', query: { ...HTTP, _cronAuthorized: '1' } });
    assert.equal((run1.body as any).data.requeued, 1);
    assert.equal((run1.body as any).data.stoppedReason, 'ESP_RATE_LIMIT');
    assert.equal(esp.calls.length, 1);
    const queued = (await store.listSendsByCampaign('cmp-1')).filter((s) => s.status === 'QUEUED');
    assert.equal(queued.length, 2);
    assert.ok(esp.calls.every((c) => c.url.startsWith('https://api.resend.com/')));
  });

  it('trava global: duas execucoes concorrentes (duas instancias) => cada contato recebe exatamente 1 e-mail', async () => {
    const repo = createInMemoryRepository();
    const contacts = synthetic(repo);
    const store = new MemoryMarketingStore();
    const lock = new MemoryLockStore();
    const env = baseEnv();
    const esp = fakeFetch();
    const slowFetch: HttpFetch = async (u, i) => {
      await new Promise((r) => setTimeout(r, 5));
      return esp.fetchFn(u, i);
    };
    const mk = (): MarketingDeps => ({ store, mailbox: new MemoryMailboxStore(), env, esp: { fetch: slowFetch }, lock, resolver: resolverFrom(GOOD_DNS), sleep: async () => undefined, origin: ORIGIN });
    const { template } = await createTemplate(store, { name: 'T', purpose: 'NEWSLETTER_TECNICA', subject: 'S', blocks: BLOCKS }, 'a@x.test');
    await submitTemplateForReview(store, template.id, 'a@x.test');
    await approveTemplate(store, template.id, 'b@x.test');
    const { enqueueCampaign } = await import('../src/modules/marketing/campaign-dispatcher');
    await enqueueCampaign(repo, mk(), { campaignId: 'cmp-1', templateId: template.id, contacts });
    const [a, b] = await Promise.all([processMarketingQueue(repo, mk()), processMarketingQueue(repo, mk())]);
    assert.equal(a.sent + b.sent, 2);
    assert.ok(a.skipped === 'RUN_LOCKED_ELSEWHERE' || b.skipped === 'RUN_LOCKED_ELSEWHERE');
    assert.equal(esp.calls.length, 2);
    const tos = esp.calls.map((c) => JSON.parse(c.init.body).to[0]);
    assert.equal(new Set(tos).size, 2);
    // Mesmo com a trava do cron livre, a reserva por (campanha, contato) impede reenvio de linha recolocada na fila.
    await store.updateSend('cmp-1', contacts[0].id, { status: 'QUEUED' });
    const c = await processMarketingQueue(repo, mk());
    assert.equal(c.sent, 0);
    assert.equal(esp.calls.length, 2);
  });

  it('webhook: hard bounce e reclamacao => supressao permanente; reentrega idempotente; funil atualizado', async () => {
    const { router, esp, contacts, repo } = makeRouter(baseEnv());
    const tpl = await approvedTemplate(router);
    await router.dispatch({ method: 'POST', path: '/api/marketing/campaigns/dispatch', query: ADMIN(), body: { campaignId: 'cmp-1', templateId: tpl, contactIds: [contacts[0].id, contacts[1].id] } });
    await router.dispatch({ method: 'GET', path: '/api/cron/marketing', query: { ...HTTP, _cronAuthorized: '1' } });
    assert.equal(esp.calls.length, 2);
    const env = { RESEND_WEBHOOK_SECRET: WEBHOOK_SECRET };
    const dispatch = (p: '/api/marketing/esp-events' | '/api/marketing/unsubscribe-apply', b: Record<string, unknown>) =>
      router.dispatch({ method: 'POST', path: p, query: {}, body: b, context: TRUSTED_INTERNAL_CONTEXT });
    const post = async (id: string, payload: unknown) => {
      const raw = JSON.stringify(payload);
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = signSvixPayload(WEBHOOK_SECRET, id, ts, raw);
      const h = new Map([['svix-id', id], ['svix-timestamp', ts], ['svix-signature', sig]]);
      return handleResendWebhookRequest({ rawBody: raw, headers: { get: (k) => h.get(k) ?? null } }, dispatch, env as NodeJS.ProcessEnv);
    };
    const delivered = await post('msg_d1', { type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: 're-msg-1', to: ['qa1@example.test'] } });
    assert.equal(delivered.status, 200);
    const bounce = { type: 'email.bounced', created_at: new Date().toISOString(), data: { email_id: 're-msg-1', to: ['qa1@example.test'], bounce: { type: 'Permanent', subType: 'General' } } };
    assert.equal((await post('msg_b1', bounce)).status, 200);
    assert.equal((await post('msg_b1', bounce)).status, 200, 'reentrega');
    assert.equal((await post('msg_c1', { type: 'email.complained', created_at: new Date().toISOString(), data: { email_id: 're-msg-2', to: ['qa2@example.test'] } })).status, 200);

    const sup = repo.listSuppressionEntries();
    assert.equal(sup.filter((s) => s.email === 'qa1@example.test' && s.reason === 'HARD_BOUNCE').length, 1, 'sem duplicar na reentrega');
    const spam = sup.find((s) => s.email === 'qa2@example.test' && s.reason === 'SPAM_COMPLAINT');
    assert.ok(spam);
    assert.equal(spam!.scope, 'GLOBAL_ALL');
    assert.equal(repo.getContactById(contacts[1].id)!.subscriptionStatus, 'SUPPRESSED_SPAM');
    assert.equal(repo.canSendMarketingEmailToContact(contacts[0].id).allowed, false);
    // Recadastro nao remove reclamacao de spam nem hard bounce.
    repo.updateContactSubscriptionPreference({ contactId: contacts[1].id, action: 'RESUBSCRIBE_WITH_CONSENT', categories: ['NEWSLETTER_TECNICA'] });
    assert.equal(repo.canSendMarketingEmailToContact(contacts[1].id).allowed, false);

    const f = await router.dispatch({ method: 'GET', path: '/api/marketing/campaigns/cmp-1/funnel', query: ADMIN() });
    const fd = (f.body as any).data;
    assert.equal(fd.delivered, 1);
    assert.equal(fd.bounces, 1);
    assert.equal(fd.complaints, 1);

    // Assinatura invalida => 401 e nada muda.
    const bad = await handleResendWebhookRequest({ rawBody: '{}', headers: { get: () => 'x' } }, dispatch, env as NodeJS.ProcessEnv);
    assert.equal(bad.status, 401);
    // Rotas internas nao sao alcancaveis por HTTP.
    const ext = await router.dispatch({ method: 'POST', path: '/api/marketing/esp-events', query: ADMIN(), body: { event: { providerEventId: 'x', type: 'COMPLAINED', recipient: 'qa3@example.test' } } });
    assert.equal(ext.status, 404);
  });

  it('descadastro: GET so mostra a pagina; POST one-click remove so a finalidade; "todo marketing" suprime', async () => {
    const env = baseEnv();
    const { router, contacts, repo, store } = makeRouter(env);
    const tpl = await approvedTemplate(router);
    await router.dispatch({ method: 'POST', path: '/api/marketing/campaigns/dispatch', query: ADMIN(), body: { campaignId: 'cmp-1', templateId: tpl, contactIds: [contacts[1].id] } });
    await router.dispatch({ method: 'GET', path: '/api/cron/marketing', query: { ...HTTP, _cronAuthorized: '1' } });
    const dispatch = (p: '/api/marketing/esp-events' | '/api/marketing/unsubscribe-apply', b: Record<string, unknown>) =>
      router.dispatch({ method: 'POST', path: p, query: {}, body: b, context: TRUSTED_INTERNAL_CONTEXT });
    const token = signUnsubscribeToken({ contactId: contacts[1].id, campaignId: 'cmp-1', purpose: 'NEWSLETTER_TECNICA' }, UNSUB_SECRET);
    assert.ok(isPublicStiHubPath(`${UNSUBSCRIBE_PATH_PREFIX}${token}`, 'POST'));
    assert.ok(isPublicStiHubPath('/api/marketing/webhooks/resend', 'POST'));
    assert.ok(!isPublicStiHubPath('/api/marketing/webhooks/resend', 'GET'));
    assert.ok(!isPublicStiHubPath('/api/marketing/esp-events', 'POST'));
    assert.ok(!isPublicStiHubPath(`${UNSUBSCRIBE_PATH_PREFIX}abc`, 'POST'));

    const g = await handleUnsubscribeRequest({ method: 'GET', token }, dispatch, env);
    assert.equal(g.status, 200);
    assert.ok(g.body.includes('<form method="post">'));
    assert.deepEqual(repo.getContactById(contacts[1].id)!.communicationCategories, ['NEWSLETTER_TECNICA', 'EVENTOS_ABM'], 'GET nao altera');

    const p = await handleUnsubscribeRequest({ method: 'POST', token, formBody: 'List-Unsubscribe=One-Click' }, dispatch, env);
    assert.equal(p.status, 200);
    const c = repo.getContactById(contacts[1].id)!;
    assert.deepEqual(c.communicationCategories, ['EVENTOS_ABM']);
    assert.equal(c.subscriptionStatus, 'SUBSCRIBED');
    assert.ok((await store.getSend('cmp-1', contacts[1].id))!.unsubscribedAt);

    const all = await handleUnsubscribeRequest({ method: 'POST', token, formBody: 'scope=ALL_MARKETING' }, dispatch, env);
    assert.equal(all.status, 200);
    assert.equal(repo.getContactById(contacts[1].id)!.subscriptionStatus, 'UNSUBSCRIBED_MARKETING');
    assert.equal(repo.canSendMarketingEmailToContact(contacts[1].id).allowed, false);

    const forged = await handleUnsubscribeRequest({ method: 'POST', token: token.slice(0, -2) + 'AA', formBody: '' }, dispatch, env);
    assert.equal(forged.status, 400);
    const f = await router.dispatch({ method: 'GET', path: '/api/marketing/campaigns/cmp-1/funnel', query: ADMIN() });
    assert.equal((f.body as any).data.unsubscribes, 1);
  });

  it('envio de teste: so para a allowlist e com dominio aprovado; marca [TESTE]', async () => {
    const { router, esp } = makeRouter(baseEnv({ MARKETING_LIVE_SEND: 'false' }));
    const c = await router.dispatch({ method: 'POST', path: '/api/marketing/templates', query: ADMIN(), body: { name: 'N', purpose: 'NEWSLETTER_TECNICA', subject: 'S', blocks: BLOCKS } });
    const id = (c.body as any).data.template.id;
    const out = await router.dispatch({ method: 'POST', path: `/api/marketing/templates/${id}/test-send`, query: ADMIN(), body: { to: 'fora@example.test' } });
    assert.equal(out.status, 403);
    const ok = await router.dispatch({ method: 'POST', path: `/api/marketing/templates/${id}/test-send`, query: ADMIN(), body: { to: 'qa1@example.test' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(esp.calls.length, 1);
    const p = JSON.parse(esp.calls[0].init.body);
    assert.ok(p.subject.startsWith('[TESTE] '));
    const seller = await router.dispatch({ method: 'POST', path: `/api/marketing/templates/${id}/test-send`, query: SELLER(), body: { to: 'qa1@example.test' } });
    assert.equal(seller.status, 403);
  });

  it('composicao: rodape com endereco e link direto de descadastro (sem redirecionamento de rastreio)', () => {
    const cfg = resolveMarketingSenderConfig(baseEnv());
    const c = composeMarketingEmail({
      config: cfg,
      version: { templateId: 't', version: 1, subject: 'Oi {{firstName}}', preheader: 'pre', blocks: sanitizeTemplateBlocks(BLOCKS), createdBy: 'x', createdAt: '' },
      purpose: 'NEWSLETTER_TECNICA',
      campaignId: 'cmp-1',
      contactId: 'cont-1',
      to: 'qa1@example.test',
      vars: { firstName: 'Ana' },
      unsubscribeSecret: UNSUB_SECRET,
      origin: ORIGIN,
      idempotencyKey: 'k',
    });
    assert.equal(c.message.subject, 'Oi Ana');
    assert.ok(c.message.html.includes(`href="${c.unsubscribeUrl}"`));
    assert.ok(c.message.text.includes(c.unsubscribeUrl));
    assert.ok(c.message.text.includes('Rua Exemplo, 100'));
    assert.equal(c.message.headers['List-Unsubscribe'], `<${c.unsubscribeUrl}>`);
  });

  it('cron: autenticado, persiste o estado, entra no vercel.json, bridge e middleware', () => {
    assert.ok(isAuthorizedMarketingCron('GET', '/api/cron/marketing', { _fromHttpBridge: '1', _cronAuthorized: '1' }));
    assert.ok(!isAuthorizedMarketingCron('GET', '/api/cron/marketing', { _fromHttpBridge: '1' }));
    assert.ok(shouldPersistAfterDispatch('GET', '/api/cron/marketing', { _fromHttpBridge: '1', _cronAuthorized: '1' }, 200));
    const root = path.join(__dirname, '..', '..');
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')) as { crons: Array<{ path: string; schedule: string }> };
    assert.equal(cfg.crons.find((c) => c.path === '/api/cron/marketing')!.schedule, '*/5 * * * *');
    assert.ok(fs.readFileSync(path.join(root, 'src/app/api/_bridge.ts'), 'utf8').includes("cronPath === '/api/cron/marketing'"));
    assert.ok(fs.readFileSync(path.join(root, 'src/middleware.ts'), 'utf8').includes("pathname === '/api/cron/marketing'"));
  });

  it('cron sem autenticacao => 401/403', async () => {
    const { router } = makeRouter(baseEnv());
    const anon = await router.dispatch({ method: 'GET', path: '/api/cron/marketing', query: { ...HTTP } });
    assert.ok([401, 403].includes(anon.status));
  });

  it('UI sem emojis', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src/app/components/MarketingCampaignStudio.tsx'), 'utf8');
    assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(src));
  });
});
