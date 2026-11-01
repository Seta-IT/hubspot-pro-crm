// ============================================================================
// STI-hub — Neon Free (01/11/2026): versao do estado, merge em 3 vias, falha fechada, TLS.
// Testes unitarios sempre rodam. Os de integracao precisam de um Postgres LOCAL:
//   STIHUB_TEST_PG_URL=postgresql://postgres@127.0.0.1:55432/postgres npm test
// (cada cenario cria o proprio banco descartavel; nunca aponte para producao).
// ============================================================================
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { mergeThreeWay, jsonbRoundTrip } from '../src/db/pg-state-sync';
import { isPersistenceFailClosed, resolvePostgresSsl, isRelationalMirrorEnabled, stripSslParams } from '../src/db/postgres';
import { createInitialSeedState } from '../src/db/seed';
import { computeRfc6238Totp } from '../src/app/lib/auth';
import { deriveServerTotpSecret } from '../src/db/iam-security';
import { startByteProxy, startInstance, sessionFromSetCookie, safeTotpWindow, Instance } from './pg-harness/lib';

const ROOT = process.cwd();
const src = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) { prev[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  try { fn(); } finally { for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } }
}

describe('Neon Free: merge em 3 vias (conflito entre instancias)', () => {
  const base = { contacts: [{ id: 'c1', n: 'a' }, { id: 'c2', n: 'b' }], rbac: { auditLogs: [{ id: 'L1' }], users: [{ id: 'u1', name: 'X', active: true }] }, n: 1 };
  it('inclusoes dos dois lados ficam; edicoes em itens diferentes ficam', () => {
    const mine = jsonbRoundTrip(base); mine.contacts.push({ id: 'c3', n: 'mine' }); mine.contacts[0].n = 'A!';
    const theirs = jsonbRoundTrip(base); theirs.contacts.push({ id: 'c4', n: 'theirs' }); theirs.contacts[1].n = 'B!';
    const m = mergeThreeWay(base, mine, theirs) as typeof base;
    assert.deepEqual(m.contacts.map((c) => `${c.id}:${c.n}`), ['c1:A!', 'c2:B!', 'c4:theirs', 'c3:mine']);
  });
  it('auditoria com unshift dos dois lados: as duas entradas novas ficam no topo', () => {
    const mine = jsonbRoundTrip(base); mine.rbac.auditLogs.unshift({ id: 'L-mine' });
    const theirs = jsonbRoundTrip(base); theirs.rbac.auditLogs.unshift({ id: 'L-theirs' });
    const m = mergeThreeWay(base, mine, theirs) as typeof base;
    assert.deepEqual(m.rbac.auditLogs.map((l) => l.id), ['L-mine', 'L-theirs', 'L1']);
  });
  it('mesma folha alterada pelos dois: vale a minha so naquela folha; exclusao minha prevalece', () => {
    const mine = jsonbRoundTrip(base); mine.rbac.users[0].name = 'Mine'; mine.contacts = mine.contacts.filter((c) => c.id !== 'c2');
    const theirs = jsonbRoundTrip(base); theirs.rbac.users[0].name = 'Theirs'; theirs.rbac.users[0].active = false; theirs.n = 2;
    const m = mergeThreeWay(base, mine, theirs) as typeof base;
    assert.equal(m.rbac.users[0].name, 'Mine');
    assert.equal(m.rbac.users[0].active, false, 'campo que so eles mudaram permanece');
    assert.equal(m.n, 2);
    assert.deepEqual(m.contacts.map((c) => c.id), ['c1']);
  });
  it('quem nao mudou nada recebe exatamente o estado deles', () => {
    const theirs = jsonbRoundTrip(base); theirs.n = 9;
    assert.deepEqual(mergeThreeWay(base, jsonbRoundTrip(base), theirs), theirs);
  });
});

describe('Neon Free: configuracao (TLS, falha fechada, espelhos)', () => {
  it('TLS sempre validado para Neon/sslmode; inseguro so fora de producao e com flag', () => {
    withEnv({ PGSSLMODE: undefined, STI_HUB_PG_TLS_INSECURE: undefined, VERCEL_ENV: undefined, STI_HUB_PG_FAIL_CLOSED: undefined }, () => {
      assert.deepEqual(resolvePostgresSsl('postgresql://u:p@ep-x-pooler.us-east-1.aws.neon.tech/db?sslmode=require'), { rejectUnauthorized: true });
      assert.deepEqual(resolvePostgresSsl('postgresql://u:p@db.example.com/db?sslmode=require'), { rejectUnauthorized: true });
      assert.equal(resolvePostgresSsl('postgresql://postgres@127.0.0.1:5432/db'), false);
    });
    withEnv({ STI_HUB_PG_TLS_INSECURE: '1', VERCEL_ENV: 'production' }, () => {
      assert.deepEqual(resolvePostgresSsl('postgresql://u:p@ep-x.neon.tech/db?sslmode=require'), { rejectUnauthorized: true }, 'producao ignora a flag insegura');
    });
    withEnv({ STI_HUB_PG_TLS_INSECURE: '1', VERCEL_ENV: undefined, STI_HUB_PG_FAIL_CLOSED: undefined }, () => {
      assert.deepEqual(resolvePostgresSsl('postgresql://u:p@localhost/db?sslmode=require'), { rejectUnauthorized: false });
    });
    assert.equal(stripSslParams('postgresql://u:p@h/db?sslmode=require&channel_binding=require'), 'postgresql://u:p@h/db?channel_binding=require');
  });
  it('falha fechada em producao e preview; espelhos desligados por padrao', () => {
    withEnv({ VERCEL_ENV: 'production', STI_HUB_PG_FAIL_CLOSED: undefined }, () => assert.equal(isPersistenceFailClosed(), true));
    withEnv({ VERCEL_ENV: 'preview', STI_HUB_PG_FAIL_CLOSED: undefined }, () => assert.equal(isPersistenceFailClosed(), true));
    withEnv({ VERCEL_ENV: undefined, STI_HUB_PG_FAIL_CLOSED: undefined }, () => assert.equal(isPersistenceFailClosed(), false));
    withEnv({ STI_HUB_PG_RELATIONAL_MIRROR: undefined }, () => assert.equal(isRelationalMirrorEnabled(), false));
  });
  it('source: o router nao le mais o snapshot inteiro por requisicao nem engole falhas em producao', () => {
    const r = src('src/api/router.ts');
    assert.doesNotMatch(r, /loadStateFromPostgres\(\)/);
    assert.doesNotMatch(r, /syncStateToPostgres\(/);
    assert.match(r, /this\.pgSync\.beginRequest\(/);
    assert.match(r, /this\.pgSync\.commit\(this\.repo\)/);
    const p = src('src/db/postgres.ts');
    assert.match(p, /WHERE key = \$1 AND version = \$3 RETURNING version/);
    assert.doesNotMatch(p, /rejectUnauthorized: false \}/);
  });
});

// ---------------------------------------------------------------------------
// Integracao com Postgres local
// ---------------------------------------------------------------------------
const PG_URL = process.env.STIHUB_TEST_PG_URL || '';
const SECRET = 'teste-neon-free-segredo-de-sessao-local-0123456789';
const DIST = path.join(ROOT, 'dist');
const ADMIN = { email: 'marcelo.mira@setatelecom.com.br', password: 'SenhaPropria#2026' };
const SELLER = { email: 'marialuiza@setatelecom.com.br', password: 'SenhaVendedora#2026' };
const HTTP = { _fromHttpBridge: '1' };

function dbUrl(name: string): string {
  const u = new URL(PG_URL);
  u.pathname = `/${name}`;
  return u.toString();
}
async function admin<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: PG_URL });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
async function freshDb(name: string, state?: object): Promise<string> {
  await admin(async (c) => { await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await c.query(`CREATE DATABASE ${name}`); });
  const url = dbUrl(name);
  if (state) {
    // Esquema ANTIGO (como esta em producao hoje): sem coluna version.
    const c = new Client({ connectionString: url }); await c.connect();
    await c.query(`CREATE TABLE crm_kv_store (key TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await c.query(`INSERT INTO crm_kv_store (key, payload) VALUES ('crm_state_v1', $1::jsonb)`, [JSON.stringify(state)]);
    await c.end();
  }
  return url;
}
async function login(a: Instance, b: Instance, user: { email: string; password: string }): Promise<string> {
  await safeTotpWindow();
  const s1 = await a.dispatch({ method: 'POST', path: '/api/auth/login', query: { ...HTTP }, body: { email: user.email, password: user.password } });
  assert.equal(s1.status, 200, `login etapa 1 (${user.email}): ${JSON.stringify(s1.body).slice(0, 200)}`);
  const challengeId = (s1.body as { data: { challengeId: string } }).data.challengeId;
  const code = computeRfc6238Totp(deriveServerTotpSecret(user.email)).code;
  const s2 = await b.dispatch({ method: 'POST', path: '/api/auth/verify-mfa', query: { ...HTTP }, body: { email: user.email, challengeId, code, mfaMethod: 'TOTP_AUTHENTICATOR' } });
  assert.equal(s2.status, 200, `2FA em OUTRA instancia (${user.email}): ${JSON.stringify(s2.body).slice(0, 200)}`);
  const token = sessionFromSetCookie(s2.headers);
  assert.ok(token, 'sessao emitida');
  return token;
}

describe('Neon Free: integracao com Postgres local (duas instancias)', { skip: !PG_URL ? 'defina STIHUB_TEST_PG_URL (Postgres local)' : false }, () => {
  const env = { STI_HUB_SESSION_SECRET: SECRET, STI_HUB_PG_FAIL_CLOSED: '1' };
  const fixture = process.env.STIHUB_TEST_PG_STATE_FILE ? JSON.parse(fs.readFileSync(process.env.STIHUB_TEST_PG_STATE_FILE, 'utf8')) : createInitialSeedState();
  let url = '';
  let a: Instance; let b: Instance;
  let adminToken = '';
  before(async () => {
    process.env.STI_HUB_SESSION_SECRET = SECRET;
    url = await freshDb('stihub_t_main', fixture);
    a = await startInstance({ distRoot: DIST, databaseUrl: url, env });
    b = await startInstance({ distRoot: DIST, databaseUrl: url, env });
    await a.call('setPasswords', { users: [ADMIN, SELLER] });
  });
  after(async () => { await a?.stop(); await b?.stop(); });

  it('migracao aditiva e idempotente: coluna version + trigger; dados intactos', async () => {
    const c = new Client({ connectionString: url }); await c.connect();
    const col = await c.query(`SELECT data_type FROM information_schema.columns WHERE table_name='crm_kv_store' AND column_name='version'`);
    assert.equal(col.rows[0]?.data_type, 'bigint');
    const v1 = Number((await c.query(`SELECT version FROM crm_kv_store`)).rows[0].version);
    // Escrita no formato do codigo ANTIGO (upsert sem version): o trigger incrementa mesmo assim.
    await c.query(`INSERT INTO crm_kv_store (key, payload, updated_at) SELECT key, payload, NOW() FROM crm_kv_store WHERE key='crm_state_v1' ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`);
    const v2 = Number((await c.query(`SELECT version FROM crm_kv_store`)).rows[0].version);
    assert.equal(v2, v1 + 1);
    const users = (await c.query(`SELECT jsonb_array_length(payload->'rbac'->'users') AS n FROM crm_kv_store`)).rows[0].n;
    assert.equal(users, (fixture.rbac?.users || []).length || users);
    await c.end();
  });

  it('login com 2FA do usr-seta-01 e de um vendedor, etapa 1 numa instancia e 2FA na outra', async () => {
    const tAdmin = await login(a, b, ADMIN);
    adminToken = tAdmin;
    const tSeller = await login(b, a, SELLER);
    const ra = await a.dispatch({ method: 'GET', path: '/api/contacts', query: { ...HTTP, _sessionToken: tAdmin } });
    assert.equal(ra.status, 200);
    const rs = await b.dispatch({ method: 'GET', path: '/api/auth/session', query: { ...HTTP, _sessionToken: tSeller } });
    assert.equal(rs.status, 200, JSON.stringify(rs.body).slice(0, 200));
  });

  it('escritas concorrentes nas duas instancias: nenhuma se perde', async () => {
    // Reusa a sessao do teste anterior (o mesmo codigo TOTP nao pode ser usado 2x na janela: anti-replay).
    const t = adminToken || (await login(a, b, ADMIN));
    const before = (await a.dispatch({ method: 'GET', path: '/api/contacts', query: { ...HTTP, _sessionToken: t } })).body as { data: unknown[] };
    const n0 = before.data.length;
    for (let round = 0; round < 5; round++) {
      const res = await Promise.all([a, b].map((inst, i) =>
        inst.dispatch({ method: 'POST', path: '/api/contacts', query: { ...HTTP, _sessionToken: t }, body: { firstName: `Conc${round}-${i}`, lastName: 'Teste', email: `conc${round}-${i}@exemplo.com.br` } })));
      for (const r of res) assert.ok(r.status >= 200 && r.status < 300, `POST: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    }
    const c = await startInstance({ distRoot: DIST, databaseUrl: url, env });
    const after = (await c.dispatch({ method: 'GET', path: '/api/contacts', query: { ...HTTP, _sessionToken: t } })).body as { data: Array<{ firstName: string }> };
    await c.stop();
    const created = after.data.filter((x) => /^Conc\d-\d$/.test(x.firstName)).length;
    assert.equal(created, 10, 'os 10 contatos criados em paralelo estao no banco');
    assert.equal(after.data.length, n0 + 10);
  });

  it('releitura parcial: depois da escrita de outra instancia, so os segmentos alterados; estado igual ao da leitura inteira', async () => {
    const t = adminToken || (await login(a, b, ADMIN));
    await b.dispatch({ method: 'GET', path: '/api/health', query: {} });
    const w = await a.dispatch({ method: 'POST', path: '/api/contacts', query: { ...HTTP, _sessionToken: t }, body: { firstName: 'Parcial', lastName: 'Teste', email: 'parcial@exemplo.com.br' } });
    assert.ok(w.status >= 200 && w.status < 300);
    const s0 = (await b.call<{ stats: { partialLoads: number; segmentsReloaded: number } }>('stats')).stats;
    const db = (await b.call<{ digest: string }>('digest')).digest;
    const s1 = (await b.call<{ stats: { partialLoads: number; segmentsReloaded: number } }>('stats')).stats;
    assert.equal(s1.partialLoads, s0.partialLoads + 1, 'b releu so uma parte');
    assert.ok(s1.segmentsReloaded - s0.segmentsReloaded <= 6, `segmentos relidos: ${s1.segmentsReloaded - s0.segmentsReloaded}`);
    const c = await startInstance({ distRoot: DIST, databaseUrl: url, env });
    const dc = (await c.call<{ digest: string }>('digest')).digest;
    await c.stop();
    assert.equal(db, dc, 'estado apos releitura parcial == estado de uma instancia nova (leitura inteira)');
  });

  it('bytes lidos do banco por requisicao: so a versao quando nada mudou', async () => {
    const proxyUrl = new URL(url);
    const px = await startByteProxy(proxyUrl.hostname, Number(proxyUrl.port || 5432));
    proxyUrl.port = String(px.port);
    const inst = await startInstance({ distRoot: DIST, databaseUrl: proxyUrl.toString(), env });
    await inst.dispatch({ method: 'GET', path: '/api/health', query: {} }); // aquece (DDL + 1 leitura inteira)
    px.reset();
    for (let i = 0; i < 20; i++) await inst.dispatch({ method: 'GET', path: '/api/health', query: {} });
    const perReq = px.fromDb() / 20;
    const stats = (await inst.call<{ stats: { fullLoads: number; versionChecks: number } }>('stats')).stats;
    await inst.stop(); await px.close();
    assert.ok(perReq < 1024, `esperado < 1 KB por requisicao, veio ${perReq}`);
    assert.equal(stats.fullLoads, 1);
  });

  it('falha fechada: banco vazio => 503 e nada de seed; banco fora do ar => 503', async () => {
    const empty = await freshDb('stihub_t_empty');
    const inst = await startInstance({ distRoot: DIST, databaseUrl: empty, env });
    const r = await inst.dispatch({ method: 'GET', path: '/api/health', query: {} });
    assert.equal(r.status, 503);
    assert.equal((r.body as { code: string }).code, 'PERSISTENCE_UNAVAILABLE');
    const rows = await (async () => { const c = new Client({ connectionString: empty }); await c.connect(); const q = await c.query(`SELECT count(*)::int AS n FROM crm_kv_store`); await c.end(); return q.rows[0].n; })();
    assert.equal(rows, 0, 'nenhum seed gravado');
    await inst.stop();
    const down = await startInstance({ distRoot: DIST, databaseUrl: 'postgresql://postgres@127.0.0.1:1/x', env });
    const r2 = await down.dispatch({ method: 'POST', path: '/api/auth/login', query: { ...HTTP }, body: { email: ADMIN.email, password: ADMIN.password } });
    assert.equal(r2.status, 503);
    await down.stop();
  });
});
