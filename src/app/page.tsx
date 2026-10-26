'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  Kanban,
  Users,
  ShieldCheck,
  Workflow as WorkflowIcon,
  FileCode2,
  Ticket,
  Search,
  RefreshCw,
  TrendingUp,
  CheckCircle2,
  Database,
  ChevronRight,
  Receipt,
} from 'lucide-react';

import OverviewAiCopilotTab from './components/OverviewAiCopilotTab';
import DealsKanbanTab, { EnrichedDeal, EnrichedPipeline } from './components/DealsKanbanTab';
import ContactsCompaniesTab, {
  EnrichedCompanyItem,
  EnrichedContactItem,
} from './components/ContactsCompaniesTab';
import DataHealthTab, { DuplicatesPayload } from './components/DataHealthTab';
import AutomationsSequencesTab from './components/AutomationsSequencesTab';
import FormsBuilderTab, { FormsSummary, HubSpotMigrationReport } from './components/FormsBuilderTab';
import ServiceDeskTab, { EnrichedServiceTicket, ServiceDeskKpis } from './components/ServiceDeskTab';
import ErpGestaoClickTab, { ErpOverviewPayload } from './components/ErpGestaoClickTab';
import { EnrichedEnrollment } from './components/SequencesSection';
import { formatBRL } from './components/ui-helpers';
import {
  loadDurableJournal,
  mergeCompaniesWithJournal,
  mergeContactsWithJournal,
  mergeDealsWithJournal,
  mergeTicketsWithJournal,
  recordDeletedCompany,
  recordDeletedContact,
  recordDeletedDeal,
  recordTimelineEvent,
  recordUpsertedCompany,
  recordUpsertedContact,
  recordUpsertedDeal,
  recordUpsertedForm,
  recordUpsertedSequence,
  recordUpsertedTicket,
  recordUpsertedWorkflow,
} from './lib/durable-storage';

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
  FormSubmission,
  LifecycleStage,
  SequenceStep,
  ServiceTicket,
  TicketCategory,
  TicketChannel,
  TicketPriority,
  TicketStatus,
  WebForm,
  WebFormField,
  WebFormTargetType,
  Workflow,
  WorkflowExecution,
  WorkflowStep,
  WorkflowTriggerType,
} from '../db/types';

type ActiveModule =
  | 'OVERVIEW_AI'
  | 'DEALS_KANBAN'
  | 'CONTACTS_COMPANIES'
  | 'SERVICE_DESK'
  | 'MARKETING_FORMS'
  | 'ERP_GESTAOCLICK'
  | 'DATA_HEALTH'
  | 'AUTOMATIONS';

export default function HubSpotProCrmApp() {
  const [activeModule, setActiveModule] = useState<ActiveModule>('OVERVIEW_AI');
  const [loadingAll, setLoadingAll] = useState(true);
  const [askingAi, setAskingAi] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [initialContactIdForDrawer, setInitialContactIdForDrawer] = useState<string | null>(null);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('pipe-enterprise-b2b');
  const [erpData, setErpData] = useState<ErpOverviewPayload | null>(null);

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

  // Phase 3 States: Web Forms & Service Desk Tickets
  const [webForms, setWebForms] = useState<WebForm[]>([]);
  const [formSubmissions, setFormSubmissions] = useState<FormSubmission[]>([]);
  const [formsSummary, setFormsSummary] = useState<FormsSummary>({
    totalForms: 0,
    activeForms: 0,
    totalViews: 0,
    totalSubmissions: 0,
    avgConversionRate: 0,
  });
  const [tickets, setTickets] = useState<EnrichedServiceTicket[]>([]);
  const [ticketKpis, setTicketKpis] = useState<ServiceDeskKpis>({
    totalTickets: 0,
    openCount: 0,
    criticalCount: 0,
    onTrackCount: 0,
    atRiskCount: 0,
    breachedCount: 0,
    slaComplianceRate: 100,
    avgFirstResponseMinutes: 18,
    avgCsat: 4.9,
  });

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

  const fetchAllCrmData = useCallback(async (customAiQuestion?: string) => {
    try {
      const reconcileJournal = loadDurableJournal();
      const res = await fetch('/api/bootstrap', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reconcileJournal,
          question: customAiQuestion,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        const d = json.data;
        if (d) {
          if (d.aiReport) setAiReport(d.aiReport);
          if (d.pipelines) setPipelines(d.pipelines);
          const mergedCompanies = mergeCompaniesWithJournal(d.companies || []);
          const mergedContacts = mergeContactsWithJournal(d.contacts || [], mergedCompanies);
          const mergedDeals = mergeDealsWithJournal(d.deals || []);
          const mergedTickets = mergeTicketsWithJournal(d.tickets || []);

          setCompanies(mergedCompanies);
          setContacts(mergedContacts);
          setDeals(mergedDeals);
          if (d.dealsForecast) setDealsForecast(d.dealsForecast);
          if (d.healthSummary) setHealthSummary(d.healthSummary);
          if (d.duplicates) setDuplicates(d.duplicates);
          if (d.workflows) setWorkflows(d.workflows);
          if (d.workflowExecutions) setWorkflowExecutions(d.workflowExecutions);
          if (d.sequences) setSequences(d.sequences);
          if (d.enrollments) setEnrollments(d.enrollments);
          if (d.webForms) setWebForms(d.webForms);
          if (d.formSubmissions) setFormSubmissions(d.formSubmissions);
          if (d.formsSummary) setFormsSummary(d.formsSummary);
          setTickets(mergedTickets);
          if (d.ticketKpis) setTicketKpis(d.ticketKpis);
          if (d.erp) setErpData(d.erp);
        }
      }
    } finally {
      setLoadingAll(false);
    }
  }, []);

  useEffect(() => {
    fetchAllCrmData();
  }, [fetchAllCrmData]);

  // ==========================================================================
  // API ACTION HANDLERS (WITH DURABLE JOURNAL & OPTIMISTIC STATE)
  // ==========================================================================

  const handleAskAiQuestion = async (question: string) => {
    setAskingAi(true);
    try {
      const res = await fetch('/api/ai-insights', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, _reconcileJournal: loadDurableJournal() }),
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
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, _reconcileJournal: loadDurableJournal() }),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.data) recordUpsertedDeal(json.data);
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
      cache: 'no-store',
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
      const json = await res.json();
      if (json.data) recordTimelineEvent(json.data);
      showToast('Follow-up registrado na Timeline e SLA do negócio atualizado!');
      await fetchAllCrmData();
    }
  };

  const handleMoveDealStage = async (dealId: string, newStageId: string) => {
    const res = await fetch(`/api/deals/${dealId}`, {
      method: 'PATCH',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stageId: newStageId, _reconcileJournal: loadDurableJournal() }),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.data) recordUpsertedDeal(json.data);
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
    pipelineId?: string;
    contactId?: string | null;
    companyId?: string | null;
    expectedCloseDate?: string | null;
  }) => {
    const res = await fetch('/api/deals', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, _reconcileJournal: loadDurableJournal() }),
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      showToast(`Erro ao criar negócio: ${errJson.error || res.statusText}`);
      throw new Error(errJson.error || 'Falha ao criar negócio');
    }
    const json = await res.json();
    if (json.data) recordUpsertedDeal(json.data);
    showToast(`Novo negócio "${payload.title}" adicionado ao funil!`);
    await fetchAllCrmData();
  };

  const handleUpdateDeal = async (dealId: string, patch: Record<string, unknown>) => {
    const res = await fetch(`/api/deals/${dealId}`, {
      method: 'PATCH',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, _reconcileJournal: loadDurableJournal() }),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.data) recordUpsertedDeal(json.data);
      showToast('Negócio atualizado com sucesso!');
      await fetchAllCrmData();
    }
  };

  const handleDeleteDeal = async (dealId: string) => {
    const res = await fetch(`/api/deals/${dealId}`, { method: 'DELETE', cache: 'no-store' });
    recordDeletedDeal(dealId);
    setDeals((prev) => prev.filter((d) => d.id !== dealId));
    if (res.ok) {
      showToast('Negócio excluído do funil!');
      await fetchAllCrmData();
    }
  };

  const handleAddDealNote = async (dealId: string, title: string, body: string) => {
    const res = await fetch('/api/timeline', {
      method: 'POST',
      cache: 'no-store',
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
      const json = await res.json();
      if (json.data) recordTimelineEvent(json.data);
      showToast('Nota registrada na timeline do negócio!');
      await fetchAllCrmData();
    }
  };

  const handleCreateContact = async (payload: {
    email?: string;
    firstName: string;
    lastName?: string;
    phone?: string;
    jobTitle?: string;
    lifecycleStage?: LifecycleStage;
    companyId?: string;
    companyName?: string;
  }): Promise<EnrichedContactItem> => {
    const res = await fetch('/api/contacts', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        _reconcileJournal: loadDurableJournal(),
      }),
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const msg = errJson.error || 'Erro ao salvar contato.';
      showToast(`⚠️ ${msg}`);
      throw new Error(msg);
    }

    const json = await res.json();
    const created: EnrichedContactItem = json.data;
    recordUpsertedContact(created);
    if (created.company) {
      recordUpsertedCompany(created.company);
    }

    // Immediate optimistic update so the new contact is at index 0 right away
    setContacts((prev) => [created, ...prev.filter((c) => c.id !== created.id)]);

    const wfCount = json.workflowExecutions?.length || 0;
    showToast(
      `Contato "${`${created.firstName} ${created.lastName || ''}`.trim()}" salvo com sucesso e disponível na busca (${wfCount} workflow(s) disparado(s))!`
    );
    await fetchAllCrmData();
    return created;
  };

  const handleUpdateContact = async (contactId: string, patch: Record<string, unknown>) => {
    const res = await fetch(`/api/contacts/${contactId}`, {
      method: 'PATCH',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, _reconcileJournal: loadDurableJournal() }),
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      showToast(`⚠️ ${errJson.error || 'Erro ao atualizar contato.'}`);
      throw new Error(errJson.error || 'Erro ao atualizar contato');
    }
    const json = await res.json();
    if (json.data) {
      recordUpsertedContact(json.data);
      setContacts((prev) =>
        prev.map((c) => (c.id === contactId ? { ...c, ...json.data } : c))
      );
    }
    showToast('Contato atualizado e persistido com sucesso!');
    await fetchAllCrmData();
  };

  const handleDeleteContact = async (contactId: string) => {
    recordDeletedContact(contactId);
    setContacts((prev) => prev.filter((c) => c.id !== contactId));
    const res = await fetch(`/api/contacts/${contactId}`, {
      method: 'DELETE',
      cache: 'no-store',
    });
    if (res.ok) {
      showToast('Contato excluído com sucesso!');
    }
    await fetchAllCrmData();
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
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, _reconcileJournal: loadDurableJournal() }),
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      showToast(`⚠️ ${errJson.error || 'Erro ao cadastrar empresa.'}`);
      throw new Error(errJson.error || 'Erro ao cadastrar empresa');
    }
    const json = await res.json();
    if (json.data) {
      recordUpsertedCompany(json.data);
      setCompanies((prev) => [json.data, ...prev.filter((c) => c.id !== json.data.id)]);
    }
    showToast(`Empresa "${payload.name}" cadastrada e persistida com sucesso!`);
    await fetchAllCrmData();
  };

  const handleUpdateCompany = async (companyId: string, patch: Record<string, unknown>) => {
    const res = await fetch(`/api/companies/${companyId}`, {
      method: 'PATCH',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, _reconcileJournal: loadDurableJournal() }),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.data) {
        recordUpsertedCompany(json.data);
        setCompanies((prev) =>
          prev.map((c) => (c.id === companyId ? { ...c, ...json.data } : c))
        );
      }
      showToast('Empresa atualizada com sucesso!');
      await fetchAllCrmData();
    }
  };

  const handleDeleteCompany = async (companyId: string) => {
    recordDeletedCompany(companyId);
    setCompanies((prev) => prev.filter((c) => c.id !== companyId));
    const res = await fetch(`/api/companies/${companyId}`, {
      method: 'DELETE',
      cache: 'no-store',
    });
    if (res.ok) {
      showToast('Empresa excluída com sucesso!');
    }
    await fetchAllCrmData();
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
      const json = await res.json();
      if (json.data) recordUpsertedWorkflow(json.data);
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
      const json = await res.json();
      if (json.data) recordUpsertedWorkflow(json.data);
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
      const json = await res.json();
      if (json.data) recordUpsertedSequence(json.data);
      showToast(`Cadência "${payload.name}" criada com sucesso!`);
      await fetchAllCrmData();
    }
  };

  // Phase 3 Handlers: Web Forms, Service Desk Tickets & HubSpot Migration
  const handleSubmitForm = async (payload: {
    formId: string;
    values: Record<string, string>;
  }) => {
    const res = await fetch('/api/forms/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const json = await res.json();
      const contact = json.data?.contact;
      const deal = json.data?.deal;
      const ticket = json.data?.ticket;
      if (contact) recordUpsertedContact(contact);
      if (deal) recordUpsertedDeal(deal);
      if (ticket) recordUpsertedTicket(ticket);
      showToast(
        ticket
          ? `Formulário convertido! Chamado [${ticket.key}] aberto automaticamente no Service Desk!`
          : deal
            ? `Formulário convertido! Lead enriquecido e negócio "${deal.title}" aberto!`
            : `Formulário convertido! Lead ${contact?.firstName || ''} criado e enriquecido!`
      );
      await fetchAllCrmData();
      return {
        contactName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : 'Lead',
        dealTitle: deal?.title || null,
        ticketKey: ticket?.key || null,
      };
    }
    return null;
  };

  const handleCreateForm = async (payload: {
    name: string;
    title: string;
    description: string;
    targetType: WebFormTargetType;
    lifecycleStageOnSubmit: LifecycleStage;
    autoCreateDeal: boolean;
    autoCreateTicket: boolean;
    submitButtonText: string;
    fields: WebFormField[];
  }) => {
    const res = await fetch('/api/forms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.data) recordUpsertedForm(json.data);
      showToast(`Formulário "${payload.name}" publicado com código embed pronto!`);
      await fetchAllCrmData();
    }
  };

  const handleRunHubSpotMigration = async (payload: {
    accessToken?: string;
    autoClean?: boolean;
  }): Promise<HubSpotMigrationReport | null> => {
    const res = await fetch('/api/migration/hubspot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const json = await res.json();
      showToast(
        `Migração HubSpot concluída! +${json.data?.companiesImported} empresas, +${json.data?.contactsImported} contatos e +${json.data?.dealsImported} deals!`
      );
      await fetchAllCrmData();
      return json.data as HubSpotMigrationReport;
    }
    return null;
  };

  const handleCreateTicket = async (payload: {
    subject: string;
    description: string;
    category: TicketCategory;
    priority: TicketPriority;
    channel: TicketChannel;
    contactId?: string | null;
    companyId?: string | null;
    assignee?: string;
  }) => {
    const res = await fetch('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.data) recordUpsertedTicket(json.data);
      showToast(`Chamado [${json.data?.key}] aberto no Service Desk com SLA ativo!`);
      await fetchAllCrmData();
    }
  };

  const handleUpdateTicket = async (
    ticketIdOrKey: string,
    patch: Partial<ServiceTicket>
  ) => {
    const res = await fetch(`/api/tickets/${ticketIdOrKey}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.data) recordUpsertedTicket(json.data);
      showToast(`Status do chamado atualizado para ${patch.status}!`);
      await fetchAllCrmData();
    }
  };

  const handleAddTicketComment = async (
    ticketIdOrKey: string,
    payload: {
      author: string;
      authorRole: 'AGENT' | 'CUSTOMER';
      isInternal: boolean;
      body: string;
      newStatus?: TicketStatus;
    }
  ) => {
    const res = await fetch(`/api/tickets/${ticketIdOrKey}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.data) recordUpsertedTicket(json.data);
      showToast(
        payload.isInternal
          ? 'Nota interna registrada na fila técnica!'
          : 'Resposta enviada ao cliente e SLA atualizado!'
      );
      await fetchAllCrmData();
    }
  };

  // Global quick search results (accent-insensitive across all contact & company fields)
  const normalizeText = (v: unknown) =>
    String(v ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

  const quickSearchContacts = globalSearch.trim()
    ? contacts
        .filter((c) => {
          const q = normalizeText(globalSearch);
          const qDigits = globalSearch.replace(/\D+/g, '');
          const haystack = normalizeText(
            `${c.firstName} ${c.lastName} ${c.email} ${c.phone || ''} ${c.jobTitle || ''} ${c.company?.name || ''} ${c.company?.domain || ''}`
          );
          const phoneDigits = String(c.phone || c.normalizedPhone || '').replace(/\D+/g, '');
          return (
            haystack.includes(q) ||
            (qDigits.length >= 3 && phoneDigits.includes(qDigits))
          );
        })
        .slice(0, 8)
    : [];

  const navItems: Array<{
    id: ActiveModule;
    label: string;
    shortLabel: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string | number;
    badgeTone?: 'orange' | 'emerald' | 'amber' | 'indigo' | 'rose';
  }> = [
    {
      id: 'OVERVIEW_AI',
      label: 'Visão Geral & Copiloto IA',
      shortLabel: '📊 Visão Geral & IA',
      icon: Sparkles,
      badge: 'IA',
      badgeTone: 'orange',
    },
    {
      id: 'DEALS_KANBAN',
      label: 'Deals & Seletor de Pipeline',
      shortLabel: '💼 Deals & Pipelines',
      icon: Kanban,
      badge: `${deals.length} • ${pipelines.length} Funis`,
      badgeTone: 'indigo',
    },
    {
      id: 'ERP_GESTAOCLICK',
      label: 'ERP, Propostas & Locação (GC)',
      shortLabel: '🏢 ERP & Locação (GC)',
      icon: Receipt,
      badge: erpData ? `${erpData.rentalContracts.length} Contratos` : 'NOVO',
      badgeTone: 'emerald',
    },
    {
      id: 'SERVICE_DESK',
      label: 'Service Management (JSM)',
      shortLabel: '🎧 Service Management',
      icon: Ticket,
      badge: ticketKpis.openCount,
      badgeTone: ticketKpis.criticalCount > 0 ? 'rose' : 'indigo',
    },
    {
      id: 'CONTACTS_COMPANIES',
      label: 'Contatos & Empresas',
      shortLabel: '👥 Contatos & Contas',
      icon: Users,
      badge: contacts.length,
      badgeTone: 'emerald',
    },
    {
      id: 'MARKETING_FORMS',
      label: 'Formulários Web & Migração',
      shortLabel: '📝 Forms & HubSpot',
      icon: FileCode2,
      badge: webForms.length,
      badgeTone: 'emerald',
    },
    {
      id: 'DATA_HEALTH',
      label: 'Saúde da Base (Data Health)',
      shortLabel: '🛡️ Data Health',
      icon: ShieldCheck,
      badge: `${healthSummary?.globalHealthScore ?? 0}%`,
      badgeTone:
        (healthSummary?.globalHealthScore ?? 0) >= 85 ? 'emerald' : 'amber',
    },
    {
      id: 'AUTOMATIONS',
      label: 'Automações & Cadências',
      shortLabel: '⚡ Automações',
      icon: WorkflowIcon,
      badge: workflows.length + sequences.length,
      badgeTone: 'indigo',
    },
  ];

  const gcStoreLabel = erpData?.gestaoClickConfig?.storeName
    ? `${erpData.gestaoClickConfig.storeName} #${erpData.gestaoClickConfig.storeId || "118887"}`
    : "Matriz #118887";

  return (
    <div className="min-h-screen flex flex-col bg-[#f5f8fa] text-[#33475b]">
      {/* ====================================================================
          OFFICIAL HUBSPOT PRO CANVAS TOP GLOBAL NAVIGATION BAR (#213343)
      ==================================================================== */}
      <header className="sticky top-0 z-40 bg-[#213343] text-white border-b border-[#33475b] shadow-sm select-none">
        {/* Top Primary Bar */}
        <div className="max-w-[1680px] mx-auto px-3 sm:px-5 h-13 flex items-center justify-between gap-3 py-2">
          {/* Brand + Portal Switcher */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setActiveModule("OVERVIEW_AI")}
              className="flex items-center gap-2.5 group cursor-pointer shrink-0"
            >
              <div className="w-8 h-8 rounded-[6px] bg-[#ff7a59] group-hover:bg-[#ff8f73] transition flex items-center justify-center text-white font-black text-base shadow-xs">
                H
              </div>
              <div className="text-left">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-white text-sm tracking-tight">
                    HubSpot Pro
                  </span>
                  <span className="px-1.5 py-0.5 rounded-[3px] text-[9px] font-extrabold uppercase tracking-wider bg-[#ff7a59] text-white">
                    CRM + ERP
                  </span>
                </div>
                <span className="hidden sm:block text-[10px] text-[#99acc2] leading-none">
                  Seta Telecom LTDA • Hub ID 4369067
                </span>
              </div>
            </button>

            <div className="hidden lg:flex items-center gap-1.5 pl-3 border-l border-[#33475b] text-[11px] text-[#cbd6e2]">
              <span className="w-2 h-2 rounded-full bg-[#00bda5]" />
              <span className="font-semibold text-white">GestãoClick ERP-GROK</span>
              <span className="text-[#99acc2]">({gcStoreLabel} • MCP Online)</span>
            </div>
          </div>

          {/* Global HubSpot Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-3.5 h-3.5 text-[#99acc2] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Pesquisar no HubSpot & GestãoClick (contatos, empresas, e-mail, CNPJ)..."
              className="w-full pl-8 pr-7 py-1.5 rounded-[4px] bg-[#33475b] border border-[#516f90] text-xs text-white placeholder-[#99acc2] focus:bg-white focus:text-[#33475b] focus:placeholder-[#516f90] focus:outline-none focus:border-[#0091ae] transition"
            />
            {globalSearch && (
              <button
                type="button"
                onClick={() => setGlobalSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-[#99acc2] hover:text-white"
              >
                ✕
              </button>
            )}
            {quickSearchContacts.length > 0 && (
              <div className="absolute left-0 right-0 mt-1.5 bg-white rounded-[6px] border border-[#cbd6e2] shadow-2xl z-50 overflow-hidden text-[#33475b]">
                <div className="px-3 py-1.5 bg-[#f5f8fa] border-b border-[#cbd6e2] text-[10px] font-bold uppercase tracking-wider text-[#516f90]">
                  Resultados no CRM ({quickSearchContacts.length})
                </div>
                <div className="divide-y divide-[#eaf0f6] max-h-72 overflow-y-auto">
                  {quickSearchContacts.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setGlobalSearch("");
                        setInitialContactIdForDrawer(c.id);
                        setActiveModule("CONTACTS_COMPANIES");
                      }}
                      className="w-full text-left px-3.5 py-2.5 hover:bg-[#eaf0f6]/70 flex items-center justify-between text-xs transition"
                    >
                      <div>
                        <div className="font-bold text-[#0091ae] hover:underline">
                          {c.firstName} {c.lastName}
                        </div>
                        <div className="text-[11px] text-[#516f90]">
                          {c.email} {c.company?.name ? `• ${c.company.name}` : ""}
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-[3px] bg-[#e5f8f6] text-[#007a6c] border border-[#00bda5]/30 font-bold text-[10px]">
                        Score {c.leadScore}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Status & Profile Controls */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setActiveModule("DEALS_KANBAN")}
              className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] bg-[#33475b] hover:bg-[#425b76] text-[11px] font-semibold text-white border border-[#516f90]/60 transition cursor-pointer"
            >
              <TrendingUp className="w-3.5 h-3.5 text-[#00bda5]" />
              <span>Forecast:</span>
              <strong className="text-[#00bda5]">{formatBRL(dealsForecast.weightedOpenValue)}</strong>
            </button>

            <button
              type="button"
              onClick={() => setActiveModule("DATA_HEALTH")}
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] bg-[#33475b] hover:bg-[#425b76] text-[11px] font-semibold text-white border border-[#516f90]/60 transition cursor-pointer"
            >
              <Database className="w-3.5 h-3.5 text-[#ff7a59]" />
              <span>Saúde:</span>
              <strong>{healthSummary?.globalHealthScore ?? 0}%</strong>
            </button>

            <button
              type="button"
              onClick={() => fetchAllCrmData()}
              title="Sincronizar dados com o Servidor & GestãoClick"
              className="p-1.5 rounded-[4px] bg-[#33475b] hover:bg-[#425b76] border border-[#516f90]/60 text-white transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingAll ? "animate-spin text-[#ff7a59]" : ""}`} />
            </button>

            <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-[#33475b]">
              <div className="w-7 h-7 rounded-full bg-[#ff7a59] text-white font-bold text-[11px] flex items-center justify-center">
                MM
              </div>
              <div className="hidden xl:block leading-tight">
                <div className="text-[11px] font-bold text-white">Marcéllo Mira</div>
                <div className="text-[9px] text-[#99acc2]">Seta Telecom • Admin</div>
              </div>
            </div>
          </div>
        </div>

        {/* HubSpot Primary Module Tabs Bar (100% Visible on Mobile & Desktop) */}
        <div className="bg-[#2d3e50] border-t border-[#33475b] px-3 sm:px-5">
          <div className="max-w-[1680px] mx-auto flex flex-wrap items-center gap-1 py-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeModule === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveModule(item.id)}
                  className={`relative inline-flex items-center gap-1.5 px-3 py-2 rounded-[4px] text-xs font-semibold transition cursor-pointer ${
                    isActive
                      ? "bg-[#213343] text-white shadow-xs"
                      : "text-[#cbd6e2] hover:bg-[#33475b] hover:text-white"
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? "text-[#ff7a59]" : "text-[#99acc2]"}`} />
                  <span>{item.shortLabel}</span>
                  {item.badge !== undefined && (
                    <span
                      className={`px-1.5 py-0.2 rounded-[3px] text-[10px] font-bold ${
                        isActive
                          ? "bg-[#ff7a59] text-white"
                          : "bg-[#33475b] text-[#cbd6e2]"
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                  {isActive && (
                    <span className="absolute bottom-0 left-2 right-2 h-[3px] bg-[#ff7a59] rounded-t" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* ====================================================================
          HUBSPOT OBJECT INDEX CONTEXTUAL SUB-HEADER (WHITE + #CBD6E2 BORDER)
      ==================================================================== */}
      <div className="bg-white border-b border-[#cbd6e2] px-3 sm:px-6 py-2.5 shadow-2xs">
        <div className="max-w-[1680px] mx-auto flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
          {/* Left Breadcrumb & Module Title */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1.5 text-xs text-[#516f90] font-medium">
              <span>HubSpot Pro</span>
              <ChevronRight className="w-3.5 h-3.5 text-[#99acc2]" />
              <span className="font-bold text-[#33475b] text-sm sm:text-base">
                {navItems.find((n) => n.id === activeModule)?.label}
              </span>
            </div>
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] bg-[#e5f8f6] text-[#007a6c] border border-[#00bda5]/30 text-[11px] font-semibold">
              ● {contacts.length} Contatos • {companies.length} Empresas
            </span>
            <span className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] bg-[#eaf0f6] text-[#33475b] border border-[#cbd6e2] text-[11px] font-semibold">
              ● ERP GestãoClick: {erpData?.gestaoClickConfig?.liveTotals?.clientes ?? 1184} Clientes / {erpData?.gestaoClickConfig?.liveTotals?.contratos ?? 344} Contratos
            </span>
          </div>

          {/* Right Global Pipeline Selector + Quick HubSpot Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 bg-[#f5f8fa] border border-[#cbd6e2] rounded-[4px] px-2.5 py-1">
              <span className="text-[11px] font-bold text-[#516f90]">
                Pipeline:
              </span>
              <select
                aria-label="Seletor Global de Pipeline"
                value={selectedPipelineId}
                onChange={(e) => {
                  setSelectedPipelineId(e.target.value);
                  setActiveModule("DEALS_KANBAN");
                }}
                className="bg-transparent text-xs font-bold text-[#0091ae] focus:outline-none cursor-pointer"
              >
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id} className="text-[#33475b]">
                    {p.name} ({deals.filter((d) => d.pipelineId === p.id).length} deals)
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => setActiveModule("CONTACTS_COMPANIES")}
              className={`px-3 py-1.5 rounded-[4px] text-xs font-semibold border transition cursor-pointer ${
                activeModule === "CONTACTS_COMPANIES"
                  ? "bg-[#eaf0f6] border-[#0091ae] text-[#0091ae]"
                  : "bg-white hover:bg-[#f5f8fa] text-[#33475b] border-[#cbd6e2]"
              }`}
            >
              👥 Contatos &amp; Empresas
            </button>

            <button
              type="button"
              onClick={() => setActiveModule("DEALS_KANBAN")}
              className={`px-3 py-1.5 rounded-[4px] text-xs font-semibold border transition cursor-pointer ${
                activeModule === "DEALS_KANBAN"
                  ? "bg-[#eaf0f6] border-[#0091ae] text-[#0091ae]"
                  : "bg-white hover:bg-[#f5f8fa] text-[#33475b] border-[#cbd6e2]"
              }`}
            >
              💼 Deals &amp; Funis
            </button>

            <button
              type="button"
              onClick={() => setActiveModule("SERVICE_DESK")}
              className={`px-3 py-1.5 rounded-[4px] text-xs font-semibold border transition cursor-pointer ${
                activeModule === "SERVICE_DESK"
                  ? "bg-[#eaf0f6] border-[#0091ae] text-[#0091ae]"
                  : "bg-white hover:bg-[#f5f8fa] text-[#33475b] border-[#cbd6e2]"
              }`}
            >
              🎧 Service Desk ({ticketKpis.openCount})
            </button>

            <button
              type="button"
              onClick={() => setActiveModule("ERP_GESTAOCLICK")}
              className="px-3.5 py-1.5 rounded-[4px] bg-[#ff7a59] hover:bg-[#ff8f73] text-white text-xs font-bold shadow-2xs transition cursor-pointer"
            >
              🏢 ERP &amp; Locação (GestãoClick)
            </button>
          </div>
        </div>
      </div>

      {/* ====================================================================
          MAIN WORKSPACE BODY
      ==================================================================== */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* TOAST NOTIFICATION */}
        {toastMessage && (
          <div className="fixed bottom-5 right-5 z-50 bg-[#213343] text-white px-4 py-3 rounded-[6px] shadow-2xl border-l-4 border-[#00bda5] flex items-center gap-2.5 text-xs font-semibold">
            <CheckCircle2 className="w-4 h-4 text-[#00bda5] shrink-0" />
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
              selectedPipelineId={selectedPipelineId}
              onSelectPipeline={(id) => setSelectedPipelineId(id)}
              onUpdateDeal={handleUpdateDeal}
              onDeleteDeal={handleDeleteDeal}
              onNavigateToErp={() => setActiveModule('ERP_GESTAOCLICK')}
            />
          )}

          {activeModule === 'ERP_GESTAOCLICK' && (
            <ErpGestaoClickTab
              erpData={erpData}
              companies={companies}
              contacts={contacts}
              deals={deals}
              onRefresh={async () => {
                await fetchAllCrmData();
              }}
              onShowToast={showToast}
            />
          )}

          {activeModule === 'CONTACTS_COMPANIES' && (
            <ContactsCompaniesTab
              contacts={contacts}
              companies={companies}
              initialSelectedContactId={initialContactIdForDrawer}
              onClearInitialContact={() => setInitialContactIdForDrawer(null)}
              onCreateContact={handleCreateContact}
              onUpdateContact={handleUpdateContact}
              onDeleteContact={handleDeleteContact}
              onCreateCompany={handleCreateCompany}
              onUpdateCompany={handleUpdateCompany}
              onDeleteCompany={handleDeleteCompany}
              onEnrichContact={handleEnrichContact}
              onEnrichCompany={handleEnrichCompany}
              onBatchEnrichAll={handleBatchEnrichAll}
              onAddContactActivity={handleAddContactActivity}
            />
          )}

          {activeModule === 'SERVICE_DESK' && (
            <ServiceDeskTab
              tickets={tickets}
              kpis={ticketKpis}
              contacts={contacts}
              companies={companies}
              onCreateTicket={handleCreateTicket}
              onUpdateTicket={handleUpdateTicket}
              onAddTicketComment={handleAddTicketComment}
            />
          )}

          {activeModule === 'MARKETING_FORMS' && (
            <FormsBuilderTab
              forms={webForms}
              submissions={formSubmissions}
              summary={formsSummary}
              onSubmitForm={handleSubmitForm}
              onCreateForm={handleCreateForm}
              onRunHubSpotMigration={handleRunHubSpotMigration}
              onNavigateToServiceDesk={() => setActiveModule('SERVICE_DESK')}
              onNavigateToDeals={() => setActiveModule('DEALS_KANBAN')}
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
