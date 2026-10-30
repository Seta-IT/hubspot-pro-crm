// ============================================================================
// STI-hub — Link ASSINADO de proposta (29/10/2026). Sem rede externa: tudo em memoria
// (router + repositorio in-memory; a rota Next e exercitada com NextRequest local).
// ============================================================================
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import {
  PROPOSAL_APPROVE_IP_LIMIT,
  PROPOSAL_APPROVE_PER_PROPOSAL_LIMIT,
  PROPOSAL_LINK_MAX_TTL_DAYS,
  resolveProposalLinkSecret,
  resolveProposalLinkTtlDays,
  signProposalLinkToken,
  verifyProposalLinkToken,
} from '../src/app/lib/proposal-link';
import { PUBLIC_PROPOSAL_DTO_KEYS } from '../src/app/lib/proposal-public-dto';
import { redactProposalLinkTokens, deepRedactProposalLinkTokens } from '../src/app/lib/proposal-link-redact';
import { withProposalLinkParams } from '../src/app/lib/proposal-link-request';
import { evaluateStiHubRouteProtection, isPublicStiHubPath } from '../src/middleware';

const HTTP = { _fromHttpBridge: '1' };
const VALID_CPF = '529.982.247-25';
const SIGNER = {
  signerName: 'Carlos Almeida',
  signerCpf: VALID_CPF,
  signerRole: 'Diretor',
  modality: 'ICP_BRASIL_A3',
  acceptedTerms: true,
};
const FORBIDDEN_DTO = /cnpj|sellerEmail|sellerPhone|contactEmail|contactName|contactId|companyId|dealId|"id"|internalNotes|versionHistory|statusHistory|convertedContractId|convertedInvoiceId|ipAddress|"sku"|ncmOrServiceCode|careOf|deliveryAddress|approvalIdempotencyKeySha256|sellerUserId|@setatelecom/i;

let ipSeq = 1;
const nextIp = () => `198.51.100.${(ipSeq++ % 250) + 1}`;

function fresh() {
  const repo = createInMemoryRepository();
  return { repo, router: new CrmApiRouter(repo) };
}

function sessionFor(repo: ReturnType<typeof createInMemoryRepository>, uid: string, extra: Record<string, unknown> = {}) {
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
    ...extra,
  } as Parameters<typeof signStiHubSessionToken>[0]);
}

function linkFor(id: string, version = 1, extra: { ttlDays?: number; nowMs?: number } = {}) {
  return signProposalLinkToken({ proposalId: id, version, ...extra }).token;
}

async function getPublic(router: CrmApiRouter, id: string, token?: string, ip = nextIp()) {
  return router.dispatch({
    method: 'GET',
    path: `/api/erp/proposals/${encodeURIComponent(id)}`,
    query: { ...HTTP, _clientIp: ip, ...(token !== undefined ? { proposalLinkToken: token } : {}) },
  });
}

async function approve(router: CrmApiRouter, id: string, token: string | undefined, body: Record<string, unknown> = SIGNER, extra: Record<string, string> = {}) {
  return router.dispatch({
    method: 'POST',
    path: `/api/erp/proposals/${encodeURIComponent(id)}/approve`,
    query: { ...HTTP, _clientIp: extra.ip || nextIp(), ...(token ? { proposalLinkToken: token } : {}), ...(extra.idem ? { proposalIdempotencyKey: extra.idem } : {}) },
    body,
  });
}

const savedEnv = { ...process.env };
afterEach(() => {
  for (const k of ['STI_HUB_PROPOSAL_LINK_SECRET', 'STI_HUB_PROPOSAL_LINK_TTL_DAYS', 'STI_HUB_PROPOSAL_PUBLIC_APPROVE', 'VERCEL_ENV', 'STI_HUB_SESSION_SECRET']) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  (process.env as Record<string, string>).NODE_ENV = savedEnv.NODE_ENV || 'test';
});

describe('Link assinado de proposta: token HMAC', () => {
  it('escopo id + versao + exp; adulterado, expirado, de outra proposta => invalido; TTL com teto', () => {
    const t = linkFor('prop-seta-001', 1);
    const ok = verifyProposalLinkToken(t, { proposalId: 'prop-seta-001' });
    assert.equal(ok.valid, true);
    if (ok.valid) assert.equal(ok.claims.ver, 1);
    assert.equal(verifyProposalLinkToken(t, { proposalId: 'prop-seta-002' }).valid, false);
    const [payload, sig] = t.split('.');
    assert.equal(verifyProposalLinkToken(`${payload}.${sig.slice(0, -2)}AA`, { proposalId: 'prop-seta-001' }).valid, false);
    const forgedPayload = Buffer.from(JSON.stringify({ v: 1, pid: 'prop-seta-001', ver: 9, iat: Date.now(), exp: Date.now() + 1e6, jti: 'x' })).toString('base64url');
    assert.equal(verifyProposalLinkToken(`${forgedPayload}.${sig}`, { proposalId: 'prop-seta-001' }).valid, false);
    const expired = linkFor('prop-seta-001', 1, { ttlDays: 1, nowMs: Date.now() - 2 * 86_400_000 });
    assert.equal(verifyProposalLinkToken(expired, { proposalId: 'prop-seta-001' }).valid, false);
    for (const junk of ['', 'lixo', 'a.b.c', null, undefined, 'x'.repeat(5000)]) {
      assert.equal(verifyProposalLinkToken(junk, { proposalId: 'prop-seta-001' }).valid, false);
    }
    process.env.STI_HUB_PROPOSAL_LINK_TTL_DAYS = '9999';
    assert.equal(resolveProposalLinkTtlDays(), PROPOSAL_LINK_MAX_TTL_DAYS);
    process.env.STI_HUB_PROPOSAL_LINK_TTL_DAYS = 'abc';
    assert.equal(resolveProposalLinkTtlDays(), 30);
    process.env.STI_HUB_PROPOSAL_LINK_TTL_DAYS = '7';
    const short = signProposalLinkToken({ proposalId: 'p', version: 1 });
    assert.ok(short.claims.exp - short.claims.iat <= 7 * 86_400_000);
  });

  it('segredo proprio: token assinado com outro segredo nao vale; secret curto em producao => fail-closed', () => {
    process.env.STI_HUB_PROPOSAL_LINK_SECRET = 'a'.repeat(40);
    const t = linkFor('prop-seta-001');
    process.env.STI_HUB_PROPOSAL_LINK_SECRET = 'b'.repeat(40);
    assert.equal(verifyProposalLinkToken(t, { proposalId: 'prop-seta-001' }).valid, false);

    (process.env as Record<string, string>).NODE_ENV = 'production';
    delete process.env.STI_HUB_PROPOSAL_LINK_SECRET;
    assert.equal(resolveProposalLinkSecret(), null);
    assert.throws(() => linkFor('prop-seta-001'), /STI_HUB_PROPOSAL_LINK_SECRET/);
    process.env.STI_HUB_PROPOSAL_LINK_SECRET = 'curto';
    assert.equal(resolveProposalLinkSecret(), null);
    (process.env as Record<string, string>).NODE_ENV = 'test';
    process.env.VERCEL_ENV = 'preview';
    assert.equal(resolveProposalLinkSecret(), null);
  });

  it('producao sem segredo: GET e /approve com token antes valido => 404; emissao => 503', async () => {
    const { repo, router } = fresh();
    process.env.STI_HUB_PROPOSAL_LINK_SECRET = 'c'.repeat(48);
    process.env.STI_HUB_SESSION_SECRET = 's'.repeat(48);
    (process.env as Record<string, string>).NODE_ENV = 'production';
    const ver = repo.listProposals().find((x) => x.id === 'prop-seta-001')!.version || 1;
    const t = linkFor('prop-seta-001', ver);
    assert.equal((await getPublic(router, 'prop-seta-001', t)).status, 200);
    delete process.env.STI_HUB_PROPOSAL_LINK_SECRET;
    const g = await getPublic(router, 'prop-seta-001', t);
    assert.equal(g.status, 404);
    assert.equal((await approve(router, 'prop-seta-001', t)).status, 404);
    const issue = await router.dispatch({
      method: 'POST',
      path: '/api/erp/proposals/prop-seta-001/public-link',
      query: { ...HTTP, _sessionToken: sessionFor(repo, 'usr-seta-01') },
      body: {},
    });
    assert.equal(issue.status, 503);
    assert.doesNotMatch(JSON.stringify(issue.body), /#t=/);
  });
});

describe('Link assinado de proposta: GET publico', () => {
  it('enumeracao sem token (prop-seta-001..005, prop-gc-*) => 404 identico ao de id inexistente (corpo e headers)', async () => {
    const { router } = fresh();
    const ref = await getPublic(router, 'prop-nao-existe-123');
    assert.equal(ref.status, 404);
    const ids = ['prop-seta-001', 'prop-seta-002', 'prop-seta-003', 'prop-seta-004', 'prop-seta-005', 'prop-gc-4695', 'prop-gc-1', 'prop-gc-4696', 'PROP-SETA-001'];
    for (const id of ids) {
      for (const tok of [undefined, '', 'lixo', linkFor('prop-outra')]) {
        const r = await getPublic(router, id, tok);
        assert.equal(r.status, 404, id);
        assert.deepEqual(r.body, ref.body, id);
        assert.deepEqual(r.headers, ref.headers, id);
      }
    }
    assert.equal(ref.headers?.['Referrer-Policy'], 'no-referrer');
    assert.match(String(ref.headers?.['Cache-Control']), /no-store/);
  });

  it('token adulterado, expirado, de outra proposta ou de outra versao => 404', async () => {
    const { repo, router } = fresh();
    const p = repo.listProposals().find((x) => x.id === 'prop-seta-001')!;
    const ver = p.version || 1;
    const good = linkFor(p.id, ver);
    assert.equal((await getPublic(router, p.id, good)).status, 200);
    const bad = [
      `${good.slice(0, -3)}AAA`,
      linkFor(p.id, ver, { ttlDays: 1, nowMs: Date.now() - 3 * 86_400_000 }),
      linkFor('prop-seta-002', ver),
      linkFor(p.id, ver + 1),
    ];
    for (const t of bad) assert.equal((await getPublic(router, p.id, t)).status, 404);
    // Proposta editada (versao nova) => link antigo deixa de valer.
    repo.updateProposal(p.id, { title: `${p.title} (rev)` });
    const after = repo.listProposals().find((x) => x.id === p.id)!;
    if ((after.version || 1) !== ver) assert.equal((await getPublic(router, p.id, good)).status, 404);
  });

  it('token valido => DTO publico reduzido, sem campos proibidos e so com as chaves da lista branca', async () => {
    const { repo, router } = fresh();
    const p = repo.listProposals().find((x) => x.id === 'prop-gc-4695')!;
    const r = await getPublic(router, p.id, linkFor(p.id, p.version || 1));
    assert.equal(r.status, 200);
    const data = (r.body as { data: Record<string, unknown> }).data;
    assert.deepEqual(Object.keys(data).sort(), [...PUBLIC_PROPOSAL_DTO_KEYS].sort());
    const text = JSON.stringify(r.body);
    assert.doesNotMatch(text, FORBIDDEN_DTO);
    if (p.companyCnpj) assert.equal(text.replace(/\D/g, '').includes(p.companyCnpj.replace(/\D/g, '')), false);
    if (p.sellerPhone) assert.equal(text.includes(p.sellerPhone), false);
    assert.equal(data.companyName, p.companyName);
    assert.equal(data.sellerName, p.sellerName);
    assert.equal(r.headers?.['Referrer-Policy'], 'no-referrer');
  });

  it('sessao MFA (vendedor/admin) e contexto interno continuam vendo a proposta completa', async () => {
    const { repo, router } = fresh();
    // Vendedora PROPRIOS: completo so na propria (M1); admin ve qualquer uma.
    const maria = repo.findRbacUserRecord('usr-seta-03', '')!;
    const own = repo.createProposal({ title: 'Da Maria', companyName: 'C', sellerEmail: maria.email, items: [] } as never);
    const r = await router.dispatch({ method: 'GET', path: `/api/erp/proposals/${own.id}`, query: { ...HTTP, _sessionToken: sessionFor(repo, 'usr-seta-03') } });
    assert.equal(r.status, 200);
    assert.equal((r.body as { data: { id: string } }).data.id, own.id);
    const a = await router.dispatch({ method: 'GET', path: '/api/erp/proposals/prop-seta-001', query: { ...HTTP, _sessionToken: sessionFor(repo, 'usr-seta-01') } });
    assert.equal(a.status, 200);
    assert.equal((a.body as { data: { id: string } }).data.id, 'prop-seta-001');
    const i = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'GET', path: '/api/erp/proposals/prop-seta-001' });
    assert.equal(i.status, 200);
  });
});

describe('Link assinado de proposta: POST /approve', () => {
  function rentalProposal(repo: ReturnType<typeof createInMemoryRepository>) {
    return repo.createProposal({
      title: 'Proposta Link Assinado',
      companyName: 'Cliente Link Assinado',
      contractMonths: 12,
      items: [
        { id: 'it-1', sku: 'GC-1', description: 'PABX IP', fiscalNature: 'LOCACAO_BENS_MOVEIS', ncmOrServiceCode: 'NCM 8517.62.14', quantity: 1, unitPrice: 500, discountPercent: 0, isRecurring: true, totalMonthly: 500 },
      ],
    } as unknown as { title: string });
  }

  it('sem token => 404 (nada muda); com token => 200 com DTO publico; repetido => 409; mesma Idempotency-Key => mesmo resultado sem duplicar', async () => {
    const { repo, router } = fresh();
    const p = rentalProposal(repo);
    const contractsBefore = repo.listRentalContracts().length;
    const noTok = await approve(router, p.id, undefined);
    assert.equal(noTok.status, 404);
    assert.deepEqual(noTok.body, (await getPublic(router, 'prop-nao-existe')).body);
    assert.equal(repo.listProposals().find((x) => x.id === p.id)!.status, p.status);

    const tok = linkFor(p.id, p.version || 1);
    const ok = await approve(router, p.id, tok, SIGNER, { idem: 'idem-chave-0001' });
    assert.equal(ok.status, 200);
    const okText = JSON.stringify(ok.body);
    assert.doesNotMatch(okText, FORBIDDEN_DTO);
    assert.doesNotMatch(okText, /529\.982\.247-25|52998224725/);
    const data = (ok.body as { data: { proposal: { status: string; acceptance: { signerCpfMasked: string } }; contractNumber: string } }).data;
    assert.equal(data.proposal.status, 'CONVERTIDA_CONTRATO');
    assert.match(data.contractNumber, /^LOC-/);
    assert.equal(data.proposal.acceptance.signerCpfMasked, '***.982.247-**');
    assert.equal(repo.listRentalContracts().length, contractsBefore + 1);

    const replay = await approve(router, p.id, tok, SIGNER, { idem: 'idem-chave-0001' });
    assert.equal(replay.status, 200);
    assert.equal((replay.body as { idempotentReplay?: boolean }).idempotentReplay, true);
    assert.equal((replay.body as { data: { contractNumber: string } }).data.contractNumber, data.contractNumber);
    const again = await approve(router, p.id, tok, SIGNER, { idem: 'outra-chave-0002' });
    assert.equal(again.status, 409);
    const againNoKey = await approve(router, p.id, tok);
    assert.equal(againNoKey.status, 409);
    assert.equal(repo.listRentalContracts().length, contractsBefore + 1, 'sem contrato duplicado');
    // GET depois do aceite: mesma versao, status atualizado, sem CPF completo.
    const g = await getPublic(router, p.id, tok);
    assert.equal(g.status, 200);
    assert.doesNotMatch(JSON.stringify(g.body), /529\.982\.247-25/);
  });

  it('id inexistente: nunca cria proposta (nem com payload `proposal`)', async () => {
    const { repo, router } = fresh();
    const before = repo.listProposals().length;
    const id = 'prop-inexistente-999';
    const t = linkFor(id, 1);
    assert.equal((await approve(router, id, t)).status, 404);
    assert.equal((await approve(router, id, t, { ...SIGNER, proposal: { id, title: 'Forjada', items: [] } })).status, 400);
    const internal = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: `/api/erp/proposals/${id}/approve`, body: SIGNER });
    assert.equal(internal.status, 404);
    assert.equal(repo.listProposals().length, before);
    assert.equal(repo.listProposals().some((p) => p.id === id), false);
  });

  it('corpo com chave extra => 400 (zod .strict()); Idempotency-Key invalida => 400', async () => {
    const { repo, router } = fresh();
    const p = rentalProposal(repo);
    const t = linkFor(p.id, p.version || 1);
    // Limite por proposta = 5 tentativas com token valido / 10 min; 5 casos invalidos aqui.
    for (const extra of [{ status: 'APROVADA' }, { proposal: {} }, { _sessionToken: 'x' }, { ipAddress: '1.1.1.1' }, { acceptedTerms: false }]) {
      const r = await approve(router, p.id, t, { ...SIGNER, ...extra });
      assert.equal(r.status, 400, JSON.stringify(extra));
    }
    assert.equal(repo.listProposals().find((x) => x.id === p.id)!.status, p.status);
    const { repo: repo2, router: router2 } = fresh();
    const p2 = rentalProposal(repo2);
    assert.equal((await approve(router2, p2.id, linkFor(p2.id, p2.version || 1), SIGNER, { idem: 'curta' })).status, 400);
    assert.equal(repo2.listProposals().find((x) => x.id === p2.id)!.status, p2.status);
  });

  it('rate-limit por IP e por proposta => 429', async () => {
    const { repo, router } = fresh();
    const p = rentalProposal(repo);
    const t = linkFor(p.id, p.version || 1);
    const ip = '203.0.113.200';
    let firstIp429 = 0;
    for (let i = 1; i <= PROPOSAL_APPROVE_IP_LIMIT.max + 2; i++) {
      const r = await approve(router, 'prop-qualquer', undefined, SIGNER, { ip });
      if (r.status === 429 && !firstIp429) firstIp429 = i;
    }
    assert.equal(firstIp429, PROPOSAL_APPROVE_IP_LIMIT.max + 1);
    let firstP429 = 0;
    for (let i = 1; i <= PROPOSAL_APPROVE_PER_PROPOSAL_LIMIT.max + 2; i++) {
      const r = await approve(router, p.id, t, { ...SIGNER, extra: 1 });
      if (r.status === 429 && !firstP429) firstP429 = i;
    }
    assert.equal(firstP429, PROPOSAL_APPROVE_PER_PROPOSAL_LIMIT.max + 1);
    // Sem token, estranhos nao consomem o limite da proposta (evita bloquear o cliente).
    const { repo: repo2, router: router2 } = fresh();
    const p2 = rentalProposal(repo2);
    for (let i = 0; i < 20; i++) await approve(router2, p2.id, undefined);
    assert.equal((await approve(router2, p2.id, linkFor(p2.id, p2.version || 1))).status, 200);
  });

  it('flag STI_HUB_PROPOSAL_PUBLIC_APPROVE=false desliga o aceite (403) sem afetar a leitura', async () => {
    const { repo, router } = fresh();
    const p = rentalProposal(repo);
    const t = linkFor(p.id, p.version || 1);
    process.env.STI_HUB_PROPOSAL_PUBLIC_APPROVE = 'false';
    const r = await approve(router, p.id, t);
    assert.equal(r.status, 403);
    assert.equal((r.body as { code: string }).code, 'PROPOSAL_PUBLIC_APPROVE_DISABLED');
    assert.equal((await getPublic(router, p.id, t)).status, 200);
    assert.equal(repo.listProposals().find((x) => x.id === p.id)!.status, p.status);
  });

  it('auditoria registra o aceite sem gravar o token', async () => {
    const { repo, router } = fresh();
    const p = rentalProposal(repo);
    const t = linkFor(p.id, p.version || 1);
    await approve(router, p.id, undefined);
    assert.equal((await approve(router, p.id, t)).status, 200);
    const logs = JSON.stringify(repo.getState());
    assert.equal(logs.includes(t), false);
    assert.equal(logs.includes(t.split('.')[1]), false);
    assert.match(logs, /PROPOSAL_PUBLIC_APPROVE/);
  });
});

describe('Link assinado de proposta: emissao (POST /api/erp/proposals/:id/public-link)', () => {
  const issue = (router: CrmApiRouter, id: string, session?: string) =>
    router.dispatch({
      method: 'POST',
      path: `/api/erp/proposals/${encodeURIComponent(id)}/public-link`,
      query: { ...HTTP, _origin: 'https://preview.exemplo.invalid', ...(session ? { _sessionToken: session } : {}) },
      body: {},
    });

  it('anonimo 401; sem permissao 403; vendedor de outra proposta 403; vendedor dono e admin 200 com link que abre', async () => {
    const { repo, router } = fresh();
    assert.equal(isPublicStiHubPath('/api/erp/proposals/prop-seta-001/public-link', 'POST'), false);
    assert.equal(evaluateStiHubRouteProtection({ pathname: '/api/erp/proposals/prop-seta-001/public-link', method: 'POST', sessionToken: null }).statusCode, 401);
    assert.equal((await issue(router, 'prop-seta-001')).status, 401);
    assert.equal((await issue(router, 'prop-seta-001', 'lixo')).status, 401);

    const fin = await issue(router, 'prop-seta-001', sessionFor(repo, 'usr-seta-04'));
    assert.equal(fin.status, 403);

    const seller = repo.findRbacUserRecord('usr-seta-03', '')!;
    // M2: a vendedora cria a propria proposta pela API => o servidor grava sellerUserId.
    const forged = await router.dispatch({
      method: 'POST',
      path: '/api/erp/proposals',
      query: { ...HTTP, _sessionToken: sessionFor(repo, 'usr-seta-03') },
      body: { title: 'Proposta da Maria', companyName: 'Cliente da Maria', sellerName: seller.name, sellerUserId: 'usr-seta-01', items: [] },
    });
    assert.equal(forged.status, 403, 'sellerUserId no corpo => 403');
    const createdOwn = await router.dispatch({
      method: 'POST',
      path: '/api/erp/proposals',
      query: { ...HTTP, _sessionToken: sessionFor(repo, 'usr-seta-03') },
      body: { title: 'Proposta da Maria', companyName: 'Cliente da Maria', sellerName: seller.name, items: [] },
    });
    assert.equal(createdOwn.status, 201);
    const own = repo.listProposals().find((x) => x.id === (createdOwn.body as { data: { id: string } }).data.id)!;
    assert.equal(own.sellerUserId, 'usr-seta-03', 'sellerUserId vem da sessao, nao do corpo');
    await new Promise((r) => setTimeout(r, 5)); // ids de proposta derivam de Date.now()
    const other = repo.createProposal({ title: 'Proposta de outro', companyName: 'Outro Cliente', sellerName: 'Outro Vendedor', items: [] } as unknown as { title: string });
    const sellerTok = sessionFor(repo, 'usr-seta-03');
    assert.equal((await issue(router, other.id, sellerTok)).status, 403);
    const mine = await issue(router, own.id, sellerTok);
    assert.equal(mine.status, 200);
    const url = (mine.body as { data: { url: string } }).data.url;
    assert.match(url, new RegExp(`^https://preview\\.exemplo\\.invalid/proposta/${own.id}#t=`));
    assert.equal(mine.headers?.['Referrer-Policy'], 'no-referrer');

    const admin = await issue(router, other.id, sessionFor(repo, 'usr-seta-01'));
    assert.equal(admin.status, 200);
    const tok = (admin.body as { data: { url: string } }).data.url.split('#t=')[1];
    assert.equal((await getPublic(router, other.id, tok)).status, 200);
    assert.equal((await issue(router, 'prop-nao-existe', sessionFor(repo, 'usr-seta-01'))).status, 404);
    // Auditoria da emissao sem o token.
    assert.equal(JSON.stringify(repo.getState()).includes(tok), false);
  });
});

describe('Link assinado de proposta: transporte do token', () => {
  it('header X-Proposal-Token vira parametro interno; o mesmo parametro vindo da URL e descartado', async () => {
    const req = new NextRequest('https://sti-hub.example.invalid/api/erp/proposals/prop-seta-001?proposalLinkToken=da-url&x=1', {
      headers: { 'x-proposal-token': 'do-header', 'idempotency-key': 'idem-12345678' },
    });
    const out = await withProposalLinkParams(req);
    const u = new URL(out.url);
    assert.equal(u.searchParams.get('proposalLinkToken'), 'do-header');
    assert.equal(u.searchParams.get('proposalIdempotencyKey'), 'idem-12345678');
    assert.equal(u.searchParams.get('x'), '1');
    assert.equal(out.headers.get('x-proposal-token'), null);

    const urlOnly = await withProposalLinkParams(
      new NextRequest('https://sti-hub.example.invalid/api/erp/proposals/prop-seta-001?proposalLinkToken=da-url')
    );
    assert.equal(new URL(urlOnly.url).searchParams.get('proposalLinkToken'), null);

    const post = await withProposalLinkParams(
      new NextRequest('https://sti-hub.example.invalid/api/erp/proposals/p/approve', {
        method: 'POST',
        headers: { 'x-proposal-token': 't', 'content-type': 'application/json' },
        body: JSON.stringify({ a: 1 }),
      })
    );
    assert.deepEqual(await post.json(), { a: 1 });
  });
});

describe('Parecer CISO 30/10 (A1, M1, M2, B1, B2, B3, B5)', () => {
  it('A1: redactProposalLinkTokens troca #t=<payload>.<assinatura> por #t=[REDACTED]', () => {
    const t = linkFor('prop-seta-001', 2);
    const url = `https://sti-hub.vercel.app/proposta/prop-seta-001#t=${t}`;
    assert.equal(redactProposalLinkTokens(`Veja ${url} e ${url}.`), 'Veja https://sti-hub.vercel.app/proposta/prop-seta-001#t=[REDACTED] e https://sti-hub.vercel.app/proposta/prop-seta-001#t=[REDACTED].');
    assert.equal(redactProposalLinkTokens('#t=abc'), '#t=[REDACTED]');
    assert.equal(redactProposalLinkTokens('sem link'), 'sem link');
    const deep = deepRedactProposalLinkTokens({ a: [url, { b: url }], n: 1, z: null });
    assert.equal(JSON.stringify(deep).includes(t), false);
    assert.equal((deep as { n: number }).n, 1);
  });

  it('A1: depois do send-email, nenhum registro legivel contem o token; o Resend recebe o link completo; metadata so com jti e exp', async () => {
    const { repo, router } = fresh();
    const ver = repo.listProposals().find((x) => x.id === 'prop-seta-001')!.version || 1;
    const signed = signProposalLinkToken({ proposalId: 'prop-seta-001', version: ver });
    const t = signed.token;
    const url = `https://sti-hub.vercel.app/proposta/prop-seta-001#t=${t}`;
    const ticket = repo.listServiceTickets()[0];
    assert.ok(ticket, 'chamado seed');
    const realFetch = globalThis.fetch;
    const prevKey = process.env.RESEND_API_KEY;
    const sent: string[] = [];
    process.env.RESEND_API_KEY = 're_test_proposal_link_fake';
    globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
      assert.match(String(input), /^https:\/\/api\.resend\.com\//);
      sent.push(String(init?.body || ''));
      return new Response(JSON.stringify({ id: 'fake' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      const r = await router.dispatch({
        context: TRUSTED_INTERNAL_CONTEXT,
        method: 'POST',
        path: '/api/communications/send-email',
        body: {
          to: 'cliente@exemplo.invalid',
          subject: `Proposta ${url}`,
          body: `Olá! Acesse a proposta: ${url}\nObrigado.`,
          docType: 'PROPOSAL',
          publicPdfUrl: url,
          ticketId: ticket.id,
          createFollowUpTask: true,
          followUpTitle: `Retornar sobre ${url}`,
        },
      });
      assert.equal(r.status, 200);
      assert.equal(JSON.stringify(r.body).includes(t), false);
    } finally {
      globalThis.fetch = realFetch;
      if (prevKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = prevKey;
    }
    assert.equal(sent.length, 1);
    assert.equal(sent[0].includes(t), true, 'e-mail entregue leva o link completo');
    const state = JSON.stringify(repo.getState());
    assert.equal(state.includes(t), false, 'estado gravado sem o token');
    assert.equal(state.includes(t.split('.')[1]), false, 'nem a assinatura');
    assert.equal(state.includes(t.split('.')[0]), false, 'nem o payload');
    assert.match(state, /#t=\[REDACTED\]/);
    const evt = repo.listTimelineEvents({ type: 'EMAIL' }).find((e) => String(e.title).includes('[REDACTED]'))!;
    assert.ok(evt);
    const meta = evt.metadata as Record<string, unknown>;
    assert.deepEqual(meta.proposalLink, { jti: signed.claims.jti, exp: new Date(signed.claims.exp).toISOString() });
    assert.equal(meta.publicPdfUrl, 'https://sti-hub.vercel.app/proposta/prop-seta-001#t=[REDACTED]');
    const comments = JSON.stringify(repo.listServiceTickets().find((x) => x.id === ticket.id));
    assert.match(comments, /#t=\[REDACTED\]/);
  });

  it('A1: POST /api/timeline e journal reconciliado gravam #t=[REDACTED]', async () => {
    const { repo, router } = fresh();
    const t = linkFor('prop-seta-001', 2);
    const url = `https://x.invalid/proposta/prop-seta-001#t=${t}`;
    const tl = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: '/api/timeline', body: { type: 'NOTE', title: `Nota ${url}`, body: url, metadata: { link: url } } });
    assert.equal(tl.status, 201);
    const journal = {
      timelineEvents: [{ id: 'evt-journal-link-1', type: 'EMAIL', title: `E-mail ${url}`, body: url, metadata: { publicPdfUrl: url }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    };
    await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: '/api/state/reconcile', body: { journal } });
    await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'GET', path: '/api/health', body: { _reconcileJournal: { timelineEvents: [{ ...journal.timelineEvents[0], id: 'evt-journal-link-2' }] } } });
    const state = JSON.stringify(repo.getState());
    assert.equal(state.includes(t), false);
    assert.equal(state.includes(t.split('.')[1]), false);
  });

  it('M1: sessao MFA so com Chamados (ou sem acesso a propostas) => 404 do link; nao emite link', async () => {
    const { repo, router } = fresh();
    const onlyTickets = sessionFor(repo, 'usr-seta-02', { enabledModules: ['CHAMADOS'], moduleAccess: { crm: false, erp: false, chamados: true } });
    const g = await router.dispatch({ method: 'GET', path: '/api/erp/proposals/prop-seta-001', query: { ...HTTP, _sessionToken: onlyTickets } });
    assert.equal(g.status, 404);
    assert.deepEqual(g.body, (await getPublic(router, 'prop-nao-existe')).body);
    const iss = await router.dispatch({ method: 'POST', path: '/api/erp/proposals/prop-seta-001/public-link', query: { ...HTTP, _sessionToken: onlyTickets }, body: {} });
    assert.equal(iss.status, 403);
    const noProposals = sessionFor(repo, 'usr-seta-05');
    const g2 = await router.dispatch({ method: 'GET', path: '/api/erp/proposals/prop-seta-001', query: { ...HTTP, _sessionToken: noProposals } });
    assert.equal(g2.status, 404);
    // Com o token do link, o mesmo usuario ve apenas o DTO publico.
    const ver = repo.listProposals().find((x) => x.id === 'prop-seta-001')!.version || 1;
    const g3 = await router.dispatch({ method: 'GET', path: '/api/erp/proposals/prop-seta-001', query: { ...HTTP, _clientIp: nextIp(), _sessionToken: onlyTickets, proposalLinkToken: linkFor('prop-seta-001', ver) } });
    assert.equal(g3.status, 200);
    assert.doesNotMatch(JSON.stringify(g3.body), FORBIDDEN_DTO);
  });

  it('M1: vendedor PROPRIOS ve completo so as proprias; de colega => 404 (link)', async () => {
    const { repo, router } = fresh();
    const maria = repo.findRbacUserRecord('usr-seta-03', '')!;
    const evelyn = repo.findRbacUserRecord('usr-seta-02', '')!;
    const mine = repo.createProposal({ title: 'Da Maria', companyName: 'C1', sellerName: maria.name, sellerEmail: maria.email, items: [] } as never);
    await new Promise((r) => setTimeout(r, 5));
    const colleague = repo.createProposal({ title: 'Da Evelyn', companyName: 'C2', sellerName: evelyn.name, sellerEmail: evelyn.email, items: [] } as never);
    const tok = sessionFor(repo, 'usr-seta-03');
    assert.equal((await router.dispatch({ method: 'GET', path: `/api/erp/proposals/${mine.id}`, query: { ...HTTP, _sessionToken: tok } })).status, 200);
    assert.equal((await router.dispatch({ method: 'GET', path: `/api/erp/proposals/${colleague.id}`, query: { ...HTTP, _sessionToken: tok } })).status, 404);
    assert.equal((await router.dispatch({ method: 'GET', path: `/api/erp/proposals/${colleague.id}`, query: { ...HTTP, _sessionToken: sessionFor(repo, 'usr-seta-01') } })).status, 200);
  });

  it('M2: vendedor que se renomeia para o nome de um colega => 403 (dono por e-mail/sellerUserId, nunca nome); EQUIPE = PROPRIOS; sellerUserId nao vem do cliente', async () => {
    const { repo, router } = fresh();
    const maria = repo.findRbacUserRecord('usr-seta-03', '')!;
    const evelyn = repo.findRbacUserRecord('usr-seta-02', '')!;
    const colleague = repo.createProposal({ title: 'Da Evelyn', companyName: 'C2', sellerName: evelyn.name, sellerEmail: evelyn.email, items: [] } as never);
    const issue = (id: string, session: string) =>
      router.dispatch({ method: 'POST', path: `/api/erp/proposals/${id}/public-link`, query: { ...HTTP, _sessionToken: session }, body: {} });
    // Renomeia a vendedora para o nome da colega (registro e sessao).
    repo.upsertRbacUser({ id: maria.id, email: maria.email, name: evelyn.name });
    assert.equal(repo.findRbacUserRecord(maria.id, '')!.name, evelyn.name);
    const renamed = sessionFor(repo, 'usr-seta-03', { name: evelyn.name });
    assert.equal((await issue(colleague.id, renamed)).status, 403);
    // Proposta com sellerName = nome dela mas sem e-mail/sellerUserId dela => 403.
    const byNameOnly = repo.createProposal({ title: 'So nome', companyName: 'C3', sellerName: evelyn.name, items: [] } as never);
    assert.equal((await issue(byNameOnly.id, renamed)).status, 403);
    // PATCH nao troca o sellerUserId; POST com sellerUserId no corpo e ignorado.
    await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'PATCH', path: `/api/erp/proposals/${colleague.id}`, body: { sellerUserId: maria.id } });
    assert.equal(repo.listProposals().find((x) => x.id === colleague.id)!.sellerUserId, undefined);
    assert.equal((await issue(colleague.id, renamed)).status, 403);
    // Journal do navegador tambem nao define sellerUserId.
    await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: '/api/state/reconcile', body: { journal: { upsertedProposals: [{ ...colleague, sellerUserId: maria.id, updatedAt: new Date(Date.now() + 60_000).toISOString() }] } } });
    assert.equal(repo.listProposals().find((x) => x.id === colleague.id)!.sellerUserId, undefined);
    // Escopo EQUIPE vale como PROPRIOS.
    repo.upsertRbacUser({ id: maria.id, email: maria.email, name: maria.name, scope: 'EQUIPE' } as never);
    assert.equal(repo.findRbacUserRecord(maria.id, '')!.scope, 'EQUIPE');
    const equipe = sessionFor(repo, 'usr-seta-03', { scope: 'EQUIPE' });
    assert.equal((await issue(colleague.id, equipe)).status, 403);
    assert.equal((await router.dispatch({ method: 'GET', path: `/api/erp/proposals/${colleague.id}`, query: { ...HTTP, _sessionToken: equipe } })).status, 404);
    const mineByEmail = repo.createProposal({ title: 'Da Maria', companyName: 'C4', sellerEmail: maria.email, items: [] } as never);
    assert.equal((await issue(mineByEmail.id, equipe)).status, 200);
  });

  it('B1: exp = min(TTL, fim do dia de validUntil); validade vencida => 409; aceite publico recusa RASCUNHO', async () => {
    const { repo, router } = fresh();
    const admin = sessionFor(repo, 'usr-seta-01');
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const p = repo.createProposal({ title: 'Validade curta', companyName: 'C', validUntil: soon, items: [] } as never);
    const r = await router.dispatch({ method: 'POST', path: `/api/erp/proposals/${p.id}/public-link`, query: { ...HTTP, _sessionToken: admin }, body: {} });
    assert.equal(r.status, 200);
    const exp = Date.parse((r.body as { data: { expiresAt: string } }).data.expiresAt);
    assert.equal(exp, Date.parse(`${soon}T23:59:59.999-03:00`));
    await new Promise((res) => setTimeout(res, 5));
    const old = repo.createProposal({ title: 'Vencida', companyName: 'C', validUntil: '2020-01-01', items: [] } as never);
    const r2 = await router.dispatch({ method: 'POST', path: `/api/erp/proposals/${old.id}/public-link`, query: { ...HTTP, _sessionToken: admin }, body: {} });
    assert.equal(r2.status, 409);
    assert.equal((r2.body as { code: string }).code, 'PROPOSAL_EXPIRED');
    await new Promise((res) => setTimeout(res, 5));
    const draft = repo.createProposal({ title: 'Rascunho', companyName: 'C', status: 'RASCUNHO', items: [] } as never);
    const a = await approve(router, draft.id, linkFor(draft.id, draft.version || 1));
    assert.equal(a.status, 409);
    assert.equal(repo.listProposals().find((x) => x.id === draft.id)!.status, 'RASCUNHO');
  });

  it('B2: statusObservation fora do schema publico => 400', async () => {
    const { repo, router } = fresh();
    const p = repo.createProposal({ title: 'B2', companyName: 'C', items: [] } as never);
    const r = await approve(router, p.id, linkFor(p.id, p.version || 1), { ...SIGNER, statusObservation: 'aprovado pelo cliente' });
    assert.equal(r.status, 400);
    assert.deepEqual((r.body as { fields: string[] }).fields, ['statusObservation']);
  });

  it('B3: assinatura precisa ser ^[A-Za-z0-9_-]{43}$', () => {
    const t = linkFor('prop-seta-001', 2);
    const [payload, sig] = t.split('.');
    assert.equal(sig.length, 43);
    assert.equal(verifyProposalLinkToken(t, { proposalId: 'prop-seta-001' }).valid, true);
    for (const bad of [`${payload}.${sig}=`, `${payload}.${sig}A`, `${payload}.${sig.replace(/-/g, '+').replace(/_/g, '/')}+`, `${payload}.${sig.slice(0, 42)}`, `${payload}=.${sig}`]) {
      assert.equal(verifyProposalLinkToken(bad, { proposalId: 'prop-seta-001' }).valid, false, bad.slice(-6));
    }
  });

  it('B5: a pagina nao aceita mais ?t= (so #t=)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/app/proposta/[id]/page.tsx', 'utf8');
    const fn = src.slice(src.indexOf('function readProposalLinkTokenFromLocation'), src.indexOf('function PublicProposalPrintContent'));
    assert.match(fn, /window\.location\.hash/);
    assert.doesNotMatch(fn, /searchParams|location\.search|replaceState/);
  });
});

describe('Escopo de propostas nas rotas autenticadas (CISO 30/10: PATCH e lista)', () => {
  async function setup() {
    const { repo, router } = fresh();
    const maria = repo.findRbacUserRecord('usr-seta-03', '')!; // vendedora A (PROPRIOS)
    const evelyn = repo.findRbacUserRecord('usr-seta-02', '')!; // dona das propostas de "B"
    const a = sessionFor(repo, 'usr-seta-03');
    const admin = sessionFor(repo, 'usr-seta-01');
    const mk = async (title: string, sellerEmail: string, sellerName: string) => {
      const r = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: '/api/erp/proposals', body: { title, companyName: 'C', sellerEmail, sellerName, items: [] } });
      await new Promise((res) => setTimeout(res, 3));
      return (r.body as { data: ErpProposal }).data;
    };
    const ofA = await mk('Proposta de A', maria.email, maria.name);
    const ofB = await mk('Proposta de B', evelyn.email, evelyn.name);
    return { repo, router, maria, evelyn, a, admin, ofA, ofB };
  }
  type ErpProposal = { id: string; code: string; sellerEmail?: string; sellerName?: string; sellerUserId?: string; version?: number; title: string };
  const call = (router: CrmApiRouter, method: string, path: string, session: string, body: Record<string, unknown> = {}) =>
    router.dispatch({ method, path, query: { ...HTTP, _clientIp: '192.0.2.10', _sessionToken: session }, body });

  it('(c) sellerUserId gravado pelo servidor a partir do e-mail (nunca do corpo)', async () => {
    const { ofA, ofB, maria, evelyn } = await setup();
    assert.equal(ofA.sellerUserId, maria.id);
    assert.equal(ofB.sellerUserId, evelyn.id);
  });

  it('(a) vendedor A faz PATCH ou PUT na proposta de B => 403, sem alterar', async () => {
    const { repo, router, a, ofB, ofA } = await setup();
    for (const m of ['PATCH', 'PUT']) {
      const r = await call(router, m, `/api/erp/proposals/${ofB.id}`, a, { title: 'Hackeada' });
      assert.equal(r.status, 403, m);
      assert.equal((r.body as { code: string }).code, 'PROPOSAL_SCOPE_FORBIDDEN');
      // tambem pelo codigo da proposta
      assert.equal((await call(router, m, `/api/erp/proposals/${ofB.code}`, a, { title: 'Hackeada' })).status, 403);
    }
    assert.equal(repo.listProposals().find((p) => p.id === ofB.id)!.title, 'Proposta de B');
    assert.equal((await call(router, 'PATCH', `/api/erp/proposals/${ofA.id}`, a, { title: 'Minha editada' })).status, 200);
    assert.equal((await call(router, 'DELETE', `/api/erp/proposals/${ofB.id}`, a)).status, 403);
    assert.ok(repo.listProposals().some((p) => p.id === ofB.id));
  });

  it('(b) A tenta trocar sellerEmail/sellerName/sellerUserId da propria para tomar ou passar a posse => 403', async () => {
    const { repo, router, a, ofA, ofB, maria, evelyn } = await setup();
    const tries = [{ sellerEmail: evelyn.email }, { sellerName: evelyn.name }, { sellerUserId: evelyn.id }, { sellerEmail: maria.email, sellerName: 'Outro Nome' }];
    for (const t of tries) {
      const r = await call(router, 'PATCH', `/api/erp/proposals/${ofA.id}`, a, { title: 'x', ...t });
      assert.equal(r.status, 403, JSON.stringify(t));
      assert.equal((r.body as { code: string }).code, 'PROPOSAL_OWNER_IMMUTABLE');
    }
    // Na de B (trocar o e-mail para o dela): bloqueado.
    assert.equal((await call(router, 'PATCH', `/api/erp/proposals/${ofB.id}`, a, { sellerEmail: maria.email })).status, 403);
    // Mesmos valores (o editor da UI reenvia o rascunho completo) => permitido.
    assert.equal((await call(router, 'PATCH', `/api/erp/proposals/${ofA.id}`, a, { title: 'ok', sellerEmail: maria.email.toUpperCase(), sellerName: maria.name })).status, 200);
    const after = repo.listProposals().find((p) => p.id === ofB.id)!;
    assert.equal(after.sellerEmail, evelyn.email);
    assert.equal(after.sellerUserId, evelyn.id);
    // Criar em nome de outra pessoa / upsert em nome de outra: 403.
    assert.equal((await call(router, 'POST', '/api/erp/proposals', a, { title: 'Nova', sellerEmail: evelyn.email })).status, 403);
    assert.equal((await call(router, 'PATCH', '/api/erp/proposals/prop-so-no-navegador-1', a, { title: 'Upsert', sellerEmail: evelyn.email })).status, 403);
    const up = await call(router, 'PATCH', '/api/erp/proposals/prop-so-no-navegador-2', a, { title: 'Upsert ok' });
    assert.equal(up.status, 200);
    const upd = (up.body as { data: ErpProposal }).data;
    assert.equal(upd.sellerEmail, maria.email);
    assert.equal(upd.sellerUserId, maria.id);
    // Journal do navegador nao troca dono nem toca proposta de B.
    const cur = repo.listProposals().find((p) => p.id === ofA.id)!;
    await call(router, 'POST', '/api/state/reconcile', a, {
      journal: {
        upsertedProposals: [
          { ...cur, sellerEmail: evelyn.email, sellerName: evelyn.name, updatedAt: new Date(Date.now() + 60_000).toISOString() },
          { ...after, title: 'B via journal', updatedAt: new Date(Date.now() + 60_000).toISOString() },
        ],
        deletedProposalIds: [ofB.id],
      },
    });
    const a2 = repo.listProposals().find((p) => p.id === ofA.id)!;
    assert.equal(a2.sellerEmail, maria.email);
    const b2 = repo.listProposals().find((p) => p.id === ofB.id)!;
    assert.ok(b2, 'B nao apagada pelo journal de A');
    assert.equal(b2.title, 'Proposta de B');
  });

  it('(d) a lista de A (e bootstrap/overview/negocio) nao mostra propostas de B', async () => {
    const { repo, router, a, admin, ofA, ofB } = await setup();
    const ids = (r: { body: unknown }) => ((r.body as { data: ErpProposal[] }).data || []).map((p) => p.id);
    const la = await call(router, 'GET', '/api/erp/proposals', a);
    assert.equal(la.status, 200);
    assert.ok(ids(la).includes(ofA.id));
    assert.equal(ids(la).includes(ofB.id), false);
    assert.equal(ids(la).some((id) => id.startsWith('prop-seta-') || id.startsWith('prop-gc-')), false);
    const ladm = await call(router, 'GET', '/api/erp/proposals', admin);
    assert.ok(ids(ladm).includes(ofB.id) && ids(ladm).includes('prop-seta-001'));
    const ov = await call(router, 'GET', '/api/erp/overview', a);
    const ovIds = ((ov.body as { data: { proposals: ErpProposal[] } }).data.proposals || []).map((p) => p.id);
    assert.equal(ovIds.includes(ofB.id), false);
    const bs = await call(router, 'GET', '/api/bootstrap', a);
    const bsIds = ((bs.body as { data: { erp: { proposals: ErpProposal[] } } }).data.erp.proposals || []).map((p) => p.id);
    assert.equal(bsIds.includes(ofB.id), false);
    assert.ok(bsIds.includes(ofA.id));
    const deal = repo.listDeals()[0];
    repo.updateProposal(ofB.id, { dealId: deal.id } as never);
    const dd = await call(router, 'GET', `/api/deals/${deal.id}`, a);
    if (dd.status === 200) {
      const dIds = ((dd.body as { data: { proposals: ErpProposal[] } }).data.proposals || []).map((p) => p.id);
      assert.equal(dIds.includes(ofB.id), false);
    }
    // Chamada em processo (codigo do servidor, sem HTTP/sessao) segue vendo tudo.
    const internal = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'GET', path: '/api/erp/proposals' });
    assert.ok(ids(internal).includes(ofB.id));
  });

  it('(b) admin ou FULL/TODOS troca o dono e a auditoria registra antes e depois', async () => {
    const { repo, router, admin, ofB, maria, evelyn } = await setup();
    const r = await call(router, 'PATCH', `/api/erp/proposals/${ofB.id}`, admin, { sellerEmail: maria.email, sellerName: maria.name, sellerUserId: 'usr-forjado' });
    assert.equal(r.status, 200);
    const p = repo.listProposals().find((x) => x.id === ofB.id)!;
    assert.equal(p.sellerEmail, maria.email);
    assert.equal(p.sellerUserId, maria.id, 'sellerUserId recalculado pelo e-mail, nao do corpo');
    const logs = repo.listSecurityAuditLogs(500).logs as unknown as Array<{ action: string; details: string; actorEmail: string; resource: string }>;
    const ev = logs.find((l) => l.action === 'PROPOSAL_OWNER_CHANGE' && l.resource.endsWith(ofB.id));
    assert.ok(ev, 'auditoria PROPOSAL_OWNER_CHANGE');
    assert.match(ev!.details, new RegExp(`Antes: nome="${evelyn.name}" email="${evelyn.email}" userId="${evelyn.id}"`));
    assert.match(ev!.details, new RegExp(`Depois: nome="${maria.name}" email="${maria.email}" userId="${maria.id}"`));
    assert.equal(ev!.actorEmail, repo.findRbacUserRecord('usr-seta-01', '')!.email);
    // FULL/TODOS sem ser admin (sessao com escopo TODOS e acesso FULL): tambem pode.
    const gerente = repo.findRbacUserRecord('usr-seta-02', '')!;
    const gs = sessionFor(repo, 'usr-seta-02');
    const access = (router as unknown as { resolveProposalSessionAccess(q: Record<string, string>): { proposalsAccess: string; isAdmin: boolean } | null }).resolveProposalSessionAccess({ _sessionToken: gs });
    assert.ok(access && access.proposalsAccess === 'FULL' && !access.isAdmin && gerente.scope === 'TODOS', 'gerente comercial seed = FULL/TODOS');
    {
      const r2 = await call(router, 'PATCH', `/api/erp/proposals/${ofB.id}`, gs, { sellerEmail: evelyn.email, sellerName: evelyn.name });
      assert.equal(r2.status, 200);
      assert.equal(repo.listProposals().find((x) => x.id === ofB.id)!.sellerUserId, evelyn.id);
    }
  });

  it('(d) versions, acceptance-status e restore-version respeitam o escopo', async () => {
    const { repo, router, a, admin, ofA, ofB, evelyn, maria } = await setup();
    // gera versao 2 na de B e na de A
    await call(router, 'PATCH', `/api/erp/proposals/${ofB.id}`, admin, { title: 'B v2' });
    await call(router, 'PATCH', `/api/erp/proposals/${ofA.id}`, a, { title: 'A v2' });
    const nf = await call(router, 'GET', '/api/erp/proposals/prop-nao-existe/versions', a);
    for (const sub of ['versions', 'acceptance-status']) {
      const rb = await call(router, 'GET', `/api/erp/proposals/${ofB.id}/${sub}`, a);
      assert.equal(rb.status, 404, sub);
      assert.deepEqual(rb.body, nf.body);
      assert.equal((await call(router, 'GET', `/api/erp/proposals/${ofA.id}/${sub}`, a)).status, 200, sub);
      assert.equal((await call(router, 'GET', `/api/erp/proposals/${ofB.id}/${sub}`, admin)).status, 200, sub);
    }
    const rr = await call(router, 'POST', `/api/erp/proposals/${ofB.id}/restore-version`, a, { targetVersion: 1 });
    assert.equal(rr.status, 403);
    assert.equal(repo.listProposals().find((p) => p.id === ofB.id)!.title, 'B v2');
    assert.equal((await call(router, 'POST', `/api/erp/proposals/${ofA.id}/restore-version`, a, { targetVersion: 1 })).status, 200);
    // Revisao antiga com outro dono: A nao pode restaurar (trocaria o dono); admin pode, com auditoria.
    await call(router, 'PATCH', `/api/erp/proposals/${ofB.id}`, admin, { sellerEmail: maria.email, sellerName: maria.name });
    const v = repo.listProposals().find((p) => p.id === ofB.id)!.versionHistory || [];
    const oldVer = v.find((x) => (x.snapshot as { sellerEmail?: string })?.sellerEmail === evelyn.email);
    assert.ok(oldVer, 'revisao antiga com o dono anterior');
    if (oldVer) {
      const blocked = await call(router, 'POST', `/api/erp/proposals/${ofB.id}/restore-version`, a, { targetVersion: oldVer.version });
      assert.equal(blocked.status, 403);
      assert.equal((blocked.body as { code: string }).code, 'PROPOSAL_OWNER_IMMUTABLE');
      const ok = await call(router, 'POST', `/api/erp/proposals/${ofB.id}/restore-version`, admin, { targetVersion: oldVer.version });
      assert.equal(ok.status, 200);
      const restored = repo.listProposals().find((p) => p.id === ofB.id)!;
      assert.equal(restored.sellerEmail, evelyn.email);
      assert.equal(restored.sellerUserId, evelyn.id);
      const logs = JSON.stringify(repo.listSecurityAuditLogs(500));
      assert.match(logs, /restauracao da versao/);
    }
  });
});
