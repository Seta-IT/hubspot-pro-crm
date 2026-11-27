// ============================================================================
// Mensagens SEFAZ (NF-e 4.00 / eventos 1.00): montagem dos pedidos, leitura dos retornos e
// montagem do nfeProc (NF-e + protNFe) e do procEventoNFe.
//  - Retorno SEM protNFe (rejeição de lote, 103/105, Fault) NUNCA derruba o processo: vira
//    resultado tipado com cStat/xMotivo (corrige o "fatal error" do sped-nfe toAuthorize).
//  - protNFe é localizado pela chave (chNFe) — não pega o protocolo de outra nota do lote.
//  - Parser sem DOCTYPE/ENTITY; valores lidos como texto (cStat "100", não número).
// ============================================================================
import { XMLParser } from 'fast-xml-parser';
import { assertHomologacao, classifyCStat, CUF_SP, describeCStat, EVENT_VERSION, NFE_PORTAL_NS, NFE_VERSION, type SefazOutcome } from './sefaz-config';

const onlyDigits = (v: unknown) => String(v ?? '').replace(/\D/g, '');

export class SefazMessageError extends Error {
  readonly code = 'SEFAZ_MESSAGE_INVALID';
}

// ----------------------------------------------------------------------------
// Pedidos
// ----------------------------------------------------------------------------
export function buildConsStatServ(env: unknown): string {
  const tpAmb = assertHomologacao(env, 'Status do serviço.');
  return `<consStatServ xmlns="${NFE_PORTAL_NS}" versao="${NFE_VERSION}"><tpAmb>${tpAmb}</tpAmb><cUF>${CUF_SP}</cUF><xServ>STATUS</xServ></consStatServ>`;
}

/** Lote com UMA NF-e assinada, modo SÍNCRONO (indSinc=1). */
export function buildEnviNFe(env: unknown, idLote: string, signedNfeXml: string): string {
  assertHomologacao(env, 'Envio de lote.');
  const lote = onlyDigits(idLote);
  if (!lote || lote.length > 15) throw new SefazMessageError('idLote deve ter de 1 a 15 dígitos.');
  const nfe = signedNfeXml.replace(/^\s*<\?xml[^>]*\?>\s*/, '');
  if ((nfe.match(/<NFe[\s>]/g) || []).length !== 1) throw new SefazMessageError('O lote síncrono deve conter exatamente uma NF-e.');
  if (!/<Signature[\s>]/.test(nfe)) throw new SefazMessageError('NF-e sem assinatura.');
  return `<enviNFe xmlns="${NFE_PORTAL_NS}" versao="${NFE_VERSION}"><idLote>${lote}</idLote><indSinc>1</indSinc>${nfe}</enviNFe>`;
}

export function buildConsReciNFe(env: unknown, nRec: string): string {
  const tpAmb = assertHomologacao(env, 'Consulta de recibo.');
  const rec = onlyDigits(nRec);
  if (rec.length !== 15) throw new SefazMessageError('Número do recibo deve ter 15 dígitos.');
  return `<consReciNFe xmlns="${NFE_PORTAL_NS}" versao="${NFE_VERSION}"><tpAmb>${tpAmb}</tpAmb><nRec>${rec}</nRec></consReciNFe>`;
}

export function buildConsSitNFe(env: unknown, chNFe: string): string {
  const tpAmb = assertHomologacao(env, 'Consulta de protocolo.');
  const ch = onlyDigits(chNFe);
  if (ch.length !== 44) throw new SefazMessageError('Chave de acesso deve ter 44 dígitos.');
  return `<consSitNFe xmlns="${NFE_PORTAL_NS}" versao="${NFE_VERSION}"><tpAmb>${tpAmb}</tpAmb><xServ>CONSULTAR</xServ><chNFe>${ch}</chNFe></consSitNFe>`;
}

export const CCE_COND_USO =
  'A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao de documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que determinam o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da operacao ou da prestacao; II - a correcao de dados cadastrais que implique mudanca do remetente ou do destinatario; III - a data de emissao ou de saida.';

/** Texto livre de evento: sem controle, sem espaços duplos, escapado. */
function eventText(v: string, min: number, max: number, label: string): string {
  const clean = String(v ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (clean.length < min || clean.length > max) throw new SefazMessageError(`${label} deve ter de ${min} a ${max} caracteres.`);
  return clean.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export type EventKind = 'CANCELAMENTO' | 'CCE';

export interface EventInput {
  kind: EventKind;
  env: unknown;
  cnpj: string;
  chNFe: string;
  dhEvento: string;
  nSeqEvento: number;
  /** cancelamento */
  nProt?: string;
  xJust?: string;
  /** CC-e */
  xCorrecao?: string;
}

/** <evento> SEM assinatura (assinar infEvento depois). */
export function buildEventoXml(input: EventInput): { xml: string; id: string; tpEvento: string } {
  const tpAmb = assertHomologacao(input.env, 'Evento da NF-e.');
  const ch = onlyDigits(input.chNFe);
  if (ch.length !== 44) throw new SefazMessageError('Chave de acesso deve ter 44 dígitos.');
  const cnpj = onlyDigits(input.cnpj);
  if (cnpj.length !== 14) throw new SefazMessageError('CNPJ do autor do evento inválido.');
  const seq = Math.floor(Number(input.nSeqEvento));
  if (!(seq >= 1 && seq <= 20)) throw new SefazMessageError('nSeqEvento deve estar entre 1 e 20.');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(input.dhEvento)) throw new SefazMessageError('dhEvento inválido.');
  let tpEvento: string;
  let det: string;
  if (input.kind === 'CANCELAMENTO') {
    tpEvento = '110111';
    const nProt = onlyDigits(input.nProt);
    if (nProt.length !== 15) throw new SefazMessageError('Protocolo de autorização (nProt) deve ter 15 dígitos.');
    det = `<descEvento>Cancelamento</descEvento><nProt>${nProt}</nProt><xJust>${eventText(input.xJust || '', 15, 255, 'Justificativa')}</xJust>`;
  } else {
    tpEvento = '110110';
    det = `<descEvento>Carta de Correcao</descEvento><xCorrecao>${eventText(input.xCorrecao || '', 15, 1000, 'Correção')}</xCorrecao><xCondUso>${CCE_COND_USO}</xCondUso>`;
  }
  const id = `ID${tpEvento}${ch}${String(seq).padStart(2, '0')}`;
  const xml =
    `<evento xmlns="${NFE_PORTAL_NS}" versao="${EVENT_VERSION}">` +
    `<infEvento Id="${id}">` +
    `<cOrgao>${CUF_SP}</cOrgao><tpAmb>${tpAmb}</tpAmb><CNPJ>${cnpj}</CNPJ><chNFe>${ch}</chNFe>` +
    `<dhEvento>${input.dhEvento}</dhEvento><tpEvento>${tpEvento}</tpEvento><nSeqEvento>${seq}</nSeqEvento><verEvento>${EVENT_VERSION}</verEvento>` +
    `<detEvento versao="${EVENT_VERSION}">${det}</detEvento>` +
    '</infEvento></evento>';
  return { xml, id, tpEvento };
}

export function buildEnvEvento(env: unknown, idLote: string, signedEventoXml: string): string {
  assertHomologacao(env, 'Envio de evento.');
  const lote = onlyDigits(idLote);
  if (!lote || lote.length > 15) throw new SefazMessageError('idLote deve ter de 1 a 15 dígitos.');
  if (!/<Signature[\s>]/.test(signedEventoXml)) throw new SefazMessageError('Evento sem assinatura.');
  return `<envEvento xmlns="${NFE_PORTAL_NS}" versao="${EVENT_VERSION}"><idLote>${lote}</idLote>${signedEventoXml.replace(/^\s*<\?xml[^>]*\?>\s*/, '')}</envEvento>`;
}

// ----------------------------------------------------------------------------
// Retornos
// ----------------------------------------------------------------------------
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: false,
  isArray: (name) => name === 'protNFe' || name === 'retEvento' || name === 'procEventoNFe',
});

type Obj = Record<string, unknown>;

function parse(xml: string): Obj {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new SefazMessageError('Retorno com DOCTYPE/ENTITY recusado.');
  try {
    return parser.parse(xml) as Obj;
  } catch (e) {
    throw new SefazMessageError(`Retorno da SEFAZ não é XML válido: ${e instanceof Error ? e.message.slice(0, 120) : ''}`);
  }
}
const s = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'object' ? String((v as Obj)['#text'] ?? '') : String(v));

export interface ProtocolInfo {
  chNFe: string;
  cStat: string;
  xMotivo: string;
  nProt: string;
  dhRecbto: string;
  digVal: string;
  outcome: SefazOutcome;
  /** XML bruto do <protNFe> (para o nfeProc). */
  rawXml: string;
}

/** Localiza o <protNFe> da chave no XML bruto e lê seus campos. null => não há protocolo. */
export function findProtNFe(resultXml: string, chNFe: string): ProtocolInfo | null {
  const blocks = resultXml.match(/<protNFe[\s>][\s\S]*?<\/protNFe>/g) || [];
  for (const raw of blocks) {
    const inf = (parse(raw).protNFe as Obj[] | undefined)?.[0]?.infProt as Obj | undefined;
    if (!inf) continue;
    if (s(inf.chNFe) !== onlyDigits(chNFe)) continue;
    const cStat = s(inf.cStat);
    return {
      chNFe: s(inf.chNFe),
      cStat,
      xMotivo: s(inf.xMotivo),
      nProt: s(inf.nProt),
      dhRecbto: s(inf.dhRecbto),
      digVal: s(inf.digVal),
      outcome: classifyCStat(cStat),
      rawXml: /^<protNFe[^>]*\sxmlns=/.test(raw) ? raw : raw.replace(/^<protNFe/, `<protNFe xmlns="${NFE_PORTAL_NS}"`),
    };
  }
  return null;
}

export interface AuthorizationResult {
  /** Resultado da NOTA (não do lote). */
  outcome: SefazOutcome;
  tpAmb: string;
  batchCStat: string;
  batchXMotivo: string;
  cStat: string;
  xMotivo: string;
  message: string;
  nRec: string;
  protocol: ProtocolInfo | null;
}

/**
 * Lê retEnviNFe (síncrono) ou retConsReciNFe (fallback). Nunca lança por falta de protNFe:
 *  - 104 + protNFe da chave => resultado da nota (100 autorizada, 110/301/302 denegada, outro = rejeição);
 *  - 103 (lote recebido) / 105 (em processamento) => EM_PROCESSAMENTO com nRec para consultar;
 *  - 104 sem protNFe da chave => ERRO explícito (sem crash);
 *  - qualquer outro cStat do lote (ex.: 225, 215, 656) => REJEITADA com o motivo do lote.
 */
export function parseAuthorizationResponse(resultXml: string, chNFe: string): AuthorizationResult {
  const doc = parse(resultXml);
  const root = (doc.retEnviNFe || doc.retConsReciNFe) as Obj | undefined;
  if (!root) {
    return { outcome: 'ERRO', tpAmb: '', batchCStat: '', batchXMotivo: '', cStat: '', xMotivo: '', nRec: '', protocol: null, message: 'Retorno sem retEnviNFe/retConsReciNFe.' };
  }
  const batchCStat = s(root.cStat);
  const batchXMotivo = s(root.xMotivo);
  const nRec = s((root.infRec as Obj | undefined)?.nRec) || s(root.nRec);
  const tpAmb = s(root.tpAmb);
  const base = { tpAmb, batchCStat, batchXMotivo, nRec };
  const protocol = findProtNFe(resultXml, chNFe);
  if (protocol) {
    return { ...base, outcome: protocol.outcome, cStat: protocol.cStat, xMotivo: protocol.xMotivo, protocol, message: describeCStat(protocol.cStat, protocol.xMotivo) };
  }
  const batchOutcome = classifyCStat(batchCStat);
  if (batchOutcome === 'LOTE_RECEBIDO' || batchOutcome === 'EM_PROCESSAMENTO') {
    return { ...base, outcome: 'EM_PROCESSAMENTO', cStat: batchCStat, xMotivo: batchXMotivo, protocol: null, message: describeCStat(batchCStat, batchXMotivo) };
  }
  if (batchOutcome === 'LOTE_PROCESSADO') {
    return {
      ...base,
      outcome: 'ERRO',
      cStat: batchCStat,
      xMotivo: batchXMotivo,
      protocol: null,
      message: `Lote processado (104) sem protocolo para a chave ${onlyDigits(chNFe)}: consultar o protocolo pela chave.`,
    };
  }
  return { ...base, outcome: batchOutcome === 'ERRO' ? 'ERRO' : 'REJEITADA', cStat: batchCStat, xMotivo: batchXMotivo, protocol: null, message: describeCStat(batchCStat || '---', batchXMotivo) };
}

export interface StatusResult {
  cStat: string;
  xMotivo: string;
  tpAmb: string;
  dhRecbto: string;
  tMed: string;
  outcome: SefazOutcome;
}

export function parseStatusResponse(resultXml: string): StatusResult {
  const root = parse(resultXml).retConsStatServ as Obj | undefined;
  if (!root) return { cStat: '', xMotivo: 'Retorno sem retConsStatServ.', tpAmb: '', dhRecbto: '', tMed: '', outcome: 'ERRO' };
  const cStat = s(root.cStat);
  return { cStat, xMotivo: s(root.xMotivo), tpAmb: s(root.tpAmb), dhRecbto: s(root.dhRecbto), tMed: s(root.tMed), outcome: classifyCStat(cStat) };
}

export interface ConsultaResult {
  cStat: string;
  xMotivo: string;
  outcome: SefazOutcome;
  protocol: ProtocolInfo | null;
  /** 101 = cancelada; eventos vinculados (bruto). */
  cancelled: boolean;
  message: string;
}

export function parseConsultaResponse(resultXml: string, chNFe: string): ConsultaResult {
  const root = parse(resultXml).retConsSitNFe as Obj | undefined;
  if (!root) return { cStat: '', xMotivo: '', outcome: 'ERRO', protocol: null, cancelled: false, message: 'Retorno sem retConsSitNFe.' };
  const cStat = s(root.cStat);
  const xMotivo = s(root.xMotivo);
  const protocol = findProtNFe(resultXml, chNFe);
  const cancelled = cStat === '101' || cStat === '151' || /<tpEvento>110111<\/tpEvento>[\s\S]*?<cStat>13[56]<\/cStat>/.test(resultXml);
  const outcome = cStat === '100' || cStat === '150' ? 'AUTORIZADA' : cancelled ? 'EVENTO_REGISTRADO' : classifyCStat(cStat);
  return { cStat, xMotivo, outcome, protocol, cancelled, message: describeCStat(cStat, xMotivo) };
}

export interface EventResult {
  batchCStat: string;
  batchXMotivo: string;
  cStat: string;
  xMotivo: string;
  nProt: string;
  dhRegEvento: string;
  outcome: SefazOutcome;
  rawRetEvento: string;
  message: string;
}

export function parseEventResponse(resultXml: string, eventId: string): EventResult {
  const root = parse(resultXml).retEnvEvento as Obj | undefined;
  if (!root) return { batchCStat: '', batchXMotivo: '', cStat: '', xMotivo: '', nProt: '', dhRegEvento: '', outcome: 'ERRO', rawRetEvento: '', message: 'Retorno sem retEnvEvento.' };
  const batchCStat = s(root.cStat);
  const batchXMotivo = s(root.xMotivo);
  const chave = eventId.slice(8, 52);
  const tp = eventId.slice(2, 8);
  const raws = resultXml.match(/<retEvento[\s>][\s\S]*?<\/retEvento>/g) || [];
  for (const raw of raws) {
    const inf = (parse(raw).retEvento as Obj[] | undefined)?.[0]?.infEvento as Obj | undefined;
    if (!inf || s(inf.chNFe) !== chave || (s(inf.tpEvento) && s(inf.tpEvento) !== tp)) continue;
    const cStat = s(inf.cStat);
    return {
      batchCStat,
      batchXMotivo,
      cStat,
      xMotivo: s(inf.xMotivo),
      nProt: s(inf.nProt),
      dhRegEvento: s(inf.dhRegEvento),
      outcome: classifyCStat(cStat) === 'EVENTO_REGISTRADO' ? 'EVENTO_REGISTRADO' : 'REJEITADA',
      rawRetEvento: /^<retEvento[^>]*\sxmlns=/.test(raw) ? raw : raw.replace(/^<retEvento/, `<retEvento xmlns="${NFE_PORTAL_NS}"`),
      message: describeCStat(cStat, s(inf.xMotivo)),
    };
  }
  return {
    batchCStat,
    batchXMotivo,
    cStat: batchCStat,
    xMotivo: batchXMotivo,
    nProt: '',
    dhRegEvento: '',
    outcome: classifyCStat(batchCStat) === 'ERRO' ? 'ERRO' : 'REJEITADA',
    rawRetEvento: '',
    message: describeCStat(batchCStat || '---', batchXMotivo),
  };
}

// ----------------------------------------------------------------------------
// nfeProc / procEventoNFe
// ----------------------------------------------------------------------------
export type NfeProcResult = { ok: true; xml: string } | { ok: false; reason: string };

/**
 * NF-e autorizada (ou denegada) + protNFe. Sem protocolo, protocolo de outra chave ou cStat
 * que não gera documento => { ok: false } (sem exceção).
 */
export function buildNfeProc(signedNfeXml: string, protocol: ProtocolInfo | null | undefined): NfeProcResult {
  if (!protocol) return { ok: false, reason: 'Sem protNFe: a nota não foi autorizada (nada a anexar).' };
  if (protocol.outcome !== 'AUTORIZADA' && protocol.outcome !== 'DENEGADA') {
    return { ok: false, reason: `Protocolo com cStat ${protocol.cStat} não gera nfeProc (${protocol.xMotivo}).` };
  }
  const nfe = signedNfeXml.replace(/^\s*<\?xml[^>]*\?>\s*/, '');
  const id = /<infNFe[^>]*\sId="NFe(\d{44})"/.exec(nfe)?.[1];
  if (!id || id !== protocol.chNFe) return { ok: false, reason: 'A chave do protocolo não corresponde à NF-e assinada.' };
  if (!/<Signature[\s>]/.test(nfe)) return { ok: false, reason: 'NF-e sem assinatura.' };
  return { ok: true, xml: `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="${NFE_PORTAL_NS}" versao="${NFE_VERSION}">${nfe}${protocol.rawXml}</nfeProc>` };
}

export function buildProcEventoNFe(signedEventoXml: string, rawRetEvento: string): NfeProcResult {
  if (!rawRetEvento) return { ok: false, reason: 'Sem retEvento.' };
  return {
    ok: true,
    xml: `<?xml version="1.0" encoding="UTF-8"?><procEventoNFe xmlns="${NFE_PORTAL_NS}" versao="${EVENT_VERSION}">${signedEventoXml.replace(/^\s*<\?xml[^>]*\?>\s*/, '')}${rawRetEvento}</procEventoNFe>`,
  };
}
