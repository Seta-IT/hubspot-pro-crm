// ============================================================================
// SEFAZ-SP NF-e 4.00 — HOMOLOGAÇÃO (26/11/2026): chave/DV, XML (XSD oficial PL_010g),
// assinatura XMLDSig (certificado autoassinado gerado no teste), envelope SOAP 1.2, leitura dos
// retornos (100, rejeição, lote em processamento, sem protNFe), nfeProc, eventos, trava de
// produção e rotas (alçada fiscal + 2FA). Nenhuma chamada real: o transporte é simulado.
// ============================================================================
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import forge from 'node-forge';
import { validateXML } from 'xmllint-wasm';

import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import type { ErpFiscalInvoice } from '../src/db/types';
import { MemoryCertificateStore } from '../src/modules/erp/certificate-a1';
import { computeNfeAccessKeyDv } from '../src/modules/erp/sebrae-nfe-import-engine';
import { computeProductNfeTotals, validateProductNfeDraft, HOMOLOGATION_RECIPIENT_NAME } from '../src/modules/erp/product-nfe-engine';
import {
  assertHomologacao,
  assertXmlIsHomologacao,
  classifyCStat,
  inutilizarNumeracao,
  SEFAZ_PRODUCTION_TRANSMISSION_ENABLED,
  SEFAZ_SP_HOMOLOGACAO,
  SefazProductionBlockedError,
  sefazEndpoint,
} from '../src/modules/erp/sefaz/sefaz-config';
import {
  buildNfeXmlForTransmission,
  buildTransmissionKey,
  NfeEmitterDataError,
  respTecFromEmitter,
  type NfeEmitterData,
} from '../src/modules/erp/sefaz/nfe-xml-builder';
import { signXml, verifyXmlSignature } from '../src/modules/erp/sefaz/xml-signer';
import {
  buildMtlsAgentOptions,
  buildSoapRequest,
  callSefaz,
  extractSoapResult,
  type SoapRequest,
} from '../src/modules/erp/sefaz/sefaz-soap-client';
import {
  buildConsReciNFe,
  buildConsSitNFe,
  buildConsStatServ,
  buildEnvEvento,
  buildEnviNFe,
  buildEventoXml,
  buildNfeProc,
  parseAuthorizationResponse,
  parseEventResponse,
  parseStatusResponse,
  SefazMessageError,
} from '../src/modules/erp/sefaz/sefaz-messages';
import { ICP_BRASIL_ROOTS } from '../src/modules/erp/sefaz/icp-brasil-roots';
import { makeFakePfx } from './helpers/cert-fixtures';

const ROOT = path.resolve(__dirname, '..', '..');
const XSD_DIR = path.join(ROOT, 'schemas', 'nfe', 'PL_010g');

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------
/** CNPJ de TESTE com DV válido (raiz 14.806.925; o /0001-32 configurado hoje falha no DV). */
const TEST_CNPJ = '14806925000139';
const EMITTER: NfeEmitterData = {
  cnpj: TEST_CNPJ,
  ie: '149882410114',
  legalName: 'EMPRESA DE TESTE LTDA',
  tradeName: 'TESTE',
  street: 'RUA DE TESTE',
  number: '100',
  complement: 'SALA 1',
  district: 'CENTRO',
  cityIbge: '3509502',
  cityName: 'CAMPINAS',
  uf: 'SP',
  cep: '13010000',
  phone: '1130000000',
  email: 'fiscal@teste.com.br',
  crt: '3',
};

function draftInput(overrides: Record<string, unknown> = {}) {
  return {
    general: { natOp: 'VENDA DE MERCADORIA', issueDateTime: '2026-11-26T10:00', tpNF: '1', indFinal: '0', saida: 'NA_EMISSAO', finNFe: '1', tpEmis: '1', idDest: '1', indPres: '1', hasReferencedNfe: false },
    recipient: {
      documentType: 'CNPJ',
      document: '11.222.333/0001-81',
      name: 'CLIENTE TESTE LTDA',
      taxpayerType: '1',
      ie: '110042490114',
      address: { cep: '01310-100', street: 'AV PAULISTA', number: '1000', complement: '', district: 'BELA VISTA', city: 'SAO PAULO', uf: 'SP', cityIbge: '3550308' },
      country: 'Brasil',
      phone: '(11) 3333-4444',
      email: 'fiscal@cliente.com.br',
      hasDeliveryAddress: false,
      hasPickupAddress: false,
    },
    items: [
      { code: 'EQ-1', description: 'ROTEADOR WI-FI 6', ncm: '85176259', cfop: '5102', unit: 'UN', quantity: 2, unitValue: 150.5, icmsCode: '00' },
      { code: 'EQ-2', description: 'SWITCH 24 PORTAS EM COMODATO', ncm: '85176259', cfop: '5908', unit: 'UN', quantity: 1, unitValue: 899, icmsCode: '41' },
    ],
    transport: { modFrete: '9' },
    totals: { discountValue: 0, adjustedTotal: null },
    additionalInfo: { complementary: 'Pedido 123 - teste de homologacao.' },
    ...overrides,
  };
}

function parsedDraft(overrides: Record<string, unknown> = {}) {
  const v = validateProductNfeDraft(draftInput(overrides));
  assert.ok(v.ok, v.ok ? '' : v.error);
  return v.data;
}

/** Certificado AUTOASSINADO de teste (RSA 2048), gerado na hora; nada real. */
function selfSignedCert(cn = 'EMPRESA DE TESTE LTDA:14806925000139') {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const fKey = forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs1', format: 'pem' }).toString());
  const fPub = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }).toString());
  const cert = forge.pki.createCertificate();
  cert.publicKey = fPub;
  cert.serialNumber = '01' + crypto.randomBytes(8).toString('hex');
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  const attrs = [{ shortName: 'C', value: 'BR' }, { shortName: 'CN', value: cn }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(fKey, forge.md.sha256.create());
  return { privateKeyPem: forge.pki.privateKeyToPem(fKey), certificatePem: forge.pki.certificateToPem(cert) };
}

let MATERIAL: { privateKeyPem: string; certificatePem: string };
let OTHER: { privateKeyPem: string; certificatePem: string };
let XSD_FILES: Array<{ fileName: string; contents: string }>;

async function xsdValidate(xml: string, schema: string): Promise<{ valid: boolean; errors: string[] }> {
  const main = XSD_FILES.find((f) => f.fileName === schema);
  assert.ok(main, `schema ${schema}`);
  const r = await validateXML({
    xml: [{ fileName: 'doc.xml', contents: xml }],
    schema: [main!],
    preload: XSD_FILES.filter((f) => f.fileName !== schema),
  });
  return { valid: r.valid, errors: r.errors.map((e) => e.rawMessage) };
}

function buildSigned(opts: { ibsCbs?: boolean; env?: unknown; overrides?: Record<string, unknown>; emitter?: NfeEmitterData } = {}) {
  const draft = parsedDraft(opts.overrides);
  const emitter = opts.emitter || EMITTER;
  const totals = computeProductNfeTotals(draft, emitter.crt === '1' ? 'SIMPLES_NACIONAL' : 'LUCRO_PRESUMIDO');
  const key = buildTransmissionKey({ cnpj: emitter.cnpj, serie: '1', nNF: 15, now: new Date('2026-11-26T15:00:00Z'), cNF: '40718293' });
  const xml = buildNfeXmlForTransmission(draft, totals, {
    environment: opts.env ?? 'HOMOLOGACAO',
    serie: '1',
    nNF: 15,
    key,
    emitter,
    respTec: respTecFromEmitter(emitter),
    ibsCbs: opts.ibsCbs ? { enabled: true } : null,
  });
  return { xml, signed: signXml(xml, 'infNFe', MATERIAL), key, totals };
}

before(() => {
  MATERIAL = selfSignedCert();
  OTHER = selfSignedCert('OUTRA EMPRESA:11222333000181');
  XSD_FILES = fs.readdirSync(XSD_DIR).filter((f) => f.endsWith('.xsd')).map((f) => ({ fileName: f, contents: fs.readFileSync(path.join(XSD_DIR, f), 'utf8') }));
});

// ----------------------------------------------------------------------------
describe('SEFAZ — chave de acesso e DV', () => {
  it('chave de 44 dígitos com cUF 35, AAMM, CNPJ, modelo 55, série, nNF, tpEmis e cNF; DV módulo 11', () => {
    const k = buildTransmissionKey({ cnpj: TEST_CNPJ, serie: '1', nNF: 15, now: new Date('2026-11-26T15:00:00Z'), cNF: '40718293' });
    assert.match(k.accessKey, /^\d{44}$/);
    assert.equal(k.accessKey.slice(0, 2), '35');
    assert.equal(k.accessKey.slice(2, 6), '2611');
    assert.equal(k.accessKey.slice(6, 20), TEST_CNPJ);
    assert.equal(k.accessKey.slice(20, 22), '55');
    assert.equal(k.accessKey.slice(22, 25), '001');
    assert.equal(k.accessKey.slice(25, 34), '000000015');
    assert.equal(k.accessKey.slice(34, 35), '1');
    assert.equal(k.accessKey.slice(35, 43), '40718293');
    // DV independente (pesos 2..9 da direita para a esquerda)
    let sum = 0;
    let w = 2;
    for (let i = 42; i >= 0; i--) {
      sum += Number(k.accessKey[i]) * w;
      w = w === 9 ? 2 : w + 1;
    }
    const r = sum % 11;
    assert.equal(k.accessKey[43], String(r < 2 ? 0 : 11 - r));
    assert.equal(k.cDV, computeNfeAccessKeyDv(k.accessKey.slice(0, 43)));
    assert.equal(k.dhEmi, '2026-11-26T12:00:00-03:00');
  });
});

describe('SEFAZ — XML NF-e 4.00 (XSD oficial PL_010g)', () => {
  it('XML compacto, tpAmb=2, emitente da configuração, cMunFG do emitente, xNome de homologação, CFOP 5.102 e 5.908, infRespTec', () => {
    const { xml } = buildSigned();
    assert.ok(!/>\s+</.test(xml), 'sem espaço entre tags');
    assert.ok(!xml.startsWith('<?xml'), 'sem declaração dentro do lote');
    assert.ok(!xml.includes('<!--'));
    assert.ok(xml.includes('<tpAmb>2</tpAmb>'));
    assert.ok(xml.includes('<cMunFG>3509502</cMunFG>'));
    assert.ok(xml.includes(`<CNPJ>${TEST_CNPJ}</CNPJ><xNome>EMPRESA DE TESTE LTDA</xNome>`));
    assert.ok(!xml.includes('AV PAULISTA</xLgr><nro>1000</nro><xBairro>BELA VISTA</xBairro><cMun>3550308</cMun><xMun>SAO PAULO</xMun><UF>SP</UF><CEP>01310100</CEP><cPais>1058</cPais><xPais>BRASIL</xPais></enderEmit>'), 'sem endereço padrão inventado no emitente');
    assert.ok(xml.includes(`<xNome>${HOMOLOGATION_RECIPIENT_NAME}</xNome>`));
    assert.ok(xml.includes('<CFOP>5102</CFOP>') && xml.includes('<CFOP>5908</CFOP>'));
    assert.ok(xml.includes('<infRespTec><CNPJ>14806925000139</CNPJ>'));
    assert.ok(!xml.includes('<IPI>'), 'sem IPI quando não há IPI destacado');
  });

  it('NF-e assinada valida no nfe_v4.00.xsd (venda 5.102 + remessa locação 5.908)', async () => {
    const { signed } = buildSigned();
    const v = await xsdValidate(signed, 'nfe_v4.00.xsd');
    assert.ok(v.valid, v.errors.join('\n'));
  });

  it('interestadual 6.102/6.908 com IBS/CBS (reforma, PL_010g) valida no XSD', async () => {
    const { signed } = buildSigned({
      ibsCbs: true,
      overrides: {
        general: { natOp: 'VENDA E REMESSA EM LOCACAO', issueDateTime: '2026-11-26T10:00', tpNF: '1', indFinal: '0', saida: 'NA_EMISSAO', finNFe: '1', tpEmis: '1', idDest: '2', indPres: '1', hasReferencedNfe: false },
        recipient: { ...draftInput().recipient, address: { cep: '20000-000', street: 'RUA X', number: '1', complement: '', district: 'CENTRO', city: 'RIO DE JANEIRO', uf: 'RJ', cityIbge: '3304557' }, taxpayerType: '9', ie: '' },
        items: [
          { code: 'EQ-1', description: 'ROTEADOR', ncm: '85176259', cfop: '6102', unit: 'UN', quantity: 1, unitValue: 100, icmsCode: '00', ipiRatePercent: 5 },
          { code: 'EQ-2', description: 'SWITCH EM LOCACAO', ncm: '85176259', cfop: '6908', unit: 'UN', quantity: 1, unitValue: 200, icmsCode: '41' },
        ],
      },
    });
    assert.ok(signed.includes('<IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib>'));
    assert.ok(signed.includes('<IBSCBSTot>'));
    assert.ok(signed.includes('<IPI><cEnq>999</cEnq><IPITrib>'));
    const v = await xsdValidate(signed, 'nfe_v4.00.xsd');
    assert.ok(v.valid, v.errors.join('\n'));
  });

  it('Simples Nacional (CRT 1, CSOSN 102 / 400) valida no XSD', async () => {
    const { signed } = buildSigned({
      emitter: { ...EMITTER, crt: '1' },
      overrides: {
        items: [
          { code: 'EQ-1', description: 'ROTEADOR', ncm: '85176259', cfop: '5102', unit: 'UN', quantity: 1, unitValue: 100, icmsCode: '102' },
          { code: 'EQ-2', description: 'SWITCH EM COMODATO', ncm: '85176259', cfop: '5908', unit: 'UN', quantity: 1, unitValue: 200, icmsCode: '400' },
        ],
      },
    });
    assert.ok(signed.includes('<CRT>1</CRT>') && signed.includes('<CSOSN>400</CSOSN>'));
    const v = await xsdValidate(signed, 'nfe_v4.00.xsd');
    assert.ok(v.valid, v.errors.join('\n'));
  });

  it('emitente incompleto ou com CNPJ que falha no DV => NfeEmitterDataError (nada é inventado)', () => {
    const draft = parsedDraft();
    const totals = computeProductNfeTotals(draft, 'LUCRO_PRESUMIDO');
    const key = buildTransmissionKey({ cnpj: '14806925000132', serie: '1', nNF: 15 });
    assert.throws(
      () => buildNfeXmlForTransmission(draft, totals, { environment: 'HOMOLOGACAO', serie: '1', nNF: 15, key, emitter: { ...EMITTER, cnpj: '14806925000132', cep: '' } }),
      (e: unknown) => e instanceof NfeEmitterDataError && e.missing.some((m) => /dígito verificador/.test(m)) && e.missing.some((m) => /CEP/.test(m))
    );
  });

  it('lote enviNFe (indSinc=1), consStatServ, consSitNFe, consReciNFe e eventos validam nos XSD', async () => {
    const { signed, key } = buildSigned();
    const envi = buildEnviNFe('HOMOLOGACAO', '123456789012345', signed);
    assert.ok(envi.includes('<indSinc>1</indSinc>'));
    for (const [doc, xsd] of [
      [envi, 'enviNFe_v4.00.xsd'],
      [buildConsStatServ('HOMOLOGACAO'), 'consStatServ_v4.00.xsd'],
      [buildConsSitNFe('HOMOLOGACAO', key.accessKey), 'consSitNFe_v4.00.xsd'],
      [buildConsReciNFe('HOMOLOGACAO', '351000000000001'), 'consReciNFe_v4.00.xsd'],
    ] as const) {
      const v = await xsdValidate(doc, xsd);
      assert.ok(v.valid, `${xsd}: ${v.errors.join('\n')}`);
    }
    const canc = buildEventoXml({ kind: 'CANCELAMENTO', env: 'HOMOLOGACAO', cnpj: TEST_CNPJ, chNFe: key.accessKey, dhEvento: '2026-11-26T12:05:00-03:00', nSeqEvento: 1, nProt: '135260000000001', xJust: 'Teste de cancelamento em homologacao' });
    const vc = await xsdValidate(buildEnvEvento('HOMOLOGACAO', '1', signXml(canc.xml, 'infEvento', MATERIAL)), 'envEventoCancNFe_v1.00.xsd');
    assert.ok(vc.valid, vc.errors.join('\n'));
    const cce = buildEventoXml({ kind: 'CCE', env: 'HOMOLOGACAO', cnpj: TEST_CNPJ, chNFe: key.accessKey, dhEvento: '2026-11-26T12:05:00-03:00', nSeqEvento: 1, xCorrecao: 'Correcao do complemento do endereco' });
    const ve = await xsdValidate(buildEnvEvento('HOMOLOGACAO', '1', signXml(cce.xml, 'infEvento', MATERIAL)), 'envCCe_v1.00.xsd');
    assert.ok(ve.valid, ve.errors.join('\n'));
    assert.throws(() => buildEventoXml({ kind: 'CANCELAMENTO', env: 'HOMOLOGACAO', cnpj: TEST_CNPJ, chNFe: key.accessKey, dhEvento: '2026-11-26T12:05:00-03:00', nSeqEvento: 1, nProt: '135260000000001', xJust: 'curta' }), SefazMessageError);
  });
});

describe('SEFAZ — assinatura XMLDSig (RSA-SHA1, C14N, enveloped)', () => {
  it('assinatura verificável: xml-crypto e verificação independente (C14N manual + node:crypto)', () => {
    const { signed, key } = buildSigned();
    assert.ok(signed.includes('<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">'));
    assert.ok(signed.includes('<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"'));
    assert.ok(signed.includes('<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"'));
    assert.ok(signed.includes(`<Reference URI="#NFe${key.accessKey}">`));
    assert.ok(signed.includes('</infNFe><Signature'), 'Signature logo após infNFe');
    const check = verifyXmlSignature(signed, 'infNFe', MATERIAL.certificatePem);
    assert.equal(check.valid, true, check.reason);

    // Independente: digest SHA-1 do infNFe canônico (namespace herdado + atributos em ordem).
    const inf = /<infNFe [\s\S]*<\/infNFe>/.exec(signed)![0];
    const canonInf = inf.replace(/^<infNFe /, '<infNFe xmlns="http://www.portalfiscal.inf.br/nfe" ');
    const digest = crypto.createHash('sha1').update(canonInf, 'utf8').digest('base64');
    assert.equal(/<DigestValue>([^<]+)<\/DigestValue>/.exec(signed)![1], digest);
    // Independente: RSA-SHA1 sobre o SignedInfo canônico.
    const si = /<SignedInfo>[\s\S]*<\/SignedInfo>/.exec(signed)![0]
      .replace(/^<SignedInfo>/, '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">')
      .replace(/<(\w+)([^<>]*?)\/>/g, '<$1$2></$1>');
    const sigValue = /<SignatureValue>([^<]+)<\/SignatureValue>/.exec(signed)![1];
    assert.equal(crypto.verify('sha1', Buffer.from(si, 'utf8'), MATERIAL.certificatePem, Buffer.from(sigValue, 'base64')), true);
  });

  it('XML alterado depois de assinado, outro certificado, assinatura dupla e chave de outro certificado => recusados', () => {
    const { signed, xml } = buildSigned();
    const tampered = signed.replace(/<vNF>[^<]+<\/vNF>/, '<vNF>1.00</vNF>');
    assert.equal(verifyXmlSignature(tampered, 'infNFe').valid, false);
    assert.equal(verifyXmlSignature(signed, 'infNFe', OTHER.certificatePem).valid, false);
    assert.throws(() => signXml(signed, 'infNFe', MATERIAL), /já está assinado/);
    assert.throws(() => signXml(xml, 'infNFe', { privateKeyPem: OTHER.privateKeyPem, certificatePem: MATERIAL.certificatePem }), /não corresponde/);
    assert.throws(() => signXml(`<!DOCTYPE x [<!ENTITY a "b">]>${xml}`, 'infNFe', MATERIAL), /DOCTYPE/);
  });
});

describe('SEFAZ — SOAP 1.2 e mTLS', () => {
  it('envelope SOAP 1.2 com nfeDadosMsg, Content-Type com action e endpoint de homologação SP', () => {
    const req = buildSoapRequest(SEFAZ_SP_HOMOLOGACAO.NFeAutorizacao4, '<?xml version="1.0"?><enviNFe/>');
    assert.equal(req.url, 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx');
    assert.match(req.headers['Content-Type'], /^application\/soap\+xml; charset=utf-8; action="http:\/\/www\.portalfiscal\.inf\.br\/nfe\/wsdl\/NFeAutorizacao4\/nfeAutorizacaoLote"$/);
    assert.ok(req.body.startsWith('<?xml version="1.0" encoding="utf-8"?><soap12:Envelope'));
    assert.ok(req.body.includes('xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"'));
    assert.ok(req.body.includes('<soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4"><enviNFe/></nfeDadosMsg></soap12:Body>'));
    assert.equal(req.headers['Content-Length'], String(Buffer.byteLength(req.body)));
  });

  it('agente mTLS: chave/cert em memória, rejectUnauthorized true, TLS >= 1.2, raízes ICP-Brasil com fingerprint conferido', () => {
    const o = buildMtlsAgentOptions(MATERIAL);
    assert.equal(o.rejectUnauthorized, true);
    assert.equal(o.minVersion, 'TLSv1.2');
    assert.equal(o.key, MATERIAL.privateKeyPem);
    const ca = o.ca as string[];
    for (const r of ICP_BRASIL_ROOTS) {
      assert.equal(new crypto.X509Certificate(r.pem).fingerprint256.replace(/:/g, '').toLowerCase(), r.sha256, r.name);
      assert.ok(ca.includes(r.pem));
    }
    const src = fs.readFileSync(path.join(ROOT, 'src/modules/erp/sefaz/sefaz-soap-client.ts'), 'utf8');
    assert.ok(!/rejectUnauthorized:\s*false/.test(src) && !/writeFile|tmpdir/.test(src), 'sem desligar TLS e sem gravar chave em disco');
  });

  it('SOAP Fault e resposta sem nfeResultMsg viram erro tratado', async () => {
    assert.deepEqual(extractSoapResult('<soap:Envelope><soap:Body><soap:Fault><soap:Reason><soap:Text xml:lang="pt">Erro X</soap:Text></soap:Reason></soap:Fault></soap:Body></soap:Envelope>'), { ok: false, fault: 'Erro X' });
    await assert.rejects(callSefaz('NFeStatusServico4', 'HOMOLOGACAO', buildConsStatServ('HOMOLOGACAO'), async () => ({ status: 500, body: '<html>erro</html>' })), /nfeResultMsg/);
  });
});

// ----------------------------------------------------------------------------
// Retornos simulados
// ----------------------------------------------------------------------------
const NS = 'http://www.portalfiscal.inf.br/nfe';
const wrapSoap = (op: string, inner: string) =>
  `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${op}">${inner}</nfeResultMsg></soap:Body></soap:Envelope>`;
const prot = (ch: string, cStat: string, xMotivo: string, nProt = '135260000000001', digVal = 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=') =>
  `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SP_NFE_PL009_V4</verAplic><chNFe>${ch}</chNFe><dhRecbto>2026-11-26T12:00:05-03:00</dhRecbto>${cStat === '100' ? `<nProt>${nProt}</nProt><digVal>${digVal}</digVal>` : ''}<cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>`;
const retEnvi = (cStat: string, xMotivo: string, inner = '') =>
  `<retEnviNFe versao="4.00" xmlns="${NS}"><tpAmb>2</tpAmb><verAplic>SP_NFE_PL009_V4</verAplic><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><cUF>35</cUF><dhRecbto>2026-11-26T12:00:05-03:00</dhRecbto>${inner}</retEnviNFe>`;

describe('SEFAZ — leitura dos retornos e nfeProc', () => {
  it('104 + protNFe 100 => AUTORIZADA; nfeProc válido no procNFe_v4.00.xsd', async () => {
    const { signed, key } = buildSigned();
    const digVal = /<DigestValue>([^<]+)<\/DigestValue>/.exec(signed)![1];
    const r = parseAuthorizationResponse(retEnvi('104', 'Lote processado', prot(key.accessKey, '100', 'Autorizado o uso da NF-e', '135260000000001', digVal)), key.accessKey);
    assert.equal(r.outcome, 'AUTORIZADA');
    assert.equal(r.protocol!.nProt, '135260000000001');
    const proc = buildNfeProc(signed, r.protocol);
    assert.ok(proc.ok);
    const v = await xsdValidate(proc.ok ? proc.xml : '', 'procNFe_v4.00.xsd');
    assert.ok(v.valid, v.errors.join('\n'));
  });

  it('rejeição da nota (104 + protNFe 539) => REJEITADA, sem nfeProc', () => {
    const { signed, key } = buildSigned();
    const r = parseAuthorizationResponse(retEnvi('104', 'Lote processado', prot(key.accessKey, '539', 'Rejeicao: Duplicidade de NF-e com diferenca na Chave de Acesso')), key.accessKey);
    assert.equal(r.outcome, 'REJEITADA');
    assert.equal(r.cStat, '539');
    assert.match(r.message, /consultar o protocolo/);
    const proc = buildNfeProc(signed, r.protocol);
    assert.equal(proc.ok, false);
  });

  it('lote recebido (103) e em processamento (105) => EM_PROCESSAMENTO com recibo', () => {
    const { key } = buildSigned();
    const a = parseAuthorizationResponse(retEnvi('103', 'Lote recebido com sucesso', '<infRec><nRec>351000000000001</nRec><tMed>1</tMed></infRec>'), key.accessKey);
    assert.equal(a.outcome, 'EM_PROCESSAMENTO');
    assert.equal(a.nRec, '351000000000001');
    const b = parseAuthorizationResponse(`<retConsReciNFe versao="4.00" xmlns="${NS}"><tpAmb>2</tpAmb><verAplic>X</verAplic><nRec>351000000000001</nRec><cStat>105</cStat><xMotivo>Lote em processamento</xMotivo><cUF>35</cUF><dhRecbto>2026-11-26T12:00:05-03:00</dhRecbto></retConsReciNFe>`, key.accessKey);
    assert.equal(b.outcome, 'EM_PROCESSAMENTO');
  });

  it('sem protNFe (rejeição do lote 225, 104 sem a chave, XML inválido) => sem crash, motivo mapeado', () => {
    const { signed, key } = buildSigned();
    const a = parseAuthorizationResponse(retEnvi('225', 'Rejeicao: Falha no Schema XML da NFe'), key.accessKey);
    assert.equal(a.outcome, 'REJEITADA');
    assert.equal(a.protocol, null);
    assert.match(a.message, /^225 — Rejeicao: Falha no Schema XML da NFe/);
    assert.deepEqual(buildNfeProc(signed, a.protocol), { ok: false, reason: 'Sem protNFe: a nota não foi autorizada (nada a anexar).' });
    const other = '3'.repeat(44);
    const b = parseAuthorizationResponse(retEnvi('104', 'Lote processado', prot(other, '100', 'Autorizado o uso da NF-e')), key.accessKey);
    assert.equal(b.outcome, 'ERRO');
    assert.equal(b.protocol, null, 'não usa o protocolo de outra chave');
    assert.equal(parseAuthorizationResponse('<outra/>', key.accessKey).outcome, 'ERRO');
    assert.throws(() => parseAuthorizationResponse('<!DOCTYPE x [<!ENTITY a "b">]><retEnviNFe/>', key.accessKey), SefazMessageError);
    assert.equal(classifyCStat(''), 'ERRO');
    assert.equal(classifyCStat('150'), 'AUTORIZADA');
    assert.equal(classifyCStat('302'), 'DENEGADA');
  });

  it('status do serviço (107) e evento registrado (135)', () => {
    assert.equal(parseStatusResponse(`<retConsStatServ versao="4.00" xmlns="${NS}"><tpAmb>2</tpAmb><verAplic>X</verAplic><cStat>107</cStat><xMotivo>Servico em Operacao</xMotivo><cUF>35</cUF><dhRecbto>2026-11-26T12:00:00-03:00</dhRecbto><tMed>1</tMed></retConsStatServ>`).outcome, 'SERVICO_OK');
    const ch = '3'.repeat(44);
    const id = `ID110111${ch}01`;
    const r = parseEventResponse(`<retEnvEvento versao="1.00" xmlns="${NS}"><idLote>1</idLote><tpAmb>2</tpAmb><verAplic>X</verAplic><cOrgao>35</cOrgao><cStat>128</cStat><xMotivo>Lote de Evento Processado</xMotivo><retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><verAplic>X</verAplic><cOrgao>35</cOrgao><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo><chNFe>${ch}</chNFe><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><dhRegEvento>2026-11-26T12:10:00-03:00</dhRegEvento><nProt>135260000000002</nProt></infEvento></retEvento></retEnvEvento>`, id);
    assert.equal(r.outcome, 'EVENTO_REGISTRADO');
    assert.ok(r.rawRetEvento.startsWith(`<retEvento xmlns="${NS}"`));
  });
});

describe('SEFAZ — trava de PRODUÇÃO', () => {
  it('flag desligada no código; PRODUCAO/1/vazio bloqueados em todas as camadas; sem endpoint de produção', async () => {
    assert.equal(SEFAZ_PRODUCTION_TRANSMISSION_ENABLED, false);
    for (const env of ['PRODUCAO', '1', 1, '', null, 'producao']) {
      assert.throws(() => assertHomologacao(env), SefazProductionBlockedError, String(env));
    }
    assert.equal(assertHomologacao('HOMOLOGACAO'), '2');
    assert.throws(() => sefazEndpoint('NFeAutorizacao4', 'PRODUCAO'), SefazProductionBlockedError);
    assert.throws(() => buildSigned({ env: 'PRODUCAO' }), SefazProductionBlockedError);
    assert.throws(() => buildConsStatServ('PRODUCAO'), SefazProductionBlockedError);
    assert.throws(() => assertXmlIsHomologacao('<a><tpAmb>2</tpAmb><tpAmb>1</tpAmb></a>'), SefazProductionBlockedError);
    let called = false;
    await assert.rejects(
      callSefaz('NFeStatusServico4', 'PRODUCAO', '<x/>', async () => {
        called = true;
        return { status: 200, body: '' };
      }),
      SefazProductionBlockedError
    );
    assert.equal(called, false, 'transporte nunca é chamado em produção');
    for (const f of fs.readdirSync(path.join(ROOT, 'src/modules/erp/sefaz'))) {
      const src = fs.readFileSync(path.join(ROOT, 'src/modules/erp/sefaz', f), 'utf8');
      assert.ok(!/https:\/\/nfe\.fazenda\.sp\.gov\.br/.test(src), `${f} sem URL de produção`);
    }
    assert.throws(() => inutilizarNumeracao(), /descontinuada pela SEFAZ-SP em 11\/11\/2026/);
  });
});

// ----------------------------------------------------------------------------
// Rotas (alçada fiscal + 2FA) com transporte simulado
// ----------------------------------------------------------------------------
function sessionFor(uid: string, email: string, roleId: string, mfaVerified = true) {
  const iat = Date.now();
  return signStiHubSessionToken({
    uid, email, name: 'Teste SEFAZ', roleId, scope: 'TODOS', enabledModules: ['CRM', 'ERP', 'CHAMADOS'],
    moduleAccess: { crm: true, erp: true, chamados: true }, mfaVerified, mfaMethod: 'TOTP_AUTHENTICATOR', iat, exp: iat + 3_600_000,
  });
}
const admin = () => ({ _sessionToken: sessionFor('usr-seta-01', 'marcelo.mira@setatelecom.com.br', 'SUPER_ADMIN') });
const seller = () => ({ _sessionToken: sessionFor('usr-seta-03', 'marialuiza@setatelecom.com.br', 'VENDEDOR_SALES') });
const adminNo2fa = () => ({ _sessionToken: sessionFor('usr-seta-01', 'marcelo.mira@setatelecom.com.br', 'SUPER_ADMIN', false) });

interface FakeSefaz {
  calls: SoapRequest[];
  mode: 'autoriza' | 'rejeita' | 'processando' | 'sem-prot';
}

function fakeTransport(state: FakeSefaz) {
  return () => async (req: SoapRequest) => {
    state.calls.push(req);
    assert.ok(req.url.startsWith('https://homologacao.nfe.fazenda.sp.gov.br/'), 'só homologação');
    assert.ok(!/<tpAmb>1<\/tpAmb>/.test(req.body));
    const ch = /Id="NFe(\d{44})"/.exec(req.body)?.[1] || /<chNFe>(\d{44})<\/chNFe>/.exec(req.body)?.[1] || '';
    if (req.url.includes('nfeautorizacao4')) {
      if (state.mode === 'autoriza') return { status: 200, body: wrapSoap('NFeAutorizacao4', retEnvi('104', 'Lote processado', prot(ch, '100', 'Autorizado o uso da NF-e'))) };
      if (state.mode === 'rejeita') return { status: 200, body: wrapSoap('NFeAutorizacao4', retEnvi('104', 'Lote processado', prot(ch, '226', 'Rejeicao: Codigo da UF do Emitente diverge da UF autorizadora'))) };
      if (state.mode === 'processando') return { status: 200, body: wrapSoap('NFeAutorizacao4', retEnvi('103', 'Lote recebido com sucesso', '<infRec><nRec>351000000000001</nRec><tMed>1</tMed></infRec>')) };
      return { status: 200, body: wrapSoap('NFeAutorizacao4', retEnvi('225', 'Rejeicao: Falha no Schema XML da NFe')) };
    }
    if (req.url.includes('nferetautorizacao4')) {
      return { status: 200, body: wrapSoap('NFeRetAutorizacao4', `<retConsReciNFe versao="4.00" xmlns="${NS}"><tpAmb>2</tpAmb><verAplic>X</verAplic><nRec>351000000000001</nRec><cStat>105</cStat><xMotivo>Lote em processamento</xMotivo><cUF>35</cUF><dhRecbto>2026-11-26T12:00:05-03:00</dhRecbto></retConsReciNFe>`) };
    }
    if (req.url.includes('nfeconsultaprotocolo4')) {
      return { status: 200, body: wrapSoap('NFeConsultaProtocolo4', `<retConsSitNFe versao="4.00" xmlns="${NS}"><tpAmb>2</tpAmb><verAplic>X</verAplic><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo><cUF>35</cUF><dhRecbto>2026-11-26T12:00:09-03:00</dhRecbto><chNFe>${ch}</chNFe>${prot(ch, '100', 'Autorizado o uso da NF-e')}</retConsSitNFe>`) };
    }
    if (req.url.includes('nferecepcaoevento4')) {
      const tp = /<tpEvento>(\d+)<\/tpEvento>/.exec(req.body)![1];
      return { status: 200, body: wrapSoap('NFeRecepcaoEvento4', `<retEnvEvento versao="1.00" xmlns="${NS}"><idLote>1</idLote><tpAmb>2</tpAmb><verAplic>X</verAplic><cOrgao>35</cOrgao><cStat>128</cStat><xMotivo>Lote de Evento Processado</xMotivo><retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><verAplic>X</verAplic><cOrgao>35</cOrgao><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo><chNFe>${ch}</chNFe><tpEvento>${tp}</tpEvento><nSeqEvento>1</nSeqEvento><dhRegEvento>2026-11-26T12:10:00-03:00</dhRegEvento><nProt>135260000000002</nProt></infEvento></retEvento></retEnvEvento>`) };
    }
    if (req.url.includes('nfestatusservico4')) {
      return { status: 200, body: wrapSoap('NFeStatusServico4', `<retConsStatServ versao="4.00" xmlns="${NS}"><tpAmb>2</tpAmb><verAplic>X</verAplic><cStat>107</cStat><xMotivo>Servico em Operacao</xMotivo><cUF>35</cUF><dhRecbto>2026-11-26T12:00:00-03:00</dhRecbto><tMed>1</tMed></retConsStatServ>`) };
    }
    throw new Error(`URL inesperada ${req.url}`);
  };
}

async function routeSetup(opts: { emitterReady?: boolean; withCert?: boolean } = {}) {
  process.env.STI_HUB_CERT_ENC_KEY = process.env.STI_HUB_CERT_ENC_KEY || crypto.randomBytes(32).toString('base64url');
  const repo = createInMemoryRepository();
  const store = new MemoryCertificateStore();
  const fake: FakeSefaz = { calls: [], mode: 'autoriza' };
  const router = new CrmApiRouter(repo, { certificateStore: store, sefaz: { transportFactory: fakeTransport(fake), sleep: async () => undefined, retAutorizacaoDelayMs: 0 } });
  if (opts.emitterReady !== false) {
    const r = await router.dispatch({
      method: 'PUT',
      path: '/api/admin/settings',
      query: admin(),
      body: { companyEmitter: { cnpj: '14.806.925/0001-39', cep: '13010-000', taxRegime: 'LUCRO_PRESUMIDO' } },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  if (opts.withCert !== false) {
    // o e-CNPJ tem de ser da empresa configurada em Configurações > Empresa
    const f = makeFakePfx({ cnpj: opts.emitterReady !== false ? TEST_CNPJ : '09449088000106' });
    const up = await router.dispatch({ method: 'POST', path: '/api/erp/certificate', query: admin(), body: { pfxBase64: f.pfxBase64, password: f.password } });
    assert.ok(up.status === 201 || up.status === 200, JSON.stringify(up.body));
  }
  if (opts.emitterReady === false) {
    // dados pendentes: Configurações Fiscais com CNPJ de DV inválido e CEP vazio na Empresa
    // (o antigo -32 fixo é migrado na carga para o CNPJ configurado, por isso outro DV inválido aqui)
    repo.updateGestaoClickConfig({ companyCnpj: '11222333000182' });
    (router as unknown as { companyEmitter: { cep: string } }).companyEmitter.cep = '';
  }
  const created = await router.dispatch({ method: 'POST', path: '/api/erp/nfe-produtos', query: admin(), body: draftInput() });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const inv = (created.body as { data: ErpFiscalInvoice }).data;
  const call = (action: string, body: Record<string, unknown> = {}, query: Record<string, string> = admin(), method = 'POST') =>
    router.dispatch({ method, path: `/api/erp/nfe-produtos/${inv.id}/sefaz/${action}`, query, body });
  return { repo, router, fake, inv, call };
}

type R = { status: number; body: { data?: Record<string, unknown>; code?: string; error?: string; details?: string[] } };

describe('SEFAZ — rotas (homologação, alçada fiscal + 2FA)', () => {
  it('transmitir: autorizada (100) => EMITIDA, nfeProc guardado, auditoria; segundo envio bloqueado', async () => {
    const { repo, fake, inv, call } = await routeSetup();
    const r = (await call('transmitir')) as R;
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data!.status, 'AUTORIZADA');
    assert.equal(r.body.data!.environment, 'HOMOLOGACAO');
    assert.equal(r.body.data!.invoiceStatus, 'EMITIDA');
    assert.equal(fake.calls.length, 1);
    assert.ok(/action="http:\/\/www\.portalfiscal\.inf\.br\/nfe\/wsdl\/NFeAutorizacao4\/nfeAutorizacaoLote"/.test(fake.calls[0].headers['Content-Type']));
    assert.ok(!JSON.stringify(r.body).includes('PRIVATE KEY'));
    const saved = repo.getProductNfeInvoice(inv.id)!;
    assert.equal(saved.status, 'EMITIDA');
    assert.ok(saved.productNfe!.sefaz!.nfeProcXml.includes('<nfeProc'));
    assert.equal(verifyXmlSignature(saved.productNfe!.sefaz!.signedXml, 'infNFe').valid, true);
    assert.ok(!JSON.stringify(saved).includes('PRIVATE KEY'), 'chave privada nunca persistida');
    const logs = repo.listSecurityAuditLogs(50).logs as Array<{ action: string; details: string }>;
    assert.ok(logs.some((l) => l.action === 'ERP_PRODUCT_NFE_SEFAZ' && /HOMOLOGAÇÃO transmitir/.test(l.details)));
    const again = (await call('transmitir')) as R;
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'PRODUCT_NFE_ALREADY_FINAL');
    const xml = (await call('xml', {}, admin(), 'GET')) as R;
    assert.equal(xml.status, 200);
    assert.equal(xml.body.data!.kind, 'nfeProc');
    // excluir rascunho transmitido: bloqueado
    const del = await call('', {}, admin(), 'DELETE');
    assert.notEqual(del.status, 200);
  });

  it('rejeição (226) fica REJEITADA e pode ser corrigida/reenviada; lote em processamento consulta o recibo e depois o protocolo', async () => {
    const a = await routeSetup();
    a.fake.mode = 'rejeita';
    const r1 = (await a.call('transmitir')) as R;
    assert.equal(r1.status, 200);
    assert.equal(r1.body.data!.status, 'REJEITADA');
    assert.equal(r1.body.data!.cStat, '226');
    a.fake.mode = 'autoriza';
    const r2 = (await a.call('transmitir')) as R;
    assert.equal(r2.body.data!.status, 'AUTORIZADA');

    const b = await routeSetup();
    b.fake.mode = 'processando';
    const p = (await b.call('transmitir')) as R;
    assert.equal(p.body.data!.status, 'EM_PROCESSAMENTO');
    assert.equal(p.body.data!.nRec, '351000000000001');
    assert.ok(b.fake.calls.some((c) => c.url.includes('nferetautorizacao4')), 'fallback NFeRetAutorizacao4');
    const again = (await b.call('transmitir')) as R;
    assert.equal(again.body.code, 'PRODUCT_NFE_IN_PROCESSING');
    const q = (await b.call('consultar')) as R;
    assert.equal(q.status, 200);
    assert.equal(q.body.data!.status, 'AUTORIZADA');
    assert.equal(q.body.data!.hasNfeProc, true);

    const c = await routeSetup();
    c.fake.mode = 'sem-prot';
    const s = (await c.call('transmitir')) as R;
    assert.equal(s.status, 200);
    assert.equal(s.body.data!.status, 'REJEITADA');
    assert.equal(s.body.data!.cStat, '225');
  });

  it('cancelamento e CC-e de NF-e autorizada; justificativa curta => 400', async () => {
    const { call, repo, inv } = await routeSetup();
    await call('transmitir');
    const bad = (await call('cancelar', { justificativa: 'curta' })) as R;
    assert.equal(bad.status, 400);
    const cce = (await call('carta-correcao', { correcao: 'Correcao do complemento do endereco' })) as R;
    assert.equal(cce.status, 200, JSON.stringify(cce.body));
    const canc = (await call('cancelar', { justificativa: 'Teste de cancelamento em homologacao' })) as R;
    assert.equal(canc.status, 200, JSON.stringify(canc.body));
    assert.equal(canc.body.data!.status, 'CANCELADA');
    const saved = repo.getProductNfeInvoice(inv.id)!;
    assert.equal(saved.status, 'CANCELADA');
    assert.equal(saved.productNfe!.sefaz!.events.length, 2);
    assert.ok(saved.productNfe!.sefaz!.events.every((e) => e.registered && e.procXml.includes('<procEventoNFe')));
  });

  it('sem alçada fiscal, sem 2FA ou sem sessão => 403/401 auditado, sem chamar a SEFAZ', async () => {
    const { fake, call } = await routeSetup();
    assert.equal((await call('transmitir', {}, seller())).status, 403);
    // sessão sem 2FA é recusada já no portão de autenticação (401) — nunca chega à SEFAZ
    assert.ok([401, 403].includes((await call('transmitir', {}, adminNo2fa())).status));
    assert.equal((await call('transmitir', {}, {})).status, 401);
    assert.equal(fake.calls.length, 0);
  });

  it('PRODUÇÃO nas Configurações Fiscais => 403 SEFAZ_PRODUCTION_BLOCKED, nada enviado', async () => {
    const { repo, fake, call } = await routeSetup();
    const s = repo.getFiscalDocumentSettings();
    repo.saveFiscalDocumentSettings({ ...s, nfe: { ...s.nfe, environment: 'PRODUCAO' } }, 'teste');
    assert.equal(repo.getFiscalDocumentSettings().nfe.environment, 'PRODUCAO');
    const r = (await call('transmitir')) as R;
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.equal(r.body.code, 'SEFAZ_PRODUCTION_BLOCKED');
    assert.equal(fake.calls.length, 0);
  });

  it('dados pendentes (CNPJ com DV inválido, CEP vazio) e sem certificado => erro claro, nada enviado', async () => {
    const a = await routeSetup({ emitterReady: false });
    const r = (await a.call('transmitir')) as R;
    assert.equal(r.status, 422, JSON.stringify(r.body));
    assert.equal(r.body.code, 'NFE_EMITTER_DATA_INCOMPLETE');
    assert.ok(r.body.details!.some((d) => /dígito verificador/.test(d)), JSON.stringify(r.body));
    assert.equal(a.fake.calls.length, 0);
    const b = await routeSetup({ withCert: false });
    const r2 = (await b.call('transmitir')) as R;
    assert.equal(r2.status, 409);
    assert.equal(r2.body.code, 'CERT_NOT_CONFIGURED');
    assert.equal(b.fake.calls.length, 0);
  });

  it('inutilização => 410 (descontinuada em SP); status do serviço => 107', async () => {
    const { router } = await routeSetup();
    const inut = (await router.dispatch({ method: 'POST', path: '/api/erp/nfe-produtos/sefaz/inutilizar', query: admin(), body: {} })) as R;
    assert.equal(inut.status, 410);
    assert.equal(inut.body.code, 'SEFAZ_INUTILIZACAO_DISCONTINUED');
    const st = (await router.dispatch({ method: 'GET', path: '/api/erp/sefaz/nfe/status', query: admin() })) as R;
    assert.equal(st.status, 200, JSON.stringify(st.body));
    assert.equal(st.body.data!.cStat, '107');
  });

  it('journal do navegador não forja nem apaga o estado SEFAZ', async () => {
    const { repo, inv, call } = await routeSetup();
    await call('transmitir');
    const server = repo.getProductNfeInvoice(inv.id)!;
    const forged = JSON.parse(JSON.stringify(server)) as ErpFiscalInvoice;
    forged.productNfe!.sefaz!.status = 'REJEITADA';
    forged.status = 'RASCUNHO';
    repo.reconcileClientState({ upsertedInvoices: [forged], deletedInvoiceIds: [] } as never, { canIssueFiscalDocuments: true });
    assert.equal(repo.getProductNfeInvoice(inv.id)!.productNfe!.sefaz!.status, 'AUTORIZADA');
    assert.equal(repo.getProductNfeInvoice(inv.id)!.status, 'EMITIDA');
    repo.reconcileClientState({ deletedInvoiceIds: [inv.id] } as never, { canIssueFiscalDocuments: true });
    assert.ok(repo.getProductNfeInvoice(inv.id), 'nota transmitida não é excluída pelo journal');
  });
});
