import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { CrmApiRouter } from '../src/api/router';
import { createInMemoryRepository, type CrmRepository } from '../src/db/repository';
import { buildProposalCopyDraft } from '../src/app/lib/proposal-copy';
import { dealTitleFromProposal, defaultProposalTitle } from '../src/app/lib/proposal-title';
import {
  dealLinkedProposalId,
  linkProposalToCrmDeal,
} from '../src/modules/deals/create-deal-from-proposal';
import type { ErpCommercialProposal } from '../src/db/types';

const HTTP = { _fromHttpBridge: '1' };
const saved: Record<string, string | undefined> = {};

before(() => {
  saved.STI_HUB_SESSION_SECRET = process.env.STI_HUB_SESSION_SECRET;
  process.env.STI_HUB_SESSION_SECRET = process.env.STI_HUB_SESSION_SECRET || 's'.repeat(48);
});

after(() => {
  if (saved.STI_HUB_SESSION_SECRET === undefined) delete process.env.STI_HUB_SESSION_SECRET;
  else process.env.STI_HUB_SESSION_SECRET = saved.STI_HUB_SESSION_SECRET;
});

const session = (repo: CrmRepository) => {
  const r = repo.findRbacUserRecord('usr-seta-01', '')!;
  return {
    ...HTTP,
    _sessionToken: signStiHubSessionToken({
      uid: r.id,
      email: r.email,
      name: r.name,
      roleId: r.roleId,
      scope: r.scope,
      enabledModules: ['CRM', 'ERP', 'CHAMADOS'],
      moduleAccess: { crm: true, erp: true, chamados: true },
      mfaVerified: true,
      mfaMethod: 'TOTP_AUTHENTICATOR',
      erpRole: 'ERP_ADMIN',
      iat: Date.now() - 1000,
      exp: Date.now() + 3_600_000,
    } as Parameters<typeof signStiHubSessionToken>[0]),
  };
};

function uniqueCnpj(suffix: number): string {
  const base = String(81000000000000 + (suffix % 8999)).padStart(14, '0');
  return `${base.slice(0, 2)}.${base.slice(2, 5)}.${base.slice(5, 8)}/${base.slice(8, 12)}-${base.slice(12)}`;
}

describe('t334u clonar proposta cria negócio novo no CRM', () => {
  it('dealTitleFromProposal troca título legado e "(Cópia)" pelo padrão com o número atual', () => {
    const company = 'EVAMIND SERVICOS DE TECNOLOGIA DA INFORMACAO LTDA';
    assert.equal(
      dealTitleFromProposal({
        title: 'Orçamento #4699 — EVAMIND SERVICOS DE TECNOLOGIA DA INFORMACAO LTDA (Cópia)',
        budgetType: 'LOCACAO',
        code: '4727',
        companyName: company,
      }),
      'Orçamento de Locação nº 4727 — EVAMIND SERVICOS DE TECNOLOGIA DA INFORMACAO LTDA'
    );
    assert.equal(
      dealTitleFromProposal({
        title: 'Fornecimento de Switches (Cópia)',
        budgetType: 'PRODUTOS',
        code: '4727',
        companyName: 'FOXCONN BRASIL',
      }),
      'Fornecimento de Switches (Cópia)'
    );
  });

  it('ao clonar, cria um negócio novo só da proposta nova e não altera o negócio original', () => {
    const repo = createInMemoryRepository();
    const cnpj = uniqueCnpj(334);
    const company = repo.createCompany({
      name: 'EVAMIND SERVICOS DE TECNOLOGIA DA INFORMACAO LTDA',
      cnpj,
    });
    const contact = repo.createContact({
      firstName: 'Victor',
      lastName: 'Paina',
      email: 'victor.paina.teste@teste.example',
      companyId: company.id,
    });
    const source = repo.createProposal({
      title: defaultProposalTitle({
        budgetType: 'LOCACAO',
        code: '4699-src',
        companyName: company.name,
      }),
      code: '8101',
      budgetType: 'LOCACAO',
      companyId: company.id,
      companyName: company.name,
      companyCnpj: cnpj,
      contactId: contact.id,
      contactName: 'Victor Paina',
      contactEmail: 'victor.paina.teste@teste.example',
      monthlyRecurringTotal: 1450,
      totalContractValue: 34800,
      contractMonths: 24,
      validUntil: '2026-10-30',
      proposalDate: '2026-10-15',
    });
    const originalLink = linkProposalToCrmDeal(repo, source);
    assert.equal(originalLink.created, true);
    const originalDeal = originalLink.deal;
    const originalTitle = originalDeal.title;
    const originalValue = originalDeal.value;
    const originalClose = originalDeal.expectedCloseDate;
    const originalProposalId = originalDeal.proposalId;
    const dealsBeforeCopy = repo.listDeals().length;

    const draft = buildProposalCopyDraft(
      { ...source, dealId: originalDeal.id, title: 'Orçamento #8101 — EVAMIND SERVICOS DE TECNOLOGIA DA INFORMACAO LTDA' },
      { nextCode: '8102', now: new Date('2026-11-26T13:11:15.000Z'), newId: 'prop-copy-8102' }
    );
    assert.equal(draft.dealId, null);
    assert.equal(draft.title, 'Orçamento de Locação nº 8102 — EVAMIND SERVICOS DE TECNOLOGIA DA INFORMACAO LTDA');

    // Simula o cliente antigo ainda enviando o dealId herdado e o título legado.
    const copied = repo.createProposal({
      ...draft,
      dealId: originalDeal.id,
      title: 'Orçamento #8101 — EVAMIND SERVICOS DE TECNOLOGIA DA INFORMACAO LTDA (Cópia)',
      monthlyRecurringTotal: 3645,
      totalContractValue: 22520,
      contractMonths: 6,
      validUntil: '2026-12-11',
      companyId: company.id,
      contactId: contact.id,
      companyName: company.name,
      companyCnpj: cnpj,
      contactName: 'Victor Paina',
      contactEmail: 'victor.paina.teste@teste.example',
    });
    assert.equal(copied.dealId, null, 'createProposal deve ignorar dealId já ligado a outra proposta');

    const linked = linkProposalToCrmDeal(repo, copied);
    assert.equal(linked.created, true);
    assert.notEqual(linked.deal.id, originalDeal.id);
    assert.equal(linked.proposal.dealId, linked.deal.id);
    assert.equal(dealLinkedProposalId(linked.deal), copied.id);
    assert.equal(linked.deal.title, 'Orçamento de Locação nº 8102 — EVAMIND SERVICOS DE TECNOLOGIA DA INFORMACAO LTDA');
    assert.doesNotMatch(linked.deal.title, /8101|Cópia/);
    assert.equal(linked.deal.value, 22520);
    assert.equal(linked.deal.mrr, 3645);
    assert.equal(linked.deal.contractMonths, 6);
    assert.equal(linked.deal.expectedCloseDate, '2026-12-11');
    assert.equal(linked.deal.pipelineId, 'pipeline-locacao-equipamentos');
    assert.equal(linked.deal.stageId, 'stage-loc-simulacao');
    assert.equal(linked.deal.companyId, company.id);
    assert.equal(linked.deal.contactId, contact.id);
    assert.equal(repo.listDeals().length, dealsBeforeCopy + 1);

    const stillOriginal = repo.getDealById(originalDeal.id)!;
    assert.equal(stillOriginal.title, originalTitle);
    assert.equal(stillOriginal.value, originalValue);
    assert.equal(stillOriginal.expectedCloseDate, originalClose);
    assert.equal(stillOriginal.proposalId, originalProposalId);
    assert.equal(repo.listProposals().find((p) => p.id === source.id)?.dealId, originalDeal.id);
  });

  it('POST /api/erp/proposals com dealId herdado e createCrmDeal abre um negócio novo', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const cnpj = uniqueCnpj(335);
    const company = repo.createCompany({ name: 'Cliente Cópia CRM LTDA', cnpj });
    const contact = repo.createContact({
      firstName: 'Lia',
      lastName: 'Nunes',
      email: 'lia.nunes.copia@teste.example',
      companyId: company.id,
    });
    const sourceRes = await router.dispatch({
      method: 'POST',
      path: '/api/erp/proposals',
      query: session(repo),
      body: {
        title: 'Orçamento #9001 — Cliente Cópia CRM LTDA',
        budgetType: 'LOCACAO',
        companyId: company.id,
        companyName: company.name,
        companyCnpj: cnpj,
        contactId: contact.id,
        contactName: 'Lia Nunes',
        contactEmail: 'lia.nunes.copia@teste.example',
        monthlyRecurringTotal: 2000,
        totalContractValue: 24000,
        contractMonths: 12,
        validUntil: '2026-12-10',
        createCrmDeal: true,
      },
    });
    assert.equal(sourceRes.status, 201, JSON.stringify(sourceRes.body));
    const sourceBody = sourceRes.body as { data: ErpCommercialProposal; crmDeal: { id: string; title: string } };
    const sourceDealId = sourceBody.crmDeal.id;
    const dealsBefore = repo.listDeals().length;

    const copyRes = await router.dispatch({
      method: 'POST',
      path: '/api/erp/proposals',
      query: session(repo),
      body: {
        title: 'Orçamento #9001 — Cliente Cópia CRM LTDA (Cópia)',
        budgetType: 'LOCACAO',
        companyId: company.id,
        companyName: company.name,
        companyCnpj: cnpj,
        contactId: contact.id,
        contactName: 'Lia Nunes',
        contactEmail: 'lia.nunes.copia@teste.example',
        monthlyRecurringTotal: 3645,
        totalContractValue: 22520,
        contractMonths: 6,
        validUntil: '2026-12-11',
        dealId: sourceDealId,
        createCrmDeal: true,
      },
    });
    assert.equal(copyRes.status, 201, JSON.stringify(copyRes.body));
    const copyBody = copyRes.body as {
      data: ErpCommercialProposal;
      crmDeal: { id: string; title: string; value: number; expectedCloseDate?: string | null };
      crmDealCreated: boolean;
    };
    assert.equal(copyBody.crmDealCreated, true);
    assert.notEqual(copyBody.crmDeal.id, sourceDealId);
    assert.equal(copyBody.data.dealId, copyBody.crmDeal.id);
    assert.equal(copyBody.crmDeal.title, defaultProposalTitle({
      budgetType: 'LOCACAO',
      code: copyBody.data.code,
      companyName: company.name,
    }));
    assert.doesNotMatch(copyBody.crmDeal.title, /9001|\(Cópia\)/);
    assert.equal(copyBody.crmDeal.value, 22520);
    assert.equal(copyBody.crmDeal.expectedCloseDate, '2026-12-11');
    assert.equal(repo.listDeals().length, dealsBefore + 1);

    const sourceDeal = repo.getDealById(sourceDealId)!;
    assert.equal(dealLinkedProposalId(sourceDeal), sourceBody.data.id);
    assert.equal(repo.listProposals().find((p) => p.id === sourceBody.data.id)?.dealId, sourceDealId);
  });
});
