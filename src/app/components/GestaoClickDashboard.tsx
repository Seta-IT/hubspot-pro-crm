'use client';

import React from 'react';
import {
  Wallet,
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCircle2,
  MinusCircle,
  Eye,
  EyeOff,
  Landmark,
  Calendar,
  Plus,
  RefreshCw,
  ArrowRight,
} from 'lucide-react';
import { ErpBankAccount, ErpDashboardSummary, GestaoClickConfig } from '../../db/types';
import type { ErpLiveDashboard } from '../../modules/erp/dashboard-metrics';
import { formatBRL } from './ui-helpers';

/**
 * Painel calculado na hora pelos dados do STI-hub (GET /api/erp/dashboard). Sem dados = zero;
 * nenhum número fixo (o antigo dashboardSummary congelado e o baseline saíram da tela em 19/11/2026).
 */
export const EMPTY_DASHBOARD_SUMMARY: ErpDashboardSummary = {
  availableBalanceToday: 0,
  bankAccountsSummaryText: 'Nenhuma conta bancária cadastrada',
  receivableToday: 0,
  receivableTodaySubtitle: 'Nenhum título vence hoje',
  payableToday: 0,
  payableTodaySubtitle: 'Nenhum título vence hoje',
  receivedMonth: 0,
  receivedMonthPlanned: 0,
  receivedMonthPercent: 0,
  paidMonth: 0,
  paidMonthPlanned: 0,
  paidMonthPercent: 0,
  cashFlowPeriodBalance: 0,
  cashFlowBestMonth: '-',
  cashFlowWorstMonth: '-',
  cashFlowMonthly: [],
  salesPeriodTotal: 0,
  salesMonthlyAverage: 0,
  salesCurrentMonthToDate: 0,
  salesMonthly: [],
};

const ACCENT = '#1e3a6e';

/** Mês corrente por extenso (pt-BR), para os rótulos 'Recebido/Pago em ...'. */
function currentMonthLabel(): string {
  return new Date().toLocaleDateString('pt-BR', { month: 'long' });
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function Gauge({ percent, color }: { percent: number; color: string }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, percent));
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" className="shrink-0">
      <circle cx="22" cy="22" r={r} fill="none" stroke="#e5e7eb" strokeWidth="5" />
      <circle
        cx="22"
        cy="22"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeDasharray={`${(p / 100) * c} ${c}`}
        strokeLinecap="round"
        transform="rotate(-90 22 22)"
      />
      <text x="22" y="26" textAnchor="middle" fontSize="10" fontWeight="700" fill="#334155">
        {Math.round(p)}%
      </text>
    </svg>
  );
}

function EmptyChart() {
  return <div className="h-52 flex items-center justify-center text-xs text-slate-400">Sem dados no período</div>;
}

/** Feitas x aprovadas (quantidade) nos últimos 6 meses, na cor única. */
function ProposalsChart({ data }: { data: ErpLiveDashboard['monthly'] }) {
  if (data.length === 0) return <EmptyChart />;
  const W = 560;
  const H = 150;
  const pad = 24;
  const max = Math.max(1, ...data.map((d) => Math.max(d.proposalsMade.count, d.proposalsApproved.count)));
  const step = (W - pad * 2) / data.length;
  const h = (v: number) => (v / max) * (H - 24);
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full h-40">
      <line x1={pad} x2={W - pad} y1={H} y2={H} stroke="#cbd5e1" />
      {data.map((d, i) => {
        const x = pad + step * i + step / 2;
        const hm = h(d.proposalsMade.count);
        const ha = h(d.proposalsApproved.count);
        return (
          <g key={d.month}>
            <rect x={x - 14} y={H - hm} width={12} height={hm} fill={ACCENT} fillOpacity="0.35" rx={1}>
              <title>{`Feitas ${d.label}: ${d.proposalsMade.count} (${formatBRL(d.proposalsMade.value)})`}</title>
            </rect>
            <rect x={x + 2} y={H - ha} width={12} height={ha} fill={ACCENT} rx={1}>
              <title>{`Aprovadas ${d.label}: ${d.proposalsApproved.count} (${formatBRL(d.proposalsApproved.value)})`}</title>
            </rect>
            <text x={x} y={H + 14} textAnchor="middle" fontSize="11" fill="#64748b">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function CashFlowChart({
  data,
  onClickChart,
}: {
  data: ErpDashboardSummary['cashFlowMonthly'];
  onClickChart: () => void;
}) {
  const W = 560;
  const H = 200;
  const pad = 30;
  if (data.length === 0) return <EmptyChart />;
  const maxAbs = Math.max(1, ...data.map((d) => Math.max(d.recebimentos, d.pagamentos, Math.abs(d.saldo))));
  const mid = H / 2;
  const scale = (v: number) => (v / maxAbs) * (H / 2 - 16);
  const step = (W - pad * 2) / data.length;
  const pts = data.map((d, i) => `${pad + step * i + step / 2},${mid - scale(d.saldo)}`).join(' ');
  return (
    <svg
      viewBox={`0 0 ${W} ${H + 20}`}
      onClick={onClickChart}
      className="w-full h-52 cursor-pointer"
    >
      <line x1={pad} x2={W - pad} y1={mid} y2={mid} stroke="#cbd5e1" />
      {data.map((d, i) => {
        const x = pad + step * i + step / 2;
        const hR = scale(d.recebimentos);
        const hP = scale(d.pagamentos);
        return (
          <g key={d.month}>
            <rect x={x - 14} y={mid - hR} width={12} height={hR} fill={ACCENT} rx={1}>
              <title>{`Recebimentos ${d.month}: ${formatBRL(d.recebimentos)} (Clique para abrir Fluxo de Caixa)`}</title>
            </rect>
            <rect x={x + 2} y={mid} width={12} height={hP} fill={ACCENT} fillOpacity="0.35" rx={1}>
              <title>{`Pagamentos ${d.month}: ${formatBRL(d.pagamentos)} (Clique para abrir Fluxo de Caixa)`}</title>
            </rect>
            <text x={x} y={H + 14} textAnchor="middle" fontSize="11" fill="#64748b">
              {d.month}
            </text>
          </g>
        );
      })}
      <polyline points={pts} fill="none" stroke="#94a3b8" strokeWidth="1.5" />
      {data.map((d, i) => (
        <circle key={`p-${d.month}`} cx={pad + step * i + step / 2} cy={mid - scale(d.saldo)} r="3" fill="#64748b">
          <title>{`Saldo ${d.month}: ${formatBRL(d.saldo)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

function SalesChart({
  data,
  onClickChart,
}: {
  data: ErpDashboardSummary['salesMonthly'];
  onClickChart: () => void;
}) {
  const W = 560;
  const H = 200;
  const pad = 30;
  if (data.length === 0) return <EmptyChart />;
  const max = Math.max(1, ...data.map((d) => d.vendas), data[0]?.media || 0) * 1.1;
  const step = (W - pad * 2) / Math.max(1, data.length - 1);
  const y = (v: number) => H - 10 - (v / max) * (H - 30);
  const pts = data.map((d, i) => ({ x: pad + step * i, y: y(d.vendas) }));
  let path = `M ${pts[0]?.x || 0} ${pts[0]?.y || 0}`;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const cx = (p0.x + p1.x) / 2;
    path += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
  }
  const area = `${path} L ${pts[pts.length - 1]?.x || 0} ${H - 10} L ${pts[0]?.x || 0} ${H - 10} Z`;
  const avgY = y(data[0]?.media || 0);
  return (
    <svg
      viewBox={`0 0 ${W} ${H + 20}`}
      onClick={onClickChart}
      className="w-full h-52 cursor-pointer"
    >
      <path d={area} fill={ACCENT} fillOpacity="0.12" />
      <path d={path} fill="none" stroke={ACCENT} strokeWidth="2" />
      <line x1={pad} x2={W - pad} y1={avgY} y2={avgY} stroke="#94a3b8" strokeDasharray="5 4" />
      {pts.map((p, i) => (
        <g key={data[i].month}>
          <circle cx={p.x} cy={p.y} r="3.5" fill="#1e3a6e">
            <title>{`Vendas ${data[i].month}: ${formatBRL(data[i].vendas)} (Clique para abrir Vendas)`}</title>
          </circle>
          <text x={p.x} y={H + 14} textAnchor="middle" fontSize="11" fill="#64748b">
            {data[i].month}
          </text>
        </g>
      ))}
    </svg>
  );
}

interface Props {
  userName?: string;
  /** Painel calculado pelo servidor (GET /api/erp/dashboard). null/undefined = ainda carregando ou falhou. */
  live?: ErpLiveDashboard | null;
  liveLoading?: boolean;
  liveError?: string | null;
  onReloadLive?: () => void;
  bankAccounts?: ErpBankAccount[];
  hideBalances: boolean;
  onToggleHide: () => void;
  onOpenSection: (section: string, subId?: string) => void;
  onNewProposal: () => void;
  /** Ausente = sem permissão (2FA + admin ou ERP FULL): o botão de sincronizar não aparece. */
  onSync?: () => void;
  syncing: boolean;
  config: GestaoClickConfig;
  serviceOrdersUpcoming: Array<{ code: string; companyName: string; entryDate: string; status: string }>;
}

export default function GestaoClickDashboard({
  userName,
  live,
  liveLoading = false,
  liveError = null,
  onReloadLive,
  bankAccounts,
  hideBalances,
  onToggleHide,
  onOpenSection,
  onNewProposal,
  onSync,
  syncing,
  config,
  serviceOrdersUpcoming,
}: Props) {
  const s = live?.summary || EMPTY_DASHBOARD_SUMMARY;
  const financeVisible = live ? live.financeVisible : true;
  const accounts = financeVisible ? bankAccounts || [] : [];
  const total = accounts.reduce((acc, a) => acc + (Number(a.balance) || 0), 0);
  const negCount = accounts.filter((a) => a.balance < 0).length;
  const money = (v: number) => (hideBalances ? 'R$ ••••••' : formatBRL(v));
  const finMoney = (v: number) => (financeVisible ? money(v) : '—');
  const totals = config.liveTotals;
  const monthShort = live?.monthLabel || new Date().toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  const made = live?.proposals.made;
  const approved = live?.proposals.approved;
  const rate = live?.proposals.approvalRate;
  const updatedAt = live?.generatedAt
    ? new Date(live.generatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
    : null;

  const clickableCard =
    'group bg-white rounded-md border border-slate-200 shadow-xs hover:border-[#1e3a6e] hover:shadow-md transition cursor-pointer';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">{greeting()}, {(userName || "Colaborador").trim().split(/\s+/)[0]}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onNewProposal}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-[#1e3a6e] hover:bg-[#162d57] text-white text-xs font-semibold shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Nova Proposta / Orçamento
          </button>
          {onSync && (
          <button
            type="button"
            onClick={onSync}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-white border border-slate-300 hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Sincronizando...' : 'Sincronizar STI HUB ERP'}
          </button>
          )}
          <span className="text-xs text-slate-500">Início</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500" data-testid="painel-tempo-real-status">
        <span>
          {liveError
            ? liveError
            : liveLoading && !live
              ? 'Calculando o painel...'
              : `Calculado agora pelos dados do STI-hub${updatedAt ? ` · atualizado às ${updatedAt}` : ''}${financeVisible ? '' : ' · valores financeiros ocultos para o seu perfil'}`}
        </span>
        {onReloadLive && (
          <button
            type="button"
            onClick={onReloadLive}
            disabled={liveLoading}
            className="inline-flex items-center gap-1 font-semibold text-[#1e3a6e] hover:underline cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${liveLoading ? 'animate-spin' : ''}`} /> Atualizar painel
          </button>
        )}
      </div>

      {/* LINHA 1: 5 FLASHCARDS FINANCEIROS CLICÁVEIS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        {/* Card 1: Saldo disponível hoje */}
        <div
          onClick={() => onOpenSection('FINANCEIRO', 'FIN_FLUXO')}
          className={`${clickableCard} p-3.5`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-slate-600 font-semibold">
              
              Saldo disponível hoje
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleHide();
              }}
              title="Ocultar/mostrar saldos"
              className="text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              {hideBalances ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <div className="text-xl font-semibold text-slate-900 mt-2 group-hover:text-[#1e3a6e]">
            {finMoney(total)}
          </div>
          <div className="text-[11px] text-slate-500">
            {accounts.length === 0 ? (
              'Nenhuma conta bancária cadastrada'
            ) : (
              <>
                {accounts.length} {accounts.length === 1 ? 'conta bancária' : 'contas bancárias'} ·{' '}
                <span className={negCount > 0 ? 'text-rose-600' : ''}>{negCount} com saldo negativo</span>
              </>
            )}
          </div>
          <div className="mt-2 pt-1.5 border-t border-slate-100 text-[10px] font-semibold text-[#1e3a6e] flex items-center justify-between">
            <span>Ver Contas &amp; Extrato</span>
            <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition" />
          </div>
        </div>

        {/* Card 2: A receber hoje */}
        <div
          onClick={() => onOpenSection('FINANCEIRO', 'FIN_RECEBER')}
          className={`${clickableCard} p-3.5 flex flex-col justify-between`}
        >
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-600 font-semibold">
              
              A receber hoje
            </div>
            <div className="text-xl font-semibold text-slate-900 mt-2 group-hover:text-[#1e3a6e]">
              {finMoney(s.receivableToday)}
            </div>
            <div className="text-[11px] text-slate-500">{s.receivableTodaySubtitle}</div>
          </div>
          <div className="mt-2 pt-1.5 border-t border-slate-100 text-[10px] font-semibold text-[#1e3a6e] flex items-center justify-between">
            <span>Abrir Contas a Receber</span>
            <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition" />
          </div>
        </div>

        {/* Card 3: A pagar hoje */}
        <div
          onClick={() => onOpenSection('FINANCEIRO', 'FIN_PAGAR')}
          className={`${clickableCard} p-3.5 flex flex-col justify-between`}
        >
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-600 font-semibold">
              
              A pagar hoje
            </div>
            <div className="text-xl font-semibold text-slate-900 mt-2 group-hover:text-[#1e3a6e]">
              {finMoney(s.payableToday)}
            </div>
            <div className="text-[11px] text-slate-500">{s.payableTodaySubtitle}</div>
          </div>
          <div className="mt-2 pt-1.5 border-t border-slate-100 text-[10px] font-semibold text-[#1e3a6e] flex items-center justify-between">
            <span>Abrir Contas a Pagar</span>
            <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition" />
          </div>
        </div>

        {/* Card 4: Recebido no mês corrente */}
        <div
          onClick={() => onOpenSection('FINANCEIRO', 'FIN_RECEBER')}
          className={`${clickableCard} p-3.5 flex flex-col justify-between`}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 text-xs text-slate-600 font-semibold">
                
                Recebido em {currentMonthLabel()}
              </div>
              <div className="text-xl font-semibold text-slate-900 mt-2 group-hover:text-[#1e3a6e]">
                {finMoney(s.receivedMonth)}
              </div>
              <div className="text-[11px] text-slate-500">
                de {finMoney(s.receivedMonthPlanned)} previstos
              </div>
            </div>
            <Gauge percent={s.receivedMonthPercent} color={ACCENT} />
          </div>
          <div className="mt-2 pt-1.5 border-t border-slate-100 text-[10px] font-semibold text-[#1e3a6e] flex items-center justify-between">
            <span>Ver Recebimentos ({live?.counts.receivedMonth ?? 0})</span>
            <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition" />
          </div>
        </div>

        {/* Card 5: Pago no mês corrente */}
        <div
          onClick={() => onOpenSection('FINANCEIRO', 'FIN_PAGAR')}
          className={`${clickableCard} p-3.5 flex flex-col justify-between`}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 text-xs text-slate-600 font-semibold">
                
                Pago em {currentMonthLabel()}
              </div>
              <div className="text-xl font-semibold text-slate-900 mt-2 group-hover:text-[#1e3a6e]">
                {finMoney(s.paidMonth)}
              </div>
              <div className="text-[11px] text-slate-500">
                de {finMoney(s.paidMonthPlanned)} previstos
              </div>
            </div>
            <Gauge percent={s.paidMonthPercent} color={ACCENT} />
          </div>
          <div className="mt-2 pt-1.5 border-t border-slate-100 text-[10px] font-semibold text-[#1e3a6e] flex items-center justify-between">
            <span>Ver Pagamentos ({live?.counts.paidMonth ?? 0})</span>
            <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition" />
          </div>
        </div>
      </div>

      {/* LINHA 1B: PROPOSTAS FEITAS x APROVADAS, FATURADO E VENDAS DO MÊS (pedido do Marcéllo, 19/11) */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <div
          onClick={() => onOpenSection('ORCAMENTOS')}
          className={`${clickableCard} p-4 xl:col-span-2`}
          data-testid="card-propostas-feitas-aprovadas"
        >
          <div className="flex items-start justify-between">
            <h3 className="text-sm font-semibold text-slate-800 group-hover:text-[#1e3a6e]">
              Propostas feitas x aprovadas em {currentMonthLabel()}
            </h3>
            <span className="text-[11px] font-semibold text-[#1e3a6e] inline-flex items-center gap-1">
              Ver propostas <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3 text-[11px]">
            <div className="p-2 rounded bg-slate-50 border border-slate-100">
              <span className="text-slate-500 block">Feitas</span>
              <strong className="text-lg text-slate-900">{made?.count ?? 0}</strong>
              <span className="block text-slate-600">{money(made?.value ?? 0)}</span>
            </div>
            <div className="p-2 rounded bg-slate-50 border border-slate-100">
              <span className="text-slate-500 block">Aprovadas</span>
              <strong className="text-lg text-[#1e3a6e]">{approved?.count ?? 0}</strong>
              <span className="block text-slate-600">{money(approved?.value ?? 0)}</span>
            </div>
            <div className="p-2 rounded bg-slate-50 border border-slate-100">
              <span className="text-slate-500 block">Taxa de aprovação</span>
              <strong className="text-lg text-slate-900">
                {rate === null || rate === undefined ? '—' : `${rate.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}
              </strong>
              <span className="block text-slate-600">aprovadas / feitas</span>
            </div>
          </div>
          <ProposalsChart data={live?.monthly || []} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 bg-[#1e3a6e]/35 inline-block" /> Feitas
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 bg-[#1e3a6e] inline-block" /> Aprovadas
              </span>
            </div>
            <span className="text-slate-500">
              Origem: STI HUB ERP {made?.bySource.stihub.count ?? 0} feitas / {approved?.bySource.stihub.count ?? 0} aprovadas · Importadas do ERP de origem{' '}
              {made?.bySource.gc.count ?? 0} / {approved?.bySource.gc.count ?? 0}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3">
        <div
          onClick={() => onOpenSection('FISCAL')}
          className={`${clickableCard} p-3.5 flex flex-col justify-between`}
          data-testid="card-faturado-mes"
        >
          <div>
            <div className="text-xs text-slate-600 font-semibold">Faturado em {currentMonthLabel()}</div>
            <div className="text-xl font-semibold text-slate-900 mt-2 group-hover:text-[#1e3a6e]">
              {finMoney(live?.invoiced?.value ?? 0)}
            </div>
            <div className="text-[11px] text-slate-500">
              {financeVisible ? `${live?.invoiced?.count ?? 0} fatura(s) emitida(s) ou paga(s)` : 'Sem alçada financeira'}
            </div>
          </div>
          <div className="mt-2 pt-1.5 border-t border-slate-100 text-[10px] font-semibold text-[#1e3a6e] flex items-center justify-between">
            <span>Ver faturas</span>
            <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition" />
          </div>
        </div>

        <div
          onClick={() => onOpenSection('VENDAS', 'VENDAS_PRODUTOS')}
          className={`${clickableCard} p-3.5 flex flex-col justify-between`}
          data-testid="card-vendas-mes"
        >
          <div>
            <div className="text-xs text-slate-600 font-semibold">Vendas em {currentMonthLabel()}</div>
            <div className="text-xl font-semibold text-slate-900 mt-2 group-hover:text-[#1e3a6e]">
              {money(live?.sales.monthTotal ?? 0)}
            </div>
            <div className="text-[11px] text-slate-500">
              Propostas aprovadas {money(live?.sales.fromProposals ?? 0)} · vendas {money(live?.sales.imported ?? 0)}
            </div>
          </div>
          <div className="mt-2 pt-1.5 border-t border-slate-100 text-[10px] font-semibold text-[#1e3a6e] flex items-center justify-between">
            <span>Ver vendas</span>
            <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition" />
          </div>
        </div>
        </div>
      </div>

      {/* LINHA 2: GRÁFICOS CLICÁVEIS */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div
          onClick={() => onOpenSection('FINANCEIRO', 'FIN_FLUXO')}
          className={`${clickableCard} p-4`}
        >
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-800 group-hover:text-[#1e3a6e]">
                Acompanhe o <span className="text-[#1e3a6e] underline">fluxo de caixa</span> →
              </h3>
              <p className="text-[11px] text-slate-500">
                Recebimentos e pagamentos de cada mês, com o saldo do período
              </p>
            </div>
            <span className="text-[11px] font-semibold text-[#1e3a6e] inline-flex items-center gap-1">
              Tela completa <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3 text-[11px]">
            <div className="p-2 rounded bg-slate-50 border border-slate-100">
              <span className="text-slate-500 block">Saldo do período</span>
              <strong className="text-slate-900">{finMoney(s.cashFlowPeriodBalance)}</strong>
            </div>
            <div className="p-2 rounded bg-slate-50 border border-slate-100">
              <span className="text-slate-500 block">Melhor mês</span>
              <strong className="text-[#1e3a6e]">{financeVisible ? s.cashFlowBestMonth : '—'}</strong>
            </div>
            <div className="p-2 rounded bg-slate-50 border border-slate-100">
              <span className="text-slate-500 block">Pior mês</span>
              <strong className="text-slate-900">{financeVisible ? s.cashFlowWorstMonth : '—'}</strong>
            </div>
          </div>
          <CashFlowChart data={s.cashFlowMonthly} onClickChart={() => onOpenSection('FINANCEIRO', 'FIN_FLUXO')} />
          <div className="flex items-center justify-between text-[11px] text-slate-600">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 bg-[#1e3a6e] inline-block" /> Recebimentos
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 bg-[#1e3a6e]/35 inline-block" /> Pagamentos
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-slate-400 inline-block" /> Saldo
              </span>
            </div>
            <span className="font-semibold text-[#1e3a6e]">Abrir Fluxo de Caixa →</span>
          </div>
        </div>

        <div
          onClick={() => onOpenSection('VENDAS', 'VENDAS_PRODUTOS')}
          className={`${clickableCard} p-4`}
        >
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-800 group-hover:text-[#1e3a6e]">
                Veja suas <span className="text-[#1e3a6e] underline">vendas</span> →
              </h3>
              <p className="text-[11px] text-slate-500">
                Total vendido por mês nos últimos seis meses
              </p>
            </div>
            <span className="text-[11px] font-semibold text-[#1e3a6e] inline-flex items-center gap-1">
              Ver todas as vendas <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3 text-[11px]">
            <div className="p-2 rounded bg-slate-50 border border-slate-100">
              <span className="text-slate-500 block">Vendas no período</span>
              <strong className="text-slate-900">{money(s.salesPeriodTotal)}</strong>
            </div>
            <div className="p-2 rounded bg-slate-50 border border-slate-100">
              <span className="text-slate-500 block">Média mensal</span>
              <strong className="text-slate-900">{money(s.salesMonthlyAverage)}</strong>
            </div>
            <div className="p-2 rounded bg-blue-50/50 border border-blue-100">
              <span className="text-slate-500 block">{monthShort} até hoje</span>
              <strong className="text-[#1e3a6e]">{money(s.salesCurrentMonthToDate)}</strong>
            </div>
          </div>
          <SalesChart data={s.salesMonthly} onClickChart={() => onOpenSection('VENDAS', 'VENDAS_PRODUTOS')} />
          <div className="flex items-center justify-between text-[11px] text-slate-600">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 bg-[#1e3a6e] inline-block" /> Vendas
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 border-t border-dashed border-slate-400 inline-block" /> Média
              </span>
            </div>
            <span className="font-semibold text-[#1e3a6e]">Abrir Pedidos de Venda →</span>
          </div>
        </div>
      </div>

      {/* LINHA 3: CONTAS BANCÁRIAS CLICÁVEIS + AGENDA CLICÁVEL */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-white rounded-md border border-slate-200 shadow-xs p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                Saldo das{' '}
                <span className="text-[#1e3a6e]">contas bancárias</span>
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onOpenSection('FINANCEIRO', 'FIN_BOLETOS')}
              className="text-xs font-semibold text-[#1e3a6e] hover:underline cursor-pointer"
            >
              Tela completa →
            </button>
          </div>
          <div className="mt-3 divide-y divide-slate-100 border-y border-slate-100">
            {accounts.map((a) => (
              <div
                key={a.id}
                onClick={() => onOpenSection('FINANCEIRO', 'FIN_FLUXO')}
                className="font-semibold flex items-center justify-between py-2.5 px-2 rounded hover:bg-blue-50/60 transition cursor-pointer text-xs"
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-7 h-7 rounded bg-slate-100 flex items-center justify-center">
                    <Landmark className="w-3.5 h-3.5 text-[#1e3a6e]" />
                  </span>
                  <div>
                    <div className="font-semibold text-[#1e3a6e] hover:underline">{a.name}</div>
                    <div className="text-[10px] text-slate-500">{a.lastMovedAt}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`font-semibold ${a.balance < 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                    {money(a.balance)}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between pt-3 text-xs">
            <span className="font-semibold text-slate-800">Total disponível</span>
            <span className="font-semibold text-slate-900">{money(total)}</span>
          </div>
          <div className="flex justify-end mt-3">
            <button
              type="button"
              onClick={() => onOpenSection('FINANCEIRO', 'FIN_FLUXO')}
              className="px-3 py-1.5 rounded border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Ver contas bancárias
            </button>
          </div>
        </div>

        <div className="bg-white rounded-md border border-slate-200 shadow-xs p-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                Sua{' '}
                <span className="text-[#1e3a6e]">agenda &amp; O.S.</span>
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onOpenSection('ORDENS_SERVICOS', 'OS_GERENCIAR')}
              className="px-3 py-1.5 rounded border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Abrir agenda ({totals?.ordensServicos ?? serviceOrdersUpcoming.length} O.S.)
            </button>
          </div>
          {serviceOrdersUpcoming.length === 0 ? (
            <div
              onClick={() => onOpenSection('ORDENS_SERVICOS', 'OS_GERENCIAR')}
              className="text-center py-10 cursor-pointer hover:bg-slate-50 rounded transition"
            >
              <Calendar className="w-6 h-6 text-slate-400 mx-auto" />
              <div className="text-xs font-semibold text-slate-700 mt-2">Nenhum compromisso agendado</div>
              <div className="text-[11px] text-slate-500">
                Os agendamentos em que você é o responsável aparecem aqui, de hoje em diante
              </div>
              <button
                type="button"
                className="mt-3 px-3 py-1.5 rounded border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Novo agendamento
              </button>
            </div>
          ) : (
            <div className="mt-3 divide-y divide-slate-100">
              {serviceOrdersUpcoming.slice(0, 5).map((os) => (
                <div
                  key={os.code}
                  onClick={() => onOpenSection('ORDENS_SERVICOS', 'OS_GERENCIAR')}
                  className="font-semibold py-2 px-2 rounded hover:bg-blue-50/60 transition cursor-pointer flex items-center justify-between text-xs"
                >
                  <div>
                    <div className="font-semibold text-[#1e3a6e] hover:underline">
                      OS #{os.code} — {os.companyName}
                    </div>
                    <div className="text-[10px] text-slate-500">Entrada: {os.entryDate}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-semibold">
                      {os.status}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
