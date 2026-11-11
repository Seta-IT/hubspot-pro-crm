'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ErpCatalogItem } from '../../db/types';
import { formatBRL } from './ui-helpers';

function foldQuery(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const SERVICE_NATURES = new Set(['SERVICO_TECNICO_TI_TELECOM', 'SERVICO_COMUNICACAO_SCM_SVA']);

export function isServiceCatalogItem(c: ErpCatalogItem): boolean {
  return (
    SERVICE_NATURES.has(String(c.fiscalNature)) ||
    c.category === 'SERVICO_TECNICO_LC116' ||
    c.category === 'TELECOM_SCM_SVA'
  );
}

/** Mesma busca dos orçamentos: nome, código, marca e código de barras, sem acento e sem diferenciar maiúsculas. */
export function filterCatalogProducts(
  catalog: ErpCatalogItem[],
  query: string,
  maxResults = 10
): ErpCatalogItem[] {
  const q = foldQuery(query);
  const pool = (catalog || []).filter((c) => c && c.isActive !== false);
  if (q.length < 1) return [];
  return pool
    .filter((c) => {
      const code = foldQuery(c.gestaoClickCode || '');
      const name = foldQuery(c.name || '');
      const barcode = foldQuery(c.barcodeEan || '');
      const brand = foldQuery(c.brand || '');
      return code.includes(q) || name.includes(q) || barcode.includes(q) || brand.includes(q);
    })
    .slice(0, maxResults);
}

export function catalogRentalPrice(item: ErpCatalogItem): number {
  return Number(item.monthlyRentalPrice || item.saleOrSetupPrice || 0);
}

export interface CatalogProductComboboxProps {
  catalog: ErpCatalogItem[];
  value: string;
  onChangeText: (value: string) => void;
  onSelect: (item: ErpCatalogItem) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  debounceMs?: number;
  maxResults?: number;
  minChars?: number;
  id?: string;
}

/**
 * Combobox de produtos no padrão HubSpot: lista branca, busca por nome, código e marca
 * sem acento e sem diferenciar maiúsculas, a partir de 1 caractere.
 */
export function CatalogProductCombobox({
  catalog,
  value,
  onChangeText,
  onSelect,
  placeholder = 'Digite para buscar',
  disabled = false,
  invalid = false,
  debounceMs = 200,
  maxResults = 10,
  minChars = 1,
  id,
}: CatalogProductComboboxProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [debounced, setDebounced] = useState(value);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), debounceMs);
    return () => window.clearTimeout(t);
  }, [value, debounceMs]);

  const matches = useMemo(
    () => (foldQuery(debounced).length >= minChars ? filterCatalogProducts(catalog, debounced, maxResults) : []),
    [catalog, debounced, maxResults, minChars]
  );

  useEffect(() => {
    setHighlight(0);
  }, [debounced]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const showList = open && foldQuery(debounced).length >= minChars;

  const pick = (item: ErpCatalogItem) => {
    onSelect(item);
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div ref={rootRef} className="relative" data-testid="catalog-product-combobox">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChangeText(e.target.value);
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
          } else if (e.key === 'Enter' && showList && matches[highlight]) {
            e.preventDefault();
            pick(matches[highlight]);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
          }
        }}
        className={`w-full px-2 py-1.5 rounded border text-xs ${
          invalid ? 'border-rose-500' : 'border-slate-300'
        } bg-white focus:outline-none focus:ring-2 focus:ring-[color:var(--sti-accent)]/40`}
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          data-testid="catalog-product-dropdown"
          className="absolute left-0 z-50 mt-1 w-[min(560px,80vw)] max-h-72 overflow-y-auto rounded-[6px] border border-[#cbd6e2] bg-white shadow-lg py-1"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-xs text-slate-500">Nenhum produto encontrado.</li>
          ) : (
            matches.map((item, index) => {
              const active = index === highlight;
              return (
                <li key={item.id || item.gestaoClickCode} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => pick(item)}
                    className={`w-full text-left px-3 py-2 cursor-pointer ${
                      active ? 'bg-[#fff4f0] text-slate-900' : 'text-slate-700 hover:bg-[#f5f8fa]'
                    }`}
                  >
                    <div className="text-xs font-semibold leading-snug truncate">
                      {item.gestaoClickCode} - {item.name}
                    </div>
                    <div className="text-[10px] font-semibold text-slate-500 leading-tight">
                      {item.gestaoClickCode}
                      {' • '}
                      {formatBRL(catalogRentalPrice(item))}
                    </div>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
