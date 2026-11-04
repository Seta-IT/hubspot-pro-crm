// ============================================================================
// STI-hub — Cifra dos tokens das caixas Outlook (04/11/2026).
// AES-256-GCM, IV aleatorio por gravacao, AAD com o id da caixa. Chave propria:
// STI_HUB_MAILBOX_ENC_KEY (32 bytes em base64url), nunca derivada de outro segredo.
// Sem chave => recurso desligado (as rotas respondem com aviso neutro).
// ============================================================================
import crypto from 'node:crypto';

export class MailboxEncKeyMissingError extends Error {
  readonly code = 'MAILBOX_ENC_KEY_MISSING';
  constructor() {
    super('Chave de criptografia das caixas de e-mail ausente ou invalida.');
  }
}

export function resolveMailboxEncKey(): Buffer {
  const raw = String((typeof process !== 'undefined' && process.env.STI_HUB_MAILBOX_ENC_KEY) || '').trim();
  if (!raw || !/^[A-Za-z0-9_-]+={0,2}$/.test(raw)) throw new MailboxEncKeyMissingError();
  const key = Buffer.from(raw.replace(/=+$/, ''), 'base64url');
  if (key.length !== 32) throw new MailboxEncKeyMissingError();
  return key;
}

export function isMailboxEncKeyConfigured(): boolean {
  try {
    resolveMailboxEncKey();
    return true;
  } catch {
    return false;
  }
}

/** Formato: v1.<iv>.<tag>.<cifra> (base64url). */
export function sealMailboxSecret(plain: string, aad: string, key: Buffer = resolveMailboxEncKey()): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(`stihub-mailbox:${aad}`, 'utf8'));
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}

export function openMailboxSecret(sealed: string, aad: string, key: Buffer = resolveMailboxEncKey()): string {
  const [v, iv, tag, enc] = String(sealed || '').split('.');
  if (v !== 'v1' || !iv || !tag || enc === undefined) throw new Error('MAILBOX_SECRET_INVALID');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAAD(Buffer.from(`stihub-mailbox:${aad}`, 'utf8'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
}
