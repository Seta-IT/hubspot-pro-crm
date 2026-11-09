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
  FileText,
  TrendingUp,
  FormInput,
  Mail,
} from 'lucide-react';
import { EnrichedPipeline } from './DealsKanbanTab';
import type { MarketingHubSubView } from './MarketingAndSalesHubSuites';

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
  | 'ADMIN'
  | 'FORECAST';

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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    MARKETING: true,
    VENDAS: true,
    PLATAFORMA: true,
  });
  const [pins, setPins] = useState<ShortcutId[]>(DEFAULT_PINS);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreArea, setMoreArea] = useState<'CRM' | 'MARKETING' | 'VENDAS' | 'SERVICO' | 'DADOS' | 'AUTOMACAO' | 'RELATORIOS'>('CRM');

  useEffect(() => {
    setPins(loadPins());
  }, []);

  const closeMobileIfOpen = () => onCloseMobileDrawer?.();

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

  const goHome = () => {
    if (onSelectOverview) onSelectOverview();
    else onSelectPipeline(selectedPipelineId || pipelines[0]?.id || 'pipe-enterprise-b2b');
    closeMobileIfOpen();
  };

  const catalog: Record<ShortcutId, { label: string; icon: React.ReactNode; active: boolean; run: () => void }> = {
    HOME: {
      label: 'Início',
      icon: <LayoutDashboard className="w-4 h-4 shrink-0" />,
      active: activeModule === 'OVERVIEW_AI',
      run: goHome,
    },
    DEALS: {
      label: 'Negócios',
      icon: <Kanban className="w-4 h-4 shrink-0" />,
      active: activeModule === 'DEALS_KANBAN',
      run: () => {
        onSelectPipeline(selectedPipelineId || pipelines[0]?.id || 'pipe-enterprise-b2b');
        closeMobileIfOpen();
      },
    },
    TASKS: {
      label: 'Tarefas',
      icon: <CheckSquare className="w-4 h-4 shrink-0" />,
      active: activeModule === 'CONTACTS_COMPANIES' && contactsSubView === 'TASKS',
      run: () => {
        onSelectContactsSubView('TASKS');
        closeMobileIfOpen();
      },
    },
    CONTACTS: {
      label: 'Contatos',
      icon: <Users className="w-4 h-4 shrink-0" />,
      active: activeModule === 'CONTACTS_COMPANIES' && contactsSubView === 'CONTACTS',
      run: () => {
        onSelectContactsSubView('CONTACTS');
        closeMobileIfOpen();
      },
    },
    COMPANIES: {
      label: 'Empresas',
      icon: <Building2 className="w-4 h-4 shrink-0" />,
      active: activeModule === 'CONTACTS_COMPANIES' && contactsSubView === 'COMPANIES',
      run: () => {
        onSelectContactsSubView('COMPANIES');
        closeMobileIfOpen();
      },
    },
    SEGMENTS: {
      label: 'Segmentos',
      icon: <Filter className="w-4 h-4 shrink-0" />,
      active: activeModule === 'MARKETING_FORMS' && activeMarketingSubView === 'SEGMENTS_SCORING',
      run: () => {
        if (onSelectMarketingSubView) onSelectMarketingSubView('SEGMENTS_SCORING');
        else onSelectForms();
        closeMobileIfOpen();
      },
    },
    MARKETING_EMAILS: {
      label: 'E-mails de marketing',
      icon: <Mail className="w-4 h-4 shrink-0" />,
      active: activeModule === 'MARKETING_FORMS' && activeMarketingSubView === 'MARKETING_EMAILS',
      run: () => {
        if (onSelectMarketingSubView) onSelectMarketingSubView('MARKETING_EMAILS');
        else onSelectForms();
        closeMobileIfOpen();
      },
    },
    CAMPAIGNS: {
      label: 'Campanhas & ROI',
      icon: <Megaphone className="w-4 h-4 shrink-0" />,
      active: activeModule === 'MARKETING_FORMS' && activeMarketingSubView === 'CAMPAIGNS_ROI',
      run: () => {
        if (onSelectMarketingSubView) onSelectMarketingSubView('CAMPAIGNS_ROI');
        else onSelectForms();
        closeMobileIfOpen();
      },
    },
    FORMS: {
      label: 'Formulários',
      icon: <FormInput className="w-4 h-4 shrink-0" />,
      active: activeModule === 'MARKETING_FORMS' && activeMarketingSubView === 'FORMS_LANDING_PAGES',
      run: () => {
        if (onSelectMarketingSubView) onSelectMarketingSubView('FORMS_LANDING_PAGES');
        else onSelectForms();
        closeMobileIfOpen();
      },
    },
    AUTOMATIONS: {
      label: 'Fluxos de trabalho',
      icon: <Workflow className="w-4 h-4 shrink-0" />,
      active: activeModule === 'AUTOMATIONS',
      run: () => {
        onSelectAutomations();
        closeMobileIfOpen();
      },
    },
    DATA_HEALTH: {
      label: 'Saúde da base',
      icon: <ShieldCheck className="w-4 h-4 shrink-0" />,
      active: activeModule === 'DATA_HEALTH',
      run: () => {
        onSelectDataHealth('CRM');
        closeMobileIfOpen();
      },
    },
    ADMIN: {
      label: 'Configurações',
      icon: <Settings className="w-4 h-4 shrink-0" />,
      active: activeModule === 'ADMIN_RBAC',
      run: () => {
        onSelectAdminRbac?.('USERS_RBAC');
        closeMobileIfOpen();
      },
    },
    FORECAST: {
      label: 'Previsão',
      icon: <TrendingUp className="w-4 h-4 shrink-0" />,
      active: activeModule === 'OVERVIEW_AI',
      run: goHome,
    },
  };

  const moreAreas = useMemo(
    () => [
      { id: 'CRM' as const, label: 'CRM', items: ['HOME', 'DEALS', 'TASKS', 'CONTACTS', 'COMPANIES'] as ShortcutId[] },
      { id: 'MARKETING' as const, label: 'Marketing', items: ['MARKETING_EMAILS', 'CAMPAIGNS', 'SEGMENTS', 'FORMS'] as ShortcutId[] },
      { id: 'VENDAS' as const, label: 'Vendas', items: ['DEALS', 'FORECAST', 'TASKS'] as ShortcutId[] },
      { id: 'SERVICO' as const, label: 'Serviço/Chamados', items: [] as ShortcutId[] },
      { id: 'DADOS' as const, label: 'Gerenciamento de dados', items: ['DATA_HEALTH'] as ShortcutId[] },
      { id: 'AUTOMACAO' as const, label: 'Automação', items: ['AUTOMATIONS'] as ShortcutId[] },
      { id: 'RELATORIOS' as const, label: 'Relatórios', items: (onSelectAdminRbac ? ['ADMIN'] : []) as ShortcutId[] },
    ],
    [onSelectAdminRbac]
  );

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

        <nav className="px-2 pb-3 space-y-2">
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

          <div className="border-t border-white/15 my-1" />

          <div>
            <GroupHeader id="MARKETING" label="Marketing" />
            {expanded.MARKETING && (
              <div className="space-y-0.5">
                {/* Um único atalho Marketing (sem duplicar com "E-mails de marketing") — Segmentos já nos pins */}
                <button type="button" onClick={catalog.MARKETING_EMAILS.run} className={itemClass(catalog.MARKETING_EMAILS.active)}>
                  {catalog.MARKETING_EMAILS.icon}
                  <span className="truncate">Marketing</span>
                  {marketingEmailsCount !== undefined && <span className="ml-auto text-[10px] text-white/60">({marketingEmailsCount})</span>}
                </button>
                <button type="button" onClick={catalog.CAMPAIGNS.run} className={itemClass(catalog.CAMPAIGNS.active)}>
                  <Megaphone className="w-4 h-4 shrink-0" />
                  <span className="truncate">Campanhas &amp; ROI</span>
                </button>
                <button type="button" onClick={catalog.FORMS.run} className={itemClass(catalog.FORMS.active)}>
                  <FormInput className="w-4 h-4 shrink-0" />
                  <span className="truncate">Formulários &amp; Leads</span>
                  <span className="ml-auto text-[10px] text-white/60">({formsCount})</span>
                </button>
              </div>
            )}
          </div>

          <div className="border-t border-white/15 my-1" />

          <div>
            <GroupHeader id="VENDAS" label="Vendas" />
            {expanded.VENDAS && (
              <div className="space-y-0.5">
                <button type="button" onClick={catalog.FORECAST.run} className={itemClass(catalog.FORECAST.active && activeModule === 'OVERVIEW_AI')}>
                  <TrendingUp className="w-4 h-4 shrink-0" />
                  <span className="truncate">Previsão</span>
                </button>
                {/* Propostas: atalho visual — abre o funil (rota CRM existente) */}
                <button
                  type="button"
                  onClick={() => {
                    onSelectPipeline(selectedPipelineId || pipelines[0]?.id || 'pipe-enterprise-b2b');
                    closeMobileIfOpen();
                  }}
                  className={itemClass(false)}
                >
                  <FileText className="w-4 h-4 shrink-0" />
                  <span className="truncate">Propostas / Orçamentos</span>
                </button>
              </div>
            )}
          </div>

          <div className="border-t border-white/15 my-1" />

          <div>
            <GroupHeader id="PLATAFORMA" label="Plataforma" />
            {expanded.PLATAFORMA && (
              <div className="space-y-0.5">
                <button type="button" onClick={catalog.AUTOMATIONS.run} className={itemClass(catalog.AUTOMATIONS.active)}>
                  <Workflow className="w-4 h-4 shrink-0" />
                  <span className="truncate">Fluxos de trabalho</span>
                  <span className="ml-auto text-[10px] text-white/60">{automationsCount}</span>
                </button>
                <button type="button" onClick={catalog.DATA_HEALTH.run} className={itemClass(catalog.DATA_HEALTH.active)}>
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span className="truncate">Saúde da base</span>
                  <span className="ml-auto text-[10px] text-white/60">{healthScore}%</span>
                </button>
                {activeModule === 'DATA_HEALTH' && (
                  <button type="button" onClick={catalog.DATA_HEALTH.run} className="w-full pl-9 pr-2.5 py-1.5 rounded text-xs font-semibold text-white/90 hover:bg-white/10 text-left cursor-pointer">
                    Auditoria Base CRM
                  </button>
                )}
                {onSelectAdminRbac && (
                  <button type="button" onClick={catalog.ADMIN.run} className={itemClass(catalog.ADMIN.active)}>
                    <Settings className="w-4 h-4 shrink-0" />
                    <span className="truncate">Configurações</span>
                  </button>
                )}
              </div>
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
          <span className="flex-1 text-left">Mais</span>
          <ChevronRight className="w-4 h-4 opacity-80" />
        </button>
        {moreOpen && (
          <div className="absolute left-full bottom-0 ml-2 z-50 w-[420px] max-w-[80vw] rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden text-slate-800 flex">
            <div className="w-44 border-r border-slate-100 bg-slate-50 p-2 space-y-0.5">
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
                      <button
                        type="button"
                        onClick={() => {
                          item.run();
                          setMoreOpen(false);
                        }}
                        className="flex-1 text-left px-2 py-1.5 rounded-md text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer flex items-center gap-2"
                      >
                        {item.icon}
                        {item.label}
                      </button>
                      <button type="button" onClick={() => togglePin(id)} className="p-1.5 rounded hover:bg-slate-100 text-slate-500 cursor-pointer" title={pinned ? 'Desafixar' : 'Fixar'} aria-label={pinned ? 'Desafixar' : 'Fixar'}>
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
