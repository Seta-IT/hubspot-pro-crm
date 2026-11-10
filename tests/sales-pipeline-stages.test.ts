import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createInitialSeedState } from '../src/db/seed';
import type { CrmDatabaseState, Pipeline } from '../src/db/types';
import {
  ENTERPRISE_SALES_PIPELINE_ID,
  ENTERPRISE_SALES_STAGES,
  STAGE_DEMO,
  STAGE_DISCOVERY,
  STAGE_FINAL_FUP,
  STAGE_FUP,
  STAGE_LOST,
  STAGE_NEGOTIATION,
  STAGE_PROPOSAL,
  STAGE_SQL,
  STAGE_WON,
  applySalesPipelineStageMigration,
  inventoryEnterpriseSalesDeals,
  isFollowupContinueStage,
  isFollowupEnrollStage,
  resolveEnterpriseSalesStageId,
} from '../src/modules/deals/sales-pipeline-stages';

function legacyEnterprisePipeline(): Pipeline {
  return {
    id: ENTERPRISE_SALES_PIPELINE_ID,
    name: 'Pipeline 2: Venda de Equipamentos',
    isDefault: true,
    currency: 'BRL',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    stages: [
      { id: STAGE_DISCOVERY, pipelineId: ENTERPRISE_SALES_PIPELINE_ID, name: 'Prospecção & Descoberta', order: 1, defaultProbability: 15, dealRottingDays: 10, isClosed: false, isWon: false },
      { id: STAGE_SQL, pipelineId: ENTERPRISE_SALES_PIPELINE_ID, name: 'Qualificação Executiva (SQL)', order: 2, defaultProbability: 30, dealRottingDays: 12, isClosed: false, isWon: false },
      { id: STAGE_DEMO, pipelineId: ENTERPRISE_SALES_PIPELINE_ID, name: 'Demonstração & Diagnóstico', order: 3, defaultProbability: 50, dealRottingDays: 14, isClosed: false, isWon: false },
      { id: STAGE_PROPOSAL, pipelineId: ENTERPRISE_SALES_PIPELINE_ID, name: 'Proposta Comercial Enviada', order: 4, defaultProbability: 70, dealRottingDays: 10, isClosed: false, isWon: false },
      { id: STAGE_NEGOTIATION, pipelineId: ENTERPRISE_SALES_PIPELINE_ID, name: 'Negociação & Jurídico', order: 5, defaultProbability: 85, dealRottingDays: 7, isClosed: false, isWon: false },
      { id: STAGE_WON, pipelineId: ENTERPRISE_SALES_PIPELINE_ID, name: 'Fechado Ganho (Won)', order: 6, defaultProbability: 100, dealRottingDays: 999, isClosed: true, isWon: true },
      { id: STAGE_LOST, pipelineId: ENTERPRISE_SALES_PIPELINE_ID, name: 'Fechado Perdido (Lost)', order: 7, defaultProbability: 0, dealRottingDays: 999, isClosed: true, isWon: false },
    ],
  };
}

function legacyStateFromSeed(): CrmDatabaseState {
  const state = createInitialSeedState();
  const locacao = state.pipelines.find((p) => p.id === 'pipeline-locacao-equipamentos')!;
  const expansao = state.pipelines.find((p) => p.id === 'pipeline-expansao-renovacao')!;
  const cotacoes = state.pipelines.find((p) => p.id === 'pipeline-cotacoes-compras')!;
  state.pipelines = [legacyEnterprisePipeline(), locacao, expansao, cotacoes];
  const wf = state.workflows.find((w) => w.id === 'wf-deal-proposal-followup');
  if (wf) {
    wf.name = 'Follow-up Automático de Proposta Comercial Enviada';
    wf.description =
      'Quando um negócio entra em Proposta Comercial Enviada, cria tarefa de follow-up executivo e notifica o proprietário.';
  }
  const seq = state.sequences.find((s) => s.id === 'seq-proposal-followup');
  if (seq) {
    seq.description = 'Acionada para negócios na etapa de Proposta Comercial sem interação há mais de 7 dias.';
  }
  return state;
}

describe('funil de venda — 9 etapas do HubSpot', () => {
  it('seed já publica as 9 etapas canônicas com os IDs antigos', () => {
    const seed = createInitialSeedState();
    const pipe = seed.pipelines.find((p) => p.id === ENTERPRISE_SALES_PIPELINE_ID);
    assert.ok(pipe);
    assert.equal(pipe!.stages.length, 9);
    assert.deepEqual(
      pipe!.stages.map((s) => s.id),
      ENTERPRISE_SALES_STAGES.map((s) => s.id)
    );
    assert.deepEqual(
      pipe!.stages.map((s) => s.name),
      ['Lead Gerado', 'Reunião Agendada', 'Aguardando Proposta', 'Proposta Enviada', 'Negociação', 'FUP', 'Final FuP', 'Ganho', 'Perdido']
    );
  });

  it('inventário do seed mapeia os 7 negócios do funil de venda e deixa FUP vazio', () => {
    const inventory = inventoryEnterpriseSalesDeals(createInitialSeedState());
    const byStage = Object.fromEntries(inventory.currentStageCounts.map((r) => [r.stageId, r.dealCount]));
    assert.equal(inventory.totalInPipeline, 7);
    assert.equal(inventory.unmappedDeals.length, 0);
    assert.equal(byStage[STAGE_DISCOVERY], 1);
    assert.equal(byStage[STAGE_DEMO], 1);
    assert.equal(byStage[STAGE_PROPOSAL], 1);
    assert.equal(byStage[STAGE_NEGOTIATION], 2);
    assert.equal(byStage[STAGE_WON], 1);
    assert.equal(byStage[STAGE_LOST], 1);
    assert.equal(byStage[STAGE_SQL] ?? 0, 0);
    assert.equal(byStage[STAGE_FUP] ?? 0, 0);
    assert.equal(byStage[STAGE_FINAL_FUP] ?? 0, 0);
    const vtex = inventory.deals.find((d) => d.dealId === 'deal-vtex-automation');
    assert.equal(vtex?.fromStageId, STAGE_PROPOSAL);
    assert.equal(vtex?.toStageName, 'Proposta Enviada');
  });

  it('migração é idempotente, preserva IDs e só adiciona FUP / Final FuP', () => {
    const state = legacyStateFromSeed();
    const locDeal = state.deals.find((d) => d.id === 'deal-loc-totvs-pabx')!;
    const locStageBefore = locDeal.stageId;
    const first = applySalesPipelineStageMigration(state, { nowIso: '2026-11-10T12:00:00.000Z' });
    assert.equal(first.applied, true);
    assert.equal(first.pipelineUpdated, true);
    assert.deepEqual(first.stagesAdded.sort(), [STAGE_FINAL_FUP, STAGE_FUP]);
    assert.equal(first.dealsMapped.length, 0, 'negócios já usam os IDs antigos; não precisam mudar de stageId');
    assert.ok(first.workflowsUpdated.includes('wf-deal-proposal-followup'));

    const pipe = state.pipelines.find((p) => p.id === ENTERPRISE_SALES_PIPELINE_ID)!;
    assert.equal(pipe.stages.length, 9);
    assert.equal(pipe.stages.find((s) => s.id === STAGE_PROPOSAL)?.name, 'Proposta Enviada');
    assert.equal(state.deals.find((d) => d.id === 'deal-vtex-automation')?.stageId, STAGE_PROPOSAL);
    assert.equal(state.deals.find((d) => d.id === 'deal-nubank-revops')?.stageId, STAGE_NEGOTIATION);
    assert.equal(locDeal.stageId, locStageBefore);

    const second = applySalesPipelineStageMigration(state, { nowIso: '2026-11-10T12:01:00.000Z' });
    assert.equal(second.applied, false);
    assert.equal(second.alreadyUpToDate, true);
    assert.deepEqual(second.stagesAdded, []);
    assert.deepEqual(second.dealsMapped, []);
    assert.deepEqual(second.workflowsUpdated, []);
  });

  it('remapeia negócio com id desconhecido pelo nome antigo da etapa', () => {
    const state = legacyStateFromSeed();
    const deal = state.deals.find((d) => d.id === 'deal-loggi-discovery')!;
    deal.stageId = 'hs-legacy-123';
    const pipe = state.pipelines.find((p) => p.id === ENTERPRISE_SALES_PIPELINE_ID)!;
    pipe.stages = pipe.stages.map((s) =>
      s.id === STAGE_DISCOVERY ? { ...s, id: 'hs-legacy-123', name: 'Prospecção & Descoberta' } : s
    );
    const result = applySalesPipelineStageMigration(state);
    const moved = result.dealsMapped.find((d) => d.dealId === 'deal-loggi-discovery');
    assert.ok(moved);
    assert.equal(moved!.fromStageId, 'hs-legacy-123');
    assert.equal(moved!.toStageId, STAGE_DISCOVERY);
    assert.equal(moved!.toStageName, 'Lead Gerado');
    assert.equal(deal.stageId, STAGE_DISCOVERY);
  });

  it('resolve nomes antigos e novos para os mesmos IDs', () => {
    assert.equal(resolveEnterpriseSalesStageId(STAGE_PROPOSAL), STAGE_PROPOSAL);
    assert.equal(resolveEnterpriseSalesStageId('outro', 'Proposta Comercial Enviada'), STAGE_PROPOSAL);
    assert.equal(resolveEnterpriseSalesStageId('outro', 'Proposta Enviada'), STAGE_PROPOSAL);
    assert.equal(resolveEnterpriseSalesStageId('outro', 'Fechado Ganho (Won)'), STAGE_WON);
    assert.equal(resolveEnterpriseSalesStageId('desconhecido', 'Etapa inventada'), null);
  });

  it('follow-up inscreve em Proposta Enviada e continua em FUP / Final FuP', () => {
    assert.equal(isFollowupEnrollStage(ENTERPRISE_SALES_PIPELINE_ID, STAGE_PROPOSAL), true);
    assert.equal(isFollowupEnrollStage(ENTERPRISE_SALES_PIPELINE_ID, STAGE_FUP), false);
    assert.equal(isFollowupEnrollStage(ENTERPRISE_SALES_PIPELINE_ID, STAGE_FINAL_FUP), false);
    assert.equal(isFollowupEnrollStage(ENTERPRISE_SALES_PIPELINE_ID, STAGE_NEGOTIATION), false);
    assert.equal(isFollowupContinueStage(ENTERPRISE_SALES_PIPELINE_ID, STAGE_PROPOSAL), true);
    assert.equal(isFollowupContinueStage(ENTERPRISE_SALES_PIPELINE_ID, STAGE_FUP), true);
    assert.equal(isFollowupContinueStage(ENTERPRISE_SALES_PIPELINE_ID, STAGE_FINAL_FUP), true);
    assert.equal(isFollowupContinueStage(ENTERPRISE_SALES_PIPELINE_ID, STAGE_NEGOTIATION), false);
    assert.equal(isFollowupEnrollStage('pipeline-locacao-equipamentos', 'stage-loc-simulacao'), true);
    assert.equal(isFollowupEnrollStage('pipeline-cotacoes-compras', 'stage-cot-rfq'), false);
  });
});
