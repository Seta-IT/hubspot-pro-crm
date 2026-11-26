// CLI da carga inicial de donos (CISO 26/11). Padrao: DRY-RUN (nada gravado).
//   npm run api-v1:backfill-owners                      # dry-run + relatorio
//   npm run api-v1:backfill-owners -- --apply           # grava (so insere; idempotente)
//   --out <dir>   pasta do relatorio (padrao ./backups/api-v1-owners-<data>)
// Exige a migracao manual (db:migrate:api-v1) aplicada. Em producao recusa sem --allow-production.
// Conexao: DATABASE_URL (nunca impressa). Rode primeiro num branch do Neon.
import fs from 'node:fs';
import path from 'node:path';
import { inspectApiV1ManualMigration } from './api-v1-manual-migration';
import { applyRecordOwnerBackfill, loadExistingOwners, planRecordOwnerBackfill } from './record-owners-backfill';

const argv = process.argv.slice(2);
const has = (k: string) => argv.includes(k);
const arg = (k: string) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};

async function main() {
  const apply = has('--apply');
  if ((process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') && !has('--allow-production')) {
    throw new Error('ambiente de producao detectado: rode num branch do Neon (ou passe --allow-production com OK explicito)');
  }
  const conn = process.env.DATABASE_URL || process.env.DATABASE_POSTGRES_URL;
  if (!conn) throw new Error('DATABASE_URL ausente');
  const out = path.resolve(arg('--out') || `./backups/api-v1-owners-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(out, { recursive: true });
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: conn, max: 1, ssl: conn.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined });
  const client = await pool.connect();
  try {
    const mig = await inspectApiV1ManualMigration(client as never);
    if (mig.missing.length) throw new Error(`migracao manual pendente (${mig.missing.join(', ')}): rode db:migrate:api-v1 -- --apply antes`);
    await client.query('BEGIN');
    const kv = await client.query(`SELECT payload FROM crm_kv_store WHERE key = 'crm_state_v1'`);
    const state = (kv.rows[0]?.payload || {}) as any;
    const erp = state.erp || {};
    const storage = (erp.storage || {}) as Record<string, string>;
    const proposals =
      erp.proposalsStorage === 'table' ? (await client.query(`SELECT data FROM erp_proposals`)).rows.map((r: any) => r.data) : erp.proposals || [];
    const serviceOrders =
      storage.serviceOrders === 'table' ? (await client.query(`SELECT data FROM erp_service_orders`)).rows.map((r: any) => r.data) : erp.serviceOrders || [];
    const plan = planRecordOwnerBackfill(
      {
        users: (state.rbac?.users || []) as never,
        proposals,
        contracts: erp.rentalContracts || [],
        serviceOrders,
        salesOrders: erp.salesOrders || [],
        tasks: state.tasks || [],
      },
      await loadExistingOwners(client as never)
    );
    let result: unknown = { modo: 'dry-run', gravado: 0 };
    if (apply) {
      result = { modo: 'apply', ...(await applyRecordOwnerBackfill(client as never, plan, new Date().toISOString())) };
      await client.query('COMMIT');
    } else {
      await client.query('ROLLBACK');
    }
    const summary = {
      ...(result as object),
      totais: plan.totals,
      jaComDono: plan.alreadyOwned,
      aAtribuir: plan.assign.length,
      ambiguos: plan.ambiguous.length,
      semCorrespondencia: plan.unresolved.length,
    };
    fs.writeFileSync(path.join(out, 'plano.json'), JSON.stringify(plan, null, 2));
    fs.writeFileSync(path.join(out, 'ambiguos-homonimos.json'), JSON.stringify(plan.ambiguous, null, 2));
    fs.writeFileSync(path.join(out, 'resumo.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ ...summary, relatorio: out }, null, 2));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('[api-v1 backfill-owners] falhou:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
