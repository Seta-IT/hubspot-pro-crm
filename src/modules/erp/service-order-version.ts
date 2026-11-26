// ============================================================================
// STI-hub — versao (ETag) de OS e de pedido de venda para controle otimista (API v1, CISO 25-26/11).
// Os registros nao tem coluna de versao no JSON: a versao e o hash dos campos editaveis (os mesmos no
// modo JSON e no modo tabela). Qualquer alteracao desses campos muda a versao => versao antiga => 409.
// A MESMA funcao roda (1) no conector, (2) na rota do app (checagem + gravacao no mesmo passo) e
// (3) dentro da transacao do Postgres, com a linha do crm_kv_store travada (SELECT ... FOR UPDATE).
// So servidor (node:crypto): nao importar em componente de tela.
// ============================================================================
import { createHash } from 'node:crypto';

export const SERVICE_ORDER_VERSION_FIELDS = [
  'id', 'code', 'status', 'companyId', 'companyName', 'companyCnpj', 'sellerName', 'sellerUserId', 'technicianName',
  'technicianUserId', 'entryDate', 'exitDate', 'totalAmount', 'description', 'measurementPeriodStart', 'measurementPeriodEnd',
  'equipmentName', 'serialNumber', 'technicalReport', 'priority',
] as const;

export const SALES_ORDER_VERSION_FIELDS = [
  'id', 'code', 'status', 'companyId', 'companyName', 'sellerName', 'sellerUserId', 'date', 'totalAmount', 'itemsSummary',
  'paymentMethod', 'saleType',
] as const;

function recordVersion(fields: readonly string[], rec: Record<string, unknown> | null | undefined): string {
  if (!rec) return '';
  const parts = fields.map((k) => {
    const v = rec[k];
    if (k === 'totalAmount') return String(Number(v) || 0);
    return v === undefined || v === null ? '' : String(v);
  });
  return `v1-${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24)}`;
}

export function serviceOrderVersion(os: Record<string, unknown> | null | undefined): string {
  return recordVersion(SERVICE_ORDER_VERSION_FIELDS, os);
}

export function salesOrderVersion(so: Record<string, unknown> | null | undefined): string {
  return recordVersion(SALES_ORDER_VERSION_FIELDS, so);
}

/** Colecoes do ERP com controle otimista pela versao-hash. */
export type VersionedErpCollection = 'serviceOrders' | 'salesOrders';
export function erpRecordVersion(collection: VersionedErpCollection, rec: Record<string, unknown> | null | undefined): string {
  return collection === 'serviceOrders' ? serviceOrderVersion(rec) : salesOrderVersion(rec);
}
