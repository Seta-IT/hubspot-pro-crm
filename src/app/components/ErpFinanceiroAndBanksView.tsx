'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  BarChart3,
  Building2,
  Copy,
  FileSpreadsheet,
  Landmark,
  Mail,
  Pencil,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  Trash2,
  Upload,
  CheckCircle2,
  Receipt,
} from 'lucide-react';
import type {
  ErpBankAccount,
  ErpDashboardSummary,
  ErpFinancialEntry,
  ErpFiscalInvoice,
} from '../../db/types';
import { formatBRL } from './ui-helpers';

export interface ErpFinanceiroAndBanksViewProps {
  activeSubId: string;
  onSelectSubId: (subId: string) => void;
  bankAccounts: ErpBankAccount[];
  financialEntries: ErpFinancialEntry[];
  invoices: ErpFiscalInvoice[];
  dashboardSummary?: ErpDashboardSummary;
  companies: Array<{ id: string; name: string; cnpj?: string }>;
  hideBalances?: boolean;
  onRefresh: () => Promise<void>;
  onShowToast: (msg: string) => void;
  openCollectionEditor: (
    collection: 'bankAccounts' | 'salesOrders' | 'serviceOrders' | 'suppliers' | 'employees' | 'purchaseOrders',
    title: string,
    record: Record<string, unknown>,
    fields: Array<{ key: string; label: string; type?: 'text' | 'number' | 'select'; options?: string[] }>
  ) => void;
  setGenericModal: (modal: any) => void;
  setEmailModalPayload: (payload: any) => void;
  setSelectedInvoiceForPrint: (inv: ErpFiscalInvoice | null) => void;
  setShowNewInvoiceModal: (show: boolean) => void;
}

const SUB_TABS = [
  { id: 'FIN_PAGAR', label: 'Contas a pagar', icon: ArrowUpCircle },
  { id: 'FIN_RECEBER', label: 'Contas a receber', icon: ArrowDownCircle },
  { id: 'FIN_FLUXO', label: 'Fluxo de caixa e Extrato', icon: BarChart3 },
  { id: 'FIN_DRE', label: 'DRE gerencial', icon: FileSpreadsheet },
  { id: 'FIN_BOLETOS', label: 'Boletos bancários e PIX', icon: Receipt },
  { id: 'FIN_AUXILIARES', label: 'Contas bancárias e Conciliação OFX', icon: Landmark },
] as const;

const BANK_FILTERS = ['TODAS', 'Banco Inter', 'Banco Itaú', 'Conta Integrada'];

const CORPORATE_ACCOUNTS = [
  { name: 'Banco Inter', code: '#237906', kind: 'Conta Corrente PJ (sincronizada)' },
  { name: 'Banco Itaú', code: '#142155', kind: 'Conta Corrente PJ (sincronizada)' },
  { name: 'Conta Integrada', code: '#710407', kind: 'Conta Integrada GestãoClick (sincronizada)' },
  { name: 'Caixinha', code: 'CX-01', kind: 'Caixa interno / fundo fixo' },
  { name: 'Seta Imp', code: 'SI-02', kind: 'Conta de importação' },
  { name: 'Inter Aplicações', code: 'IA-03', kind: 'Aplicação financeira' },
  { name: 'Itaú Aplicações', code: 'IT-04', kind: 'Aplicação financeira' },
  { name: 'C6 Bank PJ', code: 'C6-05', kind: 'Conta Corrente PJ' },
  { name: 'Asaas Cobrança', code: 'AS-06', kind: 'Conta de cobrança (boletos / PIX)' },
];

const SAMPLE_OFX = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261020<TRNAMT>2500.00<FITID>INTER-0001<MEMO>PIX RECEBIDO CLIENTE</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261021<TRNAMT>-1200.00<FITID>INTER-0002<MEMO>PAGAMENTO FORNECEDOR LINK</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const FIN_FIELDS = [
  { key: 'type', label: 'Tipo', type: 'select', options: ['RECEBER', 'PAGAR'] },
  { key: 'description', label: 'Descrição do Lançamento *' },
  { key: 'companyName', label: 'Cliente / Fornecedor' },
  { key: 'costCenter', label: 'Centro de Custo' },
  { key: 'paymentMethod', label: 'Forma / Conta (ex.: Boleto Banco Inter)' },
  { key: 'amount', label: 'Valor (R$)', type: 'number' },
  { key: 'dueDate', label: 'Data de Vencimento (AAAA-MM-DD)' },
  { key: 'status', label: 'Status', type: 'select', options: ['ABERTO', 'PAGO', 'ATRASADO'] },
];

const pct = (v: number, base: number) => (base ? `${((v / base) * 100).toFixed(1)}%` : '0,0%');

function entryBank(e: ErpFinancialEntry): string {
  const t = `${e.paymentMethod || ''} ${e.description || ''}`.toLowerCase();
  if (t.includes('inter')) return 'Banco Inter';
  if (t.includes('itau') || t.includes('itaú')) return 'Banco Itaú';
  return 'Conta Integrada';
}

export default function ErpFinanceiroAndBanksView(props: ErpFinanceiroAndBanksViewProps) {
  const {
    activeSubId,
    onSelectSubId,
    bankAccounts,
    financialEntries,
    invoices,
    dashboardSummary,
    companies,
    hideBalances,
    onRefresh,
    onShowToast,
    openCollectionEditor,
    setGenericModal,
    setEmailModalPayload,
    setSelectedInvoiceForPrint,
    setShowNewInvoiceModal,
  } = props;

  const sub = SUB_TABS.some((t) => t.id === activeSubId) ? activeSubId : 'FIN_FLUXO';
  const money = (v: number) => (hideBalances ? 'R$ •••••' : formatBRL(v));

  const [typeFilter, setTypeFilter] = useState<'AUTO' | 'TODOS'>('AUTO');
  const [statusFilter, setStatusFilter] = useState('TODOS');
  const [bankFilter, setBankFilter] = useState('TODAS');
  const [search, setSearch] = useState('');
  const [fluxoBank, setFluxoBank] = useState<string | null>(null);
  const [dreCompetence, setDreCompetence] = useState<'MENSAL' | 'SEMESTRAL' | 'BASE'>('MENSAL');
  const [ofxBank, setOfxBank] = useState('Banco Inter');
  const [ofxContent, setOfxContent] = useState('');
  const [ofxResult, setOfxResult] = useState<any>(null);
  const [ofxBusy, setOfxBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ---------- actions ----------
  const payEntry = async (fin: ErpFinancialEntry) => {
    const res = await fetch(`/api/erp/financial/${encodeURIComponent(fin.id)}/pay`, { method: 'POST' });
    onShowToast(res.ok ? 'Título liquidado com sucesso.' : 'Falha ao liquidar título.');
    await onRefresh();
  };
  const deleteEntry = async (fin: ErpFinancialEntry) => {
    await fetch(`/api/erp/financial/${encodeURIComponent(fin.id)}`, { method: 'DELETE' });
    onShowToast('Lançamento excluído.');
    await onRefresh();
  };
  const newEntry = (type: 'PAGAR' | 'RECEBER') =>
    setGenericModal({
      title: 'Novo Lançamento Financeiro',
      initialValues: {
        type,
        description: '',
        companyName: companies[0]?.name || 'Cliente / Fornecedor',
        costCenter: 'CC-101 • Locação de Equipamentos',
        paymentMethod: 'Boleto Banco Inter',
        amount: 0,
        dueDate: new Date().toISOString().slice(0, 10),
        status: 'ABERTO',
      },
      fields: FIN_FIELDS,
      onSave: async (vals: Record<string, unknown>) => {
        await fetch('/api/erp/financial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(vals),
        });
        setGenericModal(null);
        onShowToast('Lançamento financeiro registrado.');
        await onRefresh();
      },
    });
  const editEntry = (fin: ErpFinancialEntry) =>
    setGenericModal({
      title: 'Editar Lançamento Financeiro',
      initialValues: fin as unknown as Record<string, unknown>,
      fields: FIN_FIELDS,
      onSave: async (vals: Record<string, unknown>) => {
        await fetch(`/api/erp/financial/${encodeURIComponent(fin.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(vals),
        });
        setGenericModal(null);
        onShowToast('Lançamento atualizado.');
        await onRefresh();
      },
    });
  const emailEntry = (fin: ErpFinancialEntry) =>
    setEmailModalPayload({
      docType: 'BOLETO',
      companyName: fin.companyName,
      documentCode: fin.id.toUpperCase(),
      amountBrl: fin.amount,
      dueDate: fin.dueDate,
    });
  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onShowToast(`${label} copiado.`);
    } catch {
      onShowToast(`Não foi possível copiar ${label}.`);
    }
  };
  const payInvoice = async (inv: ErpFiscalInvoice) => {
    const res = await fetch(`/api/erp/invoices/${encodeURIComponent(inv.id)}/pay`, { method: 'POST' });
    onShowToast(res.ok ? `Fatura ${inv.documentNumber} baixada.` : 'Falha ao baixar fatura.');
    await onRefresh();
  };
  const runOfx = async (autoPayMatched: boolean, content?: string) => {
    const payload = content ?? ofxContent;
    if (!payload.trim()) {
      onShowToast('Carregue um arquivo OFX primeiro.');
      return;
    }
    setOfxBusy(true);
    try {
      const res = await fetch('/api/erp/financial/reconcile-ofx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankId: ofxBank, ofxContent: payload, autoPayMatched }),
      });
      const j = await res.json();
      setOfxResult(j);
      onShowToast(
        autoPayMatched
          ? `${j.matchedCount ?? 0} lançamento(s) conciliado(s) e baixado(s).`
          : `${j.matchedCount ?? 0} lançamento(s) pareado(s) no extrato.`
      );
      if (autoPayMatched) await onRefresh();
    } catch {
      onShowToast('Falha ao processar o OFX.');
    } finally {
      setOfxBusy(false);
    }
  };

  // ---------- derived ----------
  const listEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return financialEntries.filter((e) => {
      if (typeFilter === 'AUTO') {
        if (sub === 'FIN_PAGAR' && e.type !== 'PAGAR') return false;
        if (sub === 'FIN_RECEBER' && e.type !== 'RECEBER') return false;
      }
      if (statusFilter !== 'TODOS' && e.status !== statusFilter) return false;
      if (bankFilter !== 'TODAS' && entryBank(e) !== bankFilter) return false;
      if (q && !`${e.description} ${e.companyName} ${e.costCenter}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [financialEntries, typeFilter, sub, statusFilter, bankFilter, search]);

  const kpis = useMemo(() => {
    const sum = (arr: ErpFinancialEntry[]) => arr.reduce((a, e) => a + (e.amount || 0), 0);
    return {
      total: sum(listEntries),
      pago: sum(listEntries.filter((e) => e.status === 'PAGO')),
      aberto: sum(listEntries.filter((e) => e.status === 'ABERTO')),
      atraso: sum(listEntries.filter((e) => e.status === 'ATRASADO')),
    };
  }, [listEntries]);

  const consolidated = bankAccounts.reduce((a, b) => a + (b.balance || 0), 0);
  const monthly = dashboardSummary?.cashFlowMonthly || [];
  const maxBar = Math.max(1, ...monthly.flatMap((m) => [m.recebimentos, m.pagamentos]));
  const periodBalance = dashboardSummary?.cashFlowPeriodBalance ?? monthly.reduce((a, m) => a + m.saldo, 0);

  const dre = useMemo(() => {
    let base = financialEntries;
    if (dreCompetence === 'MENSAL') base = financialEntries.filter((e) => (e.dueDate || '').startsWith('2026-10'));
    else if (dreCompetence === 'SEMESTRAL')
      base = financialEntries.filter((e) => (e.dueDate || '') >= '2026-05-01' && (e.dueDate || '') <= '2026-10-31');
    const rec = base.filter((e) => e.type === 'RECEBER');
    const pag = base.filter((e) => e.type === 'PAGAR');
    const s = (arr: ErpFinancialEntry[]) => arr.reduce((a, e) => a + (e.amount || 0), 0);
    const has = (e: ErpFinancialEntry, ...keys: string[]) =>
      keys.some((k) => `${e.description} ${e.costCenter} ${e.category}`.toLowerCase().includes(k));
    const locacao = s(rec.filter((e) => e.category === 'LOCACAO_EQUIPAMENTOS' || has(e, 'loca')));
    const vendas = s(rec.filter((e) => e.category !== 'LOCACAO_EQUIPAMENTOS' && !has(e, 'loca') && has(e, 'venda', 'equipamento', 'pdv')));
    const servicos = s(rec) - locacao - vendas;
    const bruta = locacao + servicos + vendas;
    const pisCofins = bruta * 0.0365;
    const iss = servicos * 0.029;
    const deducoes = pisCofins + iss;
    const liquida = bruta - deducoes;
    const custos = s(pag.filter((e) => e.category === 'FORNECEDOR_LINK_HARDWARE'));
    const lucroBruto = liquida - custos;
    const opPag = pag.filter((e) => e.category !== 'FORNECEDOR_LINK_HARDWARE' && e.category !== 'IMPOSTOS_TRIBUTOS');
    const saude = s(opPag.filter((e) => has(e, 'saúde', 'saude', 'medseg', 'bradesco', 'benef')));
    const pessoal = s(opPag.filter((e) => !has(e, 'saúde', 'saude', 'medseg', 'bradesco', 'benef') && has(e, 'folha', 'salár', 'salar', 'pessoal', 'pró-labore')));
    const adm = s(opPag) - saude - pessoal + s(pag.filter((e) => e.category === 'IMPOSTOS_TRIBUTOS'));
    const despesas = pessoal + saude + adm;
    const ebitda = lucroBruto - despesas;
    // Lucro presumido: base 32% serviços/locação, 8% vendas; IRPJ 15% + CSLL 9%
    const irpjCsll = Math.max(0, (locacao + servicos) * 0.32 * 0.15 + vendas * 0.08 * 0.15 + (locacao + servicos) * 0.32 * 0.09 + vendas * 0.12 * 0.09);
    const liquido = ebitda - irpjCsll;
    const issEconomia = locacao * 0.029;
    const cc: Record<string, { rec: number; pag: number }> = {};
    base.forEach((e) => {
      const k = e.costCenter || 'Sem centro de custo';
      cc[k] = cc[k] || { rec: 0, pag: 0 };
      if (e.type === 'RECEBER') cc[k].rec += e.amount;
      else cc[k].pag += e.amount;
    });
    return { locacao, servicos, vendas, bruta, pisCofins, iss, deducoes, liquida, custos, lucroBruto, pessoal, saude, adm, despesas, ebitda, irpjCsll, liquido, issEconomia, cc };
  }, [financialEntries, dreCompetence]);

  const boletoEntries = financialEntries.filter(
    (e) => e.type === 'RECEBER' && /boleto|pix/i.test(e.paymentMethod || '') && !e.invoiceId
  );
  const invKpis = {
    emitidos: invoices.length + boletoEntries.length,
    liquidados: invoices.filter((i) => i.status === 'PAGA').length + boletoEntries.filter((e) => e.status === 'PAGO').length,
    abertos: invoices.filter((i) => i.status === 'EMITIDA' || i.status === 'VENCIDA').length + boletoEntries.filter((e) => e.status !== 'PAGO').length,
  };
  const companyCnpj = (name: string) => companies.find((c) => c.name === name)?.cnpj || '';

  // ---------- UI helpers ----------
  const Btn = ({ onClick, className, icon: Icon, children }: any) => (
    <button type="button" onClick={onClick} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-bold text-white cursor-pointer ${className}`}>
      {Icon && <Icon size={12} />} {children}
    </button>
  );
  const Kpi = ({ label, value, tone }: { label: string; value: string; tone: string }) => (
    <div className="bg-white rounded-md border border-slate-200 p-3">
      <div className="text-[10px] font-extrabold uppercase text-slate-500">{label}</div>
      <div className={`text-base font-extrabold ${tone}`}>{value}</div>
    </div>
  );
  const statusBadge = (s: string) =>
    s === 'PAGO' || s === 'PAGA'
      ? 'bg-emerald-100 text-emerald-700'
      : s === 'ATRASADO' || s === 'VENCIDA'
        ? 'bg-rose-100 text-rose-700'
        : 'bg-amber-100 text-amber-700';

  const renderEntryRow = (fin: ErpFinancialEntry) => (
    <div key={fin.id} className="p-3 rounded border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs bg-white">
      <div>
        <div className="font-bold text-slate-800">{fin.description}</div>
        <div className="text-[11px] text-slate-500">
          {fin.companyName} • {fin.costCenter} • {entryBank(fin)} • Venc: {fin.dueDate}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-right">
          <div className={`font-extrabold ${fin.type === 'RECEBER' ? 'text-emerald-700' : 'text-rose-700'}`}>
            {fin.type === 'RECEBER' ? '+' : '-'}{money(fin.amount)}
          </div>
          <span className={`text-[10px] font-bold px-1.5 rounded ${statusBadge(fin.status)}`}>{fin.status}</span>
        </div>
        {fin.status !== 'PAGO' && (
          <Btn onClick={() => payEntry(fin)} className="bg-emerald-600" icon={CheckCircle2}>Liquidar / Dar Baixa</Btn>
        )}
        <Btn onClick={() => editEntry(fin)} className="bg-amber-500" icon={Pencil}>Editar</Btn>
        <Btn onClick={() => emailEntry(fin)} className="bg-sky-600" icon={Mail}>Enviar Boleto / E-mail</Btn>
        <Btn onClick={() => deleteEntry(fin)} className="bg-rose-600" icon={Trash2}>Excluir</Btn>
      </div>
    </div>
  );

  // ---------- sections ----------
  const renderTitles = () => {
    const isPagar = sub === 'FIN_PAGAR';
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-extrabold text-slate-900">{isPagar ? 'Contas a Pagar' : 'Contas a Receber'}</h2>
          <Btn onClick={() => newEntry(isPagar ? 'PAGAR' : 'RECEBER')} className="bg-[#ff7a59] py-1.5" icon={Plus}>Novo Lançamento</Btn>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Total Previsto" value={money(kpis.total)} tone="text-slate-900" />
          <Kpi label={isPagar ? 'Total Pago' : 'Total Liquidado'} value={money(kpis.pago)} tone="text-emerald-700" />
          <Kpi label="Em Aberto" value={money(kpis.aberto)} tone="text-amber-600" />
          <Kpi label="Em Atraso" value={money(kpis.atraso)} tone="text-rose-700" />
        </div>
        <div className="flex flex-wrap gap-2 items-center bg-white p-3 rounded-md border border-slate-200 text-xs">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} className="border rounded px-2 py-1">
            <option value="AUTO">{isPagar ? 'Somente a pagar' : 'Somente a receber'}</option>
            <option value="TODOS">Todos os tipos</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border rounded px-2 py-1">
            {['TODOS', 'ABERTO', 'PAGO', 'ATRASADO'].map((s) => <option key={s}>{s}</option>)}
          </select>
          <select value={bankFilter} onChange={(e) => setBankFilter(e.target.value)} className="border rounded px-2 py-1">
            {BANK_FILTERS.map((b) => <option key={b}>{b}</option>)}
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar descrição, cliente/fornecedor, centro de custo" className="border rounded px-2 py-1 flex-1 min-w-[220px]" />
          <span className="text-slate-500">{listEntries.length} título(s)</span>
        </div>
        <div className="space-y-2">
          {listEntries.length === 0 && <div className="text-xs text-slate-500 p-3">Nenhum título encontrado com os filtros atuais.</div>}
          {listEntries.map(renderEntryRow)}
        </div>
      </div>
    );
  };

  const renderFluxo = () => {
    const extrato = financialEntries
      .filter((e) => e.status === 'PAGO' && (!fluxoBank || entryBank(e) === fluxoBank))
      .sort((a, b) => (b.paidAt || b.dueDate).localeCompare(a.paidAt || a.dueDate));
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {bankAccounts.map((b) => (
            <button key={b.id} type="button" onClick={() => setFluxoBank(fluxoBank === b.name ? null : b.name)}
              className={`text-left bg-white rounded-md border p-3 cursor-pointer ${fluxoBank === b.name ? 'border-[#1e3a6e] ring-2 ring-[#1e3a6e]/30' : 'border-slate-200'}`}>
              <div className="flex items-center gap-1 text-[10px] font-extrabold uppercase text-slate-500"><Building2 size={12} />{b.name}</div>
              <div className="text-[10px] text-slate-400">{b.id}</div>
              <div className={`text-base font-extrabold ${b.balance < 0 ? 'text-rose-700' : 'text-slate-900'}`}>{money(b.balance)}</div>
            </button>
          ))}
          <div className="bg-[#1e3a6e] text-white rounded-md p-3">
            <div className="text-[10px] font-extrabold uppercase opacity-80">Saldo Consolidado</div>
            <div className="text-base font-extrabold">{money(consolidated)}</div>
          </div>
        </div>
        <div className="bg-white rounded-md border border-slate-200 p-4 space-y-3">
          <div className="flex flex-wrap justify-between gap-2 text-xs">
            <span className="font-extrabold text-slate-900">Evolução Semestral — Recebimentos x Pagamentos</span>
            <span>Saldo do período: <b>{money(periodBalance)}</b></span>
            <span>Melhor mês: <b className="text-emerald-700">{dashboardSummary?.cashFlowBestMonth || '-'}</b></span>
            <span>Pior mês: <b className="text-rose-700">{dashboardSummary?.cashFlowWorstMonth || '-'}</b></span>
          </div>
          <div className="grid grid-cols-6 gap-2 items-end h-40">
            {monthly.map((m) => (
              <div key={m.month} className="flex flex-col items-center justify-end h-full gap-1">
                <div className="flex items-end gap-1 h-28">
                  <div className="w-3 bg-emerald-500 rounded-t" style={{ height: `${(m.recebimentos / maxBar) * 100}%` }} title={`Recebimentos ${formatBRL(m.recebimentos)}`} />
                  <div className="w-3 bg-rose-500 rounded-t" style={{ height: `${(m.pagamentos / maxBar) * 100}%` }} title={`Pagamentos ${formatBRL(m.pagamentos)}`} />
                </div>
                <div className="text-[10px] font-bold text-slate-600">{m.month}</div>
                <div className={`text-[10px] font-bold ${m.saldo < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{money(m.saldo)}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-md border border-slate-200 p-4 space-y-2">
          <div className="text-xs font-extrabold text-slate-900">
            Extrato de movimentações conciliadas {fluxoBank ? `— ${fluxoBank}` : '— todas as contas'} ({extrato.length})
          </div>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-slate-500"><th>Data</th><th>Descrição</th><th>Cliente / Fornecedor</th><th>Conta</th><th className="text-right">Valor</th></tr></thead>
            <tbody>
              {extrato.map((e) => (
                <tr key={e.id} className="border-t border-slate-100">
                  <td>{(e.paidAt || e.dueDate).slice(0, 10)}</td><td>{e.description}</td><td>{e.companyName}</td><td>{entryBank(e)}</td>
                  <td className={`text-right font-bold ${e.type === 'RECEBER' ? 'text-emerald-700' : 'text-rose-700'}`}>{e.type === 'RECEBER' ? '+' : '-'}{money(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderDre = () => {
    const d = dre;
    const rows: Array<[string, number, 'h' | 's' | 't']> = [
      ['1. RECEITA OPERACIONAL BRUTA', d.bruta, 'h'],
      ['(+) Receita de Locação de Bens Móveis (0% ISS — LC 116/03 & Súmula Vinculante 31 STF)', d.locacao, 's'],
      ['(+) Receita de Serviços Técnicos TI / NOC & Assinaturas SCM (LC 116 Item 01.07 / NFCom Mod. 62)', d.servicos, 's'],
      ['(+) Receita de Vendas de Equipamentos Telecom & PDV', d.vendas, 's'],
      ['2. (-) DEDUÇÕES E IMPOSTOS SOBRE FATURAMENTO', -d.deducoes, 'h'],
      ['(-) PIS Cumulativo (0,65%) e COFINS Cumulativo (3,00%)', -d.pisCofins, 's'],
      [`(-) ISSQN sobre Serviços Técnicos (2,90%) — Isento 0% sobre Locação Pura (Economia Fiscal SV 31 STF: ${formatBRL(d.issEconomia)})`, -d.iss, 's'],
      ['3. (=) RECEITA OPERACIONAL LÍQUIDA', d.liquida, 't'],
      ['4. (-) CUSTOS OPERACIONAIS DIRETOS (CSP / CMV / Links & Manutenção de Parque)', -d.custos, 'h'],
      [`5. (=) LUCRO BRUTO OPERACIONAL (Margem Bruta ${pct(d.lucroBruto, d.liquida)})`, d.lucroBruto, 't'],
      ['6. (-) DESPESAS OPERACIONAIS POR CENTRO DE CUSTO', -d.despesas, 'h'],
      ['(-) Despesas com Pessoal e Folha de Pagamento', -d.pessoal, 's'],
      ['(-) Assistência Médica e Benefícios (Bradesco Saúde / Medseg)', -d.saude, 's'],
      ['(-) Despesas Administrativas, Tributárias e Gerais', -d.adm, 's'],
      [`7. (=) EBITDA / LAJIDA GERENCIAL (Margem EBITDA ${pct(d.ebitda, d.liquida)})`, d.ebitda, 't'],
      ['8. (-) PROVISÃO IRPJ E CSLL (Lucro Presumido)', -d.irpjCsll, 'h'],
      [`9. (=) RESULTADO LÍQUIDO DO EXERCÍCIO (Margem Líquida ${pct(d.liquido, d.liquida)})`, d.liquido, 't'],
    ];
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-md border border-slate-200 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-extrabold text-slate-900">DRE Gerencial Seta Telecom</h2>
            <select value={dreCompetence} onChange={(e) => setDreCompetence(e.target.value as any)} className="border rounded px-2 py-1 text-xs">
              <option value="MENSAL">Outubro / 2026 (Mensal)</option>
              <option value="SEMESTRAL">Maio a Outubro / 2026 (Semestral)</option>
              <option value="BASE">Base Sincronizada (Tempo Real)</option>
            </select>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-slate-500"><th>Conta</th><th className="text-right">Valor (R$)</th><th className="text-right">AV % s/ Receita Bruta</th></tr></thead>
            <tbody>
              {rows.map(([label, v, kind]) => (
                <tr key={label} className={`border-t border-slate-100 ${kind === 't' ? 'bg-slate-50 font-extrabold' : kind === 'h' ? 'font-bold' : 'text-slate-600'}`}>
                  <td className={kind === 's' ? 'pl-4 py-1' : 'py-1'}>{label}</td>
                  <td className={`text-right ${v < 0 ? 'text-rose-700' : ''}`}>{money(v)}</td>
                  <td className="text-right">{pct(v, d.bruta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[10px] text-slate-400">Alíquotas gerenciais: PIS 0,65%, COFINS 3,00%, ISS 2,90% sobre serviços, IRPJ/CSLL por presunção (Lucro Presumido). Valores derivados dos lançamentos sincronizados.</p>
        </div>
        <div className="bg-white rounded-md border border-slate-200 p-4 space-y-2">
          <div className="text-xs font-extrabold text-slate-900">Breakdown por Centro de Custo</div>
          {Object.entries(d.cc).sort((a, b) => (b[1].rec + b[1].pag) - (a[1].rec + a[1].pag)).map(([k, v]) => (
            <div key={k} className="border-t border-slate-100 pt-1 text-xs">
              <div className="font-bold text-slate-700">{k}</div>
              <div className="flex justify-between"><span className="text-emerald-700">+{money(v.rec)}</span><span className="text-rose-700">-{money(v.pag)}</span><b>{money(v.rec - v.pag)}</b></div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderBoletos = () => (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-extrabold text-slate-900">Boletos Bancários e Cobrança PIX</h2>
        <Btn onClick={() => setShowNewInvoiceModal(true)} className="bg-[#ff7a59] py-1.5" icon={Plus}>Emitir Novo Boleto / Fatura</Btn>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Boletos Emitidos" value={String(invKpis.emitidos)} tone="text-slate-900" />
        <Kpi label="Liquidados" value={String(invKpis.liquidados)} tone="text-emerald-700" />
        <Kpi label="Em Aberto" value={String(invKpis.abertos)} tone="text-amber-600" />
        <Kpi label="Conta Emissora" value="Itaú #142155 / Inter #237906" tone="text-[#1e3a6e] text-sm" />
      </div>
      <div className="space-y-2">
        {invoices.map((inv) => (
          <div key={inv.id} className="p-3 rounded border border-slate-200 bg-white text-xs space-y-2">
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <div className="font-bold text-slate-800">Nº {inv.documentNumber} — {inv.companyName}</div>
                <div className="text-[11px] text-slate-500">CNPJ {inv.companyCnpj} • Venc: {inv.dueDate}</div>
              </div>
              <div className="text-right">
                <div className="font-extrabold">{money(inv.netAmount)}</div>
                <span className={`text-[10px] font-bold px-1.5 rounded ${statusBadge(inv.status)}`}>{inv.status}</span>
              </div>
            </div>
            {inv.boletoDigitableLine && <div className="font-mono text-[11px] text-slate-600 break-all">Linha digitável: {inv.boletoDigitableLine}</div>}
            <div className="flex flex-wrap gap-2">
              <Btn onClick={() => copy(inv.boletoDigitableLine || '', 'Linha digitável')} className="bg-slate-600" icon={Copy}>Copiar Linha Digitável</Btn>
              <Btn onClick={() => copy(inv.pixCopyPaste || '', 'PIX Copia e Cola')} className="bg-teal-600" icon={QrCode}>Copiar PIX</Btn>
              <Btn onClick={() => setSelectedInvoiceForPrint(inv)} className="bg-[#1e3a6e]" icon={Printer}>Imprimir Boleto / Fatura</Btn>
              <Btn onClick={() => setEmailModalPayload({ docType: 'BOLETO', companyName: inv.companyName, companyCnpj: inv.companyCnpj, documentCode: inv.documentNumber, amountBrl: inv.netAmount, dueDate: inv.dueDate, boletoLine: inv.boletoDigitableLine })} className="bg-sky-600" icon={Mail}>Enviar por E-mail</Btn>
              {inv.status !== 'PAGA' && inv.status !== 'CANCELADA' && (
                <Btn onClick={() => payInvoice(inv)} className="bg-emerald-600" icon={CheckCircle2}>Dar Baixa</Btn>
              )}
            </div>
          </div>
        ))}
        {boletoEntries.map((fin) => (
          <div key={fin.id} className="p-3 rounded border border-dashed border-slate-300 bg-white text-xs flex flex-wrap justify-between gap-2">
            <div>
              <div className="font-bold text-slate-800">Título {fin.id.toUpperCase()} — {fin.companyName}</div>
              <div className="text-[11px] text-slate-500">{companyCnpj(fin.companyName) && `CNPJ ${companyCnpj(fin.companyName)} • `}{fin.paymentMethod} • Venc: {fin.dueDate}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <b>{money(fin.amount)}</b>
              <span className={`text-[10px] font-bold px-1.5 rounded ${statusBadge(fin.status)}`}>{fin.status}</span>
              <Btn onClick={() => emailEntry(fin)} className="bg-sky-600" icon={Mail}>Enviar por E-mail</Btn>
              {fin.status !== 'PAGO' && <Btn onClick={() => payEntry(fin)} className="bg-emerald-600" icon={CheckCircle2}>Dar Baixa</Btn>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderAuxiliares = () => {
    const synced = (name: string) => bankAccounts.find((b) => b.name === name);
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-md border border-slate-200 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-extrabold text-slate-900">Contas Bancárias Seta Telecom</h2>
            <Btn onClick={() => openCollectionEditor('bankAccounts', 'Nova Conta Bancária', { name: '', balance: 0, status: 'ZERO', lastMovedAt: new Date().toISOString().slice(0, 10) }, [{ key: 'name', label: 'Nome da Conta' }, { key: 'balance', label: 'Saldo (R$)', type: 'number' }, { key: 'status', label: 'Status', type: 'select', options: ['POSITIVE', 'NEGATIVE', 'ZERO'] }])} className="bg-[#ff7a59] py-1.5" icon={Plus}>Nova Conta Bancária</Btn>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-slate-500"><th>Conta</th><th>Código</th><th>Tipo</th><th className="text-right">Saldo</th><th /></tr></thead>
            <tbody>
              {CORPORATE_ACCOUNTS.map((c) => {
                const acc = synced(c.name);
                return (
                  <tr key={c.name} className="border-t border-slate-100">
                    <td className="font-bold py-1">{c.name}</td><td>{acc?.id || c.code}</td><td>{c.kind}</td>
                    <td className={`text-right font-bold ${acc && acc.balance < 0 ? 'text-rose-700' : ''}`}>{acc ? money(acc.balance) : 'Não sincronizada'}</td>
                    <td className="text-right">
                      {acc && <Btn onClick={() => openCollectionEditor('bankAccounts', `Editar Saldo — ${acc.name}`, acc as unknown as Record<string, unknown>, [{ key: 'name', label: 'Nome da Conta' }, { key: 'balance', label: 'Saldo (R$)', type: 'number' }, { key: 'status', label: 'Status', type: 'select', options: ['POSITIVE', 'NEGATIVE', 'ZERO'] }])} className="bg-amber-500" icon={Pencil}>Editar Saldo</Btn>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="bg-white rounded-md border border-slate-200 p-4 space-y-3 text-xs">
          <h2 className="text-base font-extrabold text-slate-900">Importador e Conciliador de Extrato OFX</h2>
          <div className="flex flex-wrap gap-2 items-center">
            <select value={ofxBank} onChange={(e) => setOfxBank(e.target.value)} className="border rounded px-2 py-1">
              <option>Banco Inter</option><option>Banco Itaú</option>
            </select>
            <input ref={fileRef} type="file" accept=".ofx,.OFX" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) { setOfxContent(await f.text()); onShowToast(`Arquivo ${f.name} carregado.`); }
            }} />
            <Btn onClick={() => fileRef.current?.click()} className="bg-slate-700" icon={Upload}>Upload .OFX</Btn>
            <Btn onClick={() => { setOfxContent(SAMPLE_OFX); onShowToast('Extrato OFX padrão carregado.'); }} className="bg-slate-500" icon={FileSpreadsheet}>Carregar OFX padrão</Btn>
            <Btn onClick={() => runOfx(false)} className="bg-[#1e3a6e]" icon={RefreshCw}>{ofxBusy ? 'Processando...' : 'Parear lançamentos'}</Btn>
            <Btn onClick={() => runOfx(true)} className="bg-emerald-600" icon={CheckCircle2}>Conciliar e baixar pareados</Btn>
          </div>
          <textarea value={ofxContent} onChange={(e) => setOfxContent(e.target.value)} rows={4} placeholder="Conteúdo do arquivo OFX" className="w-full border rounded p-2 font-mono text-[11px]" />
          {ofxResult && (
            <div className="space-y-1">
              <div className="font-bold">
                {ofxResult.matchedCount} pareado(s) de {ofxResult.summary?.transactionsParsed ?? 0} transação(ões) • Créditos {formatBRL(ofxResult.summary?.totalCredits || 0)} • Débitos {formatBRL(ofxResult.summary?.totalDebits || 0)}
              </div>
              {(ofxResult.reconciledEntries || []).map((r: any) => (
                <div key={r.entryId} className="flex justify-between border-t border-slate-100 py-1">
                  <span>{r.ofxDate} • {r.ofxMemo} → {r.description} ({r.companyName})</span>
                  <b className={r.paid ? 'text-emerald-700' : 'text-amber-600'}>{formatBRL(r.amount)} {r.paid ? 'BAIXADO' : 'PAREADO'}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-md border border-slate-200 p-2 flex flex-wrap gap-1">
        {SUB_TABS.map((t) => {
          const Icon = t.icon;
          const active = sub === t.id;
          return (
            <button key={t.id} type="button" onClick={() => onSelectSubId(t.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold cursor-pointer ${active ? 'bg-[#1e3a6e] text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>
      {(sub === 'FIN_PAGAR' || sub === 'FIN_RECEBER') && renderTitles()}
      {sub === 'FIN_FLUXO' && renderFluxo()}
      {sub === 'FIN_DRE' && renderDre()}
      {sub === 'FIN_BOLETOS' && renderBoletos()}
      {sub === 'FIN_AUXILIARES' && renderAuxiliares()}
    </div>
  );
}
