import { NextRequest, NextResponse } from 'next/server';
import { CrmApiRouter } from '../../api/router';

const router = new CrmApiRouter();

export async function forwardToCrmRouter(
  req: NextRequest,
  overridePath?: string
): Promise<NextResponse> {
  const url = new URL(req.url);
  const path = overridePath || url.pathname;
  const query: Record<string, string | undefined> = {};
  url.searchParams.forEach((v, k) => {
    query[k] = v;
  });

  const sessionCookie =
    req.cookies.get('stihub_session')?.value ||
    req.headers.get('x-stihub-session') ||
    undefined;
  if (sessionCookie && !query._sessionToken) {
    query._sessionToken = sessionCookie;
  }
  const enrolledCookie = req.cookies.get('stihub_totp_enrolled')?.value;
  if (enrolledCookie && !query._enrolledUsers) {
    query._enrolledUsers = enrolledCookie;
  }
  if (!query._fromHttpBridge) {
    query._fromHttpBridge = '1';
  }
  if (!query._origin) {
    query._origin = url.origin;
  }

  let body: unknown = undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      body = await req.json();
    } catch {
      body = {};
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
