// ============================================================================
// STI-hub — API v1 + MCP: tipos HTTP neutros (sem Next), para os handlers serem
// testados sem servidor e reaproveitados pelos route handlers do App Router.
// ============================================================================

export interface IntegrationHttpRequest {
  method: string;
  /** Caminho sem query (ex.: /api/v1/contacts/ct-1). */
  path: string;
  /** Headers com nome em minusculas. */
  headers: Record<string, string>;
  query: Record<string, string>;
  /** Corpo ja interpretado (JSON ou form-urlencoded). */
  body: unknown;
  /** Cookies relevantes (stihub_session). */
  cookies: Record<string, string>;
  ip: string;
  /** Origem publica (https://host) usada como issuer/resource do OAuth. */
  origin: string;
}

export interface IntegrationHttpResponse {
  status: number;
  headers: Record<string, string>;
  /** JSON (serializado pelo adaptador) — ignorado quando `redirect` existe. */
  body?: unknown;
  redirect?: string;
  /** Corpo HTML/texto simples (pagina de consentimento OAuth). */
  text?: string;
}

export const NO_STORE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

export function json(status: number, body: unknown, headers: Record<string, string> = {}): IntegrationHttpResponse {
  return { status, body, headers: { ...NO_STORE_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...headers } };
}

/** RFC 7807 — application/problem+json. Nunca ecoa segredo nem valor enviado. */
export function problem(
  status: number,
  code: string,
  title: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {}
): IntegrationHttpResponse {
  return {
    status,
    headers: { ...NO_STORE_HEADERS, 'Content-Type': 'application/problem+json; charset=utf-8', ...headers },
    body: { type: `urn:stihub:problem:${code.toLowerCase()}`, title, status, code, ...extra },
  };
}

export const POSTGRES_UNAVAILABLE_TITLE =
  'Integracoes indisponiveis: banco Postgres nao configurado ou inacessivel. Chaves, tokens, rate-limit e idempotencia nunca usam armazenamento local.';

export function postgresUnavailable(): IntegrationHttpResponse {
  return problem(503, 'INTEGRATION_STORE_UNAVAILABLE', POSTGRES_UNAVAILABLE_TITLE, {}, { 'Retry-After': '30' });
}

export function readSessionToken(req: IntegrationHttpRequest): string | null {
  return req.cookies.stihub_session || req.headers['x-stihub-session'] || null;
}
