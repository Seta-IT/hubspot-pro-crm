// ============================================================================
// STI-hub — API v1 + MCP: contrato de persistencia de integracao.
// Implementacao de RUNTIME: Postgres (store-postgres.ts). Nunca ha fallback para
// JSON/tmp: sem Postgres as rotas respondem 503.
// A implementacao em memoria (store-memory.ts) existe SOMENTE para testes e so pode
// ser ativada por injecao explicita (setIntegrationStoreForTests) com NODE_ENV=test.
// ============================================================================
import type { IntegrationModuleAccess, IntegrationScope, PortfolioScope } from './scopes';

export interface IntegrationApiKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  scopes: IntegrationScope[];
  portfolioScope: PortfolioScope;
  moduleAccess: IntegrationModuleAccess;
  ownerUserId: string;
  teamMemberIds: string[];
  createdByUserId: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface IdempotencyRecord {
  actorScopeKey: string;
  idempotencyKey: string;
  method: string;
  path: string;
  requestHash: string;
  statusCode: number;
  responseBody: unknown;
  createdAt: string;
  expiresAt: string;
}

export type AuditChannel = 'rest_v1' | 'mcp' | 'oauth' | 'iam';
export type AuditAuthType = 'api_key' | 'oauth' | 'session' | 'none';

export interface IntegrationAuditEntry {
  id: string;
  requestId: string;
  channel: AuditChannel;
  authType: AuditAuthType;
  keyId: string | null;
  oauthClientId: string | null;
  actorUserId: string | null;
  scope: string | null;
  action: string;
  path: string;
  statusCode: number;
  ipAddress: string | null;
  latencyMs: number;
  errorCode: string | null;
  createdAt: string;
}

export interface OAuthClientRecord {
  clientId: string;
  clientSecretHash: string | null;
  clientName: string;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  scope: string;
  tokenEndpointAuthMethod: 'none' | 'client_secret_post' | 'client_secret_basic';
  createdByIp: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface OAuthGrantContext {
  userId: string;
  scope: string;
  portfolioScope: PortfolioScope;
  moduleAccess: IntegrationModuleAccess;
  teamMemberIds: string[];
}

export interface OAuthAuthCodeRecord extends OAuthGrantContext {
  codeHash: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export interface OAuthTokenRecord extends OAuthGrantContext {
  id: string;
  accessTokenHash: string;
  refreshTokenHash: string | null;
  clientId: string;
  expiresAt: string;
  refreshExpiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface RateLimitResult {
  count: number;
  windowStart: string;
}

export interface IntegrationStore {
  readonly kind: 'postgres' | 'memory-test';
  // --- chaves de integracao ---
  insertApiKey(rec: IntegrationApiKeyRecord): Promise<void>;
  listApiKeys(): Promise<IntegrationApiKeyRecord[]>;
  getApiKeyById(id: string): Promise<IntegrationApiKeyRecord | null>;
  getApiKeyByHash(hash: string): Promise<IntegrationApiKeyRecord | null>;
  revokeApiKey(id: string, at: string): Promise<IntegrationApiKeyRecord | null>;
  touchApiKey(id: string, at: string): Promise<void>;
  // --- idempotencia ---
  getIdempotency(actorScopeKey: string, key: string, now: string): Promise<IdempotencyRecord | null>;
  /** true se gravou; false se ja existia (corrida). */
  putIdempotency(rec: IdempotencyRecord): Promise<boolean>;
  /** Grava o resultado final da reserva (status_code 0 = em andamento). */
  completeIdempotency(actorScopeKey: string, key: string, statusCode: number, responseBody: unknown): Promise<void>;
  /** Libera a reserva quando a operacao falhou (5xx/excecao), para permitir nova tentativa. */
  deleteIdempotency(actorScopeKey: string, key: string): Promise<void>;
  // --- auditoria ---
  insertAudit(entry: IntegrationAuditEntry): Promise<void>;
  // --- rate-limit (janela fixa, incremento atomico) ---
  hitRateLimit(bucketKey: string, windowStart: string, now: string): Promise<RateLimitResult>;
  // --- OAuth 2.1 + DCR ---
  insertOAuthClient(rec: OAuthClientRecord): Promise<void>;
  getOAuthClient(clientId: string): Promise<OAuthClientRecord | null>;
  insertAuthCode(rec: OAuthAuthCodeRecord): Promise<void>;
  /** Marca o codigo como usado de forma atomica; retorna o registro ANTES do uso, ou null se nao existe. */
  consumeAuthCode(codeHash: string, at: string): Promise<{ record: OAuthAuthCodeRecord; alreadyUsed: boolean } | null>;
  insertToken(rec: OAuthTokenRecord): Promise<void>;
  getTokenByAccessHash(hash: string): Promise<OAuthTokenRecord | null>;
  getTokenByRefreshHash(hash: string): Promise<OAuthTokenRecord | null>;
  /** Revoga o token se ainda ativo; retorna true se esta chamada revogou (rotacao atomica). */
  revokeTokenIfActive(id: string, at: string): Promise<boolean>;
  revokeTokensForGrant(clientId: string, userId: string, at: string): Promise<number>;
}
