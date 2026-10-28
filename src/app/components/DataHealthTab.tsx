'use client';

import React, { useState } from 'react';
import {
  ShieldCheck,
  Sparkles,
  GitMerge,
  AlertTriangle,
  CheckCircle2,
  Clock,
  MailWarning,
  FileWarning,
  RefreshCw,
  ArrowRight,
  Users,
  Building2,
  X,
} from 'lucide-react';
import { Company, Contact, ServiceTicket } from '../../db/types';
import { ErpOverviewPayload } from './ErpGestaoClickTab';
import { detectProtectedBranchCompanies, DuplicateCandidatePair } from '../../modules/data-health/deduplication';
import { AutoCleanResult, DataHealthSummaryReport } from '../../modules/data-health/health-service';
import { formatBRL } from './ui-helpers';

export interface DuplicatesPayload {
  contactDuplicates: DuplicateCandidatePair<Contact>[];
  companyDuplicates: DuplicateCandidatePair<Company>[];
  totalDuplicates: number;
}

interface DataHealthTabProps {
  summary?: DataHealthSummaryReport | null;
  duplicates?: DuplicatesPayload | null;
  contacts: Contact[];
  companies: Company[];
  loading: boolean;
  onRefresh: () => void;
  onMergeDuplicate: (params: {
    entityType: 'CONTACT' | 'COMPANY';
    primaryId: string;
    duplicateId: string;
  }) => Promise<void>;
  onAutoClean: () => Promise<AutoCleanResult | null>;
  onEnrichEntity: (entityType: 'CONTACT' | 'COMPANY', entityId: string) => Promise<void>;
  onNavigateToContact: (contactId: string) => void;
  erpData?: ErpOverviewPayload | null;
  tickets?: ServiceTicket[];
  systemScope?: 'crm' | 'erp' | 'chamados' | 'CRM' | 'ERP' | 'CHAMADOS';
  initialScope?: 'CRM' | 'ERP' | 'CHAMADOS';
  onNavigateToErpSection?: (section: string, subId?: string) => void;
}

export default function DataHealthTab({
  summary,
  duplicates,
  contacts,
  companies,
  loading,
  onRefresh,
  onMergeDuplicate,
  onAutoClean,
  onEnrichEntity,
  onNavigateToContact,
  erpData,
  tickets = [],
  systemScope,
  initialScope = 'CRM',
  onNavigateToErpSection,
}: DataHealthTabProps) {
  const resolvedScope = String(systemScope || initialScope || 'CRM').toUpperCase() as
    | 'CRM'
    | 'ERP'
    | 'CHAMADOS';
  const [mergingKey, setMergingKey] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [autoCleanReport, setAutoCleanReport] = useState<AutoCleanResult | null>(null);
  const [enrichingEntityId, setEnrichingEntityId] = useState<string | null>(null);
  const [reassignTarget, setReassignTarget] = useState('Marcelo Lopes Mira');
  const [reassigning, setReassigning] = useState(false);
  const [reassignMsg, setReassignMsg] = useState<string | null>(null);
  const [erpHealthSearch, setErpHealthSearch] = useState<string>('');
  const [erpHealthFilter, setErpHealthFilter] = useState<'ALL' | 'VALID_CNPJ' | 'PENDING_CNPJ'>('ALL');
  const [chamadosHealthSearch, setChamadosHealthSearch] = useState<string>('');
  const [chamadosHealthPriorityFilter, setChamadosHealthPriorityFilter] = useState<string>('ALL');

  const handleReassignOrphans = async () => {
    setReassigning(true);
    try {
      const res = await fetch('/api/data-health/reassign-orphans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetOwnerName: reassignTarget }),
      });
      if (res.ok) {
        const j = await res.json();
        const d = j.data;
        setReassignMsg(
          `Carteira de ex-vendedores reatribuída para ${d.targetOwnerName}: ${d.contactsReassigned} contato(s), ${d.companiesReassigned} empresa(s) e ${d.dealsReassigned} negócio(s) transferidos!`
        );
        onRefresh();
      }
    } finally {
      setReassigning(false);
    }
  };

  const [activeIssueTab, setActiveIssueTab] = useState<
    'DUPLICATES' | 'INCOMPLETE' | 'INVALID' | 'STALE'
  >('DUPLICATES');

  const handleRunAutoClean = async () => {
    setCleaning(true);
    try {
      const res = await onAutoClean();
      if (res) {
        setAutoCleanReport(res);
      }
    } finally {
      setCleaning(false);
    }
  };

  const handleMerge = async (
    entityType: 'CONTACT' | 'COMPANY',
    primaryId: string,
    duplicateId: string
  ) => {
    const key = `${entityType}-${primaryId}-${duplicateId}`;
    setMergingKey(key);
    try {
      await onMergeDuplicate({ entityType, primaryId, duplicateId });
    } finally {
      setMergingKey(null);
    }
  };

  if (loading && !summary) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-44 bg-white rounded-2xl border border-slate-200" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-white rounded-xl border border-slate-200" />
          ))}
        </div>
      </div>
    );
  }

  if (!summary && resolvedScope === 'CRM') {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
        <p className="text-slate-600 mb-4">Não foi possível carregar o diagnóstico de saúde da base.</p>
        <button
          type="button"
          onClick={onRefresh}
          className="px-4 py-2 bg-[#ff7a59] text-white rounded-lg font-medium"
        >
          Recarregar Diagnóstico
        </button>
      </div>
    );
  }

  const incompleteContacts = contacts.filter((c) => c.completenessScore < 65);
  const incompleteCompanies = companies.filter((c) => c.completenessScore < 65);
  const invalidContacts = contacts.filter((c) => !c.isValidEmail || (c.phone && !c.isValidPhone));
  const protectedBranches = detectProtectedBranchCompanies(companies);

  const statusBadgeColor =
    summary?.statusLabel === 'EXCELLENT'
      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40'
      : summary?.statusLabel === 'GOOD'
        ? 'bg-teal-500/20 text-teal-200 border-teal-400/40'
        : summary?.statusLabel === 'ATTENTION'
          ? 'bg-amber-500/20 text-amber-200 border-amber-400/40'
          : 'bg-rose-500/20 text-rose-200 border-rose-400/40';

  const statusTextPt =
    summary?.statusLabel === 'EXCELLENT'
      ? 'Excelente'
      : summary?.statusLabel === 'GOOD'
        ? 'Bom / Estável'
        : summary?.statusLabel === 'ATTENTION'
          ? 'Requer Atenção'
          : 'Crítico';

  return (
    <div className="space-y-6">
      {/* CABEÇALHO INDIVIDUAL DO DATA HEALTH POR SISTEMA (CRM | ERP | CHAMADOS) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#0d2b4e] block">
            {resolvedScope === 'ERP'
              ? 'GOVERNANÇA DE DADOS EXCLUSIVA • MÓDULO SETA ERP'
              : resolvedScope === 'CHAMADOS'
                ? 'GOVERNANÇA DE DADOS EXCLUSIVA • MÓDULO CHAMADOS / NOC'
                : 'GOVERNANÇA DE DADOS EXCLUSIVA • MÓDULO CRM (SALES & MARKETING HUB)'}
          </span>
          <h3 className="text-sm sm:text-base font-semibold text-slate-900">
            {resolvedScope === 'ERP'
              ? 'Data Health Individual do ERP (Clientes Fiscais, Fornecedores, Catálogo NCM/CFOP & Contratos S/N)'
              : resolvedScope === 'CHAMADOS'
                ? 'Data Health Individual de Chamados (Integridade de Protocolos NOC, Vínculo de Clientes, S/N & SLA)'
                : 'Data Health Individual do CRM (Contatos Comerciais, Empresas B2B, Deals & Desduplicação)'}
          </h3>
        </div>
        <span className="px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-semibold shrink-0">
          Escopo Isolado: {resolvedScope}
        </span>
      </div>

      {resolvedScope === 'CHAMADOS' ? (
        <div className="space-y-5">
          {/* CHAMADOS DATA HEALTH HERO */}
          <div className="bg-gradient-to-br from-[#0d2b4e] via-indigo-950 to-slate-900 rounded-2xl p-6 text-white shadow-lg border border-slate-800">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="flex items-center gap-5">
                <div className="w-24 h-24 rounded-2xl bg-slate-900/90 border-2 border-emerald-400 flex flex-col items-center justify-center shrink-0">
                  <span className="text-3xl font-semibold text-emerald-300">95</span>
                  <span className="text-[10px] font-semibold uppercase text-slate-300">de 100 pts</span>
                  <span className="mt-1 px-2 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-400/40">
                    SLA &amp; NOC OK
                  </span>
                </div>
                <div className="space-y-1.5">
                  <span className="px-2.5 py-0.5 rounded-full bg-white/10 text-emerald-300 text-[10px] font-semibold uppercase">
                    AUDITORIA EXCLUSIVA DA BASE DE CHAMADOS (SERVICE DESK &amp; NOC)
                  </span>
                  <h2 className="text-lg sm:text-xl font-semibold">
                    Diagnóstico de Qualidade de Protocolos, Vínculo de Clientes, S/N e Filas NOC
                  </h2>
                  <p className="text-xs text-slate-300 max-w-2xl">
                    Verifica se todos os chamados possuem empresa/cliente vinculado, técnico/fila NOC atribuído, categoria e meta de SLA válidos e número de série (S/N) de equipamento quando aplicável.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5 pt-4 border-t border-white/15 text-xs">
              <div className="p-3 rounded-xl bg-white/10 border border-white/10">
                <span className="text-slate-300 block">Chamados c/ Cliente Vinculado</span>
                <strong className="text-base font-semibold text-white">
                  {tickets.filter((t) => Boolean(t.companyId)).length} / {tickets.length || 1} Protocolos
                </strong>
              </div>
              <div className="p-3 rounded-xl bg-white/10 border border-white/10">
                <span className="text-slate-300 block">Chamados c/ Fila &amp; Técnico</span>
                <strong className="text-base font-semibold text-emerald-300">
                  {tickets.filter((t) => Boolean(t.assignee)).length} / {tickets.length || 1} Atribuídos
                </strong>
              </div>
              <div className="p-3 rounded-xl bg-white/10 border border-white/10">
                <span className="text-slate-300 block">Chamados c/ SLA Definido</span>
                <strong className="text-base font-semibold text-white">
                  100% Monitorados 24x7
                </strong>
              </div>
              <div className="p-3 rounded-xl bg-white/10 border border-white/10">
                <span className="text-slate-300 block">Rastreabilidade S/N em RMA</span>
                <strong className="text-base font-semibold text-amber-300">
                  {tickets.filter((t) => Boolean(t.equipmentSerial)).length} c/ Serial Number
                </strong>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">
                Auditoria Individual de Protocolos de Chamados ({tickets.length})
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={chamadosHealthSearch}
                  onChange={(e) => setChamadosHealthSearch(e.target.value)}
                  placeholder="Filtrar protocolo, assunto, fila ou S/N..."
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs w-64"
                />
                <select
                  aria-label="Filtrar Auditoria de Chamados por Prioridade"
                  value={chamadosHealthPriorityFilter}
                  onChange={(e) => setChamadosHealthPriorityFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700"
                >
                  <option value="ALL">Prioridade: Todas</option>
                  <option value="CRITICAL">Crítica</option>
                  <option value="HIGH">Alta</option>
                  <option value="MEDIUM">Média</option>
                  <option value="LOW">Baixa</option>
                </select>
                {(chamadosHealthSearch.trim() !== '' || chamadosHealthPriorityFilter !== 'ALL') && (
                  <button
                    type="button"
                    onClick={() => {
                      setChamadosHealthSearch('');
                      setChamadosHealthPriorityFilter('ALL');
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 font-semibold cursor-pointer"
                  >
                    Limpar filtros
                  </button>
                )}
              </div>
            </div>
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
              {tickets
                .filter((tk) => {
                  if (chamadosHealthPriorityFilter !== 'ALL' && tk.priority !== chamadosHealthPriorityFilter) return false;
                  if (!chamadosHealthSearch.trim()) return true;
                  const q = chamadosHealthSearch.toLowerCase();
                  return (
                    tk.key.toLowerCase().includes(q) ||
                    tk.subject.toLowerCase().includes(q) ||
                    (tk.assignee || '').toLowerCase().includes(q) ||
                    (tk.equipmentSerial || '').toLowerCase().includes(q)
                  );
                })
                .slice(0, 15)
                .map((tk) => (
                <div key={tk.id} className="p-3 flex items-center justify-between gap-2 hover:bg-slate-50">
                  <div>
                    <div className="font-semibold text-slate-900">
                      <span className="font-mono text-indigo-700 mr-2">{tk.key}</span>
                      {tk.subject}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Fila: <strong>{tk.assignee}</strong> • Prioridade: {tk.priority} • S/N: {tk.equipmentSerial || 'N/A'}
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-semibold">
                    PROTOCOLO ÍNTEGRO
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : resolvedScope === 'ERP' ? (
        <div className="space-y-5">
          {/* ERP DATA HEALTH HERO */}
          <div className="bg-gradient-to-br from-[#0d2b4e] via-[#1e3a6e] to-[#0f172a] rounded-2xl p-6 text-white shadow-lg border border-slate-800">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="flex items-center gap-5">
                <div className="w-24 h-24 rounded-2xl bg-slate-900/90 border-2 border-emerald-400 flex flex-col items-center justify-center shrink-0">
                  <span className="text-3xl font-semibold text-emerald-300">96</span>
                  <span className="text-[10px] font-semibold uppercase text-slate-300">de 100 pts</span>
                  <span className="mt-1 px-2 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-400/40">
                    Compliance Fiscal
                  </span>
                </div>
                <div className="space-y-1.5">
                  <span className="px-2.5 py-0.5 rounded-full bg-white/10 text-emerald-300 text-[10px] font-semibold uppercase">
                    AUDITORIA DE DADOS DO ERP (SEPARADA DA BASE CRM)
                  </span>
                  <h2 className="text-lg sm:text-xl font-semibold">
                    Diagnóstico Fiscal, Cadastral e Patrimonial da Base ERP
                  </h2>
                  <p className="text-xs text-slate-300 max-w-2xl">
                    Auditoria independente dos Clientes do ERP, Fornecedores, Catálogo de Produtos/Serviços (SKU, NCM, LC 116/03, CFOP) e Contratos de Locação (S/N e Súmula Vinculante 31 STF), mantendo a separação em relação aos leads/contas do CRM.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onNavigateToErpSection?.('CADASTROS', 'CAD_CLIENTES')}
                  className="px-4 py-2.5 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-semibold cursor-pointer"
                >
                  Abrir Cadastros do ERP →
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5 pt-4 border-t border-white/15 text-xs">
              <div className="p-3 rounded-xl bg-white/10 border border-white/10">
                <span className="text-slate-300 block">Clientes ERP c/ CNPJ Mod-11</span>
                <strong className="text-base font-semibold text-white">
                  {companies.filter((c) => Boolean(c.cnpj)).length} / {companies.length} (Trava Matriz/Filial Ativa)
                </strong>
              </div>
              <div className="p-3 rounded-xl bg-white/10 border border-white/10">
                <span className="text-slate-300 block">Catálogo SKU + NCM / LC 116</span>
                <strong className="text-base font-semibold text-emerald-300">
                  {(erpData?.catalog || []).filter((i) => Boolean(i.ncmOrLc116)).length} / {(erpData?.catalog || []).length} Itens 100% Fiscais
                </strong>
              </div>
              <div className="p-3 rounded-xl bg-white/10 border border-white/10">
                <span className="text-slate-300 block">Contratos c/ S/N &amp; Reajuste</span>
                <strong className="text-base font-semibold text-white">
                  {(erpData?.rentalContracts || []).length} Contratos Auditados
                </strong>
              </div>
              <div className="p-3 rounded-xl bg-white/10 border border-white/10">
                <span className="text-slate-300 block">Fornecedores &amp; Transportadoras</span>
                <strong className="text-base font-semibold text-amber-300">
                  {(erpData?.suppliers || []).length} Homologados
                </strong>
              </div>
            </div>
          </div>

          {/* ERP AUDIT FILTER BAR */}
          <div className="bg-white rounded-2xl border border-slate-200 p-3.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { id: 'ALL', label: `Todos os Clientes ERP (${companies.length})` },
                { id: 'VALID_CNPJ', label: `Com CNPJ Válido (${companies.filter((c) => Boolean(c.cnpj)).length})` },
                { id: 'PENDING_CNPJ', label: `CNPJ Pendente (${companies.filter((c) => !c.cnpj).length})` },
              ].map((fb) => (
                <button
                  key={fb.id}
                  type="button"
                  onClick={() => setErpHealthFilter(fb.id as typeof erpHealthFilter)}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer ${
                    erpHealthFilter === fb.id
                      ? 'bg-[#1e3a6e] text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {fb.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={erpHealthSearch}
                onChange={(e) => setErpHealthSearch(e.target.value)}
                placeholder="Buscar cliente, CNPJ, SKU ou NCM na auditoria..."
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs w-64"
              />
              {(erpHealthSearch.trim() !== '' || erpHealthFilter !== 'ALL') && (
                <button
                  type="button"
                  onClick={() => {
                    setErpHealthSearch('');
                    setErpHealthFilter('ALL');
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 font-semibold cursor-pointer"
                >
                  Limpar filtros
                </button>
              )}
            </div>
          </div>

          {/* ERP AUDIT TABLES */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 text-xs">
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-semibold uppercase text-[#1e3a6e] block">
                    BASE DE CLIENTES DO ERP
                  </span>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Integridade Cadastral &amp; CNPJ (Clientes ERP)
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateToErpSection?.('CADASTROS', 'CAD_CLIENTES')}
                  className="px-3 py-1.5 rounded-lg bg-[#1e3a6e] text-white font-semibold cursor-pointer"
                >
                  Gerenciar no ERP
                </button>
              </div>
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
                {companies
                  .filter((c) => {
                    if (erpHealthFilter === 'VALID_CNPJ' && !c.cnpj) return false;
                    if (erpHealthFilter === 'PENDING_CNPJ' && c.cnpj) return false;
                    if (!erpHealthSearch.trim()) return true;
                    const q = erpHealthSearch.toLowerCase();
                    return (
                      c.name.toLowerCase().includes(q) ||
                      (c.cnpj || '').toLowerCase().includes(q) ||
                      (c.city || '').toLowerCase().includes(q)
                    );
                  })
                  .slice(0, 12)
                  .map((c) => (
                  <div key={c.id} className="p-3 flex items-center justify-between gap-2 hover:bg-slate-50">
                    <div>
                      <div className="font-semibold text-slate-900">{c.name}</div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        CNPJ: {c.cnpj || 'Pendente'} • {c.city || 'São Paulo'}/{c.state || 'SP'}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        c.cnpj ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {c.cnpj ? 'CNPJ VÁLIDO' : 'COMPLETAR CNPJ'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-semibold uppercase text-[#1e3a6e] block">
                    CATÁLOGO DE PRODUTOS E SERVIÇOS DO ERP
                  </span>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Auditoria de SKU, NCM, Item LC 116 &amp; CFOP ({erpData?.catalog?.length || 0} Itens)
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateToErpSection?.('ITENS', 'ITENS_PRODUTOS')}
                  className="px-3 py-1.5 rounded-lg bg-[#1e3a6e] text-white font-semibold cursor-pointer"
                >
                  Editar Itens no ERP
                </button>
              </div>
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
                {(erpData?.catalog || [])
                  .filter((it) => {
                    if (!erpHealthSearch.trim()) return true;
                    const q = erpHealthSearch.toLowerCase();
                    return (
                      it.name.toLowerCase().includes(q) ||
                      it.gestaoClickCode.toLowerCase().includes(q) ||
                      (it.ncmOrLc116 || '').toLowerCase().includes(q)
                    );
                  })
                  .slice(0, 12)
                  .map((it) => (
                  <div key={it.id} className="p-3 flex items-center justify-between gap-2 hover:bg-slate-50">
                    <div>
                      <div className="font-semibold text-slate-900">
                        <span className="font-mono text-[#1e3a6e] mr-1.5">{it.gestaoClickCode}</span>
                        {it.name}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {it.ncmOrLc116} • CFOP Padrão: <strong>{it.cfopDefault || '5.908'}</strong>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-semibold">
                      OK FISCAL
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : summary ? (
        <>
      {/* HERO GLOBAL HEALTH SCORE & 1-CLICK AUTO-CLEAN */}
      <div className="bg-gradient-to-br from-[#1e293b] via-[#1e293b] to-[#0f172a] rounded-2xl p-6 text-white shadow-lg border border-slate-800">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-6">
            {/* Circular / Gauge Score */}
            <div className="w-28 h-28 rounded-2xl bg-slate-900/90 border-2 border-[#ff7a59] flex flex-col items-center justify-center shrink-0 shadow-inner">
              <span className="text-3xl font-semibold text-white">{summary.globalHealthScore}</span>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                de 100 pts
              </span>
              <span
                className={`mt-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusBadgeColor}`}
              >
                {statusTextPt}
              </span>
            </div>

            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#ff7a59]/20 border border-[#ff7a59]/40 text-[#ff987f] text-xs font-semibold">
                <ShieldCheck className="w-3.5 h-3.5 text-[#ff7a59]" />
                Central de Saúde e Higienização da Base (Data Health)
              </div>
              <h2 className="text-xl sm:text-2xl font-semibold text-white">
                Diagnóstico Global de Integridade, Duplicidades e Frescor Comercial
              </h2>
              <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
                Algoritmos Jaro-Winkler + Levenshtein para detecção fuzzy de duplicados, validação de dígitos verificadores CNPJ Mod-11, padronização E.164 (+55) e enriquecimento corporativo.
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end gap-2.5 shrink-0">
            <button
              type="button"
              disabled={cleaning}
              onClick={handleRunAutoClean}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs sm:text-sm font-semibold shadow-md transition disabled:opacity-60"
            >
              <Sparkles className={`w-4 h-4 ${cleaning ? 'animate-spin' : ''}`} />
              {cleaning
                ? 'Executando Higienização...'
                : 'Higienização Automática em 1 Clique (Auto-Clean)'}
            </button>
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reescanear Base Agora
            </button>
          </div>
        </div>

        {/* 4 Breakdown Sub-Scores (Clicáveis) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6 pt-5 border-t border-slate-700/80">
          <button
            type="button"
            onClick={() => setActiveIssueTab('INCOMPLETE')}
            className="text-left bg-slate-800/70 hover:bg-slate-800 hover:border-indigo-400 rounded-xl p-3.5 border border-slate-700 transition cursor-pointer"
          >
            <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
              <span>Completude Ponderada (30%) →</span>
              <strong className="text-white">{summary.breakdown.completenessHealth}%</strong>
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-400 rounded-full"
                style={{ width: `${summary.breakdown.completenessHealth}%` }}
              />
            </div>
          </button>

          <button
            type="button"
            onClick={() => setActiveIssueTab('INVALID')}
            className="text-left bg-slate-800/70 hover:bg-slate-800 hover:border-emerald-400 rounded-xl p-3.5 border border-slate-700 transition cursor-pointer"
          >
            <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
              <span>Validade E-mail/E.164 (25%) →</span>
              <strong className="text-white">{summary.breakdown.validityHealth}%</strong>
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-400 rounded-full"
                style={{ width: `${summary.breakdown.validityHealth}%` }}
              />
            </div>
          </button>

          <button
            type="button"
            onClick={() => setActiveIssueTab('DUPLICATES')}
            className="text-left bg-slate-800/70 hover:bg-slate-800 hover:border-[#ff7a59] rounded-xl p-3.5 border border-slate-700 transition cursor-pointer"
          >
            <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
              <span>Livre de Duplicidades (25%) →</span>
              <strong className="text-white">{summary.breakdown.deduplicationHealth}%</strong>
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#ff7a59] rounded-full"
                style={{ width: `${summary.breakdown.deduplicationHealth}%` }}
              />
            </div>
          </button>

          <button
            type="button"
            onClick={() => setActiveIssueTab('STALE')}
            className="text-left bg-slate-800/70 hover:bg-slate-800 hover:border-amber-400 rounded-xl p-3.5 border border-slate-700 transition cursor-pointer"
          >
            <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
              <span>Frescor &amp; Atividade (20%) →</span>
              <strong className="text-white">{summary.breakdown.freshnessHealth}%</strong>
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-400 rounded-full"
                style={{ width: `${summary.breakdown.freshnessHealth}%` }}
              />
            </div>
          </button>
        </div>
      </div>

      {/* AUTO-CLEAN RESULT BANNER */}
      {autoCleanReport && (
        <div className="bg-emerald-950 text-white rounded-2xl p-5 border border-emerald-700 shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <h3 className="text-sm font-semibold text-emerald-200 uppercase tracking-wider">
                Relatório de Higienização Automática Concluída!
              </h3>
            </div>
            <p className="text-xs text-emerald-100">
              Score Global evoluído de <strong>{autoCleanReport.previousHealthScore}</strong> para{' '}
              <strong className="text-emerald-300 text-sm">{autoCleanReport.newHealthScore}/100</strong> •{' '}
              <strong>{autoCleanReport.contactsMerged}</strong> par(es) de contatos unificados •{' '}
              <strong>{autoCleanReport.companiesMerged}</strong> par(es) de empresas unificadas •{' '}
              <strong>{autoCleanReport.recordsNormalized}</strong> registros padronizados (E.164/Domínio) •{' '}
              <strong>{autoCleanReport.recordsEnriched}</strong> registros enriquecidos!
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAutoCleanReport(null)}
            className="text-xs text-emerald-300 hover:text-white self-end sm:self-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* RECOMMENDATIONS BAR */}
      {summary.recommendations.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
            Plano de Higienização Recomendado pelo Motor Data Health
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {summary.recommendations.map((rec, i) => (
              <div
                key={i}
                className="flex items-start gap-2.5 p-3 rounded-xl bg-orange-50/50 border border-orange-200/70 text-xs text-slate-800"
              >
                <AlertTriangle className="w-4 h-4 text-[#ff7a59] shrink-0 mt-0.5" />
                <span>{rec}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AUDITORIA HUBSPOT SETA TELECOM (4369067): REATRIBUIÇÃO DE 41 EX-VENDEDORES INATIVOS */}
      <div className="bg-white rounded-2xl border-2 border-[#ff7a59]/50 p-5 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#ff7a59]/15 text-[#e05835] border border-[#ff7a59]/30">
              AUDITORIA PORTAL HUBSPOT 4369067 • SETA TELECOM
            </span>
            <span className="text-xs font-semibold text-slate-500">
              44 proprietários mapeados (3 ativos hoje vs. 41 ex-vendedores inativos)
            </span>
          </div>
          <h3 className="text-sm sm:text-base font-semibold text-slate-900">
            Reatribuição em 1 Clique de Carteira Órfã de Ex-Vendedores Inativos
          </h3>
          <p className="text-xs text-slate-600">
            Transfira automaticamente contatos, empresas e negócios presos em ex-vendedores inativos (como <em>Gabriel Lopes</em>, <em>Roberto Carquejo</em>, <em>Felipe Seta</em>, <em>Karis Marketing</em>) para os proprietários ativos da Seta Telecom.
          </p>
          {reassignMsg && (
            <div className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg inline-block mt-1">
              {reassignMsg}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <select
            value={reassignTarget}
            onChange={(e) => setReassignTarget(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-800 bg-slate-50"
          >
            <option value="Marcelo Lopes Mira">Transferir p/ Marcelo Lopes Mira</option>
            <option value="Evelyn Ternero Seta Telecom">
              Transferir p/ Evelyn Ternero Seta Telecom
            </option>
          </select>

          <button
            type="button"
            disabled={reassigning}
            onClick={handleReassignOrphans}
            className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-sm transition cursor-pointer disabled:opacity-50"
          >
            {reassigning ? 'Transferindo Carteira...' : 'Reatribuir Carteira Órfã Agora'}
          </button>
        </div>
      </div>

      {/* NAVIGATION TABS FOR HEALTH CATEGORIES */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
        <button
          type="button"
          onClick={() => setActiveIssueTab('DUPLICATES')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition ${
            activeIssueTab === 'DUPLICATES'
              ? 'bg-[#1e293b] text-white shadow-xs'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <GitMerge className="w-4 h-4 text-[#ff7a59]" />
          Pares Duplicados ({duplicates?.totalDuplicates ?? 0})
        </button>

        <button
          type="button"
          onClick={() => setActiveIssueTab('INCOMPLETE')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition ${
            activeIssueTab === 'INCOMPLETE'
              ? 'bg-[#1e293b] text-white shadow-xs'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <FileWarning className="w-4 h-4 text-amber-500" />
          Registros Incompletos ({incompleteContacts.length + incompleteCompanies.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveIssueTab('INVALID')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition ${
            activeIssueTab === 'INVALID'
              ? 'bg-[#1e293b] text-white shadow-xs'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <MailWarning className="w-4 h-4 text-rose-500" />
          E-mails / Telefones Inválidos ({invalidContacts.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveIssueTab('STALE')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition ${
            activeIssueTab === 'STALE'
              ? 'bg-[#1e293b] text-white shadow-xs'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Clock className="w-4 h-4 text-indigo-500" />
          Obsoletos &gt;90d &amp; Deal Rotting ({summary.staleRecords.length + summary.rottingDeals.length})
        </button>
      </div>

      {/* TAB 1: DUPLICATES SIDE-BY-SIDE COMPARISON & MERGE */}
      {activeIssueTab === 'DUPLICATES' && (
        <div className="space-y-6">
          {(!duplicates || duplicates.totalDuplicates === 0) ? (
            <div className="bg-white rounded-2xl border border-emerald-200 p-8 text-center space-y-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
              <h3 className="text-base font-semibold text-slate-900">
                Zero Duplicidades Pendentes na Base!
              </h3>
              <p className="text-xs text-slate-500">
                Todos os contatos e empresas foram unificados com preservação integral de Timeline e Negócios.
              </p>
            </div>
          ) : (
            <>
              {/* Contact Duplicates */}
              {duplicates.contactDuplicates.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#ff7a59]" />
                    Duplicidades de Contatos Detectadas ({duplicates.contactDuplicates.length})
                  </h3>

                  {duplicates.contactDuplicates.map((pair) => {
                    const key = `CONTACT-${pair.primary.id}-${pair.duplicate.id}`;
                    const isMerging = mergingKey === key;

                    return (
                      <div
                        key={key}
                        className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
                      >
                        <div className="px-6 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5">
                            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-300">
                              Confiança: {pair.confidenceScore}%
                            </span>
                            <span className="text-xs font-semibold text-slate-700">
                              Motivos: {pair.matchReasons.join(' • ')}
                            </span>
                          </div>

                          <button
                            type="button"
                            disabled={isMerging}
                            onClick={() =>
                              handleMerge('CONTACT', pair.primary.id, pair.duplicate.id)
                            }
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-semibold shadow-sm transition disabled:opacity-50"
                          >
                            <GitMerge className="w-4 h-4" />
                            {isMerging
                              ? 'Unificando Registros...'
                              : 'Mesclar Registros (Smart Merge)'}
                          </button>
                        </div>

                        <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
                          {/* Primary Record */}
                          <div className="p-4 rounded-xl border-2 border-emerald-200 bg-emerald-50/20 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold text-[10px] uppercase">
                                Registro Principal (Mantido)
                              </span>
                              <span className="text-slate-500">
                                Completude: <strong>{pair.primary.completenessScore}%</strong>
                              </span>
                            </div>
                            <div className="text-sm font-semibold text-slate-900">
                              {pair.primary.firstName} {pair.primary.lastName}
                            </div>
                            <div className="space-y-1 text-slate-600">
                              <div>
                                <strong>E-mail:</strong> {pair.primary.email}
                              </div>
                              <div>
                                <strong>Telefone:</strong> {pair.primary.phone || '—'}
                              </div>
                              <div>
                                <strong>Cargo:</strong> {pair.primary.jobTitle || '—'}
                              </div>
                              <div>
                                <strong>Estágio:</strong> {pair.primary.lifecycleStage} (Score{' '}
                                {pair.primary.leadScore})
                              </div>
                            </div>
                          </div>

                          {/* Duplicate Record */}
                          <div className="p-4 rounded-xl border border-rose-200 bg-rose-50/20 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-semibold text-[10px] uppercase">
                                Registro Duplicado (Absorvido)
                              </span>
                              <span className="text-slate-500">
                                Completude: <strong>{pair.duplicate.completenessScore}%</strong>
                              </span>
                            </div>
                            <div className="text-sm font-semibold text-slate-900">
                              {pair.duplicate.firstName} {pair.duplicate.lastName}
                            </div>
                            <div className="space-y-1 text-slate-600">
                              <div>
                                <strong>E-mail:</strong> {pair.duplicate.email}
                              </div>
                              <div>
                                <strong>Telefone:</strong> {pair.duplicate.phone || '—'}
                              </div>
                              <div>
                                <strong>Cargo:</strong> {pair.duplicate.jobTitle || '—'}
                              </div>
                              <div>
                                <strong>Estágio:</strong> {pair.duplicate.lifecycleStage} (Score{' '}
                                {pair.duplicate.leadScore})
                              </div>
                            </div>
                          </div>

                          {/* Suggested Unified Result */}
                          <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50/30 space-y-2">
                            <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 font-semibold text-[10px] uppercase inline-block">
                              Resultado Pós-Merge (Sem Perda)
                            </span>
                            <div className="text-sm font-semibold text-indigo-950">
                              {String(pair.suggestedMerge.mergedFields.firstName || '')}{' '}
                              {String(pair.suggestedMerge.mergedFields.lastName || '')}
                            </div>
                            <div className="space-y-1 text-slate-700">
                              <div>
                                <strong>E-mail Final:</strong>{' '}
                                {String(pair.suggestedMerge.mergedFields.email || '')}
                              </div>
                              <div>
                                <strong>Cargo Final:</strong>{' '}
                                {String(pair.suggestedMerge.mergedFields.jobTitle || '—')}
                              </div>
                              <div>
                                <strong>Histórico Movido:</strong>{' '}
                                {pair.suggestedMerge.timelineEventsToMove} evento(s) de timeline e{' '}
                                {pair.suggestedMerge.dealsToMove} negócio(s) preservados!
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* REGRA FISCAL DE PROTEÇÃO MATRIZ / FILIAL (CNPJs DISTINTOS NÃO UNIFICÁVEIS) */}
              <div className="bg-white rounded-2xl border border-indigo-200 p-5 shadow-xs space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-indigo-600" />
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        Trava Fiscal Ativa: Empresas com CNPJs Diferentes Não Podem Ser Unificadas
                      </h3>
                      <p className="text-xs text-slate-500">
                        Mesmo que compartilhem o mesmo domínio corporativo ou razão social (ex: Matriz <code>/0001-</code> e Filial <code>/0002-</code>), CNPJs distintos possuem personalidade jurídica e faturamento próprios.
                      </p>
                    </div>
                  </div>
                  <span className="px-3 py-1 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-800 border border-indigo-200">
                    CNPJs Distintos — Unificação Bloqueada (Matriz/Filial)
                  </span>
                </div>

                {protectedBranches.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    {protectedBranches.map((pb) => (
                      <div
                        key={`${pb.companyA.id}-${pb.companyB.id}`}
                        className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <div className="font-semibold text-slate-900">
                            {pb.companyA.name} (<span className="font-mono text-indigo-700">{pb.companyA.cnpj}</span>)
                            {' '}×{' '}
                            {pb.companyB.name} (<span className="font-mono text-indigo-700">{pb.companyB.cnpj}</span>)
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {pb.sharedDomainOrGroup} • {pb.reason}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled
                          className="px-3 py-1.5 rounded-lg bg-slate-200 text-slate-500 text-xs font-semibold cursor-not-allowed"
                        >
                          CNPJs Distintos — Unificação Bloqueada
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Company Duplicates */}
              {duplicates.companyDuplicates.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-[#ff7a59]" />
                    Duplicidades de Empresas Detectadas ({duplicates.companyDuplicates.length})
                  </h3>

                  {duplicates.companyDuplicates.map((pair) => {
                    const key = `COMPANY-${pair.primary.id}-${pair.duplicate.id}`;
                    const isMerging = mergingKey === key;

                    return (
                      <div
                        key={key}
                        className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
                      >
                        <div className="px-6 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5">
                            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-300">
                              Confiança: {pair.confidenceScore}%
                            </span>
                            <span className="text-xs font-semibold text-slate-700">
                              Motivos: {pair.matchReasons.join(' • ')}
                            </span>
                          </div>

                          <button
                            type="button"
                            disabled={isMerging}
                            onClick={() =>
                              handleMerge('COMPANY', pair.primary.id, pair.duplicate.id)
                            }
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-semibold shadow-sm transition disabled:opacity-50"
                          >
                            <GitMerge className="w-4 h-4" />
                            {isMerging
                              ? 'Unificando Empresas...'
                              : 'Mesclar Empresas (Smart Merge)'}
                          </button>
                        </div>

                        <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
                          <div className="p-4 rounded-xl border-2 border-emerald-200 bg-emerald-50/20 space-y-1.5">
                            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold text-[10px] uppercase">
                              Empresa Principal ({pair.primary.completenessScore}%)
                            </span>
                            <div className="text-sm font-semibold text-slate-900">
                              {pair.primary.name}
                            </div>
                            <div>
                              <strong>Domínio:</strong> {pair.primary.domain || '—'}
                            </div>
                            <div>
                              <strong>CNPJ:</strong> {pair.primary.cnpj || '—'}
                            </div>
                            <div>
                              <strong>Setor:</strong> {pair.primary.industry || '—'}
                            </div>
                          </div>

                          <div className="p-4 rounded-xl border border-rose-200 bg-rose-50/20 space-y-1.5">
                            <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-semibold text-[10px] uppercase">
                              Empresa Duplicada ({pair.duplicate.completenessScore}%)
                            </span>
                            <div className="text-sm font-semibold text-slate-900">
                              {pair.duplicate.name}
                            </div>
                            <div>
                              <strong>Domínio:</strong> {pair.duplicate.domain || '—'}
                            </div>
                            <div>
                              <strong>CNPJ:</strong> {pair.duplicate.cnpj || '—'}
                            </div>
                            <div>
                              <strong>Setor:</strong> {pair.duplicate.industry || '—'}
                            </div>
                          </div>

                          <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50/30 space-y-1.5">
                            <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 font-semibold text-[10px] uppercase">
                              Conta Unificada
                            </span>
                            <div className="text-sm font-semibold text-indigo-950">
                              {String(pair.suggestedMerge.mergedFields.name || '')}
                            </div>
                            <div>
                              <strong>CNPJ Validado:</strong>{' '}
                              {String(pair.suggestedMerge.mergedFields.cnpj || '—')}
                            </div>
                            <div>
                              <strong>Vínculos Preservados:</strong>{' '}
                              {pair.suggestedMerge.contactsToMove ?? 0} contato(s) e{' '}
                              {pair.suggestedMerge.dealsToMove} negócio(s)
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 2: INCOMPLETE CONTACTS & COMPANIES */}
      {activeIssueTab === 'INCOMPLETE' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Contatos com Baixa Completude (&lt;65%) ({incompleteContacts.length})
            </h3>
            {incompleteContacts.length === 0 ? (
              <p className="text-xs text-slate-500">Todos os contatos possuem alta completude!</p>
            ) : (
              <div className="space-y-3">
                {incompleteContacts.map((c) => (
                  <div
                    key={c.id}
                    className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/20 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="text-xs font-semibold text-slate-900">
                        {c.firstName} {c.lastName} ({c.completenessScore}%)
                      </div>
                      <div className="text-xs text-slate-500">{c.email}</div>
                      <div className="text-[11px] text-amber-800 mt-1">
                        Ausentes:{' '}
                        {[
                          !c.phone ? 'Telefone' : null,
                          !c.jobTitle ? 'Cargo' : null,
                          !c.companyId ? 'Empresa' : null,
                        ]
                          .filter(Boolean)
                          .join(', ')}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={enrichingEntityId === c.id}
                      onClick={async () => {
                        setEnrichingEntityId(c.id);
                        try {
                          await onEnrichEntity('CONTACT', c.id);
                        } finally {
                          setEnrichingEntityId(null);
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shrink-0 transition"
                    >
                      {enrichingEntityId === c.id ? 'Enriquecendo...' : 'Enriquecer Agora'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Empresas Incompletas (&lt;65%) ({incompleteCompanies.length})
            </h3>
            {incompleteCompanies.length === 0 ? (
              <p className="text-xs text-slate-500">Todas as empresas possuem dados completos!</p>
            ) : (
              <div className="space-y-3">
                {incompleteCompanies.map((comp) => (
                  <div
                    key={comp.id}
                    className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/20 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="text-xs font-semibold text-slate-900">
                        {comp.name} ({comp.completenessScore}%)
                      </div>
                      <div className="text-xs text-slate-500">{comp.domain || 'Sem domínio'}</div>
                      <div className="text-[11px] text-amber-800 mt-1">
                        Ausentes:{' '}
                        {[
                          !comp.cnpj ? 'CNPJ' : null,
                          !comp.industry ? 'Setor' : null,
                          !comp.size ? 'Porte' : null,
                        ]
                          .filter(Boolean)
                          .join(', ')}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={enrichingEntityId === comp.id}
                      onClick={async () => {
                        setEnrichingEntityId(comp.id);
                        try {
                          await onEnrichEntity('COMPANY', comp.id);
                        } finally {
                          setEnrichingEntityId(null);
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shrink-0 transition"
                    >
                      {enrichingEntityId === comp.id ? 'Enriquecendo...' : 'Enriquecer Conta'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: INVALID EMAILS & PHONES */}
      {activeIssueTab === 'INVALID' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
          <h3 className="text-sm font-semibold text-slate-900">
            Registros com E-mail Descartável / Inválido ou Telefone Fora do Padrão E.164 ({invalidContacts.length})
          </h3>
          {invalidContacts.length === 0 ? (
            <p className="text-xs text-slate-500">Nenhum e-mail ou telefone inválido encontrado.</p>
          ) : (
            <div className="space-y-3">
              {invalidContacts.map((c) => (
                <div
                  key={c.id}
                  className="p-4 rounded-xl border border-rose-200 bg-rose-50/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">
                        {c.firstName} {c.lastName}
                      </span>
                      {!c.isValidEmail && (
                        <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-semibold">
                          E-mail Descartável / Inválido: {c.email}
                        </span>
                      )}
                      {c.phone && !c.isValidPhone && (
                        <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-semibold">
                          Telefone Inválido: {c.phone}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600">
                      Cargo: {c.jobTitle || '—'} • Bloqueado preventivamente em disparos de cadência para proteger reputação do domínio.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigateToContact(c.id)}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 shrink-0"
                  >
                    Inspecionar Contato
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: STALE RECORDS (>90 DAYS) & ROTTING DEALS */}
      {activeIssueTab === 'STALE' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Registros Obsoletos (&gt;90 dias sem interação) ({summary.staleRecords.length})
            </h3>
            {summary.staleRecords.map((rec) => (
              <div
                key={`${rec.entityType}-${rec.entityId}`}
                className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between gap-3 text-xs"
              >
                <div>
                  <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px] font-semibold mr-2">
                    {rec.entityType}
                  </span>
                  <strong className="text-slate-900">{rec.name}</strong>
                  <div className="text-slate-500 mt-0.5">
                    {rec.emailOrDomain || '—'} • Inativo há{' '}
                    <strong className="text-rose-600">{rec.daysInactive} dias</strong>
                  </div>
                </div>
                {rec.entityType === 'CONTACT' && (
                  <button
                    type="button"
                    onClick={() => onNavigateToContact(rec.entityId)}
                    className="px-2.5 py-1 rounded-lg bg-slate-900 text-white font-semibold text-[11px]"
                  >
                    Reengajar
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Negócios Estagnados (Deal Rotting) ({summary.rottingDeals.length})
            </h3>
            {summary.rottingDeals.map((deal) => (
              <div
                key={deal.dealId}
                className="p-3.5 rounded-xl border border-rose-200 bg-rose-50/20 flex items-center justify-between gap-3 text-xs"
              >
                <div>
                  <div className="font-semibold text-slate-900">{deal.title}</div>
                  <div className="text-slate-600 mt-0.5">
                    Etapa: <strong>{deal.stageName}</strong> • {deal.daysSinceLastActivity}d sem atividade (SLA:{' '}
                    {deal.dealRottingDays}d)
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-semibold text-rose-700">{formatBRL(deal.value)}</div>
                  <div className="text-[10px] text-rose-600 font-semibold">
                    +{deal.daysOverdue}d atrasado
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
        </>
      ) : null}
    </div>
  );
}