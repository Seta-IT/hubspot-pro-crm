import { NextRequest } from 'next/server';
import { forwardToCrmRouter } from '../_bridge';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
// /api/erp/daily-sync (cron e botao Sincronizar) faz a carga completa paginada do GestaoClick (~40 s so de leitura).
export const maxDuration = 300;

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
