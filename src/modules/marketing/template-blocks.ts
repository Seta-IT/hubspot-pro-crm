// ============================================================================
// STI-hub — Fase 3: modelos de e-mail em blocos estruturados (editor visual com arrastar e soltar
// para reordenar). O HTML sai SO destes blocos (sem HTML livre do usuario): texto escapado e
// links/imagens restritos a https.
// ============================================================================
import { escapeHtml } from '../email/email-html';

export type TemplateBlockType = 'heading' | 'text' | 'button' | 'image' | 'divider' | 'spacer';
export const TEMPLATE_BLOCK_TYPES: TemplateBlockType[] = ['heading', 'text', 'button', 'image', 'divider', 'spacer'];
export const TEMPLATE_BLOCK_LABELS: Record<TemplateBlockType, string> = {
  heading: 'Título',
  text: 'Parágrafo',
  button: 'Botão',
  image: 'Imagem',
  divider: 'Divisor',
  spacer: 'Espaço',
};
export const MAX_TEMPLATE_BLOCKS = 40;

export interface TemplateBlock {
  id: string;
  type: TemplateBlockType;
  text?: string;
  url?: string;
  alt?: string;
}

const HTTPS_RE = /^https:\/\/[^\s"'<>]+$/i;

/** Normaliza e valida os blocos vindos do cliente. Lanca Error com mensagem em portugues. */
export function sanitizeTemplateBlocks(raw: unknown): TemplateBlock[] {
  if (!Array.isArray(raw)) throw new Error('Os blocos do modelo devem ser uma lista.');
  if (raw.length === 0) throw new Error('O modelo precisa de pelo menos um bloco.');
  if (raw.length > MAX_TEMPLATE_BLOCKS) throw new Error(`Máximo de ${MAX_TEMPLATE_BLOCKS} blocos por modelo.`);
  return raw.map((b, i) => {
    const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
    const type = String(o.type || '') as TemplateBlockType;
    if (!TEMPLATE_BLOCK_TYPES.includes(type)) throw new Error(`Bloco ${i + 1}: tipo inválido.`);
    const id = /^[A-Za-z0-9_-]{1,40}$/.test(String(o.id || '')) ? String(o.id) : `b${i + 1}`;
    const text = typeof o.text === 'string' ? o.text.slice(0, type === 'text' ? 5000 : 300) : '';
    const url = typeof o.url === 'string' ? o.url.trim().slice(0, 1000) : '';
    const alt = typeof o.alt === 'string' ? o.alt.slice(0, 200) : '';
    if ((type === 'heading' || type === 'text' || type === 'button') && !text.trim()) throw new Error(`Bloco ${i + 1}: texto obrigatório.`);
    if ((type === 'button' || type === 'image') && !HTTPS_RE.test(url)) throw new Error(`Bloco ${i + 1}: o link precisa começar com https://.`);
    const out: TemplateBlock = { id, type };
    if (text) out.text = text;
    if (url) out.url = url;
    if (alt) out.alt = alt;
    return out;
  });
}

export interface TemplateVars {
  firstName?: string;
  lastName?: string;
  companyName?: string;
}

export function renderVars(s: string, vars: TemplateVars): string {
  return s.replace(/\{\{\s*(firstName|lastName|companyName)\s*\}\}/g, (_, k: keyof TemplateVars) => String(vars[k] || ''));
}

/** HTML do corpo (sem rodape; o rodape legal e acrescentado no envio). */
export function renderBlocksHtml(blocks: TemplateBlock[], vars: TemplateVars = {}): string {
  return blocks
    .map((b) => {
      const t = escapeHtml(renderVars(b.text || '', vars));
      switch (b.type) {
        case 'heading':
          return `<h2 style="margin:0 0 12px;font-size:20px;color:#0f172a">${t}</h2>`;
        case 'text':
          return `<p style="margin:0 0 12px">${t.replace(/\n/g, '<br>')}</p>`;
        case 'button':
          return `<p style="margin:16px 0"><a href="${escapeHtml(b.url || '')}" style="background:#0f172a;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">${t}</a></p>`;
        case 'image':
          return `<p style="margin:0 0 12px"><img src="${escapeHtml(b.url || '')}" alt="${escapeHtml(b.alt || '')}" style="max-width:100%;height:auto;border:0" /></p>`;
        case 'divider':
          return '<hr style="border:0;border-top:1px solid #e2e8f0;margin:16px 0" />';
        case 'spacer':
          return '<div style="height:16px"></div>';
        default:
          return '';
      }
    })
    .join('');
}

export function renderBlocksText(blocks: TemplateBlock[], vars: TemplateVars = {}): string {
  return blocks
    .map((b) => {
      const t = renderVars(b.text || '', vars);
      if (b.type === 'button') return `${t}: ${b.url}`;
      if (b.type === 'image') return b.alt ? `[${b.alt}]` : '';
      if (b.type === 'divider') return '----';
      if (b.type === 'spacer') return '';
      return t;
    })
    .filter((x) => x !== '')
    .join('\n\n');
}
