// ============================================================================
// STI-hub — E2: Ordens de servico em tabela propria (erp_service_orders) — 18/11/2026
// ----------------------------------------------------------------------------
// Piloto da base comum (erp-table-store.ts). payload.erp.serviceOrders -> erp_service_orders.
// Regras da Trava Fiscal nas OS:
//  - cnpj_emitente: CHAR(14) com CHECK; padrao Seta Telecom (14.806.925/0001-32); o registro pode
//    trazer cnpjEmitente, que precisa ser um CNPJ valido (Modulo 11), senao a gravacao e recusada;
//  - cliente_cnpj: so digitos, sem UNIQUE e NUNCA usado para casar/mesclar registros;
//  - upsert sempre por id; no sync do GestaoClick, CNPJ do cliente diferente do ja gravado vira
//    conflito (o registro existente fica intacto).
// ============================================================================
import type { ErpServiceOrder } from './types';
import {
  isValidCnpj,
  isValidCpf,
  onlyDigits,
  SETA_CNPJ_EMITENTE,
  toSqlDate,
  type AnyRec,
  type ErpTableSpec,
} from './erp-table-store';

export const SERVICE_ORDERS_RESOURCE = 'serviceOrders';
export const SERVICE_ORDERS_TABLE = 'erp_service_orders';

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Numero da OS (code) como inteiro para ordenar; null se nao for numerico. */
export function serviceOrderCodeNum(code: unknown): number | null {
  const m = String(code ?? '').match(/(\d{1,9})\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n < 2_000_000_000 ? n : null;
}

/** id GC: OS importadas do GestaoClick usam o id numerico do GC como id. */
export function serviceOrderGcId(r: AnyRec): string | null {
  if (r && r.gestaoClickId) return String(r.gestaoClickId);
  const id = String(r?.id ?? '');
  return /^\d{3,}$/.test(id) ? id : null;
}

export const SERVICE_ORDERS_SPEC: ErpTableSpec = {
  resource: SERVICE_ORDERS_RESOURCE,
  table: SERVICE_ORDERS_TABLE,
  label: 'O.S.',
  columns: [
    { name: 'code', ddl: "TEXT NOT NULL DEFAULT ''", value: (r) => String(r.code ?? '').trim() },
    { name: 'code_num', ddl: 'INTEGER', value: (r) => serviceOrderCodeNum(r.code) },
    { name: 'company_id', ddl: 'TEXT', value: (r) => (r.companyId ? String(r.companyId) : null) },
    { name: 'cliente_cnpj', ddl: 'TEXT', value: (r) => onlyDigits(r.companyCnpj) || null },
    { name: 'company_name', ddl: 'TEXT', value: (r) => (r.companyName ? String(r.companyName) : null) },
    { name: 'status', ddl: 'TEXT', value: (r) => (r.status ? String(r.status) : null) },
    { name: 'priority', ddl: 'TEXT', value: (r) => (r.priority ? String(r.priority) : null) },
    { name: 'technician_name', ddl: 'TEXT', value: (r) => (r.technicianName ? String(r.technicianName) : null) },
    { name: 'seller_name', ddl: 'TEXT', value: (r) => (r.sellerName ? String(r.sellerName) : null) },
    { name: 'entry_date', ddl: 'DATE', cast: 'date', value: (r) => toSqlDate(r.entryDate) },
    { name: 'exit_date', ddl: 'DATE', cast: 'date', value: (r) => toSqlDate(r.exitDate) },
    { name: 'total', ddl: 'NUMERIC(16,2) NOT NULL DEFAULT 0', cast: 'numeric', value: (r) => Math.round(num(r.totalAmount) * 100) / 100 },
    { name: 'duplicated_from_id', ddl: 'TEXT', value: (r) => (r.duplicatedFromId ? String(r.duplicatedFromId) : null) },
  ],
  indexes: [
    'CREATE INDEX IF NOT EXISTS idx_erp_service_orders_order ON erp_service_orders (code_num DESC NULLS LAST, created_at DESC);',
    'CREATE INDEX IF NOT EXISTS idx_erp_service_orders_company_id ON erp_service_orders (company_id);',
    'CREATE INDEX IF NOT EXISTS idx_erp_service_orders_status ON erp_service_orders (status, entry_date DESC);',
    // Sem UNIQUE no codigo nesta etapa: o dry-run do backfill lista codigos repetidos antes.
    "CREATE INDEX IF NOT EXISTS idx_erp_service_orders_code_lower ON erp_service_orders (lower(code)) WHERE code <> '';",
    'CREATE INDEX IF NOT EXISTS idx_erp_service_orders_cliente_cnpj ON erp_service_orders (cliente_cnpj);',
  ],
  searchText: (r) =>
    `${r.code ?? ''} ${r.companyName ?? ''} ${r.companyCnpj ?? ''} ${r.technicianName ?? ''} ${r.sellerName ?? ''} ${r.equipmentName ?? ''} ${r.serialNumber ?? ''} ${r.status ?? ''} ${String(r.description ?? '').slice(0, 200)}`,
  searchDigits: (r) => `${r.code ?? ''} ${onlyDigits(r.companyCnpj)}`,
  gcId: serviceOrderGcId,
  cnpjEmitente: (r) => (r.cnpjEmitente ? onlyDigits(r.cnpjEmitente) : SETA_CNPJ_EMITENTE),
  createdAt: (r) => r.createdAt || (Array.isArray(r.statusHistory) && r.statusHistory[0]?.at) || r.entryDate,
  updatedAt: (r) =>
    r.updatedAt || (Array.isArray(r.statusHistory) && r.statusHistory.length ? r.statusHistory[r.statusHistory.length - 1]?.at : '') || r.entryDate,
  orderBy: 'code_num DESC NULLS LAST, created_at DESC, id',
  filters: { status: 'status', companyId: 'company_id', priority: 'priority', technician: 'technician_name' },
  sumColumn: 'total',
  sumValue: (r) => Math.round(num(r.totalAmount) * 100) / 100,
  refColumn: 'code',
};

/** Valor da coluna para a lista em memoria (mesmos filtros da lista SQL). */
export function serviceOrderColumnValue(col: string, r: AnyRec): unknown {
  const c = SERVICE_ORDERS_SPEC.columns.find((x) => x.name === col);
  return c ? c.value(r) : undefined;
}

/** Mesma ordem da lista SQL (numero desc, depois id). */
export function sortServiceOrdersForList<T extends AnyRec>(list: T[]): T[] {
  return [...(list || [])].sort((a, b) => {
    const na = serviceOrderCodeNum(a?.code);
    const nb = serviceOrderCodeNum(b?.code);
    if (na !== nb) {
      if (na === null) return 1;
      if (nb === null) return -1;
      return nb - na;
    }
    return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
  });
}

/**
 * Trava Fiscal na gravacao manual da OS:
 *  - CNPJ/CPF do cliente, se informado, precisa ser valido (Modulo 11);
 *  - com cliente cadastrado escolhido (companyId) que tenha CNPJ, o CNPJ da OS precisa ser o mesmo
 *    (nunca grava a OS de um cliente com o documento de outro);
 *  - cnpjEmitente, se vier, precisa ser CNPJ valido.
 * Devolve a mensagem de erro (pt-BR) ou null.
 */
export function validateServiceOrderCnpj(
  rec: AnyRec,
  company?: { cnpj?: string | null } | null
): string | null {
  const cli = onlyDigits(rec.companyCnpj);
  if (cli) {
    const cad = onlyDigits(company?.cnpj);
    if (cad) {
      // Documento do cadastro escolhido: precisa ser o mesmo (a validade e regra do cadastro).
      if (cad !== cli) return 'O CNPJ informado na O.S. é diferente do CNPJ do cliente selecionado (Trava Fiscal). Confira o cliente.';
    } else {
      const ok = cli.length === 14 ? isValidCnpj(cli) : cli.length === 11 ? isValidCpf(cli) : false;
      if (!ok) return 'CNPJ/CPF do cliente da O.S. inválido.';
    }
  }
  if (rec.cnpjEmitente !== undefined && rec.cnpjEmitente !== null && String(rec.cnpjEmitente).trim()) {
    if (!isValidCnpj(rec.cnpjEmitente)) return 'CNPJ emitente da O.S. inválido.';
  }
  return null;
}

export interface GcServiceOrderConflict {
  id: string;
  code: string;
  cnpjAtual: string;
  cnpjGc: string;
}

/**
 * Sync GestaoClick -> STI-hub das OS: upsert por id (nunca por CNPJ). Campos do GC sobrescrevem e
 * os campos so do STI-hub ficam. Se a OS ja gravada tem CNPJ de cliente e o GC manda outro, NAO
 * mescla: o registro fica como esta e o caso volta em `conflicts`.
 */
export function mergeGcServiceOrders(
  current: ErpServiceOrder[],
  incoming: ErpServiceOrder[]
): { list: ErpServiceOrder[]; conflicts: GcServiceOrderConflict[] } {
  const list = [...(current || [])];
  const index = new Map<string, number>();
  list.forEach((r, i) => {
    if (r?.id) index.set(String(r.id), i);
  });
  const conflicts: GcServiceOrderConflict[] = [];
  for (const rec of incoming || []) {
    const id = String(rec?.id || '').trim();
    if (!id) continue;
    const at = index.get(id);
    if (at === undefined) {
      index.set(id, list.length);
      list.push(rec);
      continue;
    }
    const prev = list[at];
    const a = onlyDigits(prev?.companyCnpj);
    const b = onlyDigits(rec?.companyCnpj);
    if (a && b && a !== b) {
      conflicts.push({ id, code: String(prev.code || rec.code || ''), cnpjAtual: a, cnpjGc: b });
      continue;
    }
    list[at] = { ...prev, ...rec };
  }
  return { list, conflicts };
}

/**
 * Rotas que NAO usam as OS (no modo 'table' nao hidratam erp_service_orders). Lista fechada e
 * conservadora: qualquer rota fora dela hidrata todas as OS (comportamento identico ao JSON).
 * Exclusoes de cliente/contato/negocio/funil/proposta conferem "registro em uso" nas OS, entao
 * so os GET dessas rotas ficam de fora.
 */
const OS_FREE_PREFIXES_ANY_METHOD = [
  '/api/health',
  '/api/auth/',
  '/api/me/',
  '/api/iam/',
  '/api/mailbox/',
  '/api/timeline',
  '/api/workflows',
  '/api/sequences',
  '/api/web-forms',
];
const OS_FREE_PREFIXES_GET_ONLY = ['/api/contacts', '/api/companies', '/api/deals', '/api/pipelines', '/api/erp/proposals'];

const matchesPrefix = (p: string, pre: string) => p === pre.replace(/\/$/, '') || p.startsWith(pre.endsWith('/') ? pre : `${pre}/`);

export function serviceOrdersNeededForRoute(method: string, cleanPath: string, body?: unknown): boolean {
  const p = String(cleanPath || '');
  const m = String(method || '').toUpperCase();
  // A lista paginada le direto da tabela (nao precisa hidratar tudo).
  if (m === 'GET' && p === '/api/erp/service-orders') return false;
  const b = body as { _reconcileJournal?: { upsertedServiceOrders?: unknown[]; deletedServiceOrderIds?: unknown[] } } | null;
  const j = b && typeof b === 'object' ? b._reconcileJournal : null;
  if (
    j &&
    typeof j === 'object' &&
    ((Array.isArray(j.upsertedServiceOrders) && j.upsertedServiceOrders.length) ||
      (Array.isArray(j.deletedServiceOrderIds) && j.deletedServiceOrderIds.length))
  ) {
    return true;
  }
  if (OS_FREE_PREFIXES_ANY_METHOD.some((pre) => matchesPrefix(p, pre))) return false;
  if (m === 'GET' && OS_FREE_PREFIXES_GET_ONLY.some((pre) => matchesPrefix(p, pre))) return false;
  return true;
}
