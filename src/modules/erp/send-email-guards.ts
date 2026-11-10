/** Regras do parecer CISO sobre POST /api/communications/send-email (HTML, destinatários, anexos). */

import { validateEmail } from '../data-health/validators';

export const MAX_EMAIL_RECIPIENTS = 20;

export const INVOICE_ATTACHMENT_KINDS = ['receipt', 'remessa', 'boleto', 'pix'] as const;
export type InvoiceAttachmentKind = (typeof INVOICE_ATTACHMENT_KINDS)[number];

const UNTRUSTED_ATTACHMENT_KEYS = [
  'content',
  'url',
  'path',
  'href',
  'filepath',
  'contentUrl',
  'content_url',
  'src',
  'data',
  'file',
  'buffer',
] as const;

export type ParsedRecipients =
  | { ok: true; to: string[]; cc: string[]; bcc: string[]; total: number }
  | { ok: false; error: string; code: 'EMAIL_RECIPIENT_INVALID' | 'EMAIL_RECIPIENT_LIMIT' };

export function parseEmailList(raw: unknown): { ok: true; emails: string[] } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, emails: [] };
  if (typeof raw !== 'string' && !Array.isArray(raw)) {
    return { ok: false, error: 'A lista de destinatários é inválida.' };
  }
  const parts = (Array.isArray(raw) ? raw.map((x) => String(x)) : String(raw).split(','))
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  const emails: string[] = [];
  for (const part of parts) {
    const check = validateEmail(part);
    if (!check.isValid) {
      return { ok: false, error: `O e-mail "${part}" é inválido.` };
    }
    emails.push(check.normalizedEmail);
  }
  return { ok: true, emails };
}

export function collectEmailRecipients(input: { to?: unknown; cc?: unknown; bcc?: unknown }): ParsedRecipients {
  const to = parseEmailList(input.to);
  if (!to.ok) return { ok: false, error: to.error, code: 'EMAIL_RECIPIENT_INVALID' };
  const cc = parseEmailList(input.cc);
  if (!cc.ok) return { ok: false, error: cc.error, code: 'EMAIL_RECIPIENT_INVALID' };
  const bcc = parseEmailList(input.bcc);
  if (!bcc.ok) return { ok: false, error: bcc.error, code: 'EMAIL_RECIPIENT_INVALID' };
  if (to.emails.length < 1) {
    return { ok: false, error: 'Informe pelo menos um destinatário válido em "to".', code: 'EMAIL_RECIPIENT_INVALID' };
  }
  const total = to.emails.length + cc.emails.length + bcc.emails.length;
  if (total > MAX_EMAIL_RECIPIENTS) {
    return {
      ok: false,
      error: `O envio aceita no máximo ${MAX_EMAIL_RECIPIENTS} destinatários (to, cc e bcc somados).`,
      code: 'EMAIL_RECIPIENT_LIMIT',
    };
  }
  return { ok: true, to: to.emails, cc: cc.emails, bcc: bcc.emails, total };
}

export function escapeEmailHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** HTML do e-mail montado no servidor a partir do texto (sem HTML do cliente). */
export function buildEmailHtmlFromText(text: string): string {
  const escaped = escapeEmailHtml(text);
  return `<div style="font-family:sans-serif;font-size:13px;color:#0f172a;"><pre style="white-space:pre-wrap;font-family:sans-serif;font-size:13px;line-height:1.5;">${escaped}</pre></div>`;
}

/** O cliente tentou mandar conteúdo, URL ou path de anexo — recusar. */
export function clientProvidedAttachmentPayload(body: Record<string, unknown>): boolean {
  const list = body.attachments;
  if (!Array.isArray(list)) return false;
  return list.some((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const rec = item as Record<string, unknown>;
    return UNTRUSTED_ATTACHMENT_KEYS.some((key) => rec[key] != null && String(rec[key]).trim() !== '');
  });
}

export function normalizeInvoiceAttachmentKinds(raw: unknown): InvoiceAttachmentKind[] {
  const list = Array.isArray(raw) ? raw : [];
  const allowed = new Set<string>(INVOICE_ATTACHMENT_KINDS);
  const out: InvoiceAttachmentKind[] = [];
  for (const item of list) {
    const kind = String(item || '').trim() as InvoiceAttachmentKind;
    if (allowed.has(kind) && !out.includes(kind)) out.push(kind);
    if (out.length >= 4) break;
  }
  return out;
}
