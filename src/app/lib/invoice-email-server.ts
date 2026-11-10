/** Anexos de fatura montados no servidor — só documentos já existentes daquela fatura. */

import type { ErpFiscalInvoice, ErpRentalContract } from '../../db/types';
import {
  normalizeInvoiceAttachmentKinds,
  type InvoiceAttachmentKind,
} from '../../modules/erp/invoice-send-attachments';
import { buildInvoiceAttachmentBundle } from './invoice-email-payload';

export type ServerMailAttachment = {
  filename: string;
  content: string;
  content_type: string;
};

function toBase64(value: string | Buffer): string {
  return Buffer.from(value).toString('base64');
}

function htmlDocument(title: string, body: string): string {
  const safeTitle = title.replace(/[<>]/g, '');
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${safeTitle}</title></head><body style="font-family:sans-serif;font-size:13px;color:#0f172a;padding:16px;">${body}</body></html>`;
}

export function buildServerInvoiceEmailAttachments(
  invoice: ErpFiscalInvoice,
  opts?: {
    contract?: ErpRentalContract | null;
    remessaDocs?: ErpFiscalInvoice[];
    kinds?: unknown;
  }
): ServerMailAttachment[] {
  const bundle = buildInvoiceAttachmentBundle(invoice, opts?.contract, opts?.remessaDocs || []);
  const avail = bundle.availability;
  const requested = normalizeInvoiceAttachmentKinds(opts?.kinds);
  const kinds: InvoiceAttachmentKind[] = requested.length
    ? requested
    : (['receipt', 'remessa', 'boleto', 'pix'] as InvoiceAttachmentKind[]).filter((k) =>
        k === 'receipt' ? true : Boolean((avail as Record<string, { available?: boolean }>)[k]?.available)
      );
  const code = String(invoice.documentNumber || invoice.id || 'fatura');
  const list: ServerMailAttachment[] = [];

  for (const kind of kinds) {
    if (list.length >= 4) break;
    if (kind === 'receipt') {
      list.push({
        filename: `recibo-${code}.html`,
        content: toBase64(bundle.receiptHtml || htmlDocument('Recibo', `<p>Fatura ${code}</p>`)),
        content_type: 'text/html; charset=utf-8',
      });
      continue;
    }
    if (kind === 'remessa') {
      if (!avail.remessa.available) continue;
      if (bundle.remessaXml) {
        list.push({
          filename: `nfe-remessa-${avail.remessa.number || code}.xml`,
          content: toBase64(bundle.remessaXml),
          content_type: 'application/xml',
        });
      } else {
        const number = avail.remessa.number || '—';
        const key = avail.remessa.accessKey || '—';
        list.push({
          filename: `nfe-remessa-${avail.remessa.number || code}.html`,
          content: toBase64(
            htmlDocument(
              'NF de remessa',
              `<p>NF de remessa ${number}</p><p>Chave de acesso: ${key}</p>`
            )
          ),
          content_type: 'text/html; charset=utf-8',
        });
      }
      continue;
    }
    if (kind === 'boleto') {
      if (!avail.boleto.available) continue;
      list.push({
        filename: `boleto-${code}.html`,
        content: toBase64(
          htmlDocument('Boleto', `<p>Linha digitável:</p><p><strong>${avail.boleto.line}</strong></p>`)
        ),
        content_type: 'text/html; charset=utf-8',
      });
      continue;
    }
    if (kind === 'pix') {
      if (!avail.pix.available) continue;
      list.push({
        filename: `pix-${code}.html`,
        content: toBase64(
          htmlDocument('Pix', `<p>Código Pix (copia e cola):</p><p><strong>${avail.pix.code}</strong></p>`)
        ),
        content_type: 'text/html; charset=utf-8',
      });
    }
  }

  return list.slice(0, 4);
}
