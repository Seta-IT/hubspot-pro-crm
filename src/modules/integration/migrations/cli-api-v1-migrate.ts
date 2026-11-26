// CLI da migracao MANUAL da API v1 (CISO 26/11). Padrao: dry-run. --apply grava.
// Conexao: DATABASE_URL (nunca impressa). Rode primeiro num branch do Neon.
import { API_V1_MANUAL_MIGRATION_SQL, applyApiV1ManualMigration, inspectApiV1ManualMigration } from './api-v1-manual-migration';

async function main() {
  const apply = process.argv.includes('--apply');
  const conn = process.env.DATABASE_URL || process.env.DATABASE_POSTGRES_URL;
  if (!conn) throw new Error('DATABASE_URL ausente');
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: conn, max: 1, ssl: conn.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined });
  const client = await pool.connect();
  try {
    const before = await inspectApiV1ManualMigration(client as never);
    console.log(JSON.stringify({ modo: apply ? 'apply' : 'dry-run', antes: before }, null, 2));
    if (!apply) {
      console.log('\n-- SQL que seria executado (--apply):\n' + API_V1_MANUAL_MIGRATION_SQL);
      return;
    }
    await applyApiV1ManualMigration(client as never);
    console.log(JSON.stringify({ depois: await inspectApiV1ManualMigration(client as never) }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('[api-v1 migrate] falhou:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
