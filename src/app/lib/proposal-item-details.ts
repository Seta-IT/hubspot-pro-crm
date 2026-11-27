/**
 * A coluna Detalhes não mostra o NCM gravado automaticamente.
 * O NCM continua em ncmOrServiceCode para o fiscal. O texto digitado fica em lineDetails.
 * Proposta antiga sem lineDetails: esconde só o texto que dá para reconhecer como NCM/LC 116.
 */

const AUTOMATIC_NCM = /^NCM\s+\d{4}\.\d{2}\.\d{2}(?:\b|[\s(]|$)/i;
const AUTOMATIC_LC116 = /^LC\s*116\s*\/\s*03\s+Item\s+\d{2}\.\d{2}\b/i;
const BARE_NCM = /^\d{4}\.\d{2}\.\d{2}$/;

export function isAutomaticFiscalDetail(value: string | null | undefined): boolean {
  const text = String(value || '').trim();
  if (!text) return false;
  return AUTOMATIC_NCM.test(text) || AUTOMATIC_LC116.test(text) || BARE_NCM.test(text);
}

export function proposalLineDetailsText(item: {
  lineDetails?: string | null;
  ncmOrServiceCode?: string | null;
}): string {
  if (typeof item.lineDetails === 'string') return item.lineDetails;
  const stored = String(item.ncmOrServiceCode || '').trim();
  return isAutomaticFiscalDetail(stored) ? '' : stored;
}

/** Texto digitado que estava no campo antigo, para não perdê-lo quando o NCM fiscal é trocado. */
export function keptUserLineDetails(item: {
  lineDetails?: string | null;
  ncmOrServiceCode?: string | null;
}): string | undefined {
  if (typeof item.lineDetails === 'string') return item.lineDetails;
  const stored = String(item.ncmOrServiceCode || '').trim();
  if (!stored || isAutomaticFiscalDetail(stored)) return undefined;
  return stored;
}
