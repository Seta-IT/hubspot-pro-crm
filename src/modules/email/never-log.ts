// ============================================================================
// STI-hub — Lista "Nunca registrar" do e-mail do CRM (04/11/2026).
// Mesmo comportamento do HubSpot: e-mails trocados SO com enderecos/dominios desta lista
// nao entram na linha do tempo (nem sao rastreados). Padroes aceitos:
//   *@dominio.com.br   -> qualquer endereco do dominio (exato, sem subdominios)
//   dominio.com.br     -> o mesmo que *@dominio.com.br
//   pessoa@dominio.com -> um endereco
// ============================================================================

export const DEFAULT_NEVER_LOG_PATTERNS = Object.freeze(['*@setatelecom.com', '*@setatelecom.com.br']);
export const NEVER_LOG_MAX_ENTRIES = 500;

const DOMAIN_RE = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const LOCAL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$/;

/** Normaliza um padrao digitado pelo admin. Retorna null se invalido. */
export function normalizeNeverLogPattern(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.normalize('NFC').trim().toLowerCase();
  if (!s || s.length > 254) return null;
  if (s.startsWith('@')) s = `*${s}`;
  if (!s.includes('@')) s = `*@${s}`;
  const [local, domain, ...rest] = s.split('@');
  if (rest.length || !domain || !DOMAIN_RE.test(domain)) return null;
  if (local !== '*' && !LOCAL_RE.test(local)) return null;
  return `${local}@${domain}`;
}

export function normalizeEmailAddress(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

/** true se o endereco casa com algum padrao da lista. */
export function isNeverLogAddress(address: string, patterns: readonly string[]): boolean {
  const a = normalizeEmailAddress(address);
  const at = a.lastIndexOf('@');
  if (at < 1) return false;
  const domain = a.slice(at + 1);
  for (const p of patterns) {
    const [local, pDomain] = p.split('@');
    if (pDomain !== domain) continue;
    if (local === '*' || `${local}@${pDomain}` === a) return true;
  }
  return false;
}

/**
 * Regra de registro: so registra se houver ao menos UM participante externo (fora da lista).
 * Remetente + destinatarios; o proprio usuario costuma estar na lista (dominio interno).
 */
export function shouldLogEmail(participants: readonly string[], patterns: readonly string[]): boolean {
  const list = participants.map(normalizeEmailAddress).filter((x) => x.includes('@'));
  return list.some((addr) => !isNeverLogAddress(addr, patterns));
}
