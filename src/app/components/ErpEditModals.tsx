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
} from 'lucide-react';
import {
  Company,
  Contact,
  Deal,
  ErpCatalogItem,
  ErpCommercialProposal,
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
import { computeProposalTotals, inferProposalItemType } from '../lib/proposal-share';

// 1. PROPOSAL FULL EDITOR MODAL (EXACT GESTÃOCLICK "NOVO / EDITAR ORÇAMENTO" COMPLETE LAYOUT)
export function ProposalEditModal({
  proposal,
  onClose,
  onSave,
  catalog = [],
  companies = [],
  contacts = [],
  deals = [],
  isNew = false,
}: {
  proposal: ErpCommercialProposal;
  onClose: () => void;
  onSave: (updated: ErpCommercialProposal) => Promise<void>;
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
      unit: draft.budgetType === 'PRODUTOS' ? 'UN' : 'MÊS',
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
        : draft.monthlyRecurringTotal + draft.oneTimeSetupTotal;

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
                Loja {draft.storeName || 'Matriz'} #118887 • Segregação Tributária LC 116/03 &amp; STF SV 31
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
          </div>
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <span>🏠 Início</span>
            <span>&gt;</span>
            <span>Orçamentos</span>
            <span>&gt;</span>
            <strong className="text-slate-800">{isNew ? 'Adicionar' : 'Editar'}</strong>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs max-h-[82vh] overflow-y-auto">
          {/* BLOCO 1: DADOS GERAIS DO ORÇAMENTO */}
          <div className="bg-white rounded-md border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-5 py-3 bg-slate-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-slate-800">
                  ✏️ 1. Dados Gerais do <span className="text-[#1e3a6e]">Orçamento / Proposta</span>
                </div>
                <div className="text-[11px] text-slate-500">
                  Tipo de orçamento, código, situação, cliente, vendedor, canal de venda, loja e introdução.
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[11px] font-bold text-slate-600">Template PDF:</label>
                <select
                  value={draft.templateStyle || 'SETA_PREMIUM_TELECOM'}
                  onChange={(e) =>
                    updateDraft({
                      templateStyle: e.target.value as ErpCommercialProposal['templateStyle'],
                    })
                  }
                  className="px-3 py-1.5 rounded border border-emerald-400 bg-emerald-50 font-extrabold text-emerald-950"
                >
                  <option value="SETA_PREMIUM_TELECOM">Template Seta Premium Telecom (Padrão)</option>
                  <option value="EXECUTIVO_CORPORATIVO">Template Executivo Corporativo B2B</option>
                  <option value="LOCACAO_DETALHADA_SLA">Template Locação Detalhada + SLA &amp; Rateio Pro-Rata</option>
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

            <div className="p-5 space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Código</label>
                  <input
                    type="text"
                    value={draft.code}
                    onChange={(e) => updateDraft({ code: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300 bg-slate-50 font-mono font-bold text-slate-900"
                  />
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
                <div className="sm:col-span-3">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Situação (Status GestãoClick)
                  </label>
                  <select
                    value={draft.status}
                    onChange={(e) =>
                      updateDraft({ status: e.target.value as ErpCommercialProposal['status'] })
                    }
                    className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-bold text-slate-800"
                  >
                    <option value="RASCUNHO">Em Aberto (DRAFT)</option>
                    <option value="ENVIADA">Enviado ao Cliente (SENT)</option>
                    <option value="EM_NEGOCIACAO">Em Negociação (UNDER_NEGOTIATION)</option>
                    <option value="APROVADA">Aprovado (APPROVED)</option>
                    <option value="CONVERTIDA_CONTRATO">Convertido em Contrato (CONVERTED)</option>
                    <option value="RECUSADA">Cancelado / Recusado (REJECTED)</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Loja / Unidade</label>
                  <input
                    type="text"
                    value={draft.storeName || 'Matriz'}
                    onChange={(e) => updateDraft({ storeName: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300 font-semibold"
                  />
                </div>
              </div>

              {/* CLIENTE + PREENCHIMENTO AUTOMÁTICO DO CRM */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-1">
                {companies.length > 0 && (
                  <div className="sm:col-span-4">
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Selecionar Cliente do CRM / GestãoClick
                    </label>
                    <select
                      value={draft.companyId || ''}
                      onChange={(e) => {
                        const compId = e.target.value;
                        const comp = companies.find((c) => c.id === compId);
                        const compContact = contacts.find((ct) => ct.companyId === compId);
                        const compDeal = deals.find((d) => d.companyId === compId);
                        if (comp) {
                          const contactFull = compContact
                            ? `${compContact.firstName} ${compContact.lastName}`.trim()
                            : draft.contactName;
                          updateDraft({
                            companyId: comp.id,
                            companyName: comp.name,
                            companyCnpj: comp.cnpj || draft.companyCnpj,
                            contactId: compContact?.id || draft.contactId,
                            contactName: contactFull,
                            careOf: contactFull,
                            contactEmail: compContact?.email || draft.contactEmail,
                            dealId: compDeal?.id || draft.dealId,
                            deliveryAddress:
                              comp.city && comp.state
                                ? `${comp.name} — ${comp.city}/${comp.state}`
                                : draft.deliveryAddress,
                          });
                        } else {
                          updateDraft({ companyId: null });
                        }
                      }}
                      className="w-full px-3 py-2 rounded border border-slate-300 bg-white"
                    >
                      <option value="">-- Digitar manualmente ou escolher da lista --</option>
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} {c.cnpj ? `(${c.cnpj})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className={companies.length > 0 ? 'sm:col-span-4' : 'sm:col-span-6'}>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Cliente / Razão Social <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={draft.companyName}
                    onChange={(e) => updateDraft({ companyName: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300 font-semibold text-slate-900"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">CNPJ / CPF</label>
                  <input
                    type="text"
                    value={draft.companyCnpj}
                    onChange={(e) => updateDraft({ companyCnpj: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Aos cuidados de</label>
                  <input
                    type="text"
                    value={draft.careOf ?? draft.contactName}
                    onChange={(e) =>
                      updateDraft({ careOf: e.target.value, contactName: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded border border-slate-300"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-3">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">E-mail do Contato</label>
                  <input
                    type="email"
                    value={draft.contactEmail || ''}
                    onChange={(e) => updateDraft({ contactEmail: e.target.value })}
                    placeholder="decisor@cliente.com.br"
                    className="w-full px-3 py-2 rounded border border-slate-300"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Negócio (Deal CRM Vinculado)
                  </label>
                  <select
                    value={draft.dealId || ''}
                    onChange={(e) => updateDraft({ dealId: e.target.value || null })}
                    className="w-full px-3 py-2 rounded border border-slate-300 bg-white"
                  >
                    <option value="">Sem vínculo direto com Deal</option>
                    {deals.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title} ({formatBRL(d.value)})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Data da Proposta</label>
                  <input
                    type="date"
                    value={
                      draft.proposalDate ||
                      (draft.createdAt ? draft.createdAt.slice(0, 10) : '2026-10-26')
                    }
                    onChange={(e) => updateDraft({ proposalDate: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Validade</label>
                  <input
                    type="date"
                    value={
                      draft.validUntil && draft.validUntil.length >= 10
                        ? draft.validUntil.slice(0, 10)
                        : '2026-11-10'
                    }
                    onChange={(e) => updateDraft({ validUntil: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Prazo de Entrega / Ativação
                  </label>
                  <input
                    type="text"
                    value={draft.deliveryForecast || 'Imediato (até 48h úteis)'}
                    onChange={(e) => updateDraft({ deliveryForecast: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-3">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Vendedor / Executivo Seta Telecom
                  </label>
                  <input
                    type="text"
                    value={draft.sellerName}
                    onChange={(e) => updateDraft({ sellerName: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300 font-semibold"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Canal de Venda</label>
                  <select
                    value={draft.salesChannel || 'Comercial B2B / Consultivo'}
                    onChange={(e) => updateDraft({ salesChannel: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300 bg-white"
                  >
                    <option value="Comercial B2B / Consultivo">Comercial B2B / Consultivo</option>
                    <option value="Presencial">Presencial</option>
                    <option value="Telefone">Telefone / Inside Sales</option>
                    <option value="WhatsApp">WhatsApp Corporativo</option>
                    <option value="Cliente Recorrente">Cliente Recorrente (Upsell)</option>
                    <option value="E-commerce">Portal B2B / E-commerce</option>
                  </select>
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Centro de Custo</label>
                  <select
                    value={draft.costCenter || 'Comercial Telecom & TI'}
                    onChange={(e) => updateDraft({ costCenter: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300 bg-white"
                  >
                    <option value="Comercial Telecom & TI">Comercial Telecom &amp; TI</option>
                    <option value="Locação de Ativos">Locação de Ativos (MRR)</option>
                    <option value="Projetos & Engenharia">Projetos &amp; Engenharia NOC</option>
                    <option value="VENDAS">VENDAS</option>
                  </select>
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Prazo Contratual (Meses)
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

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Introdução da Proposta (impressa na abertura do PDF A4)
                </label>
                <textarea
                  rows={2}
                  value={
                    draft.introductionText ??
                    'Apresentamos a seguir nossa proposta técnico-comercial personalizada com equipamentos homologados Seta Telecom e garantia de alta disponibilidade.'
                  }
                  onChange={(e) => updateDraft({ introductionText: e.target.value })}
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>
            </div>
          </div>

          {/* BLOCO 2: PRODUTOS / EQUIPAMENTOS */}
          <div className="bg-white rounded-md border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-5 py-3 bg-slate-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-[#1e3a6e]" />
                <div>
                  <div className="text-sm font-bold text-slate-800">
                    2. Produtos / <span className="text-[#1e3a6e]">Equipamentos</span> ({productItemsWithIdx.length})
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
                        <th className="py-2 px-2 w-36">NCM</th>
                        <th className="py-2 px-2 w-40">Natureza Fiscal</th>
                        <th className="py-2 px-2 w-24">Recorrência</th>
                        <th className="py-2 px-2 w-16 text-center">Qtd</th>
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
                            <input
                              type="text"
                              value={item.ncmOrServiceCode}
                              onChange={(e) => {
                                const copy = [...draft.items];
                                copy[idx] = { ...copy[idx], ncmOrServiceCode: e.target.value };
                                updateDraft({ items: copy });
                              }}
                              className="w-full px-2 py-1 rounded border border-slate-300 text-[11px]"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <select
                              value={item.fiscalNature}
                              onChange={(e) => {
                                const fn = e.target.value as ErpFiscalNature;
                                const copy = [...draft.items];
                                copy[idx] = {
                                  ...copy[idx],
                                  itemType: 'PRODUCT',
                                  fiscalNature: fn,
                                  ncmOrServiceCode:
                                    fn === 'LOCACAO_BENS_MOVEIS'
                                      ? 'NCM 8517.62.59 (0% ISS — SV 31 STF)'
                                      : 'NCM 8517.62.59 (Venda CFOP 5.102)',
                                };
                                updateDraft({ items: copy });
                              }}
                              className="w-full px-2 py-1 rounded border border-slate-300 bg-white text-[11px]"
                            >
                              <option value="LOCACAO_BENS_MOVEIS">Locação Pura (0% ISS SV 31)</option>
                              <option value="VENDA_EQUIPAMENTO">Venda de Equipamento</option>
                            </select>
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
                                  unit: isRec ? 'MÊS' : 'UN',
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
                        <th className="py-2 px-2 w-36">Código LC 116</th>
                        <th className="py-2 px-2 w-40">Natureza Fiscal</th>
                        <th className="py-2 px-2 w-24">Recorrência</th>
                        <th className="py-2 px-2 w-16 text-center">Qtd/Hr</th>
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
                              value={item.ncmOrServiceCode}
                              onChange={(e) => {
                                const copy = [...draft.items];
                                copy[idx] = { ...copy[idx], ncmOrServiceCode: e.target.value };
                                updateDraft({ items: copy });
                              }}
                              className="w-full px-2 py-1 rounded border border-slate-300 bg-white text-[11px]"
                            >
                              <option value="LC 116/03 Item 01.07">01.07 — Suporte Técnico TI/PABX</option>
                              <option value="LC 116/03 Item 01.03">01.03 — Processamento/Cloud</option>
                              <option value="LC 116/03 Item 14.01">14.01 — Manutenção Equipamentos</option>
                              <option value="LC 116/03 Item 21.01">21.01 — Telecom / SCM / SVA</option>
                              <option value={item.ncmOrServiceCode}>{item.ncmOrServiceCode}</option>
                            </select>
                          </td>
                          <td className="py-2 px-2">
                            <select
                              value={item.fiscalNature}
                              onChange={(e) => {
                                const fn = e.target.value as ErpFiscalNature;
                                const copy = [...draft.items];
                                copy[idx] = {
                                  ...copy[idx],
                                  itemType: 'SERVICE',
                                  fiscalNature: fn,
                                };
                                updateDraft({ items: copy });
                              }}
                              className="w-full px-2 py-1 rounded border border-slate-300 bg-white text-[11px]"
                            >
                              <option value="SERVICO_TECNICO_TI_TELECOM">Serviço TI/Telecom (NFS-e)</option>
                              <option value="SERVICO_COMUNICACAO_SCM_SVA">Comunicação SCM/SVA (NFCom)</option>
                            </select>
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
                                  unit: isRec ? 'MÊS' : 'HR',
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
              <div className="sm:col-span-4">
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
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Índice de Reajuste Anual
                </label>
                <select
                  value={draft.readjustmentIndex || 'IPCA'}
                  onChange={(e) =>
                    updateDraft({
                      readjustmentIndex: e.target.value as ErpCommercialProposal['readjustmentIndex'],
                    })
                  }
                  className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-semibold"
                >
                  <option value="IPCA">IPCA (IBGE)</option>
                  <option value="IGP-M">IGP-M (FGV)</option>
                  <option value="IST_ANATEL">IST Anatel</option>
                  <option value="FIXO">Fixo / Sem Reajuste</option>
                </select>
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
              <div className="grid grid-cols-2 sm:grid-cols-7 gap-2.5 bg-slate-50 p-3.5 rounded-lg border border-slate-200">
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
                    Frete (+)
                  </span>
                  <strong className="text-xs font-bold text-slate-800">
                    + {formatBRL(draft.shippingCost || 0)}
                  </strong>
                </div>
                <div className="bg-emerald-50 px-2.5 py-1.5 rounded border border-emerald-200">
                  <span className="text-[10px] uppercase font-extrabold text-emerald-700 block">
                    MRR Mensal
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
                ℹ️ 6. Observações Comerciais, <span className="text-[#1e3a6e]">Cláusulas SLA &amp; Notas Internas</span>
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
                  🔒 Observações Internas (Uso exclusivo interno — NÃO sai no PDF)
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

          {/* RODAPÉ FIXO DO GESTÃOCLICK */}
          <div className="bg-white rounded-md border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Cancelar
            </button>

            <div className="flex flex-wrap items-center gap-4">
              <div className="text-right">
                <span className="block text-[10px] text-slate-500">
                  MRR Mensal: <strong>{formatBRL(draft.monthlyRecurringTotal)}/mês</strong> • Setup/Frete:{' '}
                  <strong>{formatBRL(draft.oneTimeSetupTotal)}</strong>
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

// 2. RENTAL CONTRACT FULL EDITOR MODAL
export function ContractEditModal({
  contract,
  onClose,
  onSave,
}: {
  contract: ErpRentalContract;
  onClose: () => void;
  onSave: (updated: ErpRentalContract) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ErpRentalContract>(() => ({
    ...structuredClone(contract),
    modality: contract.modality || 'LOCACAO',
  }));
  const [autoSyncMonthly, setAutoSyncMonthly] = useState<boolean>(true);
  const [saving, setSaving] = useState(false);

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
      <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-5xl w-full overflow-hidden my-8">
        <div className="px-6 py-4 bg-indigo-950 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileCheck2 className="w-5 h-5 text-emerald-300" />
            <div>
              <span className="text-[10px] font-extrabold uppercase text-emerald-300 block">
                Editor Completo de Contrato de Locação, Patrimônios (S/N) &amp; Vigência — Seta Telecom
              </span>
              <h3 className="text-sm font-extrabold">
                {draft.contractNumber} — {draft.companyName}
              </h3>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-300 hover:text-white cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs max-h-[84vh] overflow-y-auto">
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
                <option value="LOCACAO">Locação de Equipamentos (SV 31 STF)</option>
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
                className="w-full px-3 py-2 rounded border border-slate-300"
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

          {/* VIGÊNCIA, REAJUSTE E FATURAMENTO */}
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
              <label className="block font-bold text-slate-700 mb-1">Índice Reajuste Anual</label>
              <select
                value={draft.readjustmentIndex}
                onChange={(e) =>
                  setDraft({ ...draft, readjustmentIndex: e.target.value as 'IPCA' | 'IGP-M' | 'FIXO' | 'IST_ANATEL' })
                }
                className="w-full px-2.5 py-2 rounded border border-slate-300 bg-white font-bold"
              >
                <option value="IPCA">IPCA (IBGE)</option>
                <option value="IGP-M">IGP-M (FGV)</option>
                <option value="FIXO">FIXO</option>
              </select>
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Aluguel Mensal (R$)</label>
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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">NF-e Remessa Nº</label>
              <input
                type="text"
                value={draft.remessaNfeNumber}
                onChange={(e) => setDraft({ ...draft, remessaNfeNumber: e.target.value })}
                className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">CFOP Remessa Padrão</label>
              <select
                value={draft.remessaCfop}
                onChange={(e) =>
                  setDraft({ ...draft, remessaCfop: e.target.value as '5.908' | '6.908' })
                }
                className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-mono font-bold"
              >
                <option value="5.908">5.908 — Remessa de Locação Estadual (SP)</option>
                <option value="6.908">6.908 — Remessa de Locação Interestadual</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => {
                  const total = sumEquipmentsMonthly(draft.equipments);
                  setAutoSyncMonthly(true);
                  setDraft({ ...draft, monthlyValue: total });
                }}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 font-extrabold cursor-pointer"
              >
                <Calculator className="w-3.5 h-3.5" />
                Recalcular Mensalidade pelos Itens ({formatBRL(sumEquipmentsMonthly(draft.equipments))})
              </button>
            </div>
          </div>

          {/* Equipments S/N & Patrimony */}
          <div className="border border-slate-200 rounded-lg p-3.5 bg-slate-50 space-y-2.5">
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
                    skuGestaoClick: `GC-EQ-00${draft.equipments.length + 101}`,
                    description: 'Equipamento Telecom Locado Seta',
                    serialNumber: `SN-SETA-${Math.floor(10000 + Math.random() * 90000)}`,
                    assetTag: `PAT-SETA-00${draft.equipments.length + 401}`,
                    assetStatus: 'EM_CLIENTE',
                    ncm: '8517.62.59',
                    quantity: 1,
                    unitMonthlyRent: 1200,
                    assetValueBrl: 12000,
                    remessaCfop: draft.remessaCfop || '5.908',
                    remessaNfeKey: '35261018456789000190550010004191011000419991',
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
                      <label className="text-[10px] text-slate-400 block">SKU GestãoClick</label>
                      <input
                        type="text"
                        value={eq.skuGestaoClick}
                        onChange={(e) => {
                          const copy = [...draft.equipments];
                          copy[idx] = { ...copy[idx], skuGestaoClick: e.target.value };
                          updateEquipments(copy);
                        }}
                        placeholder="SKU"
                        className="w-full px-2 py-1 rounded border font-mono text-xs"
                      />
                    </div>
                    <div className="sm:col-span-4">
                      <label className="text-[10px] text-slate-400 block">Descrição do Ativo / Equipamento</label>
                      <input
                        type="text"
                        value={eq.description}
                        onChange={(e) => {
                          const copy = [...draft.equipments];
                          copy[idx] = { ...copy[idx], description: e.target.value };
                          updateEquipments(copy);
                        }}
                        placeholder="Equipamento"
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
                        placeholder="Nº Série"
                        className="w-full px-2 py-1 rounded border font-mono font-bold text-indigo-950 text-xs"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[10px] text-slate-400 block">Tag Patrimônio</label>
                      <input
                        type="text"
                        value={eq.assetTag || ''}
                        onChange={(e) => {
                          const copy = [...draft.equipments];
                          copy[idx] = { ...copy[idx], assetTag: e.target.value };
                          updateEquipments(copy);
                        }}
                        placeholder="PAT-SETA-001"
                        className="w-full px-2 py-1 rounded border font-mono text-xs"
                      />
                    </div>
                    <div className="sm:col-span-1 flex items-end justify-end pt-3">
                      <button
                        type="button"
                        disabled={draft.equipments.length <= 1}
                        onClick={() =>
                          updateEquipments(draft.equipments.filter((_, i) => i !== idx))
                        }
                        className="p-1.5 text-rose-600 hover:bg-rose-50 rounded disabled:opacity-30 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-center pt-1 border-t border-slate-100">
                    <div className="sm:col-span-2">
                      <label className="text-[10px] text-slate-400 block">NCM</label>
                      <input
                        type="text"
                        value={eq.ncm}
                        onChange={(e) => {
                          const copy = [...draft.equipments];
                          copy[idx] = { ...copy[idx], ncm: e.target.value };
                          updateEquipments(copy);
                        }}
                        className="w-full px-2 py-1 rounded border font-mono text-xs"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[10px] text-slate-400 block">CFOP Remessa</label>
                      <select
                        value={eq.remessaCfop || '5.908'}
                        onChange={(e) => {
                          const copy = [...draft.equipments];
                          copy[idx] = {
                            ...copy[idx],
                            remessaCfop: e.target.value as '5.908' | '6.908',
                          };
                          updateEquipments(copy);
                        }}
                        className="w-full px-2 py-1 rounded border bg-white font-mono text-xs"
                      >
                        <option value="5.908">5.908 (Estadual)</option>
                        <option value="6.908">6.908 (Interestadual)</option>
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[10px] text-slate-400 block">Status Físico S/N</label>
                      <select
                        value={eq.assetStatus || 'EM_CLIENTE'}
                        onChange={(e) => {
                          const copy = [...draft.equipments];
                          copy[idx] = {
                            ...copy[idx],
                            assetStatus: e.target.value as ErpAssetStatus,
                          };
                          updateEquipments(copy);
                        }}
                        className="w-full px-2 py-1 rounded border bg-white text-xs font-bold"
                      >
                        <option value="EM_CLIENTE">Em Cliente</option>
                        <option value="MANUTENCAO_RMA">Manutenção / RMA</option>
                        <option value="DEVOLVIDO">Devolvido</option>
                      </select>
                    </div>
                    <div className="sm:col-span-1">
                      <label className="text-[10px] text-slate-400 block">Qtd</label>
                      <input
                        type="number"
                        min={1}
                        value={eq.quantity}
                        onChange={(e) => {
                          const copy = [...draft.equipments];
                          copy[idx] = {
                            ...copy[idx],
                            quantity: Math.max(1, Number(e.target.value) || 1),
                          };
                          updateEquipments(copy);
                        }}
                        className="w-full px-2 py-1 rounded border text-center font-bold"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[10px] text-slate-400 block">Locação Unit. (R$)</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={eq.unitMonthlyRent}
                        onChange={(e) => {
                          const copy = [...draft.equipments];
                          copy[idx] = {
                            ...copy[idx],
                            unitMonthlyRent: Number(e.target.value) || 0,
                          };
                          updateEquipments(copy);
                        }}
                        className="w-full px-2 py-1 rounded border text-right font-bold text-emerald-700"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="text-[10px] text-slate-400 block">Valor Patrimonial (R$)</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={eq.assetValueBrl}
                        onChange={(e) => {
                          const copy = [...draft.equipments];
                          copy[idx] = {
                            ...copy[idx],
                            assetValueBrl: Number(e.target.value) || 0,
                          };
                          updateEquipments(copy);
                        }}
                        className="w-full px-2 py-1 rounded border text-right font-bold text-slate-800"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">Amparo Legal &amp; Observações Fiscais</label>
            <textarea
              rows={2}
              value={draft.legalBasisNote}
              onChange={(e) => setDraft({ ...draft, legalBasisNote: e.target.value })}
              className="w-full px-3 py-2 rounded border border-slate-300"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded border font-bold cursor-pointer">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="px-5 py-2 rounded bg-[#ff7a59] text-white font-extrabold cursor-pointer">
              {saving ? 'Salvando...' : 'Salvar Contrato'}
            </button>
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
