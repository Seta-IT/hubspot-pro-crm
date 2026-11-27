// ============================================================================
// Orquestração da NF-e de produtos na SEFAZ-SP — SOMENTE HOMOLOGAÇÃO.
//  transmitProductNfe: rascunho -> XML 4.00 -> assinatura -> enviNFe (indSinc=1) -> protNFe ->
//                      nfeProc. Lote em processamento => 1 consulta ao NFeRetAutorizacao4.
//  consultProductNfe:  NFeConsultaProtocolo4 pela chave (recupera nfeProc após 204/105/queda).
//  sendProductNfeEvent: cancelamento (110111) e CC-e (110110) via NFeRecepcaoEvento4.
//  sefazServiceStatus: NFeStatusServico4.
// Travas: ambiente da nota E das Configurações Fiscais = HOMOLOGAÇÃO; tpAmb=2 conferido no XML
// antes do envio; CNPJ do certificado = CNPJ do emitente (raiz); regime inalterado desde o rascunho.
// A chave privada só existe em memória durante a chamada (nunca vai a disco, log ou resposta).
// ============================================================================
import type { ErpFiscalInvoice, ErpProductNfeSefazEvent, ErpProductNfeSefazState, ErpTaxRegime } from '../../../db/types';
import { computeProductNfeTotals, crtFromRegime, validateProductNfeDraft } from '../product-nfe-engine';
import { assertHomologacao, assertXmlIsHomologacao, SefazProductionBlockedError } from './sefaz-config';
import {
  buildNfeXmlForTransmission,
  buildTransmissionKey,
  NfeDraftDataError,
  NfeEmitterDataError,
  respTecFromEmitter,
  validateEmitterForSefaz,
  type NfeEmitterData,
  type NfeIbsCbsOptions,
} from './nfe-xml-builder';
import { signXml, verifyXmlSignature, type SigningMaterial } from './xml-signer';
import { callSefaz, type SoapTransport } from './sefaz-soap-client';
import {
  buildConsReciNFe,
  buildConsSitNFe,
  buildConsStatServ,
  buildEnviNFe,
  buildEnvEvento,
  buildEventoXml,
  buildNfeProc,
  buildProcEventoNFe,
  parseAuthorizationResponse,
  parseConsultaResponse,
  parseEventResponse,
  parseStatusResponse,
  type AuthorizationResult,
  type EventKind,
  type StatusResult,
} from './sefaz-messages';
import { formatSaoPauloDateTime } from '../sebrae-nfe-import-engine';

const onlyDigits = (v: unknown) => String(v ?? '').replace(/\D/g, '');

export class SefazPreconditionError extends Error {
  constructor(readonly code: string, message: string, readonly httpStatus = 409, readonly details: string[] = []) {
    super(message);
  }
}

/** Material do certificado A1 (de certificate-a1.loadCertificateForSigning). */
export interface SefazCertificate {
  certificatePem: string;
  privateKeyPem: string;
  meta: { cnpj: string; notAfter: string };
}

export interface SefazDeps {
  loadCertificate: () => Promise<SefazCertificate | null>;
  transportFactory: (material: SigningMaterial) => SoapTransport;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Espera antes da consulta de recibo quando o lote volta 103/105 (padrão 2 s). */
  retAutorizacaoDelayMs?: number;
}

export interface EmitterSources {
  gc: { companyLegalName?: string; companyCnpj?: string; stateRegistration?: string; taxRegime?: ErpTaxRegime };
  company: {
    legalName?: string;
    tradeName?: string;
    cnpj?: string;
    stateRegistration?: string;
    taxRegime?: ErpTaxRegime;
    cep?: string;
    addressStreet?: string;
    addressNumber?: string;
    addressComplement?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    ibgeCode?: string;
    phone?: string;
    financialEmail?: string;
  } | null;
}

/**
 * Emitente para a SEFAZ: CNPJ, IE, razão social e regime das Configurações (os mesmos do rascunho
 * e da tela Fiscal); endereço/IBGE/CEP/telefone de Configurações > Empresa. Divergência de CNPJ
 * entre as duas telas bloqueia (não escolhemos um dos dois).
 */
export function resolveSefazEmitter(src: EmitterSources): { emitter: NfeEmitterData; problems: string[] } {
  const c = src.company || {};
  const problems: string[] = [];
  const gcCnpj = onlyDigits(src.gc.companyCnpj);
  const coCnpj = onlyDigits(c.cnpj);
  if (gcCnpj && coCnpj && gcCnpj !== coCnpj) problems.push(`CNPJ divergente entre Configurações Fiscais (${gcCnpj}) e Dados da Empresa (${coCnpj}): salve Configurações > Dados da Empresa e Fiscal`);
  const gcIe = onlyDigits(src.gc.stateRegistration);
  const coIe = onlyDigits(c.stateRegistration);
  if (gcIe && coIe && gcIe !== coIe) problems.push('inscrição estadual divergente entre Configurações Fiscais e Dados da Empresa');
  if (src.gc.taxRegime && c.taxRegime && src.gc.taxRegime !== c.taxRegime) {
    problems.push(`regime tributário divergente entre Configurações Fiscais (${src.gc.taxRegime}) e Dados da Empresa (${c.taxRegime}): salve Configurações > Dados da Empresa e Fiscal`);
  }
  const emitter: NfeEmitterData = {
    cnpj: gcCnpj || coCnpj,
    ie: gcIe || coIe,
    legalName: String(src.gc.companyLegalName || c.legalName || '').trim(),
    tradeName: String(c.tradeName || '').trim() || undefined,
    street: String(c.addressStreet || '').trim(),
    number: String(c.addressNumber || '').trim(),
    complement: String(c.addressComplement || '').trim() || undefined,
    district: String(c.neighborhood || '').trim(),
    cityIbge: onlyDigits(c.ibgeCode),
    cityName: String(c.city || '').trim(),
    uf: String(c.state || '').trim().toUpperCase(),
    cep: onlyDigits(c.cep),
    phone: onlyDigits(c.phone) || undefined,
    email: String(c.financialEmail || '').trim() || undefined,
    crt: src.gc.taxRegime ? crtFromRegime(src.gc.taxRegime) : ('' as '1'),
  };
  return { emitter, problems: [...problems, ...validateEmitterForSefaz(emitter)] };
}

function assertBothHomologacao(invoice: ErpFiscalInvoice, currentEnvironment: unknown): void {
  const pn = invoice.productNfe;
  if (!pn) throw new SefazPreconditionError('PRODUCT_NFE_NOT_FOUND', 'NF-e de produtos não encontrada.', 404);
  assertHomologacao(pn.environment, `A NF-e ${pn.nNF} foi criada em ${pn.environment}.`);
  assertHomologacao(currentEnvironment, 'As Configurações Fiscais da NF-e não estão em HOMOLOGAÇÃO.');
}

async function loadMaterial(deps: SefazDeps, emitterCnpj: string, now: Date): Promise<SigningMaterial> {
  const cert = await deps.loadCertificate();
  if (!cert) {
    throw new SefazPreconditionError('CERT_NOT_CONFIGURED', 'Certificado digital A1 não configurado (Configurações > Certificado digital).', 409);
  }
  if (cert.meta.notAfter && new Date(cert.meta.notAfter).getTime() < now.getTime()) {
    throw new SefazPreconditionError('CERT_EXPIRED', 'Certificado digital A1 vencido.', 409);
  }
  const certCnpj = onlyDigits(cert.meta.cnpj);
  if (certCnpj.slice(0, 8) !== onlyDigits(emitterCnpj).slice(0, 8)) {
    throw new SefazPreconditionError(
      'CERT_CNPJ_MISMATCH',
      `O CNPJ do certificado (${certCnpj || 'não identificado'}) não é da mesma empresa do emitente (${onlyDigits(emitterCnpj)}): a SEFAZ rejeitaria (213).`,
      409
    );
  }
  return { certificatePem: cert.certificatePem, privateKeyPem: cert.privateKeyPem };
}

function newLoteId(now: Date): string {
  return String(now.getTime()).slice(-13) + String(Math.floor(Math.random() * 100)).padStart(2, '0');
}

export interface TransmitInput {
  invoice: ErpFiscalInvoice;
  /** Ambiente ATUAL da NF-e nas Configurações Fiscais. */
  currentEnvironment: unknown;
  /** Regime ATUAL (gestaoClickConfig.taxRegime). */
  emitterSources: EmitterSources;
  actor: string;
  ibsCbs?: NfeIbsCbsOptions | null;
}

export interface TransmitOutcome {
  state: ErpProductNfeSefazState;
  result: AuthorizationResult;
}

/** Transmite (ou retransmite após rejeição) a NF-e de produtos em HOMOLOGAÇÃO. */
export async function transmitProductNfe(input: TransmitInput, deps: SefazDeps): Promise<TransmitOutcome> {
  const now = (deps.now || (() => new Date()))();
  const inv = input.invoice;
  assertBothHomologacao(inv, input.currentEnvironment);
  const pn = inv.productNfe!;
  const prev = pn.sefaz;
  if (prev && (prev.status === 'AUTORIZADA' || prev.status === 'DENEGADA' || prev.status === 'CANCELADA')) {
    throw new SefazPreconditionError('PRODUCT_NFE_ALREADY_FINAL', `A NF-e já está ${prev.status} na SEFAZ (homologação): não é reenviada.`, 409);
  }
  if (prev && prev.status === 'EM_PROCESSAMENTO') {
    throw new SefazPreconditionError('PRODUCT_NFE_IN_PROCESSING', 'Lote em processamento na SEFAZ: use "Consultar" em vez de reenviar (evita duplicidade).', 409);
  }

  const { emitter, problems } = resolveSefazEmitter(input.emitterSources);
  if (problems.length) throw new SefazPreconditionError('NFE_EMITTER_DATA_INCOMPLETE', new NfeEmitterDataError(problems).message, 422, problems);
  const regime = input.emitterSources.gc.taxRegime;
  if (!regime || regime !== pn.taxRegime) {
    throw new SefazPreconditionError(
      'NFE_TAX_REGIME_CHANGED',
      `O regime tributário configurado (${regime || 'não definido'}) difere do usado no rascunho (${pn.taxRegime}). Exclua e recrie o rascunho para recalcular os tributos.`,
      409
    );
  }
  const validated = validateProductNfeDraft(pn.form);
  if (!validated.ok) throw new SefazPreconditionError('PRODUCT_NFE_INVALID_INPUT', validated.error, 422);
  const draft = validated.data;
  const totals = computeProductNfeTotals(draft, regime);

  const material = await loadMaterial(deps, emitter.cnpj, now);
  // Chave nova a cada transmissão (dhEmi = agora; rejeição não consome a chave).
  const key = buildTransmissionKey({ cnpj: emitter.cnpj, serie: pn.serie, nNF: pn.nNF, now });
  let xml: string;
  try {
    xml = buildNfeXmlForTransmission(draft, totals, {
      environment: pn.environment,
      serie: pn.serie,
      nNF: pn.nNF,
      key,
      emitter,
      respTec: respTecFromEmitter(emitter),
      ibsCbs: input.ibsCbs || null,
    });
  } catch (e) {
    if (e instanceof NfeEmitterDataError) throw new SefazPreconditionError(e.code, e.message, 422, e.missing);
    if (e instanceof NfeDraftDataError) throw new SefazPreconditionError(e.code, e.message, 422, e.problems);
    throw e;
  }
  assertXmlIsHomologacao(xml, 'NF-e antes da assinatura.');
  const signed = signXml(xml, 'infNFe', material);
  const check = verifyXmlSignature(signed, 'infNFe', material.certificatePem);
  if (!check.valid) throw new SefazPreconditionError('XML_SIGNATURE_ERROR', `Assinatura gerada não confere (${check.reason}).`, 500);

  const transport = deps.transportFactory(material);
  const envi = buildEnviNFe(pn.environment, newLoteId(now), signed);
  assertXmlIsHomologacao(envi, 'Lote enviNFe.');
  const call = await callSefaz('NFeAutorizacao4', pn.environment, envi, transport);
  let result = parseAuthorizationResponse(call.resultXml, key.accessKey);
  if (result.tpAmb && result.tpAmb !== '2') throw new SefazProductionBlockedError('A SEFAZ respondeu com tpAmb diferente de 2.');

  // Fallback: lote recebido/em processamento => uma consulta ao recibo (NFeRetAutorizacao4).
  if (result.outcome === 'EM_PROCESSAMENTO' && /^\d{15}$/.test(result.nRec)) {
    await (deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))))(deps.retAutorizacaoDelayMs ?? 2000);
    const ret = await callSefaz('NFeRetAutorizacao4', pn.environment, buildConsReciNFe(pn.environment, result.nRec), transport);
    const r2 = parseAuthorizationResponse(ret.resultXml, key.accessKey);
    result = { ...r2, nRec: r2.nRec || result.nRec };
  }

  const proc = buildNfeProc(signed, result.protocol);
  const status: ErpProductNfeSefazState['status'] =
    result.outcome === 'AUTORIZADA' ? 'AUTORIZADA' : result.outcome === 'DENEGADA' ? 'DENEGADA' : result.outcome === 'EM_PROCESSAMENTO' ? 'EM_PROCESSAMENTO' : result.outcome === 'REJEITADA' ? 'REJEITADA' : 'ERRO';
  const state: ErpProductNfeSefazState = {
    environment: 'HOMOLOGACAO',
    status,
    accessKey: key.accessKey,
    cNF: key.cNF,
    cDV: key.cDV,
    dhEmi: key.dhEmi,
    cStat: result.cStat,
    xMotivo: result.xMotivo,
    message: proc.ok || status !== 'AUTORIZADA' ? result.message : `${result.message} — ${proc.reason}`,
    nRec: result.nRec,
    nProt: result.protocol?.nProt || '',
    dhRecbto: result.protocol?.dhRecbto || '',
    signedXml: signed,
    nfeProcXml: proc.ok ? proc.xml : '',
    attempts: (prev?.attempts || 0) + 1,
    lastAttemptAt: now.toISOString(),
    lastAttemptBy: input.actor,
    events: prev?.events || [],
  };
  return { state, result };
}

/** Consulta pela chave (recupera protocolo/nfeProc após 105, 204, queda de conexão). */
export async function consultProductNfe(
  input: { invoice: ErpFiscalInvoice; currentEnvironment: unknown; emitterSources: EmitterSources; actor: string },
  deps: SefazDeps
): Promise<{ state: ErpProductNfeSefazState; message: string }> {
  const now = (deps.now || (() => new Date()))();
  assertBothHomologacao(input.invoice, input.currentEnvironment);
  const pn = input.invoice.productNfe!;
  const prev = pn.sefaz;
  if (!prev || !prev.accessKey) throw new SefazPreconditionError('PRODUCT_NFE_NOT_TRANSMITTED', 'A NF-e ainda não foi transmitida.', 409);
  const { emitter, problems } = resolveSefazEmitter(input.emitterSources);
  if (problems.length) throw new SefazPreconditionError('NFE_EMITTER_DATA_INCOMPLETE', new NfeEmitterDataError(problems).message, 422, problems);
  const material = await loadMaterial(deps, emitter.cnpj, now);
  const transport = deps.transportFactory(material);
  const call = await callSefaz('NFeConsultaProtocolo4', pn.environment, buildConsSitNFe(pn.environment, prev.accessKey), transport);
  const r = parseConsultaResponse(call.resultXml, prev.accessKey);
  const state: ErpProductNfeSefazState = { ...prev, events: [...(prev.events || [])], lastAttemptAt: now.toISOString(), lastAttemptBy: input.actor, message: r.message };
  if (r.cancelled) {
    state.status = 'CANCELADA';
  } else if (r.protocol && (r.protocol.outcome === 'AUTORIZADA' || r.protocol.outcome === 'DENEGADA')) {
    state.status = r.protocol.outcome;
    state.cStat = r.protocol.cStat;
    state.xMotivo = r.protocol.xMotivo;
    state.nProt = r.protocol.nProt;
    state.dhRecbto = r.protocol.dhRecbto;
    const proc = prev.signedXml ? buildNfeProc(prev.signedXml, r.protocol) : { ok: false as const, reason: 'sem XML assinado' };
    if (proc.ok) state.nfeProcXml = proc.xml;
  } else if (r.cStat === '217') {
    // NF-e não consta na base da SEFAZ: a transmissão anterior não chegou a ser autorizada.
    state.status = prev.status === 'EM_PROCESSAMENTO' ? 'ERRO' : prev.status;
    state.cStat = r.cStat;
    state.xMotivo = r.xMotivo;
  } else {
    state.cStat = r.cStat || state.cStat;
    state.xMotivo = r.xMotivo || state.xMotivo;
  }
  return { state, message: r.message };
}

export interface EventInputApi {
  invoice: ErpFiscalInvoice;
  currentEnvironment: unknown;
  emitterSources: EmitterSources;
  actor: string;
  kind: EventKind;
  xJust?: string;
  xCorrecao?: string;
}

/** Cancelamento (110111) ou CC-e (110110) de NF-e AUTORIZADA, em homologação. */
export async function sendProductNfeEvent(input: EventInputApi, deps: SefazDeps): Promise<{ state: ErpProductNfeSefazState; event: ErpProductNfeSefazEvent }> {
  const now = (deps.now || (() => new Date()))();
  assertBothHomologacao(input.invoice, input.currentEnvironment);
  const pn = input.invoice.productNfe!;
  const prev = pn.sefaz;
  if (!prev || prev.status !== 'AUTORIZADA' || !prev.nProt) {
    throw new SefazPreconditionError('PRODUCT_NFE_NOT_AUTHORIZED', 'Evento só para NF-e AUTORIZADA (com protocolo).', 409);
  }
  const { emitter, problems } = resolveSefazEmitter(input.emitterSources);
  if (problems.length) throw new SefazPreconditionError('NFE_EMITTER_DATA_INCOMPLETE', new NfeEmitterDataError(problems).message, 422, problems);
  const tp = input.kind === 'CANCELAMENTO' ? '110111' : '110110';
  const done = (prev.events || []).filter((e) => e.tpEvento === tp && e.registered);
  if (input.kind === 'CANCELAMENTO' && done.length) throw new SefazPreconditionError('PRODUCT_NFE_ALREADY_CANCELLED', 'A NF-e já foi cancelada.', 409);
  const nSeq = input.kind === 'CANCELAMENTO' ? 1 : done.length + 1;
  if (nSeq > 20) throw new SefazPreconditionError('CCE_LIMIT', 'Limite de 20 cartas de correção atingido.', 409);
  const material = await loadMaterial(deps, emitter.cnpj, now);
  const ev = buildEventoXml({
    kind: input.kind,
    env: pn.environment,
    cnpj: emitter.cnpj,
    chNFe: prev.accessKey,
    dhEvento: formatSaoPauloDateTime(now).dhEmi,
    nSeqEvento: nSeq,
    nProt: prev.nProt,
    xJust: input.xJust,
    xCorrecao: input.xCorrecao,
  });
  assertXmlIsHomologacao(ev.xml, 'Evento.');
  const signed = signXml(ev.xml, 'infEvento', material);
  const transport = deps.transportFactory(material);
  const call = await callSefaz('NFeRecepcaoEvento4', pn.environment, buildEnvEvento(pn.environment, newLoteId(now), signed), transport);
  const r = parseEventResponse(call.resultXml, ev.id);
  const registered = r.outcome === 'EVENTO_REGISTRADO';
  const proc = registered ? buildProcEventoNFe(signed, r.rawRetEvento) : { ok: false as const, reason: '' };
  const event: ErpProductNfeSefazEvent = {
    kind: input.kind,
    tpEvento: tp,
    nSeqEvento: nSeq,
    cStat: r.cStat,
    xMotivo: r.xMotivo,
    nProt: r.nProt,
    dhRegEvento: r.dhRegEvento,
    registered,
    procXml: proc.ok ? proc.xml : '',
    at: now.toISOString(),
    by: input.actor,
  };
  const state: ErpProductNfeSefazState = {
    ...prev,
    status: registered && input.kind === 'CANCELAMENTO' ? 'CANCELADA' : prev.status,
    message: r.message,
    events: [...(prev.events || []), event].slice(-30),
    lastAttemptAt: now.toISOString(),
    lastAttemptBy: input.actor,
  };
  return { state, event };
}

/** NFeStatusServico4 (homologação). Exige certificado (a SEFAZ-SP pede TLS mútuo em todos os serviços). */
export async function sefazServiceStatus(input: { currentEnvironment: unknown; emitterSources: EmitterSources }, deps: SefazDeps): Promise<StatusResult> {
  const now = (deps.now || (() => new Date()))();
  assertHomologacao(input.currentEnvironment, 'Status do serviço.');
  const cnpj = onlyDigits(input.emitterSources.gc.companyCnpj || input.emitterSources.company?.cnpj);
  const material = await loadMaterial(deps, cnpj, now);
  const call = await callSefaz('NFeStatusServico4', input.currentEnvironment, buildConsStatServ(input.currentEnvironment), deps.transportFactory(material));
  return parseStatusResponse(call.resultXml);
}
