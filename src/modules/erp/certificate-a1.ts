// ============================================================================
// STI-hub — Pacote N (02/11/2026): Certificado Digital A1 (ICP-Brasil) — SOMENTE SERVIDOR.
// - Abre o PKCS#12 (.pfx/.p12) com node-forge, exige chave privada do certificado, vigencia e
//   e-CNPJ (OID 2.16.76.1.3.3 no subjectAltName ou CN "NOME:CNPJ").
// - Guarda .pfx e senha cifrados em repouso (AES-256-GCM, IV aleatorio por gravacao, AAD com o
//   id do registro). Chave: STI_HUB_CERT_ENC_KEY (32 bytes em base64url), nunca do banco nem do
//   segredo de sessao. Sem chave => CertEncKeyMissingError (rotas: 503 CERT_ENC_KEY_MISSING).
// - Linha PROPRIA do crm_kv_store (key = erp_certificate_a1_v1), fora do estado crm_state_v1:
//   bootstrap, overview, exportacoes e o sync completo do estado nunca leem nem gravam o blob.
// - loadCertificateForSigning(): uso futuro na NF-e; nenhuma rota expoe o conteudo.
// ============================================================================
import crypto from 'crypto';
import forge from 'node-forge';
import { ensurePostgresSchema, getPostgresPool, isPostgresEnabled } from '../../db/postgres';

export const CERT_KV_KEY = 'erp_certificate_a1_v1';
export const CERT_MAX_PFX_BYTES = 64 * 1024; // 64 KiB do .pfx decodificado
export const CERT_EXPIRING_DAYS = 30;
export const CERT_HISTORY_MAX = 20;
/**
 * Teto da SOMA das iteracoes (MAC + PBE de cada bolsa) do PKCS#12: evita CPU sem limite com arquivo
 * forjado (node-forge e JS puro: ~1,2 s por 100 mil iteracoes). Arquivos reais usam 2.000 a 10.000.
 */
export const CERT_MAX_KDF_ITERATIONS = 300_000;
export const OID_ECNPJ = '2.16.76.1.3.3';
export const OID_ICP_BRASIL_POLICY_PREFIX = '2.16.76.1.2.';

export type CertStatus = 'VALIDO' | 'VENCE_EM_30_DIAS' | 'VENCIDO';

/** Metadados (unica coisa que sai em resposta HTTP e em auditoria). */
export interface CertificateMetadata {
  subject: string;
  cnpj: string;
  issuer: string;
  icpBrasil: boolean;
  serial: string;
  fingerprintSha256: string;
  notBefore: string;
  notAfter: string;
  uploadedAt: string;
  uploadedBy: string;
}

export interface CertificateHistoryEntry extends CertificateMetadata {
  endedAt: string;
  endedBy: string;
  reason: 'SUBSTITUIDO' | 'EXCLUIDO';
}

interface EncryptedField {
  iv: string; // base64url, 12 bytes
  tag: string; // base64url, 16 bytes
  ct: string; // base64url
}

/** Registro persistido (linha propria do crm_kv_store). */
export interface StoredCertificateRecord {
  schema: 1;
  current: null | {
    id: string;
    meta: CertificateMetadata;
    pfxEnc: EncryptedField;
    passwordEnc: EncryptedField;
  };
  history: CertificateHistoryEntry[];
  updatedAt: string;
}

export class CertEncKeyMissingError extends Error {
  readonly code = 'CERT_ENC_KEY_MISSING';
  constructor() {
    super('Chave de criptografia do certificado ausente ou invalida (STI_HUB_CERT_ENC_KEY).');
  }
}

export class CertStoreUnavailableError extends Error {
  readonly code = 'CERT_STORE_UNAVAILABLE';
  constructor() {
    super('Armazenamento do certificado indisponivel.');
  }
}

export type CertValidationCode =
  | 'CERT_INVALID_OR_WRONG_PASSWORD'
  | 'CERT_PRIVATE_KEY_MISMATCH'
  | 'CERT_EXPIRED'
  | 'CERT_NOT_YET_VALID'
  | 'CERT_NOT_ECNPJ';

export class CertValidationError extends Error {
  constructor(readonly code: CertValidationCode, readonly internalReason: string) {
    super(code);
  }
}

// ----------------------------------------------------------------------------
// Chave de criptografia
// ----------------------------------------------------------------------------
/** Le STI_HUB_CERT_ENC_KEY (32 bytes, base64url). Nada derivado de outro segredo. */
export function resolveCertEncKey(): Buffer {
  const raw = String((typeof process !== 'undefined' && process.env.STI_HUB_CERT_ENC_KEY) || '').trim();
  if (!raw || !/^[A-Za-z0-9_-]+={0,2}$/.test(raw)) throw new CertEncKeyMissingError();
  const key = Buffer.from(raw.replace(/=+$/, ''), 'base64url');
  if (key.length !== 32) throw new CertEncKeyMissingError();
  return key;
}

export function isCertEncKeyConfigured(): boolean {
  try {
    resolveCertEncKey();
    return true;
  } catch {
    return false;
  }
}

function aadFor(recordId: string, field: 'pfx' | 'password'): Buffer {
  return Buffer.from(`stihub:erp-cert-a1:v1:${recordId}:${field}`, 'utf8');
}

export function encryptCertField(plain: Buffer, recordId: string, field: 'pfx' | 'password', key = resolveCertEncKey()): EncryptedField {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aadFor(recordId, field));
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ct: ct.toString('base64url') };
}

export function decryptCertField(enc: EncryptedField, recordId: string, field: 'pfx' | 'password', key = resolveCertEncKey()): Buffer {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(enc.iv, 'base64url'));
  decipher.setAAD(aadFor(recordId, field));
  decipher.setAuthTag(Buffer.from(enc.tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(enc.ct, 'base64url')), decipher.final()]);
}

// ----------------------------------------------------------------------------
// Base64 do .pfx
// ----------------------------------------------------------------------------
export type DecodePfxResult = { ok: true; bytes: Buffer } | { ok: false; reason: 'TOO_LARGE' | 'INVALID' };

/** Aceita base64 padrao ou base64url (com ou sem prefixo data:...;base64,). Teto de 64 KiB decodificado. */
export function decodePfxBase64(input: string): DecodePfxResult {
  let s = String(input || '').trim();
  const dataUrl = /^data:[a-z0-9.+/-]*;base64,/i.exec(s);
  if (dataUrl) s = s.slice(dataUrl[0].length);
  s = s.replace(/\s+/g, '');
  if (!s) return { ok: false, reason: 'INVALID' };
  // Estimativa ANTES de decodificar (corpo enorme nao vira Buffer enorme).
  if (Math.floor((s.length * 3) / 4) - 2 > CERT_MAX_PFX_BYTES) return { ok: false, reason: 'TOO_LARGE' };
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return { ok: false, reason: 'INVALID' };
  const bytes = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (bytes.length === 0) return { ok: false, reason: 'INVALID' };
  if (bytes.length > CERT_MAX_PFX_BYTES) return { ok: false, reason: 'TOO_LARGE' };
  return { ok: true, bytes };
}

// ----------------------------------------------------------------------------
// PKCS#12
// ----------------------------------------------------------------------------
export interface ParsedCertificate {
  subject: string;
  subjectDn: string;
  cnpj: string;
  cnpjSource: 'OID_2.16.76.1.3.3' | 'CN';
  issuer: string;
  issuerDn: string;
  icpBrasil: boolean;
  serial: string;
  fingerprintSha256: string;
  notBefore: Date;
  notAfter: Date;
  certificatePem: string;
  privateKeyPem: string;
}

function dnToString(attrs: forge.pki.CertificateField[]): string {
  return attrs
    .map((a) => `${a.shortName || a.name || a.type}=${String(a.value ?? '')}`)
    .join(', ')
    .slice(0, 500);
}

function attrValue(attrs: forge.pki.CertificateField[], shortName: string): string {
  const hit = attrs.find((a) => a.shortName === shortName);
  return hit ? String(hit.value ?? '') : '';
}

/** Soma os INTEGERs de iteracao do PKCS#12 (MAC e PBE) sem decifrar nada. */
function sumIterationCounts(node: forge.asn1.Asn1, depth = 0): number {
  if (depth > 32 || !node) return 0;
  let total = 0;
  if (Array.isArray(node.value)) {
    const kids = node.value as forge.asn1.Asn1[];
    // PBEParameter/MacData/PBKDF2-params: SEQUENCE { OCTET STRING salt, INTEGER iterations, ... }
    for (let i = 0; i + 1 < kids.length; i++) {
      const a = kids[i];
      const b = kids[i + 1];
      if (
        a && b &&
        a.tagClass === forge.asn1.Class.UNIVERSAL && a.type === forge.asn1.Type.OCTETSTRING &&
        b.tagClass === forge.asn1.Class.UNIVERSAL && b.type === forge.asn1.Type.INTEGER &&
        typeof b.value === 'string'
      ) {
        const hex = forge.util.bytesToHex(b.value);
        const n = hex.length > 12 ? Number.MAX_SAFE_INTEGER : parseInt(hex || '0', 16);
        total += n;
      }
    }
    for (const k of kids) {
      total += sumIterationCounts(k, depth + 1);
      if (total > Number.MAX_SAFE_INTEGER / 2) return Number.MAX_SAFE_INTEGER;
    }
  }
  return total;
}

function extractEcnpjFromSan(cert: forge.pki.Certificate): string | null {
  const ext = (cert.extensions || []).find((e: { id?: string; name?: string }) => e.id === '2.5.29.17' || e.name === 'subjectAltName') as
    | { value?: string }
    | undefined;
  if (!ext || typeof ext.value !== 'string') return null;
  try {
    const seq = forge.asn1.fromDer(ext.value);
    for (const gn of (seq.value as forge.asn1.Asn1[]) || []) {
      // otherName [0] { type-id OID, [0] EXPLICIT value }
      if (gn.tagClass !== forge.asn1.Class.CONTEXT_SPECIFIC || gn.type !== 0 || !Array.isArray(gn.value)) continue;
      const parts = gn.value as forge.asn1.Asn1[];
      if (!parts[0] || typeof parts[0].value !== 'string') continue;
      const oid = forge.asn1.derToOid(parts[0].value);
      if (oid !== OID_ECNPJ) continue;
      const wrapped = parts[1];
      const inner = wrapped && Array.isArray(wrapped.value) ? (wrapped.value as forge.asn1.Asn1[])[0] : wrapped;
      const raw = inner && typeof inner.value === 'string' ? inner.value : '';
      const digits = raw.replace(/\D+/g, '');
      if (digits.length === 14) return digits;
    }
  } catch {
    return null;
  }
  return null;
}

function hasIcpBrasilPolicy(cert: forge.pki.Certificate): boolean {
  const ext = (cert.extensions || []).find((e: { id?: string }) => e.id === '2.5.29.32') as { value?: string } | undefined;
  if (!ext || typeof ext.value !== 'string') return false;
  try {
    const seq = forge.asn1.fromDer(ext.value);
    for (const pi of (seq.value as forge.asn1.Asn1[]) || []) {
      const first = Array.isArray(pi.value) ? (pi.value as forge.asn1.Asn1[])[0] : null;
      if (first && typeof first.value === 'string') {
        const oid = forge.asn1.derToOid(first.value);
        if (oid.startsWith(OID_ICP_BRASIL_POLICY_PREFIX)) return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Abre o PKCS#12. Senha errada ou arquivo invalido => CertValidationError CERT_INVALID_OR_WRONG_PASSWORD
 * (mensagem generica para o cliente; o motivo interno so vai para a auditoria, sem a senha).
 */
export function parsePkcs12(pfx: Buffer, password: string, now: Date = new Date()): ParsedCertificate {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    // (os tipos de @types/node-forge so declaram o booleano; a lib aceita as opcoes)
    const fromDer = forge.asn1.fromDer as unknown as (b: forge.util.ByteStringBuffer, o: Record<string, unknown>) => forge.asn1.Asn1;
    const asn = fromDer(forge.util.createBuffer(pfx.toString('binary')), { strict: true, parseAllBytes: true });
    const iters = sumIterationCounts(asn);
    if (iters > CERT_MAX_KDF_ITERATIONS) throw new Error(`iteracoes acima do teto (${iters})`);
    p12 = forge.pkcs12.pkcs12FromAsn1(asn, true, password);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'erro';
    const reason = /mac could not be verified|invalid password/i.test(msg) ? 'senha incorreta (MAC)' : 'arquivo PKCS#12 invalido';
    throw new CertValidationError('CERT_INVALID_OR_WRONG_PASSWORD', reason);
  }

  let certs: forge.pki.Certificate[] = [];
  let keys: forge.pki.rsa.PrivateKey[] = [];
  try {
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
    certs = certBags.map((b) => b.cert).filter((c): c is forge.pki.Certificate => Boolean(c));
    const shrouded = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
    const plainKeys = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [];
    keys = [...shrouded, ...plainKeys]
      .map((b) => b.key as forge.pki.rsa.PrivateKey | undefined)
      .filter((k): k is forge.pki.rsa.PrivateKey => Boolean(k && (k as { n?: unknown }).n));
  } catch {
    throw new CertValidationError('CERT_INVALID_OR_WRONG_PASSWORD', 'bolsas do PKCS#12 ilegiveis');
  }
  if (certs.length === 0) throw new CertValidationError('CERT_INVALID_OR_WRONG_PASSWORD', 'PKCS#12 sem certificado');
  if (keys.length === 0) throw new CertValidationError('CERT_PRIVATE_KEY_MISMATCH', 'PKCS#12 sem chave privada');

  // Certificado do titular = o que corresponde a uma chave privada do arquivo (n e e iguais).
  let leaf: forge.pki.Certificate | null = null;
  let leafKey: forge.pki.rsa.PrivateKey | null = null;
  for (const c of certs) {
    const pub = c.publicKey as forge.pki.rsa.PublicKey;
    if (!pub || !(pub as { n?: unknown }).n) continue;
    const k = keys.find((kk) => kk.n.equals(pub.n) && kk.e.equals(pub.e));
    if (k) {
      leaf = c;
      leafKey = k;
      break;
    }
  }
  if (!leaf || !leafKey) throw new CertValidationError('CERT_PRIVATE_KEY_MISMATCH', 'chave privada nao corresponde a nenhum certificado do arquivo');

  const nb = leaf.validity.notBefore;
  const na = leaf.validity.notAfter;
  if (now.getTime() > na.getTime()) throw new CertValidationError('CERT_EXPIRED', `vencido em ${na.toISOString()}`);
  if (now.getTime() < nb.getTime()) throw new CertValidationError('CERT_NOT_YET_VALID', `vigente a partir de ${nb.toISOString()}`);

  const subjectCn = attrValue(leaf.subject.attributes, 'CN');
  let cnpj = extractEcnpjFromSan(leaf);
  let cnpjSource: ParsedCertificate['cnpjSource'] = 'OID_2.16.76.1.3.3';
  if (!cnpj) {
    const m = /:\s*(\d{14})\s*$/.exec(subjectCn);
    if (m) {
      cnpj = m[1];
      cnpjSource = 'CN';
    }
  }
  if (!cnpj) throw new CertValidationError('CERT_NOT_ECNPJ', 'sem CNPJ no OID 2.16.76.1.3.3 nem no CN "NOME:CNPJ"');

  const issuerO = attrValue(leaf.issuer.attributes, 'O');
  const icpBrasil = /^ICP-Brasil$/i.test(issuerO.trim()) && hasIcpBrasilPolicy(leaf);
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(leaf)).getBytes();
  const fingerprintSha256 = crypto.createHash('sha256').update(Buffer.from(der, 'binary')).digest('hex').toUpperCase();

  return {
    subject: subjectCn.slice(0, 200),
    subjectDn: dnToString(leaf.subject.attributes),
    cnpj,
    cnpjSource,
    issuer: (attrValue(leaf.issuer.attributes, 'CN') || dnToString(leaf.issuer.attributes)).slice(0, 200),
    issuerDn: dnToString(leaf.issuer.attributes),
    icpBrasil,
    serial: String(leaf.serialNumber || '').toUpperCase().slice(0, 80),
    fingerprintSha256,
    notBefore: nb,
    notAfter: na,
    certificatePem: forge.pki.certificateToPem(leaf),
    privateKeyPem: forge.pki.privateKeyToPem(leafKey),
  };
}

// ----------------------------------------------------------------------------
// Status / visao publica (metadados)
// ----------------------------------------------------------------------------
export function certStatusOf(notAfterIso: string, now = Date.now()): { status: CertStatus; daysToExpire: number } {
  const na = Date.parse(notAfterIso);
  const daysToExpire = Math.floor((na - now) / 86_400_000);
  if (!Number.isFinite(na) || na <= now) return { status: 'VENCIDO', daysToExpire: Number.isFinite(daysToExpire) ? daysToExpire : 0 };
  return { status: daysToExpire <= CERT_EXPIRING_DAYS ? 'VENCE_EM_30_DIAS' : 'VALIDO', daysToExpire };
}

export interface CertificateView {
  present: boolean;
  subject: string | null;
  cnpj: string | null;
  issuer: string | null;
  icpBrasil: boolean | null;
  serial: string | null;
  fingerprintSha256: string | null;
  notBefore: string | null;
  notAfter: string | null;
  daysToExpire: number | null;
  status: CertStatus | null;
  uploadedAt: string | null;
  uploadedBy: string | null;
}

/** Unica projecao que sai nas respostas: lista FECHADA de campos (nunca blob, senha, chave ou base64). */
export function toCertificateView(rec: StoredCertificateRecord | null, now = Date.now()): CertificateView {
  const cur = rec?.current;
  if (!cur) {
    return {
      present: false, subject: null, cnpj: null, issuer: null, icpBrasil: null, serial: null, fingerprintSha256: null,
      notBefore: null, notAfter: null, daysToExpire: null, status: null, uploadedAt: null, uploadedBy: null,
    };
  }
  const m = cur.meta;
  const st = certStatusOf(m.notAfter, now);
  return {
    present: true,
    subject: m.subject,
    cnpj: m.cnpj,
    issuer: m.issuer,
    icpBrasil: m.icpBrasil,
    serial: m.serial,
    fingerprintSha256: m.fingerprintSha256,
    notBefore: m.notBefore,
    notAfter: m.notAfter,
    daysToExpire: st.daysToExpire,
    status: st.status,
    uploadedAt: m.uploadedAt,
    uploadedBy: m.uploadedBy,
  };
}

export function describeCertForAudit(m: Pick<CertificateMetadata, 'fingerprintSha256' | 'subject' | 'cnpj' | 'notBefore' | 'notAfter' | 'issuer' | 'icpBrasil'>): string {
  return `fingerprintSha256=${m.fingerprintSha256}; titular=${String(m.subject).slice(0, 120)}; cnpj=${m.cnpj}; emissora=${String(m.issuer).slice(0, 120)}; icpBrasil=${m.icpBrasil}; validade=${m.notBefore}..${m.notAfter}`;
}

// ----------------------------------------------------------------------------
// Armazenamento (linha propria do crm_kv_store; memoria so fora de producao/Preview)
// ----------------------------------------------------------------------------
export interface CertificateStore {
  load(): Promise<StoredCertificateRecord | null>;
  save(rec: StoredCertificateRecord): Promise<void>;
}

export class MemoryCertificateStore implements CertificateStore {
  private rec: StoredCertificateRecord | null = null;
  async load(): Promise<StoredCertificateRecord | null> {
    return this.rec ? (JSON.parse(JSON.stringify(this.rec)) as StoredCertificateRecord) : null;
  }
  async save(rec: StoredCertificateRecord): Promise<void> {
    this.rec = JSON.parse(JSON.stringify(rec)) as StoredCertificateRecord;
  }
}

export class PostgresCertificateStore implements CertificateStore {
  async load(): Promise<StoredCertificateRecord | null> {
    const pool = getPostgresPool();
    if (!pool) throw new CertStoreUnavailableError();
    await ensurePostgresSchema(pool);
    const r = await pool.query<{ payload: StoredCertificateRecord }>(`SELECT payload FROM crm_kv_store WHERE key = $1 LIMIT 1`, [CERT_KV_KEY]);
    return r.rows[0]?.payload || null;
  }
  async save(rec: StoredCertificateRecord): Promise<void> {
    const pool = getPostgresPool();
    if (!pool) throw new CertStoreUnavailableError();
    await ensurePostgresSchema(pool);
    // So as colunas base (key, payload, updated_at): compativel com a coluna `version` + trigger do Neon Free.
    await pool.query(
      `INSERT INTO crm_kv_store (key, payload, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
      [CERT_KV_KEY, JSON.stringify(rec)]
    );
  }
}

function isDeployedRuntime(): boolean {
  const v = String((typeof process !== 'undefined' && process.env.VERCEL_ENV) || '').toLowerCase();
  return v === 'production' || v === 'preview';
}

/** Postgres quando DATABASE_URL existe; em producao/Preview sem banco => falha fechada; local/teste => memoria. */
export function createDefaultCertificateStore(): CertificateStore {
  if (isPostgresEnabled()) return new PostgresCertificateStore();
  if (isDeployedRuntime()) {
    return {
      load: async () => {
        throw new CertStoreUnavailableError();
      },
      save: async () => {
        throw new CertStoreUnavailableError();
      },
    };
  }
  return new MemoryCertificateStore();
}

let defaultStore: CertificateStore | null = null;
export function getDefaultCertificateStore(): CertificateStore {
  if (!defaultStore) defaultStore = createDefaultCertificateStore();
  return defaultStore;
}

// ----------------------------------------------------------------------------
// Gravacao / troca / exclusao
// ----------------------------------------------------------------------------
export function buildStoredCertificate(
  prev: StoredCertificateRecord | null,
  pfx: Buffer,
  password: string,
  parsed: ParsedCertificate,
  actorEmail: string,
  nowIso = new Date().toISOString()
): { record: StoredCertificateRecord; replaced: CertificateMetadata | null } {
  const key = resolveCertEncKey();
  const id = `cert-a1-${crypto.randomUUID()}`;
  const meta: CertificateMetadata = {
    subject: parsed.subject,
    cnpj: parsed.cnpj,
    issuer: parsed.issuer,
    icpBrasil: parsed.icpBrasil,
    serial: parsed.serial,
    fingerprintSha256: parsed.fingerprintSha256,
    notBefore: parsed.notBefore.toISOString(),
    notAfter: parsed.notAfter.toISOString(),
    uploadedAt: nowIso,
    uploadedBy: actorEmail,
  };
  const history = [...(prev?.history || [])];
  const replaced = prev?.current ? { ...prev.current.meta } : null;
  if (replaced) history.unshift({ ...replaced, endedAt: nowIso, endedBy: actorEmail, reason: 'SUBSTITUIDO' });
  return {
    record: {
      schema: 1,
      current: {
        id,
        meta,
        pfxEnc: encryptCertField(pfx, id, 'pfx', key),
        passwordEnc: encryptCertField(Buffer.from(password, 'utf8'), id, 'password', key),
      },
      history: history.slice(0, CERT_HISTORY_MAX),
      updatedAt: nowIso,
    },
    replaced,
  };
}

/** Exclusao: remove blob e senha; o historico (so metadados) fica. */
export function buildDeletedCertificate(
  prev: StoredCertificateRecord,
  actorEmail: string,
  nowIso = new Date().toISOString()
): StoredCertificateRecord {
  const history = [...(prev.history || [])];
  if (prev.current) history.unshift({ ...prev.current.meta, endedAt: nowIso, endedBy: actorEmail, reason: 'EXCLUIDO' });
  return { schema: 1, current: null, history: history.slice(0, CERT_HISTORY_MAX), updatedAt: nowIso };
}

// ----------------------------------------------------------------------------
// Uso futuro (NF-e): somente servidor, sem rota.
// ----------------------------------------------------------------------------
export interface CertificateForSigning {
  pfx: Buffer;
  password: string;
  certificatePem: string;
  privateKeyPem: string;
  meta: CertificateMetadata;
}

/**
 * Decifra o certificado vigente para assinatura (NF-e). SOMENTE SERVIDOR: nao exponha o retorno
 * em resposta, log ou auditoria. null => nenhum certificado. Vencido => CertValidationError.
 */
export async function loadCertificateForSigning(store: CertificateStore = getDefaultCertificateStore()): Promise<CertificateForSigning | null> {
  const rec = await store.load();
  const cur = rec?.current;
  if (!cur) return null;
  const key = resolveCertEncKey();
  const pfx = decryptCertField(cur.pfxEnc, cur.id, 'pfx', key);
  const password = decryptCertField(cur.passwordEnc, cur.id, 'password', key).toString('utf8');
  const parsed = parsePkcs12(pfx, password);
  return { pfx, password, certificatePem: parsed.certificatePem, privateKeyPem: parsed.privateKeyPem, meta: { ...cur.meta } };
}
