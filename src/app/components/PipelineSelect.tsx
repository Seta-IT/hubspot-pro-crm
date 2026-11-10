'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { formatPipelineDisplayName } from '../lib/pipeline-display';

export interface PipelineSelectProps {
  pipelines: { id: string; name: string }[];
  counts: Record<string, number>;
  selectedId: string;
  onChange: (pipelineId: string) => void;
  /** Classe extra no botão (ex.: largura mínima). */
  className?: string;
}

/**
 * Lista suspensa compacta de pipeline (padrão HubSpot):
 * fundo branco, contorno neutro, nome sem "Pipeline N:" e contagem em cinza.
 */
export default function PipelineSelect({
  pipelines,
  counts,
  selectedId,
  onChange,
  className = '',
}: PipelineSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const selected =
    pipelines.find((p) => p.id === selectedId) || pipelines[0] || null;
  const selectedLabel = formatPipelineDisplayName(selected?.name);
  const selectedCount = selected ? counts[selected.id] || 0 : 0;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    }
  };

  return (
    <div
      ref={rootRef}
      className={`relative inline-block ${className}`}
      onKeyDown={onKeyDown}
      data-testid="pipeline-select"
    >
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`Pipeline: ${selectedLabel}`}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 max-w-[min(100vw-2rem,360px)] px-3 py-1.5 rounded-[4px] border border-[#cbd6e2] bg-white text-xs font-semibold text-slate-800 hover:border-[color:var(--sti-accent,#ff7a59)] focus:outline-none focus:ring-2 focus:ring-[color:var(--sti-accent,#ff7a59)]/40 cursor-pointer"
      >
        <span className="truncate font-semibold">{selectedLabel || 'Pipeline'}</span>
        <span className="shrink-0 text-slate-500 font-semibold tabular-nums">{selectedCount}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-500 shrink-0 transition ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Pipelines"
          className="absolute left-0 z-40 mt-1 min-w-full w-max max-w-[min(100vw-2rem,420px)] rounded-[6px] border border-[#cbd6e2] bg-white shadow-lg py-1"
        >
          {pipelines.map((p) => {
            const isSelected = p.id === (selected?.id || selectedId);
            const label = formatPipelineDisplayName(p.name);
            const count = counts[p.id] || 0;
            return (
              <li key={p.id} role="option" aria-selected={isSelected}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(p.id);
                    setOpen(false);
                    btnRef.current?.focus();
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs cursor-pointer select-none ${
                    isSelected
                      ? 'bg-[#fff4f0] text-slate-900'
                      : 'text-slate-700 hover:bg-[#f5f8fa]'
                  }`}
                >
                  <span
                    className={`w-4 h-4 shrink-0 flex items-center justify-center ${
                      isSelected ? 'text-[color:var(--sti-accent,#ff7a59)]' : 'text-transparent'
                    }`}
                    aria-hidden
                  >
                    <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                  </span>
                  <span className="flex-1 truncate font-semibold">{label}</span>
                  <span className="shrink-0 text-slate-500 font-semibold tabular-nums">{count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
