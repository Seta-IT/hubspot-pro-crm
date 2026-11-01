// ============================================================================
// Pacote I (01/11/2026): PATCH/PUT /api/erp/(rental-)contracts/:id grava SO campos conhecidos
// do contrato (ErpRentalContract). Chaves desconhecidas (SavedBy, saved_by, __proto__...) sao
// DESCARTADAS em vez de gravadas (mass-assign generico). Autoria/trilhas continuam fora:
// id, version, versionLabel, versionHistory, statusHistory, savedBy, updatedBy, createdAt,
// updatedAt nunca vem do corpo (a versao e o autor sao definidos pelo servidor/sessao).
// O teste de regressao confere esta lista contra a interface em src/db/types.ts.
// ============================================================================
import type { ErpRentalContract } from '../db/types';

export const RENTAL_CONTRACT_SERVER_ONLY_KEYS = Object.freeze([
  'id',
  'version',
  'versionLabel',
  'versionHistory',
  'createdAt',
  'updatedAt',
] as const satisfies ReadonlyArray<keyof ErpRentalContract>);

export const RENTAL_CONTRACT_PATCH_KEYS = Object.freeze([
  'contractNumber', 'title', 'modality', 'companyId', 'companyName', 'companyCnpj', 'contactId',
  'dealId', 'proposalId', 'monthlyValue', 'dueDay', 'startDate', 'endDate', 'contractMonths',
  'readjustmentIndex', 'lastReadjustmentDate', 'lastReadjustmentPercent', 'readjustmentHistory',
  'partialReturns', 'lastEmailSentAt', 'lastEmailRecipient', 'status', 'equipments',
  'remessaNfeNumber', 'remessaCfop', 'legalBasisNote', 'lastBilledCompetence', 'gestaoClickCode',
  'nextDueDate', 'periodicityLabel', 'contractTemplateModel', 'customClausesText', 'paymentLinkUrl',
  'digitalSignature', 'sellerName', 'costCenter', 'chartOfAccounts', 'proposalNumber',
  'freightValueBrl', 'returnFreightValueBrl', 'freightModality', 'freightTrackingCode',
  'includeFreightInInvoice', 'externalContractNumber', 'contractTermLabel', 'productsSubtotalBrl',
  'additionValueBrl', 'discountValueBrl', 'discountPercent', 'deliveryDate', 'pickupDate',
  'deliveryCarrier', 'deliveryCity', 'deliveryAddress', 'deliveryNotes',
  'customerPurchaseOrderNumber', 'measurementNumber', 'measurementPeriod', 'measurementNotes',
  'recurrenceEndMode', 'recurrenceOccurrencesLimit', 'billingRecurrence', 'paymentMethod',
  'emailAutomationMode', 'billingRecipientEmails', 'generateNextInvoiceOnSave',
  'autoGenerateInvoiceDaysBeforeDue', 'autoSendEmailOnBilling', 'dunningRuleEnabled',
  'nextBillingDate', 'customDueRuleEnabled', 'customDueOffsetDays', 'customDueTargetWeekday',
  'customDueRuleLabel', 'totalInstallmentsCount', 'billedInstallmentsCount', 'contractNotes',
  'internalNotes', 'contractAttachments',
] as const satisfies ReadonlyArray<keyof ErpRentalContract>);

const ALLOWED = new Set<string>(RENTAL_CONTRACT_PATCH_KEYS);

/** Copia so as chaves conhecidas e editaveis; devolve tambem as descartadas (sem valores). */
export function pickRentalContractPatch(body: unknown): { patch: Partial<ErpRentalContract>; dropped: string[] } {
  const src = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const patch: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const k of Object.keys(src)) {
    if (ALLOWED.has(k) && Object.prototype.hasOwnProperty.call(src, k)) patch[k] = src[k];
    else dropped.push(k);
  }
  return { patch: patch as Partial<ErpRentalContract>, dropped };
}
