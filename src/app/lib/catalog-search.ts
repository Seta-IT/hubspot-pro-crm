import type { ErpCatalogItem, ErpRentalEquipmentItem } from '../../db/types';

/**
 * Busca de itens do catálogo usada pelo campo de produtos dos orçamentos e do contrato.
 * Um único lugar para a regra: nome, código, marca, modelo e código de barras,
 * sem acento, sem diferenciar maiúsculas e ignorando separadores no código
 * ("c3850" acha "WS-C3850-48F-S"; "ws c3850 48f" também).
 */

export function foldQuery(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Só letras e números: tira hífen, ponto, barra e espaço. */
export function compactQuery(value: string): string {
  return foldQuery(value).replace(/[^a-z0-9]/g, '');
}

const SERVICE_NATURES = new Set(['SERVICO_TECNICO_TI_TELECOM', 'SERVICO_COMUNICACAO_SCM_SVA']);

export function isServiceCatalogItem(c: ErpCatalogItem): boolean {
  return (
    SERVICE_NATURES.has(String(c.fiscalNature)) ||
    c.category === 'SERVICO_TECNICO_LC116' ||
    c.category === 'TELECOM_SCM_SVA'
  );
}

function tokenMatches(token: string, folded: string, compact: string): boolean {
  if (folded.includes(token)) return true;
  const ct = compactQuery(token);
  return ct.length > 0 && compact.includes(ct);
}

/** Pontuação para ordenar: código que começa com a busca, código que contém, demais campos. */
function scoreItem(c: ErpCatalogItem, compactQ: string): number {
  const code = compactQuery(c.gestaoClickCode || '');
  if (compactQ && code.startsWith(compactQ)) return 0;
  if (compactQ && code.includes(compactQ)) return 1;
  return 2;
}

export function filterCatalogProducts(
  catalog: ErpCatalogItem[],
  query: string,
  maxResults = 10
): ErpCatalogItem[] {
  const q = foldQuery(query);
  if (q.length < 1) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const compactQ = compactQuery(q);
  const pool = (catalog || []).filter((c) => c && c.isActive !== false);
  const hits: Array<{ item: ErpCatalogItem; score: number; order: number }> = [];
  pool.forEach((c, order) => {
    const fields = [c.gestaoClickCode, c.name, c.brand, c.modelName, c.barcodeEan].map((f) => String(f || ''));
    const folded = foldQuery(fields.join(' '));
    const compact = fields.map(compactQuery).join(' ');
    const wholeCompact = compactQ.length > 0 && fields.some((f) => compactQuery(f).includes(compactQ));
    if (wholeCompact || tokens.every((t) => tokenMatches(t, folded, compact))) {
      hits.push({ item: c, score: scoreItem(c, compactQ), order });
    }
  });
  return hits
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .slice(0, maxResults)
    .map((h) => h.item);
}

export type CatalogGridKind = 'PRODUCT' | 'SERVICE';

/** Preço do catálogo do mesmo jeito do orçamento: locação/serviço usa o mensal, venda usa o de venda. */
export function catalogPriceFor(found: ErpCatalogItem, kind: CatalogGridKind, rental: boolean): number {
  if (kind === 'SERVICE') return Number(found.monthlyRentalPrice || found.saleOrSetupPrice || 0);
  return Number(
    rental ? found.monthlyRentalPrice || found.saleOrSetupPrice || 0 : found.saleOrSetupPrice || found.monthlyRentalPrice || 0
  );
}

/** Valor mensal de locação (contrato e orçamento de locação). */
export function catalogRentalPrice(item: ErpCatalogItem): number {
  return catalogPriceFor(item, 'PRODUCT', true);
}

/**
 * Linha de produto do contrato criada pelo mesmo campo do orçamento:
 * item do catálogo (código, nome, valor mensal, NCM) ou item livre com o texto digitado.
 */
export function buildContractEquipmentFromCatalog(
  found: ErpCatalogItem | null,
  freeText: string,
  opts: { remessaCfop?: ErpRentalEquipmentItem['remessaCfop']; id?: string } = {}
): ErpRentalEquipmentItem {
  const ncmMatch = String(found?.ncmOrLc116 || '').match(/\d{4}\.\d{2}\.\d{2}/);
  return {
    id: opts.id || `eq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    skuGestaoClick: found?.gestaoClickCode || '',
    description: found?.name || String(freeText || '').trim(),
    variationDetails: found?.unitOfMeasure || '',
    serialNumber: '',
    assetTag: '',
    assetStatus: 'EM_CLIENTE',
    ncm: ncmMatch ? ncmMatch[0] : '8517.62.59',
    quantity: 1,
    stockAvailable: found?.stockAvailable,
    unitMonthlyRent: found ? catalogRentalPrice(found) : 0,
    assetValueBrl: 0,
    remessaCfop: opts.remessaCfop || '5.908',
    remessaNfeKey: '',
  };
}
