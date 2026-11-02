// ============================================================================
// STI-hub — Pacote N (02/11/2026), commit 2 (R1 do parecer v5): no /approve o HMAC do token e
// verificado ANTES do balde de 30 por IP. Token valido => balde proprio por jti + proposta; sem
// token ou com token invalido => o balde por IP continua, com o mesmo 404 generico.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter, PROPOSAL_APPROVE_LIMITS, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import { signProposalLinkToken } from '../src/app/lib/proposal-link';

const sig = { signerName: 'Fulano de Tal', signerCpf: '529.982.247-25', signerRole: 'Diretor', modality: 'GOV_BR_OURO', acceptedTerms: true };
const mk = async () => {
  const repo = createInMemoryRepository();
  const router = new CrmApiRouter(repo);
  const p = (
    (await router.dispatch({
      context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: '/api/erp/proposals',
      body: { title: 'N aprov', companyName: 'N SA', status: 'ENVIADA', contactName: 'Fulano', items: [{ id: 'i1', description: 'Item', quantity: 1, unitPrice: 100, isRecurring: true, ncmOrServiceCode: 'NCM 8517.62.14' }] },
    })).body as { data: { id: string; version?: number } }
  ).data;
  const token = () => signProposalLinkToken({ proposalId: p.id, version: Math.max(1, Number(p.version || 1)) }).token;
  const approve = (id: string, ip: string, tok?: string, body: unknown = sig) =>
    router.dispatch({ method: 'POST', path: `/api/erp/proposals/${encodeURIComponent(id)}/approve`, query: { _fromHttpBridge: '1', _clientIp: ip, ...(tok ? { proposalLinkToken: tok } : {}) }, body });
  return { repo, router, p, token, approve };
};

describe('Pacote N (R1): balde por IP so para quem nao tem token valido', () => {
  it('limite novo configurado: por token 30', () => {
    assert.equal(PROPOSAL_APPROVE_LIMITS.perToken, 30);
    assert.equal(PROPOSAL_APPROVE_LIMITS.ip, 30);
  });

  it('30 POSTs sem token (e com token falso) do MESMO IP => 31o 429; o aceite com token valido desse IP => 200', async () => {
    const E = await mk();
    const shared = '203.0.113.50';
    const st: number[] = [];
    for (let i = 0; i < 30; i++) {
      const fake = i % 3 === 0 ? undefined : i % 3 === 1 ? 'eyJ2IjoxfQ.' + 'A'.repeat(43) : E.token().slice(0, -2) + 'xx';
      st.push((await E.approve(E.p.id, shared, fake)).status);
    }
    assert.deepEqual(st, Array(30).fill(404));
    assert.equal((await E.approve(E.p.id, shared)).status, 429, 'o atacante segue limitado');
    const ok = await E.approve(E.p.id, shared, E.token());
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });

  it('404 uniforme: sem token, token falso e token de outra proposta => mesmo corpo', async () => {
    const E = await mk();
    const other = signProposalLinkToken({ proposalId: 'prop-outra', version: 1 }).token;
    const bodies = await Promise.all([
      E.approve(E.p.id, '203.0.113.60'),
      E.approve(E.p.id, '203.0.113.61', 'eyJ2IjoxfQ.' + 'B'.repeat(43)),
      E.approve(E.p.id, '203.0.113.62', other),
      E.approve('prop-nao-existe', '203.0.113.63'),
    ]);
    for (const b of bodies) assert.equal(b.status, 404);
    const s = bodies.map((b) => JSON.stringify(b.body));
    assert.ok(s.every((x) => x === s[0]), s.join(' | '));
  });

  it('token valido tem balde proprio: 30 tentativas (de IPs distintos) => 31a com o MESMO token 429; outro token segue', async () => {
    const E = await mk();
    const t = E.token();
    for (let i = 0; i < 30; i++) assert.equal((await E.approve(E.p.id, `2001:db8:${(i + 1).toString(16)}::1`, t, { ...sig, acceptedTerms: false })).status, 400);
    const r = await E.approve(E.p.id, '2001:db8:ff::1', t);
    assert.equal(r.status, 429);
    assert.equal((r.body as { code?: string }).code, 'PROPOSAL_APPROVE_RATE_LIMITED');
    assert.equal((await E.approve(E.p.id, '2001:db8:fe::1', E.token())).status, 200);
  });

  it('verificacao do HMAC antes do balde: custo do caminho invalido nao depende do balde', async () => {
    const E = await mk();
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 40; i++) await E.approve(E.p.id, '203.0.113.70', 'eyJ2IjoxfQ.' + 'C'.repeat(43));
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 2000, `${ms} ms`);
  });
});
