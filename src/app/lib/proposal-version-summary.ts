/**
 * Hide the auto-generated "Versão inicial da Proposta Comercial #N" label
 * from user-facing version history. Stored version entries are left intact.
 */
const INITIAL_PROPOSAL_COMMERCIAL_SUMMARY =
  /^\s*Versão inicial da Proposta Comercial #/i;

export function displayProposalVersionSummary(text: unknown): string {
  const summary = String(text ?? "").trim();
  if (!summary || INITIAL_PROPOSAL_COMMERCIAL_SUMMARY.test(summary)) return "";
  return summary;
}
