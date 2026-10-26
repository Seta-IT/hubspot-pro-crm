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
  Home,
  Users,
  ShoppingCart,
  Wrench,
  Wallet,
  Headphones,
  BarChart3,
  Settings,
  Eye,
  EyeOff,
  ChevronRight,
  Calendar,
  ExternalLink,
  Search,
  Bell,
  HelpCircle,
  Menu,
  Trash2,
} from 'lucide-react';
import {
  Company,
  Contact,
  Deal,
  ErpBankAccount,
  ErpCatalogItem,
  ErpCommercialProposal,
  ErpDashboardSummary,
  ErpEmployeeRecord,
  ErpFiscalDocumentType,
  ErpFiscalInvoice,
  ErpFiscalNature,
  ErpFinancialEntry,
  ErpProposalItem,
  ErpPurchaseOrder,
  ErpRentalContract,
  ErpSaleOrder,
  ErpServiceOrder,
  ErpSupplierRecord,
  ErpTaxRegime,
  GestaoClickConfig,
} from '../../db/types';
import { formatBRL } from './ui-helpers';
import {
  recordUpsertedContract,
  recordUpsertedInvoice,
  recordUpsertedProposal,
} from '../lib/durable-storage';
import { buildPublicProposalUrl } from '../lib/proposal-share';
import GestaoClickDashboard from './GestaoClickDashboard';

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
  bankAccounts?: ErpBankAccount[];
  dashboardSummary?: ErpDashboardSummary;
  salesOrders?: ErpSaleOrder[];
  serviceOrders?: ErpServiceOrder[];
  suppliers?: ErpSupplierRecord[];
  employees?: ErpEmployeeRecord[];
  purchaseOrders?: ErpPurchaseOrder[];
}

interface ErpGestaoClickTabProps {
  erpData: ErpOverviewPayload | null;
  companies: Company[];
  contacts: Contact[];
  deals: Deal[];
  onRefresh: () => Promise<void>;
  onShowToast: (msg: string) => void;
  initialSection?: GestaoClickMenuSection;
  autoOpenNewProposalTrigger?: number;
  prefillProposalFromDeal?: Deal | null;
}

export type GestaoClickMenuSection =
  | 'INICIO'
  | 'CADASTROS'
  | 'ITENS'
  | 'ORCAMENTOS'
  | 'VENDAS'
  | 'ORDENS_SERVICOS'
  | 'ESTOQUE'
  | 'FINANCEIRO'
  | 'FISCAL'
  | 'CONTRATOS'
  | 'ATENDIMENTOS'
  | 'RELATORIOS'
  | 'CONFIGURACOES';

export default function ErpGestaoClickTab({
  erpData,
  companies,
  contacts,
  deals,
  onRefresh,
  onShowToast,
  initialSection,
  autoOpenNewProposalTrigger,
  prefillProposalFromDeal,
}: ErpGestaoClickTabProps) {
  const [activeSection, setActiveSection] = useState<GestaoClickMenuSection>(
    initialSection || "INICIO"
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [hideBalances, setHideBalances] = useState(false);
  const [cadastrosSubTab, setCadastrosSubTab] = useState<"CLIENTES" | "FORNECEDORES" | "FUNCIONARIOS">("CLIENTES");
  const [syncingGc, setSyncingGc] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [selectedInvoiceForPrint, setSelectedInvoiceForPrint] =
    useState<ErpFiscalInvoice | null>(null);
  const [selectedProposalForPrint, setSelectedProposalForPrint] =
    useState<ErpCommercialProposal | null>(null);
  const [showNewProposalModal, setShowNewProposalModal] = useState(false);
  const [showNewInvoiceModal, setShowNewInvoiceModal] = useState(false);
  const [createdProposalBanner, setCreatedProposalBanner] = useState<{
    proposal: ErpCommercialProposal;
    publicUrl: string;
    printUrl: string;
  } | null>(null);

  const [propTitle, setPropTitle] = useState("");
  const [propCompanyId, setPropCompanyId] = useState(companies[0]?.id || "");
  const [propCustomCompanyName, setPropCustomCompanyName] = useState("");
  const [propCustomCnpj, setPropCustomCnpj] = useState("");
  const [propCustomContactName, setPropCustomContactName] = useState("");
  const [propContactId] = useState(contacts[0]?.id || "");
  const [propDealId, setPropDealId] = useState(deals[0]?.id || "");
  const [propSeller, setPropSeller] = useState("Marcelo Lopes Mira");
  const [propMonths, setPropMonths] = useState("24");
  const [propPaymentCondition, setPropPaymentCondition] = useState(
    "Boleto / PIX Corporativo — Vencimento todo dia 10"
  );
  const [propSku, setPropSku] = useState("GC-EQ-00101");
  const [propQty, setPropQty] = useState("2");
  const [propUnitPrice, setPropUnitPrice] = useState("2850");
  const [propExtraItems, setPropExtraItems] = useState<
    Array<{
      sku: string;
      description: string;
      fiscalNature: ErpFiscalNature;
      quantity: number;
      unitPrice: number;
    }>
  >([]);

  React.useEffect(() => {
    if (initialSection) {
      setActiveSection(initialSection);
    }
  }, [initialSection]);

  React.useEffect(() => {
    if (autoOpenNewProposalTrigger && autoOpenNewProposalTrigger > 0) {
      setActiveSection("ORCAMENTOS");
      if (prefillProposalFromDeal) {
        setPropTitle(`Proposta Comercial — ${prefillProposalFromDeal.title}`);
        if (prefillProposalFromDeal.companyId) {
          setPropCompanyId(prefillProposalFromDeal.companyId);
        }
        setPropDealId(prefillProposalFromDeal.id);
        const m = prefillProposalFromDeal.contractMonths || 24;
        setPropMonths(String(m));
        const mrr =
          prefillProposalFromDeal.mrr ||
          Math.max(850, Math.round(prefillProposalFromDeal.value / m));
        setPropQty("1");
        setPropUnitPrice(String(mrr));
      }
      setShowNewProposalModal(true);
    }
  }, [autoOpenNewProposalTrigger, prefillProposalFromDeal]);

  const [invDocType, setInvDocType] = useState<ErpFiscalDocumentType>("FATURA_LOCACAO");
  const [invCompanyName, setInvCompanyName] = useState(
    companies[0]?.name || "Nu Pagamentos S.A. (Nubank)"
  );
  const [invCompanyCnpj, setInvCompanyCnpj] = useState(
    companies[0]?.cnpj || "18.236.120/0001-58"
  );
  const [invGrossAmount, setInvGrossAmount] = useState("12000");
  const [invCompetence, setInvCompetence] = useState("10/2026");
  const [invDescription, setInvDescription] = useState(
    "Locação Mensal de Equipamentos Telecom & PABX IP (Dispensa de ISS — Súmula Vinculante 31 STF)"
  );

  if (!erpData) {
    return (
      <div className="bg-white rounded-[6px] border border-[#cbd6e2] p-8 text-center text-sm text-[#516f90]">
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
    bankAccounts = [],
    dashboardSummary,
    salesOrders = [],
    serviceOrders = [],
    suppliers = [],
    employees = [],
    purchaseOrders = [],
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
        if (j.data?.proposal) recordUpsertedProposal(j.data.proposal);
        if (j.data?.contract) recordUpsertedContract(j.data.contract);
        if (j.data?.invoice) recordUpsertedInvoice(j.data.invoice);
        const ctrNum = j.data?.contract?.contractNumber || 'LOC';
        const invNum = j.data?.invoice?.documentNumber || 'FAT-LOC';
        onShowToast(
          `Proposta aprovada! Contrato ${ctrNum} e Fatura de Locação ${invNum} gerados automaticamente!`
        );
        await onRefresh();
        setActiveSection('CONTRATOS');
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
        if (j.data) recordUpsertedInvoice(j.data);
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
        if (j.data) recordUpsertedInvoice(j.data);
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
        const j = await res.json();
        if (j.data) recordUpsertedInvoice(j.data);
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
    const mainItem: ErpProposalItem = {
      id: `pi-${Date.now()}-1`,
      sku: catItem?.gestaoClickCode || "GC-EQ-00101",
      description: catItem?.name || "Locação de Equipamento Telecom Seta",
      fiscalNature: catItem?.fiscalNature || "LOCACAO_BENS_MOVEIS",
      ncmOrServiceCode: catItem?.ncmOrLc116 || "NCM 8517.62.14",
      quantity: qty,
      unitPrice,
      discountPercent: 0,
      isRecurring: true,
      totalMonthly: qty * unitPrice,
    };
    const additionalItems: ErpProposalItem[] = propExtraItems.map((ext, i) => ({
      id: `pi-${Date.now()}-${i + 2}`,
      sku: ext.sku || `GC-ITEM-${i + 2}`,
      description: ext.description || "Item Adicional",
      fiscalNature: ext.fiscalNature,
      ncmOrServiceCode:
        ext.fiscalNature === "LOCACAO_BENS_MOVEIS"
          ? "NCM 8517.62.59 (0% ISS — SV 31 STF)"
          : "LC 116/03 Item 01.07",
      quantity: Math.max(1, Number(ext.quantity) || 1),
      unitPrice: Number(ext.unitPrice) || 0,
      discountPercent: 0,
      isRecurring: true,
      totalMonthly: Math.max(1, Number(ext.quantity) || 1) * (Number(ext.unitPrice) || 0),
    }));
    const allItems = [mainItem, ...additionalItems];
    const monthlyTotal = allItems.reduce((acc, it) => acc + it.totalMonthly, 0);

    const finalCompanyName =
      propCustomCompanyName.trim() || comp?.name || "Empresa Cliente B2B";
    const finalCompanyCnpj =
      propCustomCnpj.trim() || comp?.cnpj || "18.236.120/0001-58";
    const finalContactName =
      propCustomContactName.trim() ||
      (cont ? `${cont.firstName} ${cont.lastName}` : "Decisor Comercial");

    const res = await fetch("/api/erp/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: propTitle.trim(),
        companyId: propCustomCompanyName.trim() ? null : comp?.id || null,
        companyName: finalCompanyName,
        companyCnpj: finalCompanyCnpj,
        contactId: cont?.id || null,
        contactName: finalContactName,
        dealId: propDealId || null,
        sellerName: propSeller,
        contractMonths: Number(propMonths) || 24,
        paymentCondition: propPaymentCondition,
        monthlyRecurringTotal: monthlyTotal,
        items: allItems,
      }),
    });

    if (res.ok) {
      const j = await res.json();
      if (j.data) {
        recordUpsertedProposal(j.data);
        const publicUrl = buildPublicProposalUrl(j.data);
        const printUrl = buildPublicProposalUrl(j.data, { autoPrint: true });
        setCreatedProposalBanner({
          proposal: j.data,
          publicUrl,
          printUrl,
        });
      }
      onShowToast("Proposta Comercial criada com Link Público de PDF para o Cliente!");
      setShowNewProposalModal(false);
      setPropTitle("");
      setPropCustomCompanyName("");
      setPropCustomCnpj("");
      setPropCustomContactName("");
      setPropExtraItems([]);
      setActiveSection("ORCAMENTOS");
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

  const menuItems: Array<{ id: GestaoClickMenuSection; label: string; icon: React.ComponentType<{ className?: string }>; count?: number; hot?: boolean }> = [
    { id: 'INICIO', label: 'Início', icon: Home },
    { id: 'CADASTROS', label: 'Cadastros', icon: Users, count: companies.length + suppliers.length + employees.length },
    { id: 'ITENS', label: 'Itens', icon: Package, count: catalog.length },
    { id: 'ORCAMENTOS', label: 'Orçamentos / Propostas', icon: FileText, count: proposals.length, hot: true },
    { id: 'VENDAS', label: 'Vendas', icon: ShoppingCart, count: salesOrders.length },
    { id: 'ORDENS_SERVICOS', label: 'Ordens de serviços', icon: Wrench, count: serviceOrders.length },
    { id: 'ESTOQUE', label: 'Estoque', icon: Boxes, count: catalog.length + purchaseOrders.length },
    { id: 'FINANCEIRO', label: 'Financeiro', icon: Wallet, count: financialEntries.length },
    { id: 'FISCAL', label: 'Fiscal (LC 116 / SV 31)', icon: Receipt, count: invoices.length },
    { id: 'CONTRATOS', label: 'Contratos', icon: FileCheck2, count: rentalContracts.length },
    { id: 'ATENDIMENTOS', label: 'Atendimentos', icon: Headphones, count: serviceOrders.length },
    { id: 'RELATORIOS', label: 'Relatórios', icon: BarChart3 },
    { id: 'CONFIGURACOES', label: 'Configurações', icon: Settings },
  ];

  const renderProposalsList = () => (
    <div className="space-y-4">
      <div className="bg-white rounded-md border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-extrabold text-slate-900">Orçamentos &amp; Propostas Comerciais ({proposals.length})</h2>
          <p className="text-xs text-slate-500">Cada proposta gera um link público permanente para o cliente abrir e imprimir o PDF timbrado A4.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowNewProposalModal(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-md bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold shadow-sm cursor-pointer"
        >
          <Plus className="w-4 h-4" /> + Nova Proposta Comercial
        </button>
      </div>

      {proposals.map((prop) => {
        const isConverted = prop.status === 'CONVERTIDA_CONTRATO';
        const publicUrl = buildPublicProposalUrl(prop);
        const printUrl = buildPublicProposalUrl(prop, { autoPrint: true });
        return (
          <div key={prop.id} className="bg-white rounded-md border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded text-xs font-black bg-[#1e3a6e] text-white">{prop.code}</span>
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold ${isConverted ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                    {isConverted ? 'CONVERTIDA EM CONTRATO & FATURA' : prop.status}
                  </span>
                  <span className="text-xs text-slate-500">
                    Executivo: <strong>{prop.sellerName}</strong> • Prazo: <strong>{prop.contractMonths} meses</strong>
                  </span>
                </div>
                <h3 className="text-base font-extrabold text-slate-900 mt-1.5">{prop.title}</h3>
                <div className="text-xs text-slate-500 mt-0.5">
                  Cliente: <strong>{prop.companyName}</strong> (CNPJ: {prop.companyCnpj}) • Decisor: <strong>{prop.contactName}</strong>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="text-right bg-slate-50 px-3.5 py-2 rounded border border-slate-200">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Mensalidade (MRR)</span>
                  <span className="text-base font-black text-emerald-700">{formatBRL(prop.monthlyRecurringTotal)}/mês</span>
                  <span className="text-[11px] text-slate-500 block">TCV ({prop.contractMonths}m): {formatBRL(prop.totalContractValue)}</span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(publicUrl);
                    onShowToast(`Link da proposta ${prop.code} copiado para enviar ao cliente!`);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-800 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5 text-[#1e3a6e]" /> Copiar Link p/ Cliente
                </button>

                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded bg-[#1e3a6e] hover:bg-[#162b54] text-white text-xs font-bold"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Abrir Link / PDF
                </a>

                <a
                  href={printUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold"
                >
                  <Printer className="w-3.5 h-3.5" /> Imprimir PDF
                </a>

                {!isConverted && (
                  <button
                    type="button"
                    disabled={busyId === prop.id}
                    onClick={() => handleApproveProposal(prop.id)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold cursor-pointer disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {busyId === prop.id ? 'Convertendo...' : 'Aprovar & Gerar Contrato'}
                  </button>
                )}
              </div>
            </div>

            <div className="p-2.5 rounded bg-emerald-50/70 border border-emerald-200 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className="text-emerald-900 truncate max-w-2xl">
                <strong>Link Público do Cliente (PDF A4):</strong>{' '}
                <a href={publicUrl} target="_blank" rel="noreferrer" className="underline font-mono text-[#1e3a6e]">
                  {publicUrl.slice(0, 90)}...
                </a>
              </span>
              <span className="text-emerald-800 font-bold">Pronto para enviar por WhatsApp / E-mail</span>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b border-slate-200">
                  <tr>
                    <th className="py-2 px-3">SKU</th>
                    <th className="py-2 px-3">Item / Equipamento / Serviço</th>
                    <th className="py-2 px-3">Natureza Fiscal</th>
                    <th className="py-2 px-3 text-right">Qtd</th>
                    <th className="py-2 px-3 text-right">Unitário</th>
                    <th className="py-2 px-3 text-right">Total Mensal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {prop.items.map((item) => (
                    <tr key={item.id}>
                      <td className="py-2 px-3 font-mono font-bold">{item.sku}</td>
                      <td className="py-2 px-3 font-semibold">{item.description}</td>
                      <td className="py-2 px-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                          {item.fiscalNature === 'LOCACAO_BENS_MOVEIS' ? 'Locação Pura (0% ISS - SV 31 STF)' : 'Serviço Técnico (LC 116 01.07)'}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right">{item.quantity}</td>
                      <td className="py-2 px-3 text-right">{formatBRL(item.unitPrice)}</td>
                      <td className="py-2 px-3 text-right font-bold">{formatBRL(item.totalMonthly)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderContractsList = () => (
    <div className="space-y-4">
      <div className="bg-white rounded-md border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-extrabold text-slate-900">Contratos de Locação de Equipamentos &amp; S/N ({rentalContracts.length})</h2>
          <p className="text-xs text-slate-500">Emissão de Fatura de Locação (0% ISS — Súmula Vinculante 31 STF) e NF-e de Remessa CFOP 5.908.</p>
        </div>
        <button type="button" onClick={() => setShowNewProposalModal(true)} className="px-3.5 py-2 rounded bg-[#ff7a59] text-white text-xs font-extrabold cursor-pointer">
          + Nova Proposta de Locação
        </button>
      </div>
      {rentalContracts.map((ctr) => (
        <div key={ctr.id} className="bg-white rounded-md border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 rounded text-xs font-black bg-indigo-950 text-white">{ctr.contractNumber}</span>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-emerald-100 text-emerald-800">{ctr.status}</span>
                <span className="px-2 py-0.5 rounded bg-slate-100 text-xs font-bold">NF-e Remessa CFOP {ctr.remessaCfop} Nº {ctr.remessaNfeNumber}</span>
              </div>
              <h3 className="text-base font-extrabold text-slate-900 mt-1.5">{ctr.title}</h3>
              <div className="text-xs text-slate-500">
                Locatária: <strong>{ctr.companyName}</strong> • Vigência: {ctr.startDate} até {ctr.endDate} ({ctr.contractMonths}m)
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-right bg-emerald-50 px-3.5 py-2 rounded border border-emerald-200">
                <span className="text-[10px] uppercase font-bold text-emerald-700 block">Aluguel Mensal (0% ISS)</span>
                <span className="text-base font-black text-emerald-800">{formatBRL(ctr.monthlyValue)}/mês</span>
              </div>
              <button type="button" onClick={() => handleGenerateRemessaNfe(ctr.id)} className="px-3 py-2 rounded border border-slate-300 text-xs font-bold hover:bg-slate-50 cursor-pointer">
                Emitir NF-e Remessa ({ctr.remessaCfop})
              </button>
              <button type="button" onClick={() => handleGenerateContractInvoice(ctr.id)} className="px-3.5 py-2 rounded bg-[#ff7a59] text-white text-xs font-extrabold cursor-pointer">
                Emitir Fatura Locação do Mês
              </button>
            </div>
          </div>
          <div className="overflow-x-auto border border-slate-200 rounded">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b border-slate-200">
                <tr>
                  <th className="py-2 px-3">SKU</th>
                  <th className="py-2 px-3">Equipamento Locado</th>
                  <th className="py-2 px-3">S/N</th>
                  <th className="py-2 px-3 text-right">Qtd</th>
                  <th className="py-2 px-3 text-right">Patrimônio</th>
                  <th className="py-2 px-3 text-right">Locação Mensal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ctr.equipments.map((eq) => (
                  <tr key={eq.id}>
                    <td className="py-2 px-3 font-mono font-bold">{eq.skuGestaoClick}</td>
                    <td className="py-2 px-3 font-semibold">{eq.description}</td>
                    <td className="py-2 px-3 font-mono">{eq.serialNumber}</td>
                    <td className="py-2 px-3 text-right">{eq.quantity}</td>
                    <td className="py-2 px-3 text-right">{formatBRL(eq.assetValueBrl)}</td>
                    <td className="py-2 px-3 text-right font-bold text-emerald-700">{formatBRL(eq.quantity * eq.unitMonthlyRent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );

  const renderInvoicesList = () => (
    <div className="space-y-4">
      <div className="bg-white rounded-md border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-extrabold text-slate-900">Fiscal — Faturas de Locação (LC 116 / SV 31 STF), NFS-e &amp; NF-e ({invoices.length})</h2>
          <p className="text-xs text-slate-500">Segregação fiscal automática: 0% ISS em Locação Pura e retenções federais em NFS-e.</p>
        </div>
        <button type="button" onClick={() => setShowNewInvoiceModal(true)} className="px-4 py-2 rounded bg-[#ff7a59] text-white text-xs font-extrabold cursor-pointer">
          + Emitir Fatura / Nota Fiscal
        </button>
      </div>
      {invoices.map((inv) => {
        const tb = inv.taxBreakdown;
        const isPaid = inv.status === 'PAGA';
        return (
          <div key={inv.id} className="bg-white rounded-md border border-slate-200 p-5 shadow-xs space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded text-xs font-black bg-slate-900 text-white">{inv.documentNumber}</span>
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-emerald-100 text-emerald-800">{inv.documentType}</span>
                  <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${isPaid ? 'bg-emerald-600 text-white' : 'bg-amber-100 text-amber-800'}`}>{inv.status}</span>
                </div>
                <h3 className="text-base font-extrabold text-slate-900 mt-1">{inv.companyName} — CNPJ {inv.companyCnpj}</h3>
                <div className="text-xs text-slate-500">Competência: {inv.competenceMonth} • Vencimento: {inv.dueDate}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-right bg-slate-50 px-3 py-1.5 rounded border border-slate-200">
                  <span className="text-[10px] text-slate-500 block">Bruto: {formatBRL(inv.grossAmount)} | ISS: {tb.issRatePercent}%</span>
                  <strong className="text-sm text-slate-900">Líquido: {formatBRL(inv.netAmount)}</strong>
                </div>
                <button type="button" onClick={() => setSelectedInvoiceForPrint(inv)} className="px-3.5 py-2 rounded bg-slate-900 text-white text-xs font-bold cursor-pointer">
                  <Printer className="w-3.5 h-3.5 inline mr-1" /> Imprimir Espelho
                </button>
                {!isPaid && (
                  <button type="button" onClick={() => handleMarkInvoicePaid(inv.id)} className="px-3 py-2 rounded bg-emerald-600 text-white text-xs font-bold cursor-pointer">
                    Confirmar Recebimento
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="rounded-lg overflow-hidden border border-slate-300 shadow-md bg-[#f3f5f8]">
      {/* TOP BAR AZUL MARINHO GESTÃOCLICK (#1e3a6e) */}
      <div className="bg-[#1e3a6e] text-white px-4 h-12 flex items-center justify-between select-none">
        <div className="flex items-center gap-3">
          <span className="text-base font-extrabold tracking-tight">Seta Telecom</span>
          <button
            type="button"
            onClick={() => setSidebarCollapsed((v) => !v)}
            className="p-1.5 rounded hover:bg-white/10 cursor-pointer"
            title="Recolher/Expandir menu lateral"
          >
            <Menu className="w-4 h-4" />
          </button>
          <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
            ● API ERP-GROK • Loja {gestaoClickConfig.storeName || 'Matriz'} #{gestaoClickConfig.storeId || '118887'} • MCP {gestaoClickConfig.mcpStatus || 'ONLINE'}
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              setActiveSection('ORCAMENTOS');
              setShowNewProposalModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold shadow-xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> + Nova Proposta
          </button>
          <button type="button" onClick={() => setActiveSection('VENDAS')} className="p-1.5 rounded hover:bg-white/10 cursor-pointer" title="PDV / Vendas">
            <ShoppingCart className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => setActiveSection('CADASTROS')} className="p-1.5 rounded hover:bg-white/10 cursor-pointer" title="Buscar">
            <Search className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => setActiveSection('CONFIGURACOES')} className="p-1.5 rounded hover:bg-white/10 cursor-pointer" title="Ajuda & API">
            <HelpCircle className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => setActiveSection('FINANCEIRO')} className="relative p-1.5 rounded hover:bg-white/10 cursor-pointer" title="Notificações">
            <Bell className="w-4 h-4" />
            <span className="w-2 h-2 rounded-full bg-amber-400 absolute top-1 right-1" />
          </button>
          <div className="w-7 h-7 rounded-full bg-amber-400 text-slate-900 font-black text-xs flex items-center justify-center" title="Marcelo Lopes Mira">
            MM
          </div>
        </div>
      </div>

      {/* BODY: SIDEBAR ESQUERDA FIXA + ÁREA PRINCIPAL */}
      <div className="flex min-h-[780px]">
        {!sidebarCollapsed && (
          <aside className="w-60 bg-white border-r border-slate-200 shrink-0 flex flex-col justify-between">
            <div>
              {/* LOGO SETA IT */}
              <div className="p-4 border-b border-slate-100 flex items-center justify-center">
                <div className="border border-slate-200 rounded-md px-4 py-2.5 flex items-center gap-1.5 shadow-2xs">
                  <span className="text-lg font-black tracking-tight text-[#1e3a6e]">SETA</span>
                  <div className="flex items-center gap-0.5">
                    <span className="w-1 h-4 bg-emerald-500 rounded-xs inline-block" />
                    <span className="w-1 h-4 bg-amber-500 rounded-xs inline-block" />
                    <span className="w-1 h-4 bg-sky-500 rounded-xs inline-block" />
                    <span className="w-1 h-4 bg-rose-500 rounded-xs inline-block" />
                  </div>
                  <span className="text-lg font-black tracking-tight text-slate-800">IT</span>
                </div>
              </div>

              {/* BOTÃO DESTAQUE CRIAR PROPOSTA NO TOPO DA SIDEBAR */}
              <div className="p-2.5 border-b border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setActiveSection('ORCAMENTOS');
                    setShowNewProposalModal(true);
                  }}
                  className="w-full py-2 px-3 rounded-md bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> + Nova Proposta (PDF)
                </button>
              </div>

              {/* 13 ITENS DE MENU DO GESTÃOCLICK */}
              <nav className="py-1 divide-y divide-slate-100">
                {menuItems.map((m) => {
                  const Icon = m.icon;
                  const active = activeSection === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setActiveSection(m.id)}
                      className={`w-full px-3.5 py-2.5 flex items-center justify-between text-xs transition cursor-pointer ${
                        active
                          ? 'bg-blue-50 text-[#1e3a6e] font-extrabold border-l-4 border-[#1e3a6e]'
                          : 'text-slate-700 hover:bg-slate-50 font-medium'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 truncate">
                        <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-[#1e3a6e]' : 'text-slate-500'}`} />
                        <span className="truncate">{m.label}</span>
                      </span>
                      <span className="flex items-center gap-1 shrink-0">
                        {m.count !== undefined && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] bg-slate-100 text-slate-600 font-bold">
                            {m.count}
                          </span>
                        )}
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                      </span>
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="p-3 border-t border-slate-200 bg-slate-50 text-[10px] text-slate-500 space-y-1">
              <div className="font-bold text-slate-700">Seta Telecom LTDA</div>
              <div>CNPJ {gestaoClickConfig.companyCnpj}</div>
              <div>Regime: {gestaoClickConfig.taxRegime}</div>
            </div>
          </aside>
        )}

        {/* CONTEÚDO PRINCIPAL */}
        <div className="flex-1 p-4 sm:p-6 space-y-5 overflow-x-hidden">
          {/* BANNER DE PROPOSTA RECÉM-CRIADA COM LINK PÚBLICO */}
          {createdProposalBanner && (
            <div className="bg-emerald-950 text-white rounded-md p-4 border border-emerald-500 shadow-lg flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-emerald-400 text-slate-950 text-[10px] font-black uppercase">
                    LINK DO CLIENTE PRONTO
                  </span>
                  <span className="font-mono text-xs font-extrabold text-emerald-300">
                    {createdProposalBanner.proposal.code} — {createdProposalBanner.proposal.companyName}
                  </span>
                </div>
                <div className="text-xs text-slate-200">
                  Link de Acesso Público p/ Imprimir PDF:{' '}
                  <a href={createdProposalBanner.publicUrl} target="_blank" rel="noreferrer" className="underline font-mono text-emerald-300">
                    {createdProposalBanner.publicUrl.slice(0, 95)}...
                  </a>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(createdProposalBanner.publicUrl);
                    onShowToast('Link público copiado para a área de transferência!');
                  }}
                  className="px-3 py-2 rounded bg-white text-slate-900 text-xs font-extrabold cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5 inline mr-1" /> Copiar Link p/ Cliente
                </button>
                <a href={createdProposalBanner.publicUrl} target="_blank" rel="noreferrer" className="px-3 py-2 rounded bg-emerald-600 text-white text-xs font-extrabold">
                  <ExternalLink className="w-3.5 h-3.5 inline mr-1" /> Abrir Proposta
                </a>
                <a href={createdProposalBanner.printUrl} target="_blank" rel="noreferrer" className="px-3 py-2 rounded bg-[#ff7a59] text-white text-xs font-extrabold">
                  <Printer className="w-3.5 h-3.5 inline mr-1" /> Imprimir PDF
                </a>
                <button type="button" onClick={() => setCreatedProposalBanner(null)} className="text-slate-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {activeSection === 'INICIO' && (
            <GestaoClickDashboard
              summary={dashboardSummary}
              bankAccounts={bankAccounts}
              hideBalances={hideBalances}
              onToggleHide={() => setHideBalances((v) => !v)}
              onOpenSection={(sec) => setActiveSection(sec as GestaoClickMenuSection)}
              onNewProposal={() => {
                setActiveSection('ORCAMENTOS');
                setShowNewProposalModal(true);
              }}
              onSync={handleSyncGestaoClick}
              syncing={syncingGc}
              config={gestaoClickConfig}
              serviceOrdersUpcoming={serviceOrders}
            />
          )}

          {activeSection === 'ORCAMENTOS' && renderProposalsList()}
          {activeSection === 'CONTRATOS' && renderContractsList()}
          {activeSection === 'FISCAL' && renderInvoicesList()}

          {activeSection === 'CADASTROS' && (
            <div className="bg-white rounded-md border border-slate-200 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-extrabold text-slate-900">Cadastros GestãoClick Seta Telecom</h2>
                <div className="flex gap-1.5">
                  {(['CLIENTES', 'FORNECEDORES', 'FUNCIONARIOS'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setCadastrosSubTab(t)}
                      className={`px-3 py-1.5 rounded text-xs font-bold cursor-pointer ${cadastrosSubTab === t ? 'bg-[#1e3a6e] text-white' : 'bg-slate-100 text-slate-700'}`}
                    >
                      {t === 'CLIENTES' ? `Clientes (${companies.length})` : t === 'FORNECEDORES' ? `Fornecedores (${suppliers.length})` : `Funcionários (${employees.length})`}
                    </button>
                  ))}
                </div>
              </div>
              {cadastrosSubTab === 'CLIENTES' && (
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b">
                    <tr><th className="py-2 px-3">Cliente / Razão Social</th><th className="py-2 px-3">CNPJ</th><th className="py-2 px-3">Cidade/UF</th><th className="py-2 px-3">Responsável</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {companies.map((c) => (
                      <tr key={c.id}><td className="py-2 px-3 font-bold">{c.name}</td><td className="py-2 px-3 font-mono">{c.cnpj || '—'}</td><td className="py-2 px-3">{c.city}/{c.state}</td><td className="py-2 px-3">{c.ownerName || 'Marcelo Mira'}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              {cadastrosSubTab === 'FORNECEDORES' && (
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b">
                    <tr><th className="py-2 px-3">Fornecedor</th><th className="py-2 px-3">CNPJ</th><th className="py-2 px-3">Telefone</th><th className="py-2 px-3">E-mail</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {suppliers.map((sup) => (
                      <tr key={sup.id}><td className="py-2 px-3 font-bold">{sup.name}</td><td className="py-2 px-3 font-mono">{sup.cnpj}</td><td className="py-2 px-3">{sup.phone}</td><td className="py-2 px-3">{sup.email}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              {cadastrosSubTab === 'FUNCIONARIOS' && (
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b">
                    <tr><th className="py-2 px-3">Nome</th><th className="py-2 px-3">Cargo / Função</th><th className="py-2 px-3">E-mail</th><th className="py-2 px-3">Telefone</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {employees.map((emp) => (
                      <tr key={emp.id}><td className="py-2 px-3 font-bold">{emp.name}</td><td className="py-2 px-3">{emp.role}</td><td className="py-2 px-3">{emp.email}</td><td className="py-2 px-3">{emp.phone}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {(activeSection === 'ITENS' || activeSection === 'ESTOQUE') && (
            <div className="bg-white rounded-md border border-slate-200 p-5 space-y-4">
              <h2 className="text-base font-extrabold text-slate-900">Catálogo de Produtos, Serviços &amp; Estoque Locado ({catalog.length} itens)</h2>
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b">
                  <tr><th className="py-2 px-3">SKU</th><th className="py-2 px-3">Descrição</th><th className="py-2 px-3">Classificação Fiscal</th><th className="py-2 px-3 text-right">Disp.</th><th className="py-2 px-3 text-right">Locados</th><th className="py-2 px-3 text-right">Locação/mês</th></tr>
                </thead>
                <tbody className="divide-y">
                  {catalog.map((it) => (
                    <tr key={it.id}>
                      <td className="py-2 px-3 font-mono font-bold text-[#1e3a6e]">{it.gestaoClickCode}</td>
                      <td className="py-2 px-3 font-semibold">{it.name}</td>
                      <td className="py-2 px-3">{it.ncmOrLc116}</td>
                      <td className="py-2 px-3 text-right font-bold">{it.stockAvailable}</td>
                      <td className="py-2 px-3 text-right font-bold text-indigo-700">{it.stockRentedInClients}</td>
                      <td className="py-2 px-3 text-right font-extrabold text-emerald-700">{formatBRL(it.monthlyRentalPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeSection === 'VENDAS' && (
            <div className="bg-white rounded-md border border-slate-200 p-5 space-y-4">
              <h2 className="text-base font-extrabold text-slate-900">Pedidos de Venda Sincronizados do GestãoClick ({salesOrders.length})</h2>
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b">
                  <tr><th className="py-2 px-3">Código</th><th className="py-2 px-3">Cliente</th><th className="py-2 px-3">Vendedor</th><th className="py-2 px-3">Data</th><th className="py-2 px-3">Situação</th><th className="py-2 px-3 text-right">Valor Total</th></tr>
                </thead>
                <tbody className="divide-y">
                  {salesOrders.map((v) => (
                    <tr key={v.id}>
                      <td className="py-2 px-3 font-mono font-bold">#{v.code}</td>
                      <td className="py-2 px-3 font-semibold">{v.companyName}</td>
                      <td className="py-2 px-3">{v.sellerName}</td>
                      <td className="py-2 px-3">{v.date}</td>
                      <td className="py-2 px-3"><span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">{v.status}</span></td>
                      <td className="py-2 px-3 text-right font-extrabold">{formatBRL(v.totalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(activeSection === 'ORDENS_SERVICOS' || activeSection === 'ATENDIMENTOS') && (
            <div className="bg-white rounded-md border border-slate-200 p-5 space-y-4">
              <h2 className="text-base font-extrabold text-slate-900">Ordens de Serviços Técnicas &amp; Atendimentos ({serviceOrders.length})</h2>
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b">
                  <tr><th className="py-2 px-3">OS Nº</th><th className="py-2 px-3">Cliente</th><th className="py-2 px-3">Técnico</th><th className="py-2 px-3">Entrada</th><th className="py-2 px-3">Situação</th><th className="py-2 px-3 text-right">Valor</th></tr>
                </thead>
                <tbody className="divide-y">
                  {serviceOrders.map((os) => (
                    <tr key={os.id}>
                      <td className="py-2 px-3 font-mono font-bold">#{os.code}</td>
                      <td className="py-2 px-3 font-semibold">{os.companyName}</td>
                      <td className="py-2 px-3">{os.technicianName}</td>
                      <td className="py-2 px-3">{os.entryDate}</td>
                      <td className="py-2 px-3"><span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">{os.status}</span></td>
                      <td className="py-2 px-3 text-right font-extrabold">{formatBRL(os.totalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeSection === 'FINANCEIRO' && (
            <div className="space-y-4">
              <div className="bg-white rounded-md border border-slate-200 p-5 space-y-3">
                <h2 className="text-base font-extrabold text-slate-900">Contas Bancárias Seta Telecom</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {bankAccounts.map((b) => (
                    <div key={b.id} className="p-3.5 rounded border border-slate-200 bg-slate-50 flex items-center justify-between">
                      <div>
                        <div className="text-xs font-extrabold text-slate-800">{b.name}</div>
                        <div className="text-[10px] text-slate-500">{b.lastMovedAt}</div>
                      </div>
                      <div className={`text-sm font-black ${b.balance < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{formatBRL(b.balance)}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-white rounded-md border border-slate-200 p-5 space-y-3">
                <h3 className="text-sm font-extrabold text-slate-900">Contas a Receber &amp; Contas a Pagar ({financialEntries.length})</h3>
                <div className="space-y-2">
                  {financialEntries.map((fin) => (
                    <div key={fin.id} className="p-3 rounded border border-slate-200 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-bold text-slate-800">{fin.description}</div>
                        <div className="text-[11px] text-slate-500">{fin.companyName} • {fin.costCenter} • Venc: {fin.dueDate}</div>
                      </div>
                      <div className="text-right">
                        <div className={`font-extrabold ${fin.type === 'RECEBER' ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {fin.type === 'RECEBER' ? '+' : '-'}{formatBRL(fin.amount)}
                        </div>
                        <span className="text-[10px] font-bold">{fin.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {(activeSection === 'RELATORIOS' || activeSection === 'CONFIGURACOES') && (
            <div className="bg-white rounded-md border border-slate-200 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-extrabold text-slate-900">Configurações API &amp; MCP GestãoClick ({gestaoClickConfig.credentialName || 'ERP-GROK'})</h2>
                  <p className="text-xs text-slate-500">Loja {gestaoClickConfig.storeName} #{gestaoClickConfig.storeId} • CNPJ {gestaoClickConfig.companyCnpj}</p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={gestaoClickConfig.taxRegime}
                    onChange={(e) => handleChangeTaxRegime(e.target.value as ErpTaxRegime)}
                    className="px-3 py-2 rounded border border-slate-300 text-xs font-bold bg-white"
                  >
                    <option value="LUCRO_PRESUMIDO">Lucro Presumido (PIS 0,65% / COFINS 3%)</option>
                    <option value="LUCRO_REAL">Lucro Real (PIS 1,65% / COFINS 7,6%)</option>
                    <option value="SIMPLES_NACIONAL">Simples Nacional</option>
                  </select>
                  <button type="button" onClick={handleSyncGestaoClick} disabled={syncingGc} className="px-4 py-2 rounded bg-emerald-600 text-white text-xs font-extrabold cursor-pointer">
                    {syncingGc ? 'Sincronizando...' : 'Sincronizar Agora'}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded bg-slate-50 border">MRR Locação: <strong>{formatBRL(kpis.monthlyRentalMrr)}</strong></div>
                <div className="p-3 rounded bg-slate-50 border">TCV Carteira: <strong>{formatBRL(kpis.totalContractedTcv)}</strong></div>
                <div className="p-3 rounded bg-slate-50 border">Economia ISS SV 31: <strong className="text-emerald-700">{formatBRL(kpis.issSavedBySv31Stf)}</strong></div>
                <div className="p-3 rounded bg-slate-50 border">Propostas: <strong>{proposals.length}</strong></div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MODAL: IMPRESSÃO / VISUALIZAÇÃO DE FATURA / RECIBO DE LOCAÇÃO OFICIAL */}
      {selectedInvoiceForPrint && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-[6px] border border-[#cbd6e2] shadow-2xl max-w-3xl w-full overflow-hidden my-8">
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
                  <div className="text-base font-black text-[#33475b]">
                    {gestaoClickConfig.companyLegalName}
                  </div>
                  <div>CNPJ: {gestaoClickConfig.companyCnpj}</div>
                  <div>
                    Inscrição Municipal: {gestaoClickConfig.municipalRegistration} • IE:{' '}
                    {gestaoClickConfig.stateRegistration}
                  </div>
                  <div className="text-[#516f90]">
                    Regime Tributário: {selectedInvoiceForPrint.taxBreakdown.taxRegime}
                  </div>
                </div>
                <div className="text-right bg-slate-100 p-3 rounded-[4px] border border-[#cbd6e2]">
                  <div className="text-[10px] font-bold uppercase text-[#516f90]">
                    {selectedInvoiceForPrint.documentType === 'FATURA_LOCACAO'
                      ? 'FATURA / RECIBO DE LOCAÇÃO DE BENS MÓVEIS'
                      : selectedInvoiceForPrint.documentType === 'NFSE_SERVICO'
                        ? 'NOTA FISCAL DE SERVIÇOS ELETRÔNICA (NFS-e)'
                        : 'DANFE — NF-e DE REMESSA EM LOCAÇÃO (MOD. 55)'}
                  </div>
                  <div className="text-lg font-black text-[#33475b]">
                    Nº {selectedInvoiceForPrint.documentNumber}
                  </div>
                  <div>
                    Emissão: <strong>{selectedInvoiceForPrint.issueDate}</strong> • Vencimento:{' '}
                    <strong>{selectedInvoiceForPrint.dueDate}</strong>
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-[4px] bg-[#f5f8fa] border border-[#cbd6e2] grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                    Locatário / Tomador
                  </span>
                  <strong className="text-sm text-[#33475b]">
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

              <div className="border border-[#cbd6e2] rounded-[4px] overflow-hidden">
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

              <div className="p-4 rounded-[4px] bg-emerald-50/90 border border-emerald-300 space-y-2">
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

              <div className="p-4 rounded-[4px] bg-slate-100 border border-[#cbd6e2] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-[#33475b] uppercase text-[11px]">
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
                <div className="font-mono text-xs bg-white p-2.5 rounded border border-[#cbd6e2]">
                  <strong>Linha Digitável Boleto:</strong>{' '}
                  {selectedInvoiceForPrint.boletoDigitableLine}
                </div>
                <div className="font-mono text-[11px] bg-white p-2.5 rounded border border-[#cbd6e2] break-all">
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
          <div className="bg-white rounded-[6px] border border-[#cbd6e2] shadow-2xl max-w-3xl w-full overflow-hidden my-8">
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
                  <h3 className="text-base font-black text-[#33475b]">SETA TELECOM LTDA</h3>
                  <p>CNPJ {gestaoClickConfig.companyCnpj} • HubSpot Portal 4369067</p>
                  <p>Responsável Comercial: {selectedProposalForPrint.sellerName}</p>
                </div>
                <div className="text-right">
                  <div className="text-sm font-black">{selectedProposalForPrint.code}</div>
                  <div>Cliente: {selectedProposalForPrint.companyName}</div>
                  <div>CNPJ: {selectedProposalForPrint.companyCnpj}</div>
                </div>
              </div>
              <h4 className="text-sm font-extrabold text-[#33475b]">
                {selectedProposalForPrint.title}
              </h4>
              <p className="text-[#516f90]">{selectedProposalForPrint.commercialNotes}</p>
              <p className="text-[#516f90]">
                <strong>Cláusulas Técnicas &amp; SLA:</strong>{' '}
                {selectedProposalForPrint.technicalClauses}
              </p>
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-[4px] flex justify-between items-center">
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

      {/* MODAL: NOVA PROPOSTA COMERCIAL (COM LINK PÚBLICO DE PDF) */}
      {showNewProposalModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-[6px] border border-[#cbd6e2] shadow-2xl max-w-2xl w-full overflow-hidden my-8">
            <div className="px-6 py-4 bg-[#1e3a6e] text-white flex items-center justify-between">
              <div>
                <span className="text-[10px] font-extrabold uppercase text-emerald-300 block">
                  Seta Telecom • Orçamentos &amp; Propostas Comerciais
                </span>
                <h3 className="text-sm font-extrabold">
                  Criar Nova Proposta Comercial (Gera Link Público de Impressão PDF A4)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowNewProposalModal(false)}
                className="text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateProposalSubmit} className="p-6 space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-[#33475b] mb-1">
                  Título / Escopo da Proposta Comercial *
                </label>
                <input
                  type="text"
                  required
                  value={propTitle}
                  onChange={(e) => setPropTitle(e.target.value)}
                  placeholder="Ex: Locação PABX IP Seta Cloud + Kit 20 Terminais Yealink"
                  className="w-full px-3 py-2 rounded-[4px] border border-[#cbd6e2]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-[#33475b] mb-1">
                    Selecionar Cliente Cadastrado (GestãoClick / CRM)
                  </label>
                  <select
                    value={propCompanyId}
                    onChange={(e) => setPropCompanyId(e.target.value)}
                    className="w-full px-3 py-2 rounded-[4px] border border-[#cbd6e2] bg-white"
                  >
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.cnpj ? `(${c.cnpj})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-[#33475b] mb-1">
                    Ou Digitar Nome / Razão Social Livremente
                  </label>
                  <input
                    type="text"
                    value={propCustomCompanyName}
                    onChange={(e) => setPropCustomCompanyName(e.target.value)}
                    placeholder="Opcional: digite se for cliente novo..."
                    className="w-full px-3 py-2 rounded-[4px] border border-[#cbd6e2]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-[#33475b] mb-1">CNPJ / CPF do Cliente</label>
                  <input
                    type="text"
                    value={propCustomCnpj}
                    onChange={(e) => setPropCustomCnpj(e.target.value)}
                    placeholder="Ex: 18.236.120/0001-58"
                    className="w-full px-3 py-2 rounded-[4px] border border-[#cbd6e2]"
                  />
                </div>
                <div>
                  <label className="block font-bold text-[#33475b] mb-1">Contato / Decisor</label>
                  <input
                    type="text"
                    value={propCustomContactName}
                    onChange={(e) => setPropCustomContactName(e.target.value)}
                    placeholder="Ex: Diretor de TI / Compras"
                    className="w-full px-3 py-2 rounded-[4px] border border-[#cbd6e2]"
                  />
                </div>
                <div>
                  <label className="block font-bold text-[#33475b] mb-1">Executivo Seta Telecom</label>
                  <select
                    value={propSeller}
                    onChange={(e) => setPropSeller(e.target.value)}
                    className="w-full px-3 py-2 rounded-[4px] border border-[#cbd6e2] bg-white"
                  >
                    <option value="Marcelo Lopes Mira">Marcelo Lopes Mira</option>
                    <option value="Evelyn Ternero Seta Telecom">Evelyn Ternero Seta Telecom</option>
                    <option value="Michelle da Rocha">Michelle da Rocha</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-[#33475b] mb-1">
                    Equipamento / Serviço Principal (Catálogo GestãoClick)
                  </label>
                  <select
                    value={propSku}
                    onChange={(e) => {
                      setPropSku(e.target.value);
                      const found = catalog.find((c) => c.gestaoClickCode === e.target.value);
                      if (found) setPropUnitPrice(String(found.monthlyRentalPrice));
                    }}
                    className="w-full px-3 py-2 rounded-[4px] border border-[#cbd6e2] bg-white"
                  >
                    {catalog.map((c) => (
                      <option key={c.id} value={c.gestaoClickCode}>
                        {c.gestaoClickCode} — {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block font-bold text-[#33475b] mb-1">Qtd</label>
                    <input
                      type="number"
                      min={1}
                      value={propQty}
                      onChange={(e) => setPropQty(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-[4px] border border-[#cbd6e2]"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-[#33475b] mb-1">Unitário (R$)</label>
                    <input
                      type="number"
                      min={0}
                      value={propUnitPrice}
                      onChange={(e) => setPropUnitPrice(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-[4px] border border-[#cbd6e2]"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-[#33475b] mb-1">Prazo</label>
                    <select
                      value={propMonths}
                      onChange={(e) => setPropMonths(e.target.value)}
                      className="w-full px-2 py-2 rounded-[4px] border border-[#cbd6e2] bg-white"
                    >
                      <option value="12">12m</option>
                      <option value="24">24m</option>
                      <option value="36">36m</option>
                      <option value="48">48m</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Extra Items */}
              <div className="space-y-2 pt-2 border-t border-slate-200">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#33475b]">Itens Adicionais da Proposta ({propExtraItems.length})</span>
                  <button
                    type="button"
                    onClick={() =>
                      setPropExtraItems((prev) => [
                        ...prev,
                        {
                          sku: `GC-ADD-${prev.length + 2}`,
                          description: 'Licença / Ramal Adicional ou Suporte NOC',
                          fiscalNature: 'LOCACAO_BENS_MOVEIS',
                          quantity: 1,
                          unitPrice: 850,
                        },
                      ])
                    }
                    className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-xs font-bold text-[#1e3a6e] cursor-pointer"
                  >
                    + Adicionar Outro Item
                  </button>
                </div>
                {propExtraItems.map((ext, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center bg-slate-50 p-2 rounded border">
                    <input
                      type="text"
                      value={ext.description}
                      onChange={(e) => {
                        const copy = [...propExtraItems];
                        copy[i].description = e.target.value;
                        setPropExtraItems(copy);
                      }}
                      placeholder="Descrição do item"
                      className="col-span-6 px-2 py-1 rounded border bg-white"
                    />
                    <input
                      type="number"
                      min={1}
                      value={ext.quantity}
                      onChange={(e) => {
                        const copy = [...propExtraItems];
                        copy[i].quantity = Number(e.target.value) || 1;
                        setPropExtraItems(copy);
                      }}
                      className="col-span-2 px-2 py-1 rounded border bg-white"
                    />
                    <input
                      type="number"
                      min={0}
                      value={ext.unitPrice}
                      onChange={(e) => {
                        const copy = [...propExtraItems];
                        copy[i].unitPrice = Number(e.target.value) || 0;
                        setPropExtraItems(copy);
                      }}
                      className="col-span-3 px-2 py-1 rounded border bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => setPropExtraItems((prev) => prev.filter((_, idx) => idx !== i))}
                      className="col-span-1 text-rose-600 hover:text-rose-800 flex justify-center cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div>
                <label className="block font-bold text-[#33475b] mb-1">Condição de Pagamento &amp; Validade</label>
                <input
                  type="text"
                  value={propPaymentCondition}
                  onChange={(e) => setPropPaymentCondition(e.target.value)}
                  className="w-full px-3 py-2 rounded-[4px] border border-[#cbd6e2]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowNewProposalModal(false)}
                  className="px-4 py-2 rounded-[4px] border border-[#cbd6e2] font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-[4px] bg-[#ff7a59] hover:bg-[#e86646] text-white font-extrabold cursor-pointer"
                >
                  Criar Proposta &amp; Gerar Link PDF p/ Cliente
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EMITIR FATURA DE LOCAÇÃO / NFS-E / NF-E REMESSA */}
      {showNewInvoiceModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-[6px] border border-[#cbd6e2] shadow-2xl max-w-lg w-full overflow-hidden">
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
                <label className="block font-bold text-[#33475b] mb-1">
                  Espécie de Documento Fiscal Brasileiro
                </label>
                <select
                  value={invDocType}
                  onChange={(e) => setInvDocType(e.target.value as ErpFiscalDocumentType)}
                  className="w-full px-3 py-2 rounded-[4px] border border-[#cbd6e2] bg-white font-semibold"
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
                  <label className="block font-bold text-[#33475b] mb-1">Razão Social Tomador</label>
                  <input
                    type="text"
                    required
                    value={invCompanyName}
                    onChange={(e) => setInvCompanyName(e.target.value)}
                    className="w-full px-3 py-2 rounded-[4px] border border-[#cbd6e2]"
                  />
                </div>
                <div>
                  <label className="block font-bold text-[#33475b] mb-1">CNPJ</label>
                  <input
                    type="text"
                    required
                    value={invCompanyCnpj}
                    onChange={(e) => setInvCompanyCnpj(e.target.value)}
                    className="w-full px-3 py-2 rounded-[4px] border border-[#cbd6e2]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-[#33475b] mb-1">Valor Bruto (R$)</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={invGrossAmount}
                    onChange={(e) => setInvGrossAmount(e.target.value)}
                    className="w-full px-3 py-2 rounded-[4px] border border-[#cbd6e2]"
                  />
                </div>
                <div>
                  <label className="block font-bold text-[#33475b] mb-1">Competência (MM/AAAA)</label>
                  <input
                    type="text"
                    value={invCompetence}
                    onChange={(e) => setInvCompetence(e.target.value)}
                    className="w-full px-3 py-2 rounded-[4px] border border-[#cbd6e2]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-[#33475b] mb-1">
                  Discriminação dos Equipamentos Locados / Serviços
                </label>
                <textarea
                  rows={2}
                  value={invDescription}
                  onChange={(e) => setInvDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-[4px] border border-[#cbd6e2]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowNewInvoiceModal(false)}
                  className="px-4 py-2 rounded-[4px] border border-[#cbd6e2] font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-[4px] bg-[#ff7a59] text-white font-extrabold"
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
