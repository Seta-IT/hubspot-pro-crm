// ============================================================================
// STI-hub — Rastreamento de aberturas e cliques do e-mail individual do CRM (04/11/2026).
// - Corpo digitado em texto puro: escapado para HTML (sem HTML do usuario), quebras de linha
//   preservadas, links http(s) viram <a> passando pelo redirecionamento de clique.
// - O destino do clique NUNCA vem da URL publica: a rota publica so recebe o id de rastreio
//   e o indice do link; o endereco real fica gravado no servidor (sem redirecionamento aberto).
// - Pixel 1x1 no fim do corpo. Rotas publicas: /api/email-track/o/:id e /api/email-track/c/:id/:n.
// ============================================================================
import crypto from 'node:crypto';

export const TRACKING_PATH_PREFIX = '/api/email-track';
export const TRACKING_ID_RE = /^[A-Za-z0-9_-]{22,64}$/;
export const MAX_TRACKED_LINKS = 50;
/** Aberturas logo apos o envio costumam ser a varredura do proprio provedor; nao contam. */
export const OPEN_GRACE_MS = 15_000;

export const TRANSPARENT_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

export function newTrackingId(): string {
  return crypto.randomBytes(18).toString('base64url');
}

export function escapeHtml(v: string): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const URL_RE = /\bhttps?:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?]/gi;

export function publicOrigin(): string {
  const raw = String(process.env.STI_HUB_PUBLIC_ORIGIN || 'https://sti-hub.vercel.app').trim();
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.hostname !== 'localhost') return 'https://sti-hub.vercel.app';
    return u.origin;
  } catch {
    return 'https://sti-hub.vercel.app';
  }
}

export interface BuiltEmailBody {
  html: string;
  text: string;
  links: string[];
}

/**
 * Monta o corpo HTML do e-mail a partir do texto (corpo + assinatura).
 * track=false => links diretos e sem pixel (ex.: destinatarios so da lista "Nunca registrar").
 */
export function buildTrackedEmailBody(opts: {
  body: string;
  signature?: string | null;
  trackingId?: string | null;
  origin?: string;
}): BuiltEmailBody {
  const origin = opts.origin || publicOrigin();
  const text = [String(opts.body || '').replace(/\r\n/g, '\n').trimEnd(), String(opts.signature || '').replace(/\r\n/g, '\n').trim()]
    .filter(Boolean)
    .join('\n\n');
  const links: string[] = [];
  const track = Boolean(opts.trackingId && TRACKING_ID_RE.test(opts.trackingId));
  let html = '';
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0];
    const idx = m.index ?? 0;
    html += escapeHtml(text.slice(last, idx));
    let href = url;
    if (track && links.length < MAX_TRACKED_LINKS) {
      links.push(url);
      href = `${origin}${TRACKING_PATH_PREFIX}/c/${opts.trackingId}/${links.length - 1}`;
    }
    html += `<a href="${escapeHtml(href)}">${escapeHtml(url)}</a>`;
    last = idx + url.length;
  }
  html += escapeHtml(text.slice(last));
  html = html.replace(/\n/g, '<br>');
  const pixel = track
    ? `<img src="${origin}${TRACKING_PATH_PREFIX}/o/${opts.trackingId}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px" />`
    : '';
  return {
    html: `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2937">${html}</div>${pixel}`,
    text,
    links,
  };
}

/** Le o caminho publico. Retorna null se nao for um caminho de rastreio valido. */
export function parseTrackingPath(pathname: string):
  | { kind: 'OPEN'; trackingId: string }
  | { kind: 'CLICK'; trackingId: string; linkIndex: number }
  | null {
  const clean = String(pathname || '').replace(/\/+$/, '');
  if (!clean.startsWith(`${TRACKING_PATH_PREFIX}/`)) return null;
  const segs = clean.slice(TRACKING_PATH_PREFIX.length + 1).split('/');
  if (segs[0] === 'o' && segs.length === 2) {
    const id = segs[1].replace(/\.gif$/i, '');
    return TRACKING_ID_RE.test(id) ? { kind: 'OPEN', trackingId: id } : null;
  }
  if (segs[0] === 'c' && segs.length === 3 && /^\d{1,3}$/.test(segs[2])) {
    const n = Number(segs[2]);
    return TRACKING_ID_RE.test(segs[1]) && n < MAX_TRACKED_LINKS ? { kind: 'CLICK', trackingId: segs[1], linkIndex: n } : null;
  }
  return null;
}

/** So http(s) gravado no envio pode ser destino do clique. */
export function isSafeRedirectTarget(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 2048) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}
