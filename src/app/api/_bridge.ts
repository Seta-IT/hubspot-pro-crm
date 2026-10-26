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

  return NextResponse.json(res.body, {
    status: res.status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
}
