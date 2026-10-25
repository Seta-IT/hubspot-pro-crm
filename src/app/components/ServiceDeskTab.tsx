'use client';

import React, { useState } from 'react';
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
} from 'lucide-react';
import {
  Company,
  Contact,
  Deal,
  ServiceTicket,
  TicketCategory,
  TicketChannel,
  TicketPriority,
  TicketStatus,
} from '../../db/types';
import { formatDateTimeBR, formatRelativeDays } from './ui-helpers';

export interface EnrichedServiceTicket extends ServiceTicket {
  contact?: Contact | null;
  company?: Company | null;
  deal?: Deal | null;
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
  avgCsat: number;
}

interface ServiceDeskTabProps {
  tickets: EnrichedServiceTicket[];
  kpis: ServiceDeskKpis;
  contacts: Contact[];
  companies: Company[];
  onCreateTicket: (payload: {
    subject: string;
    description: string;
    category: TicketCategory;
    priority: TicketPriority;
    channel: TicketChannel;
    contactId?: string | null;
    companyId?: string | null;
    assignee?: string;
  }) => Promise<void>;
  onUpdateTicket: (
    ticketIdOrKey: string,
    patch: Partial<ServiceTicket>
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
  { id: 'OPEN', label: 'Aberto (Fila N1/N2)', color: 'border-blue-400 bg-blue-50/40' },
  { id: 'IN_PROGRESS', label: 'Em Atendimento Técnico', color: 'border-amber-400 bg-amber-50/40' },
  {
    id: 'WAITING_CUSTOMER',
    label: 'Aguardando Cliente',
    color: 'border-purple-400 bg-purple-50/40',
  },
  { id: 'RESOLVED', label: 'Resolvido / Concluído', color: 'border-emerald-400 bg-emerald-50/40' },
];

export default function ServiceDeskTab({
  tickets,
  kpis,
  contacts,
  companies,
  onCreateTicket,
  onUpdateTicket,
  onAddTicketComment,
}: ServiceDeskTabProps) {
  const [viewMode, setViewMode] = useState<'KANBAN' | 'QUEUE_LIST'>('KANBAN');
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');
  const [slaFilter, setSlaFilter] = useState<string>('ALL');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(
    tickets[0]?.id || null
  );

  // Comment composer inside Drawer
  const [commentBody, setCommentBody] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [sendingComment, setSendingComment] = useState(false);

  // Create Ticket Modal
  const [showNewModal, setShowNewModal] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState<TicketCategory>('INCIDENT');
  const [newPriority, setNewPriority] = useState<TicketPriority>('HIGH');
  const [newChannel, setNewChannel] = useState<TicketChannel>('WEB_PORTAL');
  const [newContactId, setNewContactId] = useState<string>('');
  const [newAssignee, setNewAssignee] = useState('Equipe N2 SRE & Integrações');

  const filteredTickets = tickets.filter((t) => {
    if (priorityFilter !== 'ALL' && t.priority !== priorityFilter) return false;
    if (slaFilter !== 'ALL' && t.slaStatus !== slaFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchKey = t.key.toLowerCase().includes(q);
      const matchSub = t.subject.toLowerCase().includes(q);
      const matchComp = t.company?.name.toLowerCase().includes(q);
      const matchCont = `${t.contact?.firstName || ''} ${t.contact?.lastName || ''}`
        .toLowerCase()
        .includes(q);
      if (!matchKey && !matchSub && !matchComp && !matchCont) return false;
    }
    return true;
  });

  const activeTicket =
    tickets.find((t) => t.id === selectedTicketId || t.key === selectedTicketId) || null;

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

  const getSlaBadge = (sla: ServiceTicket['slaStatus']) => {
    if (sla === 'BREACHED') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-100 text-rose-700 border border-rose-300">
          <AlertTriangle className="w-3 h-3" /> SLA Violado
        </span>
      );
    }
    if (sla === 'AT_RISK') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800 border border-amber-300">
          <Clock className="w-3 h-3" /> SLA em Risco
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200">
        <CheckCircle2 className="w-3 h-3" /> No Prazo (SLA OK)
      </span>
    );
  };

  const handleSendComment = async (newStatusAfterComment?: TicketStatus) => {
    if (!activeTicket || !commentBody.trim()) return;
    setSendingComment(true);
    try {
      await onAddTicketComment(activeTicket.id, {
        author: isInternalNote ? 'Engenharia SRE / CS (Nota Interna)' : 'Marcéllo Mira (Suporte Enterprise)',
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

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubject.trim()) return;
    const contactObj = contacts.find((c) => c.id === newContactId);
    await onCreateTicket({
      subject: newSubject.trim(),
      description: newDesc.trim() || 'Chamado técnico registrado via Service Desk.',
      category: newCategory,
      priority: newPriority,
      channel: newChannel,
      contactId: newContactId || null,
      companyId: contactObj?.companyId || null,
      assignee: newAssignee,
    });
    setNewSubject('');
    setNewDesc('');
    setShowNewModal(false);
  };

  return (
    <div className="space-y-6">
      {/* JIRA SERVICE MANAGEMENT / SERVICE HUB KPI BAR */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <span className="text-xs font-semibold text-slate-500">Chamados em Aberto</span>
          <div className="text-2xl font-extrabold text-slate-900 mt-1">{kpis.openCount}</div>
          <span className="text-[11px] text-slate-500">
            Total histórico: {kpis.totalTickets} tickets
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
            Meta Enterprise: &gt;= 95%
          </span>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <span className="text-xs font-semibold text-slate-500">1ª Resposta Média</span>
          <div className="text-2xl font-extrabold text-slate-900 mt-1">
            {kpis.avgFirstResponseMinutes} min
          </div>
          <span className="text-[11px] text-slate-500">Fila 24x7 N1/N2 SRE</span>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <span className="text-xs font-semibold text-slate-500 flex items-center gap-1">
            <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400" /> CSAT de Suporte
          </span>
          <div className="text-2xl font-extrabold text-slate-900 mt-1">{kpis.avgCsat} / 5.0</div>
          <span className="text-[11px] text-emerald-700 font-semibold">Clientes Enterprise</span>
        </div>
      </div>

      {/* FILTER & VIEW MODE TOOLBAR */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar JSM-101, empresa, assunto..."
              className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs bg-slate-50 focus:bg-white focus:outline-none focus:border-[#ff7a59]"
            />
          </div>

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold bg-white text-slate-700"
          >
            <option value="ALL">Todas as Prioridades</option>
            <option value="CRITICAL">P1 • Crítica</option>
            <option value="HIGH">P2 • Alta</option>
            <option value="MEDIUM">P3 • Média</option>
            <option value="LOW">P4 • Baixa</option>
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
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                viewMode === 'KANBAN'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Quadro JSM Kanban
            </button>
            <button
              type="button"
              onClick={() => setViewMode('QUEUE_LIST')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                viewMode === 'QUEUE_LIST'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              Fila SLA (Lista)
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowNewModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#ff7a59] hover:bg-[#e05835] text-white text-xs font-bold shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            Abrir Novo Chamado
          </button>
        </div>
      </div>

      {/* MAIN WORKSPACE: KANBAN OR QUEUE LIST + RIGHT TICKET AGENT DRAWER */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className={activeTicket ? 'xl:col-span-7' : 'xl:col-span-12'}>
          {viewMode === 'KANBAN' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {STATUS_COLUMNS.map((col) => {
                const colTickets = filteredTickets.filter((t) => t.status === col.id);
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
                                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                                <span className="truncate">{t.company.name}</span>
                              </div>
                            )}

                            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                              {getSlaBadge(t.slaStatus)}
                              <span className="text-[10px] text-slate-400 font-medium">
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
                    <th className="py-3 px-4">Chave JSM</th>
                    <th className="py-3 px-4">Assunto &amp; Cliente</th>
                    <th className="py-3 px-4">Prioridade</th>
                    <th className="py-3 px-4">SLA</th>
                    <th className="py-3 px-4">Fila / Responsável</th>
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
                        <div className="text-[11px] text-slate-500">
                          {t.company?.name || 'Sem empresa'} •{' '}
                          {t.contact
                            ? `${t.contact.firstName} ${t.contact.lastName}`
                            : 'Portal'}
                        </div>
                      </td>
                      <td className="py-3 px-4">{getPriorityBadge(t.priority)}</td>
                      <td className="py-3 px-4">{getSlaBadge(t.slaStatus)}</td>
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

        {/* RIGHT CONSOLE: JIRA SERVICE DESK TICKET CONVERSATION & SLA CONTROL */}
        {activeTicket && (
          <div className="xl:col-span-5 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
            {/* Ticket Header */}
            <div className="p-5 bg-slate-900 text-white space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-lg bg-[#ff7a59] text-white font-mono text-xs font-extrabold">
                    {activeTicket.key}
                  </span>
                  {getPriorityBadge(activeTicket.priority)}
                  {getSlaBadge(activeTicket.slaStatus)}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedTicketId(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
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
                  Fila: <strong className="text-white">{activeTicket.assignee}</strong>
                </span>
                <div className="flex items-center gap-1.5">
                  {(['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED'] as TicketStatus[]).map(
                    (st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => onUpdateTicket(activeTicket.id, { status: st })}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold transition ${
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

            {/* Ticket Description & SLA Timers */}
            <div className="p-4 bg-slate-50 border-b border-slate-200 space-y-2 text-xs">
              <p className="text-slate-700 leading-relaxed">{activeTicket.description}</p>
              <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-500 pt-1">
                <span>
                  Meta Resolução SLA: <strong>{formatDateTimeBR(activeTicket.slaResolutionDueAt)}</strong>
                </span>
                <span>Aberto {formatRelativeDays(activeTicket.createdAt)}</span>
              </div>
            </div>

            {/* Thread of Public Customer Replies & Internal Team Notes */}
            <div className="p-4 space-y-3 max-h-80 overflow-y-auto flex-1">
              <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
                Histórico de Atendimento &amp; Notas Internas ({activeTicket.comments.length})
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
                          Nota Interna SRE/CS
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
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                    !isInternalNote
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Responder ao Cliente (Público)
                </button>
                <button
                  type="button"
                  onClick={() => setIsInternalNote(true)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                    isInternalNote
                      ? 'bg-amber-500 text-white'
                      : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
                  }`}
                >
                  <Lock className="w-3.5 h-3.5" />
                  Nota Interna da Equipe
                </button>
              </div>

              <textarea
                rows={3}
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder={
                  isInternalNote
                    ? 'Escreva uma nota técnica visível apenas para N2 SRE e CS...'
                    : 'Escreva a resposta para o cliente (atualiza o SLA de 1ª resposta automaticamente)...'
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
                  className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition disabled:opacity-40"
                >
                  Enviar &amp; Marcar Resolvido
                </button>

                <button
                  type="button"
                  disabled={sendingComment || !commentBody.trim()}
                  onClick={() => handleSendComment()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#ff7a59] hover:bg-[#e05835] text-white text-xs font-extrabold transition disabled:opacity-40"
                >
                  <Send className="w-3.5 h-3.5" />
                  {isInternalNote ? 'Salvar Nota Interna' : 'Enviar Resposta'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* NEW TICKET MODAL */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <Ticket className="w-4 h-4 text-[#ff7a59]" />
                Abrir Novo Chamado no Service Desk (JSM)
              </h3>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Assunto do Chamado / Incidente *
                </label>
                <input
                  type="text"
                  required
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  placeholder="Ex: Sincronização de faturamento ERP com erro 502"
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
                    <option value="INCIDENT">Incidente de Produção</option>
                    <option value="SUPPORT">Suporte Técnico / Dúvida</option>
                    <option value="BUG">Bug Confirmado</option>
                    <option value="BILLING">Faturamento &amp; Contratos</option>
                    <option value="FEATURE_REQUEST">Melhoria / Feature</option>
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
                    <option value="WHATSAPP">WhatsApp Enterprise</option>
                    <option value="EMAIL">E-mail Suporte</option>
                    <option value="CHAT">Chat In-App</option>
                    <option value="PHONE">Telefone Executivo</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Fila / Especialista Responsável
                </label>
                <input
                  type="text"
                  value={newAssignee}
                  onChange={(e) => setNewAssignee(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Descrição Técnica Detalhada
                </label>
                <textarea
                  rows={3}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Descreva os sintomas, logs ou solicitação do cliente..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#ff7a59] text-white text-xs font-bold"
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
