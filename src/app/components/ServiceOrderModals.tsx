'use client';

import React, { useState } from 'react';
import { Copy, Edit3, X } from 'lucide-react';
import type { Company, ErpServiceOrder } from '../../db/types';
import { CompanyComboboxPicker } from './CompanyComboboxPicker';
import { serviceOrderCustomerFields } from '../lib/company-search';
import {
  normalizeServiceOrderStatus,
  suggestNextMeasurementPeriod,
  todayBr,
  validateDuplicateServiceOrderInput,
} from '../../modules/erp/service-order-workflow';
import { formatBRL } from './ui-helpers';

const INPUT = 'w-full px-3 py-2 rounded border border-slate-300 bg-white text-xs';
const LABEL = 'block font-semibold text-slate-700 mb-1';

export const SERVICE_ORDER_TECHNICIANS = [
  'Michelle da Rocha',
  'Evelyn Olivia de Rosa Ternero',
  'Wesley Brito',
  'Marcelo Mira',
];

function ModalShell({
  title,
  icon,
  onClose,
  children,
  testId,
}: {
  title: string;
  icon: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto" data-testid={testId}>
      <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-2xl w-full overflow-visible my-8">
        <div className="px-6 py-4 bg-[#1e3a6e] text-white flex items-center justify-between rounded-t-lg">
          <div className="flex items-center gap-2">
            {icon}
            <h3 className="text-sm font-semibold">{title}</h3>
          </div>
          <button type="button" onClick={onClose} className="text-slate-300 hover:text-white cursor-pointer" aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Nova O.S. / Editar O.S.: cliente pelo combobox de clientes cadastrados, situacao e historico. */
export function ServiceOrderEditorModal({
  title,
  order,
  isNew,
  companies,
  statusOptions,
  onClose,
  onSave,
}: {
  title: string;
  order: ErpServiceOrder;
  isNew: boolean;
  companies: Company[];
  statusOptions: string[];
  onClose: () => void;
  onSave: (values: ErpServiceOrder) => Promise<string | null>;
}) {
  const [values, setValues] = useState<ErpServiceOrder>(() => ({
    ...order,
    status: normalizeServiceOrderStatus(order.status),
    priority: order.priority || 'NORMAL',
  }));
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const set = (patch: Partial<ErpServiceOrder>) => setValues((v) => ({ ...v, ...patch }));
  const statuses = statusOptions.includes(values.status) ? statusOptions : [...statusOptions, values.status];
  const technicians = values.technicianName && !SERVICE_ORDER_TECHNICIANS.includes(values.technicianName)
    ? [values.technicianName, ...SERVICE_ORDER_TECHNICIANS]
    : SERVICE_ORDER_TECHNICIANS;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!String(values.companyName || '').trim()) {
      setErrorMsg('Selecione o cliente da O.S. na lista de clientes cadastrados.');
      return;
    }
    setErrorMsg(null);
    setSaving(true);
    try {
      const err = await onSave({ ...values, totalAmount: Number(values.totalAmount) || 0 });
      if (err) setErrorMsg(err);
    } finally {
      setSaving(false);
    }
  };

  const history = [...(order.statusHistory || [])].reverse();

  return (
    <ModalShell title={title} icon={<Edit3 className="w-4 h-4 text-slate-200" />} onClose={onClose} testId="os-editor-modal">
      <form onSubmit={submit} className="p-6 space-y-3 text-xs max-h-[82vh] overflow-y-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>Nº da O.S.</label>
            <input className={`${INPUT} bg-slate-50`} value={values.code} readOnly data-testid="os-editor-code" />
          </div>
          <div>
            <label className={LABEL}>Situação</label>
            <select className={INPUT} value={values.status} onChange={(e) => set({ status: e.target.value })} data-testid="os-editor-status">
              {statuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL}>Cliente *</label>
            <CompanyComboboxPicker
              companies={companies}
              value={values.companyName}
              testIdPrefix="os-editor-cliente"
              invalid={Boolean(errorMsg) && !values.companyName}
              onSelect={(c) => set(serviceOrderCustomerFields(c))}
            />
            <div className="mt-1 text-[10.5px] text-slate-500" data-testid="os-editor-cliente-info">
              {values.companyId
                ? `Cliente cadastrado${values.companyCnpj ? ` • CNPJ/CPF ${values.companyCnpj}` : ''}`
                : values.companyName
                  ? 'Cliente digitado em O.S. antiga: escolha o cadastro na lista para vincular.'
                  : 'Digite nome, nome fantasia ou CNPJ e escolha o cliente cadastrado.'}
            </div>
          </div>
          <div>
            <label className={LABEL}>Técnico Responsável</label>
            <select className={INPUT} value={values.technicianName || ''} onChange={(e) => set({ technicianName: e.target.value })}>
              <option value="">Selecione</option>
              {technicians.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL}>Vendedor</label>
            <input className={INPUT} value={values.sellerName || ''} onChange={(e) => set({ sellerName: e.target.value })} />
          </div>
          <div>
            <label className={LABEL}>Equipamento / Modelo</label>
            <input className={INPUT} value={values.equipmentName || ''} onChange={(e) => set({ equipmentName: e.target.value })} />
          </div>
          <div>
            <label className={LABEL}>Nº de Série / S/N</label>
            <input className={INPUT} value={values.serialNumber || ''} onChange={(e) => set({ serialNumber: e.target.value })} />
          </div>
          <div>
            <label className={LABEL}>Prioridade / SLA</label>
            <select
              className={INPUT}
              value={values.priority || 'NORMAL'}
              onChange={(e) => set({ priority: e.target.value as ErpServiceOrder['priority'] })}
            >
              {['NORMAL', 'ALTA', 'CRITICA', 'BAIXA'].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL}>Valor (R$)</label>
            <input
              type="number"
              step="0.01"
              className={INPUT}
              value={String(values.totalAmount ?? 0)}
              onChange={(e) => set({ totalAmount: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className={LABEL}>Data de emissão / entrada</label>
            <input className={INPUT} placeholder="DD/MM/AAAA" value={values.entryDate || ''} onChange={(e) => set({ entryDate: e.target.value })} />
          </div>
          <div>
            <label className={LABEL}>Data de saída / conclusão</label>
            <input className={INPUT} placeholder="DD/MM/AAAA" value={values.exitDate === '—' ? '' : values.exitDate || ''} onChange={(e) => set({ exitDate: e.target.value })} />
          </div>
          <div>
            <label className={LABEL}>Período da medição: início</label>
            <input className={INPUT} placeholder="DD/MM/AAAA" value={values.measurementPeriodStart || ''} onChange={(e) => set({ measurementPeriodStart: e.target.value })} />
          </div>
          <div>
            <label className={LABEL}>Período da medição: fim</label>
            <input className={INPUT} placeholder="DD/MM/AAAA" value={values.measurementPeriodEnd || ''} onChange={(e) => set({ measurementPeriodEnd: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL}>Defeito relatado / Descrição / Observações</label>
            <textarea rows={2} className={INPUT} value={values.description || ''} onChange={(e) => set({ description: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL}>Laudo técnico / Diagnóstico</label>
            <textarea rows={2} className={INPUT} value={values.technicalReport || ''} onChange={(e) => set({ technicalReport: e.target.value })} />
          </div>
        </div>

        {!isNew && (
          <div className="pt-2 border-t border-slate-100" data-testid="os-status-history">
            <div className="font-semibold text-slate-700 mb-1">Histórico de situação</div>
            {history.length === 0 ? (
              <div className="text-[11px] text-slate-500">Nenhuma troca de situação registrada.</div>
            ) : (
              <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                {history.map((h) => (
                  <li key={h.id} className="text-[11px] text-slate-700">
                    <span className="font-semibold text-[#1e3a6e]">{h.from ? `${h.from} → ${h.to}` : h.to}</span>
                    {' • '}
                    {new Date(h.at).toLocaleString('pt-BR')}
                    {' • por '}
                    {h.by}
                    {h.note ? ` • ${h.note}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {errorMsg && <div className="p-2 rounded bg-rose-50 border border-rose-200 text-rose-700 font-semibold">{errorMsg}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded border border-slate-300 bg-white text-slate-700 font-semibold cursor-pointer">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            data-testid="os-editor-save"
            className="px-4 py-2 rounded bg-[#1e3a6e] hover:bg-accent-hover text-white font-semibold cursor-pointer disabled:opacity-60"
          >
            {saving ? 'Salvando...' : 'Salvar O.S.'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/** Duplicar O.S.: copia tudo e pede so a data de emissao e o periodo da medicao. */
export function ServiceOrderDuplicateModal({
  source,
  onClose,
  onConfirm,
}: {
  source: ErpServiceOrder;
  onClose: () => void;
  onConfirm: (input: { entryDate: string; measurementPeriodStart: string; measurementPeriodEnd: string }) => Promise<string | null>;
}) {
  const suggested = suggestNextMeasurementPeriod(source);
  const [entryDate, setEntryDate] = useState(todayBr());
  const [start, setStart] = useState(suggested.start);
  const [end, setEnd] = useState(suggested.end);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = { entryDate: entryDate.trim(), measurementPeriodStart: start.trim(), measurementPeriodEnd: end.trim() };
    const invalid = validateDuplicateServiceOrderInput(input);
    if (invalid) {
      setErrorMsg(invalid);
      return;
    }
    setErrorMsg(null);
    setSaving(true);
    try {
      const err = await onConfirm(input);
      if (err) setErrorMsg(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={`Duplicar O.S. #${source.code}`} icon={<Copy className="w-4 h-4 text-slate-200" />} onClose={onClose} testId="os-duplicate-modal">
      <form onSubmit={submit} className="p-6 space-y-3 text-xs">
        <div className="p-3 rounded bg-slate-50 border border-slate-200 space-y-0.5">
          <div className="font-semibold text-slate-900">{source.companyName}</div>
          <div className="text-slate-600">{source.equipmentName || source.description || '—'}</div>
          <div className="text-slate-600">
            Valor {formatBRL(Number(source.totalAmount) || 0)}
            {source.measurementPeriodStart ? ` • Medição anterior ${source.measurementPeriodStart} a ${source.measurementPeriodEnd || '—'}` : ''}
          </div>
          <div className="text-[10.5px] text-slate-500 pt-1">
            A nova O.S. copia cliente, itens, serviços, valores e observações; recebe número novo, situação Em aberto e não leva o histórico.
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={LABEL}>Data de emissão *</label>
            <input className={INPUT} placeholder="DD/MM/AAAA" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} data-testid="os-dup-entry-date" />
          </div>
          <div>
            <label className={LABEL}>Medição: início</label>
            <input className={INPUT} placeholder="DD/MM/AAAA" value={start} onChange={(e) => setStart(e.target.value)} data-testid="os-dup-period-start" />
          </div>
          <div>
            <label className={LABEL}>Medição: fim</label>
            <input className={INPUT} placeholder="DD/MM/AAAA" value={end} onChange={(e) => setEnd(e.target.value)} data-testid="os-dup-period-end" />
          </div>
        </div>
        {errorMsg && <div className="p-2 rounded bg-rose-50 border border-rose-200 text-rose-700 font-semibold">{errorMsg}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded border border-slate-300 bg-white text-slate-700 font-semibold cursor-pointer">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            data-testid="os-dup-confirm"
            className="px-4 py-2 rounded bg-[#1e3a6e] hover:bg-accent-hover text-white font-semibold cursor-pointer disabled:opacity-60"
          >
            {saving ? 'Duplicando...' : 'Duplicar O.S.'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
