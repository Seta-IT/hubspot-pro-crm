// ============================================================================
// STI-hub — B-V4-1 (checagem final da v4, 01/11/2026): custo da redacao do link assinado e
// limite de corpo. Antes: ~9 s de CPU por MB de `eyJ` em requisicao ANONIMA (antes de sessao e
// rate-limit). Agora: prefixo {"v": em 8 caracteres, no maximo 400 caracteres por candidato,
// pulo da sequencia base64 no candidato falho, e corpo > 1 MiB => 413 BODY_TOO_LARGE nas rotas
// Next do link (content-length e bytes lidos) e no inicio do dispatch (antes da redacao).
// Sem rede: router/repositorio em memoria e rotas Next com NextRequest local.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { signStiHubSessionToken, signUserInviteToken } from '../src/app/lib/auth';
import { signPasswordResetToken } from '../src/api/password-reset';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';
import { signProposalLinkToken } from '../src/app/lib/proposal-link';
import {
  bodyExceedsMaxBytes,
  looksLikeProposalLinkPayload,
  MAX_BODY_BYTES,
  redactProposalLinkTokens,
} from '../src/app/lib/proposal-link-redact';
import { readBodyCapped } from '../src/app/lib/proposal-link-route';

const HTTP = { _fromHttpBridge: '1' };
const MB = 1_000_000;
/** Repete `unit` ate ~`bytes` bytes em UTF-8 (ZWSP = 3 bytes). */
const fill = (unit: string, bytes: number) => unit.repeat(Math.floor(bytes / Buffer.byteLength(unit)));
const ms = (t0: bigint) => Number(process.hrtime.bigint() - t0) / 1e6;
let ipSeq = 1;
const nextIp = () => `192.0.2.${(ipSeq++ % 250) + 1}`;

function spyAll(): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const restore: Array<() => void> = [];
  const repoProto = Object.getPrototypeOf(createInMemoryRepository()) as Record<string, unknown>;
  const routerProto = CrmApiRouter.prototype as unknown as Record<string, unknown>;
  for (const [proto, names] of [
    [repoProto, ['syncFromDisk', 'appendSecurityAuditLog', 'reconcileClientState', 'approveProposalAndConvertToContract', 'createTimelineEvent']],
    [routerProto, ['handleRoute', 'dispatchSalesAgent', 'approveProposalViaLink']],
  ] as const) {
    for (const n of names) {
      const orig = proto[n] as ((...a: unknown[]) => unknown) | undefined;
      if (typeof orig !== 'function') continue;
      proto[n] = function (this: unknown, ...a: unknown[]) { calls.push(n); return orig.apply(this, a); };
      restore.push(() => { proto[n] = orig; });
    }
  }
  return { calls, restore: () => restore.forEach((r) => r()) };
}

describe('B-V4-1: custo da redacao e limite de corpo (1 MiB => 413)', () => {
  it('4 MB sem login no /approve (rota Next) => 413 em < 200 ms, com e sem content-length, sem nada rodar', async () => {
    const { POST: approvePOST } = await import('../src/app/api/erp/proposals/[id]/approve/route');
    const portal = await import('../src/app/api/erp/proposals/[id]/route');
    const body = JSON.stringify({ signerName: 'X', note: fill('eyJ', 4 * MB) });
    const spy = spyAll();
    try {
      for (const [label, handler, path, method, withLen] of [
        ['approve c/ content-length', approvePOST, '/api/erp/proposals/prop-seta-002/approve', 'POST', true],
        ['approve sem content-length', approvePOST, '/api/erp/proposals/prop-seta-002/approve', 'POST', false],
        ['portal POST', portal.POST, '/api/erp/proposals/prop-seta-002', 'POST', true],
        ['portal PATCH sem content-length', portal.PATCH, '/api/erp/proposals/prop-seta-002', 'PATCH', false],
      ] as const) {
        const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': nextIp() };
        if (withLen) headers['content-length'] = String(Buffer.byteLength(body));
        const req = new NextRequest(`https://sti-hub.example.invalid${path}`, { method, headers, body });
        if (!withLen) assert.equal(req.headers.get('content-length'), null, `${label}: sem content-length declarado`);
        const t0 = process.hrtime.bigint();
        const res = await handler(req);
        const took = ms(t0);
        assert.equal(res.status, 413, label);
        assert.equal(((await res.json()) as { code: string }).code, 'BODY_TOO_LARGE', label);
        assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
        assert.ok(took < 200, `${label}: ${took.toFixed(1)} ms`);
      }
      // content-length mentiroso/invalido tambem e recusado
      const lie = await approvePOST(new NextRequest('https://sti-hub.example.invalid/api/erp/proposals/prop-seta-002/approve', {
        method: 'POST', headers: { 'content-type': 'application/json', 'content-length': 'abc' }, body: '{}',
      }));
      assert.equal(lie.status, 413);
      assert.deepEqual(spy.calls, [], `nada pode rodar antes do 413: ${spy.calls.join(', ')}`);
    } finally {
      spy.restore();
    }
  });

  it('corpo no limite (< 1 MiB) segue para o bridge normalmente (404 generico sem token)', async () => {
    const { POST: approvePOST } = await import('../src/app/api/erp/proposals/[id]/approve/route');
    const body = JSON.stringify({ note: fill('eyJ', MB) });
    assert.ok(Buffer.byteLength(body) < MAX_BODY_BYTES);
    const t0 = process.hrtime.bigint();
    const res = await approvePOST(new NextRequest('https://sti-hub.example.invalid/api/erp/proposals/prop-seta-002/approve', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': nextIp() }, body,
    }));
    const took = ms(t0);
    assert.equal(res.status, 404);
    assert.ok(took < 1000, `${took.toFixed(1)} ms`);
  });

  it('1 MB so de eyJ no portal, no /approve e em rota qualquer (dispatch anonimo) responde em < 200 ms', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    for (const [path, unit] of [
      ['/api/erp/proposals/prop-seta-002/approve', 'eyJ'],
      ['/api/portal/tickets', 'eyJ'],
      ['/api/auth/login', 'eyJ2IjoxLCJwaWQiOiJ4 '],
      ['/api/nao-existe', 'eyJ '],
      ['/api/portal/tickets', 'eyJ\u200b'],
      ['/api/erp/proposals/prop-seta-002/approve', 'eyJ2Ijo'],
    ] as const) {
      const t0 = process.hrtime.bigint();
      const r = await router.dispatch({ method: 'POST', path, query: { ...HTTP, _clientIp: nextIp() }, body: { email: 'a@b.c', password: 'x', note: fill(unit, MB) } });
      const took = ms(t0);
      assert.notEqual(r.status, 413, `${path}: 1 MB cabe no limite`);
      assert.ok(r.status < 500, `${path}: ${r.status}`);
      assert.ok(took < 200, `${path} (${JSON.stringify(unit)}): ${took.toFixed(1)} ms`);
    }
  });

  it('dispatch: corpo > 1 MiB => 413 BODY_TOO_LARGE antes de qualquer efeito (inclusive bodyBytes declarado)', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    const spy = spyAll();
    try {
      for (const body of [
        { note: fill('eyJ', 4 * MB) },
        { many: Array.from({ length: 300_000 }, () => 'eyJ2Ijo') },
        { k: Object.fromEntries(Array.from({ length: 40_000 }, (_, i) => [`chave-${i}-${'x'.repeat(20)}`, 'v'])) },
        { acentos: 'ç'.repeat(600_000) },
      ]) {
        const t0 = process.hrtime.bigint();
        const r = await router.dispatch({ method: 'POST', path: '/api/erp/proposals/prop-seta-002/approve', query: { ...HTTP, _clientIp: nextIp() }, body });
        assert.equal(r.status, 413);
        assert.equal((r.body as { code: string }).code, 'BODY_TOO_LARGE');
        assert.ok(ms(t0) < 200);
      }
      const r = await router.dispatch({ method: 'POST', path: '/api/portal/tickets', query: { ...HTTP, _clientIp: nextIp() }, body: { a: 1 }, bodyBytes: MAX_BODY_BYTES + 1 });
      assert.equal(r.status, 413);
      assert.deepEqual(spy.calls, [], spy.calls.join(', '));
    } finally {
      spy.restore();
    }
    assert.equal(bodyExceedsMaxBytes({ a: 'x'.repeat(MAX_BODY_BYTES - 20) }), false);
    assert.equal(bodyExceedsMaxBytes({ a: 'x'.repeat(MAX_BODY_BYTES) }), true);
  });

  it('readBodyCapped para no limite (stream) e devolve o texto abaixo dele', async () => {
    assert.equal(await readBodyCapped(new Request('http://x/', { method: 'POST', body: 'a'.repeat(MAX_BODY_BYTES + 1) })), null);
    assert.equal(await readBodyCapped(new Request('http://x/', { method: 'POST', body: 'olá' })), 'olá');
  });

  it('funcao pura: 4 MB de eyJ < 200 ms; variantes adversariais de 1 MB < 200 ms cada', () => {
    let t0 = process.hrtime.bigint();
    redactProposalLinkTokens(fill('eyJ', 4 * MB));
    assert.ok(ms(t0) < 200, `4 MB: ${ms(t0)}`);
    for (const unit of ['eyJ', 'eyJ ', 'eyJ2Ijo', 'eyJ2IjoxLCJwaWQiOiJ4,', 'eyJ2Ijp9', 'eyJ\u200b', 'eyJ%2E', 'Lorem ipsum dolor sit amet, ']) {
      t0 = process.hrtime.bigint();
      redactProposalLinkTokens(fill(unit, MB));
      assert.ok(ms(t0) < 200, `${JSON.stringify(unit)}: ${ms(t0)}`);
    }
  });

  it('A3 continua: token colado, quebrado, com ZWSP, ponto escrito, base64 padrao e depois de lixo eyJ; sessao, convite e reset intactos', () => {
    const tok = signProposalLinkToken({ proposalId: 'prop-seta-001', version: 2 }).token;
    const [P, S] = tok.split('.');
    const std = (s: string) => s.replace(/-/g, '+').replace(/_/g, '/');
    for (const t of [
      `token ${tok} fim`, `token ${tok}abc`, `x_${tok}_y`, `${P.slice(0, 30)}\n${P.slice(30)}.${S}`, `${P}%2E${S}`,
      `${P}&#46;${S}`, `${P}\\u002e${S}`, `${P.slice(0, 10)}\u200b${P.slice(10)}.${S}`, `${std(P)}.${std(S)}`,
      `${'eyJ'.repeat(5000)} ${tok}`, `${'eyJhbGciOi'.repeat(200)},${tok}`, `lixo eyJ2Ijo} e depois ${tok}`,
    ]) {
      const out = redactProposalLinkTokens(t);
      const flat = out.replace(/\s|\u200b/g, '');
      assert.ok(!flat.includes(P.slice(20, 60)) && !flat.includes(std(P).slice(20, 60)), `payload vazou: ${t.slice(0, 60)}`);
    }
    assert.equal(looksLikeProposalLinkPayload(P), true);
    // Claims fora da ordem do assinante (sem {"v": no inicio) nao sao payload de link.
    assert.equal(looksLikeProposalLinkPayload(Buffer.from(JSON.stringify({ pid: 'p', jti: 'j', v: 1 })).toString('base64url')), false);
    const session = signStiHubSessionToken({ uid: 'u', email: 'e@x.com', name: 'N', roleId: 'R', scope: 'TODOS', enabledModules: ['CRM'], moduleAccess: { crm: true }, mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now(), exp: Date.now() + 60_000 } as Parameters<typeof signStiHubSessionToken>[0]);
    const invite = signUserInviteToken({ iid: 'i', uid: 'u', email: 'e@x.com', name: 'N', roleId: 'R' } as Parameters<typeof signUserInviteToken>[0]);
    const reset = signPasswordResetToken({ uid: 'u', email: 'e@x.com', pv: '1' }).token;
    for (const t of [session, invite, reset, `Bearer ${session}`, `convite: ${invite}\nreset: ${reset}`]) {
      assert.equal(redactProposalLinkTokens(t), t);
    }
  });
});
