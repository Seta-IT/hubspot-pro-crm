/**
 * Helpers puros do vínculo proposta (ERP) e negócio (CRM).
 * Sem dependência do repositório, para poder ser usado também na interface.
 */
import type { Company, Contact, Deal, ErpCommercialProposal, Pipeline } from '../../db/types';
import { FOLLOWUP_TRIGGER_STAGES } from './proposal-followup-config';

export function normalizeLinkText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function wantsCreateCrmDeal(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const v = (body as Record<string, unknown>).createCrmDeal;
  return v === true || v === 'true' || v === 1 || v === '1';
}

export function documentDigits(value: unknown): string {
  return String(value || '').replace(/\D+/g, '');
}

export function dealLinkedProposalId(
  deal: Pick<Deal, 'customProperties'> & { proposalId?: string | null }
): string | null {
  const direct = typeof deal.proposalId === 'string' ? deal.proposalId.trim() : '';
  if (direct) return direct;
  const raw = deal.customProperties && typeof deal.customProperties.proposalId === 'string'
    ? String(deal.customProperties.proposalId).trim()
    : '';
  return raw || null;
}

export function findCompanyForProposal(
  companies: Company[],
  input: { companyId?: string | null; companyCnpj?: string | null; companyName?: string | null }
): Company | undefined {
  const id = String(input.companyId || '').trim();
  if (id) {
    const byId = companies.find((c) => c.id === id);
    if (byId) return byId;
  }
  const digits = documentDigits(input.companyCnpj);
  if (digits.length === 11 || digits.length === 14) {
    const byDoc = companies.find((c) => documentDigits(c.cnpj) === digits);
    if (byDoc) return byDoc;
  }
  const name = normalizeLinkText(input.companyName);
  if (!name) return undefined;
  return companies.find((c) => normalizeLinkText(c.name) === name);
}

export function findContactForProposal(
  contacts: Contact[],
  input: {
    contactId?: string | null;
    contactEmail?: string | null;
    contactName?: string | null;
    companyId?: string | null;
  }
): Contact | undefined {
  const id = String(input.contactId || '').trim();
  if (id) {
    const byId = contacts.find((c) => c.id === id);
    if (byId) return byId;
  }
  const email = String(input.contactEmail || '').trim().toLowerCase();
  if (email && email.includes('@')) {
    const byEmail = contacts.find((c) => String(c.email || '').trim().toLowerCase() === email);
    if (byEmail) return byEmail;
  }
  const name = normalizeLinkText(input.contactName);
  if (!name) return undefined;
  const sameCompany = input.companyId
    ? contacts.filter((c) => c.companyId === input.companyId)
    : contacts;
  const pool = sameCompany.length > 0 ? sameCompany : contacts;
  return pool.find((c) => normalizeLinkText(`${c.firstName} ${c.lastName}`) === name);
}

export function splitPersonName(value: unknown): { firstName: string; lastName: string } {
  const parts = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return { firstName: 'Contato', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

export function proposalDealValue(proposal: ErpCommercialProposal): number {
  const explicit = Number(proposal.totalContractValue);
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit * 100) / 100;
  const months = Math.max(1, Number(proposal.contractMonths || 1));
  const mrr = Number(proposal.monthlyRecurringTotal || 0);
  const setup = Number(proposal.oneTimeSetupTotal || proposal.setupFee || 0);
  return Math.round((mrr * months + setup) * 100) / 100;
}

export function resolveDealLinkedProposal(
  deal: Deal,
  proposals: ErpCommercialProposal[]
): ErpCommercialProposal | undefined {
  const pid = dealLinkedProposalId(deal);
  return proposals.find((p) => p.dealId === deal.id || (pid && (p.id === pid || p.code === pid)));
}

export type DealPlacementFallback = 'preferred-stage' | 'pipeline-first-stage' | 'default-pipeline';

export interface DealPlacement {
  pipelineId: string;
  pipelineName: string;
  stageId: string;
  stageName: string;
  usedFallback: DealPlacementFallback;
}

const RENTAL_OR_SERVICE_BUDGET_TYPES = new Set(['LOCACAO', 'SERVICOS']);

/** Destino preferido: PRODUTOS/CONJUNTO (ou sem tipo) = Pipeline 2; LOCACAO/SERVICOS = Pipeline 1. */
export function preferredDealPlacementForBudgetType(
  budgetType?: string | null
): Omit<DealPlacement, 'usedFallback'> {
  const type = String(budgetType || '').trim().toUpperCase();
  const sale = FOLLOWUP_TRIGGER_STAGES.find((s) => s.pipelineId === 'pipe-enterprise-b2b');
  const rental = FOLLOWUP_TRIGGER_STAGES.find((s) => s.pipelineId === 'pipeline-locacao-equipamentos');
  const chosen = RENTAL_OR_SERVICE_BUDGET_TYPES.has(type) ? rental : sale;
  return {
    pipelineId: chosen?.pipelineId || 'pipe-enterprise-b2b',
    pipelineName: chosen?.pipelineName || 'Pipeline 2: Venda de Equipamentos',
    stageId: chosen?.stageId || 'stage-proposal',
    stageName: chosen?.stageName || 'Proposta Enviada',
  };
}

function stagesInOrder(pipeline: Pipeline | undefined) {
  return [...(pipeline?.stages || [])].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

/**
 * Confere o funil e a etapa em listPipelines.
 * Se a etapa não existir, usa a etapa inicial do funil indicado.
 * Se o funil não existir, usa o funil padrão (isDefault ou o primeiro).
 */
export function resolveDealPlacementForProposal(
  pipelines: readonly Pipeline[] | null | undefined,
  budgetType?: string | null
): DealPlacement {
  const preferred = preferredDealPlacementForBudgetType(budgetType);
  const list = Array.isArray(pipelines) ? [...pipelines] : [];
  const preferredPipe = list.find((p) => p.id === preferred.pipelineId);
  if (preferredPipe) {
    const stages = stagesInOrder(preferredPipe);
    const preferredStage = stages.find((s) => s.id === preferred.stageId);
    if (preferredStage) {
      return {
        pipelineId: preferredPipe.id,
        pipelineName: preferredPipe.name || preferred.pipelineName,
        stageId: preferredStage.id,
        stageName: preferredStage.name || preferred.stageName,
        usedFallback: 'preferred-stage',
      };
    }
    const first = stages[0];
    if (first) {
      return {
        pipelineId: preferredPipe.id,
        pipelineName: preferredPipe.name || preferred.pipelineName,
        stageId: first.id,
        stageName: first.name,
        usedFallback: 'pipeline-first-stage',
      };
    }
  }
  const fallbackPipe = list.find((p) => p.isDefault) || list[0];
  const first = stagesInOrder(fallbackPipe)[0];
  return {
    pipelineId: fallbackPipe?.id || preferred.pipelineId,
    pipelineName: fallbackPipe?.name || preferred.pipelineName,
    stageId: first?.id || preferred.stageId,
    stageName: first?.name || preferred.stageName,
    usedFallback: 'default-pipeline',
  };
}

export function funnelLabelForBudgetType(
  budgetType?: string | null,
  pipelines?: readonly Pipeline[] | null
): string {
  const placement =
    pipelines && pipelines.length > 0
      ? resolveDealPlacementForProposal(pipelines, budgetType)
      : preferredDealPlacementForBudgetType(budgetType);
  return `Funil: ${placement.pipelineName}`;
}
