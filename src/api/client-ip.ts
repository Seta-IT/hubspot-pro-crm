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
