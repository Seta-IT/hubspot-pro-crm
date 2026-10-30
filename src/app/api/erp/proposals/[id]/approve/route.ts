// Aceite do cliente (POST /api/erp/proposals/:id/approve). Mesmo bridge da rota catch-all;
// token do link no header X-Proposal-Token (ver src/app/lib/proposal-link-request.ts).
import { NextRequest } from 'next/server';
import { forwardToCrmRouter } from '../../../../_bridge';
import { withProposalLinkParams } from '../../../../../lib/proposal-link-request';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  return forwardToCrmRouter(await withProposalLinkParams(req));
}
