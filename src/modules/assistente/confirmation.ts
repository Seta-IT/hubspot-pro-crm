// ============================================================================
// STI-hub — Assistente de IA: token assinado da proposta de acao e recibo de auditoria.
// HMAC-SHA256 com chave derivada do segredo de assinatura do STI-hub (dominio proprio).
// O token prende a acao ao usuario e a sessao: o servidor so executa o que o usuario viu.
// ============================================================================
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const b64u = (s: string | Buffer) => Buffer.from(s).toString('base64url');

function derivedKey(secret: string, domain: string): Buffer {
  return createHmac('sha256', secret).update(`stihub-assistente-v1:${domain}`).digest();
}

function sign(secret: string, domain: string, payload: object): string {
  const body = b64u(JSON.stringify(payload));
  const mac = createHmac('sha256', derivedKey(secret, domain)).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify<T>(secret: string, domain: string, token: unknown): T | null {
  if (typeof token !== 'string' || token.length > 16_000) return null;
  const [body, mac, extra] = token.split('.');
  if (!body || !mac || extra !== undefined) return null;
  const expected = createHmac('sha256', derivedKey(secret, domain)).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(mac, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const v = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return v && typeof v === 'object' ? (v as T) : null;
  } catch {
    return null;
  }
}

/** Liga o token a sessao sem guardar o token da sessao (so um prefixo do SHA-256). */
export function sessionBinding(sessionToken: string): string {
  return createHash('sha256').update(`assistente:${sessionToken}`).digest('hex').slice(0, 32);
}

export interface ActionTokenPayload {
  v: 1;
  uid: string;
  sid: string;
  tool: string;
  args: Record<string, unknown>;
  exp: number;
  n: string;
}

export function signActionToken(secret: string, p: Omit<ActionTokenPayload, 'v' | 'n'>): { token: string; nonce: string } {
  const n = randomBytes(12).toString('hex');
  return { token: sign(secret, 'acao', { v: 1, ...p, n }), nonce: n };
}

export type ActionTokenCheck =
  | { ok: true; payload: ActionTokenPayload }
  | { ok: false; code: 'TOKEN_INVALID' | 'TOKEN_EXPIRED' | 'TOKEN_OTHER_USER' };

export function verifyActionToken(secret: string, token: unknown, expect: { uid: string; sid: string; now: number }): ActionTokenCheck {
  const p = verify<ActionTokenPayload>(secret, 'acao', token);
  if (!p || p.v !== 1 || typeof p.tool !== 'string' || typeof p.n !== 'string' || !p.args || typeof p.args !== 'object') {
    return { ok: false, code: 'TOKEN_INVALID' };
  }
  if (p.uid !== expect.uid || p.sid !== expect.sid) return { ok: false, code: 'TOKEN_OTHER_USER' };
  if (!Number.isFinite(p.exp) || p.exp < expect.now) return { ok: false, code: 'TOKEN_EXPIRED' };
  return { ok: true, payload: p };
}

// ---------------------------------------------------------------------------
// Recibo de auditoria: so o servidor do assistente assina; o roteador confere antes de gravar.
// ---------------------------------------------------------------------------
export interface AuditReceipt {
  v: 1;
  uid: string;
  tool: string;
  tipo: 'leitura' | 'gravacao';
  modulo: 'CRM' | 'ERP' | 'CHAMADOS';
  ok: boolean;
  status: number;
  titulo: string;
  detalhe: string;
  registro?: string;
  at: number;
  n: string;
}

export const AUDIT_RECEIPT_MAX_AGE_MS = 2 * 60 * 1000;

export function signAuditReceipt(secret: string, r: Omit<AuditReceipt, 'v'>): string {
  return sign(secret, 'auditoria', { v: 1, ...r });
}

export function verifyAuditReceipt(secret: string, token: unknown, expect: { uid: string; now: number }): AuditReceipt | null {
  const r = verify<AuditReceipt>(secret, 'auditoria', token);
  if (!r || r.v !== 1 || r.uid !== expect.uid) return null;
  if (!Number.isFinite(r.at) || r.at > expect.now + 5_000 || expect.now - r.at > AUDIT_RECEIPT_MAX_AGE_MS) return null;
  if (!['CRM', 'ERP', 'CHAMADOS'].includes(r.modulo)) return null;
  return r;
}
