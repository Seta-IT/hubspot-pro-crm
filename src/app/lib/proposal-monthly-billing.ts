// Cobrança mensal de locação, serviço (inclui contrato de spare parts) e Spare Parts.
// Não lista parcelas: a quantidade de mensalidades vem do prazo do contrato.

import { displayPaymentConditionText, proposalPaymentMethodLabel } from './proposal-payment-method';
import { readablePaymentCondition } from './proposal-share';

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

export function formatMonthlyPaymentCondition(input: {
  contractMonths?: number | null;
  paymentMethod?: string | null;
  billingDueRule?: ProposalBillingDueRule | string | null;
  billingDueDay?: number | null;
}): string {
  const months = Math.max(1, Math.floor(Number(input.contractMonths || 1)) || 1);
  const monthLabel = months === 1 ? '1 mês' : `${months} meses`;
  const method = monthlyPaymentMethodSummaryLabel(input.paymentMethod);
  const due =
    input.billingDueRule === 'FIXED_DAY'
      ? `vencimento no dia ${clampBillingDueDay(input.billingDueDay)}`
      : 'vencimento a cada 30 dias';
  return `Mensal • ${monthLabel} • ${method} • ${due}`;
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

/** Texto que o cliente lê. Nunca devolve o código cru (ex.: a_vista). */
export function displayProposalPaymentCondition(proposal: {
  budgetType?: string | null;
  paymentCondition?: string | null;
  contractMonths?: number | null;
  billingDueRule?: ProposalBillingDueRule | string | null;
  billingDueDay?: number | null;
  installments?: Array<{ paymentMethod?: string | null }>;
}): string {
  const readable = displayPaymentConditionText(readablePaymentCondition(proposal.paymentCondition));
  if (isMonthlyBillingBudgetType(proposal.budgetType) && proposal.billingDueRule) {
    if (readable && !isPaymentConditionSlug(proposal.paymentCondition) && !/^a_vista$/i.test(readable)) {
      return readable;
    }
    return formatMonthlyPaymentCondition({
      contractMonths: proposal.contractMonths,
      paymentMethod: inferMonthlyPaymentMethod(proposal),
      billingDueRule: proposal.billingDueRule,
      billingDueDay: proposal.billingDueDay,
    });
  }
  return readable;
}
