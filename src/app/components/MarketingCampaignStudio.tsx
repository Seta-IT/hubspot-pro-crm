'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { MarketingCampaign } from '../../db/types';
import {
  renderBlocksHtml,
  TEMPLATE_BLOCK_LABELS,
  TEMPLATE_BLOCK_TYPES,
  type TemplateBlock,
  type TemplateBlockType,
} from '../../modules/marketing/template-blocks';
import { formatDateTimeBR } from './ui-helpers';
import MarketingEnterprisePanel from './MarketingEnterprisePanel';

// ============================================================================
// Fase 3 (19/11/2026) — Estúdio de campanhas reais: modelos em blocos (arrastar e soltar para
// reordenar, versões, fluxo rascunho -> em revisão -> aprovado, envio de teste para a allowlist),
// verificação SPF/DKIM/DMARC do domínio, envio real (fila) e funil de entregabilidade. Sem emojis.
// ============================================================================

type TemplateStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED';
interface TemplateRow {
  id: string;
  name: string;
  purpose: string;
  status: TemplateStatus;
  currentVersion: number;
  approvedVersion: number | null;
  submittedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  reviewNote: string | null;
  updatedAt: string;
}
interface VersionRow {
  version: number;
  subject: string;
  preheader: string;
  blocks: TemplateBlock[];
  createdBy: string;
  createdAt: string;
}
interface DomainItem {
  ok: boolean;
  host: string;
  record: string | null;
  detail: string;
}
interface LiveStatus {
  liveEnabled: boolean;
  ready: boolean;
  problems: string[];
  provider: string | null;
  fromEmail: string | null;
  fromDomain: string | null;
  maxPerMinute: number;
  allowlistActive: boolean;
  trackingEnabled: boolean;
  domain: { pass: boolean; checkedAt: string; spf: DomainItem; dkim: DomainItem; dmarc: DomainItem & { policy: string | null }; warnings: string[] } | null;
  purposes: Array<{ id: string; label: string }>;
}
interface Funnel {
  campaignName: string;
  queued: number;
  sent: number;
  delivered: number;
  bounces: number;
  complaints: number;
  opens: number;
  clicks: number;
  unsubscribes: number;
  skipped: number;
  failed: number;
  needsReview: number;
  reviewItems: Array<{ contactId: string; email: string; reason: string | null; updatedAt: string }>;
  rates: Record<string, number>;
}

const STATUS_LABEL: Record<TemplateStatus, { label: string; tone: string }> = {
  DRAFT: { label: 'Rascunho', tone: 'bg-slate-100 text-slate-700 border-slate-200' },
  IN_REVIEW: { label: 'Em revisão', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  APPROVED: { label: 'Aprovado', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
};

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const r = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: String(j?.error || `Erro ${r.status}`) };
    return { ok: true, data: j?.data as T };
  } catch {
    return { ok: false, error: 'Falha de conexão.' };
  }
}

let blockSeq = 0;
const newBlock = (type: TemplateBlockType): TemplateBlock => ({
  id: `b${Date.now().toString(36)}${(blockSeq++).toString(36)}`,
  type,
  ...(type === 'heading' ? { text: 'Título' } : type === 'text' ? { text: 'Olá {{firstName}},' } : type === 'button' ? { text: 'Saiba mais', url: 'https://' } : type === 'image' ? { url: 'https://', alt: '' } : {}),
});

export default function MarketingCampaignStudio({ campaigns }: { campaigns: MarketingCampaign[] }) {
  const [tab, setTab] = useState<'TEMPLATES' | 'SEND' | 'DOMAIN' | 'FUNNEL' | 'ADVANCED'>('TEMPLATES');
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Editor
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('NEWSLETTER_TECNICA');
  const [subject, setSubject] = useState('');
  const [preheader, setPreheader] = useState('');
  const [blocks, setBlocks] = useState<TemplateBlock[]>([newBlock('heading'), newBlock('text')]);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [testTo, setTestTo] = useState('');
  const [rejectNote, setRejectNote] = useState('');

  // Envio real / funil
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id || '');
  const [segments, setSegments] = useState<Array<{ id: string; name: string }>>([]);
  const [segmentId, setSegmentId] = useState('');
  const [sendTemplateId, setSendTemplateId] = useState('');
  // Fase 6: agendamento (horario de Brasilia) e otimizacao de horario por contato.
  const [scheduleAt, setScheduleAt] = useState('');
  const [optimizeTime, setOptimizeTime] = useState(false);
  const [funnel, setFunnel] = useState<Funnel | null>(null);

  const editing = useMemo(() => templates.find((t) => t.id === editingId) || null, [templates, editingId]);
  const approved = templates.filter((t) => t.approvedVersion !== null);

  const loadStatus = useCallback(async (force = false) => {
    const r = await api<LiveStatus>(`/api/marketing/live-status${force ? '?forceDns=1' : ''}`);
    if (r.ok && r.data) setStatus(r.data);
  }, []);
  const loadTemplates = useCallback(async () => {
    const r = await api<TemplateRow[]>('/api/marketing/templates');
    if (r.ok && r.data) setTemplates(r.data);
  }, []);

  useEffect(() => {
    void loadStatus();
    void loadTemplates();
    api<Array<{ id: string; name: string }>>('/api/marketing/segments').then((r) => {
      if (r.ok && r.data) setSegments(r.data.map((s) => ({ id: s.id, name: s.name })));
    });
  }, [loadStatus, loadTemplates]);

  useEffect(() => {
    if (!campaignId && campaigns[0]) setCampaignId(campaigns[0].id);
  }, [campaigns, campaignId]);

  const flash = (tone: 'ok' | 'err', text: string) => setMsg({ tone, text });

  useEffect(() => {
    if (tab !== 'FUNNEL' || !campaignId) return;
    let cancelled = false;
    api<Funnel>(`/api/marketing/campaigns/${encodeURIComponent(campaignId)}/funnel`).then((r) => {
      if (!cancelled && r.ok && r.data) setFunnel(r.data);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, campaignId]);

  const openTemplate = async (id: string) => {
    const r = await api<{ template: TemplateRow; versions: VersionRow[] }>(`/api/marketing/templates/${id}`);
    if (!r.ok || !r.data) return flash('err', r.error || 'Falha ao abrir o modelo.');
    const v = r.data.versions[0];
    setEditingId(id);
    setName(r.data.template.name);
    setPurpose(r.data.template.purpose);
    setSubject(v?.subject || '');
    setPreheader(v?.preheader || '');
    setBlocks(v?.blocks || []);
    setVersions(r.data.versions);
    setMsg(null);
  };

  const newTemplate = () => {
    setEditingId(null);
    setName('');
    setPurpose('NEWSLETTER_TECNICA');
    setSubject('');
    setPreheader('');
    setBlocks([newBlock('heading'), newBlock('text')]);
    setVersions([]);
    setMsg(null);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      const payload = { name, purpose, subject, preheader, blocks };
      const r = editingId
        ? await api<{ template: TemplateRow }>(`/api/marketing/templates/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await api<{ template: TemplateRow }>('/api/marketing/templates', { method: 'POST', body: JSON.stringify(payload) });
      if (!r.ok || !r.data) return flash('err', r.error || 'Falha ao salvar.');
      await loadTemplates();
      await openTemplate(r.data.template.id);
      flash('ok', `Versão ${r.data.template.currentVersion} salva como rascunho.`);
    });

  const workflow = (action: 'submit' | 'approve' | 'reject') =>
    run(async () => {
      if (!editingId) return;
      const r = await api<TemplateRow>(`/api/marketing/templates/${editingId}/${action}`, {
        method: 'POST',
        body: JSON.stringify(action === 'reject' ? { note: rejectNote } : {}),
      });
      if (!r.ok) return flash('err', r.error || 'Falha.');
      await loadTemplates();
      await openTemplate(editingId);
      flash('ok', action === 'submit' ? 'Enviado para revisão.' : action === 'approve' ? 'Modelo aprovado.' : 'Devolvido para rascunho.');
    });

  const testSend = () =>
    run(async () => {
      if (!editingId) return;
      const r = await api(`/api/marketing/templates/${editingId}/test-send`, { method: 'POST', body: JSON.stringify({ to: testTo }) });
      flash(r.ok ? 'ok' : 'err', r.ok ? `Teste enviado para ${testTo}.` : r.error || 'Falha no teste.');
    });

  const dispatchLive = () =>
    run(async () => {
      const r = await api<{ queuedCount: number; alreadyQueuedCount: number; blockedSuppressedCount: number; scheduledAt: string | null; sendTimeOptimization: boolean }>('/api/marketing/campaigns/dispatch', {
        method: 'POST',
        body: JSON.stringify({ campaignId, templateId: sendTemplateId, segmentId, scheduleAt: scheduleAt || undefined, sendTimeOptimization: optimizeTime }),
      });
      if (!r.ok || !r.data) return flash('err', r.error || 'Envio bloqueado.');
      const when = r.data.sendTimeOptimization ? ' Horário otimizado por contato.' : r.data.scheduledAt ? ` Agendado para ${formatDateTimeBR(r.data.scheduledAt)} (horário de Brasília).` : '';
      flash('ok', `Na fila: ${r.data.queuedCount}. Já enfileirados antes: ${r.data.alreadyQueuedCount}. Bloqueados (LGPD/supressão/allowlist): ${r.data.blockedSuppressedCount}.${when}`);
    });

  const cancelScheduled = () =>
    run(async () => {
      const r = await api<{ cancelled: number }>(`/api/marketing/campaigns/${encodeURIComponent(campaignId)}/cancel-scheduled`, { method: 'POST', body: '{}' });
      if (!r.ok || !r.data) return flash('err', r.error || 'Falha ao cancelar o agendamento.');
      flash('ok', `Envios agendados cancelados: ${r.data.cancelled}.`);
    });

  const processNow = () =>
    run(async () => {
      const r = await api<{ sent: number; skipped: string | null; problems: string[]; stoppedReason: string | null }>('/api/marketing/queue/process', { method: 'POST', body: '{}' });
      if (!r.ok || !r.data) return flash('err', r.error || 'Falha ao processar a fila.');
      if (r.data.skipped) return flash('err', `Fila não processada (${r.data.skipped}). ${r.data.problems.join(' ')}`);
      flash('ok', `Enviados agora: ${r.data.sent}.${r.data.stoppedReason ? ` Pausa: ${r.data.stoppedReason}.` : ''}`);
    });

  const loadFunnel = () =>
    run(async () => {
      const r = await api<Funnel>(`/api/marketing/campaigns/${encodeURIComponent(campaignId)}/funnel`);
      if (!r.ok || !r.data) return flash('err', r.error || 'Falha ao carregar o funil.');
      setFunnel(r.data);
    });

  const resolveReview = (contactId: string, decision: 'MARK_SENT' | 'REQUEUE' | 'DISCARD') =>
    run(async () => {
      const r = await api(`/api/marketing/campaigns/${encodeURIComponent(campaignId)}/review`, { method: 'POST', body: JSON.stringify({ contactId, decision }) });
      if (!r.ok) return flash('err', r.error || 'Falha ao registrar a decisão.');
      flash('ok', decision === 'MARK_SENT' ? 'Marcado como enviado.' : decision === 'REQUEUE' ? 'Reenvio liberado: volta para a fila.' : 'Envio descartado.');
      const f = await api<Funnel>(`/api/marketing/campaigns/${encodeURIComponent(campaignId)}/funnel`);
      if (f.ok && f.data) setFunnel(f.data);
    });

  const move = (from: number, to: number) => {
    if (to < 0 || to >= blocks.length || from === to) return;
    const next = [...blocks];
    const [b] = next.splice(from, 1);
    next.splice(to, 0, b);
    setBlocks(next);
  };
  const patchBlock = (i: number, patch: Partial<TemplateBlock>) => setBlocks(blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  const readOnly = editing?.status === 'IN_REVIEW';
  const previewHtml = useMemo(() => {
    try {
      return renderBlocksHtml(blocks, { firstName: 'Maria', lastName: 'Silva', companyName: 'Empresa Exemplo' });
    } catch {
      return '';
    }
  }, [blocks]);

  const input = 'w-full border border-slate-200 rounded-md px-2 py-1.5 text-xs';
  const btn = 'px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer disabled:opacity-50';

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Campanhas reais: modelos, domínio, envio e funil</h3>
          <p className="text-slate-500">Somente modelos aprovados são enviados. Cada e-mail leva descadastro em um clique, endereço físico e respeita o consentimento por finalidade.</p>
        </div>
        <span
          className={`px-2.5 py-1 rounded-full border font-semibold ${
            status?.liveEnabled ? (status.ready ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200') : 'bg-slate-100 text-slate-700 border-slate-200'
          }`}
        >
          {status?.liveEnabled ? (status.ready ? 'Envio real ativo' : 'Envio real bloqueado') : 'Modo simulação'}
          {status?.allowlistActive ? ' (allowlist de homologação)' : ''}
        </span>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-100 pb-2">
        {(
          [
            ['TEMPLATES', 'Modelos'],
            ['SEND', 'Envio real'],
            ['DOMAIN', 'Domínio remetente'],
            ['FUNNEL', 'Funil de entregabilidade'],
            ['ADVANCED', 'Recursos avançados'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={`${btn} ${tab === id ? 'bg-[#1e3a6e] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
            {label}
          </button>
        ))}
      </div>

      {msg && (
        <div role="status" className={`rounded-md border px-3 py-2 ${msg.tone === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
          {msg.text}
        </div>
      )}

      {tab === 'TEMPLATES' && (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
          <div className="space-y-2">
            <button type="button" onClick={newTemplate} className={`${btn} w-full bg-[#1e3a6e] text-white`}>
              Novo modelo
            </button>
            {templates.length === 0 && <p className="text-slate-500">Nenhum modelo ainda.</p>}
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => openTemplate(t.id)}
                className={`w-full text-left border rounded-md px-2.5 py-2 cursor-pointer ${t.id === editingId ? 'border-[#1e3a6e] bg-slate-50' : 'border-slate-200 hover:bg-slate-50'}`}
              >
                <div className="font-semibold text-slate-900 truncate">{t.name}</div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={`px-1.5 py-0.5 rounded border ${STATUS_LABEL[t.status].tone}`}>{STATUS_LABEL[t.status].label}</span>
                  <span className="text-slate-500">
                    v{t.currentVersion}
                    {t.approvedVersion !== null ? ` (aprovada v${t.approvedVersion})` : ''}
                  </span>
                </div>
              </button>
            ))}
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="font-semibold text-slate-700">Nome</span>
                <input className={input} value={name} disabled={readOnly} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="font-semibold text-slate-700">Finalidade (consentimento LGPD)</span>
                <select className={input} value={purpose} disabled={Boolean(editingId) || readOnly} onChange={(e) => setPurpose(e.target.value)}>
                  {(status?.purposes || [{ id: 'NEWSLETTER_TECNICA', label: 'Newsletter técnica' }]).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="font-semibold text-slate-700">Assunto</span>
                <input className={input} value={subject} disabled={readOnly} onChange={(e) => setSubject(e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="font-semibold text-slate-700">Pré-cabeçalho</span>
                <input className={input} value={preheader} disabled={readOnly} onChange={(e) => setPreheader(e.target.value)} />
              </label>
            </div>
            <p className="text-slate-500">Variáveis: {'{{firstName}}'}, {'{{lastName}}'}, {'{{companyName}}'}. Arraste os blocos para reordenar. Links e imagens só com https.</p>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              <div className="space-y-2">
                {blocks.map((b, i) => (
                  <div
                    key={b.id}
                    draggable={!readOnly}
                    onDragStart={() => setDragIndex(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragIndex !== null) move(dragIndex, i);
                      setDragIndex(null);
                    }}
                    className={`border rounded-md p-2 space-y-1.5 bg-white ${dragIndex === i ? 'border-[#1e3a6e]' : 'border-slate-200'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-700 cursor-move">{TEMPLATE_BLOCK_LABELS[b.type]}</span>
                      {!readOnly && (
                        <div className="flex gap-1">
                          <button type="button" aria-label="Mover para cima" className={`${btn} bg-slate-100`} onClick={() => move(i, i - 1)}>
                            Subir
                          </button>
                          <button type="button" aria-label="Mover para baixo" className={`${btn} bg-slate-100`} onClick={() => move(i, i + 1)}>
                            Descer
                          </button>
                          <button type="button" className={`${btn} bg-rose-50 text-rose-700`} onClick={() => setBlocks(blocks.filter((_, j) => j !== i))}>
                            Remover
                          </button>
                        </div>
                      )}
                    </div>
                    {(b.type === 'heading' || b.type === 'button') && (
                      <input className={input} value={b.text || ''} disabled={readOnly} onChange={(e) => patchBlock(i, { text: e.target.value })} placeholder="Texto" />
                    )}
                    {b.type === 'text' && (
                      <textarea className={input} rows={4} value={b.text || ''} disabled={readOnly} onChange={(e) => patchBlock(i, { text: e.target.value })} />
                    )}
                    {(b.type === 'button' || b.type === 'image') && (
                      <input className={input} value={b.url || ''} disabled={readOnly} onChange={(e) => patchBlock(i, { url: e.target.value })} placeholder="https://" />
                    )}
                    {b.type === 'image' && (
                      <input className={input} value={b.alt || ''} disabled={readOnly} onChange={(e) => patchBlock(i, { alt: e.target.value })} placeholder="Texto alternativo" />
                    )}
                  </div>
                ))}
                {!readOnly && (
                  <div className="flex flex-wrap gap-1.5">
                    {TEMPLATE_BLOCK_TYPES.map((t) => (
                      <button key={t} type="button" className={`${btn} bg-slate-100 text-slate-700 hover:bg-slate-200`} onClick={() => setBlocks([...blocks, newBlock(t)])}>
                        + {TEMPLATE_BLOCK_LABELS[t]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="border border-slate-200 rounded-md p-3 bg-slate-50">
                <div className="font-semibold text-slate-700 mb-2">Pré-visualização</div>
                <div className="bg-white border border-slate-200 rounded p-3 text-[13px]" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                <p className="text-slate-500 mt-2">O rodapé com descadastro e endereço físico é acrescentado automaticamente no envio.</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              <button type="button" disabled={busy || readOnly} onClick={save} className={`${btn} bg-[#1e3a6e] text-white`}>
                Salvar rascunho
              </button>
              {editing?.status === 'DRAFT' && (
                <button type="button" disabled={busy} onClick={() => workflow('submit')} className={`${btn} bg-amber-100 text-amber-900`}>
                  Enviar para revisão
                </button>
              )}
              {editing?.status === 'IN_REVIEW' && (
                <>
                  <button type="button" disabled={busy} onClick={() => workflow('approve')} className={`${btn} bg-emerald-600 text-white`}>
                    Aprovar
                  </button>
                  <input className="border border-slate-200 rounded-md px-2 py-1.5 text-xs" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="Motivo da devolução" />
                  <button type="button" disabled={busy} onClick={() => workflow('reject')} className={`${btn} bg-rose-50 text-rose-700`}>
                    Devolver
                  </button>
                </>
              )}
              {editingId && (
                <>
                  <input className="border border-slate-200 rounded-md px-2 py-1.5 text-xs" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="E-mail da allowlist de teste" />
                  <button type="button" disabled={busy || !testTo} onClick={testSend} className={`${btn} bg-slate-100 text-slate-700`}>
                    Enviar teste
                  </button>
                </>
              )}
            </div>
            {editing?.reviewNote && <p className="text-amber-800">Revisão: {editing.reviewNote}</p>}
            {editing?.approvedBy && (
              <p className="text-slate-500">
                Aprovado por {editing.approvedBy} em {formatDateTimeBR(editing.approvedAt)} (versão {editing.approvedVersion}).
              </p>
            )}
            {versions.length > 0 && (
              <details>
                <summary className="cursor-pointer font-semibold text-slate-700">Histórico de versões ({versions.length})</summary>
                <ul className="mt-1 space-y-0.5 text-slate-600">
                  {versions.map((v) => (
                    <li key={v.version}>
                      v{v.version} - {v.subject} - {v.createdBy} - {formatDateTimeBR(v.createdAt)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      )}

      {tab === 'SEND' && (
        <div className="space-y-3 max-w-xl">
          {status && status.problems.length > 0 && (
            <div className="rounded-md border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2">
              <div className="font-semibold">Envio real bloqueado:</div>
              <ul className="list-disc ml-4">
                {status.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          <label className="block space-y-1">
            <span className="font-semibold text-slate-700">Campanha</span>
            <select className={input} value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="font-semibold text-slate-700">Modelo aprovado</span>
            <select className={input} value={sendTemplateId} onChange={(e) => setSendTemplateId(e.target.value)}>
              <option value="">Selecione</option>
              {approved.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} (v{t.approvedVersion})
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="font-semibold text-slate-700">Segmento</span>
            <select className={input} value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>
              <option value="">Selecione</option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="font-semibold text-slate-700">Agendar para (horário de Brasília, opcional)</span>
            <input type="datetime-local" className={input} value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-slate-700">
            <input type="checkbox" checked={optimizeTime} onChange={(e) => setOptimizeTime(e.target.checked)} />
            Otimizar horário por contato (engajamento humano, janela comercial; sem dados usa segmento, base ou 10h em dia útil)
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || !status?.ready || !sendTemplateId || !segmentId} onClick={dispatchLive} className={`${btn} bg-[#1e3a6e] text-white`}>
              {scheduleAt || optimizeTime ? 'Agendar envio' : 'Colocar na fila de envio'}
            </button>
            <button type="button" disabled={busy || !campaignId} onClick={cancelScheduled} className={`${btn} bg-white border border-slate-300 text-slate-700`}>
              Cancelar envios agendados
            </button>
            <button type="button" disabled={busy || !status?.ready} onClick={processNow} className={`${btn} bg-slate-100 text-slate-700`}>
              Processar fila agora
            </button>
          </div>
          <p className="text-slate-500">
            A fila sai em até {status?.maxPerMinute ?? 60} e-mails por minuto (cron a cada 5 minutos). Cada contato recebe no máximo um e-mail por campanha. Contatos sem consentimento para a finalidade, suprimidos ou fora da allowlist são bloqueados.
          </p>
        </div>
      )}

      {tab === 'DOMAIN' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-slate-700">
              Domínio remetente: <strong>{status?.fromDomain || 'não configurado'}</strong>
            </span>
            <button type="button" disabled={busy} onClick={() => run(() => loadStatus(true))} className={`${btn} bg-slate-100 text-slate-700`}>
              Verificar agora
            </button>
          </div>
          {status?.domain ? (
            <>
              <table className="w-full text-left border border-slate-200 rounded">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="p-2">Registro</th>
                    <th className="p-2">Situação</th>
                    <th className="p-2">Host</th>
                    <th className="p-2">Detalhe</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ['SPF', status.domain.spf],
                      ['DKIM', status.domain.dkim],
                      ['DMARC', status.domain.dmarc],
                    ] as const
                  ).map(([k, item]) => (
                    <tr key={k} className="border-t border-slate-100">
                      <td className="p-2 font-semibold">{k}</td>
                      <td className={`p-2 font-semibold ${item.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{item.ok ? 'OK' : 'Falhou'}</td>
                      <td className="p-2 font-mono">{item.host}</td>
                      <td className="p-2">{item.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {status.domain.warnings.map((w) => (
                <p key={w} className="text-amber-800">
                  {w}
                </p>
              ))}
              <p className={status.domain.pass ? 'text-emerald-700' : 'text-rose-700'}>
                {status.domain.pass ? 'Domínio autenticado: envio real liberado por este critério.' : 'Envio real bloqueado até o domínio passar em SPF, DKIM e DMARC.'} Verificado em {formatDateTimeBR(status.domain.checkedAt)}.
              </p>
            </>
          ) : (
            <p className="text-slate-500">Configure MARKETING_FROM_EMAIL para verificar o domínio.</p>
          )}
        </div>
      )}

      {tab === 'FUNNEL' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <select className="border border-slate-200 rounded-md px-2 py-1.5 text-xs" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button type="button" disabled={busy || !campaignId} onClick={loadFunnel} className={`${btn} bg-slate-100 text-slate-700`}>
              Atualizar funil
            </button>
          </div>
          {funnel && (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
              {(
                [
                  ['Enviados', funnel.sent, null],
                  ['Entregues', funnel.delivered, funnel.rates.delivery],
                  ['Bounces', funnel.bounces, funnel.rates.bounce],
                  ['Reclamações', funnel.complaints, funnel.rates.complaint],
                  ['Aberturas', funnel.opens, funnel.rates.open],
                  ['Cliques', funnel.clicks, funnel.rates.click],
                  ['Descadastros', funnel.unsubscribes, funnel.rates.unsubscribe],
                ] as const
              ).map(([label, n, rate]) => (
                <div key={label} className="border border-slate-200 rounded-md p-2.5">
                  <div className="text-slate-500">{label}</div>
                  <div className="text-lg font-semibold text-slate-900">{n}</div>
                  {rate !== null && <div className="text-slate-500">{rate}%</div>}
                </div>
              ))}
            </div>
          )}
          {funnel && funnel.needsReview > 0 && (
            <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 space-y-2">
              <div className="font-semibold">Envios para revisar ({funnel.needsReview})</div>
              <p>
                O envio foi interrompido no meio e pode ou não ter saído. Confira no painel do provedor antes de decidir. O sistema não reenvia sozinho; uma tarefa foi criada na fila
                &quot;Campanhas de Marketing&quot;.
              </p>
              <ul className="space-y-1">
                {funnel.reviewItems.map((it) => (
                  <li key={it.contactId} className="flex flex-wrap items-center gap-2">
                    <span className="font-mono">{it.email}</span>
                    <span className="text-amber-800">{formatDateTimeBR(it.updatedAt)}</span>
                    <button type="button" disabled={busy} onClick={() => resolveReview(it.contactId, 'MARK_SENT')} className={`${btn} bg-white border border-amber-300`}>
                      Saiu: marcar como enviado
                    </button>
                    <button type="button" disabled={busy} onClick={() => resolveReview(it.contactId, 'REQUEUE')} className={`${btn} bg-white border border-amber-300`}>
                      Não saiu: liberar reenvio
                    </button>
                    <button type="button" disabled={busy} onClick={() => resolveReview(it.contactId, 'DISCARD')} className={`${btn} bg-white border border-amber-300`}>
                      Descartar
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {funnel && (
            <p className="text-slate-500">
              Na fila: {funnel.queued}. Ignorados na hora do envio (consentimento/supressão): {funnel.skipped}. Falhas: {funnel.failed}.
            </p>
          )}
        </div>
      )}
      {tab === 'ADVANCED' && <MarketingEnterprisePanel campaigns={campaigns} approvedTemplates={approved.map((t) => ({ id: t.id, name: t.name, version: t.approvedVersion! }))} segments={segments} />}
    </div>
  );
}
