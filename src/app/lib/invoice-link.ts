// Link ASSINADO de fatura emitida para o cliente (somente servidor).
// Reusa o segredo e o TTL das propostas, com rotulo HMAC proprio: um token de fatura
// nunca vale como token de proposta (e vice-versa). O short link e o mesmo /p/<codigo>.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import {
  PROPOSAL_LINK_MAX_TTL_DAYS,
  PROPOSAL_LINK_MIN_SECRET_LENGTH,
  PROPOSAL_LINK_SIGNATURE_PATTERN,
  generateProposalShortCode,
  hashProposalShortCode,
  buildShortProposalUrl,
  isProposalLinkConfigured,
  resolveProposalLinkSecret,
  resolveProposalLinkTtlDays,
} from './proposal-link';

const KEY_LABEL = 'stihub:invoice-public-link:v1';
const DAY_MS = 24 * 3600 * 1000;

export const INVOICE_NOT_FOUND_BODY = Object.freeze({ error: 'Fatura não encontrada.' });

export function invoiceNotFoundResponse(): { status: 404; body: { error: string } } {
  return { status: 404, body: { ...INVOICE_NOT_FOUND_BODY } };
}

function signingKey(secret: string): Buffer {
  return createHmac('sha256', secret).update(KEY_LABEL, 'utf8').digest();
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sha256(v: string): Buffer {
  return createHash('sha256').update(v, 'utf8').digest();
}

function safeEqualStr(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

export interface InvoiceLinkClaims {
  v: 1;
  typ: 'invoice';
  iid: string;
  iat: number;
  exp: number;
  jti: string;
}

export function signInvoiceLinkToken(input: {
  invoiceId: string;
  ttlDays?: number;
  nowMs?: number;
}): { token: string; claims: InvoiceLinkClaims } {
  const secret = resolveProposalLinkSecret();
  if (!secret || secret.length < PROPOSAL_LINK_MIN_SECRET_LENGTH) {
    throw new Error('STI_HUB_PROPOSAL_LINK_SECRET ausente: links de fatura desativados (fail-closed).');
  }
  const iid = String(input.invoiceId || '').trim();
  if (!iid) throw new Error('invoiceId obrigatorio.');
  const now = input.nowMs ?? Date.now();
  const days = Math.min(PROPOSAL_LINK_MAX_TTL_DAYS, Math.max(1, Math.floor(input.ttlDays ?? resolveProposalLinkTtlDays())));
  const exp = now + days * DAY_MS;
  const claims: InvoiceLinkClaims = { v: 1, typ: 'invoice', iid, iat: now, exp, jti: randomBytes(9).toString('hex') };
  const payload = b64url(JSON.stringify(claims));
  const sig = b64url(createHmac('sha256', signingKey(secret)).update(payload, 'utf8').digest());
  return { token: `${payload}.${sig}`, claims };
}

export type InvoiceLinkVerification = { valid: true; claims: InvoiceLinkClaims } | { valid: false };

export function verifyInvoiceLinkToken(
  token: unknown,
  expected: { invoiceId: string; nowMs?: number }
): InvoiceLinkVerification {
  try {
    const secret = resolveProposalLinkSecret();
    if (!secret) return { valid: false };
    const raw = String(token || '').trim();
    if (!raw || raw.length > 1024) return { valid: false };
    const parts = raw.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return { valid: false };
    if (!/^[A-Za-z0-9_-]+$/.test(parts[0]) || !PROPOSAL_LINK_SIGNATURE_PATTERN.test(parts[1])) return { valid: false };
    const want = createHmac('sha256', signingKey(secret)).update(parts[0], 'utf8').digest();
    const got = fromB64url(parts[1]);
    if (got.length !== want.length) return { valid: false };
    const sigCanonical = safeEqualStr(b64url(got), parts[1]);
    const sigMatches = timingSafeEqual(got, want);
    if (!(Number(sigCanonical) & Number(sigMatches))) return { valid: false };
    const payloadBytes = fromB64url(parts[0]);
    if (!safeEqualStr(b64url(payloadBytes), parts[0])) return { valid: false };
    const c = JSON.parse(payloadBytes.toString('utf8')) as InvoiceLinkClaims;
    if (!c || c.v !== 1 || c.typ !== 'invoice' || typeof c.iid !== 'string' || typeof c.jti !== 'string') return { valid: false };
    if (!Number.isFinite(c.iat) || !Number.isFinite(c.exp)) return { valid: false };
    const now = expected.nowMs ?? Date.now();
    if (c.exp <= now) return { valid: false };
    if (c.iat > now + 5 * 60 * 1000) return { valid: false };
    if (c.exp - c.iat > PROPOSAL_LINK_MAX_TTL_DAYS * DAY_MS + 1000) return { valid: false };
    if (!safeEqualStr(c.iid, String(expected.invoiceId || '').trim())) return { valid: false };
    return { valid: true, claims: c };
  } catch {
    return { valid: false };
  }
}

export function signInvoiceLinkClaims(claims: InvoiceLinkClaims): string {
  const secret = resolveProposalLinkSecret();
  if (!secret) throw new Error('STI_HUB_PROPOSAL_LINK_SECRET ausente.');
  const c: InvoiceLinkClaims = {
    v: 1,
    typ: 'invoice',
    iid: String(claims.iid),
    iat: Number(claims.iat),
    exp: Number(claims.exp),
    jti: String(claims.jti),
  };
  const payload = b64url(JSON.stringify(c));
  const sig = b64url(createHmac('sha256', signingKey(secret)).update(payload, 'utf8').digest());
  return `${payload}.${sig}`;
}

export {
  isProposalLinkConfigured as isInvoiceLinkConfigured,
  generateProposalShortCode as generateInvoiceShortCode,
  hashProposalShortCode as hashInvoiceShortCode,
  buildShortProposalUrl as buildShortInvoiceUrl,
};
