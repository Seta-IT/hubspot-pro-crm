// ============================================================================
// STI-hub — API v1 + MCP: execucao de caso de uso (mesmo caminho para REST e MCP)
// + guardas transversais: rate-limit distribuido, idempotencia e auditoria.
// ============================================================================
import { applyOwnerCeiling, hasScope, type AuthContext } from './auth-context';
import { buildPortfolioView } from './portfolio';
import type { IntegrationDeps } from './runtime';
import type { AuditChannel, AuditAuthType, IntegrationStore } from './store';
import { randomBytes } from 'node:crypto';
import { generateId, sha256Hex } from './tokens';
import { isIntegrationStoreUnavailable } from './store-errors';
import { UseCaseError, type UseCaseDefinition } from './use-cases';
import type { ConfirmationPort, WriteAuditTrail } from './use-cases/types';
import { ownerMeetsScope } from './use-cases/common';

export type ExecResult =
  | { ok: true; status: number; body: unknown; audit?: WriteAuditTrail }
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
    if (def.dangerous) {
      // Lote 3: rate-limit mais apertado nas tools perigosas (prepare + commit somados).
      if (!deps.store) return { ok: false, status: 503, code: 'INTEGRATION_STORE_UNAVAILABLE', title: 'Armazenamento indisponivel (Postgres). Tente novamente.' };
      const rate = await checkRateLimit(deps.store, `danger:${credentialBucket(auth)}`, deps.limits.dangerousPerMinute, deps.now());
      if (!rate.allowed) {
        return { ok: false, status: 429, code: 'DANGEROUS_RATE_LIMITED', title: 'Limite de operacoes sensiveis por minuto atingido.', extra: { retryAfterSeconds: rate.resetSeconds, limit: rate.limit } };
      }
    }
    const portfolio = buildPortfolioView(auth, snap.users);
    const trail: WriteAuditTrail = {};
    const confirm = confirmationPort(auth, deps);
    const out = await def.handler(parsed.data, { auth, data, owner: ceiling.owner, portfolio, allUsers: snap.users, audit: trail, confirm });
    const checked = def.outputSchema.safeParse(out);
    if (!checked.success) {
      return { ok: false, status: 500, code: 'OUTPUT_CONTRACT_VIOLATION', title: 'Resposta fora do contrato da API.' };
    }
    return { ok: true, status: def.successStatus, body: checked.data, ...(trail.entity ? { audit: trail } : {}) };
  } catch (err) {
    if (err instanceof UseCaseError) return { ok: false, status: err.status, code: err.code, title: err.title, extra: err.extra };
    if (isIntegrationStoreUnavailable(err)) {
      return { ok: false, status: 503, code: 'INTEGRATION_STORE_UNAVAILABLE', title: 'Armazenamento indisponivel (Postgres). Tente novamente.' };
    }
    console.error('[integration] falha no caso de uso', def.operationId, (err as Error)?.name || 'Error');
    return { ok: false, status: 500, code: 'INTERNAL_ERROR', title: 'Erro interno.' };
  }
}

/**
 * Autorizacao viva ANTES de consultar/devolver o cache de idempotencia: escopo, dono ativo,
 * teto de carteira/modulos do dono (aplicado em `auth`) e alcada RBAC da area. Sem isso um
 * replay poderia devolver resposta apos revogacao de escopo/modulo ou com dono inativo.
 */
export async function preauthorizeUseCase(def: UseCaseDefinition, auth: AuthContext, deps: IntegrationDeps): Promise<ExecResult | null> {
  if (!hasScope(auth, def.requiredScope)) {
    return { ok: false, status: 403, code: 'SCOPE_INSUFFICIENT', title: `Escopo insuficiente: exige ${def.requiredScope}.`, extra: { requiredScope: def.requiredScope } };
  }
  try {
    const users = await deps.createDataPort().listUsers();
    const ceiling = applyOwnerCeiling(auth, users);
    if (!ceiling.ok) return { ok: false, status: ceiling.status, code: ceiling.code, title: ceiling.title };
    if (!hasScope(auth, def.requiredScope)) {
      return { ok: false, status: 403, code: 'MODULE_FORBIDDEN', title: `Modulo ${def.requiredModule} nao habilitado para esta credencial ou para o usuario dono.` };
    }
    if (!ownerMeetsScope(ceiling.owner, def.requiredScope)) {
      return { ok: false, status: 403, code: 'OWNER_ACCESS_INSUFFICIENT', title: 'O usuario dono desta credencial nao tem alcada para esta operacao.' };
    }
    return null;
  } catch (err) {
    if (isIntegrationStoreUnavailable(err)) {
      return { ok: false, status: 503, code: 'INTEGRATION_STORE_UNAVAILABLE', title: 'Armazenamento indisponivel (Postgres). Tente novamente.' };
    }
    throw err;
  }
}

/** Impressao digital da autorizacao efetiva (credencial, usuario, escopos, carteira, modulos, equipe). */
export function authFingerprint(auth: AuthContext): string {
  return sha256Hex(
    [
      auth.authType,
      auth.keyId || '',
      auth.oauthClientId || '',
      auth.actorUserId,
      [...auth.scopes].sort().join(' '),
      auth.portfolioScope,
      `crm=${auth.moduleAccess.crm ? 1 : 0};chamados=${auth.moduleAccess.chamados ? 1 : 0};erp=${auth.moduleAccess.erp ? 1 : 0}`,
      [...auth.teamMemberIds].sort().join(','),
    ].join('|')
  ).slice(0, 32);
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
// Lote 3: confirmacao em duas etapas (token de uso unico, 5 min, hash dos argumentos)
// ---------------------------------------------------------------------------
/** Principal do token: credencial + usuario + autorizacao efetiva (mudou escopo/carteira => invalido). */
export function confirmationPrincipal(auth: AuthContext): string {
  return `${credentialBucket(auth)}|${auth.actorUserId}|${authFingerprint(auth)}`;
}

export function confirmationArgsHash(operationId: string, args: Record<string, unknown>): string {
  const { confirmationToken: _t, ...rest } = args;
  return sha256Hex(`${operationId}\n${canonicalJson(rest)}`);
}

export function confirmationPort(auth: AuthContext, deps: IntegrationDeps): ConfirmationPort {
  const fail = (code: string, title: string) => new UseCaseError(409, code, title);
  return {
    async issue(operationId, args) {
      if (!deps.store) throw new UseCaseError(503, 'INTEGRATION_STORE_UNAVAILABLE', 'Armazenamento indisponivel (Postgres). Tente novamente.');
      const now = deps.now();
      const token = `stc_${randomBytes(32).toString('base64url')}`;
      const expiresAt = new Date(now.getTime() + deps.limits.confirmationTtlSeconds * 1000).toISOString();
      await deps.store.insertConfirmation({
        tokenHash: sha256Hex(token),
        operationId,
        argsHash: confirmationArgsHash(operationId, args),
        principalKey: confirmationPrincipal(auth),
        actorUserId: auth.actorUserId,
        createdAt: now.toISOString(),
        expiresAt,
        usedAt: null,
      });
      return { token, expiresAt };
    },
    async consume(operationId, args, token) {
      if (!deps.store) throw new UseCaseError(503, 'INTEGRATION_STORE_UNAVAILABLE', 'Armazenamento indisponivel (Postgres). Tente novamente.');
      if (typeof token !== 'string' || !/^stc_[A-Za-z0-9_-]{40,60}$/.test(token)) throw fail('CONFIRMATION_INVALID', 'Token de confirmacao invalido. Rode o *_prepare de novo.');
      const now = deps.now();
      const res = await deps.store.consumeConfirmation(sha256Hex(token), confirmationPrincipal(auth), now.toISOString());
      // Inexistente ou de outra credencial/usuario/autorizacao => mesmo erro (sem oraculo).
      if (!res) throw fail('CONFIRMATION_INVALID', 'Token de confirmacao invalido. Rode o *_prepare de novo.');
      if (res.alreadyUsed) throw fail('CONFIRMATION_USED', 'Token de confirmacao ja usado (uso unico). Rode o *_prepare de novo.');
      if (Date.parse(res.record.expiresAt) <= now.getTime()) throw fail('CONFIRMATION_EXPIRED', 'Token de confirmacao expirado (5 min). Rode o *_prepare de novo.');
      if (res.record.operationId !== operationId || res.record.argsHash !== confirmationArgsHash(operationId, args)) {
        throw fail('CONFIRMATION_ARGS_MISMATCH', 'Argumentos diferentes dos confirmados no *_prepare (token invalidado). Rode o *_prepare de novo.');
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Idempotencia (Idempotency-Key em mutacoes; TTL 24h; 409 se payload diferente)
// ---------------------------------------------------------------------------
export const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9_.:-]{8,128}$/;

export function canonicalJson(v: unknown): string {
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
  // Cache isolado por credencial + usuario + autorizacao efetiva: mudou escopo/carteira/modulo
  // (ou outra chave/usuario) => nao enxerga a resposta guardada e executa com autorizacao nova.
  const actor = `${credentialBucket(auth)}|${auth.actorUserId}|${authFingerprint(auth)}`;
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
    targetUserId?: string | null;
    details?: Record<string, unknown> | null;
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
      targetUserId: e.targetUserId ?? null,
      details: e.details ?? null,
      createdAt: e.now.toISOString(),
    });
  } catch (err) {
    console.error('[integration] falha ao gravar auditoria', (err as Error)?.name || 'Error');
  }
}

export const newRequestId = () => generateId('req');
