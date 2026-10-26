import { NextRequest } from 'next/server';
import { forwardToCrmRouter } from '../_bridge';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  return forwardToCrmRouter(req);
}

export async function POST(req: NextRequest) {
  return forwardToCrmRouter(req);
}

export async function PATCH(req: NextRequest) {
  return forwardToCrmRouter(req);
}

export async function PUT(req: NextRequest) {
  return forwardToCrmRouter(req);
}

export async function DELETE(req: NextRequest) {
  return forwardToCrmRouter(req);
}
