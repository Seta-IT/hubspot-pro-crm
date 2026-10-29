// ============================================================================
// STI-hub - Tela inicial padrao por usuario (CRM, ERP e Chamados)
// ----------------------------------------------------------------------------
// Regra pura de resolucao da tela inicial + persistencia local indexada pelo
// id do usuario. Nao depende de autenticacao, middleware ou router.
// ============================================================================

export type HomeSystemId = 'CRM' | 'ERP' | 'CHAMADOS';

export type HomeScreenId =
  | 'CRM_OVERVIEW'
  | 'CRM_DEALS'
  | 'CRM_CONTACTS'
  | 'ERP_OVERVIEW'
  | 'ERP_PROPOSALS'
  | 'ERP_CONTRACTS'
  | 'CHAMADOS_OVERVIEW'
  | 'CHAMADOS_QUEUE';

export interface HomeScreenDefinition {
  id: HomeScreenId;
  system: HomeSystemId;
  label: string;
  description: string;
}

export interface HomeSystemDefinition {
  id: HomeSystemId;
  label: string;
  description: string;
}

export interface HomeModuleAccess {
  crm: boolean;
  erp: boolean;
  chamados: boolean;
}

export const HOME_SYSTEMS: HomeSystemDefinition[] = [
  { id: 'CRM', label: 'CRM', description: 'Negócios, contatos, empresas e marketing' },
  { id: 'ERP', label: 'ERP', description: 'Orçamentos, propostas, contratos e financeiro' },
  { id: 'CHAMADOS', label: 'Chamados', description: 'Fila de tickets, SLA e atendimento NOC' },
];

export const HOME_SCREENS: HomeScreenDefinition[] = [
  { id: 'CRM_OVERVIEW', system: 'CRM', label: 'Visão Geral (Dashboard CRM)', description: 'Indicadores comerciais e insights do CRM' },
  { id: 'CRM_DEALS', system: 'CRM', label: 'Negócios / Funil', description: 'Kanban de negócios por etapa do funil' },
  { id: 'CRM_CONTACTS', system: 'CRM', label: 'Contatos', description: 'Base de contatos do CRM' },
  { id: 'ERP_OVERVIEW', system: 'ERP', label: 'Visão Geral (Dashboard ERP)', description: 'Painel inicial do ERP' },
  { id: 'ERP_PROPOSALS', system: 'ERP', label: 'Orçamentos / Propostas', description: 'Propostas comerciais, de locação e de serviços' },
  { id: 'ERP_CONTRACTS', system: 'ERP', label: 'Contratos', description: 'Contratos de locação, serviços e assinaturas' },
  { id: 'CHAMADOS_OVERVIEW', system: 'CHAMADOS', label: 'Visão Geral (Dashboard de Chamados)', description: 'Dashboard de chamados e SLA' },
  { id: 'CHAMADOS_QUEUE', system: 'CHAMADOS', label: 'Fila de Tickets', description: 'Fila operacional de chamados NOC 24x7' },
];

const SYSTEM_ORDER: HomeSystemId[] = ['CRM', 'ERP', 'CHAMADOS'];

export const HOME_SCREEN_STORAGE_KEY = 'stihub_home_screen_v1';
export const HOME_SCREEN_QUERY_PARAM = 'tela';

export function isHomeScreenId(value: unknown): value is HomeScreenId {
  return typeof value === 'string' && HOME_SCREENS.some((s) => s.id === value);
}

export function getHomeScreen(id: HomeScreenId): HomeScreenDefinition {
  return HOME_SCREENS.find((s) => s.id === id) as HomeScreenDefinition;
}

export function systemHasAccess(system: HomeSystemId, access: HomeModuleAccess): boolean {
  if (system === 'CRM') return !!access.crm;
  if (system === 'ERP') return !!access.erp;
  return !!access.chamados;
}

export function getAllowedSystems(access: HomeModuleAccess): HomeSystemId[] {
  return SYSTEM_ORDER.filter((s) => systemHasAccess(s, access));
}

export function getScreensForSystem(system: HomeSystemId): HomeScreenDefinition[] {
  return HOME_SCREENS.filter((s) => s.system === system);
}

export function getOverviewScreenForSystem(system: HomeSystemId): HomeScreenId {
  return system === 'CRM' ? 'CRM_OVERVIEW' : system === 'ERP' ? 'ERP_OVERVIEW' : 'CHAMADOS_OVERVIEW';
}

/** A escolha so faz sentido para quem acessa mais de um sistema. */
export function shouldOfferHomeScreenChoice(access: HomeModuleAccess): boolean {
  return getAllowedSystems(access).length > 1;
}

export interface HomeDeepLink {
  /** Existe destino explicito na URL (?tela=, ?next=, outros parametros ou #hash). */
  hasDeepLink: boolean;
  /** Tela pedida via ?tela=<ID>, quando valida. */
  screenId: HomeScreenId | null;
}

/** Interpreta a URL de entrada. Qualquer parametro ou hash conta como deep link. */
export function parseHomeDeepLink(search: string, hash = ''): HomeDeepLink {
  const params = new URLSearchParams(search || '');
  const keys = Array.from(params.keys()).filter((k) => k.trim() !== '');
  const cleanHash = (hash || '').replace(/^#/, '').trim();
  const rawTela = params.get(HOME_SCREEN_QUERY_PARAM);
  const screenId = rawTela && isHomeScreenId(rawTela.toUpperCase()) ? (rawTela.toUpperCase() as HomeScreenId) : null;
  return { hasDeepLink: keys.length > 0 || cleanHash.length > 0, screenId };
}

export type HomeResolutionSource = 'DEEP_LINK' | 'SAVED' | 'FALLBACK' | 'NO_ACCESS';

export interface HomeResolution {
  /** Tela a abrir; null quando o deep link deve ser respeitado sem tela padrao. */
  screenId: HomeScreenId | null;
  source: HomeResolutionSource;
}

/**
 * Ordem de prioridade:
 * 1. Deep link (?tela= permitido abre a tela; outro destino explicito ignora a padrao).
 * 2. Tela padrao salva, se o usuario ainda tem acesso ao sistema dela.
 * 3. Visao Geral do primeiro sistema permitido (CRM, ERP, Chamados).
 */
export function resolveInitialHomeScreen(input: {
  saved: HomeScreenId | null | undefined;
  access: HomeModuleAccess;
  deepLink?: HomeDeepLink | null;
}): HomeResolution {
  const allowed = getAllowedSystems(input.access);
  const deepLink = input.deepLink;

  if (deepLink?.hasDeepLink) {
    if (deepLink.screenId && systemHasAccess(getHomeScreen(deepLink.screenId).system, input.access)) {
      return { screenId: deepLink.screenId, source: 'DEEP_LINK' };
    }
    if (!deepLink.screenId) {
      return { screenId: null, source: 'DEEP_LINK' };
    }
    // ?tela= de um sistema sem acesso: segue as regras normais abaixo.
  }

  if (allowed.length === 0) {
    return { screenId: null, source: 'NO_ACCESS' };
  }

  if (input.saved && isHomeScreenId(input.saved)) {
    const def = getHomeScreen(input.saved);
    if (systemHasAccess(def.system, input.access)) {
      return { screenId: def.id, source: 'SAVED' };
    }
  }

  return { screenId: getOverviewScreenForSystem(allowed[0]), source: 'FALLBACK' };
}

// ----------------------------------------------------------------------------
// Persistencia local (por id de usuario)
// ----------------------------------------------------------------------------

interface StoredHomeScreenMap {
  [userId: string]: { screenId: HomeScreenId; updatedAt: string };
}

function readMap(storage: Pick<Storage, 'getItem'> | null | undefined): StoredHomeScreenMap {
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(HOME_SCREEN_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as StoredHomeScreenMap) : {};
  } catch {
    return {};
  }
}

function defaultStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadHomeScreenPreference(
  userId: string | null | undefined,
  storage: Pick<Storage, 'getItem'> | null = defaultStorage()
): HomeScreenId | null {
  if (!userId) return null;
  const entry = readMap(storage)[userId];
  return entry && isHomeScreenId(entry.screenId) ? entry.screenId : null;
}

export function saveHomeScreenPreference(
  userId: string,
  screenId: HomeScreenId | null,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = defaultStorage()
): void {
  if (!userId || !storage) return;
  const map = readMap(storage);
  if (screenId && isHomeScreenId(screenId)) {
    map[userId] = { screenId, updatedAt: new Date().toISOString() };
  } else {
    delete map[userId];
  }
  try {
    storage.setItem(HOME_SCREEN_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // armazenamento indisponivel: a preferencia vale apenas nesta sessao
  }
}
