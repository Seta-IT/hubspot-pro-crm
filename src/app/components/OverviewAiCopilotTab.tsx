'use client';

import React, { useState } from 'react';
import {
  ArrowRight,
  Plus,
  Settings,
  Wallet,
  TrendingUp,
  FileText,
  FileCheck2,
  Headphones,
  X,
} from 'lucide-react';
import {
  AiInsightsReport,
  HiddenOpportunityItem,
} from '../../modules/ai-insights/ai-insights-service';
import { formatBRL } from './ui-helpers';
import { SETA_DASHBOARD_BASELINE } from './GestaoClickDashboard';

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
  onConvertOpportunityToDeal: (opp: HiddenOpportunityItem) => Promise<void>;
  onRegisterQuickFollowUp: (item: {
    dealId: string | null;
    contactId: string | null;
    title: string;
    channel: string;
    message: string;
  }) => Promise<void>;
}

const CHART_CATALOG = [
  { id: 'ERP_CASH_FLOW', label: 'Gráfico 1 (ERP): Fluxo de Caixa Mensal (Recebimentos x Pagamentos)' },
  { id: 'ERP_SALES_TREND', label: 'Gráfico 2 (ERP): Evolução de Vendas & Locações (Últimos 6 meses)' },
  { id: 'CRM_DEALS_FUNNEL', label: 'Gráfico 3 (CRM): Funil de Vendas por Etapa (Deals Pipeline)' },
  { id: 'ERP_BANK_BALANCES', label: 'Gráfico 4 (ERP): Saldo por Conta Bancária (Banco Inter x Itaú)' },
  { id: 'CRM_LIFECYCLE_DONUT', label: 'Gráfico 5 (CRM): Contatos & Empresas por Ciclo de Vida' },
  { id: 'ERP_FISCAL_MIX', label: 'Gráfico 6 (ERP): Faturamento Fiscal (Locação 0% ISS vs NFS-e)' },
  { id: 'CRM_SLA_TICKETS', label: 'Gráfico 7 (CRM): Chamados por Prioridade & SLA (Service Desk)' },
  { id: 'CRM_DATA_HEALTH', label: 'Gráfico 8 (CRM): Saúde da Base de Dados (Data Health Score)' },
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
  onNavigateToErpSection,
  onNavigateToServiceDesk,
}: OverviewAiCopilotTabProps) {
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [enabledCharts, setEnabledCharts] = useState<Record<string, boolean>>(() => {
    const defaults: Record<string, boolean> = {
      ERP_CASH_FLOW: true,
      ERP_SALES_TREND: true,
      CRM_DEALS_FUNNEL: true,
      ERP_BANK_BALANCES: true,
      CRM_LIFECYCLE_DONUT: true,
      ERP_FISCAL_MIX: true,
      CRM_SLA_TICKETS: true,
      CRM_DATA_HEALTH: true,
    };
    if (typeof window !== 'undefined') {
      try {
        const saved = window.localStorage.getItem('sti_hub_clean_charts_v2');
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
          window.localStorage.setItem('sti_hub_clean_charts_v2', JSON.stringify(next));
        } catch {
          // ignore
        }
      }
      return next;
    });
  };

  const s = SETA_DASHBOARD_BASELINE;
  const openPipeline = report?.revenueForecast.totalOpenPipelineValue ?? 1285000;
  const weightedForecast = report?.revenueForecast.weightedPipelineValue ?? 684000;
  const stages = report?.funnelBottlenecks ?? [
    { stageId: '1', stageName: '1. Descoberta', totalValue: 320000, dealCount: 4 },
    { stageId: '2', stageName: '2. Arquitetura', totalValue: 410000, dealCount: 3 },
    { stageId: '3', stageName: '3. Proposta', totalValue: 365000, dealCount: 3 },
    { stageId: '4', stageName: '4. Negociação', totalValue: 190000, dealCount: 2 },
  ];

  // SVG 1: Cash Flow Bars + Line
  const renderCashFlowSvg = () => {
    const W = 540;
    const H = 185;
    const pad = 28;
    const maxAbs = Math.max(
      1,
      ...s.cashFlowMonthly.map((d) => Math.max(d.recebimentos, d.pagamentos, Math.abs(d.saldo)))
    );
    const mid = H / 2 + 10;
    const scale = (v: number) => (v / maxAbs) * (H / 2 - 22);
    const step = (W - pad * 2) / s.cashFlowMonthly.length;
    const pts = s.cashFlowMonthly
      .map((d, i) => `${pad + step * i + step / 2},${mid - scale(d.saldo)}`)
      .join(' ');

    return (
      <svg viewBox={`0 0 ${W} ${H + 22}`} className="w-full h-52">
        <line x1={pad} x2={W - pad} y1={mid} y2={mid} stroke="#e2e8f0" strokeWidth="1.5" />
        {s.cashFlowMonthly.map((d, i) => {
          const x = pad + step * i + step / 2;
          const hR = scale(d.recebimentos);
          const hP = scale(d.pagamentos);
          return (
            <g key={d.month}>
              <rect x={x - 15} y={mid - hR} width={13} height={hR} fill="#16a34a" rx={2} />
              <rect x={x + 2} y={mid} width={13} height={hP} fill="#dc2626" rx={2} />
              <text x={x} y={H + 16} textAnchor="middle" fontSize="11" fill="#64748b" fontWeight="600">
                {d.month}
              </text>
            </g>
          );
        })}
        <polyline points={pts} fill="none" stroke="#475569" strokeWidth="2" />
        {s.cashFlowMonthly.map((d, i) => (
          <circle
            key={`c-${d.month}`}
            cx={pad + step * i + step / 2}
            cy={mid - scale(d.saldo)}
            r="3.5"
            fill="#1e3a6e"
          />
        ))}
      </svg>
    );
  };

  // SVG 2: Smooth Area Sales Trend
  const renderSalesAreaSvg = () => {
    const W = 540;
    const H = 185;
    const pad = 28;
    const max = Math.max(1, ...s.salesMonthly.map((d) => d.vendas)) * 1.12;
    const step = (W - pad * 2) / Math.max(1, s.salesMonthly.length - 1);
    const y = (v: number) => H - 10 - (v / max) * (H - 34);
    const pts = s.salesMonthly.map((d, i) => ({ x: pad + step * i, y: y(d.vendas) }));
    let path = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1];
      const p1 = pts[i];
      const cx = (p0.x + p1.x) / 2;
      path += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
    }
    const area = `${path} L ${pts[pts.length - 1].x} ${H - 10} L ${pts[0].x} ${H - 10} Z`;
    const avgY = y(s.salesMonthlyAverage);

    return (
      <svg viewBox={`0 0 ${W} ${H + 22}`} className="w-full h-52">
        <path d={area} fill="#1e3a6e" fillOpacity="0.12" />
        <path d={path} fill="none" stroke="#1e3a6e" strokeWidth="2.5" />
        <line x1={pad} x2={W - pad} y1={avgY} y2={avgY} stroke="#94a3b8" strokeDasharray="5 4" />
        {pts.map((p, i) => (
          <g key={s.salesMonthly[i].month}>
            <circle cx={p.x} cy={p.y} r="4" fill="#1e3a6e" />
            <text x={p.x} y={H + 16} textAnchor="middle" fontSize="11" fill="#64748b" fontWeight="600">
              {s.salesMonthly[i].month}
            </text>
          </g>
        ))}
      </svg>
    );
  };

  // SVG 3: Deals Funnel Horizontal Bars
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
                <span className="font-bold text-slate-700 truncate">{st.stageName}</span>
                <span className="font-extrabold text-slate-900">
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

  // SVG 4: Bank Accounts Visual Comparison
  const renderBankAccountsChart = () => {
    const inter = 4572238.02;
    const itau = -2370472.62;
    const max = inter;
    return (
      <div className="space-y-4 py-2">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-slate-800 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-orange-500" /> Banco Inter (Conta PJ)
            </span>
            <strong className="text-emerald-700 font-black">{formatBRL(inter)}</strong>
          </div>
          <div className="w-full h-4 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-600 rounded-full" style={{ width: '100%' }} />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-slate-800 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-800" /> Banco Itaú
            </span>
            <strong className="text-rose-600 font-black">{formatBRL(itau)}</strong>
          </div>
          <div className="w-full h-4 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-rose-500 rounded-full"
              style={{ width: `${Math.round((Math.abs(itau) / max) * 100)}%` }}
            />
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
          <span className="text-slate-500 font-semibold">Saldo Líquido Disponível Hoje</span>
          <strong className="text-base font-black text-[#1e3a6e]">R$ 2.201.765,40</strong>
        </div>
      </div>
    );
  };

  // SVG 5: Contacts & Companies Donut
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
            stroke="#1e3a6e"
            strokeWidth="18"
            strokeDasharray="195 327"
            transform="rotate(-90 74 74)"
          />
          <circle
            cx="74"
            cy="74"
            r="52"
            fill="none"
            stroke="#0091ae"
            strokeWidth="18"
            strokeDasharray="82 327"
            strokeDashoffset="-195"
            transform="rotate(-90 74 74)"
          />
          <circle
            cx="74"
            cy="74"
            r="52"
            fill="none"
            stroke="#ff7a59"
            strokeWidth="18"
            strokeDasharray="50 327"
            strokeDashoffset="-277"
            transform="rotate(-90 74 74)"
          />
          <text x="74" y="70" textAnchor="middle" fontSize="16" fontWeight="900" fill="#0f172a">
            1.184
          </text>
          <text x="74" y="86" textAnchor="middle" fontSize="10" fontWeight="600" fill="#64748b">
            Clientes B2B
          </text>
        </svg>

        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-slate-600">
              <span className="w-2.5 h-2.5 rounded-full bg-[#1e3a6e]" /> Clientes Ativos (ERP)
            </span>
            <strong className="text-slate-900">60%</strong>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-slate-600">
              <span className="w-2.5 h-2.5 rounded-full bg-[#0091ae]" /> Oportunidades / SQL
            </span>
            <strong className="text-slate-900">25%</strong>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-slate-600">
              <span className="w-2.5 h-2.5 rounded-full bg-[#ff7a59]" /> Leads / MQLs
            </span>
            <strong className="text-slate-900">15%</strong>
          </div>
        </div>
      </div>
    );
  };

  // SVG 6: Fiscal Mix (Locação 0% ISS vs Serviços LC 116)
  const renderFiscalChart = () => {
    return (
      <div className="flex items-center justify-around py-3 gap-4">
        <svg width="148" height="148" viewBox="0 0 148 148" className="shrink-0">
          <circle cx="74" cy="74" r="52" fill="none" stroke="#e2e8f0" strokeWidth="18" />
          <circle
            cx="74"
            cy="74"
            r="52"
            fill="none"
            stroke="#16a34a"
            strokeWidth="18"
            strokeDasharray="260 327"
            transform="rotate(-90 74 74)"
          />
          <circle
            cx="74"
            cy="74"
            r="52"
            fill="none"
            stroke="#6366f1"
            strokeWidth="18"
            strokeDasharray="67 327"
            strokeDashoffset="-260"
            transform="rotate(-90 74 74)"
          />
          <text x="74" y="70" textAnchor="middle" fontSize="15" fontWeight="900" fill="#16a34a">
            0% ISS
          </text>
          <text x="74" y="86" textAnchor="middle" fontSize="9" fontWeight="700" fill="#64748b">
            SV 31 STF
          </text>
        </svg>

        <div className="space-y-2 text-xs">
          <div>
            <span className="flex items-center gap-1.5 text-slate-600">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" /> Faturas de Locação (80%)
            </span>
            <strong className="text-emerald-700 block ml-4">Isento de ISS (LC 116 + SV 31)</strong>
          </div>
          <div>
            <span className="flex items-center gap-1.5 text-slate-600">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" /> NFS-e Serviços (20%)
            </span>
            <strong className="text-indigo-700 block ml-4">Suporte NOC (Item 01.07)</strong>
          </div>
        </div>
      </div>
    );
  };

  // SVG 7: Tickets & O.S. Bar Chart
  const renderTicketsChart = () => {
    const bars = [
      { label: 'No Prazo (SLA OK)', pct: 94, color: '#16a34a', count: '1.295 O.S.' },
      { label: 'Em Andamento NOC', pct: 48, color: '#0091ae', count: '68 O.S.' },
      { label: 'Prioridade P1 Crítica', pct: 14, color: '#dc2626', count: '15 Chamados' },
    ];
    return (
      <div className="space-y-3.5 py-2">
        {bars.map((b) => (
          <div key={b.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-700">{b.label}</span>
              <strong className="text-slate-900">{b.count}</strong>
            </div>
            <div className="w-full h-3.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${b.pct}%`, backgroundColor: b.color }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  };

  // SVG 8: Data Health Score Gauge
  const renderDataHealthGauge = () => {
    const score = 92;
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
          <text x="74" y="72" textAnchor="middle" fontSize="22" fontWeight="900" fill="#0f172a">
            {score}%
          </text>
          <text x="74" y="88" textAnchor="middle" fontSize="10" fontWeight="700" fill="#007a6c">
            SAÚDE EXCELENTE
          </text>
        </svg>

        <div className="space-y-2 text-xs">
          <div className="text-slate-600">
            Completude Cadastral: <strong className="text-slate-900">94%</strong>
          </div>
          <div className="text-slate-600">
            Validação CNPJ &amp; E.164: <strong className="text-emerald-700">96%</strong>
          </div>
          <div className="text-slate-600">
            Desduplicação Base: <strong className="text-slate-900">89%</strong>
          </div>
        </div>
      </div>
    );
  };

  const chartCardCls =
    'group bg-white rounded-xl border border-slate-200/90 p-5 shadow-2xs hover:border-[#1e3a6e] hover:shadow-md transition cursor-pointer flex flex-col justify-between';

  return (
    <div className="space-y-5">
      {/* 1. MINIMALIST HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">{greeting()}, Marcelo</h1>
          <p className="text-xs text-slate-500">
            STI-hub • Clique em qualquer gráfico ou indicador para abrir a página referente.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCustomizer((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5 text-[#1e3a6e]" />
            Personalizar Gráficos ({Object.values(enabledCharts).filter(Boolean).length}/8)
          </button>
          <button
            type="button"
            onClick={() => onNavigateToErpSection?.('ORCAMENTOS')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1e3a6e] hover:bg-[#162b54] text-white text-xs font-bold cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Novo Orçamento
          </button>
        </div>
      </div>

      {/* CUSTOMIZER MODAL / DRAWER */}
      {showCustomizer && (
        <div className="bg-white rounded-xl border border-slate-300 p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800">
              Escolha os gráficos do CRM e do ERP exibidos no seu Dashboard Inicial:
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
            {CHART_CATALOG.map((c) => {
              const on = Boolean(enabledCharts[c.id]);
              return (
                <label
                  key={c.id}
                  onClick={() => toggleChart(c.id)}
                  className={`p-2.5 rounded-lg border text-xs font-semibold flex items-center gap-2 cursor-pointer transition ${
                    on
                      ? 'border-[#1e3a6e] bg-blue-50/50 text-[#1e3a6e]'
                      : 'border-slate-200 bg-slate-50 text-slate-400'
                  }`}
                >
                  <input type="checkbox" readOnly checked={on} className="accent-[#1e3a6e]" />
                  <span className="truncate">{c.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* 2. TOP 5 COMPACT CLICKABLE KPI FLASHCARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <button
          type="button"
          onClick={() => onNavigateToErpSection?.('FINANCEIRO')}
          className="text-left group bg-white rounded-xl border border-slate-200 p-4 hover:border-[#1e3a6e] hover:shadow-sm transition cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Saldo Disponível Hoje</span>
            <Wallet className="w-4 h-4 text-[#1e3a6e]" />
          </div>
          <div className="text-lg font-extrabold text-slate-900 mt-1.5 group-hover:text-[#1e3a6e]">
            R$ 2.201.765,40
          </div>
          <div className="text-[11px] text-[#1e3a6e] font-semibold mt-1 flex items-center justify-between">
            <span>3 contas bancárias</span>
            <ArrowRight className="w-3 h-3" />
          </div>
        </button>

        <button
          type="button"
          onClick={onNavigateToDeals}
          className="text-left group bg-white rounded-xl border border-slate-200 p-4 hover:border-[#0091ae] hover:shadow-sm transition cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Pipeline &amp; Forecast CRM</span>
            <TrendingUp className="w-4 h-4 text-[#0091ae]" />
          </div>
          <div className="text-lg font-extrabold text-slate-900 mt-1.5 group-hover:text-[#0091ae]">
            {formatBRL(weightedForecast)}
          </div>
          <div className="text-[11px] text-[#0091ae] font-semibold mt-1 flex items-center justify-between">
            <span>Aberto: {formatBRL(openPipeline)}</span>
            <ArrowRight className="w-3 h-3" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateToErpSection?.('ORCAMENTOS')}
          className="text-left group bg-white rounded-xl border border-slate-200 p-4 hover:border-[#ff7a59] hover:shadow-sm transition cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Orçamentos &amp; Propostas</span>
            <FileText className="w-4 h-4 text-[#ff7a59]" />
          </div>
          <div className="text-lg font-extrabold text-slate-900 mt-1.5 group-hover:text-[#e05835]">
            2.077 Orçamentos
          </div>
          <div className="text-[11px] text-[#e05835] font-semibold mt-1 flex items-center justify-between">
            <span>Último: #4695 Mundivox</span>
            <ArrowRight className="w-3 h-3" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateToErpSection?.('CONTRATOS')}
          className="text-left group bg-white rounded-xl border border-slate-200 p-4 hover:border-emerald-600 hover:shadow-sm transition cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Contratos de Locação</span>
            <FileCheck2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-lg font-extrabold text-emerald-700 mt-1.5">
            344 Contratos
          </div>
          <div className="text-[11px] text-emerald-700 font-semibold mt-1 flex items-center justify-between">
            <span>Isentos ISS (SV 31 STF)</span>
            <ArrowRight className="w-3 h-3" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateToServiceDesk?.()}
          className="text-left group bg-white rounded-xl border border-slate-200 p-4 hover:border-indigo-600 hover:shadow-sm transition cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Chamados &amp; O.S.</span>
            <Headphones className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="text-lg font-extrabold text-slate-900 mt-1.5 group-hover:text-indigo-700">
            1.378 O.S.
          </div>
          <div className="text-[11px] text-indigo-700 font-semibold mt-1 flex items-center justify-between">
            <span>SLA 94% no prazo</span>
            <ArrowRight className="w-3 h-3" />
          </div>
        </button>
      </div>

      {/* 3. CLEAN 2-COLUMN VISUAL CHARTS GRID (100% CLICKABLE) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {enabledCharts.ERP_CASH_FLOW && (
          <div
            onClick={() => onNavigateToErpSection?.('FINANCEIRO')}
            className={chartCardCls}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <h3 className="text-sm font-bold text-slate-800 group-hover:text-[#1e3a6e]">
                  Acompanhe o <span className="text-[#1e3a6e]">fluxo de caixa</span>
                </h3>
                <p className="text-xs text-slate-500">
                  Saldo do período: <strong className="text-slate-800">R$ 804.185,24</strong> • Melhor mês: set (R$ 302.303,45)
                </p>
              </div>
              <span className="text-xs font-bold text-[#1e3a6e] inline-flex items-center gap-1 shrink-0">
                Abrir página <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
              </span>
            </div>
            {renderCashFlowSvg()}
          </div>
        )}

        {enabledCharts.ERP_SALES_TREND && (
          <div
            onClick={() => onNavigateToErpSection?.('VENDAS')}
            className={chartCardCls}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <h3 className="text-sm font-bold text-slate-800 group-hover:text-[#1e3a6e]">
                  Veja suas <span className="text-[#1e3a6e]">vendas &amp; locações</span>
                </h3>
                <p className="text-xs text-slate-500">
                  Vendas no período: <strong className="text-slate-800">R$ 207.113,75</strong> • Média: R$ 34.518,96/mês
                </p>
              </div>
              <span className="text-xs font-bold text-[#1e3a6e] inline-flex items-center gap-1 shrink-0">
                Abrir página <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
              </span>
            </div>
            {renderSalesAreaSvg()}
          </div>
        )}

        {enabledCharts.CRM_DEALS_FUNNEL && (
          <div onClick={onNavigateToDeals} className={chartCardCls}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <h3 className="text-sm font-bold text-slate-800 group-hover:text-[#0091ae]">
                  Funil de <span className="text-[#0091ae]">negócios por etapa</span> (CRM)
                </h3>
                <p className="text-xs text-slate-500">
                  Pipeline em aberto: <strong className="text-slate-800">{formatBRL(openPipeline)}</strong> • Ponderado: {formatBRL(weightedForecast)}
                </p>
              </div>
              <span className="text-xs font-bold text-[#0091ae] inline-flex items-center gap-1 shrink-0">
                Abrir Kanban <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
              </span>
            </div>
            {renderDealsFunnelSvg()}
          </div>
        )}

        {enabledCharts.ERP_BANK_BALANCES && (
          <div
            onClick={() => onNavigateToErpSection?.('FINANCEIRO')}
            className={chartCardCls}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <h3 className="text-sm font-bold text-slate-800 group-hover:text-[#1e3a6e]">
                  Saldo das <span className="text-[#1e3a6e]">contas bancárias</span> (ERP)
                </h3>
                <p className="text-xs text-slate-500">
                  Banco Inter, Banco Itaú e Conta Integrada
                </p>
              </div>
              <span className="text-xs font-bold text-[#1e3a6e] inline-flex items-center gap-1 shrink-0">
                Ver contas <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
              </span>
            </div>
            {renderBankAccountsChart()}
          </div>
        )}

        {enabledCharts.CRM_LIFECYCLE_DONUT && (
          <div onClick={() => onNavigateToContacts()} className={chartCardCls}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <h3 className="text-sm font-bold text-slate-800 group-hover:text-[#0091ae]">
                  Contatos &amp; Empresas por <span className="text-[#0091ae]">ciclo de vida</span>
                </h3>
                <p className="text-xs text-slate-500">
                  Base sincronizada STI-hub + GestãoClick Matriz #118887
                </p>
              </div>
              <span className="text-xs font-bold text-[#0091ae] inline-flex items-center gap-1 shrink-0">
                Abrir Contatos <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
              </span>
            </div>
            {renderLifecycleDonut()}
          </div>
        )}

        {enabledCharts.ERP_FISCAL_MIX && (
          <div
            onClick={() => onNavigateToErpSection?.('FISCAL')}
            className={chartCardCls}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <h3 className="text-sm font-bold text-slate-800 group-hover:text-emerald-700">
                  Faturamento por <span className="text-emerald-700">natureza fiscal</span>
                </h3>
                <p className="text-xs text-slate-500">
                  Faturas de Locação (LC 116/03 + SV 31 STF) vs NFS-e Serviços
                </p>
              </div>
              <span className="text-xs font-bold text-emerald-700 inline-flex items-center gap-1 shrink-0">
                Abrir Fiscal <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
              </span>
            </div>
            {renderFiscalChart()}
          </div>
        )}

        {enabledCharts.CRM_SLA_TICKETS && (
          <div onClick={() => onNavigateToServiceDesk?.()} className={chartCardCls}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <h3 className="text-sm font-bold text-slate-800 group-hover:text-indigo-700">
                  Ordens de Serviço &amp; <span className="text-indigo-700">SLA de Atendimento</span>
                </h3>
                <p className="text-xs text-slate-500">
                  1.378 O.S. técnicas e chamados NOC monitorados
                </p>
              </div>
              <span className="text-xs font-bold text-indigo-700 inline-flex items-center gap-1 shrink-0">
                Abrir Chamados <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
              </span>
            </div>
            {renderTicketsChart()}
          </div>
        )}

        {enabledCharts.CRM_DATA_HEALTH && (
          <div onClick={onNavigateToDataHealth} className={chartCardCls}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <h3 className="text-sm font-bold text-slate-800 group-hover:text-teal-700">
                  Saúde &amp; Integridade da <span className="text-teal-700">base de dados</span>
                </h3>
                <p className="text-xs text-slate-500">
                  Score de completude, CNPJ e higienização automática
                </p>
              </div>
              <span className="text-xs font-bold text-teal-700 inline-flex items-center gap-1 shrink-0">
                Abrir Data Health <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
              </span>
            </div>
            {renderDataHealthGauge()}
          </div>
        )}
      </div>
    </div>
  );
}
