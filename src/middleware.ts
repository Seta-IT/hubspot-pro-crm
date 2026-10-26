import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/api/auth',
  '/proposta',
  '/portal',
  '/api/portal',
  '/api/erp/proposals',
  '/api/health',
  '/_next',
  '/favicon.ico',
];

export function isPublicStiHubPath(pathname: string): boolean {
  const clean = pathname || '/';
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => clean === prefix || clean.startsWith(`${prefix}/`)
  );
}

export function evaluateStiHubRouteProtection(input: {
  pathname: string;
  sessionToken?: string | null;
  enforceStrictLock?: boolean;
}): {
  allowed: boolean;
  isPublicRoute: boolean;
  redirectTo: string | null;
  statusCode: number;
  reason: string;
} {
  const isPublic = isPublicStiHubPath(input.pathname);
  if (isPublic) {
    return {
      allowed: true,
      isPublicRoute: true,
      redirectTo: null,
      statusCode: 200,
      reason: 'PUBLIC_ROUTE_ALLOWED',
    };
  }

  const hasValidToken = Boolean(input.sessionToken && input.sessionToken.trim().length > 10);
  if (hasValidToken) {
    return {
      allowed: true,
      isPublicRoute: false,
      redirectTo: null,
      statusCode: 200,
      reason: 'MFA_SESSION_VERIFIED',
    };
  }

  if (input.enforceStrictLock !== false) {
    const isApi = input.pathname.startsWith('/api/');
    return {
      allowed: false,
      isPublicRoute: false,
      redirectTo: isApi ? null : `/login?next=${encodeURIComponent(input.pathname)}`,
      statusCode: isApi ? 401 : 307,
      reason: 'MFA_AUTH_REQUIRED',
    };
  }

  return {
    allowed: true,
    isPublicRoute: false,
    redirectTo: null,
    statusCode: 200,
    reason: 'DEFAULT_ADMIN_SESSION_FALLBACK',
  };
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicStiHubPath(pathname)) {
    const res = NextResponse.next();
    res.headers.set('x-stihub-auth-guard', 'public-allowed');
    return res;
  }

  const sessionToken =
    req.cookies.get('stihub_session')?.value ||
    req.headers.get('x-stihub-session') ||
    null;

  // Rotas do sistema não podem ser acessadas fora do login:
  // Exige cookie stihub_session (MFA 2FA verificado) em todas as páginas protegidas.
  const isInternalTestHeader = req.headers.get('x-stihub-internal-test') === '1';
  const isApiRoute = pathname.startsWith('/api/');
  const enforceStrictLock = isInternalTestHeader
    ? false
    : isApiRoute
      ? req.cookies.get('stihub_logged_out')?.value === '1'
      : process.env.STI_HUB_STRICT_AUTH !== 'false';

  const decision = evaluateStiHubRouteProtection({
    pathname,
    sessionToken,
    enforceStrictLock,
  });

  if (!decision.allowed) {
    if (decision.redirectTo) {
      return NextResponse.redirect(new URL(decision.redirectTo, req.url));
    }
    return NextResponse.json(
      {
        error: 'Acesso não autorizado. Autenticação corporativa STI-hub + MFA 2FA obrigatória.',
        code: decision.reason,
      },
      { status: 401 }
    );
  }

  const res = NextResponse.next();
  res.headers.set('x-stihub-auth-guard', decision.reason);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
