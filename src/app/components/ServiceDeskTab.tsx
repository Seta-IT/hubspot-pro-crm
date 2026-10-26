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
  onCreateTicket,
  onUpdateTicket,
  onDeleteTicket,
  onCreateOsFromTicket,
  onAddTicketComment,
}: ServiceDeskTabProps) {
  const [viewMode, setViewMode] = useState<'KANBAN' | 'QUEUE_LIST'>('KANBAN');
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');
  const [slaFilter, setSlaFilter] = useState<string>('ALL');
  const [queueFilter, setQueueFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(
    tickets[0]?.id || null
  );

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

  const filteredTickets = tickets.filter((t) => {
    const liveSla = computeLiveSlaCountdown(t, nowMs);
    if (priorityFilter !== 'ALL' && t.priority !== priorityFilter) return false;
    if (slaFilter !== 'ALL' && liveSla.slaStatus !== slaFilter) return false;
    if (queueFilter !== 'ALL' && t.assignee !== queueFilter) return false;
    if (categoryFilter !== 'ALL' && t.category !== categoryFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchKey = t.key.toLowerCase().includes(q);
      const matchSub = t.subject.toLowerCase().includes(q);
      const matchComp = t.company?.name.toLowerCase().includes(q);
      const matchSerial = (t.equipmentSerial || '').toLowerCase().includes(q);
      const matchQueue = (t.assignee || '').toLowerCase().includes(q);
      const matchCont = `${t.contact?.firstName || ''} ${t.contact?.lastName || ''}`
        .toLowerCase()
        .includes(q);
      if (!matchKey && !matchSub && !matchComp && !matchCont && !matchSerial && !matchQueue) {
        return false;
      }
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
      <span className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold border ${item.cls}`}>
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
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${info.badgeCls}`}
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

  return (
    <div className="space-y-6">
      {/* TOP BANNER: NOC TELECOM + PORTAL DO CLIENTE LINK */}
      <div className="bg-[#0d2b4e] text-white rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3 border border-[#1e3a6e]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#f26522] flex items-center justify-center text-white shadow-sm shrink-0">
            <Radio className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-extrabold tracking-tight">
                NOC Seta Telecom • Service Desk, Filas N1/N2/N3 &amp; RMA de Locação
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                SLA Dinâmico 24x7 Ativo
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              Integrado aos Contratos de Locação (SV 31 STF), Equipamentos por Serial Number e Ordens de Serviço (O.S.) do GestãoClick ERP.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={activeTicket ? `/portal?ticket=${activeTicket.key}` : '/portal'}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-extrabold border border-white/20 transition"
          >
            <ExternalLink className="w-3.5 h-3.5 text-[#ff987f]" />
            Abrir Portal do Cliente ({activeTicket ? activeTicket.key : '/portal'})
          </a>
          <button
            type="button"
            onClick={() => setShowNewModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#ff7a59] hover:bg-[#e05835] text-white text-xs font-extrabold shadow-sm transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Abrir Novo Chamado NOC
          </button>
        </div>
      </div>

      {emailModalPayload && (
        <ClientEmailComposerModal
          payload={emailModalPayload}
          onClose={() => setEmailModalPayload(null)}
        />
      )}
      {/* STI-HUB SERVICE MANAGEMENT KPI FLASHCARDS (CLICÁVEIS) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <span className="text-xs font-semibold text-slate-500">Chamados em Aberto (NOC)</span>
          <div className="text-2xl font-extrabold text-slate-900 mt-1">{kpis.openCount}</div>
          <span className="text-[11px] text-slate-500">
            Total histórico: {kpis.totalTickets} protocolos
          </span>
        </div>

        <div className="bg-white rounded-2xl border border-rose-200 p-4 shadow-sm">
          <span className="text-xs font-semibold text-rose-700 flex items-center gap-1">
            <ShieldAlert className="w-3.5 h-3.5" /> Incidentes Críticos (P1)
          </span>
          <div className="text-2xl font-extrabold text-rose-600 mt-1">{kpis.criticalCount}</div>
          <span className="text-[11px] text-rose-700 font-semibold">
            {kpis.atRiskCount} em risco • {kpis.breachedCount} violado(s)
          </span>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <span className="text-xs font-semibold text-slate-500">Cumprimento de SLA</span>
          <div className="text-2xl font-extrabold text-emerald-600 mt-1">
            {kpis.slaComplianceRate}%
          </div>
          <span className="text-[11px] text-emerald-700 font-semibold">
            Meta Telecom Enterprise: &gt;= 95%
          </span>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <span className="text-xs font-semibold text-slate-500">TMA 1ª Resposta (Real)</span>
          <div className="text-2xl font-extrabold text-slate-900 mt-1">
            {kpis.avgFirstResponseMinutes} min
          </div>
          <span className="text-[11px] text-slate-500">
            TMR Resolução: {kpis.avgResolutionMinutes ?? 120} min
          </span>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <span className="text-xs font-semibold text-slate-500 flex items-center gap-1">
            <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400" /> CSAT de Suporte
          </span>
          <div className="text-2xl font-extrabold text-slate-900 mt-1">{kpis.avgCsat} / 5.0</div>
          <span className="text-[11px] text-emerald-700 font-semibold">Avaliação no Portal</span>
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
            className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold bg-white text-slate-700"
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
            className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold bg-white text-slate-700"
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
            className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold bg-white text-slate-700"
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
            className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold bg-white text-slate-700"
          >
            <option value="ALL">Todos os Status de SLA</option>
            <option value="ON_TRACK">No Prazo (ON_TRACK)</option>
            <option value="AT_RISK">Em Risco (AT_RISK)</option>
            <option value="BREACHED">Violado (BREACHED)</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setViewMode('KANBAN')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                viewMode === 'KANBAN'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Quadro NOC Kanban
            </button>
            <button
              type="button"
              onClick={() => setViewMode('QUEUE_LIST')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                viewMode === 'QUEUE_LIST'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              Fila SLA (Lista)
            </button>
          </div>
        </div>
      </div>

      {/* MAIN WORKSPACE: KANBAN OR QUEUE LIST + RIGHT TICKET AGENT DRAWER */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className={activeTicket ? 'xl:col-span-7' : 'xl:col-span-12'}>
          {viewMode === 'KANBAN' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {STATUS_COLUMNS.map((col) => {
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
                      <span className="text-xs font-extrabold text-slate-800">{col.label}</span>
                      <span className="px-2 py-0.5 rounded-full bg-slate-900 text-white text-[10px] font-extrabold">
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
                              <span className="font-mono text-[11px] font-extrabold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                                {t.key}
                              </span>
                              {getPriorityBadge(t.priority)}
                            </div>

                            <h4 className="text-xs font-extrabold text-slate-900 leading-snug">
                              {t.subject}
                            </h4>

                            {t.company && (
                              <div className="flex items-center gap-1.5 text-[11px] text-slate-600 font-semibold">
                                <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                <span className="truncate">{t.company.name}</span>
                              </div>
                            )}

                            <div className="text-[10px] font-bold text-slate-500 truncate">
                              🎧 {t.assignee}
                            </div>

                            {t.equipmentSerial && (
                              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px]">
                                <Cpu className="w-3 h-3 text-slate-500" />
                                <span className="truncate max-w-[160px]">{t.equipmentSerial}</span>
                              </div>
                            )}

                            <div className="flex items-center justify-between pt-2 border-t border-slate-100 gap-1">
                              {renderRealtimeSlaBadge(t, true)}
                              <span className="text-[10px] text-slate-400 font-medium shrink-0">
                                {t.comments.length} msg
                              </span>
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
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-extrabold uppercase text-slate-500">
                    <th className="py-3 px-4">Protocolo</th>
                    <th className="py-3 px-4">Assunto, Cliente &amp; Serial</th>
                    <th className="py-3 px-4">Prioridade</th>
                    <th className="py-3 px-4">Cronômetro SLA</th>
                    <th className="py-3 px-4">Fila NOC Responsável</th>
                    <th className="py-3 px-4">Status</th>
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
                      <td className="py-3 px-4 font-mono font-extrabold text-indigo-700">
                        {t.key}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{t.subject}</div>
                        <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-2 mt-0.5">
                          <span>
                            {t.company?.name || 'Sem empresa'} •{' '}
                            {t.contact
                              ? `${t.contact.firstName} ${t.contact.lastName}`
                              : 'Portal'}
                          </span>
                          {t.equipmentSerial && (
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px]">
                              S/N: {t.equipmentSerial}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">{getPriorityBadge(t.priority)}</td>
                      <td className="py-3 px-4">{renderRealtimeSlaBadge(t)}</td>
                      <td className="py-3 px-4 font-semibold text-slate-700">{t.assignee}</td>
                      <td className="py-3 px-4">
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-800">
                          {t.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                  <span className="px-2.5 py-1 rounded-lg bg-[#ff7a59] text-white font-mono text-xs font-extrabold">
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
                    className="px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-[10px] font-extrabold text-white inline-flex items-center gap-1 cursor-pointer"
                  >
                    ✉️ Enviar E-mail Cliente
                  </button>
                  <a
                    href={`/portal?ticket=${activeTicket.key}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Abrir link público do protocolo no Portal do Cliente"
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-emerald-300 inline-flex items-center gap-1"
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

              <h3 className="text-base font-extrabold leading-snug">{activeTicket.subject}</h3>

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
                  Categoria: <strong className="text-white">{getCategoryLabel(activeTicket.category)}</strong>
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED'] as TicketStatus[]).map(
                    (st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => onUpdateTicket(activeTicket.id, { status: st })}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold transition cursor-pointer ${
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
                  <label className="block text-[10px] font-extrabold uppercase text-slate-500 mb-1">
                    Fila NOC / Especialista
                  </label>
                  <select
                    value={activeTicket.assignee}
                    onChange={(e) =>
                      onUpdateTicket(activeTicket.id, { assignee: e.target.value })
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-800"
                  >
                    {allQueues.map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold uppercase text-slate-500 mb-1">
                    Severidade / Prioridade (Recalcula SLA)
                  </label>
                  <select
                    value={activeTicket.priority}
                    onChange={(e) =>
                      onUpdateTicket(activeTicket.id, {
                        priority: e.target.value as TicketPriority,
                      })
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-800"
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
                  <label className="block text-[10px] font-extrabold uppercase text-slate-500 mb-1">
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
                        className="px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[10px] font-extrabold shrink-0 cursor-pointer"
                      >
                        Salvar
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold uppercase text-slate-500 mb-1">
                    Contrato de Locação ERP (SV 31)
                  </label>
                  <select
                    value={activeTicket.contractId || ''}
                    onChange={(e) =>
                      onUpdateTicket(activeTicket.id, {
                        contractId: e.target.value || null,
                      })
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-800"
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
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-900 text-xs font-bold">
                    <Wrench className="w-3.5 h-3.5 text-indigo-600" />
                    <span>
                      O.S. GestãoClick Vinculada: <strong>#{linkedServiceOrder.code}</strong> ({linkedServiceOrder.status})
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={creatingOs}
                    onClick={handleGenerateOs}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0d2b4e] hover:bg-[#1e3a6e] text-white text-xs font-extrabold shadow-xs transition cursor-pointer disabled:opacity-50"
                  >
                    <Wrench className="w-3.5 h-3.5 text-[#ff7a59]" />
                    {creatingOs ? 'Gerando O.S. no ERP...' : '🔧 Gerar O.S. Técnica (ERP GestãoClick)'}
                  </button>
                )}

                {linkedContract && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">
                    <FileSignature className="w-3.5 h-3.5 text-emerald-600" />
                    {linkedContract.contractNumber}
                  </span>
                )}
              </div>

              {/* SLA Timestamps & CSAT Rating for Resolved Tickets */}
              <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-500 pt-1">
                <span>
                  Meta Resolução SLA: <strong>{formatDateTimeBR(activeTicket.slaResolutionDueAt)}</strong>
                </span>
                <span>Aberto {formatRelativeDays(activeTicket.createdAt)}</span>
              </div>

              {(activeTicket.status === 'RESOLVED' || activeTicket.status === 'CLOSED') && (
                <div className="p-2.5 rounded-xl bg-emerald-50/90 border border-emerald-200 flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold text-emerald-900 flex items-center gap-1.5">
                    <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400" />
                    Avaliação CSAT do Cliente:
                  </span>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => onUpdateTicket(activeTicket.id, { csatScore: star })}
                        className={`px-2 py-0.5 rounded text-xs font-extrabold transition cursor-pointer ${
                          (activeTicket.csatScore || 0) >= star
                            ? 'bg-amber-400 text-slate-950'
                            : 'bg-white border border-slate-200 text-slate-400 hover:text-slate-700'
                        }`}
                      >
                        {star}★
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Thread of Public Customer Replies & Internal Team Notes */}
            <div className="p-4 space-y-3 max-h-80 overflow-y-auto flex-1">
              <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
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
                    <span className="font-extrabold flex items-center gap-1.5">
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
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
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
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
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
                  className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition disabled:opacity-40 cursor-pointer"
                >
                  Enviar &amp; Marcar Resolvido
                </button>

                <button
                  type="button"
                  disabled={sendingComment || !commentBody.trim()}
                  onClick={() => handleSendComment()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#ff7a59] hover:bg-[#e05835] text-white text-xs font-extrabold transition disabled:opacity-40 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  {isInternalNote ? 'Salvar Nota Interna NOC' : 'Enviar Resposta'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* NEW TICKET MODAL */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
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
                <label className="block text-xs font-bold text-slate-700 mb-1">
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
                  <label className="block text-xs font-bold text-slate-700 mb-1">Categoria</label>
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
                  <label className="block text-xs font-bold text-slate-700 mb-1">
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
                  <label className="block text-xs font-bold text-slate-700 mb-1">
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
                  <label className="block text-xs font-bold text-slate-700 mb-1">
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
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Fila Operacional NOC Seta Telecom
                </label>
                <select
                  value={newAssignee}
                  onChange={(e) => setNewAssignee(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white font-semibold"
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
                  <label className="block text-xs font-bold text-slate-700 mb-1">
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
                  <label className="block text-xs font-bold text-slate-700 mb-1">
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
                <label className="block text-xs font-bold text-slate-700 mb-1">
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
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#ff7a59] text-white text-xs font-bold cursor-pointer"
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
