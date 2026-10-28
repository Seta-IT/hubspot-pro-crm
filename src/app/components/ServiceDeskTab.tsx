'use client';

import React, { useEffect, useState } from 'react';
import {
  Ticket,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Plus,
  MessageSquare,
  Lock,
  Send,
  Search,
  LayoutGrid,
  List,
  Building2,
  User,
  ShieldAlert,
  Star,
  X,
  Wrench,
  Cpu,
  FileSignature,
  ExternalLink,
  Trash2,
  Timer,
  Radio,
  Menu,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  LayoutDashboard,
} from 'lucide-react';
import {
  Company,
  Contact,
  Deal,
  ErpRentalContract,
  ErpServiceOrder,
  ServiceTicket,
  TicketCategory,
  TicketChannel,
  TicketPriority,
  TicketSlaStatus,
  TicketStatus,
} from '../../db/types';
import { formatDateTimeBR, formatRelativeDays } from './ui-helpers';
import ClientEmailComposerModal, { ClientEmailInitialPayload } from './ClientEmailComposerModal';
import DataHealthTab from './DataHealthTab';
import { ShieldCheck } from 'lucide-react';

export type TicketsViewMode =
  | 'KANBAN'
  | 'LIST'
  | 'COMPACT_GRID'
  | 'SLA_TIMELINE'
  | 'BY_QUEUE_TECH';

export const TICKETS_VIEW_MODES: Array<{ id: TicketsViewMode; label: string; shortLabel: string }> = [
  { id: 'KANBAN', label: 'Kanban', shortLabel: 'Kanban' },
  { id: 'LIST', label: 'Lista', shortLabel: 'Lista' },
  { id: 'COMPACT_GRID', label: 'Grade Compacta', shortLabel: 'Grade' },
  { id: 'SLA_TIMELINE', label: 'Linha do Tempo SLA (Urgência)', shortLabel: 'Linha SLA' },
  { id: 'BY_QUEUE_TECH', label: 'Por Fila / Técnico', shortLabel: 'Por Fila' },
];

export interface EnrichedServiceTicket extends ServiceTicket {
  contact?: Contact | null;
  company?: Company | null;
  deal?: Deal | null;
  contract?: ErpRentalContract | null;
  serviceOrder?: ErpServiceOrder | null;
  remainingResolutionMinutes?: number;
  remainingFirstResponseMinutes?: number;
  firstResponseMinutesTaken?: number | null;
  resolutionMinutesTaken?: number | null;
}

export interface ServiceDeskKpis {
  totalTickets: number;
  openCount: number;
  criticalCount: number;
  onTrackCount: number;
  atRiskCount: number;
  breachedCount: number;
  slaComplianceRate: number;
  avgFirstResponseMinutes: number;
  avgResolutionMinutes?: number;
  avgCsat: number;
}

export const SETA_NOC_QUEUES = [
  'NOC N1 - Triagem & Monitoramento Zabbix',
  'NOC N2 - Voz SIP, PABX IP & SD-WAN',
  'NOC N3 - Engenharia Core & Entroncamento E1',
  'Field Service - RMA & Substituição de Locação',
  'Financeiro & Faturamento Telecom',
] as const;

interface ServiceDeskTabProps {
  tickets: EnrichedServiceTicket[];
  kpis: ServiceDeskKpis;
  contacts: Contact[];
  companies: Company[];
  rentalContracts?: ErpRentalContract[];
  serviceOrders?: ErpServiceOrder[];
  initialSelectedTicketId?: string | null;
  onClearInitialTicket?: () => void;
  initialMacroTab?: 'OPERATIONS' | 'DASHBOARD_CHAMADOS' | 'DATA_HEALTH_CHAMADOS';
  navigationTrigger?: number;
  openNewTicketTrigger?: number;
  onCreateTicket: (payload: {
    subject: string;
    description: string;
    category: TicketCategory;
    priority: TicketPriority;
    channel: TicketChannel;
    contactId?: string | null;
    companyId?: string | null;
    assignee?: string;
    contractId?: string | null;
    equipmentSerial?: string | null;
  }) => Promise<void>;
  onUpdateTicket: (
    ticketIdOrKey: string,
    patch: Partial<ServiceTicket>
  ) => Promise<void>;
  onDeleteTicket?: (ticketIdOrKey: string) => Promise<void>;
  onCreateOsFromTicket?: (
    ticketIdOrKey: string,
    payload?: { technicianName?: string; description?: string }
  ) => Promise<void>;
  onAddTicketComment: (
    ticketIdOrKey: string,
    payload: {
      author: string;
      authorRole: 'AGENT' | 'CUSTOMER';
      isInternal: boolean;
      body: string;
      newStatus?: TicketStatus;
    }
  ) => Promise<void>;
}

const STATUS_COLUMNS: Array<{ id: TicketStatus; label: string; color: string }> = [
  { id: 'OPEN', label: 'Aberto (Fila NOC N1/N2)', color: 'border-blue-400 bg-blue-50/40' },
  { id: 'IN_PROGRESS', label: 'Em Atendimento NOC / Campo', color: 'border-amber-400 bg-amber-50/40' },
  {
    id: 'WAITING_CUSTOMER',
    label: 'Aguardando Cliente (SLA Pausado)',
    color: 'border-purple-400 bg-purple-50/40',
  },
  { id: 'RESOLVED', label: 'Resolvido / Concluído', color: 'border-emerald-400 bg-emerald-50/40' },
];

function computeLiveSlaCountdown(
  ticket: EnrichedServiceTicket,
  nowMs: number
): {
  slaStatus: TicketSlaStatus;
  label: string;
  shortLabel: string;
  badgeCls: string;
} {
  const createdMs = new Date(ticket.createdAt).getTime() || nowMs;
  const resolveDueMs = new Date(ticket.slaResolutionDueAt).getTime() || nowMs;
  const firstRespDueMs = new Date(ticket.slaFirstResponseDueAt).getTime() || nowMs;

  const formatDuration = (mins: number) => {
    const abs = Math.abs(Math.round(mins));
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    if (h >= 48) {
      const d = Math.floor(h / 24);
      return `${d}d ${h % 24}h`;
    }
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
    const resolvedMs = ticket.resolvedAt ? new Date(ticket.resolvedAt).getTime() : nowMs;
    const takenMins = Math.max(1, Math.round((resolvedMs - createdMs) / 60000));
    const breached = resolvedMs > resolveDueMs;
    return {
      slaStatus: breached ? 'BREACHED' : 'ON_TRACK',
      label: breached
        ? `Resolvido fora do SLA (${formatDuration(takenMins)})`
        : `Cumprido em ${formatDuration(takenMins)}`,
      shortLabel: breached ? `Violado (${formatDuration(takenMins)})` : `SLA OK (${formatDuration(takenMins)})`,
      badgeCls: breached
        ? 'bg-rose-100 text-rose-700 border-rose-300'
        : 'bg-emerald-50 text-emerald-700 border-emerald-200',
    };
  }

  const remainingMs = resolveDueMs - nowMs;
  const remainingMins = Math.round(remainingMs / 60000);
  const totalWindowMs = Math.max(1, resolveDueMs - createdMs);

  if (remainingMs < 0 || (!ticket.firstRespondedAt && nowMs > firstRespDueMs)) {
    return {
      slaStatus: 'BREACHED',
      label: `SLA Violado há ${formatDuration(remainingMins)}`,
      shortLabel: `Violado há ${formatDuration(remainingMins)}`,
      badgeCls: 'bg-rose-100 text-rose-700 border-rose-300',
    };
  }

  if (
    remainingMs <= totalWindowMs * 0.25 ||
    remainingMs <= 60 * 60 * 1000 ||
    (!ticket.firstRespondedAt && firstRespDueMs - nowMs <= 30 * 60 * 1000)
  ) {
    return {
      slaStatus: 'AT_RISK',
      label: `SLA em Risco • ${formatDuration(remainingMins)} restantes`,
      shortLabel: `${formatDuration(remainingMins)} restantes`,
      badgeCls: 'bg-amber-100 text-amber-800 border-amber-300',
    };
  }

  return {
    slaStatus: 'ON_TRACK',
    label: `No Prazo • ${formatDuration(remainingMins)} restantes`,
    shortLabel: `${formatDuration(remainingMins)} restantes`,
    badgeCls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
}

export default function ServiceDeskTab({
  tickets,
  kpis,
  contacts,
  companies,
  rentalContracts = [],
  serviceOrders = [],
  initialSelectedTicketId,
  onClearInitialTicket,
  initialMacroTab,
  navigationTrigger,
  openNewTicketTrigger,
  onCreateTicket,
  onUpdateTicket,
  onDeleteTicket,
  onCreateOsFromTicket,
  onAddTicketComment,
}: ServiceDeskTabProps) {
  const [viewMode, setViewMode] = useState<TicketsViewMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('stihub_tickets_view_mode') as TicketsViewMode | null;
      if (
        saved &&
        ['KANBAN', 'LIST', 'COMPACT_GRID', 'SLA_TIMELINE', 'BY_QUEUE_TECH'].includes(saved)
      ) {
        return saved;
      }
    }
    return 'KANBAN';
  });
  const [mobileStatusFilter, setMobileStatusFilter] = useState<string>('ALL');
  const [chamadosMacroTab, setChamadosMacroTab] = useState<
    'OPERATIONS' | 'DASHBOARD_CHAMADOS' | 'DATA_HEALTH_CHAMADOS'
  >(initialMacroTab || 'OPERATIONS');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chamadosMobileDrawerOpen, setChamadosMobileDrawerOpen] = useState(false);
  const [linkedOsOnlyFilter, setLinkedOsOnlyFilter] = useState(false);
  const [queuesAccordionOpen, setQueuesAccordionOpen] = useState(true);

  useEffect(() => {
    if (initialMacroTab) {
      setChamadosMacroTab(initialMacroTab);
    }
  }, [initialMacroTab, navigationTrigger]);

  useEffect(() => {
    if (openNewTicketTrigger && openNewTicketTrigger > 0) {
      setShowNewModal(true);
    }
  }, [openNewTicketTrigger]);

  const handleSelectTicketViewMode = (mode: TicketsViewMode) => {
    setViewMode(mode);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem('stihub_tickets_view_mode', mode);
      } catch {}
    }
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');
  const [slaFilter, setSlaFilter] = useState<string>('ALL');
  const [queueFilter, setQueueFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(
    initialSelectedTicketId || tickets[0]?.id || null
  );

  useEffect(() => {
    if (initialSelectedTicketId) {
      setChamadosMacroTab('OPERATIONS');
      setSelectedTicketId(initialSelectedTicketId);
      onClearInitialTicket?.();
    }
  }, [initialSelectedTicketId]);

  // Realtime clock for SLA countdowns (updates every 15 seconds)
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 15000);
    return () => clearInterval(interval);
  }, []);

  // Comment composer inside Drawer
  const [commentBody, setCommentBody] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [sendingComment, setSendingComment] = useState(false);
  const [creatingOs, setCreatingOs] = useState(false);
  const [serialDraft, setSerialDraft] = useState('');
  const [editingSerialForId, setEditingSerialForId] = useState<string | null>(null);

  // Create Ticket Modal
  const [showNewModal, setShowNewModal] = useState(false);
  const [emailModalPayload, setEmailModalPayload] = useState<ClientEmailInitialPayload | null>(null);
  const [newSubject, setNewSubject] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState<TicketCategory>('INCIDENT');
  const [newPriority, setNewPriority] = useState<TicketPriority>('HIGH');
  const [newChannel, setNewChannel] = useState<TicketChannel>('WEB_PORTAL');
  const [newContactId, setNewContactId] = useState<string>('');
  const [newAssignee, setNewAssignee] = useState<string>(SETA_NOC_QUEUES[1]);
  const [newContractId, setNewContractId] = useState<string>('');
  const [newEquipmentSerial, setNewEquipmentSerial] = useState<string>('');

  const allQueues = Array.from(
    new Set([...SETA_NOC_QUEUES, ...tickets.map((t) => t.assignee).filter(Boolean)])
  );

  const normTicketStr = (v: unknown) =>
    String(v ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

  const filteredTickets = tickets.filter((t) => {
    if (linkedOsOnlyFilter && !t.serviceOrderId && !t.serviceOrder) return false;
    const liveSla = computeLiveSlaCountdown(t, nowMs);
    if (priorityFilter !== 'ALL' && t.priority !== priorityFilter) return false;
    if (slaFilter !== 'ALL' && liveSla.slaStatus !== slaFilter) return false;
    if (queueFilter !== 'ALL') {
      const qNorm = normTicketStr(queueFilter);
      const aNorm = normTicketStr(t.assignee);
      if (aNorm !== qNorm && !aNorm.includes(qNorm) && !qNorm.includes(aNorm)) {
        return false;
      }
    }
    if (categoryFilter !== 'ALL' && t.category !== categoryFilter) return false;
    if (searchQuery.trim()) {
      const q = normTicketStr(searchQuery);
      const hay = normTicketStr(
        `${t.key} ${t.subject} ${t.company?.name || ''} ${t.company?.cnpj || ''} ${t.equipmentSerial || ''} ${t.assignee || ''} ${t.contact?.firstName || ''} ${t.contact?.lastName || ''}`
      );
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const activeTicket =
    tickets.find((t) => t.id === selectedTicketId || t.key === selectedTicketId) || null;

  useEffect(() => {
    if (activeTicket && editingSerialForId !== activeTicket.id) {
      setSerialDraft(activeTicket.equipmentSerial || '');
      setEditingSerialForId(activeTicket.id);
    }
  }, [activeTicket, editingSerialForId]);

  const getPriorityBadge = (p: TicketPriority) => {
    const map: Record<TicketPriority, { label: string; cls: string }> = {
      CRITICAL: {
        label: 'P1 • Crítica',
        cls: 'bg-rose-100 text-rose-800 border-rose-300',
      },
      HIGH: {
        label: 'P2 • Alta',
        cls: 'bg-orange-100 text-[#e05835] border-orange-300',
      },
      MEDIUM: {
        label: 'P3 • Média',
        cls: 'bg-amber-50 text-amber-800 border-amber-200',
      },
      LOW: {
        label: 'P4 • Baixa',
        cls: 'bg-slate-100 text-slate-700 border-slate-200',
      },
    };
    const item = map[p] || map.MEDIUM;
    return (
      <span className={`px-2 py-0.5 rounded-md text-[10px] font-normal border ${item.cls}`}>
        {item.label}
      </span>
    );
  };

  const getCategoryLabel = (cat: TicketCategory) => {
    const map: Record<TicketCategory, string> = {
      INCIDENT: 'Incidente NOC / Link / Voz',
      SUPPORT: 'Suporte Técnico / RMA Locação',
      BUG: 'Falha Core / Entroncamento E1',
      BILLING: 'Faturamento & Contratos SV 31',
      FEATURE_REQUEST: 'Expansão / Mudança de Parque',
    };
    return map[cat] || cat;
  };

  const renderRealtimeSlaBadge = (t: EnrichedServiceTicket, compact = false) => {
    const info = computeLiveSlaCountdown(t, nowMs);
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-normal border ${info.badgeCls}`}
      >
        {info.slaStatus === 'BREACHED' ? (
          <AlertTriangle className="w-3 h-3 shrink-0" />
        ) : info.slaStatus === 'AT_RISK' ? (
          <Timer className="w-3 h-3 shrink-0" />
        ) : (
          <CheckCircle2 className="w-3 h-3 shrink-0" />
        )}
        <span>{compact ? info.shortLabel : info.label}</span>
      </span>
    );
  };

  const handleSendComment = async (newStatusAfterComment?: TicketStatus) => {
    if (!activeTicket || !commentBody.trim()) return;
    setSendingComment(true);
    try {
      await onAddTicketComment(activeTicket.id, {
        author: isInternalNote
          ? `Engenharia ${activeTicket.assignee.split('-')[0].trim()} (Nota Interna)`
          : 'Marcéllo Mira (NOC Seta Telecom)',
        authorRole: 'AGENT',
        isInternal: isInternalNote,
        body: commentBody.trim(),
        newStatus: newStatusAfterComment,
      });
      setCommentBody('');
    } finally {
      setSendingComment(false);
    }
  };

  const handleGenerateOs = async () => {
    if (!activeTicket || !onCreateOsFromTicket) return;
    setCreatingOs(true);
    try {
      await onCreateOsFromTicket(activeTicket.id, {
        technicianName: activeTicket.assignee,
      });
    } finally {
      setCreatingOs(false);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubject.trim()) return;
    const contactObj = contacts.find((c) => c.id === newContactId);
    const contractObj = rentalContracts.find((c) => c.id === newContractId);
    await onCreateTicket({
      subject: newSubject.trim(),
      description: newDesc.trim() || 'Chamado técnico registrado via Console NOC Seta Telecom.',
      category: newCategory,
      priority: newPriority,
      channel: newChannel,
      contactId: newContactId || contractObj?.contactId || null,
      companyId: contactObj?.companyId || contractObj?.companyId || null,
      assignee: newAssignee,
      contractId: newContractId || null,
      equipmentSerial: newEquipmentSerial.trim() || null,
    });
    setNewSubject('');
    setNewDesc('');
    setNewContractId('');
    setNewEquipmentSerial('');
    setShowNewModal(false);
  };

  const linkedContract = activeTicket
    ? activeTicket.contract ||
      rentalContracts.find((c) => c.id === activeTicket.contractId) ||
      null
    : null;

  const linkedServiceOrder = activeTicket
    ? activeTicket.serviceOrder ||
      serviceOrders.find(
        (os) => os.id === activeTicket.serviceOrderId || os.code === activeTicket.serviceOrderId
      ) ||
      null
    : null;

  const renderChamadosSidebarInner = (isMobileDrawer = false) => {
    const closeMobile = () => setChamadosMobileDrawerOpen(false);
    return (
      <>
        <div>
          <div className="px-3 py-2.5 bg-white border-b border-slate-200 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                setChamadosMacroTab('OPERATIONS');
                setLinkedOsOnlyFilter(false);
                closeMobile();
              }}
              className="text-left min-w-0 cursor-pointer group"
            >
              <span className="text-[10px] font-normal uppercase tracking-wider text-[#0d2b4e] group-hover:text-[#ff7a59] transition block truncate">
                MÓDULO CHAMADOS • SERVICE HUB
              </span>
              <span className="text-[10px] text-slate-500 font-normal block truncate">
                NOC 24x7, Filas &amp; RMA Locação
              </span>
            </button>
            {isMobileDrawer ? (
              <button
                type="button"
                onClick={closeMobile}
                aria-label="Fechar Menu Chamados"
                className="p-1.5 rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setSidebarCollapsed((v) => !v)}
                title="Recolher menu lateral de Chamados"
                aria-label="Recolher menu lateral de Chamados"
                className="p-1.5 rounded-md text-slate-500 hover:text-[#0d2b4e] hover:bg-slate-100 transition cursor-pointer shrink-0"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            )}
          </div>

          <nav className="px-2 py-2.5 space-y-3">
            {/* BLOCO 1: VISÃO GERAL */}
            <div className="space-y-0.5">
              <div className="px-2.5 pb-1 text-[9px] font-normal uppercase tracking-wider text-slate-400">
                VISÃO GERAL
              </div>
              <button
                type="button"
                onClick={() => {
                  setChamadosMacroTab('DASHBOARD_CHAMADOS');
                  setLinkedOsOnlyFilter(false);
                  closeMobile();
                }}
                className={`w-full px-2.5 py-2 rounded-md flex items-center justify-between text-[12px] transition cursor-pointer ${
                  chamadosMacroTab === 'DASHBOARD_CHAMADOS'
                    ? 'bg-[#0d2b4e] text-white font-normal shadow-xs'
                    : 'text-[#1e3a6e] hover:bg-white font-normal'
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  <LayoutDashboard
                    className={`w-4 h-4 shrink-0 ${
                      chamadosMacroTab === 'DASHBOARD_CHAMADOS' ? 'text-[#ff7a59]' : 'text-[#1e3a6e]'
                    }`}
                  />
                  <span className="truncate">Dashboard de Chamados &amp; SLA</span>
                </span>
              </button>
            </div>

            {/* BLOCO 2: ATENDIMENTO & FILAS NOC */}
            <div className="space-y-0.5">
              <div className="px-2.5 pb-1 text-[9px] font-normal uppercase tracking-wider text-slate-400">
                ATENDIMENTO &amp; FILAS NOC
              </div>
              <div className="rounded-md">
                <button
                  type="button"
                  onClick={() => {
                    if (chamadosMacroTab === 'OPERATIONS' && !linkedOsOnlyFilter) {
                      setQueuesAccordionOpen((v) => !v);
                    } else {
                      setChamadosMacroTab('OPERATIONS');
                      setLinkedOsOnlyFilter(false);
                      setQueuesAccordionOpen(true);
                    }
                  }}
                  className={`w-full px-2.5 py-2 rounded-md flex items-center justify-between text-[12px] transition cursor-pointer ${
                    chamadosMacroTab === 'OPERATIONS' && !linkedOsOnlyFilter
                      ? 'bg-[#0d2b4e] text-white font-normal shadow-xs'
                      : 'text-[#1e3a6e] hover:bg-white font-normal'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <Ticket
                      className={`w-4 h-4 shrink-0 ${
                        chamadosMacroTab === 'OPERATIONS' && !linkedOsOnlyFilter
                          ? 'text-[#ff7a59]'
                          : 'text-[#1e3a6e]'
                      }`}
                    />
                    <span className="truncate">Fila de Chamados (5 Visões)</span>
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-normal ${
                        chamadosMacroTab === 'OPERATIONS' && !linkedOsOnlyFilter
                          ? 'bg-white/20 text-white'
                          : 'bg-slate-200/80 text-slate-600'
                      }`}
                    >
                      {tickets.length}
                    </span>
                    {queuesAccordionOpen ? (
                      <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                    )}
                  </span>
                </button>

                {queuesAccordionOpen && (
                  <div className="ml-3.5 pl-2.5 my-1 border-l-2 border-[#0d2b4e]/25 space-y-0.5">
                    {[
                      {
                        id: 'ALL',
                        label: 'Todos os Chamados',
                        active:
                          chamadosMacroTab === 'OPERATIONS' &&
                          !linkedOsOnlyFilter &&
                          queueFilter === 'ALL' &&
                          priorityFilter === 'ALL',
                        onClick: () => {
                          setChamadosMacroTab('OPERATIONS');
                          setLinkedOsOnlyFilter(false);
                          setQueueFilter('ALL');
                          setPriorityFilter('ALL');
                          closeMobile();
                        },
                      },
                      {
                        id: 'NOC_24X7',
                        label: 'Fila NOC 24x7 (N1)',
                        active:
                          chamadosMacroTab === 'OPERATIONS' &&
                          queueFilter === SETA_NOC_QUEUES[0],
                        onClick: () => {
                          setChamadosMacroTab('OPERATIONS');
                          setLinkedOsOnlyFilter(false);
                          setQueueFilter(SETA_NOC_QUEUES[0]);
                          setPriorityFilter('ALL');
                          closeMobile();
                        },
                      },
                      {
                        id: 'PABX_VOIP',
                        label: 'PABX/VoIP & SD-WAN (N2)',
                        active:
                          chamadosMacroTab === 'OPERATIONS' &&
                          queueFilter === SETA_NOC_QUEUES[1],
                        onClick: () => {
                          setChamadosMacroTab('OPERATIONS');
                          setLinkedOsOnlyFilter(false);
                          setQueueFilter(SETA_NOC_QUEUES[1]);
                          setPriorityFilter('ALL');
                          closeMobile();
                        },
                      },
                      {
                        id: 'LINKS_SDWAN',
                        label: 'Links & SD-WAN Core (N3)',
                        active:
                          chamadosMacroTab === 'OPERATIONS' &&
                          queueFilter === SETA_NOC_QUEUES[2],
                        onClick: () => {
                          setChamadosMacroTab('OPERATIONS');
                          setLinkedOsOnlyFilter(false);
                          setQueueFilter(SETA_NOC_QUEUES[2]);
                          setPriorityFilter('ALL');
                          closeMobile();
                        },
                      },
                      {
                        id: 'CRITICOS_SLA',
                        label: 'Críticos / SLA (P1)',
                        active:
                          chamadosMacroTab === 'OPERATIONS' &&
                          priorityFilter === 'CRITICAL',
                        onClick: () => {
                          setChamadosMacroTab('OPERATIONS');
                          setLinkedOsOnlyFilter(false);
                          setQueueFilter('ALL');
                          setPriorityFilter('CRITICAL');
                          closeMobile();
                        },
                      },
                    ].map((sub) => (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={sub.onClick}
                        className={`w-full px-2.5 py-1.5 rounded flex items-center justify-between text-xs transition cursor-pointer ${
                          sub.active
                            ? 'bg-orange-50 text-[#0d2b4e] font-normal border-l-2 border-[#ff7a59]'
                            : 'text-slate-600 hover:text-[#0d2b4e] hover:bg-white font-normal'
                        }`}
                      >
                        <span className="truncate">{sub.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  setChamadosMacroTab('OPERATIONS');
                  setLinkedOsOnlyFilter(true);
                  setQueueFilter('ALL');
                  setPriorityFilter('ALL');
                  closeMobile();
                }}
                className={`w-full px-2.5 py-2 rounded-md flex items-center justify-between text-[12px] transition cursor-pointer ${
                  chamadosMacroTab === 'OPERATIONS' && linkedOsOnlyFilter
                    ? 'bg-[#0d2b4e] text-white font-normal shadow-xs'
                    : 'text-[#1e3a6e] hover:bg-white font-normal'
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  <Wrench
                    className={`w-4 h-4 shrink-0 ${
                      chamadosMacroTab === 'OPERATIONS' && linkedOsOnlyFilter
                        ? 'text-[#ff7a59]'
                        : 'text-[#1e3a6e]'
                    }`}
                  />
                  <span className="truncate">Ordens de Serviço Vinculadas</span>
                </span>
                <span
                  className={`px-1.5 py-0.2 rounded text-[10px] font-normal ${
                    chamadosMacroTab === 'OPERATIONS' && linkedOsOnlyFilter
                      ? 'bg-white/20 text-white'
                      : 'bg-slate-200/80 text-slate-600'
                  }`}
                >
                  {serviceOrders.length}
                </span>
              </button>
            </div>

            {/* BLOCO 3: QUALIDADE & AUDITORIA */}
            <div className="space-y-0.5">
              <div className="px-2.5 pb-1 text-[9px] font-normal uppercase tracking-wider text-slate-400">
                QUALIDADE &amp; AUDITORIA
              </div>
              <button
                type="button"
                onClick={() => {
                  setChamadosMacroTab('DATA_HEALTH_CHAMADOS');
                  setLinkedOsOnlyFilter(false);
                  closeMobile();
                }}
                className={`w-full px-2.5 py-2 rounded-md flex items-center justify-between text-[12px] transition cursor-pointer ${
                  chamadosMacroTab === 'DATA_HEALTH_CHAMADOS'
                    ? 'bg-[#0d2b4e] text-white font-normal shadow-xs'
                    : 'text-[#1e3a6e] hover:bg-white font-normal'
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  <ShieldCheck
                    className={`w-4 h-4 shrink-0 ${
                      chamadosMacroTab === 'DATA_HEALTH_CHAMADOS' ? 'text-[#00bda5]' : 'text-emerald-600'
                    }`}
                  />
                  <span className="truncate">Data Health (Chamados)</span>
                </span>
              </button>
            </div>
          </nav>
        </div>

        <div className="p-2.5 border-t border-slate-200 bg-white text-[10px] text-slate-500 space-y-0.5">
          <div className="font-normal text-[#0d2b4e]">CHAMADOS • NOC 24x7</div>
          <div>SLA no Prazo: {kpis.slaComplianceRate}%</div>
          <div>5 Filas Operacionais Telecom</div>
        </div>
      </>
    );
  };

  return (
    <div className="rounded-lg overflow-hidden border border-slate-300 shadow-md bg-[#f3f5f8]">
      {/* BARRA CONTEXTUAL COMPACTA DO SISTEMA 3: CHAMADOS (SEM DUPLICAÇÃO DE TOPO) */}
      <div className="bg-white border-b border-slate-200 px-3 sm:px-4 py-2 flex flex-wrap items-center justify-between gap-2 select-none">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setChamadosMobileDrawerOpen(true)}
            className="md:hidden inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#ff7a59] text-white text-xs font-normal shadow-xs cursor-pointer"
          >
            <Menu className="w-4 h-4" />
            <span>Menu Chamados</span>
          </button>
          <button
            type="button"
            onClick={() => setSidebarCollapsed((v) => !v)}
            className="hidden md:inline-flex p-1.5 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 cursor-pointer"
            title="Recolher/Expandir menu lateral de Chamados"
          >
            <Menu className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => {
                setChamadosMacroTab('OPERATIONS');
                setLinkedOsOnlyFilter(false);
              }}
              className="font-normal text-[#0d2b4e] hover:underline cursor-pointer"
            >
              Chamados (NOC 24x7)
            </button>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-normal text-slate-700">
              {chamadosMacroTab === 'DASHBOARD_CHAMADOS'
                ? 'Visão Geral (Dashboard Chamados)'
                : chamadosMacroTab === 'DATA_HEALTH_CHAMADOS'
                  ? 'Data Health (Chamados)'
                  : linkedOsOnlyFilter
                    ? 'Ordens de Serviço Vinculadas'
                    : 'Operação de Chamados & Filas NOC'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {[
            {
              id: 'OPERATIONS' as const,
              label: `Operação de Chamados & Filas NOC (${tickets.length})`,
            },
            {
              id: 'DASHBOARD_CHAMADOS' as const,
              label: 'Visão Geral (Dashboard Chamados)',
            },
            {
              id: 'DATA_HEALTH_CHAMADOS' as const,
              label: 'Data Health (Chamados)',
            },
          ].map((tab) => {
            const act = chamadosMacroTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setChamadosMacroTab(tab.id);
                  setLinkedOsOnlyFilter(false);
                }}
                className={`px-2.5 py-1.5 rounded-md text-xs font-normal transition cursor-pointer ${
                  act
                    ? 'bg-[#0d2b4e] text-white shadow-2xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {tab.label}
              </button>
            );
          })}

          <a
            href={activeTicket ? `/portal?ticket=${activeTicket.key}` : '/portal'}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-[#0d2b4e] text-xs font-normal border border-slate-300 transition"
          >
            <ExternalLink className="w-3.5 h-3.5 text-[#ff7a59]" />
            <span>Abrir Portal do Cliente ({activeTicket ? activeTicket.key : '/portal'})</span>
          </a>

          <button
            type="button"
            onClick={() => setShowNewModal(true)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-[#ff7a59] hover:bg-[#e05835] text-white text-xs font-normal shadow-2xs transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Abrir Novo Chamado NOC</span>
          </button>
        </div>
      </div>

      {emailModalPayload && (
        <ClientEmailComposerModal
          payload={emailModalPayload}
          onClose={() => setEmailModalPayload(null)}
        />
      )}

      {chamadosMobileDrawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs"
            onClick={() => setChamadosMobileDrawerOpen(false)}
          />
          <aside className="relative z-10 w-72 max-w-[86vw] bg-[#f8f9fb] h-full overflow-y-auto flex flex-col justify-between shadow-2xl select-none">
            {renderChamadosSidebarInner(true)}
          </aside>
        </div>
      )}

      <div className="flex flex-col md:flex-row min-h-[760px]">
        {!sidebarCollapsed && (
          <aside className="hidden md:flex w-60 bg-[#f8f9fb] border-r border-slate-200 shrink-0 flex-col justify-between select-none">
            {renderChamadosSidebarInner(false)}
          </aside>
        )}

        <div className="flex-1 p-4 sm:p-5 space-y-5 overflow-x-hidden">

      {chamadosMacroTab === 'DATA_HEALTH_CHAMADOS' && (
        <DataHealthTab

          contacts={contacts}
          companies={companies}
          tickets={tickets}
          systemScope="chamados"
          initialScope="CHAMADOS"
          loading={false}
          onRefresh={() => {}}
          onMergeDuplicate={async () => {}}
          onAutoClean={async () => null}
          onEnrichEntity={async () => {}}
          onNavigateToContact={() => {}}
        />
      )}

      {chamadosMacroTab === 'DASHBOARD_CHAMADOS' && (
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-normal uppercase tracking-wider text-indigo-700 block">
                  DASHBOARD EXCLUSIVO • SISTEMA 3: CHAMADOS (NOC &amp; SERVICE DESK)
                </span>
                <h3 className="text-base font-semibold text-slate-900">
                  Indicadores de Atendimento, Cumprimento de SLA (FRT/MTTR) e Carga por Fila NOC
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setChamadosMacroTab('OPERATIONS')}
                className="px-3.5 py-2 rounded-xl bg-[#0d2b4e] text-white text-xs font-normal cursor-pointer"
              >
                Ir para Operação de Tickets &rarr;
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 text-xs">
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3">
                <h4 className="text-sm font-semibold text-slate-900">
                  Volume de Chamados por Fila de Atendimento NOC
                </h4>
                <div className="space-y-2.5">
                  {allQueues.map((q) => {
                    const cnt = tickets.filter((t) => t.assignee === q).length;
                    const pct = Math.max(12, Math.round((cnt / Math.max(1, tickets.length)) * 100));
                    return (
                      <div key={q} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-normal text-slate-800">{q}</span>
                          <span className="text-slate-900">{cnt} protocolo(s) ({pct}%)</span>
                        </div>
                        <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#0d2b4e] rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3">
                <h4 className="text-sm font-semibold text-slate-900">
                  Distribuição por Severidade / Prioridade SLA
                </h4>
                <div className="space-y-2.5">
                  {[
                    { key: 'CRITICAL', label: 'P1 • Crítica (SLA 1h / 4h)', color: 'bg-rose-600' },
                    { key: 'HIGH', label: 'P2 • Alta (SLA 2h / 8h)', color: 'bg-orange-500' },
                    { key: 'MEDIUM', label: 'P3 • Média (SLA 4h / 24h)', color: 'bg-amber-500' },
                    { key: 'LOW', label: 'P4 • Baixa (SLA 8h / 48h)', color: 'bg-emerald-600' },
                  ].map((pr) => {
                    const cnt = tickets.filter((t) => t.priority === pr.key).length;
                    const pct = Math.max(8, Math.round((cnt / Math.max(1, tickets.length)) * 100));
                    return (
                      <div key={pr.key} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-normal text-slate-800">{pr.label}</span>
                          <span className="text-slate-900">{cnt} chamado(s)</span>
                        </div>
                        <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${pr.color}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {chamadosMacroTab !== 'DATA_HEALTH_CHAMADOS' && (
        <div className="space-y-6">
      {/* STI-HUB SERVICE MANAGEMENT KPI FLASHCARDS (CLICÁVEIS) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <span className="text-xs font-normal text-slate-500">Chamados em Aberto (NOC)</span>
          <div className="text-2xl font-normal text-slate-900 mt-1">{kpis.openCount}</div>
          <span className="text-[11px] text-slate-500">
            Total histórico: {kpis.totalTickets} protocolos
          </span>
        </div>

        <div className="bg-white rounded-2xl border border-rose-200 p-4 shadow-sm">
          <span className="text-xs font-normal text-rose-700 flex items-center gap-1">
            Incidentes Críticos (P1)
          </span>
          <div className="text-2xl font-normal text-rose-600 mt-1">{kpis.criticalCount}</div>
          <span className="text-[11px] text-rose-700 font-normal">
            {kpis.atRiskCount} em risco • {kpis.breachedCount} violado(s)
          </span>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <span className="text-xs font-normal text-slate-500">Cumprimento de SLA</span>
          <div className="text-2xl font-normal text-emerald-600 mt-1">
            {kpis.slaComplianceRate}%
          </div>
          <span className="text-[11px] text-emerald-700 font-normal">
            Meta Telecom Enterprise: &gt;= 95%
          </span>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <span className="text-xs font-normal text-slate-500">TMA 1ª Resposta (Real)</span>
          <div className="text-2xl font-normal text-slate-900 mt-1">
            {kpis.avgFirstResponseMinutes} min
          </div>
          <span className="text-[11px] text-slate-500">
            TMR Resolução: {kpis.avgResolutionMinutes ?? 120} min
          </span>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <span className="text-xs font-normal text-slate-500 flex items-center gap-1">
            CSAT de Suporte
          </span>
          <div className="text-2xl font-normal text-slate-900 mt-1">{kpis.avgCsat} / 5.0</div>
          <span className="text-[11px] text-emerald-700 font-normal">Avaliação no Portal</span>
        </div>
      </div>

      {/* FILTER & VIEW MODE TOOLBAR */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-60">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar JSM-101, S/N, empresa..."
              className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs bg-slate-50 focus:bg-white focus:outline-none focus:border-[#ff7a59]"
            />
          </div>

          <select
            value={queueFilter}
            onChange={(e) => setQueueFilter(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-normal bg-white text-slate-700"
          >
            <option value="ALL">Todas as Filas NOC Seta</option>
            {allQueues.map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </select>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-normal bg-white text-slate-700"
          >
            <option value="ALL">Todas as Categorias</option>
            <option value="INCIDENT">Incidente NOC / Link / Voz</option>
            <option value="SUPPORT">Suporte / RMA Locação</option>
            <option value="BUG">Engenharia Core / E1</option>
            <option value="BILLING">Faturamento &amp; Contratos</option>
            <option value="FEATURE_REQUEST">Expansão / Mudança</option>
          </select>

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-normal bg-white text-slate-700"
          >
            <option value="ALL">Todas as Prioridades</option>
            <option value="CRITICAL">P1 • Crítica (1h / 4h)</option>
            <option value="HIGH">P2 • Alta (2h / 8h)</option>
            <option value="MEDIUM">P3 • Média (4h / 24h)</option>
            <option value="LOW">P4 • Baixa (8h / 48h)</option>
          </select>

          <select
            value={slaFilter}
            onChange={(e) => setSlaFilter(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-normal bg-white text-slate-700"
          >
            <option value="ALL">Todos os Status de SLA</option>
            <option value="ON_TRACK">No Prazo (ON_TRACK)</option>
            <option value="AT_RISK">Em Risco (AT_RISK)</option>
            <option value="BREACHED">Violado (BREACHED)</option>
          </select>
        </div>

        {/* BARRA CORPORATIVA DE 5 MODOS DE VISUALIZAÇÃO PARA CHAMADOS NOC */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar w-full lg:w-auto pb-0.5">
          <span className="text-[11px] font-normal uppercase tracking-wider text-slate-500 mr-1 shrink-0">
            Visualização:
          </span>
          {TICKETS_VIEW_MODES.map((vm) => {
            const active = viewMode === vm.id;
            return (
              <button
                key={vm.id}
                type="button"
                onClick={() => handleSelectTicketViewMode(vm.id)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-normal transition cursor-pointer border ${
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
      </div>

      {/* MAIN WORKSPACE: 5 VIEW MODES + RIGHT TICKET AGENT DRAWER */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className={activeTicket ? 'xl:col-span-7' : 'xl:col-span-12'}>
          {/* MODO 1: KANBAN POR STATUS DO CHAMADO */}
          {viewMode === 'KANBAN' && (
            <div className="space-y-3">
              {/* Filtro rápido de etapa para celular (< md) */}
              <div className="md:hidden flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                <button
                  type="button"
                  onClick={() => setMobileStatusFilter('ALL')}
                  className={`shrink-0 px-2.5 py-1.5 rounded text-[11px] font-normal cursor-pointer ${
                    mobileStatusFilter === 'ALL'
                      ? 'bg-[#ff7a59] text-white'
                      : 'bg-white border border-slate-200 text-slate-700'
                  }`}
                >
                  Todos ({filteredTickets.length})
                </button>
                {STATUS_COLUMNS.map((col) => {
                  const cnt = filteredTickets.filter((t) =>
                    col.id === 'RESOLVED'
                      ? t.status === 'RESOLVED' || t.status === 'CLOSED'
                      : t.status === col.id
                  ).length;
                  return (
                    <button
                      key={col.id}
                      type="button"
                      onClick={() => setMobileStatusFilter(col.id)}
                      className={`shrink-0 px-2.5 py-1.5 rounded text-[11px] font-normal cursor-pointer ${
                        mobileStatusFilter === col.id
                          ? 'bg-[#0d2b4e] text-white'
                          : 'bg-white border border-slate-200 text-slate-700'
                      }`}
                    >
                      {col.label.split('(')[0].trim()} ({cnt})
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {STATUS_COLUMNS.filter(
                  (col) => mobileStatusFilter === 'ALL' || col.id === mobileStatusFilter
                ).map((col) => {
                  const colTickets = filteredTickets.filter((t) =>
                    col.id === 'RESOLVED'
                      ? t.status === 'RESOLVED' || t.status === 'CLOSED'
                      : t.status === col.id
                  );
                  return (
                    <div
                      key={col.id}
                      className={`rounded-2xl border-t-4 border border-slate-200 p-3 space-y-3 bg-white shadow-sm ${col.color}`}
                    >
                      <div className="flex items-center justify-between px-1">
                        <span className="text-xs font-normal text-slate-800">{col.label}</span>
                        <span className="px-2 py-0.5 rounded-full bg-slate-900 text-white text-[10px] font-normal">
                          {colTickets.length}
                        </span>
                      </div>

                      <div className="space-y-2.5">
                        {colTickets.map((t) => {
                          const isSelected = activeTicket?.id === t.id;
                          return (
                            <div
                              key={t.id}
                              onClick={() => setSelectedTicketId(t.id)}
                              className={`p-3.5 rounded-xl border bg-white cursor-pointer transition space-y-2 ${
                                isSelected
                                  ? 'border-[#ff7a59] ring-2 ring-[#ff7a59]/20 shadow-md'
                                  : 'border-slate-200 hover:border-slate-300 shadow-sm'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-mono text-[11px] font-normal text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                                  {t.key}
                                </span>
                                {getPriorityBadge(t.priority)}
                              </div>

                              <h4 className="text-xs font-semibold text-slate-900 leading-snug">
                                {t.subject}
                              </h4>

                              {t.company && (
                                <div className="flex items-center gap-1.5 text-[11px] text-slate-600 font-normal">
                                  <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                  <span className="truncate">{t.company.name}</span>
                                </div>
                              )}

                              <div className="text-[10px] font-normal text-slate-500 truncate">
                                Fila: {t.assignee}
                              </div>

                              {t.equipmentSerial && (
                                <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px]">
                                  <Cpu className="w-3 h-3 text-slate-500" />
                                  <span className="truncate max-w-[160px]">{t.equipmentSerial}</span>
                                </div>
                              )}

                              <div className="flex items-center justify-between pt-2 border-t border-slate-100 gap-1">
                                {renderRealtimeSlaBadge(t, true)}
                                <select
                                  aria-label={`Mudar status de ${t.key}`}
                                  value={t.status}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => {
                                    e.stopPropagation();
                                    onUpdateTicket(t.id, { status: e.target.value as TicketStatus });
                                  }}
                                  className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-[10px] font-normal text-slate-700"
                                >
                                  <option value="OPEN">Aberto</option>
                                  <option value="IN_PROGRESS">Atendimento</option>
                                  <option value="WAITING_CUSTOMER">Aguardando</option>
                                  <option value="RESOLVED">Resolvido</option>
                                </select>
                              </div>
                            </div>
                          );
                        })}

                        {colTickets.length === 0 && (
                          <div className="py-8 text-center text-xs text-slate-400">
                            Nenhum chamado nesta etapa
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* MODO 2: LISTA CORPORATIVA DENSA (TABELA COM FILA, SLA EM TEMPO REAL E AÇÕES RÁPIDAS) */}
          {viewMode === 'LIST' && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[780px] text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-900 text-[10px] font-normal uppercase text-white">
                      <th className="py-3 px-3">Protocolo</th>
                      <th className="py-3 px-3">Cliente / CNPJ</th>
                      <th className="py-3 px-3">Assunto &amp; Circuito S/N</th>
                      <th className="py-3 px-3">Prioridade</th>
                      <th className="py-3 px-3">Cronômetro SLA</th>
                      <th className="py-3 px-3">Fila / Técnico</th>
                      <th className="py-3 px-3">Status</th>
                      <th className="py-3 px-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {filteredTickets.map((t) => (
                      <tr
                        key={t.id}
                        onClick={() => setSelectedTicketId(t.id)}
                        className={`cursor-pointer transition ${
                          activeTicket?.id === t.id ? 'bg-orange-50/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-3 px-3 font-mono font-normal text-indigo-700">
                          {t.key}
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-normal text-slate-900">
                            {t.company?.name || 'Cliente Seta Telecom'}
                          </div>
                          <div className="text-[10px] font-mono text-slate-500">
                            {t.company?.cnpj || 'CNPJ vinculado'}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-normal text-slate-900">{t.subject}</div>
                          {t.equipmentSerial && (
                            <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px]">
                              S/N: {t.equipmentSerial}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3">{getPriorityBadge(t.priority)}</td>
                        <td className="py-3 px-3">{renderRealtimeSlaBadge(t)}</td>
                        <td className="py-3 px-3 font-normal text-slate-700">{t.assignee}</td>
                        <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                          <select
                            value={t.status}
                            onChange={(e) =>
                              onUpdateTicket(t.id, { status: e.target.value as TicketStatus })
                            }
                            className="px-2 py-1 rounded border border-slate-300 bg-white text-[11px] font-normal text-slate-800"
                          >
                            <option value="OPEN">OPEN</option>
                            <option value="IN_PROGRESS">IN_PROGRESS</option>
                            <option value="WAITING_CUSTOMER">WAITING_CUSTOMER</option>
                            <option value="RESOLVED">RESOLVED</option>
                          </select>
                        </td>
                        <td className="py-3 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => setSelectedTicketId(t.id)}
                            className="px-2.5 py-1 rounded bg-[#0d2b4e] hover:bg-[#1e3a6e] text-white font-normal text-[11px] cursor-pointer"
                          >
                            Atender
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* MODO 3: GRADE COMPACTA (CARDS OTIMIZADOS PARA CELULAR & FIELD SERVICE) */}
          {viewMode === 'COMPACT_GRID' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {filteredTickets.map((t) => (
                <div
                  key={t.id}
                  onClick={() => setSelectedTicketId(t.id)}
                  className={`bg-white rounded-xl border p-4 shadow-2xs cursor-pointer transition flex flex-col justify-between gap-3 ${
                    activeTicket?.id === t.id
                      ? 'border-[#ff7a59] ring-2 ring-[#ff7a59]/20'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-normal text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                        {t.key}
                      </span>
                      {getPriorityBadge(t.priority)}
                    </div>
                    <h4 className="text-xs font-semibold text-slate-900">{t.subject}</h4>
                    <div className="text-[11px] text-slate-600 font-normal">
                      {t.company?.name || 'Cliente Seta Telecom'}
                      {t.equipmentSerial ? ` • S/N ${t.equipmentSerial}` : ''}
                    </div>
                    <div>{renderRealtimeSlaBadge(t)}</div>
                  </div>
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-slate-500 truncate">{t.assignee}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTicketId(t.id);
                      }}
                      className="px-2.5 py-1 rounded bg-[#0d2b4e] text-white font-normal cursor-pointer shrink-0"
                    >
                      Abrir / O.S.
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* MODO 4: LINHA DO TEMPO SLA (AGRUPADO POR URGÊNCIA E VENCIMENTO DO SLA) */}
          {viewMode === 'SLA_TIMELINE' && (
            <div className="space-y-4">
              {[
                {
                  key: 'CRITICAL_SLA',
                  title: '1. SLA Crítico — Violado ou Prestes a Vencer (Ação Imediata NOC)',
                  accent: 'border-l-4 border-l-rose-600',
                  items: filteredTickets.filter((t) => {
                    const sla = computeLiveSlaCountdown(t, nowMs);
                    return (
                      t.status !== 'RESOLVED' &&
                      t.status !== 'CLOSED' &&
                      (sla.slaStatus === 'BREACHED' || sla.slaStatus === 'AT_RISK' || t.priority === 'CRITICAL')
                    );
                  }),
                },
                {
                  key: 'NORMAL_SLA',
                  title: '2. Dentro do Prazo SLA — Operação Normal (N1 / N2 / Campo)',
                  accent: 'border-l-4 border-l-amber-500',
                  items: filteredTickets.filter((t) => {
                    const sla = computeLiveSlaCountdown(t, nowMs);
                    return (
                      t.status !== 'RESOLVED' &&
                      t.status !== 'CLOSED' &&
                      sla.slaStatus === 'ON_TRACK' &&
                      t.priority !== 'CRITICAL'
                    );
                  }),
                },
                {
                  key: 'COMPLETED_SLA',
                  title: '3. Chamados Resolvidos / Concluídos no SLA',
                  accent: 'border-l-4 border-l-emerald-600',
                  items: filteredTickets.filter(
                    (t) => t.status === 'RESOLVED' || t.status === 'CLOSED'
                  ),
                },
              ].map((bucket) => (
                <div
                  key={bucket.key}
                  className={`bg-white rounded-xl border border-slate-200 p-4 shadow-2xs space-y-3 ${bucket.accent}`}
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <h3 className="text-sm font-semibold text-slate-900">{bucket.title}</h3>
                    <span className="px-2.5 py-0.5 rounded-full bg-slate-900 text-white text-xs font-normal">
                      {bucket.items.length} chamado(s)
                    </span>
                  </div>
                  <div className="divide-y divide-slate-100 text-xs">
                    {bucket.items.map((t) => (
                      <div
                        key={t.id}
                        onClick={() => setSelectedTicketId(t.id)}
                        className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer hover:bg-slate-50 px-2 rounded"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-normal text-indigo-700">{t.key}</span>
                            {getPriorityBadge(t.priority)}
                            <span className="text-slate-900">{t.subject}</span>
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {t.company?.name || 'Cliente Seta'} • Fila: {t.assignee}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {renderRealtimeSlaBadge(t)}
                          <button
                            type="button"
                            onClick={() => setSelectedTicketId(t.id)}
                            className="px-2.5 py-1 rounded bg-[#0d2b4e] text-white font-normal text-[11px]"
                          >
                            Atender
                          </button>
                        </div>
                      </div>
                    ))}
                    {bucket.items.length === 0 && (
                      <div className="py-4 text-center text-slate-400">
                        Nenhum chamado nesta faixa de SLA.
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* MODO 5: POR FILA DE ATENDIMENTO (N1 / N2 / N3 / CAMPO) E TÉCNICO */}
          {viewMode === 'BY_QUEUE_TECH' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {allQueues.map((queueName) => {
                const qTickets = filteredTickets.filter((t) => t.assignee === queueName);
                const openCnt = qTickets.filter(
                  (t) => t.status !== 'RESOLVED' && t.status !== 'CLOSED'
                ).length;
                const critCnt = qTickets.filter((t) => t.priority === 'CRITICAL').length;
                return (
                  <div
                    key={queueName}
                    className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs space-y-3 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                      <div>
                        <h4 className="text-sm font-semibold text-[#0d2b4e]">{queueName}</h4>
                        <span className="text-[11px] text-slate-500">
                          {qTickets.length} protocolo(s) • <span>{openCnt} em aberto</span>
                        </span>
                      </div>
                      {critCnt > 0 && (
                        <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-normal text-[10px]">
                          {critCnt} P1 Crítico
                        </span>
                      )}
                    </div>
                    <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                      {qTickets.map((t) => (
                        <div
                          key={t.id}
                          onClick={() => setSelectedTicketId(t.id)}
                          className="py-2 flex items-center justify-between gap-2 cursor-pointer hover:bg-slate-50 px-1 rounded"
                        >
                          <div className="min-w-0">
                            <div className="font-normal text-slate-900 truncate">
                              <span className="font-mono text-indigo-700 mr-1.5">{t.key}</span>
                              {t.subject}
                            </div>
                            <span className="text-[10px] text-slate-500">
                              {t.company?.name || 'Cliente Seta Telecom'} • Status: {t.status}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {renderRealtimeSlaBadge(t, true)}
                          </div>
                        </div>
                      ))}
                      {qTickets.length === 0 && (
                        <div className="py-4 text-center text-slate-400">
                          Sem chamados ativos nesta fila.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT CONSOLE: JIRA SERVICE DESK TICKET CONVERSATION, NOC ROUTING, ERP O.S. & SLA CONTROL */}
        {activeTicket && (
          <div className="xl:col-span-5 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
            {/* Ticket Header */}
            <div className="p-5 bg-slate-900 text-white space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-1 rounded-lg bg-[#ff7a59] text-white font-mono text-xs font-normal">
                    {activeTicket.key}
                  </span>
                  {getPriorityBadge(activeTicket.priority)}
                  {renderRealtimeSlaBadge(activeTicket)}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setEmailModalPayload({
                        docType: 'TICKET_REPLY',
                        recipientEmail: activeTicket.contact?.email || '',
                        recipientName: activeTicket.contact
                          ? `${activeTicket.contact.firstName} ${activeTicket.contact.lastName}`
                          : 'Cliente',
                        companyName: activeTicket.company?.name || 'Cliente Seta Telecom',
                        documentCode: activeTicket.key,
                        ticketId: activeTicket.id,
                      })
                    }
                    className="px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-[10px] font-normal text-white inline-flex items-center gap-1 cursor-pointer"
                  >
                    Enviar E-mail ao Cliente
                  </button>
                  <a
                    href={`/portal?ticket=${activeTicket.key}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Abrir link público do protocolo no Portal do Cliente"
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] font-normal text-emerald-300 inline-flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" /> Portal
                  </a>
                  {onDeleteTicket && (
                    <button
                      type="button"
                      onClick={() => onDeleteTicket(activeTicket.id)}
                      title="Excluir chamado"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelectedTicketId(null)}
                    className="p-1 rounded-lg text-slate-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <h3 className="text-base font-semibold leading-snug">{activeTicket.subject}</h3>

              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300 pt-1">
                {activeTicket.company && (
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-[#ff987f]" />
                    {activeTicket.company.name}
                  </span>
                )}
                {activeTicket.contact && (
                  <span className="inline-flex items-center gap-1">
                    <User className="w-3.5 h-3.5 text-emerald-400" />
                    {activeTicket.contact.firstName} {activeTicket.contact.lastName} (
                    {activeTicket.contact.email})
                  </span>
                )}
              </div>

              {/* Quick Stage Transition Buttons */}
              <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-slate-400">
                  Categoria: <span className="text-white">{getCategoryLabel(activeTicket.category)}</span>
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED'] as TicketStatus[]).map(
                    (st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => onUpdateTicket(activeTicket.id, { status: st })}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-normal transition cursor-pointer ${
                          activeTicket.status === st
                            ? 'bg-emerald-500 text-white'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        {st === 'OPEN'
                          ? 'Aberto'
                          : st === 'IN_PROGRESS'
                            ? 'Em Atendimento'
                            : st === 'WAITING_CUSTOMER'
                              ? 'Aguardar Cliente'
                              : 'Resolver'}
                      </button>
                    )
                  )}
                </div>
              </div>
            </div>

            {/* NOC Routing, Priority, Equipment Serial & ERP Contract/OS Integration Panel */}
            <div className="p-4 bg-slate-50 border-b border-slate-200 space-y-3 text-xs">
              <p className="text-slate-700 leading-relaxed">{activeTicket.description}</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                <div>
                  <label className="block text-[10px] font-normal uppercase text-slate-500 mb-1">
                    Fila NOC / Especialista
                  </label>
                  <select
                    value={activeTicket.assignee}
                    onChange={(e) =>
                      onUpdateTicket(activeTicket.id, { assignee: e.target.value })
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-normal text-slate-800"
                  >
                    {allQueues.map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-normal uppercase text-slate-500 mb-1">
                    Severidade / Prioridade (Recalcula SLA)
                  </label>
                  <select
                    value={activeTicket.priority}
                    onChange={(e) =>
                      onUpdateTicket(activeTicket.id, {
                        priority: e.target.value as TicketPriority,
                      })
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-normal text-slate-800"
                  >
                    <option value="CRITICAL">P1 • Crítica (SLA 1h / 4h)</option>
                    <option value="HIGH">P2 • Alta (SLA 2h / 8h)</option>
                    <option value="MEDIUM">P3 • Média (SLA 4h / 24h)</option>
                    <option value="LOW">P4 • Baixa (SLA 8h / 48h)</option>
                  </select>
                </div>
              </div>

              {/* Equipment Serial & Contract Link */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[10px] font-normal uppercase text-slate-500 mb-1">
                    Serial Number / Circuito Telecom
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={serialDraft}
                      onChange={(e) => setSerialDraft(e.target.value)}
                      placeholder="Ex: SN-FGT100F-BR77410"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-mono text-slate-800"
                    />
                    {serialDraft !== (activeTicket.equipmentSerial || '') && (
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateTicket(activeTicket.id, {
                            equipmentSerial: serialDraft.trim() || null,
                          })
                        }
                        className="px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[10px] font-normal shrink-0 cursor-pointer"
                      >
                        Salvar
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-normal uppercase text-slate-500 mb-1">
                    Contrato de Locação ERP (SV 31)
                  </label>
                  <select
                    value={activeTicket.contractId || ''}
                    onChange={(e) =>
                      onUpdateTicket(activeTicket.id, {
                        contractId: e.target.value || null,
                      })
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-normal text-slate-800"
                  >
                    <option value="">Sem contrato vinculado</option>
                    {rentalContracts.map((ctr) => (
                      <option key={ctr.id} value={ctr.id}>
                        {ctr.contractNumber} — {ctr.companyName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Linked ERP Service Order (O.S.) or Action Button to Generate O.S. */}
              <div className="pt-2 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
                {linkedServiceOrder ? (
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-900 text-xs font-normal">
                    <Wrench className="w-3.5 h-3.5 text-indigo-600" />
                    <span>
                      O.S. GestãoClick Vinculada: <span>#{linkedServiceOrder.code}</span> ({linkedServiceOrder.status})
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={creatingOs}
                    onClick={handleGenerateOs}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0d2b4e] hover:bg-[#1e3a6e] text-white text-xs font-normal shadow-xs transition cursor-pointer disabled:opacity-50"
                  >
                    <Wrench className="w-3.5 h-3.5 text-[#ff7a59]" />
                    {creatingOs ? 'Gerando O.S. no ERP...' : 'Gerar O.S. Técnica (ERP GestãoClick)'}
                  </button>
                )}

                {linkedContract && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-normal text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">
                    <FileSignature className="w-3.5 h-3.5 text-emerald-600" />
                    {linkedContract.contractNumber}
                  </span>
                )}
              </div>

              {/* SLA Timestamps & CSAT Rating for Resolved Tickets */}
              <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-500 pt-1">
                <span>
                  Meta Resolução SLA: <span>{formatDateTimeBR(activeTicket.slaResolutionDueAt)}</span>
                </span>
                <span>Aberto {formatRelativeDays(activeTicket.createdAt)}</span>
              </div>

              {(activeTicket.status === 'RESOLVED' || activeTicket.status === 'CLOSED') && (
                <div className="p-2.5 rounded-xl bg-emerald-50/90 border border-emerald-200 flex items-center justify-between gap-2">
                  <span className="text-xs font-normal text-emerald-900 flex items-center gap-1.5">
                    <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400" />
                    Avaliação CSAT do Cliente:
                  </span>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => onUpdateTicket(activeTicket.id, { csatScore: star })}
                        className={`px-2 py-0.5 rounded text-xs font-normal transition cursor-pointer ${
                          (activeTicket.csatScore || 0) >= star
                            ? 'bg-amber-400 text-slate-950'
                            : 'bg-white border border-slate-200 text-slate-400 hover:text-slate-700'
                        }`}
                      >
                        {star}/5
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Thread of Public Customer Replies & Internal Team Notes */}
            <div className="p-4 space-y-3 max-h-80 overflow-y-auto flex-1">
              <div className="text-[11px] font-normal uppercase tracking-wider text-slate-400">
                Histórico de Atendimento &amp; Notas Internas NOC ({activeTicket.comments.length})
              </div>

              {activeTicket.comments.map((c) => (
                <div
                  key={c.id}
                  className={`p-3.5 rounded-xl border text-xs space-y-1 ${
                    c.isInternal
                      ? 'bg-amber-50/90 border-amber-300 text-amber-950'
                      : c.authorRole === 'CUSTOMER'
                        ? 'bg-slate-100 border-slate-200 text-slate-900'
                        : 'bg-indigo-50/70 border-indigo-200 text-slate-900'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-normal flex items-center gap-1.5">
                      {c.isInternal && <Lock className="w-3.5 h-3.5 text-amber-700" />}
                      {c.author}
                      {c.isInternal && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-200/80 text-amber-900 text-[10px]">
                          Nota Interna NOC (Oculta no Portal)
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {formatDateTimeBR(c.createdAt)}
                    </span>
                  </div>
                  <p className="leading-relaxed">{c.body}</p>
                </div>
              ))}
            </div>

            {/* Agent Composer: Public Reply vs Internal Note */}
            <div className="p-4 border-t border-slate-200 bg-white space-y-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsInternalNote(false)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-normal transition cursor-pointer ${
                    !isInternalNote
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Responder ao Cliente (Visível no Portal)
                </button>
                <button
                  type="button"
                  onClick={() => setIsInternalNote(true)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-normal transition cursor-pointer ${
                    isInternalNote
                      ? 'bg-amber-500 text-white'
                      : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
                  }`}
                >
                  <Lock className="w-3.5 h-3.5" />
                  Nota Interna NOC
                </button>
              </div>

              <textarea
                rows={3}
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder={
                  isInternalNote
                    ? 'Escreva um diagnóstico interno de engenharia NOC/Field Service (invisível para o cliente)...'
                    : 'Escreva a resposta técnica para o cliente (registra 1ª resposta do SLA automaticamente)...'
                }
                className={`w-full px-3 py-2 rounded-xl border text-xs focus:outline-none ${
                  isInternalNote
                    ? 'bg-amber-50/40 border-amber-300 focus:border-amber-500'
                    : 'bg-white border-slate-200 focus:border-indigo-500'
                }`}
              />

              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={sendingComment || !commentBody.trim()}
                  onClick={() => handleSendComment('RESOLVED')}
                  className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-normal transition disabled:opacity-40 cursor-pointer"
                >
                  Enviar &amp; Marcar Resolvido
                </button>

                <button
                  type="button"
                  disabled={sendingComment || !commentBody.trim()}
                  onClick={() => handleSendComment()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#ff7a59] hover:bg-[#e05835] text-white text-xs font-normal transition disabled:opacity-40 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  {isInternalNote ? 'Salvar Nota Interna NOC' : 'Enviar Resposta'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

        </div>
      )}

        </div>
      </div>

      {/* NEW TICKET MODAL */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <Ticket className="w-4 h-4 text-[#ff7a59]" />
                Abrir Novo Chamado no Service Desk (NOC Seta Telecom)
              </h3>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-normal text-slate-700 mb-1">
                  Assunto do Chamado / Incidente Telecom *
                </label>
                <input
                  type="text"
                  required
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  placeholder="Ex: Queda de Tronco SIP / RMA de Gateway PABX IP em Locação"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-normal text-slate-700 mb-1">Categoria</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as TicketCategory)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white"
                  >
                    <option value="INCIDENT">Incidente NOC / Link / Voz</option>
                    <option value="SUPPORT">Suporte Técnico / RMA Locação</option>
                    <option value="BUG">Falha Core / Entroncamento E1</option>
                    <option value="BILLING">Faturamento &amp; Contratos</option>
                    <option value="FEATURE_REQUEST">Expansão / Mudança de Parque</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-normal text-slate-700 mb-1">
                    Prioridade (Define SLA)
                  </label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as TicketPriority)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white"
                  >
                    <option value="CRITICAL">P1 • Crítica (SLA 1h / 4h)</option>
                    <option value="HIGH">P2 • Alta (SLA 2h / 8h)</option>
                    <option value="MEDIUM">P3 • Média (SLA 4h / 24h)</option>
                    <option value="LOW">P4 • Baixa (SLA 8h / 48h)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-normal text-slate-700 mb-1">
                    Cliente / Contato Solicitante
                  </label>
                  <select
                    value={newContactId}
                    onChange={(e) => setNewContactId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white"
                  >
                    <option value="">Selecionar contato...</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.firstName} {c.lastName} ({c.email})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-normal text-slate-700 mb-1">
                    Canal de Entrada
                  </label>
                  <select
                    value={newChannel}
                    onChange={(e) => setNewChannel(e.target.value as TicketChannel)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white"
                  >
                    <option value="WEB_PORTAL">Portal do Cliente (Web)</option>
                    <option value="WHATSAPP">WhatsApp Enterprise NOC</option>
                    <option value="EMAIL">E-mail Suporte</option>
                    <option value="CHAT">Chat In-App</option>
                    <option value="PHONE">Telefone Plantão 0800</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-normal text-slate-700 mb-1">
                  Fila Operacional NOC Seta Telecom
                </label>
                <select
                  value={newAssignee}
                  onChange={(e) => setNewAssignee(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white font-normal"
                >
                  {SETA_NOC_QUEUES.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-normal text-slate-700 mb-1">
                    Contrato de Locação (Opcional)
                  </label>
                  <select
                    value={newContractId}
                    onChange={(e) => setNewContractId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white"
                  >
                    <option value="">Nenhum contrato selecionado</option>
                    {rentalContracts.map((ctr) => (
                      <option key={ctr.id} value={ctr.id}>
                        {ctr.contractNumber} — {ctr.companyName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-normal text-slate-700 mb-1">
                    Serial Number / Circuito
                  </label>
                  <input
                    type="text"
                    value={newEquipmentSerial}
                    onChange={(e) => setNewEquipmentSerial(e.target.value)}
                    placeholder="Ex: SN-SETA-PABX-99812A"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-normal text-slate-700 mb-1">
                  Descrição Técnica Detalhada
                </label>
                <textarea
                  rows={3}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Descreva os sintomas, alarmes Zabbix, logs SIP ou solicitação de RMA..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-normal text-slate-600 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#ff7a59] text-white text-xs font-normal cursor-pointer"
                >
                  Registrar Chamado com SLA
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
