// Catalogo unico de casos de uso expostos na API v1 e no MCP (Fase 1).
import type { UseCaseDefinition } from './types';
import { CRM_USE_CASES } from './crm';
import { TICKET_USE_CASES } from './tickets';

export const INTEGRATION_USE_CASES: UseCaseDefinition[] = [...CRM_USE_CASES, ...TICKET_USE_CASES] as unknown as UseCaseDefinition[];

/**
 * Trava CISO (defesa em profundidade): o catalogo nunca contem DELETE, merge,
 * Sequencias, Fiscal/Financeiro, GestaoClick ou IAM. Validado no carregamento do modulo.
 */
const FORBIDDEN_OPERATION = /(delete|merge|sequence|sequencia|fiscal|financ|invoice|fatura|gestaoclick|iam|admin|rbac)/i;
for (const uc of INTEGRATION_USE_CASES) {
  if ((uc.method as string) === 'DELETE' || FORBIDDEN_OPERATION.test(uc.operationId) || FORBIDDEN_OPERATION.test(uc.path)) {
    throw new Error(`Caso de uso bloqueado pela politica CISO: ${uc.operationId}`);
  }
}

export function findUseCaseByOperationId(id: string): UseCaseDefinition | undefined {
  return INTEGRATION_USE_CASES.find((u) => u.operationId === id);
}
export function findUseCaseByToolName(name: string): UseCaseDefinition | undefined {
  return INTEGRATION_USE_CASES.find((u) => u.toolName === name);
}

export { UseCaseError } from './types';
export type { UseCaseDefinition, UseCaseContext } from './types';
