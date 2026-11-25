import { formatProposalDisplayCode } from './proposal-number';

/** Título padrão quando o orçamento de produtos não tem nome informado. */
export function defaultProductsProposalTitle(input: {
  code?: unknown;
  companyName?: unknown;
}): string {
  const num = formatProposalDisplayCode(input.code);
  const client = String(input.companyName ?? '').trim();
  const prefix = num ? `Orçamento de Produtos nº ${num}` : 'Orçamento de Produtos';
  return client ? `${prefix} — ${client}` : prefix;
}

/**
 * Nome exibido e gravado: mantém o título salvo quando houver;
 * em orçamento de produtos sem nome, usa o padrão automático.
 */
export function displayProposalTitle(input: {
  title?: unknown;
  budgetType?: string | null;
  code?: unknown;
  companyName?: unknown;
}): string {
  const stored = String(input.title ?? '').trim();
  if (stored) return stored;
  if (input.budgetType === 'PRODUTOS') return defaultProductsProposalTitle(input);
  return stored;
}
