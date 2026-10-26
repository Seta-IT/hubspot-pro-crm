'use client';

import React, { useState } from 'react';
import {
  Plus,
  Building2,
  User,
  Clock,
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  ChevronLeft,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Sparkles,
  Calendar,
  DollarSign,
  Filter,
  X,
  MessageSquarePlus,
  FileText,
  Phone,
  Mail,
  Briefcase,
  Layers,
  ExternalLink,
  Copy,
  Printer,
  Edit3,
  Trash2,
} from 'lucide-react';
import { Company, Contact, Deal, DealBusinessType, DealPriority, ErpCommercialProposal, PipelineStage, TimelineEvent } from '../../db/types';
import { formatBRL, formatDateTimeBR } from './ui-helpers';
import { buildPublicProposalUrl } from '../lib/proposal-share';
import { recordUpsertedProposal } from '../lib/durable-storage';

export interface EnrichedDeal extends Deal {
  stageName: string;
  daysInactive: number;
  isRotting: boolean;
  weightedValue: number;
  contact: Contact | null;
  company: Company | null;
}

export interface EnrichedPipelineStage extends PipelineStage {
  dealsCount: number;
  totalValue: number;
  weightedValue: number;
  deals: Deal[];
}

export interface EnrichedPipeline {
  id: string;
  name: string;
  isDefault: boolean;
  currency: string;
  stages: EnrichedPipelineStage[];
}

interface DealsKanbanTabProps {
  pipelines: EnrichedPipeline[];
  deals: EnrichedDeal[];
  forecast: {
    totalOpenValue: number;
    weightedOpenValue: number;
    closedWonValue: number;
    rottingDealsCount: number;
  };
  contacts: Contact[];
  companies: Company[];
  onMoveDealStage: (dealId: string, newStageId: string) => Promise<void>;
  onCreateDeal: (payload: {
    title: string;
    value: number;
    stageId: string;
    contactId?: string | null;
    companyId?: string | null;
    expectedCloseDate?: string | null;
  }) => Promise<void>;
  onAddDealNote: (dealId: string, title: string, body: string) => Promise<void>;
  selectedPipelineId?: string;
  onSelectPipeline?: (pipelineId: string) => void;
  onUpdateDeal?: (dealId: string, patch: Record<string, unknown>) => Promise<void>;
  onDeleteDeal?: (dealId: string) => Promise<void>;
  onNavigateToErp?: () => void;
  onOpenNewProposalFromDeal?: (deal: EnrichedDeal) => void;
  onShowToast?: (msg: string) => void;
  onRefreshAll?: () => Promise<void>;
}

function getInitials(name: string | undefined | null): string {
  const str = String(name || 'MM').trim();
  const parts = str.split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
  return str.slice(0, 2).toUpperCase();
}

function getPriorityMeta(priority: DealPriority | undefined, value: number) {
  const p = priority || (value >= 150000 ? 'ALTA' : value >= 60000 ? 'MEDIA' : 'BAIXA');
  if (p === 'ALTA') return { short: 'Prioridade Alta', cls: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-500' };
  if (p === 'MEDIA') return { short: 'Prioridade Média', cls: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500' };
  return { short: 'Prioridade Baixa', cls: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' };
}

function getDealTypeLabel(dealType: DealBusinessType | undefined) {
  if (dealType === 'LOCACAO_RECORRENTE') return { label: 'Locação Recorrente (0% ISS)', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' };
  if (dealType === 'UPSELL_RENOVACAO') return { label: 'Upsell / Renovação', cls: 'bg-indigo-50 text-indigo-800 border-indigo-200' };
  return { label: 'Novo Negócio B2B', cls: 'bg-sky-50 text-sky-800 border-sky-200' };
}

export default function DealsKanbanTab({
  pipelines,
  deals,
  forecast,
  contacts,
  companies,
  onMoveDealStage,
  onCreateDeal,
  onAddDealNote,
  selectedPipelineId,
  onSelectPipeline,
  onUpdateDeal,
  onDeleteDeal,
  onNavigateToErp,
  onOpenNewProposalFromDeal,
  onShowToast,
  onRefreshAll,
}: DealsKanbanTabProps) {
  const [localPipelineId, setLocalPipelineId] = useState<string>(
    selectedPipelineId || pipelines[0]?.id || 'pipe-enterprise-b2b'
  );
  const currentPipelineId = selectedPipelineId || localPipelineId;
  const activePipeline =
    pipelines.find((p) => p.id === currentPipelineId) ||
    pipelines.find((p) => p.isDefault) ||
    pipelines[0];
  const stages = (activePipeline?.stages || []).slice().sort((a, b) => a.order - b.order);

  const handleSelectPipe = (pipeId: string) => {
    setLocalPipelineId(pipeId);
    if (onSelectPipeline) onSelectPipeline(pipeId);
  };

  const [filterRottingOnly, setFilterRottingOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [draggingDealId, setDraggingDealId] = useState<string | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);
  const [updatingDealId, setUpdatingDealId] = useState<string | null>(null);
  const [generatingProposalDealId, setGeneratingProposalDealId] = useState<string | null>(null);
  const [createdProposalBanner, setCreatedProposalBanner] = useState<{
    dealTitle: string;
    proposal: ErpCommercialProposal;
    publicUrl: string;
    printUrl: string;
  } | null>(null);

  const handleQuickGenerateProposalForDeal = async (deal: EnrichedDeal) => {
    if (onOpenNewProposalFromDeal) {
      onOpenNewProposalFromDeal(deal);
      return;
    }
    setGeneratingProposalDealId(deal.id);
    try {
      const months = deal.contractMonths || 24;
      const monthlyVal = deal.mrr || Math.max(850, Math.round(deal.value / months));
      const companyName =
        deal.company?.name || deal.title.split("—")[0]?.trim() || "Empresa Cliente B2B";
      const companyCnpj = deal.company?.cnpj || "18.236.120/0001-58";
      const contactName = deal.contact
        ? `${deal.contact.firstName} ${deal.contact.lastName}`
        : "Decisor de TI / Compras";

      const res = await fetch("/api/erp/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Proposta Comercial — ${deal.title}`,
          companyId: deal.companyId || null,
          companyName,
          companyCnpj,
          contactId: deal.contactId || null,
          contactName,
          dealId: deal.id,
          sellerName: deal.ownerName || "Marcelo Lopes Mira",
          contractMonths: months,
          monthlyRecurringTotal: monthlyVal,
          paymentCondition: "Boleto / PIX Corporativo — Vencimento todo dia 10",
          items: [
            {
              id: `pi-${Date.now()}`,
              sku: "GC-EQ-00101",
              description: `Locação de Infraestrutura Telecom & TI (${deal.title})`,
              fiscalNature: "LOCACAO_BENS_MOVEIS",
              ncmOrServiceCode: "NCM 8517.62.14 (0% ISS — SV 31 STF)",
              quantity: 1,
              unitPrice: monthlyVal,
              discountPercent: 0,
              isRecurring: true,
              totalMonthly: monthlyVal,
            },
          ],
        }),
      });

      if (res.ok) {
        const json = await res.json();
        const created: ErpCommercialProposal = json.data;
        if (created) {
          recordUpsertedProposal(created);
          const publicUrl = buildPublicProposalUrl(created);
          const printUrl = buildPublicProposalUrl(created, { autoPrint: true });
          setCreatedProposalBanner({
            dealTitle: deal.title,
            proposal: created,
            publicUrl,
            printUrl,
          });
          onShowToast?.(
            `Proposta ${created.code} gerada com link público de PDF pronto para o cliente!`
          );
          if (onRefreshAll) await onRefreshAll();
        }
      }
    } finally {
      setGeneratingProposalDealId(null);
    }
  };

  // Create Deal Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newValue, setNewValue] = useState('150000');
  const [newStageId, setNewStageId] = useState(stages[0]?.id || 'stage-discovery');
  const [newContactId, setNewContactId] = useState('');
  const [newCompanyId, setNewCompanyId] = useState('');
  const [newCloseDate, setNewCloseDate] = useState('');
  const [creating, setCreating] = useState(false);

  // Selected Deal Drawer State
  const [selectedDeal, setSelectedDeal] = useState<EnrichedDeal | null>(null);
  const [dealTimeline, setDealTimeline] = useState<TimelineEvent[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const openDealDetail = async (deal: EnrichedDeal) => {
    setSelectedDeal(deal);
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/deals/${deal.id}`);
      if (res.ok) {
        const json = await res.json();
        setDealTimeline(json.data?.timeline || []);
      }
    } catch {
      setDealTimeline([]);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleStageChange = async (dealId: string, targetStageId: string) => {
    setUpdatingDealId(dealId);
    try {
      await onMoveDealStage(dealId, targetStageId);
      if (selectedDeal && selectedDeal.id === dealId) {
        const res = await fetch(`/api/deals/${dealId}`);
        if (res.ok) {
          const json = await res.json();
          setDealTimeline(json.data?.timeline || []);
        }
      }
    } finally {
      setUpdatingDealId(null);
    }
  };

  const handleDropOnStage = async (e: React.DragEvent, targetStageId: string) => {
    e.preventDefault();
    setDragOverStageId(null);
    const dealId = e.dataTransfer.getData('text/plain') || draggingDealId;
    setDraggingDealId(null);
    if (!dealId) return;
    const currentDeal = deals.find((d) => d.id === dealId);
    if (!currentDeal || currentDeal.stageId === targetStageId) return;
    await handleStageChange(dealId, targetStageId);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      await onCreateDeal({
        title: newTitle.trim(),
        value: Number(newValue) || 0,
        stageId: newStageId || stages[0]?.id || 'stage-discovery',
        ...(activePipeline ? { pipelineId: activePipeline.id } : {}),
        contactId: newContactId || null,
        companyId: newCompanyId || null,
        expectedCloseDate: newCloseDate ? new Date(newCloseDate).toISOString() : null,
      });
      setNewTitle('');
      setNewValue('150000');
      setNewContactId('');
      setNewCompanyId('');
      setNewCloseDate('');
      setShowCreateModal(false);
    } finally {
      setCreating(false);
    }
  };

  const handleSaveDealNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDeal || !noteTitle.trim()) return;
    setSavingNote(true);
    try {
      await onAddDealNote(selectedDeal.id, noteTitle.trim(), noteBody.trim());
      setNoteTitle('');
      setNoteBody('');
      const res = await fetch(`/api/deals/${selectedDeal.id}`);
      if (res.ok) {
        const json = await res.json();
        setDealTimeline(json.data?.timeline || []);
      }
    } finally {
      setSavingNote(false);
    }
  };

  const pipelineDeals = deals.filter(
    (d) => !activePipeline || d.pipelineId === activePipeline.id
  );
  const filteredDeals = pipelineDeals.filter((d) => {
    if (filterRottingOnly && !d.isRotting) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = d.title.toLowerCase().includes(q);
      const matchComp = d.company?.name?.toLowerCase().includes(q);
      const matchCont =
        d.contact &&
        `${d.contact.firstName} ${d.contact.lastName}`.toLowerCase().includes(q);
      return Boolean(matchTitle || matchComp || matchCont);
    }
    return true;
  });

  return (
        <div className="space-y-5">
      {createdProposalBanner && (
        <div className="bg-emerald-950 text-white rounded-[6px] p-4 border border-emerald-600 shadow-lg flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-emerald-500 text-slate-950 text-[10px] font-black uppercase">
                PROPOSTA CRIADA COM SUCESSO
              </span>
              <span className="font-mono text-xs font-extrabold text-emerald-300">
                {createdProposalBanner.proposal.code}
              </span>
              <span className="text-xs text-slate-300">
                • {createdProposalBanner.proposal.companyName}
              </span>
            </div>
            <div className="text-xs text-slate-200">
              Link Público p/ Cliente Imprimir PDF:{" "}
              <a
                href={createdProposalBanner.publicUrl}
                target="_blank"
                rel="noreferrer"
                className="underline font-mono text-emerald-300 hover:text-white break-all"
              >
                {createdProposalBanner.publicUrl.slice(0, 95)}...
              </a>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(createdProposalBanner.publicUrl);
                onShowToast?.("Link público da proposta copiado para enviar ao cliente!");
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[4px] bg-white text-slate-900 hover:bg-slate-100 text-xs font-extrabold cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5 text-emerald-700" />
              Copiar Link p/ Cliente
            </button>
            <a
              href={createdProposalBanner.publicUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[4px] bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Abrir Proposta
            </a>
            <a
              href={createdProposalBanner.printUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[4px] bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold"
            >
              <Printer className="w-3.5 h-3.5" />
              Imprimir PDF
            </a>
            <button
              type="button"
              onClick={() => setCreatedProposalBanner(null)}
              className="p-1.5 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
      {/* SELETOR DE PIPELINE EM DESTAQUE (3 FUNIS SETA TELECOM) */}
      <div className="bg-[#213343] rounded-[6px] p-4 text-white shadow-2xs border border-[#33475b]">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#ff987f] block">
              STI-hub • Seletor de Pipeline Seta Telecom (Portal 4369067)
            </span>
            <h3 className="text-sm sm:text-base font-extrabold text-white">
              Selecione o Funil de Vendas ou Locação Recorrente:
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {pipelines.map((p) => {
              const isSelected = activePipeline?.id === p.id;
              const pipeCount = deals.filter((d) => d.pipelineId === p.id).length;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectPipe(p.id)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition flex items-center gap-2 cursor-pointer border ${
                    isSelected
                      ? 'bg-[#ff7a59] text-white border-[#ff7a59] shadow-md'
                      : 'bg-slate-800/90 text-slate-200 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  <span>{p.name}</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-black/25 text-white">
                    {pipeCount}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {/* PIPELINE SUMMARY & TOOLBAR */}
      <div className="bg-white rounded-[6px] border border-[#cbd6e2] p-5 shadow-2xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-bold text-slate-900">
                {activePipeline?.name || 'Funil Comercial Enterprise B2B'}
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-orange-50 text-[#e05835] border border-orange-200">
                {deals.length} negócios no pipeline
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Arraste e solte os cards entre colunas ou utilize os seletores rápidos para atualizar estágio, probabilidade e forecast em tempo real.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Filter className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filtrar por negócio, empresa..."
                className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#ff7a59]"
              />
            </div>

            <button
              type="button"
              onClick={() => setFilterRottingOnly((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                filterRottingOnly
                  ? 'bg-rose-600 text-white border-rose-600'
                  : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Estagnados ({forecast.rottingDealsCount})
            </button>

            <button
              type="button"
              onClick={() => {
                setNewStageId(stages[0]?.id || 'stage-discovery');
                setShowCreateModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-semibold shadow-sm transition"
            >
              <Plus className="w-4 h-4" />
              Novo Negócio
            </button>
          </div>
        </div>

        {/* Forecast Strip (Flashcards Clicáveis) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={() => {
              setFilterRottingOnly(false);
              setSearchQuery('');
            }}
            className="text-left bg-slate-50 hover:bg-blue-50/60 hover:border-[#0091ae] rounded-xl p-3 border border-slate-200/60 transition cursor-pointer"
          >
            <span className="text-[11px] font-semibold uppercase text-slate-400 block">
              Pipeline em Aberto (Ver Todos →)
            </span>
            <div className="text-base font-bold text-slate-900 mt-0.5">
              {formatBRL(forecast.totalOpenValue)}
            </div>
          </button>
          <button
            type="button"
            onClick={() => {
              setFilterRottingOnly(false);
              setSearchQuery('');
            }}
            className="text-left bg-orange-50/60 hover:bg-orange-100/60 hover:border-[#ff7a59] rounded-xl p-3 border border-orange-200/70 transition cursor-pointer"
          >
            <span className="text-[11px] font-semibold uppercase text-[#e05835] block">
              Receita Ponderada (Forecast →)
            </span>
            <div className="text-base font-bold text-[#e05835] mt-0.5">
              {formatBRL(forecast.weightedOpenValue)}
            </div>
          </button>
          <button
            type="button"
            onClick={() => {
              setFilterRottingOnly(false);
              const wonDeal = pipelineDeals.find((d) => d.status === 'WON') || pipelineDeals[0];
              if (wonDeal) openDealDetail(wonDeal);
            }}
            className="text-left bg-emerald-50/60 hover:bg-emerald-100/60 hover:border-emerald-500 rounded-xl p-3 border border-emerald-200/70 transition cursor-pointer"
          >
            <span className="text-[11px] font-semibold uppercase text-emerald-700 block">
              Fechado Ganho (Inspecionar →)
            </span>
            <div className="text-base font-bold text-emerald-700 mt-0.5">
              {formatBRL(forecast.closedWonValue)}
            </div>
          </button>
          <button
            type="button"
            onClick={() => setFilterRottingOnly((v) => !v)}
            className="text-left bg-rose-50/60 hover:bg-rose-100/60 hover:border-rose-500 rounded-xl p-3 border border-rose-200/70 transition cursor-pointer"
          >
            <span className="text-[11px] font-semibold uppercase text-rose-700 block">
              Deal Rotting ({filterRottingOnly ? 'Mostrando Estagnados' : 'Filtrar Estagnados →'})
            </span>
            <div className="text-base font-bold text-rose-700 mt-0.5">
              {forecast.rottingDealsCount} negócio(s)
            </div>
          </button>
        </div>
      </div>

      {/* KANBAN BOARD HORIZONTAL SCROLL */}
      <div className="overflow-x-auto pb-4">
        <div className="inline-flex gap-4 min-w-full">
          {stages.map((stage, stageIdx) => {
            const stageDeals = filteredDeals.filter((d) => d.stageId === stage.id);
            const colTotal = stageDeals.reduce((sum, d) => sum + d.value, 0);
            const colWeighted = Math.round(
              stageDeals.reduce((sum, d) => sum + d.value * (d.probability / 100), 0)
            );
            const isDragTarget = dragOverStageId === stage.id;

            const headerAccent = stage.isWon
              ? 'border-t-4 border-t-emerald-500'
              : stage.isClosed
                ? 'border-t-4 border-t-slate-400'
                : stage.order >= 4
                  ? 'border-t-4 border-t-[#ff7a59]'
                  : 'border-t-4 border-t-indigo-500';

            return (
              <div
                key={stage.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOverStageId !== stage.id) setDragOverStageId(stage.id);
                }}
                onDragLeave={() => {
                  if (dragOverStageId === stage.id) setDragOverStageId(null);
                }}
                onDrop={(e) => handleDropOnStage(e, stage.id)}
                className={`w-80 shrink-0 rounded-[6px] bg-[#f5f8fa] border transition flex flex-col max-h-[760px] ${headerAccent} ${
                  isDragTarget
                    ? 'border-[#ff7a59] ring-2 ring-[#ff7a59]/30 bg-orange-50/40'
                    : 'border-slate-200/90'
                }`}
              >
                {/* Column Header */}
                <div className="p-3.5 bg-white rounded-t-[5px] border-b border-[#cbd6e2]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-5 h-5 rounded-full bg-slate-800 text-white text-[11px] font-bold inline-flex items-center justify-center shrink-0">
                        {stage.order}
                      </span>
                      <h3 className="text-xs font-bold text-slate-900 truncate" title={stage.name}>
                        {stage.name}
                      </h3>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 shrink-0">
                      {stageDeals.length}
                    </span>
                  </div>

                  <div className="mt-2 flex items-center justify-between text-xs">
                    <div>
                      <span className="text-slate-400">Total: </span>
                      <strong className="text-slate-800">{formatBRL(colTotal)}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400">Pond. ({stage.defaultProbability}%): </span>
                      <strong className="text-[#e05835]">{formatBRL(colWeighted)}</strong>
                    </div>
                  </div>
                </div>

                {/* Cards Container */}
                <div className="p-3 space-y-3 overflow-y-auto flex-1">
                  {stageDeals.length === 0 ? (
                    <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center text-xs text-slate-400">
                      Arraste um negócio para esta etapa ou clique em + Novo
                    </div>
                  ) : (
                    stageDeals.map((deal) => {
                      const prevStage = stageIdx > 0 ? stages[stageIdx - 1] : null;
                      const nextStage = stageIdx < stages.length - 1 ? stages[stageIdx + 1] : null;
                      const isUpdating = updatingDealId === deal.id;
                      const priorityMeta = getPriorityMeta(deal.priority, deal.value);
                      const typeMeta = getDealTypeLabel(deal.dealType);
                      const contractMonths = deal.contractMonths || 24;
                      const mrr = deal.mrr || Math.round(deal.value / contractMonths);
                      const ownerName = deal.ownerName || "Marcelo Lopes Mira";
                      const closeDateStr = deal.expectedCloseDate
                        ? new Date(deal.expectedCloseDate).toLocaleDateString("pt-BR")
                        : "30/11/2026";

                      return (
                        <div
                          key={deal.id}
                          draggable
                          onDragStart={(e) => {
                            setDraggingDealId(deal.id);
                            e.dataTransfer.setData("text/plain", deal.id);
                          }}
                          onDragEnd={() => {
                            setDraggingDealId(null);
                            setDragOverStageId(null);
                          }}
                          className={`group bg-white rounded-[6px] p-3.5 border shadow-xs hover:shadow-md transition cursor-grab active:cursor-grabbing ${
                            deal.isRotting
                              ? "border-rose-300 ring-1 ring-rose-200/70"
                              : "border-[#cbd6e2] hover:border-[#0091ae]"
                          } ${isUpdating ? "opacity-60 pointer-events-none" : ""}`}
                        >
                          {/* 1. Deal Title Link + Quick Edit Button (HubSpot Top Row) */}
                          <div className="flex items-start justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => openDealDetail(deal)}
                              className="text-left flex-1 cursor-pointer"
                            >
                              <h4 className="text-[13px] font-extrabold text-[#0091ae] group-hover:underline leading-snug">
                                {deal.title}
                              </h4>
                            </button>
                            <button
                              type="button"
                              onClick={() => openDealDetail(deal)}
                              title="Abrir Ficha 360° do Deal"
                              className="p-1 rounded text-slate-400 hover:text-[#0091ae] hover:bg-[#eaf0f6] shrink-0 cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* 2. Priority + Deal Type + Status Pills */}
                          <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] text-[10px] font-bold border ${priorityMeta.cls}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${priorityMeta.dot}`} />
                              {priorityMeta.short}
                            </span>

                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-[3px] text-[10px] font-bold border ${typeMeta.cls}`}
                            >
                              {typeMeta.label}
                            </span>

                            {deal.status === "WON" ? (
                              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-[3px] text-[10px] font-extrabold bg-emerald-100 text-emerald-800">
                                <CheckCircle2 className="w-3 h-3" /> Ganho
                              </span>
                            ) : deal.status === "LOST" ? (
                              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-[3px] text-[10px] font-extrabold bg-slate-200 text-slate-700">
                                <XCircle className="w-3 h-3" /> Perdido
                              </span>
                            ) : deal.isRotting ? (
                              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-[3px] text-[10px] font-extrabold bg-rose-100 text-rose-800">
                                <AlertTriangle className="w-3 h-3" /> Inativo {deal.daysInactive}d
                              </span>
                            ) : null}
                          </div>

                          {/* 3. Financial Values Box (Amount / TCV + MRR + Prazo) */}
                          <div className="mt-2.5 p-2.5 rounded-[4px] bg-[#f5f8fa] border border-[#cbd6e2]/80 space-y-1">
                            <div className="flex items-baseline justify-between">
                              <span className="text-[10px] font-bold uppercase text-[#516f90]">
                                Valor Total ({contractMonths}m):
                              </span>
                              <span className="text-sm font-black text-[#33475b]">
                                {formatBRL(deal.value)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-[#516f90]">Mensalidade (MRR):</span>
                              <strong className="text-emerald-700 font-extrabold">
                                {formatBRL(mrr)}/mês
                              </strong>
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-[#516f90] pt-1 border-t border-[#cbd6e2]/60">
                              <span>
                                Probabilidade: <strong>{deal.probability}%</strong>
                              </span>
                              <span>
                                Ponderado: <strong>{formatBRL(deal.weightedValue)}</strong>
                              </span>
                            </div>
                          </div>

                          {/* 4. Associated Company & Contact Chips (HubSpot Associations) */}
                          <div className="mt-2.5 space-y-1.5 text-[11px]">
                            <div className="flex items-center justify-between gap-1.5 p-1.5 rounded-[4px] bg-slate-50 border border-slate-200/80">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <div className="w-5 h-5 rounded bg-[#213343] text-white text-[9px] font-black flex items-center justify-center shrink-0">
                                  <Building2 className="w-3 h-3" />
                                </div>
                                <div className="truncate">
                                  <div className="font-bold text-[#33475b] truncate">
                                    {deal.company?.name || "Empresa Corporativa B2B"}
                                  </div>
                                  {deal.company?.cnpj && (
                                    <div className="text-[9px] text-[#516f90] font-mono">
                                      CNPJ: {deal.company.cnpj}
                                    </div>
                                  )}
                                </div>
                              </div>
                              {deal.company?.city && (
                                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[#516f90] shrink-0">
                                  {deal.company.city}/{deal.company.state || "SP"}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center justify-between gap-1.5 p-1.5 rounded-[4px] bg-slate-50 border border-slate-200/80">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <div className="w-5 h-5 rounded-full bg-[#0091ae] text-white text-[9px] font-extrabold flex items-center justify-center shrink-0">
                                  {deal.contact
                                    ? getInitials(`${deal.contact.firstName} ${deal.contact.lastName}`)
                                    : "DC"}
                                </div>
                                <div className="truncate">
                                  <div className="font-bold text-[#33475b] truncate">
                                    {deal.contact
                                      ? `${deal.contact.firstName} ${deal.contact.lastName}`
                                      : "Decisor Técnico / Compras"}
                                  </div>
                                  <div className="text-[9px] text-[#516f90] truncate">
                                    {deal.contact?.jobTitle || "Diretoria de TI & Telecom"}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                {deal.contact?.phone && (
                                  <a
                                    href={`tel:${deal.contact.phone}`}
                                    title={`Ligar: ${deal.contact.phone}`}
                                    className="p-1 rounded bg-white border border-slate-200 text-emerald-700 hover:bg-emerald-50"
                                  >
                                    <Phone className="w-2.5 h-2.5" />
                                  </a>
                                )}
                                {deal.contact?.email && (
                                  <a
                                    href={`mailto:${deal.contact.email}`}
                                    title={`E-mail: ${deal.contact.email}`}
                                    className="p-1 rounded bg-white border border-slate-200 text-[#0091ae] hover:bg-sky-50"
                                  >
                                    <Mail className="w-2.5 h-2.5" />
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* 5. HubSpot Properties: Close Date, Owner & Activity */}
                          <div className="mt-2.5 pt-2 border-t border-[#eaf0f6] space-y-1 text-[11px] text-[#516f90]">
                            <div className="flex items-center justify-between">
                              <span className="inline-flex items-center gap-1">
                                <Calendar className="w-3 h-3 text-slate-400" />
                                Fechamento: <strong className="text-[#33475b]">{closeDateStr}</strong>
                              </span>
                              <span className="inline-flex items-center gap-1" title={`Proprietário: ${ownerName}`}>
                                <span className="w-4 h-4 rounded-full bg-[#ff7a59] text-white text-[8px] font-black inline-flex items-center justify-center">
                                  {getInitials(ownerName)}
                                </span>
                                <span className="text-[10px] font-semibold text-[#33475b] truncate max-w-[95px]">
                                  {ownerName.split(" ").slice(0, 2).join(" ")}
                                </span>
                              </span>
                            </div>

                            <div className="flex items-center justify-between text-[10px]">
                              <span className="inline-flex items-center gap-1">
                                <Clock className="w-3 h-3 text-slate-400" />
                                Última ativ.:{" "}
                                <strong>
                                  {deal.daysInactive === 0 ? "Hoje" : `há ${deal.daysInactive}d`}
                                </strong>
                              </span>
                              <span className="text-emerald-700 font-bold">
                                ● ERP GestãoClick Sync
                              </span>
                            </div>
                          </div>

                          {/* 6. Next Best Action (Copiloto IA / Próximo Passo) */}
                          <div className="mt-2 p-2 rounded-[4px] bg-[#eaf0f6]/70 border border-[#cbd6e2] text-[10px] text-[#33475b]">
                            <div className="flex items-center gap-1 font-extrabold text-[#0091ae]">
                              <Sparkles className="w-3 h-3 text-[#ff7a59] shrink-0" />
                              <span className="truncate">
                                {deal.nextBestAction?.title ||
                                  "Próximo passo: Enviar Proposta PDF ao Decisor"}
                              </span>
                            </div>
                          </div>

                          {/* 7. Quick HubSpot Card Footer Actions (Nota + Proposta PDF + Stage) */}
                          <div className="mt-2.5 pt-2 border-t border-[#eaf0f6] space-y-2">
                            <div className="grid grid-cols-2 gap-1.5">
                              <button
                                type="button"
                                onClick={() => openDealDetail(deal)}
                                className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-[4px] border border-[#cbd6e2] bg-white hover:bg-[#f5f8fa] text-[10px] font-bold text-[#33475b] transition cursor-pointer"
                              >
                                <MessageSquarePlus className="w-3 h-3 text-[#0091ae]" />
                                + Nota / Timeline
                              </button>

                              <button
                                type="button"
                                disabled={generatingProposalDealId === deal.id}
                                onClick={() => handleQuickGenerateProposalForDeal(deal)}
                                className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-[4px] bg-[#1e3a6e] hover:bg-[#162b54] text-white text-[10px] font-extrabold transition cursor-pointer disabled:opacity-50"
                              >
                                <FileText className="w-3 h-3 text-emerald-300" />
                                {generatingProposalDealId === deal.id
                                  ? "Gerando..."
                                  : "Gerar Proposta PDF"}
                              </button>
                            </div>

                            <div className="flex items-center justify-between gap-1">
                              <button
                                type="button"
                                disabled={!prevStage}
                                onClick={() => prevStage && handleStageChange(deal.id, prevStage.id)}
                                title={prevStage ? `Voltar para ${prevStage.name}` : "Primeira etapa"}
                                className="p-1 rounded border border-[#cbd6e2] hover:bg-slate-100 disabled:opacity-30 text-[#33475b] cursor-pointer"
                              >
                                <ChevronLeft className="w-3.5 h-3.5" />
                              </button>

                              <select
                                aria-label={`Mudar estágio de ${deal.title}`}
                                value={deal.stageId}
                                onChange={(e) => handleStageChange(deal.id, e.target.value)}
                                className="flex-1 text-[10px] font-bold bg-[#f5f8fa] border border-[#cbd6e2] rounded px-1.5 py-1 text-[#33475b] focus:outline-none focus:border-[#0091ae]"
                              >
                                {stages.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.order}. {s.name} ({s.defaultProbability}%)
                                  </option>
                                ))}
                              </select>

                              <button
                                type="button"
                                disabled={!nextStage}
                                onClick={() => nextStage && handleStageChange(deal.id, nextStage.id)}
                                title={nextStage ? `Avançar para ${nextStage.name}` : "Última etapa"}
                                className="p-1 rounded border border-[#cbd6e2] hover:bg-[#ff7a59] hover:text-white hover:border-[#ff7a59] disabled:opacity-30 text-[#33475b] transition cursor-pointer"
                              >
                                <ChevronRight className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Column Footer Add Deal */}
                <div className="p-2.5 border-t border-slate-200/70 bg-slate-50/70 rounded-b-2xl">
                  <button
                    type="button"
                    onClick={() => {
                      setNewStageId(stage.id);
                      setShowCreateModal(true);
                    }}
                    className="w-full py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-[#ff7a59] hover:bg-white border border-transparent hover:border-slate-200 transition inline-flex items-center justify-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Adicionar em {stage.name.split(' ')[0]}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* CREATE NEW DEAL MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="px-6 py-4 bg-[#1e293b] text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-[#ff7a59]" />
                <h3 className="text-base font-bold">Criar Novo Negócio no Funil</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                  Título da Oportunidade *
                </label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Ex: Banco Inter - Expansão Plataforma CRM Enterprise"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:border-[#ff7a59]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                    Valor do Contrato (R$) *
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    step={1000}
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:border-[#ff7a59]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                    Etapa Inicial do Funil
                  </label>
                  <select
                    value={newStageId}
                    onChange={(e) => setNewStageId(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:border-[#ff7a59]"
                  >
                    {stages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.order}. {s.name} ({s.defaultProbability}%)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                    Empresa Vinculada
                  </label>
                  <select
                    value={newCompanyId}
                    onChange={(e) => setNewCompanyId(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:border-[#ff7a59]"
                  >
                    <option value="">Selecione uma empresa...</option>
                    {companies.map((comp) => (
                      <option key={comp.id} value={comp.id}>
                        {comp.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                    Contato Decisor
                  </label>
                  <select
                    value={newContactId}
                    onChange={(e) => setNewContactId(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:border-[#ff7a59]"
                  >
                    <option value="">Selecione um contato...</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.firstName} {c.lastName} ({c.email})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                  Previsão de Fechamento
                </label>
                <input
                  type="date"
                  value={newCloseDate}
                  onChange={(e) => setNewCloseDate(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:border-[#ff7a59]"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-5 py-2 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-semibold shadow-sm transition disabled:opacity-50"
                >
                  {creating ? 'Salvando...' : 'Criar Negócio'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DEAL DETAIL DRAWER (3-COLUMN HUBSPOT RECORD VIEW) */}
      {selectedDeal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex justify-end">
          <div className="bg-[#f5f8fa] w-full max-w-5xl h-full shadow-2xl border-l border-[#cbd6e2] flex flex-col overflow-hidden">
            <div className="px-6 py-4 bg-[#213343] text-white flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-[#ff7a59] text-white text-[10px] font-black uppercase">
                    HUBSPOT DEAL RECORD
                  </span>
                  <span className="text-xs text-[#99acc2]">
                    Pipeline: <strong className="text-white">{activePipeline?.name}</strong>
                  </span>
                </div>
                <h3 className="text-base sm:text-lg font-extrabold text-white mt-1 truncate">
                  {selectedDeal.title}
                </h3>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={generatingProposalDealId === selectedDeal.id}
                  onClick={() => handleQuickGenerateProposalForDeal(selectedDeal)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[4px] bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold shadow-sm cursor-pointer"
                >
                  <FileText className="w-4 h-4" />
                  {generatingProposalDealId === selectedDeal.id
                    ? "Gerando Proposta..."
                    : "+ Gerar Proposta PDF p/ Cliente"}
                </button>

                {onNavigateToErp && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDeal(null);
                      onNavigateToErp();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[4px] bg-[#33475b] hover:bg-[#425b76] text-white text-xs font-bold cursor-pointer"
                  >
                    Abrir ERP GestãoClick
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setSelectedDeal(null)}
                  className="p-1.5 rounded bg-[#33475b] text-slate-300 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="bg-white px-6 py-3 border-b border-[#cbd6e2] shrink-0">
              <div className="flex items-center justify-between text-[11px] font-bold text-[#516f90] mb-1.5">
                <span>Progresso das Etapas do Funil (Clique para mover)</span>
                <span>
                  Probabilidade de Fechamento:{" "}
                  <strong className="text-[#0091ae]">{selectedDeal.probability}%</strong>
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-1.5">
                {stages.map((st) => {
                  const currentOrder =
                    stages.find((s) => s.id === selectedDeal.stageId)?.order ?? 1;
                  const isPassed = st.order <= currentOrder;
                  const isCurrent = st.id === selectedDeal.stageId;
                  return (
                    <button
                      key={st.id}
                      type="button"
                      onClick={async () => {
                        await handleStageChange(selectedDeal.id, st.id);
                        setSelectedDeal({
                          ...selectedDeal,
                          stageId: st.id,
                          stageName: st.name,
                          probability: st.defaultProbability,
                        });
                      }}
                      className={`px-2.5 py-1.5 rounded-[4px] text-left text-[10px] font-extrabold transition cursor-pointer border ${
                        isCurrent
                          ? "bg-[#ff7a59] text-white border-[#ff7a59]"
                          : isPassed
                            ? "bg-[#e5f8f6] text-[#007a6c] border-[#00bda5]/40"
                            : "bg-[#f5f8fa] text-[#516f90] border-[#cbd6e2]"
                      }`}
                    >
                      <div className="truncate">
                        {st.order}. {st.name}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-5 overflow-y-auto flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* LEFT PANE: ABOUT THIS DEAL */}
              <div className="lg:col-span-4 space-y-4">
                <div className="bg-white rounded-[6px] border border-[#cbd6e2] p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-[#eaf0f6] pb-2">
                    <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#33475b] flex items-center gap-1.5">
                      <Briefcase className="w-3.5 h-3.5 text-[#0091ae]" />
                      Sobre este Negócio (Properties)
                    </h4>
                  </div>

                  <div className="space-y-2.5 text-xs">
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-[#516f90] mb-0.5">
                        Título do Negócio
                      </label>
                      <input
                        type="text"
                        value={selectedDeal.title}
                        onChange={(e) =>
                          setSelectedDeal({ ...selectedDeal, title: e.target.value })
                        }
                        className="w-full px-2.5 py-1.5 rounded-[4px] border border-[#cbd6e2] font-bold text-[#33475b]"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-[#516f90] mb-0.5">
                          Valor Total TCV (R$)
                        </label>
                        <input
                          type="number"
                          value={selectedDeal.value}
                          onChange={(e) =>
                            setSelectedDeal({
                              ...selectedDeal,
                              value: Number(e.target.value) || 0,
                            })
                          }
                          className="w-full px-2.5 py-1.5 rounded-[4px] border border-[#cbd6e2] font-extrabold text-[#33475b]"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold uppercase text-[#516f90] mb-0.5">
                          MRR Mensal (R$)
                        </label>
                        <input
                          type="number"
                          value={
                            selectedDeal.mrr ||
                            Math.round(selectedDeal.value / (selectedDeal.contractMonths || 24))
                          }
                          onChange={(e) =>
                            setSelectedDeal({
                              ...selectedDeal,
                              mrr: Number(e.target.value) || 0,
                            })
                          }
                          className="w-full px-2.5 py-1.5 rounded-[4px] border border-[#cbd6e2] font-extrabold text-emerald-700"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-[#516f90] mb-0.5">
                          Prazo Contratual
                        </label>
                        <select
                          value={String(selectedDeal.contractMonths || 24)}
                          onChange={(e) =>
                            setSelectedDeal({
                              ...selectedDeal,
                              contractMonths: Number(e.target.value) || 24,
                            })
                          }
                          className="w-full px-2.5 py-1.5 rounded-[4px] border border-[#cbd6e2] bg-white font-semibold"
                        >
                          <option value="12">12 meses</option>
                          <option value="24">24 meses</option>
                          <option value="36">36 meses</option>
                          <option value="48">48 meses</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold uppercase text-[#516f90] mb-0.5">
                          Prioridade
                        </label>
                        <select
                          value={selectedDeal.priority || "ALTA"}
                          onChange={(e) =>
                            setSelectedDeal({
                              ...selectedDeal,
                              priority: e.target.value as DealPriority,
                            })
                          }
                          className="w-full px-2.5 py-1.5 rounded-[4px] border border-[#cbd6e2] bg-white font-semibold"
                        >
                          <option value="ALTA">Alta</option>
                          <option value="MEDIA">Média</option>
                          <option value="BAIXA">Baixa</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase text-[#516f90] mb-0.5">
                        Proprietário (Deal Owner)
                      </label>
                      <select
                        value={selectedDeal.ownerName || "Marcelo Lopes Mira"}
                        onChange={(e) =>
                          setSelectedDeal({ ...selectedDeal, ownerName: e.target.value })
                        }
                        className="w-full px-2.5 py-1.5 rounded-[4px] border border-[#cbd6e2] bg-white font-semibold"
                      >
                        <option value="Marcelo Lopes Mira">Marcelo Lopes Mira</option>
                        <option value="Evelyn Ternero Seta Telecom">
                          Evelyn Ternero Seta Telecom
                        </option>
                        <option value="Michelle da Rocha">Michelle da Rocha</option>
                      </select>
                    </div>

                    <div className="pt-2 flex items-center justify-between gap-2 border-t border-[#eaf0f6]">
                      {onDeleteDeal && (
                        <button
                          type="button"
                          onClick={async () => {
                            await onDeleteDeal(selectedDeal.id);
                            setSelectedDeal(null);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[4px] bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Excluir
                        </button>
                      )}

                      {onUpdateDeal && (
                        <button
                          type="button"
                          onClick={async () => {
                            await onUpdateDeal(selectedDeal.id, {
                              title: selectedDeal.title,
                              value: selectedDeal.value,
                              mrr: selectedDeal.mrr,
                              contractMonths: selectedDeal.contractMonths,
                              priority: selectedDeal.priority,
                              ownerName: selectedDeal.ownerName,
                              stageId: selectedDeal.stageId,
                            });
                            onShowToast?.("Propriedades do Negócio atualizadas no HubSpot!");
                          }}
                          className="flex-1 py-1.5 rounded-[4px] bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold cursor-pointer"
                        >
                          Salvar Propriedades
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* CENTER PANE: ACTIVITY TIMELINE */}
              <div className="lg:col-span-5 space-y-4">
                <form
                  onSubmit={handleSaveDealNote}
                  className="bg-white rounded-[6px] border border-[#cbd6e2] p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase text-[#33475b] flex items-center gap-1.5">
                      <MessageSquarePlus className="w-4 h-4 text-[#ff7a59]" />
                      Registrar Nota, Ligação ou Reunião
                    </span>
                  </div>
                  <input
                    type="text"
                    required
                    value={noteTitle}
                    onChange={(e) => setNoteTitle(e.target.value)}
                    placeholder="Assunto (ex: Proposta comercial enviada / Alinhamento técnico)"
                    className="w-full px-3 py-1.5 rounded-[4px] border border-[#cbd6e2] text-xs text-[#33475b]"
                  />
                  <textarea
                    rows={2}
                    value={noteBody}
                    onChange={(e) => setNoteBody(e.target.value)}
                    placeholder="Escreva observações, escopo de ramais/PABX IP ou decisão do cliente..."
                    className="w-full px-3 py-1.5 rounded-[4px] border border-[#cbd6e2] text-xs text-[#33475b]"
                  />
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={savingNote}
                      className="px-4 py-1.5 rounded-[4px] bg-[#213343] hover:bg-[#33475b] text-white text-xs font-extrabold transition cursor-pointer"
                    >
                      {savingNote ? "Salvando..." : "Registrar na Timeline"}
                    </button>
                  </div>
                </form>

                <div className="bg-white rounded-[6px] border border-[#cbd6e2] p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-[#eaf0f6] pb-2">
                    <h4 className="text-xs font-extrabold uppercase text-[#33475b]">
                      Linha do Tempo de Atividades ({dealTimeline.length})
                    </h4>
                  </div>

                  {loadingDetail ? (
                    <p className="text-xs text-slate-400">Carregando histórico...</p>
                  ) : dealTimeline.length === 0 ? (
                    <p className="text-xs text-slate-400">
                      Nenhuma atividade registrada ainda neste negócio.
                    </p>
                  ) : (
                    <div className="space-y-2.5 max-h-[380px] overflow-y-auto">
                      {dealTimeline.map((evt) => (
                        <div
                          key={evt.id}
                          className="p-3 rounded-[4px] border border-[#cbd6e2] bg-[#f5f8fa] space-y-1"
                        >
                          <div className="flex items-center justify-between text-[10px] text-[#516f90]">
                            <span className="font-extrabold text-[#0091ae]">{evt.type}</span>
                            <span>{formatDateTimeBR(evt.createdAt)}</span>
                          </div>
                          <div className="text-xs font-bold text-[#33475b]">{evt.title}</div>
                          {evt.body && <p className="text-xs text-[#516f90]">{evt.body}</p>}
                          <div className="text-[10px] text-slate-400">Autor: {evt.actor}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT PANE: ASSOCIATIONS & PROPOSAL PDF */}
              <div className="lg:col-span-3 space-y-4">
                <div className="bg-white rounded-[6px] border border-[#cbd6e2] p-3.5 space-y-2">
                  <div className="text-[10px] font-extrabold uppercase text-[#516f90] flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-[#0091ae]" />
                    Empresa Associada
                  </div>
                  <div className="text-xs font-extrabold text-[#33475b]">
                    {selectedDeal.company?.name || "Empresa Corporativa B2B"}
                  </div>
                  <div className="text-[11px] text-[#516f90] space-y-0.5">
                    <div>CNPJ: {selectedDeal.company?.cnpj || "18.236.120/0001-58"}</div>
                    <div>
                      Cidade: {selectedDeal.company?.city || "São Paulo"}/
                      {selectedDeal.company?.state || "SP"}
                    </div>
                    <div>Setor: {selectedDeal.company?.industry || "Telecom & Tecnologia"}</div>
                  </div>
                </div>

                <div className="bg-white rounded-[6px] border border-[#cbd6e2] p-3.5 space-y-2">
                  <div className="text-[10px] font-extrabold uppercase text-[#516f90] flex items-center gap-1">
                    <User className="w-3.5 h-3.5 text-[#0091ae]" />
                    Contato Decisor
                  </div>
                  <div className="text-xs font-extrabold text-[#33475b]">
                    {selectedDeal.contact
                      ? `${selectedDeal.contact.firstName} ${selectedDeal.contact.lastName}`
                      : "Decisor de TI / Compras"}
                  </div>
                  <div className="text-[11px] text-[#516f90] space-y-0.5">
                    <div>Cargo: {selectedDeal.contact?.jobTitle || "Diretor de Operações"}</div>
                    <div>E-mail: {selectedDeal.contact?.email || "contato@empresa.com.br"}</div>
                    <div>Telefone: {selectedDeal.contact?.phone || "(11) 3958-4929"}</div>
                  </div>
                </div>

                <div className="bg-white rounded-[6px] border border-[#cbd6e2] p-3.5 space-y-2.5">
                  <div className="text-[10px] font-extrabold uppercase text-[#516f90] flex items-center gap-1">
                    <Layers className="w-3.5 h-3.5 text-[#ff7a59]" />
                    Proposta Comercial &amp; Link PDF
                  </div>
                  <p className="text-[11px] text-[#516f90]">
                    Gere instantaneamente o orçamento oficial da Seta Telecom com link público para o cliente visualizar e imprimir em PDF (A4).
                  </p>
                  <button
                    type="button"
                    disabled={generatingProposalDealId === selectedDeal.id}
                    onClick={() => handleQuickGenerateProposalForDeal(selectedDeal)}
                    className="w-full py-2 px-3 rounded-[4px] bg-[#1e3a6e] hover:bg-[#162b54] text-white text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5 text-emerald-300" />
                    Gerar Proposta + Link PDF
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
