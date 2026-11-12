// ============================================================================
// STI-hub — Envio de e-mail do cliente (ERP e CRM) por um único serviço.
// Preferência: caixa Outlook do próprio usuário (crm_mailbox_accounts, Graph
// POST /me/sendMail). Só cai no Resend quando há certeza de que nada saiu:
// sem caixa, sem token, ou Graph 401/403. Timeout, rede, 5xx, 429, 404 e 409
// devolvem erro específico, sem segundo canal (o sendMail pode já ter sido aceito).
// Convites, OTP e redefinição de senha continuam só no Resend/SMTP.
// ============================================================================
import { GraphError, sendGraphMail, type FetchLike, type GraphSentMessage } from './ms-graph';
import type { GraphFileAttachment } from './mailbox-attachments';

export interface ClientMailAttachment {
  filename: string;
  contentBase64: string;
  contentType: string;
  isInline?: boolean;
  contentId?: string;
}

export interface DeliverClientEmailInput {
  fetch: FetchLike;
  outlook?: {
    accessToken: string;
    mailboxAddress: string;
    displayName?: string;
    accountId?: string;
  } | null;
  resend?: { apiKey: string; from: string } | null;
  /** Endereço da sessão ou da caixa (nunca vem do corpo da requisição). */
  replyTo?: string | null;
  message: {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    html: string;
    text?: string;
    attachments?: ClientMailAttachment[];
  };
}

export type ClientEmailRelay = 'OUTLOOK' | 'RESEND';
export type ClientEmailPublicRelay = 'outlook' | 'resend';

export function publicClientEmailRelay(relay: ClientEmailRelay): ClientEmailPublicRelay {
  return relay === 'OUTLOOK' ? 'outlook' : 'resend';
}

export interface DeliverClientEmailSuccess {
  ok: true;
  relay: ClientEmailRelay;
  fallback: boolean;
  mailboxAddress?: string;
  sent?: GraphSentMessage;
  /** Preenchido quando o Outlook recusou (401/403) e o envio caiu no Resend. */
  outlookError?: unknown;
}

export interface DeliverClientEmailFailure {
  ok: false;
  relayAttempted: ClientEmailRelay[];
  error: { status: number; error: string; code: string };
  graphError?: unknown;
}

export type DeliverClientEmailResult = DeliverClientEmailSuccess | DeliverClientEmailFailure;

const REPLY_TO_RE =
  /^[^\s@<>(),;:"\\[\]]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/** Só aceita o endereço da sessão/caixa passado pelo chamador, nunca um campo do corpo. */
export function resolveSendReplyTo(replyTo: string | null | undefined, mailboxAddress?: string | null): string | undefined {
  for (const raw of [replyTo, mailboxAddress]) {
    const addr = String(raw || '').trim().toLowerCase();
    if (addr && REPLY_TO_RE.test(addr)) return addr;
  }
  return undefined;
}

function toGraphAttachments(list: ClientMailAttachment[] | undefined): GraphFileAttachment[] | undefined {
  if (!list || !list.length) return undefined;
  return list.map((a) => {
    const att: GraphFileAttachment = {
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.filename,
      contentType: a.contentType,
      contentBytes: a.contentBase64,
    };
    if (a.isInline) {
      att.isInline = true;
      if (a.contentId) att.contentId = a.contentId;
    }
    return att;
  });
}

function toResendAttachments(list: ClientMailAttachment[] | undefined): Array<Record<string, string>> | undefined {
  if (!list || !list.length) return undefined;
  const out = list
    .map((a) => {
      const row: Record<string, string> = {
        filename: String(a.filename || 'anexo').slice(0, 120),
        content: String(a.contentBase64 || ''),
        content_type: String(a.contentType || 'application/octet-stream'),
      };
      if (a.contentId) row.content_id = a.contentId;
      return row;
    })
    .filter((a) => a.content && a.content.length <= 1_800_000);
  return out.length ? out : undefined;
}

function noProvider(): DeliverClientEmailFailure {
  return {
    ok: false,
    relayAttempted: [],
    error: {
      status: 503,
      error: 'O envio de e-mail não está configurado. Fale com o administrador.',
      code: 'EMAIL_PROVIDER_NOT_CONFIGURED',
    },
  };
}

/** 401/403: o Graph recusou antes de aceitar o envio. Qualquer outro caso pode já ter saído. */
export function canSafelyFallbackToResend(err: unknown): boolean {
  if (!(err instanceof GraphError)) return false;
  if (err.status === 401 || err.code === 'GRAPH_UNAUTHORIZED') return true;
  return err.status === 403;
}

export function isTimeoutLikeError(err: unknown): boolean {
  if (!err || err instanceof GraphError) return false;
  const name = err instanceof Error ? err.name : '';
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return name === 'AbortError' || name === 'TimeoutError' || /timeout|etimedout|aborted|aborterror/i.test(msg);
}

async function sendViaResend(
  fetchFn: FetchLike,
  resend: { apiKey: string; from: string },
  msg: DeliverClientEmailInput['message'],
  replyTo?: string
): Promise<DeliverClientEmailResult> {
  let failure: string | null = null;
  try {
    const payload: Record<string, unknown> = {
      from: resend.from,
      to: msg.to,
      cc: msg.cc && msg.cc.length ? msg.cc : undefined,
      bcc: msg.bcc && msg.bcc.length ? msg.bcc : undefined,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      attachments: toResendAttachments(msg.attachments),
    };
    if (replyTo) payload.reply_to = replyTo;
    const res = await fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resend.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) return { ok: true, relay: 'RESEND', fallback: false };
    failure = `HTTP ${res.status}`;
  } catch {
    failure = 'falha de rede';
  }
  console.warn(`[STI-hub e-mail] send-email: Resend recusou o envio (${failure}).`);
  return {
    ok: false,
    relayAttempted: ['RESEND'],
    error: {
      status: 502,
      error: 'Não foi possível enviar o e-mail. Nada foi registrado; tente novamente.',
      code: 'EMAIL_SEND_FAILED',
    },
  };
}

/**
 * Envia um e-mail de cliente (proposta, fatura, compositor do CRM) pela mesma
 * função, na mesma caixa Outlook quando ela está conectada.
 */
export async function deliverClientEmail(input: DeliverClientEmailInput): Promise<DeliverClientEmailResult> {
  const msg = input.message;
  const attempted: ClientEmailRelay[] = [];
  const replyTo = resolveSendReplyTo(input.replyTo, input.outlook?.mailboxAddress);

  if (input.outlook?.accessToken) {
    attempted.push('OUTLOOK');
    try {
      const sent = await sendGraphMail(input.fetch, input.outlook.accessToken, {
        to: msg.to,
        cc: msg.cc || [],
        bcc: msg.bcc,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        attachments: toGraphAttachments(msg.attachments),
      });
      return {
        ok: true,
        relay: 'OUTLOOK',
        fallback: false,
        mailboxAddress: input.outlook.mailboxAddress,
        sent,
      };
    } catch (err) {
      if (canSafelyFallbackToResend(err) && input.resend?.apiKey) {
        console.warn('[mailbox] Graph send refused, falling back to Resend', {
          status: err instanceof GraphError ? err.status : 0,
          graphCode: err instanceof GraphError ? (err.graphCode || err.code) : 'SEND_EXCEPTION',
        });
        const viaResend = await sendViaResend(input.fetch, input.resend, msg, replyTo);
        if (viaResend.ok) return { ...viaResend, fallback: true, outlookError: err, mailboxAddress: input.outlook.mailboxAddress };
        viaResend.relayAttempted = [...attempted, 'RESEND'];
        viaResend.graphError = err;
        return viaResend;
      }
      return {
        ok: false,
        relayAttempted: attempted,
        graphError: err,
        error: {
          status: 502,
          error: 'Não foi possível enviar o e-mail. Nada foi registrado; tente novamente.',
          code: 'EMAIL_SEND_FAILED',
        },
      };
    }
  }

  if (input.resend?.apiKey) {
    const viaResend = await sendViaResend(input.fetch, input.resend, msg, replyTo);
    if (!viaResend.ok) viaResend.relayAttempted = [...attempted, 'RESEND'];
    return viaResend;
  }

  if (!attempted.length) return noProvider();
  return {
    ok: false,
    relayAttempted: attempted,
    error: {
      status: 502,
      error: 'Não foi possível enviar o e-mail. Nada foi registrado; tente novamente.',
      code: 'EMAIL_SEND_FAILED',
    },
  };
}
