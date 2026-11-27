// ============================================================================
// Cliente SOAP 1.2 com mTLS para os webservices da SEFAZ-SP (homologação).
//  - https.Agent com key/cert EM MEMÓRIA (PEM do certificado A1), rejectUnauthorized: true,
//    TLS >= 1.2 e cadeia ICP-Brasil (raízes v5/v10/v11 + extra via STI_HUB_SEFAZ_EXTRA_CA_PEM)
//    somada às raízes padrão do Node. Nada é gravado em disco (diferente do sped-common, que
//    grava a chave em arquivo temporário e desliga a verificação do servidor).
//  - Timeout e teto de tamanho da resposta; resposta com DOCTYPE/ENTITY é recusada.
//  - Transporte injetável (testes não abrem rede).
// ============================================================================
import https from 'https';
import tls from 'tls';
import { ICP_BRASIL_ROOTS } from './icp-brasil-roots';
import { sefazEndpoint, type SefazServiceDef, type SefazServiceName } from './sefaz-config';

export const SOAP12_NS = 'http://www.w3.org/2003/05/soap-envelope';
export const SEFAZ_WSDL_BASE = 'http://www.portalfiscal.inf.br/nfe/wsdl';
export const SEFAZ_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const SEFAZ_TIMEOUT_MS = 30_000;

export interface SoapRequest {
  url: string;
  body: string;
  headers: Record<string, string>;
  timeoutMs: number;
}

export interface SoapHttpResponse {
  status: number;
  body: string;
}

export type SoapTransport = (req: SoapRequest) => Promise<SoapHttpResponse>;

export class SefazTransportError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function soapActionFor(def: SefazServiceDef): string {
  return `${SEFAZ_WSDL_BASE}/${def.operation}/${def.method}`;
}

/** Envelope SOAP 1.2 com o XML da mensagem dentro de <nfeDadosMsg>. */
export function buildSoap12Envelope(def: SefazServiceDef, messageXml: string): string {
  const msg = messageXml.replace(/^\s*<\?xml[^>]*\?>\s*/, '');
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="${SOAP12_NS}">` +
    '<soap12:Body>' +
    `<nfeDadosMsg xmlns="${SEFAZ_WSDL_BASE}/${def.operation}">${msg}</nfeDadosMsg>` +
    '</soap12:Body>' +
    '</soap12:Envelope>'
  );
}

export function buildSoapRequest(def: SefazServiceDef, messageXml: string): SoapRequest {
  const body = buildSoap12Envelope(def, messageXml);
  return {
    url: def.url,
    body,
    headers: {
      'Content-Type': `application/soap+xml; charset=utf-8; action="${soapActionFor(def)}"`,
      'Content-Length': String(Buffer.byteLength(body, 'utf8')),
    },
    timeoutMs: SEFAZ_TIMEOUT_MS,
  };
}

/** Raízes confiáveis: padrão do Node + ICP-Brasil + extra opcional (PEM no env). */
export function sefazTrustedCas(extraPem = process.env.STI_HUB_SEFAZ_EXTRA_CA_PEM || ''): string[] {
  const extra = String(extraPem || '').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
  return [...tls.rootCertificates, ...ICP_BRASIL_ROOTS.map((r) => r.pem), ...extra];
}

/** Opções do https.Agent (exportadas para teste): mTLS em memória e verificação obrigatória. */
export function buildMtlsAgentOptions(material: { privateKeyPem: string; certificatePem: string }, ca = sefazTrustedCas()): https.AgentOptions {
  return {
    key: material.privateKeyPem,
    cert: material.certificatePem,
    ca,
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
    keepAlive: false,
    maxSockets: 2,
  };
}

/** Transporte real (node:https). Só https://, só host *.fazenda.sp.gov.br. */
export function createHttpsTransport(agentOptions: https.AgentOptions): SoapTransport {
  return (req) =>
    new Promise<SoapHttpResponse>((resolve, reject) => {
      let url: URL;
      try {
        url = new URL(req.url);
      } catch {
        reject(new SefazTransportError('SEFAZ_URL_INVALID', 'URL do webservice inválida.'));
        return;
      }
      if (url.protocol !== 'https:' || !/\.fazenda\.sp\.gov\.br$/i.test(url.hostname)) {
        reject(new SefazTransportError('SEFAZ_URL_NOT_ALLOWED', 'Somente webservices https da SEFAZ-SP são permitidos.'));
        return;
      }
      const agent = new https.Agent(agentOptions);
      const r = https.request(
        { method: 'POST', hostname: url.hostname, port: url.port || 443, path: url.pathname + url.search, headers: req.headers, agent, timeout: req.timeoutMs },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (c: Buffer) => {
            size += c.length;
            if (size > SEFAZ_MAX_RESPONSE_BYTES) {
              res.destroy();
              reject(new SefazTransportError('SEFAZ_RESPONSE_TOO_LARGE', 'Resposta da SEFAZ acima do limite.'));
              return;
            }
            chunks.push(c);
          });
          res.on('end', () => {
            agent.destroy();
            resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') });
          });
          res.on('error', (e) => {
            agent.destroy();
            reject(new SefazTransportError('SEFAZ_NETWORK_ERROR', `Falha na resposta da SEFAZ: ${e.message}`.slice(0, 300)));
          });
        }
      );
      r.on('timeout', () => {
        r.destroy();
        agent.destroy();
        reject(new SefazTransportError('SEFAZ_TIMEOUT', 'Tempo esgotado aguardando a SEFAZ.'));
      });
      r.on('error', (e: NodeJS.ErrnoException) => {
        agent.destroy();
        const tlsErr = /certificate|self[- ]signed|unable to verify|CERT_/i.test(`${e.code || ''} ${e.message}`);
        reject(
          new SefazTransportError(
            tlsErr ? 'SEFAZ_TLS_ERROR' : 'SEFAZ_NETWORK_ERROR',
            tlsErr
              ? `Falha TLS com a SEFAZ (cadeia ICP-Brasil ou certificado do cliente): ${e.message}`.slice(0, 300)
              : `Falha de rede com a SEFAZ: ${e.message}`.slice(0, 300)
          )
        );
      });
      r.write(req.body);
      r.end();
    });
}

export interface SoapCallResult {
  service: SefazServiceName;
  httpStatus: number;
  /** XML do elemento de retorno (ret*) extraído do envelope, sem o SOAP. */
  resultXml: string;
  rawBody: string;
}

/** Extrai o conteúdo de <nfeResultMsg> (ou detecta SOAP Fault). */
export function extractSoapResult(rawBody: string): { ok: true; xml: string } | { ok: false; fault: string } {
  if (/<!DOCTYPE|<!ENTITY/i.test(rawBody)) return { ok: false, fault: 'Resposta com DOCTYPE/ENTITY recusada.' };
  const fault = /<(?:\w+:)?Fault[\s>]([\s\S]*?)<\/(?:\w+:)?Fault>/.exec(rawBody);
  if (fault) {
    const reason = /<(?:\w+:)?Text[^>]*>([\s\S]*?)<\/(?:\w+:)?Text>/.exec(fault[1])?.[1] || /<faultstring>([\s\S]*?)<\/faultstring>/.exec(fault[1])?.[1] || 'SOAP Fault';
    return { ok: false, fault: reason.trim().slice(0, 300) };
  }
  const m = /<(?:\w+:)?nfeResultMsg[^>]*>([\s\S]*?)<\/(?:\w+:)?nfeResultMsg>/.exec(rawBody);
  if (!m) return { ok: false, fault: 'Resposta sem nfeResultMsg.' };
  return { ok: true, xml: m[1].trim() };
}

/** Chamada SOAP (homologação). O ambiente é checado de novo aqui (trava). */
export async function callSefaz(service: SefazServiceName, env: unknown, messageXml: string, transport: SoapTransport): Promise<SoapCallResult> {
  const def = sefazEndpoint(service, env);
  const req = buildSoapRequest(def, messageXml);
  const res = await transport(req);
  if (res.body.length > SEFAZ_MAX_RESPONSE_BYTES) throw new SefazTransportError('SEFAZ_RESPONSE_TOO_LARGE', 'Resposta da SEFAZ acima do limite.');
  const extracted = extractSoapResult(res.body);
  if (!extracted.ok) {
    throw new SefazTransportError('SEFAZ_SOAP_FAULT', `SEFAZ respondeu HTTP ${res.status}: ${extracted.fault}`);
  }
  return { service, httpStatus: res.status, resultXml: extracted.xml, rawBody: res.body };
}
