// ============================================================================
// STI-hub — Link ASSINADO de Proposta Comercial para o cliente (somente servidor).
//
//  - Segredo proprio: STI_HUB_PROPOSAL_LINK_SECRET (>= 32 caracteres), separado do
//    STI_HUB_SESSION_SECRET. A chave de assinatura e derivada (HMAC-SHA256 com rotulo),
//    entao um token de proposta nunca vale como sessao e vice-versa.
//  - Token: base64url(JSON{v,pid,ver,iat,exp,jti}) "." base64url(HMAC-SHA256).
//    Escopo: proposalId + versao + expiracao. Comparacao com timingSafeEqual.
//  - Validade: STI_HUB_PROPOSAL_LINK_TTL_DAYS (padrao 30), limitada ao teto de 90 dias.
//  - Fail-closed: em producao/preview, sem o segredo (ou com segredo curto), nenhum link
//    e emitido nem aceito. Em dev/testes usa um segredo aleatorio por processo.
//  - O token NUNCA e registrado em log/auditoria: so o `jti` (identificador aleatorio).
//  - STI_HUB_PROPOSAL_PUBLIC_APPROVE (padrao ligado): "false"/"0"/"off" desliga o aceite
//    pelo link (o link continua valendo para leitura).
// ============================================================================
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { SlidingWindowRateLimiter } from '../../api/password-reset';

export const PROPOSAL_LINK_DEFAULT_TTL_DAYS = 30;
export const PROPOSAL_LINK_MAX_TTL_DAYS = 90;
export const PROPOSAL_LINK_MIN_SECRET_LENGTH = 32;
const DAY_MS = 24 * 3600 * 1000;
const KEY_LABEL = 'stihub:proposal-public-link:v1';
const GLOBAL_DEV_SECRET_KEY = '__stihubProposalLinkDevSecret';

/** Corpo do 404 generico: identico para id inexistente, sem token, token invalido etc. */
export const PROPOSAL_NOT_FOUND_BODY = Object.freeze({ error: 'Proposta comercial não encontrada.' });

/** Headers de toda resposta das rotas publicas de proposta (e do emissor de link). */
export const PROPOSAL_PUBLIC_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
});

export function proposalNotFoundResponse(): { status: 404; body: { error: string }; headers: Record<string, string> } {
  return { status: 404, body: { ...PROPOSAL_NOT_FOUND_BODY }, headers: { ...PROPOSAL_PUBLIC_RESPONSE_HEADERS } };
}

function isProductionRuntime(): boolean {
  if (typeof process === 'undefined' || !process.env) return false;
  const vercelEnv = String(process.env.VERCEL_ENV || '').toLowerCase();
  if (vercelEnv === 'production' || vercelEnv === 'preview') return true;
  return process.env.NODE_ENV === 'production' && process.env.STI_HUB_ALLOW_DEV_SECRET !== 'true';
}

/** Segredo do link ou null (fail-closed em producao/preview). Nunca registrado. */
export function resolveProposalLinkSecret(): string | null {
  const configured = String(process.env.STI_HUB_PROPOSAL_LINK_SECRET || '').trim();
  if (configured.length >= PROPOSAL_LINK_MIN_SECRET_LENGTH) return configured;
  if (isProductionRuntime()) return null;
  const g = globalThis as unknown as Record<string, string | undefined>;
  if (!g[GLOBAL_DEV_SECRET_KEY]) g[GLOBAL_DEV_SECRET_KEY] = randomBytes(32).toString('hex');
  return g[GLOBAL_DEV_SECRET_KEY]!;
}

export function isProposalLinkConfigured(): boolean {
  return resolveProposalLinkSecret() !== null;
}

/** Validade em dias: STI_HUB_PROPOSAL_LINK_TTL_DAYS (padrao 30), entre 1 e o teto de 90. */
export function resolveProposalLinkTtlDays(): number {
  const raw = Number(process.env.STI_HUB_PROPOSAL_LINK_TTL_DAYS);
  if (!Number.isFinite(raw) || raw <= 0) return PROPOSAL_LINK_DEFAULT_TTL_DAYS;
  return Math.min(PROPOSAL_LINK_MAX_TTL_DAYS, Math.max(1, Math.floor(raw)));
}

/** Aceite pelo link ligado por padrao; "false"/"0"/"off"/"no" desliga. */
export function isProposalPublicApproveEnabled(): boolean {
  const v = String(process.env.STI_HUB_PROPOSAL_PUBLIC_APPROVE ?? '').trim().toLowerCase();
  return !(v === 'false' || v === '0' || v === 'off' || v === 'no');
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

/** Igualdade em tempo constante para strings de qualquer tamanho. */
function safeEqualStr(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

/** B3: assinatura = HMAC-SHA256 (32 bytes) em base64url sem padding. */
export const PROPOSAL_LINK_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface ProposalLinkClaims {
  v: 1;
  pid: string;
  ver: number;
  iat: number;
  exp: number;
  jti: string;
}

export class ProposalLinkSecretMissingError extends Error {
  constructor() {
    super('STI_HUB_PROPOSAL_LINK_SECRET ausente: links de proposta desativados (fail-closed).');
    this.name = 'ProposalLinkSecretMissingError';
  }
}

export class ProposalLinkExpiredProposalError extends Error {
  constructor() {
    super('Proposta com validade vencida: nao ha link a emitir.');
    this.name = 'ProposalLinkExpiredProposalError';
  }
}

/**
 * B1: fim do dia de validUntil (YYYY-MM-DD) no fuso de Brasilia (23:59:59.999 -03:00).
 * Valor ausente/invalido => null (vale so o TTL).
 */
export function proposalValidUntilEndMs(validUntil: unknown): number | null {
  const s = String(validUntil || '').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T23:59:59.999-03:00`);
  return Number.isFinite(ms) ? ms : null;
}

export function signProposalLinkToken(input: {
  proposalId: string;
  version: number;
  ttlDays?: number;
  nowMs?: number;
  /** B1: teto absoluto (ex.: fim do dia de validUntil). exp = min(TTL, notAfterMs). */
  notAfterMs?: number | null;
}): { token: string; claims: ProposalLinkClaims } {
  const secret = resolveProposalLinkSecret();
  if (!secret) throw new ProposalLinkSecretMissingError();
  const pid = String(input.proposalId || '').trim();
  if (!pid) throw new Error('proposalId obrigatorio.');
  const ver = Math.max(1, Math.floor(Number(input.version) || 1));
  const now = input.nowMs ?? Date.now();
  const days = Math.min(PROPOSAL_LINK_MAX_TTL_DAYS, Math.max(1, Math.floor(input.ttlDays ?? resolveProposalLinkTtlDays())));
  let exp = now + days * DAY_MS;
  if (typeof input.notAfterMs === 'number' && Number.isFinite(input.notAfterMs)) exp = Math.min(exp, input.notAfterMs);
  if (exp <= now) throw new ProposalLinkExpiredProposalError();
  const claims: ProposalLinkClaims = { v: 1, pid, ver, iat: now, exp, jti: randomBytes(9).toString('hex') };
  const payload = b64url(JSON.stringify(claims));
  const sig = b64url(createHmac('sha256', signingKey(secret)).update(payload, 'utf8').digest());
  return { token: `${payload}.${sig}`, claims };
}

export type ProposalLinkVerification = { valid: true; claims: ProposalLinkClaims } | { valid: false };

/**
 * Valida assinatura (timingSafeEqual), formato, expiracao, teto de validade e o escopo
 * (proposalId; a versao e conferida pelo chamador contra a versao atual da proposta).
 */
export function verifyProposalLinkToken(
  token: unknown,
  expected: { proposalId: string; nowMs?: number }
): ProposalLinkVerification {
  try {
    const secret = resolveProposalLinkSecret();
    if (!secret) return { valid: false };
    const raw = String(token || '').trim();
    if (!raw || raw.length > 1024) return { valid: false };
    const parts = raw.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return { valid: false };
    // B3: payload base64url e assinatura HMAC-SHA256 em base64url sem padding (43 chars).
    if (!/^[A-Za-z0-9_-]+$/.test(parts[0]) || !PROPOSAL_LINK_SIGNATURE_PATTERN.test(parts[1])) return { valid: false };
    const want = createHmac('sha256', signingKey(secret)).update(parts[0], 'utf8').digest();
    const got = fromB64url(parts[1]);
    const sigOk = got.length === want.length && timingSafeEqual(got, want);
    if (!sigOk) return { valid: false };
    const c = JSON.parse(fromB64url(parts[0]).toString('utf8')) as ProposalLinkClaims;
    if (!c || c.v !== 1 || typeof c.pid !== 'string' || typeof c.jti !== 'string') return { valid: false };
    if (!Number.isInteger(c.ver) || c.ver < 1) return { valid: false };
    if (!Number.isFinite(c.iat) || !Number.isFinite(c.exp)) return { valid: false };
    const now = expected.nowMs ?? Date.now();
    if (c.exp <= now) return { valid: false };
    if (c.iat > now + 5 * 60 * 1000) return { valid: false };
    if (c.exp - c.iat > PROPOSAL_LINK_MAX_TTL_DAYS * DAY_MS + 1000) return { valid: false };
    if (!safeEqualStr(c.pid, String(expected.proposalId || '').trim())) return { valid: false };
    return { valid: true, claims: c };
  } catch {
    return { valid: false };
  }
}

/**
 * A1: so para a metadata gravada — extrai do texto o primeiro token de link assinado VALIDO
 * e devolve apenas { jti, exp } (nunca o token). Token invalido/ausente => null.
 */
export function describeProposalLinkInText(text: unknown): { jti: string; exp: string; proposalId: string } | null {
  const s = typeof text === 'string' ? text : '';
  const m = s.match(/#t=([A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)/);
  if (!m) return null;
  try {
    const c = JSON.parse(fromB64url(m[1].split('.')[0]).toString('utf8')) as ProposalLinkClaims;
    const v = verifyProposalLinkToken(m[1], { proposalId: String(c?.pid || '') });
    if (!v.valid) return null;
    return { jti: v.claims.jti, exp: new Date(v.claims.exp).toISOString(), proposalId: v.claims.pid };
  } catch {
    return null;
  }
}

export { redactProposalLinkTokens, deepRedactProposalLinkTokens, PROPOSAL_LINK_TOKEN_REDACTED } from './proposal-link-redact';

/** URL para o cliente: o token vai no FRAGMENTO (#t=), que nao e enviado ao servidor nem ao Referer. */
export function buildSignedProposalUrl(origin: string, proposalId: string, token: string): string {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}/proposta/${encodeURIComponent(proposalId)}#t=${token}`;
}

// ----------------------------------------------------------------------------
// Aceite publico: corpo estrito (zod .strict()) e Idempotency-Key opcional.
// ----------------------------------------------------------------------------
export const publicProposalApproveSchema = z
  .object({
    signerName: z.string().max(160),
    signerCpf: z.string().max(20),
    signerRole: z.string().max(160),
    signerEmail: z.string().max(200).nullable().optional(),
    modality: z.enum(['ICP_BRASIL_A1', 'ICP_BRASIL_A3', 'GOV_BR_OURO']),
    acceptedTerms: z.literal(true),
  })
  .strict();

export function normalizeIdempotencyKey(raw: unknown): { ok: true; key: string | null } | { ok: false } {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { ok: true, key: null };
  const k = String(raw).trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(k)) return { ok: false };
  return { ok: true, key: k };
}

export function hashIdempotencyKey(key: string): string {
  return sha256(`stihub:proposal-approve-idem:v1:${key}`).toString('hex');
}

// ----------------------------------------------------------------------------
// Rate-limit (por instancia serverless, best-effort).
// ----------------------------------------------------------------------------
export const PROPOSAL_PUBLIC_VIEW_IP_LIMIT = { max: 120, windowMs: 10 * 60 * 1000 };
export const PROPOSAL_APPROVE_IP_LIMIT = { max: 10, windowMs: 10 * 60 * 1000 };
export const PROPOSAL_APPROVE_PER_PROPOSAL_LIMIT = { max: 5, windowMs: 10 * 60 * 1000 };
export const PROPOSAL_LINK_ISSUE_PER_USER_LIMIT = { max: 30, windowMs: 10 * 60 * 1000 };

export class ProposalPublicRateLimiters {
  readonly viewIp = new SlidingWindowRateLimiter(PROPOSAL_PUBLIC_VIEW_IP_LIMIT.max, PROPOSAL_PUBLIC_VIEW_IP_LIMIT.windowMs);
  readonly approveIp = new SlidingWindowRateLimiter(PROPOSAL_APPROVE_IP_LIMIT.max, PROPOSAL_APPROVE_IP_LIMIT.windowMs);
  readonly approveProposal = new SlidingWindowRateLimiter(
    PROPOSAL_APPROVE_PER_PROPOSAL_LIMIT.max,
    PROPOSAL_APPROVE_PER_PROPOSAL_LIMIT.windowMs
  );
  readonly issuePerUser = new SlidingWindowRateLimiter(
    PROPOSAL_LINK_ISSUE_PER_USER_LIMIT.max,
    PROPOSAL_LINK_ISSUE_PER_USER_LIMIT.windowMs
  );
}

export const PROPOSAL_TOO_MANY_BODY = Object.freeze({
  error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
  code: 'PROPOSAL_RATE_LIMITED',
});
