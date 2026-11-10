/** Disponibilidade dos documentos já existentes da fatura emitida (recibo, remessa, boleto, Pix). */

export type IssuedInvoiceStatus = 'EMITIDA' | 'PAGA' | 'VENCIDA' | 'CANCELADA' | 'ENTRADA_REGISTRADA';

export function isIssuedInvoiceStatus(status: unknown): boolean {
  return status === 'EMITIDA' || status === 'PAGA' || status === 'VENCIDA' || status === 'CANCELADA';
}

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function isPlaceholder(value: string): boolean {
  const n = value.toLowerCase();
  if (!n) return true;
  if (n === '—' || n === '-' || n === 'n/a') return true;
  return n.includes('gerado ao finalizar') || n.includes('sera gerado') || n.includes('será gerado');
}

export function isStoredPixCode(value: unknown): boolean {
  const raw = clean(value);
  if (isPlaceholder(raw)) return false;
  const compact = raw.replace(/\s+/g, '');
  return compact.startsWith('000201') && compact.length >= 20;
}

export function isStoredBoletoLine(value: unknown): boolean {
  const raw = clean(value);
  if (isPlaceholder(raw)) return false;
  const digits = raw.replace(/\D+/g, '');
  return digits.length >= 44 && digits.length <= 48;
}

export function isStoredRemessaNumber(value: unknown): boolean {
  const raw = clean(value);
  return Boolean(raw) && !isPlaceholder(raw);
}

export type InvoiceSendAttachmentKind = 'receipt' | 'remessa' | 'boleto' | 'pix';

export type InvoiceSendAttachmentAvailability = {
  receipt: { available: true };
  remessa: {
    available: boolean;
    number: string;
    accessKey: string;
    hasXml: boolean;
    hasDanfe: boolean;
  };
  boleto: { available: boolean; line: string; hasPdf: boolean };
  pix: { available: boolean; code: string };
};

export type InvoiceAttachmentSources = {
  remessaNfeNumber?: string | null;
  remessaNfeKey?: string | null;
  verificationCodeOrKey?: string | null;
  boletoDigitableLine?: string | null;
  pixCopyPaste?: string | null;
  documentType?: string | null;
  rentalContractId?: string | null;
  contractNumber?: string | null;
};

export type RemessaDocumentLike = {
  documentType?: string | null;
  documentNumber?: string | null;
  verificationCodeOrKey?: string | null;
  rentalContractId?: string | null;
  contractNumber?: string | null;
  xmlContent?: string | null;
};

export function resolveInvoiceSendAttachments(
  invoice: InvoiceAttachmentSources,
  contract?: { remessaNfeNumber?: string | null; remessaNfeKey?: string | null } | null,
  remessaDocs: RemessaDocumentLike[] = []
): InvoiceSendAttachmentAvailability {
  const remessaNumber = clean(invoice.remessaNfeNumber || contract?.remessaNfeNumber);
  const remessaKey = clean(invoice.remessaNfeKey || contract?.remessaNfeKey || '').replace(/\s+/g, '');
  const remessaDoc = remessaDocs.find((doc) => {
    if (doc.documentType !== 'NFE_REMESSA_LOCACAO') return false;
    const num = clean(doc.documentNumber);
    const key = clean(doc.verificationCodeOrKey).replace(/\s+/g, '');
    if (remessaNumber && num && (num === remessaNumber || num.replace(/\D+/g, '') === remessaNumber.replace(/\D+/g, ''))) return true;
    if (remessaKey && key && key === remessaKey) return true;
    if (invoice.rentalContractId && doc.rentalContractId && doc.rentalContractId === invoice.rentalContractId) return true;
    if (invoice.contractNumber && doc.contractNumber && doc.contractNumber === invoice.contractNumber) return true;
    return false;
  });
  const accessKey = remessaKey || clean(remessaDoc?.verificationCodeOrKey).replace(/\s+/g, '');
  const number = remessaNumber || clean(remessaDoc?.documentNumber);
  const hasXml = Boolean(clean(remessaDoc?.xmlContent));
  const availableRemessa = Boolean(number || accessKey || remessaDoc);
  const boletoLine = clean(invoice.boletoDigitableLine);
  const pixCode = clean(invoice.pixCopyPaste);
  return {
    receipt: { available: true },
    remessa: {
      available: availableRemessa,
      number,
      accessKey,
      hasXml,
      hasDanfe: Boolean(remessaDoc || accessKey),
    },
    boleto: {
      available: isStoredBoletoLine(boletoLine),
      line: isStoredBoletoLine(boletoLine) ? boletoLine : '',
      hasPdf: false,
    },
    pix: {
      available: isStoredPixCode(pixCode),
      code: isStoredPixCode(pixCode) ? pixCode : '',
    },
  };
}

export function defaultSelectedInvoiceAttachments(
  avail: InvoiceSendAttachmentAvailability
): Record<InvoiceSendAttachmentKind, boolean> {
  return {
    receipt: true,
    remessa: avail.remessa.available,
    boleto: avail.boleto.available,
    pix: avail.pix.available,
  };
}
