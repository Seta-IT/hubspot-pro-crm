// ============================================================================
// CISO: validacao criptografica do OIDC do Cloud Scheduler (JWKS injetado).
// ============================================================================
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { describe, it } from 'node:test';
import { isValidCronOidcBearer, resolveCronOidcConfig, type CronOidcDeps } from '../src/app/lib/cron-oidc';
import { isValidCronBearer } from '../src/app/lib/cron-auth';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
const KID = 'test-oidc-kid';
const SA = 'sti-hub-scheduler@test.iam.gserviceaccount.com';
const AUD = 'https://sti-hub.setatelecom.com.br';
const NOW = 1_700_000_000;

function env(partial: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return partial as NodeJS.ProcessEnv;
}

const CFG = env({
  CRON_OIDC_SERVICE_ACCOUNT: SA,
  CRON_OIDC_AUDIENCE: AUD,
});

function b64urlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function signJwt(header: object, payload: object, key: KeyObject = privateKey): string {
  const h = b64urlJson(header);
  const p = b64urlJson(payload);
  const data = `${h}.${p}`;
  const sig = createSign('RSA-SHA256').update(data).end().sign(key);
  return `${data}.${sig.toString('base64url')}`;
}

function payload(over: Record<string, unknown> = {}) {
  return {
    iss: 'https://accounts.google.com',
    aud: AUD,
    email: SA,
    email_verified: true,
    iat: NOW - 10,
    exp: NOW + 3600,
    ...over,
  };
}

const deps: CronOidcDeps = {
  now: () => NOW * 1000,
  fetchJwks: async () => ({ keys: [{ ...jwk, kid: KID, kty: 'RSA', alg: 'RS256', use: 'sig' }] }),
};

describe('OIDC do Cloud Scheduler na rota de cron', () => {
  it('aceita JWT RS256 valido (iss Google, aud, email, email_verified, exp, assinatura)', async () => {
    const token = signJwt({ alg: 'RS256', typ: 'JWT', kid: KID }, payload());
    assert.equal(await isValidCronOidcBearer(`Bearer ${token}`, CFG, deps), true);
    const cfg = resolveCronOidcConfig(CFG);
    assert.deepEqual(cfg, { audience: AUD, serviceAccount: SA });
  });

  it('audience cai para STI_HUB_PUBLIC_ORIGIN quando CRON_OIDC_AUDIENCE falta', async () => {
    const e = env({
      CRON_OIDC_SERVICE_ACCOUNT: SA,
      STI_HUB_PUBLIC_ORIGIN: AUD,
    });
    const token = signJwt({ alg: 'RS256', typ: 'JWT', kid: KID }, payload());
    assert.equal(await isValidCronOidcBearer(`Bearer ${token}`, e, deps), true);
  });

  it('recusa email, aud, iss, exp, email_verified, kid, alg ou assinatura invalidos', async () => {
    const header = { alg: 'RS256', typ: 'JWT', kid: KID };
    const cases: Array<[string, string]> = [
      ['email', signJwt(header, payload({ email: 'outro@test.iam.gserviceaccount.com' }))],
      ['aud', signJwt(header, payload({ aud: 'https://evil.example' }))],
      ['iss', signJwt(header, payload({ iss: 'https://evil.example' }))],
      ['exp', signJwt(header, payload({ exp: NOW - 120 }))],
      ['email_verified', signJwt(header, payload({ email_verified: false }))],
      ['kid', signJwt({ alg: 'RS256', typ: 'JWT', kid: 'outro' }, payload())],
      ['alg', signJwt({ alg: 'HS256', typ: 'JWT', kid: KID }, payload())],
    ];
    for (const [label, token] of cases) {
      assert.equal(await isValidCronOidcBearer(`Bearer ${token}`, CFG, deps), false, label);
    }
    const valid = signJwt(header, payload());
    const parts = valid.split('.');
    const body = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
    body.email = 'outro@test.iam.gserviceaccount.com';
    const forged = `${parts[0]}.${b64urlJson(body)}.${parts[2]}`;
    assert.equal(await isValidCronOidcBearer(`Bearer ${forged}`, CFG, deps), false, 'payload adulterado');
    assert.equal(await isValidCronOidcBearer(`Bearer ${valid}`, env({}), deps), false, 'sem config');
    assert.equal(await isValidCronOidcBearer('Bearer abc', CFG, deps), false, 'nao e jwt');
    assert.equal(
      await isValidCronOidcBearer(`Bearer ${valid}`, CFG, { ...deps, fetchJwks: async () => ({ keys: [] }) }),
      false,
      'jwks vazio'
    );
  });

  it('Bearer CRON_SECRET permanece valido como compatibilidade, independente do OIDC', () => {
    const secret = 'cron-secret-de-teste-com-32-caracteres-xyz';
    assert.equal(isValidCronBearer(`Bearer ${secret}`, secret), true);
    assert.equal(isValidCronBearer(`Bearer ${secret}`, null), false);
  });
});
