// ============================================================================
// STI-hub — API v1 + MCP: execucao de caso de uso (mesmo caminho para REST e MCP)
// + guardas transversais: rate-limit distribuido, idempotencia e auditoria.
// ============================================================================
import { applyOwnerCeiling, hasScope, type AuthContext } from './auth-context';
import { buildPortfolioView } from './portfolio';
import type { IntegrationDeps } from './runtime';
import type { AuditChannel, AuditAuthType, IntegrationStore } from './store';
import { generateId, sha256Hex } from './tokens';
import { UseCaseError, type UseCaseDefinition } from './use-cases';

export type ExecResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number; code: string; title: string; extra?: Record<string, unknown> };

/** Lista de campos com problema (sem ecoar valores enviados). */
function issueFields(issues: Array<{ code: string; path: PropertyKey[]; keys?: string[] }>): string[] {
  const out = new Set<string>();
  for (const i of issues) {
    if (i.code === 'unrecognized_keys' && Array.isArray(i.keys)) for (const k of i.keys) out.add(String(k).slice(0, 80));
    else out.add(i.path.map(String).join('.') || '(corpo)');
  }
  return [...out].slice(0, 50);
}

export async function executeUseCase(def: UseCaseDefinition, rawInput: unknown, auth: AuthContext, deps: IntegrationDeps): Promise<ExecResult> {
  if (!hasScope(auth, def.requiredScope)) {
    return { ok: false, status: 403, code: 'SCOPE_INSUFFICIENT', title: `Escopo insuficiente: exige ${def.requiredScope}.`, extra: { requiredScope: def.requiredScope } };
  }
  const parsed = def.inputSchema.safeParse(rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) ? rawInput : {});
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      code: 'VALIDATION_FAILED',
      title: 'Entrada invalida ou com campos nao permitidos.',
      extra: { fields: issueFields(parsed.error.issues as never) },
    };
  }
  try {
    const data = deps.createDataPort();
    const snap = await data.snapshot(def.domain);
    const ceiling = applyOwnerCeiling(auth, snap.users);
    if (!ceiling.ok) return { ok: false, status: ceiling.status, code: ceiling.code, title: ceiling.title };
    if (!hasScope(auth, def.requiredScope)) {
      return { ok: false, status: 403, code: 'MODULE_FORBIDDEN', title: `Modulo ${def.requiredModule} nao habilitado para esta credencial ou para o usuario dono.` };
    }
    const portfolio = buildPortfolioView(auth, snap.users);
    const out = await def.handler(parsed.data, { auth, data, owner: ceiling.owner, portfolio, allUsers: snap.users });
    const checked = def.outputSchema.safeParse(out);
    if (!checked.success) {
      return { ok: false, status: 500, code: 'OUTPUT_CONTRACT_VIOLATION', title: 'Resposta fora do contrato da API.' };
    }
    return { ok: true, status: def.successStatus, body: checked.data };
  } catch (err) {
    if (err instanceof UseCaseError) return { ok: false, status: err.status, code: err.code, title: err.title, extra: err.extra };
    console.error('[integration] falha no caso de uso', def.operationId, (err as Error)?.name || 'Error');
    return { ok: false, status: 500, code: 'INTERNAL_ERROR', title: 'Erro interno.' };
  }
}

// ---------------------------------------------------------------------------
// Rate-limit distribuido (janela fixa de 60s no Postgres, incremento atomico)
// ---------------------------------------------------------------------------
export interface RateDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  headers: Record<string, string>;
}

export async function checkRateLimit(store: IntegrationStore, bucket: string, limit: number, now: Date): Promise<RateDecision> {
  const windowMs = 60_000;
  const startMs = Math.floor(now.getTime() / windowMs) * windowMs;
  const r = await store.hitRateLimit(bucket, new Date(startMs).toISOString(), now.toISOString());
  const resetSeconds = Math.max(1, Math.ceil((startMs + windowMs - now.getTime()) / 1000));
  const remaining = Math.max(0, limit - r.count);
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Reset': String(resetSeconds),
  };
  const allowed = r.count <= limit;
  if (!allowed) headers['Retry-After'] = String(resetSeconds);
  return { allowed, limit, remaining, resetSeconds, headers };
}

export function credentialBucket(auth: AuthContext): string {
  return auth.authType === 'api_key' ? `key:${auth.keyId}` : `oauth:${auth.oauthClientId}:${auth.actorUserId}`;
}

// ---------------------------------------------------------------------------
// Idempotencia (Idempotency-Key em mutacoes; TTL 24h; 409 se payload diferente)
// ---------------------------------------------------------------------------
export const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9_.:-]{8,128}$/;

function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(',')}}`;
}

export type IdempotencyStart =
  | { kind: 'none' }
  | { kind: 'reserved'; actor: string; key: string }
  | { kind: 'replay'; status: number; body: unknown }
  | { kind: 'conflict'; code: 'IDEMPOTENCY_KEY_REUSED' | 'IDEMPOTENCY_IN_PROGRESS'; title: string }
  | { kind: 'invalid' };

export async function beginIdempotency(
  store: IntegrationStore,
  auth: AuthContext,
  key: string | undefined | null,
  method: string,
  path: string,
  body: unknown,
  deps: IntegrationDeps
): Promise<IdempotencyStart> {
  if (key === undefined || key === null || key === '') return { kind: 'none' };
  if (!IDEMPOTENCY_KEY_REGEX.test(key)) return { kind: 'invalid' };
  const actor = `${credentialBucket(auth)}`;
  const now = deps.now();
  const requestHash = sha256Hex(`${method.toUpperCase()} ${path}\n${canonicalJson(body)}`);
  const existing = await store.getIdempotency(actor, key, now.toISOString());
  const decide = (rec: { requestHash: string; statusCode: number; responseBody: unknown }): IdempotencyStart => {
    if (rec.requestHash !== requestHash) {
      return { kind: 'conflict', code: 'IDEMPOTENCY_KEY_REUSED', title: 'Idempotency-Key ja usada com outro payload/rota.' };
    }
    if (rec.statusCode === 0) return { kind: 'conflict', code: 'IDEMPOTENCY_IN_PROGRESS', title: 'Requisicao com esta Idempotency-Key ainda em processamento.' };
    return { kind: 'replay', status: rec.statusCode, body: rec.responseBody };
  };
  if (existing) return decide(existing);
  const reserved = await store.putIdempotency({
    actorScopeKey: actor,
    idempotencyKey: key,
    method: method.toUpperCase(),
    path,
    requestHash,
    statusCode: 0,
    responseBody: null,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + deps.limits.idempotencyTtlSeconds * 1000).toISOString(),
  });
  if (!reserved) {
    const again = await store.getIdempotency(actor, key, now.toISOString());
    return again ? decide(again) : { kind: 'conflict', code: 'IDEMPOTENCY_IN_PROGRESS', title: 'Requisicao com esta Idempotency-Key ainda em processamento.' };
  }
  return { kind: 'reserved', actor, key };
}

export async function finishIdempotency(store: IntegrationStore, start: IdempotencyStart, status: number, body: unknown): Promise<void> {
  if (start.kind !== 'reserved') return;
  if (status >= 500) await store.deleteIdempotency(start.actor, start.key).catch(() => undefined);
  else await store.completeIdempotency(start.actor, start.key, status, body).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Auditoria (nunca grava segredo/token/corpo)
// ---------------------------------------------------------------------------
export async function audit(
  store: IntegrationStore,
  e: {
    requestId: string;
    channel: AuditChannel;
    authType: AuditAuthType;
    auth?: AuthContext | null;
    actorUserId?: string | null;
    keyId?: string | null;
    oauthClientId?: string | null;
    scope?: string | null;
    action: string;
    path: string;
    statusCode: number;
    ip: string;
    startedAt: number;
    errorCode?: string | null;
    now: Date;
  }
): Promise<void> {
  try {
    await store.insertAudit({
      id: generateId('iaud'),
      requestId: e.requestId,
      channel: e.channel,
      authType: e.authType,
      keyId: e.keyId ?? e.auth?.keyId ?? null,
      oauthClientId: e.oauthClientId ?? e.auth?.oauthClientId ?? null,
      actorUserId: e.actorUserId ?? e.auth?.actorUserId ?? null,
      scope: e.scope ?? null,
      action: e.action.slice(0, 120),
      path: e.path.slice(0, 300),
      statusCode: e.statusCode,
      ipAddress: e.ip ? e.ip.slice(0, 64) : null,
      latencyMs: Math.max(0, Date.now() - e.startedAt),
      errorCode: e.errorCode ? e.errorCode.slice(0, 80) : null,
      createdAt: e.now.toISOString(),
    });
  } catch (err) {
    console.error('[integration] falha ao gravar auditoria', (err as Error)?.name || 'Error');
  }
}

export const newRequestId = () => generateId('req');
