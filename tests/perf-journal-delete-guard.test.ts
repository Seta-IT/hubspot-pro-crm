// ============================================================================
// CISO 19/11/2026 — bloqueio do lote 1-b e ressalvas:
// * exclusao pelo journal (deleted*Ids) so com a alcada de exclusao e dentro da carteira; chave
//   desconhecida e descartada; so nasce tombstone de exclusao autorizada;
// * (a) journalAck por requisicao (concorrencia);
// * (b) exclusao explicita autorizada que esvazia colecao grande gera tombstone;
// * (c) carga do estado falhou => nada grava (503 em escrita; bootstrap so leitura, ack=false).
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository, CrmRepository } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import { syncStateToPostgres } from '../src/db/postgres';
import { runWithStateRequestContext, StateWriteBlockedError } from '../src/db/state-request-context';
import type { Contact, CrmDatabaseState } from '../src/db/types';

const HTTP = { _fromHttpBridge: '1' };
const tok = (uid: string, email: string, roleId: string, scope: string, extra: Record<string, unknown> = {}) =>
  signStiHubSessionToken({
    uid, email, name: 'Teste ' + uid, roleId, scope,
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000, ...extra,
  } as Parameters<typeof signStiHubSessionToken>[0]);
const ADMIN = () => ({ ...HTTP, _sessionToken: tok('usr-seta-01', 'marcelo.mira@setatelecom.com.br', 'SUPER_ADMIN', 'TODOS', { canManageUsersRbac: true }) });
const SELLER = () => ({ ...HTTP, _sessionToken: tok('usr-seta-03', 'marialuiza@setatelecom.com.br', 'VENDEDOR_SALES', 'PROPRIOS') });
const DELETER_ID = 'usr-perf-del-01';
const DELETER = () => ({ ...HTTP, _sessionToken: tok(DELETER_ID, 'perf.del@setatelecom.com.br', 'VENDEDOR_SALES', 'PROPRIOS') });

/** Usuario com alcada de exclusao (CRM e ERP), mas carteira restrita (PROPRIOS). */
function addRestrictedDeleter(repo: CrmRepository) {
  const r = repo as unknown as { upsertRbacUser: (u: Record<string, unknown>) => unknown };
  r.upsertRbacUser({
    id: DELETER_ID, email: 'perf.del@setatelecom.com.br', name: 'Perf Del', roleId: 'VENDEDOR_SALES', scope: 'PROPRIOS',
    enabledModules: ['CRM', 'ERP'], moduleAccess: { crm: true, erp: true, chamados: false },
    mfaEnabled: true, mfaMethod: 'TOTP_AUTHENTICATOR', totpConfigured: true, active: true,
    actionGuardsOverride: { canDeleteRecords: true },
  });
  const sess = repo.resolveSessionFromToken(DELETER()._sessionToken);
  assert.ok(sess.authenticated, 'sessao do usuario restrito');
  if (sess.authenticated) {
    assert.equal(String(sess.user.scope), 'PROPRIOS');
    assert.ok(sess.crmPermissions.canDeleteCrmRecords || sess.effectiveActionGuards.canDeleteRecords, 'tem alcada de exclusao');
  }
}

/** Registros livres (sem vinculo/uso) para exclusao. */
function freshContact(repo: CrmRepository, id: string, ownerId: string | null): Contact {
  const base = structuredClone(repo.getState().contacts[0]);
  const c = { ...base, id, email: `${id}@exemplo.com.br`, companyId: null, ownerId, ownerName: ownerId || '' } as Contact;
  repo.getState().contacts.push(c);
  return c;
}
function freshSupplier(repo: CrmRepository, id: string) {
  const erp = repo.getState().erp!;
  const base = structuredClone((erp.suppliers || [])[0] || {});
  (erp.suppliers ||= []).push({ ...(base as object), id } as never);
}
const tombs = (repo: CrmRepository, key: string) => Object.keys(repo.getState().recordTombstones?.[key] || {});
const hasContact = (repo: CrmRepository, id: string) => repo.getState().contacts.some((c) => c.id === id);

const ALL_DELETE_KEYS = (repo: CrmRepository) => {
  const s = repo.getState();
  const erp = s.erp!;
  return {
    deletedContactIds: [s.contacts[0].id],
    deletedCompanyIds: [s.companies[0].id],
    deletedDealIds: [s.deals[0].id],
    deletedTaskIds: (s.tasks || []).slice(0, 1).map((t) => t.id),
    deletedContractIds: [erp.rentalContracts[0].id],
    deletedCatalogItemIds: [erp.catalog[0].id],
    deletedSupplierIds: (erp.suppliers || []).slice(0, 1).map((x) => x.id),
    deletedEmployeeIds: (erp.employees || []).slice(0, 1).map((x) => x.id),
    deletedSalesOrderIds: (erp.salesOrders || []).slice(0, 1).map((x) => x.id),
    deletedServiceOrderIds: (erp.serviceOrders || []).slice(0, 1).map((x) => x.id),
    deletedPurchaseOrderIds: (erp.purchaseOrders || []).slice(0, 1).map((x) => x.id),
    deletedFuturoQualquerIds: ['x-1'],
  } as Record<string, string[]>;
};
const sizes = (repo: CrmRepository) => {
  const s = repo.getState();
  const erp = s.erp!;
  return [s.contacts.length, s.companies.length, s.deals.length, (s.tasks || []).length, erp.rentalContracts.length, erp.catalog.length,
    (erp.suppliers || []).length, (erp.employees || []).length, (erp.salesOrders || []).length, (erp.serviceOrders || []).length, (erp.purchaseOrders || []).length].join(',');
};

describe('CISO 19/11: exclusao pelo journal exige alcada e carteira', () => {
  it('usuario SEM alcada de exclusao: nenhuma chave deleted*Ids apaga nada (reconcile, bootstrap, state, _reconcileJournal)', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const before = sizes(repo);
    const journal = ALL_DELETE_KEYS(repo);
    const calls: Array<[string, string, Record<string, unknown>]> = [
      ['POST', '/api/state/reconcile', { journal: structuredClone(journal) }],
      ['POST', '/api/bootstrap', { reconcileJournal: structuredClone(journal) }],
      ['POST', '/api/state', { reconcileJournal: structuredClone(journal) }],
      ['GET', '/api/erp/overview', { _reconcileJournal: structuredClone(journal) }],
    ];
    for (const [method, path, body] of calls) {
      const r = await router.dispatch({ method, path, query: SELLER(), body });
      assert.ok(r.status < 500, `${method} ${path}: ${r.status}`);
    }
    assert.equal(sizes(repo), before, 'nada apagado');
    assert.equal(Object.keys(repo.getState().recordTombstones || {}).length, 0, 'nenhum tombstone');
    const denied = repo.listSecurityAuditLogs(10000).logs.filter((l) => l.action === 'JOURNAL_DELETE_DENIED');
    assert.ok(denied.length >= 3, 'negativas auditadas');
    const r = await router.dispatch({ method: 'POST', path: '/api/state/reconcile', query: SELLER(), body: { journal: structuredClone(journal) } });
    assert.ok(((r.body as { reconciliation?: { deletionsDropped?: number } }).reconciliation?.deletionsDropped || 0) >= 10);
  });

  it('usuario COM alcada mas carteira PROPRIOS: apaga o proprio contato; o de outro dono, contrato alheio e fornecedor ficam', async () => {
    const repo = createInMemoryRepository();
    addRestrictedDeleter(repo);
    const router = new CrmApiRouter(repo);
    freshContact(repo, 'ct-perf-meu', DELETER_ID);
    freshContact(repo, 'ct-perf-alheio', 'usr-seta-02');
    freshSupplier(repo, 'sup-perf-1');
    const ctr = repo.getState().erp!.rentalContracts[0];
    const r = await router.dispatch({
      method: 'POST', path: '/api/state/reconcile', query: DELETER(),
      body: { journal: { deletedContactIds: ['ct-perf-meu', 'ct-perf-alheio'], deletedSupplierIds: ['sup-perf-1'], deletedContractIds: [ctr.id] } },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
    assert.ok(!hasContact(repo, 'ct-perf-meu'), 'proprio: apagado');
    assert.ok(hasContact(repo, 'ct-perf-alheio'), 'fora da carteira: mantido');
    assert.ok((repo.getState().erp!.suppliers || []).some((x) => x.id === 'sup-perf-1'), 'fornecedor (sem dono) mantido no escopo restrito');
    assert.ok(repo.getState().erp!.rentalContracts.some((c) => c.id === ctr.id), 'contrato alheio mantido');
    assert.deepEqual(tombs(repo, 'contacts'), ['ct-perf-meu'], 'so a exclusao autorizada virou tombstone');
    assert.equal(tombs(repo, 'erp.suppliers').length + tombs(repo, 'erp.rentalContracts').length, 0);
  });

  it('administrador: apaga contato livre e fornecedor; registro em uso nao e apagado pelo journal', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    freshContact(repo, 'ct-perf-livre', null);
    freshSupplier(repo, 'sup-perf-2');
    const usedCompany = repo.getState().erp!.rentalContracts.find((c) => c.companyId)?.companyId;
    assert.ok(usedCompany, 'empresa com contrato (em uso)');
    const r = await router.dispatch({
      method: 'POST', path: '/api/state/reconcile', query: ADMIN(),
      body: { journal: { deletedContactIds: ['ct-perf-livre'], deletedSupplierIds: ['sup-perf-2'], deletedCompanyIds: [usedCompany] } },
    });
    assert.equal(r.status, 200);
    assert.ok(!hasContact(repo, 'ct-perf-livre'));
    assert.ok(!(repo.getState().erp!.suppliers || []).some((x) => x.id === 'sup-perf-2'));
    assert.ok(repo.getState().companies.some((c) => c.id === usedCompany), 'empresa em uso mantida');
    assert.deepEqual(tombs(repo, 'contacts'), ['ct-perf-livre']);
    assert.deepEqual(tombs(repo, 'erp.suppliers'), ['sup-perf-2']);
  });
});

describe('CISO 19/11 (b): exclusao explicita autorizada que esvazia colecao grande gera tombstone', () => {
  it('admin apaga pelo journal os 12 fornecedores (colecao zera) => 12 tombstones; DELETE por metodo tambem', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    repo.getState().erp!.suppliers = [];
    for (let i = 0; i < 12; i++) freshSupplier(repo, `sup-zera-${i}`);
    const ids = repo.getState().erp!.suppliers!.map((x) => x.id);
    const r = await router.dispatch({ method: 'POST', path: '/api/state/reconcile', query: ADMIN(), body: { journal: { deletedSupplierIds: ids } } });
    assert.equal(r.status, 200);
    assert.equal(repo.getState().erp!.suppliers!.length, 0);
    assert.equal(tombs(repo, 'erp.suppliers').length, 12);

    const repo2 = createInMemoryRepository();
    const emps = (repo2.getState().erp!.employees ||= []);
    while (emps.length < 12) emps.push({ ...(structuredClone(emps[0] || {}) as object), id: `emp-zera-${emps.length}` } as never);
    for (const e of [...emps]) repo2.deleteErpCollectionRecord('employees', e.id);
    assert.equal(repo2.getState().erp!.employees!.length, 0);
    assert.equal(tombs(repo2, 'erp.employees').length, 12);
  });
});

/** Router "singleton" com o armazenamento do estado simulado (sem banco). */
function storeBackedRouter(opts: {
  load?: () => Promise<CrmDatabaseState | null>;
  write?: (n: number) => Promise<void>;
}) {
  const repo = createInMemoryRepository();
  const snapshot = structuredClone(repo.getState());
  const router = new CrmApiRouter(repo);
  const r = router as unknown as Record<string, unknown>;
  r.isSingletonRepo = true;
  r.stateStoreEnabled = () => true;
  r.loadStateFromStore = opts.load || (async () => structuredClone(snapshot));
  let writes = 0;
  r.writeStateToStore = async () => {
    writes++;
    if (opts.write) await opts.write(writes);
  };
  return { router, repo, writes: () => writes };
}
const ackOf = (res: { body: unknown }) => (res.body as { reconciliation?: { journalAck?: boolean } }).reconciliation?.journalAck;
const boot = (router: CrmApiRouter, journal: Record<string, unknown> = { deletedFuturoIds: [] }) =>
  router.dispatch({ method: 'POST', path: '/api/bootstrap', query: {}, body: { reconcileJournal: journal }, context: TRUSTED_INTERNAL_CONTEXT });

describe('CISO 19/11 (a): journalAck por requisicao', () => {
  it('duas requisicoes concorrentes: a gravacao lenta OK e a rapida que falha => um ack true e um false', async () => {
    const { router } = storeBackedRouter({
      write: async (n) => {
        if (n === 1) {
          await new Promise((res) => setTimeout(res, 60));
          return; // 1a gravacao: lenta e bem-sucedida
        }
        throw new Error('falha simulada'); // 2a gravacao: rapida e falha
      },
    });
    const [a, b] = await Promise.all([boot(router), new Promise((r) => setTimeout(r, 5)).then(() => boot(router))]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const acks = [ackOf(a), ackOf(b)].sort();
    assert.deepEqual(acks, [false, true], `cada ack segue a SUA gravacao (obtido ${JSON.stringify([ackOf(a), ackOf(b)])})`);
  });

  it('o router nao guarda mais o resultado da gravacao em campo da instancia', () => {
    const src = readFileSync('src/api/router.ts', 'utf8');
    assert.doesNotMatch(src, /lastPersistFailed/);
  });
});

describe('CISO 19/11 (c): carga do estado falhou => nada grava', () => {
  for (const [label, load] of [
    ['excecao', async () => { throw new Error('pg fora'); }],
    ['retorno nulo', async () => null],
  ] as Array<[string, () => Promise<CrmDatabaseState | null>]>) {
    it(`carga com ${label}: escrita => 503 sem gravar; bootstrap responde com journalAck=false e sem gravar`, async () => {
      const { router, writes } = storeBackedRouter({ load });
      const w = await router.dispatch({
        method: 'POST', path: '/api/state/reconcile', query: {}, body: { journal: { deletedContactIds: ['x'] } }, context: TRUSTED_INTERNAL_CONTEXT,
      });
      assert.equal(w.status, 503);
      assert.equal((w.body as { code?: string }).code, 'STATE_STORE_UNAVAILABLE');
      const b = await boot(router, { upsertedContacts: [] });
      assert.equal(b.status, 200);
      assert.equal(ackOf(b), false);
      assert.equal(writes(), 0, 'nenhuma gravacao do fallback local');
    });
  }

  it('carga OK grava normalmente e confirma', async () => {
    const { router, writes } = storeBackedRouter({});
    const b = await boot(router);
    assert.equal(b.status, 200);
    assert.equal(ackOf(b), true);
    assert.ok(writes() >= 1);
  });

  it('syncStateToPostgres recusa gravar dentro de requisicao cuja carga falhou; seed automatico so no cli-migrate', async () => {
    await assert.rejects(
      runWithStateRequestContext({ stateLoadOk: false }, () => syncStateToPostgres(createInMemoryRepository().getState())),
      (e: unknown) => e instanceof StateWriteBlockedError
    );
    const pg = readFileSync('src/db/postgres.ts', 'utf8');
    assert.match(pg, /if \(!options\?\.forceReset && !options\?\.allowSeedInit\) \{\n\s+throw new CrmStateMissingError\(\);/);
    assert.match(readFileSync('src/db/cli-migrate.ts', 'utf8'), /allowSeedInit: true/);
  });
});
