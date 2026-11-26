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
export const API_V1_MANUAL_TABLES = ['api_record_owners', 'api_confirmation_tokens', 'api_deleted_records', 'api_dangerous_scope_confirmations'] as const;

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

-- Lote 3: tokens de confirmacao (prepare -> commit), uso unico, so SHA-256 do token.
CREATE TABLE IF NOT EXISTS api_confirmation_tokens (
  token_hash TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  args_hash TEXT NOT NULL,
  principal_key TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_api_confirmation_expires ON api_confirmation_tokens(expires_at);

-- Lote 3 (CISO 26/11 item 6): lixeira — copia integral do registro ANTES de qualquer exclusao pelo conector.
CREATE TABLE IF NOT EXISTS api_deleted_records (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  record_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  actor_user_id TEXT NOT NULL,
  credential TEXT NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_deleted_records_entity ON api_deleted_records(entity, record_id);

-- Lote 3 (CISO 26/11 item 2): confirmacao do IAM para escopos perigosos via OAuth, por cliente ou por usuario.
-- subject_type='client' com client_verified=true = cliente (DCR) verificado pelo IAM.
CREATE TABLE IF NOT EXISTS api_dangerous_scope_confirmations (
  subject_type TEXT NOT NULL CHECK (subject_type IN ('client', 'user')),
  subject_id TEXT NOT NULL,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  client_verified BOOLEAN NOT NULL DEFAULT FALSE,
  confirmed_by_user_id TEXT NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (subject_type, subject_id)
);
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
