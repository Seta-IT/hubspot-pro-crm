/** Opções do select Transportadora (rótulo novo; value canônico já gravado). */
export const PROPOSAL_SHIPPING_CARRIER_OPTIONS = [
  { value: 'Frota Própria Seta Telecom', label: 'Frota Próprio' },
  { value: 'Correios / SEDEX', label: 'Correios' },
  { value: 'Transportadora Braspress', label: 'Transportadora' },
] as const;

export type ProposalShippingCarrierKey = 'frota' | 'correios' | 'transportadora' | 'none' | 'other';

export function classifyShippingCarrier(raw: unknown): ProposalShippingCarrierKey {
  const s = String(raw || '').trim();
  if (!s) return 'none';
  if (/sem\s*frete/i.test(s) || /digital\s*\/\s*remoto/i.test(s) || /ativa[cç][aã]o\s+remota/i.test(s)) {
    return 'none';
  }
  if (/frota\s+pr[oó]pri/i.test(s)) return 'frota';
  if (/sedex/i.test(s) || /^correios\b/i.test(s)) return 'correios';
  if (/braspress/i.test(s) || /^transportadora$/i.test(s)) return 'transportadora';
  return 'other';
}

/** Rótulo na tela, no PDF e no e-mail. Não altera o valor gravado. "Sem Frete" aparece vazio. */
export function displayShippingCarrier(raw: unknown): string {
  const key = classifyShippingCarrier(raw);
  if (key === 'none') return '';
  if (key === 'frota') return 'Frota Próprio';
  if (key === 'correios') return 'Correios';
  if (key === 'transportadora') return 'Transportadora';
  return String(raw || '').trim();
}

/** Value do select (canônico antigo) para não regravar o dado ao só abrir o formulário. */
export function shippingCarrierSelectValue(raw: unknown): string {
  const key = classifyShippingCarrier(raw);
  if (key === 'frota') return 'Frota Própria Seta Telecom';
  if (key === 'correios') return 'Correios / SEDEX';
  if (key === 'transportadora') return 'Transportadora Braspress';
  return '';
}
