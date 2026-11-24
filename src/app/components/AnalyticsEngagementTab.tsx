'use client';

// Fase 5 — Analytics: engajamento humano confirmado x abertura observada (Apple MPP, proxies de
// imagem, scanners). Somente leitura. Drill-down ate a lista de contatos e exportacao CSV/XLSX/PDF.
// Sem emojis. Contato suprimido aparece com e-mail mascarado e o motivo da supressao.
import React, { useCallback, useEffect, useState } from 'react';

interface Group { key: string; label: string; count: number; value?: number; detail?: string }
interface Answer { id: number; question: string; headline: string; method: string; groups: Group[]; available: boolean }
interface Counters {
  sent: number; opensObserved: number; opensMachine: number; uniqueOpensObserved: number; clicksHuman: number; clicksBot: number;
  uniqueClicksHuman: number; replies: number; positiveReplies: number; meetings: number; forms: number; humanConfirmedContacts: number;
  classificationReasons: Array<{ classification: string; reason: string; count: number }>;
}
interface Scope { restricted: boolean; erpAllowed: boolean; includeSimulated: boolean; from: string; to: string }
interface Overview { scope: Scope; counters: Counters; questions: Answer[]; classLabels: Record<string, string> }
interface DrillRow { contactId: string; name: string; company: string; email: string; owner: string; lifecycleStage: string; at: string | null; detail: string; value: number | null; suppressed: boolean; suppressionReason: string | null }
interface Drill { question: string; group: Group | null; total: number; page: number; pageSize: number; rows: DrillRow[] }
interface SeqStep { stepOrder: number; subject: string; sent: number; opensObserved: number; opensMachine: number; clicksHuman: number; clicksBot: number; replies: number; exits: number; opportunities: number; replyRate: number; humanClickRate: number }
interface SeqRep { sequenceId: string; sequenceName: string; steps: SeqStep[] }
interface Variant { id: string; label: string; percent: number; runs: number; completed: number; humanEngaged: number; opportunities: number; wonValue: number; humanRate: number; opportunityRate: number }
interface Split { workflowId: string; workflowName: string; nodeId: string; nodeLabel?: string; kind: string; variants: Variant[] }
interface Cohort { cohort: string; size: number; humanEngagedPct: number[]; opportunityPct: number[] }

type View = 'PERGUNTAS' | 'CADENCIAS' | 'AB' | 'COORTES';

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

const brl = (v: number | null | undefined) => (v == null ? '-' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '-');
const todayBr = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const daysAgoBr = (n: number) => new Date(Date.now() - 3 * 3600000 - n * 86400000).toISOString().slice(0, 10);

function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-bold ${tone || 'text-slate-900'}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}

export default function AnalyticsEngagementTab() {
  const [from, setFrom] = useState(daysAgoBr(90));
  const [to, setTo] = useState(todayBr());
  const [includeSimulated, setIncludeSimulated] = useState(false);
  const [view, setView] = useState<View>('PERGUNTAS');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [seq, setSeq] = useState<SeqRep[] | null>(null);
  const [splits, setSplits] = useState<Split[] | null>(null);
  const [cohorts, setCohorts] = useState<Cohort[] | null>(null);
  const [drill, setDrill] = useState<{ q: number; group: string; data: Drill } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showReasons, setShowReasons] = useState(false);

  const qs = useCallback((extra: Record<string, string | number> = {}) => {
    const p = new URLSearchParams({ from, to, includeSimulated: includeSimulated ? '1' : '0' });
    for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
    return p.toString();
  }, [from, to, includeSimulated]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDrill(null);
    const path = view === 'PERGUNTAS' ? 'overview' : view === 'CADENCIAS' ? 'sequences' : view === 'AB' ? 'workflows' : 'cohorts';
    const r = await api<any>(`/api/analytics/${path}?${qs()}`);
    setLoading(false);
    if (!r.ok) return setError(r.error || 'Erro ao carregar.');
    if (view === 'PERGUNTAS') setOverview(r.data);
    if (view === 'CADENCIAS') setSeq(r.data.sequences);
    if (view === 'AB') setSplits(r.data.splits);
    if (view === 'COORTES') setCohorts(r.data.cohorts);
  }, [qs, view]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDrill = async (q: number, group: string, page = 1) => {
    const r = await api<Drill>(`/api/analytics/drill?${qs({ q, group, page })}`);
    if (!r.ok || !r.data) return setError(r.error || 'Erro no detalhamento.');
    setDrill({ q, group, data: r.data });
  };

  const doExport = async (format: 'csv' | 'xlsx' | 'pdf', report: string, extra: Record<string, string | number> = {}) => {
    setNotice(null);
    const r = await api<{ fileName: string; mimeType: string; base64: string; rows: number }>(`/api/analytics/export`, {
      method: 'POST',
      body: JSON.stringify({ format, report, from, to, includeSimulated: includeSimulated ? '1' : '0', ...extra }),
    });
    if (!r.ok || !r.data) return setError(r.error || 'Falha na exportação.');
    const bin = atob(r.data.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: r.data.mimeType }));
    const a = document.createElement('a');
    a.href = url;
    a.download = r.data.fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setNotice(`Arquivo ${r.data.fileName} gerado (${r.data.rows} linha(s)). A exportação fica registrada na auditoria.`);
  };

  const ExportButtons = ({ report, extra }: { report: string; extra?: Record<string, string | number> }) => (
    <div className="flex gap-1">
      {(['csv', 'xlsx', 'pdf'] as const).map((f) => (
        <button key={f} type="button" onClick={() => void doExport(f, report, extra)} className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
          {f.toUpperCase()}
        </button>
      ))}
    </div>
  );

  const c = overview?.counters;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="text-xs text-slate-600">
          De
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm" />
        </label>
        <label className="text-xs text-slate-600">
          Até
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm" />
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={includeSimulated} onChange={(e) => setIncludeSimulated(e.target.checked)} />
          Incluir registros simulados (homologação)
        </label>
        <div className="ml-auto flex gap-1 rounded-lg bg-slate-100 p-1">
          {([['PERGUNTAS', '20 perguntas'], ['CADENCIAS', 'Passos de cadência'], ['AB', 'Caminhos A/B'], ['COORTES', 'Coortes']] as Array<[View, string]>).map(([v, l]) => (
            <button key={v} type="button" onClick={() => setView(v)} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${view === v ? 'bg-[#1e293b] text-white' : 'text-slate-600'}`}>{l}</button>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-slate-500">
        Abertura nunca conta como engajamento humano: Apple Mail Privacy Protection e proxies de imagem abrem o e-mail sozinhos. Engajamento humano confirmado = clique humano provável, resposta, reunião ou formulário. Cliques de scanners e robôs (user-agent, rede conhecida, tempo muito curto após a entrega) ficam separados, com o motivo. Contratos e receita vêm do ERP somente para leitura.
      </p>
      {error && <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
      {notice && <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</div>}
      {loading && <div className="text-xs text-slate-500">Carregando...</div>}

      {view === 'PERGUNTAS' && overview && c && (
        <>
          {overview.scope.restricted && <div className="text-[11px] text-amber-700">Mostrando somente os contatos sob sua responsabilidade.</div>}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
            <Stat label="Envios" value={c.sent} />
            <Stat label="Aberturas observadas" value={c.opensObserved} hint={`${c.uniqueOpensObserved} contato(s)`} />
            <Stat label="Aberturas automáticas" value={c.opensMachine} hint="MPP, proxy, scanner" tone="text-slate-500" />
            <Stat label="Cliques humanos" value={c.clicksHuman} hint={`${c.uniqueClicksHuman} contato(s)`} tone="text-emerald-700" />
            <Stat label="Cliques de robô" value={c.clicksBot} tone="text-slate-500" />
            <Stat label="Respostas" value={c.replies} hint={`${c.positiveReplies} positiva(s)`} />
            <Stat label="Reuniões / formulários" value={`${c.meetings} / ${c.forms}`} />
            <Stat label="Humano confirmado" value={c.humanConfirmedContacts} hint="contatos" tone="text-emerald-700" />
          </div>
          <div>
            <button type="button" onClick={() => setShowReasons((s) => !s)} className="text-[11px] font-semibold text-indigo-700">
              {showReasons ? 'Ocultar' : 'Ver'} motivos de classificação
            </button>
            {showReasons && (
              <table className="mt-2 w-full max-w-3xl text-xs">
                <tbody>
                  {c.classificationReasons.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="py-1 pr-3 text-slate-600">{overview.classLabels[r.classification] || r.classification}</td>
                      <td className="py-1 pr-3">{r.reason}</td>
                      <td className="py-1 text-right font-semibold">{r.count}</td>
                    </tr>
                  ))}
                  {!c.classificationReasons.length && <tr><td className="py-1 text-slate-500">Sem sinais rastreados no período.</td></tr>}
                </tbody>
              </table>
            )}
          </div>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">As 20 perguntas</h3>
            <ExportButtons report="questions" />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {overview.questions.map((q) => (
              <div key={q.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-[11px] font-semibold text-slate-500">Pergunta {q.id}</div>
                <div className="text-sm font-semibold text-slate-900">{q.question}</div>
                <div className={`mt-1 text-xs ${q.available ? 'text-slate-700' : 'text-amber-700'}`}>{q.headline}</div>
                {q.groups.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {q.groups.slice(0, 8).map((g) => (
                      <li key={g.key}>
                        <button type="button" onClick={() => void openDrill(q.id, g.key)} className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-slate-50">
                          <span className="truncate">{g.label}{g.detail ? <span className="text-slate-500"> - {g.detail}</span> : null}</span>
                          <span className="ml-2 shrink-0 font-semibold">{g.count}{g.value != null ? ` | ${brl(g.value)}` : ''}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 text-[10px] text-slate-400">{q.method}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {drill && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-slate-900/40 p-6" role="dialog">
          <div className="w-full max-w-6xl rounded-xl bg-white p-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-slate-900">{drill.data.question}</div>
                <div className="text-xs text-slate-600">{drill.data.group?.label} - {drill.data.total} contato(s)</div>
              </div>
              <div className="flex items-center gap-2">
                <ExportButtons report="drill" extra={{ q: drill.q, group: drill.group }} />
                <button type="button" onClick={() => setDrill(null)} className="rounded border border-slate-300 px-2 py-1 text-xs">Fechar</button>
              </div>
            </div>
            <div className="mt-3 overflow-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-slate-500">
                  <tr><th className="py-1 pr-2">Contato</th><th className="pr-2">Empresa</th><th className="pr-2">E-mail</th><th className="pr-2">Proprietário</th><th className="pr-2">Etapa</th><th className="pr-2">Quando</th><th className="pr-2">Detalhe</th><th className="pr-2 text-right">Valor</th></tr>
                </thead>
                <tbody>
                  {drill.data.rows.map((r) => (
                    <tr key={r.contactId} className="border-t border-slate-100">
                      <td className="py-1 pr-2 font-semibold">{r.name || '-'}</td>
                      <td className="pr-2">{r.company || '-'}</td>
                      <td className="pr-2">{r.email}{r.suppressed && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-slate-600">{r.suppressionReason}</span>}</td>
                      <td className="pr-2">{r.owner || '-'}</td>
                      <td className="pr-2">{r.lifecycleStage || '-'}</td>
                      <td className="pr-2">{fmt(r.at)}</td>
                      <td className="pr-2">{r.detail}</td>
                      <td className="pr-2 text-right">{r.value != null ? brl(r.value) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {drill.data.total > drill.data.pageSize && (
              <div className="mt-2 flex items-center gap-2 text-xs">
                <button type="button" disabled={drill.data.page <= 1} onClick={() => void openDrill(drill.q, drill.group, drill.data.page - 1)} className="rounded border px-2 py-1 disabled:opacity-40">Anterior</button>
                <span>Página {drill.data.page} de {Math.ceil(drill.data.total / drill.data.pageSize)}</span>
                <button type="button" disabled={drill.data.page * drill.data.pageSize >= drill.data.total} onClick={() => void openDrill(drill.q, drill.group, drill.data.page + 1)} className="rounded border px-2 py-1 disabled:opacity-40">Próxima</button>
              </div>
            )}
          </div>
        </div>
      )}

      {view === 'CADENCIAS' && seq && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-bold">Conversão por passo de cadência</h3><ExportButtons report="sequences" /></div>
          {!seq.length && <div className="text-xs text-slate-500">Sem envios de cadência no período.</div>}
          {seq.map((s) => (
            <div key={s.sequenceId} className="mb-4">
              <div className="text-xs font-semibold text-slate-800">{s.sequenceName}</div>
              <table className="mt-1 w-full text-xs">
                <thead className="text-left text-slate-500"><tr><th className="py-1">Passo</th><th>Assunto</th><th className="text-right">Enviados</th><th className="text-right">Abert. obs.</th><th className="text-right">Abert. aut.</th><th className="text-right">Cliques hum.</th><th className="text-right">Cliques robô</th><th className="text-right">Respostas</th><th className="text-right">Saídas</th><th className="text-right">Oport.</th><th className="text-right">Resp. %</th><th className="text-right">Clique hum. %</th></tr></thead>
                <tbody>
                  {s.steps.map((p) => (
                    <tr key={p.stepOrder} className="border-t border-slate-100">
                      <td className="py-1">{p.stepOrder}</td><td className="max-w-xs truncate">{p.subject}</td><td className="text-right">{p.sent}</td><td className="text-right">{p.opensObserved}</td><td className="text-right text-slate-500">{p.opensMachine}</td><td className="text-right text-emerald-700">{p.clicksHuman}</td><td className="text-right text-slate-500">{p.clicksBot}</td><td className="text-right">{p.replies}</td><td className="text-right">{p.exits}</td><td className="text-right">{p.opportunities}</td><td className="text-right">{p.replyRate}</td><td className="text-right">{p.humanClickRate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {view === 'AB' && splits && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-bold">Caminhos A/B e divisões percentuais das automações</h3><ExportButtons report="workflows" /></div>
          {!splits.length && <div className="text-xs text-slate-500">Nenhuma automação com teste A/B ou divisão percentual executada no período.</div>}
          {splits.map((w) => (
            <div key={`${w.workflowId}:${w.nodeId}`} className="mb-4">
              <div className="text-xs font-semibold text-slate-800">{w.workflowName} - {w.nodeLabel || w.nodeId}</div>
              <table className="mt-1 w-full text-xs">
                <thead className="text-left text-slate-500"><tr><th className="py-1">Caminho</th><th className="text-right">%</th><th className="text-right">Execuções</th><th className="text-right">Concluídas</th><th className="text-right">Engaj. humano</th><th className="text-right">Oport.</th><th className="text-right">Ganho</th><th className="text-right">Humano %</th><th className="text-right">Oport. %</th></tr></thead>
                <tbody>
                  {w.variants.map((v) => (
                    <tr key={v.id} className="border-t border-slate-100">
                      <td className="py-1">{v.label}</td><td className="text-right">{v.percent}</td><td className="text-right">{v.runs}</td><td className="text-right">{v.completed}</td><td className="text-right">{v.humanEngaged}</td><td className="text-right">{v.opportunities}</td><td className="text-right">{brl(v.wonValue)}</td><td className="text-right">{v.humanRate}</td><td className="text-right">{v.opportunityRate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {view === 'COORTES' && cohorts && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-bold">Coortes por mês do primeiro envio (acumulado)</h3><ExportButtons report="cohorts" /></div>
          {!cohorts.length && <div className="text-xs text-slate-500">Sem envios no período.</div>}
          {cohorts.length > 0 && (
            <table className="w-full text-xs">
              <thead className="text-left text-slate-500"><tr><th className="py-1">Coorte</th><th className="text-right">Contatos</th>{[0, 1, 2, 3, 4, 5].map((m) => <th key={`e${m}`} className="text-right">Engaj. M{m}</th>)}{[0, 1, 2, 3, 4, 5].map((m) => <th key={`o${m}`} className="text-right">Oport. M{m}</th>)}</tr></thead>
              <tbody>
                {cohorts.map((k) => (
                  <tr key={k.cohort} className="border-t border-slate-100">
                    <td className="py-1">{k.cohort}</td><td className="text-right">{k.size}</td>
                    {k.humanEngagedPct.map((v, i) => <td key={`e${i}`} className="text-right">{v}%</td>)}
                    {k.opportunityPct.map((v, i) => <td key={`o${i}`} className="text-right">{v}%</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
