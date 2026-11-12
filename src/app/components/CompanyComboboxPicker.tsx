'use client';

import React, { useMemo, useRef, useState } from 'react';
import type { Company } from '../../db/types';
import { CATALOG_GRID_INPUT } from './CatalogItemPicker';
import { companyTradeName, filterCompaniesForPicker } from '../lib/company-search';

export interface CompanyComboboxPickerProps {
  /** Clientes cadastrados (mesma lista de Vendas/Orcamentos). */
  companies: Company[];
  /** Nome exibido no campo (cliente atual). */
  value: string;
  onSelect: (company: Company) => void;
  testIdPrefix: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  maxResults?: number;
}

/**
 * Combobox pesquisavel de clientes, no mesmo padrao do campo de produtos (CatalogItemPicker):
 * ao focar lista os primeiros; ao digitar filtra por nome, nome fantasia ou CNPJ/CPF;
 * setas + Enter escolhem; Esc fecha. So aceita cliente cadastrado.
 */
export function CompanyComboboxPicker({
  companies,
  value,
  onSelect,
  testIdPrefix,
  placeholder = 'Digite para buscar o cliente',
  disabled = false,
  invalid = false,
  maxResults = 10,
}: CompanyComboboxPickerProps) {
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const typed = query ?? '';

  const matches = useMemo(
    () => filterCompaniesForPicker(companies, typed, maxResults),
    [companies, typed, maxResults]
  );

  const choose = (c: Company | undefined) => {
    if (!c) return;
    onSelect(c);
    setQuery(null);
    setOpen(false);
    setHighlight(0);
  };

  return (
    <div className="relative" data-testid="company-combobox-picker">
      <input
        ref={inputRef}
        type="text"
        value={query === null ? value : query}
        disabled={disabled}
        data-testid={`${testIdPrefix}-search`}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onFocus={(e) => {
          setOpen(true);
          e.currentTarget.select();
        }}
        onBlur={() =>
          setTimeout(() => {
            setOpen(false);
            setQuery(null);
          }, 150)
        }
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
            choose(matches[highlight]);
          } else if (e.key === 'Escape') {
            setOpen(false);
            setQuery(null);
          }
        }}
        className={`${CATALOG_GRID_INPUT} ${invalid ? 'border-rose-500' : ''}`}
      />
      {open && !disabled && (
        <div
          data-testid={`${testIdPrefix}-dropdown`}
          className="absolute left-0 top-full mt-0.5 z-50 w-[min(560px,80vw)] bg-white border border-[#ced4da] rounded-[3px] shadow-lg"
        >
          <ul className="max-h-72 overflow-y-auto py-0.5" role="listbox">
            {matches.length === 0 && (
              <li className="px-3 py-2 text-[12px] text-slate-500">Nenhum cliente cadastrado encontrado.</li>
            )}
            {matches.map((c, i) => {
              const trade = companyTradeName(c);
              return (
                <li key={c.id} role="option" aria-selected={i === highlight}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => choose(c)}
                    className={`w-full text-left px-3 py-1.5 cursor-pointer ${
                      i === highlight ? 'bg-[#1b2559] text-white' : 'text-slate-800 hover:bg-slate-100'
                    }`}
                  >
                    <div className="text-[13px] font-semibold leading-snug truncate">{c.name}</div>
                    <div className={`text-[10.5px] leading-tight ${i === highlight ? 'text-white/75' : 'text-slate-500'}`}>
                      {[c.cnpj, trade && trade !== c.name ? trade : '', c.city && c.state ? `${c.city}/${c.state}` : '']
                        .filter(Boolean)
                        .join(' • ') || 'Sem CNPJ cadastrado'}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
