// ============================================================================
// STI-hub — Pacote M (01/11/2026, CISO): limites do aceite publico (/approve) e teto de corpo no bridge.
// D1: tentativas invalidas contam so por IP e por IP+proposta; o limite por proposta conta so aceites
//     que passaram na validacao (terceiro nao trava o aceite do cliente).
// D2: baldes por proposta chaveados pelo id CANONICO (id, id em outra caixa e code no mesmo balde).
// (3): 413 BODY_TOO_LARGE acima de 1 MiB no bridge, com content-length e stream com teto/cancelamento.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository, CrmRepository } from '../src/db/repository';
import { CrmApiRouter, PROPOSAL_APPROVE_LIMITS, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import {
  BRIDGE_LARGE_BODY_BYTES,
  BRIDGE_LARGE_BODY_ROUTES,
  BRIDGE_MAX_BODY_BYTES,
  isLargeBodyRoute,
  parseJsonBodyLenient,
  readBodyWithCap,
} from '../src/app/lib/bridge-body-limit';
import { bridgeBodyCapFor, forwardToCrmRouter } from '../src/app/api/_bridge';

let ipn = 1;
const ip = () => `192.0.2.${(ipn++ % 250) + 1}`;
let ip6n = 1;
const uniqIp = () => `2001:db8:${(ip6n++).toString(16)}::1`; // /64 distintos
const sig = { signerName: 'Fulano de Tal', signerCpf: '529.982.247-25', signerRole: 'Diretor', modality: 'GOV_BR_OURO', acceptedTerms: true, signerEmail: 'fulano@exemplo.invalid' };
const mk = () => {
  const repo = createInMemoryRepository();
  const router = new CrmApiRouter(repo);
  return { repo, router };
};
type E = ReturnType<typeof mk>;
const mkProp = async (E: E) =>
  (
    (await E.router.dispatch({
      context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: '/api/erp/proposals',
      body: { title: 'M aprov', companyName: 'M SA', status: 'ENVIADA', contactName: 'Fulano', items: [{ id: 'i1', description: 'Item', quantity: 1, unitPrice: 100, isRecurring: true, ncmOrServiceCode: 'NCM 8517.62.14' }] },
    })).body as { data: { id: string; code: string } }
  ).data;
const approve = (E: E, key: string, body: unknown, clientIp: string) =>
  E.router.dispatch({ method: 'POST', path: `/api/erp/proposals/${encodeURIComponent(key)}/approve`, query: { _fromHttpBridge: '1', _clientIp: clientIp }, body });
const invalidBodies: unknown[] = [
  { ...sig, acceptedTerms: false },
  { ...sig, acceptedTerms: 'true' },
  { signerName: 'X' },
  { ...sig, signerCpf: '111.111.111-11' },
  [sig],
  {},
  { ...sig, signerName: '' },
];

describe('Pacote M (D1): tentativas invalidas nao travam o aceite legitimo', () => {
  it('limites configurados: por proposta (validos) 20, por IP 30, por IP+proposta 10', () => {
    assert.equal(PROPOSAL_APPROVE_LIMITS.validPerProposal, 20);
    assert.equal(PROPOSAL_APPROVE_LIMITS.ip, 30);
    assert.equal(PROPOSAL_APPROVE_LIMITS.ipPerProposal, 10);
  });

  it('probe D1 do parecer L: 40 POSTs invalidos de IPs distintos (id, code, caixa) => todos 400; o aceite valido seguinte => 200', async () => {
    const E = mk();
    const p = await mkProp(E);
    const keys = [p.id, p.code, p.id.toUpperCase(), String(p.code).toLowerCase()];
    for (let i = 0; i < 40; i++) {
      const r = await approve(E, keys[i % keys.length], invalidBodies[i % invalidBodies.length], uniqIp());
      assert.equal(r.status, 400, `tentativa ${i}: ${JSON.stringify(r.body)}`);
    }
    const ok = await approve(E, p.id, sig, uniqIp());
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });

  it('forca bruta segue limitada: 31a tentativa do mesmo IP => 429 (inclusive 404)', async () => {
    const E = mk();
    const fixed = '203.0.113.90';
    const st: number[] = [];
    for (let i = 0; i < 31; i++) st.push((await approve(E, `prop-nao-existe-${i}`, sig, fixed)).status);
    assert.deepEqual(st.slice(0, 30), Array(30).fill(404));
    assert.equal(st[30], 429);
  });

  it('IP+proposta: 10 invalidas do mesmo IP => 11a (ate valida) 429 para ESSE IP; outro IP aceita (200)', async () => {
    const E = mk();
    const p = await mkProp(E);
    const attacker = '203.0.113.91';
    for (let i = 0; i < 10; i++) assert.equal((await approve(E, p.id, invalidBodies[i % invalidBodies.length], attacker)).status, 400);
    const blocked = await approve(E, p.id, sig, attacker);
    assert.equal(blocked.status, 429);
    assert.equal((blocked.body as { code?: string }).code, 'PROPOSAL_APPROVE_RATE_LIMITED');
    assert.equal((await approve(E, p.id, sig, '203.0.113.92')).status, 200);
  });

  it('limite por proposta conta so aceites validados: 20 validados (falha posterior simulada) => 21o 429, mesmo de IP novo', async () => {
    const E = mk();
    const p = await mkProp(E);
    const orig = E.repo.approveProposalAndConvertToContract.bind(E.repo);
    (E.repo as unknown as { approveProposalAndConvertToContract: unknown }).approveProposalAndConvertToContract = () => null;
    for (let i = 0; i < 20; i++) assert.equal((await approve(E, p.id, sig, uniqIp())).status, 404, `validado ${i}`);
    assert.equal((await approve(E, p.id, sig, uniqIp())).status, 429);
    // tentativa invalida continua respondendo 400 (nao consome nem e barrada pelo balde de validos)
    assert.equal((await approve(E, p.id, { ...sig, acceptedTerms: false }, uniqIp())).status, 400);
    (E.repo as unknown as { approveProposalAndConvertToContract: unknown }).approveProposalAndConvertToContract = orig;
  });

  it('contexto interno nao e limitado', async () => {
    const E = mk();
    const p = await mkProp(E);
    for (let i = 0; i < 25; i++) {
      await E.router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: `/api/erp/proposals/${p.id}/approve`, body: { ...sig, acceptedTerms: false } });
    }
    const t = await E.router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: `/api/erp/proposals/${p.id}/approve`, body: sig });
    assert.equal(t.status, 200, JSON.stringify(t.body));
  });
});

describe('Pacote M (D2): baldes por proposta pelo id canonico', () => {
  it('probe D2 do parecer L: esgotar o balde de validos pelo id => pelo code, code minusculo e id em outra caixa tambem 429', async () => {
    const E = mk();
    const p = await mkProp(E);
    (E.repo as unknown as { approveProposalAndConvertToContract: unknown }).approveProposalAndConvertToContract = () => null;
    for (let i = 0; i < 20; i++) await approve(E, p.id, sig, uniqIp());
    for (const k of [p.code, String(p.code).toLowerCase(), p.id.toUpperCase(), ` ${p.id} `]) {
      assert.equal((await approve(E, k, sig, uniqIp())).status, 429, k);
    }
  });

  it('IP+proposta: esgotar pelo id bloqueia pelo code (mesmo IP), e o inverso', async () => {
    const E = mk();
    const p = await mkProp(E);
    const a = '203.0.113.93';
    for (let i = 0; i < 10; i++) await approve(E, p.id, {}, a);
    assert.equal((await approve(E, p.code, sig, a)).status, 429);
    const p2 = await mkProp(E);
    const b2 = '203.0.113.94';
    for (let i = 0; i < 10; i++) await approve(E, String(p2.code).toLowerCase(), {}, b2);
    assert.equal((await approve(E, p2.id, sig, b2)).status, 429);
  });

  it('proposta inexistente nao cria balde por proposta (so conta por IP)', async () => {
    const E = mk();
    const p = await mkProp(E);
    for (let i = 0; i < 25; i++) assert.equal((await approve(E, `${p.id}-x`, sig, uniqIp())).status, 404);
    assert.equal((await approve(E, p.id, sig, uniqIp())).status, 200);
  });
});

// ---------------------------------------------------------------------------
const streamOf = (total: number, chunk = 64 * 1024) => {
  let sent = 0;
  let cancelled = false;
  const s = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (sent >= total) return ctrl.close();
      const n = Math.min(chunk, total - sent);
      sent += n;
      ctrl.enqueue(new Uint8Array(n).fill(0x61));
    },
    cancel() {
      cancelled = true;
    },
  });
  return { s, sent: () => sent, cancelled: () => cancelled };
};
const reqWith = (path: string, body: BodyInit | ReadableStream | null, headers: Record<string, string> = {}, method = 'POST') =>
  new NextRequest(new URL(`http://127.0.0.1${path}`), { method, headers, body: body as BodyInit, duplex: 'half' } as unknown as ConstructorParameters<typeof NextRequest>[1]);

describe('Pacote M (3): teto de corpo no bridge', () => {
  it('constantes e lista explicita de rotas com teto maior', () => {
    assert.equal(BRIDGE_MAX_BODY_BYTES, 1024 * 1024);
    assert.equal(BRIDGE_LARGE_BODY_BYTES, 4 * 1024 * 1024);
    assert.deepEqual(BRIDGE_LARGE_BODY_ROUTES.map((r) => `${r.method} ${r.path}`).sort(), [
      'POST /api/bootstrap',
      'POST /api/erp/financial/reconcile-ofx',
      'POST /api/erp/nfe-importacao/emit',
      'POST /api/erp/purchases/import-xml',
    ]);
    assert.equal(isLargeBodyRoute('POST', '/api/bootstrap/'), true);
    assert.equal(isLargeBodyRoute('PATCH', '/api/bootstrap'), false);
    assert.equal(isLargeBodyRoute('POST', '/api/erp/proposals/x/approve'), false);
  });

  it('teto maior so com sessao assinada valida; anonimo ou token falso => 1 MiB', () => {
    const tok = signStiHubSessionToken({
      uid: 'usr-seta-01', email: 'a@b.invalid', name: 'A', roleId: 'role-admin', scope: 'TODOS',
      enabledModules: ['CRM', 'ERP'], moduleAccess: { crm: true, erp: true, chamados: true },
      mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000,
    } as Parameters<typeof signStiHubSessionToken>[0]);
    assert.equal(bridgeBodyCapFor('POST', '/api/bootstrap', undefined), BRIDGE_MAX_BODY_BYTES);
    assert.equal(bridgeBodyCapFor('POST', '/api/bootstrap', 'falso.falso'), BRIDGE_MAX_BODY_BYTES);
    assert.equal(bridgeBodyCapFor('POST', '/api/bootstrap', tok), BRIDGE_LARGE_BODY_BYTES);
    assert.equal(bridgeBodyCapFor('POST', '/api/erp/proposals', tok), BRIDGE_MAX_BODY_BYTES);
  });

  it('content-length acima do teto => TOO_LARGE sem ler o stream', async () => {
    const st = streamOf(4 * 1024 * 1024);
    const r = await readBodyWithCap(reqWith('/api/x', st.s, { 'content-length': String(4 * 1024 * 1024) }), BRIDGE_MAX_BODY_BYTES);
    assert.equal(r.ok, false);
    assert.ok(st.sent() <= 64 * 1024, `leu ${st.sent()} bytes`);
  });

  it('sem content-length: stream de 4 MiB => TOO_LARGE, leitura para no teto e o stream e cancelado', async () => {
    const st = streamOf(4 * 1024 * 1024);
    const r = await readBodyWithCap(reqWith('/api/x', st.s), BRIDGE_MAX_BODY_BYTES);
    assert.equal(r.ok, false);
    assert.ok(st.sent() <= BRIDGE_MAX_BODY_BYTES + 3 * 64 * 1024, `leu ${st.sent()} bytes`);
    assert.equal(st.cancelled(), true);
  });

  it('exatamente 1 MiB passa; JSON invalido ou vazio => {} (comportamento anterior)', async () => {
    const st = streamOf(BRIDGE_MAX_BODY_BYTES);
    const r = await readBodyWithCap(reqWith('/api/x', st.s), BRIDGE_MAX_BODY_BYTES);
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.bytes, BRIDGE_MAX_BODY_BYTES);
    assert.deepEqual(parseJsonBodyLenient(''), {});
    assert.deepEqual(parseJsonBodyLenient('{x'), {});
    assert.deepEqual(parseJsonBodyLenient('{"a":1}'), { a: 1 });
  });

  it('forwardToCrmRouter: 4 MiB anonimo no catch-all => 413 BODY_TOO_LARGE rapido (com e sem content-length)', async () => {
    for (const withLen of [true, false]) {
      const st = streamOf(4 * 1024 * 1024);
      const t0 = Date.now();
      const res = await forwardToCrmRouter(
        reqWith('/api/erp/proposals/prop-seta-002/approve', st.s, withLen ? { 'content-length': String(4 * 1024 * 1024), 'content-type': 'application/json' } : { 'content-type': 'application/json' })
      );
      const ms = Date.now() - t0;
      assert.equal(res.status, 413);
      const j = (await res.json()) as { code?: string };
      assert.equal(j.code, 'BODY_TOO_LARGE');
      assert.ok(ms < 200, `${ms} ms`);
      assert.equal(res.headers.get('cache-control'), 'no-store');
    }
  });

  it('forwardToCrmRouter: corpo JSON de ~900 KB segue para o router (sem 413)', async () => {
    const big = JSON.stringify({ ...sig, filler: 'a'.repeat(900 * 1024) });
    const res = await forwardToCrmRouter(reqWith('/api/erp/proposals/prop-nao-existe-m/approve', big, { 'content-type': 'application/json', 'x-real-ip': '198.18.0.9' }));
    assert.notEqual(res.status, 413);
  });

  it('conta de servico: corpo acima de 32 KiB sem content-length => 413 SVC_BODY_TOO_LARGE (stream com teto)', async () => {
    const st = streamOf(4 * 1024 * 1024);
    const res = await forwardToCrmRouter(reqWith('/api/erp/proposals', st.s, { authorization: 'Bearer stihub_svc_' + 'a'.repeat(43), 'content-type': 'application/json' }));
    assert.equal(res.status, 413);
    assert.equal(((await res.json()) as { code?: string }).code, 'SVC_BODY_TOO_LARGE');
    assert.ok(st.sent() <= 256 * 1024);
  });
});
