// Rastreio publico do e-mail do CRM (ver src/app/lib/email-track-route.ts).
import { NextRequest } from 'next/server';
import { handleEmailTrackRequest } from '../../../../../lib/email-track-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  return handleEmailTrackRequest(new URL(req.url).pathname);
}
