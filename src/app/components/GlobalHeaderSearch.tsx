'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  User,
  Building2,
  Briefcase,
  FileText,
  Package,
  FileSignature,
  Receipt,
  Wrench,
  Headphones,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  Company,
  Contact,
  Deal,
  ErpCatalogItem,
  ErpCommercialProposal,
  ErpFiscalInvoice,
  ErpRentalContract,
  ErpServiceOrder,
  ServiceTicket,
} from '../../db/types';
import { formatBRL } from './ui-helpers';

export type SearchSystemFilter = 'ALL' | 'CRM' | 'ERP' | 'CHAMADOS';

export type SearchCategoryKey =
  | 'CONTACTS'
  | 'COMPANIES'
  | 'DEALS'
  | 'PROPOSALS'
  | 'PRODUCTS'
  | 'CONTRACTS'
  | 'INVOICES'
  | 'SERVICE_ORDERS'
  | 'TICKETS';

export interface SearchResultEntry {
  id: string;
  entityId: string;
  category: SearchCategoryKey;
  system: 'CRM' | 'ERP' | 'CHAMADOS';
  title: string;
  subtitle: string;
  rawRecord?: unknown;
}

interface GlobalHeaderSearchProps {
  contacts: Contact[];
  companies: Company[];
  deals: Deal[];
  proposals: ErpCommercialProposal[];
  catalog: ErpCatalogItem[];
  rentalContracts: ErpRentalContract[];
  invoices: ErpFiscalInvoice[];
  serviceOrders: ErpServiceOrder[];
  tickets: ServiceTicket[];
  onSelectResult: (result: SearchResultEntry) => void;
}

export const SEARCH_CATEGORY_PILLS: Array<{
  key: SearchCategoryKey;
  label: string;
  system: 'CRM' | 'ERP' | 'CHAMADOS';
  avatarBg: string;
  pillActiveCls: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    key: 'CONTACTS',
    label: 'Contatos',
    system: 'CRM',
    avatarBg: 'bg-blue-600',
    pillActiveCls: 'bg-blue-50 text-blue-800 border-blue-400',
    icon: User,
  },
  {
    key: 'COMPANIES',
    label: 'Empresas / Clientes',
    system: 'CRM',
    avatarBg: 'bg-orange-600',
    pillActiveCls: 'bg-orange-50 text-orange-800 border-orange-400',
    icon: Building2,
  },
  {
    key: 'DEALS',
    label: 'Negócios',
    system: 'CRM',
    avatarBg: 'bg-emerald-600',
    pillActiveCls: 'bg-emerald-50 text-emerald-800 border-emerald-400',
    icon: Briefcase,
  },
  {
    key: 'PROPOSALS',
    label: 'Orçamentos / Propostas',
    system: 'ERP',
    avatarBg: 'bg-indigo-600',
    pillActiveCls: 'bg-indigo-50 text-indigo-800 border-indigo-400',
    icon: FileText,
  },
  {
    key: 'PRODUCTS',
    label: 'Produtos / Itens',
    system: 'ERP',
    avatarBg: 'bg-purple-600',
    pillActiveCls: 'bg-purple-50 text-purple-800 border-purple-400',
    icon: Package,
  },
  {
    key: 'CONTRACTS',
    label: 'Contratos',
    system: 'ERP',
    avatarBg: 'bg-teal-600',
    pillActiveCls: 'bg-teal-50 text-teal-800 border-teal-400',
    icon: FileSignature,
  },
  {
    key: 'INVOICES',
    label: 'Notas Fiscais',
    system: 'ERP',
    avatarBg: 'bg-cyan-600',
    pillActiveCls: 'bg-cyan-50 text-cyan-800 border-cyan-400',
    icon: Receipt,
  },
  {
    key: 'SERVICE_ORDERS',
    label: 'Ordens de Serviço',
    system: 'ERP',
    avatarBg: 'bg-amber-600',
    pillActiveCls: 'bg-amber-50 text-amber-800 border-amber-400',
    icon: Wrench,
  },
  {
    key: 'TICKETS',
    label: 'Chamados / Tickets',
    system: 'CHAMADOS',
    avatarBg: 'bg-rose-600',
    pillActiveCls: 'bg-rose-50 text-rose-800 border-rose-400',
    icon: Headphones,
  },
];

const RECENT_STORAGE_KEY = 'stihub_global_recent_searches_v1';

function normalizeText(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export default function GlobalHeaderSearch({
  contacts,
  companies,
  deals,
  proposals,
  catalog,
  rentalContracts,
  invoices,
  serviceOrders,
  tickets,
  onSelectResult,
}: GlobalHeaderSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [systemFilter, setSystemFilter] = useState<SearchSystemFilter>('ALL');
  const [selectedCategories, setSelectedCategories] = useState<SearchCategoryKey[]>([
    'CONTACTS',
    'COMPANIES',
    'DEALS',
  ]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentIds, setRecentIds] = useState<string[]>([]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = JSON.parse(window.localStorage.getItem(RECENT_STORAGE_KEY) || '[]');
        if (Array.isArray(saved)) setRecentIds(saved);
      } catch {}
    }
  }, []);

  // Global keyboard shortcut Ctrl+K / Cmd+K & Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  // Outside click closes popover
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const toggleCategory = (cat: SearchCategoryKey) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((k) => k !== cat) : [...prev, cat]
    );
    setActiveIndex(0);
  };

  const clearAllFilters = () => {
    setSelectedCategories([]);
    setSystemFilter('ALL');
    setActiveIndex(0);
  };

  // Build unified index across all 9 entity categories (CRM, ERP, CHAMADOS)
  const allIndexedEntries = useMemo<SearchResultEntry[]>(() => {
    const entries: SearchResultEntry[] = [];
    const compMap = new Map(companies.map((c) => [c.id, c]));

    // 1. Companies / Clientes (CRM & ERP)
    for (const comp of companies) {
      entries.push({
        id: `COMPANIES:${comp.id}`,
        entityId: comp.id,
        category: 'COMPANIES',
        system: 'CRM',
        title: comp.name,
        subtitle: `Empresa • CRM/ERP${comp.cnpj ? ` • CNPJ ${comp.cnpj}` : ''}${comp.city ? ` • ${comp.city}` : ''}`,
        rawRecord: comp,
      });
    }

    // 2. Contacts (CRM)
    for (const c of contacts) {
      const compName = c.companyId ? compMap.get(c.companyId)?.name : '';
      entries.push({
        id: `CONTACTS:${c.id}`,
        entityId: c.id,
        category: 'CONTACTS',
        system: 'CRM',
        title: `${c.firstName} ${c.lastName}`.trim(),
        subtitle: `Contato • CRM • ${c.email || c.phone || 'Sem e-mail'}${compName ? ` • ${compName}` : ''}`,
        rawRecord: c,
      });
    }

    // 3. Deals / Negócios (CRM)
    for (const d of deals) {
      const compName = d.companyId ? compMap.get(d.companyId)?.name : '';
      entries.push({
        id: `DEALS:${d.id}`,
        entityId: d.id,
        category: 'DEALS',
        system: 'CRM',
        title: d.title,
        subtitle: `Negócio • CRM${compName ? ` • ${compName}` : ''} • ${d.ownerName || 'Marcelo Mira'} • ${formatBRL(d.value)}`,
        rawRecord: d,
      });
    }

    // 4. Orçamentos / Propostas (ERP)
    for (const p of proposals) {
      entries.push({
        id: `PROPOSALS:${p.id}`,
        entityId: p.id,
        category: 'PROPOSALS',
        system: 'ERP',
        title: `${p.code} - ${p.companyName || p.title}`,
        subtitle: `Orçamento • ERP • ${p.title || 'Proposta Comercial'} • ${formatBRL(p.totalContractValue || p.monthlyRecurringTotal)}`,
        rawRecord: p,
      });
    }

    // 5. Produtos / Itens (ERP)
    for (const it of catalog) {
      entries.push({
        id: `PRODUCTS:${it.id}`,
        entityId: it.id,
        category: 'PRODUCTS',
        system: 'ERP',
        title: `${it.gestaoClickCode} - ${it.name}`,
        subtitle: `Produto/Item • ERP • NCM/LC: ${it.ncmOrLc116 || '—'} • Estoque: ${it.stockAvailable} un • ${formatBRL(it.monthlyRentalPrice || it.saleOrSetupPrice || 0)}`,
        rawRecord: it,
      });
    }

    // 6. Contratos de Locação (ERP)
    for (const ctr of rentalContracts) {
      entries.push({
        id: `CONTRACTS:${ctr.id}`,
        entityId: ctr.id,
        category: 'CONTRACTS',
        system: 'ERP',
        title: `${ctr.contractNumber} - ${ctr.companyName}`,
        subtitle: `Contrato • ERP • ${ctr.title} • ${formatBRL(ctr.monthlyValue)}/mês`,
        rawRecord: ctr,
      });
    }

    // 7. Notas Fiscais (ERP)
    for (const inv of invoices) {
      entries.push({
        id: `INVOICES:${inv.id}`,
        entityId: inv.id,
        category: 'INVOICES',
        system: 'ERP',
        title: `${inv.documentNumber} - ${inv.companyName}`,
        subtitle: `Nota Fiscal • ERP • ${inv.documentType} • ${formatBRL(inv.grossAmount)} • ${inv.status}`,
        rawRecord: inv,
      });
    }

    // 8. Ordens de Serviço (ERP)
    for (const os of serviceOrders) {
      entries.push({
        id: `SERVICE_ORDERS:${os.id}`,
        entityId: os.id,
        category: 'SERVICE_ORDERS',
        system: 'ERP',
        title: `O.S. #${os.code} - ${os.companyName}`,
        subtitle: `Ordem de Serviço • ERP • Técnico: ${os.technicianName || 'NOC'} • ${os.status}`,
        rawRecord: os,
      });
    }

    // 9. Chamados / Tickets (CHAMADOS)
    for (const tk of tickets) {
      const compName = tk.companyId ? compMap.get(tk.companyId)?.name : '';
      entries.push({
        id: `TICKETS:${tk.id}`,
        entityId: tk.id,
        category: 'TICKETS',
        system: 'CHAMADOS',
        title: `${tk.key} - ${tk.subject}`,
        subtitle: `Chamado • CHAMADOS${compName ? ` • ${compName}` : ''} • Fila: ${tk.assignee} • ${tk.status}`,
        rawRecord: tk,
      });
    }

    return entries;
  }, [
    companies,
    contacts,
    deals,
    proposals,
    catalog,
    rentalContracts,
    invoices,
    serviceOrders,
    tickets,
  ]);

  const filteredEntries = useMemo(() => {
    const q = normalizeText(query);
    const qDigits = query.replace(/\D+/g, '');

    const pool = allIndexedEntries.filter((entry) => {
      if (systemFilter !== 'ALL') {
        if (systemFilter === 'ERP' && entry.category === 'COMPANIES') {
          // Companies/Clientes belong to both CRM and ERP
        } else if (entry.system !== systemFilter) {
          return false;
        }
      }
      if (selectedCategories.length > 0 && !selectedCategories.includes(entry.category)) {
        return false;
      }
      if (!q) return true;
      const hay = normalizeText(`${entry.title} ${entry.subtitle}`);
      const hayDigits = `${entry.title} ${entry.subtitle}`.replace(/\D+/g, '');
      return hay.includes(q) || (qDigits.length >= 2 && hayDigits.includes(qDigits));
    });

    if (!q && recentIds.length > 0) {
      const recentMatched = recentIds
        .map((id) => pool.find((e) => e.id === id))
        .filter((e): e is SearchResultEntry => Boolean(e));
      const rest = pool.filter((e) => !recentIds.includes(e.id));
      return [...recentMatched, ...rest].slice(0, 10);
    }

    return pool.slice(0, 12);
  }, [allIndexedEntries, query, systemFilter, selectedCategories, recentIds]);

  const handleChooseEntry = (entry: SearchResultEntry) => {
    const updatedRecents = [entry.id, ...recentIds.filter((id) => id !== entry.id)].slice(0, 8);
    setRecentIds(updatedRecents);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(updatedRecents));
      } catch {}
    }
    setOpen(false);
    onSelectResult(entry);
  };

  const activeFiltersCount =
    selectedCategories.length + (systemFilter !== 'ALL' ? 1 : 0);

  return (
    <div ref={containerRef} className="relative flex-1 max-w-xl">
      {/* TOP HEADER SEARCH INPUT */}
      <div className="relative flex items-center">
        <Search className="w-3.5 h-3.5 text-[#99acc2] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onKeyDown={(e) => {
            if (!open) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActiveIndex((prev) =>
                filteredEntries.length > 0 ? (prev + 1) % filteredEntries.length : 0
              );
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIndex((prev) =>
                filteredEntries.length > 0
                  ? (prev - 1 + filteredEntries.length) % filteredEntries.length
                  : 0
              );
            } else if (e.key === 'Enter' && filteredEntries[activeIndex]) {
              e.preventDefault();
              handleChooseEntry(filteredEntries[activeIndex]);
            }
          }}
          placeholder="Pesquisar no STI-hub (clientes, negócios, orçamentos, produtos, notas fiscais)..."
          aria-label="Pesquisar no STI-hub"
          className="w-full pl-8 pr-16 py-1.5 rounded-[5px] bg-[#33475b] border border-[#516f90] text-xs text-white placeholder-[#99acc2] focus:bg-white focus:text-[#33475b] focus:placeholder-[#516f90] focus:outline-none focus:border-[#0091ae] transition"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200/20 text-[#99acc2] hover:text-white cursor-pointer"
            >
              Limpar
            </button>
          )}
          <span className="hidden sm:inline-block px-1.5 py-0.5 rounded bg-[#213343]/80 border border-[#516f90]/60 text-[10px] font-mono text-[#cbd6e2]">
            Ctrl+K
          </span>
        </div>
      </div>

      {/* HUBSPOT-STYLE GLOBAL SEARCH POPOVER */}
      {open && (
        <div className="absolute left-0 right-0 sm:w-[660px] sm:-left-12 mt-2 bg-white rounded-xl border border-slate-200 shadow-2xl z-50 overflow-hidden text-[#33475b]">
          {/* 1. HEADER + SYSTEM FILTER & CATEGORY PILLS */}
          <div className="p-4 border-b border-slate-200 space-y-3 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-700">
                Pesquisar no STI-hub
              </span>

              {/* Seletor de Sistema (Buscar em: Todos | CRM | ERP | Chamados) */}
              <div className="inline-flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-[11px]">
                <span className="px-2 text-[10px] font-bold uppercase text-slate-500">
                  Buscar em:
                </span>
                {(
                  [
                    { id: 'ALL', label: 'Todos os Sistemas' },
                    { id: 'CRM', label: 'CRM' },
                    { id: 'ERP', label: 'ERP' },
                    { id: 'CHAMADOS', label: 'Chamados' },
                  ] as Array<{ id: SearchSystemFilter; label: string }>
                ).map((sys) => {
                  const isAct = systemFilter === sys.id;
                  return (
                    <button
                      key={sys.id}
                      type="button"
                      onClick={() => {
                        setSystemFilter(sys.id);
                        setActiveIndex(0);
                      }}
                      className={`px-2.5 py-1 rounded-md font-extrabold transition cursor-pointer ${
                        isAct
                          ? 'bg-[#213343] text-white shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {sys.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Pílulas de Categoria Selecionáveis (Múltipla Seleção estilo HubSpot) + Limpar filtros (N) */}
            <div className="flex flex-wrap items-center gap-1.5">
              {SEARCH_CATEGORY_PILLS.map((pill) => {
                const Icon = pill.icon;
                const active = selectedCategories.includes(pill.key);
                return (
                  <button
                    key={pill.key}
                    type="button"
                    onClick={() => toggleCategory(pill.key)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition cursor-pointer ${
                      active
                        ? pill.pillActiveCls
                        : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{pill.label}</span>
                  </button>
                );
              })}

              <div className="inline-flex items-center gap-2 ml-1 pl-2 border-l border-slate-200">
                <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
                {activeFiltersCount > 0 && (
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="text-xs font-bold text-[#0f766e] hover:underline cursor-pointer"
                  >
                    Limpar filtros ({activeFiltersCount})
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 2. RESULTS LIST ("Resultados selecionados recentemente" ou Resultados da Busca) */}
          <div className="max-h-96 overflow-y-auto">
            <div className="px-4 py-2 bg-slate-50/70 border-b border-slate-100 flex items-center justify-between text-[11px] font-bold text-slate-600">
              <span>
                {query.trim()
                  ? `Resultados encontrados (${filteredEntries.length})`
                  : 'Resultados selecionados recentemente'}
              </span>
              {systemFilter !== 'ALL' && (
                <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-800 text-[10px] font-extrabold">
                  Escopo: {systemFilter}
                </span>
              )}
            </div>

            {filteredEntries.length === 0 ? (
              <div className="p-8 text-center space-y-2 text-xs text-slate-500">
                <div className="font-bold text-slate-700">
                  Nenhum registro encontrado para &ldquo;{query}&rdquo; nos filtros selecionados.
                </div>
                {activeFiltersCount > 0 && (
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="px-3 py-1.5 rounded-lg bg-teal-50 text-[#0f766e] border border-teal-200 font-bold cursor-pointer"
                  >
                    Limpar filtros ({activeFiltersCount}) e buscar em todas as categorias
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredEntries.map((item, idx) => {
                  const meta =
                    SEARCH_CATEGORY_PILLS.find((p) => p.key === item.category) ||
                    SEARCH_CATEGORY_PILLS[0];
                  const Icon = meta.icon;
                  const isHighlighted = idx === activeIndex;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => handleChooseEntry(item)}
                      className={`w-full text-left px-4 py-3 flex items-center gap-3.5 transition cursor-pointer ${
                        isHighlighted ? 'bg-[#eaf0f6]/90' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div
                        className={`w-8 h-8 rounded-full ${meta.avatarBg} text-white flex items-center justify-center shrink-0 shadow-2xs`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-extrabold text-slate-900 truncate">
                          {item.title}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate mt-0.5">
                          {item.subtitle}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 3. FOOTER KEYBOARD SHORTCUTS BAR (EXACT HUBSPOT STYLE) */}
          <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-500">
            <div className="flex flex-wrap items-center gap-4">
              <span className="inline-flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-white border border-slate-300 font-mono text-[10px] text-slate-700">
                  ↑
                </kbd>
                <kbd className="px-1.5 py-0.5 rounded bg-white border border-slate-300 font-mono text-[10px] text-slate-700">
                  ↓
                </kbd>
                <span>Selecionar</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-white border border-slate-300 font-mono text-[10px] text-slate-700">
                  ↵
                </kbd>
                <span>Abrir</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-white border border-slate-300 font-mono text-[10px] text-slate-700">
                  Esc
                </kbd>
                <span>Fechar</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-white border border-slate-300 font-mono text-[10px] text-slate-700">
                  /
                </kbd>
                <span>Comandos</span>
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
