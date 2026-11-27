// ============================================================================
// STI-hub — Pacote N (02/11/2026), commit 1: Certificado Digital A1 (/api/erp/certificate).
// Certificados gerados na hora com node-forge (tests/helpers/cert-fixtures.ts); nada real.
// ============================================================================
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository, CrmRepository } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import {
  CERT_KV_KEY,
  decryptCertField,
  loadCertificateForSigning,
  MemoryCertificateStore,
  toCertificateView,
  certStatusOf,
} from '../src/modules/erp/certificate-a1';
import { certificateMatchesCompanyCnpj, cnpjCheckDigitsValidMod11, resolveExpectedCompanyCnpj } from '../src/api/certificate-routes';
import { validateCnpj } from '../src/modules/data-health/validators';
import { sanitizeApiResponseBody } from '../src/db/iam-security';
import { makeFakePfx } from './helpers/cert-fixtures';

const KEY = crypto.randomBytes(32).toString('base64url');
const HTTP = { _fromHttpBridge: '1', _clientIp: '203.0.113.7' };
const ADMIN_EMAIL = 'marcelo.mira@setatelecom.com.br';
const tok = (uid: string, email: string, roleId: string, extra: Record<string, unknown> = {}) =>
  signStiHubSessionToken({
    uid, email, name: 'Teste', roleId, scope: roleId === 'SUPER_ADMIN' ? 'TODOS' : 'PROPRIOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000, ...extra,
  } as Parameters<typeof signStiHubSessionToken>[0]);
const A = (extra: Record<string, unknown> = {}) => ({ ...HTTP, _sessionToken: tok('usr-seta-01', ADMIN_EMAIL, 'SUPER_ADMIN', { canManageUsersRbac: true, ...extra }) });
const SELLER = () => ({ ...HTTP, _sessionToken: tok('usr-seta-03', 'marialuiza@setatelecom.com.br', 'VENDEDOR_SALES') });
const FISCAL = () => ({ ...HTTP, _sessionToken: tok('usr-seta-06', 'fiscal@setatelecom.com.br', 'FISCAL_CONTABIL') });
const MARKETING = () => ({ ...HTTP, _sessionToken: tok('usr-seta-08', 'marketing@setatelecom.com.br', 'ANALISTA_MARKETING') });
type Body = { code?: string; error?: string; data?: Record<string, unknown>; warnings?: Array<{ code: string }>; replaced?: boolean; cnpjCheck?: Record<string, unknown> };

const SENSITIVE_RESPONSE_KEYS = ['pfxBase64', 'password', 'pfxEnc', 'passwordEnc', 'privateKeyPem', 'certificatePem', 'pfx', 'ct', 'iv', 'tag'];
function assertNoSensitive(body: unknown, secrets: string[]) {
  const s = JSON.stringify(body);
  for (const k of SENSITIVE_RESPONSE_KEYS) assert.ok(!s.includes(`"${k}"`), `campo ${k} na resposta`);
  for (const x of secrets) if (x) assert.ok(!s.includes(x), 'material sensivel na resposta');
  assert.ok(!/BEGIN (RSA )?PRIVATE KEY|BEGIN CERTIFICATE/.test(s));
}

function setup() {
  const repo = createInMemoryRepository();
  const store = new MemoryCertificateStore();
  const router = new CrmApiRouter(repo, { certificateStore: store });
  const call = (method: string, q: Record<string, string>, body: Record<string, unknown> = {}) =>
    router.dispatch({ method, path: '/api/erp/certificate', query: q, body });
  const logs = (action: string) => repo.listSecurityAuditLogs(10000).logs.filter((l) => l.action === action);
  return { repo, store, router, call, logs };
}

describe('Pacote N (1): POST/GET/DELETE /api/erp/certificate', () => {
  beforeEach(() => {
    process.env.STI_HUB_CERT_ENC_KEY = KEY;
  });

  it('sucesso: admin com 2FA envia e-CNPJ valido => 201, so metadados, cifrado em repouso com AAD do id', async () => {
    const { call, store, logs } = setup();
    const f = makeFakePfx();
    const r = await call('POST', A(), { pfxBase64: f.pfxBase64, password: f.password });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.headers?.['Cache-Control']?.includes('no-store'), true);
    const b = r.body as Body;
    const d = b.data!;
    assert.equal(d.present, true);
    assert.equal(d.cnpj, '09449088000106');
    assert.equal(d.icpBrasil, true);
    assert.equal(d.status, 'VALIDO');
    assert.equal(d.uploadedBy, ADMIN_EMAIL);
    assert.match(String(d.fingerprintSha256), /^[0-9A-F]{64}$/);
    assert.equal(d.canManage, true);
    assert.deepEqual(Object.keys(d).sort(), ['canManage', 'cnpj', 'daysToExpire', 'fingerprintSha256', 'icpBrasil', 'issuer', 'notAfter', 'notBefore', 'present', 'serial', 'status', 'subject', 'uploadedAt', 'uploadedBy'].sort());
    assert.equal(b.replaced, false);
    assert.deepEqual(b.warnings, []);
    assertNoSensitive(r.body, [f.pfxBase64.slice(0, 40), f.password]);
    // repouso: nada em claro, IV de 12 bytes, AAD presa ao id
    const rec = (await store.load())!;
    const raw = JSON.stringify(rec);
    assert.ok(!raw.includes(f.pfxBase64.slice(0, 40)) && !raw.includes(f.password));
    const cur = rec.current!;
    assert.equal(Buffer.from(cur.pfxEnc.iv, 'base64url').length, 12);
    assert.notEqual(cur.pfxEnc.iv, cur.passwordEnc.iv);
    const key = Buffer.from(KEY, 'base64url');
    assert.equal(decryptCertField(cur.passwordEnc, cur.id, 'password', key).toString('utf8'), f.password);
    assert.equal(decryptCertField(cur.pfxEnc, cur.id, 'pfx', key).toString('base64'), f.pfxBase64);
    assert.throws(() => decryptCertField(cur.pfxEnc, 'cert-a1-outro-id', 'pfx', key), 'AAD com outro id nao decifra');
    assert.throws(() => decryptCertField(cur.pfxEnc, cur.id, 'pfx', crypto.randomBytes(32)), 'outra chave nao decifra');
    const up = logs('ERP_CERT_UPLOADED');
    assert.equal(up.length, 1);
    assert.match(up[0].details, /fingerprintSha256=[0-9A-F]{64}; titular=SETA TELECOM LTDA:09449088000106; cnpj=09449088000106/);
    assert.ok(!up[0].details.includes(f.password) && !up[0].details.includes(f.pfxBase64.slice(0, 40)));
    // uso futuro (NF-e): so servidor
    const forSign = await loadCertificateForSigning(store);
    assert.ok(forSign && forSign.privateKeyPem.includes('PRIVATE KEY') && forSign.password === f.password);
  });

  it('troca: substitui o atual, historico so com metadados (sem blob antigo) e ERP_CERT_REPLACED', async () => {
    const { call, store, logs } = setup();
    const f1 = makeFakePfx({ algorithm: 'aes256' });
    assert.equal((await call('POST', A(), { pfxBase64: f1.pfxBase64, password: f1.password })).status, 201);
    const first = (await store.load())!.current!;
    const f2 = makeFakePfx({ password: 'outra-senha-456' });
    const r = await call('POST', A(), { pfxBase64: f2.pfxBase64, password: f2.password });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((r.body as Body).replaced, true);
    const rec = (await store.load())!;
    assert.notEqual(rec.current!.id, first.id);
    assert.equal(rec.history.length, 1);
    assert.equal(rec.history[0].reason, 'SUBSTITUIDO');
    const histRaw = JSON.stringify(rec.history);
    assert.ok(!histRaw.includes(first.pfxEnc.ct.slice(0, 32)) && !/pfxEnc|passwordEnc/.test(histRaw), 'historico sem blob');
    assert.equal(logs('ERP_CERT_REPLACED').length, 1);
  });

  it('senha errada e arquivo invalido => 422 CERT_INVALID_OR_WRONG_PASSWORD (mensagem generica) e ERP_CERT_UPLOAD_FAILED', async () => {
    const { call, store, logs } = setup();
    const f = makeFakePfx();
    const wrong = await call('POST', A(), { pfxBase64: f.pfxBase64, password: 'senha-errada' });
    assert.equal(wrong.status, 422);
    assert.equal((wrong.body as Body).code, 'CERT_INVALID_OR_WRONG_PASSWORD');
    const junk = await call('POST', A(), { pfxBase64: Buffer.from('isto nao e um pfx').toString('base64'), password: 'x' });
    assert.equal(junk.status, 422);
    assert.equal((junk.body as Body).code, 'CERT_INVALID_OR_WRONG_PASSWORD');
    assert.equal((wrong.body as Body).error, (junk.body as Body).error, 'mesma mensagem generica');
    const notB64 = await call('POST', A(), { pfxBase64: '***', password: 'x' });
    assert.equal((notB64.body as Body).code, 'CERT_INVALID_OR_WRONG_PASSWORD');
    assert.equal(await store.load(), null);
    const failed = logs('ERP_CERT_UPLOAD_FAILED');
    assert.ok(failed.some((l) => /senha incorreta/.test(l.details)));
    assert.ok(failed.some((l) => /arquivo PKCS#12 invalido/.test(l.details)));
    for (const l of failed) assert.ok(!l.details.includes('senha-errada'), 'senha nunca na auditoria');
  });

  it('expirado, ainda nao vigente, sem chave correspondente, sem e-CNPJ => 422 com o codigo certo', async () => {
    const { call } = setup();
    const day = 86_400_000;
    const cases: Array<[Parameters<typeof makeFakePfx>[0], string]> = [
      [{ notBefore: new Date(Date.now() - 400 * day), notAfter: new Date(Date.now() - day) }, 'CERT_EXPIRED'],
      [{ notBefore: new Date(Date.now() + day), notAfter: new Date(Date.now() + 400 * day) }, 'CERT_NOT_YET_VALID'],
      [{ wrongKey: true }, 'CERT_PRIVATE_KEY_MISMATCH'],
      [{ noKey: true }, 'CERT_PRIVATE_KEY_MISMATCH'],
      [{ cnpj: null }, 'CERT_NOT_ECNPJ'],
    ];
    for (const [opt, code] of cases) {
      const f = makeFakePfx(opt);
      const r = await call('POST', A(), { pfxBase64: f.pfxBase64, password: f.password });
      assert.equal(r.status, 422, code);
      assert.equal((r.body as Body).code, code);
    }
  });

  it('CNPJ de outra empresa (outra raiz) => 422 CERT_CNPJ_MISMATCH auditado; mostra a fonte (Configurações > Empresa) e o DV', async () => {
    const { call, logs, store } = setup();
    const f = makeFakePfx({ cnpj: '14806925000139' });
    const r = await call('POST', A(), { pfxBase64: f.pfxBase64, password: f.password });
    assert.equal(r.status, 422);
    const b = r.body as Body;
    assert.equal(b.code, 'CERT_CNPJ_MISMATCH');
    assert.deepEqual(b.cnpjCheck, {
      certificateCnpj: '14806925000139',
      certificateCnpjSource: 'OID_2.16.76.1.3.3',
      expectedCnpj: '09449088000106',
      expectedCnpjSource: 'companyEmitter.cnpj',
      sameRoot: false,
      certificateCnpjCheckDigitsValidMod11: true,
      expectedCnpjCheckDigitsValidMod11: true,
    });
    assert.equal(await store.load(), null);
    assert.ok(logs('ERP_CERT_UPLOAD_FAILED').some((l) => /CERT_CNPJ_MISMATCH/.test(l.details) && /certificado=14806925000139/.test(l.details)));
    // o antigo CNPJ fixo 14.806.925/0001-32 tambem e recusado
    const old = makeFakePfx({ cnpj: '14806925000132' });
    assert.equal(((await call('POST', A(), { pfxBase64: old.pfxBase64, password: old.password })).body as Body).code, 'CERT_CNPJ_MISMATCH');
    // CNPJ so no CN "NOME:CNPJ" tambem vale (e-CNPJ legado)
    const cnOnly = makeFakePfx({ cnpj: null, cn: 'STI SOLUCOES EM TI:09449088000106' });
    const ok = await call('POST', A(), { pfxBase64: cnOnly.pfxBase64, password: cnOnly.password });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal((ok.body as Body).cnpjCheck!.certificateCnpjSource, 'CN');
  });

  it('e-CNPJ de filial da mesma raiz (09.449.088) e aceito, como a SEFAZ (regra 213)', async () => {
    const { call } = setup();
    assert.equal(certificateMatchesCompanyCnpj('09449088000289', '09449088000106'), true);
    assert.equal(certificateMatchesCompanyCnpj('14806925000139', '09449088000106'), false);
    const filial = makeFakePfx({ cnpj: '09449088000289' });
    const r = await call('POST', A(), { pfxBase64: filial.pfxBase64, password: filial.password });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((r.body as Body).cnpjCheck!.sameRoot, true);
  });

  it('fonte do CNPJ comparado: Configurações > Empresa > Configurações Fiscais; nenhum CNPJ fixo no código', async () => {
    const repo = createInMemoryRepository();
    // so o gestaoClickConfig (sem companyEmitter)
    assert.deepEqual(resolveExpectedCompanyCnpj({ repo }), { digits: '09449088000106', source: 'erp.gestaoClickConfig.companyCnpj' });
    // companyEmitter tem prioridade
    assert.deepEqual(resolveExpectedCompanyCnpj({ repo, companyCnpj: () => '11.222.333/0001-81' }), { digits: '11222333000181', source: 'companyEmitter.cnpj' });
    // sem fonte valida (vazio, DV errado, curto) => null, nunca um valor inventado
    for (const v of ['', '14.806.925/0001-32', '123']) {
      const fake = { getErpOverview: () => ({ gestaoClickConfig: { companyCnpj: v } }) } as unknown as CrmRepository;
      assert.equal(resolveExpectedCompanyCnpj({ repo: fake, companyCnpj: () => v }), null);
    }
    assert.equal(validateCnpj('14806925000132').isValid, false, 'a excecao fixa do validators.ts foi removida');
    assert.equal(cnpjCheckDigitsValidMod11('09449088000106'), true);
    // /api/admin/settings troca o CNPJ da empresa; o certificado passa a ser comparado com o novo
    const { call, router, logs } = setup();
    const st = await router.dispatch({ method: 'POST', path: '/api/admin/settings', query: A(), body: { companyEmitter: { cnpj: '14.806.925/0001-39' } } });
    assert.equal(st.status, 200, JSON.stringify(st.body));
    assert.ok(logs('FISCAL_COMPANY_CNPJ_CHANGED').some((l) => /09449088000106 -> 14806925000139/.test(l.details)));
    const f39 = makeFakePfx({ cnpj: '14806925000139' });
    const ok = await call('POST', A(), { pfxBase64: f39.pfxBase64, password: f39.password });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal((ok.body as Body).cnpjCheck!.expectedCnpjSource, 'companyEmitter.cnpj');
  });

  it('sem CNPJ da empresa configurado => 409 CERT_COMPANY_CNPJ_NOT_CONFIGURED (não compara com valor fixo)', async () => {
    const repo = createInMemoryRepository();
    repo.updateGestaoClickConfig({ companyCnpj: '' });
    const store = new MemoryCertificateStore();
    const router = new CrmApiRouter(repo, { certificateStore: store });
    const internals = router as unknown as { companyEmitter: { cnpj: string }; companyEmitterHydrated: boolean };
    internals.companyEmitter.cnpj = '';
    internals.companyEmitterHydrated = true;
    const f = makeFakePfx({});
    const r = await router.dispatch({ method: 'POST', path: '/api/erp/certificate', query: A(), body: { pfxBase64: f.pfxBase64, password: f.password } });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal((r.body as Body).code, 'CERT_COMPANY_CNPJ_NOT_CONFIGURED');
    assert.equal(await store.load(), null);
  });

  it('canManage no GET (e no POST/DELETE): true so para admin com 2FA', async () => {
    const { call } = setup();
    assert.equal(((await call('GET', A())).body as Body).data!.canManage, true);
    assert.equal(((await call('GET', FISCAL())).body as Body).data!.canManage, false);
  });

  it('emissora fora da ICP-Brasil => aceita com icpBrasil:false e aviso', async () => {
    const { call } = setup();
    const f = makeFakePfx({ icpBrasil: false });
    const r = await call('POST', A(), { pfxBase64: f.pfxBase64, password: f.password });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((r.body as Body).data!.icpBrasil, false);
    assert.ok((r.body as Body).warnings!.some((w) => w.code === 'CERT_NOT_ICP_BRASIL'));
  });

  it('tamanho: .pfx decodificado acima de 64 KiB => 413 CERT_TOO_LARGE; corpo .strict()', async () => {
    const { call } = setup();
    const big = crypto.randomBytes(64 * 1024 + 1).toString('base64');
    const r = await call('POST', A(), { pfxBase64: big, password: 'x' });
    assert.equal(r.status, 413);
    assert.equal((r.body as Body).code, 'CERT_TOO_LARGE');
    const f = makeFakePfx();
    const extra = await call('POST', A(), { pfxBase64: f.pfxBase64, password: f.password, fileName: 'a.pfx' });
    assert.equal(extra.status, 400);
    assert.equal((extra.body as Body).code, 'CERT_INVALID_BODY');
    const num = await call('POST', A(), { pfxBase64: f.pfxBase64, password: 123 });
    assert.equal(num.status, 400);
  });

  it('RBAC: anonimo 401; sem 2FA 401 auditado; nao-admin 403 auditado no POST/DELETE; GET por leitura fiscal/config', async () => {
    const { call, logs, repo } = setup();
    const f = makeFakePfx();
    const body = { pfxBase64: f.pfxBase64, password: f.password };
    for (const m of ['GET', 'POST', 'DELETE']) {
      assert.equal((await call(m, { ...HTTP }, m === 'POST' ? body : {})).status, 401, `anonimo ${m}`);
    }
    for (const m of ['POST', 'DELETE']) {
      const noMfa = await call(m, A({ mfaVerified: false }), m === 'POST' ? body : {});
      assert.equal(noMfa.status, 401, `sem 2FA ${m}`);
      const seller = await call(m, SELLER(), m === 'POST' ? body : {});
      assert.equal(seller.status, 403, `vendedor ${m}`);
      assert.equal((seller.body as Body).code, 'CERT_FORBIDDEN');
      const fiscal = await call(m, FISCAL(), m === 'POST' ? body : {});
      assert.equal(fiscal.status, 403, `fiscal ${m} (so leitura)`);
    }
    const denied = logs('ERP_CERT_UPLOAD_DENIED');
    assert.ok(denied.some((l) => l.actorEmail === 'marialuiza@setatelecom.com.br' && l.resource === 'POST /api/erp/certificate'));
    assert.ok(denied.some((l) => l.actorEmail === 'marialuiza@setatelecom.com.br' && l.resource === 'DELETE /api/erp/certificate'));
    assert.ok(denied.some((l) => l.actorEmail === ADMIN_EMAIL && /sem 2FA/.test(l.details)));
    assert.ok(!JSON.stringify(denied).includes(f.password));
    // GET: admin e leitura fiscal/configuracoes => 200; vendedor e marketing => 403
    assert.equal((await call('POST', A(), body)).status, 201);
    for (const [q, st] of [[A(), 200], [FISCAL(), 200], [SELLER(), 403], [MARKETING(), 403]] as const) {
      const g = await call('GET', q);
      assert.equal(g.status, st);
      if (st === 200) assertNoSensitive(g.body, [f.pfxBase64.slice(0, 40), f.password]);
    }
    // via sanitizador HTTP: nenhuma chave sensivel sai mesmo que entre por engano
    const s = sanitizeApiResponseBody({ a: { pfxBase64: 'x', password: 'y', pfxEnc: {}, passwordEnc: {}, privateKeyPem: 'z', ok: 1 } }, { path: '/api/erp/certificate' });
    assert.deepEqual(s, { a: { ok: 1 } });
    void repo;
  });

  it('GET so metadados (sem cert: present:false); status VENCE_EM_30_DIAS/VENCIDO', async () => {
    const { call } = setup();
    const g0 = await call('GET', A());
    assert.equal(g0.status, 200);
    assert.equal((g0.body as Body).data!.present, false);
    const f = makeFakePfx({ notAfter: new Date(Date.now() + 10 * 86_400_000) });
    const r = await call('POST', A(), { pfxBase64: f.pfxBase64, password: f.password });
    assert.equal((r.body as Body).data!.status, 'VENCE_EM_30_DIAS');
    assert.ok((r.body as Body).warnings!.some((w) => w.code === 'CERT_EXPIRING_SOON'));
    const g = await call('GET', A());
    assert.equal(g.headers?.['Cache-Control']?.includes('no-store'), true);
    assert.equal((g.body as Body).data!.status, 'VENCE_EM_30_DIAS');
    assert.equal(certStatusOf(new Date(Date.now() - 1000).toISOString()).status, 'VENCIDO');
    assert.equal(toCertificateView(null).present, false);
  });

  it('bootstrap, state, overview, admin/settings e o estado sincronizado no Postgres nunca incluem o blob', async () => {
    const { call, router, store, repo } = setup();
    const f = makeFakePfx();
    assert.equal((await call('POST', A(), { pfxBase64: f.pfxBase64, password: f.password })).status, 201);
    const cur = (await store.load())!.current!;
    const secrets = [cur.pfxEnc.ct.slice(0, 40), cur.passwordEnc.ct, f.pfxBase64.slice(0, 40), f.password, cur.id];
    for (const [method, path] of [['GET', '/api/bootstrap'], ['POST', '/api/bootstrap'], ['GET', '/api/state'], ['GET', '/api/erp/overview'], ['GET', '/api/admin/settings']] as const) {
      const r = await router.dispatch({ method, path, query: A(), body: {} });
      assert.equal(r.status, 200, `${method} ${path}`);
      const s = JSON.stringify(r.body);
      for (const x of secrets) assert.ok(!s.includes(x), `${method} ${path} sem material do certificado`);
      assert.ok(!s.includes(CERT_KV_KEY) && !/pfxEnc|passwordEnc/.test(s));
    }
    const state = JSON.stringify(repo.getState());
    for (const x of secrets) assert.ok(!state.includes(x), 'crm_state_v1 sem o blob');
  });

  it('sem STI_HUB_CERT_ENC_KEY (ou chave curta) => 503 CERT_ENC_KEY_MISSING em GET/POST/DELETE (falha fechada)', async () => {
    const { call, store } = setup();
    const f = makeFakePfx();
    for (const v of [undefined, '', 'curta', Buffer.alloc(16, 1).toString('base64url')]) {
      if (v === undefined) delete process.env.STI_HUB_CERT_ENC_KEY;
      else process.env.STI_HUB_CERT_ENC_KEY = v;
      for (const m of ['GET', 'POST', 'DELETE']) {
        const r = await call(m, A(), m === 'POST' ? { pfxBase64: f.pfxBase64, password: f.password } : {});
        assert.equal(r.status, 503, `${m} chave=${String(v).slice(0, 6)}`);
        assert.equal((r.body as Body).code, 'CERT_ENC_KEY_MISSING');
      }
    }
    assert.equal(await store.load(), null);
    delete process.env.STI_HUB_CERT_ENC_KEY;
    await assert.rejects(() => loadCertificateForSigning(store).then((x) => { if (x === null) throw new Error('sem cert'); }));
  });

  it('rate limit: 5 falhas por usuario em 15 min => 429 CERT_RATE_LIMITED (ate com o certificado certo)', async () => {
    const { call } = setup();
    const f = makeFakePfx();
    for (let i = 0; i < 5; i++) {
      assert.equal((await call('POST', A(), { pfxBase64: f.pfxBase64, password: `errada-${i}` })).status, 422);
    }
    const blocked = await call('POST', A(), { pfxBase64: f.pfxBase64, password: f.password });
    assert.equal(blocked.status, 429);
    assert.equal((blocked.body as Body).code, 'CERT_RATE_LIMITED');
  });

  it('DELETE: apaga blob e senha, mantem historico e auditoria; sem certificado => 404', async () => {
    const { call, store, logs } = setup();
    assert.equal((await call('DELETE', A())).status, 404);
    const f = makeFakePfx();
    assert.equal((await call('POST', A(), { pfxBase64: f.pfxBase64, password: f.password })).status, 201);
    const d = await call('DELETE', A());
    assert.equal(d.status, 200, JSON.stringify(d.body));
    assert.equal((d.body as Body).data!.present, false);
    const rec = (await store.load())!;
    assert.equal(rec.current, null);
    assert.equal(rec.history[0].reason, 'EXCLUIDO');
    assert.ok(!/pfxEnc|passwordEnc/.test(JSON.stringify(rec)));
    assert.equal(logs('ERP_CERT_UPLOADED').length, 1);
    assert.equal(logs('ERP_CERT_DELETED').length, 1);
    assert.equal(((await call('GET', A())).body as Body).data!.present, false);
    assert.equal(await loadCertificateForSigning(store), null);
  });

  it('contexto interno confiavel le metadados; nenhuma rota expoe loadCertificateForSigning', async () => {
    const { router } = setup();
    const r = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'GET', path: '/api/erp/certificate', query: {}, body: {} });
    assert.equal(r.status, 200);
    for (const p of ['/api/erp/certificate/download', '/api/erp/certificate/pfx', '/api/erp/certificate/signing']) {
      const x = await router.dispatch({ method: 'GET', path: p, query: A(), body: {} });
      assert.notEqual(x.status, 200, p);
    }
  });
});
