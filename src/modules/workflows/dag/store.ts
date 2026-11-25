// ============================================================================
// STI-hub — Fase 4: armazenamento duravel das automacoes (fora do crm_state_v1).
//   wf_definitions  fluxo (rascunho atual, versao ativa, ultima simulacao)
//   wf_versions     historico imutavel do grafo (cada execucao usa a versao em que comecou)
//   wf_events       caixa de entrada de eventos (id unico = deduplicacao)
//   wf_runs         execucao por contato; UNIQUE (workflow_id, trigger_event_id) = idempotencia
//   wf_run_steps    historico por no; PK (run_id, node_id) = reserva antes de executar a acao
// Sem DATABASE_URL (testes/local): memoria com o mesmo contrato.
// ============================================================================
import { getPostgresPool, isPostgresEnabled, type PgQueryable } from '../../../db/postgres';
import type { WfTriggerType } from './catalog';
import type { WfGraph } from './graph';
import { runGuardedDdl } from '../../../db/schema-guard';

export type WfStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED';

export interface WfDefinition {
  id: string;
  name: string;
  description: string;
  status: WfStatus;
  version: number;
  activeVersion: number | null;
  graph: WfGraph;
  lastSimulation: { version: number; contactId: string; at: string; ok: boolean } | null;
  createdBy: string;
  updatedBy: string;
  activatedBy: string | null;
  activatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WfVersion {
  workflowId: string;
  version: number;
  graph: WfGraph;
  createdBy: string;
  createdAt: string;
}

export interface WfEvent {
  id: string;
  type: WfTriggerType;
  contactId: string;
  context: Record<string, unknown>;
  at: string;
  status: 'PENDING' | 'PROCESSED';
  processedAt: string | null;
  /** Fluxo que originou (acao de reativacao), para limitar a profundidade. */
  depth: number;
  /** So para este fluxo (reativacao); null = todos os fluxos ativos do gatilho. */
  targetWorkflowId: string | null;
}

export type WfRunStatus = 'ACTIVE' | 'WAITING' | 'COMPLETED' | 'EXITED' | 'FAILED' | 'NEEDS_REVIEW';

export interface WfRun {
  id: string;
  workflowId: string;
  workflowName: string;
  version: number;
  contactId: string;
  status: WfRunStatus;
  currentNodeId: string | null;
  wakeAt: string;
  waitStartedAt: string | null;
  triggerEventId: string;
  triggerType: WfTriggerType;
  depth: number;
  variants: Record<string, string>;
  lastError: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type WfStepOutcome = 'STARTED' | 'DONE' | 'SKIPPED' | 'BLOCKED' | 'FAILED' | 'WAITING';

export interface WfStep {
  runId: string;
  nodeId: string;
  seq: number;
  kind: string;
  action: string | null;
  outcome: WfStepOutcome;
  message: string;
  port: string | null;
  at: string;
  finishedAt: string | null;
}

export interface WorkflowStore {
  listDefinitions(): Promise<WfDefinition[]>;
  getDefinition(id: string): Promise<WfDefinition | null>;
  saveDefinition(d: WfDefinition): Promise<void>;
  insertVersion(v: WfVersion): Promise<void>;
  getVersion(workflowId: string, version: number): Promise<WfVersion | null>;
  listVersions(workflowId: string): Promise<WfVersion[]>;

  /** false se o id do evento ja existe (deduplicacao). */
  recordEvent(e: WfEvent): Promise<boolean>;
  listPendingEvents(limit: number): Promise<WfEvent[]>;
  markEventProcessed(id: string, atIso: string): Promise<void>;

  /** false se ja existe execucao deste fluxo para este evento. */
  createRun(r: WfRun): Promise<boolean>;
  getRun(id: string): Promise<WfRun | null>;
  updateRun(id: string, patch: Partial<WfRun>): Promise<void>;
  listDueRuns(nowIso: string, limit: number): Promise<WfRun[]>;
  listRunsByContact(contactId: string, limit: number): Promise<WfRun[]>;
  listRunsByWorkflow(workflowId: string, limit: number): Promise<WfRun[]>;
  /** Execucoes do fluxo para o contato, mais recente primeiro. */
  listRunsFor(workflowId: string, contactId: string): Promise<WfRun[]>;

  /** Reserva do no (antes de executar). false = ja existia (nunca executa de novo). */
  claimStep(s: WfStep): Promise<boolean>;
  finishStep(runId: string, nodeId: string, patch: Partial<WfStep>): Promise<void>;
  getStep(runId: string, nodeId: string): Promise<WfStep | null>;
  listSteps(runId: string): Promise<WfStep[]>;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export class MemoryWorkflowStore implements WorkflowStore {
  defs = new Map<string, WfDefinition>();
  versions: WfVersion[] = [];
  events = new Map<string, WfEvent>();
  runs = new Map<string, WfRun>();
  steps = new Map<string, WfStep>();

  async listDefinitions() {
    return [...this.defs.values()].map(clone).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async getDefinition(id: string) {
    const d = this.defs.get(id);
    return d ? clone(d) : null;
  }
  async saveDefinition(d: WfDefinition) {
    this.defs.set(d.id, clone(d));
  }
  async insertVersion(v: WfVersion) {
    if (this.versions.some((x) => x.workflowId === v.workflowId && x.version === v.version)) throw new Error('WF_VERSION_EXISTS');
    this.versions.push(clone(v));
  }
  async getVersion(workflowId: string, version: number) {
    const v = this.versions.find((x) => x.workflowId === workflowId && x.version === version);
    return v ? clone(v) : null;
  }
  async listVersions(workflowId: string) {
    return this.versions.filter((x) => x.workflowId === workflowId).sort((a, b) => b.version - a.version).map(clone);
  }
  async recordEvent(e: WfEvent) {
    if (this.events.has(e.id)) return false;
    this.events.set(e.id, clone(e));
    return true;
  }
  async listPendingEvents(limit: number) {
    return [...this.events.values()].filter((e) => e.status === 'PENDING').sort((a, b) => a.at.localeCompare(b.at)).slice(0, limit).map(clone);
  }
  async markEventProcessed(id: string, atIso: string) {
    const e = this.events.get(id);
    if (e) this.events.set(id, { ...e, status: 'PROCESSED', processedAt: atIso });
  }
  async createRun(r: WfRun) {
    if ([...this.runs.values()].some((x) => x.workflowId === r.workflowId && x.triggerEventId === r.triggerEventId)) return false;
    this.runs.set(r.id, clone(r));
    return true;
  }
  async getRun(id: string) {
    const r = this.runs.get(id);
    return r ? clone(r) : null;
  }
  async updateRun(id: string, patch: Partial<WfRun>) {
    const r = this.runs.get(id);
    if (r) this.runs.set(id, { ...r, ...clone(patch), id: r.id });
  }
  async listDueRuns(nowIso: string, limit: number) {
    return [...this.runs.values()]
      .filter((r) => (r.status === 'ACTIVE' || r.status === 'WAITING') && r.wakeAt <= nowIso)
      .sort((a, b) => a.wakeAt.localeCompare(b.wakeAt))
      .slice(0, limit)
      .map(clone);
  }
  async listRunsByContact(contactId: string, limit: number) {
    return [...this.runs.values()].filter((r) => r.contactId === contactId).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit).map(clone);
  }
  async listRunsByWorkflow(workflowId: string, limit: number) {
    return [...this.runs.values()].filter((r) => r.workflowId === workflowId).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit).map(clone);
  }
  async listRunsFor(workflowId: string, contactId: string) {
    return [...this.runs.values()].filter((r) => r.workflowId === workflowId && r.contactId === contactId).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map(clone);
  }
  private sk(runId: string, nodeId: string) {
    return `${runId}\u0000${nodeId}`;
  }
  async claimStep(s: WfStep) {
    const k = this.sk(s.runId, s.nodeId);
    if (this.steps.has(k)) return false;
    this.steps.set(k, clone(s));
    return true;
  }
  async finishStep(runId: string, nodeId: string, patch: Partial<WfStep>) {
    const k = this.sk(runId, nodeId);
    const s = this.steps.get(k);
    if (s) this.steps.set(k, { ...s, ...clone(patch), runId: s.runId, nodeId: s.nodeId });
  }
  async getStep(runId: string, nodeId: string) {
    const s = this.steps.get(this.sk(runId, nodeId));
    return s ? clone(s) : null;
  }
  async listSteps(runId: string) {
    return [...this.steps.values()].filter((s) => s.runId === runId).sort((a, b) => a.seq - b.seq).map(clone);
  }
}

export const WORKFLOW_TABLES_DDL = `
CREATE TABLE IF NOT EXISTS wf_definitions (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wf_versions (
  workflow_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  data JSONB NOT NULL,
  PRIMARY KEY (workflow_id, version)
);
CREATE TABLE IF NOT EXISTS wf_events (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS wf_events_pending_idx ON wf_events (status, at);
CREATE TABLE IF NOT EXISTS wf_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  status TEXT NOT NULL,
  wake_at TIMESTAMPTZ NOT NULL,
  trigger_event_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL,
  UNIQUE (workflow_id, trigger_event_id)
);
CREATE INDEX IF NOT EXISTS wf_runs_due_idx ON wf_runs (status, wake_at);
CREATE INDEX IF NOT EXISTS wf_runs_contact_idx ON wf_runs (contact_id, started_at);
CREATE INDEX IF NOT EXISTS wf_runs_workflow_idx ON wf_runs (workflow_id, contact_id, started_at);
CREATE TABLE IF NOT EXISTS wf_run_steps (
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  data JSONB NOT NULL,
  PRIMARY KEY (run_id, node_id)
);
`;

export class PostgresWorkflowStore implements WorkflowStore {
  private ready: Promise<void> | null = null;
  constructor(private readonly pool: PgQueryable) {}
  private async db(): Promise<PgQueryable> {
    if (!this.ready) {
      this.ready = runGuardedDdl(this.pool, WORKFLOW_TABLES_DDL).then(() => undefined);
      this.ready.catch(() => {
        this.ready = null;
      });
    }
    await this.ready;
    return this.pool;
  }
  private rows<T>(r: { rows: any[] }): T[] {
    return r.rows.map((x) => x.data as T);
  }
  async listDefinitions() {
    return this.rows<WfDefinition>(await (await this.db()).query(`SELECT data FROM wf_definitions ORDER BY updated_at DESC LIMIT 500`));
  }
  async getDefinition(id: string) {
    return this.rows<WfDefinition>(await (await this.db()).query(`SELECT data FROM wf_definitions WHERE id = $1`, [id]))[0] || null;
  }
  async saveDefinition(d: WfDefinition) {
    await (await this.db()).query(
      `INSERT INTO wf_definitions (id, data, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [d.id, JSON.stringify(d)]
    );
  }
  async insertVersion(v: WfVersion) {
    await (await this.db()).query(`INSERT INTO wf_versions (workflow_id, version, data) VALUES ($1, $2::int, $3::jsonb)`, [v.workflowId, v.version, JSON.stringify(v)]);
  }
  async getVersion(workflowId: string, version: number) {
    return this.rows<WfVersion>(await (await this.db()).query(`SELECT data FROM wf_versions WHERE workflow_id = $1 AND version = $2::int`, [workflowId, version]))[0] || null;
  }
  async listVersions(workflowId: string) {
    return this.rows<WfVersion>(await (await this.db()).query(`SELECT data FROM wf_versions WHERE workflow_id = $1 ORDER BY version DESC LIMIT 200`, [workflowId]));
  }
  async recordEvent(e: WfEvent) {
    const r = await (await this.db()).query(
      `INSERT INTO wf_events (id, status, at, data) VALUES ($1, $2, $3::timestamptz, $4::jsonb) ON CONFLICT (id) DO NOTHING`,
      [e.id, e.status, e.at, JSON.stringify(e)]
    );
    return (r.rowCount || 0) > 0;
  }
  async listPendingEvents(limit: number) {
    return this.rows<WfEvent>(
      await (await this.db()).query(`SELECT data FROM wf_events WHERE status = 'PENDING' ORDER BY at ASC LIMIT $1::int`, [Math.max(1, Math.min(limit, 5000))])
    );
  }
  async markEventProcessed(id: string, atIso: string) {
    await (await this.db()).query(
      `UPDATE wf_events SET status = 'PROCESSED', data = jsonb_set(jsonb_set(data, '{status}', '"PROCESSED"'), '{processedAt}', to_jsonb($2::text)) WHERE id = $1`,
      [id, atIso]
    );
  }
  async createRun(r: WfRun) {
    const res = await (await this.db()).query(
      `INSERT INTO wf_runs (id, workflow_id, contact_id, status, wake_at, trigger_event_id, started_at, data)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7::timestamptz, $8::jsonb) ON CONFLICT DO NOTHING`,
      [r.id, r.workflowId, r.contactId, r.status, r.wakeAt, r.triggerEventId, r.startedAt, JSON.stringify(r)]
    );
    return (res.rowCount || 0) > 0;
  }
  async getRun(id: string) {
    return this.rows<WfRun>(await (await this.db()).query(`SELECT data FROM wf_runs WHERE id = $1`, [id]))[0] || null;
  }
  async updateRun(id: string, patch: Partial<WfRun>) {
    const cur = await this.getRun(id);
    if (!cur) return;
    const next: WfRun = { ...cur, ...patch, id: cur.id };
    await (await this.db()).query(`UPDATE wf_runs SET status = $2, wake_at = $3::timestamptz, data = $4::jsonb WHERE id = $1`, [id, next.status, next.wakeAt, JSON.stringify(next)]);
  }
  async listDueRuns(nowIso: string, limit: number) {
    return this.rows<WfRun>(
      await (await this.db()).query(
        `SELECT data FROM wf_runs WHERE status IN ('ACTIVE', 'WAITING') AND wake_at <= $1::timestamptz ORDER BY wake_at ASC LIMIT $2::int`,
        [nowIso, Math.max(1, Math.min(limit, 5000))]
      )
    );
  }
  async listRunsByContact(contactId: string, limit: number) {
    return this.rows<WfRun>(
      await (await this.db()).query(`SELECT data FROM wf_runs WHERE contact_id = $1 ORDER BY started_at DESC LIMIT $2::int`, [contactId, Math.max(1, Math.min(limit, 1000))])
    );
  }
  async listRunsByWorkflow(workflowId: string, limit: number) {
    return this.rows<WfRun>(
      await (await this.db()).query(`SELECT data FROM wf_runs WHERE workflow_id = $1 ORDER BY started_at DESC LIMIT $2::int`, [workflowId, Math.max(1, Math.min(limit, 5000))])
    );
  }
  async listRunsFor(workflowId: string, contactId: string) {
    return this.rows<WfRun>(
      await (await this.db()).query(`SELECT data FROM wf_runs WHERE workflow_id = $1 AND contact_id = $2 ORDER BY started_at DESC LIMIT 200`, [workflowId, contactId])
    );
  }
  async claimStep(s: WfStep) {
    const r = await (await this.db()).query(
      `INSERT INTO wf_run_steps (run_id, node_id, seq, outcome, data) VALUES ($1, $2, $3::int, $4, $5::jsonb) ON CONFLICT (run_id, node_id) DO NOTHING`,
      [s.runId, s.nodeId, s.seq, s.outcome, JSON.stringify(s)]
    );
    return (r.rowCount || 0) > 0;
  }
  async finishStep(runId: string, nodeId: string, patch: Partial<WfStep>) {
    const cur = await this.getStep(runId, nodeId);
    if (!cur) return;
    const next: WfStep = { ...cur, ...patch, runId: cur.runId, nodeId: cur.nodeId };
    await (await this.db()).query(`UPDATE wf_run_steps SET outcome = $3, data = $4::jsonb WHERE run_id = $1 AND node_id = $2`, [runId, nodeId, next.outcome, JSON.stringify(next)]);
  }
  async getStep(runId: string, nodeId: string) {
    return this.rows<WfStep>(await (await this.db()).query(`SELECT data FROM wf_run_steps WHERE run_id = $1 AND node_id = $2`, [runId, nodeId]))[0] || null;
  }
  async listSteps(runId: string) {
    return this.rows<WfStep>(await (await this.db()).query(`SELECT data FROM wf_run_steps WHERE run_id = $1 ORDER BY seq ASC`, [runId]));
  }
}

let defaultStore: WorkflowStore | null = null;
export function getDefaultWorkflowStore(): WorkflowStore {
  if (!defaultStore) {
    const pool = isPostgresEnabled() ? getPostgresPool() : null;
    defaultStore = pool ? new PostgresWorkflowStore(pool as unknown as PgQueryable) : new MemoryWorkflowStore();
  }
  return defaultStore;
}
