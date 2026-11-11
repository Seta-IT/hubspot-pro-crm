'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  MAX_EMAIL_RECIPIENTS,
  addRecipientChips,
  toRecipientChip,
  tokenizeRecipientInput,
  type EmailRecipientChip,
  type RecipientSuggestion,
} from '../../../modules/erp/email-recipients';

const SOURCE_LABEL: Record<RecipientSuggestion['source'], string> = {
  company_contact: 'Cliente',
  contact: 'Contato',
  internal: 'Interno',
};

export default function EmailRecipientField({
  label,
  testId,
  chips,
  onChange,
  companyId,
  siblingCount,
  maxTotal = MAX_EMAIL_RECIPIENTS,
  placeholder = 'Adicionar e-mail',
}: {
  label: string;
  testId?: string;
  chips: EmailRecipientChip[];
  onChange: (next: EmailRecipientChip[]) => void;
  companyId?: string | null;
  siblingCount: number;
  maxTotal?: number;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [suggestions, setSuggestions] = useState<RecipientSuggestion[]>([]);
  const [limitMsg, setLimitMsg] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const remaining = Math.max(0, maxTotal - siblingCount - chips.length);
  const atLimit = remaining <= 0;

  useEffect(() => {
    const onDoc = (ev: MouseEvent) => {
      if (!rootRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    if (!open) return;
    const q = draft.trim();
    let active = true;
    const handle = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (companyId) params.set('companyId', companyId);
      fetch(`/api/communications/recipients?${params.toString()}`, { credentials: 'same-origin', cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (!active) return;
          const rows = Array.isArray(json?.data) ? (json.data as RecipientSuggestion[]) : [];
          const taken = new Set(chips.map((c) => c.email.toLowerCase()));
          setSuggestions(rows.filter((row) => row.email && !taken.has(row.email.toLowerCase())));
          setHighlight(0);
        })
        .catch(() => {
          if (active) setSuggestions([]);
        });
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(handle);
    };
  }, [open, draft, companyId, chips]);

  const visibleSuggestions = useMemo(() => suggestions.slice(0, 12), [suggestions]);

  const commitTokens = (raw: string, fromEnter = false) => {
    const { completed, rest } = tokenizeRecipientInput(fromEnter && raw.trim() ? `${raw},` : raw);
    if (!completed.length) {
      setDraft(raw);
      return;
    }
    const next = addRecipientChips(chips, completed, { otherCount: siblingCount, max: maxTotal });
    onChange(next.chips);
    setDraft(rest);
    setLimitMsg(next.limitReached && completed.length > 0 && next.chips.length === chips.length);
    if (next.chips.length > chips.length) setSuggestions([]);
  };

  const pickSuggestion = (row: RecipientSuggestion) => {
    const next = addRecipientChips(chips, [toRecipientChip(row.email, row.name)], {
      otherCount: siblingCount,
      max: maxTotal,
    });
    onChange(next.chips);
    setDraft('');
    setSuggestions([]);
    setLimitMsg(next.limitReached && next.chips.length === chips.length);
    inputRef.current?.focus();
  };

  const removeChip = (index: number) => {
    onChange(chips.filter((_, i) => i !== index));
    setLimitMsg(false);
    inputRef.current?.focus();
  };

  return (
    <div ref={rootRef} className="relative" data-testid={testId}>
      <div className="flex items-start gap-2 border-b border-slate-200 py-1.5 min-h-[36px]">
        <span className="w-16 shrink-0 pt-1 text-xs font-semibold text-slate-500">{label}</span>
        <div
          className="flex-1 flex flex-wrap items-center gap-1"
          onClick={() => inputRef.current?.focus()}
        >
          {chips.map((chip, index) => (
            <span
              key={`${chip.email}-${index}`}
              data-testid={`${testId || 'recipient'}-chip`}
              className={`inline-flex items-center gap-1 max-w-full pl-2 pr-1 py-0.5 rounded-full border text-[11px] font-semibold ${
                chip.invalid
                  ? 'bg-red-50 border-red-300 text-red-800'
                  : 'bg-slate-100 border-slate-200 text-slate-800'
              }`}
              title={chip.invalid ? 'E-mail inválido' : chip.email}
            >
              <span className="truncate">
                {chip.name ? `${chip.name} · ${chip.email}` : chip.email}
              </span>
              <button
                type="button"
                aria-label={`Remover ${chip.email}`}
                onClick={() => removeChip(index)}
                className="p-0.5 rounded-full hover:bg-white/80 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            type="text"
            value={draft}
            disabled={atLimit}
            placeholder={chips.length ? '' : placeholder}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setOpen(true);
              commitTokens(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlight((n) => Math.min(n + 1, Math.max(visibleSuggestions.length - 1, 0)));
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlight((n) => Math.max(n - 1, 0));
                return;
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                if (open && visibleSuggestions[highlight]) {
                  pickSuggestion(visibleSuggestions[highlight]);
                  return;
                }
                if (draft.trim()) commitTokens(draft, true);
                return;
              }
              if (e.key === 'Escape') {
                setOpen(false);
                return;
              }
              if (e.key === 'Backspace' && !draft && chips.length) {
                removeChip(chips.length - 1);
              }
            }}
            className="flex-1 min-w-[160px] outline-none bg-transparent text-xs text-slate-900 py-1 font-semibold placeholder:font-semibold placeholder:text-slate-400"
          />
        </div>
      </div>
      {limitMsg || atLimit ? (
        <p className="pl-[4.5rem] pt-1 text-[11px] font-semibold text-slate-500">
          Limite de {maxTotal} destinatários.
        </p>
      ) : null}
      {open && visibleSuggestions.length > 0 && (
        <ul
          role="listbox"
          data-testid={`${testId || 'recipient'}-suggestions`}
          className="absolute left-16 right-0 z-20 mt-1 max-h-56 overflow-auto rounded-md border border-slate-200 bg-white shadow-lg"
        >
          {visibleSuggestions.map((row, index) => (
            <li key={`${row.source}-${row.email}`}>
              <button
                type="button"
                role="option"
                aria-selected={index === highlight}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickSuggestion(row);
                }}
                className={`w-full text-left px-3 py-2 cursor-pointer ${
                  index === highlight ? 'bg-slate-50' : 'bg-white'
                }`}
              >
                <span className="block text-xs font-semibold text-slate-900 truncate">{row.name || row.email}</span>
                <span className="flex items-center gap-2 text-[11px] text-slate-500">
                  <span className="truncate">{row.email}</span>
                  <span className="shrink-0 font-semibold text-slate-400">{SOURCE_LABEL[row.source]}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
