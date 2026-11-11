/** Destinatários do compositor de e-mail: etiquetas, validação e ordenação da busca. */

import { validateEmail } from '../data-health/validators';
import { MAX_EMAIL_RECIPIENTS } from './send-email-guards';

export type EmailRecipientChip = {
  email: string;
  name?: string;
  invalid: boolean;
};

export type RecipientSuggestionSource = 'company_contact' | 'contact' | 'internal';

export type RecipientSuggestion = {
  email: string;
  name: string;
  source: RecipientSuggestionSource;
  companyName: string | null;
};

export const RECIPIENT_SEARCH_MAX_LENGTH = 80;

const SOURCE_RANK: Record<RecipientSuggestionSource, number> = {
  company_contact: 0,
  contact: 1,
  internal: 2,
};

export function toRecipientChip(raw: string, name?: string): EmailRecipientChip {
  const trimmed = String(raw || '').trim();
  const check = validateEmail(trimmed);
  return {
    email: check.isValid ? check.normalizedEmail : trimmed,
    name: name?.trim() || undefined,
    invalid: !check.isValid,
  };
}

/** Parte o texto em endereços concluídos (vírgula, ponto e vírgula ou quebra de linha). */
export function tokenizeRecipientInput(raw: string): { completed: string[]; rest: string } {
  const text = String(raw || '');
  if (!text) return { completed: [], rest: '' };
  const parts = text.split(/[,;\n]+/);
  const endsWithDelimiter = /[,;\n]\s*$/.test(text);
  if (parts.length === 1 && !endsWithDelimiter) {
    return { completed: [], rest: text };
  }
  const completed = parts.map((p) => p.trim()).filter(Boolean);
  if (endsWithDelimiter) {
    return { completed, rest: '' };
  }
  const rest = completed.pop() || '';
  return { completed, rest };
}

export function parseRecipientList(raw: string | undefined | null): EmailRecipientChip[] {
  if (raw == null || raw === '') return [];
  const { completed, rest } = tokenizeRecipientInput(String(raw).endsWith(',') ? String(raw) : `${raw},`);
  const tokens = rest ? [...completed, rest] : completed;
  return tokens.map((token) => toRecipientChip(token));
}

export function joinRecipientList(chips: EmailRecipientChip[]): string {
  return chips.map((c) => c.email.trim()).filter(Boolean).join(', ');
}

export function addRecipientChips(
  existing: EmailRecipientChip[],
  incoming: Array<string | EmailRecipientChip>,
  opts?: { otherCount?: number; max?: number }
): { chips: EmailRecipientChip[]; limitReached: boolean } {
  const max = opts?.max ?? MAX_EMAIL_RECIPIENTS;
  const otherCount = opts?.otherCount ?? 0;
  const chips = [...existing];
  const seen = new Set(chips.map((c) => c.email.trim().toLowerCase()).filter(Boolean));
  let limitReached = otherCount + chips.length >= max;
  for (const item of incoming) {
    if (otherCount + chips.length >= max) {
      limitReached = true;
      break;
    }
    const chip = typeof item === 'string' ? toRecipientChip(item) : item;
    const key = chip.email.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    chips.push(chip);
  }
  if (otherCount + chips.length >= max) limitReached = true;
  return { chips, limitReached };
}

export function rankRecipientSuggestions(items: RecipientSuggestion[]): RecipientSuggestion[] {
  return [...items].sort((a, b) => {
    const bySource = SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
    if (bySource !== 0) return bySource;
    const byName = a.name.localeCompare(b.name, 'pt-BR');
    if (byName !== 0) return byName;
    return a.email.localeCompare(b.email, 'pt-BR');
  });
}

export function toPublicRecipientSuggestion(row: RecipientSuggestion): RecipientSuggestion {
  return {
    email: String(row.email || '').trim().toLowerCase(),
    name: String(row.name || '').trim(),
    source: row.source,
    companyName: row.companyName ? String(row.companyName) : null,
  };
}

export { MAX_EMAIL_RECIPIENTS };
