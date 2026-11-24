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
import { AppSelect } from './AppSelect';

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
    <AppSelect
      value={resolveProposalLayoutKind(value || undefined)}
      onChange={(v) => onChange(resolveProposalLayoutKind(v))}
      className={className || PROPOSAL_SHEET_COMMON_TW.templateSelect}
      ariaLabel="Modelo do documento"
      options={PROPOSAL_TEMPLATE_STYLE_OPTIONS.map((opt) => ({
        value: opt.id,
        label: `Modelo: ${opt.shortLabel}`,
      }))}
    />
  );
}

export default ProposalTemplateSelect;
