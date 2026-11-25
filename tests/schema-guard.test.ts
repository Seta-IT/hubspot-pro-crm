// ============================================================================
// Perf 25/11/2026 — DDL idempotente fora do caminho de bloqueio (src/db/schema-guard.ts).
// Incidente: CREATE UNIQUE INDEX IF NOT EXISTS em erp_proposals (indice ja existente) esperou ate
// 299 s atras de uma transacao aberta e segurou login/sessao/bootstrap depois do deploy.
// Integracao opcional com Postgres real descartavel: SCHEMA_GUARD_TEST_PG_URL.
// ============================================================================
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDdl, pendingDdl, planDdl, runGuardedDdl, splitSqlStatements } from '../src/db/schema-guard';
import { fullSchemaDdl, ensurePostgresSchema, resetPostgresSchemaBackoff } from '../src/db/postgres';

class CatalogFake {
  calls: Array<{ text: string; params?: unknown[] }> = [];
  constructor(private missing: string[] = [], private failDdl: Error | null = null) {}
  async query(text: string, params?: unknown[]) {
    this.calls.push({ text, params });
    if (params && /to_regclass/.test(text)) return { rows: this.missing.map((m) => ({ missing: m })) };
    if (this.failDdl) throw this.failDdl;
    return { rows: [] };
  }
  ddlBatches() {
    return this.calls.filter((c) => !c.params);
  }
}

describe('schema-guard: divisao e classificacao', () => {
  it('divide respeitando $tag$, aspas e comentarios', () => {
    const sql = `CREATE TABLE IF NOT EXISTS a (x TEXT DEFAULT ';'); -- c;omentario
DO $do$ BEGIN PERFORM 1; END $do$;
CREATE INDEX IF NOT EXISTS ix_a ON a (x);`;
    const parts = splitSqlStatements(sql);
    assert.equal(parts.length, 3);
    assert.match(parts[1], /^-- c;omentario\nDO \$do\$ BEGIN PERFORM 1; END \$do\$$/);
  });

  it('classifica tabela, indice (unique/parcial), ADD COLUMN IF NOT EXISTS e o resto', () => {
    assert.deepEqual(classifyDdl('CREATE TABLE IF NOT EXISTS crm_kv_store (key TEXT)'), { kind: 'relation', name: 'crm_kv_store' });
    assert.deepEqual(
      classifyDdl("CREATE UNIQUE INDEX IF NOT EXISTS ux_erp_proposals_code_lower ON erp_proposals (lower(code)) WHERE code <> ''"),
      { kind: 'relation', name: 'ux_erp_proposals_code_lower' }
    );
    assert.deepEqual(classifyDdl('ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS row_hash TEXT'), {
      kind: 'columns',
      table: 'crm_companies',
      columns: ['row_hash'],
    });
    assert.deepEqual(
      classifyDdl("ALTER TABLE t\n  ADD COLUMN IF NOT EXISTS a TEXT,\n  ADD COLUMN IF NOT EXISTS b NUMERIC(16,2) NOT NULL DEFAULT 0"),
      { kind: 'columns', table: 't', columns: ['a', 'b'] }
    );
    // Qualquer outra acao no mesmo ALTER => nao conferivel => sempre executa (com lock_timeout).
    assert.deepEqual(classifyDdl('ALTER TABLE t ADD COLUMN IF NOT EXISTS a TEXT, ALTER COLUMN b SET NOT NULL'), { kind: 'other' });
    assert.deepEqual(classifyDdl('CREATE INDEX ix ON t (a)'), { kind: 'other' });
    assert.deepEqual(classifyDdl('DO $$ BEGIN END $$'), { kind: 'other' });
  });

  it('o DDL completo do ensurePostgresSchema so tem comandos conferiveis, exceto o bloco DO da trava do KV', () => {
    const others = planDdl(fullSchemaDdl()).filter((p) => p.check.kind === 'other');
    assert.equal(others.length, 1);
    assert.match(others[0].sql, /crm_kv_proposals_table_guard_v1/);
    // Inclui o indice do incidente.
    assert.ok(planDdl(fullSchemaDdl()).some((p) => p.check.kind === 'relation' && p.check.name === 'ux_erp_proposals_code_lower'));
  });
});

describe('schema-guard: so executa o que falta', () => {
  it('catalogo completo => nenhum CREATE INDEX/ALTER TABLE e emitido', async () => {
    const db = new CatalogFake([]);
    const r = await runGuardedDdl(db, 'CREATE TABLE IF NOT EXISTS a (x TEXT); CREATE UNIQUE INDEX IF NOT EXISTS ix ON a (x); ALTER TABLE a ADD COLUMN IF NOT EXISTS y TEXT;');
    assert.equal(r.executed, 0);
    assert.equal(db.ddlBatches().length, 0);
  });

  it('falta um indice => executa SO ele, com lock_timeout e statement_timeout locais', async () => {
    const db = new CatalogFake(['r:ix']);
    const r = await runGuardedDdl(db, 'CREATE TABLE IF NOT EXISTS a (x TEXT); CREATE INDEX IF NOT EXISTS ix ON a (x);');
    assert.equal(r.executed, 1);
    const [batch] = db.ddlBatches();
    assert.match(batch.text, /set_config\('lock_timeout', '2000ms', true\)/);
    assert.match(batch.text, /set_config\('statement_timeout', '30000ms', true\)/);
    assert.match(batch.text, /CREATE INDEX IF NOT EXISTS ix ON a/);
    assert.doesNotMatch(batch.text, /CREATE TABLE/);
  });

  it('falta uma coluna => executa o ALTER daquela tabela', async () => {
    const db = new CatalogFake(['c:a.y']);
    const { pending } = await pendingDdl(db, planDdl('ALTER TABLE a ADD COLUMN IF NOT EXISTS y TEXT; ALTER TABLE b ADD COLUMN IF NOT EXISTS y TEXT;'));
    assert.equal(pending.length, 1);
    assert.match(pending[0].sql, /ALTER TABLE a/);
  });

  it('ensurePostgresSchema (requisicao): falha do DDL so loga, nao lanca, e espera o backoff', async () => {
    resetPostgresSchemaBackoff();
    const err = Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' });
    const db = new CatalogFake(['r:ux_erp_proposals_code_lower'], err);
    const origError = console.error;
    const logs: string[] = [];
    console.error = (...a: unknown[]) => void logs.push(a.join(' '));
    try {
      await ensurePostgresSchema(db as any);
      const n = db.calls.length;
      await ensurePostgresSchema(db as any); // dentro do backoff: nem consulta o catalogo
      assert.equal(db.calls.length, n);
    } finally {
      console.error = origError;
    }
    assert.ok(logs.some((l) => /55P03/.test(l)));
    // CLI (force) continua lancando.
    await assert.rejects(() => ensurePostgresSchema(db as any, { force: true }), /lock timeout/);
    resetPostgresSchemaBackoff();
  });
});

const PG_URL = process.env.SCHEMA_GUARD_TEST_PG_URL || '';
describe('schema-guard: Postgres real (trava aberta na tabela)', { skip: !PG_URL }, () => {
  let pool: any;
  before(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: PG_URL, max: 4 });
    await pool.query('DROP TABLE IF EXISTS sg_t; CREATE TABLE sg_t (id TEXT PRIMARY KEY, code TEXT); CREATE UNIQUE INDEX sg_ix_ok ON sg_t (lower(code));');
  });
  after(async () => {
    await pool.query('DROP TABLE IF EXISTS sg_t');
    await pool.end();
  });

  it('indice existente + transacao aberta escrevendo na tabela: retorna na hora, sem esperar', async () => {
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(`INSERT INTO sg_t (id, code) VALUES ('h1', 'X')`);
      const t0 = Date.now();
      const r = await runGuardedDdl(pool, 'CREATE UNIQUE INDEX IF NOT EXISTS sg_ix_ok ON sg_t (lower(code)); ALTER TABLE sg_t ADD COLUMN IF NOT EXISTS code TEXT;');
      assert.equal(r.executed, 0);
      assert.ok(Date.now() - t0 < 1500, `demorou ${Date.now() - t0} ms`);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
  });

  it('indice faltando + transacao aberta: falha em ~2 s com 55P03 (nunca fica na fila)', async () => {
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(`INSERT INTO sg_t (id, code) VALUES ('h2', 'Y')`);
      const t0 = Date.now();
      await assert.rejects(
        () => runGuardedDdl(pool, 'CREATE INDEX IF NOT EXISTS sg_ix_new ON sg_t (code);'),
        (e: any) => e.code === '55P03'
      );
      const ms = Date.now() - t0;
      assert.ok(ms >= 1500 && ms < 6000, `esperou ${ms} ms`);
      // O lock_timeout foi local a transacao implicita: a sessao do pool volta ao padrao.
      const s = await pool.query('SHOW lock_timeout');
      assert.equal(s.rows[0].lock_timeout, '0');
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    const r = await runGuardedDdl(pool, 'CREATE INDEX IF NOT EXISTS sg_ix_new ON sg_t (code);');
    assert.equal(r.executed, 1);
  });
});
