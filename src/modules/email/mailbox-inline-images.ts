// Só servidor: troca cid:stihub-inline-N por CID aleatório e monta anexos isInline.
import crypto from 'node:crypto';
import { toGraphFileAttachment, type GraphFileAttachment, type ParsedMailboxAttachment } from './mailbox-attachments';

/** Troca cid:stihub-inline-N por um CID gerado no servidor e monta os fileAttachment isInline. */
export function applyServerInlineImages(
  html: string,
  inlines: ParsedMailboxAttachment[]
): { html: string; attachments: GraphFileAttachment[] } {
  const used = new Map<number, string>();
  const attachments: GraphFileAttachment[] = [];
  let out = String(html || '').replace(/src="cid:stihub-inline-(\d{1,2})"/gi, (_full, n: string) => {
    const slot = Number(n);
    const file = inlines[slot];
    if (!file) return 'src=""';
    let cid = used.get(slot);
    if (!cid) {
      cid = `stihub-img-${crypto.randomBytes(8).toString('hex')}`;
      used.set(slot, cid);
      attachments.push(toGraphFileAttachment(file, { contentId: cid }));
    }
    return `src="cid:${cid}"`;
  });
  out = out.replace(/<img\b[^>]*src=""[^>]*\/?>/gi, '');
  return { html: out, attachments };
}
