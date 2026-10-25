import { NextRequest } from 'next/server';
import { forwardToCrmRouter } from '../../_bridge';

export async function GET(req: NextRequest, context: { params: { id: string } }) {
  return forwardToCrmRouter(req, `/api/tickets/${context.params.id}`);
}

export async function PATCH(req: NextRequest, context: { params: { id: string } }) {
  return forwardToCrmRouter(req, `/api/tickets/${context.params.id}`);
}

export async function PUT(req: NextRequest, context: { params: { id: string } }) {
  return forwardToCrmRouter(req, `/api/tickets/${context.params.id}`);
}

export async function DELETE(req: NextRequest, context: { params: { id: string } }) {
  return forwardToCrmRouter(req, `/api/tickets/${context.params.id}`);
}
