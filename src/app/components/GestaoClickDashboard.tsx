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

const GC_APPS: Array<{ name: string; desc: string; color: string; badge?: string; tag?: string }> = [
  { name: 'Área do Cliente', desc: 'Ofereça um canal inteligente para organizar e gerenciar atendimentos', color: 'bg-sky-600' },
  { name: 'Banco Inter', desc: 'Conta PJ com emissão gratuita de boletos', color: 'bg-orange-500', tag: 'inter' },
  { name: 'API (ERP-GROK)', desc: 'Integração com seu app ou site, acessível de qualquer lugar', color: 'bg-rose-600', tag: 'API', badge: 'CONECTADO' },
  { name: 'Cobranças', desc: 'Envie alertas automáticos de cobrança por e-mail antes e após o vencimento', color: 'bg-cyan-500' },
  { name: 'Controle de Bens', desc: 'Gerencie patrimônio, depreciação e movimentação facilmente', color: 'bg-rose-500' },
  { name: 'C6 Bank', desc: 'Boletos, Pix e Extrato integrados ao erp em 100% API', color: 'bg-slate-900', badge: 'Novo' },
  { name: 'Melhor Envio', desc: 'Integre o Melhor Envio ao ERP e automatize envios, etiquetas e rastreamento', color: 'bg-blue-600', badge: 'Novo' },
  { name: 'Criador de site', desc: 'Desenvolva e gerencie o site da sua empresa pelo erp, com total controle', color: 'bg-sky-700', badge: 'Novo' },
  { name: 'Asaas', desc: 'Soluções de pagamento, cobrança e antecipação para sua empresa vender com segurança', color: 'bg-blue-800', badge: 'Novo' },
  { name: 'Conta Integrada', desc: 'Receba e envie pagamentos diretamente pelo ERP com Boletos e Pix integrados', color: 'bg-indigo-700', badge: 'Novo' },
  { name: 'Recursos Humanos', desc: 'Gerencie o ciclo completo de colaboradores, do recrutamento ao desligamento', color: 'bg-red-600' },
  { name: 'Assinatura Digital', desc: 'Assine documentos digitalmente e com segurança jurídica pelo sistema', color: 'bg-amber-500', badge: 'Novo' },
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

function CashFlowChart({ data }: { data: ErpDashboardSummary['cashFlowMonthly'] }) {
  const W = 560;
  const H = 200;
  const pad = 30;
  const maxAbs = Math.max(1, ...data.map((d) => Math.max(d.recebimentos, d.pagamentos, Math.abs(d.saldo))));
  const mid = H / 2;
  const scale = (v: number) => (v / maxAbs) * (H / 2 - 16);
  const step = (W - pad * 2) / data.length;
  const pts = data.map((d, i) => `${pad + step * i + step / 2},${mid - scale(d.saldo)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H + 20}`} className="w-full h-52">
      <line x1={pad} x2={W - pad} y1={mid} y2={mid} stroke="#cbd5e1" />
      {data.map((d, i) => {
        const x = pad + step * i + step / 2;
        const hR = scale(d.recebimentos);
        const hP = scale(d.pagamentos);
        return (
          <g key={d.month}>
            <rect x={x - 14} y={mid - hR} width={12} height={hR} fill="#15803d" rx={1}>
              <title>{`Recebimentos ${d.month}: ${formatBRL(d.recebimentos)}`}</title>
            </rect>
            <rect x={x + 2} y={mid} width={12} height={hP} fill="#dc2626" rx={1}>
              <title>{`Pagamentos ${d.month}: ${formatBRL(d.pagamentos)}`}</title>
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

function SalesChart({ data }: { data: ErpDashboardSummary['salesMonthly'] }) {
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
    <svg viewBox={`0 0 ${W} ${H + 20}`} className="w-full h-52">
      <path d={area} fill="#1e3a6e" fillOpacity="0.12" />
      <path d={path} fill="none" stroke="#1e3a6e" strokeWidth="2" />
      <line x1={pad} x2={W - pad} y1={avgY} y2={avgY} stroke="#94a3b8" strokeDasharray="5 4" />
      {pts.map((p, i) => (
        <g key={data[i].month}>
          <circle cx={p.x} cy={p.y} r="3.5" fill="#1e3a6e">
            <title>{`Vendas ${data[i].month}: ${formatBRL(data[i].vendas)}`}</title>
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
  summary?: ErpDashboardSummary;
  bankAccounts?: ErpBankAccount[];
  hideBalances: boolean;
  onToggleHide: () => void;
  onOpenSection: (section: string) => void;
  onNewProposal: () => void;
  onSync: () => void;
  syncing: boolean;
  config: GestaoClickConfig;
  serviceOrdersUpcoming: Array<{ code: string; companyName: string; entryDate: string; status: string }>;
}

export default function GestaoClickDashboard({
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

  const card = 'bg-white rounded-md border border-slate-200 shadow-xs';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-slate-800">{greeting()}, Marcelo</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onNewProposal}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Nova Proposta / Orçamento
          </button>
          <button
            type="button"
            onClick={onSync}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-white border border-slate-300 hover:bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Sincronizando...' : 'Sincronizar GestãoClick'}
          </button>
          <span className="text-xs text-slate-500">🏠 Início</span>
        </div>
      </div>

      {/* LINHA 1: 5 CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        <div className={`${card} p-3.5`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span className="w-7 h-7 rounded bg-blue-50 text-blue-700 flex items-center justify-center"><Wallet className="w-4 h-4" /></span>
              Saldo disponível hoje
            </div>
            <button type="button" onClick={onToggleHide} title="Ocultar/mostrar saldos" className="text-slate-400 hover:text-slate-700 cursor-pointer">
              {hideBalances ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <div className="text-xl font-extrabold text-slate-900 mt-2">{money(total)}</div>
          <div className="text-[11px] text-slate-500">
            {accounts.length} contas bancárias · <span className="text-rose-600">{negCount} com saldo negativo</span>
          </div>
        </div>

        <div className={`${card} p-3.5`}>
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span className="w-7 h-7 rounded bg-emerald-50 text-emerald-700 flex items-center justify-center"><ArrowDownCircle className="w-4 h-4" /></span>
            A receber hoje
          </div>
          <div className="text-xl font-extrabold text-slate-900 mt-2">{money(s.receivableToday)}</div>
          <div className="text-[11px] text-slate-500">{s.receivableTodaySubtitle}</div>
        </div>

        <div className={`${card} p-3.5`}>
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span className="w-7 h-7 rounded bg-rose-50 text-rose-700 flex items-center justify-center"><ArrowUpCircle className="w-4 h-4" /></span>
            A pagar hoje
          </div>
          <div className="text-xl font-extrabold text-slate-900 mt-2">{money(s.payableToday)}</div>
          <div className="text-[11px] text-slate-500">{s.payableTodaySubtitle}</div>
        </div>

        <div className={`${card} p-3.5 flex items-center justify-between gap-2`}>
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span className="w-7 h-7 rounded bg-emerald-50 text-emerald-700 flex items-center justify-center"><CheckCircle2 className="w-4 h-4" /></span>
              Recebido em outubro
            </div>
            <div className="text-xl font-extrabold text-slate-900 mt-2">{money(s.receivedMonth)}</div>
            <div className="text-[11px] text-slate-500">de {money(s.receivedMonthPlanned)} previstos</div>
          </div>
          <Gauge percent={s.receivedMonthPercent} color="#16a34a" />
        </div>

        <div className={`${card} p-3.5 flex items-center justify-between gap-2`}>
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span className="w-7 h-7 rounded bg-rose-50 text-rose-700 flex items-center justify-center"><MinusCircle className="w-4 h-4" /></span>
              Pago em outubro
            </div>
            <div className="text-xl font-extrabold text-slate-900 mt-2">{money(s.paidMonth)}</div>
            <div className="text-[11px] text-slate-500">de {money(s.paidMonthPlanned)} previstos</div>
          </div>
          <Gauge percent={s.paidMonthPercent} color="#dc2626" />
        </div>
      </div>

      {/* LINHA 2: GRÁFICOS */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-4`}>
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-800">Acompanhe o <span className="text-blue-700">fluxo de caixa</span></h3>
              <p className="text-[11px] text-slate-500">Recebimentos e pagamentos de cada mês, com o saldo do período</p>
            </div>
            <button type="button" onClick={() => onOpenSection('FINANCEIRO')} className="text-slate-400 hover:text-slate-700 cursor-pointer"><Settings className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3 text-[11px]">
            <div><span className="text-slate-500 block">Saldo do período</span><strong className="text-slate-900">{money(s.cashFlowPeriodBalance)}</strong></div>
            <div><span className="text-slate-500 block">Melhor mês</span><strong className="text-slate-900">{s.cashFlowBestMonth}</strong></div>
            <div><span className="text-slate-500 block">Pior mês</span><strong className="text-rose-600">{s.cashFlowWorstMonth}</strong></div>
          </div>
          <CashFlowChart data={s.cashFlowMonthly} />
          <div className="flex items-center gap-4 text-[11px] text-slate-600">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-green-700 inline-block" /> Recebimentos</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-red-600 inline-block" /> Pagamentos</span>
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-slate-400 inline-block" /> Saldo</span>
          </div>
        </div>

        <div className={`${card} p-4`}>
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-800">Veja suas <span className="text-blue-700">vendas</span></h3>
              <p className="text-[11px] text-slate-500">Total vendido por mês nos últimos seis meses</p>
            </div>
            <button type="button" onClick={() => onOpenSection('VENDAS')} className="text-slate-400 hover:text-slate-700 cursor-pointer"><Settings className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3 text-[11px]">
            <div><span className="text-slate-500 block">Vendas no período</span><strong className="text-slate-900">{money(s.salesPeriodTotal)}</strong></div>
            <div><span className="text-slate-500 block">Média mensal</span><strong className="text-slate-900">{money(s.salesMonthlyAverage)}</strong></div>
            <div><span className="text-slate-500 block">out até hoje</span><strong className="text-slate-900">{money(s.salesCurrentMonthToDate)}</strong></div>
          </div>
          <SalesChart data={s.salesMonthly} />
          <div className="flex items-center gap-4 text-[11px] text-slate-600">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-[#1e3a6e] inline-block" /> Vendas</span>
            <span className="flex items-center gap-1"><span className="w-3 border-t border-dashed border-slate-400 inline-block" /> Média</span>
          </div>
        </div>
      </div>

      {/* LINHA 3: CONTAS + AGENDA */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-4`}>
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><Landmark className="w-4 h-4 text-slate-500" /> Saldo das <span className="text-blue-700">contas bancárias</span></h3>
          <p className="text-[11px] text-slate-500">Saldo atual de cada conta e o total disponível</p>
          <div className="mt-3 divide-y divide-slate-100 border-y border-slate-100">
            {accounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between py-2.5 text-xs">
                <div className="flex items-center gap-2.5">
                  <span className="w-7 h-7 rounded bg-slate-100 flex items-center justify-center"><Landmark className="w-3.5 h-3.5 text-slate-600" /></span>
                  <div>
                    <div className="font-semibold text-slate-800">{a.name}</div>
                    <div className="text-[10px] text-slate-500">{a.lastMovedAt}</div>
                  </div>
                </div>
                <span className={`font-bold ${a.balance < 0 ? 'text-rose-600' : 'text-slate-900'}`}>{money(a.balance)}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between pt-3 text-xs">
            <span className="font-bold text-slate-800">Total disponível</span>
            <span className="font-extrabold text-slate-900">{money(total)}</span>
          </div>
          <div className="flex justify-end mt-3">
            <button type="button" onClick={() => onOpenSection('FINANCEIRO')} className="px-3 py-1.5 rounded border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
              Ver contas bancárias
            </button>
          </div>
        </div>

        <div className={`${card} p-4`}>
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><Calendar className="w-4 h-4 text-slate-500" /> Sua <span className="text-blue-700">agenda</span></h3>
              <p className="text-[11px] text-slate-500">Compromissos de hoje e dos próximos dias</p>
            </div>
            <button type="button" onClick={() => onOpenSection('ORDENS_SERVICOS')} className="px-3 py-1.5 rounded border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
              Abrir agenda
            </button>
          </div>
          {serviceOrdersUpcoming.length === 0 ? (
            <div className="text-center py-10">
              <Calendar className="w-6 h-6 text-slate-400 mx-auto" />
              <div className="text-xs font-bold text-slate-700 mt-2">Nenhum compromisso agendado</div>
              <div className="text-[11px] text-slate-500">Os agendamentos em que você é o responsável aparecem aqui, de hoje em diante</div>
              <button type="button" onClick={() => onOpenSection('ORDENS_SERVICOS')} className="mt-3 px-3 py-1.5 rounded border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">Novo agendamento</button>
            </div>
          ) : (
            <div className="mt-3 divide-y divide-slate-100">
              {serviceOrdersUpcoming.slice(0, 5).map((os) => (
                <div key={os.code} className="py-2 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-semibold text-slate-800">OS #{os.code} — {os.companyName}</div>
                    <div className="text-[10px] text-slate-500">Entrada: {os.entryDate}</div>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold">{os.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* LINHA 4: APPS + NOVIDADES */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-4`}>
          <h3 className="text-sm font-bold text-slate-800">Seus <span className="text-blue-700">aplicativos</span></h3>
          <p className="text-[11px] text-slate-500">Integrações e módulos contratados pela empresa</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 mt-3">
            {GC_APPS.map((app) => (
              <div key={app.name} className="flex items-start gap-2.5">
                <span className={`w-8 h-8 rounded ${app.color} text-white text-[10px] font-black flex items-center justify-center shrink-0`}>
                  {app.tag || app.name.slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    {app.name}
                    {app.badge && (
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${app.badge === 'CONECTADO' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{app.badge}</span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 leading-snug">{app.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end mt-3">
            <button type="button" onClick={() => onOpenSection('CONFIGURACOES')} className="px-3 py-1.5 rounded border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">Ver todos os aplicativos</button>
          </div>
        </div>

        <div className={`${card} p-4`}>
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-slate-500" /> Novidades do <span className="text-blue-700">sistema</span></h3>
          <p className="text-[11px] text-slate-500">O que mudou nas últimas versões</p>
          <div className="mt-3 p-3 rounded bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-900">
            <strong>Sincronização ao vivo:</strong> API {config.credentialName || 'ERP-GROK'} • Loja {config.storeName || 'Matriz'} #{config.storeId || '118887'} • MCP {config.mcpStatus || 'ONLINE'}
            {totals && (
              <div className="mt-1 text-emerald-800">
                {totals.clientes} clientes · {totals.produtos} produtos · {totals.orcamentos} orçamentos · {totals.vendas} vendas · {totals.contratos} contratos · {totals.ordensServicos ?? 1378} OS · {totals.contasBancarias ?? 3} contas bancárias
              </div>
            )}
          </div>
          <div className="mt-3 space-y-2.5">
            {[
              ['Vender fora: crédito do cliente para usar em compras futuras', '22/10/2026'],
              ['PDV: Venda por celular, sem perder registro', '19/10/2026'],
              ['Estoque: Localização de item por linha ou cartão de produto', '15/10/2026'],
              ['PDV: Fechamento de caixa conferido por forma de pagamento', '09/10/2026'],
              ['Propostas: link público com PDF A4 para o cliente imprimir', '26/10/2026'],
            ].map(([t, d]) => (
              <div key={t} className="flex items-start justify-between gap-2 text-xs border-b border-slate-100 pb-2">
                <span className="text-slate-700 font-semibold">{t}</span>
                <span className="text-[10px] text-slate-400 shrink-0">{d}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
