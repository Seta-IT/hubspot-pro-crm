// Proposta individual (/api/erp/proposals/:id). Mesmo bridge da rota catch-all; o GET publico
// recebe o token do link pelo header X-Proposal-Token (ver src/app/lib/proposal-link-request.ts).
import { NextRequest } from 'next/server';
import { forwardToCrmRouter } from '../../../_bridge';
import { withProposalLinkParams } from '../../../../lib/proposal-link-request';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  return forwardToCrmRouter(await withProposalLinkParams(req));
}

export async function POST(req: NextRequest) {
  return forwardToCrmRouter(await withProposalLinkParams(req));
}

export async function PATCH(req: NextRequest) {
  return forwardToCrmRouter(await withProposalLinkParams(req));
}

export async function PUT(req: NextRequest) {
  return forwardToCrmRouter(await withProposalLinkParams(req));
}

export async function DELETE(req: NextRequest) {
  return forwardToCrmRouter(await withProposalLinkParams(req));
}
