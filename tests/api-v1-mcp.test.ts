// ============================================================================
// STI-hub — API v1 + MCP + OAuth 2.1/DCR + chaves de integracao no IAM (Fase 1).
// Sem rede e sem Postgres real: store de integracao em memoria SOMENTE de teste
// (injecao explicita) e CrmApiRouter com repositorio em memoria.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createInMemoryRepository, type CrmRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { middleware, isSelfAuthenticatedIntegrationPath } from '../src/middleware';
import { RouterDataPort } from '../src/modules/integration/data-port';
import { TestOnlyMemoryIntegrationStore } from '../src/modules/integration/store-memory';
import { defaultLimits, resolveIntegrationDeps, setIntegrationDepsForTests, type IntegrationDeps } from '../src/modules/integration/runtime';
import type { IntegrationHttpRequest, IntegrationHttpResponse } from '../src/modules/integration/http';
import { handleRestV1 } from '../src/modules/integration/rest';
import { handleMcp } from '../src/modules/integration/mcp';
import { handleOAuth, handleWellKnown, isAllowedRedirectUri } from '../src/modules/integration/oauth';
import { handleIamIntegrationKeys } from '../src/modules/integration/iam-keys';
import { buildOpenApiDocument } from '../src/modules/integration/openapi';
import { INTEGRATION_USE_CASES } from '../src/modules/integration/use-cases';
import { INTEGRATION_SCHEMA_SQL } from '../src/modules/integration/store-postgres';
import { isBlockedScope, validateRequestedScopes } from '../src/modules/integration/scopes';

const ORIGIN = 'https://stihub.test';
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const CNPJ_RAW = '11.222.333/0001-81';

interface Env {
  repo: CrmRepository;
  router: CrmApiRouter;
  store: TestOnlyMemoryIntegrationStore;
  deps: IntegrationDeps;
  ids: Record<string, string>;
  clock: { now: number };
}

function session(user: { uid: string; email: string; name: string; roleId: string; scope: string; admin?: boolean; mfa?: boolean; chamados?: boolean }) {
  return signStiHubSessionToken({
    uid: user.uid,
    email: user.email,
    name: user.name,
    roleId: user.roleId,
    scope: user.scope,
    enabledModules: ['CRM', 'CHAMADOS'],
    moduleAccess: { crm: true, erp: false, chamados: user.chamados !== false },
    canManageUsersRbac: user.admin === true,
    mfaVerified: user.mfa !== false,
    mfaMethod: 'TOTP_AUTHENTICATOR',
    iat: Date.now(),
    exp: Date.now() + 3_600_000,
  });
}

const ADMIN = { uid: 'usr-api-admin', email: 'admin.api@seta.test', name: 'Admin API', roleId: 'SUPER_ADMIN', scope: 'TODOS', admin: true };
const ANA = { uid: 'usr-ana', email: 'ana@seta.test', name: 'Ana Vendas', roleId: 'GERENTE_COMERCIAL', scope: 'EQUIPE' };
const BRUNO = { uid: 'usr-bruno', email: 'bruno@seta.test', name: 'Bruno Vendas', roleId: 'VENDEDOR_SALES', scope: 'PROPRIOS' };

function makeEnv(limits: Partial<IntegrationDeps['limits']> = {}): Env {
  const repo = createInMemoryRepository();
  const router = new CrmApiRouter(repo);
  const users = [
    { ...ADMIN, scope: 'TODOS' },
    ANA,
    BRUNO,
    { uid: 'usr-carla', email: 'carla@seta.test', name: 'Carla Outra', roleId: 'VENDEDOR_SALES', scope: 'PROPRIOS' },
  ];
  for (const u of users) {
    repo.upsertRbacUser({
      id: u.uid,
      email: u.email,
      name: u.name,
      roleId: u.roleId as never,
      scope: u.scope as never,
      moduleAccess: { crm: true, erp: false, chamados: true },
      active: true,
    });
  }
  for (const u of repo.getRbacState().users) {
    if (!u.id.startsWith('usr-api-admin') && !['usr-ana', 'usr-bruno', 'usr-carla'].includes(u.id)) continue;
    u.active = true;
    u.moduleAccess = { crm: true, erp: false, chamados: true };
    u.crmPermissions = {
      ...(u.crmPermissions as NonNullable<typeof u.crmPermissions>),
      portfolioScope: u.scope,
      contactsAccess: 'FULL',
      companiesAccess: 'FULL',
      dealsFunnelAccess: 'FULL',
      ticketsServiceDeskAccess: 'FULL',
    };
  }
  const cAna = repo.createContact({ firstName: 'Cliente', lastName: 'DaAna', email: 'cliente.ana@empresa-a.com.br', ownerId: 'usr-ana', ownerName: 'Ana Vendas' });
  const cBruno = repo.createContact({ firstName: 'Cliente', lastName: 'DoBruno', email: 'cliente.bruno@empresa-b.com.br', ownerId: 'usr-bruno', ownerName: 'Bruno Vendas' });
  const cCarla = repo.createContact({ firstName: 'Zuleica', lastName: 'DaCarla', email: 'zuleica@empresa-c.com.br', ownerId: 'usr-carla', ownerName: 'Carla Outra' });
  const coAna = repo.createCompany({ name: 'Empresa Ana Ltda', ownerName: 'Ana Vendas', cnpj: CNPJ_RAW });
  const coCarla = repo.createCompany({ name: 'Empresa Carla SA', ownerName: 'Carla Outra' });
  const dAna = repo.createDeal({ title: 'Deal da Ana', value: 1000, ownerId: 'usr-ana', ownerName: 'Ana Vendas', companyId: coAna.id, contactId: cAna.id });
  const dCarla = repo.createDeal({ title: 'Deal da Carla', value: 2000, ownerId: 'usr-carla', ownerName: 'Carla Outra', companyId: coCarla.id });
  const tAna = repo.createServiceTicket({
    subject: `Falha no link do CNPJ ${CNPJ_RAW}`,
    description: 'Conta corrente 12345-6 bloqueada no banco',
    category: 'SUPPORT',
    priority: 'HIGH',
    status: 'OPEN',
    channel: 'EMAIL',
    contactId: cAna.id,
    companyId: coAna.id,
    pipelineId: 'pl-tec',
  } as never);
  repo.addTicketComment(tAna.id, { author: 'Agente NOC', authorRole: 'AGENT', isInternal: true, body: 'nota interna secreta' });
  repo.addTicketComment(tAna.id, { author: 'Agente NOC', authorRole: 'AGENT', isInternal: false, body: 'resposta publica ao cliente' });
  const tCarla = repo.createServiceTicket({
    subject: 'Chamado da carteira da Carla',
    description: 'sem dados sensiveis',
    category: 'SUPPORT',
    priority: 'LOW',
    status: 'OPEN',
    channel: 'EMAIL',
    contactId: cCarla.id,
    companyId: coCarla.id,
    pipelineId: 'pl-fin',
  } as never);
  const store = new TestOnlyMemoryIntegrationStore();
  const clock = { now: Date.now() };
  const deps: IntegrationDeps = {
    store,
    createDataPort: () => new RouterDataPort(router),
    now: () => new Date(clock.now),
    limits: { ...defaultLimits(), perCredentialPerMinute: 1000, oauthPerIpPerMinute: 1000, ...limits },
  };
  return {
    repo,
    router,
    store,
    deps,
    clock,
    ids: {
      cAna: cAna.id,
      cBruno: cBruno.id,
      cCarla: cCarla.id,
      coAna: coAna.id,
      coCarla: coCarla.id,
      dAna: dAna.id,
      dCarla: dCarla.id,
      tAna: tAna.id,
      tAnaKey: tAna.key,
      tCarla: tCarla.id,
    },
  };
}

function req(method: string, path: string, opts: { headers?: Record<string, string>; body?: unknown; query?: Record<string, string>; session?: string } = {}): IntegrationHttpRequest {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.headers || {})) headers[k.toLowerCase()] = v;
  return {
    method,
    path,
    headers,
    query: opts.query || {},
    body: opts.body,
    cookies: opts.session ? { stihub_session: opts.session } : {},
    ip: '200.10.10.10',
    origin: ORIGIN,
  };
}

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const body = (r: IntegrationHttpResponse) => r.body as any;

async function createKey(env: Env, input: Record<string, unknown>, who = ADMIN): Promise<{ res: IntegrationHttpResponse; secret: string; id: string }> {
  const res = await handleIamIntegrationKeys(req('POST', '/api/iam/integration-keys', { session: session(who), body: input }), env.deps);
  return { res, secret: body(res)?.secret, id: body(res)?.data?.id };
}

const ALL_CRM = ['crm:contacts:read', 'crm:contacts:write', 'crm:companies:read', 'crm:companies:write', 'crm:deals:read', 'crm:deals:write', 'crm:activities:read', 'crm:activities:write', 'crm:pipelines:read'];

async function keyFor(env: Env, owner: string, portfolioScope: string, scopes: string[], extra: Record<string, unknown> = {}) {
  const k = await createKey(env, {
    name: `chave ${owner} ${portfolioScope}`,
    scopes,
    portfolioScope,
    moduleAccess: { crm: true, chamados: scopes.some((s) => s.startsWith('tickets:')) },
    ownerUserId: owner,
    ...extra,
  });
  assert.equal(k.res.status, 201, JSON.stringify(k.res.body));
  return k.secret;
}

// ---------------------------------------------------------------------------
describe('API v1 + MCP: 503 sem Postgres (nunca JSON/tmp)', () => {
  it('resolveIntegrationDeps sem DATABASE_URL e sem injecao => store null', () => {
    const prev = process.env.DATABASE_URL;
    const prev2 = process.env.DATABASE_POSTGRES_URL;
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_POSTGRES_URL;
    try {
      setIntegrationDepsForTests(null);
      assert.equal(resolveIntegrationDeps().store, null);
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL = prev;
      if (prev2 !== undefined) process.env.DATABASE_POSTGRES_URL = prev2;
    }
  });

  it('/api/v1/*, /api/mcp, /api/oauth/{register,token,revoke} e IAM integration-keys => 503 problem+json', async () => {
    const env = makeEnv();
    const deps: IntegrationDeps = { ...env.deps, store: null };
    const responses = [
      await handleRestV1(req('GET', '/api/v1/contacts', { headers: bearer('stihub_int_000000000000_' + 'a'.repeat(43)) }), deps),
      await handleRestV1(req('GET', '/api/v1/openapi.json'), deps),
      await handleMcp(req('POST', '/api/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'initialize' } }), deps),
      await handleOAuth(req('POST', '/api/oauth/register', { body: { redirect_uris: ['https://c.example/cb'] } }), deps),
      await handleOAuth(req('POST', '/api/oauth/token', { body: { grant_type: 'authorization_code' } }), deps),
      await handleOAuth(req('POST', '/api/oauth/revoke', { body: { token: 'x' } }), deps),
      await handleIamIntegrationKeys(req('GET', '/api/iam/integration-keys', { session: session(ADMIN) }), deps),
    ];
    for (const r of responses) {
      assert.equal(r.status, 503);
      assert.match(r.headers['Content-Type'], /application\/problem\+json/);
      assert.equal(body(r).code, 'INTEGRATION_STORE_UNAVAILABLE');
    }
  });

  it('store em memoria recusa NODE_ENV != test e schema Postgres tem todas as tabelas', () => {
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = 'production';
    try {
      assert.throws(() => new TestOnlyMemoryIntegrationStore());
      assert.throws(() => setIntegrationDepsForTests({}));
    } finally {
      (process.env as Record<string, string>).NODE_ENV = prev || 'test';
    }
    for (const t of ['integration_api_keys', 'api_idempotency_keys', 'integration_audit_logs', 'api_rate_limits', 'oauth_clients', 'oauth_auth_codes', 'oauth_tokens']) {
      assert.ok(INTEGRATION_SCHEMA_SQL.includes(`CREATE TABLE IF NOT EXISTS ${t}`), t);
    }
    assert.match(INTEGRATION_SCHEMA_SQL, /key_hash TEXT NOT NULL UNIQUE/);
    assert.match(INTEGRATION_SCHEMA_SQL, /code_challenge_method = 'S256'/);
  });
});

// ---------------------------------------------------------------------------
describe('IAM: chaves de integracao (sessao 2FA + ADMIN, segredo 1x, hash, revogacao)', () => {
  it('nega sem sessao, sem 2FA e sem ADMIN', async () => {
    const env = makeEnv();
    const noSession = await handleIamIntegrationKeys(req('GET', '/api/iam/integration-keys'), env.deps);
    assert.equal(noSession.status, 401);
    const noMfa = await handleIamIntegrationKeys(req('GET', '/api/iam/integration-keys', { session: session({ ...ADMIN, mfa: false }) }), env.deps);
    assert.equal(noMfa.status, 401);
    const notAdmin = await handleIamIntegrationKeys(req('POST', '/api/iam/integration-keys', { session: session(BRUNO), body: {} }), env.deps);
    assert.equal(notAdmin.status, 403);
    assert.equal(body(notAdmin).code, 'IAM_ADMIN_FORBIDDEN');
  });

  it('cria exibindo o segredo uma vez; lista sem hash/segredo; store guarda so SHA-256', async () => {
    const env = makeEnv();
    const k = await createKey(env, { name: 'ERP externo', scopes: ['crm:contacts:read'], portfolioScope: 'TODOS', moduleAccess: { crm: true, chamados: false } });
    assert.equal(k.res.status, 201);
    assert.match(k.secret, /^stihub_int_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/);
    assert.equal(body(k.res).data.keyHash, undefined);
    const list = await handleIamIntegrationKeys(req('GET', '/api/iam/integration-keys', { session: session(ADMIN) }), env.deps);
    assert.equal(list.status, 200);
    const listJson = JSON.stringify(list.body);
    assert.ok(!listJson.includes(k.secret));
    assert.ok(!listJson.includes(sha(k.secret)));
    assert.ok(!/keyHash|key_hash|secret/i.test(listJson.replace(/"warning":"[^"]*"/, '')));
    const stored = [...env.store.keys.values()][0];
    assert.equal(stored.keyHash, sha(k.secret));
    assert.ok(!JSON.stringify([...env.store.keys.values()]).includes(k.secret));
    assert.ok(!JSON.stringify(env.store.audit).includes(k.secret));
    // a chave funciona
    const ok = await handleRestV1(req('GET', '/api/v1/contacts', { headers: bearer(k.secret) }), env.deps);
    assert.equal(ok.status, 200);
  });

  it('revoga e bloqueia o uso; chave expirada => 401', async () => {
    const env = makeEnv();
    const k = await createKey(env, { name: 'temporaria', scopes: ['crm:contacts:read'], portfolioScope: 'TODOS', moduleAccess: { crm: true, chamados: false } });
    const rv = await handleIamIntegrationKeys(req('POST', `/api/iam/integration-keys/${k.id}/revoke`, { session: session(ADMIN) }), env.deps);
    assert.equal(rv.status, 200);
    assert.equal(body(rv).data.status, 'REVOKED');
    const after = await handleRestV1(req('GET', '/api/v1/contacts', { headers: bearer(k.secret) }), env.deps);
    assert.equal(after.status, 401);
    assert.equal(body(after).code, 'TOKEN_REVOKED');

    const exp = await createKey(env, {
      name: 'expira',
      scopes: ['crm:contacts:read'],
      portfolioScope: 'TODOS',
      moduleAccess: { crm: true, chamados: false },
      expiresAt: new Date(env.clock.now + 60_000).toISOString(),
    });
    assert.equal(exp.res.status, 201);
    env.clock.now += 120_000;
    const expired = await handleRestV1(req('GET', '/api/v1/contacts', { headers: bearer(exp.secret) }), env.deps);
    assert.equal(expired.status, 401);
    assert.equal(body(expired).code, 'TOKEN_EXPIRED');
    const bogus = await handleRestV1(req('GET', '/api/v1/contacts', { headers: bearer('stihub_int_abcdefabcdef_' + 'x'.repeat(43)) }), env.deps);
    assert.equal(bogus.status, 401);
  });
});

// ---------------------------------------------------------------------------
describe('Travas CISO: escopos bloqueados fora da criacao, do OpenAPI e do MCP', () => {
  it('rejeita DELETE, merge, sequencias, fiscal/financeiro, GestaoClick e IAM na criacao', async () => {
    const env = makeEnv();
    for (const s of ['crm:contacts:delete', 'crm:merge', 'crm:sequences:write', 'fiscal:nfe:write', 'financeiro:write', 'gestaoclick:write', 'iam:users:write', 'admin:all', '*']) {
      const k = await createKey(env, { name: 'x', scopes: ['crm:contacts:read', s], portfolioScope: 'TODOS', moduleAccess: { crm: true, chamados: false } });
      assert.equal(k.res.status, 400, s);
      assert.equal(body(k.res).code, 'SCOPE_BLOCKED', s);
      assert.equal(k.secret, undefined);
      assert.ok(isBlockedScope(s), s);
    }
    const unknown = await createKey(env, { name: 'x', scopes: ['crm:foo:read'], portfolioScope: 'TODOS', moduleAccess: { crm: true, chamados: false } });
    assert.equal(body(unknown.res).code, 'SCOPE_UNKNOWN');
    assert.equal(validateRequestedScopes('tickets:read crm:deals:write').ok, true);
    assert.equal(env.store.keys.size, 0);
  });

  it('OpenAPI e tools MCP nao expoem operacoes bloqueadas; DELETE na v1 => 405', async () => {
    const doc = buildOpenApiDocument();
    for (const [p, ops] of Object.entries(doc.paths as Record<string, Record<string, unknown>>)) {
      assert.ok(!('delete' in ops), p);
      assert.ok(!/merge|sequence|fiscal|financ|gestaoclick|iam|admin/i.test(p), p);
    }
    for (const uc of INTEGRATION_USE_CASES) {
      assert.ok(!/delete|merge|sequence|fiscal|gestaoclick|iam/i.test(uc.toolName), uc.toolName);
      assert.notEqual(uc.method as string, 'DELETE');
    }
    const env = makeEnv();
    const key = await keyFor(env, 'usr-api-admin', 'TODOS', ALL_CRM);
    const del = await handleRestV1(req('DELETE', `/api/v1/contacts/${env.ids.cAna}`, { headers: bearer(key) }), env.deps);
    assert.equal(del.status, 405);
    assert.ok(!(del.headers.Allow || '').includes('DELETE'));
    const merge = await handleRestV1(req('POST', '/api/v1/contacts/merge', { headers: bearer(key), body: {} }), env.deps);
    assert.ok([404, 405].includes(merge.status));
    const dcr = await handleOAuth(req('POST', '/api/oauth/register', { body: { redirect_uris: ['https://c.example/cb'], scope: 'crm:contacts:read crm:contacts:delete' } }), env.deps);
    assert.equal(dcr.status, 400);
    assert.equal(body(dcr).error, 'invalid_client_metadata');
  });
});

// ---------------------------------------------------------------------------
describe('portfolioScope e moduleAccess aplicados no servidor (CRM e Chamados)', () => {
  it('PROPRIOS: listagem, busca, GET e escrita so na propria carteira', async () => {
    const env = makeEnv();
    const key = await keyFor(env, 'usr-bruno', 'PROPRIOS', ALL_CRM);
    const list = await handleRestV1(req('GET', '/api/v1/contacts', { headers: bearer(key) }), env.deps);
    assert.equal(list.status, 200);
    const ids = body(list).data.map((c: { id: string }) => c.id);
    assert.ok(ids.includes(env.ids.cBruno));
    assert.ok(!ids.includes(env.ids.cAna));
    assert.ok(!ids.includes(env.ids.cCarla));
    const search = await handleRestV1(req('GET', '/api/v1/contacts', { headers: bearer(key), query: { search: 'Zuleica' } }), env.deps);
    assert.equal(body(search).data.length, 0);
    const getOther = await handleRestV1(req('GET', `/api/v1/contacts/${env.ids.cCarla}`, { headers: bearer(key) }), env.deps);
    assert.equal(getOther.status, 404);
    const patchOther = await handleRestV1(req('PATCH', `/api/v1/contacts/${env.ids.cCarla}`, { headers: bearer(key), body: { jobTitle: 'hack' } }), env.deps);
    assert.equal(patchOther.status, 404);
    const dealOther = await handleRestV1(req('GET', `/api/v1/deals/${env.ids.dCarla}`, { headers: bearer(key) }), env.deps);
    assert.equal(dealOther.status, 404);
    const companies = await handleRestV1(req('GET', '/api/v1/companies', { headers: bearer(key) }), env.deps);
    assert.ok(!body(companies).data.some((c: { id: string }) => c.id === env.ids.coCarla));
    const createForOther = await handleRestV1(req('POST', '/api/v1/contacts', { headers: bearer(key), body: { firstName: 'Novo', ownerId: 'usr-carla' } }), env.deps);
    assert.equal(createForOther.status, 403);
    assert.equal(body(createForOther).code, 'OWNER_OUT_OF_PORTFOLIO');
    const created = await handleRestV1(req('POST', '/api/v1/contacts', { headers: bearer(key), body: { firstName: 'Novo', lastName: 'Lead', email: 'novo.lead@cliente.com.br' } }), env.deps);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(body(created).data.ownerId, 'usr-bruno');
    const patchOwn = await handleRestV1(req('PATCH', `/api/v1/contacts/${body(created).data.id}`, { headers: bearer(key), body: { jobTitle: 'CTO' } }), env.deps);
    assert.equal(patchOwn.status, 200);
    assert.equal(body(patchOwn).data.jobTitle, 'CTO');
    const activityOther = await handleRestV1(req('POST', '/api/v1/activities', { headers: bearer(key), body: { type: 'NOTE', title: 'x', contactId: env.ids.cCarla } }), env.deps);
    assert.equal(activityOther.status, 404);
    const activity = await handleRestV1(req('POST', '/api/v1/activities', { headers: bearer(key), body: { type: 'NOTE', title: 'Ligacao feita', contactId: env.ids.cBruno } }), env.deps);
    assert.equal(activity.status, 201);
    assert.match(body(activity).data.actor, /Integracao API/);
    const acts = await handleRestV1(req('GET', '/api/v1/activities', { headers: bearer(key) }), env.deps);
    assert.ok(body(acts).data.every((a: { contactId: string | null }) => a.contactId === env.ids.cBruno || a.contactId === body(created).data.id));
  });

  it('EQUIPE ve dono + equipe; TODOS ve tudo; carteira/modulo nao excedem o usuario dono', async () => {
    const env = makeEnv();
    const team = await keyFor(env, 'usr-ana', 'EQUIPE', ['crm:contacts:read', 'crm:deals:read'], { teamMemberIds: ['usr-bruno'] });
    const list = await handleRestV1(req('GET', '/api/v1/contacts', { headers: bearer(team), query: { limit: '100' } }), env.deps);
    const ids = body(list).data.map((c: { id: string }) => c.id);
    assert.ok(ids.includes(env.ids.cAna) && ids.includes(env.ids.cBruno));
    assert.ok(!ids.includes(env.ids.cCarla));
    const all = await keyFor(env, 'usr-api-admin', 'TODOS', ['crm:contacts:read']);
    const listAll = await handleRestV1(req('GET', '/api/v1/contacts', { headers: bearer(all), query: { limit: '100', search: 'DaCarla' } }), env.deps);
    assert.ok(body(listAll).data.some((c: { id: string }) => c.id === env.ids.cCarla));
    // ana (EQUIPE) nao pode ter chave TODOS
    const exceed = await createKey(env, { name: 'x', scopes: ['crm:contacts:read'], portfolioScope: 'TODOS', moduleAccess: { crm: true, chamados: false }, ownerUserId: 'usr-ana' });
    assert.equal(exceed.res.status, 422);
    assert.equal(body(exceed.res).code, 'PORTFOLIO_EXCEEDS_OWNER');
    // escopo de chamados exige moduleAccess.chamados
    const mismatch = await createKey(env, { name: 'x', scopes: ['tickets:read'], portfolioScope: 'PROPRIOS', moduleAccess: { crm: true, chamados: false }, ownerUserId: 'usr-bruno' });
    assert.equal(body(mismatch.res).code, 'SCOPE_MODULE_MISMATCH');
    // paginacao por cursor e limit max 100
    const page1 = await handleRestV1(req('GET', '/api/v1/contacts', { headers: bearer(all), query: { limit: '1' } }), env.deps);
    assert.equal(body(page1).data.length, 1);
    const page2 = await handleRestV1(req('GET', '/api/v1/contacts', { headers: bearer(all), query: { limit: '1', cursor: body(page1).page.nextCursor } }), env.deps);
    assert.notEqual(body(page2).data[0].id, body(page1).data[0].id);
    const tooBig = await handleRestV1(req('GET', '/api/v1/contacts', { headers: bearer(all), query: { limit: '500' } }), env.deps);
    assert.equal(tooBig.status, 400);
    const unknownParam = await handleRestV1(req('GET', '/api/v1/contacts', { headers: bearer(all), query: { ownerId: 'x' } }), env.deps);
    assert.equal(unknownParam.status, 400);
  });

  it('moduleAccess: usuario dono sem Chamados => 403 mesmo com escopo; dono inativo => 401', async () => {
    const env = makeEnv();
    const key = await keyFor(env, 'usr-bruno', 'PROPRIOS', ['crm:contacts:read', 'tickets:read']);
    const bruno = env.repo.getRbacState().users.find((u) => u.id === 'usr-bruno')!;
    bruno.moduleAccess = { crm: true, erp: false, chamados: false };
    const denied = await handleRestV1(req('GET', '/api/v1/tickets', { headers: bearer(key) }), env.deps);
    assert.equal(denied.status, 403);
    assert.equal(body(denied).code, 'MODULE_FORBIDDEN');
    bruno.active = false;
    const inactive = await handleRestV1(req('GET', '/api/v1/contacts', { headers: bearer(key) }), env.deps);
    assert.equal(inactive.status, 401);
    assert.equal(body(inactive).code, 'CREDENTIAL_OWNER_INACTIVE');
    const crmOnly = await keyFor(env, 'usr-ana', 'PROPRIOS', ['crm:contacts:read']);
    const noScope = await handleRestV1(req('GET', '/api/v1/tickets', { headers: bearer(crmOnly) }), env.deps);
    assert.equal(noScope.status, 403);
    assert.equal(body(noScope).code, 'SCOPE_INSUFFICIENT');
  });

  it('Chamados: carteira em listagem, GET e mutacao', async () => {
    const env = makeEnv();
    const bruno = await keyFor(env, 'usr-bruno', 'PROPRIOS', ['tickets:read', 'tickets:write']);
    const list = await handleRestV1(req('GET', '/api/v1/tickets', { headers: bearer(bruno) }), env.deps);
    assert.equal(list.status, 200);
    assert.ok(!body(list).data.some((t: { id: string }) => t.id === env.ids.tAna || t.id === env.ids.tCarla));
    const get = await handleRestV1(req('GET', `/api/v1/tickets/${env.ids.tAnaKey}`, { headers: bearer(bruno) }), env.deps);
    assert.equal(get.status, 404);
    const patch = await handleRestV1(req('PATCH', `/api/v1/tickets/${env.ids.tAna}`, { headers: bearer(bruno), body: { status: 'IN_PROGRESS' } }), env.deps);
    assert.equal(patch.status, 404);
    const createOut = await handleRestV1(req('POST', '/api/v1/tickets', { headers: bearer(bruno), body: { queue: 'TEC', subject: 'x', companyId: env.ids.coCarla } }), env.deps);
    assert.equal(createOut.status, 403);
    const ana = await keyFor(env, 'usr-ana', 'PROPRIOS', ['tickets:read']);
    const anaList = await handleRestV1(req('GET', '/api/v1/tickets', { headers: bearer(ana) }), env.deps);
    const anaIds = body(anaList).data.map((t: { id: string }) => t.id);
    assert.ok(anaIds.includes(env.ids.tAna));
    assert.ok(!anaIds.includes(env.ids.tCarla));
  });
});

// ---------------------------------------------------------------------------
describe('SetaDesk na API v1: mascara, busca no servidor, TEC-/FIN-, PATCH strict e comentario interno', () => {
  it('maskTicketForResponse em lista e detalhe; busca so por CNPJ completo; comentario interno oculto sem escopo', async () => {
    const env = makeEnv();
    const key = await keyFor(env, 'usr-ana', 'PROPRIOS', ['tickets:read']);
    const list = await handleRestV1(req('GET', '/api/v1/tickets', { headers: bearer(key) }), env.deps);
    const t = body(list).data.find((x: { id: string }) => x.id === env.ids.tAna);
    assert.ok(t);
    assert.ok(!t.subject.includes(CNPJ_RAW));
    assert.match(t.subject, /11\.222\.\*\*\*\/\*\*\*\*-81/);
    assert.ok(!t.description.includes('12345-6'));
    assert.match(t.company.cnpj, /\*\*\*/);
    const full = await handleRestV1(req('GET', '/api/v1/tickets', { headers: bearer(key), query: { search: '11222333000181' } }), env.deps);
    assert.ok(body(full).data.some((x: { id: string }) => x.id === env.ids.tAna));
    const partial = await handleRestV1(req('GET', '/api/v1/tickets', { headers: bearer(key), query: { search: '333/0001' } }), env.deps);
    assert.equal(body(partial).data.length, 0);
    const oracle = await handleRestV1(req('GET', '/api/v1/tickets', { headers: bearer(key), query: { search: 'nota interna secreta' } }), env.deps);
    assert.equal(body(oracle).data.length, 0);
    const detail = await handleRestV1(req('GET', `/api/v1/tickets/${env.ids.tAnaKey}`, { headers: bearer(key) }), env.deps);
    assert.equal(detail.status, 200);
    const comments = body(detail).data.comments as Array<{ body: string; isInternal: boolean }>;
    assert.ok(comments.some((c) => c.body === 'resposta publica ao cliente'));
    assert.ok(!comments.some((c) => c.isInternal));
    const withNotes = await keyFor(env, 'usr-ana', 'PROPRIOS', ['tickets:read', 'tickets:internal_notes:read']);
    const detail2 = await handleRestV1(req('GET', `/api/v1/tickets/${env.ids.tAna}`, { headers: bearer(withNotes) }), env.deps);
    assert.ok((body(detail2).data.comments as Array<{ isInternal: boolean }>).some((c) => c.isInternal));
  });

  it('abre TEC- e FIN- conforme a fila; fila invalida => 422; filas listadas', async () => {
    const env = makeEnv();
    const key = await keyFor(env, 'usr-ana', 'PROPRIOS', ['tickets:read', 'tickets:write']);
    const queues = await handleRestV1(req('GET', '/api/v1/tickets/queues', { headers: bearer(key) }), env.deps);
    assert.equal(queues.status, 200);
    const prefixes = body(queues).data.map((q: { prefix: string }) => q.prefix);
    assert.ok(prefixes.includes('TEC') && prefixes.includes('FIN'));
    const tec = await handleRestV1(req('POST', '/api/v1/tickets', { headers: bearer(key), body: { queue: 'TEC', subject: 'Sem sinal na filial', contactId: env.ids.cAna } }), env.deps);
    assert.equal(tec.status, 201, JSON.stringify(tec.body));
    assert.match(body(tec).data.key, /^TEC-\d+$/);
    const fin = await handleRestV1(req('POST', '/api/v1/tickets', { headers: bearer(key), body: { queue: 'fin', subject: 'Segunda via de boleto', companyId: env.ids.coAna } }), env.deps);
    assert.equal(fin.status, 201, JSON.stringify(fin.body));
    assert.match(body(fin).data.key, /^FIN-\d+$/);
    const bad = await handleRestV1(req('POST', '/api/v1/tickets', { headers: bearer(key), body: { queue: 'XYZ', subject: 'x', contactId: env.ids.cAna } }), env.deps);
    assert.equal(bad.status, 422);
    assert.equal(body(bad).code, 'QUEUE_INVALID');
  });

  it('PATCH strict: valor mascarado => 422, campo protegido => 400, valido => 200', async () => {
    const env = makeEnv();
    const key = await keyFor(env, 'usr-ana', 'PROPRIOS', ['tickets:read', 'tickets:write']);
    const detail = await handleRestV1(req('GET', `/api/v1/tickets/${env.ids.tAna}`, { headers: bearer(key) }), env.deps);
    const maskedSubject = body(detail).data.subject as string;
    const masked = await handleRestV1(req('PATCH', `/api/v1/tickets/${env.ids.tAna}`, { headers: bearer(key), body: { subject: maskedSubject } }), env.deps);
    assert.equal(masked.status, 422);
    assert.equal(body(masked).code, 'TICKET_PATCH_MASKED_VALUE');
    assert.equal(env.repo.getServiceTicketById(env.ids.tAna)!.subject.includes(CNPJ_RAW), true);
    const protectedField = await handleRestV1(req('PATCH', `/api/v1/tickets/${env.ids.tAna}`, { headers: bearer(key), body: { csatScore: 5, comments: [] } }), env.deps);
    assert.equal(protectedField.status, 400);
    assert.deepEqual([...body(protectedField).fields].sort(), ['comments', 'csatScore']);
    const ok = await handleRestV1(req('PATCH', `/api/v1/tickets/${env.ids.tAna}`, { headers: bearer(key), body: { status: 'IN_PROGRESS', priority: 'CRITICAL' } }), env.deps);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(body(ok).data.status, 'IN_PROGRESS');
    assert.ok(!body(ok).data.subject.includes(CNPJ_RAW));
  });

  it('comentario interno exige tickets:internal_notes:write; publico com tickets:write', async () => {
    const env = makeEnv();
    const key = await keyFor(env, 'usr-ana', 'PROPRIOS', ['tickets:read', 'tickets:write']);
    const internal = await handleRestV1(req('POST', `/api/v1/tickets/${env.ids.tAna}/comments`, { headers: bearer(key), body: { body: 'nota', visibility: 'internal' } }), env.deps);
    assert.equal(internal.status, 403);
    assert.equal(body(internal).requiredScope, 'tickets:internal_notes:write');
    const pub = await handleRestV1(req('POST', `/api/v1/tickets/${env.ids.tAna}/comments`, { headers: bearer(key), body: { body: 'Estamos verificando', visibility: 'public' } }), env.deps);
    assert.equal(pub.status, 201, JSON.stringify(pub.body));
    const last = env.repo.getServiceTicketById(env.ids.tAna)!.comments.at(-1)!;
    assert.equal(last.isInternal, false);
    assert.equal(last.authorRole, 'AGENT');
    const notes = await keyFor(env, 'usr-ana', 'PROPRIOS', ['tickets:read', 'tickets:write', 'tickets:internal_notes:write']);
    const okInternal = await handleRestV1(req('POST', `/api/v1/tickets/${env.ids.tAnaKey}/comments`, { headers: bearer(notes), body: { body: 'nota da integracao', visibility: 'internal' } }), env.deps);
    assert.equal(okInternal.status, 201);
    assert.equal(env.repo.getServiceTicketById(env.ids.tAna)!.comments.at(-1)!.isInternal, true);
    const maskedComment = await handleRestV1(req('POST', `/api/v1/tickets/${env.ids.tAna}/comments`, { headers: bearer(notes), body: { body: 'CNPJ 11.222.***/****-81', visibility: 'internal' } }), env.deps);
    assert.equal(maskedComment.status, 422);
  });
});

// ---------------------------------------------------------------------------
describe('Idempotency-Key e rate-limit distribuido', () => {
  it('replay devolve a mesma resposta sem duplicar; payload diferente => 409', async () => {
    const env = makeEnv();
    const key = await keyFor(env, 'usr-bruno', 'PROPRIOS', ALL_CRM);
    const before = env.repo.listContacts().length;
    const payload = { firstName: 'Idem', lastName: 'Potente', email: 'idem@cliente.com.br' };
    const h = { ...bearer(key), 'Idempotency-Key': 'idem-key-0001' };
    const r1 = await handleRestV1(req('POST', '/api/v1/contacts', { headers: h, body: payload }), env.deps);
    assert.equal(r1.status, 201);
    const r2 = await handleRestV1(req('POST', '/api/v1/contacts', { headers: h, body: { ...payload } }), env.deps);
    assert.equal(r2.status, 201);
    assert.equal(r2.headers['Idempotent-Replayed'], 'true');
    assert.equal(body(r2).data.id, body(r1).data.id);
    assert.equal(env.repo.listContacts().length, before + 1);
    const r3 = await handleRestV1(req('POST', '/api/v1/contacts', { headers: h, body: { ...payload, firstName: 'Outro' } }), env.deps);
    assert.equal(r3.status, 409);
    assert.equal(body(r3).code, 'IDEMPOTENCY_KEY_REUSED');
    const badKey = await handleRestV1(req('POST', '/api/v1/contacts', { headers: { ...bearer(key), 'Idempotency-Key': 'x' }, body: payload }), env.deps);
    assert.equal(badKey.status, 400);
  });

  it('429 com X-RateLimit-* e Retry-After apos o limite por credencial', async () => {
    const env = makeEnv({ perCredentialPerMinute: 3 });
    const key = await keyFor(env, 'usr-bruno', 'PROPRIOS', ['crm:contacts:read']);
    for (let i = 0; i < 3; i++) {
      const ok = await handleRestV1(req('GET', '/api/v1/contacts', { headers: bearer(key) }), env.deps);
      assert.equal(ok.status, 200);
      assert.equal(ok.headers['X-RateLimit-Limit'], '3');
    }
    const limited = await handleRestV1(req('GET', '/api/v1/contacts', { headers: bearer(key) }), env.deps);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers['Retry-After']) >= 1);
    assert.equal(limited.headers['X-RateLimit-Remaining'], '0');
    assert.match(limited.headers['Content-Type'], /problem\+json/);
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/v1/openapi.json protegido e OpenAPI 3.1 valido', () => {
  it('401 sem auth; 403 sem openapi:read; 200 com Bearer ou sessao 2FA; deterministico', async () => {
    const env = makeEnv();
    const anon = await handleRestV1(req('GET', '/api/v1/openapi.json'), env.deps);
    assert.equal(anon.status, 401);
    assert.match(anon.headers['Content-Type'], /problem\+json/);
    const noScope = await keyFor(env, 'usr-bruno', 'PROPRIOS', ['crm:contacts:read']);
    assert.equal((await handleRestV1(req('GET', '/api/v1/openapi.json', { headers: bearer(noScope) }), env.deps)).status, 403);
    const withScope = await keyFor(env, 'usr-bruno', 'PROPRIOS', ['openapi:read']);
    const doc = await handleRestV1(req('GET', '/api/v1/openapi.json', { headers: bearer(withScope) }), env.deps);
    assert.equal(doc.status, 200);
    const d = body(doc);
    assert.equal(d.openapi, '3.1.0');
    assert.ok(d.info.title && d.info.version);
    for (const p of ['/api/v1/contacts', '/api/v1/contacts/{id}', '/api/v1/companies', '/api/v1/deals/{id}', '/api/v1/activities', '/api/v1/pipelines', '/api/v1/tickets', '/api/v1/tickets/{id}', '/api/v1/tickets/{id}/comments', '/api/v1/tickets/queues']) {
      assert.ok(d.paths[p], p);
    }
    assert.ok(d.paths['/api/v1/contacts'].get && d.paths['/api/v1/contacts'].post);
    assert.equal(d.paths['/api/v1/contacts/{id}'].patch.parameters[0].in, 'path');
    assert.equal(d.paths['/api/v1/tickets'].post.requestBody.content['application/json'].schema.additionalProperties, false);
    assert.ok(d.components.securitySchemes.bearerAuth && d.components.securitySchemes.oauth2);
    const ops = Object.values(d.paths).flatMap((o: any) => Object.values(o)) as Array<{ operationId: string }>;
    assert.equal(new Set(ops.map((o) => o.operationId)).size, ops.length);
    assert.equal(JSON.stringify(buildOpenApiDocument()), JSON.stringify(buildOpenApiDocument()));
    const viaSession = await handleRestV1(req('GET', '/api/v1/openapi.json', { session: session(BRUNO) }), env.deps);
    assert.equal(viaSession.status, 200);
    const sessionOnData = await handleRestV1(req('GET', '/api/v1/contacts', { session: session(ADMIN) }), env.deps);
    assert.equal(sessionOnData.status, 401);
  });
});

// ---------------------------------------------------------------------------
function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function oauthAuthorize(env: Env, clientId: string, redirect: string, scope: string, who = ANA, portfolio = 'PROPRIOS') {
  const { verifier, challenge } = pkcePair();
  const q = { response_type: 'code', client_id: clientId, redirect_uri: redirect, scope, state: 'st-123', code_challenge: challenge, code_challenge_method: 'S256' };
  const sess = session(who);
  const page = await handleOAuth(req('GET', '/api/oauth/authorize', { query: q, session: sess }), env.deps);
  assert.equal(page.status, 200, JSON.stringify(page));
  const csrf = /name="csrf" value="([^"]+)"/.exec(page.text || '')?.[1];
  assert.ok(csrf);
  const post = await handleOAuth(req('POST', '/api/oauth/authorize', { session: sess, body: { ...q, csrf, decision: 'approve', portfolio_scope: portfolio } }), env.deps);
  assert.equal(post.status, 302);
  const u = new URL(post.redirect!);
  assert.equal(u.searchParams.get('state'), 'st-123');
  assert.equal(u.searchParams.get('iss'), ORIGIN);
  return { code: u.searchParams.get('code')!, verifier };
}

const tokenReq = (b: Record<string, string>) => req('POST', '/api/oauth/token', { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: b });
const rpc = (token: string, msg: unknown) => req('POST', '/api/mcp', { headers: { ...bearer(token), accept: 'application/json, text/event-stream' }, body: msg });

describe('OAuth 2.1 + DCR + MCP remoto', () => {
  it('metadata RFC 8414 / RFC 9728 e validacao de redirect_uri', () => {
    const as = handleWellKnown(req('GET', '/.well-known/oauth-authorization-server'));
    assert.equal(as.status, 200);
    assert.equal(body(as).issuer, ORIGIN);
    assert.deepEqual(body(as).code_challenge_methods_supported, ['S256']);
    assert.equal(body(as).registration_endpoint, `${ORIGIN}/api/oauth/register`);
    const pr = handleWellKnown(req('GET', '/.well-known/oauth-protected-resource/api/mcp'));
    assert.equal(body(pr).resource, `${ORIGIN}/api/mcp`);
    assert.deepEqual(body(pr).authorization_servers, [ORIGIN]);
    assert.ok(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback'));
    assert.ok(isAllowedRedirectUri('http://127.0.0.1:33418/callback'));
    assert.ok(!isAllowedRedirectUri('http://evil.example/cb'));
    assert.ok(!isAllowedRedirectUri('javascript:alert(1)'));
    assert.ok(!isAllowedRedirectUri('https://ok.example/cb#frag'));
  });

  it('registro, authorize (sessao + PKCE S256), token (hashes), MCP filtrado por escopo, refresh com rotacao e reuso', async () => {
    const env = makeEnv();
    const redirect = 'https://client.example/callback';
    const reg = await handleOAuth(req('POST', '/api/oauth/register', { body: { client_name: 'Agente MCP', redirect_uris: [redirect], scope: 'crm:contacts:read tickets:read openapi:read' } }), env.deps);
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    const clientId = body(reg).client_id as string;
    assert.equal(body(reg).client_secret, undefined);
    const badReg = await handleOAuth(req('POST', '/api/oauth/register', { body: { redirect_uris: ['http://evil.example/cb'] } }), env.deps);
    assert.equal(body(badReg).error, 'invalid_redirect_uri');

    // sem sessao => login; sem PKCE => erro no redirect
    const noLogin = await handleOAuth(req('GET', '/api/oauth/authorize', { query: { response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: pkcePair().challenge, code_challenge_method: 'S256' } }), env.deps);
    assert.equal(noLogin.status, 302);
    assert.match(noLogin.redirect!, /\/login\?next=/);
    const noPkce = await handleOAuth(req('GET', '/api/oauth/authorize', { session: session(ANA), query: { response_type: 'code', client_id: clientId, redirect_uri: redirect } }), env.deps);
    assert.equal(new URL(noPkce.redirect!).searchParams.get('error'), 'invalid_request');
    const plain = await handleOAuth(req('GET', '/api/oauth/authorize', { session: session(ANA), query: { response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: pkcePair().challenge, code_challenge_method: 'plain' } }), env.deps);
    assert.equal(new URL(plain.redirect!).searchParams.get('error'), 'invalid_request');
    const wrongRedirect = await handleOAuth(req('GET', '/api/oauth/authorize', { session: session(ANA), query: { response_type: 'code', client_id: clientId, redirect_uri: 'https://evil.example/cb', code_challenge: pkcePair().challenge, code_challenge_method: 'S256' } }), env.deps);
    assert.equal(wrongRedirect.status, 400);
    assert.equal(wrongRedirect.redirect, undefined);
    const blockedScope = await handleOAuth(req('GET', '/api/oauth/authorize', { session: session(ANA), query: { response_type: 'code', client_id: clientId, redirect_uri: redirect, scope: 'crm:contacts:write', code_challenge: pkcePair().challenge, code_challenge_method: 'S256' } }), env.deps);
    assert.equal(new URL(blockedScope.redirect!).searchParams.get('error'), 'invalid_scope');

    const { code, verifier } = await oauthAuthorize(env, clientId, redirect, 'crm:contacts:read tickets:read');
    assert.match(code, /^stihub_oac_/);
    assert.ok(env.store.codes.has(sha(code)));
    assert.ok(!JSON.stringify([...env.store.codes.values()]).includes(code));

    const badVerifier = await handleOAuth(tokenReq({ grant_type: 'authorization_code', client_id: clientId, code: 'stihub_oac_' + 'A'.repeat(43), redirect_uri: redirect, code_verifier: verifier }), env.deps);
    assert.equal(body(badVerifier).error, 'invalid_grant');
    const tok = await handleOAuth(tokenReq({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: redirect, code_verifier: verifier }), env.deps);
    assert.equal(tok.status, 200, JSON.stringify(tok.body));
    assert.equal(tok.headers['Cache-Control'], 'no-store');
    const { access_token: access, refresh_token: refresh } = body(tok);
    assert.match(access, /^stihub_oat_/);
    assert.match(refresh, /^stihub_ort_/);
    const storedTokens = JSON.stringify([...env.store.tokens.values()]);
    assert.ok(!storedTokens.includes(access) && !storedTokens.includes(refresh));
    assert.ok(storedTokens.includes(sha(access)) && storedTokens.includes(sha(refresh)));

    // MCP
    const unauth = await handleMcp(req('POST', '/api/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'initialize' } }), env.deps);
    assert.equal(unauth.status, 401);
    assert.match(unauth.headers['WWW-Authenticate'], /resource_metadata="https:\/\/stihub\.test\/\.well-known\/oauth-protected-resource"/);
    const init = await handleMcp(rpc(access, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }), env.deps);
    assert.equal(init.status, 200);
    assert.equal(body(init).result.protocolVersion, '2025-06-18');
    assert.ok(body(init).result.capabilities.tools);
    const notif = await handleMcp(rpc(access, { jsonrpc: '2.0', method: 'notifications/initialized' }), env.deps);
    assert.equal(notif.status, 202);
    const ping = await handleMcp(rpc(access, { jsonrpc: '2.0', id: 'p', method: 'ping' }), env.deps);
    assert.deepEqual(body(ping).result, {});
    const tools = await handleMcp(rpc(access, { jsonrpc: '2.0', id: 2, method: 'tools/list' }), env.deps);
    const names = (body(tools).result.tools as Array<{ name: string; inputSchema: { type: string } }>).map((t) => t.name).sort();
    assert.deepEqual(names, ['crm_contacts_get', 'crm_contacts_list', 'tickets_get', 'tickets_list', 'tickets_queues_list']);
    assert.ok((body(tools).result.tools as Array<{ inputSchema: { type: string } }>).every((t) => t.inputSchema.type === 'object'));
    const call = await handleMcp(rpc(access, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'crm_contacts_list', arguments: { limit: 50 } } }), env.deps);
    const sc = body(call).result.structuredContent;
    assert.equal(body(call).result.isError, false);
    const contactIds = sc.data.map((c: { id: string }) => c.id);
    assert.ok(contactIds.includes(env.ids.cAna));
    assert.ok(!contactIds.includes(env.ids.cCarla) && !contactIds.includes(env.ids.cBruno));
    const forbidden = await handleMcp(rpc(access, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'tickets_create', arguments: {} } }), env.deps);
    assert.equal(body(forbidden).error.code, -32602);
    const unknownMethod = await handleMcp(rpc(access, { jsonrpc: '2.0', id: 5, method: 'resources/list' }), env.deps);
    assert.equal(body(unknownMethod).error.code, -32601);
    assert.equal((await handleMcp(req('GET', '/api/mcp', { headers: bearer(access) }), env.deps)).status, 405);
    assert.ok(env.store.audit.some((a) => a.channel === 'mcp' && a.action === 'tools/call:crm_contacts_list' && a.oauthClientId === clientId && a.statusCode === 200));
    assert.ok(!JSON.stringify(env.store.audit).includes(access));

    // refresh: rotacao + deteccao de reuso
    const r2 = await handleOAuth(tokenReq({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refresh }), env.deps);
    assert.equal(r2.status, 200);
    const access2 = body(r2).access_token;
    assert.notEqual(body(r2).refresh_token, refresh);
    assert.equal((await handleMcp(rpc(access, { jsonrpc: '2.0', id: 6, method: 'ping' }), env.deps)).status, 401);
    assert.equal((await handleMcp(rpc(access2, { jsonrpc: '2.0', id: 7, method: 'ping' }), env.deps)).status, 200);
    const reuse = await handleOAuth(tokenReq({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refresh }), env.deps);
    assert.equal(body(reuse).error, 'invalid_grant');
    assert.equal((await handleMcp(rpc(access2, { jsonrpc: '2.0', id: 8, method: 'ping' }), env.deps)).status, 401);

    // reuso do code => invalid_grant
    const replay = await handleOAuth(tokenReq({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: redirect, code_verifier: verifier }), env.deps);
    assert.equal(body(replay).error, 'invalid_grant');

    // revoke (RFC 7009)
    const f2 = await oauthAuthorize(env, clientId, redirect, 'crm:contacts:read');
    const t3 = body(await handleOAuth(tokenReq({ grant_type: 'authorization_code', client_id: clientId, code: f2.code, redirect_uri: redirect, code_verifier: f2.verifier }), env.deps));
    const wrongPkce = await oauthAuthorize(env, clientId, redirect, 'crm:contacts:read');
    assert.equal(body(await handleOAuth(tokenReq({ grant_type: 'authorization_code', client_id: clientId, code: wrongPkce.code, redirect_uri: redirect, code_verifier: pkcePair().verifier }), env.deps)).error, 'invalid_grant');
    const rv = await handleOAuth(req('POST', '/api/oauth/revoke', { body: { client_id: clientId, token: t3.access_token } }), env.deps);
    assert.equal(rv.status, 200);
    assert.equal((await handleMcp(rpc(t3.access_token, { jsonrpc: '2.0', id: 9, method: 'ping' }), env.deps)).status, 401);
  });

  it('MCP com chave de integracao: tools/call executa CRM e Chamados com auditoria e idempotencia', async () => {
    const env = makeEnv();
    const key = await keyFor(env, 'usr-ana', 'PROPRIOS', ['crm:contacts:read', 'tickets:read', 'tickets:write']);
    const tools = await handleMcp(rpc(key, { jsonrpc: '2.0', id: 1, method: 'tools/list' }), env.deps);
    const names = (body(tools).result.tools as Array<{ name: string; annotations: { readOnlyHint: boolean } }>);
    assert.ok(names.some((t) => t.name === 'tickets_create' && t.annotations.readOnlyHint === false));
    const args = { queue: 'TEC', subject: 'Link caiu (via MCP)', contactId: env.ids.cAna };
    const meta = { 'stihub/idempotencyKey': 'mcp-idem-0001' };
    const c1 = await handleMcp(rpc(key, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'tickets_create', arguments: args, _meta: meta } }), env.deps);
    assert.equal(body(c1).result.isError, false, JSON.stringify(body(c1)));
    assert.match(body(c1).result.structuredContent.data.key, /^TEC-\d+$/);
    const count = env.repo.listServiceTickets().length;
    const c2 = await handleMcp(rpc(key, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'tickets_create', arguments: args, _meta: meta } }), env.deps);
    assert.equal(body(c2).result.structuredContent.data.key, body(c1).result.structuredContent.data.key);
    assert.equal(env.repo.listServiceTickets().length, count);
    const invalid = await handleMcp(rpc(key, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'tickets_create', arguments: { queue: 'TEC', subject: 'x', contactId: env.ids.cAna, csatScore: 5 } } }), env.deps);
    assert.equal(body(invalid).result.isError, true);
    assert.match(body(invalid).result.content[0].text, /VALIDATION_FAILED/);
    const list = await handleMcp(rpc(key, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'tickets_list', arguments: { search: '11222333000181' } } }), env.deps);
    const found = body(list).result.structuredContent.data;
    assert.ok(found.some((t: { id: string; subject: string }) => t.id === env.ids.tAna && !t.subject.includes(CNPJ_RAW)));
    assert.ok(env.store.audit.filter((a) => a.channel === 'mcp' && a.keyId).length >= 3);
    // batch JSON-RPC
    const batch = await handleMcp(rpc(key, [{ jsonrpc: '2.0', id: 'a', method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }]), env.deps);
    assert.equal((body(batch) as unknown[]).length, 1);
  });
});

// ---------------------------------------------------------------------------
describe('Middleware: rotas de integracao sem redirect HTML; IAM integration-keys exige 2FA + ADMIN', () => {
  const run = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
    middleware(new NextRequest(new URL(`https://sti-hub.vercel.app${path}`), { method, headers }));

  it('v1/mcp/oauth/well-known passam para o handler (sem 401/redirect, sem apagar cookie)', () => {
    for (const p of ['/api/v1/contacts', '/api/v1/openapi.json', '/api/mcp', '/api/oauth/token', '/api/oauth/authorize', '/api/oauth/register', '/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server']) {
      const res = run(p, { authorization: 'Bearer stihub_int_abcdefabcdef_' + 'x'.repeat(43) });
      assert.equal(res.headers.get('x-stihub-auth-guard'), 'integration-self-auth', p);
      assert.ok(res.status < 300, p);
      assert.equal(res.headers.get('location'), null, p);
    }
    const withCookie = run('/api/v1/contacts', { cookie: 'stihub_session=abc' });
    assert.ok(!String(withCookie.headers.get('set-cookie') || '').includes('stihub_session=;'));
  });

  it('caminhos com %2F/..//caixa diferente nao entram na excecao; rotas antigas continuam protegidas', () => {
    assert.equal(isSelfAuthenticatedIntegrationPath('/api/v1%2F..%2Ferp/financial'), false);
    assert.equal(isSelfAuthenticatedIntegrationPath('/api/v1/../erp'), false);
    assert.equal(isSelfAuthenticatedIntegrationPath('/API/V1/contacts'), false);
    assert.equal(isSelfAuthenticatedIntegrationPath('/api/oauth/other'), false);
    assert.equal(run('/api/v1%2F..%2Fcontacts').status, 401);
    assert.equal(run('/api/contacts').status, 401);
    assert.equal(run('/api/oauthx/token').status, 401);
  });

  it('/api/iam/integration-keys: 401 sem sessao, 403 sem ADMIN, passa com ADMIN 2FA', () => {
    assert.equal(run('/api/iam/integration-keys').status, 401);
    assert.equal(run('/api/iam/integration-keys', { cookie: `stihub_session=${session(BRUNO)}` }).status, 403);
    assert.equal(run('/api/iam/integration-keys', { cookie: `stihub_session=${session({ ...ADMIN, mfa: false })}` }).status, 401);
    const ok = run('/api/iam/integration-keys', { cookie: `stihub_session=${session(ADMIN)}` }, 'POST');
    assert.ok(ok.status < 300);
  });
});
