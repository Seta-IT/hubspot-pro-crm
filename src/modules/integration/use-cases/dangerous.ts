// ============================================================================
// STI-hub — API v1 + MCP: Fase 2 / Lote 3 — operacoes PERIGOSAS em duas etapas (24/11/2026).
// Cada operacao vira um PAR de tools:
//   <nome>_prepare: confere TUDO (escopo, alcada de tela, permissao de acao, carteira, estado),
//                   devolve a previa SEM GRAVAR e um token de uso unico (5 min) preso a operacao,
//                   ao hash dos argumentos e a credencial/usuario/autorizacao efetiva;
//   <nome>_commit:  exige o token + argumentos IDENTICOS; reconfere tudo com o estado vivo e executa.
// Rate-limit proprio (executor), auditoria antes/depois e nunca em lote (JSON-RPC batch => 400).
// ============================================================================
import { z } from 'zod/v4';
import type { IntegrationModule, IntegrationScope } from '../scopes';
import { recordWriteAudit, requireOwnerScope } from './common';
import { defineUseCase, UseCaseError, type UseCaseContext, type UseCaseDefinition } from './types';

export interface DangerousPlan {
  /** Previa (ja sanitizada pelo handler) do que sera feito. */
  preview: Record<string, unknown>;
  entity: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  /** Efeitos colaterais conhecidos (exibidos na previa). */
  effects: string[];
  /**
   * CISO 26/11 (Lote 3, 6): registros que deixam de existir (exclusao/merge). Cada um e copiado
   * INTEGRALMENTE para a lixeira (api_deleted_records) ANTES do run(); falha na copia => nada e excluido.
   * Obrigatorio para op 'delete' e 'merge'.
   */
  trash?: Array<{ entity: string; recordId: string; record: Record<string, unknown> }>;
  /** Executa (so no commit). Retorna o resultado sanitizado (vira "after" na auditoria). */
  run: () => Promise<Record<string, unknown>>;
}

export interface DangerousSpec<I extends z.ZodObject<z.ZodRawShape>> {
  /** Base do nome da tool (ex.: crm_contacts_delete => crm_contacts_delete_prepare/_commit). */
  name: string;
  /** Base do operationId (ex.: crm.contacts.delete => .prepare/.commit). */
  operationId: string;
  /** Base do caminho REST (ex.: /api/v1/contacts/{id}/delete => /prepare e /commit). */
  path: string;
  pathParams: string[];
  tag: 'CRM' | 'ERP';
  requiredModule: IntegrationModule;
  domain: 'crm' | 'erp';
  requiredScope: IntegrationScope;
  /** Operacao gravada na auditoria (delete, merge, send, approve, pay, issue...). */
  op: string;
  summary: string;
  description: string;
  inputSchema: I;
  plan: (input: z.infer<I>, ctx: UseCaseContext) => Promise<DangerousPlan>;
}

const Record_ = z.record(z.string(), z.unknown());
const PrepareOut = z.object({
  data: z.object({
    operation: z.string(),
    preview: Record_,
    effects: z.array(z.string()),
    confirmationToken: z.string(),
    expiresAt: z.string(),
    commitTool: z.string(),
    warning: z.string(),
  }),
});
const CommitOut = z.object({ data: z.object({ operation: z.string(), entityId: z.string(), result: Record_ }) });

/** Operacoes que removem registros: exigem copia integral na lixeira antes de executar. */
export const TRASH_REQUIRED_OPS: ReadonlySet<string> = new Set(['delete', 'merge']);

const TokenSchema = z.string().trim().min(10).max(80);

export function defineDangerous<I extends z.ZodObject<z.ZodRawShape>>(spec: DangerousSpec<I>): UseCaseDefinition[] {
  const common = {
    tag: spec.tag,
    requiredModule: spec.requiredModule,
    domain: spec.domain,
    requiredScope: spec.requiredScope,
    pathParams: spec.pathParams,
    method: 'POST' as const,
  };
  const commitTool = `${spec.name}_commit`;
  const prepare = defineUseCase({
    ...common,
    operationId: `${spec.operationId}.prepare`,
    toolName: `${spec.name}_prepare`,
    path: `${spec.path}/prepare`,
    summary: `${spec.summary} — previa (etapa 1/2)`,
    description: `ETAPA 1/2 (nao grava nada): ${spec.description} Devolve a previa e um confirmationToken de uso unico (5 min) para ${commitTool} com os MESMOS argumentos.`,
    idempotent: true,
    mutation: false,
    successStatus: 200 as const,
    dangerous: 'prepare' as const,
    inputSchema: spec.inputSchema,
    outputSchema: PrepareOut,
    async handler(input, ctx) {
      requireOwnerScope(ctx, spec.requiredScope);
      const plan = await spec.plan(input as z.infer<I>, ctx);
      const { token, expiresAt } = await ctx.confirm.issue(spec.operationId, input as Record<string, unknown>);
      return {
        data: {
          operation: spec.operationId,
          preview: plan.preview,
          effects: plan.effects,
          confirmationToken: token,
          expiresAt,
          commitTool,
          warning: 'Operacao irreversivel ou com efeito externo. Confirme com o usuario antes de chamar o commit.',
        },
      };
    },
  });
  const commitSchema = spec.inputSchema.extend({ confirmationToken: TokenSchema }).strict();
  const commit = defineUseCase({
    ...common,
    operationId: `${spec.operationId}.commit`,
    toolName: commitTool,
    path: `${spec.path}/commit`,
    summary: `${spec.summary} — executar (etapa 2/2)`,
    description: `ETAPA 2/2: executa ${spec.operationId} SOMENTE com o confirmationToken do ${spec.name}_prepare (uso unico, 5 min, mesma credencial/usuario e argumentos identicos).`,
    idempotent: false,
    mutation: true,
    successStatus: 200 as const,
    dangerous: 'commit' as const,
    inputSchema: commitSchema,
    outputSchema: CommitOut,
    async handler(input, ctx) {
      requireOwnerScope(ctx, spec.requiredScope);
      const { confirmationToken, ...args } = input as Record<string, unknown> & { confirmationToken: string };
      // Consome ANTES de reconferir: token de uso unico mesmo se a reconferencia falhar.
      await ctx.confirm.consume(spec.operationId, args, confirmationToken);
      const plan = await spec.plan(args as z.infer<I>, ctx);
      if (TRASH_REQUIRED_OPS.has(spec.op)) {
        if (!plan.trash?.length) throw new UseCaseError(500, 'TRASH_SNAPSHOT_MISSING', 'Exclusao sem copia para a lixeira (recusada).');
        for (const t of plan.trash) await ctx.trash.snapshot(t.entity, t.recordId, spec.operationId, t.record);
      }
      const result = await plan.run();
      recordWriteAudit(ctx, plan.entity, spec.op, plan.entityId, plan.before ?? null, result);
      return { data: { operation: spec.operationId, entityId: plan.entityId, result } };
    },
  });
  return [prepare, commit] as unknown as UseCaseDefinition[];
}

/** Resposta de rota interna perigosa: 2xx => corpo; 404 => neutro; 4xx => 409/422 com a mensagem do app; 5xx => 502. */
export function unwrapDangerous(res: { status: number; body: any }, what: string): any {
  if (res.status >= 200 && res.status < 300) return res.body?.data ?? res.body ?? {};
  if (res.status === 404) throw new UseCaseError(404, 'NOT_FOUND', `${what} nao encontrado(a).`);
  const msg = typeof res.body?.error === 'string' ? String(res.body.error).slice(0, 300) : `Operacao recusada pelo app (${what}).`;
  const code = typeof res.body?.code === 'string' ? String(res.body.code).slice(0, 60) : 'APP_REJECTED';
  if (res.status === 429) throw new UseCaseError(429, code, msg);
  // Recurso desligado/indisponivel no app (ex.: caixa do Outlook, segredo de link): 503 com o codigo do app.
  if (res.status === 503) throw new UseCaseError(503, code, msg);
  if (res.status >= 400 && res.status < 500) throw new UseCaseError(res.status === 422 || res.status === 400 ? 422 : 409, code, msg);
  throw new UseCaseError(502, 'UPSTREAM_ERROR', `Falha interna ao executar (${what}).`);
}
