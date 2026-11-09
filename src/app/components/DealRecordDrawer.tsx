'use client';

import React, { useMemo, useState } from 'react';
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Handshake,
  ListTodo,
  Mail,
  MoreHorizontal,
  Phone,
  Search,
  Settings,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import {
  Company,
  Contact,
  ErpCommercialProposal,
  ErpFinancialEntry,
  ErpFiscalInvoice,
  ErpRentalContract,
  PipelineStage,
  ServiceTicket,
  TimelineEvent,
} from '../../db/types';
import { formatBRL, formatDateTimeBR } from './ui-helpers';
import { buildInternalProposalUrl } from '../lib/proposal-share';
import { copySignedProposalLink } from '../lib/proposal-link-client';
import { CrmEmailComposerModal } from './email/CrmRecordEmailSection';
import type { EnrichedDeal } from './DealsKanbanTab';

function dash(v: unknown): string {
  if (v === null || v === undefined || v === '') return '--';
  if (typeof v === 'boolean') return v ? 'Verdadeiro' : 'Falso';
  return String(v);
}

/** Datas no padrão HubSpot local: 08/09/2026 16:18 */
function formatPropDateTime(iso: string | null | undefined): string {
  if (!iso) return '--';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '--';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
  } catch {
    return '--';
  }
}

function formatDateBR(iso: string | null | undefined): string {
  return formatPropDateTime(iso) === '--' ? '--' : formatPropDateTime(iso).slice(0, 10);
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

function firstProp(deal: EnrichedDeal, keys: string[]): unknown {
  const cp = deal.customProperties || {};
  for (const k of keys) {
    if (cp[k] !== undefined && cp[k] !== null && cp[k] !== '') return cp[k];
  }
  return undefined;
}

function humanizePropKey(key: string): string {
  const known: Record<string, string> = {
    proposalNumber: 'Número da Proposta',
    proposalCode: 'Número da Proposta',
    numero_da_proposta: 'Número da Proposta',
    link_da_proposta: 'Link da Proposta',
    proposalLink: 'Link da Proposta',
    description: 'Descrição do negócio',
    descricao_do_negocio: 'Descrição do negócio',
    deal_description: 'Descrição do negócio',
    solutionTag: 'Solução',
    solucao: 'Solução',
    acquisitionChannel: 'Canal de Aquisição',
    canal_de_aquisicao: 'Canal de Aquisição',
    canal_aquisicao: 'Canal de Aquisição',
    seats: 'Assentos ou ramais',
    contractMonths: 'Meses de contrato',
    contractNumber: 'Número do contrato',
    currentContract: 'Contrato atual',
    legalReviewPending: 'Revisão jurídica pendente',
    paymentTerms: 'Condição de pagamento',
    pocApproved: 'POC aprovada',
    proposalVersion: 'Versão da proposta',
    supplierName: 'Fornecedor',
    ocCode: 'Código OC',
    cfopRemessa: 'CFOP remessa',
    seta_deal_modality: 'Modalidade comercial',
    hs_mrr_brl: 'Valor mensal',
  };
  if (known[key]) return known[key];
  return key
    .replace(/^hs_/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isInternalCustomKey(key: string): boolean {
  const k = key.toLowerCase();
  if (k === 'hs_object_id' || k === 'objectid' || k === 'portalid') return true;
  if (/^hs_.*(_timestamp|_id|_ids)$/.test(k)) return true;
  if (k.endsWith('_timestamp') || k.endsWith('timestamp')) return true;
  if (k === 'id' || k === 'dealid' || k === 'hubspot_owner_id') return true;
  if (k.startsWith('hs_analytics_') || k.startsWith('hs_date_entered') || k.startsWith('hs_time_in')) return true;
  if (k.startsWith('hs_v2_') || k === 'hs_all_assigned_business_unit_ids') return true;
  return false;
}

const CANONICAL_CUSTOM_KEYS = new Set([
  'proposalNumber',
  'proposalCode',
  'numero_da_proposta',
  'numero_proposta',
  'link_da_proposta',
  'proposalLink',
  'link_proposta',
  'description',
  'descricao_do_negocio',
  'deal_description',
  'descricao',
  'solutionTag',
  'solucao',
  'solução',
  'acquisitionChannel',
  'canal_de_aquisicao',
  'canal_aquisicao',
  'last_meeting_scheduled',
  'data_da_ultima_reuniao_agendada',
  'hs_last_meeting_date',
  'notes_last_contacted',
  'ultimo_contato',
  'hs_mrr_brl',
  'amount',
  'dealname',
  'closedate',
  'dealstage',
  'pipeline',
  'hs_is_closed',
  'hubspot_owner_id',
  'seta_deal_modality',
]);

type AboutRow = {
  label: string;
  value: string;
  href?: string | null;
  tags?: string[];
  key: string;
};

function dealTypeAsTag(dealType: EnrichedDeal['dealType']): string | null {
  if (!dealType) return null;
  if (dealType === 'LOCACAO_RECORRENTE') return 'Locação Recorrente (0% ISS)';
  if (dealType === 'UPSELL_RENOVACAO') return 'Upsell / Renovação';
  if (dealType === 'NEW_BUSINESS') return 'Novo Negócio B2B';
  return String(dealType);
}

function formatCustomValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '--';
  if (typeof v === 'boolean') return v ? 'Verdadeiro' : 'Falso';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '--';
  if (typeof v === 'string') {
    // ISO date-ish
    if (/^\d{4}-\d{2}-\d{2}T/.test(v) || /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const f = formatPropDateTime(v);
      return f;
    }
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => dash(x)).join(', ') || '--';
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export interface DealRecordDrawerProps {
  deal: EnrichedDeal;
  stages: PipelineStage[];
  pipelineName?: string;
  contacts: Contact[];
  companies: Company[];
  /** Outros negócios (mesmo store) — filtrados por empresa no drawer. */
  deals?: EnrichedDeal[];
  timeline: TimelineEvent[];
  proposals: ErpCommercialProposal[];
  contracts: ErpRentalContract[];
  tickets?: ServiceTicket[];
  invoices?: ErpFiscalInvoice[];
  financialEntries?: ErpFinancialEntry[];
  canViewChamados?: boolean;
  canViewFinance?: boolean;
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
  companies,
  deals = [],
  timeline,
  proposals,
  contracts,
  tickets = [],
  invoices = [],
  financialEntries = [],
  canViewChamados = false,
  canViewFinance = false,
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
  const [showAllAbout, setShowAllAbout] = useState(false);
  const [showAllAssoc, setShowAllAssoc] = useState<Record<string, boolean>>({});


  const stageName = stages.find((s) => s.id === deal.stageId)?.name || deal.stageName || '--';
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

  const proposalLinkRaw =
    firstProp(deal, ['link_da_proposta', 'proposalLink', 'link_proposta']) ||
    (proposals[0] ? buildInternalProposalUrl(proposals[0]) : null);
  const proposalLink = proposalLinkRaw ? String(proposalLinkRaw) : null;

  const solutionRaw = firstProp(deal, ['solutionTag', 'solucao', 'solução', 'seta_deal_modality']);
  const solutionTags: string[] = [];
  if (Array.isArray(solutionRaw)) {
    for (const s of solutionRaw) if (s) solutionTags.push(String(s));
  } else if (typeof solutionRaw === 'string' && solutionRaw.trim()) {
    solutionTags.push(...solutionRaw.split(/[,;|]/).map((s) => s.trim()).filter(Boolean));
  }
  const dealTypeTag = dealTypeAsTag(deal.dealType);
  if (dealTypeTag && !solutionTags.includes(dealTypeTag)) solutionTags.push(dealTypeTag);

  const lastMeetingFromTimeline = timeline
    .filter((e) => e.type === 'MEETING')
    .map((e) => e.createdAt)
    .sort((a, b) => +new Date(b) - +new Date(a))[0];
  const lastMeeting =
    firstProp(deal, ['last_meeting_scheduled', 'data_da_ultima_reuniao_agendada', 'hs_last_meeting_date']) ||
    lastMeetingFromTimeline ||
    null;

  const lastContact =
    firstProp(deal, ['notes_last_contacted', 'ultimo_contato', 'hs_last_contacted']) || deal.lastActivityAt;

  const description =
    firstProp(deal, ['description', 'descricao_do_negocio', 'deal_description', 'descricao']) || null;

  const aboutRowsAll: AboutRow[] = [
    { key: 'dealname', label: 'Nome do negócio', value: dash(deal.title) },
    {
      key: 'proposal_number',
      label: 'Número da Proposta',
      value: dash(
        firstProp(deal, ['proposalNumber', 'proposalCode', 'numero_da_proposta', 'numero_proposta']) ||
          proposals[0]?.code
      ),
    },
    {
      key: 'proposal_link',
      label: 'Link da Proposta',
      value: proposalLink || '--',
      href: proposalLink,
    },
    { key: 'description', label: 'Descrição do negócio', value: dash(description) },
    {
      key: 'mrr',
      label: 'Valor mensal',
      value: monthly != null ? formatBRL(monthly) : dash(firstProp(deal, ['hs_mrr_brl'])),
    },
    {
      key: 'amount',
      label: 'Valor total',
      value: total != null ? formatBRL(total) : '--',
    },
    { key: 'pipeline', label: 'Pipeline', value: dash(pipelineName) },
    { key: 'dealstage', label: 'Etapa do negócio', value: dash(stageName) },
    {
      key: 'solution',
      label: 'Solução',
      value: solutionTags.length ? solutionTags.join(', ') : '--',
      tags: solutionTags.length ? solutionTags : undefined,
    },
    {
      key: 'acquisition',
      label: 'Canal de Aquisição',
      value: dash(firstProp(deal, ['acquisitionChannel', 'canal_de_aquisicao', 'canal_aquisicao'])),
    },
    { key: 'won_reason', label: 'Descrição Motivo Ganho', value: dash(deal.wonReason) },
    { key: 'lost_reason', label: 'Descrição Motivo Perda', value: dash(deal.lostReason) },
    { key: 'createdate', label: 'Data de criação', value: formatPropDateTime(deal.createdAt) },
    { key: 'next_step', label: 'Próxima etapa', value: dash(deal.nextBestAction?.title) },
    { key: 'closedate', label: 'Data de fechamento', value: formatPropDateTime(deal.expectedCloseDate) },
    { key: 'hs_lastmodifieddate', label: 'Data da última modificação', value: formatPropDateTime(deal.updatedAt) },
    { key: 'notes_last_updated', label: 'Data da última atividade', value: formatPropDateTime(deal.lastActivityAt) },
    { key: 'hubspot_owner_id', label: 'Proprietário do negócio', value: dash(deal.ownerName) },
    {
      key: 'hs_deal_stage_probability',
      label: 'Probabilidade da fase de negócios (%)',
      value: deal.probability != null ? `${deal.probability}%` : '--',
    },
    { key: 'notes_last_contacted', label: 'Último contato', value: formatPropDateTime(lastContact as string | null) },
    {
      key: 'contact',
      label: 'Pessoa de contato',
      value: deal.contact ? `${deal.contact.firstName} ${deal.contact.lastName}`.trim() || dash(deal.contact.email) : '--',
    },
    {
      key: 'last_meeting',
      label: 'Data da última reunião agendada',
      value: formatPropDateTime(lastMeeting as string | null),
    },
    {
      key: 'hs_is_closed',
      label: 'É negócio fechado',
      value: deal.status === 'OPEN' ? 'Falso' : 'Verdadeiro',
    },
  ];

  const customExtra: AboutRow[] = Object.entries(deal.customProperties || {})
    .filter(([k]) => !isInternalCustomKey(k) && !CANONICAL_CUSTOM_KEYS.has(k))
    .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
    .map(([k, v]) => ({
      key: `cp:${k}`,
      label: humanizePropKey(k),
      value: formatCustomValue(v),
      href: typeof v === 'string' && /^https?:\/\//i.test(v) ? v : undefined,
    }));

  const ABOUT_PREVIEW_LIMIT = 30;
  const aboutCombined = [...aboutRowsAll, ...customExtra];
  const aboutRows = showAllAbout || aboutCombined.length <= ABOUT_PREVIEW_LIMIT
    ? aboutCombined
    : aboutCombined.slice(0, ABOUT_PREVIEW_LIMIT);
  const aboutHasMore = aboutCombined.length > ABOUT_PREVIEW_LIMIT && !showAllAbout;

  const associatedContacts = useMemo(() => {
    const list: Contact[] = [];
    const seen = new Set<string>();
    if (deal.contact) {
      list.push(deal.contact);
      seen.add(deal.contact.id);
    }
    for (const c of contacts) {
      if (seen.has(c.id)) continue;
      if (deal.companyId && c.companyId === deal.companyId) {
        list.push(c);
        seen.add(c.id);
      } else if (deal.contactId && c.id === deal.contactId) {
        list.push(c);
        seen.add(c.id);
      }
    }
    return list;
  }, [contacts, deal.contact, deal.contactId, deal.companyId]);

  const associatedCompanies = useMemo(() => {
    const list: Company[] = [];
    const seen = new Set<string>();
    if (deal.company) {
      list.push(deal.company);
      seen.add(deal.company.id);
    }
    for (const c of companies) {
      if (seen.has(c.id)) continue;
      if (deal.companyId && c.id === deal.companyId) {
        list.push(c);
        seen.add(c.id);
      }
    }
    return list;
  }, [companies, deal.company, deal.companyId]);

  const associatedTickets = useMemo(() => {
    if (!canViewChamados) return [] as ServiceTicket[];
    return tickets.filter(
      (t) =>
        t.dealId === deal.id ||
        (deal.companyId && t.companyId === deal.companyId) ||
        (deal.contactId && t.contactId === deal.contactId)
    );
  }, [tickets, canViewChamados, deal.id, deal.companyId, deal.contactId]);

  const relatedDeals = useMemo(() => {
    if (!deal.companyId) return [] as EnrichedDeal[];
    return deals.filter((d) => d.companyId === deal.companyId && d.id !== deal.id);
  }, [deals, deal.companyId, deal.id]);

  const companyCnpjDigits = String(deal.company?.cnpj || '').replace(/\D+/g, '');
  const companyNameNorm = String(deal.company?.name || '').trim().toLowerCase();

  const associatedFinance = useMemo(() => {
    if (!canViewFinance) return { invoices: [] as ErpFiscalInvoice[], entries: [] as ErpFinancialEntry[] };
    const inv = invoices.filter(
      (i) =>
        i.dealId === deal.id ||
        (deal.companyId && i.companyId === deal.companyId) ||
        (companyCnpjDigits && String(i.companyCnpj || '').replace(/\D+/g, '') === companyCnpjDigits)
    );
    const ent = financialEntries.filter((e) => {
      if (e.type !== 'RECEBER' && e.type !== 'PAGAR') return false;
      const n = String(e.companyName || '').trim().toLowerCase();
      return Boolean(companyNameNorm && n && (n === companyNameNorm || n.includes(companyNameNorm) || companyNameNorm.includes(n)));
    });
    return { invoices: inv, entries: ent };
  }, [canViewFinance, invoices, financialEntries, deal.id, deal.companyId, companyCnpjDigits, companyNameNorm]);

  const companyPhone = (co: Company): string => {
    const cp = (co.customProperties || {}) as Record<string, unknown>;
    const v = cp.phone || cp.whatsappPhone || cp.telefone;
    return v ? String(v) : '--';
  };

  const companyDomainUrl = (co: Company): string | null => {
    const d = (co.domain || '').trim();
    if (!d) return null;
    if (/^https?:\/\//i.test(d)) return d;
    return `https://${d}`;
  };

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
      label: 'Nota',
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
      icon: <ListTodo className="w-4 h-4" />,
      onClick: () => {
        setComposerKind('TASK');
        setCenterTab('ACTIVITIES');
      },
    },
    {
      id: 'meeting',
      label: 'Reunião',
      icon: <CalendarDays className="w-4 h-4" />,
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
              <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 ring-1 ring-slate-200">
                <Handshake className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-slate-900 leading-snug break-words">
                  {deal.title || '--'}
                </h2>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500 font-semibold">Valor</span>
                <span className="font-semibold text-slate-900">
                  {total != null ? formatBRL(total) : '--'}
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

            <div className="flex items-start justify-between gap-1 pt-1">
              {actionButtons.map((btn) => (
                <button
                  key={btn.id}
                  type="button"
                  onClick={btn.onClick}
                  className="flex flex-col items-center gap-1 flex-1 min-w-0 cursor-pointer group"
                >
                  <span className="w-9 h-9 rounded-full border border-slate-200 bg-white text-slate-600 flex items-center justify-center group-hover:border-accent group-hover:text-accent">
                    {btn.icon}
                  </span>
                  <span className="text-[10px] font-semibold text-slate-600 text-center leading-tight truncate w-full">
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
                    <div key={row.key} className="space-y-0.5">
                      <div className="text-[10px] font-semibold text-slate-400">{row.label}</div>
                      {row.tags && row.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {row.tags.map((tag) => (
                            <span
                              key={tag}
                              className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-[11px] font-semibold text-slate-700 border border-slate-200"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : row.href && row.value !== '--' ? (
                        <a
                          href={row.href}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:underline break-all"
                        >
                          <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                          <span className="break-all">{row.value}</span>
                        </a>
                      ) : (
                        <div className="text-xs font-semibold text-slate-800 break-words whitespace-pre-wrap">{row.value}</div>
                      )}
                    </div>
                  ))}
                  {aboutHasMore && (
                    <button
                      type="button"
                      onClick={() => setShowAllAbout(true)}
                      className="text-[11px] font-semibold text-accent hover:underline cursor-pointer"
                    >
                      Ver todas as propriedades ({aboutCombined.length})
                    </button>
                  )}

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
                        {monthly != null ? formatBRL(monthly) : '--'}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <div className="text-[10px] font-semibold text-slate-400">Valor total</div>
                      <div className="font-semibold text-slate-900">
                        {total != null ? formatBRL(total) : '--'}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-0 border-b border-slate-100">
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
                        className={`px-2.5 py-2 text-[11px] font-semibold border-b-2 cursor-pointer ${
                          activityFilter === f.id
                            ? 'border-accent text-accent'
                            : 'border-transparent text-slate-500 hover:text-slate-800'
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

          {/* RIGHT — cartões de associação */}
          <aside className="lg:col-span-3 border-l border-slate-200 bg-white overflow-y-auto p-3 space-y-3">
            {(() => {
              type CardDef = {
                id: string;
                title: string;
                count: number;
                visible: boolean;
                emptyHint: string;
                body: React.ReactNode;
                onAdd?: () => void;
                /** Sem fluxo real: botão + Adicionar desabilitado com tooltip Em breve */
                addSoon?: boolean;
              };

              const contactLimit = showAllAssoc.contacts ? associatedContacts.length : 3;
              const companyLimit = showAllAssoc.companies ? associatedCompanies.length : 3;
              const financeCount = associatedFinance.invoices.length + associatedFinance.entries.length;

              const cards: CardDef[] = [
                {
                  id: 'contacts',
                  title: 'Contatos',
                  count: associatedContacts.length,
                  visible: true,
                  emptyHint: 'Veja as pessoas associadas a este registro.',
                  addSoon: true,
                  body: associatedContacts.length === 0 ? null : (
                    <div className="space-y-3">
                      {associatedContacts.slice(0, contactLimit).map((c) => (
                        <div key={c.id} className="text-xs space-y-0.5">
                          <div className="font-semibold text-slate-900">
                            {`${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email || '--'}
                          </div>
                          {c.jobTitle ? <div className="text-slate-500 font-semibold">{c.jobTitle}</div> : null}
                          <div className="text-slate-600 font-semibold break-all">{c.email || '--'}</div>
                          <div className="text-slate-500 font-semibold">{c.phone || c.normalizedPhone || '--'}</div>
                        </div>
                      ))}
                      {associatedContacts.length > 3 && !showAllAssoc.contacts ? (
                        <button
                          type="button"
                          onClick={() => setShowAllAssoc((p) => ({ ...p, contacts: true }))}
                          className="text-[11px] font-semibold text-sky-700 hover:underline cursor-pointer"
                        >
                          Exibir todos os contatos associados
                        </button>
                      ) : associatedContacts.length > 0 ? (
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-sky-700 hover:underline cursor-pointer"
                          onClick={() => setShowAllAssoc((p) => ({ ...p, contacts: true }))}
                        >
                          Exibir todos os contatos associados
                        </button>
                      ) : null}
                    </div>
                  ),
                },
                {
                  id: 'companies',
                  title: 'Empresas',
                  count: associatedCompanies.length,
                  visible: true,
                  emptyHint: 'Veja as empresas associadas a este registro.',
                  addSoon: true,
                  body: associatedCompanies.length === 0 ? null : (
                    <div className="space-y-3">
                      {associatedCompanies.slice(0, companyLimit).map((co, idx) => {
                        const domain = (co.domain || '').trim();
                        const domainHref = companyDomainUrl(co);
                        return (
                          <div key={co.id} className="text-xs space-y-1">
                            <div className="flex items-start gap-2">
                              <span className="w-7 h-7 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                                <Building2 className="w-3.5 h-3.5 text-slate-500" />
                              </span>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-semibold text-slate-900 truncate">{co.name}</span>
                                  {idx === 0 || co.id === deal.companyId ? (
                                    <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[9px] font-semibold">
                                      Principal
                                    </span>
                                  ) : null}
                                </div>
                                <div className="mt-1">
                                  <div className="text-[10px] font-semibold text-slate-400">Nome de domínio</div>
                                  {domainHref ? (
                                    <div className="flex items-center gap-1.5">
                                      <a
                                        href={domainHref}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1 text-sky-700 font-semibold hover:underline break-all"
                                      >
                                        {domain} <ExternalLink className="w-3 h-3 shrink-0" />
                                      </a>
                                      <button
                                        type="button"
                                        title="Copiar domínio"
                                        className="p-0.5 rounded border border-slate-200 text-slate-500 cursor-pointer"
                                        onClick={async () => {
                                          try {
                                            await navigator.clipboard.writeText(domain);
                                            onShowToast?.('Domínio copiado.');
                                          } catch {
                                            onShowToast?.('Não foi possível copiar.');
                                          }
                                        }}
                                      >
                                        <Copy className="w-3 h-3" />
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="font-semibold text-slate-500">--</div>
                                  )}
                                </div>
                                <div className="mt-1">
                                  <div className="text-[10px] font-semibold text-slate-400">Telefone</div>
                                  <div className="font-semibold text-slate-700">{companyPhone(co)}</div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {associatedCompanies.length > 0 ? (
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-sky-700 hover:underline cursor-pointer"
                          onClick={() => setShowAllAssoc((p) => ({ ...p, companies: true }))}
                        >
                          Exibir todas as empresas associadas
                        </button>
                      ) : null}
                    </div>
                  ),
                },
                {
                  id: 'tickets',
                  title: 'Tickets/Chamados',
                  count: canViewChamados ? associatedTickets.length : 0,
                  visible: true,
                  emptyHint: 'Acompanhe as solicitações dos clientes associadas a este registro.',
                  addSoon: true,
                  body:
                    !canViewChamados || associatedTickets.length === 0 ? null : (
                      <div className="space-y-2">
                        {associatedTickets.slice(0, showAllAssoc.tickets ? associatedTickets.length : 5).map((tk) => (
                          <div key={tk.id} className="rounded-md border border-slate-200 p-2 text-xs space-y-0.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-[10px] font-semibold text-slate-500">{tk.key}</span>
                              <span className="text-[9px] font-semibold text-slate-500">{tk.status}</span>
                            </div>
                            <div className="font-semibold text-slate-900 line-clamp-2">{tk.subject}</div>
                            <div className="text-[10px] text-slate-500 font-semibold">
                              {tk.priority} · {tk.assignee}
                            </div>
                          </div>
                        ))}
                      </div>
                    ),
                },
                {
                  id: 'deals',
                  title: 'Negócios',
                  count: relatedDeals.length,
                  visible: true,
                  emptyHint: 'Acompanhe as oportunidades de receita associadas a este registro.',
                  addSoon: true,
                  body: relatedDeals.length === 0 ? null : (
                    <div className="space-y-2">
                      {relatedDeals.slice(0, 6).map((d) => (
                        <div key={d.id} className="text-xs space-y-0.5 rounded-md border border-slate-200 p-2">
                          <div className="font-semibold text-slate-900 line-clamp-2">{d.title}</div>
                          <div className="text-slate-500 font-semibold">
                            {d.stageName || '--'} · {formatBRL(d.value)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ),
                },
                {
                  id: 'proposals',
                  title: 'Propostas',
                  count: proposals.length,
                  visible: true,
                  emptyHint: 'Nenhuma proposta vinculada a este negócio.',
                  onAdd: onGenerateProposal,
                  body: (
                    <div className="space-y-2">
                      {proposals.length === 0 ? null : (
                        proposals.map((prop) => (
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
                        ))
                      )}
                      <button
                        type="button"
                        disabled={generatingProposal}
                        onClick={onGenerateProposal}
                        className="w-full py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                      >
                        {generatingProposal ? 'Gerando...' : 'Criar proposta'}
                      </button>
                    </div>
                  ),
                },
                {
                  id: 'contracts',
                  title: 'Contratos/Pagamentos',
                  count: contracts.length,
                  visible: true,
                  emptyHint: 'Nenhum contrato associado a esta empresa.',
                  addSoon: !onNavigateToErp,
                  onAdd: onNavigateToErp,
                  body: contracts.length === 0 ? null : (
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
                      {onNavigateToErp ? (
                        <button
                          type="button"
                          onClick={onNavigateToErp}
                          className="text-[11px] font-semibold text-sky-700 hover:underline cursor-pointer"
                        >
                          Abrir no ERP
                        </button>
                      ) : null}
                    </div>
                  ),
                },
                {
                  id: 'payment_links',
                  title: 'Links de pagamento',
                  count: 0,
                  visible: true,
                  emptyHint:
                    'Adicione um link de pagamento para aceitar um pagamento e associá-lo a este registro.',
                  addSoon: true,
                  body: null,
                },
                {
                  id: 'subscriptions',
                  title: 'Assinaturas',
                  count: 0,
                  visible: true,
                  emptyHint: 'Automatize o gerenciamento de assinaturas e a cobrança recorrente a partir deste registro.',
                  addSoon: true,
                  body: null,
                },
                {
                  id: 'payments',
                  title: 'Pagamentos',
                  count: canViewFinance ? financeCount : 0,
                  visible: canViewFinance,
                  emptyHint: 'Acompanhe os pagamentos associados a este registro.',
                  addSoon: true,
                  body:
                    !canViewFinance || financeCount === 0 ? null : (
                      <div className="space-y-2">
                        {associatedFinance.invoices.slice(0, 5).map((inv) => (
                          <div key={inv.id} className="rounded-md border border-slate-200 p-2 text-xs space-y-0.5">
                            <div className="flex justify-between gap-2">
                              <span className="font-semibold text-slate-900">{inv.documentNumber}</span>
                              <span className="text-[9px] font-semibold text-slate-500">{inv.status}</span>
                            </div>
                            <div className="text-slate-500 font-semibold">{inv.documentType}</div>
                            <div className="text-[10px] text-slate-500 font-semibold">
                              {formatBRL(inv.netAmount)} · venc. {formatPropDateTime(inv.dueDate).slice(0, 10)}
                            </div>
                          </div>
                        ))}
                        {associatedFinance.entries.slice(0, 5).map((en) => (
                          <div key={en.id} className="rounded-md border border-slate-200 p-2 text-xs space-y-0.5">
                            <div className="flex justify-between gap-2">
                              <span className="font-semibold text-slate-900">
                                {en.type === 'RECEBER' ? 'Receber' : 'Pagar'}
                              </span>
                              <span className="text-[9px] font-semibold text-slate-500">{en.status}</span>
                            </div>
                            <div className="text-slate-600 font-semibold line-clamp-2">{en.description}</div>
                            <div className="text-[10px] text-slate-500 font-semibold">
                              {formatBRL(en.amount)} · venc. {formatPropDateTime(en.dueDate).slice(0, 10)}
                            </div>
                          </div>
                        ))}
                      </div>
                    ),
                },
              ];

              return cards
                .filter((c) => c.visible)

                .map((card) => {
                  const open = !collapsedCards[card.id];
                  return (
                    <div key={card.id} className="rounded-lg border border-slate-200 overflow-hidden">
                      <div className="w-full px-3 py-2 flex items-center gap-2 bg-slate-50 border-b border-slate-100">
                        <button
                          type="button"
                          onClick={() => toggleCard(card.id)}
                          className="flex items-center gap-1.5 min-w-0 flex-1 text-left cursor-pointer"
                        >
                          {open ? (
                            <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                          )}
                          <span className="text-xs font-semibold text-slate-800 truncate">
                            {card.title} ({card.count})
                          </span>
                        </button>
                        {card.addSoon || !card.onAdd ? (
                          <span
                            title="Em breve"
                            className="text-[11px] font-semibold text-slate-300 cursor-not-allowed shrink-0 select-none"
                          >
                            + Adicionar
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              card.onAdd?.();
                            }}
                            className="text-[11px] font-semibold text-accent hover:underline cursor-pointer shrink-0"
                          >
                            + Adicionar
                          </button>
                        )}
                        <button
                          type="button"
                          title="Configurações do cartão"
                          className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Settings className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {open && (
                        <div className="p-3">
                          {card.body ? (
                            card.body
                          ) : (
                            <p className="text-xs font-semibold text-slate-400">{card.emptyHint}</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                });
            })()}
          </aside>
        </div>
      </div>
    </div>
  );
}
