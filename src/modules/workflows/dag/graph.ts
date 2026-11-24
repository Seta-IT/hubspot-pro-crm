// ============================================================================
// STI-hub — Fase 4: modelo do fluxo (DAG) e validacao. Ciclos sao PROIBIDOS dentro do fluxo
// (deteccao por DFS com o caminho do ciclo) e entre fluxos (acao "Iniciar fluxo de reativacao").
// Reentrada de um contato e controlada pela politica do fluxo (nunca / apos concluir / sempre,
// com intervalo minimo), nunca por arestas de volta.
// ============================================================================
import {
  WF_ACTIONS,
  WF_BRANCHING,
  WF_CONDITION_OPERATORS,
  WF_READABLE_FIELDS,
  WF_TRIGGERS,
  WF_WRITABLE_FIELDS,
  type WfActionType,
  type WfConditionOperator,
  type WfTriggerType,
} from './catalog';

export type WfNodeKind = 'ACTION' | 'DELAY';

export interface WfCondition {
  field: string;
  operator: WfConditionOperator;
  value?: string | number | null;
}

export interface WfVariant {
  id: string;
  label: string;
  percent: number;
}

export interface WfNode {
  id: string;
  kind: WfNodeKind;
  action?: WfActionType;
  label?: string;
  config: Record<string, unknown>;
  /** Saida unica (acoes simples e atrasos). */
  next?: string | null;
  /** Saidas nomeadas: IF_ELSE {yes,no}; WAIT_CONDITION {met,timeout}; PERCENT_SPLIT/AB_TEST {<variante>}. */
  branches?: Record<string, string | null>;
  x?: number;
  y?: number;
}

export type WfReentryMode = 'NEVER' | 'AFTER_COMPLETION' | 'ALWAYS';

export interface WfGraph {
  trigger: { type: WfTriggerType; config: Record<string, unknown> };
  startNodeId: string | null;
  nodes: WfNode[];
  reentry: { mode: WfReentryMode; cooldownDays: number };
}

export interface WfValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Caminho de ids que forma o ciclo (se houver). */
  cycle: string[] | null;
}

export const WF_MAX_NODES = 100;
export const WF_MAX_DELAY_MINUTES = 365 * 24 * 60;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const TAG_RE = /^[A-Za-z0-9 _.:-]{1,40}$/;
const CUSTOM_FIELD_RE = /^custom\.[A-Za-z0-9_]{1,40}$/;

export function nodeOutputs(n: WfNode): Array<{ port: string; target: string | null }> {
  if (n.kind === 'ACTION' && n.action && WF_BRANCHING.includes(n.action)) {
    return Object.entries(n.branches || {}).map(([port, target]) => ({ port, target: target || null }));
  }
  if (n.kind === 'ACTION' && n.action === 'END_FLOW') return [];
  return [{ port: 'next', target: n.next || null }];
}

export function expectedPorts(n: WfNode): string[] | null {
  if (n.kind !== 'ACTION' || !n.action) return null;
  if (n.action === 'IF_ELSE') return ['yes', 'no'];
  if (n.action === 'WAIT_CONDITION') return ['met', 'timeout'];
  if (n.action === 'PERCENT_SPLIT' || n.action === 'AB_TEST') {
    const vs = Array.isArray(n.config.variants) ? (n.config.variants as WfVariant[]) : [];
    return vs.map((v) => String(v?.id || ''));
  }
  return null;
}

function validateCondition(c: unknown, where: string, errors: string[]): void {
  const o = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
  const field = String(o.field || '');
  if (!(WF_READABLE_FIELDS as readonly string[]).includes(field) && !CUSTOM_FIELD_RE.test(field) && field !== 'tags') {
    errors.push(`${where}: propriedade "${field || '(vazia)'}" não pode ser usada em condição.`);
  }
  if (!(WF_CONDITION_OPERATORS as readonly string[]).includes(String(o.operator || ''))) errors.push(`${where}: operador inválido.`);
  const needsValue = !['IS_EMPTY', 'IS_NOT_EMPTY'].includes(String(o.operator));
  if (needsValue && (o.value === undefined || o.value === null || String(o.value).trim() === '')) errors.push(`${where}: informe o valor da condição.`);
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v);
}

function validateNodeConfig(n: WfNode, errors: string[], warnings: string[]): void {
  const where = `Nó "${n.label || n.id}"`;
  const c = n.config || {};
  if (n.kind === 'DELAY') {
    const m = num(c.minutes);
    if (!Number.isFinite(m) || m < 1 || m > WF_MAX_DELAY_MINUTES) errors.push(`${where}: atraso entre 1 minuto e 365 dias.`);
    return;
  }
  if (!n.action || !(WF_ACTIONS as readonly string[]).includes(n.action)) {
    errors.push(`${where}: ação inválida.`);
    return;
  }
  const str = (k: string) => String(c[k] ?? '').trim();
  switch (n.action) {
    case 'SEND_EMAIL':
      if (!str('campaignId')) errors.push(`${where}: escolha a campanha.`);
      if (!/^mtpl-/.test(str('templateId'))) errors.push(`${where}: escolha um modelo de e-mail (só modelos aprovados são enviados).`);
      break;
    case 'ENROLL_SEQUENCE':
    case 'UNENROLL_SEQUENCE':
      if (!str('sequenceId')) errors.push(`${where}: escolha a cadência.`);
      break;
    case 'TAG':
      if (!TAG_RE.test(str('tag'))) errors.push(`${where}: tag inválida (até 40 caracteres simples).`);
      if (!['ADD', 'REMOVE'].includes(str('mode'))) errors.push(`${where}: escolha adicionar ou remover.`);
      break;
    case 'CHANGE_OWNER':
      if (!str('ownerId')) errors.push(`${where}: escolha o proprietário.`);
      break;
    case 'UPDATE_PROPERTY': {
      const f = str('field');
      if (!(WF_WRITABLE_FIELDS as readonly string[]).includes(f) && !CUSTOM_FIELD_RE.test(f)) {
        errors.push(`${where}: a propriedade "${f || '(vazia)'}" não pode ser alterada por automação (campos LGPD, e-mail e dados de ERP/Chamados são protegidos).`);
      }
      if (String(c.value ?? '').length > 200) errors.push(`${where}: valor com mais de 200 caracteres.`);
      break;
    }
    case 'CREATE_TASK': {
      if (!str('title')) errors.push(`${where}: informe o título da tarefa.`);
      const d = num(c.dueInDays ?? 1);
      if (!Number.isFinite(d) || d < 0 || d > 90) errors.push(`${where}: prazo entre 0 e 90 dias.`);
      break;
    }
    case 'CREATE_DEAL': {
      if (!str('title')) errors.push(`${where}: informe o nome da oportunidade.`);
      const v = num(c.value ?? 0);
      if (!Number.isFinite(v) || v < 0) errors.push(`${where}: valor inválido.`);
      break;
    }
    case 'NOTIFY_SELLER':
      if (!str('message')) errors.push(`${where}: informe a mensagem.`);
      break;
    case 'SEND_WEBHOOK':
      if (!/^https:\/\/[^\s"'<>]+$/i.test(str('url'))) errors.push(`${where}: o webhook precisa de URL https.`);
      break;
    case 'WAIT_CONDITION': {
      validateCondition(c.condition, where, errors);
      const t = num(c.timeoutMinutes);
      if (!Number.isFinite(t) || t < 5 || t > WF_MAX_DELAY_MINUTES) errors.push(`${where}: prazo máximo de espera entre 5 minutos e 365 dias.`);
      break;
    }
    case 'IF_ELSE':
      validateCondition(c.condition, where, errors);
      break;
    case 'PERCENT_SPLIT':
    case 'AB_TEST': {
      const vs = Array.isArray(c.variants) ? (c.variants as WfVariant[]) : [];
      if (vs.length < 2 || vs.length > 5) errors.push(`${where}: de 2 a 5 caminhos.`);
      const ids = new Set<string>();
      let total = 0;
      for (const v of vs) {
        if (!ID_RE.test(String(v?.id || ''))) errors.push(`${where}: caminho com id inválido.`);
        if (ids.has(String(v?.id))) errors.push(`${where}: caminhos com id repetido.`);
        ids.add(String(v?.id));
        const p = num(v?.percent);
        if (!Number.isInteger(p) || p < 1 || p > 99) errors.push(`${where}: percentuais inteiros entre 1 e 99.`);
        total += Number.isFinite(p) ? p : 0;
      }
      if (vs.length >= 2 && total !== 100) errors.push(`${where}: os percentuais somam ${total}%, precisam somar 100%.`);
      break;
    }
    case 'APPLY_LEAD_SCORE': {
      const p = num(c.points);
      if (!Number.isInteger(p) || p === 0 || p < -100 || p > 100) errors.push(`${where}: pontos inteiros entre -100 e 100 (diferente de 0).`);
      break;
    }
    case 'START_REACTIVATION':
      if (!/^wfd-/.test(str('workflowId'))) errors.push(`${where}: escolha o fluxo de reativação.`);
      if (num(c.minInactiveDays ?? 30) < 7) warnings.push(`${where}: reativação com menos de 7 dias sem engajamento.`);
      break;
    case 'END_FLOW':
      break;
  }
}

/** DFS iterativa: devolve o primeiro ciclo encontrado (lista de ids, fechando no repetido) ou null. */
export function findCycle(nodes: WfNode[], startIds: string[]): string[] | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const state = new Map<string, 1 | 2>(); // 1 = na pilha, 2 = concluido
  const path: string[] = [];
  const visit = (id: string): string[] | null => {
    const st = state.get(id);
    if (st === 2) return null;
    if (st === 1) return [...path.slice(path.indexOf(id)), id];
    const n = byId.get(id);
    if (!n) return null;
    state.set(id, 1);
    path.push(id);
    for (const o of nodeOutputs(n)) {
      if (!o.target) continue;
      const c = visit(o.target);
      if (c) return c;
    }
    path.pop();
    state.set(id, 2);
    return null;
  };
  for (const s of startIds) {
    const c = visit(s);
    if (c) return c;
  }
  // Nos inalcancaveis tambem nao podem formar ciclo.
  for (const n of nodes) {
    const c = visit(n.id);
    if (c) return c;
  }
  return null;
}

export function validateWorkflowGraph(g: WfGraph): WfValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!(WF_TRIGGERS as readonly string[]).includes(String(g.trigger?.type))) errors.push('Escolha um gatilho válido.');
  const nodes = Array.isArray(g.nodes) ? g.nodes : [];
  if (nodes.length === 0) errors.push('O fluxo precisa de pelo menos uma ação.');
  if (nodes.length > WF_MAX_NODES) errors.push(`Máximo de ${WF_MAX_NODES} nós por fluxo.`);
  const ids = new Set<string>();
  for (const n of nodes) {
    if (!ID_RE.test(String(n?.id || ''))) errors.push(`Nó com id inválido: "${String(n?.id || '')}".`);
    if (ids.has(n.id)) errors.push(`Id de nó repetido: "${n.id}".`);
    ids.add(n.id);
  }
  if (!g.startNodeId || !ids.has(g.startNodeId)) errors.push('Defina o primeiro nó do fluxo (ligado ao gatilho).');
  for (const n of nodes) {
    validateNodeConfig(n, errors, warnings);
    const expected = expectedPorts(n);
    if (expected) {
      const got = Object.keys(n.branches || {});
      for (const p of expected) if (!got.includes(p)) warnings.push(`Nó "${n.label || n.id}": a saída "${p}" não está ligada (o fluxo termina nela).`);
      for (const p of got) if (!expected.includes(p)) errors.push(`Nó "${n.label || n.id}": saída desconhecida "${p}".`);
    }
    for (const o of nodeOutputs(n)) {
      if (o.target && !ids.has(o.target)) errors.push(`Nó "${n.label || n.id}": liga para um nó inexistente ("${o.target}").`);
      if (o.target === n.id) errors.push(`Nó "${n.label || n.id}": não pode ligar para ele mesmo.`);
    }
  }
  const cycle = findCycle(nodes, g.startNodeId ? [g.startNodeId] : []);
  if (cycle) errors.push(`Ciclo detectado: ${cycle.join(' -> ')}. Fluxos não podem voltar a um nó anterior; use a política de reentrada.`);
  if (!cycle && g.startNodeId && ids.has(g.startNodeId)) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const seen = new Set<string>();
    const stack = [g.startNodeId];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const o of nodeOutputs(byId.get(id)!)) if (o.target && byId.has(o.target)) stack.push(o.target);
    }
    for (const n of nodes) if (!seen.has(n.id)) errors.push(`Nó "${n.label || n.id}" não é alcançável a partir do gatilho.`);
  }
  const r = g.reentry || { mode: 'NEVER', cooldownDays: 0 };
  if (!['NEVER', 'AFTER_COMPLETION', 'ALWAYS'].includes(r.mode)) errors.push('Política de reentrada inválida.');
  if (r.mode !== 'NEVER' && (!Number.isFinite(num(r.cooldownDays)) || num(r.cooldownDays) < 1 || num(r.cooldownDays) > 365)) {
    errors.push('Reentrada exige intervalo mínimo entre 1 e 365 dias.');
  }
  const t = g.trigger?.config || {};
  if (g.trigger?.type === 'NO_ENGAGEMENT_PERIOD' && !(num(t.days) >= 7 && num(t.days) <= 365)) errors.push('Período sem engajamento: entre 7 e 365 dias.');
  if (g.trigger?.type === 'SPECIFIC_DATE' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(t.at || ''))) errors.push('Data específica: informe data e hora.');
  if (g.trigger?.type === 'SPECIFIC_DATE' && !String(t.segmentId || '').trim()) errors.push('Data específica: escolha o segmento de contatos.');
  return { ok: errors.length === 0, errors, warnings, cycle };
}

/**
 * Ciclo entre fluxos pela acao "Iniciar fluxo de reativacao" (A inicia B que inicia A).
 * `edges`: id do fluxo -> ids dos fluxos que ele inicia.
 */
export function findWorkflowReferenceCycle(edges: Map<string, string[]>, from: string): string[] | null {
  const path: string[] = [];
  const onPath = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string): string[] | null => {
    if (onPath.has(id)) return [...path.slice(path.indexOf(id)), id];
    if (done.has(id)) return null;
    onPath.add(id);
    path.push(id);
    for (const t of edges.get(id) || []) {
      const c = visit(t);
      if (c) return c;
    }
    path.pop();
    onPath.delete(id);
    done.add(id);
    return null;
  };
  return visit(from);
}

export function reactivationTargets(g: Pick<WfGraph, 'nodes'>): string[] {
  return (g.nodes || []).filter((n) => n.action === 'START_REACTIVATION').map((n) => String(n.config?.workflowId || '')).filter(Boolean);
}
