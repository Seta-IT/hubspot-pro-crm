'use client';

// Fase 4 — Construtor visual de automacoes duraveis (DAG). Sem emojis.
// Fluxo: montar -> validar -> simular com contato de exemplo -> ativar. Com WORKFLOWS_LIVE
// desligado nada executa de verdade (somente simulacao).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Contact } from '../../db/types';

type Opt = { id: string; label: string; scheduled?: boolean };
interface Catalog {
  liveEnabled: boolean;
  testRecipientsConfigured: boolean;
  webhookAllowedHosts: string[];
  maxDepth: number;
  triggers: Opt[];
  actions: Opt[];
  operators: Opt[];
  readableFields: string[];
  writableFields: string[];
}
interface Cond { field: string; operator: string; value?: string | number | null }
interface Variant { id: string; label: string; percent: number }
interface Node {
  id: string;
  kind: 'ACTION' | 'DELAY';
  action?: string;
  label?: string;
  config: Record<string, any>;
  next?: string | null;
  branches?: Record<string, string | null>;
}
interface Graph {
  trigger: { type: string; config: Record<string, any> };
  startNodeId: string | null;
  nodes: Node[];
  reentry: { mode: 'NEVER' | 'AFTER_COMPLETION' | 'ALWAYS'; cooldownDays: number };
}
interface Validation { ok: boolean; errors: string[]; warnings: string[]; cycle: string[] | null }
interface Def {
  id: string;
  name: string;
  description: string;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED';
  version: number;
  activeVersion: number | null;
  graph: Graph;
  lastSimulation: { version: number; contactId: string; at: string; ok: boolean } | null;
  validation?: Validation;
}
interface SimStep { nodeId: string; label: string; outcome: string; message: string; port: string | null; at: string }
interface Run {
  id: string;
  workflowName: string;
  version: number;
  status: string;
  currentNodeId: string | null;
  wakeAt: string | null;
  lastError: string | null;
  startedAt: string;
  completedAt: string | null;
  variants: Record<string, string>;
  steps: Array<{ nodeId: string; seq: number; outcome: string; message: string; at: string; finishedAt: string | null }>;
}

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; data?: T; error?: string; details?: any }> {
  try {
    const r = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: String(j?.error || `Erro ${r.status}`), details: j?.details };
    return { ok: true, data: j?.data as T };
  } catch {
    return { ok: false, error: 'Falha de conexão.' };
  }
}

const BRANCHING = new Set(['IF_ELSE', 'WAIT_CONDITION', 'PERCENT_SPLIT', 'AB_TEST']);
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Rascunho', ACTIVE: 'Ativo', PAUSED: 'Pausado',
  WAITING: 'Aguardando', COMPLETED: 'Concluída', EXITED: 'Encerrada', FAILED: 'Falhou', NEEDS_REVIEW: 'Para revisar',
};
const OUTCOME_TONE: Record<string, string> = {
  EXECUTARIA: 'text-emerald-700', DONE: 'text-emerald-700', DESVIO: 'text-indigo-700', ESPERA: 'text-amber-700', WAITING: 'text-amber-700',
  BLOQUEADO: 'text-rose-700', BLOCKED: 'text-rose-700', FAILED: 'text-rose-700', STARTED: 'text-rose-700', FIM: 'text-slate-600', SKIPPED: 'text-slate-500',
};
const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '-');

/** Campos de configuracao por acao (o motor valida de novo no servidor). */
const ACTION_FIELDS: Record<string, Array<{ key: string; label: string; type?: 'number' | 'select'; options?: string[] }>> = {
  SEND_EMAIL: [{ key: 'campaignId', label: 'Campanha (id)' }, { key: 'templateId', label: 'Modelo aprovado (mtpl-...)' }],
  ENROLL_SEQUENCE: [{ key: 'sequenceId', label: 'Cadência (id)' }],
  UNENROLL_SEQUENCE: [{ key: 'sequenceId', label: 'Cadência (id)' }],
  TAG: [{ key: 'mode', label: 'Operação', type: 'select', options: ['ADD', 'REMOVE'] }, { key: 'tag', label: 'Tag' }],
  CHANGE_OWNER: [{ key: 'ownerId', label: 'Proprietário (id)' }, { key: 'ownerName', label: 'Nome do proprietário' }],
  UPDATE_PROPERTY: [{ key: 'field', label: 'Propriedade' }, { key: 'value', label: 'Novo valor' }],
  CREATE_TASK: [{ key: 'title', label: 'Título' }, { key: 'dueInDays', label: 'Prazo (dias)', type: 'number' }, { key: 'priority', label: 'Prioridade', type: 'select', options: ['LOW', 'MEDIUM', 'HIGH'] }],
  CREATE_DEAL: [{ key: 'title', label: 'Nome da oportunidade' }, { key: 'value', label: 'Valor (R$)', type: 'number' }],
  NOTIFY_SELLER: [{ key: 'message', label: 'Mensagem' }],
  SEND_WEBHOOK: [{ key: 'url', label: 'URL https (host permitido)' }],
  WAIT_CONDITION: [{ key: 'timeoutMinutes', label: 'Prazo máximo (minutos)', type: 'number' }],
  APPLY_LEAD_SCORE: [{ key: 'points', label: 'Pontos (-100 a 100)', type: 'number' }],
  START_REACTIVATION: [{ key: 'workflowId', label: 'Fluxo de reativação (wfd-...)' }, { key: 'minInactiveDays', label: 'Dias mínimos sem engajamento', type: 'number' }],
};
const TRIGGER_FIELDS: Record<string, Array<{ key: string; label: string; type?: 'number' }>> = {
  FORM_SUBMITTED: [{ key: 'formId', label: 'Formulário (id, opcional)' }],
  PIPELINE_STAGE_CHANGED: [{ key: 'pipelineId', label: 'Pipeline (opcional)' }, { key: 'stageId', label: 'Etapa de destino (opcional)' }],
  TAG_CHANGED: [{ key: 'tag', label: 'Tag (opcional)' }, { key: 'mode', label: 'ADD ou REMOVE (opcional)' }],
  CUSTOM_EVENT: [{ key: 'eventName', label: 'Nome do evento (opcional)' }],
  WEBHOOK_RECEIVED: [{ key: 'source', label: 'Origem (opcional)' }],
  EMAIL_DELIVERED: [{ key: 'campaignId', label: 'Campanha (opcional)' }],
  EMAIL_OPENED: [{ key: 'campaignId', label: 'Campanha (opcional)' }],
  LINK_CLICKED: [{ key: 'campaignId', label: 'Campanha (opcional)' }],
  NO_ENGAGEMENT_PERIOD: [{ key: 'days', label: 'Dias sem engajamento (7 a 365)', type: 'number' }],
  SPECIFIC_DATE: [{ key: 'at', label: 'Data e hora (AAAA-MM-DDTHH:MM, horário de Brasília)' }, { key: 'segmentId', label: 'Segmento (id)' }],
};

const emptyGraph = (): Graph => ({ trigger: { type: 'CONTACT_CREATED', config: {} }, startNodeId: null, nodes: [], reentry: { mode: 'NEVER', cooldownDays: 0 } });
let nodeSeq = 0;
const newNodeId = () => `n${Date.now().toString(36).slice(-4)}${(nodeSeq++).toString(36)}`;

function defaultConfig(action: string): Record<string, any> {
  if (action === 'IF_ELSE') return { condition: { field: 'leadScore', operator: 'GREATER_THAN', value: 50 } };
  if (action === 'WAIT_CONDITION') return { condition: { field: 'lifecycleStage', operator: 'EQUALS', value: 'OPPORTUNITY' }, timeoutMinutes: 1440 };
  if (action === 'PERCENT_SPLIT') return { variants: [{ id: 'a', label: 'Caminho A', percent: 50 }, { id: 'b', label: 'Caminho B', percent: 50 }] };
  if (action === 'AB_TEST') return { variants: [{ id: 'a', label: 'Versão A', percent: 50 }, { id: 'b', label: 'Versão B', percent: 50 }] };
  if (action === 'TAG') return { mode: 'ADD', tag: '' };
  if (action === 'CREATE_TASK') return { title: '', dueInDays: 1, priority: 'MEDIUM' };
  if (action === 'APPLY_LEAD_SCORE') return { points: 10 };
  if (action === 'START_REACTIVATION') return { workflowId: '', minInactiveDays: 30 };
  return {};
}
function portsOf(n: Node): string[] {
  if (n.kind === 'DELAY' || !n.action || !BRANCHING.has(n.action)) return n.action === 'END_FLOW' ? [] : ['next'];
  if (n.action === 'IF_ELSE') return ['yes', 'no'];
  if (n.action === 'WAIT_CONDITION') return ['met', 'timeout'];
  return ((n.config.variants || []) as Variant[]).map((v) => v.id);
}
const PORT_LABEL: Record<string, string> = { next: 'Próximo', yes: 'Sim', no: 'Não', met: 'Atendida', timeout: 'Prazo esgotado' };
function portTarget(n: Node, p: string): string | null {
  return p === 'next' ? n.next || null : n.branches?.[p] || null;
}

/** Visao em camadas (profundidade a partir do primeiro no). */
function GraphView({ graph, labelOf, highlight }: { graph: Graph; labelOf: (n: Node) => string; highlight: Set<string> }) {
  const layout = useMemo(() => {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const depth = new Map<string, number>();
    const queue: string[] = graph.startNodeId && byId.has(graph.startNodeId) ? [graph.startNodeId] : [];
    if (queue[0]) depth.set(queue[0], 0);
    while (queue.length) {
      const id = queue.shift()!;
      const n = byId.get(id)!;
      for (const p of portsOf(n)) {
        const t = portTarget(n, p);
        if (t && byId.has(t) && !depth.has(t) && depth.size < 200) {
          depth.set(t, (depth.get(id) || 0) + 1);
          queue.push(t);
        }
      }
    }
    let orphanDepth = Math.max(0, ...[...depth.values()]) + 1;
    for (const n of graph.nodes) if (!depth.has(n.id)) depth.set(n.id, orphanDepth++);
    const rows = new Map<number, string[]>();
    for (const n of graph.nodes) {
      const d = depth.get(n.id)!;
      rows.set(d, [...(rows.get(d) || []), n.id]);
    }
    const pos = new Map<string, { x: number; y: number }>();
    for (const [d, ids] of rows) ids.forEach((id, i) => pos.set(id, { x: 20 + i * 210, y: 70 + d * 90 }));
    const width = Math.max(260, ...[...rows.values()].map((r) => r.length * 210 + 40));
    const height = 110 + Math.max(0, ...[...rows.keys()]) * 90 + 60;
    return { pos, width, height, byId };
  }, [graph]);
  const W = 180;
  const H = 44;
  return (
    <svg width={layout.width} height={layout.height} className="bg-slate-50 rounded-xl border border-slate-200" role="img" aria-label="Diagrama do fluxo">
      <rect x={20} y={10} width={W} height={36} rx={8} className="fill-indigo-50 stroke-indigo-300" />
      <text x={30} y={33} className="fill-indigo-900 text-[11px] font-semibold">Gatilho</text>
      {graph.startNodeId && layout.pos.get(graph.startNodeId) && (
        <line x1={20 + W / 2} y1={46} x2={layout.pos.get(graph.startNodeId)!.x + W / 2} y2={layout.pos.get(graph.startNodeId)!.y} className="stroke-slate-400" markerEnd="url(#wfarrow)" />
      )}
      <defs>
        <marker id="wfarrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-slate-400" />
        </marker>
      </defs>
      {graph.nodes.flatMap((n) =>
        portsOf(n).map((p) => {
          const t = portTarget(n, p);
          const a = layout.pos.get(n.id);
          const b = t ? layout.pos.get(t) : undefined;
          if (!a || !b) return null;
          const back = b.y <= a.y;
          return (
            <g key={`${n.id}-${p}`}>
              <line x1={a.x + W / 2} y1={a.y + H} x2={b.x + W / 2} y2={b.y} className={back ? 'stroke-rose-500' : 'stroke-slate-400'} strokeDasharray={back ? '4 3' : undefined} markerEnd="url(#wfarrow)" />
              {p !== 'next' && (
                <text x={(a.x + b.x) / 2 + W / 2 + 4} y={(a.y + H + b.y) / 2} className="fill-slate-600 text-[10px]">
                  {PORT_LABEL[p] || ((n.config.variants || []) as Variant[]).find((v) => v.id === p)?.label || p}
                </text>
              )}
            </g>
          );
        })
      )}
      {graph.nodes.map((n) => {
        const p = layout.pos.get(n.id)!;
        const on = highlight.has(n.id);
        return (
          <g key={n.id}>
            <rect x={p.x} y={p.y} width={W} height={H} rx={8} className={on ? 'fill-emerald-50 stroke-emerald-500' : n.kind === 'DELAY' ? 'fill-amber-50 stroke-amber-300' : BRANCHING.has(String(n.action)) ? 'fill-violet-50 stroke-violet-300' : 'fill-white stroke-slate-300'} />
            <text x={p.x + 8} y={p.y + 18} className="fill-slate-900 text-[11px] font-semibold">{labelOf(n).slice(0, 26)}</text>
            <text x={p.x + 8} y={p.y + 34} className="fill-slate-500 text-[10px]">{n.id}</text>
          </g>
        );
      })}
    </svg>
  );
}

function ConditionEditor({ value, onChange, catalog }: { value: Cond; onChange: (c: Cond) => void; catalog: Catalog }) {
  const fieldIsKnown = catalog.readableFields.includes(value.field) || value.field === 'tags';
  return (
    <div className="flex flex-wrap gap-2 items-center text-xs">
      <select className="border rounded-lg px-2 py-1" value={fieldIsKnown ? value.field : '__custom'} onChange={(e) => onChange({ ...value, field: e.target.value === '__custom' ? 'custom.' : e.target.value })}>
        {catalog.readableFields.map((f) => <option key={f} value={f}>{f}</option>)}
        <option value="tags">tags</option>
        <option value="__custom">propriedade personalizada</option>
      </select>
      {!fieldIsKnown && <input className="border rounded-lg px-2 py-1 w-36" value={value.field} onChange={(e) => onChange({ ...value, field: e.target.value })} placeholder="custom.chave" />}
      <select className="border rounded-lg px-2 py-1" value={value.operator} onChange={(e) => onChange({ ...value, operator: e.target.value })}>
        {catalog.operators.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      {!['IS_EMPTY', 'IS_NOT_EMPTY'].includes(value.operator) && (
        <input className="border rounded-lg px-2 py-1 w-36" value={String(value.value ?? '')} onChange={(e) => onChange({ ...value, value: e.target.value })} placeholder="valor" />
      )}
    </div>
  );
}

export default function WorkflowDagBuilder({ contacts }: { contacts: Contact[] }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [defs, setDefs] = useState<Def[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [graph, setGraph] = useState<Graph>(emptyGraph());
  const [validation, setValidation] = useState<Validation | null>(null);
  const [sim, setSim] = useState<{ steps: SimStep[]; errors: string[]; warnings: string[]; ok: boolean } | null>(null);
  const [simContactId, setSimContactId] = useState<string>(contacts[0]?.id || '');
  const [histContactId, setHistContactId] = useState<string>(contacts[0]?.id || '');
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const selected = defs.find((d) => d.id === selectedId) || null;
  const labelOf = useCallback(
    (n: Node) => n.label || (n.kind === 'DELAY' ? `Atraso ${n.config.minutes || '?'} min` : catalog?.actions.find((a) => a.id === n.action)?.label || String(n.action)),
    [catalog]
  );

  const load = useCallback(async () => {
    const [c, l] = await Promise.all([api<Catalog>('/api/workflows/v2/catalog'), api<Def[]>('/api/workflows/v2')]);
    if (c.ok && c.data) setCatalog(c.data);
    if (l.ok && l.data) setDefs(l.data);
    if (!c.ok) setMsg({ tone: 'err', text: c.error || 'Erro ao carregar.' });
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const openDef = (d: Def | null) => {
    setSelectedId(d?.id || null);
    setName(d?.name || '');
    setDescription(d?.description || '');
    setGraph(d ? JSON.parse(JSON.stringify(d.graph)) : emptyGraph());
    setValidation(d?.validation || null);
    setSim(null);
    setMsg(null);
  };

  const patchNode = (id: string, patch: Partial<Node>) => setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
  const patchConfig = (id: string, key: string, value: unknown) =>
    setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, config: { ...n.config, [key]: value } } : n)) }));
  const setPort = (n: Node, p: string, target: string | null) =>
    p === 'next' ? patchNode(n.id, { next: target }) : patchNode(n.id, { branches: { ...(n.branches || {}), [p]: target } });

  const addNode = (kind: 'ACTION' | 'DELAY', action = 'CREATE_TASK') => {
    const id = newNodeId();
    const node: Node = kind === 'DELAY' ? { id, kind, config: { minutes: 60 }, next: null } : { id, kind, action, config: defaultConfig(action), next: null, ...(BRANCHING.has(action) ? { branches: {} } : {}) };
    setGraph((g) => {
      const last = g.nodes[g.nodes.length - 1];
      const nodes = g.nodes.map((n) => (last && n.id === last.id && !BRANCHING.has(String(n.action)) && n.action !== 'END_FLOW' && !n.next ? { ...n, next: id } : n));
      return { ...g, nodes: [...nodes, node], startNodeId: g.startNodeId || id };
    });
  };
  const removeNode = (id: string) =>
    setGraph((g) => ({
      ...g,
      startNodeId: g.startNodeId === id ? null : g.startNodeId,
      nodes: g.nodes
        .filter((n) => n.id !== id)
        .map((n) => ({
          ...n,
          next: n.next === id ? null : n.next,
          branches: n.branches ? Object.fromEntries(Object.entries(n.branches).map(([k, v]) => [k, v === id ? null : v])) : n.branches,
        })),
    }));
  const changeAction = (n: Node, value: string) => {
    if (value === 'DELAY') patchNode(n.id, { kind: 'DELAY', action: undefined, config: { minutes: 60 }, branches: undefined });
    else patchNode(n.id, { kind: 'ACTION', action: value, config: defaultConfig(value), branches: BRANCHING.has(value) ? {} : undefined, next: BRANCHING.has(value) || value === 'END_FLOW' ? null : n.next });
  };
  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    setGraph((g) => {
      const list = [...g.nodes];
      const from = list.findIndex((n) => n.id === dragId);
      const to = list.findIndex((n) => n.id === targetId);
      const [m] = list.splice(from, 1);
      list.splice(to, 0, m);
      return { ...g, nodes: list };
    });
    setDragId(null);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      const body = JSON.stringify({ name, description, graph });
      const r = selectedId ? await api<Def>(`/api/workflows/v2/${selectedId}`, { method: 'PUT', body }) : await api<Def>('/api/workflows/v2', { method: 'POST', body });
      if (!r.ok || !r.data) return setMsg({ tone: 'err', text: r.error || 'Erro ao salvar.' });
      setSelectedId(r.data.id);
      setValidation(r.data.validation || null);
      setSim(null);
      setMsg({ tone: 'ok', text: `Versão ${r.data.version} salva.${r.data.status === 'ACTIVE' ? ' O fluxo ativo segue na versão anterior até simular e ativar de novo.' : ''}` });
      await load();
    });
  const validate = () =>
    run(async () => {
      const r = await api<Validation>('/api/workflows/v2/validate', { method: 'POST', body: JSON.stringify({ graph }) });
      if (r.ok && r.data) setValidation(r.data);
      else setMsg({ tone: 'err', text: r.error || 'Erro ao validar.' });
    });
  const simulate = () =>
    run(async () => {
      if (!selectedId) return setMsg({ tone: 'err', text: 'Salve o fluxo antes de simular.' });
      const r = await api<{ simulation: SimStep[] & any }>(`/api/workflows/v2/${selectedId}/simulate`, { method: 'POST', body: JSON.stringify({ contactId: simContactId }) });
      if (!r.ok || !r.data) return setMsg({ tone: 'err', text: r.error || 'Erro na simulação.' });
      setSim(r.data.simulation);
      await load();
    });
  const activate = () =>
    run(async () => {
      if (!selectedId) return;
      const r = await api<Def>(`/api/workflows/v2/${selectedId}/activate`, { method: 'POST', body: '{}' });
      if (!r.ok) return setMsg({ tone: 'err', text: [r.error, ...((r.details?.errors as string[]) || [])].filter(Boolean).join(' ') });
      setMsg({ tone: 'ok', text: catalog?.liveEnabled ? 'Fluxo ativado.' : 'Fluxo ativado. A execução real está desligada (WORKFLOWS_LIVE): nada roda até ser ligada.' });
      await load();
    });
  const pause = () =>
    run(async () => {
      if (!selectedId) return;
      const r = await api<Def>(`/api/workflows/v2/${selectedId}/pause`, { method: 'POST', body: '{}' });
      setMsg(r.ok ? { tone: 'ok', text: 'Fluxo pausado. Execuções em andamento aguardam a reativação.' } : { tone: 'err', text: r.error || 'Erro.' });
      await load();
    });
  const loadRuns = () =>
    run(async () => {
      const r = await api<Run[]>(`/api/workflows/v2/contacts/${encodeURIComponent(histContactId)}/runs`);
      if (r.ok && r.data) setRuns(r.data);
      else setMsg({ tone: 'err', text: r.error || 'Erro ao carregar histórico.' });
    });
  const review = (runId: string, decision: 'CONTINUE' | 'EXIT') =>
    run(async () => {
      const r = await api(`/api/workflows/v2/runs/${runId}/review`, { method: 'POST', body: JSON.stringify({ decision }) });
      setMsg(r.ok ? { tone: 'ok', text: decision === 'CONTINUE' ? 'Execução liberada para seguir.' : 'Execução encerrada.' } : { tone: 'err', text: r.error || 'Erro.' });
      if (r.ok) {
        const h = await api<Run[]>(`/api/workflows/v2/contacts/${encodeURIComponent(histContactId)}/runs`);
        if (h.ok && h.data) setRuns(h.data);
      }
    });

  if (!catalog) return <div className="bg-white rounded-2xl border border-slate-200 p-5 text-sm text-slate-600">{msg?.text || 'Carregando automações...'}</div>;
  const simHighlight = new Set((sim?.steps || []).map((s) => s.nodeId));
  const simulatedCurrent = selected?.lastSimulation && selected.lastSimulation.version === selected.version;
  const nodeOptions = graph.nodes.map((n) => ({ id: n.id, label: `${labelOf(n)} (${n.id})` }));

  return (
    <div className="space-y-4">
      <div className={`rounded-2xl border p-4 text-xs ${catalog.liveEnabled ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
        {catalog.liveEnabled
          ? `Execução real ligada (WORKFLOWS_LIVE).${catalog.testRecipientsConfigured ? ' Restrita aos contatos de teste (WORKFLOWS_TEST_RECIPIENTS).' : ''} E-mails só saem pela fila de campanhas (modelo aprovado, LGPD e MARKETING_LIVE_SEND).`
          : 'Execução real desligada (WORKFLOWS_LIVE): monte, valide e simule à vontade; nenhum fluxo executa ações de verdade.'}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-800">Fluxos</span>
            <button type="button" className="text-xs px-3 py-1.5 rounded-lg bg-[#1e293b] text-white" onClick={() => openDef(null)}>Novo fluxo</button>
          </div>
          {defs.length === 0 && <p className="text-xs text-slate-500">Nenhum fluxo ainda.</p>}
          {defs.map((d) => (
            <button key={d.id} type="button" onClick={() => openDef(d)} className={`w-full text-left rounded-xl border px-3 py-2 text-xs ${d.id === selectedId ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'}`}>
              <div className="font-semibold text-slate-900">{d.name}</div>
              <div className="text-slate-500">
                {STATUS_LABEL[d.status]} - versão {d.version}{d.activeVersion && d.activeVersion !== d.version ? ` (ativa: ${d.activeVersion})` : ''}
              </div>
            </button>
          ))}
        </div>

        <div className="lg:col-span-3 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <label className="space-y-1">
                <span className="font-semibold text-slate-600">Nome</span>
                <input className="w-full border rounded-lg px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
              </label>
              <label className="space-y-1">
                <span className="font-semibold text-slate-600">Descrição</span>
                <input className="w-full border rounded-lg px-3 py-2" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
              </label>
              <label className="space-y-1">
                <span className="font-semibold text-slate-600">Gatilho</span>
                <select className="w-full border rounded-lg px-3 py-2" value={graph.trigger.type} onChange={(e) => setGraph((g) => ({ ...g, trigger: { type: e.target.value, config: {} } }))}>
                  {catalog.triggers.map((t) => <option key={t.id} value={t.id}>{t.label}{t.scheduled ? ' (agendado)' : ''}</option>)}
                </select>
              </label>
              <div className="space-y-1">
                <span className="font-semibold text-slate-600">Reentrada do mesmo contato</span>
                <div className="flex gap-2">
                  <select className="border rounded-lg px-3 py-2" value={graph.reentry.mode} onChange={(e) => setGraph((g) => ({ ...g, reentry: { ...g.reentry, mode: e.target.value as Graph['reentry']['mode'] } }))}>
                    <option value="NEVER">Nunca (uma vez por contato)</option>
                    <option value="AFTER_COMPLETION">Depois de concluir</option>
                    <option value="ALWAYS">Sempre (com intervalo)</option>
                  </select>
                  {graph.reentry.mode !== 'NEVER' && (
                    <input type="number" min={1} max={365} className="w-24 border rounded-lg px-2 py-2" value={graph.reentry.cooldownDays} onChange={(e) => setGraph((g) => ({ ...g, reentry: { ...g.reentry, cooldownDays: Number(e.target.value) } }))} title="Intervalo mínimo em dias" />
                  )}
                </div>
              </div>
              {(TRIGGER_FIELDS[graph.trigger.type] || []).map((f) => (
                <label key={f.key} className="space-y-1">
                  <span className="font-semibold text-slate-600">{f.label}</span>
                  <input type={f.type === 'number' ? 'number' : 'text'} className="w-full border rounded-lg px-3 py-2" value={String(graph.trigger.config[f.key] ?? '')} onChange={(e) => setGraph((g) => ({ ...g, trigger: { ...g.trigger, config: { ...g.trigger.config, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value } } }))} />
                </label>
              ))}
              <label className="space-y-1">
                <span className="font-semibold text-slate-600">Primeiro passo</span>
                <select className="w-full border rounded-lg px-3 py-2" value={graph.startNodeId || ''} onChange={(e) => setGraph((g) => ({ ...g, startNodeId: e.target.value || null }))}>
                  <option value="">(escolha)</option>
                  {nodeOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-800">Passos ({graph.nodes.length})</span>
              <div className="flex flex-wrap gap-2 text-xs">
                <select className="border rounded-lg px-2 py-1.5" value="" onChange={(e) => e.target.value && addNode(e.target.value === 'DELAY' ? 'DELAY' : 'ACTION', e.target.value)}>
                  <option value="">Adicionar passo...</option>
                  <option value="DELAY">Atraso</option>
                  {catalog.actions.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
              </div>
            </div>
            <p className="text-[11px] text-slate-500">Arraste os cartões para reorganizar a lista. As ligações (Próximo, Sim/Não, caminhos) definem a ordem real. Voltar a um passo anterior forma ciclo e é recusado.</p>
            {graph.nodes.map((n) => (
              <div
                key={n.id}
                draggable
                onDragStart={() => setDragId(n.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(n.id)}
                className={`rounded-xl border p-3 space-y-2 text-xs ${graph.startNodeId === n.id ? 'border-indigo-400' : 'border-slate-200'} ${dragId === n.id ? 'opacity-50' : ''}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="cursor-move text-slate-400 select-none" title="Arrastar">::</span>
                  <span className="font-mono text-slate-500">{n.id}</span>
                  <select className="border rounded-lg px-2 py-1" value={n.kind === 'DELAY' ? 'DELAY' : n.action} onChange={(e) => changeAction(n, e.target.value)}>
                    <option value="DELAY">Atraso</option>
                    {catalog.actions.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                  <input className="border rounded-lg px-2 py-1 flex-1 min-w-[140px]" placeholder="Rótulo (opcional)" value={n.label || ''} onChange={(e) => patchNode(n.id, { label: e.target.value })} maxLength={80} />
                  <button type="button" className="px-2 py-1 rounded-lg border border-rose-200 text-rose-700" onClick={() => removeNode(n.id)}>Remover</button>
                </div>
                {n.kind === 'DELAY' && (
                  <label className="flex items-center gap-2">
                    Aguardar
                    <input type="number" min={1} className="w-28 border rounded-lg px-2 py-1" value={n.config.minutes ?? 60} onChange={(e) => patchConfig(n.id, 'minutes', Number(e.target.value))} />
                    minutos
                  </label>
                )}
                {(n.action === 'IF_ELSE' || n.action === 'WAIT_CONDITION') && (
                  <ConditionEditor catalog={catalog} value={(n.config.condition || { field: 'leadScore', operator: 'EQUALS', value: '' }) as Cond} onChange={(c) => patchConfig(n.id, 'condition', c)} />
                )}
                {n.action === 'UPDATE_PROPERTY' && (
                  <p className="text-[11px] text-slate-500">Permitidas: {catalog.writableFields.join(', ')} ou custom.chave. Campos LGPD, e-mail e dados de ERP/Chamados são protegidos.</p>
                )}
                {(n.action === 'PERCENT_SPLIT' || n.action === 'AB_TEST') && (
                  <div className="space-y-1">
                    {((n.config.variants || []) as Variant[]).map((v, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <input className="w-16 border rounded-lg px-2 py-1 font-mono" value={v.id} onChange={(e) => patchConfig(n.id, 'variants', (n.config.variants as Variant[]).map((x, j) => (j === i ? { ...x, id: e.target.value } : x)))} />
                        <input className="flex-1 border rounded-lg px-2 py-1" value={v.label} onChange={(e) => patchConfig(n.id, 'variants', (n.config.variants as Variant[]).map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                        <input type="number" className="w-20 border rounded-lg px-2 py-1" value={v.percent} onChange={(e) => patchConfig(n.id, 'variants', (n.config.variants as Variant[]).map((x, j) => (j === i ? { ...x, percent: Number(e.target.value) } : x)))} />
                        <span>%</span>
                      </div>
                    ))}
                    <button type="button" className="px-2 py-1 rounded-lg border" onClick={() => patchConfig(n.id, 'variants', [...((n.config.variants || []) as Variant[]), { id: String.fromCharCode(97 + ((n.config.variants || []) as Variant[]).length), label: 'Novo caminho', percent: 0 }])}>
                      Adicionar caminho
                    </button>
                  </div>
                )}
                {n.kind === 'ACTION' && (ACTION_FIELDS[n.action || ''] || []).length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    {(ACTION_FIELDS[n.action || ''] || []).map((f) => (
                      <label key={f.key} className="space-y-0.5">
                        <span className="text-slate-500">{f.label}</span>
                        {f.type === 'select' ? (
                          <select className="w-full border rounded-lg px-2 py-1" value={String(n.config[f.key] ?? '')} onChange={(e) => patchConfig(n.id, f.key, e.target.value)}>
                            {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : (
                          <input type={f.type === 'number' ? 'number' : 'text'} className="w-full border rounded-lg px-2 py-1" value={String(n.config[f.key] ?? '')} onChange={(e) => patchConfig(n.id, f.key, f.type === 'number' ? Number(e.target.value) : e.target.value)} />
                        )}
                      </label>
                    ))}
                  </div>
                )}
                {portsOf(n).length > 0 && (
                  <div className="flex flex-wrap gap-3">
                    {portsOf(n).map((p) => (
                      <label key={p} className="flex items-center gap-1">
                        <span className="text-slate-500">{PORT_LABEL[p] || ((n.config.variants || []) as Variant[]).find((v) => v.id === p)?.label || p}:</span>
                        <select className="border rounded-lg px-2 py-1" value={portTarget(n, p) || ''} onChange={(e) => setPort(n, p, e.target.value || null)}>
                          <option value="">(fim do fluxo)</option>
                          {nodeOptions.filter((o) => o.id !== n.id).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div className="overflow-auto">
              <GraphView graph={graph} labelOf={labelOf} highlight={simHighlight} />
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={busy || !name.trim()} onClick={save} className="px-4 py-2 rounded-lg bg-[#1e293b] text-white disabled:opacity-50">Salvar versão</button>
              <button type="button" disabled={busy} onClick={validate} className="px-4 py-2 rounded-lg border">Validar</button>
              <span className="ml-2 text-slate-600">Contato de exemplo:</span>
              <select className="border rounded-lg px-2 py-2 max-w-[220px]" value={simContactId} onChange={(e) => setSimContactId(e.target.value)}>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
              </select>
              <button type="button" disabled={busy || !selectedId} onClick={simulate} className="px-4 py-2 rounded-lg border border-indigo-300 text-indigo-800">Simular</button>
              <button type="button" disabled={busy || !selectedId || !simulatedCurrent} onClick={activate} className="px-4 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-50" title={simulatedCurrent ? '' : 'Simule a versão atual antes de ativar'}>Ativar</button>
              {selected?.status === 'ACTIVE' && <button type="button" disabled={busy} onClick={pause} className="px-4 py-2 rounded-lg border border-amber-300 text-amber-800">Pausar</button>}
            </div>
            {msg && <div className={msg.tone === 'ok' ? 'text-emerald-700' : 'text-rose-700'}>{msg.text}</div>}
            {validation && (
              <div className="space-y-1">
                <div className={validation.ok ? 'text-emerald-700 font-semibold' : 'text-rose-700 font-semibold'}>{validation.ok ? 'Fluxo válido.' : 'O fluxo tem erros:'}</div>
                {validation.errors.map((e, i) => <div key={`e${i}`} className="text-rose-700">- {e}</div>)}
                {validation.warnings.map((w, i) => <div key={`w${i}`} className="text-amber-700">Aviso: {w}</div>)}
              </div>
            )}
            {sim && (
              <div className="space-y-1">
                <div className="font-semibold text-slate-800">Simulação (nada foi executado)</div>
                {sim.errors.map((e, i) => <div key={i} className="text-rose-700">- {e}</div>)}
                <table className="w-full text-left">
                  <thead><tr className="text-slate-500"><th className="py-1">Quando (simulado)</th><th>Passo</th><th>Resultado</th><th>Detalhe</th></tr></thead>
                  <tbody>
                    {sim.steps.map((s, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="py-1 pr-2 whitespace-nowrap">{fmt(s.at)}</td>
                        <td className="pr-2">{s.label}</td>
                        <td className={`pr-2 font-semibold ${OUTCOME_TONE[s.outcome] || ''}`}>{s.outcome}</td>
                        <td>{s.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-800">Histórico de execução por contato</span>
              <select className="border rounded-lg px-2 py-1.5 max-w-[220px]" value={histContactId} onChange={(e) => setHistContactId(e.target.value)}>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
              </select>
              <button type="button" disabled={busy} onClick={loadRuns} className="px-3 py-1.5 rounded-lg border">Ver histórico</button>
            </div>
            {runs && runs.length === 0 && <p className="text-slate-500">Nenhuma execução para este contato.</p>}
            {runs?.map((r) => (
              <div key={r.id} className={`rounded-xl border p-3 space-y-1 ${r.status === 'NEEDS_REVIEW' ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="font-semibold">{r.workflowName}</span>
                  <span className="text-slate-500">v{r.version}</span>
                  <span className="font-semibold">{STATUS_LABEL[r.status] || r.status}</span>
                  <span className="text-slate-500">início {fmt(r.startedAt)}</span>
                  {r.status === 'WAITING' && <span className="text-amber-700">retoma {fmt(r.wakeAt)}</span>}
                  {Object.keys(r.variants || {}).length > 0 && <span className="text-indigo-700">caminhos: {Object.entries(r.variants).map(([k, v]) => `${k}=${v}`).join(', ')}</span>}
                </div>
                {r.lastError && <div className="text-rose-700">{r.lastError}</div>}
                {r.status === 'NEEDS_REVIEW' && (
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="text-amber-900">A execução caiu no meio de uma ação. Confira se ela aconteceu:</span>
                    <button type="button" disabled={busy} onClick={() => review(r.id, 'CONTINUE')} className="px-3 py-1 rounded-lg border border-emerald-300 text-emerald-800">Aconteceu: seguir o fluxo</button>
                    <button type="button" disabled={busy} onClick={() => review(r.id, 'EXIT')} className="px-3 py-1 rounded-lg border border-rose-300 text-rose-800">Encerrar execução</button>
                  </div>
                )}
                <ol className="list-decimal ml-5">
                  {r.steps.map((s) => (
                    <li key={`${s.nodeId}-${s.seq}`}>
                      <span className="font-mono text-slate-500">{s.nodeId}</span> <span className={`font-semibold ${OUTCOME_TONE[s.outcome] || ''}`}>{s.outcome}</span> {s.message} <span className="text-slate-400">({fmt(s.finishedAt || s.at)})</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
