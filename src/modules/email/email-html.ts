// ============================================================================
// STI-hub — HTML de e-mail: sanitização com allowlist, texto alternativo e assinatura.
// Usado no servidor (obrigatório) e no compositor (prévia/cola). Sem I/O.
// ============================================================================

export const EMAIL_HTML_MAX_INPUT = 80_000;
export const EMAIL_HTML_MAX_OUTPUT = 40_000;

const ALLOWED_TAGS = new Set([
  'a', 'b', 'strong', 'i', 'em', 'u', 'p', 'br', 'ul', 'ol', 'li', 'div', 'span',
  'h1', 'h2', 'h3', 'h4', 'img', 'blockquote', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
]);

const VOID_TAGS = new Set(['br', 'img', 'hr']);

const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select',
  'option', 'meta', 'link', 'base', 'svg', 'math', 'template', 'noscript', 'applet', 'frame',
  'frameset', 'video', 'audio', 'source', 'track', 'canvas', 'title', 'xmp', 'plaintext',
]);

const STYLE_ONLY_TAGS = new Set([
  'p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'li', 'ul', 'ol', 'blockquote', 'td', 'th', 'tr', 'table', 'img',
]);

const TABLE_ATTR = new Set(['colspan', 'rowspan']);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00A0',
};

export function escapeHtml(v: string): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function decodeHtmlEntities(s: string): string {
  return String(s ?? '').replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/g, (_, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return '';
      if ((n < 32 && n !== 9 && n !== 10 && n !== 13) || (n >= 127 && n <= 159)) return '';
      return String.fromCodePoint(n);
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, e) ? NAMED_ENTITIES[e] : '';
  });
}

function stripControls(s: string): string {
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '');
}

const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;

function compactForScheme(v: string): string {
  return v.replace(/[\s\u00a0\u200b-\u200f]+/g, '');
}

/** http(s) ou mailto; rejeita javascript:, data:, vbscript:, file: e demais esquemas. */
export function sanitizeHref(raw: string): string | null {
  const v = stripControls(decodeHtmlEntities(String(raw ?? ''))).trim();
  if (!v || v.length > 2048) return null;
  const compact = compactForScheme(v).toLowerCase();
  if (compact.startsWith('javascript:') || compact.startsWith('vbscript:') || compact.startsWith('data:')) return null;
  if (compact.startsWith('file:') || compact.startsWith('blob:') || compact.startsWith('about:')) return null;
  const scheme = SCHEME_RE.exec(compact);
  if (scheme) {
    const s = scheme[1];
    if (s === 'mailto') {
      const rest = v.replace(/^mailto:/i, '').split('?')[0].trim();
      if (!rest || rest.length > 254 || /[<>\s,;]/.test(rest) || !rest.includes('@')) return null;
      return `mailto:${rest}`;
    }
    if (s !== 'http' && s !== 'https') return null;
  }
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Logo oficial, injetado pelo servidor na assinatura. */
export const SETA_LOGO_CID_SRC = 'cid:seta-it-logo';
/** Placeholder do compositor para imagem enviada como anexo inline. O servidor troca por um CID próprio. */
export const INLINE_IMAGE_CID_RE = /^cid:stihub-inline-(\d{1,2})$/i;

export type SanitizeEmailHtmlOptions = {
  /** Só no compositor autenticado: permite blob: em <img data-stihub-inline="N"> para a prévia. */
  allowComposerPreview?: boolean;
};

/** src de <img>: apenas cid:seta-it-logo ou cid:stihub-inline-N. Sem http(s), data: ou javascript:. */
export function sanitizeImgSrc(raw: string, opts?: SanitizeEmailHtmlOptions): string | null {
  const v = stripControls(decodeHtmlEntities(String(raw ?? ''))).trim();
  if (/^cid:seta-it-logo$/i.test(v)) return SETA_LOGO_CID_SRC;
  if (INLINE_IMAGE_CID_RE.test(v)) return v.toLowerCase();
  if (opts?.allowComposerPreview && /^blob:/i.test(v) && v.length <= 500 && !/javascript:/i.test(v)) return v;
  return null;
}

export function inlineImageSlot(src: string): number | null {
  const m = INLINE_IMAGE_CID_RE.exec(String(src || '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 0 && n <= 20 ? n : null;
}

function isSafeColor(v: string): boolean {
  return /^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|0?\.\d+|1(\.0)?)\s*\))$/i.test(v.trim());
}

function isSafeLength(v: string): boolean {
  return /^(-?0|-?\d{1,4}(\.\d{1,2})?(px|pt|em|rem|%))$/i.test(v.trim());
}

const STYLE_ALLOW: Record<string, (v: string) => boolean> = {
  'text-align': (v) => /^(left|right|center|justify)$/i.test(v),
  'font-weight': (v) => /^(normal|bold|bolder|lighter|[1-9]00)$/i.test(v),
  'font-style': (v) => /^(normal|italic)$/i.test(v),
  'text-decoration': (v) => /^(none|underline|line-through)(\s+(none|underline|line-through))*$/i.test(v),
  color: isSafeColor,
  'background-color': isSafeColor,
  'font-size': (v) => /^\d{1,3}(\.\d{1,2})?(px|pt|em|rem|%)$/i.test(v),
  'line-height': (v) => /^(normal|\d{1,2}(\.\d{1,2})?(px|em|rem|%)?)$/i.test(v),
  margin: (v) => v.split(/\s+/).every(isSafeLength) && v.split(/\s+/).length <= 4,
  padding: (v) => v.split(/\s+/).every(isSafeLength) && v.split(/\s+/).length <= 4,
  width: isSafeLength,
  height: isSafeLength,
  'border-collapse': (v) => /^(collapse|separate)$/i.test(v),
};

function sanitizeStyle(raw: string): string | null {
  const v = stripControls(decodeHtmlEntities(String(raw ?? '')));
  if (!v || v.length > 500) return null;
  const lower = v.toLowerCase();
  if (lower.includes('url(') || lower.includes('expression') || lower.includes('javascript') || lower.includes('behavior')) return null;
  if (lower.includes('@') || lower.includes('\\') || lower.includes('&#') || lower.includes('</') || lower.includes('import')) return null;
  const out: string[] = [];
  for (const part of v.split(';')) {
    if (!part.trim()) continue;
    const colon = part.indexOf(':');
    if (colon < 1) continue;
    const prop = part.slice(0, colon).trim().toLowerCase();
    const val = part.slice(colon + 1).trim();
    if (!/^[a-z-]+$/.test(prop) || !val) continue;
    const check = STYLE_ALLOW[prop];
    if (!check || !check(val)) continue;
    out.push(`${prop}: ${val}`);
    if (out.length >= 12) break;
  }
  return out.length ? out.join('; ') : null;
}

function sanitizeDimension(raw: string): string | null {
  const v = stripControls(decodeHtmlEntities(String(raw ?? ''))).trim();
  if (/^\d{1,4}$/.test(v)) return v;
  if (/^\d{1,4}(px|%)$/i.test(v)) return v;
  return null;
}

function sanitizeColspan(raw: string): string | null {
  const v = stripControls(decodeHtmlEntities(String(raw ?? ''))).trim();
  if (!/^[1-9]\d{0,1}$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= 20 ? String(n) : null;
}

type AttrMap = Record<string, string>;

function parseTag(chunk: string, opts?: SanitizeEmailHtmlOptions): { name: string; attrs: AttrMap; selfClosing: boolean } | null {
  const m = /^<\s*\/?\s*([a-zA-Z][a-zA-Z0-9:-]*)\b([^>]*)>$/.exec(chunk);
  if (!m) return null;
  const name = m[1].toLowerCase();
  let rest = m[2] || '';
  const selfClosing = /\/\s*$/.test(rest) || VOID_TAGS.has(name);
  rest = rest.replace(/\/\s*$/, '');
  const attrs: AttrMap = {};
  const attrRe = /([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let am: RegExpExecArray | null;
  while ((am = attrRe.exec(rest))) {
    const key = am[1].toLowerCase();
    if (!key || key.startsWith('on') || key.startsWith('xmlns') || key.includes(':')) continue;
    if (key.startsWith('data-') && !(opts?.allowComposerPreview && key === 'data-stihub-inline')) continue;
    const val = am[2] !== undefined ? am[2] : am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : '';
    if (!(key in attrs)) attrs[key] = val;
  }
  return { name, attrs, selfClosing };
}

function emitOpen(name: string, attrs: AttrMap, opts?: SanitizeEmailHtmlOptions): string {
  const allowed: string[] = [];
  if (name === 'a') {
    const href = attrs.href != null ? sanitizeHref(attrs.href) : null;
    if (href) {
      allowed.push(`href="${escapeHtml(href)}"`);
      if (href.startsWith('http')) allowed.push('rel="noopener noreferrer"');
    }
    if (attrs.title) {
      const title = stripControls(decodeHtmlEntities(attrs.title)).slice(0, 200);
      if (title) allowed.push(`title="${escapeHtml(title)}"`);
    }
  } else if (name === 'img') {
    const src = attrs.src != null ? sanitizeImgSrc(attrs.src, opts) : null;
    if (!src) return '';
    const slotRaw = attrs['data-stihub-inline'];
    const slotOk = opts?.allowComposerPreview && slotRaw != null && /^(0|[1-9]\d?)$/.test(String(slotRaw)) && Number(slotRaw) <= 20;
    if (src.startsWith('blob:') && !slotOk) return '';
    allowed.push(`src="${escapeHtml(src)}"`);
    if (slotOk) allowed.push(`data-stihub-inline="${Number(slotRaw)}"`);
    const alt = stripControls(decodeHtmlEntities(attrs.alt || '')).slice(0, 200);
    allowed.push(`alt="${escapeHtml(alt)}"`);
    const w = attrs.width != null ? sanitizeDimension(attrs.width) : null;
    const h = attrs.height != null ? sanitizeDimension(attrs.height) : null;
    if (w) allowed.push(`width="${escapeHtml(w)}"`);
    if (h) allowed.push(`height="${escapeHtml(h)}"`);
  } else if (name === 'th' || name === 'td') {
    for (const k of TABLE_ATTR) {
      if (attrs[k] != null) {
        const n = sanitizeColspan(attrs[k]);
        if (n) allowed.push(`${k}="${n}"`);
      }
    }
  }
  if (STYLE_ONLY_TAGS.has(name) && attrs.style != null) {
    const style = sanitizeStyle(attrs.style);
    if (style) allowed.push(`style="${escapeHtml(style)}"`);
  }
  return allowed.length ? `<${name} ${allowed.join(' ')}>` : `<${name}>`;
}

function findClose(html: string, from: number, name: string): number {
  const re = new RegExp(`<\\/\\s*${name}\\b[^>]*>`, 'i');
  const slice = html.slice(from);
  const m = re.exec(slice);
  if (!m || m.index == null) return html.length;
  return from + m.index + m[0].length;
}

function nextMarkup(html: string, i: number): { end: number; comment: boolean } | null {
  if (html[i] !== '<') return null;
  if (html.startsWith('<!--', i)) {
    const end = html.indexOf('-->', i + 4);
    return { end: end === -1 ? html.length : end + 3, comment: true };
  }
  if (html.startsWith('<![', i) || html.startsWith('<?', i) || html.startsWith('<!', i)) {
    const end = html.indexOf('>', i + 2);
    return { end: end === -1 ? html.length : end + 1, comment: true };
  }
  const end = html.indexOf('>', i + 1);
  if (end === -1) return { end: html.length, comment: true };
  return { end: end + 1, comment: false };
}

/**
 * Sanitiza HTML de e-mail com allowlist de tags/atributos.
 * Remove script, style, eventos, javascript:/data: URLs e CSS perigoso.
 * A saída é HTML reescrito (atributos sempre entre aspas e escapados).
 */
export function sanitizeEmailHtml(input: string, opts?: SanitizeEmailHtmlOptions): string {
  const raw0 = String(input ?? '');
  const raw = (raw0.length > EMAIL_HTML_MAX_INPUT ? raw0.slice(0, EMAIL_HTML_MAX_INPUT) : raw0).replace(/\r\n/g, '\n');
  let out = '';
  const stack: string[] = [];
  let i = 0;
  while (i < raw.length && out.length < EMAIL_HTML_MAX_OUTPUT) {
    const lt = raw.indexOf('<', i);
    if (lt === -1) {
      out += escapeHtml(raw.slice(i));
      break;
    }
    if (lt > i) out += escapeHtml(raw.slice(i, lt));
    const mk = nextMarkup(raw, lt);
    if (!mk) {
      out += escapeHtml(raw.slice(lt));
      break;
    }
    if (mk.comment) {
      i = mk.end;
      continue;
    }
    const chunk = raw.slice(lt, mk.end);
    const isClose = /^<\s*\//.test(chunk);
    const parsed = parseTag(chunk, opts);
    if (!parsed) {
      i = mk.end;
      continue;
    }
    const name = parsed.name;
    if (DROP_WITH_CONTENT.has(name)) {
      if (isClose) {
        i = mk.end;
        continue;
      }
      i = parsed.selfClosing || VOID_TAGS.has(name) ? mk.end : findClose(raw, mk.end, name);
      continue;
    }
    if (!ALLOWED_TAGS.has(name)) {
      i = mk.end;
      continue;
    }
    if (isClose) {
      while (stack.length) {
        const top = stack.pop()!;
        out += `</${top}>`;
        if (top === name) break;
      }
      i = mk.end;
      continue;
    }
    if (VOID_TAGS.has(name) || parsed.selfClosing) {
      const open = emitOpen(name, parsed.attrs, opts);
      if (open) out += VOID_TAGS.has(name) ? open.replace(/>$/, ' />') : `${open}</${name}>`;
      i = mk.end;
      continue;
    }
    const open = emitOpen(name, parsed.attrs, opts);
    if (!open) {
      i = mk.end;
      continue;
    }
    // <a> sem href seguro vira span (mantém o texto)
    if (name === 'a' && !/\shref=/.test(open)) {
      out += '<span>';
      stack.push('span');
    } else {
      out += open;
      stack.push(name);
    }
    i = mk.end;
  }
  while (stack.length) out += `</${stack.pop()}>`;
  if (out.length > EMAIL_HTML_MAX_OUTPUT) out = out.slice(0, EMAIL_HTML_MAX_OUTPUT);
  return out;
}

/** Converte texto puro (modelos, assinatura) em HTML seguro com quebras. */
export function plainTextToHtml(text: string): string {
  const t = String(text ?? '').replace(/\r\n/g, '\n');
  if (!t) return '';
  return escapeHtml(t).replace(/\n/g, '<br>');
}

const BLOCK_BREAK = /^(p|div|h1|h2|h3|h4|blockquote|tr|table|ul|ol|li|br|hr)$/;

/** Texto alternativo a partir de HTML já sanitizado (ou não). */
export function htmlToPlainText(html: string): string {
  let s = String(html ?? '').replace(/\r\n/g, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|h1|h2|h3|h4|blockquote|tr|li|hr)\s*>/gi, '\n');
  s = s.replace(/<hr\s*\/?>/gi, '\n');
  s = s.replace(/<li\b[^>]*>/gi, '• ');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeHtmlEntities(s);
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  void BLOCK_BREAK;
  return s;
}

/** Corpo vazio para o compositor (só tags vazias ou espaços). */
export function isEmptyEmailHtml(html: string): boolean {
  const text = htmlToPlainText(html);
  return text.replace(/\u00A0/g, ' ').trim().length === 0;
}

export function buildSignatureHtml(signatureText: string, opts?: { logoCid?: string; logoAlt?: string }): string {
  const parts: string[] = [];
  if (opts?.logoCid) {
    const src = opts.logoCid.startsWith('cid:') ? opts.logoCid : `cid:${opts.logoCid}`;
    const alt = escapeHtml(opts.logoAlt || 'SETA | IT');
    parts.push(
      `<div style="margin:0 0 12px 0"><img src="${escapeHtml(src)}" alt="${alt}" width="200" height="64" style="display:block;border:0;width:200px;height:64px" /></div>`
    );
  }
  const text = String(signatureText || '').replace(/\r\n/g, '\n').trim();
  if (text) parts.push(`<div>${plainTextToHtml(text)}</div>`);
  return parts.join('');
}

/** Reescreve links http(s) de <a href> já sanitizados. Devolve o HTML e a lista original. */
export function rewriteSanitizedAnchors(
  html: string,
  rewrite: (href: string, index: number) => string | null,
  maxLinks: number
): { html: string; links: string[] } {
  const links: string[] = [];
  const out = html.replace(/<a\s+([^>]*?)href="([^"]+)"([^>]*)>/gi, (full, pre: string, href: string, post: string) => {
    const url = decodeHtmlEntities(href);
    if (!/^https?:/i.test(url)) return full;
    if (links.length >= maxLinks) return full;
    const next = rewrite(url, links.length);
    if (next == null) return full;
    links.push(url);
    return `<a ${pre}href="${escapeHtml(next)}"${post}>`;
  });
  return { html: out, links };
}

const BARE_URL_RE = /\bhttps?:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?]/gi;

/** Autolinka URLs soltas em nós de texto (fora de <a> e <img>). html já deve estar sanitizado. */
export function autolinkBareUrlsInSanitizedHtml(
  html: string,
  rewrite: (href: string, index: number) => string | null,
  links: string[],
  maxLinks: number
): string {
  const parts = html.split(/(<[^>]+>)/g);
  let inAnchor = 0;
  let out = '';
  for (const part of parts) {
    if (part.startsWith('<')) {
      if (/^<a\b/i.test(part)) inAnchor += 1;
      else if (/^<\/a\b/i.test(part)) inAnchor = Math.max(0, inAnchor - 1);
      out += part;
      continue;
    }
    if (inAnchor) {
      out += part;
      continue;
    }
    let last = 0;
    let chunk = '';
    for (const m of part.matchAll(BARE_URL_RE)) {
      const url = m[0];
      const idx = m.index ?? 0;
      chunk += part.slice(last, idx);
      let href = url;
      if (links.length < maxLinks) {
        const next = rewrite(url, links.length);
        if (next != null) {
          links.push(url);
          href = next;
        }
      }
      chunk += `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
      last = idx + url.length;
    }
    chunk += part.slice(last);
    out += chunk;
  }
  return out;
}
