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
} from './types';
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
          serviceTickets: Array.isArray(parsed.serviceTickets) && parsed.serviceTickets.length > 0 ? parsed.serviceTickets : seedFallback.serviceTickets,
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
      // Ignore write errors in read-only environments
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
    this.state = structuredClone(state);
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

  updateContact(id: string, patch: Partial<Contact>): Contact | null {
    const idx = this.state.contacts.findIndex((c) => c.id === id);
    if (idx === -1) return null;

    const existing = this.state.contacts[idx];
    const now = new Date().toISOString();

    const nextEmail = patch.email !== undefined ? patch.email : existing.email;
    const emailVal = validateEmail(nextEmail);

    const nextPhone = patch.phone !== undefined ? patch.phone : existing.phone;
    const phoneVal = nextPhone ? normalizeAndValidatePhone(nextPhone) : null;

    const updated: Contact = {
      ...existing,
      ...patch,
      id: existing.id,
      email: emailVal.normalizedEmail || nextEmail,
      isValidEmail: patch.isValidEmail !== undefined ? patch.isValidEmail : emailVal.isValid,
      isDisposableEmail: emailVal.isDisposable,
      isCorporateEmail: emailVal.isCorporate,
      isValidPhone:
        patch.isValidPhone !== undefined
          ? patch.isValidPhone
          : nextPhone
            ? Boolean(phoneVal?.isValid)
            : false,
      normalizedPhone: phoneVal?.e164 ?? existing.normalizedPhone ?? null,
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

  updateCompany(id: string, patch: Partial<Company>): Company | null {
    const idx = this.state.companies.findIndex((c) => c.id === id);
    if (idx === -1) return null;

    const existing = this.state.companies[idx];
    const now = new Date().toISOString();
    const updated: Company = {
      ...existing,
      ...patch,
      id: existing.id,
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
}

let singletonRepo: CrmRepository | null = null;

export function getRepository(): CrmRepository {
  if (!singletonRepo) {
    const storePath =
      process.env.CRM_STORE_PATH ||
      path.join(process.cwd(), '.data', 'crm-store.json');
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
