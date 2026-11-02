'use client';

// Seletor de modelo da folha A4 — o MESMO da proposta (/proposta/[id]), reaproveitado no
// Recibo/Fatura de Locação (prévia e rascunho). Modelos e padrão vêm de proposal-share.
import React from 'react';
import {
  PROPOSAL_TEMPLATE_STYLE_OPTIONS,
  resolveProposalLayoutKind,
  type ProposalLightTemplateId,
} from '../lib/proposal-share';
import { PROPOSAL_SHEET_COMMON_TW } from '../lib/proposal-sheet-theme';

export function ProposalTemplateSelect({
  value,
  onChange,
  className,
}: {
  value?: string | null;
  onChange: (id: ProposalLightTemplateId) => void;
  className?: string;
}) {
  return (
    <select
      value={resolveProposalLayoutKind(value || undefined)}
      onChange={(e) => onChange(resolveProposalLayoutKind(e.target.value))}
      className={className || PROPOSAL_SHEET_COMMON_TW.templateSelect}
      title="Escolher Template / Layout do Documento A4"
      aria-label="Modelo do documento"
    >
      {PROPOSAL_TEMPLATE_STYLE_OPTIONS.map((opt) => (
        <option key={opt.id} value={opt.id} className="text-slate-900">
          Modelo: {opt.shortLabel}
        </option>
      ))}
    </select>
  );
}

export default ProposalTemplateSelect;
