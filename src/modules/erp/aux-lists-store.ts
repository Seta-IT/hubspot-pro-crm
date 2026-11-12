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

export const AUX_LIST_KINDS = ['costCenters', 'chartOfAccountsList'] as const;
export type AuxListKind = (typeof AUX_LIST_KINDS)[number];

export interface AuxListItem {
  id: string;
  kind: AuxListKind;
  label: string;
  sortOrder: number;
}

export const ERP_AUX_LISTS_TABLE = 'erp_aux_list_items';

export function isAuxListKind(value: unknown): value is AuxListKind {
  return AUX_LIST_KINDS.includes(String(value) as AuxListKind);
}

export function seedAuxListItems(): AuxListItem[] {
  const cost = DEFAULT_CONTRACT_AUX_OPTIONS.costCenters.map((label, i) => ({
    id: stableAuxId('costCenters', label),
    kind: 'costCenters' as const,
    label,
    sortOrder: i,
  }));
  const accounts = DEFAULT_CONTRACT_AUX_OPTIONS.chartOfAccountsList.map((label, i) => ({
    id: stableAuxId('chartOfAccountsList', label),
    kind: 'chartOfAccountsList' as const,
    label,
    sortOrder: i,
  }));
  return [...cost, ...accounts];
}

export function stableAuxId(kind: AuxListKind, label: string): string {
  const prefix = kind === 'costCenters' ? 'cc' : 'coa';
  const slug = normalizeAuxLabel(label)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return `${prefix}-${slug || 'item'}`;
}

export function newAuxListId(kind: AuxListKind): string {
  const prefix = kind === 'costCenters' ? 'cc' : 'coa';
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
}

export function sanitizeAuxLabel(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export const AUX_LABEL_MAX_LEN = 120;

export interface AuxListsStore {
  list(kind?: AuxListKind): Promise<AuxListItem[]>;
  create(kind: AuxListKind, label: string): Promise<AuxListItem>;
  update(id: string, label: string): Promise<AuxListItem | null>;
  delete(id: string): Promise<AuxListItem | null>;
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
    this.items = cloneItems(initial && initial.length ? initial : seedAuxListItems());
  }

  async list(kind?: AuxListKind): Promise<AuxListItem[]> {
    const rows = kind ? this.items.filter((i) => i.kind === kind) : this.items;
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
    };
    this.items.push(item);
    return { ...item };
  }

  async update(id: string, label: string): Promise<AuxListItem | null> {
    const current = this.items.find((i) => i.id === id);
    if (!current) return null;
    const clean = sanitizeAuxLabel(label);
    if (!clean) throw Object.assign(new Error('Informe o nome do item.'), { code: 'AUX_LIST_LABEL_REQUIRED' });
    if (clean.length > AUX_LABEL_MAX_LEN) throw Object.assign(new Error(`O nome pode ter no máximo ${AUX_LABEL_MAX_LEN} caracteres.`), { code: 'AUX_LIST_LABEL_INVALID' });
    if (this.items.some((i) => i.id !== id && i.kind === current.kind && normalizeAuxLabel(i.label) === normalizeAuxLabel(clean))) {
      throw Object.assign(new Error('Já existe um item com esse nome nesta lista.'), { code: 'AUX_LIST_DUPLICATE' });
    }
    current.label = clean;
    return { ...current };
  }

  async delete(id: string): Promise<AuxListItem | null> {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx < 0) return null;
    const [removed] = this.items.splice(idx, 1);
    return removed ? { ...removed } : null;
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
    CREATE INDEX IF NOT EXISTS idx_erp_aux_list_items_kind ON erp_aux_list_items(kind);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_aux_list_items_kind_label
      ON erp_aux_list_items (kind, lower(label));
`;

export async function ensureErpAuxListsSchema(executor: PgQueryable): Promise<void> {
  await executor.query(ERP_AUX_LISTS_SCHEMA_SQL);
  const count = await executor.query(`SELECT COUNT(*)::text AS n FROM erp_aux_list_items`) as { rows: Array<{ n: string }> };
  if (Number(count.rows[0]?.n || 0) > 0) return;
  const seed = seedAuxListItems();
  for (const item of seed) {
    await executor.query(
      `INSERT INTO erp_aux_list_items (id, kind, label, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [item.id, item.kind, item.label, item.sortOrder]
    );
  }
}

function rowToItem(row: { id: string; kind: string; label: string; sort_order: number }): AuxListItem {
  return {
    id: row.id,
    kind: row.kind as AuxListKind,
    label: row.label,
    sortOrder: Number(row.sort_order || 0),
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

  async list(kind?: AuxListKind): Promise<AuxListItem[]> {
    const db = await this.db();
    const r = kind
      ? await db.query(
          `SELECT id, kind, label, sort_order FROM erp_aux_list_items WHERE kind = $1 ORDER BY sort_order ASC, label ASC`,
          [kind]
        )
      : await db.query(
          `SELECT id, kind, label, sort_order FROM erp_aux_list_items ORDER BY kind ASC, sort_order ASC, label ASC`
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
    };
    try {
      await db.query(
        `INSERT INTO erp_aux_list_items (id, kind, label, sort_order) VALUES ($1, $2, $3, $4)`,
        [item.id, item.kind, item.label, item.sortOrder]
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

  async update(id: string, label: string): Promise<AuxListItem | null> {
    const clean = sanitizeAuxLabel(label);
    if (!clean) throw Object.assign(new Error('Informe o nome do item.'), { code: 'AUX_LIST_LABEL_REQUIRED' });
    if (clean.length > AUX_LABEL_MAX_LEN) throw Object.assign(new Error(`O nome pode ter no máximo ${AUX_LABEL_MAX_LEN} caracteres.`), { code: 'AUX_LIST_LABEL_INVALID' });
    const db = await this.db();
    try {
      const r = await db.query(
        `UPDATE erp_aux_list_items SET label = $2, updated_at = NOW() WHERE id = $1
         RETURNING id, kind, label, sort_order`,
        [id, clean]
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
      `DELETE FROM erp_aux_list_items WHERE id = $1 RETURNING id, kind, label, sort_order`,
      [id]
    );
    const row = r.rows[0];
    return row ? rowToItem(row) : null;
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
