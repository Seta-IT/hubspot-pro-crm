// ============================================================================
// STI-hub - Tela Configurações > Certificado digital (A1)
// Funções puras do cliente: mapeamento de códigos de erro (sem ecoar o corpo),
// base64 sem prefixo data:, validação local do arquivo e gate admin + 2FA.
// Sem rede.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CERT_A1_ERROR_MESSAGES,
  CERT_A1_MAX_BYTES,
  bytesToBase64,
  certificateErrorMessage,
  certificateStatusBadge,
  certificateWarningMessages,
  formatCnpj,
  readCertificateData,
  readCertificateError,
  shouldHideCertificateSection,
  stripDataUrlPrefix,
  validateCertificateFile,
} from '../src/app/lib/certificate-a1-client';

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('Certificado A1: mapeamento de códigos de erro (contrato final)', () => {
  it('cada código do contrato tem mensagem própria no status certo', () => {
    const cases: Array<[number, string]> = [
      [400, 'CERT_INVALID_BODY'],
      [413, 'CERT_TOO_LARGE'],
      [422, 'CERT_INVALID_OR_WRONG_PASSWORD'],
      [422, 'CERT_PRIVATE_KEY_MISMATCH'],
      [422, 'CERT_EXPIRED'],
      [422, 'CERT_NOT_YET_VALID'],
      [422, 'CERT_NOT_ECNPJ'],
      [422, 'CERT_CNPJ_MISMATCH'],
      [429, 'CERT_RATE_LIMITED'],
      [403, 'CERT_FORBIDDEN'],
      [503, 'CERT_ENC_KEY_MISSING'],
      [503, 'CERT_STORE_UNAVAILABLE'],
      [404, 'CERT_NOT_FOUND'],
      [401, 'MFA_AUTH_REQUIRED'],
    ];
    for (const [st, code] of cases) {
      assert.equal(certificateErrorMessage(st, code), CERT_A1_ERROR_MESSAGES[code], code);
    }
    const all = new Set(cases.map(([st, code]) => certificateErrorMessage(st, code)));
    assert.equal(all.size, cases.length, 'mensagens distintas por código');
  });

  it('CNPJ divergente mostra só os CNPJs que vieram no cnpjCheck do servidor', () => {
    const m = certificateErrorMessage(422, 'CERT_CNPJ_MISMATCH', {
      certificateCnpj: '11222333000181',
      certificateCnpjSource: 'OID_2_16_76_1_3_3',
      expectedCnpj: '11444777000161',
      expectedCnpjSource: 'companyEmitter',
      sameRoot: false,
    });
    assert.match(m, /CNPJ do certificado: 11\.222\.333\/0001-81\./);
    assert.match(m, /CNPJ esperado: 11\.444\.777\/0001-61\./);
    const soCert = certificateErrorMessage(422, 'CERT_CNPJ_MISMATCH', { certificateCnpj: '11222333000181' });
    assert.match(soCert, /CNPJ do certificado: 11\.222\.333\/0001-81/);
    assert.doesNotMatch(soCert, /CNPJ esperado/);
    const soEsperado = certificateErrorMessage(422, 'CERT_CNPJ_MISMATCH', { expectedCnpj: '11444777000161' });
    assert.match(soEsperado, /CNPJ esperado: 11\.444\.777\/0001-61/);
    assert.doesNotMatch(soEsperado, /CNPJ do certificado:/);
    const semCheck = certificateErrorMessage(422, 'CERT_CNPJ_MISMATCH');
    assert.equal(semCheck, CERT_A1_ERROR_MESSAGES.CERT_CNPJ_MISMATCH);
    assert.doesNotMatch(semCheck, /\d/);
    assert.equal(formatCnpj('11444777000161'), '11.444.777/0001-61');
  });

  it('nenhum CNPJ fixo da empresa no código do cliente do certificado', () => {
    for (const f of ['src/app/lib/certificate-a1-client.ts', 'src/app/components/CertificateA1UploadCard.tsx']) {
      const code = src(f);
      assert.doesNotMatch(code, /0001-32|14806925|14\.806\.925|SETA_TELECOM_CNPJ/, f);
    }
  });

  it('senha errada e arquivo inválido usam a mesma mensagem genérica', () => {
    const m = certificateErrorMessage(422, 'CERT_INVALID_OR_WRONG_PASSWORD');
    assert.match(m, /Arquivo ou senha inválidos/);
    assert.equal(certificateErrorMessage(422, 'QUALQUER_OUTRO'), m);
    assert.equal(certificateErrorMessage(422), m);
  });

  it('código fora do status, desconhecido ou 5xx genérico não ecoa nada do servidor', () => {
    for (const [st, code] of [[500, 'Stack trace: Error at x'], [503, 'OUTRO'], [400, undefined], [0, 'X'], [200, 'CERT_EXPIRED']] as const) {
      const m = certificateErrorMessage(st, code);
      assert.equal(m, CERT_A1_ERROR_MESSAGES.CERT_GENERIC);
      if (code) assert.ok(!m.includes(code));
    }
    assert.equal(certificateErrorMessage(500, { code: 'x' }), CERT_A1_ERROR_MESSAGES.CERT_GENERIC);
  });

  it('envelope de erro: code só no nível de cima (error.code é ignorado)', () => {
    assert.deepEqual(readCertificateError({ error: 'x', code: 'CERT_EXPIRED' }), { code: 'CERT_EXPIRED', cnpjCheck: undefined });
    assert.deepEqual(readCertificateError({ error: { code: 'CERT_EXPIRED' } }), { code: undefined, cnpjCheck: undefined });
    assert.equal(readCertificateError({ code: 'CERT_CNPJ_MISMATCH', cnpjCheck: { expectedCnpj: '11444777000161' } }).cnpjCheck?.expectedCnpj, '11444777000161');
    assert.deepEqual(readCertificateError(null), {});
  });

  it('GET 401/403 esconde a seção', () => {
    assert.equal(shouldHideCertificateSection(401), true);
    assert.equal(shouldHideCertificateSection(403), true);
    assert.equal(shouldHideCertificateSection(200), false);
    assert.equal(shouldHideCertificateSection(503), false);
  });
});

describe('Certificado A1: envelope de sucesso, canManage e avisos', () => {
  it('só aceita { data } com present booleano; sem data => null', () => {
    assert.equal(readCertificateData({ present: true, canManage: true }), null);
    assert.equal(readCertificateData({ data: null }), null);
    assert.equal(readCertificateData(null), null);
    const d = readCertificateData({ data: { present: false, canManage: true } });
    assert.equal(d?.present, false);
    assert.equal(d?.canManage, true);
  });

  it('canManage só é verdadeiro quando o servidor manda true', () => {
    assert.equal(readCertificateData({ data: { present: true } })?.canManage, false);
    assert.equal(readCertificateData({ data: { present: true, canManage: 'true' } })?.canManage, false);
    assert.equal(readCertificateData({ data: { present: true, canManage: true } })?.canManage, true);
  });

  it('avisos âmbar com mensagens próprias; códigos desconhecidos são ignorados', () => {
    const msgs = certificateWarningMessages(
      [{ code: 'CERT_NOT_ICP_BRASIL', message: 'texto do servidor' }, { code: 'CERT_EXPIRING_SOON', message: 'x' }, { code: 'OUTRO' }],
      12
    );
    assert.equal(msgs.length, 2);
    assert.match(msgs[0], /ICP-Brasil/);
    assert.match(msgs[1], /vence em 12 dias/);
    assert.ok(!msgs.join(' ').includes('texto do servidor'));
    assert.deepEqual(certificateWarningMessages(undefined), []);
  });
});

describe('Certificado A1: base64 sem prefixo data:', () => {
  const bytes = new Uint8Array([0x30, 0x82, 0x01, 0x0a, 0x02, 0x01, 0x03, 0xff, 0x00]);
  const expected = Buffer.from(bytes).toString('base64');

  it('remove o prefixo de Data URL do FileReader', () => {
    assert.equal(stripDataUrlPrefix(`data:application/x-pkcs12;base64,${expected}`), expected);
    assert.equal(stripDataUrlPrefix(`data:;base64,${expected}`), expected);
    assert.equal(stripDataUrlPrefix(`data:application/octet-stream;base64,${expected}`), expected);
  });

  it('mantém base64 puro e trata vazio', () => {
    assert.equal(stripDataUrlPrefix(expected), expected);
    assert.equal(stripDataUrlPrefix(''), '');
    assert.doesNotMatch(stripDataUrlPrefix(`data:application/x-pkcs12;base64,${expected}`), /^data:|base64,/);
  });

  it('bytesToBase64 gera base64 puro idêntico ao Buffer (inclusive arquivo de 64 KiB)', () => {
    assert.equal(bytesToBase64(bytes), expected);
    const big = new Uint8Array(CERT_A1_MAX_BYTES);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 0xff;
    const b64 = bytesToBase64(big);
    assert.equal(b64, Buffer.from(big).toString('base64'));
    assert.doesNotMatch(b64, /^data:/);
  });
});

describe('Certificado A1: validação local, badge e gate admin + 2FA', () => {
  it('aceita .pfx/.p12 até 64 KiB e recusa o resto', () => {
    assert.equal(validateCertificateFile({ name: 'seta.pfx', size: 4000 }), null);
    assert.equal(validateCertificateFile({ name: 'SETA.P12', size: CERT_A1_MAX_BYTES }), null);
    assert.equal(validateCertificateFile({ name: 'seta.pfx', size: CERT_A1_MAX_BYTES + 1 }), CERT_A1_ERROR_MESSAGES.CERT_TOO_LARGE);
    assert.equal(validateCertificateFile({ name: 'seta.pem', size: 10 }), CERT_A1_ERROR_MESSAGES.CERT_CLIENT_EXTENSION);
    assert.equal(validateCertificateFile({ name: 'seta.pfx', size: 0 }), CERT_A1_ERROR_MESSAGES.CERT_CLIENT_EMPTY);
    assert.equal(validateCertificateFile(null), CERT_A1_ERROR_MESSAGES.CERT_CLIENT_FILE);
  });

  it('badge por status', () => {
    assert.match(certificateStatusBadge('VALIDO').className, /emerald/);
    assert.match(certificateStatusBadge('VENCE_EM_30_DIAS').className, /amber/);
    assert.match(certificateStatusBadge('VENCIDO').className, /red/);
  });

  it('a tela usa só data.canManage (sem checar papéis via /api/auth/session)', () => {
    const tsx = src('src/app/components/CertificateA1UploadCard.tsx');
    assert.match(tsx, /const canManage = cert\?\.canManage === true;/);
    assert.doesNotMatch(tsx, /\/api\/auth\/session|roleId|SUPER_ADMIN/);
    assert.doesNotMatch(tsx, /error\?\.code/);
  });

  it('a tela não persiste senha/base64 e usa campo de senha seguro', () => {
    const tsx = src('src/app/components/CertificateA1UploadCard.tsx');
    const lib = src('src/app/lib/certificate-a1-client.ts');
    const semComentarios = (c: string) => c.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    for (const code of [semComentarios(tsx), semComentarios(lib)]) {
      assert.doesNotMatch(code, /localStorage|sessionStorage|console\.(log|info|debug|warn|error)|durable-storage/);
    }
    assert.match(tsx, /type="password"/);
    assert.match(tsx, /autoComplete="new-password"/);
    assert.match(tsx, /JSON\.stringify\(\{ pfxBase64, password \}\)/);
    assert.match(tsx, /finally \{[\s\S]*clearSensitive\(\)/);
    assert.match(tsx, /window\.confirm\(/);
    const panel = src('src/app/components/StiHubAdminRbacPanel.tsx');
    assert.doesNotMatch(panel, /certificateSettings\.certificateFileName/);
  });
});
