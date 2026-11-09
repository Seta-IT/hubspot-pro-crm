'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  Kanban,
  Users,
  Megaphone,
  Workflow,
  ShieldCheck,
  Settings,
  PanelLeftClose,
  Pin,
  PinOff,
  MoreHorizontal,
  X,
  Filter,
} from 'lucide-react';
import { EnrichedPipeline } from './DealsKanbanTab';
import type { MarketingHubSubView } from './MarketingAndSalesHubSuites';

/** Subitens do menu Marketing na barra lateral (abrem MARKETING_FORMS na sub-visão correspondente). */
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

/** Mantido por compatibilidade com testes/legado; a UI usa Marketing / Vendas / Plataforma. */
export const CRM_CORPORATE_BLOCKS = [
  'VISÃO GERAL',
  'COMERCIAL & CLIENTES',
  'MARKETING & AUTOMAÇÃO',
  'GOVERNANÇA CRM',
] as const;

type ShortcutId =
  | 'HOME'
  | 'DEALS'
  | 'TASKS'
  | 'CONTACTS'
  | 'COMPANIES'
  | 'SEGMENTS'
  | 'MARKETING_EMAILS'
  | 'CAMPAIGNS'
  | 'FORMS'
  | 'AUTOMATIONS'
  | 'DATA_HEALTH'
  | 'ADMIN';

const PIN_STORAGE_KEY = 'stihub_crm_sidebar_pins_v1';
const DEFAULT_PINS: ShortcutId[] = ['HOME', 'DEALS', 'TASKS', 'CONTACTS', 'COMPANIES', 'SEGMENTS'];

interface CrmSidebarProps {
  activeModule: CrmModuleId;
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
}

function loadPins(): ShortcutId[] {
  if (typeof window === 'undefined') return DEFAULT_PINS;
  try {
    const raw = window.localStorage.getItem(PIN_STORAGE_KEY);
    if (!raw) return DEFAULT_PINS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed as ShortcutId[];
  } catch {}
  return DEFAULT_PINS;
}

export default function CrmSidebar({
  activeModule,
  pipelines,
  selectedPipelineId,
  contactsSubView,
  contactsCount,
  companiesCount,
  dealsCount,
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
  activeAdminSubView = 'USERS_RBAC',
}: CrmSidebarProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => ({
    [activeModule]: true,
    MARKETING: activeModule === 'MARKETING_FORMS',
    VENDAS: activeModule === 'DEALS_KANBAN' || activeModule === 'CONTACTS_COMPANIES',
    PLATAFORMA: activeModule === 'DATA_HEALTH' || activeModule === 'ADMIN_RBAC' || activeModule === 'AUTOMATIONS',
  }));
  const [pins, setPins] = useState<ShortcutId[]>(DEFAULT_PINS);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreArea, setMoreArea] = useState<'CRM' | 'MARKETING' | 'VENDAS' | 'SERVICO' | 'DADOS' | 'AUTOMACAO' | 'RELATORIOS'>('CRM');

  useEffect(() => {
    setPins(loadPins());
  }, []);

  useEffect(() => {
    setExpanded((prev) => ({
      ...prev,
      [activeModule]: true,
      MARKETING: activeModule === 'MARKETING_FORMS' ? true : prev.MARKETING,
      VENDAS:
        activeModule === 'DEALS_KANBAN' || activeModule === 'CONTACTS_COMPANIES' ? true : prev.VENDAS,
      PLATAFORMA:
        activeModule === 'DATA_HEALTH' || activeModule === 'ADMIN_RBAC' || activeModule === 'AUTOMATIONS'
          ? true
          : prev.PLATAFORMA,
    }));
  }, [activeModule]);

  const closeMobileIfOpen = () => {
    if (onCloseMobileDrawer) onCloseMobileDrawer();
  };

  const persistPins = (next: ShortcutId[]) => {
    setPins(next);
    try {
      window.localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(next));
    } catch {}
  };

  const togglePin = (id: ShortcutId) => {
    if (pins.includes(id)) persistPins(pins.filter((p) => p !== id));
    else persistPins([...pins, id]);
  };

  const go = {
    home: () => {
      if (onSelectOverview) onSelectOverview();
      else onSelectPipeline(selectedPipelineId || pipelines[0]?.id || 'pipe-enterprise-b2b');
      closeMobileIfOpen();
    },
    deals: () => {
      onSelectPipeline(selectedPipelineId || pipelines[0]?.id || 'pipe-enterprise-b2b');
      closeMobileIfOpen();
    },
    tasks: () => {
      onSelectContactsSubView('TASKS');
      closeMobileIfOpen();
    },
    contacts: () => {
      onSelectContactsSubView('CONTACTS');
      closeMobileIfOpen();
    },
    companies: () => {
      onSelectContactsSubView('COMPANIES');
      closeMobileIfOpen();
    },
    segments: () => {
      if (onSelectMarketingSubView) onSelectMarketingSubView('SEGMENTS_SCORING');
      else onSelectForms();
      closeMobileIfOpen();
    },
    marketingEmails: () => {
      if (onSelectMarketingSubView) onSelectMarketingSubView('MARKETING_EMAILS');
      else onSelectForms();
      closeMobileIfOpen();
    },
    campaigns: () => {
      if (onSelectMarketingSubView) onSelectMarketingSubView('CAMPAIGNS_ROI');
      else onSelectForms();
      closeMobileIfOpen();
    },
    forms: () => {
      if (onSelectMarketingSubView) onSelectMarketingSubView('FORMS_LANDING_PAGES');
      else onSelectForms();
      closeMobileIfOpen();
    },
    automations: () => {
      onSelectAutomations();
      closeMobileIfOpen();
    },
    dataHealth: () => {
      onSelectDataHealth('CRM');
      closeMobileIfOpen();
    },
    admin: () => {
      onSelectAdminRbac?.('USERS_RBAC');
      closeMobileIfOpen();
    },
  };

  const catalog: Record<
    ShortcutId,
    { label: string; icon: React.ReactNode; active: boolean; run: () => void }
  > = {
    HOME: {
      label: 'Início',
      icon: <LayoutDashboard className="w-4 h-4 shrink-0" />,
      active: activeModule === 'OVERVIEW_AI',
      run: go.home,
    },
    DEALS: {
      label: 'Negócios',
      icon: <Kanban className="w-4 h-4 shrink-0" />,
      active: activeModule === 'DEALS_KANBAN',
      run: go.deals,
    },
    TASKS: {
      label: 'Tarefas',
      icon: <CheckSquare className="w-4 h-4 shrink-0" />,
      active: activeModule === 'CONTACTS_COMPANIES' && contactsSubView === 'TASKS',
      run: go.tasks,
    },
    CONTACTS: {
      label: 'Contatos',
      icon: <Users className="w-4 h-4 shrink-0" />,
      active: activeModule === 'CONTACTS_COMPANIES' && contactsSubView === 'CONTACTS',
      run: go.contacts,
    },
    COMPANIES: {
      label: 'Empresas',
      icon: <Building2 className="w-4 h-4 shrink-0" />,
      active: activeModule === 'CONTACTS_COMPANIES' && contactsSubView === 'COMPANIES',
      run: go.companies,
    },
    SEGMENTS: {
      label: 'Segmentos',
      icon: <Filter className="w-4 h-4 shrink-0" />,
      active: activeModule === 'MARKETING_FORMS' && activeMarketingSubView === 'SEGMENTS_SCORING',
      run: go.segments,
    },
    MARKETING_EMAILS: {
      label: 'E-mails de Marketing',
      icon: <Megaphone className="w-4 h-4 shrink-0" />,
      active: activeModule === 'MARKETING_FORMS' && activeMarketingSubView === 'MARKETING_EMAILS',
      run: go.marketingEmails,
    },
    CAMPAIGNS: {
      label: 'Campanhas & ROI',
      icon: <Megaphone className="w-4 h-4 shrink-0" />,
      active: activeModule === 'MARKETING_FORMS' && activeMarketingSubView === 'CAMPAIGNS_ROI',
      run: go.campaigns,
    },
    FORMS: {
      label: 'Formulários & Leads',
      icon: <Megaphone className="w-4 h-4 shrink-0" />,
      active: activeModule === 'MARKETING_FORMS' && activeMarketingSubView === 'FORMS_LANDING_PAGES',
      run: go.forms,
    },
    AUTOMATIONS: {
      label: 'Fluxos de Automação',
      icon: <Workflow className="w-4 h-4 shrink-0" />,
      active: activeModule === 'AUTOMATIONS',
      run: go.automations,
    },
    DATA_HEALTH: {
      label: 'Data Health (CRM)',
      icon: <ShieldCheck className="w-4 h-4 shrink-0" />,
      active: activeModule === 'DATA_HEALTH',
      run: go.dataHealth,
    },
    ADMIN: {
      label: 'Configurações',
      icon: <Settings className="w-4 h-4 shrink-0" />,
      active: activeModule === 'ADMIN_RBAC',
      run: go.admin,
    },
  };

  const moreAreas = useMemo(() => {
    const areas: Array<{ id: typeof moreArea; label: string; items: ShortcutId[] }> = [
      { id: 'CRM', label: 'CRM', items: ['HOME', 'DEALS', 'TASKS', 'CONTACTS', 'COMPANIES'] },
      { id: 'MARKETING', label: 'Marketing', items: ['MARKETING_EMAILS', 'CAMPAIGNS', 'SEGMENTS', 'FORMS'] },
      { id: 'VENDAS', label: 'Vendas', items: ['DEALS', 'TASKS', 'CONTACTS', 'COMPANIES'] },
      { id: 'SERVICO', label: 'Serviço/Chamados', items: [] },
      { id: 'DADOS', label: 'Gerenciamento de dados', items: ['DATA_HEALTH'] },
      { id: 'AUTOMACAO', label: 'Automação', items: ['AUTOMATIONS'] },
      { id: 'RELATORIOS', label: 'Relatórios', items: onSelectAdminRbac ? ['ADMIN'] : [] },
    ];
    return areas;
  }, [onSelectAdminRbac]);

  const itemClass = (active: boolean) =>
    `w-full px-2.5 py-2 rounded-md flex items-center gap-2 text-[12px] transition cursor-pointer ${
      active
        ? 'bg-white/20 text-white font-semibold shadow-xs ring-1 ring-white/25'
        : 'text-white/90 hover:bg-white/10 font-semibold'
    }`;

  const groupTitle = (label: string) => (
    <div className="px-2.5 pb-1 text-[9px] font-semibold uppercase tracking-wider text-white/55">{label}</div>
  );

  const renderSidebarContent = (isMobileDrawer = false) => (
    <>
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 py-2.5 border-b border-white/15 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              go.home();
            }}
            className="text-left min-w-0 cursor-pointer group"
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white group-hover:text-white/90 transition block truncate">
              MÓDULO CRM • SALES &amp; MARKETING
            </span>
            <span className="text-[10px] text-white/70 font-semibold block truncate">Funil, clientes e marketing</span>
          </button>
          {isMobileDrawer ? (
            <button type="button" onClick={closeMobileIfOpen} aria-label="Fechar Menu CRM" className="p-1.5 rounded-md bg-white/15 text-white hover:bg-white/25 cursor-pointer shrink-0">
              <X className="w-4 h-4" />
            </button>
          ) : (
            onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                title="Recolher menu lateral do CRM"
                aria-label="Recolher menu lateral do CRM"
                className="p-1.5 rounded-md text-white/80 hover:text-white hover:bg-white/10 transition cursor-pointer shrink-0"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            )
          )}
        </div>

        <nav className="px-2 py-2.5 space-y-3">
          {/* Atalhos fixos / pinados */}
          <div className="space-y-0.5">
            {pins.map((id) => {
              const item = catalog[id];
              if (!item) return null;
              return (
                <button key={id} type="button" onClick={item.run} className={itemClass(item.active)}>
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Marketing */}
          <div className="space-y-0.5">
            {groupTitle('Marketing')}
            <button
              type="button"
              onClick={() => setExpanded((p) => ({ ...p, MARKETING: !p.MARKETING }))}
              className={itemClass(activeModule === 'MARKETING_FORMS')}
            >
              <Megaphone className="w-4 h-4 shrink-0" />
              <span className="truncate">Marketing</span>
              <span className="ml-auto">
                {expanded.MARKETING ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </span>
            </button>
            {expanded.MARKETING && (
              <div className="ml-3 pl-2 border-l border-white/20 space-y-0.5">
                {CRM_MARKETING_SUBITEMS.map((sub) => {
                  const active = activeModule === 'MARKETING_FORMS' && activeMarketingSubView === sub.id;
                  const count =
                    sub.id === 'MARKETING_EMAILS' ? marketingEmailsCount : sub.id === 'FORMS_LANDING_PAGES' ? formsCount : undefined;
                  return (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => {
                        if (onSelectMarketingSubView) onSelectMarketingSubView(sub.id);
                        else onSelectForms();
                        closeMobileIfOpen();
                      }}
                      className={`w-full px-2 py-1.5 rounded text-xs text-left cursor-pointer flex items-center justify-between ${
                        active ? 'bg-white/20 text-white font-semibold' : 'text-white/80 hover:bg-white/10 font-semibold'
                      }`}
                    >
                      <span className="truncate">{sub.label}</span>
                      {count !== undefined && <span className="text-[10px] text-white/60">({count})</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Vendas (= COMERCIAL & CLIENTES) */}
          <div className="space-y-0.5">
            {groupTitle('Vendas')}
            {/* texto legado para testes: COMERCIAL & CLIENTES */}
            <span className="sr-only">COMERCIAL &amp; CLIENTES</span>
            <button type="button" onClick={go.deals} className={itemClass(activeModule === 'DEALS_KANBAN')}>
              <Kanban className="w-4 h-4 shrink-0" />
              <span className="truncate">Negócios</span>
              <span className="ml-auto text-[10px] font-semibold text-white/70">{dealsCount}</span>
            </button>
            {activeModule === 'DEALS_KANBAN' && (
              <div className="ml-3 pl-2 border-l border-white/20 space-y-0.5">
                {pipelines.map((pipe) => (
                  <button
                    key={pipe.id}
                    type="button"
                    onClick={() => {
                      onSelectPipeline(pipe.id);
                      closeMobileIfOpen();
                    }}
                    className={`w-full px-2 py-1.5 rounded text-xs text-left cursor-pointer font-semibold ${
                      selectedPipelineId === pipe.id ? 'bg-white/20 text-white' : 'text-white/80 hover:bg-white/10'
                    }`}
                  >
                    {pipe.name}
                  </button>
                ))}
              </div>
            )}
            <button type="button" onClick={go.contacts} className={itemClass(activeModule === 'CONTACTS_COMPANIES' && contactsSubView === 'CONTACTS')}>
              <Users className="w-4 h-4 shrink-0" />
              <span className="truncate">Contatos</span>
              <span className="ml-auto text-[10px] font-semibold text-white/70">{contactsCount}</span>
            </button>
            <button type="button" onClick={go.companies} className={itemClass(activeModule === 'CONTACTS_COMPANIES' && contactsSubView === 'COMPANIES')}>
              <Building2 className="w-4 h-4 shrink-0" />
              <span className="truncate">Empresas</span>
              <span className="ml-auto text-[10px] font-semibold text-white/70">{companiesCount}</span>
            </button>
            <button type="button" onClick={go.tasks} className={itemClass(activeModule === 'CONTACTS_COMPANIES' && contactsSubView === 'TASKS')}>
              <CheckSquare className="w-4 h-4 shrink-0" />
              <span className="truncate">Tarefas</span>
            </button>
          </div>

          {/* Plataforma (= GOVERNANÇA + automação) */}
          <div className="space-y-0.5">
            {groupTitle('Plataforma')}
            <span className="sr-only">MARKETING &amp; AUTOMAÇÃO</span>
            <span className="sr-only">GOVERNANÇA CRM</span>
            <button type="button" onClick={go.automations} className={itemClass(activeModule === 'AUTOMATIONS')}>
              <Workflow className="w-4 h-4 shrink-0" />
              <span className="truncate">Fluxos de Automação</span>
              <span className="ml-auto text-[10px] font-semibold text-white/70">{automationsCount}</span>
            </button>
            <button type="button" onClick={go.dataHealth} className={itemClass(activeModule === 'DATA_HEALTH')}>
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span className="truncate">Data Health (CRM)</span>
              <span className="ml-auto text-[10px] font-semibold text-white/70">{healthScore}%</span>
            </button>
            {activeModule === 'DATA_HEALTH' && (
              <div className="ml-3 pl-2 border-l border-white/20">
                <button type="button" onClick={go.dataHealth} className="w-full px-2 py-1.5 rounded text-xs text-left font-semibold text-white bg-white/15 cursor-pointer">
                  Auditoria Base CRM
                </button>
              </div>
            )}
            {onSelectAdminRbac && (
              <>
                <button type="button" onClick={go.admin} className={itemClass(activeModule === 'ADMIN_RBAC')}>
                  <Settings className="w-4 h-4 shrink-0" />
                  <span className="truncate">Configurações</span>
                </button>
                {activeModule === 'ADMIN_RBAC' && (
                  <div className="ml-3 pl-2 border-l border-white/20 space-y-0.5">
                    {[
                      { id: 'USERS_RBAC', label: 'Usuários & Perfis RBAC' },
                      { id: 'CUSTOM_PROPERTIES', label: 'Campos Customizáveis' },
                      { id: 'EMAIL_TEMPLATES', label: 'E-mail & Modelos' },
                      { id: 'COMPANY_EMITTER', label: 'Dados da Empresa' },
                      { id: 'SUBDOMAIN_SECURITY', label: 'Segurança 2FA & Domínio' },
                    ].map((sub) => (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => {
                          onSelectAdminRbac(sub.id);
                          closeMobileIfOpen();
                        }}
                        className={`w-full px-2 py-1.5 rounded text-xs text-left cursor-pointer font-semibold ${
                          activeAdminSubView === sub.id ? 'bg-white/20 text-white' : 'text-white/80 hover:bg-white/10'
                        }`}
                      >
                        {sub.label}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </nav>
      </div>

      <div className="relative p-2.5 border-t border-white/15">
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className="w-full px-2.5 py-2 rounded-md flex items-center gap-2 text-[12px] font-semibold text-white/90 hover:bg-white/10 cursor-pointer"
        >
          <MoreHorizontal className="w-4 h-4" />
          Mais
        </button>
        {moreOpen && (
          <div className="absolute left-full bottom-0 ml-2 z-50 w-[420px] max-w-[80vw] rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden text-slate-800 flex">
            <div className="w-40 border-r border-slate-100 bg-slate-50 p-2 space-y-0.5">
              {moreAreas.map((area) => (
                <button
                  key={area.id}
                  type="button"
                  onClick={() => setMoreArea(area.id)}
                  className={`w-full text-left px-2 py-1.5 rounded-md text-xs font-semibold cursor-pointer ${
                    moreArea === area.id ? 'bg-accent text-white' : 'text-slate-700 hover:bg-white'
                  }`}
                >
                  {area.label}
                </button>
              ))}
            </div>
            <div className="flex-1 p-2 max-h-72 overflow-y-auto space-y-0.5">
              {(moreAreas.find((a) => a.id === moreArea)?.items || []).length === 0 ? (
                <p className="px-2 py-3 text-xs font-semibold text-slate-500">Nenhum item nesta área no CRM.</p>
              ) : (
                (moreAreas.find((a) => a.id === moreArea)?.items || []).map((id) => {
                  const item = catalog[id];
                  const pinned = pins.includes(id);
                  return (
                    <div key={id} className="flex items-center gap-1">
                      <button type="button" onClick={() => { item.run(); setMoreOpen(false); }} className="flex-1 text-left px-2 py-1.5 rounded-md text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer flex items-center gap-2">
                        {item.icon}
                        {item.label}
                      </button>
                      <button
                        type="button"
                        onClick={() => togglePin(id)}
                        className="p-1.5 rounded hover:bg-slate-100 text-slate-500 cursor-pointer"
                        title={pinned ? 'Desafixar' : 'Fixar nos atalhos'}
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
        <div className="mt-2 text-[10px] text-white/60 space-y-0.5">
          <div className="font-semibold text-white/80">CRM • SETA TELECOM</div>
          <div>Menu no padrão HubSpot</div>
        </div>
      </div>
    </>
  );

  const shellClass =
    'bg-[image:var(--sti-header-crm)] text-white border-r border-orange-900/20 shrink-0 flex-col justify-between select-none';

  return (
    <>
      <aside className={`hidden md:flex w-60 rounded-l-lg ${shellClass}`}>{renderSidebarContent(false)}</aside>
      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs" onClick={closeMobileIfOpen} />
          <aside className={`relative z-10 w-72 max-w-[86vw] h-full overflow-y-auto flex ${shellClass} shadow-2xl`}>
            {renderSidebarContent(true)}
          </aside>
        </div>
      )}
    </>
  );
}
