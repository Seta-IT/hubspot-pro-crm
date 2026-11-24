// ============================================================================
// STI-hub — Trava global entre instancias (19/11/2026).
// Lease com expiracao em uma linha do Postgres (compare-and-set atomico via INSERT ... ON CONFLICT
// DO UPDATE ... WHERE expires_at < now()). Usada pelo executor de cadencias (e campanhas) para:
//   - garantir UMA execucao do cron por vez em todas as instancias da Vercel;
//   - reservar cada envio (chave de idempotencia) antes de chamar o provedor de e-mail.
// Relogio: sempre o do banco (now()), nunca o da instancia.
// Sem DATABASE_URL (testes/local): implementacao em memoria com o mesmo contrato.
// Falha do banco => o chamador trata como "nao adquirida" (fail-closed: nao envia).
// ============================================================================
import { getPostgresPool, isPostgresEnabled, type PgQueryable } from './postgres';

export interface LockInfo {
  owner: string;
  acquiredAt: number;
  expiresAt: number;
}

export interface DistributedLockStore {
  /** true somente se este dono passou a deter a trava (livre ou expirada). */
  acquire(key: string, owner: string, ttlMs: number): Promise<boolean>;
  /** Libera so se ainda for o dono. */
  release(key: string, owner: string): Promise<void>;
  peek(key: string): Promise<LockInfo | null>;
}

export const DISTRIBUTED_LOCKS_DDL = `
CREATE TABLE IF NOT EXISTS crm_distributed_locks (
  lock_key    TEXT PRIMARY KEY,
  owner       TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS crm_distributed_locks_expires_idx ON crm_distributed_locks (expires_at);
`;

export const LOCK_ACQUIRE_SQL = `INSERT INTO crm_distributed_locks (lock_key, owner, acquired_at, expires_at)
VALUES ($1, $2, now(), now() + make_interval(secs => $3::double precision / 1000))
ON CONFLICT (lock_key) DO UPDATE
  SET owner = EXCLUDED.owner, acquired_at = EXCLUDED.acquired_at, expires_at = EXCLUDED.expires_at
  WHERE crm_distributed_locks.expires_at < now()
RETURNING owner`;

export const LOCK_RELEASE_SQL = `DELETE FROM crm_distributed_locks WHERE lock_key = $1 AND owner = $2`;
export const LOCK_PEEK_SQL = `SELECT owner, acquired_at, expires_at FROM crm_distributed_locks WHERE lock_key = $1 LIMIT 1`;

const KEY_RE = /^[A-Za-z0-9:._@-]{1,200}$/;
function checkKey(key: string): void {
  if (!KEY_RE.test(key)) throw new Error('LOCK_KEY_INVALID');
}

export class PostgresLockStore implements DistributedLockStore {
  private ready: Promise<void> | null = null;
  constructor(private readonly db: PgQueryable) {}

  private ensure(): Promise<void> {
    if (!this.ready) {
      this.ready = this.db.query(DISTRIBUTED_LOCKS_DDL).then(() => undefined);
      this.ready.catch(() => {
        this.ready = null;
      });
    }
    return this.ready;
  }

  async acquire(key: string, owner: string, ttlMs: number): Promise<boolean> {
    checkKey(key);
    await this.ensure();
    const r = await this.db.query(LOCK_ACQUIRE_SQL, [key, owner, Math.max(1000, Math.floor(ttlMs))]);
    return (r.rows || []).length === 1 && r.rows[0].owner === owner;
  }

  async release(key: string, owner: string): Promise<void> {
    checkKey(key);
    await this.ensure();
    await this.db.query(LOCK_RELEASE_SQL, [key, owner]);
  }

  async peek(key: string): Promise<LockInfo | null> {
    checkKey(key);
    await this.ensure();
    const r = await this.db.query(LOCK_PEEK_SQL, [key]);
    const row = (r.rows || [])[0];
    if (!row) return null;
    return { owner: String(row.owner), acquiredAt: new Date(row.acquired_at).getTime(), expiresAt: new Date(row.expires_at).getTime() };
  }
}

/** Mesmo contrato em memoria. `clock` injetavel nos testes. Atomico (sem await entre ler e gravar). */
export class MemoryLockStore implements DistributedLockStore {
  private readonly rows = new Map<string, LockInfo>();
  constructor(private readonly clock: () => number = () => Date.now()) {}

  async acquire(key: string, owner: string, ttlMs: number): Promise<boolean> {
    checkKey(key);
    const now = this.clock();
    const cur = this.rows.get(key);
    if (cur && cur.expiresAt >= now) return false;
    this.rows.set(key, { owner, acquiredAt: now, expiresAt: now + Math.max(1000, Math.floor(ttlMs)) });
    return true;
  }

  async release(key: string, owner: string): Promise<void> {
    checkKey(key);
    const cur = this.rows.get(key);
    if (cur && cur.owner === owner) this.rows.delete(key);
  }

  async peek(key: string): Promise<LockInfo | null> {
    checkKey(key);
    return this.rows.get(key) || null;
  }
}

let defaultStore: DistributedLockStore | null = null;
let defaultIsPg = false;

/** Postgres quando DATABASE_URL existe; senao memoria (um processo so). */
export function getDefaultLockStore(): DistributedLockStore {
  const wantPg = isPostgresEnabled();
  if (!defaultStore || defaultIsPg !== wantPg) {
    const pool = wantPg ? getPostgresPool() : null;
    defaultStore = pool ? new PostgresLockStore(pool as unknown as PgQueryable) : new MemoryLockStore();
    defaultIsPg = Boolean(pool);
  }
  return defaultStore;
}

export function newLockOwnerId(prefix = 'inst'): string {
  return `${prefix}-${process.pid}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}
