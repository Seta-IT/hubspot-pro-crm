// ============================================================================
// STI-hub — Centros de custo e planos de contas no banco (Neon/Postgres).
// Tabela propria erp_aux_list_items, fora do snapshot crm_state_v1.
// Sem banco local: MemoryAuxListsStore com o seed atual (fallback).
// Produção: a tabela e o seed entram em ensureErpAuxListsSchema (db:migrate).
// ============================================================================
import { randomBytes } from 'node:crypto';
import { ensurePostgresSchema, getPostgresPool, isPostgresEnabled, type PgQueryable } from '../../db/postgres';
import { DEFAULT_CONTRACT_AUX_OPTIONS } from '../../app/lib/contract-billing-utils';
import { normalizeAuxLabel } from './aux-option-usage';
import { runGuardedDdl } from '../../db/schema-guard';
import {
  CONTACT_DEPARTMENT_KIND,
  CONTACT_POSITION_KIND,
  DEFAULT_CONTACT_DEPARTMENTS,
  DEFAULT_CONTACT_POSITIONS,
} from '../../app/lib/contact-field-lists';

export const AUX_LIST_KINDS = ['costCenters', 'chartOfAccountsList', CONTACT_POSITION_KIND, CONTACT_DEPARTMENT_KIND] as const;
export type AuxListKind = (typeof AUX_LIST_KINDS)[number];

export interface AuxListItem {
  id: string;
  kind: AuxListKind;
  label: string;
  sortOrder: number;
  active: boolean;
}

export type AuxListPatch = { label?: string; active?: boolean; sortOrder?: number };

export const ERP_AUX_LISTS_TABLE = 'erp_aux_list_items';

export function isAuxListKind(value: unknown): value is AuxListKind {
  return AUX_LIST_KINDS.includes(String(value) as AuxListKind);
}

const AUX_ID_PREFIX: Record<AuxListKind, string> = {
  costCenters: 'cc',
  chartOfAccountsList: 'coa',
  contactPosition: 'pos',
  contactDepartment: 'area',
};

export function seedItemsForKind(kind: AuxListKind): AuxListItem[] {
  const labels =
    kind === 'costCenters'
      ? DEFAULT_CONTRACT_AUX_OPTIONS.costCenters
      : kind === 'chartOfAccountsList'
        ? DEFAULT_CONTRACT_AUX_OPTIONS.chartOfAccountsList
        : kind === CONTACT_POSITION_KIND
          ? [...DEFAULT_CONTACT_POSITIONS]
          : [...DEFAULT_CONTACT_DEPARTMENTS];
  return labels.map((label, i) => ({
    id: stableAuxId(kind, label),
    kind,
    label,
    sortOrder: i,
    active: true,
  }));
}

export function seedAuxListItems(): AuxListItem[] {
  return AUX_LIST_KINDS.flatMap((kind) => seedItemsForKind(kind));
}

export function stableAuxId(kind: AuxListKind, label: string): string {
  const prefix = AUX_ID_PREFIX[kind];
  const slug = normalizeAuxLabel(label)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return `${prefix}-${slug || 'item'}`;
}

export function newAuxListId(kind: AuxListKind): string {
  const prefix = AUX_ID_PREFIX[kind];
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
}

export function sanitizeAuxLabel(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export const AUX_LABEL_MAX_LEN = 120;

export interface AuxListsStore {
  list(kind?: AuxListKind, opts?: { includeInactive?: boolean }): Promise<AuxListItem[]>;
  create(kind: AuxListKind, label: string): Promise<AuxListItem>;
  update(id: string, patch: string | AuxListPatch): Promise<AuxListItem | null>;
  delete(id: string): Promise<AuxListItem | null>;
  reorder(kind: AuxListKind, ids: string[]): Promise<AuxListItem[]>;
}

export function normalizeAuxPatch(patch: string | AuxListPatch): AuxListPatch {
  return typeof patch === 'string' ? { label: patch } : patch || {};
}

function cloneItems(items: AuxListItem[]): AuxListItem[] {
  return items.map((item) => ({ ...item }));
}

function sortItems(items: AuxListItem[]): AuxListItem[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'pt-BR'));
}

export class MemoryAuxListsStore implements AuxListsStore {
  private items: AuxListItem[];

  constructor(initial?: AuxListItem[]) {
    this.items = cloneItems(initial ?? seedAuxListItems());
  }

  async list(kind?: AuxListKind, opts?: { includeInactive?: boolean }): Promise<AuxListItem[]> {
    let rows = kind ? this.items.filter((i) => i.kind === kind) : this.items;
    if (opts?.includeInactive === false) rows = rows.filter((i) => i.active !== false);
    return sortItems(cloneItems(rows));
  }

  async create(kind: AuxListKind, label: string): Promise<AuxListItem> {
    const clean = sanitizeAuxLabel(label);
    if (!clean) throw Object.assign(new Error('Informe o nome do item.'), { code: 'AUX_LIST_LABEL_REQUIRED' });
    if (clean.length > AUX_LABEL_MAX_LEN) throw Object.assign(new Error(`O nome pode ter no máximo ${AUX_LABEL_MAX_LEN} caracteres.`), { code: 'AUX_LIST_LABEL_INVALID' });
    if (this.items.some((i) => i.kind === kind && normalizeAuxLabel(i.label) === normalizeAuxLabel(clean))) {
      throw Object.assign(new Error('Já existe um item com esse nome nesta lista.'), { code: 'AUX_LIST_DUPLICATE' });
    }
    const kindItems = this.items.filter((i) => i.kind === kind);
    const item: AuxListItem = {
      id: newAuxListId(kind),
      kind,
      label: clean,
      sortOrder: kindItems.length ? Math.max(...kindItems.map((i) => i.sortOrder)) + 1 : 0,
      active: true,
    };
    this.items.push(item);
    return { ...item };
  }

  async update(id: string, patch: string | AuxListPatch): Promise<AuxListItem | null> {
    const current = this.items.find((i) => i.id === id);
    if (!current) return null;
    const next = normalizeAuxPatch(patch);
    if (next.label !== undefined) {
      const clean = sanitizeAuxLabel(next.label);
      if (!clean) throw Object.assign(new Error('Informe o nome do item.'), { code: 'AUX_LIST_LABEL_REQUIRED' });
      if (clean.length > AUX_LABEL_MAX_LEN) throw Object.assign(new Error(`O nome pode ter no máximo ${AUX_LABEL_MAX_LEN} caracteres.`), { code: 'AUX_LIST_LABEL_INVALID' });
      if (this.items.some((i) => i.id !== id && i.kind === current.kind && normalizeAuxLabel(i.label) === normalizeAuxLabel(clean))) {
        throw Object.assign(new Error('Já existe um item com esse nome nesta lista.'), { code: 'AUX_LIST_DUPLICATE' });
      }
      current.label = clean;
    }
    if (typeof next.active === 'boolean') current.active = next.active;
    if (typeof next.sortOrder === 'number' && Number.isFinite(next.sortOrder)) current.sortOrder = next.sortOrder;
    return { ...current };
  }

  async delete(id: string): Promise<AuxListItem | null> {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx < 0) return null;
    const [removed] = this.items.splice(idx, 1);
    return removed ? { ...removed } : null;
  }

  async reorder(kind: AuxListKind, ids: string[]): Promise<AuxListItem[]> {
    const ordered = ids.map((id) => String(id || '').trim()).filter(Boolean);
    const ofKind = this.items.filter((i) => i.kind === kind);
    const known = new Set(ofKind.map((i) => i.id));
    if (ordered.some((id) => !known.has(id))) {
      throw Object.assign(new Error('A ordem inclui um item que não pertence a esta lista.'), { code: 'AUX_LIST_REORDER_INVALID' });
    }
    const rest = ofKind.filter((i) => !ordered.includes(i.id)).map((i) => i.id);
    [...ordered, ...rest].forEach((id, idx) => {
      const item = this.items.find((i) => i.id === id);
      if (item) item.sortOrder = idx;
    });
    return this.list(kind, { includeInactive: true });
  }
}

export const ERP_AUX_LISTS_SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS erp_aux_list_items (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE erp_aux_list_items ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
    CREATE INDEX IF NOT EXISTS idx_erp_aux_list_items_kind ON erp_aux_list_items(kind);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_aux_list_items_kind_label
      ON erp_aux_list_items (kind, lower(label));
`;

export async function ensureErpAuxListsSchema(executor: PgQueryable): Promise<void> {
  await runGuardedDdl(executor, ERP_AUX_LISTS_SCHEMA_SQL);
  // Seed por kind: tabela já populada com centros de custo não impede o seed de Posição/Área.
  for (const kind of AUX_LIST_KINDS) {
    const count = await executor.query(
      `SELECT COUNT(*)::text AS n FROM erp_aux_list_items WHERE kind = $1`,
      [kind]
    ) as { rows: Array<{ n: string }> };
    if (Number(count.rows[0]?.n || 0) > 0) continue;
    for (const item of seedItemsForKind(kind)) {
      await executor.query(
        `INSERT INTO erp_aux_list_items (id, kind, label, sort_order, active)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [item.id, item.kind, item.label, item.sortOrder, item.active]
      );
    }
  }
}

function rowToItem(row: { id: string; kind: string; label: string; sort_order: number; active?: boolean }): AuxListItem {
  return {
    id: row.id,
    kind: row.kind as AuxListKind,
    label: row.label,
    sortOrder: Number(row.sort_order || 0),
    active: row.active !== false,
  };
}

export class PostgresAuxListsStore implements AuxListsStore {
  private async db(): Promise<PgQueryable> {
    const pool = getPostgresPool();
    if (!pool) throw new Error('Postgres indisponível para listas auxiliares');
    await ensurePostgresSchema(pool);
    await ensureErpAuxListsSchema(pool);
    return pool;
  }

  async list(kind?: AuxListKind, opts?: { includeInactive?: boolean }): Promise<AuxListItem[]> {
    const db = await this.db();
    const activeClause = opts?.includeInactive === false ? ' AND active IS NOT FALSE' : '';
    const r = kind
      ? await db.query(
          `SELECT id, kind, label, sort_order, active FROM erp_aux_list_items WHERE kind = $1${activeClause} ORDER BY sort_order ASC, label ASC`,
          [kind]
        )
      : await db.query(
          `SELECT id, kind, label, sort_order, active FROM erp_aux_list_items WHERE TRUE${activeClause} ORDER BY kind ASC, sort_order ASC, label ASC`
        );
    return r.rows.map(rowToItem);
  }

  async create(kind: AuxListKind, label: string): Promise<AuxListItem> {
    const clean = sanitizeAuxLabel(label);
    if (!clean) throw Object.assign(new Error('Informe o nome do item.'), { code: 'AUX_LIST_LABEL_REQUIRED' });
    if (clean.length > AUX_LABEL_MAX_LEN) throw Object.assign(new Error(`O nome pode ter no máximo ${AUX_LABEL_MAX_LEN} caracteres.`), { code: 'AUX_LIST_LABEL_INVALID' });
    const db = await this.db();
    const max = await db.query(
      `SELECT MAX(sort_order) AS m FROM erp_aux_list_items WHERE kind = $1`,
      [kind]
    );
    const item: AuxListItem = {
      id: newAuxListId(kind),
      kind,
      label: clean,
      sortOrder: Number(max.rows[0]?.m ?? -1) + 1,
      active: true,
    };
    try {
      await db.query(
        `INSERT INTO erp_aux_list_items (id, kind, label, sort_order, active) VALUES ($1, $2, $3, $4, $5)`,
        [item.id, item.kind, item.label, item.sortOrder, item.active]
      );
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '23505') {
        throw Object.assign(new Error('Já existe um item com esse nome nesta lista.'), { code: 'AUX_LIST_DUPLICATE' });
      }
      throw err;
    }
    return item;
  }

  async update(id: string, patch: string | AuxListPatch): Promise<AuxListItem | null> {
    const next = normalizeAuxPatch(patch);
    const sets: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [id];
    if (next.label !== undefined) {
      const clean = sanitizeAuxLabel(next.label);
      if (!clean) throw Object.assign(new Error('Informe o nome do item.'), { code: 'AUX_LIST_LABEL_REQUIRED' });
      if (clean.length > AUX_LABEL_MAX_LEN) throw Object.assign(new Error(`O nome pode ter no máximo ${AUX_LABEL_MAX_LEN} caracteres.`), { code: 'AUX_LIST_LABEL_INVALID' });
      params.push(clean);
      sets.push(`label = $${params.length}`);
    }
    if (typeof next.active === 'boolean') {
      params.push(next.active);
      sets.push(`active = $${params.length}`);
    }
    if (typeof next.sortOrder === 'number' && Number.isFinite(next.sortOrder)) {
      params.push(next.sortOrder);
      sets.push(`sort_order = $${params.length}`);
    }
    if (sets.length === 1) {
      const db = await this.db();
      const cur = await db.query(
        `SELECT id, kind, label, sort_order, active FROM erp_aux_list_items WHERE id = $1`,
        [id]
      );
      return cur.rows[0] ? rowToItem(cur.rows[0]) : null;
    }
    const db = await this.db();
    try {
      const r = await db.query(
        `UPDATE erp_aux_list_items SET ${sets.join(', ')} WHERE id = $1
         RETURNING id, kind, label, sort_order, active`,
        params
      );
      const row = r.rows[0];
      return row ? rowToItem(row) : null;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '23505') {
        throw Object.assign(new Error('Já existe um item com esse nome nesta lista.'), { code: 'AUX_LIST_DUPLICATE' });
      }
      throw err;
    }
  }

  async delete(id: string): Promise<AuxListItem | null> {
    const db = await this.db();
    const r = await db.query(
      `DELETE FROM erp_aux_list_items WHERE id = $1 RETURNING id, kind, label, sort_order, active`,
      [id]
    );
    const row = r.rows[0];
    return row ? rowToItem(row) : null;
  }

  async reorder(kind: AuxListKind, ids: string[]): Promise<AuxListItem[]> {
    const db = await this.db();
    const existing = await this.list(kind, { includeInactive: true });
    const known = new Set(existing.map((i) => i.id));
    const ordered = ids.map((id) => String(id || '').trim()).filter(Boolean);
    if (ordered.some((id) => !known.has(id))) {
      throw Object.assign(new Error('A ordem inclui um item que não pertence a esta lista.'), { code: 'AUX_LIST_REORDER_INVALID' });
    }
    const rest = existing.filter((i) => !ordered.includes(i.id)).map((i) => i.id);
    let idx = 0;
    for (const id of [...ordered, ...rest]) {
      await db.query(`UPDATE erp_aux_list_items SET sort_order = $2, updated_at = NOW() WHERE id = $1 AND kind = $3`, [
        id,
        idx,
        kind,
      ]);
      idx += 1;
    }
    return this.list(kind, { includeInactive: true });
  }
}

let defaultStore: AuxListsStore | null = null;

export function getDefaultAuxListsStore(): AuxListsStore {
  if (!defaultStore) {
    defaultStore = isPostgresEnabled() ? new PostgresAuxListsStore() : new MemoryAuxListsStore();
  }
  return defaultStore;
}

export function resetDefaultAuxListsStore(store?: AuxListsStore): AuxListsStore {
  defaultStore = store || new MemoryAuxListsStore();
  return defaultStore;
}

/** Agrupa as duas listas no formato consumido pela tela de opções auxiliares. */
export function groupAuxListItems(items: AuxListItem[]): {
  costCenters: AuxListItem[];
  chartOfAccountsList: AuxListItem[];
} {
  return {
    costCenters: sortItems(items.filter((i) => i.kind === 'costCenters')),
    chartOfAccountsList: sortItems(items.filter((i) => i.kind === 'chartOfAccountsList')),
  };
}

/** Se o banco falhar, devolve o seed atual (fallback das listas fixas). */
export async function loadAuxListsOrSeed(store: AuxListsStore = getDefaultAuxListsStore()): Promise<{
  costCenters: AuxListItem[];
  chartOfAccountsList: AuxListItem[];
}> {
  try {
    const items = await store.list();
    if (!items.length) return groupAuxListItems(seedAuxListItems());
    const grouped = groupAuxListItems(items);
    if (!grouped.costCenters.length) grouped.costCenters = groupAuxListItems(seedAuxListItems()).costCenters;
    if (!grouped.chartOfAccountsList.length) {
      grouped.chartOfAccountsList = groupAuxListItems(seedAuxListItems()).chartOfAccountsList;
    }
    return grouped;
  } catch {
    return groupAuxListItems(seedAuxListItems());
  }
}
