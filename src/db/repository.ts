// ============================================================================
// HubSpot Pro CRM - Transactional Repository Layer (File-Persisted & In-Memory)
// ============================================================================

import fs from 'fs';
import path from 'path';
import {
  Company,
  Contact,
  CrmDatabaseState,
  DataHealthIssue,
  Deal,
  EmailSequence,
  FormSubmission,
  Pipeline,
  SequenceEnrollment,
  ServiceTicket,
  TicketComment,
  TicketPriority,
  TicketSlaStatus,
  TimelineEvent,
  WebForm,
  Workflow,
  WorkflowExecution,
  ErpCommercialProposal,
  ErpRentalContract,
  ErpFiscalInvoice,
  ErpCatalogItem,
  ErpFinancialEntry,
  ErpDatabaseState,
  GestaoClickConfig,
} from './types';
import { createSeedErpState } from '../modules/erp/erp-seed';
import { calculateBrazilianTaxBreakdown } from '../modules/erp/erp-tax-engine';
import { createInitialSeedState } from './seed';
import { calculateCompanyCompleteness, calculateContactCompleteness } from '../modules/data-health/completeness';
import { normalizeAndValidatePhone, normalizeCorporateDomain, validateCnpj, validateEmail } from '../modules/data-health/validators';
import {
  calculateLeadScore,
  computeContactNextBestAction,
  normalizeAndClassifyJobTitle,
} from '../modules/enrichment/enrichment-service';

export interface RepositoryOptions {
  persistPath?: string | null;
  autoSeed?: boolean;
  initialState?: CrmDatabaseState;
}

export class CrmRepository {
  private state: CrmDatabaseState;
  private persistPath: string | null;

  constructor(options: RepositoryOptions = {}) {
    this.persistPath = options.persistPath ?? null;

    if (options.initialState) {
      this.state = structuredClone(options.initialState);
      this.save();
      return;
    }

    if (this.persistPath && fs.existsSync(this.persistPath)) {
      try {
        const raw = fs.readFileSync(this.persistPath, 'utf-8');
        const parsed = JSON.parse(raw) as CrmDatabaseState;
        const seedFallback = createInitialSeedState();
        this.state = {
          ...seedFallback,
          ...parsed,
          webForms: Array.isArray(parsed.webForms) && parsed.webForms.length > 0 ? parsed.webForms : seedFallback.webForms,
          formSubmissions: Array.isArray(parsed.formSubmissions) ? parsed.formSubmissions : seedFallback.formSubmissions,
          pipelines: Array.isArray(parsed.pipelines) && parsed.pipelines.length >= 3 ? parsed.pipelines : seedFallback.pipelines,
          serviceTickets: Array.isArray(parsed.serviceTickets) && parsed.serviceTickets.length > 0 ? parsed.serviceTickets : seedFallback.serviceTickets,
          erp: parsed.erp && Array.isArray(parsed.erp.proposals) ? parsed.erp : createSeedErpState(),
        };
        return;
      } catch {
        // Fallback to seed if corrupted
      }
    }

    if (options.autoSeed !== false) {
      this.state = createInitialSeedState();
      this.save();
    } else {
      this.state = {
        contacts: [],
        companies: [],
        pipelines: [],
        deals: [],
        timelineEvents: [],
        workflows: [],
        workflowExecutions: [],
        sequences: [],
        sequenceEnrollments: [],
        dataHealthIssues: [],
        webForms: [],
        formSubmissions: [],
        serviceTickets: [],
        erp: createSeedErpState(),
      };
    }
  }

  private save(): void {
    if (!this.persistPath) return;
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.persistPath, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch {
      // Fallback to /tmp/crm-store.json on read-only serverless filesystems (e.g. Vercel)
      try {
        const tmpPath = '/tmp/crm-store.json';
        this.persistPath = tmpPath;
        fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), 'utf-8');
      } catch {
        // Ignore write errors if /tmp is also unavailable
      }
    }
  }

  resetToSeed(): CrmDatabaseState {
    this.state = createInitialSeedState();
    this.save();
    return this.getState();
  }

  getState(): CrmDatabaseState {
    return this.state;
  }

  loadState(state: CrmDatabaseState): void {
    const cloned = structuredClone(state);
    if (!cloned.erp || !Array.isArray(cloned.erp.proposals)) {
      cloned.erp = createSeedErpState();
    }
    if (!Array.isArray(cloned.pipelines) || cloned.pipelines.length < 3) {
      const seed = createInitialSeedState();
      const existingIds = new Set((cloned.pipelines || []).map((p) => p.id));
      for (const sp of seed.pipelines) {
        if (!existingIds.has(sp.id)) {
          cloned.pipelines.push(sp);
        }
      }
    }
    this.state = cloned;
    this.save();
  }

  // ==========================================================================
  // CONTACTS
  // ==========================================================================
  listContacts(filters?: {
    search?: string;
    lifecycleStage?: string;
    companyId?: string;
    minScore?: number;
  }): Contact[] {
    let list = [...this.state.contacts];
    if (filters?.lifecycleStage) {
      list = list.filter((c) => c.lifecycleStage === filters.lifecycleStage);
    }
    if (filters?.companyId) {
      list = list.filter((c) => c.companyId === filters.companyId);
    }
    if (typeof filters?.minScore === 'number') {
      list = list.filter((c) => c.leadScore >= filters.minScore!);
    }
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(
        (c) =>
          c.firstName.toLowerCase().includes(q) ||
          c.lastName.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          (c.jobTitle && c.jobTitle.toLowerCase().includes(q))
      );
    }
    return list;
  }

  getContactById(id: string): Contact | undefined {
    return this.state.contacts.find((c) => c.id === id);
  }

  createContact(input: Partial<Contact> & { email: string; firstName: string }): Contact {
    const now = new Date().toISOString();
    const emailVal = validateEmail(input.email);
    const phoneVal = input.phone ? normalizeAndValidatePhone(input.phone) : null;
    const jobInfo = normalizeAndClassifyJobTitle(input.jobTitle);

    const draft: Contact = {
      id: input.id || `cont-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      email: emailVal.normalizedEmail || input.email.trim().toLowerCase(),
      firstName: input.firstName.trim(),
      lastName: (input.lastName || '').trim(),
      phone: phoneVal?.isValid && phoneVal.formatted ? phoneVal.formatted : input.phone ?? null,
      normalizedPhone: phoneVal?.e164 ?? null,
      jobTitle: jobInfo.normalizedTitle || input.jobTitle || null,
      seniority: input.seniority || jobInfo.seniority,
      department: input.department || jobInfo.department,
      lifecycleStage: input.lifecycleStage || 'LEAD',
      leadStatus: input.leadStatus || 'NEW',
      leadScore: 0,
      completenessScore: 0,
      isValidEmail: emailVal.isValid,
      isDisposableEmail: emailVal.isDisposable,
      isCorporateEmail: emailVal.isCorporate,
      isValidPhone: input.phone ? Boolean(phoneVal?.isValid) : false,
      ownerId: input.ownerId ?? null,
      companyId: input.companyId ?? null,
      enrichedAt: input.enrichedAt ?? null,
      enrichmentSource: input.enrichmentSource ?? null,
      nextBestAction: null,
      customProperties: input.customProperties || {},
      lastActivityAt: input.lastActivityAt ?? now,
      createdAt: input.createdAt || now,
      updatedAt: now,
    };

    draft.completenessScore = calculateContactCompleteness(draft).score;
    const company = draft.companyId ? this.getCompanyById(draft.companyId) : null;
    draft.leadScore =
      typeof input.leadScore === 'number'
        ? input.leadScore
        : calculateLeadScore(draft, company, this.state.deals, this.state.timelineEvents);
    draft.nextBestAction = input.nextBestAction || computeContactNextBestAction(draft, this.state.deals);

    this.state.contacts.unshift(draft);
    this.save();
    return draft;
  }

  updateContact(id: string, patchInput: Partial<Contact> | Record<string, unknown>): Contact | null {
    const patch = patchInput as Partial<Contact> & Record<string, unknown>;
    const idx = this.state.contacts.findIndex((c) => c.id === id);
    if (idx === -1) return null;

    const existing = this.state.contacts[idx];
    const now = new Date().toISOString();

    const rawJobTitle =
      patch.jobTitle !== undefined
        ? patch.jobTitle
        : typeof patch.roleTitle === 'string'
          ? patch.roleTitle
          : existing.jobTitle;
    const jobInfo = normalizeAndClassifyJobTitle(rawJobTitle || undefined);

    const nextEmail = patch.email !== undefined ? String(patch.email) : existing.email;
    const emailVal = validateEmail(nextEmail);

    const nextPhone = patch.phone !== undefined ? patch.phone : existing.phone;
    const phoneVal = nextPhone ? normalizeAndValidatePhone(nextPhone) : null;

    const mergedCustomProps: Record<string, unknown> = {
      ...(existing.customProperties || {}),
      ...(patch.customProperties || {}),
    };
    if (patch.ownerName !== undefined) mergedCustomProps.ownerName = patch.ownerName;
    if (patch.city !== undefined) mergedCustomProps.city = patch.city;
    if (patch.state !== undefined) mergedCustomProps.state = patch.state;
    if (patch.cnpj !== undefined) mergedCustomProps.cnpj = patch.cnpj;
    if (patch.tags !== undefined) mergedCustomProps.tags = patch.tags;

    const updated: Contact = {
      ...existing,
      ...patch,
      id: existing.id,
      firstName: patch.firstName !== undefined ? String(patch.firstName).trim() : existing.firstName,
      lastName: patch.lastName !== undefined ? String(patch.lastName).trim() : existing.lastName,
      email: emailVal.normalizedEmail || nextEmail.trim().toLowerCase(),
      phone:
        patch.phone !== undefined
          ? phoneVal?.isValid && phoneVal.formatted
            ? phoneVal.formatted
            : patch.phone
          : existing.phone,
      jobTitle: rawJobTitle !== undefined ? (jobInfo.normalizedTitle || rawJobTitle || null) : existing.jobTitle,
      seniority: patch.seniority !== undefined ? patch.seniority : (jobInfo.seniority || existing.seniority),
      department: patch.department !== undefined ? patch.department : (jobInfo.department || existing.department),
      ownerId:
        patch.ownerId !== undefined
          ? patch.ownerId
          : typeof patch.ownerName === 'string'
            ? patch.ownerName
            : existing.ownerId,
      customProperties: mergedCustomProps,
      isValidEmail: patch.isValidEmail !== undefined ? patch.isValidEmail : emailVal.isValid,
      isDisposableEmail: emailVal.isDisposable,
      isCorporateEmail: emailVal.isCorporate,
      isValidPhone:
        patch.isValidPhone !== undefined
          ? patch.isValidPhone
          : nextPhone
            ? Boolean(phoneVal?.isValid)
            : false,
      normalizedPhone: phoneVal?.e164 ?? (nextPhone ? existing.normalizedPhone ?? null : null),
      updatedAt: now,
    };

    if (patch.completenessScore === undefined) {
      updated.completenessScore = calculateContactCompleteness(updated).score;
    }
    const company = updated.companyId ? this.getCompanyById(updated.companyId) : null;
    if (patch.leadScore === undefined) {
      updated.leadScore = calculateLeadScore(
        updated,
        company,
        this.state.deals,
        this.state.timelineEvents
      );
    }
    if (patch.nextBestAction === undefined) {
      updated.nextBestAction = computeContactNextBestAction(updated, this.state.deals);
    }

    this.state.contacts[idx] = updated;
    this.save();
    return updated;
  }

  deleteContact(id: string): boolean {
    const before = this.state.contacts.length;
    this.state.contacts = this.state.contacts.filter((c) => c.id !== id);
    if (this.state.contacts.length < before) {
      this.save();
      return true;
    }
    return false;
  }

  // ==========================================================================
  // COMPANIES
  // ==========================================================================
  listCompanies(filters?: { search?: string; industry?: string }): Company[] {
    let list = [...this.state.companies];
    if (filters?.industry) {
      list = list.filter((c) => c.industry === filters.industry);
    }
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.domain && c.domain.toLowerCase().includes(q)) ||
          (c.cnpj && c.cnpj.includes(q))
      );
    }
    return list;
  }

  getCompanyById(id: string): Company | undefined {
    return this.state.companies.find((c) => c.id === id);
  }

  createCompany(input: Partial<Company> & { name: string }): Company {
    const now = new Date().toISOString();
    const domVal = normalizeCorporateDomain(input.domain);
    const cnpjVal = validateCnpj(input.cnpj);

    const draft: Company = {
      id: input.id || `comp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: input.name.trim(),
      domain: domVal.isValid ? domVal.domain : input.domain ?? null,
      cnpj: cnpjVal.isValid ? cnpjVal.formatted : input.cnpj ?? null,
      industry: input.industry ?? null,
      size: input.size ?? null,
      annualRevenue: input.annualRevenue ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      country: input.country ?? 'Brasil',
      completenessScore: 0,
      enrichedAt: input.enrichedAt ?? null,
      enrichmentSource: input.enrichmentSource ?? null,
      customProperties: input.customProperties || {},
      lastActivityAt: input.lastActivityAt ?? now,
      createdAt: input.createdAt || now,
      updatedAt: now,
    };

    draft.completenessScore = calculateCompanyCompleteness(draft).score;
    this.state.companies.unshift(draft);
    this.save();
    return draft;
  }

  updateCompany(id: string, patchInput: Partial<Company> | Record<string, unknown>): Company | null {
    const patch = patchInput as Partial<Company> & Record<string, unknown>;
    const idx = this.state.companies.findIndex((c) => c.id === id);
    if (idx === -1) return null;

    const existing = this.state.companies[idx];
    const now = new Date().toISOString();

    const rawDomain = patch.domain !== undefined ? patch.domain : existing.domain;
    const domVal = normalizeCorporateDomain(rawDomain);
    const rawCnpj = patch.cnpj !== undefined ? patch.cnpj : existing.cnpj;
    const cnpjVal = validateCnpj(rawCnpj);

    const nextSize =
      patch.size !== undefined
        ? patch.size
        : typeof patch.sizeRange === 'string'
          ? patch.sizeRange
          : existing.size;

    const nextAnnualRevenue =
      patch.annualRevenue !== undefined
        ? patch.annualRevenue
        : typeof patch.annualRevenueBrl === 'number'
          ? patch.annualRevenueBrl
          : existing.annualRevenue;

    const mergedCustomProps: Record<string, unknown> = {
      ...(existing.customProperties || {}),
      ...(patch.customProperties || {}),
    };
    if (patch.tier !== undefined) mergedCustomProps.tier = patch.tier;
    if (patch.accountOwner !== undefined) mergedCustomProps.accountExecutive = patch.accountOwner;
    if (patch.accountExecutive !== undefined) mergedCustomProps.accountExecutive = patch.accountExecutive;
    if (patch.healthScore !== undefined) mergedCustomProps.healthScore = patch.healthScore;

    const updated: Company = {
      ...existing,
      ...patch,
      id: existing.id,
      name: patch.name !== undefined ? String(patch.name).trim() : existing.name,
      domain: rawDomain ? (domVal.isValid ? domVal.domain : rawDomain) : null,
      cnpj: rawCnpj ? (cnpjVal.isValid ? cnpjVal.formatted : rawCnpj) : null,
      size: nextSize ?? null,
      annualRevenue: nextAnnualRevenue !== null && nextAnnualRevenue !== undefined ? Number(nextAnnualRevenue) : null,
      customProperties: mergedCustomProps,
      updatedAt: now,
    };

    if (patch.completenessScore === undefined) {
      updated.completenessScore = calculateCompanyCompleteness(updated).score;
    }

    this.state.companies[idx] = updated;
    this.save();
    return updated;
  }

  deleteCompany(id: string): boolean {
    const before = this.state.companies.length;
    this.state.companies = this.state.companies.filter((c) => c.id !== id);
    if (this.state.companies.length < before) {
      // Unlink contacts and deals pointing to deleted company
      for (const c of this.state.contacts) {
        if (c.companyId === id) c.companyId = null;
      }
      for (const d of this.state.deals) {
        if (d.companyId === id) d.companyId = null;
      }
      this.save();
      return true;
    }
    return false;
  }

  // ==========================================================================
  // PIPELINES & DEALS
  // ==========================================================================
  listPipelines(): Pipeline[] {
    return [...this.state.pipelines];
  }

  getPipelineById(id: string): Pipeline | undefined {
    return this.state.pipelines.find((p) => p.id === id);
  }

  createPipeline(input: Partial<Pipeline> & { name: string }): Pipeline {
    const now = new Date().toISOString();
    const pipelineId = input.id || `pipe-${Date.now()}`;
    const stages = (input.stages || []).map((s, idx) => ({
      id: s.id || `stage-${Date.now()}-${idx + 1}`,
      pipelineId,
      name: s.name,
      order: s.order ?? idx + 1,
      defaultProbability: s.defaultProbability ?? 20,
      dealRottingDays: s.dealRottingDays ?? 14,
      isClosed: s.isClosed ?? false,
      isWon: s.isWon ?? false,
    }));

    const pipeline: Pipeline = {
      id: pipelineId,
      name: input.name,
      isDefault: Boolean(input.isDefault),
      currency: input.currency || 'BRL',
      stages,
      createdAt: now,
      updatedAt: now,
    };

    this.state.pipelines.push(pipeline);
    this.save();
    return pipeline;
  }

  listDeals(filters?: {
    pipelineId?: string;
    stageId?: string;
    status?: string;
    contactId?: string;
    companyId?: string;
  }): Deal[] {
    let list = [...this.state.deals];
    if (filters?.pipelineId) list = list.filter((d) => d.pipelineId === filters.pipelineId);
    if (filters?.stageId) list = list.filter((d) => d.stageId === filters.stageId);
    if (filters?.status) list = list.filter((d) => d.status === filters.status);
    if (filters?.contactId) list = list.filter((d) => d.contactId === filters.contactId);
    if (filters?.companyId) list = list.filter((d) => d.companyId === filters.companyId);
    return list;
  }

  getDealById(id: string): Deal | undefined {
    return this.state.deals.find((d) => d.id === id);
  }

  createDeal(input: Partial<Deal> & { title: string; value: number }): Deal {
    const now = new Date().toISOString();
    const defaultPipeline = this.state.pipelines[0];
    const pipelineId = input.pipelineId || defaultPipeline?.id || 'pipe-enterprise-b2b';
    const pipeline = this.getPipelineById(pipelineId) || defaultPipeline;
    const stageId = input.stageId || pipeline?.stages[0]?.id || 'stage-discovery';
    const stage = pipeline?.stages.find((s) => s.id === stageId);

    const deal: Deal = {
      id: input.id || `deal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: input.title.trim(),
      value: Number(input.value) || 0,
      currency: input.currency || 'BRL',
      pipelineId,
      stageId,
      probability: input.probability ?? stage?.defaultProbability ?? 20,
      expectedCloseDate: input.expectedCloseDate ?? null,
      contactId: input.contactId ?? null,
      companyId: input.companyId ?? null,
      ownerId: input.ownerId ?? 'owner-marcello',
      status: input.status || (stage?.isWon ? 'WON' : stage?.isClosed ? 'LOST' : 'OPEN'),
      stageEnteredAt: input.stageEnteredAt || now,
      lastActivityAt: input.lastActivityAt || now,
      closedAt: input.closedAt ?? null,
      lostReason: input.lostReason ?? null,
      nextBestAction: input.nextBestAction ?? {
        actionType: 'FOLLOW_UP',
        title: 'Qualificar escopo e cronograma da oportunidade',
        reason: 'Negócio recém-criado no pipeline.',
        priority: 'MEDIUM',
        suggestedDueInDays: 2,
      },
      customProperties: input.customProperties || {},
      createdAt: input.createdAt || now,
      updatedAt: now,
    };

    this.state.deals.unshift(deal);
    this.save();
    return deal;
  }

  updateDeal(id: string, patch: Partial<Deal>): Deal | null {
    const idx = this.state.deals.findIndex((d) => d.id === id);
    if (idx === -1) return null;

    const existing = this.state.deals[idx];
    const now = new Date().toISOString();
    const stageChanged = patch.stageId && patch.stageId !== existing.stageId;

    let nextProbability = patch.probability ?? existing.probability;
    let nextStatus = patch.status ?? existing.status;
    let nextClosedAt = patch.closedAt !== undefined ? patch.closedAt : existing.closedAt;

    if (stageChanged) {
      const pipeline = this.getPipelineById(patch.pipelineId || existing.pipelineId);
      const targetStage = pipeline?.stages.find((s) => s.id === patch.stageId);
      if (targetStage) {
        if (patch.probability === undefined) {
          nextProbability = targetStage.defaultProbability;
        }
        if (targetStage.isWon) {
          nextStatus = 'WON';
          nextClosedAt = now;
        } else if (targetStage.isClosed && !targetStage.isWon) {
          nextStatus = 'LOST';
          nextClosedAt = now;
        } else if (patch.status === undefined) {
          nextStatus = 'OPEN';
        }
      }
    }

    const updated: Deal = {
      ...existing,
      ...patch,
      id: existing.id,
      probability: nextProbability,
      status: nextStatus,
      closedAt: nextClosedAt,
      stageEnteredAt: stageChanged ? now : existing.stageEnteredAt,
      lastActivityAt: now,
      updatedAt: now,
    };

    this.state.deals[idx] = updated;

    if (stageChanged) {
      this.createTimelineEvent({
        type: 'STAGE_CHANGE',
        title: `Estágio do negócio alterado para ${patch.stageId}`,
        body: `O negócio "${updated.title}" avançou de ${existing.stageId} para ${updated.stageId} (Probabilidade: ${updated.probability}%).`,
        contactId: updated.contactId,
        companyId: updated.companyId,
        dealId: updated.id,
        metadata: {
          fromStageId: existing.stageId,
          toStageId: updated.stageId,
          probability: updated.probability,
        },
      });
    }

    this.save();
    return updated;
  }

  deleteDeal(id: string): boolean {
    const before = this.state.deals.length;
    this.state.deals = this.state.deals.filter((d) => d.id !== id);
    if (this.state.deals.length < before) {
      this.save();
      return true;
    }
    return false;
  }

  // ==========================================================================
  // TIMELINE EVENTS / ACTIVITIES
  // ==========================================================================
  listTimelineEvents(filters?: {
    contactId?: string;
    companyId?: string;
    dealId?: string;
    type?: string;
  }): TimelineEvent[] {
    let list = [...this.state.timelineEvents];
    if (filters?.contactId) list = list.filter((e) => e.contactId === filters.contactId);
    if (filters?.companyId) list = list.filter((e) => e.companyId === filters.companyId);
    if (filters?.dealId) list = list.filter((e) => e.dealId === filters.dealId);
    if (filters?.type) list = list.filter((e) => e.type === filters.type);
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  createTimelineEvent(
    input: Partial<TimelineEvent> & { type: TimelineEvent['type']; title: string }
  ): TimelineEvent {
    const now = new Date().toISOString();
    const evt: TimelineEvent = {
      id: input.id || `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      metadata: input.metadata || {},
      contactId: input.contactId ?? null,
      companyId: input.companyId ?? null,
      dealId: input.dealId ?? null,
      actor: input.actor || 'Sistema',
      createdAt: input.createdAt || now,
    };

    this.state.timelineEvents.unshift(evt);

    // Touch lastActivityAt on linked entities
    if (evt.contactId) {
      const c = this.getContactById(evt.contactId);
      if (c) c.lastActivityAt = evt.createdAt;
    }
    if (evt.companyId) {
      const comp = this.getCompanyById(evt.companyId);
      if (comp) comp.lastActivityAt = evt.createdAt;
    }
    if (evt.dealId) {
      const d = this.getDealById(evt.dealId);
      if (d) d.lastActivityAt = evt.createdAt;
    }

    this.save();
    return evt;
  }

  // ==========================================================================
  // WORKFLOWS & EXECUTIONS
  // ==========================================================================
  listWorkflows(): Workflow[] {
    return [...this.state.workflows];
  }

  getWorkflowById(id: string): Workflow | undefined {
    return this.state.workflows.find((w) => w.id === id);
  }

  createWorkflow(input: Partial<Workflow> & { name: string; triggerType: Workflow['triggerType'] }): Workflow {
    const now = new Date().toISOString();
    const wf: Workflow = {
      id: input.id || `wf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: input.name,
      description: input.description ?? null,
      isActive: input.isActive !== undefined ? input.isActive : true,
      triggerType: input.triggerType,
      triggerConfig: input.triggerConfig || {},
      steps: input.steps || [],
      enrolledCount: input.enrolledCount || 0,
      createdAt: now,
      updatedAt: now,
    };
    this.state.workflows.unshift(wf);
    this.save();
    return wf;
  }

  updateWorkflow(id: string, patch: Partial<Workflow>): Workflow | null {
    const idx = this.state.workflows.findIndex((w) => w.id === id);
    if (idx === -1) return null;
    const updated: Workflow = {
      ...this.state.workflows[idx],
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    };
    this.state.workflows[idx] = updated;
    this.save();
    return updated;
  }

  listWorkflowExecutions(workflowId?: string): WorkflowExecution[] {
    if (workflowId) {
      return this.state.workflowExecutions.filter((e) => e.workflowId === workflowId);
    }
    return [...this.state.workflowExecutions];
  }

  recordWorkflowExecution(exec: WorkflowExecution): WorkflowExecution {
    this.state.workflowExecutions.unshift(exec);
    const wf = this.getWorkflowById(exec.workflowId);
    if (wf && exec.status === 'COMPLETED') {
      wf.enrolledCount += 1;
    }
    this.save();
    return exec;
  }

  // ==========================================================================
  // EMAIL SEQUENCES & ENROLLMENTS
  // ==========================================================================
  listSequences(): EmailSequence[] {
    return [...this.state.sequences];
  }

  getSequenceById(id: string): EmailSequence | undefined {
    return this.state.sequences.find((s) => s.id === id);
  }

  createSequence(input: Partial<EmailSequence> & { name: string }): EmailSequence {
    const now = new Date().toISOString();
    const seq: EmailSequence = {
      id: input.id || `seq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: input.name,
      description: input.description || '',
      category: input.category || 'OUTBOUND',
      isActive: input.isActive !== undefined ? input.isActive : true,
      steps: input.steps || [],
      enrolledCount: input.enrolledCount || 0,
      activeCount: input.activeCount || 0,
      completedCount: input.completedCount || 0,
      repliedCount: input.repliedCount || 0,
      sentCount: input.sentCount || 0,
      openCount: input.openCount || 0,
      clickCount: input.clickCount || 0,
      replyCount: input.replyCount || 0,
      openRate: input.openRate || 0,
      clickRate: input.clickRate || 0,
      replyRate: input.replyRate || 0,
      createdAt: now,
      updatedAt: now,
    };
    this.state.sequences.unshift(seq);
    this.save();
    return seq;
  }

  updateSequence(id: string, patch: Partial<EmailSequence>): EmailSequence | null {
    const idx = this.state.sequences.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    const updated: EmailSequence = {
      ...this.state.sequences[idx],
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    };
    this.state.sequences[idx] = updated;
    this.save();
    return updated;
  }

  listSequenceEnrollments(filters?: {
    sequenceId?: string;
    contactId?: string;
    status?: string;
  }): SequenceEnrollment[] {
    let list = [...this.state.sequenceEnrollments];
    if (filters?.sequenceId) list = list.filter((e) => e.sequenceId === filters.sequenceId);
    if (filters?.contactId) list = list.filter((e) => e.contactId === filters.contactId);
    if (filters?.status) list = list.filter((e) => e.status === filters.status);
    return list;
  }

  getSequenceEnrollmentById(id: string): SequenceEnrollment | undefined {
    return this.state.sequenceEnrollments.find((e) => e.id === id);
  }

  saveSequenceEnrollment(enrollment: SequenceEnrollment): SequenceEnrollment {
    const idx = this.state.sequenceEnrollments.findIndex((e) => e.id === enrollment.id);
    if (idx === -1) {
      this.state.sequenceEnrollments.unshift(enrollment);
    } else {
      this.state.sequenceEnrollments[idx] = enrollment;
    }
    this.save();
    return enrollment;
  }

  // ==========================================================================
  // DATA HEALTH ISSUES
  // ==========================================================================
  listDataHealthIssues(status?: string): DataHealthIssue[] {
    if (status) {
      return this.state.dataHealthIssues.filter((i) => i.status === status);
    }
    return [...this.state.dataHealthIssues];
  }

  setDataHealthIssues(issues: DataHealthIssue[]): void {
    this.state.dataHealthIssues = issues;
    this.save();
  }

  // ==========================================================================
  // WEB FORMS & SUBMISSIONS (Marketing Hub)
  // ==========================================================================
  listWebForms(): WebForm[] {
    if (!this.state.webForms) this.state.webForms = [];
    return [...this.state.webForms];
  }

  getWebFormById(idOrSlug: string): WebForm | undefined {
    if (!this.state.webForms) this.state.webForms = [];
    return this.state.webForms.find((f) => f.id === idOrSlug || f.slug === idOrSlug);
  }

  createWebForm(input: Partial<WebForm> & { name: string }): WebForm {
    if (!this.state.webForms) this.state.webForms = [];
    const now = new Date().toISOString();
    const slugBase = (input.slug || input.name)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const form: WebForm = {
      id: input.id || `form-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: input.name.trim(),
      slug: slugBase || `form-${Date.now()}`,
      title: input.title || input.name.trim(),
      description: input.description || 'Formulário integrado ao HubSpot Pro CRM.',
      targetType: input.targetType || 'LEAD_CAPTURE',
      fields:
        input.fields && input.fields.length > 0
          ? input.fields
          : [
              { name: 'firstName', label: 'Nome', type: 'TEXT', required: true, placeholder: 'Seu nome' },
              { name: 'email', label: 'E-mail Corporativo', type: 'EMAIL', required: true, placeholder: 'voce@empresa.com.br' },
              { name: 'phone', label: 'Telefone / WhatsApp', type: 'PHONE', required: false, placeholder: '(11) 99999-9999' },
              { name: 'jobTitle', label: 'Cargo', type: 'TEXT', required: false, placeholder: 'Ex: Diretor Comercial' },
            ],
      submitButtonText: input.submitButtonText || 'Enviar Agora',
      redirectUrl: input.redirectUrl ?? null,
      lifecycleStageOnSubmit: input.lifecycleStageOnSubmit || 'MQL',
      autoCreateDeal: Boolean(input.autoCreateDeal),
      autoCreateTicket: Boolean(input.autoCreateTicket || input.targetType === 'SUPPORT_TICKET'),
      viewsCount: input.viewsCount ?? 100,
      submissionsCount: input.submissionsCount ?? 0,
      conversionRate: input.conversionRate ?? 0,
      isActive: input.isActive !== undefined ? input.isActive : true,
      createdAt: now,
      updatedAt: now,
    };

    this.state.webForms.unshift(form);
    this.save();
    return form;
  }

  updateWebForm(id: string, patch: Partial<WebForm>): WebForm | null {
    if (!this.state.webForms) this.state.webForms = [];
    const idx = this.state.webForms.findIndex((f) => f.id === id);
    if (idx === -1) return null;
    const updated: WebForm = {
      ...this.state.webForms[idx],
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    };
    this.state.webForms[idx] = updated;
    this.save();
    return updated;
  }

  listFormSubmissions(formId?: string): FormSubmission[] {
    if (!this.state.formSubmissions) this.state.formSubmissions = [];
    if (formId) {
      return this.state.formSubmissions.filter((s) => s.formId === formId);
    }
    return [...this.state.formSubmissions];
  }

  recordFormSubmission(sub: FormSubmission): FormSubmission {
    if (!this.state.formSubmissions) this.state.formSubmissions = [];
    this.state.formSubmissions.unshift(sub);

    const form = this.getWebFormById(sub.formId);
    if (form) {
      form.submissionsCount += 1;
      form.viewsCount = Math.max(form.viewsCount, form.submissionsCount);
      form.conversionRate = Number(((form.submissionsCount / Math.max(1, form.viewsCount)) * 100).toFixed(2));
      form.updatedAt = sub.submittedAt;
    }

    this.save();
    return sub;
  }

  // ==========================================================================
  // SERVICE DESK TICKETS (Jira Service Management / Service Hub Style)
  // ==========================================================================
  listServiceTickets(filters?: {
    status?: string;
    priority?: string;
    slaStatus?: string;
    category?: string;
    contactId?: string;
    companyId?: string;
    search?: string;
  }): ServiceTicket[] {
    if (!this.state.serviceTickets) this.state.serviceTickets = [];
    let list = [...this.state.serviceTickets];
    if (filters?.status) list = list.filter((t) => t.status === filters.status);
    if (filters?.priority) list = list.filter((t) => t.priority === filters.priority);
    if (filters?.slaStatus) list = list.filter((t) => t.slaStatus === filters.slaStatus);
    if (filters?.category) list = list.filter((t) => t.category === filters.category);
    if (filters?.contactId) list = list.filter((t) => t.contactId === filters.contactId);
    if (filters?.companyId) list = list.filter((t) => t.companyId === filters.companyId);
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(
        (t) =>
          t.key.toLowerCase().includes(q) ||
          t.subject.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.assignee.toLowerCase().includes(q)
      );
    }
    return list;
  }

  getServiceTicketById(idOrKey: string): ServiceTicket | undefined {
    if (!this.state.serviceTickets) this.state.serviceTickets = [];
    return this.state.serviceTickets.find(
      (t) => t.id === idOrKey || t.key.toLowerCase() === idOrKey.toLowerCase()
    );
  }

  createServiceTicket(
    input: Partial<ServiceTicket> & { subject: string }
  ): ServiceTicket {
    if (!this.state.serviceTickets) this.state.serviceTickets = [];
    const now = new Date();
    const nowIso = now.toISOString();

    const maxNum = this.state.serviceTickets.reduce((max, t) => {
      const m = t.key.match(/(\d+)$/);
      return m ? Math.max(max, Number(m[1])) : max;
    }, 100);
    const nextKey = input.key || `JSM-${maxNum + 1}`;

    const priority: TicketPriority = input.priority || 'MEDIUM';
    const slaHoursMap: Record<TicketPriority, { firstRespHours: number; resolveHours: number }> = {
      CRITICAL: { firstRespHours: 1, resolveHours: 4 },
      HIGH: { firstRespHours: 2, resolveHours: 8 },
      MEDIUM: { firstRespHours: 4, resolveHours: 24 },
      LOW: { firstRespHours: 8, resolveHours: 48 },
    };
    const slaSpec = slaHoursMap[priority] || slaHoursMap.MEDIUM;

    const firstRespDue =
      input.slaFirstResponseDueAt ||
      new Date(now.getTime() + slaSpec.firstRespHours * 60 * 60 * 1000).toISOString();
    const resolveDue =
      input.slaResolutionDueAt ||
      new Date(now.getTime() + slaSpec.resolveHours * 60 * 60 * 1000).toISOString();

    const defaultAssigneeMap: Record<string, string> = {
      INCIDENT: 'Equipe N2 SRE & Integrações',
      BUG: 'Engenharia Produto N3',
      BILLING: 'Financeiro & Billing',
      FEATURE_REQUEST: 'Product Management',
      SUPPORT: 'CS Enterprise',
    };

    const category = input.category || 'SUPPORT';

    const ticket: ServiceTicket = {
      id: input.id || `tkt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      key: nextKey,
      subject: input.subject.trim(),
      description: (input.description || 'Chamado registrado no Service Desk.').trim(),
      category,
      priority,
      status: input.status || 'OPEN',
      channel: input.channel || 'WEB_PORTAL',
      contactId: input.contactId ?? null,
      companyId: input.companyId ?? null,
      dealId: input.dealId ?? null,
      assignee: input.assignee || defaultAssigneeMap[category] || 'CS Enterprise',
      slaFirstResponseDueAt: firstRespDue,
      slaResolutionDueAt: resolveDue,
      firstRespondedAt: input.firstRespondedAt ?? null,
      resolvedAt: input.resolvedAt ?? null,
      slaStatus: input.slaStatus || 'ON_TRACK',
      csatScore: input.csatScore ?? null,
      tags: input.tags || [category, priority],
      comments: input.comments || [],
      createdAt: input.createdAt || nowIso,
      updatedAt: nowIso,
    };

    this.state.serviceTickets.unshift(ticket);

    this.createTimelineEvent({
      type: 'TICKET_EVENT',
      title: `Chamado [${ticket.key}] aberto: ${ticket.subject}`,
      body: `Prioridade: ${ticket.priority} | Canal: ${ticket.channel} | Fila: ${ticket.assignee}`,
      contactId: ticket.contactId,
      companyId: ticket.companyId,
      dealId: ticket.dealId,
      metadata: { ticketId: ticket.id, ticketKey: ticket.key, priority: ticket.priority },
      actor: 'Service Desk (JSM)',
    });

    this.save();
    return ticket;
  }

  updateServiceTicket(idOrKey: string, patch: Partial<ServiceTicket>): ServiceTicket | null {
    if (!this.state.serviceTickets) this.state.serviceTickets = [];
    const idx = this.state.serviceTickets.findIndex(
      (t) => t.id === idOrKey || t.key.toLowerCase() === idOrKey.toLowerCase()
    );
    if (idx === -1) return null;

    const existing = this.state.serviceTickets[idx];
    const nowIso = new Date().toISOString();

    let nextResolvedAt = patch.resolvedAt !== undefined ? patch.resolvedAt : existing.resolvedAt;
    let nextSlaStatus: TicketSlaStatus = patch.slaStatus || existing.slaStatus;

    if (patch.status && (patch.status === 'RESOLVED' || patch.status === 'CLOSED')) {
      if (!nextResolvedAt) nextResolvedAt = nowIso;
      if (existing.slaStatus !== 'BREACHED') {
        nextSlaStatus = 'ON_TRACK';
      }
    }

    const updated: ServiceTicket = {
      ...existing,
      ...patch,
      id: existing.id,
      key: existing.key,
      resolvedAt: nextResolvedAt,
      slaStatus: nextSlaStatus,
      updatedAt: nowIso,
    };

    this.state.serviceTickets[idx] = updated;
    this.save();
    return updated;
  }

  addTicketComment(
    idOrKey: string,
    input: {
      author: string;
      authorRole?: 'AGENT' | 'CUSTOMER';
      isInternal?: boolean;
      body: string;
      newStatus?: ServiceTicket['status'];
    }
  ): ServiceTicket | null {
    const ticket = this.getServiceTicketById(idOrKey);
    if (!ticket) return null;

    const nowIso = new Date().toISOString();
    const comment: TicketComment = {
      id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      author: input.author || 'Marcéllo Mira',
      authorRole: input.authorRole || 'AGENT',
      isInternal: Boolean(input.isInternal),
      body: input.body.trim(),
      createdAt: nowIso,
    };

    ticket.comments.push(comment);
    ticket.updatedAt = nowIso;

    if (comment.authorRole === 'AGENT' && !comment.isInternal && !ticket.firstRespondedAt) {
      ticket.firstRespondedAt = nowIso;
    }

    if (input.newStatus) {
      ticket.status = input.newStatus;
      if (input.newStatus === 'RESOLVED' || input.newStatus === 'CLOSED') {
        ticket.resolvedAt = nowIso;
      }
    } else if (comment.authorRole === 'AGENT' && !comment.isInternal && ticket.status === 'OPEN') {
      ticket.status = 'IN_PROGRESS';
    }

    this.save();
    return ticket;
  }

  deleteServiceTicket(idOrKey: string): boolean {
    if (!this.state.serviceTickets) return false;
    const before = this.state.serviceTickets.length;
    this.state.serviceTickets = this.state.serviceTickets.filter(
      (t) => t.id !== idOrKey && t.key.toLowerCase() !== idOrKey.toLowerCase()
    );
    if (this.state.serviceTickets.length < before) {
      this.save();
      return true;
    }
    return false;
  }

  // ==========================================================================
  // DATA HEALTH — REASSIGN INACTIVE / ORPHAN HUBSPOT OWNERS (SETA TELECOM)
  // ==========================================================================
  reassignInactiveOwners(targetOwnerName = 'Marcelo Lopes Mira'): {
    targetOwnerName: string;
    contactsReassigned: number;
    companiesReassigned: number;
    dealsReassigned: number;
  } {
    const activeOwners = new Set([
      'Marcelo Lopes Mira',
      'Marcéllo Mira',
      'Evelyn Ternero Seta Telecom',
      'Contato Seta Telecom',
    ]);
    const targetOwnerId = targetOwnerName.toLowerCase().includes('evelyn')
      ? 'owner-evelyn'
      : 'owner-marcello';

    let contactsReassigned = 0;
    let companiesReassigned = 0;
    let dealsReassigned = 0;

    for (const c of this.state.contacts) {
      const currentOwner = c.ownerName || (c.customProperties?.ownerName as string) || '';
      const isInactive =
        !c.ownerId ||
        c.ownerId.includes('inativo') ||
        currentOwner.toLowerCase().includes('inativo') ||
        (currentOwner && !activeOwners.has(currentOwner));
      if (isInactive) {
        c.ownerId = targetOwnerId;
        c.ownerName = targetOwnerName;
        c.isUnworked = false;
        c.customProperties = { ...(c.customProperties || {}), ownerName: targetOwnerName };
        contactsReassigned++;
      }
    }

    for (const comp of this.state.companies) {
      const currentOwner = comp.ownerName || (comp.customProperties?.accountExecutive as string) || '';
      if (!currentOwner || currentOwner.toLowerCase().includes('inativo')) {
        comp.ownerName = targetOwnerName;
        comp.customProperties = {
          ...(comp.customProperties || {}),
          accountExecutive: targetOwnerName,
        };
        companiesReassigned++;
      }
    }

    for (const d of this.state.deals) {
      const currentOwner = d.ownerName || '';
      if (
        !d.ownerId ||
        d.ownerId.includes('inativo') ||
        currentOwner.toLowerCase().includes('inativo')
      ) {
        d.ownerId = targetOwnerId;
        d.ownerName = targetOwnerName;
        dealsReassigned++;
      }
    }

    this.save();
    return {
      targetOwnerName,
      contactsReassigned,
      companiesReassigned,
      dealsReassigned,
    };
  }

  // ==========================================================================
  // PHASE 4: ERP BRASIL, PROPOSTAS, CONTRATOS DE LOCAÇÃO & FISCAL (GESTÃOCLICK)
  // ==========================================================================
  private ensureErp(): ErpDatabaseState {
    if (!this.state.erp || !Array.isArray(this.state.erp.proposals)) {
      this.state.erp = createSeedErpState();
    }
    return this.state.erp;
  }

  getErpState(): ErpDatabaseState {
    return this.ensureErp();
  }

  getErpOverview() {
    const erp = this.ensureErp();
    const activeContracts = erp.rentalContracts.filter((c) => c.status !== 'ENCERRADO');
    const monthlyRentalMrr = activeContracts.reduce((s, c) => s + c.monthlyValue, 0);
    const totalContractedTcv = activeContracts.reduce(
      (s, c) => s + c.monthlyValue * c.contractMonths,
      0
    );
    const totalRentedEquipments = activeContracts.reduce(
      (s, c) => s + c.equipments.reduce((acc, eq) => acc + eq.quantity, 0),
      0
    );

    const rentalInvoices = erp.invoices.filter((i) => i.documentType === 'FATURA_LOCACAO');
    const totalRentalBilled = rentalInvoices.reduce((s, i) => s + i.grossAmount, 0);
    const issSavedBySv31Stf = Math.round(totalRentalBilled * 0.05 * 100) / 100;

    const totalReceivablesOpen = erp.financialEntries
      .filter((f) => f.type === 'RECEBER' && f.status !== 'PAGO')
      .reduce((s, f) => s + f.amount, 0);
    const totalReceivablesPaid = erp.financialEntries
      .filter((f) => f.type === 'RECEBER' && f.status === 'PAGO')
      .reduce((s, f) => s + f.amount, 0);
    const totalPayables = erp.financialEntries
      .filter((f) => f.type === 'PAGAR')
      .reduce((s, f) => s + f.amount, 0);

    return {
      kpis: {
        monthlyRentalMrr,
        totalContractedTcv,
        activeContractsCount: activeContracts.length,
        totalRentedEquipments,
        openProposalsCount: erp.proposals.filter(
          (p) => p.status === 'ENVIADA' || p.status === 'EM_NEGOCIACAO' || p.status === 'APROVADA'
        ).length,
        totalInvoicesCount: erp.invoices.length,
        totalRentalBilled,
        issSavedBySv31Stf,
        totalReceivablesOpen,
        totalReceivablesPaid,
        totalPayables,
      },
      proposals: erp.proposals,
      rentalContracts: erp.rentalContracts,
      invoices: erp.invoices,
      catalog: erp.catalog,
      financialEntries: erp.financialEntries,
      gestaoClickConfig: erp.gestaoClickConfig,
    };
  }

  listProposals(): ErpCommercialProposal[] {
    return [...this.ensureErp().proposals];
  }

  createProposal(input: Partial<ErpCommercialProposal> & { title: string }): ErpCommercialProposal {
    const erp = this.ensureErp();
    const now = new Date().toISOString();
    const nextNum = erp.proposals.length + 1;
    const code = input.code || `PROP-2026-00${nextNum}`;

    const company = input.companyId ? this.getCompanyById(input.companyId) : undefined;
    const contact = input.contactId ? this.getContactById(input.contactId) : undefined;

    const items =
      Array.isArray(input.items) && input.items.length > 0
        ? input.items
        : [
            {
              id: `pi-${Date.now()}-1`,
              sku: 'GC-EQ-00101',
              description: 'Locação Central PABX IP Seta Cloud Appliance High-Availability',
              fiscalNature: 'LOCACAO_BENS_MOVEIS' as const,
              ncmOrServiceCode: 'NCM 8517.62.14',
              quantity: 1,
              unitPrice: Number(input.monthlyRecurringTotal || 3500),
              discountPercent: 0,
              isRecurring: true,
              totalMonthly: Number(input.monthlyRecurringTotal || 3500),
            },
          ];

    const contractMonths = Number(input.contractMonths || 24);
    const monthlyRecurringTotal =
      input.monthlyRecurringTotal !== undefined
        ? Number(input.monthlyRecurringTotal)
        : items
            .filter((i) => i.isRecurring)
            .reduce((s, i) => s + Number(i.totalMonthly || i.quantity * i.unitPrice), 0);
    const oneTimeSetupTotal =
      input.oneTimeSetupTotal !== undefined
        ? Number(input.oneTimeSetupTotal)
        : items
            .filter((i) => !i.isRecurring)
            .reduce((s, i) => s + Number(i.totalMonthly || i.quantity * i.unitPrice), 0);
    const totalContractValue = monthlyRecurringTotal * contractMonths + oneTimeSetupTotal;

    const proposal: ErpCommercialProposal = {
      id: input.id || `prop-${Date.now()}`,
      code,
      title: input.title.trim(),
      companyId: input.companyId || company?.id || null,
      companyName: input.companyName || company?.name || 'Empresa Cliente B2B',
      companyCnpj: input.companyCnpj || company?.cnpj || '18.236.120/0001-58',
      contactId: input.contactId || contact?.id || null,
      contactName:
        input.contactName ||
        (contact ? `${contact.firstName} ${contact.lastName}`.trim() : 'Decisor Comercial'),
      dealId: input.dealId || null,
      sellerName: input.sellerName || 'Marcelo Lopes Mira',
      status: input.status || 'ENVIADA',
      contractMonths,
      paymentCondition: input.paymentCondition || 'Boleto / PIX Corporativo — Vencimento dia 10',
      validUntil: input.validUntil || new Date(Date.now() + 15 * 86400000).toISOString(),
      items,
      monthlyRecurringTotal,
      oneTimeSetupTotal,
      totalContractValue,
      commercialNotes:
        input.commercialNotes ||
        'Locação pura de bens móveis sem mão de obra (Dispensa de ISSQN conforme LC 116/2003 e Súmula Vinculante 31 do STF).',
      technicalClauses:
        input.technicalClauses ||
        `SLA 99,95% Seta Telecom com substituição expressa de hardware. Vigência contratual de ${contractMonths} meses.`,
      convertedContractId: null,
      convertedInvoiceId: null,
      createdAt: now,
      updatedAt: now,
    };

    erp.proposals.unshift(proposal);
    this.save();
    return proposal;
  }

  approveProposalAndConvertToContract(proposalId: string): {
    proposal: ErpCommercialProposal;
    contract: ErpRentalContract;
    invoice: ErpFiscalInvoice;
  } | null {
    const erp = this.ensureErp();
    const proposal = erp.proposals.find((p) => p.id === proposalId || p.code === proposalId);
    if (!proposal) return null;

    const now = new Date();
    const nowIso = now.toISOString();
    const competence = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

    const contractNumber = `LOC-${now.getFullYear()}-${100 + erp.rentalContracts.length + 1}`;
    const remessaNfeNumber = `000.419.${100 + erp.invoices.length + 1}`;

    const equipments = proposal.items.map((item, idx) => ({
      id: `eq-${Date.now()}-${idx + 1}`,
      skuGestaoClick: item.sku || `GC-EQ-00${idx + 1}`,
      description: item.description,
      serialNumber: `SN-SETA-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
      ncm: item.ncmOrServiceCode.replace('NCM ', '') || '8517.62.14',
      quantity: item.quantity,
      unitMonthlyRent: item.unitPrice,
      assetValueBrl: item.unitPrice * 6 * item.quantity,
      remessaCfop: '5.908' as const,
      remessaNfeKey: `3526101845678900019055001000419${100 + idx}1000419991`,
    }));

    const contract: ErpRentalContract = {
      id: `ctr-${Date.now()}`,
      contractNumber,
      title: `Contrato de Locação — ${proposal.companyName} (${proposal.code})`,
      companyId: proposal.companyId,
      companyName: proposal.companyName,
      companyCnpj: proposal.companyCnpj,
      contactId: proposal.contactId,
      dealId: proposal.dealId,
      proposalId: proposal.id,
      monthlyValue: proposal.monthlyRecurringTotal,
      dueDay: 10,
      startDate: nowIso.slice(0, 10),
      endDate: new Date(
        now.getTime() + proposal.contractMonths * 30 * 24 * 60 * 60 * 1000
      )
        .toISOString()
        .slice(0, 10),
      contractMonths: proposal.contractMonths,
      readjustmentIndex: 'IPCA',
      status: 'ATIVO',
      equipments,
      remessaNfeNumber,
      remessaCfop: '5.908',
      legalBasisNote:
        'Locação pura de bens móveis sem fornecimento de mão de obra. Não incidência de ISSQN conforme Veto Presidencial ao item 3.01 da LC 116/2003 e Súmula Vinculante nº 31 do STF.',
      lastBilledCompetence: competence,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    erp.rentalContracts.unshift(contract);

    const invoice = this.generateMonthlyRentalInvoice(contract.id, competence)!;

    proposal.status = 'CONVERTIDA_CONTRATO';
    proposal.convertedContractId = contract.id;
    proposal.convertedInvoiceId = invoice.id;
    proposal.updatedAt = nowIso;

    if (proposal.dealId) {
      this.updateDeal(proposal.dealId, {
        status: 'WON',
        wonReason: `Proposta ${proposal.code} aprovada e convertida no Contrato ${contract.contractNumber}`,
      });
    }

    this.save();
    return { proposal, contract, invoice };
  }

  listRentalContracts(): ErpRentalContract[] {
    return [...this.ensureErp().rentalContracts];
  }

  createRentalContract(
    input: Partial<ErpRentalContract> & { title: string; companyName: string; monthlyValue: number }
  ): ErpRentalContract {
    const erp = this.ensureErp();
    const nowIso = new Date().toISOString();
    const contractNumber =
      input.contractNumber || `LOC-2026-${100 + erp.rentalContracts.length + 1}`;
    const contractMonths = Number(input.contractMonths || 24);

    const contract: ErpRentalContract = {
      id: input.id || `ctr-${Date.now()}`,
      contractNumber,
      title: input.title.trim(),
      companyId: input.companyId || null,
      companyName: input.companyName,
      companyCnpj: input.companyCnpj || '18.236.120/0001-58',
      contactId: input.contactId || null,
      dealId: input.dealId || null,
      proposalId: input.proposalId || null,
      monthlyValue: Number(input.monthlyValue || 0),
      dueDay: Number(input.dueDay || 10),
      startDate: input.startDate || nowIso.slice(0, 10),
      endDate:
        input.endDate ||
        new Date(Date.now() + contractMonths * 30 * 86400000).toISOString().slice(0, 10),
      contractMonths,
      readjustmentIndex: input.readjustmentIndex || 'IPCA',
      status: input.status || 'ATIVO',
      equipments:
        input.equipments && input.equipments.length > 0
          ? input.equipments
          : [
              {
                id: `eq-${Date.now()}`,
                skuGestaoClick: 'GC-EQ-00101',
                description: 'Equipamento Telecom em Locação Seta Telecom',
                serialNumber: `SN-SETA-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
                ncm: '8517.62.14',
                quantity: 1,
                unitMonthlyRent: Number(input.monthlyValue || 0),
                assetValueBrl: Number(input.monthlyValue || 0) * 6,
                remessaCfop: input.remessaCfop || '5.908',
                remessaNfeKey: '35261018456789000190550010004200011000420009',
              },
            ],
      remessaNfeNumber: input.remessaNfeNumber || `000.420.${erp.rentalContracts.length + 1}`,
      remessaCfop: input.remessaCfop || '5.908',
      legalBasisNote:
        input.legalBasisNote ||
        'Locação de Bens Móveis pura (Não incidência de ISSQN conforme LC 116/2003 e Súmula Vinculante 31 do STF).',
      lastBilledCompetence: input.lastBilledCompetence || null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    erp.rentalContracts.unshift(contract);
    this.save();
    return contract;
  }

  generateMonthlyRentalInvoice(
    contractId: string,
    competenceMonth?: string
  ): ErpFiscalInvoice | null {
    const erp = this.ensureErp();
    const contract = erp.rentalContracts.find(
      (c) => c.id === contractId || c.contractNumber === contractId
    );
    if (!contract) return null;

    const now = new Date();
    const nowIso = now.toISOString();
    const comp =
      competenceMonth ||
      `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

    const taxBreakdown = calculateBrazilianTaxBreakdown({
      grossAmount: contract.monthlyValue,
      discountAmount: 0,
      documentType: 'FATURA_LOCACAO',
      taxRegime: erp.gestaoClickConfig.taxRegime,
    });

    const seqNum = String(erp.invoices.length + 1).padStart(4, '0');
    const docNum = `FAT-LOC-2026-${seqNum}`;
    const dueDate = new Date(now.getTime() + 10 * 86400000).toISOString().slice(0, 10);

    const invoice: ErpFiscalInvoice = {
      id: `inv-loc-${Date.now()}`,
      documentNumber: docNum,
      documentType: 'FATURA_LOCACAO',
      competenceMonth: comp,
      companyId: contract.companyId,
      companyName: contract.companyName,
      companyCnpj: contract.companyCnpj,
      companyAddress: 'Endereço Comercial Cadastrado — São Paulo/SP',
      rentalContractId: contract.id,
      proposalId: contract.proposalId,
      dealId: contract.dealId,
      grossAmount: contract.monthlyValue,
      discountAmount: 0,
      netAmount: taxBreakdown.netReceivableAmount,
      status: 'EMITIDA',
      issueDate: nowIso.slice(0, 10),
      dueDate,
      paidAt: null,
      paymentMethod: 'BOLETO_PIX',
      serviceCodeLc116: 'N/A — Locação Pura de Bens Móveis (Veto Item 3.01 LC 116/03 + SV 31 STF)',
      cfop: `N/A (Fatura de Locação ref. NF-e Remessa CFOP ${contract.remessaCfop} nº ${contract.remessaNfeNumber})`,
      cstIcms: '41 - Não Tributada',
      cstPisCofins: '01 - Operação Tributável Alíquota Básica',
      verificationCodeOrKey: `AUTH-SETA-LOC-${Date.now().toString(36).toUpperCase()}`,
      pixCopyPaste: `00020126580014BR.GOV.BCB.PIX0136financeiro@setatelecom.com.br5204000053039865408${contract.monthlyValue.toFixed(2)}5802BR5917SETA TELECOM LTDA6009SAO PAULO62190515${docNum.replace(/[^A-Z0-9]/g, '')}630499AF`,
      boletoDigitableLine: `34191.79001 01043.510047 91020.150008 7 9890${String(Math.round(contract.monthlyValue * 100)).padStart(10, '0')}`,
      itemsDescription: contract.equipments.map((eq) => ({
        description: `Locação Mensal: ${eq.description} (Contrato ${contract.contractNumber})`,
        serialNumber: eq.serialNumber,
        quantity: eq.quantity,
        unitValue: eq.unitMonthlyRent,
        totalValue: eq.quantity * eq.unitMonthlyRent,
      })),
      taxBreakdown,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    erp.invoices.unshift(invoice);
    contract.lastBilledCompetence = comp;
    contract.updatedAt = nowIso;

    erp.financialEntries.unshift({
      id: `fin-${Date.now()}`,
      type: 'RECEBER',
      category: 'LOCACAO_EQUIPAMENTOS',
      description: `Fatura de Locação ${docNum} — ${contract.companyName} (Comp. ${comp})`,
      companyName: contract.companyName,
      costCenter: 'CC-101 • Receita Recorrente de Locação (MRR)',
      amount: invoice.netAmount,
      dueDate,
      paidAt: null,
      status: 'ABERTO',
      invoiceId: invoice.id,
      paymentMethod: 'Boleto Híbrido PIX',
    });

    this.save();
    return invoice;
  }

  generateRemessaNfe(contractId: string): ErpFiscalInvoice | null {
    const erp = this.ensureErp();
    const contract = erp.rentalContracts.find(
      (c) => c.id === contractId || c.contractNumber === contractId
    );
    if (!contract) return null;

    const nowIso = new Date().toISOString();
    const totalAssetValue = contract.equipments.reduce((s, e) => s + e.assetValueBrl, 0);
    const taxBreakdown = calculateBrazilianTaxBreakdown({
      grossAmount: totalAssetValue,
      discountAmount: 0,
      documentType: 'NFE_REMESSA_LOCACAO',
      taxRegime: erp.gestaoClickConfig.taxRegime,
    });

    const docNum = `NFE-REM-000${415 + erp.invoices.length}`;
    const nfe: ErpFiscalInvoice = {
      id: `inv-rem-${Date.now()}`,
      documentNumber: docNum,
      documentType: 'NFE_REMESSA_LOCACAO',
      competenceMonth: nowIso.slice(5, 7) + '/' + nowIso.slice(0, 4),
      companyId: contract.companyId,
      companyName: contract.companyName,
      companyCnpj: contract.companyCnpj,
      companyAddress: 'Endereço de Instalação do Cliente',
      rentalContractId: contract.id,
      proposalId: contract.proposalId,
      dealId: contract.dealId,
      grossAmount: totalAssetValue,
      discountAmount: 0,
      netAmount: totalAssetValue,
      status: 'PAGA',
      issueDate: nowIso.slice(0, 10),
      dueDate: nowIso.slice(0, 10),
      paidAt: nowIso.slice(0, 10),
      paymentMethod: 'TED_BANCARIA',
      serviceCodeLc116: null,
      cfop: `${contract.remessaCfop} — Remessa de bem por conta de contrato de locação`,
      cstIcms: '041 - Não tributada (Art. 7º, IX do RICMS)',
      cstPisCofins: '08 - Operação sem incidência da contribuição',
      verificationCodeOrKey: `3526 1018 4567 8900 0190 5500 1000 ${415 + erp.invoices.length} 9010 0041 2895`,
      pixCopyPaste: 'DOCUMENTO FISCAL DE REMESSA DE LOCAÇÃO — SEM COBRANÇA FINANCEIRA',
      boletoDigitableLine: 'SEM FATURA FINANCEIRA (CFOP ' + contract.remessaCfop + ')',
      itemsDescription: contract.equipments.map((eq) => ({
        description: `Remessa em Locação (${contract.contractNumber}): ${eq.description}`,
        serialNumber: eq.serialNumber,
        quantity: eq.quantity,
        unitValue: Math.round(eq.assetValueBrl / Math.max(1, eq.quantity)),
        totalValue: eq.assetValueBrl,
      })),
      taxBreakdown,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    erp.invoices.unshift(nfe);
    this.save();
    return nfe;
  }

  listInvoices(): ErpFiscalInvoice[] {
    return [...this.ensureErp().invoices];
  }

  createInvoice(
    input: Partial<ErpFiscalInvoice> & {
      companyName: string;
      grossAmount: number;
      documentType: ErpFiscalInvoice['documentType'];
    }
  ): ErpFiscalInvoice {
    const erp = this.ensureErp();
    const nowIso = new Date().toISOString();
    const grossAmount = Number(input.grossAmount || 0);
    const discountAmount = Number(input.discountAmount || 0);

    const taxBreakdown = calculateBrazilianTaxBreakdown({
      grossAmount,
      discountAmount,
      documentType: input.documentType,
      taxRegime: erp.gestaoClickConfig.taxRegime,
      issRatePercent: erp.gestaoClickConfig.defaultIssRatePercent,
    });

    const prefix =
      input.documentType === 'FATURA_LOCACAO'
        ? 'FAT-LOC-2026-'
        : input.documentType === 'NFSE_SERVICO'
          ? 'NFSE-2026-'
          : input.documentType === 'NFCOM_TELECOM'
            ? 'NFCOM-2026-'
            : 'NFE-REM-';
    const docNum =
      input.documentNumber || `${prefix}${String(erp.invoices.length + 1).padStart(4, '0')}`;
    const dueDate =
      input.dueDate || new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);

    const invoice: ErpFiscalInvoice = {
      id: input.id || `inv-${Date.now()}`,
      documentNumber: docNum,
      documentType: input.documentType,
      competenceMonth: input.competenceMonth || '10/2026',
      companyId: input.companyId || null,
      companyName: input.companyName,
      companyCnpj: input.companyCnpj || '18.236.120/0001-58',
      companyAddress: input.companyAddress || 'São Paulo/SP',
      rentalContractId: input.rentalContractId || null,
      proposalId: input.proposalId || null,
      dealId: input.dealId || null,
      grossAmount,
      discountAmount,
      netAmount: taxBreakdown.netReceivableAmount,
      status: input.status || 'EMITIDA',
      issueDate: input.issueDate || nowIso.slice(0, 10),
      dueDate,
      paidAt: input.paidAt || null,
      paymentMethod: input.paymentMethod || 'BOLETO_PIX',
      serviceCodeLc116:
        input.documentType === 'FATURA_LOCACAO'
          ? 'N/A — Locação de Bens Móveis (LC 116/03 + SV 31 STF)'
          : input.documentType === 'NFSE_SERVICO'
            ? '01.07 — Suporte técnico em informática, instalação e manutenção'
            : null,
      cfop:
        input.documentType === 'NFE_REMESSA_LOCACAO'
          ? '5.908'
          : input.documentType === 'NFCOM_TELECOM'
            ? '5.303'
            : 'N/A',
      cstIcms: '41 - Não Tributada',
      cstPisCofins: '01 - Operação Tributável Alíquota Básica',
      verificationCodeOrKey: `AUTH-SETA-${Date.now().toString(36).toUpperCase()}`,
      pixCopyPaste: `00020126580014BR.GOV.BCB.PIX0136financeiro@setatelecom.com.br5204000053039865408${taxBreakdown.netReceivableAmount.toFixed(2)}5802BR5917SETA TELECOM LTDA6009SAO PAULO6304B8C1`,
      boletoDigitableLine: `34191.79001 01043.510047 91020.150008 1 9890${String(Math.round(taxBreakdown.netReceivableAmount * 100)).padStart(10, '0')}`,
      itemsDescription:
        input.itemsDescription && input.itemsDescription.length > 0
          ? input.itemsDescription
          : [
              {
                description:
                  input.documentType === 'FATURA_LOCACAO'
                    ? 'Locação Mensal de Equipamentos Telecom / TI (Súmula Vinculante 31 STF)'
                    : 'Prestação de Serviços Técnicos Especializados Telecom / NOC',
                quantity: 1,
                unitValue: grossAmount,
                totalValue: grossAmount,
              },
            ],
      taxBreakdown,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    erp.invoices.unshift(invoice);

    if (input.documentType !== 'NFE_REMESSA_LOCACAO') {
      erp.financialEntries.unshift({
        id: `fin-${Date.now()}`,
        type: 'RECEBER',
        category:
          input.documentType === 'FATURA_LOCACAO'
            ? 'LOCACAO_EQUIPAMENTOS'
            : 'SERVICOS_TI_TELECOM',
        description: `${docNum} — ${invoice.companyName}`,
        companyName: invoice.companyName,
        costCenter:
          input.documentType === 'FATURA_LOCACAO'
            ? 'CC-101 • Receita Recorrente de Locação (MRR)'
            : 'CC-102 • Serviços Técnicos & NOC',
        amount: invoice.netAmount,
        dueDate,
        paidAt: null,
        status: 'ABERTO',
        invoiceId: invoice.id,
        paymentMethod: 'Boleto / PIX',
      });
    }

    this.save();
    return invoice;
  }

  markInvoicePaid(id: string): ErpFiscalInvoice | null {
    const erp = this.ensureErp();
    const inv = erp.invoices.find((i) => i.id === id || i.documentNumber === id);
    if (!inv) return null;

    const today = new Date().toISOString().slice(0, 10);
    inv.status = 'PAGA';
    inv.paidAt = today;
    inv.updatedAt = new Date().toISOString();

    for (const entry of erp.financialEntries) {
      if (entry.invoiceId === inv.id) {
        entry.status = 'PAGO';
        entry.paidAt = today;
      }
    }

    this.save();
    return inv;
  }

  listCatalog(): ErpCatalogItem[] {
    return [...this.ensureErp().catalog];
  }

  createCatalogItem(input: Partial<ErpCatalogItem> & { name: string }): ErpCatalogItem {
    const erp = this.ensureErp();
    const item: ErpCatalogItem = {
      id: input.id || `cat-${Date.now()}`,
      gestaoClickCode: input.gestaoClickCode || `GC-EQ-00${erp.catalog.length + 105}`,
      name: input.name.trim(),
      category: input.category || 'EQUIPAMENTO_LOCACAO',
      fiscalNature: input.fiscalNature || 'LOCACAO_BENS_MOVEIS',
      ncmOrLc116: input.ncmOrLc116 || 'NCM 8517.62.14 (Não Incidência ISS - SV 31 STF)',
      cfopDefault: input.cfopDefault || '5.908',
      stockAvailable: Number(input.stockAvailable ?? 10),
      stockRentedInClients: Number(input.stockRentedInClients ?? 0),
      monthlyRentalPrice: Number(input.monthlyRentalPrice ?? 1500),
      saleOrSetupPrice: Number(input.saleOrSetupPrice ?? 8500),
      isActive: true,
    };
    erp.catalog.unshift(item);
    this.save();
    return item;
  }

  listFinancialEntries(): ErpFinancialEntry[] {
    return [...this.ensureErp().financialEntries];
  }

  markFinancialEntryPaid(id: string): ErpFinancialEntry | null {
    const erp = this.ensureErp();
    const entry = erp.financialEntries.find((f) => f.id === id);
    if (!entry) return null;
    entry.status = 'PAGO';
    entry.paidAt = new Date().toISOString().slice(0, 10);
    if (entry.invoiceId) {
      const inv = erp.invoices.find((i) => i.id === entry.invoiceId);
      if (inv) {
        inv.status = 'PAGA';
        inv.paidAt = entry.paidAt;
      }
    }
    this.save();
    return entry;
  }

  syncGestaoClick(): GestaoClickConfig {
    const erp = this.ensureErp();
    const nowIso = new Date().toISOString();
    const totalSynced =
      erp.catalog.length +
      erp.proposals.length +
      erp.rentalContracts.length +
      erp.invoices.length;

    erp.gestaoClickConfig.lastSyncAt = nowIso;
    erp.gestaoClickConfig.connected = true;
    erp.gestaoClickConfig.syncHistory.unshift({
      id: `sync-gc-${Date.now()}`,
      timestamp: nowIso,
      status: 'SUCCESS',
      summary: `Sincronização GestãoClick concluída com sucesso: ${erp.catalog.length} equipamentos/serviços, ${erp.proposals.length} propostas comerciais, ${erp.rentalContracts.length} contratos de locação e ${erp.invoices.length} faturas/recibos atualizados.`,
      recordsSynced: totalSynced,
    });

    this.save();
    return erp.gestaoClickConfig;
  }

  updateGestaoClickConfig(patch: Partial<GestaoClickConfig>): GestaoClickConfig {
    const erp = this.ensureErp();
    erp.gestaoClickConfig = {
      ...erp.gestaoClickConfig,
      ...patch,
    };
    this.save();
    return erp.gestaoClickConfig;
  }

}

let singletonRepo: CrmRepository | null = null;

export function getRepository(): CrmRepository {
  if (!singletonRepo) {
    const defaultStorePath = process.env.VERCEL
      ? '/tmp/crm-store.json'
      : path.join(process.cwd(), '.data', 'crm-store.json');
    const storePath = process.env.CRM_STORE_PATH || defaultStorePath;
    singletonRepo = new CrmRepository({ persistPath: storePath, autoSeed: true });
  }
  return singletonRepo;
}

export function createInMemoryRepository(initialState?: CrmDatabaseState): CrmRepository {
  return new CrmRepository({
    persistPath: null,
    autoSeed: !initialState,
    initialState,
  });
}
