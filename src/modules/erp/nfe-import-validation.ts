// ============================================================================
// Validação de entrada (zod) das rotas /api/erp/nfe-importacao/* — item #10 da revisão fiscal
// Entradas inválidas (sem DI, alíquotas fora da faixa, valores negativos, PTAX ausente) => HTTP 400
// ============================================================================

import { z } from 'zod';

const money = z.coerce
  .number({ invalid_type_error: 'deve ser numérico' })
  .finite('deve ser um número finito')
  .min(0, 'não pode ser negativo');

const ratePercent = z.coerce
  .number({ invalid_type_error: 'deve ser numérico' })
  .finite('deve ser um número finito')
  .min(0, 'alíquota não pode ser negativa')
  .max(100, 'alíquota não pode passar de 100%');

const shortText = (max: number) => z.string().trim().min(1, 'obrigatório').max(max, `máximo de ${max} caracteres`);

const declaredValuesSchema = z
  .object({
    fingerprint: z.string().max(400),
    vFrete: money.optional(),
    vSeg: money.optional(),
    vII: money.optional(),
    vIPI: money.optional(),
    vPIS: money.optional(),
    vCOFINS: money.optional(),
    vBC_ICMS: money.optional(),
    vICMS: money.optional(),
    vOutro: money.optional(),
    vAFRMM: money.optional(),
  })
  .strip();

export const importDeclarationSchema = z
  .object({
    nDI: shortText(15),
    dDI: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'data no formato AAAA-MM-DD'),
    xLocDesemb: shortText(60),
    UFDesemb: z.string().trim().regex(/^[A-Z]{2}$/, 'UF com 2 letras'),
    dDesemb: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'data no formato AAAA-MM-DD'),
    tpViaTransp: z.enum(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14']),
    vAFRMM: money,
    tpIntermedio: z.enum(['1', '2', '3']),
    cExportador: shortText(60),
    currency: z.string().trim().min(3).max(3),
    exchangeRatePtax: z.coerce
      .number({ required_error: 'PTAX obrigatória', invalid_type_error: 'PTAX deve ser numérica' })
      .finite()
      .positive('PTAX deve ser maior que zero'),
    fobTotalForeign: money,
    freteInternacionalBrl: money,
    seguroInternacionalBrl: money,
    taxaSiscomexTotalBrl: money,
    outrasDespesasAduaneirasBrl: money,
    somarTributosEmVOutroSimples: z.boolean(),
    exporterIdEstrangeiro: z.string().trim().max(20, 'máximo de 20 caracteres'),
    exporterName: shortText(60),
    exporterAddress: shortText(60),
    exporterCountryCodeBacen: z.string().trim().regex(/^\d{4}$/, 'código BACEN de 4 dígitos'),
    exporterCountryName: shortText(60),
    additions: z
      .array(
        z
          .object({
            nAdicao: z.string().trim().min(1).max(3),
            nSeqAdic: z.string().trim().min(1).max(5),
            cFabricante: shortText(60),
            vDescDI: money,
            nDraw: z.string().max(20).optional(),
          })
          .strip()
      )
      .max(999),
  })
  .passthrough();

export const rawImportItemSchema = z
  .object({
    id: z.string().max(80),
    cProd: shortText(60),
    cEAN: z.string().trim().max(14).optional(),
    xProd: shortText(120),
    ncm: z.string().trim().regex(/^\d{8}$/, 'NCM com 8 dígitos'),
    cfop: z.enum(['3.101', '3.102', '3.551', '3.949']),
    uCom: shortText(6),
    qCom: z.coerce.number().finite().positive('quantidade deve ser maior que zero'),
    fobUnitForeign: money,
    orig: z.enum(['1', '2', '6', '7']).optional(),
    csosn: z.enum(['900', '101', '102', '400']).optional(),
    cstIpi: z.enum(['49', '99', '00', '01']).optional(),
    cstPisCofins: z.enum(['70', '98', '99', '50']).optional(),
    iiRatePercent: ratePercent,
    ipiRatePercent: ratePercent,
    pisRatePercent: ratePercent,
    cofinsRatePercent: ratePercent,
    icmsRatePercent: z.coerce.number().finite().min(0).max(99, 'alíquota de ICMS deve ser menor que 100%'),
    icmsReductionPercent: ratePercent.optional(),
    nAdicao: z.string().trim().min(1).max(3),
    nSeqAdic: z.string().trim().min(1).max(5),
    cFabricante: shortText(60),
    declaredValues: declaredValuesSchema.optional(),
  })
  .strip();

export const importNfeRequestSchema = z
  .object({
    serie: z
      .union([z.string(), z.number()])
      .transform((v) => String(v).trim())
      .refine((v) => /^\d{1,3}$/.test(v), 'série numérica de 1 a 3 dígitos')
      .optional(),
    nNF: z
      .union([z.string(), z.number()])
      .transform((v) => String(v).trim())
      .refine((v) => v === '' || (/^\d{1,9}$/.test(v) && Number(v) > 0), 'nNF numérico de 1 a 9 dígitos')
      .optional(),
    natOp: z.string().trim().max(60, 'máximo de 60 caracteres').optional(),
    crt: z.enum(['1', '2', '3']).optional(),
    finNFe: z.enum(['1', '2']).optional(),
    indFinal: z.enum(['0', '1']).optional(),
    indPres: z.enum(['0', '9']).optional(),
    indIntermed: z.enum(['0', '1']).optional(),
    di: importDeclarationSchema,
    rawItems: z.array(rawImportItemSchema).min(1, 'informe ao menos um item').max(990, 'máximo de 990 itens'),
  })
  .strip();

export type ImportNfeRequest = z.infer<typeof importNfeRequestSchema>;

export function validateImportNfeRequest(
  body: unknown
): { ok: true; data: ImportNfeRequest } | { ok: false; error: string; issues: Array<{ path: string; message: string }> } {
  const parsed = importNfeRequestSchema.safeParse(body);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.') || '(corpo)', message: i.message }));
  return {
    ok: false,
    error: `Dados inválidos para a NF-e de importação: ${issues
      .slice(0, 5)
      .map((i) => `${i.path}: ${i.message}`)
      .join('; ')}${issues.length > 5 ? ` (+${issues.length - 5})` : ''}`,
    issues,
  };
}
