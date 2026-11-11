/**
 * Visão interna resumida da proposta, para colar no contrato.
 * A URL é a identidade da proposta (id estável), sem versão e sem token.
 * Não altera validação de CNPJ: só exibe o CNPJ já gravado na proposta.
 */
import type { ErpCommercialProposal, ErpProposalItem } from '../../db/types';
import { formatProposalDisplayCode } from './proposal-number';
import { resolveProposalSlaOption } from './proposal-share';

export const INTERNAL_PROPOSAL_PATH_PREFIX = '/interno/proposta';

const STATUS_LABEL: Record<string, string> = {
  RASCUNHO: 'Rascunho',
  ENVIADA: 'Enviada',
  EM_NEGOCIACAO: 'Em negociação',
  APROVADA: 'Aprovada',
  CONVERTIDA_CONTRATO: 'Convertida em contrato',
  RECUSADA: 'Recusada',
};

export interface InternalProposalSummaryLine {
  id: string;
  description: string;
  quantityLabel: string;
  unitPriceLabel: string;
  totalLabel: string;
}

export interface InternalProposalSummaryModel {
  proposalId: string;
  codeLabel: string;
  versionLabel: string;
  versionNumber: number;
  status: string;
  statusLabel: string;
  title: string;
  companyName: string;
  companyCnpj: string;
  careOf: string;
  lines: InternalProposalSummaryLine[];
  productsLabel: string;
  freightLabel: string;
  showFreight: boolean;
  monthlyLabel: string;
  totalLabel: string;
  deliveryLabel: string;
  contractLabel: string;
  slaLabel: string;
  paymentLabel: string;
  validityLabel: string;
  internalNotes: string;
  stablePath: string;
  stableUrl: string;
}

export function buildStableInternalProposalPath(proposalId: string): string {
  const id = String(proposalId || '').trim();
  return `${INTERNAL_PROPOSAL_PATH_PREFIX}/${encodeURIComponent(id)}`;
}

export function buildStableInternalProposalUrl(
  proposalId: string,
  origin?: string
): string {
  const base = String(origin || 'https://sti-hub.vercel.app').replace(/\/+$/, '');
  return `${base}${buildStableInternalProposalPath(proposalId)}`;
}

export function formatBrl(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatIsoDatePt(value: string | undefined): string {
  const raw = String(value || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return raw || '—';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function formatQty(value: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(
    Number.isFinite(value) ? value : 0
  );
}

function lineTotal(item: ErpProposalItem): number {
  if (item.subtotal !== undefined && Number.isFinite(Number(item.subtotal))) {
    return Number(item.subtotal);
  }
  const qty = Number(item.quantity || 0);
  const unit = Number(item.unitPrice || 0);
  return Math.round(qty * unit * 100) / 100;
}

function slaLabelFor(proposal: ErpCommercialProposal): string {
  const resolved = resolveProposalSlaOption(proposal);
  if (!resolved.shortLabel) return 'Sem SLA específico';
  return resolved.shortLabel;
}

function contractLabelFor(proposal: ErpCommercialProposal): string {
  const recurring =
    Number(proposal.monthlyRecurringTotal || 0) > 0 ||
    (proposal.items || []).some((item) => item.isRecurring !== false);
  if (!recurring || proposal.budgetType === 'PRODUTOS') {
    return 'Venda avulsa — pagamento único, sem vigência recorrente';
  }
  const months = Math.max(1, Number(proposal.contractMonths || 1));
  return `${months} ${months === 1 ? 'mês' : 'meses'}`;
}

export function toInternalProposalSummary(
  proposal: ErpCommercialProposal,
  options?: { origin?: string }
): InternalProposalSummaryModel {
  const code = formatProposalDisplayCode(proposal.code);
  const versionNumber = Math.max(1, Number(proposal.version || 1));
  const products = Number(proposal.productsSubtotal || 0);
  const freight = Number(proposal.shippingCost || 0);
  const monthly = Number(proposal.monthlyRecurringTotal || 0);
  const total = Number(proposal.totalContractValue || 0);
  const delivery = String(proposal.deliveryLeadTime || proposal.deliveryForecast || '').trim();

  return {
    proposalId: proposal.id,
    codeLabel: code ? `#${code}` : '—',
    versionLabel: `Versão ${versionNumber}`,
    versionNumber,
    status: proposal.status,
    statusLabel: STATUS_LABEL[proposal.status] || proposal.status,
    title: String(proposal.title || '').trim() || 'Orçamento',
    companyName: String(proposal.companyName || '').trim() || '—',
    companyCnpj: String(proposal.companyCnpj || '').trim() || '—',
    careOf: String(proposal.careOf || proposal.contactName || '').trim(),
    lines: (proposal.items || []).map((item) => ({
      id: item.id,
      description: String(item.description || '').trim() || 'Item sem descrição',
      quantityLabel: formatQty(Number(item.quantity || 0)),
      unitPriceLabel: formatBrl(Number(item.unitPrice || 0)),
      totalLabel: formatBrl(lineTotal(item)),
    })),
    productsLabel: formatBrl(products),
    freightLabel: formatBrl(freight),
    showFreight: freight > 0,
    monthlyLabel: formatBrl(monthly),
    totalLabel: formatBrl(total),
    deliveryLabel: delivery || '—',
    contractLabel: contractLabelFor(proposal),
    slaLabel: slaLabelFor(proposal),
    paymentLabel: String(proposal.paymentCondition || '').trim() || '—',
    validityLabel: formatIsoDatePt(proposal.validUntil),
    internalNotes: String(proposal.internalNotes || '').trim(),
    stablePath: buildStableInternalProposalPath(proposal.id),
    stableUrl: buildStableInternalProposalUrl(proposal.id, options?.origin),
  };
}
