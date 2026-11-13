// STI-hub — metadata OAuth (RFC 8414 / RFC 9728). Publico, sem dados sensiveis.
import { NextRequest } from 'next/server';
import { runIntegrationRoute } from '../../../../modules/integration/next-adapter';
import { handleWellKnown } from '../../../../modules/integration/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = (req: NextRequest) => runIntegrationRoute(req, (r) => handleWellKnown(r));
