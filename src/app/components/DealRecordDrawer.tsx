'use client';

import React, { useMemo, useState } from 'react';
import {
  Briefcase,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Mail,
  MoreHorizontal,
  Phone,
  Search,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import { Company, Contact, ErpCommercialProposal, ErpRentalContract, PipelineStage, TimelineEvent } from '../../db/types';
import { formatBRL, formatDateTimeBR } from './ui-helpers';
import { buildInternalProposalUrl } from '../lib/proposal-share';
import { copySignedProposalLink } from '../lib/proposal-link-client';
import { CrmEmailComposerModal } from './email/CrmRecordEmailSection';
import type { EnrichedDeal } from './DealsKanbanTab';

function dash(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

function formatDateBR(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('pt-BR');
  } catch {
    return '—';
  }
}

function monthKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Sem data';
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function propVal(deal: EnrichedDeal, key: string): unknown {
  const cp = deal.customProperties || {};
  return cp[key];
}

export interface DealRecordDrawerProps {
  deal: EnrichedDeal;
  stages: PipelineStage[];
  pipelineName?: string;
  contacts: Contact[];
  companies: Company[];
  timeline: TimelineEvent[];
  proposals: ErpCommercialProposal[];
  contracts: ErpRentalContract[];
  loadingDetail: boolean;
  generatingProposal: boolean;
  onClose: () => void;
  onChangeDeal: (next: EnrichedDeal) => void;
  onStageChange: (dealId: string, stageId: string) => Promise<void>;
  onSave: () => Promise<void>;
  onDelete?: () => Promise<void>;
  onGenerateProposal: () => void;
  onAddNote: (title: string, body: string, type: 'NOTE' | 'CALL' | 'MEETING' | 'EMAIL' | 'TASK') => Promise<void>;
  onShowToast?: (msg: string) => void;
  onNavigateToErp?: () => void;
}

export default function DealRecordDrawer({
  deal,
  stages,
  pipelineName,
  contacts,
  companies: _companies,
  timeline,
  proposals,
  contracts,
  loadingDetail,
  generatingProposal,
  onClose,
  onChangeDeal,
  onStageChange,
  onSave,
  onDelete,
  onGenerateProposal,
  onAddNote,
  onShowToast,
  onNavigateToErp,
}: DealRecordDrawerProps) {
  const [centerTab, setCenterTab] = useState<'OVERVIEW' | 'ACTIVITIES'>('ACTIVITIES');
  const [activityFilter, setActivityFilter] = useState<'ALL' | 'NOTE' | 'EMAIL' | 'CALL' | 'TASK' | 'MEETING'>('ALL');
  const [activitySearch, setActivitySearch] = useState('');
  const [aboutOpen, setAboutOpen] = useState(true);
  const [collapsedCards, setCollapsedCards] = useState<Record<string, boolean>>({});
  const [composerKind, setComposerKind] = useState<'NOTE' | 'CALL' | 'MEETING' | 'EMAIL' | 'TASK' | null>(null);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

  const stageName = stages.find((s) => s.id === deal.stageId)?.name || deal.stageName || '—';
  const monthly = deal.mrr ?? null;
  const total = deal.value ?? null;

  const filteredTimeline = useMemo(() => {
    const q = activitySearch.trim().toLowerCase();
    return timeline
      .filter((e) => (activityFilter === 'ALL' ? true : e.type === activityFilter))
      .filter((e) => {
        if (!q) return true;
        return `${e.title} ${e.body || ''} ${e.actor}`.toLowerCase().includes(q);
      })
      .slice()
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }, [timeline, activityFilter, activitySearch]);

  const grouped = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>();
    for (const evt of filteredTimeline) {
      const k = monthKey(evt.createdAt);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(evt);
    }
    return Array.from(map.entries());
  }, [filteredTimeline]);

  const aboutRows: Array<{ label: string; value: string }> = [
    { label: 'Nome do Negócio', value: dash(deal.title) },
    { label: 'Número da Proposta', value: dash(propVal(deal, 'proposalNumber') || proposals[0]?.code) },
    {
      label: 'Link da Proposta',
      value: proposals[0] ? buildInternalProposalUrl(proposals[0]) : '—',
    },
    { label: 'Descrição', value: dash(propVal(deal, 'description') || deal.nextBestAction?.title) },
    { label: 'Valor mensal', value: monthly != null ? formatBRL(monthly) : '—' },
    { label: 'Valor total', value: total != null ? formatBRL(total) : '—' },
    { label: 'Pipeline', value: dash(pipelineName) },
    { label: 'Etapa', value: dash(stageName) },
    { label: 'Solução como etiqueta', value: dash(propVal(deal, 'solutionTag') || deal.dealType) },
    { label: 'Canal de Aquisição', value: dash(propVal(deal, 'acquisitionChannel')) },
    {
      label: 'Descrição Motivo Ganho/Perda',
      value: dash(deal.wonReason || deal.lostReason),
    },
    { label: 'Data de criação', value: formatDateBR(deal.createdAt) },
    { label: 'Próxima etapa', value: dash(deal.nextBestAction?.title) },
    { label: 'Data de fechamento', value: formatDateBR(deal.expectedCloseDate) },
    { label: 'Última modificação', value: formatDateBR(deal.updatedAt) },
    { label: 'Última atividade', value: formatDateBR(deal.lastActivityAt) },
    { label: 'Proprietário', value: dash(deal.ownerName) },
    { label: 'Probabilidade', value: `${deal.probability ?? 0}%` },
    { label: 'Último contato', value: formatDateBR(deal.lastActivityAt) },
    {
      label: 'Pessoa de contato',
      value: deal.contact ? `${deal.contact.firstName} ${deal.contact.lastName}`.trim() : '—',
    },
    { label: 'É negócio fechado', value: deal.status === 'OPEN' ? 'Não' : 'Sim' },
  ];

  const toggleCard = (id: string) =>
    setCollapsedCards((prev) => ({ ...prev, [id]: !prev[id] }));

  const actionButtons: Array<{
    id: string;
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
  }> = [
    {
      id: 'note',
      label: 'Observação',
      icon: <StickyNote className="w-4 h-4" />,
      onClick: () => {
        setComposerKind('NOTE');
        setCenterTab('ACTIVITIES');
      },
    },
    {
      id: 'email',
      label: 'E-mail',
      icon: <Mail className="w-4 h-4" />,
      onClick: () => {
        setEmailOpen(true);
        setCenterTab('ACTIVITIES');
      },
    },
    {
      id: 'call',
      label: 'Chamada',
      icon: <Phone className="w-4 h-4" />,
      onClick: () => {
        setComposerKind('CALL');
        setCenterTab('ACTIVITIES');
      },
    },
    {
      id: 'task',
      label: 'Tarefa',
      icon: <CheckCircle2 className="w-4 h-4" />,
      onClick: () => {
        setComposerKind('TASK');
        setCenterTab('ACTIVITIES');
      },
    },
    {
      id: 'meeting',
      label: 'Reunião',
      icon: <Calendar className="w-4 h-4" />,
      onClick: () => {
        setComposerKind('MEETING');
        setCenterTab('ACTIVITIES');
      },
    },
    {
      id: 'more',
      label: 'Mais',
      icon: <MoreHorizontal className="w-4 h-4" />,
      onClick: () => onGenerateProposal(),
    },
  ];

  const saveNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!composerKind || !noteTitle.trim()) return;
    setSavingNote(true);
    try {
      await onAddNote(noteTitle.trim(), noteBody.trim(), composerKind);
      setNoteTitle('');
      setNoteBody('');
      setComposerKind(null);
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex justify-end">
      <div className="bg-slate-50 w-full max-w-[1440px] h-full shadow-2xl border-l border-slate-200 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="px-4 py-2.5 bg-white border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-accent cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" /> Negócios
            </button>
            <button
              type="button"
              className="px-2.5 py-1 rounded-md border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Ações
            </button>
          </div>
          <div className="flex items-center gap-2">
            {onNavigateToErp && (
              <button
                type="button"
                onClick={onNavigateToErp}
                className="px-2.5 py-1 rounded-md border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Abrir ERP
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 cursor-pointer"
              aria-label="Fechar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12">
          {/* LEFT */}
          <aside className="lg:col-span-3 border-r border-slate-200 bg-white overflow-y-auto p-4 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0">
                <Briefcase className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-slate-900 leading-snug break-words">
                  {deal.title || '—'}
                </h2>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500 font-semibold">Valor</span>
                <span className="font-semibold text-slate-900">
                  {total != null ? formatBRL(total) : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500 font-semibold">Data de fechamento</span>
                <span className="font-semibold text-slate-900">{formatDateBR(deal.expectedCloseDate)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500 font-semibold">Pipeline</span>
                <span className="font-semibold text-slate-900 truncate">{dash(pipelineName)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500 font-semibold">Etapa do negócio</span>
                <select
                  value={deal.stageId}
                  onChange={async (e) => {
                    const st = stages.find((s) => s.id === e.target.value);
                    if (!st) return;
                    await onStageChange(deal.id, st.id);
                    onChangeDeal({
                      ...deal,
                      stageId: st.id,
                      stageName: st.name,
                      probability: st.defaultProbability,
                      status: st.isWon ? 'WON' : st.isClosed ? 'LOST' : 'OPEN',
                    });
                  }}
                  className="max-w-[55%] px-2 py-1 rounded-md border border-slate-200 bg-white font-semibold text-slate-800 text-[11px]"
                >
                  {stages.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 pt-1">
              {actionButtons.map((btn) => (
                <button
                  key={btn.id}
                  type="button"
                  onClick={btn.onClick}
                  className="flex flex-col items-center gap-1 w-14 cursor-pointer group"
                >
                  <span className="w-10 h-10 rounded-full border border-slate-200 bg-white text-slate-600 flex items-center justify-center group-hover:border-accent group-hover:text-accent">
                    {btn.icon}
                  </span>
                  <span className="text-[10px] font-semibold text-slate-600 text-center leading-tight">
                    {btn.label}
                  </span>
                </button>
              ))}
            </div>

            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setAboutOpen((v) => !v)}
                className="w-full px-3 py-2.5 flex items-center justify-between bg-slate-50 hover:bg-slate-100 cursor-pointer"
              >
                <span className="text-xs font-semibold text-slate-800">Sobre esse Negócio</span>
                <span className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-slate-500">Ações</span>
                  {aboutOpen ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                </span>
              </button>
              {aboutOpen && (
                <div className="p-3 space-y-3">
                  {aboutRows.map((row) => (
                    <div key={row.label} className="space-y-0.5">
                      <div className="text-[10px] font-semibold text-slate-400">{row.label}</div>
                      <div className="text-xs font-semibold text-slate-800 break-words">{row.value}</div>
                    </div>
                  ))}

                  <div className="pt-2 border-t border-slate-100 space-y-2">
                    <label className="block text-[10px] font-semibold text-slate-400">Editar nome</label>
                    <input
                      type="text"
                      value={deal.title}
                      onChange={(e) => onChangeDeal({ ...deal, title: e.target.value })}
                      className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 text-xs font-semibold"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">Valor mensal</label>
                        <input
                          type="number"
                          value={deal.mrr ?? Math.round(deal.value / (deal.contractMonths || 24))}
                          onChange={(e) => {
                            const mrrVal = Number(e.target.value) || 0;
                            const months = deal.contractMonths || 24;
                            onChangeDeal({ ...deal, mrr: mrrVal, value: mrrVal * months });
                          }}
                          className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 text-xs font-semibold"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">Valor total</label>
                        <input
                          type="number"
                          value={deal.value}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 0;
                            const months = deal.contractMonths || 24;
                            onChangeDeal({ ...deal, value: val, mrr: Math.round(val / months) });
                          }}
                          className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 text-xs font-semibold"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      {onDelete && (
                        <button
                          type="button"
                          onClick={() => void onDelete()}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-rose-200 text-rose-700 text-xs font-semibold cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Excluir
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void onSave()}
                        className="flex-1 py-1.5 rounded-md bg-accent hover:bg-accent-hover text-white text-xs font-semibold cursor-pointer"
                      >
                        Salvar
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </aside>

          {/* CENTER */}
          <section className="lg:col-span-6 overflow-y-auto p-4 space-y-3">
            <div className="bg-white rounded-lg border border-slate-200">
              <div className="flex items-center gap-1 px-3 pt-2 border-b border-slate-100">
                {(
                  [
                    { id: 'OVERVIEW', label: 'Visão geral' },
                    { id: 'ACTIVITIES', label: 'Atividades' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setCenterTab(tab.id)}
                    className={`px-3 py-2 text-xs font-semibold border-b-2 cursor-pointer ${
                      centerTab === tab.id
                        ? 'border-accent text-accent'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {centerTab === 'OVERVIEW' ? (
                <div className="p-4 space-y-3 text-xs">
                  <div className="rounded-lg border border-slate-200 p-3">
                    <div className="font-semibold text-slate-800 mb-1">Resumo</div>
                    <p className="text-slate-600">
                      {deal.title} · {stageName} · Probabilidade {deal.probability}%
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-slate-200 p-3">
                      <div className="text-[10px] font-semibold text-slate-400">Valor mensal</div>
                      <div className="font-semibold text-slate-900">
                        {monthly != null ? formatBRL(monthly) : '—'}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <div className="text-[10px] font-semibold text-slate-400">Valor total</div>
                      <div className="font-semibold text-slate-900">
                        {total != null ? formatBRL(total) : '—'}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-1">
                    {(
                      [
                        { id: 'ALL', label: 'Todas as atividades' },
                        { id: 'NOTE', label: 'Observações' },
                        { id: 'EMAIL', label: 'E-mails' },
                        { id: 'CALL', label: 'Chamadas' },
                        { id: 'TASK', label: 'Tarefas' },
                        { id: 'MEETING', label: 'Reuniões' },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setActivityFilter(f.id)}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border cursor-pointer ${
                          activityFilter === f.id
                            ? 'bg-accent text-white border-accent'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[180px]">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="search"
                        value={activitySearch}
                        onChange={(e) => setActivitySearch(e.target.value)}
                        placeholder="Pesquisar atividades"
                        className="w-full pl-8 pr-3 py-1.5 rounded-md border border-slate-200 text-xs font-semibold"
                      />
                    </div>
                    <select className="px-2 py-1.5 rounded-md border border-slate-200 text-[11px] font-semibold text-slate-600" defaultValue="ALL" aria-label="Atividade">
                      <option value="ALL">Atividade</option>
                      <option value="NOTE">Observação</option>
                      <option value="EMAIL">E-mail</option>
                      <option value="CALL">Chamada</option>
                      <option value="TASK">Tarefa</option>
                      <option value="MEETING">Reunião</option>
                    </select>
                    <select className="px-2 py-1.5 rounded-md border border-slate-200 text-[11px] font-semibold text-slate-600" defaultValue="ANY" aria-label="Data da atividade">
                      <option value="ANY">Data da atividade</option>
                      <option value="7">Últimos 7 dias</option>
                      <option value="30">Últimos 30 dias</option>
                    </select>
                    <select className="px-2 py-1.5 rounded-md border border-slate-200 text-[11px] font-semibold text-slate-600" defaultValue="ANY" aria-label="Atividade atribuída a">
                      <option value="ANY">Atividade atribuída a</option>
                      <option value="ME">Eu</option>
                    </select>
                    <button type="button" className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 cursor-pointer">
                      Recolher tudo
                    </button>
                  </div>

                  {composerKind && (
                    <form onSubmit={saveNote} className="rounded-lg border border-slate-200 p-3 space-y-2 bg-slate-50">
                      <div className="text-xs font-semibold text-slate-800">
                        Registrar {composerKind === 'NOTE' ? 'observação' : composerKind === 'CALL' ? 'chamada' : composerKind === 'MEETING' ? 'reunião' : composerKind === 'EMAIL' ? 'e-mail' : 'tarefa'}
                      </div>
                      <input
                        required
                        value={noteTitle}
                        onChange={(e) => setNoteTitle(e.target.value)}
                        placeholder="Assunto"
                        className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 text-xs font-semibold"
                      />
                      <textarea
                        rows={3}
                        value={noteBody}
                        onChange={(e) => setNoteBody(e.target.value)}
                        placeholder="Detalhes"
                        className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 text-xs"
                      />
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setComposerKind(null)} className="px-3 py-1.5 rounded-md border border-slate-200 text-xs font-semibold cursor-pointer">
                          Cancelar
                        </button>
                        <button type="submit" disabled={savingNote} className="px-3 py-1.5 rounded-md bg-accent text-white text-xs font-semibold cursor-pointer">
                          {savingNote ? 'Salvando...' : 'Salvar'}
                        </button>
                      </div>
                      {composerKind === 'EMAIL' && (
                        <button
                          type="button"
                          onClick={() => setEmailOpen(true)}
                          className="text-[11px] font-semibold text-accent hover:underline cursor-pointer"
                        >
                          Ou enviar e-mail pela caixa Outlook
                        </button>
                      )}
                    </form>
                  )}

                  <div className="flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setComposerKind('EMAIL')}
                      className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
                    >
                      Registrar e-mail
                    </button>
                    <button
                      type="button"
                      onClick={() => setEmailOpen(true)}
                      className="text-[11px] font-semibold text-accent hover:underline cursor-pointer"
                    >
                      Enviar por e-mail
                    </button>
                  </div>

                  {emailOpen && (
                    <CrmEmailComposerModal
                      record={{ dealId: deal.id, contactId: deal.contactId, companyId: deal.companyId }}
                      defaultTo={deal.contact?.email || ''}
                      suggestions={contacts.filter((c) => c.companyId === deal.companyId).map((c) => c.email).filter(Boolean) as string[]}
                      recordLabel={deal.title}
                      onClose={() => setEmailOpen(false)}
                      onSent={() => setEmailOpen(false)}
                    />
                  )}

                  {loadingDetail ? (
                    <p className="text-xs font-semibold text-slate-500">Carregando atividades...</p>
                  ) : grouped.length === 0 ? (
                    <p className="text-xs font-semibold text-slate-500">Nenhuma atividade neste filtro.</p>
                  ) : (
                    <div className="space-y-4">
                      {grouped.map(([month, items]) => (
                        <div key={month} className="space-y-2">
                          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                            {month}
                          </div>
                          {items.map((evt) => (
                            <div key={evt.id} className="rounded-lg border border-slate-200 bg-white p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-xs font-semibold text-slate-900">{evt.title}</div>
                                  {evt.body && <p className="text-xs text-slate-600 mt-1 whitespace-pre-line">{evt.body}</p>}
                                  <div className="text-[10px] font-semibold text-slate-400 mt-1">
                                    {evt.type} · {evt.actor}
                                  </div>
                                </div>
                                <div className="text-[11px] font-semibold text-slate-500 shrink-0">
                                  {formatDateTimeBR(evt.createdAt)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* RIGHT */}
          <aside className="lg:col-span-3 border-l border-slate-200 bg-white overflow-y-auto p-3 space-y-3">
            {(
              [
                {
                  id: 'contacts',
                  title: 'Contatos',
                  count: deal.contact ? 1 : 0,
                  body: deal.contact ? (
                    <div className="text-xs space-y-0.5">
                      <div className="font-semibold text-slate-900">
                        {deal.contact.firstName} {deal.contact.lastName}
                      </div>
                      <div className="text-slate-500 font-semibold">{deal.contact.email || '—'}</div>
                      <div className="text-slate-500">{deal.contact.jobTitle || '—'}</div>
                    </div>
                  ) : (
                    <p className="text-xs font-semibold text-slate-500">Nenhum contato associado.</p>
                  ),
                },
                {
                  id: 'companies',
                  title: 'Empresas',
                  count: deal.company ? 1 : 0,
                  body: deal.company ? (
                    <div className="text-xs space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-slate-900">{deal.company.name}</span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[9px] font-semibold text-slate-600">
                          Principal
                        </span>
                      </div>
                      <div className="text-slate-500 font-semibold">{deal.company.cnpj || '—'}</div>
                      <div className="text-slate-500">
                        {[deal.company.city, deal.company.state].filter(Boolean).join('/') || '—'}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs font-semibold text-slate-500">Nenhuma empresa associada.</p>
                  ),
                },
                {
                  id: 'tickets',
                  title: 'Tickets/Chamados',
                  count: 0,
                  body: <p className="text-xs font-semibold text-slate-500">Nenhum chamado associado.</p>,
                },
                {
                  id: 'deals',
                  title: 'Negócios',
                  count: 1,
                  body: (
                    <div className="text-xs">
                      <div className="font-semibold text-slate-900">{deal.title}</div>
                      <div className="text-slate-500 font-semibold">{stageName}</div>
                    </div>
                  ),
                },
                {
                  id: 'proposals',
                  title: 'Propostas',
                  count: proposals.length,
                  body:
                    proposals.length === 0 ? (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-slate-500">Nenhuma proposta vinculada.</p>
                        <button
                          type="button"
                          disabled={generatingProposal}
                          onClick={onGenerateProposal}
                          className="w-full py-1.5 rounded-md bg-accent text-white text-xs font-semibold cursor-pointer"
                        >
                          {generatingProposal ? 'Gerando...' : 'Criar proposta'}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {proposals.map((prop) => (
                          <div key={prop.id} className="rounded-md border border-slate-200 p-2 space-y-1">
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-mono text-[11px] font-semibold text-accent">{prop.code}</span>
                              <span className="text-[9px] font-semibold text-slate-500">{prop.status}</span>
                            </div>
                            <div className="text-xs font-semibold text-slate-800 truncate">{prop.title}</div>
                            <div className="text-[10px] text-slate-500 font-semibold flex justify-between">
                              <span>Mensal: {formatBRL(prop.monthlyRecurringTotal)}</span>
                              <span>Total: {formatBRL(prop.totalContractValue)}</span>
                            </div>
                            <div className="flex gap-1 pt-1">
                              <a
                                href={buildInternalProposalUrl(prop)}
                                target="_blank"
                                rel="noreferrer"
                                className="flex-1 py-1 rounded bg-slate-100 text-[10px] font-semibold text-center inline-flex items-center justify-center gap-1"
                              >
                                <ExternalLink className="w-3 h-3" /> Abrir
                              </a>
                              <button
                                type="button"
                                onClick={async () => {
                                  const r = await copySignedProposalLink(prop.id);
                                  onShowToast?.(r.ok ? `Link da proposta ${prop.code} copiado.` : r.error);
                                }}
                                className="p-1 rounded border border-slate-200 cursor-pointer"
                                title="Copiar link"
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                        <button
                          type="button"
                          disabled={generatingProposal}
                          onClick={onGenerateProposal}
                          className="w-full py-1.5 rounded-md border border-slate-200 text-xs font-semibold cursor-pointer"
                        >
                          + Adicionar
                        </button>
                      </div>
                    ),
                },
                {
                  id: 'payments',
                  title: 'Contratos / Pagamentos',
                  count: contracts.length,
                  body:
                    contracts.length === 0 ? (
                      <p className="text-xs font-semibold text-slate-500">Nenhum contrato associado.</p>
                    ) : (
                      <div className="space-y-2">
                        {contracts.map((ctr) => (
                          <div key={ctr.id} className="rounded-md border border-slate-200 p-2 text-xs space-y-0.5">
                            <div className="font-semibold text-slate-900">{ctr.contractNumber}</div>
                            <div className="text-slate-500 font-semibold truncate">{ctr.title}</div>
                            <div className="text-[10px] text-slate-500">
                              {formatBRL(ctr.monthlyValue)}/mês · {ctr.status}
                            </div>
                          </div>
                        ))}
                      </div>
                    ),
                },
              ] as const
            ).map((card) => {
              const open = !collapsedCards[card.id];
              return (
                <div key={card.id} className="rounded-lg border border-slate-200 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleCard(card.id)}
                    className="w-full px-3 py-2 flex items-center justify-between bg-slate-50 hover:bg-slate-100 cursor-pointer"
                  >
                    <span className="text-xs font-semibold text-slate-800">
                      {card.title} ({card.count})
                    </span>
                    <span className="flex items-center gap-2 text-[11px] font-semibold text-accent">
                      + Adicionar
                      {open ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                    </span>
                  </button>
                  {open && <div className="p-3">{card.body}</div>}
                </div>
              );
            })}
          </aside>
        </div>
      </div>
    </div>
  );
}
