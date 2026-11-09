// ============================================================================
// t126u: saudação do STI-HUB MAILER — "Olá, Nome," sem empresa entre parênteses.
// ============================================================================

export type ClientEmailGreetingInput = {
  recipientName?: string;
  companyName?: string;
};

/** Saudação sem nome da empresa: "Olá, Nome," ou só "Olá," se não houver pessoa. */
export function buildClientEmailGreeting(p: ClientEmailGreetingInput): string {
  const rawName = String(p.recipientName || '').trim();
  const company = String(p.companyName || '').trim();
  const nameIsPerson =
    rawName.length > 0 &&
    (!company || rawName.localeCompare(company, 'pt-BR', { sensitivity: 'accent' }) !== 0);
  return nameIsPerson ? `Olá, ${rawName},` : 'Olá,';
}
