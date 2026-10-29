'use client';

import React, { useMemo, useRef, useState } from 'react';
import { Menu, Package, Pencil, Plus, Trash2, Wrench } from 'lucide-react';
import type { ErpCatalogItem, ErpCommercialProposal, ErpProposalItem } from '../../db/types';
import { formatBRL } from './ui-helpers';
import { inferProposalItemType, PROPOSAL_SERVICE_PILL_OPTIONS } from '../lib/proposal-share';
import type { ProposalGridItem } from '../lib/proposal-share';

/**
 * Grade de itens no padrao GestaoClick ("Adicione os produtos do orcamento"):
 * Produto* | Detalhes | Quant.* | Tipo* | Valor* | Desconto | Subtotal | Acoes.
 * Sempre ha uma linha vazia pronta; digitar no Produto abre o autocomplete do
 * catalogo e "+ Adicionar novo" inclui um item livre com o texto digitado.
 */

type GridKind = 'PRODUCT' | 'SERVICE';

export interface ProposalItemsGridProps {
  kind: GridKind;
  items: ErpProposalItem[];
  catalog: ErpCatalogItem[];
  budgetType?: ErpCommercialProposal['budgetType'];
  serviceType?: string;
  subtotal: number;
  onItemsChange: (items: ErpProposalItem[]) => void;
}

const inputBase =
  'w-full h-8 px-2 rounded-[3px] border border-[#ced4da] bg-[#e9ecef] text-[12px] text-slate-800 focus:outline-none focus:border-[#1b2559] focus:bg-white';

const SERVICE_NATURES = new Set(['SERVICO_TECNICO_TI_TELECOM', 'SERVICO_COMUNICACAO_SCM_SVA']);

export function isServiceCatalogItem(c: ErpCatalogItem): boolean {
  return (
    SERVICE_NATURES.has(String(c.fiscalNature)) ||
    c.category === 'SERVICO_TECNICO_LC116' ||
    c.category === 'TELECOM_SCM_SVA'
  );
}

function defaultServiceKind(serviceType?: string): string {
  const raw = String(serviceType || '').trim();
  const exact = PROPOSAL_SERVICE_PILL_OPTIONS.find((o) => o === raw);
  return exact || PROPOSAL_SERVICE_PILL_OPTIONS[0];
}

function productIsRental(item: ErpProposalItem): boolean {
  return item.fiscalNature !== 'VENDA_EQUIPAMENTO';
}

function catalogPriceFor(found: ErpCatalogItem, kind: GridKind, rental: boolean): number {
  if (kind === 'SERVICE') return found.monthlyRentalPrice || found.saleOrSetupPrice || 0;
  return rental
    ? found.monthlyRentalPrice || found.saleOrSetupPrice || 0
    : found.saleOrSetupPrice || found.monthlyRentalPrice || 0;
}

function skuPrefix(item: ErpProposalItem): string {
  const sku = String(item.sku || '').trim();
  if (!sku || String(item.description || '').trim().startsWith(sku)) return '';
  return `${sku} - `;
}

function formatDiscount(item: ErpProposalItem): string {
  if (Number(item.discountPercent || 0) > 0) return `${String(item.discountPercent).replace('.', ',')}%`;
  if (Number(item.discountAmount || 0) > 0) return Number(item.discountAmount).toFixed(2).replace('.', ',');
  return '';
}

function parseNumberBR(raw: string): number {
  const cleaned = raw.replace(/[^\d,.-]/g, '');
  if (!cleaned) return 0;
  const normalized = cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned;
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function DiscountInput({ item, onCommit }: { item: ErpProposalItem; onCommit: (pct: number, amt: number) => void }) {
  const [text, setText] = useState<string>(() => formatDiscount(item));
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : formatDiscount(item);
  return (
    <div className="flex items-stretch">
      <span className="inline-flex items-center px-1.5 rounded-l-[3px] border border-r-0 border-[#ced4da] bg-[#dee2e6] text-[11px] text-slate-600">
        R$
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={shown}
        placeholder="0,00 ou %"
        title="Valor em R$ ou percentual (ex.: 5%)"
        onFocus={() => {
          setText(formatDiscount(item));
          setFocused(true);
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setFocused(false);
          const raw = text.trim();
          if (raw.endsWith('%')) onCommit(Math.min(100, parseNumberBR(raw)), 0);
          else onCommit(0, parseNumberBR(raw));
        }}
        className={`${inputBase} rounded-l-none text-right`}
      />
    </div>
  );
}

export function ProposalItemsGrid({
  kind,
  items,
  catalog,
  budgetType,
  serviceType,
  subtotal,
  onItemsChange,
}: ProposalItemsGridProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isProduct = kind === 'PRODUCT';
  const defaultRental = budgetType !== 'PRODUTOS';
  const noun = isProduct ? 'produtos' : 'serviços';

  const rows = items
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => inferProposalItemType(item) === kind);

  const pool = useMemo(
    () => catalog.filter((c) => c.isActive !== false && (isProduct ? !isServiceCatalogItem(c) : isServiceCatalogItem(c))),
    [catalog, isProduct]
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? pool.filter(
          (c) => c.gestaoClickCode.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
        )
      : pool;
    return list.slice(0, 8);
  }, [pool, query]);

  const patchRow = (idx: number, patch: Partial<ProposalGridItem>) => {
    const copy = [...items];
    copy[idx] = { ...copy[idx], ...patch } as ErpProposalItem;
    onItemsChange(copy);
  };

  const buildItem = (found: ErpCatalogItem | null, freeText: string): ErpProposalItem => {
    const id = `item-${isProduct ? 'prd' : 'srv'}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    if (isProduct) {
      const rental = defaultRental;
      const price = found ? catalogPriceFor(found, 'PRODUCT', rental) : 0;
      return {
        id,
        sku: found?.gestaoClickCode || '',
        description: found?.name || freeText,
        itemType: 'PRODUCT',
        unit: 'UN',
        fiscalNature: rental ? 'LOCACAO_BENS_MOVEIS' : 'VENDA_EQUIPAMENTO',
        ncmOrServiceCode: found?.ncmOrLc116 || 'NCM 8517.62.59',
        quantity: 1,
        unitPrice: price,
        discountPercent: 0,
        discountAmount: 0,
        subtotal: price,
        isRecurring: rental,
        totalMonthly: price,
      };
    }
    const price = found ? catalogPriceFor(found, 'SERVICE', true) : 0;
    const item: ProposalGridItem = {
      id,
      sku: found?.gestaoClickCode || '',
      description: found?.name || freeText,
      itemType: 'SERVICE',
      unit: 'SV',
      fiscalNature:
        found?.fiscalNature === 'SERVICO_COMUNICACAO_SCM_SVA' ? 'SERVICO_COMUNICACAO_SCM_SVA' : 'SERVICO_TECNICO_TI_TELECOM',
      ncmOrServiceCode: found?.ncmOrLc116 || 'LC 116/03 Item 01.07',
      serviceKind: defaultServiceKind(serviceType),
      quantity: 1,
      unitPrice: price,
      discountPercent: 0,
      discountAmount: 0,
      subtotal: price,
      isRecurring: budgetType !== 'PRODUTOS',
      totalMonthly: price,
    };
    return item;
  };

  const appendItem = (found: ErpCatalogItem | null) => {
    const text = query.trim();
    if (!found && !text) return;
    onItemsChange([...items, buildItem(found, text)]);
    setQuery('');
    setOpen(false);
    setHighlight(0);
    // Nova linha vazia ja fica pronta com o foco para o proximo item.
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const removeRow = (idx: number) => onItemsChange(items.filter((_, i) => i !== idx));

  const th = 'py-1.5 px-1.5 text-left text-[12px] font-semibold text-slate-700 whitespace-nowrap';
  const td = 'py-1 px-1.5 align-top';

  return (
    <div className="bg-white rounded-md border border-slate-200 shadow-2xs" data-testid={`proposal-grid-${noun}`}>
      <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {isProduct ? (
            <Package className="w-5 h-5 text-slate-600" />
          ) : (
            <Wrench className="w-5 h-5 text-slate-600" />
          )}
          <div>
            <div className="text-[15px] font-normal text-slate-700">
              Adicione os <span className="font-semibold text-slate-900">{noun}</span> do orçamento
            </div>
            <div className="text-[11px] text-slate-500">
              {isProduct ? 'Produto' : 'Serviço'}, quantidade, valor e desconto por linha.
            </div>
          </div>
        </div>
        <button
          type="button"
          title={`${rows.length} ${noun} no orçamento`}
          className="p-1.5 rounded text-slate-500 hover:bg-slate-100 cursor-pointer"
        >
          <Menu className="w-4 h-4" />
        </button>
      </div>

      <div className="px-3 py-2">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={`${th} min-w-[220px]`}>{isProduct ? 'Produto' : 'Serviço'}<span className="text-rose-600">*</span></th>
              <th className={`${th} min-w-[130px]`}>Detalhes</th>
              <th className={`${th} w-[70px]`}>Quant.<span className="text-rose-600">*</span></th>
              <th className={`${th} w-[120px]`}>Tipo<span className="text-rose-600">*</span></th>
              <th className={`${th} w-[100px]`}>Valor<span className="text-rose-600">*</span></th>
              <th className={`${th} w-[110px]`}>Desconto</th>
              <th className={`${th} w-[100px]`}>Subtotal</th>
              <th className={`${th} w-[64px] text-center`}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, idx }) => {
              const gridItem = item as ProposalGridItem;
              const isEditing = editingId === item.id;
              return (
                <React.Fragment key={item.id || idx}>
                  <tr className="border-b border-slate-100">
                    <td className={td}>
                      <input
                        type="text"
                        value={`${skuPrefix(item)}${item.description}`}
                        onChange={(e) => {
                          const v = e.target.value;
                          const prefix = skuPrefix(item);
                          patchRow(idx, { description: prefix && v.startsWith(prefix) ? v.slice(prefix.length) : v });
                        }}
                        title={item.description}
                        className={inputBase}
                      />
                    </td>
                    <td className={td}>
                      <input
                        type="text"
                        value={item.ncmOrServiceCode || ''}
                        onChange={(e) => patchRow(idx, { ncmOrServiceCode: e.target.value })}
                        placeholder="Detalhes"
                        className={inputBase}
                      />
                    </td>
                    <td className={td}>
                      <input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => patchRow(idx, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                        className={`${inputBase} text-center`}
                      />
                    </td>
                    <td className={td}>
                      {isProduct ? (
                        <select
                          value={productIsRental(item) ? 'LOCACAO' : 'VENDA'}
                          onChange={(e) => {
                            const rental = e.target.value === 'LOCACAO';
                            const found = catalog.find((c) => c.gestaoClickCode === item.sku);
                            patchRow(idx, {
                              fiscalNature: rental ? 'LOCACAO_BENS_MOVEIS' : 'VENDA_EQUIPAMENTO',
                              isRecurring: rental,
                              ...(found ? { unitPrice: catalogPriceFor(found, 'PRODUCT', rental) } : {}),
                            });
                          }}
                          className={inputBase}
                        >
                          <option value="LOCACAO">Locação</option>
                          <option value="VENDA">Venda</option>
                        </select>
                      ) : (
                        <select
                          value={gridItem.serviceKind || defaultServiceKind(serviceType)}
                          onChange={(e) => patchRow(idx, { serviceKind: e.target.value })}
                          className={inputBase}
                        >
                          {PROPOSAL_SERVICE_PILL_OPTIONS.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className={td}>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={item.unitPrice}
                        onChange={(e) => patchRow(idx, { unitPrice: Math.max(0, Number(e.target.value) || 0) })}
                        className={`${inputBase} text-right`}
                      />
                    </td>
                    <td className={td}>
                      <DiscountInput
                        key={`${item.id}-${item.discountPercent}-${item.discountAmount}`}
                        item={item}
                        onCommit={(pct, amt) => patchRow(idx, { discountPercent: pct, discountAmount: amt })}
                      />
                    </td>
                    <td className={td}>
                      <input
                        type="text"
                        readOnly
                        tabIndex={-1}
                        value={formatBRL(item.subtotal ?? item.totalMonthly)}
                        className={`${inputBase} text-right bg-[#e9ecef] text-slate-600 cursor-default`}
                      />
                    </td>
                    <td className={`${td} text-center whitespace-nowrap`}>
                      <button
                        type="button"
                        title="Editar detalhes"
                        onClick={() => setEditingId(isEditing ? null : item.id)}
                        className={`p-1.5 rounded cursor-pointer ${isEditing ? 'bg-[#1b2559] text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Remover"
                        onClick={() => removeRow(idx)}
                        className="p-1.5 rounded text-rose-600 hover:bg-rose-50 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                  {isEditing && (
                    <tr className="border-b border-slate-100 bg-slate-50/70">
                      <td colSpan={8} className="px-2 py-2">
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-[11px] text-slate-600">
                          <label className="space-y-0.5">
                            <span>Código / SKU</span>
                            <input
                              type="text"
                              value={item.sku}
                              onChange={(e) => patchRow(idx, { sku: e.target.value })}
                              className={`${inputBase} font-mono`}
                            />
                          </label>
                          <label className="space-y-0.5 sm:col-span-2">
                            <span>Descrição</span>
                            <input
                              type="text"
                              value={item.description}
                              onChange={(e) => patchRow(idx, { description: e.target.value })}
                              className={inputBase}
                            />
                          </label>
                          <label className="space-y-0.5">
                            <span>Cobrança</span>
                            <select
                              value={item.isRecurring !== false ? 'MENSAL' : 'UNICO'}
                              onChange={(e) => patchRow(idx, { isRecurring: e.target.value === 'MENSAL' })}
                              className={inputBase}
                            >
                              <option value="MENSAL">Mensal (recorrente)</option>
                              <option value="UNICO">{isProduct ? 'Única / Venda' : 'Taxa única / Setup'}</option>
                            </select>
                          </label>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}

            {/* Linha vazia sempre pronta (autocomplete do catalogo) */}
            <tr>
              <td className={`${td} relative`}>
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  data-testid={`proposal-grid-${noun}-search`}
                  placeholder="Digite para buscar"
                  onFocus={() => setOpen(true)}
                  onBlur={() => setTimeout(() => setOpen(false), 150)}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setHighlight(0);
                    setOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setHighlight((h) => Math.min(h + 1, Math.max(0, matches.length - 1)));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setHighlight((h) => Math.max(0, h - 1));
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      appendItem(matches[highlight] || null);
                    } else if (e.key === 'Escape') {
                      setOpen(false);
                    }
                  }}
                  className={inputBase}
                />
                {open && (query.trim() || matches.length > 0) && (
                  <div
                    data-testid={`proposal-grid-${noun}-dropdown`}
                    className="absolute left-1.5 top-full mt-0.5 z-50 w-[min(560px,80vw)] bg-white border border-[#ced4da] rounded-[3px] shadow-lg"
                  >
                    <ul className="max-h-72 overflow-y-auto py-0.5">
                      {matches.length === 0 && (
                        <li className="px-3 py-2 text-[12px] text-slate-500">Nenhum item do catálogo encontrado.</li>
                      )}
                      {matches.map((c, i) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onMouseEnter={() => setHighlight(i)}
                            onClick={() => appendItem(c)}
                            className={`w-full text-left px-3 py-1.5 cursor-pointer ${
                              i === highlight ? 'bg-[#1b2559] text-white' : 'text-slate-800 hover:bg-slate-100'
                            }`}
                          >
                            <div className="text-[13px] leading-snug truncate">
                              {c.gestaoClickCode} - {c.name}
                            </div>
                            <div className={`text-[10.5px] leading-tight ${i === highlight ? 'text-white/75' : 'text-slate-500'}`}>
                              {c.gestaoClickCode}
                              {' • '}
                              {formatBRL(catalogPriceFor(c, kind, isProduct ? defaultRental : true))}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="p-1.5 border-t border-slate-100">
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => appendItem(null)}
                        disabled={!query.trim()}
                        className="w-full inline-flex items-center justify-center gap-1 h-8 rounded-[3px] bg-[#28a745] hover:bg-[#218838] disabled:opacity-60 text-white text-[12px] font-semibold cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" /> Adicionar novo
                      </button>
                    </div>
                  </div>
                )}
              </td>
              <td className={td}>
                <input type="text" disabled placeholder="Detalhes" className={`${inputBase} opacity-70`} />
              </td>
              <td className={td}>
                <input type="text" disabled value="" className={`${inputBase} opacity-70`} />
              </td>
              <td className={td}>
                <select disabled className={`${inputBase} opacity-70`}>
                  <option>
                    {isProduct ? (defaultRental ? 'Locação' : 'Venda') : defaultServiceKind(serviceType)}
                  </option>
                </select>
              </td>
              <td className={td}>
                <input type="text" disabled className={`${inputBase} opacity-70`} />
              </td>
              <td className={td}>
                <input type="text" disabled placeholder="R$" className={`${inputBase} opacity-70`} />
              </td>
              <td className={td}>
                <input type="text" disabled className={`${inputBase} opacity-70`} />
              </td>
              <td className={td} />
            </tr>
          </tbody>
        </table>

        <div className="flex justify-end pt-2 mt-1 border-t border-slate-100 text-[12px] text-slate-600">
          <span>
            Subtotal {isProduct ? 'produtos' : 'serviços'} ({rows.length}):{' '}
            <span className="font-semibold text-[#1b2559] text-[13px]">{formatBRL(subtotal || 0)}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
