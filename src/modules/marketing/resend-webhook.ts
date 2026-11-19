// ============================================================================
// STI-hub — Fase 3: webhook do Resend (Svix). Verifica assinatura HMAC-SHA256 sobre
// "<svix-id>.<svix-timestamp>.<corpo bruto>" com o segredo whsec_ (RESEND_WEBHOOK_SECRET),
// tolerancia de 5 min contra replay. Normaliza eventos para o funil / supressao.
// ============================================================================
import crypto from 'node:crypto';
import type { MarketingEventType } from './marketing-store';

export const RESEND_WEBHOOK_PATH = '/api/marketing/webhooks/resend';
export const WEBHOOK_TOLERANCE_SEC = 5 * 60;

export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export type WebhookVerifyResult = { ok: true } | { ok: false; reason: 'NO_SECRET' | 'MISSING_HEADERS' | 'STALE' | 'BAD_SIGNATURE' };

function secretBytes(secret: string): Buffer | null {
  const s = secret.trim();
  const b64 = s.startsWith('whsec_') ? s.slice(6) : s;
  try {
    const buf = Buffer.from(b64, 'base64');
    return buf.length >= 16 ? buf : null;
  } catch {
    return null;
  }
}

export function signSvixPayload(secret: string, id: string, timestamp: string, body: string): string {
  const key = secretBytes(secret);
  if (!key) throw new Error('segredo de webhook inválido');
  return `v1,${crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
}

export function verifySvixSignature(
  secret: string | undefined | null,
  headers: SvixHeaders,
  rawBody: string,
  nowSec: number = Math.floor(Date.now() / 1000)
): WebhookVerifyResult {
  const key = secret ? secretBytes(secret) : null;
  if (!key) return { ok: false, reason: 'NO_SECRET' };
  if (!headers.id || !headers.timestamp || !headers.signature) return { ok: false, reason: 'MISSING_HEADERS' };
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > WEBHOOK_TOLERANCE_SEC) return { ok: false, reason: 'STALE' };
  const expected = crypto.createHmac('sha256', key).update(`${headers.id}.${headers.timestamp}.${rawBody}`).digest();
  for (const part of headers.signature.split(' ')) {
    const [ver, sig] = part.split(',', 2);
    if (ver !== 'v1' || !sig) continue;
    let got: Buffer;
    try {
      got = Buffer.from(sig, 'base64');
    } catch {
      continue;
    }
    if (got.length === expected.length && crypto.timingSafeEqual(got, expected)) return { ok: true };
  }
  return { ok: false, reason: 'BAD_SIGNATURE' };
}

export interface NormalizedEspEvent {
  providerEventId: string;
  type: MarketingEventType;
  providerMessageId: string | null;
  recipient: string | null;
  campaignId: string | null;
  contactId: string | null;
  at: string;
  detail: string | null;
}

function readTags(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(raw)) {
    for (const t of raw) if (t && typeof t === 'object' && 'name' in t) out[String((t as any).name)] = String((t as any).value ?? '');
  } else if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) out[k] = String(v ?? '');
  }
  return out;
}

/** null = evento ignorado (tipo nao relevante). */
export function normalizeResendEvent(providerEventId: string, payload: unknown): NormalizedEspEvent | null {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, any>;
  const data = (p.data && typeof p.data === 'object' ? p.data : {}) as Record<string, any>;
  const kind = String(p.type || '');
  let type: MarketingEventType | null = null;
  let detail: string | null = null;
  switch (kind) {
    case 'email.sent':
      type = 'SENT';
      break;
    case 'email.delivered':
      type = 'DELIVERED';
      break;
    case 'email.delivery_delayed':
      type = 'DELIVERY_DELAYED';
      break;
    case 'email.bounced': {
      const bt = String(data.bounce?.type || '').toLowerCase();
      // Resend: "Permanent" (hard) | "Transient"/"Undetermined" (soft). Sem tipo => tratar como hard (conservador).
      type = bt && bt !== 'permanent' ? 'BOUNCED_SOFT' : 'BOUNCED_HARD';
      detail = [data.bounce?.type, data.bounce?.subType].filter(Boolean).join('/').slice(0, 120) || null;
      break;
    }
    case 'email.complained':
      type = 'COMPLAINED';
      break;
    case 'email.opened':
      type = 'OPENED';
      break;
    case 'email.clicked':
      type = 'CLICKED';
      detail = typeof data.click?.link === 'string' ? data.click.link.slice(0, 300) : null;
      break;
    default:
      return null;
  }
  const tags = readTags(data.tags);
  const to = Array.isArray(data.to) ? data.to[0] : data.to;
  return {
    providerEventId: `resend:${providerEventId}`,
    type,
    providerMessageId: typeof data.email_id === 'string' ? data.email_id : null,
    recipient: typeof to === 'string' ? to.toLowerCase() : null,
    campaignId: tags.campaign_id || null,
    contactId: tags.contact_id || null,
    at: typeof p.created_at === 'string' ? p.created_at : new Date().toISOString(),
    detail,
  };
}
