'use client';

// ============================================================================
// Fase 6 — Recursos avançados de marketing: testes A/B e multivariados (significância
// estatística, vencedor manual ou automático), otimização de horário de envio e IA comercial com
// aprovação humana obrigatória. Sem emojis. A IA nunca envia nem altera nada.
// ============================================================================
import React, { useCallback, useEffect, useState } from 'react';
import type { MarketingCampaign } from '../../db/types';
import { formatDateTimeBR } from './ui-helpers';

interface Variant { id: string; label: string; templateId: string; templateVersion: number; subjectOverride: string | null }
interface Decision { significant: boolean; winnerId: string | null; pValue: number; pairwisePValue: number; reachedSample: boolean; reason: string }
interface Experiment {
  id: string; campaignId: string; name: string; kind: 'AB' | 'MULTIVARIATE'; metric: string; variants: Variant[]; testPercent: number; alpha: number; baselineRate: number; baselineSource: string;
  minDetectableLift: number; minPerVariant: number; winnerMode: 'MANUAL' | 'AUTO'; status: string; testContacts: number; audienceSize: number; holdoutSize?: number; winnerVariantId: string | null;
  decision: Decision | null; rolloutQueued: number; rolloutBlocked: number; warnings: string[]; sendTimeOptimization: boolean; testSendAt: string | null; createdAt: string;
}
interface VariantResult { id: string; label: string; n: number; conversions: number; rate: number; queued: number; sent: number; opensObserved: number; opensMachine: number; clicksHuman: number; clicksBot: number }
interface Results { variants: VariantResult[]; decision: Decision; firstSentAt: string | null; rollout: { queued: number; sent: number } }
interface Status { aiEnabled: boolean; aiConfigured: boolean; liveEnabled: boolean; canManage: boolean; sendWindow: { startHour: number; endHour: number; weekdays: number[] }; metrics: Record<string, string>; aiKinds: Record<string, string> }
interface SendTime { at: string; localDisplay: string; source: string; sourceLabel: string; confidence: number; events: number; reason: string }
interface Suggestion {
  id: string; kind: string; status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED'; items: Array<{ text: string; rationale: string }>; summary: string | null; confidence: number; confidenceLevel: string;
  evidence: Array<{ key: string; label: string; value: string }>; caveats: string[]; model: string; createdAt: string; decidedBy: string | null;
}

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; data?: T; error?: string; problems?: string[] }> {
  try {
    const r = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: String(j?.error || `Erro ${r.status}`), problems: j?.problems };
    return { ok: true, data: j?.data as T };
  } catch {
    return { ok: false, error: 'Falha de conexão.' };
  }
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Rascunho', TESTING: 'Em teste', NEEDS_DECISION: 'Aguardando decisão', WINNER_SELECTED: 'Vencedor escolhido', COMPLETED: 'Concluído', CANCELLED: 'Cancelado',
  PENDING_APPROVAL: 'Aguardando aprovação', APPROVED: 'Aprovada', REJECTED: 'Rejeitada',
};
const CONF_TONE: Record<string, string> = { ALTA: 'text-emerald-700', MEDIA: 'text-amber-700', BAIXA: 'text-rose-700' };
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const btn = 'px-3 py-1.5 rounded-lg font-semibold disabled:opacity-40';
const input = 'w-full border border-slate-300 rounded-lg px-2 py-1.5';

export default function MarketingEnterprisePanel({ campaigns, approvedTemplates, segments }: { campaigns: MarketingCampaign[]; approvedTemplates: Array<{ id: string; name: string; version: number }>; segments: Array<{ id: string; name: string }> }) {
  const [view, setView] = useState<'AB' | 'TIME' | 'AI'>('AB');
  const [status, setStatus] = useState<Status | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const flash = (tone: 'ok' | 'err', text: string) => setMsg({ tone, text });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  // Testes A/B
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [selected, setSelected] = useState<{ experiment: Experiment; results: Results } | null>(null);
  const [form, setForm] = useState({ campaignId: campaigns[0]?.id || '', segmentId: '', mode: 'AB' as 'AB' | 'MULTI', metric: 'HUMAN_CLICK', testPercent: 20, alpha: 0.05, minDetectableLift: 0.3, winnerMode: 'MANUAL', minHoursBeforeDecision: 4, maxTestHours: 72, sendTimeOptimization: false, testSendAt: '' });
  const [variantRows, setVariantRows] = useState<Array<{ templateId: string; subjectOverride: string }>>([{ templateId: '', subjectOverride: '' }, { templateId: '', subjectOverride: '' }]);
  const [subjectsText, setSubjectsText] = useState('');
  const [multiTemplates, setMultiTemplates] = useState<string[]>([]);
  const [sample, setSample] = useState<{ perVariant: number; total: number } | null>(null);

  // Horario
  const [contactId, setContactId] = useState('');
  const [contactTime, setContactTime] = useState<SendTime | null>(null);
  const [segTimeId, setSegTimeId] = useState('');
  const [segTime, setSegTime] = useState<{ segment: SendTime; contacts: number; sources: Record<string, number>; byHour: Array<{ hour: number; count: number }> } | null>(null);

  // IA
  const [aiKind, setAiKind] = useState('SUBJECT');
  const [aiTemplate, setAiTemplate] = useState('');
  const [aiBrief, setAiBrief] = useState('');
  const [aiContact, setAiContact] = useState('');
  const [aiCompany, setAiCompany] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const loadStatus = useCallback(async () => {
    const r = await api<Status>('/api/marketing/enterprise/status');
    if (r.ok && r.data) setStatus(r.data);
  }, []);
  const loadExperiments = useCallback(async () => {
    const r = await api<Experiment[]>('/api/marketing/experiments');
    if (r.ok && r.data) setExperiments(r.data);
  }, []);
  const loadSuggestions = useCallback(async () => {
    const r = await api<Suggestion[]>('/api/marketing/ai/suggestions');
    if (r.ok && r.data) setSuggestions(r.data);
  }, []);
  useEffect(() => {
    void loadStatus();
    void loadExperiments();
  }, [loadStatus, loadExperiments]);
  useEffect(() => {
    if (view === 'AI' && status?.aiEnabled) void loadSuggestions();
  }, [view, status?.aiEnabled, loadSuggestions]);

  const openExperiment = (id: string) =>
    run(async () => {
      const r = await api<{ experiment: Experiment; results: Results }>(`/api/marketing/experiments/${id}`);
      if (!r.ok || !r.data) return flash('err', r.error || 'Falha ao abrir o teste.');
      setSelected(r.data);
    });

  const calcSample = () =>
    run(async () => {
      const k = form.mode === 'AB' ? variantRows.length : Math.max(1, subjectsText.split('\n').filter((x) => x.trim()).length) * Math.max(1, multiTemplates.length);
      const r = await api<{ perVariant: number; total: number }>('/api/marketing/experiments/sample-size', { method: 'POST', body: JSON.stringify({ baselineRate: 0.02, minDetectableLift: form.minDetectableLift, alpha: form.alpha, variants: k }) });
      if (r.ok && r.data) setSample(r.data);
    });

  const createExperiment = () =>
    run(async () => {
      const base = {
        campaignId: form.campaignId, segmentId: form.segmentId, metric: form.metric, testPercent: form.testPercent, alpha: form.alpha, minDetectableLift: form.minDetectableLift, winnerMode: form.winnerMode,
        minHoursBeforeDecision: form.minHoursBeforeDecision, maxTestHours: form.maxTestHours, sendTimeOptimization: form.sendTimeOptimization,
        testSendAt: form.testSendAt ? new Date(`${form.testSendAt}:00-03:00`).toISOString() : null,
      };
      const payload =
        form.mode === 'AB'
          ? { ...base, variants: variantRows.filter((v) => v.templateId).map((v) => ({ templateId: v.templateId, subjectOverride: v.subjectOverride || null })) }
          : { ...base, factors: { subjects: subjectsText.split('\n').map((x) => x.trim()).filter(Boolean), templateIds: multiTemplates } };
      const r = await api<Experiment>('/api/marketing/experiments', { method: 'POST', body: JSON.stringify(payload) });
      if (!r.ok || !r.data) return flash('err', r.error || 'Falha ao criar o teste.');
      flash('ok', `Teste criado com ${r.data.variants.length} variantes. Amostra mínima: ${r.data.minPerVariant} por variante.${r.data.warnings.length ? ` ${r.data.warnings.join(' ')}` : ''}`);
      await loadExperiments();
      await openExperiment(r.data.id);
    });

  const expAction = (id: string, action: 'start' | 'cancel' | 'winner', extra: Record<string, unknown> = {}) =>
    run(async () => {
      const r = await api<Record<string, unknown>>(`/api/marketing/experiments/${id}/${action}`, { method: 'POST', body: JSON.stringify(extra) });
      if (!r.ok) {
        if (action === 'winner' && /significância/.test(r.error || '') && !extra.confirmNotSignificant) {
          if (window.confirm(`${r.error}\n\nEscolher este vencedor mesmo assim?`)) {
            const again = await api<Record<string, unknown>>(`/api/marketing/experiments/${id}/winner`, { method: 'POST', body: JSON.stringify({ ...extra, confirmNotSignificant: true }) });
            if (!again.ok) return flash('err', again.error || 'Falha.');
            flash('ok', `Vencedor escolhido. Envios ao restante: ${again.data?.rolloutQueued ?? 0}.`);
          }
        } else return flash('err', `${r.error || 'Falha.'}${r.problems?.length ? ` ${r.problems.join(' ')}` : ''}`);
      } else {
        flash('ok', action === 'start' ? `Teste iniciado: ${r.data?.testContacts} no grupo de teste, ${r.data?.holdout} aguardando o vencedor.` : action === 'cancel' ? 'Teste cancelado.' : `Vencedor escolhido. Envios ao restante: ${r.data?.rolloutQueued ?? 0}.`);
      }
      await loadExperiments();
      await openExperiment(id);
    });

  const lookupContactTime = () =>
    run(async () => {
      const r = await api<SendTime>(`/api/marketing/send-time/contact/${encodeURIComponent(contactId.trim())}`);
      if (!r.ok || !r.data) return flash('err', r.error || 'Contato não encontrado.');
      setContactTime(r.data);
    });
  const lookupSegmentTime = () =>
    run(async () => {
      const r = await api<NonNullable<typeof segTime>>('/api/marketing/send-time/segment', { method: 'POST', body: JSON.stringify({ segmentId: segTimeId }) });
      if (!r.ok || !r.data) return flash('err', r.error || 'Falha.');
      setSegTime(r.data);
    });

  const askAi = () =>
    run(async () => {
      const body: Record<string, unknown> = { kind: aiKind };
      if (aiKind === 'SUBJECT' || aiKind === 'COPY') Object.assign(body, { templateId: aiTemplate || undefined, brief: aiBrief || undefined });
      if (aiKind === 'NEXT_STEP') body.contactId = aiContact.trim();
      if (aiKind === 'ACCOUNT_SUMMARY') body.companyId = aiCompany.trim();
      const r = await api<Suggestion>('/api/marketing/ai/suggest', { method: 'POST', body: JSON.stringify(body) });
      if (!r.ok || !r.data) return flash('err', r.error || 'Falha na sugestão.');
      flash('ok', 'Sugestão gerada. Revise as evidências e aprove ou rejeite antes de usar.');
      await loadSuggestions();
    });
  const decideAi = (id: string, action: 'approve' | 'reject') =>
    run(async () => {
      const r = await api<Suggestion>(`/api/marketing/ai/suggestions/${id}/${action}`, { method: 'POST', body: '{}' });
      if (!r.ok) return flash('err', r.error || 'Falha.');
      await loadSuggestions();
    });

  const res = selected?.results;
  const exp = selected?.experiment;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {([['AB', 'Testes A/B e multivariados'], ['TIME', 'Horário de envio'], ['AI', 'IA comercial (aprovação humana)']] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setView(id)} className={`${btn} ${view === id ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700'}`}>{label}</button>
        ))}
      </div>
      {msg && <div className={`rounded-lg border px-3 py-2 ${msg.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>{msg.text}</div>}

      {view === 'AB' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2 rounded-lg border border-slate-200 p-3">
            <div className="font-semibold text-slate-900">Novo teste</div>
            <p className="text-slate-500">Métrica padrão: clique humano confirmado (aberturas automáticas e cliques de robô não contam). O vencedor automático só é escolhido com significância estatística; sem ela, a decisão é sua.</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1"><span className="font-semibold">Campanha (sem envios)</span>
                <select className={input} value={form.campaignId} onChange={(e) => setForm({ ...form, campaignId: e.target.value })}>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              </label>
              <label className="space-y-1"><span className="font-semibold">Segmento</span>
                <select className={input} value={form.segmentId} onChange={(e) => setForm({ ...form, segmentId: e.target.value })}><option value="">Selecione</option>{segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              </label>
              <label className="space-y-1"><span className="font-semibold">Tipo</span>
                <select className={input} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as 'AB' | 'MULTI' })}><option value="AB">A/B (variantes)</option><option value="MULTI">Multivariado (assunto x modelo)</option></select>
              </label>
              <label className="space-y-1"><span className="font-semibold">Métrica</span>
                <select className={input} value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })}>{Object.entries(status?.metrics || { HUMAN_CLICK: 'Clique humano confirmado' }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </label>
            </div>
            {form.mode === 'AB' ? (
              <div className="space-y-1">
                {variantRows.map((v, i) => (
                  <div key={i} className="grid grid-cols-2 gap-2">
                    <select className={input} value={v.templateId} onChange={(e) => setVariantRows(variantRows.map((x, j) => (j === i ? { ...x, templateId: e.target.value } : x)))}>
                      <option value="">Variante {String.fromCharCode(65 + i)}: modelo aprovado</option>
                      {approvedTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} (v{t.version})</option>)}
                    </select>
                    <input className={input} placeholder="Assunto alternativo (opcional)" value={v.subjectOverride} onChange={(e) => setVariantRows(variantRows.map((x, j) => (j === i ? { ...x, subjectOverride: e.target.value } : x)))} />
                  </div>
                ))}
                <div className="flex gap-2">
                  <button type="button" disabled={variantRows.length >= 6} onClick={() => setVariantRows([...variantRows, { templateId: '', subjectOverride: '' }])} className={`${btn} bg-slate-100`}>Adicionar variante</button>
                  <button type="button" disabled={variantRows.length <= 2} onClick={() => setVariantRows(variantRows.slice(0, -1))} className={`${btn} bg-slate-100`}>Remover última</button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1"><span className="font-semibold">Assuntos (um por linha)</span><textarea className={input} rows={4} value={subjectsText} onChange={(e) => setSubjectsText(e.target.value)} /></label>
                <label className="space-y-1"><span className="font-semibold">Modelos aprovados</span>
                  <select multiple className={input} size={4} value={multiTemplates} onChange={(e) => setMultiTemplates([...e.target.selectedOptions].map((o) => o.value))}>{approvedTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                </label>
                <p className="col-span-2 text-slate-500">Combinações = assuntos x modelos (máximo 6).</p>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <label className="space-y-1"><span className="font-semibold">% em teste</span><input type="number" min={5} max={100} className={input} value={form.testPercent} onChange={(e) => setForm({ ...form, testPercent: Number(e.target.value) })} /></label>
              <label className="space-y-1"><span className="font-semibold">Significância (alfa)</span>
                <select className={input} value={form.alpha} onChange={(e) => setForm({ ...form, alpha: Number(e.target.value) })}><option value={0.01}>0,01</option><option value={0.05}>0,05</option><option value={0.1}>0,10</option></select>
              </label>
              <label className="space-y-1"><span className="font-semibold">Aumento mínimo (%)</span><input type="number" min={5} max={500} className={input} value={Math.round(form.minDetectableLift * 100)} onChange={(e) => setForm({ ...form, minDetectableLift: Number(e.target.value) / 100 })} /></label>
              <label className="space-y-1"><span className="font-semibold">Vencedor</span>
                <select className={input} value={form.winnerMode} onChange={(e) => setForm({ ...form, winnerMode: e.target.value })}><option value="MANUAL">Manual</option><option value="AUTO">Automático (com significância)</option></select>
              </label>
              <label className="space-y-1"><span className="font-semibold">Decidir após (h)</span><input type="number" min={1} max={72} className={input} value={form.minHoursBeforeDecision} onChange={(e) => setForm({ ...form, minHoursBeforeDecision: Number(e.target.value) })} /></label>
              <label className="space-y-1"><span className="font-semibold">Prazo máximo (h)</span><input type="number" min={4} max={336} className={input} value={form.maxTestHours} onChange={(e) => setForm({ ...form, maxTestHours: Number(e.target.value) })} /></label>
            </div>
            <label className="block space-y-1"><span className="font-semibold">Enviar o teste em (horário de Brasília, opcional)</span><input type="datetime-local" className={input} value={form.testSendAt} onChange={(e) => setForm({ ...form, testSendAt: e.target.value })} /></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.sendTimeOptimization} onChange={(e) => setForm({ ...form, sendTimeOptimization: e.target.checked })} />Otimizar horário por contato</label>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={busy} onClick={calcSample} className={`${btn} bg-slate-100`}>Calcular amostra</button>
              {sample && <span className="text-slate-600">Amostra mínima: {sample.perVariant} por variante ({sample.total} no total), com taxa de base de 2% e poder de 80%.</span>}
            </div>
            <button type="button" disabled={busy || !status?.canManage || !form.campaignId || !form.segmentId} onClick={createExperiment} className={`${btn} bg-[#1e3a6e] text-white`}>Criar teste</button>
            {!status?.canManage && <p className="text-amber-700">Criar e decidir testes exige administrador ou controle total do CRM (com 2FA).</p>}
          </div>

          <div className="space-y-2 rounded-lg border border-slate-200 p-3">
            <div className="font-semibold text-slate-900">Testes</div>
            {!experiments.length && <p className="text-slate-500">Nenhum teste criado.</p>}
            <ul className="space-y-1">
              {experiments.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => void openExperiment(e.id)} className="flex w-full justify-between rounded px-2 py-1 text-left hover:bg-slate-50">
                    <span>{e.name}</span><span className="text-slate-500">{STATUS_LABEL[e.status] || e.status}</span>
                  </button>
                </li>
              ))}
            </ul>
            {exp && res && (
              <div className="space-y-2 border-t border-slate-100 pt-2">
                <div className="font-semibold">{exp.name} - {STATUS_LABEL[exp.status]}</div>
                <p className="text-slate-600">Métrica: {status?.metrics?.[exp.metric] || exp.metric}. Amostra mínima {exp.minPerVariant} por variante (base {pct(exp.baselineRate)}: {exp.baselineSource}; aumento mínimo {Math.round(exp.minDetectableLift * 100)}%; alfa {exp.alpha}). Audiência {exp.audienceSize}; grupo de teste {exp.testContacts}; restante {exp.holdoutSize ?? 0}.</p>
                {exp.warnings.map((w, i) => <p key={i} className="text-amber-700">{w}</p>)}
                <table className="w-full">
                  <thead className="text-left text-slate-500"><tr><th>Variante</th><th className="text-right">Enviados</th><th className="text-right">Convertidos</th><th className="text-right">Taxa</th><th className="text-right">Cliques hum./robô</th><th className="text-right">Abert. obs./aut.</th><th></th></tr></thead>
                  <tbody>
                    {res.variants.map((v) => (
                      <tr key={v.id} className={`border-t border-slate-100 ${exp.winnerVariantId === v.id ? 'bg-emerald-50' : ''}`}>
                        <td className="py-1">{v.label}</td><td className="text-right">{v.n}</td><td className="text-right">{v.conversions}</td><td className="text-right">{pct(v.rate)}</td>
                        <td className="text-right">{v.clicksHuman} / {v.clicksBot}</td><td className="text-right">{v.opensObserved} / {v.opensMachine}</td>
                        <td className="text-right">{(exp.status === 'TESTING' || exp.status === 'NEEDS_DECISION') && status?.canManage && <button type="button" disabled={busy} onClick={() => void expAction(exp.id, 'winner', { variantId: v.id })} className={`${btn} bg-emerald-700 text-white`}>Vencedor</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className={res.decision.significant ? 'text-emerald-700' : 'text-slate-600'}>{res.decision.reason}</p>
                {exp.winnerVariantId && <p>Vencedor: {exp.winnerVariantId}. Envios ao restante: {exp.rolloutQueued} na fila; {exp.rolloutBlocked} bloqueado(s) por LGPD/supressão.</p>}
                <div className="flex gap-2">
                  {exp.status === 'DRAFT' && status?.canManage && <button type="button" disabled={busy} onClick={() => void expAction(exp.id, 'start')} className={`${btn} bg-[#1e3a6e] text-white`}>Iniciar teste</button>}
                  {['DRAFT', 'TESTING', 'NEEDS_DECISION'].includes(exp.status) && status?.canManage && <button type="button" disabled={busy} onClick={() => void expAction(exp.id, 'cancel')} className={`${btn} border border-slate-300`}>Cancelar teste</button>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {view === 'TIME' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2 rounded-lg border border-slate-200 p-3">
            <div className="font-semibold">Melhor horário por contato</div>
            <p className="text-slate-500">Baseado em cliques humanos, respostas e formulários (aberturas não contam), dentro da janela {status?.sendWindow.startHour ?? 8}h-{status?.sendWindow.endHour ?? 18}h em dias úteis, horário de Brasília.</p>
            <div className="flex gap-2"><input className={input} placeholder="ID do contato" value={contactId} onChange={(e) => setContactId(e.target.value)} /><button type="button" disabled={busy || !contactId.trim()} onClick={lookupContactTime} className={`${btn} bg-slate-800 text-white`}>Consultar</button></div>
            {contactTime && <div className="rounded bg-slate-50 p-2"><div className="font-semibold">{contactTime.localDisplay}</div><div>{contactTime.sourceLabel}; confiança {Math.round(contactTime.confidence * 100)}%.</div><div className="text-slate-500">{contactTime.reason}</div></div>}
          </div>
          <div className="space-y-2 rounded-lg border border-slate-200 p-3">
            <div className="font-semibold">Segmento</div>
            <div className="flex gap-2">
              <select className={input} value={segTimeId} onChange={(e) => setSegTimeId(e.target.value)}><option value="">Selecione</option>{segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              <button type="button" disabled={busy || !segTimeId} onClick={lookupSegmentTime} className={`${btn} bg-slate-800 text-white`}>Consultar</button>
            </div>
            {segTime && (
              <div className="space-y-1 rounded bg-slate-50 p-2">
                <div className="font-semibold">{segTime.segment.localDisplay}</div>
                <div>{segTime.segment.sourceLabel}; confiança {Math.round(segTime.segment.confidence * 100)}%.</div>
                <div className="text-slate-600">{segTime.contacts} contato(s): {segTime.sources.CONTATO} pelo próprio histórico, {segTime.sources.SEGMENTO} pelo segmento, {segTime.sources.BASE} pela base, {segTime.sources.PADRAO} pelo padrão.</div>
                <div className="text-slate-600">Distribuição por hora: {segTime.byHour.map((h) => `${h.hour}h: ${h.count}`).join(', ')}</div>
              </div>
            )}
            <p className="text-slate-500">Para cadências, ligue a otimização na configuração da cadência (rota de configuração; vale para o envio real da Fase 2, uma vez por passo e no máximo 24 h depois).</p>
          </div>
        </div>
      )}

      {view === 'AI' && (
        <div className="space-y-3">
          {!status?.aiEnabled ? (
            <p className="rounded border border-slate-200 bg-slate-50 p-3 text-slate-600">IA de marketing desligada neste ambiente (AI_MARKETING_ENABLED). Nenhum dado é enviado ao provedor de IA.</p>
          ) : (
            <>
              {!status.aiConfigured && <p className="text-amber-700">Provedor de IA não configurado.</p>}
              <div className="grid gap-2 rounded-lg border border-slate-200 p-3 md:grid-cols-4">
                <label className="space-y-1"><span className="font-semibold">Tipo</span><select className={input} value={aiKind} onChange={(e) => setAiKind(e.target.value)}>{Object.entries(status.aiKinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                {(aiKind === 'SUBJECT' || aiKind === 'COPY') && (
                  <>
                    <label className="space-y-1"><span className="font-semibold">Modelo base (opcional)</span><select className={input} value={aiTemplate} onChange={(e) => setAiTemplate(e.target.value)}><option value="">Nenhum</option>{approvedTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
                    <label className="space-y-1 md:col-span-2"><span className="font-semibold">Briefing (sem dados pessoais)</span><input className={input} value={aiBrief} onChange={(e) => setAiBrief(e.target.value)} /></label>
                  </>
                )}
                {aiKind === 'NEXT_STEP' && <label className="space-y-1 md:col-span-2"><span className="font-semibold">ID do contato</span><input className={input} value={aiContact} onChange={(e) => setAiContact(e.target.value)} /></label>}
                {aiKind === 'ACCOUNT_SUMMARY' && <label className="space-y-1 md:col-span-2"><span className="font-semibold">ID da empresa</span><input className={input} value={aiCompany} onChange={(e) => setAiCompany(e.target.value)} /></label>}
                <div className="flex items-end"><button type="button" disabled={busy || !status.aiConfigured} onClick={askAi} className={`${btn} bg-[#1e3a6e] text-white`}>Gerar sugestão</button></div>
              </div>
              <p className="text-slate-500">A IA recebe só dados agregados (sem nome, e-mail, telefone ou textos de resposta). Nada é enviado, agendado ou alterado pela IA: aprove a sugestão e copie o texto para usar manualmente.</p>
              <ul className="space-y-2">
                {suggestions.map((s) => (
                  <li key={s.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-semibold">{status.aiKinds[s.kind] || s.kind}</span>
                      <span>{STATUS_LABEL[s.status]} | confiança <span className={CONF_TONE[s.confidenceLevel]}>{s.confidenceLevel} ({Math.round(s.confidence * 100)}%)</span> | {formatDateTimeBR(s.createdAt)}</span>
                    </div>
                    {s.summary && <p className="mt-1">{s.summary}</p>}
                    <ol className="mt-1 list-decimal space-y-1 pl-5">
                      {s.items.map((it, i) => (
                        <li key={i}>
                          <span className="font-medium">{it.text}</span>{it.rationale && <span className="text-slate-500"> - {it.rationale}</span>}
                          {s.status === 'APPROVED' && <button type="button" onClick={() => void navigator.clipboard?.writeText(it.text)} className="ml-2 text-indigo-700 underline">Copiar</button>}
                        </li>
                      ))}
                    </ol>
                    <div className="mt-1 text-slate-600">Evidências: {s.evidence.map((e) => `${e.label}: ${e.value}`).join(' | ')}</div>
                    {s.caveats.length > 0 && <div className="text-amber-700">Limitações: {s.caveats.join(' ')}</div>}
                    {s.status === 'PENDING_APPROVAL' && (
                      <div className="mt-2 flex gap-2">
                        <button type="button" disabled={busy} onClick={() => void decideAi(s.id, 'approve')} className={`${btn} bg-emerald-700 text-white`}>Aprovar</button>
                        <button type="button" disabled={busy} onClick={() => void decideAi(s.id, 'reject')} className={`${btn} border border-slate-300`}>Rejeitar</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
