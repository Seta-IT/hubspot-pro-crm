import { NextRequest, NextResponse } from 'next/server';
import { CrmApiRouter } from '../../api/router';
import { constantTimeEqual, STIHUB_TOTP_ENROLLED_COOKIE } from '../lib/auth';

const router = new CrmApiRouter();

export async function forwardToCrmRouter(
  req: NextRequest,
  overridePath?: string
): Promise<NextResponse> {
  const url = new URL(req.url);
  const path = overridePath || url.pathname;
  const query: Record<string, string | undefined> = {};
  url.searchParams.forEach((v, k) => {
    // Contencao 29/10/2026: chaves internas (_sessionToken, _fromHttpBridge, _origin,
    // _enrolledUsers, _clientIp, _cronAuthorized...) NUNCA vem da URL do cliente.
    if (k.startsWith('_')) return;
    query[k] = v;
  });

  const sessionCookie =
    req.cookies.get('stihub_session')?.value ||
    req.headers.get('x-stihub-session') ||
    undefined;
  if (sessionCookie) {
    query._sessionToken = sessionCookie;
  }
  // Cookie de pareamento da epoca de rotacao atual (o cookie antigo e ignorado).
  const enrolledCookie = req.cookies.get(STIHUB_TOTP_ENROLLED_COOKIE)?.value;
  if (enrolledCookie) {
    query._enrolledUsers = enrolledCookie;
  }
  // IP real do cliente (usado na trilha de auditoria do aceite publico de propostas).
  const forwardedFor = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '';
  query._clientIp = forwardedFor.split(',')[0]?.trim() || undefined;
  query._fromHttpBridge = '1';
  query._origin = url.origin;

  // Vercel Cron: GET /api/erp/daily-sync com Authorization: Bearer <CRON_SECRET>.
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = req.headers.get('authorization') || '';
  if (
    cronSecret &&
    cronSecret.length >= 16 &&
    req.method === 'GET' &&
    path.replace(/\/+$/, '') === '/api/erp/daily-sync' &&
    constantTimeEqual(authHeader, `Bearer ${cronSecret}`)
  ) {
    query._cronAuthorized = '1';
  }

  let body: unknown = undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      body = await req.json();
    } catch {
      body = {};
    }
  }

  // Headers x-stihub-iam-* sao apenas um canal alternativo ao corpo: o router so aceita
  // registros selados antes da autenticacao e override cru apenas de admin autenticado.
  const iamUsersHdr = req.headers.get('x-stihub-iam-users');
  const iamDeletedHdr = req.headers.get('x-stihub-iam-deleted');
  if (iamUsersHdr || iamDeletedHdr) {
    if (!body || typeof body !== 'object') body = {};
    const bObj = body as Record<string, unknown>;
    if (iamUsersHdr && !bObj.iamUsersOverride && iamUsersHdr.length < 200_000) {
      try {
        bObj.iamUsersOverride = JSON.parse(decodeURIComponent(iamUsersHdr));
      } catch {}
    }
    if (iamDeletedHdr && !bObj.iamDeletedUsersOverride && iamDeletedHdr.length < 50_000) {
      try {
        bObj.iamDeletedUsersOverride = JSON.parse(decodeURIComponent(iamDeletedHdr));
      } catch {}
    }
  }

  const res = await router.dispatch({
    method: req.method,
    path,
    query,
    body,
  });

  const responseHeaders: Record<string, string> = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...(res.headers || {}),
  };

  return NextResponse.json(res.body, {
    status: res.status,
    headers: responseHeaders,
  });
}
