// ============================================================================
// STI-hub — API v1: OpenAPI 3.1 gerado de forma DETERMINISTICA a partir do catalogo
// de casos de uso (schemas Zod). Servido apenas autenticado (GET /api/v1/openapi.json).
// Operacoes bloqueadas (DELETE, merge, sequencias, fiscal, GestaoClick, IAM) nao existem
// no catalogo e, portanto, nunca aparecem aqui.
// ============================================================================
import { z } from 'zod/v4';
import { INTEGRATION_SCOPES, SCOPE_DESCRIPTIONS } from './scopes';
import { INTEGRATION_USE_CASES, type UseCaseDefinition } from './use-cases';

export const API_V1_VERSION = '1.0.0';

type JsonSchema = Record<string, any>;

function toSchema(schema: z.ZodType, io: 'input' | 'output'): JsonSchema {
  const js = z.toJSONSchema(schema, { target: 'draft-2020-12', io, unrepresentable: 'any' }) as JsonSchema;
  delete js.$schema;
  return js;
}

const problemRef = { $ref: '#/components/schemas/Problem' };
const problemResponse = (description: string) => ({ description, content: { 'application/problem+json': { schema: problemRef } } });

function operationFor(uc: UseCaseDefinition): JsonSchema {
  const input = toSchema(uc.inputSchema, 'input');
  const props: Record<string, JsonSchema> = input.properties || {};
  const required = new Set<string>(input.required || []);
  const parameters: JsonSchema[] = uc.pathParams.map((p) => ({ name: p, in: 'path', required: true, schema: props[p] || { type: 'string' } }));
  let requestBody: JsonSchema | undefined;
  if (uc.method === 'GET') {
    for (const name of Object.keys(props).sort()) {
      if (uc.pathParams.includes(name)) continue;
      parameters.push({ name, in: 'query', required: required.has(name), schema: props[name] });
    }
  } else {
    const bodyProps: Record<string, JsonSchema> = {};
    for (const name of Object.keys(props)) if (!uc.pathParams.includes(name)) bodyProps[name] = props[name];
    const bodyRequired = [...required].filter((r) => !uc.pathParams.includes(r));
    requestBody = {
      required: true,
      content: {
        'application/json': {
          schema: { type: 'object', properties: bodyProps, ...(bodyRequired.length ? { required: bodyRequired } : {}), additionalProperties: false },
        },
      },
    };
  }
  if (uc.mutation) {
    parameters.push({
      name: 'Idempotency-Key',
      in: 'header',
      required: false,
      description: 'Chave unica por operacao (8-128 chars). Repeticao com o mesmo payload devolve a resposta original; payload diferente => 409. TTL 24h.',
      schema: { type: 'string', pattern: '^[A-Za-z0-9_.:-]{8,128}$' },
    });
  }
  return {
    operationId: uc.operationId,
    summary: uc.summary,
    description: uc.description,
    tags: [uc.tag],
    security: [{ bearerAuth: [] }, { oauth2: [uc.requiredScope] }],
    'x-required-scope': uc.requiredScope,
    'x-required-module': uc.requiredModule,
    'x-idempotent': uc.idempotent,
    'x-mcp-tool': uc.toolName,
    ...(parameters.length ? { parameters } : {}),
    ...(requestBody ? { requestBody } : {}),
    responses: {
      [String(uc.successStatus)]: {
        description: 'Sucesso',
        headers: {
          'X-RateLimit-Limit': { $ref: '#/components/headers/X-RateLimit-Limit' },
          'X-RateLimit-Remaining': { $ref: '#/components/headers/X-RateLimit-Remaining' },
          'X-RateLimit-Reset': { $ref: '#/components/headers/X-RateLimit-Reset' },
        },
        content: { 'application/json': { schema: toSchema(uc.outputSchema, 'output') } },
      },
      '400': problemResponse('Entrada invalida ou campo nao permitido'),
      '401': problemResponse('Credencial ausente, invalida, expirada ou revogada'),
      '403': problemResponse('Escopo, modulo ou carteira insuficiente'),
      ...(uc.pathParams.length ? { '404': problemResponse('Nao encontrado (ou fora da carteira)') } : {}),
      ...(uc.mutation ? { '409': problemResponse('Conflito (Idempotency-Key reutilizada / registro travado)'), '422': problemResponse('Regra de negocio violada') } : {}),
      '429': problemResponse('Limite de requisicoes excedido (veja Retry-After)'),
      '503': problemResponse('Postgres indisponivel'),
    },
  };
}

export function buildOpenApiDocument(): JsonSchema {
  const paths: Record<string, Record<string, JsonSchema>> = {};
  for (const uc of INTEGRATION_USE_CASES) {
    paths[uc.path] = paths[uc.path] || {};
    paths[uc.path][uc.method.toLowerCase()] = operationFor(uc);
  }
  paths['/api/v1/openapi.json'] = {
    get: {
      operationId: 'openapi.get',
      summary: 'Especificacao OpenAPI 3.1 (autenticada)',
      tags: ['Meta'],
      security: [{ bearerAuth: [] }, { oauth2: ['openapi:read'] }],
      'x-required-scope': 'openapi:read',
      responses: {
        '200': { description: 'Documento OpenAPI 3.1', content: { 'application/json': { schema: { type: 'object' } } } },
        '401': problemResponse('Nao autenticado'),
        '403': problemResponse('Sem o escopo openapi:read'),
      },
    },
  };
  const sortedPaths: typeof paths = {};
  for (const k of Object.keys(paths).sort()) sortedPaths[k] = paths[k];
  const scopes: Record<string, string> = {};
  for (const s of INTEGRATION_SCOPES) scopes[s] = SCOPE_DESCRIPTIONS[s];
  return {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: 'STI-hub API v1 (Integracoes)',
      version: API_V1_VERSION,
      description:
        'API REST de integracoes do STI-hub (CRM e Chamados/SetaDesk). Autenticacao: Bearer stihub_int_* (chave de integracao do IAM) ou token OAuth 2.1 (PKCE S256). ' +
        'Carteira (PROPRIOS/EQUIPE/TODOS) e moduleAccess aplicados no servidor. Sem DELETE, merge, Sequencias, escrita Fiscal/Financeira ou GestaoClick nesta versao. ' +
        'Erros em application/problem+json (RFC 7807). Mesmos casos de uso disponiveis como tools no servidor MCP (/api/mcp).',
    },
    servers: [{ url: '/' }],
    tags: [
      { name: 'CRM', description: 'Contatos, empresas, negocios, atividades e pipelines' },
      { name: 'Chamados', description: 'SetaDesk: chamados TEC-/FIN-, comentarios e filas (dados mascarados)' },
      { name: 'Meta', description: 'Especificacao' },
    ],
    paths: sortedPaths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'Chave de integracao stihub_int_<prefixo>_<segredo> criada no IAM (exibida uma unica vez).' },
        oauth2: {
          type: 'oauth2',
          description: 'OAuth 2.1 com PKCE S256 obrigatorio e registro dinamico (RFC 7591).',
          flows: {
            authorizationCode: {
              authorizationUrl: '/api/oauth/authorize',
              tokenUrl: '/api/oauth/token',
              refreshUrl: '/api/oauth/token',
              scopes,
            },
          },
        },
      },
      headers: {
        'X-RateLimit-Limit': { schema: { type: 'integer' }, description: 'Limite por minuto' },
        'X-RateLimit-Remaining': { schema: { type: 'integer' }, description: 'Restante na janela' },
        'X-RateLimit-Reset': { schema: { type: 'integer' }, description: 'Segundos ate a nova janela' },
      },
      schemas: {
        Problem: {
          type: 'object',
          required: ['type', 'title', 'status', 'code'],
          properties: {
            type: { type: 'string' },
            title: { type: 'string' },
            status: { type: 'integer' },
            code: { type: 'string' },
            detail: { type: 'string' },
            fields: { type: 'array', items: { type: 'string' } },
            requiredScope: { type: 'string' },
            requestId: { type: 'string' },
          },
        },
      },
    },
  };
}

let cached: JsonSchema | null = null;
export function getOpenApiDocument(): JsonSchema {
  if (!cached) cached = buildOpenApiDocument();
  return cached;
}
