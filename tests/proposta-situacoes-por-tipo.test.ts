// Situações da proposta por tipo: rótulos, listas, legados, link e API.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import {
  proposalMatchesStatusFilter,
  proposalStatusBadge,
  proposalStatusChoices,
  proposalStatusLabel,
  proposalStatusOptions,
} from '../src/app/lib/proposal-status';

const HTTP = { _fromHttpBridge: '1' };

function session(repo: ReturnType<typeof createInMemoryRepository>) {
  const rec = repo.findRbacUserRecord('usr-seta-01', '');
  assert.ok(rec);
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
  });
}

describe('Situações da proposta por tipo', () => {
  it('vendas não oferecem contrato; locação e serviços oferecem', () => {
    const vendas = proposalStatusOptions('venda').map((o) => o.value);
    const contrato = proposalStatusOptions('locacao_servico').map((o) => o.value);
    assert.deepEqual(vendas, ['RASCUNHO', 'ENVIADA', 'APROVADA', 'FATURAMENTO', 'CONCRETIZADA', 'RECUSADA']);
    assert.ok(contrato.includes('CONVERTIDA_CONTRATO'));
    assert.equal(vendas.includes('CONVERTIDA_CONTRATO'), false);
    assert.deepEqual(
      proposalStatusChoices('PRODUTOS').map((o) => o.label),
      ['Em aberto', 'Em andamento/Enviado', 'Aprovada', 'Faturamento', 'Concretizada', 'Cancelada']
    );
    assert.deepEqual(
      proposalStatusChoices('SPARE_PARTS').map((o) => o.value),
      vendas
    );
    const locacao = proposalStatusChoices('LOCACAO').map((o) => o.label);
    const servico = proposalStatusChoices('SERVICOS').map((o) => o.label);
    assert.ok(locacao.includes('Convertida em contrato'));
    assert.deepEqual(locacao, servico);
    assert.equal(proposalStatusChoices('PRODUTOS', 'CONVERTIDA_CONTRATO').some((o) => o.value === 'CONVERTIDA_CONTRATO' && o.legacy), true);
  });

  it('mapeia os códigos existentes e conserva o rótulo dos legados', () => {
    assert.equal(proposalStatusLabel('RASCUNHO'), 'Em aberto');
    assert.equal(proposalStatusLabel('ENVIADA'), 'Em andamento/Enviado');
    assert.equal(proposalStatusLabel('EM_NEGOCIACAO'), 'Em andamento/Enviado');
    assert.equal(proposalStatusLabel('APROVADA'), 'Aprovada');
    assert.equal(proposalStatusLabel('CONVERTIDA_CONTRATO'), 'Convertida em contrato');
    assert.equal(proposalStatusLabel('RECUSADA'), 'Cancelada');
    assert.equal(proposalStatusLabel('FATURAMENTO'), 'Faturamento');
    assert.equal(proposalStatusLabel('CONCRETIZADA'), 'Concretizada');
    assert.equal(proposalStatusLabel('EXPIRADA'), 'Expirada');
    assert.equal(proposalStatusLabel('REJEITADA'), 'Rejeitada');
    assert.equal(proposalStatusBadge('EXPIRADA').label, 'Expirada');
    const legado = proposalStatusChoices('LOCACAO', 'EM_NEGOCIACAO');
    assert.equal(legado.find((o) => o.value === 'EM_NEGOCIACAO')?.label, 'Em andamento/Enviado');
    assert.equal(proposalMatchesStatusFilter({ status: 'EM_NEGOCIACAO' }, 'ENVIADA'), true);
    assert.equal(proposalMatchesStatusFilter({ status: 'FATURAMENTO' }, 'ENVIADA'), false);
    assert.equal(proposalMatchesStatusFilter({ status: 'EXPIRADA' }, 'TODOS'), true);
  });

  it('o link do cliente só promove RASCUNHO; a API aceita faturamento e concretizada', async () => {
    const prev = process.env.STI_HUB_PROPOSAL_LINK_SECRET;
    process.env.STI_HUB_PROPOSAL_LINK_SECRET = 'c'.repeat(48);
    try {
      const repo = createInMemoryRepository();
      const router = new CrmApiRouter(repo);
      const tok = session(repo);
      const create = async (title: string, status: string) => {
        const res = await router.dispatch({
          method: 'POST',
          path: '/api/erp/proposals',
          query: { ...HTTP, _sessionToken: tok, _origin: 'https://sti-hub.vercel.app' },
          body: { title, status, budgetType: 'PRODUTOS' },
        });
        assert.equal(res.status, 201, title);
        return (res.body as { data: { id: string; status: string } }).data;
      };
      const draft = await create('Aberta', 'RASCUNHO');
      assert.equal(draft.status, 'RASCUNHO');
      const issued = await router.dispatch({
        method: 'POST',
        path: `/api/erp/proposals/${draft.id}/public-link`,
        query: { ...HTTP, _sessionToken: tok, _origin: 'https://sti-hub.vercel.app' },
        body: {},
      });
      assert.equal(issued.status, 200);
      assert.equal(repo.listProposals().find((p) => p.id === draft.id)?.status, 'ENVIADA');

      const faturada = await create('Faturar', 'FATURAMENTO');
      const again = await router.dispatch({
        method: 'POST',
        path: `/api/erp/proposals/${faturada.id}/public-link`,
        query: { ...HTTP, _sessionToken: tok, _origin: 'https://sti-hub.vercel.app' },
        body: {},
      });
      assert.equal(again.status, 200);
      assert.equal(repo.listProposals().find((p) => p.id === faturada.id)?.status, 'FATURAMENTO');

      const aberta = await create('Virar concretizada', 'RASCUNHO');
      const patched = await router.dispatch({
        method: 'PATCH',
        path: `/api/erp/proposals/${aberta.id}`,
        query: { ...HTTP, _sessionToken: tok },
        body: { status: 'CONCRETIZADA' },
      });
      assert.equal(patched.status, 200);
      assert.equal((patched.body as { data: { status: string } }).data.status, 'CONCRETIZADA');

      const invalid = await router.dispatch({
        method: 'PATCH',
        path: `/api/erp/proposals/${aberta.id}`,
        query: { ...HTTP, _sessionToken: tok },
        body: { status: 'FOO' },
      });
      assert.equal(invalid.status, 400);
      assert.equal((invalid.body as { code: string }).code, 'PROPOSAL_STATUS_INVALID');
      assert.equal(repo.listProposals().find((p) => p.id === aberta.id)?.status, 'CONCRETIZADA');
      assert.equal(CrmApiRouter.normalizeProposalStatus('faturamento').kind, 'ok');
    } finally {
      if (prev === undefined) delete process.env.STI_HUB_PROPOSAL_LINK_SECRET;
      else process.env.STI_HUB_PROPOSAL_LINK_SECRET = prev;
    }
  });

  it('o filtro de andamento no SQL inclui a negociação antiga, sem regravar status', () => {
    const sql = readFileSync(join(process.cwd(), 'src/db/proposal-store.ts'), 'utf8');
    assert.match(sql, /status IN \('ENVIADA', 'EM_NEGOCIACAO'\)/);
    assert.equal(sql.includes('UPDATE erp_proposals SET status'), false);
  });
});
