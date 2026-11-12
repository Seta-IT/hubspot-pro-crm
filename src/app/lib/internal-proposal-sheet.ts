import type { ErpCommercialProposal } from '../../db/types';
import { DEFAULT_COMPANY_EMITTER_SETTINGS } from '../../modules/erp/daily-sync-service';
import { formatIssuerAddress, type IssuerAddressInput } from './company-issuer-address';
import {
  FORBIDDEN_TEMPLATE_CNPJ,
  SETA_INTERNAL_BRAND_TITLE,
  SETA_INTERNAL_CLAUSES,
  SETA_INTERNAL_CONFIDENTIALITY,
  SETA_INTERNAL_PROPOSAL_NOTICES,
  isForbiddenTemplateCnpj,
} from './internal-proposal-copy';
import type { InternalProposalKind } from './internal-proposal-summary';

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
  notices: readonly string[];
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
  totalMonthly: string;
  paymentRows: Array<{ due: string; amount: string; method: string; methodMissing: boolean; note: string }>;
  commercialNote: string;
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
  const tainted =
    !input ||
    isForbiddenTemplateCnpj(input.cnpj) ||
    isForbiddenTemplateCnpj(JSON.stringify(input));
  const src = tainted ? fallback : input;
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
    street: street.replace(FORBIDDEN_TEMPLATE_CNPJ, '').trim(),
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
  const months = Number(proposal.contractMonths || 0);
  const monthLabel = months > 0 ? `${months} ${months === 1 ? 'mês' : 'meses'}` : '';
  const service = kind === 'SERVICO' || kind === 'SPARE_PARTS';
  const headline = service
    ? `Proposta de Serviço${monthLabel ? ` - ${monthLabel}` : ''}`
    : `Proposta de Locação${monthLabel ? ` - ${monthLabel}` : ''}`;
  const monthly = Number(proposal.monthlyRecurringTotal || 0);
  const freight = Number(proposal.shippingCost || 0);
  const delivery = String(proposal.deliveryLeadTime || proposal.deliveryForecast || '').trim();
  const code = String(proposal.code || '').replace(/^#/, '').trim();
  const city = String(options?.clientCity || '').trim();
  const uf = String(options?.clientState || '').trim();
  const readjustment = options?.readjustment || 'não definido';
  const sla = options?.slaText || 'não definido';
  const lines = (proposal.items || []).map((item, index) => ({
    index: index + 1,
    sku: String(item.sku || '').trim() || '—',
    name: String(item.description || '').trim() || INTERNAL_FIELD_BLANK,
    detail: String(item.ncmOrServiceCode || '').trim(),
    unit: String(item.unit || 'UN').trim() || 'UN',
    qty: amount(Number(item.quantity || 0)),
    unitPrice: amount(Number(item.unitPrice || 0)),
    subtotal: amount(Number(item.totalMonthly ?? item.subtotal ?? 0)),
  }));
  const qtyTotal = amount((proposal.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0));
  const payment = String(proposal.paymentCondition || '').trim();
  const subject = service ? 'serviço' : 'locação';
  const paymentRows = [
    {
      due: monthLabel ? `Mensal · ${months} mensalidades` : 'Mensal',
      amount: money(monthly),
      method: payment || INTERNAL_FIELD_BLANK,
      methodMissing: !payment,
      note: `Mensalidade da ${subject}, reajuste anual pelo ${readjustment}`,
    },
  ];
  if (freight > 0) {
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
    monthlyLine: `Valor Mensal de ${money(monthly)}`,
    deliveryLine: `Prazo de Entrega Estimado: ${delivery || INTERNAL_FIELD_BLANK}`,
    freightLine: freight > 0 ? `Frete: ${money(freight)} (pagamento único)` : '',
    slaLine: sla === 'não definido' ? '' : sla,
    readjustmentLine: `Reajuste anual: ${readjustment}`,
    notices: SETA_INTERNAL_PROPOSAL_NOTICES,
    validityLine: `VALIDADE DA PROPOSTA: ${formatIsoDatePt(proposal.validUntil)}${daysBetween(proposal.proposalDate, proposal.validUntil)}`,
    deliveryForecastLine: `PREVISÃO DE ENTREGA: ${(delivery || INTERNAL_FIELD_BLANK).toUpperCase()}`,
    clientLegalName: String(proposal.companyName || '').trim() || INTERNAL_FIELD_BLANK,
    clientTradeName: String(proposal.companyName || '').trim() || INTERNAL_FIELD_BLANK,
    clientCnpj: String(proposal.companyCnpj || '').trim() || INTERNAL_FIELD_BLANK,
    clientAddress: String(proposal.deliveryAddress || '').trim() || INTERNAL_FIELD_BLANK,
    clientCep: INTERNAL_FIELD_BLANK,
    clientCityUf: city || uf ? [city, uf].filter(Boolean).join('/') : INTERNAL_FIELD_BLANK,
    clientPhone: INTERNAL_FIELD_BLANK,
    clientEmail: String(proposal.contactEmail || '').trim() || INTERNAL_FIELD_BLANK,
    itemsSection: service ? 'SERVIÇOS' : 'PRODUTOS',
    lines,
    qtyTotal,
    productsMonthly: money(monthly),
    monthlyPlain: amount(monthly),
    freightAmount: money(freight),
    showFreight: freight > 0,
    totalMonthly: money(monthly),
    paymentRows,
    commercialNote: String(proposal.commercialNotes || '').trim(),
    confidentiality: SETA_INTERNAL_CONFIDENTIALITY,
    clauses: SETA_INTERNAL_CLAUSES,
  };
}
