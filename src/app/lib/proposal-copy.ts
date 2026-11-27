import type { ErpCommercialProposal } from '../../db/types';
import { localIsoDate } from './br-date';
import { formatProposalDisplayCode } from './proposal-number';
import { computeProposalTotals } from './proposal-share';
import { isAutomaticProposalTitle } from './proposal-title';

import { recalculateProposalValidity } from './proposal-validity';
export { recalculateProposalValidity };

/** Campos de ciclo de vida, aceite, envio e vínculo que uma cópia não deve herdar. */
export const PROPOSAL_COPY_OMIT_KEYS = [
  'id',
  'code',
  'version',
  'versionLabel',
  'versionHistory',
  'statusHistory',
  'dealId',
  'convertedContractId',
  'convertedInvoiceId',
  'digitalSignature',
  'approvalIdempotencyKeySha256',
  'approvalMode',
  'approvalJustification',
  'approvedBy',
  'approvedAt',
  'lastEmailSentAt',
  'emailHistory',
  'firstViewedAt',
  'lastViewedAt',
  'viewCount',
  'createdByServiceAccount',
  'sellerUserId',
  'createdAt',
  'updatedAt',
  'expectedUpdatedAt',
  'versionCount',
  'versionChangeSummary',
  '__summary',
  'gcSource',
] as const;

export function proposalCopyCreatedToast(sourceCode: unknown): string {
  const num = formatProposalDisplayCode(sourceCode);
  return num ? `Cópia do orçamento #${num} criada` : 'Cópia do orçamento criada';
}

function copyTitleFor(source: ErpCommercialProposal): string {
  const stored = String(source.title || '').trim();
  if (isAutomaticProposalTitle(stored, source)) return '';
  return / \(Cópia\)$/i.test(stored) ? stored : `${stored} (Cópia)`;
}

export function buildProposalCopyDraft(
  source: ErpCommercialProposal,
  options: { nextCode: string; now?: Date; newId?: string }
): ErpCommercialProposal {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const today = localIsoDate(now);
  const isProducts = source.budgetType === 'PRODUTOS';

  const kept: Record<string, unknown> = { ...(source as unknown as Record<string, unknown>) };
  for (const key of PROPOSAL_COPY_OMIT_KEYS) delete kept[key];

  const items = (source.items || []).map((item, index) => ({
    ...item,
    id: `pi-${now.getTime()}-${index + 1}`,
  }));

  const draft = computeProposalTotals({
    ...(kept as unknown as ErpCommercialProposal),
    id: options.newId || `prop-copy-${now.getTime()}`,
    code: options.nextCode,
    title: copyTitleFor(source),
    dealId: null,
    status: 'RASCUNHO',
    version: 1,
    proposalDate: today,
    validUntil: recalculateProposalValidity(source, now),
    items,
    convertedContractId: null,
    convertedInvoiceId: null,
    digitalSignature: null,
    lastEmailSentAt: null,
    emailHistory: [],
    versionHistory: [],
    statusHistory: [],
    firstViewedAt: null,
    lastViewedAt: null,
    viewCount: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    ...(isProducts
      ? {
          slaTier: 'SEM_SLA_ESPECIFICO',
          slaAvailabilityPercent: '',
          slaResponseHours: 0,
          contractMonths: 1,
          setupFee: 0,
        }
      : {}),
  });

  return draft;
}
