import type { ErpCommercialProposal, ErpProposalStatus } from '../../db/types';

/** Venda: Produtos e Spare Parts. Locação, Serviços e Conjunto seguem o fluxo com contrato. */
export type ProposalStatusFamily = 'venda' | 'locacao_servico';

export const SALE_PROPOSAL_STATUSES = [
  'RASCUNHO',
  'ENVIADA',
  'APROVADA',
  'FATURAMENTO',
  'CONCRETIZADA',
  'RECUSADA',
] as const;

export const RENTAL_SERVICE_PROPOSAL_STATUSES = [
  'RASCUNHO',
  'ENVIADA',
  'APROVADA',
  'CONVERTIDA_CONTRATO',
  'FATURAMENTO',
  'CONCRETIZADA',
  'RECUSADA',
] as const;

/**
 * Rótulos dos códigos já gravados. EM_NEGOCIACAO não é uma opção do seletor:
 * aparece junto de ENVIADA. Códigos fora desta tabela (Expirada, Rejeitada…)
 * continuam legíveis e não são regravados.
 */
const STATUS_LABEL: Record<string, string> = {
  RASCUNHO: 'Em aberto',
  ENVIADA: 'Em andamento/Enviado',
  EM_NEGOCIACAO: 'Em andamento/Enviado',
  APROVADA: 'Aprovada',
  CONVERTIDA_CONTRATO: 'Convertida em contrato',
  RECUSADA: 'Cancelada',
  CANCELADA: 'Cancelada',
  FATURAMENTO: 'Faturamento',
  CONCRETIZADA: 'Concretizada',
  EXPIRADA: 'Expirada',
  REJEITADA: 'Rejeitada',
};

const BADGE_CLASS: Record<string, string> = {
  RASCUNHO: 'bg-slate-100 text-slate-700 border border-slate-300',
  ENVIADA: 'bg-sky-100 text-sky-900 border border-sky-200',
  EM_NEGOCIACAO: 'bg-sky-100 text-sky-900 border border-sky-200',
  APROVADA: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
  CONVERTIDA_CONTRATO: 'bg-emerald-100 text-emerald-900 border border-emerald-300',
  FATURAMENTO: 'bg-indigo-50 text-indigo-900 border border-indigo-200',
  CONCRETIZADA: 'bg-emerald-100 text-emerald-900 border border-emerald-300',
  RECUSADA: 'bg-rose-100 text-rose-800 border border-rose-200',
  CANCELADA: 'bg-rose-100 text-rose-800 border border-rose-200',
};

export function proposalStatusFamily(budgetType: ErpCommercialProposal['budgetType'] | string | null | undefined): ProposalStatusFamily {
  const t = String(budgetType || '').trim().toUpperCase();
  return t === 'PRODUTOS' || t === 'SPARE_PARTS' ? 'venda' : 'locacao_servico';
}

export function proposalStatusFamilyForListTab(tab: string | null | undefined): ProposalStatusFamily | 'todos' {
  if (tab === 'ORC_PRODUTOS' || tab === 'ORC_SPARE_PARTS') return 'venda';
  if (tab === 'ORC_LOCACAO' || tab === 'ORC_SERVICOS') return 'locacao_servico';
  return 'todos';
}

export function proposalStatusOptions(family: ProposalStatusFamily | 'todos'): Array<{ value: ErpProposalStatus; label: string }> {
  const codes = family === 'venda' ? SALE_PROPOSAL_STATUSES : RENTAL_SERVICE_PROPOSAL_STATUSES;
  return codes.map((value) => ({ value, label: proposalStatusLabel(value) }));
}

/** Inclui a situação gravada quando ela não está na lista do tipo, sem trocar o valor. */
export function proposalStatusChoices(
  budgetType: ErpCommercialProposal['budgetType'] | string | null | undefined,
  currentStatus?: string | null
): Array<{ value: string; label: string; legacy?: boolean }> {
  const options: Array<{ value: string; label: string; legacy: boolean }> = proposalStatusOptions(
    proposalStatusFamily(budgetType)
  ).map((o) => ({ ...o, legacy: false }));
  const current = String(currentStatus || '').trim().toUpperCase();
  if (current && !options.some((o) => o.value === current)) {
    options.push({ value: current, label: proposalStatusLabel(current), legacy: true });
  }
  return options;
}

export function proposalStatusLabel(status: string | null | undefined): string {
  const key = String(status || '').trim().toUpperCase();
  if (STATUS_LABEL[key]) return STATUS_LABEL[key];
  if (!key) return 'Em aberto';
  return key
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

export function proposalStatusBadge(status: string | null | undefined): { label: string; cls: string } {
  const key = String(status || '').trim().toUpperCase();
  return {
    label: proposalStatusLabel(key),
    cls: BADGE_CLASS[key] || 'bg-slate-100 text-slate-800 border border-slate-300',
  };
}

/** Filtro "Em andamento/Enviado" (ENVIADA) também encontra EM_NEGOCIACAO já gravado. */
export function proposalMatchesStatusFilter(
  proposal: { status?: string | null; convertedContractId?: string | null },
  filter: string
): boolean {
  if (!filter || filter === 'TODOS') return true;
  if (filter === 'ENVIADA') return proposal.status === 'ENVIADA' || proposal.status === 'EM_NEGOCIACAO';
  if (filter === 'CONVERTIDA_CONTRATO') {
    return proposal.status === 'CONVERTIDA_CONTRATO' || Boolean(proposal.convertedContractId);
  }
  return proposal.status === filter;
}
