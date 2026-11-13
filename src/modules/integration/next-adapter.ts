// ============================================================================
// STI-hub — adaptador Next.js (App Router) <-> handlers neutros de integracao.
// Corpo com teto de 256 KiB (lido em stream). JSON ou application/x-www-form-urlencoded.
// ============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { resolveTrustedClientIp } from '../../api/client-ip';
import { readBodyWithCap } from '../../app/lib/bridge-body-limit';
import { problem, type IntegrationHttpRequest, type IntegrationHttpResponse } from './http';

export const INTEGRATION_MAX_BODY_BYTES = 256 * 1024;

function publicOrigin(req: NextRequest): string {
  const configured = String(process.env.STI_HUB_PUBLIC_ORIGIN || '').trim().replace(/\/+$/, '');
  if (/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(configured)) return configured;
  return req.nextUrl.origin;
}

export async function toIntegrationRequest(req: NextRequest): Promise<IntegrationHttpRequest | IntegrationHttpResponse> {
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  const query: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => {
    if (!(k in query)) query[k] = v;
  });
  let body: unknown = undefined;
  const method = req.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    const capped = await readBodyWithCap(req, INTEGRATION_MAX_BODY_BYTES);
    if (!capped.ok) return problem(413, 'BODY_TOO_LARGE', 'Corpo acima do limite (256 KiB).');
    const ct = (headers['content-type'] || '').toLowerCase();
    const text = capped.text || '';
    if (ct.includes('application/x-www-form-urlencoded')) {
      const form: Record<string, string> = {};
      new URLSearchParams(text).forEach((v, k) => {
        if (!(k in form)) form[k] = v;
      });
      body = form;
    } else if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
  }
  const cookies: Record<string, string> = {};
  const session = req.cookies.get('stihub_session')?.value;
  if (session) cookies.stihub_session = session;
  return {
    method,
    path: req.nextUrl.pathname,
    headers,
    query,
    body,
    cookies,
    ip: resolveTrustedClientIp(req.headers) || 'sem-ip',
    origin: publicOrigin(req),
  };
}

export function toNextResponse(res: IntegrationHttpResponse): NextResponse {
  if (res.redirect) {
    const r = NextResponse.redirect(res.redirect, res.status === 303 ? 303 : 302);
    for (const [k, v] of Object.entries(res.headers || {})) r.headers.set(k, v);
    return r;
  }
  if (res.text !== undefined) return new NextResponse(res.text, { status: res.status, headers: res.headers });
  if (res.body === undefined || res.status === 202 || res.status === 204) {
    return new NextResponse(null, { status: res.status, headers: res.headers });
  }
  const headers = { 'Content-Type': 'application/json; charset=utf-8', ...(res.headers || {}) };
  return new NextResponse(JSON.stringify(res.body), { status: res.status, headers });
}

export async function runIntegrationRoute(
  req: NextRequest,
  handler: (r: IntegrationHttpRequest) => Promise<IntegrationHttpResponse> | IntegrationHttpResponse
): Promise<NextResponse> {
  const r = await toIntegrationRequest(req);
  if ('status' in r && !('method' in r)) return toNextResponse(r);
  try {
    return toNextResponse(await handler(r as IntegrationHttpRequest));
  } catch (err) {
    console.error('[integration] erro nao tratado', (err as Error)?.name || 'Error');
    return toNextResponse(problem(500, 'INTERNAL_ERROR', 'Erro interno.'));
  }
}
