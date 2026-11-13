// ============================================================================
// STI-hub — API v1 + MCP: casos de uso de Chamados (SetaDesk).
// Travas CISO: maskTicketForResponse em TODA saida; busca no servidor com
// ticketMatchesSearchServer (CNPJ/conta so por igualdade completa); PATCH strict com
// recusa de valor mascarado; comentario interno exige escopo proprio; filas/prefixos
// (TEC-/FIN-) validados; sem anexos/Blob; sem DELETE.
// ============================================================================
import { z } from 'zod/v4';
import type { Company, Contact, ServiceTicket, SetaDeskPipeline } from '../../../db/types';
import { maskTicketForResponse, ticketMatchesSearchServer } from '../../../app/lib/setadesk-ticket-search';
import { hasScope } from '../auth-context';
import type { TicketSnapshot } from '../data-port';
import { companyInScope, contactInScope, ticketInScope } from '../portfolio';
import { requireOwnerAccess, unwrapWrite } from './common';
import {
  CursorSchema,
  defineUseCase,
  LimitSchema,
  notFound,
  PageInfoSchema,
  paginate,
  SearchSchema,
  text,
  IdSchema,
  UseCaseError,
  type UseCaseContext,
} from './types';

const STATUS = ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'] as const;
const PRIORITY = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
const CATEGORY = ['INCIDENT', 'SUPPORT', 'BILLING', 'BUG', 'FEATURE_REQUEST'] as const;
const CHANNEL = ['WEB_PORTAL', 'EMAIL', 'WHATSAPP', 'PHONE', 'CHAT'] as const;

export const QueuePrefixSchema = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{0,7}$/, 'prefixo de fila invalido');
/** id interno (tkt-...) ou chave PREFIXO-n (TEC-123 / FIN-45). */
export const TicketRefSchema = z.string().trim().regex(/^(?:[A-Za-z0-9._-]{1,80})$/, 'id/chave de chamado invalido');

// Artefatos de mascara (3+ asteriscos: CNPJ e conta mascarados) sao recusados em qualquer texto gravado pela API.
export function containsMaskArtifact(value: unknown): boolean {
  return typeof value === 'string' && /\*{3,}/.test(value);
}

const CommentDto = z.object({
  id: z.string(),
  author: z.string(),
  authorRole: z.string(),
  isInternal: z.boolean(),
  body: z.string(),
  createdAt: z.string(),
});

export const TicketDto = z.object({
  id: z.string(),
  key: z.string(),
  queue: z.string().nullable(),
  pipelineId: z.string().nullable(),
  subject: z.string(),
  description: z.string(),
  category: z.string(),
  priority: z.string(),
  status: z.string(),
  channel: z.string(),
  assignee: z.string(),
  contactId: z.string().nullable(),
  companyId: z.string().nullable(),
  dealId: z.string().nullable(),
  company: z.object({ id: z.string(), name: z.string(), cnpj: z.string().nullable() }).nullable(),
  slaStatus: z.string(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  resolvedAt: z.string().nullable(),
  comments: z.array(CommentDto).optional(),
});
type TicketOut = z.infer<typeof TicketDto>;

export const QueueDto = z.object({ id: z.string(), name: z.string(), prefix: z.string(), isActive: z.boolean() });

const canSeeInternal = (ctx: UseCaseContext) =>
  hasScope(ctx.auth, 'tickets:internal_notes:read') || hasScope(ctx.auth, 'tickets:internal_notes:write');

function visibleComments(ctx: UseCaseContext, t: ServiceTicket) {
  const all = Array.isArray(t.comments) ? t.comments : [];
  return canSeeInternal(ctx) ? all : all.filter((c) => !c.isInternal);
}

const queueOfKey = (key: string) => (/^([A-Z][A-Z0-9]{0,7})-\d+$/i.exec(String(key || ''))?.[1] || '').toUpperCase() || null;

/** DTO + maskTicketForResponse (assunto, descricao, comentarios e CNPJ da empresa). */
function toTicket(ctx: UseCaseContext, t: ServiceTicket, company: Company | undefined, withComments: boolean): TicketOut {
  const dto: TicketOut = {
    id: t.id,
    key: t.key,
    queue: queueOfKey(t.key),
    pipelineId: t.pipelineId ?? null,
    subject: String(t.subject || ''),
    description: String(t.description || ''),
    category: String(t.category || ''),
    priority: String(t.priority || ''),
    status: String(t.status || ''),
    channel: String(t.channel || ''),
    assignee: String(t.assigneeAgent || t.assignee || ''),
    contactId: t.contactId ?? null,
    companyId: t.companyId ?? null,
    dealId: t.dealId ?? null,
    company: company ? { id: company.id, name: company.name || '', cnpj: company.cnpj ?? null } : null,
    slaStatus: String(t.slaStatus || ''),
    tags: Array.isArray(t.tags) ? t.tags.map(String) : [],
    createdAt: String(t.createdAt || ''),
    updatedAt: String(t.updatedAt || t.createdAt || ''),
    resolvedAt: t.resolvedAt ?? null,
    ...(withComments
      ? {
          comments: visibleComments(ctx, t).map((c) => ({
            id: c.id,
            author: String(c.author || ''),
            authorRole: String(c.authorRole || 'AGENT'),
            isInternal: Boolean(c.isInternal),
            body: String(c.body || ''),
            createdAt: String(c.createdAt || ''),
          })),
        }
      : {}),
  };
  return maskTicketForResponse(dto);
}

function lookups(snap: TicketSnapshot) {
  const contacts = new Map<string, Contact>(snap.contacts.map((c) => [c.id, c]));
  const companies = new Map<string, Company>(snap.companies.map((c) => [c.id, c]));
  return { contact: (i: string) => contacts.get(i), company: (i: string) => companies.get(i) };
}

function findTicket(snap: TicketSnapshot, ctx: UseCaseContext, ref: string): ServiceTicket {
  const lower = ref.toLowerCase();
  const t = snap.tickets.find((x) => x.id === ref || String(x.key || '').toLowerCase() === lower);
  if (!t || !ticketInScope(ctx.portfolio, t, lookups(snap))) throw notFound('Chamado');
  return t;
}

const listOf = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item), page: PageInfoSchema });
const one = <T extends z.ZodType>(item: T) => z.object({ data: item });

export const ticketsList = defineUseCase({
  operationId: 'tickets.list',
  toolName: 'tickets_list',
  method: 'GET',
  path: '/api/v1/tickets',
  pathParams: [],
  tag: 'Chamados',
  summary: 'Listar chamados',
  description:
    'Lista chamados da carteira (mascarados), com busca no servidor (CNPJ/conta so por valor completo), filtro por fila (TEC/FIN/...), status e prioridade.',
  requiredScope: 'tickets:read',
  requiredModule: 'chamados',
  domain: 'tickets',
  idempotent: true,
  mutation: false,
  successStatus: 200,
  inputSchema: z
    .object({
      limit: LimitSchema,
      cursor: CursorSchema,
      search: SearchSchema,
      queue: QueuePrefixSchema.optional(),
      status: z.enum(STATUS).optional(),
      priority: z.enum(PRIORITY).optional(),
    })
    .strict(),
  outputSchema: listOf(TicketDto),
  async handler(input, ctx) {
    requireOwnerAccess(ctx, 'tickets', 'VIEW');
    const snap = await ctx.data.snapshot('tickets');
    const lk = lookups(snap);
    const rows = snap.tickets
      .filter((t) => ticketInScope(ctx.portfolio, t, lk))
      .filter((t) => !input.queue || queueOfKey(t.key) === input.queue)
      .filter((t) => !input.status || t.status === input.status)
      .filter((t) => !input.priority || t.priority === input.priority)
      .filter((t) => {
        if (!input.search) return true;
        const company = t.companyId ? lk.company(t.companyId) : undefined;
        const contact = t.contactId ? lk.contact(t.contactId) : undefined;
        // Busca so no que a credencial pode ver (sem oraculo por comentario interno).
        return ticketMatchesSearchServer({ ...t, company: company || null, contact: contact || null, comments: visibleComments(ctx, t) }, input.search);
      })
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)) || a.id.localeCompare(b.id));
    const { data, page } = paginate(rows, input.limit, input.cursor);
    return { data: data.map((t) => toTicket(ctx, t, t.companyId ? lk.company(t.companyId) : undefined, false)), page };
  },
});

export const ticketsGet = defineUseCase({
  operationId: 'tickets.get',
  toolName: 'tickets_get',
  method: 'GET',
  path: '/api/v1/tickets/{id}',
  pathParams: ['id'],
  tag: 'Chamados',
  summary: 'Obter chamado',
  description: 'Detalhe mascarado de um chamado por id ou chave (TEC-123/FIN-45). Comentarios internos so com escopo tickets:internal_notes:*.',
  requiredScope: 'tickets:read',
  requiredModule: 'chamados',
  domain: 'tickets',
  idempotent: true,
  mutation: false,
  successStatus: 200,
  inputSchema: z.object({ id: TicketRefSchema }).strict(),
  outputSchema: one(TicketDto),
  async handler(input, ctx) {
    requireOwnerAccess(ctx, 'tickets', 'VIEW');
    const snap = await ctx.data.snapshot('tickets');
    const t = findTicket(snap, ctx, input.id);
    return { data: toTicket(ctx, t, t.companyId ? lookups(snap).company(t.companyId) : undefined, true) };
  },
});

async function activeQueue(ctx: UseCaseContext, prefix: string): Promise<SetaDeskPipeline> {
  const queues = await ctx.data.listTicketQueues();
  const q = queues.find((p) => String(p.prefix).toUpperCase() === prefix && p.isActive !== false);
  if (!q) throw new UseCaseError(422, 'QUEUE_INVALID', 'Fila inexistente ou inativa. Use GET /api/v1/tickets/queues.', { fields: ['queue'] });
  return q;
}

export const ticketsCreate = defineUseCase({
  operationId: 'tickets.create',
  toolName: 'tickets_create',
  method: 'POST',
  path: '/api/v1/tickets',
  pathParams: [],
  tag: 'Chamados',
  summary: 'Abrir chamado (TEC-/FIN-)',
  description:
    'Abre chamado na fila indicada (prefixo TEC, FIN ou outra fila ativa); a chave gerada segue o prefixo da fila. Fora da carteira TODOS exige contato/empresa da carteira. Aceita Idempotency-Key.',
  requiredScope: 'tickets:write',
  requiredModule: 'chamados',
  domain: 'tickets',
  idempotent: false,
  mutation: true,
  successStatus: 201,
  inputSchema: z
    .object({
      queue: QueuePrefixSchema,
      subject: text(300).min(1),
      description: text(10000).optional(),
      category: z.enum(CATEGORY).optional(),
      priority: z.enum(PRIORITY).optional(),
      channel: z.enum(CHANNEL).optional(),
      contactId: IdSchema.optional(),
      companyId: IdSchema.optional(),
      dealId: IdSchema.optional(),
      equipmentSerial: text(120).optional(),
      tags: z.array(text(60)).max(30).optional(),
    })
    .strict(),
  outputSchema: one(TicketDto),
  async handler(input, ctx) {
    requireOwnerAccess(ctx, 'tickets', 'EDIT');
    const masked = (['subject', 'description'] as const).filter((f) => containsMaskArtifact(input[f]));
    if (masked.length) {
      throw new UseCaseError(422, 'TICKET_MASKED_VALUE', 'Texto com mascara (***) nao pode ser gravado. Envie o valor real.', { fields: masked });
    }
    const snap = await ctx.data.snapshot('tickets');
    const lk = lookups(snap);
    const contact = input.contactId ? lk.contact(input.contactId) : undefined;
    const company = input.companyId ? lk.company(input.companyId) : undefined;
    if (input.contactId && !contact) throw new UseCaseError(422, 'LINK_NOT_FOUND', 'Contato inexistente.', { fields: ['contactId'] });
    if (input.companyId && !company) throw new UseCaseError(422, 'LINK_NOT_FOUND', 'Empresa inexistente.', { fields: ['companyId'] });
    if (!ctx.portfolio.all) {
      const linked = (contact && contactInScope(ctx.portfolio, contact)) || (company && companyInScope(ctx.portfolio, company));
      if (!linked) {
        throw new UseCaseError(403, 'TICKET_LINK_OUT_OF_PORTFOLIO', 'Com carteira PROPRIOS/EQUIPE o chamado precisa de contato ou empresa da carteira.', {
          fields: ['contactId', 'companyId'],
        });
      }
    }
    const queue = await activeQueue(ctx, input.queue);
    const res = await ctx.data.write('POST', '/api/tickets', {
      subject: input.subject,
      description: input.description,
      category: input.category || (queue.prefix === 'FIN' ? 'BILLING' : 'SUPPORT'),
      priority: input.priority || 'MEDIUM',
      status: 'OPEN',
      channel: input.channel || 'WEB_PORTAL',
      contactId: input.contactId ?? null,
      companyId: input.companyId ?? null,
      dealId: input.dealId ?? null,
      equipmentSerial: input.equipmentSerial ?? null,
      tags: [...new Set([...(input.tags || []), ctx.auth.channel === 'mcp' ? 'origem:mcp' : 'origem:api-v1'])],
      pipelineId: queue.id,
    });
    const created = unwrapWrite(res, 'chamado') as ServiceTicket;
    if (!String(created.key || '').toUpperCase().startsWith(`${queue.prefix}-`)) {
      throw new UseCaseError(500, 'TICKET_KEY_PREFIX_MISMATCH', 'Chave gerada fora do prefixo da fila.');
    }
    return { data: toTicket(ctx, created, company, true) };
  },
});

export const ticketsPatch = defineUseCase({
  operationId: 'tickets.patch',
  toolName: 'tickets_patch',
  method: 'PATCH',
  path: '/api/v1/tickets/{id}',
  pathParams: ['id'],
  tag: 'Chamados',
  summary: 'Atualizar chamado (PATCH strict)',
  description:
    'Allowlist estrita (status, prioridade, categoria, responsavel, assunto, descricao, resolucao, serial, contrato, tags). Outros campos => 400. Texto com mascara (***) => 422 (nunca sobrescreve com valor mascarado).',
  requiredScope: 'tickets:write',
  requiredModule: 'chamados',
  domain: 'tickets',
  idempotent: true,
  mutation: true,
  successStatus: 200,
  inputSchema: z
    .object({
      id: TicketRefSchema,
      status: z.enum(STATUS).optional(),
      priority: z.enum(PRIORITY).optional(),
      category: z.enum(CATEGORY).optional(),
      assignee: text(160).min(1).optional(),
      subject: text(300).min(1).optional(),
      description: text(10000).optional(),
      resolution: text(10000).nullable().optional(),
      equipmentSerial: text(120).nullable().optional(),
      contractId: text(120).nullable().optional(),
      tags: z.array(text(60)).max(30).optional(),
    })
    .strict(),
  outputSchema: one(TicketDto),
  async handler(input, ctx) {
    requireOwnerAccess(ctx, 'tickets', 'EDIT');
    const { id, ...patch } = input;
    const masked = (['subject', 'description', 'resolution', 'assignee', 'equipmentSerial', 'contractId'] as const).filter((f) =>
      containsMaskArtifact(patch[f])
    );
    if ((patch.tags || []).some(containsMaskArtifact)) masked.push('tags' as never);
    if (masked.length) {
      throw new UseCaseError(422, 'TICKET_PATCH_MASKED_VALUE', 'Valor mascarado (***) nao sobrescreve o original. Envie o valor real ou omita o campo.', {
        fields: masked,
      });
    }
    if (Object.keys(patch).length === 0) throw new UseCaseError(422, 'EMPTY_PATCH', 'Nenhum campo para atualizar.');
    const snap = await ctx.data.snapshot('tickets');
    const t = findTicket(snap, ctx, id);
    const res = await ctx.data.write('PATCH', `/api/tickets/${encodeURIComponent(t.id)}`, patch);
    const updated = unwrapWrite(res, 'chamado') as ServiceTicket;
    return { data: toTicket(ctx, updated, updated.companyId ? lookups(snap).company(updated.companyId) : undefined, true) };
  },
});

export const ticketsCommentsCreate = defineUseCase({
  operationId: 'tickets.comments.create',
  toolName: 'tickets_comments_create',
  method: 'POST',
  path: '/api/v1/tickets/{id}/comments',
  pathParams: ['id'],
  tag: 'Chamados',
  summary: 'Comentar chamado',
  description:
    'Registra comentario. visibility=internal exige tickets:internal_notes:write; visibility=public fica visivel ao cliente no portal (auditado). Aceita Idempotency-Key.',
  requiredScope: 'tickets:write',
  requiredModule: 'chamados',
  domain: 'tickets',
  idempotent: false,
  mutation: true,
  successStatus: 201,
  inputSchema: z
    .object({
      id: TicketRefSchema,
      body: text(10000).min(1),
      visibility: z.enum(['internal', 'public']),
      newStatus: z.enum(STATUS).optional(),
    })
    .strict(),
  outputSchema: one(TicketDto),
  async handler(input, ctx) {
    requireOwnerAccess(ctx, 'tickets', 'EDIT');
    if (input.visibility === 'internal' && !hasScope(ctx.auth, 'tickets:internal_notes:write')) {
      throw new UseCaseError(403, 'SCOPE_INSUFFICIENT', 'Comentario interno exige o escopo tickets:internal_notes:write.', {
        requiredScope: 'tickets:internal_notes:write',
      });
    }
    if (containsMaskArtifact(input.body)) {
      throw new UseCaseError(422, 'TICKET_MASKED_VALUE', 'Texto com mascara (***) nao pode ser gravado.', { fields: ['body'] });
    }
    const snap = await ctx.data.snapshot('tickets');
    const t = findTicket(snap, ctx, input.id);
    const res = await ctx.data.write('POST', `/api/tickets/${encodeURIComponent(t.id)}/comments`, {
      body: input.body,
      isInternal: input.visibility === 'internal',
      author: ctx.auth.actorLabel,
      ...(input.newStatus ? { newStatus: input.newStatus } : {}),
    });
    const updated = unwrapWrite(res, 'comentario') as ServiceTicket;
    return { data: toTicket(ctx, updated, updated.companyId ? lookups(snap).company(updated.companyId) : undefined, true) };
  },
});

export const ticketsQueuesList = defineUseCase({
  operationId: 'tickets.queues.list',
  toolName: 'tickets_queues_list',
  method: 'GET',
  path: '/api/v1/tickets/queues',
  pathParams: [],
  tag: 'Chamados',
  summary: 'Listar filas',
  description: 'Filas (pipelines) do SetaDesk disponiveis para abertura de chamados (ex.: TEC, FIN).',
  requiredScope: 'tickets:read',
  requiredModule: 'chamados',
  domain: 'tickets',
  idempotent: true,
  mutation: false,
  successStatus: 200,
  inputSchema: z.object({}).strict(),
  outputSchema: z.object({ data: z.array(QueueDto) }),
  async handler(_input, ctx) {
    const queues = await ctx.data.listTicketQueues();
    return {
      data: queues
        .filter((q) => q.isActive !== false)
        .map((q) => ({ id: q.id, name: q.name, prefix: String(q.prefix).toUpperCase(), isActive: q.isActive !== false })),
    };
  },
});

export const TICKET_USE_CASES = [ticketsList, ticketsGet, ticketsCreate, ticketsPatch, ticketsCommentsCreate, ticketsQueuesList];
