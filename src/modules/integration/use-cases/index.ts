// Catalogo unico de casos de uso expostos na API v1 e no MCP (Fase 1 + Fase 2 / Lotes 1, 2 e 3).
import type { UseCaseDefinition } from './types';
import { CRM_USE_CASES } from './crm';
import { CRM_EXTRA_USE_CASES } from './crm-extra';
import { CRM_WRITE_USE_CASES } from './crm-write';
import { ERP_USE_CASES } from './erp';
import { ERP_WRITE_USE_CASES } from './erp-write';
import { LOTE3_DANGEROUS_SCOPES } from '../scopes';
import { lote3aUseCases } from './danger-3a';
import { lote3bUseCases } from './danger-3b';
import { lote3cUseCases } from './danger-3c';
import { lote3dUseCases } from './danger-3d';
import { TICKET_USE_CASES } from './tickets';

export const INTEGRATION_USE_CASES: UseCaseDefinition[] = [
  ...CRM_USE_CASES,
  ...TICKET_USE_CASES,
  ...CRM_EXTRA_USE_CASES,
  ...ERP_USE_CASES,
  ...ERP_WRITE_USE_CASES,
  ...CRM_WRITE_USE_CASES,
  ...lote3aUseCases,
  ...lote3bUseCases,
  ...lote3cUseCases,
  ...lote3dUseCases,
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
/**
 * Lote 2 (24/11/2026): allowlist FECHADA de escritas reversiveis (POST/PATCH). Qualquer outra
 * escrita no ERP ou em temas sensiveis (sequence/fiscal/financeiro/fatura) derruba o carregamento.
 */
export const LOTE2_WRITE_OPERATIONS: ReadonlySet<string> = new Set([
  'erp.proposals.create',
  'erp.proposals.update',
  'erp.proposals.restore_version',
  'erp.contracts.create',
  'erp.contracts.update',
  'erp.contracts.restore_version',
  'erp.contracts.renew',
  'erp.service_orders.create',
  'erp.service_orders.update',
  'erp.service_orders.status_change',
  'erp.service_orders.duplicate',
  'erp.service_orders.create_from_ticket',
  'erp.sales_orders.create',
  'erp.sales_orders.update',
  'erp.purchase_orders.create',
  'erp.purchase_orders.update',
  'erp.suppliers.create',
  'erp.suppliers.update',
  'erp.catalog.create',
  'erp.catalog.update',
  'erp.aux_lists.create',
  'erp.aux_lists.update',
  'erp.financial_entries.create',
  'erp.financial_entries.update',
  'crm.tasks.create',
  'crm.tasks.update',
  'crm.tasks.complete',
  'automation.sequences.create_draft',
  'automation.workflows.create_draft',
  'automation.workflows.update_draft',
  'marketing.campaigns.create_draft',
]);
/**
 * Lote 3 (24/11/2026): allowlist FECHADA de operacoes PERIGOSAS. Cada uma so existe como par
 * <op>.prepare (POST, mutation=false) + <op>.commit (POST, mutation=true, nao idempotente), com
 * escopo da lista LOTE3_DANGEROUS_SCOPES. GestaoClick/IAM/Admin/RBAC continuam sempre proibidos.
 */
export const LOTE3_DANGEROUS_OPERATIONS: ReadonlySet<string> = new Set([
  // 3a
  'crm.contacts.delete',
  'crm.companies.delete',
  'crm.deals.delete',
  'crm.tasks.delete',
  'erp.proposals.delete',
  'erp.contracts.delete',
  'erp.financial_entries.delete',
  'erp.catalog.delete',
  'erp.aux_lists.delete',
  'erp.records.delete',
  'crm.records.merge',
  'crm.data_health.auto_clean',
  'crm.data_health.reassign_orphans',
  'crm.enrichment.run',
  // 3b
  'comms.email.send',
  'crm.sequences.enroll',
  'crm.proposal_followup.set',
  'erp.proposals.approve',
  'erp.proposals.public_link',
  'erp.invoices.public_link',
  'automation.workflows.activate',
  'automation.workflows.trigger',
  'marketing.campaigns.dispatch',
  'erp.contracts.batch_email',
  // 3c
  'erp.financial_entries.pay',
  'erp.invoices.pay',
  'erp.financial.reconcile_ofx',
  'erp.financial.import_document',
  'erp.purchases.import_xml',
  'erp.bank_accounts.create',
  'erp.bank_accounts.update',
  'erp.bank_accounts.delete',
  // 3d
  'erp.fiscal_documents.issue',
  'erp.contracts.generate_invoice',
  'erp.contracts.generate_remessa',
  'erp.contracts.batch_billing',
  'erp.contracts.partial_return',
  'erp.contracts.readjust',
  'erp.nfe_import.emit',
  'erp.fiscal_documents.cancel',
  'erp.fiscal_documents.delete',
]);
const NEVER = /(gestaoclick|iam|admin|rbac)/i;
const lote3Base = (uc: UseCaseDefinition) => uc.operationId.replace(/\.(prepare|commit)$/, '');
const isLote3Dangerous = (uc: UseCaseDefinition): boolean => {
  if (!uc.dangerous || !LOTE3_DANGEROUS_OPERATIONS.has(lote3Base(uc)) || uc.method !== 'POST') return false;
  if (!LOTE3_DANGEROUS_SCOPES.has(uc.requiredScope) || NEVER.test(uc.operationId) || NEVER.test(uc.path)) return false;
  if (uc.dangerous === 'prepare') return uc.mutation === false && uc.operationId.endsWith('.prepare') && uc.toolName.endsWith('_prepare');
  return uc.mutation === true && !uc.idempotent && uc.operationId.endsWith('.commit') && uc.toolName.endsWith('_commit');
};
const isLote2Write = (uc: UseCaseDefinition) =>
  LOTE2_WRITE_OPERATIONS.has(uc.operationId) && (uc.method === 'POST' || uc.method === 'PATCH') && uc.mutation === true;
for (const uc of INTEGRATION_USE_CASES) {
  if (uc.dangerous || LOTE3_DANGEROUS_SCOPES.has(uc.requiredScope)) {
    if (!isLote3Dangerous(uc)) throw new Error(`Operacao perigosa fora da allowlist do Lote 3: ${uc.operationId}`);
    continue;
  }
  if ((uc.method as string) === 'DELETE' || ALWAYS_FORBIDDEN.test(uc.operationId) || ALWAYS_FORBIDDEN.test(uc.path)) {
    throw new Error(`Caso de uso bloqueado pela politica CISO: ${uc.operationId}`);
  }
  if (FORBIDDEN_OPERATION_HIT(uc)) {
    const readOnly = uc.method === 'GET' && uc.mutation === false && LOTE1_SENSITIVE_READS.has(uc.operationId);
    if (!readOnly && !isLote2Write(uc)) throw new Error(`Caso de uso bloqueado pela politica CISO: ${uc.operationId}`);
  }
  // ERP: leitura (Lote 1) ou escrita da allowlist fechada do Lote 2.
  if ((uc.requiredModule === 'erp' || uc.requiredScope.startsWith('erp:')) && (uc.method !== 'GET' || uc.mutation) && !isLote2Write(uc)) {
    throw new Error(`Caso de uso de escrita no ERP fora da allowlist do Lote 2: ${uc.operationId}`);
  }
  // Escritas do Lote 2: Idempotency-Key obrigatoria em toda criacao (POST nao idempotente).
  if (isLote2Write(uc) && uc.method === 'POST' && !uc.idempotent && !uc.requireIdempotencyKey) {
    throw new Error(`Criacao do Lote 2 sem Idempotency-Key obrigatoria: ${uc.operationId}`);
  }
}
// Lote 3: todo prepare tem o commit correspondente (e vice-versa).
for (const op of LOTE3_DANGEROUS_OPERATIONS) {
  const has = (sfx: string) => INTEGRATION_USE_CASES.some((u) => u.operationId === `${op}.${sfx}` && u.dangerous === sfx);
  if (!has('prepare') || !has('commit')) throw new Error(`Operacao perigosa do Lote 3 sem par prepare/commit: ${op}`);
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
