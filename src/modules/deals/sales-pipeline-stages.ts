// STI-hub — Funil de venda principal (pipe-enterprise-b2b) no padrão de 9 etapas do HubSpot.
// IDs antigos são preservados para não quebrar referências (workflows, cadências, testes, deals).
// FUP e Final FuP são etapas novas e entram vazias.

import type { CrmDatabaseState, Deal, Pipeline, PipelineStage, Workflow } from '../../db/types';

export const ENTERPRISE_SALES_PIPELINE_ID = 'pipe-enterprise-b2b';

export const STAGE_DISCOVERY = 'stage-discovery';
export const STAGE_SQL = 'stage-sql';
export const STAGE_DEMO = 'stage-demo';
export const STAGE_PROPOSAL = 'stage-proposal';
export const STAGE_NEGOTIATION = 'stage-negotiation';
export const STAGE_FUP = 'stage-fup';
export const STAGE_FINAL_FUP = 'stage-final-fup';
export const STAGE_WON = 'stage-won';
export const STAGE_LOST = 'stage-lost';

export interface CanonicalSalesStage {
  id: string;
  name: string;
  order: number;
  defaultProbability: number;
  dealRottingDays: number;
  isClosed: boolean;
  isWon: boolean;
  /** Nome anterior no funil de 7 etapas; vazio nas etapas novas. */
  previousName: string | null;
  /** Probabilidade padrão da etapa antiga (mesmo id). */
  previousDefaultProbability: number | null;
}

/**
 * Mapeamento aprovado (7 → 9), conservando probabilidade das etapas já existentes
 * para não distorcer o forecast dos negócios atuais.
 *
 * FUP (55%) e Final FuP (35%) ficam depois de Negociação: o negócio esfriou e
 * entra em acompanhamento, com probabilidade menor que a da proposta (70%) e
 * da negociação (85%).
 */
export const ENTERPRISE_SALES_STAGES: readonly CanonicalSalesStage[] = [
  {
    id: STAGE_DISCOVERY,
    name: 'Lead Gerado',
    order: 1,
    defaultProbability: 15,
    dealRottingDays: 10,
    isClosed: false,
    isWon: false,
    previousName: 'Prospecção & Descoberta',
    previousDefaultProbability: 15,
  },
  {
    id: STAGE_SQL,
    name: 'Reunião Agendada',
    order: 2,
    defaultProbability: 30,
    dealRottingDays: 12,
    isClosed: false,
    isWon: false,
    previousName: 'Qualificação Executiva (SQL)',
    previousDefaultProbability: 30,
  },
  {
    id: STAGE_DEMO,
    name: 'Aguardando Proposta',
    order: 3,
    defaultProbability: 50,
    dealRottingDays: 14,
    isClosed: false,
    isWon: false,
    previousName: 'Demonstração & Diagnóstico',
    previousDefaultProbability: 50,
  },
  {
    id: STAGE_PROPOSAL,
    name: 'Proposta Enviada',
    order: 4,
    defaultProbability: 70,
    dealRottingDays: 10,
    isClosed: false,
    isWon: false,
    previousName: 'Proposta Comercial Enviada',
    previousDefaultProbability: 70,
  },
  {
    id: STAGE_NEGOTIATION,
    name: 'Negociação',
    order: 5,
    defaultProbability: 85,
    dealRottingDays: 7,
    isClosed: false,
    isWon: false,
    previousName: 'Negociação & Jurídico',
    previousDefaultProbability: 85,
  },
  {
    id: STAGE_FUP,
    name: 'FUP',
    order: 6,
    defaultProbability: 55,
    dealRottingDays: 10,
    isClosed: false,
    isWon: false,
    previousName: null,
    previousDefaultProbability: null,
  },
  {
    id: STAGE_FINAL_FUP,
    name: 'Final FuP',
    order: 7,
    defaultProbability: 35,
    dealRottingDays: 7,
    isClosed: false,
    isWon: false,
    previousName: null,
    previousDefaultProbability: null,
  },
  {
    id: STAGE_WON,
    name: 'Ganho',
    order: 8,
    defaultProbability: 100,
    dealRottingDays: 999,
    isClosed: true,
    isWon: true,
    previousName: 'Fechado Ganho (Won)',
    previousDefaultProbability: 100,
  },
  {
    id: STAGE_LOST,
    name: 'Perdido',
    order: 9,
    defaultProbability: 0,
    dealRottingDays: 999,
    isClosed: true,
    isWon: false,
    previousName: 'Fechado Perdido (Lost)',
    previousDefaultProbability: 0,
  },
];

export function buildEnterpriseSalesStages(pipelineId = ENTERPRISE_SALES_PIPELINE_ID): PipelineStage[] {
  return ENTERPRISE_SALES_STAGES.map((s) => ({
    id: s.id,
    pipelineId,
    name: s.name,
    order: s.order,
    defaultProbability: s.defaultProbability,
    dealRottingDays: s.dealRottingDays,
    isClosed: s.isClosed,
    isWon: s.isWon,
  }));
}

const CANONICAL_BY_ID = new Map(ENTERPRISE_SALES_STAGES.map((s) => [s.id, s]));

function normalizeStageLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Nomes antigos, novos e aliases para remapeamento idempotente por rótulo. */
const NAME_TO_STAGE_ID: Record<string, string> = {};
for (const stage of ENTERPRISE_SALES_STAGES) {
  NAME_TO_STAGE_ID[normalizeStageLabel(stage.name)] = stage.id;
  if (stage.previousName) {
    NAME_TO_STAGE_ID[normalizeStageLabel(stage.previousName)] = stage.id;
  }
}
NAME_TO_STAGE_ID[normalizeStageLabel('Prospecção e Descoberta')] = STAGE_DISCOVERY;
NAME_TO_STAGE_ID[normalizeStageLabel('Qualificação Executiva')] = STAGE_SQL;
NAME_TO_STAGE_ID[normalizeStageLabel('Demonstração e Diagnóstico')] = STAGE_DEMO;
NAME_TO_STAGE_ID[normalizeStageLabel('Proposta Comercial')] = STAGE_PROPOSAL;
NAME_TO_STAGE_ID[normalizeStageLabel('Negociação e Jurídico')] = STAGE_NEGOTIATION;
NAME_TO_STAGE_ID[normalizeStageLabel('Fechado Ganho')] = STAGE_WON;
NAME_TO_STAGE_ID[normalizeStageLabel('Won')] = STAGE_WON;
NAME_TO_STAGE_ID[normalizeStageLabel('Fechado Perdido')] = STAGE_LOST;
NAME_TO_STAGE_ID[normalizeStageLabel('Lost')] = STAGE_LOST;

export function resolveEnterpriseSalesStageId(stageId: string | null | undefined, stageName?: string | null): string | null {
  if (stageId && CANONICAL_BY_ID.has(stageId)) return stageId;
  if (stageName) {
    const mapped = NAME_TO_STAGE_ID[normalizeStageLabel(stageName)];
    if (mapped) return mapped;
  }
  return null;
}

/**
 * A sequência de e-mail (feat/deals-followup-sequence) deve INSCREVER o negócio
 * ao entrar em Proposta Enviada (e nas etapas equivalentes dos outros funis).
 * Cotações & Compras fica de fora.
 */
export const FOLLOWUP_ENROLL_STAGE_IDS: Readonly<Record<string, readonly string[]>> = {
  [ENTERPRISE_SALES_PIPELINE_ID]: [STAGE_PROPOSAL],
  'pipeline-locacao-equipamentos': ['stage-loc-simulacao'],
  'pipeline-expansao-renovacao': ['stage-exp-proposta'],
};

/**
 * Depois de inscrito, a sequência CONTINUA em FUP e Final FuP (são etapas de
 * acompanhamento da proposta). Mudança para Negociação, Ganho, Perdido ou
 * etapa anterior encerra a sequência (STAGE_CHANGED / DEAL_WON / DEAL_LOST).
 *
 * Não reinscreve automaticamente ao entrar só em FUP/Final FuP: o gatilho de
 * inscrição continua sendo a entrada em Proposta Enviada.
 *
 * Quando feat/deals-followup-sequence for rebased nesta branch, use
 * isFollowupEnrollStage no hook de inscrição e isFollowupContinueStage no
 * cron / mudança de etapa (hoje ambos usam isFollowupTriggerStage).
 */
export const FOLLOWUP_CONTINUE_STAGE_IDS: Readonly<Record<string, readonly string[]>> = {
  [ENTERPRISE_SALES_PIPELINE_ID]: [STAGE_PROPOSAL, STAGE_FUP, STAGE_FINAL_FUP],
  'pipeline-locacao-equipamentos': ['stage-loc-simulacao'],
  'pipeline-expansao-renovacao': ['stage-exp-proposta'],
};

export function isFollowupEnrollStage(pipelineId: string | null | undefined, stageId: string | null | undefined): boolean {
  if (!pipelineId || !stageId) return false;
  return (FOLLOWUP_ENROLL_STAGE_IDS[pipelineId] || []).includes(stageId);
}

export function isFollowupContinueStage(pipelineId: string | null | undefined, stageId: string | null | undefined): boolean {
  if (!pipelineId || !stageId) return false;
  return (FOLLOWUP_CONTINUE_STAGE_IDS[pipelineId] || []).includes(stageId);
}

/** Resposta do cliente em proposta/FUP avança o negócio para Negociação (cadência existente). */
export const SEQUENCE_REPLY_ADVANCE_STAGE: Readonly<Record<string, string>> = {
  [STAGE_PROPOSAL]: STAGE_NEGOTIATION,
  [STAGE_DEMO]: STAGE_NEGOTIATION,
  [STAGE_FUP]: STAGE_NEGOTIATION,
  [STAGE_FINAL_FUP]: STAGE_NEGOTIATION,
  'stage-loc-simulacao': 'stage-loc-minuta',
  'stage-loc-levantamento': 'stage-loc-minuta',
  'stage-exp-proposta': 'stage-exp-aprovacao',
};

export interface DealStageInventoryRow {
  dealId: string;
  title: string;
  status: string;
  value: number;
  probability: number;
  fromStageId: string;
  fromStageName: string;
  toStageId: string | null;
  toStageName: string | null;
  mapped: boolean;
}

export interface SalesPipelineInventory {
  pipelineId: string;
  currentStageCounts: Array<{
    stageId: string;
    stageName: string;
    dealCount: number;
    toStageId: string | null;
    toStageName: string | null;
  }>;
  deals: DealStageInventoryRow[];
  unmappedDeals: DealStageInventoryRow[];
  totalInPipeline: number;
}

export interface StageMigrationChange {
  dealId: string;
  title: string;
  fromStageId: string;
  fromStageName: string;
  toStageId: string;
  toStageName: string;
  probabilityFrom: number;
  probabilityTo: number;
}

export interface StageMigrationResult {
  applied: boolean;
  alreadyUpToDate: boolean;
  pipelineUpdated: boolean;
  stagesAdded: string[];
  dealsMapped: StageMigrationChange[];
  workflowsUpdated: string[];
  unmappedDeals: DealStageInventoryRow[];
}

function stageNameById(pipelines: Pipeline[], stageId: string): string {
  for (const pipe of pipelines) {
    const st = pipe.stages.find((s) => s.id === stageId);
    if (st) return st.name;
  }
  return stageId;
}

export function inventoryEnterpriseSalesDeals(state: CrmDatabaseState): SalesPipelineInventory {
  const pipe = state.pipelines.find((p) => p.id === ENTERPRISE_SALES_PIPELINE_ID);
  const deals = (state.deals || []).filter((d) => d.pipelineId === ENTERPRISE_SALES_PIPELINE_ID);
  const rows: DealStageInventoryRow[] = deals.map((deal) => {
    const fromName = pipe?.stages.find((s) => s.id === deal.stageId)?.name || deal.stageId;
    const toId = resolveEnterpriseSalesStageId(deal.stageId, fromName);
    const toCanon = toId ? CANONICAL_BY_ID.get(toId) : undefined;
    return {
      dealId: deal.id,
      title: deal.title,
      status: deal.status,
      value: deal.value,
      probability: deal.probability,
      fromStageId: deal.stageId,
      fromStageName: fromName,
      toStageId: toId,
      toStageName: toCanon?.name ?? null,
      mapped: Boolean(toId),
    };
  });

  const countMap = new Map<string, { stageId: string; stageName: string; dealCount: number; toStageId: string | null; toStageName: string | null }>();
  for (const row of rows) {
    const key = row.fromStageId;
    const existing = countMap.get(key);
    if (existing) {
      existing.dealCount += 1;
    } else {
      countMap.set(key, {
        stageId: row.fromStageId,
        stageName: row.fromStageName,
        dealCount: 1,
        toStageId: row.toStageId,
        toStageName: row.toStageName,
      });
    }
  }

  // Include empty current stages so the report is complete.
  for (const st of pipe?.stages || []) {
    if (!countMap.has(st.id)) {
      const toId = resolveEnterpriseSalesStageId(st.id, st.name);
      countMap.set(st.id, {
        stageId: st.id,
        stageName: st.name,
        dealCount: 0,
        toStageId: toId,
        toStageName: toId ? CANONICAL_BY_ID.get(toId)?.name ?? null : null,
      });
    }
  }

  return {
    pipelineId: ENTERPRISE_SALES_PIPELINE_ID,
    currentStageCounts: [...countMap.values()].sort((a, b) => a.stageName.localeCompare(b.stageName, 'pt-BR')),
    deals: rows,
    unmappedDeals: rows.filter((r) => !r.mapped),
    totalInPipeline: deals.length,
  };
}

function enterprisePipelineIsCanonical(pipe: Pipeline | undefined): boolean {
  if (!pipe) return false;
  if (pipe.stages.length !== ENTERPRISE_SALES_STAGES.length) return false;
  return ENTERPRISE_SALES_STAGES.every((canon, idx) => {
    const st = pipe.stages[idx];
    return (
      st &&
      st.id === canon.id &&
      st.name === canon.name &&
      st.order === canon.order &&
      st.defaultProbability === canon.defaultProbability &&
      st.dealRottingDays === canon.dealRottingDays &&
      Boolean(st.isClosed) === canon.isClosed &&
      Boolean(st.isWon) === canon.isWon
    );
  });
}

function upsertEnterpriseSalesPipeline(state: CrmDatabaseState, nowIso: string): { updated: boolean; added: string[] } {
  const existing = state.pipelines.find((p) => p.id === ENTERPRISE_SALES_PIPELINE_ID);
  const nextStages = buildEnterpriseSalesStages();
  const added = nextStages
    .filter((s) => !(existing?.stages || []).some((cur) => cur.id === s.id))
    .map((s) => s.id);

  if (!existing) {
    state.pipelines.push({
      id: ENTERPRISE_SALES_PIPELINE_ID,
      name: 'Pipeline 2: Venda de Equipamentos',
      isDefault: true,
      currency: 'BRL',
      stages: nextStages,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    return { updated: true, added };
  }

  if (enterprisePipelineIsCanonical(existing)) {
    return { updated: false, added: [] };
  }

  existing.stages = nextStages;
  existing.updatedAt = nowIso;
  return { updated: true, added };
}

function maybeAlignDealProbability(deal: Deal, toId: string): number {
  const canon = CANONICAL_BY_ID.get(toId);
  if (!canon) return deal.probability;
  if (
    canon.previousDefaultProbability != null &&
    deal.probability === canon.previousDefaultProbability &&
    deal.probability !== canon.defaultProbability
  ) {
    return canon.defaultProbability;
  }
  return deal.probability;
}

function migrateWorkflows(state: CrmDatabaseState): string[] {
  const updated: string[] = [];
  const workflows = (state.workflows || []) as Workflow[];
  for (const wf of workflows) {
    let changed = false;
    if (wf.id === 'wf-deal-proposal-followup') {
      if (wf.name !== 'Follow-up Automático de Proposta Enviada') {
        wf.name = 'Follow-up Automático de Proposta Enviada';
        changed = true;
      }
      const expected =
        'Quando um negócio entra em Proposta Enviada, cria tarefa de follow-up executivo e notifica o proprietário.';
      if (wf.description !== expected) {
        wf.description = expected;
        changed = true;
      }
      const cfg = (wf.triggerConfig || {}) as { targetStageId?: string };
      if (cfg.targetStageId && cfg.targetStageId !== STAGE_PROPOSAL) {
        cfg.targetStageId = STAGE_PROPOSAL;
        wf.triggerConfig = cfg;
        changed = true;
      }
    }
    if (changed) updated.push(wf.id);
  }

  const sequences = state.sequences || [];
  for (const seq of sequences) {
    if (seq.id !== 'seq-proposal-followup') continue;
    const expected = 'Acionada para negócios na etapa de Proposta Enviada sem interação há mais de 7 dias.';
    if (seq.description !== expected) {
      seq.description = expected;
      updated.push(seq.id);
    }
  }
  return updated;
}

/**
 * Migração idempotente do funil de venda principal. Mutates `state` and returns
 * o que mudou. Não abre conexão com banco; o chamador decide persistir.
 */
export function applySalesPipelineStageMigration(
  state: CrmDatabaseState,
  options?: { nowIso?: string }
): StageMigrationResult {
  const nowIso = options?.nowIso || new Date().toISOString();
  const beforeInventory = inventoryEnterpriseSalesDeals(state);
  const pipeResult = upsertEnterpriseSalesPipeline(state, nowIso);
  const dealsMapped: StageMigrationChange[] = [];

  for (const deal of state.deals || []) {
    if (deal.pipelineId !== ENTERPRISE_SALES_PIPELINE_ID) continue;
    const fromStageId = deal.stageId;
    const fromName =
      beforeInventory.deals.find((d) => d.dealId === deal.id)?.fromStageName ||
      stageNameById(state.pipelines, fromStageId);
    const toId = resolveEnterpriseSalesStageId(fromStageId, fromName);
    if (!toId) continue;
    const toCanon = CANONICAL_BY_ID.get(toId)!;
    const nextProbability = maybeAlignDealProbability(deal, toId);
    if (deal.stageId !== toId || deal.probability !== nextProbability) {
      dealsMapped.push({
        dealId: deal.id,
        title: deal.title,
        fromStageId,
        fromStageName: fromName,
        toStageId: toId,
        toStageName: toCanon.name,
        probabilityFrom: deal.probability,
        probabilityTo: nextProbability,
      });
      deal.stageId = toId;
      deal.probability = nextProbability;
      deal.updatedAt = nowIso;
    }
  }

  const workflowsUpdated = migrateWorkflows(state);
  const afterUnmapped = inventoryEnterpriseSalesDeals(state).unmappedDeals;
  const applied = pipeResult.updated || dealsMapped.length > 0 || workflowsUpdated.length > 0;

  return {
    applied,
    alreadyUpToDate: !applied,
    pipelineUpdated: pipeResult.updated,
    stagesAdded: pipeResult.added,
    dealsMapped,
    workflowsUpdated,
    unmappedDeals: afterUnmapped,
  };
}

export function formatSalesPipelineInventoryReport(inventory: SalesPipelineInventory): string {
  const lines: string[] = [
    `Funil ${inventory.pipelineId}: ${inventory.totalInPipeline} negócio(s)`,
    'Etapa atual → etapa nova (prob. nova) | negócios',
  ];
  for (const row of inventory.currentStageCounts) {
    const canon = row.toStageId ? CANONICAL_BY_ID.get(row.toStageId) : undefined;
    const dest = canon
      ? `${canon.name} (${canon.id}, ${canon.defaultProbability}%)`
      : 'SEM MAPEAMENTO';
    lines.push(`  ${row.dealCount}  ${row.stageName} (${row.stageId}) → ${dest}`);
  }
  if (inventory.unmappedDeals.length) {
    lines.push('Não mapeados:');
    for (const d of inventory.unmappedDeals) {
      lines.push(`  ${d.dealId} "${d.title}" stage=${d.fromStageId} (${d.fromStageName})`);
    }
  }
  return lines.join('\n');
}
