// ============================================================================
// STI-hub — Fase 6: testes A/B e multivariados das campanhas (tabela mkt_experiments).
// Um teste por campanha (os envios sao unicos por campanha+contato). Transicoes de status por
// compare-and-set (UPDATE ... WHERE status = ANY(...)), para dois processos nunca escolherem o
// vencedor nem enviarem ao restante duas vezes.
// ============================================================================
import { getPostgresPool, isPostgresEnabled, type PgQueryable } from '../../db/postgres';
import type { ExperimentDecision } from './ab-stats';

export type ExperimentStatus = 'DRAFT' | 'TESTING' | 'NEEDS_DECISION' | 'WINNER_SELECTED' | 'COMPLETED' | 'CANCELLED';
export type ExperimentMetric = 'HUMAN_CLICK' | 'OPEN_OBSERVED';

export interface ExperimentVariant {
  id: string;
  label: string;
  templateId: string;
  templateVersion: number;
  subjectOverride: string | null;
}

export interface Experiment {
  id: string;
  campaignId: string;
  name: string;
  kind: 'AB' | 'MULTIVARIATE';
  metric: ExperimentMetric;
  purpose: string;
  variants: ExperimentVariant[];
  /** % da audiencia elegivel no teste (o restante recebe o vencedor). 100 = sem envio posterior. */
  testPercent: number;
  alpha: number;
  power: number;
  baselineRate: number;
  baselineSource: string;
  minDetectableLift: number;
  minPerVariant: number;
  winnerMode: 'MANUAL' | 'AUTO';
  minHoursBeforeDecision: number;
  maxTestHours: number;
  sendTimeOptimization: boolean;
  testSendAt: string | null;
  audienceContactIds: string[];
  status: ExperimentStatus;
  testStartedAt: string | null;
  testContacts: number;
  holdoutContactIds: string[];
  blockedAtStart: number;
  winnerVariantId: string | null;
  decisionMode: 'AUTO' | 'MANUAL' | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decision: ExperimentDecision | null;
  rolloutQueued: number;
  rolloutBlocked: number;
  reviewTaskId: string | null;
  lastEvaluatedAt: string | null;
  warnings: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExperimentStore {
  save(e: Experiment): Promise<void>;
  get(id: string): Promise<Experiment | null>;
  getByCampaign(campaignId: string): Promise<Experiment | null>;
  list(): Promise<Experiment[]>;
  listByStatus(statuses: ExperimentStatus[]): Promise<Experiment[]>;
  /** Aplica o patch so se o status atual estiver em `from`. Devolve o registro novo ou null. */
  transition(id: string, from: ExperimentStatus[], patch: Partial<Experiment>): Promise<Experiment | null>;
  delete(id: string): Promise<void>;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export class MemoryExperimentStore implements ExperimentStore {
  items = new Map<string, Experiment>();
  async save(e: Experiment) {
    for (const [id, x] of this.items) if (x.campaignId === e.campaignId && id !== e.id) throw Object.assign(new Error('EXPERIMENT_CAMPAIGN_EXISTS'), { code: '23505' });
    this.items.set(e.id, clone(e));
  }
  async get(id: string) {
    const e = this.items.get(id);
    return e ? clone(e) : null;
  }
  async getByCampaign(campaignId: string) {
    const e = [...this.items.values()].find((x) => x.campaignId === campaignId);
    return e ? clone(e) : null;
  }
  async list() {
    return [...this.items.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(clone);
  }
  async listByStatus(statuses: ExperimentStatus[]) {
    return (await this.list()).filter((e) => statuses.includes(e.status));
  }
  async transition(id: string, from: ExperimentStatus[], patch: Partial<Experiment>) {
    const cur = this.items.get(id);
    if (!cur || !from.includes(cur.status)) return null;
    const next = { ...cur, ...clone(patch), id: cur.id, campaignId: cur.campaignId };
    this.items.set(id, next);
    return clone(next);
  }
  async delete(id: string) {
    this.items.delete(id);
  }
}

export const EXPERIMENT_TABLES_DDL = `
CREATE TABLE IF NOT EXISTS mkt_experiments (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mkt_experiments_status_idx ON mkt_experiments (status);
`;

export class PostgresExperimentStore implements ExperimentStore {
  private ready: Promise<void> | null = null;
  constructor(private readonly pool: PgQueryable) {}
  private async db(): Promise<PgQueryable> {
    if (!this.ready) {
      this.ready = this.pool.query(EXPERIMENT_TABLES_DDL).then(() => undefined);
      this.ready.catch(() => {
        this.ready = null;
      });
    }
    await this.ready;
    return this.pool;
  }
  async save(e: Experiment) {
    await (await this.db()).query(
      `INSERT INTO mkt_experiments (id, campaign_id, status, data, updated_at) VALUES ($1, $2, $3, $4::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, data = EXCLUDED.data, updated_at = now()`,
      [e.id, e.campaignId, e.status, JSON.stringify(e)]
    );
  }
  async get(id: string) {
    const r = await (await this.db()).query(`SELECT data FROM mkt_experiments WHERE id = $1`, [id]);
    return (r.rows[0]?.data as Experiment) || null;
  }
  async getByCampaign(campaignId: string) {
    const r = await (await this.db()).query(`SELECT data FROM mkt_experiments WHERE campaign_id = $1`, [campaignId]);
    return (r.rows[0]?.data as Experiment) || null;
  }
  async list() {
    const r = await (await this.db()).query(`SELECT data FROM mkt_experiments ORDER BY (data->>'createdAt') DESC LIMIT 500`);
    return r.rows.map((x: { data: Experiment }) => x.data);
  }
  async listByStatus(statuses: ExperimentStatus[]) {
    const r = await (await this.db()).query(`SELECT data FROM mkt_experiments WHERE status = ANY($1::text[]) ORDER BY updated_at ASC LIMIT 200`, [statuses]);
    return r.rows.map((x: { data: Experiment }) => x.data);
  }
  async transition(id: string, from: ExperimentStatus[], patch: Partial<Experiment>) {
    const safe = { ...patch } as Record<string, unknown>;
    delete safe.id;
    delete safe.campaignId;
    const r = await (await this.db()).query(
      `UPDATE mkt_experiments SET data = data || $3::jsonb, status = COALESCE($3::jsonb->>'status', status), updated_at = now()
       WHERE id = $1 AND status = ANY($2::text[]) RETURNING data`,
      [id, from, JSON.stringify(safe)]
    );
    return (r.rows[0]?.data as Experiment) || null;
  }
  async delete(id: string) {
    await (await this.db()).query(`DELETE FROM mkt_experiments WHERE id = $1`, [id]);
  }
}

let defaultStore: ExperimentStore | null = null;
export function getDefaultExperimentStore(): ExperimentStore {
  if (!defaultStore) {
    const pool = isPostgresEnabled() ? getPostgresPool() : null;
    defaultStore = pool ? new PostgresExperimentStore(pool as unknown as PgQueryable) : new MemoryExperimentStore();
  }
  return defaultStore;
}
