import type { ErpCommercialProposal } from '../../db/types';
import { DEFAULT_COMPANY_EMITTER_SETTINGS } from '../../modules/erp/daily-sync-service';
import { formatIssuerAddress, type IssuerAddressInput } from './company-issuer-address';
import { displayProposalPaymentCondition } from './proposal-monthly-billing';
import { cleanProposalTechnicalClauses, resolveProposalCommercialFigures, resolveProposalCommercialPresentation, resolveProposalDocumentHeadings } from './proposal-share';

import {
  buildDefaultTechnicalSupportClauseParts,
  displayProposalTechnicalClauses,
  isDefaultTechnicalSupportClauses,
  isTechnicalSupportProposal,
} from './proposal-technical-clauses';
import { formatProposalValidUntilPtBr, isProposalEffectiveValidityExpired, effectiveProposalValidUntil } from './proposal-validity';
import {
  SETA_INTERNAL_BRAND_TITLE,
  SETA_INTERNAL_CLAUSES,
  SETA_INTERNAL_CONFIDENTIALITY,
  SETA_INTERNAL_PROPOSAL_NOTICES,
} from './internal-proposal-copy';
import type { InternalProposalKind } from './internal-proposal-summary';
import { proposalLineDetailsText } from './proposal-item-details';

function formatBrl(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatIsoDatePt(value: string | undefined): string {
  const raw = String(value || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return 'não definido';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export const INTERNAL_FIELD_BLANK = 'não informado';

export interface InternalProposalIssuerInput extends IssuerAddressInput {
  legalName?: string | null;
  cnpj?: string | null;
  phone?: string | null;
}

export interface InternalProposalSheet {
  brandTitle: string;
  issuerLegalName: string;
  issuerCnpj: string;
  issuerStreet: string;
  issuerCity: string;
  issuerPhone: string;
  issuerEmail: string;
  sellerName: string;
  budgetNumber: string;
  proposalDateLabel: string;
  contractNumber: string;
  headline: string;
  monthlyLine: string;
  deliveryLine: string;
  freightLine: string;
  slaLine: string;
  readjustmentLine: string;
  /** Quadro de condições: uma linha por informação, rótulo à esquerda e valor à direita. */
  summaryRows: Array<{ label: string; value: string }>;
  notices: readonly string[];
  /** Data em DD/MM/AAAA quando a validade comercial ja passou; senão null. */
  validityExpiredSince: string | null;
  validityLine: string;
  deliveryForecastLine: string;
  clientLegalName: string;
  clientTradeName: string;
  clientCnpj: string;
  clientAddress: string;
  clientCep: string;
  clientCityUf: string;
  clientPhone: string;
  clientEmail: string;
  itemsSection: string;
  lines: Array<{
    index: number;
    sku: string;
    name: string;
    detail: string;
    unit: string;
    qty: string;
    unitPrice: string;
    subtotal: string;
  }>;
  qtyTotal: string;
  productsMonthly: string;
  monthlyPlain: string;
  freightAmount: string;
  showFreight: boolean;
  /** Linha SERVIÇOS/PRODUTOS/PEÇAS no bloco abaixo da tabela. Some quando é igual ao TOTAL e não há frete, desconto ou setup extra. */
  showItemsSubtotal: boolean;
  showDiscount: boolean;
  discountAmount: string;
  showSetup: boolean;
  setupLabel: string;
  setupLineLabel: string;
  setupAmount: string;
  unitPriceColumn: string;
  subtotalColumn: string;
  itemsTotalLabel: string;
  grandTotalLabel: string;
  contractHint: string;
  /** Barra de nº do contrato: só em locação e serviço mensal (não em avulso nem produtos). */
  showContractNumber: boolean;
  totalMonthly: string;
  paymentRows: Array<{ due: string; amount: string; method: string; methodMissing: boolean; note: string }>;
  commercialNote: string;
  /** Observações comerciais quebradas por linha, com o texto original. */
  commercialNoteLines: string[];
  confidentiality: string;
  clauses: readonly { title: string; body: string }[];
}

const shown = (value: unknown): string => {
  const raw = String(value ?? '').trim();
  return raw || INTERNAL_FIELD_BLANK;
};

function money(value: number): string {
  return formatBrl(value).replace(/R\$\s+/u, 'R$\u00A0');
}

function amount(value: number): string {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

/** Quebra um texto livre (commercialNotes) em um item por linha, sem reescrever. */
export function splitCommercialNoteLines(value: unknown): string[] {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Quando as condições vêm num campo livre, cada linha vira um item.
 * "Rótulo: valor" separa as colunas; o restante da linha fica intacto.
 */
export function rowsFromFreeConditionText(value: unknown): Array<{ label: string; value: string }> {
  const pieces = String(value || '')
    .split(/\r?\n|\s+\/\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (pieces.length < 2) return [];
  return pieces.map((line) => {
    const colon = line.indexOf(':');
    if (colon > 0 && colon < 48) {
      const label = line.slice(0, colon).trim();
      const rest = line.slice(colon + 1).trim();
      return { label, value: rest || line };
    }
    return { label: '', value: line };
  });
}


function foldConditionKey(text: string): string {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stripInternalMarkup(text: string): string {
  return String(text || '')
    .replace(/^(?:>>>|\|{2,}|>{2,}|[›»]+)\s*/u, '')
    .replace(/\s*(?:>>>|\|{3,})\s*/g, ' ')
    .trim();
}

const BARE_CONDITION_HEADINGS = new Set([
  'proposta',
  'proposta comercial',
  'orcamento',
  'orcamento comercial',
  'proposta de servico',
  'proposta de locacao',
]);

function officialConditionLabelKey(label: string): string {
  const key = foldConditionKey(label);
  if (key === 'prazo de entrega' || key === 'previsao de entrega') return 'prazo de entrega estimado';
  if (key === 'valor total pagamento unico') return 'valor total';
  return key;
}

function isAssistantMetadataLine(text: string): boolean {
  return /criada por\s+assistente(\s+de\s+vendas)?/i.test(text);
}

function isNoticeBoilerplate(text: string): boolean {
  const key = foldConditionKey(text);
  if (!key) return false;
  for (const notice of SETA_INTERNAL_PROPOSAL_NOTICES) {
    const n = foldConditionKey(notice);
    if (key === n) return true;
    if (key.length >= 40 && (key.includes(n) || n.includes(key))) return true;
  }
  return (
    /disponibilidade dos produtos e precos/.test(key) ||
    /cotacoes com valores em dolar|ptax no dia de faturamento/.test(key) ||
    /apresentamos abaixo a nossa proposta/.test(key) ||
    /somos uma empresa nacional/.test(key) ||
    /esta proposta contempla exclusivamente/.test(key)
  );
}

function isBareConditionHeading(text: string): boolean {
  return BARE_CONDITION_HEADINGS.has(foldConditionKey(text));
}

function isUsableFreeConditionRow(row: { label: string; value: string }): boolean {
  const label = stripInternalMarkup(row.label);
  const value = stripInternalMarkup(row.value);
  if (!label) return false;
  if (isBareConditionHeading(label) && (!value || isBareConditionHeading(value))) return false;
  const combined = `${label} ${value}`;
  if (isAssistantMetadataLine(label) || isAssistantMetadataLine(value) || isAssistantMetadataLine(combined)) return false;
  if (isNoticeBoilerplate(label) || isNoticeBoilerplate(value)) return false;
  return true;
}

function sanitizeCommercialNoteLines(lines: string[], usedLabelKeys: Set<string>): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const line = stripInternalMarkup(raw);
    if (!line) continue;
    if (isAssistantMetadataLine(line) || isNoticeBoilerplate(line) || isBareConditionHeading(line)) continue;
    const colon = line.indexOf(':');
    if (colon > 0 && colon < 48) {
      const key = officialConditionLabelKey(line.slice(0, colon).trim());
      if (key && usedLabelKeys.has(key)) continue;
    }
    out.push(line);
  }
  return out;
}

function daysBetween(from?: string, to?: string): string {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(from || ''));
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(to || ''));
  if (!a || !b) return '';
  const days = Math.round((Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3])) / 86400000);
  if (!Number.isFinite(days) || days < 0) return '';
  return ` (${days} ${days === 1 ? 'DIA' : 'DIAS'})`;
}

export function resolveInternalIssuer(input?: InternalProposalIssuerInput | null): {
  legalName: string;
  cnpj: string;
  street: string;
  city: string;
  phone: string;
} {
  const fallback = DEFAULT_COMPANY_EMITTER_SETTINGS;
  // Emitente = Configurações > Dados da Empresa (09.449.088/0001-06 é o CNPJ real da Seta, confirmado
  // pelo Marcéllo em 27/11/2026; a antiga trava que o tratava como "template" foi removida).
  const src = input || fallback;
  const street = formatIssuerAddress({
    addressStreet: src.addressStreet || fallback.addressStreet,
    addressNumber: src.addressNumber || fallback.addressNumber,
    addressComplement: src.addressComplement || fallback.addressComplement,
    neighborhood: src.neighborhood || fallback.neighborhood,
    city: '',
    state: '',
  });
  const cityOnly = String(src.city || fallback.city || '').split('/')[0].trim();
  const uf = String(src.state || fallback.state || '').trim().toUpperCase();
  return {
    legalName: String(src.legalName || fallback.legalName),
    cnpj: String(src.cnpj || fallback.cnpj),
    street: street.trim(),
    city: [cityOnly, uf].filter(Boolean).join('/'),
    phone: String(src.phone || fallback.phone || ''),
  };
}

export function buildInternalProposalSheet(
  proposal: ErpCommercialProposal,
  kind: InternalProposalKind,
  options?: {
    issuer?: InternalProposalIssuerInput | null;
    contractNumber?: string;
    clientCity?: string | null;
    clientState?: string | null;
    slaText?: string;
    readjustment?: string;
  }
): InternalProposalSheet {
  const issuer = resolveInternalIssuer(options?.issuer);
  const figures = resolveProposalCommercialFigures(proposal);
  const months = figures.months;
  const oneTime = figures.oneTime;
  const partsBudget = proposal.budgetType === 'SPARE_PARTS';
  const monthLabel = partsBudget || oneTime || months <= 0 ? '' : `${months} ${months === 1 ? 'mês' : 'meses'}`;
  const service = !partsBudget && (kind === 'SERVICO' || kind === 'SPARE_PARTS');
  const headline = partsBudget
    ? 'Proposta de Spare Parts / Hard Parts'
    : service
    ? `Proposta de Serviço${monthLabel ? ` - ${monthLabel}` : ''}`
    : `Proposta de Locação${monthLabel ? ` - ${monthLabel}` : ''}`;
  const view = resolveProposalCommercialPresentation(proposal);
  const monthly = oneTime ? view.commercialTotalAmount : view.monthlyAmount;
  const hideFreight = view.hideFreight;
  const freight = view.shippingCost;
  const delivery = String(proposal.deliveryLeadTime || proposal.deliveryForecast || '').trim();
  const code = String(proposal.code || '').replace(/^#/, '').trim();
  const city = String(options?.clientCity || '').trim();
  const uf = String(options?.clientState || '').trim();
  const readjustment = options?.readjustment || 'não definido';
  const sla = options?.slaText || 'não definido';
  const proposalKind = partsBudget ? 'Spare Parts / Hard Parts' : service ? 'Serviço' : 'Locação';
  const itemsSubtotal = view.itemsSubtotal;
  const shownAmount = partsBudget || oneTime ? view.commercialTotalAmount || itemsSubtotal : monthly;
  const summaryRows: Array<{ label: string; value: string }> = [
    { label: 'Proposta', value: partsBudget ? 'Proposta de Spare Parts / Hard Parts' : `${proposalKind}${monthLabel ? ` - ${monthLabel}` : ''}` },
    { label: partsBudget || oneTime ? (oneTime && !partsBudget ? 'Valor total (pagamento único)' : 'Valor total') : 'Valor mensal', value: money(shownAmount) },
    { label: 'Prazo de entrega estimado', value: delivery || INTERNAL_FIELD_BLANK },
  ];
  const setup = view.displaySetupAmount;
  if (view.showSetupInTotals) {
    const setupValue = oneTime || partsBudget
      ? `${money(setup)} (pagamento único)`
      : `${money(setup)} (pagamento único, à parte da mensalidade)`;
    summaryRows.push({ label: view.setupFeeLabel, value: setupValue });
  }
  if (freight > 0) summaryRows.push({ label: 'Frete', value: `${money(freight)} (pagamento único)` });
  if (sla && sla !== 'não definido') summaryRows.push({ label: 'SLA', value: sla });
  if (!oneTime && !partsBudget) summaryRows.push({ label: 'Reajuste anual', value: readjustment });
  const seen = new Set(summaryRows.map((row) => `${row.label}|${row.value}`.toLowerCase()));
  const usedLabelKeys = new Set(summaryRows.map((row) => officialConditionLabelKey(row.label)).filter(Boolean));
  for (const raw of rowsFromFreeConditionText(proposal.commercialNotes)) {
    const row = { label: stripInternalMarkup(raw.label), value: stripInternalMarkup(raw.value) };
    if (!isUsableFreeConditionRow(row)) continue;
    const labelKey = officialConditionLabelKey(row.label);
    if (labelKey && usedLabelKeys.has(labelKey)) continue;
    const key = `${row.label}|${row.value}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (labelKey) usedLabelKeys.add(labelKey);
    summaryRows.push(row);
  }
  const commercialNoteLines = sanitizeCommercialNoteLines(splitCommercialNoteLines(proposal.commercialNotes), usedLabelKeys);
  const lines = (proposal.items || []).map((item, index) => ({
    index: index + 1,
    sku: String(item.sku || '').trim() || '—',
    name: String(item.description || '').trim() || INTERNAL_FIELD_BLANK,
    detail: proposalLineDetailsText(item),
    unit: String(item.unit || 'UN').trim() || 'UN',
    qty: amount(Number(item.quantity || 0)),
    unitPrice: amount(Number(item.unitPrice || 0)),
    subtotal: amount(Number(item.totalMonthly ?? item.subtotal ?? 0)),
  }));
  const qtyTotal = amount((proposal.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0));
  const payment = displayProposalPaymentCondition(proposal);
  const subject = service ? 'serviço' : 'locação';
  const paymentRows = partsBudget
    ? [
        {
          due: 'Pagamento único',
          amount: money(shownAmount),
          method: payment || INTERNAL_FIELD_BLANK,
          methodMissing: !payment,
          note: 'Pagamento único das peças',
        },
      ]
    : oneTime
    ? [
        {
          due: 'Pagamento único',
          amount: money(shownAmount),
          method: payment || INTERNAL_FIELD_BLANK,
          methodMissing: !payment,
          note: `Pagamento único do ${subject}`,
        },
      ]
    : [
        {
          due: monthLabel ? `Mensal · ${months} mensalidades` : 'Mensal',
          amount: money(monthly),
          method: payment || INTERNAL_FIELD_BLANK,
          methodMissing: !payment,
          note: `Mensalidade da ${subject}, reajuste anual pelo ${readjustment}`,
        },
      ];
  // No avulso/venda o total único já inclui setup e frete (mesma conta da folha pública).
  // Só parcela setup/frete à parte na locação e no serviço mensal.
  if (view.showSetupInTotals && !oneTime && !partsBudget) {
    paymentRows.push({
      due: 'Pagamento único',
      amount: money(setup),
      method: payment || INTERNAL_FIELD_BLANK,
      methodMissing: !payment,
      note: `${view.setupFeeLabel}, cobrado uma única vez (não incluso na mensalidade)`,
    });
  }
  if (freight > 0 && !oneTime && !partsBudget) {
    paymentRows.push({
      due: 'Pagamento único',
      amount: money(freight),
      method: INTERNAL_FIELD_BLANK,
      methodMissing: true,
      note: 'Frete de entrega, cobrado uma única vez',
    });
  }
  return {
    brandTitle: SETA_INTERNAL_BRAND_TITLE,
    issuerLegalName: issuer.legalName,
    issuerCnpj: issuer.cnpj,
    issuerStreet: issuer.street,
    issuerCity: issuer.city,
    issuerPhone: String(proposal.sellerPhone || issuer.phone || '').trim(),
    issuerEmail: String(proposal.sellerEmail || '').trim(),
    sellerName: String(proposal.sellerName || '').trim(),
    budgetNumber: code,
    proposalDateLabel: formatIsoDatePt(proposal.proposalDate || proposal.createdAt),
    contractNumber: String(options?.contractNumber || '').trim(),
    headline,
    monthlyLine: partsBudget
      ? `Valor total de ${money(shownAmount)}`
      : oneTime
        ? `Valor total (pagamento único) de ${money(shownAmount)}`
        : `Valor Mensal de ${money(monthly)}`,
    deliveryLine: `Prazo de Entrega Estimado: ${delivery || INTERNAL_FIELD_BLANK}`,
    freightLine: freight > 0 ? `Frete: ${money(freight)} (pagamento único)` : '',
    slaLine: sla === 'não definido' ? '' : sla,
    readjustmentLine: partsBudget || oneTime ? '' : `Reajuste anual: ${readjustment}`,
    summaryRows,
    notices: SETA_INTERNAL_PROPOSAL_NOTICES,
    validityExpiredSince: (() => {
      if (!isProposalEffectiveValidityExpired(proposal)) return null;
      const effective = effectiveProposalValidUntil(proposal);
      return formatProposalValidUntilPtBr(effective) || (effective ? formatIsoDatePt(effective) : null);
    })(),
    validityLine: `VALIDADE DA PROPOSTA: ${formatIsoDatePt(proposal.validUntil)}${daysBetween(proposal.proposalDate, proposal.validUntil)}`,
    deliveryForecastLine: `PREVISÃO DE ENTREGA: ${(delivery || INTERNAL_FIELD_BLANK).toUpperCase()}`,
    clientLegalName: String(proposal.companyName || '').trim() || INTERNAL_FIELD_BLANK,
    clientTradeName: String(proposal.companyName || '').trim() || INTERNAL_FIELD_BLANK,
    clientCnpj: String(proposal.companyCnpj || '').trim() || INTERNAL_FIELD_BLANK,
    clientAddress: hideFreight ? INTERNAL_FIELD_BLANK : (String(proposal.deliveryAddress || '').trim() || INTERNAL_FIELD_BLANK),
    clientCep: INTERNAL_FIELD_BLANK,
    clientCityUf: city || uf ? [city, uf].filter(Boolean).join('/') : INTERNAL_FIELD_BLANK,
    clientPhone: INTERNAL_FIELD_BLANK,
    clientEmail: String(proposal.contactEmail || '').trim() || INTERNAL_FIELD_BLANK,
    itemsSection: partsBudget ? 'PEÇAS' : service ? 'SERVIÇOS' : 'PRODUTOS',
    lines,
    qtyTotal,
    productsMonthly: money(oneTime || partsBudget ? (partsBudget ? itemsSubtotal : (service ? view.servicesSubtotal : view.productsSubtotal || itemsSubtotal)) : monthly),
    monthlyPlain: amount(oneTime || partsBudget ? itemsSubtotal || shownAmount : monthly),
    freightAmount: money(freight),
    showFreight: freight > 0,
    showSetup: view.showSetupInTotals,
    showDiscount: view.totalDiscounts > 0,
    discountAmount: money(view.totalDiscounts),
    showItemsSubtotal:
      view.showSetupInTotals
      || freight > 0
      || view.totalDiscounts > 0
      || Math.round((oneTime || partsBudget
        ? (partsBudget ? itemsSubtotal : (service ? view.servicesSubtotal : view.productsSubtotal || itemsSubtotal))
        : monthly) * 100) / 100
        !== Math.round((shownAmount || 0) * 100) / 100,
    setupLabel: view.setupFeeLabel,
    setupLineLabel: oneTime || partsBudget
      ? `${view.setupFeeLabel} (pagamento único)`
      : `${view.setupFeeLabel} (pagamento único, à parte da mensalidade)`,
    setupAmount: money(setup),
    unitPriceColumn: oneTime || partsBudget ? 'Vr. unitário' : 'Vr. unit. mensal',
    subtotalColumn: oneTime || partsBudget ? 'Subtotal' : 'Subtotal mensal',
    itemsTotalLabel: oneTime || partsBudget
      ? `${partsBudget ? 'PEÇAS' : service ? 'SERVIÇOS' : 'PRODUTOS'}:`
      : `${partsBudget ? 'PEÇAS' : service ? 'SERVIÇOS' : 'PRODUTOS'} (mensal):`,
    grandTotalLabel: oneTime || partsBudget ? 'TOTAL:' : 'TOTAL MENSAL:',
    showContractNumber: !oneTime && (kind === 'LOCACAO' || kind === 'SERVICO'),
    contractHint: !oneTime && kind === 'LOCACAO'
      ? 'preenchido quando a proposta for convertida em contrato de locação'
      : !oneTime && kind === 'SERVICO'
        ? 'preenchido quando a proposta for convertida em contrato'
        : '',
    totalMonthly: money(shownAmount),
    paymentRows,
    commercialNote: String(proposal.commercialNotes || '').trim(),
    commercialNoteLines,
    ...resolveSheetTechnicalObservations(proposal),
  };
}

function resolveSheetTechnicalObservations(proposal: ErpCommercialProposal): {
  confidentiality: string;
  clauses: readonly { title: string; body: string }[];
} {
  // Mesma regra da proposta pública (displayProposalTechnicalClauses):
  // suporte técnico usa o texto de suporte; demais tipos só o texto gravado.
  // Cláusulas de remessa/locação ficam só na folha de locação pura, quando
  // não há texto próprio — nunca em proposta de serviço ou venda.
  if (isTechnicalSupportProposal(proposal)) {
    const stored = cleanProposalTechnicalClauses(proposal.technicalClauses);
    if (stored && !isDefaultTechnicalSupportClauses(stored)) {
      return { confidentiality: stored, clauses: [] };
    }
    return buildDefaultTechnicalSupportClauseParts(proposal);
  }
  const stored = displayProposalTechnicalClauses(proposal);
  if (stored) {
    return { confidentiality: stored, clauses: [] };
  }
  const headings = resolveProposalDocumentHeadings(proposal);
  if (headings.effectiveBudgetType === 'LOCACAO') {
    return { confidentiality: SETA_INTERNAL_CONFIDENTIALITY, clauses: SETA_INTERNAL_CLAUSES };
  }
  return { confidentiality: SETA_INTERNAL_CONFIDENTIALITY, clauses: [] };
}
