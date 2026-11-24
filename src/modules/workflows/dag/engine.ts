// ============================================================================
// STI-hub — Fase 4: motor duravel das automacoes (DAG).
//
//  - WORKFLOWS_LIVE desligado (padrao): nenhum evento e gravado e o cron nao executa nada; o
//    construtor funciona e a SIMULACAO (contato de exemplo, sem efeito) continua disponivel.
//  - Ativar exige grafo valido (sem ciclos, sem nos soltos) e simulacao da versao atual.
//  - Execucao: cron /api/cron/workflows com a MESMA trava global (workflows:run). Cada no e
//    reservado (run_id, node_id) ANTES de executar: nunca executa duas vezes. Execucao que caiu no
//    meio de uma acao vira "para revisar" com tarefa (sem repetir sozinha).
//  - E-mail: SO pela fila da Fase 3 (modelo aprovado, LGPD por finalidade, MARKETING_LIVE_SEND,
//    allowlist, dominio); cadencias pela Fase 2. Nenhuma acao toca ERP/Chamados (sem fatura/NF).
// ============================================================================
import crypto from 'node:crypto';
import type { CrmRepository } from '../../../db/repository';
import type { Contact } from '../../../db/types';
import { getDefaultLockStore, newLockOwnerId, type DistributedLockStore } from '../../../db/distributed-lock';
import { SequenceService } from '../../sequences/sequence-service';
import { checkMarketingEligibility, enqueueCampaign, marketingPreflight, type MarketingDeps } from '../../marketing/campaign-dispatcher';
import { isMarketingLiveSendEnabled, resolveMarketingTestRecipients } from '../../marketing/marketing-config';
import { getSendableVersion } from '../../marketing/template-service';
import { WF_ACTION_LABELS, WF_TRIGGER_LABELS, type WfTriggerType } from './catalog';
import {
  findWorkflowReferenceCycle,
  reactivationTargets,
  validateWorkflowGraph,
  type WfCondition,
  type WfGraph,
  type WfNode,
  type WfVariant,
} from './graph';
import type { WfDefinition, WfEvent, WfRun, WfStep, WorkflowStore } from './store';

export const WORKFLOW_CRON_PATH = '/api/cron/workflows';
export const WORKFLOW_RUN_LOCK_KEY = 'workflows:run';
export const WORKFLOW_RUN_LOCK_TTL_MS = 10 * 60 * 1000;
export const WORKFLOW_MAX_DEPTH = 3;
export const WORKFLOW_WAIT_RECHECK_MS = 15 * 60 * 1000;
export const WORKFLOW_RUN_BUDGET_MS = 240 * 1000;
export const WORKFLOW_REVIEW_QUEUE = 'Automações';

const TRUE_RE = /^(1|true|on|yes|sim)$/i;
export function isWorkflowsLiveEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return TRUE_RE.test(String(env.WORKFLOWS_LIVE || '').trim());
}
/** Homologacao: so contatos com estes e-mails entram em fluxos (vazio = todos). */
export function resolveWorkflowTestRecipients(env: NodeJS.ProcessEnv = process.env): Set<string> | null {
  const list = String(env.WORKFLOWS_TEST_RECIPIENTS || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? new Set(list) : null;
}
export function resolveWebhookAllowedHosts(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    String(env.WORKFLOWS_WEBHOOK_ALLOWED_HOSTS || '')
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((h) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h))
  );
}
function posInt(raw: string | undefined, fallback: number, max: number): number {
  const n = Number(String(raw ?? '').trim());
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : fallback;
}

export type WebhookFetch = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;

export interface WorkflowDeps {
  store: WorkflowStore;
  env?: NodeJS.ProcessEnv;
  lock?: DistributedLockStore;
  now?: () => Date;
  lockClock?: () => number;
  /** Fase 3 (e-mail de marketing). Sem isto, "Enviar e-mail" fica bloqueado. */
  marketing?: MarketingDeps | null;
  webhookFetch?: WebhookFetch;
  /** Grava o estado do CRM depois de cada acao com efeito (falha => para, sem marcar como feita). */
  persist?: () => Promise<void>;
  reloadState?: () => Promise<void>;
}

// ----------------------------------------------------------------------------
// Condicoes e divisao deterministica
// ----------------------------------------------------------------------------
export function contactTags(c: Contact): string[] {
  const t = (c.customProperties || {}).tags;
  return Array.isArray(t) ? t.map((x) => String(x)) : [];
}

function readField(c: Contact, field: string): unknown {
  if (field === 'tags') return contactTags(c).join(',');
  if (field.startsWith('custom.')) return (c.customProperties || {})[field.slice(7)];
  return (c as unknown as Record<string, unknown>)[field];
}

export function evaluateWfCondition(c: Contact, cond: WfCondition): boolean {
  const raw = readField(c, cond.field);
  const target = cond.value;
  const s = (v: unknown) => String(v ?? '').trim().toLowerCase();
  switch (cond.operator) {
    case 'IS_EMPTY':
      return raw === null || raw === undefined || s(raw) === '';
    case 'IS_NOT_EMPTY':
      return !(raw === null || raw === undefined || s(raw) === '');
    case 'EQUALS':
      return s(raw) === s(target);
    case 'NOT_EQUALS':
      return s(raw) !== s(target);
    case 'CONTAINS':
      return s(raw).includes(s(target));
    case 'GREATER_THAN':
      return Number(raw ?? 0) > Number(target ?? 0);
    case 'LESS_THAN':
      return Number(raw ?? 0) < Number(target ?? 0);
    case 'HAS_TAG':
      return contactTags(c).map((t) => t.toLowerCase()).includes(s(target));
    default:
      return false;
  }
}

/** Mesmo contato + mesmo no => sempre o mesmo caminho (sorteio estavel, auditavel). */
export function pickVariant(seed: string, variants: WfVariant[]): WfVariant {
  const h = crypto.createHash('sha256').update(seed).digest();
  const bucket = h.readUInt32BE(0) % 100;
  let acc = 0;
  for (const v of variants) {
    acc += Number(v.percent);
    if (bucket < acc) return v;
  }
  return variants[variants.length - 1];
}

const condText = (c: WfCondition | undefined) => (c ? `${c.field} ${c.operator}${c.value !== undefined && c.value !== null ? ` ${c.value}` : ''}` : '');

function nodeLabel(n: WfNode): string {
  return n.label || (n.kind === 'DELAY' ? 'Atraso' : WF_ACTION_LABELS[n.action!] || n.id);
}

// ----------------------------------------------------------------------------
// Definicoes: criar, salvar rascunho, simular, ativar, pausar
// ----------------------------------------------------------------------------
export class WorkflowError extends Error {
  constructor(message: string, public readonly status = 400, public readonly details?: unknown) {
    super(message);
    this.name = 'WorkflowError';
  }
}

export function normalizeGraph(raw: unknown): WfGraph {
  const g = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const nodes = Array.isArray(g.nodes) ? g.nodes.slice(0, 200) : [];
  return {
    trigger: { type: g.trigger?.type, config: g.trigger?.config && typeof g.trigger.config === 'object' ? g.trigger.config : {} },
    startNodeId: g.startNodeId ? String(g.startNodeId) : null,
    nodes: nodes.map((n: any) => ({
      id: String(n?.id || ''),
      kind: n?.kind === 'DELAY' ? 'DELAY' : 'ACTION',
      ...(n?.kind === 'DELAY' ? {} : { action: n?.action }),
      label: n?.label ? String(n.label).slice(0, 80) : undefined,
      config: n?.config && typeof n.config === 'object' ? n.config : {},
      next: n?.next ? String(n.next) : null,
      branches: n?.branches && typeof n.branches === 'object' ? Object.fromEntries(Object.entries(n.branches).map(([k, v]) => [k, v ? String(v) : null])) : undefined,
      x: Number.isFinite(n?.x) ? Number(n.x) : undefined,
      y: Number.isFinite(n?.y) ? Number(n.y) : undefined,
    })),
    reentry: {
      mode: ['NEVER', 'AFTER_COMPLETION', 'ALWAYS'].includes(g.reentry?.mode) ? g.reentry.mode : 'NEVER',
      cooldownDays: Number(g.reentry?.cooldownDays ?? 0),
    },
  };
}

export async function createWorkflowDefinition(store: WorkflowStore, input: { name: unknown; description?: unknown; graph: unknown }, actor: string, now = new Date()): Promise<WfDefinition> {
  const name = String(input.name ?? '').trim().slice(0, 120);
  if (!name) throw new WorkflowError('Informe o nome do fluxo.');
  const graph = normalizeGraph(input.graph);
  const iso = now.toISOString();
  const def: WfDefinition = {
    id: `wfd-${crypto.randomUUID()}`,
    name,
    description: String(input.description ?? '').slice(0, 500),
    status: 'DRAFT',
    version: 1,
    activeVersion: null,
    graph,
    lastSimulation: null,
    createdBy: actor,
    updatedBy: actor,
    activatedBy: null,
    activatedAt: null,
    createdAt: iso,
    updatedAt: iso,
  };
  await store.insertVersion({ workflowId: def.id, version: 1, graph, createdBy: actor, createdAt: iso });
  await store.saveDefinition(def);
  return def;
}

/** Nova versao do grafo. Fluxo ativo continua rodando a versao ativa ate reativar a nova. */
export async function saveWorkflowDraft(store: WorkflowStore, id: string, input: { name?: unknown; description?: unknown; graph: unknown }, actor: string, now = new Date()): Promise<WfDefinition> {
  const d = await store.getDefinition(id);
  if (!d) throw new WorkflowError('Fluxo não encontrado.', 404);
  const graph = normalizeGraph(input.graph);
  const iso = now.toISOString();
  const version = d.version + 1;
  await store.insertVersion({ workflowId: d.id, version, graph, createdBy: actor, createdAt: iso });
  const next: WfDefinition = {
    ...d,
    name: input.name !== undefined && String(input.name).trim() ? String(input.name).trim().slice(0, 120) : d.name,
    description: input.description !== undefined ? String(input.description).slice(0, 500) : d.description,
    version,
    graph,
    updatedBy: actor,
    updatedAt: iso,
  };
  await store.saveDefinition(next);
  return next;
}

export async function activateWorkflow(store: WorkflowStore, id: string, actor: string, now = new Date()): Promise<WfDefinition> {
  const d = await store.getDefinition(id);
  if (!d) throw new WorkflowError('Fluxo não encontrado.', 404);
  const v = validateWorkflowGraph(d.graph);
  if (!v.ok) throw new WorkflowError('O fluxo tem erros e não pode ser ativado.', 409, v);
  if (!d.lastSimulation || d.lastSimulation.version !== d.version) {
    throw new WorkflowError('Simule esta versão com um contato de exemplo antes de ativar.', 409);
  }
  // Ciclo entre fluxos pela acao de reativacao.
  const edges = new Map<string, string[]>();
  for (const other of await store.listDefinitions()) {
    if (other.id === d.id) continue;
    if (other.status === 'ACTIVE' && other.activeVersion !== null) {
      const ov = await store.getVersion(other.id, other.activeVersion);
      edges.set(other.id, reactivationTargets(ov?.graph || other.graph));
    }
  }
  edges.set(d.id, reactivationTargets(d.graph));
  for (const t of edges.get(d.id) || []) {
    if (t === d.id) throw new WorkflowError('Um fluxo não pode iniciar a si mesmo como reativação.', 409);
    const target = await store.getDefinition(t);
    if (!target) throw new WorkflowError('O fluxo de reativação escolhido não existe.', 409);
  }
  const cycle = findWorkflowReferenceCycle(edges, d.id);
  if (cycle) throw new WorkflowError(`Ciclo entre fluxos pela reativação: ${cycle.join(' -> ')}.`, 409, { cycle });
  const next: WfDefinition = { ...d, status: 'ACTIVE', activeVersion: d.version, activatedBy: actor, activatedAt: now.toISOString(), updatedBy: actor, updatedAt: now.toISOString() };
  await store.saveDefinition(next);
  return next;
}

export async function pauseWorkflow(store: WorkflowStore, id: string, actor: string, now = new Date()): Promise<WfDefinition> {
  const d = await store.getDefinition(id);
  if (!d) throw new WorkflowError('Fluxo não encontrado.', 404);
  const next: WfDefinition = { ...d, status: 'PAUSED', updatedBy: actor, updatedAt: now.toISOString() };
  await store.saveDefinition(next);
  return next;
}

// ----------------------------------------------------------------------------
// Simulacao (sem efeito): percorre o grafo com o contato de exemplo
// ----------------------------------------------------------------------------
export interface SimulationStep {
  nodeId: string;
  label: string;
  outcome: 'EXECUTARIA' | 'BLOQUEADO' | 'ESPERA' | 'DESVIO' | 'FIM';
  message: string;
  port: string | null;
  at: string;
}
export interface SimulationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  contactId: string;
  steps: SimulationStep[];
  endedBy: 'FIM_DO_FLUXO' | 'ENCERRAR' | 'ERRO';
  liveEnabled: boolean;
}

async function describeEmail(repo: CrmRepository, deps: WorkflowDeps, n: WfNode, contact: Contact): Promise<{ blocked: boolean; message: string }> {
  const env = deps.env || process.env;
  const m = deps.marketing;
  if (!m) return { blocked: true, message: 'Envio de campanhas indisponível.' };
  let purposeOk: string | null = null;
  try {
    const { template, version } = await getSendableVersion(m.store, String(n.config.templateId || ''));
    const elig = checkMarketingEligibility(repo, contact, template.purpose, resolveMarketingTestRecipients(m.env || env));
    if (!elig.allowed) return { blocked: true, message: `Bloqueado pela LGPD/entregabilidade: ${elig.reason}` };
    purposeOk = `modelo v${version.version}`;
  } catch (err) {
    return { blocked: true, message: (err as Error).message };
  }
  if (!isMarketingLiveSendEnabled(m.env || env)) return { blocked: true, message: `Elegível (${purposeOk}), mas o envio real de marketing está desligado (MARKETING_LIVE_SEND).` };
  if (!repo.getMarketingCampaignById(String(n.config.campaignId || ''))) return { blocked: true, message: 'Campanha não encontrada.' };
  return { blocked: false, message: `Entraria na fila da campanha (${purposeOk}); envio pela fila de marketing com limite de taxa.` };
}

export async function simulateWorkflow(repo: CrmRepository, deps: WorkflowDeps, graph: WfGraph, contactId: string): Promise<SimulationResult> {
  const env = deps.env || process.env;
  const v = validateWorkflowGraph(graph);
  const contact = repo.getContactById(contactId);
  const res: SimulationResult = { ok: v.ok && Boolean(contact), errors: [...v.errors], warnings: [...v.warnings], contactId, steps: [], endedBy: 'FIM_DO_FLUXO', liveEnabled: isWorkflowsLiveEnabled(env) };
  if (!contact) {
    res.errors.push('Contato de exemplo não encontrado.');
    res.endedBy = 'ERRO';
    return res;
  }
  if (!v.ok) {
    res.endedBy = 'ERRO';
    return res;
  }
  // Copia: a simulacao aplica tags/pontos/propriedades so na copia, para as condicoes seguintes.
  const c: Contact = JSON.parse(JSON.stringify(contact));
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  let t = (deps.now || (() => new Date()))().getTime();
  let cur = graph.startNodeId;
  const push = (n: WfNode, outcome: SimulationStep['outcome'], message: string, port: string | null) =>
    res.steps.push({ nodeId: n.id, label: nodeLabel(n), outcome, message, port, at: new Date(t).toISOString() });
  for (let i = 0; cur && i < 200; i++) {
    const n = byId.get(cur)!;
    let port = 'next';
    if (n.kind === 'DELAY') {
      const min = Number(n.config.minutes);
      t += min * 60000;
      push(n, 'ESPERA', `Aguardaria ${min} minuto(s).`, port);
    } else {
      const cfg = n.config;
      switch (n.action) {
        case 'IF_ELSE': {
          const ok = evaluateWfCondition(c, cfg.condition as WfCondition);
          port = ok ? 'yes' : 'no';
          push(n, 'DESVIO', `Condição "${condText(cfg.condition as WfCondition)}": ${ok ? 'verdadeira (sim)' : 'falsa (não)'}.`, port);
          break;
        }
        case 'WAIT_CONDITION': {
          const ok = evaluateWfCondition(c, cfg.condition as WfCondition);
          if (ok) {
            port = 'met';
            push(n, 'DESVIO', `Condição já atendida: segue por "atendida".`, port);
          } else {
            t += Number(cfg.timeoutMinutes) * 60000;
            port = 'timeout';
            push(n, 'ESPERA', `Aguardaria até ${Number(cfg.timeoutMinutes)} minuto(s) por "${condText(cfg.condition as WfCondition)}"; sem mudança, segue por "prazo esgotado".`, port);
          }
          break;
        }
        case 'PERCENT_SPLIT':
        case 'AB_TEST': {
          const vs = cfg.variants as WfVariant[];
          const pick = pickVariant(`${contactId}:${n.id}`, vs);
          port = pick.id;
          push(n, 'DESVIO', `${n.action === 'AB_TEST' ? 'Teste A/B' : 'Divisão'}: este contato cai em "${pick.label}" (${pick.percent}%).`, port);
          break;
        }
        case 'END_FLOW':
          push(n, 'FIM', 'Encerraria o fluxo.', null);
          res.endedBy = 'ENCERRAR';
          cur = null;
          continue;
        case 'SEND_EMAIL': {
          const d = await describeEmail(repo, deps, n, c);
          push(n, d.blocked ? 'BLOQUEADO' : 'EXECUTARIA', d.message, port);
          break;
        }
        case 'ENROLL_SEQUENCE':
          push(n, repo.getSequenceById(String(cfg.sequenceId)) ? 'EXECUTARIA' : 'BLOQUEADO', repo.getSequenceById(String(cfg.sequenceId)) ? `Inscreveria na cadência "${repo.getSequenceById(String(cfg.sequenceId))!.name}" (regras e envio da Fase 2).` : 'Cadência não encontrada.', port);
          break;
        case 'UNENROLL_SEQUENCE':
          push(n, 'EXECUTARIA', `Removeria da cadência ${cfg.sequenceId} (sem descadastrar do marketing).`, port);
          break;
        case 'TAG': {
          const tags = new Set(contactTags(c));
          if (cfg.mode === 'ADD') tags.add(String(cfg.tag));
          else tags.delete(String(cfg.tag));
          c.customProperties = { ...(c.customProperties || {}), tags: [...tags] };
          push(n, 'EXECUTARIA', `${cfg.mode === 'ADD' ? 'Adicionaria' : 'Removeria'} a tag "${cfg.tag}".`, port);
          break;
        }
        case 'CHANGE_OWNER':
          c.ownerId = String(cfg.ownerId);
          push(n, 'EXECUTARIA', `Alteraria o proprietário para ${cfg.ownerName || cfg.ownerId}.`, port);
          break;
        case 'UPDATE_PROPERTY': {
          const f = String(cfg.field);
          if (f.startsWith('custom.')) c.customProperties = { ...(c.customProperties || {}), [f.slice(7)]: cfg.value };
          else (c as unknown as Record<string, unknown>)[f] = cfg.value;
          push(n, 'EXECUTARIA', `Atualizaria ${f} para "${String(cfg.value ?? '')}".`, port);
          break;
        }
        case 'CREATE_TASK':
          push(n, 'EXECUTARIA', `Criaria a tarefa "${cfg.title}" (prazo ${Number(cfg.dueInDays ?? 1)} dia(s)).`, port);
          break;
        case 'CREATE_DEAL':
          push(n, 'EXECUTARIA', `Criaria a oportunidade "${cfg.title}" no CRM (sem fatura/NF).`, port);
          break;
        case 'NOTIFY_SELLER':
          push(n, 'EXECUTARIA', `Notificaria o vendedor: "${cfg.message}".`, port);
          break;
        case 'SEND_WEBHOOK': {
          let host = '';
          try {
            host = new URL(String(cfg.url)).hostname.toLowerCase();
          } catch {
            host = '';
          }
          const allowed = resolveWebhookAllowedHosts(env).has(host);
          push(n, allowed ? 'EXECUTARIA' : 'BLOQUEADO', allowed ? `Chamaria o webhook em ${host}.` : `Host ${host || '(inválido)'} fora de WORKFLOWS_WEBHOOK_ALLOWED_HOSTS.`, port);
          break;
        }
        case 'APPLY_LEAD_SCORE': {
          const before = Number(c.leadScore || 0);
          c.leadScore = Math.max(0, Math.min(100, before + Number(cfg.points)));
          push(n, 'EXECUTARIA', `Lead score de ${before} para ${c.leadScore}.`, port);
          break;
        }
        case 'START_REACTIVATION': {
          const el = reactivationEligibility(repo, c, cfg, t);
          push(n, el.ok ? 'EXECUTARIA' : 'BLOQUEADO', el.ok ? `Iniciaria o fluxo de reativação ${cfg.workflowId}.` : el.reason, port);
          break;
        }
        default:
          push(n, 'BLOQUEADO', 'Ação desconhecida.', port);
      }
    }
    const nn = byId.get(cur!)!;
    cur = nn.kind === 'DELAY' || !['IF_ELSE', 'WAIT_CONDITION', 'PERCENT_SPLIT', 'AB_TEST'].includes(nn.action!) ? nn.next || null : nn.branches?.[port] || null;
  }
  return res;
}

export async function recordSimulation(store: WorkflowStore, id: string, result: SimulationResult, now = new Date()): Promise<WfDefinition> {
  const d = await store.getDefinition(id);
  if (!d) throw new WorkflowError('Fluxo não encontrado.', 404);
  const next: WfDefinition = { ...d, lastSimulation: { version: d.version, contactId: result.contactId, at: now.toISOString(), ok: result.ok } };
  if (!result.ok) next.lastSimulation = null;
  await store.saveDefinition(next);
  return next;
}

function reactivationEligibility(repo: CrmRepository, c: Contact, cfg: Record<string, unknown>, nowMs: number): { ok: boolean; reason: string } {
  const can = repo.canSendMarketingEmailToContact(c.id);
  if (!can.allowed) return { ok: false, reason: `Não elegível para reativação: ${can.reason}` };
  const days = Number(cfg.minInactiveDays ?? 30);
  const last = c.lastActivityAt ? Date.parse(c.lastActivityAt) : NaN;
  if (Number.isFinite(last) && nowMs - last < days * 86400000) return { ok: false, reason: `Não elegível: teve atividade nos últimos ${days} dia(s).` };
  return { ok: true, reason: '' };
}

// ----------------------------------------------------------------------------
// Eventos (gatilhos)
// ----------------------------------------------------------------------------
export async function emitWorkflowEvent(
  deps: Pick<WorkflowDeps, 'store' | 'env' | 'now'>,
  input: { type: WfTriggerType; contactId: string; context?: Record<string, unknown>; eventId?: string; depth?: number; targetWorkflowId?: string | null }
): Promise<boolean> {
  if (!isWorkflowsLiveEnabled(deps.env || process.env)) return false;
  if (!input.contactId) return false;
  const at = (deps.now || (() => new Date()))().toISOString();
  const id = (input.eventId || `${input.type}:${input.contactId}:${crypto.randomUUID()}`).slice(0, 200);
  return deps.store.recordEvent({
    id,
    type: input.type,
    contactId: input.contactId,
    context: input.context || {},
    at,
    status: 'PENDING',
    processedAt: null,
    depth: Math.max(0, Math.floor(input.depth || 0)),
    targetWorkflowId: input.targetWorkflowId || null,
  });
}

function triggerMatches(def: WfDefinition, graph: WfGraph, ev: WfEvent): boolean {
  if (ev.targetWorkflowId) return ev.targetWorkflowId === def.id;
  if (graph.trigger.type !== ev.type) return false;
  const cfg = graph.trigger.config || {};
  const ctx = ev.context || {};
  const eq = (k: string, ck = k) => !cfg[k] || String(cfg[k]) === String(ctx[ck] ?? '');
  switch (ev.type) {
    case 'FORM_SUBMITTED':
      return eq('formId');
    case 'PIPELINE_STAGE_CHANGED':
      return eq('stageId', 'toStageId') && eq('pipelineId');
    case 'TAG_CHANGED':
      return eq('tag') && eq('mode');
    case 'CUSTOM_EVENT':
      return eq('eventName');
    case 'WEBHOOK_RECEIVED':
      return eq('source');
    case 'EMAIL_DELIVERED':
    case 'EMAIL_OPENED':
    case 'LINK_CLICKED':
      return eq('campaignId');
    default:
      return true;
  }
}

// ----------------------------------------------------------------------------
// Execucao (cron)
// ----------------------------------------------------------------------------
export interface WorkflowTickResult {
  mode: 'LIVE' | 'SIMULATION';
  skipped: 'LIVE_DISABLED' | 'RUN_LOCK_UNAVAILABLE' | 'RUN_LOCKED_ELSEWHERE' | 'STATE_RELOAD_FAILED' | null;
  eventsProcessed: number;
  runsStarted: number;
  runsSkippedReentry: number;
  stepsExecuted: number;
  runsCompleted: number;
  runsWaiting: number;
  runsNeedingReview: number;
  runsFailed: number;
  stoppedReason: string | null;
}

export async function runWorkflowsTick(repo: CrmRepository, deps: WorkflowDeps): Promise<WorkflowTickResult> {
  const res: WorkflowTickResult = {
    mode: 'SIMULATION', skipped: null, eventsProcessed: 0, runsStarted: 0, runsSkippedReentry: 0, stepsExecuted: 0,
    runsCompleted: 0, runsWaiting: 0, runsNeedingReview: 0, runsFailed: 0, stoppedReason: null,
  };
  const env = deps.env || process.env;
  if (!isWorkflowsLiveEnabled(env)) {
    res.skipped = 'LIVE_DISABLED';
    return res;
  }
  res.mode = 'LIVE';
  const lock = deps.lock || getDefaultLockStore();
  const owner = newLockOwnerId('wf');
  let got = false;
  try {
    got = await lock.acquire(WORKFLOW_RUN_LOCK_KEY, owner, WORKFLOW_RUN_LOCK_TTL_MS);
  } catch {
    res.skipped = 'RUN_LOCK_UNAVAILABLE';
    return res;
  }
  if (!got) {
    res.skipped = 'RUN_LOCKED_ELSEWHERE';
    return res;
  }
  try {
    if (deps.reloadState) {
      try {
        await deps.reloadState();
      } catch {
        res.skipped = 'STATE_RELOAD_FAILED';
        return res;
      }
    }
    const started = Date.now();
    await scheduleTimeTriggers(repo, deps);
    await ingestEvents(repo, deps, res);
    const maxRuns = posInt(env.WORKFLOWS_MAX_RUNS_PER_TICK, 200, 2000);
    const due = await deps.store.listDueRuns((deps.now || (() => new Date()))().toISOString(), maxRuns);
    for (const run of due) {
      if (Date.now() - started > WORKFLOW_RUN_BUDGET_MS) {
        res.stoppedReason = 'RUN_TIME_BUDGET';
        break;
      }
      const stop = await advanceRun(repo, deps, run, res);
      if (stop) {
        res.stoppedReason = stop;
        break;
      }
    }
    return res;
  } finally {
    await lock.release(WORKFLOW_RUN_LOCK_KEY, owner).catch(() => undefined);
  }
}

async function activeDefinitions(store: WorkflowStore): Promise<Array<{ def: WfDefinition; graph: WfGraph }>> {
  const out: Array<{ def: WfDefinition; graph: WfGraph }> = [];
  for (const def of await store.listDefinitions()) {
    if (def.status !== 'ACTIVE' || def.activeVersion === null) continue;
    const v = await store.getVersion(def.id, def.activeVersion);
    if (v) out.push({ def, graph: v.graph });
  }
  return out;
}

async function scheduleTimeTriggers(repo: CrmRepository, deps: WorkflowDeps): Promise<void> {
  const nowMs = (deps.now || (() => new Date()))().getTime();
  for (const { def, graph } of await activeDefinitions(deps.store)) {
    const cfg = graph.trigger.config || {};
    if (graph.trigger.type === 'SPECIFIC_DATE') {
      const raw = String(cfg.at || '');
      const at = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}-03:00`);
      if (!Number.isFinite(at) || nowMs < at) continue;
      const seg = repo.listMarketingSegments().find((s) => s.id === String(cfg.segmentId || ''));
      for (const contactId of (seg?.matchedContactIds || []).slice(0, 2000)) {
        await emitWorkflowEvent(deps, { type: 'SPECIFIC_DATE', contactId, eventId: `date:${def.id}:${def.activeVersion}:${contactId}`, targetWorkflowId: def.id });
      }
    } else if (graph.trigger.type === 'NO_ENGAGEMENT_PERIOD') {
      const days = Number(cfg.days || 30);
      let n = 0;
      for (const c of repo.listContacts()) {
        if (n >= 500) break;
        const last = c.lastActivityAt ? Date.parse(c.lastActivityAt) : NaN;
        if (!Number.isFinite(last) || nowMs - last < days * 86400000) continue;
        if (await emitWorkflowEvent(deps, { type: 'NO_ENGAGEMENT_PERIOD', contactId: c.id, eventId: `noeng:${def.id}:${c.id}:${c.lastActivityAt}`, targetWorkflowId: def.id })) n++;
      }
    }
  }
}

async function ingestEvents(repo: CrmRepository, deps: WorkflowDeps, res: WorkflowTickResult): Promise<void> {
  const env = deps.env || process.env;
  const nowIso = (deps.now || (() => new Date()))().toISOString();
  const nowMs = Date.parse(nowIso);
  const allow = resolveWorkflowTestRecipients(env);
  const defs = await activeDefinitions(deps.store);
  const events = await deps.store.listPendingEvents(posInt(env.WORKFLOWS_MAX_EVENTS_PER_TICK, 500, 5000));
  for (const ev of events) {
    const contact = repo.getContactById(ev.contactId);
    if (contact && ev.depth <= WORKFLOW_MAX_DEPTH && (!allow || allow.has(String(contact.email || '').toLowerCase()))) {
      for (const { def, graph } of defs) {
        if (!triggerMatches(def, graph, ev)) continue;
        const prior = await deps.store.listRunsFor(def.id, contact.id);
        if (prior.some((r) => r.status === 'ACTIVE' || r.status === 'WAITING' || r.status === 'NEEDS_REVIEW')) {
          res.runsSkippedReentry++;
          continue;
        }
        const last = prior[0];
        if (last) {
          const mode = graph.reentry.mode;
          const cooldownOk = nowMs - Date.parse(last.startedAt) >= graph.reentry.cooldownDays * 86400000;
          const completedOk = mode !== 'AFTER_COMPLETION' || last.status === 'COMPLETED' || last.status === 'EXITED';
          if (mode === 'NEVER' || !cooldownOk || !completedOk) {
            res.runsSkippedReentry++;
            continue;
          }
        }
        const run: WfRun = {
          id: `wfr-${crypto.randomUUID()}`,
          workflowId: def.id,
          workflowName: def.name,
          version: def.activeVersion!,
          contactId: contact.id,
          status: 'ACTIVE',
          currentNodeId: graph.startNodeId,
          wakeAt: nowIso,
          waitStartedAt: null,
          triggerEventId: ev.id,
          triggerType: graph.trigger.type,
          depth: ev.depth,
          variants: {},
          lastError: null,
          startedAt: nowIso,
          updatedAt: nowIso,
          completedAt: null,
        };
        if (await deps.store.createRun(run)) res.runsStarted++;
      }
    }
    await deps.store.markEventProcessed(ev.id, nowIso);
    res.eventsProcessed++;
  }
}

async function createReviewTask(repo: CrmRepository, run: WfRun, nodeName: string, nowIso: string): Promise<string | null> {
  try {
    const contact = repo.getContactById(run.contactId);
    return repo.createTask({
      title: `Conferir automação "${run.workflowName}" para ${contact?.email || run.contactId}`,
      notes: `A execução caiu no meio da ação "${nodeName}" e pode ou não ter sido concluída. Confira e decida em Automações > Histórico (continuar ou encerrar). O sistema não repete a ação sozinho.`,
      type: 'TODO',
      priority: 'HIGH',
      status: 'NOT_STARTED',
      queueName: WORKFLOW_REVIEW_QUEUE,
      dueDate: nowIso.slice(0, 10),
      dueTime: '10:00',
      assignedTo: contact?.ownerName || 'Marcelo Lopes Mira',
      contactId: contact?.id ?? null,
      companyId: contact?.companyId ?? null,
    }).id;
  } catch {
    return null;
  }
}

const PURE_ACTIONS = new Set(['IF_ELSE', 'PERCENT_SPLIT', 'AB_TEST', 'END_FLOW']);

/** Avanca uma execucao ate esperar, terminar ou falhar. Retorna motivo para parar o tick (ou null). */
async function advanceRun(repo: CrmRepository, deps: WorkflowDeps, run0: WfRun, res: WorkflowTickResult): Promise<string | null> {
  const env = deps.env || process.env;
  const store = deps.store;
  const nowFn = deps.now || (() => new Date());
  const version = await store.getVersion(run0.workflowId, run0.version);
  let run = { ...run0 };
  const finish = async (patch: Partial<WfRun>) => {
    run = { ...run, ...patch, updatedAt: nowFn().toISOString() };
    await store.updateRun(run.id, { ...patch, updatedAt: run.updatedAt });
  };
  if (!version) {
    await finish({ status: 'FAILED', lastError: 'Versão do fluxo não encontrada.', completedAt: nowFn().toISOString() });
    res.runsFailed++;
    return null;
  }
  const def = await store.getDefinition(run.workflowId);
  if (!def || def.status === 'PAUSED') {
    // Pausado: a execucao espera (nao perde a posicao); volta a andar quando reativar.
    await finish({ wakeAt: new Date(nowFn().getTime() + WORKFLOW_WAIT_RECHECK_MS).toISOString() });
    return null;
  }
  const byId = new Map(version.graph.nodes.map((n) => [n.id, n]));
  const maxSteps = posInt(env.WORKFLOWS_MAX_STEPS_PER_RUN, 25, 100);
  const steps = await store.listSteps(run.id);
  let seq = steps.length;

  for (let i = 0; i < maxSteps; i++) {
    const nowIso = nowFn().toISOString();
    if (!run.currentNodeId) {
      await finish({ status: 'COMPLETED', completedAt: nowIso, currentNodeId: null });
      res.runsCompleted++;
      return null;
    }
    const contact = repo.getContactById(run.contactId);
    if (!contact) {
      await finish({ status: 'EXITED', lastError: 'Contato removido.', completedAt: nowIso });
      return null;
    }
    const node = byId.get(run.currentNodeId);
    if (!node) {
      await finish({ status: 'FAILED', lastError: `Nó ${run.currentNodeId} não existe na versão ${run.version}.`, completedAt: nowIso });
      res.runsFailed++;
      return null;
    }
    const isWait = node.kind === 'DELAY' || node.action === 'WAIT_CONDITION';
    const existing = await store.getStep(run.id, node.id);
    let port: string | null = 'next';

    if (existing && existing.outcome !== 'STARTED' && existing.outcome !== 'WAITING') {
      // Ja concluido (queda entre concluir o no e mover a execucao): so segue a saida gravada.
      port = existing.port;
    } else if (isWait) {
      const w = await runWaitNode(store, run, node, contact, existing, seq, nowIso);
      if (!existing) seq++;
      if (w.wakeAt) {
        await finish({ status: 'WAITING', wakeAt: w.wakeAt, waitStartedAt: run.waitStartedAt || nowIso });
        res.runsWaiting++;
        return null;
      }
      port = w.port;
      res.stepsExecuted++;
    } else {
      if (existing && existing.outcome === 'STARTED' && !PURE_ACTIONS.has(String(node.action))) {
        const taskId = await createReviewTask(repo, run, nodeLabel(node), nowIso);
        await finish({ status: 'NEEDS_REVIEW', lastError: `Execução interrompida durante "${nodeLabel(node)}".${taskId ? ` Tarefa ${taskId}.` : ''}` });
        res.runsNeedingReview++;
        return null;
      }
      if (!existing) {
        const claimed = await store.claimStep({ runId: run.id, nodeId: node.id, seq: seq++, kind: node.kind, action: node.action || null, outcome: 'STARTED', message: '', port: null, at: nowIso, finishedAt: null });
        if (!claimed) return null; // outra execucao reservou (nao deveria ocorrer com a trava)
      }
      let out: ActionOutcome;
      try {
        out = await executeAction(repo, deps, run, node, contact);
      } catch (err) {
        out = { outcome: 'FAILED', message: String((err as Error)?.message || 'Erro na ação').slice(0, 300), port: null, mutated: false };
      }
      if (out.mutated && deps.persist) {
        try {
          await deps.persist();
        } catch {
          // Nao marca como feito: fica STARTED => "para revisar" na proxima execucao.
          return 'STATE_PERSIST_FAILED';
        }
      }
      await store.finishStep(run.id, node.id, { outcome: out.outcome, message: out.message, port: out.port, finishedAt: nowFn().toISOString() });
      res.stepsExecuted++;
      if (out.variant) run.variants = { ...run.variants, [node.id]: out.variant };
      if (out.outcome === 'FAILED') {
        await finish({ status: 'FAILED', lastError: out.message, completedAt: nowFn().toISOString(), variants: run.variants });
        res.runsFailed++;
        return null;
      }
      if (out.end) {
        await finish({ status: 'COMPLETED', completedAt: nowFn().toISOString(), currentNodeId: null, variants: run.variants });
        res.runsCompleted++;
        return null;
      }
      port = out.port;
    }
    const nextId = node.kind === 'DELAY' || !['IF_ELSE', 'WAIT_CONDITION', 'PERCENT_SPLIT', 'AB_TEST'].includes(String(node.action)) ? node.next || null : (port ? node.branches?.[port] || null : null);
    await finish({ currentNodeId: nextId, status: 'ACTIVE', wakeAt: nowIso, waitStartedAt: null, variants: run.variants });
  }
  // Limite de passos por execucao neste tick: continua no proximo.
  return null;
}

async function runWaitNode(
  store: WorkflowStore,
  run: WfRun,
  node: WfNode,
  contact: Contact,
  existing: WfStep | null,
  seq: number,
  nowIso: string
): Promise<{ wakeAt: string | null; port: string }> {
  const nowMs = Date.parse(nowIso);
  const startedMs = existing ? Date.parse(existing.at) : nowMs;
  if (!existing) {
    await store.claimStep({ runId: run.id, nodeId: node.id, seq, kind: node.kind, action: node.action || null, outcome: 'WAITING', message: '', port: null, at: nowIso, finishedAt: null });
  }
  if (node.kind === 'DELAY') {
    const until = startedMs + Number(node.config.minutes) * 60000;
    if (nowMs < until) {
      await store.finishStep(run.id, node.id, { outcome: 'WAITING', message: `Aguardando até ${new Date(until).toISOString()}.` });
      return { wakeAt: new Date(until).toISOString(), port: 'next' };
    }
    await store.finishStep(run.id, node.id, { outcome: 'DONE', message: `Atraso de ${Number(node.config.minutes)} minuto(s) concluído.`, port: 'next', finishedAt: nowIso });
    return { wakeAt: null, port: 'next' };
  }
  const cond = node.config.condition as WfCondition;
  if (evaluateWfCondition(contact, cond)) {
    await store.finishStep(run.id, node.id, { outcome: 'DONE', message: `Condição atendida: ${condText(cond)}.`, port: 'met', finishedAt: nowIso });
    return { wakeAt: null, port: 'met' };
  }
  const deadline = startedMs + Number(node.config.timeoutMinutes) * 60000;
  if (nowMs >= deadline) {
    await store.finishStep(run.id, node.id, { outcome: 'DONE', message: `Prazo esgotado sem "${condText(cond)}".`, port: 'timeout', finishedAt: nowIso });
    return { wakeAt: null, port: 'timeout' };
  }
  await store.finishStep(run.id, node.id, { outcome: 'WAITING', message: `Aguardando "${condText(cond)}" até ${new Date(deadline).toISOString()}.` });
  return { wakeAt: new Date(Math.min(deadline, nowMs + WORKFLOW_WAIT_RECHECK_MS)).toISOString(), port: 'timeout' };
}

interface ActionOutcome {
  outcome: 'DONE' | 'SKIPPED' | 'BLOCKED' | 'FAILED';
  message: string;
  port: string | null;
  /** Alterou o estado do CRM (precisa gravar antes de marcar como feito). */
  mutated: boolean;
  end?: boolean;
  variant?: string;
}

const sequenceService = new SequenceService();

async function executeAction(repo: CrmRepository, deps: WorkflowDeps, run: WfRun, node: WfNode, contact: Contact): Promise<ActionOutcome> {
  const env = deps.env || process.env;
  const cfg = node.config || {};
  const done = (message: string, mutated = true, port: string | null = 'next'): ActionOutcome => ({ outcome: 'DONE', message, port, mutated });
  const blocked = (message: string): ActionOutcome => ({ outcome: 'BLOCKED', message, port: 'next', mutated: false });
  const actor = `Automação: ${run.workflowName}`;
  switch (node.action) {
    case 'IF_ELSE': {
      const ok = evaluateWfCondition(contact, cfg.condition as WfCondition);
      return { outcome: 'DONE', message: `Condição ${condText(cfg.condition as WfCondition)}: ${ok ? 'sim' : 'não'}.`, port: ok ? 'yes' : 'no', mutated: false };
    }
    case 'PERCENT_SPLIT':
    case 'AB_TEST': {
      const pick = pickVariant(`${contact.id}:${node.id}`, cfg.variants as WfVariant[]);
      return { outcome: 'DONE', message: `${node.action === 'AB_TEST' ? 'Teste A/B' : 'Divisão'}: caminho "${pick.label}".`, port: pick.id, mutated: false, variant: pick.id };
    }
    case 'END_FLOW':
      return { outcome: 'DONE', message: 'Fluxo encerrado.', port: null, mutated: false, end: true };
    case 'SEND_EMAIL': {
      const m = deps.marketing;
      if (!m) return blocked('Envio de campanhas indisponível.');
      if (!isMarketingLiveSendEnabled(m.env || env)) return blocked('Envio real de marketing desligado (MARKETING_LIVE_SEND): nada foi enfileirado.');
      const campaign = repo.getMarketingCampaignById(String(cfg.campaignId || ''));
      if (!campaign) return blocked('Campanha não encontrada.');
      const pre = await marketingPreflight(m);
      if (!pre.ready) return blocked(`Envio real bloqueado: ${pre.problems.join(' ')}`);
      try {
        const r = await enqueueCampaign(repo, m, { campaignId: campaign.id, templateId: String(cfg.templateId), contacts: [contact] });
        if (r.blockedCount > 0) return blocked(`Bloqueado: ${r.blockedContacts[0].reason}`);
        return done(r.queuedCount > 0 ? `Na fila da campanha "${campaign.name}" (modelo v${r.templateVersion}).` : 'Já estava na fila desta campanha (sem duplicar).', false);
      } catch (err) {
        return blocked((err as Error).message);
      }
    }
    case 'ENROLL_SEQUENCE': {
      try {
        const { sequence } = sequenceService.enrollContact(repo, { sequenceId: String(cfg.sequenceId), contactId: contact.id });
        return done(`Inscrito na cadência "${sequence.name}".`);
      } catch (err) {
        return blocked((err as Error).message.slice(0, 300));
      }
    }
    case 'UNENROLL_SEQUENCE': {
      const r = repo.updateContactSubscriptionPreference({ contactId: contact.id, action: 'EXIT_SEQUENCE_ONLY', sequenceId: String(cfg.sequenceId), reason: `Removido pela automação "${run.workflowName}".` });
      return done(`Removido de ${r.exitedEnrollmentsCount} inscrição(ões) da cadência (marketing preservado).`);
    }
    case 'TAG': {
      const tags = new Set(contactTags(contact));
      const tag = String(cfg.tag);
      const add = cfg.mode === 'ADD';
      const changed = add ? !tags.has(tag) : tags.has(tag);
      if (add) tags.add(tag);
      else tags.delete(tag);
      repo.updateContact(contact.id, { customProperties: { ...(contact.customProperties || {}), tags: [...tags] } });
      if (changed && deps.store) {
        await emitWorkflowEvent(deps, { type: 'TAG_CHANGED', contactId: contact.id, context: { tag, mode: add ? 'ADD' : 'REMOVE' }, eventId: `tag:${run.id}:${node.id}`, depth: run.depth + 1 });
      }
      return done(`${add ? 'Tag adicionada' : 'Tag removida'}: "${tag}".`, changed);
    }
    case 'CHANGE_OWNER':
      repo.updateContact(contact.id, { ownerId: String(cfg.ownerId), ...(cfg.ownerName ? { ownerName: String(cfg.ownerName) } : {}) });
      return done(`Proprietário alterado para ${cfg.ownerName || cfg.ownerId}.`);
    case 'UPDATE_PROPERTY': {
      const f = String(cfg.field);
      if (f.startsWith('custom.')) repo.updateContact(contact.id, { customProperties: { ...(contact.customProperties || {}), [f.slice(7)]: cfg.value } });
      else repo.updateContact(contact.id, { [f]: cfg.value } as Partial<Contact>);
      return done(`${f} = "${String(cfg.value ?? '')}".`);
    }
    case 'CREATE_TASK': {
      const due = new Date(Date.now() + Number(cfg.dueInDays ?? 1) * 86400000).toISOString().slice(0, 10);
      const t = repo.createTask({
        title: String(cfg.title).slice(0, 200),
        notes: `Criada pela automação "${run.workflowName}".`,
        type: 'TODO',
        priority: (['LOW', 'MEDIUM', 'HIGH'].includes(String(cfg.priority)) ? cfg.priority : 'MEDIUM') as 'LOW' | 'MEDIUM' | 'HIGH',
        status: 'NOT_STARTED',
        queueName: WORKFLOW_REVIEW_QUEUE,
        dueDate: due,
        assignedTo: contact.ownerName || 'Marcelo Lopes Mira',
        contactId: contact.id,
        companyId: contact.companyId ?? null,
      });
      return done(`Tarefa criada (${t.id}).`);
    }
    case 'CREATE_DEAL': {
      const d = repo.createDeal({
        title: String(cfg.title).slice(0, 200),
        value: Math.max(0, Number(cfg.value || 0)),
        contactId: contact.id,
        companyId: contact.companyId ?? null,
        ...(cfg.stageId ? { stageId: String(cfg.stageId) } : {}),
        ...(cfg.pipelineId ? { pipelineId: String(cfg.pipelineId) } : {}),
      } as Parameters<CrmRepository['createDeal']>[0]);
      return done(`Oportunidade criada no CRM (${d.id}).`);
    }
    case 'NOTIFY_SELLER':
      repo.createTimelineEvent({
        type: 'WORKFLOW_ACTION',
        title: `Aviso ao vendedor: ${String(cfg.message).slice(0, 200)}`,
        body: `Automação "${run.workflowName}".`,
        contactId: contact.id,
        companyId: contact.companyId ?? null,
        metadata: { workflowId: run.workflowId, runId: run.id, nodeId: node.id },
        actor,
      });
      return done('Vendedor notificado na linha do tempo do contato.');
    case 'SEND_WEBHOOK': {
      let host = '';
      try {
        host = new URL(String(cfg.url)).hostname.toLowerCase();
      } catch {
        return blocked('URL do webhook inválida.');
      }
      if (!resolveWebhookAllowedHosts(env).has(host)) return blocked(`Host ${host} fora de WORKFLOWS_WEBHOOK_ALLOWED_HOSTS.`);
      if (!deps.webhookFetch) return blocked('Cliente de webhook indisponível.');
      // So ids (sem e-mail/nome): o destino consulta a API se precisar de mais dados.
      const r = await deps.webhookFetch(String(cfg.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `${run.id}:${node.id}` },
        body: JSON.stringify({ event: 'stihub.workflow.action', workflowId: run.workflowId, runId: run.id, nodeId: node.id, contactId: contact.id }),
      });
      if (!r.ok) return { outcome: 'FAILED', message: `Webhook respondeu ${r.status}.`, port: null, mutated: false };
      return done(`Webhook chamado (${host}).`, false);
    }
    case 'APPLY_LEAD_SCORE': {
      const before = Number(contact.leadScore || 0);
      const after = Math.max(0, Math.min(100, before + Number(cfg.points)));
      repo.updateContact(contact.id, { leadScore: after });
      return done(`Lead score ${before} -> ${after}.`);
    }
    case 'START_REACTIVATION': {
      const el = reactivationEligibility(repo, contact, cfg, (deps.now || (() => new Date()))().getTime());
      if (!el.ok) return blocked(el.reason);
      if (run.depth + 1 > WORKFLOW_MAX_DEPTH) return blocked('Limite de encadeamento de fluxos atingido.');
      const target = await deps.store.getDefinition(String(cfg.workflowId));
      if (!target || target.status !== 'ACTIVE') return blocked('Fluxo de reativação não está ativo.');
      const ok = await emitWorkflowEvent(deps, {
        type: (await deps.store.getVersion(target.id, target.activeVersion!))?.graph.trigger.type || 'CUSTOM_EVENT',
        contactId: contact.id,
        context: { fromWorkflowId: run.workflowId },
        eventId: `react:${run.id}:${node.id}`,
        depth: run.depth + 1,
        targetWorkflowId: target.id,
      });
      return done(ok ? `Reativação "${target.name}" agendada (respeita a política de reentrada do fluxo).` : 'Reativação já registrada.', false);
    }
    default:
      return { outcome: 'FAILED', message: 'Ação desconhecida.', port: null, mutated: false };
  }
}

/** Decisao humana sobre execucao "para revisar": CONTINUE (considera a acao feita) ou EXIT. */
export async function resolveRunReview(store: WorkflowStore, runId: string, decision: 'CONTINUE' | 'EXIT', actor: string, now = new Date()): Promise<WfRun> {
  const run = await store.getRun(runId);
  if (!run) throw new WorkflowError('Execução não encontrada.', 404);
  if (run.status !== 'NEEDS_REVIEW' || !run.currentNodeId) throw new WorkflowError('Esta execução não está em revisão.', 409);
  const v = await store.getVersion(run.workflowId, run.version);
  const node = v?.graph.nodes.find((n) => n.id === run.currentNodeId);
  const iso = now.toISOString();
  if (decision === 'EXIT') {
    await store.finishStep(run.id, run.currentNodeId, { outcome: 'SKIPPED', message: `Encerrado na revisão por ${actor}.`, finishedAt: iso });
    await store.updateRun(run.id, { status: 'EXITED', completedAt: iso, updatedAt: iso, lastError: `Encerrado na revisão por ${actor}.` });
  } else {
    await store.finishStep(run.id, run.currentNodeId, { outcome: 'DONE', message: `Confirmado como feito na revisão por ${actor}.`, port: 'next', finishedAt: iso });
    await store.updateRun(run.id, { status: 'ACTIVE', currentNodeId: node?.next || null, wakeAt: iso, updatedAt: iso, lastError: null });
  }
  return (await store.getRun(run.id))!;
}

export function describeTrigger(t: WfTriggerType): string {
  return WF_TRIGGER_LABELS[t] || t;
}
