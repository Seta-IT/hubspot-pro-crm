// ============================================================================
// STI-hub — Tabela propria de orcamentos/propostas (erp_proposals) — 04/11/2026
// ----------------------------------------------------------------------------
// Antes: todas as propostas viviam em crm_kv_store/crm_state_v1 (payload.erp.proposals) e o
// documento inteiro era lido/regravado a cada requisicao e enviado no bootstrap (limite de
// resposta da Vercel ~4,5 MB). Com os 2082 orcamentos do GestaoClick o estado iria a ~20 MB.
//
// Agora (modo "table", ligado pelo marcador payload.erp.proposalsStorage = 'table', gravado
// atomicamente pelo script de importacao junto com a remocao das propostas do JSON via CAS md5):
//  - cada proposta e UMA linha (data jsonb = registro completo, inclusive versionHistory e
//    statusHistory) com colunas de busca/filtro/ordenacao;
//  - a lista e paginada no SQL (GET /api/erp/proposals?limit=&offset=&q=&status=&type=);
//  - o roteador "hidrata" em memoria SO as propostas que a rota precisa (por id/codigo, short
//    link, negocio) e, depois da rota, grava por linha o que mudou (insert/update/delete) com
//    controle otimista por row_version, na MESMA transacao da gravacao do crm_state_v1;
//  - crm_state_v1 fica com erp.proposals = [] (bootstrap pequeno).
// Sem o marcador (ou sem Postgres) o comportamento e exatamente o anterior (JSON).
// ============================================================================
import { createHash } from 'node:crypto';
import type { ErpCommercialProposal } from './types';
import { extractGcProposalNumber, formatProposalDisplayCode, GESTAOCLICK_LAST_IMPORTED_PROPOSAL_NUMBER } from '../app/lib/proposal-number';

export const PROPOSALS_TABLE = 'erp_proposals';
export const PROPOSALS_STORAGE_MARKER = 'table';

export interface PgQ {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
}

/** Migracao idempotente (CREATE ... IF NOT EXISTS). */
export const PROPOSALS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS erp_proposals (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL DEFAULT '',
  code_num INTEGER,
  gc_id TEXT,
  company_id TEXT,
  deal_id TEXT,
  seller_user_id TEXT,
  seller_email TEXT,
  budget_type TEXT,
  status TEXT,
  is_converted BOOLEAN NOT NULL DEFAULT FALSE,
  is_products BOOLEAN NOT NULL DEFAULT FALSE,
  is_rental BOOLEAN NOT NULL DEFAULT FALSE,
  is_service BOOLEAN NOT NULL DEFAULT FALSE,
  company_name TEXT,
  search_text TEXT NOT NULL DEFAULT '',
  search_digits TEXT NOT NULL DEFAULT '',
  total NUMERIC(16,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  row_version INTEGER NOT NULL DEFAULT 1,
  row_hash TEXT,
  data JSONB NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_erp_proposals_code_lower ON erp_proposals (lower(code)) WHERE code <> '';
CREATE UNIQUE INDEX IF NOT EXISTS ux_erp_proposals_id_lower ON erp_proposals (lower(id));
CREATE INDEX IF NOT EXISTS idx_erp_proposals_gc_id ON erp_proposals (gc_id);
CREATE INDEX IF NOT EXISTS idx_erp_proposals_company_id ON erp_proposals (company_id);
CREATE INDEX IF NOT EXISTS idx_erp_proposals_deal_id ON erp_proposals (deal_id);
CREATE INDEX IF NOT EXISTS idx_erp_proposals_status ON erp_proposals (status);
CREATE INDEX IF NOT EXISTS idx_erp_proposals_budget_type ON erp_proposals (budget_type);
CREATE INDEX IF NOT EXISTS idx_erp_proposals_order ON erp_proposals (code_num DESC NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_erp_proposals_updated_at ON erp_proposals (updated_at DESC);
`;

export async function ensureProposalsTable(db: PgQ): Promise<void> {
  await db.query(PROPOSALS_TABLE_DDL);
}

/**
 * Trava no BANCO (idempotente): se o crm_state_v1 salvo OU o que chega estiver em modo tabela,
 * erp.proposals vira [] e o marcador e mantido. Assim ate um deploy antigo (sem suporte ao modo
 * tabela, que grava o documento inteiro) fica inofensivo: nunca devolve propostas ao JSON nem
 * remove o marcador. Incidente 04/11 16:12 NY: redeploy do 8c98385 remapeou propostas do GC no JSON.
 */
export const KV_PROPOSALS_GUARD_TRIGGER_DDL = `
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'crm_kv_proposals_table_guard_v1') THEN
    CREATE FUNCTION crm_kv_proposals_table_guard_v1() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.key = 'crm_state_v1' AND jsonb_typeof(NEW.payload->'erp') = 'object' AND (
           (TG_OP = 'UPDATE' AND OLD.payload->'erp'->>'proposalsStorage' = 'table')
           OR NEW.payload->'erp'->>'proposalsStorage' = 'table'
         ) THEN
        NEW.payload := jsonb_set(jsonb_set(NEW.payload, '{erp,proposals}', '[]'::jsonb), '{erp,proposalsStorage}', '"table"'::jsonb);
      END IF;
      RETURN NEW;
    END
    $fn$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_crm_kv_proposals_table_guard' AND tgrelid = 'crm_kv_store'::regclass) THEN
    CREATE TRIGGER trg_crm_kv_proposals_table_guard BEFORE INSERT OR UPDATE ON crm_kv_store
      FOR EACH ROW EXECUTE FUNCTION crm_kv_proposals_table_guard_v1();
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_function OR unique_violation THEN NULL;
END
$do$;
`;

export async function ensureKvProposalsGuardTrigger(db: PgQ): Promise<void> {
  await db.query(KV_PROPOSALS_GUARD_TRIGGER_DDL);
}

// ---------------------------------------------------------------------------
// Classificacao (mesmas regras da lista em ErpGestaoClickTab: abas Produtos/Locacao/Servicos)
// ---------------------------------------------------------------------------
type AnyP = Partial<ErpCommercialProposal> & Record<string, any>;

export function isProductsOnlyProposal(p: AnyP): boolean {
  return p.budgetType === 'PRODUTOS';
}
export function isRentalProposal(p: AnyP): boolean {
  if (p.budgetType === 'PRODUTOS' || p.budgetType === 'SERVICOS') return false;
  if (p.budgetType === 'LOCACAO' || p.budgetType === 'CONJUNTO') return true;
  return (Array.isArray(p.items) ? p.items : []).some((i: any) => i && i.fiscalNature === 'LOCACAO_BENS_MOVEIS');
}
export function isServiceProposal(p: AnyP): boolean {
  if (p.budgetType === 'PRODUTOS' || p.budgetType === 'LOCACAO') return false;
  if (p.budgetType === 'SERVICOS' || p.budgetType === 'CONJUNTO') return true;
  return (Array.isArray(p.items) ? p.items : []).some(
    (i: any) => i && (i.itemType === 'SERVICE' || i.fiscalNature === 'SERVICO_TECNICO_TI_TELECOM' || i.fiscalNature === 'SERVICO_COMUNICACAO_SCM_SVA')
  );
}

export function normSearch(v: unknown): string {
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Total exibido na lista (mesma base da folha: mensal + setup + frete). */
export function proposalListTotal(p: AnyP): number {
  return Math.round((num(p.monthlyRecurringTotal) + num(p.oneTimeSetupTotal) + num(p.shippingCost)) * 100) / 100;
}

export function gcIdOf(p: AnyP): string | null {
  const src = (p as any).gcSource;
  if (src && src.id) return String(src.id);
  const m = String(p.id || '').match(/^prop-gc-(\d+)$/);
  return m ? m[1] : null;
}

export function hashProposal(p: unknown): string {
  return createHash('sha1').update(JSON.stringify(p)).digest('hex');
}

const toTs = (v: unknown): string => {
  const d = new Date(String(v || ''));
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
};

export const PROPOSAL_ROW_COLUMNS = [
  'id', 'code', 'code_num', 'gc_id', 'company_id', 'deal_id', 'seller_user_id', 'seller_email', 'budget_type', 'status',
  'is_converted', 'is_products', 'is_rental', 'is_service', 'company_name', 'search_text', 'search_digits', 'total',
  'created_at', 'updated_at', 'row_hash', 'data',
] as const;

/** Valores das colunas (na ordem de PROPOSAL_ROW_COLUMNS) para uma proposta. */
export function proposalRowValues(p: AnyP): unknown[] {
  const code = String(p.code || '').trim();
  const n = extractGcProposalNumber(code);
  const display = formatProposalDisplayCode(code);
  const searchText = normSearch(
    `${code} ${display} ${p.title || ''} ${p.companyName || ''} ${p.companyCnpj || ''} ${p.sellerName || ''} ${p.contactName || ''} ${p.careOf || ''}`
  );
  const digits = `${display} ${p.companyCnpj || ''}`.replace(/\D+/g, '');
  return [
    String(p.id),
    code,
    n !== null && n < 2_000_000_000 ? n : null,
    gcIdOf(p),
    p.companyId || null,
    p.dealId || null,
    p.sellerUserId ? String(p.sellerUserId) : null,
    p.sellerEmail ? String(p.sellerEmail) : null,
    p.budgetType || null,
    p.status || null,
    p.status === 'CONVERTIDA_CONTRATO' || Boolean(p.convertedContractId),
    isProductsOnlyProposal(p),
    isRentalProposal(p),
    isServiceProposal(p),
    p.companyName || null,
    searchText,
    digits,
    proposalListTotal(p),
    toTs(p.createdAt),
    toTs(p.updatedAt || p.createdAt),
    hashProposal(p),
    JSON.stringify(p),
  ];
}

const COL_CASTS: Record<string, string> = { data: 'jsonb', created_at: 'timestamptz', updated_at: 'timestamptz', total: 'numeric' };

function placeholders(startAt: number): string {
  return PROPOSAL_ROW_COLUMNS.map((c, j) => `$${startAt + j}${COL_CASTS[c] ? `::${COL_CASTS[c]}` : ''}`).join(', ');
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------
export interface StoredProposal {
  proposal: ErpCommercialProposal;
  rowVersion: number;
}

const rowToStored = (r: any): StoredProposal => ({
  proposal: (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) as ErpCommercialProposal,
  rowVersion: Number(r.row_version) || 1,
});

/**
 * Refs que a rota precisa carregar de erp_proposals antes de responder.
 * /api/interno/proposta/:id entra aqui: sem isso o modo tabela (lista vazia em memoria)
 * responde "não encontrada" para um id que existe na tabela.
 */
export function proposalRouteLookupRefs(method: string, cleanPath: string): string[] {
  const refs: string[] = [];
  const push = (raw: string) => {
    let value = String(raw || '');
    try {
      value = decodeURIComponent(value);
    } catch {
      value = String(raw || '');
    }
    value = value.trim();
    if (value && !refs.includes(value)) refs.push(value);
  };
  const byRef = String(cleanPath || '').match(/^\/api\/erp\/proposals\/([^/]+)(?:\/[^/]+)?$/);
  if (byRef) push(byRef[1]);
  if (String(method || 'GET').toUpperCase() === 'GET') {
    const internal = String(cleanPath || '').match(/^\/api\/interno\/proposta\/([^/]+)$/);
    if (internal) push(internal[1]);
  }
  return refs;
}

/** Por id exato, id sem caixa ou codigo sem caixa (inclui "#4705" / "GC-ORC-4705" pelo numero). */
export async function getProposalsByRefs(db: PgQ, refs: string[]): Promise<StoredProposal[]> {
  const clean = Array.from(new Set(refs.map((r) => String(r || '').trim()).filter(Boolean))).slice(0, 50);
  if (!clean.length) return [];
  const lower = new Set(clean.map((r) => r.toLowerCase()));
  const nums: number[] = [];
  for (const r of clean) {
    const n = extractGcProposalNumber(r);
    if (n !== null) {
      nums.push(n);
      lower.add(String(n));
    }
  }
  const params: unknown[] = [Array.from(lower)];
  let sql = `SELECT data, row_version FROM erp_proposals WHERE lower(id) = ANY($1::text[]) OR (code <> '' AND lower(code) = ANY($1::text[]))`;
  if (nums.length) {
    params.push(nums);
    sql += ` OR code_num = ANY($2::int[])`;
  }
  const res = await db.query(sql, params);
  return (res.rows || []).map(rowToStored);
}

export async function getProposalsByDealOrCompany(db: PgQ, dealId: string, companyId: string | null, limit = 200): Promise<StoredProposal[]> {
  const res = await db.query(
    `SELECT data, row_version FROM erp_proposals WHERE deal_id = $1 OR ($2::text IS NOT NULL AND company_id = $2) ORDER BY code_num DESC NULLS LAST, created_at DESC LIMIT $3`,
    [dealId, companyId, limit]
  );
  return (res.rows || []).map(rowToStored);
}

/** Maior numero GC ocupado (piso GESTAOCLICK_LAST_IMPORTED_PROPOSAL_NUMBER). Proximo = este + 1. */
export async function maxProposalCodeNumber(db: PgQ): Promise<number> {
  const res = await db.query(`SELECT max(code_num) AS m FROM erp_proposals WHERE code_num < 1000000`);
  const m = Number(res.rows?.[0]?.m);
  return Math.max(GESTAOCLICK_LAST_IMPORTED_PROPOSAL_NUMBER, Number.isFinite(m) ? m : 0);
}

export async function nextProposalNumber(db: PgQ): Promise<number> {
  return (await maxProposalCodeNumber(db)) + 1;
}

export interface ProposalListFilters {
  q?: string;
  status?: string; // TODOS | <status> | CONVERTIDA_CONTRATO
  type?: string; // TODOS | PRODUTOS | LOCACAO | SERVICOS (ou ORC_PRODUTOS/ORC_LOCACAO/ORC_SERVICOS)
  companyId?: string;
  dealId?: string;
  owner?: { id: string; email: string } | null; // escopo restrito (PROPRIOS/EQUIPE)
  limit?: number;
  offset?: number;
}

/** Campos pesados fora da lista (vem no GET por id). */
export const PROPOSAL_SUMMARY_OMIT = ['versionHistory', 'statusHistory', 'introductionText', 'technicalClauses', 'commercialNotes', 'internalNotes', 'digitalSignature'] as const;
export const PROPOSAL_SUMMARY_MARKER = '__summary';

function buildWhere(f: ProposalListFilters, params: unknown[], opts: { skipStatus?: boolean; skipType?: boolean } = {}): string {
  const where: string[] = [];
  const q = normSearch(f.q || '');
  if (q) {
    params.push(`%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    const qi = params.length;
    const digits = String(f.q || '').replace(/\D+/g, '');
    if (digits.length >= 2) {
      params.push(`%${digits}%`);
      where.push(`(search_text LIKE $${qi} OR search_digits LIKE $${params.length})`);
    } else {
      where.push(`search_text LIKE $${qi}`);
    }
  }
  if (!opts.skipStatus && f.status && f.status !== 'TODOS') {
    if (f.status === 'CONVERTIDA_CONTRATO') where.push('is_converted');
    else {
      params.push(f.status);
      where.push(`status = $${params.length}`);
    }
  }
  const t = String(f.type || '').replace(/^ORC_/, '');
  if (!opts.skipType) {
    if (t === 'PRODUTOS') where.push('is_products');
    else if (t === 'LOCACAO') where.push('is_rental');
    else if (t === 'SERVICOS') where.push('is_service');
  }
  if (f.companyId) {
    params.push(f.companyId);
    where.push(`company_id = $${params.length}`);
  }
  if (f.dealId) {
    params.push(f.dealId);
    where.push(`deal_id = $${params.length}`);
  }
  if (f.owner) {
    params.push(String(f.owner.id || '').trim().toLowerCase());
    const pi = params.length;
    params.push(String(f.owner.email || '').trim().toLowerCase());
    const pe = params.length;
    // Mesma regra de isProposalOwnedBy: sellerUserId manda; sem ele, sellerEmail.
    where.push(
      `((coalesce(seller_user_id,'') <> '' AND lower(trim(seller_user_id)) = $${pi} AND $${pi} <> '') OR (coalesce(seller_user_id,'') = '' AND coalesce(seller_email,'') <> '' AND lower(trim(seller_email)) = $${pe} AND $${pe} <> ''))`
    );
  }
  return where.length ? `WHERE ${where.join(' AND ')}` : '';
}

export interface ProposalListPage {
  data: Array<Record<string, unknown>>;
  total: number;
  limit: number;
  offset: number;
  counts: { TODOS: number; PRODUTOS: number; LOCACAO: number; SERVICOS: number };
  openCount: number;
}

export async function listProposalsPage(db: PgQ, f: ProposalListFilters): Promise<ProposalListPage> {
  const limit = Math.min(200, Math.max(1, Math.floor(Number(f.limit) || 50)));
  const offset = Math.max(0, Math.floor(Number(f.offset) || 0));
  const params: unknown[] = [];
  const where = buildWhere(f, params);
  const omit = PROPOSAL_SUMMARY_OMIT.map((k) => `'${k}'`).join(' - ');
  params.push(limit, offset);
  const pageRes = await db.query(
    `SELECT (data - ${omit}) || jsonb_build_object('${PROPOSAL_SUMMARY_MARKER}', true, 'versionCount', coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(data->'versionHistory') = 'array' THEN data->'versionHistory' END), 0)) AS data
       FROM erp_proposals ${where}
       ORDER BY code_num DESC NULLS LAST, created_at DESC, id
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  // Contagens por aba (mesmos filtros de busca/situacao/escopo, sem o filtro de tipo).
  const cParams: unknown[] = [];
  const cWhere = buildWhere(f, cParams, { skipType: true });
  const t = String(f.type || '').replace(/^ORC_/, '');
  const cRes = await db.query(
    `SELECT count(*)::int AS todos, count(*) FILTER (WHERE is_products)::int AS produtos, count(*) FILTER (WHERE is_rental)::int AS locacao,
            count(*) FILTER (WHERE is_service)::int AS servicos,
            count(*) FILTER (WHERE status IN ('ENVIADA','EM_NEGOCIACAO','APROVADA'))::int AS abertas
       FROM erp_proposals ${cWhere}`,
    cParams
  );
  const c = cRes.rows?.[0] || {};
  const counts = { TODOS: Number(c.todos) || 0, PRODUTOS: Number(c.produtos) || 0, LOCACAO: Number(c.locacao) || 0, SERVICOS: Number(c.servicos) || 0 };
  const total = t === 'PRODUTOS' ? counts.PRODUTOS : t === 'LOCACAO' ? counts.LOCACAO : t === 'SERVICOS' ? counts.SERVICOS : counts.TODOS;
  return {
    data: (pageRes.rows || []).map((r) => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data)),
    total,
    limit,
    offset,
    counts,
    openCount: Number(c.abertas) || 0,
  };
}

export async function countProposals(db: PgQ): Promise<{ total: number; open: number }> {
  const r = await db.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE status IN ('ENVIADA','EM_NEGOCIACAO','APROVADA'))::int AS o FROM erp_proposals`);
  return { total: Number(r.rows?.[0]?.n) || 0, open: Number(r.rows?.[0]?.o) || 0 };
}

// ---------------------------------------------------------------------------
// Escrita por linha (controle otimista por row_version)
// ---------------------------------------------------------------------------
export class ProposalWriteConflictError extends Error {
  constructor(public readonly proposalId: string, public readonly reason: string) {
    super(`Conflito ao gravar a proposta ${proposalId}: ${reason}`);
    this.name = 'ProposalWriteConflictError';
  }
}

export interface HydratedSnapshot {
  hash: string;
  rowVersion: number;
}

export interface ProposalDiff {
  inserts: ErpCommercialProposal[];
  updates: Array<{ proposal: ErpCommercialProposal; expectedRowVersion: number }>;
  deletes: Array<{ id: string; expectedRowVersion: number }>;
}

/** Compara o que foi hidratado (id -> hash/versao) com a lista em memoria depois da rota. */
export function diffHydratedProposals(hydrated: Map<string, HydratedSnapshot>, current: ErpCommercialProposal[]): ProposalDiff {
  const out: ProposalDiff = { inserts: [], updates: [], deletes: [] };
  const seen = new Set<string>();
  for (const p of current || []) {
    if (!p || !p.id) continue;
    const id = String(p.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const snap = hydrated.get(id);
    if (!snap) out.inserts.push(p);
    else if (hashProposal(p) !== snap.hash) out.updates.push({ proposal: p, expectedRowVersion: snap.rowVersion });
  }
  for (const [id, snap] of hydrated) {
    if (!seen.has(id)) out.deletes.push({ id, expectedRowVersion: snap.rowVersion });
  }
  return out;
}

export function isEmptyDiff(d: ProposalDiff): boolean {
  return !d.inserts.length && !d.updates.length && !d.deletes.length;
}

/**
 * Sync do GC no modo tabela: so INSERE orcamentos GC que ainda nao existem (por id e por id GC);
 * nunca sobrescreve. Retorna quantos entraram.
 */
export async function insertGcProposalsIfAbsent(db: PgQ, list: AnyP[]): Promise<number> {
  const cand = (list || []).filter((p) => p && p.id);
  if (!cand.length) return 0;
  const gcIds = cand.map((p) => gcIdOf(p)).filter((x): x is string => Boolean(x));
  const ids = cand.map((p) => String(p.id).toLowerCase());
  const known = await db.query(
    `SELECT lower(id) AS id, gc_id FROM erp_proposals WHERE lower(id) = ANY($1::text[]) OR gc_id = ANY($2::text[])`,
    [ids, gcIds]
  );
  const knownIds = new Set((known.rows || []).map((r) => String(r.id)));
  const knownGc = new Set((known.rows || []).map((r) => String(r.gc_id || '')).filter(Boolean));
  const fresh = cand.filter((p) => !knownIds.has(String(p.id).toLowerCase()) && !(gcIdOf(p) && knownGc.has(String(gcIdOf(p)))));
  if (!fresh.length) return 0;
  const r = await applyProposalDiff(db, { inserts: fresh as ErpCommercialProposal[], updates: [], deletes: [] });
  return r.inserted;
}

/**
 * Aplica o diff. Insercao: ON CONFLICT DO NOTHING (nunca sobrescreve). Se `strictInserts`, um
 * insert que nao entrou (id/codigo ja ocupado por outra requisicao) => ProposalWriteConflictError.
 * Update/delete: so se row_version ainda for a lida na hidratacao; senao => conflito.
 */
export async function applyProposalDiff(
  db: PgQ,
  diff: ProposalDiff,
  opts: { strictInserts?: boolean } = {}
): Promise<{ inserted: number; updated: number; deleted: number; skippedInserts: string[] }> {
  let inserted = 0;
  let updated = 0;
  let deleted = 0;
  const skippedInserts: string[] = [];
  const cols = PROPOSAL_ROW_COLUMNS.join(', ');
  const BATCH = 100;
  for (let i = 0; i < diff.inserts.length; i += BATCH) {
    const batch = diff.inserts.slice(i, i + BATCH);
    const params: unknown[] = [];
    const tuples = batch.map((p) => {
      const start = params.length + 1;
      params.push(...proposalRowValues(p));
      return `(${placeholders(start)})`;
    });
    const res = await db.query(`INSERT INTO erp_proposals (${cols}) VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING RETURNING id`, params);
    const got = new Set((res.rows || []).map((r) => String(r.id)));
    inserted += got.size;
    for (const p of batch) if (!got.has(String(p.id))) skippedInserts.push(String(p.id));
  }
  if (opts.strictInserts && skippedInserts.length) {
    throw new ProposalWriteConflictError(skippedInserts[0], 'id ou código já ocupado (tente de novo: o servidor gera o próximo número)');
  }
  const setCols = PROPOSAL_ROW_COLUMNS.filter((c) => c !== 'id');
  for (const u of diff.updates) {
    const vals = proposalRowValues(u.proposal);
    const params: unknown[] = [...vals, u.expectedRowVersion];
    const sets = setCols
      .map((c) => {
        const j = PROPOSAL_ROW_COLUMNS.indexOf(c);
        return `${c} = $${j + 1}${COL_CASTS[c] ? `::${COL_CASTS[c]}` : ''}`;
      })
      .join(', ');
    const res = await db.query(
      `UPDATE erp_proposals SET ${sets}, row_version = row_version + 1 WHERE id = $1 AND row_version = $${params.length} RETURNING row_version`,
      params
    );
    if (!res.rows || res.rows.length !== 1) {
      throw new ProposalWriteConflictError(String(u.proposal.id), 'a proposta foi alterada por outra pessoa/aba depois de aberta');
    }
    updated++;
  }
  for (const d of diff.deletes) {
    const res = await db.query(`DELETE FROM erp_proposals WHERE id = $1 AND row_version = $2 RETURNING id`, [d.id, d.expectedRowVersion]);
    if (!res.rows || res.rows.length !== 1) {
      throw new ProposalWriteConflictError(d.id, 'a proposta foi alterada por outra pessoa/aba antes da exclusão');
    }
    deleted++;
  }
  return { inserted, updated, deleted, skippedInserts };
}

/** Estado lido do crm_kv_store esta em modo tabela? */
export function isProposalsTableState(state: unknown): boolean {
  const erp = (state as { erp?: { proposalsStorage?: unknown } } | null)?.erp;
  return Boolean(erp && erp.proposalsStorage === PROPOSALS_STORAGE_MARKER);
}
