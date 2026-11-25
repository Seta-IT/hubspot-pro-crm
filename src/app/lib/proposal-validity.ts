import { addCalendarDays, calendarDaysBetween, localIsoDate, parseIsoDate } from './br-date';

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

export const DEFAULT_PROPOSAL_VALIDITY_DAYS = 15;

export function parseValidityDays(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  const n = parseInt(String(value ?? '').replace(/\D+/g, ''), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function formatValidityDaysLabel(days: number): string {
  return days === 1 ? '1 dia' : `${days} dias`;
}

export function proposalStartDate(
  input: { proposalDate?: unknown; createdAt?: unknown },
  today = localIsoDate()
): string {
  return parseIsoDate(input.proposalDate) || parseIsoDate(input.createdAt) || today;
}

/**
 * Validade "Até" = Data do orçamento + dias.
 * Se os dias não vierem e o intervalo gravado for inválido (ex.: Até antes da Data), usa 15 dias.
 */
export function resolveProposalValidity(
  input: {
    proposalDate?: unknown;
    createdAt?: unknown;
    validUntil?: unknown;
    validityDays?: unknown;
  },
  today = localIsoDate()
): { proposalDate: string; validUntil: string; days: number } {
  const proposalDate = proposalStartDate(input, today);
  const explicitDays = parseValidityDays(input.validityDays);
  const inferred = calendarDaysBetween(proposalDate, input.validUntil);
  const days =
    explicitDays ?? (inferred != null && inferred > 0 ? inferred : DEFAULT_PROPOSAL_VALIDITY_DAYS);
  return { proposalDate, validUntil: addCalendarDays(proposalDate, days), days };
}

/** Cópia: mesma janela da origem (se for > 0) a partir da data de hoje. */
export function recalculateProposalValidity(
  input: { proposalDate?: string; createdAt?: string; validUntil?: string },
  now = new Date()
): string {
  const today = localIsoDate(now);
  const start = proposalStartDate(input, today);
  const inferred = calendarDaysBetween(start, input.validUntil);
  const days = inferred != null && inferred > 0 ? inferred : DEFAULT_PROPOSAL_VALIDITY_DAYS;
  return addCalendarDays(today, days);
}

/**
 * Ao salvar: "Até" = Data + dias quando a janela é informada ou está invertida
 * (Até antes da Data). Se só veio validUntil (ex.: proposta já vencida, sem Data
 * explícita), preserva a data informada — não reescreve vencimento proposital.
 */
export function resolveProposalValidityForSave(
  input: {
    proposalDate?: unknown;
    createdAt?: unknown;
    validUntil?: unknown;
    validityDays?: unknown;
  },
  today = localIsoDate()
): { proposalDate: string; validUntil: string; days: number } {
  const explicitDays = parseValidityDays(input.validityDays);
  const explicitDate = parseIsoDate(input.proposalDate);
  const start = proposalStartDate(input, today);
  if (explicitDays) {
    return { proposalDate: start, validUntil: addCalendarDays(start, explicitDays), days: explicitDays };
  }
  const until = parseIsoDate(input.validUntil);
  if (until && explicitDate) {
    const inferred = calendarDaysBetween(explicitDate, until);
    if (inferred != null && inferred > 0) {
      return { proposalDate: explicitDate, validUntil: until, days: inferred };
    }
    return {
      proposalDate: explicitDate,
      validUntil: addCalendarDays(explicitDate, DEFAULT_PROPOSAL_VALIDITY_DAYS),
      days: DEFAULT_PROPOSAL_VALIDITY_DAYS,
    };
  }
  if (until) {
    const inferred = calendarDaysBetween(start, until);
    return {
      proposalDate: start,
      validUntil: until,
      days: inferred != null && inferred > 0 ? inferred : DEFAULT_PROPOSAL_VALIDITY_DAYS,
    };
  }
  return {
    proposalDate: start,
    validUntil: addCalendarDays(start, DEFAULT_PROPOSAL_VALIDITY_DAYS),
    days: DEFAULT_PROPOSAL_VALIDITY_DAYS,
  };
}

/** Validade efetiva para vencimento: validUntil, ou Data + dias se a janela estiver invertida/inválida. */
export function effectiveProposalValidUntil(
  input: {
    proposalDate?: unknown;
    createdAt?: unknown;
    validUntil?: unknown;
    validityDays?: unknown;
  }
): string | null {
  const until = parseIsoDate(input.validUntil);
  const date = parseIsoDate(input.proposalDate);
  if (until && date) {
    const inferred = calendarDaysBetween(date, until);
    if (inferred != null && inferred > 0) return until;
    const days = parseValidityDays(input.validityDays) ?? DEFAULT_PROPOSAL_VALIDITY_DAYS;
    return addCalendarDays(date, days);
  }
  return until;
}

export function isProposalEffectiveValidityExpired(
  input: {
    proposalDate?: unknown;
    createdAt?: unknown;
    validUntil?: unknown;
    validityDays?: unknown;
  },
  nowMs = Date.now()
): boolean {
  return isProposalValidityExpired(effectiveProposalValidUntil(input), nowMs);
}
