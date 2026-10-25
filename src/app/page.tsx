'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  Kanban,
  Users,
  ShieldCheck,
  Workflow as WorkflowIcon,
  Search,
  RefreshCw,
  TrendingUp,
  Bell,
  CheckCircle2,
  Database,
  Layers,
  ChevronRight,
} from 'lucide-react';

import OverviewAiCopilotTab from './components/OverviewAiCopilotTab';
import DealsKanbanTab, { EnrichedDeal, EnrichedPipeline } from './components/DealsKanbanTab';
import ContactsCompaniesTab, {
  EnrichedCompanyItem,
  EnrichedContactItem,
} from './components/ContactsCompaniesTab';
import DataHealthTab, { DuplicatesPayload } from './components/DataHealthTab';
import AutomationsSequencesTab from './components/AutomationsSequencesTab';
import { EnrichedEnrollment } from './components/SequencesSection';
import { formatBRL } from './components/ui-helpers';

import {
  AiInsightsReport,
  HiddenOpportunityItem,
} from '../modules/ai-insights/ai-insights-service';
import {
  AutoCleanResult,
  DataHealthSummaryReport,
} from '../modules/data-health/health-service';
import {
  EmailSequence,
  LifecycleStage,
  SequenceStep,
  Workflow,
  WorkflowExecution,
  WorkflowStep,
  WorkflowTriggerType,
} from '../db/types';

type ActiveModule = 'OVERVIEW_AI' | 'DEALS_KANBAN' | 'CONTACTS_COMPANIES' | 'DATA_HEALTH' | 'AUTOMATIONS';

export default function HubSpotProCrmApp() {
  const [activeModule, setActiveModule] = useState<ActiveModule>('OVERVIEW_AI');
  const [loadingAll, setLoadingAll] = useState(true);
  const [askingAi, setAskingAi] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [initialContactIdForDrawer, setInitialContactIdForDrawer] = useState<string | null>(null);

  // Real-Time API States
  const [aiReport, setAiReport] = useState<AiInsightsReport | null>(null);
  const [pipelines, setPipelines] = useState<EnrichedPipeline[]>([]);
  const [deals, setDeals] = useState<EnrichedDeal[]>([]);
  const [dealsForecast, setDealsForecast] = useState({
    totalOpenValue: 0,
    weightedOpenValue: 0,
    closedWonValue: 0,
    rottingDealsCount: 0,
  });
  const [contacts, setContacts] = useState<EnrichedContactItem[]>([]);
  const [companies, setCompanies] = useState<EnrichedCompanyItem[]>([]);
  const [healthSummary, setHealthSummary] = useState<DataHealthSummaryReport | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicatesPayload | null>(null);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [workflowExecutions, setWorkflowExecutions] = useState<WorkflowExecution[]>([]);
  const [sequences, setSequences] = useState<EmailSequence[]>([]);
  const [enrollments, setEnrollments] = useState<EnrichedEnrollment[]>([]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

  const fetchAllCrmData = useCallback(async (customAiQuestion?: string) => {
    try {
      const [
        aiRes,
        pipesRes,
        dealsRes,
        contactsRes,
        companiesRes,
        healthRes,
        dupsRes,
        wfRes,
        seqRes,
      ] = await Promise.all([
        customAiQuestion
          ? fetch('/api/ai-insights', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ question: customAiQuestion }),
            })
          : fetch('/api/ai-insights'),
        fetch('/api/pipelines'),
        fetch('/api/deals'),
        fetch('/api/contacts'),
        fetch('/api/companies'),
        fetch('/api/data-health/summary'),
        fetch('/api/data-health/duplicates'),
        fetch('/api/workflows'),
        fetch('/api/sequences'),
      ]);

      if (aiRes.ok) {
        const j = await aiRes.json();
        setAiReport(j.data);
      }
      if (pipesRes.ok) {
        const j = await pipesRes.json();
        setPipelines(j.data || []);
      }
      if (dealsRes.ok) {
        const j = await dealsRes.json();
        setDeals(j.data || []);
        if (j.forecast) setDealsForecast(j.forecast);
      }
      if (contactsRes.ok) {
        const j = await contactsRes.json();
        setContacts(j.data || []);
      }
      if (companiesRes.ok) {
        const j = await companiesRes.json();
        setCompanies(j.data || []);
      }
      if (healthRes.ok) {
        const j = await healthRes.json();
        setHealthSummary(j.data);
      }
      if (dupsRes.ok) {
        const j = await dupsRes.json();
        setDuplicates(j.data);
      }
      if (wfRes.ok) {
        const j = await wfRes.json();
        setWorkflows(j.data || []);
        setWorkflowExecutions(j.executions || []);
      }
      if (seqRes.ok) {
        const j = await seqRes.json();
        setSequences(j.data || []);
        setEnrollments(j.enrollments || []);
      }
    } finally {
      setLoadingAll(false);
    }
  }, []);

  useEffect(() => {
    fetchAllCrmData();
  }, [fetchAllCrmData]);

  // ==========================================================================
  // API ACTION HANDLERS
  // ==========================================================================

  const handleAskAiQuestion = async (question: string) => {
    setAskingAi(true);
    try {
      const res = await fetch('/api/ai-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      if (res.ok) {
        const json = await res.json();
        setAiReport(json.data);
      }
    } finally {
      setAskingAi(false);
    }
  };

  const handleConvertOpportunityToDeal = async (opp: HiddenOpportunityItem) => {
    const payload = {
      title: `${opp.companyName || opp.name} - Expansão Comercial Enterprise`,
      value: opp.estimatedDealValue || 185000,
      stageId: 'stage-sql',
      contactId: opp.entityType === 'CONTACT' ? opp.entityId : null,
      companyId: opp.entityType === 'COMPANY' ? opp.entityId : null,
    };
    const res = await fetch('/api/deals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      showToast(`Oportunidade "${payload.title}" convertida em negócio ativo no Kanban!`);
      await fetchAllCrmData();
      setActiveModule('DEALS_KANBAN');
    }
  };

  const handleRegisterQuickFollowUp = async (item: {
    dealId: string | null;
    contactId: string | null;
    title: string;
    channel: string;
    message: string;
  }) => {
    const type = item.channel === 'CALL' ? 'CALL' : item.channel === 'MEETING' ? 'MEETING' : 'EMAIL';
    const res = await fetch('/api/timeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        title: item.title,
        body: item.message,
        dealId: item.dealId,
        contactId: item.contactId,
        actor: 'Marcéllo Mira',
      }),
    });
    if (res.ok) {
      showToast('Follow-up registrado na Timeline e SLA do negócio atualizado!');
      await fetchAllCrmData();
    }
  };

  const handleMoveDealStage = async (dealId: string, newStageId: string) => {
    const res = await fetch(`/api/deals/${dealId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stageId: newStageId }),
    });
    if (res.ok) {
      const json = await res.json();
      const wfCount = json.workflowExecutions?.length || 0;
      showToast(
        wfCount > 0
          ? `Estágio atualizado e ${wfCount} workflow(s) automático(s) executado(s)!`
          : 'Estágio e forecast atualizados em tempo real!'
      );
      await fetchAllCrmData();
    }
  };

  const handleCreateDeal = async (payload: {
    title: string;
    value: number;
    stageId: string;
    contactId?: string | null;
    companyId?: string | null;
    expectedCloseDate?: string | null;
  }) => {
    const res = await fetch('/api/deals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      showToast(`Novo negócio "${payload.title}" adicionado ao funil!`);
      await fetchAllCrmData();
    }
  };

  const handleAddDealNote = async (dealId: string, title: string, body: string) => {
    const res = await fetch('/api/timeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'NOTE',
        title,
        body,
        dealId,
        actor: 'Marcéllo Mira',
      }),
    });
    if (res.ok) {
      showToast('Nota registrada na timeline do negócio!');
      await fetchAllCrmData();
    }
  };

  const handleCreateContact = async (payload: {
    email: string;
    firstName: string;
    lastName?: string;
    phone?: string;
    jobTitle?: string;
    lifecycleStage?: LifecycleStage;
    companyId?: string;
  }) => {
    const res = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const json = await res.json();
      const wfCount = json.workflowExecutions?.length || 0;
      showToast(
        `Contato ${payload.firstName} criado com sucesso (${wfCount} workflow(s) disparado(s) automaticamente)!`
      );
      await fetchAllCrmData();
    }
  };

  const handleCreateCompany = async (payload: {
    name: string;
    domain?: string;
    cnpj?: string;
    industry?: string;
    size?: string;
    annualRevenue?: number;
    city?: string;
    state?: string;
  }) => {
    const res = await fetch('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      showToast(`Empresa "${payload.name}" cadastrada com sucesso!`);
      await fetchAllCrmData();
    }
  };

  const handleEnrichContact = async (contactId: string) => {
    const res = await fetch('/api/enrichment/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId }),
    });
    if (res.ok) {
      const json = await res.json();
      await fetchAllCrmData();
      return {
        fieldsUpdated: json.data?.fieldsUpdated || [],
        domain: json.data?.domain || null,
        source: json.data?.source || null,
      };
    }
    return null;
  };

  const handleEnrichCompany = async (companyId: string) => {
    const res = await fetch('/api/enrichment/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId }),
    });
    if (res.ok) {
      const json = await res.json();
      await fetchAllCrmData();
      return {
        fieldsUpdated: json.data?.fieldsUpdated || [],
        source: json.data?.source || null,
      };
    }
    return null;
  };

  const handleBatchEnrichAll = async () => {
    const res = await fetch('/api/enrichment/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const json = await res.json();
      await fetchAllCrmData();
      return {
        enrichedCount: json.data?.enrichedCount ?? 0,
        totalScanned: json.data?.totalScanned ?? 0,
      };
    }
    return null;
  };

  const handleAddContactActivity = async (payload: {
    contactId: string;
    companyId?: string | null;
    type: 'NOTE' | 'CALL' | 'EMAIL' | 'MEETING' | 'TASK';
    title: string;
    body?: string;
  }) => {
    const res = await fetch('/api/timeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        actor: 'Marcéllo Mira',
      }),
    });
    if (res.ok) {
      showToast('Atividade registrada na Timeline do contato!');
      await fetchAllCrmData();
    }
  };

  const handleMergeDuplicate = async (params: {
    entityType: 'CONTACT' | 'COMPANY';
    primaryId: string;
    duplicateId: string;
  }) => {
    const res = await fetch('/api/data-health/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (res.ok) {
      showToast('Registros duplicados mesclados com sucesso sem perda de histórico!');
      await fetchAllCrmData();
    }
  };

  const handleAutoClean = async (): Promise<AutoCleanResult | null> => {
    const res = await fetch('/api/data-health/auto-clean', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minConfidence: 80, autoEnrich: true }),
    });
    if (res.ok) {
      const json = await res.json();
      showToast(
        `Higienização Automática concluída! Score Global subiu para ${json.data?.newHealthScore}/100!`
      );
      await fetchAllCrmData();
      return json.data as AutoCleanResult;
    }
    return null;
  };

  const handleToggleWorkflow = async (workflowId: string, isActive: boolean) => {
    const res = await fetch(`/api/workflows/${workflowId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive }),
    });
    if (res.ok) {
      showToast(`Workflow ${isActive ? 'ativado' : 'pausado'} com sucesso!`);
      await fetchAllCrmData();
    }
  };

  const handleTriggerWorkflowTest = async (payload: {
    workflowId?: string;
    triggerType: WorkflowTriggerType;
    entityType: 'CONTACT' | 'COMPANY' | 'DEAL';
    entityId: string;
  }): Promise<WorkflowExecution[]> => {
    const res = await fetch('/api/workflows/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const json = await res.json();
      showToast('Disparo de teste do Workflow executado com sucesso!');
      await fetchAllCrmData();
      return json.data || [];
    }
    return [];
  };

  const handleCreateWorkflow = async (payload: {
    name: string;
    description: string;
    triggerType: WorkflowTriggerType;
    steps: WorkflowStep[];
  }) => {
    const res = await fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      showToast(`Novo workflow "${payload.name}" criado e ativado!`);
      await fetchAllCrmData();
    }
  };

  const handleEnrollContactSequence = async (payload: {
    sequenceId: string;
    contactId: string;
    dealId?: string | null;
  }) => {
    const res = await fetch('/api/sequences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ENROLL', ...payload }),
    });
    if (res.ok) {
      showToast('Contato inscrito na cadência e Passo 1 enviado!');
      await fetchAllCrmData();
    }
  };

  const handleAdvanceSequenceStep = async (enrollmentId: string) => {
    const res = await fetch('/api/sequences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ADVANCE_STEP', enrollmentId }),
    });
    if (res.ok) {
      showToast('Cadência avançada para o próximo passo!');
      await fetchAllCrmData();
    }
  };

  const handleSequenceInteraction = async (payload: {
    enrollmentId: string;
    action: 'OPEN' | 'CLICK' | 'REPLY';
    replySnippet?: string;
  }) => {
    const res = await fetch('/api/sequences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const json = await res.json();
      if (payload.action === 'REPLY') {
        showToast('Lead respondeu! Cadência pausada automaticamente (PAUSED_ON_REPLY)!');
      } else {
        showToast(`Evento ${payload.action} contabilizado nas métricas da cadência!`);
      }
      await fetchAllCrmData();
      return { autoPaused: Boolean(json.data?.autoPaused) };
    }
    return null;
  };

  const handleCreateSequence = async (payload: {
    name: string;
    description: string;
    category: 'OUTBOUND' | 'INBOUND_NURTURE' | 'FOLLOW_UP' | 'REENGAGEMENT';
    steps: SequenceStep[];
  }) => {
    const res = await fetch('/api/sequences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      showToast(`Cadência "${payload.name}" criada com sucesso!`);
      await fetchAllCrmData();
    }
  };

  // Global quick search results
  const quickSearchContacts = globalSearch.trim()
    ? contacts
        .filter((c) =>
          `${c.firstName} ${c.lastName} ${c.email}`
            .toLowerCase()
            .includes(globalSearch.toLowerCase())
        )
        .slice(0, 4)
    : [];

  const navItems: Array<{
    id: ActiveModule;
    label: string;
    shortLabel: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string | number;
    badgeTone?: 'orange' | 'emerald' | 'amber' | 'indigo';
  }> = [
    {
      id: 'OVERVIEW_AI',
      label: 'Visão Geral & Copiloto IA',
      shortLabel: 'Copiloto IA',
      icon: Sparkles,
      badge: 'IA',
      badgeTone: 'orange',
    },
    {
      id: 'DEALS_KANBAN',
      label: 'Funil de Vendas (Kanban)',
      shortLabel: 'Funil Kanban',
      icon: Kanban,
      badge: deals.filter((d) => d.status === 'OPEN').length,
      badgeTone: 'indigo',
    },
    {
      id: 'CONTACTS_COMPANIES',
      label: 'Contatos & Empresas',
      shortLabel: 'Contatos & Contas',
      icon: Users,
      badge: contacts.length,
      badgeTone: 'emerald',
    },
    {
      id: 'DATA_HEALTH',
      label: 'Saúde da Base (Data Health)',
      shortLabel: 'Data Health',
      icon: ShieldCheck,
      badge: `${healthSummary?.globalHealthScore ?? 0}%`,
      badgeTone:
        (healthSummary?.globalHealthScore ?? 0) >= 85 ? 'emerald' : 'amber',
    },
    {
      id: 'AUTOMATIONS',
      label: 'Automações & Cadências',
      shortLabel: 'Automações',
      icon: WorkflowIcon,
      badge: workflows.length + sequences.length,
      badgeTone: 'indigo',
    },
  ];

  return (
    <div className="min-h-screen flex bg-[#f8fafc] text-slate-900">
      {/* LEFT SIDEBAR — HUBSPOT PRO / TWENTY CRM STYLE */}
      <aside className="hidden xl:flex flex-col w-68 bg-[#1e293b] text-slate-200 border-r border-slate-800 shrink-0 select-none">
        {/* Brand Header */}
        <div className="px-5 py-5 border-b border-slate-800 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#ff7a59] flex items-center justify-center text-white font-black text-lg shadow-md">
            H
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-white text-base tracking-tight">
                HubSpot Pro
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#ff7a59]/20 text-[#ff987f] border border-[#ff7a59]/30">
                ENTERPRISE
              </span>
            </div>
            <p className="text-[11px] text-slate-400">Revenue &amp; Smart Data Suite</p>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="p-3.5 space-y-1.5 flex-1">
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Módulos Principais
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeModule === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveModule(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition ${
                  isActive
                    ? 'bg-[#ff7a59] text-white shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon
                    className={`w-4 h-4 ${
                      isActive ? 'text-white' : 'text-[#ff7a59]'
                    }`}
                  />
                  <span>{item.label}</span>
                </div>
                {item.badge !== undefined && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                      isActive
                        ? 'bg-white/20 text-white'
                        : item.badgeTone === 'emerald'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : item.badgeTone === 'amber'
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}

          {/* Sidebar Live Health & Pipeline Widget */}
          <div className="mt-6 pt-5 border-t border-slate-800 px-2 space-y-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">
              Pulso da Operação (Tempo Real)
            </div>

            <div
              onClick={() => setActiveModule('DATA_HEALTH')}
              className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-[#ff7a59]/50 cursor-pointer transition space-y-2"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">Saúde Global da Base</span>
                <span className="font-extrabold text-emerald-400">
                  {healthSummary?.globalHealthScore ?? 0}/100
                </span>
              </div>
              <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#ff7a59] rounded-full transition-all"
                  style={{ width: `${healthSummary?.globalHealthScore ?? 0}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Duplicados: {duplicates?.totalDuplicates ?? 0}</span>
                <span className="text-[#ff987f] font-semibold">Higienizar →</span>
              </div>
            </div>

            <div
              onClick={() => setActiveModule('DEALS_KANBAN')}
              className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-[#ff7a59]/50 cursor-pointer transition space-y-1"
            >
              <span className="text-[11px] text-slate-400 block">Receita Ponderada (Forecast)</span>
              <div className="text-base font-extrabold text-white">
                {formatBRL(dealsForecast.weightedOpenValue)}
              </div>
              <div className="text-[11px] text-emerald-400 font-medium">
                Ganho: {formatBRL(dealsForecast.closedWonValue)}
              </div>
            </div>
          </div>
        </nav>

        {/* Executive User Profile Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/60 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#ff7a59] text-white font-bold text-xs flex items-center justify-center">
              MM
            </div>
            <div>
              <div className="text-xs font-bold text-white">Marcéllo Mira</div>
              <div className="text-[10px] text-slate-400">VP Revenue &amp; Admin</div>
            </div>
          </div>
          <span className="w-2 h-2 rounded-full bg-emerald-400" title="API Online" />
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* TOP EXECUTIVE HEADER */}
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 sm:px-6 py-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            {/* Mobile / Tablet Nav + Breadcrumb */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="xl:hidden w-8 h-8 rounded-lg bg-[#ff7a59] text-white font-black flex items-center justify-center text-sm">
                  H
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
                    <span>HubSpot Pro CRM</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                    <span className="text-[#ff7a59] font-bold">
                      {navItems.find((n) => n.id === activeModule)?.label}
                    </span>
                  </div>
                  <h1 className="text-sm sm:text-base font-extrabold text-slate-900">
                    {navItems.find((n) => n.id === activeModule)?.label}
                  </h1>
                </div>
              </div>
            </div>

            {/* Global Search & Live KPI Pills */}
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Quick Global Search */}
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={globalSearch}
                  onChange={(e) => setGlobalSearch(e.target.value)}
                  placeholder="Busca global (contato, e-mail)..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:border-[#ff7a59]"
                />
                {quickSearchContacts.length > 0 && (
                  <div className="absolute left-0 right-0 mt-1 bg-white rounded-xl border border-slate-200 shadow-xl z-50 p-1.5 space-y-1">
                    {quickSearchContacts.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setGlobalSearch('');
                          setInitialContactIdForDrawer(c.id);
                          setActiveModule('CONTACTS_COMPANIES');
                        }}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-orange-50 flex items-center justify-between text-xs"
                      >
                        <div>
                          <div className="font-bold text-slate-900">
                            {c.firstName} {c.lastName}
                          </div>
                          <div className="text-[11px] text-slate-500">{c.email}</div>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold text-[10px]">
                          Score {c.leadScore}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Health Pill */}
              <button
                type="button"
                onClick={() => setActiveModule('DATA_HEALTH')}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-xs font-semibold text-slate-700 transition"
              >
                <Database className="w-3.5 h-3.5 text-[#ff7a59]" />
                Saúde: <strong>{healthSummary?.globalHealthScore ?? 0}/100</strong>
              </button>

              {/* Pipeline Pill */}
              <button
                type="button"
                onClick={() => setActiveModule('DEALS_KANBAN')}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-orange-50 hover:bg-orange-100 text-xs font-semibold text-[#e05835] border border-orange-200 transition"
              >
                <TrendingUp className="w-3.5 h-3.5" />
                Forecast: <strong>{formatBRL(dealsForecast.weightedOpenValue)}</strong>
              </button>

              <button
                type="button"
                onClick={() => fetchAllCrmData()}
                title="Sincronizar dados com a API"
                className="p-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-600 transition"
              >
                <RefreshCw className={`w-4 h-4 ${loadingAll ? 'animate-spin text-[#ff7a59]' : ''}`} />
              </button>
            </div>
          </div>

          {/* Mobile / Tablet Horizontal Module Switcher */}
          <div className="flex xl:hidden items-center gap-1.5 overflow-x-auto pt-3 mt-2 border-t border-slate-100">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeModule === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveModule(item.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition ${
                    isActive
                      ? 'bg-[#ff7a59] text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{item.shortLabel}</span>
                </button>
              );
            })}
          </div>
        </header>

        {/* TOAST NOTIFICATION */}
        {toastMessage && (
          <div className="fixed bottom-5 right-5 z-50 bg-[#1e293b] text-white px-4 py-3 rounded-xl shadow-2xl border border-[#ff7a59] flex items-center gap-2.5 text-xs font-semibold animate-bounce">
            <CheckCircle2 className="w-4 h-4 text-[#ff7a59] shrink-0" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* MODULE VIEWPORT */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1600px] w-full mx-auto">
          {activeModule === 'OVERVIEW_AI' && (
            <OverviewAiCopilotTab
              report={aiReport}
              loading={loadingAll}
              onRefresh={() => fetchAllCrmData()}
              onAskQuestion={handleAskAiQuestion}
              askingQuestion={askingAi}
              onNavigateToDeals={() => setActiveModule('DEALS_KANBAN')}
              onNavigateToContacts={(contactId) => {
                if (contactId) setInitialContactIdForDrawer(contactId);
                setActiveModule('CONTACTS_COMPANIES');
              }}
              onNavigateToDataHealth={() => setActiveModule('DATA_HEALTH')}
              onConvertOpportunityToDeal={handleConvertOpportunityToDeal}
              onRegisterQuickFollowUp={handleRegisterQuickFollowUp}
            />
          )}

          {activeModule === 'DEALS_KANBAN' && (
            <DealsKanbanTab
              pipelines={pipelines}
              deals={deals}
              forecast={dealsForecast}
              contacts={contacts}
              companies={companies}
              onMoveDealStage={handleMoveDealStage}
              onCreateDeal={handleCreateDeal}
              onAddDealNote={handleAddDealNote}
            />
          )}

          {activeModule === 'CONTACTS_COMPANIES' && (
            <ContactsCompaniesTab
              contacts={contacts}
              companies={companies}
              initialSelectedContactId={initialContactIdForDrawer}
              onClearInitialContact={() => setInitialContactIdForDrawer(null)}
              onCreateContact={handleCreateContact}
              onCreateCompany={handleCreateCompany}
              onEnrichContact={handleEnrichContact}
              onEnrichCompany={handleEnrichCompany}
              onBatchEnrichAll={handleBatchEnrichAll}
              onAddContactActivity={handleAddContactActivity}
            />
          )}

          {activeModule === 'DATA_HEALTH' && (
            <DataHealthTab
              summary={healthSummary}
              duplicates={duplicates}
              contacts={contacts}
              companies={companies}
              loading={loadingAll}
              onRefresh={() => fetchAllCrmData()}
              onMergeDuplicate={handleMergeDuplicate}
              onAutoClean={handleAutoClean}
              onEnrichEntity={async (entityType, entityId) => {
                if (entityType === 'CONTACT') {
                  await handleEnrichContact(entityId);
                } else {
                  await handleEnrichCompany(entityId);
                }
              }}
              onNavigateToContact={(contactId) => {
                setInitialContactIdForDrawer(contactId);
                setActiveModule('CONTACTS_COMPANIES');
              }}
            />
          )}

          {activeModule === 'AUTOMATIONS' && (
            <AutomationsSequencesTab
              workflows={workflows}
              executions={workflowExecutions}
              sequences={sequences}
              enrollments={enrollments}
              contacts={contacts}
              deals={deals}
              onToggleWorkflow={handleToggleWorkflow}
              onTriggerWorkflowTest={handleTriggerWorkflowTest}
              onCreateWorkflow={handleCreateWorkflow}
              onEnrollContact={handleEnrollContactSequence}
              onAdvanceStep={handleAdvanceSequenceStep}
              onRecordInteraction={handleSequenceInteraction}
              onCreateSequence={handleCreateSequence}
            />
          )}
        </main>
      </div>
    </div>
  );
}
