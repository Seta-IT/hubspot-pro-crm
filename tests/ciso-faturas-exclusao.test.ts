// Parecer CISO sobre o lote 4aca979/c571a0b: public-link, GET /api/p, send-email e DELETE de pipeline.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository, type CrmRepository } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import {
  buildEmailHtmlFromText,
  clientProvidedAttachmentPayload,
  collectEmailRecipients,
  MAX_EMAIL_RECIPIENTS,
} from '../src/modules/erp/send-email-guards';

const HTTP = { _fromHttpBridge: '1' };
const ADMIN = 'usr-seta-01';
const VEND = 'usr-seta-03';
const FIN = 'usr-seta-04';
const GER = 'usr-seta-02';

const saved: Record<string, string | undefined> = {};

before(() => {
  for (const key of ['STI_HUB_PROPOSAL_LINK_SECRET', 'STI_HUB_SESSION_SECRET']) {
    saved[key] = process.env[key];
  }
  process.env.STI_HUB_PROPOSAL_LINK_SECRET = 'c'.repeat(48);
  process.env.STI_HUB_SESSION_SECRET = process.env.STI_HUB_SESSION_SECRET || 's'.repeat(48);
});

after(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

let ipn = 40;
const ip = () => `198.51.100.${(ipn++ % 200) + 1}`;

const tokFor = (repo: CrmRepository, uid: string, extra: Record<string, unknown> = {}) => {
  const r = repo.findRbacUserRecord(uid, '')!;
  return signStiHubSessionToken({
    uid: r.id,
    email: r.email,
    name: r.name,
    roleId: r.roleId,
    scope: r.scope,
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'],
    moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true,
    mfaMethod: 'TOTP_AUTHENTICATOR',
    iat: Date.now() - 1000,
    exp: Date.now() + 3_600_000,
    ...extra,
  } as Parameters<typeof signStiHubSessionToken>[0]);
};

const q = (repo: CrmRepository, uid: string, extra?: Record<string, unknown>) => ({
  ...HTTP,
  _clientIp: ip(),
  _sessionToken: tokFor(repo, uid, extra),
});

const mk = () => {
  const repo = createInMemoryRepository();
  const router = new CrmApiRouter(repo);
  return { repo, router };
};

async function withResend<T>(fn: (calls: Array<Record<string, unknown>>) => Promise<T>): Promise<T> {
  const prevFetch = globalThis.fetch;
  const prevKey = process.env.RESEND_API_KEY;
  const prevFrom = process.env.RESEND_FROM_EMAIL;
  const calls: Array<Record<string, unknown>> = [];
  process.env.RESEND_API_KEY = 're_test_dummy_key_nao_real';
  process.env.RESEND_FROM_EMAIL = 'STI-hub <no-reply@notificacoes.setatelecom.com.br>';
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    calls.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({ id: 'email-test' }), { status: 200 });
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
    if (prevFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = prevFrom;
  }
}

async function createOwnedProposal(
  router: CrmApiRouter,
  owner: { email: string; name: string },
  title: string
) {
  const r = await router.dispatch({
    context: TRUSTED_INTERNAL_CONTEXT,
    method: 'POST',
    path: '/api/erp/proposals',
    body: {
      title,
      companyName: 'Cliente Visível LTDA',
      status: 'ENVIADA',
      sellerName: owner.name,
      sellerEmail: owner.email,
      items: [
        {
          id: `i-${title}`,
          description: 'Item',
          quantity: 1,
          unitPrice: 100,
          isRecurring: true,
          ncmOrServiceCode: 'NCM 8517.62.14',
        },
      ],
    },
  });
  assert.ok(r.status === 201 || r.status === 200, `proposta ${title}: ${JSON.stringify(r.body)}`);
  return (r.body as { data: { id: string; code?: string; sellerEmail?: string; sellerUserId?: string } }).data;
}

describe('CISO — helpers de e-mail (destinatários e HTML)', () => {
  it('valida e-mails e aplica teto de to+cc+bcc', () => {
    const ok = collectEmailRecipients({ to: 'a@exemplo.invalid, b@exemplo.invalid', cc: 'c@exemplo.invalid' });
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.total, 3);
    const bad = collectEmailRecipients({ to: 'nao-e-email' });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.code, 'EMAIL_RECIPIENT_INVALID');
    const many = Array.from({ length: MAX_EMAIL_RECIPIENTS + 1 }, (_, i) => `u${i}@exemplo.invalid`).join(',');
    const over = collectEmailRecipients({ to: many });
    assert.equal(over.ok, false);
    if (!over.ok) assert.equal(over.code, 'EMAIL_RECIPIENT_LIMIT');
  });

  it('monta HTML no servidor com escape e recusa content/url/path do cliente', () => {
    const html = buildEmailHtmlFromText('Olá <img src=x onerror=alert(1)>');
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.equal(html.includes('<img src=x'), false);
    assert.equal(clientProvidedAttachmentPayload({ attachments: [{ filename: 'a.html', content: 'YWFh' }] }), true);
    assert.equal(clientProvidedAttachmentPayload({ attachments: [{ filename: 'a.html', url: 'https://evil.example/x' }] }), true);
    assert.equal(clientProvidedAttachmentPayload({ attachments: [{ filename: 'a.html', path: '/etc/passwd' }] }), true);
    assert.equal(clientProvidedAttachmentPayload({ attachments: [{ filename: 'recibo.html' }] }), false);
    assert.equal(clientProvidedAttachmentPayload({}), false);
  });
});

describe('CISO 1 — POST /api/erp/invoices/:id/public-link', () => {
  it('sem alçada financeira responde 403 auditado; no escopo PROPRIOS/EQUIPE a fatura de outro vendedor some em 404', async () => {
    const { repo, router } = mk();
    const fin = repo.findRbacUserRecord(FIN, '')!;
    const vend = repo.findRbacUserRecord(VEND, '')!;
    const mine = await createOwnedProposal(router, { email: fin.email, name: fin.name }, 'Da Michelle');
    const other = await createOwnedProposal(router, { email: vend.email, name: vend.name }, 'Da Maria');
    const invMine = repo.createInvoice({
      companyName: 'Cliente Visível LTDA',
      grossAmount: 100,
      documentType: 'FATURA_LOCACAO',
      proposalId: mine.id,
      status: 'EMITIDA',
    });
    const invOther = repo.createInvoice({
      companyName: 'Outro Cliente LTDA',
      grossAmount: 200,
      documentType: 'FATURA_LOCACAO',
      proposalId: other.id,
      status: 'EMITIDA',
    });

    const deniedBefore = repo.listSecurityAuditLogs(10000).logs.filter((l) => l.action === 'INVOICE_LINK_ISSUE' && l.status === 'BLOCKED').length;
    const vendDenied = await router.dispatch({
      method: 'POST',
      path: `/api/erp/invoices/${invMine.id}/public-link`,
      query: q(repo, VEND),
      body: {},
    });
    assert.equal(vendDenied.status, 403, JSON.stringify(vendDenied.body));
    assert.equal((vendDenied.body as { code: string }).code, 'INVOICE_LINK_FORBIDDEN');
    const deniedAfter = repo.listSecurityAuditLogs(10000).logs.filter((l) => l.action === 'INVOICE_LINK_ISSUE' && l.status === 'BLOCKED').length;
    assert.equal(deniedAfter, deniedBefore + 1);

    const finUser = repo.findRbacUserRecord(FIN, '')!;
    finUser.scope = 'PROPRIOS';
    const own = await router.dispatch({
      method: 'POST',
      path: `/api/erp/invoices/${invMine.id}/public-link`,
      query: { ...HTTP, _clientIp: ip(), _origin: 'https://sti-hub.vercel.app', _sessionToken: tokFor(repo, FIN) },
      body: {},
    });
    assert.equal(own.status, 200, JSON.stringify(own.body));
    const hidden = await router.dispatch({
      method: 'POST',
      path: `/api/erp/invoices/${invOther.id}/public-link`,
      query: { ...HTTP, _clientIp: ip(), _origin: 'https://sti-hub.vercel.app', _sessionToken: tokFor(repo, FIN) },
      body: {},
    });
    assert.equal(hidden.status, 404, JSON.stringify(hidden.body));
    assert.equal((hidden.body as { error: string }).error, 'Fatura emitida não encontrada.');

    const adminOk = await router.dispatch({
      method: 'POST',
      path: `/api/erp/invoices/${invOther.id}/public-link`,
      query: { ...HTTP, _clientIp: ip(), _origin: 'https://sti-hub.vercel.app', _sessionToken: tokFor(repo, ADMIN) },
      body: {},
    });
    assert.equal(adminOk.status, 200, JSON.stringify(adminOk.body));
  });
});

describe('CISO 2 — GET público /api/p/:code de fatura', () => {
  it('a resposta pública traz só kind, data e issuerAddress (sem invoiceId e sem token)', async () => {
    const { repo, router } = mk();
    const inv = repo.createInvoice({
      companyName: 'Cliente Público LTDA',
      grossAmount: 150,
      documentType: 'FATURA_LOCACAO',
      status: 'EMITIDA',
      pixCopyPaste: '00020126580014BR.GOV.BCB.PIX0136financeiro@setatelecom.com.br5204000053039865802BR5913SETA TELECOM6009SAO PAULO',
    });
    const issued = await router.dispatch({
      method: 'POST',
      path: `/api/erp/invoices/${inv.id}/public-link`,
      query: { ...HTTP, _clientIp: ip(), _origin: 'https://sti-hub.vercel.app', _sessionToken: tokFor(repo, ADMIN) },
      body: {},
    });
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    const shortUrl = (issued.body as { data: { shortUrl?: string; url?: string } }).data.shortUrl
      || (issued.body as { data: { url?: string } }).data.url
      || '';
    const code = String(shortUrl).split('/p/')[1] || '';
    assert.ok(code, `sem codigo em ${shortUrl}`);
    const view = await router.dispatch({
      method: 'GET',
      path: `/api/p/${code}`,
      query: { ...HTTP, _clientIp: ip() },
    });
    assert.equal(view.status, 200, JSON.stringify(view.body));
    const body = view.body as Record<string, unknown>;
    assert.equal(body.kind, 'invoice');
    assert.equal(typeof body.data, 'object');
    assert.ok(body.issuerAddress);
    assert.equal('invoiceId' in body, false);
    assert.equal('token' in body, false);
    assert.equal(JSON.stringify(body).includes(inv.id), false);
  });
});

describe('CISO 3 — POST /api/communications/send-email', () => {
  it('HTML sai do servidor (sanitizado); com invoiceId os anexos são só da fatura; content do cliente é recusado; bcc não entra no histórico; permissão é checada', async () => {
    const { repo, router } = mk();
    const fin = repo.findRbacUserRecord(FIN, '')!;
    const vend = repo.findRbacUserRecord(VEND, '')!;
    const mine = await createOwnedProposal(router, { email: fin.email, name: fin.name }, 'Fatura e-mail');
    const other = await createOwnedProposal(router, { email: vend.email, name: vend.name }, 'Fatura alheia');
    const inv = repo.createInvoice({
      companyName: 'Cliente E-mail LTDA',
      grossAmount: 300,
      documentType: 'FATURA_LOCACAO',
      proposalId: mine.id,
      status: 'EMITIDA',
      boletoDigitableLine: '34191.79001 01043.510047 91020.150008 8 98650001200000',
      pixCopyPaste: '00020126580014BR.GOV.BCB.PIX0136financeiro@setatelecom.com.br5204000053039865802BR5913SETA TELECOM6009SAO PAULO',
    });
    const invOther = repo.createInvoice({
      companyName: 'Outro LTDA',
      grossAmount: 50,
      documentType: 'FATURA_LOCACAO',
      proposalId: other.id,
      status: 'EMITIDA',
    });

    await withResend(async (calls) => {
      const xss = await router.dispatch({
        method: 'POST',
        path: '/api/communications/send-email',
        query: q(repo, ADMIN),
        body: {
          to: 'cliente@exemplo.invalid',
          subject: 'Proposta',
          body: 'Olá <script>alert(1)</script>',
          html: '<script>alert(1)</script><img src=x onerror=alert(1)>',
        },
      });
      assert.equal(xss.status, 200, JSON.stringify(xss.body));
      assert.equal(calls.length, 1);
      const html = String(calls[0].html || '');
      assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
      assert.equal(html.includes('<script>'), false);
    });

    const rejected = await router.dispatch({
      method: 'POST',
      path: '/api/communications/send-email',
      query: q(repo, ADMIN),
      body: {
        to: 'cliente@exemplo.invalid',
        subject: 'Fatura',
        body: 'Segue fatura',
        invoiceId: inv.id,
        selectedAttachments: ['receipt', 'boleto'],
        attachments: [{ filename: 'evil.html', content: 'PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==' }],
      },
    });
    assert.equal(rejected.status, 400, JSON.stringify(rejected.body));
    assert.equal((rejected.body as { code: string }).code, 'INVOICE_ATTACHMENT_CLIENT_FORBIDDEN');

    const over = await router.dispatch({
      method: 'POST',
      path: '/api/communications/send-email',
      query: q(repo, ADMIN),
      body: {
        to: Array.from({ length: 21 }, (_, i) => `u${i}@exemplo.invalid`).join(','),
        subject: 'Limite',
        body: 'corpo',
      },
    });
    assert.equal(over.status, 400);
    assert.equal((over.body as { code: string }).code, 'EMAIL_RECIPIENT_LIMIT');

    const vendDenied = await router.dispatch({
      method: 'POST',
      path: '/api/communications/send-email',
      query: q(repo, VEND),
      body: {
        to: 'cliente@exemplo.invalid',
        subject: 'Fatura',
        body: 'Segue',
        invoiceId: inv.id,
        selectedAttachments: ['receipt'],
      },
    });
    assert.equal(vendDenied.status, 403, JSON.stringify(vendDenied.body));
    assert.equal((vendDenied.body as { code: string }).code, 'INVOICE_EMAIL_FORBIDDEN');

    const finUser = repo.findRbacUserRecord(FIN, '')!;
    finUser.scope = 'PROPRIOS';
    const hidden = await router.dispatch({
      method: 'POST',
      path: '/api/communications/send-email',
      query: q(repo, FIN),
      body: {
        to: 'cliente@exemplo.invalid',
        cc: 'copia@exemplo.invalid',
        bcc: 'oculto@exemplo.invalid',
        subject: 'Fatura',
        body: 'Segue',
        invoiceId: invOther.id,
        selectedAttachments: ['receipt'],
      },
    });
    assert.equal(hidden.status, 404);

    await withResend(async (calls) => {
      const sent = await router.dispatch({
        method: 'POST',
        path: '/api/communications/send-email',
        query: q(repo, ADMIN),
        body: {
          to: 'cliente@exemplo.invalid',
          cc: 'copia@exemplo.invalid',
          bcc: 'oculto@exemplo.invalid',
          subject: 'Fatura emitida',
          body: 'Segue a fatura.',
          invoiceId: inv.id,
          selectedAttachments: ['receipt', 'boleto', 'pix'],
        },
      });
      assert.equal(sent.status, 200, JSON.stringify(sent.body));
      assert.ok(Array.isArray(calls[0].attachments));
      const atts = calls[0].attachments as Array<{ filename: string; content: string }>;
      assert.ok(atts.length >= 1 && atts.length <= 4);
      assert.ok(atts.every((a) => a.content && a.filename));
      assert.equal(JSON.stringify(atts).includes('PHNjcmlwdD4='), false);
      const stored = repo.listInvoices().find((i) => i.id === inv.id)!;
      const last = (stored.emailHistory || [])[(stored.emailHistory || []).length - 1];
      assert.ok(last);
      assert.equal(last.to, 'cliente@exemplo.invalid');
      assert.equal(last.cc, 'copia@exemplo.invalid');
      assert.equal('bcc' in last, false);
      assert.equal(JSON.stringify(last).includes('oculto@exemplo.invalid'), false);
    });

    const composer = readFileSync(path.join(process.cwd(), 'src/app/components/ClientEmailComposerModal.tsx'), 'utf8');
    assert.equal(/html:\s*outgoingHtml/.test(composer), false);
    assert.equal(/attachments:\s*outgoingAttachments/.test(composer), false);
    assert.match(composer, /selectedAttachments/);
  });
});

describe('CISO 4 — DELETE /api/pipelines sob canDeleteCrmRecords, com 409', () => {
  it('sem permissão de exclusão CRM responde 403; com permissão, pipeline/etapa em uso seguem 409 e a etapa livre sai', async () => {
    const { repo, router } = mk();
    const suffix = `ciso-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const pipe = repo.createPipeline({
      id: `pipe-used-${suffix}`,
      name: 'Pipeline guarda CISO',
      stages: [
        { id: `st-usada-${suffix}`, pipelineId: 'tmp', name: 'Nova', order: 1, defaultProbability: 10, dealRottingDays: 14, isClosed: false, isWon: false },
        { id: `st-livre-${suffix}`, pipelineId: 'tmp', name: 'Vazia', order: 2, defaultProbability: 20, dealRottingDays: 14, isClosed: false, isWon: false },
      ],
    });
    const freePipe = repo.createPipeline({
      id: `pipe-free-${suffix}`,
      name: 'Pipeline vazia CISO',
      stages: [
        { id: `st-unica-${suffix}`, pipelineId: 'tmp', name: 'Unica', order: 1, defaultProbability: 10, dealRottingDays: 14, isClosed: false, isWon: false },
      ],
    });
    assert.equal(pipe.stages.length, 2, JSON.stringify(pipe.stages));
    assert.notEqual(pipe.stages[0].id, pipe.stages[1].id);
    repo.createDeal({
      title: 'Negócio no funil',
      value: 100,
      pipelineId: pipe.id,
      stageId: pipe.stages[0].id,
    } as Parameters<typeof repo.createDeal>[0]);

    const vendDel = await router.dispatch({
      method: 'DELETE',
      path: `/api/pipelines/${freePipe.id}`,
      query: q(repo, VEND),
      body: {},
    });
    assert.equal(vendDel.status, 403, JSON.stringify(vendDel.body));
    assert.equal((vendDel.body as { code: string }).code, 'CRM_DELETE_FORBIDDEN');

    const gerDel = await router.dispatch({
      method: 'DELETE',
      path: `/api/pipelines/${freePipe.id}/stages/${freePipe.stages[0].id}`,
      query: q(repo, GER),
      body: {},
    });
    assert.equal(gerDel.status, 403);
    assert.equal((gerDel.body as { code: string }).code, 'CRM_DELETE_FORBIDDEN');

    const used = await router.dispatch({
      method: 'DELETE',
      path: `/api/pipelines/${pipe.id}`,
      query: q(repo, ADMIN),
      body: {},
    });
    assert.equal(used.status, 409, JSON.stringify(used.body));
    assert.equal((used.body as { code: string }).code, 'RECORD_IN_USE');

    const usedStage = await router.dispatch({
      method: 'DELETE',
      path: `/api/pipelines/${pipe.id}/stages/${pipe.stages[0].id}`,
      query: q(repo, ADMIN),
      body: {},
    });
    assert.equal(usedStage.status, 409);

    const freeStage = await router.dispatch({
      method: 'DELETE',
      path: `/api/pipelines/${pipe.id}/stages/${pipe.stages[1].id}`,
      query: q(repo, ADMIN),
      body: {},
    });
    assert.equal(freeStage.status, 200, JSON.stringify(freeStage.body));

    const freeOk = await router.dispatch({
      method: 'DELETE',
      path: `/api/pipelines/${freePipe.id}`,
      query: q(repo, ADMIN),
      body: {},
    });
    assert.equal(freeOk.status, 200, JSON.stringify(freeOk.body));
  });
});
