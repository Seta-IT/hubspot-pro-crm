import { NextRequest } from 'next/server';
import { forwardToCrmRouter } from '../_bridge';

export async function GET(req: NextRequest) {
  return forwardToCrmRouter(req, '/api/health');
}
