// ============================================================================
// SetaDesk - Entrada de e-mail: flags e configuracao (somente env vars).
// ----------------------------------------------------------------------------
// Tudo DESLIGADO por padrao. Nenhum valor de configuracao (tenant, client id,
// thumbprint, chave privada) e logado, devolvido em resposta ou gravado no banco.
// Os erros carregam apenas CODIGOS (ex.: GRAPH_PRIVATE_KEY_INVALID), nunca valores.
//
// Variaveis (nomes documentados no PR; nenhuma e criada ou alterada por este codigo):
//   SETADESK_EMAIL_INTAKE_ENABLED            "true" | "1" liga a entrada (padrao: desligada)
//   SETADESK_EMAIL_ANALYSIS_NOTICE_ENABLED   "true" | "1" liga o aviso "estamos analisando"
//                                            (padrao: desligado; texto pendente de aprovacao)
//   SETADESK_EMAIL_INTAKE_MAILBOXES          lista (virgula) de caixas autorizadas; a fila so
//                                            e lida se a caixa estiver nesta lista E em
//                                            setadesk_pipelines.mailbox (defesa em profundidade)
//   SETADESK_GRAPH_TENANT_ID                 Directory (tenant) ID do Entra (GUID)
//   SETADESK_GRAPH_CLIENT_ID                 Application (client) ID do app SetaDesk (GUID)
//   SETADESK_GRAPH_CERT_THUMBPRINT           thumbprint do certificado (SHA-1 hex, 40; ou SHA-256 hex, 64)
//   SETADESK_GRAPH_PRIVATE_KEY               chave privada RSA em PEM (ou o PEM em base64)
// ============================================================================

import crypto from 'node:crypto';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT_DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;
const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

type Env = Record<string, string | undefined>;

function truthy(v: string | undefined): boolean {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

export function isSetaDeskEmailIntakeEnabled(env: Env = process.env): boolean {
  return truthy(env.SETADESK_EMAIL_INTAKE_ENABLED);
}

/** O aviso so sai com a entrada ligada E com a flag propria (texto pendente de aprovacao). */
export function isSetaDeskAnalysisNoticeEnabled(env: Env = process.env): boolean {
  return isSetaDeskEmailIntakeEnabled(env) && truthy(env.SETADESK_EMAIL_ANALYSIS_NOTICE_ENABLED);
}

export function normalizeMailboxAddress(raw: unknown): string | null {
  const s = String(raw ?? '').trim().toLowerCase();
  return EMAIL_RE.test(s) ? s : null;
}

/** Caixas autorizadas por env (minusculas, validas, sem repeticao). */
export function allowedIntakeMailboxes(env: Env = process.env): string[] {
  const out = new Set<string>();
  for (const part of String(env.SETADESK_EMAIL_INTAKE_MAILBOXES || '').split(/[,;\s]+/)) {
    const m = normalizeMailboxAddress(part);
    if (m) out.add(m);
  }
  return [...out];
}

export interface SetaDeskGraphAppConfig {
  tenantId: string;
  clientId: string;
  /** Cabecalho do JWT: { x5t } (SHA-1) ou { 'x5t#S256' } (SHA-256), em base64url. */
  thumbprintHeader: { name: 'x5t' | 'x5t#S256'; value: string };
  privateKey: crypto.KeyObject;
}

export type GraphConfigResult =
  | { ok: true; config: SetaDeskGraphAppConfig }
  | { ok: false; code: string };

function parsePrivateKey(raw: string): crypto.KeyObject | null {
  let pem = raw.trim();
  if (!pem) return null;
  if (!pem.includes('-----BEGIN')) {
    // PEM inteiro em base64 (uma linha), formato comum em variaveis de ambiente.
    try {
      pem = Buffer.from(pem, 'base64').toString('utf8').trim();
    } catch {
      return null;
    }
  }
  pem = pem.replace(/\\n/g, '\n');
  try {
    const key = crypto.createPrivateKey({ key: pem, format: 'pem' });
    if (key.asymmetricKeyType !== 'rsa') return null;
    return key;
  } catch {
    return null;
  }
}

/** Configuracao do app (credencial de aplicacao por certificado). Nunca devolve o motivo com valores. */
export function resolveSetaDeskGraphConfig(env: Env = process.env): GraphConfigResult {
  const tenantId = String(env.SETADESK_GRAPH_TENANT_ID || '').trim();
  const clientId = String(env.SETADESK_GRAPH_CLIENT_ID || '').trim();
  const thumb = String(env.SETADESK_GRAPH_CERT_THUMBPRINT || '').trim().replace(/[\s:]/g, '');
  const keyRaw = String(env.SETADESK_GRAPH_PRIVATE_KEY || '');
  if (!tenantId || !(GUID_RE.test(tenantId) || TENANT_DOMAIN_RE.test(tenantId))) return { ok: false, code: 'GRAPH_TENANT_MISSING' };
  if (['common', 'organizations', 'consumers'].includes(tenantId.toLowerCase())) return { ok: false, code: 'GRAPH_TENANT_MISSING' };
  if (!GUID_RE.test(clientId)) return { ok: false, code: 'GRAPH_CLIENT_ID_MISSING' };
  let thumbprintHeader: SetaDeskGraphAppConfig['thumbprintHeader'];
  if (/^[0-9a-f]{40}$/i.test(thumb)) {
    thumbprintHeader = { name: 'x5t', value: Buffer.from(thumb, 'hex').toString('base64url') };
  } else if (/^[0-9a-f]{64}$/i.test(thumb)) {
    thumbprintHeader = { name: 'x5t#S256', value: Buffer.from(thumb, 'hex').toString('base64url') };
  } else {
    return { ok: false, code: 'GRAPH_THUMBPRINT_MISSING' };
  }
  const privateKey = parsePrivateKey(keyRaw);
  if (!privateKey) return { ok: false, code: 'GRAPH_PRIVATE_KEY_INVALID' };
  return { ok: true, config: { tenantId, clientId, thumbprintHeader, privateKey } };
}

/** Nomes das variaveis (documentacao/diagnostico). Nunca os valores. */
export const SETADESK_EMAIL_ENV_NAMES = Object.freeze([
  'SETADESK_EMAIL_INTAKE_ENABLED',
  'SETADESK_EMAIL_ANALYSIS_NOTICE_ENABLED',
  'SETADESK_EMAIL_INTAKE_MAILBOXES',
  'SETADESK_GRAPH_TENANT_ID',
  'SETADESK_GRAPH_CLIENT_ID',
  'SETADESK_GRAPH_CERT_THUMBPRINT',
  'SETADESK_GRAPH_PRIVATE_KEY',
]);
