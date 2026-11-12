import type { Company, Contact, Deal, ErpCommercialProposal } from '../../db/types';
import type { ClientEmailInitialPayload } from '../components/ClientEmailComposerModal';
import { resolveDealLinkedProposal } from '../../modules/deals/proposal-deal-link';

export function buildProposalCrmEmailPayload(input: {
  proposal: ErpCommercialProposal;
  deal?: Pick<Deal, 'id' | 'value' | 'companyId' | 'contactId'> | null;
  contact?: Pick<Contact, 'id' | 'email' | 'firstName' | 'lastName'> | null;
  company?: Pick<Company, 'id' | 'name' | 'cnpj'> | null;
}): ClientEmailInitialPayload {
  const { proposal, deal, contact, company } = input;
  const contactName =
    (contact ? `${contact.firstName} ${contact.lastName}`.trim() : '') ||
    proposal.contactName ||
    proposal.careOf ||
    proposal.companyName;
  return {
    docType: 'PROPOSAL',
    recipientEmail: contact?.email || proposal.contactEmail || undefined,
    recipientName: contactName,
    companyName: company?.name || proposal.companyName,
    companyCnpj: company?.cnpj || proposal.companyCnpj || undefined,
    documentCode: proposal.code,
    amountBrl: proposal.totalContractValue || deal?.value,
    dealId: deal?.id || proposal.dealId,
    contactId: contact?.id || proposal.contactId,
    companyId: company?.id || proposal.companyId,
    proposalId: proposal.id,
  };
}

export function buildDealProposalEmailPayload(
  deal: Deal & { contact?: Contact | null; company?: Company | null },
  proposals: ErpCommercialProposal[]
): ClientEmailInitialPayload | null {
  const proposal = resolveDealLinkedProposal(deal, proposals);
  if (!proposal) return null;
  return buildProposalCrmEmailPayload({
    proposal,
    deal,
    contact: deal.contact || null,
    company: deal.company || null,
  });
}
