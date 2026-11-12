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
  Search,
  MoreHorizontal,
  CheckSquare,
  CalendarPlus,
} from 'lucide-react';
import { Company, Contact, Deal, DealBusinessType, DealPriority, ErpCommercialProposal, ErpFinancialEntry, ErpFiscalInvoice, ErpRentalContract, PipelineStage, ServiceTicket, TimelineEvent } from '../../db/types';
import { formatBRL, formatDateTimeBR } from './ui-helpers';
import { buildInternalProposalUrl } from '../lib/proposal-share';
import { recordUpsertedProposal } from '../lib/durable-storage';
import ClientEmailComposerModal, { ClientEmailInitialPayload } from './ClientEmailComposerModal';
import DealRecordDrawer from './DealRecordDrawer';
import { copySignedProposalLink } from '../lib/proposal-link-client';
import { copyInternalProposalLink } from '../lib/internal-proposal-summary';
import { SalesHubProToolsStrip } from './MarketingAndSalesHubSuites';
import PipelineSelect from './PipelineSelect';
import { formatPipelineDisplayName } from '../lib/pipeline-display';
import {
  CloseDateRange,
  DealSortKey,
  PastDateRange,
  compareDealsBySortKey,
  countActiveDealFilters,
  formatDealAgeLabel,
  formatDealPropertyDate,
  isInCloseDateRange,
  isInPastDateRange,
} from '../lib/deals-kanban-format';

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
  tickets?: ServiceTicket[];
  invoices?: ErpFiscalInvoice[];
  financialEntries?: ErpFinancialEntry[];
  canViewChamados?: boolean;
  canViewFinance?: boolean;
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
  onUpdateDeal?: (dealId: string, patch: Record<string, unknown>, options?: { silent?: boolean }) => Promise<void>;
  onDeleteDeal?: (dealId: string) => Promise<void>;
  canEditDeal?: boolean;
  canDeleteDeal?: boolean;
  canSendEmail?: boolean;
  ownerOptions?: Array<{ id: string; name: string }>;
  onNavigateToErp?: () => void;
  onOpenNewProposalFromDeal?: (deal: EnrichedDeal) => void;
  onShowToast?: (msg: string) => void;
  onRefreshAll?: () => Promise<void>;
  /** Nome do usuário autenticado, para a aba salva “Meus negócios”. */
  currentOwnerName?: string | null;
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
  tickets = [],
  invoices = [],
  financialEntries = [],
  canViewChamados = false,
  canViewFinance = false,
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
  canEditDeal = false,
  canDeleteDeal = false,
  canSendEmail = false,
  ownerOptions = [],
  onNavigateToErp,
  onOpenNewProposalFromDeal,
  onShowToast,
  onRefreshAll,
  currentOwnerName = null,
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
  const [savedView, setSavedView] = useState<'MINE' | 'ALL'>('ALL');
  const [sortBy, setSortBy] = useState<DealSortKey>('createdAt');
  const [filterCreatedRange, setFilterCreatedRange] = useState<PastDateRange>('ALL');
  const [filterActivityRange, setFilterActivityRange] = useState<PastDateRange>('ALL');
  const [filterCloseRange, setFilterCloseRange] = useState<CloseDateRange>('ALL');
  const [openChip, setOpenChip] = useState<string | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showSalesTools, setShowSalesTools] = useState(false);
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
          const publicUrl = buildInternalProposalUrl(created);
          const printUrl = buildInternalProposalUrl(created, { autoPrint: true });
          setCreatedProposalBanner({
            dealTitle: deal.title,
            proposal: created,
            publicUrl,
            printUrl,
          });
          onShowToast?.(
            `Proposta ${created.code} gerada! Para enviar ao cliente use "Copiar link para o cliente" (link assinado).`
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

  const ownerMatches = (dealOwnerName: string | undefined, target: string) => {
    const dealOwner = normDealStr(dealOwnerName || '');
    const targetOwner = normDealStr(target);
    if (!targetOwner) return true;
    return (
      dealOwner === targetOwner ||
      (targetOwner.includes('marcelo') && dealOwner.includes('marcelo')) ||
      (targetOwner.includes('evelyn') && dealOwner.includes('evelyn'))
    );
  };

  const filteredDeals = pipelineDeals
    .filter((d) => {
      if (savedView === 'MINE' && currentOwnerName && !ownerMatches(d.ownerName, currentOwnerName)) {
        return false;
      }
      if (filterRottingOnly && !d.isRotting) return false;
      if (filterOwner !== 'ALL' && !ownerMatches(d.ownerName || 'Marcelo Lopes Mira', filterOwner)) {
        return false;
      }
      if (filterPriority !== 'ALL') {
        const effectivePriority =
          d.priority || (d.value >= 150000 ? 'ALTA' : d.value >= 60000 ? 'MEDIA' : 'BAIXA');
        if (effectivePriority !== filterPriority) return false;
      }
      if (!isInPastDateRange(d.createdAt, filterCreatedRange)) return false;
      if (!isInPastDateRange(d.lastActivityAt, filterActivityRange)) return false;
      if (!isInCloseDateRange(d.expectedCloseDate, filterCloseRange)) return false;
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
    })
    .slice()
    .sort((a, b) => compareDealsBySortKey(a, b, sortBy));

  const activeFilterCount = countActiveDealFilters({
    searchQuery,
    filterOwner,
    filterPriority,
    filterRottingOnly,
    filterCreatedRange,
    filterActivityRange,
    filterCloseRange,
  });

  const clearAllFilters = () => {
    setSearchQuery('');
    setFilterOwner('ALL');
    setFilterPriority('ALL');
    setFilterRottingOnly(false);
    setFilterCreatedRange('ALL');
    setFilterActivityRange('ALL');
    setFilterCloseRange('ALL');
    setOpenChip(null);
    setAdvancedOpen(false);
  };

  const openPlusView = (mode: DealsViewMode | 'TOOLS') => {
    setPlusOpen(false);
    if (mode === 'TOOLS') {
      setShowSalesTools(true);
      return;
    }
    setShowSalesTools(false);
    handleSelectViewMode(mode);
  };

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


  return (
        <div className="space-y-5">
      {emailModalPayload && (
        <ClientEmailComposerModal
          payload={emailModalPayload}
          onClose={() => setEmailModalPayload(null)}
          onSentSuccess={(msg) => {
            onShowToast?.(msg);
            if (onRefreshAll) void onRefreshAll();
          }}
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
              Visualização interna (exige login no STI-hub; para o cliente use o link assinado):{" "}
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
            <button
              type="button"
              data-testid="kanban-copy-internal-link"
              onClick={async () => {
                const url = await copyInternalProposalLink(createdProposalBanner.proposal.id);
                onShowToast?.(url ? "Link interno da proposta copiado." : "Não foi possível copiar o link interno.");
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[4px] border border-white/40 text-white hover:bg-white/10 text-xs font-semibold cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              Copiar link interno
            </button>
            <a
              href={createdProposalBanner.publicUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[4px] bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Abrir proposta
            </a>
            <a
              href={createdProposalBanner.printUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[4px] bg-accent hover:bg-accent-hover text-white text-xs font-semibold"
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
      {showSalesTools && (
        <div className="space-y-2" data-testid="deals-sales-tools-panel">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Ferramentas avançadas de vendas</h2>
            <button
              type="button"
              onClick={() => setShowSalesTools(false)}
              className="text-xs font-semibold text-[#0091ae] hover:underline cursor-pointer"
            >
              Voltar ao quadro
            </button>
          </div>
          <SalesHubProToolsStrip
            onOpenEmailModal={(p) => setEmailModalPayload(p)}
            onShowToast={onShowToast}
          />
        </div>
      )}

      {!showSalesTools && (
      <div className="space-y-3" data-testid="deals-hubspot-chrome">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <h1 className="text-[22px] leading-none font-semibold text-[#33475b]">Negócios</h1>
            <PipelineSelect
              pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))}
              counts={Object.fromEntries(
                pipelines.map((p) => [p.id, deals.filter((d) => d.pipelineId === p.id).length])
              )}
              selectedId={activePipeline?.id || currentPipelineId}
              onChange={handleSelectPipe}
            />
          </div>
          <button
            type="button"
            onClick={() => openCreateDealModal(stages[0]?.id || 'stage-discovery')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[4px] bg-accent hover:bg-accent-hover text-white text-xs font-semibold shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Criar negócio
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#cbd6e2]">
          <div className="flex items-center gap-1" role="tablist" aria-label="Visualizações salvas">
            <button
              type="button"
              role="tab"
              aria-selected={savedView === 'MINE' && (viewMode === 'KANBAN' || viewMode === 'LIST')}
              onClick={() => {
                setSavedView('MINE');
                setShowSalesTools(false);
                if (viewMode !== 'KANBAN' && viewMode !== 'LIST') handleSelectViewMode('KANBAN');
              }}
              className={`px-3 py-2 text-[13px] font-semibold border-b-2 -mb-px cursor-pointer ${
                savedView === 'MINE' && (viewMode === 'KANBAN' || viewMode === 'LIST')
                  ? 'border-[#0091ae] text-[#33475b]'
                  : 'border-transparent text-[#516f90] hover:text-[#33475b]'
              }`}
            >
              Meus negócios
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={savedView === 'ALL' && (viewMode === 'KANBAN' || viewMode === 'LIST')}
              onClick={() => {
                setSavedView('ALL');
                setShowSalesTools(false);
                if (viewMode !== 'KANBAN' && viewMode !== 'LIST') handleSelectViewMode('KANBAN');
              }}
              className={`px-3 py-2 text-[13px] font-semibold border-b-2 -mb-px cursor-pointer ${
                savedView === 'ALL' && (viewMode === 'KANBAN' || viewMode === 'LIST')
                  ? 'border-[#0091ae] text-[#33475b]'
                  : 'border-transparent text-[#516f90] hover:text-[#33475b]'
              }`}
            >
              Todos os negócios
            </button>
            <div className="relative">
              <button
                type="button"
                aria-expanded={plusOpen}
                aria-haspopup="menu"
                aria-label="Mais visualizações"
                onClick={() => setPlusOpen((v) => !v)}
                className={`px-2 py-2 text-[16px] font-semibold border-b-2 -mb-px cursor-pointer ${
                  plusOpen || (!['KANBAN', 'LIST'].includes(viewMode) && !showSalesTools)
                    ? 'border-[#0091ae] text-[#33475b]'
                    : 'border-transparent text-[#516f90] hover:text-[#33475b]'
                }`}
              >
                +
              </button>
              {plusOpen && (
                <ul
                  role="menu"
                  className="absolute left-0 z-30 mt-1 w-64 rounded-[6px] border border-[#cbd6e2] bg-white shadow-lg py-1 text-xs"
                >
                  {DEALS_VIEW_MODES.filter((vm) => vm.id !== 'KANBAN' && vm.id !== 'LIST').map((vm) => (
                    <li key={vm.id} role="none">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => openPlusView(vm.id)}
                        className="w-full text-left px-3 py-2 hover:bg-[#f5f8fa] cursor-pointer"
                      >
                        {vm.label}
                      </button>
                    </li>
                  ))}
                  <li role="none">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => openPlusView('TOOLS')}
                      className="w-full text-left px-3 py-2 hover:bg-[#f5f8fa] cursor-pointer"
                    >
                      Ferramentas avançadas
                    </button>
                  </li>
                </ul>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Pesquisar"
              aria-label="Pesquisar negócios"
              className="w-[180px] pl-7 pr-2 py-1.5 rounded-[4px] border border-[#cbd6e2] text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#0091ae] bg-white"
            />
          </div>
          <span className="inline-flex items-center px-2.5 py-1.5 rounded-[4px] border border-[#cbd6e2] bg-white text-xs font-semibold text-[#33475b]">
            Filtro ({activeFilterCount})
          </span>
          <label className="inline-flex items-center gap-1 text-xs text-[#516f90]">
            <span className="sr-only">Classificar por</span>
            <select
              aria-label="Classificar por"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as DealSortKey)}
              className="px-2 py-1.5 rounded-[4px] border border-[#cbd6e2] bg-white text-xs text-[#33475b] focus:outline-none focus:border-[#0091ae] cursor-pointer"
            >
              <option value="createdAt">Classificar por: Data de criação</option>
              <option value="expectedCloseDate">Classificar por: Data de fechamento</option>
              <option value="lastActivityAt">Classificar por: Última atividade</option>
              <option value="value">Classificar por: Valor</option>
              <option value="title">Classificar por: Nome</option>
            </select>
          </label>

          {[
            { id: 'owner', label: 'Proprietário do negócio', active: filterOwner !== 'ALL' },
            { id: 'created', label: 'Data de criação', active: filterCreatedRange !== 'ALL' },
            { id: 'activity', label: 'Data da última atividade', active: filterActivityRange !== 'ALL' },
            { id: 'close', label: 'Data de fechamento', active: filterCloseRange !== 'ALL' },
          ].map((chip) => (
            <div key={chip.id} className="relative">
              <button
                type="button"
                aria-expanded={openChip === chip.id}
                onClick={() => setOpenChip((c) => (c === chip.id ? null : chip.id))}
                className={`inline-flex items-center px-2.5 py-1.5 rounded-full border text-xs font-semibold cursor-pointer ${
                  chip.active
                    ? 'bg-[#e5f5f8] border-[#0091ae] text-[#33475b]'
                    : 'bg-white border-[#cbd6e2] text-[#516f90] hover:border-[#0091ae]'
                }`}
              >
                {chip.label}
              </button>
              {openChip === chip.id && chip.id === 'owner' && (
                <div className="absolute z-30 mt-1 w-56 rounded-[6px] border border-[#cbd6e2] bg-white shadow-lg p-1">
                  <button type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-[#f5f8fa] cursor-pointer" onClick={() => { setFilterOwner('ALL'); setOpenChip(null); }}>Todos</button>
                  {availableOwners.map((owner) => (
                    <button key={owner} type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-[#f5f8fa] cursor-pointer" onClick={() => { setFilterOwner(owner); setOpenChip(null); }}>{owner}</button>
                  ))}
                </div>
              )}
              {openChip === chip.id && chip.id === 'created' && (
                <div className="absolute z-30 mt-1 w-52 rounded-[6px] border border-[#cbd6e2] bg-white shadow-lg p-1">
                  {([['ALL', 'Qualquer data'], ['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias'], ['YEAR', 'Este ano']] as Array<[PastDateRange, string]>).map(([v, l]) => (
                    <button key={v} type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-[#f5f8fa] cursor-pointer" onClick={() => { setFilterCreatedRange(v); setOpenChip(null); }}>{l}</button>
                  ))}
                </div>
              )}
              {openChip === chip.id && chip.id === 'activity' && (
                <div className="absolute z-30 mt-1 w-52 rounded-[6px] border border-[#cbd6e2] bg-white shadow-lg p-1">
                  {([['ALL', 'Qualquer data'], ['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias'], ['YEAR', 'Este ano']] as Array<[PastDateRange, string]>).map(([v, l]) => (
                    <button key={v} type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-[#f5f8fa] cursor-pointer" onClick={() => { setFilterActivityRange(v); setOpenChip(null); }}>{l}</button>
                  ))}
                </div>
              )}
              {openChip === chip.id && chip.id === 'close' && (
                <div className="absolute z-30 mt-1 w-56 rounded-[6px] border border-[#cbd6e2] bg-white shadow-lg p-1">
                  {([['ALL', 'Qualquer data'], ['NEXT_30', 'Próximos 30 dias'], ['NEXT_90', 'Próximos 90 dias'], ['OVERDUE', 'Atrasados'], ['YEAR', 'Este ano']] as Array<[CloseDateRange, string]>).map(([v, l]) => (
                    <button key={v} type="button" className="w-full text-left px-2 py-1.5 text-xs hover:bg-[#f5f8fa] cursor-pointer" onClick={() => { setFilterCloseRange(v); setOpenChip(null); }}>{l}</button>
                  ))}
                </div>
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={clearAllFilters}
            className="text-xs font-semibold text-[#0091ae] hover:underline cursor-pointer"
          >
            Apagar tudo
          </button>

          <div className="relative">
            <button
              type="button"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((v) => !v)}
              className={`text-xs font-semibold cursor-pointer ${advancedOpen || filterPriority !== 'ALL' || filterRottingOnly ? 'text-[#0091ae]' : 'text-[#516f90] hover:text-[#0091ae]'}`}
            >
              Filtros avançados
            </button>
            {advancedOpen && (
              <div className="absolute z-30 right-0 mt-1 w-64 rounded-[6px] border border-[#cbd6e2] bg-white shadow-lg p-3 space-y-2">
                <label className="block text-[11px] font-semibold text-[#516f90]">Prioridade
                  <select
                    aria-label="Filtrar por Prioridade"
                    value={filterPriority}
                    onChange={(e) => setFilterPriority(e.target.value)}
                    className="mt-1 w-full px-2 py-1.5 rounded border border-[#cbd6e2] text-xs"
                  >
                    <option value="ALL">Todas</option>
                    <option value="ALTA">Alta</option>
                    <option value="MEDIA">Média</option>
                    <option value="BAIXA">Baixa</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => setFilterRottingOnly((v) => !v)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs font-semibold border cursor-pointer ${
                    filterRottingOnly ? 'bg-rose-50 border-rose-200 text-rose-800' : 'border-[#cbd6e2] text-[#33475b]'
                  }`}
                >
                  Apenas estagnados ({pipeRottingCount})
                </button>
              </div>
            )}
          </div>

          <div className="ml-auto inline-flex items-center rounded-[4px] border border-[#cbd6e2] overflow-hidden">
            <button
              type="button"
              aria-pressed={viewMode === 'KANBAN' && !showSalesTools}
              aria-label="Visualização Kanban"
              onClick={() => { setShowSalesTools(false); handleSelectViewMode('KANBAN'); }}
              className={`p-1.5 cursor-pointer ${viewMode === 'KANBAN' && !showSalesTools ? 'bg-[#eaf0f6] text-[#33475b]' : 'bg-white text-[#516f90] hover:bg-[#f5f8fa]'}`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-pressed={viewMode === 'LIST' && !showSalesTools}
              aria-label="Visualização em lista"
              onClick={() => { setShowSalesTools(false); handleSelectViewMode('LIST'); }}
              className={`p-1.5 border-l border-[#cbd6e2] cursor-pointer ${viewMode === 'LIST' && !showSalesTools ? 'bg-[#eaf0f6] text-[#33475b]' : 'bg-white text-[#516f90] hover:bg-[#f5f8fa]'}`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
      )}


      {viewMode === 'KANBAN' && !showSalesTools && (
        <div className="space-y-0" data-testid="deals-kanban-board">
          <div className="overflow-x-auto pb-2">
            <div className="flex gap-2 min-w-full items-stretch">
              {stages.map((stage) => {
                const stageDeals = filteredDeals.filter((d) => d.stageId === stage.id);
                const colTotal = stageDeals.reduce((sum, d) => sum + d.value, 0);
                const colWeighted = Math.round(
                  stageDeals.reduce((sum, d) => sum + d.value * (d.probability / 100), 0)
                );
                const weightedPct = colTotal > 0 ? Math.round((colWeighted / colTotal) * 100) : (stage.defaultProbability || 0);
                const isDragTarget = dragOverStageId === stage.id;
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
                    className={`flex-1 min-w-[148px] max-w-[240px] sm:max-w-none rounded-[4px] bg-[#f5f8fa] border flex flex-col max-h-[min(720px,calc(100vh-260px))] ${
                      isDragTarget ? 'border-accent ring-1 ring-accent/30' : 'border-[#cbd6e2]'
                    }`}
                    data-testid={`deals-kanban-column-${stage.id}`}
                  >
                    <div className="px-2 pt-2 pb-1 bg-transparent shrink-0">
                      <div className="flex items-start justify-between gap-1">
                        <h3 className="text-[12px] font-semibold text-[#33475b] leading-snug" title={stage.name}>
                          {stage.name}
                        </h3>
                        <span className="text-[12px] font-semibold text-[#516f90] tabular-nums shrink-0">{stageDeals.length}</span>
                      </div>
                    </div>

                    <div className="px-1.5 pb-1 space-y-1.5 overflow-y-auto flex-1">
                      {stageDeals.map((deal) => {
                        const isUpdating = updatingDealId === deal.id;
                        const ownerName = deal.ownerName || '—';
                        const closeDateStr = formatDealPropertyDate(deal.expectedCloseDate);
                        const createdStr = formatDealPropertyDate(deal.createdAt);
                        const ageLabel = formatDealAgeLabel(deal.createdAt);
                        const assocName = deal.company?.name || (deal.contact ? `${deal.contact.firstName} ${deal.contact.lastName}` : '');
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
                            data-testid="deals-kanban-card"
                            className={`group relative bg-white rounded-[4px] p-2 border border-[#cbd6e2] shadow-xs hover:shadow-sm transition cursor-grab active:cursor-grabbing ${
                              isUpdating ? 'opacity-60 pointer-events-none' : ''
                            }`}
                          >
                            <div className="flex items-start gap-1.5">
                              <button
                                type="button"
                                onClick={() => openDealDetail(deal)}
                                className="text-left flex-1 min-w-0 cursor-pointer"
                              >
                                <h4 className="text-[13px] font-semibold text-[#0091ae] hover:underline leading-snug break-words">
                                  {deal.title}
                                </h4>
                              </button>
                              {assocName ? (
                                <span
                                  title={assocName}
                                  className="w-5 h-5 rounded-full bg-[#eaf0f6] text-[#33475b] text-[8px] font-semibold inline-flex items-center justify-center shrink-0"
                                  aria-label={deal.company ? `Empresa: ${assocName}` : `Contato: ${assocName}`}
                                >
                                  {deal.company ? <Building2 className="w-3 h-3" /> : getInitials(assocName)}
                                </span>
                              ) : null}
                            </div>

                            <dl className="mt-1.5 space-y-0.5 text-[11px] text-[#516f90]">
                              <div className="flex justify-between gap-1">
                                <dt>Valor</dt>
                                <dd className="font-semibold text-[#33475b]">{formatBRL(deal.value)}</dd>
                              </div>
                              <div className="flex justify-between gap-1">
                                <dt>Data de fechamento</dt>
                                <dd className="text-[#33475b]">{closeDateStr}</dd>
                              </div>
                              <div className="flex justify-between gap-1 min-w-0">
                                <dt className="shrink-0">Proprietário do negócio</dt>
                                <dd className="truncate text-[#33475b] text-right" title={ownerName}>{ownerName}</dd>
                              </div>
                              <div className="flex justify-between gap-1">
                                <dt>Data de criação</dt>
                                <dd className="text-[#33475b]">{createdStr}</dd>
                              </div>
                            </dl>

                            {ageLabel ? (
                              <div className="mt-1">
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-[3px] bg-[#eaf0f6] text-[10px] font-semibold text-[#516f90]">
                                  {ageLabel}
                                </span>
                              </div>
                            ) : null}

                            <div className="mt-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 transition-opacity">
                              <button type="button" title="Observação" aria-label={`Adicionar observação em ${deal.title}`} onClick={() => { setNoteType('NOTE'); openDealDetail(deal); }} className="p-1 rounded text-[#516f90] hover:bg-[#eaf0f6] cursor-pointer">
                                <MessageSquarePlus className="w-3.5 h-3.5" />
                              </button>
                              <button type="button" title="E-mail" aria-label={`Enviar e-mail sobre ${deal.title}`} onClick={() => setEmailModalPayload({ docType: 'PROPOSAL', companyName: deal.company?.name || deal.title, companyCnpj: deal.company?.cnpj || undefined, recipientName: deal.contact ? `${deal.contact.firstName} ${deal.contact.lastName}` : ownerName, recipientEmail: deal.contact?.email || undefined, amountBrl: deal.value, dealId: deal.id, contactId: deal.contactId, companyId: deal.companyId })} className="p-1 rounded text-[#516f90] hover:bg-[#eaf0f6] cursor-pointer">
                                <Mail className="w-3.5 h-3.5" />
                              </button>
                              <button type="button" title="Tarefa" aria-label={`Criar tarefa em ${deal.title}`} onClick={() => { setNoteType('TASK'); openDealDetail(deal); }} className="p-1 rounded text-[#516f90] hover:bg-[#eaf0f6] cursor-pointer">
                                <CheckSquare className="w-3.5 h-3.5" />
                              </button>
                              <button type="button" title="Reunião" aria-label={`Agendar reunião em ${deal.title}`} onClick={() => { setNoteType('MEETING'); openDealDetail(deal); }} className="p-1 rounded text-[#516f90] hover:bg-[#eaf0f6] cursor-pointer">
                                <CalendarPlus className="w-3.5 h-3.5" />
                              </button>
                              <div className="relative ml-auto">
                                <details className="group/more">
                                  <summary className="list-none p-1 rounded text-[#516f90] hover:bg-[#eaf0f6] cursor-pointer" title="Mais ações" aria-label={`Mais ações para ${deal.title}`}>
                                    <MoreHorizontal className="w-3.5 h-3.5" />
                                  </summary>
                                  <div className="absolute right-0 z-20 mt-1 w-44 rounded-[6px] border border-[#cbd6e2] bg-white shadow-lg py-1 text-[11px]">
                                    <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-[#f5f8fa] cursor-pointer" onClick={() => openDealDetail(deal)}>Abrir ficha</button>
                                    <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-[#f5f8fa] cursor-pointer" onClick={() => handleQuickGenerateProposalForDeal(deal)}>Criar proposta</button>
                                    <label className="block px-3 py-1.5 text-[#516f90]">
                                      Mudar etapa
                                      <select
                                        aria-label={`Mudar estágio de ${deal.title}`}
                                        value={deal.stageId}
                                        onChange={(e) => handleStageChange(deal.id, e.target.value)}
                                        className="mt-1 w-full text-[11px] border border-[#cbd6e2] rounded px-1 py-0.5"
                                      >
                                        {stages.map((st) => (
                                          <option key={st.id} value={st.id}>{st.name}</option>
                                        ))}
                                      </select>
                                    </label>
                                  </div>
                                </details>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="px-2 py-1.5 border-t border-[#dfe3eb] bg-[#f5f8fa] rounded-b-[4px] shrink-0 text-[10px] text-[#516f90] space-y-0.5">
                      <div className="flex items-baseline justify-between gap-1">
                        <span className="font-semibold text-[#33475b] tabular-nums truncate">{formatBRL(colTotal)}</span>
                        <span>| Valor total</span>
                      </div>
                      <div className="flex items-baseline justify-between gap-1">
                        <span className="font-semibold text-[#33475b] tabular-nums truncate">{formatBRL(colWeighted)} ({weightedPct}%)</span>
                        <span>| Valor ponderado</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}


      {viewMode === 'LIST' && !showSalesTools && (
        <div className="bg-white rounded-[6px] border border-[#cbd6e2] shadow-2xs overflow-hidden">
          <div className="px-4 py-3 bg-[#f8f9fb] border-b border-[#cbd6e2] flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-accent">
              Visão em Lista Corporativa — {formatPipelineDisplayName(activePipeline?.name)} ({filteredDeals.length} negócios)
            </span>
            <span className="text-slate-500">
              Total Aberto: <strong>{formatBRL(pipeOpenValue)}</strong> • Forecast Ponderado:{' '}
              <strong className="text-accent">{formatBRL(pipeWeightedValue)}</strong>
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
                  <th className="py-2.5 px-3 text-right">Valor mensal</th>
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
                  const closeDateStr = formatDealPropertyDate(deal.expectedCloseDate);
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
                          className="px-2 py-1 rounded border border-slate-300 bg-white text-accent text-xs"
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
                            className="px-2.5 py-1 rounded bg-accent hover:bg-accent-hover text-white font-semibold text-[11px] cursor-pointer"
                          >
                            Abrir
                          </button>
                          <button
                            type="button"
                            onClick={() => handleQuickGenerateProposalForDeal(deal)}
                            className="px-2 py-1 rounded bg-orange-50 hover:bg-orange-100 text-accent border border-orange-200 font-semibold text-[11px] cursor-pointer"
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
      {viewMode === 'COMPACT_GRID' && !showSalesTools && (
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
                      <span className="text-[10px] text-slate-400 block">Valor mensal</span>
                      <strong className="text-emerald-700">{formatBRL(mrr)}</strong>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block">Prob.</span>
                      <strong className="text-accent">{deal.probability}%</strong>
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
                    className="px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white font-semibold text-xs cursor-pointer shrink-0"
                  >
                    Abrir
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODO 4: CRONOGRAMA / PREVISÃO DE FECHAMENTO (FORECAST TIMELINE) */}
      {viewMode === 'TIMELINE_FORECAST' && !showSalesTools && (
        <div className="space-y-4" data-testid="deals-forecast-kpis">
        {/* Forecast Strip (KPIs Dinâmicos do Funil Selecionado + Consolidado Global) */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
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
            className="text-left bg-orange-50/60 hover:bg-orange-100/60 hover:border-accent rounded-xl p-3 border border-orange-200/70 transition cursor-pointer"
          >
            <span className="text-[11px] font-semibold uppercase text-accent block">
              Receita Ponderada (Forecast)
            </span>
            <div className="text-base font-semibold text-accent mt-0.5">
              {formatBRL(pipeWeightedValue)}
            </div>
            <span className="text-[10px] text-accent/80 block mt-0.5">
              Global 3 funis: {formatBRL(forecast.weightedOpenValue)}
            </span>
          </button>
          <div className="text-left bg-sky-50/60 rounded-xl p-3 border border-sky-200/70">
            <span className="text-[11px] font-semibold uppercase text-[#0091ae] block">
              Valor mensal (Funil)
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
              Ganho
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

          {[
            {
              key: 'IMMEDIATE',
              title: '1. Fechamento Prioritário & Curto Prazo (Alta Probabilidade >= 60%)',
              accent: 'border-l-4 border-l-accent',
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
                    <span className="px-2.5 py-1 rounded bg-orange-50 font-semibold text-accent border border-orange-200">
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
                          className="px-2.5 py-1 rounded bg-accent text-white font-semibold text-[11px] cursor-pointer"
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
      {viewMode === 'BY_OWNER_PRIORITY' && !showSalesTools && (
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
                  ownerPrioritySubMode === 'OWNER' ? 'bg-accent text-white' : 'text-slate-700'
                }`}
              >
                Agrupar por Executivo Responsável
              </button>
              <button
                type="button"
                onClick={() => setOwnerPrioritySubMode('PRIORITY')}
                className={`px-3 py-1 rounded-md font-semibold cursor-pointer ${
                  ownerPrioritySubMode === 'PRIORITY' ? 'bg-accent text-white' : 'text-slate-700'
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
                      <h4 className="text-sm font-semibold text-accent">{grp.groupTitle}</h4>
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
      {!showSalesTools && (
        <div className="pt-1 pb-2 text-[13px] text-[#516f90]" data-testid="deals-board-footer">
          {filteredDeals.length} {filteredDeals.length === 1 ? 'negócio' : 'negócios'}
        </div>
      )}

      {showCreateModal && (

        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-xl w-full overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-6 py-4 bg-[#1e293b] text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-accent" />
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
                  Nome do Negócio *
                </label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Ex: Banco Inter - Locação Cluster PABX IP + SD-WAN (24m)"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:border-accent"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
                    Valor mensal
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
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-semibold text-emerald-700 focus:outline-none focus:border-accent"
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
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:border-accent"
                  >
                    <option value="12">12 meses</option>
                    <option value="24">24 meses</option>
                    <option value="36">36 meses</option>
                    <option value="48">48 meses</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
                    Valor total *
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
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-semibold text-slate-900 focus:outline-none focus:border-accent"
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
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:border-accent"
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
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:border-accent"
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
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:border-accent"
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
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:border-accent"
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
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:border-accent"
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
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:border-accent"
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
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:border-accent"
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
                  className="px-5 py-2 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-semibold shadow-sm transition disabled:opacity-50 cursor-pointer"
                >
                  {creating ? 'Salvando...' : 'Criar Negócio'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedDeal && (
        <DealRecordDrawer
          deal={selectedDeal}
          stages={stages}
          pipelineName={activePipeline?.name}
          contacts={contacts}
          companies={companies}
          deals={deals}
          timeline={dealTimeline}
          proposals={associatedProposals}
          contracts={associatedContracts}
          tickets={tickets}
          invoices={invoices}
          financialEntries={financialEntries}
          canViewChamados={canViewChamados}
          canViewFinance={canViewFinance}
          loadingDetail={loadingDetail}
          generatingProposal={generatingProposalDealId === selectedDeal.id}
          onClose={() => setSelectedDeal(null)}
          onChangeDeal={setSelectedDeal}
          onStageChange={handleStageChange}
          onUpdateDeal={onUpdateDeal}
          onDelete={
            canDeleteDeal && onDeleteDeal
              ? async () => {
                  await onDeleteDeal(selectedDeal.id);
                  setSelectedDeal(null);
                }
              : undefined
          }
          canEditDeal={canEditDeal}
          canDeleteDeal={Boolean(canDeleteDeal && onDeleteDeal)}
          canSendEmail={canSendEmail}
          ownerOptions={(() => {
            const map = new Map<string, { id: string; name: string }>();
            for (const o of ownerOptions) map.set(o.id, o);
            for (const name of availableOwners) {
              if (![...map.values()].some((o) => o.name === name)) {
                map.set(name, { id: name, name });
              }
            }
            return Array.from(map.values());
          })()}
          onGenerateProposal={() => handleQuickGenerateProposalForDeal(selectedDeal)}
          onAddNote={async (title, body, type) => {
            await onAddDealNote(selectedDeal.id, title, body, type);
            const res = await fetch(`/api/deals/${selectedDeal.id}`);
            if (res.ok) {
              const json = await res.json();
              setDealTimeline(json.data?.timeline || []);
            }
            setNoteTitle('');
            setNoteBody('');
          }}
          onShowToast={onShowToast}
          onNavigateToErp={
            onNavigateToErp
              ? () => {
                  setSelectedDeal(null);
                  onNavigateToErp();
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
