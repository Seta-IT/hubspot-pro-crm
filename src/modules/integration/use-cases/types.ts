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
  /**
   * Fase 2 / Lote 2: trilha antes/depois da escrita (preenchida pelo handler via recordWriteAudit;
   * gravada pelo REST/MCP em integration_audit.details, ja sanitizada — sem segredos/PII de contato).
   */
  audit: WriteAuditTrail;
  /**
   * Correcao CISO (Lote 2): posse por ID dos registros criados pelo conector (metadado do conector,
   * nao amplia visibilidade). get() devolve o ID do dono ou null.
   */
  owners: RecordOwnerPort;
  /** Fase 2 / Lote 3: emissao/consumo do token de confirmacao em duas etapas. */
  confirm: ConfirmationPort;
  /** CISO 26/11 (Lote 3, 6): lixeira — copia integral gravada ANTES de qualquer exclusao. */
  trash: TrashPort;
  /** CISO 26/11 (Lote 3, 3): cotas diarias por usuario (ex.: e-mails enviados pelo conector). */
  quota: QuotaPort;
}

export interface TrashPort {
  /** Grava a copia; falha => lanca (a exclusao NAO acontece). */
  snapshot(entity: string, recordId: string, operationId: string, record: Record<string, unknown>): Promise<void>;
}

export interface QuotaPort {
  /** Conta +1 na cota diaria (UTC) do usuario dono para `kind`; acima do limite => 429. */
  consumeDaily(kind: string, limit: number): Promise<{ count: number; limit: number }>;
}


export interface RecordOwnerPort {
  get(entity: string, recordId: string): Promise<string | null>;
  /**
   * Grava o dono de registro NOVO (padrao: dono da credencial). CISO 26/11 (Lote 2, 4): nunca
   * sobrescreve — ja havendo dono => 409 OWNER_ALREADY_SET (o existente fica intacto).
   */
  set(entity: string, recordId: string, ownerUserId?: string): Promise<void>;
  /**
   * Troca de dono, SO pelo fluxo de mudanca de responsavel: exige carteira TODOS (a mesma regra que
   * autoriza trocar o vendedor/responsavel) e faz compare-and-swap pelo dono atual (409 se mudou).
   */
  transfer(entity: string, recordId: string, toOwnerUserId: string): Promise<void>;
}


export interface ConfirmationPort {
  /** Emite token de uso unico preso a operacao + hash dos argumentos + credencial/usuario. */
  issue(operationId: string, args: Record<string, unknown>): Promise<{ token: string; expiresAt: string }>;
  /** Consome o token (uso unico) e confere operacao/argumentos/validade; senao lanca UseCaseError 409. */
  consume(operationId: string, args: Record<string, unknown>, token: string): Promise<void>;
}

export interface WriteAuditTrail {
  entity?: string;
  entityId?: string;
  op?: string;
  changedFields?: string[];
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** CISO 26/11 (Lote 2, 4): troca de dono registrada (de -> para), so pelo fluxo de responsavel. */
  ownerTransfer?: { entity: string; recordId: string; from: string | null; to: string };
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
  tag: 'CRM' | 'Chamados' | 'ERP';
  summary: string;
  description: string;
  requiredScope: IntegrationScope;
  requiredModule: IntegrationModule;
  domain: 'crm' | 'tickets' | 'erp';
  /** true => repetir a mesma chamada nao muda o resultado (GET/PATCH). POST aceita Idempotency-Key. */
  idempotent: boolean;
  mutation: boolean;
  /** Fase 2 / Lote 2: criacao exige Idempotency-Key (REST) / _meta["stihub/idempotencyKey"] (MCP). */
  requireIdempotencyKey?: boolean;
  /**
   * Fase 2 / Lote 3: tool perigosa. 'prepare' = previa sem gravar + token; 'commit' = executa so
   * com token valido. Rate-limit proprio (mais apertado) e escopo da allowlist LOTE3.
   */
  dangerous?: 'prepare' | 'commit';
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
