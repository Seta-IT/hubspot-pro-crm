'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { FixedPortalMenu } from './FixedPortalMenu';

export type AppSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

/** Navegação por teclado da lista (setas, Home e End). */
export function moveSelectHighlight(current: number, key: string, optionCount: number): number {
  if (optionCount <= 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return optionCount - 1;
  if (key === 'ArrowDown') return current < 0 ? 0 : Math.min(optionCount - 1, current + 1);
  if (key === 'ArrowUp') return current < 0 ? optionCount - 1 : Math.max(0, current - 1);
  return current;
}

/** Digitação incremental: primeiro item cujo rótulo começa com a consulta. */
export function findSelectOptionByQuery(
  options: Array<Pick<AppSelectOption, 'label' | 'disabled'>>,
  query: string,
  fromIndex = -1
): number {
  const q = query.trim().toLowerCase();
  if (!q || options.length === 0) return -1;
  const start = Math.max(0, fromIndex + 1) % options.length;
  for (let step = 0; step < options.length; step += 1) {
    const i = (start + step) % options.length;
    const opt = options[i];
    if (!opt.disabled && opt.label.toLowerCase().startsWith(q)) return i;
  }
  return -1;
}

export function AppSelect({
  value,
  onChange,
  options,
  placeholder = 'Selecione',
  disabled,
  className,
  id,
  name,
  ariaLabel,
  ariaLabelledBy,
  testId,
  required,
}: {
  value: string;
  onChange: (value: string) => void;
  options: AppSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  name?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  testId?: string;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const queryRef = useRef('');
  const queryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = options.find((o) => o.value === value);
  const selectedIndex = options.findIndex((o) => o.value === value);

  useEffect(() => {
    if (open) setHighlight(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, selectedIndex]);

  useEffect(() => {
    return () => {
      if (queryTimer.current) clearTimeout(queryTimer.current);
    };
  }, []);

  const close = useCallback(() => setOpen(false), []);

  const selectIndex = (idx: number) => {
    const opt = options[idx];
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    btnRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlight((h) => moveSelectHighlight(h, e.key, options.length));
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (highlight >= 0) selectIndex(highlight);
      return;
    }
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const nextQ = queryRef.current + e.key;
      queryRef.current = nextQ;
      if (queryTimer.current) clearTimeout(queryTimer.current);
      queryTimer.current = setTimeout(() => {
        queryRef.current = '';
      }, 500);
      const idx = findSelectOptionByQuery(options, nextQ, highlight);
      if (idx >= 0) {
        if (!open) setOpen(true);
        setHighlight(idx);
      }
    }
  };

  return (
    <div className="relative w-full min-w-0" onKeyDown={onKeyDown}>
      {name ? <input type="hidden" name={name} value={value} required={required} /> : null}
      <button
        ref={btnRef}
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-required={required || undefined}
        data-testid={testId}
        onClick={() => {
          if (!disabled) setOpen((o) => !o);
        }}
        className={`inline-flex w-full items-center justify-between gap-1.5 text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#1e3a6e]/25 ${
          className || 'px-2.5 py-1.5 rounded border border-slate-300 bg-white text-xs text-slate-800'
        }`}
      >
        <span className={`truncate ${selected ? '' : 'text-slate-400'}`}>
          {selected?.label || placeholder}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 text-slate-500 transition ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      <FixedPortalMenu
        open={open}
        onClose={close}
        anchorRef={btnRef}
        align="stretch"
        lockWidth
        estimatedHeight={Math.min(320, 12 + options.length * 34)}
        testId={testId ? `${testId}-menu` : undefined}
        role="presentation"
        className="rounded-md border border-slate-200 bg-white shadow-lg py-1"
      >
        <ul id={listId} role="listbox" aria-label={ariaLabel || placeholder} className="m-0 p-0 list-none">
          {options.map((opt, idx) => {
            const isSelected = opt.value === value;
            const isHi = idx === highlight;
            return (
              <li
                key={opt.value !== '' ? opt.value : `empty-${idx}`}
                role="option"
                aria-selected={isSelected}
                aria-disabled={opt.disabled || undefined}
              >
                <button
                  type="button"
                  disabled={opt.disabled}
                  onMouseEnter={() => setHighlight(idx)}
                  onClick={() => selectIndex(idx)}
                  className={`w-full px-3 py-1.5 text-left text-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                    isSelected
                      ? 'bg-[#e8eef6] text-[#1e3a6e] font-semibold'
                      : isHi
                        ? 'bg-slate-50 text-slate-800'
                        : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="block truncate">{opt.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </FixedPortalMenu>
    </div>
  );
}

export default AppSelect;
