// STI-hub — servidor MCP remoto (Streamable HTTP stateless, JSON-RPC 2.0).
import { NextRequest } from 'next/server';
import { runIntegrationRoute } from '../../../modules/integration/next-adapter';
import { handleMcp } from '../../../modules/integration/mcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handle = (req: NextRequest) => runIntegrationRoute(req, (r) => handleMcp(r));
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
