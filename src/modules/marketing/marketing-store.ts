// ============================================================================
// STI-hub — Fase 3: armazenamento das campanhas de marketing (fora do crm_state_v1).
//   mkt_templates           modelos (status do fluxo de aprovacao, versao aprovada)
//   mkt_template_versions   historico imutavel de versoes
//   mkt_sends               fila/envios: UMA linha por (campanha, contato) => idempotencia
//   mkt_events              eventos do ESP (webhook) com provider_event_id unico
// Sem DATABASE_URL (testes/local): memoria com o mesmo contrato.
// ============================================================================
import { getPostgresPool, isPostgresEnabled, type PgQueryable } from '../../db/postgres';
import type { MarketingPurpose } from './marketing-config';
import type { TemplateBlock } from './template-blocks';

export type MarketingTemplateStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED';

export interface MarketingTemplate {
  id: string;
  name: string;
  purpose: MarketingPurpose;
  status: MarketingTemplateStatus;
  currentVersion: number;
  approvedVersion: number | null;
  createdBy: string;
  updatedBy: string;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MarketingTemplateVersion {
  templateId: string;
  version: number;
  subject: string;
  preheader: string;
  blocks: TemplateBlock[];
  createdBy: string;
  createdAt: string;
}

export type MarketingSendStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'BOUNCED' | 'COMPLAINED' | 'FAILED' | 'SKIPPED';

export interface MarketingSend {
  campaignId: string;
  contactId: string;
  email: string;
  templateId: string;
  templateVersion: number;
  purpose: MarketingPurpose;
  status: MarketingSendStatus;
  reason: string | null;
  attempts: number;
  provider: string | null;
  providerMessageId: string | null;
  trackingId: string | null;
  queuedAt: string;
  nextAttemptAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  bouncedAt: string | null;
  complainedAt: string | null;
  unsubscribedAt: string | null;
  updatedAt: string;
}

export type MarketingEventType = 'SENT' | 'DELIVERED' | 'DELIVERY_DELAYED' | 'BOUNCED_HARD' | 'BOUNCED_SOFT' | 'COMPLAINED' | 'OPENED' | 'CLICKED' | 'UNSUBSCRIBED';

export interface MarketingEvent {
  id: string;
  providerEventId: string;
  campaignId: string | null;
  contactId: string | null;
  type: MarketingEventType;
  at: string;
  detail: string | null;
}

export interface MarketingStore {
  listTemplates(): Promise<MarketingTemplate[]>;
  getTemplate(id: string): Promise<MarketingTemplate | null>;
  saveTemplate(t: MarketingTemplate): Promise<void>;
  insertVersion(v: MarketingTemplateVersion): Promise<void>;
  getVersion(templateId: string, version: number): Promise<MarketingTemplateVersion | null>;
  listVersions(templateId: string): Promise<MarketingTemplateVersion[]>;

  /** Insere so as linhas inexistentes para (campanha, contato). */
  enqueueSends(rows: MarketingSend[]): Promise<{ inserted: number; existing: number }>;
  getSend(campaignId: string, contactId: string): Promise<MarketingSend | null>;
  updateSend(campaignId: string, contactId: string, patch: Partial<MarketingSend>): Promise<void>;
  listDueSends(nowIso: string, limit: number): Promise<MarketingSend[]>;
  listSendsByCampaign(campaignId: string): Promise<MarketingSend[]>;
  findSendByProviderMessageId(id: string): Promise<MarketingSend | null>;
  countSentSince(sinceIso: string): Promise<number>;

  /** false se o provider_event_id ja foi processado (webhook repetido). */
  recordEvent(e: MarketingEvent): Promise<boolean>;
  listEvents(campaignId: string): Promise<MarketingEvent[]>;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export class MemoryMarketingStore implements MarketingStore {
  templates = new Map<string, MarketingTemplate>();
  versions: MarketingTemplateVersion[] = [];
  sends = new Map<string, MarketingSend>();
  events = new Map<string, MarketingEvent>();

  private k(c: string, ct: string) {
    return `${c}\u0000${ct}`;
  }
  async listTemplates() {
    return [...this.templates.values()].map(clone).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async getTemplate(id: string) {
    const t = this.templates.get(id);
    return t ? clone(t) : null;
  }
  async saveTemplate(t: MarketingTemplate) {
    this.templates.set(t.id, clone(t));
  }
  async insertVersion(v: MarketingTemplateVersion) {
    if (this.versions.some((x) => x.templateId === v.templateId && x.version === v.version)) throw new Error('TEMPLATE_VERSION_EXISTS');
    this.versions.push(clone(v));
  }
  async getVersion(templateId: string, version: number) {
    const v = this.versions.find((x) => x.templateId === templateId && x.version === version);
    return v ? clone(v) : null;
  }
  async listVersions(templateId: string) {
    return this.versions.filter((x) => x.templateId === templateId).sort((a, b) => b.version - a.version).map(clone);
  }
  async enqueueSends(rows: MarketingSend[]) {
    let inserted = 0;
    let existing = 0;
    for (const r of rows) {
      const key = this.k(r.campaignId, r.contactId);
      if (this.sends.has(key)) existing++;
      else {
        this.sends.set(key, clone(r));
        inserted++;
      }
    }
    return { inserted, existing };
  }
  async getSend(c: string, ct: string) {
    const s = this.sends.get(this.k(c, ct));
    return s ? clone(s) : null;
  }
  async updateSend(c: string, ct: string, patch: Partial<MarketingSend>) {
    const key = this.k(c, ct);
    const cur = this.sends.get(key);
    if (cur) this.sends.set(key, { ...cur, ...clone(patch), campaignId: cur.campaignId, contactId: cur.contactId });
  }
  async listDueSends(nowIso: string, limit: number) {
    return [...this.sends.values()]
      .filter((s) => s.status === 'QUEUED' && s.nextAttemptAt <= nowIso)
      .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt))
      .slice(0, limit)
      .map(clone);
  }
  async listSendsByCampaign(campaignId: string) {
    return [...this.sends.values()].filter((s) => s.campaignId === campaignId).map(clone);
  }
  async findSendByProviderMessageId(id: string) {
    const s = [...this.sends.values()].find((x) => x.providerMessageId === id);
    return s ? clone(s) : null;
  }
  async countSentSince(sinceIso: string) {
    return [...this.sends.values()].filter((s) => s.sentAt && s.sentAt >= sinceIso).length;
  }
  async recordEvent(e: MarketingEvent) {
    if (this.events.has(e.providerEventId)) return false;
    this.events.set(e.providerEventId, clone(e));
    return true;
  }
  async listEvents(campaignId: string) {
    return [...this.events.values()].filter((e) => e.campaignId === campaignId).map(clone);
  }
}

export const MARKETING_TABLES_DDL = `
CREATE TABLE IF NOT EXISTS mkt_templates (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mkt_template_versions (
  template_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  data JSONB NOT NULL,
  PRIMARY KEY (template_id, version)
);
CREATE TABLE IF NOT EXISTS mkt_sends (
  campaign_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  status TEXT NOT NULL,
  next_attempt_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  provider_message_id TEXT,
  data JSONB NOT NULL,
  PRIMARY KEY (campaign_id, contact_id)
);
CREATE INDEX IF NOT EXISTS mkt_sends_due_idx ON mkt_sends (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS mkt_sends_provider_idx ON mkt_sends (provider_message_id);
CREATE INDEX IF NOT EXISTS mkt_sends_sent_idx ON mkt_sends (sent_at);
CREATE TABLE IF NOT EXISTS mkt_events (
  id TEXT PRIMARY KEY,
  provider_event_id TEXT NOT NULL UNIQUE,
  campaign_id TEXT,
  at TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS mkt_events_campaign_idx ON mkt_events (campaign_id);
`;

export class PostgresMarketingStore implements MarketingStore {
  private ready: Promise<void> | null = null;
  constructor(private readonly pool: PgQueryable) {}
  private async db(): Promise<PgQueryable> {
    if (!this.ready) {
      this.ready = this.pool.query(MARKETING_TABLES_DDL).then(() => undefined);
      this.ready.catch(() => {
        this.ready = null;
      });
    }
    await this.ready;
    return this.pool;
  }
  async listTemplates() {
    const r = await (await this.db()).query(`SELECT data FROM mkt_templates ORDER BY updated_at DESC LIMIT 500`);
    return r.rows.map((x: any) => x.data as MarketingTemplate);
  }
  async getTemplate(id: string) {
    const r = await (await this.db()).query(`SELECT data FROM mkt_templates WHERE id = $1`, [id]);
    return (r.rows[0]?.data as MarketingTemplate) || null;
  }
  async saveTemplate(t: MarketingTemplate) {
    await (await this.db()).query(
      `INSERT INTO mkt_templates (id, data, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [t.id, JSON.stringify(t)]
    );
  }
  async insertVersion(v: MarketingTemplateVersion) {
    await (await this.db()).query(`INSERT INTO mkt_template_versions (template_id, version, data) VALUES ($1, $2, $3::jsonb)`, [v.templateId, v.version, JSON.stringify(v)]);
  }
  async getVersion(templateId: string, version: number) {
    const r = await (await this.db()).query(`SELECT data FROM mkt_template_versions WHERE template_id = $1 AND version = $2`, [templateId, version]);
    return (r.rows[0]?.data as MarketingTemplateVersion) || null;
  }
  async listVersions(templateId: string) {
    const r = await (await this.db()).query(`SELECT data FROM mkt_template_versions WHERE template_id = $1 ORDER BY version DESC LIMIT 200`, [templateId]);
    return r.rows.map((x: any) => x.data as MarketingTemplateVersion);
  }
  async enqueueSends(rows: MarketingSend[]) {
    const db = await this.db();
    let inserted = 0;
    for (const s of rows) {
      const r = await db.query(
        `INSERT INTO mkt_sends (campaign_id, contact_id, status, next_attempt_at, sent_at, provider_message_id, data)
         VALUES ($1, $2, $3, $4, NULL, NULL, $5::jsonb) ON CONFLICT (campaign_id, contact_id) DO NOTHING`,
        [s.campaignId, s.contactId, s.status, s.nextAttemptAt, JSON.stringify(s)]
      );
      inserted += r.rowCount || 0;
    }
    return { inserted, existing: rows.length - inserted };
  }
  async getSend(c: string, ct: string) {
    const r = await (await this.db()).query(`SELECT data FROM mkt_sends WHERE campaign_id = $1 AND contact_id = $2`, [c, ct]);
    return (r.rows[0]?.data as MarketingSend) || null;
  }
  async updateSend(c: string, ct: string, patch: Partial<MarketingSend>) {
    const db = await this.db();
    const cur = await this.getSend(c, ct);
    if (!cur) return;
    const next: MarketingSend = { ...cur, ...patch, campaignId: cur.campaignId, contactId: cur.contactId };
    await db.query(
      `UPDATE mkt_sends SET status = $3, next_attempt_at = $4, sent_at = $5, provider_message_id = $6, data = $7::jsonb
       WHERE campaign_id = $1 AND contact_id = $2`,
      [c, ct, next.status, next.nextAttemptAt, next.sentAt, next.providerMessageId, JSON.stringify(next)]
    );
  }
  async listDueSends(nowIso: string, limit: number) {
    const r = await (await this.db()).query(
      `SELECT data FROM mkt_sends WHERE status = 'QUEUED' AND next_attempt_at <= $1 ORDER BY next_attempt_at ASC LIMIT $2`,
      [nowIso, Math.max(1, Math.min(limit, 2000))]
    );
    return r.rows.map((x: any) => x.data as MarketingSend);
  }
  async listSendsByCampaign(campaignId: string) {
    const r = await (await this.db()).query(`SELECT data FROM mkt_sends WHERE campaign_id = $1 LIMIT 50000`, [campaignId]);
    return r.rows.map((x: any) => x.data as MarketingSend);
  }
  async findSendByProviderMessageId(id: string) {
    const r = await (await this.db()).query(`SELECT data FROM mkt_sends WHERE provider_message_id = $1 LIMIT 1`, [id]);
    return (r.rows[0]?.data as MarketingSend) || null;
  }
  async countSentSince(sinceIso: string) {
    const r = await (await this.db()).query(`SELECT count(*)::int AS n FROM mkt_sends WHERE sent_at >= $1`, [sinceIso]);
    return Number(r.rows[0]?.n || 0);
  }
  async recordEvent(e: MarketingEvent) {
    const r = await (await this.db()).query(
      `INSERT INTO mkt_events (id, provider_event_id, campaign_id, at, data) VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (provider_event_id) DO NOTHING`,
      [e.id, e.providerEventId, e.campaignId, e.at, JSON.stringify(e)]
    );
    return (r.rowCount || 0) > 0;
  }
  async listEvents(campaignId: string) {
    const r = await (await this.db()).query(`SELECT data FROM mkt_events WHERE campaign_id = $1 ORDER BY at ASC LIMIT 100000`, [campaignId]);
    return r.rows.map((x: any) => x.data as MarketingEvent);
  }
}

let defaultStore: MarketingStore | null = null;
export function getDefaultMarketingStore(): MarketingStore {
  if (!defaultStore) {
    const pool = isPostgresEnabled() ? getPostgresPool() : null;
    defaultStore = pool ? new PostgresMarketingStore(pool as unknown as PgQueryable) : new MemoryMarketingStore();
  }
  return defaultStore;
}
