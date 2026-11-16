import { NextResponse } from 'next/server';
import { isGovBrSignEnabled } from '../../../../lib/govbr-sign';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(
    { enabled: isGovBrSignEnabled() },
    { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } }
  );
}
