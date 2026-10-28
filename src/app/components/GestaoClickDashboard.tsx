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
  Settings,
  Sparkles,
  RefreshCw,
  ArrowRight,
} from 'lucide-react';
import { ErpBankAccount, ErpDashboardSummary, GestaoClickConfig } from '../../db/types';
import { formatBRL } from './ui-helpers';

export const SETA_DASHBOARD_BASELINE: ErpDashboardSummary = {
  availableBalanceToday: 2201765.4,
  bankAccountsSummaryText: '3 contas bancárias · 1 com saldo negativo',
  receivableToday: 0,
  receivableTodaySubtitle: 'Nenhum título vence hoje',
  payableToday: 2476.8,
  payableTodaySubtitle: '2 títulos vencem hoje',
  receivedMonth: 287508.95,
  receivedMonthPlanned: 288468.95,
  receivedMonthPercent: 100,
  paidMonth: 167157.67,
  paidMonthPlanned: 272898.07,
  paidMonthPercent: 61,
  cashFlowPeriodBalance: 804185.24,
  cashFlowBestMonth: 'set · R$ 302.303,45',
  cashFlowWorstMonth: 'jul · -R$ 12.784,56',
  cashFlowMonthly: [
    { month: 'mai', recebimentos: 418200, pagamentos: 245100, saldo: 173100 },
    { month: 'jun', recebimentos: 325400, pagamentos: 212800, saldo: 112600 },
    { month: 'jul', recebimentos: 278900, pagamentos: 291684.56, saldo: -12784.56 },
    { month: 'ago', recebimentos: 312450, pagamentos: 203832.37, saldo: 108617.63 },
    { month: 'set', recebimentos: 489120.45, pagamentos: 186817, saldo: 302303.45 },
    { month: 'out', recebimentos: 287508.95, pagamentos: 167157.67, saldo: 120351.28 },
  ],
  salesPeriodTotal: 207113.75,
  salesMonthlyAverage: 34518.96,
  salesCurrentMonthToDate: 6690,
  salesMonthly: [
    { month: 'mai', vendas: 4820, media: 34518.96 },
    { month: 'jun', vendas: 22450, media: 34518.96 },
    { month: 'jul', vendas: 18950, media: 34518.96 },
    { month: 'ago', vendas: 3203.75, media: 34518.96 },
    { month: 'set', vendas: 151000, media: 34518.96 },
    { month: 'out', vendas: 6690, media: 34518.96 },
  ],
};

export const SETA_BANK_BASELINE: ErpBankAccount[] = [
  { id: '237906', name: 'Banco Inter', lastMovedAt: 'Movimentada em 26/10/2026', balance: 4572238.02, status: 'POSITIVE' },
  { id: '142155', name: 'Banco Itaú', lastMovedAt: 'Movimentada em 26/10/2026', balance: -2370472.62, status: 'NEGATIVE' },
  { id: '710407', name: 'Conta Integrada', lastMovedAt: 'Sem movimentação', balance: 0, status: 'ZERO' },
];

const GC_APPS: Array<{
  name: string;
  desc: string;
  color: string;
  badge?: string;
  tag?: string;
  targetSection: string;
  targetSubId?: string;
}> = [
  { name: 'Área do Cliente', desc: 'Ofereça um canal inteligente para organizar e gerenciar atendimentos', color: 'bg-sky-600', targetSection: 'ATENDIMENTOS', targetSubId: 'ATENDIMENTOS' },
  { name: 'Banco Inter', desc: 'Conta PJ com emissão gratuita de boletos', color: 'bg-orange-500', tag: 'inter', targetSection: 'FINANCEIRO', targetSubId: 'FIN_BOLETOS' },
  { name: 'API (ERP-GROK)', desc: 'Integração com seu app ou site, acessível de qualquer lugar', color: 'bg-rose-600', tag: 'API', badge: 'CONECTADO', targetSection: 'CONFIGURACOES', targetSubId: 'CFG_GERAIS' },
  { name: 'Cobranças', desc: 'Envie alertas automáticos de cobrança por e-mail antes e após o vencimento', color: 'bg-cyan-500', targetSection: 'FINANCEIRO', targetSubId: 'FIN_RECEBER' },
  { name: 'Controle de Bens', desc: 'Gerencie patrimônio, depreciação e movimentação facilmente', color: 'bg-rose-500', targetSection: 'ESTOQUE', targetSubId: 'EST_MOVIMENTACOES' },
  { name: 'C6 Bank', desc: 'Boletos, Pix e Extrato integrados ao erp em 100% API', color: 'bg-slate-900', badge: 'Novo', targetSection: 'FINANCEIRO', targetSubId: 'FIN_BOLETOS' },
  { name: 'Melhor Envio', desc: 'Integre o Melhor Envio ao ERP e automatize envios, etiquetas e rastreamento', color: 'bg-blue-600', badge: 'Novo', targetSection: 'VENDAS', targetSubId: 'VENDAS_PRODUTOS' },
  { name: 'Criador de site', desc: 'Desenvolva e gerencie o site da sua empresa pelo erp, com total controle', color: 'bg-sky-700', badge: 'Novo', targetSection: 'ORCAMENTOS', targetSubId: 'ORC_PRODUTOS' },
  { name: 'Asaas', desc: 'Soluções de pagamento, cobrança e antecipação para sua empresa vender com segurança', color: 'bg-blue-800', badge: 'Novo', targetSection: 'FINANCEIRO', targetSubId: 'FIN_RECEBER' },
  { name: 'Conta Integrada', desc: 'Receba e envie pagamentos diretamente pelo ERP com Boletos e Pix integrados', color: 'bg-indigo-700', badge: 'Novo', targetSection: 'FINANCEIRO', targetSubId: 'FIN_FLUXO' },
  { name: 'Recursos Humanos', desc: 'Gerencie o ciclo completo de colaboradores, do recrutamento ao desligamento', color: 'bg-red-600', targetSection: 'CADASTROS', targetSubId: 'CAD_FUNCIONARIOS' },
  { name: 'Assinatura Digital', desc: 'Assine documentos digitalmente e com segurança jurídica pelo sistema', color: 'bg-amber-500', badge: 'Novo', targetSection: 'CONTRATOS', targetSubId: 'CTR_ASSINATURAS' },
];

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
            <rect x={x - 14} y={mid - hR} width={12} height={hR} fill="#15803d" rx={1}>
              <title>{`Recebimentos ${d.month}: ${formatBRL(d.recebimentos)} (Clique para abrir Fluxo de Caixa)`}</title>
            </rect>
            <rect x={x + 2} y={mid} width={12} height={hP} fill="#dc2626" rx={1}>
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
      <path d={area} fill="#1e3a6e" fillOpacity="0.12" />
      <path d={path} fill="none" stroke="#1e3a6e" strokeWidth="2" />
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
  summary?: ErpDashboardSummary;
  bankAccounts?: ErpBankAccount[];
  hideBalances: boolean;
  onToggleHide: () => void;
  onOpenSection: (section: string, subId?: string) => void;
  onNewProposal: () => void;
  onSync: () => void;
  syncing: boolean;
  config: GestaoClickConfig;
  serviceOrdersUpcoming: Array<{ code: string; companyName: string; entryDate: string; status: string }>;
}

export default function GestaoClickDashboard({
  userName,
  summary,
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
  const s = summary || SETA_DASHBOARD_BASELINE;
  const accounts = bankAccounts && bankAccounts.length > 0 ? bankAccounts : SETA_BANK_BASELINE;
  const total = accounts.reduce((acc, a) => acc + a.balance, 0);
  const negCount = accounts.filter((a) => a.balance < 0).length;
  const money = (v: number) => (hideBalances ? 'R$ ••••••' : formatBRL(v));
  const totals = config.liveTotals;

  const clickableCard =
    'group bg-white rounded-md border border-slate-200 shadow-xs hover:border-[#1e3a6e] hover:shadow-md transition cursor-pointer';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">{greeting()}, {(userName || "Colaborador").trim().split(/\s+/)[0]}</h1>
          <p className="text-[11px] text-slate-500">
            Clique em qualquer card, gráfico, conta bancária ou aplicativo abaixo para abrir a tela completa correspondente.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onNewProposal}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-semibold shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Nova Proposta / Orçamento
          </button>
          <button
            type="button"
            onClick={onSync}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-white border border-slate-300 hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Sincronizando...' : 'Sincronizar GestãoClick'}
          </button>
          <span className="text-xs text-slate-500">Início</span>
        </div>
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
            {money(total)}
          </div>
          <div className="text-[11px] text-slate-500">
            {accounts.length} contas bancárias ·{' '}
            <span className="text-rose-600">{negCount} com saldo negativo</span>
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
            <div className="text-xl font-semibold text-slate-900 mt-2 group-hover:text-emerald-700">
              {money(s.receivableToday)}
            </div>
            <div className="text-[11px] text-slate-500">{s.receivableTodaySubtitle}</div>
          </div>
          <div className="mt-2 pt-1.5 border-t border-slate-100 text-[10px] font-semibold text-emerald-700 flex items-center justify-between">
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
            <div className="text-xl font-semibold text-slate-900 mt-2 group-hover:text-rose-700">
              {money(s.payableToday)}
            </div>
            <div className="text-[11px] text-slate-500">{s.payableTodaySubtitle}</div>
          </div>
          <div className="mt-2 pt-1.5 border-t border-slate-100 text-[10px] font-semibold text-rose-700 flex items-center justify-between">
            <span>Abrir Contas a Pagar</span>
            <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition" />
          </div>
        </div>

        {/* Card 4: Recebido em outubro */}
        <div
          onClick={() => onOpenSection('FINANCEIRO', 'FIN_RECEBER')}
          className={`${clickableCard} p-3.5 flex flex-col justify-between`}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 text-xs text-slate-600 font-semibold">
                
                Recebido em outubro
              </div>
              <div className="text-xl font-semibold text-slate-900 mt-2 group-hover:text-emerald-700">
                {money(s.receivedMonth)}
              </div>
              <div className="text-[11px] text-slate-500">
                de {money(s.receivedMonthPlanned)} previstos
              </div>
            </div>
            <Gauge percent={s.receivedMonthPercent} color="#16a34a" />
          </div>
          <div className="mt-2 pt-1.5 border-t border-slate-100 text-[10px] font-semibold text-emerald-700 flex items-center justify-between">
            <span>Ver Recebimentos ({totals?.recebimentos ?? 153})</span>
            <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition" />
          </div>
        </div>

        {/* Card 5: Pago em outubro */}
        <div
          onClick={() => onOpenSection('FINANCEIRO', 'FIN_PAGAR')}
          className={`${clickableCard} p-3.5 flex flex-col justify-between`}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 text-xs text-slate-600 font-semibold">
                
                Pago em outubro
              </div>
              <div className="text-xl font-semibold text-slate-900 mt-2 group-hover:text-rose-700">
                {money(s.paidMonth)}
              </div>
              <div className="text-[11px] text-slate-500">
                de {money(s.paidMonthPlanned)} previstos
              </div>
            </div>
            <Gauge percent={s.paidMonthPercent} color="#dc2626" />
          </div>
          <div className="mt-2 pt-1.5 border-t border-slate-100 text-[10px] font-semibold text-rose-700 flex items-center justify-between">
            <span>Ver Pagamentos ({totals?.pagamentos ?? 43})</span>
            <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition" />
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
                Acompanhe o <span className="text-blue-700 underline">fluxo de caixa</span> →
              </h3>
              <p className="text-[11px] text-slate-500">
                Recebimentos e pagamentos de cada mês, com o saldo do período (Clique para abrir Fluxo de Caixa / DRE)
              </p>
            </div>
            <span className="text-[11px] font-semibold text-[#1e3a6e] inline-flex items-center gap-1">
              Tela completa <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3 text-[11px]">
            <div className="p-2 rounded bg-slate-50 border border-slate-100">
              <span className="text-slate-500 block">Saldo do período</span>
              <strong className="text-slate-900">{money(s.cashFlowPeriodBalance)}</strong>
            </div>
            <div className="p-2 rounded bg-emerald-50/50 border border-emerald-100">
              <span className="text-slate-500 block">Melhor mês</span>
              <strong className="text-emerald-800">{s.cashFlowBestMonth}</strong>
            </div>
            <div className="p-2 rounded bg-rose-50/50 border border-rose-100">
              <span className="text-slate-500 block">Pior mês</span>
              <strong className="text-rose-600">{s.cashFlowWorstMonth}</strong>
            </div>
          </div>
          <CashFlowChart data={s.cashFlowMonthly} onClickChart={() => onOpenSection('FINANCEIRO', 'FIN_FLUXO')} />
          <div className="flex items-center justify-between text-[11px] text-slate-600">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 bg-green-700 inline-block" /> Recebimentos
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 bg-red-600 inline-block" /> Pagamentos
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
                Veja suas <span className="text-blue-700 underline">vendas</span> →
              </h3>
              <p className="text-[11px] text-slate-500">
                Total vendido por mês nos últimos seis meses (Clique para abrir os {totals?.vendas ?? 295} pedidos de venda)
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
              <span className="text-slate-500 block">out até hoje</span>
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
                <span className="text-blue-700">contas bancárias</span>
              </h3>
              <p className="text-[11px] text-slate-500">
                Clique em qualquer conta abaixo para abrir ou editar o saldo e movimentações
              </p>
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
                className="flex items-center justify-between py-2.5 px-2 rounded hover:bg-blue-50/60 transition cursor-pointer text-xs"
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
                <span className="text-blue-700">agenda &amp; O.S.</span>
              </h3>
              <p className="text-[11px] text-slate-500">
                Clique em qualquer Ordem de Serviço para abrir e editar o atendimento
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenSection('ORDENS_SERVICOS', 'OS_GERENCIAR')}
              className="px-3 py-1.5 rounded border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Abrir agenda ({totals?.ordensServicos ?? 1378} O.S.)
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
                  className="py-2 px-2 rounded hover:bg-blue-50/60 transition cursor-pointer flex items-center justify-between text-xs"
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

      {/* LINHA 4: APLICATIVOS CLICÁVEIS + INDICADORES GESTÃOCLICK CLICÁVEIS */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-white rounded-md border border-slate-200 shadow-xs p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">
                Seus <span className="text-blue-700">aplicativos</span> (Clicáveis)
              </h3>
              <p className="text-[11px] text-slate-500">
                Clique em qualquer módulo contratado para abrir sua tela completa
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-3">
            {GC_APPS.map((app) => (
              <button
                key={app.name}
                type="button"
                onClick={() => onOpenSection(app.targetSection, app.targetSubId)}
                className="text-left p-2 rounded-md border border-transparent hover:border-[#1e3a6e]/40 hover:bg-blue-50/40 flex items-start gap-2.5 transition cursor-pointer"
              >
                <span
                  className={`w-8 h-8 rounded ${app.color} text-white text-[10px] font-semibold flex items-center justify-center shrink-0`}
                >
                  {app.tag || app.name.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-[#1e3a6e] flex items-center justify-between gap-1">
                    <span className="truncate">{app.name}</span>
                    {app.badge && (
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-semibold shrink-0 ${
                          app.badge === 'CONECTADO'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {app.badge}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 leading-snug line-clamp-2">
                    {app.desc}
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div className="flex justify-end mt-3">
            <button
              type="button"
              onClick={() => onOpenSection('CONFIGURACOES', 'CFG_GERAIS')}
              className="px-3 py-1.5 rounded border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Ver todos os aplicativos
            </button>
          </div>
        </div>

        <div className="bg-white rounded-md border border-slate-200 shadow-xs p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                Base Real Sincronizada &amp;{' '}
                <span className="text-blue-700">Novidades</span>
              </h3>
              <p className="text-[11px] text-slate-500">
                Clique em qualquer indicador da Seta Telecom para abrir os registros completos
              </p>
            </div>
          </div>

          {/* CLICKABLE MINI FLASHCARDS FOR ALL GESTÃOCLICK TOTALS */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {[
              { label: 'Clientes', val: totals?.clientes ?? 1184, sec: 'CADASTROS', sub: 'CAD_CLIENTES' },
              { label: 'Produtos', val: totals?.produtos ?? 786, sec: 'ITENS', sub: 'ITENS_PRODUTOS' },
              { label: 'Serviços', val: totals?.servicos ?? 39, sec: 'ITENS', sub: 'ITENS_SERVICOS' },
              { label: 'Orçamentos', val: totals?.orcamentos ?? 2077, sec: 'ORCAMENTOS', sub: 'ORC_PRODUTOS' },
              { label: 'Vendas', val: totals?.vendas ?? 295, sec: 'VENDAS', sub: 'VENDAS_PRODUTOS' },
              { label: 'Contratos Loc.', val: totals?.contratos ?? 344, sec: 'CONTRATOS', sub: 'CTR_LOCACOES' },
              { label: 'Ordens Serv.', val: totals?.ordensServicos ?? 1378, sec: 'ORDENS_SERVICOS', sub: 'OS_GERENCIAR' },
              { label: 'Fornecedores', val: totals?.fornecedores ?? 101, sec: 'CADASTROS', sub: 'CAD_FORNECEDORES' },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => onOpenSection(item.sec, item.sub)}
                className="p-2.5 rounded border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-[#1e3a6e] text-left transition cursor-pointer"
              >
                <span className="text-[10px] text-slate-500 block">{item.label}</span>
                <div className="flex items-center justify-between mt-0.5">
                  <strong className="text-sm font-semibold text-[#1e3a6e]">{item.val}</strong>
                  <ArrowRight className="w-3 h-3 text-[#1e3a6e]" />
                </div>
              </button>
            ))}
          </div>

          <div className="space-y-2 pt-1">
            {[
              { t: 'Propostas Comerciais: Edição completa + Link público PDF A4 para o cliente', d: '26/10/2026', sec: 'ORCAMENTOS' },
              { t: 'Vender fora: crédito do cliente para usar em compras futuras', d: '22/10/2026', sec: 'VENDAS' },
              { t: 'Estoque: Localização de item e controle por Número de Série (S/N)', d: '15/10/2026', sec: 'ESTOQUE' },
              { t: 'Fiscal: Segregação automática Fatura de Locação 0% ISS (SV 31 STF)', d: '09/10/2026', sec: 'FISCAL' },
            ].map((item) => (
              <button
                key={item.t}
                type="button"
                onClick={() => onOpenSection(item.sec)}
                className="w-full flex items-start justify-between gap-2 text-xs border-b border-slate-100 pb-2 hover:text-[#1e3a6e] text-left cursor-pointer"
              >
                <span className="text-slate-700 font-semibold hover:underline">{item.t}</span>
                <span className="text-[10px] text-slate-400 shrink-0">{item.d}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
