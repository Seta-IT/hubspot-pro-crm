'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  Building2,
  Copy,
  FileSpreadsheet,
  Mail,
  MoreVertical,
  Pencil,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  Trash2,
  Upload,
  CheckCircle2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { RowKebabMenu } from './FixedPortalMenu';
import type {
  ErpBankAccount,
  ErpDashboardSummary,
  ErpFinancialEntry,
  ErpFiscalInvoice,
} from '../../db/types';
import { formatBRL } from './ui-helpers';
import { buildIssuedInvoiceEmailPayload } from '../lib/invoice-email-payload';
import { copySignedInvoiceLink } from '../lib/invoice-link-client';
import { isIssuedInvoiceStatus } from '../../modules/erp/invoice-send-attachments';

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

// Navegação entre as subtelas fica só na sidebar (GestaoClickSidebar).
const SUB_IDS = ['FIN_PAGAR', 'FIN_RECEBER', 'FIN_FLUXO', 'FIN_DRE', 'FIN_BOLETOS', 'FIN_AUXILIARES'];

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

  const sub = SUB_IDS.includes(activeSubId) ? activeSubId : 'FIN_FLUXO';
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
  const Btn = ({ onClick, variant = 'outline', icon: Icon, children }: any) => (
    <button
      type="button"
      onClick={onClick}
      className={
        variant === 'primary'
          ? 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-white bg-[#1e3a6e] hover:bg-[#162d56] cursor-pointer'
          : 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 cursor-pointer'
      }
    >
      {Icon && <Icon size={13} />} {children}
    </button>
  );
  const Kpi = ({ label, value, tone }: { label: string; value: string; tone: string }) => (
    <div className="bg-white rounded-md border border-slate-200 p-3">
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      <div className={`text-base font-semibold ${tone}`}>{value}</div>
    </div>
  );
  const statusBadge = (s: string) =>
    s === 'PAGO' || s === 'PAGA'
      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
      : s === 'ATRASADO' || s === 'VENCIDA'
        ? 'bg-rose-50 text-rose-700 border border-rose-200'
        : s === 'CANCELADA'
          ? 'bg-slate-50 text-slate-600 border border-slate-200'
          : 'bg-amber-50 text-amber-700 border border-amber-200';
  const statusLabel = (s: string) =>
    ({ PAGO: 'Pago', PAGA: 'Paga', ABERTO: 'Em aberto', ATRASADO: 'Atrasado', VENCIDA: 'Vencida', EMITIDA: 'Emitida', CANCELADA: 'Cancelada' } as Record<string, string>)[s] || s;
  const Pill = ({ status }: { status: string }) => (
    <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${statusBadge(status)}`}>{statusLabel(status)}</span>
  );
  const th = 'px-3 py-2 text-[11px] font-semibold text-slate-500';
  const td = 'px-3 py-2';

  const renderEntryRow = (fin: ErpFinancialEntry) => (
    <tr key={fin.id} className="border-t border-slate-100 h-10 hover:bg-slate-50">
      <td className={`${td} whitespace-nowrap text-slate-600`}>{fin.dueDate}</td>
      <td className={td}>
        <div className="text-slate-800">{fin.description}</div>
        {fin.costCenter && <div className="text-[11px] text-slate-400">{fin.costCenter}</div>}
      </td>
      <td className={`${td} text-slate-700`}>{fin.companyName}</td>
      <td className={`${td} whitespace-nowrap text-slate-600`}>{entryBank(fin)}</td>
      <td className={`${td} text-right whitespace-nowrap font-semibold ${typeFilter === 'TODOS' ? (fin.type === 'RECEBER' ? 'text-emerald-700' : 'text-rose-700') : 'text-slate-900'}`}>
        {typeFilter === 'TODOS' ? (fin.type === 'RECEBER' ? '+' : '-') : ''}{money(fin.amount)}
      </td>
      <td className={td}><Pill status={fin.status} /></td>
      <td className={`${td} text-right`}>
        <RowMenu
          items={[
            ...(fin.status !== 'PAGO' ? [{ label: 'Dar baixa', icon: CheckCircle2, onClick: () => payEntry(fin) }] : []),
            { label: 'Editar', icon: Pencil, onClick: () => editEntry(fin) },
            { label: 'Enviar boleto por e-mail', icon: Mail, onClick: () => emailEntry(fin) },
            { label: 'Excluir', icon: Trash2, onClick: () => deleteEntry(fin), danger: true },
          ]}
        />
      </td>
    </tr>
  );

  // ---------- sections ----------
  const renderTitles = () => {
    const isPagar = sub === 'FIN_PAGAR';
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">{isPagar ? 'Contas a pagar' : 'Contas a receber'}</h2>
          <Btn variant="primary" onClick={() => newEntry(isPagar ? 'PAGAR' : 'RECEBER')} icon={Plus}>Adicionar</Btn>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Previsto" value={money(kpis.total)} tone="text-slate-900" />
          <Kpi label={isPagar ? 'Pago' : 'Recebido'} value={money(kpis.pago)} tone="text-emerald-700" />
          <Kpi label="Em aberto" value={money(kpis.aberto)} tone="text-amber-700" />
          <Kpi label="Em atraso" value={money(kpis.atraso)} tone="text-rose-700" />
        </div>
        <div className="flex flex-wrap gap-2 items-center text-xs">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar descrição, cliente/fornecedor ou centro de custo" className="border border-slate-300 rounded-md px-2.5 py-1.5 flex-1 min-w-[220px] bg-white" />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} className="border border-slate-300 rounded-md px-2 py-1.5 bg-white">
            <option value="AUTO">{isPagar ? 'Somente a pagar' : 'Somente a receber'}</option>
            <option value="TODOS">Todos os tipos</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5 bg-white">
            {['TODOS', 'ABERTO', 'PAGO', 'ATRASADO'].map((s) => <option key={s} value={s}>{s === 'TODOS' ? 'Todas as situações' : statusLabel(s)}</option>)}
          </select>
          <select value={bankFilter} onChange={(e) => setBankFilter(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5 bg-white">
            {BANK_FILTERS.map((b) => <option key={b} value={b}>{b === 'TODAS' ? 'Todas as contas' : b}</option>)}
          </select>
        </div>
        <div className="bg-white rounded-md border border-slate-200 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr className="text-left">
                <th className={th}>Vencimento</th>
                <th className={th}>Descrição</th>
                <th className={th}>{isPagar ? 'Fornecedor' : 'Cliente'}</th>
                <th className={th}>Conta</th>
                <th className={`${th} text-right`}>Valor</th>
                <th className={th}>Situação</th>
                <th className={`${th} text-right w-10`} aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {listEntries.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">Nenhum título encontrado com os filtros atuais.</td></tr>
              )}
              {listEntries.map(renderEntryRow)}
            </tbody>
          </table>
          <div className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">{listEntries.length} registro(s)</div>
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
        <h2 className="text-lg font-semibold text-slate-900">Fluxo de caixa</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {bankAccounts.map((b) => (
            <button key={b.id} type="button" onClick={() => setFluxoBank(fluxoBank === b.name ? null : b.name)}
              className={`text-left bg-white rounded-md border p-3 cursor-pointer ${fluxoBank === b.name ? 'border-[#1e3a6e] ring-1 ring-[#1e3a6e]' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500"><Building2 size={12} />{b.name}</div>
              <div className={`text-base font-semibold ${b.balance < 0 ? 'text-rose-700' : 'text-slate-900'}`}>{money(b.balance)}</div>
            </button>
          ))}
          <div className="bg-white rounded-md border border-slate-200 p-3">
            <div className="text-[11px] font-medium text-slate-500">Saldo consolidado</div>
            <div className={`text-base font-semibold ${consolidated < 0 ? 'text-rose-700' : 'text-slate-900'}`}>{money(consolidated)}</div>
          </div>
        </div>
        <div className="bg-white rounded-md border border-slate-200 p-4 space-y-3">
          <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-600">
            <span className="font-semibold text-slate-900">Recebimentos x pagamentos por mês</span>
            <span>Saldo do período: <b className="text-slate-900">{money(periodBalance)}</b></span>
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
                <div className="text-[11px] text-slate-600">{m.month}</div>
                <div className={`text-[11px] font-semibold ${m.saldo < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{money(m.saldo)}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-md border border-slate-200 overflow-x-auto">
          <div className="px-3 py-2 text-xs font-semibold text-slate-900">
            Extrato {fluxoBank ? `— ${fluxoBank}` : '— todas as contas'}
          </div>
          <table className="w-full text-xs">
            <thead className="bg-slate-50"><tr className="text-left"><th className={th}>Data</th><th className={th}>Descrição</th><th className={th}>Cliente / Fornecedor</th><th className={th}>Conta</th><th className={`${th} text-right`}>Valor</th></tr></thead>
            <tbody>
              {extrato.map((e) => (
                <tr key={e.id} className="border-t border-slate-100 h-10">
                  <td className={`${td} whitespace-nowrap text-slate-600`}>{(e.paidAt || e.dueDate).slice(0, 10)}</td><td className={td}>{e.description}</td><td className={td}>{e.companyName}</td><td className={td}>{entryBank(e)}</td>
                  <td className={`${td} text-right whitespace-nowrap font-semibold ${e.type === 'RECEBER' ? 'text-emerald-700' : 'text-rose-700'}`}>{e.type === 'RECEBER' ? '+' : '-'}{money(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">{extrato.length} registro(s)</div>
        </div>
      </div>
    );
  };

  const renderDre = () => {
    const d = dre;
    const rows: Array<[string, number, 'h' | 's' | 't']> = [
      ['1. Receita operacional bruta', d.bruta, 'h'],
      ['(+) Receita de locação', d.locacao, 's'],
      ['(+) Receita de serviços', d.servicos, 's'],
      ['(+) Receita de vendas', d.vendas, 's'],
      ['2. (-) Deduções sobre o faturamento', -d.deducoes, 'h'],
      ['(-) PIS e COFINS', -d.pisCofins, 's'],
      ['(-) ISS sobre serviços', -d.iss, 's'],
      ['3. (=) Receita operacional líquida', d.liquida, 't'],
      ['4. (-) Custos operacionais diretos', -d.custos, 'h'],
      [`5. (=) Lucro bruto (margem ${pct(d.lucroBruto, d.liquida)})`, d.lucroBruto, 't'],
      ['6. (-) Despesas operacionais', -d.despesas, 'h'],
      ['(-) Pessoal e folha', -d.pessoal, 's'],
      ['(-) Assistência médica e benefícios', -d.saude, 's'],
      ['(-) Administrativas, tributárias e gerais', -d.adm, 's'],
      [`7. (=) EBITDA (margem ${pct(d.ebitda, d.liquida)})`, d.ebitda, 't'],
      ['8. (-) IRPJ e CSLL', -d.irpjCsll, 'h'],
      [`9. (=) Resultado líquido (margem ${pct(d.liquido, d.liquida)})`, d.liquido, 't'],
    ];
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">DRE gerencial</h2>
          <select value={dreCompetence} onChange={(e) => setDreCompetence(e.target.value as any)} className="border border-slate-300 rounded-md px-2 py-1.5 text-xs bg-white">
            <option value="MENSAL">Outubro/2026</option>
            <option value="SEMESTRAL">Maio a outubro/2026</option>
            <option value="BASE">Todo o período</option>
          </select>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-white rounded-md border border-slate-200 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50"><tr className="text-left"><th className={th}>Conta</th><th className={`${th} text-right`}>Valor</th><th className={`${th} text-right`}>AV %</th></tr></thead>
              <tbody>
                {rows.map(([label, v, kind]) => (
                  <tr key={label} className={`border-t border-slate-100 h-9 ${kind === 't' ? 'bg-slate-50 font-semibold text-slate-900' : kind === 'h' ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>
                    <td className={kind === 's' ? 'pl-7 pr-3 py-1.5' : 'px-3 py-1.5'}>{label}</td>
                    <td className={`px-3 py-1.5 text-right whitespace-nowrap ${v < 0 ? 'text-rose-700' : ''}`}>{money(v)}</td>
                    <td className="px-3 py-1.5 text-right">{pct(v, d.bruta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-400">Alíquotas gerenciais: PIS 0,65%, COFINS 3,00%, ISS 2,90% sobre serviços, IRPJ/CSLL pelo lucro presumido.</p>
          </div>
          <div className="bg-white rounded-md border border-slate-200 p-4 space-y-2">
            <div className="text-xs font-semibold text-slate-900">Por centro de custo</div>
            {Object.entries(d.cc).sort((a, b) => (b[1].rec + b[1].pag) - (a[1].rec + a[1].pag)).map(([k, v]) => (
              <div key={k} className="border-t border-slate-100 pt-1 text-xs">
                <div className="text-slate-700">{k}</div>
                <div className="flex justify-between"><span className="text-emerald-700">+{money(v.rec)}</span><span className="text-rose-700">-{money(v.pag)}</span><b>{money(v.rec - v.pag)}</b></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderBoletos = () => (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Boletos e PIX</h2>
        <Btn variant="primary" onClick={() => setShowNewInvoiceModal(true)} icon={Plus}>Emitir boleto / fatura</Btn>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Emitidos" value={String(invKpis.emitidos)} tone="text-slate-900" />
        <Kpi label="Liquidados" value={String(invKpis.liquidados)} tone="text-emerald-700" />
        <Kpi label="Em aberto" value={String(invKpis.abertos)} tone="text-amber-700" />
        <Kpi label="Conta emissora" value="Itaú #142155 / Inter #237906" tone="text-slate-900 text-sm" />
      </div>
      <div className="bg-white rounded-md border border-slate-200 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50">
            <tr className="text-left">
              <th className={th}>Vencimento</th>
              <th className={th}>Documento</th>
              <th className={th}>Cliente</th>
              <th className={`${th} text-right`}>Valor</th>
              <th className={th}>Situação</th>
              <th className={`${th} text-right`}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length + boletoEntries.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">Nenhum boleto encontrado.</td></tr>
            )}
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-t border-slate-100 h-10 hover:bg-slate-50">
                <td className={`${td} whitespace-nowrap text-slate-600`}>{inv.dueDate}</td>
                <td className={td}>
                  <div className="text-slate-800">Nº {inv.documentNumber}</div>
                  {inv.boletoDigitableLine && <div className="font-mono text-[11px] text-slate-400 break-all">{inv.boletoDigitableLine}</div>}
                </td>
                <td className={td}>
                  <div className="text-slate-700">{inv.companyName}</div>
                  {inv.companyCnpj && <div className="text-[11px] text-slate-400">{inv.companyCnpj}</div>}
                </td>
                <td className={`${td} text-right whitespace-nowrap font-semibold text-slate-900`}>{money(inv.netAmount)}</td>
                <td className={td}><Pill status={inv.status} /></td>
                <td className={`${td} text-right whitespace-nowrap`}>
                  <span className="inline-flex items-center gap-1">
                    <IconBtn title="Copiar linha digitável" icon={Copy} onClick={() => copy(inv.boletoDigitableLine || '', 'Linha digitável')} />
                    <IconBtn title="Copiar PIX copia e cola" icon={QrCode} onClick={() => copy(inv.pixCopyPaste || '', 'PIX Copia e Cola')} />
                    <RowMenu
                      items={[
                        { label: 'Visualizar', icon: Printer, onClick: () => setSelectedInvoiceForPrint(inv) },
                        { label: 'Enviar por e-mail', icon: Mail, onClick: () => setEmailModalPayload(buildIssuedInvoiceEmailPayload(inv, { remessaDocs: invoices })) },
                        ...(isIssuedInvoiceStatus(inv.status) ? [{ label: 'Gerar link', icon: Copy, onClick: async () => { const r = await copySignedInvoiceLink(inv.id); onShowToast(r.ok ? `Link do cliente copiado: ${r.url}` : r.error); } }] : []),
                        ...(inv.status !== 'PAGA' && inv.status !== 'CANCELADA' ? [{ label: 'Dar baixa', icon: CheckCircle2, onClick: () => payInvoice(inv) }] : []),
                      ]}
                    />
                  </span>
                </td>
              </tr>
            ))}
            {boletoEntries.map((fin) => (
              <tr key={fin.id} className="border-t border-slate-100 h-10 hover:bg-slate-50">
                <td className={`${td} whitespace-nowrap text-slate-600`}>{fin.dueDate}</td>
                <td className={td}>
                  <div className="text-slate-800">Título {fin.id.toUpperCase()}</div>
                  <div className="text-[11px] text-slate-400">{fin.paymentMethod}</div>
                </td>
                <td className={td}>
                  <div className="text-slate-700">{fin.companyName}</div>
                  {companyCnpj(fin.companyName) && <div className="text-[11px] text-slate-400">{companyCnpj(fin.companyName)}</div>}
                </td>
                <td className={`${td} text-right whitespace-nowrap font-semibold text-slate-900`}>{money(fin.amount)}</td>
                <td className={td}><Pill status={fin.status} /></td>
                <td className={`${td} text-right`}>
                  <RowMenu
                    items={[
                      { label: 'Enviar por e-mail', icon: Mail, onClick: () => emailEntry(fin) },
                      ...(fin.status !== 'PAGO' ? [{ label: 'Dar baixa', icon: CheckCircle2, onClick: () => payEntry(fin) }] : []),
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">{invoices.length + boletoEntries.length} registro(s)</div>
      </div>
    </div>
  );

  const renderAuxiliares = () => {
    const synced = (name: string) => bankAccounts.find((b) => b.name === name);
    const bankFields: Array<{ key: string; label: string; type?: 'text' | 'number' | 'select'; options?: string[] }> = [
      { key: 'name', label: 'Nome da Conta' },
      { key: 'balance', label: 'Saldo (R$)', type: 'number' },
      { key: 'status', label: 'Status', type: 'select', options: ['POSITIVE', 'NEGATIVE', 'ZERO'] },
    ];
    return (
      <div className="space-y-4">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Contas bancárias</h2>
            <Btn variant="primary" onClick={() => openCollectionEditor('bankAccounts', 'Nova Conta Bancária', { name: '', balance: 0, status: 'ZERO', lastMovedAt: new Date().toISOString().slice(0, 10) }, bankFields)} icon={Plus}>Adicionar</Btn>
          </div>
          <div className="bg-white rounded-md border border-slate-200 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50"><tr className="text-left"><th className={th}>Conta</th><th className={th}>Código</th><th className={th}>Tipo</th><th className={`${th} text-right`}>Saldo</th><th className={`${th} text-right`}>Ações</th></tr></thead>
              <tbody>
                {CORPORATE_ACCOUNTS.map((c) => {
                  const acc = synced(c.name);
                  return (
                    <tr key={c.name} className="border-t border-slate-100 h-10">
                      <td className={`${td} text-slate-800`}>{c.name}</td><td className={`${td} text-slate-600`}>{acc?.id || c.code}</td><td className={`${td} text-slate-600`}>{c.kind}</td>
                      <td className={`${td} text-right whitespace-nowrap font-semibold ${acc && acc.balance < 0 ? 'text-rose-700' : acc ? 'text-slate-900' : 'text-slate-400 font-normal'}`}>{acc ? money(acc.balance) : 'Não sincronizada'}</td>
                      <td className={`${td} text-right`}>
                        {acc && (
                          <button type="button" onClick={() => openCollectionEditor('bankAccounts', `Editar Saldo — ${acc.name}`, acc as unknown as Record<string, unknown>, bankFields)} className="text-xs font-medium text-[#1e3a6e] hover:underline cursor-pointer">
                            Editar saldo
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">{CORPORATE_ACCOUNTS.length} registro(s)</div>
          </div>
        </div>
        <div className="bg-white rounded-md border border-slate-200 p-4 space-y-3 text-xs">
          <h2 className="text-sm font-semibold text-slate-900">Conciliação OFX</h2>
          <div className="flex flex-wrap gap-2 items-center">
            <select value={ofxBank} onChange={(e) => setOfxBank(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5 bg-white">
              <option>Banco Inter</option><option>Banco Itaú</option>
            </select>
            <input ref={fileRef} type="file" accept=".ofx,.OFX" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) { setOfxContent(await f.text()); onShowToast(`Arquivo ${f.name} carregado.`); }
            }} />
            <Btn onClick={() => fileRef.current?.click()} icon={Upload}>Enviar .OFX</Btn>
            <Btn onClick={() => { setOfxContent(SAMPLE_OFX); onShowToast('Extrato OFX padrão carregado.'); }} icon={FileSpreadsheet}>Carregar OFX padrão</Btn>
            <Btn onClick={() => runOfx(false)} icon={RefreshCw}>{ofxBusy ? 'Processando...' : 'Parear lançamentos'}</Btn>
            <Btn variant="primary" onClick={() => runOfx(true)} icon={CheckCircle2}>Conciliar e baixar pareados</Btn>
          </div>
          <textarea value={ofxContent} onChange={(e) => setOfxContent(e.target.value)} rows={4} placeholder="Conteúdo do arquivo OFX" className="w-full border border-slate-300 rounded-md p-2 font-mono text-[11px]" />
          {ofxResult && (
            <div className="space-y-1">
              <div className="font-semibold text-slate-800">
                {ofxResult.matchedCount} pareado(s) de {ofxResult.summary?.transactionsParsed ?? 0} transação(ões) • Créditos {formatBRL(ofxResult.summary?.totalCredits || 0)} • Débitos {formatBRL(ofxResult.summary?.totalDebits || 0)}
              </div>
              {(ofxResult.reconciledEntries || []).map((r: any) => (
                <div key={r.entryId} className="flex justify-between gap-2 border-t border-slate-100 py-1.5">
                  <span className="text-slate-700">{r.ofxDate} • {r.ofxMemo} → {r.description} ({r.companyName})</span>
                  <span className="inline-flex items-center gap-2 whitespace-nowrap">
                    <b className="text-slate-900">{formatBRL(r.amount)}</b>
                    <Pill status={r.paid ? 'PAGO' : 'ABERTO'} />
                  </span>
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
      {(sub === 'FIN_PAGAR' || sub === 'FIN_RECEBER') && renderTitles()}
      {sub === 'FIN_FLUXO' && renderFluxo()}
      {sub === 'FIN_DRE' && renderDre()}
      {sub === 'FIN_BOLETOS' && renderBoletos()}
      {sub === 'FIN_AUXILIARES' && renderAuxiliares()}
    </div>
  );
}

type RowMenuItem = { label: string; icon?: LucideIcon; onClick: () => void; danger?: boolean };

function IconBtn({ title, icon: Icon, onClick }: { title: string; icon: LucideIcon; onClick: () => void }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-500 hover:bg-slate-100 hover:text-[#1e3a6e] cursor-pointer">
      <Icon size={14} />
    </button>
  );
}

function RowMenu({ items }: { items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <RowKebabMenu
      open={open}
      onOpenChange={setOpen}
      width={200}
      estimatedHeight={280}
      title="Ações"
      ariaLabel="Ações"
      renderTrigger={({ ref, open: isOpen, toggle }) => (
        <button
          ref={ref}
          type="button"
          aria-label="Ações"
          title="Ações"
          aria-expanded={isOpen}
          aria-haspopup="menu"
          onClick={toggle}
          className="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-500 hover:bg-slate-100 hover:text-[#1e3a6e] cursor-pointer"
        >
          <MoreVertical size={14} />
        </button>
      )}
    >
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); it.onClick(); }}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-slate-50 ${it.danger ? 'text-rose-700' : 'text-slate-700'}`}
          >
            {Icon && <Icon size={13} />} {it.label}
          </button>
        );
      })}
    </RowKebabMenu>
  );
}
