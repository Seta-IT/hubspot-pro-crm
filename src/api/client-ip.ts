// ============================================================================
// Pacote G (5c): IP do cliente para rate-limit/auditoria (portal, login, reset...).
// Ordem de confianca:
//   1. x-vercel-forwarded-for — definido pela borda da Vercel (o cliente nao consegue injetar);
//   2. x-real-ip — tambem definido pela Vercel;
//   3. x-forwarded-for (1o item) — SO fora da Vercel (dev local / proxy proprio). Na Vercel e
//      ignorado como fallback, para nao depender de um cabecalho que um cliente pode tentar forjar;
//   4. undefined => o chamador usa o balde 'sem-ip' (rate-limit compartilhado, mais restritivo).
// ============================================================================
type HeaderGetter = { get(name: string): string | null };

const IP_RE = /^[0-9a-fA-F:.]{2,64}$/;

function firstIp(v: string | null | undefined): string | undefined {
  const ip = String(v || '').split(',')[0]?.trim();
  return ip && IP_RE.test(ip) ? ip : undefined;
}

export function resolveTrustedClientIp(headers: HeaderGetter, onVercel = process.env.VERCEL === '1'): string | undefined {
  return (
    firstIp(headers.get('x-vercel-forwarded-for')) ||
    firstIp(headers.get('x-real-ip')) ||
    (onVercel ? undefined : firstIp(headers.get('x-forwarded-for')))
  );
}

/**
 * Pacote J (D-I4): chave de rate-limit por IP. IPv4 => o proprio endereco. IPv6 => o prefixo /64
 * (um cliente recebe normalmente um /64 inteiro; contar cada /128 deixava o atacante trocar de
 * endereco a vontade). IPv4 mapeado (::ffff:a.b.c.d) => o IPv4. Invalido/vazio => 'sem-ip'.
 * So para contagem: a auditoria continua gravando o endereco completo.
 */
export function rateLimitIpKey(ip: string | null | undefined): string {
  const raw = String(ip || '').trim().replace(/^\[|\]$/g, '').split('%')[0];
  if (!raw || raw === 'sem-ip') return 'sem-ip';
  if (!raw.includes(':')) return raw;
  const mapped = raw.match(/^(?:0{0,4}:){0,5}:?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) return mapped[1];
  let s = raw.toLowerCase();
  // Cauda IPv4 embutida (ex.: 64:ff9b::1.2.3.4) => 2 hextets.
  const v4 = s.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const n = v4.slice(1).map(Number);
    if (n.some((x) => x > 255)) return raw;
    s = s.slice(0, -v4[0].length) + ((n[0] << 8) | n[1]).toString(16) + ':' + ((n[2] << 8) | n[3]).toString(16);
  }
  const parts = s.split('::');
  if (parts.length > 2) return raw;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const fill = parts.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (parts.length === 1 && head.length !== 8)) return raw;
  const hextets = [...head, ...Array(fill).fill('0'), ...tail];
  if (hextets.length !== 8 || hextets.some((h) => !/^[0-9a-f]{1,4}$/.test(h))) return raw;
  return `${hextets.slice(0, 4).map((h) => parseInt(h, 16).toString(16)).join(':')}::/64`;
}
