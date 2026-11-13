// ============================================================================
// STI-hub — OAuth 2.1 + DCR para o servidor MCP remoto e a API v1.
//  - GET  /.well-known/oauth-authorization-server (RFC 8414)
//  - GET  /.well-known/oauth-protected-resource   (RFC 9728)
//  - POST /api/oauth/register  (RFC 7591; escopos bloqueados nunca concedidos)
//  - GET/POST /api/oauth/authorize (sessao STI-hub 2FA + consentimento; PKCE S256 obrigatorio)
//  - POST /api/oauth/token  (authorization_code + PKCE; refresh_token com rotacao e
//                            deteccao de reuso => revoga toda a concessao)
//  - POST /api/oauth/revoke (RFC 7009)
// Codigos, tokens e segredos de cliente: so SHA-256 no Postgres.
// ============================================================================
import { createHmac } from 'node:crypto';
import { resolveStiHubSigningSecret } from '../../app/lib/auth';
import { verifyMfaSession } from './auth-context';
import { audit, checkRateLimit, newRequestId } from './executor';
import { json, NO_STORE_HEADERS, postgresUnavailable, readSessionToken, type IntegrationHttpRequest, type IntegrationHttpResponse } from './http';
import { isProductionRuntime, resolveIntegrationDeps, type IntegrationDeps } from './runtime';
import { scopesAboveUserAccess } from './use-cases/common';
import type { IntegrationUser } from './data-port';
import {
  INTEGRATION_SCOPES,
  isPortfolioScope,
  moduleForScope,
  narrowestPortfolio,
  sanitizeRuntimeScopes,
  SCOPE_DESCRIPTIONS,
  splitScopeInput,
  validateRequestedScopes,
  type PortfolioScope,
} from './scopes';
import type { IntegrationStore, OAuthClientRecord, OAuthTokenRecord } from './store';
import {
  constantTimeHexEqual,
  generateId,
  generateOAuthAccessToken,
  generateOAuthClientId,
  generateOAuthClientSecret,
  generateOAuthCode,
  generateOAuthRefreshToken,
  OAUTH_CODE_REGEX,
  OAUTH_REFRESH_REGEX,
  OAUTH_ACCESS_REGEX,
  PKCE_CHALLENGE_REGEX,
  PKCE_VERIFIER_REGEX,
  pkceS256,
  sha256Hex,
} from './tokens';

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: [...INTEGRATION_SCOPES],
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${origin}/api/v1/openapi.json`,
  };
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: [...INTEGRATION_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'STI-hub MCP / API v1',
    resource_documentation: `${origin}/api/v1/openapi.json`,
  };
}

export function handleWellKnown(req: IntegrationHttpRequest): IntegrationHttpResponse {
  const p = req.path.replace(/\/+$/, '');
  if (req.method.toUpperCase() !== 'GET') return json(405, { error: 'method_not_allowed' }, { Allow: 'GET' });
  const cache = { 'Cache-Control': 'public, max-age=300' };
  if (p === '/.well-known/oauth-authorization-server' || p.startsWith('/.well-known/oauth-authorization-server/')) {
    return { ...json(200, authorizationServerMetadata(req.origin)), headers: { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', ...cache } };
  }
  if (p === '/.well-known/oauth-protected-resource' || p.startsWith('/.well-known/oauth-protected-resource/')) {
    return { ...json(200, protectedResourceMetadata(req.origin)), headers: { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', ...cache } };
  }
  return json(404, { error: 'not_found' });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const oauthError = (status: number, error: string, description: string, headers: Record<string, string> = {}) =>
  json(status, { error, error_description: description }, headers);

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

/** https; http so em loopback; esquema privado so se reverso-dominio (RFC 8252) ou allowlist de env. */
export function isAllowedRedirectUri(raw: string): boolean {
  if (typeof raw !== 'string' || raw.length > 500 || raw.includes('*') || /\s/.test(raw)) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.username || u.password) return false;
  const scheme = u.protocol.replace(/:$/, '').toLowerCase();
  if (scheme === 'https') return true;
  if (scheme === 'http') return isLoopbackHost(u.hostname.toLowerCase());
  if (['javascript', 'data', 'file', 'vbscript', 'blob', 'about', 'ftp', 'ws', 'wss'].includes(scheme)) return false;
  const extra = String(process.env.OAUTH_ALLOWED_REDIRECT_SCHEMES || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return scheme.includes('.') || extra.includes(scheme);
}

function redirectSchemeOf(raw: string): string {
  try {
    return new URL(raw).protocol.replace(/:$/, '').toLowerCase();
  } catch {
    return '';
  }
}

/** Entradas de OAUTH_ALLOWED_REDIRECT_HOSTS: hostname (claude.ai), origem (https://x.y:8443) ou esquema (cursor:). */
export function parseAllowedRedirectHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  return String(env.OAUTH_ALLOWED_REDIRECT_HOSTS || '')
    .split(',')
    .map((x) => x.trim().toLowerCase().replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * Registro dinamico (DCR): alem de isAllowedRedirectUri, em PRODUCAO (NODE_ENV=production ou
 * VERCEL=1) toda redirect_uri que nao seja loopback precisa casar com OAUTH_ALLOWED_REDIRECT_HOSTS.
 * Allowlist vazia em producao => so loopback (clientes nativos locais).
 */
export function isRedirectUriAllowedForRegistration(raw: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isAllowedRedirectUri(raw)) return false;
  if (!isProductionRuntime(env)) return true;
  const u = new URL(raw);
  const scheme = redirectSchemeOf(raw);
  if (scheme === 'http' && isLoopbackHost(u.hostname.toLowerCase())) return true;
  const allow = parseAllowedRedirectHosts(env);
  if (allow.length === 0) return false;
  if (scheme === 'https') {
    const host = u.hostname.toLowerCase();
    const origin = u.origin.toLowerCase();
    return allow.includes(host) || allow.includes(origin);
  }
  return allow.includes(`${scheme}:`);
}

/** Fonte CSP (form-action) para a redirect_uri ja validada: origem https/http ou esquema privado. */
export function cspSourceForRedirect(redirectUri: string): string | null {
  try {
    const u = new URL(redirectUri);
    const scheme = u.protocol.replace(/:$/, '').toLowerCase();
    if (scheme === 'https' || scheme === 'http') return u.origin;
    return /^[a-z][a-z0-9+.-]*$/.test(scheme) ? `${scheme}:` : null;
  } catch {
    return null;
  }
}

function clientIpBucket(req: IntegrationHttpRequest, what: string) {
  return `oauth-ip:${what}:${(req.ip || 'sem-ip').slice(0, 64)}`;
}

function formOrJson(body: unknown): Record<string, string> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
  }
  return out;
}

/** Autenticacao do cliente no token/revoke conforme o metodo registrado. */
async function authenticateClient(
  store: IntegrationStore,
  req: IntegrationHttpRequest,
  params: Record<string, string>
): Promise<{ ok: true; client: OAuthClientRecord } | { ok: false; res: IntegrationHttpResponse }> {
  let clientId = params.client_id || '';
  let secret: string | null = params.client_secret || null;
  let viaBasic = false;
  const authz = req.headers['authorization'] || '';
  const invalid = { ok: false as const, res: oauthError(401, 'invalid_client', 'Cliente invalido.', { 'WWW-Authenticate': 'Basic realm="stihub-oauth"' }) };
  if (/^Basic\b/i.test(authz)) {
    // Header Basic malformado (base64/percent-encoding invalido, sem ":") => 401 invalid_client, nunca 500.
    const basic = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(authz);
    if (!basic) return invalid;
    const decoded = Buffer.from(basic[1], 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx <= 0) return invalid;
    try {
      clientId = decodeURIComponent(decoded.slice(0, idx));
      secret = decodeURIComponent(decoded.slice(idx + 1));
    } catch {
      return invalid;
    }
    viaBasic = true;
  }
  if (!/^stihub_ocl_[0-9a-f]{32}$/.test(clientId)) return invalid;
  const client = await store.getOAuthClient(clientId);
  if (!client || client.revokedAt) return invalid;
  if (client.tokenEndpointAuthMethod === 'none') {
    // Cliente publico: nao aceita Basic nem segredo.
    if (secret || viaBasic) return invalid;
    return { ok: true, client };
  }
  if (!secret || !client.clientSecretHash) return invalid;
  if (client.tokenEndpointAuthMethod === 'client_secret_basic' && !viaBasic) return invalid;
  if (client.tokenEndpointAuthMethod === 'client_secret_post' && viaBasic) return invalid;
  if (!constantTimeHexEqual(sha256Hex(secret), client.clientSecretHash)) return invalid;
  return { ok: true, client };
}

export interface ConsentBinding {
  sessionToken: string;
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  codeChallenge: string;
}

/** HMAC do consentimento: sessao + cliente + redirect_uri + escopos (ordenados) + code_challenge + emissao. */
export function csrfFor(b: ConsentBinding, issuedAt: number): string {
  const scopes = [...new Set(b.scopes)].sort().join(' ');
  const mac = createHmac('sha256', `${resolveStiHubSigningSecret()}::oauth-consent:v2`)
    .update([sha256Hex(b.sessionToken), b.clientId, b.redirectUri, scopes, b.codeChallenge, String(issuedAt)].join('\n'))
    .digest('base64url');
  return `${issuedAt}.${mac}`;
}

export function verifyCsrf(token: string, b: ConsentBinding, now: number): boolean {
  const [ts, mac, extra] = String(token || '').split('.');
  const issuedAt = Number(ts);
  if (extra !== undefined || !/^\d{10,16}$/.test(ts || '')) return false;
  if (!Number.isFinite(issuedAt) || !mac || now - issuedAt > 10 * 60_000 || issuedAt - now > 60_000) return false;
  const expected = csrfFor(b, issuedAt);
  return constantTimeHexEqual(expected, `${ts}.${mac}`);
}

const escapeHtml = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

function redirectWith(redirectUri: string, params: Record<string, string | undefined>): IntegrationHttpResponse {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, v);
  return { status: 302, headers: { ...NO_STORE_HEADERS }, redirect: u.toString() };
}

function htmlPage(status: number, title: string, inner: string, formActionExtra: string | null = null, extraHeaders: Record<string, string> = {}): IntegrationHttpResponse {
  // form-action precisa incluir a origem da redirect_uri validada: o POST do consentimento
  // responde 302 para ela e Chrome/Firefox aplicam form-action tambem ao redirect.
  const formAction = ["'self'", ...(formActionExtra ? [formActionExtra] : [])].join(' ');
  return {
    status,
    headers: {
      ...NO_STORE_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; form-action ${formAction}; frame-ancestors 'none'; base-uri 'none'`,
      ...extraHeaders,
    },
    text: `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;color:#1f2937}h1{font-size:20px}li{margin:4px 0}button{padding:10px 18px;margin-right:8px;border-radius:6px;border:1px solid #d1d5db;cursor:pointer}.ok{background:#d9541e;color:#fff;border-color:#d9541e}code{background:#f3f4f6;padding:1px 4px;border-radius:4px}.warn{background:#fef3c7;border:1px solid #f59e0b;padding:10px 12px;border-radius:6px}.host{font-size:18px;font-weight:700;color:#b91c1c;word-break:break-all}.write{color:#b91c1c;font-weight:700}</style></head><body>${inner}</body></html>`,
  };
}

interface AuthorizeParams {
  responseType: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string;
}

function readAuthorizeParams(p: Record<string, string>): AuthorizeParams {
  return {
    responseType: p.response_type || '',
    clientId: p.client_id || '',
    redirectUri: p.redirect_uri || '',
    scope: p.scope || '',
    state: (p.state || '').slice(0, 500),
    codeChallenge: p.code_challenge || '',
    codeChallengeMethod: p.code_challenge_method || '',
    resource: p.resource || '',
  };
}

type AuthorizeValidation =
  | { ok: true; client: OAuthClientRecord; scopes: string[] }
  | { ok: false; res: IntegrationHttpResponse };

async function validateAuthorize(store: IntegrationStore, a: AuthorizeParams, origin: string): Promise<AuthorizeValidation> {
  // Sem cliente/redirect validos NAO redireciona (evita open redirect).
  const client = /^stihub_ocl_[0-9a-f]{32}$/.test(a.clientId) ? await store.getOAuthClient(a.clientId) : null;
  if (!client || client.revokedAt) return { ok: false, res: htmlPage(400, 'Cliente invalido', '<h1>Cliente OAuth invalido ou revogado.</h1>') };
  const redirectUri = a.redirectUri || (client.redirectUris.length === 1 ? client.redirectUris[0] : '');
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
    return { ok: false, res: htmlPage(400, 'redirect_uri invalida', '<h1>redirect_uri nao registrada para este cliente.</h1>') };
  }
  a.redirectUri = redirectUri;
  const err = (error: string, description: string) => ({
    ok: false as const,
    res: redirectWith(redirectUri, { error, error_description: description, state: a.state, iss: origin }),
  });
  if (a.responseType !== 'code') return err('unsupported_response_type', 'Somente response_type=code.');
  if (a.codeChallengeMethod !== 'S256' || !PKCE_CHALLENGE_REGEX.test(a.codeChallenge)) {
    return err('invalid_request', 'PKCE obrigatorio: code_challenge (S256) e code_challenge_method=S256.');
  }
  if (a.resource && a.resource !== `${origin}/api/mcp` && a.resource !== origin && a.resource !== `${origin}/api/v1`) {
    return err('invalid_target', 'resource desconhecido.');
  }
  const requested = a.scope ? validateRequestedScopes(a.scope) : { ok: true as const, scopes: splitScopeInput(client.scope) };
  if (!requested.ok) return err('invalid_scope', 'Escopo invalido ou bloqueado.');
  const allowedByClient = new Set(splitScopeInput(client.scope));
  const scopes = sanitizeRuntimeScopes(requested.scopes);
  if (scopes.length === 0 || (allowedByClient.size > 0 && scopes.some((s) => !allowedByClient.has(s)))) {
    return err('invalid_scope', 'Escopo fora do registrado para o cliente.');
  }
  return { ok: true, client, scopes };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
export async function handleOAuth(req: IntegrationHttpRequest, depsIn?: IntegrationDeps): Promise<IntegrationHttpResponse> {
  const deps = depsIn || resolveIntegrationDeps();
  const store = deps.store;
  if (!store) return postgresUnavailable();
  const action = req.path.replace(/\/+$/, '').split('/').pop() || '';
  const method = req.method.toUpperCase();
  const requestId = newRequestId();
  const startedAt = Date.now();
  const done = async (res: IntegrationHttpResponse, extra: { clientId?: string | null; userId?: string | null; errorCode?: string | null; scope?: string | null } = {}) => {
    await audit(store, {
      requestId,
      channel: 'oauth',
      authType: extra.userId ? 'session' : 'none',
      oauthClientId: extra.clientId ?? null,
      actorUserId: extra.userId ?? null,
      scope: extra.scope ?? null,
      action: `oauth.${action}`,
      path: req.path,
      statusCode: res.status,
      ip: req.ip,
      startedAt,
      errorCode: extra.errorCode ?? (res.status >= 400 ? String((res.body as { error?: string })?.error || 'error') : null),
      now: deps.now(),
    });
    return res;
  };

  if (action === 'authorize') return handleAuthorize(req, store, deps, done);

  if (method !== 'POST') return json(405, { error: 'method_not_allowed' }, { Allow: 'POST' });
  const rate = await checkRateLimit(store, clientIpBucket(req, action), deps.limits.oauthPerIpPerMinute, deps.now());
  if (!rate.allowed) return done(json(429, { error: 'rate_limited', error_description: 'Muitas requisicoes.' }, rate.headers), { errorCode: 'RATE_LIMITED' });

  if (action === 'register') return done(await handleRegister(req, store, deps));
  if (action === 'token') {
    const r = await handleToken(req, store, deps);
    return done(r.res, { clientId: r.clientId, userId: r.userId });
  }
  if (action === 'revoke') {
    const r = await handleRevoke(req, store, deps);
    return done(r.res, { clientId: r.clientId });
  }
  return json(404, { error: 'not_found' });
}

async function handleRegister(req: IntegrationHttpRequest, store: IntegrationStore, deps: IntegrationDeps): Promise<IntegrationHttpResponse> {
  const b = (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null) as Record<string, unknown> | null;
  if (!b) return oauthError(400, 'invalid_client_metadata', 'Corpo JSON obrigatorio.');
  const redirectUris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String) : [];
  if (redirectUris.length === 0 || redirectUris.length > 10 || !redirectUris.every(isAllowedRedirectUri)) {
    return oauthError(400, 'invalid_redirect_uri', 'redirect_uris obrigatorias: https, http somente em loopback, sem fragmento/curinga.');
  }
  if (!redirectUris.every((u) => isRedirectUriAllowedForRegistration(u))) {
    return oauthError(400, 'invalid_redirect_uri', 'redirect_uri fora da allowlist de producao (OAUTH_ALLOWED_REDIRECT_HOSTS); somente loopback e hosts aprovados.');
  }
  const grantTypes = Array.isArray(b.grant_types) ? b.grant_types.map(String) : ['authorization_code', 'refresh_token'];
  if (!grantTypes.includes('authorization_code') || grantTypes.some((g) => g !== 'authorization_code' && g !== 'refresh_token')) {
    return oauthError(400, 'invalid_client_metadata', 'grant_types permitidos: authorization_code e refresh_token.');
  }
  const responseTypes = Array.isArray(b.response_types) ? b.response_types.map(String) : ['code'];
  if (responseTypes.length !== 1 || responseTypes[0] !== 'code') return oauthError(400, 'invalid_client_metadata', 'response_types: somente code.');
  const method = String(b.token_endpoint_auth_method || 'none');
  if (!['none', 'client_secret_post', 'client_secret_basic'].includes(method)) {
    return oauthError(400, 'invalid_client_metadata', 'token_endpoint_auth_method nao suportado.');
  }
  let scope = '';
  if (b.scope !== undefined) {
    const v = validateRequestedScopes(b.scope);
    if (!v.ok) return oauthError(400, 'invalid_client_metadata', v.code === 'SCOPE_BLOCKED' ? 'Escopo bloqueado pela politica de seguranca.' : 'Escopo desconhecido.');
    scope = v.scopes.join(' ');
  } else {
    // Sem scope: cliente pode pedir qualquer escopo do catalogo (o usuario consente cada um).
    scope = INTEGRATION_SCOPES.join(' ');
  }
  const clientName = String(b.client_name || 'Cliente MCP').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 120) || 'Cliente MCP';
  const now = deps.now();
  const clientId = generateOAuthClientId();
  const secret = method === 'none' ? null : generateOAuthClientSecret();
  const rec: OAuthClientRecord = {
    clientId,
    clientSecretHash: secret ? sha256Hex(secret) : null,
    clientName,
    redirectUris,
    grantTypes,
    responseTypes,
    scope,
    tokenEndpointAuthMethod: method as OAuthClientRecord['tokenEndpointAuthMethod'],
    createdByIp: req.ip ? req.ip.slice(0, 64) : null,
    createdAt: now.toISOString(),
    revokedAt: null,
  };
  await store.insertOAuthClient(rec);
  return json(201, {
    client_id: clientId,
    client_id_issued_at: Math.floor(now.getTime() / 1000),
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: grantTypes,
    response_types: responseTypes,
    token_endpoint_auth_method: method,
    scope,
  });
}

/** Teto vivo do usuario (cadastro do IAM) aplicado sobre as claims da sessao. */
interface LiveCeiling {
  user: IntegrationUser;
  portfolio: PortfolioScope;
  moduleAccess: { crm: boolean; chamados: boolean };
}

const CLEAR_SESSION_COOKIE = 'stihub_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax';

/** Opcoes de carteira no consentimento OAuth: sem lista de equipe => nunca EQUIPE (decisao CISO). */
export function oauthPortfolioOptions(ceiling: PortfolioScope): PortfolioScope[] {
  return ceiling === 'TODOS' ? ['PROPRIOS', 'TODOS'] : ['PROPRIOS'];
}

async function handleAuthorize(
  req: IntegrationHttpRequest,
  store: IntegrationStore,
  deps: IntegrationDeps,
  done: (res: IntegrationHttpResponse, extra?: { clientId?: string | null; userId?: string | null; errorCode?: string | null; scope?: string | null }) => Promise<IntegrationHttpResponse>
): Promise<IntegrationHttpResponse> {
  const method = req.method.toUpperCase();
  if (method !== 'GET' && method !== 'POST') return json(405, { error: 'method_not_allowed' }, { Allow: 'GET, POST' });
  // Rate-limit por IP tambem no authorize (GET e POST).
  const rate = await checkRateLimit(store, clientIpBucket(req, 'authorize'), deps.limits.oauthPerIpPerMinute, deps.now());
  if (!rate.allowed) {
    return done(htmlPage(429, 'Muitas requisicoes', '<h1>Muitas tentativas de autorizacao. Aguarde e tente novamente.</h1>', null, rate.headers), { errorCode: 'RATE_LIMITED' });
  }
  const source = method === 'GET' ? req.query : formOrJson(req.body);
  const a = readAuthorizeParams(source);
  const v = await validateAuthorize(store, a, req.origin);
  if (!v.ok) return done(v.res, { clientId: a.clientId || null, errorCode: 'authorize_invalid' });
  const formActionSrc = cspSourceForRedirect(a.redirectUri);

  const sessionToken = readSessionToken(req);
  const session = verifyMfaSession(sessionToken);
  if (!session.ok || !session.claims || !sessionToken) {
    if (method === 'POST') return done(htmlPage(401, 'Sessao expirada', '<h1>Sessao STI-hub expirada. Entre novamente.</h1>'), { clientId: a.clientId, errorCode: 'login_required' });
    const qs = new URLSearchParams(req.query).toString();
    const next = `/api/oauth/authorize?${qs}`;
    return { status: 302, headers: { ...NO_STORE_HEADERS }, redirect: `${req.origin}/login?next=${encodeURIComponent(next)}` };
  }
  const claims = session.claims;

  // --- Teto VIVO do usuario (cadastro no Postgres via porta de dados), nao so as claims assinadas.
  const users = await deps.createDataPort().listUsers();
  const user = users.find((u) => u.id === claims.uid);
  if (!user || user.active === false) {
    // Usuario removido/inativo: nega e encerra a sessao neste navegador.
    return done(
      htmlPage(403, 'Acesso negado', '<h1>Usuario inativo ou removido. Acesso negado.</h1>', null, { 'Set-Cookie': CLEAR_SESSION_COOKIE }),
      { clientId: v.client.clientId, userId: claims.uid, errorCode: 'user_inactive' }
    );
  }
  const claimsPortfolio: PortfolioScope = isPortfolioScope(claims.scope) ? claims.scope : 'PROPRIOS';
  const live: LiveCeiling = {
    user,
    portfolio: narrowestPortfolio(claimsPortfolio, user.portfolioScope),
    moduleAccess: {
      crm: claims.moduleAccess?.crm === true && user.moduleAccess.crm,
      chamados: claims.moduleAccess?.chamados === true && user.moduleAccess.chamados,
    },
  };
  // RBAC no consentimento: escopos de modulo desabilitado ou acima da alcada do usuario => invalid_scope.
  const moduleDenied = v.scopes.filter((s) => {
    const mod = moduleForScope(s as never);
    return (mod === 'crm' && !live.moduleAccess.crm) || (mod === 'chamados' && !live.moduleAccess.chamados);
  });
  const aboveAccess = scopesAboveUserAccess(v.scopes, user);
  if (moduleDenied.length || aboveAccess.length) {
    return done(
      redirectWith(a.redirectUri, {
        error: 'invalid_scope',
        error_description: 'Escopo acima do perfil (modulos/alcada) do usuario.',
        state: a.state,
        iss: req.origin,
      }),
      { clientId: v.client.clientId, userId: claims.uid, errorCode: 'scope_above_user_rbac' }
    );
  }
  const binding: ConsentBinding = {
    sessionToken,
    clientId: v.client.clientId,
    redirectUri: a.redirectUri,
    scopes: v.scopes,
    codeChallenge: a.codeChallenge,
  };
  const options = oauthPortfolioOptions(live.portfolio);

  if (method === 'GET') {
    const csrf = csrfFor(binding, deps.now().getTime());
    const hidden = Object.entries({
      response_type: 'code',
      client_id: v.client.clientId,
      redirect_uri: a.redirectUri,
      scope: v.scopes.join(' '),
      state: a.state,
      code_challenge: a.codeChallenge,
      code_challenge_method: 'S256',
      resource: a.resource,
      csrf,
    })
      .map(([k, val]) => `<input type="hidden" name="${k}" value="${escapeHtml(val)}">`)
      .join('');
    const scopesHtml = v.scopes
      .map((s) => {
        const isWrite = s.endsWith(':write');
        const label = `<code>${escapeHtml(s)}</code> — ${escapeHtml(SCOPE_DESCRIPTIONS[s as keyof typeof SCOPE_DESCRIPTIONS] || '')}`;
        return isWrite ? `<li class="write">&#9888; ESCRITA: ${label}</li>` : `<li>${label}</li>`;
      })
      .join('');
    let redirectHost = a.redirectUri;
    try {
      const u = new URL(a.redirectUri);
      redirectHost = u.host || `${u.protocol}`;
    } catch {
      /* validada antes */
    }
    const portfolioOptions = options.map((p) => `<option value="${p}"${p === 'PROPRIOS' ? ' selected' : ''}>${p}</option>`).join('');
    return done(
      htmlPage(
        200,
        'Autorizar integracao',
        `<h1>Autorizar "${escapeHtml(v.client.clientName)}"</h1>
<div class="warn"><b>Atencao: cliente dinamico NAO verificado.</b> O nome acima foi informado pelo proprio aplicativo e nao foi verificado pela Seta.
Os dados e o codigo de acesso serao enviados para:<div class="host">${escapeHtml(redirectHost)}</div>
Autorize somente se voce reconhece este endereco.</div>
<p>Conectado como <b>${escapeHtml(claims.email)}</b>. O aplicativo tera acesso, em seu nome, a:</p><ul>${scopesHtml}</ul>
<p>Sem exclusao, merge, sequencias, fiscal/financeiro ou administracao.</p>
<form method="post" action="/api/oauth/authorize">${hidden}
<p><label>Carteira: <select name="portfolio_scope">${portfolioOptions}</select></label></p>
<button class="ok" type="submit" name="decision" value="approve">Autorizar</button><button type="submit" name="decision" value="deny">Negar</button></form>`,
        formActionSrc
      ),
      { clientId: v.client.clientId, userId: claims.uid, scope: v.scopes.join(' ') }
    );
  }

  // POST (consentimento) — CSRF vinculado a sessao, cliente, redirect_uri, escopos e code_challenge.
  if (!verifyCsrf(source.csrf || '', binding, deps.now().getTime())) {
    return done(htmlPage(403, 'Requisicao invalida', '<h1>Formulario expirado ou invalido. Recomece a autorizacao.</h1>'), {
      clientId: v.client.clientId,
      userId: claims.uid,
      errorCode: 'csrf_invalid',
    });
  }
  if (source.decision !== 'approve') {
    return done(redirectWith(a.redirectUri, { error: 'access_denied', error_description: 'Usuario negou o acesso.', state: a.state, iss: req.origin }), {
      clientId: v.client.clientId,
      userId: claims.uid,
      errorCode: 'access_denied',
    });
  }
  // EQUIPE nao e oferecida (sem lista de equipe no cadastro); qualquer valor fora das opcoes => PROPRIOS.
  const requested = String(source.portfolio_scope || 'PROPRIOS').toUpperCase() as PortfolioScope;
  const portfolio: PortfolioScope = options.includes(requested) ? requested : 'PROPRIOS';
  const code = generateOAuthCode();
  const now = deps.now();
  await store.insertAuthCode({
    codeHash: sha256Hex(code),
    clientId: v.client.clientId,
    userId: claims.uid,
    redirectUri: a.redirectUri,
    scope: v.scopes.join(' '),
    portfolioScope: portfolio,
    moduleAccess: live.moduleAccess,
    teamMemberIds: [],
    codeChallenge: a.codeChallenge,
    codeChallengeMethod: 'S256',
    expiresAt: new Date(now.getTime() + deps.limits.authCodeTtlSeconds * 1000).toISOString(),
    usedAt: null,
    createdAt: now.toISOString(),
  });
  return done(redirectWith(a.redirectUri, { code, state: a.state, iss: req.origin }), {
    clientId: v.client.clientId,
    userId: claims.uid,
    scope: v.scopes.join(' '),
  });
}

async function issueTokens(store: IntegrationStore, deps: IntegrationDeps, base: Omit<OAuthTokenRecord, 'id' | 'accessTokenHash' | 'refreshTokenHash' | 'expiresAt' | 'refreshExpiresAt' | 'revokedAt' | 'createdAt'>) {
  const now = deps.now();
  const access = generateOAuthAccessToken();
  const refresh = generateOAuthRefreshToken();
  await store.insertToken({
    ...base,
    id: generateId('otk'),
    accessTokenHash: sha256Hex(access),
    refreshTokenHash: sha256Hex(refresh),
    expiresAt: new Date(now.getTime() + deps.limits.accessTokenTtlSeconds * 1000).toISOString(),
    refreshExpiresAt: new Date(now.getTime() + deps.limits.refreshTokenTtlSeconds * 1000).toISOString(),
    revokedAt: null,
    createdAt: now.toISOString(),
  });
  return json(200, {
    access_token: access,
    token_type: 'Bearer',
    expires_in: deps.limits.accessTokenTtlSeconds,
    refresh_token: refresh,
    scope: base.scope,
  });
}

async function handleToken(req: IntegrationHttpRequest, store: IntegrationStore, deps: IntegrationDeps) {
  const p = formOrJson(req.body);
  const ca = await authenticateClient(store, req, p);
  if (!ca.ok) return { res: ca.res, clientId: null, userId: null };
  const client = ca.client;
  const nowIso = deps.now().toISOString();
  const invalidGrant = (d: string) => ({ res: oauthError(400, 'invalid_grant', d), clientId: client.clientId, userId: null as string | null });

  if (p.grant_type === 'authorization_code') {
    if (!OAUTH_CODE_REGEX.test(p.code || '')) return invalidGrant('Codigo invalido.');
    if (!PKCE_VERIFIER_REGEX.test(p.code_verifier || '')) return { res: oauthError(400, 'invalid_request', 'code_verifier obrigatorio (PKCE S256).'), clientId: client.clientId, userId: null };
    const codeHash = sha256Hex(p.code);
    // 1) Leitura SEM efeito colateral; valida cliente, validade, redirect_uri e PKCE ANTES de
    //    consumir. Codigo interceptado sem o code_verifier nao queima o codigo nem derruba a concessao.
    const rec = await store.getAuthCode(codeHash);
    if (!rec) return invalidGrant('Codigo invalido.');
    if (rec.clientId !== client.clientId) return invalidGrant('Codigo invalido.');
    if (rec.expiresAt <= nowIso) return invalidGrant('Codigo expirado.');
    if ((p.redirect_uri || rec.redirectUri) !== rec.redirectUri) return invalidGrant('redirect_uri diferente da autorizacao.');
    if (!constantTimeHexEqual(pkceS256(p.code_verifier), rec.codeChallenge)) return invalidGrant('PKCE invalido.');
    // 2) Consumo atomico (UPDATE ... WHERE used_at IS NULL). Reuso COM cliente+PKCE validos =>
    //    revoga tudo o que foi emitido para esta concessao (RFC 6749 4.1.2 / OAuth 2.1).
    const consumed = await store.consumeAuthCode(codeHash, nowIso);
    if (!consumed) return invalidGrant('Codigo invalido.');
    if (consumed.alreadyUsed) {
      await store.revokeTokensForGrant(rec.clientId, rec.userId, nowIso);
      return { ...invalidGrant('Codigo ja utilizado.'), userId: rec.userId };
    }
    const res = await issueTokens(store, deps, {
      clientId: client.clientId,
      userId: rec.userId,
      scope: sanitizeRuntimeScopes(rec.scope).join(' '),
      portfolioScope: rec.portfolioScope,
      moduleAccess: rec.moduleAccess,
      teamMemberIds: rec.teamMemberIds,
    });
    return { res, clientId: client.clientId, userId: rec.userId };
  }

  if (p.grant_type === 'refresh_token') {
    if (!client.grantTypes.includes('refresh_token')) return { res: oauthError(400, 'unauthorized_client', 'Cliente sem refresh_token.'), clientId: client.clientId, userId: null };
    if (!OAUTH_REFRESH_REGEX.test(p.refresh_token || '')) return invalidGrant('refresh_token invalido.');
    const old = await store.getTokenByRefreshHash(sha256Hex(p.refresh_token));
    if (!old || old.clientId !== client.clientId) return invalidGrant('refresh_token invalido.');
    if (old.revokedAt) {
      // Deteccao de reuso (refresh ja rotacionado/revogado): derruba toda a concessao.
      await store.revokeTokensForGrant(old.clientId, old.userId, nowIso);
      return { ...invalidGrant('refresh_token reutilizado; concessao revogada.'), userId: old.userId };
    }
    if (!old.refreshExpiresAt || old.refreshExpiresAt <= nowIso) return invalidGrant('refresh_token expirado.');
    let scope = sanitizeRuntimeScopes(old.scope);
    if (p.scope) {
      const asked = splitScopeInput(p.scope);
      if (asked.some((s) => !scope.includes(s as never))) return { res: oauthError(400, 'invalid_scope', 'Escopo maior que o concedido.'), clientId: client.clientId, userId: old.userId };
      scope = sanitizeRuntimeScopes(asked);
    }
    const rotated = await store.revokeTokenIfActive(old.id, nowIso);
    if (!rotated) {
      await store.revokeTokensForGrant(old.clientId, old.userId, nowIso);
      return { ...invalidGrant('refresh_token reutilizado; concessao revogada.'), userId: old.userId };
    }
    const res = await issueTokens(store, deps, {
      clientId: client.clientId,
      userId: old.userId,
      scope: scope.join(' '),
      portfolioScope: old.portfolioScope,
      moduleAccess: old.moduleAccess,
      teamMemberIds: old.teamMemberIds,
    });
    return { res, clientId: client.clientId, userId: old.userId };
  }

  return { res: oauthError(400, 'unsupported_grant_type', 'grant_type suportado: authorization_code ou refresh_token.'), clientId: client.clientId, userId: null };
}

async function handleRevoke(req: IntegrationHttpRequest, store: IntegrationStore, deps: IntegrationDeps) {
  const p = formOrJson(req.body);
  const ca = await authenticateClient(store, req, p);
  if (!ca.ok) return { res: ca.res, clientId: null };
  const token = p.token || '';
  const nowIso = deps.now().toISOString();
  let rec: OAuthTokenRecord | null = null;
  if (OAUTH_ACCESS_REGEX.test(token)) rec = await store.getTokenByAccessHash(sha256Hex(token));
  else if (OAUTH_REFRESH_REGEX.test(token)) rec = await store.getTokenByRefreshHash(sha256Hex(token));
  if (rec && rec.clientId === ca.client.clientId) await store.revokeTokenIfActive(rec.id, nowIso);
  // RFC 7009: 200 mesmo para token desconhecido.
  return { res: json(200, {}), clientId: ca.client.clientId };
}
