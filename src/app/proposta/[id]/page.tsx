'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import {
  Printer,
  Copy,
  CheckCircle2,
  ShieldCheck,
  Building2,
  Phone,
  Mail,
  FileText,
  Scale,
  ArrowLeft,
  Calendar,
  UserCheck,
  Edit3,
  Plus,
  Trash2,
  Save,
  X,
} from 'lucide-react';
import { ErpCommercialProposal, ErpFiscalNature, ErpProposalItem } from '../../../db/types';
import { formatBRL } from '../../components/ui-helpers';
import {
  buildPublicProposalUrl,
  decodeProposalFromQueryParam,
  encodeProposalToQueryParam,
} from '../../lib/proposal-share';
import { loadDurableJournal, recordUpsertedProposal } from '../../lib/durable-storage';

function PublicProposalPrintContent() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const rawId = decodeURIComponent(String(params?.id || ''));
  const encodedData = searchParams?.get('d');
  const autoPrint = searchParams?.get('print') === '1';

  const [proposal, setProposal] = useState<ErpCommercialProposal | null>(() =>
    decodeProposalFromQueryParam(encodedData)
  );
  const [loading, setLoading] = useState<boolean>(!proposal);
  const [copied, setCopied] = useState(false);

  // Full In-Page Editor State
  const [isEditing, setIsEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [draft, setDraft] = useState<ErpCommercialProposal | null>(null);

  useEffect(() => {
    const decoded = decodeProposalFromQueryParam(encodedData);
    if (decoded) {
      setProposal(decoded);
      setLoading(false);
      return;
    }

    const journal = loadDurableJournal();
    const localFound = (journal.upsertedProposals || []).find(
      (p) => p.id === rawId || p.code.toLowerCase() === rawId.toLowerCase()
    );
    if (localFound) {
      setProposal(localFound);
      setLoading(false);
      return;
    }

    let active = true;
    fetch('/api/erp/proposals')
      .then((r) => r.json())
      .then((json) => {
        if (!active) return;
        const list: ErpCommercialProposal[] = Array.isArray(json?.data) ? json.data : [];
        const match =
          list.find(
            (p) =>
              p.id === rawId ||
              p.code.toLowerCase() === rawId.toLowerCase() ||
              p.id.toLowerCase() === rawId.toLowerCase()
          ) || list[0] || null;
        setProposal(match);
        setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [rawId, encodedData]);

  useEffect(() => {
    if (proposal && autoPrint && !isEditing) {
      const timer = setTimeout(() => {
        window.print();
      }, 450);
      return () => clearTimeout(timer);
    }
  }, [proposal, autoPrint, isEditing]);

  const openEditor = () => {
    if (!proposal) return;
    setDraft(structuredClone(proposal));
    setIsEditing(true);
  };

  const recomputeDraftTotals = (nextDraft: ErpCommercialProposal): ErpCommercialProposal => {
    const items = nextDraft.items.map((it) => ({
      ...it,
      totalMonthly: Math.max(1, Number(it.quantity || 1)) * Number(it.unitPrice || 0),
    }));
    const recurringSum = items
      .filter((i) => i.isRecurring !== false)
      .reduce((acc, i) => acc + i.totalMonthly, 0);
    const setupSum = items
      .filter((i) => i.isRecurring === false)
      .reduce((acc, i) => acc + i.totalMonthly, 0);
    const discount = Number(nextDraft.discountAmount || 0);
    const monthlyRecurringTotal = Math.max(0, recurringSum - discount);
    const contractMonths = Math.max(1, Number(nextDraft.contractMonths || 24));
    const totalContractValue = monthlyRecurringTotal * contractMonths + setupSum;
    return {
      ...nextDraft,
      items,
      contractMonths,
      monthlyRecurringTotal,
      oneTimeSetupTotal: setupSum,
      totalContractValue,
    };
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setSavingEdit(true);
    const computed = recomputeDraftTotals({
      ...draft,
      updatedAt: new Date().toISOString(),
    });

    try {
      const res = await fetch(`/api/erp/proposals/${encodeURIComponent(computed.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(computed),
      });
      const finalProposal: ErpCommercialProposal = res.ok
        ? (await res.json())?.data || computed
        : computed;

      recordUpsertedProposal(finalProposal);
      setProposal(finalProposal);
      setIsEditing(false);

      // Update URL ?d= parameter in place so copying link or refreshing preserves edits
      if (typeof window !== 'undefined') {
        const newEncoded = encodeProposalToQueryParam(finalProposal);
        const url = new URL(window.location.href);
        if (newEncoded) url.searchParams.set('d', newEncoded);
        window.history.replaceState({}, '', url.toString());
      }

      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 3500);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleCopyPublicLink = () => {
    if (!proposal) return;
    const url = buildPublicProposalUrl(proposal);
    navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f4f6f9] flex items-center justify-center p-6">
        <div className="bg-white rounded-lg border border-slate-200 p-8 shadow-sm text-center max-w-md w-full">
          <div className="w-10 h-10 rounded-full border-3 border-[#1e3a6e] border-t-transparent animate-spin mx-auto mb-3" />
          <p className="text-sm font-bold text-slate-800">
            Carregando Proposta Comercial Seta Telecom...
          </p>
        </div>
      </div>
    );
  }

  if (!proposal) {
    return (
      <div className="min-h-screen bg-[#f4f6f9] flex items-center justify-center p-6">
        <div className="bg-white rounded-lg border border-slate-200 p-8 shadow-sm text-center max-w-lg w-full space-y-4">
          <FileText className="w-12 h-12 text-[#1e3a6e] mx-auto" />
          <h1 className="text-lg font-extrabold text-slate-900">
            Proposta Comercial #{rawId}
          </h1>
          <p className="text-xs text-slate-600">
            Não foi possível localizar esta proposta sem o código de verificação completo. Volte ao painel da Seta Telecom para gerar o link público.
          </p>
          <a
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md bg-[#1e3a6e] text-white text-xs font-bold hover:bg-[#162b54] transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar para o CRM &amp; ERP Seta Telecom
          </a>
        </div>
      </div>
    );
  }

  const issueDateStr = proposal.createdAt
    ? new Date(proposal.createdAt).toLocaleDateString('pt-BR')
    : new Date().toLocaleDateString('pt-BR');
  const validUntilStr = proposal.validUntil
    ? proposal.validUntil.includes('-') && proposal.validUntil.length >= 10
      ? new Date(proposal.validUntil).toLocaleDateString('pt-BR')
      : proposal.validUntil
    : '15 dias';

  const recurringItems = proposal.items.filter((i) => i.isRecurring !== false);
  const setupItems = proposal.items.filter((i) => i.isRecurring === false);
  const locacaoTotal = proposal.items
    .filter((i) => i.fiscalNature === 'LOCACAO_BENS_MOVEIS')
    .reduce((s, i) => s + i.totalMonthly, 0);
  const servicoTotal = proposal.items
    .filter((i) => i.fiscalNature !== 'LOCACAO_BENS_MOVEIS')
    .reduce((s, i) => s + i.totalMonthly, 0);
  const issSavedMonthly = Math.round(locacaoTotal * 0.05 * 100) / 100;

  return (
    <div className="min-h-screen bg-[#e9eef5] py-6 px-3 sm:px-6 print:bg-white print:p-0">
      {/* TOP ACTION BAR (HIDDEN ON PRINT) */}
      <div className="max-w-4xl mx-auto mb-5 bg-[#1e3a6e] text-white rounded-lg px-4 py-3.5 shadow-lg flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-xs font-bold transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Painel Seta Telecom
          </a>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-300">
                Portal do Cliente • Documento Oficial
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-white/15">
                {proposal.code}
              </span>
              {savedNotice && (
                <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-500 text-slate-950">
                  ✓ Proposta Atualizada!
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-200">
              Você pode <strong>Editar a Proposta</strong> antes de gerar o PDF ou clicar em <strong>Imprimir / Salvar em PDF</strong>.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openEditor}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold shadow-xs transition cursor-pointer"
          >
            <Edit3 className="w-4 h-4" />
            ✏️ Editar Proposta antes de Imprimir
          </button>

          <button
            type="button"
            onClick={handleCopyPublicLink}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-white/15 hover:bg-white/25 text-white text-xs font-bold transition cursor-pointer"
          >
            {copied ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                Link Atualizado Copiado!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                Copiar Link p/ Cliente
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold shadow-md transition cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            Imprimir / Salvar em PDF
          </button>
        </div>
      </div>

      {/* IN-PAGE FULL PROPOSAL EDITOR MODAL (HIDDEN ON PRINT) */}
      {isEditing && draft && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto print:hidden">
          <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-4xl w-full overflow-hidden my-8">
            <div className="px-6 py-4 bg-[#1e3a6e] text-white flex items-center justify-between">
              <div>
                <span className="text-[10px] font-extrabold uppercase text-emerald-300 block">
                  Editor Completo de Proposta Comercial — Seta Telecom
                </span>
                <h3 className="text-sm sm:text-base font-extrabold">
                  Editando {draft.code} — {draft.companyName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-6 space-y-4 text-xs max-h-[82vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Código da Proposta</label>
                  <input
                    type="text"
                    value={draft.code}
                    onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300 font-mono font-bold"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-bold text-slate-700 mb-1">Título / Objeto da Proposta *</label>
                  <input
                    type="text"
                    required
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300 font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Status</label>
                  <select
                    value={draft.status}
                    onChange={(e) =>
                      setDraft({ ...draft, status: e.target.value as ErpCommercialProposal['status'] })
                    }
                    className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-bold"
                  >
                    <option value="RASCUNHO">RASCUNHO</option>
                    <option value="ENVIADA">ENVIADA</option>
                    <option value="EM_NEGOCIACAO">EM NEGOCIAÇÃO</option>
                    <option value="APROVADA">APROVADA</option>
                    <option value="CONVERTIDA_CONTRATO">CONVERTIDA EM CONTRATO</option>
                    <option value="RECUSADA">RECUSADA</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-bold text-slate-700 mb-1">Razão Social / Nome do Cliente *</label>
                  <input
                    type="text"
                    required
                    value={draft.companyName}
                    onChange={(e) => setDraft({ ...draft, companyName: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">CNPJ / CPF</label>
                  <input
                    type="text"
                    value={draft.companyCnpj}
                    onChange={(e) => setDraft({ ...draft, companyCnpj: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Contato / Decisor</label>
                  <input
                    type="text"
                    value={draft.contactName}
                    onChange={(e) => setDraft({ ...draft, contactName: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Responsável Seta Telecom</label>
                  <input
                    type="text"
                    value={draft.sellerName}
                    onChange={(e) => setDraft({ ...draft, sellerName: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Prazo Contratual (Meses)</label>
                  <input
                    type="number"
                    min={1}
                    value={draft.contractMonths}
                    onChange={(e) =>
                      setDraft(
                        recomputeDraftTotals({
                          ...draft,
                          contractMonths: Math.max(1, Number(e.target.value) || 24),
                        })
                      )
                    }
                    className="w-full px-3 py-2 rounded border border-slate-300 font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Desconto Mensal (R$)</label>
                  <input
                    type="number"
                    min={0}
                    value={draft.discountAmount || 0}
                    onChange={(e) =>
                      setDraft(
                        recomputeDraftTotals({
                          ...draft,
                          discountAmount: Math.max(0, Number(e.target.value) || 0),
                        })
                      )
                    }
                    className="w-full px-3 py-2 rounded border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Validade da Proposta</label>
                  <input
                    type="text"
                    value={draft.validUntil}
                    onChange={(e) => setDraft({ ...draft, validUntil: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Condição de Pagamento</label>
                <input
                  type="text"
                  value={draft.paymentCondition}
                  onChange={(e) => setDraft({ ...draft, paymentCondition: e.target.value })}
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>

              {/* ITEMS EDITOR */}
              <div className="border border-slate-200 rounded-lg p-3.5 bg-slate-50 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-slate-800 uppercase text-[11px]">
                    Itens da Proposta ({draft.items.length}) — Equipamentos, Licenças e Serviços
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const newItem: ErpProposalItem = {
                        id: `item-${Date.now()}`,
                        sku: `GC-EQ-00${draft.items.length + 101}`,
                        description: 'Novo Equipamento / Serviço Telecom Seta',
                        fiscalNature: 'LOCACAO_BENS_MOVEIS',
                        ncmOrServiceCode: 'NCM 8517.62.59 (0% ISS — SV 31 STF)',
                        quantity: 1,
                        unitPrice: 1200,
                        discountPercent: 0,
                        isRecurring: true,
                        totalMonthly: 1200,
                      };
                      setDraft(recomputeDraftTotals({ ...draft, items: [...draft.items, newItem] }));
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-[#1e3a6e] text-white text-xs font-extrabold cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> + Adicionar Item
                  </button>
                </div>

                <div className="space-y-2">
                  {draft.items.map((item, idx) => (
                    <div
                      key={item.id || idx}
                      className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-white p-2.5 rounded border border-slate-200"
                    >
                      <div className="sm:col-span-2">
                        <label className="text-[10px] text-slate-400 block">SKU</label>
                        <input
                          type="text"
                          value={item.sku}
                          onChange={(e) => {
                            const copy = [...draft.items];
                            copy[idx] = { ...copy[idx], sku: e.target.value };
                            setDraft(recomputeDraftTotals({ ...draft, items: copy }));
                          }}
                          className="w-full px-2 py-1 rounded border font-mono text-xs"
                        />
                      </div>
                      <div className="sm:col-span-4">
                        <label className="text-[10px] text-slate-400 block">Descrição do Item</label>
                        <input
                          type="text"
                          value={item.description}
                          onChange={(e) => {
                            const copy = [...draft.items];
                            copy[idx] = { ...copy[idx], description: e.target.value };
                            setDraft(recomputeDraftTotals({ ...draft, items: copy }));
                          }}
                          className="w-full px-2 py-1 rounded border font-semibold text-xs"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="text-[10px] text-slate-400 block">Natureza Fiscal</label>
                        <select
                          value={item.fiscalNature}
                          onChange={(e) => {
                            const copy = [...draft.items];
                            const fn = e.target.value as ErpFiscalNature;
                            copy[idx] = {
                              ...copy[idx],
                              fiscalNature: fn,
                              ncmOrServiceCode:
                                fn === 'LOCACAO_BENS_MOVEIS'
                                  ? 'NCM 8517.62.59 (0% ISS — SV 31 STF)'
                                  : 'LC 116/03 Item 01.07',
                            };
                            setDraft(recomputeDraftTotals({ ...draft, items: copy }));
                          }}
                          className="w-full px-2 py-1 rounded border bg-white text-[11px]"
                        >
                          <option value="LOCACAO_BENS_MOVEIS">Locação (0% ISS)</option>
                          <option value="SERVICO_TECNICO_TI_TELECOM">Serviço (LC 116)</option>
                          <option value="VENDA_EQUIPAMENTO">Venda Produto</option>
                        </select>
                      </div>
                      <div className="sm:col-span-1">
                        <label className="text-[10px] text-slate-400 block">Qtd</label>
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
                            setDraft(recomputeDraftTotals({ ...draft, items: copy }));
                          }}
                          className="w-full px-2 py-1 rounded border text-center font-bold"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="text-[10px] text-slate-400 block">Unitário (R$)</label>
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
                            setDraft(recomputeDraftTotals({ ...draft, items: copy }));
                          }}
                          className="w-full px-2 py-1 rounded border text-right font-bold"
                        />
                      </div>
                      <div className="sm:col-span-1 flex items-end justify-end pt-3">
                        <button
                          type="button"
                          disabled={draft.items.length <= 1}
                          onClick={() => {
                            const copy = draft.items.filter((_, i) => i !== idx);
                            setDraft(recomputeDraftTotals({ ...draft, items: copy }));
                          }}
                          className="p-1.5 rounded text-rose-600 hover:bg-rose-50 disabled:opacity-30 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between pt-2 border-t border-slate-200 text-xs font-extrabold text-slate-900">
                  <span>Mensalidade Recorrente (MRR): {formatBRL(draft.monthlyRecurringTotal)}/mês</span>
                  <span>Valor Global ({draft.contractMonths}m): {formatBRL(draft.totalContractValue)}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Observações Comerciais &amp; Enquadramento Fiscal
                  </label>
                  <textarea
                    rows={3}
                    value={draft.commercialNotes}
                    onChange={(e) => setDraft({ ...draft, commercialNotes: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Cláusulas Técnicas, Remessa CFOP 5.908 &amp; SLA
                  </label>
                  <textarea
                    rows={3}
                    value={draft.technicalClauses}
                    onChange={(e) => setDraft({ ...draft, technicalClauses: e.target.value })}
                    className="w-full px-3 py-2 rounded border border-slate-300"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 rounded border border-slate-300 font-bold text-slate-700 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white font-extrabold shadow-sm cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  {savingEdit ? 'Salvando...' : 'Salvar Alterações na Proposta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* A4 DOCUMENT CONTAINER */}
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-xl border border-slate-200 overflow-hidden print:shadow-none print:border-0 print:rounded-none">
        {/* HEADER TIMBRADO SETA TELECOM / SETA | IT */}
        <div className="bg-gradient-to-r from-[#1e3a6e] via-[#244682] to-[#1e3a6e] text-white px-8 py-6 border-b-4 border-[#f26522]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              {/* OFFICIAL SETA | IT LOGO CARD */}
              <div className="bg-white rounded-md px-4 py-2.5 shadow-sm flex items-center gap-2 shrink-0 border border-slate-200">
                <span className="text-xl font-black tracking-tight text-[#0d2b4e]">SETA</span>
                <span className="w-[2px] h-5 bg-[#f26522] inline-block" />
                <span className="text-xl font-black tracking-tight text-[#f26522]">IT</span>
              </div>

              <div>
                <h1 className="text-lg sm:text-xl font-black tracking-tight">
                  SETA TELECOM LTDA
                </h1>
                <p className="text-xs text-slate-200">
                  CNPJ: 14.806.925/0001-32 • Loja Matriz #118887 • GestãoClick ERP-GROK
                </p>
                <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-200 mt-1">
                  <span className="inline-flex items-center gap-1">
                    <Phone className="w-3 h-3 text-emerald-300" /> (11) 3958-4929
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Mail className="w-3 h-3 text-emerald-300" /> comercial@setatelecom.com.br
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-white/10 backdrop-blur-xs border border-white/20 rounded-lg px-4 py-3 text-right shrink-0">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-300">
                PROPOSTA COMERCIAL / ORÇAMENTO
              </div>
              <div className="text-xl font-black text-white mt-0.5">{proposal.code}</div>
              <div className="text-[11px] text-slate-200 mt-0.5">
                Emissão: <strong>{issueDateStr}</strong> • Validade: <strong>{validUntilStr}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* DOCUMENT BODY */}
        <div className="p-8 space-y-6 text-slate-800">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-[#f8fafc] border border-slate-200 rounded-lg p-4">
            <div className="space-y-1">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5 text-[#1e3a6e]" />
                Dados da Empresa Cliente (Proponente / Locatária)
              </div>
              <div className="text-base font-black text-slate-900">{proposal.companyName}</div>
              <div className="text-xs text-slate-600">
                <strong>CNPJ / CPF:</strong> {proposal.companyCnpj || 'Sob consulta'}
              </div>
              <div className="text-xs text-slate-600">
                <strong>Aos cuidados de (Decisor):</strong> {proposal.contactName}
              </div>
            </div>

            <div className="space-y-1 md:border-l md:border-slate-200 md:pl-4">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                <UserCheck className="w-3.5 h-3.5 text-[#1e3a6e]" />
                Responsável Comercial Seta Telecom
              </div>
              <div className="text-sm font-extrabold text-slate-900">{proposal.sellerName}</div>
              <div className="text-xs text-slate-600 flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>
                  Prazo Contratual: <strong>{proposal.contractMonths} meses</strong>
                </span>
              </div>
              <div className="text-xs text-slate-600">
                <strong>Condição de Pagamento:</strong> {proposal.paymentCondition}
              </div>
            </div>
          </div>

          <div className="border-l-4 border-[#1e3a6e] pl-4 py-1">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#1e3a6e]">
              Objeto da Proposta Comercial
            </span>
            <h2 className="text-base sm:text-lg font-black text-slate-900 mt-0.5">
              {proposal.title}
            </h2>
          </div>

          <div className="border border-slate-300 rounded-lg overflow-hidden">
            <div className="bg-[#1e3a6e] text-white px-4 py-2.5 flex items-center justify-between text-xs font-extrabold">
              <span>ESPECIFICAÇÃO DOS EQUIPAMENTOS, LICENÇAS &amp; SERVIÇOS</span>
              <span>VALORES EM REAIS (BRL)</span>
            </div>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-600 uppercase text-[10px] border-b border-slate-300">
                <tr>
                  <th className="py-2.5 px-3">Código / SKU</th>
                  <th className="py-2.5 px-3">Descrição do Item / Equipamento</th>
                  <th className="py-2.5 px-3">Enquadramento Fiscal</th>
                  <th className="py-2.5 px-3 text-center">Qtd</th>
                  <th className="py-2.5 px-3 text-right">Vlr. Unitário</th>
                  <th className="py-2.5 px-3 text-right">Subtotal Mensal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {proposal.items.map((item, idx) => (
                  <tr key={item.id || idx} className="hover:bg-slate-50/80">
                    <td className="py-3 px-3 font-mono font-bold text-slate-800">{item.sku}</td>
                    <td className="py-3 px-3">
                      <div className="font-bold text-slate-900">{item.description}</div>
                      <div className="text-[10px] text-slate-500">
                        Classificação: {item.ncmOrServiceCode} •{' '}
                        {item.isRecurring !== false ? 'Mensal Recorrente' : 'Taxa Única (Setup/Venda)'}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          item.fiscalNature === 'LOCACAO_BENS_MOVEIS'
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-indigo-50 text-indigo-800 border border-indigo-200'
                        }`}
                      >
                        {item.fiscalNature === 'LOCACAO_BENS_MOVEIS'
                          ? 'Locação Pura (0% ISS — SV 31 STF)'
                          : item.fiscalNature === 'SERVICO_TECNICO_TI_TELECOM'
                            ? 'Serviço TI/Telecom (LC 116 01.07)'
                            : 'Equipamento / Telecom'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center font-bold">{item.quantity}</td>
                    <td className="py-3 px-3 text-right font-medium">{formatBRL(item.unitPrice)}</td>
                    <td className="py-3 px-3 text-right font-black text-slate-900">
                      {formatBRL(item.totalMonthly)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 p-4 rounded-lg bg-emerald-50/70 border border-emerald-200 space-y-2 text-xs">
              <div className="flex items-center gap-2 font-extrabold text-emerald-950 uppercase text-[11px]">
                <Scale className="w-4 h-4 text-emerald-700 shrink-0" />
                Amparo Legal &amp; Segregação Tributária (LC 116/2003 + STF SV 31)
              </div>
              <p className="text-emerald-900 leading-relaxed text-[11px]">
                {proposal.commercialNotes}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-emerald-200/80 text-[11px]">
                <div>
                  <span className="text-emerald-700 block">Parcela Locação (0% ISS):</span>
                  <strong className="text-emerald-950">{formatBRL(locacaoTotal)}/mês</strong>
                </div>
                <div>
                  <span className="text-emerald-700 block">Parcela Serviços (NFS-e):</span>
                  <strong className="text-emerald-950">{formatBRL(servicoTotal)}/mês</strong>
                </div>
                <div>
                  <span className="text-emerald-700 block">Economia Tributária ISS:</span>
                  <strong className="text-emerald-950">{formatBRL(issSavedMonthly)}/mês</strong>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-lg bg-[#1e3a6e] text-white flex flex-col justify-between space-y-3">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300 block">
                  Investimento Mensal (MRR)
                </span>
                <div className="text-2xl font-black text-emerald-300 mt-0.5">
                  {formatBRL(proposal.monthlyRecurringTotal)}
                  <span className="text-xs font-normal text-slate-200">/mês</span>
                </div>
                {proposal.oneTimeSetupTotal > 0 && (
                  <div className="text-[11px] text-slate-200 mt-1">
                    + Taxa Única de Ativação/Frete: <strong>{formatBRL(proposal.oneTimeSetupTotal)}</strong>
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-white/15">
                <span className="text-[10px] uppercase font-bold text-slate-300 block">
                  Valor Global do Contrato ({proposal.contractMonths} meses)
                </span>
                <div className="text-lg font-extrabold text-white">
                  {formatBRL(proposal.totalContractValue)}
                </div>
                <span className="text-[10px] text-emerald-300">
                  {recurringItems.length} item(ns) recorrente(s) • {setupItems.length} setup
                </span>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
            <div className="font-extrabold text-slate-800 uppercase text-[11px] flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[#1e3a6e]" />
              Condições Técnicas, Remessa CFOP 5.908 &amp; Acordo de Nível de Serviço (SLA)
            </div>
            <p className="text-slate-600 leading-relaxed">{proposal.technicalClauses}</p>
          </div>

          <div className="pt-6 mt-4 border-t-2 border-slate-200">
            <div className="text-xs font-extrabold uppercase text-slate-700 mb-4">
              Termo de Aceite e Aprovação da Proposta Comercial ({proposal.code})
            </div>
            <p className="text-[11px] text-slate-500 mb-8">
              Declaramos estar de acordo com as especificações técnicas, prazos e condições comerciais descritas nesta Proposta Comercial, autorizando a emissão do respectivo Contrato de Locação / Prestação de Serviços pela SETA TELECOM LTDA.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 pt-6">
              <div className="border-t border-slate-400 pt-2 text-center">
                <div className="text-xs font-extrabold text-slate-900">SETA TELECOM LTDA</div>
                <div className="text-[11px] text-slate-500">
                  CNPJ 14.806.925/0001-32 • {proposal.sellerName}
                </div>
              </div>

              <div className="border-t border-slate-400 pt-2 text-center">
                <div className="text-xs font-extrabold text-slate-900">{proposal.companyName}</div>
                <div className="text-[11px] text-slate-500">
                  CNPJ {proposal.companyCnpj} • {proposal.contactName} (Assinatura / Carimbo)
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PublicProposalPrintPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#f4f6f9] flex items-center justify-center p-6">
          <div className="bg-white rounded-lg border border-slate-200 p-8 shadow-sm text-center max-w-md w-full">
            <p className="text-sm font-bold text-slate-800">
              Carregando Proposta Comercial Seta Telecom...
            </p>
          </div>
        </div>
      }
    >
      <PublicProposalPrintContent />
    </Suspense>
  );
}
