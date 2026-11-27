// ============================================================================
// XML NF-e 4.00 (modelo 55) para TRANSMISSÃO à SEFAZ-SP — homologação.
// ----------------------------------------------------------------------------
//  Diferenças em relação ao XML de rascunho (product-nfe-engine.generateProductNfeXml):
//   - XML compacto (sem declaração, comentário, indentação nem espaço entre tags), como a
//     SEFAZ exige e como a assinatura C14N espera;
//   - EMITENTE só com dados REAIS da configuração (CNPJ com DV válido, IE, endereço, IBGE,
//     CEP): nada de endereço/IE padrão. Falta de dado => NfeEmitterDataError (lista do que falta);
//   - cMunFG = município (IBGE) do emitente configurado (não fixo em São Paulo);
//   - destinatário/entrega/retirada sem cMun "0000000": falta => erro explícito;
//   - grupo IPI só quando há IPI destacado (empresa não industrial não informa IPINT);
//   - infRespTec (SP exige — rejeição 972);
//   - grupos IBS/CBS (reforma tributária, PL_010g) opcionais: alíquotas de teste de 2026.
//  Validado contra o XSD oficial PL_010g (schemas/nfe/PL_010g) nos testes.
// ============================================================================
import { assertHomologacao, CUF_SP, NFE_PORTAL_NS, NFE_VERSION, VER_PROC } from './sefaz-config';
import {
  HOMOLOGATION_RECIPIENT_NAME,
  isValidCnpjDv,
  parseBrasiliaLocal,
  type ProductNfeDraft,
  type ProductNfeTotals,
} from '../product-nfe-engine';
import { MOC, buildNfeAccessKey, fmt2, fmt4, fmt10, formatSaoPauloDateTime, generateRandomCnf, xmlField } from '../sebrae-nfe-import-engine';

const onlyDigits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const round2 = (v: number) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

/** Dados do emitente exigidos para transmitir (todos vindos da configuração). */
export interface NfeEmitterData {
  cnpj: string;
  ie: string;
  legalName: string;
  tradeName?: string;
  street: string;
  number: string;
  complement?: string;
  district: string;
  cityIbge: string;
  cityName: string;
  uf: string;
  cep: string;
  phone?: string;
  email?: string;
  crt: '1' | '3';
}

export interface NfeRespTec {
  cnpj: string;
  contact: string;
  email: string;
  phone: string;
}

/** IBS/CBS (LC 214/2025, NT 2025.002): 2026 = ano de teste (CBS 0,9% e IBS 0,1%). */
export interface NfeIbsCbsOptions {
  enabled: boolean;
  cst?: string;
  cClassTrib?: string;
  pIBSUF?: number;
  pIBSMun?: number;
  pCBS?: number;
}

export const IBS_CBS_2026_TEST_RATES = Object.freeze({ cst: '000', cClassTrib: '000001', pIBSUF: 0.1, pIBSMun: 0, pCBS: 0.9 });

export class NfeEmitterDataError extends Error {
  readonly code = 'NFE_EMITTER_DATA_INCOMPLETE';
  constructor(readonly missing: string[]) {
    super(
      `Dados do emitente incompletos ou inválidos para transmitir a NF-e: ${missing.join('; ')}. Corrija em Configurações > Empresa (nada foi inventado nem preenchido automaticamente).`
    );
  }
}

export class NfeDraftDataError extends Error {
  readonly code = 'NFE_DRAFT_DATA_INCOMPLETE';
  constructor(readonly problems: string[]) {
    super(`A NF-e não pode ser transmitida: ${problems.join('; ')}.`);
  }
}

/** Valida o emitente. Devolve a lista de problemas (vazia = ok). */
export function validateEmitterForSefaz(e: Partial<NfeEmitterData>): string[] {
  const out: string[] = [];
  const cnpj = onlyDigits(e.cnpj);
  if (cnpj.length !== 14) out.push('CNPJ do emitente ausente ou sem 14 dígitos');
  else if (!isValidCnpjDv(cnpj)) out.push(`CNPJ do emitente ${cnpj} não confere no dígito verificador`);
  const ie = onlyDigits(e.ie);
  if (ie.length < 2 || ie.length > 14) out.push('inscrição estadual do emitente ausente');
  if (!String(e.legalName || '').trim()) out.push('razão social do emitente ausente');
  if (!String(e.street || '').trim()) out.push('logradouro do emitente ausente');
  if (!String(e.number || '').trim()) out.push('número do endereço do emitente ausente');
  if (!String(e.district || '').trim()) out.push('bairro do emitente ausente');
  if (!/^\d{7}$/.test(onlyDigits(e.cityIbge))) out.push('código IBGE do município do emitente ausente');
  else if (!onlyDigits(e.cityIbge).startsWith(CUF_SP)) out.push('município (IBGE) do emitente não é de SP');
  if (!String(e.cityName || '').trim()) out.push('município do emitente ausente');
  if (String(e.uf || '').toUpperCase() !== 'SP') out.push('UF do emitente deve ser SP (webservice SEFAZ-SP)');
  if (onlyDigits(e.cep).length !== 8) out.push('CEP do emitente ausente');
  if (e.crt !== '1' && e.crt !== '3') out.push('CRT/regime tributário do emitente não definido');
  return out;
}

export interface TransmissionKey {
  accessKey: string;
  cNF: string;
  cDV: string;
  dhEmi: string;
}

/** Nova chave para transmissão: dhEmi = agora (America/Sao_Paulo), cNF aleatório, DV módulo 11. */
export function buildTransmissionKey(params: { cnpj: string; serie: string; nNF: number; now?: Date; cNF?: string }): TransmissionKey {
  const { dhEmi, aamm } = formatSaoPauloDateTime(params.now || new Date());
  const cNF = params.cNF || generateRandomCnf(params.nNF);
  const built = buildNfeAccessKey({ cUF: CUF_SP, aamm, cnpj: onlyDigits(params.cnpj), mod: '55', serie: params.serie, nNF: params.nNF, tpEmis: '1', cNF });
  return { accessKey: built.key, cNF, cDV: built.dv, dhEmi };
}

export interface BuildNfeXmlContext {
  environment: unknown;
  serie: string;
  nNF: number;
  key: TransmissionKey;
  emitter: NfeEmitterData;
  respTec?: NfeRespTec | null;
  ibsCbs?: NfeIbsCbsOptions | null;
}

function tag(name: string, value: string): string {
  return `<${name}>${value}</${name}>`;
}
function txt(name: string, value: unknown, max: number): string {
  return tag(name, xmlField(value, max));
}
function optTxt(name: string, value: unknown, max: number): string {
  const v = String(value ?? '').trim();
  return v ? txt(name, v, max) : '';
}

type Place = ProductNfeDraft['recipient']['deliveryAddress'];

/**
 * Monta o XML <NFe> (sem assinatura) pronto para assinar e transmitir. Lança
 * SefazProductionBlockedError (ambiente), NfeEmitterDataError (emitente) ou NfeDraftDataError.
 */
export function buildNfeXmlForTransmission(draft: ProductNfeDraft, totals: ProductNfeTotals, ctx: BuildNfeXmlContext): string {
  const tpAmb = assertHomologacao(ctx.environment, 'Montagem do XML da NF-e.');
  const em = ctx.emitter;
  const emitterProblems = validateEmitterForSefaz(em);
  if (emitterProblems.length) throw new NfeEmitterDataError(emitterProblems);
  if (em.crt !== totals.crt) {
    throw new NfeDraftDataError([`o CRT dos totais (${totals.crt}) difere do regime configurado do emitente (CRT ${em.crt}); recrie o rascunho`]);
  }

  const problems: string[] = [];
  const r = draft.recipient;
  const a = r.address;
  if (!/^\d{7}$/.test(onlyDigits(a.cityIbge))) problems.push('destinatário sem código IBGE do município (cMun)');
  if (!String(a.street || '').trim()) problems.push('destinatário sem logradouro');
  if (!String(a.district || '').trim()) problems.push('destinatário sem bairro');
  if (!String(a.city || '').trim()) problems.push('destinatário sem município');
  if (!/^[A-Z]{2}$/.test(String(a.uf || '').toUpperCase())) problems.push('destinatário sem UF');
  const placeCheck = (label: string, p?: Place) => {
    if (!p) {
      problems.push(`${label} marcado sem endereço`);
      return;
    }
    if (!/^\d{7}$/.test(onlyDigits(p.cityIbge))) problems.push(`${label} sem código IBGE do município`);
    const d = onlyDigits(p.document);
    if (d.length !== 11 && d.length !== 14) problems.push(`${label} sem CPF/CNPJ`);
  };
  if (r.hasPickupAddress) placeCheck('local de retirada', r.pickupAddress);
  if (r.hasDeliveryAddress) placeCheck('local de entrega', r.deliveryAddress);
  if (totals.items.length !== draft.items.length) problems.push('totais não correspondem aos itens');
  const k = ctx.key;
  if (!/^\d{44}$/.test(k.accessKey)) problems.push('chave de acesso inválida');
  else {
    if (k.accessKey.slice(6, 20) !== onlyDigits(em.cnpj)) problems.push('a chave de acesso não é do CNPJ do emitente');
    if (Number(k.accessKey.slice(25, 34)) !== Number(ctx.nNF)) problems.push('a chave de acesso não corresponde ao número da nota');
  }
  if (problems.length) throw new NfeDraftDataError(problems);

  const homolog = tpAmb === '2';
  const serie = String(Number(onlyDigits(ctx.serie) || '1'));
  const g = draft.general;
  const dhSaiEnt = g.saida === 'DATA_INFORMADA' && g.exitDateTime ? formatSaoPauloDateTime(parseBrasiliaLocal(g.exitDateTime)).dhEmi : k.dhEmi;
  const nfRef = g.hasReferencedNfe ? g.referencedKeys.map((rk) => `<NFref>${tag('refNFe', onlyDigits(rk))}</NFref>`).join('') : '';

  const ide =
    '<ide>' +
    tag('cUF', CUF_SP) +
    tag('cNF', k.cNF) +
    txt('natOp', g.natOp, MOC.natOp) +
    tag('mod', '55') +
    tag('serie', serie) +
    tag('nNF', String(ctx.nNF)) +
    tag('dhEmi', k.dhEmi) +
    tag('dhSaiEnt', dhSaiEnt) +
    tag('tpNF', g.tpNF) +
    tag('idDest', g.idDest) +
    tag('cMunFG', onlyDigits(em.cityIbge)) +
    tag('tpImp', '1') +
    tag('tpEmis', '1') +
    tag('cDV', k.cDV) +
    tag('tpAmb', tpAmb) +
    tag('finNFe', g.finNFe) +
    tag('indFinal', g.indFinal) +
    tag('indPres', g.indPres) +
    tag('procEmi', '0') +
    tag('verProc', VER_PROC) +
    nfRef +
    '</ide>';

  const emit =
    '<emit>' +
    tag('CNPJ', onlyDigits(em.cnpj)) +
    txt('xNome', em.legalName, MOC.xNome) +
    optTxt('xFant', em.tradeName, MOC.xFant) +
    '<enderEmit>' +
    txt('xLgr', em.street, MOC.xLgr) +
    txt('nro', em.number, MOC.nro) +
    optTxt('xCpl', em.complement, 60) +
    txt('xBairro', em.district, MOC.xBairro) +
    tag('cMun', onlyDigits(em.cityIbge)) +
    txt('xMun', em.cityName, MOC.xMun) +
    tag('UF', 'SP') +
    tag('CEP', onlyDigits(em.cep)) +
    tag('cPais', '1058') +
    tag('xPais', 'BRASIL') +
    (onlyDigits(em.phone).length >= 6 ? tag('fone', onlyDigits(em.phone).slice(0, 14)) : '') +
    '</enderEmit>' +
    tag('IE', onlyDigits(em.ie)) +
    tag('CRT', em.crt) +
    '</emit>';

  const docDigits = onlyDigits(r.document);
  const dest =
    '<dest>' +
    (r.documentType === 'CPF' ? tag('CPF', docDigits) : tag('CNPJ', docDigits)) +
    txt('xNome', homolog ? HOMOLOGATION_RECIPIENT_NAME : r.name, MOC.xNome) +
    '<enderDest>' +
    txt('xLgr', a.street, MOC.xLgr) +
    txt('nro', a.number || 'S/N', MOC.nro) +
    optTxt('xCpl', a.complement, 60) +
    txt('xBairro', a.district, MOC.xBairro) +
    tag('cMun', onlyDigits(a.cityIbge)) +
    txt('xMun', a.city, MOC.xMun) +
    tag('UF', String(a.uf).toUpperCase()) +
    (onlyDigits(a.cep).length === 8 ? tag('CEP', onlyDigits(a.cep)) : '') +
    tag('cPais', '1058') +
    tag('xPais', 'BRASIL') +
    (onlyDigits(r.phone).length >= 6 ? tag('fone', onlyDigits(r.phone).slice(0, 14)) : '') +
    '</enderDest>' +
    tag('indIEDest', r.taxpayerType) +
    (r.taxpayerType === '1' ? tag('IE', onlyDigits(r.ie)) : '') +
    (onlyDigits(r.suframa) ? tag('ISUF', onlyDigits(r.suframa)) : '') +
    optTxt('IM', r.im, 15) +
    optTxt('email', r.email, MOC.email) +
    '</dest>';

  const place = (name: 'retirada' | 'entrega', p?: Place) => {
    if (!p) return '';
    const d = onlyDigits(p.document);
    return (
      `<${name}>` +
      (d.length === 11 ? tag('CPF', d) : tag('CNPJ', d)) +
      (p.name ? txt('xNome', homolog ? HOMOLOGATION_RECIPIENT_NAME : p.name, MOC.xNome) : '') +
      txt('xLgr', p.street, MOC.xLgr) +
      txt('nro', p.number || 'S/N', MOC.nro) +
      optTxt('xCpl', p.complement, 60) +
      txt('xBairro', p.district, MOC.xBairro) +
      tag('cMun', onlyDigits(p.cityIbge)) +
      txt('xMun', p.city, MOC.xMun) +
      tag('UF', String(p.uf).toUpperCase()) +
      `</${name}>`
    );
  };

  const ibs = ctx.ibsCbs?.enabled
    ? {
        cst: ctx.ibsCbs.cst || IBS_CBS_2026_TEST_RATES.cst,
        cClassTrib: ctx.ibsCbs.cClassTrib || IBS_CBS_2026_TEST_RATES.cClassTrib,
        pIBSUF: ctx.ibsCbs.pIBSUF ?? IBS_CBS_2026_TEST_RATES.pIBSUF,
        pIBSMun: ctx.ibsCbs.pIBSMun ?? IBS_CBS_2026_TEST_RATES.pIBSMun,
        pCBS: ctx.ibsCbs.pCBS ?? IBS_CBS_2026_TEST_RATES.pCBS,
      }
    : null;
  const ibsTot = { vBC: 0, vIBSUF: 0, vIBSMun: 0, vCBS: 0 };

  const det = draft.items
    .map((it, i) => {
      const t = totals.items[i];
      const ean = it.ean || 'SEM GTIN';
      const base = round2(t.vProd + t.vFrete + t.vSeg + t.vOutro - t.vDesc);
      let icms: string;
      if (totals.crt === '1') {
        icms =
          it.icmsCode === '900'
            ? '<ICMSSN900>' + tag('orig', it.origin) + tag('CSOSN', '900') + tag('modBC', '3') + tag('vBC', fmt2(t.vBC)) + tag('pICMS', fmt2(t.pICMS)) + tag('vICMS', fmt2(t.vICMS)) + '</ICMSSN900>'
            : '<ICMSSN102>' + tag('orig', it.origin) + tag('CSOSN', onlyDigits(it.icmsCode).slice(0, 3)) + '</ICMSSN102>';
      } else {
        icms =
          it.icmsCode === '00'
            ? '<ICMS00>' + tag('orig', it.origin) + tag('CST', '00') + tag('modBC', '3') + tag('vBC', fmt2(t.vBC)) + tag('pICMS', fmt2(t.pICMS)) + tag('vICMS', fmt2(t.vICMS)) + '</ICMS00>'
            : '<ICMS40>' + tag('orig', it.origin) + tag('CST', onlyDigits(it.icmsCode).slice(0, 2)) + '</ICMS40>';
      }
      const ipi =
        t.pIPI > 0
          ? '<IPI>' + tag('cEnq', '999') + '<IPITrib>' + tag('CST', '50') + tag('vBC', fmt2(t.vProd)) + tag('pIPI', fmt4(t.pIPI)) + tag('vIPI', fmt2(t.vIPI)) + '</IPITrib></IPI>'
          : '';
      const pisCofins =
        t.cstPisCofins === '01'
          ? '<PIS><PISAliq>' + tag('CST', '01') + tag('vBC', fmt2(base)) + tag('pPIS', fmt4(t.pPIS)) + tag('vPIS', fmt2(t.vPIS)) + '</PISAliq></PIS>' +
            '<COFINS><COFINSAliq>' + tag('CST', '01') + tag('vBC', fmt2(base)) + tag('pCOFINS', fmt4(t.pCOFINS)) + tag('vCOFINS', fmt2(t.vCOFINS)) + '</COFINSAliq></COFINS>'
          : '<PIS><PISOutr>' + tag('CST', '49') + tag('vBC', '0.00') + tag('pPIS', '0.0000') + tag('vPIS', '0.00') + '</PISOutr></PIS>' +
            '<COFINS><COFINSOutr>' + tag('CST', '49') + tag('vBC', '0.00') + tag('pCOFINS', '0.0000') + tag('vCOFINS', '0.00') + '</COFINSOutr></COFINS>';
      let ibsCbs = '';
      if (ibs) {
        // Base em 2026 (transição da LC 214/2025): valor da operação sem ICMS, PIS e COFINS.
        const vBC = Math.max(0, round2(base - t.vICMS - t.vPIS - t.vCOFINS));
        const vIBSUF = round2((vBC * ibs.pIBSUF) / 100);
        const vIBSMun = round2((vBC * ibs.pIBSMun) / 100);
        const vCBS = round2((vBC * ibs.pCBS) / 100);
        ibsTot.vBC = round2(ibsTot.vBC + vBC);
        ibsTot.vIBSUF = round2(ibsTot.vIBSUF + vIBSUF);
        ibsTot.vIBSMun = round2(ibsTot.vIBSMun + vIBSMun);
        ibsTot.vCBS = round2(ibsTot.vCBS + vCBS);
        ibsCbs =
          '<IBSCBS>' +
          tag('CST', ibs.cst) +
          tag('cClassTrib', ibs.cClassTrib) +
          '<gIBSCBS>' +
          tag('vBC', fmt2(vBC)) +
          '<gIBSUF>' + tag('pIBSUF', fmt4(ibs.pIBSUF)) + tag('vIBSUF', fmt2(vIBSUF)) + '</gIBSUF>' +
          '<gIBSMun>' + tag('pIBSMun', fmt4(ibs.pIBSMun)) + tag('vIBSMun', fmt2(vIBSMun)) + '</gIBSMun>' +
          tag('vIBS', fmt2(round2(vIBSUF + vIBSMun))) +
          '<gCBS>' + tag('pCBS', fmt4(ibs.pCBS)) + tag('vCBS', fmt2(vCBS)) + '</gCBS>' +
          '</gIBSCBS>' +
          '</IBSCBS>';
      }
      const shares =
        (t.vFrete > 0 ? tag('vFrete', fmt2(t.vFrete)) : '') +
        (t.vSeg > 0 ? tag('vSeg', fmt2(t.vSeg)) : '') +
        (t.vDesc > 0 ? tag('vDesc', fmt2(t.vDesc)) : '') +
        (t.vOutro > 0 ? tag('vOutro', fmt2(t.vOutro)) : '');
      return (
        `<det nItem="${i + 1}">` +
        '<prod>' +
        txt('cProd', it.code || it.catalogItemId || String(i + 1), MOC.cProd) +
        txt('cEAN', ean, MOC.cEAN) +
        txt('xProd', it.description, MOC.xProd) +
        tag('NCM', onlyDigits(it.ncm)) +
        tag('CFOP', onlyDigits(it.cfop)) +
        txt('uCom', it.unit, MOC.uCom) +
        tag('qCom', fmt4(it.quantity)) +
        tag('vUnCom', fmt10(it.unitValue)) +
        tag('vProd', fmt2(t.vProd)) +
        txt('cEANTrib', ean, MOC.cEAN) +
        txt('uTrib', it.unit, MOC.uCom) +
        tag('qTrib', fmt4(it.quantity)) +
        tag('vUnTrib', fmt10(it.unitValue)) +
        shares +
        tag('indTot', '1') +
        '</prod>' +
        '<imposto>' +
        tag('vTotTrib', fmt2(t.vTotTrib)) +
        `<ICMS>${icms}</ICMS>` +
        ipi +
        pisCofins +
        ibsCbs +
        '</imposto>' +
        '</det>'
      );
    })
    .join('');

  const total =
    '<total><ICMSTot>' +
    tag('vBC', fmt2(totals.vBC)) +
    tag('vICMS', fmt2(totals.vICMS)) +
    tag('vICMSDeson', '0.00') +
    tag('vFCP', '0.00') +
    tag('vBCST', '0.00') +
    tag('vST', '0.00') +
    tag('vFCPST', '0.00') +
    tag('vFCPSTRet', '0.00') +
    tag('vProd', fmt2(totals.vProd)) +
    tag('vFrete', fmt2(totals.vFrete)) +
    tag('vSeg', fmt2(totals.vSeg)) +
    tag('vDesc', fmt2(totals.vDesc)) +
    tag('vII', '0.00') +
    tag('vIPI', fmt2(totals.vIPI)) +
    tag('vIPIDevol', '0.00') +
    tag('vPIS', fmt2(totals.vPIS)) +
    tag('vCOFINS', fmt2(totals.vCOFINS)) +
    tag('vOutro', fmt2(totals.vOutro)) +
    tag('vNF', fmt2(totals.vNF)) +
    tag('vTotTrib', fmt2(totals.vTotTrib)) +
    '</ICMSTot>' +
    (ibs
      ? '<IBSCBSTot>' +
        tag('vBCIBSCBS', fmt2(ibsTot.vBC)) +
        '<gIBS>' +
        '<gIBSUF>' + tag('vDif', '0.00') + tag('vDevTrib', '0.00') + tag('vIBSUF', fmt2(ibsTot.vIBSUF)) + '</gIBSUF>' +
        '<gIBSMun>' + tag('vDif', '0.00') + tag('vDevTrib', '0.00') + tag('vIBSMun', fmt2(ibsTot.vIBSMun)) + '</gIBSMun>' +
        tag('vIBS', fmt2(round2(ibsTot.vIBSUF + ibsTot.vIBSMun))) +
        tag('vCredPres', '0.00') +
        tag('vCredPresCondSus', '0.00') +
        '</gIBS>' +
        '<gCBS>' + tag('vDif', '0.00') + tag('vDevTrib', '0.00') + tag('vCBS', fmt2(ibsTot.vCBS)) + tag('vCredPres', '0.00') + tag('vCredPresCondSus', '0.00') + '</gCBS>' +
        '</IBSCBSTot>'
      : '') +
    '</total>';

  const tr = draft.transport;
  let transp = '<transp>' + tag('modFrete', tr.modFrete);
  if (tr.modFrete !== '9' && tr.carrier && (tr.carrier.document || tr.carrier.name)) {
    const d = onlyDigits(tr.carrier.document);
    transp +=
      '<transporta>' +
      (d.length === 11 ? tag('CPF', d) : d.length === 14 ? tag('CNPJ', d) : '') +
      optTxt('xNome', tr.carrier.name, MOC.xNome) +
      (onlyDigits(tr.carrier.ie) ? tag('IE', onlyDigits(tr.carrier.ie)) : '') +
      optTxt('xEnder', tr.carrier.address, MOC.xLgr) +
      optTxt('xMun', tr.carrier.city, MOC.xMun) +
      (tr.carrier.uf ? tag('UF', String(tr.carrier.uf).toUpperCase()) : '') +
      '</transporta>';
  }
  if (tr.hasIcmsRetention && tr.icmsRetention) {
    const rt = tr.icmsRetention;
    if (!/^\d{4}$/.test(onlyDigits(rt.cfop)) || !/^\d{7}$/.test(onlyDigits(rt.cityIbge))) {
      throw new NfeDraftDataError(['retenção de ICMS do transporte sem CFOP ou sem município (IBGE)']);
    }
    transp +=
      '<retTransp>' +
      tag('vServ', fmt2(rt.serviceValue)) +
      tag('vBCRet', fmt2(rt.baseValue)) +
      tag('pICMSRet', fmt4(rt.ratePercent)) +
      tag('vICMSRet', fmt2((rt.baseValue * rt.ratePercent) / 100)) +
      tag('CFOP', onlyDigits(rt.cfop)) +
      tag('cMunFG', onlyDigits(rt.cityIbge)) +
      '</retTransp>';
  }
  if (tr.hasVehicle && tr.vehicle && tr.vehicle.plate) {
    transp +=
      '<veicTransp>' +
      tag('placa', xmlField(tr.vehicle.plate.toUpperCase(), 7)) +
      (tr.vehicle.uf ? tag('UF', String(tr.vehicle.uf).toUpperCase()) : '') +
      optTxt('RNTC', tr.vehicle.rntc, 20) +
      '</veicTransp>';
  }
  const v = tr.volumes;
  if (v && (v.quantity || v.species || v.netWeightKg || v.grossWeightKg)) {
    transp +=
      '<vol>' +
      (v.quantity ? tag('qVol', String(v.quantity)) : '') +
      optTxt('esp', v.species, 60) +
      optTxt('marca', v.brand, 60) +
      optTxt('nVol', v.numbering, 60) +
      (v.netWeightKg ? tag('pesoL', v.netWeightKg.toFixed(3)) : '') +
      (v.grossWeightKg ? tag('pesoB', v.grossWeightKg.toFixed(3)) : '') +
      '</vol>';
  }
  transp += '</transp>';

  // finNFe 3 (ajuste) e 4 (devolução) exigem tPag=90 (sem pagamento).
  const tPag = g.finNFe === '3' || g.finNFe === '4' ? '90' : tr.hasPayment && tr.payment ? tr.payment.tPag : '90';
  const vPag = tPag === '90' ? 0 : tr.payment?.amount ?? totals.vNF;
  const pag = '<pag><detPag>' + tag('tPag', tPag) + tag('vPag', fmt2(vPag)) + '</detPag></pag>';

  const fisco = draft.additionalInfo.fisco.trim();
  const cpl = draft.additionalInfo.complementary.trim();
  const infAdic = fisco || cpl ? '<infAdic>' + (fisco ? txt('infAdFisco', fisco, 2000) : '') + (cpl ? txt('infCpl', cpl, MOC.infCpl) : '') + '</infAdic>' : '';

  const rt = ctx.respTec;
  const infRespTec = rt
    ? '<infRespTec>' + tag('CNPJ', onlyDigits(rt.cnpj)) + txt('xContato', rt.contact, 60) + txt('email', rt.email, 60) + tag('fone', onlyDigits(rt.phone).slice(0, 14)) + '</infRespTec>'
    : '';

  return (
    `<NFe xmlns="${NFE_PORTAL_NS}">` +
    `<infNFe Id="NFe${k.accessKey}" versao="${NFE_VERSION}">` +
    ide +
    emit +
    dest +
    (r.hasPickupAddress ? place('retirada', r.pickupAddress) : '') +
    (r.hasDeliveryAddress ? place('entrega', r.deliveryAddress) : '') +
    det +
    total +
    transp +
    pag +
    infAdic +
    infRespTec +
    '</infNFe>' +
    '</NFe>'
  );
}

/** Responsável técnico: o próprio emitente (o STI-hub é desenvolvido pela própria Seta). */
export function respTecFromEmitter(em: Pick<NfeEmitterData, 'cnpj' | 'legalName' | 'phone' | 'email'>): NfeRespTec | null {
  const phone = onlyDigits(em.phone);
  const email = String(em.email || '').trim();
  if (onlyDigits(em.cnpj).length !== 14 || phone.length < 6 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return { cnpj: onlyDigits(em.cnpj), contact: em.legalName, email, phone };
}
