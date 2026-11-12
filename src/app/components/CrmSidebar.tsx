'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Boxes,
  Building2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileSignature,
  FileText,
  Filter,
  FormInput,
  Headset,
  LayoutDashboard,
  Kanban,
  LineChart,
  Mail,
  Megaphone,
  MoreHorizontal,
  Package,
  PanelLeftClose,
  Pin,
  PinOff,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingBasket,
  Ticket,
  Truck,
  Users,
  Wallet,
  Warehouse,
  Workflow,
  X,
  ExternalLink,
} from 'lucide-react';
import { EnrichedPipeline } from './DealsKanbanTab';
import type { MarketingHubSubView } from './MarketingAndSalesHubSuites';
import type { GestaoClickMenuSection } from './ErpGestaoClickTab';
import type { AdminSubView } from './StiHubAdminRbacPanel';
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  DEFAULT_PIN_IDS,
  RAIL_GROUPS,
  loadPinnedIds,
  persistPinnedIds,
  resolveHomeTarget,
  visibleNavItems,
  type CurrentNavLocation,
  type HubspotNavCategory,
  type HubspotNavItem,
  type NavAccessContext,
  type NavIconId,
  type NavTarget,
  isTargetActive,
} from '../lib/hubspot-nav';

export const CRM_MARKETING_SUBITEMS: Array<{ id: MarketingHubSubView; label: string }> = [
  { id: 'MARKETING_EMAILS', label: 'E-mails de Marketing' },
  { id: 'CAMPAIGNS_ROI', label: 'Campanhas & ROI' },
  { id: 'SEGMENTS_SCORING', label: 'Segmentos & Lead Scoring' },
  { id: 'FORMS_LANDING_PAGES', label: 'Formulários & Leads' },
];

export type CrmModuleId =
  | 'OVERVIEW_AI'
  | 'DEALS_KANBAN'
  | 'CONTACTS_COMPANIES'
  | 'MARKETING_FORMS'
  | 'AUTOMATIONS'
  | 'DATA_HEALTH'
  | 'ADMIN_RBAC';

export const CRM_CORPORATE_BLOCKS = [
  'VISÃO GERAL',
  'COMERCIAL & CLIENTES',
  'MARKETING & AUTOMAÇÃO',
  'GOVERNANÇA CRM',
] as const;

const ICONS: Record<NavIconId, React.ReactNode> = {
  home: <LayoutDashboard className="w-4 h-4 shrink-0" />,
  deals: <Kanban className="w-4 h-4 shrink-0" />,
  tasks: <CheckSquare className="w-4 h-4 shrink-0" />,
  contacts: <Users className="w-4 h-4 shrink-0" />,
  companies: <Building2 className="w-4 h-4 shrink-0" />,
  segments: <Filter className="w-4 h-4 shrink-0" />,
  mail: <Mail className="w-4 h-4 shrink-0" />,
  campaigns: <Megaphone className="w-4 h-4 shrink-0" />,
  forms: <FormInput className="w-4 h-4 shrink-0" />,
  workflow: <Workflow className="w-4 h-4 shrink-0" />,
  forecast: <BarChart3 className="w-4 h-4 shrink-0" />,
  health: <ShieldCheck className="w-4 h-4 shrink-0" />,
  settings: <Settings className="w-4 h-4 shrink-0" />,
  tickets: <Ticket className="w-4 h-4 shrink-0" />,
  products: <Package className="w-4 h-4 shrink-0" />,
  orders: <ShoppingBasket className="w-4 h-4 shrink-0" />,
  services: <ClipboardList className="w-4 h-4 shrink-0" />,
  quotes: <FileText className="w-4 h-4 shrink-0" />,
  contracts: <FileSignature className="w-4 h-4 shrink-0" />,
  invoices: <Receipt className="w-4 h-4 shrink-0" />,
  payments: <Wallet className="w-4 h-4 shrink-0" />,
  subscriptions: <FileSignature className="w-4 h-4 shrink-0" />,
  helpdesk: <Headset className="w-4 h-4 shrink-0" />,
  portal: <ExternalLink className="w-4 h-4 shrink-0" />,
  os: <WrenchIcon />,
  stock: <Warehouse className="w-4 h-4 shrink-0" />,
  finance: <Wallet className="w-4 h-4 shrink-0" />,
  fiscal: <Receipt className="w-4 h-4 shrink-0" />,
  reports: <LineChart className="w-4 h-4 shrink-0" />,
  users: <Users className="w-4 h-4 shrink-0" />,
  building: <Building2 className="w-4 h-4 shrink-0" />,
  truck: <Truck className="w-4 h-4 shrink-0" />,
  inbox: <Mail className="w-4 h-4 shrink-0" />,
  templates: <FileText className="w-4 h-4 shrink-0" />,
  dashboard: <LayoutDashboard className="w-4 h-4 shrink-0" />,
};

function WrenchIcon() {
  return <Boxes className="w-4 h-4 shrink-0" />;
}

export interface CrmSidebarNavHandlers {
  userId?: string | null;
  access: NavAccessContext;
  location: CurrentNavLocation;
  onNavigate: (target: NavTarget) => void;
  onOpenSettings?: (itemId?: string) => void;
}

interface CrmSidebarProps {
  activeModule: CrmModuleId | string;
  pipelines: EnrichedPipeline[];
  selectedPipelineId: string;
  contactsSubView: 'CONTACTS' | 'COMPANIES' | 'TASKS';
  dataHealthScope: 'CRM' | 'ERP';
  contactsCount: number;
  companiesCount: number;
  dealsCount: number;
  formsCount: number;
  marketingEmailsCount?: number;
  activeMarketingSubView?: MarketingHubSubView;
  onSelectMarketingSubView?: (view: MarketingHubSubView) => void;
  automationsCount: number;
  healthScore: number;
  onToggleCollapse?: () => void;
  mobileDrawerOpen?: boolean;
  onCloseMobileDrawer?: () => void;
  onSelectOverview?: () => void;
  onSelectPipeline: (pipelineId: string) => void;
  onSelectContactsSubView: (sub: 'CONTACTS' | 'COMPANIES' | 'TASKS') => void;
  onSelectForms: () => void;
  onSelectAutomations: () => void;
  onSelectDataHealth: (scope: 'CRM' | 'ERP') => void;
  onSelectAdminRbac?: (subView?: string) => void;
  activeAdminSubView?: string;
  nav?: CrmSidebarNavHandlers;
  erpSection?: GestaoClickMenuSection;
  erpSubId?: string;
  serviceTab?: 'OPERATIONS' | 'DASHBOARD_CHAMADOS' | 'DATA_HEALTH_CHAMADOS';
}

export default function CrmSidebar({
  activeModule,
  selectedPipelineId,
  pipelines,
  contactsSubView,
  dataHealthScope,
  formsCount,
  marketingEmailsCount,
  activeMarketingSubView,
  onSelectMarketingSubView,
  automationsCount,
  healthScore,
  onToggleCollapse,
  mobileDrawerOpen = false,
  onCloseMobileDrawer,
  onSelectOverview,
  onSelectPipeline,
  onSelectContactsSubView,
  onSelectForms,
  onSelectAutomations,
  onSelectDataHealth,
  onSelectAdminRbac,
  nav,
}: CrmSidebarProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    MARKETING: true,
    VENDAS: true,
    PLATAFORMA: true,
  });
  const [pins, setPins] = useState<string[]>(DEFAULT_PIN_IDS);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreArea, setMoreArea] = useState<HubspotNavCategory>('CRM');

  const access: NavAccessContext = nav?.access || {
    moduleAccess: { crm: true, erp: false, chamados: false },
    erpConfig: null,
  };

  const items = useMemo(() => visibleNavItems(access), [access]);
  const allowedIds = useMemo(() => items.map((item) => item.id), [items]);

  useEffect(() => {
    setPins(loadPinnedIds(nav?.userId, allowedIds));
  }, [nav?.userId, allowedIds.join('|')]);

  const closeMobileIfOpen = () => onCloseMobileDrawer?.();

  const persistPins = (next: string[]) => {
    setPins(next);
    persistPinnedIds(nav?.userId, next);
  };

  const togglePin = (id: string) => {
    if (pins.includes(id)) persistPins(pins.filter((p) => p !== id));
    else persistPins([...pins, id]);
  };

  const location: CurrentNavLocation = nav?.location || {
    module: String(activeModule),
    contactsSub: contactsSubView,
    marketingSub: activeMarketingSubView,
    dataHealthScope,
  };

  const runTarget = (target: NavTarget) => {
    if (nav?.onNavigate) {
      nav.onNavigate(target);
      closeMobileIfOpen();
      return;
    }
    // Fallback legado (só CRM), para não quebrar usos antigos.
    if (target.type === 'crm') {
      if (target.module === 'OVERVIEW_AI') onSelectOverview?.();
      else if (target.module === 'DEALS_KANBAN') onSelectPipeline(selectedPipelineId || pipelines[0]?.id || 'pipe-enterprise-b2b');
      else if (target.module === 'CONTACTS_COMPANIES' && target.contactsSub) onSelectContactsSubView(target.contactsSub);
      else if (target.module === 'MARKETING_FORMS') {
        if (target.marketingSub && onSelectMarketingSubView) onSelectMarketingSubView(target.marketingSub);
        else onSelectForms();
      } else if (target.module === 'AUTOMATIONS') onSelectAutomations();
      else if (target.module === 'DATA_HEALTH') onSelectDataHealth(target.dataHealthScope || 'CRM');
      else if (target.module === 'ADMIN_RBAC') onSelectAdminRbac?.(target.adminSubView);
    }
    closeMobileIfOpen();
  };

  const byId = useMemo(() => {
    const map = new Map<string, HubspotNavItem>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  const homeItem = byId.get('home');
  const homeTarget = resolveHomeTarget(access);

  const itemClass = (active: boolean) =>
    `w-full px-2.5 py-2 rounded-md flex items-center gap-2.5 text-[12px] transition cursor-pointer ${
      active ? 'bg-white/20 text-white font-semibold ring-1 ring-white/20' : 'text-white/90 hover:bg-white/10 font-semibold'
    }`;

  const GroupHeader = ({ id, label }: { id: string; label: string }) => (
    <button
      type="button"
      onClick={() => setExpanded((p) => ({ ...p, [id]: !p[id] }))}
      className="w-full px-2.5 py-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-white/55 hover:text-white/80 cursor-pointer"
    >
      <span className="truncate">{label}</span>
      {expanded[id] ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
    </button>
  );

  const renderItemButton = (item: HubspotNavItem, opts?: { count?: React.ReactNode }) => {
    const target = item.alwaysOnTop ? homeTarget : item.target;
    const active = Boolean(isTargetActive(item.target, location) || (item.alwaysOnTop && isTargetActive(homeTarget, location) && location.module !== 'SETTINGS_HUB'));
    return (
      <button key={item.id} type="button" onClick={() => runTarget(target)} className={itemClass(active)} data-nav-id={item.id}>
        {ICONS[item.icon]}
        <span className="truncate">{item.label}</span>
        {opts?.count}
      </button>
    );
  };

  const railItemsFor = (group: string) => items.filter((item) => item.railGroup === group);
  const pinnedItems = pins.map((id) => byId.get(id)).filter((item): item is HubspotNavItem => Boolean(item) && !item!.alwaysOnTop);

  const moreCategories = CATEGORY_ORDER.filter((id) => items.some((item) => item.category === id && !item.alwaysOnTop));
  const moreItems = items.filter((item) => item.category === moreArea && !item.alwaysOnTop);

  useEffect(() => {
    if (moreCategories.length && !moreCategories.includes(moreArea)) {
      setMoreArea(moreCategories[0]);
    }
  }, [moreCategories.join(','), moreArea]);

  const renderSidebarContent = (isMobileDrawer = false) => (
    <>
      <div className="flex-1 overflow-y-auto">
        <div className="px-2 py-2 flex items-center justify-end">
          {isMobileDrawer ? (
            <button type="button" onClick={closeMobileIfOpen} aria-label="Fechar Menu CRM" className="p-1.5 rounded-md bg-white/15 text-white hover:bg-white/25 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          ) : (
            onToggleCollapse && (
              <button type="button" onClick={onToggleCollapse} aria-label="Recolher menu lateral do CRM" className="p-1.5 rounded-md text-white/80 hover:bg-white/10 cursor-pointer">
                <PanelLeftClose className="w-4 h-4" />
              </button>
            )
          )}
        </div>

        {/* legado para testes de arquitetura */}
        <span className="sr-only">MÓDULO CRM • SALES &amp; MARKETING</span>
        <span className="sr-only">COMERCIAL &amp; CLIENTES</span>
        <span className="sr-only">MARKETING &amp; AUTOMAÇÃO</span>
        <span className="sr-only">GOVERNANÇA CRM</span>
        <span className="sr-only">Negócios (Funil Kanban)</span>
        <span className="sr-only">Fluxos de Automação</span>
        <span className="sr-only">Data Health (CRM)</span>
        <span className="sr-only">Auditoria Base CRM</span>
        <span className="sr-only">
          <span className="truncate">Marketing</span>
        </span>

        <nav className="px-2 pb-3 space-y-2" data-testid="hubspot-app-nav">
          <div className="space-y-0.5">
            {homeItem && renderItemButton(homeItem)}
            {pinnedItems.map((item) => renderItemButton(item))}
          </div>

          <div className="border-t border-white/15 my-1" />

          {RAIL_GROUPS.map((group) => {
            const groupItems = railItemsFor(group.id);
            if (groupItems.length === 0) return null;
            return (
              <div key={group.id}>
                <GroupHeader id={group.id} label={group.label} />
                {expanded[group.id] && (
                  <div className="space-y-0.5">
                    {groupItems.map((item) =>
                      renderItemButton(item, {
                        count:
                          item.id === 'marketing-emails' && marketingEmailsCount !== undefined ? (
                            <span className="ml-auto text-[10px] text-white/60">({marketingEmailsCount})</span>
                          ) : item.id === 'forms' ? (
                            <span className="ml-auto text-[10px] text-white/60">({formsCount})</span>
                          ) : item.id === 'workflows' ? (
                            <span className="ml-auto text-[10px] text-white/60">{automationsCount}</span>
                          ) : item.id === 'data-health-crm' ? (
                            <span className="ml-auto text-[10px] text-white/60">{healthScore}%</span>
                          ) : undefined,
                      })
                    )}
                  </div>
                )}
                <div className="border-t border-white/15 my-1" />
              </div>
            );
          })}
        </nav>
      </div>

      <div className="relative p-2.5 border-t border-white/15 space-y-1">
        {nav?.onOpenSettings && (
          <button
            type="button"
            onClick={() => {
              nav.onOpenSettings?.();
              closeMobileIfOpen();
            }}
            className={itemClass(location.module === 'SETTINGS_HUB')}
            data-testid="nav-open-settings"
          >
            <Settings className="w-4 h-4 shrink-0" />
            <span className="truncate">Configurações</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className="w-full px-2.5 py-2 rounded-md flex items-center gap-2 text-[12px] font-semibold text-white/90 hover:bg-white/10 cursor-pointer"
          data-testid="nav-more-button"
        >
          <MoreHorizontal className="w-4 h-4" />
          <span className="flex-1 text-left">Mais</span>
          <ChevronRight className="w-4 h-4 opacity-80" />
        </button>
        {moreOpen && (
          <div
            className="absolute left-full bottom-0 ml-2 z-50 w-[460px] max-w-[80vw] rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden text-slate-800 flex"
            data-testid="nav-more-flyout"
          >
            <div className="w-48 border-r border-slate-100 bg-slate-50 p-2 space-y-0.5 overflow-y-auto max-h-80">
              {moreCategories.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMoreArea(id)}
                  className={`w-full text-left px-2 py-1.5 rounded-md text-xs font-semibold cursor-pointer ${
                    moreArea === id ? 'bg-accent text-white' : 'text-slate-700 hover:bg-white'
                  }`}
                >
                  {CATEGORY_LABELS[id]}
                </button>
              ))}
            </div>
            <div className="flex-1 p-2 max-h-80 overflow-y-auto space-y-0.5">
              {moreItems.length === 0 ? (
                <p className="px-2 py-3 text-xs font-semibold text-slate-500">Nenhum item nesta área.</p>
              ) : (
                moreItems.map((item) => {
                  const pinned = pins.includes(item.id);
                  return (
                    <div key={item.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          runTarget(item.alwaysOnTop ? homeTarget : item.target);
                          setMoreOpen(false);
                        }}
                        className="flex-1 text-left px-2 py-1.5 rounded-md text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer flex items-center gap-2"
                      >
                        {ICONS[item.icon]}
                        {item.label}
                      </button>
                      <button
                        type="button"
                        onClick={() => togglePin(item.id)}
                        className="p-1.5 rounded hover:bg-slate-100 text-slate-500 cursor-pointer"
                        title={pinned ? 'Desafixar' : 'Fixar'}
                        aria-label={pinned ? 'Desafixar' : 'Fixar'}
                      >
                        {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );

  const shellClass = 'bg-[image:var(--sti-header-crm)] text-white border-r border-orange-900/20 shrink-0 flex-col justify-between select-none';

  return (
    <>
      <aside className={`hidden md:flex w-60 rounded-l-lg ${shellClass}`}>{renderSidebarContent(false)}</aside>
      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs" onClick={closeMobileIfOpen} />
          <aside className={`relative z-10 w-72 max-w-[86vw] h-full overflow-y-auto flex ${shellClass} shadow-2xl`}>{renderSidebarContent(true)}</aside>
        </div>
      )}
    </>
  );
}
