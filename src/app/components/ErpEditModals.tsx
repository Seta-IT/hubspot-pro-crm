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
} from 'lucide-react';
import {
  ErpCommercialProposal,
  ErpFiscalDocumentType,
  ErpFiscalInvoice,
  ErpFiscalNature,
  ErpProposalItem,
  ErpRentalContract,
  ErpRentalEquipmentItem,
} from '../../db/types';
import { formatBRL } from './ui-helpers';

// 1. PROPOSAL FULL EDITOR MODAL
export function ProposalEditModal({
  proposal,
  onClose,
  onSave,
}: {
  proposal: ErpCommercialProposal;
  onClose: () => void;
  onSave: (updated: ErpCommercialProposal) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ErpCommercialProposal>(() => structuredClone(proposal));
  const [saving, setSaving] = useState(false);

  const recompute = (next: ErpCommercialProposal): ErpCommercialProposal => {
    const items = next.items.map((it) => ({
      ...it,
      totalMonthly: Math.max(1, Number(it.quantity || 1)) * Number(it.unitPrice || 0),
    }));
    const rec = items.filter((i) => i.isRecurring !== false).reduce((s, i) => s + i.totalMonthly, 0);
    const setup = items.filter((i) => i.isRecurring === false).reduce((s, i) => s + i.totalMonthly, 0);
    const discount = Number(next.discountAmount || 0);
    const mrr = Math.max(0, rec - discount);
    const months = Math.max(1, Number(next.contractMonths || 24));
    return {
      ...next,
      items,
      contractMonths: months,
      monthlyRecurringTotal: mrr,
      oneTimeSetupTotal: setup,
      totalContractValue: mrr * months + setup,
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(recompute(draft));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-4xl w-full overflow-hidden my-8">
        <div className="px-6 py-4 bg-[#1e3a6e] text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-300" />
            <div>
              <span className="text-[10px] font-extrabold uppercase text-emerald-300 block">
                Editor Completo de Proposta / Orçamento — Seta Telecom
              </span>
              <h3 className="text-sm font-extrabold">
                Editando {draft.code} — {draft.companyName}
              </h3>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-300 hover:text-white cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs max-h-[82vh] overflow-y-auto">
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
              <label className="block font-bold text-slate-700 mb-1">Título da Proposta *</label>
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
              <label className="block font-bold text-slate-700 mb-1">Cliente / Razão Social *</label>
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
              <label className="block font-bold text-slate-700 mb-1">Executivo Seta Telecom</label>
              <input
                type="text"
                value={draft.sellerName}
                onChange={(e) => setDraft({ ...draft, sellerName: e.target.value })}
                className="w-full px-3 py-2 rounded border border-slate-300"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Prazo (Meses)</label>
              <input
                type="number"
                min={1}
                value={draft.contractMonths}
                onChange={(e) =>
                  setDraft(recompute({ ...draft, contractMonths: Math.max(1, Number(e.target.value) || 24) }))
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
                  setDraft(recompute({ ...draft, discountAmount: Math.max(0, Number(e.target.value) || 0) }))
                }
                className="w-full px-3 py-2 rounded border border-slate-300"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Validade</label>
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
                Itens da Proposta ({draft.items.length})
              </span>
              <button
                type="button"
                onClick={() => {
                  const newItem: ErpProposalItem = {
                    id: `item-${Date.now()}`,
                    sku: `GC-EQ-00${draft.items.length + 101}`,
                    description: 'Equipamento / Serviço Adicional Seta Telecom',
                    fiscalNature: 'LOCACAO_BENS_MOVEIS',
                    ncmOrServiceCode: 'NCM 8517.62.59 (0% ISS — SV 31 STF)',
                    quantity: 1,
                    unitPrice: 1200,
                    discountPercent: 0,
                    isRecurring: true,
                    totalMonthly: 1200,
                  };
                  setDraft(recompute({ ...draft, items: [...draft.items, newItem] }));
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
                        setDraft(recompute({ ...draft, items: copy }));
                      }}
                      className="w-full px-2 py-1 rounded border font-mono text-xs"
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <label className="text-[10px] text-slate-400 block">Descrição</label>
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) => {
                        const copy = [...draft.items];
                        copy[idx] = { ...copy[idx], description: e.target.value };
                        setDraft(recompute({ ...draft, items: copy }));
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
                        setDraft(recompute({ ...draft, items: copy }));
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
                        copy[idx] = { ...copy[idx], quantity: Math.max(1, Number(e.target.value) || 1) };
                        setDraft(recompute({ ...draft, items: copy }));
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
                        copy[idx] = { ...copy[idx], unitPrice: Math.max(0, Number(e.target.value) || 0) };
                        setDraft(recompute({ ...draft, items: copy }));
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
                        setDraft(recompute({ ...draft, items: copy }));
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
              <span>Mensalidade (MRR): {formatBRL(draft.monthlyRecurringTotal)}/mês</span>
              <span>Valor Global ({draft.contractMonths}m): {formatBRL(draft.totalContractValue)}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Observações Comerciais</label>
              <textarea
                rows={2}
                value={draft.commercialNotes}
                onChange={(e) => setDraft({ ...draft, commercialNotes: e.target.value })}
                className="w-full px-3 py-2 rounded border border-slate-300"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Cláusulas Técnicas &amp; SLA</label>
              <textarea
                rows={2}
                value={draft.technicalClauses}
                onChange={(e) => setDraft({ ...draft, technicalClauses: e.target.value })}
                className="w-full px-3 py-2 rounded border border-slate-300"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded border border-slate-300 font-bold text-slate-700 cursor-pointer">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 px-5 py-2 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white font-extrabold cursor-pointer">
              <Save className="w-4 h-4" />
              {saving ? 'Salvando...' : 'Salvar Alterações & Atualizar Link PDF'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
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
  const [draft, setDraft] = useState<ErpRentalContract>(() => structuredClone(contract));
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
      <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-3xl w-full overflow-hidden my-8">
        <div className="px-6 py-4 bg-indigo-950 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileCheck2 className="w-5 h-5 text-emerald-300" />
            <div>
              <span className="text-[10px] font-extrabold uppercase text-emerald-300 block">
                Editor de Contrato de Locação / Serviços — Seta Telecom
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

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs max-h-[82vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Empresa Locatária *</label>
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
              <label className="block font-bold text-slate-700 mb-1">Status</label>
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

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Aluguel Mensal (R$)</label>
              <input
                type="number"
                min={0}
                value={draft.monthlyValue}
                onChange={(e) => setDraft({ ...draft, monthlyValue: Number(e.target.value) || 0 })}
                className="w-full px-3 py-2 rounded border border-slate-300 font-extrabold text-emerald-700"
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
                className="w-full px-3 py-2 rounded border border-slate-300"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Prazo (Meses)</label>
              <input
                type="number"
                min={1}
                value={draft.contractMonths}
                onChange={(e) => setDraft({ ...draft, contractMonths: Number(e.target.value) || 24 })}
                className="w-full px-3 py-2 rounded border border-slate-300"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Índice Reajuste</label>
              <select
                value={draft.readjustmentIndex}
                onChange={(e) =>
                  setDraft({ ...draft, readjustmentIndex: e.target.value as 'IPCA' | 'IGP-M' | 'FIXO' })
                }
                className="w-full px-3 py-2 rounded border border-slate-300 bg-white"
              >
                <option value="IPCA">IPCA</option>
                <option value="IGP-M">IGP-M</option>
                <option value="FIXO">FIXO</option>
              </select>
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">NF-e Remessa Nº</label>
              <input
                type="text"
                value={draft.remessaNfeNumber}
                onChange={(e) => setDraft({ ...draft, remessaNfeNumber: e.target.value })}
                className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
              />
            </div>
          </div>

          {/* Equipments S/N */}
          <div className="border border-slate-200 rounded p-3 bg-slate-50 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-extrabold text-slate-800 uppercase text-[11px]">
                Equipamentos Locados &amp; Números de Série ({draft.equipments.length})
              </span>
              <button
                type="button"
                onClick={() => {
                  const eq: ErpRentalEquipmentItem = {
                    id: `eq-${Date.now()}`,
                    skuGestaoClick: `GC-EQ-00${draft.equipments.length + 101}`,
                    description: 'Equipamento Telecom Locado Seta',
                    serialNumber: `SN-SETA-${Math.floor(10000 + Math.random() * 90000)}`,
                    ncm: '8517.62.59',
                    quantity: 1,
                    unitMonthlyRent: 1200,
                    assetValueBrl: 12000,
                    remessaCfop: '5.908',
                    remessaNfeKey: '35261018456789000190550010004191011000419991',
                  };
                  setDraft({ ...draft, equipments: [...draft.equipments, eq] });
                }}
                className="px-2.5 py-1 rounded bg-[#1e3a6e] text-white text-xs font-bold cursor-pointer"
              >
                + Adicionar Equipamento S/N
              </button>
            </div>

            {draft.equipments.map((eq, idx) => (
              <div key={eq.id || idx} className="grid grid-cols-12 gap-2 items-center bg-white p-2 rounded border">
                <input
                  type="text"
                  value={eq.skuGestaoClick}
                  onChange={(e) => {
                    const copy = [...draft.equipments];
                    copy[idx] = { ...copy[idx], skuGestaoClick: e.target.value };
                    setDraft({ ...draft, equipments: copy });
                  }}
                  placeholder="SKU"
                  className="col-span-2 px-2 py-1 rounded border font-mono"
                />
                <input
                  type="text"
                  value={eq.description}
                  onChange={(e) => {
                    const copy = [...draft.equipments];
                    copy[idx] = { ...copy[idx], description: e.target.value };
                    setDraft({ ...draft, equipments: copy });
                  }}
                  placeholder="Equipamento"
                  className="col-span-4 px-2 py-1 rounded border font-semibold"
                />
                <input
                  type="text"
                  value={eq.serialNumber}
                  onChange={(e) => {
                    const copy = [...draft.equipments];
                    copy[idx] = { ...copy[idx], serialNumber: e.target.value };
                    setDraft({ ...draft, equipments: copy });
                  }}
                  placeholder="Nº Série"
                  className="col-span-3 px-2 py-1 rounded border font-mono"
                />
                <input
                  type="number"
                  value={eq.unitMonthlyRent}
                  onChange={(e) => {
                    const copy = [...draft.equipments];
                    copy[idx] = { ...copy[idx], unitMonthlyRent: Number(e.target.value) || 0 };
                    setDraft({ ...draft, equipments: copy });
                  }}
                  className="col-span-2 px-2 py-1 rounded border text-right font-bold"
                />
                <button
                  type="button"
                  disabled={draft.equipments.length <= 1}
                  onClick={() =>
                    setDraft({ ...draft, equipments: draft.equipments.filter((_, i) => i !== idx) })
                  }
                  className="col-span-1 text-rose-600 flex justify-center cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
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
  type?: 'text' | 'number' | 'select';
  options?: string[];
}

export function GenericRecordEditModal({
  title,
  initialValues,
  fields,
  onClose,
  onSave,
}: {
  title: string;
  initialValues: Record<string, unknown>;
  fields: GenericFieldSpec[];
  onClose: () => void;
  onSave: (values: Record<string, unknown>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...initialValues }));
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(values);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-lg w-full overflow-hidden my-8">
        <div className="px-6 py-4 bg-[#1e3a6e] text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Edit3 className="w-4 h-4 text-emerald-300" />
            <h3 className="text-sm font-extrabold">{title}</h3>
          </div>
          <button type="button" onClick={onClose} className="text-slate-300 hover:text-white cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-3 text-xs">
          {fields.map((f) => (
            <div key={f.key}>
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
              ) : (
                <input
                  type={f.type === 'number' ? 'number' : 'text'}
                  step={f.type === 'number' ? '0.01' : undefined}
                  value={String(values[f.key] ?? '')}
                  onChange={(e) =>
                    setValues({
                      ...values,
                      [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              )}
            </div>
          ))}

          <div className="flex justify-end gap-2 pt-3 border-t">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded border font-bold cursor-pointer">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="px-5 py-2 rounded bg-[#ff7a59] text-white font-extrabold cursor-pointer">
              {saving ? 'Salvando...' : 'Salvar Registro'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
