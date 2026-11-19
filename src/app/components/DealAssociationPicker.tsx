'use client';

import React from 'react';
import { X } from 'lucide-react';

export interface DealAssociationChoice {
  id: string;
  label: string;
  hint?: string;
}

export interface DealAssociationPickerProps {
  title: string;
  testId: string;
  query: string;
  onQuery: (value: string) => void;
  items: DealAssociationChoice[];
  emptyText: string;
  placeholder?: string;
  onSelect?: (id: string) => void;
  onClose: () => void;
  busy?: boolean;
  children?: React.ReactNode;
}

/**
 * Modal compacto de busca para associar registros ao negócio.
 * Usado no painel direito da ficha (contatos, empresas e formulários de criação).
 */
export default function DealAssociationPicker({
  title,
  testId,
  query,
  onQuery,
  items,
  emptyText,
  placeholder = 'Buscar…',
  onSelect,
  onClose,
  busy = false,
  children,
}: DealAssociationPickerProps) {
  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/40 flex items-center justify-center p-4"
      data-testid={testId}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-slate-500 hover:bg-slate-100 cursor-pointer"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {onSelect ? (
          <div className="p-3 border-b border-slate-100">
            <input
              autoFocus
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder={placeholder}
              data-testid={`${testId}-search`}
              className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 text-xs"
            />
          </div>
        ) : null}
        {onSelect ? (
          <ul className="max-h-64 overflow-y-auto py-1" role="listbox">
            {items.length === 0 ? (
              <li className="px-3 py-2 text-xs font-semibold text-slate-500">{emptyText}</li>
            ) : (
              items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onSelect(item.id)}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                  >
                    <div className="text-xs font-semibold text-slate-900">{item.label}</div>
                    {item.hint ? <div className="text-[11px] text-slate-500 font-semibold">{item.hint}</div> : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}
        {children ? <div className="p-3 space-y-2">{children}</div> : null}
      </div>
    </div>
  );
}
