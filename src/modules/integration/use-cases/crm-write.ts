// ============================================================================
// STI-hub — API v1 + MCP: Fase 2 / Lote 2 — escritas reversiveis no CRM (24/11/2026).
// Tarefas (criar/editar/concluir) e RASCUNHOS de automacao/marketing: sequence, workflow e
// campanha nascem sempre INATIVOS/PAUSADOS — nunca ativar, disparar, inscrever ou enviar.
// ============================================================================
import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import type { CrmTask } from '../../../db/types';
import { companyInScope, contactInScope, dealInScope, resolveAssignableOwner } from '../portfolio';
import { recordWriteAudit, rejectMaskedValues, requireOwnerScope, unwrapWrite } from './common';
import { CampaignDto, num, SequenceDto, str, TaskDto, tasksInScope, toTask, toWorkflow, workflowsData, WorkflowDto } from './crm-extra';
import { defineUseCase, IdSchema, IsoDateSchema, notFound, text, UseCaseError, type UseCaseContext } from './types';

const one = <T extends z.ZodType>(item: T) => z.object({ data: item });
const w = { tag: 'CRM' as const, requiredModule: 'crm' as const, domain: 'crm' as const, mutation: true };
const createBase = { ...w, method: 'POST' as const, idempotent: false, successStatus: 201 as const, requireIdempotencyKey: true };
const updateBase = { ...w, method: 'PATCH' as const, idempotent: true, successStatus: 200 as const };
const newId = (prefix: string) => `${prefix}-api-${randomUUID().slice(0, 18)}`;

// ---------------------------------------------------------------------------
// TAREFAS
// ---------------------------------------------------------------------------
const taskFields = () =>
  ({
    title: text(200).min(1).optional(),
    notes: text(4000).optional(),
    type: z.enum(['EMAIL', 'CALL', 'TODO']).optional(),
    priority: z.enum(['HIGH', 'MEDIUM', 'LOW', 'NONE']).optional(),
    status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'WAITING', 'DEFERRED']).optional(),
    queueName: text(80).optional(),
    dueDate: IsoDateSchema.optional(),
    dueTime: z.string().regex(/^\d{2}:\d{2}$/, 'hora HH:mm').optional(),
    reminderMinutesBefore: z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(60), z.literal(1440), z.null()]).optional(),
    assignedUserId: IdSchema.optional(),
    contactId: IdSchema.nullable().optional(),
    companyId: IdSchema.nullable().optional(),
    dealId: IdSchema.nullable().optional(),
  }) as const;

async function taskLinks(ctx: UseCaseContext, ids: { contactId?: string | null; companyId?: string | null; dealId?: string | null }) {
  if (!ids.contactId && !ids.companyId && !ids.dealId) return;
  const snap = await ctx.data.snapshot('crm');
  if (ids.contactId) {
    const c = snap.contacts.find((x) => x.id === ids.contactId);
    if (!c || !contactInScope(ctx.portfolio, c)) throw notFound('Contato');
  }
  if (ids.companyId) {
    const c = snap.companies.find((x) => x.id === ids.companyId);
    if (!c || !companyInScope(ctx.portfolio, c)) throw notFound('Empresa');
  }
  if (ids.dealId) {
    const d = snap.deals.find((x) => x.id === ids.dealId);
    if (!d || !dealInScope(ctx.portfolio, d)) throw notFound('Negocio');
  }
}

function assigneeUser(ctx: UseCaseContext, requested: string | undefined): { id: string; name: string } {
  const u = resolveAssignableOwner(ctx.portfolio, ctx.allUsers, requested, ctx.auth.actorUserId);
  if (!u) throw new UseCaseError(403, 'OWNER_OUT_OF_PORTFOLIO', 'Responsavel fora da carteira permitida para esta credencial.', { fields: ['assignedUserId'] });
  return { id: u.id, name: u.name };
}

/**
 * Tarefa da carteira (leitura) + POSSE POR ID para escrever (correcao CISO Lote 2, 2): a tarefa so
 * guarda o NOME do responsavel; vale o ID gravado pelo conector (criacao/reatribuicao). Carteira
 * TODOS => livre; ID diferente => 404; sem ID => 403 (homonimo nunca edita).
 */
async function findTask(ctx: UseCaseContext, id: string): Promise<CrmTask> {
  const t = (await tasksInScope(ctx, {})).find((x) => x.id === id);
  if (!t) throw notFound('Tarefa');
  if (ctx.auth.portfolioScope !== 'TODOS') {
    const ownerId = await ctx.owners.get('crm.task', t.id);
    if (ownerId && ownerId !== ctx.owner.id) throw notFound('Tarefa');
    if (!ownerId) {
      throw new UseCaseError(403, 'OWNER_ID_REQUIRED', 'Tarefa sem ID de usuario dono: a escrita pela integracao exige carteira TODOS (posse por nome nao vale).');
    }
  }
  return t;
}

export const crmTasksCreate = defineUseCase({
  ...createBase,
  operationId: 'crm.tasks.create',
  toolName: 'crm_tasks_create',
  path: '/api/v1/crm/tasks',
  pathParams: [],
  summary: 'Criar tarefa',
  description: 'Cria tarefa do CRM (responsavel dentro da carteira; vinculos so com registros da carteira). Nao envia e-mail. Idempotency-Key obrigatoria.',
  requiredScope: 'crm:tasks:write',
  inputSchema: z.object({ ...taskFields(), title: text(200).min(1) }).strict(),
  outputSchema: one(TaskDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'crm:tasks:write');
    rejectMaskedValues(input);
    await taskLinks(ctx, input);
    const { assignedUserId, ...rest } = input;
    const who = assigneeUser(ctx, assignedUserId);
    const body = {
      type: 'TODO',
      priority: 'NONE',
      status: 'NOT_STARTED',
      ...rest,
      id: newId('task'),
      assignedTo: who.name,
    };
    const created = unwrapWrite(await ctx.data.write('POST', '/api/tasks', body), 'Tarefa') as CrmTask;
    await ctx.owners.set('crm.task', str(created.id), who.id);
    const out = toTask(created);
    recordWriteAudit(ctx, 'crm.task', 'create', out.id, null, out);
    return { data: out };
  },
});

export const crmTasksUpdate = defineUseCase({
  ...updateBase,
  operationId: 'crm.tasks.update',
  toolName: 'crm_tasks_update',
  path: '/api/v1/crm/tasks/{id}',
  pathParams: ['id'],
  summary: 'Editar tarefa',
  description: 'Edita tarefa da carteira (PATCH strict). Para concluir use crm_tasks_complete.',
  requiredScope: 'crm:tasks:write',
  inputSchema: z.object({ id: IdSchema, ...taskFields() }).strict(),
  outputSchema: one(TaskDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'crm:tasks:write');
    const { id, assignedUserId, ...patch } = input;
    if (Object.keys(patch).length === 0 && !assignedUserId) throw new UseCaseError(422, 'EMPTY_PATCH', 'Nenhum campo para atualizar.');
    rejectMaskedValues(patch);
    const current = await findTask(ctx, id);
    await taskLinks(ctx, patch);
    const body: Record<string, unknown> = { ...patch };
    const who = assignedUserId ? assigneeUser(ctx, assignedUserId) : null;
    // CISO 26/11 (Lote 2, 4): reatribuir troca o dono => so carteira TODOS (antes de gravar).
    const reassign = who && (await ctx.owners.get('crm.task', current.id)) !== who.id ? who : null;
    if (reassign && ctx.auth.portfolioScope !== 'TODOS') {
      throw new UseCaseError(403, 'OWNER_TRANSFER_FORBIDDEN', 'Reatribuir a tarefa troca o dono do registro: exige carteira TODOS.', { fields: ['assignedUserId'] });
    }
    if (who) body.assignedTo = who.name;
    const updated = unwrapWrite(await ctx.data.write('PATCH', `/api/tasks/${encodeURIComponent(current.id)}`, body), 'Tarefa') as CrmTask;
    if (reassign) await ctx.owners.transfer('crm.task', current.id, reassign.id);
    const out = toTask(updated);
    recordWriteAudit(ctx, 'crm.task', 'update', out.id, toTask(current), out);
    return { data: out };
  },
});

export const crmTasksComplete = defineUseCase({
  ...w,
  method: 'POST' as const,
  idempotent: true,
  successStatus: 200 as const,
  operationId: 'crm.tasks.complete',
  toolName: 'crm_tasks_complete',
  path: '/api/v1/crm/tasks/{id}/complete',
  pathParams: ['id'],
  summary: 'Concluir tarefa',
  description: 'Marca uma tarefa da carteira como concluida.',
  requiredScope: 'crm:tasks:write',
  inputSchema: z.object({ id: IdSchema }).strict(),
  outputSchema: one(TaskDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'crm:tasks:write');
    const current = await findTask(ctx, input.id);
    const done = unwrapWrite(await ctx.data.write('POST', `/api/tasks/${encodeURIComponent(current.id)}/complete`, {}), 'Tarefa') as CrmTask;
    const out = toTask(done);
    recordWriteAudit(ctx, 'crm.task', 'complete', out.id, toTask(current), out);
    return { data: out };
  },
});

// ---------------------------------------------------------------------------
// RASCUNHOS DE AUTOMACAO (sempre inativos) E CAMPANHA (sempre PAUSADA)
// ---------------------------------------------------------------------------
const auto = { tag: 'CRM' as const, requiredModule: 'crm' as const, domain: 'crm' as const, mutation: true };

const SequenceStepInput = z
  .object({
    dayOffset: z.number().int().min(0).max(365),
    stepType: z.enum(['MANUAL_EMAIL', 'SALES_TASK', 'PHONE_CALL', 'REMINDER']),
    subject: text(200).optional(),
    bodyTemplate: text(8000).optional(),
    taskTitle: text(200).optional(),
    condition: z.enum(['ALWAYS', 'IF_NO_REPLY', 'IF_OPENED']).optional(),
  })
  .strict();

export const crmSequencesCreateDraft = defineUseCase({
  ...auto,
  method: 'POST' as const,
  idempotent: false,
  successStatus: 201 as const,
  requireIdempotencyKey: true,
  operationId: 'automation.sequences.create_draft',
  toolName: 'crm_sequences_create_draft',
  path: '/api/v1/automation/sequences/drafts',
  pathParams: [],
  summary: 'Criar rascunho de sequence (inativa)',
  description:
    'Cria cadencia SEMPRE INATIVA, com etapas manuais/tarefa (sem e-mail automatico). Nao ativa, nao inscreve contatos, nao envia. Ativar so pela tela. Idempotency-Key obrigatoria.',
  requiredScope: 'crm:automation:write',
  inputSchema: z
    .object({
      name: text(200).min(1),
      description: text(2000).optional(),
      category: z.enum(['OUTBOUND', 'INBOUND_NURTURE', 'FOLLOW_UP', 'REENGAGEMENT']).optional(),
      steps: z.array(SequenceStepInput).max(20).optional(),
    })
    .strict(),
  outputSchema: one(SequenceDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'crm:automation:write');
    rejectMaskedValues(input);
    const steps = (input.steps || []).map((s, i) => ({
      id: newId('step'),
      stepOrder: i + 1,
      dayOffset: s.dayOffset,
      delayDays: s.dayOffset,
      subject: s.subject || '',
      bodyTemplate: s.bodyTemplate || '',
      stepType: s.stepType,
      condition: s.condition || 'ALWAYS',
      ...(s.taskTitle ? { taskTitle: s.taskTitle } : {}),
      requiresManualApproval: true,
      sentCount: 0,
      openCount: 0,
      clickCount: 0,
      replyCount: 0,
    }));
    const body = {
      id: newId('seq'),
      name: input.name,
      description: input.description || '',
      ...(input.category ? { category: input.category } : {}),
      isActive: false,
      steps,
      assignedSellers: [ctx.owner.name],
    };
    const s = unwrapWrite(await ctx.data.write('POST', '/api/sequences', body), 'Cadencia') as Record<string, any>;
    if (s.isActive !== false) throw new UseCaseError(500, 'DRAFT_INVARIANT', 'Rascunho nao ficou inativo.');
    const out = {
      id: str(s.id),
      name: str(s.name),
      description: str(s.description).slice(0, 2000),
      category: str(s.category),
      isActive: false,
      stepsCount: Array.isArray(s.steps) ? s.steps.length : 0,
      enrolledCount: num(s.enrolledCount),
      activeCount: num(s.activeCount),
      completedCount: num(s.completedCount),
      sentCount: num(s.sentCount),
      openRate: num(s.openRate),
      clickRate: num(s.clickRate),
      replyRate: num(s.replyRate),
      updatedAt: str(s.updatedAt || s.createdAt),
    };
    recordWriteAudit(ctx, 'automation.sequence', 'create', out.id, null, out);
    return { data: out };
  },
});

const WorkflowTrigger = z.enum(['CONTACT_CREATED', 'DEAL_STAGE_CHANGED', 'SCORE_THRESHOLD', 'FORM_SUBMITTED', 'DATA_HEALTH_ISSUE']);
/** Etapas de rascunho: sem e-mail, webhook ou inscricao em sequence (so ativando pela tela). */
const WorkflowStepInput = z
  .object({
    type: z.enum(['DELAY', 'ACTION']),
    delayMinutes: z.number().int().min(0).max(525_600).optional(),
    actionType: z.enum(['UPDATE_PROPERTY', 'CREATE_TASK', 'NOTIFY_OWNER', 'ASSIGN_OWNER']).optional(),
    actionConfig: z.record(z.string().max(60), z.union([z.string().max(500), z.number(), z.boolean()])).optional(),
  })
  .strict();
const toWfSteps = (steps: Array<z.infer<typeof WorkflowStepInput>> | undefined) =>
  (steps || []).map((s) => ({ id: newId('wfs'), ...s }));

export const crmWorkflowsCreateDraft = defineUseCase({
  ...auto,
  method: 'POST' as const,
  idempotent: false,
  successStatus: 201 as const,
  requireIdempotencyKey: true,
  operationId: 'automation.workflows.create_draft',
  toolName: 'crm_workflows_create_draft',
  path: '/api/v1/automation/workflows',
  pathParams: [],
  summary: 'Criar rascunho de workflow (inativo)',
  description:
    'Cria workflow SEMPRE INATIVO (o motor ignora inativos). Etapas sem e-mail/webhook/inscricao em sequence. Nao ativa nem dispara. Idempotency-Key obrigatoria.',
  requiredScope: 'crm:automation:write',
  inputSchema: z
    .object({
      name: text(200).min(1),
      description: text(2000).optional(),
      triggerType: WorkflowTrigger,
      steps: z.array(WorkflowStepInput).max(30).optional(),
    })
    .strict(),
  outputSchema: one(WorkflowDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'crm:automation:write');
    rejectMaskedValues(input);
    const body = {
      id: newId('wf'),
      name: input.name,
      description: input.description ?? null,
      triggerType: input.triggerType,
      isActive: false,
      steps: toWfSteps(input.steps),
    };
    const created = unwrapWrite(await ctx.data.write('POST', '/api/workflows', body), 'Workflow');
    const out = toWorkflow(created);
    if (out.isActive) throw new UseCaseError(500, 'DRAFT_INVARIANT', 'Rascunho nao ficou inativo.');
    recordWriteAudit(ctx, 'automation.workflow', 'create', out.id, null, out);
    return { data: out };
  },
});

export const crmWorkflowsUpdateDraft = defineUseCase({
  ...auto,
  method: 'PATCH' as const,
  idempotent: true,
  successStatus: 200 as const,
  operationId: 'automation.workflows.update_draft',
  toolName: 'crm_workflows_update_draft',
  path: '/api/v1/automation/workflows/{id}',
  pathParams: ['id'],
  summary: 'Editar rascunho de workflow',
  description: 'Edita workflow INATIVO (ativo => 409). Continua inativo; nao ativa nem dispara.',
  requiredScope: 'crm:automation:write',
  inputSchema: z
    .object({
      id: IdSchema,
      name: text(200).min(1).optional(),
      description: text(2000).nullable().optional(),
      triggerType: WorkflowTrigger.optional(),
      steps: z.array(WorkflowStepInput).max(30).optional(),
    })
    .strict(),
  outputSchema: one(WorkflowDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'crm:automation:write');
    const { id, steps, ...patch } = input;
    if (Object.keys(patch).length === 0 && !steps) throw new UseCaseError(422, 'EMPTY_PATCH', 'Nenhum campo para atualizar.');
    rejectMaskedValues(patch);
    const current = (await workflowsData(ctx)).workflows.find((x) => x && x.id === id);
    if (!current) throw notFound('Workflow');
    if (current.isActive !== false) throw new UseCaseError(409, 'WORKFLOW_ACTIVE', 'Workflow ativo nao e editado pela integracao (pause pela tela).');
    const body: Record<string, unknown> = { ...patch, isActive: false };
    if (steps) body.steps = toWfSteps(steps);
    const updated = unwrapWrite(await ctx.data.write('PATCH', `/api/workflows/${encodeURIComponent(id)}`, body), 'Workflow');
    const out = toWorkflow(updated);
    recordWriteAudit(ctx, 'automation.workflow', 'update', out.id, toWorkflow(current), out);
    return { data: out };
  },
});

export const crmCampaignsCreateDraft = defineUseCase({
  tag: 'CRM' as const,
  requiredModule: 'crm' as const,
  domain: 'crm' as const,
  mutation: true,
  method: 'POST' as const,
  idempotent: false,
  successStatus: 201 as const,
  requireIdempotencyKey: true,
  operationId: 'marketing.campaigns.create_draft',
  toolName: 'crm_marketing_campaigns_create_draft',
  path: '/api/v1/marketing/campaigns',
  pathParams: [],
  summary: 'Criar rascunho de campanha (pausada)',
  description: 'Cria campanha SEMPRE PAUSADA, sem metricas, com dono = usuario da credencial. Nao dispara, nao envia. Idempotency-Key obrigatoria.',
  requiredScope: 'crm:marketing:write',
  inputSchema: z
    .object({
      name: text(200).min(1),
      objective: text(500).optional(),
      channel: text(120).optional(),
      utmCampaign: z.string().trim().regex(/^[a-z0-9-]{1,80}$/, 'utm invalido').optional(),
      budgetBrl: z.number().finite().min(0).max(100_000_000).optional(),
    })
    .strict(),
  outputSchema: one(CampaignDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'crm:marketing:write');
    rejectMaskedValues(input);
    const body = { ...input, budgetBrl: input.budgetBrl ?? 0, status: 'PAUSED', ownerName: ctx.owner.name };
    const c = unwrapWrite(await ctx.data.write('POST', '/api/marketing/campaigns', body), 'Campanha') as Record<string, any>;
    if (c.status !== 'PAUSED') throw new UseCaseError(500, 'DRAFT_INVARIANT', 'Rascunho de campanha nao ficou pausado.');
    const out = {
      id: str(c.id),
      name: str(c.name),
      objective: str(c.objective),
      status: str(c.status),
      channel: str(c.channel),
      ownerName: str(c.ownerName),
      budgetBrl: num(c.budgetBrl),
      sentCount: num(c.sentCount),
      deliveredCount: num(c.deliveredCount),
      uniqueClicksCount: num(c.uniqueClicksCount),
      repliesCount: num(c.repliesCount),
      unsubscribesCount: num(c.unsubscribesCount),
      opportunitiesCount: num(c.opportunitiesCount),
      wonDealsCount: num(c.wonDealsCount),
      attributedRevenueBrl: num(c.attributedRevenueBrl),
      updatedAt: str(c.updatedAt || c.createdAt),
    };
    recordWriteAudit(ctx, 'marketing.campaign', 'create', out.id, null, out);
    return { data: out };
  },
});

export const CRM_WRITE_USE_CASES = [
  crmTasksCreate,
  crmTasksUpdate,
  crmTasksComplete,
  crmSequencesCreateDraft,
  crmWorkflowsCreateDraft,
  crmWorkflowsUpdateDraft,
  crmCampaignsCreateDraft,
] as const;
