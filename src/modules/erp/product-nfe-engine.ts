// ============================================================================
// NF-e de produtos (modelo 55) — rascunho no padrão do emissor GestaoClick
// ----------------------------------------------------------------------------
//  - Validação (zod) do formulário "Adicionar NF-e": dados gerais, destinatário,
//    produtos, transporte, totais e informações adicionais.
//  - Totais por item com o erp-tax-engine (calculateBrazilianTaxBreakdown) e o
//    regime CONFIGURADO (gestaoClickConfig.taxRegime) — nunca alterado aqui.
//  - XML NF-e 4.00 de RASCUNHO (sem assinatura, sem protocolo), reaproveitando os
//    helpers do gerador de importação: escape/limites do MOC, chave com DV módulo 11,
//    data/hora America/Sao_Paulo e tpAmb do ambiente.
//  - Nenhuma chamada à SEFAZ: emissão real fica para a integração com o certificado A1.
// Módulo puro (sem Node APIs): também é usado pelo formulário para pré-visualizar os totais.
// ============================================================================

import { z } from 'zod';
import type { ErpTaxBreakdown, ErpTaxRegime, FiscalEnvironment } from '../../db/types';
import { calculateBrazilianTaxBreakdown } from './erp-tax-engine';
import {
  MOC,
  SEFAZ_XML_DRAFT_NOTICE,
  buildNfeAccessKey,
  fmt2,
  fmt4,
  fmt10,
  formatSaoPauloDateTime,
  generateRandomCnf,
  renderEmitterXml,
  xmlField,
} from './sebrae-nfe-import-engine';

/** Em homologação a SEFAZ exige este xNome no destinatário (NT 2011/002). */
export const HOMOLOGATION_RECIPIENT_NAME = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

export const PRODUCT_NFE_SEFAZ_PENDING_HINT = 'Disponível após integração SEFAZ';

function round2(v: number): number {
  return Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
}

const onlyDigits = (v: unknown) => String(v ?? '').replace(/\D/g, '');

// ----------------------------------------------------------------------------
// CNPJ / CPF (DV módulo 11)
// ----------------------------------------------------------------------------
export function isValidCnpjDv(raw: unknown): boolean {
  const d = onlyDigits(raw);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (len: number) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = w.reduce((acc, wi, i) => acc + Number(d[i]) * wi, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

export function isValidCpfDv(raw: unknown): boolean {
  const d = onlyDigits(raw);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (len: number) => {
    let s = 0;
    for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

// ----------------------------------------------------------------------------
// Opções do formulário (mesma ordem e rótulos do emissor GestaoClick)
// ----------------------------------------------------------------------------
export const NFE_TIPO_OPTIONS = [
  { value: '1', label: 'Saída' },
  { value: '0', label: 'Entrada' },
] as const;
export const NFE_CONSUMIDOR_FINAL_OPTIONS = [
  { value: '1', label: 'Sim' },
  { value: '0', label: 'Não' },
] as const;
export const NFE_SAIDA_OPTIONS = [
  { value: 'NA_EMISSAO', label: 'Na emissão' },
  { value: 'DATA_INFORMADA', label: 'Em data informada' },
] as const;
export const NFE_FINALIDADE_OPTIONS = [
  { value: '1', label: 'NF-e normal' },
  { value: '2', label: 'NF-e complementar' },
  { value: '3', label: 'NF-e de ajuste' },
  { value: '4', label: 'Devolução de mercadoria' },
] as const;
export const NFE_FORMA_EMISSAO_OPTIONS = [{ value: '1', label: 'Emissão normal' }] as const;
export const NFE_DESTINO_OPTIONS = [
  { value: '1', label: 'Operação interna' },
  { value: '2', label: 'Operação interestadual' },
  { value: '3', label: 'Operação com exterior' },
] as const;
export const NFE_ATENDIMENTO_OPTIONS = [
  { value: '0', label: 'Não se aplica' },
  { value: '1', label: 'Operação presencial' },
  { value: '2', label: 'Operação não presencial, pela Internet' },
  { value: '3', label: 'Operação não presencial, Teleatendimento' },
  { value: '4', label: 'NFC-e em operação com entrega a domicílio' },
  { value: '5', label: 'Operação presencial, fora do estabelecimento' },
  { value: '9', label: 'Operação não presencial, outros' },
] as const;
export const NFE_CONTRIBUINTE_OPTIONS = [
  { value: '1', label: 'Contribuinte ICMS' },
  { value: '2', label: 'Contribuinte isento' },
  { value: '9', label: 'Não contribuinte' },
] as const;
/** modFrete da NF-e 4.00, na ordem dos cartões do GestaoClick. */
export const NFE_FRETE_OPTIONS = [
  { value: '9', label: 'Sem frete', hint: 'Sem ocorrência de transporte' },
  { value: '0', label: 'Remetente (CIF)', hint: 'Contratado por conta do remetente' },
  { value: '1', label: 'Destinatário (FOB)', hint: 'Contratado por conta do destinatário' },
  { value: '2', label: 'Terceiros', hint: 'Contratado por conta de terceiros' },
  { value: '3', label: 'Próprio do remetente', hint: 'Transporte próprio do remetente' },
  { value: '4', label: 'Próprio do destinatário', hint: 'Transporte próprio do destinatário' },
] as const;
export const NFE_PAGAMENTO_OPTIONS = [
  { value: '01', label: 'Dinheiro' },
  { value: '03', label: 'Cartão de crédito' },
  { value: '04', label: 'Cartão de débito' },
  { value: '15', label: 'Boleto bancário' },
  { value: '17', label: 'PIX' },
  { value: '90', label: 'Sem pagamento' },
  { value: '99', label: 'Outros' },
] as const;
/** CSOSN aceitos (CRT 1 — Simples Nacional) e CST aceitos (CRT 3 — regime normal). */
export const NFE_CSOSN_OPTIONS = [
  { value: '102', label: '102 — Tributada pelo Simples sem permissão de crédito' },
  { value: '103', label: '103 — Isenção do ICMS no Simples para faixa de receita bruta' },
  { value: '300', label: '300 — Imune' },
  { value: '400', label: '400 — Não tributada pelo Simples' },
  { value: '900', label: '900 — Outros' },
] as const;
export const NFE_CST_ICMS_OPTIONS = [
  { value: '00', label: '00 — Tributada integralmente' },
  { value: '40', label: '40 — Isenta' },
  { value: '41', label: '41 — Não tributada' },
  { value: '50', label: '50 — Suspensão' },
] as const;

/** CRT da NF-e a partir do regime configurado: 1 = Simples Nacional, 3 = regime normal. */
export function crtFromRegime(regime: ErpTaxRegime | undefined): '1' | '3' {
  return regime === 'SIMPLES_NACIONAL' ? '1' : '3';
}

/** Sugestão editável de CSOSN/CST por item, conforme o regime configurado. */
export function suggestIcmsCode(regime: ErpTaxRegime | undefined): string {
  return crtFromRegime(regime) === '1' ? '102' : '00';
}

/** CFOP sugerido pela operação: 5.102 interna, 6.102 interestadual, 7.102 exterior. */
export function suggestCfop(idDest: string): string {
  return idDest === '2' ? '6102' : idDest === '3' ? '7102' : '5102';
}

export const REGIME_LABELS: Record<ErpTaxRegime, string> = {
  SIMPLES_NACIONAL: 'Simples Nacional',
  LUCRO_PRESUMIDO: 'Lucro Presumido',
  LUCRO_REAL: 'Lucro Real',
};

// ----------------------------------------------------------------------------
// Schema (zod .strict())
// ----------------------------------------------------------------------------
const txt = (max: number) => z.string().max(max).optional().default('');
const money = z.number().finite().min(0).max(999_999_999);
const ufSchema = z.string().regex(/^[A-Za-z]{2}$/, 'UF inválida').transform((s) => s.toUpperCase());
const optUf = z.union([ufSchema, z.literal('')]).optional().default('');

const addressSchema = z
  .object({
    cep: txt(9),
    street: txt(60),
    number: txt(60),
    complement: txt(60),
    district: txt(60),
    city: txt(60),
    uf: optUf,
    cityIbge: z.union([z.string().regex(/^\d{7}$/, 'Código IBGE deve ter 7 dígitos'), z.literal('')]).optional().default(''),
  })
  .strict();

const placeSchema = addressSchema
  .extend({ document: txt(18), name: txt(60) })
  .strict();

export const productNfeItemSchema = z
  .object({
    catalogItemId: z.string().max(80).nullable().optional().default(null),
    code: txt(60),
    description: z.string().trim().min(1, 'Descrição do produto obrigatória').max(120),
    ncm: z.string().regex(/^\d{8}$/, 'NCM deve ter 8 dígitos'),
    cfop: z.string().regex(/^[1-7]\d{3}$/, 'CFOP deve ter 4 dígitos'),
    unit: z.string().trim().min(1).max(6).default('UN'),
    quantity: z.number().finite().gt(0, 'Quantidade deve ser maior que zero').max(999_999_999),
    unitValue: money,
    origin: z.enum(['0', '1', '2', '3', '4', '5', '6', '7', '8']).default('0'),
    icmsCode: z.string().regex(/^\d{2,3}$/, 'CSOSN/CST inválido'),
    icmsRatePercent: z.number().finite().min(0).max(100).optional(),
    ipiRatePercent: z.number().finite().min(0).max(100).optional().default(0),
    ean: z.union([z.string().regex(/^(\d{8}|\d{12,14})$/), z.literal('SEM GTIN'), z.literal('')]).optional().default(''),
  })
  .strict();

export const productNfeDraftSchema = z
  .object({
    general: z
      .object({
        natOp: z.string().trim().min(1, 'Natureza de operação obrigatória').max(60),
        /** Data/hora de emissão no horário de Brasília (YYYY-MM-DDTHH:mm). */
        issueDateTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, 'Data e hora de emissão inválidas'),
        serie: z.string().regex(/^\d{1,3}$/).optional(),
        /** Número desejado (opcional): só é aceito se estiver livre no ambiente. */
        number: z.number().int().positive().max(999_999_999).nullable().optional().default(null),
        tpNF: z.enum(['0', '1']).default('1'),
        indFinal: z.enum(['0', '1']).default('1'),
        saida: z.enum(['NA_EMISSAO', 'DATA_INFORMADA']).default('NA_EMISSAO'),
        exitDateTime: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/), z.literal('')]).optional().default(''),
        finNFe: z.enum(['1', '2', '3', '4']).default('1'),
        tpEmis: z.enum(['1']).default('1'),
        idDest: z.enum(['1', '2', '3']).default('1'),
        indPres: z.enum(['0', '1', '2', '3', '4', '5', '9']).default('1'),
        hasReferencedNfe: z.boolean().default(false),
        referencedKeys: z.array(z.string().regex(/^\d{44}$/, 'Chave referenciada deve ter 44 dígitos')).max(20).optional().default([]),
      })
      .strict(),
    recipient: z
      .object({
        companyId: z.string().max(80).nullable().optional().default(null),
        supplierId: z.string().max(80).nullable().optional().default(null),
        documentType: z.enum(['CNPJ', 'CPF']),
        document: z.string().max(18),
        name: z.string().trim().min(2, 'Razão social / nome obrigatório').max(60),
        taxpayerType: z.enum(['1', '2', '9']).default('1'),
        ie: txt(20),
        suframa: txt(9),
        im: txt(15),
        address: addressSchema,
        country: txt(60),
        phone: txt(20),
        email: z.union([z.string().email('E-mail inválido').max(60), z.literal('')]).optional().default(''),
        hasDeliveryAddress: z.boolean().default(false),
        deliveryAddress: placeSchema.optional(),
        hasPickupAddress: z.boolean().default(false),
        pickupAddress: placeSchema.optional(),
      })
      .strict(),
    items: z.array(productNfeItemSchema).min(1, 'Inclua ao menos um produto').max(990),
    transport: z
      .object({
        modFrete: z.enum(['0', '1', '2', '3', '4', '9']).default('9'),
        carrier: z
          .object({
            supplierId: z.string().max(80).nullable().optional().default(null),
            document: txt(18),
            name: txt(60),
            ie: txt(20),
            address: txt(60),
            city: txt(60),
            uf: optUf,
          })
          .strict()
          .optional(),
        volumes: z
          .object({
            quantity: z.number().int().min(0).max(999_999_999_999_999).optional().default(0),
            species: txt(60),
            netWeightKg: z.number().finite().min(0).max(999_999_999).optional().default(0),
            grossWeightKg: z.number().finite().min(0).max(999_999_999).optional().default(0),
            brand: txt(60),
            numbering: txt(60),
          })
          .strict()
          .optional(),
        freightValue: money.optional().default(0),
        insuranceValue: money.optional().default(0),
        otherExpenses: money.optional().default(0),
        hasPayment: z.boolean().default(false),
        payment: z.object({ tPag: z.enum(['01', '03', '04', '15', '17', '90', '99']), amount: money.optional() }).strict().optional(),
        hasVehicle: z.boolean().default(false),
        vehicle: z
          .object({ plate: z.union([z.string().regex(/^[A-Za-z]{3}\d[A-Za-z0-9]\d{2}$/, 'Placa inválida'), z.literal('')]).optional().default(''), uf: optUf, rntc: txt(20) })
          .strict()
          .optional(),
        hasIcmsRetention: z.boolean().default(false),
        icmsRetention: z
          .object({ serviceValue: money.optional().default(0), baseValue: money.optional().default(0), ratePercent: z.number().min(0).max(100).optional().default(0), cfop: txt(4), cityIbge: txt(7) })
          .strict()
          .optional(),
      })
      .strict()
      .default({}),
    totals: z
      .object({
        discountValue: money.optional().default(0),
        /** "Ajustar total": valor final desejado da NF; a diferença vira desconto ou outras despesas. */
        adjustedTotal: money.nullable().optional().default(null),
      })
      .strict()
      .default({}),
    additionalInfo: z
      .object({
        complementary: z.string().max(5000).optional().default(''),
        fisco: z.string().max(2000).optional().default(''),
      })
      .strict()
      .default({}),
  })
  .strict()
  .superRefine((v, ctx) => {
    const doc = onlyDigits(v.recipient.document);
    if (v.recipient.documentType === 'CNPJ' && !isValidCnpjDv(doc)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['recipient', 'document'], message: 'CNPJ do destinatário inválido (dígito verificador).' });
    }
    if (v.recipient.documentType === 'CPF' && !isValidCpfDv(doc)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['recipient', 'document'], message: 'CPF do destinatário inválido (dígito verificador).' });
    }
    if (v.recipient.taxpayerType === '1' && !onlyDigits(v.recipient.ie)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['recipient', 'ie'], message: 'Contribuinte ICMS exige a inscrição estadual.' });
    }
    if (v.recipient.taxpayerType === '1' && v.recipient.documentType === 'CPF' && v.general.indFinal === '1') {
      // permitido (produtor rural), apenas segue
    }
    if (v.general.saida === 'DATA_INFORMADA' && !v.general.exitDateTime) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['general', 'exitDateTime'], message: 'Informe a data e hora de saída.' });
    }
    if (v.general.hasReferencedNfe && v.general.referencedKeys.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['general', 'referencedKeys'], message: 'Informe ao menos uma NF-e referenciada.' });
    }
  });

export type ProductNfeDraftInput = z.input<typeof productNfeDraftSchema>;
export type ProductNfeDraft = z.output<typeof productNfeDraftSchema>;
export type ProductNfeItemInput = z.output<typeof productNfeItemSchema>;

export function validateProductNfeDraft(
  body: unknown
): { ok: true; data: ProductNfeDraft } | { ok: false; error: string; issues: Array<{ path: string; message: string }> } {
  const parsed = productNfeDraftSchema.safeParse(body);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issues = parsed.error.issues.slice(0, 30).map((i) => ({ path: i.path.join('.'), message: i.message }));
  return { ok: false, error: `Dados da NF-e inválidos: ${issues.map((i) => `${i.path || 'corpo'}: ${i.message}`).join('; ')}`.slice(0, 800), issues };
}

// ----------------------------------------------------------------------------
// Totais (erp-tax-engine + destaque conforme CSOSN/CST)
// ----------------------------------------------------------------------------
export interface ProductNfeItemTotals {
  nItem: number;
  vProd: number;
  vDesc: number;
  vFrete: number;
  vSeg: number;
  vOutro: number;
  vBC: number;
  pICMS: number;
  vICMS: number;
  pIPI: number;
  vIPI: number;
  cstPisCofins: string;
  pPIS: number;
  vPIS: number;
  pCOFINS: number;
  vCOFINS: number;
  /** Tributos aproximados (Lei 12.741/2012) — estimativa do erp-tax-engine. */
  vTotTrib: number;
}

export interface ProductNfeTotals {
  crt: '1' | '3';
  taxRegime: ErpTaxRegime;
  items: ProductNfeItemTotals[];
  vProd: number;
  vDesc: number;
  vFrete: number;
  vSeg: number;
  vOutro: number;
  vBC: number;
  vICMS: number;
  vIPI: number;
  vPIS: number;
  vCOFINS: number;
  vNF: number;
  vTotTrib: number;
  /** Total da NF antes do "Ajustar total". */
  vNFBeforeAdjustment: number;
  taxBreakdown: ErpTaxBreakdown;
}

function allocate(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const t = round2(total);
  const sumW = weights.reduce((s, w) => s + w, 0);
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    if (i === n - 1) out.push(round2(t - acc));
    else {
      const share = round2(sumW > 0 ? (t * weights[i]) / sumW : t / n);
      out.push(share);
      acc = round2(acc + share);
    }
  }
  return out;
}

const SN_NO_ICMS = new Set(['101', '102', '103', '300', '400', '500']);
const CST_NO_ICMS = new Set(['40', '41', '50']);

type TotalsInput = {
  items: Array<Pick<ProductNfeItemInput, 'quantity' | 'unitValue' | 'icmsCode'> & { icmsRatePercent?: number; ipiRatePercent?: number }>;
  transport?: { freightValue?: number; insuranceValue?: number; otherExpenses?: number };
  totals?: { discountValue?: number; adjustedTotal?: number | null };
};

/**
 * Totais da NF-e com o regime CONFIGURADO. Cada item passa pelo erp-tax-engine
 * (NFE_VENDA_PRODUTO); o ICMS/PIS/COFINS só é destacado quando o CSOSN/CST tributa
 * (Simples Nacional CSOSN 102/103/300/400 não destaca ICMS na NF-e).
 */
export function computeProductNfeTotals(input: TotalsInput, taxRegime: ErpTaxRegime): ProductNfeTotals {
  const crt = crtFromRegime(taxRegime);
  const vProds = input.items.map((it) => round2(Number(it.quantity || 0) * Number(it.unitValue || 0)));
  const vProd = round2(vProds.reduce((s, v) => s + v, 0));
  const vFrete = round2(input.transport?.freightValue || 0);
  const vSeg = round2(input.transport?.insuranceValue || 0);
  let vOutro = round2(input.transport?.otherExpenses || 0);
  let vDesc = round2(input.totals?.discountValue || 0);

  // IPI estimado antes do ajuste (entra no vNF)
  const ipiPre = input.items.map((it, i) => round2((vProds[i] * Number(it.ipiRatePercent || 0)) / 100));
  const vIPIpre = round2(ipiPre.reduce((s, v) => s + v, 0));
  const vNFBeforeAdjustment = round2(vProd - vDesc + vFrete + vSeg + vOutro + vIPIpre);
  const adj = input.totals?.adjustedTotal;
  if (adj !== null && adj !== undefined && Number.isFinite(adj) && round2(adj) !== vNFBeforeAdjustment) {
    const diff = round2(adj - vNFBeforeAdjustment);
    if (diff < 0) vDesc = round2(vDesc - diff);
    else vOutro = round2(vOutro + diff);
  }
  if (vDesc > vProd) vDesc = vProd;

  const descShares = allocate(vDesc, vProds);
  const freteShares = allocate(vFrete, vProds);
  const segShares = allocate(vSeg, vProds);
  const outroShares = allocate(vOutro, vProds);

  const items: ProductNfeItemTotals[] = input.items.map((it, i) => {
    const gross = round2(vProds[i] + freteShares[i] + segShares[i] + outroShares[i]);
    const engine = calculateBrazilianTaxBreakdown({
      grossAmount: gross,
      discountAmount: descShares[i],
      documentType: 'NFE_VENDA_PRODUTO',
      taxRegime,
      ...(it.icmsRatePercent !== undefined ? { icmsRatePercent: it.icmsRatePercent } : {}),
    });
    const code = String(it.icmsCode || '');
    const destacaIcms = crt === '1' ? !SN_NO_ICMS.has(code) : !CST_NO_ICMS.has(code);
    const base = round2(gross - descShares[i]);
    const pIPI = Number(it.ipiRatePercent || 0);
    const vIPI = round2((vProds[i] * pIPI) / 100);
    // Simples Nacional: PIS/COFINS recolhidos no DAS, sem destaque (CST 49); regime normal: CST 01.
    const tributaPisCofins = crt === '3';
    return {
      nItem: i + 1,
      vProd: vProds[i],
      vDesc: descShares[i],
      vFrete: freteShares[i],
      vSeg: segShares[i],
      vOutro: outroShares[i],
      vBC: destacaIcms ? base : 0,
      pICMS: destacaIcms ? engine.icmsRatePercent : 0,
      vICMS: destacaIcms ? engine.icmsAmount : 0,
      pIPI,
      vIPI,
      cstPisCofins: tributaPisCofins ? '01' : '49',
      pPIS: tributaPisCofins ? engine.pisRatePercent : 0,
      vPIS: tributaPisCofins ? engine.pisAmount : 0,
      pCOFINS: tributaPisCofins ? engine.cofinsRatePercent : 0,
      vCOFINS: tributaPisCofins ? engine.cofinsAmount : 0,
      vTotTrib: round2(engine.totalTaxesEstimated + vIPI),
    };
  });

  const sum = (k: keyof ProductNfeItemTotals) => round2(items.reduce((s, it) => s + Number(it[k] || 0), 0));
  const vIPI = sum('vIPI');
  const vNF = round2(vProd - vDesc + vFrete + vSeg + vOutro + vIPI);
  const taxBreakdown = calculateBrazilianTaxBreakdown({
    grossAmount: round2(vProd + vFrete + vSeg + vOutro),
    discountAmount: vDesc,
    documentType: 'NFE_VENDA_PRODUTO',
    taxRegime,
  });
  return {
    crt,
    taxRegime,
    items,
    vProd,
    vDesc,
    vFrete,
    vSeg,
    vOutro,
    vBC: sum('vBC'),
    vICMS: sum('vICMS'),
    vIPI,
    vPIS: sum('vPIS'),
    vCOFINS: sum('vCOFINS'),
    vNF,
    vTotTrib: sum('vTotTrib'),
    vNFBeforeAdjustment,
    taxBreakdown: { ...taxBreakdown, netReceivableAmount: vNF },
  };
}

// ----------------------------------------------------------------------------
// Avisos (não bloqueiam o rascunho)
// ----------------------------------------------------------------------------
export function productNfeWarnings(
  draft: Pick<ProductNfeDraft, 'general' | 'recipient' | 'items'>,
  ctx: { taxRegime: ErpTaxRegime; emitterUf: string; additionalInfo?: string; emitterCnpj?: string }
): string[] {
  const out: string[] = [];
  if (ctx.emitterCnpj && !isValidCnpjDv(ctx.emitterCnpj)) {
    out.push('O CNPJ do emitente configurado não confere no dígito verificador (módulo 11). Ele NÃO foi alterado — confirme o cadastro da empresa antes da emissão real.');
  }
  const crt = crtFromRegime(ctx.taxRegime);
  const info = `${ctx.additionalInfo || ''}`.toLowerCase();
  if (ctx.taxRegime !== 'SIMPLES_NACIONAL' && /simples nacional/.test(info)) {
    out.push(
      `Regime configurado: ${REGIME_LABELS[ctx.taxRegime]} (CRT ${crt}), mas as informações adicionais citam "Simples Nacional". O regime NÃO foi alterado — confirme com a contabilidade em Configurações > Empresa.`
    );
  }
  draft.items.forEach((it, i) => {
    const code = String(it.icmsCode || '');
    if (crt === '1' && code.length !== 3) out.push(`Item ${i + 1}: o regime configurado é Simples Nacional (CRT 1) e usa CSOSN (3 dígitos); "${code}" parece um CST.`);
    if (crt === '3' && code.length !== 2) out.push(`Item ${i + 1}: o regime configurado (${REGIME_LABELS[ctx.taxRegime]}) usa CST (2 dígitos); "${code}" parece um CSOSN.`);
    const first = it.cfop.charAt(0);
    const expected = draft.general.idDest === '2' ? '6' : draft.general.idDest === '3' ? '7' : '5';
    if (draft.general.tpNF === '1' && first !== expected) out.push(`Item ${i + 1}: CFOP ${it.cfop} não corresponde ao destino da operação (esperado ${expected}.xxx).`);
  });
  const uf = String(draft.recipient.address.uf || '').toUpperCase();
  if (uf && draft.general.idDest === '1' && uf !== ctx.emitterUf.toUpperCase()) out.push(`Destinatário em ${uf} com "Operação interna": a SEFAZ exige "Operação interestadual".`);
  if (uf && draft.general.idDest === '2' && uf === ctx.emitterUf.toUpperCase()) out.push(`Destinatário em ${uf} com "Operação interestadual": para o mesmo estado use "Operação interna".`);
  if (!draft.recipient.address.cityIbge) out.push('Destinatário sem código IBGE do município (cMun): obrigatório antes da emissão.');
  return out;
}

// ----------------------------------------------------------------------------
// XML NF-e 4.00 — RASCUNHO (sem assinatura e sem protocolo)
// ----------------------------------------------------------------------------
export interface ProductNfeXmlContext {
  environment: FiscalEnvironment;
  serie: string;
  nNF: number;
  taxRegime: ErpTaxRegime;
  emitter: { emitterName: string; emitterCnpj: string; emitterIe: string; emitterUf: string };
  /** Chave/cNF já gerados (reprocessamento do mesmo rascunho). */
  key?: { accessKey: string; cNF: string; cDV: string; dhEmi: string };
  now?: Date;
}

/** Converte "YYYY-MM-DDTHH:mm" (horário de Brasília informado no formulário) em Date. */
export function parseBrasiliaLocal(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value || '');
  if (!m) return new Date();
  const [, y, mo, d, h, mi, s] = m;
  // America/Sao_Paulo é UTC-03:00 sem horário de verão desde 2019
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) + 3, Number(mi), Number(s || 0)));
}

export function generateProductNfeXml(
  draft: ProductNfeDraft,
  totals: ProductNfeTotals,
  ctx: ProductNfeXmlContext
): { xml: string; accessKey: string; cNF: string; cDV: string; dhEmi: string } {
  const x = xmlField;
  const tpAmb = ctx.environment === 'PRODUCAO' ? '1' : '2';
  const cnpjDigits = ctx.emitter.emitterCnpj.replace(/\D/g, '').padEnd(14, '0').slice(0, 14);
  const serie = String(ctx.serie).replace(/\D/g, '') || '1';
  const nNF = String(ctx.nNF);
  let key = ctx.key;
  if (!key) {
    const { dhEmi, aamm } = formatSaoPauloDateTime(parseBrasiliaLocal(draft.general.issueDateTime));
    const cNF = generateRandomCnf(nNF);
    const built = buildNfeAccessKey({ cUF: '35', aamm, cnpj: cnpjDigits, mod: '55', serie, nNF, tpEmis: draft.general.tpEmis, cNF });
    key = { accessKey: built.key, cNF, cDV: built.dv, dhEmi };
  }
  const dhSaiEnt =
    draft.general.saida === 'DATA_INFORMADA' && draft.general.exitDateTime
      ? formatSaoPauloDateTime(parseBrasiliaLocal(draft.general.exitDateTime)).dhEmi
      : key.dhEmi;

  const r = draft.recipient;
  const docDigits = onlyDigits(r.document);
  const destName = ctx.environment === 'PRODUCAO' ? r.name : HOMOLOGATION_RECIPIENT_NAME;
  const a = r.address;
  const opt = (tag: string, v: string, max: number) => (v ? `\n          <${tag}>${x(v, max)}</${tag}>` : '');
  const nfRef = draft.general.hasReferencedNfe
    ? draft.general.referencedKeys.map((k) => `\n        <NFref>\n          <refNFe>${onlyDigits(k)}</refNFe>\n        </NFref>`).join('')
    : '';

  const place = (tag: 'entrega' | 'retirada', p?: ProductNfeDraft['recipient']['deliveryAddress']) => {
    if (!p) return '';
    const d = onlyDigits(p.document);
    return `
      <${tag}>
        ${d.length === 11 ? `<CPF>${d}</CPF>` : `<CNPJ>${d.padStart(14, '0').slice(-14)}</CNPJ>`}${p.name ? `\n        <xNome>${x(ctx.environment === 'PRODUCAO' ? p.name : HOMOLOGATION_RECIPIENT_NAME, MOC.xNome)}</xNome>` : ''}
        <xLgr>${x(p.street, MOC.xLgr)}</xLgr>
        <nro>${x(p.number || 'S/N', MOC.nro)}</nro>${p.complement ? `\n        <xCpl>${x(p.complement, 60)}</xCpl>` : ''}
        <xBairro>${x(p.district, MOC.xBairro)}</xBairro>
        <cMun>${onlyDigits(p.cityIbge) || '0000000'}</cMun>
        <xMun>${x(p.city, MOC.xMun)}</xMun>
        <UF>${x(p.uf, 2)}</UF>
      </${tag}>`;
  };

  const crt = totals.crt;
  const det = draft.items
    .map((it, i) => {
      const t = totals.items[i];
      const cfop = it.cfop.replace(/\D/g, '');
      const ean = it.ean || 'SEM GTIN';
      const icms =
        crt === '1'
          ? it.icmsCode === '900'
            ? `<ICMSSN900>
            <orig>${it.origin}</orig>
            <CSOSN>900</CSOSN>
            <modBC>3</modBC>
            <vBC>${fmt2(t.vBC)}</vBC>
            <pICMS>${fmt2(t.pICMS)}</pICMS>
            <vICMS>${fmt2(t.vICMS)}</vICMS>
          </ICMSSN900>`
            : `<ICMSSN102>
            <orig>${it.origin}</orig>
            <CSOSN>${x(it.icmsCode, 3)}</CSOSN>
          </ICMSSN102>`
          : it.icmsCode === '00'
            ? `<ICMS00>
            <orig>${it.origin}</orig>
            <CST>00</CST>
            <modBC>3</modBC>
            <vBC>${fmt2(t.vBC)}</vBC>
            <pICMS>${fmt2(t.pICMS)}</pICMS>
            <vICMS>${fmt2(t.vICMS)}</vICMS>
          </ICMS00>`
            : `<ICMS40>
            <orig>${it.origin}</orig>
            <CST>${x(it.icmsCode, 2)}</CST>
          </ICMS40>`;
      const ipi =
        t.pIPI > 0
          ? `<IPITrib>
            <CST>50</CST>
            <vBC>${fmt2(t.vProd)}</vBC>
            <pIPI>${fmt2(t.pIPI)}</pIPI>
            <vIPI>${fmt2(t.vIPI)}</vIPI>
          </IPITrib>`
          : `<IPINT>
            <CST>53</CST>
          </IPINT>`;
      const pisCofins =
        t.cstPisCofins === '01'
          ? `<PIS>
          <PISAliq>
            <CST>01</CST>
            <vBC>${fmt2(t.vProd - t.vDesc)}</vBC>
            <pPIS>${fmt4(t.pPIS)}</pPIS>
            <vPIS>${fmt2(t.vPIS)}</vPIS>
          </PISAliq>
        </PIS>
        <COFINS>
          <COFINSAliq>
            <CST>01</CST>
            <vBC>${fmt2(t.vProd - t.vDesc)}</vBC>
            <pCOFINS>${fmt4(t.pCOFINS)}</pCOFINS>
            <vCOFINS>${fmt2(t.vCOFINS)}</vCOFINS>
          </COFINSAliq>
        </COFINS>`
          : `<PIS>
          <PISOutr>
            <CST>49</CST>
            <vBC>0.00</vBC>
            <pPIS>0.0000</pPIS>
            <vPIS>0.00</vPIS>
          </PISOutr>
        </PIS>
        <COFINS>
          <COFINSOutr>
            <CST>49</CST>
            <vBC>0.00</vBC>
            <pCOFINS>0.0000</pCOFINS>
            <vCOFINS>0.00</vCOFINS>
          </COFINSOutr>
        </COFINS>`;
      const shares = [
        t.vFrete > 0 ? `\n        <vFrete>${fmt2(t.vFrete)}</vFrete>` : '',
        t.vSeg > 0 ? `\n        <vSeg>${fmt2(t.vSeg)}</vSeg>` : '',
        t.vDesc > 0 ? `\n        <vDesc>${fmt2(t.vDesc)}</vDesc>` : '',
        t.vOutro > 0 ? `\n        <vOutro>${fmt2(t.vOutro)}</vOutro>` : '',
      ].join('');
      return `    <det nItem="${i + 1}">
      <prod>
        <cProd>${x(it.code || it.catalogItemId || String(i + 1), MOC.cProd)}</cProd>
        <cEAN>${x(ean, MOC.cEAN)}</cEAN>
        <xProd>${x(it.description, MOC.xProd)}</xProd>
        <NCM>${x(it.ncm, 8)}</NCM>
        <CFOP>${cfop}</CFOP>
        <uCom>${x(it.unit, MOC.uCom)}</uCom>
        <qCom>${fmt4(it.quantity)}</qCom>
        <vUnCom>${fmt10(it.unitValue)}</vUnCom>
        <vProd>${fmt2(t.vProd)}</vProd>
        <cEANTrib>${x(ean, MOC.cEAN)}</cEANTrib>
        <uTrib>${x(it.unit, MOC.uCom)}</uTrib>
        <qTrib>${fmt4(it.quantity)}</qTrib>
        <vUnTrib>${fmt10(it.unitValue)}</vUnTrib>${shares}
        <indTot>1</indTot>
      </prod>
      <imposto>
        <vTotTrib>${fmt2(t.vTotTrib)}</vTotTrib>
        <ICMS>
          ${icms}
        </ICMS>
        <IPI>
          <cEnq>999</cEnq>
          ${ipi}
        </IPI>
        ${pisCofins}
      </imposto>
    </det>`;
    })
    .join('\n');

  const tr = draft.transport;
  const carrier = tr.carrier && (tr.carrier.document || tr.carrier.name) && tr.modFrete !== '9'
    ? (() => {
        const d = onlyDigits(tr.carrier!.document);
        return `
        <transporta>${d ? (d.length === 11 ? `\n          <CPF>${d}</CPF>` : `\n          <CNPJ>${d.padStart(14, '0').slice(-14)}</CNPJ>`) : ''}${opt('xNome', tr.carrier!.name, MOC.xNome)}${opt('IE', onlyDigits(tr.carrier!.ie), 14)}${opt('xEnder', tr.carrier!.address, MOC.xLgr)}${opt('xMun', tr.carrier!.city, MOC.xMun)}${opt('UF', tr.carrier!.uf, 2)}
        </transporta>`;
      })()
    : '';
  const retTransp = tr.hasIcmsRetention && tr.icmsRetention
    ? `
        <retTransp>
          <vServ>${fmt2(tr.icmsRetention.serviceValue)}</vServ>
          <vBCRet>${fmt2(tr.icmsRetention.baseValue)}</vBCRet>
          <pICMSRet>${fmt4(tr.icmsRetention.ratePercent)}</pICMSRet>
          <vICMSRet>${fmt2((tr.icmsRetention.baseValue * tr.icmsRetention.ratePercent) / 100)}</vICMSRet>
          <CFOP>${onlyDigits(tr.icmsRetention.cfop) || '5353'}</CFOP>
          <cMunFG>${onlyDigits(tr.icmsRetention.cityIbge) || '3550308'}</cMunFG>
        </retTransp>`
    : '';
  const vehicle = tr.hasVehicle && tr.vehicle && tr.vehicle.plate
    ? `
        <veicTransp>
          <placa>${x(tr.vehicle.plate.toUpperCase(), 7)}</placa>${opt('UF', tr.vehicle.uf, 2)}${opt('RNTC', tr.vehicle.rntc, 20)}
        </veicTransp>`
    : '';
  const vol = tr.volumes && (tr.volumes.quantity || tr.volumes.species || tr.volumes.netWeightKg || tr.volumes.grossWeightKg)
    ? `
        <vol>${tr.volumes.quantity ? `\n          <qVol>${tr.volumes.quantity}</qVol>` : ''}${opt('esp', tr.volumes.species, 60)}${opt('marca', tr.volumes.brand, 60)}${opt('nVol', tr.volumes.numbering, 60)}${tr.volumes.netWeightKg ? `\n          <pesoL>${tr.volumes.netWeightKg.toFixed(3)}</pesoL>` : ''}${tr.volumes.grossWeightKg ? `\n          <pesoB>${tr.volumes.grossWeightKg.toFixed(3)}</pesoB>` : ''}
        </vol>`
    : '';
  const tPag = tr.hasPayment && tr.payment ? tr.payment.tPag : '90';
  const vPag = tPag === '90' ? 0 : tr.payment?.amount ?? totals.vNF;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${SEFAZ_XML_DRAFT_NOTICE} -->
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe Id="NFe${key.accessKey}" versao="4.00">
      <ide>
        <cUF>35</cUF>
        <cNF>${key.cNF}</cNF>
        <natOp>${x(draft.general.natOp, MOC.natOp)}</natOp>
        <mod>55</mod>
        <serie>${serie}</serie>
        <nNF>${nNF}</nNF>
        <dhEmi>${key.dhEmi}</dhEmi>
        <dhSaiEnt>${dhSaiEnt}</dhSaiEnt>
        <tpNF>${draft.general.tpNF}</tpNF>
        <idDest>${draft.general.idDest}</idDest>
        <cMunFG>3550308</cMunFG>
        <tpImp>1</tpImp>
        <tpEmis>${draft.general.tpEmis}</tpEmis>
        <cDV>${key.cDV}</cDV>
        <tpAmb>${tpAmb}</tpAmb>
        <finNFe>${draft.general.finNFe}</finNFe>
        <indFinal>${draft.general.indFinal}</indFinal>
        <indPres>${draft.general.indPres}</indPres>
        <procEmi>0</procEmi>
        <verProc>STI-HUB-ERP-1.0</verProc>${nfRef}
      </ide>
${renderEmitterXml(ctx.emitter, crt)}
      <dest>
        ${r.documentType === 'CPF' ? `<CPF>${docDigits}</CPF>` : `<CNPJ>${docDigits}</CNPJ>`}
        <xNome>${x(destName, MOC.xNome)}</xNome>
        <enderDest>
          <xLgr>${x(a.street, MOC.xLgr)}</xLgr>
          <nro>${x(a.number || 'S/N', MOC.nro)}</nro>${opt('xCpl', a.complement, 60)}
          <xBairro>${x(a.district, MOC.xBairro)}</xBairro>
          <cMun>${onlyDigits(a.cityIbge) || '0000000'}</cMun>
          <xMun>${x(a.city, MOC.xMun)}</xMun>
          <UF>${x(a.uf, 2)}</UF>${onlyDigits(a.cep) ? `\n          <CEP>${onlyDigits(a.cep).padStart(8, '0').slice(-8)}</CEP>` : ''}
          <cPais>1058</cPais>
          <xPais>BRASIL</xPais>${onlyDigits(r.phone) ? `\n          <fone>${onlyDigits(r.phone).slice(0, 14)}</fone>` : ''}
        </enderDest>
        <indIEDest>${r.taxpayerType}</indIEDest>${r.taxpayerType === '1' ? `\n        <IE>${onlyDigits(r.ie)}</IE>` : ''}${onlyDigits(r.suframa) ? `\n        <ISUF>${onlyDigits(r.suframa)}</ISUF>` : ''}${r.im ? `\n        <IM>${x(r.im, 15)}</IM>` : ''}${r.email ? `\n        <email>${x(r.email, MOC.email)}</email>` : ''}
      </dest>${r.hasPickupAddress ? place('retirada', r.pickupAddress) : ''}${r.hasDeliveryAddress ? place('entrega', r.deliveryAddress) : ''}
${det}
      <total>
        <ICMSTot>
          <vBC>${fmt2(totals.vBC)}</vBC>
          <vICMS>${fmt2(totals.vICMS)}</vICMS>
          <vICMSDeson>0.00</vICMSDeson>
          <vFCP>0.00</vFCP>
          <vBCST>0.00</vBCST>
          <vST>0.00</vST>
          <vFCPST>0.00</vFCPST>
          <vFCPSTRet>0.00</vFCPSTRet>
          <vProd>${fmt2(totals.vProd)}</vProd>
          <vFrete>${fmt2(totals.vFrete)}</vFrete>
          <vSeg>${fmt2(totals.vSeg)}</vSeg>
          <vDesc>${fmt2(totals.vDesc)}</vDesc>
          <vII>0.00</vII>
          <vIPI>${fmt2(totals.vIPI)}</vIPI>
          <vIPIDevol>0.00</vIPIDevol>
          <vPIS>${fmt2(totals.vPIS)}</vPIS>
          <vCOFINS>${fmt2(totals.vCOFINS)}</vCOFINS>
          <vOutro>${fmt2(totals.vOutro)}</vOutro>
          <vNF>${fmt2(totals.vNF)}</vNF>
          <vTotTrib>${fmt2(totals.vTotTrib)}</vTotTrib>
        </ICMSTot>
      </total>
      <transp>
        <modFrete>${tr.modFrete}</modFrete>${carrier}${retTransp}${vehicle}${vol}
      </transp>
      <pag>
        <detPag>
          <tPag>${tPag}</tPag>
          <vPag>${fmt2(vPag)}</vPag>
        </detPag>
      </pag>
${
    draft.additionalInfo.fisco.trim() || draft.additionalInfo.complementary.trim()
      ? `      <infAdic>${draft.additionalInfo.fisco.trim() ? `\n        <infAdFisco>${x(draft.additionalInfo.fisco, 2000)}</infAdFisco>` : ''}${
          draft.additionalInfo.complementary.trim() ? `\n        <infCpl>${x(draft.additionalInfo.complementary, MOC.infCpl)}</infCpl>` : ''
        }
      </infAdic>\n`
      : ''
  }
  </infNFe>
</NFe>`;
  return { xml, ...key };
}
