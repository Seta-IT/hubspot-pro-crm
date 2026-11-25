// ============================================================================
// STI-hub — Proposta vencida: o link do cliente continua abrindo, com aviso
// de revalidacao, e o aceite/assinatura do cliente fica bloqueado.
// ============================================================================
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository } from './helpers/legacy-proposal-fixtures';
import { CrmApiRouter } from '../src/api/router';
import { signProposalLinkToken, verifyProposalLinkToken, isAuthenticProposalLinkToken } from '../src/app/lib/proposal-link';
import {
  isProposalValidityExpired,
  isProposalEffectiveValidityExpired,
  effectiveProposalValidUntil,
  proposalExpiredRevalidationMessage,
  proposalLinkNotAfterMs,
  formatProposalValidUntilPtBr,
} from '../src/app/lib/proposal-validity';
import { toInternalProposalSummary } from '../src/app/lib/internal-proposal-summary';
import { buildInternalProposalPrintHtml } from '../src/app/lib/internal-proposal-pdf';
import type { ErpCommercialProposal } from '../src/db/types';

const HTTP = { _fromHttpBridge: '1' };
const VALID_CPF = '529.982.247-25';
const SIGNER = {
  signerName: 'Carlos Almeida',
  signerCpf: VALID_CPF,
  signerRole: 'Diretor',
  modality: 'ICP_BRASIL_A3',
  acceptedTerms: true,
};

const savedEnv = { ...process.env };
afterEach(() => {
  for (const k of ['STI_HUB_PROPOSAL_LINK_SECRET', 'STI_HUB_PROPOSAL_LINK_TTL_DAYS', 'STI_HUB_SESSION_SECRET']) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const src = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

function fresh() {
  process.env.STI_HUB_PROPOSAL_LINK_SECRET = 'c'.repeat(48);
  process.env.STI_HUB_SESSION_SECRET = 's'.repeat(48);
  const repo = createInMemoryRepository();
  return { repo, router: new CrmApiRouter(repo) };
}

function sessionFor(repo: ReturnType<typeof createInMemoryRepository>, uid = 'usr-seta-01') {
  const rec = repo.findRbacUserRecord(uid, '');
  assert.ok(rec, `usuario seed ${uid}`);
  return signStiHubSessionToken({
    uid: rec!.id,
    email: rec!.email,
    name: rec!.name,
    roleId: rec!.roleId,
    scope: rec!.scope,
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'],
    moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true,
    mfaMethod: 'TOTP_AUTHENTICATOR',
    iat: Date.now() - 1000,
    exp: Date.now() + 3_600_000,
  } as Parameters<typeof signStiHubSessionToken>[0]);
}

function tokenFromIssue(body: unknown): string {
  const url = (body as { data?: { url?: string } }).data?.url || '';
  assert.ok(url.includes('#t='), 'link emitido precisa ter #t=');
  return decodeURIComponent(url.split('#t=')[1] || '');
}

describe('Validade comercial: helpers', () => {
  it('detecta vencida pelo fim do dia em Brasilia e formata o aviso', () => {
    assert.equal(isProposalValidityExpired('2020-01-01'), true);
    assert.equal(isProposalValidityExpired('2099-12-31'), false);
    assert.equal(isProposalValidityExpired(''), false);
    assert.equal(isProposalValidityExpired(undefined), false);
    const endOfToday = '2026-11-16';
    const beforeEnd = Date.parse(`${endOfToday}T23:59:59.000-03:00`);
    const afterEnd = Date.parse(`${endOfToday}T23:59:59.999-03:00`) + 1;
    assert.equal(isProposalValidityExpired(endOfToday, beforeEnd), false);
    assert.equal(isProposalValidityExpired(endOfToday, afterEnd), true);
    assert.equal(formatProposalValidUntilPtBr('2026-11-11'), '11/11/2026');
    assert.equal(
      proposalExpiredRevalidationMessage('2026-11-11'),
      'Esta proposta está vencida desde 11/11/2026 e precisa ser revalidada. Fale com seu consultor Seta Telecom.'
    );
    assert.equal(proposalLinkNotAfterMs('2020-01-01'), null);
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    assert.equal(proposalLinkNotAfterMs(soon), Date.parse(`${soon}T23:59:59.999-03:00`));
  });
});

describe('Proposta vencida: link do cliente abre e aceite fica bloqueado', () => {
  it('ENVIADA vencida: emite link, GET devolve a proposta, aceite 409, inexistente continua 404', async () => {
    const { repo, router } = fresh();
    const admin = sessionFor(repo);
    const expired = repo.createProposal({
      title: 'ARKLOK vencida',
      companyName: 'ARKLOK',
      status: 'ENVIADA',
      validUntil: '2026-11-11',
      items: [],
    } as never);

    const issued = await router.dispatch({
      method: 'POST',
      path: `/api/erp/proposals/${expired.id}/public-link`,
      query: { ...HTTP, _sessionToken: admin, _origin: 'https://sti-hub.setatelecom.com.br', _clientIp: '198.51.100.30' },
      body: {},
    });
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    const token = tokenFromIssue(issued.body);
    const shortUrl = (issued.body as { data: { shortUrl?: string } }).data.shortUrl || '';
    assert.match(shortUrl, /\/p\/[A-Za-z0-9]{10}$/);

    const viewed = await router.dispatch({
      method: 'GET',
      path: `/api/erp/proposals/${expired.id}`,
      query: { ...HTTP, _clientIp: '198.51.100.31', proposalLinkToken: token },
    });
    assert.equal(viewed.status, 200);
    const data = (viewed.body as { data: { title: string; validUntil: string; status: string } }).data;
    assert.equal(data.title, 'ARKLOK vencida');
    assert.equal(data.validUntil, '2026-11-11');
    assert.equal(data.status, 'ENVIADA');

    const viaSlug = await router.dispatch({
      method: 'GET',
      path: `/api/p/${shortUrl.split('/p/')[1]}`,
      query: { ...HTTP, _clientIp: '198.51.100.32' },
    });
    assert.equal(viaSlug.status, 200);
    assert.equal((viaSlug.body as { data: { validUntil: string } }).data.validUntil, '2026-11-11');

    const accepted = await router.dispatch({
      method: 'POST',
      path: `/api/erp/proposals/${expired.id}/approve`,
      query: { ...HTTP, _clientIp: '198.51.100.33', proposalLinkToken: token },
      body: SIGNER,
    });
    assert.equal(accepted.status, 409);
    assert.equal((accepted.body as { code: string }).code, 'PROPOSAL_EXPIRED');
    assert.match((accepted.body as { error: string }).error, /vencida desde 11\/11\/2026/);
    assert.equal(repo.listProposals().find((p) => p.id === expired.id)!.status, 'ENVIADA');

    const missing = await router.dispatch({
      method: 'GET',
      path: '/api/erp/proposals/prop-nao-existe-arklok',
      query: { ...HTTP, _clientIp: '198.51.100.34', proposalLinkToken: token },
    });
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { error: 'Proposta comercial não encontrada.' });

    const noToken = await router.dispatch({
      method: 'GET',
      path: `/api/erp/proposals/${expired.id}`,
      query: { ...HTTP, _clientIp: '198.51.100.35' },
    });
    assert.equal(noToken.status, 404);
  });

  it('token com TTL vencido de proposta ainda vigente continua abrindo e permite aceite', async () => {
    const { repo, router } = fresh();
    const p = repo.createProposal({
      title: 'Vigente',
      companyName: 'C',
      status: 'ENVIADA',
      validUntil: '2099-12-31',
      items: [],
    } as never);
    const expiredTok = signProposalLinkToken({
      proposalId: p.id,
      version: Math.max(1, Number(p.version || 1)),
      ttlDays: 1,
      nowMs: Date.now() - 3 * 86_400_000,
    }).token;
    const v = verifyProposalLinkToken(expiredTok, { proposalId: p.id });
    assert.equal(v.valid, false);
    assert.equal(isAuthenticProposalLinkToken(v), true);
    const viewed = await router.dispatch({
      method: 'GET',
      path: `/api/erp/proposals/${p.id}`,
      query: { ...HTTP, _clientIp: '198.51.100.36', proposalLinkToken: expiredTok },
    });
    assert.equal(viewed.status, 200);
    const accepted = await router.dispatch({
      method: 'POST',
      path: `/api/erp/proposals/${p.id}/approve`,
      query: { ...HTTP, _clientIp: '198.51.100.37', proposalLinkToken: expiredTok },
      body: SIGNER,
    });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(repo.listProposals().find((x) => x.id === p.id)!.status, 'CONVERTIDA_CONTRATO');
  });

  it('RASCUNHO vencido nao e promovido e nao emite link', async () => {
    const { repo, router } = fresh();
    const admin = sessionFor(repo);
    const draft = repo.createProposal({
      title: 'Rascunho vencido',
      companyName: 'C',
      status: 'RASCUNHO',
      validUntil: '2020-01-01',
      items: [],
    } as never);
    const issued = await router.dispatch({
      method: 'POST',
      path: `/api/erp/proposals/${draft.id}/public-link`,
      query: { ...HTTP, _sessionToken: admin, _clientIp: '198.51.100.38' },
      body: {},
    });
    assert.equal(issued.status, 409);
    assert.equal((issued.body as { code: string }).code, 'PROPOSAL_EXPIRED');
    assert.equal(JSON.stringify(issued.body).includes('#t='), false);
    assert.equal(repo.listProposals().find((p) => p.id === draft.id)!.status, 'RASCUNHO');
  });
});

describe('Proposta vencida: aviso no documento publico e no link interno', () => {
  it('a folha publica mostra a linha de revalidacao e esconde a assinatura; 404 ja nao fala em expirar', () => {
    const page = src('src/app/proposta/[id]/page.tsx');
    assert.match(page, /data-testid="proposal-expired-banner"/);
    assert.match(page, /Proposta vencida/);
    assert.match(page, /Esta proposta está vencida desde \{expiredSinceLabel\} e precisa ser revalidada/);
    assert.match(page, /data-testid="proposal-expired-sign-blocked"/);
    assert.match(page, /isProposalEffectiveValidityExpired\(proposal\)/);
    assert.doesNotMatch(page, /inválido ou expirou/);
    assert.match(page, /publicLinkInvalid/);
    assert.match(page, /Link inválido ou sem permissão/);
    assert.match(page, /Este link de proposta é inválido ou você não tem permissão para abri-lo\. Solicite um novo link ao seu consultor Seta Telecom\./);
    assert.match(page, /Proposta Comercial #\$\{rawId \|\| "Não identificada"\} não localizada/);
  });

  it('o link interno traz o mesmo aviso quando a validade ja passou', () => {
    const model = toInternalProposalSummary({
      id: 'prop-arklok-20261104',
      code: '4705',
      title: 'Orçamento ARKLOK',
      companyName: 'ARKLOK',
      status: 'ENVIADA',
      validUntil: '2026-11-11',
      items: [],
    } as unknown as ErpCommercialProposal);
    assert.equal(model.sheet.validityExpiredSince, '11/11/2026');
    const html = buildInternalProposalPrintHtml(model);
    assert.match(html, /Proposta vencida/);
    assert.match(html, /vencida desde 11\/11\/2026 e precisa ser revalidada/);
    const view = src('src/app/components/InternalProposalSummaryView.tsx');
    assert.match(view, /data-testid="internal-proposal-expired-banner"/);
  });
});

describe('Validade efetiva (validUntil invertido em relação à Data)', () => {
  const now = Date.parse('2026-11-25T20:00:00.000Z');

  it('4679: Até anterior à Data usa Data + 15 dias e continua vencida', () => {
    const locar = { proposalDate: '2026-10-02', validUntil: '2024-12-12' };
    assert.equal(effectiveProposalValidUntil(locar), '2026-10-17');
    assert.equal(isProposalEffectiveValidityExpired(locar, now), true);
    assert.equal(isProposalValidityExpired(locar.validUntil, now), true);
  });

  it('4727: Até anterior à Data usa Data + 15 e NÃO trata como vencida se essa data ainda é futura', () => {
    const evamind = { proposalDate: '2026-11-25', validUntil: '2026-10-30' };
    assert.equal(effectiveProposalValidUntil(evamind), '2026-12-10');
    assert.equal(isProposalEffectiveValidityExpired(evamind, now), false);
    assert.equal(isProposalValidityExpired(evamind.validUntil, now), true, 'o valor gravado invertido sozinho pareceria vencido');
  });

  it('sem Data, a validade efetiva é o validUntil gravado', () => {
    assert.equal(effectiveProposalValidUntil({ validUntil: '2026-11-11' }), '2026-11-11');
    assert.equal(isProposalEffectiveValidityExpired({ validUntil: '2026-11-11' }, now), true);
  });
});
