'use client';

import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Kanban,
  Users,
  FileCode2,
  Workflow,
  ShieldCheck,
  Settings,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { EnrichedPipeline } from './DealsKanbanTab';

export type CrmModuleId =
  | 'OVERVIEW_AI'
  | 'DEALS_KANBAN'
  | 'CONTACTS_COMPANIES'
  | 'MARKETING_FORMS'
  | 'AUTOMATIONS'
  | 'DATA_HEALTH'
  | 'ADMIN_RBAC';

interface CrmSidebarProps {
  activeModule: CrmModuleId;
  pipelines: EnrichedPipeline[];
  selectedPipelineId: string;
  contactsSubView: 'CONTACTS' | 'COMPANIES';
  dataHealthScope: 'CRM' | 'ERP';
  contactsCount: number;
  companiesCount: number;
  dealsCount: number;
  formsCount: number;
  automationsCount: number;
  healthScore: number;
  onSelectOverview?: () => void;
  onSelectPipeline: (pipelineId: string) => void;
  onSelectContactsSubView: (sub: 'CONTACTS' | 'COMPANIES') => void;
  onSelectForms: () => void;
  onSelectAutomations: () => void;
  onSelectDataHealth: (scope: 'CRM' | 'ERP') => void;
  onSelectAdminRbac?: () => void;
}

export default function CrmSidebar({
  activeModule,
  pipelines,
  selectedPipelineId,
  contactsSubView,
  dataHealthScope,
  contactsCount,
  companiesCount,
  dealsCount,
  formsCount,
  automationsCount,
  healthScore,
  onSelectOverview,
  onSelectPipeline,
  onSelectContactsSubView,
  onSelectForms,
  onSelectAutomations,
  onSelectDataHealth,
  onSelectAdminRbac,
}: CrmSidebarProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    DEALS_KANBAN: true,
    CONTACTS_COMPANIES: true,
    DATA_HEALTH: true,
  });

  useEffect(() => {
    setExpanded((prev) => ({ ...prev, [activeModule]: true }));
  }, [activeModule]);

  const toggleGroup = (key: string, defaultAction: () => void) => {
    if (activeModule === key) {
      setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
    } else {
      setExpanded((prev) => ({ ...prev, [key]: true }));
      defaultAction();
    }
  };

  return (
    <aside className="w-64 bg-[#f8f9fb] border-r border-slate-200 shrink-0 flex flex-col justify-between select-none rounded-l-lg">
      <div>
        {/* HEADER DO MÓDULO CRM */}
        <div className="p-3.5 bg-[#f8f9fb]">
          <div
            onClick={() => {
              if (onSelectOverview) onSelectOverview();
              else onSelectPipeline(selectedPipelineId || pipelines[0]?.id || 'pipe-enterprise-b2b');
            }}
            className="bg-white border border-slate-200 rounded-lg py-3.5 px-4 flex flex-col items-center justify-center gap-0.5 shadow-2xs cursor-pointer hover:border-slate-300 transition"
          >
            <div className="flex items-center gap-2">
              <span className="text-xl font-black tracking-tight text-[#0d2b4e]">SETA</span>
              <span className="w-[2px] h-5 bg-[#f26522] inline-block" />
              <span className="text-xl font-black tracking-tight text-[#f26522]">CRM</span>
            </div>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
              Sales Hub &amp; Marketing Hub
            </span>
          </div>
        </div>

        {/* NAVEGAÇÃO VERTICAL DO CRM */}
        <nav className="px-2 pb-4 space-y-1">
          {/* 0. VISÃO GERAL & COPILOTO */}
          {onSelectOverview && (
            <div className="rounded-md">
              <button
                type="button"
                onClick={onSelectOverview}
                className={`w-full px-3 py-2.5 rounded-md flex items-center justify-between text-[13px] transition cursor-pointer ${
                  activeModule === 'OVERVIEW_AI'
                    ? 'bg-[#213343] text-white font-extrabold shadow-xs'
                    : 'text-[#1e3a6e] hover:bg-white font-bold'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <LayoutDashboard
                    className={`w-4 h-4 shrink-0 ${
                      activeModule === 'OVERVIEW_AI' ? 'text-[#ff7a59]' : 'text-[#1e3a6e]'
                    }`}
                  />
                  <span className="truncate">Visão Geral &amp; IA</span>
                </span>
              </button>
            </div>
          )}

          {/* 1. CONTATOS & EMPRESAS (BASE CRM) */}
          <div className="rounded-md">
            <button
              type="button"
              onClick={() =>
                toggleGroup('CONTACTS_COMPANIES', () => onSelectContactsSubView('CONTACTS'))
              }
              className={`w-full px-3 py-2.5 rounded-md flex items-center justify-between text-[13px] transition cursor-pointer ${
                activeModule === 'CONTACTS_COMPANIES'
                  ? 'bg-[#213343] text-white font-extrabold shadow-xs'
                  : 'text-[#1e3a6e] hover:bg-white font-bold'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <Users
                  className={`w-4 h-4 shrink-0 ${
                    activeModule === 'CONTACTS_COMPANIES' ? 'text-[#ff7a59]' : 'text-[#1e3a6e]'
                  }`}
                />
                <span className="truncate">Contatos &amp; Empresas</span>
              </span>
              {expanded.CONTACTS_COMPANIES ? (
                <ChevronDown className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 shrink-0" />
              )}
            </button>

            {expanded.CONTACTS_COMPANIES && (
              <div className="ml-4 pl-2.5 my-1 border-l-2 border-[#213343]/25 space-y-0.5">
                <button
                  type="button"
                  onClick={() => onSelectContactsSubView('CONTACTS')}
                  className={`w-full px-2.5 py-1.5 rounded flex items-center justify-between text-xs transition cursor-pointer ${
                    activeModule === 'CONTACTS_COMPANIES' && contactsSubView === 'CONTACTS'
                      ? 'bg-orange-50 text-[#0d2b4e] font-extrabold border-l-2 border-[#ff7a59]'
                      : 'text-slate-600 hover:text-[#0d2b4e] hover:bg-white font-semibold'
                  }`}
                >
                  <span>Contatos CRM</span>
                  <span className="text-[10px] font-bold text-slate-400">{contactsCount}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onSelectContactsSubView('COMPANIES')}
                  className={`w-full px-2.5 py-1.5 rounded flex items-center justify-between text-xs transition cursor-pointer ${
                    activeModule === 'CONTACTS_COMPANIES' && contactsSubView === 'COMPANIES'
                      ? 'bg-orange-50 text-[#0d2b4e] font-extrabold border-l-2 border-[#ff7a59]'
                      : 'text-slate-600 hover:text-[#0d2b4e] hover:bg-white font-semibold'
                  }`}
                >
                  <span>Empresas CRM</span>
                  <span className="text-[10px] font-bold text-slate-400">{companiesCount}</span>
                </button>
              </div>
            )}
          </div>

          {/* 2. SALES HUB — FUNIL & PIPELINES */}
          <div className="rounded-md">
            <button
              type="button"
              onClick={() =>
                toggleGroup('DEALS_KANBAN', () =>
                  onSelectPipeline(selectedPipelineId || pipelines[0]?.id || 'pipe-enterprise-b2b')
                )
              }
              className={`w-full px-3 py-2.5 rounded-md flex items-center justify-between text-[13px] transition cursor-pointer ${
                activeModule === 'DEALS_KANBAN'
                  ? 'bg-[#213343] text-white font-extrabold shadow-xs'
                  : 'text-[#1e3a6e] hover:bg-white font-bold'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <Kanban
                  className={`w-4 h-4 shrink-0 ${
                    activeModule === 'DEALS_KANBAN' ? 'text-[#ff7a59]' : 'text-[#1e3a6e]'
                  }`}
                />
                <span className="truncate">Sales Hub ({dealsCount})</span>
              </span>
              {expanded.DEALS_KANBAN ? (
                <ChevronDown className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 shrink-0" />
              )}
            </button>

            {expanded.DEALS_KANBAN && (
              <div className="ml-4 pl-2.5 my-1 border-l-2 border-[#213343]/25 space-y-0.5">
                {pipelines.map((pipe) => {
                  const isPipeActive =
                    activeModule === 'DEALS_KANBAN' && selectedPipelineId === pipe.id;
                  return (
                    <button
                      key={pipe.id}
                      type="button"
                      onClick={() => onSelectPipeline(pipe.id)}
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

          {/* 3. MARKETING HUB — FORMULÁRIOS & CAMPANHAS */}
          <div className="rounded-md">
            <button
              type="button"
              onClick={onSelectForms}
              className={`w-full px-3 py-2.5 rounded-md flex items-center justify-between text-[13px] transition cursor-pointer ${
                activeModule === 'MARKETING_FORMS'
                  ? 'bg-[#213343] text-white font-extrabold shadow-xs'
                  : 'text-[#1e3a6e] hover:bg-white font-bold'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <FileCode2
                  className={`w-4 h-4 shrink-0 ${
                    activeModule === 'MARKETING_FORMS' ? 'text-[#ff7a59]' : 'text-[#1e3a6e]'
                  }`}
                />
                <span className="truncate">Marketing Hub ({formsCount})</span>
              </span>
            </button>
          </div>

          {/* 4. AUTOMAÇÕES & SEQUÊNCIAS */}
          <div className="rounded-md">
            <button
              type="button"
              onClick={onSelectAutomations}
              className={`w-full px-3 py-2.5 rounded-md flex items-center justify-between text-[13px] transition cursor-pointer ${
                activeModule === 'AUTOMATIONS'
                  ? 'bg-[#213343] text-white font-extrabold shadow-xs'
                  : 'text-[#1e3a6e] hover:bg-white font-bold'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <Workflow
                  className={`w-4 h-4 shrink-0 ${
                    activeModule === 'AUTOMATIONS' ? 'text-[#ff7a59]' : 'text-[#1e3a6e]'
                  }`}
                />
                <span className="truncate">Automações ({automationsCount})</span>
              </span>
            </button>
          </div>

          {/* 5. DATA HEALTH (AUDITA BASE CRM E BASE ERP) */}
          <div className="rounded-md pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={() => toggleGroup('DATA_HEALTH', () => onSelectDataHealth('CRM'))}
              className={`w-full px-3 py-2.5 rounded-md flex items-center justify-between text-[13px] transition cursor-pointer ${
                activeModule === 'DATA_HEALTH'
                  ? 'bg-[#213343] text-white font-extrabold shadow-xs'
                  : 'text-[#1e3a6e] hover:bg-white font-bold'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <ShieldCheck
                  className={`w-4 h-4 shrink-0 ${
                    activeModule === 'DATA_HEALTH' ? 'text-[#00bda5]' : 'text-[#1e3a6e]'
                  }`}
                />
                <span className="truncate">Data Health ({healthScore}%)</span>
              </span>
              {expanded.DATA_HEALTH ? (
                <ChevronDown className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 shrink-0" />
              )}
            </button>

            {expanded.DATA_HEALTH && (
              <div className="ml-4 pl-2.5 my-1 border-l-2 border-[#213343]/25 space-y-0.5">
                <button
                  type="button"
                  onClick={() => onSelectDataHealth('CRM')}
                  className={`w-full px-2.5 py-1.5 rounded flex items-center justify-between text-xs transition cursor-pointer ${
                    activeModule === 'DATA_HEALTH' && dataHealthScope === 'CRM'
                      ? 'bg-orange-50 text-[#0d2b4e] font-extrabold border-l-2 border-[#ff7a59]'
                      : 'text-slate-600 hover:text-[#0d2b4e] hover:bg-white font-semibold'
                  }`}
                >
                  <span>Saúde da Base CRM</span>
                </button>
                <button
                  type="button"
                  onClick={() => onSelectDataHealth('ERP')}
                  className={`w-full px-2.5 py-1.5 rounded flex items-center justify-between text-xs transition cursor-pointer ${
                    activeModule === 'DATA_HEALTH' && dataHealthScope === 'ERP'
                      ? 'bg-orange-50 text-[#0d2b4e] font-extrabold border-l-2 border-[#ff7a59]'
                      : 'text-slate-600 hover:text-[#0d2b4e] hover:bg-white font-semibold'
                  }`}
                >
                  <span>Saúde da Base ERP</span>
                </button>
              </div>
            )}
          </div>

          {/* 6. ADMINISTRAÇÃO & CONFIGURAÇÕES (RBAC) */}
          {onSelectAdminRbac && (
            <div className="rounded-md pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={onSelectAdminRbac}
                className={`w-full px-3 py-2.5 rounded-md flex items-center justify-between text-[13px] transition cursor-pointer ${
                  activeModule === 'ADMIN_RBAC'
                    ? 'bg-[#213343] text-white font-extrabold shadow-xs'
                    : 'text-[#1e3a6e] hover:bg-white font-bold'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Settings
                    className={`w-4 h-4 shrink-0 ${
                      activeModule === 'ADMIN_RBAC' ? 'text-[#ff7a59]' : 'text-[#1e3a6e]'
                    }`}
                  />
                  <span className="truncate">Administração &amp; Config.</span>
                </span>
              </button>
            </div>
          )}
        </nav>
      </div>

      <div className="p-3 border-t border-slate-200 bg-white text-[10px] text-slate-500 space-y-0.5 rounded-bl-lg">
        <div className="font-bold text-[#0d2b4e]">CRM • SETA TELECOM</div>
        <div>4 Pipelines Ativos • Bases CRM/ERP Separadas</div>
      </div>
    </aside>
  );
}
