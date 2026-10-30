// ============================================================================
// STI-hub — Portal do Cliente: contrato de acesso publico (HOTFIX 29/10/2026).
//
// Regras (alinhadas com o supervisor de Chamados):
//  1. Nunca se lista sem filtro: GET /api/portal/tickets exige `key` (chave do chamado)
//     E `email` (e-mail do contato). Sem um deles => 400. Busca livre (`search`) nao existe mais.
//  2. Comparacao exata da chave e do e-mail (e-mail sem diferenciar maiusculas), em tempo
//     constante (SHA-256 + timingSafeEqual), percorrendo TODOS os chamados (sem curto-circuito).
//  3. Erro generico e identico para chave inexistente, e-mail errado ou chamado sem contato:
//     nao revela se o chamado existe.
//  4. Rate-limit por IP E por chave do chamado (janelas deslizantes em memoria, por instancia).
//  5. DTO publico minimo: chave, assunto, status, datas e comentarios publicos. Nada de CNPJ,
//     contrato, O.S., e-mails de terceiros, CC, ids internos ou comentarios internos.
//  6. Toda consulta (sucesso ou negada) gera registro de auditoria (modulo CHAMADOS), com o
//     e-mail mascarado.
//  7. Token HMAC por chamado (ticketId + email + exp), chave separada derivada do segredo do
//     servidor: PRONTO, mas ainda NAO aceito pelas rotas (SetaDesk, e-mails [SD-n]).
// ============================================================================
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import type { ServiceTicket, TicketStatus } from '../db/types';
import { resolveStiHubSigningSecret } from '../app/lib/auth';
import { SlidingWindowRateLimiter } from './password-reset';

export const PORTAL_GENERIC_DENIED_MESSAGE =
  'Não foi possível localizar um chamado com a chave e o e-mail informados. Confira os dados e tente novamente.';
export const PORTAL_MISSING_FILTER_MESSAGE =
  'Informe a chave do chamado (ex.: SD-123) e o e-mail do contato cadastrado no chamado.';
export const PORTAL_RATE_LIMIT_MESSAGE = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';

/** Limites (por instancia serverless): consultas e acoes publicas do portal. */
export const PORTAL_IP_LIMIT = { max: 20, windowMs: 10 * 60 * 1000 };
export const PORTAL_KEY_LIMIT = { max: 10, windowMs: 10 * 60 * 1000 };
export const PORTAL_CREATE_IP_LIMIT = { max: 5, windowMs: 60 * 60 * 1000 };

export interface PortalPublicComment {
  author: string;
  authorRole: 'AGENT' | 'CUSTOMER';
  body: string;
  createdAt: string;
}

export interface PortalPublicTicketDto {
  key: string;
  subject: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  comments: PortalPublicComment[];
}

export function normalizePortalEmail(v: unknown): string {
  return String(v ?? '').trim().toLowerCase().slice(0, 254);
}

export function normalizePortalKey(v: unknown): string {
  return String(v ?? '').trim().slice(0, 64);
}

function digest(v: string): Buffer {
  return createHash('sha256').update(v, 'utf8').digest();
}

/** Igualdade em tempo constante (independe do tamanho/conteudo). */
export function constantTimeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

export function maskEmailForAudit(email: string): string {
  const e = normalizePortalEmail(email);
  const at = e.indexOf('@');
  if (at <= 0) return e ? '***' : '(vazio)';
  return `${e.slice(0, 1)}***@${e.slice(at + 1)}`;
}

function looksLikeEmail(v: string): boolean {
  return /[^\s@]+@[^\s@]+/.test(v);
}

export function toPortalPublicTicketDto(t: ServiceTicket): PortalPublicTicketDto {
  return {
    key: t.key,
    subject: t.subject,
    status: t.status,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    resolvedAt: t.resolvedAt ?? null,
    comments: (t.comments || [])
      .filter((c) => c && c.isInternal === false)
      .map((c) => ({
        // Nome do autor so se nao for um e-mail (evita expor e-mails de terceiros).
        author:
          !c.author || looksLikeEmail(c.author)
            ? c.authorRole === 'CUSTOMER'
              ? 'Cliente'
              : 'Equipe Seta Telecom'
            : c.author,
        authorRole: c.authorRole === 'CUSTOMER' ? 'CUSTOMER' : 'AGENT',
        body: c.body,
        createdAt: c.createdAt,
      })),
  };
}

/**
 * Localiza o chamado SO se chave E e-mail do contato conferem. Percorre todos os chamados e
 * compara sempre os dois campos (sem curto-circuito), para nao vazar existencia por tempo.
 */
export function findPortalTicketByKeyAndEmail(
  tickets: ServiceTicket[],
  contactEmailOf: (t: ServiceTicket) => string | null | undefined,
  key: string,
  email: string
): ServiceTicket | null {
  const k = normalizePortalKey(key);
  const e = normalizePortalEmail(email);
  let found: ServiceTicket | null = null;
  for (const t of tickets) {
    const keyOk = constantTimeEqual(String(t.key || ''), k);
    const contactEmail = normalizePortalEmail(contactEmailOf(t) || '');
    // Sem e-mail de contato no chamado => nunca confere (compara com valor impossivel).
    const emailOk = constantTimeEqual(contactEmail || '\u0000sem-contato', e);
    if (keyOk && emailOk && !found) found = t;
  }
  return found;
}

export class PortalRateLimiters {
  readonly ip = new SlidingWindowRateLimiter(PORTAL_IP_LIMIT.max, PORTAL_IP_LIMIT.windowMs);
  readonly key = new SlidingWindowRateLimiter(PORTAL_KEY_LIMIT.max, PORTAL_KEY_LIMIT.windowMs);
  readonly createIp = new SlidingWindowRateLimiter(PORTAL_CREATE_IP_LIMIT.max, PORTAL_CREATE_IP_LIMIT.windowMs);
  /** Conta IP E chave (ambos sempre registram a tentativa). */
  allow(ip: string, key: string): boolean {
    const ipOk = this.ip.hit(`ip:${ip || 'sem-ip'}`);
    const keyOk = key ? this.key.hit(`key:${normalizePortalKey(key).toLowerCase()}`) : true;
    return ipOk && keyOk;
  }
}

// ----------------------------------------------------------------------------
// Token HMAC por chamado (PRONTO, AINDA NAO USADO pelas rotas). SetaDesk / e-mails [SD-n].
// Formato: base64url(JSON{v,tid,em,exp}) + "." + base64url(HMAC-SHA256(chave_portal, payload))
// chave_portal = HMAC-SHA256(segredo_do_servidor, "stihub:portal-ticket-access:v1")
// (chave separada: um token de portal nunca vale como sessao e vice-versa).
// ----------------------------------------------------------------------------
const PORTAL_TOKEN_KEY_LABEL = 'stihub:portal-ticket-access:v1';
export const PORTAL_TOKEN_MAX_TTL_MS = 30 * 24 * 3600 * 1000;

function portalTokenKey(): Buffer {
  return createHmac('sha256', resolveStiHubSigningSecret()).update(PORTAL_TOKEN_KEY_LABEL, 'utf8').digest();
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export interface PortalTicketTokenClaims {
  v: 1;
  tid: string;
  em: string;
  exp: number; // epoch ms
}

export function signPortalTicketAccessToken(input: {
  ticketId: string;
  email: string;
  expiresInMs?: number;
  nowMs?: number;
}): { token: string; claims: PortalTicketTokenClaims } {
  const now = input.nowMs ?? Date.now();
  const ttl = Math.min(Math.max(1000, input.expiresInMs ?? 7 * 24 * 3600 * 1000), PORTAL_TOKEN_MAX_TTL_MS);
  const tid = String(input.ticketId || '').trim();
  const em = normalizePortalEmail(input.email);
  if (!tid || !em) throw new Error('ticketId e email sao obrigatorios para o token do portal.');
  const claims: PortalTicketTokenClaims = { v: 1, tid, em, exp: now + ttl };
  const payload = b64url(JSON.stringify(claims));
  const sig = b64url(createHmac('sha256', portalTokenKey()).update(payload, 'utf8').digest());
  return { token: `${payload}.${sig}`, claims };
}

export function verifyPortalTicketAccessToken(
  token: string,
  expected?: { ticketId?: string; email?: string; nowMs?: number }
): { valid: true; claims: PortalTicketTokenClaims } | { valid: false } {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return { valid: false };
    const want = createHmac('sha256', portalTokenKey()).update(parts[0], 'utf8').digest();
    const got = fromB64url(parts[1]);
    if (got.length !== want.length || !timingSafeEqual(got, want)) return { valid: false };
    const claims = JSON.parse(fromB64url(parts[0]).toString('utf8')) as PortalTicketTokenClaims;
    if (claims?.v !== 1 || typeof claims.tid !== 'string' || typeof claims.em !== 'string') return { valid: false };
    if (!Number.isFinite(claims.exp) || claims.exp <= (expected?.nowMs ?? Date.now())) return { valid: false };
    if (expected?.ticketId !== undefined && !constantTimeEqual(claims.tid, String(expected.ticketId).trim())) {
      return { valid: false };
    }
    if (expected?.email !== undefined && !constantTimeEqual(claims.em, normalizePortalEmail(expected.email))) {
      return { valid: false };
    }
    return { valid: true, claims };
  } catch {
    return { valid: false };
  }
}
