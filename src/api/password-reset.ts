// ============================================================================
// STI-hub — "Esqueci minha senha" (29/10/2026)
//  - Token HMAC-SHA256 (chave separada por dominio da chave de sessao), 30 min.
//  - Vinculado a versao da senha (hash + data da troca): uso unico, invalidado
//    automaticamente quando a senha muda.
//  - Rate-limit em memoria por IP e por e-mail (por instancia serverless).
// Somente servidor (Node.js runtime).
// ============================================================================
import crypto from 'crypto';
import { constantTimeEqual, resolveStiHubSigningSecret } from '../app/lib/auth';

export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
export const PASSWORD_RESET_MIN_LENGTH = 6;
const TOKEN_PREFIX = 'PWR1-';

export interface PasswordResetClaims {
  typ: 'pwr';
  uid: string;
  email: string;
  pv: string;
  nonce: string;
  iat: number;
  exp: number;
}

function resetKey(): string {
  return `STIHUB-PWRESET-V1:${resolveStiHubSigningSecret()}`;
}

function sign(payloadB64: string): string {
  return crypto.createHmac('sha256', resetKey()).update(payloadB64).digest('base64url');
}

/** Versao da senha = data da ultima troca/redefinicao ('' se nunca redefinida). */
export function passwordVersionOf(user: { passwordChangedAt?: string | null }): string {
  return String(user.passwordChangedAt || '');
}

/**
 * Token so vale se a senha NAO mudou desde a emissao (uso unico: a propria
 * redefinicao grava passwordChangedAt >= iat e invalida o token).
 */
export function isPasswordResetTokenStale(
  claims: Pick<PasswordResetClaims, 'iat' | 'pv'>,
  user: { passwordChangedAt?: string | null }
): boolean {
  const current = passwordVersionOf(user);
  if (!current) return false;
  if (current === claims.pv) return false;
  const t = Date.parse(current);
  // Troca anterior a emissao nao importa; troca na emissao ou depois invalida o token.
  return !Number.isFinite(t) || t >= claims.iat;
}

export function signPasswordResetToken(input: { uid: string; email: string; pv: string; now?: number }): {
  token: string;
  claims: PasswordResetClaims;
} {
  const now = input.now ?? Date.now();
  const claims: PasswordResetClaims = {
    typ: 'pwr',
    uid: input.uid,
    email: input.email.toLowerCase(),
    pv: input.pv,
    nonce: crypto.randomBytes(12).toString('base64url'),
    iat: now,
    exp: now + PASSWORD_RESET_TTL_MS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return { token: `${TOKEN_PREFIX}${payloadB64}.${sign(payloadB64)}`, claims };
}

export function verifyPasswordResetToken(
  token: unknown,
  now: number = Date.now()
): { ok: true; claims: PasswordResetClaims } | { ok: false; reason: 'INVALID' | 'EXPIRED' } {
  if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX) || token.length > 2000) {
    return { ok: false, reason: 'INVALID' };
  }
  const parts = token.slice(TOKEN_PREFIX.length).split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'INVALID' };
  let expected: string;
  try {
    expected = sign(parts[0]);
  } catch {
    return { ok: false, reason: 'INVALID' };
  }
  if (!constantTimeEqual(parts[1], expected)) return { ok: false, reason: 'INVALID' };
  try {
    const c = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as PasswordResetClaims;
    if (!c || c.typ !== 'pwr' || !c.uid || !c.email || typeof c.pv !== 'string' || !c.nonce) return { ok: false, reason: 'INVALID' };
    if (typeof c.exp !== 'number' || now > c.exp) return { ok: false, reason: 'EXPIRED' };
    return { ok: true, claims: c };
  } catch {
    return { ok: false, reason: 'INVALID' };
  }
}

// ---------------------------------------------------------------------------
// Rate-limit simples (janela deslizante, em memoria)
// ---------------------------------------------------------------------------
export class SlidingWindowRateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly limit: number, private readonly windowMs: number) {}
  /** Registra a tentativa e devolve true se ainda estiver dentro do limite. */
  hit(key: string, now: number = Date.now()): boolean {
    const k = String(key || '').toLowerCase();
    const arr = (this.hits.get(k) || []).filter((t) => now - t < this.windowMs);
    arr.push(now);
    this.hits.set(k, arr);
    if (this.hits.size > 5000) {
      for (const [hk, hv] of this.hits) {
        if (!hv.some((t) => now - t < this.windowMs)) this.hits.delete(hk);
      }
    }
    return arr.length <= this.limit;
  }
}

export const FORGOT_PASSWORD_GENERIC_MESSAGE =
  'Se o e-mail informado pertencer a um usuário ativo do STI-hub, você receberá em instantes um link para redefinir a senha (válido por 30 minutos). Verifique também a caixa de spam.';

export function buildPasswordResetEmailHtml(p: { userName: string; resetUrl: string; expiresAt: string }): string {
  const esc = (v: string) =>
    String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  const exp = new Date(p.expiresAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const u = esc(p.resetUrl);
  return `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0"><tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;border:1px solid #e5e7eb"><tr><td style="padding:28px 32px">
<h1 style="font-size:20px;margin:0 0 16px;font-weight:600">Redefinição de senha do STI-hub</h1>
<p style="font-size:14px;line-height:1.6;margin:0 0 12px">Olá, ${esc(p.userName)}.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 20px">Recebemos um pedido para redefinir a senha da sua conta no STI-hub (Seta Telecom). Clique no botão abaixo para cadastrar uma nova senha. Depois, faça login normalmente com a nova senha e o seu código de verificação em 2 etapas.</p>
<p style="margin:0 0 24px"><a href="${u}" style="display:inline-block;background:#0f4c81;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-size:14px;font-weight:600">Redefinir senha</a></p>
<p style="font-size:12px;line-height:1.6;color:#6b7280;margin:0 0 8px">Este link é válido por 30 minutos (até ${esc(exp)}, horário de Brasília), pode ser usado uma única vez e é pessoal: não o encaminhe.</p>
<p style="font-size:12px;line-height:1.6;color:#6b7280;margin:0">Se você não pediu a redefinição, ignore este e-mail: a sua senha atual continua valendo.</p>
</td></tr></table></td></tr></table></body></html>`;
}
