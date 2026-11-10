// Normaliza destinatários de fatura do contrato (textarea do modal e PATCH/POST).
// Aceita lista ou texto com vírgula, ponto e vírgula ou quebra de linha; valida e remove duplicatas.

const EMAIL_RE =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

function tokensFrom(raw: string): string[] {
  return raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
}

/** Lista canônica (minúsculas, válidas, sem duplicatas). Valor inválido ou vazio vira []. */
export function parseBillingRecipientEmails(input: unknown): string[] {
  const tokens: string[] = [];
  if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === 'string') tokens.push(...tokensFrom(item));
    }
  } else if (typeof input === 'string') {
    tokens.push(...tokensFrom(input));
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokens) {
    const email = token.toLowerCase();
    if (!EMAIL_RE.test(email) || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

/** Texto para o textarea ao abrir o modal (aceita lista ou string legada). */
export function billingRecipientEmailsText(input: unknown): string {
  if (Array.isArray(input)) {
    return input.filter((s): s is string => typeof s === 'string' && s.trim() !== '').join(', ');
  }
  if (typeof input === 'string') return input;
  return '';
}
