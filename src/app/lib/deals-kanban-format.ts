/** Formatação compacta do Kanban de Negócios (padrão HubSpot). */

export type PastDateRange = 'ALL' | '30' | '90' | 'YEAR';
export type CloseDateRange = 'ALL' | 'NEXT_30' | 'NEXT_90' | 'OVERDUE' | 'YEAR';
export type DealSortKey = 'createdAt' | 'expectedCloseDate' | 'lastActivityAt' | 'value' | 'title';

export function formatDealAgeLabel(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const days = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86_400_000));
  if (days < 1) return 'há poucas horas';
  if (days === 1) return 'há 1 dia';
  if (days < 30) return `há ${days} dias`;
  const months = Math.floor(days / 30);
  if (months === 1) return 'há 1 mês';
  if (months < 12) return `há ${months} meses`;
  const years = Math.floor(months / 12);
  return years === 1 ? 'há 1 ano' : `há ${years} anos`;
}

export function formatDealPropertyDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

export function isInPastDateRange(
  iso: string | null | undefined,
  range: PastDateRange,
  now = new Date()
): boolean {
  if (range === 'ALL') return true;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  if (range === 'YEAR') return new Date(iso).getFullYear() === now.getFullYear();
  const days = (now.getTime() - t) / 86_400_000;
  return days >= 0 && days <= Number(range);
}

export function isInCloseDateRange(
  iso: string | null | undefined,
  range: CloseDateRange,
  now = new Date()
): boolean {
  if (range === 'ALL') return true;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const daysAhead = (t - now.getTime()) / 86_400_000;
  if (range === 'OVERDUE') return daysAhead < 0;
  if (range === 'YEAR') return new Date(iso).getFullYear() === now.getFullYear();
  const window = range === 'NEXT_30' ? 30 : 90;
  return daysAhead >= 0 && daysAhead <= window;
}

export function compareDealsBySortKey<
  T extends {
    title: string;
    value: number;
    createdAt?: string | null;
    expectedCloseDate?: string | null;
    lastActivityAt?: string | null;
  },
>(a: T, b: T, sortBy: DealSortKey): number {
  if (sortBy === 'title') return a.title.localeCompare(b.title, 'pt-BR');
  if (sortBy === 'value') return b.value - a.value;
  const field =
    sortBy === 'expectedCloseDate'
      ? 'expectedCloseDate'
      : sortBy === 'lastActivityAt'
        ? 'lastActivityAt'
        : 'createdAt';
  const ta = a[field] ? Date.parse(String(a[field])) : 0;
  const tb = b[field] ? Date.parse(String(b[field])) : 0;
  return tb - ta;
}

export function countActiveDealFilters(opts: {
  searchQuery?: string;
  filterOwner?: string;
  filterPriority?: string;
  filterRottingOnly?: boolean;
  filterCreatedRange?: PastDateRange;
  filterActivityRange?: PastDateRange;
  filterCloseRange?: CloseDateRange;
}): number {
  let n = 0;
  if (opts.searchQuery?.trim()) n += 1;
  if (opts.filterOwner && opts.filterOwner !== 'ALL') n += 1;
  if (opts.filterPriority && opts.filterPriority !== 'ALL') n += 1;
  if (opts.filterRottingOnly) n += 1;
  if (opts.filterCreatedRange && opts.filterCreatedRange !== 'ALL') n += 1;
  if (opts.filterActivityRange && opts.filterActivityRange !== 'ALL') n += 1;
  if (opts.filterCloseRange && opts.filterCloseRange !== 'ALL') n += 1;
  return n;
}
