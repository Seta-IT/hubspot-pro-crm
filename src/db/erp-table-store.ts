// ============================================================================
// STI-hub — Base comum das tabelas proprias do ERP (E0 do plano de tabelas) — 18/11/2026
// ----------------------------------------------------------------------------
// Generaliza o modelo que ja funciona em erp_proposals (proposal-store.ts) para qualquer
// colecao de payload.erp.<recurso> do crm_state_v1:
//  - uma linha por registro (data jsonb = registro completo) + colunas de filtro/ordenacao;
//  - id TEXT PRIMARY KEY, UNIQUE lower(id), gc_id, row_version (controle otimista), row_hash;
//  - cnpj_emitente CHAR(14) com CHECK de 14 digitos (Trava Fiscal; nunca mescla CNPJs);
//  - lista paginada no SQL (limit/offset, busca, filtros por coluna);
//  - diff por linha (insert/update/delete) com row_version => conflito vira 409;
//  - marcador por recurso no JSON: payload.erp.storage.<recurso> = 'dual' | 'table';
//  - trigger guarda generico no crm_kv_store (modo 'table' => array do JSON sempre [] e o
//    marcador nunca some, nem por deploy antigo; modo 'dual' nunca e removido por escritor
//    antigo). So os scripts de manutencao desligam a guarda (SET LOCAL stihub.erp_storage_guard).
//
// Modos (por recurso):
//  - sem marcador ('json'): exatamente o comportamento anterior (JSON e a fonte).
//  - 'dual' (ligado pelo backfill): o JSON continua sendo a fonte e mantem o array completo;
//    cada gravacao tambem reconcilia a tabela (dupla escrita). Leituras paginadas usam a tabela,
//    com fallback para o JSON se ela estiver incompleta ou indisponivel. Nada sai do JSON.
//  - 'table' (corte; exige OK explicito do usuario porque esvazia o array do JSON): a tabela e a
//    fonte; o roteador hidrata so quando a rota precisa e grava por linha com row_version.
// ============================================================================
import { createHash } from 'node:crypto';
import { validateCnpj, validateCpf } from '../modules/data-health/validators';

export interface PgQ {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
}

export type ErpStorageMode = 'json' | 'dual' | 'table';
export type AnyRec = Record<string, any>;

/** CNPJ da Seta Telecom LTDA (Loja Matriz #118887): emitente padrao quando o registro nao traz outro. */
export const SETA_CNPJ_EMITENTE = '14806925000132';

/** Chave do GUC que os scripts de manutencao usam para desligar a guarda (SET LOCAL). */
export const ERP_STORAGE_GUARD_GUC = 'stihub.erp_storage_guard';

export interface ErpTableColumn {
  name: string;
  /** Definicao SQL da coluna (sem o nome), ex.: "TEXT", "NUMERIC(16,2) NOT NULL DEFAULT 0". */
  ddl: string;
  /** Cast do placeholder (ex.: 'date', 'numeric'). */
  cast?: string;
  value: (r: AnyRec) => unknown;
}

export interface ErpTableSpec {
  /** Chave em payload.erp (ex.: 'serviceOrders'). */
  resource: string;
  /** Nome da tabela (ex.: 'erp_service_orders'). */
  table: string;
  /** Rotulo para mensagens (pt-BR). */
  label: string;
  columns: ErpTableColumn[];
  /** Indices adicionais (CREATE INDEX IF NOT EXISTS ...). */
  indexes: string[];
  searchText: (r: AnyRec) => string;
  searchDigits: (r: AnyRec) => string;
  gcId: (r: AnyRec) => string | null;
  /** CNPJ emitente (so digitos). Deve devolver 14 digitos; senao a gravacao e recusada. */
  cnpjEmitente: (r: AnyRec) => string;
  createdAt: (r: AnyRec) => unknown;
  updatedAt: (r: AnyRec) => unknown;
  /** ORDER BY da lista paginada (SQL fixo do spec, nunca vindo do cliente). */
  orderBy: string;
  /** Filtros de igualdade aceitos na lista: parametro -> coluna. */
  filters: Record<string, string>;
  /** Coluna numerica somada na verificacao do backfill (ex.: 'total'). */
  sumColumn?: string;
  sumValue?: (r: AnyRec) => number;
  /** Coluna alternativa para busca por referencia (ex.: 'code'). */
  refColumn?: string;
}

const SAFE_IDENT = /^[a-z][a-z0-9_]{0,62}$/;
const SAFE_RESOURCE = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

function assertSpec(spec: ErpTableSpec): void {
  if (!SAFE_IDENT.test(spec.table)) throw new Error(`tabela invalida: ${spec.table}`);
  if (!SAFE_RESOURCE.test(spec.resource)) throw new Error(`recurso invalido: ${spec.resource}`);
  for (const c of spec.columns) if (!SAFE_IDENT.test(c.name)) throw new Error(`coluna invalida: ${c.name}`);
}

export const COMMON_COLUMNS = [
  'id',
  'gc_id',
  'cnpj_emitente',
  'search_text',
  'search_digits',
  'created_at',
  'updated_at',
  'row_hash',
  'data',
] as const;

const COMMON_CASTS: Record<string, string> = {
  data: 'jsonb',
  created_at: 'timestamptz',
  updated_at: 'timestamptz',
};

export function erpRowColumns(spec: ErpTableSpec): string[] {
  return [...COMMON_COLUMNS.slice(0, 5), ...spec.columns.map((c) => c.name), ...COMMON_COLUMNS.slice(5)];
}

function castOf(spec: ErpTableSpec, col: string): string | undefined {
  if (COMMON_CASTS[col]) return COMMON_CASTS[col];
  return spec.columns.find((c) => c.name === col)?.cast;
}

/** DDL idempotente (CREATE ... IF NOT EXISTS) da tabela do recurso. */
export function erpTableDdl(spec: ErpTableSpec): string {
  assertSpec(spec);
  const t = spec.table;
  const extra = spec.columns.map((c) => `  ${c.name} ${c.ddl},`).join('\n');
  return `
CREATE TABLE IF NOT EXISTS ${t} (
  id TEXT PRIMARY KEY,
  gc_id TEXT,
  cnpj_emitente CHAR(14) NOT NULL DEFAULT '${SETA_CNPJ_EMITENTE}' CONSTRAINT ck_${t}_cnpj_emitente CHECK (cnpj_emitente ~ '^[0-9]{14}$'),
  search_text TEXT NOT NULL DEFAULT '',
  search_digits TEXT NOT NULL DEFAULT '',
${extra}
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  row_version INTEGER NOT NULL DEFAULT 1,
  row_hash TEXT,
  data JSONB NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_${t}_id_lower ON ${t} (lower(id));
CREATE INDEX IF NOT EXISTS idx_${t}_gc_id ON ${t} (gc_id);
CREATE INDEX IF NOT EXISTS idx_${t}_cnpj_emitente ON ${t} (cnpj_emitente);
CREATE INDEX IF NOT EXISTS idx_${t}_updated_at ON ${t} (updated_at DESC);
${spec.indexes.join('\n')}
`;
}

export async function ensureErpTable(db: PgQ, spec: ErpTableSpec): Promise<void> {
  await db.query(erpTableDdl(spec));
}

/**
 * Trava no BANCO (idempotente), generica para todos os recursos do ERP:
 *  - recurso com marcador 'table' no documento salvo OU no que chega => payload.erp.<recurso> = []
 *    e o marcador 'table' e mantido (deploy antigo nao devolve dados ao JSON);
 *  - marcador 'dual' salvo e ausente no que chega (escritor antigo) => o marcador e mantido
 *    (os dados continuam no JSON; so impede que o modo seja perdido).
 * So os scripts de manutencao desligam a guarda com SET LOCAL stihub.erp_storage_guard = 'off'.
 * 'proposals' fica de fora: tem guarda propria (crm_kv_proposals_table_guard_v1).
 */
export const KV_ERP_STORAGE_GUARD_TRIGGER_DDL = `
CREATE OR REPLACE FUNCTION crm_kv_erp_storage_guard_v1() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  k TEXT;
  old_storage JSONB := '{}'::jsonb;
  new_storage JSONB := '{}'::jsonb;
  old_mode TEXT;
  new_mode TEXT;
BEGIN
  IF NEW.key <> 'crm_state_v1' OR jsonb_typeof(NEW.payload->'erp') IS DISTINCT FROM 'object' THEN
    RETURN NEW;
  END IF;
  IF coalesce(current_setting('${ERP_STORAGE_GUARD_GUC}', true), '') = 'off' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND jsonb_typeof(OLD.payload->'erp'->'storage') = 'object' THEN
    old_storage := OLD.payload->'erp'->'storage';
  END IF;
  IF jsonb_typeof(NEW.payload->'erp'->'storage') = 'object' THEN
    new_storage := NEW.payload->'erp'->'storage';
  END IF;
  IF old_storage = '{}'::jsonb AND new_storage = '{}'::jsonb THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(NEW.payload->'erp'->'storage') IS DISTINCT FROM 'object' THEN
    NEW.payload := jsonb_set(NEW.payload, '{erp,storage}', '{}'::jsonb);
  END IF;
  FOR k IN SELECT DISTINCT key FROM (
      SELECT key FROM jsonb_object_keys(old_storage) AS key
      UNION ALL
      SELECT key FROM jsonb_object_keys(new_storage) AS key
    ) s
  LOOP
    IF k !~ '^[A-Za-z][A-Za-z0-9]{0,63}$' OR k = 'proposals' THEN
      CONTINUE;
    END IF;
    old_mode := old_storage->>k;
    new_mode := new_storage->>k;
    IF old_mode = 'table' OR new_mode = 'table' THEN
      NEW.payload := jsonb_set(jsonb_set(NEW.payload, ARRAY['erp', k], '[]'::jsonb), ARRAY['erp', 'storage', k], '"table"'::jsonb);
    ELSIF old_mode = 'dual' AND new_mode IS NULL THEN
      NEW.payload := jsonb_set(NEW.payload, ARRAY['erp', 'storage', k], '"dual"'::jsonb);
    END IF;
  END LOOP;
  RETURN NEW;
END
$fn$;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_crm_kv_erp_storage_guard' AND tgrelid = 'crm_kv_store'::regclass) THEN
    CREATE TRIGGER trg_crm_kv_erp_storage_guard BEFORE INSERT OR UPDATE ON crm_kv_store
      FOR EACH ROW EXECUTE FUNCTION crm_kv_erp_storage_guard_v1();
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$do$;
`;

export async function ensureKvErpStorageGuardTrigger(db: PgQ): Promise<void> {
  await db.query(KV_ERP_STORAGE_GUARD_TRIGGER_DDL);
}

// ---------------------------------------------------------------------------
// Marcadores
// ---------------------------------------------------------------------------
export function getErpStorageMode(state: unknown, resource: string): ErpStorageMode {
  const storage = (state as { erp?: { storage?: unknown } } | null)?.erp?.storage;
  if (!storage || typeof storage !== 'object') return 'json';
  const v = (storage as Record<string, unknown>)[resource];
  return v === 'table' ? 'table' : v === 'dual' ? 'dual' : 'json';
}

/** Recursos do ERP em modo 'table' no estado (exceto propostas, que tem marcador proprio). */
export function erpTableModeResources(state: unknown): string[] {
  const storage = (state as { erp?: { storage?: unknown } } | null)?.erp?.storage;
  if (!storage || typeof storage !== 'object') return [];
  return Object.entries(storage as Record<string, unknown>)
    .filter(([k, v]) => v === 'table' && SAFE_RESOURCE.test(k) && k !== 'proposals')
    .map(([k]) => k);
}

/** Documento para o crm_kv_store: recursos em modo 'table' vao com array vazio (a tabela e a fonte). */
export function stripErpTableResourcesForKv<T>(state: T): T {
  const res = erpTableModeResources(state);
  if (!res.length) return state;
  const s = state as unknown as { erp: AnyRec };
  const erp = { ...s.erp };
  for (const r of res) erp[r] = [];
  return { ...(state as AnyRec), erp } as T;
}

// ---------------------------------------------------------------------------
// Valores das linhas
// ---------------------------------------------------------------------------
export function normSearch(v: unknown): string {
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function onlyDigits(v: unknown): string {
  return String(v ?? '').replace(/\D+/g, '');
}

/** CNPJ valido pela MESMA regra do app (validators.ts, Modulo 11 usado nos cadastros). */
export function isValidCnpj(v: unknown): boolean {
  const d = onlyDigits(v);
  return d.length === 14 && validateCnpj(d).isValid;
}

/** CPF valido pela MESMA regra do app. */
export function isValidCpf(v: unknown): boolean {
  const d = onlyDigits(v);
  return d.length === 11 && validateCpf(d).isValid;
}

export class ErpTableCnpjError extends Error {
  constructor(public readonly resource: string, public readonly recordId: string, message: string) {
    super(message);
    this.name = 'ErpTableCnpjError';
  }
}

export function hashErpRecord(r: unknown): string {
  return createHash('sha1').update(JSON.stringify(r)).digest('hex');
}

export function toIsoTs(v: unknown, fallback?: string): string {
  const s = String(v ?? '').trim();
  if (s) {
    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}))?/);
    const d = br ? new Date(`${br[3]}-${br[2]}-${br[1]}T${br[4] || '12'}:${br[5] || '00'}:00.000Z`) : new Date(s);
    if (Number.isFinite(d.getTime())) return d.toISOString();
  }
  return fallback || new Date().toISOString();
}

/** DD/MM/AAAA ou AAAA-MM-DD => AAAA-MM-DD (ou null). */
export function toSqlDate(v: unknown): string | null {
  const s = String(v ?? '').trim();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const [y, m, d] = br ? [br[3], br[2], br[1]] : iso ? [iso[1], iso[2], iso[3]] : [null, null, null];
  if (!y) return null;
  const dt = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
  if (!Number.isFinite(dt.getTime()) || dt.getUTCDate() !== Number(d)) return null;
  return `${y}-${m}-${d}`;
}

/** Valores das colunas (na ordem de erpRowColumns(spec)). Recusa cnpj_emitente invalido. */
export function erpRowValues(spec: ErpTableSpec, r: AnyRec): unknown[] {
  const id = String(r?.id ?? '').trim();
  if (!id) throw new Error(`${spec.label}: registro sem id`);
  const emit = onlyDigits(spec.cnpjEmitente(r));
  if (!/^\d{14}$/.test(emit) || !isValidCnpj(emit)) {
    throw new ErpTableCnpjError(spec.resource, id, `${spec.label} ${id}: CNPJ emitente inválido (${emit || 'vazio'}).`);
  }
  const created = toIsoTs(spec.createdAt(r));
  return [
    id,
    spec.gcId(r),
    emit,
    normSearch(spec.searchText(r)),
    onlyDigits(spec.searchDigits(r)),
    ...spec.columns.map((c) => c.value(r)),
    created,
    toIsoTs(spec.updatedAt(r), created),
    hashErpRecord(r),
    JSON.stringify(r),
  ];
}

function placeholders(spec: ErpTableSpec, startAt: number): string {
  return erpRowColumns(spec)
    .map((c, j) => {
      const cast = castOf(spec, c);
      return `$${startAt + j}${cast ? `::${cast}` : ''}`;
    })
    .join(', ');
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------
export interface StoredErpRecord<T = AnyRec> {
  record: T;
  rowVersion: number;
}

const rowToStored = <T>(r: any): StoredErpRecord<T> => ({
  record: (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) as T,
  rowVersion: Number(r.row_version) || 1,
});

export async function countErpTable(db: PgQ, spec: ErpTableSpec): Promise<number> {
  assertSpec(spec);
  const res = await db.query(`SELECT count(*)::int AS n FROM ${spec.table}`);
  return Number(res.rows?.[0]?.n) || 0;
}

/** Todas as linhas (hidratacao completa de rotas que usam o recurso inteiro). */
export async function getAllErpRows<T = AnyRec>(db: PgQ, spec: ErpTableSpec): Promise<StoredErpRecord<T>[]> {
  assertSpec(spec);
  const res = await db.query(`SELECT data, row_version FROM ${spec.table} ORDER BY ${spec.orderBy}`);
  return (res.rows || []).map((r) => rowToStored<T>(r));
}

/** Linhas por id (ou pela coluna de referencia do spec, ex.: codigo), sem diferenciar maiusculas. */
export async function getErpRowsByRefs<T = AnyRec>(db: PgQ, spec: ErpTableSpec, refs: string[]): Promise<StoredErpRecord<T>[]> {
  assertSpec(spec);
  const keys = Array.from(new Set((refs || []).map((r) => String(r || '').trim().toLowerCase()).filter(Boolean))).slice(0, 200);
  if (!keys.length) return [];
  const byRef = spec.refColumn && SAFE_IDENT.test(spec.refColumn) ? ` OR lower(${spec.refColumn}) = ANY($1::text[])` : '';
  const res = await db.query(`SELECT data, row_version FROM ${spec.table} WHERE lower(id) = ANY($1::text[])${byRef}`, [keys]);
  return (res.rows || []).map((r) => rowToStored<T>(r));
}

export interface ErpPageQuery {
  q?: string;
  filters?: Record<string, string | undefined>;
  limit?: number;
  offset?: number;
}

export interface ErpPage<T = AnyRec> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export const ERP_PAGE_DEFAULT_LIMIT = 50;
export const ERP_PAGE_MAX_LIMIT = 200;

export function normalizePageArgs(limit?: unknown, offset?: unknown): { limit: number; offset: number } {
  const l = Math.floor(Number(limit));
  const o = Math.floor(Number(offset));
  return {
    limit: Number.isFinite(l) && l > 0 ? Math.min(l, ERP_PAGE_MAX_LIMIT) : ERP_PAGE_DEFAULT_LIMIT,
    offset: Number.isFinite(o) && o > 0 ? Math.min(o, 10_000_000) : 0,
  };
}

const escLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Lista paginada no SQL: busca normalizada (texto e digitos), filtros de igualdade, total. */
export async function listErpTablePage<T = AnyRec>(db: PgQ, spec: ErpTableSpec, q: ErpPageQuery): Promise<ErpPage<T>> {
  assertSpec(spec);
  const { limit, offset } = normalizePageArgs(q.limit, q.offset);
  const where: string[] = [];
  const params: unknown[] = [];
  const term = normSearch(q.q).slice(0, 120);
  if (term) {
    params.push(`%${escLike(term)}%`);
    const textIdx = params.length;
    const digits = onlyDigits(term);
    if (digits.length >= 3) {
      params.push(`%${digits}%`);
      where.push(`(search_text LIKE $${textIdx} OR search_digits LIKE $${params.length})`);
    } else {
      where.push(`search_text LIKE $${textIdx}`);
    }
  }
  for (const [param, col] of Object.entries(spec.filters)) {
    const raw = q.filters?.[param];
    if (raw === undefined || raw === null) continue;
    const v = String(raw).trim();
    if (!v || v.toUpperCase() === 'TODOS' || v.toUpperCase() === 'ALL') continue;
    if (!SAFE_IDENT.test(col)) continue;
    params.push(v.slice(0, 200));
    where.push(`${col} = $${params.length}`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const totalRes = await db.query(`SELECT count(*)::int AS n FROM ${spec.table} ${w}`, params);
  const pageParams = [...params, limit, offset];
  const res = await db.query(
    `SELECT data, row_version FROM ${spec.table} ${w} ORDER BY ${spec.orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    pageParams
  );
  return {
    data: (res.rows || []).map((r) => rowToStored<T>(r).record),
    total: Number(totalRes.rows?.[0]?.n) || 0,
    limit,
    offset,
  };
}

// ---------------------------------------------------------------------------
// Escrita (diff por linha + controle otimista)
// ---------------------------------------------------------------------------
export class ErpTableWriteConflictError extends Error {
  constructor(public readonly resource: string, public readonly recordId: string, message: string) {
    super(message);
    this.name = 'ErpTableWriteConflictError';
  }
}

export interface HydratedErpSnapshot {
  hash: string;
  rowVersion: number;
}

export interface ErpTableDiff<T = AnyRec> {
  inserts: T[];
  updates: Array<{ record: T; expectedRowVersion: number }>;
  deletes: Array<{ id: string; expectedRowVersion: number }>;
}

export function snapshotErpRows<T extends AnyRec>(rows: StoredErpRecord<T>[]): Map<string, HydratedErpSnapshot> {
  const m = new Map<string, HydratedErpSnapshot>();
  for (const r of rows) if (r?.record?.id) m.set(String(r.record.id), { hash: hashErpRecord(r.record), rowVersion: r.rowVersion });
  return m;
}

/** Compara o que foi hidratado (id -> hash/versao) com a lista em memoria depois da rota. */
export function diffHydratedErpRecords<T extends AnyRec>(hydrated: Map<string, HydratedErpSnapshot>, current: T[]): ErpTableDiff<T> {
  const out: ErpTableDiff<T> = { inserts: [], updates: [], deletes: [] };
  const seen = new Set<string>();
  for (const r of current || []) {
    if (!r || !r.id) continue;
    const id = String(r.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const snap = hydrated.get(id);
    if (!snap) out.inserts.push(r);
    else if (hashErpRecord(r) !== snap.hash) out.updates.push({ record: r, expectedRowVersion: snap.rowVersion });
  }
  for (const [id, snap] of hydrated) if (!seen.has(id)) out.deletes.push({ id, expectedRowVersion: snap.rowVersion });
  return out;
}

export function isEmptyErpDiff(d: ErpTableDiff | null | undefined): boolean {
  return !d || (!d.inserts.length && !d.updates.length && !d.deletes.length);
}

/**
 * Aplica o diff. Insercao: ON CONFLICT DO NOTHING (nunca sobrescreve); com strictInserts, um
 * insert que nao entrou (id ja ocupado) => conflito. Update/delete: so se row_version ainda for a
 * lida na hidratacao; senao => ErpTableWriteConflictError (a rota responde 409, nada gravado).
 */
export async function applyErpTableDiff(
  db: PgQ,
  spec: ErpTableSpec,
  diff: ErpTableDiff,
  opts: { strictInserts?: boolean } = {}
): Promise<{ inserted: number; updated: number; deleted: number; skippedInserts: string[] }> {
  assertSpec(spec);
  const cols = erpRowColumns(spec);
  let inserted = 0;
  let updated = 0;
  let deleted = 0;
  const skippedInserts: string[] = [];
  const BATCH = 100;
  for (let i = 0; i < diff.inserts.length; i += BATCH) {
    const batch = diff.inserts.slice(i, i + BATCH);
    const params: unknown[] = [];
    const tuples = batch.map((r) => {
      const start = params.length + 1;
      params.push(...erpRowValues(spec, r));
      return `(${placeholders(spec, start)})`;
    });
    const res = await db.query(
      `INSERT INTO ${spec.table} (${cols.join(', ')}) VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING RETURNING id`,
      params
    );
    const got = new Set((res.rows || []).map((r) => String(r.id)));
    inserted += got.size;
    for (const r of batch) if (!got.has(String(r.id))) skippedInserts.push(String(r.id));
  }
  if (opts.strictInserts && skippedInserts.length) {
    throw new ErpTableWriteConflictError(spec.resource, skippedInserts[0], `${spec.label}: id já ocupado por outra gravação`);
  }
  // UPDATE: id em $1; demais colunas (menos created_at, que nunca muda) em sequencia.
  const setCols = cols.filter((c) => c !== 'id' && c !== 'created_at');
  const sets = setCols
    .map((c, j) => {
      const cast = castOf(spec, c);
      return `${c} = $${j + 2}${cast ? `::${cast}` : ''}`;
    })
    .join(', ');
  for (const u of diff.updates) {
    const vals = erpRowValues(spec, u.record);
    const byCol = new Map(cols.map((c, j) => [c, vals[j]]));
    const params: unknown[] = [byCol.get('id'), ...setCols.map((c) => byCol.get(c)), u.expectedRowVersion];
    const res = await db.query(
      `UPDATE ${spec.table} SET ${sets}, row_version = row_version + 1 WHERE id = $1 AND row_version = $${params.length} RETURNING row_version`,
      params
    );
    if (!res.rows || res.rows.length !== 1) {
      throw new ErpTableWriteConflictError(spec.resource, String(u.record.id), `${spec.label}: registro alterado por outra pessoa/aba depois de aberto`);
    }
    updated++;
  }
  for (const d of diff.deletes) {
    const res = await db.query(`DELETE FROM ${spec.table} WHERE id = $1 AND row_version = $2 RETURNING id`, [d.id, d.expectedRowVersion]);
    if (!res.rows || res.rows.length !== 1) {
      throw new ErpTableWriteConflictError(spec.resource, d.id, `${spec.label}: registro alterado por outra pessoa/aba antes da exclusão`);
    }
    deleted++;
  }
  return { inserted, updated, deleted, skippedInserts };
}

/**
 * Upsert pela chave id (JSON como fonte, usado no backfill e na dupla escrita do modo 'dual').
 * So regrava a linha quando o row_hash mudou; row_version sobe a cada regravacao. Nunca casa por CNPJ.
 */
export async function upsertErpRowsById(db: PgQ, spec: ErpTableSpec, records: AnyRec[]): Promise<{ written: number }> {
  assertSpec(spec);
  const cols = erpRowColumns(spec);
  const setCols = cols.filter((c) => c !== 'id' && c !== 'created_at');
  const sets = setCols.map((c) => `${c} = EXCLUDED.${c}`).join(', ');
  let written = 0;
  const BATCH = 100;
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    const params: unknown[] = [];
    const tuples = batch.map((r) => {
      const start = params.length + 1;
      params.push(...erpRowValues(spec, r));
      return `(${placeholders(spec, start)})`;
    });
    const res = await db.query(
      `INSERT INTO ${spec.table} AS t (${cols.join(', ')}) VALUES ${tuples.join(', ')}
       ON CONFLICT (id) DO UPDATE SET ${sets}, row_version = t.row_version + 1
       WHERE t.row_hash IS DISTINCT FROM EXCLUDED.row_hash
       RETURNING id`,
      params
    );
    written += (res.rows || []).length;
  }
  return { written };
}

/** Limite de exclusoes automaticas da dupla escrita (protecao contra apagar em massa). */
export function dualDeleteLimit(jsonCount: number): number {
  return Math.max(20, Math.ceil(jsonCount * 0.05));
}

/**
 * Dupla escrita do modo 'dual' (JSON = fonte): deixa a tabela igual ao array do JSON.
 *  1. SELECT id, row_hash (leve);
 *  2. upsert so do que mudou;
 *  3. remove da tabela ids que sairam do JSON, salvo se o JSON vier vazio ou se forem mais que
 *     dualDeleteLimit (nesses casos nao apaga nada e devolve deletesSkipped).
 */
export async function reconcileErpTableFromJson(
  db: PgQ,
  spec: ErpTableSpec,
  records: AnyRec[]
): Promise<{ written: number; deleted: number; deletesSkipped: number }> {
  assertSpec(spec);
  const res = await db.query(`SELECT id, row_hash FROM ${spec.table}`);
  const inTable = new Map<string, string>((res.rows || []).map((r) => [String(r.id), String(r.row_hash || '')]));
  const seen = new Set<string>();
  const changed: AnyRec[] = [];
  for (const r of records || []) {
    if (!r || !r.id) continue;
    const id = String(r.id);
    if (seen.has(id)) continue;
    seen.add(id);
    if (inTable.get(id) !== hashErpRecord(r)) changed.push(r);
  }
  const { written } = changed.length ? await upsertErpRowsById(db, spec, changed) : { written: 0 };
  const gone = Array.from(inTable.keys()).filter((id) => !seen.has(id));
  if (!gone.length) return { written, deleted: 0, deletesSkipped: 0 };
  if (!seen.size || gone.length > dualDeleteLimit(seen.size)) return { written, deleted: 0, deletesSkipped: gone.length };
  const del = await db.query(`DELETE FROM ${spec.table} WHERE id = ANY($1::text[]) RETURNING id`, [gone]);
  return { written, deleted: (del.rows || []).length, deletesSkipped: 0 };
}

/** Lista em memoria com a mesma regra da lista SQL (modo 'json' e fallback). */
export function paginateErpRecordsInMemory<T extends AnyRec>(spec: ErpTableSpec, list: T[], q: ErpPageQuery, columnValue: (col: string, r: T) => unknown): ErpPage<T> {
  const { limit, offset } = normalizePageArgs(q.limit, q.offset);
  const term = normSearch(q.q).slice(0, 120);
  const digits = onlyDigits(term);
  let rows = (list || []).filter((r) => r && r.id);
  if (term) {
    rows = rows.filter((r) => {
      if (normSearch(spec.searchText(r)).includes(term)) return true;
      return digits.length >= 3 && onlyDigits(spec.searchDigits(r)).includes(digits);
    });
  }
  for (const [param, col] of Object.entries(spec.filters)) {
    const raw = q.filters?.[param];
    if (raw === undefined || raw === null) continue;
    const v = String(raw).trim();
    if (!v || v.toUpperCase() === 'TODOS' || v.toUpperCase() === 'ALL') continue;
    rows = rows.filter((r) => String(columnValue(col, r) ?? '') === v);
  }
  return { data: rows.slice(offset, offset + limit), total: rows.length, limit, offset };
}
