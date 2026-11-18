/** Política única da lista de sugestões de destinatários (CRM e ERP). */

export type RecipientSuggestEvent = 'type' | 'select' | 'escape' | 'blur' | 'outside' | 'focus';

/** Abre só ao digitar; fecha ao escolher, Esc, clique fora ou perda de foco. */
export function nextRecipientSuggestionsOpen(
  open: boolean,
  event: RecipientSuggestEvent
): boolean {
  if (event === 'type') return true;
  if (event === 'focus') return open;
  return false;
}

export function excludeTakenRecipientSuggestions<T extends { email?: string | null }>(
  rows: T[],
  takenEmails: Iterable<string>
): T[] {
  const taken = new Set(
    Array.from(takenEmails, (email) => String(email || '').trim().toLowerCase()).filter(Boolean)
  );
  return rows.filter((row) => {
    const email = String(row.email || '').trim().toLowerCase();
    return Boolean(email) && !taken.has(email);
  });
}
