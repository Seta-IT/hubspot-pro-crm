// ============================================================================
// STI-hub — API REST v1 (/api/v1/*): roteamento a partir do catalogo de casos de uso.
// Somente Bearer (chave de integracao ou token OAuth). Sessao do navegador so abre o
// /api/v1/openapi.json (leitura da especificacao). Erros RFC 7807.
// ============================================================================
import { authenticateBearer, hasScope, verifyMfaSession, type AuthContext } from './auth-context';
import { audit, beginIdempotency, checkRateLimit, credentialBucket, executeUseCase, finishIdempotency, newRequestId } from './executor';
import { json, postgresUnavailable, problem, readSessionToken, type IntegrationHttpRequest, type IntegrationHttpResponse } from './http';
import { getOpenApiDocument } from './openapi';
import { resolveIntegrationDeps, type IntegrationDeps } from './runtime';
import { INTEGRATION_USE_CASES, type UseCaseDefinition } from './use-cases';

interface CompiledRoute {
  uc: UseCaseDefinition;
  re: RegExp;
  params: string[];
  staticSegments: number;
}

const ROUTES: CompiledRoute[] = INTEGRATION_USE_CASES.map((uc) => {
  const params: string[] = [];
  const pattern = uc.path
    .split('/')
    .map((seg) => {
      const m = /^\{(\w+)\}$/.exec(seg);
      if (m) {
        params.push(m[1]);
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { uc, re: new RegExp(`^${pattern}$`), params, staticSegments: uc.path.split('/').filter((s) => s && !s.startsWith('{')).length };
}).sort((a, b) => b.staticSegments - a.staticSegments);

function matchRoute(method: string, path: string): { route: CompiledRoute; params: Record<string, string> } | { allow: string[] } | null {
  const allow = new Set<string>();
  for (const route of ROUTES) {
    const m = route.re.exec(path);
    if (!m) continue;
    if (route.uc.method !== method) {
      allow.add(route.uc.method);
      continue;
    }
    const params: Record<string, string> = {};
    route.params.forEach((p, i) => {
      try {
        params[p] = decodeURIComponent(m[i + 1]);
      } catch {
        params[p] = m[i + 1];
      }
    });
    return { route, params };
  }
  return allow.size ? { allow: [...allow].sort() } : null;
}

const withReq = (res: IntegrationHttpResponse, requestId: string, extra: Record<string, string> = {}): IntegrationHttpResponse => {
  res.headers = { ...res.headers, 'X-Request-Id': requestId, ...extra };
  if (res.body && typeof res.body === 'object' && String(res.headers['Content-Type'] || '').includes('problem+json')) {
    (res.body as Record<string, unknown>).requestId = requestId;
  }
  return res;
};

export async function handleRestV1(req: IntegrationHttpRequest, depsIn?: IntegrationDeps): Promise<IntegrationHttpResponse> {
  const deps = depsIn || resolveIntegrationDeps();
  const requestId = newRequestId();
  const startedAt = Date.now();
  const method = req.method.toUpperCase();
  const path = (req.path.replace(/\/+$/, '') || '/').replace(/\/{2,}/g, '/');
  const store = deps.store;
  if (!store) return withReq(postgresUnavailable(), requestId);
  if (path.includes('..') || path.includes('%2f') || path.includes('%2F')) {
    return withReq(problem(400, 'PATH_INVALID', 'Caminho invalido.'), requestId);
  }

  // --- OpenAPI protegido ---
  if (path === '/api/v1/openapi.json') {
    if (method !== 'GET') return withReq(problem(405, 'METHOD_NOT_ALLOWED', 'Metodo nao permitido.'), requestId, { Allow: 'GET' });
    const authz = req.headers['authorization'];
    let auth: AuthContext | null = null;
    if (authz) {
      const r = await authenticateBearer(store, authz, { channel: 'rest_v1', requestId, ip: req.ip, now: deps.now() });
      if (!r.ok) {
        await audit(store, { requestId, channel: 'rest_v1', authType: 'none', action: 'openapi.get', path, statusCode: r.status, ip: req.ip, startedAt, errorCode: r.code, now: deps.now() });
        return withReq(problem(r.status, r.code, r.title, {}, { 'WWW-Authenticate': 'Bearer realm="stihub-api-v1"' }), requestId);
      }
      auth = r.ctx;
      if (!hasScope(auth, 'openapi:read')) {
        await audit(store, { requestId, channel: 'rest_v1', authType: auth.authType, auth, scope: 'openapi:read', action: 'openapi.get', path, statusCode: 403, ip: req.ip, startedAt, errorCode: 'SCOPE_INSUFFICIENT', now: deps.now() });
        return withReq(problem(403, 'SCOPE_INSUFFICIENT', 'Escopo insuficiente: exige openapi:read.', { requiredScope: 'openapi:read' }), requestId);
      }
    } else {
      const s = verifyMfaSession(readSessionToken(req));
      if (!s.ok) {
        return withReq(
          problem(401, 'AUTH_REQUIRED', 'A especificacao OpenAPI exige autenticacao (Bearer com openapi:read ou sessao STI-hub com 2FA).', {}, { 'WWW-Authenticate': 'Bearer realm="stihub-api-v1"' }),
          requestId
        );
      }
    }
    await audit(store, { requestId, channel: 'rest_v1', authType: auth ? auth.authType : 'session', auth, scope: 'openapi:read', action: 'openapi.get', path, statusCode: 200, ip: req.ip, startedAt, now: deps.now() });
    return withReq(json(200, getOpenApiDocument()), requestId);
  }

  const matched = matchRoute(method, path);
  if (!matched) return withReq(problem(404, 'ROUTE_NOT_FOUND', 'Rota inexistente na API v1.'), requestId);
  if ('allow' in matched) {
    return withReq(problem(405, 'METHOD_NOT_ALLOWED', 'Metodo nao permitido nesta rota (DELETE e merge nao existem na v1).'), requestId, { Allow: matched.allow.join(', ') });
  }
  const { route, params } = matched;
  const uc = route.uc;

  const authResult = await authenticateBearer(store, req.headers['authorization'], { channel: 'rest_v1', requestId, ip: req.ip, now: deps.now() });
  if (!authResult.ok) {
    await audit(store, { requestId, channel: 'rest_v1', authType: 'none', action: uc.operationId, path, statusCode: authResult.status, ip: req.ip, startedAt, errorCode: authResult.code, now: deps.now() });
    return withReq(problem(authResult.status, authResult.code, authResult.title, {}, { 'WWW-Authenticate': 'Bearer realm="stihub-api-v1"' }), requestId);
  }
  const auth = authResult.ctx;

  const rate = await checkRateLimit(store, credentialBucket(auth), deps.limits.perCredentialPerMinute, deps.now());
  if (!rate.allowed) {
    await audit(store, { requestId, channel: 'rest_v1', authType: auth.authType, auth, scope: uc.requiredScope, action: uc.operationId, path, statusCode: 429, ip: req.ip, startedAt, errorCode: 'RATE_LIMITED', now: deps.now() });
    return withReq(problem(429, 'RATE_LIMITED', 'Limite de requisicoes excedido. Tente novamente apos Retry-After.', {}, rate.headers), requestId);
  }

  let input: Record<string, unknown>;
  if (uc.method === 'GET') {
    input = { ...req.query, ...params };
  } else {
    const body = req.body;
    if (body === undefined || body === null || typeof body !== 'object' || Array.isArray(body)) {
      return withReq(problem(400, 'BODY_INVALID', 'Corpo JSON (objeto) obrigatorio.', {}, rate.headers), requestId);
    }
    const clash = route.params.filter((p) => Object.prototype.hasOwnProperty.call(body, p));
    if (clash.length) return withReq(problem(400, 'VALIDATION_FAILED', 'Parametro de caminho nao pode vir no corpo.', { fields: clash }, rate.headers), requestId);
    input = { ...(body as Record<string, unknown>), ...params };
  }

  let idem: Awaited<ReturnType<typeof beginIdempotency>> = { kind: 'none' };
  if (uc.mutation) {
    idem = await beginIdempotency(store, auth, req.headers['idempotency-key'], method, path, input, deps);
    if (idem.kind === 'invalid') {
      return withReq(problem(400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key invalida (8-128 caracteres A-Z a-z 0-9 _ . : -).', {}, rate.headers), requestId);
    }
    if (idem.kind === 'conflict') {
      await audit(store, { requestId, channel: 'rest_v1', authType: auth.authType, auth, scope: uc.requiredScope, action: uc.operationId, path, statusCode: 409, ip: req.ip, startedAt, errorCode: idem.code, now: deps.now() });
      return withReq(problem(409, idem.code, idem.title, {}, rate.headers), requestId);
    }
    if (idem.kind === 'replay') {
      await audit(store, { requestId, channel: 'rest_v1', authType: auth.authType, auth, scope: uc.requiredScope, action: `${uc.operationId}:replay`, path, statusCode: idem.status, ip: req.ip, startedAt, now: deps.now() });
      return withReq(json(idem.status, idem.body), requestId, { ...rate.headers, 'Idempotent-Replayed': 'true' });
    }
  }

  const result = await executeUseCase(uc, input, auth, deps);
  const res = result.ok
    ? json(result.status, result.body, rate.headers)
    : problem(result.status, result.code, result.title, result.extra || {}, rate.headers);
  if (uc.mutation) await finishIdempotency(store, idem, res.status, res.body);
  await audit(store, {
    requestId,
    channel: 'rest_v1',
    authType: auth.authType,
    auth,
    scope: uc.requiredScope,
    action: uc.operationId,
    path,
    statusCode: res.status,
    ip: req.ip,
    startedAt,
    errorCode: result.ok ? null : result.code,
    now: deps.now(),
  });
  return withReq(res, requestId);
}
