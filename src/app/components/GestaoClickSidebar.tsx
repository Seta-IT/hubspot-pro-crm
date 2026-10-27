'use client';

import React, { useState, useEffect } from 'react';
import {
  Home,
  Users,
  Barcode,
  FileText,
  ShoppingBasket,
  Wrench,
  Boxes,
  Wallet,
  Receipt,
  FileSignature,
  MessageSquare,
  LineChart,
  Settings,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  Plus,
  X,
} from 'lucide-react';
import { GestaoClickMenuSection } from './ErpGestaoClickTab';

export interface GestaoClickSubItem {
  id: string;
  label: string;
  hasArrowRight?: boolean;
}

export interface GestaoClickNavGroup {
  id: GestaoClickMenuSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  subItems?: GestaoClickSubItem[];
}

export const GESTAO_CLICK_MENU_TREE: GestaoClickNavGroup[] = [
  {
    id: 'INICIO',
    label: 'Início (Visão Geral)',
    icon: Home,
  },
  {
    id: 'CADASTROS',
    label: 'Cadastros',
    icon: Users,
    subItems: [
      { id: 'CAD_CLIENTES', label: 'Clientes' },
      { id: 'CAD_FORNECEDORES', label: 'Fornecedores' },
      { id: 'CAD_FUNCIONARIOS', label: 'Funcionários' },
      { id: 'CAD_TRANSPORTADORAS', label: 'Transportadoras' },
      { id: 'CAD_AUXILIARES', label: 'Opções auxiliares', hasArrowRight: true },
    ],
  },
  {
    id: 'ITENS',
    label: 'Itens',
    icon: Barcode,
    subItems: [
      { id: 'ITENS_PRODUTOS', label: 'Produtos' },
      { id: 'ITENS_SERVICOS', label: 'Serviços' },
      { id: 'ITENS_TODOS', label: 'Todos os itens' },
      { id: 'ITENS_AUXILIARES', label: 'Opções auxiliares', hasArrowRight: true },
    ],
  },
  {
    id: 'ORCAMENTOS',
    label: 'Orçamentos / Propostas',
    icon: FileText,
    subItems: [
      { id: 'ORC_TODOS', label: 'Todos os orçamentos' },
      { id: 'ORC_PRODUTOS', label: 'Produtos & Locação' },
      { id: 'ORC_SERVICOS', label: 'Serviços' },
      { id: 'ORC_AUXILIARES', label: 'Opções auxiliares', hasArrowRight: true },
    ],
  },
  {
    id: 'VENDAS',
    label: 'Vendas',
    icon: ShoppingBasket,
    subItems: [
      { id: 'VENDAS_PRODUTOS', label: 'Produtos' },
      { id: 'VENDAS_SERVICOS', label: 'Serviços' },
      { id: 'VENDAS_DEVOLUCOES', label: 'Devoluções' },
      { id: 'VENDAS_AUXILIARES', label: 'Opções auxiliares', hasArrowRight: true },
    ],
  },
  {
    id: 'ORDENS_SERVICOS',
    label: 'Ordens de serviços',
    icon: Wrench,
    subItems: [
      { id: 'OS_GERENCIAR', label: 'Gerenciar O.S.' },
      { id: 'OS_PAINEL', label: 'Painel' },
      { id: 'OS_AUXILIARES', label: 'Opções auxiliares', hasArrowRight: true },
    ],
  },
  {
    id: 'ESTOQUE',
    label: 'Estoque',
    icon: Boxes,
    subItems: [
      { id: 'EST_MOVIMENTACOES', label: 'Movimentações' },
      { id: 'EST_AJUSTES', label: 'Ajustes' },
      { id: 'EST_TRANSFERENCIAS', label: 'Transferências' },
      { id: 'EST_COTACOES', label: 'Cotações' },
      { id: 'EST_COMPRAS', label: 'Compras', hasArrowRight: true },
      { id: 'EST_AUXILIARES', label: 'Opções auxiliares', hasArrowRight: true },
    ],
  },
  {
    id: 'FINANCEIRO',
    label: 'Financeiro',
    icon: Wallet,
    subItems: [
      { id: 'FIN_PAGAR', label: 'Contas a pagar' },
      { id: 'FIN_RECEBER', label: 'Contas a receber' },
      { id: 'FIN_DRE', label: 'DRE gerencial' },
      { id: 'FIN_FLUXO', label: 'Fluxo de caixa' },
      { id: 'FIN_BOLETOS', label: 'Boletos bancários', hasArrowRight: true },
      { id: 'FIN_AUXILIARES', label: 'Opções auxiliares', hasArrowRight: true },
    ],
  },
  {
    id: 'FISCAL',
    label: 'Fiscal',
    icon: Receipt,
    subItems: [
      { id: 'FIS_PRODUTOS', label: 'Notas de produtos' },
      { id: 'FIS_SERVICOS', label: 'Notas de serviços' },
      { id: 'FIS_CONSUMIDOR', label: 'Notas do consumidor' },
      { id: 'FIS_COMPRAS', label: 'Notas de compras' },
      { id: 'FIS_AUXILIARES', label: 'Opções auxiliares', hasArrowRight: true },
    ],
  },
  {
    id: 'CONTRATOS',
    label: 'Contratos',
    icon: FileSignature,
    subItems: [
      { id: 'CTR_LOCACOES', label: 'Locações' },
      { id: 'CTR_SERVICOS', label: 'Serviços' },
      { id: 'CTR_ASSINATURAS', label: 'Assinaturas' },
      { id: 'CTR_AUXILIARES', label: 'Opções auxiliares', hasArrowRight: true },
    ],
  },
  {
    id: 'ATENDIMENTOS',
    label: 'Atendimentos',
    icon: MessageSquare,
  },
  {
    id: 'RELATORIOS',
    label: 'Relatórios',
    icon: LineChart,
    subItems: [
      { id: 'REL_CADASTROS', label: 'Cadastros' },
      { id: 'REL_VENDAS', label: 'Vendas' },
      { id: 'REL_OS', label: 'Ordens de serviços' },
      { id: 'REL_ESTOQUE', label: 'Estoque' },
      { id: 'REL_FINANCEIRO', label: 'Financeiro' },
      { id: 'REL_CONTRATOS', label: 'Contratos' },
      { id: 'REL_FISCAL', label: 'Fiscal' },
      { id: 'REL_PERSONALIZADOS', label: 'Personalizados' },
      { id: 'REL_LOGS', label: 'Logs do sistema' },
    ],
  },
  {
    id: 'DATA_HEALTH_ERP',
    label: 'Data Health (ERP)',
    icon: ShieldCheck,
  },
  {
    id: 'CONFIGURACOES',
    label: 'Configurações',
    icon: Settings,
    subItems: [
      { id: 'CFG_GERAIS', label: 'Gerais' },
      { id: 'CFG_PLANO', label: 'Meu plano' },
      { id: 'CFG_USUARIOS', label: 'Usuários' },
      { id: 'CFG_EMPRESA', label: 'Dados da empresa' },
      { id: 'CFG_MARCA', label: 'Marca da empresa' },
      { id: 'CFG_LOJAS', label: 'Empresas / Lojas' },
      { id: 'CFG_CERTIFICADO', label: 'Certificado digital' },
      { id: 'CFG_EMAILS', label: 'Modelos de e-mails' },
      { id: 'CFG_AVISOS', label: 'Avisos por e-mail' },
      { id: 'CFG_CHECKLIST', label: 'Homologação (11 Módulos)' },
      { id: 'CFG_LOGS', label: 'Sincronização & Logs' },
    ],
  },
];

interface GestaoClickSidebarProps {
  activeSection: GestaoClickMenuSection;
  activeSubId: string;
  onSelect: (section: GestaoClickMenuSection, subId?: string) => void;
  onNewProposal: () => void;
  companyCnpj: string;
  taxRegime: string;
  mobileDrawerOpen?: boolean;
  onCloseMobileDrawer?: () => void;
}

export default function GestaoClickSidebar({
  activeSection,
  activeSubId,
  onSelect,
  onNewProposal,
  companyCnpj,
  taxRegime,
  mobileDrawerOpen = false,
  onCloseMobileDrawer,
}: GestaoClickSidebarProps) {
  const closeMobileIfOpen = () => {
    if (onCloseMobileDrawer) onCloseMobileDrawer();
  };
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    CADASTROS: true,
    ITENS: true,
    ORCAMENTOS: true,
    VENDAS: false,
    ORDENS_SERVICOS: false,
    ESTOQUE: false,
    FINANCEIRO: false,
    FISCAL: false,
    CONTRATOS: true,
    RELATORIOS: false,
    CONFIGURACOES: false,
  });

  useEffect(() => {
    if (activeSection) {
      setExpanded((prev) => ({ ...prev, [activeSection]: true }));
    }
  }, [activeSection]);

  const handleGroupClick = (group: GestaoClickNavGroup) => {
    if (!group.subItems || group.subItems.length === 0) {
      onSelect(group.id, group.id);
      closeMobileIfOpen();
      return;
    }
    const isCurrentlyOpen = Boolean(expanded[group.id]);
    if (activeSection === group.id) {
      setExpanded((prev) => ({ ...prev, [group.id]: !isCurrentlyOpen }));
    } else {
      setExpanded((prev) => ({ ...prev, [group.id]: true }));
      onSelect(group.id, group.subItems[0].id);
    }
  };

  const renderSidebarInner = (isMobileDrawer = false) => (
    <>
      <div>
        {/* LOGO OFICIAL SETA | IT */}
        <div className="p-3.5 bg-[#f8f9fb] flex items-center justify-between gap-2">
          <div
            onClick={() => {
              onSelect('INICIO', 'INICIO');
              closeMobileIfOpen();
            }}
            className="flex-1 bg-white border border-slate-200 rounded-lg py-3.5 px-4 flex flex-col items-center justify-center gap-1 shadow-2xs cursor-pointer hover:border-slate-300 transition"
          >
            <div className="flex items-center gap-2">
              <span className="text-2xl font-black tracking-tight text-[#0d2b4e]">SETA</span>
              <span className="w-[2px] h-6 bg-[#f26522] inline-block" />
              <span className="text-2xl font-black tracking-tight text-[#f26522]">IT</span>
            </div>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
              Módulo ERP
            </span>
          </div>
          {isMobileDrawer && (
            <button
              type="button"
              onClick={closeMobileIfOpen}
              aria-label="Fechar Menu ERP"
              className="p-2 rounded-lg bg-slate-200/80 text-slate-700 hover:bg-slate-300 cursor-pointer shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* BOTÃO RÁPIDO + NOVA PROPOSTA / ORÇAMENTO */}
        <div className="px-3.5 pb-2.5">
          <button
            type="button"
            onClick={() => {
              onNewProposal();
              closeMobileIfOpen();
            }}
            className="w-full py-2 px-3 rounded-md bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" /> + Nova Proposta / Orçamento
          </button>
        </div>

        {/* ÁRVORE VERTICAL DE MENUS E SUBMENUS DO ERP */}
        <nav className="px-2 pb-4 space-y-0.5">
          {GESTAO_CLICK_MENU_TREE.map((group) => {
            const Icon = group.icon;
            const hasSubs = Boolean(group.subItems && group.subItems.length > 0);
            const isOpen = Boolean(expanded[group.id]);
            const isGroupActive = activeSection === group.id;

            return (
              <div key={group.id} className="rounded-md">
                <button
                  type="button"
                  onClick={() => handleGroupClick(group)}
                  className={`w-full px-3 py-2.5 rounded-md flex items-center justify-between text-[13px] transition cursor-pointer ${
                    isGroupActive
                      ? 'bg-[#1e3a6e] text-white font-extrabold shadow-xs'
                      : 'text-[#1e3a6e] hover:bg-white font-bold'
                  }`}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isGroupActive ? 'text-[#ff7a59]' : 'text-[#1e3a6e]'
                      }`}
                    />
                    <span className="truncate">{group.label}</span>
                  </span>
                  {hasSubs && (
                    <span className={isGroupActive ? 'text-white' : 'text-slate-400'}>
                      {isOpen ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </span>
                  )}
                </button>

                {hasSubs && isOpen && (
                  <div className="ml-4 pl-2.5 my-1 border-l-2 border-[#1e3a6e]/25 space-y-0.5">
                    {group.subItems!.map((sub) => {
                      const isSubActive =
                        isGroupActive &&
                        (activeSubId === sub.id ||
                          (!activeSubId && sub === group.subItems![0]));
                      return (
                        <button
                          key={sub.id}
                          type="button"
                          onClick={() => {
                            onSelect(group.id, sub.id);
                            closeMobileIfOpen();
                          }}
                          className={`w-full px-2.5 py-1.5 rounded flex items-center justify-between text-xs transition cursor-pointer ${
                            isSubActive
                              ? 'bg-blue-100 text-[#0d2b4e] font-extrabold border-l-2 border-[#ff7a59]'
                              : 'text-slate-600 hover:text-[#1e3a6e] hover:bg-white font-semibold'
                          }`}
                        >
                          <span className="truncate">{sub.label}</span>
                          {sub.hasArrowRight && (
                            <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>

      <div className="p-3 border-t border-slate-200 bg-white text-[10px] text-slate-500 space-y-0.5">
        <div className="font-bold text-[#0d2b4e]">ERP • SETA TELECOM LTDA</div>
        <div>CNPJ {companyCnpj}</div>
        <div>Regime: {taxRegime}</div>
      </div>
    </>
  );

  return (
    <>
      {/* DESKTOP SIDEBAR (>= md) */}
      <aside className="hidden md:flex w-64 bg-[#f8f9fb] border-r border-slate-200 shrink-0 flex-col justify-between select-none">
        {renderSidebarInner(false)}
      </aside>

      {/* MOBILE SLIDE-OVER DRAWER (< md) */}
      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs"
            onClick={closeMobileIfOpen}
          />
          <aside className="relative z-10 w-72 max-w-[86vw] bg-[#f8f9fb] h-full overflow-y-auto flex flex-col justify-between shadow-2xl select-none">
            {renderSidebarInner(true)}
          </aside>
        </div>
      )}
    </>
  );
}
