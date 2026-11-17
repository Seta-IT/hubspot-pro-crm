// ============================================================================
// SetaDesk - Cliente Microsoft Graph com credencial de APLICACAO por certificado.
// ----------------------------------------------------------------------------
// OAuth2 client credentials com client assertion (JWT RS256 assinado pela chave
// privada do certificado; cabecalho x5t/x5t#S256). Sem SDK: so fetch (injetavel
// nos testes, que nunca saem para a rede).
//
// Permissoes de aplicacao esperadas (escopo RBAC do Exchange limitado as caixas
// das filas): Mail.Read (leitura) e Mail.Send (envio). Este cliente:
//   - le mensagens (GET), sem marcar como lidas e sem mover (nenhum PATCH/move);
//   - envia respostas por POST /messages/{id}/reply (Mail.Send; o Graph preenche
//     In-Reply-To/References) e, se a original nao existir mais, POST /sendMail.
// Nunca loga token, assertion, chave, tenant ou client id. Erros so com codigo.
// ============================================================================

import crypto from 'node:crypto';
import type { SetaDeskGraphAppConfig } from './config';

export const SETADESK_GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
export const SETADESK_GRAPH_SCOPE = 'https://graph.microsoft.com/.default';

export type SetaDeskFetch = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }
) => Promise<{
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  json: () => Promise<any>;
  text: () => Promise<string>;
}>;

export class SetaDeskGraphError extends Error {
  constructor(readonly code: string, readonly status: number, readonly graphCode: string | null = null) {
    super(code);
    this.name = 'SetaDeskGraphError';
  }
}

function graphErrorCode(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const err = (raw as { error?: unknown }).error;
  const code =
    err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'string'
      ? String((err as { code: string }).code)
      : typeof err === 'string'
        ? err
        : '';
  return code && code.length <= 120 && /^[A-Za-z0-9._-]+$/.test(code) ? code : null;
}

/** JWT de client assertion (RFC 7523) assinado com a chave privada do certificado. */
export function buildClientAssertion(cfg: SetaDeskGraphAppConfig, nowMs: number = Date.now()): string {
  const header = { alg: 'RS256', typ: 'JWT', [cfg.thumbprintHeader.name]: cfg.thumbprintHeader.value };
  const iat = Math.floor(nowMs / 1000);
  const payload = {
    aud: `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`,
    iss: cfg.clientId,
    sub: cfg.clientId,
    jti: crypto.randomUUID(),
    nbf: iat - 30,
    iat,
    exp: iat + 600,
  };
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = `${enc(header)}.${enc(payload)}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(input), cfg.privateKey).toString('base64url');
  return `${input}.${sig}`;
}

export interface GraphRecipient {
  emailAddress?: { address?: string; name?: string };
}

export interface GraphMessage {
  id: string;
  '@odata.type'?: string;
  '@removed'?: unknown;
  internetMessageId?: string;
  conversationId?: string;
  subject?: string;
  from?: GraphRecipient;
  sender?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  bccRecipients?: GraphRecipient[];
  replyTo?: GraphRecipient[];
  receivedDateTime?: string;
  isDraft?: boolean;
  internetMessageHeaders?: Array<{ name?: string; value?: string }>;
  body?: { contentType?: string; content?: string };
  hasAttachments?: boolean;
  attachments?: Array<{ id?: string; name?: string; contentType?: string; size?: number; isInline?: boolean; '@odata.type'?: string }>;
}

export interface DeltaPage {
  items: Array<{ id: string; removed: boolean; receivedDateTime?: string | null }>;
  nextLink: string | null;
  deltaLink: string | null;
}

export interface SendReplyInput {
  mailbox: string;
  providerMessageId: string | null;
  to: string[];
  cc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
}

export interface SetaDeskGraphClient {
  deltaPage(mailbox: string, cursorUrl: string | null, sinceIso: string): Promise<DeltaPage>;
  getMessage(mailbox: string, id: string): Promise<GraphMessage>;
  /** Responde a mensagem original (threading pelo Graph); fallback sendMail quando a original sumiu. */
  sendReply(input: SendReplyInput): Promise<{ mode: 'REPLY' | 'SEND_MAIL' }>;
}

const MESSAGE_SELECT = [
  'id', 'internetMessageId', 'conversationId', 'subject', 'from', 'sender', 'toRecipients', 'ccRecipients',
  'bccRecipients', 'replyTo', 'receivedDateTime', 'internetMessageHeaders', 'body', 'hasAttachments', 'isDraft',
].join(',');

/** Cursor gravado no banco so e usado se for uma URL do proprio Graph (defesa contra SSRF). */
export function isTrustedGraphCursor(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'graph.microsoft.com' && u.pathname.startsWith('/v1.0/users/');
  } catch {
    return false;
  }
}

const toRecipients = (list: string[] | undefined) =>
  (list || []).map((address) => ({ emailAddress: { address } }));

/** Tempo maximo de cada chamada ao Graph/token (ms). */
export const SETADESK_GRAPH_TIMEOUT_MS = 15_000;

export function createSetaDeskGraphClient(opts: {
  config: SetaDeskGraphAppConfig;
  fetch: SetaDeskFetch;
  /** Padrao SETADESK_GRAPH_TIMEOUT_MS (15 s). */
  timeoutMs?: number;
  now?: () => number;
  pageSize?: number;
}): SetaDeskGraphClient {
  const timeoutMs = Math.max(1, opts.timeoutMs ?? SETADESK_GRAPH_TIMEOUT_MS);
  // Timeout de 15 s por chamada: AbortController + corrida com timer (vale mesmo se o fetch ignorar o signal).
  async function timedFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) {
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ac.abort();
        reject(new SetaDeskGraphError('GRAPH_TIMEOUT', 504));
      }, timeoutMs);
    });
    try {
      return await Promise.race([opts.fetch(url, { ...init, signal: ac.signal }), timeout]);
    } catch (err) {
      if (err instanceof SetaDeskGraphError) throw err;
      if (ac.signal.aborted) throw new SetaDeskGraphError('GRAPH_TIMEOUT', 504);
      throw new SetaDeskGraphError('GRAPH_NETWORK_ERROR', 503);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  const now = opts.now || Date.now;
  const pageSize = Math.min(Math.max(opts.pageSize || 25, 1), 50);
  let cached: { token: string; expiresAt: number } | null = null;

  async function token(): Promise<string> {
    if (cached && cached.expiresAt > now()) return cached.token;
    const body = new URLSearchParams({
      client_id: opts.config.clientId,
      scope: SETADESK_GRAPH_SCOPE,
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: buildClientAssertion(opts.config, now()),
    });
    const res = await timedFetch(
      `https://login.microsoftonline.com/${encodeURIComponent(opts.config.tenantId)}/oauth2/v2.0/token`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }
    );
    let j: any = null;
    try {
      j = await res.json();
    } catch {
      j = null;
    }
    if (!res.ok) throw new SetaDeskGraphError('GRAPH_TOKEN_FAILED', res.status, graphErrorCode(j));
    if (!j || typeof j.access_token !== 'string') throw new SetaDeskGraphError('GRAPH_TOKEN_INVALID', 502);
    const ttl = Math.max(120, Number(j.expires_in) || 3600);
    cached = { token: j.access_token, expiresAt: now() + (ttl - 60) * 1000 };
    return cached.token;
  }

  async function call(url: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<any> {
    const method = init.method || 'GET';
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await token()}`,
      Prefer: init.prefer || 'IdType="ImmutableId"',
    };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await timedFetch(url, {
      method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
      let code: string | null = null;
      try {
        code = graphErrorCode(await res.json());
      } catch {
        code = null;
      }
      throw new SetaDeskGraphError('GRAPH_REQUEST_FAILED', res.status, code);
    }
    if (res.status === 202 || res.status === 204) return null;
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  const userPath = (mailbox: string) => `${SETADESK_GRAPH_BASE}/users/${encodeURIComponent(mailbox)}`;

  return {
    async deltaPage(mailbox, cursorUrl, sinceIso) {
      let url: string;
      if (cursorUrl) {
        if (!isTrustedGraphCursor(cursorUrl)) throw new SetaDeskGraphError('GRAPH_CURSOR_UNTRUSTED', 400);
        url = cursorUrl;
      } else {
        const since = new Date(Date.parse(sinceIso) || now()).toISOString().replace(/\.\d{3}Z$/, 'Z');
        url =
          `${userPath(mailbox)}/mailFolders('inbox')/messages/delta` +
          `?$select=id,receivedDateTime&$filter=receivedDateTime+ge+${since}`;
      }
      const j = await call(url, { prefer: `IdType="ImmutableId", odata.maxpagesize=${pageSize}` });
      const value: any[] = Array.isArray(j?.value) ? j.value : [];
      const nextLink = typeof j?.['@odata.nextLink'] === 'string' ? j['@odata.nextLink'] : null;
      const deltaLink = typeof j?.['@odata.deltaLink'] === 'string' ? j['@odata.deltaLink'] : null;
      if (nextLink && !isTrustedGraphCursor(nextLink)) throw new SetaDeskGraphError('GRAPH_CURSOR_UNTRUSTED', 502);
      if (deltaLink && !isTrustedGraphCursor(deltaLink)) throw new SetaDeskGraphError('GRAPH_CURSOR_UNTRUSTED', 502);
      return {
        items: value
          .filter((m) => m && typeof m.id === 'string')
          .map((m) => ({ id: m.id, removed: m['@removed'] !== undefined, receivedDateTime: m.receivedDateTime ?? null })),
        nextLink,
        deltaLink,
      };
    },

    async getMessage(mailbox, id) {
      const url =
        `${userPath(mailbox)}/messages/${encodeURIComponent(id)}` +
        `?$select=${MESSAGE_SELECT}&$expand=attachments($select=id,name,contentType,size,isInline)`;
      const j = await call(url, { prefer: 'IdType="ImmutableId", outlook.body-content-type="html"' });
      if (!j || typeof j.id !== 'string') throw new SetaDeskGraphError('GRAPH_MESSAGE_INVALID', 502);
      return j as GraphMessage;
    },

    async sendReply(input) {
      const message = {
        subject: input.subject,
        toRecipients: toRecipients(input.to),
        ccRecipients: toRecipients(input.cc),
        body: { contentType: 'HTML', content: input.bodyHtml },
      };
      if (input.providerMessageId) {
        try {
          await call(`${userPath(input.mailbox)}/messages/${encodeURIComponent(input.providerMessageId)}/reply`, {
            method: 'POST',
            body: { message },
          });
          return { mode: 'REPLY' };
        } catch (err) {
          // Original apagada/movida pelo usuario: envia mensagem nova (o [CHAVE] no assunto mantem o vinculo).
          if (!(err instanceof SetaDeskGraphError) || (err.status !== 404 && err.graphCode !== 'ErrorItemNotFound')) throw err;
        }
      }
      await call(`${userPath(input.mailbox)}/sendMail`, {
        method: 'POST',
        body: { message, saveToSentItems: true },
      });
      return { mode: 'SEND_MAIL' };
    },
  };
}
