/**
 * Cria (ou reaproveita) um negócio do CRM a partir de um orçamento/proposta do ERP.
 * A ligação é idempotente: salvar de novo não duplica o deal, a empresa nem o contato.
 * Este módulo é só de servidor (usa o repositório).
 */
import type { Company, Contact, Deal, ErpCommercialProposal } from '../../db/types';
import type { CrmRepository } from '../../db/repository';
import {
  dealLinkedProposalId,
  findCompanyForProposal,
  findContactForProposal,
  proposalDealValue,
  resolveDealPlacementForProposal,
  splitPersonName,
} from './proposal-deal-link';

export {
  wantsCreateCrmDeal,
  documentDigits,
  dealLinkedProposalId,
  findCompanyForProposal,
  findContactForProposal,
  splitPersonName,
  proposalDealValue,
  resolveDealLinkedProposal,
  preferredDealPlacementForBudgetType,
  resolveDealPlacementForProposal,
  funnelLabelForBudgetType,
} from './proposal-deal-link';

export type LinkProposalToCrmDealResult = {
  proposal: ErpCommercialProposal;
  deal: Deal;
  company: Company;
  contact: Contact | null;
  created: boolean;
  companyCreated: boolean;
  contactCreated: boolean;
};

function findExistingDeal(repo: CrmRepository, proposal: ErpCommercialProposal): Deal | undefined {
  if (proposal.dealId) {
    const byId = repo.getDealById(proposal.dealId);
    if (byId) return byId;
  }
  return repo.listDeals().find((d) => dealLinkedProposalId(d) === proposal.id);
}

function resolveOwner(
  repo: CrmRepository,
  proposal: ErpCommercialProposal
): { ownerId?: string; ownerName: string } {
  const email = String(proposal.sellerEmail || '').trim();
  const rec = email ? repo.findRbacUserRecord('', email) : undefined;
  const ownerName = (rec?.name || proposal.sellerName || 'Marcelo Lopes Mira').trim();
  return { ownerId: rec?.id, ownerName };
}

export function resolveOrCreateCompanyForProposal(
  repo: CrmRepository,
  proposal: ErpCommercialProposal
): { company: Company; created: boolean } {
  const existing = findCompanyForProposal(repo.listCompanies(), {
    companyId: proposal.companyId,
    companyCnpj: proposal.companyCnpj,
    companyName: proposal.companyName,
  });
  if (existing) return { company: existing, created: false };
  const name = String(proposal.companyName || '').trim() || 'Empresa Cliente B2B';
  const company = repo.createCompany({
    name,
    cnpj: proposal.companyCnpj || null,
  });
  return { company, created: true };
}

export function resolveOrCreateContactForProposal(
  repo: CrmRepository,
  proposal: ErpCommercialProposal,
  company: Company
): { contact: Contact | null; created: boolean } {
  const name = String(proposal.contactName || proposal.careOf || '').trim();
  const email = String(proposal.contactEmail || '').trim();
  const existing = findContactForProposal(repo.listContacts(), {
    contactId: proposal.contactId,
    contactEmail: email,
    contactName: name,
    companyId: company.id,
  });
  if (existing) {
    if (!existing.companyId) {
      const updated = repo.updateContact(existing.id, { companyId: company.id });
      return { contact: updated || existing, created: false };
    }
    return { contact: existing, created: false };
  }
  if (!name && !email) return { contact: null, created: false };
  const parts = splitPersonName(name || email.split('@')[0]);
  const contact = repo.createContact({
    firstName: parts.firstName,
    lastName: parts.lastName,
    email: email || undefined,
    companyId: company.id,
    companyName: company.name,
  });
  return { contact, created: true };
}

/**
 * Garante empresa, contato e negócio ligados à proposta, sem duplicar.
 * Se a proposta já tiver dealId (ou o deal já apontar para ela), devolve o existente.
 */
export function linkProposalToCrmDeal(
  repo: CrmRepository,
  proposal: ErpCommercialProposal,
  options?: { actorName?: string }
): LinkProposalToCrmDealResult {
  const companyRes = resolveOrCreateCompanyForProposal(repo, proposal);
  const contactRes = resolveOrCreateContactForProposal(repo, proposal, companyRes.company);
  const existingDeal = findExistingDeal(repo, proposal);

  if (existingDeal) {
    const patch: Partial<Deal> = {
      proposalId: proposal.id,
      customProperties: {
        ...(existingDeal.customProperties || {}),
        proposalId: proposal.id,
      },
    };
    if (!existingDeal.companyId) patch.companyId = companyRes.company.id;
    if (!existingDeal.contactId && contactRes.contact) patch.contactId = contactRes.contact.id;
    const deal = repo.updateDeal(existingDeal.id, patch) || existingDeal;
    const linked =
      repo.attachCrmDealToProposal(proposal.id, {
        dealId: deal.id,
        companyId: companyRes.company.id,
        contactId: contactRes.contact?.id || proposal.contactId,
        companyName: companyRes.company.name,
        companyCnpj: companyRes.company.cnpj || proposal.companyCnpj,
        contactName: contactRes.contact
          ? `${contactRes.contact.firstName} ${contactRes.contact.lastName}`.trim()
          : proposal.contactName,
        contactEmail: contactRes.contact?.email || proposal.contactEmail,
      }) || proposal;
    return {
      proposal: linked,
      deal,
      company: companyRes.company,
      contact: contactRes.contact,
      created: false,
      companyCreated: companyRes.created,
      contactCreated: contactRes.created,
    };
  }

  const owner = resolveOwner(repo, proposal);
  const value = proposalDealValue(proposal);
  // Confere o funil/etapa em listPipelines. Não chama updateDeal com troca de etapa
  // para não inscrever o follow-up automático: a proposta ainda não foi enviada.
  const placement = resolveDealPlacementForProposal(repo.listPipelines(), proposal.budgetType);
  const deal = repo.createDeal({
    title: String(proposal.title || proposal.code || 'Proposta comercial').trim(),
    value,
    mrr: Number(proposal.monthlyRecurringTotal || 0) || undefined,
    contractMonths: Number(proposal.contractMonths || 24),
    tcv: value,
    pipelineId: placement.pipelineId,
    stageId: placement.stageId,
    companyId: companyRes.company.id,
    contactId: contactRes.contact?.id || null,
    ownerId: owner.ownerId,
    ownerName: owner.ownerName,
    expectedCloseDate: proposal.validUntil || null,
    proposalId: proposal.id,
    customProperties: {
      proposalId: proposal.id,
      proposalCode: proposal.code,
      source: 'ERP_PROPOSAL',
    },
  });

  if (options?.actorName) {
    try {
      repo.createTimelineEvent({
        type: 'NOTE',
        title: 'Negócio criado a partir da proposta do ERP',
        body: `Proposta ${proposal.code || proposal.id} vinculada automaticamente ao CRM.`,
        contactId: contactRes.contact?.id || null,
        companyId: companyRes.company.id,
        dealId: deal.id,
        actor: options.actorName,
        metadata: { proposalId: proposal.id, proposalCode: proposal.code },
      });
    } catch {
      // o histórico não impede a criação do negócio
    }
  }

  const linked =
    repo.attachCrmDealToProposal(proposal.id, {
      dealId: deal.id,
      companyId: companyRes.company.id,
      contactId: contactRes.contact?.id || proposal.contactId,
      companyName: companyRes.company.name,
      companyCnpj: companyRes.company.cnpj || proposal.companyCnpj,
      contactName: contactRes.contact
        ? `${contactRes.contact.firstName} ${contactRes.contact.lastName}`.trim()
        : proposal.contactName,
      contactEmail: contactRes.contact?.email || proposal.contactEmail,
    }) || proposal;

  return {
    proposal: linked,
    deal,
    company: companyRes.company,
    contact: contactRes.contact,
    created: true,
    companyCreated: companyRes.created,
    contactCreated: contactRes.created,
  };
}
