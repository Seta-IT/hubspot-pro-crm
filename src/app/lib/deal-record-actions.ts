// STI-hub — helpers da ficha do Negócio: troca de pipeline e busca de associações.
import type { Pipeline, PipelineStage } from '../../db/types';

export type PipelineRef = Pick<Pipeline, 'id' | 'name' | 'stages'>;

export function sortPipelineStages(stages: PipelineStage[]): PipelineStage[] {
  return stages.slice().sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'pt-BR'));
}

export function stagesForPipeline(
  pipelines: PipelineRef[],
  pipelineId: string | null | undefined
): PipelineStage[] {
  if (!pipelineId) return [];
  const pipe = pipelines.find((p) => p.id === pipelineId);
  return sortPipelineStages(pipe?.stages || []);
}

export function firstStageOfPipeline(
  pipelines: PipelineRef[],
  pipelineId: string | null | undefined
): PipelineStage | null {
  return stagesForPipeline(pipelines, pipelineId)[0] || null;
}

export function pipelineNameOf(
  pipelines: PipelineRef[],
  pipelineId: string | null | undefined,
  fallback?: string | null
): string {
  const name = pipelines.find((p) => p.id === pipelineId)?.name;
  return (name && name.trim()) || (fallback || '');
}

/**
 * Ao trocar o pipeline, a etapa vai para a primeira etapa do funil destino.
 * Retorna null se o pipeline não mudou ou se o destino não tem etapas.
 */
export function buildPipelineChangePatch(
  pipelines: PipelineRef[],
  deal: { pipelineId: string; stageId: string },
  nextPipelineId: string
): { pipelineId: string; stageId: string } | null {
  const nextId = String(nextPipelineId || '').trim();
  if (!nextId || nextId === deal.pipelineId) return null;
  const first = firstStageOfPipeline(pipelines, nextId);
  if (!first) return null;
  return { pipelineId: nextId, stageId: first.id };
}

export function normalizeAssocQuery(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function filterAssociationChoices<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
  limit = 20
): T[] {
  const q = normalizeAssocQuery(query);
  const filtered = q
    ? items.filter((item) => normalizeAssocQuery(getText(item)).includes(q))
    : items;
  return filtered.slice(0, limit);
}
