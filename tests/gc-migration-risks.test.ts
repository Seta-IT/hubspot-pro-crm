// ============================================================================
// Riscos da migração GestãoClick -> STI-hub
//  1) espelho crm_companies (e demais) grava só linhas novas/alteradas
//  2) syncLiveGestaoClick faz upsert por id GC, sem reduzir fornecedores/
//     transportadoras, sem mesclar CNPJs diferentes (Trava Fiscal)
// ============================================================================

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  MIRROR_UPSERT_BATCH,
  PgPoolLike,
  primeMirrorSnapshots,
  resetMirrorSnapshots,
  syncStateToPostgres,
} from '../src/db/postgres';
import { mergeGcCatalog, mergeGcCompanies, mergeGcSuppliers, GcIncomingCompany } from '../src/modules/erp/gestaoclick-merge';
import { Company, CrmDatabaseState, ErpCatalogItem, ErpSupplierRecord } from '../src/db/types';

// ---------------------------------------------------------------- fake pg
interface Logged { text: string; params?: unknown[] }
function createFakePool() {
  const tables = new Map<string, Map<string, { row_hash: string | null; values: unknown[] }>>();
  const log: Logged[] = [];
  const tbl = (n: string) => {
    if (!tables.has(n)) tables.set(n, new Map());
    return tables.get(n)!;
  };
  const query = async (text: string, params?: unknown[]) => {
    log.push({ text, params });
    const t = text.trim();
    let m = t.match(/^SELECT id, row_hash FROM (\w+)$/);
    if (m) return { rows: [...tbl(m[1]).entries()].map(([id, r]) => ({ id, row_hash: r.row_hash })) };
    m = t.match(/^INSERT INTO (crm_\w+) \(([^)]+)\) VALUES ([\s\S]+) ON CONFLICT \(id\) DO UPDATE/);
    if (m && m[1] !== 'crm_kv_store') {
      const cols = m[2].split(',').map((c) => c.trim());
      const n = cols.length;
      const p = params || [];
      for (let i = 0; i < p.length; i += n) {
        const vals = p.slice(i, i + n);
        tbl(m[1]).set(String(vals[0]), { row_hash: String(vals[n - 1]), values: vals });
      }
      return { rows: [], rowCount: p.length / n };
    }
    m = t.match(/^DELETE FROM (\w+) WHERE id = ANY/);
    if (m) {
      for (const id of (params?.[0] as string[]) || []) tbl(m[1]).delete(String(id));
      return { rows: [] };
    }
    if (/^DELETE FROM \w+\s*$/.test(t)) throw new Error('DELETE em massa não deveria acontecer: ' + t);
    return { rows: [] };
  };
  const pool: PgPoolLike = { query, connect: async () => ({ query, release: () => {} }) };
  return { pool, log, tables, tbl };
}

const mkCompany = (i: number, extra?: Partial<Company>): Company =>
  ({
    id: `comp-${i}`,
    name: `Empresa ${i}`,
    domain: null,
    cnpj: null,
    industry: 'X',
    completenessScore: 50,
    customProperties: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  }) as unknown as Company;

const mkState = (companies: Company[]): CrmDatabaseState =>
  ({
    companies,
    contacts: [],
    pipelines: [],
    deals: [],
    timelineEvents: [],
    workflows: [],
    sequences: [],
    dataHealthIssues: [],
    webForms: [],
    serviceTickets: [],
  }) as unknown as CrmDatabaseState;

const companyInserts = (log: Logged[]) => log.filter((q) => /^\s*INSERT INTO crm_companies /.test(q.text));
const rowsIn = (q: Logged) => (q.params?.length || 0) / 9; // 8 colunas + row_hash

describe('Persistência incremental do espelho crm_companies', () => {
  beforeEach(() => resetMirrorSnapshots());

  it('primeira gravação: upsert multi-linha em lotes (sem 1 INSERT por linha, sem DELETE em massa)', async () => {
    const { pool, log, tbl } = createFakePool();
    const companies = Array.from({ length: 1200 }, (_, i) => mkCompany(i));
    await syncStateToPostgres(mkState(companies), { pool });
    const ins = companyInserts(log);
    assert.equal(ins.length, Math.ceil(1200 / MIRROR_UPSERT_BATCH));
    assert.equal(ins.reduce((a, q) => a + rowsIn(q), 0), 1200);
    assert.ok(ins.every((q) => /ON CONFLICT \(id\) DO UPDATE/.test(q.text)));
    assert.equal(tbl('crm_companies').size, 1200);
    assert.ok(!log.some((q) => /^\s*DELETE FROM crm_companies\s*$/.test(q.text)));
  });

  it('save seguinte grava só as linhas alteradas/novas', async () => {
    const { pool, log, tbl } = createFakePool();
    const companies = Array.from({ length: 1200 }, (_, i) => mkCompany(i));
    const state = mkState(companies);
    await syncStateToPostgres(state, { pool });
    log.length = 0;

    // nada mudou => zero INSERT em crm_companies
    let stats = await syncStateToPostgres(state, { pool });
    assert.equal(companyInserts(log).length, 0);
    assert.equal(stats.find((s) => s.table === 'crm_companies')?.unchanged, 1200);

    // altera 2 e cria 1 => 1 INSERT com 3 linhas
    log.length = 0;
    companies[5] = { ...companies[5], name: 'Empresa 5 editada' };
    companies[900] = { ...companies[900], cnpj: '11.222.333/0001-81' };
    companies.push(mkCompany(5000));
    stats = await syncStateToPostgres(state, { pool });
    const ins = companyInserts(log);
    assert.equal(ins.length, 1);
    assert.equal(rowsIn(ins[0]), 3);
    const ids = (ins[0].params || []).filter((_, i) => i % 9 === 0);
    assert.deepEqual(ids.sort(), ['comp-5', 'comp-5000', 'comp-900']);
    assert.equal(tbl('crm_companies').size, 1201);
    assert.equal(stats.find((s) => s.table === 'crm_companies')?.upserted, 3);
  });

  it('apaga só as linhas removidas explicitamente pelo app', async () => {
    const { pool, log, tbl } = createFakePool();
    const companies = Array.from({ length: 50 }, (_, i) => mkCompany(i));
    const state = mkState(companies);
    await syncStateToPostgres(state, { pool });
    // linha que existe só no banco (ex.: gravada por outro processo) não é apagada
    tbl('crm_companies').set('comp-externa', { row_hash: 'x', values: [] });
    log.length = 0;
    state.companies = companies.filter((c) => c.id !== 'comp-7');
    await syncStateToPostgres(state, { pool });
    const dels = log.filter((q) => /^DELETE FROM crm_companies WHERE id = ANY/.test(q.text));
    assert.equal(dels.length, 1);
    assert.deepEqual(dels[0].params?.[0], ['comp-7']);
    assert.ok(tbl('crm_companies').has('comp-externa'));
    assert.ok(!tbl('crm_companies').has('comp-7'));
    assert.equal(companyInserts(log).length, 0);
  });

  it('sem snapshot não apaga; lista vazia com snapshot grande não apaga em massa', async () => {
    const { pool, log, tbl } = createFakePool();
    const state = mkState(Array.from({ length: 30 }, (_, i) => mkCompany(i)));
    await syncStateToPostgres(state, { pool });
    resetMirrorSnapshots();
    log.length = 0;
    await syncStateToPostgres(mkState(state.companies.slice(0, 10)), { pool });
    assert.equal(tbl('crm_companies').size, 30);

    primeMirrorSnapshots(state);
    await syncStateToPostgres(mkState([]), { pool });
    assert.equal(tbl('crm_companies').size, 30);
    assert.ok(!log.some((q) => /^DELETE FROM crm_companies/.test(q.text)));
  });
});

// ---------------------------------------------------------------- sync GC
const sup = (o: Partial<ErpSupplierRecord>): ErpSupplierRecord =>
  ({ id: '', name: '', legalName: '', cnpj: '—', phone: '—', email: '—', active: true, ...o }) as ErpSupplierRecord;

describe('syncLiveGestaoClick: upsert não destrutivo', () => {
  it('fornecedores: não reduz a lista, preserva transportadoras e faz upsert por id GC', () => {
    const existing: ErpSupplierRecord[] = [
      ...Array.from({ length: 84 }, (_, i) =>
        sup({ id: `forn-gc-${1000 + i}`, gestaoClickId: String(1000 + i), name: `Forn ${i}`, cnpj: '—', supplierType: 'FORNECEDOR' })
      ),
      ...Array.from({ length: 49 }, (_, i) => sup({ id: `transp-gc-${1000 + i}`, gestaoClickId: String(1000 + i), name: `Transp ${i}`, supplierType: 'TRANSPORTADORA' })),
      sup({ id: 'forn-manual-1', name: 'Fornecedor criado no STI-hub', supplierType: 'FORNECEDOR' }),
    ];
    const before = existing.length;
    const transpBefore = JSON.stringify(existing.filter((s) => s.supplierType === 'TRANSPORTADORA'));
    // 15 primeiros do GC (formato do sync ao vivo: id cru)
    const incoming = Array.from({ length: 15 }, (_, i) =>
      sup({ id: String(1000 + i), gestaoClickId: String(1000 + i), name: `GC Forn ${i}`, email: `f${i}@x.com.br`, supplierType: 'FORNECEDOR' })
    );
    incoming.push(sup({ id: '7777', gestaoClickId: '7777', name: 'Novo GC', cnpj: '11.222.333/0001-81' }));
    const stats = mergeGcSuppliers(existing, incoming);
    assert.equal(existing.length, before + 1, 'só o fornecedor novo entra; nada sai');
    assert.equal(stats.inserted, 1);
    assert.equal(stats.updated, 15);
    assert.equal(JSON.stringify(existing.filter((s) => s.supplierType === 'TRANSPORTADORA')), transpBefore);
    const f0 = existing.find((s) => s.id === 'forn-gc-1000')!;
    assert.equal(f0.name, 'Forn 0', 'nome já preenchido não é sobrescrito');
    assert.equal(f0.email, 'f0@x.com.br', 'campo vazio é preenchido');
    assert.ok(existing.some((s) => s.id === 'forn-gc-7777' && s.gestaoClickId === '7777'));
    assert.ok(existing.some((s) => s.id === 'forn-manual-1'));
    // idempotente
    const again = mergeGcSuppliers(existing, incoming);
    assert.equal(again.inserted, 0);
    assert.equal(existing.length, before + 1);
  });

  it('fornecedores: casa id legado (id cru do GC) e fallback por CNPJ; Trava Fiscal bloqueia CNPJ diferente', () => {
    const existing: ErpSupplierRecord[] = [
      sup({ id: '55', name: 'Legado', cnpj: '11.222.333/0001-81' }),
      sup({ id: 'forn-x', name: 'Por documento', cnpj: '45.997.418/0001-53' }),
    ];
    const stats = mergeGcSuppliers(existing, [
      sup({ id: '55', gestaoClickId: '55', name: 'Outro', cnpj: '99.888.777/0001-00' }),
      sup({ id: '66', gestaoClickId: '66', name: 'Por documento GC', cnpj: '45997418000153', phone: '11 9999-0000' }),
    ]);
    assert.equal(existing.length, 2);
    assert.equal(stats.conflicts.length, 1);
    assert.equal(stats.conflicts[0].reason, 'MESMO_ID_GC_DOCUMENTO_DIFERENTE');
    assert.equal(existing[0].cnpj, '11.222.333/0001-81');
    assert.equal(existing[1].gestaoClickId, '66');
    assert.equal(existing[1].phone, '11 9999-0000');
  });

  it('clientes: casa por id GC/CNPJ e nunca mescla mesmo nome com CNPJ diferente', () => {
    const companies: Company[] = [
      mkCompany(1, { id: 'comp-gc-10', name: 'A TELECOM', cnpj: '11.222.333/0001-81', customProperties: { gestaoClickClientId: '10' } } as Partial<Company>),
      mkCompany(2, { id: 'comp-manual', name: 'Cliente Manual', cnpj: '45.997.418/0001-53' }),
    ];
    const build = (gc: GcIncomingCompany) => mkCompany(0, { id: gc.id || `comp-gc-${gc.gestaoClickClientId}`, name: gc.name, cnpj: gc.cnpj || null, customProperties: { gestaoClickClientId: gc.gestaoClickClientId } } as Partial<Company>);
    const { stats } = mergeGcCompanies(
      companies,
      [
        { id: 'comp-gc-10', gestaoClickClientId: '10', name: 'A TELECOM', cnpj: '11.222.333/0001-81' },
        { id: 'comp-gc-11', gestaoClickClientId: '11', name: 'A TELECOM', cnpj: '11.222.333/0002-62' }, // filial
        { id: 'comp-gc-12', gestaoClickClientId: '12', name: 'Nome diferente', cnpj: '45997418000153' },
      ],
      build
    );
    assert.equal(stats.inserted, 1);
    assert.equal(companies.length, 3);
    assert.ok(companies.some((c) => c.id === 'comp-gc-11'), 'filial com CNPJ diferente vira registro separado');
    assert.ok(!companies.some((c) => c.id === 'comp-gc-12'), 'mesmo CNPJ casa com o cadastro existente');
  });

  it('catálogo: só insere; não duplica item migrado nem item com mesmo código', () => {
    const catalog = [
      { id: 'cat-gc-prod-1', gestaoClickId: '1', gestaoClickCode: 'P1', name: 'P1', category: 'EQUIPAMENTO_LOCACAO' },
      { id: 'cat-manual', gestaoClickCode: 'SKU-9', name: 'Manual', category: 'EQUIPAMENTO_LOCACAO' },
      { id: 'cat-gc-srv-1', gestaoClickId: '1', gestaoClickCode: 'S1', name: 'S1', category: 'SERVICO_TECNICO_LC116' },
    ] as unknown as ErpCatalogItem[];
    const stats = mergeGcCatalog(catalog, [
      { id: 'cat-gc-prod-1', gestaoClickCode: 'P1', name: 'x', category: 'EQUIPAMENTO_LOCACAO' },
      { id: 'cat-gc-prod-9', gestaoClickCode: 'SKU-9', name: 'x', category: 'EQUIPAMENTO_LOCACAO' },
      { id: 'cat-gc-prod-2', gestaoClickCode: 'P2', name: 'P2', category: 'EQUIPAMENTO_LOCACAO' },
    ] as unknown as ErpCatalogItem[]);
    assert.equal(stats.inserted, 1);
    assert.equal(catalog.length, 4);
    assert.equal(catalog[3].gestaoClickId, '2');
  });

  it('repository.syncLiveGestaoClick não substitui mais erp.suppliers', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/db/repository.ts'), 'utf8');
    assert.ok(!/erp\.suppliers\s*=\s*snapshot\.mappedSuppliers/.test(src));
    assert.match(src, /mergeGcSuppliers\(erp\.suppliers, snapshot\.mappedSuppliers\)/);
    assert.match(src, /mergeGcCompanies\(this\.state\.companies, snapshot\.mappedCompanies/);
    assert.match(src, /mergeGcCatalog\(erp\.catalog, snapshot\.mappedCatalog\)/);
  });
});
