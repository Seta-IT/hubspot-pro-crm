'use client';

import React, { useState, useEffect } from 'react';
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
  LayoutGrid,
  List,
  Users,
} from 'lucide-react';
import { Company, Contact, Deal, DealBusinessType, DealPriority, ErpCommercialProposal, ErpRentalContract, PipelineStage, TimelineEvent } from '../../db/types';
import { formatBRL, formatDateTimeBR } from './ui-helpers';
import { buildPublicProposalUrl } from '../lib/proposal-share';
import { recordUpsertedProposal } from '../lib/durable-storage';
import ClientEmailComposerModal, { ClientEmailInitialPayload } from './ClientEmailComposerModal';
import { copySignedProposalLink } from '../lib/proposal-link-client';
import { SalesHubProToolsStrip } from './MarketingAndSalesHubSuites';

export type DealsViewMode =
  | 'KANBAN'
  | 'LIST'
  | 'COMPACT_GRID'
  | 'TIMELINE_FORECAST'
  | 'BY_OWNER_PRIORITY';

export const DEALS_VIEW_MODES: Array<{ id: DealsViewMode; label: string; shortLabel: string }> = [
  { id: 'KANBAN', label: 'Kanban', shortLabel: 'Kanban' },
  { id: 'LIST', label: 'Lista', shortLabel: 'Lista' },
  { id: 'COMPACT_GRID', label: 'Grade Compacta', shortLabel: 'Grade' },
  { id: 'TIMELINE_FORECAST', label: 'Cronograma / Previsão', shortLabel: 'Cronograma' },
  { id: 'BY_OWNER_PRIORITY', label: 'Por Executivo / Prioridade', shortLabel: 'Por Executivo' },
];

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
  proposals?: ErpCommercialProposal[];
  rentalContracts?: ErpRentalContract[];
  onMoveDealStage: (dealId: string, newStageId: string) => Promise<void>;
  onCreateDeal: (payload: {
    title: string;
    value: number;
    stageId: string;
    pipelineId?: string;
    mrr?: number;
    contractMonths?: number;
    priority?: DealPriority;
    dealType?: DealBusinessType;
    ownerName?: string;
    contactId?: string | null;
    companyId?: string | null;
    expectedCloseDate?: string | null;
  }) => Promise<void>;
  onAddDealNote: (dealId: string, title: string, body: string, activityType?: 'NOTE' | 'CALL' | 'MEETING' | 'EMAIL' | 'TASK') => Promise<void>;
  selectedPipelineId?: string;
  onSelectPipeline?: (pipelineId: string) => void;
  initialSelectedDealId?: string | null;
  onClearInitialDeal?: () => void;
  openNewDealTrigger?: number;
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
  proposals = [],
  rentalContracts = [],
  onMoveDealStage,
  onCreateDeal,
  onAddDealNote,
  selectedPipelineId,
  onSelectPipeline,
  initialSelectedDealId,
  onClearInitialDeal,
  openNewDealTrigger,
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

  const [viewMode, setViewMode] = useState<DealsViewMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('stihub_deals_view_mode') as DealsViewMode | null;
      if (
        saved &&
        ['KANBAN', 'LIST', 'COMPACT_GRID', 'TIMELINE_FORECAST', 'BY_OWNER_PRIORITY'].includes(saved)
      ) {
        return saved;
      }
    }
    return 'KANBAN';
  });
  const [ownerPrioritySubMode, setOwnerPrioritySubMode] = useState<'OWNER' | 'PRIORITY'>('OWNER');
  const [mobileStageFilter, setMobileStageFilter] = useState<string>('ALL');

  const handleSelectViewMode = (mode: DealsViewMode) => {
    setViewMode(mode);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem('stihub_deals_view_mode', mode);
      } catch {}
    }
  };

  useEffect(() => {
    setMobileStageFilter('ALL');
  }, [currentPipelineId]);

  useEffect(() => {
    if (openNewDealTrigger && openNewDealTrigger > 0) {
      openCreateDealModal(stages[0]?.id || 'stage-discovery');
    }
  }, [openNewDealTrigger]);

  useEffect(() => {
    if (initialSelectedDealId) {
      const found = deals.find((d) => d.id === initialSelectedDealId);
      if (found) {
        if (found.pipelineId && found.pipelineId !== currentPipelineId) {
          handleSelectPipe(found.pipelineId);
        }
        openDealDetail(found);
      }
      onClearInitialDeal?.();
    }
  }, [initialSelectedDealId, deals]);

  const [filterRottingOnly, setFilterRottingOnly] = useState(false);
  const [filterOwner, setFilterOwner] = useState<string>('ALL');
  const [filterPriority, setFilterPriority] = useState<string>('ALL');
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
  const [emailModalPayload, setEmailModalPayload] = useState<ClientEmailInitialPayload | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newMrr, setNewMrr] = useState('');
  const [newContractMonths, setNewContractMonths] = useState('24');
  const [newPriority, setNewPriority] = useState<DealPriority>('ALTA');
  const [newDealType, setNewDealType] = useState<DealBusinessType>('NEW_BUSINESS');
  const [newOwnerName, setNewOwnerName] = useState('Marcelo Lopes Mira');
  const [newStageId, setNewStageId] = useState(stages[0]?.id || 'stage-discovery');
  const [newContactId, setNewContactId] = useState('');
  const [newCompanyId, setNewCompanyId] = useState('');
  const [newCloseDate, setNewCloseDate] = useState('');
  const [creating, setCreating] = useState(false);

  const openCreateDealModal = (initialStageId?: string) => {
    const targetStageId = initialStageId || stages[0]?.id || 'stage-discovery';
    setNewStageId(targetStageId);
    setNewTitle('');
    setNewValue('');
    setNewMrr('');
    setNewContactId('');
    setNewCompanyId('');
    setNewCloseDate('');
    const defaultType: DealBusinessType =
      activePipeline?.id === 'pipeline-locacao-equipamentos'
        ? 'LOCACAO_RECORRENTE'
        : activePipeline?.id === 'pipeline-expansao-renovacao'
          ? 'UPSELL_RENOVACAO'
          : 'NEW_BUSINESS';
    setNewDealType(defaultType);
    setShowCreateModal(true);
  };

  // Selected Deal Drawer State
  const [selectedDeal, setSelectedDeal] = useState<EnrichedDeal | null>(null);
  const [dealTimeline, setDealTimeline] = useState<TimelineEvent[]>([]);
  const [detailProposals, setDetailProposals] = useState<ErpCommercialProposal[]>([]);
  const [detailContracts, setDetailContracts] = useState<ErpRentalContract[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [noteType, setNoteType] = useState<'NOTE' | 'CALL' | 'MEETING' | 'EMAIL' | 'TASK'>('NOTE');
  const [timelineFilterType, setTimelineFilterType] = useState<string>('ALL');
  const [noteTitle, setNoteTitle] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const openDealDetail = async (deal: EnrichedDeal) => {
    setSelectedDeal(deal);
    setTimelineFilterType('ALL');
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/deals/${deal.id}`);
      if (res.ok) {
        const json = await res.json();
        setDealTimeline(json.data?.timeline || []);
        if (Array.isArray(json.data?.proposals)) {
          setDetailProposals(json.data.proposals);
        } else {
          setDetailProposals([]);
        }
        if (Array.isArray(json.data?.rentalContracts)) {
          setDetailContracts(json.data.rentalContracts);
        } else {
          setDetailContracts([]);
        }
      }
    } catch {
      setDealTimeline([]);
      setDetailProposals([]);
      setDetailContracts([]);
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
      const months = Math.max(1, Number(newContractMonths) || 24);
      const tcvValue = Number(newValue) || (Number(newMrr) || 0) * months;
      const mrrValue = Number(newMrr) || Math.round(tcvValue / months);
      await onCreateDeal({
        title: newTitle.trim(),
        value: tcvValue,
        mrr: mrrValue,
        contractMonths: months,
        priority: newPriority,
        dealType: newDealType,
        ownerName: newOwnerName,
        stageId: newStageId || stages[0]?.id || 'stage-discovery',
        ...(activePipeline ? { pipelineId: activePipeline.id } : {}),
        contactId: newContactId || null,
        companyId: newCompanyId || null,
        expectedCloseDate: newCloseDate ? new Date(newCloseDate).toISOString() : null,
      });
      setNewTitle('');
      setNewValue('150000');
      setNewMrr('6250');
      setNewContractMonths('24');
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
      await onAddDealNote(selectedDeal.id, noteTitle.trim(), noteBody.trim(), noteType);
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

  const pipeOpenDeals = pipelineDeals.filter((d) => d.status === 'OPEN');
  const pipeWonDeals = pipelineDeals.filter((d) => d.status === 'WON');
  const pipeOpenValue = pipeOpenDeals.reduce((s, d) => s + d.value, 0);
  const pipeWeightedValue = pipeOpenDeals.reduce((s, d) => s + d.weightedValue, 0);
  const pipeWonValue = pipeWonDeals.reduce((s, d) => s + d.value, 0);
  const pipeRottingCount = pipeOpenDeals.filter((d) => d.isRotting).length;
  const pipeTotalMrr = pipelineDeals
    .filter((d) => d.status !== 'LOST')
    .reduce((s, d) => s + (d.mrr || Math.round(d.value / (d.contractMonths || 24))), 0);

  const availableOwners = Array.from(
    new Set([
      'Marcelo Lopes Mira',
      'Evelyn Ternero Seta Telecom',
      'Contato Seta Telecom',
      ...deals.map((d) => d.ownerName).filter((o): o is string => Boolean(o)),
    ])
  );

  const normDealStr = (v: unknown) =>
    String(v ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

  const filteredDeals = pipelineDeals.filter((d) => {
    if (filterRottingOnly && !d.isRotting) return false;
    if (filterOwner !== 'ALL') {
      const dealOwner = normDealStr(d.ownerName || 'Marcelo Lopes Mira');
      const targetOwner = normDealStr(filterOwner);
      if (
        dealOwner !== targetOwner &&
        !(targetOwner.includes('marcelo') && dealOwner.includes('marcelo')) &&
        !(targetOwner.includes('evelyn') && dealOwner.includes('evelyn'))
      ) {
        return false;
      }
    }
    if (filterPriority !== 'ALL') {
      const effectivePriority =
        d.priority || (d.value >= 150000 ? 'ALTA' : d.value >= 60000 ? 'MEDIA' : 'BAIXA');
      if (effectivePriority !== filterPriority) return false;
    }
    if (searchQuery.trim()) {
      const q = normDealStr(searchQuery);
      const qDigits = searchQuery.replace(/\D+/g, '');
      const hay = normDealStr(
        `${d.title} ${d.company?.name || ''} ${d.company?.cnpj || ''} ${d.contact?.firstName || ''} ${d.contact?.lastName || ''} ${d.ownerName || ''}`
      );
      const cnpjDigits = String(d.company?.cnpj || '').replace(/\D+/g, '');
      return Boolean(
        hay.includes(q) || (qDigits.length >= 2 && cnpjDigits.includes(qDigits))
      );
    }
    return true;
  });

  // Associated Proposals & Rental Contracts for Selected Deal
  const associatedProposals = selectedDeal
    ? Array.from(
        new Map(
          [...detailProposals, ...proposals]
            .filter(
              (p) =>
                p.dealId === selectedDeal.id ||
                (selectedDeal.companyId && p.companyId === selectedDeal.companyId)
            )
            .map((p) => [p.id, p])
        ).values()
      )
    : [];

  const associatedContracts = selectedDeal
    ? Array.from(
        new Map(
          [...detailContracts, ...rentalContracts]
            .filter(
              (c) =>
                c.dealId === selectedDeal.id ||
                (selectedDeal.companyId && c.companyId === selectedDeal.companyId)
            )
            .map((c) => [c.id, c])
        ).values()
      )
    : [];

  const filteredTimeline = dealTimeline.filter(
    (evt) => timelineFilterType === 'ALL' || evt.type === timelineFilterType
  );

  return (
        <div className="space-y-5">
      {emailModalPayload && (
        <ClientEmailComposerModal
          payload={emailModalPayload}
          onClose={() => setEmailModalPayload(null)}
          onSentSuccess={(msg) => onShowToast?.(msg)}
        />
      )}
      {createdProposalBanner && (
        <div className="bg-emerald-950 text-white rounded-[6px] p-4 border border-emerald-600 shadow-lg flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-emerald-500 text-slate-950 text-[10px] font-semibold uppercase">
                PROPOSTA CRIADA COM SUCESSO
              </span>
              <span className="font-mono text-xs font-semibold text-emerald-300">
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
              onClick={async () => {
                // Link assinado (29/10): gerado no servidor com a sessao do vendedor.
                const r = await copySignedProposalLink(createdProposalBanner.proposal.id);
                onShowToast?.(r.ok ? "Link assinado da proposta copiado para enviar ao cliente!" : r.error);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[4px] bg-white text-slate-900 hover:bg-slate-100 text-xs font-semibold cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5 text-emerald-700" />
              Copiar link para o cliente
            </button>
            <a
              href={createdProposalBanner.publicUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[4px] bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Abrir Proposta
            </a>
            <a
              href={createdProposalBanner.printUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[4px] bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-semibold"
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
      <SalesHubProToolsStrip
        onOpenEmailModal={(p) => setEmailModalPayload(p)}
        onShowToast={onShowToast}
      />
      {/* SELETOR DE PIPELINE EM DESTAQUE (3 FUNIS SETA TELECOM) */}
      <div className="bg-[#213343] rounded-[6px] p-4 text-white shadow-2xs border border-[#33475b]">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#ff987f] block">
              STI-hub • Seletor de Pipeline Seta Telecom (Portal 4369067)
            </span>
            <h3 className="text-sm sm:text-base font-semibold text-white">
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
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-2 cursor-pointer border ${
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
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-lg font-semibold text-slate-900">
                {activePipeline?.name || 'Funil Comercial Enterprise B2B'}
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-orange-50 text-[#e05835] border border-orange-200">
                {pipelineDeals.length} neste funil ({deals.length} total nos 3 funis)
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Arraste e solte os cards entre colunas ou utilize os seletores rápidos para atualizar estágio, probabilidade e forecast em tempo real.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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

            <select
              aria-label="Filtrar por Proprietário"
              value={filterOwner}
              onChange={(e) => setFilterOwner(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 focus:outline-none focus:border-[#ff7a59]"
            >
              <option value="ALL">Proprietário: Todos</option>
              {availableOwners.map((owner) => (
                <option key={owner} value={owner}>
                  {owner}
                </option>
              ))}
            </select>

            <select
              aria-label="Filtrar por Prioridade"
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 focus:outline-none focus:border-[#ff7a59]"
            >
              <option value="ALL">Prioridade: Todas</option>
              <option value="ALTA">Prioridade Alta</option>
              <option value="MEDIA">Prioridade Média</option>
              <option value="BAIXA">Prioridade Baixa</option>
            </select>

            <button
              type="button"
              onClick={() => setFilterRottingOnly((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                filterRottingOnly
                  ? 'bg-rose-600 text-white border-rose-600'
                  : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Estagnados ({pipeRottingCount})
            </button>

            <button
              type="button"
              onClick={() => openCreateDealModal(stages[0]?.id || 'stage-discovery')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-semibold shadow-sm transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Novo Negócio
            </button>
          </div>
        </div>

        {/* Forecast Strip (KPIs Dinâmicos do Funil Selecionado + Consolidado Global) */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={() => {
              setFilterRottingOnly(false);
              setFilterOwner('ALL');
              setFilterPriority('ALL');
              setSearchQuery('');
            }}
            className="text-left bg-slate-50 hover:bg-blue-50/60 hover:border-[#0091ae] rounded-xl p-3 border border-slate-200/60 transition cursor-pointer"
          >
            <span className="text-[11px] font-semibold uppercase text-slate-500 block">
              Pipeline em Aberto (Funil)
            </span>
            <div className="text-base font-semibold text-slate-900 mt-0.5">
              {formatBRL(pipeOpenValue)}
            </div>
            <span className="text-[10px] text-slate-400 block mt-0.5">
              Global 3 funis: {formatBRL(forecast.totalOpenValue)}
            </span>
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
              Receita Ponderada (Forecast)
            </span>
            <div className="text-base font-semibold text-[#e05835] mt-0.5">
              {formatBRL(pipeWeightedValue)}
            </div>
            <span className="text-[10px] text-[#e05835]/80 block mt-0.5">
              Global 3 funis: {formatBRL(forecast.weightedOpenValue)}
            </span>
          </button>
          <div className="text-left bg-sky-50/60 rounded-xl p-3 border border-sky-200/70">
            <span className="text-[11px] font-semibold uppercase text-[#0091ae] block">
              MRR Recorrente (Funil)
            </span>
            <div className="text-base font-semibold text-[#0091ae] mt-0.5">
              {formatBRL(pipeTotalMrr)}/mês
            </div>
            <span className="text-[10px] text-sky-700/80 block mt-0.5">
              {pipelineDeals.filter((d) => d.status !== 'LOST').length} contrato(s) ativo(s)/abertos
            </span>
          </div>
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
              Fechado Ganho (Won)
            </span>
            <div className="text-base font-semibold text-emerald-700 mt-0.5">
              {formatBRL(pipeWonValue)}
            </div>
            <span className="text-[10px] text-emerald-700/80 block mt-0.5">
              Global 3 funis: {formatBRL(forecast.closedWonValue)}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setFilterRottingOnly((v) => !v)}
            className="text-left bg-rose-50/60 hover:bg-rose-100/60 hover:border-rose-500 rounded-xl p-3 border border-rose-200/70 transition cursor-pointer"
          >
            <span className="text-[11px] font-semibold uppercase text-rose-700 block">
              Deal Rotting ({filterRottingOnly ? 'Mostrando' : 'Filtrar →'})
            </span>
            <div className="text-base font-semibold text-rose-700 mt-0.5">
              {pipeRottingCount} negócio(s)
            </div>
            <span className="text-[10px] text-rose-700/80 block mt-0.5">
              Global 3 funis: {forecast.rottingDealsCount} estagnado(s)
            </span>
          </button>
        </div>
      </div>

      {/* BARRA CORPORATIVA DE MÚLTIPLAS VISUALIZAÇÕES DO PIPELINE (5 MODOS + FILTRO MOBILE DE ETAPA) */}
      <div className="bg-white rounded-[6px] border border-[#cbd6e2] p-3 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-2.5">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mr-1 shrink-0">
            Visualização:
          </span>
          {DEALS_VIEW_MODES.map((vm) => {
            const active = viewMode === vm.id;
            return (
              <button
                key={vm.id}
                type="button"
                onClick={() => handleSelectViewMode(vm.id)}
                className={`shrink-0 px-3 py-1.5 rounded-[4px] text-xs font-semibold transition cursor-pointer border ${
                  active
                    ? 'bg-[#0d2b4e] text-white border-[#0d2b4e] shadow-2xs'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <span className="hidden sm:inline">{vm.label}</span>
                <span className="sm:hidden">{vm.shortLabel}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between md:justify-end gap-2 text-xs text-slate-600">
          <span>
            Exibindo <strong>{filteredDeals.length}</strong> negócios • MRR:{' '}
            <strong className="text-emerald-700">{formatBRL(pipeTotalMrr)}/mês</strong>
          </span>
        </div>
      </div>

      {/* MODO 1: KANBAN BOARD (COM SELETOR DE ETAPA MOBILE + SCROLL HORIZONTAL) */}
      {viewMode === 'KANBAN' && (
        <div className="space-y-3">
          {/* Seletor rápido de etapa no celular (< md) */}
          <div className="md:hidden flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
            <button
              type="button"
              onClick={() => setMobileStageFilter('ALL')}
              className={`shrink-0 px-2.5 py-1.5 rounded text-[11px] font-semibold cursor-pointer ${
                mobileStageFilter === 'ALL'
                  ? 'bg-[#ff7a59] text-white'
                  : 'bg-white border border-slate-200 text-slate-700'
              }`}
            >
              Todas Etapas ({filteredDeals.length})
            </button>
            {stages.map((st) => {
              const cnt = filteredDeals.filter((d) => d.stageId === st.id).length;
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setMobileStageFilter(st.id)}
                  className={`shrink-0 px-2.5 py-1.5 rounded text-[11px] font-semibold cursor-pointer ${
                    mobileStageFilter === st.id
                      ? 'bg-[#0d2b4e] text-white'
                      : 'bg-white border border-slate-200 text-slate-700'
                  }`}
                >
                  {st.order}. {st.name.slice(0, 18)} ({cnt})
                </button>
              );
            })}
          </div>

          <div className="overflow-x-auto pb-4 -mx-2 px-2 sm:mx-0 sm:px-0">
            <div className="inline-flex gap-4 min-w-full">
              {stages
                .filter((st) => mobileStageFilter === 'ALL' || st.id === mobileStageFilter)
                .map((stage, stageIdx) => {
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
                      <span className="w-5 h-5 rounded-full bg-slate-800 text-white text-[11px] font-semibold inline-flex items-center justify-center shrink-0">
                        {stage.order}
                      </span>
                      <h3 className="text-xs font-semibold text-slate-900 truncate" title={stage.name}>
                        {stage.name}
                      </h3>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 shrink-0">
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
                              <h4 className="text-[13px] font-semibold text-[#0091ae] group-hover:underline leading-snug">
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
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] text-[10px] font-semibold border ${priorityMeta.cls}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${priorityMeta.dot}`} />
                              {priorityMeta.short}
                            </span>

                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-[3px] text-[10px] font-semibold border ${typeMeta.cls}`}
                            >
                              {typeMeta.label}
                            </span>

                            {deal.status === "WON" ? (
                              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-[3px] text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                                <CheckCircle2 className="w-3 h-3" /> Ganho
                              </span>
                            ) : deal.status === "LOST" ? (
                              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-[3px] text-[10px] font-semibold bg-slate-200 text-slate-700">
                                <XCircle className="w-3 h-3" /> Perdido
                              </span>
                            ) : deal.isRotting ? (
                              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-[3px] text-[10px] font-semibold bg-rose-100 text-rose-800">
                                <AlertTriangle className="w-3 h-3" /> Inativo {deal.daysInactive}d
                              </span>
                            ) : null}
                          </div>

                          {/* 3. Financial Values Box (Amount / TCV + MRR + Prazo) */}
                          <div className="mt-2.5 p-2.5 rounded-[4px] bg-[#f5f8fa] border border-[#cbd6e2]/80 space-y-1">
                            <div className="flex items-baseline justify-between">
                              <span className="text-[10px] font-semibold uppercase text-[#516f90]">
                                Valor Total ({contractMonths}m):
                              </span>
                              <span className="text-sm font-semibold text-[#33475b]">
                                {formatBRL(deal.value)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-[#516f90]">Mensalidade (MRR):</span>
                              <strong className="text-emerald-700 font-semibold">
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
                                <div className="w-5 h-5 rounded bg-[#213343] text-white text-[9px] font-semibold flex items-center justify-center shrink-0">
                                  <Building2 className="w-3 h-3" />
                                </div>
                                <div className="truncate">
                                  <div className="font-semibold text-[#33475b] truncate">
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
                                <div className="w-5 h-5 rounded-full bg-[#0091ae] text-white text-[9px] font-semibold flex items-center justify-center shrink-0">
                                  {deal.contact
                                    ? getInitials(`${deal.contact.firstName} ${deal.contact.lastName}`)
                                    : "DC"}
                                </div>
                                <div className="truncate">
                                  <div className="font-semibold text-[#33475b] truncate">
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
                                <span className="w-4 h-4 rounded-full bg-[#ff7a59] text-white text-[8px] font-semibold inline-flex items-center justify-center">
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
                              <span className="text-emerald-700 font-semibold">
                                ● ERP GestãoClick Sync
                              </span>
                            </div>
                          </div>

                          {/* 6. Next Best Action (Copiloto IA / Próximo Passo) */}
                          <div className="mt-2 p-2 rounded-[4px] bg-[#eaf0f6]/70 border border-[#cbd6e2] text-[10px] text-[#33475b]">
                            <div className="flex items-center gap-1 font-semibold text-[#0091ae]">
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
                                className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-[4px] border border-[#cbd6e2] bg-white hover:bg-[#f5f8fa] text-[10px] font-semibold text-[#33475b] transition cursor-pointer"
                              >
                                <MessageSquarePlus className="w-3 h-3 text-[#0091ae]" />
                                + Nota / Timeline
                              </button>

                              <button
                                type="button"
                                disabled={generatingProposalDealId === deal.id}
                                onClick={() => handleQuickGenerateProposalForDeal(deal)}
                                className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-[4px] bg-[#1e3a6e] hover:bg-[#162b54] text-white text-[10px] font-semibold transition cursor-pointer disabled:opacity-50"
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
                                className="flex-1 text-[10px] font-semibold bg-[#f5f8fa] border border-[#cbd6e2] rounded px-1.5 py-1 text-[#33475b] focus:outline-none focus:border-[#0091ae]"
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
                    onClick={() => openCreateDealModal(stage.id)}
                    className="w-full py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-[#ff7a59] hover:bg-white border border-transparent hover:border-slate-200 transition inline-flex items-center justify-center gap-1 cursor-pointer"
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
        </div>
      )}

      {/* MODO 2: LISTA CORPORATIVA COMPLETA (TABELA ORDENADA COM MUDANÇA DE ETAPA INLINE) */}
      {viewMode === 'LIST' && (
        <div className="bg-white rounded-[6px] border border-[#cbd6e2] shadow-2xs overflow-hidden">
          <div className="px-4 py-3 bg-[#f8f9fb] border-b border-[#cbd6e2] flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-[#0d2b4e]">
              Visão em Lista Corporativa — {activePipeline?.name} ({filteredDeals.length} negócios)
            </span>
            <span className="text-slate-500">
              Total Aberto: <strong>{formatBRL(pipeOpenValue)}</strong> • Forecast Ponderado:{' '}
              <strong className="text-[#e05835]">{formatBRL(pipeWeightedValue)}</strong>
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-xs">
              <thead className="bg-slate-900 text-white uppercase text-[10px]">
                <tr>
                  <th className="py-2.5 px-3">Negócio / Oportunidade</th>
                  <th className="py-2.5 px-3">Empresa / CNPJ</th>
                  <th className="py-2.5 px-3">Etapa do Funil (Inline)</th>
                  <th className="py-2.5 px-3 text-right">Valor Total (TCV)</th>
                  <th className="py-2.5 px-3 text-right">MRR Mensal</th>
                  <th className="py-2.5 px-3 text-center">Prob. %</th>
                  <th className="py-2.5 px-3">Fechamento Previsto</th>
                  <th className="py-2.5 px-3">Executivo Responsável</th>
                  <th className="py-2.5 px-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredDeals.map((deal) => {
                  const contractMonths = deal.contractMonths || 24;
                  const mrr = deal.mrr || Math.round(deal.value / contractMonths);
                  const priorityMeta = getPriorityMeta(deal.priority, deal.value);
                  const closeDateStr = deal.expectedCloseDate
                    ? new Date(deal.expectedCloseDate).toLocaleDateString('pt-BR')
                    : '30/11/2026';
                  return (
                    <tr key={deal.id} className="hover:bg-slate-50 transition">
                      <td className="py-2.5 px-3">
                        <button
                          type="button"
                          onClick={() => openDealDetail(deal)}
                          className="text-left font-semibold text-[#0091ae] hover:underline cursor-pointer block"
                        >
                          {deal.title}
                        </button>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={`px-1.5 py-0.2 rounded text-[9px] font-semibold border ${priorityMeta.cls}`}>
                            {priorityMeta.short}
                          </span>
                          {deal.isRotting && (
                            <span className="px-1.5 py-0.2 rounded bg-rose-100 text-rose-800 text-[9px] font-semibold">
                              Inativo {deal.daysInactive}d
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-slate-800">
                          {deal.company?.name || 'Empresa B2B'}
                        </div>
                        <div className="text-[10px] font-mono text-slate-500">
                          {deal.company?.cnpj || 'CNPJ em validação'}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <select
                          aria-label={`Etapa de ${deal.title}`}
                          value={deal.stageId}
                          onChange={(e) => handleStageChange(deal.id, e.target.value)}
                          className="px-2 py-1 rounded border border-slate-300 bg-white font-semibold text-[#0d2b4e] text-xs"
                        >
                          {stages.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.order}. {s.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-slate-900">
                        {formatBRL(deal.value)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-emerald-700">
                        {formatBRL(mrr)}/mês
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className="px-2 py-0.5 rounded bg-slate-100 font-semibold text-slate-800">
                          {deal.probability}%
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-700">{closeDateStr}</td>
                      <td className="py-2.5 px-3 font-semibold text-slate-800">
                        {deal.ownerName || 'Marcelo Lopes Mira'}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openDealDetail(deal)}
                            className="px-2.5 py-1 rounded bg-[#0d2b4e] hover:bg-[#1e3a6e] text-white font-semibold text-[11px] cursor-pointer"
                          >
                            Abrir / Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleQuickGenerateProposalForDeal(deal)}
                            className="px-2 py-1 rounded bg-orange-50 hover:bg-orange-100 text-[#e05835] border border-orange-200 font-semibold text-[11px] cursor-pointer"
                          >
                            PDF
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODO 3: GRADE COMPACTA (CARDS EXECUTIVOS RESPONSIVOS PARA MOBILE E TABLET) */}
      {viewMode === 'COMPACT_GRID' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filteredDeals.map((deal) => {
            const contractMonths = deal.contractMonths || 24;
            const mrr = deal.mrr || Math.round(deal.value / contractMonths);
            const priorityMeta = getPriorityMeta(deal.priority, deal.value);
            const stObj = stages.find((s) => s.id === deal.stageId);
            return (
              <div
                key={deal.id}
                className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs hover:border-[#0091ae] transition flex flex-col justify-between gap-3"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="px-2 py-0.5 rounded bg-slate-900 text-white text-[10px] font-semibold">
                      {stObj ? `${stObj.order}. ${stObj.name}` : deal.stageName}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${priorityMeta.cls}`}>
                      {priorityMeta.short}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => openDealDetail(deal)}
                    className="text-left font-semibold text-sm text-[#0091ae] hover:underline cursor-pointer block"
                  >
                    {deal.title}
                  </button>
                  <div className="text-xs text-slate-600">
                    <strong>{deal.company?.name || 'Empresa B2B'}</strong>
                    {deal.company?.cnpj ? ` • CNPJ ${deal.company.cnpj}` : ''}
                  </div>
                  <div className="grid grid-cols-3 gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-xs">
                    <div>
                      <span className="text-[10px] text-slate-400 block">Valor TCV</span>
                      <strong className="text-slate-900">{formatBRL(deal.value)}</strong>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block">MRR</span>
                      <strong className="text-emerald-700">{formatBRL(mrr)}</strong>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block">Prob.</span>
                      <strong className="text-[#e05835]">{deal.probability}%</strong>
                    </div>
                  </div>
                </div>
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                  <span className="text-[11px] text-slate-500 truncate">
                    Executivo: <strong>{deal.ownerName || 'Marcelo Mira'}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => openDealDetail(deal)}
                    className="px-3 py-1.5 rounded-lg bg-[#0d2b4e] hover:bg-[#1e3a6e] text-white font-semibold text-xs cursor-pointer shrink-0"
                  >
                    Abrir / Editar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODO 4: CRONOGRAMA / PREVISÃO DE FECHAMENTO (FORECAST TIMELINE) */}
      {viewMode === 'TIMELINE_FORECAST' && (
        <div className="space-y-4">
          {[
            {
              key: 'IMMEDIATE',
              title: '1. Fechamento Prioritário & Curto Prazo (Alta Probabilidade >= 60%)',
              accent: 'border-l-4 border-l-[#ff7a59]',
              items: filteredDeals.filter((d) => d.status === 'OPEN' && d.probability >= 60),
            },
            {
              key: 'MID_TERM',
              title: '2. Qualificação & Proposta em Maturação (Probabilidade < 60%)',
              accent: 'border-l-4 border-l-[#0091ae]',
              items: filteredDeals.filter((d) => d.status === 'OPEN' && d.probability < 60),
            },
            {
              key: 'CLOSED_WON',
              title: '3. Negócios Ganhos & Contratos Ativados (Receita Garantida)',
              accent: 'border-l-4 border-l-emerald-600',
              items: filteredDeals.filter((d) => d.status === 'WON'),
            },
          ].map((bucket) => {
            const bucketTotal = bucket.items.reduce((s, d) => s + d.value, 0);
            const bucketWeighted = bucket.items.reduce((s, d) => s + d.weightedValue, 0);
            return (
              <div
                key={bucket.key}
                className={`bg-white rounded-xl border border-slate-200 p-4 shadow-2xs space-y-3 ${bucket.accent}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">{bucket.title}</h3>
                    <span className="text-xs text-slate-500">
                      {bucket.items.length} negócio(s) nesta janela de previsão
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="px-2.5 py-1 rounded bg-slate-100 font-semibold text-slate-800">
                      TCV: {formatBRL(bucketTotal)}
                    </span>
                    <span className="px-2.5 py-1 rounded bg-orange-50 font-semibold text-[#e05835] border border-orange-200">
                      Forecast Ponderado: {formatBRL(bucketWeighted)}
                    </span>
                  </div>
                </div>
                <div className="divide-y divide-slate-100 text-xs">
                  {bucket.items.map((deal) => (
                    <div
                      key={deal.id}
                      className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div>
                        <button
                          type="button"
                          onClick={() => openDealDetail(deal)}
                          className="font-semibold text-[#0091ae] hover:underline text-left cursor-pointer"
                        >
                          {deal.title}
                        </button>
                        <div className="text-[11px] text-slate-500">
                          {deal.company?.name || 'Empresa B2B'} • Etapa: <strong>{deal.stageName}</strong> • Executivo:{' '}
                          {deal.ownerName || 'Marcelo Lopes Mira'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-semibold text-slate-900">{formatBRL(deal.value)}</span>
                        <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-semibold text-[10px]">
                          {deal.probability}% ({formatBRL(deal.weightedValue)})
                        </span>
                        <button
                          type="button"
                          onClick={() => openDealDetail(deal)}
                          className="px-2.5 py-1 rounded bg-[#0d2b4e] text-white font-semibold text-[11px] cursor-pointer"
                        >
                          Abrir
                        </button>
                      </div>
                    </div>
                  ))}
                  {bucket.items.length === 0 && (
                    <div className="py-4 text-center text-slate-400">
                      Nenhum negócio nesta janela de previsão.
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODO 5: POR EXECUTIVO RESPONSÁVEL OU NÍVEL DE PRIORIDADE */}
      {viewMode === 'BY_OWNER_PRIORITY' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-200 text-xs">
            <span className="font-semibold text-slate-800">
              Agrupamento de Carteira Comercial e Metas:
            </span>
            <div className="inline-flex rounded-lg bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setOwnerPrioritySubMode('OWNER')}
                className={`px-3 py-1 rounded-md font-semibold cursor-pointer ${
                  ownerPrioritySubMode === 'OWNER' ? 'bg-[#0d2b4e] text-white' : 'text-slate-700'
                }`}
              >
                Agrupar por Executivo Responsável
              </button>
              <button
                type="button"
                onClick={() => setOwnerPrioritySubMode('PRIORITY')}
                className={`px-3 py-1 rounded-md font-semibold cursor-pointer ${
                  ownerPrioritySubMode === 'PRIORITY' ? 'bg-[#0d2b4e] text-white' : 'text-slate-700'
                }`}
              >
                Agrupar por Prioridade (Alta / Média / Baixa)
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(ownerPrioritySubMode === 'OWNER'
              ? availableOwners.map((owner) => ({
                  groupKey: owner,
                  groupTitle: `Executivo: ${owner}`,
                  quotaTarget: 500000,
                  items: filteredDeals.filter(
                    (d) => (d.ownerName || 'Marcelo Lopes Mira') === owner
                  ),
                }))
              : [
                  {
                    groupKey: 'ALTA',
                    groupTitle: 'Prioridade Alta (Contas Enterprise & Urgentes)',
                    quotaTarget: 600000,
                    items: filteredDeals.filter(
                      (d) =>
                        (d.priority ||
                          (d.value >= 150000 ? 'ALTA' : d.value >= 60000 ? 'MEDIA' : 'BAIXA')) ===
                        'ALTA'
                    ),
                  },
                  {
                    groupKey: 'MEDIA',
                    groupTitle: 'Prioridade Média (Mid-Market & Expansão)',
                    quotaTarget: 350000,
                    items: filteredDeals.filter(
                      (d) =>
                        (d.priority ||
                          (d.value >= 150000 ? 'ALTA' : d.value >= 60000 ? 'MEDIA' : 'BAIXA')) ===
                        'MEDIA'
                    ),
                  },
                  {
                    groupKey: 'BAIXA',
                    groupTitle: 'Prioridade Padrão / Baixa',
                    quotaTarget: 150000,
                    items: filteredDeals.filter(
                      (d) =>
                        (d.priority ||
                          (d.value >= 150000 ? 'ALTA' : d.value >= 60000 ? 'MEDIA' : 'BAIXA')) ===
                        'BAIXA'
                    ),
                  },
                ]
            ).map((grp) => {
              const totalVal = grp.items.reduce((s, d) => s + d.value, 0);
              const pct = Math.min(100, Math.round((totalVal / grp.quotaTarget) * 100));
              return (
                <div
                  key={grp.groupKey}
                  className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs space-y-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-semibold text-[#0d2b4e]">{grp.groupTitle}</h4>
                      <span className="text-[11px] text-slate-500">
                        {grp.items.length} negócio(s) • Carteira: <strong>{formatBRL(totalVal)}</strong>
                      </span>
                    </div>
                    <span className="px-2.5 py-1 rounded bg-emerald-50 text-emerald-800 font-semibold">
                      {pct}% da Meta
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#0091ae] rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                    {grp.items.map((d) => (
                      <div
                        key={d.id}
                        className="py-2 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => openDealDetail(d)}
                            className="font-semibold text-[#0091ae] hover:underline truncate block cursor-pointer"
                          >
                            {d.title}
                          </button>
                          <span className="text-[10px] text-slate-500">
                            {d.company?.name || 'Empresa B2B'} • {d.stageName}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <strong className="text-slate-900">{formatBRL(d.value)}</strong>
                          <button
                            type="button"
                            onClick={() => openDealDetail(d)}
                            className="px-2 py-1 rounded bg-slate-900 text-white font-semibold text-[10px] cursor-pointer"
                          >
                            Abrir
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* CREATE NEW DEAL MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-xl w-full overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-6 py-4 bg-[#1e293b] text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-[#ff7a59]" />
                <div>
                  <h3 className="text-base font-semibold">Criar Novo Negócio no Funil</h3>
                  <p className="text-[11px] text-slate-300">{activePipeline?.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="p-6 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
                  Título da Oportunidade *
                </label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Ex: Banco Inter - Locação Cluster PABX IP + SD-WAN (24m)"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:border-[#ff7a59]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
                    MRR Mensal (R$)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={newMrr}
                    onChange={(e) => {
                      const mrrVal = e.target.value;
                      setNewMrr(mrrVal);
                      const months = Number(newContractMonths) || 24;
                      setNewValue(String((Number(mrrVal) || 0) * months));
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-semibold text-emerald-700 focus:outline-none focus:border-[#ff7a59]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
                    Prazo (Meses)
                  </label>
                  <select
                    value={newContractMonths}
                    onChange={(e) => {
                      const mStr = e.target.value;
                      setNewContractMonths(mStr);
                      const months = Number(mStr) || 24;
                      setNewValue(String((Number(newMrr) || 0) * months));
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:border-[#ff7a59]"
                  >
                    <option value="12">12 meses</option>
                    <option value="24">24 meses</option>
                    <option value="36">36 meses</option>
                    <option value="48">48 meses</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
                    Valor Total TCV (R$) *
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    step={1000}
                    value={newValue}
                    onChange={(e) => {
                      const tcvStr = e.target.value;
                      setNewValue(tcvStr);
                      const months = Math.max(1, Number(newContractMonths) || 24);
                      setNewMrr(String(Math.round((Number(tcvStr) || 0) / months)));
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-semibold text-slate-900 focus:outline-none focus:border-[#ff7a59]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
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

                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
                    Tipo de Negócio (Seta Telecom)
                  </label>
                  <select
                    value={newDealType}
                    onChange={(e) => setNewDealType(e.target.value as DealBusinessType)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:border-[#ff7a59]"
                  >
                    <option value="NEW_BUSINESS">Novo Negócio B2B</option>
                    <option value="LOCACAO_RECORRENTE">Locação Recorrente (0% ISS — SV 31)</option>
                    <option value="UPSELL_RENOVACAO">Upsell / Renovação Contratual</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
                    Prioridade Comercial
                  </label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as DealPriority)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:border-[#ff7a59]"
                  >
                    <option value="ALTA">Alta Prioridade</option>
                    <option value="MEDIA">Média Prioridade</option>
                    <option value="BAIXA">Baixa Prioridade</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
                    Proprietário (Deal Owner)
                  </label>
                  <select
                    value={newOwnerName}
                    onChange={(e) => setNewOwnerName(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:border-[#ff7a59]"
                  >
                    <option value="Marcelo Lopes Mira">Marcelo Lopes Mira</option>
                    <option value="Evelyn Ternero Seta Telecom">Evelyn Ternero Seta Telecom</option>
                    <option value="Contato Seta Telecom">Contato Seta Telecom</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
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
                  <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
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
                <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
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
                  className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-5 py-2 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-semibold shadow-sm transition disabled:opacity-50 cursor-pointer"
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
          <div className="bg-[#f5f8fa] w-full max-w-6xl h-full shadow-2xl border-l border-[#cbd6e2] flex flex-col overflow-hidden">
            <div className="px-6 py-4 bg-[#213343] text-white flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-[#ff7a59] text-white text-[10px] font-semibold uppercase">
                    HUBSPOT DEAL RECORD 360°
                  </span>
                  <span className="text-xs text-[#99acc2]">
                    Pipeline: <strong className="text-white">{activePipeline?.name}</strong>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-emerald-300 text-[10px] font-semibold">
                    TCV: {formatBRL(selectedDeal.value)} • MRR:{" "}
                    {formatBRL(
                      selectedDeal.mrr ||
                        Math.round(selectedDeal.value / (selectedDeal.contractMonths || 24))
                    )}
                    /mês
                  </span>
                </div>
                <h3 className="text-base sm:text-lg font-semibold text-white mt-1 truncate">
                  {selectedDeal.title}
                </h3>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={generatingProposalDealId === selectedDeal.id}
                  onClick={() => handleQuickGenerateProposalForDeal(selectedDeal)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[4px] bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm cursor-pointer"
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
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[4px] bg-[#33475b] hover:bg-[#425b76] text-white text-xs font-semibold cursor-pointer"
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
              <div className="flex items-center justify-between text-[11px] font-semibold text-[#516f90] mb-1.5">
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
                          status: st.isWon ? "WON" : st.isClosed ? "LOST" : "OPEN",
                        });
                      }}
                      className={`px-2.5 py-1.5 rounded-[4px] text-left text-[10px] font-semibold transition cursor-pointer border ${
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
              {/* LEFT PANE: ABOUT THIS DEAL (PROPERTIES) */}
              <div className="lg:col-span-4 space-y-4">
                <div className="bg-white rounded-[6px] border border-[#cbd6e2] p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-[#eaf0f6] pb-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-[#33475b] flex items-center gap-1.5">
                      <Briefcase className="w-3.5 h-3.5 text-[#0091ae]" />
                      Sobre este Negócio (Properties)
                    </h4>
                  </div>

                  <div className="space-y-2.5 text-xs">
                    <div>
                      <label className="block text-[10px] font-semibold uppercase text-[#516f90] mb-0.5">
                        Título do Negócio
                      </label>
                      <input
                        type="text"
                        value={selectedDeal.title}
                        onChange={(e) =>
                          setSelectedDeal({ ...selectedDeal, title: e.target.value })
                        }
                        className="w-full px-2.5 py-1.5 rounded-[4px] border border-[#cbd6e2] font-semibold text-[#33475b]"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold uppercase text-[#516f90] mb-0.5">
                          Valor Total TCV (R$)
                        </label>
                        <input
                          type="number"
                          value={selectedDeal.value}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 0;
                            const months = selectedDeal.contractMonths || 24;
                            setSelectedDeal({
                              ...selectedDeal,
                              value: val,
                              mrr: Math.round(val / months),
                            });
                          }}
                          className="w-full px-2.5 py-1.5 rounded-[4px] border border-[#cbd6e2] font-semibold text-[#33475b]"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-semibold uppercase text-[#516f90] mb-0.5">
                          MRR Mensal (R$)
                        </label>
                        <input
                          type="number"
                          value={
                            selectedDeal.mrr ||
                            Math.round(selectedDeal.value / (selectedDeal.contractMonths || 24))
                          }
                          onChange={(e) => {
                            const mrrVal = Number(e.target.value) || 0;
                            const months = selectedDeal.contractMonths || 24;
                            setSelectedDeal({
                              ...selectedDeal,
                              mrr: mrrVal,
                              value: mrrVal * months,
                            });
                          }}
                          className="w-full px-2.5 py-1.5 rounded-[4px] border border-[#cbd6e2] font-semibold text-emerald-700"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold uppercase text-[#516f90] mb-0.5">
                          Prazo Contratual
                        </label>
                        <select
                          value={String(selectedDeal.contractMonths || 24)}
                          onChange={(e) => {
                            const months = Number(e.target.value) || 24;
                            const mrrVal =
                              selectedDeal.mrr ||
                              Math.round(selectedDeal.value / (selectedDeal.contractMonths || 24));
                            setSelectedDeal({
                              ...selectedDeal,
                              contractMonths: months,
                              value: mrrVal * months,
                            });
                          }}
                          className="w-full px-2.5 py-1.5 rounded-[4px] border border-[#cbd6e2] bg-white font-semibold"
                        >
                          <option value="12">12 meses</option>
                          <option value="24">24 meses</option>
                          <option value="36">36 meses</option>
                          <option value="48">48 meses</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-semibold uppercase text-[#516f90] mb-0.5">
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

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold uppercase text-[#516f90] mb-0.5">
                          Tipo de Negócio
                        </label>
                        <select
                          value={selectedDeal.dealType || "NEW_BUSINESS"}
                          onChange={(e) =>
                            setSelectedDeal({
                              ...selectedDeal,
                              dealType: e.target.value as DealBusinessType,
                            })
                          }
                          className="w-full px-2.5 py-1.5 rounded-[4px] border border-[#cbd6e2] bg-white font-semibold"
                        >
                          <option value="NEW_BUSINESS">Novo Negócio B2B</option>
                          <option value="LOCACAO_RECORRENTE">Locação Recorrente (0% ISS)</option>
                          <option value="UPSELL_RENOVACAO">Upsell / Renovação</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-semibold uppercase text-[#516f90] mb-0.5">
                          Data de Fechamento
                        </label>
                        <input
                          type="date"
                          value={
                            selectedDeal.expectedCloseDate
                              ? selectedDeal.expectedCloseDate.slice(0, 10)
                              : ""
                          }
                          onChange={(e) =>
                            setSelectedDeal({
                              ...selectedDeal,
                              expectedCloseDate: e.target.value
                                ? new Date(e.target.value).toISOString()
                                : null,
                            })
                          }
                          className="w-full px-2.5 py-1.5 rounded-[4px] border border-[#cbd6e2] bg-white font-semibold"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-semibold uppercase text-[#516f90] mb-0.5">
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
                        <option value="Contato Seta Telecom">Contato Seta Telecom</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-1 gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold uppercase text-[#516f90] mb-0.5">
                          Empresa Associada
                        </label>
                        <select
                          value={selectedDeal.companyId || ""}
                          onChange={(e) => {
                            const compId = e.target.value || null;
                            const compObj = companies.find((c) => c.id === compId) || null;
                            setSelectedDeal({
                              ...selectedDeal,
                              companyId: compId,
                              company: compObj,
                            });
                          }}
                          className="w-full px-2.5 py-1.5 rounded-[4px] border border-[#cbd6e2] bg-white font-semibold"
                        >
                          <option value="">Sem empresa vinculada</option>
                          {companies.map((comp) => (
                            <option key={comp.id} value={comp.id}>
                              {comp.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-semibold uppercase text-[#516f90] mb-0.5">
                          Contato Decisor
                        </label>
                        <select
                          value={selectedDeal.contactId || ""}
                          onChange={(e) => {
                            const contId = e.target.value || null;
                            const contObj = contacts.find((c) => c.id === contId) || null;
                            setSelectedDeal({
                              ...selectedDeal,
                              contactId: contId,
                              contact: contObj,
                            });
                          }}
                          className="w-full px-2.5 py-1.5 rounded-[4px] border border-[#cbd6e2] bg-white font-semibold"
                        >
                          <option value="">Sem contato vinculado</option>
                          {contacts.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.firstName} {c.lastName} ({c.email})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-semibold uppercase text-[#516f90] mb-0.5">
                        Observação / Motivo de Ganho ou Perda
                      </label>
                      <input
                        type="text"
                        value={selectedDeal.wonReason || selectedDeal.lostReason || ""}
                        onChange={(e) =>
                          setSelectedDeal({
                            ...selectedDeal,
                            wonReason:
                              selectedDeal.status === "LOST" ? selectedDeal.wonReason : e.target.value,
                            lostReason:
                              selectedDeal.status === "LOST" ? e.target.value : selectedDeal.lostReason,
                          })
                        }
                        placeholder="Ex: Aprovado com isenção de ISS (SV 31 STF) / SLA 24x7"
                        className="w-full px-2.5 py-1.5 rounded-[4px] border border-[#cbd6e2] text-[#33475b]"
                      />
                    </div>

                    <div className="pt-2 flex items-center justify-between gap-2 border-t border-[#eaf0f6]">
                      {onDeleteDeal && (
                        <button
                          type="button"
                          onClick={async () => {
                            await onDeleteDeal(selectedDeal.id);
                            setSelectedDeal(null);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[4px] bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold cursor-pointer"
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
                              dealType: selectedDeal.dealType,
                              ownerName: selectedDeal.ownerName,
                              expectedCloseDate: selectedDeal.expectedCloseDate,
                              companyId: selectedDeal.companyId,
                              contactId: selectedDeal.contactId,
                              wonReason: selectedDeal.wonReason,
                              lostReason: selectedDeal.lostReason,
                              stageId: selectedDeal.stageId,
                            });
                            onShowToast?.("Propriedades do Negócio atualizadas no HubSpot!");
                          }}
                          className="flex-1 py-1.5 rounded-[4px] bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-semibold cursor-pointer"
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
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase text-[#33475b] flex items-center gap-1.5">
                      <MessageSquarePlus className="w-4 h-4 text-[#ff7a59]" />
                      Registrar Atividade no Negócio
                    </span>
                    <div className="flex flex-wrap items-center gap-1">
                      {([
                        { id: "NOTE", label: "Nota" },
                        { id: "CALL", label: "Ligação" },
                        { id: "MEETING", label: "Reunião" },
                        { id: "EMAIL", label: "E-mail" },
                        { id: "TASK", label: "Tarefa" },
                      ] as const).map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setNoteType(t.id)}
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold transition cursor-pointer border ${
                            noteType === t.id
                              ? "bg-[#0091ae] text-white border-[#0091ae]"
                              : "bg-[#f5f8fa] text-[#516f90] border-[#cbd6e2] hover:bg-slate-100"
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    type="text"
                    required
                    value={noteTitle}
                    onChange={(e) => setNoteTitle(e.target.value)}
                    placeholder={`Assunto (${noteType === "CALL" ? "Resumo da ligação" : noteType === "MEETING" ? "Ata da reunião executiva" : noteType === "EMAIL" ? "E-mail enviado ao decisor" : noteType === "TASK" ? "Próxima tarefa comercial" : "Nota comercial / escopo técnico"})`}
                    className="w-full px-3 py-1.5 rounded-[4px] border border-[#cbd6e2] text-xs text-[#33475b]"
                  />
                  <textarea
                    rows={2}
                    value={noteBody}
                    onChange={(e) => setNoteBody(e.target.value)}
                    placeholder="Escreva observações, escopo de ramais/PABX IP, condições de locação ou decisão do cliente..."
                    className="w-full px-3 py-1.5 rounded-[4px] border border-[#cbd6e2] text-xs text-[#33475b]"
                  />
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={savingNote}
                      className="px-4 py-1.5 rounded-[4px] bg-[#213343] hover:bg-[#33475b] text-white text-xs font-semibold transition cursor-pointer"
                    >
                      {savingNote ? "Salvando..." : `Registrar ${noteType} na Timeline`}
                    </button>
                  </div>
                </form>

                <div className="bg-white rounded-[6px] border border-[#cbd6e2] p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eaf0f6] pb-2">
                    <h4 className="text-xs font-semibold uppercase text-[#33475b]">
                      Linha do Tempo de Atividades ({filteredTimeline.length})
                    </h4>
                    <select
                      aria-label="Filtrar Timeline"
                      value={timelineFilterType}
                      onChange={(e) => setTimelineFilterType(e.target.value)}
                      className="text-[10px] font-semibold px-2 py-1 rounded border border-[#cbd6e2] bg-[#f5f8fa] text-[#33475b]"
                    >
                      <option value="ALL">Todas ({dealTimeline.length})</option>
                      <option value="NOTE">Notas</option>
                      <option value="CALL">Ligações</option>
                      <option value="MEETING">Reuniões</option>
                      <option value="EMAIL">E-mails</option>
                      <option value="TASK">Tarefas</option>
                      <option value="STAGE_CHANGE">Mudanças de Etapa</option>
                    </select>
                  </div>

                  {loadingDetail ? (
                    <p className="text-xs text-slate-400">Carregando histórico...</p>
                  ) : filteredTimeline.length === 0 ? (
                    <p className="text-xs text-slate-400">
                      Nenhuma atividade encontrada para este filtro neste negócio.
                    </p>
                  ) : (
                    <div className="space-y-2.5 max-h-[420px] overflow-y-auto">
                      {filteredTimeline.map((evt) => (
                        <div
                          key={evt.id}
                          className="p-3 rounded-[4px] border border-[#cbd6e2] bg-[#f5f8fa] space-y-1"
                        >
                          <div className="flex items-center justify-between text-[10px] text-[#516f90]">
                            <span className="px-1.5 py-0.5 rounded bg-[#e5f8f6] font-semibold text-[#007a6c] border border-[#00bda5]/30">
                              {evt.type}
                            </span>
                            <span>{formatDateTimeBR(evt.createdAt)}</span>
                          </div>
                          <div className="text-xs font-semibold text-[#33475b]">{evt.title}</div>
                          {evt.body && <p className="text-xs text-[#516f90]">{evt.body}</p>}
                          <div className="text-[10px] text-slate-400">Autor: {evt.actor}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT PANE: ASSOCIATIONS, PROPOSALS & RENTAL CONTRACTS */}
              <div className="lg:col-span-3 space-y-4">
                <div className="bg-white rounded-[6px] border border-[#cbd6e2] p-3.5 space-y-2">
                  <div className="text-[10px] font-semibold uppercase text-[#516f90] flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-[#0091ae]" />
                    Empresa Associada
                  </div>
                  <div className="text-xs font-semibold text-[#33475b]">
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
                  <div className="text-[10px] font-semibold uppercase text-[#516f90] flex items-center gap-1">
                    <User className="w-3.5 h-3.5 text-[#0091ae]" />
                    Contato Decisor
                  </div>
                  <div className="text-xs font-semibold text-[#33475b]">
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

                {/* ASSOCIATED COMMERCIAL PROPOSALS (QUOTES) */}
                <div className="bg-white rounded-[6px] border border-[#cbd6e2] p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] font-semibold uppercase text-[#516f90] flex items-center gap-1">
                      <Layers className="w-3.5 h-3.5 text-[#ff7a59]" />
                      Propostas &amp; Orçamentos ({associatedProposals.length})
                    </div>
                  </div>

                  {associatedProposals.length > 0 ? (
                    <div className="space-y-2">
                      {associatedProposals.map((prop) => {
                        const pubUrl = buildPublicProposalUrl(prop);
                        const prtUrl = buildPublicProposalUrl(prop, { autoPrint: true });
                        return (
                          <div
                            key={prop.id}
                            className="p-2.5 rounded-[4px] bg-[#f5f8fa] border border-[#cbd6e2] space-y-1.5 text-[11px]"
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-mono font-semibold text-[#0091ae]">
                                {prop.code}
                              </span>
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-100 text-emerald-800">
                                {prop.status}
                              </span>
                            </div>
                            <div className="font-semibold text-[#33475b] truncate" title={prop.title}>
                              {prop.title}
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-[#516f90]">
                              <span>Mensal: <strong>{formatBRL(prop.monthlyRecurringTotal)}</strong></span>
                              <span>TCV: <strong>{formatBRL(prop.totalContractValue)}</strong></span>
                            </div>
                            <div className="flex items-center gap-1.5 pt-1">
                              <a
                                href={pubUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="flex-1 py-1 px-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-semibold text-center inline-flex items-center justify-center gap-1"
                              >
                                <ExternalLink className="w-2.5 h-2.5" />
                                Abrir
                              </a>
                              <a
                                href={prtUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="flex-1 py-1 px-2 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white text-[10px] font-semibold text-center inline-flex items-center justify-center gap-1"
                              >
                                <Printer className="w-2.5 h-2.5" />
                                PDF
                              </a>
                              <button
                                type="button"
                                onClick={async () => {
                                  const r = await copySignedProposalLink(prop.id);
                                  onShowToast?.(r.ok ? `Link assinado da proposta ${prop.code} copiado!` : r.error);
                                }}
                                title="Copiar link para o cliente"
                                className="p-1 rounded border border-[#cbd6e2] bg-white hover:bg-slate-100 text-[#33475b] cursor-pointer"
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-[11px] text-[#516f90]">
                      Nenhuma proposta vinculada ainda. Gere o orçamento oficial com link PDF abaixo.
                    </p>
                  )}

                  <button
                    type="button"
                    disabled={generatingProposalDealId === selectedDeal.id}
                    onClick={() => handleQuickGenerateProposalForDeal(selectedDeal)}
                    className="w-full py-2 px-3 rounded-[4px] bg-[#1e3a6e] hover:bg-[#162b54] text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5 text-emerald-300" />
                    {generatingProposalDealId === selectedDeal.id
                      ? "Gerando..."
                      : "+ Gerar Nova Proposta + Link PDF"}
                  </button>
                </div>

                {/* ASSOCIATED RENTAL CONTRACTS (ERP GESTÃOCLICK) */}
                <div className="bg-white rounded-[6px] border border-[#cbd6e2] p-3.5 space-y-2">
                  <div className="text-[10px] font-semibold uppercase text-[#516f90] flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    Contratos de Locação ({associatedContracts.length})
                  </div>
                  {associatedContracts.length > 0 ? (
                    <div className="space-y-2">
                      {associatedContracts.map((ctr) => (
                        <div
                          key={ctr.id}
                          className="p-2.5 rounded-[4px] bg-emerald-50/50 border border-emerald-200 space-y-1 text-[11px]"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-semibold text-emerald-800">
                              {ctr.contractNumber}
                            </span>
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-600 text-white">
                              {ctr.status}
                            </span>
                          </div>
                          <div className="font-semibold text-[#33475b] truncate" title={ctr.title}>
                            {ctr.title}
                          </div>
                          <div className="text-[10px] text-[#516f90] flex items-center justify-between">
                            <span>Mensal: <strong>{formatBRL(ctr.monthlyValue)}</strong></span>
                            <span>{ctr.contractMonths}m • {ctr.readjustmentIndex}</span>
                          </div>
                          <div className="text-[9px] text-emerald-800 font-mono">
                            NF-e Remessa: {ctr.remessaNfeNumber} (CFOP {ctr.remessaCfop})
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-[#516f90]">
                      Nenhum contrato de locação ativo para este negócio/empresa.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
