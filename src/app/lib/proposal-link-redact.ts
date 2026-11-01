// ============================================================================
// STI-hub — Redacao do token do link assinado de proposta (A1, parecer CISO 30/10/2026).
// Modulo PURO (sem crypto): usavel no servidor e no navegador. Tudo que for GRAVADO
// (timeline, metadata, comentario de chamado, journal reconciliado) passa por aqui; o
// e-mail entregue ao cliente (Resend) continua com o link completo.
// ============================================================================

/** Regex definido pelo CISO: `#t=<payload>[.<assinatura>]`. Sempre criar uma instancia nova (flag g). */
export const PROPOSAL_LINK_TOKEN_PATTERN = /#t=[A-Za-z0-9_\-]+(\.[A-Za-z0-9_\-]+)?/g;
export const PROPOSAL_LINK_TOKEN_REDACTED = '#t=[REDACTED]';

/**
 * Item 2 (CISO 30/10): forma URL-encoded do fragmento (`%23t%3D...`, inclusive duplamente
 * codificada `%2523t%253D...`), em qualquer caixa.
 */
export const PROPOSAL_LINK_TOKEN_ENCODED_PATTERN = /%(?:25)?23t%(?:25)?3d[A-Za-z0-9_\-]+(?:(?:\.|%(?:25)?2e)[A-Za-z0-9_\-]+)?/gi;
export const PROPOSAL_LINK_TOKEN_ENCODED_REDACTED = '%23t%3D[REDACTED]';

/**
 * Item 2: o PROPRIO token, sem prefixo (colado solto, em JSON, em URL sem #t=): formato
 * base64url(JSON) "." base64url(HMAC-SHA256, 43 chars). O JSON comeca com `{"` (=> "eyJ"). So e
 * redigido se o payload decodificado for de link de proposta (v, pid, jti) - outros tokens
 * (sessao, convite, redefinicao de senha) nao sao tocados.
 */
const PROPOSAL_LINK_BARE_TOKEN_PATTERN = /eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{43}(?![A-Za-z0-9_\-])/g;
export const PROPOSAL_LINK_BARE_TOKEN_REDACTED = '[REDACTED]';

const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Decodificador base64url -> texto latin1/ASCII sem Buffer/atob (modulo puro, roda no navegador). */
function decodeB64urlAscii(s: string): string {
  let bits = 0;
  let acc = 0;
  let out = '';
  for (let i = 0; i < s.length && out.length < 2048; i++) {
    const v = B64URL_ALPHABET.indexOf(s[i]);
    if (v < 0) return '';
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((acc >> bits) & 0xff);
    }
  }
  return out;
}

/** true se o texto base64url decodifica para as claims de um link de proposta. */
export function looksLikeProposalLinkPayload(payloadB64url: string): boolean {
  const txt = decodeB64urlAscii(payloadB64url);
  if (!txt.startsWith('{')) return false;
  try {
    const c = JSON.parse(txt) as Record<string, unknown>;
    return Boolean(c && typeof c === 'object' && 'pid' in c && 'jti' in c && 'v' in c);
  } catch {
    return false;
  }
}

export function redactProposalLinkTokens(text: string): string;
export function redactProposalLinkTokens(text: unknown): unknown;
export function redactProposalLinkTokens(text: unknown): unknown {
  if (typeof text !== 'string' || text.length < 3) return text;
  let out = text;
  if (out.indexOf('#t=') !== -1) {
    out = out.replace(new RegExp(PROPOSAL_LINK_TOKEN_PATTERN.source, 'g'), PROPOSAL_LINK_TOKEN_REDACTED);
  }
  if (out.indexOf('%') !== -1 && /%(?:25)?23t%(?:25)?3d/i.test(out)) {
    out = out.replace(new RegExp(PROPOSAL_LINK_TOKEN_ENCODED_PATTERN.source, 'gi'), PROPOSAL_LINK_TOKEN_ENCODED_REDACTED);
  }
  if (out.indexOf('eyJ') !== -1) {
    out = out.replace(new RegExp(PROPOSAL_LINK_BARE_TOKEN_PATTERN.source, 'g'), (m) =>
      looksLikeProposalLinkPayload(m.slice(0, m.indexOf('.'))) ? PROPOSAL_LINK_BARE_TOKEN_REDACTED : m
    );
  }
  return out;
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
