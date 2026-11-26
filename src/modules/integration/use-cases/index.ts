// Catalogo unico de casos de uso expostos na API v1 e no MCP (Fase 1 + Fase 2 / Lote 1).
import type { UseCaseDefinition } from './types';
import { CRM_USE_CASES } from './crm';
import { CRM_EXTRA_USE_CASES } from './crm-extra';
import { ERP_USE_CASES } from './erp';
import { TICKET_USE_CASES } from './tickets';

export const INTEGRATION_USE_CASES: UseCaseDefinition[] = [
  ...CRM_USE_CASES,
  ...TICKET_USE_CASES,
  ...CRM_EXTRA_USE_CASES,
  ...ERP_USE_CASES,
] as unknown as UseCaseDefinition[];

/**
 * Trava CISO (defesa em profundidade): o catalogo nunca contem DELETE, merge,
 * GestaoClick, IAM/Admin, e nenhuma ESCRITA de Sequencias, Fiscal ou Financeiro.
 * Lote 1 (24/11/2026): leituras (GET, mutation=false) desses temas so entram se estiverem
 * nesta allowlist explicita. Validado no carregamento do modulo.
 */
const ALWAYS_FORBIDDEN = /(delete|merge|gestaoclick|iam|admin|rbac)/i;
const FORBIDDEN_UNLESS_READ_ALLOWLISTED = /(sequence|sequencia|fiscal|financ|invoice|fatura)/i;
export const LOTE1_SENSITIVE_READS: ReadonlySet<string> = new Set([
  'automation.sequences.list',
  'erp.financial_entries.list',
  'erp.financial_dre.get',
  'erp.invoices.list',
  'erp.invoices.get',
  'erp.fiscal_settings.get',
]);
for (const uc of INTEGRATION_USE_CASES) {
  if ((uc.method as string) === 'DELETE' || ALWAYS_FORBIDDEN.test(uc.operationId) || ALWAYS_FORBIDDEN.test(uc.path)) {
    throw new Error(`Caso de uso bloqueado pela politica CISO: ${uc.operationId}`);
  }
  if (FORBIDDEN_OPERATION_HIT(uc)) {
    const readOnly = uc.method === 'GET' && uc.mutation === false && LOTE1_SENSITIVE_READS.has(uc.operationId);
    if (!readOnly) throw new Error(`Caso de uso bloqueado pela politica CISO: ${uc.operationId}`);
  }
  // Lote 1: todo o ERP e somente leitura.
  if ((uc.requiredModule === 'erp' || uc.requiredScope.startsWith('erp:')) && (uc.method !== 'GET' || uc.mutation)) {
    throw new Error(`Caso de uso de escrita no ERP bloqueado no Lote 1: ${uc.operationId}`);
  }
}
function FORBIDDEN_OPERATION_HIT(uc: UseCaseDefinition): boolean {
  return FORBIDDEN_UNLESS_READ_ALLOWLISTED.test(uc.operationId) || FORBIDDEN_UNLESS_READ_ALLOWLISTED.test(uc.path);
}

export function findUseCaseByOperationId(id: string): UseCaseDefinition | undefined {
  return INTEGRATION_USE_CASES.find((u) => u.operationId === id);
}
export function findUseCaseByToolName(name: string): UseCaseDefinition | undefined {
  return INTEGRATION_USE_CASES.find((u) => u.toolName === name);
}

export { UseCaseError } from './types';
export type { UseCaseDefinition, UseCaseContext } from './types';
