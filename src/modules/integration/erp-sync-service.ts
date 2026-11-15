// ============================================================================
// STI-hub — Chave de servico da sincronizacao diaria GestaoClick -> STI-hub (15/11/2026).
//
// POST /api/v1/erp/sync/run  (Authorization: Bearer stihub_sync_<base64url>)
//
// Escopo minimo: a chave so DISPARA o caso de uso ja existente de sincronizacao do ERP
// (runIncrementalDailySync -> syncLiveGestaoClick, merge nao destrutivo/idempotente pelos
// ids do GestaoClick, com as credenciais GestaoClick que ja estao no servidor). A chave NAO
// envia dados de negocio: o corpo aceita apenas { forceRefresh?: boolean } (Zod .strict()).
// Assim, um vazamento da chave nao permite injetar/alterar cadastros, financeiro, IAM ou
// permissoes — no maximo dispara a mesma sincronizacao que o botao "Sincronizar" do admin,
// limitada por rate-limit. Nao ha leitura de dados (resposta so com contagens) nem delete.
//
// Segredo: ERP_SYNC_SERVICE_KEY (atual) e ERP_SYNC_SERVICE_KEY_PREVIOUS (opcional, janela de
// rotacao). Comparacao por SHA-256 + crypto.timingSafeEqual nos dois slots (sem curto-circuito).
// Sem chave atual valida => 503 fail-closed. A chave nunca e logada; a auditoria grava so o
// fingerprint (8 primeiros hex do SHA-256) e o slot (current/previous).
// ============================================================================
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod/v4';
import { rateLimitIpKey } from '../../api/client-ip';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../../api/router';
import { checkRateLimit, audit, newRequestId } from './executor';
import { json, postgresUnavailable, problem, type IntegrationHttpRequest, type IntegrationHttpResponse } from './http';
import { resolveIntegrationDeps } from './runtime';
import type { IntegrationStore } from './store';
import { isIntegrationStoreUnavailable } from './store-errors';

export const ERP_SYNC_ROUTE = '/api/v1/erp/sync/run';
export const ERP_SYNC_KEY_ENV = 'ERP_SYNC_SERVICE_KEY';
export const ERP_SYNC_KEY_PREVIOUS_ENV = 'ERP_SYNC_SERVICE_KEY_PREVIOUS';
export const ERP_SYNC_KEY_PREFIX = 'stihub_sync_';
/** Prefixo + >= 32 bytes aleatorios em base64url (43 chars). */
export const ERP_SYNC_KEY_REGEX = /^stihub_sync_[A-Za-z0-9_-]{43,128}$/;
/** O corpo so carrega opcoes (sem dados de negocio): 4 KiB e mais que suficiente. */
export const ERP_SYNC_MAX_BODY_BYTES = 4 * 1024;
/** Cada execucao chama a API do GestaoClick (limite de 3 req/s): poucas por minuto bastam. */
export const ERP_SYNC_RATE_PER_KEY_PER_MINUTE = 6;
/** Toda tentativa (inclusive sem chave/chave errada) conta por IP. */
export const ERP_SYNC_RATE_PER_IP_PER_MINUTE = 30;
export const ERP_SYNC_AUDIT_ACTION = 'erp_sync.ingest';

export type ErpSyncKeySlot = 'current' | 'previous';

const sha256 = (v: string) => createHash('sha256').update(v, 'utf8').digest();

export function erpSyncKeyFingerprint(key: string): string {
  return sha256(key).toString('hex').slice(0, 8);
}

export interface ErpSyncKeyConfig {
  configured: boolean;
  current: Buffer | null;
  previous: Buffer | null;
}

/** Le os slots do ambiente. Valor fora do formato e ignorado (nunca ecoado). */
export function readErpSyncKeyConfig(env: NodeJS.ProcessEnv = process.env): ErpSyncKeyConfig {
  const cur = String(env[ERP_SYNC_KEY_ENV] || '').trim();
  const prev = String(env[ERP_SYNC_KEY_PREVIOUS_ENV] || '').trim();
  const current = ERP_SYNC_KEY_REGEX.test(cur) ? sha256(cur) : null;
  const previous = current && ERP_SYNC_KEY_REGEX.test(prev) && prev !== cur ? sha256(prev) : null;
  return { configured: current !== null, current, previous };
}

/** Compara nos dois slots em tempo constante (sempre executa as duas comparacoes). */
export function matchErpSyncKey(presented: string, cfg: ErpSyncKeyConfig): ErpSyncKeySlot | null {
  if (!cfg.current) return null;
  const formatOk = ERP_SYNC_KEY_REGEX.test(presented);
  const h = sha256(formatOk ? presented : `invalid:${presented.slice(0, 256)}`);
  const okCurrent = timingSafeEqual(h, cfg.current);
  const okPrevious = timingSafeEqual(h, cfg.previous || cfg.current) && cfg.previous !== null;
  if (!formatOk) return null;
  if (okCurrent) return 'current';
  if (okPrevious) return 'previous';
  return null;
}

/** "Bearer <token>" exato; qualquer outro formato => null. */
export function parseBearer(authorization: string | undefined): string | null {
  const m = String(authorization || '').trim().match(/^Bearer\s+(\S{1,512})$/i);
  return m ? m[1] : null;
}

export const ErpSyncRunInputSchema = z
  .object({
    /** true (padrao) ignora o cache de 2 min do snapshot GestaoClick. */
    forceRefresh: z.boolean().optional(),
  })
  .strict();

export interface ErpSyncRunResult {
  status: number;
  body: unknown;
}

export type ErpSyncRunner = (input: { forceRefresh: boolean }) => Promise<ErpSyncRunResult>;

let sharedRouter: CrmApiRouter | null = null;

/**
 * Runner de producao: o MESMO caso de uso do POST /api/erp/daily-sync (merge nao destrutivo
 * por id GestaoClick + gravacao no Postgres pelo pipeline do router). Caminho, metodo e corpo
 * sao fixos aqui — o portador da chave nao escolhe rota.
 */
export const defaultErpSyncRunner: ErpSyncRunner = async ({ forceRefresh }) => {
  if (!sharedRouter) sharedRouter = new CrmApiRouter();
  const res = await sharedRouter.dispatch({
    method: 'POST',
    path: '/api/erp/daily-sync',
    body: { forceRefresh },
    context: TRUSTED_INTERNAL_CONTEXT,
  });
  return { status: res.status, body: res.body };
};

let testRunner: ErpSyncRunner | null = null;
export function setErpSyncRunnerForTests(runner: ErpSyncRunner | null): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('setErpSyncRunnerForTests so pode ser usado com NODE_ENV=test.');
  testRunner = runner;
}

export interface ErpSyncDeps {
  store: IntegrationStore | null;
  now: () => Date;
  env: NodeJS.ProcessEnv;
  runner: ErpSyncRunner;
}

export function resolveErpSyncDeps(): ErpSyncDeps {
  const base = resolveIntegrationDeps();
  return {
    store: base.store,
    now: base.now,
    env: process.env,
    runner: (process.env.NODE_ENV === 'test' && testRunner) || defaultErpSyncRunner,
  };
}

const AUTH_HEADERS = { 'WWW-Authenticate': 'Bearer realm="stihub-erp-sync"' };

type SyncCounts = Record<string, number>;

function pickCounts(v: unknown): SyncCounts {
  const out: SyncCounts = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    if (/^[A-Za-z]{1,40}$/.test(k) && typeof n === 'number' && Number.isFinite(n)) out[k] = n;
  }
  return out;
}

/** Handler neutro (testavel sem Next). */
export async function handleErpSyncRun(req: IntegrationHttpRequest, deps: ErpSyncDeps = resolveErpSyncDeps()): Promise<IntegrationHttpResponse> {
  const startedAt = Date.now();
  const requestId = newRequestId();
  const path = ERP_SYNC_ROUTE;
  const ip = req.ip || 'sem-ip';

  if (req.method !== 'POST') {
    return problem(405, 'METHOD_NOT_ALLOWED', 'Metodo nao permitido. Use POST.', {}, { Allow: 'POST' });
  }

  const cfg = readErpSyncKeyConfig(deps.env);
  if (!cfg.configured) {
    console.error(`[erp-sync] ${ERP_SYNC_KEY_ENV} ausente ou fora do formato: rota bloqueada (503).`);
    return problem(503, 'ERP_SYNC_KEY_NOT_CONFIGURED', 'Sincronizacao via chave de servico indisponivel: chave nao configurada no servidor.', {}, { 'Retry-After': '300' });
  }
  const store = deps.store;
  if (!store) return postgresUnavailable();

  const auditBase = { requestId, channel: 'rest_v1' as const, authType: 'service_key' as const, action: ERP_SYNC_AUDIT_ACTION, path, ip, startedAt };

  try {
    // 1) Rate-limit por IP ANTES da autenticacao (freia forca bruta).
    const ipRate = await checkRateLimit(store, `erp_sync:ip:${rateLimitIpKey(ip)}`, ERP_SYNC_RATE_PER_IP_PER_MINUTE, deps.now());
    if (!ipRate.allowed) {
      await audit(store, { ...auditBase, statusCode: 429, errorCode: 'RATE_LIMITED_IP', now: deps.now() });
      return problem(429, 'RATE_LIMITED', 'Limite de requisicoes excedido.', {}, ipRate.headers);
    }

    // 2) Autenticacao: somente Bearer (cookie/sessao sao ignorados).
    const presented = parseBearer(req.headers.authorization);
    if (!presented) {
      await audit(store, { ...auditBase, statusCode: 401, errorCode: 'MISSING_BEARER', now: deps.now() });
      return problem(401, 'UNAUTHORIZED', 'Credencial ausente. Use Authorization: Bearer <chave de servico>.', {}, AUTH_HEADERS);
    }
    const slot = matchErpSyncKey(presented, cfg);
    if (!slot) {
      await audit(store, { ...auditBase, statusCode: 401, errorCode: 'INVALID_SERVICE_KEY', now: deps.now() });
      return problem(401, 'UNAUTHORIZED', 'Credencial invalida.', {}, AUTH_HEADERS);
    }
    const fingerprint = erpSyncKeyFingerprint(presented);
    const keyId = `erp_sync:${slot}:${fingerprint}`;
    const authed = { ...auditBase, keyId, scope: 'erp:sync:write', details: { fingerprint, slot } as Record<string, unknown> };

    // 3) Rate-limit por chave.
    const keyRate = await checkRateLimit(store, `erp_sync:key:${fingerprint}`, ERP_SYNC_RATE_PER_KEY_PER_MINUTE, deps.now());
    if (!keyRate.allowed) {
      await audit(store, { ...authed, statusCode: 429, errorCode: 'RATE_LIMITED_KEY', now: deps.now() });
      return problem(429, 'RATE_LIMITED', 'Limite de requisicoes excedido.', {}, keyRate.headers);
    }

    // 4) Corpo: vazio ou { forceRefresh?: boolean } estrito.
    let input: z.infer<typeof ErpSyncRunInputSchema> = {};
    if (req.body !== undefined) {
      const parsed = ErpSyncRunInputSchema.safeParse(req.body);
      if (!parsed.success) {
        await audit(store, { ...authed, statusCode: 400, errorCode: 'INVALID_BODY', now: deps.now() });
        return problem(400, 'INVALID_BODY', 'Corpo invalido: aceito apenas {} ou { "forceRefresh": boolean }. Dados de negocio nao sao aceitos nesta rota.', {}, keyRate.headers);
      }
      input = parsed.data;
    }

    // 5) Executa o caso de uso de gravacao da sync do ERP (unico efeito desta chave).
    const syncStarted = Date.now();
    const run = await deps.runner({ forceRefresh: input.forceRefresh !== false });
    const durationMs = Date.now() - syncStarted;
    const data = (run.body && typeof run.body === 'object' ? (run.body as { data?: Record<string, unknown> }).data : undefined) || {};
    const counts = pickCounts(data.counts);
    const last = (data.lastSyncEntry && typeof data.lastSyncEntry === 'object' ? data.lastSyncEntry : {}) as Record<string, unknown>;
    const liveSource = typeof last.id === 'string' && last.id.startsWith('sync-gc-live-');
    const recordsSynced = typeof last.recordsSynced === 'number' ? last.recordsSynced : null;

    if (run.status !== 200) {
      const status = run.status === 503 ? 503 : 502;
      await audit(store, { ...authed, statusCode: status, errorCode: `SYNC_FAILED_${run.status}`, details: { ...authed.details, durationMs, upstreamStatus: run.status }, now: deps.now() });
      return problem(status, 'ERP_SYNC_FAILED', 'A sincronizacao do ERP nao foi concluida. Tente novamente mais tarde.', {}, { ...keyRate.headers, ...(status === 503 ? { 'Retry-After': '60' } : {}) });
    }
    if (!liveSource) {
      await audit(store, { ...authed, statusCode: 502, errorCode: 'GESTAOCLICK_UNAVAILABLE', details: { ...authed.details, durationMs, counts }, now: deps.now() });
      return problem(502, 'GESTAOCLICK_UNAVAILABLE', 'GestaoClick indisponivel ou sem credenciais no servidor: nenhum dado novo foi importado.', {}, keyRate.headers);
    }

    await audit(store, { ...authed, statusCode: 200, details: { ...authed.details, durationMs, counts, recordsSynced, forceRefresh: input.forceRefresh !== false }, now: deps.now() });
    return json(
      200,
      {
        data: {
          status: 'SUCCESS',
          source: 'gestaoclick_live',
          syncedAt: typeof data.syncedAt === 'string' ? data.syncedAt : deps.now().toISOString(),
          storeId: typeof data.storeId === 'string' ? data.storeId : null,
          recordsSynced,
          counts,
          durationMs,
          requestId,
        },
      },
      keyRate.headers
    );
  } catch (err) {
    if (isIntegrationStoreUnavailable(err)) return postgresUnavailable();
    console.error('[erp-sync] erro nao tratado', (err as Error)?.name || 'Error');
    await audit(store, { ...auditBase, statusCode: 500, errorCode: 'INTERNAL_ERROR', now: deps.now() });
    return problem(500, 'INTERNAL_ERROR', 'Erro interno.');
  }
}
