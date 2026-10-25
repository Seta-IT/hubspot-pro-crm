'use client';

import React, { useState } from 'react';
import {
  FileText,
  FileCheck2,
  Receipt,
  Package,
  RefreshCw,
  Plus,
  CheckCircle2,
  Printer,
  Copy,
  ShieldCheck,
  Building2,
  Boxes,
  ArrowUpRight,
  ArrowDownRight,
  Scale,
  X,
  Truck,
} from 'lucide-react';
import {
  Company,
  Contact,
  Deal,
  ErpCatalogItem,
  ErpCommercialProposal,
  ErpFiscalDocumentType,
  ErpFiscalInvoice,
  ErpFinancialEntry,
  ErpRentalContract,
  ErpTaxRegime,
  GestaoClickConfig,
} from '../../db/types';
import { formatBRL } from './ui-helpers';

export interface ErpOverviewPayload {
  kpis: {
    monthlyRentalMrr: number;
    totalContractedTcv: number;
    activeContractsCount: number;
    totalRentedEquipments: number;
    openProposalsCount: number;
    totalInvoicesCount: number;
    totalRentalBilled: number;
    issSavedBySv31Stf: number;
    totalReceivablesOpen: number;
    totalReceivablesPaid: number;
    totalPayables: number;
  };
  proposals: ErpCommercialProposal[];
  rentalContracts: ErpRentalContract[];
  invoices: ErpFiscalInvoice[];
  catalog: ErpCatalogItem[];
  financialEntries: ErpFinancialEntry[];
  gestaoClickConfig: GestaoClickConfig;
}

interface ErpGestaoClickTabProps {
  erpData: ErpOverviewPayload | null;
  companies: Company[];
  contacts: Contact[];
  deals: Deal[];
  onRefresh: () => Promise<void>;
  onShowToast: (msg: string) => void;
}

type ErpSubTab = 'PROPOSTAS' | 'CONTRATOS_LOCACAO' | 'FATURAS_FISCAL' | 'ESTOQUE_FINANCEIRO';

export default function ErpGestaoClickTab({
  erpData,
  companies,
  contacts,
  deals,
  onRefresh,
  onShowToast,
}: ErpGestaoClickTabProps) {
  const [subTab, setSubTab] = useState<ErpSubTab>('PROPOSTAS');
  const [syncingGc, setSyncingGc] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [selectedInvoiceForPrint, setSelectedInvoiceForPrint] =
    useState<ErpFiscalInvoice | null>(null);
  const [selectedProposalForPrint, setSelectedProposalForPrint] =
    useState<ErpCommercialProposal | null>(null);
  const [showNewProposalModal, setShowNewProposalModal] = useState(false);
  const [showNewInvoiceModal, setShowNewInvoiceModal] = useState(false);

  const [propTitle, setPropTitle] = useState('');
  const [propCompanyId, setPropCompanyId] = useState(companies[0]?.id || '');
  const [propContactId] = useState(contacts[0]?.id || '');
  const [propDealId] = useState(deals[0]?.id || '');
  const [propSeller, setPropSeller] = useState('Marcelo Lopes Mira');
  const [propMonths, setPropMonths] = useState('24');
  const [propSku, setPropSku] = useState('GC-EQ-00101');
  const [propQty, setPropQty] = useState('2');
  const [propUnitPrice, setPropUnitPrice] = useState('2850');

  const [invDocType, setInvDocType] = useState<ErpFiscalDocumentType>('FATURA_LOCACAO');
  const [invCompanyName, setInvCompanyName] = useState(
    companies[0]?.name || 'Nu Pagamentos S.A. (Nubank)'
  );
  const [invCompanyCnpj, setInvCompanyCnpj] = useState(
    companies[0]?.cnpj || '18.236.120/0001-58'
  );
  const [invGrossAmount, setInvGrossAmount] = useState('12000');
  const [invCompetence, setInvCompetence] = useState('10/2026');
  const [invDescription, setInvDescription] = useState(
    'Locação Mensal de Equipamentos Telecom & PABX IP (Dispensa de ISS — Súmula Vinculante 31 STF)'
  );

  if (!erpData) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
        Carregando módulo ERP Brasil, Propostas, Locação &amp; GestãoClick...
      </div>
    );
  }

  const {
    kpis,
    proposals,
    rentalContracts,
    invoices,
    catalog,
    financialEntries,
    gestaoClickConfig,
  } = erpData;

  const handleSyncGestaoClick = async () => {
    setSyncingGc(true);
    try {
      const res = await fetch('/api/erp/gestaoclick/sync', { method: 'POST' });
      if (res.ok) {
        onShowToast('Sincronização bidirecional GestãoClick + Seta Telecom concluída!');
        await onRefresh();
      }
    } finally {
      setSyncingGc(false);
    }
  };

  const handleChangeTaxRegime = async (taxRegime: ErpTaxRegime) => {
    const res = await fetch('/api/erp/gestaoclick/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taxRegime }),
    });
    if (res.ok) {
      onShowToast(`Regime tributário do ERP alterado para ${taxRegime}!`);
      await onRefresh();
    }
  };

  const handleApproveProposal = async (proposalId: string) => {
    setBusyId(proposalId);
    try {
      const res = await fetch(`/api/erp/proposals/${proposalId}/approve`, { method: 'POST' });
      if (res.ok) {
        const j = await res.json();
        const ctrNum = j.data?.contract?.contractNumber || 'LOC';
        const invNum = j.data?.invoice?.documentNumber || 'FAT-LOC';
        onShowToast(
          `Proposta aprovada! Contrato ${ctrNum} e Fatura de Locação ${invNum} gerados automaticamente!`
        );
        await onRefresh();
        setSubTab('CONTRATOS_LOCACAO');
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleGenerateContractInvoice = async (contractId: string) => {
    setBusyId(contractId);
    try {
      const res = await fetch(`/api/erp/rental-contracts/${contractId}/generate-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competenceMonth: '11/2026' }),
      });
      if (res.ok) {
        const j = await res.json();
        onShowToast(
          `Fatura/Recibo de Locação ${j.data?.documentNumber} emitida (0% ISS — Súmula Vinculante 31 STF)!`
        );
        await onRefresh();
        if (j.data) setSelectedInvoiceForPrint(j.data);
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleGenerateRemessaNfe = async (contractId: string) => {
    setBusyId(`rem-${contractId}`);
    try {
      const res = await fetch(`/api/erp/rental-contracts/${contractId}/generate-remessa`, {
        method: 'POST',
      });
      if (res.ok) {
        const j = await res.json();
        onShowToast(
          `NF-e de Remessa em Locação ${j.data?.documentNumber} (CFOP 5.908) emitida sem incidência de ICMS/IPI!`
        );
        await onRefresh();
        if (j.data) setSelectedInvoiceForPrint(j.data);
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleMarkInvoicePaid = async (invoiceId: string) => {
    setBusyId(invoiceId);
    try {
      const res = await fetch(`/api/erp/invoices/${invoiceId}/pay`, { method: 'POST' });
      if (res.ok) {
        onShowToast('Pagamento conciliado! Fatura e lançamento financeiro baixados.');
        await onRefresh();
        if (selectedInvoiceForPrint?.id === invoiceId) {
          setSelectedInvoiceForPrint({ ...selectedInvoiceForPrint, status: 'PAGA' });
        }
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateProposalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!propTitle.trim()) return;
    const comp = companies.find((c) => c.id === propCompanyId);
    const cont = contacts.find((c) => c.id === propContactId);
    const catItem = catalog.find((c) => c.gestaoClickCode === propSku) || catalog[0];
    const qty = Math.max(1, Number(propQty) || 1);
    const unitPrice = Number(propUnitPrice) || catItem?.monthlyRentalPrice || 2500;
    const monthlyTotal = qty * unitPrice;

    const res = await fetch('/api/erp/proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: propTitle.trim(),
        companyId: comp?.id || null,
        companyName: comp?.name || 'Empresa Cliente B2B',
        companyCnpj: comp?.cnpj || '18.236.120/0001-58',
        contactId: cont?.id || null,
        contactName: cont ? `${cont.firstName} ${cont.lastName}` : 'Decisor Comercial',
        dealId: propDealId || null,
        sellerName: propSeller,
        contractMonths: Number(propMonths) || 24,
        monthlyRecurringTotal: monthlyTotal,
        items: [
          {
            id: `pi-${Date.now()}`,
            sku: catItem?.gestaoClickCode || 'GC-EQ-00101',
            description: catItem?.name || 'Locação de Equipamento Telecom Seta',
            fiscalNature: catItem?.fiscalNature || 'LOCACAO_BENS_MOVEIS',
            ncmOrServiceCode: catItem?.ncmOrLc116 || 'NCM 8517.62.14',
            quantity: qty,
            unitPrice,
            discountPercent: 0,
            isRecurring: true,
            totalMonthly: monthlyTotal,
          },
        ],
      }),
    });

    if (res.ok) {
      onShowToast('Nova Proposta Comercial gerada no padrão GestãoClick!');
      setShowNewProposalModal(false);
      setPropTitle('');
      await onRefresh();
    }
  };

  const handleCreateInvoiceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/erp/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documentType: invDocType,
        companyName: invCompanyName,
        companyCnpj: invCompanyCnpj,
        grossAmount: Number(invGrossAmount) || 0,
        competenceMonth: invCompetence,
        itemsDescription: [
          {
            description: invDescription,
            quantity: 1,
            unitValue: Number(invGrossAmount) || 0,
            totalValue: Number(invGrossAmount) || 0,
          },
        ],
      }),
    });
    if (res.ok) {
      const j = await res.json();
      onShowToast(`Documento fiscal ${j.data?.documentNumber} emitido com cálculo tributário automático!`);
      setShowNewInvoiceModal(false);
      await onRefresh();
      if (j.data) setSelectedInvoiceForPrint(j.data);
    }
  };

  return (
    <div className="space-y-6">
      {/* HERO HEADER: ERP BRASIL & LOCAÇÃO (PADRÃO GESTÃOCLICK + SETA TELECOM) */}
      <div className="bg-gradient-to-r from-[#0f172a] via-[#1e293b] to-[#0f172a] rounded-2xl p-6 text-white shadow-lg border border-slate-800">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                CONECTADO AO GESTÃOCLICK ERP
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#ff7a59]/20 text-[#ff987f] border border-[#ff7a59]/30">
                SETA TELECOM LTDA • CNPJ {gestaoClickConfig.companyCnpj}
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                LC 116/2003 + Súmula Vinculante 31 STF (0% ISS em Locação Pura)
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight">
              Módulo ERP Brasil: Propostas, Contratos de Locação &amp; Faturamento Fiscal
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-3xl">
              Geração de propostas comerciais integradas ao Kanban, gestão de contratos de locação de equipamentos por Número de Série (S/N), emissão de Faturas/Recibos de Locação (isentos de ISS conforme Súmula Vinculante 31 STF), NFS-e com retenções federais (IRRF 1,5% / CSRF 4,65%) e NF-e de Remessa (CFOP 5.908 / 6.908).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <div className="bg-slate-900/90 border border-slate-700 rounded-xl px-3 py-1.5">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">
                Regime Tributário Seta
              </span>
              <select
                aria-label="Regime Tributário"
                value={gestaoClickConfig.taxRegime}
                onChange={(e) => handleChangeTaxRegime(e.target.value as ErpTaxRegime)}
                className="bg-transparent text-xs font-extrabold text-emerald-400 focus:outline-none cursor-pointer"
              >
                <option value="LUCRO_PRESUMIDO" className="text-slate-900">
                  Lucro Presumido (PIS 0,65% / COFINS 3%)
                </option>
                <option value="LUCRO_REAL" className="text-slate-900">
                  Lucro Real (PIS 1,65% / COFINS 7,6%)
                </option>
                <option value="SIMPLES_NACIONAL" className="text-slate-900">
                  Simples Nacional (Anexo III / Locação)
                </option>
              </select>
            </div>

            <button
              type="button"
              onClick={handleSyncGestaoClick}
              disabled={syncingGc}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold shadow-md transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${syncingGc ? 'animate-spin' : ''}`} />
              {syncingGc ? 'Sincronizando GestãoClick...' : 'Sincronizar GestãoClick'}
            </button>
          </div>
        </div>

        {/* KPI STRIP */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-5 pt-5 border-t border-slate-800">
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
            <span className="text-[11px] text-slate-400">MRR Contratos Locação</span>
            <div className="text-base sm:text-lg font-extrabold text-emerald-400 mt-0.5">
              {formatBRL(kpis.monthlyRentalMrr)}/mês
            </div>
            <span className="text-[10px] text-slate-400">
              {kpis.activeContractsCount} contratos ativos
            </span>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
            <span className="text-[11px] text-slate-400">TCV Carteira Locação</span>
            <div className="text-base sm:text-lg font-extrabold text-white mt-0.5">
              {formatBRL(kpis.totalContractedTcv)}
            </div>
            <span className="text-[10px] text-slate-400">
              {kpis.totalRentedEquipments} equipamentos em clientes
            </span>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
            <span className="text-[11px] text-slate-400">Economia ISS (SV 31 STF)</span>
            <div className="text-base sm:text-lg font-extrabold text-amber-300 mt-0.5">
              {formatBRL(kpis.issSavedBySv31Stf)}
            </div>
            <span className="text-[10px] text-amber-200/80">0% ISS em Fatura de Locação</span>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
            <span className="text-[11px] text-slate-400">Propostas em Aberto</span>
            <div className="text-base sm:text-lg font-extrabold text-[#ff987f] mt-0.5">
              {kpis.openProposalsCount} propostas
            </div>
            <span className="text-[10px] text-slate-400">Total: {proposals.length} emitidas</span>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
            <span className="text-[11px] text-slate-400">Contas a Receber (Aberto)</span>
            <div className="text-base sm:text-lg font-extrabold text-sky-400 mt-0.5">
              {formatBRL(kpis.totalReceivablesOpen)}
            </div>
            <span className="text-[10px] text-emerald-400">
              Recebido: {formatBRL(kpis.totalReceivablesPaid)}
            </span>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
            <span className="text-[11px] text-slate-400">Faturas &amp; NF-e Emitidas</span>
            <div className="text-base sm:text-lg font-extrabold text-white mt-0.5">
              {kpis.totalInvoicesCount} docs
            </div>
            <span className="text-[10px] text-slate-400">
              Fatura Locação + NFS-e + CFOP 5.908
            </span>
          </div>
        </div>
      </div>

      {/* ERP MODULE NAVIGATION BAR */}
      <div className="bg-white rounded-2xl border border-slate-200 p-2 shadow-sm flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSubTab('PROPOSTAS')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
              subTab === 'PROPOSTAS'
                ? 'bg-[#ff7a59] text-white shadow-sm'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <FileText className="w-4 h-4" />
            1. Propostas Comerciais ({proposals.length})
          </button>

          <button
            type="button"
            onClick={() => setSubTab('CONTRATOS_LOCACAO')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
              subTab === 'CONTRATOS_LOCACAO'
                ? 'bg-[#ff7a59] text-white shadow-sm'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <FileCheck2 className="w-4 h-4" />
            2. Contratos de Locação &amp; S/N ({rentalContracts.length})
          </button>

          <button
            type="button"
            onClick={() => setSubTab('FATURAS_FISCAL')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
              subTab === 'FATURAS_FISCAL'
                ? 'bg-[#ff7a59] text-white shadow-sm'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Receipt className="w-4 h-4" />
            3. Faturas/Recibos de Locação, NFS-e &amp; NF-e ({invoices.length})
          </button>

          <button
            type="button"
            onClick={() => setSubTab('ESTOQUE_FINANCEIRO')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
              subTab === 'ESTOQUE_FINANCEIRO'
                ? 'bg-[#ff7a59] text-white shadow-sm'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Boxes className="w-4 h-4" />
            4. Estoque Locado, Financeiro &amp; GestãoClick
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowNewProposalModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Nova Proposta
          </button>
          <button
            type="button"
            onClick={() => setShowNewInvoiceModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-bold transition cursor-pointer"
          >
            <Receipt className="w-3.5 h-3.5" />
            Emitir Fatura / Nota Fiscal
          </button>
        </div>
      </div>

      {/* SUB-TAB 1: PROPOSTAS COMERCIAIS */}
      {subTab === 'PROPOSTAS' && (
        <div className="space-y-4">
          {proposals.map((prop) => {
            const isConverted = prop.status === 'CONVERTIDA_CONTRATO';
            return (
              <div
                key={prop.id}
                className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:border-slate-300 transition space-y-4"
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-md text-xs font-black bg-slate-900 text-white">
                        {prop.code}
                      </span>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold ${
                          isConverted
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : prop.status === 'APROVADA'
                              ? 'bg-blue-100 text-blue-800 border border-blue-300'
                              : 'bg-amber-100 text-amber-800 border border-amber-300'
                        }`}
                      >
                        {prop.status === 'CONVERTIDA_CONTRATO'
                          ? 'CONVERTIDA EM CONTRATO & FATURA'
                          : prop.status}
                      </span>
                      <span className="text-xs text-slate-500 font-medium">
                        Executivo: <strong>{prop.sellerName}</strong> • Prazo:{' '}
                        <strong>{prop.contractMonths} meses</strong>
                      </span>
                    </div>
                    <h3 className="text-base font-extrabold text-slate-900 mt-1.5">{prop.title}</h3>
                    <div className="text-xs text-slate-600 mt-0.5">
                      Cliente: <strong>{prop.companyName}</strong> (CNPJ: {prop.companyCnpj}) •
                      Decisor: <strong>{prop.contactName}</strong>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <div className="text-right bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-200">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">
                        Mensalidade (MRR)
                      </span>
                      <span className="text-base font-black text-emerald-700">
                        {formatBRL(prop.monthlyRecurringTotal)}/mês
                      </span>
                      <span className="text-[11px] text-slate-500 block">
                        TCV ({prop.contractMonths}m): {formatBRL(prop.totalContractValue)}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedProposalForPrint(prop)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-bold text-slate-700 transition cursor-pointer"
                    >
                      <Printer className="w-4 h-4 text-slate-600" />
                      Ver / Imprimir Proposta
                    </button>

                    {!isConverted && (
                      <button
                        type="button"
                        disabled={busyId === prop.id}
                        onClick={() => handleApproveProposal(prop.id)}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-sm transition cursor-pointer disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        {busyId === prop.id
                          ? 'Convertendo...'
                          : 'Aprovar & Gerar Contrato + Fatura'}
                      </button>
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b border-slate-200">
                      <tr>
                        <th className="py-2 px-3">SKU GestãoClick</th>
                        <th className="py-2 px-3">Item / Equipamento / Serviço</th>
                        <th className="py-2 px-3">Natureza Fiscal Brasil</th>
                        <th className="py-2 px-3 text-right">Qtd</th>
                        <th className="py-2 px-3 text-right">Unitário</th>
                        <th className="py-2 px-3 text-right">Total Mensal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {prop.items.map((item) => (
                        <tr key={item.id}>
                          <td className="py-2 px-3 font-mono font-bold text-slate-700">
                            {item.sku}
                          </td>
                          <td className="py-2 px-3 font-semibold text-slate-900">
                            {item.description}
                          </td>
                          <td className="py-2 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                item.fiscalNature === 'LOCACAO_BENS_MOVEIS'
                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                  : 'bg-indigo-50 text-indigo-800 border border-indigo-200'
                              }`}
                            >
                              {item.fiscalNature === 'LOCACAO_BENS_MOVEIS'
                                ? 'Locação Pura (Isento ISS - SV 31 STF)'
                                : 'Serviço Técnico (NFS-e LC 116 01.07)'}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right font-semibold">{item.quantity}</td>
                          <td className="py-2 px-3 text-right">{formatBRL(item.unitPrice)}</td>
                          <td className="py-2 px-3 text-right font-bold text-slate-900">
                            {formatBRL(item.totalMonthly)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 bg-slate-50 p-3 rounded-xl border border-slate-200/70">
                  <span>
                    <strong>Enquadramento Tributário:</strong> {prop.commercialNotes}
                  </span>
                  <span>
                    <strong>Condição:</strong> {prop.paymentCondition}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* SUB-TAB 2: CONTRATOS DE LOCAÇÃO & EQUIPAMENTOS */}
      {subTab === 'CONTRATOS_LOCACAO' && (
        <div className="space-y-4">
          {rentalContracts.map((ctr) => (
            <div
              key={ctr.id}
              className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4"
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-md text-xs font-black bg-indigo-950 text-white">
                      {ctr.contractNumber}
                    </span>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold ${
                        ctr.status === 'ATIVO'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : 'bg-amber-100 text-amber-800 border border-amber-300'
                      }`}
                    >
                      {ctr.status === 'ATIVO' ? 'LOCAÇÃO ATIVA' : 'RENOVAÇÃO PRÓXIMA'}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] font-bold">
                      NF-e Remessa CFOP {ctr.remessaCfop} Nº {ctr.remessaNfeNumber}
                    </span>
                    <span className="text-xs text-slate-500">
                      Reajuste: <strong>{ctr.readjustmentIndex}</strong> • Vencimento todo dia{' '}
                      <strong>{ctr.dueDay}</strong>
                    </span>
                  </div>
                  <h3 className="text-base font-extrabold text-slate-900 mt-1.5">{ctr.title}</h3>
                  <div className="text-xs text-slate-600 mt-0.5">
                    Locatária: <strong>{ctr.companyName}</strong> (CNPJ: {ctr.companyCnpj}) •
                    Vigência: <strong>{ctr.startDate}</strong> até <strong>{ctr.endDate}</strong> (
                    {ctr.contractMonths} meses)
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="text-right bg-emerald-50/70 px-3.5 py-2 rounded-xl border border-emerald-200">
                    <span className="text-[10px] uppercase font-bold text-emerald-700 block">
                      Aluguel Mensal (0% ISS)
                    </span>
                    <span className="text-base font-black text-emerald-800">
                      {formatBRL(ctr.monthlyValue)}/mês
                    </span>
                    <span className="text-[10px] text-emerald-700 block">
                      Última comp.: {ctr.lastBilledCompetence || '—'}
                    </span>
                  </div>

                  <button
                    type="button"
                    disabled={busyId === `rem-${ctr.id}`}
                    onClick={() => handleGenerateRemessaNfe(ctr.id)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-bold text-slate-700 transition cursor-pointer"
                  >
                    <Truck className="w-4 h-4 text-indigo-600" />
                    Emitir NF-e Remessa ({ctr.remessaCfop})
                  </button>

                  <button
                    type="button"
                    disabled={busyId === ctr.id}
                    onClick={() => handleGenerateContractInvoice(ctr.id)}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold shadow-sm transition cursor-pointer disabled:opacity-50"
                  >
                    <Receipt className="w-4 h-4" />
                    {busyId === ctr.id
                      ? 'Emitindo Fatura...'
                      : 'Emitir Fatura/Recibo de Locação do Mês'}
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b border-slate-200">
                    <tr>
                      <th className="py-2 px-3">SKU GestãoClick</th>
                      <th className="py-2 px-3">Equipamento Locado (Patrimônio Seta)</th>
                      <th className="py-2 px-3">Nº de Série (S/N)</th>
                      <th className="py-2 px-3">NCM / CFOP Remessa</th>
                      <th className="py-2 px-3 text-right">Qtd</th>
                      <th className="py-2 px-3 text-right">Valor Patrimonial</th>
                      <th className="py-2 px-3 text-right">Locação Mensal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ctr.equipments.map((eq) => (
                      <tr key={eq.id}>
                        <td className="py-2 px-3 font-mono font-bold text-slate-700">
                          {eq.skuGestaoClick}
                        </td>
                        <td className="py-2 px-3 font-semibold text-slate-900">
                          {eq.description}
                        </td>
                        <td className="py-2 px-3">
                          <span className="px-2 py-0.5 rounded bg-slate-100 font-mono text-[11px] font-bold text-slate-800">
                            {eq.serialNumber}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-slate-600">
                          NCM {eq.ncm} • CFOP {eq.remessaCfop}
                        </td>
                        <td className="py-2 px-3 text-right font-semibold">{eq.quantity}</td>
                        <td className="py-2 px-3 text-right text-slate-600">
                          {formatBRL(eq.assetValueBrl)}
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-emerald-700">
                          {formatBRL(eq.quantity * eq.unitMonthlyRent)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200/80 text-xs text-amber-950 flex items-center gap-2">
                <Scale className="w-4 h-4 text-amber-700 shrink-0" />
                <span>
                  <strong>Amparo Legal Tributário:</strong> {ctr.legalBasisNote}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SUB-TAB 3: FATURAS/RECIBOS DE LOCAÇÃO, NFS-E & NF-E REMESSA */}
      {subTab === 'FATURAS_FISCAL' && (
        <div className="space-y-4">
          {invoices.map((inv) => {
            const tb = inv.taxBreakdown;
            const isPaid = inv.status === 'PAGA';
            return (
              <div
                key={inv.id}
                className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4"
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-md text-xs font-black bg-slate-900 text-white">
                        {inv.documentNumber}
                      </span>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold ${
                          inv.documentType === 'FATURA_LOCACAO'
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : inv.documentType === 'NFSE_SERVICO'
                              ? 'bg-indigo-100 text-indigo-800 border border-indigo-300'
                              : 'bg-amber-100 text-amber-800 border border-amber-300'
                        }`}
                      >
                        {inv.documentType === 'FATURA_LOCACAO'
                          ? 'FATURA / RECIBO DE LOCAÇÃO (0% ISS — SV 31 STF)'
                          : inv.documentType === 'NFSE_SERVICO'
                            ? 'NFS-e SERVIÇO TÉCNICO (LC 116 ITEM 01.07)'
                            : 'NF-e REMESSA DE LOCAÇÃO (CFOP 5.908)'}
                      </span>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold ${
                          isPaid
                            ? 'bg-emerald-600 text-white'
                            : 'bg-orange-100 text-[#e05835] border border-orange-300'
                        }`}
                      >
                        {inv.status}
                      </span>
                      <span className="text-xs text-slate-500">
                        Competência: <strong>{inv.competenceMonth}</strong> • Vencimento:{' '}
                        <strong>{inv.dueDate}</strong>
                      </span>
                    </div>

                    <h3 className="text-base font-extrabold text-slate-900 mt-1.5">
                      {inv.companyName} — CNPJ {inv.companyCnpj}
                    </h3>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Chave / Autenticação:{' '}
                      <span className="font-mono">{inv.verificationCodeOrKey}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <div className="text-right bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-200">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">
                        Valor Bruto: {formatBRL(inv.grossAmount)}
                      </span>
                      <span className="text-base font-black text-slate-900">
                        Líquido: {formatBRL(inv.netAmount)}
                      </span>
                      <span className="text-[10px] text-slate-500 block">
                        Retenções na fonte: {formatBRL(tb.totalWithheld)}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedInvoiceForPrint(inv)}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold shadow-sm transition cursor-pointer"
                    >
                      <Printer className="w-4 h-4 text-[#ff7a59]" />
                      Ver / Imprimir Fatura Oficial
                    </button>

                    {!isPaid && (
                      <button
                        type="button"
                        disabled={busyId === inv.id}
                        onClick={() => handleMarkInvoicePaid(inv.id)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold transition cursor-pointer"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        Confirmar Recebimento
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 pt-2 border-t border-slate-100 text-xs">
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
                    <span className="text-[10px] text-slate-400 block">ISSQN Municipal</span>
                    <strong className="text-slate-900">
                      {tb.issRatePercent}% ({formatBRL(tb.issAmount)})
                    </strong>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
                    <span className="text-[10px] text-slate-400 block">PIS ({tb.pisRatePercent}%)</span>
                    <strong className="text-slate-900">{formatBRL(tb.pisAmount)}</strong>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
                    <span className="text-[10px] text-slate-400 block">
                      COFINS ({tb.cofinsRatePercent}%)
                    </span>
                    <strong className="text-slate-900">{formatBRL(tb.cofinsAmount)}</strong>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
                    <span className="text-[10px] text-slate-400 block">IRPJ + CSLL (Est.)</span>
                    <strong className="text-slate-900">
                      {formatBRL(tb.irpjEstimatedAmount + tb.csllEstimatedAmount)}
                    </strong>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
                    <span className="text-[10px] text-slate-400 block">
                      Ret. IRRF ({tb.irrfWithheldRatePercent}%)
                    </span>
                    <strong className="text-rose-700">{formatBRL(tb.irrfWithheldAmount)}</strong>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
                    <span className="text-[10px] text-slate-400 block">
                      Ret. CSRF ({tb.csrfWithheldRatePercent}%)
                    </span>
                    <strong className="text-rose-700">{formatBRL(tb.csrfWithheldAmount)}</strong>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* SUB-TAB 4: ESTOQUE LOCADO, FINANCEIRO & CONECTOR GESTÃOCLICK */}
      {subTab === 'ESTOQUE_FINANCEIRO' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                <Package className="w-4 h-4 text-[#ff7a59]" />
                Catálogo de Equipamentos &amp; Serviços (GestãoClick)
              </h3>
              <span className="text-xs text-slate-500">{catalog.length} itens cadastrados</span>
            </div>

            <div className="space-y-2.5">
              {catalog.map((item) => (
                <div
                  key={item.id}
                  className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 flex items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                        {item.gestaoClickCode}
                      </span>
                      <span className="font-bold text-slate-900">{item.name}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      {item.ncmOrLc116} • CFOP Padrão: <strong>{item.cfopDefault}</strong>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-extrabold text-emerald-700">
                      {formatBRL(item.monthlyRentalPrice)}/mês
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Disp: <strong>{item.stockAvailable}</strong> | Locados:{' '}
                      <strong className="text-indigo-700">{item.stockRentedInClients}</strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-emerald-600" />
                Fluxo Financeiro (Contas a Receber &amp; Contas a Pagar)
              </h3>
              <span className="text-xs text-slate-500">
                Sincronizado com Faturas de Locação e DARFs
              </span>
            </div>

            <div className="space-y-2.5">
              {financialEntries.map((fin) => (
                <div
                  key={fin.id}
                  className="p-3.5 rounded-xl border border-slate-200 bg-white flex items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-start gap-2.5">
                    {fin.type === 'RECEBER' ? (
                      <ArrowUpRight className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <ArrowDownRight className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <div className="font-bold text-slate-900">{fin.description}</div>
                      <div className="text-[11px] text-slate-500">
                        {fin.companyName} • {fin.costCenter} • Venc: {fin.dueDate}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div
                      className={`font-extrabold ${
                        fin.type === 'RECEBER' ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {fin.type === 'RECEBER' ? '+' : '-'}
                      {formatBRL(fin.amount)}
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        fin.status === 'PAGO'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {fin.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: IMPRESSÃO / VISUALIZAÇÃO DE FATURA / RECIBO DE LOCAÇÃO OFICIAL */}
      {selectedInvoiceForPrint && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-300 shadow-2xl max-w-3xl w-full overflow-hidden my-8">
            <div className="px-6 py-4 bg-[#0f172a] text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <span className="font-extrabold text-sm">
                  Espelho Oficial do Documento Fiscal — {selectedInvoiceForPrint.documentNumber}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-bold cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Imprimir / Salvar PDF
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedInvoiceForPrint(null)}
                  className="p-1 text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-5 text-xs text-slate-800">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b-2 border-slate-900">
                <div>
                  <div className="text-base font-black text-slate-900">
                    {gestaoClickConfig.companyLegalName}
                  </div>
                  <div>CNPJ: {gestaoClickConfig.companyCnpj}</div>
                  <div>
                    Inscrição Municipal: {gestaoClickConfig.municipalRegistration} • IE:{' '}
                    {gestaoClickConfig.stateRegistration}
                  </div>
                  <div className="text-slate-500">
                    Regime Tributário: {selectedInvoiceForPrint.taxBreakdown.taxRegime}
                  </div>
                </div>
                <div className="text-right bg-slate-100 p-3 rounded-xl border border-slate-300">
                  <div className="text-[10px] font-bold uppercase text-slate-500">
                    {selectedInvoiceForPrint.documentType === 'FATURA_LOCACAO'
                      ? 'FATURA / RECIBO DE LOCAÇÃO DE BENS MÓVEIS'
                      : selectedInvoiceForPrint.documentType === 'NFSE_SERVICO'
                        ? 'NOTA FISCAL DE SERVIÇOS ELETRÔNICA (NFS-e)'
                        : 'DANFE — NF-e DE REMESSA EM LOCAÇÃO (MOD. 55)'}
                  </div>
                  <div className="text-lg font-black text-slate-900">
                    Nº {selectedInvoiceForPrint.documentNumber}
                  </div>
                  <div>
                    Emissão: <strong>{selectedInvoiceForPrint.issueDate}</strong> • Vencimento:{' '}
                    <strong>{selectedInvoiceForPrint.dueDate}</strong>
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                    Locatário / Tomador
                  </span>
                  <strong className="text-sm text-slate-900">
                    {selectedInvoiceForPrint.companyName}
                  </strong>
                  <div>CNPJ: {selectedInvoiceForPrint.companyCnpj}</div>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                    Endereço &amp; Competência
                  </span>
                  <div>{selectedInvoiceForPrint.companyAddress}</div>
                  <div>
                    Competência: <strong>{selectedInvoiceForPrint.competenceMonth}</strong>
                  </div>
                </div>
              </div>

              <div className="border border-slate-300 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900 text-white text-[10px] uppercase">
                    <tr>
                      <th className="py-2 px-3">Descrição do Item / Equipamento Locado</th>
                      <th className="py-2 px-3">Nº Série (S/N)</th>
                      <th className="py-2 px-3 text-right">Qtd</th>
                      <th className="py-2 px-3 text-right">Vlr. Unitário</th>
                      <th className="py-2 px-3 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {selectedInvoiceForPrint.itemsDescription.map((it, idx) => (
                      <tr key={idx}>
                        <td className="py-2.5 px-3 font-semibold">{it.description}</td>
                        <td className="py-2.5 px-3 font-mono">{it.serialNumber || '—'}</td>
                        <td className="py-2.5 px-3 text-right">{it.quantity}</td>
                        <td className="py-2.5 px-3 text-right">{formatBRL(it.unitValue)}</td>
                        <td className="py-2.5 px-3 text-right font-bold">
                          {formatBRL(it.totalValue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="p-4 rounded-xl bg-emerald-50/90 border border-emerald-300 space-y-2">
                <div className="font-extrabold text-emerald-950 uppercase text-[11px]">
                  Enquadramento Tributário &amp; Fundamentação Legal (Legislação Brasileira)
                </div>
                <p className="text-emerald-900 leading-relaxed">
                  {selectedInvoiceForPrint.taxBreakdown.legalExemptionNotice}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-emerald-200 text-[11px]">
                  <div>
                    ISSQN:{' '}
                    <strong>{formatBRL(selectedInvoiceForPrint.taxBreakdown.issAmount)}</strong> (
                    {selectedInvoiceForPrint.taxBreakdown.issRatePercent}%)
                  </div>
                  <div>
                    PIS/COFINS:{' '}
                    <strong>
                      {formatBRL(
                        selectedInvoiceForPrint.taxBreakdown.pisAmount +
                          selectedInvoiceForPrint.taxBreakdown.cofinsAmount
                      )}
                    </strong>
                  </div>
                  <div>
                    Retenções na Fonte:{' '}
                    <strong>
                      {formatBRL(selectedInvoiceForPrint.taxBreakdown.totalWithheld)}
                    </strong>
                  </div>
                  <div>
                    Valor Líquido a Pagar:{' '}
                    <strong className="text-sm text-emerald-950">
                      {formatBRL(selectedInvoiceForPrint.netAmount)}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-100 border border-slate-300 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-slate-900 uppercase text-[11px]">
                    Dados para Liquidação Financeira (Boleto Registrado &amp; PIX Copia-e-Cola)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(selectedInvoiceForPrint.pixCopyPaste);
                      onShowToast('Código PIX Copia-e-Cola copiado!');
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 text-white text-[11px] font-bold cursor-pointer"
                  >
                    <Copy className="w-3 h-3" /> Copiar PIX
                  </button>
                </div>
                <div className="font-mono text-xs bg-white p-2.5 rounded border border-slate-300">
                  <strong>Linha Digitável Boleto:</strong>{' '}
                  {selectedInvoiceForPrint.boletoDigitableLine}
                </div>
                <div className="font-mono text-[11px] bg-white p-2.5 rounded border border-slate-300 break-all">
                  <strong>PIX Copia e Cola:</strong> {selectedInvoiceForPrint.pixCopyPaste}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: IMPRESSÃO DE PROPOSTA COMERCIAL */}
      {selectedProposalForPrint && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-300 shadow-2xl max-w-3xl w-full overflow-hidden my-8">
            <div className="px-6 py-4 bg-[#1e293b] text-white flex items-center justify-between">
              <span className="font-extrabold text-sm">
                Proposta Comercial Executiva — {selectedProposalForPrint.code}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-1.5 rounded-lg bg-[#ff7a59] text-white text-xs font-bold cursor-pointer"
                >
                  Imprimir PDF
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedProposalForPrint(null)}
                  className="p-1 text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="p-6 space-y-4 text-xs text-slate-800">
              <div className="flex justify-between border-b pb-3">
                <div>
                  <h3 className="text-base font-black text-slate-900">SETA TELECOM LTDA</h3>
                  <p>CNPJ {gestaoClickConfig.companyCnpj} • HubSpot Portal 4369067</p>
                  <p>Responsável Comercial: {selectedProposalForPrint.sellerName}</p>
                </div>
                <div className="text-right">
                  <div className="text-sm font-black">{selectedProposalForPrint.code}</div>
                  <div>Cliente: {selectedProposalForPrint.companyName}</div>
                  <div>CNPJ: {selectedProposalForPrint.companyCnpj}</div>
                </div>
              </div>
              <h4 className="text-sm font-extrabold text-slate-900">
                {selectedProposalForPrint.title}
              </h4>
              <p className="text-slate-600">{selectedProposalForPrint.commercialNotes}</p>
              <p className="text-slate-600">
                <strong>Cláusulas Técnicas &amp; SLA:</strong>{' '}
                {selectedProposalForPrint.technicalClauses}
              </p>
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex justify-between items-center">
                <span className="font-bold text-emerald-900">
                  Mensalidade Recorrente (MRR):{' '}
                  {formatBRL(selectedProposalForPrint.monthlyRecurringTotal)}/mês
                </span>
                <span className="font-black text-emerald-950 text-sm">
                  Valor Global ({selectedProposalForPrint.contractMonths} meses):{' '}
                  {formatBRL(selectedProposalForPrint.totalContractValue)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: NOVA PROPOSTA COMERCIAL */}
      {showNewProposalModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <h3 className="text-sm font-extrabold">Gerar Nova Proposta Comercial (ERP Seta)</h3>
              <button
                type="button"
                onClick={() => setShowNewProposalModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateProposalSubmit} className="p-6 space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Título da Proposta Comercial *
                </label>
                <input
                  type="text"
                  required
                  value={propTitle}
                  onChange={(e) => setPropTitle(e.target.value)}
                  placeholder="Ex: Locação PABX IP Seta Cloud + Kit 20 Terminais Yealink"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Empresa Cliente</label>
                  <select
                    value={propCompanyId}
                    onChange={(e) => setPropCompanyId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white"
                  >
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Executivo Seta Telecom
                  </label>
                  <select
                    value={propSeller}
                    onChange={(e) => setPropSeller(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white"
                  >
                    <option value="Marcelo Lopes Mira">Marcelo Lopes Mira</option>
                    <option value="Evelyn Ternero Seta Telecom">Evelyn Ternero Seta Telecom</option>
                    <option value="Contato Seta Telecom">Contato Seta Telecom</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Equipamento / Serviço (Catálogo GestãoClick)
                  </label>
                  <select
                    value={propSku}
                    onChange={(e) => {
                      setPropSku(e.target.value);
                      const found = catalog.find((c) => c.gestaoClickCode === e.target.value);
                      if (found) setPropUnitPrice(String(found.monthlyRentalPrice));
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white"
                  >
                    {catalog.map((c) => (
                      <option key={c.id} value={c.gestaoClickCode}>
                        {c.gestaoClickCode} — {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Prazo Contratual (Meses)
                  </label>
                  <select
                    value={propMonths}
                    onChange={(e) => setPropMonths(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white"
                  >
                    <option value="12">12 meses</option>
                    <option value="24">24 meses</option>
                    <option value="36">36 meses</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Quantidade</label>
                  <input
                    type="number"
                    min={1}
                    value={propQty}
                    onChange={(e) => setPropQty(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Valor Mensal Unitário (R$)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={propUnitPrice}
                    onChange={(e) => setPropUnitPrice(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowNewProposalModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-[#ff7a59] text-white font-extrabold"
                >
                  Criar Proposta Comercial
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EMITIR FATURA DE LOCAÇÃO / NFS-E / NF-E REMESSA */}
      {showNewInvoiceModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <h3 className="text-sm font-extrabold">
                Emitir Fatura de Locação / NFS-e / NF-e Remessa
              </h3>
              <button
                type="button"
                onClick={() => setShowNewInvoiceModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateInvoiceSubmit} className="p-6 space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Espécie de Documento Fiscal Brasileiro
                </label>
                <select
                  value={invDocType}
                  onChange={(e) => setInvDocType(e.target.value as ErpFiscalDocumentType)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-semibold"
                >
                  <option value="FATURA_LOCACAO">
                    Fatura / Recibo de Locação de Bens Móveis (0% ISS — Súmula Vinculante 31 STF)
                  </option>
                  <option value="NFSE_SERVICO">
                    NFS-e Serviço Técnico TI/Telecom (LC 116 Item 01.07 + Ret. IRRF/CSRF)
                  </option>
                  <option value="NFE_REMESSA_LOCACAO">
                    NF-e Remessa de Bem p/ Contrato de Locação (CFOP 5.908 / 6.908)
                  </option>
                  <option value="NFCOM_TELECOM">
                    NFCom Modelo 62 — Serviço de Comunicação Multimídia (SCM Anatel)
                  </option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Razão Social Tomador</label>
                  <input
                    type="text"
                    required
                    value={invCompanyName}
                    onChange={(e) => setInvCompanyName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">CNPJ</label>
                  <input
                    type="text"
                    required
                    value={invCompanyCnpj}
                    onChange={(e) => setInvCompanyCnpj(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Valor Bruto (R$)</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={invGrossAmount}
                    onChange={(e) => setInvGrossAmount(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Competência (MM/AAAA)</label>
                  <input
                    type="text"
                    value={invCompetence}
                    onChange={(e) => setInvCompetence(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Discriminação dos Equipamentos Locados / Serviços
                </label>
                <textarea
                  rows={2}
                  value={invDescription}
                  onChange={(e) => setInvDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowNewInvoiceModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-[#ff7a59] text-white font-extrabold"
                >
                  Emitir Documento Fiscal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
