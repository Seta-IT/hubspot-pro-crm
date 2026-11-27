'use client';

/**
 * Painel lateral (estilo HubSpot) com a lista completa dos registros já
 * associados. Aberto por "Exibir todos os … associados" nos cartões da ficha.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';

export type AssociatedListItem = {
  id: string;
  searchText: string;
  content: React.ReactNode;
};

export default function AssociatedRecordsListPanel({
  title,
  countLabel,
  testId,
  items,
  searchPlaceholder = 'Buscar',
  onClose,
}: {
  title: string;
  countLabel: string;
  testId: string;
  items: AssociatedListItem[];
  searchPlaceholder?: string;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const n = q.trim().toLocaleLowerCase('pt-BR');
    if (!n) return items;
    return items.filter((it) => it.searchText.toLocaleLowerCase('pt-BR').includes(n));
  }, [items, q]);

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-900/30 flex justify-end"
      data-testid={testId}
      data-assoc-view-all="1"
      onClick={onClose}
    >
      <aside
        role="dialog"
        aria-label={title}
        className="h-full w-full max-w-[560px] bg-white shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 bg-[#0b6b7a] text-white flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="p-1 rounded hover:bg-white/15 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </header>
        <div className="px-5 py-3 border-b border-slate-200 space-y-2">
          <label className="relative block">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={searchPlaceholder}
              data-testid={`${testId}-search`}
              className="w-full pl-3 pr-9 py-2 rounded-md border border-slate-300 text-sm focus:outline-none focus:border-[#0b6b7a]"
            />
            <Search className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2" />
          </label>
          <div className="text-xs font-semibold text-slate-800" data-testid={`${testId}-count`}>
            {countLabel}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {filtered.length === 0 ? (
            <p className="text-xs font-semibold text-slate-400">Nenhum registro encontrado.</p>
          ) : (
            filtered.map((it) => (
              <div key={it.id} className="rounded-md border border-slate-200 p-3">
                {it.content}
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
