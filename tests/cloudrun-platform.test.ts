// ============================================================================
// Preparacao Cloud Run: flags de plataforma, IP confiavel (XFF forjado),
// CORS por STI_HUB_PUBLIC_ORIGIN e autenticacao dos crons.
// ============================================================================
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clientIpFromForwardedFor, resolveTrustedClientIp } from '../src/api/client-ip';
import { isValidCronBearer, resolveCronSecret } from '../src/app/lib/cron-auth';
import { createCrmHttpServer } from '../src/api/server';
import { buildClearSessionCookie, buildSessionCookie } from '../src/api/router';
import {
  allowedCorsOrigins,
  corsAllowOrigin,
  isProductionRuntime,
  isSecretProductionRuntime,
  parseHttpOrigin,
  resolveConfiguredPublicOrigin,
  resolveTrustedProxyHops,
  resolveTrustedProxyMode,
  useSecureCookies,
  usesEphemeralFilesystem,
} from '../src/lib/platform';

function headers(map: Record<string, string>): { get(name: string): string | null } {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name) => lower[name.toLowerCase()] ?? null };
}

function env(partial: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return partial as NodeJS.ProcessEnv;
}

describe('Flags neutras de plataforma', () => {
  it('producao: NODE_ENV, VERCEL=1, VERCEL_ENV e Cloud Run (K_SERVICE / TRUSTED_PROXY_MODE)', () => {
    assert.equal(isProductionRuntime(env({})), false);
    assert.equal(isProductionRuntime(env({ NODE_ENV: 'test' })), false);
    assert.equal(isProductionRuntime(env({ NODE_ENV: 'production' })), true);
    assert.equal(isProductionRuntime(env({ VERCEL: '1' })), true);
    assert.equal(isProductionRuntime(env({ VERCEL_ENV: 'preview' })), true);
    assert.equal(isProductionRuntime(env({ VERCEL_ENV: 'production' })), true);
    assert.equal(isProductionRuntime(env({ K_SERVICE: 'sti-hub' })), true);
    assert.equal(isProductionRuntime(env({ TRUSTED_PROXY_MODE: 'cloudrun' })), true);
  });

  it('SECURE_COOKIES: default seguro em producao; VERCEL=1 compativel; override explicito', () => {
    assert.equal(useSecureCookies(env({})), false);
    assert.equal(useSecureCookies(env({ NODE_ENV: 'test' })), false);
    assert.equal(useSecureCookies(env({ NODE_ENV: 'production' })), true);
    assert.equal(useSecureCookies(env({ VERCEL: '1' })), true);
    assert.equal(useSecureCookies(env({ K_SERVICE: 'sti-hub' })), true);
    assert.equal(useSecureCookies(env({ SECURE_COOKIES: '1', NODE_ENV: 'test' })), true);
    assert.equal(useSecureCookies(env({ SECURE_COOKIES: '0', NODE_ENV: 'production' })), false);
    assert.equal(useSecureCookies(env({ SECURE_COOKIES: 'false', VERCEL: '1' })), false);
  });

  it('cookie de sessao respeita SECURE_COOKIES e permanece compativel com VERCEL=1', () => {
    const prev = { v: process.env.VERCEL, s: process.env.SECURE_COOKIES, k: process.env.K_SERVICE, m: process.env.TRUSTED_PROXY_MODE };
    try {
      delete process.env.VERCEL;
      delete process.env.K_SERVICE;
      delete process.env.TRUSTED_PROXY_MODE;
      process.env.SECURE_COOKIES = '0';
      assert.doesNotMatch(buildSessionCookie('tok'), /;\s*Secure/);
      process.env.SECURE_COOKIES = '1';
      assert.match(buildSessionCookie('tok'), /;\s*Secure/);
      assert.match(buildClearSessionCookie(), /;\s*Secure/);
      delete process.env.SECURE_COOKIES;
      process.env.VERCEL = '1';
      assert.match(buildSessionCookie('tok'), /;\s*Secure/);
    } finally {
      if (prev.v === undefined) delete process.env.VERCEL; else process.env.VERCEL = prev.v;
      if (prev.s === undefined) delete process.env.SECURE_COOKIES; else process.env.SECURE_COOKIES = prev.s;
      if (prev.k === undefined) delete process.env.K_SERVICE; else process.env.K_SERVICE = prev.k;
      if (prev.m === undefined) delete process.env.TRUSTED_PROXY_MODE; else process.env.TRUSTED_PROXY_MODE = prev.m;
    }
  });

  it('TRUSTED_PROXY_MODE: explicito, VERCEL=1 => vercel, K_SERVICE => cloudrun, senao none', () => {
    assert.equal(resolveTrustedProxyMode(env({})), 'none');
    assert.equal(resolveTrustedProxyMode(env({ VERCEL: '1' })), 'vercel');
    assert.equal(resolveTrustedProxyMode(env({ K_SERVICE: 'sti-hub' })), 'cloudrun');
    assert.equal(resolveTrustedProxyMode(env({ TRUSTED_PROXY_MODE: 'none', VERCEL: '1' })), 'none');
    assert.equal(resolveTrustedProxyMode(env({ TRUSTED_PROXY_MODE: 'cloudrun' })), 'cloudrun');
    assert.equal(resolveTrustedProxyHops(env({})), 1);
    assert.equal(resolveTrustedProxyHops(env({ TRUSTED_PROXY_HOPS: '2' })), 2);
    assert.equal(resolveTrustedProxyHops(env({ TRUSTED_PROXY_HOPS: '0' })), 1);
    assert.equal(resolveTrustedProxyHops(env({ TRUSTED_PROXY_HOPS: '99' })), 1);
  });

  it('filesystem efemero em Vercel e Cloud Run; segredo de dev nao vale no Cloud Run', () => {
    assert.equal(usesEphemeralFilesystem(env({})), false);
    assert.equal(usesEphemeralFilesystem(env({ VERCEL: '1' })), true);
    assert.equal(usesEphemeralFilesystem(env({ K_SERVICE: 'sti-hub' })), true);
    assert.equal(isSecretProductionRuntime(env({ NODE_ENV: 'production', STI_HUB_ALLOW_DEV_SECRET: 'true' })), false);
    assert.equal(isSecretProductionRuntime(env({ VERCEL_ENV: 'preview', STI_HUB_ALLOW_DEV_SECRET: 'true' })), true);
    assert.equal(isSecretProductionRuntime(env({ K_SERVICE: 'sti-hub', STI_HUB_ALLOW_DEV_SECRET: 'true' })), true);
  });
});

describe('IP confiavel (X-Forwarded-For forjado)', () => {
  it('cloudrun: conta a partir da direita; a primeira entrada (cliente) nunca vence', () => {
    const prev = { m: process.env.TRUSTED_PROXY_MODE, h: process.env.TRUSTED_PROXY_HOPS, v: process.env.VERCEL, k: process.env.K_SERVICE };
    try {
      delete process.env.VERCEL;
      delete process.env.K_SERVICE;
      process.env.TRUSTED_PROXY_MODE = 'cloudrun';
      process.env.TRUSTED_PROXY_HOPS = '1';
      // Cliente forja 8.8.8.8; o GFE acrescenta 203.0.113.10 no final.
      assert.equal(
        resolveTrustedClientIp(headers({ 'x-forwarded-for': '8.8.8.8, 203.0.113.10' })),
        '203.0.113.10'
      );
      // Sem forja: so o IP que o GFE anexou.
      assert.equal(resolveTrustedClientIp(headers({ 'x-forwarded-for': '203.0.113.10' })), '203.0.113.10');
      // Nunca confia em X-Real-IP nem em x-vercel-forwarded-for no modo Cloud Run.
      assert.equal(
        resolveTrustedClientIp(headers({ 'x-real-ip': '8.8.8.8', 'x-vercel-forwarded-for': '1.1.1.1', 'x-forwarded-for': '8.8.8.8, 203.0.113.9' })),
        '203.0.113.9'
      );
      assert.equal(resolveTrustedClientIp(headers({ 'x-real-ip': '8.8.8.8' })), undefined);
      // hops=2: segunda a partir da direita; hops demais => fail-closed (nao recua para a primeira).
      process.env.TRUSTED_PROXY_HOPS = '2';
      assert.equal(
        resolveTrustedClientIp(headers({ 'x-forwarded-for': '8.8.8.8, 198.51.100.4, 203.0.113.10' })),
        '198.51.100.4'
      );
      assert.equal(resolveTrustedClientIp(headers({ 'x-forwarded-for': '203.0.113.10' })), undefined);
    } finally {
      if (prev.m === undefined) delete process.env.TRUSTED_PROXY_MODE; else process.env.TRUSTED_PROXY_MODE = prev.m;
      if (prev.h === undefined) delete process.env.TRUSTED_PROXY_HOPS; else process.env.TRUSTED_PROXY_HOPS = prev.h;
      if (prev.v === undefined) delete process.env.VERCEL; else process.env.VERCEL = prev.v;
      if (prev.k === undefined) delete process.env.K_SERVICE; else process.env.K_SERVICE = prev.k;
    }
  });

  it('clientIpFromForwardedFor: direita, hops invalidos ou insuficientes => undefined', () => {
    assert.equal(clientIpFromForwardedFor('a, b, 203.0.113.10', 1), '203.0.113.10');
    assert.equal(clientIpFromForwardedFor('198.51.100.4, 203.0.113.10', 2), '198.51.100.4');
    assert.equal(clientIpFromForwardedFor('198.51.100.4, 203.0.113.10', 3), undefined);
    assert.equal(clientIpFromForwardedFor('8.8.8.8', 1), '8.8.8.8');
    assert.equal(clientIpFromForwardedFor('', 1), undefined);
    assert.equal(clientIpFromForwardedFor('1.2.3.4', 0), undefined);
    assert.equal(clientIpFromForwardedFor('<script>', 1), undefined);
  });

  it('vercel: x-vercel-forwarded-for > x-real-ip; XFF (mesmo forjado) e ignorado', () => {
    assert.equal(
      resolveTrustedClientIp(headers({ 'x-vercel-forwarded-for': '203.0.113.9', 'x-forwarded-for': '8.8.8.8' }), 'vercel'),
      '203.0.113.9'
    );
    assert.equal(
      resolveTrustedClientIp(headers({ 'x-real-ip': '203.0.113.10', 'x-forwarded-for': '8.8.8.8' }), 'vercel'),
      '203.0.113.10'
    );
    assert.equal(resolveTrustedClientIp(headers({ 'x-forwarded-for': '8.8.8.8' }), 'vercel'), undefined);
    // alias booleano dos testes antigos
    assert.equal(resolveTrustedClientIp(headers({ 'x-forwarded-for': '8.8.8.8' }), true), undefined);
  });

  it('none: ignora XFF e X-Real-IP (fail-closed)', () => {
    assert.equal(resolveTrustedClientIp(headers({ 'x-forwarded-for': '8.8.8.8, 1.1.1.1', 'x-real-ip': '9.9.9.9' }), 'none'), undefined);
    assert.equal(resolveTrustedClientIp(headers({ 'x-forwarded-for': '8.8.8.8' }), false), undefined);
  });
});

describe('CORS e STI_HUB_PUBLIC_ORIGIN', () => {
  it('valida https em producao; http so fora de producao; sem env => null', () => {
    assert.equal(parseHttpOrigin(' https://sti-hub.setatelecom.com.br/caminho?x=1#y '), 'https://sti-hub.setatelecom.com.br');
    assert.equal(parseHttpOrigin('javascript:alert(1)'), null);
    assert.equal(parseHttpOrigin('https://user:pw@evil.example'), null);
    assert.equal(resolveConfiguredPublicOrigin(env({ NODE_ENV: 'production' })), null);
    assert.equal(resolveConfiguredPublicOrigin(env({ NODE_ENV: 'production', STI_HUB_PUBLIC_ORIGIN: 'http://inseguro.example' })), null);
    assert.equal(
      resolveConfiguredPublicOrigin(env({ NODE_ENV: 'production', STI_HUB_PUBLIC_ORIGIN: 'https://sti-hub.setatelecom.com.br/' })),
      'https://sti-hub.setatelecom.com.br'
    );
    assert.equal(resolveConfiguredPublicOrigin(env({ NODE_ENV: 'test', STI_HUB_PUBLIC_ORIGIN: 'http://localhost:3000' })), 'http://localhost:3000');
  });

  it('sem STI_HUB_PUBLIC_ORIGIN em producao a allowlist fica vazia (falha fechada, sem curinga)', () => {
    const prod = env({ NODE_ENV: 'production' });
    assert.equal(allowedCorsOrigins(prod).size, 0);
    assert.equal(corsAllowOrigin('https://evil.example', prod), undefined);
    assert.equal(corsAllowOrigin('https://sti-hub.vercel.app', prod), undefined);
    assert.equal(corsAllowOrigin('http://localhost:3000', prod), undefined);
    const ok = env({ NODE_ENV: 'production', STI_HUB_PUBLIC_ORIGIN: 'https://sti-hub.setatelecom.com.br' });
    assert.equal(corsAllowOrigin('https://sti-hub.setatelecom.com.br', ok), 'https://sti-hub.setatelecom.com.br');
    assert.equal(corsAllowOrigin('https://stihub.setatelecom.com.br', ok), undefined);
    const dev = env({ NODE_ENV: 'test' });
    assert.equal(corsAllowOrigin('http://localhost:3000', dev), 'http://localhost:3000');
    assert.equal(corsAllowOrigin('https://evil.example', dev), undefined);
  });

  it('servidor HTTP: so ecoa Origin quando ela esta na allowlist; nunca vercel.app nem *', async () => {
    const prev = process.env.STI_HUB_PUBLIC_ORIGIN;
    const server = createCrmHttpServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const hit = async (origin: string) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { method: 'OPTIONS', headers: { Origin: origin } });
      return { status: res.status, acao: res.headers.get('access-control-allow-origin') };
    };
    try {
      delete process.env.STI_HUB_PUBLIC_ORIGIN;
      const denied = await hit('https://sti-hub.vercel.app');
      assert.equal(denied.acao, null);
      process.env.STI_HUB_PUBLIC_ORIGIN = 'https://sti-hub.setatelecom.com.br';
      const allowed = await hit('https://sti-hub.setatelecom.com.br');
      assert.equal(allowed.status, 204);
      assert.equal(allowed.acao, 'https://sti-hub.setatelecom.com.br');
      const other = await hit('https://evil.example');
      assert.equal(other.acao, null);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      if (prev === undefined) delete process.env.STI_HUB_PUBLIC_ORIGIN; else process.env.STI_HUB_PUBLIC_ORIGIN = prev;
    }
  });
});

describe('Autenticacao dos crons (Bearer CRON_SECRET)', () => {
  const SECRET = 'cron-secret-de-teste-com-32-caracteres-xyz';

  it('so aceita Bearer exato; ausente ou curto => nada autoriza (fail-closed)', () => {
    assert.equal(isValidCronBearer(`Bearer ${SECRET}`, SECRET), true);
    assert.equal(isValidCronBearer(`Bearer ${SECRET} `, SECRET), false);
    assert.equal(isValidCronBearer(SECRET, SECRET), false);
    assert.equal(isValidCronBearer(`Bearer ${SECRET}`, null), false);
    assert.equal(isValidCronBearer(`Bearer ${SECRET}`, ''), false);
    assert.equal(resolveCronSecret(env({ CRON_SECRET: undefined })), null);
    assert.equal(resolveCronSecret(env({ CRON_SECRET: 'curto-demais' })), null);
    assert.equal(resolveCronSecret(env({ CRON_SECRET: `  ${SECRET}  ` })), SECRET);
  });
});

