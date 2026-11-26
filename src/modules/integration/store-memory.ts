// ============================================================================
// STI-hub — API v1 + MCP: store em MEMORIA, EXCLUSIVO PARA TESTES automatizados.
// Nunca e usado em runtime: so entra por setIntegrationStoreForTests() com NODE_ENV=test.
// O construtor recusa rodar fora de NODE_ENV=test (fail-closed).
// ============================================================================
import type {
  ConfirmationTokenRecord,
  DangerousScopeConfirmationRecord,
  DeletedRecordSnapshot,
  IdempotencyRecord,
  RecordOwnerRecord,
  IntegrationApiKeyRecord,
  IntegrationAuditEntry,
  IntegrationStore,
  OAuthAuthCodeRecord,
  OAuthClientRecord,
  OAuthTokenRecord,
} from './store';

const clone = <T>(v: T): T => structuredClone(v);

export class TestOnlyMemoryIntegrationStore implements IntegrationStore {
  readonly kind = 'memory-test' as const;
  readonly keys = new Map<string, IntegrationApiKeyRecord>();
  readonly idem = new Map<string, IdempotencyRecord>();
  readonly owners = new Map<string, RecordOwnerRecord>();
  readonly audit: IntegrationAuditEntry[] = [];
  readonly rate = new Map<string, number>();
  readonly clients = new Map<string, OAuthClientRecord>();
  readonly codes = new Map<string, OAuthAuthCodeRecord>();
  readonly tokens = new Map<string, OAuthTokenRecord>();
  readonly confirmations = new Map<string, ConfirmationTokenRecord>();
  readonly trash: DeletedRecordSnapshot[] = [];
  readonly dangerousConfirmations = new Map<string, DangerousScopeConfirmationRecord>();
  /** Teste: simula falha ao gravar a lixeira (a exclusao nao pode acontecer). */
  failTrashInsert = false;

  constructor() {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('TestOnlyMemoryIntegrationStore so pode ser usado com NODE_ENV=test.');
    }
  }

  async insertApiKey(rec: IntegrationApiKeyRecord) {
    if ([...this.keys.values()].some((k) => k.keyHash === rec.keyHash)) throw Object.assign(new Error('dup'), { code: '23505' });
    this.keys.set(rec.id, clone(rec));
  }
  async listApiKeys() {
    return [...this.keys.values()].map(clone).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async getApiKeyById(id: string) {
    const k = this.keys.get(id);
    return k ? clone(k) : null;
  }
  async getApiKeyByHash(hash: string) {
    const k = [...this.keys.values()].find((x) => x.keyHash === hash);
    return k ? clone(k) : null;
  }
  async revokeApiKey(id: string, at: string) {
    const k = this.keys.get(id);
    if (!k) return null;
    if (!k.revokedAt) k.revokedAt = at;
    return clone(k);
  }
  async touchApiKey(id: string, at: string) {
    const k = this.keys.get(id);
    if (k) k.lastUsedAt = at;
  }
  async getIdempotency(actor: string, key: string, now: string) {
    const r = this.idem.get(`${actor}\u0000${key}`);
    return r && r.expiresAt > now ? clone(r) : null;
  }
  async putIdempotency(rec: IdempotencyRecord) {
    const id = `${rec.actorScopeKey}\u0000${rec.idempotencyKey}`;
    const cur = this.idem.get(id);
    if (cur && cur.expiresAt > rec.createdAt) return false;
    this.idem.set(id, clone(rec));
    return true;
  }
  async completeIdempotency(actor: string, key: string, statusCode: number, responseBody: unknown) {
    const r = this.idem.get(`${actor}\u0000${key}`);
    if (r) {
      r.statusCode = statusCode;
      r.responseBody = clone(responseBody);
    }
  }
  async deleteIdempotency(actor: string, key: string) {
    this.idem.delete(`${actor}\u0000${key}`);
  }
  /** Teste: simula banco sem a migracao manual da API v1 (tabelas ausentes). */
  manualMigrationApplied = true;
  async manualMigrationReady() {
    return this.manualMigrationApplied;
  }
  private requireManualTable(t: string) {
    if (!this.manualMigrationApplied) throw new Error(`relation "${t}" does not exist`);
  }
  private requireOwnersTable() {
    if (!this.manualMigrationApplied) throw new Error('relation "api_record_owners" does not exist');
  }
  async insertRecordOwner(rec: RecordOwnerRecord) {
    this.requireOwnersTable();
    const id = `${rec.entity}\u0000${rec.recordId}`;
    if (this.owners.has(id)) return false;
    this.owners.set(id, clone(rec));
    return true;
  }
  async transferRecordOwner(entity: string, recordId: string, fromOwnerUserId: string | null, toOwnerUserId: string, at: string) {
    this.requireOwnersTable();
    const id = `${entity}\u0000${recordId}`;
    const cur = this.owners.get(id);
    if ((cur?.ownerUserId ?? null) !== fromOwnerUserId) return false;
    this.owners.set(id, { entity, recordId, ownerUserId: toOwnerUserId, createdAt: cur?.createdAt || at });
    return true;
  }
  async getRecordOwner(entity: string, recordId: string) {
    this.requireOwnersTable();
    return this.owners.get(`${entity}\u0000${recordId}`)?.ownerUserId ?? null;
  }
  async insertAudit(entry: IntegrationAuditEntry) {
    this.audit.push(clone(entry));
  }
  async hitRateLimit(bucketKey: string, windowStart: string) {
    const id = `${bucketKey}@${windowStart}`;
    const n = (this.rate.get(id) || 0) + 1;
    this.rate.set(id, n);
    return { count: n, windowStart };
  }
  async insertOAuthClient(rec: OAuthClientRecord) {
    this.clients.set(rec.clientId, clone(rec));
  }
  async getOAuthClient(id: string) {
    const c = this.clients.get(id);
    return c ? clone(c) : null;
  }
  async insertAuthCode(rec: OAuthAuthCodeRecord) {
    this.codes.set(rec.codeHash, clone(rec));
  }
  async getAuthCode(codeHash: string) {
    const c = this.codes.get(codeHash);
    return c ? clone(c) : null;
  }
  async consumeAuthCode(codeHash: string, at: string) {
    const c = this.codes.get(codeHash);
    if (!c) return null;
    const before = clone(c);
    if (c.usedAt) return { record: before, alreadyUsed: true };
    c.usedAt = at;
    return { record: before, alreadyUsed: false };
  }
  async insertToken(rec: OAuthTokenRecord) {
    this.tokens.set(rec.id, clone(rec));
  }
  async getTokenByAccessHash(hash: string) {
    const t = [...this.tokens.values()].find((x) => x.accessTokenHash === hash);
    return t ? clone(t) : null;
  }
  async getTokenByRefreshHash(hash: string) {
    const t = [...this.tokens.values()].find((x) => x.refreshTokenHash === hash);
    return t ? clone(t) : null;
  }
  async revokeTokenIfActive(id: string, at: string) {
    const t = this.tokens.get(id);
    if (!t || t.revokedAt) return false;
    t.revokedAt = at;
    return true;
  }
  async revokeTokensForGrant(clientId: string, userId: string, at: string) {
    let n = 0;
    for (const t of this.tokens.values()) {
      if (t.clientId === clientId && t.userId === userId && !t.revokedAt) {
        t.revokedAt = at;
        n++;
      }
    }
    return n;
  }
  async insertConfirmation(rec: ConfirmationTokenRecord) {
    this.requireManualTable('api_confirmation_tokens');
    this.confirmations.set(rec.tokenHash, clone(rec));
  }
  async consumeConfirmation(tokenHash: string, principalKey: string, at: string) {
    this.requireManualTable('api_confirmation_tokens');
    const c = this.confirmations.get(tokenHash);
    if (!c || c.principalKey !== principalKey) return null;
    const before = clone(c);
    if (c.usedAt) return { record: before, alreadyUsed: true };
    c.usedAt = at;
    return { record: before, alreadyUsed: false };
  }
  async insertDeletedRecord(rec: DeletedRecordSnapshot) {
    this.requireManualTable('api_deleted_records');
    if (this.failTrashInsert) throw new Error('falha simulada ao gravar a lixeira');
    this.trash.push(clone(rec));
  }
  async listDeletedRecords(entity?: string, recordId?: string) {
    this.requireManualTable('api_deleted_records');
    return this.trash.filter((t) => (!entity || t.entity === entity) && (!recordId || t.recordId === recordId)).map(clone);
  }
  async getDangerousScopeConfirmation(subjectType: 'client' | 'user', subjectId: string) {
    this.requireManualTable('api_dangerous_scope_confirmations');
    const r = this.dangerousConfirmations.get(`${subjectType}\u0000${subjectId}`);
    return r ? clone(r) : null;
  }
  async upsertDangerousScopeConfirmation(rec: DangerousScopeConfirmationRecord) {
    this.requireManualTable('api_dangerous_scope_confirmations');
    this.dangerousConfirmations.set(`${rec.subjectType}\u0000${rec.subjectId}`, clone(rec));
  }
  async revokeDangerousScopeConfirmation(subjectType: 'client' | 'user', subjectId: string, at: string) {
    this.requireManualTable('api_dangerous_scope_confirmations');
    const r = this.dangerousConfirmations.get(`${subjectType}\u0000${subjectId}`);
    if (!r || r.revokedAt) return false;
    r.revokedAt = at;
    return true;
  }
  async listDangerousScopeConfirmations() {
    this.requireManualTable('api_dangerous_scope_confirmations');
    return [...this.dangerousConfirmations.values()].map(clone);
  }
}
