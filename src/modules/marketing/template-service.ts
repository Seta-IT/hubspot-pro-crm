// ============================================================================
// STI-hub — Fase 3: modelos de campanha com versionamento e fluxo de aprovacao.
//   DRAFT (rascunho) -> IN_REVIEW (em revisao) -> APPROVED (aprovado)
// Toda edicao cria uma NOVA versao (historico imutavel) e volta o modelo para rascunho; a ultima
// versao aprovada continua sendo a unica enviavel ate a nova ser aprovada. Quem aprova precisa
// ser diferente de quem enviou para revisao (quatro olhos).
// ============================================================================
import crypto from 'node:crypto';
import { isMarketingPurpose, type MarketingPurpose } from './marketing-config';
import type { MarketingStore, MarketingTemplate, MarketingTemplateVersion } from './marketing-store';
import { sanitizeTemplateBlocks } from './template-blocks';

export class TemplateWorkflowError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'TemplateWorkflowError';
  }
}

export interface TemplateContent {
  subject: unknown;
  preheader?: unknown;
  blocks: unknown;
}

function cleanContent(input: TemplateContent): { subject: string; preheader: string; blocks: ReturnType<typeof sanitizeTemplateBlocks> } {
  const subject = String(input.subject ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (!subject) throw new TemplateWorkflowError('Informe o assunto do e-mail.');
  if (subject.length > 200) throw new TemplateWorkflowError('Assunto com mais de 200 caracteres.');
  const preheader = String(input.preheader ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  let blocks;
  try {
    blocks = sanitizeTemplateBlocks(input.blocks);
  } catch (err) {
    throw new TemplateWorkflowError((err as Error).message);
  }
  return { subject, preheader, blocks };
}

const norm = (s: string) => s.trim().toLowerCase();

export async function createTemplate(
  store: MarketingStore,
  input: { name: unknown; purpose: unknown } & TemplateContent,
  actor: string,
  now = new Date()
): Promise<{ template: MarketingTemplate; version: MarketingTemplateVersion }> {
  const name = String(input.name ?? '').trim().slice(0, 120);
  if (!name) throw new TemplateWorkflowError('Informe o nome do modelo.');
  if (!isMarketingPurpose(input.purpose)) throw new TemplateWorkflowError('Finalidade (LGPD) inválida.');
  const content = cleanContent(input);
  const iso = now.toISOString();
  const template: MarketingTemplate = {
    id: `mtpl-${crypto.randomUUID()}`,
    name,
    purpose: input.purpose as MarketingPurpose,
    status: 'DRAFT',
    currentVersion: 1,
    approvedVersion: null,
    createdBy: actor,
    updatedBy: actor,
    submittedBy: null,
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    reviewNote: null,
    createdAt: iso,
    updatedAt: iso,
  };
  const version: MarketingTemplateVersion = { templateId: template.id, version: 1, ...content, createdBy: actor, createdAt: iso };
  await store.insertVersion(version);
  await store.saveTemplate(template);
  return { template, version };
}

async function mustGet(store: MarketingStore, id: string): Promise<MarketingTemplate> {
  const t = await store.getTemplate(id);
  if (!t) throw new TemplateWorkflowError('Modelo não encontrado.', 404);
  return t;
}

/** Edicao = nova versao em rascunho. Em revisao nao edita (evita aprovar algo diferente do revisado). */
export async function saveTemplateDraft(
  store: MarketingStore,
  id: string,
  input: TemplateContent & { name?: unknown },
  actor: string,
  now = new Date()
): Promise<{ template: MarketingTemplate; version: MarketingTemplateVersion }> {
  const t = await mustGet(store, id);
  if (t.status === 'IN_REVIEW') throw new TemplateWorkflowError('Modelo em revisão: devolva para rascunho antes de editar.', 409);
  const content = cleanContent(input);
  const iso = now.toISOString();
  const version: MarketingTemplateVersion = { templateId: t.id, version: t.currentVersion + 1, ...content, createdBy: actor, createdAt: iso };
  await store.insertVersion(version);
  const name = input.name !== undefined ? String(input.name).trim().slice(0, 120) : '';
  const next: MarketingTemplate = {
    ...t,
    name: name || t.name,
    status: 'DRAFT',
    currentVersion: version.version,
    updatedBy: actor,
    submittedBy: null,
    submittedAt: null,
    reviewNote: null,
    updatedAt: iso,
  };
  await store.saveTemplate(next);
  return { template: next, version };
}

export async function submitTemplateForReview(store: MarketingStore, id: string, actor: string, now = new Date()): Promise<MarketingTemplate> {
  const t = await mustGet(store, id);
  if (t.status !== 'DRAFT') throw new TemplateWorkflowError('Só rascunhos podem ser enviados para revisão.', 409);
  if (t.approvedVersion === t.currentVersion) throw new TemplateWorkflowError('Esta versão já está aprovada.', 409);
  const next: MarketingTemplate = { ...t, status: 'IN_REVIEW', submittedBy: actor, submittedAt: now.toISOString(), reviewNote: null, updatedBy: actor, updatedAt: now.toISOString() };
  await store.saveTemplate(next);
  return next;
}

export async function approveTemplate(store: MarketingStore, id: string, actor: string, now = new Date()): Promise<MarketingTemplate> {
  const t = await mustGet(store, id);
  if (t.status !== 'IN_REVIEW') throw new TemplateWorkflowError('Só modelos em revisão podem ser aprovados.', 409);
  if (t.submittedBy && norm(t.submittedBy) === norm(actor)) {
    throw new TemplateWorkflowError('A aprovação precisa ser feita por outra pessoa (quem enviou para revisão não aprova).', 403);
  }
  const next: MarketingTemplate = {
    ...t,
    status: 'APPROVED',
    approvedVersion: t.currentVersion,
    approvedBy: actor,
    approvedAt: now.toISOString(),
    updatedBy: actor,
    updatedAt: now.toISOString(),
  };
  await store.saveTemplate(next);
  return next;
}

export async function rejectTemplate(store: MarketingStore, id: string, actor: string, note: unknown, now = new Date()): Promise<MarketingTemplate> {
  const t = await mustGet(store, id);
  if (t.status !== 'IN_REVIEW') throw new TemplateWorkflowError('Só modelos em revisão podem ser devolvidos.', 409);
  const next: MarketingTemplate = {
    ...t,
    status: 'DRAFT',
    reviewNote: String(note ?? '').trim().slice(0, 500) || 'Devolvido para ajustes.',
    submittedBy: null,
    submittedAt: null,
    updatedBy: actor,
    updatedAt: now.toISOString(),
  };
  await store.saveTemplate(next);
  return next;
}

/** Versao enviavel do modelo (a aprovada), ou erro. */
export async function getSendableVersion(store: MarketingStore, id: string): Promise<{ template: MarketingTemplate; version: MarketingTemplateVersion }> {
  const t = await mustGet(store, id);
  if (t.approvedVersion === null) throw new TemplateWorkflowError('Modelo sem versão aprovada: só modelos aprovados podem ser enviados.', 409);
  const v = await store.getVersion(t.id, t.approvedVersion);
  if (!v) throw new TemplateWorkflowError('Versão aprovada não encontrada.', 409);
  return { template: t, version: v };
}
