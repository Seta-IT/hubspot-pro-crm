// ============================================================================
// STI-hub — Microsoft Graph (Outlook 365) para o e-mail individual do CRM (04/11/2026).
// OAuth2 authorization code + PKCE (S256), app confidencial do Azure (single-tenant).
// Escopos: offline_access User.Read Mail.Send Mail.Read (consentimento do proprio usuario).
// Variaveis: MS_CLIENT_ID, MS_CLIENT_SECRET, MS_TENANT_ID (+ STI_HUB_MAILBOX_ENC_KEY para os
// tokens). Faltando qualquer uma => recurso desligado, nada e chamado.
// fetch e injetavel (testes nunca saem para a rede).
// ============================================================================
import crypto from 'node:crypto';
import { isMailboxEncKeyConfigured } from './mailbox-crypto';
import { publicOrigin } from './mail-tracking';
import type { GraphFileAttachment } from './mailbox-attachments';

export const GRAPH_SCOPES = ['offline_access', 'User.Read', 'Mail.Send', 'Mail.Read'] as const;
export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
export const OAUTH_RETURN_PATH = '/conta/email/retorno';
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<any>;
  text: () => Promise<string>;
}>;

export interface MsGraphConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  redirectUri: string;
}

const TENANT_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9.-]+\.[a-z]{2,})$/i;
const CLIENT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** null => recurso desligado (motivo nunca sai para o usuario). */
export function resolveMsGraphConfig(): MsGraphConfig | null {
  const clientId = String(process.env.MS_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.MS_CLIENT_SECRET || '').trim();
  const tenantId = String(process.env.MS_TENANT_ID || '').trim();
  if (!CLIENT_RE.test(clientId) || !clientSecret || !TENANT_RE.test(tenantId)) return null;
  if (tenantId === 'common' || tenantId === 'consumers') return null;
  return { clientId, clientSecret, tenantId, redirectUri: `${publicOrigin()}${OAUTH_RETURN_PATH}` };
}

export function isMailboxFeatureEnabled(): boolean {
  return resolveMsGraphConfig() !== null && isMailboxEncKeyConfigured();
}

export function newPkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function newOAuthState(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function buildAuthorizeUrl(cfg: MsGraphConfig, state: string, codeChallenge: string, loginHint?: string): string {
  const u = new URL(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/authorize`);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('response_mode', 'query');
  u.searchParams.set('scope', GRAPH_SCOPES.join(' '));
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('prompt', 'select_account');
  if (loginHint) u.searchParams.set('login_hint', loginHint);
  return u.toString();
}

export interface GraphTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  scope: string;
}

async function tokenRequest(cfg: MsGraphConfig, fetchFn: FetchLike, params: Record<string, string>): Promise<GraphTokens> {
  const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params });
  const res = await fetchFn(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new GraphError('TOKEN_REQUEST_FAILED', res.status);
  const j = await res.json();
  if (!j || typeof j.access_token !== 'string' || typeof j.refresh_token !== 'string') throw new GraphError('TOKEN_RESPONSE_INVALID', 502);
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: Date.now() + Math.max(60, Number(j.expires_in) || 3600) * 1000 - 60_000,
    scope: String(j.scope || ''),
  };
}

export class GraphError extends Error {
  constructor(readonly code: string, readonly status: number, readonly graphCode: string | null = null) {
    super(code);
  }
}

/** Código do Graph (`error.code`) sem a mensagem, que pode trazer e-mails ou nomes. */
export function parseGraphErrorCode(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const err = (raw as { error?: { code?: unknown } }).error;
  const code = err && typeof err.code === 'string' ? err.code.trim() : '';
  if (!code || code.length > 120 || !/^[A-Za-z0-9._-]+$/.test(code)) return null;
  return code;
}

export function exchangeAuthCode(cfg: MsGraphConfig, fetchFn: FetchLike, code: string, verifier: string): Promise<GraphTokens> {
  return tokenRequest(cfg, fetchFn, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
    code_verifier: verifier,
    scope: GRAPH_SCOPES.join(' '),
  });
}

export function refreshGraphTokens(cfg: MsGraphConfig, fetchFn: FetchLike, refreshToken: string): Promise<GraphTokens> {
  return tokenRequest(cfg, fetchFn, { grant_type: 'refresh_token', refresh_token: refreshToken, scope: GRAPH_SCOPES.join(' ') });
}

/** Cabeçalhos do Graph. POST sem corpo (ex.: /messages/{id}/send) exige Content-Length 0 e não deve levar Content-Type JSON. */
export function buildGraphRequestHeaders(method: string, hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = { Authorization: 'Bearer <redacted>' };
  const m = (method || 'GET').toUpperCase();
  if (m === 'GET') headers.Prefer = 'IdType="ImmutableId", outlook.body-content-type="text"';
  else headers.Prefer = 'IdType="ImmutableId"';
  if (hasBody) headers['Content-Type'] = 'application/json';
  return headers;
}

async function graph(fetchFn: FetchLike, accessToken: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<any> {
  const method = init.method || 'GET';
  const hasBody = init.body !== undefined;
  const headers = buildGraphRequestHeaders(method, hasBody);
  headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetchFn(`${GRAPH_BASE}${path}`, {
    method,
    headers,
    body: hasBody ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    let graphCode: string | null = null;
    try {
      graphCode = parseGraphErrorCode(await res.json());
    } catch {
      graphCode = null;
    }
    throw new GraphError(res.status === 401 ? 'GRAPH_UNAUTHORIZED' : 'GRAPH_REQUEST_FAILED', res.status, graphCode);
  }
  if (res.status === 202 || res.status === 204) return null;
  return res.json();
}

export async function getGraphMe(fetchFn: FetchLike, accessToken: string): Promise<{ address: string; displayName: string }> {
  const me = await graph(fetchFn, accessToken, '/me?$select=mail,userPrincipalName,displayName');
  const address = String(me?.mail || me?.userPrincipalName || '').trim().toLowerCase();
  if (!address.includes('@')) throw new GraphError('GRAPH_ME_INVALID', 502);
  return { address, displayName: String(me?.displayName || address).slice(0, 120) };
}

export interface GraphRecipient {
  emailAddress: { address: string; name?: string };
}

export interface GraphSentMessage {
  id: string;
  conversationId: string | null;
  internetMessageId: string | null;
}

export interface GraphMailInput {
  to: string[];
  cc: string[];
  bcc?: string[];
  subject: string;
  html: string;
  /** Texto alternativo gerado para a timeline; o Graph so aceita um corpo (HTML). */
  text?: string;
  attachments?: GraphFileAttachment[];
}

/**
 * Corpo da mensagem Graph (HTML, destinatários, anexos). Usado como `message` em
 * POST /me/sendMail (Mail.Send). Não usar POST /me/messages: esse rascunho exige
 * Mail.ReadWrite, escopo que o app não pede (só User.Read + Mail.Send + Mail.Read).
 */
export function buildGraphMailDraftPayload(msg: GraphMailInput): Record<string, unknown> {
  const rcpt = (list: string[]): GraphRecipient[] => list.map((address) => ({ emailAddress: { address } }));
  const body: Record<string, unknown> = {
    subject: msg.subject,
    body: { contentType: 'HTML', content: msg.html },
    toRecipients: rcpt(msg.to),
    ccRecipients: rcpt(msg.cc),
    bccRecipients: rcpt(msg.bcc || []),
  };
  if (msg.attachments && msg.attachments.length) body.attachments = msg.attachments;
  return body;
}

/** Payload do POST /me/sendMail. Função pura para os testes. */
export function buildGraphSendMailPayload(msg: GraphMailInput): Record<string, unknown> {
  return { message: buildGraphMailDraftPayload(msg), saveToSentItems: true };
}

/** Tenta achar o item em Itens Enviados (Mail.Read) depois do /me/sendMail (202 sem corpo). */
async function findSentGraphMessage(
  fetchFn: FetchLike,
  accessToken: string,
  msg: GraphMailInput
): Promise<GraphSentMessage | null> {
  const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const list = await listGraphFolderSince(fetchFn, accessToken, 'sentitems', since, 10);
  const wantedTo = new Set(msg.to.map((a) => a.trim().toLowerCase()).filter(Boolean));
  const match = [...list].reverse().find((m) => {
    if (m.subject !== msg.subject) return false;
    if (!wantedTo.size) return true;
    const got = new Set(m.to.map((a) => a.trim().toLowerCase()));
    for (const addr of wantedTo) if (!got.has(addr)) return false;
    return true;
  });
  if (!match) return null;
  return { id: match.id, conversationId: match.conversationId, internetMessageId: match.internetMessageId };
}

/** Envia pelo POST /me/sendMail (Mail.Send). Sai do endereco do proprio usuario. */
export async function sendGraphMail(
  fetchFn: FetchLike,
  accessToken: string,
  msg: GraphMailInput
): Promise<GraphSentMessage> {
  await graph(fetchFn, accessToken, '/me/sendMail', {
    method: 'POST',
    body: buildGraphSendMailPayload(msg),
  });
  let found: GraphSentMessage | null = null;
  try {
    found = await findSentGraphMessage(fetchFn, accessToken, msg);
  } catch {
    found = null;
  }
  return found || {
    id: `local-${crypto.randomUUID()}`,
    conversationId: null,
    internetMessageId: null,
  };
}

export interface GraphListedMessage {
  id: string;
  conversationId: string | null;
  internetMessageId: string | null;
  subject: string;
  bodyPreview: string;
  from: string;
  fromName: string;
  to: string[];
  cc: string[];
  at: string;
}

const SELECT = 'id,conversationId,internetMessageId,subject,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime';

function mapListed(m: any): GraphListedMessage | null {
  if (!m || typeof m.id !== 'string') return null;
  const addr = (r: any) => String(r?.emailAddress?.address || '').trim().toLowerCase();
  return {
    id: m.id,
    conversationId: m.conversationId ? String(m.conversationId) : null,
    internetMessageId: m.internetMessageId ? String(m.internetMessageId) : null,
    subject: String(m.subject || '').slice(0, 500),
    bodyPreview: String(m.bodyPreview || '').slice(0, 500),
    from: addr(m.from),
    fromName: String(m.from?.emailAddress?.name || '').slice(0, 120),
    to: (Array.isArray(m.toRecipients) ? m.toRecipients : []).map(addr).filter(Boolean),
    cc: (Array.isArray(m.ccRecipients) ? m.ccRecipients : []).map(addr).filter(Boolean),
    at: String(m.receivedDateTime || m.sentDateTime || new Date().toISOString()),
  };
}

/** Mensagens de uma pasta (inbox | sentitems) desde `sinceIso`, ate `max`. */
export async function listGraphFolderSince(
  fetchFn: FetchLike,
  accessToken: string,
  folder: 'inbox' | 'sentitems',
  sinceIso: string,
  max = 200
): Promise<GraphListedMessage[]> {
  const field = folder === 'inbox' ? 'receivedDateTime' : 'sentDateTime';
  let path: string | null =
    `/me/mailFolders/${folder}/messages?$select=${SELECT}&$top=50&$orderby=${field}%20asc&$filter=${field}%20ge%20${encodeURIComponent(sinceIso)}`;
  const out: GraphListedMessage[] = [];
  while (path && out.length < max) {
    const page: any = await graph(fetchFn, accessToken, path);
    for (const raw of Array.isArray(page?.value) ? page.value : []) {
      const m = mapListed(raw);
      if (m) out.push(m);
    }
    const next = typeof page?.['@odata.nextLink'] === 'string' ? page['@odata.nextLink'] : null;
    path = next && next.startsWith(GRAPH_BASE) ? next.slice(GRAPH_BASE.length) : null;
  }
  return out.slice(0, max);
}
