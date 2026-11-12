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
  company: Company | null;
  contact: Contact | null;
  created: boolean;
  companyCreated: boolean;
  contactCreated: boolean;
  warnings: string[];
};

export const CRM_DEAL_COMPANY_HIDDEN_WARNING =
  'Empresa já cadastrada para outro responsável; negócio criado sem vínculo de empresa.';
export const CRM_DEAL_CONTACT_HIDDEN_WARNING =
  'Contato já cadastrado para outro responsável; negócio criado sem vínculo de contato.';
export const CRM_DEAL_HIDDEN_WARNING =
  'Já existe um negócio vinculado a esta proposta fora do seu escopo; o vínculo foi mantido sem criar outro.';

/**
 * Visibilidade no mesmo escopo das rotas de empresa e contato.
 * Sem predicado (chamada interna / testes sem sessão), o padrão é o mesmo do roteador
 * para contexto interno e para quem tem escopo TODOS: tudo visível.
 */
export type CrmRecordVisibility = {
  canSeeCompany?: (companyId: string) => boolean;
  canSeeContact?: (contactId: string) => boolean;
  canSeeDeal?: (dealId: string) => boolean;
};

function isVisible(
  check: ((id: string) => boolean) | undefined,
  id: string | null | undefined
): boolean {
  if (!id) return false;
  return !check || check(id);
}


function stripPiiMatchingHiddenRecords(
  proposal: ErpCommercialProposal,
  repo: CrmRepository,
  hiddenCompanyId?: string,
  hiddenContactId?: string
): ErpCommercialProposal {
  const next: ErpCommercialProposal = { ...proposal };
  const digits = (v: unknown) => String(v || '').replace(/\D+/g, '');
  if (hiddenCompanyId) {
    next.companyId = null;
    const hidden = repo.getCompanyById(hiddenCompanyId);
    if (hidden && digits(next.companyCnpj) && digits(next.companyCnpj) === digits(hidden.cnpj)) {
      next.companyCnpj = '';
    }
  }
  if (hiddenContactId) {
    next.contactId = null;
    const hidden = repo.getContactById(hiddenContactId);
    const left = String(next.contactEmail || '').trim().toLowerCase();
    const right = String(hidden?.email || '').trim().toLowerCase();
    if (left && left === right) next.contactEmail = '';
  }
  return next;
}

type ResolveCompanyForProposalResult = {
  company: Company | null;
  created: boolean;
  warning?: string;
  /** Só para detectar contato correspondente; nunca vai para a resposta nem para o deal. */
  matchedHiddenId?: string;
};

type ResolveContactForProposalResult = {
  contact: Contact | null;
  created: boolean;
  warning?: string;
  /** Só para redigir PII; nunca vai para a resposta nem para o deal. */
  matchedHiddenId?: string;
};

function attachmentFieldsForProposal(
  proposal: ErpCommercialProposal,
  company: Company | null,
  contact: Contact | null,
  visibility?: CrmRecordVisibility
): {
  companyId: string | null;
  contactId: string | null;
  companyName: string | undefined;
  companyCnpj: string | null | undefined;
  contactName: string | undefined;
  contactEmail: string | undefined;
} {
  const seeCompany = Boolean(company) && isVisible(visibility?.canSeeCompany, company?.id);
  const seeContact = Boolean(contact) && isVisible(visibility?.canSeeContact, contact?.id);
  return {
    companyId: seeCompany && company ? company.id : null,
    contactId: seeContact && contact ? contact.id : null,
    companyName: seeCompany && company ? company.name : proposal.companyName,
    companyCnpj:
      seeCompany && company
        ? company.cnpj || proposal.companyCnpj || undefined
        : proposal.companyCnpj ?? '',
    contactName:
      seeContact && contact
        ? `${contact.firstName} ${contact.lastName}`.trim()
        : proposal.contactName,
    contactEmail:
      seeContact && contact
        ? contact.email || proposal.contactEmail || undefined
        : proposal.contactEmail ?? '',
  };
}

function findExistingDeal(repo: CrmRepository, proposal: ErpCommercialProposal): Deal | undefined {
  if (proposal.dealId) {
    const byId = repo.getDealById(proposal.dealId);
    if (byId) return byId;
  }
  const byProposal = repo.findDealByProposalId(proposal.id);
  if (byProposal) return byProposal;
  return repo.listDeals().find((d) => dealLinkedProposalId(d) === proposal.id);
}

function redactHiddenDeal(deal: Deal): Deal {
  return {
    ...deal,
    companyId: null,
    contactId: null,
    ownerId: null,
    ownerName: undefined,
    customProperties: deal.proposalId ? { proposalId: deal.proposalId } : {},
  };
}

function bindExistingDealToProposal(
  repo: CrmRepository,
  proposal: ErpCommercialProposal,
  existingDeal: Deal,
  companyRes: ResolveCompanyForProposalResult,
  contactRes: ResolveContactForProposalResult,
  proposalForLink: ErpCommercialProposal,
  visibility: CrmRecordVisibility,
  warnings: string[]
): LinkProposalToCrmDealResult {
  const dealVisible = isVisible(visibility.canSeeDeal, existingDeal.id);
  const nextWarnings = dealVisible ? warnings : [...warnings, CRM_DEAL_HIDDEN_WARNING];
  const patch: Partial<Deal> = {
    proposalId: proposal.id,
    customProperties: {
      ...(existingDeal.customProperties || {}),
      proposalId: proposal.id,
    },
  };
  if (dealVisible) {
    if (!existingDeal.companyId && companyRes.company) patch.companyId = companyRes.company.id;
    if (!existingDeal.contactId && contactRes.contact) patch.contactId = contactRes.contact.id;
  }
  const deal = repo.updateDeal(existingDeal.id, patch) || existingDeal;
  const linked =
    repo.attachCrmDealToProposal(proposal.id, {
      dealId: deal.id,
      ...attachmentFieldsForProposal(proposalForLink, companyRes.company, contactRes.contact, visibility),
    }) || proposal;
  return {
    proposal: linked,
    deal: dealVisible ? deal : redactHiddenDeal(deal),
    company: companyRes.company,
    contact: contactRes.contact,
    created: false,
    companyCreated: companyRes.created,
    contactCreated: contactRes.created,
    warnings: nextWarnings,
  };
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
  proposal: ErpCommercialProposal,
  visibility?: CrmRecordVisibility
): ResolveCompanyForProposalResult {
  const placeholderCnpj = documentDigits('18.236.120/0001-58');
  const providedDigits = documentDigits(proposal.companyCnpj);
  const existing = findCompanyForProposal(repo.listCompanies(), {
    companyId: proposal.companyId,
    companyCnpj: providedDigits && providedDigits !== placeholderCnpj ? proposal.companyCnpj : undefined,
    companyName: proposal.companyName,
  });
  if (existing) {
    if (isVisible(visibility?.canSeeCompany, existing.id)) {
      return { company: existing, created: false };
    }
    return {
      company: null,
      created: false,
      warning: CRM_DEAL_COMPANY_HIDDEN_WARNING,
      matchedHiddenId: existing.id,
    };
  }
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
  company: Company | null,
  visibility?: CrmRecordVisibility,
  hiddenCompanyId?: string
): ResolveContactForProposalResult {
  const name = String(proposal.contactName || proposal.careOf || '').trim();
  const email = String(proposal.contactEmail || '').trim();
  const contacts = repo.listContacts();
  let existing = findContactForProposal(contacts, {
    contactId: proposal.contactId,
    contactEmail: email,
    contactName: name,
    companyId: company?.id,
  });
  if (!existing && hiddenCompanyId) {
    existing = findContactForProposal(contacts, {
      contactEmail: email,
      contactName: name,
      companyId: hiddenCompanyId,
    });
  }
  if (existing) {
    if (isVisible(visibility?.canSeeContact, existing.id)) {
      if (company && !existing.companyId) {
        const updated = repo.updateContact(existing.id, { companyId: company.id });
        return { contact: updated || existing, created: false };
      }
      return { contact: existing, created: false };
    }
    return { contact: null, created: false, warning: CRM_DEAL_CONTACT_HIDDEN_WARNING, matchedHiddenId: existing.id };
  }
  if (!name && !email) return { contact: null, created: false };
  if (!company) return { contact: null, created: false };
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
  // Para todo id: a mesma regra do roteador (canSee*). Sem função, tudo visível (interno / TODOS).
  const visibility: CrmRecordVisibility = {
    canSeeCompany: (id) => isVisible(options?.visibility?.canSeeCompany, id),
    canSeeContact: (id) => isVisible(options?.visibility?.canSeeContact, id),
    canSeeDeal: (id) => isVisible(options?.visibility?.canSeeDeal, id),
  };
  const companyRes = resolveOrCreateCompanyForProposal(repo, proposal, visibility);
  const contactRes = resolveOrCreateContactForProposal(
    repo,
    proposal,
    companyRes.company,
    visibility,
    companyRes.matchedHiddenId
  );
  const warnings = [companyRes.warning, contactRes.warning].filter((w): w is string => Boolean(w));
  const proposalForLink = stripPiiMatchingHiddenRecords(
    proposal,
    repo,
    companyRes.matchedHiddenId,
    contactRes.matchedHiddenId
  );
  const existingDeal = findExistingDeal(repo, proposal);

  if (existingDeal) {
    return bindExistingDealToProposal(
      repo,
      proposal,
      existingDeal,
      companyRes,
      contactRes,
      proposalForLink,
      visibility,
      warnings
    );
  }

  const owner = resolveOwner(repo, proposal);
  const value = proposalDealValue(proposal);
  // Confere o funil/etapa em listPipelines. Não chama updateDeal com troca de etapa
  // para não inscrever o follow-up automático: a proposta ainda não foi enviada.
  const placement = resolveDealPlacementForProposal(repo.listPipelines(), proposal.budgetType);
  const createdDeal = repo.getOrCreateDealForProposal(proposal.id, {
    title: String(proposal.title || proposal.code || 'Proposta comercial').trim(),
    value,
    mrr: Number(proposal.monthlyRecurringTotal || 0) || undefined,
    contractMonths: Number(proposal.contractMonths || 24),
    tcv: value,
    pipelineId: placement.pipelineId,
    stageId: placement.stageId,
    companyId: companyRes.company?.id || null,
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

  if (!createdDeal.created) {
    return bindExistingDealToProposal(
      repo,
      proposal,
      createdDeal.deal,
      companyRes,
      contactRes,
      proposalForLink,
      visibility,
      warnings
    );
  }

  const deal = createdDeal.deal;

  if (options?.actorName) {
    try {
      repo.createTimelineEvent({
        type: 'NOTE',
        title: 'Negócio criado a partir da proposta do ERP',
        body: `Proposta ${proposal.code || proposal.id} vinculada automaticamente ao CRM.`,
        contactId: contactRes.contact?.id || null,
        companyId: companyRes.company?.id || null,
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
      ...attachmentFieldsForProposal(proposalForLink, companyRes.company, contactRes.contact, visibility),
    }) || proposal;

  return {
    proposal: linked,
    deal,
    company: companyRes.company,
    contact: contactRes.contact,
    created: true,
    companyCreated: companyRes.created,
    contactCreated: contactRes.created,
    warnings,
  };
}
