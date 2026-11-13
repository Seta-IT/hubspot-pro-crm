// STI-hub — IAM: chaves de integracao (sessao 2FA + ADMIN; o middleware tambem exige).
import { NextRequest } from 'next/server';
import { runIntegrationRoute } from '../../../../../modules/integration/next-adapter';
import { handleIamIntegrationKeys } from '../../../../../modules/integration/iam-keys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handle = (req: NextRequest) => runIntegrationRoute(req, (r) => handleIamIntegrationKeys(r));
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
