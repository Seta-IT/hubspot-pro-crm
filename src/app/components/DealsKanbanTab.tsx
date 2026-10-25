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
} from 'lucide-react';
import { Company, Contact, Deal, PipelineStage, TimelineEvent } from '../../db/types';
import { formatBRL, formatDateTimeBR } from './ui-helpers';

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
      {/* SELETOR DE PIPELINE EM DESTAQUE (3 FUNIS SETA TELECOM) */}
      <div className="bg-gradient-to-r from-[#1e293b] to-[#0f172a] rounded-2xl p-4 text-white shadow-md border border-slate-800">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#ff987f] block">
              Seletor de Pipeline • Seta Telecom (HubSpot Portal 4369067)
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
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
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

        {/* Forecast Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-100">
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/60">
            <span className="text-[11px] font-semibold uppercase text-slate-400">
              Pipeline em Aberto
            </span>
            <div className="text-base font-bold text-slate-900 mt-0.5">
              {formatBRL(forecast.totalOpenValue)}
            </div>
          </div>
          <div className="bg-orange-50/60 rounded-xl p-3 border border-orange-200/70">
            <span className="text-[11px] font-semibold uppercase text-[#e05835]">
              Receita Ponderada (Forecast)
            </span>
            <div className="text-base font-bold text-[#e05835] mt-0.5">
              {formatBRL(forecast.weightedOpenValue)}
            </div>
          </div>
          <div className="bg-emerald-50/60 rounded-xl p-3 border border-emerald-200/70">
            <span className="text-[11px] font-semibold uppercase text-emerald-700">
              Fechado Ganho (Won)
            </span>
            <div className="text-base font-bold text-emerald-700 mt-0.5">
              {formatBRL(forecast.closedWonValue)}
            </div>
          </div>
          <div className="bg-rose-50/60 rounded-xl p-3 border border-rose-200/70">
            <span className="text-[11px] font-semibold uppercase text-rose-700">
              Deal Rotting (Acima do SLA)
            </span>
            <div className="text-base font-bold text-rose-700 mt-0.5">
              {forecast.rottingDealsCount} negócio(s)
            </div>
          </div>
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
                className={`w-80 shrink-0 rounded-2xl bg-slate-100/90 border transition flex flex-col max-h-[760px] ${headerAccent} ${
                  isDragTarget
                    ? 'border-[#ff7a59] ring-2 ring-[#ff7a59]/30 bg-orange-50/40'
                    : 'border-slate-200/90'
                }`}
              >
                {/* Column Header */}
                <div className="p-3.5 bg-white rounded-t-xl border-b border-slate-200/80">
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

                      return (
                        <div
                          key={deal.id}
                          draggable
                          onDragStart={(e) => {
                            setDraggingDealId(deal.id);
                            e.dataTransfer.setData('text/plain', deal.id);
                          }}
                          onDragEnd={() => {
                            setDraggingDealId(null);
                            setDragOverStageId(null);
                          }}
                          className={`group bg-white rounded-xl p-3.5 border shadow-sm hover:shadow-md transition cursor-grab active:cursor-grabbing ${
                            deal.isRotting
                              ? 'border-rose-300 ring-1 ring-rose-200/60'
                              : 'border-slate-200 hover:border-[#ff7a59]/60'
                          } ${isUpdating ? 'opacity-60 pointer-events-none' : ''}`}
                        >
                          {/* Top Badges */}
                          <div className="flex items-center justify-between gap-1.5 mb-2">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                                deal.status === 'WON'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : deal.status === 'LOST'
                                    ? 'bg-slate-200 text-slate-700'
                                    : deal.isRotting
                                      ? 'bg-rose-100 text-rose-800'
                                      : deal.probability >= 70
                                        ? 'bg-orange-100 text-[#e05835]'
                                        : 'bg-blue-50 text-blue-700'
                              }`}
                            >
                              {deal.status === 'WON' ? (
                                <>
                                  <CheckCircle2 className="w-3 h-3" /> Ganho
                                </>
                              ) : deal.status === 'LOST' ? (
                                <>
                                  <XCircle className="w-3 h-3" /> Perdido
                                </>
                              ) : deal.isRotting ? (
                                <>
                                  <AlertTriangle className="w-3 h-3" /> Estagnado ({deal.daysInactive}d)
                                </>
                              ) : (
                                <>
                                  <TrendingUp className="w-3 h-3" /> Prob. {deal.probability}%
                                </>
                              )}
                            </span>

                            <span className="text-[11px] text-slate-400 inline-flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {deal.daysInactive}d
                            </span>
                          </div>

                          {/* Deal Title */}
                          <button
                            type="button"
                            onClick={() => openDealDetail(deal)}
                            className="text-left w-full"
                          >
                            <h4 className="text-xs font-bold text-slate-900 group-hover:text-[#ff7a59] transition leading-snug">
                              {deal.title}
                            </h4>
                          </button>

                          {/* Value & Weighted */}
                          <div className="mt-2 flex items-baseline justify-between">
                            <div className="text-sm font-extrabold text-slate-900">
                              {formatBRL(deal.value)}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              Pond: <strong className="text-slate-700">{formatBRL(deal.weightedValue)}</strong>
                            </div>
                          </div>

                          {/* Company & Contact */}
                          <div className="mt-2.5 pt-2.5 border-t border-slate-100 space-y-1 text-[11px] text-slate-600">
                            <div className="flex items-center gap-1.5 truncate">
                              <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span className="truncate font-medium">
                                {deal.company?.name || 'Sem empresa vinculada'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 truncate">
                              <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span className="truncate">
                                {deal.contact
                                  ? `${deal.contact.firstName} ${deal.contact.lastName}`
                                  : 'Sem decisor vinculado'}
                              </span>
                            </div>
                          </div>

                          {/* Next Best Action Pill */}
                          {deal.nextBestAction && (
                            <div className="mt-2.5 p-2 rounded-lg bg-slate-50 border border-slate-200/70 text-[11px] text-slate-700">
                              <div className="flex items-center gap-1 font-semibold text-[#e05835]">
                                <Sparkles className="w-3 h-3 shrink-0" />
                                <span className="truncate">{deal.nextBestAction.title}</span>
                              </div>
                            </div>
                          )}

                          {/* Stage Selector & Quick Move Buttons */}
                          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between gap-1.5">
                            <button
                              type="button"
                              disabled={!prevStage}
                              onClick={() => prevStage && handleStageChange(deal.id, prevStage.id)}
                              title={prevStage ? `Voltar para ${prevStage.name}` : 'Primeira etapa'}
                              className="p-1 rounded-md border border-slate-200 hover:bg-slate-100 disabled:opacity-30 text-slate-600"
                            >
                              <ChevronLeft className="w-3.5 h-3.5" />
                            </button>

                            <select
                              aria-label={`Mudar estágio de ${deal.title}`}
                              value={deal.stageId}
                              onChange={(e) => handleStageChange(deal.id, e.target.value)}
                              className="flex-1 text-[11px] font-medium bg-slate-50 border border-slate-200 rounded-md px-1.5 py-1 text-slate-700 focus:outline-none focus:border-[#ff7a59]"
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
                              title={nextStage ? `Avançar para ${nextStage.name}` : 'Última etapa'}
                              className="p-1 rounded-md border border-slate-200 hover:bg-[#ff7a59] hover:text-white hover:border-[#ff7a59] disabled:opacity-30 text-slate-600 transition"
                            >
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
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

      {/* DEAL DETAIL DRAWER */}
      {selectedDeal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex justify-end">
          <div className="bg-white w-full max-w-xl h-full shadow-2xl border-l border-slate-200 flex flex-col overflow-hidden">
            <div className="px-6 py-4 bg-[#1e293b] text-white flex items-center justify-between">
              <div>
                <span className="text-[11px] uppercase tracking-wider text-[#ff987f] font-bold">
                  Ficha Executiva do Negócio
                </span>
                <h3 className="text-base font-bold text-white mt-0.5">{selectedDeal.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDeal(null)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              {/* Summary Metrics */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-[11px] text-slate-500">Valor Total</div>
                  <div className="text-base font-bold text-slate-900">
                    {formatBRL(selectedDeal.value)}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-orange-50/60 border border-orange-200">
                  <div className="text-[11px] text-[#e05835]">Probabilidade</div>
                  <div className="text-base font-bold text-[#e05835]">
                    {selectedDeal.probability}%
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-[11px] text-slate-500">Valor Ponderado</div>
                  <div className="text-base font-bold text-slate-900">
                    {formatBRL(selectedDeal.weightedValue)}
                  </div>
                </div>
              </div>

              {/* Quick Stage Change & 360 Edit inside Drawer */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold uppercase text-slate-600">
                    Edição 360° do Negócio (Seta Telecom)
                  </label>
                  {onNavigateToErp && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDeal(null);
                        onNavigateToErp();
                      }}
                      className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-extrabold cursor-pointer"
                    >
                      📄 Abrir no ERP / Gerar Proposta &amp; Locação
                    </button>
                  )}
                </div>

                <select
                  value={selectedDeal.stageId}
                  onChange={async (e) => {
                    const nextStage = e.target.value;
                    await handleStageChange(selectedDeal.id, nextStage);
                    const updated = deals.find((d) => d.id === selectedDeal.id);
                    if (updated) setSelectedDeal({ ...updated, stageId: nextStage });
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-800"
                >
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.order}. {s.name} (Probabilidade padrão: {s.defaultProbability}%)
                    </option>
                  ))}
                </select>

                <div className="grid grid-cols-2 gap-2.5 pt-2">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                      Valor Total (R$)
                    </label>
                    <input
                      type="number"
                      value={selectedDeal.value}
                      onChange={(e) =>
                        setSelectedDeal({ ...selectedDeal, value: Number(e.target.value) || 0 })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                      Proprietário Seta Telecom
                    </label>
                    <select
                      value={selectedDeal.ownerName || 'Marcelo Lopes Mira'}
                      onChange={(e) =>
                        setSelectedDeal({ ...selectedDeal, ownerName: e.target.value })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold"
                    >
                      <option value="Marcelo Lopes Mira">Marcelo Lopes Mira</option>
                      <option value="Evelyn Ternero Seta Telecom">Evelyn Ternero Seta Telecom</option>
                      <option value="Contato Seta Telecom">Contato Seta Telecom</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  {onDeleteDeal && (
                    <button
                      type="button"
                      onClick={async () => {
                        await onDeleteDeal(selectedDeal.id);
                        setSelectedDeal(null);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold cursor-pointer"
                    >
                      Excluir Negócio
                    </button>
                  )}
                  {onUpdateDeal && (
                    <button
                      type="button"
                      onClick={async () => {
                        await onUpdateDeal(selectedDeal.id, {
                          title: selectedDeal.title,
                          value: selectedDeal.value,
                          ownerName: selectedDeal.ownerName,
                          stageId: selectedDeal.stageId,
                        });
                      }}
                      className="px-4 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
                    >
                      Salvar Alterações
                    </button>
                  )}
                </div>
              </div>

              {/* Add Activity / Note */}
              <form
                onSubmit={handleSaveDealNote}
                className="p-4 rounded-xl border border-slate-200 bg-white space-y-3"
              >
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-slate-700">
                  <MessageSquarePlus className="w-4 h-4 text-[#ff7a59]" />
                  Registrar Nota ou Avanço Comercial
                </div>
                <input
                  type="text"
                  required
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  placeholder="Título da interação (ex: Reunião de revisão jurídica)"
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800"
                />
                <textarea
                  rows={2}
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                  placeholder="Detalhes e próximos passos..."
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingNote}
                    className="px-3.5 py-1.5 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-semibold transition"
                  >
                    {savingNote ? 'Registrando...' : 'Salvar na Timeline'}
                  </button>
                </div>
              </form>

              {/* Timeline History */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Histórico de Atividades & Mudanças de Estágio ({dealTimeline.length})
                </h4>
                {loadingDetail ? (
                  <p className="text-xs text-slate-400">Carregando timeline...</p>
                ) : dealTimeline.length === 0 ? (
                  <p className="text-xs text-slate-400">Nenhuma atividade registrada neste negócio.</p>
                ) : (
                  <div className="space-y-2.5">
                    {dealTimeline.map((evt) => (
                      <div
                        key={evt.id}
                        className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 space-y-1"
                      >
                        <div className="flex items-center justify-between text-[11px] text-slate-500">
                          <span className="font-bold text-slate-700">{evt.type}</span>
                          <span>{formatDateTimeBR(evt.createdAt)}</span>
                        </div>
                        <div className="text-xs font-bold text-slate-900">{evt.title}</div>
                        {evt.body && <p className="text-xs text-slate-600">{evt.body}</p>}
                        <div className="text-[11px] text-slate-400">Por: {evt.actor}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
