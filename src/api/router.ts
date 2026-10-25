// ============================================================================
// HubSpot Pro CRM - Unified REST API Router & Controller
// ============================================================================

import { CrmRepository, getRepository } from '../db/repository';
import { calculateCompanyCompleteness, calculateContactCompleteness } from '../modules/data-health/completeness';
import { detectDuplicateCompanies, detectDuplicateContacts } from '../modules/data-health/deduplication';
import { DataHealthService } from '../modules/data-health/health-service';
import { EnrichmentService } from '../modules/enrichment/enrichment-service';
import { WorkflowEngine } from '../modules/workflows/workflow-engine';
import { SequenceService } from '../modules/sequences/sequence-service';
import { AiInsightsService } from '../modules/ai-insights/ai-insights-service';
import { WorkflowExecution, WorkflowTriggerType } from '../db/types';

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
  private healthService = new DataHealthService();
  private enrichmentService = new EnrichmentService();
  private workflowEngine = new WorkflowEngine();
  private sequenceService = new SequenceService();
  private aiInsightsService = new AiInsightsService();

  constructor(repo?: CrmRepository) {
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

    try {
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
