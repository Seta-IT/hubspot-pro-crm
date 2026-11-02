// ============================================================================
// STI-hub - Certificado Digital A1 (cliente)
// Funcoes puras usadas pela tela Configuracoes > Certificado digital.
// Contrato final do CISO (pacote N, src/api/certificate-routes.ts): GET/POST/DELETE /api/erp/certificate.
// Regras: o .pfx/.p12 tem no maximo 64 KiB; o POST leva JSON { pfxBase64, password }
// com base64 SEM o prefixo data:; sucesso { data }, erro { error, code } com
// code no nivel de cima. Erros sao exibidos por codigo, nunca com o texto do servidor. Nada aqui grava senha ou base64 em lugar nenhum.
// ============================================================================

export const CERT_A1_ENDPOINT = '/api/erp/certificate';
export const CERT_A1_MAX_BYTES = 64 * 1024;
export const CERT_A1_ALLOWED_EXTENSIONS = ['.pfx', '.p12'] as const;
export const SETA_TELECOM_CNPJ = '14.806.925/0001-32';

export type CertificateA1Status = 'VALIDO' | 'VENCE_EM_30_DIAS' | 'VENCIDO';

export interface CertificateA1Metadata {
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
  status: CertificateA1Status | null;
  uploadedAt: string | null;
  uploadedBy: string | null;
  /** Calculado no servidor (admin com 2FA): única fonte para mostrar Enviar/Trocar/Excluir. */
  canManage: boolean;
}

/** Shape real do cnpjCheck do CISO (src/api/certificate-routes.ts): CNPJs em dígitos. */
export interface CertificateCnpjCheck {
  certificateCnpj?: string;
  certificateCnpjSource?: string;
  expectedCnpj?: string;
  expectedCnpjSource?: string;
  sameRoot?: boolean;
  certificateCnpjCheckDigitsValidMod11?: boolean;
  expectedCnpjCheckDigitsValidMod11?: boolean;
}

export interface CertificateA1Warning {
  code: string;
  message?: string;
}

export const CERT_A1_ERROR_MESSAGES: Record<string, string> = {
  CERT_INVALID_BODY: 'Requisição inválida. Selecione o arquivo e informe a senha novamente.',
  CERT_TOO_LARGE: 'O arquivo excede o limite de 64 KiB. Selecione o certificado A1 original (.pfx ou .p12).',
  CERT_INVALID_OR_WRONG_PASSWORD: 'Arquivo ou senha inválidos. Confira o certificado e a senha e tente novamente.',
  CERT_PRIVATE_KEY_MISMATCH: 'O arquivo não contém a chave privada correspondente ao certificado. Exporte o A1 novamente com a chave privada.',
  CERT_EXPIRED: 'O certificado enviado está vencido. Envie um certificado A1 dentro da validade.',
  CERT_NOT_YET_VALID: 'O certificado enviado ainda não está vigente. Verifique a data de início da validade.',
  CERT_NOT_ECNPJ: 'O certificado enviado não é um e-CNPJ. Envie o certificado A1 de pessoa jurídica da Seta Telecom.',
  CERT_CNPJ_MISMATCH: `O certificado não pertence à Seta Telecom (CNPJ ${SETA_TELECOM_CNPJ}).`,
  CERT_RATE_LIMITED: 'Muitas tentativas com falha. Aguarde 15 minutos antes de tentar novamente.',
  CERT_FORBIDDEN: 'Sem permissão. Somente administradores com 2FA podem gerenciar o certificado digital.',
  MFA_AUTH_REQUIRED: 'Sua sessão expirou ou não tem 2FA confirmado. Entre novamente no STI-hub.',
  CERT_ENC_KEY_MISSING: 'Configuração de segurança pendente no servidor. Acione o responsável pela segurança do STI-hub.',
  CERT_STORE_UNAVAILABLE: 'O armazenamento do certificado está indisponível no momento. Tente novamente em instantes.',
  CERT_NOT_FOUND: 'Nenhum certificado digital cadastrado para excluir.',
  CERT_GENERIC: 'Não foi possível concluir a operação com o certificado. Tente novamente em instantes.',
  CERT_CLIENT_EXTENSION: 'Formato não aceito. Selecione um arquivo .pfx ou .p12.',
  CERT_CLIENT_EMPTY: 'O arquivo selecionado está vazio.',
  CERT_CLIENT_PASSWORD: 'Informe a senha do certificado.',
  CERT_CLIENT_FILE: 'Selecione o arquivo do certificado.',
};

/** Formata 14 dígitos como 00.000.000/0000-00; outros valores voltam só com dígitos. */
export function formatCnpj(value?: string | null): string {
  const d = String(value || '').replace(/\D+/g, '');
  if (d.length !== 14) return d || '-';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

const STATUS_CODES: Record<number, string[]> = {
  400: ['CERT_INVALID_BODY'],
  401: ['MFA_AUTH_REQUIRED'],
  403: ['CERT_FORBIDDEN'],
  404: ['CERT_NOT_FOUND'],
  413: ['CERT_TOO_LARGE'],
  422: ['CERT_INVALID_OR_WRONG_PASSWORD', 'CERT_PRIVATE_KEY_MISMATCH', 'CERT_EXPIRED', 'CERT_NOT_YET_VALID', 'CERT_NOT_ECNPJ', 'CERT_CNPJ_MISMATCH'],
  429: ['CERT_RATE_LIMITED'],
  503: ['CERT_ENC_KEY_MISSING', 'CERT_STORE_UNAVAILABLE'],
};

/**
 * Converte status HTTP + `code` (nível de cima do envelope { error, code }) numa
 * mensagem própria em português. Nunca ecoa o `error` do servidor. No
 * CERT_CNPJ_MISMATCH usa o cnpjCheck para mostrar os dois CNPJs formatados.
 */
export function certificateErrorMessage(status: number, code?: unknown, cnpjCheck?: CertificateCnpjCheck | null): string {
  const c = typeof code === 'string' ? code : '';
  const allowed = STATUS_CODES[status] || [];
  if (c && allowed.includes(c)) {
    if (c === 'CERT_CNPJ_MISMATCH' && cnpjCheck && (cnpjCheck.certificateCnpj || cnpjCheck.expectedCnpj)) {
      return `O certificado não pertence à Seta Telecom. CNPJ do certificado: ${formatCnpj(cnpjCheck.certificateCnpj)}. CNPJ esperado: ${formatCnpj(cnpjCheck.expectedCnpj)}.`;
    }
    return CERT_A1_ERROR_MESSAGES[c];
  }
  // Código ausente ou inesperado para o status: mensagem padrão do status.
  if (status === 422) return CERT_A1_ERROR_MESSAGES.CERT_INVALID_OR_WRONG_PASSWORD;
  if (status === 413) return CERT_A1_ERROR_MESSAGES.CERT_TOO_LARGE;
  if (status === 429) return CERT_A1_ERROR_MESSAGES.CERT_RATE_LIMITED;
  if (status === 403) return CERT_A1_ERROR_MESSAGES.CERT_FORBIDDEN;
  if (status === 401) return CERT_A1_ERROR_MESSAGES.MFA_AUTH_REQUIRED;
  return CERT_A1_ERROR_MESSAGES.CERT_GENERIC;
}

/** GET com 401 (MFA_AUTH_REQUIRED) ou 403 (CERT_FORBIDDEN): a seção inteira fica oculta. */
export function shouldHideCertificateSection(status: number): boolean {
  return status === 401 || status === 403;
}

/** Envelope de sucesso: { data }. Qualquer outro formato é tratado como erro. */
export function readCertificateData(json: unknown): CertificateA1Metadata | null {
  if (!json || typeof json !== 'object') return null;
  const data = (json as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || typeof (data as { present?: unknown }).present !== 'boolean') return null;
  const d = data as Partial<CertificateA1Metadata>;
  return {
    present: d.present === true,
    subject: d.subject ?? null,
    cnpj: d.cnpj ?? null,
    issuer: d.issuer ?? null,
    icpBrasil: typeof d.icpBrasil === 'boolean' ? d.icpBrasil : null,
    serial: d.serial ?? null,
    fingerprintSha256: d.fingerprintSha256 ?? null,
    notBefore: d.notBefore ?? null,
    notAfter: d.notAfter ?? null,
    daysToExpire: typeof d.daysToExpire === 'number' ? d.daysToExpire : null,
    status: d.status ?? null,
    uploadedAt: d.uploadedAt ?? null,
    uploadedBy: d.uploadedBy ?? null,
    canManage: d.canManage === true,
  };
}

/** Envelope de erro: { error, code, cnpjCheck? } com code no nível de cima. */
export function readCertificateError(json: unknown): { code?: string; cnpjCheck?: CertificateCnpjCheck } {
  if (!json || typeof json !== 'object') return {};
  const j = json as { code?: unknown; cnpjCheck?: unknown };
  return {
    code: typeof j.code === 'string' ? j.code : undefined,
    cnpjCheck: j.cnpjCheck && typeof j.cnpjCheck === 'object' ? (j.cnpjCheck as CertificateCnpjCheck) : undefined,
  };
}

/** Avisos do POST de sucesso (âmbar), com mensagens próprias; códigos desconhecidos são ignorados. */
export function certificateWarningMessages(warnings: unknown, daysToExpire?: number | null): string[] {
  if (!Array.isArray(warnings)) return [];
  const out: string[] = [];
  for (const w of warnings) {
    const code = w && typeof w === 'object' ? (w as CertificateA1Warning).code : undefined;
    if (code === 'CERT_NOT_ICP_BRASIL') {
      out.push('A emissora deste certificado não foi reconhecida como ICP-Brasil. A SEFAZ e as prefeituras podem recusar as notas assinadas com ele.');
    } else if (code === 'CERT_EXPIRING_SOON') {
      out.push(
        typeof daysToExpire === 'number'
          ? `O certificado vence em ${daysToExpire} dia${daysToExpire === 1 ? '' : 's'}. Providencie a renovação.`
          : 'O certificado vence em até 30 dias. Providencie a renovação.'
      );
    }
  }
  return out;
}

/** Remove o prefixo `data:...;base64,` de um Data URL (resultado de FileReader.readAsDataURL). */
export function stripDataUrlPrefix(value: string): string {
  const s = String(value || '');
  const idx = s.indexOf('base64,');
  if (s.startsWith('data:') && idx >= 0) return s.slice(idx + 'base64,'.length);
  if (s.startsWith('data:')) {
    const comma = s.indexOf(',');
    return comma >= 0 ? s.slice(comma + 1) : '';
  }
  return s;
}

/** Base64 puro (sem prefixo data:) a partir dos bytes do arquivo. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  if (typeof btoa === 'function') return btoa(binary);
  // Ambiente Node (testes)
  return Buffer.from(bytes).toString('base64');
}

export function hasAllowedCertificateExtension(fileName: string): boolean {
  const n = String(fileName || '').toLowerCase().trim();
  return CERT_A1_ALLOWED_EXTENSIONS.some((ext) => n.endsWith(ext));
}

/** Validacao no cliente antes de ler o arquivo. Retorna a mensagem de erro ou null. */
export function validateCertificateFile(file: { name: string; size: number } | null | undefined): string | null {
  if (!file) return CERT_A1_ERROR_MESSAGES.CERT_CLIENT_FILE;
  if (!hasAllowedCertificateExtension(file.name)) return CERT_A1_ERROR_MESSAGES.CERT_CLIENT_EXTENSION;
  if (file.size <= 0) return CERT_A1_ERROR_MESSAGES.CERT_CLIENT_EMPTY;
  if (file.size > CERT_A1_MAX_BYTES) return CERT_A1_ERROR_MESSAGES.CERT_TOO_LARGE;
  return null;
}

export function certificateStatusBadge(status?: CertificateA1Status | null): { label: string; className: string } {
  switch (status) {
    case 'VALIDO':
      return { label: 'Válido', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    case 'VENCE_EM_30_DIAS':
      return { label: 'Vence em até 30 dias', className: 'bg-amber-50 text-amber-700 border-amber-200' };
    case 'VENCIDO':
      return { label: 'Vencido', className: 'bg-red-50 text-red-700 border-red-200' };
    default:
      return { label: 'Sem status', className: 'bg-slate-50 text-slate-600 border-slate-200' };
  }
}

export function formatDaysToExpire(days?: number | null): string {
  if (typeof days !== 'number' || !Number.isFinite(days)) return '-';
  if (days < 0) return `Vencido há ${Math.abs(days)} dia${Math.abs(days) === 1 ? '' : 's'}`;
  if (days === 0) return 'Vence hoje';
  return `${days} dia${days === 1 ? '' : 's'} para vencer`;
}

export function formatCertificateDate(iso?: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
