// ============================================================================
// STI-hub — Authentication, Signed Session (HMAC-SHA256) & Real MFA 2FA Engine
// Supports:
//  1. Google Authenticator (Real RFC 6238 TOTP / HMAC-SHA1 / Pure Base32 / ISO 18004 QR Code SVG)
//  2. Corporate Email OTP (6-digit cryptographic code, TTL expiration, max attempts & rate-limit)
// Edge Runtime, Node.js and Browser compatible.
// ============================================================================

import QRCode from 'qrcode';
import { INITIAL_STIHUB_USERS, StiHubRole, StiHubUserAccount } from './rbac';
import type {
  StiHubCrmPermissions,
  StiHubErpPermissions,
  StiHubMacroModule,
  StiHubUserModuleAccess,
} from '../../db/types';

export const STIHUB_SESSION_COOKIE = 'stihub_session';
export const STIHUB_SESSION_STORAGE_KEY = 'stihub_active_session_v1';

const GLOBAL_EPHEMERAL_SECRET_KEY = '__STIHUB_EPHEMERAL_SIGNING_SECRET_V1__';
let productionSecretWarningLogged = false;

export interface StiHubSessionPayload {
  userId: string;
  name: string;
  email: string;
  role: StiHubRole;
  department: string;
  mfaVerified: boolean;
  mfaMethod: 'TOTP_AUTHENTICATOR' | 'EMAIL_OTP';
  enabledModules?: StiHubMacroModule[];
  moduleAccess?: StiHubUserModuleAccess;
  issuedAt: string;
}

export interface StiHubSignedSessionClaims {
  uid: string;
  email: string;
  name: string;
  roleId: string;
  scope: string;
  enabledModules: StiHubMacroModule[];
  moduleAccess: StiHubUserModuleAccess;
  crmPermissions?: StiHubCrmPermissions;
  erpPermissions?: StiHubErpPermissions;
  /** Tipo de conta ERP efetivo (ERP_ADMIN, ERP_COMMERCIAL, ...), usado pelo middleware. */
  erpRole?: string;
  /** Hotfix 29/10/2026: alcada de admin IAM efetiva no login (assinada), usada pelo middleware. */
  canManageUsersRbac?: boolean;
  /** Reverificacao MFA (step-up) concluida com a sessao ja autenticada (epoch ms). */
  mfaStepUpAt?: number;
  mfaVerified: boolean;
  mfaMethod: 'TOTP_AUTHENTICATOR' | 'EMAIL_OTP';
  iat: number;
  exp: number;
}

// ============================================================================
// UTF-8, BASE64URL & BASE32 (RFC 4648) HELPERS
// ============================================================================

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function utf8ToBytes(str: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str);
  }
  return new Uint8Array(Buffer.from(str, 'utf8'));
}

export function bytesToUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(bytes).toString('utf8');
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function base64UrlEncodeBytes(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlEncodeString(str: string): string {
  return base64UrlEncodeBytes(utf8ToBytes(str));
}

export function base64UrlDecodeToString(b64url: string): string {
  const clean = String(b64url || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const pad = clean.length % 4 === 0 ? '' : '='.repeat(4 - (clean.length % 4));
  const b64 = clean + pad;
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64, 'base64').toString('utf8');
  }
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytesToUtf8(bytes);
}

export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function decodeBase32(base32Input: string): Uint8Array {
  const clean = String(base32Input || '')
    .toUpperCase()
    .replace(/=+$/g, '')
    .replace(/[^A-Z2-7]/g, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function isValidPureBase32Secret(secret: string | undefined | null): boolean {
  if (!secret || typeof secret !== 'string') return false;
  const clean = secret.trim().toUpperCase().replace(/\s+/g, '');
  if (clean.length < 16 || clean.length > 64) return false;
  return /^[A-Z2-7]+$/.test(clean);
}

export function formatBase32SecretBlocks(secret: string): string {
  const clean = String(secret || '')
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, '');
  return clean.replace(/(.{4})/g, '$1 ').trim();
}

// ============================================================================
// PURE SHA-1, HMAC-SHA1 (RFC 6238 TOTP) & SHA-256, HMAC-SHA256 (EDGE-SAFE)
// ============================================================================

function rol32(n: number, bits: number): number {
  return ((n << bits) | (n >>> (32 - bits))) >>> 0;
}

function ror32(n: number, bits: number): number {
  return ((n >>> bits) | (n << (32 - bits))) >>> 0;
}

export function sha1Bytes(msg: Uint8Array): Uint8Array {
  const ml = msg.length;
  const bitLenHi = Math.floor((ml * 8) / 0x100000000);
  const bitLenLo = (ml * 8) >>> 0;
  const padLen = ((ml + 9 + 63) & ~63);
  const padded = new Uint8Array(padLen);
  padded.set(msg);
  padded[ml] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padLen - 8, bitLenHi, false);
  dv.setUint32(padLen - 4, bitLenLo, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  for (let offset = 0; offset < padLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = dv.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 80; i++) {
      w[i] = rol32(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i++) {
      let f = 0;
      let k = 0;
      if (i < 20) {
        f = ((b & c) | (~b & d)) >>> 0;
        k = 0x5a827999;
      } else if (i < 40) {
        f = (b ^ c ^ d) >>> 0;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = ((b & c) | (b & d) | (c & d)) >>> 0;
        k = 0x8f1bbcdc;
      } else {
        f = (b ^ c ^ d) >>> 0;
        k = 0xca62c1d6;
      }
      const temp = (rol32(a, 5) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = rol32(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = new Uint8Array(20);
  const outDv = new DataView(out.buffer);
  outDv.setUint32(0, h0, false);
  outDv.setUint32(4, h1, false);
  outDv.setUint32(8, h2, false);
  outDv.setUint32(12, h3, false);
  outDv.setUint32(16, h4, false);
  return out;
}

export function hmacSha1Bytes(key: Uint8Array, message: Uint8Array): Uint8Array {
  const blockSize = 64;
  let k = key;
  if (k.length > blockSize) {
    k = sha1Bytes(k);
  }
  const oKeyPad = new Uint8Array(blockSize);
  const iKeyPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    const kb = i < k.length ? k[i] : 0;
    oKeyPad[i] = kb ^ 0x5c;
    iKeyPad[i] = kb ^ 0x36;
  }
  const inner = new Uint8Array(blockSize + message.length);
  inner.set(iKeyPad);
  inner.set(message, blockSize);
  const innerHash = sha1Bytes(inner);

  const outer = new Uint8Array(blockSize + innerHash.length);
  outer.set(oKeyPad);
  outer.set(innerHash, blockSize);
  return sha1Bytes(outer);
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Bytes(msg: Uint8Array): Uint8Array {
  const ml = msg.length;
  const bitLenHi = Math.floor((ml * 8) / 0x100000000);
  const bitLenLo = (ml * 8) >>> 0;
  const padLen = (ml + 9 + 63) & ~63;
  const padded = new Uint8Array(padLen);
  padded.set(msg);
  padded[ml] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padLen - 8, bitLenHi, false);
  dv.setUint32(padLen - 4, bitLenLo, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let offset = 0; offset < padLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = dv.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = ror32(w[i - 15], 7) ^ ror32(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = ror32(w[i - 2], 17) ^ ror32(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = ror32(e, 6) ^ ror32(e, 11) ^ ror32(e, 25);
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = ror32(a, 2) ^ ror32(a, 13) ^ ror32(a, 22);
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outDv = new DataView(out.buffer);
  outDv.setUint32(0, h0, false);
  outDv.setUint32(4, h1, false);
  outDv.setUint32(8, h2, false);
  outDv.setUint32(12, h3, false);
  outDv.setUint32(16, h4, false);
  outDv.setUint32(20, h5, false);
  outDv.setUint32(24, h6, false);
  outDv.setUint32(28, h7, false);
  return out;
}

export function sha256Hex(input: string): string {
  return bytesToHex(sha256Bytes(utf8ToBytes(input)));
}

export function hmacSha256Bytes(key: Uint8Array, message: Uint8Array): Uint8Array {
  const blockSize = 64;
  let k = key;
  if (k.length > blockSize) {
    k = sha256Bytes(k);
  }
  const oKeyPad = new Uint8Array(blockSize);
  const iKeyPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    const kb = i < k.length ? k[i] : 0;
    oKeyPad[i] = kb ^ 0x5c;
    iKeyPad[i] = kb ^ 0x36;
  }
  const inner = new Uint8Array(blockSize + message.length);
  inner.set(iKeyPad);
  inner.set(message, blockSize);
  const innerHash = sha256Bytes(inner);

  const outer = new Uint8Array(blockSize + innerHash.length);
  outer.set(oKeyPad);
  outer.set(innerHash, blockSize);
  return sha256Bytes(outer);
}

export function hmacSha256Base64Url(secret: string, message: string): string {
  return base64UrlEncodeBytes(hmacSha256Bytes(utf8ToBytes(secret), utf8ToBytes(message)));
}

// ============================================================================
// REAL RFC 6238 GOOGLE AUTHENTICATOR TOTP ENGINE + ISO/IEC 18004 QR CODE
// ============================================================================

/**
 * Generates a 20-byte (160-bit) RFC 4648 pure Base32 secret (32 chars, only A-Z and 2-7).
 * If `seedIdentifier` is provided, derives a deterministic Base32 secret for that user;
 * otherwise uses cryptographically secure random bytes.
 */
export function generateTotpSecretBase32(seedIdentifier?: string): string {
  if (seedIdentifier) {
    const digest = sha256Bytes(
      utf8ToBytes(`SETA-TELECOM-14806925000132-TOTP-SECRET-V1:${seedIdentifier.toLowerCase().trim()}`)
    );
    return encodeBase32(digest.slice(0, 20));
  }
  const randomBytes = new Uint8Array(20);
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(randomBytes);
  } else {
    for (let i = 0; i < 20; i++) {
      randomBytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return encodeBase32(randomBytes);
}

/**
 * Computes a standard RFC 6238 / RFC 4226 6-digit TOTP code for a Base32 secret.
 */
export function computeRfc6238Totp(
  secretBase32: string,
  timestampMs: number = Date.now(),
  windowOffset = 0,
  stepSeconds = 30,
  digits = 6
): {
  code: string;
  secondsRemaining: number;
  counter: number;
} {
  const keyBytes = decodeBase32(secretBase32);
  const nowSec = Math.floor(timestampMs / 1000);
  const counter = Math.floor(nowSec / stepSeconds) + windowOffset;
  const secondsRemaining = stepSeconds - (nowSec % stepSeconds);

  const counterBytes = new Uint8Array(8);
  const dv = new DataView(counterBytes.buffer);
  const hi = Math.floor(counter / 0x100000000);
  const lo = counter >>> 0;
  dv.setUint32(0, hi, false);
  dv.setUint32(4, lo, false);

  const hmac = hmacSha1Bytes(keyBytes, counterBytes);
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const mod = Math.pow(10, digits);
  const code = String(binary % mod).padStart(digits, '0');
  return { code, secondsRemaining, counter };
}

/**
 * Verifies a 6-digit Google Authenticator TOTP code against a Base32 secret
 * strictly in the current active 30-second window (allowedDriftWindows = 0 by default)
 * so expired 30s tokens are immediately rejected.
 */
export function verifyRfc6238Totp(
  secretBase32: string,
  inputCode: string,
  timestampMs: number = Date.now(),
  allowedDriftWindows = 0
): boolean {
  const clean = String(inputCode || '').replace(/\D+/g, '');
  if (clean.length !== 6 || !secretBase32) return false;
  for (let w = -allowedDriftWindows; w <= allowedDriftWindows; w++) {
    const expected = computeRfc6238Totp(secretBase32, timestampMs, w).code;
    if (clean === expected) {
      return true;
    }
  }
  return false;
}

/**
 * Builds standard Google Authenticator `otpauth://totp/...` URI.
 */
export function buildOtpAuthUri(params: {
  secretBase32: string;
  email: string;
  accountName?: string;
  issuer?: string;
}): string {
  const issuer = params.issuer || 'STI-hub Seta Telecom';
  const account = params.email || params.accountName || 'usuario@setatelecom.com.br';
  const cleanSecret = String(params.secretBase32 || '')
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, '');
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const qs = [
    `secret=${encodeURIComponent(cleanSecret)}`,
    `issuer=${encodeURIComponent(issuer)}`,
    'algorithm=SHA1',
    'digits=6',
    'period=30',
  ].join('&');
  return `otpauth://totp/${label}?${qs}`;
}

/**
 * Generates a REAL, ISO/IEC 18004 compliant QR Code SVG Data URL using `qrcode.create`
 * that can be scanned by Google Authenticator, Microsoft Authenticator, Authy, iOS Camera, or Android.
 */
export function buildTotpQrCodeSvgDataUrl(otpAuthUri: string, _secretBase32?: string): string {
  const qr = QRCode.create(otpAuthUri, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const data = qr.modules.data;
  const cell = 4;
  const quietZone = 4 * cell;
  const total = size * cell + quietZone * 2;

  let pathData = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (data[r * size + c]) {
        const x = quietZone + c * cell;
        const y = quietZone + r * cell;
        pathData += `M${x},${y}h${cell}v${cell}h-${cell}z`;
      }
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${total}" height="${total}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#ffffff"/><path d="${pathData}" fill="#000000"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Generates a deterministic 6-digit TOTP code for the current 30-second window.
 */
export function generateTotpCodeSync(
  secretBase32?: string,
  timestampMs: number = Date.now()
): string {
  // Revisao 7706b4a: sem fallback. Sem segredo valido nao ha codigo (antes caia no segredo
  // legado do Marcéllo, derivado so do e-mail com salt publico).
  if (!secretBase32 || !isValidPureBase32Secret(secretBase32)) return '';
  return computeRfc6238Totp(secretBase32, timestampMs, 0).code;
}

export function computeCurrentTotpCode(windowOffset = 0, secretBase32?: string): {
  code: string;
  secondsRemaining: number;
} {
  const nowSec = Math.floor(Date.now() / 1000);
  if (!secretBase32 || !isValidPureBase32Secret(secretBase32)) {
    return { code: '', secondsRemaining: 30 - (nowSec % 30) };
  }
  const res = computeRfc6238Totp(secretBase32, Date.now(), windowOffset);
  return { code: res.code, secondsRemaining: res.secondsRemaining };
}

export function verifyMfaCode(inputCode: string, secretBase32?: string): boolean {
  const clean = String(inputCode || '').replace(/\D+/g, '');
  if (clean.length !== 6) return false;
  // Revisao 7706b4a: falha fechada. Sem segredo valido NAO cai no segredo legado
  // (derivado so do e-mail com salt publico, calculavel por qualquer cliente).
  if (!secretBase32 || !isValidPureBase32Secret(secretBase32)) return false;
  return verifyRfc6238Totp(secretBase32, clean, Date.now(), 0);
}

// ============================================================================
// PASSWORD HASHING & VERIFICATION
// ============================================================================

export function hashCorporatePassword(password: string): string {
  return sha256Hex(`SETA-TELECOM-SALT-14806925000132:${String(password || '').trim()}`);
}

export function verifyCorporatePassword(
  inputPassword: string | undefined,
  storedPasswordHash?: string
): boolean {
  const clean = String(inputPassword ?? '').trim();
  if (clean.length < 6) return false;
  if (storedPasswordHash) {
    const candidateHash = hashCorporatePassword(clean);
    if (constantTimeEqual(candidateHash, storedPasswordHash)) return true;
  }
  // Seguranca (contencao 29/10/2026): NAO existem mais senhas-mestras nem aceite de
  // qualquer senha para usuario sem hash proprio. Sem hash => login negado (use o convite).
  return false;
}

/** Comparacao de strings em tempo constante (assinaturas HMAC / hashes). */
export function constantTimeEqual(a: string, b: string): boolean {
  const sa = String(a ?? '');
  const sb = String(b ?? '');
  let diff = sa.length ^ sb.length;
  const len = Math.max(sa.length, sb.length);
  for (let i = 0; i < len; i++) {
    diff |= (sa.charCodeAt(i) || 0) ^ (sb.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** Epoca da rotacao de TOTP: pareamentos anteriores a esta epoca nao valem mais. */
export const STIHUB_TOTP_ROTATION_EPOCH = '2026-10-29-r1';
/** Cookie (nao sensivel) que indica pareamento concluido nesta epoca de rotacao. */
export const STIHUB_TOTP_ENROLLED_COOKIE = 'stihub_totp_enrolled_r1';

export class StiHubSigningSecretMissingError extends Error {
  constructor() {
    super('STI_HUB_SESSION_SECRET ausente em producao: autenticacao bloqueada (fail-closed).');
    this.name = 'StiHubSigningSecretMissingError';
  }
}

function isStiHubProductionRuntime(): boolean {
  if (typeof process === 'undefined' || !process.env) return false;
  const vercelEnv = String(process.env.VERCEL_ENV || '').toLowerCase();
  if (vercelEnv === 'production' || vercelEnv === 'preview') return true;
  return process.env.NODE_ENV === 'production' && process.env.STI_HUB_ALLOW_DEV_SECRET !== 'true';
}

// ============================================================================
// HMAC-SHA256 SIGNED SESSION TOKEN (JWT-STYLE COMPACT TOKEN)
// ============================================================================

export function resolveStiHubSigningSecret(): string {
  if (typeof process !== 'undefined' && process.env) {
    const configuredSecret =
      process.env.STI_HUB_SESSION_SECRET?.trim() ||
      process.env.NEXTAUTH_SECRET?.trim() ||
      process.env.AUTH_SECRET?.trim();
    if (configuredSecret && configuredSecret.length >= 16) {
      return configuredSecret;
    }

    if (isStiHubProductionRuntime()) {
      if (!productionSecretWarningLogged) {
        productionSecretWarningLogged = true;
        console.error(
          '[STI-hub Security] STI_HUB_SESSION_SECRET ausente em producao/preview. Autenticacao bloqueada (fail-closed) ate a variavel ser configurada.'
        );
      }
      throw new StiHubSigningSecretMissingError();
    }
  }

  // Somente desenvolvimento local / testes: chave derivada deterministica.
  const globalScope = globalThis as unknown as Record<string, string | undefined>;
  if (!globalScope[GLOBAL_EPHEMERAL_SECRET_KEY]) {
    // Deterministic across Node.js runtime, Next.js Edge Middleware isolate, and Browser
    // so tokens signed in /api/auth/verify-mfa are always verified identically in src/middleware.ts.
    const primaryUser = INITIAL_STIHUB_USERS[0];
    const domainSeed = [
      STIHUB_SESSION_COOKIE,
      STIHUB_SESSION_STORAGE_KEY,
      primaryUser?.id || 'usr-marcelo',
      primaryUser?.email || 'marcelo@setatelecom.com.br',
      primaryUser?.hubspotOwnerId || '31598215',
      primaryUser?.gestaoClickUserId || '203922',
      'PBKDF-HMAC-SHA256-V2',
    ].join('::');
    const round1 = sha256Bytes(utf8ToBytes(domainSeed));
    const round2 = sha256Bytes(utf8ToBytes(`${bytesToHex(round1)}::${domainSeed}`));
    globalScope[GLOBAL_EPHEMERAL_SECRET_KEY] = bytesToHex(round2);
  }
  return globalScope[GLOBAL_EPHEMERAL_SECRET_KEY]!;
}

export interface StiHubMfaChallengeClaims {
  cid: string;
  uid: string;
  email: string;
  mfaMethod: "TOTP_AUTHENTICATOR" | "EMAIL_OTP";
  totpSecret: string;
  emailOtpHash?: string;
  iat: number;
  exp: number;
}

export interface StiHubUserInviteClaims {
  iid: string;
  uid: string;
  email: string;
  name: string;
  phone?: string;
  department?: string;
  jobTitle?: string;
  roleId: string;
  crmRole?: string;
  erpRole?: string;
  scope: string;
  enabledModules: StiHubMacroModule[];
  mfaEnabled: boolean;
  mfaMethod: "TOTP_AUTHENTICATOR" | "EMAIL_OTP";
  totpSecret: string;
  iat: number;
  exp: number;
}

export function signUserInviteToken(
  claims: StiHubUserInviteClaims,
  secret: string = resolveStiHubSigningSecret()
): string {
  const payloadB64 = base64UrlEncodeString(JSON.stringify(claims));
  const sigB64 = hmacSha256Base64Url(secret, payloadB64);
  return `INV-${payloadB64}.${sigB64}`;
}

export function verifyUserInviteToken(
  token: string | null | undefined,
  secretInput?: string
): { valid: boolean; claims: StiHubUserInviteClaims | null; reason: string } {
  if (!token || typeof token !== "string") {
    return { valid: false, claims: null, reason: "MISSING_INVITE_TOKEN" };
  }
  let secret: string;
  try {
    secret = secretInput || resolveStiHubSigningSecret();
  } catch {
    return { valid: false, claims: null, reason: "SIGNING_SECRET_UNAVAILABLE" };
  }
  let cleaned = token.trim();
  if (cleaned.includes("%")) {
    try {
      cleaned = decodeURIComponent(cleaned);
    } catch {
      // keep raw
    }
  }
  if (!cleaned.startsWith("INV-")) {
    return { valid: false, claims: null, reason: "INVALID_INVITE_PREFIX" };
  }
  const stripped = cleaned.slice(4);
  const parts = stripped.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, claims: null, reason: "MALFORMED_INVITE_TOKEN" };
  }
  const [payloadB64, sigB64] = parts;
  const expectedSig = hmacSha256Base64Url(secret, payloadB64);
  if (!constantTimeEqual(sigB64, expectedSig)) {
    return { valid: false, claims: null, reason: "INVALID_INVITE_SIGNATURE" };
  }
  try {
    const parsed = JSON.parse(base64UrlDecodeToString(payloadB64)) as StiHubUserInviteClaims;
    if (!parsed || !parsed.email || !parsed.uid) {
      return { valid: false, claims: null, reason: "INVALID_INVITE_CLAIMS" };
    }
    if (parsed.exp && Date.now() > parsed.exp) {
      return { valid: false, claims: null, reason: "INVITE_EXPIRED" };
    }
    return { valid: true, claims: parsed, reason: "INVITE_VALID" };
  } catch {
    return { valid: false, claims: null, reason: "INVALID_INVITE_JSON" };
  }
}

export function signMfaChallengeToken(
  claims: StiHubMfaChallengeClaims,
  secret: string = resolveStiHubSigningSecret()
): string {
  const payloadB64 = base64UrlEncodeString(JSON.stringify(claims));
  const sigB64 = hmacSha256Base64Url(secret, payloadB64);
  return `MFA-${payloadB64}.${sigB64}`;
}

/**
 * Pacote A (29/10): prefixos de cid por FLUXO. Cada desafio so vale no seu fluxo:
 *  - LOGIN: MFA- (senha validada) e OTP-MAIL-LOGIN- (e-mail do login)
 *  - STEPUP: STEPUP- (TOTP da sessao) e OTP-MAIL-STEPUP- (e-mail da reverificacao)
 * O antigo OTP-MAIL- (sem fluxo) nao vale em nenhum dos dois.
 */
export const MFA_CHALLENGE_CID_PREFIX = {
  LOGIN_PASSWORD: 'MFA-',
  LOGIN_EMAIL: 'OTP-MAIL-LOGIN-',
  STEPUP_TOTP: 'STEPUP-',
  STEPUP_EMAIL: 'OTP-MAIL-STEPUP-',
} as const;
export type MfaChallengeFlow = 'LOGIN' | 'STEPUP';
export function mfaChallengeFlowOf(cid: string | null | undefined): MfaChallengeFlow | null {
  const c = String(cid || '');
  if (c.startsWith(MFA_CHALLENGE_CID_PREFIX.STEPUP_EMAIL) || c.startsWith(MFA_CHALLENGE_CID_PREFIX.STEPUP_TOTP)) return 'STEPUP';
  if (c.startsWith(MFA_CHALLENGE_CID_PREFIX.LOGIN_EMAIL) || c.startsWith(MFA_CHALLENGE_CID_PREFIX.LOGIN_PASSWORD)) return 'LOGIN';
  return null;
}
export function isEmailOtpChallengeCid(cid: string | null | undefined): boolean {
  const c = String(cid || '');
  return c.startsWith(MFA_CHALLENGE_CID_PREFIX.LOGIN_EMAIL) || c.startsWith(MFA_CHALLENGE_CID_PREFIX.STEPUP_EMAIL);
}

export function verifyMfaChallengeToken(
  token: string | null | undefined,
  secretInput?: string
): StiHubMfaChallengeClaims | null {
  if (!token || typeof token !== "string" || !token.startsWith("MFA-")) return null;
  let secret: string;
  try {
    secret = secretInput || resolveStiHubSigningSecret();
  } catch {
    return null;
  }
  const stripped = token.slice(4);
  const parts = stripped.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  const expectedSig = hmacSha256Base64Url(secret, payloadB64);
  if (!constantTimeEqual(sigB64, expectedSig)) return null;
  try {
    const parsed = JSON.parse(base64UrlDecodeToString(payloadB64)) as StiHubMfaChallengeClaims;
    if (!parsed || !parsed.email || (parsed.exp && Date.now() > parsed.exp)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function signStiHubSessionToken(
  claims: StiHubSignedSessionClaims,
  secret: string = resolveStiHubSigningSecret()
): string {
  const payloadB64 = base64UrlEncodeString(JSON.stringify(claims));
  const sigB64 = hmacSha256Base64Url(secret, payloadB64);
  return `${payloadB64}.${sigB64}`;
}

export function verifyStiHubSessionToken(
  rawToken: string | null | undefined,
  secretInput?: string
): {
  valid: boolean;
  claims: StiHubSignedSessionClaims | null;
  reason: string;
} {
  if (!rawToken || typeof rawToken !== 'string') {
    return { valid: false, claims: null, reason: 'MISSING_SESSION_TOKEN' };
  }
  let secret: string;
  try {
    secret = secretInput || resolveStiHubSigningSecret();
  } catch {
    return { valid: false, claims: null, reason: 'SIGNING_SECRET_UNAVAILABLE' };
  }
  let cleaned = rawToken.trim();
  if (cleaned.includes('%')) {
    try {
      cleaned = decodeURIComponent(cleaned);
    } catch {
      // keep raw
    }
  }

  // 1. Signed format: <payloadB64Url>.<hmacSha256B64Url>
  if (cleaned.includes('.')) {
    const parts = cleaned.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return { valid: false, claims: null, reason: 'MALFORMED_SIGNED_TOKEN' };
    }
    const [payloadB64, providedSig] = parts;
    const expectedSig = hmacSha256Base64Url(secret, payloadB64);
    if (!constantTimeEqual(providedSig, expectedSig)) {
      return { valid: false, claims: null, reason: 'INVALID_HMAC_SIGNATURE' };
    }
    try {
      const parsed = JSON.parse(base64UrlDecodeToString(payloadB64)) as StiHubSignedSessionClaims;
      if (!parsed || !parsed.email || !parsed.mfaVerified) {
        return { valid: false, claims: null, reason: 'MFA_NOT_VERIFIED_IN_CLAIMS' };
      }
      // Contas de servico nunca usam sessao/cookie (somente Bearer com allowlist).
      if (
        String(parsed.uid || '').toLowerCase().startsWith('svc-') ||
        String(parsed.email || '').toLowerCase().endsWith('@servico.sti-hub')
      ) {
        return { valid: false, claims: null, reason: 'SERVICE_ACCOUNT_SESSION_FORBIDDEN' };
      }
      if (parsed.exp && Date.now() > parsed.exp) {
        return { valid: false, claims: null, reason: 'SESSION_EXPIRED' };
      }
      return { valid: true, claims: parsed, reason: 'MFA_SESSION_VERIFIED' };
    } catch {
      return { valid: false, claims: null, reason: 'INVALID_CLAIMS_JSON' };
    }
  }

  // 2. Tokens sem assinatura HMAC (formato legado base64 JSON) NAO sao mais aceitos:
  // qualquer pessoa poderia forjar {"email":..., "mfaVerified":true} e burlar o middleware.
  return { valid: false, claims: null, reason: 'UNSIGNED_TOKEN_REJECTED' };
}

export function encodeSessionCookie(session: StiHubSessionPayload): string {
  const enabledModules: StiHubMacroModule[] = session.enabledModules || ['CRM', 'ERP', 'CHAMADOS'];
  const moduleAccess: StiHubUserModuleAccess = session.moduleAccess || {
    crm: enabledModules.includes('CRM'),
    erp: enabledModules.includes('ERP'),
    chamados: enabledModules.includes('CHAMADOS'),
  };
  return signStiHubSessionToken({
    uid: session.userId,
    email: session.email,
    name: session.name,
    roleId: session.role,
    scope: 'TODOS',
    enabledModules,
    moduleAccess,
    mfaVerified: session.mfaVerified,
    mfaMethod: session.mfaMethod,
    iat: Date.now(),
    exp: Date.now() + 24 * 3600 * 1000,
  });
}

export function decodeSessionCookie(raw: string | undefined | null): StiHubSessionPayload | null {
  const verified = verifyStiHubSessionToken(raw);
  if (!verified.valid || !verified.claims) return null;
  const c = verified.claims;
  return {
    userId: c.uid,
    name: c.name,
    email: c.email,
    role: (c.roleId as StiHubRole) || 'SUPER_ADMIN',
    department: 'Seta Telecom',
    mfaVerified: c.mfaVerified,
    mfaMethod: c.mfaMethod,
    enabledModules: c.enabledModules,
    moduleAccess: c.moduleAccess,
    issuedAt: new Date(c.iat).toISOString(),
  };
}

export function setClientSessionCookie(session: StiHubSessionPayload): void {
  if (typeof window === 'undefined') return;
  const encoded = encodeSessionCookie(session);
  const secureFlag = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${STIHUB_SESSION_COOKIE}=${encodeURIComponent(encoded)}; path=/; max-age=86400; SameSite=Lax${secureFlag}`;
  document.cookie = `stihub_logged_out=; path=/; max-age=0; SameSite=Lax`;
  try {
    window.localStorage.setItem(STIHUB_SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // ignore
  }
}

export function clearClientSessionCookie(): void {
  if (typeof window === 'undefined') return;
  document.cookie = `${STIHUB_SESSION_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  document.cookie = `stihub_logged_out=1; path=/; max-age=86400; SameSite=Lax`;
  try {
    window.localStorage.removeItem(STIHUB_SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function getClientSession(): StiHubSessionPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const match = document.cookie
      .split('; ')
      .find((row) => row.startsWith(`${STIHUB_SESSION_COOKIE}=`));
    if (match) {
      const val = match.split('=')[1];
      const parsed = decodeSessionCookie(val);
      if (parsed) return parsed;
    }
    const rawLocal = window.localStorage.getItem(STIHUB_SESSION_STORAGE_KEY);
    if (rawLocal) {
      const parsed = JSON.parse(rawLocal) as StiHubSessionPayload;
      if (parsed?.mfaVerified) return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

export function findStiHubUserByEmail(email: string): StiHubUserAccount | null {
  const clean = String(email || '').trim().toLowerCase();
  return (
    INITIAL_STIHUB_USERS.find((u) => u.email.toLowerCase() === clean) ||
    (clean.includes('marcelo') ? INITIAL_STIHUB_USERS[0] : null)
  );
}

export const STIHUB_IAM_USERS_STORAGE_KEY = "stihub_iam_users_override_v1";

export function loadClientIamUsersOverride(): Array<Record<string, unknown>> {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STIHUB_IAM_USERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveClientIamUserOverride(user: Record<string, unknown> | null | undefined): void {
  if (typeof window === "undefined" || !user || typeof user !== "object") return;
  try {
    const current = loadClientIamUsersOverride();
    const id = String(user.id || "");
    const email = String(user.email || "").toLowerCase();
    const filtered = current.filter(
      (u) =>
        (id ? String(u.id || "") !== id : true) &&
        (email ? String(u.email || "").toLowerCase() !== email : true)
    );
    // Contencao 29/10/2026: nunca guardar senha em claro, hash ou segredo TOTP no navegador.
    // A persistencia entre instancias usa o campo opaco iamSeal emitido pelo servidor.
    const safeUser: Record<string, unknown> = { ...user };
    for (const k of ["password", "passwordHash", "totpSecret", "totpSecretFormatted", "lastUsedTotpTimeStep"]) {
      delete safeUser[k];
    }
    filtered.unshift(safeUser);
    window.localStorage.setItem(STIHUB_IAM_USERS_STORAGE_KEY, JSON.stringify(filtered.slice(0, 50)));
  } catch {
    // ignore storage quota errors
  }
}

export const STIHUB_IAM_DELETED_USERS_STORAGE_KEY = "stihub_iam_deleted_users_v1";

export function loadClientDeletedUsersOverride(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STIHUB_IAM_DELETED_USERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

export function saveClientDeletedUserOverride(userId?: string, email?: string): void {
  if (typeof window === "undefined") return;
  try {
    const deleted = new Set(loadClientDeletedUsersOverride());
    if (userId) deleted.add(String(userId).trim());
    if (email) deleted.add(String(email).trim().toLowerCase());
    window.localStorage.setItem(
      STIHUB_IAM_DELETED_USERS_STORAGE_KEY,
      JSON.stringify(Array.from(deleted))
    );

    // Also remove from STIHUB_IAM_USERS_STORAGE_KEY if present
    const current = loadClientIamUsersOverride();
    const filtered = current.filter(
      (u) =>
        (userId ? String(u.id || "") !== String(userId) : true) &&
        (email ? String(u.email || "").toLowerCase() !== String(email).toLowerCase() : true)
    );
    window.localStorage.setItem(STIHUB_IAM_USERS_STORAGE_KEY, JSON.stringify(filtered));
  } catch {
    // ignore
  }
}
