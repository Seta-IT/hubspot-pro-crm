import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { CrmApiRouter } from '../src/api/router';
import { createInMemoryRepository, type CrmRepository } from '../src/db/repository';
import {
  findCompanyForProposal,
  findContactForProposal,
  funnelLabelForBudgetType,
  linkProposalToCrmDeal,
  resolveDealPlacementForProposal,
  wantsCreateCrmDeal,
} from '../src/modules/deals/create-deal-from-proposal';
import { isFollowupEnrollStage } from '../src/modules/deals/sales-pipeline-stages';
import { emailHistoryRecipientsLabel, withoutEmailHistoryBcc, withoutEmailHistoryBccList } from '../src/app/lib/email-send-history';
import type { ErpCommercialProposal, ErpInvoiceEmailHistoryEntry, Pipeline } from '../src/db/types';

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

const tokFor = (repo: CrmRepository, uid = 'usr-seta-01', extra: Record<string, unknown> = {}) => {
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
    erpRole: uid === 'usr-seta-01' ? 'ERP_ADMIN' : 'ERP_COMMERCIAL',
    iat: Date.now() - 1000,
    exp: Date.now() + 3_600_000,
    ...extra,
  } as Parameters<typeof signStiHubSessionToken>[0]);
};

const session = (repo: CrmRepository, uid = 'usr-seta-01', extra: Record<string, unknown> = {}) => ({
  ...HTTP,
  _sessionToken: tokFor(repo, uid, extra),
});

function uniqueCnpj(suffix: number): string {
  const base = String(80000000000000 + (suffix % 8999)).padStart(14, '0');
  return `${base.slice(0, 2)}.${base.slice(2, 5)}.${base.slice(5, 8)}/${base.slice(8, 12)}-${base.slice(12)}`;
}

describe('t226u proposta cria negócio no CRM', () => {
  it('wantsCreateCrmDeal reconhece o flag do corpo', () => {
    assert.equal(wantsCreateCrmDeal({ createCrmDeal: true }), true);
    assert.equal(wantsCreateCrmDeal({ createCrmDeal: 'true' }), true);
    assert.equal(wantsCreateCrmDeal({ title: 'X' }), false);
    assert.equal(wantsCreateCrmDeal(null), false);
  });

  it('encontra empresa por CNPJ e contato por e-mail, sem criar duplicata', () => {
    const repo = createInMemoryRepository();
    const cnpj = uniqueCnpj(101);
    const company = repo.createCompany({ name: 'ACME Vínculo LTDA', cnpj });
    const contact = repo.createContact({
      firstName: 'Ana',
      lastName: 'Souza',
      email: 'ana.souza.vinculo@acme-teste.example',
      companyId: company.id,
    });
    const companiesBefore = repo.listCompanies().length;
    const contactsBefore = repo.listContacts().length;

    const foundCompany = findCompanyForProposal(repo.listCompanies(), {
      companyCnpj: cnpj.replace(/\D+/g, ''),
      companyName: 'Outro Nome',
    });
    assert.equal(foundCompany?.id, company.id);

    const foundByName = findCompanyForProposal(repo.listCompanies(), {
      companyName: 'acme vinculo ltda',
    });
    assert.equal(foundByName?.id, company.id);

    const foundContact = findContactForProposal(repo.listContacts(), {
      contactEmail: 'ANA.SOUZA.VINCULO@acme-teste.example',
      contactName: 'Outra Pessoa',
      companyId: company.id,
    });
    assert.equal(foundContact?.id, contact.id);

    const foundByNameContact = findContactForProposal(repo.listContacts(), {
      contactName: 'Ana Souza',
      companyId: company.id,
    });
    assert.equal(foundByNameContact?.id, contact.id);

    const proposal = repo.createProposal({
      title: 'Locação ACME vínculo',
      companyName: 'ACME Vínculo LTDA',
      companyCnpj: cnpj,
      contactName: 'Ana Souza',
      contactEmail: 'ana.souza.vinculo@acme-teste.example',
      totalContractValue: 24000,
      monthlyRecurringTotal: 1000,
      contractMonths: 24,
    });
    const result = linkProposalToCrmDeal(repo, proposal);
    assert.equal(result.created, true);
    assert.equal(result.companyCreated, false);
    assert.equal(result.contactCreated, false);
    assert.equal(result.company.id, company.id);
    assert.equal(result.contact?.id, contact.id);
    assert.equal(result.deal.companyId, company.id);
    assert.equal(result.deal.contactId, contact.id);
    assert.equal(result.deal.proposalId, proposal.id);
    assert.equal(result.proposal.dealId, result.deal.id);
    assert.equal(repo.listCompanies().length, companiesBefore);
    assert.equal(repo.listContacts().length, contactsBefore);
  });

  it('é idempotente: um segundo vínculo devolve o mesmo negócio', () => {
    const repo = createInMemoryRepository();
    const proposal = repo.createProposal({
      title: 'Proposta idempotente CRM',
      companyName: 'Cliente Idempotente CRM',
      companyCnpj: uniqueCnpj(202),
      contactName: 'Bruno Lima',
      contactEmail: 'bruno.lima.idem@teste.example',
      totalContractValue: 12000,
    });
    const first = linkProposalToCrmDeal(repo, proposal);
    const dealsAfterFirst = repo.listDeals().length;
    const companiesAfterFirst = repo.listCompanies().length;
    const contactsAfterFirst = repo.listContacts().length;
    const second = linkProposalToCrmDeal(repo, first.proposal);
    assert.equal(second.created, false);
    assert.equal(second.deal.id, first.deal.id);
    assert.equal(second.proposal.dealId, first.deal.id);
    assert.equal(repo.listDeals().length, dealsAfterFirst);
    assert.equal(repo.listCompanies().length, companiesAfterFirst);
    assert.equal(repo.listContacts().length, contactsAfterFirst);
  });

  it('POST /api/erp/proposals com createCrmDeal cria o deal e vincula empresa e contato', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const cnpj = uniqueCnpj(303);
    const existing = repo.createCompany({ name: 'Seta Cliente API LTDA', cnpj });
    repo.createContact({
      firstName: 'Carla',
      lastName: 'Mendes',
      email: 'carla.mendes.api@teste.example',
      companyId: existing.id,
    });
    const dealsBefore = repo.listDeals().length;
    const companiesBefore = repo.listCompanies().length;
    const contactsBefore = repo.listContacts().length;

    const res = await router.dispatch({
      method: 'POST',
      path: '/api/erp/proposals',
      query: session(repo),
      body: {
        title: 'Orçamento API cria negócio',
        companyName: 'Seta Cliente API LTDA',
        companyCnpj: cnpj,
        contactName: 'Carla Mendes',
        contactEmail: 'carla.mendes.api@teste.example',
        sellerName: 'Marcelo Lopes Mira',
        totalContractValue: 36000,
        monthlyRecurringTotal: 1500,
        contractMonths: 24,
        createCrmDeal: true,
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const body = res.body as {
      data: ErpCommercialProposal;
      crmDeal: { id: string; title: string; value: number; proposalId?: string };
      crmDealCreated: boolean;
    };
    assert.equal(body.crmDealCreated, true);
    assert.ok(body.data.dealId);
    assert.equal(body.data.dealId, body.crmDeal.id);
    assert.equal(body.data.companyId, existing.id);
    assert.equal(body.crmDeal.title, 'Orçamento API cria negócio');
    assert.equal(body.crmDeal.value, 36000);
    assert.equal(body.crmDeal.proposalId, body.data.id);
    assert.equal(repo.listDeals().length, dealsBefore + 1);
    assert.equal(repo.listCompanies().length, companiesBefore);
    assert.equal(repo.listContacts().length, contactsBefore);

    const again = await router.dispatch({
      method: 'PATCH',
      path: `/api/erp/proposals/${encodeURIComponent(body.data.id)}`,
      query: session(repo),
      body: { title: body.data.title, createCrmDeal: true },
    });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    const againBody = again.body as { crmDeal: { id: string }; crmDealCreated: boolean; data: ErpCommercialProposal };
    assert.equal(againBody.crmDealCreated, false);
    assert.equal(againBody.crmDeal.id, body.crmDeal.id);
    assert.equal(againBody.data.dealId, body.crmDeal.id);
    assert.equal(repo.listDeals().length, dealsBefore + 1);
  });

  it('sem módulo CRM devolve 403 e não cria proposta nem negócio', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const dealsBefore = repo.listDeals().length;
    const proposalsBefore = repo.listProposals().length;
    const res = await router.dispatch({
      method: 'POST',
      path: '/api/erp/proposals',
      query: session(repo, 'usr-seta-03', {
        enabledModules: ['ERP'],
        moduleAccess: { crm: false, erp: true, chamados: false },
        erpRole: 'ERP_COMMERCIAL',
      }),
      body: {
        title: 'Orçamento sem acesso ao CRM',
        companyName: 'Cliente Sem CRM',
        companyCnpj: uniqueCnpj(404),
        sellerName: 'Maria Luiza',
        sellerEmail: 'marialuiza@setatelecom.com.br',
        createCrmDeal: true,
      },
    });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    const err = res.body as { code?: string; error?: string; requiredModule?: string };
    assert.equal(err.code, 'MODULE_CRM_FORBIDDEN');
    assert.equal(err.requiredModule, 'CRM');
    assert.match(String(err.error || ''), /não possui o módulo CRM/i);
    assert.equal(repo.listDeals().length, dealsBefore);
    assert.equal(repo.listProposals().length, proposalsBefore);
  });
});

describe('t226u funil do negócio conforme o tipo da proposta', () => {
  const sale = { pipelineId: 'pipe-enterprise-b2b', stageId: 'stage-proposal', pipelineName: 'Pipeline 2: Venda de Equipamentos' };
  const rental = { pipelineId: 'pipeline-locacao-equipamentos', stageId: 'stage-loc-simulacao', pipelineName: 'Pipeline 1: Locação & Serviços' };

  it('resolve o funil e a etapa dos 4 tipos e, sem budgetType, usa o Pipeline 2', () => {
    const repo = createInMemoryRepository();
    const pipelines = repo.listPipelines();
    const cases: Array<[string | undefined, typeof sale]> = [
      ['PRODUTOS', sale],
      ['CONJUNTO', sale],
      ['LOCACAO', rental],
      ['SERVICOS', rental],
      [undefined, sale],
    ];
    for (const [budgetType, expected] of cases) {
      const placement = resolveDealPlacementForProposal(pipelines, budgetType);
      assert.equal(placement.pipelineId, expected.pipelineId, String(budgetType));
      assert.equal(placement.stageId, expected.stageId, String(budgetType));
      assert.equal(placement.usedFallback, 'preferred-stage', String(budgetType));
      assert.equal(funnelLabelForBudgetType(budgetType), `Funil: ${expected.pipelineName}`);
    }
  });

  it('se a etapa preferida não existir, usa a etapa inicial do funil indicado; se o funil não existir, usa o padrão', () => {
    const salePipe: Pipeline = {
      id: 'pipe-enterprise-b2b',
      name: 'Pipeline 2: Venda de Equipamentos',
      isDefault: false,
      currency: 'BRL',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      stages: [
        { id: 'stage-discovery', pipelineId: 'pipe-enterprise-b2b', name: 'Lead Gerado', order: 1, defaultProbability: 15, dealRottingDays: 10, isClosed: false, isWon: false },
      ],
    };
    const missingStage = resolveDealPlacementForProposal([salePipe], 'PRODUTOS');
    assert.equal(missingStage.pipelineId, 'pipe-enterprise-b2b');
    assert.equal(missingStage.stageId, 'stage-discovery');
    assert.equal(missingStage.usedFallback, 'pipeline-first-stage');

    const defaultPipe: Pipeline = {
      id: 'pipe-fallback-default',
      name: 'Funil padrão de testes',
      isDefault: true,
      currency: 'BRL',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      stages: [
        { id: 'stage-fallback-first', pipelineId: 'pipe-fallback-default', name: 'Primeira etapa', order: 1, defaultProbability: 10, dealRottingDays: 10, isClosed: false, isWon: false },
      ],
    };
    const missingPipe = resolveDealPlacementForProposal([defaultPipe], 'LOCACAO');
    assert.equal(missingPipe.pipelineId, 'pipe-fallback-default');
    assert.equal(missingPipe.stageId, 'stage-fallback-first');
    assert.equal(missingPipe.usedFallback, 'default-pipeline');
  });

  it('POST cria o negócio no funil certo para cada tipo de proposta', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const cases: Array<[string, string, string]> = [
      ['PRODUTOS', sale.pipelineId, sale.stageId],
      ['CONJUNTO', sale.pipelineId, sale.stageId],
      ['LOCACAO', rental.pipelineId, rental.stageId],
      ['SERVICOS', rental.pipelineId, rental.stageId],
    ];
    for (const [index, [budgetType, pipelineId, stageId]] of cases.entries()) {
      const res = await router.dispatch({
        method: 'POST',
        path: '/api/erp/proposals',
        query: session(repo),
        body: {
          title: `Orçamento tipo ${budgetType}`,
          budgetType,
          companyName: `Cliente ${budgetType}`,
          companyCnpj: uniqueCnpj(510 + index),
          contactName: 'Dana Costa',
          contactEmail: `dana.${budgetType.toLowerCase()}@teste.example`,
          totalContractValue: 18000,
          createCrmDeal: true,
        },
      });
      assert.equal(res.status, 201, `${budgetType}: ${JSON.stringify(res.body)}`);
      const deal = (res.body as { crmDeal: { pipelineId: string; stageId: string } }).crmDeal;
      assert.equal(deal.pipelineId, pipelineId, budgetType);
      assert.equal(deal.stageId, stageId, budgetType);
    }
  });

  it('nascer em etapa de proposta não inscreve o follow-up; o envio por e-mail inscreve quando a flag está ligada', async () => {
    assert.equal(isFollowupEnrollStage('pipe-enterprise-b2b', 'stage-proposal'), true);
    assert.equal(isFollowupEnrollStage('pipeline-locacao-equipamentos', 'stage-loc-simulacao'), true);

    const prevFlag = process.env.FOLLOWUP_SEQUENCE_ENABLED;
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.FOLLOWUP_SEQUENCE_ENABLED = 'true';
    process.env.NODE_ENV = 'test';
    try {
      const repo = createInMemoryRepository();
      const router = new CrmApiRouter(repo);
      const res = await router.dispatch({
        method: 'POST',
        path: '/api/erp/proposals',
        query: session(repo),
        body: {
          title: 'Orçamento sem follow-up na criação',
          budgetType: 'PRODUTOS',
          companyName: 'Cliente Follow-up',
          companyCnpj: uniqueCnpj(808),
          contactName: 'Eva Followup',
          contactEmail: 'eva.followup@teste.example',
          totalContractValue: 9000,
          createCrmDeal: true,
        },
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const created = res.body as { data: ErpCommercialProposal; crmDeal: { id: string } };
      assert.equal(repo.getActiveProposalFollowup(created.crmDeal.id) || null, null);

      const send = await router.dispatch({
        method: 'POST',
        path: '/api/communications/send-email',
        query: session(repo),
        body: {
          docType: 'PROPOSAL',
          to: 'eva.followup@teste.example',
          subject: 'Proposta comercial',
          body: 'Segue a proposta.',
          dealId: created.crmDeal.id,
          proposalId: created.data.id,
          contactId: created.data.contactId,
          companyId: created.data.companyId,
        },
      });
      assert.equal(send.status, 200, JSON.stringify(send.body));
      const enrolled = repo.getActiveProposalFollowup(created.crmDeal.id);
      assert.ok(enrolled, 'o envio por e-mail deve inscrever o follow-up');
      assert.equal(enrolled?.status, 'ACTIVE');
      assert.equal(enrolled?.dealId, created.crmDeal.id);
    } finally {
      if (prevFlag === undefined) delete process.env.FOLLOWUP_SEQUENCE_ENABLED;
      else process.env.FOLLOWUP_SEQUENCE_ENABLED = prevFlag;
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
    }
  });
});


describe('t226u CISO B1-B4 escopo e validação no vínculo proposta-negócio', () => {
  const commercial = (repo: CrmRepository, extra: Record<string, unknown> = {}) =>
    session(repo, 'usr-seta-03', {
      enabledModules: ['CRM', 'ERP'],
      moduleAccess: { crm: true, erp: true, chamados: false },
      erpRole: 'ERP_COMMERCIAL',
      ...extra,
    });

  async function sendProposalEmail(
    router: CrmApiRouter,
    query: Record<string, string | undefined>,
    body: Record<string, unknown>
  ) {
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      return await router.dispatch({
        method: 'POST',
        path: '/api/communications/send-email',
        query,
        body: {
          docType: 'PROPOSAL',
          to: 'destinatario.teste@teste.example',
          subject: 'Proposta comercial',
          body: 'Segue a proposta.',
          ...body,
        },
      });
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
    }
  }

  it('B1: só grava histórico e lastEmailSentAt na proposta do escopo, pelo id resolvido; fora do escopo ignora em silêncio', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    const foreign = await router.dispatch({
      method: 'POST',
      path: '/api/erp/proposals',
      query: session(repo),
      body: {
        title: 'Proposta de outro vendedor',
        companyName: 'Cliente Fora do Escopo',
        companyCnpj: uniqueCnpj(701),
        contactName: 'Contato Alheio',
        contactEmail: 'contato.alheio@teste.example',
      },
    });
    assert.equal(foreign.status, 201, JSON.stringify(foreign.body));
    const foreignProp = (foreign.body as { data: ErpCommercialProposal }).data;
    assert.ok(foreignProp.id);
    assert.ok(foreignProp.code);

    const sneak = await sendProposalEmail(router, commercial(repo), {
      proposalId: foreignProp.code,
      dealId: 'deal-inventado-nao-deve-gravar',
    });
    assert.equal(sneak.status, 200, JSON.stringify(sneak.body));
    const afterSneak = repo.listProposals().find((p) => p.id === foreignProp.id);
    assert.equal(afterSneak?.lastEmailSentAt || null, null);
    assert.equal((afterSneak?.emailHistory || []).length, 0);

    const own = await router.dispatch({
      method: 'POST',
      path: '/api/erp/proposals',
      query: commercial(repo),
      body: {
        title: 'Proposta própria para histórico',
        companyName: 'Cliente Do Vendedor',
        companyCnpj: uniqueCnpj(702),
        contactName: 'Contato Próprio',
        contactEmail: 'contato.proprio@teste.example',
      },
    });
    assert.equal(own.status, 201, JSON.stringify(own.body));
    const ownProp = (own.body as { data: ErpCommercialProposal }).data;

    const sent = await sendProposalEmail(router, commercial(repo), {
      proposalId: ownProp.code,
      bcc: 'cco.secreto@teste.example',
    });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    const stored = repo.listProposals().find((p) => p.id === ownProp.id);
    assert.ok(stored?.lastEmailSentAt);
    assert.equal((stored?.emailHistory || []).length, 1);
    const entry = (stored?.emailHistory || [])[0];
    assert.equal('bcc' in entry, false);
    assert.equal(entry.bcc, undefined);
    assert.match(String(entry.to), /destinatario.teste@teste.example/);
  });

  it('B2: o Cco não entra no histórico da proposta nem na leitura exibida', () => {
    const entry: ErpInvoiceEmailHistoryEntry = {
      sentAt: '2026-11-12T13:00:00.000Z',
      to: 'para@teste.example',
      cc: 'copia@teste.example',
      bcc: 'cco.secreto@teste.example',
      subject: 'Proposta',
      protocol: 'STI-MAIL-TESTE',
      actor: 'Maria Luiza',
    };
    const stripped = withoutEmailHistoryBcc(entry);
    assert.equal('bcc' in stripped, false);
    assert.equal((stripped as { bcc?: string }).bcc, undefined);
    const list = withoutEmailHistoryBccList([entry]);
    assert.equal(list.length, 1);
    assert.equal('bcc' in list[0], false);
    const label = emailHistoryRecipientsLabel(entry);
    assert.equal(label.includes('cco.secreto@teste.example'), false);
    assert.match(label, /para@teste.example/);
  });

  it('B3: só inscreve o follow-up com a proposta do escopo, deal vinculado, módulo CRM e escopo do negócio', async () => {
    const prevFlag = process.env.FOLLOWUP_SEQUENCE_ENABLED;
    process.env.FOLLOWUP_SEQUENCE_ENABLED = 'true';
    try {
      const repo = createInMemoryRepository();
      const router = new CrmApiRouter(repo);

      const foreign = await router.dispatch({
        method: 'POST',
        path: '/api/erp/proposals',
        query: session(repo),
        body: {
          title: 'Proposta alheia com negócio',
          companyName: 'Cliente Alheio FUP',
          companyCnpj: uniqueCnpj(711),
          contactName: 'Eva Alheia',
          contactEmail: 'eva.alheia.fup@teste.example',
          createCrmDeal: true,
        },
      });
      assert.equal(foreign.status, 201, JSON.stringify(foreign.body));
      const foreignBody = foreign.body as { data: ErpCommercialProposal; crmDeal: { id: string } };
      assert.ok(foreignBody.crmDeal.id);

      const sneak = await sendProposalEmail(router, commercial(repo), {
        proposalId: foreignBody.data.id,
        dealId: foreignBody.crmDeal.id,
      });
      assert.equal(sneak.status, 200, JSON.stringify(sneak.body));
      assert.equal(repo.getActiveProposalFollowup(foreignBody.crmDeal.id) || null, null);

      const own = await router.dispatch({
        method: 'POST',
        path: '/api/erp/proposals',
        query: commercial(repo),
        body: {
          title: 'Proposta própria com negócio',
          companyName: 'Cliente Próprio FUP',
          companyCnpj: uniqueCnpj(712),
          contactName: 'Eva Própria',
          contactEmail: 'eva.propria.fup@teste.example',
          createCrmDeal: true,
        },
      });
      assert.equal(own.status, 201, JSON.stringify(own.body));
      const ownBody = own.body as { data: ErpCommercialProposal; crmDeal: { id: string } };
      assert.ok(ownBody.crmDeal.id);
      assert.equal(repo.getActiveProposalFollowup(ownBody.crmDeal.id) || null, null);

      const outsiderDeal = repo.createDeal({
        title: 'Negócio de outra pessoa',
        value: 1000,
        ownerId: 'usr-seta-01',
        ownerName: 'Marcelo Lopes Mira',
      });
      const unlinked = await sendProposalEmail(router, commercial(repo), {
        proposalId: ownBody.data.id,
        dealId: outsiderDeal.id,
      });
      assert.equal(unlinked.status, 200, JSON.stringify(unlinked.body));
      assert.equal(repo.getActiveProposalFollowup(outsiderDeal.id) || null, null);
      // o deal vinculado e visível ao vendedor ainda pode ser inscrito se o corpo apontar só o deal errado?
      // B3 exige vínculo com a proposta do B1; o deal do corpo não está vinculado, então não inscreve ninguém.
      assert.equal(repo.getActiveProposalFollowup(ownBody.crmDeal.id) || null, null);

      const noCrm = await sendProposalEmail(
        router,
        commercial(repo, {
          enabledModules: ['ERP'],
          moduleAccess: { crm: false, erp: true, chamados: false },
        }),
        { proposalId: ownBody.data.id, dealId: ownBody.crmDeal.id }
      );
      assert.equal(noCrm.status, 200, JSON.stringify(noCrm.body));
      assert.equal(repo.getActiveProposalFollowup(ownBody.crmDeal.id) || null, null);

      const ok = await sendProposalEmail(router, commercial(repo), {
        proposalId: ownBody.data.id,
        dealId: ownBody.crmDeal.id,
      });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      const enrolled = repo.getActiveProposalFollowup(ownBody.crmDeal.id);
      assert.ok(enrolled, 'envio no escopo, com CRM e deal vinculado, deve inscrever');
      assert.equal(enrolled?.status, 'ACTIVE');
      assert.equal(enrolled?.dealId, ownBody.crmDeal.id);
    } finally {
      if (prevFlag === undefined) delete process.env.FOLLOWUP_SEQUENCE_ENABLED;
      else process.env.FOLLOWUP_SEQUENCE_ENABLED = prevFlag;
    }
  });

  it('B4: fallback por nome não pega contato de outra empresa; sem visibilidade não copia CNPJ nem e-mail', async () => {
    const repo = createInMemoryRepository();
    const companyA = repo.createCompany({ name: 'Empresa A Visível' });
    const companyB = repo.createCompany({ name: 'Empresa B Secreta', cnpj: uniqueCnpj(801) });
    const leaked = repo.createContact({
      firstName: 'Ana',
      lastName: 'Souza',
      email: 'ana.vazamento@outra-empresa.example',
      companyId: companyB.id,
      ownerId: 'usr-seta-01',
    });

    const byNameWrongCompany = findContactForProposal(repo.listContacts(), {
      contactName: 'Ana Souza',
      companyId: companyA.id,
    });
    assert.equal(byNameWrongCompany, undefined);

    const byNameNoCompany = findContactForProposal(repo.listContacts(), {
      contactName: 'Ana Souza',
    });
    assert.equal(byNameNoCompany, undefined);

    const byNameSameCompany = findContactForProposal(repo.listContacts(), {
      contactName: 'Ana Souza',
      companyId: companyB.id,
    });
    assert.equal(byNameSameCompany?.id, leaked.id);

    const secretCnpj = uniqueCnpj(802);
    const secretEmail = 'contato.oculto@empresa-secreta.example';
    const hiddenCompany = repo.createCompany({
      name: 'Empresa Oculta LTDA',
      cnpj: secretCnpj,
    });
    const hiddenContact = repo.createContact({
      firstName: 'Zeta',
      lastName: 'Oculto',
      email: secretEmail,
      companyId: hiddenCompany.id,
      ownerId: 'usr-seta-01',
    });

    const router = new CrmApiRouter(repo);
    const created = await router.dispatch({
      method: 'POST',
      path: '/api/erp/proposals',
      query: commercial(repo),
      body: {
        title: 'Orçamento reaproveita ids fora do escopo',
        companyName: 'Cliente Sem PII Copiada',
        companyId: hiddenCompany.id,
        contactId: hiddenContact.id,
        contactName: 'Zeta Oculto',
        createCrmDeal: true,
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const prop = (created.body as { data: ErpCommercialProposal }).data;
    assert.notEqual(prop.companyCnpj, secretCnpj);
    assert.equal(String(prop.companyCnpj || '').includes(secretCnpj.replace(/\D+/g, '')), false);
    assert.notEqual(String(prop.contactEmail || '').toLowerCase(), secretEmail);
    assert.equal(String(prop.contactEmail || '').toLowerCase().includes('contato.oculto@empresa-secreta.example'), false);

    const direct = linkProposalToCrmDeal(
      repo,
      repo.createProposal({
        title: 'Vínculo direto sem visibilidade',
        companyName: 'Cliente Direto',
        companyId: hiddenCompany.id,
        contactId: hiddenContact.id,
        contactName: 'Zeta Oculto',
        totalContractValue: 5000,
      }),
      {
        visibility: {
          canSeeCompany: () => false,
          canSeeContact: () => false,
        },
      }
    );
    assert.notEqual(direct.proposal.companyCnpj, secretCnpj);
    assert.notEqual(String(direct.proposal.contactEmail || '').toLowerCase(), secretEmail);
  });
});
