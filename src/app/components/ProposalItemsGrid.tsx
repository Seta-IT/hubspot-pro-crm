'use client';

import React, { useMemo, useRef, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { ErpCatalogItem, ErpCommercialProposal, ErpProposalItem } from '../../db/types';
import { formatBRL } from './ui-helpers';
import { CatalogItemPicker, CATALOG_GRID_INPUT } from './CatalogItemPicker';
import { catalogPriceFor, isServiceCatalogItem } from '../lib/catalog-search';
import { keptUserLineDetails, proposalLineDetailsText } from '../lib/proposal-item-details';
import { inferProposalItemType, normalizeProposalItemUnit, PROPOSAL_SERVICE_PILL_OPTIONS, resolveProposalServiceType } from '../lib/proposal-share';
import type { ProposalGridItem } from '../lib/proposal-share';
import {
  PRICE_TABLE_VAREJO,
  catalogPriceForTable,
  catalogPriceTables,
  formatPtBrDecimal,
  formatPtBrMoney,
  inferPriceTableId,
  lineNetAmount,
  parsePtBrDecimal,
  proposalItemDetails,
  resolveDiscountType,
  type ProposalDiscountType,
} from '../lib/proposal-item-grid';

/**
 * Grade de itens no padrão GestãoClick:
 * "Adicione os produtos do orçamento" — Produto* (limpar no campo) | Detalhes |
 * Quant.* | Tipo* (tabela de preço) | Valor* | Desconto (% ou R$) | Subtotal | Ações.
 * Campos brancos, números pt-BR com 2 casas, botão "+ Adicionar produto" e
 * "Total de produtos R$ …" no rodapé.
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
  'w-full h-8 px-2 rounded-[3px] border border-[#ced4da] bg-white text-[12px] text-slate-800 focus:outline-none focus:border-[#1e3a6e] focus:ring-1 focus:ring-[#1e3a6e]/20';

export { isServiceCatalogItem } from '../lib/catalog-search';

function defaultServiceKind(budgetType?: ErpCommercialProposal['budgetType'], serviceType?: string): string {
  return resolveProposalServiceType({ budgetType, serviceType }) || PROPOSAL_SERVICE_PILL_OPTIONS[0];
}

function isRentalBudget(budgetType?: ErpCommercialProposal['budgetType']): boolean {
  return budgetType !== 'PRODUTOS' && budgetType !== 'SPARE_PARTS';
}

/**
 * Deriva a natureza fiscal de cada linha a partir do Tipo de Orçamento da proposta.
 * O preço de catálogo acompanha a natureza somente quando a linha ainda está com
 * o preço de catálogo da natureza anterior (respeitando a tabela de preço da linha).
 */
export function applyBudgetTypeToItems(
  items: ErpProposalItem[],
  budgetType?: ErpCommercialProposal['budgetType'],
  serviceType?: string,
  catalog: ErpCatalogItem[] = []
): ErpProposalItem[] {
  const rental = isRentalBudget(budgetType);
  const serviceKind = defaultServiceKind(budgetType, serviceType);
  return (items || []).map((item) => {
    if (inferProposalItemType(item) === 'SERVICE') {
      return { ...item, serviceKind } as ProposalGridItem;
    }
    const nextNature: ErpProposalItem['fiscalNature'] = rental ? 'LOCACAO_BENS_MOVEIS' : 'VENDA_EQUIPAMENTO';
    if (item.fiscalNature === nextNature && item.isRecurring === rental) return item;
    const found = catalog.find((c) => c.gestaoClickCode === item.sku);
    const tableId = inferPriceTableId(item, found, item.fiscalNature !== 'VENDA_EQUIPAMENTO');
    const wasCatalogPrice =
      found &&
      Number(item.unitPrice) === catalogPriceForTable(found, tableId, 'PRODUCT', item.fiscalNature !== 'VENDA_EQUIPAMENTO');
    return {
      ...item,
      fiscalNature: nextNature,
      isRecurring: rental,
      ...(found && wasCatalogPrice
        ? { unitPrice: catalogPriceForTable(found, tableId, 'PRODUCT', rental) }
        : {}),
    };
  });
}

/**
 * Troca o produto/serviço de uma linha já preenchida.
 * Mantém id, quantidade e desconto. Código, descrição, NCM, unidade e preço vêm do catálogo.
 */
export function replaceProposalGridItem(
  current: ErpProposalItem,
  found: ErpCatalogItem,
  opts: {
    kind: GridKind;
    budgetType?: ErpCommercialProposal['budgetType'];
    serviceType?: string;
  }
): ErpProposalItem {
  const quantity = Math.max(1, Number(current.quantity || 1));
  const discountPercent = Number(current.discountPercent || 0);
  const discountAmount = Number(current.discountAmount || 0);
  const lineDetails = keptUserLineDetails(current);
  if (opts.kind === 'PRODUCT') {
    const rental = isRentalBudget(opts.budgetType);
    return {
      ...current,
      sku: found.gestaoClickCode || '',
      description: found.name || current.description,
      itemType: 'PRODUCT',
      unit: normalizeProposalItemUnit(found.unitOfMeasure, 'PRODUCT'),
      fiscalNature: rental ? 'LOCACAO_BENS_MOVEIS' : 'VENDA_EQUIPAMENTO',
      ncmOrServiceCode: found.ncmOrLc116 || current.ncmOrServiceCode,
      ...(lineDetails !== undefined ? { lineDetails } : {}),
      quantity,
      unitPrice: catalogPriceFor(found, 'PRODUCT', rental),
      discountPercent,
      discountAmount,
      isRecurring: rental,
    };
  }
  const recurring = opts.budgetType !== 'PRODUTOS' && opts.budgetType !== 'SPARE_PARTS';
  return {
    ...current,
    sku: found.gestaoClickCode || '',
    description: found.name || current.description,
    itemType: 'SERVICE',
    unit: normalizeProposalItemUnit(found.unitOfMeasure, 'SERVICE'),
    fiscalNature:
      found.fiscalNature === 'SERVICO_COMUNICACAO_SCM_SVA'
        ? 'SERVICO_COMUNICACAO_SCM_SVA'
        : 'SERVICO_TECNICO_TI_TELECOM',
    ncmOrServiceCode: found.ncmOrLc116 || current.ncmOrServiceCode,
    ...(lineDetails !== undefined ? { lineDetails } : {}),
    serviceKind: defaultServiceKind(opts.budgetType, opts.serviceType),
    quantity,
    unitPrice: catalogPriceFor(found, 'SERVICE', true),
    discountPercent,
    discountAmount,
    isRecurring: recurring,
  } as ProposalGridItem;
}

function skuPrefix(item: ErpProposalItem): string {
  const sku = String(item.sku || '').trim();
  if (!sku || String(item.description || '').trim().startsWith(sku)) return '';
  return `${sku} - `;
}

function findCatalogForItem(item: ErpProposalItem, catalog: ErpCatalogItem[]): ErpCatalogItem | undefined {
  const sku = String(item.sku || '').trim();
  if (!sku) return undefined;
  return catalog.find((c) => c.gestaoClickCode === sku || c.id === sku || c.gestaoClickId === sku);
}

function DecimalInput({
  value,
  onCommit,
  className,
  min,
  ariaLabel,
  textAlign = 'right',
}: {
  value: number;
  onCommit: (n: number) => void;
  className?: string;
  min?: number;
  ariaLabel: string;
  textAlign?: 'right' | 'center' | 'left';
}) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState('');
  const shown = focused ? text : formatPtBrDecimal(value, 2);
  const align = textAlign === 'center' ? 'text-center' : textAlign === 'left' ? 'text-left' : 'text-right';
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={shown}
      onFocus={() => {
        setText(formatPtBrDecimal(value, 2));
        setFocused(true);
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setFocused(false);
        const parsed = parsePtBrDecimal(text);
        const next = min != null ? Math.max(min, parsed) : Math.max(0, parsed);
        onCommit(next);
      }}
      className={`${inputBase} ${align} ${className || ''}`}
    />
  );
}

function DiscountCell({
  item,
  onCommit,
}: {
  item: ErpProposalItem;
  onCommit: (patch: { discountType: ProposalDiscountType; discountPercent: number; discountAmount: number }) => void;
}) {
  const type = resolveDiscountType(item);
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState('');
  const current = type === 'PERCENT' ? Number(item.discountPercent || 0) : Number(item.discountAmount || 0);
  const shown = focused ? text : current > 0 ? formatPtBrDecimal(current, 2) : '';

  const commitValue = (raw: string, nextType: ProposalDiscountType) => {
    const n = parsePtBrDecimal(raw);
    if (nextType === 'PERCENT') onCommit({ discountType: 'PERCENT', discountPercent: Math.min(100, n), discountAmount: 0 });
    else onCommit({ discountType: 'BRL', discountPercent: 0, discountAmount: Math.max(0, n) });
  };

  return (
    <div className="flex items-stretch">
      <input
        type="text"
        inputMode="decimal"
        aria-label="Desconto"
        value={shown}
        placeholder="0,00"
        onFocus={() => {
          setText(current > 0 ? formatPtBrDecimal(current, 2) : '');
          setFocused(true);
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setFocused(false);
          commitValue(text, type);
        }}
        className={`${inputBase} rounded-r-none text-right`}
      />
      <div className="inline-flex rounded-r-[3px] border border-l-0 border-[#ced4da] overflow-hidden shrink-0">
        <button
          type="button"
          title="Desconto em percentual"
          aria-label="Desconto em %"
          aria-pressed={type === 'PERCENT'}
          onClick={() => commitValue(focused ? text : shown, 'PERCENT')}
          className={`px-1.5 min-w-[28px] text-[11px] font-semibold cursor-pointer ${
            type === 'PERCENT' ? 'bg-[#1e3a6e] text-white' : 'bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          %
        </button>
        <button
          type="button"
          title="Desconto em R$"
          aria-label="Desconto em reais"
          aria-pressed={type === 'BRL'}
          onClick={() => commitValue(focused ? text : shown, 'BRL')}
          className={`px-1.5 min-w-[28px] text-[11px] font-semibold cursor-pointer border-l border-[#ced4da] ${
            type === 'BRL' ? 'bg-[#1e3a6e] text-white' : 'bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          R$
        </button>
      </div>
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingRemoveIdx, setPendingRemoveIdx] = useState<number | null>(null);
  const [addingRow, setAddingRow] = useState(false);
  const [draftDetails, setDraftDetails] = useState('');
  const [draftQty, setDraftQty] = useState(1);
  const addPickerWrapRef = useRef<HTMLDivElement | null>(null);

  const isProduct = kind === 'PRODUCT';
  const defaultRental = isRentalBudget(budgetType);
  const noun = isProduct ? 'produtos' : 'serviços';
  const nounSingular = isProduct ? 'produto' : 'serviço';

  const rows = items
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => inferProposalItemType(item) === kind);

  const pool = useMemo(
    () => catalog.filter((c) => c.isActive !== false && (isProduct ? !isServiceCatalogItem(c) : isServiceCatalogItem(c))),
    [catalog, isProduct]
  );

  const computedSubtotal =
    rows.reduce((s, { item }) => s + lineNetAmount(item), 0) || Number(subtotal || 0);

  const patchRow = (idx: number, patch: Partial<ProposalGridItem>) => {
    const copy = [...items];
    copy[idx] = { ...copy[idx], ...patch } as ErpProposalItem;
    onItemsChange(copy);
  };

  const buildItem = (found: ErpCatalogItem | null, freeText: string): ErpProposalItem => {
    const id = `item-${isProduct ? 'prd' : 'srv'}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const tables = catalogPriceTables(found, isProduct ? defaultRental : false);
    const table = tables[0] || { id: PRICE_TABLE_VAREJO, name: 'Varejo', price: 0 };
    const price = found ? catalogPriceForTable(found, table.id, kind, isProduct ? defaultRental : true) : 0;
    if (isProduct) {
      const rental = defaultRental;
      return {
        id,
        sku: found?.gestaoClickCode || '',
        description: found?.name || freeText,
        itemType: 'PRODUCT',
        unit: found?.unitOfMeasure || 'UN',
        fiscalNature: rental ? 'LOCACAO_BENS_MOVEIS' : 'VENDA_EQUIPAMENTO',
        ncmOrServiceCode: found?.ncmOrLc116 || '',
        details: '',
        priceTableId: table.id,
        priceTableName: table.name,
        quantity: 1,
        unitPrice: price,
        discountPercent: 0,
        discountAmount: 0,
        discountType: 'BRL',
        subtotal: price,
        isRecurring: rental,
        totalMonthly: price,
      };
    }
    const item: ProposalGridItem = {
      id,
      sku: found?.gestaoClickCode || '',
      description: found?.name || freeText,
      itemType: 'SERVICE',
      unit: 'SV',
      fiscalNature:
        found?.fiscalNature === 'SERVICO_COMUNICACAO_SCM_SVA' ? 'SERVICO_COMUNICACAO_SCM_SVA' : 'SERVICO_TECNICO_TI_TELECOM',
      ncmOrServiceCode: found?.ncmOrLc116 || '',
      details: '',
      priceTableId: table.id,
      priceTableName: table.name,
      serviceKind: defaultServiceKind(budgetType, serviceType),
      quantity: 1,
      unitPrice: price,
      discountPercent: 0,
      discountAmount: 0,
      discountType: 'BRL',
      subtotal: price,
      isRecurring: budgetType !== 'PRODUTOS' && budgetType !== 'SPARE_PARTS',
      totalMonthly: price,
    };
    return item;
  };

  const appendItem = (found: ErpCatalogItem | null, text: string) => {
    if (!found && !text) return;
    const created = buildItem(found, text);
    if (draftDetails.trim()) created.details = draftDetails.trim();
    if (draftQty > 1) {
      created.quantity = draftQty;
      const net = lineNetAmount({ ...created, quantity: draftQty });
      created.subtotal = net;
      created.totalMonthly = net;
    }
    onItemsChange([...items, created]);
    setDraftDetails('');
    setDraftQty(1);
    setAddingRow(true);
  };

  const removeRow = (idx: number) => onItemsChange(items.filter((_, i) => i !== idx));

  const clearProduct = (idx: number, item: ErpProposalItem) => {
    patchRow(idx, {
      sku: '',
      description: '',
      // limpa só o produto: o texto digitado em Detalhes (lineDetails ou details antigo) fica
      lineDetails: keptUserLineDetails(item) ?? '',
      unitPrice: 0,
      subtotal: 0,
      totalMonthly: 0,
    });
  };

  const applyPriceTable = (idx: number, item: ErpProposalItem, tableId: string) => {
    const found = findCatalogForItem(item, catalog);
    const tables = catalogPriceTables(found, isProduct ? defaultRental : false);
    const table = tables.find((t) => t.id === tableId) || tables[0];
    const price = found
      ? catalogPriceForTable(found, tableId, kind, isProduct ? defaultRental : true)
      : Number(item.unitPrice || 0);
    patchRow(idx, {
      priceTableId: table?.id || tableId,
      priceTableName: table?.name,
      unitPrice: price,
    });
  };

  const focusAddPicker = () => {
    const root = addPickerWrapRef.current;
    const input = root?.querySelector('input');
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.click();
    }
  };

  const startAddRow = () => {
    setAddingRow(true);
    setTimeout(() => focusAddPicker(), 0);
  };

  const th = 'py-1.5 px-1.5 text-left text-[12px] font-semibold text-slate-700 whitespace-nowrap';
  const td = 'py-1 px-1.5 align-middle';

  return (
    <div className="bg-white rounded-md border border-slate-200 shadow-2xs" data-testid={`proposal-grid-${noun}`}>
      <div className="px-4 py-3 border-b border-slate-200">
        <div className="text-[15px] font-semibold text-slate-900">
          {isProduct ? 'Adicione os produtos do orçamento' : 'Adicione os serviços do orçamento'}
        </div>
        <div className="text-[12px] text-slate-500 mt-0.5">
          {isProduct ? 'Produto' : 'Serviço'}, quantidade, valor e desconto por linha.
        </div>
      </div>

      <div className="px-3 py-2">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-slate-200">
              <th className={`${th} w-[26%] min-w-[200px]`}>
                {isProduct ? 'Produto' : 'Serviço'}
                <span className="text-rose-600">*</span>
              </th>
              <th className={`${th} min-w-[110px]`}>Detalhes</th>
              <th className={`${th} w-[78px]`}>
                Quant.<span className="text-rose-600">*</span>
              </th>
              <th className={`${th} w-[120px]`}>
                Tipo<span className="text-rose-600">*</span>
              </th>
              <th className={`${th} w-[110px]`}>
                Valor<span className="text-rose-600">*</span>
              </th>
              <th className={`${th} w-[148px]`}>Desconto</th>
              <th className={`${th} w-[110px]`}>Subtotal</th>
              <th className={`${th} w-[88px] text-center`}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, idx }) => {
              const found = findCatalogForItem(item, catalog);
              const tables = catalogPriceTables(found, isProduct ? defaultRental : false);
              const tableId = inferPriceTableId(item, found, isProduct ? defaultRental : false);
              const isEditing = editingId === item.id;
              const details = proposalItemDetails(item);
              const net = lineNetAmount(item);
              return (
                <React.Fragment key={item.id || idx}>
                  <tr className="border-b border-slate-100" data-testid={`proposal-grid-${noun}-row`}>
                    <td className={td}>
                      <div className="relative">
                        <CatalogItemPicker
                          catalog={pool}
                          testIdPrefix={`proposal-grid-${noun}-row`}
                          value={`${skuPrefix(item)}${item.description || ''}`}
                          priceFor={(c) => catalogPriceFor(c, kind, isProduct ? defaultRental : true)}
                          onAdd={() => undefined}
                          onSelectItem={(found) => {
                            const copy = [...items];
                            copy[idx] = replaceProposalGridItem(item, found, { kind, budgetType, serviceType });
                            onItemsChange(copy);
                          }}
                          inputClassName={`${inputBase} pr-8`}
                        />
                        {(item.description || item.sku) && (
                          <button
                            type="button"
                            title="Limpar produto"
                            aria-label="Limpar produto"
                            onClick={() => clearProduct(idx, item)}
                            className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded text-slate-500 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className={td}>
                      <input
                        type="text"
                        value={details}
                        onChange={(e) => patchRow(idx, { lineDetails: e.target.value })}
                        placeholder=""
                        aria-label="Detalhes"
                        className={inputBase}
                      />
                    </td>
                    <td className={td}>
                      <DecimalInput
                        value={Number(item.quantity || 1)}
                        min={1}
                        ariaLabel="Quantidade"
                        textAlign="center"
                        onCommit={(n) => patchRow(idx, { quantity: n })}
                      />
                    </td>
                    <td className={td}>
                      <select
                        aria-label="Tipo (tabela de preço)"
                        value={tableId}
                        onChange={(e) => applyPriceTable(idx, item, e.target.value)}
                        className={inputBase}
                      >
                        {tables.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={td}>
                      <DecimalInput
                        value={Number(item.unitPrice || 0)}
                        min={0}
                        ariaLabel="Valor"
                        onCommit={(n) => patchRow(idx, { unitPrice: n })}
                      />
                    </td>
                    <td className={td}>
                      <DiscountCell
                        key={`${item.id}-${item.discountType}-${item.discountPercent}-${item.discountAmount}`}
                        item={item}
                        onCommit={(patch) => patchRow(idx, patch)}
                      />
                    </td>
                    <td className={td}>
                      <input
                        type="text"
                        readOnly
                        tabIndex={-1}
                        aria-label="Subtotal"
                        value={formatPtBrDecimal(net, 2)}
                        className={`${inputBase} text-right bg-slate-50 text-slate-700 cursor-default`}
                      />
                    </td>
                    <td className={`${td} text-center whitespace-nowrap`}>
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          title="Editar produto"
                          aria-label="Editar produto"
                          onClick={() => setEditingId(isEditing ? null : item.id)}
                          className={`inline-flex items-center justify-center w-7 h-7 rounded border cursor-pointer ${
                            isEditing
                              ? 'bg-[#1e3a6e] text-white border-[#1e3a6e]'
                              : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Excluir"
                          aria-label="Excluir"
                          onClick={() => setPendingRemoveIdx(idx)}
                          className="inline-flex items-center justify-center w-7 h-7 rounded border border-rose-300 bg-white text-rose-600 hover:bg-rose-50 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
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
                          <label className="space-y-0.5">
                            <span>NCM / código fiscal</span>
                            <input
                              type="text"
                              value={item.ncmOrServiceCode || ''}
                              onChange={(e) => patchRow(idx, { ncmOrServiceCode: e.target.value })}
                              className={inputBase}
                            />
                          </label>
                          <label className="space-y-0.5">
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
            {addingRow && (
              <tr className="border-b border-slate-100" data-testid={`proposal-grid-${noun}-draft`}>
                <td className={td}>
                  <div ref={addPickerWrapRef}>
                    <CatalogItemPicker
                      catalog={pool}
                      testIdPrefix={`proposal-grid-${noun}`}
                      priceFor={(c) => catalogPriceForTable(c, PRICE_TABLE_VAREJO, kind, isProduct ? defaultRental : true)}
                      onAdd={appendItem}
                      placeholder="Digite ou cole o produto"
                      inputClassName={inputBase}
                    />
                  </div>
                </td>
                <td className={td}>
                  <input
                    type="text"
                    value={draftDetails}
                    onChange={(e) => setDraftDetails(e.target.value)}
                    aria-label="Detalhes"
                    className={inputBase}
                    data-testid={`proposal-grid-${noun}-draft-details`}
                  />
                </td>
                <td className={td}>
                  <DecimalInput
                    value={draftQty}
                    min={1}
                    ariaLabel="Quantidade"
                    textAlign="center"
                    onCommit={(n) => setDraftQty(n)}
                  />
                </td>
                <td className={td}>
                  <select aria-label="Tipo (tabela de preço)" defaultValue="VAREJO" className={inputBase} disabled={false}>
                    {catalogPriceTables(null, false).map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </td>
                <td className={td}>
                  <input type="text" value="" placeholder="0,00" readOnly={false} aria-label="Valor" className={`${inputBase} text-right`} />
                </td>
                <td className={td}>
                  <div className="flex items-stretch">
                    <input type="text" placeholder="0,00" aria-label="Desconto" className={`${inputBase} rounded-r-none text-right`} />
                    <div className="inline-flex rounded-r-[3px] border border-l-0 border-[#ced4da] overflow-hidden shrink-0">
                      <span className="px-1.5 min-w-[28px] text-[11px] font-semibold text-slate-700 bg-white">%</span>
                      <span className="px-1.5 min-w-[28px] text-[11px] font-semibold text-white bg-[#1e3a6e] border-l border-[#ced4da]">R$</span>
                    </div>
                  </div>
                </td>
                <td className={td}>
                  <input type="text" readOnly tabIndex={-1} value="0,00" aria-label="Subtotal" className={`${inputBase} text-right bg-slate-50 text-slate-700 cursor-default`} />
                </td>
                <td className={`${td} text-center`}>
                  <button
                    type="button"
                    title="Cancelar"
                    aria-label="Cancelar"
                    onClick={() => { setAddingRow(false); setDraftDetails(''); setDraftQty(1); }}
                    className="inline-flex items-center justify-center w-7 h-7 rounded border border-rose-300 bg-white text-rose-600 hover:bg-rose-50 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 mt-1 border-t border-slate-200">
          <div className="flex items-center gap-2 min-w-[240px] flex-1">
            <button
              type="button"
              onClick={startAddRow}
              data-testid={`proposal-grid-${noun}-add`}
              className="inline-flex items-center gap-1 px-2.5 h-8 rounded-[3px] border border-[#1e3a6e] text-[#1e3a6e] bg-white hover:bg-slate-50 text-[12px] font-semibold cursor-pointer shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Adicionar {nounSingular}
            </button>
          </div>
          <div
            className="text-right text-[13px] font-semibold text-[#1e3a6e]"
            data-testid={`proposal-grid-${noun}-total`}
          >
            Total de {noun}{' '}
            <span className="text-[16px] font-semibold tracking-tight">{formatPtBrMoney(computedSubtotal)}</span>
          </div>
        </div>
      </div>

      {pendingRemoveIdx !== null && (
        <div className="fixed inset-0 z-[80] bg-slate-900/50 flex items-center justify-center p-4" data-testid="confirm-delete-proposal-product">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-sm w-full p-5 space-y-3">
            <h4 className="text-sm font-semibold text-slate-900">Excluir {nounSingular}?</h4>
            {rows.filter(({ idx }) => idx !== pendingRemoveIdx).length < 1 && (
              <p className="text-xs font-semibold text-slate-600">A proposta precisa de pelo menos um item.</p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPendingRemoveIdx(null)}
                className="px-3.5 py-2 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 text-xs font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const idx = pendingRemoveIdx;
                  setPendingRemoveIdx(null);
                  if (idx === null) return;
                  removeRow(idx);
                }}
                className="px-3.5 py-2 rounded bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
