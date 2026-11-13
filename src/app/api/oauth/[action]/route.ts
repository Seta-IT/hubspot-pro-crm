// STI-hub — OAuth 2.1 + DCR: /api/oauth/{register,authorize,token,revoke}.
import { NextRequest } from 'next/server';
import { runIntegrationRoute } from '../../../../modules/integration/next-adapter';
import { handleOAuth } from '../../../../modules/integration/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handle = (req: NextRequest) => runIntegrationRoute(req, (r) => handleOAuth(r));
export const GET = handle;
export const POST = handle;
