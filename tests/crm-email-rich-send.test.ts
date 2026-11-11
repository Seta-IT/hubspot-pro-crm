// ============================================================================
// STI-hub — Envio de e-mail do CRM em HTML (formatação, logo CID, anexos e rastreio).
// ============================================================================
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { CrmApiRouter } from '../src/api/router';
import { createInMemoryRepository } from './helpers/legacy-proposal-fixtures';
import { buildTrackedEmailBody, newTrackingId, trackingSignature } from '../src/modules/email/mail-tracking';
import {
  sanitizeEmailHtml,
  sanitizeHref,
  htmlToPlainText,
  plainTextToHtml,
  isEmptyEmailHtml,
} from '../src/modules/email/email-html';
import {
  parseMailboxAttachments,
  toGraphFileAttachment,
  GRAPH_SIMPLE_ATTACHMENT_MAX_BYTES,
  MAILBOX_MAX_ATTACHMENT_BYTES,
  MAILBOX_MAX_ATTACHMENTS,
  MAILBOX_ATTACHMENT_TOO_LARGE,
  MAILBOX_ATTACHMENT_TYPE_DENIED,
} from '../src/modules/email/mailbox-attachments';
import { applyServerInlineImages } from '../src/modules/email/mailbox-inline-images';
import { buildGraphMailDraftPayload } from '../src/modules/email/ms-graph';
import { MAILBOX_MAX_RECIPIENTS } from '../src/api/mailbox-routes';
import { MemoryMailboxStore } from '../src/modules/email/mailbox-store';
import { SETA_LOGO_CID, SETA_LOGO_CONTENT_BASE64, SETA_LOGO_FILENAME } from '../src/modules/email/seta-logo';

const HTTP = { _fromHttpBridge: '1' };
const tok = (uid: string, email: string, roleId: string, extra: Record<string, unknown> = {}) =>
  signStiHubSessionToken({
    uid, email, name: 'Teste', roleId, scope: roleId === 'SUPER_ADMIN' ? 'TODOS' : 'PROPRIOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000, ...extra,
  } as Parameters<typeof signStiHubSessionToken>[0]);
const ADMIN = () => ({ ...HTTP, _sessionToken: tok('usr-seta-01', 'marcelo.mira@setatelecom.com.br', 'SUPER_ADMIN', { canManageUsersRbac: true }) });

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
function graphMock() {
  const calls: Call[] = [];
  const res = (status: number, json: unknown) => ({ ok: status < 400, status, json: async () => json, text: async () => JSON.stringify(json) });
  const fetchFn = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init?.method || 'GET', body: init?.body, headers: init?.headers });
    if (url.includes('/oauth2/v2.0/token')) return res(200, { access_token: 'at-123', refresh_token: 'rt-456', expires_in: 3600, scope: 'Mail.Send Mail.Read' });
    if (url.includes('/me?$select')) return res(200, { mail: 'marcelo.mira@setatelecom.com.br', displayName: 'Marcelo Mira' });
    if (url.endsWith('/me/messages') && init?.method === 'POST') return res(201, { id: 'msg-1', conversationId: 'conv-1', internetMessageId: '<a@b>' });
    if (/\/me\/messages\/[^/]+\/send$/.test(url)) return res(202, null);
    return res(404, {});
  };
  return { calls, fetchFn };
}

function setup() {
  const repo = createInMemoryRepository();
  const store = new MemoryMailboxStore();
  const mock = graphMock();
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

const pdfB64 = Buffer.from('%PDF-1.4 test').toString('base64');

describe('sanitização HTML do e-mail (XSS)', () => {
  const payloads = [
    '<script>alert(1)</script>',
    '<SCRIPT>alert(1)</SCRIPT>',
    '<img src=x onerror=alert(1)>',
    '<img src="x" onerror="alert(1)">',
    '<a href="javascript:alert(1)">x</a>',
    '<a href="JAVASCRIPT:alert(1)">x</a>',
    '<a href="java\tscript:alert(1)">x</a>',
    '<a href="javascript&#58;alert(1)">x</a>',
    '<a href="java&#115;cript:alert(1)">x</a>',
    '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
    '<a href="vbscript:msgbox(1)">x</a>',
    '<iframe src="https://evil.example"></iframe>',
    '<svg><script>alert(1)</script></svg>',
    '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
    '<p style="background:url(javascript:alert(1))">x</p>',
    '<p style="color:expression(alert(1))">x</p>',
    '<p style="background-image:url(https://evil.example/x)">x</p>',
    '<a href="https://ok.example" onclick="alert(1)">x</a>',
    '<div onmouseover="alert(1)">x</div>',
    '<a href="https://user:pass@evil.example/">x</a>',
    '<!-- --><img src=x onerror=alert(1)> -->',
    '<form action="https://evil.example"><input name="x"></form>',
    '<object data="https://evil.example"></object>',
    '<embed src="https://evil.example">',
    '<meta http-equiv="refresh" content="0;url=https://evil.example">',
    '<base href="https://evil.example/">',
    '<link rel="stylesheet" href="javascript:alert(1)">',
    '<img src="data:image/svg+xml;base64,PHN2Zy9vbmxvYWQ+">',
  ];

  it('remove payloads perigosos e não deixa on*/javascript:/data:', () => {
    for (const payload of payloads) {
      const out = sanitizeEmailHtml(`Olá ${payload} mundo`);
      assert.doesNotMatch(out, /<script/i, payload);
      assert.doesNotMatch(out, /onerror\s*=/i, payload);
      assert.doesNotMatch(out, /onclick\s*=/i, payload);
      assert.doesNotMatch(out, /onmouseover\s*=/i, payload);
      assert.doesNotMatch(out, /javascript:/i, payload);
      assert.doesNotMatch(out, /vbscript:/i, payload);
      assert.doesNotMatch(out, /data:/i, payload);
      assert.doesNotMatch(out, /<iframe/i, payload);
      assert.doesNotMatch(out, /<svg/i, payload);
      assert.doesNotMatch(out, /<object/i, payload);
      assert.doesNotMatch(out, /<embed/i, payload);
      assert.doesNotMatch(out, /<form/i, payload);
      assert.doesNotMatch(out, /expression\(/i, payload);
      assert.doesNotMatch(out, /url\(/i, payload);
      assert.doesNotMatch(out, /user:pass@/i, payload);
    }
  });

  it('mantém formatação legítima, links http(s) e imagem cid', () => {
    const html = sanitizeEmailHtml(
      '<p style="text-align:center"><b>Olá</b> <i>cliente</i> <u>certo</u></p><ul><li>Um</li></ul><a href="https://setatelecom.com.br/p/1">proposta</a><img src="cid:seta-it-logo" alt="SETA | IT" width="200" height="64">'
    );
    assert.match(html, /<b>Olá<\/b>/);
    assert.match(html, /<(i|em)>cliente<\/(i|em)>/);
    assert.match(html, /<u>certo<\/u>/);
    assert.match(html, /text-align: center/);
    assert.match(html, /<a href="https:\/\/setatelecom\.com\.br\/p\/1"/);
    assert.match(html, /rel="noopener noreferrer"/);
    assert.match(html, /src="cid:seta-it-logo"/);
    assert.match(html, /alt="SETA \| IT"/);
    assert.equal(sanitizeEmailHtml('<img src="https://evil.example/x.png" alt="x">'), '');
    assert.equal(sanitizeEmailHtml('<img src="//evil.example/x.png">'), '');
    assert.equal(sanitizeEmailHtml('<img src="cid:stihub-inline-0" alt="foto">'), '<img src="cid:stihub-inline-0" alt="foto" />');
    assert.equal(sanitizeEmailHtml('<img src="cid:qualquer-coisa">'), '');
    assert.equal(sanitizeHref('mailto:ana@totvs.com'), 'mailto:ana@totvs.com');
    assert.equal(sanitizeHref('javascript:alert(1)'), null);
    assert.equal(htmlToPlainText('<p>Olá <b>Ana</b></p><br>ok').replace(/\n+/g, '\n'), 'Olá Ana\nok');
    assert.equal(isEmptyEmailHtml('<p><br></p>'), true);
    assert.equal(isEmptyEmailHtml('<p>Oi</p>'), false);
    assert.equal(plainTextToHtml('a < b\nc'), 'a &lt; b<br>c');
  });

  it('html/body envoltórios são desembrulhados (o conteúdo seguro permanece)', () => {
    const out = sanitizeEmailHtml('<html><body><b>ok</b><script>x()</script></body></html>');
    assert.match(out, /<b>ok<\/b>/);
    assert.doesNotMatch(out, /script/i);
  });
});

describe('rastreio sobre HTML sanitizado', () => {
  beforeEach(() => enableEnv());

  it('não escapa HTML legítimo e reescreve só os href http(s)', () => {
    const id = newTrackingId();
    const built = buildTrackedEmailBody({
      body: 'Olá <b>cliente</b> veja <a href="https://setatelecom.com.br/proposta?id=1">a proposta</a> e também https://setatelecom.com.br/p/2.<script>alert(1)</script>',
      signature: 'Marcelo\nSeta',
      trackingId: id,
      origin: 'https://sti-hub.vercel.app',
      bodyFormat: 'html',
      logoCid: SETA_LOGO_CID,
    });
    assert.match(built.html, /<b>cliente<\/b>/);
    assert.doesNotMatch(built.html, /&lt;b&gt;cliente/);
    assert.doesNotMatch(built.html, /<script/i);
    assert.deepEqual(built.links, ['https://setatelecom.com.br/proposta?id=1', 'https://setatelecom.com.br/p/2']);
    assert.match(built.html, new RegExp(`/api/email-track/c/${id}/0/${trackingSignature(id, 0)}`));
    assert.match(built.html, new RegExp(`/api/email-track/c/${id}/1/${trackingSignature(id, 1)}`));
    assert.match(built.html, new RegExp(`/api/email-track/o/${id}/${trackingSignature(id)}`));
    assert.match(built.html, /cid:seta-it-logo/);
    assert.match(built.text, /cliente/);
    assert.match(built.text, /Marcelo\nSeta/);
  });

  it('não reabre XSS ao aplicar o rastreio e não rastreia mailto/cid', () => {
    const id = newTrackingId();
    const built = buildTrackedEmailBody({
      body: '<a href="javascript:alert(1)">x</a><a href="mailto:ana@totvs.com">ana</a><img src="cid:seta-it-logo" alt="">',
      trackingId: id,
      origin: 'https://sti-hub.vercel.app',
      bodyFormat: 'html',
    });
    assert.doesNotMatch(built.html, /javascript:/i);
    assert.match(built.html, /mailto:ana@totvs.com/);
    assert.doesNotMatch(built.html, /\/api\/email-track\/c\/.*mailto/);
    assert.equal(built.links.length, 0);
    assert.match(built.html, /cid:seta-it-logo/);
  });

  it('modo texto (compatível) continua escapando HTML do usuário', () => {
    const id = newTrackingId();
    const b = buildTrackedEmailBody({
      body: 'Olá <b>cliente</b>\nVeja https://setatelecom.com.br/proposta?id=1.',
      signature: 'Marcelo\nSeta',
      trackingId: id,
      origin: 'https://sti-hub.vercel.app',
    });
    assert.ok(b.html.includes('&lt;b&gt;cliente&lt;/b&gt;'));
    assert.ok(!b.html.includes('<b>cliente'));
  });
});

describe('anexos: tipos, tamanho e payload do Graph', () => {
  it('aceita PDF/imagens da allowlist e recusa tipo, path/url e tamanho', () => {
    const ok = parseMailboxAttachments([
      { filename: 'proposta.pdf', contentType: 'application/pdf', contentBase64: pdfB64 },
    ]);
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.attachments[0].filename, 'proposta.pdf');
      assert.equal(ok.attachments[0].contentType, 'application/pdf');
    }

    const exe = parseMailboxAttachments([{ filename: 'a.exe', contentType: 'application/octet-stream', contentBase64: pdfB64 }]);
    assert.equal(exe.ok, false);
    if (!exe.ok) assert.equal(exe.code, 'MAILBOX_ATTACHMENT_TYPE');

    const html = parseMailboxAttachments([{ filename: 'x.html', contentType: 'text/html', contentBase64: Buffer.from('<b>x</b>').toString('base64') }]);
    assert.equal(html.ok, false);

    const svg = parseMailboxAttachments([{ filename: 'x.svg', contentType: 'image/svg+xml', contentBase64: Buffer.from('<svg></svg>').toString('base64') }]);
    assert.equal(svg.ok, false);
    if (!svg.ok) assert.match(svg.error, /não é permitido/i);

    const withUrl = parseMailboxAttachments([{ filename: 'a.pdf', contentType: 'application/pdf', contentBase64: pdfB64, url: 'https://evil.example/a.pdf' }]);
    assert.equal(withUrl.ok, false);

    const withPath = parseMailboxAttachments([{ filename: 'a.pdf', contentType: 'application/pdf', contentBase64: pdfB64, path: '/etc/passwd' }]);
    assert.equal(withPath.ok, false);

    const big = Buffer.alloc(MAILBOX_MAX_ATTACHMENT_BYTES + 1, 1).toString('base64');
    const tooBig = parseMailboxAttachments([{ filename: 'grande.pdf', contentType: 'application/pdf', contentBase64: big }]);
    assert.equal(tooBig.ok, false);
    if (!tooBig.ok) {
      assert.equal(tooBig.code, 'MAILBOX_ATTACHMENT_TOO_LARGE');
      assert.equal(tooBig.error, MAILBOX_ATTACHMENT_TOO_LARGE);
    }

    const many = parseMailboxAttachments(
      Array.from({ length: MAILBOX_MAX_ATTACHMENTS + 1 }, (_, i) => ({
        filename: `f${i}.pdf`,
        contentType: 'application/pdf',
        contentBase64: pdfB64,
      }))
    );
    assert.equal(many.ok, false);
    if (!many.ok) assert.equal(many.code, 'MAILBOX_ATTACHMENT_LIMIT');

    assert.match(MAILBOX_ATTACHMENT_TYPE_DENIED, /PDF/);
  });

  it('monta o payload do Graph com HTML, logo inline (CID) e anexos de arquivo', () => {
    const parsed = parseMailboxAttachments([
      { filename: 'proposta.pdf', contentType: 'application/pdf', contentBase64: pdfB64 },
    ]);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const payload = buildGraphMailDraftPayload({
      to: ['ana@totvs.com'],
      cc: [],
      bcc: ['copia@setatelecom.com.br'],
      subject: 'Proposta',
      html: '<div><b>Olá</b><img src="cid:seta-it-logo" alt="SETA | IT" /></div>',
      text: 'Olá',
      attachments: [
        {
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: SETA_LOGO_FILENAME,
          contentType: 'image/png',
          contentBytes: SETA_LOGO_CONTENT_BASE64,
          isInline: true,
          contentId: SETA_LOGO_CID,
        },
        toGraphFileAttachment(parsed.attachments[0]),
      ],
    });
    const body = payload.body as { contentType: string; content: string };
    assert.equal(body.contentType, 'HTML');
    assert.match(body.content, /<b>Olá<\/b>/);
    assert.match(body.content, /cid:seta-it-logo/);
    assert.equal('text' in payload, false, 'Graph itemBody aceita um único corpo; o texto fica só na timeline');
    const atts = payload.attachments as Array<Record<string, unknown>>;
    assert.equal(atts.length, 2);
    assert.equal(atts[0].isInline, true);
    assert.equal(atts[0].contentId, SETA_LOGO_CID);
    assert.equal(atts[0].name, SETA_LOGO_FILENAME);
    assert.ok(String(atts[0].contentBytes).length > 100);
    assert.equal(atts[1].isInline, undefined);
    assert.equal(atts[1].name, 'proposta.pdf');
    assert.equal(atts[1].contentBytes, pdfB64);
    assert.deepEqual((payload.bccRecipients as Array<{ emailAddress: { address: string } }>)[0].emailAddress, { address: 'copia@setatelecom.com.br' });
  });
});

describe('POST /api/mailbox/send com HTML e anexos', () => {
  beforeEach(() => disableEnv());

  it('envia HTML sanitizado, inclui logo CID, guarda só os nomes na timeline e recusa anexo inválido', async () => {
    enableEnv();
    const { router, store, mock, contact } = setup();
    await connect(router);
    const ok = await router.dispatch({
      method: 'POST',
      path: '/api/mailbox/send',
      query: ADMIN(),
      body: {
        to: contact.email,
        subject: 'Proposta formatada',
        body: '<p>Olá <b>Ana</b>, segue a <a href="https://setatelecom.com.br/p/4704">proposta</a>.</p><img src=x onerror=alert(1)><img src="https://evil.example/x.png">',
        bodyFormat: 'html',
        contactId: contact.id,
        attachments: [{ filename: 'proposta.pdf', contentType: 'application/pdf', contentBase64: pdfB64 }],
      },
    });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const data = (ok.body as { data: { email: Record<string, unknown> } }).data;
    assert.deepEqual(data.email.attachmentNames, ['proposta.pdf']);
    assert.ok(!JSON.stringify(data).includes(pdfB64), 'conteúdo do anexo não sai na resposta');

    const draft = mock.calls.find((c) => c.url.endsWith('/me/messages') && c.method === 'POST')!;
    const payload = JSON.parse(String(draft.body));
    assert.equal(payload.body.contentType, 'HTML');
    assert.match(payload.body.content, /<b>Ana<\/b>/);
    assert.doesNotMatch(payload.body.content, /onerror/i);
    assert.doesNotMatch(payload.body.content, /evil\.example/);
    assert.match(payload.body.content, /cid:seta-it-logo/);
    const imgSrcs = [...String(payload.body.content).matchAll(/<img\b[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(imgSrcs.every((src) => src.startsWith('cid:') || src.includes('/api/email-track/o/')), imgSrcs.join(' '));
    assert.match(payload.body.content, /\/api\/email-track\//);
    const logo = payload.attachments.find((a: { contentId?: string }) => a.contentId === SETA_LOGO_CID);
    assert.equal(logo.isInline, true);
    assert.equal(payload.attachments.some((a: { name: string }) => a.name === 'proposta.pdf'), true);

    const tl = await router.dispatch({ method: 'GET', path: '/api/mailbox/timeline', query: { ...ADMIN(), contactId: contact.id } });
    const list = (tl.body as { data: Array<Record<string, unknown>> }).data;
    assert.deepEqual(list[0].attachmentNames, ['proposta.pdf']);
    assert.ok(!JSON.stringify(list).includes(pdfB64));
    assert.equal(store.messages[0].attachmentNames![0], 'proposta.pdf');

    const denied = await router.dispatch({
      method: 'POST',
      path: '/api/mailbox/send',
      query: ADMIN(),
      body: {
        to: contact.email,
        subject: 'Anexo ruim',
        body: '<p>x</p>',
        bodyFormat: 'html',
        contactId: contact.id,
        attachments: [{ filename: 'evil.html', contentType: 'text/html', contentBase64: Buffer.from('<script>x</script>').toString('base64') }],
      },
    });
    assert.equal(denied.status, 400);
    assert.equal((denied.body as { code: string }).code, 'MAILBOX_ATTACHMENT_TYPE');

    const huge = await router.dispatch({
      method: 'POST',
      path: '/api/mailbox/send',
      query: ADMIN(),
      body: {
        to: contact.email,
        subject: 'Grande',
        body: '<p>x</p>',
        bodyFormat: 'html',
        contactId: contact.id,
        attachments: [{
          filename: 'grande.pdf',
          contentType: 'application/pdf',
          contentBase64: Buffer.alloc(MAILBOX_MAX_ATTACHMENT_BYTES + 8, 1).toString('base64'),
        }],
      },
    });
    assert.equal(huge.status, 400);
    assert.equal((huge.body as { code: string }).code, 'MAILBOX_ATTACHMENT_TOO_LARGE');
  });

  it('monta no servidor o CID da imagem do corpo e não aceita src remoto', async () => {
    enableEnv();
    const { router, mock, contact } = setup();
    await connect(router);
    const pngB64 = Buffer.from('PNGDATA').toString('base64');
    const sent = await router.dispatch({
      method: 'POST',
      path: '/api/mailbox/send',
      query: ADMIN(),
      body: {
        to: contact.email,
        subject: 'Com foto',
        body: '<p>Veja</p><img src="cid:stihub-inline-0" alt="foto"><img src="https://evil.example/x.png">',
        bodyFormat: 'html',
        contactId: contact.id,
        inlineImages: [{ filename: 'foto.png', contentType: 'image/png', contentBase64: pngB64 }],
      },
    });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    const draft = mock.calls.find((c) => c.url.endsWith('/me/messages') && c.method === 'POST')!;
    const payload = JSON.parse(String(draft.body));
    assert.doesNotMatch(payload.body.content, /evil\.example/);
    assert.doesNotMatch(payload.body.content, /cid:stihub-inline-/);
    assert.match(payload.body.content, /cid:stihub-img-[0-9a-f]{16}/);
    const inline = payload.attachments.find((a: { contentId?: string }) => String(a.contentId || '').startsWith('stihub-img-'));
    assert.equal(inline.isInline, true);
    assert.equal(inline.name, 'foto.png');
    assert.equal(inline.contentBytes, pngB64);
    const data = (sent.body as { data: { email: { attachmentNames: string[] } } }).data;
    assert.ok(data.email.attachmentNames.includes('foto.png'));
    assert.ok(!JSON.stringify(sent.body).includes(pngB64));
  });
});


describe('imagens só via CID montado no servidor', () => {
  it('recusa src remoto e só remapeia cid:stihub-inline-N com arquivo do servidor', () => {
    const pngB64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');
    const parsed = parseMailboxAttachments(
      [{ filename: 'foto.png', contentType: 'image/png', contentBase64: pngB64 }],
      { imagesOnly: true }
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const html = sanitizeEmailHtml(
      '<p>Oi</p><img src="https://evil.example/x.png"><img src="cid:stihub-inline-0" alt="foto"><img src="cid:stihub-inline-9" alt="sumiu">'
    );
    assert.doesNotMatch(html, /evil\.example/);
    assert.doesNotMatch(html, /https?:\/\//);
    const out = applyServerInlineImages(html, parsed.attachments);
    assert.doesNotMatch(out.html, /cid:stihub-inline-/);
    assert.match(out.html, /cid:stihub-img-[0-9a-f]{16}/);
    assert.equal(out.attachments.length, 1);
    assert.equal(out.attachments[0].isInline, true);
    assert.match(String(out.attachments[0].contentId), /^stihub-img-[0-9a-f]{16}$/);
    assert.doesNotMatch(out.html, /src=""/);
    assert.doesNotMatch(out.html, /alt="sumiu"/);
  });

  it('inlineImages rejeita PDF e contentId/url vindos do cliente', () => {
    const pdf = parseMailboxAttachments(
      [{ filename: 'proposta.pdf', contentType: 'application/pdf', contentBase64: Buffer.from('%PDF-1.4 test').toString('base64') }],
      { imagesOnly: true }
    );
    assert.equal(pdf.ok, false);
    const withCid = parseMailboxAttachments([
      { filename: 'foto.png', contentType: 'image/png', contentBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'), contentId: 'evil' },
    ]);
    assert.equal(withCid.ok, false);
  });
});

describe('Cco fora do histórico e teto de destinatários', () => {
  beforeEach(() => disableEnv());

  it('Cco vai só ao Graph; não aparece na timeline, no registro, na resposta nem na auditoria', async () => {
    enableEnv();
    const { router, store, mock, contact, repo } = setup();
    await connect(router);
    const bcc = 'oculto@interno-exemplo.invalid';
    const s = await router.dispatch({
      method: 'POST',
      path: '/api/mailbox/send',
      query: ADMIN(),
      body: {
        to: contact.email,
        cc: 'copia@cliente.invalid',
        bcc,
        subject: 'Proposta com Cco',
        body: '<p>Olá</p>',
        bodyFormat: 'html',
        contactId: contact.id,
      },
    });
    assert.equal(s.status, 201, JSON.stringify(s.body));
    const draft = mock.calls.find((c) => c.url.endsWith('/me/messages') && c.method === 'POST')!;
    const payload = JSON.parse(String(draft.body));
    const bccAddrs = (payload.bccRecipients || []).map((r: { emailAddress: { address: string } }) => r.emailAddress.address);
    assert.deepEqual(bccAddrs, [bcc]);
    const leaked = JSON.stringify({ body: s.body, stored: store.messages });
    assert.equal(leaked.includes(bcc), false, leaked);
    const tl = await router.dispatch({ method: 'GET', path: '/api/mailbox/timeline', query: { ...ADMIN(), contactId: contact.id } });
    assert.equal(JSON.stringify(tl.body).includes(bcc), false);
    const list = (tl.body as { data: Array<{ cc: string[]; to: string[] }> }).data;
    assert.deepEqual(list[0].to, [contact.email.toLowerCase()]);
    assert.deepEqual(list[0].cc, ['copia@cliente.invalid']);
    assert.equal('bcc' in list[0], false);
    const audit = JSON.stringify(repo.listSecurityAuditLogs(50).logs);
    assert.equal(audit.includes(bcc), false, audit);
  });

  it(`rejeita mais de ${MAILBOX_MAX_RECIPIENTS} destinatários somando Para, Cc e Cco`, async () => {
    enableEnv();
    const { router, contact } = setup();
    await connect(router);
    const extra = Array.from({ length: MAILBOX_MAX_RECIPIENTS }, (_, i) => `n${i}@cliente.invalid`);
    const over = await router.dispatch({
      method: 'POST',
      path: '/api/mailbox/send',
      query: ADMIN(),
      body: {
        to: [contact.email, ...extra],
        subject: 'Muitos',
        body: '<p>x</p>',
        bodyFormat: 'html',
        contactId: contact.id,
      },
    });
    assert.equal(over.status, 400);
    assert.equal((over.body as { code: string }).code, 'MAILBOX_INVALID_BODY');
    const atCap = await router.dispatch({
      method: 'POST',
      path: '/api/mailbox/send',
      query: ADMIN(),
      body: {
        to: contact.email,
        cc: extra.slice(0, 10),
        bcc: extra.slice(10, MAILBOX_MAX_RECIPIENTS - 1),
        subject: 'No teto',
        body: '<p>x</p>',
        bodyFormat: 'html',
        contactId: contact.id,
      },
    });
    assert.equal(atCap.status, 201, JSON.stringify(atCap.body));
    assert.equal(MAILBOX_MAX_RECIPIENTS, 20);
  });
});

describe('marca oficial e compositor', () => {
  it('o PNG da marca existe e o compositor envia HTML com anexo desbloqueado', () => {
    const png = readFileSync(join(process.cwd(), 'public/brand/seta-it-logo.png'));
    assert.equal(png.subarray(0, 8).toString('binary'), '\x89PNG\r\n\x1a\n');
    assert.ok(SETA_LOGO_CONTENT_BASE64.length > 100);
    const modal = readFileSync(join(process.cwd(), 'src/app/components/email/CrmEmailComposerModal.tsx'), 'utf8');
    assert.match(modal, /contentEditable/);
    assert.match(modal, /bodyFormat: 'html'/);
    assert.match(modal, /data-testid="crm-mail-attach"/);
    assert.doesNotMatch(modal, /disabled\s*\n\s*title="Anexos no envio/);
  });
});
