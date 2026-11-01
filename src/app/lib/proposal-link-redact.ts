// ============================================================================
// STI-hub — Redacao do token do link assinado de proposta (A1, parecer CISO 30/10/2026;
// A3/A4 da re-checagem da v3, 01/11/2026).
// Modulo PURO (sem crypto, sem Buffer/atob): usavel no servidor e no navegador. Tudo que for
// GRAVADO (timeline, metadata, comentario de chamado, journal reconciliado, qualquer corpo que
// passa pelo dispatch) passa por aqui; o e-mail entregue ao cliente (Resend) continua com o
// link completo.
// ============================================================================

/** Regex definido pelo CISO: `#t=<payload>[.<assinatura>]`. Sempre criar uma instancia nova (flag g). */
export const PROPOSAL_LINK_TOKEN_PATTERN = /#t=[A-Za-z0-9_\-]+(\.[A-Za-z0-9_\-]+)?/g;
export const PROPOSAL_LINK_TOKEN_REDACTED = '#t=[REDACTED]';

/** Forma URL-encoded do fragmento (`%23t%3D...`, inclusive `%2523t%253D...`), em qualquer caixa. */
export const PROPOSAL_LINK_TOKEN_ENCODED_PATTERN = /%(?:25)?23t%(?:25)?3d[A-Za-z0-9_\-]+(?:(?:\.|%(?:25)?2e)[A-Za-z0-9_\-]+)?/gi;
export const PROPOSAL_LINK_TOKEN_ENCODED_REDACTED = '%23t%3D[REDACTED]';

export const PROPOSAL_LINK_BARE_TOKEN_REDACTED = '[REDACTED]';
export const PROPOSAL_LINK_DEPTH_REDACTED = '[REDACTED-DEPTH]';

/**
 * Chaves descartadas no deepRedact (A4): `__proto__` vindo de JSON.parse e chave PROPRIA; copiada
 * por atribuicao viraria o prototipo do corpo (campos herdados, invisiveis a Object.keys).
 */
const DANGEROUS_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 40;
/** Claims {v,pid,ver,iat,exp,jti} em JSON ~110+ bytes => payload base64url >= ~140 chars. */
const MIN_TEXT_FOR_PAYLOAD = 60;

const B64_INDEX: Record<string, number> = (() => {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const m: Record<string, number> = {};
  for (let i = 0; i < a.length; i++) m[a[i]] = i;
  m['-'] = 62; m['+'] = 62; // base64url e base64 padrao
  m['_'] = 63; m['/'] = 63;
  return m;
})();
const isB64Char = (c: string | undefined): boolean => c !== undefined && B64_INDEX[c] !== undefined;

/** Invisiveis: \p{Cf} (ZWSP, ZWNJ, ZWJ, BOM, word joiner, soft hyphen...), CGJ e "fillers" Hangul. */
const INVISIBLE_RE = /^[\p{Cf}\u034F\u115F\u1160\u3164\uFFA0]$/u;
/** Formas escritas do ponto (A3), em qualquer caixa. Ordem: mais longas primeiro. */
const DOT_SPELLINGS = ['&period;', '%252e', '&#x2e;', '\\u002e', '&#46;', '\\x2e', '%2e'];

/**
 * Visao NORMALIZADA do texto com o mapa para o original: remove espacos/quebras e invisiveis,
 * converte ASCII de largura total e transforma %2E, %252E, &#46;, &#x2e;, &period;, \u002e e \x2e
 * em ".". start[i]/end[i] = faixa no original do i-esimo caractere da visao.
 */
function buildNormalizedView(s: string): { v: string; start: number[]; end: number[] } {
  let v = '';
  const start: number[] = [];
  const end: number[] = [];
  let i = 0;
  while (i < s.length) {
    let matchedDot = 0;
    if (s[i] === '%' || s[i] === '&' || s[i] === '\\') {
      const low = s.slice(i, i + 8).toLowerCase();
      for (const d of DOT_SPELLINGS) {
        if (low.startsWith(d)) { matchedDot = d.length; break; }
      }
    }
    if (matchedDot) {
      v += '.'; start.push(i); end.push(i + matchedDot);
      i += matchedDot;
      continue;
    }
    const cp = s.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const len = ch.length;
    if (/^\s$/u.test(ch) || INVISIBLE_RE.test(ch)) {
      i += len;
      continue;
    }
    const out = cp >= 0xff01 && cp <= 0xff5e ? String.fromCharCode(cp - 0xfee0) : ch;
    for (const c of out) { v += c; start.push(i); end.push(i + len); }
    i += len;
  }
  return { v, start, end };
}

/** Decodifica base64/base64url (sem padding) para texto latin1, ate maxBytes. */
function decodeB64(chars: string, maxBytes: number): string {
  let bits = 0;
  let acc = 0;
  let out = '';
  for (let i = 0; i < chars.length && out.length < maxBytes; i++) {
    const val = B64_INDEX[chars[i]];
    if (val === undefined) break;
    acc = ((acc << 6) | val) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((acc >> bits) & 0xff);
    }
  }
  return out;
}

/**
 * Se `chars` comeca com o base64 de um objeto JSON com pid e jti (claims do link), devolve
 * quantos caracteres base64 formam esse payload; senao 0.
 */
function proposalPayloadLength(chars: string): number {
  const txt = decodeB64(chars.slice(0, 1400), 1024);
  if (!txt.startsWith('{"')) return 0;
  const close = txt.indexOf('}');
  if (close < 0) return 0;
  try {
    const c = JSON.parse(txt.slice(0, close + 1)) as Record<string, unknown>;
    if (!c || typeof c !== 'object' || !('pid' in c) || !('jti' in c)) return 0;
  } catch {
    return 0;
  }
  return Math.ceil(((close + 1) * 4) / 3);
}

/** true se o texto base64url decodifica para as claims de um link de proposta. */
export function looksLikeProposalLinkPayload(payloadB64url: string): boolean {
  return proposalPayloadLength(String(payloadB64url || '')) > 0;
}

/**
 * A3: redige o PAYLOAD do token (e a assinatura que vier depois do ponto) onde quer que esteja,
 * depois de normalizar: quebra de linha/espaco no meio, colado a outro texto, ponto escrito como
 * %2E / &#46; / \u002e, ZWSP e outros invisiveis, base64 padrao. So redige se o payload
 * decodificar para JSON com pid e jti (tokens de sessao, convite e reset ficam intactos). Sem o
 * payload (jti aleatorio) o token nao pode ser reconstruido.
 */
function redactProposalPayloads(s: string): string {
  if (s.length < MIN_TEXT_FOR_PAYLOAD) return s;
  const { v, start, end } = buildNormalizedView(s);
  const spans: Array<[number, number]> = [];
  let from = 0;
  for (;;) {
    const idx = v.indexOf('eyJ', from);
    if (idx < 0) break;
    let j = idx;
    while (j < v.length && j - idx < 1400 && isB64Char(v[j])) j++;
    const plen = proposalPayloadLength(v.slice(idx, j));
    if (!plen || idx + plen > j) {
      from = idx + 3;
      continue;
    }
    let e = idx + plen;
    while (v[e] === '=') e++;
    if (v[e] === '.') {
      let q = e + 1;
      while (q < v.length && q - (e + 1) < 43 && isB64Char(v[q])) q++;
      if (q > e + 1) {
        e = q;
        while (v[e] === '=') e++;
      }
    }
    spans.push([start[idx], end[e - 1]]);
    from = e;
  }
  if (!spans.length) return s;
  let out = '';
  let last = 0;
  for (const [a, b] of spans) {
    if (a < last) continue;
    out += s.slice(last, a) + PROPOSAL_LINK_BARE_TOKEN_REDACTED;
    last = b;
  }
  return out + s.slice(last);
}

export function redactProposalLinkTokens(text: string): string;
export function redactProposalLinkTokens(text: unknown): unknown;
export function redactProposalLinkTokens(text: unknown): unknown {
  if (typeof text !== 'string' || text.length < 3) return text;
  // 1) Payload pelo formato (antes das regex: um `#t=` quebrado no meio do payload nao pode
  //    deixar o resto + assinatura para tras).
  let out = redactProposalPayloads(text);
  // 2) Formas canonicas do fragmento (inclusive valores que nao sao token valido).
  if (out.indexOf('#t=') !== -1) {
    out = out.replace(new RegExp(PROPOSAL_LINK_TOKEN_PATTERN.source, 'g'), PROPOSAL_LINK_TOKEN_REDACTED);
  }
  if (out.indexOf('%') !== -1 && /%(?:25)?23t%(?:25)?3d/i.test(out)) {
    out = out.replace(new RegExp(PROPOSAL_LINK_TOKEN_ENCODED_PATTERN.source, 'gi'), PROPOSAL_LINK_TOKEN_ENCODED_REDACTED);
  }
  return out;
}

/** Profundidade maxima aceita num corpo (a raiz e o nivel 0). Acima disso o dispatch recusa (400). */
export const MAX_BODY_DEPTH = MAX_DEPTH;

/**
 * true se algum valor do corpo esta ABAIXO de MAX_BODY_DEPTH niveis (raiz = 0). Iterativo (pilha
 * explicita): um corpo com milhares de niveis nao estoura a pilha de chamadas.
 */
export function bodyExceedsMaxDepth(value: unknown, maxDepth = MAX_BODY_DEPTH): boolean {
  if (!value || typeof value !== 'object') return false;
  const stack: Array<[unknown, number]> = [[value, 0]];
  while (stack.length) {
    const [v, d] = stack.pop()!;
    if (!v || typeof v !== 'object') continue;
    const children = Array.isArray(v) ? v : Object.values(v as Record<string, unknown>);
    if (children.length === 0) continue;
    if (d + 1 > maxDepth) return true;
    for (const c of children) if (c && typeof c === 'object') stack.push([c, d + 1]);
  }
  return false;
}

/**
 * A4: true se o valor (JSON) tem, em qualquer nivel, uma chave PROPRIA `__proto__`,
 * `constructor` ou `prototype`. O dispatch recusa esses corpos (400) antes de redigir: a copia
 * redigida descarta as chaves, e sem a recusa as validacoes .strict()/allowlist (pacotes H/I) nao
 * as veriam mais.
 */
export function hasDangerousBodyKey(value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH || !value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((v) => hasDangerousBodyKey(v, depth + 1));
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  for (const k of Object.keys(value as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(k)) return true;
    if (hasDangerousBodyKey((value as Record<string, unknown>)[k], depth + 1)) return true;
  }
  return false;
}

/**
 * Aplica redactProposalLinkTokens em todas as strings (valores E chaves) de um valor JSON (copia;
 * nao muta). A4: descarta `__proto__`, `constructor` e `prototype`. Acima de 40 niveis devolve
 * '[REDACTED-DEPTH]' (nada passa sem ser examinado).
 */
export function deepRedactProposalLinkTokens<T>(value: T, depth = 0): T {
  if (depth > MAX_DEPTH) {
    return (value !== null && (typeof value === 'object' || typeof value === 'string')
      ? PROPOSAL_LINK_DEPTH_REDACTED
      : value) as unknown as T;
  }
  if (typeof value === 'string') return redactProposalLinkTokens(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => deepRedactProposalLinkTokens(v, depth + 1)) as unknown as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DANGEROUS_KEYS.has(k)) continue;
      const key = redactProposalLinkTokens(k);
      if (DANGEROUS_KEYS.has(key)) continue;
      out[key] = deepRedactProposalLinkTokens(v, depth + 1);
    }
    return out as T;
  }
  return value;
}
