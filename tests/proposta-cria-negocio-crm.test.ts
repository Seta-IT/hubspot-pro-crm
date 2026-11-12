import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { CrmApiRouter } from '../src/api/router';
import { createInMemoryRepository, type CrmRepository } from '../src/db/repository';
import {
  findCompanyForProposal,
  findContactForProposal,
  linkProposalToCrmDeal,
  wantsCreateCrmDeal,
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
