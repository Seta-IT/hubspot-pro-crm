'use client';

import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Kanban,
  Users,
  Megaphone,
  Workflow,
  ShieldCheck,
  Settings,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  X,
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

export const CRM_CORPORATE_BLOCKS = [
  'VISÃO GERAL',
  'COMERCIAL & CLIENTES',
  'MARKETING & AUTOMAÇÃO',
  'GOVERNANÇA CRM',
] as const;

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
  // Modo Acordeão Inteligente: inicia apenas o grupo ativo expandido
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => ({
    [activeModule]: true,
  }));

  useEffect(() => {
    setExpanded({ [activeModule]: true });
  }, [activeModule]);

  const closeMobileIfOpen = () => {
    if (onCloseMobileDrawer) onCloseMobileDrawer();
  };

  const toggleGroup = (key: string, defaultAction: () => void) => {
    if (activeModule === key) {
      setExpanded((prev) => ({ [key]: !prev[key] }));
    } else {
      setExpanded({ [key]: true });
      defaultAction();
    }
  };

  const renderSidebarContent = (isMobileDrawer = false) => (
    <>
      <div>
        {/* CABEÇALHO CORPORATIVO COMPACTO DO MÓDULO CRM */}
        <div className="px-3 py-2.5 bg-white border-b border-slate-200 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              if (onSelectOverview) onSelectOverview();
              else onSelectPipeline(selectedPipelineId || pipelines[0]?.id || 'pipe-enterprise-b2b');
              closeMobileIfOpen();
            }}
            className="text-left min-w-0 cursor-pointer group"
          >
            <span className="text-[10px] font-black uppercase tracking-wider text-[#0d2b4e] group-hover:text-[#ff7a59] transition block truncate">
              MÓDULO CRM • SALES &amp; MARKETING
            </span>
            <span className="text-[10px] text-slate-500 font-semibold block truncate">
              Funil Comercial, Clientes &amp; IA
            </span>
          </button>

          {isMobileDrawer ? (
            <button
              type="button"
              onClick={closeMobileIfOpen}
              aria-label="Fechar Menu CRM"
              className="p-1.5 rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                title="Recolher menu lateral do CRM"
                aria-label="Recolher menu lateral do CRM"
                className="p-1.5 rounded-md text-slate-500 hover:text-[#0d2b4e] hover:bg-slate-100 transition cursor-pointer shrink-0"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            )
          )}
        </div>

        {/* NAVEGAÇÃO VERTICAL DO CRM EM 4 BLOCOS CORPORATIVOS */}
        <nav className="px-2 py-2.5 space-y-3">
          {/* BLOCO 1: VISÃO GERAL */}
          <div className="space-y-0.5">
            <div className="px-2.5 pb-1 text-[9px] font-extrabold uppercase tracking-wider text-slate-400">
              VISÃO GERAL
            </div>
            {onSelectOverview && (
              <div className="rounded-md">
                <button
                  type="button"
                  onClick={() => {
                    setExpanded({});
                    onSelectOverview();
                    closeMobileIfOpen();
                  }}
                  className={`w-full px-2.5 py-2 rounded-md flex items-center justify-between text-[12px] transition cursor-pointer ${
                    activeModule === 'OVERVIEW_AI'
                      ? 'bg-[#213343] text-white font-extrabold shadow-xs'
                      : 'text-[#1e3a6e] hover:bg-white font-bold'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <LayoutDashboard
                      className={`w-4 h-4 shrink-0 ${
                        activeModule === 'OVERVIEW_AI' ? 'text-[#ff7a59]' : 'text-[#1e3a6e]'
                      }`}
                    />
                    <span className="truncate">Dashboard CRM</span>
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* BLOCO 2: COMERCIAL & CLIENTES */}
          <div className="space-y-0.5">
            <div className="px-2.5 pb-1 text-[9px] font-extrabold uppercase tracking-wider text-slate-400">
              COMERCIAL &amp; CLIENTES
            </div>

            {/* Negócios (Funil Kanban) */}
            <div className="rounded-md">
              <button
                type="button"
                onClick={() =>
                  toggleGroup('DEALS_KANBAN', () => {
                    onSelectPipeline(selectedPipelineId || pipelines[0]?.id || 'pipe-enterprise-b2b');
                    closeMobileIfOpen();
                  })
                }
                className={`w-full px-2.5 py-2 rounded-md flex items-center justify-between text-[12px] transition cursor-pointer ${
                  activeModule === 'DEALS_KANBAN'
                    ? 'bg-[#213343] text-white font-extrabold shadow-xs'
                    : 'text-[#1e3a6e] hover:bg-white font-bold'
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  <Kanban
                    className={`w-4 h-4 shrink-0 ${
                      activeModule === 'DEALS_KANBAN' ? 'text-[#ff7a59]' : 'text-[#1e3a6e]'
                    }`}
                  />
                  <span className="truncate">Negócios (Funil Kanban)</span>
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                      activeModule === 'DEALS_KANBAN'
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-200/80 text-slate-600'
                    }`}
                  >
                    {dealsCount}
                  </span>
                  {expanded.DEALS_KANBAN ? (
                    <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                  )}
                </span>
              </button>

              {expanded.DEALS_KANBAN && (
                <div className="ml-3.5 pl-2.5 my-1 border-l-2 border-[#213343]/25 space-y-0.5">
                  {pipelines.map((pipe) => {
                    const isPipeActive =
                      activeModule === 'DEALS_KANBAN' && selectedPipelineId === pipe.id;
                    return (
                      <button
                        key={pipe.id}
                        type="button"
                        onClick={() => {
                          onSelectPipeline(pipe.id);
                          closeMobileIfOpen();
                        }}
                        className={`w-full px-2.5 py-1.5 rounded flex items-center justify-between text-xs text-left transition cursor-pointer ${
                          isPipeActive
                            ? 'bg-orange-50 text-[#0d2b4e] font-extrabold border-l-2 border-[#ff7a59]'
                            : 'text-slate-600 hover:text-[#0d2b4e] hover:bg-white font-semibold'
                        }`}
                      >
                        <span className="truncate">{pipe.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Contatos & Empresas */}
            <div className="rounded-md">
              <button
                type="button"
                onClick={() =>
                  toggleGroup('CONTACTS_COMPANIES', () => {
                    onSelectContactsSubView('CONTACTS');
                    closeMobileIfOpen();
                  })
                }
                className={`w-full px-2.5 py-2 rounded-md flex items-center justify-between text-[12px] transition cursor-pointer ${
                  activeModule === 'CONTACTS_COMPANIES'
                    ? 'bg-[#213343] text-white font-extrabold shadow-xs'
                    : 'text-[#1e3a6e] hover:bg-white font-bold'
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  <Users
                    className={`w-4 h-4 shrink-0 ${
                      activeModule === 'CONTACTS_COMPANIES' ? 'text-[#ff7a59]' : 'text-[#1e3a6e]'
                    }`}
                  />
                  <span className="truncate">Contatos &amp; Empresas</span>
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                      activeModule === 'CONTACTS_COMPANIES'
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-200/80 text-slate-600'
                    }`}
                  >
                    {contactsCount + companiesCount}
                  </span>
                  {expanded.CONTACTS_COMPANIES ? (
                    <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                  )}
                </span>
              </button>

              {expanded.CONTACTS_COMPANIES && (
                <div className="ml-3.5 pl-2.5 my-1 border-l-2 border-[#213343]/25 space-y-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      onSelectContactsSubView('CONTACTS');
                      closeMobileIfOpen();
                    }}
                    className={`w-full px-2.5 py-1.5 rounded flex items-center justify-between text-xs transition cursor-pointer ${
                      activeModule === 'CONTACTS_COMPANIES' && contactsSubView === 'CONTACTS'
                        ? 'bg-orange-50 text-[#0d2b4e] font-extrabold border-l-2 border-[#ff7a59]'
                        : 'text-slate-600 hover:text-[#0d2b4e] hover:bg-white font-semibold'
                    }`}
                  >
                    <span>Contatos CRM</span>
                    <span className="text-[10px] font-bold text-slate-400">({contactsCount})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectContactsSubView('COMPANIES');
                      closeMobileIfOpen();
                    }}
                    className={`w-full px-2.5 py-1.5 rounded flex items-center justify-between text-xs transition cursor-pointer ${
                      activeModule === 'CONTACTS_COMPANIES' && contactsSubView === 'COMPANIES'
                        ? 'bg-orange-50 text-[#0d2b4e] font-extrabold border-l-2 border-[#ff7a59]'
                        : 'text-slate-600 hover:text-[#0d2b4e] hover:bg-white font-semibold'
                    }`}
                  >
                    <span>Empresas CRM</span>
                    <span className="text-[10px] font-bold text-slate-400">({companiesCount})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectContactsSubView('TASKS');
                      closeMobileIfOpen();
                    }}
                    className={`w-full px-2.5 py-1.5 rounded flex items-center justify-between text-xs transition cursor-pointer ${
                      activeModule === 'CONTACTS_COMPANIES' && contactsSubView === 'TASKS'
                        ? 'bg-orange-50 text-[#0d2b4e] font-extrabold border-l-2 border-[#ff7a59]'
                        : 'text-slate-600 hover:text-[#0d2b4e] hover:bg-white font-semibold'
                    }`}
                  >
                    <span>Tarefas &amp; Follow-up</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* BLOCO 3: MARKETING & AUTOMAÇÃO */}
          <div className="space-y-0.5">
            <div className="px-2.5 pb-1 text-[9px] font-extrabold uppercase tracking-wider text-slate-400">
              MARKETING &amp; AUTOMAÇÃO
            </div>

            {/* Marketing (expansível): E-mails, Campanhas, Segmentos e Formulários */}
            <div className="rounded-md">
              <button
                type="button"
                onClick={() =>
                  toggleGroup('MARKETING_FORMS', () => {
                    if (onSelectMarketingSubView) onSelectMarketingSubView('MARKETING_EMAILS');
                    else onSelectForms();
                    closeMobileIfOpen();
                  })
                }
                className={`w-full px-2.5 py-2 rounded-md flex items-center justify-between text-[12px] transition cursor-pointer ${
                  activeModule === 'MARKETING_FORMS'
                    ? 'bg-[#213343] text-white font-extrabold shadow-xs'
                    : 'text-[#1e3a6e] hover:bg-white font-bold'
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  <Megaphone
                    className={`w-4 h-4 shrink-0 ${
                      activeModule === 'MARKETING_FORMS' ? 'text-[#ff7a59]' : 'text-[#1e3a6e]'
                    }`}
                  />
                  <span className="truncate">Marketing</span>
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  {expanded.MARKETING_FORMS ? (
                    <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                  )}
                </span>
              </button>

              {expanded.MARKETING_FORMS && (
                <div className="ml-3.5 pl-2.5 my-1 border-l-2 border-[#213343]/25 space-y-0.5">
                  {CRM_MARKETING_SUBITEMS.map((sub) => {
                    const isSubActive =
                      activeModule === 'MARKETING_FORMS' && activeMarketingSubView === sub.id;
                    const count =
                      sub.id === 'MARKETING_EMAILS'
                        ? marketingEmailsCount
                        : sub.id === 'FORMS_LANDING_PAGES'
                          ? formsCount
                          : undefined;
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => {
                          if (onSelectMarketingSubView) onSelectMarketingSubView(sub.id);
                          else onSelectForms();
                          closeMobileIfOpen();
                        }}
                        className={`w-full px-2.5 py-1.5 rounded flex items-center justify-between text-xs text-left transition cursor-pointer ${
                          isSubActive
                            ? 'bg-orange-50 text-[#0d2b4e] font-extrabold border-l-2 border-[#ff7a59]'
                            : 'text-slate-600 hover:text-[#0d2b4e] hover:bg-white font-semibold'
                        }`}
                      >
                        <span className="truncate">{sub.label}</span>
                        {count !== undefined && (
                          <span className="text-[10px] font-bold text-slate-400">({count})</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-md">
              <button
                type="button"
                onClick={() => {
                  setExpanded({});
                  onSelectAutomations();
                  closeMobileIfOpen();
                }}
                className={`w-full px-2.5 py-2 rounded-md flex items-center justify-between text-[12px] transition cursor-pointer ${
                  activeModule === 'AUTOMATIONS'
                    ? 'bg-[#213343] text-white font-extrabold shadow-xs'
                    : 'text-[#1e3a6e] hover:bg-white font-bold'
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  <Workflow
                    className={`w-4 h-4 shrink-0 ${
                      activeModule === 'AUTOMATIONS' ? 'text-[#ff7a59]' : 'text-[#1e3a6e]'
                    }`}
                  />
                  <span className="truncate">Fluxos de Automação</span>
                </span>
                <span
                  className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                    activeModule === 'AUTOMATIONS'
                      ? 'bg-white/20 text-white'
                      : 'bg-slate-200/80 text-slate-600'
                  }`}
                >
                  {automationsCount}
                </span>
              </button>
            </div>
          </div>

          {/* BLOCO 4: GOVERNANÇA CRM */}
          <div className="space-y-0.5">
            <div className="px-2.5 pb-1 text-[9px] font-extrabold uppercase tracking-wider text-slate-400">
              GOVERNANÇA CRM
            </div>

            <div className="rounded-md">
              <button
                type="button"
                onClick={() =>
                  toggleGroup('DATA_HEALTH', () => {
                    onSelectDataHealth('CRM');
                    closeMobileIfOpen();
                  })
                }
                className={`w-full px-2.5 py-2 rounded-md flex items-center justify-between text-[12px] transition cursor-pointer ${
                  activeModule === 'DATA_HEALTH'
                    ? 'bg-[#213343] text-white font-extrabold shadow-xs'
                    : 'text-[#1e3a6e] hover:bg-white font-bold'
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  <ShieldCheck
                    className={`w-4 h-4 shrink-0 ${
                      activeModule === 'DATA_HEALTH' ? 'text-[#00bda5]' : 'text-emerald-600'
                    }`}
                  />
                  <span className="truncate">Data Health (CRM)</span>
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                      activeModule === 'DATA_HEALTH'
                        ? 'bg-emerald-500/30 text-emerald-200'
                        : 'bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    {healthScore}%
                  </span>
                  {expanded.DATA_HEALTH ? (
                    <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                  )}
                </span>
              </button>

              {expanded.DATA_HEALTH && (
                <div className="ml-3.5 pl-2.5 my-1 border-l-2 border-[#213343]/25 space-y-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      onSelectDataHealth('CRM');
                      closeMobileIfOpen();
                    }}
                    className={`w-full px-2.5 py-1.5 rounded flex items-center justify-between text-xs transition cursor-pointer ${
                      activeModule === 'DATA_HEALTH'
                        ? 'bg-emerald-50 text-[#0d2b4e] font-extrabold border-l-2 border-[#00bda5]'
                        : 'text-slate-600 hover:text-[#0d2b4e] hover:bg-white font-semibold'
                    }`}
                  >
                    <span>Auditoria Base CRM</span>
                  </button>
                </div>
              )}
            </div>

            {onSelectAdminRbac && (
              <div className="rounded-md">
                <button
                  type="button"
                  onClick={() =>
                    toggleGroup('ADMIN_RBAC', () => {
                      onSelectAdminRbac('USERS_RBAC');
                    })
                  }
                  className={`w-full px-2.5 py-2 rounded-md flex items-center justify-between text-[12px] transition cursor-pointer ${
                    activeModule === 'ADMIN_RBAC'
                      ? 'bg-[#213343] text-white font-extrabold shadow-xs'
                      : 'text-[#1e3a6e] hover:bg-white font-bold'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <Settings
                      className={`w-4 h-4 shrink-0 ${
                        activeModule === 'ADMIN_RBAC' ? 'text-[#ff7a59]' : 'text-[#1e3a6e]'
                      }`}
                    />
                    <span className="truncate">Políticas IAM &amp; Perfis</span>
                  </span>
                  {expanded.ADMIN_RBAC ? (
                    <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                  )}
                </button>

                {expanded.ADMIN_RBAC && (
                  <div className="ml-3.5 pl-2.5 my-1 border-l-2 border-[#213343]/25 space-y-0.5">
                    {[
                      { id: 'USERS_RBAC', label: 'Usuários & Perfis RBAC' },
                      { id: 'CUSTOM_PROPERTIES', label: 'Campos Customizáveis' },
                      { id: 'EMAIL_TEMPLATES', label: 'E-mail & Modelos' },
                      { id: 'COMPANY_EMITTER', label: 'Dados da Empresa' },
                      { id: 'SUBDOMAIN_SECURITY', label: 'Segurança 2FA & Domínio' },
                    ].map((sub) => {
                      const isSubActive =
                        activeModule === 'ADMIN_RBAC' && activeAdminSubView === sub.id;
                      return (
                        <button
                          key={sub.id}
                          type="button"
                          onClick={() => {
                            onSelectAdminRbac(sub.id);
                            closeMobileIfOpen();
                          }}
                          className={`w-full px-2.5 py-1.5 rounded flex items-center justify-between text-xs transition cursor-pointer ${
                            isSubActive
                              ? 'bg-orange-50 text-[#0d2b4e] font-extrabold border-l-2 border-[#ff7a59]'
                              : 'text-slate-600 hover:text-[#0d2b4e] hover:bg-white font-semibold'
                          }`}
                        >
                          <span className="truncate">{sub.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </nav>
      </div>

      <div className="p-2.5 border-t border-slate-200 bg-white text-[10px] text-slate-500 space-y-0.5 rounded-bl-lg">
        <div className="font-bold text-[#0d2b4e]">CRM • SETA TELECOM</div>
        <div>Portal HubSpot #4369067</div>
        <div>4 Pipelines Ativos • Base Independente</div>
      </div>
    </>
  );

  return (
    <>
      {/* DESKTOP SIDEBAR (>= md) */}
      <aside className="hidden md:flex w-60 bg-[#f8f9fb] border-r border-slate-200 shrink-0 flex-col justify-between select-none rounded-l-lg">
        {renderSidebarContent(false)}
      </aside>

      {/* MOBILE SLIDE-OVER DRAWER (< md) */}
      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs"
            onClick={closeMobileIfOpen}
          />
          <aside className="relative z-10 w-72 max-w-[86vw] bg-[#f8f9fb] h-full overflow-y-auto flex flex-col justify-between shadow-2xl select-none">
            {renderSidebarContent(true)}
          </aside>
        </div>
      )}
    </>
  );
}
