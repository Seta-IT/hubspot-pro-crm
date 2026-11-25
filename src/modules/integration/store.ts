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

/**
 * Correcao CISO (Lote 2, 2/3/4): posse (ID do usuario dono) dos registros criados pelo conector.
 * Metadado so do conector: NAO amplia visibilidade na tela; serve para a escrita exigir posse por ID.
 */
export interface RecordOwnerRecord {
  entity: string;
  recordId: string;
  ownerUserId: string;
  createdAt: string;
}

export type AuditChannel = 'rest_v1' | 'mcp' | 'oauth' | 'iam';
export type AuditAuthType = 'api_key' | 'oauth' | 'session' | 'service_key' | 'none';

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
  /** Usuario alvo da acao (ex.: dono da chave criada no IAM). */
  targetUserId?: string | null;
  /** Metadados nao sensiveis (nunca segredo/token/corpo). */
  details?: Record<string, unknown> | null;
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

/**
 * Fase 2 / Lote 3: token de confirmacao (*_prepare -> *_commit). Guardado so o hash; uso unico,
 * 5 min, preso a operacao + hash dos argumentos + credencial/usuario/autorizacao efetiva.
 */
export interface ConfirmationTokenRecord {
  tokenHash: string;
  operationId: string;
  argsHash: string;
  principalKey: string;
  actorUserId: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
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
  // --- posse por ID dos registros criados pelo conector (troca de vendedor sobrescreve) ---
  /**
   * CISO 26/11 (Lote 2, 4): grava o dono SO se ainda nao houver (nunca sobrescreve).
   * true = gravou; false = ja havia dono (o existente fica intacto).
   */
  insertRecordOwner(rec: RecordOwnerRecord): Promise<boolean>;
  /**
   * Troca de dono (so pelo fluxo de mudanca de responsavel, ja autorizado pelo chamador): compare-and-
   * swap pelo dono atual (`fromOwnerUserId`; null = sem dono). true = trocou; false = dono mudou antes.
   */
  transferRecordOwner(entity: string, recordId: string, fromOwnerUserId: string | null, toOwnerUserId: string, at: string): Promise<boolean>;
  getRecordOwner(entity: string, recordId: string): Promise<string | null>;
  /**
   * CISO 26/11 (Lote 2, 5): tabelas da migracao manual da API v1 presentes? (nao sao criadas no boot).
   * false => escritas do conector falham fechadas (503 MIGRATION_REQUIRED).
   */
  manualMigrationReady(): Promise<boolean>;
  // --- auditoria ---
  insertAudit(entry: IntegrationAuditEntry): Promise<void>;
  // --- rate-limit (janela fixa, incremento atomico) ---
  hitRateLimit(bucketKey: string, windowStart: string, now: string): Promise<RateLimitResult>;
  // --- OAuth 2.1 + DCR ---
  insertOAuthClient(rec: OAuthClientRecord): Promise<void>;
  getOAuthClient(clientId: string): Promise<OAuthClientRecord | null>;
  insertAuthCode(rec: OAuthAuthCodeRecord): Promise<void>;
  /** Marca o codigo como usado de forma atomica; retorna o registro ANTES do uso, ou null se nao existe. */
  /** Leitura sem efeito colateral (validar cliente/redirect/PKCE ANTES de consumir). */
  getAuthCode(codeHash: string): Promise<OAuthAuthCodeRecord | null>;
  consumeAuthCode(codeHash: string, at: string): Promise<{ record: OAuthAuthCodeRecord; alreadyUsed: boolean } | null>;
  insertToken(rec: OAuthTokenRecord): Promise<void>;
  getTokenByAccessHash(hash: string): Promise<OAuthTokenRecord | null>;
  getTokenByRefreshHash(hash: string): Promise<OAuthTokenRecord | null>;
  /** Revoga o token se ainda ativo; retorna true se esta chamada revogou (rotacao atomica). */
  revokeTokenIfActive(id: string, at: string): Promise<boolean>;
  revokeTokensForGrant(clientId: string, userId: string, at: string): Promise<number>;
  // --- Lote 3: confirmacao em duas etapas ---
  insertConfirmation(rec: ConfirmationTokenRecord): Promise<void>;
  /**
   * Consome de forma ATOMICA o token do MESMO principal (marca usedAt). Retorna o registro antes do
   * uso; `alreadyUsed` quando ja consumido; null se nao existe ou e de outro principal (sem oraculo).
   */
  consumeConfirmation(tokenHash: string, principalKey: string, at: string): Promise<{ record: ConfirmationTokenRecord; alreadyUsed: boolean } | null>;
}
