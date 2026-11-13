// ============================================================================
// STI-hub — API v1 + MCP: falhas de conectividade do Postgres (conexao recusada, DNS,
// timeout, servidor reiniciando, pool esgotado) => 503 INTEGRATION_STORE_UNAVAILABLE.
// Nunca 500 INTERNAL_ERROR e nunca fallback JSON/tmp.
// ============================================================================

export class IntegrationStoreUnavailableError extends Error {
  readonly code = 'INTEGRATION_STORE_UNAVAILABLE';
  constructor(message = 'Armazenamento de integracao (Postgres) indisponivel.') {
    super(message);
    this.name = 'IntegrationStoreUnavailableError';
  }
}

const NET_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EAI_FAIL',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'ECONNRESET',
  'ECONNABORTED',
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'ENETUNREACH',
  'ENETDOWN',
  'EPIPE',
  'ENOTCONN',
  'NET_BLOCKED_IN_TEST',
  // SQLSTATE: admin shutdown / crash shutdown / cannot connect now / too many connections
  '57P01',
  '57P02',
  '57P03',
  '53300',
]);

const MSG_RE =
  /(connection timeout|timeout exceeded when trying to connect|timed out|connection terminated|connect ECONN|getaddrinfo|Client has encountered a connection error|too many clients|the database system is (starting up|shutting down)|Connection refused|server closed the connection unexpectedly)/i;

function* chain(err: unknown, depth = 0): Generator<Record<string, unknown>> {
  if (!err || typeof err !== 'object' || depth > 5) return;
  const e = err as Record<string, unknown>;
  yield e;
  if (Array.isArray(e.errors)) for (const inner of e.errors) yield* chain(inner, depth + 1);
  if (e.cause) yield* chain(e.cause, depth + 1);
}

/** true para erro de conectividade/disponibilidade do Postgres (nao para erro de SQL/constraint). */
export function isPostgresConnectivityError(err: unknown): boolean {
  for (const e of chain(err)) {
    const code = typeof e.code === 'string' ? e.code : '';
    if (code && (NET_CODES.has(code) || /^08[0-9A-Z]{3}$/.test(code))) return true;
    if (typeof e.message === 'string' && MSG_RE.test(e.message)) return true;
  }
  return false;
}

export function isIntegrationStoreUnavailable(err: unknown): boolean {
  return err instanceof IntegrationStoreUnavailableError || isPostgresConnectivityError(err);
}
