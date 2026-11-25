// ============================================================================
// STI-hub — versao (ETag) de uma OS para controle otimista (API v1, correcao CISO 25/11/2026).
// A OS nao tem coluna de versao: a versao e o hash dos campos editaveis (os mesmos no modo JSON e
// no modo tabela). Qualquer alteracao desses campos muda a versao => update com versao antiga => 409.
// So servidor (node:crypto): nao importar em componente de tela.
// ============================================================================
import { createHash } from 'node:crypto';

export const SERVICE_ORDER_VERSION_FIELDS = [
  'id', 'code', 'status', 'companyId', 'companyName', 'companyCnpj', 'sellerName', 'sellerUserId', 'technicianName',
  'entryDate', 'exitDate', 'totalAmount', 'description', 'measurementPeriodStart', 'measurementPeriodEnd',
  'equipmentName', 'serialNumber', 'technicalReport', 'priority',
] as const;

export function serviceOrderVersion(os: Record<string, unknown> | null | undefined): string {
  if (!os) return '';
  const parts = SERVICE_ORDER_VERSION_FIELDS.map((k) => {
    const v = os[k];
    if (k === 'totalAmount') return String(Number(v) || 0);
    return v === undefined || v === null ? '' : String(v);
  });
  return `v1-${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24)}`;
}
