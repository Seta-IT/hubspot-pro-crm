// ============================================================================
// STI-hub — Fase 3: adaptadores de provedor de e-mail de marketing (ESP), interface comum.
//   resend   (homologado; primeiro adaptador)   smtp (nodemailer; transporte injetavel)
//   sendgrid / mailgun / postmark / ses        (plugaveis; cobertos por testes de contrato,
//                                               ainda sem credenciais nem homologacao)
// Todos recebem fetch/transporte INJETADO (testes nunca saem para a rede). Nunca registram
// chaves. Nenhum adaptador troca de conta, dominio ou provedor sozinho (sem rotacao).
// ============================================================================

export interface EspMessage {
  from: string; // "Nome <email>"
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
  /** Inclui List-Unsubscribe e List-Unsubscribe-Post (obrigatorios em campanha). */
  headers: Record<string, string>;
  /** Chave de idempotencia (campanha:contato). */
  idempotencyKey: string;
  tags?: Record<string, string>;
}

export interface EspSendResult {
  provider: string;
  providerMessageId: string | null;
}

export class EspSendError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly retryable: boolean
  ) {
    super(code);
    this.name = 'EspSendError';
  }
}

export interface EspAdapter {
  readonly id: 'resend' | 'smtp' | 'sendgrid' | 'mailgun' | 'postmark' | 'ses';
  send(msg: EspMessage): Promise<EspSendResult>;
}

export type HttpFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{ ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string>; headers?: { get(name: string): string | null } }>;

export interface HttpRequestSpec {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
}

function classify(status: number, code: string): EspSendError {
  const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
  return new EspSendError(code.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60) || 'ESP_ERROR', status, retryable);
}

async function doHttp(fetchFn: HttpFetch, req: HttpRequestSpec): Promise<{ status: number; json: any; headerId: string | null }> {
  let res: Awaited<ReturnType<HttpFetch>>;
  try {
    res = await fetchFn(req.url, { method: req.method, headers: req.headers, body: req.body });
  } catch {
    throw classify(0, 'NETWORK_ERROR');
  }
  let json: any = null;
  try {
    const t = await res.text();
    json = t ? JSON.parse(t) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const code = String(json?.name || json?.errors?.[0]?.message || json?.ErrorCode || json?.message || `HTTP_${res.status}`);
    throw classify(res.status, code);
  }
  return { status: res.status, json, headerId: res.headers?.get('x-message-id') || null };
}

function headerList(h: Record<string, string>): Array<[string, string]> {
  return Object.entries(h).filter(([k, v]) => /^[A-Za-z0-9-]{1,64}$/.test(k) && typeof v === 'string' && !/[\r\n]/.test(v));
}

// ---------------------------------------------------------------------------
// Construtores de requisicao (funcoes puras, testadas por contrato)
// ---------------------------------------------------------------------------
export function buildResendRequest(apiKey: string, m: EspMessage): HttpRequestSpec {
  return {
    url: 'https://api.resend.com/emails',
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': m.idempotencyKey.slice(0, 256) },
    body: JSON.stringify({
      from: m.from,
      to: [m.to],
      subject: m.subject,
      html: m.html,
      text: m.text,
      ...(m.replyTo ? { reply_to: m.replyTo } : {}),
      headers: Object.fromEntries(headerList(m.headers)),
      tags: Object.entries(m.tags || {}).map(([name, value]) => ({ name, value: String(value).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256) })),
    }),
  };
}

export function buildSendGridRequest(apiKey: string, m: EspMessage): HttpRequestSpec {
  const fromMatch = /^(.*)<([^>]+)>$/.exec(m.from);
  return {
    url: 'https://api.sendgrid.com/v3/mail/send',
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: m.to }], custom_args: { ...(m.tags || {}), idempotency_key: m.idempotencyKey } }],
      from: fromMatch ? { email: fromMatch[2].trim(), name: fromMatch[1].trim() } : { email: m.from },
      ...(m.replyTo ? { reply_to: { email: m.replyTo } } : {}),
      subject: m.subject,
      content: [
        { type: 'text/plain', value: m.text },
        { type: 'text/html', value: m.html },
      ],
      headers: Object.fromEntries(headerList(m.headers)),
    }),
  };
}

export function buildMailgunRequest(apiKey: string, domain: string, m: EspMessage, baseUrl = 'https://api.mailgun.net'): HttpRequestSpec {
  const form = new URLSearchParams();
  form.set('from', m.from);
  form.set('to', m.to);
  form.set('subject', m.subject);
  form.set('html', m.html);
  form.set('text', m.text);
  if (m.replyTo) form.set('h:Reply-To', m.replyTo);
  for (const [k, v] of headerList(m.headers)) form.set(`h:${k}`, v);
  for (const [k, v] of Object.entries(m.tags || {})) form.set(`v:${k}`, String(v));
  form.set('v:idempotency_key', m.idempotencyKey);
  return {
    url: `${baseUrl.replace(/\/+$/, '')}/v3/${encodeURIComponent(domain)}/messages`,
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  };
}

export function buildPostmarkRequest(serverToken: string, m: EspMessage): HttpRequestSpec {
  return {
    url: 'https://api.postmarkapp.com/email',
    method: 'POST',
    headers: { 'X-Postmark-Server-Token': serverToken, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      From: m.from,
      To: m.to,
      Subject: m.subject,
      HtmlBody: m.html,
      TextBody: m.text,
      ...(m.replyTo ? { ReplyTo: m.replyTo } : {}),
      Headers: headerList(m.headers).map(([Name, Value]) => ({ Name, Value })),
      MessageStream: 'broadcast',
      Metadata: { ...(m.tags || {}), idempotency_key: m.idempotencyKey },
    }),
  };
}

/** SES v2 (SendEmail, conteudo Simple com Headers). A assinatura SigV4 e injetada (nao incluida). */
export function buildSesRequest(region: string, m: EspMessage): HttpRequestSpec {
  return {
    url: `https://email.${region}.amazonaws.com/v2/email/outbound-emails`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      FromEmailAddress: m.from,
      Destination: { ToAddresses: [m.to] },
      ...(m.replyTo ? { ReplyToAddresses: [m.replyTo] } : {}),
      Content: {
        Simple: {
          Subject: { Data: m.subject, Charset: 'UTF-8' },
          Body: { Html: { Data: m.html, Charset: 'UTF-8' }, Text: { Data: m.text, Charset: 'UTF-8' } },
          Headers: headerList(m.headers).map(([Name, Value]) => ({ Name, Value })),
        },
      },
      EmailTags: Object.entries({ ...(m.tags || {}), idempotency_key: m.idempotencyKey }).map(([Name, Value]) => ({ Name, Value: String(Value).replace(/[^A-Za-z0-9_-]/g, '_') })),
    }),
  };
}

// ---------------------------------------------------------------------------
// Adaptadores
// ---------------------------------------------------------------------------
export function createResendAdapter(apiKey: string, fetchFn: HttpFetch): EspAdapter {
  return {
    id: 'resend',
    async send(m) {
      const r = await doHttp(fetchFn, buildResendRequest(apiKey, m));
      return { provider: 'resend', providerMessageId: typeof r.json?.id === 'string' ? r.json.id : null };
    },
  };
}

export function createSendGridAdapter(apiKey: string, fetchFn: HttpFetch): EspAdapter {
  return {
    id: 'sendgrid',
    async send(m) {
      const r = await doHttp(fetchFn, buildSendGridRequest(apiKey, m));
      return { provider: 'sendgrid', providerMessageId: r.headerId };
    },
  };
}

export function createMailgunAdapter(apiKey: string, domain: string, fetchFn: HttpFetch, baseUrl?: string): EspAdapter {
  return {
    id: 'mailgun',
    async send(m) {
      const r = await doHttp(fetchFn, buildMailgunRequest(apiKey, domain, m, baseUrl));
      return { provider: 'mailgun', providerMessageId: typeof r.json?.id === 'string' ? r.json.id : null };
    },
  };
}

export function createPostmarkAdapter(serverToken: string, fetchFn: HttpFetch): EspAdapter {
  return {
    id: 'postmark',
    async send(m) {
      const r = await doHttp(fetchFn, buildPostmarkRequest(serverToken, m));
      return { provider: 'postmark', providerMessageId: typeof r.json?.MessageID === 'string' ? r.json.MessageID : null };
    },
  };
}

export type SesSigner = (req: HttpRequestSpec) => Promise<Record<string, string>>;

export function createSesAdapter(region: string, signer: SesSigner, fetchFn: HttpFetch): EspAdapter {
  return {
    id: 'ses',
    async send(m) {
      const req = buildSesRequest(region, m);
      const signed = await signer(req);
      const r = await doHttp(fetchFn, { ...req, headers: { ...req.headers, ...signed } });
      return { provider: 'ses', providerMessageId: typeof r.json?.MessageId === 'string' ? r.json.MessageId : null };
    },
  };
}

export interface SmtpTransportLike {
  sendMail(opts: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
    replyTo?: string;
    headers: Record<string, string>;
    messageId?: string;
  }): Promise<{ messageId?: string; rejected?: unknown[] }>;
}

export function createSmtpAdapter(transport: SmtpTransportLike): EspAdapter {
  return {
    id: 'smtp',
    async send(m) {
      try {
        const info = await transport.sendMail({
          from: m.from,
          to: m.to,
          subject: m.subject,
          html: m.html,
          text: m.text,
          ...(m.replyTo ? { replyTo: m.replyTo } : {}),
          headers: Object.fromEntries(headerList(m.headers)),
        });
        if (Array.isArray(info.rejected) && info.rejected.length) throw new EspSendError('SMTP_REJECTED', 550, false);
        return { provider: 'smtp', providerMessageId: info.messageId || null };
      } catch (err) {
        if (err instanceof EspSendError) throw err;
        const code = String((err as { responseCode?: number })?.responseCode || '');
        const status = Number(code) || 0;
        // SMTP: 4xx = temporario (tenta de novo); 5xx = permanente; sem codigo = falha de rede.
        throw new EspSendError(`SMTP_${status || 'ERROR'}`, status, status === 0 || (status >= 400 && status < 500));
      }
    },
  };
}

export interface EspResolveDeps {
  fetch: HttpFetch;
  smtpTransportFactory?: (url: string) => SmtpTransportLike;
  sesSigner?: SesSigner;
}

/** Monta o UNICO adaptador configurado (sem fallback entre provedores). */
export function resolveEspAdapter(
  provider: EspAdapter['id'] | null,
  env: NodeJS.ProcessEnv,
  deps: EspResolveDeps
): { adapter: EspAdapter; problem: null } | { adapter: null; problem: string } {
  const v = (k: string) => String(env[k] || '').trim();
  switch (provider) {
    case 'resend':
      return v('MARKETING_RESEND_API_KEY')
        ? { adapter: createResendAdapter(v('MARKETING_RESEND_API_KEY'), deps.fetch), problem: null }
        : { adapter: null, problem: 'MARKETING_RESEND_API_KEY não configurada (chave própria do marketing, separada da transacional).' };
    case 'smtp':
      if (!v('MARKETING_SMTP_URL')) return { adapter: null, problem: 'MARKETING_SMTP_URL não configurada.' };
      if (!deps.smtpTransportFactory) return { adapter: null, problem: 'Transporte SMTP indisponível.' };
      return { adapter: createSmtpAdapter(deps.smtpTransportFactory(v('MARKETING_SMTP_URL'))), problem: null };
    case 'sendgrid':
      return v('MARKETING_SENDGRID_API_KEY')
        ? { adapter: createSendGridAdapter(v('MARKETING_SENDGRID_API_KEY'), deps.fetch), problem: null }
        : { adapter: null, problem: 'MARKETING_SENDGRID_API_KEY não configurada.' };
    case 'mailgun':
      return v('MARKETING_MAILGUN_API_KEY') && v('MARKETING_MAILGUN_DOMAIN')
        ? { adapter: createMailgunAdapter(v('MARKETING_MAILGUN_API_KEY'), v('MARKETING_MAILGUN_DOMAIN'), deps.fetch, v('MARKETING_MAILGUN_BASE_URL') || undefined), problem: null }
        : { adapter: null, problem: 'MARKETING_MAILGUN_API_KEY e MARKETING_MAILGUN_DOMAIN não configuradas.' };
    case 'postmark':
      return v('MARKETING_POSTMARK_SERVER_TOKEN')
        ? { adapter: createPostmarkAdapter(v('MARKETING_POSTMARK_SERVER_TOKEN'), deps.fetch), problem: null }
        : { adapter: null, problem: 'MARKETING_POSTMARK_SERVER_TOKEN não configurado.' };
    case 'ses':
      if (!/^[a-z]{2}-[a-z]+-\d$/.test(v('MARKETING_SES_REGION'))) return { adapter: null, problem: 'MARKETING_SES_REGION não configurada.' };
      if (!deps.sesSigner) return { adapter: null, problem: 'SES exige assinador SigV4 (não incluído nesta versão).' };
      return { adapter: createSesAdapter(v('MARKETING_SES_REGION'), deps.sesSigner, deps.fetch), problem: null };
    default:
      return { adapter: null, problem: 'MARKETING_ESP_PROVIDER não configurado.' };
  }
}
