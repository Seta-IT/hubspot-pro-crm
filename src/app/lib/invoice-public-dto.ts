// DTO publico da fatura emitida: so o que o cliente pode ver no recibo/boleto/Pix/remessa.
import type { ErpFiscalInvoice, ErpRentalContract } from '../../db/types';
import { defaultIssuerAddressLine } from './company-issuer-address';
import { resolveInvoiceSendAttachments, type InvoiceSendAttachmentAvailability } from '../../modules/erp/invoice-send-attachments';

export type PublicInvoiceDto = {
  documentNumber: string;
  documentType: string;
  competenceMonth: string;
  companyName: string;
  companyCnpj: string;
  companyAddress: string;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  issueDate: string;
  dueDate: string;
  contractNumber: string | null;
  proposalNumber: string | null;
  remessaNfeNumber: string | null;
  remessaAccessKey: string | null;
  contractTermLabel: string | null;
  customerPurchaseOrderNumber: string | null;
  measurementNumber: string | null;
  measurementPeriod: string | null;
  paymentMethodLabel: string | null;
  pixCopyPaste: string | null;
  boletoDigitableLine: string | null;
  itemsDescription: Array<{ description: string; serialNumber?: string; quantity: number; unitValue: number; totalValue: number }>;
  legalExemptionNotice: string | null;
  cfop: string | null;
  issuerAddress: string;
  attachments: {
    receipt: boolean;
    remessa: boolean;
    boleto: boolean;
    pix: boolean;
  };
};

export function toPublicInvoiceDto(
  invoice: ErpFiscalInvoice,
  opts?: {
    contract?: ErpRentalContract | null;
    remessaDocs?: Array<{
      documentType?: string | null;
      documentNumber?: string | null;
      verificationCodeOrKey?: string | null;
      rentalContractId?: string | null;
      contractNumber?: string | null;
      xmlContent?: string | null;
    }>;
    issuerAddress?: string;
  }
): PublicInvoiceDto {
  const avail: InvoiceSendAttachmentAvailability = resolveInvoiceSendAttachments(
    invoice,
    opts?.contract,
    opts?.remessaDocs || []
  );
  return {
    documentNumber: invoice.documentNumber,
    documentType: invoice.documentType,
    competenceMonth: invoice.competenceMonth,
    companyName: invoice.companyName,
    companyCnpj: invoice.companyCnpj,
    companyAddress: invoice.companyAddress || opts?.contract?.deliveryAddress || '',
    grossAmount: Number(invoice.grossAmount || 0),
    discountAmount: Number(invoice.discountAmount || 0),
    netAmount: Number(invoice.netAmount || 0),
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    contractNumber: invoice.contractNumber || opts?.contract?.contractNumber || null,
    proposalNumber: invoice.proposalNumber || opts?.contract?.proposalNumber || null,
    remessaNfeNumber: avail.remessa.available ? avail.remessa.number || null : null,
    remessaAccessKey: avail.remessa.available ? avail.remessa.accessKey || null : null,
    contractTermLabel: invoice.contractTermLabel || opts?.contract?.contractTermLabel || null,
    customerPurchaseOrderNumber: invoice.customerPurchaseOrderNumber || opts?.contract?.customerPurchaseOrderNumber || null,
    measurementNumber: invoice.measurementNumber || opts?.contract?.measurementNumber || null,
    measurementPeriod: invoice.measurementPeriod || opts?.contract?.measurementPeriod || null,
    paymentMethodLabel: invoice.paymentMethodLabel || opts?.contract?.paymentMethod || null,
    pixCopyPaste: avail.pix.available ? avail.pix.code : null,
    boletoDigitableLine: avail.boleto.available ? avail.boleto.line : null,
    itemsDescription: (invoice.itemsDescription || []).map((it) => ({
      description: it.description,
      serialNumber: it.serialNumber,
      quantity: Number(it.quantity || 0),
      unitValue: Number(it.unitValue || 0),
      totalValue: Number(it.totalValue || 0),
    })),
    legalExemptionNotice: invoice.taxBreakdown?.legalExemptionNotice || null,
    cfop: invoice.cfop,
    issuerAddress: opts?.issuerAddress || defaultIssuerAddressLine(),
    attachments: {
      receipt: true,
      remessa: avail.remessa.available,
      boleto: avail.boleto.available,
      pix: avail.pix.available,
    },
  };
}

/** Converte o DTO publico para o formato da folha A4, sem dados internos. */
export function publicInvoiceToSheetInvoice(dto: PublicInvoiceDto): ErpFiscalInvoice {
  return {
    id: '',
    documentNumber: dto.documentNumber,
    documentType: (dto.documentType as ErpFiscalInvoice['documentType']) || 'FATURA_LOCACAO',
    competenceMonth: dto.competenceMonth,
    companyId: null,
    companyName: dto.companyName,
    companyCnpj: dto.companyCnpj,
    companyAddress: dto.companyAddress,
    rentalContractId: null,
    proposalId: null,
    dealId: null,
    grossAmount: dto.grossAmount,
    discountAmount: dto.discountAmount,
    netAmount: dto.netAmount,
    status: 'EMITIDA',
    issueDate: dto.issueDate,
    dueDate: dto.dueDate,
    paidAt: null,
    paymentMethod: 'BOLETO_PIX',
    serviceCodeLc116: null,
    cfop: dto.cfop,
    cstIcms: null,
    cstPisCofins: null,
    verificationCodeOrKey: '',
    pixCopyPaste: dto.pixCopyPaste || '',
    boletoDigitableLine: dto.boletoDigitableLine || '',
    itemsDescription: dto.itemsDescription,
    taxBreakdown: {
      taxRegime: 'LUCRO_PRESUMIDO',
      issRatePercent: 0,
      issAmount: 0,
      issWithheld: false,
      pisRatePercent: 0,
      pisAmount: 0,
      cofinsRatePercent: 0,
      cofinsAmount: 0,
      irpjEstimatedAmount: 0,
      csllEstimatedAmount: 0,
      irrfWithheldRatePercent: 0,
      irrfWithheldAmount: 0,
      csrfWithheldRatePercent: 0,
      csrfWithheldAmount: 0,
      icmsRatePercent: 0,
      icmsAmount: 0,
      totalTaxesEstimated: 0,
      totalWithheld: 0,
      netReceivableAmount: dto.netAmount,
      legalExemptionNotice: dto.legalExemptionNotice || '',
    },
    contractNumber: dto.contractNumber,
    proposalNumber: dto.proposalNumber,
    remessaNfeNumber: dto.remessaNfeNumber,
    contractTermLabel: dto.contractTermLabel,
    customerPurchaseOrderNumber: dto.customerPurchaseOrderNumber,
    measurementNumber: dto.measurementNumber,
    measurementPeriod: dto.measurementPeriod,
    paymentMethodLabel: dto.paymentMethodLabel,
    createdAt: '',
    updatedAt: '',
  };
}
