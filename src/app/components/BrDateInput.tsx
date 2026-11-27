'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { Calendar } from 'lucide-react';
import {
  BR_MONTHS,
  BR_WEEKDAYS,
  brDateToIso,
  brMonthGrid,
  isoToBrDate,
  isoYearMonth,
  maskBrDateInput,
} from '../lib/br-date';
import { FixedPortalMenu } from './FixedPortalMenu';

type BrDateInputProps = {
  value: string;
  onChange: (iso: string) => void;
  id?: string;
  required?: boolean;
  className?: string;
  testId?: string;
  ariaLabel?: string;
};

export function BrDateInput({
  value,
  onChange,
  id,
  required,
  className,
  testId,
  ariaLabel,
}: BrDateInputProps) {
  const [text, setText] = useState(() => isoToBrDate(value));
  const [open, setOpen] = useState(false);
  const focused = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const cursor = isoYearMonth(value);
  const [year, setYear] = useState(cursor.year);
  const [month, setMonth] = useState(cursor.month);

  useEffect(() => {
    if (!focused.current) setText(isoToBrDate(value));
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const next = isoYearMonth(value);
    setYear(next.year);
    setMonth(next.month);
  }, [open, value]);

  const shiftMonth = (delta: number) => {
    const next = new Date(Date.UTC(year, month - 1 + delta, 1));
    setYear(next.getUTCFullYear());
    setMonth(next.getUTCMonth() + 1);
  };

  const calendar = (
    <div id={listId} data-testid={testId ? `${testId}-calendar` : 'br-date-calendar'}>
      <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-[#1e3a6e]">
        <button type="button" className="px-1 cursor-pointer" onClick={() => shiftMonth(-1)} aria-label="Mês anterior">
          ‹
        </button>
        <span className="capitalize">
          {BR_MONTHS[month - 1]} {year}
        </span>
        <button type="button" className="px-1 cursor-pointer" onClick={() => shiftMonth(1)} aria-label="Próximo mês">
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-slate-500">
        {BR_WEEKDAYS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-0.5">
        {brMonthGrid(year, month).map((cell, index) =>
          cell ? (
            <button
              key={cell.iso}
              type="button"
              onClick={() => {
                onChange(cell.iso);
                setText(isoToBrDate(cell.iso));
                setOpen(false);
              }}
              className={`h-6 rounded text-[11px] cursor-pointer ${
                cell.iso === String(value || '').slice(0, 10)
                  ? 'bg-[#1e3a6e] text-white'
                  : 'text-slate-800 hover:bg-slate-100'
              }`}
            >
              {cell.day}
            </button>
          ) : (
            <span key={`empty-${index}`} />
          )
        )}
      </div>
    </div>
  );

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center gap-1">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          required={required}
          placeholder="dd/mm/aaaa"
          aria-label={ariaLabel || 'Data no formato dd/mm/aaaa'}
          data-testid={testId}
          maxLength={10}
          value={text}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            const iso = brDateToIso(text);
            if (iso) {
              onChange(iso);
              setText(isoToBrDate(iso));
              return;
            }
            if (!text.trim()) {
              onChange('');
              setText('');
              return;
            }
            setText(isoToBrDate(value));
          }}
          onChange={(e) => {
            const masked = maskBrDateInput(e.target.value);
            setText(masked);
            const iso = brDateToIso(masked);
            if (iso) onChange(iso);
            else if (!masked) onChange('');
          }}
          className={className || 'w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white'}
        />
        <button
          type="button"
          aria-label="Abrir calendário"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((current) => !current)}
          className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded border border-slate-300 bg-white text-[#1e3a6e] cursor-pointer"
        >
          <Calendar className="w-3.5 h-3.5" />
        </button>
      </div>
      <FixedPortalMenu
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={rootRef}
        width={224}
        estimatedHeight={260}
        align="stretch"
        lockWidth
        role="dialog"
        className="p-2"
      >
        {calendar}
      </FixedPortalMenu>
    </div>
  );
}
