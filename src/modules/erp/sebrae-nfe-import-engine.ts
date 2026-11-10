// ============================================================================
// Motor Oficial de NF-e de Importação para Empresas do Simples Nacional
// Baseado no Emissor NF-e 4.01 Sebrae + Layout SEFAZ 4.00 + SetaIT/app-nfe-importacao
// ============================================================================

import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  ErpImportDeclarationInfo,
  ErpImportNfeItem,
  ErpImportNfeMetadata,
} from '../../db/types';

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

function round10(val: number): number {
  return Number((Number(val || 0)).toFixed(10));
}

function fmt2(val: number): string {
  return round2(Number(val || 0)).toFixed(2);
}

function fmt4(val: number): string {
  return (Math.round((Number(val || 0) + Number.EPSILON) * 10000) / 10000).toFixed(4);
}

/** vUnCom / vUnTrib: layout 4.00 aceita até 10 casas decimais (13v0-10). */
function fmt10(val: number): string {
  return round10(val).toFixed(10);
}

// ----------------------------------------------------------------------------
// Limites e sanitização (item #8 / #9 da revisão fiscal)
// ----------------------------------------------------------------------------

/** Limite máximo do arquivo .TXT/.XML de importação (2 MB). */
export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024;

export class ImportFileTooLargeError extends Error {
  readonly code = 'IMPORT_FILE_TOO_LARGE';
  constructor(readonly sizeBytes: number) {
    super(
      `Arquivo de importação com ${(sizeBytes / 1024 / 1024).toFixed(2)} MB excede o limite de ${(MAX_IMPORT_FILE_BYTES / 1024 / 1024).toFixed(0)} MB.`
    );
    this.name = 'ImportFileTooLargeError';
  }
}

export class ImportCnpjMismatchError extends Error {
  readonly code = 'IMPORT_CNPJ_MISMATCH';
  constructor(
    readonly fileCnpj: string,
    readonly configuredCnpj: string,
    readonly source: string
  ) {
    super(
      `Trava de CNPJ: o arquivo importado pertence ao CNPJ ${formatCnpjDigits(fileCnpj)} (${source}), diferente do CNPJ do emitente configurado (${configuredCnpj}). Importação bloqueada.`
    );
    this.name = 'ImportCnpjMismatchError';
  }
}

export function utf8ByteLength(content: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(content).length;
  return content.length * 3;
}

/**
 * #25: decodifica o arquivo enviado detectando a codificação. O TXT do Emissor Sebrae pode vir em
 * ISO-8859-1/Windows-1252: declaração XML encoding="ISO-8859-1" ou bytes que não formam UTF-8 válido
 * => windows-1252; caso contrário UTF-8 (com remoção do BOM).
 */
export function decodeImportFileBytes(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'windows-1252' } {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  const declared = head.match(/encoding\s*=\s*["']([A-Za-z0-9_\-]+)["']/i)?.[1]?.toLowerCase();
  if (declared && /^(iso-8859-1|iso8859-1|latin1|windows-1252|cp1252)$/.test(declared)) {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

function formatCnpjDigits(d: string): string {
  const x = String(d || '').replace(/\D/g, '');
  if (x.length !== 14) return x;
  return `${x.slice(0, 2)}.${x.slice(2, 5)}.${x.slice(5, 8)}/${x.slice(8, 12)}-${x.slice(12)}`;
}

/** Tamanhos máximos de campo (MOC 7.0 / NT layout 4.00). */
const MOC = {
  natOp: 60,
  xNome: 60,
  xFant: 60,
  email: 60,
  idEstrangeiro: 20,
  xLgr: 60,
  nro: 60,
  xBairro: 60,
  xMun: 60,
  xPais: 60,
  cProd: 60,
  cEAN: 14,
  xProd: 120,
  uCom: 6,
  nDI: 15,
  xLocDesemb: 60,
  cExportador: 60,
  nAdicao: 3,
  nSeqAdic: 5,
  cFabricante: 60,
  infCpl: 5000,
  xTexto: 500,
} as const;

/** Campo TXT Sebrae: remove pipes e quebras de linha e limita ao tamanho do MOC. */
export function sanitizeTxtField(value: unknown, maxLen = 500): string {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\|/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/** Escapa & < > " ' para conteúdo/atributo XML. */
export function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlField(value: unknown, maxLen = 500): string {
  return escapeXml(
    String(value ?? '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ')
      .replace(/[\r\n\t]+/g, ' ')
      .trim()
      .slice(0, maxLen)
  );
}

// ----------------------------------------------------------------------------
// Chave de acesso (44 dígitos, DV módulo 11) e data/hora America/Sao_Paulo (#6)
// ----------------------------------------------------------------------------

/** DV módulo 11 da chave de acesso NF-e (pesos 2..9 da direita para a esquerda). */
export function computeNfeAccessKeyDv(key43: string): string {
  const digits = key43.replace(/\D/g, '');
  if (digits.length !== 43) {
    throw new Error(`Chave de acesso sem DV deve ter 43 dígitos (recebido ${digits.length}).`);
  }
  let weight = 2;
  let sum = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return rest < 2 ? '0' : String(11 - rest);
}

export function buildNfeAccessKey(params: {
  cUF: string;
  aamm: string;
  cnpj: string;
  mod: string;
  serie: string | number;
  nNF: string | number;
  tpEmis: string;
  cNF: string;
}): { key: string; dv: string } {
  const key43 =
    String(params.cUF).replace(/\D/g, '').padStart(2, '0').slice(-2) +
    String(params.aamm).replace(/\D/g, '').padStart(4, '0').slice(-4) +
    String(params.cnpj).replace(/\D/g, '').padStart(14, '0').slice(-14) +
    String(params.mod).replace(/\D/g, '').padStart(2, '0').slice(-2) +
    String(params.serie).replace(/\D/g, '').padStart(3, '0').slice(-3) +
    String(params.nNF).replace(/\D/g, '').padStart(9, '0').slice(-9) +
    String(params.tpEmis).replace(/\D/g, '').slice(0, 1) +
    String(params.cNF).replace(/\D/g, '').padStart(8, '0').slice(-8);
  const dv = computeNfeAccessKeyDv(key43);
  return { key: key43 + dv, dv };
}

/** Data/hora no fuso America/Sao_Paulo com o offset real (ex.: 2026-10-29T22:40:00-03:00). */
export function formatSaoPauloDateTime(date: Date = new Date()): { dhEmi: string; aamm: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  const y = Number(parts.year);
  const mo = Number(parts.month);
  const d = Number(parts.day);
  const h = Number(parts.hour) % 24;
  const mi = Number(parts.minute);
  const s = Number(parts.second);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const offsetMin = Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  const sign = offsetMin <= 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const off = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    dhEmi: `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}${off}`,
    aamm: `${String(y).slice(-2)}${pad(mo)}`,
  };
}

/** cNF aleatório de 8 dígitos, diferente do nNF e de sequências triviais. */
export function generateRandomCnf(nNF: string | number): string {
  const nnf8 = String(nNF).replace(/\D/g, '').padStart(8, '0').slice(-8);
  const forbidden = new Set(['00000000', '11111111', '22222222', '33333333', '44444444', '55555555', '66666666', '77777777', '88888888', '99999999', '12345678', '23456789', '34567890', '98765432', '87654321', '76543210', nnf8]);
  for (let attempt = 0; attempt < 50; attempt++) {
    let n: number;
    const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto;
    if (c?.getRandomValues) {
      n = c.getRandomValues(new Uint32Array(1))[0] % 100000000;
    } else {
      n = Math.floor(Math.random() * 100000000);
    }
    const cnf = String(n).padStart(8, '0');
    if (!forbidden.has(cnf)) return cnf;
  }
  return '40718293';
}

/** Rateio proporcional com o resíduo de arredondamento lançado no último item (#17). */
function allocateWithResidue(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const t = round2(total);
  const sumW = weights.reduce((s, w) => s + w, 0);
  const shares: number[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    if (i === n - 1) {
      shares.push(round2(t - acc));
    } else {
      const share = round2(sumW > 0 ? (t * weights[i]) / sumW : t / n);
      shares.push(share);
      acc = round2(acc + share);
    }
  }
  return shares;
}

export interface SebraeTxtFinding {
  severity: 'error' | 'warning' | 'info';
  category: 'layout' | 'fiscal' | 'sefaz';
  record: string;
  message: string;
  autoFix: boolean;
}

export interface SebraeTxtAnalysisResult {
  filename: string;
  recordsCount: number;
  itemsCount: number;
  noteNumber: string | null;
  crt: string | null;
  findings: SebraeTxtFinding[];
  correctedTxt: string;
}

export const BACEN_COUNTRIES: Array<{ code: string; name: string }> = [
  { code: '1600', name: 'CHINA, REPUBLICA POPULAR' },
  { code: '2496', name: 'ESTADOS UNIDOS' },
  { code: '1619', name: 'FORMOSA (TAIWAN)' },
  { code: '0230', name: 'ALEMANHA' },
  { code: '1902', name: 'COREIA, REPUBLICA DA (COREIA DO SUL)' },
  { code: '3999', name: 'JAPAO' },
  { code: '3867', name: 'ITALIA' },
  { code: '3654', name: 'ISRAEL' },
  { code: '6289', name: 'REINO UNIDO' },
  { code: '1490', name: 'CANADA' },
];

/**
 * Valores fiscais declarados no arquivo/DI importado (TXT Sebrae ou XML NF-e).
 * Quando presentes e ainda coerentes com o item (mesma quantidade, valor e alíquotas),
 * são preservados em vez de recalculados (#3: "preservar os valores da DI").
 */
export interface DeclaredImportItemValues {
  fingerprint: string;
  vFrete?: number;
  vSeg?: number;
  vII?: number;
  vIPI?: number;
  vPIS?: number;
  vCOFINS?: number;
  vBC_ICMS?: number;
  vICMS?: number;
  vOutro?: number;
  vAFRMM?: number;
}

export interface RawImportItemDraft {
  id: string;
  cProd: string;
  cEAN?: string;
  xProd: string;
  ncm: string;
  cfop: '3.101' | '3.102' | '3.551' | '3.949';
  uCom: string;
  qCom: number;
  fobUnitForeign: number;
  orig?: '1' | '2' | '6' | '7';
  csosn?: '900' | '101' | '102' | '400';
  cstIpi?: '49' | '99' | '00' | '01';
  cstPisCofins?: '70' | '98' | '99' | '50';
  iiRatePercent: number;
  ipiRatePercent: number;
  pisRatePercent: number;
  cofinsRatePercent: number;
  icmsRatePercent: number;
  icmsReductionPercent?: number;
  nAdicao: string;
  nSeqAdic: string;
  cFabricante: string;
  declaredValues?: DeclaredImportItemValues;
}

/** Impressão digital do item: se o usuário editar quantidade, valor ou alíquotas, os valores declarados deixam de valer. */
export function declaredValuesFingerprint(
  it: Pick<
    RawImportItemDraft,
    'qCom' | 'fobUnitForeign' | 'iiRatePercent' | 'ipiRatePercent' | 'pisRatePercent' | 'cofinsRatePercent' | 'icmsRatePercent' | 'icmsReductionPercent'
  >,
  ptax: number
): string {
  return [
    it.qCom,
    it.fobUnitForeign,
    it.iiRatePercent,
    it.ipiRatePercent,
    it.pisRatePercent,
    it.cofinsRatePercent,
    it.icmsRatePercent,
    it.icmsReductionPercent ?? 0,
    ptax,
  ]
    .map((n) => Number(Number(n || 0).toFixed(10)))
    .join('|');
}

function pickDeclared(v: number | undefined): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? round2(v) : undefined;
}

export function calculateSebraeImportNfe(params: {
  serie: string;
  nNF: string;
  natOp: string;
  crt?: '1' | '2' | '3';
  finNFe?: '1' | '2';
  indFinal?: '0' | '1';
  indPres?: '0' | '9';
  indIntermed?: '0' | '1';
  di: ErpImportDeclarationInfo;
  rawItems: RawImportItemDraft[];
  emitterName?: string;
  emitterCnpj?: string;
  emitterIe?: string;
  emitterUf?: string;
  /** Data/hora da emissão (default: agora). Convertida para America/Sao_Paulo. */
  issuedAt?: Date | string;
  /** Código numérico da chave (default: aleatório de 8 dígitos). */
  cNF?: string;
  /** Ambiente da numeração e do tpAmb (Configurações Fiscais). Default: HOMOLOGACAO (tpAmb=2). */
  environment?: 'HOMOLOGACAO' | 'PRODUCAO';
}): ErpImportNfeMetadata {
  // #10: sem PTAX padrão — a taxa de câmbio deve vir da DI/DUIMP
  const ptax = Number(params.di?.exchangeRatePtax);
  if (!Number.isFinite(ptax) || ptax <= 0) {
    throw new Error('Taxa de câmbio PTAX da DI ausente ou inválida (informe um valor maior que zero).');
  }
  const rawItems = params.rawItems.length > 0 ? params.rawItems : [];

  // 1. FOB Total in BRL per item (vUnCom com 10 casas decimais — #17)
  const itemFobs = rawItems.map((it) => {
    const qty = Math.max(0.0001, Number(it.qCom || 1));
    const unitBrl = round10(Number(it.fobUnitForeign || 0) * ptax);
    const vProdBrl = round2(qty * unitBrl);
    const declared =
      it.declaredValues && it.declaredValues.fingerprint === declaredValuesFingerprint(it, ptax)
        ? it.declaredValues
        : undefined;
    return { qty, unitBrl, vProdBrl, declared };
  });

  const weights = itemFobs.map((x) => x.vProdBrl);
  // Rateio proporcional pelo valor FOB dos produtos, resíduo no último item (#17)
  const freteShares = allocateWithResidue(Number(params.di.freteInternacionalBrl || 0), weights);
  const seguroShares = allocateWithResidue(Number(params.di.seguroInternacionalBrl || 0), weights);
  const siscomexShares = allocateWithResidue(Number(params.di.taxaSiscomexTotalBrl || 0), weights);
  const afrmmShares = allocateWithResidue(Number(params.di.vAFRMM || 0), weights);
  const despShares = allocateWithResidue(Number(params.di.outrasDespesasAduaneirasBrl || 0), weights);

  const calculatedItems: ErpImportNfeItem[] = rawItems.map((it, idx) => {
    const { qty, unitBrl, vProdBrl, declared } = itemFobs[idx];

    const vFreteShareBrl = pickDeclared(declared?.vFrete) ?? freteShares[idx];
    const vSegShareBrl = pickDeclared(declared?.vSeg) ?? seguroShares[idx];
    const siscomexShareBrl = siscomexShares[idx];
    const afrmmShareBrl = pickDeclared(declared?.vAFRMM) ?? afrmmShares[idx];
    const despAduaneirasShareBrl = despShares[idx];

    // Valor Aduaneiro (CIF = FOB + Frete Internacional + Seguro Internacional)
    const valorAduaneiroBrl = round2(vProdBrl + vFreteShareBrl + vSegShareBrl);

    // 1. II (Imposto de Importação)
    const iiRatePercent = Number(it.iiRatePercent ?? 12);
    const iiAmountBrl = pickDeclared(declared?.vII) ?? round2((valorAduaneiroBrl * iiRatePercent) / 100);

    // 2. IPI na Importação: Base = (Valor Aduaneiro + II)
    const ipiRatePercent = Number(it.ipiRatePercent ?? 5);
    const ipiBaseBrl = round2(valorAduaneiroBrl + iiAmountBrl);
    const ipiAmountBrl = pickDeclared(declared?.vIPI) ?? round2((ipiBaseBrl * ipiRatePercent) / 100);

    // 3. PIS-Importação (Lei 10.865/2004: Base = Valor Aduaneiro)
    const pisRatePercent = Number(it.pisRatePercent ?? 2.1);
    const pisAmountBrl = pickDeclared(declared?.vPIS) ?? round2((valorAduaneiroBrl * pisRatePercent) / 100);

    // 4. COFINS-Importação (Lei 10.865/2004: Base = Valor Aduaneiro)
    const cofinsRatePercent = Number(it.cofinsRatePercent ?? 9.65);
    const cofinsAmountBrl =
      pickDeclared(declared?.vCOFINS) ?? round2((valorAduaneiroBrl * cofinsRatePercent) / 100);

    // 5. Base de Cálculo do ICMS na Importação ("Cálculo Por Dentro" — Art. 13, V da LC 87/1996)
    // BC ICMS = (Vlr Aduaneiro + II + IPI + PIS-Imp + COFINS-Imp + Taxa SISCOMEX + AFRMM + Desp. Aduaneiras) / (1 - AliqEfetiva)
    const icmsRatePercent = Number(it.icmsRatePercent ?? 18);
    const icmsReductionPercent = Number(it.icmsReductionPercent ?? 0);
    const effectiveIcmsFactor =
      (icmsRatePercent / 100) * (1 - Math.min(100, Math.max(0, icmsReductionPercent)) / 100);
    const divisor = Math.max(0.01, 1 - effectiveIcmsFactor);

    const numeratorBeforeIcms = round2(
      valorAduaneiroBrl +
        iiAmountBrl +
        ipiAmountBrl +
        pisAmountBrl +
        cofinsAmountBrl +
        siscomexShareBrl +
        afrmmShareBrl +
        despAduaneirasShareBrl
    );

    const icmsBaseCalculoPorDentroBrl =
      pickDeclared(declared?.vBC_ICMS) ?? round2(numeratorBeforeIcms / divisor);
    const icmsAmountBrl =
      pickDeclared(declared?.vICMS) ?? round2(icmsBaseCalculoPorDentroBrl * effectiveIcmsFactor);

    // 6. Outras Despesas Acessórias (vOutro) no Simples Nacional (Padrão Sebrae 4.01)
    // Quando somarTributosEmVOutroSimples = true, soma PIS + COFINS + ICMS + SISCOMEX + AFRMM + Desp.Aduaneiras em vOutro
    // para que vNF feche exatamente com o desembolso total da DI sem Rejeição 610 da SEFAZ.
    const customsExpensesOnly = round2(siscomexShareBrl + afrmmShareBrl + despAduaneirasShareBrl);
    const vOutroItemBrl =
      pickDeclared(declared?.vOutro) ??
      (params.di.somarTributosEmVOutroSimples
        ? round2(customsExpensesOnly + pisAmountBrl + cofinsAmountBrl + icmsAmountBrl)
        : customsExpensesOnly);

    const totalItemNfeBrl = round2(
      vProdBrl + vFreteShareBrl + vSegShareBrl + iiAmountBrl + ipiAmountBrl + vOutroItemBrl
    );

    // Normaliza unidade ("UN." -> "UN") conforme regra do SetaIT/app-nfe-importacao
    const cleanUnit = (it.uCom || 'UN').trim().replace(/\.$/, '') || 'UN';

    return {
      id: it.id || `imp-item-${idx + 1}`,
      nItem: idx + 1,
      cProd: it.cProd || `IMP-00${idx + 1}`,
      cEAN: it.cEAN || 'SEM GTIN',
      xProd: it.xProd,
      ncm: (it.ncm || '85176259').replace(/\D/g, '').padEnd(8, '0').slice(0, 8),
      cfop: it.cfop || '3.102',
      uCom: cleanUnit,
      qCom: qty,
      fobUnitForeign: Number(it.fobUnitForeign || 0),
      vUnComBrl: unitBrl,
      vProdBrl,
      vFreteShareBrl,
      vSegShareBrl,
      valorAduaneiroBrl,
      orig: it.orig || '1',
      csosn: it.csosn || '900',
      cstIpi: it.cstIpi || '49',
      cstPisCofins: it.cstPisCofins || '70',
      iiRatePercent,
      iiAmountBrl,
      ipiRatePercent,
      ipiAmountBrl,
      pisRatePercent,
      pisAmountBrl,
      cofinsRatePercent,
      cofinsAmountBrl,
      siscomexShareBrl,
      afrmmShareBrl,
      despAduaneirasShareBrl,
      icmsRatePercent,
      icmsReductionPercent,
      icmsBaseCalculoPorDentroBrl,
      icmsAmountBrl,
      vOutroItemBrl,
      totalItemNfeBrl,
      nAdicao: it.nAdicao || params.di.additions[0]?.nAdicao || '1',
      nSeqAdic: it.nSeqAdic || String(idx + 1),
      cFabricante: it.cFabricante || params.di.cExportador || 'EXPORTADOR-EXT',
      ...(declared ? { declaredValuesApplied: true } : {}),
    };
  });

  const totals = {
    vProd: round2(calculatedItems.reduce((s, i) => s + i.vProdBrl, 0)),
    vFrete: round2(calculatedItems.reduce((s, i) => s + i.vFreteShareBrl, 0)),
    vSeg: round2(calculatedItems.reduce((s, i) => s + i.vSegShareBrl, 0)),
    vAduaneiro: round2(calculatedItems.reduce((s, i) => s + i.valorAduaneiroBrl, 0)),
    vII: round2(calculatedItems.reduce((s, i) => s + i.iiAmountBrl, 0)),
    vIPI: round2(calculatedItems.reduce((s, i) => s + i.ipiAmountBrl, 0)),
    vPIS: round2(calculatedItems.reduce((s, i) => s + i.pisAmountBrl, 0)),
    vCOFINS: round2(calculatedItems.reduce((s, i) => s + i.cofinsAmountBrl, 0)),
    vSiscomex: round2(calculatedItems.reduce((s, i) => s + i.siscomexShareBrl, 0)),
    vAFRMM: round2(calculatedItems.reduce((s, i) => s + i.afrmmShareBrl, 0)),
    vDespAduaneiras: round2(calculatedItems.reduce((s, i) => s + i.despAduaneirasShareBrl, 0)),
    vBC_ICMS: round2(calculatedItems.reduce((s, i) => s + i.icmsBaseCalculoPorDentroBrl, 0)),
    vICMS: round2(calculatedItems.reduce((s, i) => s + i.icmsAmountBrl, 0)),
    vOutro: round2(calculatedItems.reduce((s, i) => s + i.vOutroItemBrl, 0)),
    vNF: round2(calculatedItems.reduce((s, i) => s + i.totalItemNfeBrl, 0)),
    vTotTrib: round2(
      calculatedItems.reduce(
        (s, i) => s + i.iiAmountBrl + i.ipiAmountBrl + i.pisAmountBrl + i.cofinsAmountBrl + i.icmsAmountBrl,
        0
      )
    ),
  };

  const infCpl = [
    `DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL (LC 123/2006 E RESOLUCAO CGSN 140/2018 — CRT=1 / CSOSN 900).`,
    `IMPORTACAO DIRETA DO EXTERIOR — DI/DUIMP Nº ${params.di.nDI} REGISTRADA EM ${params.di.dDI}.`,
    `LOCAL DE DESEMBARACO: ${params.di.xLocDesemb}/${params.di.UFDesemb} EM ${params.di.dDesemb}.`,
    `EXPORTADOR: ${params.di.exporterName} (ID: ${params.di.exporterIdEstrangeiro} - ${params.di.exporterCountryName} BACEN ${params.di.exporterCountryCodeBacen}).`,
    `TAXA DE CAMBIO PTAX APLICADA: 1 ${params.di.currency} = R$ ${ptax.toFixed(4)} | VALOR ADUANEIRO CIF TOTAL: R$ ${fmt2(totals.vAduaneiro)}.`,
    `TRIBUTOS DE IMPORTACAO RECOLHIDOS NO DESEMBARACO: II R$ ${fmt2(totals.vII)} | IPI-IMP R$ ${fmt2(totals.vIPI)} | PIS-IMPORTACAO (2,10%) R$ ${fmt2(totals.vPIS)} | COFINS-IMPORTACAO (9,65%) R$ ${fmt2(totals.vCOFINS)} | TAXA SISCOMEX R$ ${fmt2(totals.vSiscomex)}${totals.vAFRMM > 0 ? ` | AFRMM R$ ${fmt2(totals.vAFRMM)}` : ''}${totals.vDespAduaneiras > 0 ? ` | DESP. ADUANEIRAS R$ ${fmt2(totals.vDespAduaneiras)}` : ''}.`,
    `BASE DE CALCULO DO ICMS ("POR DENTRO" - ART. 13, V DA LC 87/96): R$ ${fmt2(totals.vBC_ICMS)} | ICMS DEVIDO NO DESEMBARACO (GNRE/GARE): R$ ${fmt2(totals.vICMS)}.`,
  ].join(' ');

  const meta: ErpImportNfeMetadata = {
    sebraeVersion: '4.01',
    crt: params.crt || '1',
    natOp: params.natOp || 'IMPORTACAO DE MERCADORIA PARA COMERCIALIZACAO / LOCACAO',
    serie: params.serie || '1',
    nNF: params.nNF || '12',
    tpNF: '0',
    idDest: '3',
    finNFe: params.finNFe || '1',
    indFinal: params.indFinal || '0',
    indPres: params.indPres || '0',
    indIntermed: params.indIntermed || '0',
    di: params.di,
    items: calculatedItems,
    totals,
    infCpl,
  };

  const emitter = {
    emitterName: params.emitterName || 'SETA TELECOM LTDA',
    emitterCnpj: params.emitterCnpj || '18.456.789/0001-90',
    emitterIe: params.emitterIe || '149882410114',
    emitterUf: params.emitterUf || 'SP',
  };

  // #6: chave de acesso real (AAMM da emissão, série, nNF, cNF aleatório, DV módulo 11) e dhEmi em America/Sao_Paulo
  const issuedAt = params.issuedAt ? new Date(params.issuedAt) : new Date();
  const { dhEmi, aamm } = formatSaoPauloDateTime(
    Number.isNaN(issuedAt.getTime()) ? new Date() : issuedAt
  );
  const cNF = (params.cNF && /^\d{8}$/.test(params.cNF) ? params.cNF : '') || generateRandomCnf(meta.nNF);
  const { key, dv } = buildNfeAccessKey({
    cUF: '35',
    aamm,
    cnpj: emitter.emitterCnpj,
    mod: '55',
    serie: meta.serie,
    nNF: meta.nNF,
    tpEmis: '1',
    cNF,
  });
  meta.accessKey = key;
  meta.cNF = cNF;
  meta.cDV = dv;
  meta.dhEmi = dhEmi;
  meta.documentStatus = 'RASCUNHO_NAO_AUTORIZADO';
  meta.environment = params.environment === 'PRODUCAO' ? 'PRODUCAO' : 'HOMOLOGACAO';

  meta.sebraeTxtContent = generateSebrae401Txt(meta, emitter);
  meta.sefazXmlContent = generateSefaz400Xml(meta, emitter);

  return meta;
}

function resolveKeyFields(
  meta: ErpImportNfeMetadata,
  cnpjDigits: string
): { accessKey: string; cNF: string; cDV: string; dhEmi: string } {
  if (meta.accessKey && meta.cNF && meta.cDV && meta.dhEmi) {
    return { accessKey: meta.accessKey, cNF: meta.cNF, cDV: meta.cDV, dhEmi: meta.dhEmi };
  }
  const { dhEmi, aamm } = formatSaoPauloDateTime(new Date());
  const cNF = generateRandomCnf(meta.nNF);
  const { key, dv } = buildNfeAccessKey({
    cUF: '35',
    aamm,
    cnpj: cnpjDigits,
    mod: '55',
    serie: meta.serie,
    nNF: meta.nNF,
    tpEmis: '1',
    cNF,
  });
  return { accessKey: key, cNF, cDV: dv, dhEmi };
}

// ============================================================================
// Gerador de TXT Padrão Emissor NF-e Sebrae 4.01 (Compatível com app-nfe-importacao)
// ============================================================================
/** tpAmb da NF-e: 1 = Produção, 2 = Homologação (padrão do ERP). */
function tpAmbOf(meta: { environment?: 'HOMOLOGACAO' | 'PRODUCAO' }): '1' | '2' {
  return meta.environment === 'PRODUCAO' ? '1' : '2';
}

export function generateSebrae401Txt(
  meta: ErpImportNfeMetadata,
  emitter: {
    emitterName: string;
    emitterCnpj: string;
    emitterIe: string;
    emitterUf: string;
  }
): string {
  const t = sanitizeTxtField;
  const cnpjDigits = emitter.emitterCnpj.replace(/\D/g, '').padEnd(14, '0').slice(0, 14);
  const ieDigits = emitter.emitterIe.replace(/\D/g, '') || '149882410114';
  const { accessKey, cNF, cDV, dhEmi } = resolveKeyFields(meta, cnpjDigits);
  const serie = String(meta.serie).replace(/\D/g, '') || '1';
  const nNF = String(meta.nNF).replace(/\D/g, '');

  const lines: string[] = [
    'NOTA FISCAL|1|',
    `A|4.00|NFe${accessKey}|`,
    // Registro B com >= 21 campos alinhados conforme validador SetaIT/app-nfe-importacao
    `B|35|${cNF}|${t(meta.natOp, MOC.natOp)}|55|${serie}|${nNF}|${dhEmi}|${dhEmi}|0|3|3550308|1|1|${cDV}|${tpAmbOf(meta)}|${meta.finNFe}|${meta.indFinal}|${meta.indPres}|${meta.indIntermed}|3|4.01_SEBRAE|||`,
    // Registro C com CRT no último campo (ex: CRT=1 Simples Nacional)
    `C|${t(emitter.emitterName, MOC.xNome)}|SETA IT TELECOM|${ieDigits}||||${meta.crt}`,
    `C02|${cnpjDigits}|`,
    `C05|AV PAULISTA|1000|CONJ 101|BELA VISTA|3550308|SAO PAULO|${t(emitter.emitterUf, 2)}|01310100|1058|BRASIL|1139584929|`,
    // Registro E: Exportador Estrangeiro (UF=EX, cMun=9999999 EXTERIOR)
    `E|${t(meta.di.exporterName, MOC.xNome)}|9||||financeiro@setatelecom.com.br|`,
    `E03a|${t(meta.di.exporterIdEstrangeiro, MOC.idEstrangeiro)}|`,
    `E05|${t(meta.di.exporterAddress, MOC.xLgr)}|S/N||EXTERIOR|9999999|EXTERIOR|EX||${t(meta.di.exporterCountryCodeBacen, 4)}|${t(meta.di.exporterCountryName, MOC.xPais)}||`,
  ];

  for (const item of meta.items) {
    const cfopClean = item.cfop.replace(/\D/g, '');
    const diDigits = t(meta.di.nDI.replace(/[^\dA-Za-z-]/g, ''), MOC.nDI);
    lines.push(
      `H|${item.nItem}|${t(`DI ${meta.di.nDI} - Adicao ${item.nAdicao} Seq ${item.nSeqAdic} - ICMS BC Por Dentro R$ ${fmt2(item.icmsBaseCalculoPorDentroBrl)}`, MOC.xTexto)}|`
    );
    // Registro I alinhado com CFOP na posição esperada pelo Emissor Sebrae 4.01 (sem "UN.")
    const cProd = t(item.cProd, MOC.cProd);
    const cEAN = t(item.cEAN, MOC.cEAN);
    const uCom = t(item.uCom, MOC.uCom);
    lines.push(
      `I|${cProd}|${cEAN}|${t(item.xProd, MOC.xProd)}|${t(item.ncm, 8)}|||${cfopClean}|${uCom}|${fmt4(item.qCom)}|${fmt10(item.vUnComBrl)}|${fmt2(item.vProdBrl)}|${cEAN}|${uCom}|${fmt4(item.qCom)}|${fmt10(item.vUnComBrl)}|${fmt2(item.vFreteShareBrl)}|${fmt2(item.vSegShareBrl)}|0.00|${fmt2(item.vOutroItemBrl)}|1||||`
    );
    // Registro I18 (Declaração de Importação — >= 12 campos conforme SetaIT/app-nfe-importacao)
    lines.push(
      `I18|${diDigits}|${t(meta.di.dDI, 10)}|${t(meta.di.xLocDesemb, MOC.xLocDesemb)}|${t(meta.di.UFDesemb, 2)}|${t(meta.di.dDesemb, 10)}|${t(meta.di.tpViaTransp, 2)}|${fmt2(item.afrmmShareBrl)}|${t(meta.di.tpIntermedio, 1)}|${cnpjDigits}|${t(emitter.emitterUf, 2)}|${t(meta.di.cExportador, MOC.cExportador)}|`
    );
    // Registro I25 (Adição da DI)
    lines.push(
      `I25|${t(item.nAdicao, MOC.nAdicao)}|${t(item.nSeqAdic, MOC.nSeqAdic)}|${t(item.cFabricante, MOC.cFabricante)}|0.00||`
    );
    // Registro M (Impostos do Item)
    lines.push(
      `M|${fmt2(item.iiAmountBrl + item.ipiAmountBrl + item.pisAmountBrl + item.cofinsAmountBrl + item.icmsAmountBrl)}|`
    );
    // Registro N + N10h (Simples Nacional CSOSN 900 com destaque de BC ICMS por dentro e vICMS)
    lines.push('N|');
    lines.push(
      `N10h|${item.orig}|${item.csosn}|3|${fmt2(item.icmsBaseCalculoPorDentroBrl)}|${fmt2(item.icmsReductionPercent)}|${fmt2(item.icmsRatePercent)}|${fmt2(item.icmsAmountBrl)}||||||||`
    );
    // Registro O (IPI na Importação)
    lines.push('O||||999|');
    lines.push(`O07|${item.cstIpi}|${fmt2(item.ipiAmountBrl)}|`);
    lines.push(`O10|${fmt2(item.valorAduaneiroBrl + item.iiAmountBrl)}|${fmt2(item.ipiRatePercent)}|`);
    // Registro P (Imposto de Importação - II + Despesas Aduaneiras)
    lines.push(
      `P|${fmt2(item.valorAduaneiroBrl)}|${fmt2(item.siscomexShareBrl + item.despAduaneirasShareBrl)}|${fmt2(item.iiAmountBrl)}|0.00|`
    );
    // Registro Q (PIS-Importação)
    lines.push('Q|');
    lines.push(
      `Q05|${item.cstPisCofins}|${fmt2(item.pisAmountBrl)}|`
    );
    lines.push(
      `Q07|${fmt2(item.valorAduaneiroBrl)}|${fmt2(item.pisRatePercent)}|`
    );
    // Registro S (COFINS-Importação)
    lines.push('S|');
    lines.push(
      `S05|${item.cstPisCofins}|${fmt2(item.cofinsAmountBrl)}|`
    );
    lines.push(
      `S07|${fmt2(item.valorAduaneiroBrl)}|${fmt2(item.cofinsRatePercent)}|`
    );
  }

  // Registro W / W02 (Totais da NF-e)
  lines.push('W|');
  lines.push(
    `W02|${fmt2(meta.totals.vBC_ICMS)}|${fmt2(meta.totals.vICMS)}|0.00|0.00|0.00|0.00|0.00|0.00|${fmt2(meta.totals.vProd)}|${fmt2(meta.totals.vFrete)}|${fmt2(meta.totals.vSeg)}|0.00|${fmt2(meta.totals.vII)}|${fmt2(meta.totals.vIPI)}|0.00|${fmt2(meta.totals.vPIS)}|${fmt2(meta.totals.vCOFINS)}|${fmt2(meta.totals.vOutro)}|${fmt2(meta.totals.vNF)}|${fmt2(meta.totals.vTotTrib)}|`
  );
  lines.push('X|0|');
  lines.push(`YA|0|90|${fmt2(meta.totals.vNF)}|`);
  lines.push(`Z||${t(meta.infCpl, MOC.infCpl)}|`);

  return lines.join('\n') + '\n';
}

/** Aviso gravado no XML: o arquivo é um rascunho, sem assinatura e sem protocolo de autorização. */
export const SEFAZ_XML_DRAFT_NOTICE =
  'RASCUNHO NAO AUTORIZADO - NF-e sem assinatura digital e sem protocolo de autorizacao da SEFAZ. Sem validade fiscal; transmitir pelo emissor autorizado.';

// ============================================================================
// Gerador de XML SEFAZ 4.00 — RASCUNHO NÃO AUTORIZADO (<NFe> sem assinatura e sem protNFe)
// ============================================================================
export function generateSefaz400Xml(
  meta: ErpImportNfeMetadata,
  emitter: {
    emitterName: string;
    emitterCnpj: string;
    emitterIe: string;
    emitterUf: string;
  }
): string {
  const x = xmlField;
  const cnpjDigits = emitter.emitterCnpj.replace(/\D/g, '').padEnd(14, '0').slice(0, 14);
  const ieDigits = emitter.emitterIe.replace(/\D/g, '') || '149882410114';
  const { accessKey, cNF, cDV, dhEmi } = resolveKeyFields(meta, cnpjDigits);
  const serie = String(meta.serie).replace(/\D/g, '') || '1';
  const nNF = String(meta.nNF).replace(/\D/g, '');

  const detBlocks = meta.items
    .map((item) => {
      const cfopClean = item.cfop.replace(/\D/g, '');
      return `    <det nItem="${item.nItem}">
      <prod>
        <cProd>${x(item.cProd, MOC.cProd)}</cProd>
        <cEAN>${x(item.cEAN, MOC.cEAN)}</cEAN>
        <xProd>${x(item.xProd, MOC.xProd)}</xProd>
        <NCM>${x(item.ncm, 8)}</NCM>
        <CFOP>${cfopClean}</CFOP>
        <uCom>${x(item.uCom, MOC.uCom)}</uCom>
        <qCom>${fmt4(item.qCom)}</qCom>
        <vUnCom>${fmt10(item.vUnComBrl)}</vUnCom>
        <vProd>${fmt2(item.vProdBrl)}</vProd>
        <cEANTrib>${x(item.cEAN, MOC.cEAN)}</cEANTrib>
        <uTrib>${x(item.uCom, MOC.uCom)}</uTrib>
        <qTrib>${fmt4(item.qCom)}</qTrib>
        <vUnTrib>${fmt10(item.vUnComBrl)}</vUnTrib>
        <vFrete>${fmt2(item.vFreteShareBrl)}</vFrete>
        <vSeg>${fmt2(item.vSegShareBrl)}</vSeg>
        <vOutro>${fmt2(item.vOutroItemBrl)}</vOutro>
        <indTot>1</indTot>
        <DI>
          <nDI>${x(meta.di.nDI, MOC.nDI)}</nDI>
          <dDI>${x(meta.di.dDI, 10)}</dDI>
          <xLocDesemb>${x(meta.di.xLocDesemb, MOC.xLocDesemb)}</xLocDesemb>
          <UFDesemb>${x(meta.di.UFDesemb, 2)}</UFDesemb>
          <dDesemb>${x(meta.di.dDesemb, 10)}</dDesemb>
          <tpViaTransp>${x(meta.di.tpViaTransp, 2)}</tpViaTransp>
          <vAFRMM>${fmt2(item.afrmmShareBrl)}</vAFRMM>
          <tpIntermedio>${x(meta.di.tpIntermedio, 1)}</tpIntermedio>
          <cExportador>${x(meta.di.cExportador, MOC.cExportador)}</cExportador>
          <adi>
            <nAdicao>${x(item.nAdicao, MOC.nAdicao)}</nAdicao>
            <nSeqAdic>${x(item.nSeqAdic, MOC.nSeqAdic)}</nSeqAdic>
            <cFabricante>${x(item.cFabricante, MOC.cFabricante)}</cFabricante>
            <vDescDI>0.00</vDescDI>
          </adi>
        </DI>
      </prod>
      <imposto>
        <vTotTrib>${fmt2(item.iiAmountBrl + item.ipiAmountBrl + item.pisAmountBrl + item.cofinsAmountBrl + item.icmsAmountBrl)}</vTotTrib>
        <ICMS>
          <ICMSSN900>
            <orig>${x(item.orig, 1)}</orig>
            <CSOSN>${x(item.csosn, 3)}</CSOSN>
            <modBC>3</modBC>
            <vBC>${fmt2(item.icmsBaseCalculoPorDentroBrl)}</vBC>
            <pRedBC>${fmt2(item.icmsReductionPercent)}</pRedBC>
            <pICMS>${fmt2(item.icmsRatePercent)}</pICMS>
            <vICMS>${fmt2(item.icmsAmountBrl)}</vICMS>
          </ICMSSN900>
        </ICMS>
        <IPI>
          <cEnq>999</cEnq>
          <IPITrib>
            <CST>${x(item.cstIpi, 2)}</CST>
            <vBC>${fmt2(item.valorAduaneiroBrl + item.iiAmountBrl)}</vBC>
            <pIPI>${fmt2(item.ipiRatePercent)}</pIPI>
            <vIPI>${fmt2(item.ipiAmountBrl)}</vIPI>
          </IPITrib>
        </IPI>
        <II>
          <vBC>${fmt2(item.valorAduaneiroBrl)}</vBC>
          <vDespAdu>${fmt2(item.siscomexShareBrl + item.despAduaneirasShareBrl)}</vDespAdu>
          <vII>${fmt2(item.iiAmountBrl)}</vII>
          <vIOF>0.00</vIOF>
        </II>
        <PIS>
          <PISOutr>
            <CST>${x(item.cstPisCofins, 2)}</CST>
            <vBC>${fmt2(item.valorAduaneiroBrl)}</vBC>
            <pPIS>${fmt2(item.pisRatePercent)}</pPIS>
            <vPIS>${fmt2(item.pisAmountBrl)}</vPIS>
          </PISOutr>
        </PIS>
        <COFINS>
          <COFINSOutr>
            <CST>${x(item.cstPisCofins, 2)}</CST>
            <vBC>${fmt2(item.valorAduaneiroBrl)}</vBC>
            <pCOFINS>${fmt2(item.cofinsRatePercent)}</pCOFINS>
            <vCOFINS>${fmt2(item.cofinsAmountBrl)}</vCOFINS>
          </COFINSOutr>
        </COFINS>
      </imposto>
    </det>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${SEFAZ_XML_DRAFT_NOTICE} -->
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe Id="NFe${accessKey}" versao="4.00">
      <ide>
        <cUF>35</cUF>
        <cNF>${cNF}</cNF>
        <natOp>${x(meta.natOp, MOC.natOp)}</natOp>
        <mod>55</mod>
        <serie>${serie}</serie>
        <nNF>${nNF}</nNF>
        <dhEmi>${dhEmi}</dhEmi>
        <dhSaiEnt>${dhEmi}</dhSaiEnt>
        <tpNF>0</tpNF>
        <idDest>3</idDest>
        <cMunFG>3550308</cMunFG>
        <tpImp>1</tpImp>
        <tpEmis>1</tpEmis>
        <cDV>${cDV}</cDV>
        <tpAmb>${tpAmbOf(meta)}</tpAmb>
        <finNFe>${meta.finNFe}</finNFe>
        <indFinal>${meta.indFinal}</indFinal>
        <indPres>${meta.indPres}</indPres>
        <indIntermed>${meta.indIntermed}</indIntermed>
        <procEmi>3</procEmi>
        <verProc>4.01_SEBRAE</verProc>
      </ide>
      <emit>
        <CNPJ>${cnpjDigits}</CNPJ>
        <xNome>${x(emitter.emitterName, MOC.xNome)}</xNome>
        <xFant>SETA IT TELECOM</xFant>
        <enderEmit>
          <xLgr>AV PAULISTA</xLgr>
          <nro>1000</nro>
          <xBairro>BELA VISTA</xBairro>
          <cMun>3550308</cMun>
          <xMun>SAO PAULO</xMun>
          <UF>${x(emitter.emitterUf, 2)}</UF>
          <CEP>01310100</CEP>
          <cPais>1058</cPais>
          <xPais>BRASIL</xPais>
        </enderEmit>
        <IE>${ieDigits}</IE>
        <CRT>${meta.crt}</CRT>
      </emit>
      <dest>
        <idEstrangeiro>${x(meta.di.exporterIdEstrangeiro, MOC.idEstrangeiro)}</idEstrangeiro>
        <xNome>${x(meta.di.exporterName, MOC.xNome)}</xNome>
        <enderDest>
          <xLgr>${x(meta.di.exporterAddress, MOC.xLgr)}</xLgr>
          <nro>S/N</nro>
          <xBairro>EXTERIOR</xBairro>
          <cMun>9999999</cMun>
          <xMun>EXTERIOR</xMun>
          <UF>EX</UF>
          <cPais>${x(meta.di.exporterCountryCodeBacen, 4)}</cPais>
          <xPais>${x(meta.di.exporterCountryName, MOC.xPais)}</xPais>
        </enderDest>
        <indIEDest>9</indIEDest>
      </dest>
${detBlocks}
      <total>
        <ICMSTot>
          <vBC>${fmt2(meta.totals.vBC_ICMS)}</vBC>
          <vICMS>${fmt2(meta.totals.vICMS)}</vICMS>
          <vICMSDeson>0.00</vICMSDeson>
          <vFCP>0.00</vFCP>
          <vBCST>0.00</vBCST>
          <vST>0.00</vST>
          <vFCPST>0.00</vFCPST>
          <vFCPSTRet>0.00</vFCPSTRet>
          <vProd>${fmt2(meta.totals.vProd)}</vProd>
          <vFrete>${fmt2(meta.totals.vFrete)}</vFrete>
          <vSeg>${fmt2(meta.totals.vSeg)}</vSeg>
          <vDesc>0.00</vDesc>
          <vII>${fmt2(meta.totals.vII)}</vII>
          <vIPI>${fmt2(meta.totals.vIPI)}</vIPI>
          <vIPIDevol>0.00</vIPIDevol>
          <vPIS>${fmt2(meta.totals.vPIS)}</vPIS>
          <vCOFINS>${fmt2(meta.totals.vCOFINS)}</vCOFINS>
          <vOutro>${fmt2(meta.totals.vOutro)}</vOutro>
          <vNF>${fmt2(meta.totals.vNF)}</vNF>
          <vTotTrib>${fmt2(meta.totals.vTotTrib)}</vTotTrib>
        </ICMSTot>
      </total>
      <transp>
        <modFrete>0</modFrete>
      </transp>
      <pag>
        <detPag>
          <indPag>0</indPag>
          <tPag>90</tPag>
          <vPag>${fmt2(meta.totals.vNF)}</vPag>
        </detPag>
      </pag>
      <infAdic>
        <infCpl>${x(meta.infCpl, MOC.infCpl)}</infCpl>
      </infAdic>
  </infNFe>
</NFe>`;
}

// ============================================================================
// Motor Analisador & Corretor de TXT Sebrae 4.01 (Portado de SetaIT/app-nfe-importacao)
// Preserva estritamente CRT, CFOP, CST, CSOSN, NCM, bases, alíquotas e valores
// ============================================================================
export function analyzeAndFixSebraeTxt(
  rawText: string,
  filename = 'NFE_IMPORTACAO_SEBRAE_401.txt'
): SebraeTxtAnalysisResult {
  const lines = rawText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim().length > 0);

  const findings: SebraeTxtFinding[] = [];
  const output: string[] = [];
  let noteNumber: string | null = null;
  let crt: string | null = null;
  let itemsCount = 0;

  for (const line of lines) {
    const firstPipe = line.indexOf('|');
    const record = firstPipe >= 0 ? line.slice(0, firstPipe) : line;
    let fixed = line;

    if (record === 'B') {
      const parts = line.split('|');
      if (parts.length > 6 && parts[6]) {
        noteNumber = parts[6];
      }
      if (parts.length < 20) {
        findings.push({
          severity: 'error',
          category: 'layout',
          record: 'B',
          message:
            'Registro B possui menos campos que o esperado pelo layout 4.00/4.01 (incluindo indIntermed); nenhuma correção automática destrutiva foi aplicada.',
          autoFix: false,
        });
      }
    }

    if (record === 'C') {
      const parts = line.split('|').filter((_, idx, arr) => !(idx === arr.length - 1 && arr[idx] === ''));
      const lastToken = parts[parts.length - 1];
      if (lastToken === '1' || lastToken === '2' || lastToken === '3') {
        crt = lastToken;
        findings.push({
          severity: 'info',
          category: 'fiscal',
          record: 'C',
          message: `CRT informado: ${lastToken} (${
            lastToken === '1' ? 'Simples Nacional' : lastToken === '2' ? 'Simples Nacional - Excesso Sublimite' : 'Regime Normal'
          }). O Firewall Fiscal preserva o CRT e não o altera automaticamente.`,
          autoFix: false,
        });
      }
    }

    if (record === 'I') {
      itemsCount += 1;
      let parts = fixed.split('|');
      const importCfops = ['3101', '3102', '3551', '3949'];
      const cfopAt7 = importCfops.find((cf) => parts[7] === cf);
      if (cfopAt7) {
        parts.splice(7, 0, '');
        fixed = parts.join('|');
        findings.push({
          severity: 'error',
          category: 'layout',
          record: 'I',
          message: `Campo vazio inserido antes do CFOP ${cfopAt7} (posição 7 -> 8) para realinhar o registro I ao schema Sebrae 4.01 sem alterar o CFOP.`,
          autoFix: true,
        });
      }

      parts = fixed.split('|');
      // Normalize "UN." -> "UN" only in unit columns (8, 9, 13, 14) to never mutate product descriptions
      let unitFixed = false;
      for (const unitCol of [8, 9, 13, 14]) {
        if (parts[unitCol] === 'UN.') {
          parts[unitCol] = 'UN';
          unitFixed = true;
        }
      }
      if (unitFixed) {
        fixed = parts.join('|');
        findings.push({
          severity: 'warning',
          category: 'layout',
          record: 'I',
          message:
            'Unidade "UN." normalizada para "UN" nas colunas uCom/uTrib do registro I (evita rejeição de unidade comercial no Emissor Sebrae 4.01). Descrição e valores preservados.',
          autoFix: true,
        });
      }
    }

    if (record === 'I18') {
      const parts = line.split('|');
      if (parts.length < 12) {
        findings.push({
          severity: 'error',
          category: 'layout',
          record: 'I18',
          message:
            'Registro de Declaração de Importação (I18 - DI/DUIMP) incompleto ou desalinhado (< 12 campos); requer revisão de nDI, UFDesemb, tpViaTransp e tpIntermedio.',
          autoFix: false,
        });
      } else {
        findings.push({
          severity: 'info',
          category: 'fiscal',
          record: 'I18',
          message: `Declaração de Importação DI/DUIMP (${parts[1] || 'N/A'}) validada com ${parts.length} colunas alinhadas.`,
          autoFix: false,
        });
      }
    }

    if (record.startsWith('N') && /\|(00|10|20|30|40|41|50|51|60|70|90)\|/.test(line)) {
      findings.push({
        severity: 'info',
        category: 'fiscal',
        record,
        message:
          'Registro contém CST de Regime Normal. Validar compatibilidade com o CRT do emitente; valor preservado pelo Firewall Fiscal.',
        autoFix: false,
      });
    }

    if (record.startsWith('N') && /\|(101|102|103|201|202|203|300|400|500|900)\|/.test(line)) {
      findings.push({
        severity: 'info',
        category: 'fiscal',
        record,
        message:
          'Registro contém CSOSN (Simples Nacional — ex: CSOSN 900 para Importação com destaque de BC ICMS por dentro). Valor preservado sem alteração.',
        autoFix: false,
      });
    }

    output.push(fixed);
  }

  return {
    filename,
    recordsCount: lines.length,
    itemsCount,
    noteNumber,
    crt,
    findings,
    correctedTxt: output.join('\n') + '\n',
  };
}

// Casos de Referência Reais do repositório SetaIT/app-nfe-importacao (NE000007 e NE000012)
export const SEBRAE_REFERENCE_CASES: Record<
  'NE000007' | 'NE000012',
  { title: string; description: string; txt: string }
> = {
  NE000007: {
    title: 'Caso NE000007 — Importação Simples Nacional com Desalinhamento de CFOP 3102 e Unidade "UN."',
    description:
      'Caso de regressão do repositório SetaIT/app-nfe-importacao: contém unidade "UN." e CFOP 3102 deslocado na coluna 7 do registro I, além de CSOSN 900 (N10h) com Base ICMS R$ 21.924,76 e ICMS R$ 3.946,46.',
    txt: [
      'NOTA FISCAL|1|',
      'A|4.00|NFe35260918456789000190550010000000071010201004|',
      'B|35|01020100|IMPORTACAO DE MERCADORIA|55|1|7|2026-09-10T14:20:00-03:00|2026-09-10T14:20:00-03:00|0|3|3550308|1|1|4|2|1|0|0|0|3|4.01_SEBRAE|||',
      'C|SETA TELECOM LTDA|SETA IT|149882410114||||1',
      'E|YEALINK NETWORK TECHNOLOGY CO LTD|9||||export@yealink.com|',
      'E03a|CN-XM-998120|',
      'E05|XIAMEN SOFTWARE PARK|88||HULI DISTRICT|9999999|EXTERIOR|EX||1600|CHINA, REPUBLICA POPULAR||',
      'H|1|DI 26/1849201-4 ADICAO 001 SEQ 01|',
      'I|GC-EQ-00103|SEM GTIN||TERMINAIS IP GIGABIT YEALINK SIP-T43U POE|85171891||3102|UN.|20.0000|750.0000|15000.00|SEM GTIN|UN.|20.0000|750.0000|800.00|200.00|0.00|5924.76|1||||',
      'I18|2618492014|2026-09-05|PORTO DE SANTOS|SP|2026-09-09|1|210.00|1|18456789000190|SP|YEALINK-CN|',
      'I25|1|1|YEALINK-CN|0.00||',
      'N|',
      'N10h|1|900|3|21924.76|0.00|18.00|3946.46||||||||',
      'O||||999|',
      'O07|49|896.00|',
      'O10|17920.00|5.00|',
      'P|16000.00|415.50|1920.00|0.00|',
      'Q|',
      'Q05|70|336.00|',
      'Q07|16000.00|2.10|',
      'S|',
      'S05|70|1544.00|',
      'S07|16000.00|9.65|',
      'W|',
      'W02|21924.76|3946.46|0.00|0.00|0.00|0.00|0.00|0.00|15000.00|800.00|200.00|0.00|1920.00|896.00|0.00|336.00|1544.00|5924.76|24740.76|8642.46|',
      'Z||DI 26/1849201-4 - EMPRESA OPTANTE PELO SIMPLES NACIONAL CRT 1 CSOSN 900.|',
    ].join('\n'),
  },
  NE000012: {
    title: 'Caso NE000012 — NF-e Importação #12 com Múltiplos Itens (NCM 73079900 / 84715010) e Diagnóstico B / I18',
    description:
      'Segundo caso de referência do SetaIT/app-nfe-importacao: testa múltiplos itens de importação (CFOP 3102), verificação de registro B truncado e registro I18 incompleto sem corromper CRT=1 nem CSOSN=900.',
    txt: [
      'NOTA FISCAL|1|',
      'B|35|01020100|IMPORTACAO|55|1|12|2026-09-01T15:30:00-03:00',
      'C|SETA TELECOM LTDA|SETA IT|149882410114||||1',
      'I|SKU1|SEM GTIN||CONECTOR E ACESSORIO DE REDE|73079900||3102|UN.|10.0000|120.0000|1200.00',
      'I18|2619980123|2026-09-01|VIRACOPOS|SP|2026-09-01|4|',
      'N10h|1|900|3|1850.00|0.00|18.00|333.00||||||',
      'I|SKU2|SEM GTIN||APPLIANCE ROUTER SD-WAN PROCESSADOR|84715010|||3102|UN|2.0000|4500.0000|9000.00',
      'N10h|1|900|3|13950.00|0.00|18.00|2511.00||||||',
    ].join('\n'),
  },
};

export interface SebraeImportDraftPayload {
  sourceFormat: 'SEBRAE_TXT_401' | 'SEFAZ_XML_400' | 'SISCOMEX_DI_XML';
  filename: string;
  serie: string;
  nNF: string;
  natOp: string;
  crt: '1' | '2' | '3';
  finNFe: '1' | '2';
  indFinal: '0' | '1';
  indPres: '0' | '9';
  indIntermed: '0' | '1';
  di: ErpImportDeclarationInfo;
  rawItems: RawImportItemDraft[];
  computedMeta: ErpImportNfeMetadata;
  findings: SebraeTxtFinding[];
  correctedTxt: string;
  summaryText: string;
  /** CNPJs do importador encontrados no arquivo (C02, I18, emit/CNPJ) e conferidos contra o emitente configurado */
  fileCnpjs: Array<{ source: string; cnpj: string }>;
}

type ImportEmitterConfig = {
  emitterName?: string;
  emitterCnpj?: string;
  emitterIe?: string;
  emitterUf?: string;
};

function normalizeImportCfop(rawCfop: string | undefined | null): '3.101' | '3.102' | '3.551' | '3.949' {
  const digits = String(rawCfop || '3102').replace(/\D/g, '');
  if (digits === '3101') return '3.101';
  if (digits === '3551') return '3.551';
  if (digits === '3949') return '3.949';
  return '3.102';
}

function formatDiNumber(rawDi: string): string {
  const clean = rawDi.trim();
  if (clean.includes('/')) return clean;
  const digits = clean.replace(/\D/g, '');
  if (digits.length === 10) {
    return `${digits.slice(0, 2)}/${digits.slice(2, 9)}-${digits.slice(9)}`;
  }
  return clean || '26/1849201-4';
}

function numOrUndef(raw: string | undefined | null): number | undefined {
  if (raw === undefined || raw === null || String(raw).trim() === '') return undefined;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) ? n : undefined;
}

function normalizeDateField(v: string): string {
  const t = String(v || '').trim();
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) return `${t.slice(6, 10)}-${t.slice(3, 5)}-${t.slice(0, 2)}`;
  return t.slice(0, 10);
}

/** Ajusta os campos lidos do arquivo aos tamanhos/formatos do MOC antes do cálculo (#9). */
function normalizeParsedDraftFields(di: ErpImportDeclarationInfo, rawItems: RawImportItemDraft[]): void {
  const t = sanitizeTxtField;
  di.nDI = t(di.nDI, MOC.nDI) || '26/1849201-4';
  di.dDI = normalizeDateField(di.dDI);
  di.dDesemb = normalizeDateField(di.dDesemb);
  di.xLocDesemb = t(di.xLocDesemb, MOC.xLocDesemb) || 'NAO INFORMADO';
  di.UFDesemb = (t(di.UFDesemb, 2).toUpperCase() || 'SP') as ErpImportDeclarationInfo['UFDesemb'];
  const via = String(Number(String(di.tpViaTransp || '1').replace(/\D/g, '') || '1'));
  di.tpViaTransp = (Number(via) >= 1 && Number(via) <= 14 ? via : '1') as ErpImportDeclarationInfo['tpViaTransp'];
  di.cExportador = t(di.cExportador, MOC.cExportador) || 'EXPORTADOR-EXT';
  di.exporterIdEstrangeiro = t(di.exporterIdEstrangeiro, MOC.idEstrangeiro);
  di.exporterName = t(di.exporterName, MOC.xNome) || 'EXPORTADOR ESTRANGEIRO';
  di.exporterAddress = t(di.exporterAddress, MOC.xLgr) || 'EXTERIOR';
  di.exporterCountryCodeBacen = (String(di.exporterCountryCodeBacen || '').replace(/\D/g, '') || '1600')
    .padStart(4, '0')
    .slice(-4);
  di.exporterCountryName = t(di.exporterCountryName, MOC.xPais) || 'EXTERIOR';
  for (const it of rawItems) {
    it.cProd = t(it.cProd, MOC.cProd) || 'ITEM';
    it.cEAN = t(it.cEAN || 'SEM GTIN', MOC.cEAN) || 'SEM GTIN';
    it.xProd = t(it.xProd, MOC.xProd) || 'MERCADORIA IMPORTADA';
    it.ncm = (String(it.ncm || '').replace(/\D/g, '') || '85176259').padEnd(8, '0').slice(0, 8);
    it.uCom = t(it.uCom, MOC.uCom) || 'UN';
    it.nAdicao = t(it.nAdicao, MOC.nAdicao) || '1';
    it.nSeqAdic = t(it.nSeqAdic, MOC.nSeqAdic) || '1';
    it.cFabricante = t(it.cFabricante, MOC.cFabricante) || di.cExportador;
  }
  di.additions = di.additions.map((a) => ({
    ...a,
    nAdicao: t(a.nAdicao, MOC.nAdicao) || '1',
    nSeqAdic: t(a.nSeqAdic, MOC.nSeqAdic) || '1',
    cFabricante: t(a.cFabricante, MOC.cFabricante) || di.cExportador,
  }));
}

/**
 * Trava de CNPJ (#5): todo CNPJ de importador encontrado no arquivo deve ser igual ao CNPJ
 * completo do emitente configurado (comparação dos 14 dígitos, sem alterar o valor configurado).
 */
function assertImportCnpjMatches(
  fileCnpjs: Array<{ source: string; cnpj: string }>,
  configuredCnpj: string | undefined,
  findings: SebraeTxtFinding[]
): void {
  const configuredDigits = String(configuredCnpj || '').replace(/\D/g, '');
  const relevant = fileCnpjs.filter((c) => c.cnpj.replace(/\D/g, '').length === 14);
  if (relevant.length === 0) {
    findings.push({
      severity: 'warning',
      category: 'fiscal',
      record: 'CNPJ',
      message: 'O arquivo não informa o CNPJ do importador (C02 / I18 / emit/CNPJ); a trava de CNPJ não pôde ser conferida.',
      autoFix: false,
    });
    return;
  }
  if (!configuredDigits) {
    findings.push({
      severity: 'warning',
      category: 'fiscal',
      record: 'CNPJ',
      message: 'CNPJ do emitente não configurado; a trava de CNPJ do arquivo importado não pôde ser conferida.',
      autoFix: false,
    });
    return;
  }
  for (const c of relevant) {
    const digits = c.cnpj.replace(/\D/g, '');
    if (digits !== configuredDigits) {
      throw new ImportCnpjMismatchError(digits, String(configuredCnpj), c.source);
    }
  }
  findings.push({
    severity: 'info',
    category: 'fiscal',
    record: 'CNPJ',
    message: `Trava de CNPJ conferida: o CNPJ do arquivo (${relevant.map((c) => c.source).join(', ')}) é igual ao do emitente configurado.`,
    autoFix: false,
  });
}

// ============================================================================
// Parser Universal de Arquivo .TXT (Sebrae 4.01) ou .XML (NF-e 4.00 / DI Siscomex)
// Converte o arquivo enviado pelo usuário em um rascunho completo pronto para
// revisão nas 6 abas e emissão da NF-e de Entrada de Importação.
// ============================================================================
export function parseImportFileToSebraeDraft(
  rawContent: string,
  filename = 'arquivo_importacao.txt',
  emitter?: ImportEmitterConfig
): SebraeImportDraftPayload {
  const content = String(rawContent || '');
  // #8: limite de tamanho (2 MB) antes de qualquer processamento
  const size = utf8ByteLength(content);
  if (size > MAX_IMPORT_FILE_BYTES) {
    throw new ImportFileTooLargeError(size);
  }
  const trimmed = content.replace(/^\uFEFF/, '').trim();
  if (!trimmed) {
    throw new Error('O conteúdo do arquivo enviado está vazio.');
  }

  // Proteção de Segurança contra XXE (XML External Entity Injection)
  if (/<!DOCTYPE/i.test(trimmed) || /<!ENTITY/i.test(trimmed)) {
    throw new Error(
      'Arquivo XML bloqueado pelo Firewall de Segurança: declarações <!DOCTYPE ou <!ENTITY (XXE) não são permitidas.'
    );
  }

  const isXml = trimmed.startsWith('<') || filename.toLowerCase().endsWith('.xml');

  if (isXml) {
    return parseXmlToSebraeDraft(trimmed, filename, emitter);
  }
  return parseTxtToSebraeDraft(trimmed, filename, emitter);
}

function parseTxtToSebraeDraft(
  rawTxt: string,
  filename: string,
  emitter?: ImportEmitterConfig
): SebraeImportDraftPayload {
  // 1. Executa primeiro o corretor e Firewall Fiscal do SetaIT/app-nfe-importacao
  const analysis = analyzeAndFixSebraeTxt(rawTxt, filename);
  const findings: SebraeTxtFinding[] = [...analysis.findings];
  const lines = analysis.correctedTxt
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let serie = '1';
  let nNF = analysis.noteNumber || '12';
  let natOp = 'IMPORTACAO DE MERCADORIA PARA COMERCIALIZACAO / LOCACAO';
  let crt: '1' | '2' | '3' =
    analysis.crt === '1' || analysis.crt === '2' || analysis.crt === '3' ? analysis.crt : '1';
  let finNFe: '1' | '2' = '1';
  let indFinal: '0' | '1' = '0';
  let indPres: '0' | '9' = '0';
  let indIntermed: '0' | '1' = '0';
  const fileCnpjs: Array<{ source: string; cnpj: string }> = [];

  const di: ErpImportDeclarationInfo = {
    nDI: '26/1849201-4',
    dDI: '2026-10-18',
    xLocDesemb: 'PORTO DE SANTOS - ALFANDEGA RFB',
    UFDesemb: 'SP',
    dDesemb: '2026-10-21',
    tpViaTransp: '1',
    vAFRMM: 0,
    tpIntermedio: '1',
    cExportador: 'EXPORTADOR-EXT',
    currency: 'USD',
    exchangeRatePtax: 1.0, // TXT já traz valores convertidos em BRL (R$); PTAX=1 preserva valores exatos do TXT
    fobTotalForeign: 0,
    freteInternacionalBrl: 0,
    seguroInternacionalBrl: 0,
    taxaSiscomexTotalBrl: 0,
    outrasDespesasAduaneirasBrl: 0,
    somarTributosEmVOutroSimples: true,
    exporterIdEstrangeiro: 'EXT-ID-001',
    exporterName: 'EXPORTADOR ESTRANGEIRO (IMPORTADO VIA TXT SEBRAE 4.01)',
    exporterAddress: 'ENDERECO NO EXTERIOR',
    exporterCountryCodeBacen: '1600',
    exporterCountryName: 'CHINA, REPUBLICA POPULAR',
    additions: [],
  };

  const rawItems: RawImportItemDraft[] = [];
  let currentItem: RawImportItemDraft | null = null;
  let currentDeclared: Omit<DeclaredImportItemValues, 'fingerprint'> = {};
  const declaredPerItem: Array<Omit<DeclaredImportItemValues, 'fingerprint'>> = [];
  let totalFreteFromItems = 0;
  let totalSegFromItems = 0;
  let totalAfrmmFromItems = 0;
  let totalDespAduFromP = 0;

  const flushItem = () => {
    if (currentItem) {
      rawItems.push(currentItem);
      declaredPerItem.push(currentDeclared);
    }
  };

  for (const line of lines) {
    const parts = line.split('|');
    const rec = parts[0];

    if (rec === 'B') {
      if (parts[3]) natOp = parts[3];
      if (parts[5]) serie = parts[5];
      if (parts[6]) nNF = parts[6];
      if (parts[16] === '1' || parts[16] === '2') finNFe = parts[16];
      if (parts[17] === '0' || parts[17] === '1') indFinal = parts[17];
      if (parts[18] === '0' || parts[18] === '9') indPres = parts[18];
      if (parts[19] === '0' || parts[19] === '1') indIntermed = parts[19];
    } else if (rec === 'C') {
      const nonEmpty = parts.filter((p) => p !== '');
      const last = nonEmpty[nonEmpty.length - 1];
      if (last === '1' || last === '2' || last === '3') crt = last;
    } else if (rec === 'C02') {
      if (parts[1]) fileCnpjs.push({ source: 'registro C02 (CNPJ do emitente)', cnpj: parts[1] });
    } else if (rec === 'E') {
      if (parts[1]) di.exporterName = parts[1];
    } else if (rec === 'E03a' || rec === 'E02') {
      if (parts[1]) di.exporterIdEstrangeiro = parts[1];
    } else if (rec === 'E05') {
      const lgr = [parts[1], parts[2], parts[4]].filter(Boolean).join(', ');
      if (lgr) di.exporterAddress = lgr;
      if (parts[9]) di.exporterCountryCodeBacen = parts[9];
      if (parts[10]) di.exporterCountryName = parts[10];
    } else if (rec === 'I') {
      flushItem();
      currentDeclared = {};
      // Detecta posição do CFOP (4 dígitos iniciados por 3)
      const cfopIdx = parts.findIndex((p, i) => i >= 5 && /^3\d{3}$/.test(p));
      const cProd = parts[1] || `ITEM-${rawItems.length + 1}`;
      const cEAN = parts[2] || 'SEM GTIN';
      // Descrição pode estar em parts[3] ou parts[4] dependendo do gerador legado
      const xProd =
        (parts[4] && !/^\d{8}$/.test(parts[4]) ? parts[4] : parts[3]) ||
        `MERCADORIA IMPORTADA #${rawItems.length + 1}`;
      const ncmCandidate =
        parts.find((p, i) => i >= 3 && i <= 7 && /^\d{8}$/.test(p)) || '85176259';
      const cfopRaw = cfopIdx >= 0 ? parts[cfopIdx] : '3102';
      const uCom = (cfopIdx >= 0 ? parts[cfopIdx + 1] : parts[8]) || 'UN';
      const qCom = Math.max(0.0001, Number((cfopIdx >= 0 ? parts[cfopIdx + 2] : parts[9]) || 1));
      const vUnCom = Math.max(0, Number((cfopIdx >= 0 ? parts[cfopIdx + 3] : parts[10]) || 100));
      // #3: após o CFOP vêm uCom(+1) qCom(+2) vUnCom(+3) vProd(+4) cEANTrib(+5) uTrib(+6) qTrib(+7)
      // vUnTrib(+8) vFrete(+9) vSeg(+10) vDesc(+11) vOutro(+12). Leitura relativa ao CFOP já realinhado.
      const base = cfopIdx >= 0 ? cfopIdx : 7;
      const vFreteItem = Number(parts[base + 9] || 0) || 0;
      const vSegItem = Number(parts[base + 10] || 0) || 0;
      const vOutroItem = numOrUndef(parts[base + 12]);
      totalFreteFromItems += vFreteItem;
      totalSegFromItems += vSegItem;
      currentDeclared.vFrete = round2(vFreteItem);
      currentDeclared.vSeg = round2(vSegItem);
      if (vOutroItem !== undefined) currentDeclared.vOutro = vOutroItem;

      currentItem = {
        id: `txt-item-${rawItems.length + 1}`,
        cProd,
        cEAN,
        xProd,
        ncm: ncmCandidate,
        cfop: normalizeImportCfop(cfopRaw),
        uCom: uCom.replace(/\.$/, '') || 'UN',
        qCom,
        fobUnitForeign: vUnCom,
        orig: '1',
        csosn: '900',
        cstIpi: '49',
        cstPisCofins: '70',
        iiRatePercent: 12,
        ipiRatePercent: 5,
        pisRatePercent: 2.1,
        cofinsRatePercent: 9.65,
        icmsRatePercent: 18,
        icmsReductionPercent: 0,
        nAdicao: String(rawItems.length + 1),
        nSeqAdic: '1',
        cFabricante: di.cExportador,
      };
    } else if (rec === 'I18') {
      if (parts[1]) di.nDI = formatDiNumber(parts[1]);
      if (parts[2]) di.dDI = parts[2];
      if (parts[3]) di.xLocDesemb = parts[3];
      if (parts[4]) di.UFDesemb = parts[4];
      if (parts[5]) di.dDesemb = parts[5];
      if (parts[6]) {
        di.tpViaTransp = parts[6] as ErpImportDeclarationInfo['tpViaTransp'];
      }
      const afrmmVal = Number(parts[7] || 0) || 0;
      totalAfrmmFromItems += afrmmVal;
      if (currentItem) currentDeclared.vAFRMM = round2(afrmmVal);
      if (parts[8] === '1' || parts[8] === '2' || parts[8] === '3') {
        di.tpIntermedio = parts[8];
      }
      if (parts[9]) fileCnpjs.push({ source: 'registro I18 (CNPJ do adquirente na DI)', cnpj: parts[9] });
      if (parts[11]) {
        di.cExportador = parts[11];
        if (currentItem) currentItem.cFabricante = parts[11];
      }
    } else if (rec === 'I25' && currentItem) {
      if (parts[1]) currentItem.nAdicao = parts[1];
      if (parts[2]) currentItem.nSeqAdic = parts[2];
      if (parts[3]) currentItem.cFabricante = parts[3];
      di.additions.push({
        nAdicao: currentItem.nAdicao,
        nSeqAdic: currentItem.nSeqAdic,
        cFabricante: currentItem.cFabricante,
        vDescDI: Number(parts[4] || 0),
      });
    } else if (rec === 'N10h' && currentItem) {
      if (parts[1] === '1' || parts[1] === '2' || parts[1] === '6' || parts[1] === '7') {
        currentItem.orig = parts[1];
      }
      if (parts[2] === '900' || parts[2] === '101' || parts[2] === '102' || parts[2] === '400') {
        currentItem.csosn = parts[2];
      }
      const vBC = numOrUndef(parts[4]);
      if (vBC !== undefined) currentDeclared.vBC_ICMS = vBC;
      if (parts[5] !== undefined && parts[5] !== '') {
        currentItem.icmsReductionPercent = Number(parts[5] || 0);
      }
      if (parts[6] !== undefined && parts[6] !== '') {
        currentItem.icmsRatePercent = Number(parts[6] || 18);
      }
      const vICMS = numOrUndef(parts[7]);
      if (vICMS !== undefined) currentDeclared.vICMS = vICMS;
    } else if (rec === 'O07' && currentItem) {
      if (parts[1] === '49' || parts[1] === '99' || parts[1] === '00' || parts[1] === '01') {
        currentItem.cstIpi = parts[1];
      }
      const vIPI = numOrUndef(parts[2]);
      if (vIPI !== undefined) currentDeclared.vIPI = vIPI;
    } else if (rec === 'O10' && currentItem) {
      if (parts[2] !== undefined && parts[2] !== '') {
        currentItem.ipiRatePercent = Number(parts[2] || 0);
      }
    } else if (rec === 'P' && currentItem) {
      const vBC = Number(parts[1] || 0);
      const vDespAdu = Number(parts[2] || 0);
      const vII = Number(parts[3] || 0);
      totalDespAduFromP += vDespAdu;
      if (vBC > 0 && vII >= 0) {
        currentItem.iiRatePercent = round2((vII / vBC) * 100);
      }
      const declaredII = numOrUndef(parts[3]);
      if (declaredII !== undefined) currentDeclared.vII = declaredII;
    } else if (rec === 'Q05' && currentItem) {
      if (parts[1] === '70' || parts[1] === '98' || parts[1] === '99' || parts[1] === '50') {
        currentItem.cstPisCofins = parts[1];
      }
      const vPIS = numOrUndef(parts[2]);
      if (vPIS !== undefined) currentDeclared.vPIS = vPIS;
    } else if (rec === 'Q07' && currentItem) {
      if (parts[2] !== undefined && parts[2] !== '') {
        currentItem.pisRatePercent = Number(parts[2] || 2.1);
      }
    } else if (rec === 'S05' && currentItem) {
      const vCOFINS = numOrUndef(parts[2]);
      if (vCOFINS !== undefined) currentDeclared.vCOFINS = vCOFINS;
    } else if (rec === 'S07' && currentItem) {
      if (parts[2] !== undefined && parts[2] !== '') {
        currentItem.cofinsRatePercent = Number(parts[2] || 9.65);
      }
    } else if (rec === 'W02') {
      if (!totalFreteFromItems && Number(parts[10] || 0) > 0) {
        totalFreteFromItems = Number(parts[10]);
      }
      if (!totalSegFromItems && Number(parts[11] || 0) > 0) {
        totalSegFromItems = Number(parts[11]);
      }
    }
  }

  flushItem();
  if (rawItems.length === 0) {
    throw new Error(
      'Nenhum item de produto (Registro I) foi encontrado no arquivo TXT enviado.'
    );
  }

  // #5: trava de CNPJ do arquivo contra o emitente configurado
  assertImportCnpjMatches(fileCnpjs, emitter?.emitterCnpj, findings);

  di.freteInternacionalBrl = round2(totalFreteFromItems);
  di.seguroInternacionalBrl = round2(totalSegFromItems);
  di.vAFRMM = round2(totalAfrmmFromItems);
  if (totalDespAduFromP > 0) {
    di.taxaSiscomexTotalBrl = round2(Math.min(214.5, totalDespAduFromP));
    di.outrasDespesasAduaneirasBrl = round2(Math.max(0, totalDespAduFromP - di.taxaSiscomexTotalBrl));
  }
  di.fobTotalForeign = round2(
    rawItems.reduce((s, it) => s + it.qCom * it.fobUnitForeign, 0)
  );
  if (di.additions.length === 0) {
    di.additions = rawItems.map((it) => ({
      nAdicao: it.nAdicao,
      nSeqAdic: it.nSeqAdic,
      cFabricante: it.cFabricante,
      vDescDI: 0,
    }));
  }

  normalizeParsedDraftFields(di, rawItems);

  // #3: preserva os valores declarados no arquivo/DI (II, IPI, PIS, COFINS, BC/ICMS, vOutro, frete, seguro, AFRMM)
  rawItems.forEach((it, idx) => {
    it.declaredValues = {
      ...declaredPerItem[idx],
      fingerprint: declaredValuesFingerprint(it, di.exchangeRatePtax),
    };
  });

  const computedMeta = calculateSebraeImportNfe({
    serie,
    nNF,
    natOp,
    crt,
    finNFe,
    indFinal,
    indPres,
    indIntermed,
    di,
    rawItems,
    emitterName: emitter?.emitterName,
    emitterCnpj: emitter?.emitterCnpj,
    emitterIe: emitter?.emitterIe,
    emitterUf: emitter?.emitterUf,
  });

  const autoFixesCount = analysis.findings.filter((f) => f.autoFix).length;
  const summaryText = `Arquivo TXT Sebrae 4.01 "${filename}" importado com sucesso: NF-e #${nNF} | DI ${di.nDI} | ${rawItems.length} item(ns) | Total vNF R$ ${fmt2(computedMeta.totals.vNF)} | BC ICMS Por Dentro R$ ${fmt2(computedMeta.totals.vBC_ICMS)} (${autoFixesCount} correção(ões) estrutural(is) aplicada(s) pelo Firewall Fiscal; valores da DI preservados).`;

  return {
    sourceFormat: 'SEBRAE_TXT_401',
    filename,
    serie,
    nNF,
    natOp,
    crt,
    finNFe,
    indFinal,
    indPres,
    indIntermed,
    di,
    rawItems,
    computedMeta,
    findings,
    correctedTxt: computedMeta.sebraeTxtContent || analysis.correctedTxt,
    summaryText,
    fileCnpjs,
  };
}

// ----------------------------------------------------------------------------
// XML: parser seguro (fast-xml-parser, processEntities:false) — #8 / #23
// ----------------------------------------------------------------------------
type XmlNode = Record<string, unknown>;

/** Decodifica apenas as 5 entidades predefinidas e referências numéricas (sem entidades customizadas). */
function decodeBasicXmlEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, ent: string) => {
    if (ent === 'amp') return '&';
    if (ent === 'lt') return '<';
    if (ent === 'gt') return '>';
    if (ent === 'quot') return '"';
    if (ent === 'apos') return "'";
    const code = ent.startsWith('#x') ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

const SAFE_XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false,
  htmlEntities: false,
  trimValues: true,
  allowBooleanAttributes: false,
  isArray: (name) => name === 'det' || name === 'adicao' || name === 'adi' || name === 'DI',
  tagValueProcessor: (_tagName, tagValue) => decodeBasicXmlEntities(String(tagValue)),
});

function parseSafeXml(rawXml: string): XmlNode {
  const valid = XMLValidator.validate(rawXml, { allowBooleanAttributes: false });
  if (valid !== true) {
    const err = (valid as { err?: { msg?: string; line?: number } }).err;
    throw new Error(
      `XML malformado: ${err?.msg || 'estrutura inválida'}${err?.line ? ` (linha ${err.line})` : ''}.`
    );
  }
  const parsed = SAFE_XML_PARSER.parse(rawXml) as XmlNode;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('XML vazio ou inválido.');
  }
  return parsed;
}

function one(v: unknown): XmlNode | undefined {
  const x = Array.isArray(v) ? v[0] : v;
  return x && typeof x === 'object' ? (x as XmlNode) : undefined;
}

function many(v: unknown): XmlNode[] {
  if (v === undefined || v === null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.filter((x): x is XmlNode => !!x && typeof x === 'object');
}

/** Valor texto de um filho direto (nome exato da tag — #23: <PIS> não casa mais com <PISOutr>). */
function txt(node: XmlNode | undefined, key: string): string | null {
  if (!node) return null;
  const v = Array.isArray(node[key]) ? (node[key] as unknown[])[0] : node[key];
  if (v === undefined || v === null) return null;
  if (typeof v === 'object') {
    const t = (v as XmlNode)['#text'];
    return t === undefined || t === null ? null : String(t).trim();
  }
  return String(v).trim();
}

/** Busca em profundidade o primeiro nó com o nome indicado (iterativa, linear no tamanho da árvore). */
function findFirstNode(root: unknown, key: string): XmlNode | undefined {
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    if (Array.isArray(cur)) {
      for (let i = cur.length - 1; i >= 0; i--) stack.push(cur[i]);
      continue;
    }
    const obj = cur as XmlNode;
    if (key in obj) {
      const found = one(obj[key]);
      if (found) return found;
    }
    const keys = Object.keys(obj);
    for (let i = keys.length - 1; i >= 0; i--) {
      const k = keys[i];
      if (k.startsWith('@_') || k === '#text') continue;
      stack.push(obj[k]);
    }
  }
  return undefined;
}

function firstChildOf(node: XmlNode | undefined, keys: string[]): XmlNode | undefined {
  if (!node) return undefined;
  for (const k of keys) {
    const c = one(node[k]);
    if (c) return c;
  }
  return undefined;
}

function parseXmlToSebraeDraft(
  rawXml: string,
  filename: string,
  emitter?: ImportEmitterConfig
): SebraeImportDraftPayload {
  const findings: SebraeTxtFinding[] = [];
  const doc = parseSafeXml(rawXml);
  const infNFe = findFirstNode(doc, 'infNFe');
  const siscomexDi = infNFe ? undefined : findFirstNode(doc, 'DeclaracaoImportacao');
  const isSiscomexDiOnly = !!siscomexDi;
  const fileCnpjs: Array<{ source: string; cnpj: string }> = [];

  const ide = one(infNFe?.ide);
  const emit = one(infNFe?.emit);
  const dest = one(infNFe?.dest);
  const serie = txt(ide, 'serie') || '1';
  const nNF = txt(ide, 'nNF') || '16';
  const natOp = txt(ide, 'natOp') || 'IMPORTACAO DE MERCADORIA PARA COMERCIALIZACAO / LOCACAO';
  const rawCrt = txt(emit, 'CRT') || '1';
  const crt: '1' | '2' | '3' = rawCrt === '1' || rawCrt === '2' || rawCrt === '3' ? rawCrt : '1';
  const finNFe: '1' | '2' = txt(ide, 'finNFe') === '2' ? '2' : '1';
  const indFinal: '0' | '1' = txt(ide, 'indFinal') === '1' ? '1' : '0';
  const indPres: '0' | '9' = txt(ide, 'indPres') === '9' ? '9' : '0';
  const indIntermed: '0' | '1' = txt(ide, 'indIntermed') === '1' ? '1' : '0';

  const emitCnpj = txt(emit, 'CNPJ');
  if (emitCnpj) fileCnpjs.push({ source: 'emit/CNPJ (emitente da NF-e)', cnpj: emitCnpj });
  const importadorCnpj = txt(siscomexDi, 'importadorNumero');
  if (importadorCnpj) fileCnpjs.push({ source: 'importadorNumero (DI Siscomex)', cnpj: importadorCnpj });

  findings.push({
    severity: 'info',
    category: 'fiscal',
    record: 'XML',
    message: `Arquivo XML (${isSiscomexDiOnly ? 'DI Siscomex' : 'SEFAZ NF-e 4.00'}) lido com parser seguro (sem DOCTYPE/entidades externas). CRT=${crt} (${crt === '1' ? 'Simples Nacional' : 'Outro'}) preservado pelo Firewall Fiscal.`,
    autoFix: false,
  });

  const detNodes = infNFe ? many(infNFe.det) : [];
  const firstDiNode: XmlNode =
    (detNodes.length > 0 ? one(one(detNodes[0].prod)?.DI) : undefined) || siscomexDi || {};
  const enderDest = one(dest?.enderDest);

  const nDI = formatDiNumber(txt(firstDiNode, 'nDI') || txt(firstDiNode, 'numeroDI') || '26/1849201-4');
  const dDI = txt(firstDiNode, 'dDI') || txt(firstDiNode, 'dataRegistro') || '2026-10-18';
  const xLocDesemb =
    txt(firstDiNode, 'xLocDesemb') || txt(firstDiNode, 'urfDespachoNome') || 'PORTO DE SANTOS - ALFANDEGA RFB';
  const UFDesemb = txt(firstDiNode, 'UFDesemb') || txt(firstDiNode, 'urfDespachoUf') || 'SP';
  const dDesemb = txt(firstDiNode, 'dDesemb') || txt(firstDiNode, 'dataDesembaraco') || dDI;
  const tpViaTransp = (txt(firstDiNode, 'tpViaTransp') ||
    txt(firstDiNode, 'viaTransporteCodigo') ||
    '1') as ErpImportDeclarationInfo['tpViaTransp'];
  const tpIntermedio = (txt(firstDiNode, 'tpIntermedio') || '1') as '1' | '2' | '3';
  const cExportador = txt(firstDiNode, 'cExportador') || txt(dest, 'idEstrangeiro') || 'EXPORTADOR-EXT';
  const diCnpj = txt(firstDiNode, 'CNPJ');
  if (diCnpj) fileCnpjs.push({ source: 'DI/CNPJ (adquirente na DI)', cnpj: diCnpj });

  const adicaoNodes = detNodes.length === 0 && siscomexDi ? many(siscomexDi.adicao) : [];

  let totalFrete = 0;
  let totalSeg = 0;
  let totalAfrmm = 0;
  let totalDespAdu = 0;

  const rawItems: RawImportItemDraft[] = [];
  const declaredPerItem: Array<Omit<DeclaredImportItemValues, 'fingerprint'>> = [];

  if (detNodes.length > 0) {
    detNodes.forEach((det, idx) => {
      const prod = one(det.prod) || det;
      const imposto = one(det.imposto) || {};
      const diNode = one(prod.DI) || firstDiNode;
      const adiNode = one(diNode.adi);
      const icmsGroup = one(imposto.ICMS);
      const icmsNode =
        firstChildOf(icmsGroup, ['ICMSSN900', 'ICMSSN101', 'ICMSSN102', 'ICMSSN500', 'ICMS00', 'ICMS90']) ||
        (icmsGroup ? one(Object.values(icmsGroup).find((v) => v && typeof v === 'object')) : undefined) ||
        {};
      const ipiNode = one(one(imposto.IPI)?.IPITrib) || one(imposto.IPI) || {};
      const iiNode = one(imposto.II) || {};
      const pisGroup = one(imposto.PIS);
      const pisNode = firstChildOf(pisGroup, ['PISOutr', 'PISAliq', 'PISQtde', 'PISNT']) || {};
      const cofinsGroup = one(imposto.COFINS);
      const cofinsNode =
        firstChildOf(cofinsGroup, ['COFINSOutr', 'COFINSAliq', 'COFINSQtde', 'COFINSNT']) || {};

      const cProd = txt(prod, 'cProd') || `XML-ITEM-${idx + 1}`;
      const cEAN = txt(prod, 'cEAN') || 'SEM GTIN';
      const xProd = txt(prod, 'xProd') || `MERCADORIA IMPORTADA #${idx + 1}`;
      const ncm = (txt(prod, 'NCM') || '85176259').replace(/\D/g, '');
      const cfop = normalizeImportCfop(txt(prod, 'CFOP') || '3102');
      const rawUnit = txt(prod, 'uCom') || 'UN';
      const uCom = rawUnit.replace(/\.$/, '') || 'UN';
      if (rawUnit === 'UN.') {
        findings.push({
          severity: 'warning',
          category: 'layout',
          record: `det[${idx + 1}]`,
          message: 'Unidade "UN." normalizada para "UN" ao importar o item XML.',
          autoFix: true,
        });
      }
      const qCom = Math.max(0.0001, Number(txt(prod, 'qCom') || 1) || 1);
      const vUnCom = Math.max(0, Number(txt(prod, 'vUnCom') || 100) || 0);
      const vFrete = Number(txt(prod, 'vFrete') || 0) || 0;
      const vSeg = Number(txt(prod, 'vSeg') || 0) || 0;
      const vAFRMM = Number(txt(diNode, 'vAFRMM') || 0) || 0;
      const vBC_II = Number(txt(iiNode, 'vBC') || qCom * vUnCom + vFrete + vSeg) || 0;
      const vDespAdu = Number(txt(iiNode, 'vDespAdu') || 0) || 0;
      const vII = Number(txt(iiNode, 'vII') || 0) || 0;
      const iiRate = vBC_II > 0 ? round2((vII / vBC_II) * 100) : 12;

      totalFrete += vFrete;
      totalSeg += vSeg;
      totalAfrmm += vAFRMM;
      totalDespAdu += vDespAdu;

      const csosnRaw = txt(icmsNode, 'CSOSN') || '900';
      if (!txt(icmsNode, 'CSOSN') && txt(icmsNode, 'CST')) {
        findings.push({
          severity: 'info',
          category: 'fiscal',
          record: `det[${idx + 1}].ICMS`,
          message: `XML continha CST=${txt(icmsNode, 'CST')}; enquadrado com CSOSN 900 para emissão no Simples Nacional (Sebrae 4.01).`,
          autoFix: false,
        });
      }

      declaredPerItem.push({
        vFrete: round2(vFrete),
        vSeg: round2(vSeg),
        vAFRMM: round2(vAFRMM),
        vII: numOrUndef(txt(iiNode, 'vII')),
        vIPI: numOrUndef(txt(ipiNode, 'vIPI')),
        vPIS: numOrUndef(txt(pisNode, 'vPIS')),
        vCOFINS: numOrUndef(txt(cofinsNode, 'vCOFINS')),
        vBC_ICMS: numOrUndef(txt(icmsNode, 'vBC')),
        vICMS: numOrUndef(txt(icmsNode, 'vICMS')),
        vOutro: numOrUndef(txt(prod, 'vOutro')),
      });

      rawItems.push({
        id: `xml-item-${idx + 1}`,
        cProd,
        cEAN,
        xProd,
        ncm,
        cfop,
        uCom,
        qCom,
        fobUnitForeign: vUnCom,
        orig: (txt(icmsNode, 'orig') as '1') || '1',
        csosn: (csosnRaw as '900') || '900',
        cstIpi: (txt(ipiNode, 'CST') as '49') || '49',
        cstPisCofins: (txt(pisNode, 'CST') as '70') || '70',
        iiRatePercent: iiRate,
        ipiRatePercent: Number(txt(ipiNode, 'pIPI') || 5),
        pisRatePercent: Number(txt(pisNode, 'pPIS') || 2.1),
        cofinsRatePercent: Number(txt(cofinsNode, 'pCOFINS') || 9.65),
        icmsRatePercent: Number(txt(icmsNode, 'pICMS') || 18),
        icmsReductionPercent: Number(txt(icmsNode, 'pRedBC') || 0),
        nAdicao: txt(adiNode, 'nAdicao') || String(idx + 1),
        nSeqAdic: txt(adiNode, 'nSeqAdic') || '1',
        cFabricante: txt(adiNode, 'cFabricante') || cExportador,
      });
    });
  } else if (adicaoNodes.length > 0) {
    adicaoNodes.forEach((adi, idx) => {
      const ncm = (txt(adi, 'ncm') || txt(adi, 'codigoMercadoria') || '85176259').replace(/\D/g, '');
      const xProd = txt(adi, 'descricaoMercadoria') || `EQUIPAMENTO IMPORTADO DI ${nDI} ADICAO ${idx + 1}`;
      const qCom = Math.max(1, Number(txt(adi, 'quantidade') || 1) || 1);
      const vUn = Math.max(100, Number(txt(adi, 'valorUnitario') || 1000) || 0);
      declaredPerItem.push({});
      rawItems.push({
        id: `di-xml-item-${idx + 1}`,
        cProd: `DI-ITEM-0${idx + 1}`,
        cEAN: 'SEM GTIN',
        xProd,
        ncm,
        cfop: '3.102',
        uCom: 'UN',
        qCom,
        fobUnitForeign: vUn,
        orig: '1',
        csosn: '900',
        cstIpi: '49',
        cstPisCofins: '70',
        iiRatePercent: Number(txt(adi, 'aliquotaII') || 12),
        ipiRatePercent: Number(txt(adi, 'aliquotaIPI') || 5),
        pisRatePercent: Number(txt(adi, 'aliquotaPIS') || 2.1),
        cofinsRatePercent: Number(txt(adi, 'aliquotaCOFINS') || 9.65),
        icmsRatePercent: 18,
        icmsReductionPercent: 0,
        nAdicao: txt(adi, 'numeroAdicao') || String(idx + 1),
        nSeqAdic: '1',
        cFabricante: txt(adi, 'fabricanteNome') || cExportador,
      });
    });
  } else {
    throw new Error('Nenhum item (<det> ou <adicao>) encontrado no XML enviado.');
  }

  // #5: trava de CNPJ do arquivo contra o emitente configurado
  assertImportCnpjMatches(fileCnpjs, emitter?.emitterCnpj, findings);

  const icmsTot = one(one(infNFe?.total)?.ICMSTot);
  if (!totalFrete && Number(txt(icmsTot, 'vFrete') || 0) > 0) {
    totalFrete = Number(txt(icmsTot, 'vFrete'));
  }
  if (!totalSeg && Number(txt(icmsTot, 'vSeg') || 0) > 0) {
    totalSeg = Number(txt(icmsTot, 'vSeg'));
  }

  const di: ErpImportDeclarationInfo = {
    nDI,
    dDI,
    xLocDesemb,
    UFDesemb,
    dDesemb,
    tpViaTransp,
    vAFRMM: round2(totalAfrmm),
    tpIntermedio,
    cExportador,
    currency: 'USD',
    exchangeRatePtax: 1.0, // Valores no XML NF-e já estão convertidos em BRL
    fobTotalForeign: round2(rawItems.reduce((s, i) => s + i.qCom * i.fobUnitForeign, 0)),
    freteInternacionalBrl: round2(totalFrete),
    seguroInternacionalBrl: round2(totalSeg),
    taxaSiscomexTotalBrl: round2(Math.min(214.5, totalDespAdu)),
    outrasDespesasAduaneirasBrl: round2(Math.max(0, totalDespAdu - Math.min(214.5, totalDespAdu))),
    somarTributosEmVOutroSimples: true,
    exporterIdEstrangeiro: txt(dest, 'idEstrangeiro') || cExportador,
    exporterName: txt(dest, 'xNome') || txt(siscomexDi, 'exportadorNome') || 'EXPORTADOR ESTRANGEIRO',
    exporterAddress: txt(enderDest, 'xLgr') || 'EXTERIOR',
    exporterCountryCodeBacen: txt(enderDest, 'cPais') || '1600',
    exporterCountryName: txt(enderDest, 'xPais') || 'CHINA, REPUBLICA POPULAR',
    additions: rawItems.map((it) => ({
      nAdicao: it.nAdicao,
      nSeqAdic: it.nSeqAdic,
      cFabricante: it.cFabricante,
      vDescDI: 0,
    })),
  };

  normalizeParsedDraftFields(di, rawItems);

  // Preserva os valores declarados no XML (quando houver <det>)
  rawItems.forEach((it, idx) => {
    const declared = declaredPerItem[idx] || {};
    if (Object.keys(declared).length > 0) {
      it.declaredValues = {
        ...declared,
        fingerprint: declaredValuesFingerprint(it, di.exchangeRatePtax),
      };
    }
  });

  const computedMeta = calculateSebraeImportNfe({
    serie,
    nNF,
    natOp,
    crt,
    finNFe,
    indFinal,
    indPres,
    indIntermed,
    di,
    rawItems,
    emitterName: emitter?.emitterName,
    emitterCnpj: emitter?.emitterCnpj,
    emitterIe: emitter?.emitterIe,
    emitterUf: emitter?.emitterUf,
  });

  findings.push({
    severity: 'info',
    category: 'sefaz',
    record: 'W02',
    message: `Cálculo ICMS Por Dentro validado: BC ICMS R$ ${fmt2(computedMeta.totals.vBC_ICMS)} | ICMS R$ ${fmt2(computedMeta.totals.vICMS)} | Total NF-e (vNF) R$ ${fmt2(computedMeta.totals.vNF)}.`,
    autoFix: false,
  });

  const summaryText = `Arquivo XML "${filename}" importado e convertido para todas as abas do Emissor Sebrae 4.01: NF-e #${nNF} | DI ${di.nDI} | Exportador ${di.exporterName} | ${rawItems.length} item(ns) | Total vNF R$ ${fmt2(computedMeta.totals.vNF)}.`;

  return {
    sourceFormat: isSiscomexDiOnly ? 'SISCOMEX_DI_XML' : 'SEFAZ_XML_400',
    filename,
    serie,
    nNF,
    natOp,
    crt,
    finNFe,
    indFinal,
    indPres,
    indIntermed,
    di,
    rawItems,
    computedMeta,
    findings,
    correctedTxt: computedMeta.sebraeTxtContent || '',
    summaryText,
    fileCnpjs,
  };
}
