// ============================================================================
// STI-hub — Redacao do token do link assinado de proposta (A1, parecer CISO 30/10/2026).
// Modulo PURO (sem crypto): usavel no servidor e no navegador. Tudo que for GRAVADO
// (timeline, metadata, comentario de chamado, journal reconciliado) passa por aqui; o
// e-mail entregue ao cliente (Resend) continua com o link completo.
// ============================================================================

/** Regex definido pelo CISO: `#t=<payload>[.<assinatura>]`. Sempre criar uma instancia nova (flag g). */
export const PROPOSAL_LINK_TOKEN_PATTERN = /#t=[A-Za-z0-9_\-]+(\.[A-Za-z0-9_\-]+)?/g;
export const PROPOSAL_LINK_TOKEN_REDACTED = '#t=[REDACTED]';

export function redactProposalLinkTokens(text: string): string;
export function redactProposalLinkTokens(text: unknown): unknown;
export function redactProposalLinkTokens(text: unknown): unknown {
  if (typeof text !== 'string' || text.indexOf('#t=') === -1) return text;
  return text.replace(new RegExp(PROPOSAL_LINK_TOKEN_PATTERN.source, 'g'), PROPOSAL_LINK_TOKEN_REDACTED);
}

/** Aplica redactProposalLinkTokens em todas as strings de um valor JSON (copia; nao muta). */
export function deepRedactProposalLinkTokens<T>(value: T, depth = 0): T {
  if (depth > 40) return value;
  if (typeof value === 'string') return redactProposalLinkTokens(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => deepRedactProposalLinkTokens(v, depth + 1)) as unknown as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = deepRedactProposalLinkTokens(v, depth + 1);
    return out as T;
  }
  return value;
}
