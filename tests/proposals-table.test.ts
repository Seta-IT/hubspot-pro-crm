// ============================================================================
// Tabela propria de orcamentos (erp_proposals) — 04/11/2026
//  - colunas de busca/filtro/numeracao derivadas da proposta
//  - diff por linha (insert/update/delete) com controle otimista (row_version)
//  - JSON crm_state_v1 nunca volta a ter propostas depois do modo tabela (guarda no upsert)
//  - importacao: copia as existentes intactas, insere as do GC com vinculos por id GC,
//    4695 recebe o GC como nova versao, 4704 e a duplicata GC-ORC-4695 intocadas
//  - repositorio: hidratacao parcial nao renomeia GC-ORC-N; numeracao pela tabela
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyProposalDiff,
  diffHydratedProposals,
  hashProposal,
  isProposalsTableState,
  PROPOSAL_ROW_COLUMNS,
  proposalRowValues,
  ProposalWriteConflictError,
  PROPOSALS_TABLE_DDL,
  KV_PROPOSALS_GUARD_TRIGGER_DDL,
  insertGcProposalsIfAbsent,
} from '../src/db/proposal-store';
import { KV_STATE_UPSERT_SQL, stateForKvTableMode, syncStateToPostgres } from '../src/db/postgres';
import { createInMemoryRepository } from '../src/db/repository';
import { planImport, overwriteWithGc } from '../scripts/proposals-table/import-proposals';

const col = (vals: unknown[], name: (typeof PROPOSAL_ROW_COLUMNS)[number]) => vals[PROPOSAL_ROW_COLUMNS.indexOf(name)];

const baseProp = (over: Record<string, unknown> = {}) =>
  ({
    id: 'prop-x',
    code: '4705',
    title: 'Orçamento #4705 — ARKLOK',
    companyName: 'ARKLOK - Equipamentos',
    companyCnpj: '12.345.678/0001-90',
    sellerName: 'Marcelo',
    sellerEmail: 'marcelo@seta',
    status: 'ENVIADA',
    budgetType: 'PRODUTOS',
    items: [],
    monthlyRecurringTotal: 100,
    oneTimeSetupTotal: 0,
    shippingCost: 5,
    createdAt: '2026-11-04T10:00:00.000Z',
    updatedAt: '2026-11-04T11:00:00.000Z',
    version: 1,
    versionHistory: [{ version: 1 }],
    ...over,
  }) as any;

class FakeDb {
  calls: Array<{ text: string; params?: unknown[] }> = [];
  constructor(private responder: (text: string, params?: unknown[]) => { rows: any[] }) {}
  async query(text: string, params?: unknown[]) {
    this.calls.push({ text, params });
    return this.responder(text, params);
  }
}

describe('erp_proposals: colunas derivadas', () => {
  it('migracao idempotente com indices de codigo unico e busca', () => {
    assert.match(PROPOSALS_TABLE_DDL, /CREATE TABLE IF NOT EXISTS erp_proposals/);
    assert.match(PROPOSALS_TABLE_DDL, /CREATE UNIQUE INDEX IF NOT EXISTS ux_erp_proposals_code_lower ON erp_proposals \(lower\(code\)\)/);
    assert.match(PROPOSALS_TABLE_DDL, /row_version INTEGER NOT NULL DEFAULT 1/);
  });

  it('code_num, gc_id, tipo, busca normalizada e total da lista', () => {
    const v = proposalRowValues(baseProp({ id: 'prop-gc-408248511', code: 'GC-ORC-4695', companyName: 'Construção Ágil' }));
    assert.equal(col(v, 'code_num'), 4695);
    assert.equal(col(v, 'gc_id'), '408248511');
    assert.equal(col(v, 'is_products'), true);
    assert.equal(col(v, 'is_rental'), false);
    assert.match(String(col(v, 'search_text')), /construcao agil/);
    assert.match(String(col(v, 'search_digits')), /12345678000190/);
    assert.equal(col(v, 'total'), 105);
    const loc = proposalRowValues(baseProp({ budgetType: undefined, items: [{ fiscalNature: 'LOCACAO_BENS_MOVEIS' }], convertedContractId: 'ctr-1' }));
    assert.equal(col(loc, 'is_rental'), true);
    assert.equal(col(loc, 'is_converted'), true);
  });
});

describe('erp_proposals: diff e controle otimista', () => {
  it('detecta insert, update (hash mudou) e delete das hidratadas', () => {
    const a = baseProp({ id: 'a' });
    const b = baseProp({ id: 'b' });
    const hydrated = new Map([
      ['a', { hash: hashProposal(a), rowVersion: 3 }],
      ['b', { hash: hashProposal(b), rowVersion: 1 }],
    ]);
    const a2 = { ...a, title: 'novo' };
    const c = baseProp({ id: 'c', code: '4708' });
    const d = diffHydratedProposals(hydrated, [a2, c]);
    assert.deepEqual(d.inserts.map((p) => p.id), ['c']);
    assert.deepEqual(d.updates.map((u) => [u.proposal.id, u.expectedRowVersion]), [['a', 3]]);
    assert.deepEqual(d.deletes, [{ id: 'b', expectedRowVersion: 1 }]);
    assert.equal(diffHydratedProposals(hydrated, [a, b]).updates.length, 0);
  });

  it('update com row_version antiga => ProposalWriteConflictError (nada gravado alem disso)', async () => {
    const db = new FakeDb((t) => ({ rows: /^UPDATE/.test(t) ? [] : [] }));
    await assert.rejects(
      applyProposalDiff(db, { inserts: [], updates: [{ proposal: baseProp(), expectedRowVersion: 2 }], deletes: [] }),
      ProposalWriteConflictError
    );
    assert.match(db.calls[0].text, /WHERE id = \$1 AND row_version = \$\d+/);
    assert.equal(db.calls[0].params?.at(-1), 2);
  });

  it('insert nunca sobrescreve (ON CONFLICT DO NOTHING); estrito => conflito', async () => {
    const db = new FakeDb(() => ({ rows: [] }));
    const r = await applyProposalDiff(db, { inserts: [baseProp()], updates: [], deletes: [] });
    assert.deepEqual(r.skippedInserts, ['prop-x']);
    assert.match(db.calls[0].text, /ON CONFLICT DO NOTHING RETURNING id/);
    await assert.rejects(applyProposalDiff(db, { inserts: [baseProp()], updates: [], deletes: [] }, { strictInserts: true }), ProposalWriteConflictError);
  });
});

describe('crm_state_v1 no modo tabela', () => {
  it('upsert do JSON preserva o modo tabela e esvazia propostas vindas de estado antigo', () => {
    assert.match(KV_STATE_UPSERT_SQL, /crm_kv_store\.payload->'erp'->>'proposalsStorage' = 'table'/);
    assert.match(KV_STATE_UPSERT_SQL, /jsonb_set\(jsonb_set\(EXCLUDED\.payload, '\{erp,proposals\}', '\[\]'::jsonb\)/);
    const st = stateForKvTableMode({ erp: { proposals: [baseProp()], catalog: [] } } as any) as any;
    assert.deepEqual(st.erp.proposals, []);
    assert.equal(isProposalsTableState(st), true);
    assert.equal(isProposalsTableState({ erp: { proposals: [] } }), false);
  });

  it('syncStateToPostgres: diff das propostas e JSON na MESMA transacao; conflito => ROLLBACK', async () => {
    const seen: string[] = [];
    const client = {
      query: async (t: string) => {
        seen.push(t.trim().split(/\s+/)[0]);
        if (/^UPDATE erp_proposals/.test(t.trim())) return { rows: [] };
        return { rows: [] };
      },
      release: () => undefined,
    };
    const pool = { query: client.query, connect: async () => client };
    await assert.rejects(
      syncStateToPostgres({ erp: { proposals: [] } } as any, {
        pool,
        proposals: { diff: { inserts: [], updates: [{ proposal: baseProp(), expectedRowVersion: 1 }], deletes: [] } },
      }),
      ProposalWriteConflictError
    );
    assert.ok(seen.includes('BEGIN') && seen.includes('ROLLBACK') && !seen.includes('COMMIT'));
    const bi = seen.indexOf('BEGIN');
    assert.ok(seen.indexOf('UPDATE') > bi);
  });

  it('modo JSON (sem diff): o estado vai inteiro como antes, com propostas', async () => {
    let kvParams: unknown[] | undefined;
    const client = {
      query: async (t: string, p?: unknown[]) => {
        if (/INSERT INTO crm_kv_store/.test(t)) kvParams = p;
        if (/^SELECT id, row_hash/.test(t.trim())) return { rows: [] };
        return { rows: [] };
      },
      release: () => undefined,
    };
    await syncStateToPostgres({ erp: { proposals: [baseProp()] }, companies: [] } as any, { pool: { query: client.query, connect: async () => client } });
    assert.equal(JSON.parse(String(kvParams?.[1])).erp.proposals.length, 1);
  });
});

describe('importacao para a tabela (planImport)', () => {
  const gcOrc = (over: Record<string, unknown>) => ({
    id: '1',
    codigo: '1',
    cliente_id: '555',
    nome_cliente: 'Cliente GC',
    nome_situacao: 'Em aberto',
    data: '2026-10-01',
    valor_total: '100.00',
    produtos: [{ produto: { produto_id: '777', nome_produto: 'Switch X', quantidade: '1', valor_venda: '100', valor_total: '100' } }],
    servicos: [],
    ...over,
  });
  const state = {
    companies: [{ id: 'comp-gc-555', name: 'Cliente GC', cnpj: '11.111.111/0001-11' }],
    erp: {
      catalog: [{ id: 'cat-gc-prod-777', gestaoClickId: '777', gestaoClickCode: 'SW-X', name: 'Switch X' }],
      proposals: [
        baseProp({ id: 'prop-gc-4695', code: '4695', version: 5, versionHistory: [1, 2, 3, 4, 5].map((v) => ({ version: v })), statusHistory: [{ id: 's1' }], sellerEmail: 'dono@seta' }),
        baseProp({ id: 'prop-gc-408248511', code: 'GC-ORC-4695' }),
        baseProp({ id: 'prop-1793323714919', code: '4704' }),
      ],
    },
  };
  const gc = [
    gcOrc({ id: '408248511', codigo: '4695' }),
    gcOrc({ id: '900', codigo: '4600' }),
    gcOrc({ id: '901', codigo: '4601', cliente_id: '999', produtos: [{ produto: { produto_id: '', nome_produto: 'Item avulso', quantidade: '1', valor_venda: '5', valor_total: '5' } }] }),
  ];

  it('copia as existentes, insere as novas com vinculos e reporta as puladas', () => {
    const plan = planImport(state, gc, '2026-11-04T20:00:00.000Z');
    assert.equal(plan.copied.length, 3);
    assert.deepEqual(plan.gcInserts.map((p) => p.id), ['prop-gc-900', 'prop-gc-901']);
    const p900 = plan.gcInserts[0];
    assert.equal(p900.companyId, 'comp-gc-555');
    assert.equal(p900.items[0].catalogItemId, 'cat-gc-prod-777');
    assert.equal(p900.items[0].sku, 'SW-X');
    assert.deepEqual(plan.noCompany, ['4601']);
    assert.equal(plan.itemsLinked, 1);
    assert.deepEqual(plan.skipped.map((s) => s.stiCode), ['GC-ORC-4695']);
  });

  it('4695 recebe o GC como nova versao; id, codigo, dono e historico preservados', () => {
    const plan = planImport(state, gc, '2026-11-04T20:00:00.000Z');
    assert.equal(plan.overwrites.length, 1);
    const o = plan.overwrites[0];
    assert.equal(o.id, 'prop-gc-4695');
    assert.equal(o.code, '4695');
    assert.equal(o.version, 6);
    assert.equal(o.sellerEmail, 'dono@seta');
    assert.equal(o.versionHistory.length, 6);
    assert.equal(o.versionHistory[5].version, 6);
    assert.equal(o.companyId, 'comp-gc-555');
    const again = overwriteWithGc(o, plan.gcInserts[0], 'x');
    assert.equal(again.version, 7);
  });

  it('4704 e a duplicata nunca entram como overwrite', () => {
    const plan = planImport(state, gc, 'x');
    const touched = new Set(plan.overwrites.map((p) => p.id));
    assert.ok(!touched.has('prop-1793323714919') && !touched.has('prop-gc-408248511'));
  });
});

describe('repositorio no modo tabela', () => {
  it('hidratacao parcial nao renomeia GC-ORC-4695 e numeracao segue a tabela', () => {
    const repo = createInMemoryRepository();
    const st = repo.getState() as any;
    st.erp.proposalsStorage = 'table';
    st.erp.proposals = [];
    repo.loadState(st);
    repo.hydrateStoredProposals([baseProp({ id: 'prop-gc-408248511', code: 'GC-ORC-4695' })]);
    assert.equal(repo.listProposals()[0].code, 'GC-ORC-4695');
    repo.setProposalNumberingHint({ maxCodeNumber: 4707, occupiedRefs: ['4708'] });
    const created = repo.createProposal({ title: 'Nova' });
    assert.equal(created.code, '4709');
    assert.equal(repo.listProposals()[0].code === 'GC-ORC-4695' || repo.listProposals()[1].code === 'GC-ORC-4695', true);
  });
});

describe('incidente 04/11: guarda sempre que o marcador existir', () => {
  it('upsert zera propostas se o salvo OU o que chega estiver em modo tabela', () => {
    assert.match(KV_STATE_UPSERT_SQL, /crm_kv_store\.payload->'erp'->>'proposalsStorage' = 'table'\s+OR EXCLUDED\.payload->'erp'->>'proposalsStorage' = 'table'/);
    assert.doesNotMatch(KV_STATE_UPSERT_SQL, /<> 'table'/);
  });

  it('trigger no banco e idempotente e cobre INSERT/UPDATE de qualquer escritor', () => {
    assert.match(KV_PROPOSALS_GUARD_TRIGGER_DDL, /IF NOT EXISTS \(SELECT 1 FROM pg_proc WHERE proname = 'crm_kv_proposals_table_guard_v1'\)/);
    assert.match(KV_PROPOSALS_GUARD_TRIGGER_DDL, /IF NOT EXISTS \(SELECT 1 FROM pg_trigger WHERE tgname = 'trg_crm_kv_proposals_table_guard'/);
    assert.match(KV_PROPOSALS_GUARD_TRIGGER_DDL, /BEFORE INSERT OR UPDATE ON crm_kv_store/);
    assert.match(KV_PROPOSALS_GUARD_TRIGGER_DDL, /OLD\.payload->'erp'->>'proposalsStorage' = 'table'/);
    assert.doesNotMatch(KV_PROPOSALS_GUARD_TRIGGER_DDL, /DROP TRIGGER|CREATE OR REPLACE/);
  });

  it('sync do GC no modo tabela: so insere os novos (por id e por id GC), nunca sobrescreve', async () => {
    const db = new FakeDb((t) => {
      if (/^SELECT lower\(id\)/.test(t.trim())) return { rows: [{ id: 'prop-gc-408248511', gc_id: '408248511' }, { id: 'prop-outro', gc_id: '409999999' }] };
      if (/^INSERT/.test(t.trim())) return { rows: [{ id: 'prop-gc-410000001' }] };
      return { rows: [] };
    });
    const n = await insertGcProposalsIfAbsent(db, [
      baseProp({ id: 'prop-gc-408248511', code: '4695' }),
      baseProp({ id: 'prop-gc-409999999', code: '4699' }),
      baseProp({ id: 'prop-gc-410000001', code: '4710' }),
    ]);
    assert.equal(n, 1);
    const ins = db.calls.find((c) => /^INSERT/.test(c.text.trim()))!;
    assert.match(ins.text, /ON CONFLICT DO NOTHING/);
    assert.equal(ins.params?.[0], 'prop-gc-410000001');
    assert.equal(db.calls.filter((c) => /^UPDATE/.test(c.text.trim())).length, 0);
  });

});
