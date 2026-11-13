// ============================================================================
// STI-hub — Servidor MCP remoto (/api/mcp), Streamable HTTP STATELESS, JSON-RPC 2.0.
// - Bearer obrigatorio (chave stihub_int_* ou token OAuth 2.1); 401 com
//   WWW-Authenticate apontando o metadata RFC 9728.
// - tools/list filtrado por escopo + moduleAccess da credencial.
// - tools/call executa os MESMOS casos de uso Zod da API v1 (channel 'mcp'), com
//   carteira, rate-limit, idempotencia (_meta["stihub/idempotencyKey"]) e auditoria.
// - Sem sessao MCP (stateless): GET (SSE) e DELETE => 405.
// ============================================================================
import { z } from 'zod/v4';
import { authenticateBearer, hasScope, type AuthContext } from './auth-context';
import { audit, beginIdempotency, checkRateLimit, credentialBucket, executeUseCase, finishIdempotency, newRequestId } from './executor';
import { json, postgresUnavailable, problem, type IntegrationHttpRequest, type IntegrationHttpResponse } from './http';
import { API_V1_VERSION } from './openapi';
import { resolveIntegrationDeps, type IntegrationDeps } from './runtime';
import type { IntegrationStore } from './store';
import { INTEGRATION_USE_CASES, findUseCaseByToolName, type UseCaseDefinition } from './use-cases';

export const MCP_SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const MCP_SERVER_INFO = { name: 'stihub-mcp', title: 'STI-hub (CRM e Chamados)', version: API_V1_VERSION };

type JsonRpcId = string | number | null;
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

const rpcResult = (id: JsonRpcId, result: unknown) => ({ jsonrpc: '2.0' as const, id, result });
const rpcError = (id: JsonRpcId, code: number, message: string, data?: unknown) => ({
  jsonrpc: '2.0' as const,
  id,
  error: { code, message, ...(data !== undefined ? { data } : {}) },
});

export function protectedResourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource`;
}

function toolSchema(schema: z.ZodType, io: 'input' | 'output'): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: 'draft-2020-12', io, unrepresentable: 'any' }) as Record<string, unknown>;
  delete js.$schema;
  if (js.type !== 'object') return { type: 'object', properties: {} };
  return js;
}

export function visibleTools(auth: Pick<AuthContext, 'scopes' | 'moduleAccess'>): UseCaseDefinition[] {
  return INTEGRATION_USE_CASES.filter((uc) => hasScope(auth as AuthContext, uc.requiredScope));
}

export function describeTool(uc: UseCaseDefinition) {
  return {
    name: uc.toolName,
    title: uc.summary,
    description: `${uc.description} (escopo: ${uc.requiredScope})`,
    inputSchema: toolSchema(uc.inputSchema, 'input'),
    outputSchema: toolSchema(uc.outputSchema, 'output'),
    annotations: {
      title: uc.summary,
      readOnlyHint: !uc.mutation,
      destructiveHint: false,
      idempotentHint: uc.idempotent,
      openWorldHint: false,
    },
  };
}

async function handleMessage(
  msg: unknown,
  auth: AuthContext,
  store: IntegrationStore,
  deps: IntegrationDeps,
  req: IntegrationHttpRequest,
  requestId: string,
  startedAt: number
): Promise<object | null> {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || (msg as { jsonrpc?: unknown }).jsonrpc !== '2.0') {
    return rpcError(null, -32600, 'Invalid Request');
  }
  const m = msg as JsonRpcRequest;
  const isNotification = !('id' in m) || m.id === undefined;
  const id: JsonRpcId = isNotification ? null : (m.id as JsonRpcId);
  if (typeof m.method !== 'string') return isNotification ? null : rpcError(id, -32600, 'Invalid Request');
  const params = m.params && typeof m.params === 'object' && !Array.isArray(m.params) ? m.params : {};

  if (isNotification) {
    // notifications/initialized, notifications/cancelled etc.: aceitas sem resposta.
    return null;
  }

  switch (m.method) {
    case 'initialize': {
      const requested = String((params as { protocolVersion?: unknown }).protocolVersion || '');
      const protocolVersion = (MCP_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
        ? requested
        : MCP_SUPPORTED_PROTOCOL_VERSIONS[0];
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
        instructions:
          'Servidor MCP do STI-hub: CRM (contatos, empresas, negocios, atividades, pipelines) e Chamados SetaDesk (TEC-/FIN-). ' +
          'Dados respeitam a carteira e os escopos da credencial; chamados sao mascarados. Sem exclusao, merge, sequencias ou fiscal.',
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: visibleTools(auth).map(describeTool) });
    case 'tools/call': {
      const name = String((params as { name?: unknown }).name || '');
      const args = (params as { arguments?: unknown }).arguments ?? {};
      const meta = ((params as { _meta?: unknown })._meta || {}) as Record<string, unknown>;
      const uc = findUseCaseByToolName(name);
      if (!uc || !visibleTools(auth).includes(uc)) {
        await audit(store, { requestId, channel: 'mcp', authType: auth.authType, auth, action: `tools/call:${name.slice(0, 64) || '?'}`, path: req.path, statusCode: 404, ip: req.ip, startedAt, errorCode: 'TOOL_NOT_FOUND', now: deps.now() });
        return rpcError(id, -32602, `Unknown tool: ${name.slice(0, 64)}`);
      }
      let idem: Awaited<ReturnType<typeof beginIdempotency>> = { kind: 'none' };
      if (uc.mutation) {
        const key = typeof meta['stihub/idempotencyKey'] === 'string' ? String(meta['stihub/idempotencyKey']) : undefined;
        idem = await beginIdempotency(store, auth, key, 'MCP', `tools/call:${uc.toolName}`, args, deps);
        if (idem.kind === 'invalid') return rpcError(id, -32602, 'stihub/idempotencyKey invalida (8-128 caracteres A-Z a-z 0-9 _ . : -).');
        if (idem.kind === 'conflict') {
          return rpcResult(id, { isError: true, content: [{ type: 'text', text: JSON.stringify({ status: 409, code: idem.code, title: idem.title }) }] });
        }
        if (idem.kind === 'replay') {
          return rpcResult(id, idem.body);
        }
      }
      const r = await executeUseCase(uc, args, auth, deps);
      const result = r.ok
        ? { content: [{ type: 'text', text: JSON.stringify(r.body) }], structuredContent: r.body, isError: false }
        : { content: [{ type: 'text', text: JSON.stringify({ status: r.status, code: r.code, title: r.title, ...(r.extra || {}) }) }], isError: true };
      if (uc.mutation) await finishIdempotency(store, idem, r.status, result);
      await audit(store, {
        requestId,
        channel: 'mcp',
        authType: auth.authType,
        auth,
        scope: uc.requiredScope,
        action: `tools/call:${uc.toolName}`,
        path: req.path,
        statusCode: r.status,
        ip: req.ip,
        startedAt,
        errorCode: r.ok ? null : r.code,
        now: deps.now(),
      });
      return rpcResult(id, result);
    }
    default:
      return rpcError(id, -32601, 'Method not found');
  }
}

export async function handleMcp(req: IntegrationHttpRequest, depsIn?: IntegrationDeps): Promise<IntegrationHttpResponse> {
  const deps = depsIn || resolveIntegrationDeps();
  const requestId = newRequestId();
  const startedAt = Date.now();
  const method = req.method.toUpperCase();
  const store = deps.store;
  if (!store) return postgresUnavailable();
  const wwwAuth = { 'WWW-Authenticate': `Bearer resource_metadata="${protectedResourceMetadataUrl(req.origin)}"` };

  if (method !== 'POST') {
    // Stateless: sem stream SSE (GET) e sem sessao para encerrar (DELETE).
    return problem(405, 'METHOD_NOT_ALLOWED', 'Servidor MCP stateless: use POST com JSON-RPC 2.0.', {}, { Allow: 'POST' });
  }

  const authResult = await authenticateBearer(store, req.headers['authorization'], { channel: 'mcp', requestId, ip: req.ip, now: deps.now() });
  if (!authResult.ok) {
    await audit(store, { requestId, channel: 'mcp', authType: 'none', action: 'mcp:auth', path: req.path, statusCode: authResult.status, ip: req.ip, startedAt, errorCode: authResult.code, now: deps.now() });
    return problem(authResult.status, authResult.code, authResult.title, {}, wwwAuth);
  }
  const auth = authResult.ctx;

  const rate = await checkRateLimit(store, credentialBucket(auth), deps.limits.perCredentialPerMinute, deps.now());
  if (!rate.allowed) {
    await audit(store, { requestId, channel: 'mcp', authType: auth.authType, auth, action: 'mcp:rate_limited', path: req.path, statusCode: 429, ip: req.ip, startedAt, errorCode: 'RATE_LIMITED', now: deps.now() });
    return problem(429, 'RATE_LIMITED', 'Limite de requisicoes excedido. Tente novamente apos Retry-After.', {}, rate.headers);
  }

  const body = req.body;
  if (body === undefined || body === null || typeof body !== 'object') {
    return json(400, rpcError(null, -32700, 'Parse error'), rate.headers);
  }
  const headers = { ...rate.headers, 'X-Request-Id': requestId };
  if (Array.isArray(body)) {
    if (body.length === 0 || body.length > 20) return json(400, rpcError(null, -32600, 'Invalid Request'), headers);
    const out: object[] = [];
    for (const msg of body) {
      const r = await handleMessage(msg, auth, store, deps, req, requestId, startedAt);
      if (r) out.push(r);
    }
    return out.length ? json(200, out, headers) : { status: 202, headers };
  }
  const r = await handleMessage(body, auth, store, deps, req, requestId, startedAt);
  return r ? json(200, r, headers) : { status: 202, headers };
}
