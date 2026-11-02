// ============================================================================
// STI-hub — rebase v5 (v4 sobre o pacote M, 01/11/2026): teto do dispatch com a MESMA regra do
// bridge do M (4 MiB so nas rotas de BRIDGE_LARGE_BODY_ROUTES com sessao assinada valida; 1 MiB no
// resto), constante unica e servidor standalone.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';
import {
  BRIDGE_LARGE_BODY_BYTES,
  BRIDGE_LARGE_BODY_ROUTES,
  BRIDGE_MAX_BODY_BYTES,
} from '../src/app/lib/bridge-body-limit';
import { bridgeBodyCapFor } from '../src/app/api/_bridge';
import { MAX_BODY_BYTES } from '../src/app/lib/proposal-link-redact';
import { requestBodyCapFor } from '../src/app/lib/request-body-cap';

const HTTP = { _fromHttpBridge: '1' };
let ipn = 1;
const nextIp = () => `198.18.0.${(ipn++ % 250) + 1}`;
const MB3 = 3 * 1000 * 1000;

function sessionFor(repo: ReturnType<typeof createInMemoryRepository>, uid = 'usr-seta-01') {
  const r = repo.findRbacUserRecord(uid, '')!;
  return signStiHubSessionToken({
    uid: r.id, email: r.email, name: r.name, roleId: r.roleId, scope: r.scope,
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000,
  } as Parameters<typeof signStiHubSessionToken>[0]);
}

describe('Rebase v5: teto de corpo do dispatch = regra do bridge (pacote M)', () => {
  it('constante unica: MAX_BODY_BYTES do dispatch === BRIDGE_MAX_BODY_BYTES; requestBodyCapFor === bridgeBodyCapFor', () => {
    const repo = createInMemoryRepository();
    const tok = sessionFor(repo);
    assert.equal(MAX_BODY_BYTES, BRIDGE_MAX_BODY_BYTES);
    const paths = [...BRIDGE_LARGE_BODY_ROUTES.map((r) => r.path), '/api/bootstrap/', '/API/BOOTSTRAP', '/api/erp/proposals', '/api/erp/proposals/x/approve', '/api/portal/tickets'];
    for (const m of ['POST', 'PATCH', 'GET']) {
      for (const p of paths) {
        for (const t of [undefined, '', 'falso.falso', tok]) {
          assert.equal(requestBodyCapFor(m, p, t), bridgeBodyCapFor(m, p, t), `${m} ${p} ${t ? 'tok' : 'sem'}`);
        }
      }
    }
    assert.equal(requestBodyCapFor('POST', '/api/bootstrap', tok), BRIDGE_LARGE_BODY_BYTES);
  });

  it('as 4 rotas grandes aceitam ~3 MB com sessao valida (sem 413); sem sessao ou com token falso => 413', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const tok = sessionFor(repo);
    const big = { conteudo: 'x'.repeat(MB3) };
    for (const r of BRIDGE_LARGE_BODY_ROUTES) {
      const withSession = await router.dispatch({ method: r.method, path: r.path, query: { ...HTTP, _clientIp: nextIp(), _sessionToken: tok }, body: big, bodyBytes: MB3 + 20 });
      assert.notEqual(withSession.status, 413, `${r.path} com sessao: ${JSON.stringify(withSession.body).slice(0, 200)}`);
      for (const q of [{}, { _sessionToken: 'falso.falso' }]) {
        const t0 = Date.now();
        const anon = await router.dispatch({ method: r.method, path: r.path, query: { ...HTTP, _clientIp: nextIp(), ...q }, body: big });
        assert.equal(anon.status, 413, `${r.path} sem sessao`);
        assert.equal((anon.body as { code: string; maxBytes: number }).code, 'BODY_TOO_LARGE');
        assert.equal((anon.body as { maxBytes: number }).maxBytes, BRIDGE_MAX_BODY_BYTES);
        assert.ok(Date.now() - t0 < 200);
      }
    }
  });

  it('com sessao valida: acima de 4 MiB => 413; rota fora da lista com ~3 MB => 413; bodyBytes declarado acima do teto => 413', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const tok = sessionFor(repo);
    const q = () => ({ ...HTTP, _clientIp: nextIp(), _sessionToken: tok });
    const over = await router.dispatch({ method: 'POST', path: '/api/bootstrap', query: q(), body: { conteudo: 'x'.repeat(BRIDGE_LARGE_BODY_BYTES) } });
    assert.equal(over.status, 413);
    assert.equal((over.body as { maxBytes: number }).maxBytes, BRIDGE_LARGE_BODY_BYTES);
    const declared = await router.dispatch({ method: 'POST', path: '/api/erp/financial/reconcile-ofx', query: q(), body: { a: 1 }, bodyBytes: BRIDGE_LARGE_BODY_BYTES + 1 });
    assert.equal(declared.status, 413);
    for (const path of ['/api/erp/proposals', '/api/erp/proposals/prop-seta-002/approve', '/api/portal/tickets']) {
      const r = await router.dispatch({ method: 'POST', path, query: q(), body: { conteudo: 'x'.repeat(MB3) } });
      assert.equal(r.status, 413, path);
    }
    // PATCH em rota da lista nao tem o teto maior (lista e por metodo + caminho).
    const patch = await router.dispatch({ method: 'PATCH', path: '/api/bootstrap', query: q(), body: { conteudo: 'x'.repeat(MB3) } });
    assert.equal(patch.status, 413);
  });
});
