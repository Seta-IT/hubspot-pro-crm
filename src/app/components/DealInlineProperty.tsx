'use client';

import React, { useEffect, useRef, useState } from 'react';

export type DealInlineKind = 'text' | 'textarea' | 'currency' | 'number' | 'date' | 'select';

export interface DealInlineOption {
  value: string;
  label: string;
}

export interface DealInlinePropertyProps {
  fieldKey: string;
  label: string;
  displayValue: string;
  editValue: string;
  kind?: DealInlineKind;
  options?: DealInlineOption[];
  readOnly?: boolean;
  system?: boolean;
  href?: string | null;
  tags?: string[];
  onSave?: (next: string) => Promise<void>;
}

export default function DealInlineProperty({
  fieldKey,
  label,
  displayValue,
  editValue,
  kind = 'text',
  options,
  readOnly = false,
  system = false,
  href,
  tags,
  onSave,
}: DealInlinePropertyProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(editValue);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(editValue);
  }, [editValue, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = async (value = draft) => {
    if (readOnly || !onSave) {
      setEditing(false);
      return;
    }
    if (value === editValue) {
      setEditing(false);
      setStatus('idle');
      setError(null);
      return;
    }
    setStatus('saving');
    setError(null);
    try {
      await onSave(value);
      setStatus('saved');
      setEditing(false);
      window.setTimeout(() => {
        setStatus((current) => (current === 'saved' ? 'idle' : current));
      }, 1600);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    }
  };

  const cancel = () => {
    setDraft(editValue);
    setError(null);
    setStatus('idle');
    setEditing(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
      return;
    }
    if (e.key === 'Enter' && kind !== 'textarea') {
      e.preventDefault();
      void commit();
    }
    if (e.key === 'Enter' && kind === 'textarea' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void commit();
    }
  };

  const feedback =
    status === 'saving' ? (
      <span className="text-[10px] font-semibold text-slate-400">Salvando...</span>
    ) : status === 'saved' ? (
      <span className="text-[10px] font-semibold text-emerald-700">Salvo</span>
    ) : status === 'error' && error ? (
      <span className="text-[10px] font-semibold text-rose-700" role="alert">
        {error}
      </span>
    ) : null;

  const valueClass = system
    ? 'text-xs text-slate-600 break-words whitespace-pre-wrap'
    : 'text-xs font-semibold text-slate-800 break-words whitespace-pre-wrap';

  return (
    <div className="space-y-0.5" data-testid={`deal-inline-${fieldKey}`} data-readonly={readOnly || system ? 'true' : 'false'}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold text-slate-400">{label}</div>
        {feedback}
      </div>
      {editing && !readOnly && !system ? (
        kind === 'select' ? (
          <select
            ref={inputRef as React.RefObject<HTMLSelectElement>}
            value={draft}
            onChange={(e) => {
              const next = e.target.value;
              setDraft(next);
              void commit(next);
            }}
            onBlur={() => {
              if (status !== 'saving') void commit();
            }}
            onKeyDown={onKeyDown}
            className="w-full px-2 py-1 rounded-md border border-accent bg-white text-xs text-slate-800"
          >
            {(options || []).map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : kind === 'textarea' ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={onKeyDown}
            rows={3}
            className="w-full px-2 py-1 rounded-md border border-accent bg-white text-xs text-slate-800 resize-y"
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type={kind === 'date' ? 'date' : kind === 'number' ? 'number' : 'text'}
            inputMode={kind === 'currency' || kind === 'number' ? 'decimal' : undefined}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={onKeyDown}
            className="w-full px-2 py-1 rounded-md border border-accent bg-white text-xs font-semibold text-slate-800"
          />
        )
      ) : href && displayValue !== '--' ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:underline break-all"
        >
          <span className="break-all">{displayValue}</span>
        </a>
      ) : tags && tags.length > 0 && (readOnly || system) ? (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-[11px] font-semibold text-slate-700 border border-slate-200"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : readOnly || system ? (
        <div className={valueClass}>{displayValue}</div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(editValue);
            setEditing(true);
            setError(null);
            setStatus('idle');
          }}
          className="w-full text-left rounded px-1 -mx-1 py-0.5 hover:bg-slate-50 cursor-text"
        >
          {tags && tags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-[11px] font-semibold text-slate-700 border border-slate-200"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : (
            <div className={valueClass}>{displayValue}</div>
          )}
        </button>
      )}
    </div>
  );
}
