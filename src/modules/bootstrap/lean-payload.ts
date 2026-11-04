// Bootstrap enxuto (04/11/2026): com a migracao completa do GestaoClick (1176 clientes, 830 itens)
// a carga inicial passava de 4 MB (limite de resposta da Vercel: 4,5 MB). Aqui ficam as projecoes
// usadas por /api/bootstrap e /api/state:
// - empresas SEM vinculo de CRM (contato, negocio, chamado, tarefa) vao em forma enxuta
//   (__lean: true): campos de lista/busca/selecao e customProperties minimas. O cadastro completo
//   vem de GET /api/companies/:id (o modal de edicao hidrata antes de abrir) e a lista paginada de
//   GET /api/companies?limit=&offset=&q=.
// - listas derivadas pesadas (hiddenOpportunities, issues do Data Health) limitadas a top N, com o
//   total original informado.
// Gravacoes nunca dependem do formato enxuto: PATCH e journal fazem merge (customProperties
// inclusive) e descartam o marcador __lean.
import type { Company } from '../../db/types';

export const LEAN_COMPANY_MARKER = '__lean';

/** customProperties mantidas na forma enxuta (usadas em listas, filtros e buscas). */
export const LEAN_COMPANY_CUSTOM_PROPS = [
  'gestaoClickClientId',
  'ownerName',
  'accountExecutive',
  'tradeName',
  'nomeFantasia',
  'situation',
  'customerType',
  'phone',
  'commercialPhone',
  'telefone',
  'email',
  'city',
  'state',
] as const;

/** Campos de topo omitidos na forma enxuta (nao usados em listas; vem no GET por id). */
const LEAN_OMIT_TOP = new Set(['enrichedAt', 'customProperties']);

export type LeanCompany = Partial<Company> & { id: string; name: string; [LEAN_COMPANY_MARKER]: true };

export function toLeanCompany<T extends Company>(c: T): LeanCompany {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) {
    if (LEAN_OMIT_TOP.has(k)) continue;
    // Chave ausente (e nao null): um eco do cliente via journal nunca zera o valor do servidor.
    if (v === null || v === undefined) continue;
    out[k] = v;
  }
  const cp = (c.customProperties || {}) as Record<string, unknown>;
  const leanCp: Record<string, unknown> = {};
  for (const k of LEAN_COMPANY_CUSTOM_PROPS) {
    const v = cp[k];
    if (v !== undefined && v !== null && v !== '') leanCp[k] = v;
  }
  out.customProperties = leanCp;
  out[LEAN_COMPANY_MARKER] = true;
  return out as LeanCompany;
}

export function isLeanCompany(c: unknown): boolean {
  return Boolean(c && typeof c === 'object' && (c as Record<string, unknown>)[LEAN_COMPANY_MARKER] === true);
}

/** Ids de empresas com vinculo de CRM (essas seguem completas no bootstrap). */
export function linkedCompanyIds(lists: Array<Array<{ companyId?: string | null }> | undefined>): Set<string> {
  const ids = new Set<string>();
  for (const list of lists) {
    for (const item of list || []) {
      if (item && item.companyId) ids.add(String(item.companyId));
    }
  }
  return ids;
}

export function projectBootstrapCompanies<T extends Company>(companies: T[], linked: Set<string>): Array<T | LeanCompany> {
  return companies.map((c) => (linked.has(c.id) ? c : toLeanCompany(c)));
}

/** Remove o marcador da forma enxuta de um registro recebido do cliente (PATCH/journal). */
export function stripLeanMarker<T>(rec: T): T {
  if (rec && typeof rec === 'object' && LEAN_COMPANY_MARKER in (rec as Record<string, unknown>)) {
    const copy = { ...(rec as Record<string, unknown>) };
    delete copy[LEAN_COMPANY_MARKER];
    return copy as T;
  }
  return rec;
}

export const BOOTSTRAP_HIDDEN_OPPORTUNITIES_MAX = 25;
export const BOOTSTRAP_HEALTH_ISSUES_MAX = 100;
/** Teto de alertas de Data Health guardados no estado persistido (os demais sao recalculados). */
export const PERSISTED_HEALTH_ISSUES_MAX = 150;

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/** Ordena alertas por severidade (estavel) e corta em max. */
export function topIssuesBySeverity<T extends { severity?: string }>(issues: T[], max: number): T[] {
  return issues
    .map((iss, idx) => ({ iss, idx }))
    .sort((a, b) => (SEVERITY_RANK[a.iss.severity || ''] ?? 9) - (SEVERITY_RANK[b.iss.severity || ''] ?? 9) || a.idx - b.idx)
    .slice(0, Math.max(0, max))
    .map((x) => x.iss);
}

/** Paginacao simples para listas (limit 1..500; sem limit = tudo, compatibilidade). */
export function paginate<T>(items: T[], limitRaw?: string, offsetRaw?: string): { page: T[]; total: number; limit: number | null; offset: number } {
  const total = items.length;
  const offset = Math.max(0, Math.floor(Number(offsetRaw) || 0));
  if (limitRaw === undefined || limitRaw === '') {
    return { page: offset ? items.slice(offset) : items, total, limit: null, offset };
  }
  const limit = Math.min(500, Math.max(1, Math.floor(Number(limitRaw) || 50)));
  return { page: items.slice(offset, offset + limit), total, limit, offset };
}
