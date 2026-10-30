// ============================================================================
// STI-hub — Revisao do 7706b4a: segredo TOTP so do servidor + pareamento no login
// (1) nenhum segredo calculavel pelo cliente e aceito; janela 0; anti-replay
// (2) body.totpSecret nunca e lido/gravado
// (3) QR so depois da senha e so para quem nao pareou (inclusive em instancia fria)
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import {
  computeRfc6238Totp,
  generateTotpSecretBase32 as legacyPublicSaltSecret,
  hashCorporatePassword,
  STIHUB_TOTP_ROTATION_EPOCH,
  verifyMfaCode,
} from '../src/app/lib/auth';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';
import { deriveServerTotpSecret, isTotpPairingPinnedByServer, sealIamRecord } from '../src/db/iam-security';
import { forwardToCrmRouter } from '../src/app/api/_bridge';

const EMAIL = 'marcelo.mira@setatelecom.com.br';
const PASSWORD = 'SenhaPropria#2026';
const HTTP = { _fromHttpBridge: '1' };
const ROOT = process.cwd();
const src = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** Segredos que um cliente/atacante consegue calcular sem o segredo do servidor. */
function clientKnowableSecrets(email: string): Array<[string, string]> {
  const e = email.toLowerCase();
  const guessKey = (k: string) =>
    base32(new Uint8Array(crypto.createHmac('sha256', k).update(`STIHUB-TOTP-V2:${STIHUB_TOTP_ROTATION_EPOCH}:${e}`).digest().subarray(0, 20)));
  return [
    ['legado sha256(salt publico + e-mail) em auth.ts', legacyPublicSaltSecret(e)],
    ['seed estatico de rbac.ts', 'JBSWY3DPEHPK3PXPSETA4369067MARCE'],
    ['segredo de exemplo classico', 'JBSWY3DPEHPK3PXP'],
    ['base32 do proprio e-mail', base32(new TextEncoder().encode(e)).slice(0, 32)],
    ['sha256(e-mail)', base32(new Uint8Array(crypto.createHash('sha256').update(e).digest().subarray(0, 20)))],
    ['HMAC V2 com epoca+e-mail mas chave chutada (vazia)', guessKey('')],
    ['HMAC V2 com epoca+e-mail mas chave chutada (e-mail)', guessKey(e)],
    ['HMAC V2 com epoca+e-mail mas chave chutada (epoca)', guessKey(STIHUB_TOTP_ROTATION_EPOCH)],
  ];
}

/** Evita cruzar a borda da janela de 30s no meio do teste. */
async function safeWindow(): Promise<void> {
  const rem = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (rem < 4) await new Promise((r) => setTimeout(r, rem * 1000 + 300));
}

function freshRouter(opts: { paired?: boolean } = {}) {
  const repo = createInMemoryRepository();
  repo.upsertRbacUser({ email: EMAIL, password: PASSWORD });
  if (opts.paired) {
    repo.upsertRbacUser({ email: EMAIL, totpConfigured: true, totpEpoch: STIHUB_TOTP_ROTATION_EPOCH });
  }
  return { repo, router: new CrmApiRouter(repo) };
}

async function loginStep1(router: CrmApiRouter, body: Record<string, unknown> = {}) {
  const res = await router.dispatch({ method: 'POST', path: '/api/auth/login', query: { ...HTTP }, body: { email: EMAIL, password: PASSWORD, ...body } });
  assert.equal(res.status, 200, 'login etapa 1 com a senha correta');
  return (res.body as { data: { challengeId: string; totpConfigured: boolean; totpPairing?: { totpSecret: string; qrCodeSvgDataUrl: string } } }).data;
}

async function verify(router: CrmApiRouter, challengeId: string, code: string, extra: Record<string, unknown> = {}) {
  return router.dispatch({ method: 'POST', path: '/api/auth/verify-mfa', query: { ...HTTP }, body: { email: EMAIL, challengeId, code, mfaMethod: 'TOTP_AUTHENTICATOR', ...extra } });
}

describe('Revisao 7706b4a (1): so o segredo derivado no servidor e aceito', () => {
  it('nenhum segredo calculavel pelo cliente (e-mail, salt publico, seeds, HMAC com chave chutada) gera codigo aceito', async () => {
    const serverSecret = deriveServerTotpSecret(EMAIL);
    for (const [label, secret] of clientKnowableSecrets(EMAIL)) {
      assert.notEqual(secret, serverSecret, `${label} nao pode coincidir com o segredo do servidor`);
      await safeWindow();
      const { router, repo } = freshRouter();
      const ch = await loginStep1(router);
      const attackerCode = computeRfc6238Totp(secret).code;
      if (attackerCode === computeRfc6238Totp(serverSecret).code) continue; // colisao 1e-6
      const res = await verify(router, ch.challengeId, attackerCode, { totpSecret: secret });
      assert.equal(res.status, 401, `${label}: codigo calculado com segredo do cliente deve dar 401`);
      assert.equal(repo.findRbacUserRecord('usr-seta-01', EMAIL)!.totpSecret, serverSecret, `${label}: segredo da conta inalterado`);
    }
    // controle positivo: o segredo do servidor funciona
    await safeWindow();
    const { router } = freshRouter();
    const ch = await loginStep1(router);
    const ok = await verify(router, ch.challengeId, computeRfc6238Totp(serverSecret).code);
    assert.equal(ok.status, 200);
  });

  it('verifyMfaCode sem segredo explicito falha fechado (nao cai no segredo legado do Marcéllo)', async () => {
    await safeWindow();
    assert.equal(verifyMfaCode(computeRfc6238Totp(legacyPublicSaltSecret(EMAIL)).code), false);
    assert.equal(verifyMfaCode(computeRfc6238Totp(legacyPublicSaltSecret(EMAIL)).code, 'nao-e-base32!'), false);
  });

  it('candidatePairingSecret continua null e a janela de tolerancia e 0 (source)', () => {
    const repoSrc = src('src/db/repository.ts');
    assert.match(repoSrc, /const candidatePairingSecret: string \| null = null;/);
    assert.match(repoSrc, /const userSecret = generateTotpSecretBase32\(user\.email\);/);
    assert.match(repoSrc, /function generateTotpSecretBase32\(seedIdentifier\?: string\): string \{\s*return deriveServerTotpSecret\(/);
    assert.match(repoSrc, /if \(verifyRfc6238Totp\(userSecret, rawCode, nowMs, 0\)\)/);
  });

  it('janela 0: codigo da janela anterior e da proxima => 401; codigo atual => 200; replay do mesmo codigo => 401', async () => {
    const s = deriveServerTotpSecret(EMAIL);
    await safeWindow();
    for (const offset of [-1, +1]) {
      const { router } = freshRouter();
      const ch = await loginStep1(router);
      const code = computeRfc6238Totp(s, Date.now(), offset).code;
      if (code === computeRfc6238Totp(s).code) continue;
      const res = await verify(router, ch.challengeId, code);
      assert.equal(res.status, 401, `janela ${offset} deve ser rejeitada`);
    }
    await safeWindow();
    const { router } = freshRouter();
    const code = computeRfc6238Totp(s).code;
    const ch1 = await loginStep1(router);
    assert.equal((await verify(router, ch1.challengeId, code)).status, 200);
    const ch2 = await loginStep1(router);
    const replay = await verify(router, ch2.challengeId, code);
    assert.equal(replay.status, 401, 'mesmo codigo na mesma janela (anti-replay)');
    assert.match(JSON.stringify(replay.body), /já foi utilizado/);
  });
});

describe('Revisao 7706b4a (2): body.totpSecret nunca e lido nem gravado', () => {
  it('router.ts nao le body.totpSecret; login page nao envia totpSecret no verify-mfa', () => {
    const r = src('src/api/router.ts');
    assert.equal(/body\.totpSecret\b/.test(r.replace(/\/\/.*$/gm, '')), false, 'nenhuma leitura de body.totpSecret');
    assert.equal(/body\[['"]totpSecret['"]\]/.test(r), false);
    const page = src('src/app/login/page.tsx');
    const verifyCall = page.slice(page.indexOf("fetch('/api/auth/verify-mfa'"), page.indexOf("fetch('/api/auth/verify-mfa'") + 900);
    assert.equal(/totpSecret/.test(verifyCall), false, 'verify-mfa sem totpSecret no corpo');
  });

  it('verify-mfa com totpSecret do atacante + codigo dele => 401 e segredo da conta inalterado', async () => {
    const attacker = 'KRSXG5CTMVRXEZLUKN2XAZLSKNSWG4TF';
    await safeWindow();
    const { router, repo } = freshRouter();
    const ch = await loginStep1(router);
    const res = await verify(router, ch.challengeId, computeRfc6238Totp(attacker).code, { totpSecret: attacker, totpSecretFormatted: attacker });
    assert.equal(res.status, 401);
    const rec = repo.findRbacUserRecord('usr-seta-01', EMAIL)!;
    assert.equal(rec.totpSecret, deriveServerTotpSecret(EMAIL));
    assert.notEqual(rec.totpConfigured, true, 'tentativa falha nao marca pareamento');
    // e o codigo verdadeiro continua valendo no mesmo desafio
    const ok = await verify(router, ch.challengeId, computeRfc6238Totp(deriveServerTotpSecret(EMAIL)).code, { totpSecret: attacker });
    assert.equal(ok.status, 200);
    assert.equal(repo.findRbacUserRecord('usr-seta-01', EMAIL)!.totpSecret, deriveServerTotpSecret(EMAIL), 'sucesso grava o segredo do servidor, nao o do corpo');
  });

  it('setup-totp com totpSecret no corpo devolve/grava o segredo do servidor', async () => {
    const attacker = 'KRSXG5CTMVRXEZLUKN2XAZLSKNSWG4TF';
    const { router, repo } = freshRouter();
    const ch = await loginStep1(router);
    const res = await router.dispatch({ method: 'POST', path: '/api/auth/setup-totp', query: { ...HTTP }, body: { email: EMAIL, challengeId: ch.challengeId, totpSecret: attacker } });
    assert.equal(res.status, 200);
    assert.equal((res.body as { data: { totpSecret: string } }).data.totpSecret, deriveServerTotpSecret(EMAIL));
    assert.equal(repo.findRbacUserRecord('usr-seta-01', EMAIL)!.totpSecret, deriveServerTotpSecret(EMAIL));
  });

  it('PUT/POST de usuario (admin) com totpSecret no corpo nao altera o segredo', async () => {
    const attacker = 'KRSXG5CTMVRXEZLUKN2XAZLSKNSWG4TF';
    const { repo } = freshRouter();
    const router = new CrmApiRouter(repo);
    const { signStiHubSessionToken } = await import('../src/app/lib/auth');
    const admin = signStiHubSessionToken({
      uid: 'usr-seta-01', email: EMAIL, name: 'Marcelo Lopes Mira', roleId: 'SUPER_ADMIN', scope: 'TODOS',
      enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
      mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now(), exp: Date.now() + 60_000,
    });
    const put = await router.dispatch({ method: 'PUT', path: '/api/admin/users/usr-seta-01', query: { ...HTTP, _sessionToken: admin }, body: { totpSecret: attacker, totpSecretFormatted: attacker, lastUsedTotpTimeStep: 1 } });
    assert.equal(put.status, 200);
    assert.equal(repo.findRbacUserRecord('usr-seta-01', EMAIL)!.totpSecret, deriveServerTotpSecret(EMAIL));
    const post = await router.dispatch({ method: 'POST', path: '/api/admin/users', query: { ...HTTP, _sessionToken: admin }, body: { email: 'teste.totp@setatelecom.com.br', name: 'Teste', roleId: 'VENDEDOR_SALES', totpSecret: attacker } });
    assert.equal(post.status, 201);
    const created = repo.findRbacUserRecord('', 'teste.totp@setatelecom.com.br')!;
    assert.equal(created.totpSecret, deriveServerTotpSecret('teste.totp@setatelecom.com.br'));
  });
});

describe('Revisao 7706b4a (3): QR so apos a senha e so para quem nao pareou', () => {
  it('sem senha valida nao sai pareamento (login 401; setup-totp anonimo 401 via bridge)', async () => {
    const { router } = freshRouter();
    const bad = await router.dispatch({ method: 'POST', path: '/api/auth/login', query: { ...HTTP }, body: { email: EMAIL, password: 'errada#123' } });
    assert.equal(bad.status, 401);
    assert.equal(/totpPairing|qrCodeSvgDataUrl|otpauth/.test(JSON.stringify(bad.body)), false);
    const viaBridge = await forwardToCrmRouter(new NextRequest('https://sti-hub.vercel.app/api/auth/setup-totp', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, totpSecret: 'KRSXG5CTMVRXEZLUKN2XAZLSKNSWG4TF' }),
    }));
    assert.ok([401, 403].includes(viaBridge.status), `setup-totp sem senha => ${viaBridge.status}`);
    const txt = await viaBridge.text();
    assert.equal(/qrCodeSvgDataUrl|otpauth|"totpSecret"/.test(txt), false);
  });

  it('ja pareado (selo IAM): login sem QR/segredo; setup-totp com o desafio da senha => 403; regenerate => 403', async () => {
    const repo0 = createInMemoryRepository();
    const rec = repo0.findRbacUserRecord('usr-seta-01', EMAIL)!;
    const seal = sealIamRecord({ ...rec, passwordHash: hashCorporatePassword(PASSWORD), totpConfigured: true, totpEpoch: STIHUB_TOTP_ROTATION_EPOCH } as typeof rec)!;
    const router = new CrmApiRouter(createInMemoryRepository());
    const ld = await loginStep1(router, { iamUsersOverride: [{ iamSeal: seal }] });
    assert.equal(ld.totpConfigured, true);
    assert.equal(ld.totpPairing, undefined);
    assert.equal(/qrCodeSvgDataUrl|otpauth|"totpSecret"/.test(JSON.stringify(ld)), false);
    for (const extra of [{}, { regenerate: true }]) {
      const r = await router.dispatch({ method: 'POST', path: '/api/auth/setup-totp', query: { ...HTTP }, body: { email: EMAIL, challengeId: ld.challengeId, ...extra } });
      assert.equal(r.status, 403, JSON.stringify(extra));
    }
  });

  it('instancia fria + STI_HUB_TOTP_PAIRED_EMAILS: quem pareou nunca ve QR (so com a senha); sem a env, inerte', async () => {
    const prev = process.env.STI_HUB_TOTP_PAIRED_EMAILS;
    try {
      delete process.env.STI_HUB_TOTP_PAIRED_EMAILS;
      assert.equal(isTotpPairingPinnedByServer(EMAIL), false);
      const cold = await loginStep1(freshRouter().router);
      assert.equal(cold.totpConfigured, false, 'sem a env o comportamento atual e preservado');

      process.env.STI_HUB_TOTP_PAIRED_EMAILS = ` outra@x.com , ${EMAIL.toUpperCase()} `;
      assert.equal(isTotpPairingPinnedByServer(EMAIL), true);
      const { router, repo } = freshRouter();
      const ld = await loginStep1(router);
      assert.equal(ld.totpConfigured, true);
      assert.equal(ld.totpPairing, undefined, 'instancia fria nao devolve QR para quem ja pareou');
      for (const extra of [{}, { regenerate: true }]) {
        const r = await router.dispatch({ method: 'POST', path: '/api/auth/setup-totp', query: { ...HTTP }, body: { email: EMAIL, challengeId: ld.challengeId, ...extra } });
        assert.equal(r.status, 403);
      }
      assert.equal(repo.findRbacUserRecord('usr-seta-01', EMAIL)!.totpConfigured, true);
      // o login continua funcionando com o autenticador ja pareado
      await safeWindow();
      const ld2 = await loginStep1(router);
      const ok = await verify(router, ld2.challengeId, computeRfc6238Totp(deriveServerTotpSecret(EMAIL)).code);
      assert.equal(ok.status, 200);
    } finally {
      if (prev === undefined) delete process.env.STI_HUB_TOTP_PAIRED_EMAILS;
      else process.env.STI_HUB_TOTP_PAIRED_EMAILS = prev;
    }
  });

  it('nao pareado: QR so na resposta do login com senha (etapa 2); setup-totp com o desafio => 200', async () => {
    const { router } = freshRouter();
    const ld = await loginStep1(router);
    assert.equal(ld.totpConfigured, false);
    assert.ok(ld.totpPairing?.qrCodeSvgDataUrl?.startsWith('data:image/svg+xml'));
    const r = await router.dispatch({ method: 'POST', path: '/api/auth/setup-totp', query: { ...HTTP }, body: { email: EMAIL, challengeId: ld.challengeId } });
    assert.equal(r.status, 200);
  });

  it('login page: etapa inicial nao pede pareamento; QR so com totpConfigured === false na etapa 2FA', () => {
    const page = src('src/app/login/page.tsx');
    assert.equal(/useState\(true\)/.test(page), false, 'nenhum estado de QR iniciando visivel');
    const credStart = page.indexOf('const handleCredentialsSubmit');
    const credEnd = page.indexOf('const handleLoadFirstTimeTotpQrIfNeeded');
    assert.ok(credStart > 0 && credEnd > credStart);
    const cred = page.slice(credStart, credEnd);
    assert.equal(/setup-totp/.test(cred), false, 'etapa de senha so chama /api/auth/login');
    const loader = page.slice(credEnd, page.indexOf('const handleSendOrResendEmailOtp'));
    assert.match(loader, /step !== 'MFA_2FA' \|\| !challengeData\?\.challengeId/);
    assert.match(loader, /challengeData\.totpConfigured !== false/);
    assert.match(page, /const shouldShowTotpPairing = Boolean\(\s*step === 'MFA_2FA' &&\s*challengeData\?\.challengeId &&\s*challengeData\?\.totpConfigured === false &&\s*challengeData\?\.totpPairing/);
    assert.match(page, /shouldShowTotpPairing && challengeData\?\.totpPairing && \(/);
    // mount: so o GET do convite (sem pareamento), nada de setup-totp
    const mount = page.slice(page.indexOf('// Detect ?invite='), credStart);
    assert.equal(/setup-totp/.test(mount), false);
  });
});

describe('Revisao 7706b4a: sem fallback de segredo em generateTotpCodeSync/computeCurrentTotpCode', () => {
  it('sem segredo valido nao gera codigo (nada de segredo legado do Marcéllo)', async () => {
    const { generateTotpCodeSync, computeCurrentTotpCode } = await import('../src/app/lib/auth');
    assert.equal(generateTotpCodeSync(), '');
    assert.equal(generateTotpCodeSync('nao-base32!'), '');
    assert.equal(computeCurrentTotpCode().code, '');
    const s = deriveServerTotpSecret(EMAIL);
    assert.equal(generateTotpCodeSync(s).length, 6);
    const src2 = src('src/app/lib/auth.ts');
    assert.equal(/generateTotpSecretBase32\('marcelo\.mira@setatelecom\.com\.br'\)/.test(src2), false, 'nenhum fallback fixo no e-mail do Marcéllo');
  });
});

describe('Revisao 7706b4a: step-up MFA da sessao (Minha Conta)', () => {
  async function adminSession(repo: ReturnType<typeof createInMemoryRepository>) {
    const { signStiHubSessionToken } = await import('../src/app/lib/auth');
    void repo;
    return signStiHubSessionToken({
      uid: 'usr-seta-01', email: EMAIL, name: 'Marcelo Lopes Mira', roleId: 'SUPER_ADMIN', scope: 'TODOS',
      enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
      mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now(), exp: Date.now() + 120_000,
    });
  }
  const NO_SECRETS = /"(totpSecret|otpCode|devOtpPreview|demoTotpCode|currentTotpCode|emailOtpHash|qrCodeSvgDataUrl|otpauthUri)"/;

  it('sem sessao => 401; desafio ligado ao usuario da SESSAO; id de outro no corpo => 403; resposta sem codigo/segredo', async () => {
    const { router } = freshRouter({ paired: true });
    const anon = await router.dispatch({ method: 'POST', path: '/api/auth/step-up/start', query: { ...HTTP }, body: { userId: 'usr-seta-01' } });
    assert.equal(anon.status, 401);
    const anonV = await router.dispatch({ method: 'POST', path: '/api/auth/step-up/verify', query: { ...HTTP }, body: { code: '123456' } });
    assert.equal(anonV.status, 401);
    const t = await adminSession(createInMemoryRepository());
    const other = await router.dispatch({ method: 'POST', path: '/api/auth/step-up/start', query: { ...HTTP, _sessionToken: t }, body: { userId: 'usr-seta-02' } });
    assert.equal(other.status, 403);
    const st = await router.dispatch({ method: 'POST', path: '/api/auth/step-up/start', query: { ...HTTP, _sessionToken: t }, body: {} });
    assert.equal(st.status, 200);
    assert.equal(NO_SECRETS.test(JSON.stringify(st.body)), false);
    const cid = (st.body as { data: { challengeId: string } }).data.challengeId;
    const payload = JSON.parse(Buffer.from(cid.slice(4).split('.')[0], 'base64url').toString());
    assert.equal(payload.uid, 'usr-seta-01');
    assert.match(payload.cid, /^STEPUP-/);
  });

  it('verify: codigo do servidor => 200 + novo cookie com mfaStepUpAt; desafio de step-up nao serve como login; desafio de outro usuario => 401', async () => {
    const { verifyStiHubSessionToken } = await import('../src/app/lib/auth');
    const { router } = freshRouter({ paired: true });
    const t = await adminSession(createInMemoryRepository());
    const q = { ...HTTP, _sessionToken: t };
    const st = await router.dispatch({ method: 'POST', path: '/api/auth/step-up/start', query: q, body: {} });
    const cid = (st.body as { data: { challengeId: string } }).data.challengeId;
    const asLogin = await verify(router, cid, computeRfc6238Totp(deriveServerTotpSecret(EMAIL)).code);
    assert.equal(asLogin.status, 401, 'desafio STEPUP nao substitui a senha no /api/auth/verify-mfa');
    const bad = await router.dispatch({ method: 'POST', path: '/api/auth/step-up/verify', query: q, body: { challengeId: cid, code: computeRfc6238Totp('KRSXG5CTMVRXEZLUKN2XAZLSKNSWG4TF').code } });
    assert.equal(bad.status, 401);
    await safeWindow();
    const ok = await router.dispatch({ method: 'POST', path: '/api/auth/step-up/verify', query: q, body: { challengeId: cid, code: computeRfc6238Totp(deriveServerTotpSecret(EMAIL)).code } });
    assert.equal(ok.status, 200);
    assert.equal(NO_SECRETS.test(JSON.stringify(ok.body)), false);
    const newTok = (ok.body as { data: { sessionToken: string } }).data.sessionToken;
    assert.ok(Number(verifyStiHubSessionToken(newTok).claims?.mfaStepUpAt) > 0);
    assert.match(String(ok.headers?.['Set-Cookie'] || ''), /stihub_session=.*HttpOnly/);

    // desafio de outro usuario (login de usr-seta-02) nao vale no step-up de usr-seta-01
    const { router: r2 } = freshRouter();
    const ch2 = await loginStep1(r2);
    const foreign = await r2.dispatch({ method: 'POST', path: '/api/auth/step-up/verify', query: { ...HTTP, _sessionToken: await (async () => {
      const { signStiHubSessionToken } = await import('../src/app/lib/auth');
      return signStiHubSessionToken({ uid: 'usr-seta-02', email: 'evelyn.santos@setatelecom.com.br', name: 'X', roleId: 'VENDEDOR_SALES', scope: 'PROPRIOS', enabledModules: ['CRM'], moduleAccess: { crm: true, erp: false, chamados: false }, mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now(), exp: Date.now() + 60_000 });
    })() }, body: { challengeId: ch2.challengeId, code: '000000' } });
    assert.equal(foreign.status, 401);
  });

  it('setup-totp do proprio usuario JA pareado: 403 sem step-up; 200 com step-up recente', async () => {
    const { router } = freshRouter({ paired: true });
    const t = await adminSession(createInMemoryRepository());
    const q = { ...HTTP, _sessionToken: t };
    const no = await router.dispatch({ method: 'POST', path: '/api/auth/setup-totp', query: q, body: { email: EMAIL } });
    assert.equal(no.status, 403);
    assert.equal(NO_SECRETS.test(JSON.stringify(no.body)), false);
    const st = await router.dispatch({ method: 'POST', path: '/api/auth/step-up/start', query: q, body: {} });
    await safeWindow();
    const ok = await router.dispatch({ method: 'POST', path: '/api/auth/step-up/verify', query: q, body: { challengeId: (st.body as { data: { challengeId: string } }).data.challengeId, code: computeRfc6238Totp(deriveServerTotpSecret(EMAIL)).code } });
    assert.equal(ok.status, 200);
    const fresh = (ok.body as { data: { sessionToken: string } }).data.sessionToken;
    const yes = await router.dispatch({ method: 'POST', path: '/api/auth/setup-totp', query: { ...HTTP, _sessionToken: fresh }, body: { email: EMAIL } });
    assert.equal(yes.status, 200);
  });

  it('rate limit: 6o desafio em 10 min => 429', async () => {
    const { router } = freshRouter({ paired: true });
    const t = await adminSession(createInMemoryRepository());
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await router.dispatch({ method: 'POST', path: '/api/auth/step-up/start', query: { ...HTTP, _sessionToken: t }, body: {} })).status);
    }
    assert.deepEqual(statuses.slice(0, 5), [200, 200, 200, 200, 200]);
    assert.equal(statuses[5], 429);
  });

  it('UserAccountModal usa o step-up (nao chama verify-mfa/send-email-otp sem desafio) e nao carrega QR de quem ja pareou', () => {
    const m = src('src/app/components/UserAccountModal.tsx');
    assert.equal(m.includes("fetch('/api/auth/verify-mfa'"), false);
    assert.equal(m.includes("fetch('/api/auth/send-email-otp'"), false);
    assert.ok(m.includes("fetch('/api/auth/step-up/start'") && m.includes("fetch('/api/auth/step-up/verify'"));
    assert.match(m, /if \(user\.totpConfigured === false\) \{\s*loadTotpPairing\(false\);/);
    assert.equal(/totpSecret:\s*(totpPairing|challengeData)/.test(m.slice(m.indexOf('step-up/verify'), m.indexOf('step-up/verify') + 400)), false);
  });
});
