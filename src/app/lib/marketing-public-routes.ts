// ============================================================================
// STI-hub — Fase 3: rotas PUBLICAS das campanhas (sem sessao; credencial propria verificada aqui).
//   GET/POST /api/marketing/preferences/unsubscribe/<token>
//       GET  => pagina de confirmacao (NAO altera nada: scanners de link fazem GET)
//       POST => descadastro; "List-Unsubscribe=One-Click" (RFC 8058) = so a finalidade do e-mail
//   POST /api/marketing/webhooks/resend   (assinatura Svix com RESEND_WEBHOOK_SECRET)
// Depois de verificar, chamam o router por despacho interno confiavel (nunca HTTP).
// Logs: nunca token, e-mail ou corpo.
// ============================================================================
import { escapeHtml } from '../../modules/email/email-html';
import { MARKETING_PURPOSE_LABELS } from '../../modules/marketing/marketing-config';
import { normalizeResendEvent, verifySvixSignature } from '../../modules/marketing/resend-webhook';
import { resolveUnsubscribeSecret, verifyUnsubscribeToken } from '../../modules/marketing/unsubscribe-token';

export type TrustedMarketingDispatch = (
  path: '/api/marketing/esp-events' | '/api/marketing/unsubscribe-apply',
  body: Record<string, unknown>
) => Promise<{ status: number; body: unknown }>;

export interface PlainResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const BASE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
};

export const WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

function page(status: number, title: string, inner: string): PlainResponse {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head>` +
    `<body style="font-family:Segoe UI,Arial,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:40px 16px">` +
    `<main style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:28px">` +
    `<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(title)}</h1>${inner}</main></body></html>`;
  return {
    status,
    headers: {
      ...BASE_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    },
    body: html,
  };
}

export async function handleUnsubscribeRequest(
  input: { method: string; token: string; formBody?: string },
  dispatch: TrustedMarketingDispatch,
  env: NodeJS.ProcessEnv = process.env
): Promise<PlainResponse> {
  const claims = verifyUnsubscribeToken(input.token, resolveUnsubscribeSecret(env));
  if (!claims) return page(400, 'Link inválido', '<p>Este link de descadastro é inválido ou foi alterado.</p>');
  const label = MARKETING_PURPOSE_LABELS[claims.purpose];
  const method = input.method.toUpperCase();
  if (method === 'GET') {
    const btn = 'display:block;width:100%;margin:8px 0;padding:10px;border-radius:6px;font-size:14px;cursor:pointer';
    return page(
      200,
      'Preferências de e-mail',
      `<p>Confirme o descadastro. Nada muda até você escolher uma opção.</p>` +
        `<form method="post"><input type="hidden" name="scope" value="PURPOSE"><button type="submit" style="${btn};background:#0f172a;color:#fff;border:0">Não quero mais receber: ${escapeHtml(label)}</button></form>` +
        `<form method="post"><input type="hidden" name="scope" value="ALL_MARKETING"><button type="submit" style="${btn};background:#fff;color:#0f172a;border:1px solid #cbd5e1">Não quero receber nenhum e-mail de marketing</button></form>`
    );
  }
  if (method !== 'POST') return page(405, 'Método não permitido', '<p>Use o link do e-mail.</p>');
  const params = new URLSearchParams(String(input.formBody || '').slice(0, 2000));
  const scope = params.get('scope') === 'ALL_MARKETING' ? 'ALL_MARKETING' : 'PURPOSE';
  const res = await dispatch('/api/marketing/unsubscribe-apply', { claims, scope });
  if (res.status >= 500) return page(503, 'Tente novamente', '<p>Não foi possível registrar agora. Tente novamente em instantes.</p>');
  const what = scope === 'ALL_MARKETING' ? 'nenhum e-mail de marketing' : `e-mails de ${escapeHtml(label)}`;
  return page(200, 'Descadastro confirmado', `<p>Pronto. Você não receberá mais ${what}. A alteração vale imediatamente.</p>`);
}

export async function handleResendWebhookRequest(
  input: { rawBody: string; headers: { get(name: string): string | null } },
  dispatch: TrustedMarketingDispatch,
  env: NodeJS.ProcessEnv = process.env,
  nowSec?: number
): Promise<PlainResponse> {
  const json = (status: number, body: unknown): PlainResponse => ({
    status,
    headers: { ...BASE_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const verify = verifySvixSignature(
    env.RESEND_WEBHOOK_SECRET,
    { id: input.headers.get('svix-id'), timestamp: input.headers.get('svix-timestamp'), signature: input.headers.get('svix-signature') },
    input.rawBody,
    nowSec
  );
  if (!verify.ok) return json(verify.reason === 'NO_SECRET' ? 503 : 401, { error: verify.reason });
  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    return json(400, { error: 'INVALID_JSON' });
  }
  const ev = normalizeResendEvent(String(input.headers.get('svix-id')), payload);
  if (!ev) return json(200, { ok: true, ignored: true });
  const res = await dispatch('/api/marketing/esp-events', { event: ev as unknown as Record<string, unknown> });
  // Falha => 5xx para o Resend reenviar (o processamento e idempotente).
  if (res.status !== 200) return json(500, { error: 'PROCESSING_FAILED' });
  return json(200, { ok: true });
}
