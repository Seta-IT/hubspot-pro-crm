import type { ErpCommercialProposal } from '../../db/types';
import { formatProposalDisplayCode } from './proposal-number';
import { computeProposalTotals } from './proposal-share';
import { defaultProductsProposalTitle, displayProposalTitle } from './proposal-title';

/** Campos de ciclo de vida, aceite, envio e vínculo que uma cópia não deve herdar. */
export const PROPOSAL_COPY_OMIT_KEYS = [
  'id',
  'code',
  'version',
  'versionLabel',
  'versionHistory',
  'statusHistory',
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

export function recalculateProposalValidity(
  input: { proposalDate?: string; createdAt?: string; validUntil?: string },
  now = new Date()
): string {
  const start = String(input.proposalDate || input.createdAt || '').slice(0, 10);
  const end = String(input.validUntil || '').slice(0, 10);
  let days = 15;
  if (start && end) {
    const ms = Date.parse(end) - Date.parse(start);
    if (Number.isFinite(ms)) {
      const delta = Math.round(ms / 86400000);
      if (delta > 0) days = delta;
    }
  }
  return new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10);
}

export function proposalCopyCreatedToast(sourceCode: unknown): string {
  const num = formatProposalDisplayCode(sourceCode);
  return num ? `Cópia do orçamento #${num} criada` : 'Cópia do orçamento criada';
}

function copyTitleFor(source: ErpCommercialProposal): string {
  const stored = String(source.title || '').trim();
  if (source.budgetType === 'PRODUTOS') {
    const auto = defaultProductsProposalTitle(source);
    if (!stored || stored === auto) return '';
    return / \(Cópia\)$/i.test(stored) ? stored : `${stored} (Cópia)`;
  }
  const label = displayProposalTitle(source) || stored;
  if (!label) return '';
  return / \(Cópia\)$/i.test(label) ? label : `${label} (Cópia)`;
}

export function buildProposalCopyDraft(
  source: ErpCommercialProposal,
  options: { nextCode: string; now?: Date; newId?: string }
): ErpCommercialProposal {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const today = nowIso.slice(0, 10);
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
