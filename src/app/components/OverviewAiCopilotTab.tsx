'use client';

import React, { useState } from 'react';
import {
  Sparkles,
  TrendingUp,
  AlertTriangle,
  Target,
  Send,
  ArrowRight,
  Clock,
  CheckCircle2,
  ShieldAlert,
  PhoneCall,
  Mail,
  Calendar,
  MessageSquare,
  Lightbulb,
  PlusCircle,
  Copy,
  Check,
  BarChart3,
  Layers,
  Zap,
  RefreshCw,
} from 'lucide-react';
import { AiInsightsReport, HiddenOpportunityItem } from '../../modules/ai-insights/ai-insights-service';
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
  onConvertOpportunityToDeal: (opp: HiddenOpportunityItem) => Promise<void>;
  onRegisterQuickFollowUp: (item: {
    dealId: string | null;
    contactId: string | null;
    title: string;
    channel: string;
    message: string;
  }) => Promise<void>;
}

const SUGGESTED_QUESTIONS = [
  'Qual é o maior gargalo do funil comercial hoje?',
  'Qual a previsão de receita ponderada, conservadora e otimista?',
  'Quais oportunidades ocultas na base posso converter agora?',
  'Quais são os negócios em risco crítico e prioridades de hoje?',
];

export default function OverviewAiCopilotTab({
  report,
  loading,
  onRefresh,
  onAskQuestion,
  askingQuestion,
  onNavigateToDeals,
  onNavigateToContacts,
  onNavigateToDataHealth,
  onNavigateToErpSection,
  onNavigateToServiceDesk,
  onNavigateToAutomations,
  onConvertOpportunityToDeal,
  onRegisterQuickFollowUp,
}: OverviewAiCopilotTabProps) {
  const [questionInput, setQuestionInput] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [loggingFollowUpId, setLoggingFollowUpId] = useState<string | null>(null);

  const handleAsk = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setQuestionInput(trimmed);
    await onAskQuestion(trimmed);
  };

  const handleCopyMessage = (id: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleConvert = async (opp: HiddenOpportunityItem) => {
    setConvertingId(opp.id);
    try {
      await onConvertOpportunityToDeal(opp);
    } finally {
      setConvertingId(null);
    }
  };

  const handleQuickLog = async (
    id: string,
    payload: {
      dealId: string | null;
      contactId: string | null;
      title: string;
      channel: string;
      message: string;
    }
  ) => {
    setLoggingFollowUpId(id);
    try {
      await onRegisterQuickFollowUp(payload);
    } finally {
      setLoggingFollowUpId(null);
    }
  };

  if (loading && !report) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-36 bg-white rounded-2xl border border-slate-200 p-6" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-white rounded-xl border border-slate-200" />
          ))}
        </div>
        <div className="h-80 bg-white rounded-2xl border border-slate-200" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
        <p className="text-slate-600 mb-4">Não foi possível carregar o relatório da IA Analista.</p>
        <button
          onClick={onRefresh}
          className="px-4 py-2 bg-[#ff7a59] text-white rounded-lg font-medium hover:bg-[#e86646] transition"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  const {
    executiveSummary,
    revenueForecast,
    funnelBottlenecks,
    atRiskDeals,
    priorityFollowUps,
    hiddenOpportunities,
    analystAnswer,
  } = report;

  const criticalAndHighDeals = atRiskDeals.filter(
    (d) => d.riskLevel === 'CRITICAL' || d.riskLevel === 'HIGH'
  );

  return (
    <div className="space-y-6">
      {/* HERO AI COPILOT ANALYST BAR */}
      <div className="bg-gradient-to-br from-[#1e293b] via-[#1e293b] to-[#0f172a] rounded-2xl p-6 text-white shadow-lg border border-slate-800 relative overflow-hidden">
        <div className="absolute -right-12 -top-12 w-64 h-64 rounded-full bg-[#ff7a59]/10 blur-2xl pointer-events-none" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-5 border-b border-slate-700/80">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#ff7a59]/20 border border-[#ff7a59]/40 text-[#ff987f] text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5 text-[#ff7a59]" />
              Copiloto IA Analista de Funil e Base • Confiança Analítica: {executiveSummary.aiConfidenceScore}%
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              {executiveSummary.headline}
            </h2>
          </div>
          <div className="flex items-center gap-2 self-start lg:self-center">
            <button
              onClick={onRefresh}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Recalcular Diagnóstico
            </button>
            <button
              onClick={onNavigateToDeals}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-semibold shadow-sm transition"
            >
              Abrir Kanban Comercial
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Natural Language Question Input */}
        <div className="relative z-10 mt-5 space-y-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleAsk(questionInput);
            }}
            className="flex flex-col sm:flex-row gap-2.5"
          >
            <div className="relative flex-1">
              <Sparkles className="w-4 h-4 text-[#ff7a59] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={questionInput}
                onChange={(e) => setQuestionInput(e.target.value)}
                placeholder="Pergunte em linguagem natural à IA Analista (ex: Qual é o maior gargalo do funil ou previsão de receita?)"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-900/90 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-400 focus:outline-none focus:border-[#ff7a59] focus:ring-1 focus:ring-[#ff7a59]"
              />
            </div>
            <button
              type="submit"
              disabled={askingQuestion}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] disabled:opacity-60 text-white text-sm font-semibold transition shadow-sm"
            >
              <Send className="w-4 h-4" />
              {askingQuestion ? 'Analisando...' : 'Perguntar à IA'}
            </button>
          </form>

          {/* Suggested Prompt Chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400 font-medium">Sugestões rápidas:</span>
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => handleAsk(q)}
                className="text-xs px-3 py-1 rounded-full bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:border-[#ff7a59]/60 transition"
              >
                {q}
              </button>
            ))}
          </div>

          {/* Analyst Answer Box */}
          {analystAnswer && (
            <div className="mt-4 p-4 rounded-xl bg-slate-900/95 border border-[#ff7a59]/50 text-slate-100 shadow-inner">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-[#ff7a59]/20 text-[#ff7a59] shrink-0 mt-0.5">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div className="space-y-1 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#ff987f]">
                      Resposta Executiva da IA Analista
                    </span>
                    <span className="text-[11px] text-slate-400">Baseado em dados reais do CRM</span>
                  </div>
                  <p className="text-sm text-slate-100 leading-relaxed">{analystAnswer}</p>
                </div>
              </div>
            </div>
          )}

          {/* Key Takeaways */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-2">
            {executiveSummary.keyTakeaways.map((takeaway, idx) => (
              <div
                key={idx}
                className="flex items-start gap-2.5 bg-slate-800/50 border border-slate-700/70 rounded-xl p-3 text-xs text-slate-200"
              >
                <CheckCircle2 className="w-4 h-4 text-[#ff7a59] shrink-0 mt-0.5" />
                <span>{takeaway}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* EXECUTIVE KPI FLASHCARDS (100% CLICÁVEIS COM DRILL-DOWN) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          onClick={onNavigateToDeals}
          className="group bg-white rounded-xl border border-slate-200 hover:border-[#0091ae] hover:shadow-md p-5 shadow-sm transition cursor-pointer"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Receita Ponderada (Forecast)
            </span>
            <div className="p-2 rounded-lg bg-orange-50 text-[#ff7a59]">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900 group-hover:text-[#0091ae]">
            {formatBRL(revenueForecast.weightedPipelineValue)}
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
            <span>Pipeline Aberto Total:</span>
            <span className="font-semibold text-slate-700">
              {formatBRL(revenueForecast.totalOpenPipelineValue)}
            </span>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] font-bold text-[#0091ae]">
            <span>Já Fechado: {formatBRL(revenueForecast.closedWonValue)}</span>
            <span className="inline-flex items-center gap-1">
              Ver Funil Completo <ArrowRight className="w-3 h-3" />
            </span>
          </div>
        </div>

        <div
          onClick={onNavigateToDeals}
          className="group bg-white rounded-xl border border-slate-200 hover:border-emerald-500 hover:shadow-md p-5 shadow-sm transition cursor-pointer"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Cenários de Fechamento
            </span>
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
              <BarChart3 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-emerald-700">
            {formatBRL(revenueForecast.committedForecast)}
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">Forecast Comprometido (Won + Prob ≥ 80%)</p>
          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] font-bold text-emerald-700">
            <span>Otimista: {formatBRL(revenueForecast.optimisticForecast)}</span>
            <span className="inline-flex items-center gap-1">
              Abrir Deals <ArrowRight className="w-3 h-3" />
            </span>
          </div>
        </div>

        <div
          onClick={onNavigateToDeals}
          className="group bg-white rounded-xl border border-rose-200 hover:border-rose-500 hover:shadow-md p-5 shadow-sm transition cursor-pointer"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-rose-600">
              Receita em Risco Crítico
            </span>
            <div className="p-2 rounded-lg bg-rose-50 text-rose-600">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-rose-600">
            {formatBRL(executiveSummary.revenueAtRisk)}
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
            <span>Negócios em alerta:</span>
            <span className="font-semibold text-rose-700">
              {criticalAndHighDeals.length} negócio(s) estagnado(s)
            </span>
          </div>
          <div className="mt-2 pt-2 border-t border-rose-100 flex items-center justify-between text-[11px] font-bold text-rose-700">
            <span>Ticket Médio: {formatBRL(revenueForecast.averageDealSize)}</span>
            <span className="inline-flex items-center gap-1">
              Destravar no Kanban <ArrowRight className="w-3 h-3" />
            </span>
          </div>
        </div>

        <div
          onClick={() => onNavigateToContacts()}
          className="group bg-white rounded-xl border border-indigo-200 hover:border-indigo-500 hover:shadow-md p-5 shadow-sm transition cursor-pointer"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600">
              Oportunidades Ocultas
            </span>
            <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
              <Lightbulb className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-indigo-700">
            {formatBRL(executiveSummary.unlockableRevenue)}
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
            <span>Contas/SQLs prontos:</span>
            <span className="font-semibold text-indigo-700">
              {hiddenOpportunities.length} oportunidade(s)
            </span>
          </div>
          <div className="mt-2 pt-2 border-t border-indigo-100 flex items-center justify-between text-[11px] font-bold text-indigo-700">
            <span>Win Rate: {revenueForecast.winRate}%</span>
            <span className="inline-flex items-center gap-1">
              Ver Contatos &amp; Empresas <ArrowRight className="w-3 h-3" />
            </span>
          </div>
        </div>
      </div>

      {/* STI-HUB ERP GESTÃOCLICK & SERVICE DESK FLASHCARDS CLICÁVEIS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => onNavigateToErpSection?.('FINANCEIRO')}
          className="text-left group bg-white rounded-xl border border-slate-200 hover:border-[#1e3a6e] hover:shadow-md p-4 shadow-sm transition cursor-pointer"
        >
          <span className="text-[10px] font-extrabold uppercase text-[#1e3a6e] block">
            ERP Seta Telecom • Saldo Disponível Hoje
          </span>
          <div className="text-xl font-black text-slate-900 mt-1 group-hover:text-[#1e3a6e]">
            R$ 2.201.765,40
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Banco Inter (R$ 4,57M) • Itaú (-R$ 2,37M)
          </div>
          <div className="mt-2 pt-1.5 border-t border-slate-100 text-[11px] font-bold text-[#1e3a6e] flex items-center justify-between">
            <span>Abrir Financeiro &amp; Contas</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateToErpSection?.('ORCAMENTOS')}
          className="text-left group bg-white rounded-xl border border-slate-200 hover:border-[#ff7a59] hover:shadow-md p-4 shadow-sm transition cursor-pointer"
        >
          <span className="text-[10px] font-extrabold uppercase text-[#e05835] block">
            ERP • Orçamentos &amp; Propostas (PDF Cliente)
          </span>
          <div className="text-xl font-black text-slate-900 mt-1 group-hover:text-[#e05835]">
            2.077 Orçamentos
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Criar, editar e gerar Link PDF A4 p/ Cliente
          </div>
          <div className="mt-2 pt-1.5 border-t border-slate-100 text-[11px] font-bold text-[#e05835] flex items-center justify-between">
            <span>Abrir Orçamentos &amp; Propostas</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateToErpSection?.('CONTRATOS')}
          className="text-left group bg-white rounded-xl border border-slate-200 hover:border-emerald-600 hover:shadow-md p-4 shadow-sm transition cursor-pointer"
        >
          <span className="text-[10px] font-extrabold uppercase text-emerald-700 block">
            ERP • Contratos de Locação &amp; S/N (0% ISS)
          </span>
          <div className="text-xl font-black text-emerald-700 mt-1">
            344 Contratos Ativos
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            LC 116/03 + Súmula Vinculante 31 STF + CFOP 5.908
          </div>
          <div className="mt-2 pt-1.5 border-t border-slate-100 text-[11px] font-bold text-emerald-700 flex items-center justify-between">
            <span>Abrir Contratos &amp; Locação</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigateToServiceDesk?.()}
          className="text-left group bg-white rounded-xl border border-slate-200 hover:border-indigo-600 hover:shadow-md p-4 shadow-sm transition cursor-pointer"
        >
          <span className="text-[10px] font-extrabold uppercase text-indigo-700 block">
            CRM &amp; ERP • Service Desk &amp; O.S. Técnicas
          </span>
          <div className="text-xl font-black text-slate-900 mt-1 group-hover:text-indigo-700">
            1.378 O.S. &amp; Chamados
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Atendimento 24x7 NOC, SLA Enterprise &amp; CSAT
          </div>
          <div className="mt-2 pt-1.5 border-t border-slate-100 text-[11px] font-bold text-indigo-700 flex items-center justify-between">
            <span>Abrir Fila de Atendimento</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </button>
      </div>

      {/* WIDGET: 🗺️ ROADMAP & ESQUADRÃO DE AGENTES STI-HUB (SUPERVISOR + 9 ESPECIALISTAS) */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-[#1e3a6e] text-white uppercase">
                STI-hub • Arquitetura Multi-Agente
              </span>
              <h3 className="text-base font-extrabold text-slate-900">
                🗺️ Roadmap &amp; Esquadrão de Agentes Especialistas STI-hub
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Coordenado pelo <strong>Agente Supervisor &amp; Roadmap STI-hub</strong> • Clique em qualquer frente para abrir o módulo completo.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigateToErpSection?.('INICIO')}
            className="px-3.5 py-1.5 rounded-lg bg-[#1e3a6e] hover:bg-[#162b54] text-white text-xs font-extrabold cursor-pointer self-start sm:self-center"
          >
            Abrir Painel GestãoClick →
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 text-xs">
          {[
            { role: 'Supervisor & Roadmap', area: 'Governança & Evolução STI-hub', status: 'ATIVO • FASE 4', action: () => onNavigateToDataHealth() },
            { role: 'ERP 1 • Orçamentos & Propostas', area: 'Editor + Link PDF Cliente A4', status: '2.077 Orçamentos', action: () => onNavigateToErpSection?.('ORCAMENTOS') },
            { role: 'ERP 2 • Contratos & Locação', area: 'Gestão S/N & Reajuste IPCA/IGP-M', status: '344 Contratos', action: () => onNavigateToErpSection?.('CONTRATOS') },
            { role: 'ERP 3 • Financeiro & Bancos', area: 'Inter, Itaú, Fluxo de Caixa & DRE', status: 'R$ 2,20M Disp.', action: () => onNavigateToErpSection?.('FINANCEIRO') },
            { role: 'ERP 4 • Fiscal & Tributário', area: 'LC 116/03 + SV 31 STF (0% ISS)', status: 'Faturas & NF-e', action: () => onNavigateToErpSection?.('FISCAL') },
            { role: 'ERP 5 • Vendas, OS & Estoque', area: '295 Vendas • 1.378 O.S. • 786 Itens', status: 'Sincronizado', action: () => onNavigateToErpSection?.('VENDAS') },
            { role: 'CRM 1 • Funil & Deals Kanban', area: '3 Pipelines B2B + Forecast IA', status: 'Board Completo', action: () => onNavigateToDeals() },
            { role: 'CRM 2 • Contatos & Empresas', area: '1.184 Clientes + Enriquecimento', status: 'Base Limpa', action: () => onNavigateToContacts() },
            { role: 'CRM 3 • Atendimento & SLA', area: 'Service Desk JSM + Chamados P1', status: 'SLA >= 95%', action: () => onNavigateToServiceDesk?.() },
            { role: 'CRM 4 • Automação & BI', area: 'Workflows, Cadências & Data Health', status: 'Ativo 24x7', action: () => onNavigateToAutomations?.() },
          ].map((ag) => (
            <button
              key={ag.role}
              type="button"
              onClick={ag.action}
              className="text-left p-3 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-blue-50/60 hover:border-[#1e3a6e] transition cursor-pointer flex flex-col justify-between gap-1.5"
            >
              <div>
                <div className="font-extrabold text-[#1e3a6e] flex items-center justify-between gap-1">
                  <span className="truncate">{ag.role}</span>
                  <ArrowRight className="w-3 h-3 shrink-0" />
                </div>
                <div className="text-[11px] text-slate-600 mt-0.5">{ag.area}</div>
              </div>
              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 w-fit">
                ● {ag.status}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* FUNNEL BOTTLENECK DIAGNOSIS BY STAGE */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-slate-50/60">
          <div>
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#ff7a59]" />
              <h3 className="text-base font-bold text-slate-900">
                Diagnóstico de Gargalos por Etapa do Funil
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Análise automática de conversão entre estágios, SLA de dias parado (Deal Rotting) e capital retido.
            </p>
          </div>
          <button
            onClick={onNavigateToDeals}
            className="text-xs font-semibold text-[#ff7a59] hover:text-[#e86646] inline-flex items-center gap-1"
          >
            Inspecionar no Quadro Kanban
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {funnelBottlenecks.map((stage) => {
            const severityBadge =
              stage.severity === 'HIGH'
                ? 'bg-rose-50 text-rose-700 border-rose-200'
                : stage.severity === 'MEDIUM'
                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200';
            const severityLabel =
              stage.severity === 'HIGH'
                ? 'Gargalo Crítico'
                : stage.severity === 'MEDIUM'
                  ? 'Atenção SLA'
                  : 'Fluxo Saudável';

            return (
              <div
                key={stage.stageId}
                onClick={onNavigateToDeals}
                className={`rounded-xl border p-4 transition cursor-pointer hover:border-[#ff7a59] hover:shadow-sm ${
                  stage.isBottleneck
                    ? 'border-amber-200 bg-amber-50/30'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-800 text-white text-[11px] font-bold">
                        {stage.order}
                      </span>
                      <h4 className="text-sm font-bold text-slate-900">{stage.stageName}</h4>
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${severityBadge}`}
                      >
                        {severityLabel}
                      </span>
                      <span className="text-xs text-slate-500">
                        Prob. padrão: <strong>{stage.defaultProbability}%</strong>
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 font-medium">{stage.diagnosis}</p>
                    <p className="text-xs text-slate-500">
                      <strong className="text-slate-700">Recomendação IA:</strong> {stage.recommendation}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0 bg-white p-3 rounded-lg border border-slate-200/80">
                    <div>
                      <div className="text-[11px] text-slate-400 uppercase">Volume Total</div>
                      <div className="text-sm font-bold text-slate-900">{formatBRL(stage.totalValue)}</div>
                      <div className="text-[11px] text-slate-500">{stage.dealCount} negócio(s)</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400 uppercase">Ponderado</div>
                      <div className="text-sm font-bold text-[#ff7a59]">{formatBRL(stage.weightedValue)}</div>
                      <div className="text-[11px] text-slate-500">Conv: {stage.conversionRateToNext}%</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400 uppercase">Tempo Médio</div>
                      <div
                        className={`text-sm font-bold ${
                          stage.avgDaysInStage > stage.dealRottingDays ? 'text-rose-600' : 'text-slate-900'
                        }`}
                      >
                        {stage.avgDaysInStage} dias
                      </div>
                      <div className="text-[11px] text-slate-500">SLA: {stage.dealRottingDays} dias</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400 uppercase">Valor Retido</div>
                      <div
                        className={`text-sm font-bold ${
                          stage.stagnantValue > 0 ? 'text-rose-600' : 'text-emerald-600'
                        }`}
                      >
                        {formatBRL(stage.stagnantValue)}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {stage.rottingDealCount} estagnado(s)
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* TWO-COLUMN SECTION: AT-RISK DEALS & PRIORITY FOLLOW-UPS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Alertas de Negócios Estagnados em Risco */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-rose-50/40">
            <div>
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-600" />
                <h3 className="text-base font-bold text-slate-900">
                  Alertas de Negócios Estagnados em Risco
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Monitoramento de Deal Rotting, dias sem atividade e plano de ação imediato.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800">
              {atRiskDeals.length} monitorados
            </span>
          </div>

          <div className="p-5 space-y-3.5 flex-1">
            {atRiskDeals.map((deal) => {
              const badgeColor =
                deal.riskLevel === 'CRITICAL'
                  ? 'bg-rose-100 text-rose-800 border-rose-300'
                  : deal.riskLevel === 'HIGH'
                    ? 'bg-amber-100 text-amber-800 border-amber-300'
                    : deal.riskLevel === 'MEDIUM'
                      ? 'bg-blue-50 text-blue-700 border-blue-200'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200';

              return (
                <div
                  key={deal.dealId}
                  className={`p-4 rounded-xl border transition ${
                    deal.riskLevel === 'CRITICAL'
                      ? 'border-rose-200 bg-rose-50/20'
                      : 'border-slate-200 bg-slate-50/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[11px] font-bold border ${badgeColor}`}
                        >
                          Risco {deal.riskLevel} ({deal.riskScore}/100)
                        </span>
                        <span className="text-xs font-medium text-slate-500">
                          Etapa: <strong className="text-slate-700">{deal.stageName}</strong>
                        </span>
                      </div>
                      <h4 className="text-sm font-bold text-slate-900 mt-1">{deal.title}</h4>
                      <p className="text-xs text-slate-500">
                        {deal.companyName || 'Empresa não vinculada'} • Decisor:{' '}
                        <strong className="text-slate-700">{deal.contactName || 'Não definido'}</strong>
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-slate-900">{formatBRL(deal.value)}</div>
                      <div
                        className={`inline-flex items-center gap-1 text-xs font-semibold mt-0.5 ${
                          deal.daysSinceLastActivity > deal.dealRottingDays
                            ? 'text-rose-600'
                            : 'text-slate-500'
                        }`}
                      >
                        <Clock className="w-3 h-3" />
                        {deal.daysSinceLastActivity}d parado (SLA {deal.dealRottingDays}d)
                      </div>
                    </div>
                  </div>

                  <div className="mt-2.5 space-y-1">
                    {deal.reasons.map((r, i) => (
                      <div key={i} className="text-xs text-rose-700 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                        {r}
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="text-xs text-slate-700">
                      <strong className="text-[#e05835]">Ação Recomendada:</strong> {deal.recommendedAction}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {deal.contactId && (
                        <button
                          onClick={() => onNavigateToContacts(deal.contactId!)}
                          className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 transition"
                        >
                          Ver Contato
                        </button>
                      )}
                      <button
                        onClick={onNavigateToDeals}
                        className="px-2.5 py-1 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-semibold transition"
                      >
                        Destravar Deal
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Prioridades de Follow-up do Dia */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-orange-50/40">
            <div>
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-[#ff7a59]" />
                <h3 className="text-base font-bold text-slate-900">
                  Prioridades de Follow-up do Dia
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Fila inteligente ordenada por urgência, valor em aberto e script sugerido pela IA.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-orange-100 text-[#e05835]">
              {priorityFollowUps.length} ações hoje
            </span>
          </div>

          <div className="p-5 space-y-3.5 flex-1">
            {priorityFollowUps.slice(0, 5).map((item) => {
              const urgencyBadge =
                item.urgency === 'IMMEDIATE'
                  ? 'bg-rose-100 text-rose-800 border-rose-200'
                  : item.urgency === 'TODAY'
                    ? 'bg-amber-100 text-amber-800 border-amber-200'
                    : 'bg-blue-50 text-blue-700 border-blue-200';
              const urgencyLabel =
                item.urgency === 'IMMEDIATE'
                  ? 'Imediato'
                  : item.urgency === 'TODAY'
                    ? 'Hoje'
                    : 'Esta Semana';

              const ChannelIcon =
                item.suggestedChannel === 'CALL'
                  ? PhoneCall
                  : item.suggestedChannel === 'MEETING'
                    ? Calendar
                    : item.suggestedChannel === 'WHATSAPP'
                      ? MessageSquare
                      : Mail;

              return (
                <div
                  key={item.id}
                  className="p-4 rounded-xl border border-slate-200 bg-white hover:border-orange-200 transition space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[11px] font-bold border ${urgencyBadge}`}
                        >
                          {urgencyLabel} • Score {item.priorityScore}
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700">
                          <ChannelIcon className="w-3 h-3 text-[#ff7a59]" />
                          Canal: {item.suggestedChannel}
                        </span>
                      </div>
                      <h4 className="text-sm font-bold text-slate-900 mt-1">{item.title}</h4>
                      <p className="text-xs text-slate-600">
                        {item.contactName} {item.contactRole ? `(${item.contactRole})` : ''} •{' '}
                        {item.companyName || 'Conta Enterprise'}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-sm font-bold text-slate-900">{formatBRL(item.value)}</span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-500">{item.reason}</p>

                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 text-xs text-slate-700 italic">
                    &ldquo;{item.suggestedMessage}&rdquo;
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleCopyMessage(item.id, item.suggestedMessage)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-xs font-medium text-slate-700 transition"
                    >
                      {copiedId === item.id ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          Mensagem Copiada
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          Copiar Script
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={loggingFollowUpId === item.id}
                      onClick={() =>
                        handleQuickLog(item.id, {
                          dealId: item.dealId,
                          contactId: item.contactId,
                          title: `Follow-up Executado (${item.suggestedChannel}): ${item.title}`,
                          channel: item.suggestedChannel,
                          message: item.suggestedMessage,
                        })
                      }
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-[#1e293b] hover:bg-slate-800 text-white text-xs font-semibold transition disabled:opacity-50"
                    >
                      <Zap className="w-3.5 h-3.5 text-[#ff7a59]" />
                      {loggingFollowUpId === item.id ? 'Registrando...' : 'Registrar Follow-up'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* HIDDEN OPPORTUNITIES IN THE BASE */}
      <div className="bg-white rounded-2xl border border-indigo-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-indigo-100 bg-gradient-to-r from-indigo-50/70 via-white to-orange-50/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <h3 className="text-base font-bold text-slate-900">
                Oportunidades Ocultas na Base de Dados (Receita Destravável)
              </h3>
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              Leads C-Level com alto score, respostas positivas em cadências ou contas Enterprise enriquecidas ainda sem negócio aberto no funil.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-indigo-100 text-indigo-800">
              Potencial Total: {formatBRL(executiveSummary.unlockableRevenue)}
            </span>
            <button
              onClick={onNavigateToDataHealth}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 underline"
            >
              Ver Saúde da Base
            </button>
          </div>
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {hiddenOpportunities.length === 0 ? (
            <div className="col-span-2 text-center py-6 text-sm text-slate-500">
              Todas as oportunidades qualificadas já possuem negócios ativos no funil!
            </div>
          ) : (
            hiddenOpportunities.map((opp) => (
              <div
                key={opp.id}
                className="p-4 rounded-xl border border-indigo-100 bg-indigo-50/20 flex flex-col justify-between gap-3"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-100 text-indigo-800">
                      {opp.opportunityType === 'REPLIED_SEQUENCE_WARM_LEAD'
                        ? 'Respondeu Cadência (Quente)'
                        : opp.opportunityType === 'HIGH_SCORE_SQL_NO_DEAL'
                          ? 'SQL Alto Score sem Deal'
                          : 'Conta Enterprise sem Deal'}
                    </span>
                    <span className="text-xs font-bold text-emerald-700">
                      Potencial Est.: {formatBRL(opp.estimatedDealValue)}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-900">
                    {opp.name}{' '}
                    {opp.companyName && opp.companyName !== opp.name ? `• ${opp.companyName}` : ''}
                  </h4>
                  <p className="text-xs text-slate-600">{opp.reason}</p>
                  <p className="text-xs text-indigo-900 font-medium">
                    <strong>Sugestão IA:</strong> {opp.suggestedAction}
                  </p>
                </div>

                <div className="pt-2 border-t border-indigo-100 flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">
                    Score de Qualificação: <strong className="text-slate-800">{opp.leadScore}/100</strong>
                  </span>
                  <button
                    type="button"
                    disabled={convertingId === opp.id}
                    onClick={() => handleConvert(opp)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-semibold shadow-sm transition disabled:opacity-50"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    {convertingId === opp.id ? 'Criando Negócio...' : 'Converter em Negócio Agora'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
