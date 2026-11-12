/**
 * Cria (ou reaproveita) um negócio do CRM a partir de um orçamento/proposta do ERP.
 * A ligação é idempotente: salvar de novo não duplica o deal, a empresa nem o contato.
 * Este módulo é só de servidor (usa o repositório).
 */
import type { Company, Contact, Deal, ErpCommercialProposal } from '../../db/types';
import type { CrmRepository } from '../../db/repository';
import {
  dealLinkedProposalId,
  documentDigits,
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

/** Visibilidade no mesmo escopo das rotas de empresa e contato. Sem predicado, assume visível. */
export type CrmRecordVisibility = {
  canSeeCompany?: (companyId: string) => boolean;
  canSeeContact?: (contactId: string) => boolean;
};

function isVisible(
  check: ((id: string) => boolean) | undefined,
  id: string | null | undefined
): boolean {
  if (!id) return false;
  return !check || check(id);
}

function attachmentFieldsForProposal(
  proposal: ErpCommercialProposal,
  company: Company,
  contact: Contact | null,
  visibility?: CrmRecordVisibility
): {
  companyId: string;
  contactId: string | undefined;
  companyName: string;
  companyCnpj: string | null | undefined;
  contactName: string | undefined;
  contactEmail: string | undefined;
} {
  const seeCompany = isVisible(visibility?.canSeeCompany, company.id);
  const seeContact = Boolean(contact) && isVisible(visibility?.canSeeContact, contact?.id);
  const sameCnpj =
    Boolean(documentDigits(proposal.companyCnpj)) &&
    documentDigits(proposal.companyCnpj) === documentDigits(company.cnpj);
  const sameEmail =
    Boolean(contact) &&
    String(proposal.contactEmail || '').trim().toLowerCase() !== '' &&
    String(proposal.contactEmail || '').trim().toLowerCase() === String(contact?.email || '').trim().toLowerCase();
  return {
    companyId: company.id,
    contactId: contact?.id || proposal.contactId || undefined,
    companyName: company.name,
    companyCnpj: seeCompany
      ? company.cnpj || proposal.companyCnpj || undefined
      : sameCnpj
        ? ''
        : proposal.companyCnpj || undefined,
    contactName: contact
      ? `${contact.firstName} ${contact.lastName}`.trim()
      : proposal.contactName,
    contactEmail: seeContact
      ? contact?.email || proposal.contactEmail || undefined
      : sameEmail
        ? ''
        : proposal.contactEmail || undefined,
  };
}

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
  options?: { actorName?: string; visibility?: CrmRecordVisibility }
): LinkProposalToCrmDealResult {
  const reusedCompanyId = String(proposal.companyId || '').trim();
  const reusedContactId = String(proposal.contactId || '').trim();
  const sawReusedCompany = !reusedCompanyId || isVisible(options?.visibility?.canSeeCompany, reusedCompanyId);
  const sawReusedContact = !reusedContactId || isVisible(options?.visibility?.canSeeContact, reusedContactId);
  const visibility: CrmRecordVisibility = {
    canSeeCompany: (id) => (reusedCompanyId && id === reusedCompanyId ? sawReusedCompany : true),
    canSeeContact: (id) => (reusedContactId && id === reusedContactId ? sawReusedContact : true),
  };
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
        ...attachmentFieldsForProposal(proposal, companyRes.company, contactRes.contact, visibility),
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
      ...attachmentFieldsForProposal(proposal, companyRes.company, contactRes.contact, visibility),
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
