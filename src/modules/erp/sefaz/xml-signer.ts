// ============================================================================
// Assinatura XMLDSig ENVELOPED da NF-e e dos eventos (padrão do MOC 7.0, item 4.4):
//  - SignedInfo: C14N 20010315 (inclusive), RSA-SHA1, Reference URI="#<Id>",
//    Transforms enveloped-signature + C14N, DigestMethod SHA-1, KeyInfo/X509Data/X509Certificate;
//  - <Signature xmlns="http://www.w3.org/2000/09/xmldsig#"> sem prefixo, logo após o elemento
//    assinado (infNFe / infEvento), dentro de NFe / evento.
// Biblioteca: xml-crypto 6.x (sem I/O). A chave privada é recebida em memória (PEM) e nunca é
// gravada em disco nem registrada em log.
// ============================================================================
import crypto from 'crypto';
import { SignedXml } from 'xml-crypto';

export const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
export const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
export const RSA_SHA1 = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
export const SHA1 = 'http://www.w3.org/2000/09/xmldsig#sha1';

export type SignableTag = 'infNFe' | 'infEvento';

export interface SigningMaterial {
  privateKeyPem: string;
  certificatePem: string;
}

export class XmlSignatureError extends Error {
  readonly code = 'XML_SIGNATURE_ERROR';
}

function assertNoDoctype(xml: string): void {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new XmlSignatureError('XML com DOCTYPE/ENTITY não é aceito.');
}

/** Assina o único elemento <tag Id="..."> do XML. Recusa XML com 0 ou mais de 1 elemento alvo. */
export function signXml(xml: string, tagName: SignableTag, material: SigningMaterial): string {
  assertNoDoctype(xml);
  const occurrences = (xml.match(new RegExp(`<${tagName}[\\s>]`, 'g')) || []).length;
  if (occurrences !== 1) throw new XmlSignatureError(`O XML deve ter exatamente um <${tagName}> (encontrado: ${occurrences}).`);
  if (/<Signature[\s>]/.test(xml)) throw new XmlSignatureError('O XML já está assinado.');
  const idMatch = new RegExp(`<${tagName}[^>]*\\sId="([A-Za-z0-9]+)"`).exec(xml);
  if (!idMatch) throw new XmlSignatureError(`<${tagName}> sem atributo Id.`);
  // Confere que a chave privada corresponde ao certificado antes de assinar.
  const pub = crypto.createPublicKey(material.certificatePem).export({ type: 'spki', format: 'der' });
  const pubFromKey = crypto.createPublicKey(material.privateKeyPem).export({ type: 'spki', format: 'der' });
  if (!Buffer.from(pub).equals(Buffer.from(pubFromKey))) throw new XmlSignatureError('A chave privada não corresponde ao certificado.');

  const sig = new SignedXml({
    privateKey: material.privateKeyPem,
    publicCert: material.certificatePem,
    signatureAlgorithm: RSA_SHA1,
    canonicalizationAlgorithm: C14N,
  });
  const xpath = `//*[local-name(.)='${tagName}']`;
  sig.addReference({ xpath, transforms: [ENVELOPED, C14N], digestAlgorithm: SHA1 });
  sig.computeSignature(xml, { location: { reference: xpath, action: 'after' } });
  return sig.getSignedXml();
}

export interface SignatureCheck {
  valid: boolean;
  reason?: string;
  referenceUri?: string;
  certificatePem?: string;
}

function pemFromBase64(b64: string): string {
  const body = b64.replace(/\s+/g, '');
  return `-----BEGIN CERTIFICATE-----\n${(body.match(/.{1,64}/g) || []).join('\n')}\n-----END CERTIFICATE-----\n`;
}

/**
 * Verifica a assinatura enveloped do elemento <tagName> usando o certificado do KeyInfo (ou o
 * certificado esperado, se informado). Confere também que a Reference aponta para o Id do
 * elemento assinado (proteção contra signature wrapping) e que há uma única Signature.
 */
export function verifyXmlSignature(xml: string, tagName: SignableTag, expectedCertificatePem?: string): SignatureCheck {
  try {
    assertNoDoctype(xml);
    const sigs = xml.match(/<Signature[\s>][\s\S]*?<\/Signature>/g) || [];
    if (sigs.length !== 1) return { valid: false, reason: `esperada 1 assinatura, encontradas ${sigs.length}` };
    const sigXml = sigs[0];
    const certB64 = /<X509Certificate>([^<]+)<\/X509Certificate>/.exec(sigXml)?.[1];
    if (!certB64) return { valid: false, reason: 'KeyInfo sem X509Certificate' };
    const embeddedPem = pemFromBase64(certB64);
    if (expectedCertificatePem) {
      const a = new crypto.X509Certificate(embeddedPem).fingerprint256;
      const b = new crypto.X509Certificate(expectedCertificatePem).fingerprint256;
      if (a !== b) return { valid: false, reason: 'certificado do KeyInfo difere do esperado' };
    }
    const idMatch = new RegExp(`<${tagName}[^>]*\\sId="([A-Za-z0-9]+)"`).exec(xml);
    if (!idMatch) return { valid: false, reason: `<${tagName}> sem Id` };
    const uri = /<Reference URI="([^"]*)"/.exec(sigXml)?.[1] || '';
    if (uri !== `#${idMatch[1]}`) return { valid: false, reason: `Reference URI ${uri} não aponta para ${idMatch[1]}` };
    const v = new SignedXml({ publicCert: embeddedPem });
    v.loadSignature(sigXml);
    const ok = v.checkSignature(xml);
    return ok ? { valid: true, referenceUri: uri, certificatePem: embeddedPem } : { valid: false, reason: 'assinatura ou digest não conferem', referenceUri: uri };
  } catch (e) {
    return { valid: false, reason: e instanceof Error ? e.message.slice(0, 200) : 'erro na verificação' };
  }
}
