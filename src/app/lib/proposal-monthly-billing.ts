// Cobrança mensal de locação, serviço (inclui contrato de spare parts) e Spare Parts.
// Não lista parcelas: a quantidade de mensalidades vem do prazo do contrato.

import { brDateToIso, isoToBrDate } from './br-date';
import { displayPaymentConditionText, proposalPaymentMethodLabel } from './proposal-payment-method';
import { isAvulsoServiceProposal, readablePaymentCondition } from './proposal-share';

export type ProposalBillingDueRule = 'EVERY_30_DAYS' | 'FIXED_DAY';

export const MONTHLY_BILLING_BUDGET_TYPES = ['LOCACAO', 'SERVICOS', 'SPARE_PARTS'] as const;

export function isMonthlyBillingBudgetType(type?: string | null): boolean {
  const t = String(type || '').toUpperCase();
  return t === 'LOCACAO' || t === 'SERVICOS' || t === 'SPARE_PARTS';
}

export function clampBillingDueDay(value: unknown): number {
  const day = Math.floor(Number(value));
  if (!Number.isFinite(day)) return 10;
  return Math.min(31, Math.max(1, day));
}

export function monthlyPaymentMethodSummaryLabel(method?: string | null): string {
  const raw = String(method || '').trim();
  if (!raw) return 'Boleto';
  const upper = raw.toUpperCase().replace(/[\s/-]+/g, '_');
  if (upper === 'BOLETO' || upper.startsWith('BOLETO')) return 'Boleto';
  if (upper === 'PIX' || upper.startsWith('PIX')) return 'Pix';
  if (upper === 'TED' || upper.startsWith('TED')) return 'Ted';
  const label = proposalPaymentMethodLabel(raw);
  if (label === 'Ted / Transferência') return 'Ted';
  if (/^boleto/i.test(label)) return 'Boleto';
  if (/^pix/i.test(label)) return 'Pix';
  return label || 'Boleto';
}

function displayMethodLabel(method?: string | null): string {
  const raw = String(method || '').trim();
  if (/ \/ /.test(raw)) return raw;
  return monthlyPaymentMethodSummaryLabel(raw);
}

/** Forma exibida no resumo: parcela gravada, ou métodos citados no texto, na ordem em que aparecem. */
export function paymentMethodSummaryFromProposal(proposal: {
  paymentCondition?: string | null;
  installments?: Array<{ paymentMethod?: string | null }>;
}): string {
  const fromInstallment = String(proposal.installments?.[0]?.paymentMethod || '').trim();
  if (fromInstallment) return monthlyPaymentMethodSummaryLabel(fromInstallment);
  const text = String(proposal.paymentCondition || '');
  const labels: string[] = [];
  const re = /boleto|pix|ted/gi;
  let match: RegExpExecArray | null = re.exec(text);
  while (match) {
    const label = monthlyPaymentMethodSummaryLabel(match[0]);
    if (label && !labels.includes(label)) labels.push(label);
    match = re.exec(text);
  }
  if (labels.length) return labels.join(' / ');
  return 'Boleto';
}

export function isoDueDateFromProposal(proposal: {
  billingFirstDueDate?: string | null;
  paymentCondition?: string | null;
  installments?: Array<{ number?: number | null; dueDate?: string | null }>;
}): string {
  const fromBilling = String(proposal.billingFirstDueDate || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(fromBilling)) return fromBilling.slice(0, 10);
  const installments = Array.isArray(proposal.installments) ? proposal.installments : [];
  const dated = installments
    .filter((item) => item && /^\d{4}-\d{2}-\d{2}/.test(String(item.dueDate || '')))
    .sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0));
  const fromInstallment = String(dated[0]?.dueDate || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(fromInstallment)) return fromInstallment.slice(0, 10);
  const text = String(proposal.paymentCondition || '');
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const br = text.match(/\b(\d{2}\/\d{2}\/\d{4})\b/);
  if (br) return brDateToIso(br[1]) || '';
  return '';
}

export function installmentCountFromProposal(proposal: {
  installments?: Array<{ dueDate?: string | null }>;
  paymentCondition?: string | null;
}): number {
  const installments = Array.isArray(proposal.installments) ? proposal.installments : [];
  if (installments.length > 0) return installments.length;
  const text = String(proposal.paymentCondition || '');
  const match = text.match(/parcelado em\s*(\d+)\s*x/i) || text.match(/\b(\d+)\s*x\b/i);
  if (match) {
    const count = Math.floor(Number(match[1]));
    if (Number.isFinite(count) && count >= 1) return count;
  }
  return 1;
}

/** Resumo de produtos, conjunto e serviço avulso: forma, quantidade e data completa. */
export function formatInstallmentPaymentCondition(input: {
  paymentMethod?: string | null;
  installmentCount?: number | null;
  firstDueDate?: string | null;
}): string {
  const due = isoToBrDate(input.firstDueDate);
  if (!due) return '';
  const count = Math.max(1, Math.floor(Number(input.installmentCount || 1)) || 1);
  const method = displayMethodLabel(input.paymentMethod);
  if (count === 1) return `${method} • 1x • Vencimento ${due}`;
  return `${method} • ${count}x • 1º vencimento ${due}`;
}

export function formatMonthlyPaymentCondition(input: {
  contractMonths?: number | null;
  paymentMethod?: string | null;
  billingDueRule?: ProposalBillingDueRule | string | null;
  billingDueDay?: number | null;
  billingFirstDueDate?: string | null;
}): string {
  const months = Math.max(1, Math.floor(Number(input.contractMonths || 1)) || 1);
  const method = displayMethodLabel(input.paymentMethod);
  const due = isoToBrDate(input.billingFirstDueDate);
  if (due) {
    const monthLabel = months === 1 ? '1 mensalidade' : `${months} mensalidades`;
    return `${method} • ${monthLabel} • 1º vencimento ${due}`;
  }
  const monthLabel = months === 1 ? '1 mês' : `${months} meses`;
  const rule =
    input.billingDueRule === 'FIXED_DAY'
      ? `vencimento no dia ${clampBillingDueDay(input.billingDueDay)}`
      : 'vencimento a cada 30 dias';
  return `Mensal • ${monthLabel} • ${method} • ${rule}`;
}

function isPaymentConditionSlug(raw?: string | null): boolean {
  const text = String(raw || '').trim();
  if (!text) return true;
  const slug = text.toLowerCase().replace(/[\s-]+/g, '_');
  return slug === 'a_vista' || slug === 'avista' || slug === 'pagamento_unico';
}

export function inferMonthlyPaymentMethod(proposal: {
  paymentCondition?: string | null;
  installments?: Array<{ paymentMethod?: string | null }>;
}): string {
  const fromInstallment = String(proposal.installments?.[0]?.paymentMethod || '').trim();
  if (fromInstallment) return fromInstallment;
  const text = String(proposal.paymentCondition || '');
  if (/\bpix\b/i.test(text)) return 'PIX';
  if (/\bted\b/i.test(text)) return 'TED';
  if (/\bboleto\b/i.test(text)) return 'BOLETO';
  return 'BOLETO';
}

function usesMonthlyPaymentSummary(proposal: {
  budgetType?: string | null;
  contractMonths?: number | null;
}): boolean {
  return isMonthlyBillingBudgetType(proposal.budgetType) && !isAvulsoServiceProposal(proposal);
}

/** Texto que o cliente lê. Nunca devolve o código cru (ex.: a_vista). */
export function displayProposalPaymentCondition(proposal: {
  budgetType?: string | null;
  paymentCondition?: string | null;
  contractMonths?: number | null;
  billingDueRule?: ProposalBillingDueRule | string | null;
  billingDueDay?: number | null;
  billingFirstDueDate?: string | null;
  installments?: Array<{ number?: number | null; dueDate?: string | null; paymentMethod?: string | null }>;
}): string {
  const firstDue = isoDueDateFromProposal(proposal);
  const method = paymentMethodSummaryFromProposal(proposal);
  if (usesMonthlyPaymentSummary(proposal) && firstDue) {
    return formatMonthlyPaymentCondition({
      contractMonths: proposal.contractMonths,
      paymentMethod: method,
      billingDueRule: proposal.billingDueRule,
      billingDueDay: proposal.billingDueDay,
      billingFirstDueDate: firstDue,
    });
  }
  if (!usesMonthlyPaymentSummary(proposal) && firstDue) {
    const generated = formatInstallmentPaymentCondition({
      paymentMethod: method,
      installmentCount: installmentCountFromProposal(proposal),
      firstDueDate: firstDue,
    });
    if (generated) return generated;
  }
  const readable = displayPaymentConditionText(readablePaymentCondition(proposal.paymentCondition));
  if (usesMonthlyPaymentSummary(proposal) && proposal.billingDueRule) {
    if (readable && !isPaymentConditionSlug(proposal.paymentCondition) && !/^a_vista$/i.test(readable)) {
      return readable;
    }
    return formatMonthlyPaymentCondition({
      contractMonths: proposal.contractMonths,
      paymentMethod: inferMonthlyPaymentMethod(proposal),
      billingDueRule: proposal.billingDueRule,
      billingDueDay: proposal.billingDueDay,
      billingFirstDueDate: firstDue || undefined,
    });
  }
  return readable;
}
