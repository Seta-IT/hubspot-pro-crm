// Fase 3: descadastro publico de campanha (token assinado). Ver src/app/lib/marketing-public-routes.ts.
import { NextRequest, NextResponse } from 'next/server';
import { handleUnsubscribeRequest } from '../../../../../lib/marketing-public-routes';
import { dispatchTrustedMarketing } from '../../../../_bridge';
import { readBodyWithCap } from '../../../../../lib/bridge-body-limit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

function tokenFrom(req: NextRequest): string {
  const parts = new URL(req.url).pathname.split('/');
  return parts[parts.length - 1] || '';
}

export async function GET(req: NextRequest) {
  const r = await handleUnsubscribeRequest({ method: 'GET', token: tokenFrom(req) }, dispatchTrustedMarketing);
  return new NextResponse(r.body, { status: r.status, headers: r.headers });
}

export async function POST(req: NextRequest) {
  const capped = await readBodyWithCap(req, 4096);
  const r = await handleUnsubscribeRequest({ method: 'POST', token: tokenFrom(req), formBody: capped.ok ? capped.text : '' }, dispatchTrustedMarketing);
  return new NextResponse(r.body, { status: r.status, headers: r.headers });
}
