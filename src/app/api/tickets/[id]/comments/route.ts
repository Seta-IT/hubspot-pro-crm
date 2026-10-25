import { NextRequest } from 'next/server';
import { forwardToCrmRouter } from '../../../_bridge';

export async function POST(req: NextRequest, context: { params: { id: string } }) {
  return forwardToCrmRouter(req, `/api/tickets/${context.params.id}/comments`);
}
