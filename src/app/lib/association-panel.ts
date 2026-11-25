/**
 * Painel de associacao (Criar novo | Adicionar existente) — regras puras, testaveis.
 * A busca usa as rotas existentes (com RBAC/moduleAccess do servidor):
 *   contatos  GET /api/contacts?search=&sort=&limit=&offset=
 *   empresas  GET /api/companies?search=&sort=&limit=&offset=
 *   negocios  GET /api/deals?search=&sort=&limit=&offset=
 *   chamados  GET /api/tickets?search=&limit=&offset=
 */
import { contactEmailForRead } from '../../modules/data-health/invented-contact-email';
export type AssociationKind = 'contacts' | 'companies' | 'deals' | 'tickets';
export type AssociationSort = 'recent' | 'oldest' | 'name_asc' | 'name_desc';

export interface AssociationRow {
  id: string;
  label: string;
  hint?: string;
}

export const ASSOCIATION_SORT_OPTIONS: Array<{ id: AssociationSort; label: string }> = [
  { id: 'recent', label: 'Padrão (Recentemente adicionados)' },
  { id: 'oldest', label: 'Mais antigos primeiro' },
  { id: 'name_asc', label: 'Nome (A-Z)' },
  { id: 'name_desc', label: 'Nome (Z-A)' },
];

export const ASSOCIATION_PAGE_SIZES = [10, 25, 50, 100];

export const ASSOCIATION_LABELS: Record<
  AssociationKind,
  { singular: string; plural: string; addTitle: string; createTitle: string; searchPlaceholder: string }
> = {
  contacts: { singular: 'Contato', plural: 'Contatos', addTitle: 'Adicionar Contato existente', createTitle: 'Criar Contato', searchPlaceholder: 'Pesquisar Contatos' },
  companies: { singular: 'Empresa', plural: 'Empresas', addTitle: 'Adicionar Empresa existente', createTitle: 'Criar Empresa', searchPlaceholder: 'Pesquisar Empresas' },
  deals: { singular: 'Negócio', plural: 'Negócios', addTitle: 'Adicionar Negócio existente', createTitle: 'Criar Negócio', searchPlaceholder: 'Pesquisar Negócios' },
  tickets: { singular: 'STI HUB Desk Service', plural: 'STI HUB Desk Service', addTitle: 'Adicionar STI HUB Desk Service existente', createTitle: 'Criar STI HUB Desk Service', searchPlaceholder: 'Pesquisar STI HUB Desk Service' },
};

const ROUTE: Record<AssociationKind, string> = {
  contacts: '/api/contacts',
  companies: '/api/companies',
  deals: '/api/deals',
  tickets: '/api/tickets',
};

export function buildAssociationSearchUrl(
  kind: AssociationKind,
  p: { q: string; sort: AssociationSort; page: number; pageSize: number }
): string {
  const qs = new URLSearchParams();
  const q = p.q.trim();
  if (q) qs.set('search', q);
  if (kind !== 'tickets') qs.set('sort', p.sort);
  const size = Math.max(1, Math.min(100, Math.floor(p.pageSize) || 10));
  qs.set('limit', String(size));
  qs.set('offset', String(Math.max(0, (Math.max(1, p.page) - 1) * size)));
  return `${ROUTE[kind]}?${qs.toString()}`;
}

/** "Nome (email)"; so o e-mail quando nao ha nome (padrao do painel). */
export function contactRowLabel(c: { firstName?: string | null; lastName?: string | null; email?: string | null; id: string }): string {
  const name = `${c.firstName || ''} ${c.lastName || ''}`.trim();
  const email = contactEmailForRead(c.email);
  if (name && email) return `${name} (${email})`;
  return name || email || c.id;
}

type AnyRec = Record<string, any>;

export function toAssociationRow(kind: AssociationKind, r: AnyRec): AssociationRow {
  if (kind === 'contacts') {
    return { id: String(r.id), label: contactRowLabel(r as any), hint: r.company?.name || r.phone || undefined };
  }
  if (kind === 'companies') {
    return { id: String(r.id), label: String(r.name || r.id), hint: [r.domain, r.cnpj].filter(Boolean).join(' · ') || undefined };
  }
  if (kind === 'deals') {
    return { id: String(r.id), label: String(r.title || r.id), hint: [r.company?.name, r.stageName].filter(Boolean).join(' · ') || undefined };
  }
  return { id: String(r.id), label: `${r.key ? `${r.key} · ` : ''}${r.subject || r.id}`, hint: [r.status, r.company?.name].filter(Boolean).join(' · ') || undefined };
}

export function parseAssociationSearchResponse(kind: AssociationKind, json: unknown): { rows: AssociationRow[]; total: number } {
  const j = (json || {}) as AnyRec;
  const data: AnyRec[] = Array.isArray(j.data) ? j.data : [];
  const total = typeof j.total === 'number' ? j.total : data.length;
  return { rows: data.map((r) => toAssociationRow(kind, r)), total };
}

export function totalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));
}

/** Janela de paginas (1..10 no padrao), centrada na atual. */
export function pageWindow(page: number, pages: number, size = 10): number[] {
  const n = Math.min(size, pages);
  let start = Math.max(1, page - Math.floor(n / 2));
  if (start + n - 1 > pages) start = pages - n + 1;
  return Array.from({ length: n }, (_, i) => start + i);
}

export function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

/** Campos do "Criar novo": os primarios liberam os demais (padrao: esmaecidos ate preencher). */
export const CREATE_PRIMARY_FIELDS: Record<AssociationKind, string[]> = {
  contacts: ['email', 'firstName', 'lastName'],
  companies: ['name', 'domain'],
  deals: ['title'],
  tickets: ['subject'],
};

export const CREATE_HINT: Record<AssociationKind, string> = {
  contacts: 'Comece inserindo o nome, o e-mail ou ambos do(a) Contato.',
  companies: 'Comece inserindo o nome ou o domínio da Empresa.',
  deals: 'Comece inserindo o nome do Negócio.',
  tickets: 'Comece inserindo o assunto do STI HUB Desk Service.',
};

export function createSecondaryEnabled(kind: AssociationKind, values: Record<string, string>): boolean {
  return CREATE_PRIMARY_FIELDS[kind].some((k) => String(values[k] || '').trim().length > 0);
}

/** Pode criar: contato precisa de nome OU e-mail (a rota exige firstName: usamos o e-mail). */
export function createValid(kind: AssociationKind, values: Record<string, string>): boolean {
  const v = (k: string) => String(values[k] || '').trim();
  if (kind === 'contacts') return Boolean(v('firstName') || v('lastName') || looksLikeEmail(v('email')));
  if (kind === 'companies') return Boolean(v('name'));
  if (kind === 'deals') return Boolean(v('title'));
  return Boolean(v('subject'));
}

/** Corpo do POST de criacao nas rotas existentes. */
export function buildCreateBody(kind: AssociationKind, values: Record<string, string>, ctx: { ownerName?: string | null } = {}): Record<string, unknown> {
  const v = (k: string) => String(values[k] || '').trim();
  if (kind === 'contacts') {
    const email = v('email');
    const firstName = v('firstName') || (v('lastName') ? '' : email.split('@')[0]) || v('lastName');
    return {
      firstName,
      lastName: v('firstName') ? v('lastName') || undefined : undefined,
      email: email || undefined,
      phone: v('phone') || undefined,
      jobTitle: v('jobTitle') || undefined,
      department: v('department') || undefined,
      ownerName: v('ownerName') || ctx.ownerName || undefined,
      customProperties: v('website') || v('mobile') ? { ...(v('website') ? { website: v('website') } : {}), ...(v('mobile') ? { mobilePhone: v('mobile') } : {}) } : undefined,
    };
  }
  if (kind === 'companies') {
    return { name: v('name'), domain: v('domain') || undefined, cnpj: v('cnpj') || undefined, phone: v('phone') || undefined, city: v('city') || undefined };
  }
  if (kind === 'deals') {
    return { title: v('title'), value: Number(String(v('value') || '0').replace(/\./g, '').replace(',', '.')) || 0 };
  }
  return { subject: v('subject'), description: v('description') || v('subject'), channel: 'WEB_PORTAL', status: 'OPEN', priority: v('priority') || 'MEDIUM', category: 'SUPPORT' };
}

/** Prefill do "Criar novo" a partir do texto buscado (e-mail vai no campo e-mail). */
export function prefillFromQuery(kind: AssociationKind, q: string): Record<string, string> {
  const t = q.trim();
  if (!t) return {};
  if (kind === 'contacts') return looksLikeEmail(t) ? { email: t } : { firstName: t };
  if (kind === 'companies') return /\.[a-z]{2,}$/i.test(t) && !/\s/.test(t) ? { domain: t, name: '' } : { name: t };
  if (kind === 'deals') return { title: t };
  return { subject: t };
}

// --------------------------------------------------------------------------------------
// Associacoes do negocio. O modelo tem 1 contato/empresa principal (contactId/companyId);
// os demais ficam em customProperties.associated*Ids (PATCH /api/deals/:id existente, que
// substitui customProperties: sempre enviar o objeto mesclado).
// --------------------------------------------------------------------------------------
export const DEAL_ASSOC_KEYS: Record<AssociationKind, string> = {
  contacts: 'associatedContactIds',
  companies: 'associatedCompanyIds',
  deals: 'associatedDealIds',
  tickets: 'associatedTicketIds',
};

export function readAssocIds(customProperties: Record<string, unknown> | undefined | null, kind: AssociationKind): string[] {
  const raw = customProperties?.[DEAL_ASSOC_KEYS[kind]];
  return Array.isArray(raw) ? raw.map((x) => String(x)).filter(Boolean) : [];
}

export function buildDealAssociationPatch(
  deal: { id: string; contactId?: string | null; companyId?: string | null; customProperties?: Record<string, unknown> | null },
  kind: AssociationKind,
  ids: string[]
): Record<string, unknown> {
  const cp = { ...(deal.customProperties || {}) } as Record<string, unknown>;
  const add = ids.filter((id) => id && id !== deal.id);
  const patch: Record<string, unknown> = {};
  let rest = add;
  if (kind === 'contacts' && !deal.contactId && add.length) {
    patch.contactId = add[0];
    rest = add.slice(1);
  }
  if (kind === 'companies' && !deal.companyId && add.length) {
    patch.companyId = add[0];
    rest = add.slice(1);
  }
  const primary = kind === 'contacts' ? (patch.contactId as string) || deal.contactId : kind === 'companies' ? (patch.companyId as string) || deal.companyId : null;
  const merged = Array.from(new Set([...readAssocIds(cp, kind), ...rest])).filter((id) => id !== primary);
  cp[DEAL_ASSOC_KEYS[kind]] = merged;
  patch.customProperties = cp;
  return patch;
}
