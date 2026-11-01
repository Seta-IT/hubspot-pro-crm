// Mede bytes Postgres -> app por tipo de requisicao (antes x depois) contra um Postgres LOCAL.
// node dist/tests/pg-harness/measure-egress.js <distRoot> <rotulo> <pgAdminUrl> <arquivoEstado>
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { startByteProxy, startInstance, sessionFromSetCookie, safeTotpWindow } from './lib';

const [distRoot, label, adminUrl, stateFile] = process.argv.slice(2);
const SECRET = 'teste-neon-free-segredo-de-sessao-local-0123456789';
process.env.STI_HUB_SESSION_SECRET = SECRET;
const HTTP = { _fromHttpBridge: '1' };
const ADMIN = { email: 'marcelo.mira@setatelecom.com.br', password: 'SenhaPropria#2026' };

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { computeRfc6238Totp } = require(path.join(distRoot, 'src/app/lib/auth.js'));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { deriveServerTotpSecret } = require(path.join(distRoot, 'src/db/iam-security.js'));
  const db = `stihub_m_${label.replace(/\W/g, '')}`;
  const a = new Client({ connectionString: adminUrl }); await a.connect();
  await a.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`); await a.query(`CREATE DATABASE ${db}`); await a.end();
  const u = new URL(adminUrl); u.pathname = `/${db}`;
  const c = new Client({ connectionString: u.toString() }); await c.connect();
  const stateJson = fs.readFileSync(stateFile, 'utf8');
  await c.query(`CREATE TABLE crm_kv_store (key TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await c.query(`INSERT INTO crm_kv_store (key, payload) VALUES ('crm_state_v1', $1::jsonb)`, [stateJson]);
  const payloadBytes = Number((await c.query(`SELECT octet_length(payload::text) AS n FROM crm_kv_store`)).rows[0].n);

  const px = await startByteProxy(u.hostname, Number(u.port || 5432));
  const pu = new URL(u.toString()); pu.port = String(px.port);
  const env = { STI_HUB_SESSION_SECRET: SECRET };
  const i1 = await startInstance({ distRoot, databaseUrl: pu.toString(), env });
  await i1.call('setPasswords', { users: [ADMIN] });
  await i1.dispatch({ method: 'GET', path: '/api/health', query: {} });
  const out: Record<string, number> = { payloadBytes };
  const measure = async (name: string, n: number, fn: () => Promise<unknown>) => {
    px.reset();
    for (let k = 0; k < n; k++) await fn();
    out[`${name}_fromDb_por_req`] = Math.round(px.fromDb() / n);
    out[`${name}_toDb_por_req`] = Math.round(px.toDb() / n);
  };
  await measure('GET_health_anonimo', 20, () => i1.dispatch({ method: 'GET', path: '/api/health', query: {} }));
  await safeTotpWindow();
  let token = '';
  await measure('login_2_etapas', 1, async () => {
    const s1 = await i1.dispatch({ method: 'POST', path: '/api/auth/login', query: { ...HTTP }, body: ADMIN });
    const ch = (s1.body as { data: { challengeId: string } }).data.challengeId;
    const s2 = await i1.dispatch({ method: 'POST', path: '/api/auth/verify-mfa', query: { ...HTTP }, body: { email: ADMIN.email, challengeId: ch, code: computeRfc6238Totp(deriveServerTotpSecret(ADMIN.email)).code, mfaMethod: 'TOTP_AUTHENTICATOR' } });
    token = sessionFromSetCookie(s2.headers);
  });
  out.login_ok = token ? 1 : 0;
  await measure('GET_contacts_logado', 10, () => i1.dispatch({ method: 'GET', path: '/api/contacts', query: { ...HTTP, _sessionToken: token } }));
  let n = 0;
  await measure('POST_contact', 5, () => i1.dispatch({ method: 'POST', path: '/api/contacts', query: { ...HTTP, _sessionToken: token }, body: { firstName: `Med${n++}`, lastName: 'X', email: `med${n}@exemplo.com.br` } }));
  // Outra instancia grava um contato; mede a proxima leitura da primeira.
  const i2 = await startInstance({ distRoot, databaseUrl: pu.toString(), env });
  await i2.dispatch({ method: 'GET', path: '/api/health', query: {} });
  await i2.dispatch({ method: 'POST', path: '/api/contacts', query: { ...HTTP, _sessionToken: token }, body: { firstName: 'Outra', lastName: 'Inst', email: 'outra@exemplo.com.br' } });
  await measure('GET_apos_escrita_de_outra_instancia', 1, () => i1.dispatch({ method: 'GET', path: '/api/health', query: {} }));

  // Escrita concorrente: 2 instancias, 5 rodadas de POST em paralelo.
  for (let r = 0; r < 5; r++) {
    await Promise.all([i1, i2].map((inst, k) => inst.dispatch({ method: 'POST', path: '/api/contacts', query: { ...HTTP, _sessionToken: token }, body: { firstName: `Par${r}-${k}`, lastName: 'X', email: `par${r}-${k}@exemplo.com.br` } })));
  }
  const saved = (await c.query(`SELECT count(*)::int AS n FROM crm_kv_store, jsonb_array_elements(payload->'contacts') e WHERE e->>'firstName' LIKE 'Par%'`)).rows[0].n;
  out.concorrencia_criados = 10;
  out.concorrencia_salvos_no_banco = saved;
  const st1 = await i1.call<{ stats: unknown }>('stats'); const st2 = await i2.call<{ stats: unknown }>('stats');
  await i1.stop(); await i2.stop(); await px.close(); await c.end();
  console.log(JSON.stringify({ label, ...out, stats_i1: st1.stats, stats_i2: st2.stats }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
