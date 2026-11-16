/**
 * Assinatura Eletrônica Gov.br (ITI), manual de integração:
 * https://manual-integracao-assinatura-eletronica.servicos.gov.br/pt-br/latest/iniciarintegracao.html
 *
 * Homologação: cas.staging.iti.br e assinatura-api.staging.iti.br
 * Produção: cas.iti.br e assinatura-api.iti.br
 *
 * O scope `sign` autoriza um único uso do token. Como precisamos do certificado
 * (nome/CPF) e depois do PKCS#7, o fluxo usa `signature_session`.
 * Access token, code e client_secret não saem deste módulo e não são registrados.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

export type GovBrEnv = 'staging' | 'production';

export interface GovBrSignConfig {
  clientId: string;
  clientSecret: string;
  env: GovBrEnv;
  redirectUri: string;
  authorizeUrl: string;
  tokenUrl: string;
  certificateUrl: string;
  pkcs7Url: string;
}

const HOSTS: Record<GovBrEnv, { cas: string; api: string }> = {
  staging: { cas: 'https://cas.staging.iti.br', api: 'https://assinatura-api.staging.iti.br' },
  production: { cas: 'https://cas.iti.br', api: 'https://assinatura-api.iti.br' },
};

export const GOVBR_OAUTH_SCOPE = 'signature_session';

export function govBrOptionLabel(enabled: boolean): string {
  return enabled ? 'Assinatura Eletrônica Gov.br (ITI)' : 'Aceite eletrônico';
}

export function readGovBrSignConfig(env: NodeJS.ProcessEnv = process.env): GovBrSignConfig | null {
  const clientId = String(env.GOVBR_SIGN_CLIENT_ID || '').trim();
  const clientSecret = String(env.GOVBR_SIGN_CLIENT_SECRET || '').trim();
  const rawEnv = String(env.GOVBR_SIGN_ENV || '').trim().toLowerCase();
  const redirectUri = String(env.GOVBR_SIGN_REDIRECT_URI || '').trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  if (rawEnv !== 'staging' && rawEnv !== 'production') return null;
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') return null;
  const hosts = HOSTS[rawEnv];
  return {
    clientId,
    clientSecret,
    env: rawEnv,
    redirectUri,
    authorizeUrl: `${hosts.cas}/oauth2.0/authorize`,
    tokenUrl: `${hosts.cas}/oauth2.0/token`,
    certificateUrl: `${hosts.api}/externo/v2/certificadoPublico`,
    pkcs7Url: `${hosts.api}/externo/v2/assinarPKCS7`,
  };
}

export function isGovBrSignEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return readGovBrSignConfig(env) !== null;
}

function b64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(value: string): Buffer {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function signState(payload: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(payload).digest());
}

export interface GovBrStateClaims {
  v: 1;
  pid: string;
  exp: number;
  nonce: string;
  tokenHash: string;
  role: string;
  returnPath: string;
}

/** Liga o state ao token do link (ou à sessão) sem gravar o token. */
export function hashBoundToken(token: string): string {
  return createHash('sha256').update(`stihub:govbr-link:${token}`).digest('hex');
}

export function issueGovBrState(input: {
  proposalId: string;
  boundToken: string;
  role: string;
  returnPath: string;
  secret: string;
  nowMs?: number;
  nonce?: string;
}): { state: string; nonce: string } {
  const nonce = input.nonce || randomBytes(16).toString('hex');
  const claims: GovBrStateClaims = {
    v: 1,
    pid: String(input.proposalId || '').trim(),
    exp: (input.nowMs ?? Date.now()) + 10 * 60 * 1000,
    nonce,
    tokenHash: hashBoundToken(input.boundToken),
    role: String(input.role || 'Signatário').slice(0, 160),
    returnPath: input.returnPath,
  };
  const payload = b64url(JSON.stringify(claims));
  return { state: `${payload}.${signState(payload, input.secret)}`, nonce };
}

export function readGovBrState(state: string, secret: string, nowMs = Date.now()): GovBrStateClaims | null {
  const parts = String(state || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = signState(parts[0], secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(parts[1]);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(fromB64url(parts[0]).toString('utf8')) as GovBrStateClaims;
    if (!claims || claims.v !== 1 || !claims.pid || !claims.nonce || !claims.tokenHash) return null;
    if (!Number.isFinite(claims.exp) || claims.exp < nowMs) return null;
    if (!claims.returnPath || !isSafeReturnPath(claims.returnPath)) return null;
    return claims;
  } catch {
    return null;
  }
}

export function isSafeReturnPath(value: string): boolean {
  return /^\/(?:proposta|p)\/[A-Za-z0-9._~%-]{1,120}$/.test(value);
}

export function issueGovBrResult(input: {
  proposalId: string;
  name: string;
  cpf: string;
  secret: string;
  nowMs?: number;
}): string {
  const payload = b64url(JSON.stringify({
    v: 1,
    pid: input.proposalId,
    name: input.name,
    cpf: input.cpf,
    exp: (input.nowMs ?? Date.now()) + 10 * 60 * 1000,
  }));
  return `${payload}.${signState(payload, input.secret)}`;
}

export function readGovBrResult(value: string, secret: string, nowMs = Date.now()): { proposalId: string; name: string; cpf: string } | null {
  const parts = String(value || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = signState(parts[0], secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(parts[1]);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(fromB64url(parts[0]).toString('utf8')) as { v: number; pid: string; name: string; cpf: string; exp: number };
    if (claims.v !== 1 || !claims.pid || !claims.name || !claims.cpf || claims.exp < nowMs) return null;
    return { proposalId: claims.pid, name: claims.name, cpf: claims.cpf };
  } catch {
    return null;
  }
}

export function buildGovBrAuthorizeUrl(config: GovBrSignConfig, state: string, nonce: string): string {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', GOVBR_OAUTH_SCOPE);
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  return url.toString();
}

export async function exchangeGovBrCode(
  config: GovBrSignConfig,
  code: string,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(code || '').trim(),
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
  });
  const res = await fetchImpl(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  const json = (await res.json().catch(() => null)) as { access_token?: string } | null;
  const token = json && typeof json.access_token === 'string' ? json.access_token : '';
  if (!res.ok || !token) throw new Error('GOVBR_TOKEN_EXCHANGE_FAILED');
  return token;
}

export async function fetchGovBrCertificate(
  config: GovBrSignConfig,
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const res = await fetchImpl(config.certificateUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/x-pem-file, text/plain, */*' },
  });
  const text = await res.text();
  if (!res.ok || !text.includes('BEGIN CERTIFICATE')) throw new Error('GOVBR_CERTIFICATE_FAILED');
  return text;
}

export async function signGovBrPkcs7(
  config: GovBrSignConfig,
  accessToken: string,
  hashBase64: string,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const res = await fetchImpl(config.pkcs7Url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: '*/*' },
    body: JSON.stringify({ hashBase64 }),
  });
  if (!res.ok) throw new Error('GOVBR_PKCS7_FAILED');
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('base64');
}

export function sha256Base64(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('base64');
}

/** Nome e CPF no certificado Gov.br. O CN usual é "NOME:CPF". */
export function parseGovBrCertificateIdentity(pem: string): { name: string; cpf: string } | null {
  const der = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  let text = '';
  try {
    text = Buffer.from(der, 'base64').toString('latin1');
  } catch {
    return null;
  }
  const match = text.match(/([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'´-]{4,120}?):(\d{11})/);
  if (!match) return null;
  const cpf = match[2];
  if (!isCpf(cpf)) return null;
  return { name: match[1].replace(/\s+/g, ' ').trim(), cpf };
}

function isCpf(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(digits[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(9) === Number(digits[9]) && calc(10) === Number(digits[10]);
}

export interface ProposalHashInput {
  id: string;
  code?: string;
  companyName?: string;
  title?: string;
  monthly?: number;
  months?: number;
  items?: Array<{ description?: string; quantity?: number; unitPrice?: number }>;
  internalNotes?: string;
}

/** PDF mínimo e estável da proposta comercial. Não inclui internalNotes. */
export function proposalSignaturePdf(input: ProposalHashInput): Uint8Array {
  const lines = [
    'SETA TELECOM | PROPOSTA COMERCIAL',
    `Codigo: ${input.code || ''}`,
    `Id: ${input.id}`,
    `Cliente: ${input.companyName || ''}`,
    `Titulo: ${input.title || ''}`,
    `Valor mensal: ${Number(input.monthly || 0).toFixed(2)}`,
    `Prazo meses: ${Number(input.months || 0)}`,
    ...(input.items || []).map(
      (item, index) =>
        `Item ${index + 1}: ${item.description || ''} qtd ${item.quantity || 0} unit ${Number(item.unitPrice || 0).toFixed(2)}`
    ),
  ];
  const ops = lines
    .map((line, index) => {
      const y = 800 - index * 14;
      const safe = line.replace(/[()\\]/g, ' ');
      return `BT /F1 10 Tf 36 ${y} Td (${safe}) Tj ET`;
    })
    .join('\n');
  const stream = `${ops}\n`;
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n',
    `4 0 obj << /Length ${stream.length} >> stream\n${stream}endstream\nendobj\n`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj\n',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }
  const xrefAt = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}

export function proposalSignatureHashBase64(input: ProposalHashInput): string {
  return sha256Base64(proposalSignaturePdf(input));
}
