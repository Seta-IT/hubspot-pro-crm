// ============================================================================
// CISO: trava de origem (Worker), HSTS e hops=2 no Cloud Run.
// Testes via helpers com env injetado — nao mutam process.env (suite paralela).
// ============================================================================
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { NextResponse } from 'next/server';
import { applyBaseSecurityHeaders } from '../src/middleware';
import {
  evaluateOriginLock,
  isOriginLockEngaged,
  ORIGIN_AUTH_HEADER,
} from '../src/app/lib/origin-lock';
import { clientIpFromForwardedFor, resolveTrustedClientIp } from '../src/api/client-ip';
import { resolveTrustedProxyHops } from '../src/lib/platform';

function env(partial: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return partial as NodeJS.ProcessEnv;
}

function headers(map: Record<string, string>): { get(name: string): string | null } {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name) => lower[name.toLowerCase()] ?? null };
}

const SECRET = 'origin-shared-secret-de-teste-32ch';
const CLOUD = env({
  K_SERVICE: 'sti-hub',
  STI_HUB_ORIGIN_SHARED_SECRET: SECRET,
});
const JWT = 'Bearer aaa.bbb.ccc';
const OIDC = env({
  K_SERVICE: 'sti-hub',
  STI_HUB_ORIGIN_SHARED_SECRET: SECRET,
  CRON_OIDC_SERVICE_ACCOUNT: 'sti-hub-scheduler@test.iam.gserviceaccount.com',
  CRON_OIDC_AUDIENCE: 'https://sti-hub.setatelecom.com.br',
});

describe('Trava de origem no Cloud Run (X-STI-Origin-Auth)', () => {
  it('fora do Cloud Run a trava fica desligada', () => {
    assert.equal(isOriginLockEngaged(env({})), false);
    const r = evaluateOriginLock({ pathname: '/login', env: env({}) });
    assert.equal(r.allowed, true);
    assert.equal(r.code, 'ORIGIN_LOCK_OFF');
  });

  it('sem cabecalho em Cloud Run => 403', () => {
    const r = evaluateOriginLock({ pathname: '/login', method: 'GET', env: CLOUD, headers: headers({}) });
    assert.equal(r.allowed, false);
    assert.equal(r.status, 403);
    assert.equal(r.code, 'ORIGIN_AUTH_FORBIDDEN');
  });

  it('cabecalho errado => 403', () => {
    const r = evaluateOriginLock({
      pathname: '/api/health',
      env: CLOUD,
      headers: headers({ [ORIGIN_AUTH_HEADER]: 'valor-errado-com-16ch+' }),
    });
    assert.equal(r.allowed, false);
    assert.equal(r.status, 403);
    assert.equal(r.code, 'ORIGIN_AUTH_FORBIDDEN');
  });

  it('cabecalho certo => libera', () => {
    const r = evaluateOriginLock({
      pathname: '/login',
      env: CLOUD,
      headers: headers({ 'X-STI-Origin-Auth': SECRET }),
    });
    assert.equal(r.allowed, true);
    assert.equal(r.code, 'ORIGIN_AUTH_OK');
  });

  it('cron com OIDC (JWT) sem cabecalho de origem => libera a trava', () => {
    for (const path of ['/api/cron/sequences', '/api/erp/daily-sync', '/api/crm/proposal-followup', '/api/tickets/email-intake/poll']) {
      const r = evaluateOriginLock({ pathname: path, method: 'GET', authorization: JWT, env: OIDC });
      assert.equal(r.allowed, true, path);
      assert.equal(r.code, 'ORIGIN_AUTH_BYPASS', path);
    }
    // Bearer CRON_SECRET nao dispensa a trava.
    const secretOnly = evaluateOriginLock({
      pathname: '/api/cron/sequences',
      method: 'GET',
      authorization: 'Bearer cron-secret-de-teste-com-32-caracteres-xyz',
      env: CLOUD,
    });
    assert.equal(secretOnly.allowed, false);
    assert.equal(secretOnly.code, 'ORIGIN_AUTH_FORBIDDEN');
  });

  it('secret ausente em producao (Cloud Run) falha fechado', () => {
    const r = evaluateOriginLock({
      pathname: '/',
      env: env({ K_SERVICE: 'sti-hub' }),
      headers: headers({ 'X-STI-Origin-Auth': SECRET }),
    });
    assert.equal(r.allowed, false);
    assert.equal(r.status, 403);
    assert.equal(r.code, 'ORIGIN_AUTH_NOT_CONFIGURED');
    const short = evaluateOriginLock({
      pathname: '/',
      env: env({ CLOUD_RUN_JOB: 'sti-hub-migrate', STI_HUB_ORIGIN_SHARED_SECRET: 'curto' }),
    });
    assert.equal(short.allowed, false);
    assert.equal(short.code, 'ORIGIN_AUTH_NOT_CONFIGURED');
  });

  it('o codigo de trava, middleware e docs nao registram o secret', () => {
    const files = [
      'src/app/lib/origin-lock.ts',
      'src/middleware.ts',
      'docs/CLOUD_RUN_MIGRATION.md',
    ];
    for (const f of files) {
      const src = readFileSync(resolve(process.cwd(), f), 'utf8');
      assert.doesNotMatch(src, /console\.(log|info|debug|warn|error)\([^)]*ORIGIN_SHARED_SECRET/);
      assert.doesNotMatch(src, /console\.(log|info|debug|warn|error)\([^)]*X-STI-Origin-Auth/);
    }
  });
});

describe('HSTS', () => {
  it('applyBaseSecurityHeaders envia Strict-Transport-Security com 2 anos e includeSubDomains', () => {
    const res = applyBaseSecurityHeaders(NextResponse.next(), 'public-allowed', '/login');
    assert.equal(res.headers.get('Strict-Transport-Security'), 'max-age=63072000; includeSubDomains');
  });
});

describe('IP com 2 hops quando a trava esta ativa', () => {
  it('K_SERVICE/CLOUD_RUN_JOB forcam hops=2 e selecionam o cliente (nao o IP do LB/Worker)', () => {
    const xff = '8.8.8.8, 198.51.100.4, 203.0.113.10';
    const on = env({ K_SERVICE: 'sti-hub', TRUSTED_PROXY_HOPS: '1' });
    assert.equal(resolveTrustedProxyHops(on), 2);
    assert.equal(resolveTrustedProxyHops(env({ CLOUD_RUN_JOB: 'sti-hub-migrate' })), 2);
    assert.equal(resolveTrustedProxyHops(env({})), 1);
    assert.equal(clientIpFromForwardedFor(xff, 2), '198.51.100.4');
    assert.equal(
      resolveTrustedClientIp(headers({ 'x-forwarded-for': xff, 'x-real-ip': '8.8.8.8' }), 'cloudrun', on),
      '198.51.100.4'
    );
  });
});

describe('cli-migrate nao roda na subida', () => {
  it('Dockerfile CMD, start, start:web e railway.json nao invocam cli-migrate', () => {
    const docker = readFileSync(resolve(process.cwd(), 'Dockerfile'), 'utf8');
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const railway = readFileSync(resolve(process.cwd(), 'railway.json'), 'utf8');
    const cmd = docker.split('\n').filter((l) => /^\s*CMD\s/.test(l)).join('\n');
    assert.match(cmd, /node", "server.js"/);
    assert.doesNotMatch(cmd, /cli-migrate/);
    assert.doesNotMatch(pkg.scripts.start || '', /cli-migrate/);
    assert.doesNotMatch(pkg.scripts['start:web'] || '', /cli-migrate/);
    assert.match(railway, /"startCommand": "npm run start:web"/);
    assert.doesNotMatch(railway, /cli-migrate/);
  });
});
