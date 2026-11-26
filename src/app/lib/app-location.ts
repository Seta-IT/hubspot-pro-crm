// ============================================================================
// STI-hub — localização da SPA na URL (F5 / compartilhar / voltar à tela).
// ----------------------------------------------------------------------------
// A navegação vive em estado React (módulo, seção ERP, aba, filtros). Sem
// escrever isso na URL, um reload em `/` reabre a tela inicial (preferência
// salva ou Visão Geral). Aqui fica a regra pura: serializar e ler `?tela=`,
// `sub`, `q` e `status`, sem apagar parâmetros reservados de fluxos internos.
// ============================================================================

import { HOME_SCREEN_QUERY_PARAM, isHomeScreenId, type HomeScreenId } from './home-screen';

export const APP_SUB_QUERY_PARAM = 'sub';
export const APP_SEARCH_QUERY_PARAM = 'q';
export const APP_STATUS_QUERY_PARAM = 'status';

export const APP_LOCATION_MANAGED_PARAMS = [
  HOME_SCREEN_QUERY_PARAM,
  APP_SUB_QUERY_PARAM,
  APP_SEARCH_QUERY_PARAM,
  APP_STATUS_QUERY_PARAM,
] as const;

/** Parâmetros de fluxos já existentes: nunca apagar nem misturar com filtros. */
export const APP_LOCATION_RESERVED_PARAMS = [
  'acao',
  'proposta',
  'foco',
  'voltar',
  'origem',
  'id',
  'deal',
  'next',
] as const;

const TELA_RE = /^[A-Z][A-Z0-9_]{1,47}$/;
const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const SEARCH_MAX = 200;

export const ERP_SECTION_TO_TELA: Record<string, string> = {
  INICIO: 'ERP_OVERVIEW',
  ORCAMENTOS: 'ERP_PROPOSALS',
  CONTRATOS: 'ERP_CONTRACTS',
  CADASTROS: 'ERP_CADASTROS',
  ITENS: 'ERP_ITENS',
  VENDAS: 'ERP_VENDAS',
  ORDENS_SERVICOS: 'ERP_ORDENS_SERVICOS',
  ESTOQUE: 'ERP_ESTOQUE',
  FINANCEIRO: 'ERP_FINANCEIRO',
  FISCAL: 'ERP_FISCAL',
  ATENDIMENTOS: 'ERP_ATENDIMENTOS',
  RELATORIOS: 'ERP_RELATORIOS',
  DATA_HEALTH_ERP: 'ERP_DATA_HEALTH',
  CONFIGURACOES: 'ERP_CONFIGURACOES',
};

export const TELA_TO_ERP_SECTION: Record<string, string> = Object.fromEntries(
  Object.entries(ERP_SECTION_TO_TELA).map(([section, tela]) => [tela, section])
);

const DEFAULT_ERP_SUB: Record<string, string> = {
  INICIO: 'INICIO',
  ORCAMENTOS: 'ORC_TODOS',
  CONTRATOS: 'CTR_TODOS',
  CADASTROS: 'CAD_CLIENTES',
  ITENS: 'ITENS_TODOS',
  VENDAS: 'VENDAS_TODAS',
  ORDENS_SERVICOS: 'OS_GERENCIAR',
  ESTOQUE: 'EST_MOVIMENTACOES',
  FINANCEIRO: 'FIN_RECEBER',
  FISCAL: 'FIS_TODAS',
  ATENDIMENTOS: 'ATENDIMENTOS',
  RELATORIOS: 'REL_VENDAS',
  DATA_HEALTH_ERP: 'DATA_HEALTH_ERP',
  CONFIGURACOES: 'CONFIGURACOES',
};

const EXTRA_APP_TELAS = new Set<string>([
  ...Object.values(ERP_SECTION_TO_TELA),
  'CRM_COMPANIES',
  'CRM_TASKS',
  'CRM_MARKETING',
  'CRM_AUTOMATIONS',
  'CRM_DATA_HEALTH',
  'CHAMADOS_DATA_HEALTH',
  'SETTINGS',
]);

export type AppLocationRoute = {
  tela: string;
  sub?: string;
  q?: string;
  status?: string;
};

export type AppNavSnapshot = {
  module: string;
  contactsSub?: string;
  marketingSub?: string;
  dataHealthScope?: string;
  erpSection?: string;
  erpSubId?: string;
  serviceTab?: string;
  settingsItemId?: string;
  q?: string;
  status?: string;
};

export type AppliedAppNav =
  | {
      kind: 'crm';
      module: string;
      contactsSub?: 'CONTACTS' | 'COMPANIES' | 'TASKS';
      marketingSub?: string;
      dataHealthScope?: 'CRM' | 'ERP';
    }
  | { kind: 'erp'; section: string; subId?: string }
  | { kind: 'service'; tab: 'OPERATIONS' | 'DASHBOARD_CHAMADOS' | 'DATA_HEALTH_CHAMADOS' }
  | { kind: 'settings'; itemId: string };

export function isAppLocationTela(value: unknown): value is string {
  if (typeof value !== 'string' || !TELA_RE.test(value)) return false;
  return isHomeScreenId(value) || EXTRA_APP_TELAS.has(value);
}

export function sanitizeSubToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return TOKEN_RE.test(t) ? t : undefined;
}

export function sanitizeSearchQuery(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, SEARCH_MAX);
  return t || undefined;
}

export function sanitizeStatusToken(value: unknown): string | undefined {
  const t = sanitizeSubToken(value);
  if (!t || t === 'TODOS') return undefined;
  return t;
}

export function hasReservedFlowParams(search: string): boolean {
  const params = new URLSearchParams(stripSearch(search));
  const acao = params.get('acao');
  return acao === 'atualizar-validade' || acao === 'enviar-email';
}

export function canSyncAppLocation(pathname: string): boolean {
  return pathname === '/' || pathname === '';
}

export function parseAppLocation(search: string): AppLocationRoute | null {
  const params = new URLSearchParams(stripSearch(search));
  const rawTela = params.get(HOME_SCREEN_QUERY_PARAM);
  const tela = rawTela ? rawTela.trim().toUpperCase() : '';
  if (!isAppLocationTela(tela)) return null;
  const route: AppLocationRoute = { tela };
  const sub = sanitizeSubToken(params.get(APP_SUB_QUERY_PARAM));
  const q = sanitizeSearchQuery(params.get(APP_SEARCH_QUERY_PARAM));
  const status = sanitizeStatusToken(params.get(APP_STATUS_QUERY_PARAM));
  if (sub) route.sub = sub;
  if (q) route.q = q;
  if (status) route.status = status;
  return route;
}

function isListFilterSection(erpSection: string | undefined): boolean {
  return erpSection === 'ORCAMENTOS' || erpSection === 'CONTRATOS';
}

function defaultSubForSection(section: string | undefined): string | undefined {
  if (!section) return undefined;
  return DEFAULT_ERP_SUB[section];
}

/** Monta a rota a partir do estado atual da navegação (e filtros de lista, se couber). */
export function locationFromNav(nav: AppNavSnapshot): AppLocationRoute | null {
  if (nav.module === 'SETTINGS_HUB' || nav.module === 'ADMIN_RBAC') {
    const route: AppLocationRoute = { tela: 'SETTINGS' };
    const item = sanitizeSubToken(nav.settingsItemId);
    if (item && item !== 'pref-geral') route.sub = item;
    return route;
  }
  if (nav.module === 'ERP_GESTAOCLICK') {
    const section = nav.erpSection || 'INICIO';
    const tela = ERP_SECTION_TO_TELA[section];
    if (!tela) return null;
    const route: AppLocationRoute = { tela };
    const sub = sanitizeSubToken(nav.erpSubId);
    const def = defaultSubForSection(section);
    if (sub && sub !== def) route.sub = sub;
    if (isListFilterSection(section)) {
      const q = sanitizeSearchQuery(nav.q);
      const status = sanitizeStatusToken(nav.status);
      if (q) route.q = q;
      if (status) route.status = status;
    }
    return route;
  }
  if (nav.module === 'SERVICE_DESK') {
    const tab = nav.serviceTab;
    const tela =
      tab === 'OPERATIONS'
        ? 'CHAMADOS_QUEUE'
        : tab === 'DATA_HEALTH_CHAMADOS'
          ? 'CHAMADOS_DATA_HEALTH'
          : 'CHAMADOS_OVERVIEW';
    return { tela };
  }
  if (nav.module === 'OVERVIEW_AI') return { tela: 'CRM_OVERVIEW' };
  if (nav.module === 'DEALS_KANBAN') return { tela: 'CRM_DEALS' };
  if (nav.module === 'CONTACTS_COMPANIES') {
    if (nav.contactsSub === 'COMPANIES') return { tela: 'CRM_COMPANIES' };
    if (nav.contactsSub === 'TASKS') return { tela: 'CRM_TASKS' };
    return { tela: 'CRM_CONTACTS' };
  }
  if (nav.module === 'MARKETING_FORMS') {
    const route: AppLocationRoute = { tela: 'CRM_MARKETING' };
    const sub = sanitizeSubToken(nav.marketingSub);
    if (sub && sub !== 'CAMPAIGNS_ROI') route.sub = sub;
    return route;
  }
  if (nav.module === 'AUTOMATIONS') return { tela: 'CRM_AUTOMATIONS' };
  if (nav.module === 'DATA_HEALTH') {
    const route: AppLocationRoute = { tela: 'CRM_DATA_HEALTH' };
    if (nav.dataHealthScope === 'ERP') route.sub = 'ERP';
    return route;
  }
  return null;
}

export function appliedNavFromLocation(route: AppLocationRoute): AppliedAppNav | null {
  const tela = route.tela;
  if (tela === 'SETTINGS') {
    return { kind: 'settings', itemId: route.sub || 'pref-geral' };
  }
  if (tela === 'CRM_OVERVIEW') return { kind: 'crm', module: 'OVERVIEW_AI' };
  if (tela === 'CRM_DEALS') return { kind: 'crm', module: 'DEALS_KANBAN' };
  if (tela === 'CRM_CONTACTS') return { kind: 'crm', module: 'CONTACTS_COMPANIES', contactsSub: 'CONTACTS' };
  if (tela === 'CRM_COMPANIES') return { kind: 'crm', module: 'CONTACTS_COMPANIES', contactsSub: 'COMPANIES' };
  if (tela === 'CRM_TASKS') return { kind: 'crm', module: 'CONTACTS_COMPANIES', contactsSub: 'TASKS' };
  if (tela === 'CRM_MARKETING') {
    return { kind: 'crm', module: 'MARKETING_FORMS', marketingSub: route.sub };
  }
  if (tela === 'CRM_AUTOMATIONS') return { kind: 'crm', module: 'AUTOMATIONS' };
  if (tela === 'CRM_DATA_HEALTH') {
    return {
      kind: 'crm',
      module: 'DATA_HEALTH',
      dataHealthScope: route.sub === 'ERP' ? 'ERP' : 'CRM',
    };
  }
  if (tela === 'CHAMADOS_OVERVIEW') return { kind: 'service', tab: 'DASHBOARD_CHAMADOS' };
  if (tela === 'CHAMADOS_QUEUE') return { kind: 'service', tab: 'OPERATIONS' };
  if (tela === 'CHAMADOS_DATA_HEALTH') return { kind: 'service', tab: 'DATA_HEALTH_CHAMADOS' };
  const section = TELA_TO_ERP_SECTION[tela];
  if (section) {
    const subId = route.sub || defaultSubForSection(section);
    return { kind: 'erp', section, subId };
  }
  if (isHomeScreenId(tela)) {
    // Defesa: qualquer HomeScreenId de ERP/CRM/Chamados já entrou acima.
    return appliedNavFromHomeScreen(tela);
  }
  return null;
}

function appliedNavFromHomeScreen(tela: HomeScreenId): AppliedAppNav | null {
  if (tela === 'CRM_OVERVIEW') return { kind: 'crm', module: 'OVERVIEW_AI' };
  if (tela === 'CRM_DEALS') return { kind: 'crm', module: 'DEALS_KANBAN' };
  if (tela === 'CRM_CONTACTS') return { kind: 'crm', module: 'CONTACTS_COMPANIES', contactsSub: 'CONTACTS' };
  if (tela === 'ERP_OVERVIEW') return { kind: 'erp', section: 'INICIO', subId: 'INICIO' };
  if (tela === 'ERP_PROPOSALS') return { kind: 'erp', section: 'ORCAMENTOS', subId: 'ORC_TODOS' };
  if (tela === 'ERP_CONTRACTS') return { kind: 'erp', section: 'CONTRATOS', subId: 'CTR_TODOS' };
  if (tela === 'CHAMADOS_OVERVIEW') return { kind: 'service', tab: 'DASHBOARD_CHAMADOS' };
  if (tela === 'CHAMADOS_QUEUE') return { kind: 'service', tab: 'OPERATIONS' };
  return null;
}

export function mergeAppLocationSearch(currentSearch: string, route: AppLocationRoute | null): string {
  const params = new URLSearchParams(stripSearch(currentSearch));
  for (const key of APP_LOCATION_MANAGED_PARAMS) params.delete(key);
  if (route) {
    const freezeFilters = hasReservedFlowParams(currentSearch);
    params.set(HOME_SCREEN_QUERY_PARAM, route.tela);
    if (!freezeFilters) {
      if (route.sub) params.set(APP_SUB_QUERY_PARAM, route.sub);
      if (route.q) params.set(APP_SEARCH_QUERY_PARAM, route.q);
      if (route.status) params.set(APP_STATUS_QUERY_PARAM, route.status);
    }
  }
  const search = params.toString();
  return search ? `?${search}` : '';
}

export function mergeAppLocationHref(currentHref: string, route: AppLocationRoute | null): string {
  let url: URL;
  try {
    url = new URL(currentHref, 'https://sti-hub.local');
  } catch {
    return currentHref;
  }
  if (!canSyncAppLocation(url.pathname)) {
    return `${url.pathname}${url.search}${url.hash}`;
  }
  const nextSearch = mergeAppLocationSearch(url.search, route);
  return `${url.pathname}${nextSearch}${url.hash}`;
}

function stripSearch(search: string): string {
  return (search || '').replace(/^\?/, '');
}
