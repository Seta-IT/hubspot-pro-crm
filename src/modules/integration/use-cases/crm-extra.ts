// ============================================================================
// STI-hub — API v1 + MCP: Fase 2 / Lote 1 — LEITURA do restante do CRM.
// Tarefas, automacao (workflows/sequences), marketing (campanhas/formularios/segmentos),
// insights e saude da base. Somente GET: nada de ativar, inscrever, disparar, enviar,
// mesclar ou limpar. Alcada de tela e carteira aplicadas aqui (contexto interno confiavel).
// ============================================================================
import { z } from 'zod/v4';
import type { CrmTask } from '../../../db/types';
import { companyInScope, contactInScope, dealInScope } from '../portfolio';
import { includesText, requireAllPortfolio, requireOwnerScope } from './common';
import {
  CursorSchema,
  defineUseCase,
  IdSchema,
  LimitSchema,
  notFound,
  PageInfoSchema,
  paginate,
  SearchSchema,
  UseCaseError,
  type UseCaseContext,
} from './types';

const listOf = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item), page: PageInfoSchema });
const one = <T extends z.ZodType>(item: T) => z.object({ data: item });
export const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));
export const strOrNull = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : String(v));
export const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const low = (v: unknown) => String(v ?? '').trim().toLowerCase();

const base = {
  tag: 'CRM' as const,
  requiredModule: 'crm' as const,
  domain: 'crm' as const,
  method: 'GET' as const,
  idempotent: true,
  mutation: false,
  successStatus: 200 as const,
};

export function unwrapRead(res: { status: number; body: any }, what: string): any {
  if (res.status === 404) throw notFound(what);
  if (res.status < 200 || res.status >= 300) throw new UseCaseError(502, 'UPSTREAM_ERROR', `Falha interna ao ler ${what}.`);
  return res.body;
}

// ---------------------------------------------------------------------------
// TAREFAS
// ---------------------------------------------------------------------------
export const TaskDto = z.object({
  id: z.string(),
  title: z.string(),
  notes: z.string(),
  type: z.string(),
  priority: z.string(),
  status: z.string(),
  queueName: z.string(),
  dueDate: z.string(),
  dueTime: z.string(),
  assignedTo: z.string(),
  contactId: z.string().nullable(),
  companyId: z.string().nullable(),
  dealId: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const toTask = (t: CrmTask): z.infer<typeof TaskDto> => ({
  id: str(t.id),
  title: str(t.title),
  notes: str(t.notes).slice(0, 4000),
  type: str(t.type),
  priority: str(t.priority),
  status: str(t.status),
  queueName: str(t.queueName),
  dueDate: str(t.dueDate),
  dueTime: str(t.dueTime),
  assignedTo: str(t.assignedTo),
  contactId: strOrNull(t.contactId),
  companyId: strOrNull(t.companyId),
  dealId: strOrNull(t.dealId),
  completedAt: strOrNull(t.completedAt),
  createdAt: str(t.createdAt),
  updatedAt: str(t.updatedAt || t.createdAt),
});

/** Tarefa na carteira: responsavel na carteira OU registro vinculado (contato/empresa/negocio) na carteira. */
export async function tasksInScope(ctx: UseCaseContext, filters: Record<string, string>): Promise<CrmTask[]> {
  const snap = await ctx.data.snapshot('crm');
  const body = unwrapRead(await ctx.data.read('/api/tasks', filters), 'Tarefas');
  const rows = (Array.isArray(body?.data) ? body.data : []) as CrmTask[];
  if (ctx.portfolio.all) return rows;
  const contacts = new Map(snap.contacts.map((c) => [c.id, c]));
  const companies = new Map(snap.companies.map((c) => [c.id, c]));
  const deals = new Map(snap.deals.map((d) => [d.id, d]));
  return rows.filter((t) => {
    const who = low(t.assignedTo);
    if (who && (ctx.portfolio.names.has(who) || ctx.portfolio.emails.has(who) || ctx.portfolio.ids.has(str(t.assignedTo)))) return true;
    const c = t.contactId ? contacts.get(t.contactId) : undefined;
    if (c && contactInScope(ctx.portfolio, c)) return true;
    const co = t.companyId ? companies.get(t.companyId) : undefined;
    if (co && companyInScope(ctx.portfolio, co)) return true;
    const d = t.dealId ? deals.get(t.dealId) : undefined;
    return !!d && dealInScope(ctx.portfolio, d);
  });
}

export const crmTasksList = defineUseCase({
  ...base,
  operationId: 'tasks.list',
  toolName: 'crm_tasks_list',
  path: '/api/v1/tasks',
  pathParams: [],
  summary: 'Listar tarefas',
  description: 'Tarefas do CRM na carteira (responsavel ou registro vinculado). Filtros por situacao, contato, empresa ou negocio.',
  requiredScope: 'crm:tasks:read',
  inputSchema: z
    .object({
      limit: LimitSchema,
      cursor: CursorSchema,
      search: SearchSchema,
      status: z.string().regex(/^[A-Z_]{2,40}$/).optional(),
      contactId: IdSchema.optional(),
      companyId: IdSchema.optional(),
      dealId: IdSchema.optional(),
    })
    .strict(),
  outputSchema: listOf(TaskDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'crm:tasks:read');
    const rows = (await tasksInScope(ctx, {}))
      .filter(
        (t) =>
          (!input.status || t.status === input.status) &&
          (!input.contactId || t.contactId === input.contactId) &&
          (!input.companyId || t.companyId === input.companyId) &&
          (!input.dealId || t.dealId === input.dealId) &&
          includesText(input.search, t.title, t.notes, t.queueName)
      )
      .sort((a, b) => str(a.dueDate).localeCompare(str(b.dueDate)) || str(a.id).localeCompare(str(b.id)));
    const { data, page } = paginate(rows, input.limit, input.cursor);
    return { data: data.map(toTask), page };
  },
});

export const crmTasksGet = defineUseCase({
  ...base,
  operationId: 'tasks.get',
  toolName: 'crm_tasks_get',
  path: '/api/v1/tasks/{id}',
  pathParams: ['id'],
  summary: 'Obter tarefa',
  description: 'Detalhe de uma tarefa da carteira (fora da carteira responde 404).',
  requiredScope: 'crm:tasks:read',
  inputSchema: z.object({ id: IdSchema }).strict(),
  outputSchema: one(TaskDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'crm:tasks:read');
    const t = (await tasksInScope(ctx, {})).find((x) => x.id === input.id);
    if (!t) throw notFound('Tarefa');
    return { data: toTask(t) };
  },
});

// ---------------------------------------------------------------------------
// AUTOMACAO: SEQUENCES E WORKFLOWS (definicoes; sem ativar/inscrever)
// ---------------------------------------------------------------------------
export const SequenceDto = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  isActive: z.boolean(),
  stepsCount: z.number(),
  enrolledCount: z.number(),
  activeCount: z.number(),
  completedCount: z.number(),
  sentCount: z.number(),
  openRate: z.number(),
  clickRate: z.number(),
  replyRate: z.number(),
  updatedAt: z.string(),
});

export const crmSequencesList = defineUseCase({
  ...base,
  operationId: 'automation.sequences.list',
  toolName: 'crm_sequences_list',
  path: '/api/v1/automation/sequences',
  pathParams: [],
  summary: 'Listar sequences (cadencias de e-mail)',
  description: 'Cadencias (sequences) com etapas e metricas agregadas. Somente leitura: nao inscreve contatos nem envia e-mail.',
  requiredScope: 'crm:automation:read',
  inputSchema: z.object({ limit: LimitSchema, cursor: CursorSchema, search: SearchSchema }).strict(),
  outputSchema: listOf(SequenceDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'crm:automation:read');
    const body = unwrapRead(await ctx.data.read('/api/sequences'), 'Cadencias');
    const rows = ((Array.isArray(body?.data) ? body.data : []) as any[])
      .filter((s) => s && includesText(input.search, s.name, s.description))
      .sort((a, b) => str(a.name).localeCompare(str(b.name)) || str(a.id).localeCompare(str(b.id)));
    const { data, page } = paginate(rows, input.limit, input.cursor);
    return {
      data: data.map((s) => ({
        id: str(s.id),
        name: str(s.name),
        description: str(s.description).slice(0, 2000),
        category: str(s.category),
        isActive: s.isActive === true,
        stepsCount: Array.isArray(s.steps) ? s.steps.length : 0,
        enrolledCount: num(s.enrolledCount),
        activeCount: num(s.activeCount),
        completedCount: num(s.completedCount),
        sentCount: num(s.sentCount),
        openRate: num(s.openRate),
        clickRate: num(s.clickRate),
        replyRate: num(s.replyRate),
        updatedAt: str(s.updatedAt || s.createdAt),
      })),
      page,
    };
  },
});

export const WorkflowDto = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  triggerType: z.string(),
  stepsCount: z.number(),
  enrolledCount: z.number(),
  updatedAt: z.string(),
});
export const WorkflowDetailDto = WorkflowDto.extend({
  steps: z.array(z.object({ order: z.number(), actionType: z.string(), summary: z.string() })),
});
export const toWorkflow = (w: any): z.infer<typeof WorkflowDto> => ({
  id: str(w.id),
  name: str(w.name),
  description: strOrNull(w.description),
  isActive: w.isActive === true,
  triggerType: str(w.triggerType),
  stepsCount: Array.isArray(w.steps) ? w.steps.length : 0,
  enrolledCount: num(w.enrolledCount),
  updatedAt: str(w.updatedAt || w.createdAt),
});

export async function workflowsData(ctx: UseCaseContext): Promise<{ workflows: any[]; executions: any[] }> {
  const body = unwrapRead(await ctx.data.read('/api/workflows'), 'Workflows');
  return { workflows: Array.isArray(body?.data) ? body.data : [], executions: Array.isArray(body?.executions) ? body.executions : [] };
}

export const crmWorkflowsList = defineUseCase({
  ...base,
  operationId: 'automation.workflows.list',
  toolName: 'crm_workflows_list',
  path: '/api/v1/automation/workflows',
  pathParams: [],
  summary: 'Listar workflows',
  description: 'Workflows de automacao (gatilho, etapas, inscritos). Somente leitura: nao ativa, pausa nem dispara.',
  requiredScope: 'crm:automation:read',
  inputSchema: z.object({ limit: LimitSchema, cursor: CursorSchema, search: SearchSchema, activeOnly: z.coerce.boolean().optional() }).strict(),
  outputSchema: listOf(WorkflowDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'crm:automation:read');
    const rows = (await workflowsData(ctx)).workflows
      .filter((w) => w && (!input.activeOnly || w.isActive === true) && includesText(input.search, w.name, w.description))
      .sort((a, b) => str(a.name).localeCompare(str(b.name)) || str(a.id).localeCompare(str(b.id)));
    const { data, page } = paginate(rows, input.limit, input.cursor);
    return { data: data.map(toWorkflow), page };
  },
});

export const crmWorkflowsGet = defineUseCase({
  ...base,
  operationId: 'automation.workflows.get',
  toolName: 'crm_workflows_get',
  path: '/api/v1/automation/workflows/{id}',
  pathParams: ['id'],
  summary: 'Obter workflow',
  description: 'Detalhe de um workflow com o resumo das etapas.',
  requiredScope: 'crm:automation:read',
  inputSchema: z.object({ id: IdSchema }).strict(),
  outputSchema: one(WorkflowDetailDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'crm:automation:read');
    const w = (await workflowsData(ctx)).workflows.find((x) => x && x.id === input.id);
    if (!w) throw notFound('Workflow');
    const steps = (Array.isArray(w.steps) ? w.steps : []).slice(0, 200).map((s: any, i: number) => ({
      order: num(s?.order ?? i + 1),
      actionType: str(s?.actionType || s?.type),
      summary: str(s?.label || s?.name || s?.description || s?.actionType || s?.type).slice(0, 300),
    }));
    return { data: { ...toWorkflow(w), steps } };
  },
});

const WorkflowRunDto = z.object({
  id: z.string(),
  workflowId: z.string(),
  workflowName: z.string().nullable(),
  entityType: z.string(),
  entityId: z.string(),
  status: z.string(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
});

export const crmWorkflowRunsList = defineUseCase({
  ...base,
  operationId: 'automation.workflow_runs.list',
  toolName: 'crm_workflow_runs_list',
  path: '/api/v1/automation/workflow-runs',
  pathParams: [],
  summary: 'Listar execucoes de workflows',
  description: 'Execucoes de workflows sobre contatos/empresas/negocios da carteira.',
  requiredScope: 'crm:automation:read',
  inputSchema: z.object({ limit: LimitSchema, cursor: CursorSchema, workflowId: IdSchema.optional(), status: z.string().regex(/^[A-Z_]{2,30}$/).optional() }).strict(),
  outputSchema: listOf(WorkflowRunDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'crm:automation:read');
    const snap = await ctx.data.snapshot('crm');
    const contacts = new Map(snap.contacts.map((c) => [c.id, c]));
    const companies = new Map(snap.companies.map((c) => [c.id, c]));
    const deals = new Map(snap.deals.map((d) => [d.id, d]));
    const inScope = (e: any): boolean => {
      if (ctx.portfolio.all) return true;
      const id = str(e.entityId);
      if (e.entityType === 'CONTACT') return !!contacts.get(id) && contactInScope(ctx.portfolio, contacts.get(id)!);
      if (e.entityType === 'COMPANY') return !!companies.get(id) && companyInScope(ctx.portfolio, companies.get(id)!);
      if (e.entityType === 'DEAL') return !!deals.get(id) && dealInScope(ctx.portfolio, deals.get(id)!);
      return false;
    };
    const rows = (await workflowsData(ctx)).executions
      .filter((e) => e && inScope(e) && (!input.workflowId || e.workflowId === input.workflowId) && (!input.status || e.status === input.status))
      .sort((a, b) => str(b.startedAt).localeCompare(str(a.startedAt)) || str(a.id).localeCompare(str(b.id)));
    const { data, page } = paginate(rows, input.limit, input.cursor);
    return {
      data: data.map((e) => ({
        id: str(e.id),
        workflowId: str(e.workflowId),
        workflowName: strOrNull(e.workflowName),
        entityType: str(e.entityType),
        entityId: str(e.entityId),
        status: str(e.status),
        startedAt: str(e.startedAt),
        completedAt: strOrNull(e.completedAt),
      })),
      page,
    };
  },
});

// ---------------------------------------------------------------------------
// MARKETING (sem disparo)
// ---------------------------------------------------------------------------
export const CampaignDto = z.object({
  id: z.string(),
  name: z.string(),
  objective: z.string(),
  status: z.string(),
  channel: z.string(),
  ownerName: z.string(),
  budgetBrl: z.number(),
  sentCount: z.number(),
  deliveredCount: z.number(),
  uniqueClicksCount: z.number(),
  repliesCount: z.number(),
  unsubscribesCount: z.number(),
  opportunitiesCount: z.number(),
  wonDealsCount: z.number(),
  attributedRevenueBrl: z.number(),
  updatedAt: z.string(),
});

export const crmCampaignsList = defineUseCase({
  ...base,
  operationId: 'marketing.campaigns.list',
  toolName: 'crm_marketing_campaigns_list',
  path: '/api/v1/marketing/campaigns',
  pathParams: [],
  summary: 'Listar campanhas de marketing',
  description: 'Campanhas com metricas agregadas (envios, cliques, oportunidades, receita atribuida). Somente leitura: sem disparo.',
  requiredScope: 'crm:marketing:read',
  inputSchema: z.object({ limit: LimitSchema, cursor: CursorSchema, search: SearchSchema, status: z.string().regex(/^[A-Z_]{2,30}$/).optional() }).strict(),
  outputSchema: listOf(CampaignDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'crm:marketing:read');
    const body = unwrapRead(await ctx.data.read('/api/marketing/campaigns'), 'Campanhas');
    const rows = ((Array.isArray(body?.data) ? body.data : []) as any[])
      .filter((c) => c && (!input.status || c.status === input.status) && includesText(input.search, c.name, c.objective, c.utmCampaign))
      .sort((a, b) => str(b.updatedAt || b.createdAt).localeCompare(str(a.updatedAt || a.createdAt)) || str(a.id).localeCompare(str(b.id)));
    const { data, page } = paginate(rows, input.limit, input.cursor);
    return {
      data: data.map((c) => ({
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
      })),
      page,
    };
  },
});

const FormDto = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  title: z.string(),
  targetType: z.string(),
  isActive: z.boolean(),
  fieldsCount: z.number(),
  viewsCount: z.number(),
  submissionsCount: z.number(),
  conversionRate: z.number(),
  updatedAt: z.string(),
});

export const crmFormsList = defineUseCase({
  ...base,
  operationId: 'marketing.forms.list',
  toolName: 'crm_marketing_forms_list',
  path: '/api/v1/marketing/forms',
  pathParams: [],
  summary: 'Listar formularios',
  description: 'Formularios web com metricas (visualizacoes, envios, conversao). Sem respostas individuais.',
  requiredScope: 'crm:marketing:read',
  inputSchema: z.object({ limit: LimitSchema, cursor: CursorSchema, search: SearchSchema }).strict(),
  outputSchema: listOf(FormDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'crm:marketing:read');
    const body = unwrapRead(await ctx.data.read('/api/forms'), 'Formularios');
    const rows = ((Array.isArray(body?.data) ? body.data : []) as any[])
      .filter((f) => f && includesText(input.search, f.name, f.title, f.slug))
      .sort((a, b) => str(a.name).localeCompare(str(b.name)) || str(a.id).localeCompare(str(b.id)));
    const { data, page } = paginate(rows, input.limit, input.cursor);
    return {
      data: data.map((f) => ({
        id: str(f.id),
        name: str(f.name),
        slug: str(f.slug),
        title: str(f.title),
        targetType: str(f.targetType),
        isActive: f.isActive !== false,
        fieldsCount: Array.isArray(f.fields) ? f.fields.length : 0,
        viewsCount: num(f.viewsCount),
        submissionsCount: num(f.submissionsCount),
        conversionRate: num(f.conversionRate),
        updatedAt: str(f.updatedAt || f.createdAt),
      })),
      page,
    };
  },
});

const SegmentDto = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: z.string(),
  filterExpression: z.string(),
  count: z.number(),
  updatedAt: z.string(),
});

export const crmSegmentsList = defineUseCase({
  ...base,
  operationId: 'marketing.segments.list',
  toolName: 'crm_marketing_segments_list',
  path: '/api/v1/marketing/segments',
  pathParams: [],
  summary: 'Listar segmentos',
  description: 'Segmentos de marketing (criterio e quantidade). Sem a lista de contatos do segmento.',
  requiredScope: 'crm:marketing:read',
  inputSchema: z.object({ limit: LimitSchema, cursor: CursorSchema, search: SearchSchema }).strict(),
  outputSchema: listOf(SegmentDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'crm:marketing:read');
    const body = unwrapRead(await ctx.data.read('/api/marketing/segments'), 'Segmentos');
    const rows = ((Array.isArray(body?.data) ? body.data : []) as any[])
      .filter((s) => s && includesText(input.search, s.name, s.description))
      .sort((a, b) => str(a.name).localeCompare(str(b.name)) || str(a.id).localeCompare(str(b.id)));
    const { data, page } = paginate(rows, input.limit, input.cursor);
    return {
      data: data.map((s) => ({
        id: str(s.id),
        name: str(s.name),
        description: str(s.description).slice(0, 2000),
        type: str(s.type),
        filterExpression: str(s.filterExpression).slice(0, 2000),
        count: num(s.count),
        updatedAt: str(s.updatedAt || s.createdAt),
      })),
      page,
    };
  },
});

// ---------------------------------------------------------------------------
// INSIGHTS E SAUDE DA BASE (empresa inteira => carteira TODOS)
// ---------------------------------------------------------------------------
export const crmInsightsGet = defineUseCase({
  ...base,
  operationId: 'analytics.insights.get',
  toolName: 'crm_insights_get',
  path: '/api/v1/analytics/insights',
  pathParams: [],
  summary: 'Insights do funil e da base',
  description: 'Relatorio analitico do funil e da base (agregado, empresa inteira). Exige carteira TODOS.',
  requiredScope: 'crm:analytics:read',
  inputSchema: z.object({ question: z.string().trim().max(500).optional() }).strict(),
  outputSchema: one(z.record(z.string(), z.unknown())),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'crm:analytics:read');
    requireAllPortfolio(ctx, 'Insights da base');
    const body = unwrapRead(await ctx.data.read('/api/ai-insights', {}), 'Insights');
    void input.question; // pergunta livre fica para o cliente MCP (nao repassada ao gerador interno)
    const data = body?.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : {};
    return { data };
  },
});

export const crmDataHealthSummaryGet = defineUseCase({
  ...base,
  operationId: 'data_health.summary.get',
  toolName: 'crm_data_health_summary_get',
  path: '/api/v1/data-health/summary',
  pathParams: [],
  summary: 'Resumo de saude da base',
  description: 'Indicadores de qualidade da base (completude, duplicados, orfaos). Agregado; exige carteira TODOS. Sem limpeza automatica.',
  requiredScope: 'crm:data_health:read',
  inputSchema: z.object({}).strict(),
  outputSchema: one(z.record(z.string(), z.unknown())),
  async handler(_input, ctx) {
    requireOwnerScope(ctx, 'crm:data_health:read');
    requireAllPortfolio(ctx, 'A saude da base');
    const body = unwrapRead(await ctx.data.read('/api/data-health/summary'), 'Saude da base');
    const data = body?.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : {};
    return { data };
  },
});

const DuplicateDto = z.object({
  entityType: z.string(),
  primaryId: z.string(),
  primaryLabel: z.string(),
  duplicateId: z.string(),
  duplicateLabel: z.string(),
  confidenceScore: z.number(),
  matchReasons: z.array(z.string()),
});
const labelOf = (r: any): string =>
  str(r?.name || [r?.firstName, r?.lastName].filter(Boolean).join(' ') || r?.email || r?.id).slice(0, 200);

export const crmDataHealthDuplicatesList = defineUseCase({
  ...base,
  operationId: 'data_health.duplicates.list',
  toolName: 'crm_data_health_duplicates_list',
  path: '/api/v1/data-health/duplicates',
  pathParams: [],
  summary: 'Listar possiveis duplicados',
  description: 'Pares de contatos/empresas possivelmente duplicados (id, nome, motivo, confianca). Somente leitura: sem merge. Exige carteira TODOS.',
  requiredScope: 'crm:data_health:read',
  inputSchema: z.object({ limit: LimitSchema, cursor: CursorSchema, entityType: z.enum(['CONTACT', 'COMPANY']).optional() }).strict(),
  outputSchema: listOf(DuplicateDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'crm:data_health:read');
    requireAllPortfolio(ctx, 'Duplicados');
    const body = unwrapRead(await ctx.data.read('/api/data-health/duplicates'), 'Duplicados');
    const all = [
      ...(Array.isArray(body?.data?.contactDuplicates) ? body.data.contactDuplicates : []),
      ...(Array.isArray(body?.data?.companyDuplicates) ? body.data.companyDuplicates : []),
    ].filter((d: any) => d && (!input.entityType || d.entityType === input.entityType));
    const { data, page } = paginate(all, input.limit, input.cursor);
    return {
      data: data.map((d: any) => ({
        entityType: str(d.entityType),
        primaryId: str(d.primary?.id),
        primaryLabel: labelOf(d.primary),
        duplicateId: str(d.duplicate?.id),
        duplicateLabel: labelOf(d.duplicate),
        confidenceScore: num(d.confidenceScore),
        matchReasons: (Array.isArray(d.matchReasons) ? d.matchReasons : []).slice(0, 20).map((x: unknown) => str(x).slice(0, 200)),
      })),
      page,
    };
  },
});

export const CRM_EXTRA_USE_CASES = [
  crmTasksList,
  crmTasksGet,
  crmSequencesList,
  crmWorkflowsList,
  crmWorkflowsGet,
  crmWorkflowRunsList,
  crmCampaignsList,
  crmFormsList,
  crmSegmentsList,
  crmInsightsGet,
  crmDataHealthSummaryGet,
  crmDataHealthDuplicatesList,
];
