// ============================================================================
// STI-hub — API v1 + MCP: dependencias de runtime.
// Store: Postgres (unico de runtime). Sem DATABASE_URL => null => 503 nas rotas.
// Testes: setIntegrationDepsForTests() (somente NODE_ENV=test) injeta store/porta de dados.
// ============================================================================
import { getPostgresPool, isPostgresEnabled } from '../../db/postgres';
import { CrmApiRouter } from '../../api/router';
import { RouterDataPort, type IntegrationDataPort } from './data-port';
import type { IntegrationStore } from './store';
import { PostgresIntegrationStore } from './store-postgres';

export interface IntegrationLimits {
  /** Requisicoes por minuto por credencial. */
  perCredentialPerMinute: number;
  /** Requisicoes por minuto por IP nas rotas OAuth publicas (register/token/revoke). */
  oauthPerIpPerMinute: number;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  authCodeTtlSeconds: number;
  idempotencyTtlSeconds: number;
}

export interface IntegrationDeps {
  store: IntegrationStore | null;
  createDataPort: () => IntegrationDataPort;
  now: () => Date;
  limits: IntegrationLimits;
}

const envInt = (name: string, def: number, min: number, max: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : def;
};

export function defaultLimits(): IntegrationLimits {
  return {
    perCredentialPerMinute: envInt('INTEGRATION_RATE_LIMIT_PER_MINUTE', 120, 1, 10_000),
    oauthPerIpPerMinute: envInt('INTEGRATION_OAUTH_RATE_LIMIT_PER_MINUTE', 30, 1, 1_000),
    accessTokenTtlSeconds: 3600,
    refreshTokenTtlSeconds: 30 * 24 * 3600,
    authCodeTtlSeconds: 300,
    idempotencyTtlSeconds: 24 * 3600,
  };
}

let sharedRouter: CrmApiRouter | null = null;
let pgStore: PostgresIntegrationStore | null = null;
let testDeps: Partial<IntegrationDeps> | null = null;

export function setIntegrationDepsForTests(deps: Partial<IntegrationDeps> | null): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('setIntegrationDepsForTests so pode ser usado com NODE_ENV=test.');
  }
  testDeps = deps;
}

export function resolveIntegrationDeps(): IntegrationDeps {
  const injected = process.env.NODE_ENV === 'test' ? testDeps : null;
  let store: IntegrationStore | null = null;
  if (injected && 'store' in injected) {
    store = injected.store ?? null;
  } else if (isPostgresEnabled()) {
    const pool = getPostgresPool();
    if (pool) {
      if (!pgStore) pgStore = new PostgresIntegrationStore(pool as unknown as ConstructorParameters<typeof PostgresIntegrationStore>[0]);
      store = pgStore;
    }
  }
  return {
    store,
    createDataPort:
      injected?.createDataPort ||
      (() => {
        if (!sharedRouter) sharedRouter = new CrmApiRouter();
        return new RouterDataPort(sharedRouter);
      }),
    now: injected?.now || (() => new Date()),
    limits: { ...defaultLimits(), ...(injected?.limits || {}) },
  };
}
