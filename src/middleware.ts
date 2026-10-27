import { NextRequest, NextResponse } from 'next/server';
import {
  StiHubSignedSessionClaims,
  verifyStiHubSessionToken,
} from './app/lib/auth';
import type { StiHubMacroModule } from './db/types';

const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/api/auth',
  '/proposta',
  '/portal',
  '/api/portal',
  '/api/health',
  '/_next',
  '/favicon.ico',
];

export function isPublicStiHubPath(pathname: string, method = 'GET'): boolean {
  const clean = (pathname || '/').replace(/\/+$/, '') || '/';
  if (
    PUBLIC_PATH_PREFIXES.some(
      (prefix) => clean === prefix || clean.startsWith(`${prefix}/`)
    )
  ) {
    return true;
  }
  // Public proposal view & external ICP-Brasil client approval link (/proposta/[id]).
  // Restricts public access exclusively to individual proposal routes with a specific :id
  // (GET /api/erp/proposals/:id and POST /api/erp/proposals/:id/approve).
  // Root listing (GET /api/erp/proposals) is NEVER public.
  if (clean.startsWith('/api/erp/proposals/')) {
    const rest = clean.slice('/api/erp/proposals/'.length).trim();
    if (!rest) return false;
    const segments = rest.split('/').filter(Boolean);
    const upper = String(method || 'GET').toUpperCase();
    if (segments.length === 1 && upper === 'GET') {
      return true;
    }
    if (segments.length === 2 && segments[1] === 'approve' && upper === 'POST') {
      return true;
    }
  }
  return false;
}

export function classifyRouteRequiredModule(
  pathname: string
): StiHubMacroModule | null {
  const clean = (pathname || '/').toLowerCase();
  if (
    clean === '/erp' ||
    clean.startsWith('/erp/') ||
    clean.startsWith('/api/erp/')
  ) {
    return 'ERP';
  }
  if (
    clean === '/chamados' ||
    clean.startsWith('/chamados/') ||
    clean === '/api/tickets' ||
    clean.startsWith('/api/tickets/')
  ) {
    return 'CHAMADOS';
  }
  if (
    clean === '/crm' ||
    clean.startsWith('/crm/') ||
    clean === '/api/deals' ||
    clean.startsWith('/api/deals/') ||
    clean === '/api/pipelines' ||
    clean.startsWith('/api/pipelines/') ||
    clean === '/api/workflows' ||
    clean.startsWith('/api/workflows/') ||
    clean === '/api/sequences' ||
    clean.startsWith('/api/sequences/') ||
    clean === '/api/forms' ||
    clean.startsWith('/api/forms/') ||
    clean === '/api/data-health' ||
    clean.startsWith('/api/data-health/') ||
    clean === '/api/enrichment' ||
    clean.startsWith('/api/enrichment/') ||
    clean === '/api/migration' ||
    clean.startsWith('/api/migration/')
  ) {
    return 'CRM';
  }
  return null;
}

export function evaluateStiHubRouteProtection(input: {
  pathname: string;
  method?: string;
  sessionToken?: string | null;
  enforceStrictLock?: boolean;
}): {
  allowed: boolean;
  isPublicRoute: boolean;
  redirectTo: string | null;
  statusCode: number;
  reason: string;
  requiredModule?: StiHubMacroModule | null;
  claims?: StiHubSignedSessionClaims | null;
} {
  const isPublic = isPublicStiHubPath(input.pathname, input.method);
  if (isPublic) {
    return {
      allowed: true,
      isPublicRoute: true,
      redirectTo: null,
      statusCode: 200,
      reason: 'PUBLIC_ROUTE_ALLOWED',
    };
  }

  const verified = verifyStiHubSessionToken(input.sessionToken);
  const isApi = input.pathname.startsWith('/api/');
  const requiredModule = classifyRouteRequiredModule(input.pathname);

  if (verified.valid && verified.claims) {
    const claims = verified.claims;
    if (requiredModule) {
      const enabled = Array.isArray(claims.enabledModules)
        ? claims.enabledModules
        : ['CRM', 'ERP', 'CHAMADOS'];
      const modAccess = claims.moduleAccess || {
        crm: enabled.includes('CRM'),
        erp: enabled.includes('ERP'),
        chamados: enabled.includes('CHAMADOS'),
      };
      const hasModule =
        (requiredModule === 'CRM' && modAccess.crm) ||
        (requiredModule === 'ERP' && modAccess.erp) ||
        (requiredModule === 'CHAMADOS' && modAccess.chamados);

      if (!hasModule) {
        return {
          allowed: false,
          isPublicRoute: false,
          redirectTo: isApi ? null : `/?moduleBlocked=${requiredModule}`,
          statusCode: isApi ? 403 : 307,
          reason: `MODULE_${requiredModule}_FORBIDDEN`,
          requiredModule,
          claims,
        };
      }
    }

    return {
      allowed: true,
      isPublicRoute: false,
      redirectTo: null,
      statusCode: 200,
      reason: 'MFA_SESSION_VERIFIED',
      requiredModule,
      claims,
    };
  }

  if (input.enforceStrictLock !== false) {
    return {
      allowed: false,
      isPublicRoute: false,
      redirectTo: isApi ? null : `/login?next=${encodeURIComponent(input.pathname)}`,
      statusCode: isApi ? 401 : 307,
      reason:
        verified.reason === 'MISSING_SESSION_TOKEN'
          ? 'MFA_AUTH_REQUIRED'
          : verified.reason,
      requiredModule,
    };
  }

  return {
    allowed: true,
    isPublicRoute: false,
    redirectTo: null,
    statusCode: 200,
    reason: 'DEFAULT_ADMIN_SESSION_FALLBACK',
    requiredModule,
  };
}

function applySecurityHeaders(res: NextResponse, guardReason: string): NextResponse {
  res.headers.set('x-stihub-auth-guard', guardReason);
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'SAMEORIGIN');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.headers.set('X-XSS-Protection', '1; mode=block');
  return res;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicStiHubPath(pathname, req.method)) {
    return applySecurityHeaders(NextResponse.next(), 'public-allowed');
  }

  const sessionToken =
    req.cookies.get('stihub_session')?.value ||
    req.headers.get('x-stihub-session') ||
    null;

  const isLoggedOutCookie = req.cookies.get('stihub_logged_out')?.value === '1';
  const isApiRoute = pathname.startsWith('/api/');
  const hasSameOriginReferer = Boolean(
    req.headers.get('referer') &&
      req.headers.get('host') &&
      req.headers.get('referer')?.includes(req.headers.get('host') || '')
  );

  // Enforce strict MFA lock on all page routes, and on API routes whenever a token is present,
  // when logged out explicitly, or when called externally without same-origin session context.
  const enforceStrictLock =
    process.env.STI_HUB_STRICT_AUTH === 'false'
      ? false
      : isLoggedOutCookie || Boolean(sessionToken)
        ? true
        : isApiRoute
          ? !hasSameOriginReferer && process.env.STI_HUB_STRICT_API_AUTH === 'true'
          : true;

  const decision = evaluateStiHubRouteProtection({
    pathname,
    method: req.method,
    sessionToken,
    enforceStrictLock,
  });

  if (!decision.allowed) {
    if (decision.redirectTo) {
      return applySecurityHeaders(
        NextResponse.redirect(new URL(decision.redirectTo, req.url)),
        decision.reason
      );
    }
    return applySecurityHeaders(
      NextResponse.json(
        {
          error:
            decision.statusCode === 403
              ? `Acesso negado pela política IAM: seu usuário não possui o módulo ${decision.requiredModule} habilitado.`
              : 'Acesso não autorizado. Autenticação corporativa STI-hub + MFA 2FA obrigatória.',
          code: decision.reason,
          requiredModule: decision.requiredModule || undefined,
        },
        { status: decision.statusCode }
      ),
      decision.reason
    );
  }

  return applySecurityHeaders(NextResponse.next(), decision.reason);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
