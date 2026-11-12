// ============================================================================
// Busca de chamados: haystack e mascara de CNPJ / numero de conta.
// Aplica-se aos dados reais carregados pelo bootstrap (empresa.cnpj e
// assunto/descricao que podem trazer conta bancaria ou CNPJ).
// No servidor, texto livre compara so com o chamado ja mascarado;
// CNPJ e conta so entram com igualdade completa dos digitos.
// No cliente, o haystack nao inclui os digitos brutos do CNPJ.
// ============================================================================

export function onlyDigits(value: string): string {
  return String(value || '').replace(/\D+/g, '');
}

export function formatMaskedCnpj(cnpj: string | null | undefined): string {
  const raw = String(cnpj || '').trim();
  if (!raw) return '';
  // Idempotente: valor ja mascarado nao deve ser remascarado (perderia o meio).
  if (/\*/.test(raw)) return raw;
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
  comments?: Array<{ body?: string | null }>;
}

/**
 * Haystack da busca no cliente: textos e CNPJ ja mascarados, sem a sequencia
 * bruta de digitos (evita oraculo por trecho). A busca pelo valor completo
 * de CNPJ ou conta e feita no servidor (ticketMatchesSearchServer).
 */
export function buildTicketSearchHaystack(ticket: SetaDeskSearchableTicket): string {
  const cnpj = formatMaskedCnpj(ticket.company?.cnpj || '');
  const parts = [
    ticket.key || '',
    ticket.subject || '',
    ticket.description || '',
    ticket.company?.name || '',
    cnpj,
    ticket.equipmentSerial || '',
    ticket.assignee || '',
    ticket.contact?.firstName || '',
    ticket.contact?.lastName || '',
    ...(ticket.comments || []).map((c) => c.body || ''),
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

function collectSensitiveFinanceText(ticket: SetaDeskSearchableTicket): string {
  return [
    ticket.subject || '',
    ticket.description || '',
    ticket.company?.cnpj || '',
    ...(ticket.comments || []).map((c) => c.body || ''),
  ].join(' ');
}

/** Identificadores sensíveis brutos (so digitos) presentes no chamado. */
export function extractSensitiveFinanceIdentifiers(ticket: SetaDeskSearchableTicket): {
  cnpjs: string[];
  accounts: string[];
} {
  const text = collectSensitiveFinanceText(ticket);
  const cnpjs = new Set<string>();
  const accounts = new Set<string>();
  for (const m of text.matchAll(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g)) {
    if (/\*/.test(m[0])) continue;
    const d = onlyDigits(m[0]);
    if (d.length === 14) cnpjs.add(d);
  }
  for (const m of text.matchAll(
    /\b(?:conta(?:\s*corrente)?|c\/c|cc|ag(?:encia|ência)?\.?|ag)\s*[:nº°o]*\s*([\d.\-]+)/gi
  )) {
    const raw = m[1] || '';
    if (/\*/.test(raw)) continue;
    const d = onlyDigits(raw);
    if (d.length >= 4) accounts.add(d);
  }
  return { cnpjs: [...cnpjs], accounts: [...accounts] };
}

/**
 * Busca no servidor: texto livre so no chamado ja mascarado.
 * CNPJ e conta so correspondem com igualdade completa dos digitos.
 */
export function ticketMatchesSearchServer(ticket: SetaDeskSearchableTicket, query: string): boolean {
  const q = normalizeTicketSearchText(query);
  if (!q) return true;
  const qDigits = onlyDigits(query);
  if (qDigits) {
    const ids = extractSensitiveFinanceIdentifiers(ticket);
    if (ids.cnpjs.includes(qDigits) || ids.accounts.includes(qDigits)) return true;
  }
  const masked = maskTicketForResponse({
    key: ticket.key,
    subject: ticket.subject,
    description: ticket.description,
    equipmentSerial: ticket.equipmentSerial,
    assignee: ticket.assignee,
    company: ticket.company,
    contact: ticket.contact,
    comments: ticket.comments,
  });
  const hay = buildTicketSearchHaystack(masked);
  return hay.includes(q);
}

function maskArtifactsIn(value: string): { hasCnpjMask: boolean; accounts: string[] } {
  return {
    hasCnpjMask: /\*{3}\/\*{4}/.test(value),
    accounts: value.match(/\*{4}-\d/g) || [],
  };
}

/** Campos do patch que introduzem mascara de CNPJ ou conta ausente no original. */
export function introducedMaskedFinanceArtifacts(
  existing: { subject?: string | null; description?: string | null; resolution?: string | null },
  patch: { subject?: unknown; description?: unknown; resolution?: unknown }
): Array<'subject' | 'description' | 'resolution'> {
  const fields = ['subject', 'description', 'resolution'] as const;
  const bad: Array<(typeof fields)[number]> = [];
  for (const field of fields) {
    if (patch[field] === undefined) continue;
    if (isMaskedEchoOf(existing[field], patch[field])) continue;
    const incoming = patch[field] === null ? '' : String(patch[field]);
    const original = String(existing[field] ?? '');
    const next = maskArtifactsIn(incoming);
    const prev = maskArtifactsIn(original);
    const newCnpjMask = next.hasCnpjMask && !prev.hasCnpjMask;
    const prevAcc = new Set(prev.accounts);
    const newAccountMask = next.accounts.some((m) => !prevAcc.has(m));
    if (newCnpjMask || newAccountMask) bad.push(field);
  }
  return bad;
}

export function displayTicketCompanyCnpj(cnpj: string | null | undefined, emptyLabel = 'CNPJ vinculado'): string {
  const masked = formatMaskedCnpj(cnpj);
  return masked || emptyLabel;
}

export function displayTicketSubject(subject: string | null | undefined): string {
  return maskSensitiveFinanceText(subject || '');
}

export function looksLikeCnpjOrAccountQuery(query: string): boolean {
  const q = String(query || '').trim();
  if (!q) return false;
  const d = onlyDigits(q);
  if (d.length === 14) return true;
  const compact = q.replace(/\s+/g, '');
  if (/^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(compact)) return true;
  if (/^\d{4,12}-\d$/.test(compact)) return true;
  const accountHint = /\b(?:conta(?:\s*corrente)?|c\/c|cc|ag(?:encia|ência)?\.?|ag)\b/i;
  if (accountHint.test(q) && d.length >= 4) return true;
  return false;
}

export function maskTicketForResponse<T extends {
  subject?: string | null;
  description?: string | null;
  comments?: Array<{ body?: string | null }>;
  company?: { cnpj?: string | null } | null;
}>(ticket: T): T {
  const next = { ...ticket };
  if (typeof next.subject === 'string') next.subject = maskSensitiveFinanceText(next.subject);
  if (typeof next.description === 'string') next.description = maskSensitiveFinanceText(next.description);
  if (Array.isArray(next.comments)) {
    next.comments = next.comments.map((c) => ({
      ...c,
      body: typeof c.body === 'string' ? maskSensitiveFinanceText(c.body) : c.body,
    })) as T['comments'];
  }
  if (next.company && typeof next.company === 'object') {
    next.company = {
      ...next.company,
      cnpj: next.company.cnpj ? formatMaskedCnpj(next.company.cnpj) : next.company.cnpj,
    };
  }
  return next;
}

function isMaskedEchoOf(original: string | null | undefined, incoming: unknown): boolean {
  if (incoming === undefined) return false;
  const prev = String(original ?? '');
  const next = incoming === null ? '' : String(incoming);
  return next === maskSensitiveFinanceText(prev);
}

/** Remove do patch assunto/descricao/resolucao que so repetem o texto mascarado ja enviado ao cliente. */
export function omitMaskedTicketOverwrite<T extends {
  subject?: unknown;
  description?: unknown;
  resolution?: unknown;
}>(
  existing: { subject?: string | null; description?: string | null; resolution?: string | null },
  patch: T
): T {
  const out: T = { ...patch };
  if (out.subject !== undefined && isMaskedEchoOf(existing.subject, out.subject)) {
    delete (out as { subject?: unknown }).subject;
  }
  if (out.description !== undefined && isMaskedEchoOf(existing.description, out.description)) {
    delete (out as { description?: unknown }).description;
  }
  if (out.resolution !== undefined && isMaskedEchoOf(existing.resolution, out.resolution)) {
    delete (out as { resolution?: unknown }).resolution;
  }
  return out;
}

export function displayTicketDescription(description: string | null | undefined): string {
  return maskSensitiveFinanceText(description || '');
}

export function displayTicketCommentBody(body: string | null | undefined): string {
  return maskSensitiveFinanceText(body || '');
}
