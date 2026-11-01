// ============================================================================
// STI-hub — Encaminhamento das rotas Next do link de proposta (/api/erp/proposals/:id e
// /approve) com LIMITE DE CORPO (B-V4-1, checagem final da v4 01/11/2026). Corpo acima de
// MAX_BODY_BYTES => 413 BODY_TOO_LARGE ANTES de ler o resto, de parsear, de redigir e de
// chegar ao bridge/dispatch: confere o content-length declarado e conta os bytes lidos do
// stream (corpo chunked/sem content-length tambem para no limite). O dispatch repete a
// checagem para as demais rotas (o _bridge.ts nao e alterado).
// ============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { forwardToCrmRouter } from '../api/_bridge';
import { MAX_BODY_BYTES } from './proposal-link-redact';
import { buildProposalLinkRequest } from './proposal-link-request';

export function bodyTooLargeResponse(): NextResponse {
  return NextResponse.json(
    { error: `Corpo da requisição acima do limite permitido (${MAX_BODY_BYTES} bytes).`, code: 'BODY_TOO_LARGE' },
    {
      status: 413,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    }
  );
}

/** Le o corpo como texto, parando (e cancelando o stream) ao passar de maxBytes. null => grande demais. */
export async function readBodyCapped(req: Request, maxBytes = MAX_BODY_BYTES): Promise<string | null> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.byteLength; }
  return new TextDecoder('utf-8').decode(all);
}

export async function forwardProposalLinkRequest(req: NextRequest): Promise<NextResponse> {
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  let body: string | undefined;
  if (hasBody) {
    const declared = req.headers.get('content-length');
    if (declared !== null && declared.trim() !== '') {
      const n = Number(declared);
      if (!Number.isFinite(n) || n < 0 || n > MAX_BODY_BYTES) return bodyTooLargeResponse();
    }
    const text = await readBodyCapped(req);
    if (text === null) return bodyTooLargeResponse();
    body = text;
  }
  return forwardToCrmRouter(buildProposalLinkRequest(req, body));
}
