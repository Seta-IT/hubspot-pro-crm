// Proposta individual (/api/erp/proposals/:id). Mesmo bridge da rota catch-all; o GET publico
// recebe o token do link pelo header X-Proposal-Token (ver src/app/lib/proposal-link-request.ts).
// B-V4-1: corpo acima de 1 MiB => 413 antes de ler/parsear (src/app/lib/proposal-link-route.ts).
import { NextRequest } from 'next/server';
import { forwardProposalLinkRequest } from '../../../../lib/proposal-link-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  return forwardProposalLinkRequest(req);
}

export async function POST(req: NextRequest) {
  return forwardProposalLinkRequest(req);
}

export async function PATCH(req: NextRequest) {
  return forwardProposalLinkRequest(req);
}

export async function PUT(req: NextRequest) {
  return forwardProposalLinkRequest(req);
}

export async function DELETE(req: NextRequest) {
  return forwardProposalLinkRequest(req);
}
