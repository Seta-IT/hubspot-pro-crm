// Registro das tabelas proprias do ERP (plano de tabelas). Cada etapa acrescenta o seu spec.
import { ensureErpTable, ensureKvErpStorageGuardTrigger, type ErpTableSpec, type PgQ } from './erp-table-store';
import { SERVICE_ORDERS_SPEC } from './erp-service-orders-table';

export const ERP_TABLE_SPECS: ErpTableSpec[] = [SERVICE_ORDERS_SPEC];

export function erpTableSpecFor(resource: string): ErpTableSpec | undefined {
  return ERP_TABLE_SPECS.find((s) => s.resource === resource);
}

/**
 * DDL das tabelas do ERP + trigger guarda generico. Fica FORA do ensurePostgresSchema (caminho
 * quente): roda em `npm run db:migrate` e no script de backfill.
 */
export async function ensureErpTablesSchema(db: PgQ): Promise<void> {
  for (const spec of ERP_TABLE_SPECS) await ensureErpTable(db, spec);
  await ensureKvErpStorageGuardTrigger(db);
}
