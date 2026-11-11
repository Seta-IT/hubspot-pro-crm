/**
 * Visão interna resumida da proposta, para colar no contrato.
 * A URL é a identidade da proposta (id estável), sem versão e sem token.
 * Não altera validação de CNPJ: só exibe o CNPJ já gravado.
 *
 * Spare parts não tem budgetType próprio. É um serviceType de proposta de
 * serviço ("Spare Parts / Hard Parts" e combinações). Quando o tipo de
 * serviço é só spare parts, a folha usa os rótulos de cobertura e reposição.
 * Suporte + spare parts no mesmo serviceType continua como serviço, e o
 * texto do escopo traz as duas partes.
 */
import type { ErpCommercialProposal, ErpProposalItem } from '../../db/types';
import { formatProposalDisplayCode } from './proposal-number';
import { resolveProposalSlaOption } from './proposal-share';

export const INTERNAL_PROPOSAL_PATH_PREFIX = '/interno/proposta';
export const INTERNAL_FIELD_MISSING = 'não definido';

export type InternalProposalKind = 'LOCACAO' | 'SERVICO' | 'SPARE_PARTS' | 'PRODUTOS' | 'CONJUNTO';

export interface InternalProposalSummaryLine {
  id: string;
  description: string;
  detail: string;
  quantityLabel: string;
  unitLabel: string;
  lineLabel: string;
}

export interface InternalProposalMoneyRow {
  label: string;
  value: string;
  testId: string;
}

export interface InternalProposalCondition {
  label: string;
  value: string;
  testId: string;
}

export interface InternalProposalSummaryModel {
  kind: InternalProposalKind;
  kindLabel: string;
  proposalId: string;
  codeLabel: string;
  versionLabel: string;
  versionNumber: number | null;
  status: string;
  statusLabel: string;
  title: string;
  companyName: string;
  companyCnpj: string;
  careOf: string;
  scopeLabel: string;
  itemsHeading: string;
  itemColumn: string;
  unitColumn: string;
  lineColumn: string;
  lines: InternalProposalSummaryLine[];
  termLabel: string;
  termValue: string;
  monthlyLabel: string;
  periodLabel: string;
  periodValue: string;
  oneTimeCaption: string;
  oneTimeRows: InternalProposalMoneyRow[];
  conditions: InternalProposalCondition[];
  internalNotes: string;
  stablePath: string;
  stableUrl: string;
}

const STATUS_LABEL: Record<string, string> = {
  RASCUNHO: 'Rascunho',
  ENVIADA: 'Enviada',
  EM_NEGOCIACAO: 'Em negociação',
  APROVADA: 'Aprovada',
  CONVERTIDA_CONTRATO: 'Convertida em contrato',
  RECUSADA: 'Recusada',
};

const READJUSTMENT_LABEL: Record<string, string> = {
  'IGP-M': 'IGP-M',
  IPCA: 'IPCA',
  FIXO: 'Fixo',
  IST_ANATEL: 'IST (Anatel)',
};

export function buildStableInternalProposalPath(proposalId: string): string {
  const id = String(proposalId || '').trim();
  return `${INTERNAL_PROPOSAL_PATH_PREFIX}/${encodeURIComponent(id)}`;
}

export function buildStableInternalProposalUrl(proposalId: string, origin?: string): string {
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
  if (!m) return INTERNAL_FIELD_MISSING;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function textOrMissing(value: unknown): string {
  const raw = String(value ?? '').trim();
  return raw || INTERNAL_FIELD_MISSING;
}

function formatQty(value: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(
    Number.isFinite(value) ? value : 0
  );
}

/** Spare parts puro. Combinação com suporte/configuração/instalação não vira tipo próprio. */
export function isSparePartsOnlyService(serviceType: string | undefined): boolean {
  const raw = String(serviceType || '').trim().toLowerCase();
  if (!/spare\s*parts|hard\s*parts/.test(raw)) return false;
  const rest = raw
    .replace(/spare\s*parts\s*\/\s*hard\s*parts/g, ' ')
    .replace(/spare\s*parts/g, ' ')
    .replace(/hard\s*parts/g, ' ')
    .replace(/[/,+&()]|(\be\b)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return rest.length === 0;
}

export function resolveInternalProposalKind(
  proposal: Pick<ErpCommercialProposal, 'budgetType' | 'modality' | 'serviceType'>
): InternalProposalKind {
  if (proposal.budgetType === 'PRODUTOS') return 'PRODUTOS';
  if (proposal.budgetType === 'CONJUNTO') return 'CONJUNTO';
  if (proposal.budgetType === 'LOCACAO' || proposal.modality === 'RENTAL') return 'LOCACAO';
  if (proposal.budgetType === 'SERVICOS' || proposal.modality === 'SERVICE') {
    return isSparePartsOnlyService(proposal.serviceType) ? 'SPARE_PARTS' : 'SERVICO';
  }
  if (proposal.modality === 'HYBRID') return 'CONJUNTO';
  return 'LOCACAO';
}

function lineMonthly(item: ErpProposalItem): number {
  if (item.totalMonthly !== undefined && Number.isFinite(Number(item.totalMonthly))) {
    return Number(item.totalMonthly);
  }
  if (item.subtotal !== undefined && Number.isFinite(Number(item.subtotal))) {
    return Number(item.subtotal);
  }
  return Math.round(Number(item.quantity || 0) * Number(item.unitPrice || 0) * 100) / 100;
}

function monthsOf(proposal: ErpCommercialProposal): number | null {
  if (proposal.contractMonths === undefined || proposal.contractMonths === null) return null;
  const n = Number(proposal.contractMonths);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function slaValue(proposal: ErpCommercialProposal): string {
  const resolved = resolveProposalSlaOption(proposal);
  const parts: string[] = [];
  if (resolved.shortLabel && proposal.slaTier && proposal.slaTier !== 'SEM_SLA_ESPECIFICO') {
    parts.push(resolved.shortLabel);
  }
  const availability = String(proposal.slaAvailabilityPercent || '').trim();
  if (availability) parts.push(availability);
  const hours = Number(proposal.slaResponseHours || 0);
  if (Number.isFinite(hours) && hours > 0) parts.push(`resposta em até ${hours}h`);
  return parts.length > 0 ? parts.join(' · ') : INTERNAL_FIELD_MISSING;
}

function readjustmentValue(proposal: ErpCommercialProposal): string {
  const key = String(proposal.readjustmentIndex || '').trim();
  if (!key) return INTERNAL_FIELD_MISSING;
  return READJUSTMENT_LABEL[key] || key;
}

function kindCopy(kind: InternalProposalKind, recurring: boolean): {
  kindLabel: string;
  itemsHeading: string;
  itemColumn: string;
  unitColumn: string;
  lineColumn: string;
  termLabel: string;
  slaLabel: string;
} {
  if (kind === 'LOCACAO') {
    return {
      kindLabel: 'Proposta de locação',
      itemsHeading: 'Equipamentos',
      itemColumn: 'Equipamento',
      unitColumn: 'Mensal unitário',
      lineColumn: 'Mensal da linha',
      termLabel: 'Tempo de locação',
      slaLabel: 'SLA',
    };
  }
  if (kind === 'SPARE_PARTS') {
    return {
      kindLabel: 'Proposta de spare parts',
      itemsHeading: 'Peças',
      itemColumn: 'Peça',
      unitColumn: recurring ? 'Mensal unitário' : 'Valor unitário',
      lineColumn: recurring ? 'Mensal da linha' : 'Total da linha',
      termLabel: 'Vigência / cobertura',
      slaLabel: 'SLA de reposição',
    };
  }
  if (kind === 'SERVICO') {
    return {
      kindLabel: 'Proposta de serviço',
      itemsHeading: 'Serviços',
      itemColumn: 'Serviço',
      unitColumn: recurring ? 'Mensal unitário' : 'Valor unitário',
      lineColumn: recurring ? 'Mensal da linha' : 'Total da linha',
      termLabel: 'Vigência',
      slaLabel: 'SLA',
    };
  }
  if (kind === 'CONJUNTO') {
    return {
      kindLabel: 'Proposta de locação e serviço',
      itemsHeading: 'Itens',
      itemColumn: 'Item',
      unitColumn: recurring ? 'Mensal unitário' : 'Valor unitário',
      lineColumn: recurring ? 'Mensal da linha' : 'Total da linha',
      termLabel: 'Vigência',
      slaLabel: 'SLA',
    };
  }
  return {
    kindLabel: 'Proposta de venda',
    itemsHeading: 'Itens',
    itemColumn: 'Descrição',
    unitColumn: 'Unitário',
    lineColumn: 'Total',
    termLabel: 'Prazo de entrega',
    slaLabel: 'SLA',
  };
}

export function toInternalProposalSummary(
  proposal: ErpCommercialProposal,
  options?: { origin?: string }
): InternalProposalSummaryModel {
  const kind = resolveInternalProposalKind(proposal);
  const recurring =
    kind !== 'PRODUTOS' &&
    (Number(proposal.monthlyRecurringTotal || 0) > 0 ||
      (proposal.items || []).some((item) => item.isRecurring !== false));
  const copy = kindCopy(kind, recurring);
  const months = monthsOf(proposal);
  const monthly =
    proposal.monthlyRecurringTotal === undefined || proposal.monthlyRecurringTotal === null
      ? null
      : Number(proposal.monthlyRecurringTotal);
  const rentalPeriod =
    monthly !== null && Number.isFinite(monthly) && months !== null
      ? Math.round(monthly * months * 100) / 100
      : null;
  const period =
    kind === 'PRODUTOS'
      ? proposal.totalContractValue === undefined || proposal.totalContractValue === null
        ? null
        : Number(proposal.totalContractValue)
      : rentalPeriod;

  const termValue =
    kind === 'PRODUTOS'
      ? textOrMissing(proposal.deliveryLeadTime || proposal.deliveryForecast)
      : months === null
        ? INTERNAL_FIELD_MISSING
        : `${months} ${months === 1 ? 'mês' : 'meses'}`;

  const versionNumber =
    proposal.version === undefined || proposal.version === null || !Number.isFinite(Number(proposal.version))
      ? null
      : Number(proposal.version);

  const showOneTime = kind === 'LOCACAO' || kind === 'CONJUNTO';
  const freight = Number(proposal.shippingCost || 0);
  const setup = Number(proposal.setupFee ?? proposal.oneTimeSetupTotal ?? 0);
  const oneTimeRows: InternalProposalMoneyRow[] = [];
  if (showOneTime || freight > 0) {
    oneTimeRows.push({
      label: 'Frete',
      value: proposal.shippingCost === undefined ? INTERNAL_FIELD_MISSING : formatBrl(freight),
      testId: 'internal-proposal-freight',
    });
  }
  if (showOneTime || setup > 0) {
    oneTimeRows.push({
      label: 'Instalação / setup',
      value:
        proposal.setupFee === undefined && proposal.oneTimeSetupTotal === undefined
          ? INTERNAL_FIELD_MISSING
          : formatBrl(setup),
      testId: 'internal-proposal-setup',
    });
  }

  const scope =
    kind === 'SERVICO' || kind === 'SPARE_PARTS' || kind === 'CONJUNTO'
      ? textOrMissing(proposal.serviceType)
      : '';

  return {
    kind,
    kindLabel: copy.kindLabel,
    proposalId: proposal.id,
    codeLabel: proposal.code ? `#${formatProposalDisplayCode(proposal.code)}` : INTERNAL_FIELD_MISSING,
    versionLabel: versionNumber === null ? INTERNAL_FIELD_MISSING : `Versão ${versionNumber}`,
    versionNumber,
    status: proposal.status || '',
    statusLabel: STATUS_LABEL[proposal.status] || textOrMissing(proposal.status),
    title: textOrMissing(proposal.title),
    companyName: textOrMissing(proposal.companyName),
    companyCnpj: textOrMissing(proposal.companyCnpj),
    careOf: String(proposal.careOf || proposal.contactName || '').trim(),
    scopeLabel: scope,
    itemsHeading: copy.itemsHeading,
    itemColumn: copy.itemColumn,
    unitColumn: copy.unitColumn,
    lineColumn: copy.lineColumn,
    lines: (proposal.items || []).map((item) => ({
      id: item.id,
      description: String(item.description || '').trim() || INTERNAL_FIELD_MISSING,
      detail: [item.sku, item.ncmOrServiceCode].map((v) => String(v || '').trim()).filter(Boolean).join(' · '),
      quantityLabel: formatQty(Number(item.quantity || 0)),
      unitLabel: formatBrl(Number(item.unitPrice || 0)),
      lineLabel: formatBrl(lineMonthly(item)),
    })),
    termLabel: copy.termLabel,
    termValue,
    monthlyLabel: monthly === null || !Number.isFinite(monthly) ? INTERNAL_FIELD_MISSING : formatBrl(monthly),
    periodLabel:
      kind === 'PRODUTOS' || months === null
        ? 'Total do período'
        : `Total em ${months} ${months === 1 ? 'mês' : 'meses'}`,
    periodValue: period === null ? INTERNAL_FIELD_MISSING : formatBrl(period),
    oneTimeCaption: 'Fora da mensalidade. Não entram no total do período.',
    oneTimeRows,
    conditions: [
      { label: 'Índice de reajuste', value: readjustmentValue(proposal), testId: 'internal-proposal-readjustment' },
      { label: copy.slaLabel, value: slaValue(proposal), testId: 'internal-proposal-sla' },
      // A proposta não tem data de início (startDate é do contrato). Não usar prazo de entrega no lugar.
      { label: 'Início previsto', value: INTERNAL_FIELD_MISSING, testId: 'internal-proposal-start' },
      { label: 'Condição de pagamento', value: textOrMissing(proposal.paymentCondition), testId: 'internal-proposal-payment' },
      { label: 'Validade', value: formatIsoDatePt(proposal.validUntil), testId: 'internal-proposal-validity' },
    ],
    internalNotes: String(proposal.internalNotes || '').trim(),
    stablePath: buildStableInternalProposalPath(proposal.id),
    stableUrl: buildStableInternalProposalUrl(proposal.id, options?.origin),
  };
}
