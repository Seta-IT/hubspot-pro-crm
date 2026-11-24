/**
 * Backfill das tabelas proprias do ERP (plano de tabelas, E0/E2) — 18/11/2026.
 *
 *   npx tsx scripts/erp-tables/backfill.ts --resource serviceOrders                 # dry-run (padrao)
 *   npx tsx scripts/erp-tables/backfill.ts --resource serviceOrders --apply         # copia + modo 'dual'
 *   npx tsx scripts/erp-tables/backfill.ts --resource serviceOrders --cut --confirm-cut   # SO com OK do usuario
 *   npx tsx scripts/erp-tables/backfill.ts --resource serviceOrders --rollback      # 'table' -> 'dual'
 *
 * Conexao: DATABASE_URL do ambiente (nunca impressa). Rode primeiro num branch do Neon.
 * Relatorio: --out <dir> (padrao /workspace/backups/erp-tabelas-<recurso>-<data>), com backup do
 * array do JSON antes de qualquer gravacao.
 *  - --apply: tabela recebe/atualiza as linhas pelo id e o marcador vira 'dual'. O JSON fica
 *    INTACTO. Idempotente (rodar de novo so ressincroniza).
 *  - --cut: esvazia o array do JSON (a tabela vira a fonte). E exclusao de dado do JSON: exige
 *    --confirm-cut e o OK explicito do usuario. O backup do array fica em --out.
 *  - --rollback: copia a tabela de volta para o JSON e volta ao modo 'dual'. Nao apaga a tabela.
 */
import fs from 'node:fs';
import path from 'node:path';
import { erpTableSpecFor, ERP_TABLE_SPECS } from '../../src/db/erp-tables-registry';
import { BackfillAbort, runErpTableBackfill, type BackfillAction } from '../../src/db/erp-table-backfill';

const argv = process.argv.slice(2);
const arg = (k: string): string | undefined => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};

export function parseBackfillArgs(args: string[]): { resource: string; action: BackfillAction; confirmCut: boolean } {
  const has = (k: string) => args.includes(k);
  const i = args.indexOf('--resource');
  const resource = i >= 0 ? String(args[i + 1] || '') : '';
  const flags = ['--apply', '--cut', '--rollback'].filter(has);
  if (flags.length > 1) throw new Error('use so uma acao: --apply, --cut ou --rollback');
  const action: BackfillAction = has('--apply') ? 'apply' : has('--cut') ? 'cut' : has('--rollback') ? 'rollback' : 'plan';
  return { resource, action, confirmCut: has('--confirm-cut') };
}

async function main() {
  const { resource, action, confirmCut } = parseBackfillArgs(argv);
  const spec = erpTableSpecFor(resource);
  if (!spec) throw new Error(`--resource invalido. Opcoes: ${ERP_TABLE_SPECS.map((s) => s.resource).join(', ')}`);
  const out = path.resolve(arg('--out') || `/workspace/backups/erp-tabelas-${resource}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(out, { recursive: true });
  const conn = process.env.DATABASE_URL || process.env.DATABASE_POSTGRES_URL;
  if (!conn) throw new Error('DATABASE_URL ausente');
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: conn, max: 1, ssl: conn.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined });
  const client = await pool.connect();
  let report: unknown = null;
  try {
    await client.query('BEGIN');
    const snap = await client.query(`SELECT payload->'erp'->$1 AS arr FROM crm_kv_store WHERE key = 'crm_state_v1'`, [resource]);
    fs.writeFileSync(path.join(out, `backup-${resource}-json-antes.json`), JSON.stringify(snap.rows?.[0]?.arr ?? null));
    report = await runErpTableBackfill(client as any, spec, action, { confirmCut });
    if (action === 'plan') await client.query('ROLLBACK');
    else await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => null);
    report = e instanceof BackfillAbort ? e.report : { erro: e instanceof Error ? e.message : String(e) };
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
    fs.writeFileSync(path.join(out, 'relatorio.json'), JSON.stringify(report, null, 1));
    console.log(JSON.stringify({ ...(report as object), relatorio: path.join(out, 'relatorio.json') }, null, 1));
  }
}

if (process.argv[1] && /erp-tables[\\/]backfill\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
