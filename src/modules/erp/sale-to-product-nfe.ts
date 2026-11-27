// ============================================================================
// Contrato: emitir NF-e de produtos a partir de uma venda
// ----------------------------------------------------------------------------
// O módulo de Vendas (ERP - Vendas, OS & Estoque) chama estas rotas no
// ⋮ > Emitir > NF-e. O mapeamento é puro (sem I/O) e reaproveita o formulário
// "Adicionar NF-e" (ProductNfeForm) e o cadastro POST /api/erp/nfe-produtos.
//
// Rotas (alçada canIssueFiscalDocuments + 2FA; sessão só por cookie/_sessionToken):
//
//   GET  /api/erp/vendas/:vendaId/nfe
//        Pré-preenche o formulário. Não grava nada.
//        :vendaId = id da venda (ou, em último caso, o código).
//
//   POST /api/erp/vendas/:vendaId/nfe
//        Cadastra o rascunho (status RASCUNHO, tpAmb=2 se homologação) e
//        grava invoice.saleOrderId = :vendaId.
//        Corpo (zod .strict(), todos os campos opcionais):
//          { "force": false, "draft": { ...ProductNfeDraft } }
//        Sem `draft`, o servidor mapeia a venda. Com `draft`, vale o formulário
//        revisado (já validado por productNfeDraftSchema).
//        `force: true` é obrigatório se já existir NF-e ativa da mesma venda.
//
// Resposta GET 200:
//   { data: {
//       sale: { id, code, status, saleType, totalAmount, companyName },
//       draft,                  // pré-preenchimento do ProductNfeForm
//       context,                // mesmo formato de GET /api/erp/nfe-produtos/context
//       existing,               // null ou resumo da NF-e ativa já vinculada
//       warnings: string[],
//       missingRequired: [{ path, message }],
//       readyToCreate: boolean  // false se faltar campo obrigatório (ex.: NCM, tipo de contribuinte)
//     } }
//
// Resposta POST 201: { data: ErpFiscalInvoice, warnings: string[] }
//
// Erros:
//   401  PRODUCT_NFE_AUTH_REQUIRED          sessão ausente
//   403  (denyFiscalIssuance)               sem alçada / sem 2FA / conta de serviço
//   404  SALE_NOT_FOUND                     venda inexistente
//   422  SALE_NFE_NOT_ELIGIBLE              serviço, devolução ou venda cancelada
//   400  SALE_NFE_INVALID_INPUT             corpo ou rascunho inválido
//   400  SALE_NFE_INCOMPLETE                mapeamento sem campo obrigatório (POST sem draft)
//   409  SALE_NFE_ALREADY_EXISTS            já há NF-e ativa; envie force: true para cadastrar outra
//   409  PRODUCT_NFE_NUMBER_IN_USE          número da série já usado no ambiente
//
// NFC-e e NFS-e não têm rota aqui: a UI deve mostrar "Em breve".
// ============================================================================

import type {
  Company,
  ErpCatalogItem,
  ErpFiscalInvoice,
  ErpSaleOrder,
  ErpTaxRegime,
  FiscalEnvironment,
} from '../../db/types';
import { z } from 'zod';
import {
  crtFromRegime,
  productNfeDraftSchema,
  suggestCfop,
  suggestIcmsCode,
  type ProductNfeDraftInput,
} from './product-nfe-engine';

const onlyDigits = (v: unknown) => String(v ?? '').replace(/\D/g, '');

export const SALE_NFE_PATH_RE = /^\/api\/erp\/vendas\/([^/]+)\/nfe$/;

export type SaleNfeExistingSummary = {
  id: string;
  nNF: number | null;
  serie: string | null;
  status: string;
  sefazStatus: string | null;
  documentNumber: string;
  environment: FiscalEnvironment | null;
};

export type SaleNfeMissingField = { path: string; message: string };

export type SaleNfePrefill = {
  draft: ProductNfeDraftInput;
  warnings: string[];
  missingRequired: SaleNfeMissingField[];
  existing: SaleNfeExistingSummary | null;
  readyToCreate: boolean;
};

function normName(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatBrasiliaDateTime(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const g = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

export function extractNcm(raw: unknown): string {
  const m = onlyDigits(raw).match(/\d{8}/);
  return m ? m[0] : '';
}

export function parseCityState(v: unknown): { city: string; uf: string } {
  const s = String(v ?? '').trim();
  const m = /^(.*?)[\s]*[(/-][\s]*([A-Za-z]{2})\)?$/.exec(s);
  return m ? { city: m[1].trim(), uf: m[2].toUpperCase() } : { city: s, uf: '' };
}

/** Destino da operação e CFOP 5.102 / 6.102 / 7.102 a partir da UF do destinatário. */
export function suggestDestination(emitterUf: string, destUf: string): { idDest: '1' | '2' | '3'; cfop: string } {
  const em = String(emitterUf || 'SP').trim().toUpperCase().slice(0, 2);
  const uf = String(destUf || '').trim().toUpperCase().slice(0, 2);
  if (!uf) return { idDest: '1', cfop: suggestCfop('1') };
  if (uf === 'EX') return { idDest: '3', cfop: suggestCfop('3') };
  if (uf === em) return { idDest: '1', cfop: suggestCfop('1') };
  return { idDest: '2', cfop: suggestCfop('2') };
}

export function paymentMethodToTPag(method: unknown): { hasPayment: boolean; tPag: '01' | '03' | '04' | '15' | '17' | '90' | '99' } {
  const s = normName(method);
  if (!s) return { hasPayment: false, tPag: '90' };
  if (/sem pagamento|cortesia|bonific/.test(s)) return { hasPayment: false, tPag: '90' };
  if (/pix/.test(s)) return { hasPayment: true, tPag: '17' };
  if (/boleto/.test(s)) return { hasPayment: true, tPag: '15' };
  if (/debito|débito/.test(s) || /cartao de debito/.test(s)) return { hasPayment: true, tPag: '04' };
  if (/credito|crédito|cartao/.test(s)) return { hasPayment: true, tPag: '03' };
  if (/dinheiro|especie|esp[eé]cie/.test(s)) return { hasPayment: true, tPag: '01' };
  return { hasPayment: true, tPag: '99' };
}

export function mapFreightModality(sale: ErpSaleOrder): '0' | '1' | '2' | '3' | '4' | '9' {
  const raw = String(sale.freightModality || '').trim();
  if (/^[012349]$/.test(raw)) return raw as '0' | '1' | '2' | '3' | '4' | '9';
  const s = normName(raw);
  if (/^cif|remetente/.test(s)) return '0';
  if (/^fob|destinatario/.test(s)) return '1';
  if (/terceiro/.test(s)) return '2';
  if (/proprio.*remetente|proprio_seta|proprio seta/.test(s)) return '3';
  if (/proprio.*destinat/.test(s)) return '4';
  if (Number(sale.freightValue || 0) > 0) return '0';
  return '9';
}

export function findCompanyForSale(sale: ErpSaleOrder, companies: Company[]): Company | null {
  const byId = sale.companyId ? companies.find((c) => c.id === sale.companyId) : undefined;
  if (byId) return byId;
  const cnpj = onlyDigits(sale.companyCnpj);
  if (cnpj.length >= 11) {
    const byCnpj = companies.find((c) => onlyDigits(c.cnpj) === cnpj);
    if (byCnpj) return byCnpj;
  }
  const name = normName(sale.companyName);
  if (!name) return null;
  const exact = companies.filter((c) => normName(c.name) === name || normName((c.customProperties || {}).legalName) === name);
  return exact.length === 1 ? exact[0] : exact[0] || null;
}

export function matchCatalogItem(
  item: { catalogItemId?: string | null; code?: string; description?: string },
  catalog: ErpCatalogItem[]
): ErpCatalogItem | null {
  if (!catalog?.length) return null;
  if (item.catalogItemId) {
    const hit = catalog.find((c) => c.id === item.catalogItemId || c.gestaoClickId === item.catalogItemId);
    if (hit) return hit;
  }
  const code = String(item.code || '').trim();
  if (code) {
    const hit = catalog.find((c) => c.gestaoClickCode === code || c.id === code);
    if (hit) return hit;
  }
  const name = normName(item.description);
  if (!name) return null;
  const exact = catalog.filter((c) => normName(c.name) === name);
  if (exact.length === 1) return exact[0];
  const includes = catalog.filter((c) => normName(c.name).includes(name) || name.includes(normName(c.name)));
  return includes.length === 1 ? includes[0] : null;
}

export function isCancelledSale(sale: ErpSaleOrder): boolean {
  return /cancelad|estornad|devolvid/i.test(String(sale.status || ''));
}

export function saleNfeEligibility(
  sale: ErpSaleOrder
): { ok: true } | { ok: false; code: 'SALE_NFE_NOT_ELIGIBLE'; error: string } {
  if (sale.saleType === 'SERVICO') {
    return { ok: false, code: 'SALE_NFE_NOT_ELIGIBLE', error: 'Venda de serviço não gera NF-e de produtos. A NFS-e ainda não está disponível (Em breve).' };
  }
  if (sale.saleType === 'DEVOLUCAO' || /devolvid/i.test(String(sale.status || ''))) {
    return { ok: false, code: 'SALE_NFE_NOT_ELIGIBLE', error: 'Devolução não gera NF-e de venda por este caminho. Use uma NF-e de devolução de mercadoria.' };
  }
  if (/cancelad|estornad/i.test(String(sale.status || ''))) {
    return { ok: false, code: 'SALE_NFE_NOT_ELIGIBLE', error: 'Não é possível emitir NF-e de uma venda cancelada ou estornada.' };
  }
  return { ok: true };
}

export function isActiveProductNfe(inv: ErpFiscalInvoice): boolean {
  if (!inv.productNfe) return false;
  if (inv.status === 'CANCELADA') return false;
  if (inv.productNfe.sefaz?.status === 'CANCELADA') return false;
  return true;
}

export function findActiveProductNfeForSale(
  invoices: ErpFiscalInvoice[],
  saleId: string,
  saleCode?: string
): ErpFiscalInvoice | null {
  const ids = new Set([String(saleId || '').trim(), String(saleCode || '').trim()].filter(Boolean));
  if (!ids.size) return null;
  const list = invoices.filter((inv) => inv.saleOrderId && ids.has(inv.saleOrderId) && isActiveProductNfe(inv));
  list.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  return list[0] || null;
}

export function summarizeSaleNfe(inv: ErpFiscalInvoice): SaleNfeExistingSummary {
  return {
    id: inv.id,
    nNF: inv.productNfe?.nNF ?? null,
    serie: inv.productNfe?.serie ?? null,
    status: inv.status,
    sefazStatus: inv.productNfe?.sefaz?.status ?? null,
    documentNumber: inv.documentNumber,
    environment: inv.productNfe?.environment ?? null,
  };
}

function taxpayerFromCompany(company: Company | null, sale: ErpSaleOrder): { taxpayerType: string; ie: string; suframa: string; im: string } {
  if (sale.taxpayerType === '1' || sale.taxpayerType === '2' || sale.taxpayerType === '9') {
    return {
      taxpayerType: sale.taxpayerType,
      ie: String(sale.ie || ''),
      suframa: String(sale.suframa || ''),
      im: String(sale.im || ''),
    };
  }
  const cp = (company?.customProperties || {}) as Record<string, unknown>;
  const ieVal = String(sale.ie || cp.stateRegistration || '');
  const ieInd = String(cp.ieIndicator || '').toLowerCase();
  const taxpayerType = /isento/.test(ieInd) || /^isento$/i.test(ieVal)
    ? '2'
    : /não|nao/.test(ieInd)
      ? '9'
      : onlyDigits(ieVal)
        ? '1'
        : '';
  return {
    taxpayerType,
    ie: /^isento$/i.test(ieVal) ? '' : ieVal,
    suframa: String(sale.suframa || cp.suframa || ''),
    im: String(sale.im || cp.municipalRegistration || ''),
  };
}

function addressFromSaleOrCompany(sale: ErpSaleOrder, company: Company | null) {
  const a = sale.address || {};
  const cp = (company?.customProperties || {}) as Record<string, unknown>;
  const ca = (Array.isArray(cp.addresses) && cp.addresses[0] ? cp.addresses[0] : {}) as Record<string, unknown>;
  const cs = parseCityState(ca.cityState);
  return {
    cep: String(a.cep || ca.cep || ''),
    street: String(a.street || ca.street || ''),
    number: String(a.number || ca.number || ''),
    complement: String(a.complement || ca.complement || ''),
    district: String(a.district || ca.neighborhood || ''),
    city: String(a.city || cs.city || company?.city || ''),
    uf: String(a.uf || cs.uf || company?.state || '')
      .toUpperCase()
      .slice(0, 2),
    cityIbge: onlyDigits(a.cityIbge || ca.ibgeCode).slice(0, 7),
  };
}

export interface MapSaleToNfeContext {
  taxRegime: ErpTaxRegime;
  emitterUf: string;
  serie: string;
  additionalInfo: string;
  company?: Company | null;
  catalog?: ErpCatalogItem[];
  invoices?: ErpFiscalInvoice[];
  now?: Date;
}

export function mapSaleToProductNfeDraft(sale: ErpSaleOrder, ctx: MapSaleToNfeContext): SaleNfePrefill {
  const warnings: string[] = [];
  const missingRequired: SaleNfeMissingField[] = [];
  const company = ctx.company ?? null;
  const catalog = ctx.catalog || [];
  const tax = taxpayerFromCompany(company, sale);
  const addr = addressFromSaleOrCompany(sale, company);
  const dest = suggestDestination(ctx.emitterUf || 'SP', addr.uf);
  if (!addr.uf) {
    warnings.push('A UF do destinatário não veio da venda nem do cadastro do cliente; o destino foi assumido como operação interna (CFOP 5.102). Confira antes de cadastrar.');
  } else if (dest.idDest === '2') {
    warnings.push(`Operação interestadual (${addr.uf}): CFOP 6.102 aplicado nos itens.`);
  }
  const cp = (company?.customProperties || {}) as Record<string, unknown>;
  const docDigits = onlyDigits(sale.companyCnpj || company?.cnpj);
  const documentType: 'CNPJ' | 'CPF' = docDigits.length === 11 ? 'CPF' : 'CNPJ';
  const name = String(sale.companyLegalName || cp.legalName || company?.name || sale.companyName || '')
    .trim()
    .slice(0, 60);

  if (!docDigits) missingRequired.push({ path: 'recipient.document', message: 'Informe o CNPJ ou CPF do destinatário.' });
  if (!name) missingRequired.push({ path: 'recipient.name', message: 'Informe a razão social do destinatário.' });
  if (!tax.taxpayerType) {
    missingRequired.push({ path: 'recipient.taxpayerType', message: 'Tipo de contribuinte é obrigatório.' });
    warnings.push('Tipo de contribuinte ficou em branco (destaque em vermelho no formulário). Preencha antes de cadastrar.');
  }
  if (tax.taxpayerType === '1' && !onlyDigits(tax.ie)) {
    missingRequired.push({ path: 'recipient.ie', message: 'Contribuinte ICMS exige a inscrição estadual.' });
  }
  if (!addr.street) missingRequired.push({ path: 'recipient.address.street', message: 'Informe o logradouro do destinatário.' });
  if (!addr.city) missingRequired.push({ path: 'recipient.address.city', message: 'Informe a cidade do destinatário.' });
  if (!addr.uf) missingRequired.push({ path: 'recipient.address.uf', message: 'Informe a UF do destinatário.' });

  type RawItem = {
    catalogItemId?: string | null;
    code?: string;
    description?: string;
    ncm?: string;
    cfop?: string;
    unit?: string;
    quantity?: number;
    unitValue?: number;
    origin?: string;
  };
  const rawItems: RawItem[] = Array.isArray(sale.items) && sale.items.length > 0
    ? sale.items
    : [];
  const inferredFromSummary = rawItems.length === 0;
  if (inferredFromSummary) {
    const description = String(sale.itemsSummary || `Pedido de venda #${sale.code || sale.id}`).trim() || 'Mercadoria';
    rawItems.push({ description, quantity: 1, unitValue: Number(sale.totalAmount || 0) });
    warnings.push('Os produtos foram montados a partir do resumo da venda. Confira descrição, quantidade, valor e NCM antes de cadastrar.');
  }

  const icmsCode = suggestIcmsCode(ctx.taxRegime);
  const items = rawItems.map((it) => {
    const cat = matchCatalogItem(it, catalog);
    const ncm = extractNcm(it.ncm) || extractNcm(cat?.ncmOrLc116);
    const description = String(it.description || cat?.name || '').trim().slice(0, 120);
    const quantity = Number(it.quantity) > 0 ? Number(it.quantity) : 1;
    const unitValue = Number.isFinite(Number(it.unitValue)) ? Number(it.unitValue) : Number(cat?.saleOrSetupPrice || 0);
    return {
      catalogItemId: it.catalogItemId || cat?.id || null,
      code: String(it.code || cat?.gestaoClickCode || '').slice(0, 60),
      description,
      ncm,
      cfop: onlyDigits(it.cfop) || dest.cfop,
      unit: String(it.unit || cat?.unitOfMeasure || 'UN').slice(0, 6) || 'UN',
      quantity,
      unitValue,
      origin: (/^[0-8]$/.test(String(it.origin || '')) ? String(it.origin) : '0') as '0',
      icmsCode,
      ipiRatePercent: 0,
      ean: String(cat?.barcodeEan || '').trim() || '',
    };
  });

  items.forEach((it, i) => {
    if (!it.description) missingRequired.push({ path: `items.${i}.description`, message: 'Descrição do produto obrigatória.' });
    if (!/^\d{8}$/.test(it.ncm)) {
      missingRequired.push({ path: `items.${i}.ncm`, message: 'NCM deve ter 8 dígitos. Informe no item da venda ou no cadastro do produto.' });
    }
  });
  if (!items.length) missingRequired.push({ path: 'items', message: 'Inclua ao menos um produto.' });

  const pay = paymentMethodToTPag(sale.paymentMethod);
  const modFrete = mapFreightModality(sale);
  const freightValue = Number(sale.freightValue || 0) || 0;
  const vols = sale.volumes || {};

  const phone = String(sale.phone || cp.phone || cp.mainPhone || cp.telefone || '');
  const emailRaw = String(sale.email || cp.emailFinanceiroNfe || cp.email || '');
  const email = emailRaw.split(/[;,\s]/).find((e) => e.includes('@')) || '';

  const draft: ProductNfeDraftInput = {
    general: {
      natOp: 'VENDA DE MERCADORIA',
      issueDateTime: formatBrasiliaDateTime(ctx.now),
      serie: String(ctx.serie || '1').replace(/\D/g, '') || '1',
      number: null,
      tpNF: '1',
      indFinal: '1',
      saida: 'NA_EMISSAO',
      exitDateTime: '',
      finNFe: '1',
      tpEmis: '1',
      idDest: dest.idDest,
      indPres: '1',
      indIntermed: '0',
      hasReferencedNfe: false,
      referencedKeys: [],
    },
    recipient: {
      companyId: company?.id || sale.companyId || null,
      supplierId: null,
      documentType,
      document: docDigits,
      name: name || sale.companyName || '',
      taxpayerType: (tax.taxpayerType || '1') as '1' | '2' | '9',
      ie: tax.ie,
      suframa: tax.suframa,
      im: tax.im,
      address: addr,
      country: String(sale.address?.country || 'Brasil'),
      phone,
      email,
      hasDeliveryAddress: Boolean(sale.deliveryAddress),
      ...(sale.deliveryAddress
        ? {
            deliveryAddress: {
              document: docDigits,
              name: name || sale.companyName || '',
              cep: String(sale.deliveryAddress.cep || ''),
              street: String(sale.deliveryAddress.street || ''),
              number: String(sale.deliveryAddress.number || ''),
              complement: String(sale.deliveryAddress.complement || ''),
              district: String(sale.deliveryAddress.district || ''),
              city: String(sale.deliveryAddress.city || ''),
              uf: String(sale.deliveryAddress.uf || '').toUpperCase().slice(0, 2),
              cityIbge: onlyDigits(sale.deliveryAddress.cityIbge).slice(0, 7),
            },
          }
        : {}),
      hasPickupAddress: Boolean(sale.pickupAddress),
    },
    items,
    transport: {
      modFrete,
      volumes: {
        quantity: Number(vols.quantity || 0) || 0,
        species: String(vols.species || ''),
        netWeightKg: Number(vols.netWeightKg || 0) || 0,
        grossWeightKg: Number(vols.grossWeightKg || 0) || 0,
        brand: String(vols.brand || ''),
        numbering: String(vols.numbering || ''),
      },
      freightValue,
      insuranceValue: 0,
      otherExpenses: 0,
      hasPayment: pay.hasPayment,
      ...(pay.hasPayment ? { payment: { tPag: pay.tPag } } : {}),
      hasVehicle: false,
      hasIcmsRetention: false,
    },
    totals: { discountValue: 0, adjustedTotal: null },
    additionalInfo: {
      complementary: ctx.additionalInfo || '',
      fisco: '',
    },
  };

  // No pré-preenchimento o tipo de contribuinte pode ficar vazio (o schema defaultaria '1').
  // Guardamos '' no objeto devolvido à UI por um campo paralelo; o draft tipado usa '1' só
  // para o TypeScript — a UI lê prefillTaxpayerType.
  const existing = findActiveProductNfeForSale(ctx.invoices || [], sale.id, sale.code);
  if (existing) {
    warnings.unshift(
      `Já existe a NF-e ${existing.productNfe?.nNF} - série ${existing.productNfe?.serie} vinculada a esta venda. Cadastre outra só com force: true.`
    );
  }

  return {
    draft,
    warnings,
    missingRequired,
    existing: existing ? summarizeSaleNfe(existing) : null,
    readyToCreate: missingRequired.length === 0,
    // prefillTaxpayerType is added below via object spread in the API layer
  };
}

/** Campo livre do formulário: tipo de contribuinte vazio quando o cadastro não informa. */
export function prefillTaxpayerType(sale: ErpSaleOrder, company: Company | null): string {
  return taxpayerFromCompany(company, sale).taxpayerType;
}

export function saleSummary(sale: ErpSaleOrder) {
  return {
    id: sale.id,
    code: sale.code,
    status: sale.status,
    saleType: sale.saleType || null,
    totalAmount: sale.totalAmount,
    companyName: sale.companyName,
  };
}

export function crtContext(taxRegime: ErpTaxRegime) {
  return { taxRegime, crt: crtFromRegime(taxRegime) };
}

/** Corpo de POST /api/erp/vendas/:vendaId/nfe (zod .strict()). */
export const createSaleNfeBodySchema = z
  .object({
    force: z.boolean().optional().default(false),
    draft: productNfeDraftSchema.optional(),
  })
  .strict();

export type CreateSaleNfeBody = z.output<typeof createSaleNfeBodySchema>;
