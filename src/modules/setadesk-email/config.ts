// ============================================================================
// SetaDesk - Entrada de e-mail: flags e configuracao (somente env vars).
// ----------------------------------------------------------------------------
// Tudo DESLIGADO por padrao. Nenhum valor de configuracao (tenant, client id,
// thumbprint, PFX, senha) e logado, devolvido em resposta ou gravado no banco.
// Os erros carregam apenas CODIGOS (ex.: GRAPH_THUMBPRINT_MISMATCH), nunca valores.
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
//   SETADESK_GRAPH_CERT_THUMBPRINT           thumbprint SHA-1 (hex, 40) do certificado cadastrado
//                                            no Entra; conferido contra o certificado do PFX
//   SETADESK_GRAPH_CERT_PFX_BASE64           arquivo .pfx (PKCS#12: certificado + chave privada RSA)
//                                            em base64, uma linha (SEGREDO)
//   SETADESK_GRAPH_CERT_PASSWORD             senha do .pfx (SEGREDO; pode ser vazia se o PFX nao tiver)
//
// Valores NAO secretos do app SetaDesk na Seta (somente documentacao; o codigo nao usa
// como padrao, a variavel precisa estar definida):
//   tenant  05c800b3-8c5b-448b-912d-e1e51d667588
//   client  9b5ce520-d659-4348-8044-70827160b247
//   thumbprint 221CA3CB835C5B18A6894F7EDCE149DB7DDCC39E
// ============================================================================

import crypto from 'node:crypto';
import forge from 'node-forge';

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

/** Valores nao secretos documentados (exemplos de configuracao). Nunca usados como padrao. */
export const SETADESK_GRAPH_DOCUMENTED_IDS = Object.freeze({
  tenantId: '05c800b3-8c5b-448b-912d-e1e51d667588',
  clientId: '9b5ce520-d659-4348-8044-70827160b247',
  certThumbprintSha1: '221CA3CB835C5B18A6894F7EDCE149DB7DDCC39E',
});

export interface ParsedGraphPfx {
  privateKey: crypto.KeyObject;
  /** SHA-1 do DER do certificado, hex maiusculo (igual ao "Thumbprint" do Entra). */
  thumbprintSha1: string;
  notBefore: Date;
  notAfter: Date;
}

/** Le o PFX (PKCS#12) e devolve chave + thumbprint. Erros so com codigo, nunca com conteudo. */
export function parseGraphPfx(pfxBase64: string, password: string): { ok: true; pfx: ParsedGraphPfx } | { ok: false; code: string } {
  const b64 = String(pfxBase64 || '').replace(/\s+/g, '');
  if (!b64 || !/^[A-Za-z0-9+/=_-]+$/.test(b64)) return { ok: false, code: 'GRAPH_CERT_PFX_MISSING' };
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const der = Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('binary');
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), false, String(password ?? ''));
  } catch {
    return { ok: false, code: 'GRAPH_CERT_PFX_INVALID_OR_WRONG_PASSWORD' };
  }
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || []),
  ];
  const forgeKey = keyBags.find((b) => b.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!forgeKey) return { ok: false, code: 'GRAPH_CERT_PFX_NO_KEY' };
  // Certificado folha = o que casa com a chave privada.
  const cert = certBags
    .map((b) => b.cert)
    .filter((c): c is forge.pki.Certificate => Boolean(c))
    .find((c) => {
      const pub = c.publicKey as forge.pki.rsa.PublicKey;
      return Boolean(pub && pub.n && pub.n.equals(forgeKey.n) && pub.e.equals(forgeKey.e));
    });
  if (!cert) return { ok: false, code: 'GRAPH_CERT_PFX_KEY_MISMATCH' };
  let privateKey: crypto.KeyObject;
  try {
    privateKey = crypto.createPrivateKey({ key: forge.pki.privateKeyToPem(forgeKey), format: 'pem' });
  } catch {
    return { ok: false, code: 'GRAPH_CERT_PFX_NO_KEY' };
  }
  if (privateKey.asymmetricKeyType !== 'rsa') return { ok: false, code: 'GRAPH_CERT_PFX_NO_KEY' };
  const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary');
  const thumbprintSha1 = crypto.createHash('sha1').update(der).digest('hex').toUpperCase();
  return { ok: true, pfx: { privateKey, thumbprintSha1, notBefore: cert.validity.notBefore, notAfter: cert.validity.notAfter } };
}

export function normalizeThumbprint(raw: unknown): string {
  return String(raw ?? '').replace(/[\s:]/g, '').toUpperCase();
}

/** Configuracao do app (credencial de aplicacao por certificado PFX). Nunca devolve valores. */
export function resolveSetaDeskGraphConfig(env: Env = process.env, nowMs: number = Date.now()): GraphConfigResult {
  const tenantId = String(env.SETADESK_GRAPH_TENANT_ID || '').trim();
  const clientId = String(env.SETADESK_GRAPH_CLIENT_ID || '').trim();
  const thumb = normalizeThumbprint(env.SETADESK_GRAPH_CERT_THUMBPRINT);
  if (!tenantId || !(GUID_RE.test(tenantId) || TENANT_DOMAIN_RE.test(tenantId))) return { ok: false, code: 'GRAPH_TENANT_MISSING' };
  if (['common', 'organizations', 'consumers'].includes(tenantId.toLowerCase())) return { ok: false, code: 'GRAPH_TENANT_MISSING' };
  if (!GUID_RE.test(clientId)) return { ok: false, code: 'GRAPH_CLIENT_ID_MISSING' };
  if (!/^[0-9A-F]{40}$/.test(thumb)) return { ok: false, code: 'GRAPH_THUMBPRINT_MISSING' };
  const parsed = parseGraphPfx(String(env.SETADESK_GRAPH_CERT_PFX_BASE64 || ''), String(env.SETADESK_GRAPH_CERT_PASSWORD ?? ''));
  if (!parsed.ok) return parsed;
  // O PFX precisa ser o MESMO certificado cadastrado no Entra (thumbprint informado).
  if (parsed.pfx.thumbprintSha1 !== thumb) return { ok: false, code: 'GRAPH_THUMBPRINT_MISMATCH' };
  if (nowMs < parsed.pfx.notBefore.getTime() || nowMs > parsed.pfx.notAfter.getTime()) {
    return { ok: false, code: 'GRAPH_CERT_EXPIRED_OR_NOT_YET_VALID' };
  }
  return {
    ok: true,
    config: {
      tenantId,
      clientId,
      thumbprintHeader: { name: 'x5t', value: Buffer.from(thumb, 'hex').toString('base64url') },
      privateKey: parsed.pfx.privateKey,
    },
  };
}

/** Nomes das variaveis (documentacao/diagnostico). Nunca os valores. */
export const SETADESK_EMAIL_ENV_NAMES = Object.freeze([
  'SETADESK_EMAIL_INTAKE_ENABLED',
  'SETADESK_EMAIL_ANALYSIS_NOTICE_ENABLED',
  'SETADESK_EMAIL_INTAKE_MAILBOXES',
  'SETADESK_GRAPH_TENANT_ID',
  'SETADESK_GRAPH_CLIENT_ID',
  'SETADESK_GRAPH_CERT_THUMBPRINT',
  'SETADESK_GRAPH_CERT_PFX_BASE64',
  'SETADESK_GRAPH_CERT_PASSWORD',
]);
