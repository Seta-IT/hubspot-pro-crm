// ============================================================================
// Perf 25/11/2026 — bootstrap/login so gravam o crm_state_v1 se algo mudou.
// Antes: todo POST /api/bootstrap (e o login) regravava ~4,5 MB + diff do espelho, mesmo com o
// journal vazio. Agora: impressao digital do documento (forma exata da gravacao) na carga x na
// gravacao; igual => nao grava, journalAck=true. Journal com mudanca (tombstone, RBAC) => grava.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT, getUnchangedStateSkips, shouldSkipUnchangedStatePersist } from '../src/api/router';
import { kvPersistFingerprint, kvPersistPayloadText } from '../src/db/postgres';
import type { CrmDatabaseState } from '../src/db/types';

const HTTP = { _fromHttpBridge: '1' };
const ADMIN = () => ({
  ...HTTP,
  _sessionToken: signStiHubSessionToken({
    uid: 'usr-seta-01', email: 'marcelo.mira@setatelecom.com.br', name: 'Teste', roleId: 'SUPER_ADMIN', scope: 'TODOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000, canManageUsersRbac: true,
  } as Parameters<typeof signStiHubSessionToken>[0]),
});

/** Router singleton com um "banco" em memoria que guarda exatamente o texto que seria gravado. */
function storeRouter() {
  const repo = createInMemoryRepository();
  let stored = kvPersistPayloadText(repo.getState(), false);
  const router = new CrmApiRouter(repo);
  const r = router as unknown as Record<string, unknown>;
  r.isSingletonRepo = true;
  r.stateStoreEnabled = () => true;
  r.loadStateFromStore = async () => JSON.parse(stored) as CrmDatabaseState;
  let writes = 0;
  r.writeStateToStore = async (s: CrmDatabaseState) => {
    writes++;
    stored = kvPersistPayloadText(s, false);
  };
  const mutate = (fn: (st: CrmDatabaseState) => void) => {
    const st = JSON.parse(stored) as CrmDatabaseState;
    fn(st);
    stored = JSON.stringify(st);
  };
  return { router, writes: () => writes, stored: () => JSON.parse(stored) as CrmDatabaseState, mutate };
}
const ackOf = (res: { body: unknown }) => (res.body as { reconciliation?: { journalAck?: boolean } }).reconciliation?.journalAck;
const boot = (router: CrmApiRouter, journal: Record<string, unknown> = {}, query: Record<string, string> = {}) =>
  router.dispatch({ method: 'POST', path: '/api/bootstrap', query, body: { reconcileJournal: journal }, context: Object.keys(query).length ? undefined : TRUSTED_INTERNAL_CONTEXT });

describe('Perf 25/11: bootstrap nao regrava o estado quando nada mudou', () => {
  it('depois da 1a gravacao (normalizacao), aberturas seguidas nao gravam e confirmam o journal', async () => {
    const { router, writes } = storeRouter();
    await boot(router);
    const w1 = writes();
    const skips0 = getUnchangedStateSkips();
    for (let i = 0; i < 3; i++) {
      const b = await boot(router);
      assert.equal(b.status, 200);
      assert.equal(ackOf(b), true, 'journal vazio e estado igual ao do banco => ack');
    }
    assert.equal(writes(), w1, 'nenhuma regravacao');
    assert.equal(getUnchangedStateSkips() - skips0, 3);
  });

  it('journal com exclusao autorizada: grava, gera tombstone e o registro nao volta nas aberturas seguintes', async () => {
    const { router, writes, stored, mutate } = storeRouter();
    await boot(router, {}, ADMIN());
    // Contato livre (sem empresa/negocio), como os dos repros do lote 1-b.
    const victim = 'ct-perf-1125-livre';
    mutate((st) => {
      const base = structuredClone(st.contacts[0]);
      st.contacts.push({ ...base, id: victim, email: `${victim}@exemplo.com.br`, companyId: null, ownerId: 'usr-seta-01' } as any);
    });
    await boot(router, {}, ADMIN());
    const before = writes();
    const b = await boot(router, { deletedContactIds: [victim] }, ADMIN());
    assert.equal(b.status, 200);
    assert.equal(ackOf(b), true);
    assert.equal(writes(), before + 1, 'mudanca real => grava');
    assert.ok(!stored().contacts.some((c) => c.id === victim), 'apagado no banco');
    assert.ok(Object.keys(stored().recordTombstones?.contacts || {}).includes(victim), 'tombstone gravado');
    // Journal velho do navegador com o contato "ressuscitado" nao traz de volta (tombstone vence).
    const resurrect = { ...structuredClone(b.body as any)?.data?.contacts?.[0], id: victim };
    await boot(router, { upsertedContacts: [resurrect] }, ADMIN());
    assert.ok(!stored().contacts.some((c) => c.id === victim), 'continua apagado');
    // E a abertura seguinte, sem nada novo, nao grava.
    const w = writes();
    await boot(router, {}, ADMIN());
    assert.equal(writes(), w);
  });

  it('RBAC (inclusive segredos de MFA) fica byte a byte igual ao do banco nas aberturas sem mudanca', async () => {
    const { router, stored } = storeRouter();
    await boot(router);
    const rbacBefore = JSON.stringify(stored().rbac);
    for (let i = 0; i < 2; i++) await boot(router);
    assert.equal(JSON.stringify(stored().rbac), rbacBefore);
  });

  it('so as rotas de abertura/login (POST) usam o atalho; impressao digital = forma exata da gravacao', () => {
    assert.equal(shouldSkipUnchangedStatePersist('POST', '/api/bootstrap'), true);
    assert.equal(shouldSkipUnchangedStatePersist('POST', '/api/auth/login'), true);
    assert.equal(shouldSkipUnchangedStatePersist('POST', '/api/auth/verify-mfa'), true);
    assert.equal(shouldSkipUnchangedStatePersist('GET', '/api/bootstrap'), false);
    assert.equal(shouldSkipUnchangedStatePersist('POST', '/api/contacts'), false);
    assert.equal(shouldSkipUnchangedStatePersist('GET', '/api/erp/daily-sync'), false);
    const s = createInMemoryRepository().getState();
    assert.equal(kvPersistFingerprint(s, false), kvPersistFingerprint(structuredClone(s), false));
    const src = readFileSync('src/db/postgres.ts', 'utf8');
    assert.match(src, /KV_STATE_UPSERT_SQL, \['crm_state_v1', kvPersistPayloadText\(state, tableMode\)\]/, 'gravacao usa o mesmo texto');
    const router = readFileSync('src/api/router.ts', 'utf8');
    assert.match(router, /await syncStateToPostgres\(state, options\);[\s\S]{0,400}kvBaselineFingerprint = undefined/, 'zera a base depois de gravar');
  });
});

describe('Perf 25/11: impressao digital canonica', () => {
  it('ignora so a ordem das chaves (o JSONB reordena); qualquer valor diferente muda', () => {
    const a = { b: 1, a: { y: [1, { q: 2, p: 3 }], x: 'z' }, u: undefined } as unknown as CrmDatabaseState;
    const b = { a: { x: 'z', y: [1, { p: 3, q: 2 }] }, b: 1 } as unknown as CrmDatabaseState;
    const c = { a: { x: 'z', y: [1, { p: 3, q: 4 }] }, b: 1 } as unknown as CrmDatabaseState;
    assert.equal(kvPersistFingerprint(a, false), kvPersistFingerprint(b, false));
    assert.notEqual(kvPersistFingerprint(b, false), kvPersistFingerprint(c, false));
  });

  it('canonicalJson tem a mesma semantica do JSON.stringify (alem da ordem)', async () => {
    const { canonicalJson } = await import('../src/db/postgres');
    const v = { d: new Date(0), n: NaN, arr: [undefined, () => 1, 's\n"'], o: { f: () => 1, k: null } };
    assert.deepEqual(JSON.parse(canonicalJson(v)), JSON.parse(JSON.stringify(v)));
  });
});
