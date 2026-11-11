import type { ErpFiscalInvoice, ErpRentalContract } from '../../db/types';
import { matchInvoicesForContract } from './contract-billing-utils';
import { buildInvoiceAttachmentBundle } from './invoice-email-payload';
import { buildClientEmailGreeting } from './client-email-greeting';
import {
  CONTRACT_EMAIL_ATTACHMENT_LABELS,
  defaultSelectedContractAttachments,
  formatInvoiceChoiceLabel,
  isChargeIssuedInvoice,
  resolveContractEmailAttachments,
  resolveLinkedProposalId,
  type ContractAttachmentState,
  type ContractEmailInvoiceChoice,
} from '../../modules/erp/contract-email-compose';
import type { ClientEmailInitialPayload } from '../components/ClientEmailComposerModal';

function fmtBrDate(value?: string | null): string {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

export function listContractIssuedInvoiceChoices(
  contract: Pick<ErpRentalContract, 'id' | 'contractNumber' | 'proposalId' | 'companyCnpj'>,
  invoices: ErpFiscalInvoice[],
  remessaDocs: ErpFiscalInvoice[] = invoices
): ContractEmailInvoiceChoice[] {
  return matchInvoicesForContract(contract as ErpRentalContract, invoices)
    .filter(isChargeIssuedInvoice)
    .sort((a, b) => String(b.issueDate || b.createdAt || '').localeCompare(String(a.issueDate || a.createdAt || '')))
    .map((inv) => {
      const bundle = buildInvoiceAttachmentBundle(inv, contract as ErpRentalContract, remessaDocs);
      return {
        id: inv.id,
        documentNumber: inv.documentNumber,
        competenceMonth: inv.competenceMonth,
        dueDate: inv.dueDate,
        netAmount: inv.netAmount,
        label: formatInvoiceChoiceLabel(inv),
        invoiceAttachments: bundle.availability,
        boletoLine: bundle.availability.boleto.available ? bundle.availability.boleto.line : undefined,
        pixCode: bundle.availability.pix.available ? bundle.availability.pix.code : undefined,
        remessaNfeNumber: bundle.availability.remessa.number || undefined,
        remessaAccessKey: bundle.availability.remessa.accessKey || undefined,
      };
    });
}

export function buildContractEmailSubject(input: {
  contractNumber?: string | null;
  companyName?: string | null;
  selected: ContractAttachmentState;
}): string {
  const code = String(input.contractNumber || 'Contrato').replace(/^#/, '');
  const company = input.companyName || 'Cliente';
  const extras = (['receipt', 'boleto', 'pix', 'remessa', 'proposal'] as const)
    .filter((kind) => input.selected[kind])
    .map((kind) => CONTRACT_EMAIL_ATTACHMENT_LABELS[kind]);
  const suffix = extras.length ? ` — ${extras.join(', ')}` : '';
  return `[Seta Telecom] Contrato #${code}${suffix} — ${company}`;
}

export function buildContractEmailBody(input: {
  recipientName?: string;
  companyName?: string;
  companyCnpj?: string;
  contractNumber?: string | null;
  amountLabel?: string;
  dueDate?: string;
  selected: ContractAttachmentState;
  invoiceCode?: string;
  invoiceUrl?: string;
  proposalUrl?: string;
  boletoLine?: string;
  pixCode?: string;
  remessaNumber?: string;
  remessaKey?: string;
}): string {
  const greeting = buildClientEmailGreeting(input);
  const code = String(input.contractNumber || '').replace(/^#/, '') || 'Contrato';
  const company = input.companyName || 'sua empresa';
  const lines = [
    greeting,
    '',
    `Segue o contrato #${code} da SETA TELECOM LTDA.`,
    '',
    `• Contrato: #${code}`,
    `• Cliente: ${company}${input.companyCnpj ? ` (CNPJ: ${input.companyCnpj})` : ''}`,
  ];
  if (input.amountLabel) lines.push(`• Valor: ${input.amountLabel}`);
  if (input.dueDate) lines.push(`• Próximo vencimento: ${input.dueDate}`);
  const selectedLabels = (['receipt', 'boleto', 'proposal', 'pix', 'remessa'] as const)
    .filter((kind) => input.selected[kind])
    .map((kind) => {
      if (kind === 'receipt') return input.invoiceCode ? `Recibo da fatura ${input.invoiceCode}` : 'Recibo';
      if (kind === 'boleto') return 'Boleto';
      if (kind === 'proposal') return 'Proposta comercial';
      if (kind === 'pix') return 'QR Code Pix';
      return 'NF de remessa';
    });
  if (selectedLabels.length) {
    lines.push('', 'Documentos selecionados:');
    for (const label of selectedLabels) lines.push(`• ${label}`);
  }
  if (input.selected.receipt && input.invoiceUrl) {
    lines.push('', 'Link da fatura para o cliente:', input.invoiceUrl);
  }
  if (input.selected.proposal && input.proposalUrl) {
    lines.push('', 'Link da proposta para o cliente:', input.proposalUrl);
  }
  if (input.selected.boleto && input.boletoLine) {
    lines.push('', 'Linha digitável do boleto:', input.boletoLine);
  }
  if (input.selected.pix && input.pixCode) {
    lines.push('', 'Código Pix (copia e cola):', input.pixCode);
  }
  if (input.selected.remessa && (input.remessaNumber || input.remessaKey)) {
    lines.push('', 'NF-e de remessa:');
    if (input.remessaNumber) lines.push(`Número: ${input.remessaNumber}`);
    if (input.remessaKey) lines.push(`Chave de acesso: ${input.remessaKey}`);
  }
  lines.push(
    '',
    'Atenciosamente,',
    'Faturamento & Contratos • SETA TELECOM LTDA (SETA | IT)',
    'CNPJ 14.806.925/0001-32'
  );
  return lines.join('\n');
}

export function buildContractEmailPayload(
  contract: ErpRentalContract,
  opts?: {
    invoices?: ErpFiscalInvoice[];
    remessaDocs?: ErpFiscalInvoice[];
    proposals?: Array<{ id: string; code?: string | null }>;
    recipientName?: string;
  }
): ClientEmailInitialPayload {
  const invoices = opts?.invoices || [];
  const remessaDocs = opts?.remessaDocs || invoices;
  const choices = listContractIssuedInvoiceChoices(contract, invoices, remessaDocs);
  const latest = choices[0];
  const linkedFromList = (opts?.proposals || []).find(
    (p) => p.id === contract.proposalId || p.code === contract.proposalId || p.code === contract.proposalNumber || p.id === contract.proposalNumber
  );
  const linkedProposalId =
    (linkedFromList && linkedFromList.id) ||
    resolveLinkedProposalId({ proposalId: contract.proposalId, proposalNumber: contract.proposalNumber });
  const resolved = resolveContractEmailAttachments({
    proposalId: linkedProposalId,
    invoice: latest
      ? {
          boletoDigitableLine: latest.boletoLine,
          pixCopyPaste: latest.pixCode,
          remessaNfeNumber: latest.remessaNfeNumber,
          remessaNfeKey: latest.remessaAccessKey,
          rentalContractId: contract.id,
          contractNumber: contract.contractNumber,
        }
      : null,
    contract,
    remessaDocs,
  });
  const selected = defaultSelectedContractAttachments(resolved.options);
  const emails = (contract.billingRecipientEmails || []).map((e) => String(e || '').trim()).filter(Boolean);
  return {
    docType: 'RENTAL_RECEIPT',
    contractId: contract.id,
    contractNumber: contract.contractNumber,
    companyId: contract.companyId,
    companyName: contract.companyName,
    companyCnpj: contract.companyCnpj,
    contactId: contract.contactId,
    recipientName: opts?.recipientName,
    recipientEmail: emails.join(', '),
    documentCode: contract.contractNumber,
    amountBrl: contract.monthlyValue,
    dueDate: fmtBrDate(contract.nextDueDate),
    invoiceId: latest?.id,
    invoiceAttachments: latest?.invoiceAttachments,
    invoiceChoices: choices,
    proposalId: linkedProposalId || null,
    boletoLine: latest?.boletoLine,
    pixCode: latest?.pixCode,
    remessaNfeNumber: latest?.remessaNfeNumber,
    remessaAccessKey: latest?.remessaAccessKey,
    customSubject: buildContractEmailSubject({
      contractNumber: contract.contractNumber,
      companyName: contract.companyName,
      selected,
    }),
    customBody: buildContractEmailBody({
      recipientName: opts?.recipientName,
      companyName: contract.companyName,
      companyCnpj: contract.companyCnpj,
      contractNumber: contract.contractNumber,
      amountLabel:
        typeof contract.monthlyValue === 'number'
          ? contract.monthlyValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
          : undefined,
      dueDate: fmtBrDate(contract.nextDueDate),
      selected,
      invoiceCode: latest?.documentNumber,
      boletoLine: latest?.boletoLine,
      pixCode: latest?.pixCode,
      remessaNumber: latest?.remessaNfeNumber,
      remessaKey: latest?.remessaAccessKey,
    }),
  };
}
