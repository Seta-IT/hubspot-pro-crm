import type { ErpFiscalInvoice, ErpRentalContract } from '../../db/types';
import {
  resolveInvoiceSendAttachments,
  type InvoiceSendAttachmentAvailability,
} from '../../modules/erp/invoice-send-attachments';
import { buildStandaloneInvoiceHtml } from './contract-billing-utils';
import { defaultIssuerAddressLine } from './company-issuer-address';
import type { ClientEmailInitialPayload } from '../components/ClientEmailComposerModal';

export type InvoiceEmailAttachmentBundle = {
  availability: InvoiceSendAttachmentAvailability;
  receiptHtml: string;
  remessaXml?: string;
};

export function findLinkedRentalContract(
  invoice: ErpFiscalInvoice,
  contracts: ErpRentalContract[] = []
): ErpRentalContract | null {
  return (
    contracts.find(
      (c) => c.id === invoice.rentalContractId || (invoice.contractNumber && c.contractNumber === invoice.contractNumber)
    ) || null
  );
}

export function buildInvoiceAttachmentBundle(
  invoice: ErpFiscalInvoice,
  contract?: ErpRentalContract | null,
  remessaDocs: Array<{
    documentType?: string | null;
    documentNumber?: string | null;
    verificationCodeOrKey?: string | null;
    rentalContractId?: string | null;
    contractNumber?: string | null;
    xmlContent?: string | null;
  }> = []
): InvoiceEmailAttachmentBundle {
  const availability = resolveInvoiceSendAttachments(invoice, contract, remessaDocs);
  const receiptHtml = buildStandaloneInvoiceHtml(invoice, contract || null, {
    templateStyle: 'CLEAN_CORPORATE_LIGHT',
    embedded: false,
    issuerAddress: defaultIssuerAddressLine(),
  });
  const remessaXml = remessaDocs.find((doc) => {
    if (doc.documentType !== 'NFE_REMESSA_LOCACAO') return false;
    const xml = String(doc.xmlContent || '').trim();
    if (!xml) return false;
    if (availability.remessa.number && String(doc.documentNumber || '').trim() === availability.remessa.number) return true;
    if (availability.remessa.accessKey && String(doc.verificationCodeOrKey || '').replace(/\s+/g, '') === availability.remessa.accessKey) {
      return true;
    }
    if (invoice.rentalContractId && doc.rentalContractId === invoice.rentalContractId) return true;
    return false;
  })?.xmlContent;
  return { availability, receiptHtml, remessaXml: remessaXml ? String(remessaXml) : undefined };
}

export function buildIssuedInvoiceEmailPayload(
  invoice: ErpFiscalInvoice,
  opts?: {
    contract?: ErpRentalContract | null;
    remessaDocs?: ErpFiscalInvoice[];
    publicInvoiceUrl?: string;
  }
): ClientEmailInitialPayload {
  const bundle = buildInvoiceAttachmentBundle(invoice, opts?.contract, opts?.remessaDocs || []);
  const emails = (invoice.billingRecipientEmails || opts?.contract?.billingRecipientEmails || []).filter(Boolean);
  return {
    docType: invoice.documentType === 'FATURA_LOCACAO' ? 'RENTAL_RECEIPT' : 'FISCAL_INVOICE',
    invoiceId: invoice.id,
    companyId: invoice.companyId || opts?.contract?.companyId || null,
    recipientName: invoice.companyName || opts?.contract?.companyName,
    recipientEmail: emails.join(', '),
    companyName: invoice.companyName || opts?.contract?.companyName,
    companyCnpj: invoice.companyCnpj || opts?.contract?.companyCnpj,
    documentCode: invoice.documentNumber,
    amountBrl: invoice.netAmount,
    dueDate: invoice.dueDate,
    boletoLine: bundle.availability.boleto.available ? bundle.availability.boleto.line : undefined,
    pixCode: bundle.availability.pix.available ? bundle.availability.pix.code : undefined,
    remessaNfeNumber: bundle.availability.remessa.number || undefined,
    remessaAccessKey: bundle.availability.remessa.accessKey || undefined,
    publicPdfUrl: opts?.publicInvoiceUrl,
    invoiceAttachments: bundle.availability,
    receiptHtml: bundle.receiptHtml,
    remessaXml: bundle.remessaXml,
    emailHistory: invoice.emailHistory || [],
  };
}
