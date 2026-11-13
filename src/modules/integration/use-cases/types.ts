// ============================================================================
// STI-hub — API v1 + MCP: definicao de caso de uso (fonte unica de verdade).
// REST (/api/v1/*), MCP (tools/list + tools/call) e OpenAPI 3.1 sao gerados a partir
// destes registros: mesmo schema Zod de entrada/saida, mesmo escopo, mesmo modulo.
// ============================================================================
import { z } from 'zod/v4';
import type { AuthContext } from '../auth-context';
import type { IntegrationDataPort, IntegrationUser } from '../data-port';
import type { PortfolioView } from '../portfolio';
import type { IntegrationModule, IntegrationScope } from '../scopes';

export interface UseCaseContext {
  auth: AuthContext;
  data: IntegrationDataPort;
  owner: IntegrationUser;
  portfolio: PortfolioView;
  allUsers: IntegrationUser[];
}

export interface UseCaseDefinition<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  operationId: string;
  /** Nome da tool MCP (^[a-zA-Z0-9_-]{1,64}$). */
  toolName: string;
  method: 'GET' | 'POST' | 'PATCH';
  /** Caminho OpenAPI (ex.: /api/v1/contacts/{id}). */
  path: string;
  /** Parametros de caminho (presentes tambem no inputSchema). */
  pathParams: string[];
  tag: 'CRM' | 'Chamados';
  summary: string;
  description: string;
  requiredScope: IntegrationScope;
  requiredModule: IntegrationModule;
  domain: 'crm' | 'tickets';
  /** true => repetir a mesma chamada nao muda o resultado (GET/PATCH). POST aceita Idempotency-Key. */
  idempotent: boolean;
  mutation: boolean;
  successStatus: 200 | 201;
  inputSchema: I;
  outputSchema: O;
  handler: (input: z.infer<I>, ctx: UseCaseContext) => Promise<z.infer<O>>;
}

export class UseCaseError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly extra: Record<string, unknown> = {}
  ) {
    super(title);
    this.name = 'UseCaseError';
  }
}

export function defineUseCase<I extends z.ZodType, O extends z.ZodType>(def: UseCaseDefinition<I, O>): UseCaseDefinition<I, O> {
  return def;
}

// ---------------------------------------------------------------------------
// Blocos de schema compartilhados
// ---------------------------------------------------------------------------
export const IdSchema = z.string().regex(/^[A-Za-z0-9._-]{1,80}$/, 'id invalido');
export const LimitSchema = z.coerce.number().int().min(1).max(100).default(25);
export const CursorSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/, 'cursor invalido').optional();
export const SearchSchema = z.string().trim().max(200).optional();
export const text = (max: number) => z.string().trim().max(max);
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}(T[0-9:.]+(Z|[+-]\d{2}:\d{2})?)?$/, 'data ISO invalida');

export const PageInfoSchema = z.object({
  limit: z.number().int(),
  nextCursor: z.string().nullable(),
  total: z.number().int(),
});

/** Paginacao por cursor opaco (base64url do offset). */
export function paginate<T>(items: T[], limit: number, cursor: string | undefined): { data: T[]; page: z.infer<typeof PageInfoSchema> } {
  let offset = 0;
  if (cursor) {
    const decoded = Number(Buffer.from(cursor, 'base64url').toString('utf8').replace(/^o:/, ''));
    if (!Number.isInteger(decoded) || decoded < 0) throw new UseCaseError(400, 'CURSOR_INVALID', 'Cursor de paginacao invalido.');
    offset = decoded;
  }
  const data = items.slice(offset, offset + limit);
  const next = offset + limit < items.length ? Buffer.from(`o:${offset + limit}`, 'utf8').toString('base64url') : null;
  return { data, page: { limit, nextCursor: next, total: items.length } };
}

export function notFound(what: string): UseCaseError {
  // Fora da carteira responde igual a inexistente (sem revelar existencia).
  return new UseCaseError(404, 'NOT_FOUND', `${what} nao encontrado(a).`);
}
