// ============================================================================
// STI-hub — Pacote E (29/10/2026): navegador nunca guarda/envia senha ou hash; rotas admin
// recusam passwordHash/totpSecret; scrypt com sal por usuario e rehash transparente no login.
// ============================================================================
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  hashCorporatePassword,
  loadClientIamUsersOverride,
  migrateClientIamStorage,
  signStiHubSessionToken,
  STIHUB_IAM_USERS_STORAGE_KEY,
  STIHUB_SESSION_STORAGE_KEY,
  STIHUB_TOTP_ROTATION_EPOCH,
} from '../src/app/lib/auth';
import { saveClientIamUserOverrideIfNewer } from '../src/app/lib/iam-seal-cache';
import { createInMemoryRepository } from '../src/db/repository';
import { sealIamRecord, unsealIamRecord } from '../src/db/iam-security';
import { hashPasswordScrypt, isScryptPasswordHash, verifyStoredPassword } from '../src/db/password-hash';
import { CrmApiRouter } from '../src/api/router';
import type { StiHubUserRecord } from '../src/db/types';

const HTTP = { _fromHttpBridge: '1' };
const ADMIN = 'marcelo.mira@setatelecom.com.br';
const PW_LEGACY = 'SenhaLegada8'; // senha existente (regra antiga), nunca invalidada
const adminTok = () =>
  signStiHubSessionToken({
    uid: 'usr-seta-01', email: ADMIN, name: 'Teste', roleId: 'SUPER_ADMIN', scope: 'TODOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000,
    canManageUsersRbac: true,
  } as Parameters<typeof signStiHubSessionToken>[0]);

/** Conta "de producao" com hash LEGADO (SHA-256 sal fixo) e 2FA pareado. */
function legacyAccount(email = ADMIN) {
  const repo = createInMemoryRepository();
  if (email !== ADMIN) repo.upsertRbacUser({ email, name: 'Legado', roleId: 'VENDEDOR_SALES' } as Parameters<typeof repo.upsertRbacUser>[0]);
  repo.upsertRbacUser({ email, totpConfigured: true, totpEpoch: STIHUB_TOTP_ROTATION_EPOCH, mfaMethod: 'TOTP_AUTHENTICATOR' } as Parameters<typeof repo.upsertRbacUser>[0]);
  const rec = repo.findRbacUserRecord('', email)! as StiHubUserRecord & { passwordHash?: string; passwordChangedAt?: string };
  rec.passwordHash = hashCorporatePassword(PW_LEGACY);
  rec.passwordChangedAt = '2026-10-20T12:00:00.000Z';
  return { repo, rec, seal: sealIamRecord(rec)! };
}
const login = (router: CrmApiRouter, email: string, password: string, override: unknown[] = []) =>
  router.dispatch({ method: 'POST', path: '/api/auth/login', query: { ...HTTP, _clientIp: '10.9.9.9' }, body: { email, password, iamUsersOverride: override } });

describe('Pacote E: hash scrypt com sal por usuario', () => {
  it('formato scrypt, sal unico, verificacao e adulteracao', () => {
    const a = hashPasswordScrypt('SenhaNova#2026A');
    const b = hashPasswordScrypt('SenhaNova#2026A');
    assert.ok(isScryptPasswordHash(a) && a !== b, 'sal por hash');
    assert.deepEqual(verifyStoredPassword('SenhaNova#2026A', a), { ok: true, needsRehash: false });
    assert.equal(verifyStoredPassword('SenhaNova#2026B', a).ok, false);
    assert.equal(verifyStoredPassword('SenhaNova#2026A', `${a.slice(0, -2)}AA`).ok, false);
    assert.equal(verifyStoredPassword('SenhaNova#2026A', undefined).ok, false);
  });
  it('legado SHA-256 continua aceito (inclusive senha curta antiga) e pede rehash', () => {
    assert.deepEqual(verifyStoredPassword(PW_LEGACY, hashCorporatePassword(PW_LEGACY)), { ok: true, needsRehash: true });
    assert.equal(verifyStoredPassword('errada#1234', hashCorporatePassword(PW_LEGACY)).ok, false);
  });
});

describe('Pacote E: login de conta existente antes/depois da migracao (ninguem trancado)', () => {
  it('usr-seta-01 (Marcéllo) com hash legado + 2FA pareado: login 200, regrava em scrypt sem tocar 2FA nem passwordChangedAt', async () => {
    const { repo, rec } = legacyAccount();
    const before = { totpSecret: rec.totpSecret, totpConfigured: rec.totpConfigured, totpEpoch: rec.totpEpoch, changed: rec.passwordChangedAt };
    const router = new CrmApiRouter(repo);
    const r1 = await login(router, ADMIN, PW_LEGACY);
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    const d1 = (r1.body as { data: Record<string, unknown> }).data;
    assert.equal(d1.mfaRequired, true);
    assert.doesNotMatch(JSON.stringify(r1.body), /qrCodeSvgDataUrl|otpauth|passwordHash|scrypt\$/);
    const after1 = repo.findRbacUserRecord('usr-seta-01', '')! as typeof rec;
    assert.ok(isScryptPasswordHash(after1.passwordHash), 'hash migrado');
    assert.equal(after1.passwordChangedAt, before.changed, 'sessoes/tokens seguem validos');
    assert.equal(after1.totpSecret, before.totpSecret);
    assert.equal(after1.totpConfigured, before.totpConfigured);
    assert.equal(after1.totpEpoch, before.totpEpoch);
    const r2 = await login(router, ADMIN, PW_LEGACY);
    assert.equal(r2.status, 200, 'depois da migracao a mesma senha segue valendo');
    assert.equal((await login(router, ADMIN, 'Errada#2026XX')).status, 401);
    assert.ok((repo.getRbacState().auditLogs || []).some((l) => l.action === 'AUTH_PASSWORD_HASH_UPGRADED'));
  });

  it('instancia fria: selo legado => login 200; selo novo (scrypt) => login 200; selo legado antigo segue valendo', async () => {
    const email = 'legado.e@setatelecom.com.br';
    const { seal: legacySeal } = legacyAccount(email);
    const cold1 = createInMemoryRepository();
    const r1 = await login(new CrmApiRouter(cold1), email, PW_LEGACY, [{ id: 'x', email, iamSeal: legacySeal }]);
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    const upgraded = cold1.findRbacUserRecord('', email)! as StiHubUserRecord & { passwordHash?: string };
    assert.ok(isScryptPasswordHash(upgraded.passwordHash));
    const newSeal = sealIamRecord(upgraded)!;
    assert.ok(isScryptPasswordHash((unsealIamRecord(newSeal)!.user as { passwordHash?: string }).passwordHash), 'o hash so viaja no selo');
    const cold2 = createInMemoryRepository();
    assert.equal((await login(new CrmApiRouter(cold2), email, PW_LEGACY, [{ email, iamSeal: newSeal }])).status, 200);
    const cold3 = createInMemoryRepository();
    assert.equal((await login(new CrmApiRouter(cold3), email, PW_LEGACY, [{ email, iamSeal: legacySeal }])).status, 200);
  });

  it('pre-autenticacao: senha/hash em texto no override sao ignorados (so o selo vale)', async () => {
    const email = 'forjado.e@setatelecom.com.br';
    const cold = createInMemoryRepository();
    const r = await login(new CrmApiRouter(cold), email, 'Qualquer#2026A', [
      { email, name: 'Forjado', roleId: 'SUPER_ADMIN', password: 'Qualquer#2026A', passwordHash: hashCorporatePassword('Qualquer#2026A') },
    ]);
    assert.equal(r.status, 401);
  });
});

describe('Pacote E: rotas admin recusam credenciais fora do campo password', () => {
  const call = (router: CrmApiRouter, method: string, path: string, body: Record<string, unknown>) =>
    router.dispatch({ method, path, query: { ...HTTP, _sessionToken: adminTok() }, body });

  it('passwordHash / totpSecret no body => 400 e nada muda; nem no alias /api/rbac', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const r1 = await call(router, 'POST', '/api/admin/users', { name: 'X', email: 'x.e@setatelecom.com.br', roleId: 'VENDEDOR_SALES', passwordHash: hashCorporatePassword('abcdefgh') });
    assert.equal(r1.status, 400);
    assert.equal((r1.body as { code: string }).code, 'IAM_FORBIDDEN_CREDENTIAL_FIELD');
    assert.equal(repo.findRbacUserRecord('', 'x.e@setatelecom.com.br'), undefined);
    const hashBefore = (repo.findRbacUserRecord('usr-seta-01', '') as { passwordHash?: string }).passwordHash;
    for (const [m, p] of [['PUT', '/api/admin/users/usr-seta-01'], ['PATCH', '/api/rbac/users/usr-seta-01'], ['PUT', '/API/Admin/Users/usr-seta-01/']] as const) {
      for (const body of [{ passwordHash: 'x' }, { totpSecret: 'KRSXG5CTMVRXEZLUKN2XAZLSKNSWG4TF' }, { totpSecretFormatted: 'x' }]) {
        const r = await call(router, m, p, body);
        assert.ok(r.status === 400 || r.status === 404, `${m} ${p} ${Object.keys(body)} => ${r.status}`);
      }
    }
    assert.equal((repo.findRbacUserRecord('usr-seta-01', '') as { passwordHash?: string }).passwordHash, hashBefore);
  });

  it('password fora do criar/editar usuario => 400; no editar com 12+ => scrypt', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const r = await call(router, 'POST', '/api/admin/users/usr-seta-01/reset-mfa', { mode: 'RESET_QR', password: 'SenhaNova#2026A' });
    assert.equal(r.status, 400);
    const email = 'edita.e@setatelecom.com.br';
    repo.upsertRbacUser({ email, name: 'Edita', roleId: 'VENDEDOR_SALES' } as Parameters<typeof repo.upsertRbacUser>[0]);
    const id = repo.findRbacUserRecord('', email)!.id;
    const ok = await call(router, 'PUT', `/api/admin/users/${id}`, { password: 'SenhaNova#2026A' });
    assert.ok(ok.status < 300, JSON.stringify(ok.body));
    assert.ok(isScryptPasswordHash((repo.findRbacUserRecord(id, '') as { passwordHash?: string }).passwordHash));
    assert.doesNotMatch(JSON.stringify(ok.body), /passwordHash|scrypt\$|SenhaNova/);
  });

  it('repositorio: upsertRbacUser ignora passwordHash da entrada', () => {
    const repo = createInMemoryRepository();
    repo.upsertRbacUser({ email: 'hash.e@setatelecom.com.br', name: 'H', roleId: 'VENDEDOR_SALES', passwordHash: hashCorporatePassword('abcdefgh') } as Parameters<typeof repo.upsertRbacUser>[0]);
    assert.equal((repo.findRbacUserRecord('', 'hash.e@setatelecom.com.br') as { passwordHash?: string }).passwordHash, undefined);
  });

  it('override cru (admin autenticado) nunca define senha', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const email = 'cru.e@setatelecom.com.br';
    repo.upsertRbacUser({ email, name: 'Cru', roleId: 'VENDEDOR_SALES', password: PW_LEGACY } as Parameters<typeof repo.upsertRbacUser>[0]);
    const before = (repo.findRbacUserRecord('', email) as { passwordHash?: string }).passwordHash;
    await router.dispatch({ method: 'GET', path: '/api/admin/users', query: { ...HTTP, _sessionToken: adminTok() }, body: { iamUsersOverride: [{ email, name: 'Cru', password: 'Trocada#2026AB' }] } });
    assert.equal((repo.findRbacUserRecord('', email) as { passwordHash?: string }).passwordHash, before);
  });
});

describe('Pacote E: navegador — migracao transparente do localStorage', () => {
  const store = new Map<string, string>();
  const g = globalThis as unknown as { window?: unknown };
  g.window = {
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    },
  };
  after(() => {
    delete g.window;
  });

  it('apaga senha/hash/segredo legados e preserva selo, homeScreen e demais campos; idempotente', () => {
    store.set(STIHUB_IAM_USERS_STORAGE_KEY, JSON.stringify([
      { id: 'usr-seta-01', email: ADMIN, iamSeal: 'SEAL1.abc', homeScreen: 'crm', password: 'SenhaEmClaro#1', passwordHash: 'deadbeef', totpSecret: 'KRSX' },
      { id: 'u2', email: 'b@x.com', iamSeal: 'SEAL1.def' },
    ]));
    store.set(STIHUB_SESSION_STORAGE_KEY, JSON.stringify({ authenticated: true, user: { id: 'usr-seta-01', email: ADMIN, password: 'SenhaEmClaro#1' } }));
    assert.equal(migrateClientIamStorage(), 2);
    const list = JSON.parse(store.get(STIHUB_IAM_USERS_STORAGE_KEY)!);
    assert.deepEqual(list[0], { id: 'usr-seta-01', email: ADMIN, iamSeal: 'SEAL1.abc', homeScreen: 'crm' });
    assert.deepEqual(list[1], { id: 'u2', email: 'b@x.com', iamSeal: 'SEAL1.def' });
    assert.deepEqual(JSON.parse(store.get(STIHUB_SESSION_STORAGE_KEY)!), { authenticated: true, user: { id: 'usr-seta-01', email: ADMIN } });
    assert.equal(migrateClientIamStorage(), 0);
    store.set('stihub_users_v1', JSON.stringify([{ id: 'u9', email: 'z@x.com', totpSecret: 'KRSX', name: 'Z' }]));
    assert.equal(migrateClientIamStorage(), 1);
    assert.deepEqual(JSON.parse(store.get('stihub_users_v1')!), [{ id: 'u9', email: 'z@x.com', name: 'Z' }]);
    assert.doesNotMatch(JSON.stringify([...store.values()]), /SenhaEmClaro|deadbeef|password|totpSecret/);
  });

  it('leitura e gravacao do cache nunca devolvem nem guardam credenciais', () => {
    store.set(STIHUB_IAM_USERS_STORAGE_KEY, JSON.stringify([{ id: 'u3', email: 'c@x.com', password: 'x', iamSeal: 'SEAL1.g' }]));
    assert.doesNotMatch(JSON.stringify(loadClientIamUsersOverride()), /password/);
    saveClientIamUserOverrideIfNewer({ id: 'u4', email: 'd@x.com', iamSeal: 'SEAL1.h', password: 'NovaSenha#2026', passwordHash: 'h', newPassword: 'n' });
    assert.doesNotMatch(store.get(STIHUB_IAM_USERS_STORAGE_KEY)!, /NovaSenha|passwordHash|newPassword|"password"/);
    assert.match(store.get(STIHUB_IAM_USERS_STORAGE_KEY)!, /SEAL1\.h/);
  });

  it('fontes do front: painel nao envia totpSecret/hash; login e painel nao cacheiam senha', () => {
    const panel = fs.readFileSync('src/app/components/StiHubAdminRbacPanel.tsx', 'utf8');
    assert.doesNotMatch(panel, /totpSecret:\s*(newUserTotpSecret|editingUser\.totpSecret)/);
    assert.doesNotMatch(panel, /\{\s*password:\s*(patch\.password|newUserPassword)/);
    assert.match(panel, /sanitizeIamUserPatch\(patch\)/);
    const loginSrc = fs.readFileSync('src/app/login/page.tsx', 'utf8');
    assert.doesNotMatch(loginSrc, /password:\s*newPassword\.trim\(\),\s*\}\);/);
    assert.match(loginSrc, /migrateClientIamStorage\(\)/);
  });
});
