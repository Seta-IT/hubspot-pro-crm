// Fase 3: webhook do Resend (bounce, reclamacao, entrega, abertura, clique). Assinatura Svix.
import { NextRequest, NextResponse } from 'next/server';
import { handleResendWebhookRequest, WEBHOOK_MAX_BODY_BYTES } from '../../../../lib/marketing-public-routes';
import { dispatchTrustedMarketing } from '../../../_bridge';
import { readBodyWithCap } from '../../../../lib/bridge-body-limit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const capped = await readBodyWithCap(req, WEBHOOK_MAX_BODY_BYTES);
  if (!capped.ok) return NextResponse.json({ error: 'BODY_TOO_LARGE' }, { status: 413 });
  const r = await handleResendWebhookRequest({ rawBody: capped.text, headers: req.headers }, dispatchTrustedMarketing);
  return new NextResponse(r.body, { status: r.status, headers: r.headers });
}
