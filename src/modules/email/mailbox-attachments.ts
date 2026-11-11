// ============================================================================
// STI-hub — Anexos do e-mail individual do CRM (Outlook/Graph).
// Os arquivos ficam só na memória da requisição e vão no payload do Graph.
// Nada é gravado em storage público. A timeline guarda apenas os nomes.
// Limite do Graph para fileAttachment simples: 3 MiB por arquivo.
// Acima disso (ou do total) o envio é recusado com mensagem clara; não há upload session.
// ============================================================================

/** Limite documentado do Graph para fileAttachment simples (~3 MiB). */
export const GRAPH_SIMPLE_ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024;
/**
 * Teto efetivo: 2,5 MiB por arquivo e no total, para o JSON em base64 caber no teto de 4 MiB
 * da rota autenticada POST /api/mailbox/send (sem upload session do Graph).
 */
export const MAILBOX_MAX_ATTACHMENT_BYTES = Math.floor(2.5 * 1024 * 1024);
export const MAILBOX_MAX_ATTACHMENTS = 5;
export const MAILBOX_MAX_ATTACHMENT_TOTAL_BYTES = MAILBOX_MAX_ATTACHMENT_BYTES;
export const MAILBOX_ATTACHMENT_NAME_MAX = 180;

export const MAILBOX_ATTACHMENT_TOO_LARGE =
  'Cada anexo (e o total dos anexos) deve ter no máximo 2,5 MB. Arquivos maiores não são aceitos neste envio.';

export const MAILBOX_ATTACHMENT_TYPE_DENIED =
  'Esse tipo de arquivo não é permitido. Aceitos: PDF, imagens (PNG, JPEG, GIF, WebP), Word, Excel, PowerPoint, texto e CSV.';

export const MAILBOX_ATTACHMENT_INVALID = 'Anexo inválido.';

export const MAILBOX_ATTACHMENT_LIMIT = `É possível anexar no máximo ${MAILBOX_MAX_ATTACHMENTS} arquivos.`;

/** Tipos aceitos (extensão → MIME canônico). Conteúdo também precisa bater com o magic byte. SVG, HTML, JS e executáveis ficam de fora. */
export const ALLOWED_ATTACHMENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
});

const MIME_TO_EXT: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [ext, mime] of Object.entries(ALLOWED_ATTACHMENT_TYPES)) {
    if (!m[mime]) m[mime] = ext;
  }
  return m;
})();

export type MailboxAttachmentErrorCode =
  | 'MAILBOX_ATTACHMENT_INVALID'
  | 'MAILBOX_ATTACHMENT_TYPE'
  | 'MAILBOX_ATTACHMENT_TOO_LARGE'
  | 'MAILBOX_ATTACHMENT_LIMIT';

export type ParsedMailboxAttachment = {
  filename: string;
  contentType: string;
  contentBytes: string; // base64 padrão, sem data: prefix
  size: number;
};

export type GraphFileAttachment = {
  '@odata.type': '#microsoft.graph.fileAttachment';
  name: string;
  contentType: string;
  contentBytes: string;
  isInline?: boolean;
  contentId?: string;
};

export function sanitizeAttachmentFilename(raw: string): string | null {
  const base = String(raw ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .pop() || '';
  const cleaned = base.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '').trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') return null;
  const safe = cleaned.replace(/[<>:"/\\|?*]/g, '_').slice(0, MAILBOX_ATTACHMENT_NAME_MAX);
  if (!safe || !/\.[A-Za-z0-9]{2,8}$/.test(safe)) return null;
  return safe;
}

export function extensionOf(filename: string): string {
  const m = /\.([A-Za-z0-9]{2,8})$/.exec(filename);
  return m ? m[1].toLowerCase() : '';
}

function canonicalMime(filename: string, declared: string): string | null {
  const ext = extensionOf(filename);
  const expected = ALLOWED_ATTACHMENT_TYPES[ext];
  if (!expected) return null;
  const d = String(declared || '').trim().toLowerCase().split(';')[0].trim();
  if (!d) return expected;
  if (d === expected) return expected;
  if ((ext === 'jpg' || ext === 'jpeg') && d === 'image/jpg') return expected;
  if (d === 'application/octet-stream') return expected;
  return null;
}

/** Cabeçalhos mágicos (e, em texto, ausência de HTML/SVG/executável). Extensão/MIME sozinhos não bastam. */
export function attachmentMatchesDeclaredType(mime: string, buf: Buffer): boolean {
  if (!buf.length) return false;
  const at = (n: number) => (n < buf.length ? buf[n]! : -1);
  const ascii = (start: number, len: number) => buf.subarray(start, start + len).toString('latin1');
  switch (mime) {
    case 'application/pdf': {
      let i = 0;
      if (buf.length >= 3 && at(0) === 0xef && at(1) === 0xbb && at(2) === 0xbf) i = 3;
      while (i < Math.min(buf.length, 16) && (at(i) === 0x20 || at(i) === 0x09 || at(i) === 0x0d || at(i) === 0x0a)) i++;
      return ascii(i, 5) === '%PDF-';
    }
    case 'image/png':
      return buf.length >= 8 && at(0) === 0x89 && ascii(1, 3) === 'PNG' && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a;
    case 'image/jpeg':
      return buf.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff;
    case 'image/gif':
      return buf.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a');
    case 'image/webp':
      return buf.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return (
        buf.length >= 4 &&
        at(0) === 0x50 &&
        at(1) === 0x4b &&
        (at(2) === 0x03 || at(2) === 0x05 || at(2) === 0x07) &&
        (at(3) === 0x04 || at(3) === 0x06 || at(3) === 0x08)
      );
    case 'text/plain':
    case 'text/csv':
      return isSafeTextAttachment(buf);
    default:
      return false;
  }
}

function isSafeTextAttachment(buf: Buffer): boolean {
  if (!buf.length || buf.includes(0)) return false;
  if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) return false; // MZ / executável
  const head = buf.subarray(0, Math.min(buf.length, 256)).toString('utf8').replace(/^\uFEFF/, '').trimStart().toLowerCase();
  if (head.startsWith('%pdf-')) return false;
  if (
    head.startsWith('<svg') ||
    head.startsWith('<?xml') ||
    head.startsWith('<!doctype') ||
    head.startsWith('<html') ||
    head.startsWith('<script') ||
    head.startsWith('<iframe')
  ) {
    return false;
  }
  return true;
}

function decodeBase64(raw: string): Buffer | null {
  const s = String(raw || '').trim();
  if (!s || s.length > Math.ceil(GRAPH_SIMPLE_ATTACHMENT_MAX_BYTES * 4 / 3) + 64) return null;
  if (s.includes(',') && /^data:/i.test(s)) return null; // recusar data-URL
  if (!/^[A-Za-z0-9+/=\s]+$/.test(s)) return null;
  const compact = s.replace(/\s+/g, '');
  if (compact.length % 4 !== 0) return null;
  try {
    const buf = Buffer.from(compact, 'base64');
    if (!buf.length) return null;
    // rejeita lixo que não reencode igual (padding à parte)
    if (Buffer.from(buf.toString('base64'), 'base64').length !== buf.length) return null;
    return buf;
  } catch {
    return null;
  }
}

export type ParseAttachmentsResult =
  | { ok: true; attachments: ParsedMailboxAttachment[] }
  | { ok: false; error: string; code: MailboxAttachmentErrorCode };

/**
 * Valida a lista vinda do cliente. Recusa path/url/conteúdo fora de filename+contentType+contentBase64.
 * Não persiste nada.
 */
export const INLINE_IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export type ParseMailboxAttachmentsOpts = {
  imagesOnly?: boolean;
  usedBytes?: number;
  usedCount?: number;
};

export function parseMailboxAttachments(raw: unknown, opts?: ParseMailboxAttachmentsOpts): ParseAttachmentsResult {
  if (raw == null) return { ok: true, attachments: [] };
  if (!Array.isArray(raw)) return { ok: false, error: MAILBOX_ATTACHMENT_INVALID, code: 'MAILBOX_ATTACHMENT_INVALID' };
  const usedCount = opts?.usedCount ?? 0;
  if (usedCount + raw.length > MAILBOX_MAX_ATTACHMENTS) return { ok: false, error: MAILBOX_ATTACHMENT_LIMIT, code: 'MAILBOX_ATTACHMENT_LIMIT' };

  const out: ParsedMailboxAttachment[] = [];
  let total = opts?.usedBytes ?? 0;
  const untrustedKeys = ['url', 'path', 'href', 'filepath', 'contentUrl', 'content_url', 'src', 'file', 'buffer'];

  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: MAILBOX_ATTACHMENT_INVALID, code: 'MAILBOX_ATTACHMENT_INVALID' };
    }
    const rec = item as Record<string, unknown>;
    if (untrustedKeys.some((k) => rec[k] != null && String(rec[k]).trim() !== '')) {
      return { ok: false, error: MAILBOX_ATTACHMENT_INVALID, code: 'MAILBOX_ATTACHMENT_INVALID' };
    }
    const allowedKeys = new Set(['filename', 'name', 'contentType', 'contentBase64', 'contentBytes', 'size', 'inline']);
    if (Object.keys(rec).some((k) => !allowedKeys.has(k))) {
      return { ok: false, error: MAILBOX_ATTACHMENT_INVALID, code: 'MAILBOX_ATTACHMENT_INVALID' };
    }
    const filename = sanitizeAttachmentFilename(String(rec.filename ?? rec.name ?? ''));
    if (!filename) return { ok: false, error: MAILBOX_ATTACHMENT_INVALID, code: 'MAILBOX_ATTACHMENT_INVALID' };
    const mime = canonicalMime(filename, String(rec.contentType ?? ''));
    if (!mime) return { ok: false, error: MAILBOX_ATTACHMENT_TYPE_DENIED, code: 'MAILBOX_ATTACHMENT_TYPE' };
    if (opts?.imagesOnly && !INLINE_IMAGE_TYPES.has(mime)) {
      return { ok: false, error: MAILBOX_ATTACHMENT_TYPE_DENIED, code: 'MAILBOX_ATTACHMENT_TYPE' };
    }
    const buf = decodeBase64(String(rec.contentBase64 ?? rec.contentBytes ?? ''));
    if (!buf) return { ok: false, error: MAILBOX_ATTACHMENT_INVALID, code: 'MAILBOX_ATTACHMENT_INVALID' };
    if (buf.length > MAILBOX_MAX_ATTACHMENT_BYTES) {
      return { ok: false, error: MAILBOX_ATTACHMENT_TOO_LARGE, code: 'MAILBOX_ATTACHMENT_TOO_LARGE' };
    }
    total += buf.length;
    if (total > MAILBOX_MAX_ATTACHMENT_TOTAL_BYTES) {
      return { ok: false, error: MAILBOX_ATTACHMENT_TOO_LARGE, code: 'MAILBOX_ATTACHMENT_TOO_LARGE' };
    }
    if (!attachmentMatchesDeclaredType(mime, buf)) {
      return { ok: false, error: MAILBOX_ATTACHMENT_TYPE_DENIED, code: 'MAILBOX_ATTACHMENT_TYPE' };
    }
    out.push({
      filename,
      contentType: mime,
      contentBytes: buf.toString('base64'),
      size: buf.length,
    });
  }
  return { ok: true, attachments: out };
}

export function toGraphFileAttachment(a: ParsedMailboxAttachment, inline?: { contentId: string }): GraphFileAttachment {
  const g: GraphFileAttachment = {
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: a.filename,
    contentType: a.contentType,
    contentBytes: a.contentBytes,
  };
  if (inline?.contentId) {
    g.isInline = true;
    g.contentId = inline.contentId;
  }
  return g;
}

export function attachmentsForTimeline(list: ParsedMailboxAttachment[]): string[] {
  return list.map((a) => a.filename);
}

export { MIME_TO_EXT };
