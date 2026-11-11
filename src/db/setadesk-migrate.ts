// ============================================================================
// SetaDesk - CLI que aplica SOMENTE as migracoes do esquema setadesk_*
// (nao carrega, nao semeia e nao altera o snapshot crm_kv_store).
// Uso: npm run db:migrate:setadesk   (requer DATABASE_URL no ambiente)
// ============================================================================

import { closePostgresPool, getPostgresPool, isPostgresEnabled } from './postgres';
import { applySetaDeskMigrations, SETADESK_MIGRATIONS } from './setadesk-schema';

async function main() {
  if (!isPostgresEnabled()) {
    console.error('[SetaDesk] DATABASE_URL nao definida; nada a migrar.');
    process.exitCode = 1;
    return;
  }
  const pool = getPostgresPool()!;
  const applied = await applySetaDeskMigrations(pool);
  const all = await pool.query<{ id: string; applied_at: Date }>(
    'SELECT id, applied_at FROM setadesk_schema_migrations ORDER BY id'
  );
  console.log(
    `[SetaDesk] Migracoes aplicadas agora: ${applied.length ? applied.join(', ') : 'nenhuma (ja atualizado)'}`
  );
  console.log(
    `[SetaDesk] Registradas no banco (${all.rowCount}/${SETADESK_MIGRATIONS.length}):`,
    all.rows.map((r) => `${r.id} @ ${r.applied_at.toISOString()}`).join('; ')
  );
  await closePostgresPool();
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('[SetaDesk] Falha ao migrar:', (err as Error)?.message || err);
    await closePostgresPool();
    process.exit(1);
  });
}
