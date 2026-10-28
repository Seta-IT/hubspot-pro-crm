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
import ErpGestaoClickTab, { ErpOverviewPayload, GestaoClickMenuSection } from './components/ErpGestaoClickTab';
import { EnrichedEnrollment } from './components/SequencesSection';
import StiHubAdminRbacPanel from './components/StiHubAdminRbacPanel';
import UserAccountModal from './components/UserAccountModal';
import CrmSidebar, { CrmModuleId } from './components/CrmSidebar';
import GlobalHeaderSearch, { SearchResultEntry } from './components/GlobalHeaderSearch';
import { CrmEmailTemplate, StiHubRbacState, StiHubUserRecord } from '../db/types';
import { Settings, Lock, Menu } from 'lucide-react';
import { formatBRL } from './components/ui-helpers';
import ClientEmailComposerModal, { ClientEmailInitialPayload } from './components/ClientEmailComposerModal';
import {
  loadDurableJournal,
  mergeCompaniesWithJournal,
  mergeContactsWithJournal,
  mergeDealsWithJournal,
  mergeTicketsWithJournal,
  recordDeletedCompany,
  recordDeletedContact,
  recordDeletedDeal,
  recordDeletedTicket,
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
  | 'AUTOMATIONS'
  | 'ADMIN_RBAC';

export default function HubSpotProCrmApp() {
  const [activeModule, setActiveModule] = useState<ActiveModule>('OVERVIEW_AI');
  const [loadingAll, setLoadingAll] = useState(true);
  const [askingAi, setAskingAi] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [initialContactIdForDrawer, setInitialContactIdForDrawer] = useState<string | null>(null);
  const [initialCompanyIdForModal, setInitialCompanyIdForModal] = useState<string | null>(null);
  const [initialDealIdForDrawer, setInitialDealIdForDrawer] = useState<string | null>(null);
  const [initialTicketIdForDrawer, setInitialTicketIdForDrawer] = useState<string | null>(null);
  const [contactsNavTrigger, setContactsNavTrigger] = useState<number>(0);
  const [erpNavigationTrigger, setErpNavigationTrigger] = useState<number>(0);
  const [erpTargetEntity, setErpTargetEntity] = useState<{ type: string; id: string; query?: string } | null>(null);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('pipe-enterprise-b2b');
  const [erpData, setErpData] = useState<ErpOverviewPayload | null>(null);
  const [erpInitialSection, setErpInitialSection] = useState<GestaoClickMenuSection>('INICIO');
  const [autoOpenNewProposalTrigger, setAutoOpenNewProposalTrigger] = useState<number>(0);
  const [prefillProposalDeal, setPrefillProposalDeal] = useState<EnrichedDeal | null>(null);
  const [contactsInitialSubView, setContactsInitialSubView] = useState<'CONTACTS' | 'COMPANIES'>('CONTACTS');
  const [dataHealthScope, setDataHealthScope] = useState<'CRM' | 'ERP'>('CRM');
  const [lastCrmSubModule, setLastCrmSubModule] = useState<CrmModuleId>('DEALS_KANBAN');
  const [crmMobileDrawerOpen, setCrmMobileDrawerOpen] = useState(false);
  const [crmSidebarCollapsed, setCrmSidebarCollapsed] = useState(false);
  const [serviceDeskInitialTab, setServiceDeskInitialTab] = useState<"OPERATIONS" | "DASHBOARD_CHAMADOS" | "DATA_HEALTH_CHAMADOS">("OPERATIONS");
  const [serviceDeskNavTrigger, setServiceDeskNavTrigger] = useState<number>(0);
  const [openNewTicketTrigger, setOpenNewTicketTrigger] = useState<number>(0);
  const [adminInitialSubView, setAdminInitialSubView] = useState<'USERS_RBAC' | 'COMPANY_EMITTER' | 'CERTIFICATE_SERIES' | 'EMAIL_TEMPLATES' | 'CUSTOM_PROPERTIES' | 'DAILY_SYNC_LOGS' | 'MIGRATION_CHECKLIST' | 'SUBDOMAIN_SECURITY'>('USERS_RBAC');
  const [globalEmailModal, setGlobalEmailModal] = useState<ClientEmailInitialPayload | null>(null);
  const [rbacState, setRbacState] = useState<StiHubRbacState | null>(null);
  const [emailTemplatesState, setEmailTemplatesState] = useState<CrmEmailTemplate[]>([]);
  const [activeRbacUser, setActiveRbacUser] = useState<StiHubUserRecord | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [showUserAccountModal, setShowUserAccountModal] = useState(false);

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
          if (d.emailTemplates) setEmailTemplatesState(d.emailTemplates);
          if (d.rbac) {
            setRbacState(d.rbac);
            setActiveRbacUser((prev) => {
              if (prev) {
                return d.rbac.users.find((u: StiHubUserRecord) => u.id === prev.id) || prev;
              }
              if (typeof window !== 'undefined') {
                try {
                  const saved = JSON.parse(localStorage.getItem('stihub_active_session_v1') || 'null');
                  if (saved?.user?.id) {
                    const matched = d.rbac.users.find((u: StiHubUserRecord) => u.id === saved.user.id);
                    if (matched) return matched;
                  }
                } catch {
                  // ignore
                }
              }
              return d.rbac.users[0] || null;
            });
          }
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
    mrr?: number;
    contractMonths?: number;
    priority?: "ALTA" | "MEDIA" | "BAIXA";
    dealType?: "NEW_BUSINESS" | "LOCACAO_RECORRENTE" | "UPSELL_RENOVACAO";
    ownerName?: string;
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

  const handleAddDealNote = async (
    dealId: string,
    title: string,
    body: string,
    activityType: 'NOTE' | 'CALL' | 'MEETING' | 'EMAIL' | 'TASK' = 'NOTE'
  ) => {
    const res = await fetch('/api/timeline', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: activityType || 'NOTE',
        title,
        body,
        dealId,
        actor: 'Marcéllo Mira',
      }),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.data) recordTimelineEvent(json.data);
      showToast('Atividade registrada na timeline do negócio!');
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
    buyingRole?: string;
    ownerName?: string;
    isUnworked?: boolean;
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
      showToast(`Alerta: ${msg}`);
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
      showToast(`Alerta: ${errJson.error || 'Erro ao atualizar contato.'}`);
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
    isTargetAccount?: boolean;
    icpTier?: "TIER_1" | "TIER_2" | "TIER_3" | null;
    ownerName?: string;
  }) => {
    const res = await fetch('/api/companies', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, _reconcileJournal: loadDurableJournal() }),
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      showToast(`Alerta: ${errJson.error || 'Erro ao cadastrar empresa.'}`);
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
    contractId?: string | null;
    equipmentSerial?: string | null;
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
      showToast(
        patch.status
          ? `Status do chamado atualizado para ${patch.status}!`
          : patch.assignee
            ? `Fila NOC atualizada para ${patch.assignee}!`
            : patch.priority
              ? `Prioridade e SLA recalculados (${patch.priority})!`
              : 'Chamado atualizado com sucesso!'
      );
      await fetchAllCrmData();
    }
  };

  const handleDeleteTicket = async (ticketIdOrKey: string) => {
    const res = await fetch(`/api/tickets/${ticketIdOrKey}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      recordDeletedTicket(ticketIdOrKey);
      showToast(`Chamado removido do Service Desk.`);
      await fetchAllCrmData();
    }
  };

  const handleCreateOsFromTicket = async (
    ticketIdOrKey: string,
    payload?: { technicianName?: string; description?: string }
  ) => {
    const res = await fetch(`/api/tickets/${ticketIdOrKey}/create-os`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.data?.ticket) recordUpsertedTicket(json.data.ticket);
      const osCode = json.data?.serviceOrder?.code || 'ERP';
      showToast(`O.S. Técnica #${osCode} gerada no GestãoClick ERP e vinculada ao chamado!`);
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

  const userEnabledModules = activeRbacUser?.enabledModules || [
    'CRM',
    'ERP',
    'CHAMADOS',
  ];
  const userModuleAccess = activeRbacUser?.moduleAccess || {
    crm: userEnabledModules.includes('CRM'),
    erp: userEnabledModules.includes('ERP'),
    chamados: userEnabledModules.includes('CHAMADOS'),
  };

  const isCrmActive =
    activeModule === 'OVERVIEW_AI' ||
    activeModule === 'DEALS_KANBAN' ||
    activeModule === 'CONTACTS_COMPANIES' ||
    activeModule === 'MARKETING_FORMS' ||
    activeModule === 'AUTOMATIONS' ||
    activeModule === 'DATA_HEALTH' ||
    activeModule === 'ADMIN_RBAC';

  useEffect(() => {
    if (!activeRbacUser) return;
    if (activeModule === 'ADMIN_RBAC') return;
    if (isCrmActive && !userModuleAccess.crm) {
      if (userModuleAccess.erp) {
        setActiveModule('ERP_GESTAOCLICK');
      } else if (userModuleAccess.chamados) {
        setActiveModule('SERVICE_DESK');
      }
    } else if (activeModule === 'ERP_GESTAOCLICK' && !userModuleAccess.erp) {
      if (userModuleAccess.crm) {
        setActiveModule('DEALS_KANBAN');
      } else if (userModuleAccess.chamados) {
        setActiveModule('SERVICE_DESK');
      }
    } else if (activeModule === 'SERVICE_DESK' && !userModuleAccess.chamados) {
      if (userModuleAccess.crm) {
        setActiveModule('DEALS_KANBAN');
      } else if (userModuleAccess.erp) {
        setActiveModule('ERP_GESTAOCLICK');
      }
    }
  }, [activeRbacUser, activeModule, isCrmActive, userModuleAccess.crm, userModuleAccess.erp, userModuleAccess.chamados]);

  const macroNavItems: Array<{
    id: string;
    label: string;
    shortLabel: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string | number;
    isActive: boolean;
    onClick: () => void;
  }> = [
    {
      id: 'CRM',
      label: 'CRM',
      shortLabel: 'CRM',
      icon: Kanban,
      badge: userModuleAccess.crm ? undefined : 'Bloqueado IAM',
      isActive: isCrmActive,
      onClick: () => {
        if (!userModuleAccess.crm) {
          showToast(
            `Acesso negado pela política IAM: o usuário ${activeRbacUser?.name} não possui o módulo CRM habilitado.`
          );
          return;
        }
        setActiveModule(lastCrmSubModule || 'DEALS_KANBAN');
      },
    },
    {
      id: 'ERP',
      label: 'ERP',
      shortLabel: 'ERP',
      icon: Receipt,
      badge: userModuleAccess.erp ? undefined : 'Bloqueado IAM',
      isActive: activeModule === 'ERP_GESTAOCLICK',
      onClick: () => {
        if (!userModuleAccess.erp) {
          showToast(
            `Acesso negado pela política IAM: o usuário ${activeRbacUser?.name} não possui o módulo ERP habilitado.`
          );
          return;
        }
        setActiveModule('ERP_GESTAOCLICK');
      },
    },
    {
      id: 'SERVICE_DESK',
      label: 'Chamados',
      shortLabel: 'Chamados',
      icon: Ticket,
      badge: userModuleAccess.chamados ? undefined : 'Bloqueado IAM',
      isActive: activeModule === 'SERVICE_DESK',
      onClick: () => {
        if (!userModuleAccess.chamados) {
          showToast(
            `Acesso negado pela política IAM: o usuário ${activeRbacUser?.name} não possui o módulo de Chamados habilitado.`
          );
          return;
        }
        setActiveModule('SERVICE_DESK');
      },
    },
  ];

  const activeSectionLabel =
    activeModule === 'ERP_GESTAOCLICK'
      ? 'ERP'
      : isCrmActive
        ? 'CRM'
        : activeModule === 'SERVICE_DESK'
          ? 'Chamados'
          : activeModule === 'ADMIN_RBAC'
            ? 'Admin & RBAC'
            : 'Visão Geral';

  const activeSubModuleBreadcrumbLabel =
    activeModule === 'ERP_GESTAOCLICK'
      ? erpInitialSection
      : activeModule === 'SERVICE_DESK'
        ? serviceDeskInitialTab === 'DASHBOARD_CHAMADOS'
          ? 'Dashboard de Chamados & SLA'
          : serviceDeskInitialTab === 'DATA_HEALTH_CHAMADOS'
            ? 'Data Health (Chamados)'
            : 'Fila de Chamados NOC 24x7'
        : activeModule === 'OVERVIEW_AI'
          ? 'Dashboard CRM'
          : activeModule === 'DEALS_KANBAN'
            ? 'Negócios (Funil Kanban)'
            : activeModule === 'CONTACTS_COMPANIES'
              ? contactsInitialSubView === 'COMPANIES'
                ? 'Empresas CRM'
                : 'Contatos CRM'
              : activeModule === 'MARKETING_FORMS'
                ? 'Formulários & Leads'
                : activeModule === 'AUTOMATIONS'
                  ? 'Fluxos de Automação'
                  : activeModule === 'DATA_HEALTH'
                    ? 'Data Health (CRM)'
                    : 'Políticas IAM & Perfis';

  const gcStoreLabel = erpData?.gestaoClickConfig?.storeName
    ? `${erpData.gestaoClickConfig.storeName} #${erpData.gestaoClickConfig.storeId || "118887"}`
    : "Matriz #118887";

  return (
    <div className="min-h-screen flex flex-col bg-[#f5f8fa] text-[#33475b] overflow-x-hidden">
      {/* ====================================================================
          OFFICIAL STI-HUB (SETA TELECOM CRM & ERP) TOP GLOBAL NAVIGATION BAR (#213343)
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
              <div className="px-2 h-8 rounded-[6px] bg-white group-hover:bg-slate-100 transition flex items-center justify-center gap-1 shadow-xs">
                <span className="font-black text-[#0d2b4e] text-xs tracking-tight">SETA</span>
                <span className="w-[1.5px] h-3.5 bg-[#f26522] inline-block" />
                <span className="font-black text-[#f26522] text-xs tracking-tight">IT</span>
              </div>
              <div className="text-left">
                <div className="flex items-center gap-1.5">
                  <span className="font-extrabold text-white text-sm tracking-tight">
                    STI-hub
                  </span>
                  <span className="px-1.5 py-0.5 rounded-[3px] text-[9px] font-extrabold uppercase tracking-wider bg-[#ff7a59] text-white">
                    CRM &amp; ERP
                  </span>
                </div>
                <span className="hidden sm:block text-[10px] text-[#99acc2] leading-none">
                  Seta Telecom • CRM &amp; ERP Integrado
                </span>
              </div>
            </button>

            <div className="hidden lg:flex items-center gap-1.5 pl-3 border-l border-[#33475b] text-[11px] text-[#cbd6e2]">
              <span className="w-2 h-2 rounded-full bg-[#00bda5]" />
              <span className="font-semibold text-white">GestãoClick ERP-GROK</span>
              <span className="text-[#99acc2]">({gcStoreLabel} • MCP Online)</span>
            </div>
          </div>

          {/* Global HubSpot-Style Header Search (Todos os Sistemas | CRM | ERP | Chamados + Pílulas de Categoria) */}
          <GlobalHeaderSearch
            contacts={contacts}
            companies={companies}
            suppliers={erpData?.suppliers || []}
            deals={deals}
            proposals={erpData?.proposals || []}
            catalog={erpData?.catalog || []}
            rentalContracts={erpData?.rentalContracts || []}
            invoices={erpData?.invoices || []}
            serviceOrders={erpData?.serviceOrders || []}
            tickets={tickets}
            onSelectResult={(entry: SearchResultEntry) => {
              if (entry.category === 'CONTACTS') {
                setInitialContactIdForDrawer(entry.entityId);
                setContactsInitialSubView('CONTACTS');
                setContactsNavTrigger((n) => n + 1);
                setLastCrmSubModule('CONTACTS_COMPANIES');
                setActiveModule('CONTACTS_COMPANIES');
              } else if (entry.category === 'COMPANIES') {
                if (entry.id.startsWith('COMPANIES:sup-') || activeModule === 'ERP_GESTAOCLICK') {
                  setErpInitialSection('CADASTROS');
                  setErpTargetEntity({
                    type: entry.id.startsWith('COMPANIES:sup-') ? 'SUPPLIER' : 'CUSTOMER',
                    id: entry.entityId,
                    query: entry.title,
                  });
                  setErpNavigationTrigger((n) => n + 1);
                  setActiveModule('ERP_GESTAOCLICK');
                } else {
                  setContactsInitialSubView('COMPANIES');
                  setInitialCompanyIdForModal(entry.entityId);
                  setContactsNavTrigger((n) => n + 1);
                  setLastCrmSubModule('CONTACTS_COMPANIES');
                  setActiveModule('CONTACTS_COMPANIES');
                }
              } else if (entry.category === 'DEALS') {
                const dealObj = deals.find((d) => d.id === entry.entityId);
                if (dealObj?.pipelineId) setSelectedPipelineId(dealObj.pipelineId);
                setInitialDealIdForDrawer(entry.entityId);
                setLastCrmSubModule('DEALS_KANBAN');
                setActiveModule('DEALS_KANBAN');
              } else if (entry.category === 'PROPOSALS') {
                setErpInitialSection('ORCAMENTOS');
                setErpTargetEntity({ type: 'PROPOSAL', id: entry.entityId, query: entry.title });
                setErpNavigationTrigger((n) => n + 1);
                setActiveModule('ERP_GESTAOCLICK');
              } else if (entry.category === 'PRODUCTS') {
                setErpInitialSection('ITENS');
                setErpTargetEntity({ type: 'PRODUCT', id: entry.entityId, query: entry.title });
                setErpNavigationTrigger((n) => n + 1);
                setActiveModule('ERP_GESTAOCLICK');
              } else if (entry.category === 'CONTRACTS') {
                setErpInitialSection('CONTRATOS');
                setErpTargetEntity({ type: 'CONTRACT', id: entry.entityId, query: entry.title });
                setErpNavigationTrigger((n) => n + 1);
                setActiveModule('ERP_GESTAOCLICK');
              } else if (entry.category === 'INVOICES') {
                setErpInitialSection('FISCAL');
                setErpTargetEntity({ type: 'INVOICE', id: entry.entityId, query: entry.title });
                setErpNavigationTrigger((n) => n + 1);
                setActiveModule('ERP_GESTAOCLICK');
              } else if (entry.category === 'SERVICE_ORDERS') {
                setErpInitialSection('ORDENS_SERVICOS');
                setErpTargetEntity({ type: 'SERVICE_ORDER', id: entry.entityId, query: entry.title });
                setErpNavigationTrigger((n) => n + 1);
                setActiveModule('ERP_GESTAOCLICK');
              } else if (entry.category === 'TICKETS') {
                setInitialTicketIdForDrawer(entry.entityId);
                setActiveModule('SERVICE_DESK');
              }
            }}
            onNavigateToCategory={(cat) => {
              if (cat === 'CONTACTS') {
                setContactsInitialSubView('CONTACTS');
                setContactsNavTrigger((n) => n + 1);
                setLastCrmSubModule('CONTACTS_COMPANIES');
                setActiveModule('CONTACTS_COMPANIES');
              } else if (cat === 'COMPANIES') {
                setContactsInitialSubView('COMPANIES');
                setContactsNavTrigger((n) => n + 1);
                setLastCrmSubModule('CONTACTS_COMPANIES');
                setActiveModule('CONTACTS_COMPANIES');
              } else if (cat === 'DEALS') {
                setLastCrmSubModule('DEALS_KANBAN');
                setActiveModule('DEALS_KANBAN');
              } else if (cat === 'PROPOSALS') {
                setErpInitialSection('ORCAMENTOS');
                setErpNavigationTrigger((n) => n + 1);
                setActiveModule('ERP_GESTAOCLICK');
              } else if (cat === 'PRODUCTS') {
                setErpInitialSection('ITENS');
                setErpNavigationTrigger((n) => n + 1);
                setActiveModule('ERP_GESTAOCLICK');
              } else if (cat === 'CONTRACTS') {
                setErpInitialSection('CONTRATOS');
                setErpNavigationTrigger((n) => n + 1);
                setActiveModule('ERP_GESTAOCLICK');
              } else if (cat === 'INVOICES') {
                setErpInitialSection('FISCAL');
                setErpNavigationTrigger((n) => n + 1);
                setActiveModule('ERP_GESTAOCLICK');
              } else if (cat === 'SERVICE_ORDERS') {
                setErpInitialSection('ORDENS_SERVICOS');
                setErpNavigationTrigger((n) => n + 1);
                setActiveModule('ERP_GESTAOCLICK');
              } else if (cat === 'TICKETS') {
                setActiveModule('SERVICE_DESK');
              }
            }}
          />

          {/* Right Status & Profile Controls */}
          <div className="flex items-center gap-2 shrink-0">
            {isCrmActive && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setLastCrmSubModule("DEALS_KANBAN");
                    setActiveModule("DEALS_KANBAN");
                  }}
                  className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] bg-[#33475b] hover:bg-[#425b76] text-[11px] font-semibold text-white border border-[#516f90]/60 transition cursor-pointer"
                >
                  <TrendingUp className="w-3.5 h-3.5 text-[#00bda5]" />
                  <span>Forecast CRM:</span>
                  <strong className="text-[#00bda5]">{formatBRL(dealsForecast.weightedOpenValue)}</strong>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDataHealthScope("CRM");
                    setLastCrmSubModule("DATA_HEALTH");
                    setActiveModule("DATA_HEALTH");
                  }}
                  className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] bg-[#33475b] hover:bg-[#425b76] text-[11px] font-semibold text-white border border-[#516f90]/60 transition cursor-pointer"
                >
                  <Database className="w-3.5 h-3.5 text-[#ff7a59]" />
                  <span>Saúde CRM:</span>
                  <strong>{healthSummary?.globalHealthScore ?? 0}%</strong>
                </button>
              </>
            )}

            {activeModule === "ERP_GESTAOCLICK" && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setErpInitialSection("CONTRATOS");
                    setErpNavigationTrigger((n) => n + 1);
                    setActiveModule("ERP_GESTAOCLICK");
                  }}
                  className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] bg-[#33475b] hover:bg-[#425b76] text-[11px] font-semibold text-white border border-[#516f90]/60 transition cursor-pointer"
                >
                  <Receipt className="w-3.5 h-3.5 text-[#00bda5]" />
                  <span>MRR Locação:</span>
                  <strong className="text-[#00bda5]">{formatBRL(erpData?.kpis?.monthlyRentalMrr ?? 0)}</strong>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setErpInitialSection("DATA_HEALTH_ERP");
                    setErpNavigationTrigger((n) => n + 1);
                    setActiveModule("ERP_GESTAOCLICK");
                  }}
                  className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] bg-[#33475b] hover:bg-[#425b76] text-[11px] font-semibold text-white border border-[#516f90]/60 transition cursor-pointer"
                >
                  <Database className="w-3.5 h-3.5 text-[#ff7a59]" />
                  <span>Saúde ERP:</span>
                  <strong>{healthSummary?.globalHealthScore ?? 96}%</strong>
                </button>
              </>
            )}

            {activeModule === "SERVICE_DESK" && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setServiceDeskInitialTab("DASHBOARD_CHAMADOS");
                    setServiceDeskNavTrigger((n) => n + 1);
                    setActiveModule("SERVICE_DESK");
                  }}
                  className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] bg-[#33475b] hover:bg-[#425b76] text-[11px] font-semibold text-white border border-[#516f90]/60 transition cursor-pointer"
                >
                  <Ticket className="w-3.5 h-3.5 text-[#00bda5]" />
                  <span>SLA no Prazo:</span>
                  <strong className="text-[#00bda5]">{ticketKpis.slaComplianceRate}%</strong>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setServiceDeskInitialTab("DATA_HEALTH_CHAMADOS");
                    setServiceDeskNavTrigger((n) => n + 1);
                    setActiveModule("SERVICE_DESK");
                  }}
                  className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] bg-[#33475b] hover:bg-[#425b76] text-[11px] font-semibold text-white border border-[#516f90]/60 transition cursor-pointer"
                >
                  <Database className="w-3.5 h-3.5 text-[#ff7a59]" />
                  <span>Saúde Chamados:</span>
                  <strong>{healthSummary?.globalHealthScore ?? 98}%</strong>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => fetchAllCrmData()}
              title="Sincronizar dados com o Servidor & GestãoClick"
              className="p-1.5 rounded-[4px] bg-[#33475b] hover:bg-[#425b76] border border-[#516f90]/60 text-white transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingAll ? "animate-spin text-[#ff7a59]" : ""}`} />
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setUserMenuOpen((v) => !v)}
                title="Abrir Menu da Conta, Configurar 2FA (Google Authenticator / E-mail OTP) e IAM"
                className="flex items-center gap-2 pl-2 pr-2.5 py-1 rounded-[4px] bg-[#33475b]/80 hover:bg-[#425b76] border border-[#516f90]/70 transition cursor-pointer"
              >
                <div className="w-7 h-7 rounded-full bg-[#ff7a59] text-white font-bold text-[11px] flex items-center justify-center">
                  {(activeRbacUser?.name || "Marcéllo Mira")
                    .split(" ")
                    .slice(0, 2)
                    .map((p) => p[0])
                    .join("")
                    .toUpperCase()}
                </div>
                <div className="hidden xl:block leading-tight text-left">
                  <div className="text-[11px] font-bold text-white">
                    {activeRbacUser?.name || "Marcéllo Mira"}
                  </div>
                  <div className="text-[9px] text-[#00bda5] font-extrabold">
                    {activeRbacUser?.roleId || "SUPER_ADMIN"} • Escopo: {activeRbacUser?.scope || "TODOS"}
                  </div>
                </div>
              </button>

              {userMenuOpen && (
                <div className="absolute right-0 mt-1.5 w-72 rounded-xl bg-white text-slate-800 border border-slate-200 shadow-2xl z-50 overflow-hidden text-xs">
                  <div className="p-3 bg-[#0d2b4e] text-white space-y-1">
                    <div className="font-extrabold truncate">
                      {activeRbacUser?.name || "Marcelo Lopes Mira"}
                    </div>
                    <div className="text-[11px] text-slate-300 font-mono truncate">
                      {activeRbacUser?.email || "marcelo.mira@setatelecom.com.br"}
                    </div>
                    <div className="flex flex-wrap items-center gap-1 pt-1">
                      {userEnabledModules.map((m) => (
                        <span
                          key={m}
                          className="px-1.5 py-0.5 rounded bg-[#ff7a59] text-white text-[9px] font-black"
                        >
                          {m}
                        </span>
                      ))}
                      <span className="px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[9px] font-bold">
                        2FA Ativo
                      </span>
                    </div>
                  </div>
                  <div className="p-1.5 divide-y divide-slate-100">
                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        setShowUserAccountModal(true);
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-100 font-bold text-[#0d2b4e] flex items-center justify-between cursor-pointer"
                    >
                      <span>Minha Conta &amp; Parear 2FA (QR Code)</span>
                      <Lock className="w-3.5 h-3.5 text-[#ff7a59]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        setActiveModule("ADMIN_RBAC");
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-100 font-bold text-slate-700 flex items-center justify-between cursor-pointer"
                    >
                      <span>Políticas IAM (Painel CRM &amp; Painel ERP)</span>
                      <Settings className="w-3.5 h-3.5 text-slate-500" />
                    </button>
                    <a
                      href="/login"
                      onClick={() => setUserMenuOpen(false)}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-100 font-bold text-slate-700 flex items-center justify-between"
                    >
                      <span>Trocar Conta / Login MFA (/login)</span>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                    </a>
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={async () => {
                document.cookie = 'stihub_session=; path=/; max-age=0; SameSite=Lax';
                document.cookie = 'stihub_logged_out=1; path=/; max-age=86400; SameSite=Lax';
                try {
                  window.localStorage.removeItem('stihub_active_session_v1');
                } catch {}
                await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
                window.location.href = '/login';
              }}
              title="Encerrar sessão MFA e bloquear rotas"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-[4px] bg-rose-900/70 hover:bg-rose-800 border border-rose-500/40 text-[10px] font-extrabold text-rose-200 cursor-pointer"
            >
              Sair
            </button>
          </div>
        </div>

        {/* HubSpot Primary Module Tabs Bar (100% Visible on Mobile & Desktop) */}
        <div className="bg-[#2d3e50] border-t border-[#33475b] px-3 sm:px-5">
          <div className="max-w-[1680px] mx-auto flex flex-wrap items-center gap-1.5 py-1">
            {macroNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.isActive;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={item.onClick}
                  className={`relative flex-1 sm:flex-initial min-h-[40px] inline-flex items-center justify-center sm:justify-start gap-2 px-3 sm:px-4 py-2 rounded-[4px] text-xs font-extrabold transition cursor-pointer ${
                    isActive
                      ? "bg-[#213343] text-white shadow-xs"
                      : "text-[#cbd6e2] hover:bg-[#33475b] hover:text-white"
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? "text-[#ff7a59]" : "text-[#99acc2]"}`} />
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
          STI-HUB CLEAN CONTEXTUAL SUB-HEADER (ISOLADO POR SISTEMA: CRM | ERP | CHAMADOS)
      ==================================================================== */}
      <div className="bg-white border-b border-[#cbd6e2] px-3 sm:px-6 py-2 shadow-2xs">
        <div className="max-w-[1680px] mx-auto flex flex-col lg:flex-row lg:items-center justify-between gap-2">
          {/* Left Breadcrumb & Strictly Scoped Clickable Badges */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-[#516f90] font-medium mr-1">
              <button
                type="button"
                onClick={() => setActiveModule("OVERVIEW_AI")}
                className="font-extrabold text-[#0d2b4e] hover:underline cursor-pointer"
              >
                STI-hub
              </button>
              <ChevronRight className="w-3.5 h-3.5 text-[#99acc2]" />
              <span className="font-bold text-[#33475b] text-sm">
                {activeSectionLabel}
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-[#99acc2]" />
              <span className="font-semibold text-[#ff7a59] text-xs">
                {activeSubModuleBreadcrumbLabel}
              </span>
            </div>

            {/* BADGES EXCLUSIVOS QUANDO NO SISTEMA 1: CRM */}
            {isCrmActive && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setContactsInitialSubView("CONTACTS");
                    setActiveModule("CONTACTS_COMPANIES");
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-[4px] bg-[#e5f8f6] hover:bg-[#c9f2ec] text-[#007a6c] border border-[#00bda5]/40 text-[11px] font-bold cursor-pointer transition"
                >
                  {contacts.length} Contatos CRM
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setContactsInitialSubView("COMPANIES");
                    setActiveModule("CONTACTS_COMPANIES");
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-[4px] bg-[#e5f8f6] hover:bg-[#c9f2ec] text-[#007a6c] border border-[#00bda5]/40 text-[11px] font-bold cursor-pointer transition"
                >
                  {companies.length} Empresas CRM
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setLastCrmSubModule("DEALS_KANBAN");
                    setActiveModule("DEALS_KANBAN");
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-[4px] bg-sky-50 hover:bg-sky-100 text-[#0091ae] border border-sky-200 text-[11px] font-bold cursor-pointer transition"
                >
                  {deals.length} Negócios Ativos
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDataHealthScope("CRM");
                    setLastCrmSubModule("DATA_HEALTH");
                    setActiveModule("DATA_HEALTH");
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-[4px] bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-[11px] font-bold cursor-pointer transition"
                >
                  Data Health CRM: {healthSummary?.globalHealthScore ?? 92}%
                </button>
              </>
            )}

            {/* BADGES EXCLUSIVOS QUANDO NO SISTEMA 2: ERP */}
            {activeModule === "ERP_GESTAOCLICK" && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setErpInitialSection("CADASTROS");
                    setErpNavigationTrigger((n) => n + 1);
                    setActiveModule("ERP_GESTAOCLICK");
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-[4px] bg-[#eaf0f6] hover:bg-[#d5e1ee] text-[#1e3a6e] border border-[#cbd6e2] text-[11px] font-bold cursor-pointer transition"
                >
                  {erpData?.gestaoClickConfig?.liveTotals?.clientes ?? 1184} Clientes ERP
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setErpInitialSection("ORCAMENTOS");
                    setErpNavigationTrigger((n) => n + 1);
                    setActiveModule("ERP_GESTAOCLICK");
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-[4px] bg-[#eaf0f6] hover:bg-[#d5e1ee] text-[#1e3a6e] border border-[#cbd6e2] text-[11px] font-bold cursor-pointer transition"
                >
                  {erpData?.gestaoClickConfig?.liveTotals?.orcamentos ?? 2077} Orçamentos
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setErpInitialSection("CONTRATOS");
                    setErpNavigationTrigger((n) => n + 1);
                    setActiveModule("ERP_GESTAOCLICK");
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-[4px] bg-[#eaf0f6] hover:bg-[#d5e1ee] text-[#1e3a6e] border border-[#cbd6e2] text-[11px] font-bold cursor-pointer transition"
                >
                  {erpData?.gestaoClickConfig?.liveTotals?.contratos ?? 344} Contratos de Locação
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setErpInitialSection("ORDENS_SERVICOS");
                    setErpNavigationTrigger((n) => n + 1);
                    setActiveModule("ERP_GESTAOCLICK");
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-[4px] bg-[#eaf0f6] hover:bg-[#d5e1ee] text-[#1e3a6e] border border-[#cbd6e2] text-[11px] font-bold cursor-pointer transition"
                >
                  {erpData?.gestaoClickConfig?.liveTotals?.ordensServicos ?? 1378} O.S.
                </button>
              </>
            )}

            {/* BADGES EXCLUSIVOS QUANDO NO SISTEMA 3: CHAMADOS */}
            {activeModule === "SERVICE_DESK" && (
              <>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-[4px] bg-indigo-50 text-indigo-800 border border-indigo-200 text-[11px] font-bold">
                  {ticketKpis.openCount} Chamados Abertos
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-[4px] bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-bold">
                  SLA {ticketKpis.slaComplianceRate}% no Prazo
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-[4px] bg-slate-100 text-slate-800 border border-slate-300 text-[11px] font-bold">
                  Fila NOC Telecom 24x7
                </span>
              </>
            )}
          </div>

          {/* Right Action Bar Strictly Scoped to the Active System */}
          <div className="flex flex-wrap items-center gap-2">
            {isCrmActive && (
              <>
                <div className="flex items-center gap-1.5 bg-[#f5f8fa] border border-[#cbd6e2] rounded-[4px] px-2.5 py-1">
                  <span className="text-[11px] font-bold text-[#516f90]">Pipeline:</span>
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
                  onClick={() =>
                    setGlobalEmailModal({
                      docType: "PROPOSAL",
                      companyName: companies[0]?.name || "MUNDIVOX COMUNICACOES LTDA",
                      companyCnpj: companies[0]?.cnpj || "07.228.550/0001-19",
                      recipientName: "Maria Luiza",
                      documentCode: "4695",
                      amountBrl: 4320,
                    })
                  }
                  className="px-3 py-1.5 rounded-[4px] bg-sky-600 hover:bg-sky-700 text-white text-xs font-extrabold shadow-2xs transition cursor-pointer"
                >
                  Enviar E-mail ao Cliente
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setLastCrmSubModule("DEALS_KANBAN");
                    setActiveModule("DEALS_KANBAN");
                  }}
                  className="px-3.5 py-1.5 rounded-[4px] bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold shadow-2xs transition cursor-pointer"
                >
                  + Novo Negócio (Deal)
                </button>
              </>
            )}

            {activeModule === "ERP_GESTAOCLICK" && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setPrefillProposalDeal(null);
                    setErpInitialSection("ORCAMENTOS");
                    setAutoOpenNewProposalTrigger((n) => n + 1);
                    setActiveModule("ERP_GESTAOCLICK");
                  }}
                  className="px-3.5 py-1.5 rounded-[4px] bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold shadow-2xs transition cursor-pointer"
                >
                  + Novo Orçamento / Proposta PDF
                </button>
              </>
            )}

            {activeModule === "SERVICE_DESK" && (
              <button
                type="button"
                onClick={() => {
                  setServiceDeskInitialTab("OPERATIONS");
                  setOpenNewTicketTrigger((n) => n + 1);
                  setActiveModule("SERVICE_DESK");
                }}
                className="px-3.5 py-1.5 rounded-[4px] bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold shadow-2xs transition cursor-pointer"
              >
                + Novo Chamado NOC
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ====================================================================
          MAIN WORKSPACE BODY
      ==================================================================== */}
      <div className="flex-1 flex flex-col min-w-0">
        {globalEmailModal && (
          <ClientEmailComposerModal
            payload={globalEmailModal}
            onClose={() => setGlobalEmailModal(null)}
            onSentSuccess={(msg) => showToast(msg)}
          />
        )}
        {/* TOAST NOTIFICATION */}
        {toastMessage && (
          <div className="fixed bottom-5 right-5 z-50 bg-[#213343] text-white px-4 py-3 rounded-[6px] shadow-2xl border-l-4 border-[#00bda5] flex items-center gap-2.5 text-xs font-semibold">
            <CheckCircle2 className="w-4 h-4 text-[#00bda5] shrink-0" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* MODULE VIEWPORT */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1680px] w-full mx-auto">
          {activeModule === 'ERP_GESTAOCLICK' && (
            <ErpGestaoClickTab
              erpData={erpData}
              companies={companies}
              contacts={contacts}
              deals={deals}
              rbacState={rbacState}
              emailTemplates={emailTemplatesState}
              activeUser={activeRbacUser}
              onSelectActiveUser={(u) => setActiveRbacUser(u)}
              onRefresh={async () => {
                await fetchAllCrmData();
              }}
              onShowToast={showToast}
              initialSection={erpInitialSection}
              navigationTrigger={erpNavigationTrigger}
              targetEntity={erpTargetEntity}
              onClearTargetEntity={() => setErpTargetEntity(null)}
              autoOpenNewProposalTrigger={autoOpenNewProposalTrigger}
              prefillProposalFromDeal={prefillProposalDeal}
            />
          )}

          {activeModule === 'SERVICE_DESK' && (
            <ServiceDeskTab
              tickets={tickets}
              initialSelectedTicketId={initialTicketIdForDrawer}
              onClearInitialTicket={() => setInitialTicketIdForDrawer(null)}
              initialMacroTab={serviceDeskInitialTab}
              navigationTrigger={serviceDeskNavTrigger}
              openNewTicketTrigger={openNewTicketTrigger}
              kpis={ticketKpis}
              contacts={contacts}
              companies={companies}
              rentalContracts={erpData?.rentalContracts || []}
              serviceOrders={erpData?.serviceOrders || []}
              onCreateTicket={handleCreateTicket}
              onUpdateTicket={handleUpdateTicket}
              onDeleteTicket={handleDeleteTicket}
              onCreateOsFromTicket={handleCreateOsFromTicket}
              onAddTicketComment={handleAddTicketComment}
            />
          )}

          {isCrmActive && (
            <div className="rounded-lg overflow-hidden border border-slate-300 shadow-md bg-[#f3f5f8] flex flex-col md:flex-row min-h-[780px]">
              {/* MOBILE CRM NAVIGATION BAR (DRAWER TRIGGER + 1-TAP HORIZONTAL PILLS) */}
              <div className="md:hidden bg-[#213343] text-white px-3 py-2.5 border-b border-[#33475b] space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setCrmMobileDrawerOpen(true)}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#ff7a59] text-white text-xs font-extrabold shadow-xs cursor-pointer"
                  >
                    <Menu className="w-4 h-4" />
                    <span>Menu CRM</span>
                  </button>
                  <span className="text-[11px] font-bold text-[#cbd6e2] truncate">
                    {activeModule === 'OVERVIEW_AI'
                      ? 'Visão Geral & IA'
                      : activeModule === 'CONTACTS_COMPANIES'
                        ? contactsInitialSubView === 'COMPANIES'
                          ? 'Empresas CRM'
                          : 'Contatos CRM'
                        : activeModule === 'DEALS_KANBAN'
                          ? 'Sales Hub (Pipelines)'
                          : activeModule === 'MARKETING_FORMS'
                            ? 'Marketing Hub'
                            : activeModule === 'AUTOMATIONS'
                              ? 'Automações'
                              : activeModule === 'DATA_HEALTH'
                                ? 'Data Health'
                                : 'Administração & Config.'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                  {[
                    {
                      id: 'OVERVIEW_AI',
                      label: 'Visão Geral & IA',
                      active: activeModule === 'OVERVIEW_AI',
                      onClick: () => {
                        setLastCrmSubModule('OVERVIEW_AI');
                        setActiveModule('OVERVIEW_AI');
                      },
                    },
                    {
                      id: 'CONTACTS',
                      label: `Contatos (${contacts.length})`,
                      active: activeModule === 'CONTACTS_COMPANIES' && contactsInitialSubView === 'CONTACTS',
                      onClick: () => {
                        setContactsInitialSubView('CONTACTS');
                        setLastCrmSubModule('CONTACTS_COMPANIES');
                        setActiveModule('CONTACTS_COMPANIES');
                      },
                    },
                    {
                      id: 'COMPANIES',
                      label: `Empresas (${companies.length})`,
                      active: activeModule === 'CONTACTS_COMPANIES' && contactsInitialSubView === 'COMPANIES',
                      onClick: () => {
                        setContactsInitialSubView('COMPANIES');
                        setLastCrmSubModule('CONTACTS_COMPANIES');
                        setActiveModule('CONTACTS_COMPANIES');
                      },
                    },
                    {
                      id: 'DEALS_KANBAN',
                      label: `Sales Hub (${deals.length})`,
                      active: activeModule === 'DEALS_KANBAN',
                      onClick: () => {
                        setLastCrmSubModule('DEALS_KANBAN');
                        setActiveModule('DEALS_KANBAN');
                      },
                    },
                    {
                      id: 'MARKETING_FORMS',
                      label: 'Marketing Hub',
                      active: activeModule === 'MARKETING_FORMS',
                      onClick: () => {
                        setLastCrmSubModule('MARKETING_FORMS');
                        setActiveModule('MARKETING_FORMS');
                      },
                    },
                    {
                      id: 'AUTOMATIONS',
                      label: 'Automações',
                      active: activeModule === 'AUTOMATIONS',
                      onClick: () => {
                        setLastCrmSubModule('AUTOMATIONS');
                        setActiveModule('AUTOMATIONS');
                      },
                    },
                    {
                      id: 'DATA_HEALTH',
                      label: 'Data Health',
                      active: activeModule === 'DATA_HEALTH',
                      onClick: () => {
                        setLastCrmSubModule('DATA_HEALTH');
                        setActiveModule('DATA_HEALTH');
                      },
                    },
                    {
                      id: 'ADMIN_RBAC',
                      label: 'Admin & Config.',
                      active: activeModule === 'ADMIN_RBAC',
                      onClick: () => {
                        setLastCrmSubModule('ADMIN_RBAC');
                        setActiveModule('ADMIN_RBAC');
                      },
                    },
                  ].map((pill) => (
                    <button
                      key={pill.id}
                      type="button"
                      onClick={pill.onClick}
                      className={`shrink-0 px-2.5 py-1.5 rounded text-[11px] font-bold transition cursor-pointer ${
                        pill.active
                          ? 'bg-white text-[#0d2b4e] shadow-2xs'
                          : 'bg-[#33475b] text-[#cbd6e2] hover:text-white'
                      }`}
                    >
                      {pill.label}
                    </button>
                  ))}
                </div>
              </div>

              {!crmSidebarCollapsed && (
                <CrmSidebar
                  activeModule={activeModule as CrmModuleId}
                  onToggleCollapse={() => setCrmSidebarCollapsed((v) => !v)}
                  mobileDrawerOpen={crmMobileDrawerOpen}
                  onCloseMobileDrawer={() => setCrmMobileDrawerOpen(false)}
                pipelines={pipelines}
                selectedPipelineId={selectedPipelineId}
                contactsSubView={contactsInitialSubView}
                dataHealthScope={dataHealthScope}
                contactsCount={contacts.length}
                companiesCount={companies.length}
                dealsCount={deals.length}
                formsCount={webForms.length}
                automationsCount={workflows.length + sequences.length}
                healthScore={healthSummary?.globalHealthScore ?? 0}
                onSelectOverview={() => {
                  setLastCrmSubModule('OVERVIEW_AI');
                  setActiveModule('OVERVIEW_AI');
                }}
                onSelectPipeline={(pipeId) => {
                  setSelectedPipelineId(pipeId);
                  setLastCrmSubModule('DEALS_KANBAN');
                  setActiveModule('DEALS_KANBAN');
                }}
                onSelectContactsSubView={(sub) => {
                  setContactsInitialSubView(sub);
                  setLastCrmSubModule('CONTACTS_COMPANIES');
                  setActiveModule('CONTACTS_COMPANIES');
                }}
                onSelectForms={() => {
                  setLastCrmSubModule('MARKETING_FORMS');
                  setActiveModule('MARKETING_FORMS');
                }}
                onSelectAutomations={() => {
                  setLastCrmSubModule('AUTOMATIONS');
                  setActiveModule('AUTOMATIONS');
                }}
                onSelectDataHealth={(scope) => {
                  setDataHealthScope(scope);
                  setLastCrmSubModule('DATA_HEALTH');
                  setActiveModule('DATA_HEALTH');
                }}
                activeAdminSubView={adminInitialSubView}
                onSelectAdminRbac={(sub) => {
                  if (sub) setAdminInitialSubView(sub as typeof adminInitialSubView);
                  else setAdminInitialSubView('USERS_RBAC');
                  setLastCrmSubModule('ADMIN_RBAC');
                  setActiveModule('ADMIN_RBAC');
                }}
                />
              )}

              <div className="flex-1 p-4 sm:p-6 overflow-x-hidden">
                {crmSidebarCollapsed && (
                  <div className="hidden md:flex items-center gap-2 mb-3">
                    <button
                      type="button"
                      onClick={() => setCrmSidebarCollapsed(false)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-[#0d2b4e] cursor-pointer shadow-2xs"
                      title="Expandir menu lateral do CRM"
                    >
                      <Menu className="w-3.5 h-3.5 text-[#ff7a59]" />
                      <span>Expandir Menu CRM</span>
                    </button>
                  </div>
                )}
                {activeModule === 'OVERVIEW_AI' && (
                  <OverviewAiCopilotTab
                    report={aiReport}
                    loading={loadingAll}
                    contactsCount={contacts.length}
                    companiesCount={companies.length}
                    dealsCount={deals.length}
                    formsCount={webForms.length}
                    automationsCount={workflows.length + sequences.length}
                    healthScore={healthSummary?.globalHealthScore ?? 92}
                    onNavigateToMarketingForms={() => {
                      setLastCrmSubModule('MARKETING_FORMS');
                      setActiveModule('MARKETING_FORMS');
                    }}
                    onRefresh={() => fetchAllCrmData()}
                    onAskQuestion={handleAskAiQuestion}
                    askingQuestion={askingAi}
                    onNavigateToDeals={() => {
                      setLastCrmSubModule('DEALS_KANBAN');
                      setActiveModule('DEALS_KANBAN');
                    }}
                    onNavigateToContacts={(contactId) => {
                      if (contactId) setInitialContactIdForDrawer(contactId);
                      setLastCrmSubModule('CONTACTS_COMPANIES');
                      setActiveModule('CONTACTS_COMPANIES');
                    }}
                    onNavigateToDataHealth={() => {
                      setLastCrmSubModule('DATA_HEALTH');
                      setActiveModule('DATA_HEALTH');
                    }}
                    onNavigateToErpSection={(sec) => {
                      setErpInitialSection((sec as GestaoClickMenuSection) || 'INICIO');
                      setActiveModule('ERP_GESTAOCLICK');
                    }}
                    onNavigateToServiceDesk={() => setActiveModule('SERVICE_DESK')}
                    onNavigateToAutomations={() => {
                      setLastCrmSubModule('AUTOMATIONS');
                      setActiveModule('AUTOMATIONS');
                    }}
                    onConvertOpportunityToDeal={handleConvertOpportunityToDeal}
                    onRegisterQuickFollowUp={handleRegisterQuickFollowUp}
                  />
                )}

                {activeModule === 'ADMIN_RBAC' && (
                  <StiHubAdminRbacPanel
                    rbacState={rbacState}
                    emailTemplates={emailTemplatesState}
                    initialSubView={adminInitialSubView}
                    activeUser={activeRbacUser}
                    onSelectActiveUser={(u) => setActiveRbacUser(u)}
                    onRefresh={async () => {
                      await fetchAllCrmData();
                    }}
                    onShowToast={showToast}
                  />
                )}
                {activeModule === 'DEALS_KANBAN' && (
                  <DealsKanbanTab
                    pipelines={pipelines}
                    deals={deals}
                    forecast={dealsForecast}
                    contacts={contacts}
                    companies={companies}
                    proposals={erpData?.proposals || []}
                    rentalContracts={erpData?.rentalContracts || []}
                    onMoveDealStage={handleMoveDealStage}
                    onCreateDeal={handleCreateDeal}
                    onAddDealNote={handleAddDealNote}
                    selectedPipelineId={selectedPipelineId}
                    onSelectPipeline={(id) => setSelectedPipelineId(id)}
                    initialSelectedDealId={initialDealIdForDrawer}
                    onClearInitialDeal={() => setInitialDealIdForDrawer(null)}
                    onUpdateDeal={handleUpdateDeal}
                    onDeleteDeal={handleDeleteDeal}
                    onNavigateToErp={() => {
                      setErpInitialSection('INICIO');
                      setActiveModule('ERP_GESTAOCLICK');
                    }}
                    onShowToast={showToast}
                    onRefreshAll={async () => {
                      await fetchAllCrmData();
                    }}
                  />
                )}

                {activeModule === 'CONTACTS_COMPANIES' && (
                  <ContactsCompaniesTab
                    contacts={contacts}
                    companies={companies}
                    initialSelectedContactId={initialContactIdForDrawer}
                    onClearInitialContact={() => setInitialContactIdForDrawer(null)}
                    initialSelectedCompanyId={initialCompanyIdForModal}
                    onClearInitialCompany={() => setInitialCompanyIdForModal(null)}
                    initialSubView={contactsInitialSubView}
                    navigationTrigger={contactsNavTrigger}
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

                {activeModule === 'MARKETING_FORMS' && (
                  <FormsBuilderTab
                    forms={webForms}
                    submissions={formSubmissions}
                    summary={formsSummary}
                    onSubmitForm={handleSubmitForm}
                    onCreateForm={handleCreateForm}
                    onRunHubSpotMigration={handleRunHubSpotMigration}
                    onNavigateToServiceDesk={() => setActiveModule('SERVICE_DESK')}
                    onNavigateToDeals={() => {
                      setLastCrmSubModule('DEALS_KANBAN');
                      setActiveModule('DEALS_KANBAN');
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

                {activeModule === 'DATA_HEALTH' && (
                  <DataHealthTab
                    systemScope="crm"
                    summary={healthSummary}
                    duplicates={duplicates}
                    contacts={contacts}
                    companies={companies}
                    erpData={erpData}
                    initialScope={dataHealthScope}
                    onNavigateToErpSection={(sec, subId) => {
                      setErpInitialSection((sec as GestaoClickMenuSection) || 'INICIO');
                      setActiveModule('ERP_GESTAOCLICK');
                    }}
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
                      setLastCrmSubModule('CONTACTS_COMPANIES');
                      setActiveModule('CONTACTS_COMPANIES');
                    }}
                  />
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {showUserAccountModal && activeRbacUser && (
        <UserAccountModal
          user={activeRbacUser}
          onClose={() => setShowUserAccountModal(false)}
          onUserUpdated={async (updated) => {
            setActiveRbacUser(updated);
            await fetchAllCrmData();
          }}
          onOpenAdminIam={() => setActiveModule("ADMIN_RBAC")}
          onLogout={async () => {
            document.cookie = "stihub_session=; path=/; max-age=0; SameSite=Lax";
            document.cookie = "stihub_logged_out=1; path=/; max-age=86400; SameSite=Lax";
            try {
              window.localStorage.removeItem("stihub_active_session_v1");
            } catch {}
            await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
            window.location.href = "/login";
          }}
          onShowToast={showToast}
        />
      )}
    </div>
  );
}
