// ============================================================================
// STI-hub — Pacote N (02/11/2026), commit 4 (D-M2 do parecer M): o teto de 4 MiB do bridge e do
// dispatch consulta a lista de revogacao de sessao (logout). Sessao revogada => teto de 1 MiB.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter, isSessionTokenRevoked } from '../src/api/router';
import { bridgeBodyCapFor, forwardToCrmRouter } from '../src/app/api/_bridge';
import { requestBodyCapFor } from '../src/app/lib/request-body-cap';
import { BRIDGE_LARGE_BODY_BYTES, BRIDGE_MAX_BODY_BYTES } from '../src/app/lib/bridge-body-limit';

const adminTok = () =>
  signStiHubSessionToken({
    uid: 'usr-seta-01', email: 'marcelo.mira@setatelecom.com.br', name: 'Teste', roleId: 'SUPER_ADMIN', scope: 'TODOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000, canManageUsersRbac: true,
  } as Parameters<typeof signStiHubSessionToken>[0]);

describe('Pacote N (D-M2): sessao revogada nao ganha o teto de 4 MiB', () => {
  it('bridgeBodyCapFor e requestBodyCapFor: 4 MiB antes do logout, 1 MiB depois', async () => {
    const t = adminTok();
    assert.equal(bridgeBodyCapFor('POST', '/api/bootstrap', t), BRIDGE_LARGE_BODY_BYTES);
    assert.equal(requestBodyCapFor('POST', '/api/bootstrap', t), BRIDGE_LARGE_BODY_BYTES);
    const router = new CrmApiRouter(createInMemoryRepository());
    const out = await router.dispatch({ method: 'POST', path: '/api/auth/logout', query: { _fromHttpBridge: '1', _sessionToken: t }, body: {} });
    assert.equal(out.status, 200);
    assert.equal(isSessionTokenRevoked(t), true);
    for (const p of ['/api/bootstrap', '/api/erp/purchases/import-xml', '/api/erp/nfe-importacao/emit', '/api/erp/financial/reconcile-ofx', '/api/mailbox/send']) {
      assert.equal(bridgeBodyCapFor('POST', p, t), BRIDGE_MAX_BODY_BYTES, p);
      assert.equal(requestBodyCapFor('POST', p, t), BRIDGE_MAX_BODY_BYTES, p);
    }
    // outra sessao valida segue com 4 MiB
    assert.equal(bridgeBodyCapFor('POST', '/api/bootstrap', adminTok() + ''), BRIDGE_LARGE_BODY_BYTES);
  });

  it('bridge: 2 MiB com sessao revogada => 413 BODY_TOO_LARGE (maxBytes 1 MiB) antes de ler o resto', async () => {
    const t = adminTok();
    const router = new CrmApiRouter(createInMemoryRepository());
    await router.dispatch({ method: 'POST', path: '/api/auth/logout', query: { _fromHttpBridge: '1', _sessionToken: t }, body: {} });
    const body = JSON.stringify({ pad: 'x'.repeat(2 * 1024 * 1024) });
    const req = new NextRequest('http://127.0.0.1/api/bootstrap', { method: 'POST', headers: { cookie: `stihub_session=${t}`, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }, body });
    const res = await forwardToCrmRouter(req);
    assert.equal(res.status, 413);
    const j = (await res.json()) as { code: string; maxBytes: number };
    assert.equal(j.code, 'BODY_TOO_LARGE');
    assert.equal(j.maxBytes, BRIDGE_MAX_BODY_BYTES);
  });
});
