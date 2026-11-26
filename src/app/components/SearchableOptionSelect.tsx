'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { FixedPortalMenu } from './FixedPortalMenu';

export type SearchableOption = { value: string; label: string; legacy?: boolean };

/** Droplist com busca (estilo HubSpot): filtra opções pelo texto digitado. */
export default function SearchableOptionSelect({
  value,
  onChange,
  options,
  placeholder = 'Selecionar',
  disabled,
  className,
  ariaLabel,
  testId,
  allowClear = true,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  testId?: string;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [options, query]);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (open) {
      setQuery('');
      const idx = filtered.findIndex((o) => o.value === value);
      setHighlight(idx >= 0 ? idx : 0);
      const t = window.setTimeout(() => inputRef.current?.focus(), 20);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(Math.max(0, filtered.length - 1));
  }, [filtered.length, highlight]);

  const close = () => {
    setOpen(false);
    btnRef.current?.focus();
  };

  const pick = (next: string) => {
    onChange(next);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (filtered.length === 0) return;
      setHighlight((h) => {
        if (e.key === 'ArrowDown') return Math.min(filtered.length - 1, h + 1);
        return Math.max(0, h - 1);
      });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const opt = filtered[highlight];
      if (opt) pick(opt.value);
      return;
    }
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  return (
    <div className="relative w-full min-w-0" onKeyDown={onKeyDown}>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        data-testid={testId}
        onClick={() => {
          if (!disabled) setOpen((o) => !o);
        }}
        className={`inline-flex w-full items-center justify-between gap-1.5 text-left cursor-pointer disabled:bg-slate-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#0b6b7a]/25 ${
          className || 'px-3 py-2 rounded-md border border-slate-300 bg-white text-sm text-slate-800'
        }`}
      >
        <span className={`truncate ${selected ? 'text-slate-900' : 'text-slate-400'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className="w-4 h-4 shrink-0 text-slate-500" />
      </button>
      <FixedPortalMenu
        open={open}
        onClose={close}
        anchorRef={btnRef}
        align="stretch"
        lockWidth
        estimatedHeight={320}
        testId={testId ? `${testId}-menu` : undefined}
        role="presentation"
        className="z-[1200] rounded-md border border-slate-200 bg-white shadow-lg overflow-hidden"
      >
        {open ? (
        <div>
          <div className="p-2 border-b border-slate-100 sticky top-0 bg-white">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHighlight(0);
                }}
                placeholder="Buscar"
                data-testid={testId ? `${testId}-search` : undefined}
                className="w-full pl-8 pr-2 py-1.5 rounded border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#0b6b7a]/25"
              />
            </div>
          </div>
          <ul id={listId} role="listbox" className="max-h-56 overflow-y-auto py-1">
            {allowClear && value ? (
              <li>
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 cursor-pointer"
                  onClick={() => pick('')}
                >
                  Limpar seleção
                </button>
              </li>
            ) : null}
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-slate-500">Nenhuma opção encontrada.</li>
            ) : (
              filtered.map((opt, idx) => (
                <li key={`${opt.value}-${idx}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={opt.value === value}
                    className={`w-full text-left px-3 py-1.5 text-sm cursor-pointer ${
                      idx === highlight ? 'bg-[#eaf6f8] text-[#0b6b7a]' : 'text-slate-800 hover:bg-slate-50'
                    } ${opt.value === value ? 'font-semibold' : ''}`}
                    onMouseEnter={() => setHighlight(idx)}
                    onClick={() => pick(opt.value)}
                  >
                    {opt.label}
                    {opt.legacy ? <span className="ml-1 text-[10px] font-semibold text-slate-400">(atual)</span> : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
        ) : null}
      </FixedPortalMenu>
    </div>
  );
}
