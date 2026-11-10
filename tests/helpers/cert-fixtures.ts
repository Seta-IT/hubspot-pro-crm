// ============================================================================
// STI-hub — Pacote N: certificados A1 de TESTE gerados na hora com node-forge (nenhum .pfx real
// no repositorio). Chaves RSA 1024 so para velocidade do teste (a producao nao gera chaves).
// ============================================================================
import forge from 'node-forge';

export interface FakeCertOptions {
  cnpj?: string | null; // 14 digitos no OID 2.16.76.1.3.3 (null => sem SAN e-CNPJ)
  cn?: string;
  notBefore?: Date;
  notAfter?: Date;
  icpBrasil?: boolean;
  password?: string;
  wrongKey?: boolean; // chave privada que NAO corresponde ao certificado
  noKey?: boolean;
  algorithm?: '3des' | 'aes256';
}

let cachedKeys: forge.pki.rsa.KeyPair[] = [];
function keyPair(i: number): forge.pki.rsa.KeyPair {
  while (cachedKeys.length <= i) cachedKeys.push(forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 }));
  return cachedKeys[i];
}

function ecnpjSan(cnpj: string): forge.asn1.Asn1 {
  const a = forge.asn1;
  return a.create(a.Class.UNIVERSAL, a.Type.SEQUENCE, true, [
    a.create(a.Class.CONTEXT_SPECIFIC, 0, true, [
      a.create(a.Class.UNIVERSAL, a.Type.OID, false, a.oidToDer('2.16.76.1.3.3').getBytes()),
      a.create(a.Class.CONTEXT_SPECIFIC, 0, true, [a.create(a.Class.UNIVERSAL, a.Type.OCTETSTRING, false, cnpj)]),
    ]),
  ]);
}

function icpPolicies(): forge.asn1.Asn1 {
  const a = forge.asn1;
  return a.create(a.Class.UNIVERSAL, a.Type.SEQUENCE, true, [
    a.create(a.Class.UNIVERSAL, a.Type.SEQUENCE, true, [
      a.create(a.Class.UNIVERSAL, a.Type.OID, false, a.oidToDer('2.16.76.1.2.1.13').getBytes()),
    ]),
  ]);
}

export function makeFakePfx(o: FakeCertOptions = {}): { pfxBase64: string; password: string; fingerprintHint: string } {
  const kp = keyPair(0);
  const cert = forge.pki.createCertificate();
  cert.publicKey = kp.publicKey;
  cert.serialNumber = '0a1b2c3d4e5f';
  const now = Date.now();
  cert.validity.notBefore = o.notBefore || new Date(now - 24 * 3600 * 1000);
  cert.validity.notAfter = o.notAfter || new Date(now + 365 * 24 * 3600 * 1000);
  const cnpj = o.cnpj === undefined ? '14806925000132' : o.cnpj;
  cert.setSubject([
    { shortName: 'C', value: 'BR' },
    { shortName: 'O', value: 'ICP-Brasil' },
    { shortName: 'CN', value: o.cn || `SETA TELECOM LTDA${cnpj ? ':' + cnpj : ''}` },
  ]);
  const icp = o.icpBrasil !== false;
  cert.setIssuer([
    { shortName: 'C', value: 'BR' },
    { shortName: 'O', value: icp ? 'ICP-Brasil' : 'Empresa Qualquer' },
    { shortName: 'CN', value: icp ? 'AC TESTE RFB G5' : 'AC Particular de Teste' },
  ]);
  const exts: Array<Record<string, unknown>> = [{ name: 'basicConstraints', cA: false }];
  if (cnpj && !o.cn) exts.push({ id: '2.5.29.17', value: ecnpjSan(cnpj) });
  if (icp) exts.push({ id: '2.5.29.32', value: icpPolicies() });
  cert.setExtensions(exts as never);
  cert.sign(kp.privateKey, forge.md.sha256.create());
  const password = o.password ?? 'senha-teste-123';
  const key = o.noKey ? null : o.wrongKey ? keyPair(1).privateKey : kp.privateKey;
  const p12 = forge.pkcs12.toPkcs12Asn1(key, [cert], password, {
    algorithm: o.algorithm || '3des',
    generateLocalKeyId: true,
    friendlyName: 'teste',
  } as never);
  const der = forge.asn1.toDer(p12).getBytes();
  return { pfxBase64: Buffer.from(der, 'binary').toString('base64'), password, fingerprintHint: cert.serialNumber };
}
