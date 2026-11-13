// STI-hub — API REST v1 (/api/v1/*): autenticacao propria (Bearer de integracao/OAuth).
import { NextRequest } from 'next/server';
import { runIntegrationRoute } from '../../../../modules/integration/next-adapter';
import { handleRestV1 } from '../../../../modules/integration/rest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handle = (req: NextRequest) => runIntegrationRoute(req, (r) => handleRestV1(r));
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
