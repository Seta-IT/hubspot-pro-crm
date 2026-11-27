// ============================================================================
// Grade de produtos/serviços do orçamento no padrão GestãoClick:
// formatação pt-BR (2 casas), tabela de preço (Varejo / Atacado) e detalhes livres.
// ============================================================================

import { proposalLineDetailsText } from './proposal-item-details';
import type { ErpCatalogItem, ErpProposalItem } from '../../db/types';
import { catalogPriceFor } from './catalog-search';

export const PRICE_TABLE_VAREJO = 'VAREJO';
export const PRICE_TABLE_ATACADO = 'ATACADO';

export type ProposalDiscountType = 'BRL' | 'PERCENT';

export interface CatalogPriceTable {
  id: string;
  name: string;
  price: number;
}

export function formatPtBrDecimal(value: number | null | undefined, digits = 2): string {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(safe);
}

export function formatPtBrMoney(value: number | null | undefined): string {
  return `R$ ${formatPtBrDecimal(value, 2)}`;
}

/** Aceita "1.625,00", "1625,00", "1625.00" ou "1625". */
export function parsePtBrDecimal(raw: string): number {
  const cleaned = String(raw || '').replace(/[^\d,.-]/g, '').trim();
  if (!cleaned) return 0;
  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

export function looksLikeFiscalCode(value: string | null | undefined): boolean {
  const v = String(value || '').trim();
  if (!v) return false;
  if (/^NCM\b/i.test(v)) return true;
  if (/^\d{4}\.\d{2}\.\d{2}/.test(v)) return true;
  if (/^LC\s*116/i.test(v)) return true;
  return false;
}

/** Detalhes livres da linha (não é NCM). */
export function proposalItemDetails(item: {
  lineDetails?: string | null;
  details?: string | null;
  ncmOrServiceCode?: string | null;
}): string {
  // Mesma regra da coluna Detalhes da grade (proposal-item-details): lineDetails, depois details;
  // NCM/LC 116 automático nunca aparece como Detalhes.
  if (typeof item.lineDetails === 'string' || (item.details != null && String(item.details).trim() !== '')) {
    return proposalLineDetailsText(item);
  }
  const raw = proposalLineDetailsText(item).trim();
  if (!raw || looksLikeFiscalCode(raw)) return '';
  return raw;
}

export function lineNetAmount(input: {
  quantity?: number;
  unitPrice?: number;
  discountPercent?: number;
  discountAmount?: number;
}): number {
  const qty = Math.max(0, Number(input.quantity || 0));
  const unit = Math.max(0, Number(input.unitPrice || 0));
  const discPct = Math.max(0, Math.min(100, Number(input.discountPercent || 0)));
  const discAmt = Math.max(0, Number(input.discountAmount || 0));
  return Math.max(0, Math.round((qty * unit * (1 - discPct / 100) - discAmt) * 100) / 100);
}

function slugTableId(name: string): string {
  const folded = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  if (folded === 'VAREJO' || folded === 'VENDA_VAREJO' || folded === 'VENDA') return PRICE_TABLE_VAREJO;
  if (folded === 'ATACADO' || folded === 'CORPORATIVO' || folded === 'VENDA_ATACADO') return PRICE_TABLE_ATACADO;
  return folded || PRICE_TABLE_VAREJO;
}

/** Tabelas de preço do módulo: Varejo e Atacado, mais as listas do próprio item (valores[] do GC). */
export function catalogPriceTables(
  found: ErpCatalogItem | null | undefined,
  rental = false
): CatalogPriceTable[] {
  const extras = Array.isArray(found?.priceTables)
    ? found!.priceTables!.filter((t) => t && String(t.name || '').trim())
    : [];
  if (extras.length > 0) {
    return extras.map((t) => ({
      id: String(t.id || slugTableId(t.name)),
      name: String(t.name).trim(),
      price: Math.max(0, Number(t.price || 0)),
    }));
  }
  const varejo = rental
    ? Number(found?.monthlyRentalPrice || found?.saleOrSetupPrice || 0)
    : Number(found?.saleOrSetupPrice || found?.monthlyRentalPrice || 0);
  const atacadoRaw = Number(found?.wholesalePrice);
  const atacado = Number.isFinite(atacadoRaw) && atacadoRaw > 0 ? atacadoRaw : varejo;
  return [
    { id: PRICE_TABLE_VAREJO, name: 'Varejo', price: Math.max(0, varejo) },
    { id: PRICE_TABLE_ATACADO, name: 'Atacado', price: Math.max(0, atacado) },
  ];
}

export function catalogPriceForTable(
  found: ErpCatalogItem | null | undefined,
  tableId: string | null | undefined,
  kind: 'PRODUCT' | 'SERVICE',
  rental: boolean
): number {
  if (!found) return 0;
  const tables = catalogPriceTables(found, kind === 'SERVICE' ? false : rental);
  const id = String(tableId || PRICE_TABLE_VAREJO);
  const match = tables.find((t) => t.id === id || slugTableId(t.name) === id);
  if (match) return match.price;
  return catalogPriceFor(found, kind, rental);
}

export function inferPriceTableId(
  item: Pick<ErpProposalItem, 'unitPrice' | 'priceTableId' | 'priceTableName'>,
  found: ErpCatalogItem | null | undefined,
  rental: boolean
): string {
  const named = String(item.priceTableId || '').trim() || (item.priceTableName ? slugTableId(item.priceTableName) : '');
  const tables = catalogPriceTables(found, rental);
  if (named && tables.some((t) => t.id === named)) return named;
  if (found) {
    const unit = Number(item.unitPrice || 0);
    const atacado = tables.find((t) => t.id === PRICE_TABLE_ATACADO);
    if (atacado && unit > 0 && Math.abs(atacado.price - unit) < 0.005) return PRICE_TABLE_ATACADO;
  }
  return tables[0]?.id || PRICE_TABLE_VAREJO;
}

export function resolveDiscountType(item: Partial<Pick<ErpProposalItem, 'discountType' | 'discountPercent' | 'discountAmount'>>): ProposalDiscountType {
  const raw = String(item.discountType || '').trim().toUpperCase();
  if (raw === 'PERCENT' || raw === '%' || raw === 'PORCENTAGEM' || raw === 'PERCENTUAL') return 'PERCENT';
  if (raw === 'BRL' || raw === 'R$' || raw === 'VALOR' || raw === 'REAIS') return 'BRL';
  if (Number(item.discountPercent || 0) > 0) return 'PERCENT';
  return 'BRL';
}

/** Mapeia o array valores[] do GestãoClick para as tabelas de preço do catálogo. */
export function priceTablesFromGcValores(valores: unknown): CatalogPriceTable[] {
  if (!Array.isArray(valores)) return [];
  const tables: CatalogPriceTable[] = [];
  for (const raw of valores) {
    const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const name = String(row.nome_tipo || row.nome || '').trim();
    if (!name) continue;
    tables.push({
      id: String(row.tipo_id || row.id || slugTableId(name)),
      name,
      price: Math.max(0, Number(row.valor_venda || 0)),
    });
  }
  return tables;
}
