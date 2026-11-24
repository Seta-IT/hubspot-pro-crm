// ============================================================================
// STI-hub — Fase 5: sinais de engajamento classificados (tabela crm_engagement_signals, fora do
// crm_state_v1). Um registro por abertura/clique rastreado, com classificacao e motivo.
// IP so a rede truncada (/24 ou /48). Sem DATABASE_URL: memoria com o mesmo contrato.
// ============================================================================
import { getPostgresPool, isPostgresEnabled, type PgQueryable } from '../../db/postgres';
import type { SignalClass, SignalKind } from './signal-classifier';

export type SignalSource = 'TRACKING' | 'ESP';

export interface EngagementSignal {
  id: string;
  source: SignalSource;
  kind: SignalKind;
  classification: SignalClass;
  reasons: string[];
  at: string;
  trackingId: string | null;
  contactId: string | null;
  campaignId: string | null;
  /** Origem da mensagem: CRM (caixa), cadencia, campanha. */
  messageSource: string | null;
  url: string | null;
  linkIndex: number | null;
  uaFamily: string;
  ipNetwork: string | null;
  secondsSinceSent: number | null;
}

export interface SignalStore {
  record(s: EngagementSignal): Promise<boolean>;
  listSince(fromIso: string, toIso: string, limit: number): Promise<EngagementSignal[]>;
  listByTracking(trackingIds: string[]): Promise<EngagementSignal[]>;
  listByContact(contactId: string, limit: number): Promise<EngagementSignal[]>;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
export const SIGNAL_LIST_MAX = 50000;

export class MemorySignalStore implements SignalStore {
  rows = new Map<string, EngagementSignal>();
  async record(s: EngagementSignal) {
    if (this.rows.has(s.id)) return false;
    this.rows.set(s.id, clone(s));
    return true;
  }
  async listSince(fromIso: string, toIso: string, limit: number) {
    return [...this.rows.values()]
      .filter((s) => s.at >= fromIso && s.at <= toIso)
      .sort((a, b) => a.at.localeCompare(b.at))
      .slice(0, Math.min(limit, SIGNAL_LIST_MAX))
      .map(clone);
  }
  async listByTracking(ids: string[]) {
    const set = new Set(ids);
    return [...this.rows.values()].filter((s) => s.trackingId && set.has(s.trackingId)).sort((a, b) => a.at.localeCompare(b.at)).map(clone);
  }
  async listByContact(contactId: string, limit: number) {
    return [...this.rows.values()].filter((s) => s.contactId === contactId).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit).map(clone);
  }
}

export const SIGNAL_TABLES_DDL = `
CREATE TABLE IF NOT EXISTS crm_engagement_signals (
  id TEXT PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL,
  kind TEXT NOT NULL,
  classification TEXT NOT NULL,
  tracking_id TEXT,
  contact_id TEXT,
  data JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS crm_engagement_signals_at_idx ON crm_engagement_signals (at);
CREATE INDEX IF NOT EXISTS crm_engagement_signals_tracking_idx ON crm_engagement_signals (tracking_id);
CREATE INDEX IF NOT EXISTS crm_engagement_signals_contact_idx ON crm_engagement_signals (contact_id, at);
`;

export class PostgresSignalStore implements SignalStore {
  private ready: Promise<void> | null = null;
  constructor(private readonly pool: PgQueryable) {}
  private async db(): Promise<PgQueryable> {
    if (!this.ready) {
      this.ready = this.pool.query(SIGNAL_TABLES_DDL).then(() => undefined);
      this.ready.catch(() => {
        this.ready = null;
      });
    }
    await this.ready;
    return this.pool;
  }
  async record(s: EngagementSignal) {
    const r = await (await this.db()).query(
      `INSERT INTO crm_engagement_signals (id, at, kind, classification, tracking_id, contact_id, data)
       VALUES ($1, $2::timestamptz, $3, $4, $5, $6, $7::jsonb) ON CONFLICT (id) DO NOTHING`,
      [s.id, s.at, s.kind, s.classification, s.trackingId, s.contactId, JSON.stringify(s)]
    );
    return (r.rowCount ?? 0) > 0;
  }
  async listSince(fromIso: string, toIso: string, limit: number) {
    const r = await (await this.db()).query(
      `SELECT data FROM crm_engagement_signals WHERE at >= $1::timestamptz AND at <= $2::timestamptz ORDER BY at ASC LIMIT $3::int`,
      [fromIso, toIso, Math.max(1, Math.min(limit, SIGNAL_LIST_MAX))]
    );
    return r.rows.map((x: { data: EngagementSignal }) => x.data);
  }
  async listByTracking(ids: string[]) {
    if (!ids.length) return [];
    const r = await (await this.db()).query(`SELECT data FROM crm_engagement_signals WHERE tracking_id = ANY($1::text[]) ORDER BY at ASC`, [ids.slice(0, 5000)]);
    return r.rows.map((x: { data: EngagementSignal }) => x.data);
  }
  async listByContact(contactId: string, limit: number) {
    const r = await (await this.db()).query(
      `SELECT data FROM crm_engagement_signals WHERE contact_id = $1 ORDER BY at DESC LIMIT $2::int`,
      [contactId, Math.max(1, Math.min(limit, 1000))]
    );
    return r.rows.map((x: { data: EngagementSignal }) => x.data);
  }
}

let defaultStore: SignalStore | null = null;
export function getDefaultSignalStore(): SignalStore {
  if (!defaultStore) {
    const pool = isPostgresEnabled() ? getPostgresPool() : null;
    defaultStore = pool ? new PostgresSignalStore(pool as unknown as PgQueryable) : new MemorySignalStore();
  }
  return defaultStore;
}
