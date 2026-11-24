// ============================================================================
// SetaDesk E1 (18/11/2026): serviceTickets fora do crm_state_v1, espelho
// crm_service_tickets desligado e lista de chamados paginada.
// O bloco "Postgres real" so roda com SETADESK_TEST_DATABASE_URL (banco descartavel).
// ============================================================================

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  KV_STATE_EXCLUDED_KEYS,
  KV_STATE_SELECT_SQL,
  KV_STATE_UPSERT_SQL,
  MIRROR_TABLES,
  RETIRED_MIRROR_TABLES,
  resetMirrorSnapshots,
  stateForKvPersist,
  syncStateToPostgres,
  type PgPoolLike,
} from '../src/db/postgres';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import {
  decodeTicketsCursor,
  encodeTicketsCursor,
  paginateTickets,
  parseTicketsPageParams,
  setaDeskLoadPlanForRoute,
  TICKETS_PAGE_DEFAULT_LIMIT,
  TICKETS_PAGE_MAX_LIMIT,
} from '../src/api/setadesk-route-plan';

function fakePool() {
  const log: Array<{ text: string; params?: unknown[] }> = [];
  const query = async (text: string, params?: unknown[]) => {
    log.push({ text, params });
    return { rows: [] as any[], rowCount: 0 };
  };
  const pool: PgPoolLike = { query, connect: async () => ({ query, release: () => undefined }) };
  return { pool, log };
}

describe('E1 - persistencia nao grava serviceTickets', () => {
  it('stateForKvPersist remove serviceTickets e preserva o resto', () => {
    const repo = createInMemoryRepository();
    const state = repo.getState();
    assert.ok((state.serviceTickets || []).length > 0, 'seed tem chamados');
    const out = stateForKvPersist(state) as unknown as Record<string, unknown>;
    assert.equal('serviceTickets' in out, false);
    assert.equal(out.companies, state.companies);
    assert.ok(Array.isArray(state.serviceTickets), 'o estado original nao e alterado');
    assert.deepEqual([...KV_STATE_EXCLUDED_KEYS], ['serviceTickets']);
  });

  it('syncStateToPostgres envia o crm_state_v1 sem serviceTickets e nao toca em crm_service_tickets', async () => {
    resetMirrorSnapshots();
    const repo = createInMemoryRepository();
    repo.createServiceTicket({ subject: 'Nao vai para o JSON', key: 'TEC-900' });
    const { pool, log } = fakePool();
    await syncStateToPostgres(repo.getState(), { pool });
    const kv = log.find((q) => q.text.includes('INSERT INTO crm_kv_store') && q.params?.[0] === 'crm_state_v1');
    assert.ok(kv, 'gravou o crm_state_v1');
    const payload = JSON.parse(String(kv!.params![1]));
    assert.equal('serviceTickets' in payload, false);
    assert.ok(Array.isArray(payload.companies) && payload.companies.length > 0);
    const touched = log.filter((q) => /crm_service_tickets/.test(q.text) && !/CREATE (TABLE|INDEX)/.test(q.text));
    assert.equal(touched.length, 0, 'espelho crm_service_tickets nao e lido nem gravado');
    assert.equal(MIRROR_TABLES.some((t) => t.table === 'crm_service_tickets'), false);
    assert.deepEqual([...RETIRED_MIRROR_TABLES], ['crm_service_tickets']);
  });

  it('modo tabela de propostas tambem nao grava serviceTickets', async () => {
    resetMirrorSnapshots();
    const repo = createInMemoryRepository();
    const { pool, log } = fakePool();
    await syncStateToPostgres(repo.getState(), {
      pool,
      proposals: { diff: { inserts: [], updates: [], deletes: [] } as never },
    });
    const kv = log.find((q) => q.text.includes('INSERT INTO crm_kv_store') && q.params?.[0] === 'crm_state_v1');
    const payload = JSON.parse(String(kv!.params![1]));
    assert.equal('serviceTickets' in payload, false);
  });

  it('o upsert preserva a chave antiga (nada apagado) e a leitura a descarta', () => {
    assert.match(KV_STATE_UPSERT_SQL, /crm_kv_store\.payload \? 'serviceTickets'/);
    assert.match(KV_STATE_UPSERT_SQL, /jsonb_build_object\('serviceTickets', crm_kv_store\.payload->'serviceTickets'\)/);
    assert.doesNotMatch(KV_STATE_UPSERT_SQL, /payload - 'serviceTickets'/);
    assert.match(KV_STATE_SELECT_SQL, /payload - 'serviceTickets'/);
  });
});

describe('E1 - plano de carga por rota', () => {
  it('portal le so a chave informada; criacao nao le nada e grava', () => {
    assert.deepEqual(setaDeskLoadPlanForRoute('GET', '/api/portal/tickets', { key: 'TEC-12' }, {}), {
      refs: ['TEC-12'],
      includeComments: true,
      sync: false,
    });
    assert.deepEqual(setaDeskLoadPlanForRoute('GET', '/api/portal/tickets', {}, {})?.refs, []);
    assert.deepEqual(setaDeskLoadPlanForRoute('POST', '/api/portal/tickets', {}, {}), { refs: [], includeComments: false, sync: true });
    assert.deepEqual(setaDeskLoadPlanForRoute('POST', '/api/portal/tickets/FIN-3/reply', {}, {})?.refs, ['FIN-3']);
    assert.deepEqual(setaDeskLoadPlanForRoute('POST', '/api/portal/tickets/FIN-3/csat', {}, {})?.sync, true);
    assert.equal(setaDeskLoadPlanForRoute('POST', '/api/portal/tickets/%E0%A4%A/reply', {}, {})?.refs?.length, 0);
  });

  it('formulario, importacao HubSpot e e-mail vinculado; demais rotas nao carregam', () => {
    assert.deepEqual(setaDeskLoadPlanForRoute('POST', '/api/forms/submit', {}, {})?.refs, []);
    assert.deepEqual(setaDeskLoadPlanForRoute('POST', '/api/migration/hubspot', {}, {})?.refs, []);
    assert.deepEqual(setaDeskLoadPlanForRoute('POST', '/api/communications/send-email', {}, { ticketId: 'tkt-1' })?.refs, ['tkt-1']);
    assert.equal(setaDeskLoadPlanForRoute('POST', '/api/communications/send-email', {}, {}), null);
    assert.deepEqual(setaDeskLoadPlanForRoute('DELETE', '/api/companies/c1', {}, {})?.usageCheck, { kind: 'company', id: 'c1' });
    assert.equal(setaDeskLoadPlanForRoute('GET', '/api/companies', {}, {}), null);
    assert.equal(setaDeskLoadPlanForRoute('GET', '/api/erp/overview', {}, {}), null);
    assert.equal(setaDeskLoadPlanForRoute('PATCH', '/api/deals/d1', {}, {}), null);
  });
});

describe('E1 - lista de chamados paginada', () => {
  it('parametros: padrao, teto, offset e cursor', () => {
    assert.deepEqual(parseTicketsPageParams({}), { limit: TICKETS_PAGE_DEFAULT_LIMIT, offset: 0 });
    assert.deepEqual(parseTicketsPageParams({ limit: '99999', offset: '7' }), { limit: TICKETS_PAGE_MAX_LIMIT, offset: 7 });
    assert.deepEqual(parseTicketsPageParams({ limit: '0', offset: '-3' }), { limit: TICKETS_PAGE_DEFAULT_LIMIT, offset: 0 });
    assert.deepEqual(parseTicketsPageParams({ limit: '10', cursor: encodeTicketsCursor(30), offset: '5' }), { limit: 10, offset: 30 });
    assert.equal(decodeTicketsCursor('lixo!'), null);
  });

  it('paginateTickets devolve fatia, total e proximo cursor', () => {
    const list = Array.from({ length: 7 }, (_v, i) => i);
    const p1 = paginateTickets(list, { limit: 3, offset: 0 });
    assert.deepEqual(p1.data, [0, 1, 2]);
    assert.equal(p1.total, 7);
    assert.equal(p1.hasMore, true);
    assert.equal(p1.nextOffset, 3);
    const p3 = paginateTickets(list, { limit: 3, offset: decodeTicketsCursor(paginateTickets(list, { limit: 3, offset: 3 }).nextCursor)! });
    assert.deepEqual(p3.data, [6]);
    assert.equal(p3.hasMore, false);
    assert.equal(p3.nextCursor, null);
  });

  it('GET /api/tickets respeita limit e cursor, com total dos filtrados', async () => {
    const repo = createInMemoryRepository();
    for (let i = 0; i < 6; i++) repo.createServiceTicket({ subject: `Paginado ${i}`, key: `TEC-${700 + i}` });
    const total = repo.listServiceTickets().length;
    const router = new CrmApiRouter(repo);
    const r1 = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'GET', path: '/api/tickets', query: { limit: '4' } });
    assert.equal(r1.status, 200);
    const b1 = r1.body as any;
    assert.equal(b1.data.length, 4);
    assert.equal(b1.total, total);
    assert.equal(b1.limit, 4);
    assert.equal(b1.hasMore, true);
    assert.ok(b1.kpis);
    const seen = new Set<string>(b1.data.map((t: any) => t.id));
    let cursor: string | null = b1.nextCursor;
    while (cursor) {
      const r = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'GET', path: '/api/tickets', query: { limit: '4', cursor } });
      const b = r.body as any;
      for (const t of b.data) {
        assert.equal(seen.has(t.id), false, 'sem repeticao entre paginas');
        seen.add(t.id);
      }
      cursor = b.nextCursor;
    }
    assert.equal(seen.size, total, 'as paginas cobrem todos os chamados');
  });
});

const TEST_DB = process.env.SETADESK_TEST_DATABASE_URL;

describe('E1 - Postgres real (descartavel)', { skip: !TEST_DB }, () => {
  let store: typeof import('../src/db/setadesk-store');
  let pg: typeof import('../src/db/postgres');
  const savedUrl = process.env.DATABASE_URL;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    pg = await import('../src/db/postgres');
    store = await import('../src/db/setadesk-store');
    await pg.closePostgresPool();
    store.resetSetaDeskSchemaCache();
  });

  after(async () => {
    await pg.closePostgresPool();
    if (savedUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedUrl;
  });

  it('upsert real mantem o serviceTickets antigo e a leitura nao o traz', async () => {
    const pool = pg.getPostgresPool()!;
    await pg.ensurePostgresSchema(pool);
    const legacy = { companies: [{ id: 'c-old' }], serviceTickets: [{ id: 'tkt-legado', key: 'TEC-1' }] };
    await pool.query(`DELETE FROM crm_kv_store WHERE key = 'crm_state_v1'`);
    await pool.query(`INSERT INTO crm_kv_store (key, payload, updated_at) VALUES ('crm_state_v1', $1::jsonb, NOW())`, [JSON.stringify(legacy)]);
    resetMirrorSnapshots();
    const repo = createInMemoryRepository();
    await pg.syncStateToPostgres(repo.getState());
    const raw = await pool.query(`SELECT payload->'serviceTickets' AS st, jsonb_array_length(payload->'companies') AS n FROM crm_kv_store WHERE key = 'crm_state_v1'`);
    assert.deepEqual(raw.rows[0].st, legacy.serviceTickets, 'chave antiga intacta');
    assert.ok(Number(raw.rows[0].n) > 1, 'o resto do estado foi gravado');
    const loaded = await pg.loadStateFromPostgres();
    assert.deepEqual(loaded!.serviceTickets, []);
    const mirror = await pool.query(`SELECT COUNT(*)::int AS n FROM crm_service_tickets`);
    assert.equal(mirror.rows[0].n, 0, 'espelho nao recebeu chamados');
  });

  it('carga por chave traz so o chamado pedido; contagem nas setadesk_*', async () => {
    const base = (await store.loadSetaDeskTickets([]))!;
    const repo = createInMemoryRepository();
    repo.replaceServiceTickets(base.tickets);
    repo.createServiceTicket({ subject: 'E1 alvo', key: 'TEC-801', id: 'tkt-e1-alvo' });
    repo.createServiceTicket({ subject: 'E1 outro', key: 'TEC-802', id: 'tkt-e1-outro' });
    await store.syncSetaDeskTickets(repo.getState().serviceTickets, base.baseline);
    const one = (await store.loadSetaDeskTickets([], { keys: ['tec-801'] }))!;
    assert.deepEqual(one.tickets.map((t) => t.key), ['TEC-801']);
    const byId = (await store.loadSetaDeskTickets([], { keys: ['TKT-E1-OUTRO'] }))!;
    assert.deepEqual(byId.tickets.map((t) => t.id), ['tkt-e1-outro']);
    const none = (await store.loadSetaDeskTickets([], { keys: [] }))!;
    assert.equal(none.tickets.length, 0);
    const all = (await store.loadSetaDeskTickets([]))!;
    assert.equal(await store.countSetaDeskTickets(), all.tickets.length);
  });

  it('checagem de uso no DELETE le so os chamados com O.S. do registro', async () => {
    const base = (await store.loadSetaDeskTickets([]))!;
    const repo = createInMemoryRepository();
    repo.replaceServiceTickets(base.tickets);
    repo.createServiceTicket({ subject: 'Com OS', key: 'TEC-811', id: 'tkt-e1-os', companyId: 'cmp-e1', serviceOrderId: 'os-1' } as never);
    repo.createServiceTicket({ subject: 'Sem OS', key: 'TEC-812', id: 'tkt-e1-sem-os', companyId: 'cmp-e1' } as never);
    await store.syncSetaDeskTickets(repo.getState().serviceTickets, base.baseline);
    const refs = (await store.loadSetaDeskTicketUsageRefs('company', 'cmp-e1'))!;
    assert.deepEqual(refs.map((r) => r.serviceOrderId), ['os-1']);
    assert.deepEqual(await store.loadSetaDeskTicketUsageRefs('contact', 'ninguem'), []);
  });
});

describe('E1 - CISO: DELETE so na allowlist e portal em tempo constante', () => {
  it('DELETE publico, de auth, health e caminho desconhecido => null', async () => {
    const { setaDeskLoadPlanForRoute: plan } = await import('../src/api/setadesk-route-plan');
    for (const path of [
      '/api/portal/tickets/TEC-1',
      '/api/portal/tickets',
      '/api/portal/tickets/TEC-1/reply',
      '/api/auth/logout',
      '/api/auth/session',
      '/api/health',
      '/api/rota-que-nao-existe',
      '/api/companies',
      '/api/companies/c1/extra',
      '/api/deals/d1',
      '/api/erp/proposals/p1',
      '/api/tickets/TEC-1',
    ]) {
      assert.equal(plan('DELETE', path, {}, {}), null, path);
    }
  });

  it('allowlist: so empresa e contato, sem carga antes da rota', async () => {
    const mod = await import('../src/api/setadesk-route-plan');
    assert.deepEqual(mod.SETADESK_USAGE_CHECK_DELETE_ROUTES.map((r) => r.kind), ['company', 'contact']);
    assert.deepEqual(mod.setaDeskLoadPlanForRoute('DELETE', '/api/companies/c-1', {}, {}), {
      refs: [],
      includeComments: false,
      sync: false,
      usageCheck: { kind: 'company', id: 'c-1' },
    });
    assert.deepEqual(mod.setaDeskLoadPlanForRoute('DELETE', '/api/contacts/ct%201', {}, {})?.usageCheck, { kind: 'contact', id: 'ct 1' });
    assert.equal(mod.setaDeskLoadPlanForRoute('DELETE', '/api/contacts/%E0%A4%A', {}, {}), null);
  });

  it('rotas com piso de tempo: consulta, resposta e CSAT do portal', async () => {
    const { isPortalTicketLookupRoute: f } = await import('../src/api/setadesk-route-plan');
    assert.equal(f('GET', '/api/portal/tickets'), true);
    assert.equal(f('POST', '/api/portal/tickets/TEC-1/reply'), true);
    assert.equal(f('POST', '/api/portal/tickets/TEC-1/csat'), true);
    assert.equal(f('POST', '/api/portal/tickets'), false);
    assert.equal(f('GET', '/api/tickets'), false);
  });

  it('findPortalTicketByKeyAndEmail compara com registro ficticio quando nao ha chamado', async () => {
    const pa = await import('../src/api/portal-access');
    let calls = 0;
    const emailOf = () => {
      calls += 1;
      return 'c@x.com';
    };
    assert.equal(pa.findPortalTicketByKeyAndEmail([], emailOf, '\u0000sem-chamado', 'c@x.com'), null, 'ficticio nunca confere');
    assert.equal(calls, 1, 'sem chamado, faz a mesma comparacao que com 1 chamado');
    const repo = createInMemoryRepository();
    const t = repo.listServiceTickets()[0];
    assert.equal(pa.findPortalTicketByKeyAndEmail([t], () => 'c@x.com', t.key, 'c@x.com')?.id, t.id);
  });

  it('existe e nao existe respondem com o mesmo piso de tempo e o mesmo erro', async () => {
    const repo = createInMemoryRepository();
    const contact = repo.listContacts().find((c) => c.email)!;
    const t = repo.createServiceTicket({ subject: 'Piso', key: 'TEC-950', contactId: contact.id });
    const router = new CrmApiRouter(repo);
    router.portalLookupTimeFloorMs = 120;
    const call = async (key: string, email: string) => {
      const t0 = Date.now();
      const r = await router.dispatch({ method: 'GET', path: '/api/portal/tickets', query: { key, email, _clientIp: `10.9.${Math.floor(Math.random() * 200)}.1` } });
      return { r, ms: Date.now() - t0 };
    };
    const ok = await call(t.key, contact.email);
    const wrongEmail = await call(t.key, 'outra@pessoa.com');
    const missing = await call('TEC-999999', contact.email);
    assert.equal(ok.r.status, 200);
    assert.equal(wrongEmail.r.status, 404);
    assert.equal(missing.r.status, 404);
    assert.deepEqual(wrongEmail.r.body, missing.r.body, 'erro generico identico');
    for (const x of [ok, wrongEmail, missing]) assert.ok(x.ms >= 115, `piso respeitado (${x.ms} ms)`);
  });
});
