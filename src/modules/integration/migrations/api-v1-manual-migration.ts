// ============================================================================
// STI-hub — API v1/MCP: MIGRACAO MANUAL (parecer do CISO de 26/11/2026, Lote 2 item 5).
// ----------------------------------------------------------------------------
// As tabelas abaixo NAO estao no INTEGRATION_SCHEMA_SQL (que roda no boot/primeira requisicao).
// So sao criadas rodando, de proposito e com DATABASE_URL apontada para o banco certo:
//
//   npm run db:migrate:api-v1                 # dry-run: mostra o que falta e o SQL (nada gravado)
//   npm run db:migrate:api-v1 -- --apply      # cria as tabelas (transacao unica, idempotente)
//
// Sem as tabelas o conector falha FECHADO: escritas e operacoes que dependem delas => 503
// MIGRATION_REQUIRED, antes de qualquer gravacao.
// ============================================================================

/** Tabelas desta migracao (ordem de criacao). */
export const API_V1_MANUAL_TABLES = ['api_record_owners'] as const;

export const API_V1_MANUAL_MIGRATION_SQL = `
-- Lote 2: dono por ID de registro (metadado de autoria; nao amplia visibilidade).
-- Insercao so se ausente (ON CONFLICT DO NOTHING); troca so pelo fluxo de mudanca de responsavel.
CREATE TABLE IF NOT EXISTS api_record_owners (
  entity TEXT NOT NULL,
  record_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (entity, record_id)
);
CREATE INDEX IF NOT EXISTS idx_api_record_owners_owner ON api_record_owners(owner_user_id);
`.trim();

export interface MigrationQueryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
}

/** Quais tabelas da migracao manual ja existem. */
export async function inspectApiV1ManualMigration(db: MigrationQueryable): Promise<{ present: string[]; missing: string[] }> {
  const present: string[] = [];
  const missing: string[] = [];
  for (const t of API_V1_MANUAL_TABLES) {
    const r = await db.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${t}`]);
    (r.rows[0]?.ok === true ? present : missing).push(t);
  }
  return { present, missing };
}

/** Aplica a migracao numa transacao (idempotente). So o CLI manual chama. */
export async function applyApiV1ManualMigration(db: MigrationQueryable): Promise<void> {
  await db.query('BEGIN');
  try {
    await db.query(API_V1_MANUAL_MIGRATION_SQL);
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw err;
  }
}
