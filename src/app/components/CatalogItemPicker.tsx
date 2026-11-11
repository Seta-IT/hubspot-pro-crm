'use client';

import React, { useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { ErpCatalogItem } from '../../db/types';
import { formatBRL } from './ui-helpers';
import { filterCatalogProducts } from '../lib/catalog-search';

export {
  catalogPriceFor,
  catalogRentalPrice,
  filterCatalogProducts,
  isServiceCatalogItem,
} from '../lib/catalog-search';

/** Estilo dos campos da grade de itens (orçamento e contrato). */
export const CATALOG_GRID_INPUT =
  'w-full h-8 px-2 rounded-[3px] border border-[#ced4da] bg-[#e9ecef] text-[12px] text-slate-800 focus:outline-none focus:border-[#1b2559] focus:bg-white';

export interface CatalogItemPickerProps {
  /** Itens já filtrados (produtos ou serviços ativos). */
  catalog: ErpCatalogItem[];
  /** Preço exibido na lista (o mesmo que entra na linha). */
  priceFor: (item: ErpCatalogItem) => number;
  /** Adiciona a linha: item do catálogo, ou null para "Adicionar novo" com o texto digitado. */
  onAdd: (found: ErpCatalogItem | null, freeText: string) => void;
  /** Prefixo dos data-testid (ex.: proposal-grid-produtos, contract-products). */
  testIdPrefix: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  maxResults?: number;
}

/**
 * Campo de adicionar produto/serviço da grade de orçamentos, reutilizado no contrato.
 * Linha vazia sempre pronta: ao focar lista os primeiros itens; ao digitar filtra por nome,
 * código (ignorando separadores), marca e modelo; setas + Enter escolhem; "Adicionar novo"
 * inclui um item livre com o texto digitado. Depois de adicionar, o foco volta para o campo.
 */
export function CatalogItemPicker({
  catalog,
  priceFor,
  onAdd,
  testIdPrefix,
  placeholder = 'Digite para buscar',
  disabled = false,
  invalid = false,
  maxResults = 8,
}: CatalogItemPickerProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const matches = useMemo(() => {
    const q = query.trim();
    const pool = (catalog || []).filter((c) => c && c.isActive !== false);
    if (!q) return pool.slice(0, maxResults);
    return filterCatalogProducts(pool, q, maxResults);
  }, [catalog, query, maxResults]);

  const add = (found: ErpCatalogItem | null) => {
    const text = query.trim();
    if (!found && !text) return;
    onAdd(found, text);
    setQuery('');
    setOpen(false);
    setHighlight(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <div className="relative" data-testid="catalog-item-picker">
      <input
        ref={inputRef}
        type="text"
        value={query}
        disabled={disabled}
        data-testid={`${testIdPrefix}-search`}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
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
            setOpen(true);
            setHighlight((h) => Math.min(h + 1, Math.max(0, matches.length - 1)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(0, h - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            add(matches[highlight] || null);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className={`${CATALOG_GRID_INPUT} ${invalid ? 'border-rose-500' : ''}`}
      />
      {open && !disabled && (query.trim() || matches.length > 0) && (
        <div
          data-testid={`${testIdPrefix}-dropdown`}
          className="absolute left-0 top-full mt-0.5 z-50 w-[min(560px,80vw)] bg-white border border-[#ced4da] rounded-[3px] shadow-lg"
        >
          <ul className="max-h-72 overflow-y-auto py-0.5" role="listbox">
            {matches.length === 0 && (
              <li className="px-3 py-2 text-[12px] text-slate-500">Nenhum item do catálogo encontrado.</li>
            )}
            {matches.map((c, i) => (
              <li key={c.id || c.gestaoClickCode} role="option" aria-selected={i === highlight}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => add(c)}
                  className={`w-full text-left px-3 py-1.5 cursor-pointer ${
                    i === highlight ? 'bg-[#1b2559] text-white' : 'text-slate-800 hover:bg-slate-100'
                  }`}
                >
                  <div className="text-[13px] font-semibold leading-snug truncate">
                    {c.gestaoClickCode && !String(c.name || '').startsWith(c.gestaoClickCode)
                      ? `${c.gestaoClickCode} - ${c.name}`
                      : c.name}
                  </div>
                  <div className={`text-[10.5px] leading-tight ${i === highlight ? 'text-white/75' : 'text-slate-500'}`}>
                    {c.gestaoClickCode}
                    {' • '}
                    {formatBRL(priceFor(c))}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="p-1.5 border-t border-slate-100">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(null)}
              disabled={!query.trim()}
              className="w-full inline-flex items-center justify-center gap-1 h-8 rounded-[3px] bg-[#28a745] hover:bg-[#218838] disabled:opacity-60 text-white text-[12px] font-semibold cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Adicionar novo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
