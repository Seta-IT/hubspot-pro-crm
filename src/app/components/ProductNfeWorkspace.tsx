'use client';

// ============================================================================
// ERP > Fiscal > Notas de produtos — lista "NF-e" no padrão do emissor GestaoClick
//  - "+ Adicionar", "Mais ações", filtro por mês e busca; estado vazio "Nenhuma NF-e em <mês>".
//  - Ações que dependem da SEFAZ/certificado (emitir, carta de correção, inutilizar) ficam
//    desabilitadas até a integração. Excluir só vale para rascunho.
// ============================================================================
import React, { useMemo, useState } from 'react';
import {
  ShoppingCart,
  Plus,
  ChevronDown,
  Send,
  Printer,
  FileUp,
  FileDown,
  FileText,
  Ban,
  FileSpreadsheet,
  KeyRound,
  X,
  List,
  Search,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Home,
} from 'lucide-react';
import type { Company, ErpCatalogItem, ErpFiscalInvoice, ErpSupplierRecord } from '../../db/types';
import { formatBRL } from './ui-helpers';
import ProductNfeForm from './ProductNfeForm';
import { PRODUCT_NFE_SEFAZ_PENDING_HINT } from '../../modules/erp/product-nfe-engine';

const NAVY = '#1e3a6e';
const PRODUCT_NFE_TYPES = new Set(['NFE_VENDA_PRODUTO', 'NFE_REMESSA_LOCACAO', 'NFE_RETORNO_LOCACAO']);

export const monthKeyOf = (iso: string) => String(iso || '').slice(0, 7);
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  const name = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('pt-BR', { month: 'long', timeZone: 'UTC' });
  return `${name} de ${y}`;
}
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function currentMonthKey(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  return `${y}-${m}`;
}

function statusBadge(inv: ErpFiscalInvoice): { label: string; cls: string } {
  if (inv.status === 'RASCUNHO') return { label: 'Rascunho', cls: 'bg-amber-50 text-amber-800 border-amber-200' };
  if (inv.status === 'CANCELADA') return { label: 'Cancelada', cls: 'bg-rose-50 text-rose-700 border-rose-200' };
  if (inv.status === 'ENTRADA_REGISTRADA') return { label: 'Entrada', cls: 'bg-slate-50 text-slate-700 border-slate-200' };
  return { label: 'Emitida', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
}

function nfeNumberLabel(inv: ErpFiscalInvoice): string {
  if (inv.productNfe) return `${inv.productNfe.nNF} - série ${inv.productNfe.serie}`;
  if (inv.importMetadata) return `${inv.importMetadata.nNF} - série ${inv.importMetadata.serie}`;
  return inv.documentNumber;
}

function downloadText(fileName: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface ProductNfeWorkspaceProps {
  invoices: ErpFiscalInvoice[];
  companies: Company[];
  suppliers: ErpSupplierRecord[];
  catalog: ErpCatalogItem[];
  onRefresh: () => Promise<void>;
  onShowToast: (msg: string) => void;
  /** Abre Configurações > Certificado digital (CFG_CERTIFICADO). */
  onOpenCertificate: () => void;
  /** Pré-visualização/impressão do DANFE já existente no ERP. */
  onPrintInvoice: (inv: ErpFiscalInvoice) => void;
}

export default function ProductNfeWorkspace({
  invoices,
  companies,
  suppliers,
  catalog,
  onRefresh,
  onShowToast,
  onOpenCertificate,
  onPrintInvoice,
}: ProductNfeWorkspaceProps) {
  const [mode, setMode] = useState<'LIST' | 'ADD'>('LIST');
  const [month, setMonth] = useState<string>(currentMonthKey());
  const [monthMenu, setMonthMenu] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [xmlPreview, setXmlPreview] = useState<ErpFiscalInvoice | null>(null);

  const nfes = useMemo(
    () => invoices.filter((i) => PRODUCT_NFE_TYPES.has(i.documentType)).sort((a, b) => String(b.issueDate).localeCompare(String(a.issueDate))),
    [invoices]
  );
  const latestMonth = nfes.length ? monthKeyOf(nfes[0].issueDate) : null;
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return nfes.filter((i) => {
      if (monthKeyOf(i.issueDate) !== month) return false;
      if (!q) return true;
      return [i.companyName, i.companyCnpj, i.documentNumber, nfeNumberLabel(i), i.verificationCodeOrKey]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [nfes, month, search]);
  const selectedRows = rows.filter((r) => selected.has(r.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exportXmls = () => {
    const list = (selectedRows.length ? selectedRows : rows).filter((r) => r.productNfe?.xmlContent || r.importMetadata?.sefazXmlContent);
    if (!list.length) return onShowToast('Nenhuma NF-e com XML neste mês.');
    for (const r of list) {
      const xml = r.productNfe?.xmlContent || r.importMetadata?.sefazXmlContent || '';
      const key = r.productNfe?.accessKey || r.verificationCodeOrKey;
      downloadText(`${key}-rascunho-nfe.xml`, xml, 'application/xml');
    }
    onShowToast(`${list.length} XML(s) exportado(s) (rascunho, sem assinatura).`);
  };

  const exportExcel = () => {
    const list = selectedRows.length ? selectedRows : rows;
    if (!list.length) return onShowToast('Nenhuma NF-e para exportar neste mês.');
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Número', 'Série', 'Emissão', 'Destinatário', 'CPF/CNPJ', 'Valor total', 'Situação', 'Ambiente', 'Chave de acesso'];
    const lines = list.map((r) =>
      [
        r.productNfe?.nNF ?? r.importMetadata?.nNF ?? r.documentNumber,
        r.productNfe?.serie ?? r.importMetadata?.serie ?? '',
        r.issueDate,
        r.companyName,
        r.companyCnpj,
        (r.productNfe?.totals.vNF ?? r.netAmount).toFixed(2).replace('.', ','),
        statusBadge(r).label,
        r.productNfe?.environment ?? r.importMetadata?.environment ?? '',
        r.productNfe?.accessKey ?? r.verificationCodeOrKey,
      ]
        .map(esc)
        .join(';')
    );
    downloadText(`nfe-${month}.csv`, '\ufeff' + [header.map(esc).join(';'), ...lines].join('\r\n'), 'text/csv;charset=utf-8');
  };

  const printDanfes = () => {
    if (selectedRows.length !== 1) return onShowToast('Selecione uma NF-e para imprimir o DANFE.');
    onPrintInvoice(selectedRows[0]);
  };

  const deleteSelected = async () => {
    if (!selectedRows.length) return onShowToast('Selecione as NF-e em rascunho que deseja excluir.');
    const drafts = selectedRows.filter((r) => r.status === 'RASCUNHO' && r.productNfe);
    const skipped = selectedRows.length - drafts.length;
    if (!drafts.length) return onShowToast('Só é possível excluir NF-e em rascunho.');
    if (!window.confirm(`Excluir ${drafts.length} rascunho(s) de NF-e? O número reservado não é reaproveitado.`)) return;
    setBusy(true);
    let ok = 0;
    let lastError = '';
    for (const r of drafts) {
      const res = await fetch(`/api/erp/nfe-produtos/${encodeURIComponent(r.id)}`, { method: 'DELETE' });
      if (res.ok) ok++;
      else lastError = ((await res.json().catch(() => null)) as { error?: string } | null)?.error || `Falha (${res.status})`;
    }
    setBusy(false);
    setSelected(new Set());
    await onRefresh();
    onShowToast(
      `${ok} rascunho(s) excluído(s).${skipped ? ` ${skipped} nota(s) não-rascunho mantida(s).` : ''}${lastError ? ` Erro: ${lastError}` : ''}`
    );
  };

  type Action = { label: string; icon: React.ReactNode; onClick?: () => void; disabledHint?: string };
  const actions: Action[] = [
    { label: 'Emitir selecionadas', icon: <Send className="w-3.5 h-3.5" />, disabledHint: PRODUCT_NFE_SEFAZ_PENDING_HINT },
    { label: 'Imprimir DANFEs', icon: <Printer className="w-3.5 h-3.5" />, onClick: printDanfes },
    { label: 'Importar XMLs', icon: <FileUp className="w-3.5 h-3.5" />, disabledHint: 'Em desenvolvimento: importação de XML autorizado' },
    { label: 'Exportar XMLs', icon: <FileDown className="w-3.5 h-3.5" />, onClick: exportXmls },
    { label: 'Cartas de correção', icon: <FileText className="w-3.5 h-3.5" />, disabledHint: PRODUCT_NFE_SEFAZ_PENDING_HINT },
    { label: 'Inutilizar numeração', icon: <Ban className="w-3.5 h-3.5" />, disabledHint: PRODUCT_NFE_SEFAZ_PENDING_HINT },
    { label: 'Exportar Excel', icon: <FileSpreadsheet className="w-3.5 h-3.5" />, onClick: exportExcel },
    { label: 'Certificado digital', icon: <KeyRound className="w-3.5 h-3.5" />, onClick: onOpenCertificate },
    { label: 'Excluir notas fiscais', icon: <X className="w-3.5 h-3.5" />, onClick: () => void deleteSelected() },
  ];

  if (mode === 'ADD') {
    return (
      <ProductNfeForm
        companies={companies}
        suppliers={suppliers}
        catalog={catalog}
        onCancel={() => setMode('LIST')}
        onShowToast={onShowToast}
        onCreated={async (inv) => {
          await onRefresh();
          setMonth(monthKeyOf(inv.issueDate));
          setMode('LIST');
        }}
      />
    );
  }

  const monthOptions = Array.from({ length: 13 }, (_, i) => shiftMonth(currentMonthKey(), -i));
  const emptyTarget = latestMonth && latestMonth !== month ? latestMonth : shiftMonth(month, -1);

  return (
    <div className="space-y-3" data-testid="product-nfe-list">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <ShoppingCart className="w-5 h-5" /> NF-e
        </h2>
        <p className="text-[11px] text-slate-500 flex items-center gap-1">
          <Home className="w-3 h-3" /> Início <span>›</span> NF-e <span>›</span> <strong className="text-slate-700">Listar</strong>
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 relative">
          <button
            type="button"
            onClick={() => setMode('ADD')}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-white text-xs font-bold"
            style={{ backgroundColor: NAVY }}
          >
            <Plus className="w-3.5 h-3.5" /> Adicionar
          </button>
          <div className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={actionsOpen}
              onClick={() => setActionsOpen((v) => !v)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-white text-xs font-bold"
              style={{ backgroundColor: NAVY }}
            >
              <Plus className="w-3.5 h-3.5" /> Mais ações <ChevronDown className="w-3 h-3" />
            </button>
            {actionsOpen && (
              <div role="menu" className="absolute z-30 mt-1 w-60 bg-white border border-slate-200 rounded shadow-lg py-1 text-xs">
                {actions.map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    role="menuitem"
                    disabled={Boolean(a.disabledHint) || busy}
                    aria-disabled={Boolean(a.disabledHint) || busy}
                    title={a.disabledHint || a.label}
                    onClick={() => {
                      setActionsOpen(false);
                      a.onClick?.();
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left ${
                      a.disabledHint ? 'text-slate-400 cursor-not-allowed' : 'text-slate-700 hover:bg-slate-50 cursor-pointer'
                    }`}
                  >
                    {a.icon}
                    <span className="flex-1">{a.label}</span>
                    {a.disabledHint && <span className="text-[9px] text-slate-400 italic">{a.disabledHint === PRODUCT_NFE_SEFAZ_PENDING_HINT ? 'após SEFAZ' : 'em breve'}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 relative">
          <button type="button" title="Lista" className="p-1.5 rounded border border-slate-300 bg-white text-slate-600">
            <List className="w-4 h-4" />
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMonthMenu((v) => !v)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-white text-xs font-bold"
              style={{ backgroundColor: NAVY }}
              aria-label="Filtrar por mês"
            >
              {capitalize(monthLabel(month))} <ChevronDown className="w-3 h-3" />
            </button>
            {monthMenu && (
              <div className="absolute right-0 z-30 mt-1 w-52 bg-white border border-slate-200 rounded shadow-lg py-1 text-xs">
                <div className="flex items-center justify-between px-2 pb-1 border-b border-slate-100">
                  <button type="button" aria-label="Mês anterior" onClick={() => setMonth(shiftMonth(month, -1))} className="p-1 hover:bg-slate-50 rounded"><ChevronLeft className="w-3.5 h-3.5" /></button>
                  <span className="font-bold text-slate-700">{capitalize(monthLabel(month))}</span>
                  <button type="button" aria-label="Próximo mês" onClick={() => setMonth(shiftMonth(month, 1))} className="p-1 hover:bg-slate-50 rounded"><ChevronRight className="w-3.5 h-3.5" /></button>
                </div>
                {monthOptions.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setMonth(k);
                      setMonthMenu(false);
                      setSelected(new Set());
                    }}
                    className={`w-full text-left px-3 py-1 hover:bg-slate-50 ${k === month ? 'font-bold text-[#1e3a6e]' : 'text-slate-700'}`}
                  >
                    {capitalize(monthLabel(k))}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label="Buscar"
            onClick={() => setSearchOpen((v) => !v)}
            className="p-1.5 rounded text-white"
            style={{ backgroundColor: NAVY }}
          >
            <Search className="w-4 h-4" />
          </button>
        </div>
      </div>

      {searchOpen && (
        <input
          autoFocus
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por destinatário, CPF/CNPJ, número ou chave"
          className="w-full px-3 py-2 rounded border border-slate-300 text-xs"
        />
      )}

      <div className="bg-white border border-slate-200 rounded">
        {rows.length === 0 ? (
          <div className="py-12 flex flex-col items-center text-center gap-2" data-testid="product-nfe-empty">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
              <CalendarDays className="w-6 h-6 text-slate-500" />
            </div>
            <p className="text-sm font-bold text-slate-800">
              Nenhuma NF-e em <span style={{ color: NAVY }}>{monthLabel(month)}</span>
            </p>
            {latestMonth && latestMonth !== month && <p className="text-[11px] text-slate-500">A mais recente é de {monthLabel(latestMonth)}.</p>}
            <div className="flex items-center gap-2 mt-1">
              <button
                type="button"
                onClick={() => setMonth(emptyTarget)}
                className="px-3 py-1.5 rounded text-white text-xs font-bold"
                style={{ backgroundColor: NAVY }}
              >
                Ver {monthLabel(emptyTarget)}
              </button>
              <button
                type="button"
                onClick={() => setMode('ADD')}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded border text-xs font-bold bg-white"
                style={{ borderColor: NAVY, color: NAVY }}
              >
                <Plus className="w-3.5 h-3.5" /> Adicionar NF-e
              </button>
            </div>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="p-2 w-8">
                  <input
                    type="checkbox"
                    aria-label="Selecionar todas"
                    checked={rows.length > 0 && rows.every((r) => selected.has(r.id))}
                    onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                  />
                </th>
                <th className="p-2 text-left">Número</th>
                <th className="p-2 text-left">Emissão</th>
                <th className="p-2 text-left">Destinatário</th>
                <th className="p-2 text-right">Valor total</th>
                <th className="p-2 text-left">Situação</th>
                <th className="p-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const b = statusBadge(r);
                return (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="p-2 text-center">
                      <input type="checkbox" aria-label={`Selecionar ${nfeNumberLabel(r)}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                    </td>
                    <td className="p-2 font-mono font-bold text-slate-800">{nfeNumberLabel(r)}</td>
                    <td className="p-2">{r.issueDate ? new Date(`${r.issueDate}T12:00:00`).toLocaleDateString('pt-BR') : '—'}</td>
                    <td className="p-2">
                      <p className="font-semibold text-slate-800">{r.companyName}</p>
                      <p className="text-[10px] text-slate-500">{r.companyCnpj}</p>
                    </td>
                    <td className="p-2 text-right font-bold">{formatBRL(r.productNfe?.totals.vNF ?? r.netAmount)}</td>
                    <td className="p-2">
                      <span className={`inline-block px-2 py-0.5 rounded border text-[10px] font-bold ${b.cls}`}>{b.label}</span>
                      {r.productNfe && (
                        <span className={`ml-1 inline-block px-2 py-0.5 rounded border text-[10px] font-bold ${r.productNfe.environment === 'PRODUCAO' ? 'border-emerald-200 text-emerald-700' : 'border-amber-200 text-amber-700'}`}>
                          {r.productNfe.environment === 'PRODUCAO' ? 'Produção' : 'Homologação'}
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-right whitespace-nowrap">
                      {(r.productNfe?.xmlContent || r.importMetadata?.sefazXmlContent) && (
                        <button type="button" onClick={() => setXmlPreview(r)} className="px-2 py-1 rounded border border-slate-300 text-[10px] font-bold mr-1">
                          XML
                        </button>
                      )}
                      <button type="button" onClick={() => onPrintInvoice(r)} className="px-2 py-1 rounded border border-slate-300 text-[10px] font-bold">
                        DANFE
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {xmlPreview && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <p className="text-sm font-bold">XML de rascunho — {nfeNumberLabel(xmlPreview)}</p>
              <button type="button" aria-label="Fechar" onClick={() => setXmlPreview(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <pre className="flex-1 overflow-auto text-[10px] p-3 bg-slate-50 whitespace-pre">{xmlPreview.productNfe?.xmlContent || xmlPreview.importMetadata?.sefazXmlContent}</pre>
            <div className="px-4 py-2 border-t flex justify-end">
              <button
                type="button"
                onClick={() =>
                  downloadText(
                    `${xmlPreview.productNfe?.accessKey || xmlPreview.verificationCodeOrKey}-rascunho-nfe.xml`,
                    xmlPreview.productNfe?.xmlContent || xmlPreview.importMetadata?.sefazXmlContent || '',
                    'application/xml'
                  )
                }
                className="px-3 py-1.5 rounded text-white text-xs font-bold"
                style={{ backgroundColor: NAVY }}
              >
                Baixar XML
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
