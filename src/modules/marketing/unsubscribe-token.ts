// ============================================================================
// STI-hub — Fase 3: token assinado do descadastro (List-Unsubscribe / rodape).
// Formato: <payload base64url>.<HMAC-SHA256 base64url (32 bytes)>; payload = {v,c,m,p}
// (contato, campanha, finalidade). Sem e-mail no token. Comparacao em tempo constante.
// URL: <origem>/api/marketing/preferences/unsubscribe/<token>
// ============================================================================
import crypto from 'node:crypto';
import { isMarketingPurpose, type MarketingPurpose } from './marketing-config';

export const UNSUBSCRIBE_PATH_PREFIX = '/api/marketing/preferences/unsubscribe/';
export const UNSUBSCRIBE_TOKEN_RE = /^[A-Za-z0-9_-]{10,400}\.[A-Za-z0-9_-]{43}$/;

export interface UnsubscribeClaims {
  contactId: string;
  campaignId: string;
  purpose: MarketingPurpose;
}

export function resolveUnsubscribeSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const s = String(env.MARKETING_UNSUBSCRIBE_SECRET || '').trim();
  return s.length >= 32 ? s : null;
}

function mac(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(`stihub-mkt-unsub:v1:${payload}`).digest('base64url');
}

export function signUnsubscribeToken(claims: UnsubscribeClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, c: claims.contactId, m: claims.campaignId, p: claims.purpose }), 'utf8').toString('base64url');
  return `${payload}.${mac(secret, payload)}`;
}

export function verifyUnsubscribeToken(token: string, secret: string | null): UnsubscribeClaims | null {
  if (!secret || typeof token !== 'string' || !UNSUBSCRIBE_TOKEN_RE.test(token)) return null;
  const [payload, sig] = token.split('.');
  const want = Buffer.from(mac(secret, payload));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try {
    const j = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { v?: number; c?: unknown; m?: unknown; p?: unknown };
    if (j.v !== 1 || typeof j.c !== 'string' || typeof j.m !== 'string' || !isMarketingPurpose(j.p)) return null;
    if (!/^[A-Za-z0-9_.:@-]{1,120}$/.test(j.c) || !/^[A-Za-z0-9_.:-]{1,120}$/.test(j.m)) return null;
    return { contactId: j.c, campaignId: j.m, purpose: j.p };
  } catch {
    return null;
  }
}

export function buildUnsubscribeUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}${UNSUBSCRIBE_PATH_PREFIX}${token}`;
}
