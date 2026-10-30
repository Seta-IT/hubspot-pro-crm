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
  PanelLeftClose,
  X,
} from 'lucide-react';
import { GestaoClickMenuSection } from './ErpGestaoClickTab';

export type GestaoClickCorporateCategory =
  | 'VISÃO GERAL'
  | 'COMERCIAL & LOCAÇÃO'
  | 'OPERAÇÃO & TÉCNICO'
  | 'FINANCEIRO, FISCAL & GOVERNANÇA';

export interface GestaoClickSubItem {
  id: string;
  label: string;
  hasArrowRight?: boolean;
}

export interface GestaoClickNavGroup {
  id: GestaoClickMenuSection;
  label: string;
  category: GestaoClickCorporateCategory;
  icon: React.ComponentType<{ className?: string }>;
  subItems?: GestaoClickSubItem[];
}

export const GESTAO_CLICK_CORPORATE_BLOCKS: GestaoClickCorporateCategory[] = [
  'VISÃO GERAL',
  'COMERCIAL & LOCAÇÃO',
  'OPERAÇÃO & TÉCNICO',
  'FINANCEIRO, FISCAL & GOVERNANÇA',
];

export const GESTAO_CLICK_MENU_TREE: GestaoClickNavGroup[] = [
  {
    id: 'INICIO',
    label: 'Início (Visão Geral)',
    category: 'VISÃO GERAL',
    icon: Home,
  },
  {
    id: 'CADASTROS',
    label: 'Cadastros',
    category: 'COMERCIAL & LOCAÇÃO',
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
    category: 'COMERCIAL & LOCAÇÃO',
    icon: Barcode,
    subItems: [
      { id: 'ITENS_TODOS', label: 'Todos os itens' },
      { id: 'ITENS_PRODUTOS', label: 'Produtos' },
      { id: 'ITENS_SERVICOS', label: 'Serviços' },
      { id: 'ITENS_AUXILIARES', label: 'Opções auxiliares', hasArrowRight: true },
    ],
  },
  {
    id: 'ORCAMENTOS',
    label: 'Orçamentos / Propostas',
    category: 'COMERCIAL & LOCAÇÃO',
    icon: FileText,
    subItems: [
      { id: 'ORC_TODOS', label: 'Todos os orçamentos' },
      { id: 'ORC_PRODUTOS', label: 'Propostas de Produtos' },
      { id: 'ORC_LOCACAO', label: 'Propostas de Locação' },
      { id: 'ORC_SERVICOS', label: 'Propostas de Serviços' },
      { id: 'ORC_AUXILIARES', label: 'Opções auxiliares', hasArrowRight: true },
    ],
  },
  {
    id: 'CONTRATOS',
    label: 'Contratos',
    category: 'COMERCIAL & LOCAÇÃO',
    icon: FileSignature,
    subItems: [
      { id: 'CTR_LOCACOES', label: 'Locações' },
      { id: 'CTR_SERVICOS', label: 'Serviços' },
      { id: 'CTR_ASSINATURAS', label: 'Assinaturas' },
      { id: 'CTR_TODOS', label: 'Todos os contratos' },
      { id: 'CTR_AUXILIARES', label: 'Opções auxiliares', hasArrowRight: true },
    ],
  },
  {
    id: 'VENDAS',
    label: 'Vendas',
    category: 'COMERCIAL & LOCAÇÃO',
    icon: ShoppingBasket,
    subItems: [
      { id: 'VENDAS_TODAS', label: 'Todas as vendas' },
      { id: 'VENDAS_PRODUTOS', label: 'Produtos' },
      { id: 'VENDAS_SERVICOS', label: 'Serviços' },
      { id: 'VENDAS_BALCAO', label: 'Balcão (PDV)' },
      { id: 'VENDAS_DEVOLUCOES', label: 'Devoluções' },
      { id: 'VENDAS_AUXILIARES', label: 'Opções auxiliares', hasArrowRight: true },
    ],
  },
  {
    id: 'ORDENS_SERVICOS',
    label: 'Ordens de serviços',
    category: 'OPERAÇÃO & TÉCNICO',
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
    category: 'OPERAÇÃO & TÉCNICO',
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
    id: 'ATENDIMENTOS',
    label: 'Atendimentos',
    category: 'OPERAÇÃO & TÉCNICO',
    icon: MessageSquare,
  },
  {
    id: 'FINANCEIRO',
    label: 'Financeiro',
    category: 'FINANCEIRO, FISCAL & GOVERNANÇA',
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
    category: 'FINANCEIRO, FISCAL & GOVERNANÇA',
    icon: Receipt,
    subItems: [
      { id: 'FIS_TODAS', label: 'Todas as notas e faturas' },
      { id: 'FIS_PRODUTOS', label: 'Notas de produtos' },
      { id: 'FIS_SERVICOS', label: 'Notas de serviços' },
      { id: 'FIS_CONSUMIDOR', label: 'Notas do consumidor' },
      { id: 'FIS_IMPORTACAO', label: 'NF-e Importação (Sebrae 4.0)' },
      { id: 'FIS_COMPRAS', label: 'Notas de compras' },
      { id: 'FIS_AUXILIARES', label: 'Opções auxiliares', hasArrowRight: true },
    ],
  },
  {
    id: 'RELATORIOS',
    label: 'Relatórios',
    category: 'FINANCEIRO, FISCAL & GOVERNANÇA',
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
    category: 'FINANCEIRO, FISCAL & GOVERNANÇA',
    icon: ShieldCheck,
  },
  {
    id: 'CONFIGURACOES',
    label: 'Configurações',
    category: 'FINANCEIRO, FISCAL & GOVERNANÇA',
    icon: Settings,
    subItems: [
      { id: 'CFG_USUARIOS', label: 'Usuários' },
      { id: 'CFG_GERAIS', label: 'Gerais' },
      { id: 'CFG_PLANO', label: 'Meu plano' },
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
  moduleCounts?: Partial<Record<GestaoClickMenuSection, number>>;
  onToggleCollapse?: () => void;
  mobileDrawerOpen?: boolean;
  onCloseMobileDrawer?: () => void;
}

export default function GestaoClickSidebar({
  activeSection,
  activeSubId,
  onSelect,
  companyCnpj,
  taxRegime,
  moduleCounts = {},
  onToggleCollapse,
  mobileDrawerOpen = false,
  onCloseMobileDrawer,
}: GestaoClickSidebarProps) {
  const closeMobileIfOpen = () => {
    if (onCloseMobileDrawer) onCloseMobileDrawer();
  };

  // Modo Acordeão Inteligente: inicia apenas o grupo ativo expandido
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => ({
    [activeSection]: true,
  }));

  useEffect(() => {
    if (activeSection) {
      setExpanded({ [activeSection]: true });
    }
  }, [activeSection]);

  const handleGroupClick = (group: GestaoClickNavGroup) => {
    if (!group.subItems || group.subItems.length === 0) {
      setExpanded({});
      onSelect(group.id, group.id);
      closeMobileIfOpen();
      return;
    }
    const isCurrentlyOpen = Boolean(expanded[group.id]);
    if (activeSection === group.id) {
      setExpanded({ [group.id]: !isCurrentlyOpen });
    } else {
      setExpanded({ [group.id]: true });
      onSelect(group.id, group.subItems[0].id);
    }
  };

  const renderSidebarInner = (isMobileDrawer = false) => (
    <>
      <div>
        {/* CABEÇALHO CORPORATIVO COMPACTO DO MÓDULO ERP */}
        <div className="px-3 py-2.5 bg-white border-b border-slate-200 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              onSelect('INICIO', 'INICIO');
              closeMobileIfOpen();
            }}
            className="text-left min-w-0 cursor-pointer group"
          >
            <span className="text-[10px] font-black uppercase tracking-wider text-[#1e3a6e] group-hover:text-[#ff7a59] transition block truncate">
              MÓDULO ERP • GESTÃOCLICK
            </span>
            <span className="text-[10px] text-slate-500 font-semibold block truncate">
              Backoffice, Locação &amp; Fiscal
            </span>
          </button>

          {isMobileDrawer ? (
            <button
              type="button"
              onClick={closeMobileIfOpen}
              aria-label="Fechar Menu ERP"
              className="p-1.5 rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                title="Recolher menu lateral do ERP"
                aria-label="Recolher menu lateral do ERP"
                className="p-1.5 rounded-md text-slate-500 hover:text-[#0d2b4e] hover:bg-slate-100 transition cursor-pointer shrink-0"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            )
          )}
        </div>

        {/* ÁRVORE VERTICAL EM 4 BLOCOS CORPORATIVOS + ACORDEÃO INTELIGENTE */}
        <nav className="px-2 py-2.5 space-y-3">
          {GESTAO_CLICK_CORPORATE_BLOCKS.map((blockName) => {
            const groups = GESTAO_CLICK_MENU_TREE.filter((g) => g.category === blockName);
            return (
              <div key={blockName} className="space-y-0.5">
                <div className="px-2.5 pb-1 text-[9px] font-extrabold uppercase tracking-wider text-slate-400">
                  {blockName}
                </div>
                {groups.map((group) => {
                  const Icon = group.icon;
                  const hasSubs = Boolean(group.subItems && group.subItems.length > 0);
                  const isOpen = Boolean(expanded[group.id]);
                  const isGroupActive = activeSection === group.id;
                  const countVal = moduleCounts[group.id];

                  return (
                    <div key={group.id} className="rounded-md">
                      <button
                        type="button"
                        onClick={() => handleGroupClick(group)}
                        className={`w-full px-2.5 py-2 rounded-md flex items-center justify-between text-[12px] transition cursor-pointer ${
                          isGroupActive
                            ? 'bg-[#1e3a6e] text-white font-extrabold shadow-xs'
                            : 'text-[#1e3a6e] hover:bg-white font-bold'
                        }`}
                      >
                        <span className="flex items-center gap-2 truncate">
                          <Icon
                            className={`w-4 h-4 shrink-0 ${
                              isGroupActive ? 'text-[#ff7a59]' : 'text-[#1e3a6e]'
                            }`}
                          />
                          <span className="truncate">{group.label}</span>
                        </span>

                        <span className="flex items-center gap-1 shrink-0">
                          {typeof countVal === 'number' && (
                            <span
                              className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                                isGroupActive
                                  ? 'bg-white/20 text-white'
                                  : 'bg-slate-200/80 text-slate-600'
                              }`}
                            >
                              {countVal}
                            </span>
                          )}
                          {hasSubs && (
                            <span className={isGroupActive ? 'text-white' : 'text-slate-400'}>
                              {isOpen ? (
                                <ChevronDown className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5" />
                              )}
                            </span>
                          )}
                        </span>
                      </button>

                      {hasSubs && isOpen && (
                        <div className="ml-3.5 pl-2.5 my-1 border-l-2 border-[#1e3a6e]/25 space-y-0.5">
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
              </div>
            );
          })}
        </nav>
      </div>

      <div className="p-2.5 border-t border-slate-200 bg-white text-[10px] text-slate-500 space-y-0.5">
        <div className="font-bold text-[#0d2b4e]">ERP • SETA TELECOM LTDA</div>
        <div>CNPJ {companyCnpj}</div>
        <div>Regime: {taxRegime}</div>
      </div>
    </>
  );

  return (
    <>
      {/* DESKTOP SIDEBAR (>= md) */}
      <aside className="hidden md:flex w-60 bg-[#f8f9fb] border-r border-slate-200 shrink-0 flex-col justify-between select-none">
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
