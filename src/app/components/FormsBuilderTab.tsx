'use client';

import React, { useState } from 'react';
import {
  FileCode2,
  Plus,
  Send,
  CheckCircle2,
  Copy,
  Sparkles,
  ExternalLink,
  Eye,
  Layers,
  Ticket,
  Briefcase,
  ArrowUpRight,
  UploadCloud,
  RefreshCw,
  Download,
  Trash2,
  Filter,
} from 'lucide-react';
import {
  FormSubmission,
  LifecycleStage,
  WebForm,
  WebFormField,
  WebFormFieldType,
  WebFormTargetType,
} from '../../db/types';
import { formatDateTimeBR, getLifecycleBadge } from './ui-helpers';
import {
  GESTAOCLICK_ALL_76_ENDPOINTS,
  GESTAOCLICK_FULL_RESOURCE_SCHEMAS,
} from '../../modules/erp/gestaoclick-schema-catalog';
import { MarketingHubSuiteTop, MarketingHubSubView } from './MarketingAndSalesHubSuites';
import ClientEmailComposerModal, { ClientEmailInitialPayload } from './ClientEmailComposerModal';

export interface FormsSummary {
  totalForms: number;
  activeForms: number;
  totalViews: number;
  totalSubmissions: number;
  avgConversionRate: number;
}

export interface HubSpotMigrationReport {
  source: string;
  companiesImported: number;
  contactsImported: number;
  dealsImported: number;
  ticketsImported: number;
  enrichedRecords: number;
}

interface FormsBuilderTabProps {
  forms: WebForm[];
  submissions: FormSubmission[];
  summary: FormsSummary;
  onSubmitForm: (payload: {
    formId: string;
    values: Record<string, string>;
  }) => Promise<{
    contactName?: string;
    dealTitle?: string | null;
    ticketKey?: string | null;
  } | null>;
  onCreateForm: (payload: {
    name: string;
    title: string;
    description: string;
    targetType: WebFormTargetType;
    lifecycleStageOnSubmit: LifecycleStage;
    autoCreateDeal: boolean;
    autoCreateTicket: boolean;
    submitButtonText: string;
    fields: WebFormField[];
  }) => Promise<void>;
  onRunHubSpotMigration: (payload: {
    accessToken?: string;
    autoClean?: boolean;
  }) => Promise<HubSpotMigrationReport | null>;
  onNavigateToServiceDesk?: () => void;
  onNavigateToDeals?: () => void;
  /** Sub-visão controlada do Marketing Hub (aberta pela barra lateral do CRM). */
  marketingView?: MarketingHubSubView;
  onMarketingViewChange?: (v: MarketingHubSubView) => void;
  onMarketingEmailsCountChange?: (count: number) => void;
}

const SIMULATOR_PRESETS: Array<{
  label: string;
  values: Record<string, string>;
}> = [
  {
    label: 'Executivo TI (Stone Pagamentos)',
    values: {
      firstName: 'Eduardo',
      lastName: 'Gomes',
      email: 'eduardo.gomes@stone.com.br',
      phone: '(11) 98711-2233',
      jobTitle: 'VP de Tecnologia',
      companyName: 'Stone Pagamentos S.A.',
      subject: 'Dúvida sobre SLA de Webhook em Produção',
      priority: 'HIGH',
      description: 'Precisamos validar a taxa de transferência para 500 req/s no cluster dedicado.',
      utm_source: 'linkedin',
      utm_medium: 'cpc',
      utm_campaign: 'abm-q4-locacao-sv31',
      lgpdConsent: 'true',
    },
  },
  {
    label: 'Cotação Locação PABX & Redes (Seta Telecom)',
    values: {
      firstName: 'Roberto',
      lastName: 'Almeida',
      email: 'roberto.almeida@totvs.com.br',
      phone: '(11) 99123-4567',
      jobTitle: 'Diretor de Infraestrutura & Telecom',
      companyName: 'TOTVS S.A.',
      subject: 'Cotação de Locação 120 Ramais IP + Firewall SD-WAN (24 meses)',
      priority: 'HIGH',
      description: 'Solicitamos proposta comercial de locação de equipamentos (Súmula Vinculante 31 STF) para matriz SP.',
      utm_source: 'google',
      utm_medium: 'organic',
      utm_campaign: 'modernizacao-pabx-ip-ha',
      lgpdConsent: 'true',
    },
  },
  {
    label: 'Chamado Crítico NOC P1 (Service Desk)',
    values: {
      firstName: 'Fernanda',
      lastName: 'Costa',
      email: 'fernanda.costa@nubank.com.br',
      phone: '(11) 97654-3210',
      jobTitle: 'Head de Operações NOC',
      companyName: 'Nu Pagamentos S.A.',
      subject: 'INCIDENTE P1: Queda de Tronco SIP Principal',
      priority: 'CRITICAL',
      description: 'Acionamento imediato de SLA 24x7 para failover de gateway de voz.',
      utm_source: 'portal',
      utm_medium: 'direct',
      utm_campaign: 'sdwan-fortigate-renovacao-gc',
      lgpdConsent: 'true',
    },
  },
];

export default function FormsBuilderTab({
  forms,
  submissions,
  summary,
  onSubmitForm,
  onCreateForm,
  onRunHubSpotMigration,
  onNavigateToServiceDesk,
  onNavigateToDeals,
  marketingView,
  onMarketingViewChange,
  onMarketingEmailsCountChange,
}: FormsBuilderTabProps) {
  const [selectedFormId, setSelectedFormId] = useState<string>(
    forms[0]?.id || 'form-enterprise-demo'
  );
  const [subTab, setSubTab] = useState<
    'PREVIEW_SIMULATOR' | 'EMBED_CODE' | 'SUBMISSIONS' | 'HUBSPOT_MIGRATION'
  >('PREVIEW_SIMULATOR');

  // Live form simulator values
  const [simValues, setSimValues] = useState<Record<string, string>>(SIMULATOR_PRESETS[0].values);
  const [submittingSim, setSubmittingSim] = useState(false);
  const [lastSimResult, setLastSimResult] = useState<{
    contactName?: string;
    dealTitle?: string | null;
    ticketKey?: string | null;
  } | null>(null);

  // Submissions filter
  const [submissionFilterFormId, setSubmissionFilterFormId] = useState<string>('ALL');

  // Embed snippet copy state
  const [copiedEmbed, setCopiedEmbed] = useState(false);

  // Create new form modal + dynamic fields editor
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [internalMktView, setInternalMktView] = useState<MarketingHubSubView>(
    marketingView || 'CAMPAIGNS_ROI'
  );
  const mktView = marketingView ?? internalMktView;
  const setMktView = (v: MarketingHubSubView) => {
    setInternalMktView(v);
    onMarketingViewChange?.(v);
  };
  const [mktEmailPayload, setMktEmailPayload] = useState<ClientEmailInitialPayload | null>(null);
  const [newName, setNewName] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newTargetType, setNewTargetType] = useState<WebFormTargetType>('LEAD_CAPTURE');
  const [newStage, setNewStage] = useState<LifecycleStage>('MQL');
  const [newAutoDeal, setNewAutoDeal] = useState(true);
  const [newAutoTicket, setNewAutoTicket] = useState(false);
  const [newBtnText, setNewBtnText] = useState('Solicitar Contato Executivo');
  const [customFields, setCustomFields] = useState<WebFormField[]>([
    { name: 'firstName', label: 'Nome', type: 'TEXT', required: true },
    { name: 'lastName', label: 'Sobrenome', type: 'TEXT', required: true },
    { name: 'email', label: 'E-mail Corporativo', type: 'EMAIL', required: true },
    { name: 'phone', label: 'WhatsApp / Telefone', type: 'PHONE', required: false },
    { name: 'jobTitle', label: 'Cargo', type: 'TEXT', required: false },
    { name: 'companyName', label: 'Empresa', type: 'COMPANY', required: false },
  ]);
  const [draftFieldName, setDraftFieldName] = useState('');
  const [draftFieldLabel, setDraftFieldLabel] = useState('');
  const [draftFieldType, setDraftFieldType] = useState<WebFormFieldType>('TEXT');
  const [draftFieldReq, setDraftFieldReq] = useState(false);

  // HubSpot Migration state
  const [hsToken, setHsToken] = useState('pat-na1-8f92a3c4-hubspot-enterprise-token');
  const [hsAutoClean, setHsAutoClean] = useState(true);
  const [migratingHs, setMigratingHs] = useState(false);
  const [migrationReport, setMigrationReport] = useState<HubSpotMigrationReport | null>(null);
  const [selectedSchemaModulo, setSelectedSchemaModulo] = useState<string>('ALL');
  const [selectedResourceKey, setSelectedResourceKey] = useState<string>('clientes');

  const selectedForm = forms.find((f) => f.id === selectedFormId) || forms[0];

  const filteredSubmissions =
    submissionFilterFormId === 'ALL'
      ? submissions
      : submissions.filter((s) => s.formId === submissionFilterFormId);

  const embedSnippet = selectedForm
    ? `<!-- STI-hub (Seta Telecom CRM & ERP) — Formulário Inteligente (${selectedForm.name}) -->
<div id="hubspot-pro-form-${selectedForm.slug}"></div>
<script>
  (function() {
    window.HubSpotProCRM = window.HubSpotProCRM || {};
    window.HubSpotProCRM.renderForm({
      formId: "${selectedForm.id}",
      slug: "${selectedForm.slug}",
      endpoint: "${typeof window !== 'undefined' ? window.location.origin : 'https://seu-crm.com'}/api/forms/submit",
      target: "#hubspot-pro-form-${selectedForm.slug}",
      autoEnrichCorporateDomain: true
    });
  })();
</script>`
    : '';

  const handleCopyEmbed = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(embedSnippet);
      setCopiedEmbed(true);
      setTimeout(() => setCopiedEmbed(false), 2500);
    }
  };

  const handleExportSubmissionsCsv = () => {
    if (typeof window === 'undefined' || filteredSubmissions.length === 0) return;
    const headers = ['ID', 'Formulario', 'Nome', 'Email', 'Telefone', 'Empresa', 'DealID', 'TicketID', 'DataHora'];
    const rows = filteredSubmissions.map((s) => [
      s.id,
      `"${(s.formName || '').replace(/"/g, '""')}"`,
      `"${`${s.values.firstName || ''} ${s.values.lastName || ''}`.trim()}"`,
      s.values.email || '',
      s.values.phone || '',
      `"${(s.values.companyName || '').replace(/"/g, '""')}"`,
      s.dealId || '',
      s.ticketId || '',
      s.submittedAt,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `submissoes-formularios-stihub-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRunSimulator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedForm) return;
    setSubmittingSim(true);
    setLastSimResult(null);
    try {
      const res = await onSubmitForm({
        formId: selectedForm.id,
        values: simValues,
      });
      if (res) {
        setLastSimResult(res);
      }
    } finally {
      setSubmittingSim(false);
    }
  };

  const handleAddCustomField = () => {
    const label = draftFieldLabel.trim();
    if (!label) return;
    const slugName =
      draftFieldName.trim() ||
      label
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_');
    setCustomFields((prev) => [
      ...prev,
      {
        name: slugName,
        label,
        type: draftFieldType,
        required: draftFieldReq,
        options: draftFieldType === 'SELECT' ? ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] : undefined,
      },
    ]);
    setDraftFieldName('');
    setDraftFieldLabel('');
    setDraftFieldReq(false);
  };

  const handleTargetTypeChange = (t: WebFormTargetType) => {
    setNewTargetType(t);
    if (t === 'SUPPORT_TICKET') {
      setCustomFields([
        { name: 'firstName', label: 'Nome', type: 'TEXT', required: true },
        { name: 'email', label: 'E-mail Corporativo', type: 'EMAIL', required: true },
        { name: 'subject', label: 'Assunto do Chamado', type: 'TEXT', required: true },
        {
          name: 'priority',
          label: 'Prioridade',
          type: 'SELECT',
          required: true,
          options: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
        },
        { name: 'description', label: 'Descrição Detalhada', type: 'TEXTAREA', required: true },
      ]);
    } else {
      setCustomFields([
        { name: 'firstName', label: 'Nome', type: 'TEXT', required: true },
        { name: 'lastName', label: 'Sobrenome', type: 'TEXT', required: true },
        { name: 'email', label: 'E-mail Corporativo', type: 'EMAIL', required: true },
        { name: 'phone', label: 'WhatsApp / Telefone', type: 'PHONE', required: false },
        { name: 'jobTitle', label: 'Cargo', type: 'TEXT', required: false },
        { name: 'companyName', label: 'Empresa', type: 'COMPANY', required: false },
      ]);
    }
  };

  const handleCreateNewForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await onCreateForm({
      name: newName.trim(),
      title: newTitle.trim() || newName.trim(),
      description:
        newDesc.trim() || 'Formulário web com enriquecimento automático e roteamento inteligente.',
      targetType: newTargetType,
      lifecycleStageOnSubmit: newStage,
      autoCreateDeal: newAutoDeal,
      autoCreateTicket: newAutoTicket || newTargetType === 'SUPPORT_TICKET',
      submitButtonText: newBtnText.trim() || 'Enviar',
      fields: customFields.length > 0 ? customFields : [
        { name: 'firstName', label: 'Nome', type: 'TEXT', required: true },
        { name: 'email', label: 'E-mail Corporativo', type: 'EMAIL', required: true },
      ],
    });
    setNewName('');
    setNewTitle('');
    setNewDesc('');
    setShowCreateModal(false);
  };

  const handleRunMigration = async () => {
    setMigratingHs(true);
    try {
      const rep = await onRunHubSpotMigration({
        accessToken: hsToken,
        autoClean: hsAutoClean,
      });
      if (rep) setMigrationReport(rep);
    } finally {
      setMigratingHs(false);
    }
  };

  return (
    <div className="space-y-6">
      {mktEmailPayload && (
        <ClientEmailComposerModal
          payload={mktEmailPayload}
          onClose={() => setMktEmailPayload(null)}
        />
      )}
      <MarketingHubSuiteTop
        activeView={mktView}
        onSelectView={setMktView}
        onOpenEmailModal={(p) => setMktEmailPayload(p)}
        onMarketingEmailsCountChange={onMarketingEmailsCountChange}
      />
      {/* Na sub-visão "E-mails de Marketing" a tela fica dedicada à listagem (sem o construtor de formulários abaixo). */}
      <div className={mktView === 'MARKETING_EMAILS' ? 'hidden' : 'space-y-6'}>
      {/* TOP KPI STRIP */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <span className="text-xs font-semibold text-slate-500">
            Formulários Ativos (Marketing &amp; Portal)
          </span>
          <div className="text-2xl font-semibold text-slate-900 mt-1">
            {summary.activeForms} / {summary.totalForms}
          </div>
          <span className="text-[11px] text-emerald-600 font-semibold">
            Conectados ao Enriquecimento &amp; Workflows
          </span>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <span className="text-xs font-semibold text-slate-500">Visualizações Totais (Embed)</span>
          <div className="text-2xl font-semibold text-slate-900 mt-1">
            {summary.totalViews.toLocaleString('pt-BR')}
          </div>
          <span className="text-[11px] text-slate-500">Site institucional + Portal do Cliente</span>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <span className="text-xs font-semibold text-slate-500">Leads &amp; Chamados Convertidos</span>
          <div className="text-2xl font-semibold text-[#ff7a59] mt-1">
            {summary.totalSubmissions.toLocaleString('pt-BR')}
          </div>
          <span className="text-[11px] text-slate-500">Submissões auditadas na Timeline</span>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <span className="text-xs font-semibold text-slate-500">Taxa Média de Conversão</span>
          <div className="text-2xl font-semibold text-emerald-600 mt-1">
            {summary.avgConversionRate}%
          </div>
          <span className="text-[11px] text-emerald-700 font-semibold">
            Acima do benchmark B2B (12%)
          </span>
        </div>
      </div>

      {/* ACTION BAR & SUBTABS */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab('PREVIEW_SIMULATOR')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
              subTab === 'PREVIEW_SIMULATOR'
                ? 'bg-[#ff7a59] text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            Construtor &amp; Simulador ao Vivo
          </button>

          <button
            type="button"
            onClick={() => setSubTab('EMBED_CODE')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
              subTab === 'EMBED_CODE'
                ? 'bg-[#ff7a59] text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <FileCode2 className="w-3.5 h-3.5" />
            Código Embed para o Site (&lt;script&gt;)
          </button>

          <button
            type="button"
            onClick={() => setSubTab('SUBMISSIONS')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
              subTab === 'SUBMISSIONS'
                ? 'bg-[#ff7a59] text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Submissões Recentes ({submissions.length})
          </button>

          <button
            type="button"
            onClick={() => setSubTab('HUBSPOT_MIGRATION')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
              subTab === 'HUBSPOT_MIGRATION'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200'
            }`}
          >
            <UploadCloud className="w-3.5 h-3.5" />
            Migração &amp; Sync HubSpot / GestãoClick
          </button>
        </div>

        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-sm transition"
        >
          <Plus className="w-4 h-4 text-[#ff7a59]" />
          Criar Novo Formulário
        </button>
      </div>

      {/* MAIN CONTENT BY SUBTAB */}
      {subTab === 'HUBSPOT_MIGRATION' ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                <UploadCloud className="w-3.5 h-3.5" />
                HubSpot API v3 &amp; Ponte Bidirecional GestãoClick ERP (#118887)
              </span>
              <h2 className="text-lg font-semibold text-slate-900 mt-2">
                Assistente de Migração &amp; Sincronização HubSpot - STI-hub - GestãoClick
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Importa Contatos (`firstname`, `lastname`, `email`), Empresas (`domain`, `cnpj`),
                Negócios (`dealname`, `amount`) e Tickets (`hs_ticket_priority`) aplicando
                deduplicação, enriquecimento por domínio e vínculo com clientes do GestãoClick.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  HubSpot Private App Token (ou Simulação de Payload Oficial v3)
                </label>
                <input
                  type="text"
                  value={hsToken}
                  onChange={(e) => setHsToken(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-mono text-slate-800 bg-slate-50"
                />
              </div>

              <label className="flex items-center gap-2.5 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hsAutoClean}
                  onChange={(e) => setHsAutoClean(e.target.checked)}
                  className="rounded border-slate-300 text-[#ff7a59]"
                />
                Executar Motor de Data Health &amp; Deduplicação Automática após importar
              </label>

              <button
                type="button"
                disabled={migratingHs}
                onClick={handleRunMigration}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#ff7a59] hover:bg-[#e05835] text-white text-xs font-semibold shadow-sm transition disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${migratingHs ? 'animate-spin' : ''}`} />
                {migratingHs
                  ? 'Importando & Higienizando Registros...'
                  : 'Importar Lote Enterprise do HubSpot Agora'}
              </button>

              {/* Matriz de Mapeamento Triplo */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
                <div className="font-semibold text-slate-800 uppercase tracking-wider text-[11px]">
                  Matriz de Sincronização (HubSpot v3 - STI-hub - GestãoClick ERP)
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px] font-semibold text-slate-600 border-b border-slate-200 pb-1">
                  <span>HubSpot CRM</span>
                  <span>STI-hub (Local/PG)</span>
                  <span>GestãoClick ERP</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-700">
                  <span>Companies (`cnpj`)</span>
                  <span>Company (Score 0-100)</span>
                  <span>`/clientes` (PJ #118887)</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-700">
                  <span>Contacts (`email`)</span>
                  <span>Contact + Lead Score</span>
                  <span>Responsável / Compras</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-700">
                  <span>Deals (`amount`)</span>
                  <span>Deal Kanban (3 Funis)</span>
                  <span>`/orcamentos` &amp; `/contratos`</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-700">
                  <span>Tickets (`priority`)</span>
                  <span>Service Desk SLA</span>
                  <span>`/ordens_servicos` (O.S.)</span>
                </div>
              </div>
            </div>

            <div className="bg-slate-900 text-slate-200 rounded-2xl p-5 space-y-3 border border-slate-800">
              <div className="text-xs font-semibold text-[#ff987f] uppercase tracking-wider">
                O que este lote sincroniza (Preview HubSpot CRM v3)
              </div>
              <ul className="text-xs space-y-2 text-slate-300">
                <li>
                  • <strong>Empresas Enterprise:</strong> iFood (`ifood.com.br`) e WEG (`weg.net`) com CNPJ e receita validados.
                </li>
                <li>
                  • <strong>Contatos Executivos:</strong> Diego Barreto (VP iFood) e Helena Zimmermann (Diretora Global TI WEG).
                </li>
                <li>
                  • <strong>Negócios no Funil Kanban:</strong> R$ 420.000 (iFood) + R$ 390.000 (WEG).
                </li>
                <li>
                  • <strong>Chamado no Service Desk:</strong> Ticket de migração de Webhooks com SLA ativo.
                </li>
              </ul>

              {migrationReport && (
                <div className="mt-4 p-4 rounded-xl bg-emerald-950/80 border border-emerald-700/60 text-emerald-200 space-y-1.5">
                  <div className="flex items-center gap-2 font-semibold text-xs text-emerald-300">
                    <CheckCircle2 className="w-4 h-4" />
                    Migração Concluída ({migrationReport.source})
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                    <div>Empresas importadas: <strong>{migrationReport.companiesImported}</strong></div>
                    <div>Contatos importados: <strong>{migrationReport.contactsImported}</strong></div>
                    <div>Deals adicionados: <strong>{migrationReport.dealsImported}</strong></div>
                    <div>Tickets JSM criados: <strong>{migrationReport.ticketsImported}</strong></div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* DICIONÁRIO COMPLETO DE MENUS, TABELAS (76 RECURSOS) E CAMPOS DO GESTÃOCLICK (#118887) */}
          <div className="pt-5 border-t border-slate-200 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Dicionário Completo de Menus, Tabelas ({GESTAOCLICK_ALL_76_ENDPOINTS.length} Recursos MCP/REST) &amp; Campos — GestãoClick #118887 - HubSpot v3
                </h3>
                <p className="text-xs text-slate-600">
                  Mapeamento 1:1 de todas as tabelas, campos raiz, sub-objetos aninhados e contagens reais da Seta Telecom (GET /api/erp/gestaoclick/schema).
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { id: 'ALL', label: 'Todos os Módulos' },
                  { id: 'core', label: 'Cadastros & Itens (core)' },
                  { id: 'pedidos', label: 'Orçamentos, Vendas & O.S.' },
                  { id: 'contratos', label: 'Contratos & Locações' },
                  { id: 'financeiro', label: 'Financeiro & Bancos' },
                  { id: 'fiscal', label: 'Fiscal (NF-e / NFS-e)' },
                  { id: 'estoque', label: 'Estoque & Compras' },
                  { id: 'crm', label: 'CRM & Tarefas' },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedSchemaModulo(m.id)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                      selectedSchemaModulo === m.id
                        ? 'bg-[#1e3a6e] text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-5 max-h-96 overflow-y-auto space-y-2 pr-1">
                {GESTAOCLICK_FULL_RESOURCE_SCHEMAS.filter(
                  (s) => selectedSchemaModulo === 'ALL' || s.modulo === selectedSchemaModulo
                ).map((s) => {
                  const isSel = selectedResourceKey === s.recurso;
                  return (
                    <button
                      key={s.recurso}
                      type="button"
                      onClick={() => setSelectedResourceKey(s.recurso)}
                      className={`w-full text-left p-3 rounded-xl border transition cursor-pointer ${
                        isSel
                          ? 'bg-blue-50/80 border-[#1e3a6e] shadow-2xs'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-[#1e3a6e]">
                          {s.caminho}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-semibold">
                          {s.totalRegistrosLoja118887.toLocaleString('pt-BR')} reg.
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-slate-800 mt-1">
                        {s.menuGroup} → {s.menuSubItem}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 flex items-center justify-between">
                        <span>{s.fields.length} campos mapeados</span>
                        <span>Módulo: {s.modulo}</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="lg:col-span-7">
                {(() => {
                  const activeSchema =
                    GESTAOCLICK_FULL_RESOURCE_SCHEMAS.find((s) => s.recurso === selectedResourceKey) ||
                    GESTAOCLICK_FULL_RESOURCE_SCHEMAS[0];
                  if (!activeSchema) return null;
                  return (
                    <div className="p-4 rounded-2xl bg-slate-900 text-slate-100 border border-slate-800 space-y-3 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                        <div>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#ff987f]">
                            Menu: {activeSchema.menuGroup} • {activeSchema.menuSubItem}
                          </span>
                          <h4 className="text-sm font-semibold text-white font-mono mt-0.5">
                            {activeSchema.caminho} ({activeSchema.totalRegistrosLoja118887.toLocaleString('pt-BR')} registros na Loja #118887)
                          </h4>
                        </div>
                        <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-emerald-300 font-mono text-[11px] font-semibold">
                          Ações: {activeSchema.acoes.join(', ')}
                        </span>
                      </div>

                      <div>
                        <div className="text-[11px] font-semibold text-slate-400 uppercase mb-1.5">
                          Todos os Campos Raiz ({activeSchema.fields.length} campos):
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {activeSchema.fields.map((f) => (
                            <code
                              key={f}
                              className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-emerald-300 font-mono text-[11px]"
                            >
                              {f}
                            </code>
                          ))}
                        </div>
                      </div>

                      {activeSchema.nestedStructures && (
                        <div className="space-y-1.5 pt-1">
                          <div className="text-[11px] font-semibold text-slate-400 uppercase">
                            Sub-tabelas / Objetos Aninhados:
                          </div>
                          {Object.entries(activeSchema.nestedStructures).map(([nestedKey, nestedFields]) => (
                            <div
                              key={nestedKey}
                              className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1"
                            >
                              <div className="font-mono font-semibold text-amber-300 text-[11px]">
                                {nestedKey}
                              </div>
                              <div className="text-[11px] text-slate-300 font-mono">
                                {nestedFields.join(', ')}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="pt-2 border-t border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                        <div className="p-2.5 rounded-xl bg-slate-800/70">
                          <span className="text-slate-400 block">Destino no STI-hub:</span>
                          <strong className="text-white font-mono">
                            {activeSchema.stiHubTarget.collection} ({activeSchema.stiHubTarget.primaryKey})
                          </strong>
                        </div>
                        <div className="p-2.5 rounded-xl bg-slate-800/70">
                          <span className="text-slate-400 block">Espelhamento HubSpot CRM v3:</span>
                          <strong className="text-indigo-300 font-mono">
                            {activeSchema.hubspotMapping?.object || 'ERP Nativo STI-hub'}
                          </strong>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* LEFT COLUMN: LIST OF FORMS */}
          <div className="lg:col-span-5 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 px-1">
              Formulários Configurados ({forms.length})
            </h3>
            {forms.map((form) => {
              const isSelected = selectedForm?.id === form.id;
              return (
                <div
                  key={form.id}
                  onClick={() => {
                    setSelectedFormId(form.id);
                    setLastSimResult(null);
                  }}
                  className={`p-4 rounded-2xl border cursor-pointer transition space-y-2.5 ${
                    isSelected
                      ? 'bg-orange-50/70 border-[#ff7a59] shadow-sm'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          form.targetType === 'SUPPORT_TICKET'
                            ? 'bg-purple-100 text-purple-800'
                            : form.targetType === 'DEMO_REQUEST'
                              ? 'bg-orange-100 text-[#e05835]'
                              : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {form.targetType === 'SUPPORT_TICKET'
                          ? 'Portal Service Desk (Abre Ticket JSM)'
                          : form.targetType === 'DEMO_REQUEST'
                            ? 'Fundo de Funil (Cria SQL + Deal)'
                            : 'Captura Inbound (Cria MQL)'}
                      </span>
                      <h4 className="text-sm font-semibold text-slate-900 mt-1">{form.name}</h4>
                    </div>
                    <span className="px-2.5 py-1 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold">
                      {form.conversionRate}% conv.
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 line-clamp-2">{form.description}</p>

                  <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                    <div className="flex items-center gap-2">
                      <span>Estágio:</span>
                      {getLifecycleBadge(form.lifecycleStageOnSubmit)}
                    </div>
                    <div className="font-semibold text-slate-700">
                      {form.submissionsCount} submissões / {form.viewsCount} views
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* RIGHT COLUMN: SIMULATOR OR EMBED CODE OR SUBMISSIONS */}
          <div className="lg:col-span-7">
            {selectedForm && subTab === 'PREVIEW_SIMULATOR' && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#ff7a59]">
                      Simulador Interativo Conectado à API Real
                    </span>
                    <h3 className="text-base font-semibold text-slate-900 mt-0.5">
                      {selectedForm.title}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Preencha ou selecione um preset abaixo para testar entrada do Lead, Enriquecimento
                      Corporativo, Lead Score, Workflows (`FORM_SUBMITTED` + `CONTACT_CREATED`), Deal ou Ticket JSM.
                    </p>
                  </div>
                </div>

                {/* Quick Persona Presets */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-slate-500 mr-1">
                    Preencher Cenário:
                  </span>
                  {SIMULATOR_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setSimValues(preset.values)}
                      className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-orange-50 hover:text-[#e05835] text-[11px] font-semibold text-slate-700 border border-slate-200 transition cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <form onSubmit={handleRunSimulator} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {selectedForm.fields.map((field) => (
                      <div
                        key={field.name}
                        className={field.type === 'TEXTAREA' ? 'sm:col-span-2' : ''}
                      >
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          {field.label}{' '}
                          {field.required && <span className="text-rose-500">*</span>}
                        </label>
                        {field.type === 'TEXTAREA' ? (
                          <textarea
                            rows={3}
                            required={field.required}
                            value={simValues[field.name] || ''}
                            onChange={(e) =>
                              setSimValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                            }
                            placeholder={field.placeholder}
                            className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-[#ff7a59]"
                          />
                        ) : field.type === 'SELECT' ? (
                          <select
                            value={simValues[field.name] || field.options?.[0] || 'HIGH'}
                            onChange={(e) =>
                              setSimValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                            }
                            className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 bg-white focus:outline-none focus:border-[#ff7a59]"
                          >
                            {(field.options || ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={field.type === 'EMAIL' ? 'email' : 'text'}
                            required={field.required}
                            value={simValues[field.name] || ''}
                            onChange={(e) =>
                              setSimValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                            }
                            placeholder={field.placeholder}
                            className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-[#ff7a59]"
                          />
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Rastreamento UTM & Consentimento LGPD (Opt-in Auditado) */}
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[#1e3a6e]">
                        Rastreamento de Atribuição UTM &amp; Conformidade LGPD (Lei nº 13.709/2018)
                      </span>
                      <span className="text-[10px] font-mono text-slate-500">
                        Atribui automaticamente Lead + Deal à Campanha correspondente
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">
                          utm_source
                        </label>
                        <input
                          type="text"
                          value={simValues.utm_source || ''}
                          onChange={(e) =>
                            setSimValues((prev) => ({ ...prev, utm_source: e.target.value }))
                          }
                          placeholder="linkedin / google / email"
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-mono bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">
                          utm_medium
                        </label>
                        <input
                          type="text"
                          value={simValues.utm_medium || ''}
                          onChange={(e) =>
                            setSimValues((prev) => ({ ...prev, utm_medium: e.target.value }))
                          }
                          placeholder="cpc / abm / organic"
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-mono bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">
                          utm_campaign
                        </label>
                        <input
                          type="text"
                          value={simValues.utm_campaign || ''}
                          onChange={(e) =>
                            setSimValues((prev) => ({ ...prev, utm_campaign: e.target.value }))
                          }
                          placeholder="abm-q4-locacao-sv31"
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-mono bg-white"
                        />
                      </div>
                    </div>
                    <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer pt-1">
                      <input
                        type="checkbox"
                        checked={simValues.lgpdConsent !== 'false'}
                        onChange={(e) =>
                          setSimValues((prev) => ({
                            ...prev,
                            lgpdConsent: e.target.checked ? 'true' : 'false',
                          }))
                        }
                        className="mt-0.5 rounded border-slate-300 text-[#ff7a59]"
                      />
                      <span>
                        <strong>Consentimento LGPD (Opt-in):</strong> Autorizo o tratamento dos meus dados corporativos pela Seta Telecom LTDA para contato comercial e envio de conteúdos técnicos, com direito de gerenciar preferências ou descadastrar a qualquer momento.
                      </span>
                    </label>
                  </div>

                  <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-semibold">
                        <Sparkles className="w-3.5 h-3.5 text-[#ff7a59]" />
                        Auto-Enriquecimento + Workflows Ativos
                      </span>
                      {selectedForm.autoCreateDeal && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 font-semibold">
                          <Briefcase className="w-3.5 h-3.5" />
                          Cria Negócio no Kanban
                        </span>
                      )}
                      {(selectedForm.autoCreateTicket ||
                        selectedForm.targetType === 'SUPPORT_TICKET') && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-50 text-purple-700 font-semibold">
                          <Ticket className="w-3.5 h-3.5" />
                          Abre Chamado JSM com SLA
                        </span>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={submittingSim}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#ff7a59] hover:bg-[#e05835] text-white text-xs font-semibold shadow-sm transition disabled:opacity-50"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {submittingSim ? 'Processando Submissão...' : selectedForm.submitButtonText}
                    </button>
                  </div>
                </form>

                {lastSimResult && (
                  <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      Submissão persistida, Lead Score calculado e Workflows disparados!
                    </div>
                    <div className="text-xs text-emerald-900 space-y-1">
                      <div>
                        • Contato criado/atualizado e enriquecido:{' '}
                        <strong>{lastSimResult.contactName}</strong>
                      </div>
                      {lastSimResult.dealTitle && (
                        <div className="flex items-center justify-between">
                          <span>
                            • Oportunidade comercial aberta: <strong>{lastSimResult.dealTitle}</strong>
                          </span>
                          {onNavigateToDeals && (
                            <button
                              type="button"
                              onClick={onNavigateToDeals}
                              className="inline-flex items-center gap-1 text-[#e05835] font-semibold hover:underline"
                            >
                              Ver no Kanban <ArrowUpRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                      {lastSimResult.ticketKey && (
                        <div className="flex items-center justify-between">
                          <span>
                            • Chamado Técnico criado no Service Desk:{' '}
                            <strong className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800">
                              {lastSimResult.ticketKey}
                            </strong>
                          </span>
                          {onNavigateToServiceDesk && (
                            <button
                              type="button"
                              onClick={onNavigateToServiceDesk}
                              className="inline-flex items-center gap-1 text-purple-700 font-semibold hover:underline"
                            >
                              Abrir no Service Desk <ArrowUpRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {selectedForm && subTab === 'EMBED_CODE' && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">
                      Snippet de Incorporação Web (&lt;script&gt;)
                    </h3>
                    <p className="text-xs text-slate-500">
                      Cole este código no site institucional da Seta Telecom, landing page ou no
                      Portal do Cliente.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyEmbed}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition"
                  >
                    <Copy className="w-3.5 h-3.5 text-[#ff7a59]" />
                    {copiedEmbed ? 'Código Copiado!' : 'Copiar Snippet'}
                  </button>
                </div>

                <pre className="p-4 rounded-xl bg-slate-900 text-emerald-300 text-xs font-mono overflow-x-auto leading-relaxed">
                  {embedSnippet}
                </pre>

                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center justify-between">
                  <span>
                    Endpoint REST Direto:{' '}
                    <code className="font-mono font-semibold text-slate-800">
                      POST /api/forms/submit
                    </code>
                  </span>
                  <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                    CORS Habilitado <ExternalLink className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            )}

            {subTab === 'SUBMISSIONS' && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-slate-900">
                    Histórico de Conversões de Formulários ({filteredSubmissions.length})
                  </h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                      <Filter className="w-3.5 h-3.5 text-slate-500" />
                      <select
                        value={submissionFilterFormId}
                        onChange={(e) => setSubmissionFilterFormId(e.target.value)}
                        className="bg-transparent font-semibold text-slate-800 focus:outline-none"
                      >
                        <option value="ALL">Todos os Formulários ({submissions.length})</option>
                        {forms.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={handleExportSubmissionsCsv}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 text-[#ff7a59]" />
                      Exportar CSV
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {filteredSubmissions.map((sub) => (
                    <div
                      key={sub.id}
                      className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                    >
                      <div>
                        <div className="font-semibold text-slate-900">{sub.formName}</div>
                        <div className="text-slate-600 mt-0.5">
                          Lead:{' '}
                          <strong>
                            {sub.values.firstName} {sub.values.lastName}
                          </strong>{' '}
                          ({sub.values.email})
                          {sub.values.companyName ? ` • ${sub.values.companyName}` : ''}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] text-slate-500">
                          {formatDateTimeBR(sub.submittedAt)}
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-1.5 mt-1">
                          {sub.utmCampaign && (
                            <span className="px-2 py-0.5 rounded bg-blue-50 text-[#1e3a6e] font-mono font-semibold text-[10px]">
                              UTM: {sub.utmCampaign}
                            </span>
                          )}
                          {sub.lgpdConsent !== false && (
                            <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold text-[10px]">
                              LGPD Opt-in
                            </span>
                          )}
                          {sub.dealId && (
                            <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-semibold text-[10px]">
                              Deal Criado
                            </span>
                          )}
                          {sub.ticketId && (
                            <span className="px-2 py-0.5 rounded bg-purple-50 text-purple-700 font-semibold text-[10px]">
                              Ticket JSM Criado
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CREATE NEW FORM MODAL WITH DYNAMIC FIELDS BUILDER */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-xl w-full p-6 space-y-4 my-8">
            <h3 className="text-base font-semibold text-slate-900">
              Novo Formulário Inteligente (Construtor Dinâmico de Campos)
            </h3>
            <form onSubmit={handleCreateNewForm} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nome Interno do Formulário *
                  </label>
                  <input
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Ex: Solicitação de Locação PABX Q4"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Título Público no Site
                  </label>
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Ex: Fale com nossa Engenharia Comercial"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Objetivo do Formulário
                  </label>
                  <select
                    value={newTargetType}
                    onChange={(e) => handleTargetTypeChange(e.target.value as WebFormTargetType)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white"
                  >
                    <option value="LEAD_CAPTURE">Captura de Lead (Inbound)</option>
                    <option value="DEMO_REQUEST">Solicitação de Demo / Cotação Locação</option>
                    <option value="SUPPORT_TICKET">Portal de Chamados (Service Desk)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Estágio ao Converter
                  </label>
                  <select
                    value={newStage}
                    onChange={(e) => setNewStage(e.target.value as LifecycleStage)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white"
                  >
                    <option value="LEAD">Lead</option>
                    <option value="MQL">MQL</option>
                    <option value="SQL">SQL Qualificado</option>
                    <option value="OPPORTUNITY">Oportunidade</option>
                    <option value="CUSTOMER">Cliente</option>
                  </select>
                </div>
              </div>

              {/* Dynamic Fields Editor */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800">
                    Campos do Formulário ({customFields.length})
                  </span>
                  <span className="text-[10px] text-slate-500">
                    Adicione ou remova campos personalizados
                  </span>
                </div>

                <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                  {customFields.map((f, idx) => (
                    <div
                      key={`${f.name}-${idx}`}
                      className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-800">{f.label}</span>
                        <code className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                          {f.name} ({f.type})
                        </code>
                        {f.required && (
                          <span className="text-[10px] font-semibold text-rose-600">Obrigatório</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setCustomFields((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="text-slate-400 hover:text-rose-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 pt-1 border-t border-slate-200">
                  <input
                    type="text"
                    value={draftFieldLabel}
                    onChange={(e) => setDraftFieldLabel(e.target.value)}
                    placeholder="Rótulo (ex: Nº de Ramais)"
                    className="sm:col-span-5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs"
                  />
                  <select
                    value={draftFieldType}
                    onChange={(e) => setDraftFieldType(e.target.value as WebFormFieldType)}
                    className="sm:col-span-3 px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-xs"
                  >
                    <option value="TEXT">Texto</option>
                    <option value="EMAIL">E-mail</option>
                    <option value="PHONE">Telefone</option>
                    <option value="COMPANY">Empresa</option>
                    <option value="SELECT">Seleção</option>
                    <option value="TEXTAREA">Texto Longo</option>
                  </select>
                  <label className="sm:col-span-2 flex items-center gap-1 text-[11px] font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={draftFieldReq}
                      onChange={(e) => setDraftFieldReq(e.target.checked)}
                    />
                    Obrig.
                  </label>
                  <button
                    type="button"
                    onClick={handleAddCustomField}
                    className="sm:col-span-2 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                  >
                    + Campo
                  </button>
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={newAutoDeal}
                    onChange={(e) => setNewAutoDeal(e.target.checked)}
                  />
                  Criar negócio automaticamente no Funil Kanban ao converter
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={newAutoTicket || newTargetType === 'SUPPORT_TICKET'}
                    onChange={(e) => setNewAutoTicket(e.target.checked)}
                  />
                  Abrir chamado automaticamente no Service Desk (JSM)
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#ff7a59] text-white text-xs font-semibold"
                >
                  Publicar Formulário
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
