// ============================================================================
// Plano de tabelas do ERP — E0 (base comum) + E2 (OS em erp_service_orders) — 18/11/2026
//  - DDL idempotente, cnpj_emitente com CHECK, colunas derivadas
//  - diff por linha + controle otimista (409), lista paginada (SQL e memoria)
//  - Trava de CNPJ das OS (gravacao manual e sync GC), guarda do JSON, backfill com CAS
//  - ensurePostgresSchema uma vez por processo; /api/health anonimo sem ler o estado
// Integracao com Postgres real: defina ERP_TABLES_TEST_PG_URL (loopback) para rodar.
// ============================================================================
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {
  applyErpTableDiff,
  diffHydratedErpRecords,
  erpRowColumns,
  erpRowValues,
  erpTableDdl,
  ErpTableCnpjError,
  ErpTableWriteConflictError,
  getErpStorageMode,
  hashErpRecord,
  isValidCnpj,
  KV_ERP_STORAGE_GUARD_TRIGGER_DDL,
  listErpTablePage,
  normalizePageArgs,
  paginateErpRecordsInMemory,
  reconcileErpTableFromJson,
  SETA_CNPJ_EMITENTE,
  stripErpTableResourcesForKv,
  dualDeleteLimit,
} from '../src/db/erp-table-store';
import {
  mergeGcServiceOrders,
  serviceOrderColumnValue,
  serviceOrdersNeededForRoute,
  SERVICE_ORDERS_SPEC,
  sortServiceOrdersForList,
  validateServiceOrderCnpj,
} from '../src/db/erp-service-orders-table';
import { runErpTableBackfill, BackfillAbort } from '../src/db/erp-table-backfill';
import { parseBackfillArgs } from '../scripts/erp-tables/backfill';
import { ensurePostgresSchema, getPostgresSchemaDdlRuns, syncStateToPostgres, resetErpDualSyncMemo } from '../src/db/postgres';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT, isAnonymousHealthProbe } from '../src/api/router';
import { createInitialSeedState } from '../src/db/seed';
import type { ErpServiceOrder } from '../src/db/types';

const CLIENTE_A = '11222333000181'; // CNPJ valido (Modulo 11)
const CLIENTE_B = '11444777000161'; // CNPJ valido (Modulo 11)

const os_ = (over: Partial<ErpServiceOrder> & Record<string, unknown> = {}): ErpServiceOrder =>
  ({
    id: 'os-1',
    code: '101',
    companyName: 'ARKLOK Equipamentos',
    sellerName: 'Marcelo Mira',
    technicianName: 'Michelle da Rocha',
    entryDate: '05/11/2026',
    exitDate: '—',
    status: 'Em andamento',
    totalAmount: 150.5,
    description: 'Troca de roteador',
    ...over,
  }) as ErpServiceOrder;

const colOf = (vals: unknown[], name: string) => vals[erpRowColumns(SERVICE_ORDERS_SPEC).indexOf(name)];

class FakeDb {
  calls: Array<{ text: string; params?: unknown[] }> = [];
  constructor(private responder: (text: string, params?: unknown[]) => { rows: any[] }) {}
  async query(text: string, params?: unknown[]) {
    this.calls.push({ text, params });
    return this.responder(text, params);
  }
}

describe('E0: base comum (erp-table-store)', () => {
  it('DDL idempotente com PK, UNIQUE lower(id), row_version e CHECK de 14 digitos no cnpj_emitente', () => {
    const ddl = erpTableDdl(SERVICE_ORDERS_SPEC);
    assert.match(ddl, /CREATE TABLE IF NOT EXISTS erp_service_orders/);
    assert.match(ddl, /id TEXT PRIMARY KEY/);
    assert.match(ddl, /row_version INTEGER NOT NULL DEFAULT 1/);
    assert.match(ddl, /cnpj_emitente CHAR\(14\) NOT NULL DEFAULT '14806925000132'/);
    assert.match(ddl, /CHECK \(cnpj_emitente ~ '\^\[0-9\]\{14\}\$'\)/);
    assert.match(ddl, /CREATE UNIQUE INDEX IF NOT EXISTS ux_erp_service_orders_id_lower ON erp_service_orders \(lower\(id\)\)/);
    // Nenhum UNIQUE por CNPJ de cliente (matriz e filiais ficam separadas) nem por codigo nesta etapa.
    assert.doesNotMatch(ddl, /UNIQUE[^;]*cliente_cnpj/);
    assert.doesNotMatch(ddl, /UNIQUE[^;]*\(lower\(code\)\)/);
    for (const stmt of ddl.split(';').map((x) => x.trim()).filter(Boolean)) {
      assert.match(stmt, /IF NOT EXISTS/, `DDL nao idempotente: ${stmt.slice(0, 60)}`);
    }
  });

  it('trigger guarda: modo table zera o array e mantem o marcador; dual nunca some; scripts podem desligar', () => {
    assert.match(KV_ERP_STORAGE_GUARD_TRIGGER_DDL, /old_mode = 'table' OR new_mode = 'table'/);
    assert.match(KV_ERP_STORAGE_GUARD_TRIGGER_DDL, /ARRAY\['erp', k\], '\[\]'::jsonb/);
    assert.match(KV_ERP_STORAGE_GUARD_TRIGGER_DDL, /old_mode = 'dual' AND new_mode IS NULL/);
    assert.match(KV_ERP_STORAGE_GUARD_TRIGGER_DDL, /current_setting\('stihub\.erp_storage_guard', true\)/);
    assert.match(KV_ERP_STORAGE_GUARD_TRIGGER_DDL, /k = 'proposals'/);
  });

  it('marcador por recurso e documento do KV sem os recursos em modo table', () => {
    assert.equal(getErpStorageMode({ erp: {} }, 'serviceOrders'), 'json');
    assert.equal(getErpStorageMode({ erp: { storage: { serviceOrders: 'dual' } } }, 'serviceOrders'), 'dual');
    assert.equal(getErpStorageMode({ erp: { storage: { serviceOrders: 'table' } } }, 'serviceOrders'), 'table');
    const st = { erp: { storage: { serviceOrders: 'table' }, serviceOrders: [os_()], catalog: [{ id: 'c' }] } } as any;
    const kv = stripErpTableResourcesForKv(st) as any;
    assert.deepEqual(kv.erp.serviceOrders, []);
    assert.equal(kv.erp.catalog.length, 1);
    assert.equal(st.erp.serviceOrders.length, 1, 'estado em memoria intacto');
    const dual = { erp: { storage: { serviceOrders: 'dual' }, serviceOrders: [os_()] } } as any;
    assert.equal((stripErpTableResourcesForKv(dual) as any).erp.serviceOrders.length, 1, 'dual mantem o JSON completo');
  });

  it('paginacao: limite padrao 50, teto 200, offset nao negativo', () => {
    assert.deepEqual(normalizePageArgs(undefined, undefined), { limit: 50, offset: 0 });
    assert.deepEqual(normalizePageArgs(5000, -3), { limit: 200, offset: 0 });
    assert.deepEqual(normalizePageArgs('20', '40'), { limit: 20, offset: 40 });
    assert.deepEqual(normalizePageArgs('abc', 'x'), { limit: 50, offset: 0 });
  });

  it('lista SQL: busca normalizada, digitos, filtros fixos do spec e LIMIT/OFFSET parametrizados', async () => {
    const db = new FakeDb((t) => (t.includes('count(*)') ? { rows: [{ n: 3 }] } : { rows: [{ data: os_(), row_version: 2 }] }));
    const page = await listErpTablePage(db, SERVICE_ORDERS_SPEC, {
      q: 'Arklok 11.222',
      filters: { status: 'Em andamento', companyId: 'TODOS', hack: 'x' } as any,
      limit: 2,
      offset: 2,
    });
    assert.equal(page.total, 3);
    assert.equal(page.limit, 2);
    assert.equal(page.offset, 2);
    const sel = db.calls[1];
    assert.match(sel.text, /search_text LIKE \$1 OR search_digits LIKE \$2/);
    assert.match(sel.text, /status = \$3/);
    assert.doesNotMatch(sel.text, /company_id =/);
    assert.match(sel.text, /ORDER BY code_num DESC NULLS LAST, created_at DESC, id LIMIT \$4 OFFSET \$5/);
    assert.deepEqual(sel.params, ['%arklok 11.222%', '%11222%', 'Em andamento', 2, 2]);
  });

  it('diff por linha e controle otimista: update/delete com row_version velho => conflito', async () => {
    const a = os_({ id: 'a' });
    const b = os_({ id: 'b' });
    const hydrated = new Map([
      ['a', { hash: hashErpRecord(a), rowVersion: 3 }],
      ['b', { hash: hashErpRecord(b), rowVersion: 1 }],
    ]);
    const diff = diffHydratedErpRecords(hydrated, [{ ...a, status: 'Concluída' }, os_({ id: 'c' })]);
    assert.deepEqual(diff.inserts.map((x) => x.id), ['c']);
    assert.deepEqual(diff.updates.map((x) => [x.record.id, x.expectedRowVersion]), [['a', 3]]);
    assert.deepEqual(diff.deletes, [{ id: 'b', expectedRowVersion: 1 }]);

    const db = new FakeDb((t) => (t.startsWith('UPDATE') ? { rows: [] } : { rows: [{ id: 'c' }] }));
    await assert.rejects(() => applyErpTableDiff(db, SERVICE_ORDERS_SPEC, diff), (e: unknown) => e instanceof ErpTableWriteConflictError && e.recordId === 'a');
    const upd = db.calls.find((c) => c.text.startsWith('UPDATE'))!;
    assert.match(upd.text, /WHERE id = \$1 AND row_version = \$\d+ RETURNING row_version/);
    assert.match(upd.text, /row_version = row_version \+ 1/);

    const strict = new FakeDb(() => ({ rows: [] }));
    await assert.rejects(
      () => applyErpTableDiff(strict, SERVICE_ORDERS_SPEC, { inserts: [os_({ id: 'dup' })], updates: [], deletes: [] }, { strictInserts: true }),
      ErpTableWriteConflictError
    );
  });

  it('dupla escrita (dual): so regrava o que mudou e nao apaga em massa', async () => {
    const a = os_({ id: 'a' });
    const rows = [{ id: 'a', row_hash: hashErpRecord(a) }, { id: 'gone', row_hash: 'x' }];
    const db = new FakeDb((t) => (t.startsWith('SELECT id, row_hash') ? { rows } : { rows: [{ id: 'gone' }] }));
    const r = await reconcileErpTableFromJson(db, SERVICE_ORDERS_SPEC, [a, os_({ id: 'novo' })]);
    assert.equal(db.calls.filter((c) => c.text.includes('INSERT')).length, 1);
    const ins = db.calls.find((c) => c.text.includes('INSERT'))!;
    assert.equal(ins.params![0], 'novo', 'so a linha nova/alterada vai para o upsert');
    assert.match(ins.text, /WHERE t\.row_hash IS DISTINCT FROM EXCLUDED\.row_hash/);
    assert.equal(r.deleted, 1);

    const many = Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, row_hash: 'h' }));
    const db2 = new FakeDb((t) => (t.startsWith('SELECT id, row_hash') ? { rows: many } : { rows: [] }));
    const r2 = await reconcileErpTableFromJson(db2, SERVICE_ORDERS_SPEC, [os_({ id: 'unico' })]);
    assert.equal(r2.deleted, 0);
    assert.equal(r2.deletesSkipped, 30, 'acima do limite de exclusoes: nada e apagado');
    assert.ok(!db2.calls.some((c) => c.text.startsWith('DELETE')));
    const empty = new FakeDb((t) => (t.startsWith('SELECT id, row_hash') ? { rows: [{ id: 'a', row_hash: 'h' }] } : { rows: [] }));
    const r3 = await reconcileErpTableFromJson(empty, SERVICE_ORDERS_SPEC, []);
    assert.equal(r3.deletesSkipped, 1, 'JSON vazio nunca apaga a tabela');
    assert.equal(dualDeleteLimit(1406), 71);
  });
});

describe('E2: OS — colunas, Trava de CNPJ e rotas', () => {
  it('colunas derivadas: numero, datas, total, CNPJ do cliente so digitos e emitente padrao Seta', () => {
    const v = erpRowValues(SERVICE_ORDERS_SPEC, os_({ code: '0101', companyCnpj: '11.222.333/0001-81', entryDate: '05/11/2026', exitDate: '—' }));
    assert.equal(colOf(v, 'code_num'), 101);
    assert.equal(colOf(v, 'entry_date'), '2026-11-05');
    assert.equal(colOf(v, 'exit_date'), null);
    assert.equal(colOf(v, 'total'), 150.5);
    assert.equal(colOf(v, 'cliente_cnpj'), CLIENTE_A);
    assert.equal(colOf(v, 'cnpj_emitente'), SETA_CNPJ_EMITENTE);
    assert.equal(isValidCnpj(SETA_CNPJ_EMITENTE), true);
    assert.match(String(colOf(v, 'search_text')), /arklok equipamentos/);
    assert.match(String(colOf(v, 'search_digits')), /11222333000181/);
  });

  it('cnpj_emitente invalido => gravacao recusada (ErpTableCnpjError)', () => {
    assert.throws(() => erpRowValues(SERVICE_ORDERS_SPEC, os_({ cnpjEmitente: '123' })), ErpTableCnpjError);
    assert.throws(() => erpRowValues(SERVICE_ORDERS_SPEC, os_({ cnpjEmitente: '14806925000133' })), ErpTableCnpjError);
    assert.equal(colOf(erpRowValues(SERVICE_ORDERS_SPEC, os_({ cnpjEmitente: '11.444.777/0001-61' })), 'cnpj_emitente'), CLIENTE_B);
  });

  it('gravacao manual: CNPJ invalido ou diferente do cliente selecionado e recusado', () => {
    assert.match(String(validateServiceOrderCnpj({ companyCnpj: '11.222.333/0001-00' })), /inválido/);
    assert.match(String(validateServiceOrderCnpj({ companyCnpj: CLIENTE_A }, { cnpj: '11.444.777/0001-61' })), /Trava Fiscal/);
    assert.equal(validateServiceOrderCnpj({ companyCnpj: '11.222.333/0001-81' }, { cnpj: CLIENTE_A }), null);
    assert.equal(validateServiceOrderCnpj({}, { cnpj: CLIENTE_A }), null, 'OS sem CNPJ (GC) continua aceita');
    assert.match(String(validateServiceOrderCnpj({ cnpjEmitente: '000' })), /emitente/);
  });

  it('sync GC: upsert por id, nunca por CNPJ; CNPJ divergente vira conflito e nao mescla', () => {
    const current = [os_({ id: '9001', code: '9001', companyCnpj: CLIENTE_A, priority: 'ALTA' }), os_({ id: '9002', code: '9002', companyCnpj: CLIENTE_A })];
    const { list, conflicts } = mergeGcServiceOrders(current, [
      os_({ id: '9001', code: '9001', status: 'Concluída' }),
      os_({ id: '9002', code: '9002', companyCnpj: CLIENTE_B, status: 'Cancelada' }),
      os_({ id: '9003', code: '9003', companyCnpj: CLIENTE_A }),
    ]);
    assert.equal(list.length, 3, 'mesmo CNPJ com ids diferentes nunca e mesclado');
    const o1 = list.find((o) => o.id === '9001')!;
    assert.equal(o1.status, 'Concluída');
    assert.equal(o1.priority, 'ALTA', 'campo so do STI-hub fica');
    const o2 = list.find((o) => o.id === '9002')!;
    assert.equal(o2.status, 'Em andamento', 'conflito de CNPJ: OS existente intacta');
    assert.equal(o2.companyCnpj, CLIENTE_A);
    assert.deepEqual(conflicts.map((c) => [c.id, c.cnpjAtual, c.cnpjGc]), [['9002', CLIENTE_A, CLIENTE_B]]);
  });

  it('lista em memoria (modo json/fallback): mesma ordem, busca e filtros da lista SQL', () => {
    const list = sortServiceOrdersForList([os_({ id: 'a', code: '9' }), os_({ id: 'b', code: '120', status: 'Concluída' }), os_({ id: 'c', code: '15', companyCnpj: CLIENTE_A })]);
    assert.deepEqual(list.map((o) => o.code), ['120', '15', '9']);
    const p1 = paginateErpRecordsInMemory(SERVICE_ORDERS_SPEC, list, { limit: 2, offset: 1 }, serviceOrderColumnValue);
    assert.deepEqual([p1.total, p1.data.map((o) => o.code)], [3, ['15', '9']]);
    const p2 = paginateErpRecordsInMemory(SERVICE_ORDERS_SPEC, list, { q: '11.222.333' }, serviceOrderColumnValue);
    assert.deepEqual(p2.data.map((o) => o.id), ['c']);
    const p3 = paginateErpRecordsInMemory(SERVICE_ORDERS_SPEC, list, { filters: { status: 'Concluída' } }, serviceOrderColumnValue);
    assert.deepEqual(p3.data.map((o) => o.id), ['b']);
  });

  it('hidratacao: so rotas que comprovadamente nao usam OS ficam de fora', () => {
    assert.equal(serviceOrdersNeededForRoute('GET', '/api/erp/service-orders'), false);
    assert.equal(serviceOrdersNeededForRoute('GET', '/api/health'), false);
    assert.equal(serviceOrdersNeededForRoute('GET', '/api/mailbox/status'), false);
    assert.equal(serviceOrdersNeededForRoute('GET', '/api/companies'), false);
    assert.equal(serviceOrdersNeededForRoute('DELETE', '/api/companies/x'), true, 'exclusao confere registro em uso nas OS');
    assert.equal(serviceOrdersNeededForRoute('GET', '/api/erp/overview'), true);
    assert.equal(serviceOrdersNeededForRoute('GET', '/api/bootstrap'), true);
    assert.equal(serviceOrdersNeededForRoute('POST', '/api/tickets/T-1/service-order'), true);
    assert.equal(serviceOrdersNeededForRoute('GET', '/api/me/preferences', { _reconcileJournal: { upsertedServiceOrders: [{}] } }), true);
    assert.equal(serviceOrdersNeededForRoute('GET', '/api/healthz'), true, 'prefixo exato');
  });
});

describe('Correcoes rapidas: ensurePostgresSchema uma vez e /api/health anonimo', () => {
  it('pool externo: o DDL base roda uma vez por pool; force roda de novo', async () => {
    const pool = new FakeDb(() => ({ rows: [] }));
    const before = getPostgresSchemaDdlRuns();
    await ensurePostgresSchema(pool as any);
    await ensurePostgresSchema(pool as any);
    await ensurePostgresSchema(pool as any);
    assert.equal(getPostgresSchemaDdlRuns() - before, 1);
    await ensurePostgresSchema(pool as any, { force: true });
    assert.equal(getPostgresSchemaDdlRuns() - before, 2);
  });

  it('syncStateToPostgres repetido nao repete o DDL base', async () => {
    const client = { query: async () => ({ rows: [] }), release: () => undefined };
    const pool = { query: async () => ({ rows: [] }), connect: async () => client };
    const before = getPostgresSchemaDdlRuns();
    const state = createInitialSeedState();
    await syncStateToPostgres(state, { pool: pool as any });
    await syncStateToPostgres(state, { pool: pool as any });
    assert.equal(getPostgresSchemaDdlRuns() - before, 1);
  });

  it('GET /api/health sem sessao e fora do contexto interno nao precisa do estado', () => {
    assert.equal(isAnonymousHealthProbe('GET', '/api/health', {}, false), true);
    assert.equal(isAnonymousHealthProbe('GET', '/api/health', { _sessionToken: 'x' }, false), false);
    assert.equal(isAnonymousHealthProbe('GET', '/api/health', {}, true), false);
    assert.equal(isAnonymousHealthProbe('POST', '/api/health', {}, false), false);
    assert.equal(isAnonymousHealthProbe('GET', '/api/me/preferences', {}, false), false);
  });

  it('GET /api/health anonimo continua {status:"ok"}', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    const r = await router.dispatch({ method: 'GET', path: '/api/health' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { status: 'ok' });
  });
});

describe('E2: rotas das OS no modo JSON (sem marcador)', () => {
  it('GET /api/erp/service-orders pagina e filtra o JSON; nunca vazio por falta de backfill', async () => {
    const repo = createInMemoryRepository();
    repo.getErpState().serviceOrders = [os_({ id: 'a', code: '1' }), os_({ id: 'b', code: '2', status: 'Concluída' }), os_({ id: 'c', code: '3' })];
    const router = new CrmApiRouter(repo);
    const r = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'GET', path: '/api/erp/service-orders?limit=2&offset=0' });
    assert.equal(r.status, 200);
    const body = r.body as any;
    assert.equal(body.total, 3);
    assert.equal(body.storage, 'json');
    assert.deepEqual(body.data.map((o: any) => o.code), ['3', '2']);
    const f = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'GET', path: '/api/erp/service-orders?status=Concluída' });
    assert.deepEqual((f.body as any).data.map((o: any) => o.id), ['b']);
  });

  it('POST /api/erp/service-orders recusa CNPJ diferente do cliente selecionado (Trava Fiscal)', async () => {
    const repo = createInMemoryRepository();
    const company = repo.getState().companies.find((c) => String(c.cnpj || '').replace(/\D/g, '').length === 14);
    assert.ok(company, 'seed com empresa com CNPJ');
    const router = new CrmApiRouter(repo);
    const other = String(company!.cnpj).replace(/\D/g, '') === CLIENTE_A ? CLIENTE_B : CLIENTE_A;
    const bad = await router.dispatch({
      context: TRUSTED_INTERNAL_CONTEXT,
      method: 'POST',
      path: '/api/erp/service-orders',
      body: { status: 'Em andamento', companyName: company!.name, companyId: company!.id, companyCnpj: other },
    });
    assert.equal(bad.status, 400);
    assert.equal((bad.body as any).code, 'SERVICE_ORDER_CNPJ_INVALID');
    const ok = await router.dispatch({
      context: TRUSTED_INTERNAL_CONTEXT,
      method: 'POST',
      path: '/api/erp/service-orders',
      body: { status: 'Em andamento', companyName: company!.name, companyId: company!.id, companyCnpj: company!.cnpj },
    });
    assert.equal(ok.status, 200);
  });
});

describe('Backfill: argumentos', () => {
  it('padrao e dry-run; uma acao por vez; corte exige --confirm-cut', () => {
    assert.deepEqual(parseBackfillArgs(['--resource', 'serviceOrders']), { resource: 'serviceOrders', action: 'plan', confirmCut: false });
    assert.equal(parseBackfillArgs(['--resource', 'serviceOrders', '--apply']).action, 'apply');
    assert.deepEqual(parseBackfillArgs(['--resource', 'serviceOrders', '--cut', '--confirm-cut']), { resource: 'serviceOrders', action: 'cut', confirmCut: true });
    assert.throws(() => parseBackfillArgs(['--apply', '--cut']));
  });
});

// ---------------------------------------------------------------------------
// Integracao com Postgres real (loopback). Ex.: ERP_TABLES_TEST_PG_URL=postgres://u@127.0.0.1:5432/db
// ---------------------------------------------------------------------------
const PG_URL = process.env.ERP_TABLES_TEST_PG_URL || '';

describe('Integracao Postgres: E0 + E2', { skip: PG_URL ? false : 'defina ERP_TABLES_TEST_PG_URL para rodar' }, () => {
  let pool: any;
  const seedOs = (): ErpServiceOrder[] => [
    os_({ id: 'os-a', code: '10', companyCnpj: CLIENTE_A, companyId: 'comp-a', totalAmount: 10 }),
    os_({ id: 'os-b', code: '11', status: 'Concluída', totalAmount: 20.25 }),
    os_({ id: '777001', code: '12', companyName: 'Construção Ágil', totalAmount: 30 }),
  ];
  const readKv = async () => (await pool.query(`SELECT payload FROM crm_kv_store WHERE key = 'crm_state_v1'`)).rows[0].payload;
  const backfill = async (action: 'plan' | 'apply' | 'cut' | 'rollback', opts: { confirmCut?: boolean } = {}) => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const r = await runErpTableBackfill(c, SERVICE_ORDERS_SPEC, action, opts);
      await c.query(action === 'plan' ? 'ROLLBACK' : 'COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  };

  before(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: PG_URL, max: 4 });
    await pool.query(`DROP TABLE IF EXISTS erp_service_orders; DROP TABLE IF EXISTS crm_kv_store CASCADE; DROP FUNCTION IF EXISTS crm_kv_erp_storage_guard_v1() CASCADE;`);
    await ensurePostgresSchema(pool, { force: true });
    const state = createInitialSeedState() as any;
    state.erp.serviceOrders = seedOs();
    await pool.query(`INSERT INTO crm_kv_store (key, payload) VALUES ('crm_state_v1', $1::jsonb)`, [JSON.stringify(state)]);
  });
  after(async () => {
    await pool?.end();
  });

  it('dry-run nao grava nada e reporta contagem e soma', async () => {
    const r = await backfill('plan');
    assert.equal(r.jsonCount, 3);
    assert.equal(r.jsonSum, 60.25);
    assert.equal(r.tableCountBefore, null);
    const t = await pool.query(`SELECT to_regclass('erp_service_orders') AS t`);
    assert.equal(t.rows[0].t, null);
  });

  it('apply: tabela populada, contagem e soma iguais, JSON intacto e marcador dual; repetir e idempotente', async () => {
    const r = await backfill('apply');
    assert.equal(r.modeAfter, 'dual');
    assert.equal(r.tableCountAfter, 3);
    assert.equal(r.tableSum, 60.25);
    const kv = await readKv();
    assert.equal(kv.erp.storage.serviceOrders, 'dual');
    assert.equal(kv.erp.serviceOrders.length, 3, 'o array do JSON nao e tocado');
    const again = await backfill('apply');
    assert.equal(again.written, 0);
    assert.match(again.result, /RESSINCRONIZADO/);
    const gc = await pool.query(`SELECT gc_id, cnpj_emitente, cliente_cnpj FROM erp_service_orders WHERE id = '777001'`);
    assert.equal(gc.rows[0].gc_id, '777001');
    assert.equal(gc.rows[0].cnpj_emitente, SETA_CNPJ_EMITENTE);
  });

  it('CHECK do banco recusa cnpj_emitente fora de 14 digitos', async () => {
    await assert.rejects(() =>
      pool.query(`INSERT INTO erp_service_orders (id, cnpj_emitente, data) VALUES ('x', '123', '{}'::jsonb)`)
    );
  });

  it('lista paginada SQL: limit/offset, busca por nome sem acento e por CNPJ, filtro de situacao', async () => {
    const p = await listErpTablePage(pool, SERVICE_ORDERS_SPEC, { limit: 2, offset: 0 });
    assert.deepEqual([p.total, p.data.map((o: any) => o.code)], [3, ['12', '11']]);
    const p2 = await listErpTablePage(pool, SERVICE_ORDERS_SPEC, { limit: 2, offset: 2 });
    assert.deepEqual(p2.data.map((o: any) => o.code), ['10']);
    const q = await listErpTablePage(pool, SERVICE_ORDERS_SPEC, { q: 'construcao' });
    assert.deepEqual(q.data.map((o: any) => o.id), ['777001']);
    const d = await listErpTablePage(pool, SERVICE_ORDERS_SPEC, { q: '11.222.333/0001' });
    assert.deepEqual(d.data.map((o: any) => o.id), ['os-a']);
    const s = await listErpTablePage(pool, SERVICE_ORDERS_SPEC, { filters: { status: 'Concluída' } });
    assert.deepEqual(s.data.map((o: any) => o.id), ['os-b']);
  });

  it('dupla escrita: gravacao do estado em dual atualiza a tabela; deploy antigo nao derruba o marcador', async () => {
    resetErpDualSyncMemo();
    const kv = await readKv();
    kv.erp.serviceOrders[0].status = 'Aguardando peça';
    kv.erp.serviceOrders.push(os_({ id: 'os-d', code: '13', totalAmount: 5 }));
    await syncStateToPostgres(kv, { pool });
    const row = await pool.query(`SELECT status, row_version FROM erp_service_orders WHERE id = 'os-a'`);
    assert.equal(row.rows[0].status, 'Aguardando peça');
    assert.equal(row.rows[0].row_version, 2);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM erp_service_orders`)).rows[0].n, 4);
    // Escritor antigo (sem erp.storage): o marcador dual e mantido pela guarda.
    const old = await readKv();
    delete old.erp.storage;
    await pool.query(`UPDATE crm_kv_store SET payload = $1::jsonb WHERE key = 'crm_state_v1'`, [JSON.stringify(old)]);
    const after1 = await readKv();
    assert.equal(after1.erp.storage.serviceOrders, 'dual');
    assert.equal(after1.erp.serviceOrders.length, 4);
  });

  it('CAS: se o crm_state_v1 mudar no meio, nada e gravado', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      let bumped = false;
      const racing = {
        query: async (text: string, params?: unknown[]) => {
          const r = await c.query(text, params);
          if (!bumped && text.includes('md5(payload::text) AS m')) {
            bumped = true;
            await pool.query(`UPDATE crm_kv_store SET payload = jsonb_set(payload, '{erp,_touch}', to_jsonb(now()::text)) WHERE key = 'crm_state_v1'`);
          }
          return r;
        },
      };
      await assert.rejects(() => runErpTableBackfill(racing, SERVICE_ORDERS_SPEC, 'cut', { confirmCut: true }), (e: unknown) => e instanceof BackfillAbort && /CAS md5/.test(e.message));
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
    const kv = await readKv();
    assert.equal(kv.erp.storage.serviceOrders, 'dual');
    assert.equal(kv.erp.serviceOrders.length, 4);
  });

  it('corte exige confirmacao; com ela o JSON fica [] e a guarda impede deploy antigo de recolocar OS', async () => {
    await assert.rejects(() => backfill('cut'), /confirm-cut/);
    const r = await backfill('cut', { confirmCut: true });
    assert.equal(r.modeAfter, 'table');
    assert.ok(r.stateBytesAfter! < r.stateBytesBefore);
    let kv = await readKv();
    assert.deepEqual(kv.erp.serviceOrders, []);
    assert.equal(kv.erp.storage.serviceOrders, 'table');
    // Deploy antigo grava o documento inteiro com OS e sem marcador.
    kv.erp.serviceOrders = seedOs();
    delete kv.erp.storage;
    await pool.query(`UPDATE crm_kv_store SET payload = $1::jsonb WHERE key = 'crm_state_v1'`, [JSON.stringify(kv)]);
    kv = await readKv();
    assert.deepEqual(kv.erp.serviceOrders, []);
    assert.equal(kv.erp.storage.serviceOrders, 'table');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM erp_service_orders`)).rows[0].n, 4, 'tabela intacta');
  });

  it('modo table: conflito de row_version => nada gravado (nem tabela nem JSON)', async () => {
    const kvBefore = await readKv();
    const cur = await pool.query(`SELECT data, row_version FROM erp_service_orders WHERE id = 'os-b'`);
    const rec = { ...cur.rows[0].data, status: 'Reaberta' };
    const marker = { ...kvBefore, erp: { ...kvBefore.erp, _marca: 'nao-deve-gravar' } };
    await assert.rejects(
      () =>
        syncStateToPostgres(marker, {
          pool,
          erpTables: [{ spec: SERVICE_ORDERS_SPEC, diff: { inserts: [], updates: [{ record: rec, expectedRowVersion: cur.rows[0].row_version + 5 }], deletes: [] } }],
        }),
      ErpTableWriteConflictError
    );
    const after2 = await readKv();
    assert.equal(after2.erp._marca, undefined);
    const still = await pool.query(`SELECT status FROM erp_service_orders WHERE id = 'os-b'`);
    assert.equal(still.rows[0].status, 'Concluída');
  });

  it('rollback: tabela volta para o JSON em modo dual (tabela preservada)', async () => {
    const r = await backfill('rollback');
    assert.equal(r.modeAfter, 'dual');
    const kv = await readKv();
    assert.equal(kv.erp.storage.serviceOrders, 'dual');
    assert.equal(kv.erp.serviceOrders.length, 4);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM erp_service_orders`)).rows[0].n, 4);
    // volta ao corte para os testes do roteador
    await backfill('cut', { confirmCut: true });
  });

  describe('roteador com DATABASE_URL (modo table)', () => {
    let router: CrmApiRouter;
    const savedEnv = { db: process.env.DATABASE_URL, store: process.env.CRM_STORE_PATH };
    before(() => {
      process.env.DATABASE_URL = PG_URL;
      process.env.CRM_STORE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'erp-e2-')), 'store.json');
      router = new CrmApiRouter();
    });
    after(async () => {
      const { closePostgresPool } = await import('../src/db/postgres');
      await closePostgresPool();
      if (savedEnv.db === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = savedEnv.db;
      if (savedEnv.store === undefined) delete process.env.CRM_STORE_PATH;
      else process.env.CRM_STORE_PATH = savedEnv.store;
    });
    const call = (method: string, p: string, body?: Record<string, unknown>) =>
      router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method, path: p, body });

    it('lista paginada vem da tabela', async () => {
      const r = await call('GET', '/api/erp/service-orders?limit=2');
      assert.equal(r.status, 200);
      assert.equal((r.body as any).storage, 'table');
      assert.equal((r.body as any).total, 4);
      assert.equal((r.body as any).data.length, 2);
    });

    it('rota que usa as OS hidrata da tabela (overview); troca de situacao grava por linha e o JSON segue []', async () => {
      const ov = await call('GET', '/api/erp/overview');
      assert.equal(ov.status, 200);
      assert.equal((ov.body as any).data.serviceOrders.length, 4);
      const st = await call('POST', '/api/erp/service-orders/os-b/status', { status: 'Em andamento' });
      assert.equal(st.status, 200);
      const row = await pool.query(`SELECT status, row_version FROM erp_service_orders WHERE id = 'os-b'`);
      assert.equal(row.rows[0].status, 'Em andamento');
      assert.ok(row.rows[0].row_version >= 2);
      const kv = await readKv();
      assert.deepEqual(kv.erp.serviceOrders, []);
    });

    it('OS nova pela rota entra na tabela', async () => {
      const r = await call('POST', '/api/erp/service-orders', { id: 'os-nova', code: '14', status: 'Em andamento', companyName: 'Cliente Novo' });
      assert.equal(r.status, 200);
      const row = await pool.query(`SELECT code FROM erp_service_orders WHERE id = 'os-nova'`);
      assert.equal(row.rows[0].code, '14');
    });

    it('tabela indisponivel => 503 (nunca lista vazia) na lista e nas rotas que usam OS', async () => {
      await pool.query(`ALTER TABLE erp_service_orders RENAME TO erp_service_orders_off`);
      try {
        const l = await call('GET', '/api/erp/service-orders');
        assert.equal(l.status, 503);
        assert.equal((l.body as any).code, 'SERVICE_ORDERS_STORE_UNAVAILABLE');
        const ov = await call('GET', '/api/erp/overview');
        assert.equal(ov.status, 503);
      } finally {
        await pool.query(`ALTER TABLE erp_service_orders_off RENAME TO erp_service_orders`);
      }
    });

    it('modo dual com tabela incompleta => lista cai no JSON (fallback), nunca vazia', async () => {
      await backfill('rollback');
      await pool.query(`ALTER TABLE erp_service_orders RENAME TO erp_service_orders_full`);
      await pool.query(`CREATE TABLE erp_service_orders (LIKE erp_service_orders_full INCLUDING ALL)`);
      try {
        const r = await call('GET', '/api/erp/service-orders?limit=100');
        assert.equal(r.status, 200);
        assert.equal((r.body as any).storage, 'json-fallback');
        assert.equal((r.body as any).total, 5);
      } finally {
        await pool.query(`DROP TABLE erp_service_orders`);
        await pool.query(`ALTER TABLE erp_service_orders_full RENAME TO erp_service_orders`);
      }
    });
  });
});
