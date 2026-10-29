// STI-hub — Conta de servico "Assistente de Vendas" (Bearer stihub_svc_..., inerte sem env)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';
import {
  classifySalesAgentRoute,
  evaluateServiceBearerAtEdge,
  hashServiceToken,
  parseServiceBearer,
  SALES_AGENT_ACTOR_NAME,
  SALES_AGENT_SERVICE_ID,
  SALES_AGENT_TOKEN_ENV,
} from '../src/app/lib/service-account';
import { signStiHubSessionToken, verifyStiHubSessionToken } from '../src/app/lib/auth';
import { middleware } from '../src/middleware';

const newToken = () => `stihub_svc_${randomBytes(32).toString('base64url')}`;
const TOKEN = newToken();
const TOKEN_OLD = newToken();
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

function withEnv<T>(value: string | undefined, fn: () => Promise<T> | T): Promise<T> {
  const prev = process.env[SALES_AGENT_TOKEN_ENV];
  if (value === undefined) delete process.env[SALES_AGENT_TOKEN_ENV];
  else process.env[SALES_AGENT_TOKEN_ENV] = value;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prev === undefined) delete process.env[SALES_AGENT_TOKEN_ENV];
      else process.env[SALES_AGENT_TOKEN_ENV] = prev;
    });
}

/** Simula o _bridge: Bearer de servico => _svcBearer + SHA-256 do token. */
const svc = (router: CrmApiRouter, method: string, path: string, token: string | null, body: Record<string, unknown> = {}, q: Record<string, string> = {}) =>
  router.dispatch({
    method,
    path,
    query: { _fromHttpBridge: '1', _svcBearer: '1', _svcTokenSha256: token ? hashServiceToken(token) : '', _clientIp: '200.1.1.1', ...q },
    body,
  });

const adminSession = () =>
  signStiHubSessionToken({
    uid: 'usr-seta-01', email: 'marcelo.mira@setatelecom.com.br', name: 'Marcelo', roleId: 'SUPER_ADMIN', scope: 'TODOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now(), exp: Date.now() + 60_000,
  });

describe('Conta de servico: formato, hash e allowlist', () => {
  it('parse do Bearer e hash igual ao SHA-256 do Node', () => {
    assert.equal(parseServiceBearer(`Bearer ${TOKEN}`), TOKEN);
    assert.equal(parseServiceBearer('Bearer stihub_svc_curto'), '');
    assert.equal(parseServiceBearer('Bearer outro-token'), null);
    assert.equal(parseServiceBearer(null), null);
    assert.equal(hashServiceToken(TOKEN), sha(TOKEN));
  });

  it('allowlist estrita de metodo + rota', () => {
    const ok = (m: string, p: string) => classifySalesAgentRoute(m, p).allowed;
    assert.ok(ok('GET', '/api/erp/proposals'));
    assert.ok(ok('POST', '/api/erp/proposals'));
    assert.ok(ok('GET', '/api/erp/proposals/prop-1'));
    assert.ok(ok('GET', '/api/erp/proposals/prop-1/acceptance-status'));
    assert.ok(ok('GET', '/api/companies') && ok('POST', '/api/companies') && ok('GET', '/api/companies/c1'));
    assert.ok(ok('GET', '/api/contacts') && ok('POST', '/api/contacts') && ok('GET', '/api/contacts/ct1'));
    for (const [m, p] of [
      ['PATCH', '/api/erp/proposals/prop-1'], ['PUT', '/api/erp/proposals/prop-1'], ['DELETE', '/api/erp/proposals/prop-1'],
      ['POST', '/api/erp/proposals/prop-1/approve'], ['POST', '/api/erp/proposals/prop-1/restore-version'],
      ['GET', '/api/erp/proposals/prop-1/versions'], ['DELETE', '/api/contacts/ct1'], ['PATCH', '/api/companies/c1'],
      ['POST', '/api/companies/merge'], ['GET', '/api/companies/export'], ['GET', '/api/contacts/merge'],
      ['GET', '/api/iam/users'], ['GET', '/api/admin/users'], ['POST', '/api/auth/login'], ['GET', '/api/erp/financial/summary'],
      ['GET', '/api/erp/fiscal/nfe'], ['GET', '/api/erp/daily-sync'], ['GET', '/api/deals'], ['GET', '/'], ['GET', '/login'],
      ['GET', '/api/contacts/../iam'], ['GET', '/api/contacts/%2e%2e'],
    ]) {
      assert.equal(ok(m, p), false, `${m} ${p}`);
    }
  });
});

describe('Conta de servico: middleware (Edge)', () => {
  const req = (method: string, path: string, headers: Record<string, string>) =>
    new NextRequest(new URL(`https://sti-hub.vercel.app${path}`), { method, headers });

  it('sem env => 401 mesmo com token bem formado (codigo inerte)', async () => {
    await withEnv(undefined, () => {
      assert.equal(evaluateServiceBearerAtEdge({ method: 'GET', pathname: '/api/erp/proposals', token: TOKEN }).status, 401);
      const res = middleware(req('GET', '/api/erp/proposals', { authorization: `Bearer ${TOKEN}` }));
      assert.equal(res.status, 401);
    });
  });

  it('com env: token certo => segue; errado => 401; fora da allowlist => 403; /api/auth e rota publica => 403', async () => {
    await withEnv(sha(TOKEN), () => {
      const pass = middleware(req('GET', '/api/erp/proposals', { authorization: `Bearer ${TOKEN}` }));
      assert.equal(pass.headers.get('x-stihub-auth-guard'), 'service-account-bearer');
      assert.equal(middleware(req('GET', '/api/erp/proposals', { authorization: `Bearer ${newToken()}` })).status, 401);
      assert.equal(middleware(req('DELETE', '/api/contacts/x', { authorization: `Bearer ${TOKEN}` })).status, 403);
      assert.equal(middleware(req('GET', '/api/iam/users', { authorization: `Bearer ${TOKEN}` })).status, 403);
      assert.equal(middleware(req('POST', '/api/auth/login', { authorization: `Bearer ${TOKEN}` })).status, 403);
      assert.equal(middleware(req('POST', '/api/erp/proposals/p1/approve', { authorization: `Bearer ${TOKEN}` })).status, 403);
      assert.equal(pass.headers.get('set-cookie'), null);
    });
  });

  it('rotacao: aceita qualquer hash da lista separada por virgula', async () => {
    await withEnv(`${sha(TOKEN)}, ${sha(TOKEN_OLD)}`, () => {
      assert.equal(evaluateServiceBearerAtEdge({ method: 'GET', pathname: '/api/companies', token: TOKEN_OLD }).allowed, true);
      assert.equal(evaluateServiceBearerAtEdge({ method: 'GET', pathname: '/api/companies', token: TOKEN }).allowed, true);
    });
  });

  it('cookie de sessao + Bearer: Bearer ignorado (fluxo de sessao normal; cookie invalido => 401 de sessao)', async () => {
    await withEnv(sha(TOKEN), () => {
      const res = middleware(
        req('GET', '/api/erp/proposals', { authorization: `Bearer ${TOKEN}`, cookie: 'stihub_session=invalido.assinatura' })
      );
      assert.equal(res.status, 401);
      assert.notEqual(res.headers.get('x-stihub-auth-guard'), 'service-account-bearer');
    });
  });
});

describe('Conta de servico: router (defesa em profundidade)', () => {
  it('sem env => 401; token errado => 401; ambos auditados como negados', async () => {
    await withEnv(undefined, async () => {
      const repo = createInMemoryRepository();
      const router = new CrmApiRouter(repo);
      const r = await svc(router, 'GET', '/api/erp/proposals', TOKEN);
      assert.equal(r.status, 401);
      assert.equal((r.body as { code: string }).code, 'SVC_AUTH_DISABLED');
    });
    await withEnv(sha(TOKEN), async () => {
      const repo = createInMemoryRepository();
      const router = new CrmApiRouter(repo);
      const r = await svc(router, 'GET', '/api/erp/proposals', newToken());
      assert.equal(r.status, 401);
      const r2 = await svc(router, 'GET', '/api/erp/proposals', null);
      assert.equal(r2.status, 401);
      const logs = repo.listSecurityAuditLogs(20).logs.filter((l) => l.actorName === SALES_AGENT_ACTOR_NAME);
      assert.ok(logs.length >= 2);
      assert.ok(logs.every((l) => l.status === 'BLOCKED' && l.details.includes(SALES_AGENT_SERVICE_ID)));
    });
  });

  it('token valido: GET propostas 200 paginado (max 50), sem assinatura/historico; acceptance-status minimo', async () => {
    await withEnv(sha(TOKEN), async () => {
      const repo = createInMemoryRepository();
      const router = new CrmApiRouter(repo);
      const r = await svc(router, 'GET', '/api/erp/proposals', TOKEN, {}, { limit: '500' });
      assert.equal(r.status, 200);
      const b = r.body as { data: Array<Record<string, unknown>>; limit: number; total: number };
      assert.ok(b.limit <= 50);
      assert.ok(b.data.length <= 50);
      for (const p of b.data) {
        assert.equal('digitalSignature' in p, false);
        assert.equal('versionHistory' in p, false);
      }
      const first = repo.listProposals()[0];
      if (first) {
        const a = await svc(router, 'GET', `/api/erp/proposals/${first.id}/acceptance-status`, TOKEN);
        assert.equal(a.status, 200);
        const d = (a.body as { data: Record<string, unknown> }).data;
        assert.equal(d.proposalId, first.id);
        assert.ok(d.acceptance);
        assert.equal(JSON.stringify(a.body).includes('signerCpf'), false);
      }
      assert.equal(r.headers, undefined, 'nunca devolve headers/cookie');
    });
  });

  it('fora da allowlist => 403 (DELETE, PATCH, approve, /api/iam, /api/auth, admin, financeiro, daily-sync)', async () => {
    await withEnv(sha(TOKEN), async () => {
      const repo = createInMemoryRepository();
      const router = new CrmApiRouter(repo);
      const before = repo.listProposals().length;
      for (const [m, p] of [
        ['DELETE', `/api/erp/proposals/${repo.listProposals()[0]?.id || 'x'}`],
        ['PATCH', '/api/companies/c1'],
        ['POST', '/api/erp/proposals/x/approve'],
        ['GET', '/api/iam/users'],
        ['GET', '/api/iam/service-accounts'],
        ['POST', '/api/auth/login'],
        ['GET', '/api/admin/users'],
        ['GET', '/api/erp/financial/summary'],
        ['GET', '/api/erp/daily-sync'],
      ]) {
        const r = await svc(router, m, p, TOKEN);
        assert.equal(r.status, 403, `${m} ${p}`);
      }
      assert.equal(repo.listProposals().length, before);
    });
  });

  it('criacao: campos restritos, override IAM/journal ignorados, contato com campos comerciais apenas', async () => {
    await withEnv(sha(TOKEN), async () => {
      const repo = createInMemoryRepository();
      const router = new CrmApiRouter(repo);
      const usersBefore = JSON.stringify(repo.getRbacState().users.map((u) => [u.id, u.roleId, u.active]));
      const r = await svc(router, 'POST', '/api/contacts', TOKEN, {
        firstName: 'Teste',
        lastName: 'Agente',
        email: 'teste.agente@example.com',
        leadScore: 99,
        ownerId: 'usr-seta-01',
        iamUsersOverride: [{ id: 'usr-hacker', email: 'h@x.com', roleId: 'SUPER_ADMIN', active: true }],
        iamDeletedUsersOverride: ['usr-seta-01'],
        _reconcileJournal: { ops: [] },
      });
      assert.equal(r.status, 201);
      const d = (r.body as { data: Record<string, unknown> }).data;
      for (const k of ['leadScore', 'lgpdConsent', 'utmSource', 'customProperties', 'completenessScore', 'timeline']) {
        assert.equal(k in d, false, k);
      }
      assert.equal(JSON.stringify(repo.getRbacState().users.map((u) => [u.id, u.roleId, u.active])), usersBefore);
      const created = repo.getContactById(String(d.id))!;
      assert.notEqual(created.leadScore, 99);
      const audit = repo.listSecurityAuditLogs(5).logs.find((l) => l.resource === 'POST /api/contacts');
      assert.ok(audit && audit.status === 'SUCCESS' && audit.details.includes(`criado=${d.id}`));

      const list = await svc(router, 'GET', '/api/contacts', TOKEN);
      const items = (list.body as { data: Array<Record<string, unknown>> }).data;
      assert.ok(items.length <= 25);
      assert.ok(items.every((c) => !('leadScore' in c) && !('lgpdLegalBasis' in c) && !('timeline' in c)));

      const p = await svc(router, 'POST', '/api/erp/proposals', TOKEN, { title: 'Proposta do agente', status: 'APROVADA', digitalSignature: { signerCpf: '1' } });
      assert.equal(p.status, 201);
      const pd = (p.body as { data: Record<string, unknown> }).data;
      assert.notEqual(pd.status, 'APROVADA');
    });
  });

  it('rate limit: 60 req/min por token => 61a = 429', async () => {
    await withEnv(sha(TOKEN), async () => {
      const router = new CrmApiRouter(createInMemoryRepository());
      for (let i = 0; i < 60; i++) {
        const r = await svc(router, 'GET', '/api/companies', TOKEN, {}, { limit: '1' });
        assert.equal(r.status, 200, `req ${i}`);
      }
      const r = await svc(router, 'GET', '/api/companies', TOKEN);
      assert.equal(r.status, 429);
    });
  });

  it('conta desativada no IAM => 401 na hora; reativada => volta', async () => {
    await withEnv(sha(TOKEN), async () => {
      const repo = createInMemoryRepository();
      const router = new CrmApiRouter(repo);
      assert.equal((await svc(router, 'GET', '/api/companies', TOKEN)).status, 200);
      const off = await router.dispatch({
        method: 'PATCH', path: `/api/iam/service-accounts/${SALES_AGENT_SERVICE_ID}`,
        query: { _fromHttpBridge: '1', _sessionToken: adminSession() }, body: { active: false },
      });
      assert.equal(off.status, 200);
      const denied = await svc(router, 'GET', '/api/companies', TOKEN);
      assert.equal(denied.status, 401);
      assert.equal((denied.body as { code: string }).code, 'SVC_ACCOUNT_DISABLED');
      repo.setServiceAccountActive(SALES_AGENT_SERVICE_ID, true, { email: 'marcelo.mira@setatelecom.com.br' });
      assert.equal((await svc(router, 'GET', '/api/companies', TOKEN)).status, 200);
      const auditOff = repo.listSecurityAuditLogs(50).logs.find((l) => l.action === 'SERVICE_ACCOUNT_DISABLED');
      assert.ok(auditOff);
    });
  });

  it('revogacao por env: remover/trocar o hash bloqueia', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    await withEnv(sha(TOKEN), async () => assert.equal((await svc(router, 'GET', '/api/companies', TOKEN)).status, 200));
    await withEnv(sha(TOKEN_OLD), async () => assert.equal((await svc(router, 'GET', '/api/companies', TOKEN)).status, 401));
    await withEnv('', async () => assert.equal((await svc(router, 'GET', '/api/companies', TOKEN)).status, 401));
  });
});

describe('Conta de servico nao e usuario humano', () => {
  it('fora da lista de usuarios, sem login, sem convite, sem sessao/cookie', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    assert.equal(repo.getRbacState().users.some((u) => u.id.startsWith('svc-')), false);
    const sa = repo.getServiceAccount(SALES_AGENT_SERVICE_ID)!;
    assert.equal(sa.accountType, 'SERVICE');
    assert.equal(sa.erpRole, 'ERP_COMMERCIAL');
    assert.equal('passwordHash' in sa || 'totpSecret' in sa, false);

    const inv = await router.dispatch({ method: 'POST', path: `/api/admin/users/${SALES_AGENT_SERVICE_ID}/invite`, query: { _fromHttpBridge: '1', _sessionToken: adminSession() }, body: {} });
    assert.equal(inv.status, 403);
    const create = await router.dispatch({ method: 'POST', path: '/api/admin/users', query: { _fromHttpBridge: '1', _sessionToken: adminSession() }, body: { id: 'svc-x', name: 'x', email: 'x@servico.sti-hub' } });
    assert.equal(create.status, 403);
    const login = await router.dispatch({ method: 'POST', path: '/api/auth/login', query: { _fromHttpBridge: '1' }, body: { email: 'svc-assistente-vendas@servico.sti-hub', password: 'qualquer-coisa' } });
    assert.notEqual(login.status, 200);

    const forged = signStiHubSessionToken({
      uid: SALES_AGENT_SERVICE_ID, email: 'svc-assistente-vendas@servico.sti-hub', name: 'svc', roleId: 'VENDEDOR_SALES', scope: 'TODOS',
      enabledModules: ['CRM', 'ERP'], moduleAccess: { crm: true, erp: true, chamados: false },
      mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now(), exp: Date.now() + 60_000,
    });
    assert.equal(verifyStiHubSessionToken(forged).valid, false);

    // Override IAM (selado ou cru) nunca cria/edita conta de servico como humano.
    repo.applyIamUsersOverride([{ id: SALES_AGENT_SERVICE_ID, email: 'a@b.com', name: 'x', roleId: 'SUPER_ADMIN' }]);
    assert.equal(repo.getRbacState().users.some((u) => u.id === SALES_AGENT_SERVICE_ID), false);
  });

  it('admin lista contas de servico; usuario sem alcada IAM => 403', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    const ok = await router.dispatch({ method: 'GET', path: '/api/iam/service-accounts', query: { _fromHttpBridge: '1', _sessionToken: adminSession() }, body: {} });
    assert.equal(ok.status, 200);
    const noSess = await router.dispatch({ method: 'GET', path: '/api/iam/service-accounts', query: { _fromHttpBridge: '1' }, body: {} });
    assert.ok(noSess.status === 401 || noSess.status === 403);
  });
});
