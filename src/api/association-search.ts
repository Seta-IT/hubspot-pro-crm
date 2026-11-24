// Busca do painel de associacao (Criar novo | Adicionar existente): ordenacao e filtro de
// negocios no servidor, reaproveitados pelas rotas GET /api/contacts, /api/companies e
// /api/deals (?search=&sort=&limit=&offset=). Sem `sort`/`limit` as rotas seguem iguais.
import { normalizeSearchText } from '../db/repository';

export type AssociationSort = 'recent' | 'oldest' | 'name_asc' | 'name_desc';

export function parseAssociationSort(raw: unknown): AssociationSort | null {
  const s = String(raw || '').trim();
  return s === 'recent' || s === 'oldest' || s === 'name_asc' || s === 'name_desc' ? s : null;
}

function ts(v: unknown): number {
  const t = new Date(String(v || '')).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Ordena uma copia. `recent` = criados por ultimo primeiro (padrao do painel). */
export function sortForAssociation<T extends { createdAt?: string | null }>(
  list: T[],
  sort: AssociationSort | null,
  nameOf: (item: T) => string
): T[] {
  if (!sort) return list;
  const out = [...list];
  if (sort === 'recent' || sort === 'oldest') {
    out.sort((a, b) => (sort === 'recent' ? ts(b.createdAt) - ts(a.createdAt) : ts(a.createdAt) - ts(b.createdAt)));
  } else {
    out.sort((a, b) => {
      const r = normalizeSearchText(nameOf(a)).localeCompare(normalizeSearchText(nameOf(b)), 'pt-BR');
      return sort === 'name_asc' ? r : -r;
    });
  }
  return out;
}

/** Filtro de negocios: titulo, empresa (nome/CNPJ), contato (nome/e-mail/telefone); sem acentos. */
export function dealMatchesAssociationSearch(
  d: {
    title?: string;
    company?: { name?: string; cnpj?: string | null; domain?: string | null } | null;
    contact?: { firstName?: string; lastName?: string; email?: string | null; phone?: string | null } | null;
  },
  search: string
): boolean {
  const q = normalizeSearchText(search);
  if (!q) return true;
  const qDigits = search.replace(/\D+/g, '');
  const hay = normalizeSearchText(
    [d.title, d.company?.name, d.company?.cnpj, d.company?.domain, d.contact?.firstName, d.contact?.lastName, d.contact?.email, d.contact?.phone]
      .filter(Boolean)
      .join(' ')
  );
  if (hay.includes(q)) return true;
  if (qDigits.length >= 3) {
    const digits = [d.company?.cnpj, d.contact?.phone].map((x) => String(x || '').replace(/\D+/g, '')).join(' ');
    if (digits.includes(qDigits)) return true;
  }
  return false;
}
