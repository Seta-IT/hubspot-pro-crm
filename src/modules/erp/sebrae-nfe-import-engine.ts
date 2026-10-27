// ============================================================================
// Motor Oficial de NF-e de Importação para Empresas do Simples Nacional
// Baseado no Emissor NF-e 4.01 Sebrae + Layout SEFAZ 4.00 + SetaIT/app-nfe-importacao
// ============================================================================

import {
  ErpImportDeclarationInfo,
  ErpImportNfeItem,
  ErpImportNfeMetadata,
} from '../../db/types';

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

function fmt2(val: number): string {
  return round2(Number(val || 0)).toFixed(2);
}

function fmt4(val: number): string {
  return (Math.round((Number(val || 0) + Number.EPSILON) * 10000) / 10000).toFixed(4);
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
}): ErpImportNfeMetadata {
  const ptax = Math.max(0.0001, Number(params.di.exchangeRatePtax || 5.725));
  const rawItems = params.rawItems.length > 0 ? params.rawItems : [];

  // 1. FOB Total in BRL per item
  const itemFobs = rawItems.map((it) => {
    const qty = Math.max(0.0001, Number(it.qCom || 1));
    const unitBrl = round2(Number(it.fobUnitForeign || 0) * ptax);
    const vProdBrl = round2(qty * unitBrl);
    return { qty, unitBrl, vProdBrl };
  });

  const totalVProdBrl = round2(itemFobs.reduce((s, x) => s + x.vProdBrl, 0)) || 1;
  const freteTotalBrl = round2(Number(params.di.freteInternacionalBrl || 0));
  const seguroTotalBrl = round2(Number(params.di.seguroInternacionalBrl || 0));
  const siscomexTotalBrl = round2(Number(params.di.taxaSiscomexTotalBrl || 0));
  const afrmmTotalBrl = round2(Number(params.di.vAFRMM || 0));
  const despAduaneirasTotalBrl = round2(Number(params.di.outrasDespesasAduaneirasBrl || 0));

  const calculatedItems: ErpImportNfeItem[] = rawItems.map((it, idx) => {
    const { qty, unitBrl, vProdBrl } = itemFobs[idx];
    const weight = vProdBrl / totalVProdBrl;

    // Rateio proporcional pelo valor FOB dos produtos
    const vFreteShareBrl = round2(freteTotalBrl * weight);
    const vSegShareBrl = round2(seguroTotalBrl * weight);
    const siscomexShareBrl = round2(siscomexTotalBrl * weight);
    const afrmmShareBrl = round2(afrmmTotalBrl * weight);
    const despAduaneirasShareBrl = round2(despAduaneirasTotalBrl * weight);

    // Valor Aduaneiro (CIF = FOB + Frete Internacional + Seguro Internacional)
    const valorAduaneiroBrl = round2(vProdBrl + vFreteShareBrl + vSegShareBrl);

    // 1. II (Imposto de Importação)
    const iiRatePercent = Number(it.iiRatePercent ?? 12);
    const iiAmountBrl = round2((valorAduaneiroBrl * iiRatePercent) / 100);

    // 2. IPI na Importação: Base = (Valor Aduaneiro + II)
    const ipiRatePercent = Number(it.ipiRatePercent ?? 5);
    const ipiBaseBrl = round2(valorAduaneiroBrl + iiAmountBrl);
    const ipiAmountBrl = round2((ipiBaseBrl * ipiRatePercent) / 100);

    // 3. PIS-Importação (Lei 10.865/2004: Base = Valor Aduaneiro)
    const pisRatePercent = Number(it.pisRatePercent ?? 2.1);
    const pisAmountBrl = round2((valorAduaneiroBrl * pisRatePercent) / 100);

    // 4. COFINS-Importação (Lei 10.865/2004: Base = Valor Aduaneiro)
    const cofinsRatePercent = Number(it.cofinsRatePercent ?? 9.65);
    const cofinsAmountBrl = round2((valorAduaneiroBrl * cofinsRatePercent) / 100);

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

    const icmsBaseCalculoPorDentroBrl = round2(numeratorBeforeIcms / divisor);
    const icmsAmountBrl = round2(icmsBaseCalculoPorDentroBrl * effectiveIcmsFactor);

    // 6. Outras Despesas Acessórias (vOutro) no Simples Nacional (Padrão Sebrae 4.01)
    // Quando somarTributosEmVOutroSimples = true, soma PIS + COFINS + ICMS + SISCOMEX + AFRMM + Desp.Aduaneiras em vOutro
    // para que vNF feche exatamente com o desembolso total da DI sem Rejeição 610 da SEFAZ.
    const customsExpensesOnly = round2(siscomexShareBrl + afrmmShareBrl + despAduaneirasShareBrl);
    const vOutroItemBrl = params.di.somarTributosEmVOutroSimples
      ? round2(customsExpensesOnly + pisAmountBrl + cofinsAmountBrl + icmsAmountBrl)
      : customsExpensesOnly;

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

  meta.sebraeTxtContent = generateSebrae401Txt(meta, {
    emitterName: params.emitterName || 'SETA TELECOM LTDA',
    emitterCnpj: params.emitterCnpj || '18.456.789/0001-90',
    emitterIe: params.emitterIe || '149882410114',
    emitterUf: params.emitterUf || 'SP',
  });

  meta.sefazXmlContent = generateSefaz400Xml(meta, {
    emitterName: params.emitterName || 'SETA TELECOM LTDA',
    emitterCnpj: params.emitterCnpj || '18.456.789/0001-90',
    emitterIe: params.emitterIe || '149882410114',
    emitterUf: params.emitterUf || 'SP',
  });

  return meta;
}

// ============================================================================
// Gerador de TXT Padrão Emissor NF-e Sebrae 4.01 (Compatível com app-nfe-importacao)
// ============================================================================
export function generateSebrae401Txt(
  meta: ErpImportNfeMetadata,
  emitter: {
    emitterName: string;
    emitterCnpj: string;
    emitterIe: string;
    emitterUf: string;
  }
): string {
  const cnpjDigits = emitter.emitterCnpj.replace(/\D/g, '').padEnd(14, '0').slice(0, 14);
  const ieDigits = emitter.emitterIe.replace(/\D/g, '') || '149882410114';
  const nowIso = new Date().toISOString().slice(0, 19) + '-03:00';
  const nfeKey = `352610${cnpjDigits}55001${String(meta.nNF).padStart(9, '0')}1010201008`;

  const lines: string[] = [
    'NOTA FISCAL|1|',
    `A|4.00|NFe${nfeKey}|`,
    // Registro B com >= 21 campos alinhados conforme validador SetaIT/app-nfe-importacao
    `B|35|01020100|${meta.natOp}|55|${meta.serie}|${meta.nNF}|${nowIso}|${nowIso}|0|3|3550308|1|1|8|2|${meta.finNFe}|${meta.indFinal}|${meta.indPres}|${meta.indIntermed}|3|4.01_SEBRAE|||`,
    // Registro C com CRT no último campo (ex: CRT=1 Simples Nacional)
    `C|${emitter.emitterName}|SETA IT TELECOM|${ieDigits}||||${meta.crt}`,
    `C02|${cnpjDigits}|`,
    `C05|AV PAULISTA|1000|CONJ 101|BELA VISTA|3550308|SAO PAULO|${emitter.emitterUf}|01310100|1058|BRASIL|1139584929|`,
    // Registro E: Exportador Estrangeiro (UF=EX, cMun=9999999 EXTERIOR)
    `E|${meta.di.exporterName}|9||||financeiro@setatelecom.com.br|`,
    `E03a|${meta.di.exporterIdEstrangeiro}|`,
    `E05|${meta.di.exporterAddress}|S/N||EXTERIOR|9999999|EXTERIOR|EX||${meta.di.exporterCountryCodeBacen}|${meta.di.exporterCountryName}||`,
  ];

  for (const item of meta.items) {
    const cfopClean = item.cfop.replace(/\D/g, '');
    const diDigits = meta.di.nDI.replace(/[^\dA-Za-z-]/g, '');
    lines.push(
      `H|${item.nItem}|DI ${meta.di.nDI} - Adicao ${item.nAdicao} Seq ${item.nSeqAdic} - ICMS BC Por Dentro R$ ${fmt2(item.icmsBaseCalculoPorDentroBrl)}|`
    );
    // Registro I alinhado com CFOP na posição esperada pelo Emissor Sebrae 4.01 (sem "UN.")
    lines.push(
      `I|${item.cProd}|${item.cEAN}|${item.xProd}|${item.ncm}|||${cfopClean}|${item.uCom}|${fmt4(item.qCom)}|${fmt4(item.vUnComBrl)}|${fmt2(item.vProdBrl)}|${item.cEAN}|${item.uCom}|${fmt4(item.qCom)}|${fmt4(item.vUnComBrl)}|${fmt2(item.vFreteShareBrl)}|${fmt2(item.vSegShareBrl)}|0.00|${fmt2(item.vOutroItemBrl)}|1||||`
    );
    // Registro I18 (Declaração de Importação — >= 12 campos conforme SetaIT/app-nfe-importacao)
    lines.push(
      `I18|${diDigits}|${meta.di.dDI}|${meta.di.xLocDesemb}|${meta.di.UFDesemb}|${meta.di.dDesemb}|${meta.di.tpViaTransp}|${fmt2(item.afrmmShareBrl)}|${meta.di.tpIntermedio}|${cnpjDigits}|${emitter.emitterUf}|${meta.di.cExportador}|`
    );
    // Registro I25 (Adição da DI)
    lines.push(
      `I25|${item.nAdicao}|${item.nSeqAdic}|${item.cFabricante}|0.00||`
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
  lines.push(`Z||${meta.infCpl}|`);

  return lines.join('\n') + '\n';
}

// ============================================================================
// Gerador de XML Oficial SEFAZ 4.00 (<nfeProc versao="4.00">)
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
  const cnpjDigits = emitter.emitterCnpj.replace(/\D/g, '').padEnd(14, '0').slice(0, 14);
  const ieDigits = emitter.emitterIe.replace(/\D/g, '') || '149882410114';
  const nowIso = new Date().toISOString().slice(0, 19) + '-03:00';
  const nfeKey = `352610${cnpjDigits}55001${String(meta.nNF).padStart(9, '0')}1010201008`;

  const detBlocks = meta.items
    .map((item) => {
      const cfopClean = item.cfop.replace(/\D/g, '');
      return `    <det nItem="${item.nItem}">
      <prod>
        <cProd>${item.cProd}</cProd>
        <cEAN>${item.cEAN}</cEAN>
        <xProd>${item.xProd}</xProd>
        <NCM>${item.ncm}</NCM>
        <CFOP>${cfopClean}</CFOP>
        <uCom>${item.uCom}</uCom>
        <qCom>${fmt4(item.qCom)}</qCom>
        <vUnCom>${fmt4(item.vUnComBrl)}</vUnCom>
        <vProd>${fmt2(item.vProdBrl)}</vProd>
        <cEANTrib>${item.cEAN}</cEANTrib>
        <uTrib>${item.uCom}</uTrib>
        <qTrib>${fmt4(item.qCom)}</qTrib>
        <vUnTrib>${fmt4(item.vUnComBrl)}</vUnTrib>
        <vFrete>${fmt2(item.vFreteShareBrl)}</vFrete>
        <vSeg>${fmt2(item.vSegShareBrl)}</vSeg>
        <vOutro>${fmt2(item.vOutroItemBrl)}</vOutro>
        <indTot>1</indTot>
        <DI>
          <nDI>${meta.di.nDI}</nDI>
          <dDI>${meta.di.dDI}</dDI>
          <xLocDesemb>${meta.di.xLocDesemb}</xLocDesemb>
          <UFDesemb>${meta.di.UFDesemb}</UFDesemb>
          <dDesemb>${meta.di.dDesemb}</dDesemb>
          <tpViaTransp>${meta.di.tpViaTransp}</tpViaTransp>
          <vAFRMM>${fmt2(item.afrmmShareBrl)}</vAFRMM>
          <tpIntermedio>${meta.di.tpIntermedio}</tpIntermedio>
          <cExportador>${meta.di.cExportador}</cExportador>
          <adi>
            <nAdicao>${item.nAdicao}</nAdicao>
            <nSeqAdic>${item.nSeqAdic}</nSeqAdic>
            <cFabricante>${item.cFabricante}</cFabricante>
            <vDescDI>0.00</vDescDI>
          </adi>
        </DI>
      </prod>
      <imposto>
        <vTotTrib>${fmt2(item.iiAmountBrl + item.ipiAmountBrl + item.pisAmountBrl + item.cofinsAmountBrl + item.icmsAmountBrl)}</vTotTrib>
        <ICMS>
          <ICMSSN900>
            <orig>${item.orig}</orig>
            <CSOSN>${item.csosn}</CSOSN>
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
            <CST>${item.cstIpi}</CST>
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
            <CST>${item.cstPisCofins}</CST>
            <vBC>${fmt2(item.valorAduaneiroBrl)}</vBC>
            <pPIS>${fmt2(item.pisRatePercent)}</pPIS>
            <vPIS>${fmt2(item.pisAmountBrl)}</vPIS>
          </PISOutr>
        </PIS>
        <COFINS>
          <COFINSOutr>
            <CST>${item.cstPisCofins}</CST>
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
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe${nfeKey}" versao="4.00">
      <ide>
        <cUF>35</cUF>
        <cNF>01020100</cNF>
        <natOp>${meta.natOp}</natOp>
        <mod>55</mod>
        <serie>${meta.serie}</serie>
        <nNF>${meta.nNF}</nNF>
        <dhEmi>${nowIso}</dhEmi>
        <dhSaiEnt>${nowIso}</dhSaiEnt>
        <tpNF>0</tpNF>
        <idDest>3</idDest>
        <cMunFG>3550308</cMunFG>
        <tpImp>1</tpImp>
        <tpEmis>1</tpEmis>
        <cDV>8</cDV>
        <tpAmb>2</tpAmb>
        <finNFe>${meta.finNFe}</finNFe>
        <indFinal>${meta.indFinal}</indFinal>
        <indPres>${meta.indPres}</indPres>
        <indIntermed>${meta.indIntermed}</indIntermed>
        <procEmi>3</procEmi>
        <verProc>4.01_SEBRAE</verProc>
      </ide>
      <emit>
        <CNPJ>${cnpjDigits}</CNPJ>
        <xNome>${emitter.emitterName}</xNome>
        <xFant>SETA IT TELECOM</xFant>
        <enderEmit>
          <xLgr>AV PAULISTA</xLgr>
          <nro>1000</nro>
          <xBairro>BELA VISTA</xBairro>
          <cMun>3550308</cMun>
          <xMun>SAO PAULO</xMun>
          <UF>${emitter.emitterUf}</UF>
          <CEP>01310100</CEP>
          <cPais>1058</cPais>
          <xPais>BRASIL</xPais>
        </enderEmit>
        <IE>${ieDigits}</IE>
        <CRT>${meta.crt}</CRT>
      </emit>
      <dest>
        <idEstrangeiro>${meta.di.exporterIdEstrangeiro}</idEstrangeiro>
        <xNome>${meta.di.exporterName}</xNome>
        <enderDest>
          <xLgr>${meta.di.exporterAddress}</xLgr>
          <nro>S/N</nro>
          <xBairro>EXTERIOR</xBairro>
          <cMun>9999999</cMun>
          <xMun>EXTERIOR</xMun>
          <UF>EX</UF>
          <cPais>${meta.di.exporterCountryCodeBacen}</cPais>
          <xPais>${meta.di.exporterCountryName}</xPais>
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
        <infCpl>${meta.infCpl}</infCpl>
      </infAdic>
    </infNFe>
  </NFe>
</nfeProc>`;
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
      if (parts.includes('UN.')) {
        parts = parts.map((p) => (p === 'UN.' ? 'UN' : p));
        fixed = parts.join('|');
        findings.push({
          severity: 'warning',
          category: 'layout',
          record: 'I',
          message:
            'Unidade "UN." normalizada para "UN" no registro I (evita rejeição de unidade comercial no Emissor Sebrae 4.01). O restante do registro é preservado.',
          autoFix: true,
        });
      }

      parts = fixed.split('|');
      const idx3102 = parts.indexOf('3102');
      if (idx3102 === 7) {
        parts.splice(7, 0, '');
        fixed = parts.join('|');
        findings.push({
          severity: 'error',
          category: 'layout',
          record: 'I',
          message:
            'Campo vazio inserido antes do CFOP 3102 (posição 7 -> 8) para realinhar o registro I ao schema Sebrae 4.01 sem alterar o CFOP.',
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
