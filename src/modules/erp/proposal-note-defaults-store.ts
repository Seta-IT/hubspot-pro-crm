// Tabela própria erp_proposal_note_defaults (fora do snapshot crm_state_v1).
// Migração aditiva: CREATE TABLE IF NOT EXISTS + seed ON CONFLICT DO NOTHING.
import { ensurePostgresSchema, getPostgresPool, isPostgresEnabled, type PgQueryable } from '../../db/postgres';
import {
  COMMERCIAL_NOTES_DEFAULT_MAX_LEN,
  PROPOSAL_NOTE_DEFAULT_TYPE_KEYS,
  mergeProposalNoteDefaults,
  sanitizeCommercialNotesDefault,
  seedProposalNoteDefaults,
  type ProposalNoteDefaultTypeKey,
  type ProposalNoteDefaultsMap,
} from '../../app/lib/proposal-note-defaults';

export const ERP_PROPOSAL_NOTE_DEFAULTS_TABLE = 'erp_proposal_note_defaults';

export interface ProposalNoteDefaultsStore {
  list(): Promise<ProposalNoteDefaultsMap>;
  save(patch: Partial<ProposalNoteDefaultsMap>, updatedBy?: string | null): Promise<ProposalNoteDefaultsMap>;
}

export const ERP_PROPOSAL_NOTE_DEFAULTS_SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS erp_proposal_note_defaults (
      type_key TEXT PRIMARY KEY,
      commercial_notes TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT
    );
`;

export async function ensureProposalNoteDefaultsSchema(executor: PgQueryable): Promise<void> {
  await executor.query(ERP_PROPOSAL_NOTE_DEFAULTS_SCHEMA_SQL);
  const seed = seedProposalNoteDefaults();
  for (const typeKey of PROPOSAL_NOTE_DEFAULT_TYPE_KEYS) {
    await executor.query(
      `INSERT INTO erp_proposal_note_defaults (type_key, commercial_notes)
       VALUES ($1, $2)
       ON CONFLICT (type_key) DO NOTHING`,
      [typeKey, seed[typeKey]]
    );
  }
}

function cloneMap(map: ProposalNoteDefaultsMap): ProposalNoteDefaultsMap {
  return { ...map };
}

export class MemoryProposalNoteDefaultsStore implements ProposalNoteDefaultsStore {
  private map: ProposalNoteDefaultsMap;

  constructor(initial?: Partial<ProposalNoteDefaultsMap>) {
    this.map = mergeProposalNoteDefaults(initial);
  }

  async list(): Promise<ProposalNoteDefaultsMap> {
    return cloneMap(this.map);
  }

  async save(patch: Partial<ProposalNoteDefaultsMap>): Promise<ProposalNoteDefaultsMap> {
    this.map = mergeProposalNoteDefaults({ ...this.map, ...normalizePatch(patch) });
    return cloneMap(this.map);
  }
}

export class PostgresProposalNoteDefaultsStore implements ProposalNoteDefaultsStore {
  private async db(): Promise<PgQueryable> {
    const pool = getPostgresPool();
    if (!pool) throw new Error('Postgres indisponível para observações padrão da proposta');
    await ensurePostgresSchema(pool);
    await ensureProposalNoteDefaultsSchema(pool);
    return pool;
  }

  async list(): Promise<ProposalNoteDefaultsMap> {
    const db = await this.db();
    const r = await db.query(`SELECT type_key, commercial_notes FROM erp_proposal_note_defaults`);
    const incoming: Partial<ProposalNoteDefaultsMap> = {};
    for (const row of r.rows as Array<{ type_key: string; commercial_notes: string }>) {
      if (PROPOSAL_NOTE_DEFAULT_TYPE_KEYS.includes(row.type_key as ProposalNoteDefaultTypeKey)) {
        incoming[row.type_key as ProposalNoteDefaultTypeKey] = String(row.commercial_notes ?? '');
      }
    }
    return mergeProposalNoteDefaults(incoming);
  }

  async save(patch: Partial<ProposalNoteDefaultsMap>, updatedBy?: string | null): Promise<ProposalNoteDefaultsMap> {
    const db = await this.db();
    const clean = normalizePatch(patch);
    const actor = updatedBy ? String(updatedBy).slice(0, 200) : null;
    for (const typeKey of PROPOSAL_NOTE_DEFAULT_TYPE_KEYS) {
      if (clean[typeKey] === undefined) continue;
      await db.query(
        `INSERT INTO erp_proposal_note_defaults (type_key, commercial_notes, updated_at, updated_by)
         VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (type_key) DO UPDATE SET
           commercial_notes = EXCLUDED.commercial_notes,
           updated_at = EXCLUDED.updated_at,
           updated_by = EXCLUDED.updated_by`,
        [typeKey, clean[typeKey], actor]
      );
    }
    return this.list();
  }
}

function normalizePatch(patch: Partial<ProposalNoteDefaultsMap>): Partial<ProposalNoteDefaultsMap> {
  const out: Partial<ProposalNoteDefaultsMap> = {};
  for (const key of PROPOSAL_NOTE_DEFAULT_TYPE_KEYS) {
    if (patch[key] === undefined || patch[key] === null) continue;
    const text = sanitizeCommercialNotesDefault(patch[key]);
    if (text.length > COMMERCIAL_NOTES_DEFAULT_MAX_LEN) {
      throw Object.assign(
        new Error(`O texto de ${key} pode ter no máximo ${COMMERCIAL_NOTES_DEFAULT_MAX_LEN} caracteres.`),
        { code: 'PROPOSAL_NOTE_DEFAULT_TOO_LONG' }
      );
    }
    out[key] = text;
  }
  return out;
}

let defaultStore: ProposalNoteDefaultsStore | null = null;

export function getDefaultProposalNoteDefaultsStore(): ProposalNoteDefaultsStore {
  if (!defaultStore) {
    defaultStore = isPostgresEnabled()
      ? new PostgresProposalNoteDefaultsStore()
      : new MemoryProposalNoteDefaultsStore();
  }
  return defaultStore;
}

export function resetDefaultProposalNoteDefaultsStore(store?: ProposalNoteDefaultsStore): ProposalNoteDefaultsStore {
  defaultStore = store || new MemoryProposalNoteDefaultsStore();
  return defaultStore;
}

export async function loadProposalNoteDefaults(
  store: ProposalNoteDefaultsStore = getDefaultProposalNoteDefaultsStore()
): Promise<ProposalNoteDefaultsMap> {
  try {
    return await store.list();
  } catch {
    return seedProposalNoteDefaults();
  }
}
