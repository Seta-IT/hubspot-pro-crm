// ============================================================================
// STI-hub — Rotas PUBLICAS de rastreio do e-mail do CRM (04/11/2026).
//   GET /api/email-track/o/:id      -> pixel 1x1 (registra abertura)
//   GET /api/email-track/c/:id/:n   -> registra clique e redireciona ao link gravado no envio
// So registram o evento: nao leem sessao, nao devolvem dados, respondem igual para id
// valido/invalido (sem oraculo). O destino do clique vem SO do servidor (sem redirecionamento
// aberto). Precisa de '/api/email-track' em PUBLIC_PATH_PREFIXES no middleware (pedido ao CISO).
// ============================================================================
import { NextResponse } from 'next/server';
import { getDefaultMailboxStore, type MailboxStore } from '../../modules/email/mailbox-store';
import { isSafeRedirectTarget, parseTrackingPath, publicOrigin, TRANSPARENT_GIF } from '../../modules/email/mail-tracking';

const NO_STORE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
};

export function pixelResponse(): NextResponse {
  return new NextResponse(new Uint8Array(TRANSPARENT_GIF), {
    status: 200,
    headers: { ...NO_STORE, 'Content-Type': 'image/gif', 'Content-Length': String(TRANSPARENT_GIF.length) },
  });
}

export async function handleEmailTrackRequest(pathname: string, store: MailboxStore = getDefaultMailboxStore()): Promise<NextResponse> {
  const parsed = parseTrackingPath(pathname);
  if (!parsed || parsed.kind === 'OPEN') {
    if (parsed) {
      try {
        await store.recordOpen(parsed.trackingId);
      } catch {
        // falha de gravacao nunca muda a resposta
      }
    }
    return pixelResponse();
  }
  let target: string | null = null;
  try {
    target = await store.recordClick(parsed.trackingId, parsed.linkIndex);
  } catch {
    target = null;
  }
  const location = isSafeRedirectTarget(target) ? target : publicOrigin();
  return new NextResponse(null, { status: 302, headers: { ...NO_STORE, Location: location } });
}
