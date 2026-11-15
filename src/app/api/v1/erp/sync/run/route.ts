// STI-hub — POST /api/v1/erp/sync/run: chave de servico da sincronizacao GestaoClick -> STI-hub.
// Auth SO por Authorization: Bearer stihub_sync_... (sem sessao/cookie). Ver
// src/modules/integration/erp-sync-service.ts e docs/API_V1_MCP.md.
import { NextRequest, NextResponse } from 'next/server';
import { resolveTrustedClientIp } from '../../../../../../api/client-ip';
import { readBodyWithCap } from '../../../../../lib/bridge-body-limit';
import { problem, type IntegrationHttpRequest } from '../../../../../../modules/integration/http';
import { toNextResponse } from '../../../../../../modules/integration/next-adapter';
import { ERP_SYNC_MAX_BODY_BYTES, ERP_SYNC_ROUTE, handleErpSyncRun } from '../../../../../../modules/integration/erp-sync-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle(req: NextRequest): Promise<NextResponse> {
  const method = req.method.toUpperCase();
  const headers: Record<string, string> = {};
  // So o necessario: nenhum cookie/sessao segue para o handler.
  const authorization = req.headers.get('authorization');
  if (authorization) headers.authorization = authorization;
  const ip = resolveTrustedClientIp(req.headers) || 'sem-ip';
  let body: unknown = undefined;
  if (method === 'POST') {
    const capped = await readBodyWithCap(req, ERP_SYNC_MAX_BODY_BYTES);
    if (!capped.ok) {
      return toNextResponse(problem(413, 'BODY_TOO_LARGE', `Corpo acima do limite (${ERP_SYNC_MAX_BODY_BYTES} bytes).`));
    }
    const text = capped.text || '';
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null; // JSON invalido => 400 no handler (apos autenticar)
      }
    }
  }
  const r: IntegrationHttpRequest = { method, path: ERP_SYNC_ROUTE, headers, query: {}, body, cookies: {}, ip, origin: '' };
  try {
    return toNextResponse(await handleErpSyncRun(r));
  } catch {
    return toNextResponse(problem(500, 'INTERNAL_ERROR', 'Erro interno.'));
  }
}

export const POST = handle;
export const GET = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
