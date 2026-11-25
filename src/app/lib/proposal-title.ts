import { formatProposalDisplayCode } from './proposal-number';

/** Rótulo curto do tipo, usado no nome automático. */
export function proposalTypeTitleLabel(budgetType?: string | null): string {
  switch (String(budgetType || '').trim().toUpperCase()) {
    case 'PRODUTOS':
      return 'Orçamento de Produtos';
    case 'SERVICOS':
      return 'Orçamento de Serviços';
    case 'LOCACAO':
      return 'Orçamento de Locação';
    case 'CONJUNTO':
      return 'Orçamento conjunto';
    case 'SPARE_PARTS':
      return 'Spare Parts / Hard Parts';
    default:
      return 'Orçamento';
  }
}

/** Título padrão: "{Tipo} nº {número} — {cliente}". */
export function defaultProposalTitle(input: {
  budgetType?: string | null;
  code?: unknown;
  companyName?: unknown;
}): string {
  const tipo = proposalTypeTitleLabel(input.budgetType);
  const num = formatProposalDisplayCode(input.code);
  const client = String(input.companyName ?? '').trim();
  const prefix = num ? `${tipo} nº ${num}` : tipo;
  return client ? `${prefix} — ${client}` : prefix;
}

/** @deprecated use defaultProposalTitle({ ...input, budgetType: 'PRODUTOS' }) */
export function defaultProductsProposalTitle(input: {
  code?: unknown;
  companyName?: unknown;
}): string {
  return defaultProposalTitle({ ...input, budgetType: 'PRODUTOS' });
}

/**
 * Nome exibido e gravado: mantém o título salvo quando houver;
 * se estiver vazio, usa o padrão automático do tipo.
 */
export function displayProposalTitle(input: {
  title?: unknown;
  budgetType?: string | null;
  code?: unknown;
  companyName?: unknown;
}): string {
  const stored = String(input.title ?? '').trim();
  if (stored) return stored;
  return defaultProposalTitle(input);
}
