'use client';

import React, { useEffect, useState } from 'react';
import { FileText, Home, ChevronRight, Save } from 'lucide-react';
import {
  PROPOSAL_NOTE_DEFAULT_TYPE_KEYS,
  PROPOSAL_NOTE_DEFAULT_TYPE_LABELS,
  seedProposalNoteDefaults,
  type ProposalNoteDefaultTypeKey,
  type ProposalNoteDefaultsMap,
} from '../lib/proposal-note-defaults';

const NAVY = '#1e3a6e';

export default function ProposalNoteDefaultsPage({
  onShowToast,
}: {
  onShowToast?: (msg: string) => void;
}) {
  const [values, setValues] = useState<ProposalNoteDefaultsMap>(seedProposalNoteDefaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/erp/proposal-note-defaults')
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j?.data) setValues({ ...seedProposalNoteDefaults(), ...j.data });
      })
      .catch(() => {
        if (alive) onShowToast?.('Não foi possível carregar as observações padrão.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [onShowToast]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/erp/proposal-note-defaults', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: values }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        onShowToast?.(j?.error || 'Não foi possível salvar as observações padrão.');
        return;
      }
      if (j?.data) setValues({ ...seedProposalNoteDefaults(), ...j.data });
      onShowToast?.('Observações padrão salvas.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 text-xs" data-testid="proposal-note-defaults-page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg text-slate-800">
          <FileText className="w-5 h-5" style={{ color: NAVY }} />
          <span className="font-semibold">Observações da proposta</span>
        </h2>
        <nav aria-label="breadcrumb" className="flex items-center gap-1 text-[11px] text-slate-500">
          <Home className="w-3.5 h-3.5" />
          <span>Início</span>
          <ChevronRight className="w-3 h-3" />
          <span className="font-semibold text-slate-800">Observações da proposta</span>
        </nav>
      </div>

      <p className="text-slate-600">
        Textos padrão do campo Observações Comerciais &amp; Fiscais (sai no PDF), usados ao criar um orçamento
        novo. Cada proposta pode alterar o texto depois. Orçamentos já gravados não mudam.
      </p>

      <div className="bg-white rounded-md border border-slate-200 divide-y divide-slate-100">
        {PROPOSAL_NOTE_DEFAULT_TYPE_KEYS.map((key: ProposalNoteDefaultTypeKey) => (
          <div key={key} className="p-4 space-y-1.5">
            <label className="block text-[11px] font-semibold text-slate-700" htmlFor={`note-default-${key}`}>
              {PROPOSAL_NOTE_DEFAULT_TYPE_LABELS[key]}
            </label>
            <textarea
              id={`note-default-${key}`}
              rows={4}
              disabled={loading || saving}
              value={values[key]}
              onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
              className="w-full px-3 py-2 rounded border border-slate-300 text-slate-900"
            />
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void save()}
          disabled={loading || saving}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
          style={{ backgroundColor: NAVY }}
        >
          <Save className="w-3.5 h-3.5" />
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  );
}
