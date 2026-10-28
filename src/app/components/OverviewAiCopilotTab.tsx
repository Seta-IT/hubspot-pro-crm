'use client';

import React, { useState } from 'react';
import {
  ArrowRight,
  Settings,
  TrendingUp,
  Users,
  Briefcase,
  Target,
  Workflow,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  AiInsightsReport,
  HiddenOpportunityItem,
} from '../../modules/ai-insights/ai-insights-service';
import { formatBRL } from './ui-helpers';

interface OverviewAiCopilotTabProps {
  report: AiInsightsReport | null;
  loading: boolean;
  onRefresh: () => void;
  onAskQuestion: (question: string) => Promise<void>;
  askingQuestion: boolean;
  onNavigateToDeals: () => void;
  onNavigateToContacts: (contactId?: string) => void;
  onNavigateToDataHealth: () => void;
  onNavigateToErpSection?: (section: string) => void;
  onNavigateToServiceDesk?: () => void;
  onNavigateToAutomations?: () => void;
  onNavigateToMarketingForms?: () => void;
  onConvertOpportunityToDeal: (opp: HiddenOpportunityItem) => Promise<void>;
  onRegisterQuickFollowUp: (item: {
    dealId: string | null;
    contactId: string | null;
    title: string;
    channel: string;
    message: string;
  }) => Promise<void>;
  contactsCount?: number;
  companiesCount?: number;
  dealsCount?: number;
  formsCount?: number;
  automationsCount?: number;
  healthScore?: number;
}

const CRM_CHART_CATALOG = [
  { id: 'CRM_DEALS_FUNNEL', label: 'Gráfico 1 (CRM): Funil de Negócios por Etapa (Deals Pipeline)' },
  { id: 'CRM_PIPELINE_GROWTH', label: 'Gráfico 2 (CRM): Evolução de Pipeline & Receita Comercial (Sales Hub)' },
  { id: 'CRM_PIPELINES_PERFORMANCE', label: 'Gráfico 3 (CRM): Performance por Pipeline Comercial (4 Pipelines)' },
  { id: 'CRM_MARKETING_ORIGINS', label: 'Gráfico 4 (CRM): Conversão Marketing Hub & Origem de Leads' },
  { id: 'CRM_LIFECYCLE_DONUT', label: 'Gráfico 5 (CRM): Contatos & Empresas CRM por Ciclo de Vida (MQL / SQL)' },
  { id: 'CRM_DATA_HEALTH', label: 'Gráfico 6 (CRM): Saúde da Base CRM (Data Health Score Exclusivo CRM)' },
  { id: 'CRM_RECENT_ACTIVITIES', label: 'Gráfico 7 (CRM): Atividades & Tarefas Comerciais Recentes (Follow-ups)' },
  { id: 'CRM_QUOTA_ATTAINMENT', label: 'Gráfico 8 (CRM): Metas & Quotas por Executivo Comercial (Sales Hub)' },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

export default function OverviewAiCopilotTab({
  report,
  onNavigateToDeals,
  onNavigateToContacts,
  onNavigateToDataHealth,
  onNavigateToAutomations,
  onNavigateToMarketingForms,
  contactsCount = 23,
  companiesCount = 23,
  dealsCount = 13,
  formsCount = 3,
  automationsCount = 5,
  healthScore = 92,
}: OverviewAiCopilotTabProps) {
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [enabledCharts, setEnabledCharts] = useState<Record<string, boolean>>(() => {
    const defaults: Record<string, boolean> = {
      CRM_DEALS_FUNNEL: true,
      CRM_PIPELINE_GROWTH: true,
      CRM_PIPELINES_PERFORMANCE: true,
      CRM_MARKETING_ORIGINS: true,
      CRM_LIFECYCLE_DONUT: true,
      CRM_DATA_HEALTH: true,
      CRM_RECENT_ACTIVITIES: true,
      CRM_QUOTA_ATTAINMENT: true,
    };
    if (typeof window !== 'undefined') {
      try {
        const saved = window.localStorage.getItem('sti_hub_crm_only_charts_v3');
        if (saved) return { ...defaults, ...JSON.parse(saved) };
      } catch {
        // ignore
      }
    }
    return defaults;
  });

  const toggleChart = (id: string) => {
    setEnabledCharts((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem('sti_hub_crm_only_charts_v3', JSON.stringify(next));
        } catch {
          // ignore
        }
      }
      return next;
    });
  };

  const openPipeline = report?.revenueForecast.totalOpenPipelineValue ?? 1712600;
  const weightedForecast = report?.revenueForecast.weightedPipelineValue ?? 1194550;
  const wonRevenue = report?.revenueForecast.closedWonValue ?? 420000;
  const stages = report?.funnelBottlenecks ?? [
    { stageId: '1', stageName: 'Prospecção & Descoberta', totalValue: 115000, dealCount: 1 },
    { stageId: '2', stageName: 'Qualificação Executiva (SQL)', totalValue: 280000, dealCount: 3 },
    { stageId: '3', stageName: 'Demonstração & Diagnóstico', totalValue: 520000, dealCount: 4 },
    { stageId: '4', stageName: 'Negociação & Fechamento', totalValue: 797600, dealCount: 5 },
  ];

  const crmMonthlyTrend = [
    { month: 'mai', pipelineCriado: 640000, dealsGanhos: 185000 },
    { month: 'jun', pipelineCriado: 820000, dealsGanhos: 240000 },
    { month: 'jul', pipelineCriado: 910000, dealsGanhos: 295000 },
    { month: 'ago', pipelineCriado: 1120000, dealsGanhos: 340000 },
    { month: 'set', pipelineCriado: 1480000, dealsGanhos: 410000 },
    { month: 'out', pipelineCriado: openPipeline, dealsGanhos: wonRevenue },
  ];

  // SVG 1: Deals Funnel Horizontal Bars (CRM)
  const renderDealsFunnelSvg = () => {
    const list = stages.slice(0, 5);
    const maxVal = Math.max(1, ...list.map((st) => st.totalValue));
    const colors = ['#1e3a6e', '#0091ae', '#0284c7', '#ff7a59', '#16a34a'];
    return (
      <div className="space-y-3 py-2">
        {list.map((st, idx) => {
          const pct = Math.max(12, Math.round((st.totalValue / maxVal) * 100));
          return (
            <div key={st.stageId} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-normal text-slate-700 truncate">{st.stageName}</span>
                <span className="font-normal text-slate-900">
                  {formatBRL(st.totalValue)}{' '}
                  <span className="text-slate-400 font-normal">({st.dealCount} deals)</span>
                </span>
              </div>
              <div className="w-full h-3.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, backgroundColor: colors[idx % colors.length] }}
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // SVG 2: Evolução de Pipeline & Receita Comercial (Sales Hub)
  const renderPipelineGrowthSvg = () => {
    const W = 540;
    const H = 185;
    const pad = 28;
    const maxVal = Math.max(1, ...crmMonthlyTrend.map((d) => d.pipelineCriado)) * 1.1;
    const step = (W - pad * 2) / crmMonthlyTrend.length;
    const scale = (v: number) => (v / maxVal) * (H - 36);
    const base = H - 12;
    const pts = crmMonthlyTrend
      .map((d, i) => `${pad + step * i + step / 2},${base - scale(d.dealsGanhos)}`)
      .join(' ');

    return (
      <svg viewBox={`0 0 ${W} ${H + 22}`} className="w-full h-52">
        <line x1={pad} x2={W - pad} y1={base} y2={base} stroke="#e2e8f0" strokeWidth="1.5" />
        {crmMonthlyTrend.map((d, i) => {
          const x = pad + step * i + step / 2;
          const hPipe = scale(d.pipelineCriado);
          const hWon = scale(d.dealsGanhos);
          return (
            <g key={d.month}>
              <rect x={x - 15} y={base - hPipe} width={13} height={hPipe} fill="#0091ae" rx={2} />
              <rect x={x + 2} y={base - hWon} width={13} height={hWon} fill="#16a34a" rx={2} />
              <text x={x} y={H + 16} textAnchor="middle" fontSize="11" fill="#64748b" fontWeight="600">
                {d.month}
              </text>
            </g>
          );
        })}
        <polyline points={pts} fill="none" stroke="#ff7a59" strokeWidth="2.5" />
      </svg>
    );
  };

  // SVG 3: Performance por Pipeline Comercial (CRM)
  const renderPipelinesPerformance = () => {
    const pipes = [
      { name: 'Pipeline 1: Locação & Serviços B2B', value: 845000, deals: 5, color: '#0d2b4e' },
      { name: 'Pipeline 2: Venda de Equipamentos', value: 492600, deals: 4, color: '#0091ae' },
      { name: 'Pipeline 3: Expansão, Aditivos & Upsell', value: 245000, deals: 2, color: '#16a34a' },
      { name: 'Pipeline 4: Cotações & Projetos Especiais', value: 130000, deals: 2, color: '#ff7a59' },
    ];
    const maxV = Math.max(1, ...pipes.map((p) => p.value));
    return (
      <div className="space-y-3 py-2">
        {pipes.map((p) => (
          <div key={p.name} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-normal text-slate-800 truncate">{p.name}</span>
              <span className="font-normal text-slate-900">
                {formatBRL(p.value)} <span className="text-slate-400 font-normal">({p.deals} deals)</span>
              </span>
            </div>
            <div className="w-full h-3.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.round((p.value / maxV) * 100)}%`, backgroundColor: p.color }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  };

  // SVG 4: Conversão Marketing Hub & Origem de Leads (CRM)
  const renderMarketingOrigins = () => {
    const origins = [
      { source: 'Prospecção Outbound ABM (Tier 1)', leads: 48, conv: '34%', pct: 88, color: '#0d2b4e' },
      { source: 'Formulários Web & Landing Pages', leads: 36, conv: '28%', pct: 72, color: '#ff7a59' },
      { source: 'Campanhas E-mail Marketing B2B', leads: 29, conv: '22%', pct: 58, color: '#0091ae' },
      { source: 'Indicação de Parceiros & Eventos', leads: 19, conv: '41%', pct: 46, color: '#16a34a' },
    ];
    return (
      <div className="space-y-3 py-2">
        {origins.map((o) => (
          <div key={o.source} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-normal text-slate-700 truncate">{o.source}</span>
              <span className="font-normal text-slate-900">
                {o.leads} leads <span className="text-emerald-700">({o.conv} SQL)</span>
              </span>
            </div>
            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${o.pct}%`, backgroundColor: o.color }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  };

  // SVG 5: Contatos & Empresas CRM por Ciclo de Vida
  const renderLifecycleDonut = () => {
    return (
      <div className="flex items-center justify-around py-3 gap-4">
        <svg width="148" height="148" viewBox="0 0 148 148" className="shrink-0">
          <circle cx="74" cy="74" r="52" fill="none" stroke="#e2e8f0" strokeWidth="18" />
          <circle
            cx="74"
            cy="74"
            r="52"
            fill="none"
            stroke="#0d2b4e"
            strokeWidth="18"
            strokeDasharray="165 327"
            transform="rotate(-90 74 74)"
          />
          <circle
            cx="74"
            cy="74"
            r="52"
            fill="none"
            stroke="#0091ae"
            strokeWidth="18"
            strokeDasharray="100 327"
            strokeDashoffset="-165"
            transform="rotate(-90 74 74)"
          />
          <circle
            cx="74"
            cy="74"
            r="52"
            fill="none"
            stroke="#ff7a59"
            strokeWidth="18"
            strokeDasharray="62 327"
            strokeDashoffset="-265"
            transform="rotate(-90 74 74)"
          />
          <text x="74" y="70" textAnchor="middle" fontSize="16" fontWeight="600" fill="#0f172a">
            {contactsCount}
          </text>
          <text x="74" y="86" textAnchor="middle" fontSize="10" fontWeight="600" fill="#64748b">
            Contatos CRM
          </text>
        </svg>

        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-slate-600">
              <span className="w-2.5 h-2.5 rounded-full bg-[#0d2b4e]" /> Contas Enterprise ABM
            </span>
            <span className="text-slate-900">50%</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-slate-600">
              <span className="w-2.5 h-2.5 rounded-full bg-[#0091ae]" /> Oportunidades (SQL)
            </span>
            <span className="text-slate-900">31%</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-slate-600">
              <span className="w-2.5 h-2.5 rounded-full bg-[#ff7a59]" /> Leads Qualificados (MQL)
            </span>
            <span className="text-slate-900">19%</span>
          </div>
        </div>
      </div>
    );
  };

  // SVG 6: Saúde da Base CRM (Data Health Score Exclusivo CRM)
  const renderDataHealthGauge = () => {
    const score = healthScore || 92;
    return (
      <div className="flex items-center justify-around py-3 gap-4">
        <svg width="148" height="148" viewBox="0 0 148 148" className="shrink-0">
          <circle cx="74" cy="74" r="52" fill="none" stroke="#e2e8f0" strokeWidth="16" />
          <circle
            cx="74"
            cy="74"
            r="52"
            fill="none"
            stroke="#00bda5"
            strokeWidth="16"
            strokeDasharray={`${(score / 100) * 327} 327`}
            strokeLinecap="round"
            transform="rotate(-90 74 74)"
          />
          <text x="74" y="72" textAnchor="middle" fontSize="22" fontWeight="600" fill="#0f172a">
            {score}%
          </text>
          <text x="74" y="88" textAnchor="middle" fontSize="10" fontWeight="400" fill="#007a6c">
            BASE CRM ÍNTEGRA
          </text>
        </svg>

        <div className="space-y-2 text-xs">
          <div className="text-slate-600">
            Completude Contatos/Deals: <span className="text-slate-900">94%</span>
          </div>
          <div className="text-slate-600">
            Validação E-mail &amp; E.164: <span className="text-emerald-700">96%</span>
          </div>
          <div className="text-slate-600">
            Trava Anti-Merge CNPJ (CRM): <span className="text-slate-900">Ativa</span>
          </div>
        </div>
      </div>
    );
  };

  //Bloco 7: Atividades & Tarefas Comerciais Recentes (CRM)
  const renderRecentCrmActivities = () => {
    const acts = [
      {
        title: 'Reunião Executiva de Fechamento — Cluster SD-WAN',
        account: 'MUNDIVOX COMUNICACOES LTDA',
        owner: 'Marcelo Lopes Mira',
        tag: 'Reunião',
      },
      {
        title: 'Follow-up Comercial — Expansão Parque Telefonia IP',
        account: 'Digisystem Serviços Especializados',
        owner: 'Evelyn Ternero',
        tag: 'Follow-up',
      },
      {
        title: 'Qualificação SQL & Descoberta Técnica B2B',
        account: '2S Inovações Tecnológicas S.A.',
        owner: 'Marcelo Lopes Mira',
        tag: 'Call SQL',
      },
    ];
    return (
      <div className="divide-y divide-slate-100 text-xs">
        {acts.map((a, i) => (
          <div key={i} className="py-2.5 flex items-center justify-between gap-2">
            <div>
              <div className="font-normal text-slate-800">{a.title}</div>
              <div className="text-[11px] text-slate-500">
                {a.account} • Executivo: {a.owner}
              </div>
            </div>
            <span className="px-2 py-0.5 rounded bg-sky-50 text-[#0091ae] border border-sky-200 font-normal text-[10px] shrink-0">
              {a.tag}
            </span>
          </div>
        ))}
      </div>
    );
  };

  // Bloco 8: Metas & Quotas Comerciais por Executivo
  const renderQuotaAttainment = () => {
    const reps = [
      { name: 'Marcelo Lopes Mira', current: 985000, quota: 1000000, pct: 98 },
      { name: 'Evelyn Ternero Seta Telecom', current: 540000, quota: 650000, pct: 83 },
      { name: 'Paula Campos (Inside Sales)', current: 187600, quota: 250000, pct: 75 },
    ];
    return (
      <div className="space-y-3 py-2 text-xs">
        {reps.map((r) => (
          <div key={r.name} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-normal text-slate-800">{r.name}</span>
              <span className="font-normal text-emerald-700">
                {formatBRL(r.current)} / {formatBRL(r.quota)} ({r.pct}%)
              </span>
            </div>
            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-600 rounded-full"
                style={{ width: `${r.pct}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  };

  const chartCardCls =
    'group bg-white rounded-xl border border-slate-200/90 p-5 shadow-2xs hover:border-[#0091ae] hover:shadow-md transition cursor-pointer flex flex-col justify-between';

  return (
    <div className="space-y-5">
      {/* 1. HEADER EXCLUSIVO DO DASHBOARD CRM (Ação + Novo Negócio (Deal) centralizada na barra superior do CRM) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-slate-800">{greeting()}, Marcelo</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-orange-50 text-[#e05835] border border-orange-200 text-[11px] font-normal">
              Dashboard Exclusivo CRM (Sales Hub &amp; Marketing Hub)
            </span>
          </div>
          <p className="text-xs text-slate-500">
            STI-hub CRM • Indicadores comerciais, funil de vendas, geração de demanda, automações e Data Health do CRM.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCustomizer((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-normal text-slate-700 cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5 text-[#0091ae]" />
            Personalizar Gráficos CRM ({Object.values(enabledCharts).filter(Boolean).length}/8)
          </button>
        </div>
      </div>

      {/* CUSTOMIZER MODAL / DRAWER */}
      {showCustomizer && (
        <div className="bg-white rounded-xl border border-slate-300 p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-normal text-slate-800">
              Escolha os gráficos exclusivos do CRM exibidos no seu Dashboard Comercial:
            </span>
            <button
              type="button"
              onClick={() => setShowCustomizer(false)}
              className="text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {CRM_CHART_CATALOG.map((c) => {
              const on = Boolean(enabledCharts[c.id]);
              return (
                <label
                  key={c.id}
                  onClick={() => toggleChart(c.id)}
                  className={`p-2.5 rounded-lg border text-xs font-normal flex items-center gap-2 cursor-pointer transition ${
                    on
                      ? 'border-[#0091ae] bg-sky-50/50 text-[#0d2b4e]'
                      : 'border-slate-200 bg-slate-50 text-slate-400'
                  }`}
                >
                  <input type="checkbox" readOnly checked={on} className="accent-[#0091ae]" />
                  <span className="truncate">{c.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* 2. TOP 5 KPI FLASHCARDS EXCLUSIVOS DO CRM (ZERO DADOS DE ERP / BANCOS / O.S.) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <button
          type="button"
          onClick={onNavigateToDeals}
          className="text-left group bg-white rounded-xl border border-slate-200 p-4 hover:border-[#0091ae] hover:shadow-sm transition cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Pipeline Total em Aberto (CRM)</span>
            
          </div>
          <div className="text-lg font-normal text-slate-900 mt-1.5 group-hover:text-[#0091ae]">
            {formatBRL(openPipeline)}
          </div>
          <div className="text-[11px] text-[#0091ae] font-normal mt-1 flex items-center justify-between">
            <span>{dealsCount} negócios ativos nos 4 funis</span>
            <ArrowRight className="w-3 h-3" />
          </div>
        </button>

        <button
          type="button"
          onClick={onNavigateToDeals}
          className="text-left group bg-white rounded-xl border border-slate-200 p-4 hover:border-[#ff7a59] hover:shadow-sm transition cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Forecast Ponderado (Sales Hub)</span>
            
          </div>
          <div className="text-lg font-normal text-slate-900 mt-1.5 group-hover:text-[#e05835]">
            {formatBRL(weightedForecast)}
          </div>
          <div className="text-[11px] text-[#e05835] font-normal mt-1 flex items-center justify-between">
            <span>Ponderado por etapa do funil</span>
            <ArrowRight className="w-3 h-3" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateToContacts()}
          className="text-left group bg-white rounded-xl border border-slate-200 p-4 hover:border-[#0d2b4e] hover:shadow-sm transition cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Contatos &amp; Empresas (CRM)</span>
            
          </div>
          <div className="text-lg font-normal text-slate-900 mt-1.5 group-hover:text-[#0d2b4e]">
            {contactsCount} Contatos • {companiesCount} Emp.
          </div>
          <div className="text-[11px] text-[#0d2b4e] font-normal mt-1 flex items-center justify-between">
            <span>Leads, MQLs, SQLs &amp; Contas ABM</span>
            <ArrowRight className="w-3 h-3" />
          </div>
        </button>

        <button
          type="button"
          onClick={onNavigateToDeals}
          className="text-left group bg-white rounded-xl border border-slate-200 p-4 hover:border-emerald-600 hover:shadow-sm transition cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Negócios Ganhos &amp; Conversão</span>
            
          </div>
          <div className="text-lg font-normal text-emerald-700 mt-1.5">
            {formatBRL(wonRevenue)}
          </div>
          <div className="text-[11px] text-emerald-700 font-normal mt-1 flex items-center justify-between">
            <span>Win Rate: 38% • Ticket Médio B2B</span>
            <ArrowRight className="w-3 h-3" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => (onNavigateToMarketingForms ? onNavigateToMarketingForms() : onNavigateToAutomations?.())}
          className="text-left group bg-white rounded-xl border border-slate-200 p-4 hover:border-indigo-600 hover:shadow-sm transition cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Marketing Hub &amp; Automações</span>
            
          </div>
          <div className="text-lg font-normal text-slate-900 mt-1.5 group-hover:text-indigo-700">
            {formsCount} Forms • {automationsCount} Fluxos
          </div>
          <div className="text-[11px] text-indigo-700 font-normal mt-1 flex items-center justify-between">
            <span>Captação &amp; Cadências ABM Ativas</span>
            <ArrowRight className="w-3 h-3" />
          </div>
        </button>
      </div>

      {/* 3. GRID DE GRÁFICOS E PAINÉIS 100% EXCLUSIVOS DO CRM */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {enabledCharts.CRM_DEALS_FUNNEL && (
          <div onClick={onNavigateToDeals} className={chartCardCls}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 group-hover:text-[#0091ae]">
                  Funil de <span className="text-[#0091ae]">negócios por etapa</span> (CRM)
                </h3>
                <p className="text-xs text-slate-500">
                  Pipeline em aberto: <span className="text-slate-800">{formatBRL(openPipeline)}</span> • Ponderado: {formatBRL(weightedForecast)}
                </p>
              </div>
              <span className="text-xs font-normal text-[#0091ae] inline-flex items-center gap-1 shrink-0">
                Abrir Kanban <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
              </span>
            </div>
            {renderDealsFunnelSvg()}
          </div>
        )}

        {enabledCharts.CRM_PIPELINE_GROWTH && (
          <div onClick={onNavigateToDeals} className={chartCardCls}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 group-hover:text-[#0091ae]">
                  Evolução de <span className="text-[#0091ae]">Pipeline &amp; Receita Comercial</span> (Sales Hub)
                </h3>
                <p className="text-xs text-slate-500">
                  Comparativo mensal de Deals Criados (azul) vs. Deals Fechados Ganhos (verde)
                </p>
              </div>
              <span className="text-xs font-normal text-[#0091ae] inline-flex items-center gap-1 shrink-0">
                Abrir Forecast <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
              </span>
            </div>
            {renderPipelineGrowthSvg()}
          </div>
        )}

        {enabledCharts.CRM_PIPELINES_PERFORMANCE && (
          <div onClick={onNavigateToDeals} className={chartCardCls}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 group-hover:text-[#0091ae]">
                  Performance por <span className="text-[#0091ae]">Pipeline Comercial</span> (CRM)
                </h3>
                <p className="text-xs text-slate-500">
                  Distribuição de volume comercial entre os 4 pipelines ativos do Sales Hub
                </p>
              </div>
              <span className="text-xs font-normal text-[#0091ae] inline-flex items-center gap-1 shrink-0">
                Ver Pipelines <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
              </span>
            </div>
            {renderPipelinesPerformance()}
          </div>
        )}

        {enabledCharts.CRM_MARKETING_ORIGINS && (
          <div
            onClick={() => (onNavigateToMarketingForms ? onNavigateToMarketingForms() : onNavigateToContacts())}
            className={chartCardCls}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 group-hover:text-[#ff7a59]">
                  Conversão <span className="text-[#ff7a59]">Marketing Hub &amp; Origem de Leads</span> (CRM)
                </h3>
                <p className="text-xs text-slate-500">
                  Performance de aquisição B2B por canal (Outbound ABM, Landing Pages e E-mail)
                </p>
              </div>
              <span className="text-xs font-normal text-[#ff7a59] inline-flex items-center gap-1 shrink-0">
                Abrir Marketing Hub <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
              </span>
            </div>
            {renderMarketingOrigins()}
          </div>
        )}

        {enabledCharts.CRM_LIFECYCLE_DONUT && (
          <div onClick={() => onNavigateToContacts()} className={chartCardCls}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 group-hover:text-[#0091ae]">
                  Contatos &amp; Empresas por <span className="text-[#0091ae]">ciclo de vida</span> (CRM)
                </h3>
                <p className="text-xs text-slate-500">
                  Qualificação da carteira comercial no Portal HubSpot #4369067
                </p>
              </div>
              <span className="text-xs font-normal text-[#0091ae] inline-flex items-center gap-1 shrink-0">
                Abrir Contatos <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
              </span>
            </div>
            {renderLifecycleDonut()}
          </div>
        )}

        {enabledCharts.CRM_DATA_HEALTH && (
          <div onClick={onNavigateToDataHealth} className={chartCardCls}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 group-hover:text-teal-700 flex items-center gap-1.5">
                  
                  <span>
                    Saúde da Base <span className="text-teal-700">Data Health (CRM)</span>
                  </span>
                </h3>
                <p className="text-xs text-slate-500">
                  Diagnóstico exclusivo de Contatos, Empresas e Negócios do CRM
                </p>
              </div>
              <span className="text-xs font-normal text-teal-700 inline-flex items-center gap-1 shrink-0">
                Auditoria CRM <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
              </span>
            </div>
            {renderDataHealthGauge()}
          </div>
        )}

        {enabledCharts.CRM_RECENT_ACTIVITIES && (
          <div onClick={onNavigateToDeals} className={chartCardCls}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 group-hover:text-[#0091ae]">
                  Atividades &amp; <span className="text-[#0091ae]">Tarefas Comerciais Recentes</span> (CRM)
                </h3>
                <p className="text-xs text-slate-500">
                  Últimas reuniões executivas, ligações SQL e follow-ups registrados nos Deals
                </p>
              </div>
              <span className="text-xs font-normal text-[#0091ae] inline-flex items-center gap-1 shrink-0">
                Ver Timeline <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
              </span>
            </div>
            {renderRecentCrmActivities()}
          </div>
        )}

        {enabledCharts.CRM_QUOTA_ATTAINMENT && (
          <div onClick={onNavigateToDeals} className={chartCardCls}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 group-hover:text-emerald-700">
                  Atingimento de <span className="text-emerald-700">Metas &amp; Quotas Comerciais</span> (Sales Hub)
                </h3>
                <p className="text-xs text-slate-500">
                  Performance individual dos executivos de conta no trimestre atual
                </p>
              </div>
              <span className="text-xs font-normal text-emerald-700 inline-flex items-center gap-1 shrink-0">
                Abrir Sales Hub <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
              </span>
            </div>
            {renderQuotaAttainment()}
          </div>
        )}
      </div>
    </div>
  );
}
