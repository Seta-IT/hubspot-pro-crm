/** Regras e patches do painel "Sobre esse Negócio" (edição inline no padrão HubSpot). */

export type DealStageLike = {
  id: string;
  name: string;
  isWon?: boolean;
  isClosed?: boolean;
};

export function isWonStage(stage?: DealStageLike | null): boolean {
  return Boolean(stage?.isWon);
}

export function isLostStage(stage?: DealStageLike | null): boolean {
  return Boolean(stage && stage.isClosed && !stage.isWon);
}

export function shouldShowWonReason(stage?: DealStageLike | null): boolean {
  return isWonStage(stage);
}

export function shouldShowLostReason(stage?: DealStageLike | null): boolean {
  return isLostStage(stage);
}

const LAST_CONTACT_KEYS = ['notes_last_contacted', 'ultimo_contato', 'hs_last_contacted'] as const;
const SOLUTION_KEYS = ['solutionTag', 'solucao', 'solução'];
const ACQUISITION_KEYS = ['acquisitionChannel', 'canal_de_aquisicao', 'canal_aquisicao'];
const DESCRIPTION_KEYS = ['description', 'descricao_do_negocio', 'deal_description', 'descricao'];

export function firstDefinedProperty(
  obj: Record<string, unknown> | undefined,
  keys: string[]
): unknown {
  if (!obj) return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function normalizeInstant(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const t = new Date(String(v)).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Só devolve a data de "Último contato" quando ela existe de fato e é distinta
 * da "Data da última atividade". Caso contrário o campo é redundante.
 */
export function distinctLastContactAt(deal: {
  lastActivityAt?: string | null;
  customProperties?: Record<string, unknown>;
}): string | null {
  const raw = firstDefinedProperty(deal.customProperties, [...LAST_CONTACT_KEYS]);
  if (raw === undefined) return null;
  const contactMs = normalizeInstant(raw);
  if (contactMs === null) return null;
  const activityMs = normalizeInstant(deal.lastActivityAt);
  if (activityMs !== null && Math.abs(contactMs - activityMs) < 1000) return null;
  return String(raw);
}

export function parseDealCurrencyInput(raw: string): number | null {
  const t = raw.trim();
  if (!t) return 0;
  const cleaned = t.replace(/[R$\s]/gi, '');
  if (!cleaned) return 0;
  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');
  let normalized = cleaned;
  if (hasComma && hasDot) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    normalized = cleaned.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, '');
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function parseDealDateInput(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const d = new Date(`${t}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) {
    const d = new Date(`${br[3]}-${br[2]}-${br[1]}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export type DealFieldKey =
  | 'title'
  | 'mrr'
  | 'value'
  | 'solution'
  | 'acquisition'
  | 'nextStep'
  | 'closedate'
  | 'owner'
  | 'wonReason'
  | 'lostReason'
  | 'description';

export type DealNextBestActionLike = {
  actionType: string;
  title: string;
  reason: string;
  priority: string;
  suggestedDueInDays: number;
};

export type DealFieldDeal = {
  title?: string;
  value?: number;
  mrr?: number;
  contractMonths?: number;
  expectedCloseDate?: string | null;
  ownerId?: string | null;
  ownerName?: string;
  wonReason?: string | null;
  lostReason?: string | null;
  nextBestAction?: DealNextBestActionLike | null;
  customProperties?: Record<string, unknown>;
};

export type DealOwnerOption = { id: string; name: string };

function pickCustomKey(
  cp: Record<string, unknown> | undefined,
  keys: string[],
  fallback: string
): string {
  if (!cp) return fallback;
  for (const k of keys) {
    if (k in cp) return k;
  }
  return fallback;
}

export function mergeCustomProperties(
  existing: Record<string, unknown> | undefined,
  key: string,
  value: unknown
): Record<string, unknown> {
  return { ...(existing || {}), [key]: value };
}

/** Monta o patch de um único campo para PATCH /api/deals/:id. */
export function buildDealFieldPatch(
  field: DealFieldKey,
  raw: string,
  deal: DealFieldDeal,
  ctx?: { ownerOptions?: DealOwnerOption[] }
): Record<string, unknown> {
  const months = Math.max(1, Number(deal.contractMonths) || 24);
  switch (field) {
    case 'title': {
      const title = raw.trim();
      if (!title) throw new Error('O nome do negócio é obrigatório.');
      return { title };
    }
    case 'mrr': {
      const mrr = parseDealCurrencyInput(raw);
      if (mrr === null) throw new Error('Informe um valor mensal válido.');
      return { mrr, value: mrr * months };
    }
    case 'value': {
      const value = parseDealCurrencyInput(raw);
      if (value === null) throw new Error('Informe um valor total válido.');
      return { value, mrr: Math.round(value / months) };
    }
    case 'solution': {
      const key = pickCustomKey(deal.customProperties, SOLUTION_KEYS, 'solutionTag');
      return { customProperties: mergeCustomProperties(deal.customProperties, key, raw.trim()) };
    }
    case 'acquisition': {
      const key = pickCustomKey(deal.customProperties, ACQUISITION_KEYS, 'acquisitionChannel');
      return { customProperties: mergeCustomProperties(deal.customProperties, key, raw.trim()) };
    }
    case 'description': {
      const key = pickCustomKey(deal.customProperties, DESCRIPTION_KEYS, 'description');
      return { customProperties: mergeCustomProperties(deal.customProperties, key, raw.trim()) };
    }
    case 'nextStep': {
      const title = raw.trim();
      if (!title) return { nextBestAction: null };
      const prev = deal.nextBestAction;
      return {
        nextBestAction: {
          actionType: prev?.actionType || 'FOLLOW_UP',
          title,
          reason: prev?.reason || 'Definido no negócio',
          priority: prev?.priority || 'MEDIUM',
          suggestedDueInDays: prev?.suggestedDueInDays ?? 3,
        },
      };
    }
    case 'closedate': {
      const iso = parseDealDateInput(raw);
      if (raw.trim() && !iso) throw new Error('Informe uma data de fechamento válida.');
      return { expectedCloseDate: iso };
    }
    case 'owner': {
      const token = raw.trim();
      const match = ctx?.ownerOptions?.find((o) => o.id === token || o.name === token);
      return {
        ownerName: match?.name || token || null,
        ownerId: match?.id ?? null,
      };
    }
    case 'wonReason':
      return { wonReason: raw.trim() || null };
    case 'lostReason':
      return { lostReason: raw.trim() || null };
    default:
      throw new Error('Campo não suportado.');
  }
}

type ItemPerm = { edit?: boolean; delete?: boolean };

function dealKanbanPerm(user?: {
  crmItemPermissions?: Record<string, ItemPerm>;
  itemPermissions?: Record<string, ItemPerm>;
} | null): ItemPerm | undefined {
  return user?.crmItemPermissions?.['crm.deals_kanban'] || user?.itemPermissions?.['crm.deals_kanban'];
}

/** Sem permissão conhecida (matriz ausente ou item não listado) = só leitura. */
export function canEditDealsFromPermissions(
  user?: {
    crmItemPermissions?: Record<string, ItemPerm>;
    itemPermissions?: Record<string, ItemPerm>;
  } | null
): boolean {
  const perm = dealKanbanPerm(user);
  if (!perm) return false;
  return perm.edit === true;
}

export function canDeleteDealsFromPermissions(
  user?: {
    crmItemPermissions?: Record<string, ItemPerm>;
    itemPermissions?: Record<string, ItemPerm>;
  } | null
): boolean {
  const perm = dealKanbanPerm(user);
  if (!perm) return false;
  return perm.delete === true;
}
