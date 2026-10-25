// ============================================================================
// HubSpot Pro CRM - Unified REST API Router & Controller
// ============================================================================

import { CrmRepository, getRepository } from '../db/repository';
import {
  checkPostgresHealth,
  isPostgresEnabled,
  loadStateFromPostgres,
  syncStateToPostgres,
} from '../db/postgres';
import { calculateCompanyCompleteness, calculateContactCompleteness } from '../modules/data-health/completeness';
import { detectDuplicateCompanies, detectDuplicateContacts } from '../modules/data-health/deduplication';
import { DataHealthService } from '../modules/data-health/health-service';
import { EnrichmentService } from '../modules/enrichment/enrichment-service';
import { WorkflowEngine } from '../modules/workflows/workflow-engine';
import { SequenceService } from '../modules/sequences/sequence-service';
import { AiInsightsService } from '../modules/ai-insights/ai-insights-service';
import {
  LifecycleStage,
  TicketCategory,
  TicketChannel,
  TicketPriority,
  TicketStatus,
  WebForm,
  WorkflowExecution,
  WorkflowTriggerType,
} from '../db/types';

export interface ApiRequest {
  method: string;
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

export class CrmApiRouter {
  private repo: CrmRepository;
  private isSingletonRepo: boolean;
  private pgInitialized = false;
  private healthService = new DataHealthService();
  private enrichmentService = new EnrichmentService();
  private workflowEngine = new WorkflowEngine();
  private sequenceService = new SequenceService();
  private aiInsightsService = new AiInsightsService();

  constructor(repo?: CrmRepository) {
    this.isSingletonRepo = !repo;
    this.repo = repo || getRepository();
  }

  getRepository(): CrmRepository {
    return this.repo;
  }

  async dispatch(req: ApiRequest): Promise<ApiResponse> {
    const method = req.method.toUpperCase();
    const rawUrl = req.path || '/';
    const [pathname, queryString] = rawUrl.split('?');
    const cleanPath = pathname.replace(/\/+$/, '') || '/';

    const query: Record<string, string | undefined> = { ...(req.query || {}) };
    if (queryString) {
      const searchParams = new URLSearchParams(queryString);
      searchParams.forEach((v, k) => {
        if (query[k] === undefined) query[k] = v;
      });
    }

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;

    if (this.isSingletonRepo && isPostgresEnabled() && !this.pgInitialized) {
      try {
        const pgState = await loadStateFromPostgres();
        if (pgState) {
          this.repo.loadState(pgState);
        }
        this.pgInitialized = true;
      } catch {
        // Fallback to local state if PostgreSQL is unreachable
      }
    }

    const response = await this.handleRoute(method, cleanPath, query, body);

    if (
      this.isSingletonRepo &&
      isPostgresEnabled() &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) &&
      response.status >= 200 &&
      response.status < 400
    ) {
      try {
        await syncStateToPostgres(this.repo.getState());
      } catch {
        // Ignore background sync failure if PostgreSQL is temporarily unavailable
      }
    }

    return response;
  }

  private async handleRoute(
    method: string,
    cleanPath: string,
    query: Record<string, string | undefined>,
    body: Record<string, unknown>
  ): Promise<ApiResponse> {
    try {
      // ======================================================================
      // SYSTEM & DATABASE HEALTH (/api/health)
      // ======================================================================
      if (cleanPath === '/api/health' && method === 'GET') {
        const dbHealth = await checkPostgresHealth();
        const state = this.repo.getState();
        return {
          status: 200,
          body: {
            status: 'ok',
            service: 'hubspot-pro-crm',
            timestamp: new Date().toISOString(),
            database: dbHealth,
            counts: {
              contacts: state.contacts.length,
              companies: state.companies.length,
              deals: state.deals.length,
              pipelines: state.pipelines.length,
              workflows: state.workflows.length,
              sequences: state.sequences.length,
              webForms: (state.webForms || []).length,
              serviceTickets: (state.serviceTickets || []).length,
            },
          },
        };
      }
      // ======================================================================
      // CONTACTS (/api/contacts, /api/contacts/:id)
      // ======================================================================
      if (cleanPath === '/api/contacts') {
        if (method === 'GET') {
          const contacts = this.repo.listContacts({
            search: query.search,
            lifecycleStage: query.lifecycleStage,
            companyId: query.companyId,
            minScore: query.minScore ? Number(query.minScore) : undefined,
          });
          const companies = new Map(this.repo.listCompanies().map((c) => [c.id, c]));
          const enrichedList = contacts.map((c) => ({
            ...c,
            company: c.companyId ? companies.get(c.companyId) || null : null,
          }));
          return {
            status: 200,
            body: { data: enrichedList, total: enrichedList.length },
          };
        }

        if (method === 'POST') {
          if (!body.email || !body.firstName) {
            return {
              status: 400,
              body: { error: 'Os campos "email" e "firstName" são obrigatórios.' },
            };
          }
          let contact = this.repo.createContact(
            body as { email: string; firstName: string; [k: string]: unknown }
          );

          // Automatically run CONTACT_CREATED workflows
          const wfExecutions = this.workflowEngine.trigger(this.repo, {
            triggerType: 'CONTACT_CREATED',
            entityType: 'CONTACT',
            entityId: contact.id,
          });

          contact = this.repo.getContactById(contact.id) || contact;

          // Check SCORE_THRESHOLD trigger if score >= 80
          if (contact.leadScore >= 80) {
            this.workflowEngine.trigger(this.repo, {
              triggerType: 'SCORE_THRESHOLD',
              entityType: 'CONTACT',
              entityId: contact.id,
            });
            contact = this.repo.getContactById(contact.id) || contact;
          }

          return {
            status: 201,
            body: { data: contact, workflowExecutions: wfExecutions },
          };
        }
      }

      const contactIdMatch = cleanPath.match(/^\/api\/contacts\/([^/]+)$/);
      if (contactIdMatch) {
        const id = contactIdMatch[1];
        if (method === 'GET') {
          const contact = this.repo.getContactById(id);
          if (!contact) {
            return { status: 404, body: { error: 'Contato não encontrado.' } };
          }
          const company = contact.companyId ? this.repo.getCompanyById(contact.companyId) || null : null;
          const deals = this.repo.listDeals({ contactId: id });
          const timeline = this.repo.listTimelineEvents({ contactId: id });
          const completeness = calculateContactCompleteness(contact);
          return {
            status: 200,
            body: {
              data: {
                ...contact,
                company,
                deals,
                timeline,
                completenessDetail: completeness,
              },
            },
          };
        }

        if (method === 'PATCH' || method === 'PUT') {
          const before = this.repo.getContactById(id);
          if (!before) {
            return { status: 404, body: { error: 'Contato não encontrado.' } };
          }
          let updated = this.repo.updateContact(id, body);
          if (updated && updated.leadScore >= 80 && before.leadScore < 80) {
            this.workflowEngine.trigger(this.repo, {
              triggerType: 'SCORE_THRESHOLD',
              entityType: 'CONTACT',
              entityId: updated.id,
            });
            updated = this.repo.getContactById(id) || updated;
          }
          return { status: 200, body: { data: updated } };
        }

        if (method === 'DELETE') {
          const deleted = this.repo.deleteContact(id);
          if (!deleted) {
            return { status: 404, body: { error: 'Contato não encontrado.' } };
          }
          return { status: 200, body: { success: true, deletedId: id } };
        }
      }

      // ======================================================================
      // COMPANIES (/api/companies, /api/companies/:id)
      // ======================================================================
      if (cleanPath === '/api/companies') {
        if (method === 'GET') {
          const companies = this.repo.listCompanies({
            search: query.search,
            industry: query.industry,
          });
          const contacts = this.repo.listContacts();
          const deals = this.repo.listDeals();
          const data = companies.map((comp) => ({
            ...comp,
            contactsCount: contacts.filter((c) => c.companyId === comp.id).length,
            dealsCount: deals.filter((d) => d.companyId === comp.id).length,
            totalDealValue: deals
              .filter((d) => d.companyId === comp.id)
              .reduce((s, d) => s + d.value, 0),
          }));
          return { status: 200, body: { data, total: data.length } };
        }

        if (method === 'POST') {
          if (!body.name) {
            return { status: 400, body: { error: 'O campo "name" é obrigatório.' } };
          }
          const company = this.repo.createCompany(body as { name: string; [k: string]: unknown });
          return { status: 201, body: { data: company } };
        }
      }

      const companyIdMatch = cleanPath.match(/^\/api\/companies\/([^/]+)$/);
      if (companyIdMatch) {
        const id = companyIdMatch[1];
        if (method === 'GET') {
          const company = this.repo.getCompanyById(id);
          if (!company) {
            return { status: 404, body: { error: 'Empresa não encontrada.' } };
          }
          const contacts = this.repo.listContacts({ companyId: id });
          const deals = this.repo.listDeals({ companyId: id });
          const timeline = this.repo.listTimelineEvents({ companyId: id });
          const completeness = calculateCompanyCompleteness(company);
          return {
            status: 200,
            body: {
              data: {
                ...company,
                contacts,
                deals,
                timeline,
                completenessDetail: completeness,
              },
            },
          };
        }

        if (method === 'PATCH' || method === 'PUT') {
          const updated = this.repo.updateCompany(id, body);
          if (!updated) {
            return { status: 404, body: { error: 'Empresa não encontrada.' } };
          }
          return { status: 200, body: { data: updated } };
        }

        if (method === 'DELETE') {
          const deleted = this.repo.deleteCompany(id);
          if (!deleted) {
            return { status: 404, body: { error: 'Empresa não encontrada.' } };
          }
          return { status: 200, body: { success: true, deletedId: id } };
        }
      }

      // ======================================================================
      // DEALS (/api/deals, /api/deals/:id)
      // ======================================================================
      if (cleanPath === '/api/deals') {
        if (method === 'GET') {
          const deals = this.repo.listDeals({
            pipelineId: query.pipelineId,
            stageId: query.stageId,
            status: query.status,
            contactId: query.contactId,
            companyId: query.companyId,
          });
          const contacts = new Map(this.repo.listContacts().map((c) => [c.id, c]));
          const companies = new Map(this.repo.listCompanies().map((c) => [c.id, c]));
          const pipelines = this.repo.listPipelines();
          const stageMap = new Map<string, { name: string; dealRottingDays: number }>();
          for (const p of pipelines) {
            for (const s of p.stages) {
              stageMap.set(s.id, { name: s.name, dealRottingDays: s.dealRottingDays });
            }
          }

          const nowMs = Date.now();
          const enrichedDeals = deals.map((d) => {
            const st = stageMap.get(d.stageId);
            const lastTouch = d.lastActivityAt || d.stageEnteredAt || d.updatedAt;
            const daysInactive = Math.floor(
              (nowMs - new Date(lastTouch).getTime()) / (1000 * 60 * 60 * 24)
            );
            const isRotting =
              d.status === 'OPEN' && daysInactive > (st?.dealRottingDays ?? 14);
            return {
              ...d,
              stageName: st?.name || d.stageId,
              daysInactive,
              isRotting,
              weightedValue: Math.round(d.value * (d.probability / 100)),
              contact: d.contactId ? contacts.get(d.contactId) || null : null,
              company: d.companyId ? companies.get(d.companyId) || null : null,
            };
          });

          const openDeals = enrichedDeals.filter((d) => d.status === 'OPEN');
          const wonDeals = enrichedDeals.filter((d) => d.status === 'WON');
          const forecast = {
            totalOpenValue: openDeals.reduce((s, d) => s + d.value, 0),
            weightedOpenValue: openDeals.reduce((s, d) => s + d.weightedValue, 0),
            closedWonValue: wonDeals.reduce((s, d) => s + d.value, 0),
            rottingDealsCount: openDeals.filter((d) => d.isRotting).length,
          };

          return {
            status: 200,
            body: { data: enrichedDeals, total: enrichedDeals.length, forecast },
          };
        }

        if (method === 'POST') {
          if (!body.title) {
            return { status: 400, body: { error: 'O campo "title" é obrigatório.' } };
          }
          const deal = this.repo.createDeal({
            ...(body as Record<string, unknown>),
            title: String(body.title),
            value: Number(body.value ?? 0),
          });
          return { status: 201, body: { data: deal } };
        }
      }

      const dealIdMatch = cleanPath.match(/^\/api\/deals\/([^/]+)$/);
      if (dealIdMatch) {
        const id = dealIdMatch[1];
        if (method === 'GET') {
          const deal = this.repo.getDealById(id);
          if (!deal) return { status: 404, body: { error: 'Negócio não encontrado.' } };
          const contact = deal.contactId ? this.repo.getContactById(deal.contactId) || null : null;
          const company = deal.companyId ? this.repo.getCompanyById(deal.companyId) || null : null;
          const timeline = this.repo.listTimelineEvents({ dealId: id });
          return {
            status: 200,
            body: { data: { ...deal, contact, company, timeline } },
          };
        }

        if (method === 'PATCH' || method === 'PUT') {
          const existing = this.repo.getDealById(id);
          if (!existing) return { status: 404, body: { error: 'Negócio não encontrado.' } };

          const stageChanging = body.stageId && body.stageId !== existing.stageId;
          const updated = this.repo.updateDeal(id, body);
          let workflowExecutions: WorkflowExecution[] = [];

          if (updated && stageChanging) {
            workflowExecutions = this.workflowEngine.trigger(this.repo, {
              triggerType: 'DEAL_STAGE_CHANGED',
              entityType: 'DEAL',
              entityId: updated.id,
              context: { fromStageId: existing.stageId, toStageId: updated.stageId },
            });
          }

          return {
            status: 200,
            body: { data: updated, workflowExecutions },
          };
        }

        if (method === 'DELETE') {
          const deleted = this.repo.deleteDeal(id);
          if (!deleted) return { status: 404, body: { error: 'Negócio não encontrado.' } };
          return { status: 200, body: { success: true, deletedId: id } };
        }
      }

      // ======================================================================
      // PIPELINES (/api/pipelines)
      // ======================================================================
      if (cleanPath === '/api/pipelines') {
        if (method === 'GET') {
          const pipelines = this.repo.listPipelines();
          const deals = this.repo.listDeals();
          const enriched = pipelines.map((p) => ({
            ...p,
            stages: p.stages.map((s) => {
              const stageDeals = deals.filter((d) => d.pipelineId === p.id && d.stageId === s.id);
              return {
                ...s,
                dealsCount: stageDeals.length,
                totalValue: stageDeals.reduce((sum, d) => sum + d.value, 0),
                weightedValue: Math.round(
                  stageDeals.reduce((sum, d) => sum + d.value * (d.probability / 100), 0)
                ),
                deals: stageDeals,
              };
            }),
          }));
          return { status: 200, body: { data: enriched, total: enriched.length } };
        }

        if (method === 'POST') {
          if (!body.name) {
            return { status: 400, body: { error: 'O campo "name" é obrigatório.' } };
          }
          const created = this.repo.createPipeline(body as { name: string });
          return { status: 201, body: { data: created } };
        }
      }

      // ======================================================================
      // TIMELINE (/api/timeline)
      // ======================================================================
      if (cleanPath === '/api/timeline') {
        if (method === 'GET') {
          const events = this.repo.listTimelineEvents({
            contactId: query.contactId,
            companyId: query.companyId,
            dealId: query.dealId,
            type: query.type,
          });
          return { status: 200, body: { data: events, total: events.length } };
        }

        if (method === 'POST') {
          if (!body.type || !body.title) {
            return {
              status: 400,
              body: { error: 'Os campos "type" e "title" são obrigatórios.' },
            };
          }
          const event = this.repo.createTimelineEvent(
            body as { type: 'NOTE'; title: string; [k: string]: unknown }
          );
          return { status: 201, body: { data: event } };
        }
      }

      // ======================================================================
      // WORKFLOWS (/api/workflows, /api/workflows/trigger, /api/workflows/:id)
      // ======================================================================
      if (cleanPath === '/api/workflows') {
        if (method === 'GET') {
          const workflows = this.repo.listWorkflows();
          const executions = this.repo.listWorkflowExecutions();
          return {
            status: 200,
            body: { data: workflows, executions, total: workflows.length },
          };
        }

        if (method === 'POST') {
          // Support triggering if action === 'TRIGGER' or normal workflow creation
          if (body.action === 'TRIGGER' || (body.triggerType && body.entityId && !body.name)) {
            const executions = this.workflowEngine.trigger(this.repo, {
              triggerType: body.triggerType as WorkflowTriggerType,
              entityType: (body.entityType as 'CONTACT' | 'COMPANY' | 'DEAL') || 'CONTACT',
              entityId: String(body.entityId),
              workflowId: body.workflowId ? String(body.workflowId) : undefined,
              context: (body.context as Record<string, unknown>) || {},
            });
            return { status: 200, body: { data: executions, count: executions.length } };
          }

          if (!body.name || !body.triggerType) {
            return {
              status: 400,
              body: { error: 'Os campos "name" e "triggerType" são obrigatórios.' },
            };
          }
          const wf = this.repo.createWorkflow(
            body as { name: string; triggerType: WorkflowTriggerType }
          );
          return { status: 201, body: { data: wf } };
        }
      }

      if (cleanPath === '/api/workflows/trigger' && method === 'POST') {
        if (!body.triggerType || !body.entityId) {
          return {
            status: 400,
            body: { error: 'Os campos "triggerType" e "entityId" são obrigatórios.' },
          };
        }
        const executions = this.workflowEngine.trigger(this.repo, {
          triggerType: body.triggerType as WorkflowTriggerType,
          entityType: (body.entityType as 'CONTACT' | 'COMPANY' | 'DEAL') || 'CONTACT',
          entityId: String(body.entityId),
          workflowId: body.workflowId ? String(body.workflowId) : undefined,
          context: (body.context as Record<string, unknown>) || {},
        });
        return { status: 200, body: { data: executions, count: executions.length } };
      }

      const workflowIdMatch = cleanPath.match(/^\/api\/workflows\/([^/]+)$/);
      if (workflowIdMatch && (method === 'PATCH' || method === 'PUT')) {
        const updated = this.repo.updateWorkflow(workflowIdMatch[1], body);
        if (!updated) return { status: 404, body: { error: 'Workflow não encontrado.' } };
        return { status: 200, body: { data: updated } };
      }

      // ======================================================================
      // SEQUENCES (/api/sequences, /api/sequences/enroll, /api/sequences/interaction)
      // ======================================================================
      if (cleanPath === '/api/sequences') {
        if (method === 'GET') {
          const sequences = this.repo.listSequences();
          const enrollments = this.repo.listSequenceEnrollments({
            sequenceId: query.sequenceId,
            contactId: query.contactId,
            status: query.status,
          });
          const contacts = new Map(this.repo.listContacts().map((c) => [c.id, c]));
          const enrichedEnrollments = enrollments.map((e) => ({
            ...e,
            contact: contacts.get(e.contactId) || null,
          }));
          return {
            status: 200,
            body: {
              data: sequences,
              enrollments: enrichedEnrollments,
              total: sequences.length,
            },
          };
        }

        if (method === 'POST') {
          const action = String(body.action || '').toUpperCase();

          if (action === 'ENROLL') {
            const res = this.sequenceService.enrollContact(this.repo, {
              sequenceId: String(body.sequenceId),
              contactId: String(body.contactId),
              dealId: body.dealId ? String(body.dealId) : null,
            });
            return { status: 201, body: { data: res } };
          }

          if (action === 'ADVANCE_STEP') {
            const res = this.sequenceService.advanceStep(this.repo, String(body.enrollmentId));
            return { status: 200, body: { data: res } };
          }

          if (action === 'INTERACTION' || action === 'REPLY' || action === 'OPEN' || action === 'CLICK') {
            const interactionType =
              action === 'INTERACTION'
                ? (String(body.interactionType || 'REPLY').toUpperCase() as 'OPEN' | 'CLICK' | 'REPLY')
                : (action as 'OPEN' | 'CLICK' | 'REPLY');
            const res = this.sequenceService.recordInteraction(this.repo, {
              enrollmentId: String(body.enrollmentId),
              interactionType,
              replySnippet: body.replySnippet ? String(body.replySnippet) : undefined,
            });
            return { status: 200, body: { data: res } };
          }

          if (!body.name) {
            return { status: 400, body: { error: 'O campo "name" é obrigatório.' } };
          }
          const created = this.repo.createSequence(body as { name: string });
          return { status: 201, body: { data: created } };
        }
      }

      if (cleanPath === '/api/sequences/enroll' && method === 'POST') {
        const res = this.sequenceService.enrollContact(this.repo, {
          sequenceId: String(body.sequenceId),
          contactId: String(body.contactId),
          dealId: body.dealId ? String(body.dealId) : null,
        });
        return { status: 201, body: { data: res } };
      }

      if (cleanPath === '/api/sequences/interaction' && method === 'POST') {
        const res = this.sequenceService.recordInteraction(this.repo, {
          enrollmentId: String(body.enrollmentId),
          interactionType: String(body.interactionType || 'REPLY').toUpperCase() as
            | 'OPEN'
            | 'CLICK'
            | 'REPLY',
          replySnippet: body.replySnippet ? String(body.replySnippet) : undefined,
        });
        return { status: 200, body: { data: res } };
      }

      // ======================================================================
      // DATA HEALTH (/api/data-health/summary, /duplicates, /merge, /auto-clean)
      // ======================================================================
      if (cleanPath === '/api/data-health/summary' && method === 'GET') {
        const summary = this.healthService.generateHealthSummary(this.repo);
        return { status: 200, body: { data: summary } };
      }

      if (cleanPath === '/api/data-health/duplicates' && method === 'GET') {
        const contacts = this.repo.listContacts();
        const companies = this.repo.listCompanies();
        const deals = this.repo.listDeals();
        const timeline = this.repo.listTimelineEvents();

        const contactDuplicates = detectDuplicateContacts(contacts, deals, timeline);
        const companyDuplicates = detectDuplicateCompanies(companies, contacts, deals, timeline);

        return {
          status: 200,
          body: {
            data: {
              contactDuplicates,
              companyDuplicates,
              totalDuplicates: contactDuplicates.length + companyDuplicates.length,
            },
          },
        };
      }

      if (cleanPath === '/api/data-health/merge' && method === 'POST') {
        const entityType = (String(body.entityType || 'CONTACT').toUpperCase() as 'CONTACT' | 'COMPANY');
        const primaryId = String(body.primaryId || '');
        const duplicateId = String(body.duplicateId || '');

        if (!primaryId || !duplicateId) {
          return {
            status: 400,
            body: { error: 'Os campos "primaryId" e "duplicateId" são obrigatórios.' },
          };
        }

        const result = this.healthService.mergeRecords(this.repo, {
          entityType,
          primaryId,
          duplicateId,
          fieldOverrides: (body.fieldOverrides as Record<string, unknown>) || undefined,
        });

        return { status: 200, body: { data: result } };
      }

      if (cleanPath === '/api/data-health/auto-clean' && method === 'POST') {
        const result = this.healthService.autoCleanDatabase(this.repo, {
          minConfidence: typeof body.minConfidence === 'number' ? body.minConfidence : 80,
          autoEnrich: body.autoEnrich !== false,
        });
        return { status: 200, body: { data: result } };
      }

      // ======================================================================
      // ENRICHMENT (/api/enrichment/run)
      // ======================================================================
      if (cleanPath === '/api/enrichment/run' && method === 'POST') {
        const overwrite = Boolean(body.overwrite);

        // 1. Enrich by contactId
        if (body.contactId) {
          const contact = this.repo.getContactById(String(body.contactId));
          if (!contact) {
            return { status: 404, body: { error: 'Contato não encontrado para enriquecimento.' } };
          }
          const res = this.enrichmentService.enrichContactRecord(
            contact,
            this.repo.listCompanies(),
            this.repo.listDeals(),
            this.repo.listTimelineEvents(),
            { overwrite }
          );

          if (res.isNewCompany && res.matchedOrCreatedCompany) {
            this.repo.createCompany(res.matchedOrCreatedCompany);
          } else if (res.matchedOrCreatedCompany && res.companyFieldsUpdated.length > 0) {
            this.repo.updateCompany(res.matchedOrCreatedCompany.id, res.matchedOrCreatedCompany);
          }

          const updatedContact = this.repo.updateContact(contact.id, res.contact);
          const timelineEvent = this.repo.createTimelineEvent({
            type: 'ENRICHMENT',
            title: `Enriquecimento inteligente concluído (${res.domain || contact.email})`,
            body:
              res.fieldsUpdated.length > 0
                ? `Campos enriquecidos: ${res.fieldsUpdated.join(', ')}. Fonte: ${res.source || 'DomainEngine'}.`
                : 'Dados validados junto ao catálogo corporativo (nenhum campo manual sobrescrito).',
            contactId: contact.id,
            companyId: updatedContact?.companyId || null,
            metadata: {
              domain: res.domain,
              isCorporateDomain: res.isCorporateDomain,
              fieldsUpdated: res.fieldsUpdated,
              source: res.source,
            },
            actor: 'Motor Smart Data',
          });

          return {
            status: 200,
            body: {
              data: {
                entityType: 'CONTACT',
                contact: updatedContact,
                company: res.matchedOrCreatedCompany,
                isCorporateDomain: res.isCorporateDomain,
                domain: res.domain,
                source: res.source,
                fieldsUpdated: res.fieldsUpdated,
                timelineEvent,
              },
            },
          };
        }

        // 2. Enrich by companyId
        if (body.companyId) {
          const company = this.repo.getCompanyById(String(body.companyId));
          if (!company) {
            return { status: 404, body: { error: 'Empresa não encontrada para enriquecimento.' } };
          }
          const res = this.enrichmentService.enrichCompanyRecord(company, { overwrite });
          const updatedCompany = this.repo.updateCompany(company.id, res.company);
          const timelineEvent = this.repo.createTimelineEvent({
            type: 'ENRICHMENT',
            title: `Empresa enriquecida automaticamente (${company.domain || company.name})`,
            body: `Campos atualizados: ${res.fieldsUpdated.join(', ') || 'nenhum campo vazio'}.`,
            companyId: company.id,
            metadata: { fieldsUpdated: res.fieldsUpdated, source: res.source },
            actor: 'Motor Smart Data',
          });

          return {
            status: 200,
            body: {
              data: {
                entityType: 'COMPANY',
                company: updatedCompany,
                fieldsUpdated: res.fieldsUpdated,
                source: res.source,
                timelineEvent,
              },
            },
          };
        }

        // 3. Domain / Email lookup preview or batch enrichment
        if (body.email || body.domain) {
          const lookup = this.enrichmentService.lookupDomain(String(body.email || body.domain));
          return { status: 200, body: { data: lookup } };
        }

        // 4. Batch enrich all contacts
        const contacts = this.repo.listContacts();
        let enrichedCount = 0;
        for (const c of contacts) {
          const res = this.enrichmentService.enrichContactRecord(
            c,
            this.repo.listCompanies(),
            this.repo.listDeals(),
            this.repo.listTimelineEvents(),
            { overwrite }
          );
          if (res.isNewCompany && res.matchedOrCreatedCompany) {
            this.repo.createCompany(res.matchedOrCreatedCompany);
          }
          if (res.fieldsUpdated.length > 0) {
            this.repo.updateContact(c.id, res.contact);
            enrichedCount++;
          }
        }
        return {
          status: 200,
          body: { data: { batchEnriched: true, enrichedCount, totalScanned: contacts.length } },
        };
      }


      // ======================================================================
      // MARKETING HUB — WEB FORMS (/api/forms, /api/forms/submit)
      // ======================================================================
      if (cleanPath === '/api/forms') {
        if (method === 'GET') {
          const forms = this.repo.listWebForms();
          const submissions = this.repo.listFormSubmissions(query.formId);
          const totalViews = forms.reduce((s, f) => s + f.viewsCount, 0);
          const totalSubmissions = forms.reduce((s, f) => s + f.submissionsCount, 0);
          const avgConversionRate =
            totalViews > 0 ? Number(((totalSubmissions / totalViews) * 100).toFixed(2)) : 0;

          return {
            status: 200,
            body: {
              data: forms,
              submissions,
              summary: {
                totalForms: forms.length,
                activeForms: forms.filter((f) => f.isActive).length,
                totalViews,
                totalSubmissions,
                avgConversionRate,
              },
            },
          };
        }

        if (method === 'POST') {
          if (!body.name) {
            return { status: 400, body: { error: 'O campo "name" do formulário é obrigatório.' } };
          }
          const created = this.repo.createWebForm(body as Partial<WebForm> & { name: string });
          return { status: 201, body: { data: created } };
        }
      }

      if (cleanPath === '/api/forms/submit' && method === 'POST') {
        const formId = String(body.formId || 'form-enterprise-demo');
        const form = this.repo.getWebFormById(formId) || this.repo.listWebForms()[0];
        if (!form) {
          return { status: 404, body: { error: 'Formulário não encontrado.' } };
        }

        const rawValues = (body.values && typeof body.values === 'object' ? body.values : body) as Record<string, unknown>;
        const values: Record<string, string> = {};
        for (const [k, v] of Object.entries(rawValues)) {
          if (v !== undefined && v !== null && k !== 'formId' && k !== 'values') {
            values[k] = String(v);
          }
        }

        const email = (values.email || '').trim().toLowerCase();
        const firstName = (values.firstName || values.name || 'Visitante').trim();
        const lastName = (values.lastName || '').trim();
        const phone = values.phone || undefined;
        const jobTitle = values.jobTitle || undefined;
        const companyName = values.companyName || values.company || undefined;

        if (!email) {
          return { status: 400, body: { error: 'O campo "email" é obrigatório na submissão do formulário.' } };
        }

        // 1. Find or Create Contact
        let contact = this.repo.listContacts().find((c) => c.email.toLowerCase() === email);
        if (contact) {
          contact =
            this.repo.updateContact(contact.id, {
              firstName: firstName || contact.firstName,
              lastName: lastName || contact.lastName,
              phone: phone || contact.phone,
              jobTitle: jobTitle || contact.jobTitle,
              lifecycleStage: form.lifecycleStageOnSubmit || contact.lifecycleStage,
            }) || contact;
        } else {
          contact = this.repo.createContact({
            email,
            firstName,
            lastName,
            phone: phone || null,
            jobTitle: jobTitle || null,
            lifecycleStage: form.lifecycleStageOnSubmit || 'MQL',
            leadStatus: 'NEW',
            customProperties: { lastFormSubmitted: form.name },
          });
        }

        // 2. Smart Domain Enrichment or Explicit Company Link
        const enrichRes = this.enrichmentService.enrichContactRecord(
          contact,
          this.repo.listCompanies(),
          this.repo.listDeals(),
          this.repo.listTimelineEvents(),
          { overwrite: false }
        );
        if (enrichRes.isNewCompany && enrichRes.matchedOrCreatedCompany) {
          this.repo.createCompany(enrichRes.matchedOrCreatedCompany);
        }
        if (enrichRes.fieldsUpdated.length > 0) {
          contact = this.repo.updateContact(contact.id, enrichRes.contact) || contact;
        } else if (companyName && !contact.companyId) {
          let comp = this.repo
            .listCompanies()
            .find((c) => c.name.toLowerCase() === companyName.toLowerCase());
          if (!comp) {
            comp = this.repo.createCompany({ name: companyName });
          }
          contact = this.repo.updateContact(contact.id, { companyId: comp.id }) || contact;
        }

        // 3. Auto-create Deal if configured on form
        let createdDeal = null;
        if (form.autoCreateDeal) {
          createdDeal = this.repo.createDeal({
            title: `${companyName || contact.firstName} - Inbound (${form.name})`,
            value: Number(values.estimatedValue || 145000),
            stageId: 'stage-sql',
            contactId: contact.id,
            companyId: contact.companyId,
          });
        }

        // 4. Auto-create Service Ticket if Support Portal form
        let createdTicket = null;
        if (form.autoCreateTicket || form.targetType === 'SUPPORT_TICKET') {
          const priority = (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(
            (values.priority || '').toUpperCase()
          )
            ? (values.priority || 'HIGH').toUpperCase()
            : 'HIGH') as TicketPriority;

          createdTicket = this.repo.createServiceTicket({
            subject: values.subject || `Solicitação via ${form.name} (${contact.firstName})`,
            description:
              values.description ||
              values.message ||
              `Chamado aberto pelo formulário web "${form.name}".`,
            category: (values.category as TicketCategory) || 'SUPPORT',
            priority,
            channel: 'WEB_PORTAL',
            contactId: contact.id,
            companyId: contact.companyId,
            dealId: createdDeal?.id || null,
            comments: [
              {
                id: `cmt-form-${Date.now()}`,
                author: `${contact.firstName} ${contact.lastName}`.trim(),
                authorRole: 'CUSTOMER',
                isInternal: false,
                body:
                  values.description ||
                  values.message ||
                  `Formulário preenchido em ${form.name}.`,
                createdAt: new Date().toISOString(),
              },
            ],
          });
        }

        // 5. Record Timeline Event & Form Submission
        this.repo.createTimelineEvent({
          type: 'FORM_SUBMITTED',
          title: `Formulário convertido: ${form.name}`,
          body: `Submissão recebida de ${contact.firstName} (${contact.email}).${
            createdDeal ? ` Negócio criado: ${createdDeal.title}.` : ''
          }${createdTicket ? ` Ticket aberto: [${createdTicket.key}].` : ''}`,
          contactId: contact.id,
          companyId: contact.companyId,
          dealId: createdDeal?.id || null,
          metadata: { formId: form.id, formSlug: form.slug, values },
          actor: 'Marketing Hub Forms',
        });

        const submission = this.repo.recordFormSubmission({
          id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          formId: form.id,
          formName: form.name,
          values,
          contactId: contact.id,
          companyId: contact.companyId,
          dealId: createdDeal?.id || null,
          ticketId: createdTicket?.id || null,
          submittedAt: new Date().toISOString(),
        });

        // 6. Trigger FORM_SUBMITTED & CONTACT_CREATED Workflows
        const wfExecutions = [
          ...this.workflowEngine.trigger(this.repo, {
            triggerType: 'FORM_SUBMITTED',
            entityType: 'CONTACT',
            entityId: contact.id,
            context: { formId: form.id },
          }),
          ...this.workflowEngine.trigger(this.repo, {
            triggerType: 'CONTACT_CREATED',
            entityType: 'CONTACT',
            entityId: contact.id,
          }),
        ];

        return {
          status: 201,
          body: {
            data: {
              submission,
              contact: this.repo.getContactById(contact.id) || contact,
              deal: createdDeal,
              ticket: createdTicket,
              workflowExecutions: wfExecutions,
            },
          },
        };
      }

      // ======================================================================
      // SERVICE HUB — JIRA SERVICE MANAGEMENT STYLE TICKETS (/api/tickets)
      // ======================================================================
      if (cleanPath === '/api/tickets') {
        if (method === 'GET') {
          const tickets = this.repo.listServiceTickets({
            status: query.status,
            priority: query.priority,
            slaStatus: query.slaStatus,
            category: query.category,
            contactId: query.contactId,
            companyId: query.companyId,
            search: query.search,
          });
          const contacts = new Map(this.repo.listContacts().map((c) => [c.id, c]));
          const companies = new Map(this.repo.listCompanies().map((c) => [c.id, c]));
          const deals = new Map(this.repo.listDeals().map((d) => [d.id, d]));

          const enrichedTickets = tickets.map((t) => ({
            ...t,
            contact: t.contactId ? contacts.get(t.contactId) || null : null,
            company: t.companyId ? companies.get(t.companyId) || null : null,
            deal: t.dealId ? deals.get(t.dealId) || null : null,
          }));

          const allTickets = this.repo.listServiceTickets();
          const openCount = allTickets.filter(
            (t) => t.status !== 'RESOLVED' && t.status !== 'CLOSED'
          ).length;
          const criticalCount = allTickets.filter(
            (t) => t.priority === 'CRITICAL' && t.status !== 'RESOLVED' && t.status !== 'CLOSED'
          ).length;
          const onTrackCount = allTickets.filter((t) => t.slaStatus === 'ON_TRACK').length;
          const breachedCount = allTickets.filter((t) => t.slaStatus === 'BREACHED').length;
          const atRiskCount = allTickets.filter((t) => t.slaStatus === 'AT_RISK').length;
          const slaComplianceRate =
            allTickets.length > 0
              ? Number((((allTickets.length - breachedCount) / allTickets.length) * 100).toFixed(1))
              : 100;

          const csatScores = allTickets
            .map((t) => t.csatScore)
            .filter((s): s is number => typeof s === 'number');
          const avgCsat =
            csatScores.length > 0
              ? Number((csatScores.reduce((a, b) => a + b, 0) / csatScores.length).toFixed(2))
              : 4.9;

          return {
            status: 200,
            body: {
              data: enrichedTickets,
              total: enrichedTickets.length,
              kpis: {
                totalTickets: allTickets.length,
                openCount,
                criticalCount,
                onTrackCount,
                atRiskCount,
                breachedCount,
                slaComplianceRate,
                avgFirstResponseMinutes: 18,
                avgCsat,
              },
            },
          };
        }

        if (method === 'POST') {
          if (!body.subject) {
            return { status: 400, body: { error: 'O campo "subject" do chamado é obrigatório.' } };
          }
          const created = this.repo.createServiceTicket({
            subject: String(body.subject),
            description: body.description ? String(body.description) : undefined,
            category: (body.category as TicketCategory) || 'SUPPORT',
            priority: (body.priority as TicketPriority) || 'MEDIUM',
            status: (body.status as TicketStatus) || 'OPEN',
            channel: (body.channel as TicketChannel) || 'WEB_PORTAL',
            contactId: body.contactId ? String(body.contactId) : null,
            companyId: body.companyId ? String(body.companyId) : null,
            dealId: body.dealId ? String(body.dealId) : null,
            assignee: body.assignee ? String(body.assignee) : undefined,
            tags: Array.isArray(body.tags) ? (body.tags as string[]) : undefined,
          });
          return { status: 201, body: { data: created } };
        }
      }

      const ticketCommentsMatch = cleanPath.match(/^\/api\/tickets\/([^/]+)\/comments$/);
      if (ticketCommentsMatch && method === 'POST') {
        const idOrKey = ticketCommentsMatch[1];
        if (!body.body) {
          return { status: 400, body: { error: 'O campo "body" do comentário é obrigatório.' } };
        }
        const updated = this.repo.addTicketComment(idOrKey, {
          author: body.author ? String(body.author) : 'Marcéllo Mira',
          authorRole: (body.authorRole as 'AGENT' | 'CUSTOMER') || 'AGENT',
          isInternal: Boolean(body.isInternal),
          body: String(body.body),
          newStatus: body.newStatus as TicketStatus | undefined,
        });
        if (!updated) {
          return { status: 404, body: { error: 'Chamado não encontrado.' } };
        }
        return { status: 201, body: { data: updated } };
      }

      const ticketIdMatch = cleanPath.match(/^\/api\/tickets\/([^/]+)$/);
      if (ticketIdMatch) {
        const idOrKey = ticketIdMatch[1];
        if (method === 'GET') {
          const ticket = this.repo.getServiceTicketById(idOrKey);
          if (!ticket) {
            return { status: 404, body: { error: 'Chamado não encontrado.' } };
          }
          const contact = ticket.contactId ? this.repo.getContactById(ticket.contactId) || null : null;
          const company = ticket.companyId ? this.repo.getCompanyById(ticket.companyId) || null : null;
          const deal = ticket.dealId ? this.repo.getDealById(ticket.dealId) || null : null;
          return {
            status: 200,
            body: { data: { ...ticket, contact, company, deal } },
          };
        }

        if (method === 'PATCH' || method === 'PUT') {
          if (body.action === 'ADD_COMMENT' && body.body) {
            const withComment = this.repo.addTicketComment(idOrKey, {
              author: body.author ? String(body.author) : 'Marcéllo Mira',
              authorRole: (body.authorRole as 'AGENT' | 'CUSTOMER') || 'AGENT',
              isInternal: Boolean(body.isInternal),
              body: String(body.body),
              newStatus: body.newStatus as TicketStatus | undefined,
            });
            if (!withComment) return { status: 404, body: { error: 'Chamado não encontrado.' } };
            return { status: 200, body: { data: withComment } };
          }

          const updated = this.repo.updateServiceTicket(idOrKey, body);
          if (!updated) {
            return { status: 404, body: { error: 'Chamado não encontrado.' } };
          }
          return { status: 200, body: { data: updated } };
        }
      }

      // ======================================================================
      // NATIVE HUBSPOT MIGRATION IMPORTER (/api/migration/hubspot)
      // ======================================================================
      if (cleanPath === '/api/migration/hubspot' && method === 'POST') {
        const autoCleanAfterImport = body.autoClean !== false;
        const rawCompanies = Array.isArray(body.companies) ? body.companies : [];
        const rawContacts = Array.isArray(body.contacts) ? body.contacts : [];
        const rawDeals = Array.isArray(body.deals) ? body.deals : [];
        const rawTickets = Array.isArray(body.tickets) ? body.tickets : [];

        // If user clicked "Simular Migração Completa HubSpot API (Private App Token)" without custom arrays, use realistic HubSpot CRM v3 payload
        const useDemoPayload =
          rawCompanies.length === 0 &&
          rawContacts.length === 0 &&
          rawDeals.length === 0 &&
          rawTickets.length === 0;

        const hsCompanies = useDemoPayload
          ? [
              {
                properties: {
                  name: 'iFood.com Agência de Restaurantes Online S.A.',
                  domain: 'ifood.com.br',
                  cnpj: '14.380.200/0001-21',
                  industry: 'Foodtech & Delivery Marketplace',
                  numberofemployees: '5000+',
                  annualrevenue: '8500000000',
                  city: 'Osasco',
                  state: 'SP',
                },
              },
              {
                properties: {
                  name: 'WEG Equipamentos Elétricos S.A.',
                  domain: 'weg.net',
                  cnpj: '84.429.695/0001-11',
                  industry: 'Indústria & Automação Industrial',
                  numberofemployees: '10000+',
                  annualrevenue: '32500000000',
                  city: 'Jaraguá do Sul',
                  state: 'SC',
                },
              },
            ]
          : rawCompanies;

        const hsContacts = useDemoPayload
          ? [
              {
                properties: {
                  email: 'diego.barreto@ifood.com.br',
                  firstname: 'Diego',
                  lastname: 'Barreto',
                  phone: '(11) 99112-3344',
                  jobtitle: 'VP de Estratégia & Finanças',
                  lifecyclestage: 'opportunity',
                  company: 'iFood.com Agência de Restaurantes Online S.A.',
                },
              },
              {
                properties: {
                  email: 'helena.zimmermann@weg.net',
                  firstname: 'Helena',
                  lastname: 'Zimmermann',
                  phone: '(47) 98811-2233',
                  jobtitle: 'Diretora Global de TI',
                  lifecyclestage: 'sql',
                  company: 'WEG Equipamentos Elétricos S.A.',
                },
              },
            ]
          : rawContacts;

        const hsDeals = useDemoPayload
          ? [
              {
                properties: {
                  dealname: 'iFood - Suite Enterprise CRM & Service Hub',
                  amount: '420000',
                  dealstage: 'stage-proposal',
                  associatedCompanyDomain: 'ifood.com.br',
                  associatedContactEmail: 'diego.barreto@ifood.com.br',
                },
              },
              {
                properties: {
                  dealname: 'WEG - Governança Global de Dados B2B',
                  amount: '390000',
                  dealstage: 'stage-demo',
                  associatedCompanyDomain: 'weg.net',
                  associatedContactEmail: 'helena.zimmermann@weg.net',
                },
              },
            ]
          : rawDeals;

        const hsTickets = useDemoPayload
          ? [
              {
                properties: {
                  subject: 'Migração de Webhooks legados HubSpot v3 para HubSpot Pro CRM (iFood)',
                  content: 'Validar chaves de API e fila de eventos em produção após importação.',
                  hs_ticket_priority: 'HIGH',
                  hs_pipeline_stage: 'OPEN',
                  associatedContactEmail: 'diego.barreto@ifood.com.br',
                },
              },
            ]
          : rawTickets;

        let companiesImported = 0;
        let contactsImported = 0;
        let dealsImported = 0;
        let ticketsImported = 0;
        let enrichedRecords = 0;

        for (const item of hsCompanies) {
          const p = (item.properties || item) as Record<string, unknown>;
          const name = String(p.name || p.company || '').trim();
          if (!name) continue;
          const domain = p.domain ? String(p.domain).trim().toLowerCase() : null;

          const existing = this.repo
            .listCompanies()
            .find(
              (c) =>
                (domain && c.domain?.toLowerCase() === domain) ||
                c.name.toLowerCase() === name.toLowerCase()
            );

          if (existing) {
            this.repo.updateCompany(existing.id, {
              cnpj: (p.cnpj as string) || existing.cnpj,
              industry: (p.industry as string) || existing.industry,
              size: (p.numberofemployees as string) || (p.size as string) || existing.size,
              annualRevenue: p.annualrevenue ? Number(p.annualrevenue) : existing.annualRevenue,
              city: (p.city as string) || existing.city,
              state: (p.state as string) || existing.state,
            });
          } else {
            this.repo.createCompany({
              name,
              domain,
              cnpj: p.cnpj ? String(p.cnpj) : null,
              industry: p.industry ? String(p.industry) : null,
              size: p.numberofemployees ? String(p.numberofemployees) : p.size ? String(p.size) : null,
              annualRevenue: p.annualrevenue ? Number(p.annualrevenue) : null,
              city: p.city ? String(p.city) : null,
              state: p.state ? String(p.state) : null,
              enrichmentSource: 'HubSpot-Native-Migrator',
            });
            companiesImported++;
          }
        }

        const stageMap: Record<string, LifecycleStage> = {
          subscriber: 'SUBSCRIBER',
          lead: 'LEAD',
          marketingqualifiedlead: 'MQL',
          mql: 'MQL',
          salesqualifiedlead: 'SQL',
          sql: 'SQL',
          opportunity: 'OPPORTUNITY',
          customer: 'CUSTOMER',
        };

        for (const item of hsContacts) {
          const p = (item.properties || item) as Record<string, unknown>;
          const email = String(p.email || '').trim().toLowerCase();
          const firstName = String(p.firstname || p.firstName || 'Contato').trim();
          const lastName = String(p.lastname || p.lastName || '').trim();
          if (!email) continue;

          const rawStage = String(p.lifecyclestage || p.lifecycleStage || 'lead').toLowerCase();
          const lifecycleStage = stageMap[rawStage] || 'LEAD';

          const domain = email.includes('@') ? email.split('@')[1] : null;
          const matchedCompany = this.repo
            .listCompanies()
            .find(
              (c) =>
                (domain && c.domain?.toLowerCase() === domain) ||
                (p.company && c.name.toLowerCase() === String(p.company).toLowerCase())
            );

          const existing = this.repo.listContacts().find((c) => c.email.toLowerCase() === email);
          let targetContact;
          if (existing) {
            targetContact = this.repo.updateContact(existing.id, {
              firstName,
              lastName: lastName || existing.lastName,
              phone: p.phone ? String(p.phone) : existing.phone,
              jobTitle: p.jobtitle ? String(p.jobtitle) : (p.jobTitle as string) || existing.jobTitle,
              companyId: matchedCompany?.id || existing.companyId,
              lifecycleStage,
            });
          } else {
            targetContact = this.repo.createContact({
              email,
              firstName,
              lastName,
              phone: p.phone ? String(p.phone) : null,
              jobTitle: p.jobtitle ? String(p.jobtitle) : p.jobTitle ? String(p.jobTitle) : null,
              companyId: matchedCompany?.id || null,
              lifecycleStage,
              enrichmentSource: 'HubSpot-Native-Migrator',
            });
            contactsImported++;
          }

          if (targetContact) {
            const enrich = this.enrichmentService.enrichContactRecord(
              targetContact,
              this.repo.listCompanies(),
              this.repo.listDeals(),
              this.repo.listTimelineEvents(),
              { overwrite: false }
            );
            if (enrich.fieldsUpdated.length > 0) {
              this.repo.updateContact(targetContact.id, enrich.contact);
              enrichedRecords++;
            }
          }
        }

        for (const item of hsDeals) {
          const p = (item.properties || item) as Record<string, unknown>;
          const title = String(p.dealname || p.title || '').trim();
          if (!title) continue;
          const value = Number(p.amount ?? p.value ?? 0);
          const stageId = String(p.dealstage || p.stageId || 'stage-discovery');

          const contactEmail = p.associatedContactEmail
            ? String(p.associatedContactEmail).toLowerCase()
            : null;
          const companyDomain = p.associatedCompanyDomain
            ? String(p.associatedCompanyDomain).toLowerCase()
            : null;

          const contact = contactEmail
            ? this.repo.listContacts().find((c) => c.email.toLowerCase() === contactEmail)
            : null;
          const company = companyDomain
            ? this.repo.listCompanies().find((c) => c.domain?.toLowerCase() === companyDomain)
            : null;

          this.repo.createDeal({
            title,
            value,
            stageId,
            contactId: contact?.id || null,
            companyId: company?.id || contact?.companyId || null,
          });
          dealsImported++;
        }

        for (const item of hsTickets) {
          const p = (item.properties || item) as Record<string, unknown>;
          const subject = String(p.subject || '').trim();
          if (!subject) continue;
          const contactEmail = p.associatedContactEmail
            ? String(p.associatedContactEmail).toLowerCase()
            : null;
          const contact = contactEmail
            ? this.repo.listContacts().find((c) => c.email.toLowerCase() === contactEmail)
            : null;

          this.repo.createServiceTicket({
            subject,
            description: String(p.content || p.description || 'Importado via HubSpot Service Hub.'),
            priority: (p.hs_ticket_priority as TicketPriority) || 'HIGH',
            status: (p.hs_pipeline_stage as TicketStatus) || 'OPEN',
            contactId: contact?.id || null,
            companyId: contact?.companyId || null,
            tags: ['HubSpot-Import'],
          });
          ticketsImported++;
        }

        let cleanResult = null;
        if (autoCleanAfterImport) {
          cleanResult = this.healthService.autoCleanDatabase(this.repo, {
            minConfidence: 85,
            autoEnrich: true,
          });
        }

        return {
          status: 200,
          body: {
            data: {
              success: true,
              source: body.accessToken ? 'HubSpot Private App API (v3)' : 'HubSpot CRM Payload Importer',
              companiesImported,
              contactsImported,
              dealsImported,
              ticketsImported,
              enrichedRecords,
              autoCleanReport: cleanResult,
            },
          },
        };
      }

      // ======================================================================
      // AI INSIGHTS (/api/ai-insights)
      // ======================================================================
      if (cleanPath === '/api/ai-insights') {
        if (method === 'GET' || method === 'POST') {
          const question =
            method === 'POST' && body.question ? String(body.question) : query.question;
          const report = this.aiInsightsService.generateInsights(this.repo, question);
          return { status: 200, body: { data: report } };
        }
      }

      return {
        status: 404,
        body: { error: `Rota não encontrada: ${method} ${cleanPath}` },
      };
    } catch (err) {
      return {
        status: 500,
        body: {
          error: err instanceof Error ? err.message : 'Erro interno no servidor do CRM.',
        },
      };
    }
  }
}
