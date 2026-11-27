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

/**
 * Título gerado pelo sistema (padrão atual, legado "Orçamento #N — empresa"
 * ou o mesmo já marcado como cópia). Não inclui nomes personalizados.
 */
export function isAutomaticProposalTitle(
  title: unknown,
  input?: { budgetType?: string | null; code?: unknown; companyName?: unknown }
): boolean {
  const raw = String(title ?? '').trim();
  if (!raw) return true;
  const stored = raw.replace(/\s+\(Cópia\)$/i, '').trim();
  if (!stored) return true;
  if (input && stored === defaultProposalTitle(input)) return true;
  const num = input ? formatProposalDisplayCode(input.code) : '';
  const client = String(input?.companyName ?? '').trim();
  if (num && client && stored === `Orçamento #${num} — ${client}`) return true;
  const autoRe = /^Orçamento(?: de [^—]+)?\s+(?:nº|#)\s*\d+\s+—\s+(.+)$/i;
  const match = stored.match(autoRe);
  if (!match) return false;
  if (!client) return true;
  return match[1].trim().toLocaleLowerCase('pt-BR') === client.toLocaleLowerCase('pt-BR');
}

/** Nome do negócio na criação normal: padrão automático com o número atual, ou o título personalizado. */
export function dealTitleFromProposal(input: {
  title?: unknown;
  budgetType?: string | null;
  code?: unknown;
  companyName?: unknown;
}): string {
  if (isAutomaticProposalTitle(input.title, input)) {
    return defaultProposalTitle(input);
  }
  const stored = String(input.title ?? '').trim();
  return stored || defaultProposalTitle(input);
}

/** Parágrafo padrão gravado na proposta; não aparece na folha/PDF do cliente. */
export const DEFAULT_PROPOSAL_INTRODUCTION =
  'Apresentamos a seguir nossa proposta técnico-comercial personalizada com equipamentos homologados Seta Telecom e garantia de alta disponibilidade.';

/** Texto de introdução visível ao cliente: omite o parágrafo fixo padrão, sem apagar o dado. */
export function clientProposalIntroduction(text: unknown): string {
  return String(text || '')
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line && line !== DEFAULT_PROPOSAL_INTRODUCTION)
    .join('\n')
    .trim();
}
