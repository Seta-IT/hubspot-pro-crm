// ============================================================================
// STI-hub — API v1 + MCP: casos de uso do CRM (Contatos, Empresas, Negocios,
// Atividades e leitura de Pipelines). Sem DELETE, sem merge, sem Sequencias.
// ============================================================================
import { z } from 'zod/v4';
import type { Company, Contact, Deal, Pipeline, TimelineEvent } from '../../../db/types';
import type { CrmSnapshot } from '../data-port';
import {
  activityInScope,
  companyInScope,
  contactInScope,
  dealInScope,
  resolveAssignableOwner,
} from '../portfolio';
import { includesText, requireOwnerAccess, sortByUpdatedDesc, sourceMetadata, unwrapWrite, userHasAccess } from './common';
import {
  CursorSchema,
  defineUseCase,
  IdSchema,
  IsoDateSchema,
  LimitSchema,
  notFound,
  PageInfoSchema,
  paginate,
  SearchSchema,
  text,
  UseCaseError,
  type UseCaseContext,
} from './types';

const LIFECYCLE = ['SUBSCRIBER', 'LEAD', 'MQL', 'SQL', 'OPPORTUNITY', 'CUSTOMER', 'EVANGELIST', 'OTHER'] as const;
const LEAD_STATUS = ['NEW', 'OPEN', 'IN_PROGRESS', 'OPEN_DEAL', 'UNQUALIFIED', 'ATTEMPTED_TO_CONTACT', 'CONNECTED', 'BAD_TIMING'] as const;
const DEAL_STATUS = ['OPEN', 'WON', 'LOST'] as const;
const ACTIVITY_TYPES_WRITE = ['NOTE', 'CALL', 'EMAIL', 'MEETING', 'TASK'] as const;

// ---------------------------------------------------------------------------
// DTOs de saida (allowlist explicita de campos)
// ---------------------------------------------------------------------------
export const ContactDto = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  jobTitle: z.string().nullable(),
  lifecycleStage: z.string(),
  leadStatus: z.string(),
  leadScore: z.number(),
  companyId: z.string().nullable(),
  ownerId: z.string().nullable(),
  ownerName: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const toContact = (c: Contact): z.infer<typeof ContactDto> => ({
  id: c.id,
  firstName: c.firstName || '',
  lastName: c.lastName || '',
  email: c.email || '',
  phone: c.phone ?? null,
  jobTitle: c.jobTitle ?? null,
  lifecycleStage: String(c.lifecycleStage || ''),
  leadStatus: String(c.leadStatus || ''),
  leadScore: Number(c.leadScore || 0),
  companyId: c.companyId ?? null,
  ownerId: c.ownerId ?? null,
  ownerName: c.ownerName ?? null,
  lastActivityAt: c.lastActivityAt ?? null,
  createdAt: String(c.createdAt || ''),
  updatedAt: String(c.updatedAt || c.createdAt || ''),
});

export const CompanyDto = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string().nullable(),
  cnpj: z.string().nullable(),
  industry: z.string().nullable(),
  size: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  country: z.string().nullable(),
  ownerName: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const toCompany = (c: Company): z.infer<typeof CompanyDto> => ({
  id: c.id,
  name: c.name || '',
  domain: c.domain ?? null,
  cnpj: c.cnpj ?? null,
  industry: c.industry ?? null,
  size: c.size ?? null,
  city: c.city ?? null,
  state: c.state ?? null,
  country: c.country ?? null,
  ownerName: c.ownerName ?? null,
  lastActivityAt: c.lastActivityAt ?? null,
  createdAt: String(c.createdAt || ''),
  updatedAt: String(c.updatedAt || c.createdAt || ''),
});

export const DealDto = z.object({
  id: z.string(),
  title: z.string(),
  value: z.number(),
  currency: z.string(),
  pipelineId: z.string(),
  stageId: z.string(),
  stageName: z.string().nullable(),
  status: z.string(),
  probability: z.number(),
  expectedCloseDate: z.string().nullable(),
  contactId: z.string().nullable(),
  companyId: z.string().nullable(),
  ownerId: z.string().nullable(),
  ownerName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const toDeal = (d: Deal, pipelines: Pipeline[]): z.infer<typeof DealDto> => {
  const stage = pipelines.flatMap((p) => p.stages).find((s) => s.id === d.stageId);
  return {
    id: d.id,
    title: d.title || '',
    value: Number(d.value || 0),
    currency: d.currency || 'BRL',
    pipelineId: d.pipelineId,
    stageId: d.stageId,
    stageName: stage?.name ?? null,
    status: String(d.status || 'OPEN'),
    probability: Number(d.probability || 0),
    expectedCloseDate: d.expectedCloseDate ?? null,
    contactId: d.contactId ?? null,
    companyId: d.companyId ?? null,
    ownerId: d.ownerId ?? null,
    ownerName: d.ownerName ?? null,
    createdAt: String(d.createdAt || ''),
    updatedAt: String(d.updatedAt || d.createdAt || ''),
  };
};

export const ActivityDto = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  contactId: z.string().nullable(),
  companyId: z.string().nullable(),
  dealId: z.string().nullable(),
  actor: z.string(),
  createdAt: z.string(),
});
const toActivity = (e: TimelineEvent): z.infer<typeof ActivityDto> => ({
  id: e.id,
  type: String(e.type),
  title: e.title || '',
  body: e.body ?? null,
  contactId: e.contactId ?? null,
  companyId: e.companyId ?? null,
  dealId: e.dealId ?? null,
  actor: String(e.actor || ''),
  createdAt: String(e.createdAt || ''),
});

export const PipelineDto = z.object({
  id: z.string(),
  name: z.string(),
  isDefault: z.boolean(),
  currency: z.string(),
  stages: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      order: z.number(),
      defaultProbability: z.number(),
      isClosed: z.boolean(),
      isWon: z.boolean(),
    })
  ),
});

const listOf = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item), page: PageInfoSchema });
const one = <T extends z.ZodType>(item: T) => z.object({ data: item });

// ---------------------------------------------------------------------------
// Helpers de carteira / integridade
// ---------------------------------------------------------------------------
async function crm(ctx: UseCaseContext): Promise<CrmSnapshot> {
  return ctx.data.snapshot('crm');
}

function findContact(snap: CrmSnapshot, ctx: UseCaseContext, id: string): Contact {
  const c = snap.contacts.find((x) => x.id === id);
  if (!c || !contactInScope(ctx.portfolio, c)) throw notFound('Contato');
  return c;
}
function findCompany(snap: CrmSnapshot, ctx: UseCaseContext, id: string): Company {
  const c = snap.companies.find((x) => x.id === id);
  if (!c || !companyInScope(ctx.portfolio, c)) throw notFound('Empresa');
  return c;
}
function findDeal(snap: CrmSnapshot, ctx: UseCaseContext, id: string): Deal {
  const d = snap.deals.find((x) => x.id === id);
  if (!d || !dealInScope(ctx.portfolio, d)) throw notFound('Negocio');
  return d;
}

/**
 * Vinculo (empresa/contato) ciente de carteira: inexistente OU fora da carteira => o MESMO 404
 * neutro (sem oraculo de existencia e sem vincular registro de outra carteira).
 */
function assertLinkInScope(snap: CrmSnapshot, ctx: UseCaseContext, kind: 'contact' | 'company', id: string | null | undefined): void {
  if (!id) return;
  if (kind === 'contact') findContact(snap, ctx, id);
  else findCompany(snap, ctx, id);
}

function ownerFields(ctx: UseCaseContext, requested: string | undefined) {
  const u = resolveAssignableOwner(ctx.portfolio, ctx.allUsers, requested, ctx.auth.actorUserId);
  if (!u) {
    throw new UseCaseError(403, 'OWNER_OUT_OF_PORTFOLIO', 'Responsavel fora da carteira permitida para esta credencial.', { fields: ['ownerId'] });
  }
  return u;
}

// ---------------------------------------------------------------------------
// CONTATOS
// ---------------------------------------------------------------------------
const ContactWritable = {
  firstName: text(120).min(1),
  lastName: text(120),
  email: z.email().max(200),
  phone: text(40),
  jobTitle: text(160),
  lifecycleStage: z.enum(LIFECYCLE),
  leadStatus: z.enum(LEAD_STATUS),
  companyId: IdSchema.nullable(),
  ownerId: IdSchema,
};

export const contactsList = defineUseCase({
  operationId: 'contacts.list',
  toolName: 'crm_contacts_list',
  method: 'GET',
  path: '/api/v1/contacts',
  pathParams: [],
  tag: 'CRM',
  summary: 'Listar contatos',
  description: 'Lista contatos da carteira da credencial (PROPRIOS/EQUIPE/TODOS), com busca e paginacao por cursor (limit max 100).',
  requiredScope: 'crm:contacts:read',
  requiredModule: 'crm',
  domain: 'crm',
  idempotent: true,
  mutation: false,
  successStatus: 200,
  inputSchema: z
    .object({
      limit: LimitSchema,
      cursor: CursorSchema,
      search: SearchSchema,
      companyId: IdSchema.optional(),
      lifecycleStage: z.enum(LIFECYCLE).optional(),
    })
    .strict(),
  outputSchema: listOf(ContactDto),
  async handler(input, ctx) {
    requireOwnerAccess(ctx, 'contacts', 'VIEW');
    const snap = await crm(ctx);
    const rows = sortByUpdatedDesc(
      snap.contacts.filter(
        (c) =>
          contactInScope(ctx.portfolio, c) &&
          (!input.companyId || c.companyId === input.companyId) &&
          (!input.lifecycleStage || c.lifecycleStage === input.lifecycleStage) &&
          includesText(input.search, c.firstName, c.lastName, `${c.firstName} ${c.lastName}`, c.email, c.phone, c.jobTitle)
      )
    );
    const { data, page } = paginate(rows, input.limit, input.cursor);
    return { data: data.map(toContact), page };
  },
});

export const contactsGet = defineUseCase({
  operationId: 'contacts.get',
  toolName: 'crm_contacts_get',
  method: 'GET',
  path: '/api/v1/contacts/{id}',
  pathParams: ['id'],
  tag: 'CRM',
  summary: 'Obter contato',
  description: 'Detalhe de um contato da carteira (fora da carteira responde 404).',
  requiredScope: 'crm:contacts:read',
  requiredModule: 'crm',
  domain: 'crm',
  idempotent: true,
  mutation: false,
  successStatus: 200,
  inputSchema: z.object({ id: IdSchema }).strict(),
  outputSchema: one(ContactDto),
  async handler(input, ctx) {
    requireOwnerAccess(ctx, 'contacts', 'VIEW');
    const snap = await crm(ctx);
    return { data: toContact(findContact(snap, ctx, input.id)) };
  },
});

export const contactsCreate = defineUseCase({
  operationId: 'contacts.create',
  toolName: 'crm_contacts_create',
  method: 'POST',
  path: '/api/v1/contacts',
  pathParams: [],
  tag: 'CRM',
  summary: 'Criar contato',
  description: 'Cria um contato. O responsavel padrao e o dono da credencial; outro responsavel so dentro da carteira. Aceita Idempotency-Key.',
  requiredScope: 'crm:contacts:write',
  requiredModule: 'crm',
  domain: 'crm',
  idempotent: false,
  mutation: true,
  successStatus: 201,
  inputSchema: z
    .object({
      firstName: ContactWritable.firstName,
      lastName: ContactWritable.lastName.optional(),
      email: ContactWritable.email.optional(),
      phone: ContactWritable.phone.optional(),
      jobTitle: ContactWritable.jobTitle.optional(),
      lifecycleStage: ContactWritable.lifecycleStage.optional(),
      leadStatus: ContactWritable.leadStatus.optional(),
      companyId: ContactWritable.companyId.optional(),
      ownerId: ContactWritable.ownerId.optional(),
    })
    .strict(),
  outputSchema: one(ContactDto),
  async handler(input, ctx) {
    requireOwnerAccess(ctx, 'contacts', 'EDIT');
    const snap = await crm(ctx);
    assertLinkInScope(snap, ctx, 'company', input.companyId);
    const owner = ownerFields(ctx, input.ownerId);
    const res = await ctx.data.write('POST', '/api/contacts', {
      ...input,
      ownerId: owner.id,
      ownerName: owner.name,
      ...(owner.hubspotOwnerId ? { hubspotOwnerId: owner.hubspotOwnerId } : {}),
      customProperties: { createdVia: sourceMetadata(ctx).source },
    });
    return { data: toContact(unwrapWrite(res, 'contato')) };
  },
});

export const contactsUpdate = defineUseCase({
  operationId: 'contacts.update',
  toolName: 'crm_contacts_update',
  method: 'PATCH',
  path: '/api/v1/contacts/{id}',
  pathParams: ['id'],
  tag: 'CRM',
  summary: 'Atualizar contato',
  description: 'Atualiza campos permitidos de um contato da carteira (PATCH strict: campos fora da lista => 400).',
  requiredScope: 'crm:contacts:write',
  requiredModule: 'crm',
  domain: 'crm',
  idempotent: true,
  mutation: true,
  successStatus: 200,
  inputSchema: z
    .object({
      id: IdSchema,
      firstName: ContactWritable.firstName.optional(),
      lastName: ContactWritable.lastName.optional(),
      email: ContactWritable.email.optional(),
      phone: ContactWritable.phone.nullable().optional(),
      jobTitle: ContactWritable.jobTitle.nullable().optional(),
      lifecycleStage: ContactWritable.lifecycleStage.optional(),
      leadStatus: ContactWritable.leadStatus.optional(),
      companyId: ContactWritable.companyId.optional(),
      ownerId: ContactWritable.ownerId.optional(),
    })
    .strict(),
  outputSchema: one(ContactDto),
  async handler(input, ctx) {
    requireOwnerAccess(ctx, 'contacts', 'EDIT');
    const snap = await crm(ctx);
    findContact(snap, ctx, input.id);
    const { id, ownerId, ...patch } = input;
    assertLinkInScope(snap, ctx, 'company', patch.companyId);
    const body: Record<string, unknown> = { ...patch };
    if (ownerId !== undefined) {
      const owner = ownerFields(ctx, ownerId);
      Object.assign(body, { ownerId: owner.id, ownerName: owner.name, ...(owner.hubspotOwnerId ? { hubspotOwnerId: owner.hubspotOwnerId } : {}) });
    }
    if (Object.keys(body).length === 0) throw new UseCaseError(422, 'EMPTY_PATCH', 'Nenhum campo para atualizar.');
    const res = await ctx.data.write('PATCH', `/api/contacts/${id}`, body);
    return { data: toContact(unwrapWrite(res, 'contato')) };
  },
});

// ---------------------------------------------------------------------------
// EMPRESAS
// ---------------------------------------------------------------------------
const CompanyWritable = {
  name: text(200).min(1),
  domain: text(200),
  cnpj: z.string().trim().regex(/^[0-9./-]{11,18}$/, 'CNPJ/CPF invalido'),
  industry: text(120),
  size: text(60),
  city: text(120),
  state: text(60),
  country: text(60),
  ownerId: IdSchema,
};

export const companiesList = defineUseCase({
  operationId: 'companies.list',
  toolName: 'crm_companies_list',
  method: 'GET',
  path: '/api/v1/companies',
  pathParams: [],
  tag: 'CRM',
  summary: 'Listar empresas',
  description: 'Lista empresas da carteira com busca (nome, dominio, CNPJ) e paginacao por cursor.',
  requiredScope: 'crm:companies:read',
  requiredModule: 'crm',
  domain: 'crm',
  idempotent: true,
  mutation: false,
  successStatus: 200,
  inputSchema: z.object({ limit: LimitSchema, cursor: CursorSchema, search: SearchSchema, industry: text(120).optional() }).strict(),
  outputSchema: listOf(CompanyDto),
  async handler(input, ctx) {
    requireOwnerAccess(ctx, 'companies', 'VIEW');
    const snap = await crm(ctx);
    const digits = String(input.search || '').replace(/\D/g, '');
    const rows = sortByUpdatedDesc(
      snap.companies.filter(
        (c) =>
          companyInScope(ctx.portfolio, c) &&
          (!input.industry || c.industry === input.industry) &&
          (includesText(input.search, c.name, c.domain) ||
            (digits.length >= 8 && String(c.cnpj || '').replace(/\D/g, '').includes(digits)))
      )
    );
    const { data, page } = paginate(rows, input.limit, input.cursor);
    return { data: data.map(toCompany), page };
  },
});

export const companiesGet = defineUseCase({
  operationId: 'companies.get',
  toolName: 'crm_companies_get',
  method: 'GET',
  path: '/api/v1/companies/{id}',
  pathParams: ['id'],
  tag: 'CRM',
  summary: 'Obter empresa',
  description: 'Detalhe de uma empresa da carteira.',
  requiredScope: 'crm:companies:read',
  requiredModule: 'crm',
  domain: 'crm',
  idempotent: true,
  mutation: false,
  successStatus: 200,
  inputSchema: z.object({ id: IdSchema }).strict(),
  outputSchema: one(CompanyDto),
  async handler(input, ctx) {
    requireOwnerAccess(ctx, 'companies', 'VIEW');
    const snap = await crm(ctx);
    return { data: toCompany(findCompany(snap, ctx, input.id)) };
  },
});

export const companiesCreate = defineUseCase({
  operationId: 'companies.create',
  toolName: 'crm_companies_create',
  method: 'POST',
  path: '/api/v1/companies',
  pathParams: [],
  tag: 'CRM',
  summary: 'Criar empresa',
  description: 'Cria uma empresa com responsavel dentro da carteira. CNPJ/CPF validado pelo servidor. Aceita Idempotency-Key.',
  requiredScope: 'crm:companies:write',
  requiredModule: 'crm',
  domain: 'crm',
  idempotent: false,
  mutation: true,
  successStatus: 201,
  inputSchema: z
    .object({
      name: CompanyWritable.name,
      domain: CompanyWritable.domain.optional(),
      cnpj: CompanyWritable.cnpj.optional(),
      industry: CompanyWritable.industry.optional(),
      size: CompanyWritable.size.optional(),
      city: CompanyWritable.city.optional(),
      state: CompanyWritable.state.optional(),
      country: CompanyWritable.country.optional(),
      ownerId: CompanyWritable.ownerId.optional(),
    })
    .strict(),
  outputSchema: one(CompanyDto),
  async handler(input, ctx) {
    requireOwnerAccess(ctx, 'companies', 'EDIT');
    await crm(ctx);
    const { ownerId, ...fields } = input;
    const owner = ownerFields(ctx, ownerId);
    const res = await ctx.data.write('POST', '/api/companies', {
      ...fields,
      ownerName: owner.name,
      ...(owner.hubspotOwnerId ? { hubspotOwnerId: owner.hubspotOwnerId } : {}),
    });
    return { data: toCompany(unwrapWrite(res, 'empresa')) };
  },
});

export const companiesUpdate = defineUseCase({
  operationId: 'companies.update',
  toolName: 'crm_companies_update',
  method: 'PATCH',
  path: '/api/v1/companies/{id}',
  pathParams: ['id'],
  tag: 'CRM',
  summary: 'Atualizar empresa',
  description: 'Atualiza campos permitidos de uma empresa da carteira (PATCH strict).',
  requiredScope: 'crm:companies:write',
  requiredModule: 'crm',
  domain: 'crm',
  idempotent: true,
  mutation: true,
  successStatus: 200,
  inputSchema: z
    .object({
      id: IdSchema,
      name: CompanyWritable.name.optional(),
      domain: CompanyWritable.domain.nullable().optional(),
      cnpj: CompanyWritable.cnpj.optional(),
      industry: CompanyWritable.industry.nullable().optional(),
      size: CompanyWritable.size.nullable().optional(),
      city: CompanyWritable.city.nullable().optional(),
      state: CompanyWritable.state.nullable().optional(),
      country: CompanyWritable.country.nullable().optional(),
      ownerId: CompanyWritable.ownerId.optional(),
    })
    .strict(),
  outputSchema: one(CompanyDto),
  async handler(input, ctx) {
    requireOwnerAccess(ctx, 'companies', 'EDIT');
    const snap = await crm(ctx);
    findCompany(snap, ctx, input.id);
    const { id, ownerId, ...patch } = input;
    const body: Record<string, unknown> = { ...patch };
    if (ownerId !== undefined) {
      const owner = ownerFields(ctx, ownerId);
      Object.assign(body, { ownerName: owner.name, ...(owner.hubspotOwnerId ? { hubspotOwnerId: owner.hubspotOwnerId } : {}) });
    }
    if (Object.keys(body).length === 0) throw new UseCaseError(422, 'EMPTY_PATCH', 'Nenhum campo para atualizar.');
    const res = await ctx.data.write('PATCH', `/api/companies/${id}`, body);
    return { data: toCompany(unwrapWrite(res, 'empresa')) };
  },
});

// ---------------------------------------------------------------------------
// NEGOCIOS
// ---------------------------------------------------------------------------
function resolvePipelineStage(snap: CrmSnapshot, pipelineId: string | undefined, stageId: string | undefined, current?: Deal) {
  const pipeline = pipelineId
    ? snap.pipelines.find((p) => p.id === pipelineId)
    : current
      ? snap.pipelines.find((p) => p.id === current.pipelineId)
      : snap.pipelines.find((p) => p.isDefault) || snap.pipelines[0];
  if (!pipeline) throw new UseCaseError(422, 'PIPELINE_NOT_FOUND', 'Pipeline inexistente.', { fields: ['pipelineId'] });
  const stages = [...pipeline.stages].sort((a, b) => a.order - b.order);
  if (stageId) {
    const st = stages.find((s) => s.id === stageId);
    if (!st) throw new UseCaseError(422, 'STAGE_NOT_IN_PIPELINE', 'A etapa informada nao pertence ao pipeline do negocio.', { fields: ['stageId'] });
    return { pipeline, stage: st };
  }
  if (current && current.pipelineId === pipeline.id) {
    return { pipeline, stage: stages.find((s) => s.id === current.stageId) || stages[0] };
  }
  if (current && pipelineId && pipelineId !== current.pipelineId) {
    throw new UseCaseError(422, 'STAGE_REQUIRED', 'Ao trocar de pipeline informe tambem a etapa (stageId).', { fields: ['stageId'] });
  }
  const first = stages[0];
  if (!first) throw new UseCaseError(422, 'PIPELINE_WITHOUT_STAGES', 'Pipeline sem etapas.');
  return { pipeline, stage: first };
}

export const dealsList = defineUseCase({
  operationId: 'deals.list',
  toolName: 'crm_deals_list',
  method: 'GET',
  path: '/api/v1/deals',
  pathParams: [],
  tag: 'CRM',
  summary: 'Listar negocios',
  description: 'Lista negocios da carteira com filtros (pipeline, etapa, status, empresa, contato), busca e paginacao.',
  requiredScope: 'crm:deals:read',
  requiredModule: 'crm',
  domain: 'crm',
  idempotent: true,
  mutation: false,
  successStatus: 200,
  inputSchema: z
    .object({
      limit: LimitSchema,
      cursor: CursorSchema,
      search: SearchSchema,
      pipelineId: IdSchema.optional(),
      stageId: IdSchema.optional(),
      status: z.enum(DEAL_STATUS).optional(),
      companyId: IdSchema.optional(),
      contactId: IdSchema.optional(),
    })
    .strict(),
  outputSchema: listOf(DealDto),
  async handler(input, ctx) {
    requireOwnerAccess(ctx, 'deals', 'VIEW');
    const snap = await crm(ctx);
    const rows = sortByUpdatedDesc(
      snap.deals.filter(
        (d) =>
          dealInScope(ctx.portfolio, d) &&
          (!input.pipelineId || d.pipelineId === input.pipelineId) &&
          (!input.stageId || d.stageId === input.stageId) &&
          (!input.status || d.status === input.status) &&
          (!input.companyId || d.companyId === input.companyId) &&
          (!input.contactId || d.contactId === input.contactId) &&
          includesText(input.search, d.title)
      )
    );
    const { data, page } = paginate(rows, input.limit, input.cursor);
    return { data: data.map((d) => toDeal(d, snap.pipelines)), page };
  },
});

export const dealsGet = defineUseCase({
  operationId: 'deals.get',
  toolName: 'crm_deals_get',
  method: 'GET',
  path: '/api/v1/deals/{id}',
  pathParams: ['id'],
  tag: 'CRM',
  summary: 'Obter negocio',
  description: 'Detalhe de um negocio da carteira.',
  requiredScope: 'crm:deals:read',
  requiredModule: 'crm',
  domain: 'crm',
  idempotent: true,
  mutation: false,
  successStatus: 200,
  inputSchema: z.object({ id: IdSchema }).strict(),
  outputSchema: one(DealDto),
  async handler(input, ctx) {
    requireOwnerAccess(ctx, 'deals', 'VIEW');
    const snap = await crm(ctx);
    return { data: toDeal(findDeal(snap, ctx, input.id), snap.pipelines) };
  },
});

export const dealsCreate = defineUseCase({
  operationId: 'deals.create',
  toolName: 'crm_deals_create',
  method: 'POST',
  path: '/api/v1/deals',
  pathParams: [],
  tag: 'CRM',
  summary: 'Criar negocio',
  description: 'Cria um negocio validando pipeline/etapa e vinculos. Responsavel dentro da carteira. Aceita Idempotency-Key.',
  requiredScope: 'crm:deals:write',
  requiredModule: 'crm',
  domain: 'crm',
  idempotent: false,
  mutation: true,
  successStatus: 201,
  inputSchema: z
    .object({
      title: text(200).min(1),
      value: z.number().min(0).max(1e12),
      currency: z.enum(['BRL', 'USD', 'EUR']).optional(),
      pipelineId: IdSchema.optional(),
      stageId: IdSchema.optional(),
      contactId: IdSchema.optional(),
      companyId: IdSchema.optional(),
      expectedCloseDate: IsoDateSchema.optional(),
      ownerId: IdSchema.optional(),
    })
    .strict(),
  outputSchema: one(DealDto),
  async handler(input, ctx) {
    requireOwnerAccess(ctx, 'deals', 'EDIT');
    const snap = await crm(ctx);
    assertLinkInScope(snap, ctx, 'contact', input.contactId);
    assertLinkInScope(snap, ctx, 'company', input.companyId);
    const { pipeline, stage } = resolvePipelineStage(snap, input.pipelineId, input.stageId);
    if (stage.isClosed) {
      throw new UseCaseError(422, 'STAGE_CLOSED_ON_CREATE', 'Negocio novo nao pode nascer em etapa fechada (ganho/perdido).', { fields: ['stageId'] });
    }
    const owner = ownerFields(ctx, input.ownerId);
    const res = await ctx.data.write('POST', '/api/deals', {
      title: input.title,
      value: input.value,
      currency: input.currency || pipeline.currency || 'BRL',
      pipelineId: pipeline.id,
      stageId: stage.id,
      probability: stage.defaultProbability,
      contactId: input.contactId ?? null,
      companyId: input.companyId ?? null,
      expectedCloseDate: input.expectedCloseDate ?? null,
      ownerId: owner.id,
      ownerName: owner.name,
    });
    return { data: toDeal(unwrapWrite(res, 'negocio'), snap.pipelines) };
  },
});

export const dealsUpdate = defineUseCase({
  operationId: 'deals.update',
  toolName: 'crm_deals_update',
  method: 'PATCH',
  path: '/api/v1/deals/{id}',
  pathParams: ['id'],
  tag: 'CRM',
  summary: 'Atualizar negocio / mudar etapa',
  description:
    'Atualiza campos permitidos e muda de etapa validando que a etapa pertence ao pipeline. Negocio vinculado a proposta do ERP nao aceita mudanca de titulo/valor (409).',
  requiredScope: 'crm:deals:write',
  requiredModule: 'crm',
  domain: 'crm',
  idempotent: true,
  mutation: true,
  successStatus: 200,
  inputSchema: z
    .object({
      id: IdSchema,
      title: text(200).min(1).optional(),
      value: z.number().min(0).max(1e12).optional(),
      pipelineId: IdSchema.optional(),
      stageId: IdSchema.optional(),
      expectedCloseDate: IsoDateSchema.nullable().optional(),
      contactId: IdSchema.nullable().optional(),
      companyId: IdSchema.nullable().optional(),
      lostReason: text(500).nullable().optional(),
      ownerId: IdSchema.optional(),
    })
    .strict(),
  outputSchema: one(DealDto),
  async handler(input, ctx) {
    requireOwnerAccess(ctx, 'deals', 'EDIT');
    const snap = await crm(ctx);
    const current = findDeal(snap, ctx, input.id);
    const { id, ownerId, pipelineId, stageId, ...rest } = input;
    if (current.proposalId && (rest.title !== undefined || rest.value !== undefined)) {
      throw new UseCaseError(409, 'DEAL_LOCKED_BY_PROPOSAL', 'Negocio vinculado a proposta do ERP: titulo e valor sao definidos pela proposta.');
    }
    assertLinkInScope(snap, ctx, 'contact', rest.contactId);
    assertLinkInScope(snap, ctx, 'company', rest.companyId);
    const body: Record<string, unknown> = { ...rest };
    if (pipelineId !== undefined || stageId !== undefined) {
      const { pipeline, stage } = resolvePipelineStage(snap, pipelineId, stageId, current);
      body.pipelineId = pipeline.id;
      body.stageId = stage.id;
    }
    if (ownerId !== undefined) {
      const owner = ownerFields(ctx, ownerId);
      Object.assign(body, { ownerId: owner.id, ownerName: owner.name });
    }
    if (Object.keys(body).length === 0) throw new UseCaseError(422, 'EMPTY_PATCH', 'Nenhum campo para atualizar.');
    const res = await ctx.data.write('PATCH', `/api/deals/${id}`, body);
    return { data: toDeal(unwrapWrite(res, 'negocio'), snap.pipelines) };
  },
});

// ---------------------------------------------------------------------------
// ATIVIDADES (notas / timeline)
// ---------------------------------------------------------------------------
export const activitiesList = defineUseCase({
  operationId: 'activities.list',
  toolName: 'crm_activities_list',
  method: 'GET',
  path: '/api/v1/activities',
  pathParams: [],
  tag: 'CRM',
  summary: 'Listar atividades',
  description: 'Notas e atividades da linha do tempo ligadas a contato/empresa/negocio da carteira.',
  requiredScope: 'crm:activities:read',
  requiredModule: 'crm',
  domain: 'crm',
  idempotent: true,
  mutation: false,
  successStatus: 200,
  inputSchema: z
    .object({
      limit: LimitSchema,
      cursor: CursorSchema,
      contactId: IdSchema.optional(),
      companyId: IdSchema.optional(),
      dealId: IdSchema.optional(),
      type: z.enum(['NOTE', 'EMAIL', 'CALL', 'TASK', 'MEETING', 'STAGE_CHANGE', 'TICKET_EVENT']).optional(),
    })
    .strict(),
  outputSchema: listOf(ActivityDto),
  async handler(input, ctx) {
    // Alcada granular por tipo de vinculo: so enxerga atividade ligada a area que o dono pode ver.
    const canSee = {
      contacts: userHasAccess(ctx.owner, 'contacts', 'VIEW'),
      companies: userHasAccess(ctx.owner, 'companies', 'VIEW'),
      deals: userHasAccess(ctx.owner, 'deals', 'VIEW'),
    };
    if (!canSee.contacts && !canSee.companies && !canSee.deals) requireOwnerAccess(ctx, 'contacts', 'VIEW');
    const snap = await crm(ctx);
    // Filtro por entidade: exige alcada + carteira daquela entidade (404 neutro fora da carteira).
    if (input.contactId) {
      requireOwnerAccess(ctx, 'contacts', 'VIEW');
      findContact(snap, ctx, input.contactId);
    }
    if (input.companyId) {
      requireOwnerAccess(ctx, 'companies', 'VIEW');
      findCompany(snap, ctx, input.companyId);
    }
    if (input.dealId) {
      requireOwnerAccess(ctx, 'deals', 'VIEW');
      findDeal(snap, ctx, input.dealId);
    }
    const contacts = new Map(snap.contacts.map((c) => [c.id, c]));
    const companies = new Map(snap.companies.map((c) => [c.id, c]));
    const deals = new Map(snap.deals.map((d) => [d.id, d]));
    const lookup = {
      contact: (i: string) => (canSee.contacts ? contacts.get(i) : undefined),
      company: (i: string) => (canSee.companies ? companies.get(i) : undefined),
      deal: (i: string) => (canSee.deals ? deals.get(i) : undefined),
    };
    const visibleByAccess = (e: { contactId?: string | null; companyId?: string | null; dealId?: string | null }) =>
      (!!e.contactId && canSee.contacts) || (!!e.companyId && canSee.companies) || (!!e.dealId && canSee.deals);
    const rows = [...snap.timeline]
      .filter(
        (e) =>
          visibleByAccess(e) &&
          activityInScope(ctx.portfolio, e, lookup) &&
          (!input.contactId || e.contactId === input.contactId) &&
          (!input.companyId || e.companyId === input.companyId) &&
          (!input.dealId || e.dealId === input.dealId) &&
          (!input.type || e.type === input.type)
      )
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || a.id.localeCompare(b.id));
    const { data, page } = paginate(rows, input.limit, input.cursor);
    return { data: data.map(toActivity), page };
  },
});

export const activitiesCreate = defineUseCase({
  operationId: 'activities.create',
  toolName: 'crm_activities_create',
  method: 'POST',
  path: '/api/v1/activities',
  pathParams: [],
  tag: 'CRM',
  summary: 'Registrar atividade/nota',
  description: 'Registra nota/atividade ligada a pelo menos um contato, empresa ou negocio da carteira. Autor = credencial. Aceita Idempotency-Key.',
  requiredScope: 'crm:activities:write',
  requiredModule: 'crm',
  domain: 'crm',
  idempotent: false,
  mutation: true,
  successStatus: 201,
  inputSchema: z
    .object({
      type: z.enum(ACTIVITY_TYPES_WRITE),
      title: text(300).min(1),
      body: text(10000).optional(),
      contactId: IdSchema.optional(),
      companyId: IdSchema.optional(),
      dealId: IdSchema.optional(),
    })
    .strict(),
  outputSchema: one(ActivityDto),
  async handler(input, ctx) {
    if (!input.contactId && !input.companyId && !input.dealId) {
      throw new UseCaseError(422, 'ACTIVITY_LINK_REQUIRED', 'Informe contactId, companyId ou dealId.', { fields: ['contactId', 'companyId', 'dealId'] });
    }
    // Alcada de escrita por tipo de vinculo + vinculo dentro da carteira (404 neutro).
    if (input.contactId) requireOwnerAccess(ctx, 'contacts', 'EDIT');
    if (input.companyId) requireOwnerAccess(ctx, 'companies', 'EDIT');
    if (input.dealId) requireOwnerAccess(ctx, 'deals', 'EDIT');
    const snap = await crm(ctx);
    if (input.contactId) findContact(snap, ctx, input.contactId);
    if (input.companyId) findCompany(snap, ctx, input.companyId);
    if (input.dealId) findDeal(snap, ctx, input.dealId);
    const res = await ctx.data.write('POST', '/api/timeline', {
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      contactId: input.contactId ?? null,
      companyId: input.companyId ?? null,
      dealId: input.dealId ?? null,
      actor: ctx.auth.actorLabel,
      metadata: sourceMetadata(ctx),
    });
    return { data: toActivity(unwrapWrite(res, 'atividade')) };
  },
});

// ---------------------------------------------------------------------------
// PIPELINES (somente leitura)
// ---------------------------------------------------------------------------
export const pipelinesList = defineUseCase({
  operationId: 'pipelines.list',
  toolName: 'crm_pipelines_list',
  method: 'GET',
  path: '/api/v1/pipelines',
  pathParams: [],
  tag: 'CRM',
  summary: 'Listar pipelines e etapas',
  description: 'Pipelines de vendas e suas etapas (somente leitura).',
  requiredScope: 'crm:pipelines:read',
  requiredModule: 'crm',
  domain: 'crm',
  idempotent: true,
  mutation: false,
  successStatus: 200,
  inputSchema: z.object({}).strict(),
  outputSchema: z.object({ data: z.array(PipelineDto) }),
  async handler(_input, ctx) {
    // Pipelines = estrutura do funil de negocios: exige alcada de leitura em negocios.
    requireOwnerAccess(ctx, 'deals', 'VIEW');
    const snap = await crm(ctx);
    return {
      data: snap.pipelines.map((p) => ({
        id: p.id,
        name: p.name,
        isDefault: Boolean(p.isDefault),
        currency: p.currency || 'BRL',
        stages: [...p.stages]
          .sort((a, b) => a.order - b.order)
          .map((s) => ({
            id: s.id,
            name: s.name,
            order: s.order,
            defaultProbability: Number(s.defaultProbability || 0),
            isClosed: Boolean(s.isClosed),
            isWon: Boolean(s.isWon),
          })),
      })),
    };
  },
});

export const CRM_USE_CASES = [
  contactsList,
  contactsGet,
  contactsCreate,
  contactsUpdate,
  companiesList,
  companiesGet,
  companiesCreate,
  companiesUpdate,
  dealsList,
  dealsGet,
  dealsCreate,
  dealsUpdate,
  activitiesList,
  activitiesCreate,
  pipelinesList,
];
