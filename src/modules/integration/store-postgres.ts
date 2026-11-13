// ============================================================================
// STI-hub — API v1 + MCP: persistencia de integracao em Postgres (unica de runtime).
// Tabelas: integration_api_keys, api_idempotency_keys, integration_audit_logs,
// api_rate_limits, oauth_clients, oauth_auth_codes, oauth_tokens.
// Segredos/tokens: so SHA-256. Auditoria nunca grava segredo/token.
// ============================================================================
import type {
  IdempotencyRecord,
  IntegrationApiKeyRecord,
  IntegrationAuditEntry,
  IntegrationStore,
  OAuthAuthCodeRecord,
  OAuthClientRecord,
  OAuthTokenRecord,
  RateLimitResult,
} from './store';
import { normalizeModuleAccess, sanitizeRuntimeScopes, isPortfolioScope } from './scopes';

export interface IntegrationPgQueryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
}

export const INTEGRATION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS integration_api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  portfolio_scope TEXT NOT NULL CHECK (portfolio_scope IN ('PROPRIOS','EQUIPE','TODOS')),
  module_access JSONB NOT NULL DEFAULT '{}'::jsonb,
  owner_user_id TEXT NOT NULL,
  team_member_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by_user_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_integration_api_keys_owner ON integration_api_keys(owner_user_id);

CREATE TABLE IF NOT EXISTS api_idempotency_keys (
  actor_scope_key TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INT NOT NULL,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (actor_scope_key, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_api_idempotency_expires ON api_idempotency_keys(expires_at);

CREATE TABLE IF NOT EXISTS integration_audit_logs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('rest_v1','mcp','oauth','iam')),
  auth_type TEXT NOT NULL,
  key_id TEXT,
  oauth_client_id TEXT,
  actor_user_id TEXT,
  scope TEXT,
  action TEXT NOT NULL,
  path TEXT NOT NULL,
  status_code INT NOT NULL,
  ip_address TEXT,
  latency_ms INT NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_integration_audit_created ON integration_audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_integration_audit_key ON integration_audit_logs(key_id);

CREATE TABLE IF NOT EXISTS api_rate_limits (
  bucket_key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bucket_key, window_start)
);
CREATE INDEX IF NOT EXISTS idx_api_rate_limits_window ON api_rate_limits(window_start);

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_secret_hash TEXT,
  client_name TEXT NOT NULL,
  redirect_uris JSONB NOT NULL DEFAULT '[]'::jsonb,
  grant_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  response_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  scope TEXT NOT NULL DEFAULT '',
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  created_by_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS oauth_auth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL,
  portfolio_scope TEXT NOT NULL CHECK (portfolio_scope IN ('PROPRIOS','EQUIPE','TODOS')),
  module_access JSONB NOT NULL DEFAULT '{}'::jsonb,
  team_member_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL CHECK (code_challenge_method = 'S256'),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id TEXT PRIMARY KEY,
  access_token_hash TEXT NOT NULL UNIQUE,
  refresh_token_hash TEXT UNIQUE,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  portfolio_scope TEXT NOT NULL CHECK (portfolio_scope IN ('PROPRIOS','EQUIPE','TODOS')),
  module_access JSONB NOT NULL DEFAULT '{}'::jsonb,
  team_member_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  refresh_expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_grant ON oauth_tokens(client_id, user_id);
`.trim();

export async function ensureIntegrationSchema(executor: IntegrationPgQueryable): Promise<void> {
  await executor.query(INTEGRATION_SCHEMA_SQL);
}

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(v as string).toISOString());
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const portfolio = (v: unknown) => (isPortfolioScope(v) ? v : 'PROPRIOS');

function rowToKey(r: any): IntegrationApiKeyRecord {
  return {
    id: r.id,
    name: r.name,
    keyPrefix: r.key_prefix,
    keyHash: r.key_hash,
    scopes: sanitizeRuntimeScopes(r.scopes),
    portfolioScope: portfolio(r.portfolio_scope),
    moduleAccess: normalizeModuleAccess(r.module_access),
    ownerUserId: r.owner_user_id,
    teamMemberIds: arr(r.team_member_ids),
    createdByUserId: r.created_by_user_id,
    expiresAt: iso(r.expires_at),
    revokedAt: iso(r.revoked_at),
    lastUsedAt: iso(r.last_used_at),
    createdAt: iso(r.created_at)!,
  };
}

function rowToClient(r: any): OAuthClientRecord {
  return {
    clientId: r.client_id,
    clientSecretHash: r.client_secret_hash || null,
    clientName: r.client_name,
    redirectUris: arr(r.redirect_uris),
    grantTypes: arr(r.grant_types),
    responseTypes: arr(r.response_types),
    scope: String(r.scope || ''),
    tokenEndpointAuthMethod: r.token_endpoint_auth_method,
    createdByIp: r.created_by_ip || null,
    createdAt: iso(r.created_at)!,
    revokedAt: iso(r.revoked_at),
  };
}

function rowToCode(r: any): OAuthAuthCodeRecord {
  return {
    codeHash: r.code_hash,
    clientId: r.client_id,
    userId: r.user_id,
    redirectUri: r.redirect_uri,
    scope: r.scope,
    portfolioScope: portfolio(r.portfolio_scope),
    moduleAccess: normalizeModuleAccess(r.module_access),
    teamMemberIds: arr(r.team_member_ids),
    codeChallenge: r.code_challenge,
    codeChallengeMethod: 'S256',
    expiresAt: iso(r.expires_at)!,
    usedAt: iso(r.used_at),
    createdAt: iso(r.created_at)!,
  };
}

function rowToToken(r: any): OAuthTokenRecord {
  return {
    id: r.id,
    accessTokenHash: r.access_token_hash,
    refreshTokenHash: r.refresh_token_hash || null,
    clientId: r.client_id,
    userId: r.user_id,
    scope: r.scope,
    portfolioScope: portfolio(r.portfolio_scope),
    moduleAccess: normalizeModuleAccess(r.module_access),
    teamMemberIds: arr(r.team_member_ids),
    expiresAt: iso(r.expires_at)!,
    refreshExpiresAt: iso(r.refresh_expires_at),
    revokedAt: iso(r.revoked_at),
    createdAt: iso(r.created_at)!,
  };
}

export class PostgresIntegrationStore implements IntegrationStore {
  readonly kind = 'postgres' as const;
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly db: IntegrationPgQueryable) {}

  private async q(text: string, params?: unknown[]) {
    if (!this.schemaReady) {
      this.schemaReady = ensureIntegrationSchema(this.db).catch((err) => {
        this.schemaReady = null;
        throw err;
      });
    }
    await this.schemaReady;
    return this.db.query(text, params);
  }

  async insertApiKey(k: IntegrationApiKeyRecord): Promise<void> {
    await this.q(
      `INSERT INTO integration_api_keys (id, name, key_prefix, key_hash, scopes, portfolio_scope, module_access,
        owner_user_id, team_member_ids, created_by_user_id, expires_at, revoked_at, last_used_at, created_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9::jsonb,$10,$11,$12,$13,$14)`,
      [k.id, k.name, k.keyPrefix, k.keyHash, JSON.stringify(k.scopes), k.portfolioScope, JSON.stringify(k.moduleAccess),
        k.ownerUserId, JSON.stringify(k.teamMemberIds), k.createdByUserId, k.expiresAt, k.revokedAt, k.lastUsedAt, k.createdAt]
    );
  }
  async listApiKeys(): Promise<IntegrationApiKeyRecord[]> {
    const r = await this.q(`SELECT * FROM integration_api_keys ORDER BY created_at DESC LIMIT 500`);
    return r.rows.map(rowToKey);
  }
  async getApiKeyById(id: string) {
    const r = await this.q(`SELECT * FROM integration_api_keys WHERE id = $1`, [id]);
    return r.rows[0] ? rowToKey(r.rows[0]) : null;
  }
  async getApiKeyByHash(hash: string) {
    const r = await this.q(`SELECT * FROM integration_api_keys WHERE key_hash = $1`, [hash]);
    return r.rows[0] ? rowToKey(r.rows[0]) : null;
  }
  async revokeApiKey(id: string, at: string) {
    const r = await this.q(
      `UPDATE integration_api_keys SET revoked_at = COALESCE(revoked_at, $2) WHERE id = $1 RETURNING *`,
      [id, at]
    );
    return r.rows[0] ? rowToKey(r.rows[0]) : null;
  }
  async touchApiKey(id: string, at: string) {
    // Grava no maximo 1x por minuto por chave (reduz escrita/egress).
    await this.q(
      `UPDATE integration_api_keys SET last_used_at = $2
        WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < ($2::timestamptz - INTERVAL '60 seconds'))`,
      [id, at]
    );
  }

  async getIdempotency(actorScopeKey: string, key: string, now: string) {
    const r = await this.q(
      `SELECT * FROM api_idempotency_keys WHERE actor_scope_key = $1 AND idempotency_key = $2 AND expires_at > $3`,
      [actorScopeKey, key, now]
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      actorScopeKey: row.actor_scope_key,
      idempotencyKey: row.idempotency_key,
      method: row.method,
      path: row.path,
      requestHash: row.request_hash,
      statusCode: Number(row.status_code),
      responseBody: row.response_body,
      createdAt: iso(row.created_at)!,
      expiresAt: iso(row.expires_at)!,
    } as IdempotencyRecord;
  }
  async putIdempotency(rec: IdempotencyRecord) {
    // Expirados sao substituidos; ativos nunca sao sobrescritos.
    const r = await this.q(
      `INSERT INTO api_idempotency_keys (actor_scope_key, idempotency_key, method, path, request_hash, status_code, response_body, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
       ON CONFLICT (actor_scope_key, idempotency_key) DO UPDATE SET
         method = EXCLUDED.method, path = EXCLUDED.path, request_hash = EXCLUDED.request_hash,
         status_code = EXCLUDED.status_code, response_body = EXCLUDED.response_body,
         created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at
       WHERE api_idempotency_keys.expires_at <= EXCLUDED.created_at
       RETURNING actor_scope_key`,
      [rec.actorScopeKey, rec.idempotencyKey, rec.method, rec.path, rec.requestHash, rec.statusCode,
        JSON.stringify(rec.responseBody ?? null), rec.createdAt, rec.expiresAt]
    );
    return (r.rowCount ?? r.rows.length) > 0;
  }

  async completeIdempotency(actorScopeKey: string, key: string, statusCode: number, responseBody: unknown) {
    await this.q(
      `UPDATE api_idempotency_keys SET status_code = $3, response_body = $4::jsonb WHERE actor_scope_key = $1 AND idempotency_key = $2`,
      [actorScopeKey, key, statusCode, JSON.stringify(responseBody ?? null)]
    );
  }
  async deleteIdempotency(actorScopeKey: string, key: string) {
    await this.q(`DELETE FROM api_idempotency_keys WHERE actor_scope_key = $1 AND idempotency_key = $2`, [actorScopeKey, key]);
  }

  async insertAudit(e: IntegrationAuditEntry) {
    await this.q(
      `INSERT INTO integration_audit_logs (id, request_id, channel, auth_type, key_id, oauth_client_id, actor_user_id, scope,
        action, path, status_code, ip_address, latency_ms, error_code, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [e.id, e.requestId, e.channel, e.authType, e.keyId, e.oauthClientId, e.actorUserId, e.scope, e.action,
        e.path.slice(0, 300), e.statusCode, e.ipAddress, Math.max(0, Math.round(e.latencyMs)), e.errorCode, e.createdAt]
    );
  }

  async hitRateLimit(bucketKey: string, windowStart: string, now: string): Promise<RateLimitResult> {
    const r = await this.q(
      `INSERT INTO api_rate_limits (bucket_key, window_start, request_count, updated_at)
       VALUES ($1, $2, 1, $3)
       ON CONFLICT (bucket_key, window_start) DO UPDATE
         SET request_count = api_rate_limits.request_count + 1, updated_at = EXCLUDED.updated_at
       RETURNING request_count`,
      [bucketKey, windowStart, now]
    );
    // Limpeza oportunista (~1% das chamadas) das janelas antigas.
    if (Math.random() < 0.01) {
      await this.db.query(`DELETE FROM api_rate_limits WHERE window_start < ($1::timestamptz - INTERVAL '1 hour')`, [now]).catch(() => undefined);
      await this.db.query(`DELETE FROM api_idempotency_keys WHERE expires_at < $1`, [now]).catch(() => undefined);
    }
    return { count: Number(r.rows[0]?.request_count || 0), windowStart };
  }

  async insertOAuthClient(c: OAuthClientRecord) {
    await this.q(
      `INSERT INTO oauth_clients (client_id, client_secret_hash, client_name, redirect_uris, grant_types, response_types, scope,
        token_endpoint_auth_method, created_by_ip, created_at, revoked_at)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11)`,
      [c.clientId, c.clientSecretHash, c.clientName, JSON.stringify(c.redirectUris), JSON.stringify(c.grantTypes),
        JSON.stringify(c.responseTypes), c.scope, c.tokenEndpointAuthMethod, c.createdByIp, c.createdAt, c.revokedAt]
    );
  }
  async getOAuthClient(clientId: string) {
    const r = await this.q(`SELECT * FROM oauth_clients WHERE client_id = $1`, [clientId]);
    return r.rows[0] ? rowToClient(r.rows[0]) : null;
  }
  async insertAuthCode(c: OAuthAuthCodeRecord) {
    await this.q(
      `INSERT INTO oauth_auth_codes (code_hash, client_id, user_id, redirect_uri, scope, portfolio_scope, module_access,
        team_member_ids, code_challenge, code_challenge_method, expires_at, used_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13)`,
      [c.codeHash, c.clientId, c.userId, c.redirectUri, c.scope, c.portfolioScope, JSON.stringify(c.moduleAccess),
        JSON.stringify(c.teamMemberIds), c.codeChallenge, c.codeChallengeMethod, c.expiresAt, c.usedAt, c.createdAt]
    );
  }
  async consumeAuthCode(codeHash: string, at: string) {
    const upd = await this.q(
      `UPDATE oauth_auth_codes SET used_at = $2 WHERE code_hash = $1 AND used_at IS NULL RETURNING *`,
      [codeHash, at]
    );
    if (upd.rows[0]) return { record: rowToCode(upd.rows[0]), alreadyUsed: false };
    const sel = await this.q(`SELECT * FROM oauth_auth_codes WHERE code_hash = $1`, [codeHash]);
    return sel.rows[0] ? { record: rowToCode(sel.rows[0]), alreadyUsed: true } : null;
  }
  async insertToken(t: OAuthTokenRecord) {
    await this.q(
      `INSERT INTO oauth_tokens (id, access_token_hash, refresh_token_hash, client_id, user_id, scope, portfolio_scope,
        module_access, team_member_ids, expires_at, refresh_expires_at, revoked_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13)`,
      [t.id, t.accessTokenHash, t.refreshTokenHash, t.clientId, t.userId, t.scope, t.portfolioScope,
        JSON.stringify(t.moduleAccess), JSON.stringify(t.teamMemberIds), t.expiresAt, t.refreshExpiresAt, t.revokedAt, t.createdAt]
    );
  }
  async getTokenByAccessHash(hash: string) {
    const r = await this.q(`SELECT * FROM oauth_tokens WHERE access_token_hash = $1`, [hash]);
    return r.rows[0] ? rowToToken(r.rows[0]) : null;
  }
  async getTokenByRefreshHash(hash: string) {
    const r = await this.q(`SELECT * FROM oauth_tokens WHERE refresh_token_hash = $1`, [hash]);
    return r.rows[0] ? rowToToken(r.rows[0]) : null;
  }
  async revokeTokenIfActive(id: string, at: string) {
    const r = await this.q(`UPDATE oauth_tokens SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL RETURNING id`, [id, at]);
    return (r.rowCount ?? r.rows.length) > 0;
  }
  async revokeTokensForGrant(clientId: string, userId: string, at: string) {
    const r = await this.q(
      `UPDATE oauth_tokens SET revoked_at = $3 WHERE client_id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id`,
      [clientId, userId, at]
    );
    return r.rowCount ?? r.rows.length;
  }
}
