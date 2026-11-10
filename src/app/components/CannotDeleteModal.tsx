'use client';

import React from 'react';

export function CannotDeleteModal({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div
      data-testid="record-cannot-delete-modal"
      className="fixed inset-0 z-[1100] bg-slate-900/60 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="record-cannot-delete-title"
    >
      <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-sm w-full p-5 space-y-3">
        <h4 id="record-cannot-delete-title" className="text-sm font-semibold text-slate-900">
          Não é possível excluir
        </h4>
        <p className="text-xs text-slate-600 leading-relaxed">{text}</p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded border border-slate-300 bg-white text-slate-700 text-xs font-semibold cursor-pointer hover:bg-slate-50"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

export function deleteButtonProps(inUse: boolean): {
  title: string;
  'aria-label'?: string;
  'aria-disabled': boolean;
  classNameExtra: string;
} {
  return {
    title: inUse ? 'Em uso' : 'Excluir',
    'aria-disabled': inUse,
    classNameExtra: inUse
      ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed hover:bg-slate-50'
      : '',
  };
}
