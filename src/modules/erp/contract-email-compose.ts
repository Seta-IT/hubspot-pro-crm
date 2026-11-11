/** Anexos do e-mail disparado a partir de um contrato (recibo, boleto, proposta, Pix e NF). */

import {
  resolveInvoiceSendAttachments,
  type InvoiceSendAttachmentAvailability,
  type InvoiceAttachmentSources,
  type RemessaDocumentLike,
} from './invoice-send-attachments';
import { isIssuedInvoiceStatus } from './invoice-send-attachments';

export const CONTRACT_EMAIL_ATTACHMENT_KINDS = ['receipt', 'boleto', 'proposal', 'pix', 'remessa'] as const;
export type ContractEmailAttachmentKind = (typeof CONTRACT_EMAIL_ATTACHMENT_KINDS)[number];

export const CONTRACT_EMAIL_ATTACHMENT_LABELS: Record<ContractEmailAttachmentKind, string> = {
  receipt: 'Recibo',
  boleto: 'Boleto',
  proposal: 'Proposta',
  pix: 'QR Code Pix',
  remessa: 'NF',
};

export type ContractAttachmentState = Record<ContractEmailAttachmentKind, boolean>;

export type ContractAttachmentAvailability = Record<
  ContractEmailAttachmentKind,
  { available: boolean; reason: string }
>;

export type ContractEmailInvoiceChoice = {
  id: string;
  documentNumber: string;
  competenceMonth: string;
  dueDate: string;
  netAmount: number;
  label: string;
  invoiceAttachments: InvoiceSendAttachmentAvailability;
  boletoLine?: string;
  pixCode?: string;
  remessaNfeNumber?: string;
  remessaAccessKey?: string;
};

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function isChargeIssuedInvoice(inv: { documentType?: string | null; status?: unknown }): boolean {
  if (!isIssuedInvoiceStatus(inv.status)) return false;
  const type = String(inv.documentType || '');
  return type !== 'NFE_REMESSA_LOCACAO' && type !== 'NFE_RETORNO_LOCACAO' && type !== 'NFE_IMPORTACAO';
}

export function resolveLinkedProposalId(input: {
  proposalId?: string | null;
  proposalNumber?: string | null;
}): string {
  return clean(input.proposalId) || clean(input.proposalNumber);
}

export function resolveContractEmailAttachments(input: {
  proposalId?: string | null;
  proposalNumber?: string | null;
  invoice?: InvoiceAttachmentSources | null;
  contract?: {
    remessaNfeNumber?: string | null;
    remessaNfeKey?: string | null;
    proposalId?: string | null;
    proposalNumber?: string | null;
  } | null;
  remessaDocs?: RemessaDocumentLike[];
}): {
  options: ContractAttachmentAvailability;
  invoiceAvail: InvoiceSendAttachmentAvailability | null;
  linkedProposalId: string;
} {
  const linkedProposalId = resolveLinkedProposalId({
    proposalId: input.proposalId || input.contract?.proposalId,
    proposalNumber: input.proposalNumber || input.contract?.proposalNumber,
  });
  const invoice = input.invoice || null;
  const invoiceAvail = invoice
    ? resolveInvoiceSendAttachments(invoice, input.contract, input.remessaDocs || [])
    : null;
  const remessaFromDocs = (input.remessaDocs || []).some((doc) => {
    if (doc.documentType !== 'NFE_REMESSA_LOCACAO') return false;
    return Boolean(clean(doc.xmlContent) || clean(doc.documentNumber) || clean(doc.verificationCodeOrKey));
  });
  const remessaAvailable = Boolean(invoiceAvail?.remessa.available) || (!invoice && remessaFromDocs);
  return {
    linkedProposalId,
    invoiceAvail,
    options: {
      receipt: {
        available: Boolean(invoiceAvail?.receipt.available),
        reason: invoice ? '' : 'Sem fatura emitida',
      },
      boleto: {
        available: Boolean(invoiceAvail?.boleto.available),
        reason: invoice ? 'Sem linha digitável' : 'Sem fatura emitida',
      },
      proposal: {
        available: Boolean(linkedProposalId),
        reason: 'Sem proposta vinculada',
      },
      pix: {
        available: Boolean(invoiceAvail?.pix.available),
        reason: invoice ? 'Sem código Pix' : 'Sem fatura emitida',
      },
      remessa: {
        available: remessaAvailable,
        reason: remessaAvailable ? '' : 'Sem NF/XML/DANFE',
      },
    },
  };
}

export function defaultSelectedContractAttachments(
  options: ContractAttachmentAvailability
): ContractAttachmentState {
  return {
    receipt: options.receipt.available,
    boleto: options.boleto.available,
    proposal: options.proposal.available,
    pix: options.pix.available,
    remessa: options.remessa.available,
  };
}

export function selectedInvoiceAttachmentKinds(selected: ContractAttachmentState): Array<'receipt' | 'remessa' | 'boleto' | 'pix'> {
  const kinds: Array<'receipt' | 'remessa' | 'boleto' | 'pix'> = [];
  if (selected.receipt) kinds.push('receipt');
  if (selected.remessa) kinds.push('remessa');
  if (selected.boleto) kinds.push('boleto');
  if (selected.pix) kinds.push('pix');
  return kinds;
}

export function contractEmailNeedsInvoice(selected: ContractAttachmentState): boolean {
  return Boolean(selected.receipt || selected.boleto || selected.pix || selected.remessa);
}

export function contractEmailWantsProposalLink(selected: Pick<ContractAttachmentState, 'proposal'>, proposalId?: string | null): boolean {
  return Boolean(selected.proposal && clean(proposalId));
}

export function formatInvoiceChoiceLabel(inv: {
  documentNumber?: string | null;
  competenceMonth?: string | null;
  netAmount?: number | null;
}): string {
  const amount =
    typeof inv.netAmount === 'number'
      ? inv.netAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      : '';
  return [clean(inv.documentNumber), clean(inv.competenceMonth), amount].filter(Boolean).join(' · ');
}
