// ============================================================================
// STI-hub — Rotas PUBLICAS de rastreio do e-mail do CRM (04/11/2026).
//   GET /api/email-track/o/:id/:sig      -> pixel 1x1 (registra abertura)
//   GET /api/email-track/c/:id/:n/:sig   -> registra clique e redireciona ao link gravado no envio
// Parecer CISO 04/11: caminho assinado (HMAC derivado da STI_HUB_MAILBOX_ENC_KEY); assinatura
// invalida ou chave ausente => nao toca o banco. Limite por IP (memoria da instancia): acima
// dele a resposta e a mesma, sem gravar. So GET, sem corpo.
// So registram o evento: nao leem sessao, nao devolvem dados, respondem igual para id
// valido/invalido (sem oraculo). O destino do clique vem SO do servidor (sem redirecionamento
// aberto). Precisa de '/api/email-track' em PUBLIC_PATH_PREFIXES no middleware (pedido ao CISO).
// ============================================================================
import { NextResponse } from 'next/server';
import { getDefaultMailboxStore, type MailboxStore } from '../../modules/email/mailbox-store';
import { SlidingWindowRateLimiter } from '../../api/password-reset';
import { isSafeRedirectTarget, parseTrackingPath, publicOrigin, TRANSPARENT_GIF } from '../../modules/email/mail-tracking';

const NO_STORE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
};

export const EMAIL_TRACK_IP_LIMIT = Object.freeze({ max: 120, windowMs: 60_000 });
const trackIpLimiter = new SlidingWindowRateLimiter(EMAIL_TRACK_IP_LIMIT.max, EMAIL_TRACK_IP_LIMIT.windowMs);

/** IP do cliente atras do proxy da Vercel (primeiro item do x-forwarded-for). */
export function clientIpFromHeaders(h: { get(name: string): string | null }): string {
  const xff = String(h.get('x-forwarded-for') || '').split(',')[0].trim();
  return (xff || String(h.get('x-real-ip') || '').trim() || 'sem-ip').slice(0, 64);
}

export function pixelResponse(): NextResponse {
  return new NextResponse(new Uint8Array(TRANSPARENT_GIF), {
    status: 200,
    headers: { ...NO_STORE, 'Content-Type': 'image/gif', 'Content-Length': String(TRANSPARENT_GIF.length) },
  });
}

export async function handleEmailTrackRequest(
  pathname: string,
  store: MailboxStore = getDefaultMailboxStore(),
  clientIp = 'sem-ip',
  limiter: SlidingWindowRateLimiter = trackIpLimiter
): Promise<NextResponse> {
  const signed = parseTrackingPath(pathname);
  // Fora do limite: mesma resposta, sem gravar (abertura => pixel; clique => origem do STI-hub).
  const parsed = signed && limiter.hit(`track:${clientIp}`) ? signed : null;
  if (!parsed && signed?.kind === 'CLICK') {
    return new NextResponse(null, { status: 302, headers: { ...NO_STORE, Location: publicOrigin() } });
  }
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
