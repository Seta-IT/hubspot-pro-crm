import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPipelineChangePatch,
  filterAssociationChoices,
  firstStageOfPipeline,
  pipelineNameOf,
  stagesForPipeline,
} from '../src/app/lib/deal-record-actions';
import type { Pipeline } from '../src/db/types';

const src = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

function pipe(id: string, name: string, stages: Array<{ id: string; name: string; order: number }>): Pipeline {
  return {
    id,
    name,
    isDefault: id.endsWith('locacao-equipamentos'),
    currency: 'BRL',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    stages: stages.map((s) => ({
      id: s.id,
      pipelineId: id,
      name: s.name,
      order: s.order,
      defaultProbability: 20,
      dealRottingDays: 10,
      isClosed: false,
      isWon: false,
    })),
  };
}

const PIPELINES: Pipeline[] = [
  pipe('pipeline-locacao-equipamentos', 'Pipeline 1: Locação & Serviços', [
    { id: 'stage-loc-levantamento', name: '1. Levantamento Técnico & Viabilidade', order: 1 },
    { id: 'stage-loc-simulacao', name: '2. Proposta & Simulação MRR (ERP)', order: 2 },
  ]),
  pipe('pipe-enterprise-b2b', 'Pipeline 2: Venda de Equipamentos', [
    { id: 'stage-discovery', name: 'Lead Gerado', order: 1 },
    { id: 'stage-sql', name: 'Reunião Agendada', order: 2 },
  ]),
];

describe('Painel do negócio: pipeline, associações e e-mail', () => {
  it('ao trocar o pipeline, a etapa vai para a primeira do funil destino', () => {
    const deal = { pipelineId: 'pipeline-locacao-equipamentos', stageId: 'stage-loc-simulacao' };
    const patch = buildPipelineChangePatch(PIPELINES, deal, 'pipe-enterprise-b2b');
    assert.deepEqual(patch, { pipelineId: 'pipe-enterprise-b2b', stageId: 'stage-discovery' });
    assert.equal(buildPipelineChangePatch(PIPELINES, deal, deal.pipelineId), null);
    assert.equal(buildPipelineChangePatch(PIPELINES, deal, 'pipe-inexistente'), null);
    assert.equal(firstStageOfPipeline(PIPELINES, 'pipeline-locacao-equipamentos')?.id, 'stage-loc-levantamento');
    assert.deepEqual(
      stagesForPipeline(PIPELINES, 'pipe-enterprise-b2b').map((s) => s.id),
      ['stage-discovery', 'stage-sql']
    );
    assert.equal(pipelineNameOf(PIPELINES, 'pipeline-locacao-equipamentos'), 'Pipeline 1: Locação & Serviços');
  });

  it('filtra escolhas de associação por nome, ignorando acento', () => {
    const items = [
      { id: '1', name: 'NEC Brasil' },
      { id: '2', name: 'Dafiti Extrema' },
    ];
    const hits = filterAssociationChoices(items, 'nec', (i) => i.name);
    assert.deepEqual(hits.map((i) => i.id), ['1']);
    assert.equal(filterAssociationChoices(items, 'extrema', (i) => i.name)[0]?.id, '2');
  });

  it('o cabeçalho tem seletor de pipeline e o dropdown de etapa usa só o funil atual', () => {
    const drawer = src('src/app/components/DealRecordDrawer.tsx');
    assert.match(drawer, /data-testid="deal-pipeline-select"/);
    assert.match(drawer, /data-testid="deal-stage-select"/);
    assert.match(drawer, /buildPipelineChangePatch/);
    assert.match(drawer, /savePipeline/);
    assert.match(drawer, /stageOptions\.map/);
    assert.doesNotMatch(drawer, /emptyHint: 'Veja as empresas associadas a este registro\.',\s*addSoon: true/);
    assert.match(drawer, /openAssocPicker\('contacts'\)/);
    assert.match(drawer, /openAssocPicker\('companies'\)/);
    assert.match(drawer, /openAssocPicker\('tickets'\)/);
    assert.match(drawer, /openAssocPicker\('deals'\)/);
    assert.match(drawer, /fetch\('\/api\/tickets'[\s\S]*method: 'POST'/);
    assert.match(drawer, /canEdit && onUpdateDeal/);
    assert.match(drawer, /onSelectPipeline\?\.\(patch\.pipelineId\)/);
  });

  it('o compositor de e-mail do negócio não fica preso na coluna com overflow, e o da proposta fica acima do drawer', () => {
    const drawer = src('src/app/components/DealRecordDrawer.tsx');
    const kanban = src('src/app/components/DealsKanbanTab.tsx');
    const client = src('src/app/components/ClientEmailComposerModal.tsx');
    const composer = src('src/app/components/email/CrmEmailComposerModal.tsx');

    const activitiesOverflow = drawer.indexOf('lg:col-span-6 overflow-y-auto');
    const composerMount = drawer.indexOf('<CrmEmailComposerModal');
    const rightAside = drawer.lastIndexOf('lg:col-span-3 border-l');
    assert.ok(activitiesOverflow > 0 && composerMount > 0);
    assert.ok(composerMount > rightAside, 'o compositor do CRM deve ficar fora da coluna central/direita');
    assert.match(drawer, /fixed inset-0 z-50/);
    assert.match(client, /data-testid="client-email-composer-modal"/);
    assert.match(client, /z-\[80\]/);
    const drawerTag = kanban.indexOf('<DealRecordDrawer');
    const payloadModal = kanban.lastIndexOf('emailModalPayload &&');
    assert.ok(payloadModal > drawerTag, 'o modal Enviar proposta por e-mail deve renderizar depois do drawer');
    assert.match(composer, /crm-mail-empty-to-hint/);
    assert.match(composer, /Associe um contato no painel direito ou digite o endereço/);
  });

  it('tickets usam a API existente e não alteram o PATCH de chamados', () => {
    const drawer = src('src/app/components/DealRecordDrawer.tsx');
    const repo = src('src/db/repository.ts');
    assert.match(drawer, /fetch\('\/api\/tickets'/);
    assert.match(repo, /companyId e dealId ficam fora/);
    const list = repo.slice(repo.indexOf('SERVICE_TICKET_EDITABLE_FIELDS'), repo.indexOf('export function pickEditableTicketFields'));
    assert.doesNotMatch(list, /dealId/);
  });
});
