'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Copy, Download, Plus, Search, ShieldAlert, X } from 'lucide-react';
import type { MarketingEmailBroadcast } from '../../db/types';

// ============================================================================
// Marketing — E-mails de marketing (listagem estilo HubSpot, dados reais de
// /api/marketing/emails): abas Gerenciar / Modelos / Analisar / Integridade,
// filtros por status, busca, exportação CSV, criação e clonagem.
// ============================================================================

type EmailStatusFilter = 'ALL' | 'DRAFT' | 'SCHEDULED' | 'SENT' | 'ARCHIVED';
type EmailTab = 'MANAGE' | 'TEMPLATES' | 'ANALYZE' | 'HEALTH';

const STATUS_LABEL: Record<MarketingEmailBroadcast['status'], string> = {
  SENT: 'Enviado',
  DRAFT: 'Rascunho',
  SCHEDULED: 'Programado',
  ARCHIVED: 'Arquivado',
};

const STATUS_TONE: Record<MarketingEmailBroadcast['status'], string> = {
  SENT: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-200',
  SCHEDULED: 'bg-blue-50 text-blue-800 border-blue-200',
  ARCHIVED: 'bg-amber-50 text-amber-800 border-amber-200',
};

const TYPE_LABEL: Record<MarketingEmailBroadcast['emailType'], string> = {
  REGULAR: 'Regular',
  AUTOMATED: 'Automatizado',
  FOLLOW_UP: 'Acompanhamento',
  ABM_CAMPAIGN: 'Campanha ABM',
};

const EMAIL_TEMPLATES: Array<{
  id: string;
  name: string;
  subject: string;
  preheader: string;
  emailType: MarketingEmailBroadcast['emailType'];
  bodyPreview: string;
}> = [
  {
    id: 'tpl-locacao',
    name: 'Modelo — Locação de Infraestrutura TI & Telecom',
    subject: 'Substitua CAPEX por locação: servidores, switches e PABX IP para {{companyName}}',
    preheader: 'Locação pura com SLA NOC 24x7 e 0% de ISSQN (SV 31 STF).',
    emailType: 'REGULAR',
    bodyPreview:
      'Olá {{firstName}}, a Seta Telecom apoia a {{companyName}} na renovação do parque tecnológico com locação pura e contrato de Spare Parts.',
  },
  {
    id: 'tpl-spare-parts',
    name: 'Modelo — Contrato de Spare Parts',
    subject: 'Reposição avançada de hardware em até 4h para {{companyName}}',
    preheader: 'Continuidade operacional para ativos de missão crítica.',
    emailType: 'ABM_CAMPAIGN',
    bodyPreview:
      'Olá {{firstName}}, como a {{companyName}} garante hoje a reposição de servidores e ativos de rede fora de garantia?',
  },
  {
    id: 'tpl-follow-up',
    name: 'Modelo — Acompanhamento de cotação',
    subject: 'Sua cotação Seta Telecom: próximos passos',
    preheader: 'Retomando sua solicitação de cotação.',
    emailType: 'FOLLOW_UP',
    bodyPreview: 'Olá {{firstName}}, preparamos a proposta solicitada. Podemos agendar 15 minutos para revisar?',
  },
  {
    id: 'tpl-renovacao',
    name: 'Modelo — Renovação de contrato',
    subject: 'Renovação do seu contrato de locação — condições especiais',
    preheader: 'Atualize equipamentos e mantenha o SLA.',
    emailType: 'REGULAR',
    bodyPreview: 'Olá {{firstName}}, o contrato da {{companyName}} se aproxima da renovação. Veja as opções de upgrade.',
  },
];

function fmtPct(n: number): string {
  return `${(Number(n) || 0).toFixed(2).replace('.', ',')}%`;
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildMarketingEmailsCsv(rows: MarketingEmailBroadcast[]): string {
  const header = [
    'Nome',
    'Status',
    'Tipo',
    'Entregue',
    'Taxa de abertura',
    'Taxa de cliques',
    'Última atualização',
    'Atualizado por',
    'Data de envio',
  ];
  const lines = rows.map((e) =>
    [
      e.name,
      STATUS_LABEL[e.status],
      TYPE_LABEL[e.emailType] || e.emailType,
      e.deliveredCount,
      fmtPct(e.openRatePercent),
      fmtPct(e.clickRatePercent),
      e.updatedAtDisplay,
      e.updatedBy,
      e.publishedAtDisplay,
    ]
      .map(csvCell)
      .join(';')
  );
  return '\uFEFF' + [header.join(';'), ...lines].join('\n');
}

/** Verificações de integridade (conteúdo e roteamento de envio) por e-mail. */
export function checkMarketingEmailHealth(e: MarketingEmailBroadcast): string[] {
  const issues: string[] = [];
  if (!e.subject || e.subject.trim().length < 8) issues.push('Assunto ausente ou muito curto');
  if (e.subject && e.subject.length > 90) issues.push('Assunto longo (mais de 90 caracteres)');
  if (!e.preheader || !e.preheader.trim()) issues.push('Sem pré-cabeçalho (preheader)');
  if (/\(Clonar\)/i.test(e.name)) issues.push('Nome ainda marcado como cópia "(Clonar)"');
  if (/-$/.test(e.name.trim())) issues.push('Nome truncado');
  if (e.status === 'SENT' && e.deliveredCount === 0) issues.push('Enviado sem entregas registradas');
  if (e.sendingProvider === 'OUTLOOK_M365' && (e.emailType === 'REGULAR' || e.emailType === 'ABM_CAMPAIGN'))
    issues.push('Envio em massa roteado pelo Outlook/M365 (usar provedor de marketing)');
  if (!e.campaignId) issues.push('Sem campanha vinculada (atribuição de receita)');
  return issues;
}

export default function MarketingEmailsManager({
  onCountChange,
}: {
  onCountChange?: (count: number) => void;
}) {
  const [emails, setEmails] = useState<MarketingEmailBroadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<EmailTab>('MANAGE');
  const [statusFilter, setStatusFilter] = useState<EmailStatusFilter>('ALL');
  const [query, setQuery] = useState('');
  const [banner, setBanner] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSubject, setNewSubject] = useState('');
  const [newPreheader, setNewPreheader] = useState('');
  const [newType, setNewType] = useState<MarketingEmailBroadcast['emailType']>('REGULAR');
  const [newProvider, setNewProvider] = useState<MarketingEmailBroadcast['sendingProvider']>('MARKETING_ESP');
  const [newBody, setNewBody] = useState('');
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/marketing/emails', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(json?.error || `Falha HTTP ${res.status}`);
        return;
      }
      const list: MarketingEmailBroadcast[] = Array.isArray(json.data) ? json.data : [];
      setEmails(list);
      setLoadError(null);
      onCountChange?.(list.length);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Falha de rede.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(
    () => ({
      ALL: emails.length,
      DRAFT: emails.filter((e) => e.status === 'DRAFT').length,
      SCHEDULED: emails.filter((e) => e.status === 'SCHEDULED').length,
      SENT: emails.filter((e) => e.status === 'SENT').length,
      ARCHIVED: emails.filter((e) => e.status === 'ARCHIVED').length,
    }),
    [emails]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return emails.filter(
      (e) =>
        (statusFilter === 'ALL' || e.status === statusFilter) &&
        (!q ||
          e.name.toLowerCase().includes(q) ||
          (e.subject || '').toLowerCase().includes(q) ||
          (e.updatedBy || '').toLowerCase().includes(q))
    );
  }, [emails, statusFilter, query]);

  const exportCsv = () => {
    const csv = buildMarketingEmailsCsv(filtered);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `emails-marketing-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setBanner(`${filtered.length} e-mail(s) exportado(s) em CSV.`);
  };

  const createEmail = async (payload: Partial<MarketingEmailBroadcast> & { name: string }) => {
    const res = await fetch('/api/marketing/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'DRAFT', ...payload }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || `Falha HTTP ${res.status}`);
    return json.data as MarketingEmailBroadcast;
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const created = await createEmail({
        name: newName.trim(),
        subject: newSubject.trim() || newName.trim(),
        preheader: newPreheader.trim() || undefined,
        emailType: newType,
        sendingProvider: newProvider,
        bodyPreview: newBody.trim() || undefined,
      });
      setBanner(`Rascunho "${created.name}" criado.`);
      setShowCreate(false);
      setNewName('');
      setNewSubject('');
      setNewPreheader('');
      setNewBody('');
      setTab('MANAGE');
      setStatusFilter('ALL');
      await load();
    } catch (err) {
      setBanner(err instanceof Error ? `Erro: ${err.message}` : 'Erro ao criar e-mail.');
    } finally {
      setCreating(false);
    }
  };

  const handleClone = async (email: MarketingEmailBroadcast) => {
    setBusyId(email.id);
    try {
      const res = await fetch('/api/marketing/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'CLONE', emailId: email.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Falha HTTP ${res.status}`);
      setBanner(`E-mail clonado como rascunho: "${json.data?.name}".`);
      await load();
    } catch (err) {
      setBanner(err instanceof Error ? `Erro: ${err.message}` : 'Erro ao clonar.');
    } finally {
      setBusyId(null);
    }
  };

  const applyTemplate = (tpl: (typeof EMAIL_TEMPLATES)[number]) => {
    setNewName(tpl.name.replace(/^Modelo — /, ''));
    setNewSubject(tpl.subject);
    setNewPreheader(tpl.preheader);
    setNewType(tpl.emailType);
    setNewProvider('MARKETING_ESP');
    setNewBody(tpl.bodyPreview);
    setShowCreate(true);
  };

  const sent = emails.filter((e) => e.status === 'SENT');
  const totalDelivered = sent.reduce((s, e) => s + (e.deliveredCount || 0), 0);
  const weightedOpen =
    totalDelivered > 0 ? sent.reduce((s, e) => s + e.openRatePercent * e.deliveredCount, 0) / totalDelivered : 0;
  const weightedClick =
    totalDelivered > 0 ? sent.reduce((s, e) => s + e.clickRatePercent * e.deliveredCount, 0) / totalDelivered : 0;
  const topByOpen = [...sent].filter((e) => e.deliveredCount > 0).sort((a, b) => b.openRatePercent - a.openRatePercent).slice(0, 5);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-2xs text-xs" data-testid="marketing-emails-manager">
      {/* CABECALHO */}
      <div className="px-5 pt-4 pb-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
        <div>
          <span className="text-[10px] font-semibold uppercase text-[#e05835] block">Marketing</span>
          <h3 className="text-lg font-semibold text-slate-900">
            {loading && emails.length === 0 ? 'E-mails de marketing' : `${emails.length} E-mails de marketing`}
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" /> Exportar CSV
          </button>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white font-semibold"
          >
            <Plus className="w-3.5 h-3.5" /> Criar e-mail
          </button>
        </div>
      </div>

      {/* ABAS */}
      <div className="px-5 flex flex-wrap items-center gap-1 border-b border-slate-200">
        {(
          [
            ['MANAGE', 'Gerenciar'],
            ['TEMPLATES', 'Modelos'],
            ['ANALYZE', 'Analisar'],
            ['HEALTH', 'Integridade'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-3.5 py-2.5 font-semibold border-b-2 -mb-px transition ${
              tab === id ? 'border-[#ff7a59] text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {banner && (
        <div className="mx-5 mt-3 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 font-semibold flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            {banner}
          </span>
          <button type="button" onClick={() => setBanner(null)} className="text-emerald-700">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {loadError && (
        <div className="mx-5 mt-3 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 font-semibold">
          Não foi possível carregar os e-mails de marketing: {loadError}
        </div>
      )}

      {/* GERENCIAR */}
      {tab === 'MANAGE' && (
        <div className="p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  ['ALL', 'Todos os e-mails'],
                  ['DRAFT', 'Rascunhos'],
                  ['SCHEDULED', 'Programados'],
                  ['SENT', 'Enviados'],
                  ['ARCHIVED', 'Arquivada'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setStatusFilter(id)}
                  className={`px-3 py-1.5 rounded-md font-semibold transition ${
                    statusFilter === id ? 'bg-[#1e293b] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {label} ({counts[id]})
                </button>
              ))}
            </div>
            <label className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Pesquisar e-mails"
                className="pl-8 pr-3 py-1.5 rounded-md border border-slate-300 w-56"
              />
            </label>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">Nome</th>
                  <th className="py-2.5 px-3 text-right">Entregue</th>
                  <th className="py-2.5 px-3 text-right">Taxa de abertura</th>
                  <th className="py-2.5 px-3 text-right">Taxa de cliques</th>
                  <th className="py-2.5 px-3">Última atualização</th>
                  <th className="py-2.5 px-3">Atualizado por</th>
                  <th className="py-2.5 px-3">Data de envio</th>
                  <th className="py-2.5 px-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 max-w-[340px]">
                      <div className="font-semibold text-[#0d2b4e] truncate" title={e.name}>
                        {e.name}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${STATUS_TONE[e.status]}`}>
                          {STATUS_LABEL[e.status]}
                        </span>
                        <span className="text-[10px] text-slate-500">{TYPE_LABEL[e.emailType] || e.emailType}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold">{(e.deliveredCount || 0).toLocaleString('pt-BR')}</td>
                    <td className="py-2.5 px-3 text-right">{fmtPct(e.openRatePercent)}</td>
                    <td className="py-2.5 px-3 text-right">{fmtPct(e.clickRatePercent)}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap">{e.updatedAtDisplay}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap">{e.updatedBy || '--'}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap">{e.publishedAtDisplay || '--'}</td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        disabled={busyId === e.id}
                        onClick={() => handleClone(e)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 font-semibold text-slate-700 hover:bg-white disabled:opacity-50"
                      >
                        <Copy className="w-3 h-3" /> {busyId === e.id ? 'Clonando...' : 'Clonar'}
                      </button>
                    </td>
                  </tr>
                ))}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500">
                      Nenhum e-mail encontrado para este filtro.
                    </td>
                  </tr>
                )}
                {loading && emails.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500">
                      Carregando e-mails de marketing...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="text-[11px] text-slate-500">
            Exibindo {filtered.length} de {emails.length} e-mails.
          </div>
        </div>
      )}

      {/* MODELOS */}
      {tab === 'TEMPLATES' && (
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
          {EMAIL_TEMPLATES.map((tpl) => (
            <div key={tpl.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-1.5">
              <div className="font-semibold text-slate-900">{tpl.name}</div>
              <div className="text-[11px] text-slate-600">Assunto: {tpl.subject}</div>
              <div className="text-[11px] text-slate-500">{tpl.bodyPreview}</div>
              <button
                type="button"
                onClick={() => applyTemplate(tpl)}
                className="mt-1 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#1e3a6e] text-white font-semibold"
              >
                <Plus className="w-3.5 h-3.5" /> Usar modelo
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ANALISAR */}
      {tab === 'ANALYZE' && (
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-slate-500 block">E-mails enviados</span>
              <strong className="text-xl font-semibold text-slate-900">{sent.length}</strong>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-slate-500 block">Total entregue</span>
              <strong className="text-xl font-semibold text-slate-900">{totalDelivered.toLocaleString('pt-BR')}</strong>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-slate-500 block">Abertura média (ponderada)</span>
              <strong className="text-xl font-semibold text-emerald-700">{fmtPct(weightedOpen)}</strong>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-slate-500 block">Cliques médios (ponderados)</span>
              <strong className="text-xl font-semibold text-[#0091ae]">{fmtPct(weightedClick)}</strong>
            </div>
          </div>
          <div className="p-4 rounded-xl border border-slate-200 space-y-2">
            <h4 className="font-semibold text-slate-900">Melhores e-mails por taxa de abertura</h4>
            {topByOpen.length === 0 && <p className="text-slate-500">Sem envios com entregas registradas.</p>}
            {topByOpen.map((e) => (
              <div key={e.id} className="space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold text-slate-800" title={e.name}>{e.name}</span>
                  <span className="shrink-0 text-slate-600">
                    {fmtPct(e.openRatePercent)} abertura | {fmtPct(e.clickRatePercent)} cliques | {e.deliveredCount} entregues
                  </span>
                </div>
                <div className="h-1.5 rounded bg-slate-100 overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, e.openRatePercent)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* INTEGRIDADE */}
      {tab === 'HEALTH' && (
        <div className="p-5 space-y-2">
          <p className="text-slate-500">
            Verificações de conteúdo e roteamento: assunto, pré-cabeçalho, nome, campanha vinculada e separação entre Outlook/M365 (1:1) e provedor de marketing (massa).
          </p>
          {emails.map((e) => {
            const issues = checkMarketingEmailHealth(e);
            return (
              <div
                key={e.id}
                className={`p-3 rounded-lg border flex flex-wrap items-start justify-between gap-2 ${
                  issues.length === 0 ? 'border-emerald-200 bg-emerald-50/40' : 'border-amber-200 bg-amber-50/40'
                }`}
              >
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 truncate">{e.name}</div>
                  {issues.length > 0 && (
                    <ul className="mt-1 text-[11px] text-amber-900 list-disc pl-4">
                      {issues.map((i) => (
                        <li key={i}>{i}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <span
                  className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${
                    issues.length === 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'
                  }`}
                >
                  {issues.length === 0 ? (
                    <>
                      <CheckCircle2 className="w-3 h-3" /> Íntegro
                    </>
                  ) : (
                    <>
                      <ShieldAlert className="w-3 h-3" /> {issues.length} alerta(s)
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL CRIAR */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-slate-900">Criar e-mail de marketing (rascunho)</h4>
              <button type="button" onClick={() => setShowCreate(false)} className="text-slate-500 hover:text-slate-900">
                <X className="w-4 h-4" />
              </button>
            </div>
            <input type="text" required value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nome interno do e-mail *" className="w-full px-3 py-2 rounded border border-slate-300" />
            <input type="text" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} placeholder="Assunto" className="w-full px-3 py-2 rounded border border-slate-300" />
            <input type="text" value={newPreheader} onChange={(e) => setNewPreheader(e.target.value)} placeholder="Pré-cabeçalho (preheader)" className="w-full px-3 py-2 rounded border border-slate-300" />
            <div className="grid grid-cols-2 gap-2">
              <select value={newType} onChange={(e) => setNewType(e.target.value as MarketingEmailBroadcast['emailType'])} className="px-3 py-2 rounded border border-slate-300 bg-white">
                {Object.entries(TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <select value={newProvider} onChange={(e) => setNewProvider(e.target.value as MarketingEmailBroadcast['sendingProvider'])} className="px-3 py-2 rounded border border-slate-300 bg-white">
                <option value="MARKETING_ESP">Provedor de marketing (ESP)</option>
                <option value="OUTLOOK_M365">Outlook / M365 (1:1)</option>
              </select>
            </div>
            <textarea rows={3} value={newBody} onChange={(e) => setNewBody(e.target.value)} placeholder="Prévia do corpo" className="w-full px-3 py-2 rounded border border-slate-300" />
            <p className="text-[11px] text-slate-500">O e-mail é salvo como rascunho. Nenhum envio é disparado nesta etapa.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg border border-slate-300 font-semibold text-slate-700">
                Cancelar
              </button>
              <button type="submit" disabled={creating} className="px-4 py-2 rounded-lg bg-[#ff7a59] text-white font-semibold disabled:opacity-50">
                {creating ? 'Salvando...' : 'Salvar rascunho'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
