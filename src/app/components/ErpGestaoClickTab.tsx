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
  TrendingUp,
  AlertTriangle,
  History,
  Pencil,
} from 'lucide-react';
import {
  Company,
  Contact,
  Deal,
  ErpAssetStatus,
  ErpBankAccount,
  ErpCatalogItem,
  ErpCommercialProposal,
  ErpContractModality,
  ErpRentalEquipmentItem,
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
import ErpFinanceiroAndBanksView from './ErpFinanceiroAndBanksView';
import {
  recordDeletedCatalogItem,
  recordDeletedCompany,
  recordDeletedContract,
  recordDeletedEmployee,
  recordDeletedInvoice,
  recordDeletedProposal,
  recordDeletedPurchaseOrder,
  recordDeletedSaleOrder,
  recordDeletedServiceOrder,
  recordDeletedSupplier,
  recordUpsertedCatalogItem,
  recordUpsertedCompany,
  recordUpsertedContract,
  recordUpsertedEmployee,
  recordUpsertedInvoice,
  recordUpsertedProposal,
  recordUpsertedPurchaseOrder,
  recordUpsertedSaleOrder,
  recordUpsertedServiceOrder,
  recordUpsertedSupplier,
} from '../lib/durable-storage';
import { buildPublicProposalUrl } from '../lib/proposal-share';
import GestaoClickDashboard from './GestaoClickDashboard';
import GestaoClickSidebar, { GESTAO_CLICK_MENU_TREE } from './GestaoClickSidebar';
import StiHubAdminRbacPanel from './StiHubAdminRbacPanel';
import GestaoClickCompanyModal from './GestaoClickCompanyModal';
import DataHealthTab from './DataHealthTab';
import { CrmEmailTemplate, StiHubRbacState, StiHubUserRecord } from '../../db/types';
import {
  CATALOG_ITEM_EDITOR_FIELDS,
  ContractEditModal,
  GenericFieldSpec,
  GenericRecordEditModal,
  InvoiceEditModal,
  ProposalEditModal,
  SERVICE_ORDER_EDITOR_FIELDS,
} from './ErpEditModals';
import { Edit3, Mail } from 'lucide-react';
import ClientEmailComposerModal, { ClientEmailInitialPayload } from './ClientEmailComposerModal';
import { SetaErpTenPillarsMatrix, SetaErpPdvPosView, SetaErpStockAndPurchasesSubbar } from './SetaErpTenPillarsAndPdv';
import {
  BatchRentalBillingAndEmailModal,
  GestaoClickCustomerEditModal,
  GestaoClickProductEditModal,
  PartialEquipmentReturnProRataModal,
} from './GestaoClickEnrichedModals';

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
  rbacState?: StiHubRbacState | null;
  emailTemplates?: CrmEmailTemplate[];
  activeUser?: StiHubUserRecord | null;
  onSelectActiveUser?: (user: StiHubUserRecord) => void;
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
  | 'DATA_HEALTH_ERP'
  | 'CONFIGURACOES';


export function inferContractModality(ctr: ErpRentalContract): ErpContractModality {
  if (ctr.modality) return ctr.modality;
  const titleLower = (ctr.title || "").toLowerCase();
  if (
    titleLower.includes("assinatura") ||
    titleLower.includes("scm") ||
    titleLower.includes("link dedicado") ||
    titleLower.includes("fibra")
  ) {
    return "ASSINATURA";
  }
  if (
    (titleLower.includes("serviço") || titleLower.includes("servico") || titleLower.includes("noc") || titleLower.includes("manutenção")) &&
    !titleLower.includes("locação") &&
    !titleLower.includes("locacao")
  ) {
    return "SERVICO";
  }
  if (
    (titleLower.includes("locação") || titleLower.includes("locacao")) &&
    (titleLower.includes("serviço") || titleLower.includes("noc") || titleLower.includes("híbrido") || titleLower.includes("voz ip"))
  ) {
    return "HIBRIDO";
  }
  return "LOCACAO";
}

function getModalityBadgeMeta(modality: ErpContractModality) {
  switch (modality) {
    case "SERVICO":
      return {
        label: "Serviços Técnicos (LC 116 01.07)",
        cls: "bg-indigo-100 text-indigo-800 border border-indigo-200",
      };
    case "ASSINATURA":
      return {
        label: "Assinatura / Telecom SCM (Mod. 62)",
        cls: "bg-purple-100 text-purple-800 border border-purple-200",
      };
    case "HIBRIDO":
      return {
        label: "Híbrido (Locação SV 31 + NOC LC 116)",
        cls: "bg-cyan-100 text-cyan-900 border border-cyan-200",
      };
    default:
      return {
        label: "Locação Pura (0% ISS — SV 31 STF)",
        cls: "bg-emerald-50 text-emerald-800 border border-emerald-200",
      };
  }
}

function getContractStatusBadgeMeta(status: ErpRentalContract["status"]) {
  switch (status) {
    case "ATIVO":
      return { label: "ATIVO", cls: "bg-emerald-100 text-emerald-800 border border-emerald-300" };
    case "EM_IMPLANTACAO":
      return { label: "EM IMPLANTAÇÃO", cls: "bg-blue-100 text-blue-800 border border-blue-300" };
    case "RENOVACAO_PROXIMA":
      return { label: "RENOVAÇÃO PRÓXIMA", cls: "bg-amber-100 text-amber-800 border border-amber-300" };
    case "ENCERRADO":
      return { label: "ENCERRADO", cls: "bg-slate-200 text-slate-700 border border-slate-300" };
    default:
      return { label: status, cls: "bg-slate-100 text-slate-700 border border-slate-200" };
  }
}

function computeContractValidityInfo(endDateStr: string, status: ErpRentalContract["status"]) {
  if (!endDateStr) {
    return { daysRemaining: 365, label: "Vigência ativa", cls: "bg-slate-100 text-slate-700", isWarning: false };
  }
  const endMs = new Date(`${endDateStr.slice(0, 10)}T23:59:59Z`).getTime();
  if (Number.isNaN(endMs)) {
    return { daysRemaining: 365, label: `Até ${endDateStr}`, cls: "bg-slate-100 text-slate-700", isWarning: false };
  }
  const diffDays = Math.ceil((endMs - Date.now()) / 86400000);
  if (status === "ENCERRADO") {
    return { daysRemaining: diffDays, label: "Contrato Encerrado", cls: "bg-slate-200 text-slate-700", isWarning: false };
  }
  if (diffDays < 0) {
    return {
      daysRemaining: diffDays,
      label: `Vencido há ${Math.abs(diffDays)} dia(s)`,
      cls: "bg-rose-100 text-rose-800 border border-rose-300",
      isWarning: true,
    };
  }
  if (diffDays <= 60) {
    return {
      daysRemaining: diffDays,
      label: `⚠️ Vence em ${diffDays} dia(s) (Janela de Renovação)`,
      cls: "bg-amber-100 text-amber-900 border border-amber-300",
      isWarning: true,
    };
  }
  return {
    daysRemaining: diffDays,
    label: `Faltam ${diffDays} dias`,
    cls: "bg-emerald-50 text-emerald-800 border border-emerald-200",
    isWarning: false,
  };
}

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
  rbacState,
  emailTemplates = [],
  activeUser,
  onSelectActiveUser,
}: ErpGestaoClickTabProps) {
  const [activeSection, setActiveSection] = useState<GestaoClickMenuSection>(
    initialSection || "INICIO"
  );
  const [activeSubId, setActiveSubId] = useState<string>("INICIO");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [erpMobileDrawerOpen, setErpMobileDrawerOpen] = useState(false);
  const [editingProposal, setEditingProposal] = useState<ErpCommercialProposal | null>(null);
  const [isCreatingProposalModal, setIsCreatingProposalModal] = useState<boolean>(false);
  const [proposalsSearch, setProposalsSearch] = useState<string>("");
  const [proposalsStatusFilter, setProposalsStatusFilter] = useState<string>("TODOS");
  const [proposalsViewMode, setProposalsViewMode] = useState<"CARDS" | "TABLE">("TABLE");
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [selectedCadastroId, setSelectedCadastroId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [editingContract, setEditingContract] = useState<ErpRentalContract | null>(null);
  const [editingContractTab, setEditingContractTab] = useState<
    'DADOS_GERAIS' | 'RENOVAR_VIGENCIA' | 'FATURAMENTO_RECIBOS' | 'REAJUSTE_ADITIVOS' | 'EQUIPAMENTOS_PATRIMONIO' | 'DOCUMENTO_HISTORICO'
  >('DADOS_GERAIS');
  const [editingContractReadOnly, setEditingContractReadOnly] = useState<boolean>(false);
  const [editingInvoice, setEditingInvoice] = useState<ErpFiscalInvoice | null>(null);
  const [emailModalPayload, setEmailModalPayload] = useState<ClientEmailInitialPayload | null>(null);
  const [genericModal, setGenericModal] = useState<{
    title: string;
    initialValues: Record<string, unknown>;
    fields: GenericFieldSpec[];
    readOnly?: boolean;
    onSave: (values: Record<string, unknown>) => Promise<void>;
    onDelete?: () => Promise<void>;
  } | null>(null);
  const [hideBalances, setHideBalances] = useState(false);
  const [cadastrosSubTab, setCadastrosSubTab] = useState<
    "CLIENTES" | "FORNECEDORES" | "FUNCIONARIOS" | "TRANSPORTADORAS" | "AUXILIARES"
  >("CLIENTES");
  const [cadastrosSearch, setCadastrosSearch] = useState<string>("");
  const [itensSearch, setItensSearch] = useState<string>("");
  const [vendasSearch, setVendasSearch] = useState<string>("");
  const [pdvCustomerName, setPdvCustomerName] = useState<string>(
    companies[0]?.name || "CONSUMIDOR FINAL / BALCÃO SETA TELECOM"
  );
  const [pdvSellerName, setPdvSellerName] = useState<string>("Marcelo Mira");
  const [pdvPaymentMethod, setPdvPaymentMethod] = useState<string>("PIX Corporativo");
  const [pdvSelectedSku, setPdvSelectedSku] = useState<string>("GC-EQ-00101");
  const [pdvSelectedQty, setPdvSelectedQty] = useState<string>("1");
  const [pdvCart, setPdvCart] = useState<
    Array<{ sku: string; name: string; quantity: number; unitPrice: number }>
  >([]);
  const [osViewMode, setOsViewMode] = useState<"LISTA" | "PAINEL">("LISTA");
  const [osSearch, setOsSearch] = useState<string>("");
  const [osTechFilter, setOsTechFilter] = useState<string>("TODOS");
  const [kardexFilter, setKardexFilter] = useState<"TODOS" | "ENTRADA" | "REMESSA" | "SAIDA">("TODOS");
  const [contractsSubFilter, setContractsSubFilter] = useState<
    "TODOS" | "CTR_LOCACOES" | "CTR_SERVICOS" | "CTR_ASSINATURAS" | "CTR_AUXILIARES"
  >("TODOS");
  const [highlightedContractId, setHighlightedContractId] = useState<string | null>(null);
  const [highlightedProposalId, setHighlightedProposalId] = useState<string | null>(null);
  const [assetSearchQuery, setAssetSearchQuery] = useState<string>("");
  const [assetStatusFilter, setAssetStatusFilter] = useState<"TODOS" | ErpAssetStatus>("TODOS");
  const [readjustModal, setReadjustModal] = useState<{
    contract: ErpRentalContract;
    index: "IPCA" | "IGP-M" | "FIXO" | "IST_ANATEL" | "IST_ANATEL";
    percentage: string;
    note: string;
  } | null>(null);
  const [rmaModal, setRmaModal] = useState<{
    contract: ErpRentalContract;
    equipmentIdx: number;
    newSerialNumber: string;
    newAssetTag: string;
    newStatus: ErpAssetStatus;
  } | null>(null);
  const [partialReturnModalContract, setPartialReturnModalContract] = useState<ErpRentalContract | null>(null);
  const [showBatchBillingModal, setShowBatchBillingModal] = useState<boolean>(false);
  const [selectedContractIdsForBatch, setSelectedContractIdsForBatch] = useState<string[]>([]);
  const [editingCustomerModal, setEditingCustomerModal] = useState<{
    company: Partial<Company> | null;
    isNew: boolean;
    readOnly?: boolean;
  } | null>(null);
  const [editingProductModal, setEditingProductModal] = useState<{
    item: Partial<ErpCatalogItem>;
    isNew: boolean;
  } | null>(null);
  const [customerSearchQuery, setCustomerSearchQuery] = useState<string>("");
  const [syncingGc, setSyncingGc] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [selectedInvoiceForPrint, setSelectedInvoiceForPrint] =
    useState<ErpFiscalInvoice | null>(null);
  const [selectedPurchaseForPrint, setSelectedPurchaseForPrint] =
    useState<ErpPurchaseOrder | null>(null);
  const [servicosSubFilter, setServicosSubFilter] = useState<"TODOS" | "FATURA_LOCACAO" | "NFSE_SERVICO">("TODOS");
  const [produtosSubFilter, setProdutosSubFilter] = useState<"TODOS" | "NFE_VENDA_PRODUTO" | "NFE_REMESSA_LOCACAO" | "NFCOM_TELECOM">("TODOS");
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
  const [propCompanyId, setPropCompanyId] = useState("");
  const [propCustomCompanyName, setPropCustomCompanyName] = useState("");
  const [propCustomCnpj, setPropCustomCnpj] = useState("");
  const [propCustomContactName, setPropCustomContactName] = useState("");
  const [propContactId] = useState("");
  const [propDealId, setPropDealId] = useState("");
  const [propSeller, setPropSeller] = useState("Marcelo Lopes Mira");
  const [propMonths, setPropMonths] = useState("24");
  const [propReadjustmentIndex, setPropReadjustmentIndex] = useState<"IPCA" | "IGP-M" | "FIXO" | "IST_ANATEL" | "IST_ANATEL">("IPCA");
  const [propModality, setPropModality] = useState<"RENTAL" | "SERVICE" | "HYBRID">("RENTAL");
  const [propSerialNumber, setPropSerialNumber] = useState("");
  const [propPaymentCondition, setPropPaymentCondition] = useState("");
  const [propSku, setPropSku] = useState("");
  const [propQty, setPropQty] = useState("1");
  const [propUnitPrice, setPropUnitPrice] = useState("");
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
        setShowNewProposalModal(true);
      } else {
        openFullNewProposalModal("LOCACAO");
      }
    }
  }, [autoOpenNewProposalTrigger, prefillProposalFromDeal]);

  const [invDocType, setInvDocType] = useState<ErpFiscalDocumentType>("FATURA_LOCACAO");
  const [invCfop, setInvCfop] = useState<string>("N/A (Fatura de Locação vinculada à NF-e Remessa CFOP 5.908)");
  const [invCompanyName, setInvCompanyName] = useState("");
  const [invCompanyCnpj, setInvCompanyCnpj] = useState("");
  const [invGrossAmount, setInvGrossAmount] = useState("");
  const [invCompetence, setInvCompetence] = useState(new Date().toISOString().slice(0, 7).split("-").reverse().join("/"));
  const [invDescription, setInvDescription] = useState("");

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
      const localProp = proposals.find((p) => p.id === proposalId || p.code === proposalId);
      if (localProp) {
        await fetch(`/api/erp/proposals/${encodeURIComponent(localProp.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(localProp),
        }).catch(() => null);
      }
      const res = await fetch(`/api/erp/proposals/${encodeURIComponent(proposalId)}/approve`, {
        method: 'POST',
      });
      if (res.ok) {
        const j = await res.json();
        if (j.data?.proposal) recordUpsertedProposal(j.data.proposal);
        if (j.data?.contract) {
          recordUpsertedContract(j.data.contract);
          setHighlightedContractId(j.data.contract.id);
        }
        if (j.data?.invoice) recordUpsertedInvoice(j.data.invoice);
        const ctrNum = j.data?.contract?.contractNumber || 'LOC';
        const invNum = j.data?.invoice?.documentNumber || 'FAT-LOC';
        onShowToast(
          `Proposta aprovada! Contrato ${ctrNum} e Fatura de Locação ${invNum} gerados automaticamente!`
        );
        await onRefresh();
        setActiveSection('CONTRATOS');
        setContractsSubFilter('TODOS');
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleRenewContract = async (ctr: ErpRentalContract, extraMonths = 12) => {
    setBusyId(`renew-${ctr.id}`);
    try {
      const res = await fetch(
        `/api/erp/rental-contracts/${encodeURIComponent(ctr.id)}/renew`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ months: extraMonths }),
        }
      );
      if (res.ok) {
        const j = await res.json();
        if (j.data) recordUpsertedContract(j.data);
        onShowToast(
          `Vigência do contrato ${ctr.contractNumber} renovada por +${extraMonths} meses (até ${j.data?.endDate})!`
        );
        await onRefresh();
      } else {
        // Fallback client-side renewal
        const parsedEnd = ctr.endDate ? new Date(`${ctr.endDate}T12:00:00Z`) : new Date();
        const base = !Number.isNaN(parsedEnd.getTime()) && parsedEnd.getTime() > Date.now() ? parsedEnd : new Date();
        base.setUTCMonth(base.getUTCMonth() + extraMonths);
        const nextEnd = base.toISOString().slice(0, 10);
        const updated: ErpRentalContract = {
          ...ctr,
          endDate: nextEnd,
          contractMonths: Number(ctr.contractMonths || 24) + extraMonths,
          status: 'ATIVO',
          updatedAt: new Date().toISOString(),
        };
        await handleSaveEditedContract(updated);
        onShowToast(`Vigência do contrato ${ctr.contractNumber} renovada por +${extraMonths} meses (até ${nextEnd})!`);
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleApplyReadjustmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!readjustModal) return;
    const { contract, index, percentage, note } = readjustModal;
    const pctNum = Number(percentage);
    if (Number.isNaN(pctNum)) return;
    setBusyId(`readj-${contract.id}`);
    try {
      const res = await fetch(
        `/api/erp/rental-contracts/${encodeURIComponent(contract.id)}/readjust`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            index,
            percentage: pctNum,
            note: note.trim() || undefined,
          }),
        }
      );
      if (res.ok) {
        const j = await res.json();
        if (j.data) recordUpsertedContract(j.data);
        onShowToast(
          `Reajuste anual (${index} +${pctNum.toFixed(2)}%) aplicado ao contrato ${contract.contractNumber}! Novo valor: ${formatBRL(j.data?.monthlyValue || 0)}/mês.`
        );
        setReadjustModal(null);
        await onRefresh();
      } else {
        const factor = 1 + pctNum / 100;
        const prevVal = Number(contract.monthlyValue || 0);
        const newVal = Math.round((prevVal * factor + Number.EPSILON) * 100) / 100;
        const appliedAt = new Date().toISOString().slice(0, 10);
        const updated: ErpRentalContract = {
          ...contract,
          readjustmentIndex: index,
          monthlyValue: newVal,
          equipments: contract.equipments.map((eq) => ({
            ...eq,
            unitMonthlyRent: Math.round((eq.unitMonthlyRent * factor + Number.EPSILON) * 100) / 100,
          })),
          lastReadjustmentDate: appliedAt,
          lastReadjustmentPercent: pctNum,
          readjustmentHistory: [
            {
              id: `readj-${Date.now()}`,
              appliedAt,
              index,
              percentage: pctNum,
              previousMonthlyValue: prevVal,
              newMonthlyValue: newVal,
              note: note.trim() || `Reajuste anual ${index} (+${pctNum.toFixed(2)}%)`,
            },
            ...(contract.readjustmentHistory || []),
          ],
          updatedAt: new Date().toISOString(),
        };
        await handleSaveEditedContract(updated);
        setReadjustModal(null);
        onShowToast(
          `Reajuste anual (${index} +${pctNum.toFixed(2)}%) aplicado ao contrato ${contract.contractNumber}!`
        );
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveRmaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rmaModal) return;
    const { contract, equipmentIdx, newSerialNumber, newAssetTag, newStatus } = rmaModal;
    const nextEquipments = [...contract.equipments];
    if (!nextEquipments[equipmentIdx]) return;
    nextEquipments[equipmentIdx] = {
      ...nextEquipments[equipmentIdx],
      serialNumber: newSerialNumber.trim() || nextEquipments[equipmentIdx].serialNumber,
      assetTag: newAssetTag.trim() || nextEquipments[equipmentIdx].assetTag,
      assetStatus: newStatus,
    };
    const updated: ErpRentalContract = {
      ...contract,
      equipments: nextEquipments,
      updatedAt: new Date().toISOString(),
    };
    await handleSaveEditedContract(updated);
    setRmaModal(null);
    onShowToast(
      `Patrimônio / S/N atualizado para ${newSerialNumber.trim()} (${newStatus}) no contrato ${contract.contractNumber}!`
    );
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
      serialNumber: propSerialNumber.trim() || undefined,
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
        modality: propModality,
        readjustmentIndex: propReadjustmentIndex,
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
      setPropSerialNumber("");
      setPropExtraItems([]);
      setActiveSection("ORCAMENTOS");
      await onRefresh();
    }
  };

  const openNewInvoiceWithPreset = (docType: ErpFiscalDocumentType, customCfop?: string) => {
    setInvDocType(docType);
    setInvCompanyName("");
    setInvCompanyCnpj("");
    setInvGrossAmount("");
    setInvDescription("");
    if (docType === "FATURA_LOCACAO") {
      setInvCfop(customCfop || "N/A (Fatura de Locação vinculada à NF-e Remessa CFOP 5.908)");
    } else if (docType === "NFSE_SERVICO") {
      setInvCfop(customCfop || "5.933 — Prestação de serviço tributado pelo ISSQN");
    } else if (docType === "NFE_REMESSA_LOCACAO") {
      setInvCfop(customCfop || "5.908 — Remessa de bem por conta de contrato de locação");
    } else if (docType === "NFE_VENDA_PRODUTO") {
      setInvCfop(customCfop || "5.102 — Venda de mercadoria adquirida ou recebida de terceiros");
    } else if (docType === "NFCE_CONSUMIDOR") {
      setInvCfop(customCfop || "5.102 — Venda de mercadoria a consumidor final (PDV / Balcão)");
    } else {
      setInvCfop(customCfop || "5.303 — Prestação de serviço de comunicação Multimídia (SCM Anatel)");
    }
    setShowNewInvoiceModal(true);
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
        cfop: invCfop,
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
      if (j.data) recordUpsertedInvoice(j.data);
      onShowToast(`Documento fiscal ${j.data?.documentNumber} emitido com cálculo tributário automático!`);
      setShowNewInvoiceModal(false);
      await onRefresh();
      if (j.data) setSelectedInvoiceForPrint(j.data);
    }
  };

  const handleSaveEditedProposal = async (updated: ErpCommercialProposal) => {
    const isNew = isCreatingProposalModal || !proposals.some((p) => p.id === updated.id);
    const res = await fetch(
      isNew ? '/api/erp/proposals' : `/api/erp/proposals/${encodeURIComponent(updated.id)}`,
      {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      }
    );
    const saved: ErpCommercialProposal = res.ok ? (await res.json())?.data || updated : updated;
    recordUpsertedProposal(saved);
    const publicUrl = buildPublicProposalUrl(saved);
    const printUrl = buildPublicProposalUrl(saved, { autoPrint: true });
    setCreatedProposalBanner({
      proposal: saved,
      publicUrl,
      printUrl,
    });
    setEditingProposal(null);
    setIsCreatingProposalModal(false);
    setActiveSection('ORCAMENTOS');
    onShowToast(
      isNew
        ? `Orçamento ${saved.code} criado com sucesso e Link PDF A4 gerado!`
        : `Orçamento ${saved.code} atualizado com sucesso e Link PDF regenerado!`
    );
    await onRefresh();
  };

  const handleDeleteProposal = async (prop: ErpCommercialProposal) => {
    await fetch(`/api/erp/proposals/${encodeURIComponent(prop.id)}`, { method: 'DELETE' });
    recordDeletedProposal(prop.id);
    onShowToast(`Proposta ${prop.code} excluída.`);
    await onRefresh();
  };

  const handleSaveEditedContract = async (updated: ErpRentalContract) => {
    const isNew = !rentalContracts.some((c) => c.id === updated.id);
    const res = await fetch(
      isNew ? '/api/erp/rental-contracts' : `/api/erp/rental-contracts/${encodeURIComponent(updated.id)}`,
      {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      }
    );
    const saved: ErpRentalContract = res.ok ? (await res.json())?.data || updated : updated;
    recordUpsertedContract(saved);
    setEditingContract(null);
    onShowToast(`Contrato ${saved.contractNumber} salvo com sucesso!`);
    await onRefresh();
  };

  const handleDeleteContract = async (ctr: ErpRentalContract) => {
    await fetch(`/api/erp/rental-contracts/${encodeURIComponent(ctr.id)}`, { method: 'DELETE' });
    recordDeletedContract(ctr.id);
    onShowToast(`Contrato ${ctr.contractNumber} excluído.`);
    await onRefresh();
  };

  const handleSaveEditedInvoice = async (updated: ErpFiscalInvoice) => {
    const res = await fetch(`/api/erp/invoices/${encodeURIComponent(updated.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    const saved: ErpFiscalInvoice = res.ok ? (await res.json())?.data || updated : updated;
    recordUpsertedInvoice(saved);
    setEditingInvoice(null);
    onShowToast(`Documento fiscal ${saved.documentNumber} atualizado!`);
    await onRefresh();
  };

  const handleDeleteInvoice = async (inv: ErpFiscalInvoice) => {
    await fetch(`/api/erp/invoices/${encodeURIComponent(inv.id)}`, { method: 'DELETE' });
    recordDeletedInvoice(inv.id);
    onShowToast(`Documento fiscal ${inv.documentNumber} excluído.`);
    await onRefresh();
  };

  const openCollectionEditor = (
    collection: 'bankAccounts' | 'salesOrders' | 'serviceOrders' | 'suppliers' | 'employees' | 'purchaseOrders',
    title: string,
    initialValues: Record<string, unknown>,
    fields: GenericFieldSpec[],
    options?: { readOnly?: boolean; deleteId?: string; deleteLabel?: string }
  ) => {
    setGenericModal({
      title,
      initialValues,
      fields,
      readOnly: options?.readOnly,
      onDelete: options?.deleteId
        ? async () => {
            await handleDeleteCollectionRecord(
              collection,
              options.deleteId!,
              options.deleteLabel || title
            );
            setGenericModal(null);
          }
        : undefined,
      onSave: async (values) => {
        const payload = { ...initialValues, ...values };
        const res = await fetch(`/api/erp/records/${collection}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const saved = res.ok ? (await res.json())?.data || payload : payload;
        if (saved) {
          if (collection === 'purchaseOrders') recordUpsertedPurchaseOrder(saved as ErpPurchaseOrder);
          if (collection === 'suppliers') recordUpsertedSupplier(saved as ErpSupplierRecord);
          if (collection === 'employees') recordUpsertedEmployee(saved as ErpEmployeeRecord);
          if (collection === 'salesOrders') recordUpsertedSaleOrder(saved as ErpSaleOrder);
          if (collection === 'serviceOrders') recordUpsertedServiceOrder(saved as ErpServiceOrder);
        }
        setGenericModal(null);
        onShowToast(`${title} salvo com sucesso!`);
        await onRefresh();
      },
    });
  };

  const handleDeleteCollectionRecord = async (
    collection: 'bankAccounts' | 'salesOrders' | 'serviceOrders' | 'suppliers' | 'employees' | 'purchaseOrders',
    id: string,
    label: string
  ) => {
    await fetch(`/api/erp/records/${collection}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (collection === 'purchaseOrders') recordDeletedPurchaseOrder(id);
    if (collection === 'suppliers') recordDeletedSupplier(id);
    if (collection === 'employees') recordDeletedEmployee(id);
    if (collection === 'salesOrders') recordDeletedSaleOrder(id);
    if (collection === 'serviceOrders') recordDeletedServiceOrder(id);
    onShowToast(`${label} removido.`);
    await onRefresh();
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

  const openGenerateContractFromProposal = (prop: ErpCommercialProposal) => {
    const startDate = new Date().toISOString().slice(0, 10);
    const months = Math.max(1, Number(prop.contractMonths) || 24);
    const endDate = new Date(Date.now() + months * 30 * 86400000).toISOString().slice(0, 10);
    const nextNum = 100 + rentalContracts.length + 1;
    const equipments: ErpRentalEquipmentItem[] = (prop.items || []).map((it, idx) => ({
      id: `eq-${Date.now()}-${idx}`,
      skuGestaoClick: it.sku || `GC-EQ-00${idx + 101}`,
      description: it.description || prop.title,
      serialNumber: it.serialNumber || `SN-SETA-${10000 + idx}`,
      assetTag: `PAT-SETA-00${nextNum}-${idx + 1}`,
      assetStatus: 'EM_CLIENTE',
      ncm: it.ncmOrServiceCode || '8517.62.59',
      quantity: Math.max(1, Number(it.quantity) || 1),
      unitMonthlyRent: Number(it.unitPrice) || 0,
      assetValueBrl: (Number(it.unitPrice) || 0) * 6,
      remessaCfop: '5.908',
      remessaNfeKey: '',
    }));

    setEditingProposal(null);
    setIsCreatingProposalModal(false);
    setEditingContractReadOnly(false);
    setEditingContractTab('RENOVAR_VIGENCIA');
    setEditingContract({
      id: `ctr-${Date.now()}`,
      contractNumber: `LOC-2026-${nextNum}`,
      title: prop.title || `Contrato de Locação — ${prop.companyName}`,
      modality: prop.modality === 'SERVICE' ? 'SERVICO' : prop.modality === 'HYBRID' ? 'HIBRIDO' : 'LOCACAO',
      companyId: prop.companyId || null,
      companyName: prop.companyName || '',
      companyCnpj: prop.companyCnpj || '',
      contactId: prop.contactId || null,
      dealId: prop.dealId || null,
      proposalId: prop.id,
      monthlyValue: prop.monthlyRecurringTotal || prop.totalContractValue || 0,
      dueDay: 10,
      startDate,
      endDate,
      contractMonths: months,
      readjustmentIndex: prop.readjustmentIndex || 'IPCA',
      status: 'ATIVO',
      remessaNfeNumber: `000.420.${nextNum}`,
      remessaCfop: '5.908',
      legalBasisNote:
        'Locação de Bens Móveis (Não incidência de ISSQN — LC 116/2003 e Súmula Vinculante 31 STF).',
      lastBilledCompetence: new Date().toISOString().slice(0, 7).split('-').reverse().join('/'),
      equipments,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  };

  const openNewContractPreset = (modality: ErpContractModality) => {
    const startDate = new Date().toISOString().slice(0, 10);
    const endDate = new Date(Date.now() + 24 * 30 * 86400000).toISOString().slice(0, 10);
    const nextNum = 100 + rentalContracts.length + 1;
    const prefix = modality === "SERVICO" ? "SRV" : modality === "ASSINATURA" ? "SCM" : modality === "HIBRIDO" ? "HIB" : "LOC";

    setEditingContract({
      id: `ctr-${Date.now()}`,
      contractNumber: `${prefix}-2026-${nextNum}`,
      title: "",
      modality,
      companyId: null,
      companyName: "",
      companyCnpj: "",
      contactId: null,
      dealId: null,
      proposalId: null,
      monthlyValue: 0,
      dueDay: 10,
      startDate,
      endDate,
      contractMonths: 24,
      readjustmentIndex: "IPCA",
      status: "ATIVO",
      remessaNfeNumber: "",
      remessaCfop: "5.908",
      legalBasisNote: "",
      lastBilledCompetence: new Date().toISOString().slice(0, 7).split("-").reverse().join("/"),
      equipments: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  };

  const openFullNewProposalModal = (
    presetBudgetType?: 'PRODUTOS' | 'SERVICOS' | 'CONJUNTO' | 'LOCACAO',
    templateOverrides?: Partial<ErpCommercialProposal>
  ) => {
    const inferredType =
      presetBudgetType ||
      (activeSubId === 'ORC_SERVICOS'
        ? 'SERVICOS'
        : activeSubId === 'ORC_PRODUTOS'
          ? 'PRODUTOS'
          : 'LOCACAO');
    const nextNum = proposals.length + 1;

    // Nova Proposta / Novo Orçamento inicia 100% em branco (sem cliente, sem A/C, sem itens ou valores pré-preenchidos)
    const draftNew: ErpCommercialProposal = {
      id: `prop-${Date.now()}`,
      code: `PROP-2026-00${nextNum}`,
      title: '',
      budgetType: inferredType,
      storeName: gestaoClickConfig.storeName || 'Matriz',
      salesChannel: '',
      costCenter: '',
      proposalDate: new Date().toISOString().slice(0, 10),
      deliveryForecast: '',
      careOf: '',
      introductionText: '',
      internalNotes: '',
      shippingCost: 0,
      shippingCarrier: '',
      deliveryAddress: '',
      discountAmount: 0,
      discountPercentGlobal: 0,
      companyId: null,
      companyName: '',
      companyCnpj: '',
      contactId: null,
      contactName: '',
      contactEmail: undefined,
      dealId: null,
      sellerName: '',
      status: 'RASCUNHO',
      modality: inferredType === 'SERVICOS' ? 'SERVICE' : inferredType === 'CONJUNTO' ? 'HYBRID' : 'RENTAL',
      readjustmentIndex: 'IPCA',
      contractMonths: 24,
      paymentCondition: '',
      validUntil: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
      items: [],
      installments: [],
      monthlyRecurringTotal: 0,
      oneTimeSetupTotal: 0,
      totalContractValue: 0,
      commercialNotes: '',
      technicalClauses: '',
      convertedContractId: null,
      convertedInvoiceId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...templateOverrides,
    };

    setIsCreatingProposalModal(true);
    setEditingProposal(draftNew);
  };

  const renderProposalsList = () => {
    const effectiveOrcTab: 'TODOS' | 'ORC_PRODUTOS' | 'ORC_SERVICOS' | 'ORC_AUXILIARES' =
      activeSubId === 'ORC_PRODUTOS' ||
      activeSubId === 'ORC_SERVICOS' ||
      activeSubId === 'ORC_AUXILIARES'
        ? (activeSubId as 'ORC_PRODUTOS' | 'ORC_SERVICOS' | 'ORC_AUXILIARES')
        : 'TODOS';

    const hasProductItem = (p: ErpCommercialProposal) =>
      p.budgetType === 'PRODUTOS' ||
      p.budgetType === 'LOCACAO' ||
      p.budgetType === 'CONJUNTO' ||
      p.items.some(
        (i) =>
          i.itemType === 'PRODUCT' ||
          i.fiscalNature === 'LOCACAO_BENS_MOVEIS' ||
          i.fiscalNature === 'VENDA_EQUIPAMENTO'
      );

    const hasServiceItem = (p: ErpCommercialProposal) =>
      p.budgetType === 'SERVICOS' ||
      p.budgetType === 'CONJUNTO' ||
      p.items.some(
        (i) =>
          i.itemType === 'SERVICE' ||
          i.fiscalNature === 'SERVICO_TECNICO_TI_TELECOM' ||
          i.fiscalNature === 'SERVICO_COMUNICACAO_SCM_SVA'
      );

    const tabFiltered =
      effectiveOrcTab === 'ORC_PRODUTOS'
        ? proposals.filter(hasProductItem)
        : effectiveOrcTab === 'ORC_SERVICOS'
          ? proposals.filter(hasServiceItem)
          : proposals;

    const filteredProposals = tabFiltered.filter((p) => {
      if (proposalsStatusFilter !== 'TODOS' && p.status !== proposalsStatusFilter) {
        return false;
      }
      if (!proposalsSearch.trim()) return true;
      const q = proposalsSearch.toLowerCase();
      return (
        p.code.toLowerCase().includes(q) ||
        p.title.toLowerCase().includes(q) ||
        p.companyName.toLowerCase().includes(q) ||
        (p.companyCnpj || '').toLowerCase().includes(q) ||
        (p.sellerName || '').toLowerCase().includes(q) ||
        (p.contactName || '').toLowerCase().includes(q)
      );
    });

    const getStatusBadge = (p: ErpCommercialProposal) => {
      const isConverted = p.status === 'CONVERTIDA_CONTRATO' || Boolean(p.convertedContractId);
      if (isConverted) {
        return {
          label: 'CONVERTIDO EM CONTRATO',
          cls: 'bg-emerald-100 text-emerald-800 border border-emerald-300',
        };
      }
      switch (p.status) {
        case 'APROVADA':
          return { label: 'APROVADO', cls: 'bg-emerald-50 text-emerald-800 border border-emerald-200' };
        case 'EM_NEGOCIACAO':
          return { label: 'EM NEGOCIAÇÃO', cls: 'bg-amber-100 text-amber-800 border border-amber-200' };
        case 'RASCUNHO':
          return { label: 'EM ABERTO', cls: 'bg-slate-100 text-slate-700 border border-slate-300' };
        case 'RECUSADA':
          return { label: 'CANCELADO', cls: 'bg-rose-100 text-rose-800 border border-rose-200' };
        default:
          return { label: 'ENVIADO AO CLIENTE', cls: 'bg-blue-100 text-blue-800 border border-blue-200' };
      }
    };

    const getBudgetTypeLabel = (p: ErpCommercialProposal) => {
      if (p.budgetType === 'SERVICOS') return 'Serviços (LC 116)';
      if (p.budgetType === 'PRODUTOS') return 'Produtos / Hardware';
      if (p.budgetType === 'CONJUNTO') return 'Conjunto (Prod + Serv)';
      if (hasProductItem(p) && hasServiceItem(p)) return 'Conjunto (Prod + Serv)';
      if (hasServiceItem(p) && !hasProductItem(p)) return 'Serviços (LC 116)';
      return 'Locação & Produtos';
    };

    return (
      <div className="space-y-4">
        {/* CABEÇALHO E NAVEGAÇÃO DE SUB-MENUS DE ORÇAMENTOS (GESTÃOCLICK) */}
        <div className="bg-white rounded-md border border-slate-200 p-4 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-[10px] font-extrabold uppercase text-[#1e3a6e] block">
                Orçamentos &gt;{' '}
                {effectiveOrcTab === 'ORC_PRODUTOS'
                  ? 'Produtos e Equipamentos'
                  : effectiveOrcTab === 'ORC_SERVICOS'
                    ? 'Serviços Técnicos TI/Telecom'
                    : effectiveOrcTab === 'ORC_AUXILIARES'
                      ? 'Opções Auxiliares'
                      : 'Todos os Orçamentos e Propostas'}
              </span>
              <h2 className="text-base font-extrabold text-slate-900">
                Orçamentos &amp; Propostas Comerciais ({filteredProposals.length} de {proposals.length})
              </h2>
              <p className="text-xs text-slate-500">
                Gestão completa de orçamentos de Produtos (786 itens), Serviços (39 itens), frete, descontos, parcelas e link público PDF A4.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-md border border-slate-300 bg-slate-50 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setProposalsViewMode('CARDS')}
                  className={`px-2.5 py-1 rounded font-bold cursor-pointer ${
                    proposalsViewMode === 'CARDS'
                      ? 'bg-[#1e3a6e] text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Visão Cards Executivos
                </button>
                <button
                  type="button"
                  onClick={() => setProposalsViewMode('TABLE')}
                  className={`px-2.5 py-1 rounded font-bold cursor-pointer ${
                    proposalsViewMode === 'TABLE'
                      ? 'bg-[#1e3a6e] text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Visão Tabela GestãoClick
                </button>
              </div>

              <button
                type="button"
                onClick={() =>
                  openFullNewProposalModal(
                    effectiveOrcTab === 'ORC_SERVICOS'
                      ? 'SERVICOS'
                      : effectiveOrcTab === 'ORC_PRODUTOS'
                        ? 'PRODUTOS'
                        : 'LOCACAO'
                  )
                }
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold shadow-sm cursor-pointer"
              >
                <Plus className="w-4 h-4" /> + Novo Orçamento
              </button>
            </div>
          </div>

          {/* BARRA DE SELEÇÃO E EDIÇÃO RÁPIDA DE ORÇAMENTOS (SUB-ITENS NA VERTICAL ESQUERDA) */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
            <div className="flex flex-wrap items-center gap-2">
              {(() => {
                const targetProp =
                  filteredProposals.find((p) => p.id === selectedProposalId) || null;
                return targetProp ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCreatingProposalModal(false);
                        setEditingProposal(targetProp);
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-amber-500 hover:bg-amber-600 text-white text-xs font-extrabold shadow-xs cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" /> Editar Selecionado ({targetProp.code})
                    </button>
                    <a
                      href={buildPublicProposalUrl(targetProp, { autoPrint: true })}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#1e3a6e] hover:bg-[#162b54] text-white text-xs font-bold"
                    >
                      <Printer className="w-3.5 h-3.5" /> Imprimir PDF ({targetProp.code})
                    </a>
                    <button
                      type="button"
                      onClick={() => setSelectedProposalId(null)}
                      title="Desmarcar orçamento selecionado"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" /> Desmarcar
                    </button>
                  </>
                ) : (
                  <span className="px-2.5 py-1 rounded bg-slate-100 border border-slate-200 text-[11px] font-bold text-slate-600">
                    Nenhum orçamento marcado — clique na caixa Sel. ou em uma linha para selecionar (ou clique novamente para desmarcar)
                  </span>
                );
              })()}
            </div>

            {effectiveOrcTab !== 'ORC_AUXILIARES' && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={proposalsSearch}
                    onChange={(e) => setProposalsSearch(e.target.value)}
                    placeholder="Buscar cliente, código, CNPJ, vendedor..."
                    className="pl-8 pr-3 py-1.5 rounded border border-slate-300 text-xs w-64"
                  />
                </div>
                <select
                  value={proposalsStatusFilter}
                  onChange={(e) => setProposalsStatusFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded border border-slate-300 bg-white text-xs font-bold text-slate-700"
                >
                  <option value="TODOS">Situação: Todas</option>
                  <option value="RASCUNHO">Em Aberto</option>
                  <option value="ENVIADA">Enviado</option>
                  <option value="EM_NEGOCIACAO">Em Negociação</option>
                  <option value="APROVADA">Aprovado</option>
                  <option value="CONVERTIDA_CONTRATO">Convertido em Contrato</option>
                  <option value="RECUSADA">Cancelado / Recusado</option>
                </select>
              </div>
            )}
          </div>
        </div>

        {/* PAINEL DE OPÇÕES AUXILIARES DE ORÇAMENTOS (ORC_AUXILIARES) */}
        {effectiveOrcTab === 'ORC_AUXILIARES' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-md border border-slate-200 p-5 space-y-3">
              <h3 className="text-sm font-extrabold text-slate-900">
                🏷️ Situações de Orçamento &amp; Canais de Venda (GestãoClick)
              </h3>
              <p className="text-xs text-slate-500">
                Fluxo de aprovação comercial sincronizado com o Kanban de Negócios e Geração Automática de Contratos.
              </p>
              <div className="space-y-2 text-xs">
                {[
                  { code: 'RASCUNHO', name: 'Em Aberto (Rascunho Comercial)', color: 'bg-slate-200 text-slate-800' },
                  { code: 'ENVIADA', name: 'Enviado ao Cliente (Link Público PDF Ativo)', color: 'bg-blue-100 text-blue-800' },
                  { code: 'EM_NEGOCIACAO', name: 'Em Negociação / Revisão de Escopo', color: 'bg-amber-100 text-amber-800' },
                  { code: 'APROVADA', name: 'Aprovado pelo Decisor', color: 'bg-emerald-100 text-emerald-800' },
                  { code: 'CONVERTIDA_CONTRATO', name: 'Concretizado / Convertido em Contrato + Fatura', color: 'bg-emerald-600 text-white' },
                ].map((st) => (
                  <div key={st.code} className="flex items-center justify-between p-2 rounded border border-slate-200 bg-slate-50">
                    <span className="font-semibold text-slate-800">{st.name}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${st.color}`}>
                      {proposals.filter((p) => p.status === st.code).length} orçamento(s)
                    </span>
                  </div>
                ))}
              </div>
              <div className="pt-2 border-t border-slate-200">
                <span className="text-[11px] font-bold text-slate-700 block mb-1.5">
                  Canais de Venda Habilitados na Loja Matriz #118887:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    'Comercial B2B / Consultivo',
                    'Presencial',
                    'Telefone / Inside Sales',
                    'WhatsApp Corporativo',
                    'Cliente Recorrente (Upsell)',
                    'E-commerce / Portal',
                  ].map((ch) => (
                    <span key={ch} className="px-2.5 py-1 rounded-full bg-blue-50 text-[#1e3a6e] border border-blue-200 text-[11px] font-bold">
                      {ch}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-md border border-slate-200 p-5 space-y-3">
              <h3 className="text-sm font-extrabold text-slate-900">
                📄 Modelos de Introdução, Cláusulas Seta Telecom &amp; Impressão A4
              </h3>
              <p className="text-xs text-slate-500">
                Clique em qualquer template abaixo para abrir imediatamente um novo orçamento pré-configurado.
              </p>
              <div className="space-y-2.5 text-xs">
                <div className="p-3 rounded border border-emerald-200 bg-emerald-50/50 space-y-1.5">
                  <div className="font-extrabold text-emerald-950">
                    Template 1: Locação Pura de Bens Móveis (0% ISS — Súmula Vinculante 31 STF)
                  </div>
                  <p className="text-[11px] text-emerald-900">
                    Faturamento mediante Fatura de Locação (dispensa legal de ISSQN conforme LC 116/03) + NF-e de Remessa CFOP 5.908.
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      openFullNewProposalModal('LOCACAO', {
                        title: 'Proposta de Locação de Infraestrutura PABX IP & SD-WAN (SV 31 STF)',
                      })
                    }
                    className="px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-extrabold cursor-pointer"
                  >
                    + Usar Template de Locação Pura
                  </button>
                </div>

                <div className="p-3 rounded border border-indigo-200 bg-indigo-50/50 space-y-1.5">
                  <div className="font-extrabold text-indigo-950">
                    Template 2: Serviços Técnicos TI / Telecom &amp; Suporte NOC 24x7 (LC 116 Item 01.07)
                  </div>
                  <p className="text-[11px] text-indigo-900">
                    Prestação de serviços especializados de instalação, homologação e monitoramento com emissão de NFS-e.
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      openFullNewProposalModal('SERVICOS', {
                        title: 'Proposta de Serviços Técnicos de Engenharia & Suporte NOC 24x7',
                      })
                    }
                    className="px-3 py-1.5 rounded bg-indigo-700 hover:bg-indigo-800 text-white text-[11px] font-extrabold cursor-pointer"
                  >
                    + Usar Template de Serviços LC 116
                  </button>
                </div>

                <div className="p-3 rounded border border-amber-200 bg-amber-50/50 space-y-1.5">
                  <div className="font-extrabold text-amber-950">
                    Template 3: Orçamento Conjunto (Hardware + Instalação + Parcelamento)
                  </div>
                  <p className="text-[11px] text-amber-900">
                    Combina equipamentos do catálogo (786 produtos) e serviços técnicos (39 serviços) com cronograma de parcelas no PDF A4.
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      openFullNewProposalModal('CONJUNTO', {
                        title: 'Proposta Conjunta: Fornecimento de Equipamentos + Implantação Técnica',
                      })
                    }
                    className="px-3 py-1.5 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white text-[11px] font-extrabold cursor-pointer"
                  >
                    + Usar Template Conjunto (Produtos + Serviços)
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VISÃO TABELA GESTÃOCLICK */}
        {effectiveOrcTab !== 'ORC_AUXILIARES' && proposalsViewMode === 'TABLE' && (
          <div className="bg-white rounded-md border border-slate-200 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#1e3a6e] text-white uppercase text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3 w-8">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedProposalId && filteredProposals.some((p) => p.id === selectedProposalId))}
                        onChange={() =>
                          setSelectedProposalId((prev) =>
                            prev ? null : (filteredProposals[0]?.id ?? null)
                          )
                        }
                        title={selectedProposalId ? "Desmarcar orçamento selecionado" : "Selecionar primeiro orçamento"}
                        className="w-4 h-4 accent-[#1e3a6e] cursor-pointer"
                      />
                    </th>
                    <th className="py-2.5 px-3">Cód.</th>
                    <th className="py-2.5 px-3">Cliente / Razão Social</th>
                    <th className="py-2.5 px-3">Tipo</th>
                    <th className="py-2.5 px-3">Data / Validade</th>
                    <th className="py-2.5 px-3">Vendedor / Canal</th>
                    <th className="py-2.5 px-3">Situação</th>
                    <th className="py-2.5 px-3 text-right">Prod / Serv / Frete</th>
                    <th className="py-2.5 px-3 text-right">MRR Mensal</th>
                    <th className="py-2.5 px-3 text-right">Valor Total (TCV)</th>
                    <th className="py-2.5 px-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredProposals.map((prop) => {
                    const isConverted =
                      prop.status === 'CONVERTIDA_CONTRATO' || Boolean(prop.convertedContractId);
                    const publicUrl = buildPublicProposalUrl(prop);
                    const printUrl = buildPublicProposalUrl(prop, { autoPrint: true });
                    const stBadge = getStatusBadge(prop);
                    const prdSub =
                      prop.productsSubtotal ??
                      prop.items
                        .filter((i) => i.fiscalNature !== 'SERVICO_TECNICO_TI_TELECOM')
                        .reduce((s, i) => s + i.totalMonthly, 0);
                    const srvSub =
                      prop.servicesSubtotal ??
                      prop.items
                        .filter((i) => i.fiscalNature === 'SERVICO_TECNICO_TI_TELECOM')
                        .reduce((s, i) => s + i.totalMonthly, 0);
                    return (
                      <tr
                        key={prop.id}
                        onClick={() =>
                          setSelectedProposalId((prev) => (prev === prop.id ? null : prop.id))
                        }
                        className={`cursor-pointer transition ${
                          selectedProposalId === prop.id
                            ? 'bg-blue-50/80 hover:bg-blue-100/60'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedProposalId === prop.id}
                            onChange={() =>
                              setSelectedProposalId((prev) => (prev === prop.id ? null : prop.id))
                            }
                            className="w-4 h-4 accent-[#1e3a6e] cursor-pointer"
                          />
                        </td>
                        <td
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsCreatingProposalModal(false);
                            setEditingProposal(prop);
                          }}
                          className="py-2.5 px-3 font-mono font-bold text-[#1e3a6e] underline"
                        >
                          {prop.code}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-900">{prop.companyName}</div>
                          <div className="text-[10px] text-slate-500">
                            CNPJ: {prop.companyCnpj} • A/C: {prop.careOf || prop.contactName}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 text-[10px] font-bold">
                            {getBudgetTypeLabel(prop)}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-[11px]">
                          <div>
                            Emissão:{' '}
                            {prop.proposalDate ||
                              (prop.createdAt ? prop.createdAt.slice(0, 10) : '26/10/2026')}
                          </div>
                          <div className="text-slate-500">
                            Val: {prop.validUntil ? prop.validUntil.slice(0, 10) : '15 dias'}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-[11px]">
                          <div className="font-semibold text-slate-800">{prop.sellerName}</div>
                          <div className="text-slate-500">
                            {prop.salesChannel || 'Comercial B2B'}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${stBadge.cls}`}>
                            {stBadge.label}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right text-[11px]">
                          <div>Prod: {formatBRL(prdSub)}</div>
                          <div>Serv: {formatBRL(srvSub)}</div>
                          {(prop.shippingCost || 0) > 0 && (
                            <div className="text-slate-500">
                              Frete: {formatBRL(prop.shippingCost || 0)}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-extrabold text-emerald-700">
                          {formatBRL(prop.monthlyRecurringTotal)}/mês
                        </td>
                        <td className="py-2.5 px-3 text-right font-black text-slate-900">
                          {formatBRL(prop.totalContractValue)}
                          <span className="block text-[10px] font-normal text-slate-500">
                            ({prop.contractMonths}m)
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setIsCreatingProposalModal(false);
                                setEditingProposal(prop);
                              }}
                              title="Editar Orçamento"
                              className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-extrabold cursor-pointer"
                            >
                              ✏️ Editar
                            </button>
                            <a
                              href={printUrl}
                              target="_blank"
                              rel="noreferrer"
                              title="Imprimir PDF A4"
                              className="px-2 py-1 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white text-[11px] font-bold"
                            >
                              🖨️ PDF
                            </a>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(publicUrl);
                                onShowToast(`Link público de ${prop.code} copiado!`);
                              }}
                              title="Copiar Link Público"
                              className="px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-[11px] font-bold cursor-pointer"
                            >
                              📋
                            </button>
                            {!isConverted && (
                              <button
                                type="button"
                                disabled={busyId === prop.id}
                                onClick={() => openGenerateContractFromProposal(prop)}
                                title="Aprovar e Gerar Contrato"
                                className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer"
                              >
                                ✓
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* VISÃO CARDS EXECUTIVOS */}
        {effectiveOrcTab !== 'ORC_AUXILIARES' &&
          proposalsViewMode === 'CARDS' &&
          filteredProposals.map((prop) => {
            const isConverted =
              prop.status === 'CONVERTIDA_CONTRATO' || Boolean(prop.convertedContractId);
            const linkedContract = rentalContracts.find(
              (c) =>
                (prop.convertedContractId && c.id === prop.convertedContractId) ||
                c.proposalId === prop.id ||
                c.proposalId === prop.code
            );
            const isHighlighted =
              highlightedProposalId === prop.id || highlightedProposalId === prop.code;
            const publicUrl = buildPublicProposalUrl(prop);
            const printUrl = buildPublicProposalUrl(prop, { autoPrint: true });
            const stBadge = getStatusBadge(prop);

            return (
              <div
                key={prop.id}
                className={`bg-white rounded-md border p-5 shadow-xs space-y-4 transition ${
                  isHighlighted
                    ? 'border-2 border-[#ff7a59] ring-2 ring-[#ff7a59]/20'
                    : 'border-slate-200'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded text-xs font-black bg-[#1e3a6e] text-white">
                        {prop.code}
                      </span>
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold ${stBadge.cls}`}>
                        {stBadge.label}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-blue-50 text-[#1e3a6e] border border-blue-200">
                        {getBudgetTypeLabel(prop)}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-indigo-50 text-indigo-800 border border-indigo-200">
                        Reajuste: {prop.readjustmentIndex || 'IPCA'}
                      </span>
                      <span className="text-xs text-slate-500">
                        Executivo: <strong>{prop.sellerName}</strong> • Canal:{' '}
                        <strong>{prop.salesChannel || 'Comercial B2B'}</strong> • Prazo:{' '}
                        <strong>{prop.contractMonths} meses</strong>
                      </span>
                    </div>
                    <h3 className="text-base font-extrabold text-slate-900 mt-1.5">{prop.title}</h3>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Cliente: <strong>{prop.companyName}</strong> (CNPJ: {prop.companyCnpj}) • Aos cuidados de:{' '}
                      <strong>{prop.careOf || prop.contactName}</strong>
                      {prop.deliveryForecast && (
                        <>
                          {' '}
                          • Entrega: <strong>{prop.deliveryForecast}</strong>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-right bg-slate-50 px-3.5 py-2 rounded border border-slate-200">
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
                      onClick={() => {
                        setIsCreatingProposalModal(false);
                        setEditingProposal(prop);
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded bg-amber-500 hover:bg-amber-600 text-white text-xs font-extrabold shadow-xs cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" /> ✏️ Editar Orçamento
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteProposal(prop)}
                      title="Excluir Proposta"
                      className="inline-flex items-center gap-1 px-2.5 py-2 rounded border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>

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

                    {isConverted && (linkedContract || prop.convertedContractId) ? (
                      <button
                        type="button"
                        onClick={() => {
                          const targetId = linkedContract?.id || prop.convertedContractId || null;
                          setHighlightedContractId(targetId);
                          setContractsSubFilter('TODOS');
                          setActiveSubId('CTR_LOCACOES');
                          setActiveSection('CONTRATOS');
                          onShowToast(
                            `Visualizando contrato gerado: ${
                              linkedContract?.contractNumber || prop.convertedContractId
                            }`
                          );
                        }}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded bg-indigo-950 hover:bg-indigo-900 text-emerald-300 text-xs font-extrabold cursor-pointer shadow-xs"
                      >
                        <FileCheck2 className="w-4 h-4" />
                        Ver Contrato Gerado (
                        {linkedContract?.contractNumber || prop.convertedContractId})
                      </button>
                    ) : (
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
                    <a
                      href={publicUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline font-mono text-[#1e3a6e]"
                    >
                      {publicUrl.slice(0, 90)}...
                    </a>
                  </span>
                  <span className="text-emerald-800 font-bold">
                    {Array.isArray(prop.installments) && prop.installments.length > 0
                      ? `${prop.installments.length} parcela(s) configurada(s)`
                      : 'Pronto para enviar por WhatsApp / E-mail'}
                  </span>
                </div>

                <div className="overflow-x-auto border border-slate-200 rounded">
                  <table className="w-full min-w-[680px] text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b border-slate-200">
                      <tr>
                        <th className="py-2 px-3">SKU</th>
                        <th className="py-2 px-3">Item / Equipamento / Serviço</th>
                        <th className="py-2 px-3">Tipo</th>
                        <th className="py-2 px-3">Natureza Fiscal</th>
                        <th className="py-2 px-3 text-right">Qtd</th>
                        <th className="py-2 px-3 text-right">Unitário</th>
                        <th className="py-2 px-3 text-right">Desc.</th>
                        <th className="py-2 px-3 text-right">Subtotal Líquido</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {prop.items.map((item) => {
                        const isSrv =
                          item.itemType === 'SERVICE' ||
                          item.fiscalNature === 'SERVICO_TECNICO_TI_TELECOM' ||
                          item.fiscalNature === 'SERVICO_COMUNICACAO_SCM_SVA';
                        return (
                          <tr key={item.id}>
                            <td className="py-2 px-3 font-mono font-bold">{item.sku}</td>
                            <td className="py-2 px-3 font-semibold">{item.description}</td>
                            <td className="py-2 px-3">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  isSrv
                                    ? 'bg-indigo-50 text-indigo-800'
                                    : 'bg-slate-100 text-slate-800'
                                }`}
                              >
                                {isSrv ? 'Serviço' : 'Produto'}
                              </span>
                            </td>
                            <td className="py-2 px-3">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                {item.fiscalNature === 'LOCACAO_BENS_MOVEIS'
                                  ? 'Locação Pura (0% ISS - SV 31 STF)'
                                  : item.fiscalNature === 'SERVICO_COMUNICACAO_SCM_SVA'
                                    ? 'Telecom SCM / Assinatura (Mod. 62)'
                                    : item.fiscalNature === 'VENDA_EQUIPAMENTO'
                                      ? 'Venda Equipamento (CFOP 5.102)'
                                      : 'Serviço Técnico (LC 116 01.07)'}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-right">{item.quantity}</td>
                            <td className="py-2 px-3 text-right">{formatBRL(item.unitPrice)}</td>
                            <td className="py-2 px-3 text-right text-rose-600">
                              {(item.discountPercent || 0) > 0
                                ? `${item.discountPercent}%`
                                : (item.discountAmount || 0) > 0
                                  ? formatBRL(item.discountAmount || 0)
                                  : '—'}
                            </td>
                            <td className="py-2 px-3 text-right font-bold">
                              {formatBRL(item.subtotal ?? item.totalMonthly)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
      </div>
    );
  };


  const renderContractsList = () => {
    const effectiveTab: "TODOS" | "CTR_LOCACOES" | "CTR_SERVICOS" | "CTR_ASSINATURAS" | "CTR_AUXILIARES" =
      contractsSubFilter !== "TODOS"
        ? contractsSubFilter
        : activeSubId === "CTR_SERVICOS" ||
            activeSubId === "CTR_ASSINATURAS" ||
            activeSubId === "CTR_AUXILIARES" ||
            activeSubId === "CTR_LOCACOES"
          ? (activeSubId as "CTR_LOCACOES" | "CTR_SERVICOS" | "CTR_ASSINATURAS" | "CTR_AUXILIARES")
          : "TODOS";

    const locacoesList = rentalContracts.filter((c) => {
      const m = inferContractModality(c);
      return m === "LOCACAO" || m === "HIBRIDO";
    });
    const servicosList = rentalContracts.filter((c) => {
      const m = inferContractModality(c);
      return (
        m === "SERVICO" ||
        m === "HIBRIDO" ||
        c.equipments.some((e) => e.skuGestaoClick.includes("SV"))
      );
    });
    const assinaturasList = rentalContracts.filter((c) => {
      const m = inferContractModality(c);
      return (
        m === "ASSINATURA" ||
        c.equipments.some(
          (e) =>
            e.skuGestaoClick.includes("TL") ||
            e.description.toLowerCase().includes("sd-wan") ||
            e.description.toLowerCase().includes("cloud") ||
            e.description.toLowerCase().includes("sip")
        )
      );
    });

    const displayedContracts =
      effectiveTab === "CTR_LOCACOES"
        ? locacoesList
        : effectiveTab === "CTR_SERVICOS"
          ? servicosList
          : effectiveTab === "CTR_ASSINATURAS"
            ? assinaturasList
            : rentalContracts;

    const allAllocatedAssets = rentalContracts.flatMap((ctr) =>
      ctr.equipments.map((eq, eqIdx) => ({
        contract: ctr,
        equipment: eq,
        equipmentIdx: eqIdx,
        assetStatus: (eq.assetStatus || "EM_CLIENTE") as ErpAssetStatus,
        assetTag: eq.assetTag || `PAT-${ctr.contractNumber.replace(/[^0-9]/g, "")}-${eqIdx + 1}`,
      }))
    );

    const filteredAssets = allAllocatedAssets.filter((row) => {
      if (assetStatusFilter !== "TODOS" && row.assetStatus !== assetStatusFilter) {
        return false;
      }
      if (!assetSearchQuery.trim()) return true;
      const q = assetSearchQuery.toLowerCase();
      return (
        row.equipment.serialNumber.toLowerCase().includes(q) ||
        row.assetTag.toLowerCase().includes(q) ||
        row.equipment.skuGestaoClick.toLowerCase().includes(q) ||
        row.equipment.description.toLowerCase().includes(q) ||
        row.equipment.ncm.toLowerCase().includes(q) ||
        row.contract.companyName.toLowerCase().includes(q) ||
        row.contract.contractNumber.toLowerCase().includes(q)
      );
    });

    const totalPatrimonyBrl = allAllocatedAssets.reduce(
      (sum, r) => sum + Number(r.equipment.assetValueBrl || 0),
      0
    );
    const totalActiveUnits = allAllocatedAssets.reduce(
      (sum, r) => sum + Number(r.equipment.quantity || 1),
      0
    );
    const totalRemessaContracts = rentalContracts.filter((c) => Boolean(c.remessaNfeNumber)).length;
    const ipcaContractsCount = rentalContracts.filter((c) => c.readjustmentIndex === "IPCA").length;
    const igpmContractsCount = rentalContracts.filter((c) => c.readjustmentIndex === "IGP-M").length;

    return (
      <div className="space-y-4">
        <div className="bg-white rounded-md border border-slate-200 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-[10px] font-extrabold uppercase text-[#1e3a6e] block">
                Contratos &amp; Locação &gt; {effectiveTab}
              </span>
              <h2 className="text-base font-extrabold text-slate-900">
                Gestão de Contratos de Locação, Serviços Técnicos, Assinaturas &amp; Patrimônios S/N ({rentalContracts.length})
              </h2>
              <p className="text-xs text-slate-500">
                Controle de vigência, reajuste anual (IPCA / IGP-M), rastreamento de S/N em clientes, Fatura de Locação (0% ISS — SV 31 STF) e NF-e de Remessa CFOP 5.908/6.908.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowBatchBillingModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black cursor-pointer shadow-xs"
              >
                ⚡ Faturamento em Massa &amp; E-mails ({selectedContractIdsForBatch.length > 0 ? selectedContractIdsForBatch.length : rentalContracts.filter((c) => c.status !== "ENCERRADO").length})
              </button>
              <button
                type="button"
                onClick={() => openNewContractPreset("LOCACAO")}
                className="px-3 py-2 rounded bg-[#1e3a6e] hover:bg-[#162b54] text-white text-xs font-extrabold cursor-pointer"
              >
                + Novo Contrato Locação (SV 31)
              </button>
              <button
                type="button"
                onClick={() => openNewContractPreset("SERVICO")}
                className="px-3 py-2 rounded bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-extrabold cursor-pointer"
              >
                + Novo Contrato Serviços (LC 116)
              </button>
              <button
                type="button"
                onClick={() => openNewContractPreset("ASSINATURA")}
                className="px-3 py-2 rounded bg-purple-700 hover:bg-purple-800 text-white text-xs font-extrabold cursor-pointer"
              >
                + Nova Assinatura / SCM
              </button>
              <button
                type="button"
                onClick={() => setShowNewProposalModal(true)}
                className="px-3.5 py-2 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold cursor-pointer"
              >
                + Nova Proposta Comercial
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
            {[
              { id: "TODOS", label: `Todos os Contratos (${rentalContracts.length})` },
              { id: "CTR_LOCACOES", label: `Locações & Híbridos SV 31 (${locacoesList.length})` },
              { id: "CTR_SERVICOS", label: `Serviços Técnicos LC 116 (${servicosList.length})` },
              { id: "CTR_ASSINATURAS", label: `Assinaturas / Telecom SCM (${assinaturasList.length})` },
              {
                id: "CTR_AUXILIARES",
                label: `Parque Instalado, Patrimônios (S/N) & Reajustes (${allAllocatedAssets.length} S/Ns)`,
              },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setContractsSubFilter(tab.id as typeof contractsSubFilter);
                  setActiveSubId(tab.id === "TODOS" ? "CTR_LOCACOES" : tab.id);
                }}
                className={`px-3 py-1.5 rounded text-xs font-extrabold transition cursor-pointer ${
                  effectiveTab === tab.id
                    ? "bg-[#1e3a6e] text-white shadow-2xs"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {proposals.filter((p) => p.status !== "CONVERTIDA_CONTRATO" && !p.convertedContractId).length > 0 && (
          <div className="bg-amber-50/90 rounded-md border border-amber-300 p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-[10px] font-black uppercase text-amber-800 block">
                  Propostas de Locação / Serviços Prontas para Gerar Contrato
                </span>
                <h3 className="text-xs font-extrabold text-slate-900">
                  Converta orçamentos aprovados em Contratos de Locação ativos com 1 clique (preservando S/N e índice de reajuste):
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveSection("ORCAMENTOS")}
                className="text-xs font-bold text-[#1e3a6e] underline cursor-pointer"
              >
                Ver todos os orçamentos ({proposals.length}) →
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {proposals
                .filter((p) => p.status !== "CONVERTIDA_CONTRATO" && !p.convertedContractId)
                .slice(0, 4)
                .map((prop) => (
                  <div
                    key={prop.id}
                    className="bg-white rounded border border-amber-200 p-3 flex items-center justify-between gap-2 text-xs shadow-2xs"
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded bg-[#1e3a6e] text-white font-mono text-[10px] font-black">
                          {prop.code}
                        </span>
                        <span className="font-bold text-slate-900 truncate max-w-[220px]">
                          {prop.companyName}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                          {formatBRL(prop.monthlyRecurringTotal)}/mês
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 truncate max-w-xs mt-0.5">
                        {prop.title} ({prop.contractMonths}m • {prop.readjustmentIndex || "IPCA"})
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setEditingProposal(prop)}
                        className="px-2.5 py-1.5 rounded border border-slate-300 text-slate-700 text-[11px] font-bold hover:bg-slate-50 cursor-pointer"
                      >
                        ✏️ Editar
                      </button>
                      <button
                        type="button"
                        disabled={busyId === prop.id}
                        onClick={() => handleApproveProposal(prop.id)}
                        className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-extrabold cursor-pointer"
                      >
                        Gerar Contrato
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {effectiveTab === "CTR_AUXILIARES" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="bg-white p-4 rounded-md border border-slate-200 shadow-2xs">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">
                  Total Patrimônio Alocado em Clientes
                </span>
                <strong className="text-lg font-black text-slate-900">
                  {formatBRL(totalPatrimonyBrl)}
                </strong>
                <span className="text-[11px] text-emerald-700 font-semibold block">
                  Ativo Imobilizado Seta Telecom em Locação
                </span>
              </div>
              <div className="bg-white p-4 rounded-md border border-slate-200 shadow-2xs">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">
                  Equipamentos &amp; S/N Rastreáveis
                </span>
                <strong className="text-lg font-black text-indigo-950">
                  {allAllocatedAssets.length} lotes S/N ({totalActiveUnits} un.)
                </strong>
                <span className="text-[11px] text-slate-500 block">
                  {allAllocatedAssets.filter((a) => a.assetStatus === "EM_CLIENTE").length} em cliente •{" "}
                  {allAllocatedAssets.filter((a) => a.assetStatus === "MANUTENCAO_RMA").length} em RMA
                </span>
              </div>
              <div className="bg-white p-4 rounded-md border border-slate-200 shadow-2xs">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">
                  Cobertura NF-e de Remessa
                </span>
                <strong className="text-lg font-black text-emerald-800">
                  {totalRemessaContracts} / {rentalContracts.length} contratos
                </strong>
                <span className="text-[11px] text-slate-500 block">
                  CFOP 5.908 (Estadual) &amp; 6.908 (Interestadual)
                </span>
              </div>
              <div className="bg-white p-4 rounded-md border border-slate-200 shadow-2xs">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">
                  Indexadores de Reajuste Anual
                </span>
                <strong className="text-lg font-black text-[#1e3a6e]">
                  IPCA ({ipcaContractsCount}) • IGP-M ({igpmContractsCount})
                </strong>
                <span className="text-[11px] text-slate-500 block">
                  Cláusula de correção monetária 12m
                </span>
              </div>
            </div>

            <div className="bg-white rounded-md border border-slate-200 p-5 space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">
                    Inventário Geral de Parque Instalado &amp; Patrimônios por Número de Série (S/N)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Pesquise qualquer equipamento locado por S/N, Tag de Patrimônio, SKU, NCM, Cliente ou Contrato e execute substituição expressa (RMA).
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={assetSearchQuery}
                      onChange={(e) => setAssetSearchQuery(e.target.value)}
                      placeholder="Buscar por S/N, Patrimônio, Cliente, SKU..."
                      className="pl-8 pr-3 py-1.5 rounded border border-slate-300 text-xs w-64"
                    />
                  </div>
                  {(["TODOS", "EM_CLIENTE", "MANUTENCAO_RMA", "DEVOLVIDO"] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setAssetStatusFilter(st)}
                      className={`px-2.5 py-1.5 rounded text-[11px] font-bold cursor-pointer ${
                        assetStatusFilter === st
                          ? "bg-indigo-950 text-white"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      {st === "TODOS"
                        ? "Todos S/N"
                        : st === "EM_CLIENTE"
                          ? "Em Cliente"
                          : st === "MANUTENCAO_RMA"
                            ? "Em RMA"
                            : "Devolvidos"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900 text-white uppercase text-[10px]">
                    <tr>
                      <th className="py-2.5 px-3">Patrimônio / S/N</th>
                      <th className="py-2.5 px-3">SKU &amp; Equipamento</th>
                      <th className="py-2.5 px-3">NCM / CFOP</th>
                      <th className="py-2.5 px-3">Cliente &amp; Contrato</th>
                      <th className="py-2.5 px-3">Status Físico</th>
                      <th className="py-2.5 px-3 text-right">Patrimônio (R$)</th>
                      <th className="py-2.5 px-3 text-right">Locação Mensal</th>
                      <th className="py-2.5 px-3 text-right">Ações S/N</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredAssets.map((row) => (
                      <tr key={`${row.contract.id}-${row.equipment.id}`} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3">
                          <div className="font-mono font-black text-indigo-950">
                            {row.equipment.serialNumber}
                          </div>
                          <div className="font-mono text-[10px] text-slate-500">
                            Tag: {row.assetTag}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-slate-900">
                            {row.equipment.description}
                          </div>
                          <div className="font-mono text-[10px] text-slate-500">
                            SKU: {row.equipment.skuGestaoClick} • Qtd: {row.equipment.quantity}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px]">
                          <div>NCM {row.equipment.ncm}</div>
                          <div className="text-[10px] text-slate-500">
                            CFOP {row.equipment.remessaCfop} (NF {row.contract.remessaNfeNumber})
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-900">{row.contract.companyName}</div>
                          <div className="font-mono text-[11px] text-[#1e3a6e]">
                            {row.contract.contractNumber} • Reajuste {row.contract.readjustmentIndex}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                              row.assetStatus === "EM_CLIENTE"
                                ? "bg-emerald-100 text-emerald-800"
                                : row.assetStatus === "MANUTENCAO_RMA"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-slate-200 text-slate-700"
                            }`}
                          >
                            {row.assetStatus === "EM_CLIENTE"
                              ? "EM CLIENTE"
                              : row.assetStatus === "MANUTENCAO_RMA"
                                ? "MANUTENÇÃO / RMA"
                                : "DEVOLVIDO"}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-slate-800">
                          {formatBRL(row.equipment.assetValueBrl)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-black text-emerald-700">
                          {formatBRL(row.equipment.quantity * row.equipment.unitMonthlyRent)}
                        </td>
                        <td className="py-2.5 px-3 text-right space-x-1">
                          <button
                            type="button"
                            onClick={() =>
                              setRmaModal({
                                contract: row.contract,
                                equipmentIdx: row.equipmentIdx,
                                newSerialNumber: row.equipment.serialNumber,
                                newAssetTag: row.assetTag,
                                newStatus: row.assetStatus,
                              })
                            }
                            className="px-2.5 py-1 rounded bg-indigo-950 hover:bg-indigo-900 text-white text-[11px] font-bold cursor-pointer"
                          >
                            🔄 Substituir S/N (RMA)
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingContract(row.contract)}
                            className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold cursor-pointer"
                          >
                            ✏️ Contrato
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-md border border-slate-200 overflow-hidden shadow-xs">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-extrabold text-[#0d2b4e]">
                Listagem de Contratos ({displayedContracts.length}) — Clique na Lupa para Consultar ou no Lápis para Editar (Renovação de Vigência, Faturamento, Reajuste e S/N estão organizados em abas dentro do contrato)
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-left text-xs">
                <thead className="bg-[#1e3a6e] text-white uppercase text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3 w-8">Sel.</th>
                    <th className="py-2.5 px-3">Nº Contrato</th>
                    <th className="py-2.5 px-3">Cliente / Locatária &amp; CNPJ</th>
                    <th className="py-2.5 px-3">Objeto &amp; Modalidade</th>
                    <th className="py-2.5 px-3">Vigência &amp; Prazo</th>
                    <th className="py-2.5 px-3">Índice</th>
                    <th className="py-2.5 px-3">Situação</th>
                    <th className="py-2.5 px-3 text-right">Mensalidade (MRR)</th>
                    <th className="py-2.5 px-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {displayedContracts.map((ctr) => {
                    const modality = inferContractModality(ctr);
                    const modalityMeta = getModalityBadgeMeta(modality);
                    const statusMeta = getContractStatusBadgeMeta(ctr.status);
                    const validityInfo = computeContractValidityInfo(ctr.endDate, ctr.status);
                    const isChecked = selectedContractIdsForBatch.includes(ctr.id);

                    return (
                      <tr
                        key={ctr.id}
                        onClick={() => {
                          setEditingContractReadOnly(false);
                          setEditingContractTab('DADOS_GERAIS');
                          setEditingContract(ctr);
                        }}
                        className={`cursor-pointer transition ${
                          isChecked ? 'bg-blue-50/80 hover:bg-blue-100/60' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedContractIdsForBatch((prev) => [...prev, ctr.id]);
                              } else {
                                setSelectedContractIdsForBatch((prev) =>
                                  prev.filter((id) => id !== ctr.id)
                                );
                              }
                            }}
                            className="w-4 h-4 accent-[#1e3a6e] cursor-pointer"
                          />
                        </td>
                        <td className="py-2.5 px-3 font-mono font-black text-[#1e3a6e]">
                          {ctr.contractNumber}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-900">{ctr.companyName}</div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {ctr.companyCnpj || '—'}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-slate-800 truncate max-w-xs">
                            {ctr.title}
                          </div>
                          <span className={`inline-block mt-0.5 px-2 py-0.2 rounded text-[10px] font-bold ${modalityMeta.cls}`}>
                            {modalityMeta.label}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-[11px]">
                          <div className="font-semibold text-slate-800">
                            {ctr.startDate} até {ctr.endDate}
                          </div>
                          <span className={`inline-block mt-0.5 px-1.5 py-0.2 rounded text-[10px] font-bold ${validityInfo.cls}`}>
                            {ctr.contractMonths}m • {validityInfo.label}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-900 border border-indigo-200 text-[10px] font-extrabold">
                            {ctr.readjustmentIndex}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${statusMeta.cls}`}>
                            {statusMeta.label}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="font-black text-emerald-700">
                            {formatBRL(ctr.monthlyValue)}/mês
                          </div>
                          <div className="text-[10px] text-slate-500">
                            TCV: {formatBRL(ctr.monthlyValue * ctr.contractMonths)}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              title="Consultar / Visualizar Contrato (6 Abas)"
                              aria-label="Consultar Cadastro"
                              onClick={() => {
                                setEditingContractReadOnly(true);
                                setEditingContractTab('DADOS_GERAIS');
                                setEditingContract(ctr);
                              }}
                              className="inline-flex items-center justify-center p-2 rounded-md bg-slate-100 hover:bg-slate-200 text-[#0d2b4e] border border-slate-300 transition shadow-2xs cursor-pointer"
                            >
                              <Search className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Editar Contrato / Renovar Vigência / Faturar / Reajustar"
                              aria-label="Editar Cadastro"
                              onClick={() => {
                                setEditingContractReadOnly(false);
                                setEditingContractTab('DADOS_GERAIS');
                                setEditingContract(ctr);
                              }}
                              className="inline-flex items-center justify-center p-2 rounded-md bg-[#0d2b4e] hover:bg-[#1e3a6e] text-white transition shadow-2xs cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5 text-[#ff7a59]" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  const purchaseOrderEditorFields: GenericFieldSpec[] = [
    { key: "code", label: "Código da Compra (#)" },
    { key: "nfeNumber", label: "Nº da NF-e de Entrada *" },
    { key: "supplierName", label: "Fornecedor / Fabricante *" },
    { key: "supplierCnpj", label: "CNPJ do Fornecedor" },
    {
      key: "cfopEntrada",
      label: "CFOP de Entrada / Enquadramento",
      type: "select",
      options: [
        "1.551 — Compra de bem para o Ativo Imobilizado (Parque de Locação)",
        "2.551 — Compra interestadual de bem para o Ativo Imobilizado",
        "1.102 — Compra para comercialização / revenda de hardware",
        "2.102 — Compra interestadual para comercialização",
        "1.556 — Compra de material para uso ou consumo operacional",
      ],
    },
    { key: "itemsSummary", label: "Equipamentos / Mercadorias Adquiridas" },
    { key: "costCenter", label: "Centro de Custo" },
    { key: "issueDate", label: "Data de Emissão (DD/MM/AAAA)" },
    {
      key: "status",
      label: "Situação Fiscal",
      type: "select",
      options: ["Confirmada", "Escriturada SPED", "Em conferência", "Cancelada"],
    },
    { key: "icmsCreditAmount", label: "Crédito ICMS Destacado (R$)", type: "number" },
    { key: "pisCofinsCreditAmount", label: "Crédito PIS/COFINS (R$)", type: "number" },
    { key: "totalAmount", label: "Valor Total da NF-e (R$) *", type: "number" },
    { key: "nfeAccessKey", label: "Chave de Acesso NF-e (44 dígitos)" },
  ];

  const renderPurchasesTable = (breadcrumbLabel: string) => {
    const totalComprasVal = purchaseOrders.reduce((s, p) => s + Number(p.totalAmount || 0), 0);
    const totalIcmsCred = purchaseOrders.reduce(
      (s, p) => s + Number(p.icmsCreditAmount ?? Math.round(Number(p.totalAmount || 0) * 0.18 * 100) / 100),
      0
    );
    const totalPisCofinsCred = purchaseOrders.reduce(
      (s, p) => s + Number(p.pisCofinsCreditAmount ?? Math.round(Number(p.totalAmount || 0) * 0.0365 * 100) / 100),
      0
    );

    return (
      <div className="bg-white rounded-md border border-slate-200 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-[10px] font-extrabold uppercase text-[#1e3a6e] block">
              {breadcrumbLabel}
            </span>
            <h2 className="text-base font-extrabold text-slate-900">
              Notas Fiscais de Compras &amp; Entrada de Ativo Imobilizado ({purchaseOrders.length})
            </h2>
            <p className="text-xs text-slate-500">
              Escrituração de NF-e de entrada de fornecedores: CAPEX Parque de Locação (CFOP 1.551 / 2.551) e Revenda de Hardware (CFOP 1.102).
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              openCollectionEditor(
                "purchaseOrders",
                "Nova Nota Fiscal de Compra / Entrada (NF-e)",
                {
                  id: `po-${Date.now()}`,
                  code: String(38 + purchaseOrders.length),
                  nfeNumber: `000.010.${100 + purchaseOrders.length}`,
                  supplierName: "",
                  supplierCnpj: "",
                  cfopEntrada: "1.551 — Compra de bem para o Ativo Imobilizado (Parque de Locação)",
                  fiscalNature: "",
                  itemsSummary: "",
                  costCenter: "",
                  issueDate: new Date().toLocaleDateString("pt-BR"),
                  status: "Em cotação",
                  icmsCreditAmount: 0,
                  pisCofinsCreditAmount: 0,
                  totalAmount: 0,
                  nfeAccessKey: "",
                },
                purchaseOrderEditorFields
              )
            }
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold cursor-pointer shadow-xs"
          >
            <Plus className="w-4 h-4" /> + Nova Nota de Compra (NF-e Entrada)
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="p-3.5 rounded border border-slate-200 bg-slate-50">
            <span className="text-[10px] font-bold uppercase text-slate-500 block">Total NF-e de Compras</span>
            <strong className="text-base font-black text-slate-900">{formatBRL(totalComprasVal)}</strong>
            <span className="text-[11px] text-slate-500 block">{purchaseOrders.length} notas escrituradas</span>
          </div>
          <div className="p-3.5 rounded border border-indigo-200 bg-indigo-50/60">
            <span className="text-[10px] font-bold uppercase text-indigo-700 block">Ativo Imobilizado Locação</span>
            <strong className="text-base font-black text-indigo-900">CFOP 1.551 / 2.551</strong>
            <span className="text-[11px] text-indigo-700 block">CAPEX Seta Telecom</span>
          </div>
          <div className="p-3.5 rounded border border-emerald-200 bg-emerald-50/60">
            <span className="text-[10px] font-bold uppercase text-emerald-700 block">ICMS Destacado nas Entradas</span>
            <strong className="text-base font-black text-emerald-900">{formatBRL(totalIcmsCred)}</strong>
            <span className="text-[11px] text-emerald-700 block">CIAP / Crédito Fiscal ICMS</span>
          </div>
          <div className="p-3.5 rounded border border-amber-200 bg-amber-50/60">
            <span className="text-[10px] font-bold uppercase text-amber-800 block">PIS/COFINS s/ Aquisições</span>
            <strong className="text-base font-black text-amber-900">{formatBRL(totalPisCofinsCred)}</strong>
            <span className="text-[11px] text-amber-800 block">Base de insumos / ativo</span>
          </div>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b">
              <tr>
                <th className="py-2.5 px-3">Compra / NF-e</th>
                <th className="py-2.5 px-3">Fornecedor &amp; CNPJ</th>
                <th className="py-2.5 px-3">CFOP de Entrada &amp; Centro de Custo</th>
                <th className="py-2.5 px-3">Itens / Equipamentos Adquiridos</th>
                <th className="py-2.5 px-3 text-right">ICMS / PIS-COFINS</th>
                <th className="py-2.5 px-3 text-right">Valor Total</th>
                <th className="py-2.5 px-3">Situação</th>
                <th className="py-2.5 px-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {purchaseOrders.map((po) => {
                const icmsVal = po.icmsCreditAmount ?? Math.round(Number(po.totalAmount || 0) * 0.18 * 100) / 100;
                const pisCofinsVal = po.pisCofinsCreditAmount ?? Math.round(Number(po.totalAmount || 0) * 0.0365 * 100) / 100;
                return (
                  <tr key={po.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3">
                      <div className="font-mono font-black text-[#1e3a6e]">#{po.code}</div>
                      <div className="font-mono text-[11px] text-slate-600">NF-e {po.nfeNumber}</div>
                      <div className="text-[10px] text-slate-400">{po.issueDate}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-bold text-slate-900">{po.supplierName}</div>
                      <div className="font-mono text-[11px] text-slate-500">CNPJ: {po.supplierCnpj || "68.993.641/0008-02"}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="inline-block px-2 py-0.5 rounded bg-indigo-50 text-indigo-900 border border-indigo-200 font-mono text-[10px] font-bold">
                        {po.cfopEntrada || "1.551 — Ativo Imobilizado (Locação)"}
                      </span>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {po.costCenter || "CC-201 • CAPEX Ativos para Locação"}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 max-w-xs">
                      <div className="font-medium text-slate-800">
                        {po.itemsSummary || "Equipamentos de Telecomunicações, PABX IP & Terminais Gigabit"}
                      </div>
                      {po.nfeAccessKey && (
                        <div className="font-mono text-[10px] text-slate-400 truncate" title={po.nfeAccessKey}>
                          Chave: {po.nfeAccessKey}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-[11px]">
                      <div className="text-emerald-700 font-bold">ICMS: {formatBRL(icmsVal)}</div>
                      <div className="text-slate-500">PIS/COF: {formatBRL(pisCofinsVal)}</div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-black text-slate-900">
                      {formatBRL(po.totalAmount)}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-extrabold">
                        {po.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap space-x-1">
                      <button
                        type="button"
                        onClick={async () => {
                          const targetCat = catalog[0];
                          if (targetCat) {
                            const updatedStock = Number(targetCat.stockAvailable || 0) + 5;
                            const catRes = await fetch(`/api/erp/catalog/${encodeURIComponent(targetCat.id)}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ stockAvailable: updatedStock }),
                            });
                            if (catRes.ok) {
                              const catData = (await catRes.json())?.data;
                              if (catData) recordUpsertedCatalogItem(catData);
                            }
                          }
                          const updatedPo: ErpPurchaseOrder = {
                            ...po,
                            status: "NF-e Recebida no Estoque",
                          };
                          const poRes = await fetch("/api/erp/records/purchaseOrders", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(updatedPo),
                          });
                          if (poRes.ok) {
                            const savedPo = (await poRes.json())?.data || updatedPo;
                            recordUpsertedPurchaseOrder(savedPo);
                          }
                          onShowToast(`NF-e ${po.nfeNumber} (#${po.code}) recebida no Almoxarifado! Saldo de estoque atualizado (+5 un).`);
                          await onRefresh();
                        }}
                        className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-extrabold cursor-pointer"
                        title="Confirmar recebimento físico da NF-e e incrementar saldo no catálogo"
                      >
                        📦 Receber no Estoque
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedPurchaseForPrint(po)}
                        className="px-2.5 py-1 rounded bg-slate-900 text-white text-[11px] font-bold cursor-pointer"
                        title="Visualizar Espelho da NF-e de Entrada"
                      >
                        <Printer className="w-3 h-3 inline mr-1" /> Espelho
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          openCollectionEditor(
                            "purchaseOrders",
                            `Editar Nota de Compra #${po.code} (NF-e ${po.nfeNumber})`,
                            po as unknown as Record<string, unknown>,
                            purchaseOrderEditorFields
                          )
                        }
                        className="px-2.5 py-1 rounded bg-amber-500 text-white text-[11px] font-bold cursor-pointer"
                      >
                        ✏️ Editar
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleDeleteCollectionRecord("purchaseOrders", po.id, `Nota de Compra #${po.code}`)
                        }
                        className="px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 text-[11px] font-bold cursor-pointer"
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const getDocTypeBadge = (docType: ErpFiscalDocumentType) => {
    switch (docType) {
      case "FATURA_LOCACAO":
        return {
          label: "FATURA DE LOCAÇÃO (0% ISS — SV 31 STF)",
          className: "bg-emerald-100 text-emerald-900 border border-emerald-300",
        };
      case "NFSE_SERVICO":
        return {
          label: "NFS-e SERVIÇO (LC 116 01.07 • IRRF 1,5% + CSRF 4,65%)",
          className: "bg-blue-100 text-blue-900 border border-blue-300",
        };
      case "NFE_REMESSA_LOCACAO":
        return {
          label: "NF-e REMESSA EM LOCAÇÃO (CFOP 5.908 / 6.908)",
          className: "bg-indigo-100 text-indigo-900 border border-indigo-300",
        };
      case "NFE_VENDA_PRODUTO":
        return {
          label: "NF-e VENDA DE PRODUTO (MOD. 55 • CFOP 5.102)",
          className: "bg-amber-100 text-amber-900 border border-amber-300",
        };
      case "NFCE_CONSUMIDOR":
        return {
          label: "NFC-e CONSUMIDOR FINAL (MOD. 65 • BALCÃO)",
          className: "bg-purple-100 text-purple-900 border border-purple-300",
        };
      case "NFCOM_TELECOM":
        return {
          label: "NFCom TELECOM (MOD. 62 • CFOP 5.303 SCM)",
          className: "bg-cyan-100 text-cyan-900 border border-cyan-300",
        };
    }
  };

  const renderInvoicesList = () => {
    const effectiveFiscalTab =
      activeSubId === "FIS_PRODUTOS" ||
      activeSubId === "FIS_SERVICOS" ||
      activeSubId === "FIS_CONSUMIDOR" ||
      activeSubId === "FIS_COMPRAS" ||
      activeSubId === "FIS_AUXILIARES" ||
      activeSubId === "FIS_TODOS"
        ? activeSubId
        : "FIS_PRODUTOS";

    const countProdutos = invoices.filter((i) =>
      ["NFE_VENDA_PRODUTO", "NFE_REMESSA_LOCACAO", "NFCOM_TELECOM"].includes(i.documentType)
    ).length;
    const countServicos = invoices.filter((i) =>
      ["NFSE_SERVICO", "FATURA_LOCACAO"].includes(i.documentType)
    ).length;
    const countConsumidor = invoices.filter((i) => i.documentType === "NFCE_CONSUMIDOR").length;

    let filteredInvoices = invoices;
    if (effectiveFiscalTab === "FIS_PRODUTOS") {
      filteredInvoices = invoices.filter((i) => {
        if (!["NFE_VENDA_PRODUTO", "NFE_REMESSA_LOCACAO", "NFCOM_TELECOM"].includes(i.documentType)) {
          return false;
        }
        if (produtosSubFilter !== "TODOS" && i.documentType !== produtosSubFilter) {
          return false;
        }
        return true;
      });
    } else if (effectiveFiscalTab === "FIS_SERVICOS") {
      filteredInvoices = invoices.filter((i) => {
        if (!["NFSE_SERVICO", "FATURA_LOCACAO"].includes(i.documentType)) {
          return false;
        }
        if (servicosSubFilter !== "TODOS" && i.documentType !== servicosSubFilter) {
          return false;
        }
        return true;
      });
    } else if (effectiveFiscalTab === "FIS_CONSUMIDOR") {
      filteredInvoices = invoices.filter((i) => i.documentType === "NFCE_CONSUMIDOR");
    }

    const totalLocacaoGross = invoices
      .filter((i) => i.documentType === "FATURA_LOCACAO")
      .reduce((s, i) => s + i.grossAmount, 0);
    const totalNfseGross = invoices
      .filter((i) => i.documentType === "NFSE_SERVICO")
      .reduce((s, i) => s + i.grossAmount, 0);
    const totalIrrfWithheld = invoices
      .filter((i) => i.documentType === "NFSE_SERVICO")
      .reduce((s, i) => s + (i.taxBreakdown.irrfWithheldAmount || 0), 0);
    const totalCsrfWithheld = invoices
      .filter((i) => i.documentType === "NFSE_SERVICO")
      .reduce((s, i) => s + (i.taxBreakdown.csrfWithheldAmount || 0), 0);

    return (
      <div className="space-y-4">
        {/* BARRA SUPERIOR DE SUB-ABAS DO MÓDULO FISCAL (SINCRONIZADA COM SIDEBAR) */}
        <div className="bg-white rounded-md border border-slate-200 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-[10px] font-extrabold uppercase text-[#1e3a6e] block">
                Módulo Fiscal &amp; Tributário Seta Telecom • Regime: {gestaoClickConfig.taxRegime}
              </span>
              <h2 className="text-base font-extrabold text-slate-900">
                Central Fiscal GestãoClick — NF-e Produtos, Remessa CFOP 5.908, NFS-e, Locação SV 31 STF &amp; Compras
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => openNewInvoiceWithPreset("FATURA_LOCACAO")}
                className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold cursor-pointer"
              >
                + Fatura Locação (0% ISS)
              </button>
              <button
                type="button"
                onClick={() => openNewInvoiceWithPreset("NFSE_SERVICO")}
                className="px-3 py-2 rounded bg-[#1e3a6e] hover:bg-[#162b54] text-white text-xs font-extrabold cursor-pointer"
              >
                + Emitir NFS-e Serviço
              </button>
              <button
                type="button"
                onClick={() => openNewInvoiceWithPreset("NFE_VENDA_PRODUTO")}
                className="px-3.5 py-2 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold cursor-pointer"
              >
                + Emitir NF-e / NFC-e
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
            {[
              { id: "FIS_PRODUTOS", label: `Notas de Produtos (${countProdutos})` },
              { id: "FIS_SERVICOS", label: `Notas de Serviços & Faturas Locação (${countServicos})` },
              { id: "FIS_CONSUMIDOR", label: `Notas do Consumidor NFC-e (${countConsumidor})` },
              { id: "FIS_COMPRAS", label: `Notas de Compras / Entrada (${purchaseOrders.length})` },
              { id: "FIS_AUXILIARES", label: "Opções Auxiliares & Tabelas CFOP/ISS" },
              { id: "FIS_TODOS", label: `Todos os Documentos (${invoices.length})` },
            ].map((tabItem) => (
              <button
                key={tabItem.id}
                type="button"
                onClick={() => setActiveSubId(tabItem.id)}
                className={`px-3 py-1.5 rounded text-xs font-extrabold transition cursor-pointer ${
                  effectiveFiscalTab === tabItem.id
                    ? "bg-[#1e3a6e] text-white shadow-2xs"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {tabItem.label}
              </button>
            ))}
          </div>
        </div>

        {/* SUB-ABA 1: NOTAS DE PRODUTOS (NF-e Venda 5.102 + NF-e Remessa Locação 5.908/6.908 + NFCom) */}
        {effectiveFiscalTab === "FIS_PRODUTOS" && (
          <div className="bg-white rounded-md border border-slate-200 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">
                  Fiscal &gt; Notas de Produtos (NF-e Modelo 55 — Venda CFOP 5.102/6.102 &amp; Remessa em Locação CFOP 5.908/6.908)
                </h3>
                <p className="text-xs text-slate-500">
                  Remessas de locação circulam com suspensão/não-incidência de ICMS (CST 041) e PIS/COFINS (CST 08). Vendas de equipamentos destacam ICMS 18% e PIS/COFINS 3,65%.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => openNewInvoiceWithPreset("NFE_VENDA_PRODUTO", "5.102 — Venda de mercadoria adquirida ou recebida de terceiros")}
                  className="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold cursor-pointer"
                >
                  + Emitir NF-e Venda (CFOP 5.102)
                </button>
                <button
                  type="button"
                  onClick={() => openNewInvoiceWithPreset("NFE_REMESSA_LOCACAO", "5.908 — Remessa de bem por conta de contrato de locação")}
                  className="px-3 py-1.5 rounded bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-extrabold cursor-pointer"
                >
                  + Emitir NF-e Remessa Locação (CFOP 5.908 / 6.908)
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { id: "TODOS", label: "Todas NF-e de Produtos" },
                { id: "NFE_VENDA_PRODUTO", label: "NF-e Venda de Equipamentos (CFOP 5.102 / 6.102)" },
                { id: "NFE_REMESSA_LOCACAO", label: "NF-e Remessa em Locação (CFOP 5.908 / 6.908)" },
                { id: "NFCOM_TELECOM", label: "NFCom Telecom Mod. 62 (CFOP 5.303)" },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setProdutosSubFilter(f.id as typeof produtosSubFilter)}
                  className={`px-2.5 py-1 rounded text-[11px] font-bold cursor-pointer ${
                    produtosSubFilter === f.id
                      ? "bg-indigo-950 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* SUB-ABA 2: NOTAS DE SERVIÇOS & FATURAS DE LOCAÇÃO (NFS-e Retenções IRRF 1,5% + CSRF 4,65% e Locação 0% ISS) */}
        {effectiveFiscalTab === "FIS_SERVICOS" && (
          <div className="bg-white rounded-md border border-slate-200 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">
                  Fiscal &gt; Notas de Serviços (NFS-e LC 116 Item 01.07) &amp; Faturas de Locação (0% ISS — Súmula Vinculante 31 STF)
                </h3>
                <p className="text-xs text-slate-500">
                  Segregação tributária automática: Locação Pura de Bens Móveis com dispensa de ISSQN (Veto 3.01 LC 116/03 + SV 31 STF) e Serviços Técnicos com retenção automática de IRRF (1,5%) e CSRF (4,65% — PIS 0,65% + COFINS 3,0% + CSLL 1,0%).
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => openNewInvoiceWithPreset("FATURA_LOCACAO")}
                  className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold cursor-pointer"
                >
                  + Emitir Fatura de Locação (0% ISS)
                </button>
                <button
                  type="button"
                  onClick={() => openNewInvoiceWithPreset("NFSE_SERVICO")}
                  className="px-3 py-1.5 rounded bg-[#1e3a6e] hover:bg-[#162b54] text-white text-xs font-extrabold cursor-pointer"
                >
                  + Emitir NFS-e (Ret. IRRF 1,5% + CSRF 4,65%)
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 text-xs">
              <div className="p-3 rounded border border-emerald-200 bg-emerald-50/70">
                <span className="text-[10px] font-bold uppercase text-emerald-800 block">Faturas Locação (0% ISS)</span>
                <strong className="text-sm font-black text-emerald-950">{formatBRL(totalLocacaoGross)}</strong>
                <span className="text-[10px] text-emerald-700 block">Súmula Vinculante 31 STF</span>
              </div>
              <div className="p-3 rounded border border-emerald-200 bg-emerald-50/40">
                <span className="text-[10px] font-bold uppercase text-emerald-800 block">Economia Real de ISSQN</span>
                <strong className="text-sm font-black text-emerald-700">{formatBRL(kpis.issSavedBySv31Stf)}</strong>
                <span className="text-[10px] text-emerald-700 block">Veto Item 3.01 LC 116/2003</span>
              </div>
              <div className="p-3 rounded border border-blue-200 bg-blue-50/60">
                <span className="text-[10px] font-bold uppercase text-blue-800 block">Faturamento NFS-e Serviços</span>
                <strong className="text-sm font-black text-blue-950">{formatBRL(totalNfseGross)}</strong>
                <span className="text-[10px] text-blue-700 block">ISS Municipal {gestaoClickConfig.defaultIssRatePercent}% (Item 01.07)</span>
              </div>
              <div className="p-3 rounded border border-amber-200 bg-amber-50/60">
                <span className="text-[10px] font-bold uppercase text-amber-900 block">Retenções Federais (NFS-e)</span>
                <strong className="text-sm font-black text-amber-950">
                  {formatBRL(totalIrrfWithheld + totalCsrfWithheld)}
                </strong>
                <span className="text-[10px] text-amber-800 block">
                  IRRF 1,5%: {formatBRL(totalIrrfWithheld)} | CSRF 4,65%: {formatBRL(totalCsrfWithheld)}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { id: "TODOS", label: "Todos (Faturas de Locação + NFS-e Serviços)" },
                { id: "FATURA_LOCACAO", label: "Apenas Faturas de Locação (0% ISS — SV 31 STF)" },
                { id: "NFSE_SERVICO", label: "Apenas NFS-e Serviços (IRRF 1,5% + CSRF 4,65%)" },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setServicosSubFilter(f.id as typeof servicosSubFilter)}
                  className={`px-2.5 py-1 rounded text-[11px] font-bold cursor-pointer ${
                    servicosSubFilter === f.id
                      ? "bg-[#1e3a6e] text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* SUB-ABA 3: NOTAS DO CONSUMIDOR (NFC-e Modelo 65) */}
        {effectiveFiscalTab === "FIS_CONSUMIDOR" && (
          <div className="bg-white rounded-md border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900">
                Fiscal &gt; Notas do Consumidor (NFC-e Modelo 65 — Venda Balcão / PDV Matriz #118887)
              </h3>
              <p className="text-xs text-slate-500">
                Emissão instantânea de DANFE NFC-e (Ajuste SINIEF 19/16, CFOP 5.102) para vendas presenciais de cabos, fontes PoE, headsets e acessórios com cálculo IBPT (Lei 12.741/2012).
              </p>
            </div>
            <button
              type="button"
              onClick={() => openNewInvoiceWithPreset("NFCE_CONSUMIDOR")}
              className="px-4 py-2 rounded bg-purple-700 hover:bg-purple-800 text-white text-xs font-extrabold cursor-pointer"
            >
              + Emitir NFC-e Consumidor (Mod. 65)
            </button>
          </div>
        )}

        {/* SUB-ABA 4: NOTAS DE COMPRAS / ENTRADA */}
        {effectiveFiscalTab === "FIS_COMPRAS" && renderPurchasesTable("Fiscal > Notas de Compras / Entrada")}

        {/* SUB-ABA 5: OPÇÕES AUXILIARES & PARÂMETROS TRIBUTÁRIOS */}
        {effectiveFiscalTab === "FIS_AUXILIARES" && (
          <div className="bg-white rounded-md border border-slate-200 p-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
              <div>
                <span className="text-[10px] font-extrabold uppercase text-[#1e3a6e] block">
                  Fiscal &gt; Opções Auxiliares &amp; Regras Tributárias
                </span>
                <h3 className="text-base font-extrabold text-slate-900">
                  Parâmetros Fiscais &amp; Matriz CFOP / LC 116 / Súmula Vinculante 31 STF — {gestaoClickConfig.companyLegalName}
                </h3>
                <p className="text-xs text-slate-500">
                  CNPJ: {gestaoClickConfig.companyCnpj} • IM: {gestaoClickConfig.municipalRegistration} • IE: {gestaoClickConfig.stateRegistration}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={gestaoClickConfig.taxRegime}
                  onChange={(e) => handleChangeTaxRegime(e.target.value as ErpTaxRegime)}
                  className="px-3 py-2 rounded border border-slate-300 text-xs font-bold bg-white"
                >
                  <option value="LUCRO_PRESUMIDO">Regime: Lucro Presumido (Padrão Seta Telecom)</option>
                  <option value="LUCRO_REAL">Regime: Lucro Real (Não-Cumulativo)</option>
                  <option value="SIMPLES_NACIONAL">Regime: Simples Nacional</option>
                </select>
                <button
                  type="button"
                  onClick={() =>
                    setGenericModal({
                      title: "Configurar Parâmetros Fiscais & Tributários — Seta Telecom",
                      initialValues: {
                        companyLegalName: gestaoClickConfig.companyLegalName,
                        companyCnpj: gestaoClickConfig.companyCnpj,
                        municipalRegistration: gestaoClickConfig.municipalRegistration,
                        stateRegistration: gestaoClickConfig.stateRegistration,
                        defaultIssRatePercent: gestaoClickConfig.defaultIssRatePercent,
                      },
                      fields: [
                        { key: "companyLegalName", label: "Razão Social" },
                        { key: "companyCnpj", label: "CNPJ Matriz" },
                        { key: "municipalRegistration", label: "Inscrição Municipal (CCM)" },
                        { key: "stateRegistration", label: "Inscrição Estadual (IE)" },
                        { key: "defaultIssRatePercent", label: "Alíquota ISSQN Padrão (%) - Serviços LC 116", type: "number" },
                      ],
                      onSave: async (vals) => {
                        await fetch("/api/erp/gestaoclick/config", {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify(vals),
                        });
                        setGenericModal(null);
                        onShowToast("Parâmetros fiscais e alíquota de ISS atualizados!");
                        await onRefresh();
                      },
                    })
                  }
                  className="px-3.5 py-2 rounded bg-amber-500 hover:bg-amber-600 text-white text-xs font-extrabold cursor-pointer"
                >
                  ✏️ Editar Parâmetros Fiscais
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="p-4 rounded border border-emerald-200 bg-emerald-50/70 space-y-1">
                <div className="font-extrabold text-emerald-950 uppercase text-[11px]">
                  1. Locação Pura de Bens Móveis (0% ISS)
                </div>
                <p className="text-emerald-900">
                  <strong>Base Legal:</strong> Veto Presidencial ao item 3.01 da LC 116/2003 + Súmula Vinculante nº 31 do STF + Lei 8.846/1994 art. 1º.
                </p>
                <p className="text-emerald-800 text-[11px]">
                  • ISSQN: <strong>0,00% (Não Incidência)</strong><br />
                  • Retenção IRRF / CSRF: <strong>0,00% (IN RFB 1.234/12)</strong><br />
                  • PIS (0,65%) + COFINS (3,00%) Cumulativo
                </p>
              </div>

              <div className="p-4 rounded border border-blue-200 bg-blue-50/70 space-y-1">
                <div className="font-extrabold text-blue-950 uppercase text-[11px]">
                  2. Serviços Técnicos TI / NOC (NFS-e)
                </div>
                <p className="text-blue-900">
                  <strong>Base Legal:</strong> LC 116/2003 Item 01.07 (Suporte técnico, instalação, configuração e manutenção) e Art. 30/31 da Lei 10.833/2003.
                </p>
                <p className="text-blue-800 text-[11px]">
                  • ISSQN Municipal: <strong>{gestaoClickConfig.defaultIssRatePercent}%</strong><br />
                  • IRRF Retido na Fonte: <strong>1,50%</strong> (dispensa &lt; R$ 10,00)<br />
                  • CSRF Retida na Fonte: <strong>4,65%</strong> (PIS 0,65% + COFINS 3% + CSLL 1% p/ NF &gt; R$ 215,05)
                </p>
              </div>

              <div className="p-4 rounded border border-indigo-200 bg-indigo-50/70 space-y-1">
                <div className="font-extrabold text-indigo-950 uppercase text-[11px]">
                  3. Circulação de Equipamentos (NF-e Mod. 55)
                </div>
                <p className="text-indigo-900">
                  <strong>Base Legal:</strong> Art. 7º, IX do RICMS/SP (Remessa de Locação) e Tributação Comercial de Revenda.
                </p>
                <p className="text-indigo-800 text-[11px]">
                  • Remessa Locação: <strong>CFOP 5.908 / 6.908</strong> (CST ICMS 041 / PIS-COFINS 08 — R$ 0 impostos)<br />
                  • Venda Equipamento: <strong>CFOP 5.102 / 6.102</strong> (ICMS 18% SP, IRPJ 1,20%, CSLL 1,08%)
                </p>
              </div>
            </div>

            <div className="border border-slate-200 rounded overflow-hidden">
              <div className="bg-slate-900 text-white px-4 py-2.5 text-xs font-extrabold">
                Tabela Oficial de CFOPs e Naturezas de Operação — Seta Telecom (GestãoClick #118887)
              </div>
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b">
                  <tr>
                    <th className="py-2 px-3">CFOP</th>
                    <th className="py-2 px-3">Espécie</th>
                    <th className="py-2 px-3">Natureza da Operação</th>
                    <th className="py-2 px-3">CST ICMS / ISS</th>
                    <th className="py-2 px-3">CST PIS/COFINS</th>
                    <th className="py-2 px-3">Impacto Financeiro</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr>
                    <td className="py-2 px-3 font-mono font-black text-indigo-800">5.908 / 6.908</td>
                    <td className="py-2 px-3 font-bold">NF-e Mod. 55</td>
                    <td className="py-2 px-3">Remessa de bem por conta de contrato de locação</td>
                    <td className="py-2 px-3">CST 041 (Não tributada)</td>
                    <td className="py-2 px-3">CST 08 (Sem incidência)</td>
                    <td className="py-2 px-3 text-slate-600">Transporte Patrimonial (Sem cobrança)</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-mono font-black text-emerald-800">N/A (SV 31 STF)</td>
                    <td className="py-2 px-3 font-bold">Fatura Locação</td>
                    <td className="py-2 px-3">Locação pura de bens móveis (Dispensa NFS-e — LC 116/03)</td>
                    <td className="py-2 px-3">0% ISSQN (SV 31 STF)</td>
                    <td className="py-2 px-3">CST 01 (0,65% / 3,00%)</td>
                    <td className="py-2 px-3 text-emerald-700 font-bold">Gera Contas a Receber MRR (100% Líquido)</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-mono font-black text-blue-800">5.933 / 6.933</td>
                    <td className="py-2 px-3 font-bold">NFS-e Nacional</td>
                    <td className="py-2 px-3">Prestação de serviço técnico TI/Telecom (LC 116 Item 01.07)</td>
                    <td className="py-2 px-3">ISS {gestaoClickConfig.defaultIssRatePercent}%</td>
                    <td className="py-2 px-3">Ret. IRRF 1,5% + CSRF 4,65%</td>
                    <td className="py-2 px-3 text-blue-700 font-bold">Gera Recebível Líquido (Bruto - 6,15%)</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-mono font-black text-amber-800">5.102 / 6.102</td>
                    <td className="py-2 px-3 font-bold">NF-e / NFC-e</td>
                    <td className="py-2 px-3">Venda de mercadoria/equipamento adquirido de terceiros</td>
                    <td className="py-2 px-3">CST 000 (ICMS 18% / 12%)</td>
                    <td className="py-2 px-3">CST 01 (0,65% / 3,00%)</td>
                    <td className="py-2 px-3 text-amber-800 font-bold">Gera Contas a Receber Venda</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-mono font-black text-purple-800">1.551 / 2.551</td>
                    <td className="py-2 px-3 font-bold">NF-e Entrada</td>
                    <td className="py-2 px-3">Compra de bem para o Ativo Imobilizado (Parque de Locação)</td>
                    <td className="py-2 px-3">Crédito CIAP / ICMS</td>
                    <td className="py-2 px-3">CST 50 / 70 Entrada</td>
                    <td className="py-2 px-3 text-rose-700 font-bold">CAPEX Contas a Pagar Fornecedor</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-mono font-black text-slate-800">1.102 / 2.102</td>
                    <td className="py-2 px-3 font-bold">NF-e Entrada</td>
                    <td className="py-2 px-3">Compra de mercadoria para comercialização / revenda</td>
                    <td className="py-2 px-3">Crédito ICMS 18%</td>
                    <td className="py-2 px-3">CST 50 / 70 Entrada</td>
                    <td className="py-2 px-3 text-rose-700 font-bold">Estoque Comercialização</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* LISTA DE DOCUMENTOS FISCAIS (PARA FIS_PRODUTOS, FIS_SERVICOS, FIS_CONSUMIDOR, FIS_TODOS) */}
        {effectiveFiscalTab !== "FIS_COMPRAS" &&
          effectiveFiscalTab !== "FIS_AUXILIARES" &&
          filteredInvoices.map((inv) => {
            const tb = inv.taxBreakdown;
            const isPaid = inv.status === "PAGA";
            const badge = getDocTypeBadge(inv.documentType);
            return (
              <div
                key={inv.id}
                className="bg-white rounded-md border border-slate-200 p-5 shadow-xs space-y-3"
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded text-xs font-black bg-slate-900 text-white font-mono">
                        {inv.documentNumber}
                      </span>
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold ${badge.className}`}>
                        {badge.label}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                          isPaid ? "bg-emerald-600 text-white" : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {inv.status}
                      </span>
                    </div>
                    <h3 className="text-base font-extrabold text-slate-900">
                      {inv.companyName} — <span className="font-mono text-sm">CNPJ {inv.companyCnpj}</span>
                    </h3>
                    <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>Competência: <strong>{inv.competenceMonth}</strong></span>
                      <span>Emissão: <strong>{inv.issueDate}</strong></span>
                      <span>Vencimento: <strong>{inv.dueDate}</strong></span>
                      {inv.cfop && <span>CFOP: <strong className="font-mono text-slate-700">{inv.cfop}</strong></span>}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-right bg-slate-50 px-3.5 py-2 rounded border border-slate-200">
                      <span className="text-[10px] text-slate-500 block">
                        Bruto: <strong>{formatBRL(inv.grossAmount)}</strong> | ISS: {tb.issRatePercent}% | ICMS: {tb.icmsRatePercent}%
                      </span>
                      {tb.totalWithheld > 0 && (
                        <span className="text-[10px] text-amber-800 font-bold block">
                          Retenções: IRRF {formatBRL(tb.irrfWithheldAmount)} + CSRF {formatBRL(tb.csrfWithheldAmount)}
                        </span>
                      )}
                      <strong className="text-sm text-emerald-800">
                        Líquido: {formatBRL(inv.netAmount)}
                      </strong>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditingInvoice(inv)}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded bg-amber-500 hover:bg-amber-600 text-white text-xs font-extrabold cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" /> ✏️ Editar
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setEmailModalPayload({
                          docType: inv.documentType === 'FATURA_LOCACAO' ? 'RENTAL_RECEIPT' : 'FISCAL_INVOICE',
                          companyName: inv.companyName,
                          companyCnpj: inv.companyCnpj,
                          documentCode: inv.documentNumber,
                          amountBrl: inv.netAmount,
                          dueDate: inv.dueDate,
                          boletoLine: inv.boletoDigitableLine,
                          pixCode: inv.pixCopyPaste,
                        })
                      }
                      className="inline-flex items-center gap-1 px-3 py-2 rounded bg-sky-600 hover:bg-sky-700 text-white text-xs font-extrabold cursor-pointer"
                    >
                      <Mail className="w-3.5 h-3.5" /> ✉️ Enviar p/ Cliente
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteInvoice(inv)}
                      title="Excluir Documento Fiscal"
                      className="p-2 rounded border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedInvoiceForPrint(inv)}
                      className="px-3.5 py-2 rounded bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5 inline mr-1" /> Imprimir Espelho
                    </button>
                    {!isPaid && inv.documentType !== "NFE_REMESSA_LOCACAO" && (
                      <button
                        type="button"
                        onClick={() => handleMarkInvoicePaid(inv.id)}
                        className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                      >
                        Confirmar Recebimento
                      </button>
                    )}
                  </div>
                </div>

                {/* RESUMO DE ENQUADRAMENTO E ITENS DO DOCUMENTO FISCAL */}
                <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
                  <div className="truncate max-w-3xl">
                    <strong>Item Principal:</strong> {inv.itemsDescription[0]?.description || "—"}
                    {inv.itemsDescription.length > 1 && ` (+${inv.itemsDescription.length - 1} itens)`}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
                    {inv.cstIcms && (
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                        CST ICMS: {inv.cstIcms}
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                      PIS/COFINS: {formatBRL(tb.pisAmount + tb.cofinsAmount)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
      </div>
    );
  };

  return (
    <div className="rounded-lg overflow-hidden border border-slate-300 shadow-md bg-[#f3f5f8]">
      {/* TOP BAR AZUL MARINHO GESTÃOCLICK (#1e3a6e) */}
      <div className="bg-[#1e3a6e] text-white px-3 sm:px-4 min-h-12 py-2 flex flex-wrap items-center justify-between gap-2 select-none">
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => setErpMobileDrawerOpen(true)}
            className="md:hidden inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#ff7a59] text-white text-xs font-extrabold shadow-xs cursor-pointer"
            title="Abrir Menu ERP Mobile"
          >
            <Menu className="w-4 h-4" />
            <span>Menu ERP</span>
          </button>
          <span className="text-sm sm:text-base font-extrabold tracking-tight">SETA ERP</span>
          <button
            type="button"
            onClick={() => setSidebarCollapsed((v) => !v)}
            className="hidden md:inline-flex p-1.5 rounded hover:bg-white/10 cursor-pointer"
            title="Recolher/Expandir menu lateral"
          >
            <Menu className="w-4 h-4" />
          </button>
          <span className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
            API ERP-GROK • Loja {gestaoClickConfig.storeName || 'Matriz'} #{gestaoClickConfig.storeId || '118887'} • MCP {gestaoClickConfig.mcpStatus || 'ONLINE'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2.5">
          <button
            type="button"
            onClick={() => {
              setActiveSection('ORCAMENTOS');
              openFullNewProposalModal('LOCACAO');
            }}
            className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white text-[11px] sm:text-xs font-extrabold shadow-xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Nova Proposta
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

      {/* BARRA RÁPIDA MOBILE DO ERP (PERMITE ABRIR QUALQUER MÓDULO E SUBMÓDULO COM 1 TOQUE NO CELULAR) */}
      <div className="md:hidden bg-white border-b border-slate-200 px-3 py-2 space-y-1.5">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {GESTAO_CLICK_MENU_TREE.map((grp) => {
            const isAct = activeSection === grp.id;
            return (
              <button
                key={grp.id}
                type="button"
                onClick={() => {
                  setActiveSection(grp.id);
                  const firstSub = grp.subItems?.[0]?.id || grp.id;
                  setActiveSubId(firstSub);
                  if (firstSub === 'CAD_CLIENTES') setCadastrosSubTab('CLIENTES');
                }}
                className={`shrink-0 px-2.5 py-1.5 rounded text-[11px] font-extrabold transition cursor-pointer ${
                  isAct
                    ? 'bg-[#1e3a6e] text-white shadow-2xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {grp.label}
              </button>
            );
          })}
        </div>
        {(() => {
          const activeGrp = GESTAO_CLICK_MENU_TREE.find((g) => g.id === activeSection);
          if (!activeGrp?.subItems || activeGrp.subItems.length === 0) return null;
          return (
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1 border-t border-slate-100">
              {activeGrp.subItems.map((sub) => {
                const isSubAct = activeSubId === sub.id;
                return (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => {
                      setActiveSubId(sub.id);
                      if (sub.id === 'CAD_CLIENTES') setCadastrosSubTab('CLIENTES');
                      if (sub.id === 'CAD_FORNECEDORES') setCadastrosSubTab('FORNECEDORES');
                      if (sub.id === 'CAD_FUNCIONARIOS') setCadastrosSubTab('FUNCIONARIOS');
                      if (sub.id === 'CAD_TRANSPORTADORAS') setCadastrosSubTab('TRANSPORTADORAS');
                      if (sub.id === 'CAD_AUXILIARES') setCadastrosSubTab('AUXILIARES');
                      if (sub.id === 'OS_PAINEL') setOsViewMode('PAINEL');
                      if (sub.id === 'OS_GERENCIAR') setOsViewMode('LISTA');
                      if (
                        sub.id === 'CTR_LOCACOES' ||
                        sub.id === 'CTR_SERVICOS' ||
                        sub.id === 'CTR_ASSINATURAS' ||
                        sub.id === 'CTR_AUXILIARES'
                      ) {
                        setContractsSubFilter(sub.id);
                      }
                    }}
                    className={`shrink-0 px-2.5 py-1 rounded text-[11px] font-bold transition cursor-pointer ${
                      isSubAct
                        ? 'bg-[#ff7a59] text-white'
                        : 'bg-orange-50/70 text-[#0d2b4e] border border-orange-200/70'
                    }`}
                  >
                    {sub.label}
                  </button>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* BODY: SIDEBAR ESQUERDA FIXA + ÁREA PRINCIPAL */}
      <div className="flex flex-col md:flex-row min-h-[780px]">
        {!sidebarCollapsed && (
          <GestaoClickSidebar
            activeSection={activeSection}
            activeSubId={activeSubId}
            mobileDrawerOpen={erpMobileDrawerOpen}
            onCloseMobileDrawer={() => setErpMobileDrawerOpen(false)}
            onSelect={(sec, subId) => {
              setActiveSection(sec);
              if (subId) {
                setActiveSubId(subId);
                if (subId === 'CAD_CLIENTES') setCadastrosSubTab('CLIENTES');
                if (subId === 'CAD_FORNECEDORES') setCadastrosSubTab('FORNECEDORES');
                if (subId === 'CAD_FUNCIONARIOS') setCadastrosSubTab('FUNCIONARIOS');
                if (subId === 'CAD_TRANSPORTADORAS') setCadastrosSubTab('TRANSPORTADORAS');
                if (subId === 'CAD_AUXILIARES') setCadastrosSubTab('AUXILIARES');
                if (subId === 'OS_PAINEL') setOsViewMode('PAINEL');
                if (subId === 'OS_GERENCIAR') setOsViewMode('LISTA');
                if (subId === 'CTR_LOCACOES' || subId === 'CTR_SERVICOS' || subId === 'CTR_ASSINATURAS' || subId === 'CTR_AUXILIARES') {
                  setContractsSubFilter(subId);
                }
              }
            }}
            onNewProposal={() => {
              setActiveSection('ORCAMENTOS');
              setActiveSubId('ORC_PRODUTOS');
              openFullNewProposalModal('PRODUTOS');
            }}
            companyCnpj={gestaoClickConfig.companyCnpj}
            taxRegime={gestaoClickConfig.taxRegime}
          />
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
              onOpenSection={(sec, subId) => {
                setActiveSection(sec as GestaoClickMenuSection);
                if (subId) {
                  setActiveSubId(subId);
                  if (subId === 'CAD_CLIENTES') setCadastrosSubTab('CLIENTES');
                  if (subId === 'CAD_FORNECEDORES') setCadastrosSubTab('FORNECEDORES');
                  if (subId === 'CAD_FUNCIONARIOS') setCadastrosSubTab('FUNCIONARIOS');
                }
              }}
              onNewProposal={() => {
                setActiveSection('ORCAMENTOS');
                openFullNewProposalModal('LOCACAO');
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
                <div>
                  <span className="text-[10px] font-extrabold uppercase text-[#1e3a6e] block">
                    ERP &gt; Cadastros &gt; {cadastrosSubTab} (Navegação na Barra Vertical Esquerda)
                  </span>
                  <h2 className="text-base font-extrabold text-slate-900">
                    {cadastrosSubTab === 'CLIENTES'
                      ? `Clientes do ERP (${companies.length} cadastrados • Base ERP Separada do CRM)`
                      : cadastrosSubTab === 'FORNECEDORES'
                        ? `Fornecedores do ERP (${suppliers.length})`
                        : cadastrosSubTab === 'FUNCIONARIOS'
                          ? `Funcionários Seta Telecom (${employees.length})`
                          : cadastrosSubTab === 'TRANSPORTADORAS'
                            ? 'Transportadoras Homologadas'
                            : 'Opções Auxiliares de Cadastros'}
                  </h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {cadastrosSubTab === 'CLIENTES' && (() => {
                    const selComp = companies.find((c) => c.id === selectedCadastroId) || null;
                    return selComp ? (
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          title={`Consultar / Visualizar Cadastro (${selComp.name})`}
                          aria-label="Consultar Cadastro Selecionado"
                          onClick={() =>
                            setEditingCustomerModal({ company: selComp, isNew: false, readOnly: true })
                          }
                          className="inline-flex items-center justify-center p-2 rounded-md bg-slate-100 hover:bg-slate-200 text-[#0d2b4e] border border-slate-300 shadow-2xs cursor-pointer"
                        >
                          <Search className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          title={`Editar Cadastro (${selComp.name})`}
                          aria-label="Editar Cadastro Selecionado"
                          onClick={() =>
                            setEditingCustomerModal({ company: selComp, isNew: false, readOnly: false })
                          }
                          className="inline-flex items-center justify-center p-2 rounded-md bg-[#0d2b4e] hover:bg-[#1e3a6e] text-white shadow-2xs cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5 text-[#ff7a59]" />
                        </button>
                      </div>
                    ) : null;
                  })()}
                  {cadastrosSubTab === 'CLIENTES' && (
                    <button
                      type="button"
                      onClick={() =>
                        setEditingCustomerModal({
                          company: null,
                          isNew: true,
                        })
                      }
                      className="px-3.5 py-1.5 rounded bg-[#1e3a6e] hover:bg-[#162b54] text-white text-xs font-extrabold cursor-pointer"
                    >
                      + Novo Cadastro
                    </button>
                  )}
                  {cadastrosSubTab === 'FORNECEDORES' && (
                    <button
                      type="button"
                      onClick={() =>
                        openCollectionEditor(
                          'suppliers',
                          'Novo Fornecedor / Transportadora',
                          { id: `sup-${Date.now()}`, name: '', cnpj: '', phone: '', email: '', active: true },
                          [
                            { key: 'name', label: 'Nome / Razão Social *' },
                            { key: 'cnpj', label: 'CNPJ' },
                            { key: 'phone', label: 'Telefone' },
                            { key: 'email', label: 'E-mail' },
                          ]
                        )
                      }
                      className="px-3 py-1.5 rounded bg-[#ff7a59] text-white text-xs font-extrabold cursor-pointer"
                    >
                      + Novo Fornecedor
                    </button>
                  )}
                  {cadastrosSubTab === 'FUNCIONARIOS' && (
                    <button
                      type="button"
                      onClick={() =>
                        openCollectionEditor(
                          'employees',
                          'Novo Funcionário / Colaborador',
                          { id: `emp-${Date.now()}`, name: '', role: '', email: '', phone: '', active: true },
                          [
                            { key: 'name', label: 'Nome Completo *' },
                            { key: 'role', label: 'Cargo / Função' },
                            { key: 'email', label: 'E-mail' },
                            { key: 'phone', label: 'Telefone' },
                          ]
                        )
                      }
                      className="px-3 py-1.5 rounded bg-[#ff7a59] text-white text-xs font-extrabold cursor-pointer"
                    >
                      + Novo Funcionário
                    </button>
                  )}
                </div>
              </div>

              {cadastrosSubTab === 'CLIENTES' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setEditingCustomerModal({
                            company: null,
                            isNew: true,
                          })
                        }
                        className="px-3.5 py-1.5 rounded bg-[#1e3a6e] hover:bg-[#162b54] text-white text-xs font-bold cursor-pointer"
                      >
                        + Adicionar Cliente (Novo Cadastro)
                      </button>
                      <span className="text-[11px] text-slate-500">
                        Consulta integrada: <strong>Receita Federal (RFB)</strong> &amp; <strong>Serasa Experian Score</strong>
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={customerSearchQuery}
                        onChange={(e) => setCustomerSearchQuery(e.target.value)}
                        placeholder="Buscar por nome ou CNPJ..."
                        className="px-3 py-1.5 rounded border border-slate-300 text-xs w-64"
                      />
                    </div>
                  </div>

                  <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0"><table className="w-full min-w-[640px] text-left text-xs">
                    <thead className="bg-slate-50 text-slate-700 font-bold border-b">
                      <tr>
                        <th className="py-2.5 px-3 w-8">Sel.</th>
                        <th className="py-2.5 px-3">Nome / Razão Social (Clique p/ Selecionar ou Editar)</th>
                        <th className="py-2.5 px-3">Documento</th>
                        <th className="py-2.5 px-3">Situação</th>
                        <th className="py-2.5 px-3">Telefone</th>
                        <th className="py-2.5 px-3 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {companies
                        .filter((c) => {
                          if (!customerSearchQuery.trim()) return true;
                          const q = customerSearchQuery.toLowerCase();
                          return (
                            c.name.toLowerCase().includes(q) ||
                            (c.cnpj || '').toLowerCase().includes(q)
                          );
                        })
                        .map((c) => {
                          const cp = (c.customProperties || {}) as Record<string, unknown>;
                          const tradeName = String(cp.tradeName || c.cnpj || c.domain || c.name);
                          const sit = String(cp.situation || (c.completenessScore >= 95 ? 'Em dia' : 'Novo'));
                          const phone = String(cp.phone || cp.commercialPhone || '(11) 3305-1200');
                          return (
                            <tr
                              key={c.id}
                              onClick={() =>
                                setSelectedCadastroId((prev) => (prev === c.id ? null : c.id))
                              }
                              className={`cursor-pointer transition ${
                                selectedCadastroId === c.id
                                  ? 'bg-blue-50/80 hover:bg-blue-100/60'
                                  : 'hover:bg-slate-50'
                              }`}
                            >
                              <td className="py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={selectedCadastroId === c.id}
                                  onChange={() =>
                                    setSelectedCadastroId((prev) => (prev === c.id ? null : c.id))
                                  }
                                  className="w-4 h-4 accent-[#1e3a6e] cursor-pointer"
                                />
                              </td>
                              <td
                                onClick={() => setEditingCustomerModal({ company: c, isNew: false })}
                                className="py-2.5 px-3"
                              >
                                <div className="font-bold text-[#1e3a6e] hover:underline">{c.name}</div>
                                <div className="italic text-[11px] text-slate-400">({tradeName})</div>
                              </td>
                              <td className="py-2.5 px-3 font-mono text-slate-700">{c.cnpj || '—'}</td>
                              <td className="py-2.5 px-3">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    sit === 'Em dia' || sit === 'Ativo'
                                      ? 'bg-emerald-500 text-white'
                                      : 'bg-slate-200 text-slate-700'
                                  }`}
                                >
                                  {sit}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-slate-600">{phone}</td>
                              <td className="py-2.5 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                                <div className="inline-flex items-center justify-end gap-1.5">
                                  <button
                                    type="button"
                                    title="Consultar / Visualizar Cadastro"
                                    aria-label="Consultar Cadastro"
                                    onClick={() =>
                                      setEditingCustomerModal({ company: c, isNew: false, readOnly: true })
                                    }
                                    className="inline-flex items-center justify-center p-2 rounded-md bg-slate-100 hover:bg-slate-200 text-[#0d2b4e] border border-slate-300 transition shadow-2xs cursor-pointer"
                                  >
                                    <Search className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    title="Editar Cadastro"
                                    aria-label="Editar Cadastro"
                                    onClick={() =>
                                      setEditingCustomerModal({ company: c, isNew: false, readOnly: false })
                                    }
                                    className="inline-flex items-center justify-center p-2 rounded-md bg-[#0d2b4e] hover:bg-[#1e3a6e] text-white transition shadow-2xs cursor-pointer"
                                  >
                                    <Pencil className="w-3.5 h-3.5 text-[#ff7a59]" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table></div>
                </div>
              )}

              {cadastrosSubTab === 'FORNECEDORES' && (
                <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0"><table className="w-full min-w-[640px] text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b">
                    <tr><th className="py-2 px-3">Fornecedor</th><th className="py-2 px-3">CNPJ</th><th className="py-2 px-3">Telefone</th><th className="py-2 px-3">E-mail</th><th className="py-2 px-3 text-right">Ações</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {suppliers.map((sup) => (
                      <tr
                        key={sup.id}
                        onClick={() =>
                          openCollectionEditor('suppliers', `Editar Fornecedor — ${sup.name}`, sup as unknown as Record<string, unknown>, [
                            { key: 'name', label: 'Nome / Razão Social' },
                            { key: 'cnpj', label: 'CNPJ' },
                            { key: 'phone', label: 'Telefone' },
                            { key: 'email', label: 'E-mail' },
                          ])
                        }
                        className="hover:bg-blue-50/60 cursor-pointer transition"
                      >
                        <td className="py-2 px-3 font-bold text-[#1e3a6e] underline">{sup.name}</td>
                        <td className="py-2 px-3 font-mono">{sup.cnpj}</td>
                        <td className="py-2 px-3">{sup.phone}</td>
                        <td className="py-2 px-3">{sup.email}</td>
                        <td className="py-2 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              title="Consultar / Visualizar Cadastro"
                              aria-label="Consultar Cadastro"
                              onClick={() =>
                                openCollectionEditor(
                                  'suppliers',
                                  `Consultar Fornecedor — ${sup.name}`,
                                  sup as unknown as Record<string, unknown>,
                                  [
                                    { key: 'name', label: 'Nome / Razão Social' },
                                    { key: 'cnpj', label: 'CNPJ' },
                                    { key: 'phone', label: 'Telefone' },
                                    { key: 'email', label: 'E-mail' },
                                  ],
                                  { readOnly: true, deleteId: sup.id, deleteLabel: sup.name }
                                )
                              }
                              className="inline-flex items-center justify-center p-2 rounded-md bg-slate-100 hover:bg-slate-200 text-[#0d2b4e] border border-slate-300 transition cursor-pointer"
                            >
                              <Search className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Editar Cadastro"
                              aria-label="Editar Cadastro"
                              onClick={() =>
                                openCollectionEditor(
                                  'suppliers',
                                  `Editar Fornecedor — ${sup.name}`,
                                  sup as unknown as Record<string, unknown>,
                                  [
                                    { key: 'name', label: 'Nome / Razão Social' },
                                    { key: 'cnpj', label: 'CNPJ' },
                                    { key: 'phone', label: 'Telefone' },
                                    { key: 'email', label: 'E-mail' },
                                  ],
                                  { readOnly: false, deleteId: sup.id, deleteLabel: sup.name }
                                )
                              }
                              className="inline-flex items-center justify-center p-2 rounded-md bg-[#0d2b4e] hover:bg-[#1e3a6e] text-white transition cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5 text-[#ff7a59]" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}

              {cadastrosSubTab === 'FUNCIONARIOS' && (
                <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0"><table className="w-full min-w-[640px] text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b">
                    <tr><th className="py-2 px-3">Nome</th><th className="py-2 px-3">Cargo / Função</th><th className="py-2 px-3">E-mail</th><th className="py-2 px-3">Telefone</th><th className="py-2 px-3 text-right">Ações</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {employees.map((emp) => (
                      <tr
                        key={emp.id}
                        onClick={() =>
                          openCollectionEditor('employees', `Editar Funcionário — ${emp.name}`, emp as unknown as Record<string, unknown>, [
                            { key: 'name', label: 'Nome Completo' },
                            { key: 'role', label: 'Cargo / Função' },
                            { key: 'email', label: 'E-mail' },
                            { key: 'phone', label: 'Telefone' },
                          ])
                        }
                        className="hover:bg-blue-50/60 cursor-pointer transition"
                      >
                        <td className="py-2 px-3 font-bold text-[#1e3a6e] underline">{emp.name}</td>
                        <td className="py-2 px-3">{emp.role}</td>
                        <td className="py-2 px-3">{emp.email}</td>
                        <td className="py-2 px-3">{emp.phone}</td>
                        <td className="py-2 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              title="Consultar / Visualizar Cadastro"
                              aria-label="Consultar Cadastro"
                              onClick={() =>
                                openCollectionEditor(
                                  'employees',
                                  `Consultar Funcionário — ${emp.name}`,
                                  emp as unknown as Record<string, unknown>,
                                  [
                                    { key: 'name', label: 'Nome Completo' },
                                    { key: 'role', label: 'Cargo / Função' },
                                    { key: 'email', label: 'E-mail' },
                                    { key: 'phone', label: 'Telefone' },
                                  ],
                                  { readOnly: true, deleteId: emp.id, deleteLabel: emp.name }
                                )
                              }
                              className="inline-flex items-center justify-center p-2 rounded-md bg-slate-100 hover:bg-slate-200 text-[#0d2b4e] border border-slate-300 transition cursor-pointer"
                            >
                              <Search className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Editar Cadastro"
                              aria-label="Editar Cadastro"
                              onClick={() =>
                                openCollectionEditor(
                                  'employees',
                                  `Editar Funcionário — ${emp.name}`,
                                  emp as unknown as Record<string, unknown>,
                                  [
                                    { key: 'name', label: 'Nome Completo' },
                                    { key: 'role', label: 'Cargo / Função' },
                                    { key: 'email', label: 'E-mail' },
                                    { key: 'phone', label: 'Telefone' },
                                  ],
                                  { readOnly: false, deleteId: emp.id, deleteLabel: emp.name }
                                )
                              }
                              className="inline-flex items-center justify-center p-2 rounded-md bg-[#0d2b4e] hover:bg-[#1e3a6e] text-white transition cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5 text-[#ff7a59]" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
              {cadastrosSubTab === 'TRANSPORTADORAS' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded bg-slate-50 border border-slate-200 text-xs">
                    <div>
                      <strong className="text-slate-900">Transportadoras Homologadas — Remessas de Locação (CFOP 5.908 / 6.908)</strong>
                      <p className="text-[11px] text-slate-500">Operadores logísticos cadastrados para despacho de equipamentos telecom com seguro RCTR-C.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        openCollectionEditor(
                          'suppliers',
                          'Nova Transportadora Homologada',
                          { id: `trp-${Date.now()}`, name: '', cnpj: '', phone: '', email: '', supplierType: 'TRANSPORTADORA', modalFrete: '', cityState: '', active: true },
                          [
                            { key: 'name', label: 'Razão Social / Transportadora *' },
                            { key: 'cnpj', label: 'CNPJ' },
                            { key: 'modalFrete', label: 'Modal / Registro ANTT' },
                            { key: 'cityState', label: 'Cidade / UF' },
                            { key: 'phone', label: 'Telefone' },
                            { key: 'email', label: 'E-mail' },
                          ]
                        )
                      }
                      className="px-3 py-1.5 rounded bg-[#ff7a59] text-white text-xs font-extrabold cursor-pointer"
                    >
                      + Nova Transportadora
                    </button>
                  </div>
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b">
                      <tr><th className="py-2 px-3">Transportadora</th><th className="py-2 px-3">CNPJ</th><th className="py-2 px-3">Modal / ANTT</th><th className="py-2 px-3">Cidade/UF</th><th className="py-2 px-3">Contato</th><th className="py-2 px-3 text-right">Ações</th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {(suppliers.filter((sp) => sp.supplierType === 'TRANSPORTADORA' || /transp|log|expresso|correios|jadlog/i.test(sp.name)).length > 0
                        ? suppliers.filter((sp) => sp.supplierType === 'TRANSPORTADORA' || /transp|log|expresso|correios|jadlog/i.test(sp.name))
                        : suppliers
                      ).map((trp) => (
                        <tr key={trp.id} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-bold">{trp.name}</td>
                          <td className="py-2 px-3 font-mono">{trp.cnpj}</td>
                          <td className="py-2 px-3">{trp.modalFrete || 'Rodoviário / Aéreo B2B (ANTT)'}</td>
                          <td className="py-2 px-3">{trp.cityState || 'São Paulo/SP'}</td>
                          <td className="py-2 px-3">{trp.phone || trp.email}</td>
                          <td className="py-2 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                title="Consultar / Visualizar Cadastro"
                                aria-label="Consultar Cadastro"
                                onClick={() =>
                                  openCollectionEditor(
                                    'suppliers',
                                    `Consultar Transportadora — ${trp.name}`,
                                    { ...trp, supplierType: 'TRANSPORTADORA' } as unknown as Record<string, unknown>,
                                    [
                                      { key: 'name', label: 'Razão Social / Transportadora' },
                                      { key: 'cnpj', label: 'CNPJ' },
                                      { key: 'modalFrete', label: 'Modal / Registro ANTT' },
                                      { key: 'cityState', label: 'Cidade / UF' },
                                      { key: 'phone', label: 'Telefone' },
                                      { key: 'email', label: 'E-mail' },
                                    ],
                                    { readOnly: true, deleteId: trp.id, deleteLabel: trp.name }
                                  )
                                }
                                className="inline-flex items-center justify-center p-2 rounded-md bg-slate-100 hover:bg-slate-200 text-[#0d2b4e] border border-slate-300 transition cursor-pointer"
                              >
                                <Search className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                title="Editar Cadastro"
                                aria-label="Editar Cadastro"
                                onClick={() =>
                                  openCollectionEditor(
                                    'suppliers',
                                    `Editar Transportadora — ${trp.name}`,
                                    { ...trp, supplierType: 'TRANSPORTADORA' } as unknown as Record<string, unknown>,
                                    [
                                      { key: 'name', label: 'Razão Social / Transportadora' },
                                      { key: 'cnpj', label: 'CNPJ' },
                                      { key: 'modalFrete', label: 'Modal / Registro ANTT' },
                                      { key: 'cityState', label: 'Cidade / UF' },
                                      { key: 'phone', label: 'Telefone' },
                                      { key: 'email', label: 'E-mail' },
                                    ],
                                    { readOnly: false, deleteId: trp.id, deleteLabel: trp.name }
                                  )
                                }
                                className="inline-flex items-center justify-center p-2 rounded-md bg-[#0d2b4e] hover:bg-[#1e3a6e] text-white transition cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5 text-[#ff7a59]" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {cadastrosSubTab === 'AUXILIARES' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div className="p-4 rounded border border-slate-200 bg-slate-50 space-y-1.5">
                    <div className="font-extrabold text-[#1e3a6e] uppercase text-[11px]">Grupos de Clientes B2B</div>
                    <div>• Contas Enterprise Locação Pura (0% ISS — SV 31 STF)</div>
                    <div>• Indústria, Logística &amp; Varejo (CFOP 5.908 / 6.908)</div>
                    <div>• Call Centers &amp; Operações Voz IP (SLA NOC 24x7)</div>
                  </div>
                  <div className="p-4 rounded border border-slate-200 bg-slate-50 space-y-1.5">
                    <div className="font-extrabold text-[#1e3a6e] uppercase text-[11px]">Cargos &amp; Equipes Seta Telecom</div>
                    <div>• Diretoria &amp; Comercial: <strong>Marcelo Mira</strong></div>
                    <div>• Liderança Bancada / O.S.: <strong>Michelle da Rocha</strong></div>
                    <div>• Engenharia &amp; Contratos: <strong>Evelyn Ternero / Wesley Brito</strong></div>
                  </div>
                  <div className="p-4 rounded border border-slate-200 bg-slate-50 space-y-1.5">
                    <div className="font-extrabold text-[#1e3a6e] uppercase text-[11px]">Parâmetros Cadastrais</div>
                    <div>• Consulta Receita Federal (CNPJ/CNAE): <strong className="text-emerald-700">ATIVA</strong></div>
                    <div>• Score Serasa Experian B2B: <strong className="text-emerald-700">INTEGRADO</strong></div>
                    <div>• Loja GestãoClick: <strong>Matriz #118887</strong></div>
                  </div>
                </div>
              )}
            </div>
          )}

          {(activeSection === 'ITENS' || activeSection === 'ESTOQUE') && (() => {
            const isServiceCatItem = (it: ErpCatalogItem) =>
              it.category === 'SERVICO_TECNICO_LC116' ||
              it.category === 'TELECOM_SCM_SVA' ||
              it.fiscalNature === 'SERVICO_TECNICO_TI_TELECOM' ||
              it.fiscalNature === 'SERVICO_COMUNICACAO_SCM_SVA' ||
              /LC\s*116|SCM|SVA|SERVI/i.test(it.ncmOrLc116 || '');
            const filteredCatalogItems = catalog.filter((it) => {
              if (activeSection === 'ITENS') {
                if (activeSubId === 'ITENS_PRODUTOS' && isServiceCatItem(it)) return false;
                if (activeSubId === 'ITENS_SERVICOS' && !isServiceCatItem(it)) return false;
              }
              if (itensSearch.trim()) {
                const q = itensSearch.toLowerCase();
                return (
                  it.name.toLowerCase().includes(q) ||
                  it.gestaoClickCode.toLowerCase().includes(q) ||
                  (it.ncmOrLc116 || '').toLowerCase().includes(q) ||
                  (it.cfopDefault || '').toLowerCase().includes(q)
                );
              }
              return true;
            });
            return (
              <div className="space-y-4">
                {activeSection === 'ESTOQUE' && (
                  <SetaErpStockAndPurchasesSubbar
                    activeSubId={activeSubId}
                    onSelectSubId={(sub) => setActiveSubId(sub)}
                    catalogCount={catalog.length}
                    purchasesCount={purchaseOrders.length}
                    suppliers={suppliers}
                    onRefresh={onRefresh}
                    onShowToast={onShowToast}
                    onCreateStockTransfer={() =>
                      setGenericModal({
                        title: 'Registrar Ajuste de Inventário / Transferência Matriz #118887',
                        initialValues: {
                          sku: catalog[0]?.gestaoClickCode || 'SL-44-SEC-K9',
                          movementType: 'ENTRADA_COMPRA',
                          quantity: 2,
                          destination: 'Almoxarifado Matriz #118887 — Corredor Telecom',
                          notes: 'Conferência de Número de Série (S/N)',
                        },
                        fields: [
                          { key: 'sku', label: 'SKU do Produto' },
                          {
                            key: 'movementType',
                            label: 'Tipo de Movimentação',
                            type: 'select',
                            options: ['ENTRADA_COMPRA', 'TRANSFERENCIA_CLIENTE', 'RETORNO_LOCACAO', 'AJUSTE_INVENTARIO'],
                          },
                          { key: 'quantity', label: 'Quantidade', type: 'number' },
                          { key: 'destination', label: 'Origem / Destino' },
                          { key: 'notes', label: 'Observação / S/N' },
                        ],
                        onSave: async (vals) => {
                          const targetItem = catalog.find((c) => c.gestaoClickCode === vals.sku) || catalog[0];
                          if (targetItem) {
                            const delta =
                              vals.movementType === 'TRANSFERENCIA_CLIENTE'
                                ? -Math.abs(Number(vals.quantity) || 1)
                                : Math.abs(Number(vals.quantity) || 1);
                            await fetch(`/api/erp/catalog/${encodeURIComponent(targetItem.id)}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                stockAvailable: Math.max(0, targetItem.stockAvailable + delta),
                              }),
                            });
                          }
                          setGenericModal(null);
                          onShowToast(`Movimentação de estoque (${vals.sku}) registrada com sucesso!`);
                          await onRefresh();
                        },
                      })
                    }
                    onCreatePurchaseOrder={() =>
                      openCollectionEditor(
                        'purchaseOrders',
                        'Nova Cotação / Ordem de Compra (OC)',
                        {
                          id: `oc-${Date.now()}`,
                          code: String(37 + purchaseOrders.length),
                          supplierName: '',
                          issueDate: new Date().toLocaleDateString('pt-BR'),
                          status: 'Em cotação',
                          nfeNumber: '',
                          totalAmount: 0,
                        },
                        [
                          { key: 'code', label: 'Nº da Cotação / OC' },
                          { key: 'supplierName', label: 'Fornecedor Homologado Seta' },
                          { key: 'issueDate', label: 'Data de Emissão' },
                          {
                            key: 'status',
                            label: 'Situação',
                            type: 'select',
                            options: ['Em cotação', 'Aprovada', 'Confirmada', 'NF-e Recebida no Estoque'],
                          },
                          { key: 'nfeNumber', label: 'Nº NF-e de Entrada' },
                          { key: 'totalAmount', label: 'Valor Total da Compra (R$)', type: 'number' },
                        ]
                      )
                    }
                  />
                )}

                {activeSection === 'ESTOQUE' && activeSubId === 'EST_COMPRAS' && (
                  <div>
                    {renderPurchasesTable('Estoque > Compras (NF-e Entrada & Recebimento no Estoque)')}
                  </div>
                )}

                <div className="bg-white rounded-md border border-slate-200 p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-extrabold uppercase text-[#1e3a6e] block">
                        {activeSection} &gt; {activeSubId}
                      </span>
                      <h2 className="text-base font-extrabold text-slate-900">
                        Catálogo de Produtos, Serviços &amp; Estoque Locado ({filteredCatalogItems.length} de {catalog.length} itens)
                      </h2>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setGenericModal({
                            title: 'Novo Item no Catálogo (SKU, CFOP, Locação & Setup/Venda)',
                            initialValues: {
                              gestaoClickCode: '',
                              name: '',
                              category: activeSubId === 'ITENS_SERVICOS' ? 'SERVICO_TECNICO_LC116' : 'EQUIPAMENTO_LOCACAO',
                              fiscalNature: activeSubId === 'ITENS_SERVICOS' ? 'SERVICO_TECNICO_TI_TELECOM' : 'LOCACAO_BENS_MOVEIS',
                              ncmOrLc116: '',
                              cfopDefault: activeSubId === 'ITENS_SERVICOS' ? '5.933' : '5.908',
                              stockAvailable: 0,
                              stockRentedInClients: 0,
                              monthlyRentalPrice: 0,
                              saleOrSetupPrice: 0,
                            },
                            fields: CATALOG_ITEM_EDITOR_FIELDS,
                            onSave: async (vals) => {
                              const res = await fetch('/api/erp/catalog', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(vals),
                              });
                              if (res.ok) {
                                const j = await res.json();
                                if (j.data) recordUpsertedCatalogItem(j.data);
                              }
                              setGenericModal(null);
                              onShowToast('Item adicionado ao catálogo!');
                              await onRefresh();
                            },
                          })
                        }
                        className="px-3 py-2 rounded bg-[#1e3a6e] hover:bg-[#162b54] text-white text-xs font-extrabold cursor-pointer"
                      >
                        + Cadastro Rápido (SKU/CFOP)
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setEditingProductModal({
                            item: {},
                            isNew: true,
                          })
                        }
                        className="px-3.5 py-2 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold cursor-pointer"
                      >
                        + Novo Produto / Serviço (7 Abas)
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                    <div className="flex flex-wrap items-center gap-2">
                      {(() => {
                        const selItem =
                          filteredCatalogItems.find((i) => i.id === selectedItemId) || null;
                        return selItem ? (
                          <button
                            type="button"
                            onClick={() => setEditingProductModal({ item: selItem, isNew: false })}
                            className="px-3.5 py-1.5 rounded bg-amber-500 hover:bg-amber-600 text-white text-xs font-extrabold shadow-xs cursor-pointer"
                          >
                            ✏️ Editar Item Selecionado ({selItem.gestaoClickCode})
                          </button>
                        ) : null;
                      })()}
                      <span className="text-[11px] text-slate-500">
                        💡 Sub-itens (<strong>Produtos</strong> / <strong>Serviços</strong>) na barra vertical esquerda. Clique em qualquer item para editar.
                      </span>
                    </div>
                    <input
                      type="text"
                      value={itensSearch}
                      onChange={(e) => setItensSearch(e.target.value)}
                      placeholder="Buscar por SKU, descrição, NCM ou CFOP..."
                      className="px-3 py-1.5 rounded border border-slate-300 text-xs w-64"
                    />
                  </div>

                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b">
                      <tr><th className="py-2 px-3 w-8">Sel.</th><th className="py-2 px-3">SKU</th><th className="py-2 px-3">Descrição (Clique p/ Editar)</th><th className="py-2 px-3">Classificação Fiscal &amp; CFOP</th><th className="py-2 px-3 text-right">Disp.</th><th className="py-2 px-3 text-right">Locados</th><th className="py-2 px-3 text-right">Locação/mês</th><th className="py-2 px-3 text-right">Venda/Setup</th><th className="py-2 px-3 text-right">Ações</th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredCatalogItems.map((it) => (
                        <tr
                          key={it.id}
                          onClick={() =>
                            setSelectedItemId((prev) => (prev === it.id ? null : it.id))
                          }
                          className={`cursor-pointer transition ${
                            selectedItemId === it.id
                              ? 'bg-blue-50/80 hover:bg-blue-100/60'
                              : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedItemId === it.id}
                              onChange={() =>
                                setSelectedItemId((prev) => (prev === it.id ? null : it.id))
                              }
                              className="w-4 h-4 accent-[#1e3a6e] cursor-pointer"
                            />
                          </td>
                          <td
                            onClick={() => setEditingProductModal({ item: it, isNew: false })}
                            className="py-2 px-3 font-mono font-bold text-[#1e3a6e] underline"
                          >
                            {it.gestaoClickCode}
                          </td>
                          <td
                            onClick={() => setEditingProductModal({ item: it, isNew: false })}
                            className="py-2 px-3 font-semibold text-slate-900 hover:text-[#1e3a6e]"
                          >
                            {it.name}
                          </td>
                          <td className="py-2 px-3">
                            <div>{it.ncmOrLc116}</div>
                            <span className="font-mono text-[10px] text-slate-500">CFOP: {it.cfopDefault || '5.908'}</span>
                          </td>
                          <td className="py-2 px-3 text-right font-bold">{it.stockAvailable}</td>
                          <td className="py-2 px-3 text-right font-bold text-indigo-700">{it.stockRentedInClients}</td>
                          <td className="py-2 px-3 text-right font-extrabold text-emerald-700">{formatBRL(it.monthlyRentalPrice)}</td>
                          <td className="py-2 px-3 text-right font-bold text-slate-700">{formatBRL(it.saleOrSetupPrice || 0)}</td>
                          <td className="py-2 px-3 text-right space-x-1">
                            <button
                              type="button"
                              onClick={() =>
                                setGenericModal({
                                  title: `Editar Item — ${it.gestaoClickCode}`,
                                  initialValues: it as unknown as Record<string, unknown>,
                                  fields: CATALOG_ITEM_EDITOR_FIELDS,
                                  onSave: async (vals) => {
                                    const res = await fetch(`/api/erp/catalog/${encodeURIComponent(it.id)}`, {
                                      method: 'PATCH',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify(vals),
                                    });
                                    if (res.ok) {
                                      const j = await res.json();
                                      if (j.data) recordUpsertedCatalogItem(j.data);
                                    }
                                    setGenericModal(null);
                                    onShowToast(`Item ${it.gestaoClickCode} atualizado!`);
                                    await onRefresh();
                                  },
                                })
                              }
                              className="px-2 py-1 rounded bg-amber-500 text-white text-[11px] font-bold cursor-pointer"
                            >
                              ⚙️ Rápido
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingProductModal({ item: it, isNew: false })}
                              className="px-2.5 py-1 rounded bg-[#1e3a6e] hover:bg-[#162b54] text-white text-[11px] font-bold cursor-pointer"
                            >
                              ✏️ Editar (7 Abas)
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                await fetch(`/api/erp/catalog/${encodeURIComponent(it.id)}`, { method: 'DELETE' });
                                recordDeletedCatalogItem(it.id);
                                onShowToast(`Item ${it.gestaoClickCode} excluído.`);
                                await onRefresh();
                              }}
                              className="px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 text-[11px] font-bold cursor-pointer"
                            >
                              🗑️
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {activeSection === 'ESTOQUE' && activeSubId !== 'EST_COMPRAS' && (
                    <div className="pt-4 border-t border-slate-200">
                      {renderPurchasesTable('Estoque > Últimas Notas de Compras / Entradas CAPEX')}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {activeSection === 'VENDAS' && (() => {
            const isReturnOrder = (v: ErpSaleOrder) =>
              v.saleType === 'DEVOLUCAO' || /cancelad|devol|estorn/i.test(v.status || '');
            const isServiceSale = (v: ErpSaleOrder) =>
              v.saleType === 'SERVICO' || /servi|instala|manuten|noc|suporte|lc\s*116/i.test(v.itemsSummary || '');
            const filteredSales = salesOrders.filter((v) => {
              if (activeSubId === 'VENDAS_DEVOLUCOES') return isReturnOrder(v);
              if (activeSubId === 'VENDAS_SERVICOS') {
                const srvMatches = salesOrders.filter(isServiceSale);
                if (srvMatches.length > 0 && !isServiceSale(v)) return false;
              }
              if (activeSubId === 'VENDAS_PRODUTOS' && isReturnOrder(v)) return false;
              if (vendasSearch.trim()) {
                const q = vendasSearch.toLowerCase();
                return (
                  v.companyName.toLowerCase().includes(q) ||
                  v.code.toLowerCase().includes(q) ||
                  (v.sellerName || '').toLowerCase().includes(q)
                );
              }
              return true;
            });
            return (
              <div className="space-y-4">
                {activeSubId !== 'VENDAS_BALCAO' && (
                  <div className="bg-white rounded-md border border-slate-200 p-3.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-600">
                      Alterne entre <strong>Produtos</strong>, <strong>Serviços</strong> e <strong>Devoluções</strong> na barra vertical esquerda.
                    </span>
                    <input
                      type="text"
                      value={vendasSearch}
                      onChange={(e) => setVendasSearch(e.target.value)}
                      placeholder="Buscar por cliente, código ou vendedor..."
                      className="px-3 py-1.5 rounded border border-slate-300 text-xs w-64"
                    />
                  </div>
                )}

                {activeSubId === 'VENDAS_BALCAO' ? (
                  <SetaErpPdvPosView
                    catalog={catalog}
                    companies={companies}
                    salesOrders={salesOrders}
                    onRefresh={onRefresh}
                    onShowToast={onShowToast}
                    onOpenEmailModal={(p) => setEmailModalPayload(p)}
                  />
                ) : (
                  <div className="bg-white rounded-md border border-slate-200 p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-extrabold uppercase text-[#1e3a6e] block">
                          Vendas &gt; {activeSubId}
                        </span>
                        <h2 className="text-base font-extrabold text-slate-900">
                          {activeSubId === 'VENDAS_DEVOLUCOES'
                            ? `Devoluções & Trocas de Vendas (${filteredSales.length})`
                            : activeSubId === 'VENDAS_SERVICOS'
                              ? `Vendas de Serviços Técnicos (${filteredSales.length})`
                              : `Pedidos de Venda Seta Telecom (${filteredSales.length})`}
                        </h2>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            openCollectionEditor(
                              'salesOrders',
                              'Registrar Devolução / Estorno de Venda',
                              {
                                id: `dev-${Date.now()}`,
                                code: `DEV-${2937 + salesOrders.length}`,
                                companyName: '',
                                sellerName: '',
                                date: new Date().toLocaleDateString('pt-BR'),
                                status: 'Devolvida / Estornada',
                                saleType: 'DEVOLUCAO',
                                itemsSummary: '',
                                totalAmount: 0,
                              },
                              [
                                { key: 'code', label: 'Código da Devolução' },
                                { key: 'companyName', label: 'Cliente' },
                                { key: 'sellerName', label: 'Responsável' },
                                { key: 'date', label: 'Data' },
                                { key: 'status', label: 'Situação', type: 'select', options: ['Devolvida / Estornada', 'Cancelada'] },
                                { key: 'itemsSummary', label: 'Motivo / Item Devolvido' },
                                { key: 'totalAmount', label: 'Valor Estornado (R$)', type: 'number' },
                              ]
                            )
                          }
                          className="px-3 py-2 rounded bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold cursor-pointer"
                        >
                          ↩️ + Registrar Devolução
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            openCollectionEditor(
                              'salesOrders',
                              'Novo Pedido de Venda',
                              {
                                id: `vnd-${Date.now()}`,
                                code: String(2937 + salesOrders.length),
                                companyName: '',
                                sellerName: '',
                                date: new Date().toLocaleDateString('pt-BR'),
                                status: 'Em aberto',
                                saleType: activeSubId === 'VENDAS_SERVICOS' ? 'SERVICO' : 'PRODUTO',
                                itemsSummary: '',
                                totalAmount: 0,
                              },
                              [
                                { key: 'code', label: 'Código da Venda' },
                                { key: 'companyName', label: 'Cliente' },
                                { key: 'sellerName', label: 'Vendedor' },
                                { key: 'date', label: 'Data' },
                                { key: 'saleType', label: 'Modalidade', type: 'select', options: ['PRODUTO', 'SERVICO', 'BALCAO', 'DEVOLUCAO'] },
                                { key: 'status', label: 'Situação', type: 'select', options: ['Concretizada', 'Em aberto', 'Devolvida / Estornada', 'Cancelada'] },
                                { key: 'itemsSummary', label: 'Itens / Escopo' },
                                { key: 'totalAmount', label: 'Valor Total (R$)', type: 'number' },
                              ]
                            )
                          }
                          className="px-3.5 py-2 rounded bg-[#ff7a59] text-white text-xs font-extrabold cursor-pointer"
                        >
                          + Nova Venda
                        </button>
                      </div>
                    </div>
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b">
                        <tr><th className="py-2 px-3">Código</th><th className="py-2 px-3">Cliente</th><th className="py-2 px-3">Vendedor</th><th className="py-2 px-3">Data</th><th className="py-2 px-3">Situação</th><th className="py-2 px-3 text-right">Valor Total</th><th className="py-2 px-3 text-right">Ações</th></tr>
                      </thead>
                      <tbody className="divide-y">
                        {(filteredSales.length > 0 ? filteredSales : salesOrders).map((v) => (
                          <tr key={v.id} className="hover:bg-slate-50">
                            <td className="py-2 px-3 font-mono font-bold">#{v.code}</td>
                            <td className="py-2 px-3 font-semibold">{v.companyName}</td>
                            <td className="py-2 px-3">{v.sellerName}</td>
                            <td className="py-2 px-3">{v.date}</td>
                            <td className="py-2 px-3"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isReturnOrder(v) ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'}`}>{v.status}</span></td>
                            <td className="py-2 px-3 text-right font-extrabold">{formatBRL(v.totalAmount)}</td>
                            <td className="py-2 px-3 text-right space-x-1">
                              <button
                                type="button"
                                onClick={() =>
                                  openCollectionEditor('salesOrders', `Editar Venda #${v.code}`, v as unknown as Record<string, unknown>, [
                                    { key: 'code', label: 'Código' },
                                    { key: 'companyName', label: 'Cliente' },
                                    { key: 'sellerName', label: 'Vendedor' },
                                    { key: 'date', label: 'Data' },
                                    { key: 'saleType', label: 'Modalidade', type: 'select', options: ['PRODUTO', 'SERVICO', 'BALCAO', 'DEVOLUCAO'] },
                                    { key: 'status', label: 'Situação', type: 'select', options: ['Concretizada', 'Em aberto', 'Devolvida / Estornada', 'Cancelada'] },
                                    { key: 'itemsSummary', label: 'Itens / Escopo' },
                                    { key: 'totalAmount', label: 'Valor Total (R$)', type: 'number' },
                                  ])
                                }
                                className="px-2.5 py-1 rounded bg-amber-500 text-white text-[11px] font-bold cursor-pointer"
                              >
                                ✏️ Editar
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteCollectionRecord('salesOrders', v.id, `Venda #${v.code}`)}
                                className="px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 text-[11px] font-bold cursor-pointer"
                              >
                                🗑️
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}

          {(activeSection === 'ORDENS_SERVICOS' || activeSection === 'ATENDIMENTOS') && (() => {
            const isKanban = osViewMode === 'PAINEL' || activeSubId === 'OS_PAINEL';
            const filteredOs = serviceOrders.filter((os) => {
              if (osTechFilter !== 'TODOS' && !(os.technicianName || '').toLowerCase().includes(osTechFilter.toLowerCase())) {
                return false;
              }
              if (osSearch.trim()) {
                const q = osSearch.toLowerCase();
                return (
                  os.companyName.toLowerCase().includes(q) ||
                  os.code.toLowerCase().includes(q) ||
                  (os.equipmentName || '').toLowerCase().includes(q) ||
                  (os.serialNumber || '').toLowerCase().includes(q) ||
                  (os.description || '').toLowerCase().includes(q)
                );
              }
              return true;
            });

            const techLoads = [
              { label: 'Michelle da Rocha', key: 'Michelle', role: 'Líder Bancada & PABX IP' },
              { label: 'Evelyn Ternero', key: 'Evelyn', role: 'Engenharia & SLA Telecom' },
              { label: 'Wesley Brito', key: 'Wesley', role: 'Campo, Fibra & RMA' },
            ].map((t) => {
              const all = serviceOrders.filter((o) => (o.technicianName || '').toLowerCase().includes(t.key.toLowerCase()));
              const active = all.filter((o) => o.status !== 'Concluída' && o.status !== 'Cancelada').length;
              return { ...t, total: all.length, active };
            });

            const kanbanCols: Array<{
              status: 'Em andamento' | 'Aguardando peça' | 'Concluída' | 'Cancelada';
              title: string;
              nextStatus?: 'Aguardando peça' | 'Concluída' | 'Em andamento';
              nextLabel?: string;
            }> = [
              { status: 'Em andamento', title: '🔧 Em andamento', nextStatus: 'Concluída', nextLabel: '✅ Concluir' },
              { status: 'Aguardando peça', title: '⏳ Aguardando peça', nextStatus: 'Em andamento', nextLabel: '🔧 Retomar' },
              { status: 'Concluída', title: '✅ Concluída' },
              { status: 'Cancelada', title: '🚫 Cancelada' },
            ];

            const osEditorFields: GenericFieldSpec[] = [
              { key: 'code', label: 'Nº da O.S.' },
              { key: 'companyName', label: 'Cliente' },
              { key: 'technicianName', label: 'Técnico Responsável' },
              { key: 'equipmentName', label: 'Equipamento / Modelo' },
              { key: 'serialNumber', label: 'Nº de Série / S/N' },
              { key: 'priority', label: 'Prioridade / SLA', type: 'select', options: ['NORMAL', 'ALTA', 'CRITICA', 'BAIXA'] },
              { key: 'entryDate', label: 'Data de Entrada' },
              { key: 'status', label: 'Situação', type: 'select', options: ['Em andamento', 'Aguardando peça', 'Concluída', 'Cancelada'] },
              { key: 'totalAmount', label: 'Valor (R$)', type: 'number' },
              { key: 'description', label: 'Defeito Relatado / Descrição', type: 'textarea' },
              { key: 'technicalReport', label: 'Laudo Técnico / Diagnóstico', type: 'textarea' },
            ];

            return (
              <div className="bg-white rounded-md border border-slate-200 p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-[10px] font-extrabold uppercase text-[#1e3a6e] block">
                      {activeSection} &gt; {activeSubId}
                    </span>
                    <h2 className="text-base font-extrabold text-slate-900">
                      Ordens de Serviços Técnicas &amp; Atendimentos ({filteredOs.length} de {serviceOrders.length})
                    </h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setOsViewMode('LISTA');
                        setActiveSubId('OS_GERENCIAR');
                      }}
                      className={`px-3 py-1.5 rounded text-xs font-extrabold cursor-pointer transition ${
                        !isKanban ? 'bg-[#1e3a6e] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      📋 Gerenciar O.S. (Lista)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOsViewMode('PAINEL');
                        setActiveSubId('OS_PAINEL');
                      }}
                      className={`px-3 py-1.5 rounded text-xs font-extrabold cursor-pointer transition ${
                        isKanban ? 'bg-[#1e3a6e] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      🗂️ Painel Kanban Técnico &amp; SLA
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        openCollectionEditor(
                          'serviceOrders',
                          'Nova Ordem de Serviço (O.S.)',
                          {
                            id: `os-${Date.now()}`,
                            code: String(1519 + serviceOrders.length),
                            companyName: '',
                            sellerName: '',
                            technicianName: '',
                            equipmentName: '',
                            serialNumber: '',
                            priority: 'NORMAL',
                            entryDate: new Date().toLocaleDateString('pt-BR'),
                            exitDate: '',
                            status: 'Aberta',
                            totalAmount: 0,
                            description: '',
                            technicalReport: '',
                          },
                          osEditorFields
                        )
                      }
                      className="px-3.5 py-2 rounded bg-[#ff7a59] text-white text-xs font-extrabold cursor-pointer"
                    >
                      + Nova O.S. / Atendimento
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
                  {techLoads.map((t) => {
                    const selected = osTechFilter === t.key;
                    return (
                      <button
                        key={t.label}
                        type="button"
                        onClick={() => setOsTechFilter(selected ? 'TODOS' : t.key)}
                        className={`text-left p-3 rounded border transition cursor-pointer ${
                          selected ? 'bg-[#1e3a6e] text-white border-[#1e3a6e]' : 'bg-slate-50 hover:bg-slate-100 border-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-extrabold">{t.label}</span>
                          <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-700 text-[10px] font-black">
                            {t.active} ativas / {t.total}
                          </span>
                        </div>
                        <div className={`text-[11px] ${selected ? 'text-slate-200' : 'text-slate-500'}`}>{t.role}</div>
                      </button>
                    );
                  })}
                  <div className="p-3 rounded border border-slate-200 bg-slate-50 flex flex-col justify-center gap-1.5">
                    <input
                      type="text"
                      value={osSearch}
                      onChange={(e) => setOsSearch(e.target.value)}
                      placeholder="Buscar O.S., cliente, equipamento ou S/N..."
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white text-xs"
                    />
                  </div>
                </div>

                {isKanban ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                    {kanbanCols.map((col) => {
                      const cards = filteredOs.filter((o) =>
                        col.status === 'Em andamento'
                          ? o.status === 'Em andamento' || o.status === 'Aberta'
                          : o.status === col.status
                      );
                      return (
                        <div key={col.status} className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-2.5">
                          <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                            <span className="text-xs font-extrabold text-slate-900">{col.title}</span>
                            <span className="px-2 py-0.5 rounded bg-white border text-[10px] font-black text-slate-700">
                              {cards.length}
                            </span>
                          </div>
                          <div className="space-y-2.5">
                            {cards.map((os) => (
                              <div key={os.id} className="bg-white rounded border border-slate-200 p-3 shadow-2xs space-y-2 text-xs">
                                <div className="flex items-center justify-between">
                                  <span className="font-mono font-black text-[#1e3a6e]">O.S. #{os.code}</span>
                                  <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">
                                    SLA {os.priority || 'NORMAL'}
                                  </span>
                                </div>
                                <div className="font-bold text-slate-900">{os.companyName}</div>
                                <div className="p-2 rounded bg-slate-50 border border-slate-100 text-[11px] space-y-0.5">
                                  <div className="font-semibold text-slate-800">
                                    🖥️ {os.equipmentName || 'Appliance PABX IP / Switch PoE Seta'}
                                  </div>
                                  <div className="font-mono text-[10px] text-indigo-800">
                                    S/N: {os.serialNumber || `SN-SETA-${os.code}`}
                                  </div>
                                  <div className="text-slate-600">{os.description}</div>
                                  {os.technicalReport && (
                                    <div className="text-emerald-800 font-medium pt-0.5">
                                      Laudo: {os.technicalReport}
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center justify-between text-[11px] text-slate-600">
                                  <span>👷 {os.technicianName}</span>
                                  <strong className="text-slate-900">{formatBRL(os.totalAmount)}</strong>
                                </div>
                                <div className="flex items-center justify-between gap-1 pt-1 border-t border-slate-100">
                                  {col.nextStatus ? (
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        const updated: ErpServiceOrder = { ...os, status: col.nextStatus! };
                                        await fetch('/api/erp/records/serviceOrders', {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify(updated),
                                        });
                                        recordUpsertedServiceOrder(updated);
                                        onShowToast(`O.S. #${os.code} avançada para ${col.nextStatus}!`);
                                        await onRefresh();
                                      }}
                                      className="px-2 py-1 rounded bg-emerald-600 text-white text-[10px] font-extrabold cursor-pointer"
                                    >
                                      {col.nextLabel}
                                    </button>
                                  ) : (
                                    <span className="text-[10px] text-slate-400">Entrada: {os.entryDate}</span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openCollectionEditor(
                                        'serviceOrders',
                                        `Editar O.S. #${os.code}`,
                                        {
                                          equipmentName: 'Central PABX IP Seta Cloud Appliance HA',
                                          serialNumber: `SN-SETA-${os.code}`,
                                          priority: 'NORMAL',
                                          technicalReport: 'Diagnóstico técnico NOC concluído.',
                                          ...os,
                                        } as unknown as Record<string, unknown>,
                                        osEditorFields
                                      )
                                    }
                                    className="px-2 py-1 rounded bg-amber-500 text-white text-[10px] font-bold cursor-pointer"
                                  >
                                    ✏️ Editar
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b">
                      <tr><th className="py-2 px-3">OS Nº</th><th className="py-2 px-3">Cliente</th><th className="py-2 px-3">Equipamento / S/N</th><th className="py-2 px-3">Técnico</th><th className="py-2 px-3">Entrada</th><th className="py-2 px-3">Situação</th><th className="py-2 px-3 text-right">Valor</th><th className="py-2 px-3 text-right">Ações</th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredOs.map((os) => (
                        <tr key={os.id} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-mono font-bold">#{os.code}</td>
                          <td className="py-2 px-3 font-semibold">{os.companyName}</td>
                          <td className="py-2 px-3">
                            <div className="font-semibold text-slate-800">{os.equipmentName || os.description || 'Equipamento Telecom'}</div>
                            <div className="font-mono text-[10px] text-slate-500">S/N: {os.serialNumber || `SN-SETA-${os.code}`}</div>
                          </td>
                          <td className="py-2 px-3">{os.technicianName}</td>
                          <td className="py-2 px-3">{os.entryDate}</td>
                          <td className="py-2 px-3"><span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">{os.status}</span></td>
                          <td className="py-2 px-3 text-right font-extrabold">{formatBRL(os.totalAmount)}</td>
                          <td className="py-2 px-3 text-right space-x-1">
                            <button
                              type="button"
                              onClick={() =>
                                openCollectionEditor(
                                  'serviceOrders',
                                  `Editar O.S. #${os.code}`,
                                  {
                                    equipmentName: 'Central PABX IP Seta Cloud Appliance HA',
                                    serialNumber: `SN-SETA-${os.code}`,
                                    priority: 'NORMAL',
                                    technicalReport: 'Diagnóstico técnico NOC concluído.',
                                    ...os,
                                  } as unknown as Record<string, unknown>,
                                  osEditorFields
                                )
                              }
                              className="px-2.5 py-1 rounded bg-amber-500 text-white text-[11px] font-bold cursor-pointer"
                            >
                              ✏️ Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCollectionRecord('serviceOrders', os.id, `O.S. #${os.code}`)}
                              className="px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 text-[11px] font-bold cursor-pointer"
                            >
                              🗑️
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })()}

          {activeSection === 'FINANCEIRO' && (
            <ErpFinanceiroAndBanksView
              activeSubId={activeSubId}
              onSelectSubId={(sub) => setActiveSubId(sub)}
              bankAccounts={bankAccounts}
              financialEntries={financialEntries}
              invoices={invoices}
              dashboardSummary={dashboardSummary}
              companies={companies.map((c) => ({ id: c.id, name: c.name, cnpj: (c as unknown as { cnpj?: string | null }).cnpj ?? undefined }))}
              hideBalances={hideBalances}
              onRefresh={onRefresh}
              onShowToast={onShowToast}
              openCollectionEditor={openCollectionEditor as any}
              setGenericModal={setGenericModal}
              setEmailModalPayload={setEmailModalPayload}
              setSelectedInvoiceForPrint={setSelectedInvoiceForPrint}
              setShowNewInvoiceModal={setShowNewInvoiceModal}
            />
          )}

          {activeSection === 'DATA_HEALTH_ERP' && (
            <DataHealthTab

              contacts={contacts}
              companies={companies}
              erpData={erpData}
              systemScope="erp"
              initialScope="ERP"
              loading={false}
              onRefresh={onRefresh}
              onMergeDuplicate={async () => {}}
              onAutoClean={async () => null}
              onEnrichEntity={async () => {}}
              onNavigateToContact={() => {}}
              onNavigateToErpSection={(sec, subId) => {
                setActiveSection((sec as GestaoClickMenuSection) || 'CADASTROS');
                if (subId) setActiveSubId(subId);
              }}
            />
          )}

          {(activeSection === 'RELATORIOS' || activeSection === 'CONFIGURACOES') && (
            <div className="bg-white rounded-md border border-slate-200 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="text-[10px] font-extrabold uppercase text-[#1e3a6e] block">
                    {activeSection} &gt; {activeSubId}
                  </span>
                  <h2 className="text-base font-extrabold text-slate-900">
                    Configurações &amp; Relatórios GestãoClick ({gestaoClickConfig.credentialName || 'ERP-GROK'})
                  </h2>
                  <p className="text-xs text-slate-500">Loja {gestaoClickConfig.storeName} #{gestaoClickConfig.storeId} • CNPJ {gestaoClickConfig.companyCnpj}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setGenericModal({
                        title: 'Editar Dados da Empresa Seta Telecom',
                        initialValues: {
                          companyLegalName: gestaoClickConfig.companyLegalName,
                          companyCnpj: gestaoClickConfig.companyCnpj,
                          municipalRegistration: gestaoClickConfig.municipalRegistration,
                          stateRegistration: gestaoClickConfig.stateRegistration,
                          storeName: gestaoClickConfig.storeName || 'Matriz',
                        },
                        fields: [
                          { key: 'companyLegalName', label: 'Razão Social' },
                          { key: 'companyCnpj', label: 'CNPJ' },
                          { key: 'municipalRegistration', label: 'Inscrição Municipal' },
                          { key: 'stateRegistration', label: 'Inscrição Estadual' },
                          { key: 'storeName', label: 'Nome da Loja / Unidade' },
                        ],
                        onSave: async (vals) => {
                          await fetch('/api/erp/gestaoclick/config', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(vals),
                          });
                          setGenericModal(null);
                          onShowToast('Configurações da empresa salvas!');
                          await onRefresh();
                        },
                      })
                    }
                    className="px-3.5 py-2 rounded bg-amber-500 text-white text-xs font-extrabold cursor-pointer"
                  >
                    ✏️ Editar Dados da Empresa
                  </button>
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
                <button type="button" onClick={() => setActiveSection('CONTRATOS')} className="text-left p-3 rounded bg-slate-50 hover:bg-blue-50 border hover:border-[#1e3a6e] cursor-pointer">MRR Locação: <strong>{formatBRL(kpis.monthlyRentalMrr)}</strong> →</button>
                <button type="button" onClick={() => setActiveSection('CONTRATOS')} className="text-left p-3 rounded bg-slate-50 hover:bg-blue-50 border hover:border-[#1e3a6e] cursor-pointer">TCV Carteira: <strong>{formatBRL(kpis.totalContractedTcv)}</strong> →</button>
                <button type="button" onClick={() => setActiveSection('FISCAL')} className="text-left p-3 rounded bg-slate-50 hover:bg-emerald-50 border hover:border-emerald-600 cursor-pointer">Economia ISS SV 31: <strong className="text-emerald-700">{formatBRL(kpis.issSavedBySv31Stf)}</strong> →</button>
                <button type="button" onClick={() => setActiveSection('ORCAMENTOS')} className="text-left p-3 rounded bg-slate-50 hover:bg-orange-50 border hover:border-[#ff7a59] cursor-pointer">Propostas: <strong>{proposals.length}</strong> →</button>
              </div>

              {rbacState && (
                <div className="pt-3 border-t border-slate-200">
                  <StiHubAdminRbacPanel
                    rbacState={rbacState}
                    emailTemplates={emailTemplates}
                    initialSubView={
                      activeSubId === 'CFG_EMPRESA' || activeSubId === 'CFG_LOJAS' || activeSubId === 'CFG_MARCA'
                        ? 'COMPANY_EMITTER'
                        : activeSubId === 'CFG_CERTIFICADO' || activeSubId === 'CFG_GERAIS' || activeSubId === 'CFG_PLANO'
                          ? 'CERTIFICATE_SERIES'
                          : activeSubId === 'CFG_EMAILS' || activeSubId === 'CFG_AVISOS'
                            ? 'EMAIL_TEMPLATES'
                            : activeSubId === 'CFG_CHECKLIST'
                              ? 'MIGRATION_CHECKLIST'
                              : activeSubId === 'CFG_LOGS'
                                ? 'DAILY_SYNC_LOGS'
                                : 'USERS_RBAC'
                    }
                    activeUser={activeUser}
                    onSelectActiveUser={onSelectActiveUser}
                    onRefresh={onRefresh}
                    onShowToast={onShowToast}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {emailModalPayload && (
        <ClientEmailComposerModal
          payload={emailModalPayload}
          onClose={() => setEmailModalPayload(null)}
          onSentSuccess={(msg) => onShowToast(msg)}
        />
      )}
      {editingProposal && (
        <ProposalEditModal
          proposal={editingProposal}
          onClose={() => {
            setEditingProposal(null);
            setIsCreatingProposalModal(false);
          }}
          onSave={handleSaveEditedProposal}
          onCustomerCreated={async (created) => {
            recordUpsertedCompany(created);
            await onRefresh();
          }}
          onGenerateContract={(prop) => openGenerateContractFromProposal(prop)}
          onShowToast={onShowToast}
          catalog={catalog}
          companies={companies}
          contacts={contacts}
          deals={deals}
          isNew={isCreatingProposalModal}
        />
      )}
      {editingContract && (
        <ContractEditModal
          contract={editingContract}
          initialTab={editingContractTab}
          readOnly={editingContractReadOnly}
          onClose={() => setEditingContract(null)}
          onSave={handleSaveEditedContract}
          onDelete={handleDeleteContract}
          onGenerateInvoice={handleGenerateContractInvoice}
          onGenerateRemessaNfe={handleGenerateRemessaNfe}
          onOpenPartialReturn={(ctr) => setPartialReturnModalContract(ctr)}
          onShowToast={onShowToast}
        />
      )}
      {editingInvoice && (
        <InvoiceEditModal
          invoice={editingInvoice}
          onClose={() => setEditingInvoice(null)}
          onSave={handleSaveEditedInvoice}
        />
      )}
      {genericModal && (
        <GenericRecordEditModal
          title={genericModal.title}
          initialValues={genericModal.initialValues}
          fields={genericModal.fields}
          readOnly={genericModal.readOnly}
          onClose={() => setGenericModal(null)}
          onSave={genericModal.onSave}
          onDelete={genericModal.onDelete}
        />
      )}

      {editingCustomerModal && (
        <GestaoClickCompanyModal
          key={editingCustomerModal.isNew ? 'new-erp-customer' : (editingCustomerModal.company?.id || 'edit-erp-customer')}
          company={editingCustomerModal.company}
          isNew={editingCustomerModal.isNew}
          readOnly={editingCustomerModal.readOnly}
          onClose={() => setEditingCustomerModal(null)}
          onSave={async (payload) => {
            const compId = editingCustomerModal.company?.id;
            const res = await fetch(
              compId && !editingCustomerModal.isNew
                ? `/api/companies/${encodeURIComponent(compId)}`
                : '/api/companies',
              {
                method: compId && !editingCustomerModal.isNew ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              }
            );
            if (res.ok) {
              const j = await res.json();
              if (j.data) recordUpsertedCompany(j.data);
            }
            setEditingCustomerModal(null);
            onShowToast(
              editingCustomerModal.isNew
                ? `Cliente ${payload.name} cadastrado com sucesso!`
                : `Cliente ${payload.name} atualizado com sucesso!`
            );
            await onRefresh();
          }}
          onDelete={
            editingCustomerModal.company?.id && !editingCustomerModal.isNew
              ? async (companyId: string) => {
                  await fetch(`/api/companies/${encodeURIComponent(companyId)}`, {
                    method: 'DELETE',
                  });
                  recordDeletedCompany(companyId);
                  setEditingCustomerModal(null);
                  onShowToast(`Cliente ${editingCustomerModal.company?.name || ''} excluído após confirmação.`);
                  await onRefresh();
                }
              : undefined
          }
        />
      )}

      {editingProductModal && (
        <GestaoClickProductEditModal
          item={editingProductModal.item}
          isNew={editingProductModal.isNew}
          suppliers={suppliers}
          onClose={() => setEditingProductModal(null)}
          onShowToast={onShowToast}
          onSave={async (payload) => {
            const itemId = editingProductModal.item.id;
            const res = await fetch(
              itemId && !editingProductModal.isNew
                ? `/api/erp/catalog/${encodeURIComponent(itemId)}`
                : '/api/erp/catalog',
              {
                method: itemId && !editingProductModal.isNew ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              }
            );
            if (res.ok) {
              const j = await res.json();
              if (j.data) recordUpsertedCatalogItem(j.data);
            }
            setEditingProductModal(null);
            onShowToast(
              editingProductModal.isNew
                ? `Produto ${payload.gestaoClickCode} cadastrado no catálogo!`
                : `Produto ${payload.gestaoClickCode} atualizado com sucesso!`
            );
            await onRefresh();
          }}
        />
      )}

      {partialReturnModalContract && (
        <PartialEquipmentReturnProRataModal
          contract={partialReturnModalContract}
          onClose={() => setPartialReturnModalContract(null)}
          onShowToast={onShowToast}
          onSuccess={async ({ contract: updatedCtr, returnNfe, proRataInvoice }) => {
            recordUpsertedContract(updatedCtr);
            if (returnNfe) recordUpsertedInvoice(returnNfe);
            if (proRataInvoice) recordUpsertedInvoice(proRataInvoice);
            setPartialReturnModalContract(null);
            onShowToast(
              `Devolução parcial e Rateio Pro-Rata aplicados ao contrato ${updatedCtr.contractNumber} (mantido ATIVO)! Novo MRR: ${formatBRL(updatedCtr.monthlyValue)}/mês.`
            );
            await onRefresh();
            if (proRataInvoice) {
              setSelectedInvoiceForPrint(proRataInvoice);
            }
          }}
        />
      )}

      {showBatchBillingModal && (
        <BatchRentalBillingAndEmailModal
          contracts={rentalContracts}
          initialSelectedIds={selectedContractIdsForBatch}
          onClose={() => setShowBatchBillingModal(false)}
          onShowToast={onShowToast}
          onSuccess={async ({ invoices: createdInvs, contracts: updatedCtrs, summaryText }) => {
            for (const inv of createdInvs) recordUpsertedInvoice(inv);
            for (const ctr of updatedCtrs) recordUpsertedContract(ctr);
            setShowBatchBillingModal(false);
            onShowToast(summaryText);
            await onRefresh();
          }}
        />
      )}

      {readjustModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="px-6 py-4 bg-indigo-950 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-300" />
                <div>
                  <span className="text-[10px] font-extrabold uppercase text-emerald-300 block">
                    Motor de Correção Monetária Anual — Seta Telecom
                  </span>
                  <h3 className="text-sm font-extrabold">
                    Reajustar Contrato {readjustModal.contract.contractNumber}
                  </h3>
                </div>
              </div>
              <button type="button" onClick={() => setReadjustModal(null)} className="text-slate-300 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleApplyReadjustmentSubmit} className="p-6 space-y-4 text-xs">
              <div className="p-3 rounded bg-slate-50 border border-slate-200 space-y-1">
                <div className="font-bold text-slate-900">{readjustModal.contract.title}</div>
                <div className="text-slate-500">
                  Cliente: <strong>{readjustModal.contract.companyName}</strong> • Mensalidade Atual:{" "}
                  <strong className="text-slate-900">{formatBRL(readjustModal.contract.monthlyValue)}/mês</strong>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Índice Econômico</label>
                  <select
                    value={readjustModal.index}
                    onChange={(e) => {
                      const nextIdx = e.target.value as "IPCA" | "IGP-M" | "FIXO" | "IST_ANATEL" | "IST_ANATEL";
                      const defaultPct = nextIdx === "IGP-M" ? "3.80" : nextIdx === "FIXO" ? "0.00" : "4.50";
                      setReadjustModal({ ...readjustModal, index: nextIdx, percentage: defaultPct });
                    }}
                    className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-bold"
                  >
                    <option value="IPCA">IPCA (IBGE)</option>
                    <option value="IGP-M">IGP-M (FGV)</option>
                    <option value="FIXO">FIXO / Negociado</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Percentual Acumulado (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={readjustModal.percentage}
                    onChange={(e) => setReadjustModal({ ...readjustModal, percentage: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300 font-extrabold text-indigo-950"
                  />
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Observação / Memória de Cálculo</label>
                <input
                  type="text"
                  value={readjustModal.note}
                  onChange={(e) => setReadjustModal({ ...readjustModal, note: e.target.value })}
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>
              <div className="p-3.5 rounded bg-emerald-50 border border-emerald-200 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase text-emerald-700 block">
                    Nova Mensalidade Após Reajuste (+{Number(readjustModal.percentage || 0).toFixed(2)}%)
                  </span>
                  <strong className="text-base font-black text-emerald-900">
                    {formatBRL(Math.round(readjustModal.contract.monthlyValue * (1 + (Number(readjustModal.percentage) || 0) / 100) * 100) / 100)}/mês
                  </strong>
                </div>
                <div className="text-right text-[11px] text-emerald-800">
                  <div>Anterior: {formatBRL(readjustModal.contract.monthlyValue)}</div>
                  <div>{readjustModal.contract.equipments.length} equipamento(s) reajustado(s)</div>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button type="button" onClick={() => setReadjustModal(null)} className="px-4 py-2 rounded border font-bold cursor-pointer">
                  Cancelar
                </button>
                <button type="submit" className="px-5 py-2 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white font-extrabold cursor-pointer">
                  Confirmar &amp; Aplicar Reajuste
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {rmaModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 bg-[#1e3a6e] text-white flex items-center justify-between">
              <div>
                <span className="text-[10px] font-extrabold uppercase text-emerald-300 block">
                  Controle de Patrimônio &amp; Advance Replacement (RMA)
                </span>
                <h3 className="text-sm font-extrabold">
                  Atualizar S/N — {rmaModal.contract.contractNumber}
                </h3>
              </div>
              <button type="button" onClick={() => setRmaModal(null)} className="text-slate-300 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveRmaSubmit} className="p-6 space-y-3.5 text-xs">
              <div className="p-3 rounded bg-slate-50 border border-slate-200">
                <div className="font-bold text-slate-900">
                  {rmaModal.contract.equipments[rmaModal.equipmentIdx]?.description}
                </div>
                <div className="text-slate-500">Cliente: {rmaModal.contract.companyName}</div>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Número de Série (S/N) *</label>
                <input
                  type="text"
                  required
                  value={rmaModal.newSerialNumber}
                  onChange={(e) => setRmaModal({ ...rmaModal, newSerialNumber: e.target.value })}
                  className="w-full px-3 py-2 rounded border border-slate-300 font-mono font-bold text-indigo-950"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Tag de Patrimônio Seta Telecom</label>
                <input
                  type="text"
                  value={rmaModal.newAssetTag}
                  onChange={(e) => setRmaModal({ ...rmaModal, newAssetTag: e.target.value })}
                  className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Status Físico do Equipamento</label>
                <select
                  value={rmaModal.newStatus}
                  onChange={(e) => setRmaModal({ ...rmaModal, newStatus: e.target.value as ErpAssetStatus })}
                  className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-bold"
                >
                  <option value="EM_CLIENTE">EM CLIENTE (Ativo em Produção)</option>
                  <option value="MANUTENCAO_RMA">MANUTENÇÃO / RMA (Laboratório NOC)</option>
                  <option value="DEVOLVIDO">DEVOLVIDO (Retorno de Locação CFOP 5.909)</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button type="button" onClick={() => setRmaModal(null)} className="px-4 py-2 rounded border font-bold cursor-pointer">
                  Cancelar
                </button>
                <button type="submit" className="px-5 py-2 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white font-extrabold cursor-pointer">
                  Salvar Patrimônio / S/N
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
                      ? 'FATURA / RECIBO DE LOCAÇÃO DE BENS MÓVEIS (0% ISS — SV 31 STF)'
                      : selectedInvoiceForPrint.documentType === 'NFSE_SERVICO'
                        ? 'NOTA FISCAL DE SERVIÇOS ELETRÔNICA (NFS-e PADRÃO NACIONAL)'
                        : selectedInvoiceForPrint.documentType === 'NFE_VENDA_PRODUTO'
                          ? 'DANFE — NF-e DE VENDA DE MERCADORIA / EQUIPAMENTO (MOD. 55)'
                          : selectedInvoiceForPrint.documentType === 'NFCE_CONSUMIDOR'
                            ? 'DANFE NFC-e — NOTA FISCAL DE CONSUMIDOR ELETRÔNICA (MOD. 65)'
                            : selectedInvoiceForPrint.documentType === 'NFCOM_TELECOM'
                              ? 'NFCom MODELO 62 — SERVIÇOS DE COMUNICAÇÃO MULTIMÍDIA (SCM)'
                              : 'DANFE — NF-e DE REMESSA EM LOCAÇÃO (MOD. 55 • CFOP 5.908)'}
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
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-emerald-200 text-[11px]">
                  <div>
                    ISSQN:{' '}
                    <strong>{formatBRL(selectedInvoiceForPrint.taxBreakdown.issAmount)}</strong> (
                    {selectedInvoiceForPrint.taxBreakdown.issRatePercent}%)
                  </div>
                  <div>
                    ICMS:{' '}
                    <strong>{formatBRL(selectedInvoiceForPrint.taxBreakdown.icmsAmount)}</strong> (
                    {selectedInvoiceForPrint.taxBreakdown.icmsRatePercent}%)
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
                    Ret. IRRF / CSRF:{' '}
                    <strong>
                      {formatBRL(selectedInvoiceForPrint.taxBreakdown.totalWithheld)}
                    </strong>
                  </div>
                  <div>
                    Valor Líquido:{' '}
                    <strong className="text-sm text-emerald-950">
                      {formatBRL(selectedInvoiceForPrint.netAmount)}
                    </strong>
                  </div>
                </div>
                <div className="pt-1 text-[10px] text-emerald-900 font-mono flex flex-wrap gap-3">
                  <span>CFOP: <strong>{selectedInvoiceForPrint.cfop || "N/A"}</strong></span>
                  <span>CST ICMS: <strong>{selectedInvoiceForPrint.cstIcms || "N/A"}</strong></span>
                  <span>CST PIS/COFINS: <strong>{selectedInvoiceForPrint.cstPisCofins || "01"}</strong></span>
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

      {/* MODAL: ESPELHO DA NOTA FISCAL DE COMPRA / ENTRADA (CFOP 1.551 / 1.102) */}
      {selectedPurchaseForPrint && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-[6px] border border-[#cbd6e2] shadow-2xl max-w-2xl w-full overflow-hidden my-8">
            <div className="px-6 py-4 bg-indigo-950 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-emerald-400" />
                <span className="font-extrabold text-sm">
                  Espelho de Escrituração — NF-e de Entrada Nº {selectedPurchaseForPrint.nfeNumber} (Compra #{selectedPurchaseForPrint.code})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-1.5 rounded bg-[#ff7a59] text-white text-xs font-bold cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 inline mr-1" /> Imprimir Espelho
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPurchaseForPrint(null)}
                  className="p-1 text-slate-300 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="p-6 space-y-4 text-xs text-slate-800">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded bg-slate-50 border border-slate-200">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Fornecedor Emitente</span>
                  <strong className="text-sm text-slate-900">{selectedPurchaseForPrint.supplierName}</strong>
                  <div className="font-mono">CNPJ: {selectedPurchaseForPrint.supplierCnpj || "68.993.641/0008-02"}</div>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Destinatário (Entrada Seta Telecom)</span>
                  <strong className="text-sm text-slate-900">{gestaoClickConfig.companyLegalName}</strong>
                  <div className="font-mono">CNPJ: {gestaoClickConfig.companyCnpj} • IE: {gestaoClickConfig.stateRegistration}</div>
                </div>
              </div>

              <div className="p-3.5 rounded bg-indigo-50/70 border border-indigo-200 space-y-1">
                <div className="font-extrabold text-indigo-950 uppercase text-[11px]">
                  Classificação Fiscal de Entrada &amp; Crédito Tributário
                </div>
                <div>
                  <strong>CFOP de Entrada:</strong>{" "}
                  <span className="font-mono">{selectedPurchaseForPrint.cfopEntrada || "1.551 — Compra de bem para o Ativo Imobilizado (Locação)"}</span>
                </div>
                <div>
                  <strong>Centro de Custo:</strong> {selectedPurchaseForPrint.costCenter || "CC-201 • CAPEX Ativos para Locação"}
                </div>
                <div>
                  <strong>Chave de Acesso NF-e:</strong>{" "}
                  <span className="font-mono">{selectedPurchaseForPrint.nfeAccessKey || "3526 1068 9936 4100 0802 5500 1000 0097 5910 0097 5904"}</span>
                </div>
              </div>

              <div className="p-3.5 rounded border border-slate-200 bg-white">
                <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                  Mercadorias / Ativos Imobilizados Escriturados
                </span>
                <p className="font-semibold text-slate-900">
                  {selectedPurchaseForPrint.itemsSummary || "Equipamentos de Telecomunicações, PABX IP e Terminais Gigabit para Parque de Locação"}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3 p-3.5 rounded bg-emerald-50 border border-emerald-200">
                <div>
                  <span className="text-[10px] uppercase font-bold text-emerald-800 block">Crédito ICMS</span>
                  <strong className="text-sm font-black text-emerald-950">
                    {formatBRL(selectedPurchaseForPrint.icmsCreditAmount ?? Math.round(selectedPurchaseForPrint.totalAmount * 0.18 * 100) / 100)}
                  </strong>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-emerald-800 block">Crédito PIS/COFINS</span>
                  <strong className="text-sm font-black text-emerald-950">
                    {formatBRL(selectedPurchaseForPrint.pisCofinsCreditAmount ?? Math.round(selectedPurchaseForPrint.totalAmount * 0.0365 * 100) / 100)}
                  </strong>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-emerald-800 block">Total da NF-e de Entrada</span>
                  <strong className="text-base font-black text-emerald-950">
                    {formatBRL(selectedPurchaseForPrint.totalAmount)}
                  </strong>
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
                    <option value="">-- Selecione um cliente cadastrado --</option>
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
                    <option value="">-- Selecione um produto/serviço do catálogo --</option>
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

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-[#33475b] mb-1">Modalidade da Proposta</label>
                  <select
                    value={propModality}
                    onChange={(e) => setPropModality(e.target.value as "RENTAL" | "SERVICE" | "HYBRID")}
                    className="w-full px-3 py-2 rounded-[4px] border border-[#cbd6e2] bg-white font-semibold"
                  >
                    <option value="RENTAL">Locação de Bens Móveis (0% ISS)</option>
                    <option value="SERVICE">Serviços Técnicos (LC 116)</option>
                    <option value="HYBRID">Híbrido (Locação + NOC)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-[#33475b] mb-1">Índice Reajuste Anual</label>
                  <select
                    value={propReadjustmentIndex}
                    onChange={(e) => setPropReadjustmentIndex(e.target.value as "IPCA" | "IGP-M" | "FIXO" | "IST_ANATEL" | "IST_ANATEL")}
                    className="w-full px-3 py-2 rounded-[4px] border border-[#cbd6e2] bg-white font-semibold"
                  >
                    <option value="IPCA">IPCA (IBGE)</option>
                    <option value="IGP-M">IGP-M (FGV)</option>
                    <option value="FIXO">FIXO</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-[#33475b] mb-1">S/N Pré-Alocado (Opcional)</label>
                  <input
                    type="text"
                    value={propSerialNumber}
                    onChange={(e) => setPropSerialNumber(e.target.value)}
                    placeholder="Ex: SN-SETA-99812A"
                    className="w-full px-3 py-2 rounded-[4px] border border-[#cbd6e2] font-mono"
                  />
                </div>
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
                  onChange={(e) => {
                    const dt = e.target.value as ErpFiscalDocumentType;
                    openNewInvoiceWithPreset(dt);
                  }}
                  className="w-full px-3 py-2 rounded-[4px] border border-[#cbd6e2] bg-white font-semibold"
                >
                  <option value="FATURA_LOCACAO">
                    Fatura / Recibo de Locação de Bens Móveis (0% ISS — Súmula Vinculante 31 STF)
                  </option>
                  <option value="NFSE_SERVICO">
                    NFS-e Serviço Técnico TI/Telecom (LC 116 Item 01.07 + Ret. IRRF 1,5% / CSRF 4,65%)
                  </option>
                  <option value="NFE_REMESSA_LOCACAO">
                    NF-e Remessa de Bem p/ Contrato de Locação (CFOP 5.908 / 6.908)
                  </option>
                  <option value="NFE_VENDA_PRODUTO">
                    NF-e Venda de Mercadoria / Equipamento (Modelo 55 • CFOP 5.102 / 6.102)
                  </option>
                  <option value="NFCE_CONSUMIDOR">
                    NFC-e Nota Fiscal de Consumidor Final Balcão (Modelo 65 • CFOP 5.102)
                  </option>
                  <option value="NFCOM_TELECOM">
                    NFCom Modelo 62 — Serviço de Comunicação Multimídia (SCM Anatel • CFOP 5.303)
                  </option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-[#33475b] mb-1">
                  CFOP / Enquadramento da Operação
                </label>
                <input
                  type="text"
                  value={invCfop}
                  onChange={(e) => setInvCfop(e.target.value)}
                  className="w-full px-3 py-2 rounded-[4px] border border-[#cbd6e2] font-mono text-xs"
                />
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
