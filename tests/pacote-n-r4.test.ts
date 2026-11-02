// ============================================================================
// STI-hub — Pacote N (02/11/2026), commit 3 (R4): proposalLinkToken em BRIDGE_RESERVED_KEYS.
// O token nunca entra pelo corpo (bridge e server.ts) nem pela URL do server.ts standalone;
// no server.ts ele so entra pelo header X-Proposal-Token, como nas rotas Next do link.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { BRIDGE_RESERVED_KEYS, CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import { stripReservedBodyKeys } from '../src/app/api/_bridge';
import { createCrmHttpServer } from '../src/api/server';
import { createInMemoryRepository } from '../src/db/repository';
import { signProposalLinkToken } from '../src/app/lib/proposal-link';

describe('Pacote N (R4): proposalLinkToken reservado', () => {
  it('esta em BRIDGE_RESERVED_KEYS e o bridge o remove do corpo', () => {
    assert.ok((BRIDGE_RESERVED_KEYS as readonly string[]).includes('proposalLinkToken'));
    assert.deepEqual(stripReservedBodyKeys({ proposalLinkToken: 'x', a: 1 }), { a: 1 });
  });

  it('server.ts: token na query ou no corpo => 404; no header X-Proposal-Token => 200', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const p = (
      (await router.dispatch({
        context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: '/api/erp/proposals',
        body: { title: 'R4', companyName: 'R4 SA', status: 'ENVIADA', contactName: 'Fulano', items: [{ id: 'i1', description: 'Item', quantity: 1, unitPrice: 100, isRecurring: true, ncmOrServiceCode: 'NCM 8517.62.14' }] },
      })).body as { data: { id: string; version?: number } }
    ).data;
    const token = signProposalLinkToken({ proposalId: p.id, version: Math.max(1, Number(p.version || 1)) }).token;
    const server = createCrmHttpServer(router);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/erp/proposals/${encodeURIComponent(p.id)}`;
    try {
      const viaQuery = await fetch(`${base}?proposalLinkToken=${encodeURIComponent(token)}`);
      assert.equal(viaQuery.status, 404);
      const viaBody = await fetch(`${base}/approve`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ proposalLinkToken: token, signerName: 'Fulano de Tal', signerCpf: '529.982.247-25', signerRole: 'Diretor', modality: 'GOV_BR_OURO', acceptedTerms: true }),
      });
      assert.equal(viaBody.status, 404);
      const viaHeader = await fetch(base, { headers: { 'x-proposal-token': token } });
      assert.equal(viaHeader.status, 200, await viaHeader.clone().text());
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
