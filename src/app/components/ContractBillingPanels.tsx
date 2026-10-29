"use client";
import React, { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye } from "lucide-react";
import { ErpCatalogItem, ErpContractVersionEntry, ErpFiscalInvoice, ErpRentalContract, ErpRentalEquipmentItem } from "../../db/types";
import { formatBRL } from "./ui-helpers";
import { ContractAuxiliaryOptions, ContractBillingRunOptions, CustomDueDateRulePreset, RECEIPT_DRAFT_BANNER_TEXT, buildDraftReceiptHtml, computeCustomDueDateClient, computeUpcomingRecurringCycles, downloadContractBillingHistoryReportOnDemand, downloadContractInvoicesCsvOnDemand, downloadContractVersionPdfOnDemand, downloadInvoicePdfOnDemand, loadContractAuxiliaryOptions, matchInvoicesForContract, saveContractAuxiliaryOptions } from "../lib/contract-billing-utils";

type Weekday = 'NONE' | 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY';

const WEEKDAY_OPTIONS: Array<{ id: Weekday; label: string }> = [
  { id: 'NONE', label: 'Sem ajuste de dia da semana (dias corridos)' },
  { id: 'MONDAY', label: '+ Próxima Segunda-feira' },
  { id: 'TUESDAY', label: '+ Próxima Terça-feira' },
  { id: 'WEDNESDAY', label: '+ Próxima Quarta-feira' },
  { id: 'THURSDAY', label: '+ Próxima Quinta-feira' },
  { id: 'FRIDAY', label: '+ Próxima Sexta-feira' },
];

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function computeContractTotals(c: ErpRentalContract) {
  const products = round2(
    (c.equipments || []).reduce(
      (s, e) => s + Math.max(0, Number(e.quantity || 0)) * Number(e.unitMonthlyRent || 0),
      0
    )
  );
  const addition = Number(c.additionValueBrl || 0);
  const discount = Number(c.discountValueBrl || 0);
  const freight = c.includeFreightInInvoice ? Number(c.freightValueBrl || 0) : 0;
  const total = Math.max(0, round2(products + addition + freight - discount));
  return { products, addition, discount, freight, total };
}

function SectionCard({ title, subtitle, right, children }: { title: string; subtitle: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-extrabold text-[#0d2b4e]">{title}</h4>
          <p className="text-[11px] text-slate-500">{subtitle}</p>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function ClearableInput({ label, value, onChange, list, required, placeholder, disabled }: { label: string; value: string; onChange: (v: string) => void; list?: string; required?: boolean; placeholder?: string; disabled?: boolean }) {
  return (
    <div>
      <label className="block text-[11px] font-bold text-slate-600 mb-1">{label}{required ? ' *' : ''}</label>
      <div className="relative">
        <input type="text" list={list} value={value} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2 pr-8 rounded border border-slate-300 text-xs" />
        {value && !disabled && (
          <button type="button" aria-label={`Limpar ${label}`} onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-rose-600 text-xs cursor-pointer">x</button>
        )}
      </div>
    </div>
  );
}

function MoneyBox({ label, prefix, value, onChange, readOnly, caption, bold }: { label: string; prefix: string; value: number; onChange?: (n: number) => void; readOnly?: boolean; caption: string; bold?: boolean }) {
  return (
    <div>
      <label className="block text-[11px] font-bold text-slate-600 mb-1">{label}</label>
      <div className="flex">
        {prefix === 'R$' && <span className="px-2 py-2 rounded-l border border-r-0 border-slate-300 bg-slate-100 text-[11px] font-bold">R$</span>}
        <input type="number" step="0.01" value={Number.isFinite(value) ? value : 0} readOnly={readOnly} onChange={(e) => onChange?.(Number(e.target.value) || 0)} className={`w-full px-2 py-2 border border-slate-300 text-xs text-right ${prefix === 'R$' ? 'rounded-r' : 'rounded-l'} ${readOnly ? 'bg-slate-100' : 'bg-white'} ${bold ? 'font-black' : ''}`} />
        {prefix === '%' && <span className="px-2 py-2 rounded-r border border-l-0 border-slate-300 bg-slate-100 text-[11px] font-bold">%</span>}
      </div>
      <span className="text-[10px] text-slate-500">{caption}</span>
    </div>
  );
}

export function ContractGestaoClickDataPanel({
  draft,
  setDraft,
  catalog = [],
  disabled = false,
}: {
  draft: ErpRentalContract;
  setDraft: (updater: (prev: ErpRentalContract) => ErpRentalContract) => void;
  catalog?: ErpCatalogItem[];
  disabled?: boolean;
}) {
  const [aux, setAux] = useState<ContractAuxiliaryOptions>(() => loadContractAuxiliaryOptions());
  const [emailInput, setEmailInput] = useState('');
  const totals = computeContractTotals(draft);

  const patch = (p: Partial<ErpRentalContract>) => setDraft((prev) => {
    const next = { ...prev, ...p };
    const t = computeContractTotals(next);
    return { ...next, productsSubtotalBrl: t.products, monthlyValue: t.total > 0 ? t.total : next.monthlyValue };
  });

  const updateEq = (idx: number, p: Partial<ErpRentalEquipmentItem>) => {
    const eqs = [...(draft.equipments || [])];
    eqs[idx] = { ...eqs[idx], ...p };
    patch({ equipments: eqs });
  };

  const addAuxInline = (key: 'paymentMethods' | 'costCenters' | 'chartOfAccountsList', value: string) => {
    const v = value.trim();
    if (!v || aux[key].includes(v)) return;
    const next = { ...aux, [key]: [...aux[key], v] };
    setAux(next);
    saveContractAuxiliaryOptions(next);
  };

  const emails = draft.billingRecipientEmails || [];
  const addEmails = (raw: string) => {
    const parts = raw.split(/[;,\s]+/).map((s) => s.trim()).filter((s) => /.+@.+\..+/.test(s));
    if (parts.length === 0) return;
    patch({ billingRecipientEmails: Array.from(new Set([...emails, ...parts])) });
    setEmailInput('');
  };

  const ruleCalc = computeCustomDueDateClient({
    baseDate: new Date().toISOString().slice(0, 10),
    offsetDays: Number(draft.customDueOffsetDays ?? 45),
    targetWeekday: draft.customDueTargetWeekday || 'WEDNESDAY',
  });

  const applyRulePreset = (r: CustomDueDateRulePreset) => {
    patch({ customDueRuleEnabled: true, customDueOffsetDays: r.offsetDays, customDueTargetWeekday: r.targetWeekday, customDueRuleLabel: r.label });
  };

  const fmtIsoBr = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

  return (
    <fieldset disabled={disabled} className="space-y-4">
      <datalist id="aux-payment-methods">{aux.paymentMethods.map((o) => <option key={o} value={o} />)}</datalist>
      <datalist id="aux-cost-centers">{aux.costCenters.map((o) => <option key={o} value={o} />)}</datalist>
      <datalist id="aux-chart-accounts">{aux.chartOfAccountsList.map((o) => <option key={o} value={o} />)}</datalist>
      <datalist id="aux-catalog-products">{catalog.map((c) => <option key={c.id} value={`${c.gestaoClickCode} - ${c.name}`} />)}</datalist>

      <SectionCard title="Dados do contrato" subtitle="Vendedor, centro de custo, plano de contas, proposta, frete, número, NF de remessa e prazo.">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <ClearableInput label="Vendedor" value={draft.sellerName || ''} onChange={(v) => patch({ sellerName: v })} />
          <div>
            <ClearableInput label="Centro de custo" list="aux-cost-centers" value={draft.costCenter || ''} onChange={(v) => patch({ costCenter: v })} />
            <button type="button" onClick={() => addAuxInline('costCenters', draft.costCenter || '')} className="text-[10px] font-bold text-[#1e3a6e] underline cursor-pointer">+ Cadastrar em Opções Auxiliares</button>
          </div>
          <div>
            <ClearableInput label="Plano de contas" required list="aux-chart-accounts" value={draft.chartOfAccounts || ''} onChange={(v) => patch({ chartOfAccounts: v })} />
            <button type="button" onClick={() => addAuxInline('chartOfAccountsList', draft.chartOfAccounts || '')} className="text-[10px] font-bold text-[#1e3a6e] underline cursor-pointer">+ Cadastrar em Opções Auxiliares</button>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <ClearableInput label="Proposta" value={draft.proposalNumber || ''} onChange={(v) => patch({ proposalNumber: v })} />
          <MoneyBox label="Frete" prefix="R$" value={Number(draft.freightValueBrl || 0)} onChange={(n) => patch({ freightValueBrl: n })} caption="Valor do frete." />
          <ClearableInput label="Contrato n." value={draft.externalContractNumber || ''} onChange={(v) => patch({ externalContractNumber: v })} placeholder={draft.contractNumber} />
          <ClearableInput label="Nota Fiscal de Remessa" value={draft.remessaNfeNumber || ''} onChange={(v) => patch({ remessaNfeNumber: v })} />
          <ClearableInput label="Prazo do Contrato" value={draft.contractTermLabel || `${draft.contractMonths} meses`} onChange={(v) => { const m = parseInt(v, 10); patch({ contractTermLabel: v, ...(m > 0 ? { contractMonths: m } : {}) }); }} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <ClearableInput label="Número do Pedido do Cliente (PO / Ordem de Compra)" value={draft.customerPurchaseOrderNumber || ''} onChange={(v) => patch({ customerPurchaseOrderNumber: v })} placeholder="PED-CLI-2026-8840" />
          <ClearableInput label="Medição / Boletim de Medição (BM)" value={draft.measurementNumber || ''} onChange={(v) => patch({ measurementNumber: v })} placeholder="BM-10/2026-01" />
          <ClearableInput label="Período de Medição" value={draft.measurementPeriod || ''} onChange={(v) => patch({ measurementPeriod: v })} placeholder="01/10/2026 a 31/10/2026" />
          <ClearableInput label="Observações da Medição" value={draft.measurementNotes || ''} onChange={(v) => patch({ measurementNotes: v })} />
        </div>
      </SectionCard>

      <SectionCard title="Adicione os produtos locados" subtitle="Produto, variação, quantidade e valor de cada cobrança.">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-slate-500">
              <tr>
                <th className="text-left py-1 px-1">Produto *</th>
                <th className="text-left py-1 px-1">Variação / detalhes</th>
                <th className="text-right py-1 px-1">Quantidade *</th>
                <th className="text-right py-1 px-1">Vr. unitário *</th>
                <th className="text-right py-1 px-1">Subtotal</th>
                <th className="text-right py-1 px-1">Ações</th>
              </tr>
            </thead>
            <tbody>
              {(draft.equipments || []).map((eq, idx) => {
                const cat = catalog.find((c) => c.gestaoClickCode === eq.skuGestaoClick);
                const stock = eq.stockAvailable ?? cat?.stockAvailable ?? 0;
                return (
                  <tr key={eq.id || idx} className="align-top">
                    <td className="p-1 min-w-[240px]">
                      <input type="text" list="aux-catalog-products" value={eq.skuGestaoClick ? `${eq.skuGestaoClick} - ${eq.description}`.replace(`${eq.skuGestaoClick} - ${eq.skuGestaoClick} - `, `${eq.skuGestaoClick} - `) : eq.description} onChange={(e) => {
                        const val = e.target.value;
                        const found = catalog.find((c) => val.startsWith(`${c.gestaoClickCode} - `) || val === c.gestaoClickCode);
                        if (found) updateEq(idx, { skuGestaoClick: found.gestaoClickCode, description: found.name, unitMonthlyRent: eq.unitMonthlyRent || found.monthlyRentalPrice, stockAvailable: found.stockAvailable, ncm: (found.ncmOrLc116.match(/\d{4}\.\d{2}\.\d{2}/) || [eq.ncm])[0] });
                        else updateEq(idx, { description: val });
                      }} className="w-full px-2 py-1.5 rounded border border-slate-300" />
                    </td>
                    <td className="p-1 min-w-[180px]">
                      <input type="text" value={eq.variationDetails || ''} placeholder="Variação / detalhes" onChange={(e) => updateEq(idx, { variationDetails: e.target.value })} className="w-full px-2 py-1.5 rounded border border-slate-300" />
                      <div className="grid grid-cols-2 gap-1 mt-1">
                        <input type="text" value={eq.serialNumber} placeholder="S/N" onChange={(e) => updateEq(idx, { serialNumber: e.target.value })} className="px-1.5 py-1 rounded border border-slate-200 font-mono text-[10px]" />
                        <input type="text" value={eq.assetTag || ''} placeholder="Patrimônio" onChange={(e) => updateEq(idx, { assetTag: e.target.value })} className="px-1.5 py-1 rounded border border-slate-200 font-mono text-[10px]" />
                      </div>
                    </td>
                    <td className="p-1 w-24">
                      <input type="number" step="0.01" min={0} value={eq.quantity} onChange={(e) => updateEq(idx, { quantity: Number(e.target.value) || 0 })} className="w-full px-2 py-1.5 rounded border border-slate-300 text-right" />
                      <span className="text-[10px] text-slate-500 block text-right">Estoque: {Number(stock).toFixed(2).replace('.', ',')}</span>
                    </td>
                    <td className="p-1 w-28"><input type="number" step="0.01" min={0} value={eq.unitMonthlyRent} onChange={(e) => updateEq(idx, { unitMonthlyRent: Number(e.target.value) || 0 })} className="w-full px-2 py-1.5 rounded border border-slate-300 text-right" /></td>
                    <td className="p-1 w-28"><input type="text" readOnly value={(Number(eq.quantity || 0) * Number(eq.unitMonthlyRent || 0)).toFixed(2).replace('.', ',')} className="w-full px-2 py-1.5 rounded border border-slate-200 bg-slate-100 text-right font-bold" /></td>
                    <td className="p-1 text-right"><button type="button" aria-label="Excluir produto" onClick={() => patch({ equipments: draft.equipments.filter((_, i) => i !== idx) })} className="px-2 py-1.5 rounded bg-rose-600 text-white font-bold cursor-pointer">Excluir</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button type="button" onClick={() => patch({ equipments: [...(draft.equipments || []), { id: `eq-${Date.now()}`, skuGestaoClick: '', description: '', serialNumber: '', assetTag: '', assetStatus: 'EM_CLIENTE', ncm: '8517.62.59', quantity: 1, unitMonthlyRent: 0, assetValueBrl: 0, remessaCfop: draft.remessaCfop || '5.908', remessaNfeKey: '' }] })} className="px-3 py-1.5 rounded border border-[#1e3a6e] text-[#1e3a6e] text-xs font-extrabold cursor-pointer">+ Adicionar outro produto</button>
      </SectionCard>

      <SectionCard title="Confira o total da locação" subtitle="Acréscimo e desconto aplicados sobre a soma dos produtos.">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <MoneyBox label="Produtos" prefix="R$" value={totals.products} readOnly caption="Soma dos produtos." />
          <MoneyBox label="Acréscimo" prefix="R$" value={totals.addition} onChange={(n) => patch({ additionValueBrl: n })} caption="Somado à locação." />
          <MoneyBox label="Desconto" prefix="R$" value={totals.discount} onChange={(n) => patch({ discountValueBrl: n, discountPercent: totals.products > 0 ? round2((n / totals.products) * 100) : 0 })} caption="Em reais." />
          <MoneyBox label="Desconto" prefix="%" value={Number(draft.discountPercent || 0)} onChange={(n) => patch({ discountPercent: n, discountValueBrl: round2((totals.products * n) / 100) })} caption="Preencha um dos dois." />
          <MoneyBox label="Valor total *" prefix="R$" value={totals.total} readOnly bold caption="Valor de cada fatura do aluguel." />
        </div>
        <label className="inline-flex items-center gap-2 text-[11px] font-bold text-slate-700">
          <input type="checkbox" checked={Boolean(draft.includeFreightInInvoice)} onChange={(e) => patch({ includeFreightInInvoice: e.target.checked })} /> Incluir frete na fatura (Produtos + Acréscimo + Frete - Desconto)
        </label>
      </SectionCard>

      <SectionCard title="Combine a entrega e a retirada" subtitle="Quando e onde os produtos chegam e de onde voltam.">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><label className="block text-[11px] font-bold text-slate-600 mb-1">Data de Entrega / Envio</label><input type="date" value={(draft.deliveryDate || '').slice(0, 10)} onChange={(e) => patch({ deliveryDate: e.target.value })} className="w-full px-2 py-2 rounded border border-slate-300 text-xs" /></div>
          <div><label className="block text-[11px] font-bold text-slate-600 mb-1">Data Prevista de Retirada / Devolução</label><input type="date" value={(draft.pickupDate || '').slice(0, 10)} onChange={(e) => patch({ pickupDate: e.target.value })} className="w-full px-2 py-2 rounded border border-slate-300 text-xs" /></div>
          <ClearableInput label="Cidade" value={draft.deliveryCity || ''} onChange={(v) => patch({ deliveryCity: v })} />
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">Modalidade de Frete</label>
            <select value={draft.freightModality || 'CIF_EMITENTE'} onChange={(e) => patch({ freightModality: e.target.value as ErpRentalContract['freightModality'] })} className="w-full px-2 py-2 rounded border border-slate-300 bg-white text-xs">
              <option value="CIF_EMITENTE">CIF (por conta do emitente)</option>
              <option value="FOB_DESTINATARIO">FOB (por conta do destinatário)</option>
              <option value="TERCEIROS">Por conta de terceiros</option>
              <option value="PROPRIO_SETA">Transporte próprio Seta</option>
              <option value="SEM_FRETE">Sem frete</option>
            </select>
          </div>
          <ClearableInput label="Transportadora / Motorista / Placa" value={draft.deliveryCarrier || ''} onChange={(v) => patch({ deliveryCarrier: v })} />
          <ClearableInput label="Código de Rastreio / CT-e / Romaneio" value={draft.freightTrackingCode || ''} onChange={(v) => patch({ freightTrackingCode: v })} />
          <MoneyBox label="Frete de Retirada / Devolução" prefix="R$" value={Number(draft.returnFreightValueBrl || 0)} onChange={(n) => patch({ returnFreightValueBrl: n })} caption="Cobrado na devolução." />
          <ClearableInput label="Endereço de Entrega / Instalação e Retirada" value={draft.deliveryAddress || ''} onChange={(v) => patch({ deliveryAddress: v })} />
        </div>
        <ClearableInput label="Observações de Logística / Entrega e Retirada" value={draft.deliveryNotes || ''} onChange={(v) => patch({ deliveryNotes: v })} />
      </SectionCard>

      <SectionCard
        title="Defina a recorrência da cobrança"
        subtitle="Quando vence, de quanto em quanto tempo repete e até quando."
        right={
          <div className="inline-flex rounded border border-slate-300 overflow-hidden text-[11px] font-bold">
            {([['SEM_TERMINO', 'Sem término'], ['ATE_UMA_DATA', 'Até uma data'], ['POR_VEZES', 'Por vezes']] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => patch({ recurrenceEndMode: id })} className={`px-3 py-1.5 cursor-pointer ${(draft.recurrenceEndMode || 'SEM_TERMINO') === id ? 'bg-[#0d2b4e] text-white' : 'bg-white text-slate-700'}`}>{label}</button>
            ))}
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div><label className="block text-[11px] font-bold text-slate-600 mb-1">Próximo vencimento *</label><input type="date" value={(draft.nextBillingDate || draft.nextDueDate || '').slice(0, 10)} onChange={(e) => patch({ nextBillingDate: e.target.value, nextDueDate: e.target.value })} className="w-full px-2 py-2 rounded border border-slate-300 text-xs" /></div>
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">Repetir a cobrança *</label>
            <select value={draft.billingRecurrence || 'MENSAL'} onChange={(e) => { const opt = aux.recurrenceOptions.find((o) => o.id === e.target.value); patch({ billingRecurrence: e.target.value as ErpRentalContract['billingRecurrence'], periodicityLabel: opt?.label }); }} className="w-full px-2 py-2 rounded border border-slate-300 bg-white text-xs">
              {aux.recurrenceOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">Gerar a fatura *</label>
            <select value={String(draft.autoGenerateInvoiceDaysBeforeDue ?? 21)} onChange={(e) => patch({ autoGenerateInvoiceDaysBeforeDue: Number(e.target.value) })} className="w-full px-2 py-2 rounded border border-slate-300 bg-white text-xs">
              {aux.invoiceAdvanceDaysOptions.map((d) => <option key={d} value={d}>{d === 0 ? 'No dia do vencimento' : `${d} dias antes do vencimento`}</option>)}
            </select>
          </div>
          {draft.recurrenceEndMode === 'ATE_UMA_DATA' && (
            <div><label className="block text-[11px] font-bold text-slate-600 mb-1">Até a data</label><input type="date" value={(draft.endDate || '').slice(0, 10)} onChange={(e) => patch({ endDate: e.target.value })} className="w-full px-2 py-2 rounded border border-slate-300 text-xs" /></div>
          )}
          {draft.recurrenceEndMode === 'POR_VEZES' && (
            <div><label className="block text-[11px] font-bold text-slate-600 mb-1">Quantidade de cobranças</label><input type="number" min={1} value={draft.recurrenceOccurrencesLimit || draft.contractMonths} onChange={(e) => patch({ recurrenceOccurrencesLimit: Number(e.target.value) || 1, totalInstallmentsCount: Number(e.target.value) || 1 })} className="w-full px-2 py-2 rounded border border-slate-300 text-xs" /></div>
          )}
        </div>

        <div className="rounded border border-indigo-200 bg-indigo-50/60 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 text-[11px] font-extrabold text-indigo-950">
              <input type="checkbox" checked={Boolean(draft.customDueRuleEnabled)} onChange={(e) => patch({ customDueRuleEnabled: e.target.checked })} /> Regra Customizável de Vencimento (X dias + dia da semana)
            </label>
            <select aria-label="Regras salvas" value="" onChange={(e) => { const r = aux.customDueDateRules.find((x) => x.id === e.target.value); if (r) applyRulePreset(r); }} className="px-2 py-1.5 rounded border border-indigo-300 bg-white text-[11px] font-bold">
              <option value="">Aplicar regra salva em Opções Auxiliares...</option>
              {aux.customDueDateRules.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div><label className="block text-[11px] font-bold text-slate-600 mb-1">Prazo base (dias)</label><input type="number" min={0} value={draft.customDueOffsetDays ?? 45} onChange={(e) => { const off = Math.max(0, Number(e.target.value) || 0); const lbl = computeCustomDueDateClient({ offsetDays: off, targetWeekday: draft.customDueTargetWeekday || 'WEDNESDAY' }).ruleLabel; patch({ customDueOffsetDays: off, customDueRuleLabel: lbl }); }} className="w-full px-2 py-2 rounded border border-slate-300 text-xs" /></div>
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">Ajustar para dia da semana</label>
              <select value={draft.customDueTargetWeekday || 'WEDNESDAY'} onChange={(e) => { const wd = e.target.value as Weekday; const lbl = computeCustomDueDateClient({ offsetDays: Number(draft.customDueOffsetDays ?? 45), targetWeekday: wd }).ruleLabel; patch({ customDueTargetWeekday: wd, customDueRuleLabel: lbl }); }} className="w-full px-2 py-2 rounded border border-slate-300 bg-white text-xs">
                {WEEKDAY_OPTIONS.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <button type="button" onClick={() => patch({ customDueRuleEnabled: true, nextBillingDate: ruleCalc.dueDateIso, nextDueDate: ruleCalc.dueDateIso, customDueRuleLabel: ruleCalc.ruleLabel })} className="w-full px-3 py-2 rounded bg-indigo-700 text-white text-xs font-extrabold cursor-pointer">Aplicar ao Próximo Vencimento</button>
            </div>
          </div>
          <div data-testid="due-rule-preview" className="text-[11px] font-bold text-indigo-900">
            Simulação: Emissão {fmtIsoBr(ruleCalc.baseDateIso)} + {draft.customDueOffsetDays ?? 45} dias ({fmtIsoBr(ruleCalc.afterOffsetDateIso)}) {'->'} Vencimento calculado: {ruleCalc.dueDateBr} ({ruleCalc.weekdayLabelPt}) • Regra: {ruleCalc.ruleLabel}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Escolha a cobrança e as automações" subtitle="Forma de pagamento e envio da fatura ao cliente.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <ClearableInput label="Forma de pagamento" required list="aux-payment-methods" value={draft.paymentMethod || ''} onChange={(v) => patch({ paymentMethod: v })} />
            <button type="button" onClick={() => addAuxInline('paymentMethods', draft.paymentMethod || '')} className="text-[10px] font-bold text-[#1e3a6e] underline cursor-pointer">+ Cadastrar em Opções Auxiliares</button>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">Enviar a fatura por e-mail *</label>
            <select value={draft.emailAutomationMode || ''} onChange={(e) => patch({ emailAutomationMode: e.target.value, autoSendEmailOnBilling: e.target.value !== '' && e.target.value !== 'Não enviar e-mail' })} className="w-full px-2 py-2 rounded border border-slate-300 bg-white text-xs">
              <option value="">Selecione</option>
              {aux.emailAutomationOptions.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Destinatários da fatura (mais de 1 e-mail — separe por vírgula ou ponto e vírgula)</label>
          <div className="flex flex-wrap items-center gap-1.5 p-2 rounded border border-slate-300 bg-white">
            {emails.map((em) => (
              <span key={em} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-[11px] font-bold text-[#1e3a6e]">
                {em}
                <button type="button" aria-label={`Remover ${em}`} onClick={() => patch({ billingRecipientEmails: emails.filter((x) => x !== em) })} className="text-rose-600 cursor-pointer">x</button>
              </span>
            ))}
            <input type="text" value={emailInput} onChange={(e) => setEmailInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',' || e.key === ';') { e.preventDefault(); addEmails(emailInput); } }} onBlur={() => emailInput && addEmails(emailInput)} placeholder="financeiro@cliente.com.br; compras@cliente.com.br" className="flex-1 min-w-[200px] px-1 py-1 text-xs outline-none" />
            <button type="button" onClick={() => addEmails(emailInput)} className="px-2 py-1 rounded bg-[#1e3a6e] text-white text-[11px] font-bold cursor-pointer">+ Adicionar outro e-mail</button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 rounded border border-amber-200 bg-amber-50 p-3">
          <div>
            <div className="text-xs font-extrabold text-amber-900">Gerar a próxima fatura agora</div>
            <div className="text-[11px] text-amber-800">Lança a fatura do próximo vencimento assim que salvar.</div>
          </div>
          <label className="inline-flex items-center cursor-pointer">
            <input type="checkbox" role="switch" aria-label="Gerar a próxima fatura agora" checked={Boolean(draft.generateNextInvoiceOnSave)} onChange={(e) => patch({ generateNextInvoiceOnSave: e.target.checked })} className="w-5 h-5 accent-amber-600" />
          </label>
        </div>
      </SectionCard>

      <SectionCard title="Insira as informações de observação e anexos" subtitle="Observação que sai na impressão e arquivos da locação.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="block text-[11px] font-bold text-slate-600 mb-1">Observações (impressas no contrato e na fatura)</label><textarea rows={3} value={draft.contractNotes || ''} onChange={(e) => patch({ contractNotes: e.target.value })} className="w-full px-2 py-2 rounded border border-slate-300 text-xs" /></div>
          <div><label className="block text-[11px] font-bold text-slate-600 mb-1">Observações internas</label><textarea rows={3} value={draft.internalNotes || ''} onChange={(e) => patch({ internalNotes: e.target.value })} className="w-full px-2 py-2 rounded border border-slate-300 text-xs" /></div>
        </div>
        <div className="space-y-1">
          <label className="block text-[11px] font-bold text-slate-600">Anexos da locação (somente metadados leves — sem binários em disco)</label>
          <input type="file" multiple onChange={(e) => { const files = Array.from(e.target.files || []); if (!files.length) return; patch({ contractAttachments: [...(draft.contractAttachments || []), ...files.map((f) => ({ id: `att-${Date.now()}-${f.name}`, fileName: f.name, fileType: f.type || 'arquivo', addedAt: new Date().toISOString() }))] }); e.target.value = ''; }} className="text-xs" />
          {(draft.contractAttachments || []).map((a) => (
            <div key={a.id} className="flex items-center justify-between text-[11px] border border-slate-200 rounded px-2 py-1">
              <span>{a.fileName} ({a.fileType})</span>
              <button type="button" onClick={() => patch({ contractAttachments: (draft.contractAttachments || []).filter((x) => x.id !== a.id) })} className="text-rose-600 font-bold cursor-pointer">Remover</button>
            </div>
          ))}
        </div>
      </SectionCard>
    </fieldset>
  );
}

export function invoiceTypeBadge(inv: ErpFiscalInvoice): { label: string; cls: string } {
  if (inv.documentType === 'FATURA_LOCACAO') return { label: 'Fatura de Locação', cls: 'bg-emerald-100 text-emerald-800' };
  if (inv.documentType === 'NFSE_SERVICO') return { label: 'NFS-e Serviço', cls: 'bg-indigo-100 text-indigo-800' };
  if (inv.documentType === 'NFE_REMESSA_LOCACAO') {
    const isRet = String(inv.cfop || '').includes('909') || inv.documentNumber.includes('RET');
    return isRet ? { label: 'NF-e Retorno 5.909', cls: 'bg-amber-100 text-amber-800' } : { label: 'NF-e Remessa 5.908', cls: 'bg-blue-100 text-blue-800' };
  }
  return { label: inv.documentType, cls: 'bg-slate-100 text-slate-700' };
}

function invoiceStatusLabel(inv: ErpFiscalInvoice): string {
  if (inv.status === 'PAGA') return 'PAGA / QUITADA';
  if (inv.status === 'VENCIDA') return 'PENDENTE (VENCIDA)';
  if (inv.status === 'CANCELADA') return 'CANCELADA';
  return 'EMITIDA';
}

/** Botão padrão "Visualizar recibo (rascunho)" (ícone de olho). */
export function ReceiptDraftPreviewButton({ onClick, className = '', label = 'Visualizar recibo (rascunho)' }: { onClick: () => void; className?: string; label?: string }) {
  return (
    <button
      type="button"
      data-testid="btn-preview-receipt-draft"
      title="Pré-visualizar o recibo/fatura A4 com os dados atuais (sem salvar, sem emitir e sem enviar e-mail)"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded border-2 border-[#0d2b4e] bg-white text-[#0d2b4e] hover:bg-slate-50 font-extrabold cursor-pointer ${className}`}
    >
      <Eye className="w-4 h-4" /> {label}
    </button>
  );
}

/**
 * Pré-visualização do RASCUNHO do recibo/fatura de locação (A4), gerada on-the-fly
 * a partir dos dados atuais do formulário. Não cria fatura, título, NF, não envia
 * e-mail e não grava nada em disco/banco.
 */
export function ReceiptDraftPreviewModal({
  contract,
  options,
  existingInvoicesCount = 0,
  onClose,
  onFinalize,
  finalizeLabel = 'Finalizar faturamento',
}: {
  contract: ErpRentalContract;
  options: ContractBillingRunOptions;
  existingInvoicesCount?: number;
  onClose: () => void;
  onFinalize?: () => void | Promise<void>;
  finalizeLabel?: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [finalizing, setFinalizing] = useState(false);
  const { invoice, html } = useMemo(
    () => buildDraftReceiptHtml(contract, options, existingInvoicesCount),
    [contract, options, existingInvoicesCount]
  );
  const print = () => {
    const w = iframeRef.current?.contentWindow;
    if (w) {
      w.focus();
      w.print();
    }
  };
  const modal = (
    <div data-testid="receipt-draft-preview" role="dialog" aria-modal="true" aria-label="Pré-visualização do recibo (rascunho)" className="fixed inset-0 z-[80] bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4" onClick={(e) => e.stopPropagation()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[96vh] flex flex-col overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-[#0d2b4e] text-white">
          <div>
            <div className="text-sm font-extrabold flex items-center gap-2"><Eye className="w-4 h-4" /> Visualizar recibo — rascunho antes de finalizar o faturamento</div>
            <div className="text-[11px] text-slate-200">
              Nº provisório <span className="font-mono font-bold">{invoice.documentNumber}</span> • {contract.companyName} • Competência {invoice.competenceMonth} • Vencimento {invoice.dueDate.split('-').reverse().join('/')} • Total {formatBRL(invoice.netAmount)}
            </div>
          </div>
          <span className="px-2 py-1 rounded bg-rose-600 text-white text-[10px] font-black uppercase">{RECEIPT_DRAFT_BANNER_TEXT}</span>
        </div>
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-900 font-bold">
          Este rascunho é gerado no navegador com os dados atuais do formulário (mesmo não salvos). Nada é salvo, nenhuma fatura, título no Contas a Receber ou NF é criada e nenhum e-mail é enviado até você clicar em <strong>{finalizeLabel}</strong>.
        </div>
        <div className="flex-1 overflow-auto bg-slate-200 p-2 sm:p-4">
          <iframe ref={iframeRef} title="Rascunho do recibo A4" srcDoc={html} className="w-full bg-white shadow mx-auto block" style={{ maxWidth: '230mm', height: '75vh', border: 0 }} />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50 text-xs">
          <button type="button" onClick={print} className="px-3 py-2 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white font-extrabold cursor-pointer">Imprimir / Baixar PDF</button>
          <button type="button" onClick={onClose} disabled={finalizing} className="px-3 py-2 rounded border border-slate-300 bg-white font-bold cursor-pointer">Voltar e editar</button>
          {onFinalize && (
            <button
              type="button"
              data-testid="btn-finalize-billing-from-preview"
              disabled={finalizing}
              onClick={async () => {
                setFinalizing(true);
                try {
                  await onFinalize();
                  onClose();
                } finally {
                  setFinalizing(false);
                }
              }}
              className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-extrabold cursor-pointer"
            >
              {finalizing ? 'Finalizando...' : finalizeLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
  return typeof document !== 'undefined' ? createPortal(modal, document.body) : modal;
}

export function ContractBillingHistoryPanel({
  contract,
  invoices,
  highlightInvoiceId,
  onGenerateNew,
  onGenerateCustom,
  onView,
  onEdit,
  onEmail,
  onGoFiscal,
  onGoReceivables,
  compact = false,
}: {
  contract: ErpRentalContract;
  invoices: ErpFiscalInvoice[];
  highlightInvoiceId?: string | null;
  onGenerateNew?: () => void | Promise<void>;
  onGenerateCustom?: (opts: { competenceMonth: string; dueDate: string; customAmountBrl?: number; customerPurchaseOrderNumber?: string; measurementNumber?: string; measurementPeriod?: string; notes?: string }) => void | Promise<void>;
  onView?: (inv: ErpFiscalInvoice) => void;
  onEdit?: (inv: ErpFiscalInvoice) => void;
  onEmail?: (inv: ErpFiscalInvoice) => void;
  onGoFiscal?: (inv: ErpFiscalInvoice) => void;
  onGoReceivables?: (inv: ErpFiscalInvoice) => void;
  compact?: boolean;
}) {
  const list = useMemo(
    () => matchInvoicesForContract(contract, invoices).sort((a, b) => (b.createdAt || b.issueDate).localeCompare(a.createdAt || a.issueDate)),
    [contract, invoices]
  );
  const [view, setView] = useState<'EMITIDAS' | 'CRONOGRAMA'>('EMITIDAS');
  const [showCustom, setShowCustom] = useState(false);
  const now = new Date();
  const [comp, setComp] = useState(`${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`);
  const [due, setDue] = useState((contract.nextBillingDate || contract.nextDueDate || new Date(Date.now() + 10 * 86400000).toISOString()).slice(0, 10));
  const [amount, setAmount] = useState<string>(String(contract.monthlyValue || 0));
  const [po, setPo] = useState(contract.customerPurchaseOrderNumber || '');
  const [bm, setBm] = useState(contract.measurementNumber || '');
  const [bmPeriod, setBmPeriod] = useState(contract.measurementPeriod || '');
  const [notes, setNotes] = useState('');
  const [draftPreview, setDraftPreview] = useState<{ options: ContractBillingRunOptions; finalize?: () => void | Promise<void> } | null>(null);
  const customOpts = () => ({ competenceMonth: comp, dueDate: due, customAmountBrl: Number(amount) || undefined, customerPurchaseOrderNumber: po, measurementNumber: bm, measurementPeriod: bmPeriod, notes });
  const cycles = computeUpcomingRecurringCycles(contract, 6);
  const recLabel = contract.periodicityLabel || ({ MENSAL: 'MENSAL', BIMESTRAL: 'BIMESTRAL', TRIMESTRAL: 'TRIMESTRAL', SEMESTRAL: 'SEMESTRAL', ANUAL: 'ANUAL' } as Record<string, string>)[contract.billingRecurrence || 'MENSAL'];

  return (
    <div data-testid="contract-billing-history" className="rounded-lg border-2 border-emerald-300 bg-emerald-50/40 p-3 space-y-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-extrabold text-emerald-950">Histórico de Faturamentos &amp; Notas do Contrato ({list.length})</h4>
          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
            <span className="px-2 py-0.5 rounded bg-white border border-emerald-300 text-[10px] font-bold text-emerald-900">
              Recorrência: {recLabel} • Dia Venc. {contract.dueDay} • {contract.paymentMethod || 'Boleto Inter'} • Auto D-{contract.autoGenerateInvoiceDaysBeforeDue ?? 21} • Próximo Ciclo: {(contract.nextBillingDate || contract.nextDueDate || '—').split('-').reverse().join('/')}
            </span>
            {contract.customDueRuleLabel && <span className="px-2 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-[10px] font-bold text-indigo-900">Regra de Vencimento: {contract.customDueRuleLabel}</span>}
            <span data-testid="pdf-on-demand-badge" className="px-2 py-0.5 rounded bg-slate-900 text-white text-[10px] font-bold">PDFs gerados sob demanda (0 MB em disco)</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ReceiptDraftPreviewButton onClick={() => setDraftPreview({ options: { competenceMonth: '11/2026' }, finalize: onGenerateNew ? () => onGenerateNew() : undefined })} />
          {onGenerateNew && <button type="button" onClick={() => void onGenerateNew()} className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold cursor-pointer">+ Gerar Novo Faturamento</button>}
          {onGenerateCustom && <button type="button" onClick={() => setShowCustom((v) => !v)} className="px-3 py-1.5 rounded border border-emerald-600 text-emerald-800 bg-white font-bold cursor-pointer">Personalizar competência / valor</button>}
          <button type="button" onClick={() => downloadContractInvoicesCsvOnDemand(contract, list)} className="px-3 py-1.5 rounded border border-slate-300 bg-white font-bold cursor-pointer">Baixar Histórico Completo (CSV / Excel)</button>
          <button type="button" onClick={() => downloadContractBillingHistoryReportOnDemand(contract, list, 'PRINT')} className="px-3 py-1.5 rounded border border-slate-300 bg-white font-bold cursor-pointer">Baixar / Imprimir Relatório de Faturas (PDF / A4)</button>
        </div>
      </div>

      {showCustom && onGenerateCustom && (
        <div className="grid grid-cols-2 sm:grid-cols-7 gap-2 p-2 rounded border border-emerald-300 bg-white">
          <input aria-label="Competência" value={comp} onChange={(e) => setComp(e.target.value)} placeholder="MM/AAAA" className="px-2 py-1.5 rounded border border-slate-300" />
          <input aria-label="Vencimento" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="px-2 py-1.5 rounded border border-slate-300" />
          <input aria-label="Valor" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="px-2 py-1.5 rounded border border-slate-300" />
          <input aria-label="Pedido do Cliente (PO)" value={po} onChange={(e) => setPo(e.target.value)} placeholder="Nº Pedido (PO)" className="px-2 py-1.5 rounded border border-slate-300" />
          <input aria-label="Medição (BM)" value={bm} onChange={(e) => setBm(e.target.value)} placeholder="Nº Medição (BM)" className="px-2 py-1.5 rounded border border-slate-300" />
          <input aria-label="Período de Medição" value={bmPeriod} onChange={(e) => setBmPeriod(e.target.value)} placeholder="Período Medição" className="px-2 py-1.5 rounded border border-slate-300" />
          <input aria-label="Observações" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observações" className="px-2 py-1.5 rounded border border-slate-300" />
          <div className="col-span-2 sm:col-span-7 flex flex-wrap justify-end gap-2">
            <ReceiptDraftPreviewButton onClick={() => { const opts = customOpts(); setDraftPreview({ options: opts, finalize: async () => { await onGenerateCustom(opts); setShowCustom(false); } }); }} />
            <button type="button" onClick={() => { void onGenerateCustom(customOpts()); setShowCustom(false); }} className="px-3 py-1.5 rounded bg-emerald-700 text-white font-extrabold cursor-pointer">Emitir Fatura</button>
          </div>
        </div>
      )}

      {draftPreview && (
        <ReceiptDraftPreviewModal
          contract={contract}
          options={draftPreview.options}
          existingInvoicesCount={invoices.length}
          onClose={() => setDraftPreview(null)}
          onFinalize={draftPreview.finalize}
        />
      )}

      <div className="flex items-center gap-1.5">
        {([['EMITIDAS', `Faturas Já Emitidas (${list.length})`], ['CRONOGRAMA', 'Cronograma de Ciclos Recorrentes / Próximas Cobranças']] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setView(id)} className={`px-2.5 py-1 rounded text-[11px] font-bold cursor-pointer ${view === id ? 'bg-emerald-800 text-white' : 'bg-white border border-emerald-300 text-emerald-900'}`}>{label}</button>
        ))}
      </div>

      {view === 'EMITIDAS' ? (
        list.length === 0 ? (
          <div className="p-3 rounded bg-white border border-dashed border-emerald-300 text-emerald-900">Nenhuma fatura emitida ainda para este contrato. Clique em <strong>+ Gerar Novo Faturamento</strong>.</div>
        ) : (
          <div className="overflow-x-auto rounded border border-emerald-200 bg-white">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-emerald-900 text-white uppercase text-[10px]">
                <tr>
                  <th className="py-1.5 px-2">Nº Fatura / Documento</th>
                  <th className="py-1.5 px-2">Tipo</th>
                  <th className="py-1.5 px-2">Competência / Emissão</th>
                  <th className="py-1.5 px-2">Vencimento</th>
                  {!compact && <th className="py-1.5 px-2">PO / Medição</th>}
                  <th className="py-1.5 px-2 text-right">Bruto / Líquido</th>
                  <th className="py-1.5 px-2">Status</th>
                  <th className="py-1.5 px-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-emerald-100">
                {list.map((inv) => {
                  const tb = invoiceTypeBadge(inv);
                  return (
                    <tr key={inv.id} className={highlightInvoiceId === inv.id ? 'bg-yellow-50 ring-2 ring-yellow-300' : 'hover:bg-emerald-50/50'}>
                      <td className="py-1.5 px-2 font-mono font-black text-[#0d2b4e]">{inv.documentNumber}{highlightInvoiceId === inv.id && <span className="ml-1 px-1 rounded bg-yellow-300 text-[9px]">NOVA</span>}</td>
                      <td className="py-1.5 px-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${tb.cls}`}>{tb.label}</span></td>
                      <td className="py-1.5 px-2">{inv.competenceMonth}<div className="text-[10px] text-slate-500">{inv.issueDate}</div></td>
                      <td className="py-1.5 px-2 font-bold">{inv.dueDate}{inv.customDueRuleLabel && <div className="text-[9px] text-indigo-700">{inv.customDueRuleLabel}</div>}</td>
                      {!compact && <td className="py-1.5 px-2">{inv.customerPurchaseOrderNumber || '—'}<div className="text-[10px] text-slate-500">{inv.measurementNumber || '—'}</div></td>}
                      <td className="py-1.5 px-2 text-right">{formatBRL(inv.grossAmount)}<div className="font-black text-emerald-800">{formatBRL(inv.netAmount)}</div></td>
                      <td className="py-1.5 px-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${inv.status === 'PAGA' ? 'bg-emerald-100 text-emerald-800' : inv.status === 'VENCIDA' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}`}>{invoiceStatusLabel(inv)}</span>{contract.lastEmailSentAt && <div className="text-[9px] text-blue-700">ENVIADA POR E-MAIL</div>}</td>
                      <td className="py-1.5 px-2 text-right whitespace-nowrap space-x-1">
                        {onView && <button type="button" onClick={() => onView(inv)} className="px-1.5 py-0.5 rounded bg-slate-900 text-white font-bold cursor-pointer">Visualizar</button>}
                        <button type="button" onClick={() => downloadInvoicePdfOnDemand(inv, contract, 'DOWNLOAD')} className="px-1.5 py-0.5 rounded bg-[#ff7a59] text-white font-bold cursor-pointer">Baixar Fatura (PDF / A4)</button>
                        {onEdit && <button type="button" onClick={() => onEdit(inv)} className="px-1.5 py-0.5 rounded bg-amber-500 text-white font-bold cursor-pointer">Editar</button>}
                        {onEmail && <button type="button" onClick={() => onEmail(inv)} className="px-1.5 py-0.5 rounded bg-blue-600 text-white font-bold cursor-pointer">E-mail</button>}
                        {onGoFiscal && <button type="button" onClick={() => onGoFiscal(inv)} className="px-1.5 py-0.5 rounded border border-slate-300 font-bold cursor-pointer">Ver no Fiscal</button>}
                        {onGoReceivables && <button type="button" onClick={() => onGoReceivables(inv)} className="px-1.5 py-0.5 rounded border border-slate-300 font-bold cursor-pointer">Ver no Contas a Receber</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <div className="space-y-1.5">
          <div className="overflow-x-auto rounded border border-emerald-200 bg-white">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-emerald-100 text-emerald-900 uppercase text-[10px]">
                <tr><th className="py-1.5 px-2">Ciclo</th><th className="py-1.5 px-2">Competência</th><th className="py-1.5 px-2">Vencimento</th><th className="py-1.5 px-2">Periodicidade / Regra</th><th className="py-1.5 px-2 text-right">Valor Previsto</th><th className="py-1.5 px-2 text-right">Ação</th></tr>
              </thead>
              <tbody className="divide-y divide-emerald-100">
                {cycles.map((cy) => (
                  <tr key={cy.cycleIndex}>
                    <td className="py-1.5 px-2 font-bold">#{cy.cycleIndex}{contract.recurrenceEndMode !== 'SEM_TERMINO' && contract.totalInstallmentsCount ? ` de ${contract.totalInstallmentsCount}` : ''}</td>
                    <td className="py-1.5 px-2">{cy.competenceMonth}</td>
                    <td className="py-1.5 px-2 font-bold">{cy.dueDateBr}</td>
                    <td className="py-1.5 px-2">{cy.recurrenceLabel}{cy.ruleLabel ? ` • ${cy.ruleLabel}` : ''}</td>
                    <td className="py-1.5 px-2 text-right font-black">{formatBRL(cy.expectedAmountBrl)}</td>
                    <td className="py-1.5 px-2 text-right">{onGenerateCustom && <button type="button" onClick={() => void onGenerateCustom({ competenceMonth: cy.competenceMonth, dueDate: cy.dueDateIso })} className="px-2 py-0.5 rounded bg-emerald-700 text-white font-bold cursor-pointer">Antecipar / Emitir Agora</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {onGenerateCustom && cycles[0] && (
            <button type="button" onClick={() => void onGenerateCustom({ competenceMonth: cycles[0].competenceMonth, dueDate: cycles[0].dueDateIso })} className="px-3 py-1.5 rounded bg-emerald-900 text-white font-extrabold cursor-pointer">Rodar Régua de Recorrência do Mês</button>
          )}
        </div>
      )}
    </div>
  );
}

export function ContractVersionHistoryPanel({
  contract,
  onRestore,
}: {
  contract: ErpRentalContract;
  onRestore?: (entry: ErpContractVersionEntry) => void | Promise<void>;
}) {
  const versions: ErpContractVersionEntry[] = contract.versionHistory && contract.versionHistory.length > 0
    ? contract.versionHistory
    : [{ versionNumber: contract.version || 1, versionLabel: contract.versionLabel || 'v1.0', savedAt: contract.updatedAt, savedBy: contract.sellerName || 'Marcelo Mira', changeSummary: 'Versão atual do contrato', changedFields: ['criacao_inicial'], snapshot: contract }];
  return (
    <div data-testid="contract-version-history" className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 space-y-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-extrabold text-indigo-950">Histórico de Versões do Contrato ({versions.length}) — JSON leve, PDF sob demanda</h4>
        <span className="px-2 py-0.5 rounded bg-indigo-900 text-white text-[10px] font-black">Versão atual: {contract.versionLabel || `v${contract.version || 1}.0`}</span>
      </div>
      <div className="space-y-1.5">
        {versions.map((v) => {
          const isCurrent = v.versionNumber === (contract.version || 1);
          return (
            <div key={`${v.versionNumber}-${v.savedAt}`} className="flex flex-wrap items-start justify-between gap-2 rounded border border-indigo-200 bg-white p-2">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-900 font-black">{v.versionLabel}</span>
                  {isCurrent && <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">ATUAL</span>}
                  <span className="text-[10px] text-slate-500">{new Date(v.savedAt).toLocaleString('pt-BR')} • {v.savedBy}</span>
                </div>
                <div className="text-slate-800">{v.changeSummary}</div>
                <div className="flex flex-wrap gap-1">{v.changedFields.map((f) => <span key={f} className="px-1 rounded bg-slate-100 text-[10px] text-slate-700">{f}</span>)}</div>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => downloadContractVersionPdfOnDemand(contract, v, 'PRINT')} className="px-2 py-1 rounded bg-[#ff7a59] text-white font-bold cursor-pointer">Baixar PDF desta versão sob demanda</button>
                {onRestore && !isCurrent && <button type="button" onClick={() => void onRestore(v)} className="px-2 py-1 rounded bg-indigo-700 text-white font-bold cursor-pointer">Restaurar esta Versão</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ContractAuxOptionsManager({ onShowToast }: { onShowToast?: (m: string) => void }) {
  const [aux, setAux] = useState<ContractAuxiliaryOptions>(() => loadContractAuxiliaryOptions());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [ruleDays, setRuleDays] = useState('45');
  const [ruleWd, setRuleWd] = useState<Weekday>('WEDNESDAY');
  const persist = (next: ContractAuxiliaryOptions) => { setAux(next); saveContractAuxiliaryOptions(next); };

  const lists: Array<{ key: 'paymentMethods' | 'costCenters' | 'chartOfAccountsList' | 'emailAutomationOptions'; title: string }> = [
    { key: 'paymentMethods', title: 'Formas de Pagamento' },
    { key: 'costCenters', title: 'Centros de Custo' },
    { key: 'chartOfAccountsList', title: 'Planos de Contas' },
    { key: 'emailAutomationOptions', title: 'Regras de Envio de Fatura por E-mail' },
  ];

  return (
    <div data-testid="contract-aux-manager" className="bg-white rounded-md border border-slate-200 p-4 space-y-3 text-xs">
      <div>
        <h3 className="text-sm font-extrabold text-[#0d2b4e]">Gerenciador de Cadastros Auxiliares de Contratos &amp; Cobrança</h3>
        <p className="text-[11px] text-slate-500">Itens cadastrados aqui aparecem imediatamente nos campos do Contrato e da Fatura.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {lists.map((l) => (
          <div key={l.key} className="rounded border border-slate-200 p-3 space-y-1.5">
            <div className="font-extrabold text-slate-800">{l.title} ({aux[l.key].length})</div>
            {aux[l.key].map((item, idx) => (
              <div key={`${item}-${idx}`} className="flex items-center gap-1">
                <input aria-label={`${l.title} ${idx + 1}`} value={item} onChange={(e) => { const arr = [...aux[l.key]]; arr[idx] = e.target.value; persist({ ...aux, [l.key]: arr }); }} className="flex-1 px-2 py-1 rounded border border-slate-200" />
                <button type="button" onClick={() => persist({ ...aux, [l.key]: aux[l.key].filter((_, i) => i !== idx) })} className="px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 font-bold cursor-pointer">Excluir</button>
              </div>
            ))}
            <div className="flex items-center gap-1">
              <input value={drafts[l.key] || ''} onChange={(e) => setDrafts((d) => ({ ...d, [l.key]: e.target.value }))} placeholder={`Novo item em ${l.title}`} className="flex-1 px-2 py-1 rounded border border-slate-300" />
              <button type="button" onClick={() => { const v = (drafts[l.key] || '').trim(); if (!v) return; persist({ ...aux, [l.key]: [...aux[l.key], v] }); setDrafts((d) => ({ ...d, [l.key]: '' })); onShowToast?.(`"${v}" cadastrado em ${l.title}.`); }} className="px-2 py-1 rounded bg-emerald-600 text-white font-bold cursor-pointer">+ Cadastrar</button>
            </div>
          </div>
        ))}
        <div className="rounded border border-slate-200 p-3 space-y-1.5">
          <div className="font-extrabold text-slate-800">Periodicidades de Recorrência &amp; Antecedência de Geração da Fatura</div>
          <div className="text-[11px] text-slate-600">Periodicidades: {aux.recurrenceOptions.map((r) => r.label).join(' • ')}</div>
          <div className="flex flex-wrap gap-1">
            {aux.invoiceAdvanceDaysOptions.map((d) => (
              <span key={d} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100">{d === 0 ? 'No dia do vencimento' : `${d} dias antes do vencimento`}<button type="button" onClick={() => persist({ ...aux, invoiceAdvanceDaysOptions: aux.invoiceAdvanceDaysOptions.filter((x) => x !== d) })} className="text-rose-600 cursor-pointer">x</button></span>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <input type="number" min={0} value={drafts.advance || ''} onChange={(e) => setDrafts((d) => ({ ...d, advance: e.target.value }))} placeholder="Dias antes" className="w-28 px-2 py-1 rounded border border-slate-300" />
            <button type="button" onClick={() => { const n = Number(drafts.advance); if (!Number.isFinite(n) || n < 0 || aux.invoiceAdvanceDaysOptions.includes(n)) return; persist({ ...aux, invoiceAdvanceDaysOptions: [...aux.invoiceAdvanceDaysOptions, n].sort((a, b) => b - a) }); setDrafts((d) => ({ ...d, advance: '' })); }} className="px-2 py-1 rounded bg-emerald-600 text-white font-bold cursor-pointer">+ Cadastrar</button>
          </div>
        </div>
        <div className="rounded border border-indigo-200 p-3 space-y-1.5 md:col-span-2">
          <div className="font-extrabold text-indigo-950">Regras de Vencimento Customizadas (Dias + Dia da Semana)</div>
          {aux.customDueDateRules.map((r) => {
            const sim = computeCustomDueDateClient({ offsetDays: r.offsetDays, targetWeekday: r.targetWeekday });
            return (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-1 rounded border border-indigo-100 px-2 py-1">
                <span><strong>{r.label}</strong> <span className="text-[10px] text-slate-500">(emissão hoje {'->'} vence {sim.dueDateBr}, {sim.weekdayLabelPt})</span></span>
                <button type="button" onClick={() => persist({ ...aux, customDueDateRules: aux.customDueDateRules.filter((x) => x.id !== r.id) })} className="px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 font-bold cursor-pointer">Excluir</button>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-1">
            <input type="number" min={0} value={ruleDays} onChange={(e) => setRuleDays(e.target.value)} className="w-24 px-2 py-1 rounded border border-slate-300" aria-label="Dias da regra" />
            <select value={ruleWd} onChange={(e) => setRuleWd(e.target.value as Weekday)} className="px-2 py-1 rounded border border-slate-300 bg-white" aria-label="Dia da semana da regra">
              {WEEKDAY_OPTIONS.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
            </select>
            <button type="button" onClick={() => { const off = Math.max(0, Number(ruleDays) || 0); const label = computeCustomDueDateClient({ offsetDays: off, targetWeekday: ruleWd }).ruleLabel; if (aux.customDueDateRules.some((r) => r.label === label)) return; persist({ ...aux, customDueDateRules: [...aux.customDueDateRules, { id: `rule-${Date.now()}`, label, offsetDays: off, targetWeekday: ruleWd }] }); onShowToast?.(`Regra "${label}" cadastrada.`); }} className="px-2 py-1 rounded bg-indigo-700 text-white font-bold cursor-pointer">+ Cadastrar regra</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function InvoiceExtraFieldsPanel({ draft, setDraft }: { draft: ErpFiscalInvoice; setDraft: (d: ErpFiscalInvoice) => void }) {
  const [emailInput, setEmailInput] = useState('');
  const set = (p: Partial<ErpFiscalInvoice>) => {
    const next = { ...draft, ...p };
    const products = Number(next.productsSubtotalBrl ?? next.grossAmount ?? 0);
    const gross = Math.max(0, round2(products + Number(next.additionValueBrl || 0) + (next.includeFreightInInvoice ? Number(next.freightValueBrl || 0) : 0)));
    setDraft({ ...next, grossAmount: gross || next.grossAmount });
  };
  const rule = draft.customDueOffsetDays !== undefined ? computeCustomDueDateClient({ baseDate: draft.issueDate, offsetDays: draft.customDueOffsetDays, targetWeekday: draft.customDueTargetWeekday || 'NONE' }) : null;
  const field = (label: string, key: keyof ErpFiscalInvoice, type: 'text' | 'number' = 'text') => (
    <div>
      <label className="block font-bold text-slate-700 mb-1">{label}</label>
      <input type={type} step={type === 'number' ? '0.01' : undefined} value={(draft[key] as string | number | null | undefined) ?? ''} onChange={(e) => set({ [key]: type === 'number' ? Number(e.target.value) || 0 : e.target.value } as Partial<ErpFiscalInvoice>)} className="w-full px-3 py-2 rounded border" />
    </div>
  );
  return (
    <div data-testid="invoice-extra-fields" className="space-y-3 rounded border border-slate-200 p-3 bg-slate-50">
      <div className="font-extrabold text-[#0d2b4e]">Dados do Contrato, PO, Medição, Totais e Frete (impressos na Fatura)</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {field('Contrato n.', 'contractNumber')}
        {field('Proposta', 'proposalNumber')}
        {field('NF de Remessa', 'remessaNfeNumber')}
        {field('Prazo do Contrato', 'contractTermLabel')}
        {field('Vendedor', 'sellerName')}
        {field('Centro de custo', 'costCenter')}
        {field('Plano de contas', 'chartOfAccounts')}
        {field('Forma de pagamento', 'paymentMethodLabel')}
        {field('Nº Pedido do Cliente (PO)', 'customerPurchaseOrderNumber')}
        {field('Nº Medição (BM)', 'measurementNumber')}
        {field('Período de Medição', 'measurementPeriod')}
        {field('Obs. Medição', 'measurementNotes')}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {field('Produtos (R$)', 'productsSubtotalBrl', 'number')}
        {field('Acréscimo (R$)', 'additionValueBrl', 'number')}
        <div><label className="block font-bold text-slate-700 mb-1">Desconto (R$)</label><input type="number" step="0.01" value={draft.discountAmount} onChange={(e) => { const v = Number(e.target.value) || 0; const p = Number(draft.productsSubtotalBrl ?? draft.grossAmount ?? 0); set({ discountAmount: v, discountPercent: p > 0 ? round2((v / p) * 100) : 0 }); }} className="w-full px-3 py-2 rounded border" /></div>
        <div><label className="block font-bold text-slate-700 mb-1">Desconto (%)</label><input type="number" step="0.01" value={draft.discountPercent ?? 0} onChange={(e) => { const pct = Number(e.target.value) || 0; const p = Number(draft.productsSubtotalBrl ?? draft.grossAmount ?? 0); set({ discountPercent: pct, discountAmount: round2((p * pct) / 100) }); }} className="w-full px-3 py-2 rounded border" /></div>
        {field('Frete (R$)', 'freightValueBrl', 'number')}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <label className="block font-bold text-slate-700 mb-1">Modalidade de Frete</label>
          <select value={draft.freightModality || 'CIF_EMITENTE'} onChange={(e) => set({ freightModality: e.target.value as ErpFiscalInvoice['freightModality'] })} className="w-full px-3 py-2 rounded border bg-white">
            <option value="CIF_EMITENTE">CIF</option><option value="FOB_DESTINATARIO">FOB</option><option value="TERCEIROS">Terceiros</option><option value="PROPRIO_SETA">Próprio Seta</option><option value="SEM_FRETE">Sem frete</option>
          </select>
        </div>
        {field('Transportadora', 'deliveryCarrier')}
        {field('Rastreio / CT-e', 'freightTrackingCode')}
        {field('Cidade', 'deliveryCity')}
      </div>
      <label className="inline-flex items-center gap-2 font-bold"><input type="checkbox" checked={Boolean(draft.includeFreightInInvoice)} onChange={(e) => set({ includeFreightInInvoice: e.target.checked })} /> Incluir frete no valor da fatura</label>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div><label className="block font-bold text-slate-700 mb-1">Regra: prazo base (dias)</label><input type="number" min={0} value={draft.customDueOffsetDays ?? ''} onChange={(e) => { const off = Number(e.target.value) || 0; const c = computeCustomDueDateClient({ baseDate: draft.issueDate, offsetDays: off, targetWeekday: draft.customDueTargetWeekday || 'NONE' }); set({ customDueOffsetDays: off, customDueRuleLabel: c.ruleLabel, dueDate: c.dueDateIso }); }} className="w-full px-3 py-2 rounded border" /></div>
        <div>
          <label className="block font-bold text-slate-700 mb-1">Ajustar para dia da semana</label>
          <select value={draft.customDueTargetWeekday || 'NONE'} onChange={(e) => { const wd = e.target.value as Weekday; const c = computeCustomDueDateClient({ baseDate: draft.issueDate, offsetDays: Number(draft.customDueOffsetDays ?? 0), targetWeekday: wd }); set({ customDueTargetWeekday: wd, customDueRuleLabel: c.ruleLabel, dueDate: c.dueDateIso }); }} className="w-full px-3 py-2 rounded border bg-white">
            {WEEKDAY_OPTIONS.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
          </select>
        </div>
        <div className="flex items-end text-[11px] font-bold text-indigo-900">{rule ? `Vencimento calculado: ${rule.dueDateBr} (${rule.weekdayLabelPt}) • ${rule.ruleLabel}` : 'Sem regra customizada'}</div>
      </div>
      <div>
        <label className="block font-bold text-slate-700 mb-1">Destinatários de e-mail ({(draft.billingRecipientEmails || []).length})</label>
        <div className="flex flex-wrap gap-1 items-center">
          {(draft.billingRecipientEmails || []).map((em) => (
            <span key={em} className="px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-[11px]">{em} <button type="button" onClick={() => set({ billingRecipientEmails: (draft.billingRecipientEmails || []).filter((x) => x !== em) })} className="text-rose-600 cursor-pointer">x</button></span>
          ))}
          <input value={emailInput} onChange={(e) => setEmailInput(e.target.value)} placeholder="email1@cliente.com; email2@cliente.com" className="flex-1 min-w-[180px] px-2 py-1 rounded border" />
          <button type="button" onClick={() => { const parts = emailInput.split(/[;,\s]+/).filter((s) => /.+@.+\..+/.test(s)); if (parts.length) set({ billingRecipientEmails: Array.from(new Set([...(draft.billingRecipientEmails || []), ...parts])) }); setEmailInput(''); }} className="px-2 py-1 rounded bg-[#1e3a6e] text-white font-bold cursor-pointer">+ Adicionar</button>
        </div>
      </div>
      <div><label className="block font-bold text-slate-700 mb-1">Observações impressas na fatura</label><textarea rows={2} value={draft.contractNotes || ''} onChange={(e) => set({ contractNotes: e.target.value })} className="w-full px-3 py-2 rounded border" /></div>
    </div>
  );
}
