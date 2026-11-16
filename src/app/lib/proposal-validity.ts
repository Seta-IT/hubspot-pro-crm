// ============================================================================
// STI-hub — Validade comercial da proposta (modulo puro, usado no servidor e
// na pagina publica). Fim do dia em Brasilia (-03:00), sem crypto/Node.
// ============================================================================

/**
 * Fim do dia de validUntil (YYYY-MM-DD) no fuso de Brasilia (23:59:59.999 -03:00).
 * Valor ausente/invalido => null.
 */
export function proposalValidUntilEndMs(validUntil: unknown): number | null {
  const s = String(validUntil || '').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T23:59:59.999-03:00`);
  return Number.isFinite(ms) ? ms : null;
}

/** A validade comercial ja passou (depois do fim do dia de validUntil em Brasilia). */
export function isProposalValidityExpired(validUntil: unknown, nowMs = Date.now()): boolean {
  const end = proposalValidUntilEndMs(validUntil);
  return end !== null && end < nowMs;
}

/** Teto do token do link: fim de validUntil somente se ainda estiver no futuro. */
export function proposalLinkNotAfterMs(validUntil: unknown, nowMs = Date.now()): number | null {
  const end = proposalValidUntilEndMs(validUntil);
  return end !== null && end > nowMs ? end : null;
}

/** Data de validade em pt-BR (DD/MM/AAAA), ou null se ausente/invalida. */
export function formatProposalValidUntilPtBr(validUntil: unknown): string | null {
  const s = String(validUntil || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s || null;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export const PROPOSAL_EXPIRED_REVALIDATION_MESSAGE =
  'Esta proposta está vencida e precisa ser revalidada. Fale com seu consultor Seta Telecom.';

export function proposalExpiredRevalidationMessage(validUntil: unknown): string {
  const when = formatProposalValidUntilPtBr(validUntil);
  if (!when) return PROPOSAL_EXPIRED_REVALIDATION_MESSAGE;
  return `Esta proposta está vencida desde ${when} e precisa ser revalidada. Fale com seu consultor Seta Telecom.`;
}
