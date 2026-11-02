// ============================================================================
// STI-hub — Link ASSINADO de proposta (29/10/2026). Sem rede externa: tudo em memoria
// (router + repositorio in-memory; a rota Next e exercitada com NextRequest local).
// ============================================================================
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository } from './helpers/legacy-proposal-fixtures';
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
import { isSensitiveProposalPath, SENSITIVE_PROPOSAL_HEADERS } from '../src/app/lib/sensitive-paths';

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
    const t = linkFor('prop-fixture-001', 1);
    const ok = verifyProposalLinkToken(t, { proposalId: 'prop-fixture-001' });
    assert.equal(ok.valid, true);
    if (ok.valid) assert.equal(ok.claims.ver, 1);
    assert.equal(verifyProposalLinkToken(t, { proposalId: 'prop-fixture-002' }).valid, false);
    const [payload, sig] = t.split('.');
    // Adulteracao deterministica (antes: troca dos 2 ultimos por 'AA', que era a propria
    // assinatura quando ela ja terminava em 'AA' => falha intermitente ~1/4096).
    const flip = (c: string) => (c === 'A' ? 'B' : 'A');
    const tampered = `${sig.slice(0, 20)}${flip(sig[20])}${sig.slice(21)}`;
    assert.notEqual(tampered, sig);
    assert.equal(verifyProposalLinkToken(`${payload}.${tampered}`, { proposalId: 'prop-fixture-001' }).valid, false);
    const forgedPayload = Buffer.from(JSON.stringify({ v: 1, pid: 'prop-fixture-001', ver: 9, iat: Date.now(), exp: Date.now() + 1e6, jti: 'x' })).toString('base64url');
    assert.equal(verifyProposalLinkToken(`${forgedPayload}.${sig}`, { proposalId: 'prop-fixture-001' }).valid, false);
    const expired = linkFor('prop-fixture-001', 1, { ttlDays: 1, nowMs: Date.now() - 2 * 86_400_000 });
    assert.equal(verifyProposalLinkToken(expired, { proposalId: 'prop-fixture-001' }).valid, false);
    for (const junk of ['', 'lixo', 'a.b.c', null, undefined, 'x'.repeat(5000)]) {
      assert.equal(verifyProposalLinkToken(junk, { proposalId: 'prop-fixture-001' }).valid, false);
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
    const t = linkFor('prop-fixture-001');
    process.env.STI_HUB_PROPOSAL_LINK_SECRET = 'b'.repeat(40);
    assert.equal(verifyProposalLinkToken(t, { proposalId: 'prop-fixture-001' }).valid, false);

    (process.env as Record<string, string>).NODE_ENV = 'production';
    delete process.env.STI_HUB_PROPOSAL_LINK_SECRET;
    assert.equal(resolveProposalLinkSecret(), null);
    assert.throws(() => linkFor('prop-fixture-001'), /STI_HUB_PROPOSAL_LINK_SECRET/);
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
    const ver = repo.listProposals().find((x) => x.id === 'prop-fixture-001')!.version || 1;
    const t = linkFor('prop-fixture-001', ver);
    assert.equal((await getPublic(router, 'prop-fixture-001', t)).status, 200);
    delete process.env.STI_HUB_PROPOSAL_LINK_SECRET;
    const g = await getPublic(router, 'prop-fixture-001', t);
    assert.equal(g.status, 404);
    assert.equal((await approve(router, 'prop-fixture-001', t)).status, 404);
    const issue = await router.dispatch({
      method: 'POST',
      path: '/api/erp/proposals/prop-fixture-001/public-link',
      query: { ...HTTP, _sessionToken: sessionFor(repo, 'usr-seta-01') },
      body: {},
    });
    assert.equal(issue.status, 503);
    assert.doesNotMatch(JSON.stringify(issue.body), /#t=/);
  });
});

describe('Link assinado de proposta: GET publico', () => {
  it('enumeracao sem token (prop-fixture-001..005, prop-gc-*) => 404 identico ao de id inexistente (corpo e headers)', async () => {
    const { router } = fresh();
    const ref = await getPublic(router, 'prop-nao-existe-123');
    assert.equal(ref.status, 404);
    const ids = ['prop-fixture-001', 'prop-fixture-002', 'prop-fixture-003', 'prop-fixture-004', 'prop-fixture-005', 'prop-gc-4695', 'prop-gc-1', 'prop-gc-4696', 'PROP-FIXTURE-001'];
    for (const id of ids) {
      for (const tok of [undefined, '', 'lixo', linkFor('prop-outra')]) {
        const r = await getPublic(router, id, tok);
        assert.equal(r.status, 404, id);
        assert.deepEqual(r.body, ref.body, id);
        assert.deepEqual(r.headers, ref.headers, id);
      }
    }
    // B8: os headers sensiveis vem do middleware/bridge (pacote G), nao do router.
    assert.equal(ref.headers, undefined);
    for (const pth of ['/api/erp/proposals/prop-fixture-001', '/api/erp/proposals/x/approve', '/api/erp/proposals/x/public-link', '/proposta/prop-fixture-001']) {
      assert.equal(isSensitiveProposalPath(pth), true, pth);
    }
    assert.deepEqual({ ...SENSITIVE_PROPOSAL_HEADERS }, { 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  });

  it('token adulterado, expirado, de outra proposta ou de outra versao => 404', async () => {
    const { repo, router } = fresh();
    const p = repo.listProposals().find((x) => x.id === 'prop-fixture-001')!;
    const ver = p.version || 1;
    const good = linkFor(p.id, ver);
    assert.equal((await getPublic(router, p.id, good)).status, 200);
    const bad = [
      `${good.slice(0, -3)}AAA`,
      linkFor(p.id, ver, { ttlDays: 1, nowMs: Date.now() - 3 * 86_400_000 }),
      linkFor('prop-fixture-002', ver),
      linkFor(p.id, ver + 1),
    ];
    for (const t of bad) assert.equal((await getPublic(router, p.id, t)).status, 404);
    // Proposta editada (versao nova) => link antigo deixa de valer.
    repo.updateProposal(p.id, { title: `${p.title} (rev)` });
    const after = repo.listProposals().find((x) => x.id === p.id)!;
    if ((after.version || 1) !== ver) assert.equal((await getPublic(router, p.id, good)).status, 404);
  });

  it('maleabilidade: so a forma canonica da assinatura e do payload vale (as outras grafias => o mesmo 404)', async () => {
    const { repo, router } = fresh();
    const p = repo.listProposals().find((x) => x.id === 'prop-fixture-001')!;
    const ver = p.version || 1;
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const dec = (x: string) => Buffer.from(x.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    // Todas as grafias do ultimo caractere que decodificam para os MESMOS bytes (inclui a original).
    const sameBytesVariants = (x: string) =>
      A.split('').map((ch) => x.slice(0, -1) + ch).filter((y) => dec(y).equals(dec(x)));
    const good = linkFor(p.id, ver);
    const okRes = await getPublic(router, p.id, good);
    assert.equal(okRes.status, 200);
    const ref404 = await getPublic(router, p.id, `${good.split('.')[0]}.${'A'.repeat(43)}`);
    assert.equal(ref404.status, 404);

    // 1) Assinatura: 43 caracteres => o ultimo carrega 2 bits ignorados => 4 grafias.
    const [payload, sig] = good.split('.');
    const sigVariants = sameBytesVariants(sig);
    assert.equal(sigVariants.length, 4);
    assert.ok(sigVariants.includes(sig));
    for (const alt of sigVariants) {
      const t = `${payload}.${alt}`;
      const want = alt === sig;
      assert.equal(verifyProposalLinkToken(t, { proposalId: p.id }).valid, want, alt);
      const r = await getPublic(router, p.id, t);
      if (want) assert.equal(r.status, 200);
      else {
        assert.equal(r.status, 404, alt);
        assert.deepEqual(r.body, ref404.body);
      }
    }

    // 2) Payload nao canonico com HMAC VALIDO sobre a propria string (o HMAC cobre a string,
    // nao os bytes): precisa ser recusado mesmo assim.
    const secret = resolveProposalLinkSecret()!;
    const key = createHmac('sha256', secret).update('stihub:proposal-public-link:v1', 'utf8').digest();
    const signRaw = (pl: string) => `${pl}.${createHmac('sha256', key).update(pl, 'utf8').digest('base64url')}`;
    assert.equal(signRaw(payload), good, 'helper replica a assinatura real');
    const now = Date.now();
    let claimsB64 = '';
    for (let k = 0; k < 8; k++) {
      claimsB64 = Buffer.from(JSON.stringify({ v: 1, pid: p.id, ver, iat: now, exp: now + 86_400_000, jti: `jti-${'x'.repeat(k)}` })).toString('base64url');
      if (claimsB64.length % 4 === 2) break; // ultimo caractere com 4 bits ignorados
    }
    assert.equal(claimsB64.length % 4, 2);
    assert.equal(verifyProposalLinkToken(signRaw(claimsB64), { proposalId: p.id }).valid, true, 'canonico vale');
    const payloadVariants = sameBytesVariants(claimsB64).filter((y) => y !== claimsB64);
    assert.ok(payloadVariants.length >= 1);
    assert.equal(payloadVariants.length, 15); // 4 bits ignorados => 16 grafias, 1 canonica
    const nonCanonical = payloadVariants;
    for (const pl of nonCanonical) {
      assert.ok(dec(pl).equals(dec(claimsB64)), 'mesmos bytes');
      const t = signRaw(pl);
      assert.equal(verifyProposalLinkToken(t, { proposalId: p.id }).valid, false, pl);
      const r = await getPublic(router, p.id, t);
      assert.equal(r.status, 404, pl);
      assert.deepEqual(r.body, ref404.body);
    }
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
  });

  it('sessao MFA (vendedor/admin) e contexto interno continuam vendo a proposta completa', async () => {
    const { repo, router } = fresh();
    // Vendedora PROPRIOS: completo so na propria (M1); admin ve qualquer uma.
    const maria = repo.findRbacUserRecord('usr-seta-03', '')!;
    const own = repo.createProposal({ title: 'Da Maria', companyName: 'C', sellerEmail: maria.email, items: [] } as never);
    const r = await router.dispatch({ method: 'GET', path: `/api/erp/proposals/${own.id}`, query: { ...HTTP, _sessionToken: sessionFor(repo, 'usr-seta-03') } });
    assert.equal(r.status, 200);
    assert.equal((r.body as { data: { id: string } }).data.id, own.id);
    const a = await router.dispatch({ method: 'GET', path: '/api/erp/proposals/prop-fixture-001', query: { ...HTTP, _sessionToken: sessionFor(repo, 'usr-seta-01') } });
    assert.equal(a.status, 200);
    assert.equal((a.body as { data: { id: string } }).data.id, 'prop-fixture-001');
    const i = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'GET', path: '/api/erp/proposals/prop-fixture-001' });
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

  it('sem token => 404 (nada muda); com token => 200 com DTO publico; repetido => 409 (L); mesma Idempotency-Key => mesmo resultado sem duplicar', async () => {
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
    // v5 (CISO): o replay devolve EXATAMENTE o corpo do primeiro aceite (nada a mais).
    assert.deepEqual(replay.body, ok.body);
    // Pacote L: aceite repetido com outra chave (ou sem chave) => 409, nada a mais.
    const again = await approve(router, p.id, tok, SIGNER, { idem: 'outra-chave-0002' });
    assert.equal(again.status, 409);
    assert.equal((again.body as { code: string }).code, 'PROPOSAL_ALREADY_APPROVED');
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
    // v5: a proposta e resolvida antes do corpo (balde D2 do pacote M) => 404, nada criado.
    assert.equal((await approve(router, id, t, { ...SIGNER, proposal: { id, title: 'Forjada', items: [] } })).status, 404);
    const internal = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: `/api/erp/proposals/${id}/approve`, body: SIGNER });
    assert.equal(internal.status, 404);
    assert.equal(repo.listProposals().length, before);
    assert.equal(repo.listProposals().some((p) => p.id === id), false);
  });

  it('corpo com chave extra => 400 (zod .strict()); Idempotency-Key invalida => 400', async () => {
    const { repo, router } = fresh();
    const p = rentalProposal(repo);
    const t = linkFor(p.id, p.version || 1);
    // v5 (pacote M): tentativas invalidas nao consomem o balde de aceites validados.
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

  it('rate-limit (pacote M): IP 30; IP+proposta 10; por proposta so aceites validados 20 => 429 PROPOSAL_APPROVE_RATE_LIMITED', async () => {
    assert.equal(PROPOSAL_APPROVE_IP_LIMIT.max, 30);
    assert.equal(PROPOSAL_APPROVE_PER_PROPOSAL_LIMIT.max, 20);
    const { repo, router } = fresh();
    const p = rentalProposal(repo);
    const t = linkFor(p.id, p.version || 1);
    // D1 por IP: toda tentativa conta (inclusive 404 sem token).
    const ip = '203.0.113.200';
    let firstIp429 = 0;
    for (let i = 1; i <= PROPOSAL_APPROVE_IP_LIMIT.max + 2; i++) {
      const r = await approve(router, 'prop-qualquer', undefined, SIGNER, { ip });
      if (r.status === 429 && !firstIp429) {
        firstIp429 = i;
        assert.equal((r.body as { code: string }).code, 'PROPOSAL_APPROVE_RATE_LIMITED');
      }
    }
    assert.equal(firstIp429, PROPOSAL_APPROVE_IP_LIMIT.max + 1);
    // D2 por IP + proposta: 10 tentativas invalidas do mesmo IP => a 11a (ate valida) 429; outro IP aceita.
    const ip2 = '203.0.113.201';
    for (let i = 0; i < 10; i++) assert.equal((await approve(router, p.id, t, { ...SIGNER, extra: 1 }, { ip: ip2 })).status, 400);
    assert.equal((await approve(router, p.id, t, SIGNER, { ip: ip2 })).status, 429);
    // D1 por proposta: so aceites validados contam (conversao simulada falhando => 404).
    const { repo: repo2, router: router2 } = fresh();
    const p2 = rentalProposal(repo2);
    // Pacote N (R1): cada token valido tem balde proprio (jti + proposta, 30); aqui um token novo por
    // tentativa isola o balde por proposta (validos).
    const t2 = () => linkFor(p2.id, p2.version || 1);
    for (let i = 0; i < 25; i++) assert.equal((await approve(router2, p2.id, t2(), { ...SIGNER, acceptedTerms: false })).status, 400);
    const orig = repo2.approveProposalAndConvertToContract.bind(repo2);
    (repo2 as unknown as { approveProposalAndConvertToContract: unknown }).approveProposalAndConvertToContract = () => null;
    for (let i = 0; i < PROPOSAL_APPROVE_PER_PROPOSAL_LIMIT.max; i++) assert.equal((await approve(router2, p2.id, t2())).status, 404);
    assert.equal((await approve(router2, p2.id, t2())).status, 429);
    (repo2 as unknown as { approveProposalAndConvertToContract: unknown }).approveProposalAndConvertToContract = orig;
    // Sem token, estranhos nao consomem os baldes da proposta (evita bloquear o cliente).
    const { repo: repo3, router: router3 } = fresh();
    const p3 = rentalProposal(repo3);
    for (let i = 0; i < 25; i++) await approve(router3, p3.id, undefined);
    assert.equal((await approve(router3, p3.id, linkFor(p3.id, p3.version || 1))).status, 200);
  });

  it('replay da Idempotency-Key (CISO): preso a proposta; mesma chave em outra proposta nao devolve o resultado da primeira; corpo identico ao do primeiro aceite', async () => {
    const { repo, router } = fresh();
    const a = rentalProposal(repo);
    await new Promise((r) => setTimeout(r, 3));
    const b = rentalProposal(repo);
    assert.notEqual(a.id, b.id);
    const key = 'idem-compartilhada-01';
    const ta = linkFor(a.id, a.version || 1);
    const tb = linkFor(b.id, b.version || 1);
    const first = await approve(router, a.id, ta, SIGNER, { idem: key });
    assert.equal(first.status, 200);
    const firstText = JSON.stringify(first.body);
    // Mesma chave na proposta B: novo aceite DE B (outro contrato), nunca o resultado de A.
    const onB = await approve(router, b.id, tb, SIGNER, { idem: key });
    assert.equal(onB.status, 200);
    assert.notDeepEqual(onB.body, first.body);
    const dA = (first.body as { data: { contractNumber: string; proposal: { code?: string } } }).data;
    const dB = (onB.body as { data: { contractNumber: string } }).data;
    assert.notEqual(dB.contractNumber, dA.contractNumber);
    assert.ok(!JSON.stringify(onB.body).includes(dA.contractNumber));
    // Hash da chave diferente em cada proposta (preso ao id).
    const ha = repo.listProposals().find((x) => x.id === a.id)!.approvalIdempotencyKeySha256;
    const hb = repo.listProposals().find((x) => x.id === b.id)!.approvalIdempotencyKeySha256;
    assert.ok(ha && hb && ha !== hb);
    // Replay em A: corpo identico ao primeiro (sem flag nem dado a mais), sem novo contrato.
    const contracts = repo.listRentalContracts().length;
    const replay = await approve(router, a.id, ta, SIGNER, { idem: key });
    assert.equal(replay.status, 200);
    assert.equal(JSON.stringify(replay.body), firstText);
    assert.equal(repo.listRentalContracts().length, contracts);
    // Chave de A no caminho de B com o token de A => 404 (token preso ao id), sem vazar A.
    const cross = await approve(router, b.id, ta, SIGNER, { idem: key });
    assert.equal(cross.status, 404);
    assert.ok(!JSON.stringify(cross.body).includes(dA.contractNumber));
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
    assert.equal(isPublicStiHubPath('/api/erp/proposals/prop-fixture-001/public-link', 'POST'), false);
    assert.equal(evaluateStiHubRouteProtection({ pathname: '/api/erp/proposals/prop-fixture-001/public-link', method: 'POST', sessionToken: null }).statusCode, 401);
    assert.equal((await issue(router, 'prop-fixture-001')).status, 401);
    assert.equal((await issue(router, 'prop-fixture-001', 'lixo')).status, 401);

    const fin = await issue(router, 'prop-fixture-001', sessionFor(repo, 'usr-seta-04'));
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
    const req = new NextRequest('https://sti-hub.example.invalid/api/erp/proposals/prop-fixture-001?proposalLinkToken=da-url&x=1', {
      headers: { 'x-proposal-token': 'do-header', 'idempotency-key': 'idem-12345678' },
    });
    const out = await withProposalLinkParams(req);
    const u = new URL(out.url);
    assert.equal(u.searchParams.get('proposalLinkToken'), 'do-header');
    assert.equal(u.searchParams.get('proposalIdempotencyKey'), 'idem-12345678');
    assert.equal(u.searchParams.get('x'), '1');
    assert.equal(out.headers.get('x-proposal-token'), null);

    const urlOnly = await withProposalLinkParams(
      new NextRequest('https://sti-hub.example.invalid/api/erp/proposals/prop-fixture-001?proposalLinkToken=da-url')
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
    const t = linkFor('prop-fixture-001', 2);
    const url = `https://sti-hub.vercel.app/proposta/prop-fixture-001#t=${t}`;
    assert.equal(redactProposalLinkTokens(`Veja ${url} e ${url}.`), 'Veja https://sti-hub.vercel.app/proposta/prop-fixture-001#t=[REDACTED] e https://sti-hub.vercel.app/proposta/prop-fixture-001#t=[REDACTED].');
    assert.equal(redactProposalLinkTokens('#t=abc'), '#t=[REDACTED]');
    assert.equal(redactProposalLinkTokens('sem link'), 'sem link');
    const deep = deepRedactProposalLinkTokens({ a: [url, { b: url }], n: 1, z: null });
    assert.equal(JSON.stringify(deep).includes(t), false);
    assert.equal((deep as { n: number }).n, 1);
  });

  it('A1: depois do send-email, nenhum registro legivel contem o token; o Resend recebe o link completo; metadata so com jti e exp', async () => {
    const { repo, router } = fresh();
    const ver = repo.listProposals().find((x) => x.id === 'prop-fixture-001')!.version || 1;
    const signed = signProposalLinkToken({ proposalId: 'prop-fixture-001', version: ver });
    const t = signed.token;
    const url = `https://sti-hub.vercel.app/proposta/prop-fixture-001#t=${t}`;
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
    assert.equal(meta.publicPdfUrl, 'https://sti-hub.vercel.app/proposta/prop-fixture-001#t=[REDACTED]');
    const comments = JSON.stringify(repo.listServiceTickets().find((x) => x.id === ticket.id));
    assert.match(comments, /#t=\[REDACTED\]/);
  });

  it('A1: POST /api/timeline e journal reconciliado gravam #t=[REDACTED]', async () => {
    const { repo, router } = fresh();
    const t = linkFor('prop-fixture-001', 2);
    const url = `https://x.invalid/proposta/prop-fixture-001#t=${t}`;
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
    const g = await router.dispatch({ method: 'GET', path: '/api/erp/proposals/prop-fixture-001', query: { ...HTTP, _sessionToken: onlyTickets } });
    assert.equal(g.status, 404);
    assert.deepEqual(g.body, (await getPublic(router, 'prop-nao-existe')).body);
    const iss = await router.dispatch({ method: 'POST', path: '/api/erp/proposals/prop-fixture-001/public-link', query: { ...HTTP, _sessionToken: onlyTickets }, body: {} });
    assert.equal(iss.status, 403);
    const noProposals = sessionFor(repo, 'usr-seta-05');
    const g2 = await router.dispatch({ method: 'GET', path: '/api/erp/proposals/prop-fixture-001', query: { ...HTTP, _sessionToken: noProposals } });
    assert.equal(g2.status, 404);
    // Com o token do link, o mesmo usuario ve apenas o DTO publico.
    const ver = repo.listProposals().find((x) => x.id === 'prop-fixture-001')!.version || 1;
    const g3 = await router.dispatch({ method: 'GET', path: '/api/erp/proposals/prop-fixture-001', query: { ...HTTP, _clientIp: nextIp(), _sessionToken: onlyTickets, proposalLinkToken: linkFor('prop-fixture-001', ver) } });
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
    assert.equal(a.status, 404); // D3: RASCUNHO => o mesmo 404 generico
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
    const t = linkFor('prop-fixture-001', 2);
    const [payload, sig] = t.split('.');
    assert.equal(sig.length, 43);
    assert.equal(verifyProposalLinkToken(t, { proposalId: 'prop-fixture-001' }).valid, true);
    for (const bad of [`${payload}.${sig}=`, `${payload}.${sig}A`, `${payload}.${sig.replace(/-/g, '+').replace(/_/g, '/')}+`, `${payload}.${sig.slice(0, 42)}`, `${payload}=.${sig}`]) {
      assert.equal(verifyProposalLinkToken(bad, { proposalId: 'prop-fixture-001' }).valid, false, bad.slice(-6));
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
    assert.equal(ids(la).some((id) => id.startsWith('prop-seta-') || id.startsWith('prop-fixture-') || id.startsWith('prop-gc-')), false);
    const ladm = await call(router, 'GET', '/api/erp/proposals', admin);
    assert.ok(ids(ladm).includes(ofB.id) && ids(ladm).includes('prop-fixture-001'));
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

describe('D2: autoria de proposta vem da sessao (CISO 30/10)', () => {
  type P = { id: string; version?: number; status: string; updatedBy?: string; convertedContractId?: string | null; digitalSignature?: unknown; approvalIdempotencyKeySha256?: string; versionHistory?: Array<{ version: number; savedBy: string; changeSummary?: string }>; statusHistory?: Array<{ id: string; employeeName: string; notes: string; status: string }> };
  const FORGED = {
    updatedBy: 'Diretor Forjado',
    savedBy: 'Diretor Forjado',
    employeeName: 'Diretor Forjado',
    statusHistory: [{ id: 'sh-forjado', date: '2020-01-01T00:00:00.000Z', notes: 'forjado', status: 'APROVADA', statusLabel: 'Aprovada', employeeName: 'Diretor Forjado' }],
    versionHistory: [{ version: 99, versionLabel: 'v99.0', savedAt: '2020-01-01T00:00:00.000Z', savedBy: 'Diretor Forjado', changedFields: [], changeSummary: 'forjado', snapshot: {} }],
    digitalSignature: { signerName: 'Forjado', signedAt: '2020-01-01T00:00:00.000Z' },
    acceptance: { accepted: true },
    convertedContractId: 'ctr-forjado',
    convertedInvoiceId: 'inv-forjado',
    convertedInvoiceIds: ['inv-forjado'],
    approvalIdempotencyKeySha256: 'f'.repeat(64),
  };
  const call = (router: CrmApiRouter, method: string, path: string, session: string, body: Record<string, unknown> = {}) =>
    router.dispatch({ method, path, query: { ...HTTP, _clientIp: '192.0.2.20', _sessionToken: session }, body });
  const noForgery = (p: P) => {
    const txt = JSON.stringify(p);
    assert.equal(txt.includes('Diretor Forjado'), false, 'nome forjado gravado');
    assert.equal(txt.includes('sh-forjado') || txt.includes('v99.0') || txt.includes('ctr-forjado') || txt.includes('inv-forjado'), false);
    assert.equal(p.approvalIdempotencyKeySha256 === 'f'.repeat(64), false);
    assert.ok(!p.digitalSignature, 'assinatura do corpo ignorada');
  };

  it('PATCH e PUT de sessao: updatedBy/savedBy/employeeName forjados gravam o nome da sessao; historicos e aceite do corpo ignorados', async () => {
    const { repo, router } = fresh();
    const maria = repo.findRbacUserRecord('usr-seta-03', '')!;
    const s = sessionFor(repo, 'usr-seta-03');
    const own = repo.createProposal({ title: 'D2', companyName: 'C', sellerEmail: maria.email, sellerName: maria.name, status: 'ENVIADA', items: [] } as never) as unknown as P;
    const v0 = own.version || 1;
    for (const [i, m] of (['PATCH', 'PUT'] as const).entries()) {
      const r = await call(router, m, `/api/erp/proposals/${own.id}`, s, { ...FORGED, title: `D2 ${m}`, status: i === 0 ? 'EM_NEGOCIACAO' : 'ENVIADA' });
      assert.equal(r.status, 200, m);
    }
    const p = repo.listProposals().find((x) => x.id === own.id) as unknown as P;
    noForgery(p);
    assert.equal(p.version, v0 + 2);
    const last = p.versionHistory![p.versionHistory!.length - 1];
    assert.equal(last.savedBy, maria.name);
    assert.ok(p.versionHistory!.every((v) => v.version <= v0 + 2));
    const sh = p.statusHistory || [];
    assert.ok(sh.length >= 2);
    assert.ok(sh.slice(-2).every((h) => h.employeeName === maria.name));
    assert.equal(p.updatedBy, maria.name);
    assert.equal(p.convertedContractId ?? null, null);
  });

  it('POST de sessao: autoria e campos de aceite do corpo ignorados', async () => {
    const { repo, router } = fresh();
    const admin = repo.findRbacUserRecord('usr-seta-01', '')!;
    const r = await call(router, 'POST', '/api/erp/proposals', sessionFor(repo, 'usr-seta-01'), { ...FORGED, title: 'D2 POST', companyName: 'C' });
    assert.equal(r.status, 201);
    const p = repo.listProposals().find((x) => x.id === (r.body as { data: { id: string } }).data.id) as unknown as P;
    noForgery(p);
    assert.equal(p.updatedBy, admin.name);
  });

  it('journal/reconcile de sessao nao grava autoria, historico, versao nem aceite', async () => {
    const { repo, router } = fresh();
    const s = sessionFor(repo, 'usr-seta-01');
    const cur = repo.listProposals().find((x) => x.id === 'prop-fixture-002') as unknown as P;
    const before = JSON.stringify({ v: cur.version, vh: cur.versionHistory, sh: cur.statusHistory });
    await call(router, 'POST', '/api/state/reconcile', s, {
      journal: {
        upsertedProposals: [
          { ...cur, ...FORGED, version: 999, title: 'via journal', updatedAt: new Date(Date.now() + 60_000).toISOString() },
          { id: 'prop-journal-nova-d2', code: 'PROP-J-D2', title: 'nova via journal', status: 'RASCUNHO', items: [], ...FORGED, updatedAt: new Date().toISOString() },
        ],
      },
    });
    const after = repo.listProposals().find((x) => x.id === 'prop-fixture-002') as unknown as P & { title: string };
    assert.equal(after.title, 'via journal', 'campos comuns continuam sincronizando');
    assert.equal(JSON.stringify({ v: after.version, vh: after.versionHistory, sh: after.statusHistory }), before);
    noForgery(after);
    const nova = repo.listProposals().find((x) => x.id === 'prop-journal-nova-d2') as unknown as P;
    assert.ok(nova);
    noForgery(nova);
    assert.equal(nova.updatedBy, repo.findRbacUserRecord('usr-seta-01', '')!.name);
  });

  it('fluxo normal da UI (status + statusObservation + updatedBy do navegador) continua funcionando', async () => {
    const { repo, router } = fresh();
    const maria = repo.findRbacUserRecord('usr-seta-03', '')!;
    const s = sessionFor(repo, 'usr-seta-03');
    const own = repo.createProposal({ title: 'UI', companyName: 'C', sellerEmail: maria.email, sellerName: maria.name, status: 'ENVIADA', items: [] } as never) as unknown as P & { title: string };
    const draft = { ...repo.listProposals().find((x) => x.id === own.id)! } as Record<string, unknown>;
    const r = await call(router, 'PATCH', `/api/erp/proposals/${own.id}`, s, {
      ...draft,
      title: 'UI editada',
      status: 'EM_NEGOCIACAO',
      statusObservation: 'Cliente pediu desconto',
      updatedBy: maria.name,
    });
    assert.equal(r.status, 200);
    const p = (r.body as { data: P & { title: string } }).data;
    assert.equal(p.title, 'UI editada');
    assert.equal(p.status, 'EM_NEGOCIACAO');
    assert.equal(p.version, (own.version || 1) + 1);
    const lastStatus = p.statusHistory![p.statusHistory!.length - 1];
    assert.equal(lastStatus.notes, 'Cliente pediu desconto');
    assert.equal(lastStatus.employeeName, maria.name);
    assert.equal(p.versionHistory![p.versionHistory!.length - 1].savedBy, maria.name);
  });

  it('contexto interno confiavel mantem o comportamento atual (updatedBy do corpo vale)', async () => {
    const { repo, router } = fresh();
    const r = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'PATCH', path: '/api/erp/proposals/prop-fixture-002', body: { title: 'sync', updatedBy: 'Sync GestaoClick', status: 'ENVIADA' } });
    assert.equal(r.status, 200);
    const p = repo.listProposals().find((x) => x.id === 'prop-fixture-002') as unknown as P;
    assert.equal(p.versionHistory![p.versionHistory!.length - 1].savedBy, 'Sync GestaoClick');
  });
});

describe('Mudanca de status por sessao (CISO 30/10)', () => {
  const call = (router: CrmApiRouter, method: string, path: string, session: string, body: Record<string, unknown> = {}) =>
    router.dispatch({ method, path, query: { ...HTTP, _clientIp: '192.0.2.30', _sessionToken: session }, body });
  const audits = (repo: ReturnType<typeof createInMemoryRepository>) =>
    repo.listSecurityAuditLogs(500).logs as unknown as Array<{ action: string; status: string; details: string; resource: string }>;

  it('conversao nunca por sessao; APROVADA so admin/FULL-TODOS com justificativa (sem contrato); vendedor 403', async () => {
    const { repo, router } = fresh();
    const maria = repo.findRbacUserRecord('usr-seta-03', '')!;
    const admin = repo.findRbacUserRecord('usr-seta-01', '')!;
    const sm = sessionFor(repo, 'usr-seta-03');
    const sa = sessionFor(repo, 'usr-seta-01');
    const own = repo.createProposal({ title: 'S', companyName: 'C', sellerEmail: maria.email, status: 'ENVIADA', items: [] } as never);
    const contracts = repo.listRentalContracts().length;
    let r = await call(router, 'PATCH', `/api/erp/proposals/${own.id}`, sm, { status: 'APROVADA', approvalJustification: 'cliente aceitou por telefone' });
    assert.equal(r.status, 403);
    assert.equal((r.body as { code: string }).code, 'PROPOSAL_MANUAL_APPROVAL_FORBIDDEN');
    r = await call(router, 'PATCH', `/api/erp/proposals/${own.id}`, sa, { status: 'CONVERTIDA_CONTRATO' });
    assert.equal(r.status, 403);
    assert.equal((r.body as { code: string }).code, 'PROPOSAL_STATUS_CONVERSION_FORBIDDEN');
    r = await call(router, 'PATCH', `/api/erp/proposals/${own.id}`, sa, { status: 'APROVADA', approvalJustification: 'curta' });
    assert.equal(r.status, 400);
    assert.equal(repo.listProposals().find((p) => p.id === own.id)!.status, 'ENVIADA');
    r = await call(router, 'PATCH', `/api/erp/proposals/${own.id}`, sa, { status: 'APROVADA', approvalJustification: 'Cliente aceitou por telefone com o diretor', approvedBy: 'Forjado', approvalMode: 'X' });
    assert.equal(r.status, 200);
    const p = repo.listProposals().find((x) => x.id === own.id)!;
    assert.equal(p.status, 'APROVADA');
    assert.equal(p.approvalMode, 'MANUAL');
    assert.equal(p.approvedBy, admin.name);
    assert.equal(p.approvalJustification, 'Cliente aceitou por telefone com o diretor');
    assert.equal(p.convertedContractId ?? null, null);
    assert.equal(repo.listRentalContracts().length, contracts, 'aprovacao manual nao gera contrato');
    assert.ok(audits(repo).some((l) => l.action === 'PROPOSAL_MANUAL_APPROVAL' && l.status === 'SUCCESS' && l.resource.endsWith(own.id)));
    // Mesmo status reenviado (editor da UI) nao e transicao: vendedora dona edita o titulo.
    r = await call(router, 'PATCH', `/api/erp/proposals/${own.id}`, sm, { title: 'S editada', status: 'APROVADA' });
    assert.equal(r.status, 200);
    // Sair de APROVADA: vendedora e gerente FULL/TODOS 403; admin 200 auditado.
    assert.equal((await call(router, 'PATCH', `/api/erp/proposals/${own.id}`, sm, { status: 'ENVIADA' })).status, 403);
    assert.equal((await call(router, 'PATCH', `/api/erp/proposals/${own.id}`, sessionFor(repo, 'usr-seta-02'), { status: 'ENVIADA' })).status, 403);
    assert.equal((await call(router, 'PATCH', `/api/erp/proposals/${own.id}`, sa, { status: 'EM_NEGOCIACAO' })).status, 200);
    assert.ok(audits(repo).some((l) => l.action === 'PROPOSAL_STATUS_REOPEN' && l.resource.endsWith(own.id)));
    // Gerente FULL/TODOS pode aprovar manualmente.
    assert.equal((await call(router, 'PATCH', `/api/erp/proposals/${own.id}`, sessionFor(repo, 'usr-seta-02'), { status: 'APROVADA', approvalJustification: 'Aceite formal recebido por e-mail' })).status, 200);
  });

  it('proposta NOVA ja APROVADA/CONVERTIDA via POST ou journal segue as regras', async () => {
    const { repo, router } = fresh();
    const sm = sessionFor(repo, 'usr-seta-03');
    const sa = sessionFor(repo, 'usr-seta-01');
    assert.equal((await call(router, 'POST', '/api/erp/proposals', sm, { title: 'N', status: 'APROVADA', approvalJustification: 'cliente aceitou por telefone' })).status, 403);
    assert.equal((await call(router, 'POST', '/api/erp/proposals', sa, { title: 'N', status: 'CONVERTIDA_CONTRATO' })).status, 403);
    assert.equal((await call(router, 'POST', '/api/erp/proposals', sa, { title: 'N', status: 'APROVADA' })).status, 400);
    const ok = await call(router, 'POST', '/api/erp/proposals', sa, { title: 'N', status: 'APROVADA', approvalJustification: 'Cliente aceitou na reuniao de 30/10' });
    assert.equal(ok.status, 201);
    assert.equal((ok.body as { data: { approvalMode: string } }).data.approvalMode, 'MANUAL');
    // Upsert via PATCH (proposta so no navegador) ja APROVADA: mesma regra.
    assert.equal((await call(router, 'PATCH', '/api/erp/proposals/prop-nav-aprovada', sm, { title: 'N', status: 'APROVADA' })).status, 403);
    // Journal: nova APROVADA/CONVERTIDA entra como RASCUNHO; existente nao muda de/para travado.
    const cur = repo.listProposals().find((p) => p.id === 'prop-fixture-002')!;
    await call(router, 'POST', '/api/state/reconcile', sa, {
      journal: {
        upsertedProposals: [
          { id: 'prop-j-aprov', code: 'PROP-J-A', title: 'j', status: 'APROVADA', items: [], updatedAt: new Date().toISOString() },
          { id: 'prop-j-conv', code: 'PROP-J-C', title: 'j', status: 'CONVERTIDA_CONTRATO', items: [], updatedAt: new Date().toISOString() },
          { ...cur, status: 'CONVERTIDA_CONTRATO', updatedAt: new Date(Date.now() + 60_000).toISOString() },
        ],
      },
    });
    assert.equal(repo.listProposals().find((p) => p.id === 'prop-j-aprov')!.status, 'RASCUNHO');
    assert.equal(repo.listProposals().find((p) => p.id === 'prop-j-conv')!.status, 'RASCUNHO');
    assert.equal(repo.listProposals().find((p) => p.id === 'prop-fixture-002')!.status, cur.status);
    // Contexto interno confiavel mantem o comportamento.
    const internal = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: '/api/erp/proposals', body: { title: 'sync', status: 'APROVADA' } });
    assert.equal(internal.status, 201);
  });

  it('restore-version para revisao APROVADA/CONVERTIDA por sessao => 403', async () => {
    const { repo, router } = fresh();
    const sa = sessionFor(repo, 'usr-seta-01');
    const p = repo.createProposal({ title: 'R', companyName: 'C', status: 'ENVIADA', items: [] } as never);
    await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'PATCH', path: `/api/erp/proposals/${p.id}`, body: { status: 'APROVADA' } });
    await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'PATCH', path: `/api/erp/proposals/${p.id}`, body: { status: 'ENVIADA' } });
    const hist = repo.listProposals().find((x) => x.id === p.id)!.versionHistory || [];
    const approvedRev = hist.find((v) => (v.snapshot as { status?: string })?.status === 'APROVADA');
    assert.ok(approvedRev);
    const r = await call(router, 'POST', `/api/erp/proposals/${p.id}/restore-version`, sa, { targetVersion: approvedRev!.version });
    assert.equal(r.status, 403);
    assert.equal((r.body as { code: string }).code, 'PROPOSAL_STATUS_RESTORE_FORBIDDEN');
    assert.equal(repo.listProposals().find((x) => x.id === p.id)!.status, 'ENVIADA');
  });
});

describe('Item 1: resposta de /api/erp/gestaoclick/sync passa pelo escopo de propostas', () => {
  it('usuario com controle TOTAL do ERP mas escopo PROPRIOS so ve as proprias no overview do sync', async () => {
    const { repo, router } = fresh();
    const maria = repo.findRbacUserRecord('usr-seta-03', '')!;
    Object.assign(maria.erpPermissions as object, {
      financeBanksAccess: 'FULL', fiscalIssuanceAccess: 'FULL', proposalsQuotesAccess: 'FULL', stockOsSalesAccess: 'FULL',
      rentalContractsAccess: 'FULL', canIssueFiscalDocuments: true, canApproveProposals: true, canDeleteErpRecords: true, maxDiscountPercent: 100,
    });
    assert.ok(!maria.enabledModules || maria.enabledModules.includes('ERP'));
    const own = repo.createProposal({ title: 'M', companyName: 'C', sellerEmail: maria.email, items: [] } as never);
    const r = await router.dispatch({ method: 'POST', path: '/api/erp/gestaoclick/sync', query: { ...HTTP, _sessionToken: sessionFor(repo, 'usr-seta-03') }, body: {} });
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
    const ids = ((r.body as { erp: { proposals: Array<{ id: string }> } }).erp.proposals || []).map((p) => p.id);
    assert.deepEqual(ids, [own.id]);
    assert.ok(repo.listProposals().length > 1);
    const adm = await router.dispatch({ method: 'POST', path: '/api/erp/gestaoclick/sync', query: { ...HTTP, _sessionToken: sessionFor(repo, 'usr-seta-01') }, body: {} });
    assert.equal(adm.status, 200);
    assert.equal((adm.body as { erp: { proposals: unknown[] } }).erp.proposals.length, repo.listProposals().length);
  });
});

describe('Item 2: redacao central (formato do token, forma codificada, todos os caminhos)', () => {
  it('redige #t=, %23t%3D (inclusive duplo) e o token solto; outros tokens intactos', () => {
    const tok = linkFor('prop-x');
    const [payload, sig] = tok.split('.');
    assert.equal(sig.length, 43);
    const out = redactProposalLinkTokens(
      `a https://h/proposta/p#t=${tok} b https://h/x?u=https%3A%2F%2Fh%2Fproposta%2Fp%23t%3D${tok} c %2523t%253D${payload}%252E${sig} d ${tok} e`
    );
    assert.ok(!out.includes(sig), out);
    assert.ok(!out.includes(payload), out);
    assert.match(out, /#t=\[REDACTED\]/);
    assert.match(out, /%23t%3D\[REDACTED\]/);
    assert.match(out, / d \[REDACTED\] e$/);
    const sess = sessionFor(fresh().repo, 'usr-seta-01');
    assert.equal(redactProposalLinkTokens(`x ${sess} y`), `x ${sess} y`, 'token de sessao nao e de link');
    const fakeJwtLike = `eyJhbGciOiJIUzI1NiJ9.${'A'.repeat(43)}`;
    assert.equal(redactProposalLinkTokens(fakeJwtLike), fakeJwtLike);
  });

  it('dispatch redige o corpo de QUALQUER rota que grava (tarefa, timeline); Resend recebe o link completo', async () => {
    const { repo, router } = fresh();
    const tok = linkFor('prop-fixture-001', 2);
    const sig = tok.split('.')[1];
    const enc = `https%3A%2F%2Fh%2Fproposta%2Fprop-fixture-001%23t%3D${tok}`;
    const t = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: '/api/tasks', body: { title: `Ver ${enc}`, description: `token ${tok}`, notes: `#t=${tok}` } });
    assert.ok(t.status < 300, JSON.stringify(t.body).slice(0, 200));
    assert.ok(!JSON.stringify(repo.listTasks({})).includes(sig));
    const realFetch = globalThis.fetch;
    const prevKey = process.env.RESEND_API_KEY;
    const sent: string[] = [];
    process.env.RESEND_API_KEY = 're_test_proposal_link_fake';
    globalThis.fetch = (async (_i: unknown, init?: { body?: unknown }) => {
      sent.push(String(init?.body || ''));
      return new Response('{"id":"f"}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      const r = await router.dispatch({
        context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: '/api/communications/send-email',
        body: { to: 'cliente@exemplo.invalid', subject: 'Proposta', body: `Link: https://h/proposta/prop-fixture-001#t=${tok}\nAlt: ${enc}`, docType: 'PROPOSAL', publicPdfUrl: `https://h/proposta/prop-fixture-001#t=${tok}` },
      });
      assert.equal(r.status < 300, true);
    } finally {
      globalThis.fetch = realFetch;
      if (prevKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = prevKey;
    }
    assert.equal(sent.length, 1);
    assert.ok(sent[0].includes(`#t=${tok}`), 'Resend recebe o link completo');
    assert.ok(sent[0].includes(`%23t%3D${tok}`));
    const state = JSON.stringify(repo.getState());
    assert.ok(!state.includes(sig), 'nada gravado com a assinatura do token');
  });
});

describe('Item 4: allowlist de campos, ncm vazio, sem-ip', () => {
  it('PATCH de sessao e journal descartam campos fora da allowlist (id, createdAt, chaves desconhecidas)', async () => {
    const { repo, router } = fresh();
    const sa = sessionFor(repo, 'usr-seta-01');
    const p = repo.createProposal({ title: 'A', companyName: 'C', items: [] } as never);
    const created = repo.listProposals().find((x) => x.id === p.id)!.createdAt;
    const r = await router.dispatch({ method: 'PATCH', path: `/api/erp/proposals/${p.id}`, query: { ...HTTP, _clientIp: '192.0.2.40', _sessionToken: sa }, body: { title: 'B', id: 'sequestro', createdAt: '2000-01-01T00:00:00.000Z', isAdmin: true, pdfSecret: 'x' } });
    assert.equal(r.status, 200);
    const cur = repo.listProposals().find((x) => x.id === p.id)! as unknown as Record<string, unknown>;
    assert.equal(cur.title, 'B');
    assert.equal(cur.createdAt, created);
    assert.equal(cur.isAdmin, undefined);
    assert.equal(cur.pdfSecret, undefined);
    assert.equal(repo.listProposals().some((x) => x.id === 'sequestro'), false);
    await router.dispatch({ method: 'POST', path: '/api/state/reconcile', query: { ...HTTP, _clientIp: '192.0.2.40', _sessionToken: sa }, body: { journal: { upsertedProposals: [{ ...(cur as object), title: 'J', createdAt: '2000-01-01T00:00:00.000Z', foo: 'bar', updatedAt: new Date(Date.now() + 60_000).toISOString() }] } } });
    const j = repo.listProposals().find((x) => x.id === p.id)! as unknown as Record<string, unknown>;
    assert.equal(j.title, 'J');
    assert.equal(j.createdAt, created);
    assert.equal(j.foo, undefined);
  });

  it('aceite sem IP grava "sem-ip" (sem IP fixo) e item sem NCM nao derruba a conversao', () => {
    const { repo } = fresh();
    const p = repo.createProposal({
      title: 'NCM', companyName: 'C', companyCnpj: '00.000.000/0001-00', status: 'ENVIADA',
      items: [{ id: 'i1', description: 'Roteador', quantity: 1, unitPrice: 100, itemType: 'PRODUTO' }],
    } as never);
    const res = repo.approveProposalAndConvertToContract(p.id, { signerName: 'Cliente' });
    assert.ok(res);
    assert.equal(res!.digitalSignature.ipAddress, 'sem-ip');
    assert.ok(!JSON.stringify(res).includes('189.112.44.18'));
  });

  it('rota de aceite usa return await (erro assincrono cai no try/catch da rota)', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const src = fs.readFileSync(require('node:path').join(process.cwd(), 'src/api/router.ts'), 'utf8');
    assert.match(src, /return await this\.approveProposalViaLink\(/);
  });
});

describe('A4: deepRedact descarta __proto__/constructor/prototype (redacao central x .strict() dos pacotes H/I)', () => {
  it('copia sem as chaves perigosas, prototipo intacto, nada herdado', () => {
    const o = JSON.parse('{"__proto__": {"isInternal": true}, "constructor": {"x": 1}, "prototype": 1, "a": "x #t=abc.def", "n": {"__proto__": {"p": 1}, "k": 1}}');
    const r = deepRedactProposalLinkTokens(o) as Record<string, unknown>;
    assert.deepEqual(Object.keys(r), ['a', 'n']);
    assert.equal(Object.getPrototypeOf(r), Object.prototype);
    assert.equal((r as { isInternal?: unknown }).isInternal, undefined);
    assert.deepEqual(r.n, { k: 1 });
    assert.equal(Object.getPrototypeOf(r.n), Object.prototype);
    assert.equal(r.a, 'x #t=[REDACTED]');
    assert.equal(({} as Record<string, unknown>).isInternal, undefined);
  });

  it('sync GestaoClick com credencial so dentro de "__proto__" => 400 (nada herdado chega a rota); credencial visivel continua 400', async () => {
    const { repo, router } = fresh();
    const q = { ...HTTP, _sessionToken: sessionFor(repo, 'usr-seta-01') };
    const visible = await router.dispatch({ method: 'POST', path: '/api/erp/gestaoclick/sync', query: q, body: { accessToken: 'x', apiBaseUrl: 'https://evil.example' } });
    assert.equal(visible.status, 400);
    const proto = await router.dispatch({ method: 'POST', path: '/api/erp/gestaoclick/sync', query: q, body: JSON.parse('{"__proto__": {"accessToken": "x", "apiBaseUrl": "https://evil.example"}}') });
    assert.equal(proto.status, 400, 'chave reservada no corpo => 400 no dispatch');
    assert.equal((proto.body as { code: string }).code, 'BODY_RESERVED_KEY');
    const nested = await router.dispatch({ method: 'POST', path: '/api/tasks', query: q, body: JSON.parse('{"title": "t", "meta": [{"constructor": {"prototype": 1}}]}') });
    assert.equal(nested.status, 400);
    const plain = await router.dispatch({ method: 'POST', path: '/api/erp/gestaoclick/sync', query: q, body: {} });
    assert.equal(plain.status, 200);
    assert.ok(!JSON.stringify(proto.body).includes('evil.example'));
    assert.ok(!JSON.stringify(repo.getState()).includes('evil.example'));
  });

  it('PATCH de chamado com chave fora da allowlist continua 400 via dispatch (.strict() do H)', async () => {
    const { repo, router } = fresh();
    const t = (repo.listServiceTickets() as Array<{ id: string }>)[0];
    assert.ok(t, 'seed com chamado');
    const r = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'PATCH', path: `/api/tickets/${t.id}`, body: JSON.parse('{"__proto__": {"x": 1}, "subject": "ok", "csatScore": 5}') });
    assert.equal(r.status, 400);
  });
});

describe('A3: redacao normalizada do payload do token', () => {
  const variants = (tok: string) => {
    const [P, S] = tok.split('.');
    return {
      quebraNoMeio: `${P}\n.${S}`,
      quebraDepoisDoPonto: `${P}.\r\n${S}`,
      espacosNoPonto: `${P} . ${S}`,
      fragmentoQuebrado: `https://h/proposta/p#t=${P.slice(0, 30)}\n${P.slice(30)}.${S}`,
      coladoAntesEDepois: `x_${tok}_y abc${tok}abc`,
      pontoPct2E: `${P}%2E${S}`,
      pontoPct2e: `#t%3D${P}%2e${S}`,
      pontoEntidade: `${P}&#46;${S}`,
      pontoUnicodeEscapado: `{"t":"${P}\\u002e${S}"}`,
      zwspNoPayload: `${P.slice(0, 20)}\u200b${P.slice(20)}.${S}`,
      zwjENbspEBom: `${P.slice(0, 10)}\u200d${P.slice(10, 40)}\u00a0${P.slice(40)}\ufeff.${S}`,
      softHyphen: `${P.slice(0, 50)}\u00ad${P.slice(50)}.${S}`,
      base64Padrao: `${P.replace(/-/g, '+').replace(/_/g, '/')}.${S.replace(/-/g, '+').replace(/_/g, '/')}`,
      padding: `${P}==.${S}=`,
    };
  };
  it('cada variante: payload e assinatura somem; texto em volta preservado', () => {
    for (let i = 0; i < 4; i++) {
      const tok = linkFor(`prop-a3-${i}`, 1 + i);
      const [P, S] = tok.split('.');
      const Pstd = P.replace(/-/g, '+').replace(/_/g, '/');
      for (const [name, txt] of Object.entries(variants(tok))) {
        const out = redactProposalLinkTokens(`ANTES ${txt} DEPOIS`);
        const flat = out.replace(/[\s\u200b\u200d\u00a0\ufeff\u00ad]/g, '');
        assert.ok(!flat.includes(P.slice(20, 60)) && !flat.includes(Pstd.slice(20, 60)), `${name}: payload sobreviveu: ${out}`);
        assert.ok(!flat.includes(S.slice(5, 35)), `${name}: assinatura sobreviveu: ${out}`);
        assert.ok(out.startsWith('ANTES ') && out.endsWith(' DEPOIS'), `${name}: ${out}`);
        assert.match(out, /\[REDACTED\]/, name);
      }
    }
  });
  it('tokens de sessao, convite e reset (e JSON sem pid/jti) ficam intactos', () => {
    const { repo } = fresh();
    const sess = sessionFor(repo, 'usr-seta-01');
    assert.equal(redactProposalLinkTokens(`x ${sess} y`), `x ${sess} y`);
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const inviteLike = `${b64({ v: 1, uid: 'usr-seta-03', email: 'm@x', jti: 'abc', exp: Date.now() + 1e6 })}.${'A'.repeat(43)}`;
    const resetLike = `${b64({ uid: 'usr-seta-03', email: 'm@x', pv: '1', exp: Date.now() + 1e6 })}.${'B'.repeat(43)}`;
    const pidSemJti = `${b64({ v: 1, pid: 'prop-x', ver: 1, iat: 1, exp: 2 })}.${'C'.repeat(43)}`;
    for (const t of [inviteLike, resetLike, pidSemJti]) assert.equal(redactProposalLinkTokens(`x ${t}\n.y`), `x ${t}\n.y`);
  });
  it('via dispatch: variantes gravadas em tarefa/notas da proposta nao deixam payload no estado', async () => {
    const { repo, router } = fresh();
    const tok = linkFor('prop-fixture-001', 2);
    const [P] = tok.split('.');
    const v = variants(tok);
    await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: '/api/tasks', body: { title: 'A3', description: Object.values(v).join(' | '), notes: v.zwspNoPayload } });
    await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'PATCH', path: '/api/erp/proposals/prop-fixture-002', body: { commercialNotes: v.quebraNoMeio, internalNotes: v.pontoEntidade } });
    const state = JSON.stringify(repo.getState()).replace(/\\n|\\r|\\u200b|\s/g, '');
    assert.ok(!state.includes(P.slice(20, 60)));
  });
  it('token como CHAVE de objeto e aninhamento acima de 40 niveis', () => {
    const tok = linkFor('prop-k');
    const S = tok.split('.')[1];
    const r = deepRedactProposalLinkTokens({ [tok]: 'v' }) as Record<string, unknown>;
    assert.ok(!Object.keys(r).some((k) => k.includes(S)));
    let deep: unknown = { x: `#t=${tok}` };
    for (let i = 0; i < 45; i++) deep = { n: deep };
    assert.ok(!JSON.stringify(deepRedactProposalLinkTokens(deep)).includes(S));
  });
});

describe('A5/A6: status em lista fechada e justificativa visivel', () => {
  const call = (router: CrmApiRouter, method: string, path: string, session: string, body: Record<string, unknown> = {}) =>
    router.dispatch({ method, path, query: { ...HTTP, _clientIp: '192.0.2.50', _sessionToken: session }, body });
  const J = 'Cliente aceitou por telefone com o diretor';

  it('ZWSP, largura total e minusculas sao normalizados antes das regras (sem escapar) e gravados canonicos', async () => {
    const { repo, router } = fresh();
    const sa = sessionFor(repo, 'usr-seta-01');
    const p = repo.createProposal({ title: 'S', companyName: 'C', status: 'ENVIADA', items: [] } as never);
    for (const st of ['CONVERTIDA_CONTRATO\u200b', '\uFF23\uFF2F\uFF2E\uFF36\uFF25\uFF32\uFF34\uFF29\uFF24\uFF21_CONTRATO', 'convertida_contrato', ' Convertida_Contrato\u2060 ']) {
      const r = await call(router, 'PATCH', `/api/erp/proposals/${p.id}`, sa, { status: st });
      assert.equal(r.status, 403, JSON.stringify(st));
      assert.equal((r.body as { code: string }).code, 'PROPOSAL_STATUS_CONVERSION_FORBIDDEN');
    }
    const semJust = await call(router, 'PATCH', `/api/erp/proposals/${p.id}`, sa, { status: 'APROVADA\u200b' });
    assert.equal(semJust.status, 400);
    assert.equal((semJust.body as { code: string }).code, 'PROPOSAL_APPROVAL_JUSTIFICATION_REQUIRED');
    const ok = await call(router, 'PATCH', `/api/erp/proposals/${p.id}`, sa, { status: 'em_negociacao' });
    assert.equal(ok.status, 200);
    assert.equal(repo.listProposals().find((x) => x.id === p.id)!.status, 'EM_NEGOCIACAO');
    const ap = await call(router, 'PATCH', `/api/erp/proposals/${p.id}`, sa, { status: 'aprovada', approvalJustification: J });
    assert.equal(ap.status, 200);
    assert.equal(repo.listProposals().find((x) => x.id === p.id)!.status, 'APROVADA');
  });

  it('fora da lista e nao-string => 400 (PATCH, PUT, POST), nunca 500, e nada gravado', async () => {
    const { repo, router } = fresh();
    const sa = sessionFor(repo, 'usr-seta-01');
    const p = repo.createProposal({ title: 'S', companyName: 'C', status: 'ENVIADA', items: [] } as never);
    const bad: unknown[] = ['HACKED_STATUS', 'EM NEGOCIACAO', { toString: null }, ['APROVADA'], 42, true, JSON.parse('{"toString":"x"}')];
    for (const st of bad) {
      for (const m of ['PATCH', 'PUT']) {
        const r = await call(router, m, `/api/erp/proposals/${p.id}`, sa, { status: st as never });
        assert.equal(r.status, 400, `${m} ${JSON.stringify(st)}`);
        assert.equal((r.body as { code: string }).code, 'PROPOSAL_STATUS_INVALID');
      }
      const c = await call(router, 'POST', '/api/erp/proposals', sa, { title: 'N', status: st as never });
      assert.equal(c.status, 400, `POST ${JSON.stringify(st)}`);
    }
    assert.equal(repo.listProposals().find((x) => x.id === p.id)!.status, 'ENVIADA');
  });

  it('journal nunca grava minusculas nem status fora da lista (nova e existente)', async () => {
    const { repo, router } = fresh();
    const sa = sessionFor(repo, 'usr-seta-01');
    const cur = repo.listProposals().find((x) => x.id === 'prop-fixture-002')!;
    const later = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
    const send = (ups: unknown[]) => call(router, 'POST', '/api/state/reconcile', sa, { journal: { upsertedProposals: ups } });
    await send([
      { id: 'prop-jn-1', code: 'PROP-JN-1', title: 'j', status: 'convertida_contrato', items: [], updatedAt: later(1) },
      { id: 'prop-jn-2', code: 'PROP-JN-2', title: 'j', status: 'aprovada\u200b', items: [], updatedAt: later(1) },
      { id: 'prop-jn-3', code: 'PROP-JN-3', title: 'j', status: 'HACKED_STATUS', items: [], updatedAt: later(1) },
      { id: 'prop-jn-4', code: 'PROP-JN-4', title: 'j', status: 'em_negociacao', items: [], updatedAt: later(1) },
      { id: 'prop-jn-5', code: 'PROP-JN-5', title: 'j', status: { toString: null }, items: [], updatedAt: later(1) },
    ]);
    const st = (id: string) => repo.listProposals().find((x) => x.id === id)!.status;
    assert.equal(st('prop-jn-1'), 'RASCUNHO');
    assert.equal(st('prop-jn-2'), 'RASCUNHO');
    assert.equal(st('prop-jn-3'), 'RASCUNHO');
    assert.equal(st('prop-jn-4'), 'EM_NEGOCIACAO');
    assert.equal(st('prop-jn-5'), 'RASCUNHO');
    const before = cur.status;
    for (const [i, s] of ['convertida_contrato', 'CONVERTIDA_CONTRATO ', 'aprovada', 'hacked'].entries()) {
      await send([{ ...cur, status: s, updatedAt: later(2 + i) }]);
      assert.equal(st('prop-fixture-002'), before, s);
    }
    if (!CrmApiRouter.PROPOSAL_LOCKED_STATUSES.includes(before)) {
      await send([{ ...cur, status: 'recusada', updatedAt: later(10) }]);
      assert.equal(st('prop-fixture-002'), 'RECUSADA');
    }
    for (const p of repo.listProposals()) assert.ok(CrmApiRouter.PROPOSAL_STATUSES.includes(p.status), `${p.id}: ${p.status}`);
  });

  it('A6: justificativa nao-string => 400; invisiveis, diacriticos soltos, fillers e emojis nao contam; minimo 10 visiveis', async () => {
    const { repo, router } = fresh();
    const sa = sessionFor(repo, 'usr-seta-01');
    const p = repo.createProposal({ title: 'S', companyName: 'C', status: 'ENVIADA', items: [] } as never);
    const bad: unknown[] = [
      1234567890, ['Cliente aceitou por telefone'], { toString: 'x' }, true,
      '\u200b'.repeat(10), '\u200d'.repeat(12), '\u3164'.repeat(10), '\u115f\u1160'.repeat(6),
      'a' + '\u0301'.repeat(9), '\u0301'.repeat(12), '\ud83d\ude00'.repeat(5), '\u00a0'.repeat(12), '\u3000'.repeat(12),
      'abc\u200b\u200b\u200b\u200b\u200b\u200b\u200bd', 'a b c d e f g h i', '!!!!!!!!!!!!',
    ];
    for (const j of bad) {
      const r = await call(router, 'PATCH', `/api/erp/proposals/${p.id}`, sa, { status: 'APROVADA', approvalJustification: j as never });
      assert.equal(r.status, 400, JSON.stringify(j));
      assert.equal((r.body as { code: string }).code, 'PROPOSAL_APPROVAL_JUSTIFICATION_REQUIRED', JSON.stringify(j));
    }
    assert.equal(repo.listProposals().find((x) => x.id === p.id)!.status, 'ENVIADA');
    assert.equal((await call(router, 'POST', '/api/erp/proposals', sa, { title: 'N', status: 'APROVADA', approvalJustification: 1234567890 as never })).status, 400);
    const ok = await call(router, 'PATCH', `/api/erp/proposals/${p.id}`, sa, { status: 'APROVADA', approvalJustification: 'Aceite\u200b ok 30/10 por telefone' });
    assert.equal(ok.status, 200);
    const saved = repo.listProposals().find((x) => x.id === p.id)!;
    assert.equal(saved.approvalMode, 'MANUAL');
    assert.ok(!String(saved.approvalJustification).includes('\u200b'));
    const acentos = repo.createProposal({ title: 'S2', companyName: 'C', status: 'ENVIADA', items: [] } as never);
    assert.equal((await call(router, 'PATCH', `/api/erp/proposals/${acentos.id}`, sa, { status: 'APROVADA', approvalJustification: 'Aprovação ok' })).status, 200);
  });
});

describe('A4 (fail-closed): BODY_RESERVED_KEY antes de qualquer efeito colateral, inclusive nas rotas publicas', () => {
  const RESERVED_BODIES = (): Array<[string, Record<string, unknown>]> => [
    ['__proto__ topo', JSON.parse(`{"__proto__": {"acceptedTerms": true}, ${JSON.stringify(SIGNER).slice(1)}`)],
    ['__proto__ aninhado', { ...SIGNER, extra: JSON.parse('{"a": {"__proto__": {"x": 1}}}') }],
    ['constructor aninhado', { ...SIGNER, meta: JSON.parse('{"b": [{"constructor": {"prototype": {"x": 1}}}]}') }],
    ['prototype em array', { ...SIGNER, list: JSON.parse('[1, {"prototype": 1}]') }],
  ];
  const repoProto = Object.getPrototypeOf(createInMemoryRepository()) as Record<string, unknown>;
  const SPIED_REPO = ['syncFromDisk', 'appendSecurityAuditLog', 'reconcileClientState', 'approveProposalAndConvertToContract', 'createTimelineEvent', 'updateProposal', 'createProposal'];
  const SPIED_ROUTER = ['handleRoute', 'dispatchSalesAgent', 'approveProposalViaLink'];
  async function withSpies(fn: (calls: string[]) => Promise<void>) {
    const calls: string[] = [];
    const restore: Array<() => void> = [];
    const routerProto = CrmApiRouter.prototype as unknown as Record<string, unknown>;
    for (const [proto, names] of [[repoProto, SPIED_REPO], [routerProto, SPIED_ROUTER]] as const) {
      for (const n of names) {
        const orig = proto[n] as ((...a: unknown[]) => unknown) | undefined;
        if (typeof orig !== 'function') continue;
        proto[n] = function (this: unknown, ...a: unknown[]) { calls.push(n); return orig.apply(this, a); };
        restore.push(() => { proto[n] = orig; });
      }
    }
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (u: unknown) => { calls.push(`fetch:${String(u)}`); return new Response('{}', { status: 200 }); }) as typeof fetch;
    const realConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error };
    for (const m of ['log', 'info', 'warn', 'error'] as const) console[m] = (...a: unknown[]) => { calls.push(`console.${m}:${a.map(String).join(' ').slice(0, 80)}`); };
    try {
      await fn(calls);
    } finally {
      for (const r of restore) r();
      globalThis.fetch = realFetch;
      Object.assign(console, realConsole);
    }
  }

  it('rotas Next publicas (POST /approve e POST do portal /api/erp/proposals/[id]) recusam antes de tudo', async () => {
    const { POST: approvePOST } = await import('../src/app/api/erp/proposals/[id]/approve/route');
    const portal = await import('../src/app/api/erp/proposals/[id]/route');
    const tok = linkFor('prop-fixture-001', 2);
    await withSpies(async (calls) => {
      for (const [name, body] of RESERVED_BODIES()) {
        for (const [label, handler, path] of [
          ['approve', approvePOST, '/api/erp/proposals/prop-fixture-001/approve'],
          ['portal POST', portal.POST, '/api/erp/proposals/prop-fixture-001'],
          ['portal PATCH', portal.PATCH, '/api/erp/proposals/prop-fixture-001'],
        ] as const) {
          const res = await handler(new NextRequest(`https://sti-hub.example.invalid${path}`, {
            method: label === 'portal PATCH' ? 'PATCH' : 'POST',
            headers: { 'content-type': 'application/json', 'x-proposal-token': tok, 'idempotency-key': 'idem-reservada-0001', 'x-forwarded-for': '203.0.113.9' },
            body: JSON.stringify(body),
          }));
          assert.equal(res.status, 400, `${label} / ${name}`);
          const j = (await res.json()) as { code: string };
          assert.equal(j.code, 'BODY_RESERVED_KEY', `${label} / ${name}`);
          assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
        }
      }
      assert.deepEqual(calls, [], `nada pode rodar antes da recusa: ${calls.join(', ')}`);
      // Controle: os espioes funcionam (um corpo sem chave reservada chega a handleRoute).
      await fresh().router.dispatch({ method: 'POST', path: '/api/erp/proposals/prop-fixture-001/approve', query: { ...HTTP, _clientIp: '203.0.113.10' }, body: SIGNER });
      assert.ok((calls as string[]).includes('handleRoute'), (calls as string[]).join(', '));
    });
  });

  it('JSON.stringify de corpo com __proto__ proprio chega intacto ao handler (o teste de cima nao e vacuo)', () => {
    const b = RESERVED_BODIES()[0][1];
    assert.ok(Object.keys(b).includes('__proto__'));
    assert.match(JSON.stringify(b), /"__proto__"/);
  });

  it('dispatch: approve com token/Idempotency-Key, send-email, journal e conta de servico => 400 sem gravar, auditar, contar rate-limit nem idempotencia', async () => {
    const { repo, router } = fresh();
    const p = repo.createProposal({
      title: 'Aceite fail-closed', companyName: 'Cliente', companyCnpj: '00.000.000/0001-00', status: 'ENVIADA',
      contractMonths: 12, items: [{ id: 'i1', description: 'Roteador', quantity: 1, unitPrice: 100, itemType: 'PRODUTO' }],
    } as never);
    const tok = linkFor(p.id, p.version || 1);
    const sa = sessionFor(repo, 'usr-seta-01');
    // getState() re-semeia segredos TOTP de usuarios seed a cada leitura (nao deterministico):
    // compara tudo menos rbac.users; a trilha de auditoria (rbac.auditLogs) entra na comparacao.
    const snap = () => {
      const st = JSON.parse(JSON.stringify(repo.getState())) as { rbac?: Record<string, unknown> };
      if (st.rbac) delete st.rbac.users;
      return JSON.stringify(st);
    };
    const auditBefore = repo.listSecurityAuditLogs(1000).logs.length;
    const before = snap();
    const ip = '203.0.113.77';
    await withSpies(async (calls) => {
      for (let i = 0; i < 12; i++) {
        for (const [name, body] of RESERVED_BODIES()) {
          const r = await approve(router, p.id, tok, body, { ip, idem: 'idem-reservada-0001' });
          assert.equal(r.status, 400, name);
          assert.equal((r.body as { code: string }).code, 'BODY_RESERVED_KEY');
        }
      }
      const portal = await router.dispatch({ method: 'POST', path: `/api/erp/proposals/${p.id}`, query: { ...HTTP, _clientIp: ip, proposalLinkToken: tok }, body: { title: 'x', meta: JSON.parse('{"constructor": 1}') } });
      assert.equal(portal.status, 400);
      const mail = await router.dispatch({ method: 'POST', path: '/api/communications/send-email', query: { ...HTTP, _clientIp: ip, _sessionToken: sa }, body: { to: 'c@exemplo.invalid', subject: 's', body: `#t=${tok}`, x: JSON.parse('{"__proto__": {}}') } });
      assert.equal(mail.status, 400);
      const jr = await router.dispatch({ method: 'POST', path: '/api/tasks', query: { ...HTTP, _clientIp: ip, _sessionToken: sa }, body: { title: 't', _reconcileJournal: { upsertedTasks: [JSON.parse('{"id": "tj-res", "title": "j", "prototype": 1}')] } } });
      assert.equal(jr.status, 400);
      const svc = await router.dispatch({ method: 'POST', path: '/api/contacts', query: { _fromHttpBridge: '1', _svcBearer: '1', _svcTokenSha256: 'x', _clientIp: ip }, body: { firstName: 'S', n: JSON.parse('{"__proto__": 1}') } });
      assert.equal(svc.status, 400);
      assert.deepEqual(calls, [], calls.join(', '));
    });
    assert.ok(snap() === before, 'estado (inclusive auditoria) identico');
    assert.equal(repo.listSecurityAuditLogs(1000).logs.length, auditBefore, 'nenhuma auditoria');
    // Rate-limit (10/IP, 5/proposta) e Idempotency-Key nao foram consumidos: o 1o aceite valido,
    // do mesmo IP e com a mesma chave, e o primeiro de verdade (cria o contrato, sem replay).
    const contracts = repo.listRentalContracts().length;
    const ok = await approve(router, p.id, tok, SIGNER, { ip, idem: 'idem-reservada-0001' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body).slice(0, 200));
    assert.notEqual((ok.body as { idempotentReplay?: boolean }).idempotentReplay, true);
    assert.equal(repo.listRentalContracts().length, contracts + 1);
    assert.equal(repo.listTasks({}).some((t) => (t as { id: string }).id === 'tj-res'), false);
  });

  // BODY_TOO_DEEP: corpo acima de 40 niveis (raiz = 0) => 400 antes de qualquer efeito.
  const nest = (levels: number, leaf: unknown = 'x') => {
    let v: unknown = leaf;
    for (let i = 0; i < levels; i++) v = { n: v };
    return v as Record<string, unknown>;
  };
  const deepJson = (levels: number) => JSON.parse('{"n":'.repeat(levels) + '"x"' + '}'.repeat(levels)) as Record<string, unknown>;

  it('BODY_TOO_DEEP: 40 niveis passam, 41 (objeto, array ou misto) e 10.000 niveis => 400 sem estourar a pilha', async () => {
    const { repo, router } = fresh();
    const sa = sessionFor(repo, 'usr-seta-01');
    const q = { ...HTTP, _clientIp: '203.0.113.88', _sessionToken: sa };
    const ok = await router.dispatch({ method: 'POST', path: '/api/tasks', query: q, body: { title: 'raso', meta: nest(39) } });
    assert.notEqual((ok.body as { code?: string }).code, 'BODY_TOO_DEEP', 'raiz + meta + 39 = 40 niveis');
    let arr: unknown = 'x';
    for (let i = 0; i < 41; i++) arr = i % 2 ? [arr] : { a: arr };
    for (const [name, body] of [
      ['objeto 41', { title: 't', meta: nest(40) }],
      ['array/misto 41', { title: 't', meta: arr }],
      ['10.000 niveis', deepJson(10_000)],
      ['array topo', JSON.parse('['.repeat(60) + '1' + ']'.repeat(60))],
    ] as Array<[string, Record<string, unknown>]>) {
      const r = await router.dispatch({ method: 'POST', path: '/api/tasks', query: q, body });
      assert.equal(r.status, 400, name);
      assert.equal((r.body as { code: string }).code, 'BODY_TOO_DEEP', name);
    }
  });

  it('BODY_TOO_DEEP nas rotas Next publicas (/approve e portal) e no dispatch: nada gravado, auditado, contado nem enviado', async () => {
    const { POST: approvePOST } = await import('../src/app/api/erp/proposals/[id]/approve/route');
    const portal = await import('../src/app/api/erp/proposals/[id]/route');
    const tokSeed = linkFor('prop-fixture-001', 2);
    const { repo, router } = fresh();
    const p = repo.createProposal({
      title: 'Aceite profundo', companyName: 'Cliente', companyCnpj: '00.000.000/0001-00', status: 'ENVIADA',
      contractMonths: 12, items: [{ id: 'i1', description: 'Roteador', quantity: 1, unitPrice: 100, itemType: 'PRODUTO' }],
    } as never);
    const tok = linkFor(p.id, p.version || 1);
    const sa = sessionFor(repo, 'usr-seta-01');
    const snap = () => {
      const st = JSON.parse(JSON.stringify(repo.getState())) as { rbac?: Record<string, unknown> };
      if (st.rbac) delete st.rbac.users;
      return JSON.stringify(st);
    };
    const before = snap();
    const auditBefore = repo.listSecurityAuditLogs(1000).logs.length;
    const ip = '203.0.113.99';
    await withSpies(async (calls) => {
      for (const [label, handler, path, method] of [
        ['approve', approvePOST, '/api/erp/proposals/prop-fixture-001/approve', 'POST'],
        ['portal POST', portal.POST, '/api/erp/proposals/prop-fixture-001', 'POST'],
        ['portal PATCH', portal.PATCH, '/api/erp/proposals/prop-fixture-001', 'PATCH'],
      ] as const) {
        const res = await handler(new NextRequest(`https://sti-hub.example.invalid${path}`, {
          method,
          headers: { 'content-type': 'application/json', 'x-proposal-token': tokSeed, 'idempotency-key': 'idem-profundo-0001' },
          body: JSON.stringify({ ...SIGNER, extra: nest(45) }),
        }));
        assert.equal(res.status, 400, label);
        assert.equal(((await res.json()) as { code: string }).code, 'BODY_TOO_DEEP', label);
      }
      for (let i = 0; i < 12; i++) {
        const r = await approve(router, p.id, tok, { ...SIGNER, extra: nest(41) }, { ip, idem: 'idem-profundo-0001' });
        assert.equal((r.body as { code: string }).code, 'BODY_TOO_DEEP');
      }
      const mail = await router.dispatch({ method: 'POST', path: '/api/communications/send-email', query: { ...HTTP, _clientIp: ip, _sessionToken: sa }, body: { to: 'c@exemplo.invalid', subject: 's', body: 'b', x: nest(41) } });
      assert.equal((mail.body as { code: string }).code, 'BODY_TOO_DEEP');
      const jr = await router.dispatch({ method: 'POST', path: '/api/tasks', query: { ...HTTP, _clientIp: ip, _sessionToken: sa }, body: { title: 't', _reconcileJournal: { upsertedTasks: [{ id: 'tj-deep', title: 'j', meta: nest(40) }] } } });
      assert.equal((jr.body as { code: string }).code, 'BODY_TOO_DEEP');
      const svc = await router.dispatch({ method: 'POST', path: '/api/contacts', query: { _fromHttpBridge: '1', _svcBearer: '1', _svcTokenSha256: 'x', _clientIp: ip }, body: { firstName: 'S', n: nest(41) } });
      assert.equal((svc.body as { code: string }).code, 'BODY_TOO_DEEP');
      assert.deepEqual(calls, [], calls.join(', '));
    });
    assert.ok(snap() === before, 'estado (inclusive auditoria) identico');
    assert.equal(repo.listSecurityAuditLogs(1000).logs.length, auditBefore);
    const contracts = repo.listRentalContracts().length;
    const ok = await approve(router, p.id, tok, SIGNER, { ip, idem: 'idem-profundo-0001' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body).slice(0, 200));
    assert.notEqual((ok.body as { idempotentReplay?: boolean }).idempotentReplay, true);
    assert.equal(repo.listRentalContracts().length, contracts + 1);
    assert.equal(repo.listTasks({}).some((t) => (t as { id: string }).id === 'tj-deep'), false);
  });
});


// ============================================================================
// D3 (checagem final da v4, 01/11/2026): aceite pelo link so em ENVIADA/EM_NEGOCIACAO;
// emissao: RASCUNHO -> ENVIADA (auditado), ENVIADA/EM_NEGOCIACAO ficam, demais => 409.
// ============================================================================
describe('D3: status no aceite publico e na emissao do link', () => {
  const ITEMS = [
    { id: 'it-d3', sku: 'GC-D3', description: 'PABX IP', fiscalNature: 'LOCACAO_BENS_MOVEIS', ncmOrServiceCode: 'NCM 8517.62.14', quantity: 1, unitPrice: 300, discountPercent: 0, isRecurring: true, totalMonthly: 300 },
  ];
  const ALL = ['RASCUNHO', 'ENVIADA', 'EM_NEGOCIACAO', 'APROVADA', 'CONVERTIDA_CONTRATO', 'RECUSADA', 'STATUS_DESCONHECIDO'] as const;
  type Repo = ReturnType<typeof createInMemoryRepository>;

  function withStatus(repo: Repo, status: string, extra: Record<string, unknown> = {}) {
    const p = repo.createProposal({ title: `D3 ${status}`, companyName: 'Cliente D3', contractMonths: 12, items: ITEMS, ...extra } as never);
    // Status gravado direto (sem passar pelas regras do PATCH), inclusive um fora do enum.
    const ref = repo.listProposals().find((x) => x.id === p.id)! as { status: string };
    ref.status = status;
    return repo.listProposals().find((x) => x.id === p.id)!;
  }
  const issue = (router: CrmApiRouter, id: string, session: string) =>
    router.dispatch({ method: 'POST', path: `/api/erp/proposals/${encodeURIComponent(id)}/public-link`, query: { ...HTTP, _sessionToken: session }, body: {} });
  const tokenOf = (r: { body: unknown }) => {
    const url = (r.body as { data: { url: string } }).data.url;
    return decodeURIComponent(url.split('#t=')[1]);
  };
  const cur = (repo: Repo, id: string) => repo.listProposals().find((x) => x.id === id)!;

  it('aceite em cada status: so ENVIADA/EM_NEGOCIACAO aprovam; os demais => o mesmo 404, sem efeito', async () => {
    for (const st of ALL) {
      const { repo, router } = fresh();
      const ref404 = await getPublic(router, 'prop-nao-existe');
      const p = withStatus(repo, st);
      const contracts = repo.listRentalContracts().length;
      const invoices = repo.listInvoices().length;
      const r = await approve(router, p.id, linkFor(p.id, p.version || 1));
      if (st === 'ENVIADA' || st === 'EM_NEGOCIACAO') {
        assert.equal(r.status, 200, st);
        assert.equal(cur(repo, p.id).status, 'CONVERTIDA_CONTRATO', st);
        assert.equal(repo.listRentalContracts().length, contracts + 1, st);
      } else {
        assert.equal(r.status, 404, st);
        assert.deepEqual(r.body, ref404.body, st);
        assert.doesNotMatch(JSON.stringify(r.body), new RegExp(st, 'i'));
        assert.equal(cur(repo, p.id).status, st, st);
        assert.equal(repo.listRentalContracts().length, contracts, st);
        assert.equal(repo.listInvoices().length, invoices, st);
      }
    }
    // Status com caixa/invisiveis (A5) conta pelo valor canonico.
    const { repo, router } = fresh();
    const p = withStatus(repo, 'em_negocia\u200bcao');
    assert.equal((await approve(router, p.id, linkFor(p.id, p.version || 1))).status, 200);
  });

  it('emissao em cada status: RASCUNHO -> ENVIADA (auditado, versao nova); ENVIADA/EM_NEGOCIACAO ficam; demais => 409 sem emitir', async () => {
    for (const st of ALL) {
      const { repo, router } = fresh();
      const admin = sessionFor(repo, 'usr-seta-01');
      const p = withStatus(repo, st);
      const v0 = p.version || 1;
      const auditBefore = repo.listSecurityAuditLogs(1000).logs.length;
      const r = await issue(router, p.id, admin);
      const after = cur(repo, p.id);
      if (st === 'RASCUNHO') {
        assert.equal(r.status, 200);
        assert.equal(after.status, 'ENVIADA');
        assert.ok((after.version || 1) > v0, 'transicao cria versao nova');
        assert.equal((r.body as { data: { version: number; proposalStatus: string } }).data.version, after.version);
        assert.equal((r.body as { data: { proposalStatus: string } }).data.proposalStatus, 'ENVIADA');
        assert.equal(after.statusHistory!.at(-1)!.status, 'ENVIADA');
        const logs = repo.listSecurityAuditLogs(1000).logs as unknown as Array<{ action: string; status: string; details: string }>;
        assert.ok(logs.some((l) => l.action === 'PROPOSAL_STATUS_CHANGE' && l.status === 'SUCCESS' && /RASCUNHO -> ENVIADA/.test(l.details)));
        // O link emitido vale para a versao nova (GET e aceite).
        const t = tokenOf(r);
        assert.equal((await getPublic(router, p.id, t)).status, 200);
        assert.equal((await approve(router, p.id, t)).status, 200);
      } else if (st === 'ENVIADA' || st === 'EM_NEGOCIACAO') {
        assert.equal(r.status, 200, st);
        assert.equal(after.status, st);
        assert.equal(after.version || 1, v0, st);
        assert.equal((await getPublic(router, p.id, tokenOf(r))).status, 200, st);
      } else {
        assert.equal(r.status, 409, st);
        assert.equal((r.body as { code: string }).code, 'PROPOSAL_LINK_STATUS_INVALID', st);
        assert.equal((r.body as { data?: unknown }).data, undefined, st);
        assert.doesNotMatch(JSON.stringify(r.body), /#t=/);
        assert.equal(after.status, st, st);
        assert.equal(after.version || 1, v0, st);
        const logs = repo.listSecurityAuditLogs(1000).logs.slice(0, repo.listSecurityAuditLogs(1000).logs.length - auditBefore) as unknown as Array<{ action: string; status: string }>;
        assert.ok(!logs.some((l) => l.status === 'SUCCESS'), st);
      }
    }
  });

  it('RASCUNHO -> ENVIADA respeita escopo, sessao, segredo e validade (nada muda quando a emissao falha)', async () => {
    // Producao (sem segredo de desenvolvimento): segredo do link e da sessao explicitos.
    process.env.STI_HUB_PROPOSAL_LINK_SECRET = 'c'.repeat(48);
    process.env.STI_HUB_SESSION_SECRET = 's'.repeat(48);
    (process.env as Record<string, string>).NODE_ENV = 'production';
    const { repo, router } = fresh();
    const evelyn = repo.findRbacUserRecord('usr-seta-02', '')!;
    const maria = repo.findRbacUserRecord('usr-seta-03', '')!;
    const mariaSess = sessionFor(repo, 'usr-seta-03');
    // Rascunho de outra vendedora (escopo PROPRIOS) => 403, continua RASCUNHO.
    const other = withStatus(repo, 'RASCUNHO', { sellerName: evelyn.name, sellerEmail: evelyn.email });
    assert.equal((await issue(router, other.id, mariaSess)).status, 403);
    assert.equal(cur(repo, other.id).status, 'RASCUNHO');
    // Sem sessao => 401, continua RASCUNHO.
    const r401 = await router.dispatch({ method: 'POST', path: `/api/erp/proposals/${other.id}/public-link`, query: { ...HTTP }, body: {} });
    assert.equal(r401.status, 401);
    assert.equal(cur(repo, other.id).status, 'RASCUNHO');
    // Validade vencida => 409 PROPOSAL_EXPIRED, continua RASCUNHO (assinatura testada antes).
    const old = withStatus(repo, 'RASCUNHO', { sellerEmail: maria.email, validUntil: '2020-01-01' });
    const rOld = await issue(router, old.id, mariaSess);
    assert.equal(rOld.status, 409);
    assert.equal((rOld.body as { code: string }).code, 'PROPOSAL_EXPIRED');
    assert.equal(cur(repo, old.id).status, 'RASCUNHO');
    // Segredo ausente => 503, continua RASCUNHO.
    const mine = withStatus(repo, 'RASCUNHO', { sellerEmail: maria.email });
    delete process.env.STI_HUB_PROPOSAL_LINK_SECRET;
    assert.equal((await issue(router, mine.id, mariaSess)).status, 503);
    process.env.STI_HUB_PROPOSAL_LINK_SECRET = 'c'.repeat(48);
    assert.equal(cur(repo, mine.id).status, 'RASCUNHO');
    // Dona da proposta, com tudo certo => 200 e ENVIADA.
    assert.equal((await issue(router, mine.id, mariaSess)).status, 200);
    assert.equal(cur(repo, mine.id).status, 'ENVIADA');
  });

  it('link emitido em ENVIADA continua valendo depois de ENVIADA -> EM_NEGOCIACAO (so o status mudou)', async () => {
    const { repo, router } = fresh();
    const admin = sessionFor(repo, 'usr-seta-01');
    const p = withStatus(repo, 'ENVIADA');
    const r = await issue(router, p.id, admin);
    assert.equal(r.status, 200);
    const t = tokenOf(r);
    const v0 = cur(repo, p.id).version || 1;
    const patch = await router.dispatch({ method: 'PATCH', path: `/api/erp/proposals/${p.id}`, query: { ...HTTP, _sessionToken: admin }, body: { status: 'EM_NEGOCIACAO' } });
    assert.equal(patch.status, 200);
    const after = cur(repo, p.id);
    assert.equal(after.status, 'EM_NEGOCIACAO');
    assert.equal(after.version || 1, v0, 'status-only nao cria versao');
    assert.equal(after.statusHistory!.at(-1)!.status, 'EM_NEGOCIACAO');
    assert.equal((await getPublic(router, p.id, t)).status, 200);
    assert.equal((await approve(router, p.id, t)).status, 200);
    assert.equal(cur(repo, p.id).status, 'CONVERTIDA_CONTRATO');
  });

  it('status + conteudo na mesma edicao => versao nova (o link anterior deixa de valer)', async () => {
    const { repo, router } = fresh();
    const admin = sessionFor(repo, 'usr-seta-01');
    const p = withStatus(repo, 'ENVIADA');
    const t = tokenOf(await issue(router, p.id, admin));
    const patch = await router.dispatch({ method: 'PATCH', path: `/api/erp/proposals/${p.id}`, query: { ...HTTP, _sessionToken: admin }, body: { status: 'EM_NEGOCIACAO', paymentCondition: 'Boleto 30 dias' } });
    assert.equal(patch.status, 200);
    assert.ok((cur(repo, p.id).version || 1) > (p.version || 1));
    assert.equal((await getPublic(router, p.id, t)).status, 404);
    assert.equal((await approve(router, p.id, t)).status, 404);
  });

  it('link para de valer quando o admin volta a proposta para RASCUNHO (GET e aceite => 404)', async () => {
    const { repo, router } = fresh();
    const admin = sessionFor(repo, 'usr-seta-01');
    const p = withStatus(repo, 'ENVIADA');
    const t = tokenOf(await issue(router, p.id, admin));
    assert.equal((await getPublic(router, p.id, t)).status, 200);
    const patch = await router.dispatch({ method: 'PATCH', path: `/api/erp/proposals/${p.id}`, query: { ...HTTP, _sessionToken: admin }, body: { status: 'RASCUNHO' } });
    assert.equal(patch.status, 200);
    assert.equal(cur(repo, p.id).status, 'RASCUNHO');
    const ref404 = await getPublic(router, 'prop-nao-existe');
    const g = await getPublic(router, p.id, t);
    assert.equal(g.status, 404);
    const a = await approve(router, p.id, t);
    assert.equal(a.status, 404);
    assert.deepEqual(a.body, ref404.body);
    assert.equal(cur(repo, p.id).status, 'RASCUNHO');
    assert.equal(repo.listRentalContracts().filter((c) => (c as { proposalId?: string }).proposalId === p.id).length, 0);
  });
});
