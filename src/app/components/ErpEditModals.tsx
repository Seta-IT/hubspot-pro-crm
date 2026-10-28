'use client';

import React, { useState } from 'react';
import {
  Plus,
  Trash2,
  X,
  Save,
  FileText,
  FileCheck2,
  Receipt,
  Edit3,
  Truck,
  Calculator,
  Calendar,
  Wrench,
  Package,
  Search,
  Building2,
  CheckCircle2,
  AlertTriangle,
  History,
  RotateCcw,
  Printer,
  ExternalLink,
  Eye,
} from 'lucide-react';
import {
  Company,
  Contact,
  Deal,
  ErpCatalogItem,
  ErpCommercialProposal,
  ErpProposalVersionEntry,
  ErpFiscalDocumentType,
  ErpFiscalInvoice,
  ErpFiscalNature,
  ErpProposalInstallment,
  ErpProposalItem,
  ErpAssetStatus,
  ErpContractModality,
  ErpRentalContract,
  ErpRentalEquipmentItem,
} from '../../db/types';
import { formatBRL } from './ui-helpers';
import {
  formatBrPhoneMask,
  formatCnpjMask,
  formatCpfMask,
  validateDocumentByPersonType,
} from '../../modules/data-health/validators';
import { buildProposalVersionUrl, computeProposalTotals, inferProposalItemType, PROPOSAL_DELIVERY_SUGGESTIONS, PROPOSAL_SERVICE_PILL_OPTIONS, PROPOSAL_SERVICE_TYPE_OPTIONS, PROPOSAL_SLA_OPTIONS, PROPOSAL_TEMPLATE_STYLE_OPTIONS, resolveProposalDeliveryLeadTime, resolveProposalLayoutKind, resolveProposalSellerContact, resolveProposalServiceType, resolveProposalSlaOption } from '../lib/proposal-share';

// 1. PROPOSAL FULL EDITOR MODAL (EXACT GESTÃOCLICK "NOVO / EDITAR ORÇAMENTO" COMPLETE LAYOUT)
export function ProposalEditModal({
  proposal,
  onClose,
  onSave,
  onCustomerCreated,
  onGenerateContract,
  onShowToast,
  catalog = [],
  companies = [],
  contacts = [],
  deals = [],
  isNew = false,
}: {
  proposal: ErpCommercialProposal;
  onClose: () => void;
  onSave: (updated: ErpCommercialProposal) => Promise<void>;
  onCustomerCreated?: (created: Company) => Promise<void> | void;
  onGenerateContract?: (proposal: ErpCommercialProposal) => void;
  onShowToast?: (msg: string) => void;
  catalog?: ErpCatalogItem[];
  companies?: Company[];
  contacts?: Contact[];
  deals?: Deal[];
  isNew?: boolean;
}) {
  const [draft, setDraft] = useState<ErpCommercialProposal>(() =>
    computeProposalTotals(structuredClone(proposal))
  );
  const [saving, setSaving] = useState(false);
  const [showVersionHistoryPanel, setShowVersionHistoryPanel] = useState<boolean>(true);
  const [expandedVersionNumber, setExpandedVersionNumber] = useState<number | null>(null);
  const [versionChangeNote, setVersionChangeNote] = useState<string>('');
  const [restoringVersionNum, setRestoringVersionNum] = useState<number | null>(null);

  const versionHistoryList: ErpProposalVersionEntry[] = React.useMemo(() => {
    if (Array.isArray(draft.versionHistory) && draft.versionHistory.length > 0) {
      return [...draft.versionHistory].sort((a, b) => b.version - a.version);
    }
    return [
      {
        version: draft.version || 1,
        versionLabel: `v${draft.version || 1}.0`,
        savedAt: draft.updatedAt || draft.createdAt || new Date().toISOString(),
        savedBy: draft.sellerName || 'Marcelo Lopes Mira',
        changedFields: ['Emissão Inicial da Proposta'],
        changeSummary: `Versão inicial da Proposta Comercial #${draft.code || 'Nova'}`,
        snapshot: {
          title: draft.title || '',
          status: draft.status || 'ENVIADA',
          budgetType: draft.budgetType,
          companyId: draft.companyId ?? null,
          companyName: draft.companyName || '',
          companyCnpj: draft.companyCnpj || '',
          contactId: draft.contactId ?? null,
          contactName: draft.contactName || '',
          careOf: draft.careOf || draft.contactName || '',
          contactEmail: draft.contactEmail,
          sellerName: draft.sellerName || 'Marcelo Lopes Mira',
          contractMonths: Number(draft.contractMonths || 24),
          readjustmentIndex: draft.readjustmentIndex || 'IPCA',
          paymentCondition: draft.paymentCondition || '',
          validUntil: draft.validUntil || '',
          deliveryForecast: draft.deliveryForecast || '',
          shippingCarrier: draft.shippingCarrier || '',
          shippingCost: Number(draft.shippingCost || 0),
          deliveryAddress: draft.deliveryAddress || '',
          discountAmount: Number(draft.discountAmount || 0),
          discountPercentGlobal: Number(draft.discountPercentGlobal || 0),
          productsSubtotal: Number(draft.productsSubtotal || 0),
          servicesSubtotal: Number(draft.servicesSubtotal || 0),
          monthlyRecurringTotal: Number(draft.monthlyRecurringTotal || 0),
          oneTimeSetupTotal: Number(draft.oneTimeSetupTotal || 0),
          totalContractValue: Number(draft.totalContractValue || 0),
          commercialNotes: draft.commercialNotes || '',
          technicalClauses: draft.technicalClauses || '',
          internalNotes: draft.internalNotes || '',
          installments: Array.isArray(draft.installments) ? draft.installments : [],
          items: Array.isArray(draft.items) ? draft.items : [],
        },
      },
    ];
  }, [draft]);

  const handleLoadVersionSnapshotIntoForm = async (entry: ErpProposalVersionEntry) => {
    setRestoringVersionNum(entry.version);
    try {
      const s = entry.snapshot;
      setClientSearchInput(s.companyName || '');
      updateDraft({
        title: s.title,
        status: s.status,
        budgetType: s.budgetType || draft.budgetType,
        companyId: s.companyId,
        companyName: s.companyName,
        companyCnpj: s.companyCnpj,
        contactId: s.contactId,
        contactName: s.contactName,
        careOf: s.careOf || s.contactName,
        contactEmail: s.contactEmail,
        sellerName: s.sellerName,
        contractMonths: s.contractMonths,
        readjustmentIndex: s.readjustmentIndex || 'IPCA',
        paymentCondition: s.paymentCondition,
        validUntil: s.validUntil,
        deliveryForecast: s.deliveryForecast,
        shippingCarrier: s.shippingCarrier,
        shippingCost: s.shippingCost ?? 0,
        deliveryAddress: s.deliveryAddress,
        discountAmount: s.discountAmount ?? 0,
        discountPercentGlobal: s.discountPercentGlobal ?? 0,
        productsSubtotal: s.productsSubtotal,
        servicesSubtotal: s.servicesSubtotal,
        monthlyRecurringTotal: s.monthlyRecurringTotal,
        oneTimeSetupTotal: s.oneTimeSetupTotal,
        totalContractValue: s.totalContractValue,
        commercialNotes: s.commercialNotes,
        technicalClauses: s.technicalClauses,
        internalNotes: s.internalNotes,
        installments: Array.isArray(s.installments) ? structuredClone(s.installments) : [],
        items: Array.isArray(s.items) ? structuredClone(s.items) : [],
      });
      setVersionChangeNote(`Restaurado a partir da revisão ${entry.versionLabel}`);
      onShowToast?.(
        `Dados da ${entry.versionLabel} carregados no formulário! Clique em "Salvar Alterações" para gravar a nova revisão.`
      );
    } finally {
      setRestoringVersionNum(null);
    }
  };

  // GestãoClick Client Autocomplete & Inline Quick Customer Registration States
  const [localCreatedCompanies, setLocalCreatedCompanies] = useState<Company[]>([]);
  const [clientSearchInput, setClientSearchInput] = useState<string>(() =>
    proposal.companyName || ''
  );
  const [clientDropdownOpen, setClientDropdownOpen] = useState<boolean>(false);
  const [validityDaysInput, setValidityDaysInput] = useState<string>(() => {
    if (isNew && !proposal.validUntil) return '';
    return '15 dias';
  });
  const [coverText, setCoverText] = useState<string>(() =>
    String((proposal as unknown as Record<string, unknown>).coverText || '')
  );

  // Inline "+ Adicionar novo" Client Modal State (inside Proposal screen without losing draft)
  const [showQuickClientModal, setShowQuickClientModal] = useState<boolean>(false);
  const [qcPersonType, setQcPersonType] = useState<'PJ' | 'PF'>('PJ');
  const [qcCnpjCpf, setQcCnpjCpf] = useState<string>('');
  const [qcLegalName, setQcLegalName] = useState<string>('');
  const [qcTradeName, setQcTradeName] = useState<string>('');
  const [qcIe, setQcIe] = useState<string>('ISENTO');
  const [qcTaxRegime, setQcTaxRegime] = useState<string>('Lucro Presumido');
  const [qcPhone, setQcPhone] = useState<string>('');
  const [qcEmail, setQcEmail] = useState<string>('');
  const [qcCareOf, setQcCareOf] = useState<string>('');
  const [qcCep, setQcCep] = useState<string>('');
  const [qcStreet, setQcStreet] = useState<string>('');
  const [qcNumber, setQcNumber] = useState<string>('');
  const [qcNeighborhood, setQcNeighborhood] = useState<string>('');
  const [qcCity, setQcCity] = useState<string>('');
  const [qcState, setQcState] = useState<string>('SP');
  const [qcLookingUpRfb, setQcLookingUpRfb] = useState<boolean>(false);
  const [qcRfbBanner, setQcRfbBanner] = useState<string | null>(null);
  const [qcErrorMsg, setQcErrorMsg] = useState<string | null>(null);
  const [qcSaving, setQcSaving] = useState<boolean>(false);

  const allAvailableCompanies = React.useMemo(() => {
    const map = new Map<string, Company>();
    for (const c of localCreatedCompanies) map.set(c.id, c);
    for (const c of companies) {
      if (!map.has(c.id)) map.set(c.id, c);
    }
    return Array.from(map.values());
  }, [companies, localCreatedCompanies]);

  const matchingClients = React.useMemo(() => {
    const q = clientSearchInput.trim().toLowerCase();
    const qDigits = q.replace(/\D+/g, '');
    if (!q) return allAvailableCompanies.slice(0, 12);
    return allAvailableCompanies
      .filter((c) => {
        const cp = (c.customProperties || {}) as Record<string, unknown>;
        const trade = String(cp.tradeName || c.domain || '').toLowerCase();
        const nameMatch = c.name.toLowerCase().includes(q) || trade.includes(q);
        const cnpjRaw = String(c.cnpj || '').toLowerCase();
        const cnpjDigits = cnpjRaw.replace(/\D+/g, '');
        const cnpjMatch =
          cnpjRaw.includes(q) || (qDigits.length >= 2 && cnpjDigits.includes(qDigits));
        return nameMatch || cnpjMatch;
      })
      .slice(0, 12);
  }, [allAvailableCompanies, clientSearchInput]);

  const handleSelectExistingClient = (comp: Company) => {
    const compContact = contacts.find((ct) => ct.companyId === comp.id);
    const compDeal = deals.find((d) => d.companyId === comp.id);
    const contactFull = compContact
      ? `${compContact.firstName} ${compContact.lastName}`.trim()
      : draft.careOf || draft.contactName || '';
    setClientSearchInput(comp.name);
    setClientDropdownOpen(false);
    updateDraft({
      companyId: comp.id,
      companyName: comp.name,
      companyCnpj: comp.cnpj || draft.companyCnpj || '',
      contactId: compContact?.id || draft.contactId || null,
      contactName: contactFull,
      careOf: contactFull,
      contactEmail: compContact?.email || draft.contactEmail,
      dealId: compDeal?.id || draft.dealId || null,
      deliveryAddress:
        comp.city && comp.state
          ? `${comp.name} — ${comp.city}/${comp.state}`
          : draft.deliveryAddress,
    });
  };

  const handleLookupQuickClientRfb = async (rawDoc: string) => {
    const digits = rawDoc.replace(/\D+/g, '');
    if (digits.length !== 14) {
      setQcErrorMsg('Informe os 14 dígitos do CNPJ para consultar automaticamente na Receita Federal.');
      return;
    }
    setQcLookingUpRfb(true);
    setQcErrorMsg(null);
    setQcRfbBanner(null);
    try {
      const res = await fetch(`/api/cnpj/lookup?cnpj=${encodeURIComponent(digits)}`);
      const json = await res.json();
      if (!res.ok || !json?.data) {
        setQcErrorMsg(json?.error || 'Não foi possível consultar o CNPJ na Receita Federal.');
        return;
      }
      const d = json.data;
      setQcCnpjCpf(formatCnpjMask(d.cnpj || digits));
      setQcLegalName(d.razaoSocial || '');
      setQcTradeName(d.nomeFantasia || d.razaoSocial || '');
      setQcIe(d.inscricaoEstadual || 'ISENTO');
      setQcTaxRegime(d.regimeTributario || 'Lucro Presumido');
      if (d.telefone) setQcPhone(formatBrPhoneMask(d.telefone));
      if (d.emailComercial || d.emailFinanceiroNfe) {
        setQcEmail(d.emailComercial || d.emailFinanceiroNfe || '');
      }
      setQcCep(d.cep || '');
      setQcStreet(d.logradouro || '');
      setQcNumber(d.numero || '');
      setQcNeighborhood(d.bairro || '');
      setQcCity(d.cidade || 'São Paulo');
      setQcState(d.uf || 'SP');
      setQcRfbBanner(
        `CNPJ ${d.cnpj} validado na Receita Federal (${d.situacaoCadastral}) — Dados preenchidos automaticamente!`
      );
    } catch {
      setQcErrorMsg('Falha de rede ao consultar CNPJ na Receita Federal.');
    } finally {
      setQcLookingUpRfb(false);
    }
  };

  const handleOpenQuickNewClientModal = () => {
    const typed = clientSearchInput.trim();
    const typedDigits = typed.replace(/\D+/g, '');
    setClientDropdownOpen(false);
    setQcErrorMsg(null);
    setQcRfbBanner(null);
    setQcIe('ISENTO');
    setQcTaxRegime('Lucro Presumido');
    setQcPhone('');
    setQcEmail('');
    setQcCareOf(draft.careOf || '');
    setQcCep('');
    setQcStreet('');
    setQcNumber('');
    setQcNeighborhood('');
    setQcCity('');
    setQcState('SP');

    if (typedDigits.length >= 11 && typedDigits.length === typed.replace(/[.\-/\s]/g, '').length) {
      const isCpf = typedDigits.length <= 11;
      setQcPersonType(isCpf ? 'PF' : 'PJ');
      const formatted = isCpf ? formatCpfMask(typedDigits) : formatCnpjMask(typedDigits);
      setQcCnpjCpf(formatted);
      setQcLegalName('');
      setQcTradeName('');
      setShowQuickClientModal(true);
      if (typedDigits.length === 14) {
        handleLookupQuickClientRfb(typedDigits);
      }
    } else {
      setQcPersonType('PJ');
      setQcCnpjCpf('');
      setQcLegalName(typed);
      setQcTradeName(typed);
      setShowQuickClientModal(true);
    }
  };

  const handleSaveAndLinkQuickClient = async () => {
    if (!qcLegalName.trim()) {
      setQcErrorMsg('Informe a Razão Social / Nome Completo do cliente.');
      return;
    }
    const docCheck = validateDocumentByPersonType(
      qcCnpjCpf,
      qcPersonType === 'PF' ? 'Pessoa Física' : 'Pessoa Jurídica'
    );
    if (!docCheck.isValid) {
      setQcErrorMsg(`${docCheck.message}. Corrija o ${docCheck.docKind} antes de salvar.`);
      return;
    }
    setQcSaving(true);
    setQcErrorMsg(null);
    try {
      const payload = {
        name: qcLegalName.trim(),
        cnpj: docCheck.formatted || qcCnpjCpf.trim(),
        city: qcCity.trim() || 'São Paulo',
        state: qcState.trim() || 'SP',
        ownerName: draft.sellerName || 'Marcelo Mira',
        customProperties: {
          customerType: qcPersonType === 'PF' ? 'Pessoa Física' : 'Pessoa Jurídica',
          situation: 'Ativo',
          tradeName: qcTradeName.trim() || qcLegalName.trim(),
          stateRegistration: qcIe.trim() || 'ISENTO',
          taxRegime: qcTaxRegime,
          phone: qcPhone.trim(),
          emailComercial: qcEmail.trim(),
          cep: qcCep.trim(),
          street: qcStreet.trim(),
          number: qcNumber.trim(),
          neighborhood: qcNeighborhood.trim(),
          sellerName: draft.sellerName || 'Marcelo Mira',
        },
      };
      const res = await fetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setQcErrorMsg(json?.error || 'Não foi possível cadastrar o novo cliente.');
        return;
      }
      const createdCompany: Company = json?.data || {
        id: `comp-${Date.now()}`,
        name: payload.name,
        domain: null,
        cnpj: payload.cnpj,
        industry: 'Telecomunicações & TI',
        size: 'Médio Porte',
        annualRevenue: null,
        city: payload.city,
        state: payload.state,
        country: 'Brasil',
        completenessScore: 95,
        ownerName: payload.ownerName,
        enrichedAt: new Date().toISOString(),
        enrichmentSource: 'Cadastro Rápido na Proposta (Receita Federal)',
        customProperties: payload.customProperties,
        lastActivityAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      setLocalCreatedCompanies((prev) => [createdCompany, ...prev]);
      setClientSearchInput(createdCompany.name);
      updateDraft({
        companyId: createdCompany.id,
        companyName: createdCompany.name,
        companyCnpj: createdCompany.cnpj || payload.cnpj,
        careOf: qcCareOf.trim() || draft.careOf || '',
        contactName: qcCareOf.trim() || draft.contactName || '',
        contactEmail: qcEmail.trim() || draft.contactEmail || undefined,
        deliveryAddress:
          qcStreet.trim() || qcCity.trim()
            ? `${qcStreet.trim()} ${qcNumber.trim()} — ${qcCity.trim()}/${qcState.trim()}`.trim()
            : draft.deliveryAddress,
      });
      if (onCustomerCreated) {
        await onCustomerCreated(createdCompany);
      }
      onShowToast?.(
        `Cliente "${createdCompany.name}" (${createdCompany.cnpj}) cadastrado e vinculado automaticamente à proposta!`
      );
      setShowQuickClientModal(false);
    } finally {
      setQcSaving(false);
    }
  };

  const [selectedProductSku, setSelectedProductSku] = useState<string>('');
  const [productSearch, setProductSearch] = useState<string>('');
  const [selectedServiceSku, setSelectedServiceSku] = useState<string>('');
  const [serviceSearch, setServiceSearch] = useState<string>('');

  const [installmentCount, setInstallmentCount] = useState<number>(() =>
    Array.isArray(proposal.installments) && proposal.installments.length > 0
      ? proposal.installments.length
      : 1
  );
  const [firstDueDate, setFirstDueDate] = useState<string>(() => {
    if (Array.isArray(proposal.installments) && proposal.installments[0]?.dueDate) {
      return proposal.installments[0].dueDate;
    }
    return new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
  });
  const [defaultPaymentMethod, setDefaultPaymentMethod] = useState<string>(() => {
    if (Array.isArray(proposal.installments) && proposal.installments[0]?.paymentMethod) {
      return proposal.installments[0].paymentMethod;
    }
    return 'BOLETO';
  });

  const catalogProducts = catalog.filter(
    (c) =>
      c.fiscalNature !== 'SERVICO_TECNICO_TI_TELECOM' &&
      c.category !== 'SERVICO_TECNICO_LC116' &&
      (!productSearch.trim() ||
        c.name.toLowerCase().includes(productSearch.toLowerCase()) ||
        c.gestaoClickCode.toLowerCase().includes(productSearch.toLowerCase()))
  );

  const catalogServices = catalog.filter(
    (c) =>
      (c.fiscalNature === 'SERVICO_TECNICO_TI_TELECOM' ||
        c.fiscalNature === 'SERVICO_COMUNICACAO_SCM_SVA' ||
        c.category === 'SERVICO_TECNICO_LC116' ||
        c.category === 'TELECOM_SCM_SVA') &&
      (!serviceSearch.trim() ||
        c.name.toLowerCase().includes(serviceSearch.toLowerCase()) ||
        c.gestaoClickCode.toLowerCase().includes(serviceSearch.toLowerCase()))
  );

  const updateDraft = (patch: Partial<ErpCommercialProposal>) => {
    setDraft((prev) => computeProposalTotals({ ...prev, ...patch }));
  };

  const productItemsWithIdx = draft.items
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => inferProposalItemType(item) === 'PRODUCT');

  const serviceItemsWithIdx = draft.items
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => inferProposalItemType(item) === 'SERVICE');

  const handleAddProductFromCatalog = () => {
    const found = selectedProductSku
      ? catalog.find((c) => c.gestaoClickCode === selectedProductSku)
      : undefined;
    const price = found ? (found.monthlyRentalPrice || found.saleOrSetupPrice || 0) : 0;
    const newItem: ErpProposalItem = {
      id: `item-prd-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      sku: found?.gestaoClickCode || '',
      description: found?.name || '',
      itemType: 'PRODUCT',
      unit: 'UN',
      fiscalNature:
        found?.fiscalNature === 'VENDA_EQUIPAMENTO'
          ? 'VENDA_EQUIPAMENTO'
          : 'LOCACAO_BENS_MOVEIS',
      ncmOrServiceCode: found?.ncmOrLc116 || 'NCM 8517.62.59 (0% ISS — SV 31 STF)',
      quantity: 1,
      unitPrice: price,
      discountPercent: 0,
      discountAmount: 0,
      subtotal: price,
      isRecurring: draft.budgetType !== 'PRODUTOS',
      totalMonthly: price,
    };
    updateDraft({ items: [...draft.items, newItem] });
  };

  const handleAddServiceFromCatalog = () => {
    const found = selectedServiceSku
      ? catalog.find((c) => c.gestaoClickCode === selectedServiceSku)
      : undefined;
    const price = found ? (found.monthlyRentalPrice || found.saleOrSetupPrice || 0) : 0;
    const newItem: ErpProposalItem = {
      id: `item-srv-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      sku: found?.gestaoClickCode || '',
      description: found?.name || '',
      itemType: 'SERVICE',
      unit: 'SV',
      fiscalNature:
        found?.fiscalNature === 'SERVICO_COMUNICACAO_SCM_SVA'
          ? 'SERVICO_COMUNICACAO_SCM_SVA'
          : 'SERVICO_TECNICO_TI_TELECOM',
      ncmOrServiceCode: found?.ncmOrLc116 || 'LC 116/03 Item 01.07',
      quantity: 1,
      unitPrice: price,
      discountPercent: 0,
      discountAmount: 0,
      subtotal: price,
      isRecurring: true,
      totalMonthly: price,
    };
    updateDraft({ items: [...draft.items, newItem] });
  };

  const handleGenerateInstallments = (countOverride?: number, methodOverride?: string) => {
    const count = Math.max(1, Number(countOverride ?? installmentCount ?? 1));
    const method = methodOverride || defaultPaymentMethod || 'BOLETO';
    const baseTotal =
      draft.totalContractValue > 0
        ? draft.totalContractValue
        : draft.monthlyRecurringTotal + draft.oneTimeSetupTotal + (draft.shippingCost || 0);

    const baseDate = firstDueDate ? new Date(`${firstDueDate}T12:00:00`) : new Date();
    const validBaseDate = Number.isNaN(baseDate.getTime()) ? new Date() : baseDate;

    const perInstallment = Math.floor((baseTotal / count) * 100) / 100;
    const remainder = Math.round((baseTotal - perInstallment * count) * 100) / 100;

    const generated: ErpProposalInstallment[] = Array.from({ length: count }, (_, i) => {
      const due = new Date(validBaseDate.getTime() + i * 30 * 86400000);
      const dueStr = due.toISOString().slice(0, 10);
      const amt = i === 0 ? Math.round((perInstallment + remainder) * 100) / 100 : perInstallment;
      return {
        number: i + 1,
        dueDate: dueStr,
        amount: amt,
        paymentMethod: method,
        notes:
          count === 1
            ? 'Pagamento à vista'
            : `Parcela ${i + 1}/${count} (${method})`,
      };
    });

    setInstallmentCount(count);
    updateDraft({
      installments: generated,
      paymentCondition:
        count === 1
          ? `À Vista (${method}) — Vencimento ${generated[0]?.dueDate || firstDueDate}`
          : `Parcelado em ${count}x de ${formatBRL(perInstallment)} (${method}) — 1º Venc: ${generated[0]?.dueDate || firstDueDate}`,
    });
  };

  const itemDiscountsTotal = draft.items.reduce((acc, it) => {
    const gross = Math.max(1, Number(it.quantity || 1)) * Number(it.unitPrice || 0);
    const net = Number(it.subtotal ?? it.totalMonthly ?? gross);
    return acc + Math.max(0, gross - net);
  }, 0);

  const globalDiscountBrl =
    Number(draft.discountAmount || 0) +
    Math.round(
      ((draft.productsSubtotal || 0) + (draft.servicesSubtotal || 0)) *
        (Number(draft.discountPercentGlobal || 0) / 100) *
        100
    ) /
      100;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const computed = computeProposalTotals({
        ...draft,
        ...(versionChangeNote.trim()
          ? ({ versionChangeSummary: versionChangeNote.trim() } as unknown as Partial<ErpCommercialProposal>)
          : {}),
        updatedAt: new Date().toISOString(),
      });
      await onSave(computed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/75 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-[#f3f5f8] rounded-lg border border-slate-300 shadow-2xl max-w-6xl w-full overflow-hidden my-4">
        {/* TOP BLUE BAR GESTÃOCLICK */}
        <div className="px-5 py-3 bg-[#1e3a6e] text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-emerald-300" />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-extrabold">Seta Telecom • GestãoClick ERP</span>
                <span className="px-2 py-0.5 rounded bg-amber-400 text-slate-950 text-[10px] font-black uppercase">
                  {isNew ? 'Novo Orçamento' : `Editar Orçamento ${draft.code}`}
                </span>
              </div>
              <span className="text-[11px] text-slate-200 block">
                Vendedor: {draft.sellerName || 'Marcelo Lopes Mira'} • {draft.sellerEmail || 'marcelo.mira@setatelecom.com.br'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-200 hover:text-white cursor-pointer p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* PAGE HEADER & BREADCRUMB */}
        <div className="bg-white px-6 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-extrabold text-slate-800">
              {isNew ? 'Novo orçamento / proposta comercial' : `Editar orçamento #${draft.code}`}
            </h2>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-[#1e3a6e] border border-blue-200">
              {draft.budgetType === 'SERVICOS'
                ? 'Orçamento de Serviços'
                : draft.budgetType === 'PRODUTOS'
                  ? 'Orçamento de Produtos'
                  : draft.budgetType === 'CONJUNTO'
                    ? 'Orçamento Conjunto (Produtos + Serviços)'
                    : 'Locação Pura & Conectividade (MRR)'}
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-emerald-100 text-emerald-900 border border-emerald-300">
              Versão Atual: v{draft.version || 1}.0 ({versionHistoryList.length}{' '}
              {versionHistoryList.length === 1 ? 'revisão' : 'revisões'})
            </span>
            {!isNew && (
              <button
                type="button"
                onClick={() => setShowVersionHistoryPanel((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#1e3a6e] hover:bg-[#162b54] text-white text-[11px] font-extrabold shadow-2xs cursor-pointer"
              >
                <History className="w-3.5 h-3.5 text-amber-300" />
                <span>
                  {showVersionHistoryPanel ? 'Ocultar Histórico de Versões' : `Histórico de Versões (${versionHistoryList.length})`}
                </span>
              </button>
            )}
          </div>
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <span>Início</span>
            <span>&gt;</span>
            <span>Orçamentos</span>
            <span>&gt;</span>
            <strong className="text-slate-800">{isNew ? 'Adicionar' : 'Editar'}</strong>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs max-h-[82vh] overflow-y-auto">
          {/* BLOCO 1: INFORME OS DADOS DO ORÇAMENTO (FIEL AO PRINT GESTÃOCLICK [t62u]) */}
          <div className="bg-white rounded-md border border-slate-200 shadow-2xs overflow-visible">
            <div className="px-5 py-3 bg-slate-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                  <Edit3 className="w-4 h-4 text-[#1e3a6e]" />
                  <span>
                    Informe os <span className="text-[#1e3a6e]">dados</span> do orçamento
                  </span>
                </div>
                <div className="text-[11px] text-slate-500">
                  Número, cliente, vendedor, datas e a introdução da proposta
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[11px] font-bold text-slate-600">Layout / Template da Proposta:</label>
                <select
                  value={resolveProposalLayoutKind(draft.templateStyle)}
                  onChange={(e) =>
                    updateDraft({
                      templateStyle: e.target.value as ErpCommercialProposal['templateStyle'],
                    })
                  }
                  className="px-3 py-1.5 rounded border border-emerald-400 bg-emerald-50 font-extrabold text-emerald-950"
                >
                  {PROPOSAL_TEMPLATE_STYLE_OPTIONS.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.label}
                    </option>
                  ))}
                </select>

                <label className="text-[11px] font-bold text-slate-600">Tipo de Orçamento:</label>
                <select
                  value={draft.budgetType || 'LOCACAO'}
                  onChange={(e) =>
                    updateDraft({
                      budgetType: e.target.value as ErpCommercialProposal['budgetType'],
                    })
                  }
                  className="px-3 py-1.5 rounded border border-[#1e3a6e]/40 bg-blue-50/40 font-extrabold text-[#1e3a6e]"
                >
                  <option value="PRODUTOS">Orçamento de Produtos</option>
                  <option value="SERVICOS">Orçamento de Serviços</option>
                  <option value="CONJUNTO">Orçamento Conjunto (Produtos + Serviços)</option>
                  <option value="LOCACAO">Locação Pura &amp; Conectividade (MRR)</option>
                </select>
              </div>
            </div>

            <div className="p-5 space-y-4">
              {/* LINHA 1 DO GESTÃOCLICK: Número | Cliente * (Autocomplete + Botão Verde "+ Adicionar novo") | Data * | Validade */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5 items-start">
                {/* Coluna 1: Número */}
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Número</label>
                  <div className="flex">
                    <input
                      type="text"
                      value={draft.code}
                      onChange={(e) => updateDraft({ code: e.target.value })}
                      className="w-full px-3 py-2 rounded-l border border-slate-300 bg-slate-100 font-mono font-bold text-slate-800"
                    />
                    <span className="px-2.5 py-2 bg-slate-100 border border-l-0 border-slate-300 rounded-r text-slate-500 flex items-center">
                      <Edit3 className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>

                {/* Coluna 2: Cliente * (Busca Autocomplete + Aviso Cliente Não Cadastrado + Botão Verde "+ Adicionar novo") */}
                <div className="sm:col-span-3 relative">
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-bold text-slate-700">
                      Cliente <span className="text-rose-600">*</span>
                    </label>
                    {draft.companyCnpj && (
                      <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                        CNPJ: {draft.companyCnpj}
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      placeholder="Digite para buscar"
                      value={clientSearchInput}
                      onFocus={() => setClientDropdownOpen(true)}
                      onChange={(e) => {
                        const val = e.target.value;
                        setClientSearchInput(val);
                        setClientDropdownOpen(true);
                        updateDraft({
                          companyName: val,
                          companyId: null,
                        });
                      }}
                      className="w-full px-3 py-2 rounded border border-slate-300 focus:border-[#0091ae] focus:outline-none font-semibold text-slate-900 bg-white"
                    />
                    {clientSearchInput && (
                      <button
                        type="button"
                        onClick={() => {
                          setClientSearchInput('');
                          setClientDropdownOpen(true);
                          updateDraft({ companyId: null, companyName: '', companyCnpj: '' });
                        }}
                        title="Limpar busca de cliente"
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {/* DROPDOWN FLUTUANTE GESTÃOCLICK */}
                    {clientDropdownOpen && (
                      <div className="absolute left-0 right-0 top-full mt-1 z-40 bg-white rounded-md border border-slate-300 shadow-2xl overflow-hidden">
                        <div className="max-h-60 overflow-y-auto divide-y divide-slate-100">
                          {matchingClients.length > 0 ? (
                            matchingClients.map((comp, idx) => {
                              const cp = (comp.customProperties || {}) as Record<string, unknown>;
                              const trade = String(cp.tradeName || comp.name);
                              const isHighlighted = idx === 0 || draft.companyId === comp.id;
                              return (
                                <button
                                  key={comp.id}
                                  type="button"
                                  onClick={() => handleSelectExistingClient(comp)}
                                  className={`w-full text-left px-3.5 py-2.5 transition cursor-pointer block ${
                                    isHighlighted
                                      ? 'bg-[#2b579a] text-white'
                                      : 'hover:bg-slate-100 text-slate-900'
                                  }`}
                                >
                                  <div className="font-extrabold text-xs truncate">{comp.name}</div>
                                  <div
                                    className={`text-[11px] truncate ${
                                      isHighlighted ? 'text-blue-100' : 'text-slate-500'
                                    }`}
                                  >
                                    {trade} {comp.cnpj ? `- ${comp.cnpj}` : ''}
                                  </div>
                                </button>
                              );
                            })
                          ) : (
                            <div className="p-3.5 bg-amber-50/90 text-amber-950 space-y-1">
                              <div className="flex items-center gap-1.5 font-extrabold text-xs text-amber-900">
                                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                                <span>
                                  Nenhum cliente cadastrado encontrado para &ldquo;{clientSearchInput}&rdquo;.
                                </span>
                              </div>
                              <p className="text-[11px] text-amber-800">
                                Clique no botão verde <strong>+ Adicionar novo</strong> abaixo para cadastrar este cliente agora mesmo (com busca automática de CNPJ na Receita Federal) sem sair da proposta.
                              </p>
                            </div>
                          )}
                        </div>

                        {/* BOTÃO LARGO VERDE "+ Adicionar novo" NO RODAPÉ DO DROPDOWN (FIEL AO PRINT) */}
                        <div className="p-1.5 bg-slate-50 border-t border-slate-200 flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={handleOpenQuickNewClientModal}
                            className="w-full py-2 px-3 rounded bg-[#10b981] hover:bg-emerald-600 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-xs cursor-pointer transition"
                          >
                            <Plus className="w-4 h-4" />
                            <strong>+ Adicionar novo</strong>
                          </button>
                          <button
                            type="button"
                            onClick={() => setClientDropdownOpen(false)}
                            className="px-2.5 py-2 rounded border border-slate-300 bg-white text-slate-600 hover:text-slate-900 text-[11px] font-bold cursor-pointer shrink-0"
                          >
                            Fechar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Coluna 3: Data * */}
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Data <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={
                      draft.proposalDate ||
                      (draft.createdAt ? draft.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10))
                    }
                    onChange={(e) => updateDraft({ proposalDate: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-semibold"
                  />
                </div>

                {/* Coluna 4: Validade */}
                <div className="sm:col-span-1">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Validade</label>
                  <input
                    type="text"
                    placeholder="Ex.: 10 dias"
                    value={validityDaysInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      setValidityDaysInput(val);
                      const numDays = parseInt(val.replace(/\D+/g, ""), 10);
                      if (!Number.isNaN(numDays) && numDays > 0) {
                        const dt = new Date(Date.now() + numDays * 86400000)
                          .toISOString()
                          .slice(0, 10);
                        updateDraft({ validUntil: dt });
                      }
                    }}
                    className="w-full px-3 py-2 rounded border border-slate-300"
                  />
                </div>

                {/* Coluna 5: Prazo de Entrega */}
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-[#1e3a6e] mb-1">
                    Prazo de Entrega
                  </label>
                  <input
                    type="text"
                    list="proposal-delivery-leadtime-options"
                    placeholder="Ex.: 10 dias úteis"
                    value={resolveProposalDeliveryLeadTime(draft)}
                    onChange={(e) =>
                      updateDraft({
                        deliveryLeadTime: e.target.value,
                        deliveryForecast: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 rounded border border-blue-300 bg-white font-bold text-slate-900"
                  />
                </div>

                {/* Coluna 6: SLA (Nível de Serviço) */}
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-[#1e3a6e] mb-1">
                    SLA (Nível de Serviço)
                  </label>
                  <select
                    value={resolveProposalSlaOption(draft).id}
                    onChange={(e) => {
                      const opt = PROPOSAL_SLA_OPTIONS.find((o) => o.id === e.target.value) || PROPOSAL_SLA_OPTIONS[0];
                      updateDraft({
                        slaTier: opt.id,
                        slaAvailabilityPercent: opt.slaAvailabilityPercent,
                        slaResponseHours: opt.slaResponseHours,
                      });
                    }}
                    className="w-full px-2.5 py-2 rounded border border-blue-300 bg-white font-extrabold text-[#1e3a6e]"
                  >
                    {PROPOSAL_SLA_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.shortLabel || opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* LINHA 2 DO GESTÃOCLICK: Vendedor | E-mail do Vendedor | WhatsApp do Vendedor | Situação | Aos cuidados de */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5">
                <div className="sm:col-span-3">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Vendedor (Usuário do Sistema)
                  </label>
                  <select
                    value={draft.sellerName || ''}
                    onChange={(e) => {
                      const info = resolveProposalSellerContact({ sellerName: e.target.value });
                      updateDraft({
                        sellerName: e.target.value,
                        sellerEmail: info.email,
                        sellerPhone: info.phone,
                      });
                    }}
                    className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-semibold"
                  >
                    <option value="">Selecione</option>
                    <option value="Marcelo Mira">Marcelo Mira</option>
                    <option value="Marcelo Lopes Mira">Marcelo Lopes Mira</option>
                    <option value="Evelyn Ternero Seta Telecom">Evelyn Ternero Seta Telecom</option>
                    <option value="Maria Luiza">Maria Luiza</option>
                    <option value="Michelle da Rocha">Michelle da Rocha</option>
                    <option value="Paula Campos">Paula Campos</option>
                  </select>
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    E-mail do Vendedor
                  </label>
                  <input
                    type="email"
                    placeholder="vendedor@setatelecom.com.br"
                    value={draft.sellerEmail || resolveProposalSellerContact(draft).email}
                    onChange={(e) => updateDraft({ sellerEmail: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300 bg-white"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    WhatsApp do Vendedor
                  </label>
                  <input
                    type="text"
                    placeholder="(11) 99999-4929"
                    value={draft.sellerPhone || resolveProposalSellerContact(draft).phone}
                    onChange={(e) => updateDraft({ sellerPhone: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300 bg-white"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Situação</label>
                  <select
                    value={draft.status}
                    onChange={(e) =>
                      updateDraft({ status: e.target.value as ErpCommercialProposal['status'] })
                    }
                    className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-bold text-slate-800"
                  >
                    <option value="RASCUNHO">Em Aberto</option>
                    <option value="ENVIADA">Enviado ao Cliente</option>
                    <option value="EM_NEGOCIACAO">Em Negociação</option>
                    <option value="APROVADA">Aprovado</option>
                    <option value="CONVERTIDA_CONTRATO">Convertido em Contrato</option>
                    <option value="RECUSADA">Cancelado / Recusado</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Aos cuidados de
                  </label>
                  <input
                    type="text"
                    placeholder=""
                    value={draft.careOf ?? draft.contactName ?? ''}
                    onChange={(e) =>
                      updateDraft({ careOf: e.target.value, contactName: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded border border-slate-300"
                  />
                </div>
              </div>

              {/* LINHA 3 DO GESTÃOCLICK: Centro de custo | Título / Escopo Comercial | CNPJ / CPF | Prazo Contratual */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5">
                <div className="sm:col-span-3">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Centro de custo
                  </label>
                  <input
                    type="text"
                    list="gestaoclick-cost-centers"
                    placeholder="Digite para buscar"
                    value={draft.costCenter || ''}
                    onChange={(e) => updateDraft({ costCenter: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300 bg-white"
                  />
                  <datalist id="gestaoclick-cost-centers">
                    <option value="Comercial Telecom & TI" />
                    <option value="Locação de Ativos (MRR)" />
                    <option value="Projetos & Engenharia NOC" />
                    <option value="VENDAS" />
                  </datalist>
                </div>

                <div className="sm:col-span-5">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Título / Escopo Comercial da Proposta <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={draft.title}
                    onChange={(e) => updateDraft({ title: e.target.value })}
                    placeholder="Ex: Locação Central PABX IP Seta Cloud + Terminais Yealink"
                    className="w-full px-3 py-2 rounded border border-slate-300 font-bold text-slate-900"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">CNPJ / CPF</label>
                  <input
                    type="text"
                    placeholder="00.000.000/0000-00"
                    value={draft.companyCnpj || ''}
                    onChange={(e) => updateDraft({ companyCnpj: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Tempo de Contrato (Meses) *
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={draft.contractMonths}
                    onChange={(e) =>
                      updateDraft({ contractMonths: Math.max(1, Number(e.target.value) || 24) })
                    }
                    className="w-full px-3 py-2 rounded border border-slate-300 font-bold text-[#1e3a6e]"
                  />
                </div>
              </div>

              {/* LINHA DE CONFIGURAÇÃO POR TIPO DE PROPOSTA (PRODUTOS vs LOCAÇÃO vs SERVIÇOS) */}
              {(draft.budgetType === "SERVICOS" || draft.budgetType === "CONJUNTO") && (
                <div className="p-3.5 rounded-md border border-indigo-200 bg-indigo-50/50 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="block text-[11px] font-semibold text-indigo-950">
                      Tipo de Serviço (Exibido no Cabeçalho e Escopo da Proposta de Serviços) *
                    </label>
                    <span className="text-[10px] text-indigo-700">
                      Clique nos botões abaixo para combinar ou digite livremente
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {PROPOSAL_SERVICE_PILL_OPTIONS.map((pill) => {
                      const currentSvc = resolveProposalServiceType(draft);
                      const isSelected = currentSvc.toLowerCase().includes(pill.toLowerCase());
                      return (
                        <button
                          key={pill}
                          type="button"
                          onClick={() => {
                            const parts = currentSvc
                              .split(/,|\be\b|&/i)
                              .map((s) => s.trim())
                              .filter(Boolean);
                            const exists = parts.some((p) => p.toLowerCase() === pill.toLowerCase());
                            const nextParts = exists
                              ? parts.filter((p) => p.toLowerCase() !== pill.toLowerCase())
                              : [...parts, pill];
                            updateDraft({
                              serviceType:
                                nextParts.length > 0
                                  ? nextParts.join(", ")
                                  : "Suporte Técnico, Spare Parts / Hard Parts, Configuração e Instalação",
                            });
                          }}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border cursor-pointer transition ${
                            isSelected
                              ? "bg-[#1e3a6e] text-white border-[#1e3a6e]"
                              : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                          }`}
                        >
                          {isSelected ? `[x] ${pill}` : `+ ${pill}`}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    type="text"
                    list="proposal-service-type-options"
                    value={resolveProposalServiceType(draft)}
                    onChange={(e) => updateDraft({ serviceType: e.target.value })}
                    placeholder="Ex.: Suporte Técnico, Spare Parts / Hard Parts, Configuração e Instalação"
                    className="w-full px-3 py-2 rounded border border-indigo-300 bg-white font-semibold text-slate-900 text-xs"
                  />
                  <datalist id="proposal-service-type-options">
                    {PROPOSAL_SERVICE_TYPE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt} />
                    ))}
                  </datalist>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5 bg-blue-50/50 p-3 rounded border border-blue-200">
                {draft.budgetType !== "PRODUTOS" && (
                  <div className="sm:col-span-4">
                    <label className="block text-[11px] font-semibold text-[#1e3a6e] mb-1">
                      SLA Contratado (Acordo de Nível de Serviço) <span className="text-rose-600">*</span>
                    </label>
                    <select
                      value={resolveProposalSlaOption(draft).id}
                      onChange={(e) => {
                        const opt = PROPOSAL_SLA_OPTIONS.find((o) => o.id === e.target.value) || PROPOSAL_SLA_OPTIONS[0];
                        updateDraft({
                          slaTier: opt.id,
                          slaAvailabilityPercent: opt.slaAvailabilityPercent,
                          slaResponseHours: opt.slaResponseHours,
                        });
                      }}
                      className="w-full px-3 py-2 rounded border border-blue-300 bg-white font-semibold text-[#1e3a6e]"
                    >
                      {PROPOSAL_SLA_OPTIONS.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className={draft.budgetType === "PRODUTOS" ? "sm:col-span-6" : "sm:col-span-3"}>
                  <label className="block text-[11px] font-semibold text-[#1e3a6e] mb-1">
                    Prazo de Entrega
                  </label>
                  <input
                    type="text"
                    list="proposal-delivery-leadtime-options"
                    placeholder="Ex.: 10 dias úteis após o aceite"
                    value={resolveProposalDeliveryLeadTime(draft)}
                    onChange={(e) =>
                      updateDraft({
                        deliveryLeadTime: e.target.value,
                        deliveryForecast: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 rounded border border-blue-300 bg-white font-semibold text-slate-900"
                  />
                  <datalist id="proposal-delivery-leadtime-options">
                    {PROPOSAL_DELIVERY_SUGGESTIONS.map((item) => (
                      <option key={item} value={item} />
                    ))}
                  </datalist>
                </div>

                {draft.budgetType !== "PRODUTOS" && (
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-semibold text-[#1e3a6e] mb-1">
                      Vigência / Contrato
                    </label>
                    <select
                      value={[1, 6, 12, 24, 36, 48, 60].includes(Number(draft.contractMonths)) ? String(draft.contractMonths) : "24"}
                      onChange={(e) => updateDraft({ contractMonths: Math.max(1, Number(e.target.value) || 24) })}
                      className="w-full px-3 py-2 rounded border border-blue-300 bg-white font-semibold text-slate-900"
                    >
                      <option value="1">Avulso / 1 mês</option>
                      <option value="6">6 meses</option>
                      <option value="12">12 meses</option>
                      <option value="24">24 meses</option>
                      <option value="36">36 meses</option>
                      <option value="48">48 meses</option>
                      <option value="60">60 meses</option>
                    </select>
                  </div>
                )}

                <div className={draft.budgetType === "PRODUTOS" ? "sm:col-span-6" : "sm:col-span-3"}>
                  <div className="flex items-center justify-between mb-1">
                    <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#1e3a6e] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Number(draft.setupFee || 0) > 0}
                        onChange={(e) =>
                          updateDraft({ setupFee: e.target.checked ? (Number(draft.setupFee) > 0 ? Number(draft.setupFee) : 500) : 0 })
                        }
                        className="accent-[#1e3a6e]"
                      />
                      <span>Incluir Setup / Ativação (R$)</span>
                    </label>
                  </div>
                  {Number(draft.setupFee || 0) > 0 ? (
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={draft.setupFee ?? 0}
                      onChange={(e) =>
                        updateDraft({ setupFee: Math.max(0, Number(e.target.value) || 0) })
                      }
                      placeholder="Valor do Setup (Isolado)"
                      className="w-full px-3 py-2 rounded border border-blue-300 bg-white text-right font-semibold text-slate-900"
                    />
                  ) : (
                    <div className="px-3 py-2 rounded border border-dashed border-slate-300 bg-slate-50 text-[11px] text-slate-500">
                      Sem Setup (não exibido na proposta)
                    </div>
                  )}
                </div>
              </div>

              {/* LINHA 4 DO GESTÃOCLICK: Introdução da proposta */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Introdução da proposta
                </label>
                <textarea
                  rows={2}
                  placeholder="Valor Mensal de R$"
                  value={draft.introductionText ?? ''}
                  onChange={(e) => updateDraft({ introductionText: e.target.value })}
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>
            </div>
          </div>

          {/* BLOCO 2 DO GESTÃOCLICK: PREENCHA OS CAMPOS EXTRAS DA SUA EMPRESA (CAPA) */}
          <div className="bg-white rounded-md border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-5 py-3 bg-slate-50/80 border-b border-slate-200">
              <div className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-[#1e3a6e]" />
                <span>
                  Preencha os <span className="text-[#1e3a6e]">campos extras</span> da sua empresa
                </span>
              </div>
              <div className="text-[11px] text-slate-500">
                Campos que a sua empresa criou para os orçamentos
              </div>
            </div>
            <div className="p-5">
              <label className="block text-[11px] font-bold text-slate-700 mb-1">Capa</label>
              <input
                type="text"
                value={coverText}
                onChange={(e) => setCoverText(e.target.value)}
                placeholder="Texto ou identificador de capa da proposta (opcional)"
                className="w-full px-3 py-2 rounded border border-slate-300"
              />
            </div>
          </div>

          {/* BLOCO 2: PRODUTOS / EQUIPAMENTOS */}
          <div className="bg-white rounded-md border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-5 py-3 bg-slate-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-[#1e3a6e]" />
                <div>
                  <div className="text-sm font-bold text-slate-800">
                    Adicione os <span className="text-[#1e3a6e]">produtos</span> do orçamento ({productItemsWithIdx.length})
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Catálogo GestãoClick (786 produtos) • Locação de Bens Móveis (0% ISS — SV 31 STF) ou Venda de Hardware.
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Filtrar SKU/nome nos produtos..."
                  className="px-2.5 py-1.5 rounded border border-slate-300 bg-white text-xs w-48"
                />
                <select
                  value={selectedProductSku}
                  onChange={(e) => setSelectedProductSku(e.target.value)}
                  className="px-2.5 py-1.5 rounded border border-slate-300 bg-white text-xs max-w-xs"
                >
                  <option value="">-- Escolher produto do catálogo --</option>
                  {catalogProducts.slice(0, 60).map((c) => (
                    <option key={c.id} value={c.gestaoClickCode}>
                      {c.gestaoClickCode} — {c.name.slice(0, 48)} ({formatBRL(c.monthlyRentalPrice)})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleAddProductFromCatalog}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-[#1e3a6e] hover:bg-[#162b54] text-white text-xs font-extrabold cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> + Adicionar Produto
                </button>
              </div>
            </div>

            <div className="p-4 space-y-3">
              {productItemsWithIdx.length === 0 ? (
                <div className="text-center py-4 text-slate-400 text-xs">
                  Nenhum produto/equipamento adicionado neste orçamento. Clique em <strong>+ Adicionar Produto</strong> acima.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] border-b border-slate-200">
                      <tr>
                        <th className="py-2 px-2 w-28">SKU</th>
                        <th className="py-2 px-2">Produto / Equipamento</th>
                        <th className="py-2 px-2 w-28">Recorrência</th>
                        <th className="py-2 px-2 w-24 text-center">Qtd (Itens)</th>
                        <th className="py-2 px-2 w-28 text-right">Vlr. Unit. (R$)</th>
                        <th className="py-2 px-2 w-20 text-right">Desc. %</th>
                        <th className="py-2 px-2 w-24 text-right">Desc. R$</th>
                        <th className="py-2 px-2 w-28 text-right">Subtotal Líq.</th>
                        <th className="py-2 px-1 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {productItemsWithIdx.map(({ item, idx }) => (
                        <tr key={item.id || idx} className="hover:bg-slate-50/70">
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={item.sku}
                              onChange={(e) => {
                                const copy = [...draft.items];
                                copy[idx] = { ...copy[idx], sku: e.target.value };
                                updateDraft({ items: copy });
                              }}
                              className="w-full px-2 py-1 rounded border border-slate-300 font-mono text-[11px]"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={item.description}
                              onChange={(e) => {
                                const copy = [...draft.items];
                                copy[idx] = { ...copy[idx], description: e.target.value };
                                updateDraft({ items: copy });
                              }}
                              className="w-full px-2 py-1 rounded border border-slate-300 font-semibold"
                            />
                          </td>

                          <td className="py-2 px-2">
                            <select
                              value={item.isRecurring !== false ? 'MENSAL' : 'UNICO'}
                              onChange={(e) => {
                                const isRec = e.target.value === 'MENSAL';
                                const copy = [...draft.items];
                                copy[idx] = {
                                  ...copy[idx],
                                  isRecurring: isRec,
                                  unit: 'UN',
                                };
                                updateDraft({ items: copy });
                              }}
                              className="w-full px-2 py-1 rounded border border-slate-300 bg-white text-[11px]"
                            >
                              <option value="MENSAL">Mensal (MRR)</option>
                              <option value="UNICO">Único / Venda</option>
                            </select>
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="number"
                              min={1}
                              value={item.quantity}
                              onChange={(e) => {
                                const copy = [...draft.items];
                                copy[idx] = {
                                  ...copy[idx],
                                  quantity: Math.max(1, Number(e.target.value) || 1),
                                };
                                updateDraft({ items: copy });
                              }}
                              className="w-full px-2 py-1 rounded border border-slate-300 text-center font-bold"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={item.unitPrice}
                              onChange={(e) => {
                                const copy = [...draft.items];
                                copy[idx] = {
                                  ...copy[idx],
                                  unitPrice: Math.max(0, Number(e.target.value) || 0),
                                };
                                updateDraft({ items: copy });
                              }}
                              className="w-full px-2 py-1 rounded border border-slate-300 text-right font-semibold"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step="0.1"
                              value={item.discountPercent || 0}
                              onChange={(e) => {
                                const copy = [...draft.items];
                                copy[idx] = {
                                  ...copy[idx],
                                  discountPercent: Math.max(0, Number(e.target.value) || 0),
                                };
                                updateDraft({ items: copy });
                              }}
                              className="w-full px-2 py-1 rounded border border-slate-300 text-right"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={item.discountAmount || 0}
                              onChange={(e) => {
                                const copy = [...draft.items];
                                copy[idx] = {
                                  ...copy[idx],
                                  discountAmount: Math.max(0, Number(e.target.value) || 0),
                                };
                                updateDraft({ items: copy });
                              }}
                              className="w-full px-2 py-1 rounded border border-slate-300 text-right"
                            />
                          </td>
                          <td className="py-2 px-2 text-right font-extrabold text-slate-900">
                            {formatBRL(item.subtotal ?? item.totalMonthly)}
                          </td>
                          <td className="py-2 px-1 text-right">
                            <button
                              type="button"
                              disabled={draft.items.length <= 1}
                              onClick={() =>
                                updateDraft({
                                  items: draft.items.filter((_, i) => i !== idx),
                                })
                              }
                              className="p-1.5 rounded text-rose-600 hover:bg-rose-50 disabled:opacity-30 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex justify-end pt-2 border-t border-slate-100 text-xs">
                <span>
                  Subtotal Produtos / Equipamentos:{' '}
                  <strong className="text-[#1e3a6e] text-sm">
                    {formatBRL(draft.productsSubtotal || 0)}
                  </strong>
                </span>
              </div>
            </div>
          </div>

          {/* BLOCO 3: SERVIÇOS TÉCNICOS & TELECOM */}
          <div className="bg-white rounded-md border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-5 py-3 bg-slate-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Wrench className="w-4 h-4 text-[#1e3a6e]" />
                <div>
                  <div className="text-sm font-bold text-slate-800">
                    3. <span className="text-[#1e3a6e]">Serviços</span> Técnicos TI / Telecom ({serviceItemsWithIdx.length})
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Catálogo GestãoClick (39 serviços) • Enquadramento LC 116/03 (01.07, 01.03, 14.01, 21.01) e SCM/SVA.
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={serviceSearch}
                  onChange={(e) => setServiceSearch(e.target.value)}
                  placeholder="Filtrar serviço..."
                  className="px-2.5 py-1.5 rounded border border-slate-300 bg-white text-xs w-44"
                />
                <select
                  value={selectedServiceSku}
                  onChange={(e) => setSelectedServiceSku(e.target.value)}
                  className="px-2.5 py-1.5 rounded border border-slate-300 bg-white text-xs max-w-xs"
                >
                  <option value="">-- Escolher serviço do catálogo --</option>
                  {catalogServices.map((c) => (
                    <option key={c.id} value={c.gestaoClickCode}>
                      {c.gestaoClickCode} — {c.name.slice(0, 48)} ({formatBRL(c.monthlyRentalPrice)})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleAddServiceFromCatalog}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-extrabold cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> + Adicionar Serviço
                </button>
              </div>
            </div>

            <div className="p-4 space-y-3">
              {serviceItemsWithIdx.length === 0 ? (
                <div className="text-center py-4 text-slate-400 text-xs">
                  Nenhum serviço técnico incluído neste orçamento. Clique em <strong>+ Adicionar Serviço</strong> para incluir instalação, suporte NOC ou link SCM.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] border-b border-slate-200">
                      <tr>
                        <th className="py-2 px-2 w-28">Código</th>
                        <th className="py-2 px-2">Serviço / Escopo Técnico</th>
                        <th className="py-2 px-2 w-28">Recorrência</th>
                        <th className="py-2 px-2 w-24 text-center">Qtd (Itens)</th>
                        <th className="py-2 px-2 w-28 text-right">Vlr. Unit. (R$)</th>
                        <th className="py-2 px-2 w-20 text-right">Desc. %</th>
                        <th className="py-2 px-2 w-24 text-right">Desc. R$</th>
                        <th className="py-2 px-2 w-28 text-right">Subtotal Líq.</th>
                        <th className="py-2 px-1 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {serviceItemsWithIdx.map(({ item, idx }) => (
                        <tr key={item.id || idx} className="hover:bg-slate-50/70">
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={item.sku}
                              onChange={(e) => {
                                const copy = [...draft.items];
                                copy[idx] = { ...copy[idx], sku: e.target.value };
                                updateDraft({ items: copy });
                              }}
                              className="w-full px-2 py-1 rounded border border-slate-300 font-mono text-[11px]"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={item.description}
                              onChange={(e) => {
                                const copy = [...draft.items];
                                copy[idx] = { ...copy[idx], description: e.target.value };
                                updateDraft({ items: copy });
                              }}
                              className="w-full px-2 py-1 rounded border border-slate-300 font-semibold"
                            />
                          </td>

                          <td className="py-2 px-2">
                            <select
                              value={item.isRecurring !== false ? 'MENSAL' : 'UNICO'}
                              onChange={(e) => {
                                const isRec = e.target.value === 'MENSAL';
                                const copy = [...draft.items];
                                copy[idx] = {
                                  ...copy[idx],
                                  isRecurring: isRec,
                                  unit: isRec ? 'SV' : 'HR',
                                };
                                updateDraft({ items: copy });
                              }}
                              className="w-full px-2 py-1 rounded border border-slate-300 bg-white text-[11px]"
                            >
                              <option value="MENSAL">Mensal (MRR)</option>
                              <option value="UNICO">Taxa Única / Setup</option>
                            </select>
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="number"
                              min={1}
                              value={item.quantity}
                              onChange={(e) => {
                                const copy = [...draft.items];
                                copy[idx] = {
                                  ...copy[idx],
                                  quantity: Math.max(1, Number(e.target.value) || 1),
                                };
                                updateDraft({ items: copy });
                              }}
                              className="w-full px-2 py-1 rounded border border-slate-300 text-center font-bold"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={item.unitPrice}
                              onChange={(e) => {
                                const copy = [...draft.items];
                                copy[idx] = {
                                  ...copy[idx],
                                  unitPrice: Math.max(0, Number(e.target.value) || 0),
                                };
                                updateDraft({ items: copy });
                              }}
                              className="w-full px-2 py-1 rounded border border-slate-300 text-right font-semibold"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step="0.1"
                              value={item.discountPercent || 0}
                              onChange={(e) => {
                                const copy = [...draft.items];
                                copy[idx] = {
                                  ...copy[idx],
                                  discountPercent: Math.max(0, Number(e.target.value) || 0),
                                };
                                updateDraft({ items: copy });
                              }}
                              className="w-full px-2 py-1 rounded border border-slate-300 text-right"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={item.discountAmount || 0}
                              onChange={(e) => {
                                const copy = [...draft.items];
                                copy[idx] = {
                                  ...copy[idx],
                                  discountAmount: Math.max(0, Number(e.target.value) || 0),
                                };
                                updateDraft({ items: copy });
                              }}
                              className="w-full px-2 py-1 rounded border border-slate-300 text-right"
                            />
                          </td>
                          <td className="py-2 px-2 text-right font-extrabold text-indigo-900">
                            {formatBRL(item.subtotal ?? item.totalMonthly)}
                          </td>
                          <td className="py-2 px-1 text-right">
                            <button
                              type="button"
                              disabled={draft.items.length <= 1}
                              onClick={() =>
                                updateDraft({
                                  items: draft.items.filter((_, i) => i !== idx),
                                })
                              }
                              className="p-1.5 rounded text-rose-600 hover:bg-rose-50 disabled:opacity-30 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex justify-end pt-2 border-t border-slate-100 text-xs">
                <span>
                  Subtotal Serviços Técnicos:{' '}
                  <strong className="text-indigo-800 text-sm">
                    {formatBRL(draft.servicesSubtotal || 0)}
                  </strong>
                </span>
              </div>
            </div>
          </div>

          {/* BLOCO 4: TRANSPORTE / FRETE E ENDEREÇO DE ENTREGA */}
          <div className="bg-white rounded-md border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-5 py-3 bg-slate-50/80 border-b border-slate-200 flex items-center gap-2">
              <Truck className="w-4 h-4 text-[#1e3a6e]" />
              <div>
                <div className="text-sm font-bold text-slate-800">
                  4. Transporte / <span className="text-[#1e3a6e]">Frete e Endereço de Entrega</span>
                </div>
                <div className="text-[11px] text-slate-500">
                  Transportadora, valor do frete, endereço de instalação e índice de reajuste contratual.
                </div>
              </div>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Prazo de Entrega / Ativação
                </label>
                <input
                  type="text"
                  list="proposal-delivery-leadtime-options"
                  placeholder="Informe o prazo de entrega..."
                  value={resolveProposalDeliveryLeadTime(draft)}
                  onChange={(e) =>
                    updateDraft({
                      deliveryLeadTime: e.target.value,
                      deliveryForecast: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-semibold"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Transportadora / Modalidade de Envio
                </label>
                <select
                  value={draft.shippingCarrier || 'Frota Própria Seta Telecom'}
                  onChange={(e) => updateDraft({ shippingCarrier: e.target.value })}
                  className="w-full px-3 py-2 rounded border border-slate-300 bg-white"
                >
                  <option value="Frota Própria Seta Telecom">Frota Própria Seta Telecom (Técnico)</option>
                  <option value="Correios / SEDEX">Correios / SEDEX Empresarial</option>
                  <option value="Transportadora Braspress">Transportadora Braspress</option>
                  <option value="Sem Frete (Digital/Remoto)">Sem Frete (Ativação Remota / Cloud)</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Valor do Frete (R$)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={draft.shippingCost || 0}
                  onChange={(e) =>
                    updateDraft({ shippingCost: Math.max(0, Number(e.target.value) || 0) })
                  }
                  className="w-full px-3 py-2 rounded border border-slate-300 text-right font-bold"
                />
              </div>
              <div className="sm:col-span-4">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Endereço de Entrega / Instalação
                </label>
                <input
                  type="text"
                  value={draft.deliveryAddress || ''}
                  onChange={(e) => updateDraft({ deliveryAddress: e.target.value })}
                  placeholder="Ex: Av. Paulista, 1000 — Bela Vista, São Paulo/SP"
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>

            </div>
          </div>

          {/* BLOCO 5: TOTALIZADORES E CONDIÇÃO DE PAGAMENTO / PARCELAS */}
          <div className="bg-white rounded-md border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-5 py-3 bg-slate-50/80 border-b border-slate-200 flex items-center gap-2">
              <Calculator className="w-4 h-4 text-[#1e3a6e]" />
              <div>
                <div className="text-sm font-bold text-slate-800">
                  5. Totalizadores &amp; <span className="text-[#1e3a6e]">Condição de Pagamento / Parcelas</span>
                </div>
                <div className="text-[11px] text-slate-500">
                  Resumo financeiro em tempo real e gerador automático de cronograma de parcelas.
                </div>
              </div>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-8 gap-2.5 bg-slate-50 p-3.5 rounded-lg border border-slate-200">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">
                    Subtotal Produtos
                  </span>
                  <strong className="text-xs font-extrabold text-slate-900">
                    {formatBRL(draft.productsSubtotal || 0)}
                  </strong>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">
                    Subtotal Serviços
                  </span>
                  <strong className="text-xs font-extrabold text-indigo-900">
                    {formatBRL(draft.servicesSubtotal || 0)}
                  </strong>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">
                    Desconto Global (R$ / %)
                  </span>
                  <div className="flex items-center gap-1 mt-0.5">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={draft.discountAmount || 0}
                      onChange={(e) =>
                        updateDraft({ discountAmount: Math.max(0, Number(e.target.value) || 0) })
                      }
                      title="Desconto Global R$"
                      className="w-16 px-1.5 py-1 rounded border border-slate-300 bg-white text-right text-[11px]"
                    />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.5"
                      value={draft.discountPercentGlobal || 0}
                      onChange={(e) =>
                        updateDraft({
                          discountPercentGlobal: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      title="Desconto Global %"
                      className="w-12 px-1 py-1 rounded border border-slate-300 bg-white text-right text-[11px]"
                    />
                    <span className="text-[10px] text-slate-500">%</span>
                  </div>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">
                    Total Descontos
                  </span>
                  <strong className="text-xs font-bold text-rose-600">
                    - {formatBRL(itemDiscountsTotal + globalDiscountBrl)}
                  </strong>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">
                    Setup Único (Isolado)
                  </span>
                  <strong className="text-xs font-extrabold text-amber-800">
                    {formatBRL(draft.oneTimeSetupTotal || 0)}
                  </strong>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">
                    Frete (Isolado)
                  </span>
                  <strong className="text-xs font-bold text-slate-800">
                    {formatBRL(draft.shippingCost || 0)}
                  </strong>
                </div>
                <div className="bg-emerald-50 px-2.5 py-1.5 rounded border border-emerald-200">
                  <span className="text-[10px] uppercase font-extrabold text-emerald-700 block">
                    Valor Mensal
                  </span>
                  <strong className="text-sm font-black text-emerald-800">
                    {formatBRL(draft.monthlyRecurringTotal)}
                  </strong>
                </div>
                <div className="bg-[#1e3a6e] text-white px-2.5 py-1.5 rounded">
                  <span className="text-[10px] uppercase font-bold text-emerald-300 block">
                    Total / TCV ({draft.contractMonths}m)
                  </span>
                  <strong className="text-sm font-black text-white">
                    {formatBRL(draft.totalContractValue)}
                  </strong>
                </div>
              </div>

              {/* GERADOR AUTOMÁTICO DE PARCELAS */}
              <div className="border border-slate-200 rounded-lg p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-[#1e3a6e]" />
                    <span className="font-extrabold text-slate-800">
                      Gerador de Parcelas e Vencimentos (Padrão GestãoClick)
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {[
                      { label: 'À Vista', n: 1 },
                      { label: '2x', n: 2 },
                      { label: '3x', n: 3 },
                      { label: '6x', n: 6 },
                      { label: '12x', n: 12 },
                      { label: '24x', n: 24 },
                      { label: '36x', n: 36 },
                    ].map((preset) => (
                      <button
                        key={preset.n}
                        type="button"
                        onClick={() => handleGenerateInstallments(preset.n)}
                        className={`px-2.5 py-1 rounded text-[11px] font-bold cursor-pointer border ${
                          installmentCount === preset.n
                            ? 'bg-[#1e3a6e] text-white border-[#1e3a6e]'
                            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Nº Parcelas
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={installmentCount}
                      onChange={(e) => setInstallmentCount(Math.max(1, Number(e.target.value) || 1))}
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300 font-bold"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Forma de Pagamento
                    </label>
                    <select
                      value={defaultPaymentMethod}
                      onChange={(e) => setDefaultPaymentMethod(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-semibold"
                    >
                      <option value="BOLETO">Boleto Bancário Híbrido PIX</option>
                      <option value="PIX">PIX Empresarial</option>
                      <option value="TED">TED / Transferência Bancária</option>
                      <option value="CARTAO_CREDITO">Cartão de Crédito</option>
                      <option value="FATURAMENTO_MENSAL">Faturamento Mensal (Contrato)</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      1º Vencimento
                    </label>
                    <input
                      type="date"
                      value={firstDueDate}
                      onChange={(e) => setFirstDueDate(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Resumo da Condição de Pagamento
                    </label>
                    <input
                      type="text"
                      value={draft.paymentCondition}
                      onChange={(e) => updateDraft({ paymentCondition: e.target.value })}
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <button
                      type="button"
                      onClick={() => handleGenerateInstallments()}
                      className="w-full px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs cursor-pointer"
                    >
                      Gerar Parcelas
                    </button>
                  </div>
                </div>

                {Array.isArray(draft.installments) && draft.installments.length > 0 && (
                  <div className="overflow-x-auto pt-2">
                    <table className="w-full text-left text-xs border border-slate-200 rounded">
                      <thead className="bg-slate-100 text-slate-600 uppercase text-[10px]">
                        <tr>
                          <th className="py-1.5 px-2.5 w-16">Parcela</th>
                          <th className="py-1.5 px-2.5 w-36">Vencimento</th>
                          <th className="py-1.5 px-2.5 w-36">Valor (R$)</th>
                          <th className="py-1.5 px-2.5 w-48">Forma de Pagamento</th>
                          <th className="py-1.5 px-2.5">Observação</th>
                          <th className="py-1.5 px-2 w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {draft.installments.map((inst, idx) => (
                          <tr key={idx}>
                            <td className="py-1.5 px-2.5 font-mono font-bold">#{inst.number}</td>
                            <td className="py-1.5 px-2.5">
                              <input
                                type="date"
                                value={inst.dueDate}
                                onChange={(e) => {
                                  const copy = [...(draft.installments || [])];
                                  copy[idx] = { ...copy[idx], dueDate: e.target.value };
                                  updateDraft({ installments: copy });
                                }}
                                className="w-full px-2 py-1 rounded border border-slate-300"
                              />
                            </td>
                            <td className="py-1.5 px-2.5">
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={inst.amount}
                                onChange={(e) => {
                                  const copy = [...(draft.installments || [])];
                                  copy[idx] = {
                                    ...copy[idx],
                                    amount: Math.max(0, Number(e.target.value) || 0),
                                  };
                                  updateDraft({ installments: copy });
                                }}
                                className="w-full px-2 py-1 rounded border border-slate-300 text-right font-bold"
                              />
                            </td>
                            <td className="py-1.5 px-2.5">
                              <select
                                value={inst.paymentMethod}
                                onChange={(e) => {
                                  const copy = [...(draft.installments || [])];
                                  copy[idx] = { ...copy[idx], paymentMethod: e.target.value };
                                  updateDraft({ installments: copy });
                                }}
                                className="w-full px-2 py-1 rounded border border-slate-300 bg-white"
                              >
                                <option value="BOLETO">Boleto Bancário</option>
                                <option value="PIX">PIX Empresarial</option>
                                <option value="TED">TED Bancária</option>
                                <option value="CARTAO_CREDITO">Cartão de Crédito</option>
                                <option value="FATURAMENTO_MENSAL">Faturamento Mensal</option>
                              </select>
                            </td>
                            <td className="py-1.5 px-2.5">
                              <input
                                type="text"
                                value={inst.notes || ''}
                                onChange={(e) => {
                                  const copy = [...(draft.installments || [])];
                                  copy[idx] = { ...copy[idx], notes: e.target.value };
                                  updateDraft({ installments: copy });
                                }}
                                className="w-full px-2 py-1 rounded border border-slate-300"
                              />
                            </td>
                            <td className="py-1.5 px-2 text-right">
                              <button
                                type="button"
                                onClick={() => {
                                  const copy = (draft.installments || []).filter((_, i) => i !== idx);
                                  updateDraft({ installments: copy });
                                }}
                                className="text-rose-600 hover:text-rose-800 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* BLOCO 6: OBSERVAÇÕES COMERCIAIS/FISCAIS E OBSERVAÇÕES INTERNAS */}
          <div className="bg-white rounded-md border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-5 py-3 bg-slate-50/80 border-b border-slate-200">
              <div className="text-sm font-bold text-slate-800">
                6. Observações Comerciais, <span className="text-[#1e3a6e]">Cláusulas SLA &amp; Notas Internas</span>
              </div>
              <div className="text-[11px] text-slate-500">
                Observações impressas no PDF A4 do cliente e anotações de uso exclusivo interno.
              </div>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Observações Comerciais &amp; Fiscais (Sai no PDF)
                </label>
                <textarea
                  rows={3}
                  value={draft.commercialNotes}
                  onChange={(e) => updateDraft({ commercialNotes: e.target.value })}
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Cláusulas Técnicas, Remessa CFOP 5.908 &amp; SLA (Sai no PDF)
                </label>
                <textarea
                  rows={3}
                  value={draft.technicalClauses}
                  onChange={(e) => updateDraft({ technicalClauses: e.target.value })}
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-amber-800 mb-1">
                  Observações Internas (Uso exclusivo interno — NÃO sai no PDF)
                </label>
                <textarea
                  rows={3}
                  value={draft.internalNotes || ''}
                  onChange={(e) => updateDraft({ internalNotes: e.target.value })}
                  placeholder="Anotações confidenciais da negociação, margem ou aprovação..."
                  className="w-full px-3 py-2 rounded border border-amber-300 bg-amber-50/30"
                />
              </div>
            </div>
          </div>

          {/* BLOCO 7: VERSÕES DA PROPOSTA (SIMPLES, DIRETO E COM OS 3 BOTÕES: ABRIR TELA, PDF E RESTAURAR) */}
          <div className="bg-white rounded-md border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-5 py-3 bg-[#1e3a6e] text-white flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-emerald-300" />
                <div>
                  <div className="text-sm font-extrabold flex items-center gap-2">
                    <span>Versões da Proposta ({versionHistoryList.length})</span>
                    <span className="px-2 py-0.5 rounded bg-emerald-400 text-slate-950 text-[10px] font-black">
                      Versão Atual: Versão {draft.version || 1}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-200">
                    Abra a tela de qualquer versão anterior, gere o PDF A4 ou restaure em 1 clique.
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowVersionHistoryPanel((v) => !v)}
                className="px-3 py-1 rounded bg-white/15 hover:bg-white/25 text-white text-xs font-bold cursor-pointer"
              >
                {showVersionHistoryPanel ? "Ocultar Versões ▲" : `Ver Versões (${versionHistoryList.length}) ▼`}
              </button>
            </div>

            {showVersionHistoryPanel && (
              <div className="p-4 space-y-3">
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-700 font-extrabold uppercase text-[10px] border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-3 w-36">Versão</th>
                        <th className="py-2.5 px-3 w-48">Data / Hora &amp; Responsável</th>
                        <th className="py-2.5 px-3">Valor Mensal / Resumo</th>
                        <th className="py-2.5 px-3 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {versionHistoryList.map((ver, idx) => {
                        const isCurrentVer = idx === 0;
                        const snap = ver.snapshot;
                        const savedDateFormatted = ver.savedAt
                          ? new Date(ver.savedAt).toLocaleString("pt-BR")
                          : "—";
                        const screenUrl = buildProposalVersionUrl(draft, ver);
                        const pdfUrl = buildProposalVersionUrl(draft, ver, { autoPrint: true });

                        return (
                          <tr
                            key={`${ver.version}-${ver.savedAt}`}
                            className={isCurrentVer ? "bg-emerald-50/40" : "hover:bg-slate-50"}
                          >
                            <td className="py-3 px-3">
                              <div className="flex items-center gap-2">
                                <span className="font-extrabold text-xs text-[#0d2b4e]">
                                  Versão {ver.version}
                                </span>
                                {isCurrentVer ? (
                                  <span className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-extrabold">
                                    ATUAL
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px] font-bold">
                                    ANTERIOR
                                  </span>
                                )}
                              </div>
                            </td>

                            <td className="py-3 px-3 text-slate-600">
                              <div className="font-semibold text-slate-800">{savedDateFormatted}</div>
                              <div className="text-[10px] text-slate-500">
                                {ver.savedBy || "Marcelo Lopes Mira"}
                              </div>
                            </td>

                            <td className="py-3 px-3">
                              <div className="font-extrabold text-emerald-700">
                                {formatBRL(snap.monthlyRecurringTotal || 0)}/mês •{" "}
                                {(snap.items || []).length}{" "}
                                {(snap.items || []).length === 1 ? "item" : "itens"} •{" "}
                                {snap.contractMonths} meses
                              </div>
                              <div className="text-[11px] text-slate-600">{ver.changeSummary}</div>
                            </td>

                            <td className="py-3 px-3 text-right">
                              <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                <a
                                  href={screenUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-100 text-[#1e3a6e] text-[11px] font-extrabold"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  <span>Abrir Tela da Versão</span>
                                </a>

                                <a
                                  href={pdfUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white text-[11px] font-extrabold"
                                >
                                  <Printer className="w-3 h-3" />
                                  <span>Baixar / Imprimir PDF</span>
                                </a>

                                <button
                                  type="button"
                                  disabled={restoringVersionNum === ver.version}
                                  onClick={() => handleLoadVersionSnapshotIntoForm(ver)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#1e3a6e] hover:bg-[#162b54] text-white text-[11px] font-extrabold cursor-pointer disabled:opacity-50"
                                >
                                  <RotateCcw className="w-3 h-3 text-emerald-300" />
                                  <span>Restaurar esta versão</span>
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

          {/* RODAPÉ FIXO DO GESTÃOCLICK */}
          <div className="bg-white rounded-md border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancelar
              </button>
              {!isNew && onGenerateContract && (
                <button
                  type="button"
                  onClick={() => onGenerateContract(draft)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-xs cursor-pointer"
                >
                  <FileCheck2 className="w-4 h-4" />
                  <span>Gerar Contrato</span>
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <div className="text-right">
                <span className="block text-[10px] text-slate-500">
                  MRR Mensal: <strong>{formatBRL(draft.monthlyRecurringTotal)}/mês</strong> • Setup:{' '}
                  <strong>{formatBRL(draft.oneTimeSetupTotal)}</strong> • Frete:{' '}
                  <strong>{formatBRL(draft.shippingCost || 0)}</strong>
                </span>
                <strong className="text-base font-black text-[#1e3a6e]">
                  Valor Global ({draft.contractMonths}m): {formatBRL(draft.totalContractValue)}
                </strong>
              </div>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold shadow-sm cursor-pointer"
              >
                <Save className="w-4 h-4" />
                {saving
                  ? 'Salvando...'
                  : isNew
                    ? 'Cadastrar Orçamento & Gerar Link PDF A4'
                    : 'Salvar Alterações & Atualizar Link PDF'}
              </button>
            </div>
          </div>
        </form>

        {/* MODAL SOBREPOSTO INLINE: "+ ADICIONAR NOVO" CLIENTE DIRETO NA TELA DE PROPOSTA (SEM PERDER O ORÇAMENTO) */}
        {showQuickClientModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 overflow-y-auto">
            <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-2xl w-full overflow-hidden my-6 text-xs">
              <div className="px-5 py-3.5 bg-[#10b981] text-white flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Building2 className="w-5 h-5" />
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-emerald-100 block">
                      Cadastro Rápido Integrado ao Orçamento (Receita Federal + GestãoClick)
                    </span>
                    <h3 className="text-sm font-extrabold">
                      + Adicionar Novo Cliente e Vincular Automaticamente à Proposta
                    </h3>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowQuickClientModal(false)}
                  className="text-white/80 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 space-y-3.5 max-h-[80vh] overflow-y-auto">
                {qcRfbBanner && (
                  <div className="p-3 rounded bg-emerald-950 text-emerald-300 border border-emerald-500 font-bold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{qcRfbBanner}</span>
                  </div>
                )}
                {qcErrorMsg && (
                  <div className="p-3 rounded bg-rose-50 text-rose-800 border border-rose-300 font-bold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>{qcErrorMsg}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-3">
                    <label className="block font-bold text-slate-700 mb-1">Tipo de Pessoa</label>
                    <select
                      value={qcPersonType}
                      onChange={(e) => setQcPersonType(e.target.value as 'PJ' | 'PF')}
                      className="w-full px-2.5 py-2 rounded border border-slate-300 bg-white font-semibold"
                    >
                      <option value="PJ">Pessoa Jurídica (CNPJ)</option>
                      <option value="PF">Pessoa Física (CPF)</option>
                    </select>
                  </div>
                  <div className="sm:col-span-5">
                    <label className="block font-bold text-slate-700 mb-1">
                      {qcPersonType === 'PF' ? 'CPF *' : 'CNPJ *'}
                    </label>
                    <input
                      type="text"
                      value={qcCnpjCpf}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const digits = raw.replace(/\D+/g, '');
                        const formatted =
                          qcPersonType === 'PF' ? formatCpfMask(digits) : formatCnpjMask(digits);
                        setQcCnpjCpf(formatted);
                        if (qcPersonType === 'PJ' && digits.length === 14) {
                          handleLookupQuickClientRfb(digits);
                        }
                      }}
                      placeholder={qcPersonType === 'PF' ? '000.000.000-00' : '00.000.000/0001-00'}
                      className="w-full px-3 py-2 rounded border border-slate-300 font-mono font-bold text-slate-900"
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <button
                      type="button"
                      disabled={qcLookingUpRfb || qcPersonType === 'PF'}
                      onClick={() => handleLookupQuickClientRfb(qcCnpjCpf)}
                      className="w-full py-2 px-3 rounded bg-[#1e3a6e] hover:bg-[#162b54] text-white font-extrabold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40"
                    >
                      <Search className="w-3.5 h-3.5 text-emerald-300" />
                      <span>{qcLookingUpRfb ? 'Consultando RFB...' : 'Consultar Receita Federal'}</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      Razão Social / Nome Completo *
                    </label>
                    <input
                      type="text"
                      value={qcLegalName}
                      onChange={(e) => setQcLegalName(e.target.value)}
                      placeholder="Ex.: Digisystem Serviços Especializados LTDA"
                      className="w-full px-3 py-2 rounded border border-slate-300 font-bold text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Nome Fantasia</label>
                    <input
                      type="text"
                      value={qcTradeName}
                      onChange={(e) => setQcTradeName(e.target.value)}
                      placeholder="Ex.: Digisystem Tecnologia"
                      className="w-full px-3 py-2 rounded border border-slate-300"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Inscrição Estadual</label>
                    <input
                      type="text"
                      value={qcIe}
                      onChange={(e) => setQcIe(e.target.value)}
                      className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Telefone / WhatsApp</label>
                    <input
                      type="text"
                      value={qcPhone}
                      onChange={(e) => setQcPhone(formatBrPhoneMask(e.target.value))}
                      placeholder="(11) 90000-0000"
                      className="w-full px-3 py-2 rounded border border-slate-300"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">E-mail Comercial / NFe</label>
                    <input
                      type="email"
                      value={qcEmail}
                      onChange={(e) => setQcEmail(e.target.value)}
                      placeholder="contato@empresa.com.br"
                      className="w-full px-3 py-2 rounded border border-slate-300"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <div className="sm:col-span-3">
                    <label className="block font-bold text-slate-700 mb-1">CEP</label>
                    <input
                      type="text"
                      value={qcCep}
                      onChange={(e) => setQcCep(e.target.value)}
                      placeholder="00000-000"
                      className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
                    />
                  </div>
                  <div className="sm:col-span-5">
                    <label className="block font-bold text-slate-700 mb-1">Logradouro</label>
                    <input
                      type="text"
                      value={qcStreet}
                      onChange={(e) => setQcStreet(e.target.value)}
                      className="w-full px-3 py-2 rounded border border-slate-300"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block font-bold text-slate-700 mb-1">Número</label>
                    <input
                      type="text"
                      value={qcNumber}
                      onChange={(e) => setQcNumber(e.target.value)}
                      className="w-full px-3 py-2 rounded border border-slate-300"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block font-bold text-slate-700 mb-1">UF</label>
                    <input
                      type="text"
                      value={qcState}
                      onChange={(e) => setQcState(e.target.value.toUpperCase())}
                      className="w-full px-3 py-2 rounded border border-slate-300 font-bold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Cidade</label>
                    <input
                      type="text"
                      value={qcCity}
                      onChange={(e) => setQcCity(e.target.value)}
                      className="w-full px-3 py-2 rounded border border-slate-300"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      Aos cuidados de (Contato na Proposta)
                    </label>
                    <input
                      type="text"
                      value={qcCareOf}
                      onChange={(e) => setQcCareOf(e.target.value)}
                      placeholder="Ex.: Diretoria de TI / Compras"
                      className="w-full px-3 py-2 rounded border border-slate-300"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setShowQuickClientModal(false)}
                    className="px-4 py-2 rounded border border-slate-300 font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={qcSaving}
                    onClick={handleSaveAndLinkQuickClient}
                    className="px-5 py-2 rounded bg-[#10b981] hover:bg-emerald-600 text-white font-extrabold shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    {qcSaving ? 'Salvando e Vinculando...' : 'Salvar e Vincular à Proposta'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function computeContractEndDate(startDateStr: string, months: number): string {
  const base = startDateStr ? new Date(`${startDateStr.slice(0, 10)}T12:00:00Z`) : new Date();
  if (Number.isNaN(base.getTime())) return startDateStr;
  const target = new Date(base);
  target.setUTCMonth(target.getUTCMonth() + Math.max(1, Number(months || 24)));
  return target.toISOString().slice(0, 10);
}

// 2. RENTAL CONTRACT FULL EDITOR MODAL (COM 6 ABAS SEPARADAS: DADOS GERAIS, RENOVAR VIGÊNCIA, FATURAMENTO, REAJUSTE & ADITIVOS, EQUIPAMENTOS S/N, DOCUMENTO PDF)
export type ContractModalTabId =
  | 'DADOS_GERAIS'
  | 'RENOVAR_VIGENCIA'
  | 'FATURAMENTO_RECIBOS'
  | 'REAJUSTE_ADITIVOS'
  | 'EQUIPAMENTOS_PATRIMONIO'
  | 'DOCUMENTO_HISTORICO';

export function ContractEditModal({
  contract,
  initialTab = 'DADOS_GERAIS',
  readOnly: readOnlyProp = false,
  onClose,
  onSave,
  onDelete,
  onGenerateInvoice,
  onGenerateRemessaNfe,
  onOpenPartialReturn,
  onShowToast,
}: {
  contract: ErpRentalContract;
  initialTab?: ContractModalTabId;
  readOnly?: boolean;
  onClose: () => void;
  onSave: (updated: ErpRentalContract) => Promise<void>;
  onDelete?: (contract: ErpRentalContract) => Promise<void>;
  onGenerateInvoice?: (contractId: string) => Promise<void>;
  onGenerateRemessaNfe?: (contractId: string) => Promise<void>;
  onOpenPartialReturn?: (contract: ErpRentalContract) => void;
  onShowToast?: (msg: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<ContractModalTabId>(initialTab);
  const [isReadOnly, setIsReadOnly] = useState<boolean>(Boolean(readOnlyProp));
  const [draft, setDraft] = useState<ErpRentalContract>(() => ({
    ...structuredClone(contract),
    modality: contract.modality || 'LOCACAO',
  }));
  const [autoSyncMonthly, setAutoSyncMonthly] = useState<boolean>(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [renewalPresetMode, setRenewalPresetMode] = useState<
    '12' | '24' | '36' | '48' | '60' | 'CUSTOM'
  >('12');
  const [customDurationUnit, setCustomDurationUnit] = useState<'MONTHS' | 'DAYS' | 'DATES'>('MONTHS');
  const [customMonthsValue, setCustomMonthsValue] = useState<string>('18');
  const [customDaysValue, setCustomDaysValue] = useState<string>('90');
  const [renewalReadjustmentPercent, setRenewalReadjustmentPercent] = useState<string>('0');
  const [renewalSlaText, setRenewalSlaText] = useState<string>(
    'SLA 99,95% NOC 24x7 com Substituição Expressa (Advance Replacement em 4h)'
  );

  const [billingCompetence, setBillingCompetence] = useState<string>(
    draft.lastBilledCompetence || '10/2026'
  );
  const [billingIssuing, setBillingIssuing] = useState<boolean>(false);

  const [readjPercentInput, setReadjPercentInput] = useState<string>(
    draft.readjustmentIndex === 'IGP-M' ? '3.80' : '4.50'
  );
  const [readjNoteInput, setReadjNoteInput] = useState<string>(
    `Reajuste contratual ${draft.readjustmentIndex || 'IPCA'} aplicado sobre a vigência`
  );

  const sumEquipmentsMonthly = (equipments: ErpRentalEquipmentItem[]) =>
    equipments.reduce(
      (sum, eq) => sum + Math.max(1, Number(eq.quantity || 1)) * Number(eq.unitMonthlyRent || 0),
      0
    );

  const sumEquipmentsPatrimony = (equipments: ErpRentalEquipmentItem[]) =>
    equipments.reduce((sum, eq) => sum + Number(eq.assetValueBrl || 0), 0);

  const updateEquipments = (nextEquipments: ErpRentalEquipmentItem[]) => {
    const computedMonthly = sumEquipmentsMonthly(nextEquipments);
    setDraft((prev) => ({
      ...prev,
      equipments: nextEquipments,
      monthlyValue: autoSyncMonthly && computedMonthly > 0 ? computedMonthly : prev.monthlyValue,
    }));
  };

  const applyRenewalDurationToDraft = (
    preset: '12' | '24' | '36' | '48' | '60' | 'CUSTOM',
    unit: 'MONTHS' | 'DAYS' | 'DATES',
    monthsStr: string,
    daysStr: string
  ) => {
    const baseStart = draft.startDate || new Date().toISOString().slice(0, 10);
    if (preset !== 'CUSTOM') {
      const m = Number(preset);
      const nextEnd = computeContractEndDate(baseStart, m);
      setDraft((prev) => ({
        ...prev,
        contractMonths: m,
        endDate: nextEnd,
        status: 'ATIVO',
      }));
      return;
    }
    if (unit === 'MONTHS') {
      const m = Math.max(1, Number(monthsStr) || 1);
      const nextEnd = computeContractEndDate(baseStart, m);
      setDraft((prev) => ({
        ...prev,
        contractMonths: m,
        endDate: nextEnd,
        status: 'ATIVO',
      }));
    } else if (unit === 'DAYS') {
      const d = Math.max(1, Number(daysStr) || 30);
      const dt = new Date(`${baseStart.slice(0, 10)}T12:00:00Z`);
      if (!Number.isNaN(dt.getTime())) {
        dt.setUTCDate(dt.getUTCDate() + d);
        setDraft((prev) => ({
          ...prev,
          contractMonths: Math.max(1, Math.round(d / 30)),
          endDate: dt.toISOString().slice(0, 10),
          status: 'ATIVO',
        }));
      }
    }
  };

  const handleConfirmRenewalAndSave = async () => {
    setSaving(true);
    try {
      const pct = Number(renewalReadjustmentPercent) || 0;
      const updatedMonthly =
        pct > 0
          ? Math.round(draft.monthlyValue * (1 + pct / 100) * 100) / 100
          : draft.monthlyValue;
      const updatedContract: ErpRentalContract = {
        ...draft,
        monthlyValue: updatedMonthly,
        status: 'ATIVO',
        ...(pct > 0
          ? {
              lastReadjustmentDate: new Date().toLocaleDateString('pt-BR'),
              lastReadjustmentPercent: pct,
            }
          : {}),
        updatedAt: new Date().toISOString(),
      };
      await onSave(updatedContract);
      onShowToast?.(
        `Vigência do contrato ${updatedContract.contractNumber} renovada até ${updatedContract.endDate} e dados confirmados!`
      );
    } finally {
      setSaving(false);
    }
  };

  const handleApplyReadjustmentInsideTab = async () => {
    setSaving(true);
    try {
      const pct = Number(readjPercentInput) || 0;
      const prevVal = draft.monthlyValue;
      const nextVal = Math.round(prevVal * (1 + pct / 100) * 100) / 100;
      const historyEntry = {
        id: `rh-${Date.now()}`,
        appliedAt: new Date().toLocaleDateString('pt-BR'),
        index: draft.readjustmentIndex,
        percentage: pct,
        previousMonthlyValue: prevVal,
        newMonthlyValue: nextVal,
        note: readjNoteInput,
      };
      const updatedContract: ErpRentalContract = {
        ...draft,
        monthlyValue: nextVal,
        lastReadjustmentDate: historyEntry.appliedAt,
        lastReadjustmentPercent: pct,
        readjustmentHistory: [historyEntry, ...(draft.readjustmentHistory || [])],
        updatedAt: new Date().toISOString(),
      };
      setDraft(updatedContract);
      await onSave(updatedContract);
      onShowToast?.(
        `Reajuste (${draft.readjustmentIndex} +${pct}%) confirmado e salvo no contrato ${updatedContract.contractNumber}!`
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  const CONTRACT_TABS: Array<{ id: ContractModalTabId; label: string }> = [
    { id: 'DADOS_GERAIS', label: '1. Dados Gerais & Revisão' },
    { id: 'RENOVAR_VIGENCIA', label: '2. Renovar Vigência' },
    { id: 'FATURAMENTO_RECIBOS', label: '3. Faturamento & Recibos' },
    { id: 'REAJUSTE_ADITIVOS', label: '4. Reajuste & Aditivos' },
    { id: 'EQUIPAMENTOS_PATRIMONIO', label: `5. Equipamentos & Patrimônio (${draft.equipments.length})` },
    { id: 'DOCUMENTO_HISTORICO', label: '6. Documento PDF & Histórico' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/75 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-6xl w-full overflow-hidden my-4">
        <div className="px-5 py-3.5 bg-[#0d2b4e] text-white flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <FileCheck2 className="w-5 h-5 text-emerald-300" />
            <div>
              <span className="text-[10px] font-extrabold uppercase text-emerald-300 block">
                Central do Contrato • Seta Telecom ERP (6 Abas de Gestão e Confirmação)
              </span>
              <h3 className="text-sm sm:text-base font-extrabold">
                {draft.contractNumber || 'Novo Contrato'} — {draft.companyName || 'Selecione ou Preencha a Locatária'}
              </h3>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isReadOnly && (
              <button
                type="button"
                onClick={() => setIsReadOnly(false)}
                className="px-3 py-1.5 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold cursor-pointer"
              >
                Habilitar Edição
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-slate-300 hover:text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="bg-slate-100 border-b border-slate-200 px-4 py-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {CONTRACT_TABS.map((tab) => {
            const act = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`shrink-0 px-3.5 py-2 rounded-lg text-xs font-extrabold transition cursor-pointer ${
                  act
                    ? 'bg-[#1e3a6e] text-white shadow-xs'
                    : 'bg-white text-slate-700 hover:bg-slate-50 border border-slate-200'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 text-xs max-h-[82vh] overflow-y-auto">
          {activeTab === 'DADOS_GERAIS' && (
            <fieldset disabled={isReadOnly} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Nº do Contrato</label>
                  <input
                    type="text"
                    value={draft.contractNumber}
                    onChange={(e) => setDraft({ ...draft, contractNumber: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300 font-mono font-bold"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-bold text-slate-700 mb-1">Objeto / Título do Contrato *</label>
                  <input
                    type="text"
                    required
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300 font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Modalidade Contratual</label>
                  <select
                    value={draft.modality || 'LOCACAO'}
                    onChange={(e) =>
                      setDraft({ ...draft, modality: e.target.value as ErpContractModality })
                    }
                    className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-bold text-indigo-950"
                  >
                    <option value="LOCACAO">Locação de Equipamentos (0% ISS — SV 31 STF)</option>
                    <option value="SERVICO">Serviços Técnicos / NOC (LC 116)</option>
                    <option value="ASSINATURA">Assinatura / Telecom SCM</option>
                    <option value="HIBRIDO">Híbrido (Locação + Serviços)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-bold text-slate-700 mb-1">Empresa Locatária / Contratante *</label>
                  <input
                    type="text"
                    required
                    value={draft.companyName}
                    onChange={(e) => setDraft({ ...draft, companyName: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300 font-semibold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">CNPJ</label>
                  <input
                    type="text"
                    value={draft.companyCnpj}
                    onChange={(e) => setDraft({ ...draft, companyCnpj: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Status de Vigência</label>
                  <select
                    value={draft.status}
                    onChange={(e) =>
                      setDraft({ ...draft, status: e.target.value as ErpRentalContract['status'] })
                    }
                    className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-bold"
                  >
                    <option value="ATIVO">ATIVO</option>
                    <option value="EM_IMPLANTACAO">EM IMPLANTAÇÃO</option>
                    <option value="RENOVACAO_PROXIMA">RENOVAÇÃO PRÓXIMA</option>
                    <option value="ENCERRADO">ENCERRADO</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Início da Vigência</label>
                  <input
                    type="date"
                    value={(draft.startDate || '').slice(0, 10)}
                    onChange={(e) => {
                      const nextStart = e.target.value;
                      const nextEnd = computeContractEndDate(nextStart, draft.contractMonths);
                      setDraft({ ...draft, startDate: nextStart, endDate: nextEnd });
                    }}
                    className="w-full px-2.5 py-2 rounded border border-slate-300 bg-white font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Prazo (Meses)</label>
                  <input
                    type="number"
                    min={1}
                    value={draft.contractMonths}
                    onChange={(e) => {
                      const nextMonths = Math.max(1, Number(e.target.value) || 24);
                      const nextEnd = computeContractEndDate(draft.startDate, nextMonths);
                      setDraft({ ...draft, contractMonths: nextMonths, endDate: nextEnd });
                    }}
                    className="w-full px-2.5 py-2 rounded border border-slate-300 bg-white font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Fim da Vigência</label>
                  <input
                    type="date"
                    value={(draft.endDate || '').slice(0, 10)}
                    onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
                    className="w-full px-2.5 py-2 rounded border border-slate-300 bg-white font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Dia Vencimento</label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={draft.dueDay}
                    onChange={(e) => setDraft({ ...draft, dueDay: Number(e.target.value) || 10 })}
                    className="w-full px-2.5 py-2 rounded border border-slate-300 bg-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Índice Reajuste</label>
                  <select
                    value={draft.readjustmentIndex}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        readjustmentIndex: e.target.value as 'IPCA' | 'IGP-M' | 'FIXO' | 'IST_ANATEL',
                      })
                    }
                    className="w-full px-2.5 py-2 rounded border border-slate-300 bg-white font-bold"
                  >
                    <option value="IPCA">IPCA (IBGE)</option>
                    <option value="IGP-M">IGP-M (FGV)</option>
                    <option value="IST_ANATEL">IST Anatel</option>
                    <option value="FIXO">FIXO / Negociado</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Mensalidade (R$)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={draft.monthlyValue}
                    onChange={(e) => {
                      setAutoSyncMonthly(false);
                      setDraft({ ...draft, monthlyValue: Number(e.target.value) || 0 });
                    }}
                    className="w-full px-2.5 py-2 rounded border border-slate-300 bg-white font-extrabold text-emerald-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">NF-e Remessa Nº &amp; CFOP</label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={draft.remessaNfeNumber}
                      onChange={(e) => setDraft({ ...draft, remessaNfeNumber: e.target.value })}
                      placeholder="Nº NF-e Remessa"
                      className="px-3 py-2 rounded border border-slate-300 font-mono"
                    />
                    <select
                      value={draft.remessaCfop}
                      onChange={(e) =>
                        setDraft({ ...draft, remessaCfop: e.target.value as '5.908' | '6.908' })
                      }
                      className="px-3 py-2 rounded border border-slate-300 bg-white font-mono font-bold"
                    >
                      <option value="5.908">CFOP 5.908 (Estadual)</option>
                      <option value="6.908">CFOP 6.908 (Interestadual)</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Amparo Legal &amp; Observações Fiscais</label>
                  <input
                    type="text"
                    value={draft.legalBasisNote}
                    onChange={(e) => setDraft({ ...draft, legalBasisNote: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300"
                  />
                </div>
              </div>
            </fieldset>
          )}

          {activeTab === 'RENOVAR_VIGENCIA' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-emerald-50/80 border border-emerald-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-[10px] font-black uppercase text-emerald-800 block">
                      PASSO 1 • ESCOLHA O PRAZO DE RENOVAÇÃO DE VIGÊNCIA (PADRÃO OU FORA DO PADRÃO DE MERCADO)
                    </span>
                    <h4 className="text-sm font-extrabold text-slate-900">
                      Selecione o tempo de renovação ou adicione um prazo personalizado fora do padrão:
                    </h4>
                  </div>
                  <span className="px-2.5 py-1 rounded bg-emerald-700 text-white font-extrabold text-xs">
                    Nova Vigência: {draft.startDate} até {draft.endDate} ({draft.contractMonths} meses)
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                  {(
                    [
                      { id: '12', label: '12 meses (1 ano)' },
                      { id: '24', label: '24 meses (2 anos)' },
                      { id: '36', label: '36 meses (3 anos)' },
                      { id: '48', label: '48 meses (4 anos)' },
                      { id: '60', label: '60 meses (5 anos)' },
                      { id: 'CUSTOM', label: 'Prazo Personalizado (Fora do Padrão)' },
                    ] as const
                  ).map((opt) => {
                    const isSel = renewalPresetMode === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setRenewalPresetMode(opt.id);
                          applyRenewalDurationToDraft(
                            opt.id,
                            customDurationUnit,
                            customMonthsValue,
                            customDaysValue
                          );
                        }}
                        className={`p-2.5 rounded-lg border text-xs font-extrabold transition cursor-pointer ${
                          isSel
                            ? 'bg-[#0d2b4e] text-white border-[#0d2b4e] shadow-sm'
                            : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>

                {renewalPresetMode === 'CUSTOM' && (
                  <div className="p-3.5 rounded-lg bg-white border border-emerald-300 space-y-3">
                    <div className="font-extrabold text-slate-800">
                      Configurar Tempo Fora do Padrão do Mercado (Meses, Dias Corridos ou Datas Específicas):
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                      <div>
                        <label className="block font-bold text-slate-700 mb-1">Unidade de Tempo</label>
                        <select
                          value={customDurationUnit}
                          onChange={(e) => {
                            const u = e.target.value as 'MONTHS' | 'DAYS' | 'DATES';
                            setCustomDurationUnit(u);
                            applyRenewalDurationToDraft('CUSTOM', u, customMonthsValue, customDaysValue);
                          }}
                          className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-bold"
                        >
                          <option value="MONTHS">Meses Personalizados (ex.: 6, 7, 18m)</option>
                          <option value="DAYS">Dias Corridos (ex.: 90, 180 dias)</option>
                          <option value="DATES">Datas Específicas (Início e Término)</option>
                        </select>
                      </div>

                      {customDurationUnit === 'MONTHS' && (
                        <div>
                          <label className="block font-bold text-slate-700 mb-1">
                            Quantidade de Meses (Qualquer Prazo)
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={240}
                            value={customMonthsValue}
                            onChange={(e) => {
                              setCustomMonthsValue(e.target.value);
                              applyRenewalDurationToDraft(
                                'CUSTOM',
                                'MONTHS',
                                e.target.value,
                                customDaysValue
                              );
                            }}
                            placeholder="Ex.: 18"
                            className="w-full px-3 py-2 rounded border border-slate-300 font-bold text-slate-900"
                          />
                        </div>
                      )}

                      {customDurationUnit === 'DAYS' && (
                        <div>
                          <label className="block font-bold text-slate-700 mb-1">
                            Quantidade de Dias Corridos
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={3650}
                            value={customDaysValue}
                            onChange={(e) => {
                              setCustomDaysValue(e.target.value);
                              applyRenewalDurationToDraft(
                                'CUSTOM',
                                'DAYS',
                                customMonthsValue,
                                e.target.value
                              );
                            }}
                            placeholder="Ex.: 90"
                            className="w-full px-3 py-2 rounded border border-slate-300 font-bold text-slate-900"
                          />
                        </div>
                      )}

                      <div>
                        <label className="block font-bold text-slate-700 mb-1">Nova Data de Início</label>
                        <input
                          type="date"
                          value={(draft.startDate || '').slice(0, 10)}
                          onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
                          className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
                        />
                      </div>

                      <div>
                        <label className="block font-bold text-slate-700 mb-1">Nova Data de Término</label>
                        <input
                          type="date"
                          value={(draft.endDate || '').slice(0, 10)}
                          onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
                          className="w-full px-3 py-2 rounded border border-slate-300 font-mono font-bold text-emerald-800"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-3">
                <div>
                  <span className="text-[10px] font-black uppercase text-[#1e3a6e] block">
                    PASSO 2 • REVISÃO E CONFIRMAÇÃO DE TODAS AS INFORMAÇÕES DO CONTRATO (EDITÁVEL SE NECESSÁRIO)
                  </span>
                  <h4 className="text-sm font-extrabold text-slate-900">
                    Confirme ou edite qualquer cláusula, cliente, valor mensal, reajuste ou SLA antes de efetivar a renovação:
                  </h4>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Nº do Contrato</label>
                    <input
                      type="text"
                      value={draft.contractNumber}
                      onChange={(e) => setDraft({ ...draft, contractNumber: e.target.value })}
                      className="w-full px-3 py-2 rounded border border-slate-300 font-mono font-bold"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block font-bold text-slate-700 mb-1">Cliente / Razão Social</label>
                    <input
                      type="text"
                      value={draft.companyName}
                      onChange={(e) => setDraft({ ...draft, companyName: e.target.value })}
                      className="w-full px-3 py-2 rounded border border-slate-300 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">CNPJ</label>
                    <input
                      type="text"
                      value={draft.companyCnpj}
                      onChange={(e) => setDraft({ ...draft, companyCnpj: e.target.value })}
                      className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Valor Mensal Atual / Renovado (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={draft.monthlyValue}
                      onChange={(e) =>
                        setDraft({ ...draft, monthlyValue: Number(e.target.value) || 0 })
                      }
                      className="w-full px-3 py-2 rounded border border-slate-300 font-extrabold text-emerald-700"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Índice de Reajuste</label>
                    <select
                      value={draft.readjustmentIndex}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          readjustmentIndex: e.target.value as 'IPCA' | 'IGP-M' | 'FIXO' | 'IST_ANATEL',
                        })
                      }
                      className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-bold"
                    >
                      <option value="IPCA">IPCA (IBGE)</option>
                      <option value="IGP-M">IGP-M (FGV)</option>
                      <option value="IST_ANATEL">IST Anatel</option>
                      <option value="FIXO">FIXO / Negociado</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">% Reajuste na Renovação (Opcional)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={renewalReadjustmentPercent}
                      onChange={(e) => setRenewalReadjustmentPercent(e.target.value)}
                      className="w-full px-3 py-2 rounded border border-slate-300"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Dia de Vencimento</label>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={draft.dueDay}
                      onChange={(e) => setDraft({ ...draft, dueDay: Number(e.target.value) || 10 })}
                      className="w-full px-3 py-2 rounded border border-slate-300"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Objeto / Escopo do Contrato</label>
                    <input
                      type="text"
                      value={draft.title}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                      className="w-full px-3 py-2 rounded border border-slate-300 font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">SLA &amp; Condições Comerciais</label>
                    <input
                      type="text"
                      value={renewalSlaText}
                      onChange={(e) => setRenewalSlaText(e.target.value)}
                      className="w-full px-3 py-2 rounded border border-slate-300"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleConfirmRenewalAndSave}
                    className="px-6 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold shadow-sm cursor-pointer"
                  >
                    {saving ? 'Confirmando Renovação...' : 'Confirmar Renovação de Vigência e Salvar Alterações'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'FATURAMENTO_RECIBOS' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-3">
                <span className="text-[10px] font-black uppercase text-[#1e3a6e] block">
                  REVISÃO PARA EMISSÃO DE FATURA DE LOCAÇÃO (0% ISS — SÚMULA VINCULANTE 31 STF) OU NF-E REMESSA
                </span>
                <h4 className="text-sm font-extrabold text-slate-900">
                  Confira e edite se necessário os dados do contrato antes de emitir a Fatura Mensal ou NF-e de Remessa:
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Locatária / Cliente</label>
                    <input
                      type="text"
                      value={draft.companyName}
                      onChange={(e) => setDraft({ ...draft, companyName: e.target.value })}
                      className="w-full px-3 py-2 rounded border border-slate-300 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">CNPJ</label>
                    <input
                      type="text"
                      value={draft.companyCnpj}
                      onChange={(e) => setDraft({ ...draft, companyCnpj: e.target.value })}
                      className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Competência (MM/AAAA)</label>
                    <input
                      type="text"
                      value={billingCompetence}
                      onChange={(e) => {
                        setBillingCompetence(e.target.value);
                        setDraft({ ...draft, lastBilledCompetence: e.target.value });
                      }}
                      className="w-full px-3 py-2 rounded border border-slate-300 font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Valor da Fatura (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={draft.monthlyValue}
                      onChange={(e) =>
                        setDraft({ ...draft, monthlyValue: Number(e.target.value) || 0 })
                      }
                      className="w-full px-3 py-2 rounded border border-slate-300 font-extrabold text-emerald-700"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2">
                  {onGenerateInvoice && (
                    <button
                      type="button"
                      disabled={billingIssuing}
                      onClick={async () => {
                        setBillingIssuing(true);
                        try {
                          await onSave(draft);
                          await onGenerateInvoice(draft.id);
                        } finally {
                          setBillingIssuing(false);
                        }
                      }}
                      className="px-4 py-2.5 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white font-extrabold cursor-pointer"
                    >
                      Confirmar e Emitir Fatura / Recibo de Locação do Mês
                    </button>
                  )}
                  {onGenerateRemessaNfe && (
                    <button
                      type="button"
                      disabled={billingIssuing}
                      onClick={async () => {
                        setBillingIssuing(true);
                        try {
                          await onSave(draft);
                          await onGenerateRemessaNfe(draft.id);
                        } finally {
                          setBillingIssuing(false);
                        }
                      }}
                      className="px-4 py-2.5 rounded-lg bg-[#0d2b4e] hover:bg-[#1e3a6e] text-white font-extrabold cursor-pointer"
                    >
                      Confirmar e Emitir NF-e de Remessa (CFOP {draft.remessaCfop})
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'REAJUSTE_ADITIVOS' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-3">
                <span className="text-[10px] font-black uppercase text-indigo-800 block">
                  APLICAÇÃO DE REAJUSTE ANUAL (IPCA / IGP-M / PERSONALIZADO) &amp; ADITIVOS CONTRATUAIS
                </span>
                <h4 className="text-sm font-extrabold text-slate-900">
                  Revise as informações do contrato e confirme o percentual de reajuste ou devolução parcial pro-rata:
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Índice Contratual</label>
                    <select
                      value={draft.readjustmentIndex}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          readjustmentIndex: e.target.value as 'IPCA' | 'IGP-M' | 'FIXO' | 'IST_ANATEL',
                        })
                      }
                      className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-bold"
                    >
                      <option value="IPCA">IPCA (IBGE)</option>
                      <option value="IGP-M">IGP-M (FGV)</option>
                      <option value="IST_ANATEL">IST Anatel</option>
                      <option value="FIXO">FIXO / Negociado</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Percentual de Reajuste (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={readjPercentInput}
                      onChange={(e) => setReadjPercentInput(e.target.value)}
                      className="w-full px-3 py-2 rounded border border-slate-300 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Mensalidade Atual (R$)</label>
                    <input
                      type="number"
                      value={draft.monthlyValue}
                      onChange={(e) =>
                        setDraft({ ...draft, monthlyValue: Number(e.target.value) || 0 })
                      }
                      className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Nova Mensalidade Pós-Reajuste</label>
                    <div className="px-3 py-2 rounded bg-emerald-50 border border-emerald-200 font-black text-emerald-800">
                      {formatBRL(
                        Math.round(
                          draft.monthlyValue * (1 + (Number(readjPercentInput) || 0) / 100) * 100
                        ) / 100
                      )}
                      /mês
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Justificativa / Cláusula do Aditivo</label>
                  <input
                    type="text"
                    value={readjNoteInput}
                    onChange={(e) => setReadjNoteInput(e.target.value)}
                    className="w-full px-3 py-2 rounded border border-slate-300"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleApplyReadjustmentInsideTab}
                    className="px-5 py-2.5 rounded-lg bg-indigo-700 hover:bg-indigo-800 text-white font-extrabold cursor-pointer"
                  >
                    Confirmar Reajuste Anual e Atualizar Contrato
                  </button>

                  {onOpenPartialReturn && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenPartialReturn(draft);
                      }}
                      className="px-4 py-2.5 rounded-lg bg-purple-700 hover:bg-purple-800 text-white font-extrabold cursor-pointer"
                    >
                      Abrir Devolução Parcial de Equipamentos &amp; Rateio Pro-Rata
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'EQUIPAMENTOS_PATRIMONIO' && (
            <div className="border border-slate-200 rounded-lg p-4 bg-slate-50 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-extrabold text-slate-800 uppercase text-[11px] block">
                    Equipamentos Locados, Números de Série (S/N) &amp; Patrimônio ({draft.equipments.length})
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Patrimônio Total Alocado: <strong>{formatBRL(sumEquipmentsPatrimony(draft.equipments))}</strong> • Soma Mensal dos Itens: <strong className="text-emerald-700">{formatBRL(sumEquipmentsMonthly(draft.equipments))}</strong>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const eq: ErpRentalEquipmentItem = {
                      id: `eq-${Date.now()}`,
                      skuGestaoClick: '',
                      description: '',
                      serialNumber: '',
                      assetTag: '',
                      assetStatus: 'EM_CLIENTE',
                      ncm: '8517.62.59',
                      quantity: 1,
                      unitMonthlyRent: 0,
                      assetValueBrl: 0,
                      remessaCfop: draft.remessaCfop || '5.908',
                      remessaNfeKey: '',
                    };
                    updateEquipments([...draft.equipments, eq]);
                  }}
                  className="px-3 py-1.5 rounded bg-[#1e3a6e] text-white text-xs font-extrabold cursor-pointer"
                >
                  + Adicionar Equipamento / Patrimônio (S/N)
                </button>
              </div>

              <div className="space-y-2">
                {draft.equipments.map((eq, idx) => (
                  <div
                    key={eq.id || idx}
                    className="bg-white p-3 rounded border border-slate-200 space-y-2"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                      <div className="sm:col-span-2">
                        <label className="text-[10px] text-slate-400 block">SKU</label>
                        <input
                          type="text"
                          value={eq.skuGestaoClick}
                          onChange={(e) => {
                            const copy = [...draft.equipments];
                            copy[idx] = { ...copy[idx], skuGestaoClick: e.target.value };
                            updateEquipments(copy);
                          }}
                          className="w-full px-2 py-1 rounded border font-mono text-xs"
                        />
                      </div>
                      <div className="sm:col-span-4">
                        <label className="text-[10px] text-slate-400 block">Descrição do Ativo</label>
                        <input
                          type="text"
                          value={eq.description}
                          onChange={(e) => {
                            const copy = [...draft.equipments];
                            copy[idx] = { ...copy[idx], description: e.target.value };
                            updateEquipments(copy);
                          }}
                          className="w-full px-2 py-1 rounded border font-semibold text-xs"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="text-[10px] text-slate-400 block">Nº de Série (S/N)</label>
                        <input
                          type="text"
                          value={eq.serialNumber}
                          onChange={(e) => {
                            const copy = [...draft.equipments];
                            copy[idx] = { ...copy[idx], serialNumber: e.target.value };
                            updateEquipments(copy);
                          }}
                          className="w-full px-2 py-1 rounded border font-mono font-bold text-indigo-950 text-xs"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="text-[10px] text-slate-400 block">Locação Unit. (R$)</label>
                        <input
                          type="number"
                          value={eq.unitMonthlyRent}
                          onChange={(e) => {
                            const copy = [...draft.equipments];
                            copy[idx] = { ...copy[idx], unitMonthlyRent: Number(e.target.value) || 0 };
                            updateEquipments(copy);
                          }}
                          className="w-full px-2 py-1 rounded border font-bold text-emerald-700 text-xs"
                        />
                      </div>
                      <div className="sm:col-span-1 flex items-end justify-end pt-3">
                        <button
                          type="button"
                          onClick={() =>
                            updateEquipments(draft.equipments.filter((_, i) => i !== idx))
                          }
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'DOCUMENTO_HISTORICO' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-2">
                <h4 className="text-sm font-extrabold text-slate-900">
                  Minuta Contratual &amp; Histórico de Reajustes / Devoluções Parciais
                </h4>
                <p className="text-xs text-slate-600">
                  Contrato <strong>{draft.contractNumber}</strong> firmado com <strong>{draft.companyName}</strong> ({draft.companyCnpj}), vigência de <strong>{draft.startDate}</strong> a <strong>{draft.endDate}</strong> ({draft.contractMonths} meses), valor mensal de <strong>{formatBRL(draft.monthlyValue)}</strong>.
                </p>
                <p className="text-xs text-emerald-800 font-semibold">
                  Amparo Legal: {draft.legalBasisNote || 'Locação de Bens Móveis (Não incidência de ISSQN — LC 116/2003 e Súmula Vinculante 31 STF).'}
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200">
            <div>
              {!isReadOnly && onDelete && (
                !confirmDelete ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="px-3.5 py-2 rounded border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold cursor-pointer"
                  >
                    Excluir Contrato
                  </button>
                ) : (
                  <div className="flex items-center gap-2 p-2 rounded bg-rose-50 border border-rose-300">
                    <span className="font-extrabold text-rose-800">Confirmar exclusão definitiva?</span>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={async () => {
                        setDeleting(true);
                        try {
                          await onDelete(draft);
                          onClose();
                        } finally {
                          setDeleting(false);
                        }
                      }}
                      className="px-3 py-1 rounded bg-rose-600 text-white font-extrabold cursor-pointer"
                    >
                      {deleting ? 'Excluindo...' : 'Sim, Excluir'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="px-2.5 py-1 rounded border bg-white text-slate-700 font-bold cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                )
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded border border-slate-300 font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                {isReadOnly ? 'Fechar Consulta' : 'Cancelar'}
              </button>
              {!isReadOnly && (
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white font-extrabold cursor-pointer shadow-sm"
                >
                  {saving ? 'Salvando...' : 'Salvar Alterações do Contrato'}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// 3. INVOICE / FISCAL DOCUMENT EDITOR MODAL
export function InvoiceEditModal({
  invoice,
  onClose,
  onSave,
}: {
  invoice: ErpFiscalInvoice;
  onClose: () => void;
  onSave: (updated: ErpFiscalInvoice) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ErpFiscalInvoice>(() => structuredClone(invoice));
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-2xl w-full overflow-hidden my-8">
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-[#ff7a59]" />
            <h3 className="text-sm font-extrabold">
              Editar Documento Fiscal — {draft.documentNumber}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="text-slate-300 hover:text-white cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-3.5 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Nº Documento</label>
              <input
                type="text"
                value={draft.documentNumber}
                onChange={(e) => setDraft({ ...draft, documentNumber: e.target.value })}
                className="w-full px-3 py-2 rounded border font-mono font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Tipo Fiscal</label>
              <select
                value={draft.documentType}
                onChange={(e) =>
                  setDraft({ ...draft, documentType: e.target.value as ErpFiscalDocumentType })
                }
                className="w-full px-3 py-2 rounded border bg-white font-bold"
              >
                <option value="FATURA_LOCACAO">FATURA DE LOCAÇÃO (0% ISS)</option>
                <option value="NFSE_SERVICO">NFS-e SERVIÇO TÉCNICO</option>
                <option value="NFE_REMESSA_LOCACAO">NF-e REMESSA CFOP 5.908</option>
                <option value="NFCOM_TELECOM">NFCom TELECOM MOD. 62</option>
              </select>
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Status</label>
              <select
                value={draft.status}
                onChange={(e) =>
                  setDraft({ ...draft, status: e.target.value as ErpFiscalInvoice['status'] })
                }
                className="w-full px-3 py-2 rounded border bg-white font-bold"
              >
                <option value="EMITIDA">EMITIDA</option>
                <option value="PAGA">PAGA</option>
                <option value="VENCIDA">VENCIDA</option>
                <option value="CANCELADA">CANCELADA</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Cliente / Tomador *</label>
              <input
                type="text"
                required
                value={draft.companyName}
                onChange={(e) => setDraft({ ...draft, companyName: e.target.value })}
                className="w-full px-3 py-2 rounded border"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">CNPJ</label>
              <input
                type="text"
                value={draft.companyCnpj}
                onChange={(e) => setDraft({ ...draft, companyCnpj: e.target.value })}
                className="w-full px-3 py-2 rounded border font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Valor Bruto (R$)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={draft.grossAmount}
                onChange={(e) => setDraft({ ...draft, grossAmount: Number(e.target.value) || 0 })}
                className="w-full px-3 py-2 rounded border font-extrabold text-slate-900"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Competência</label>
              <input
                type="text"
                value={draft.competenceMonth}
                onChange={(e) => setDraft({ ...draft, competenceMonth: e.target.value })}
                className="w-full px-3 py-2 rounded border"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Vencimento</label>
              <input
                type="text"
                value={draft.dueDate}
                onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })}
                className="w-full px-3 py-2 rounded border"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">Descrição do Item Fiscal</label>
            <textarea
              rows={2}
              value={draft.itemsDescription[0]?.description || ''}
              onChange={(e) => {
                const items = [...draft.itemsDescription];
                items[0] = {
                  ...(items[0] || { quantity: 1, unitValue: draft.grossAmount, totalValue: draft.grossAmount }),
                  description: e.target.value,
                };
                setDraft({ ...draft, itemsDescription: items });
              }}
              className="w-full px-3 py-2 rounded border"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded border font-bold cursor-pointer">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="px-5 py-2 rounded bg-[#ff7a59] text-white font-extrabold cursor-pointer">
              {saving ? 'Salvando...' : 'Salvar Documento Fiscal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// 4. UNIVERSAL RECORD EDITOR MODAL FOR ANY GESTÃOCLICK TABLE
export interface GenericFieldSpec {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'select' | 'textarea';
  options?: string[];
  placeholder?: string;
}

export const SERVICE_ORDER_EDITOR_FIELDS: GenericFieldSpec[] = [
  { key: 'code', label: 'Nº da O.S.' },
  { key: 'companyName', label: 'Cliente / Razão Social *' },
  {
    key: 'technicianName',
    label: 'Técnico Responsável',
    type: 'select',
    options: [
      'Michelle da Rocha',
      'Evelyn Olivia de Rosa Ternero',
      'Wesley Brito',
      'Marcelo Mira',
    ],
  },
  {
    key: 'priority',
    label: 'Prioridade / SLA Técnico',
    type: 'select',
    options: ['NORMAL', 'ALTA', 'CRITICA', 'BAIXA'],
  },
  {
    key: 'equipmentName',
    label: 'Equipamento Assistido (PABX / Firewall / Switch)',
    placeholder: 'Ex: Central PABX IP Seta Cloud Appliance HA',
  },
  {
    key: 'serialNumber',
    label: 'Número de Série (S/N) / Patrimônio',
    placeholder: 'Ex: SN-SETA-PABX-88210',
  },
  { key: 'entryDate', label: 'Data de Entrada (DD/MM/AAAA)' },
  { key: 'exitDate', label: 'Data de Saída / Conclusão' },
  {
    key: 'status',
    label: 'Situação da O.S.',
    type: 'select',
    options: ['Aberta', 'Em andamento', 'Aguardando peça', 'Concluída', 'Cancelada'],
  },
  { key: 'totalAmount', label: 'Valor Total de Peças & Serviços (R$)', type: 'number' },
  {
    key: 'description',
    label: 'Defeito Relatado / Solicitação do Cliente',
    type: 'textarea',
  },
  {
    key: 'technicalReport',
    label: 'Laudo Técnico NOC / Diagnóstico & Solução Aplicada',
    type: 'textarea',
  },
];

export const CATALOG_ITEM_EDITOR_FIELDS: GenericFieldSpec[] = [
  { key: 'gestaoClickCode', label: 'Código / SKU GestãoClick *' },
  { key: 'name', label: 'Descrição do Equipamento / Serviço *' },
  {
    key: 'category',
    label: 'Grupo / Categoria do Item',
    type: 'select',
    options: [
      'EQUIPAMENTO_LOCACAO',
      'VENDA_HARDWARE',
      'SERVICO_TECNICO_LC116',
      'TELECOM_SCM_SVA',
    ],
  },
  {
    key: 'fiscalNature',
    label: 'Natureza Fiscal Padrão',
    type: 'select',
    options: [
      'LOCACAO_BENS_MOVEIS',
      'VENDA_EQUIPAMENTO',
      'SERVICO_TECNICO_TI_TELECOM',
      'SERVICO_COMUNICACAO_SCM_SVA',
    ],
  },
  { key: 'ncmOrLc116', label: 'Classificação NCM / Item LC 116' },
  { key: 'cfopDefault', label: 'CFOP Padrão (5.908 / 5.102 / 5.933 / 5.303)' },
  { key: 'stockAvailable', label: 'Estoque Disponível (Almoxarifado Matriz)', type: 'number' },
  { key: 'stockRentedInClients', label: 'Qtd Locada em Clientes (Comodato/Locação)', type: 'number' },
  { key: 'monthlyRentalPrice', label: 'Valor Mensal de Locação (R$)', type: 'number' },
  { key: 'saleOrSetupPrice', label: 'Valor de Venda Avulsa / Setup (R$)', type: 'number' },
];

export function GenericRecordEditModal({
  title,
  initialValues,
  fields,
  readOnly = false,
  onClose,
  onSave,
  onDelete,
}: {
  title: string;
  initialValues: Record<string, unknown>;
  fields: GenericFieldSpec[];
  readOnly?: boolean;
  onClose: () => void;
  onSave: (values: Record<string, unknown>) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...initialValues }));
  const [isReadOnly, setIsReadOnly] = useState<boolean>(Boolean(readOnly));
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const cnpjFieldSpec = fields.find((f) => /cnpj|cpf/i.test(f.key));
  const rawDocVal = cnpjFieldSpec ? String(values[cnpjFieldSpec.key] ?? '') : '';
  const docDigits = rawDocVal.replace(/\D/g, '');
  const docFeedback =
    cnpjFieldSpec && docDigits.length > 0
      ? validateDocumentByPersonType(rawDocVal, docDigits.length <= 11 ? 'PF' : 'PJ')
      : null;
  const hasInvalidDoc = Boolean(docFeedback && !docFeedback.isValid);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (hasInvalidDoc && docFeedback) {
      setErrorMsg(`${docFeedback.message}. Corrija o documento antes de salvar.`);
      return;
    }
    setErrorMsg(null);
    setSaving(true);
    try {
      await onSave(values);
    } finally {
      setSaving(false);
    }
  };

  const isWide = fields.length > 6;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div
        className={`bg-white rounded-lg border border-slate-300 shadow-2xl ${
          isWide ? 'max-w-2xl' : 'max-w-lg'
        } w-full overflow-hidden my-8`}
      >
        <div className="px-6 py-4 bg-[#1e3a6e] text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Edit3 className="w-4 h-4 text-emerald-300" />
            <h3 className="text-sm font-extrabold">
              {isReadOnly ? title.replace(/^Editar/i, 'Consultar') : title}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {isReadOnly && (
              <button
                type="button"
                onClick={() => setIsReadOnly(false)}
                className="px-2.5 py-1 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold cursor-pointer"
              >
                Habilitar Edição
              </button>
            )}
            <button type="button" onClick={onClose} className="text-slate-300 hover:text-white cursor-pointer">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-3 text-xs max-h-[82vh] overflow-y-auto">
          <fieldset disabled={isReadOnly} className={isWide ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : 'space-y-3'}>
            {fields.map((f) => {
              const isFullSpan =
                f.type === 'textarea' ||
                f.key === 'name' ||
                f.key === 'description' ||
                f.key === 'technicalReport' ||
                f.key === 'itemsSummary' ||
                f.key === 'nfeAccessKey';
              return (
                <div key={f.key} className={isWide && isFullSpan ? 'sm:col-span-2' : undefined}>
                  <label className="block font-bold text-slate-700 mb-1">{f.label}</label>
                  {f.type === 'select' && f.options ? (
                    <select
                      value={String(values[f.key] ?? f.options[0] ?? '')}
                      onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                      className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-semibold"
                    >
                      {f.options.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : f.type === 'textarea' ? (
                    <textarea
                      rows={2}
                      placeholder={f.placeholder}
                      value={String(values[f.key] ?? '')}
                      onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                      className="w-full px-3 py-2 rounded border border-slate-300"
                    />
                  ) : (
                    <div>
                      <input
                        type={f.type === 'number' ? 'number' : 'text'}
                        step={f.type === 'number' ? '0.01' : undefined}
                        placeholder={
                          f.placeholder ||
                          (/cnpj/i.test(f.key)
                            ? '00.000.000/0000-00'
                            : /phone|telefone/i.test(f.key)
                              ? '(00) 00000-0000'
                              : undefined)
                        }
                        value={String(values[f.key] ?? '')}
                        onChange={(e) => {
                          let nextVal: unknown =
                            f.type === 'number' ? Number(e.target.value) : e.target.value;
                          if (typeof nextVal === 'string') {
                            if (/cnpj|cpf/i.test(f.key)) {
                              const d = nextVal.replace(/\D/g, '');
                              nextVal = d.length <= 11 && /cpf/i.test(f.label) ? formatCpfMask(d) : formatCnpjMask(d);
                            } else if (/phone|telefone/i.test(f.key)) {
                              nextVal = formatBrPhoneMask(nextVal);
                            }
                          }
                          setErrorMsg(null);
                          setValues({
                            ...values,
                            [f.key]: nextVal,
                          });
                        }}
                        className={`w-full px-3 py-2 rounded border ${
                          /cnpj|cpf/i.test(f.key) && docFeedback
                            ? docFeedback.isValid
                              ? 'border-emerald-500 bg-emerald-50/20 font-mono'
                              : 'border-rose-500 bg-rose-50/40 text-rose-900 font-mono'
                            : 'border-slate-300'
                        }`}
                      />
                      {/cnpj|cpf/i.test(f.key) && docFeedback && (
                        <span
                          className={`block text-[10px] font-bold mt-1 ${
                            docFeedback.isValid ? 'text-emerald-700' : 'text-rose-600'
                          }`}
                        >
                          {docFeedback.message}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </fieldset>

          {errorMsg && (
            <div className="p-2.5 rounded bg-rose-50 border border-rose-300 text-rose-800 font-bold text-xs">
              {errorMsg}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t">
            <div>
              {!isReadOnly && onDelete && (
                !confirmDelete ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="px-3 py-1.5 rounded border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold cursor-pointer"
                  >
                    Excluir Registro
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5 p-1.5 rounded bg-rose-50 border border-rose-300">
                    <span className="font-extrabold text-rose-800">Confirmar exclusão?</span>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={async () => {
                        setDeleting(true);
                        try {
                          await onDelete();
                          onClose();
                        } finally {
                          setDeleting(false);
                        }
                      }}
                      className="px-2.5 py-1 rounded bg-rose-600 text-white font-extrabold cursor-pointer"
                    >
                      {deleting ? 'Excluindo...' : 'Sim, Excluir'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="px-2 py-1 rounded border bg-white text-slate-700 font-bold cursor-pointer"
                    >
                      Não
                    </button>
                  </div>
                )
              )}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded border font-bold cursor-pointer">
                {isReadOnly ? 'Fechar Consulta' : 'Cancelar'}
              </button>
              {isReadOnly ? (
                <button
                  type="button"
                  onClick={() => setIsReadOnly(false)}
                  className="px-5 py-2 rounded bg-[#ff7a59] text-white font-extrabold cursor-pointer"
                >
                  Editar Registro
                </button>
              ) : (
                <button type="submit" disabled={saving || hasInvalidDoc} className="px-5 py-2 rounded bg-[#ff7a59] text-white font-extrabold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                  {saving ? 'Salvando...' : 'Salvar Registro'}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
