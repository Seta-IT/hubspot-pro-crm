// ============================================================================
// STI-hub — Pacote N (02/11/2026): rotas do Certificado Digital A1 (/api/erp/certificate).
//   POST   { pfxBase64, password } (JSON, zod .strict())  -> so metadados
//   GET                                                   -> so metadados
//   DELETE                                                -> apaga blob e senha (historico e auditoria ficam)
// POST/DELETE: sessao com 2FA + administrador (canManageUsersRbac), recusa auditada.
// GET: administrador ou leitura de ERP Fiscal (erp.fiscal_notas / fiscalIssuanceAccess) ou de
// Configuracoes ERP (erp.configuracoes_empresa), pelo modelo do rbac.ts.
// Sem STI_HUB_CERT_ENC_KEY => 503 CERT_ENC_KEY_MISSING em todas (falha fechada).
// ============================================================================
import { z } from 'zod';
import type { CrmRepository } from '../db/repository';
import { buildDefaultErpItemPermissions, type ErpAccountRole, ERP_ROLES_CATALOG } from '../app/lib/rbac';
import { SlidingWindowRateLimiter } from './password-reset';
import {
  buildDeletedCertificate,
  buildStoredCertificate,
  CertEncKeyMissingError,
  CertStoreUnavailableError,
  CertValidationError,
  type CertificateStore,
  decodePfxBase64,
  describeCertForAudit,
  isCertEncKeyConfigured,
  parsePkcs12,
  toCertificateView,
  CERT_MAX_PFX_BYTES,
} from '../modules/erp/certificate-a1';

export const CERTIFICATE_ROUTE_PATH = '/api/erp/certificate';
export const CERT_UPLOAD_FAILURE_LIMIT = Object.freeze({ max: 5, windowMs: 15 * 60 * 1000 });

export const certificateUploadSchema = z
  .object({
    pfxBase64: z.string().min(1),
    password: z.string().min(1).max(512),
  })
  .strict();

const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0', Pragma: 'no-cache' });

type Resp = { status: number; body: unknown; headers?: Record<string, string> };
const resp = (status: number, body: unknown): Resp => ({ status, body, headers: { ...NO_STORE } });

export function isCertificateRoute(cleanPath: string): boolean {
  return cleanPath === CERTIFICATE_ROUTE_PATH;
}
export function isCertificateMutation(method: string, cleanPath: string): boolean {
  return isCertificateRoute(cleanPath) && (method === 'POST' || method === 'DELETE');
}

/** Digito verificador do CNPJ pelo modulo 11 PURO (sem a excecao do validators.ts). */
export function cnpjCheckDigitsValidMod11(digits: string): boolean {
  if (!/^\d{14}$/.test(digits)) return false;
  const calc = (s: string, w: number[]) => {
    let t = 0;
    for (let i = 0; i < w.length; i++) t += Number(s[i]) * w[i];
    const r = t % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = calc(digits.slice(0, 12), w1);
  const d2 = calc(digits.slice(0, 12) + String(d1), [6, ...w1]);
  return Number(digits[12]) === d1 && Number(digits[13]) === d2;
}

export type ExpectedCnpjSource = 'erp.gestaoClickConfig.companyCnpj' | 'validators.canonical';

/**
 * CNPJ canonico da Seta: o MESMO valor da excecao fixa de validateCnpj (validators.ts:369), que
 * NAO e alterada aqui (duvida em aberto 32 x 39; o modulo 11 puro da 14806925000139).
 */
export const SETA_CANONICAL_CNPJ_DIGITS = '14806925000132';
export const SETA_CNPJ_ROOT = '14806925';

export interface CertificateRouteDeps {
  repo: CrmRepository;
  store: CertificateStore;
  failureLimiter: SlidingWindowRateLimiter;
}

/**
 * CNPJ da empresa comparado com o do certificado (so digitos). So fontes DURAVEIS:
 * 1) erp.gestaoClickConfig.companyCnpj, no estado persistido (crm_state_v1). E gravado por
 *    PATCH /api/erp/gestaoclick/config e por POST/PUT /api/admin/settings (este repassa o CNPJ via
 *    updateGestaoClickConfig); os dois exigem validateCnpj valido e a raiz 14.806.925.
 * 2) Sem valor valido da raiz Seta => SETA_CANONICAL_CNPJ_DIGITS (excecao do validators.ts).
 * O companyEmitter de /api/admin/settings fica so na memoria da instancia e NAO e usado.
 */
export function resolveExpectedCompanyCnpj(deps: Pick<CertificateRouteDeps, 'repo'>): {
  digits: string;
  source: ExpectedCnpjSource;
} {
  let gc = '';
  try {
    gc = String(deps.repo.getErpOverview().gestaoClickConfig?.companyCnpj ?? '').replace(/\D+/g, '');
  } catch {
    gc = '';
  }
  if (gc.length === 14 && gc.startsWith(SETA_CNPJ_ROOT)) return { digits: gc, source: 'erp.gestaoClickConfig.companyCnpj' };
  return { digits: SETA_CANONICAL_CNPJ_DIGITS, source: 'validators.canonical' };
}

interface Actor {
  authenticated: boolean;
  mfaVerified: boolean;
  isAdmin: boolean;
  canRead: boolean;
  email: string;
  name: string;
  roleId: string;
}

function resolveActor(repo: CrmRepository, query: Record<string, string | undefined>, trustedInternal: boolean): Actor {
  if (trustedInternal) {
    return { authenticated: true, mfaVerified: true, isAdmin: true, canRead: true, email: 'sistema@sti-hub', name: 'Sistema STI-hub (interno)', roleId: 'SYSTEM' };
  }
  const sess = query._sessionToken ? repo.resolveSessionFromToken(query._sessionToken) : null;
  if (!sess || !sess.authenticated || !sess.user) {
    return { authenticated: false, mfaVerified: false, isAdmin: false, canRead: false, email: 'anonimo', name: 'anonimo', roleId: 'ANON' };
  }
  const user = sess.user;
  const mfa = Boolean(sess.mfaVerified);
  const isAdmin = mfa && Boolean(sess.effectiveActionGuards?.canManageUsersRbac);
  // Leitura pelo modelo do rbac.ts: itens ERP efetivos (padrao do perfil ERP + papel + usuario).
  const rec = repo.findRbacUserRecord(user.id, user.email);
  const erpRoleRaw = String(rec?.erpRole || sess.erpPermissions?.erpRole || sess.role?.erpRole || 'ERP_NONE');
  const erpRole = (erpRoleRaw in ERP_ROLES_CATALOG ? erpRoleRaw : 'ERP_NONE') as ErpAccountRole;
  const items: Record<string, { view?: boolean }> = {
    ...buildDefaultErpItemPermissions(erpRole),
    ...(sess.role?.erpItemPermissions || {}),
    ...(rec?.erpItemPermissions || {}),
  };
  const fiscalLevel = String(sess.erpPermissions?.fiscalIssuanceAccess || 'NONE');
  const canRead =
    isAdmin ||
    (mfa &&
      (Boolean(items['erp.fiscal_notas']?.view) ||
        Boolean(items['erp.configuracoes_empresa']?.view) ||
        fiscalLevel === 'VIEW' || fiscalLevel === 'EDIT' || fiscalLevel === 'FULL'));
  return { authenticated: true, mfaVerified: mfa, isAdmin, canRead, email: user.email, name: user.name, roleId: user.roleId };
}

function audit(
  repo: CrmRepository,
  actor: Pick<Actor, 'email' | 'name' | 'roleId'>,
  action: string,
  status: 'SUCCESS' | 'BLOCKED' | 'WARNING',
  method: string,
  ip: string,
  details: string
): void {
  try {
    repo.appendSecurityAuditLog({
      actorEmail: actor.email,
      actorName: actor.name,
      actorRole: actor.roleId,
      action,
      module: 'FISCAL_A1',
      resource: `${method} ${CERTIFICATE_ROUTE_PATH}`,
      status,
      ipAddress: ip,
      details: details.slice(0, 1500),
    });
  } catch {
    // auditoria nunca derruba a resposta
  }
}

/** Recusa de POST/DELETE para sessao sem 2FA (chamado pelo portao geral do roteador). */
export function auditCertificateMutationDenied(
  repo: CrmRepository,
  who: { email?: string; name?: string; roleId?: string },
  method: string,
  ip: string,
  reason: string
): void {
  audit(repo, { email: who.email || 'desconhecido', name: who.name || 'desconhecido', roleId: who.roleId || 'desconhecido' }, 'ERP_CERT_UPLOAD_DENIED', 'BLOCKED', method, ip, `Negado (${reason}): ${method} do certificado A1 exige sessao com 2FA e administrador.`);
}

export async function handleCertificateRoute(
  deps: CertificateRouteDeps,
  method: string,
  query: Record<string, string | undefined>,
  rawBody: Record<string, unknown>,
  ctx: { trustedInternal: boolean }
): Promise<Resp> {
  const ip = String(query._clientIp || 'sem-ip').slice(0, 64);
  const { repo, store } = deps;
  if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') {
    return resp(405, { error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' });
  }
  const actor = resolveActor(repo, query, ctx.trustedInternal);
  if (!actor.authenticated) {
    return resp(401, { error: 'Acesso não autorizado. Autenticação corporativa STI-hub + MFA 2FA obrigatória.', code: 'MFA_AUTH_REQUIRED' });
  }

  if (method === 'GET') {
    if (!actor.canRead) {
      return resp(403, { error: 'Permissão negada: consultar o certificado digital exige perfil administrador ou leitura de ERP Fiscal ou Configurações.', code: 'CERT_FORBIDDEN' });
    }
  } else if (!actor.isAdmin) {
    audit(repo, actor, 'ERP_CERT_UPLOAD_DENIED', 'BLOCKED', method, ip, `Negado (${actor.mfaVerified ? 'sem perfil administrador' : 'sessao sem 2FA'}): ${method} do certificado A1 exige sessao com 2FA e administrador.`);
    return resp(actor.mfaVerified ? 403 : 401, {
      error: 'Permissão negada: enviar, trocar ou excluir o certificado digital exige 2FA e perfil administrador.',
      code: 'CERT_FORBIDDEN',
    });
  }

  if (!isCertEncKeyConfigured()) {
    return resp(503, { error: 'Armazenamento seguro do certificado indisponível (chave de criptografia não configurada).', code: 'CERT_ENC_KEY_MISSING' });
  }
  const storeUnavailable = () => resp(503, { error: 'Armazenamento do certificado indisponível. Tente novamente em instantes.', code: 'CERT_STORE_UNAVAILABLE' });

  if (method === 'GET') {
    try {
      // canManage: mesma regra do POST/DELETE (admin com 2FA), calculada no servidor.
      return resp(200, { data: { ...toCertificateView(await store.load()), canManage: actor.isAdmin } });
    } catch {
      return storeUnavailable();
    }
  }

  if (method === 'DELETE') {
    let prev;
    try {
      prev = await store.load();
    } catch {
      return storeUnavailable();
    }
    if (!prev?.current) return resp(404, { error: 'Nenhum certificado digital cadastrado.', code: 'CERT_NOT_FOUND' });
    try {
      await store.save(buildDeletedCertificate(prev, actor.email));
    } catch {
      return storeUnavailable();
    }
    audit(repo, actor, 'ERP_CERT_DELETED', 'SUCCESS', method, ip, `Certificado A1 excluido (arquivo e senha apagados). ${describeCertForAudit(prev.current.meta)}`);
    return resp(200, { data: { ...toCertificateView(null), canManage: actor.isAdmin } });
  }

  // POST
  const userKey = `cert-fail:${actor.email.toLowerCase()}`;
  const fail = (status: number, code: string, error: string, reason: string, extra: Record<string, unknown> = {}): Resp => {
    deps.failureLimiter.hit(userKey);
    audit(repo, actor, 'ERP_CERT_UPLOAD_FAILED', 'BLOCKED', method, ip, `Envio do certificado A1 recusado: codigo=${code}; motivo=${reason}`);
    return resp(status, { error, code, ...extra });
  };
  if (deps.failureLimiter.count(userKey) >= deps.failureLimiter.max) {
    audit(repo, actor, 'ERP_CERT_UPLOAD_FAILED', 'BLOCKED', method, ip, 'Envio do certificado A1 recusado: codigo=CERT_RATE_LIMITED; motivo=5 falhas em 15 minutos');
    return resp(429, { error: 'Muitas tentativas de envio do certificado. Aguarde 15 minutos e tente novamente.', code: 'CERT_RATE_LIMITED' });
  }

  // Override IAM selado (header/corpo do proprio app) ja foi tratado pelo roteador: nao conta como campo extra.
  const bodyIn: Record<string, unknown> = { ...(rawBody || {}) };
  delete bodyIn.iamUsersOverride;
  delete bodyIn.iamDeletedUsersOverride;
  const parsed = certificateUploadSchema.safeParse(bodyIn);
  if (!parsed.success) {
    const fields = Array.from(
      new Set(parsed.error.issues.flatMap((i) => (i.code === 'unrecognized_keys' ? (i as { keys?: string[] }).keys || [] : [String(i.path[0] ?? '')])))
    ).filter(Boolean).slice(0, 10);
    audit(repo, actor, 'ERP_CERT_UPLOAD_FAILED', 'BLOCKED', method, ip, `Envio do certificado A1 recusado: codigo=CERT_INVALID_BODY; motivo=corpo invalido (campos: ${fields.join(', ')})`);
    return resp(400, { error: 'Envie somente { pfxBase64, password } (texto).', code: 'CERT_INVALID_BODY', fields });
  }

  const decoded = decodePfxBase64(parsed.data.pfxBase64);
  if (!decoded.ok) {
    if (decoded.reason === 'TOO_LARGE') {
      return fail(413, 'CERT_TOO_LARGE', `O arquivo do certificado passa do limite de ${CERT_MAX_PFX_BYTES / 1024} KiB.`, 'arquivo acima de 64 KiB');
    }
    return fail(422, 'CERT_INVALID_OR_WRONG_PASSWORD', 'Não foi possível abrir o certificado. Confira o arquivo .pfx/.p12 e a senha.', 'base64 invalido');
  }

  let cert;
  try {
    cert = parsePkcs12(decoded.bytes, parsed.data.password);
  } catch (err) {
    if (err instanceof CertValidationError) {
      const msgs: Record<string, string> = {
        CERT_INVALID_OR_WRONG_PASSWORD: 'Não foi possível abrir o certificado. Confira o arquivo .pfx/.p12 e a senha.',
        CERT_PRIVATE_KEY_MISMATCH: 'O arquivo não contém a chave privada correspondente ao certificado.',
        CERT_EXPIRED: 'O certificado está vencido.',
        CERT_NOT_YET_VALID: 'O certificado ainda não está vigente.',
        CERT_NOT_ECNPJ: 'O certificado não é um e-CNPJ (CNPJ não encontrado no certificado).',
      };
      return fail(422, err.code, msgs[err.code] || msgs.CERT_INVALID_OR_WRONG_PASSWORD, err.internalReason);
    }
    return fail(422, 'CERT_INVALID_OR_WRONG_PASSWORD', 'Não foi possível abrir o certificado. Confira o arquivo .pfx/.p12 e a senha.', 'erro ao abrir o PKCS#12');
  }

  const expected = resolveExpectedCompanyCnpj(deps);
  const cnpjCheck = {
    certificateCnpj: cert.cnpj,
    certificateCnpjSource: cert.cnpjSource,
    expectedCnpj: expected.digits,
    expectedCnpjSource: expected.source,
    sameRoot: cert.cnpj.slice(0, 12) === expected.digits.slice(0, 12),
    certificateCnpjCheckDigitsValidMod11: cnpjCheckDigitsValidMod11(cert.cnpj),
    expectedCnpjCheckDigitsValidMod11: cnpjCheckDigitsValidMod11(expected.digits),
  };
  if (cert.cnpj !== expected.digits) {
    return fail(
      422,
      'CERT_CNPJ_MISMATCH',
      'Trava anti-fraude: o CNPJ do certificado não corresponde ao CNPJ da empresa configurado no STI-hub.',
      `CNPJ divergente: certificado=${cert.cnpj} (${cert.cnpjSource}) x empresa=${expected.digits} (${expected.source}); mesma raiz=${cnpjCheck.sameRoot}; DV mod11 certificado=${cnpjCheck.certificateCnpjCheckDigitsValidMod11}, empresa=${cnpjCheck.expectedCnpjCheckDigitsValidMod11}; ${describeCertForAudit({ ...cert, notBefore: cert.notBefore.toISOString(), notAfter: cert.notAfter.toISOString() })}`,
      { cnpjCheck }
    );
  }

  let prev;
  try {
    prev = await store.load();
  } catch {
    return storeUnavailable();
  }
  let built;
  try {
    built = buildStoredCertificate(prev, decoded.bytes, parsed.data.password, cert, actor.email);
    await store.save(built.record);
  } catch (err) {
    if (err instanceof CertEncKeyMissingError) {
      return resp(503, { error: 'Armazenamento seguro do certificado indisponível (chave de criptografia não configurada).', code: 'CERT_ENC_KEY_MISSING' });
    }
    if (err instanceof CertStoreUnavailableError) return storeUnavailable();
    return storeUnavailable();
  }
  const meta = built.record.current!.meta;
  if (built.replaced) {
    audit(repo, actor, 'ERP_CERT_REPLACED', 'SUCCESS', method, ip, `Certificado A1 substituido. Anterior: ${describeCertForAudit(built.replaced)}. Novo: ${describeCertForAudit(meta)}`);
  } else {
    audit(repo, actor, 'ERP_CERT_UPLOADED', 'SUCCESS', method, ip, `Certificado A1 enviado. ${describeCertForAudit(meta)}`);
  }
  const warnings: Array<{ code: string; message: string }> = [];
  if (!meta.icpBrasil) {
    warnings.push({ code: 'CERT_NOT_ICP_BRASIL', message: 'A emissora não parece pertencer à cadeia ICP-Brasil. A SEFAZ pode recusar documentos assinados com este certificado.' });
  }
  const view = toCertificateView(built.record);
  if (view.status === 'VENCE_EM_30_DIAS') {
    warnings.push({ code: 'CERT_EXPIRING_SOON', message: `O certificado vence em ${view.daysToExpire} dia(s).` });
  }
  return resp(built.replaced ? 200 : 201, { data: { ...view, canManage: actor.isAdmin }, replaced: Boolean(built.replaced), warnings, cnpjCheck });
}
