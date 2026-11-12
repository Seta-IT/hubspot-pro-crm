// ============================================================================
// Busca de chamados: haystack e mascara de CNPJ / numero de conta.
// Aplica-se aos dados reais carregados pelo bootstrap (empresa.cnpj e
// assunto/descricao que podem trazer conta bancaria ou CNPJ).
// A correspondencia continua aceitando o valor completo (digitos ou
// formatado); o que aparece na interface e o valor mascarado.
// ============================================================================

export function onlyDigits(value: string): string {
  return String(value || '').replace(/\D+/g, '');
}

export function formatMaskedCnpj(cnpj: string | null | undefined): string {
  const raw = String(cnpj || '').trim();
  if (!raw) return '';
  const d = onlyDigits(raw);
  if (d.length !== 14) {
    if (d.length < 4) return raw.replace(/\d/g, '*');
    return `${d.slice(0, 2)}.***.***/****-${d.slice(-2)}`;
  }
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.***/****-${d.slice(12, 14)}`;
}

export function formatMaskedAccountNumber(raw: string | null | undefined): string {
  const text = String(raw || '').trim();
  if (!text) return '';
  const d = onlyDigits(text);
  if (!d) return text;
  if (d.length <= 2) return '*'.repeat(d.length);
  const hyphenated = /\d-\d$/.test(text);
  if (hyphenated) {
    return `${'*'.repeat(Math.max(4, d.length - 1))}-${d.slice(-1)}`;
  }
  return `${'*'.repeat(Math.max(4, d.length - 2))}${d.slice(-2)}`;
}

const CNPJ_RE = /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g;
const ACCOUNT_RE =
  /\b((?:conta(?:\s*corrente)?|c\/c|cc|ag(?:encia|ência)?\.?|ag)\s*[:nº°o]*\s*)([\d.\-]+)/gi;

export function maskSensitiveFinanceText(text: string | null | undefined): string {
  let out = String(text || '');
  out = out.replace(CNPJ_RE, (m) => formatMaskedCnpj(m));
  out = out.replace(ACCOUNT_RE, (_m, prefix: string, num: string) => `${prefix}${formatMaskedAccountNumber(num)}`);
  return out;
}

export function normalizeTicketSearchText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export interface SetaDeskSearchableTicket {
  key?: string | null;
  subject?: string | null;
  description?: string | null;
  equipmentSerial?: string | null;
  assignee?: string | null;
  company?: { name?: string | null; cnpj?: string | null } | null;
  contact?: { firstName?: string | null; lastName?: string | null } | null;
}

/**
 * Haystack da busca: inclui CNPJ e conta em texto integral (para o operador
 * localizar pelo valor que ja conhece) e tambem a forma mascarada.
 */
export function buildTicketSearchHaystack(ticket: SetaDeskSearchableTicket): string {
  const cnpj = ticket.company?.cnpj || '';
  const parts = [
    ticket.key || '',
    ticket.subject || '',
    ticket.description || '',
    ticket.company?.name || '',
    cnpj,
    onlyDigits(cnpj),
    ticket.equipmentSerial || '',
    ticket.assignee || '',
    ticket.contact?.firstName || '',
    ticket.contact?.lastName || '',
  ];
  return normalizeTicketSearchText(parts.join(' '));
}

export function ticketMatchesSearch(ticket: SetaDeskSearchableTicket, query: string): boolean {
  const q = normalizeTicketSearchText(query);
  if (!q) return true;
  const hay = buildTicketSearchHaystack(ticket);
  if (hay.includes(q)) return true;
  const qDigits = onlyDigits(q);
  if (qDigits.length >= 4 && hay.includes(qDigits)) return true;
  return false;
}

export function displayTicketCompanyCnpj(cnpj: string | null | undefined, emptyLabel = 'CNPJ vinculado'): string {
  const masked = formatMaskedCnpj(cnpj);
  return masked || emptyLabel;
}

export function displayTicketSubject(subject: string | null | undefined): string {
  return maskSensitiveFinanceText(subject || '');
}
