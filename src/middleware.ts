import { NextRequest, NextResponse } from 'next/server';
import {
  constantTimeEqual,
  StiHubSignedSessionClaims,
  verifyStiHubSessionToken,
} from './app/lib/auth';
import type { StiHubMacroModule } from './db/types';
import { evaluateServiceBearerAtEdge, parseServiceBearer } from './app/lib/service-account';
import { claimsMayManageIam, isIamAdminRoute, isSelfProfileRoute } from './app/lib/iam-admin-routes';

const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/convite',
  '/esqueci-senha',
  '/redefinir-senha',
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
  // Minha Conta (/api/auth/me, qualquer metodo/caixa/%2F): exige sessao MFA, apesar do prefixo /api/auth.
  if (isSelfProfileRoute(pathname)) return false;
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
    // Somente leitura (GET :id) e aceite do cliente (POST :id/approve) sao publicos.
    // PATCH :id (edicao) e POST :id/restore-version exigem sessao MFA + perfil ERP_ADMIN/ERP_COMMERCIAL.
    if (segments.length === 1 && upper === 'GET') {
      return true;
    }
    if (segments.length === 2 && segments[1] === 'approve' && upper === 'POST') {
      return true;
    }
  }
  return false;
}

function matchesApiPrefix(clean: string, prefix: string): boolean {
  return clean === prefix || clean.startsWith(`${prefix}/`);
}

/**
 * Rotas de API que SEMPRE exigem sessao autenticada valida (401 sem sessao),
 * independentemente de referer de mesma origem ou de variaveis de ambiente de relaxamento.
 */
export function isAlwaysProtectedApiPath(pathname: string, method = 'GET'): boolean {
  const clean = ((pathname || '/').replace(/\/+$/, '') || '/').toLowerCase();
  if (!clean.startsWith('/api/')) return false;
  if (isPublicStiHubPath(clean, method)) return false;
  if (matchesApiPrefix(clean, '/api/companies')) return true;
  if (matchesApiPrefix(clean, '/api/erp/financial')) return true;
  if (isProposalMutationPath(clean, method)) return true;
  return false;
}

/** PATCH /api/erp/proposals/:id ou POST /api/erp/proposals/:id/restore-version */
export function isProposalMutationPath(pathname: string, method = 'GET'): boolean {
  const clean = (pathname || '/').replace(/\/+$/, '') || '/';
  if (!clean.startsWith('/api/erp/proposals/')) return false;
  const segments = clean.slice('/api/erp/proposals/'.length).split('/').filter(Boolean);
  const upper = String(method || 'GET').toUpperCase();
  if (segments.length === 1 && upper === 'PATCH') return true;
  if (segments.length === 2 && segments[1] === 'restore-version' && upper === 'POST') return true;
  return false;
}

export const PROPOSAL_EDITOR_ERP_ROLES = ['ERP_ADMIN', 'ERP_COMMERCIAL'] as const;

const ERP_ACCOUNT_ROLES = [
  'ERP_ADMIN',
  'ERP_COMMERCIAL',
  'ERP_FINANCE',
  'ERP_STOCK_MANAGER',
  'ERP_CONTRACTS_OS',
  'ERP_PDV_BALCAO',
  'ERP_NONE',
];

// Mapeamento explicito dos perfis legados (roleId) para o tipo de conta ERP.
// Perfis desconhecidos resolvem para ERP_NONE (negar por padrao).
const LEGACY_ROLE_TO_ERP_ROLE: Record<string, string> = {
  SUPER_ADMIN: 'ERP_ADMIN',
  DIRETORIA: 'ERP_ADMIN',
  SALES_MANAGER: 'ERP_COMMERCIAL',
  GERENTE_COMERCIAL: 'ERP_COMMERCIAL',
  SALES_REP: 'ERP_COMMERCIAL',
  VENDEDOR_SALES: 'ERP_COMMERCIAL',
  MARKETING_SPECIALIST: 'ERP_NONE',
  ANALISTA_MARKETING: 'ERP_NONE',
  ERP_FINANCE_FISCAL: 'ERP_FINANCE',
  FINANCEIRO_FATURAMENTO: 'ERP_FINANCE',
  FISCAL_CONTABIL: 'ERP_FINANCE',
  STOCK_MANAGER: 'ERP_STOCK_MANAGER',
  GERENCIA_ESTOQUE: 'ERP_STOCK_MANAGER',
  SUPPORT_NOC_OS: 'ERP_CONTRACTS_OS',
  TECNICO_NOC_OS: 'ERP_CONTRACTS_OS',
  PDV_STOCK_OPERATOR: 'ERP_PDV_BALCAO',
  OPERADOR_PDV_ESTOQUE: 'ERP_PDV_BALCAO',
};

export function resolveErpAccountRoleFromClaims(
  claims: Pick<StiHubSignedSessionClaims, 'roleId' | 'erpPermissions'> & { erpRole?: string } | null | undefined
): string {
  if (!claims) return 'ERP_NONE';
  const explicit = String(claims.erpRole || '').toUpperCase();
  if (ERP_ACCOUNT_ROLES.includes(explicit)) return explicit;
  const fromPerms = String(claims.erpPermissions?.erpRole || '').toUpperCase();
  if (ERP_ACCOUNT_ROLES.includes(fromPerms)) return fromPerms;
  if (fromPerms && LEGACY_ROLE_TO_ERP_ROLE[fromPerms]) return LEGACY_ROLE_TO_ERP_ROLE[fromPerms];
  const legacy = String(claims.roleId || '').toUpperCase();
  return LEGACY_ROLE_TO_ERP_ROLE[legacy] || 'ERP_NONE';
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
    clean === '/api/marketing' ||
    clean.startsWith('/api/marketing/') ||
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

    if (isProposalMutationPath(input.pathname, input.method)) {
      const erpRole = resolveErpAccountRoleFromClaims(claims);
      if (!(PROPOSAL_EDITOR_ERP_ROLES as readonly string[]).includes(erpRole)) {
        return {
          allowed: false,
          isPublicRoute: false,
          redirectTo: null,
          statusCode: 403,
          reason: 'ERP_PROPOSAL_ROLE_FORBIDDEN',
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

  // Contencao 29/10/2026: NAO existe mais fallback anonimo (DEFAULT_ADMIN_SESSION_FALLBACK).
  // Sem sessao MFA assinada valida => 401 (API) ou redirect para /login (paginas), sempre.
  // enforceStrictLock e mantido na assinatura apenas por compatibilidade e e ignorado.
  void input.enforceStrictLock;
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

  // Conta de servico (Assistente de Vendas): Bearer stihub_svc_... SEM cookie/header de sessao.
  // Avaliada antes das rotas publicas: com Bearer de servico nada e "publico" (nem /api/auth/*).
  // Com cookie de sessao junto, o Bearer e ignorado (nunca mistura identidades).
  const svcToken = parseServiceBearer(req.headers.get('authorization'));
  const hasSessionCredential = Boolean(
    req.cookies.get('stihub_session')?.value || req.headers.get('x-stihub-session')
  );
  if (svcToken !== null && !hasSessionCredential) {
    const svc = evaluateServiceBearerAtEdge({ method: req.method, pathname, token: svcToken });
    if (!svc.allowed) {
      return applySecurityHeaders(
        NextResponse.json(
          {
            error:
              svc.status === 403
                ? 'Acesso negado: operação fora do escopo autorizado para a conta de serviço.'
                : 'Credencial de serviço inválida ou não habilitada.',
            code: svc.code,
          },
          { status: svc.status }
        ),
        svc.code
      );
    }
    return applySecurityHeaders(NextResponse.next(), 'service-account-bearer');
  }

  // HOTFIX 29/10/2026: rotas administrativas de IAM (/api/admin|rbac|iam/*, aliases,
  // qualquer caixa/barra/%2F) exigem sessao MFA + alcada IAM, em qualquer metodo. Avaliado
  // antes das rotas publicas porque /api/auth/send-invite ficava sob o prefixo publico /api/auth.
  if (isIamAdminRoute(pathname)) {
    const iamSessionToken =
      req.cookies.get('stihub_session')?.value || req.headers.get('x-stihub-session') || null;
    const v = verifyStiHubSessionToken(iamSessionToken);
    if (!v.valid || !v.claims || !v.claims.mfaVerified) {
      return applySecurityHeaders(
        NextResponse.json(
          { error: 'Acesso não autorizado. Autenticação corporativa STI-hub + MFA 2FA obrigatória.', code: 'MFA_AUTH_REQUIRED' },
          { status: 401 }
        ),
        'IAM_ADMIN_AUTH_REQUIRED'
      );
    }
    if (!claimsMayManageIam(v.claims)) {
      return applySecurityHeaders(
        NextResponse.json(
          {
            error: 'Permissão negada: seu perfil não possui alçada para consultar ou alterar usuários, papéis ou políticas IAM/RBAC.',
            code: 'IAM_ADMIN_FORBIDDEN',
          },
          { status: 403 }
        ),
        'IAM_ADMIN_FORBIDDEN'
      );
    }
  }

  if (isPublicStiHubPath(pathname, req.method)) {
    return applySecurityHeaders(NextResponse.next(), 'public-allowed');
  }

  const sessionToken =
    req.cookies.get('stihub_session')?.value ||
    req.headers.get('x-stihub-session') ||
    null;

  const isLoggedOutCookie = req.cookies.get('stihub_logged_out')?.value === '1';

  // Cron diario da Vercel (GET /api/erp/daily-sync): autorizado somente com
  // Authorization: Bearer <CRON_SECRET> quando CRON_SECRET estiver configurado.
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (
    cronSecret &&
    cronSecret.length >= 16 &&
    pathname === '/api/erp/daily-sync' &&
    req.method === 'GET' &&
    constantTimeEqual(req.headers.get('authorization') || '', `Bearer ${cronSecret}`)
  ) {
    return applySecurityHeaders(NextResponse.next(), 'cron-secret-allowed');
  }

  // Bloqueio estrito em todas as paginas e em todas as rotas /api nao publicas:
  // sem sessao MFA valida (cookie stihub_session ou header x-stihub-session) => 401 JSON.
  // Nao ha mais relaxamento por referer, STI_HUB_STRICT_AUTH ou STI_HUB_STRICT_API_AUTH.
  void isLoggedOutCookie;
  const enforceStrictLock = true;

  const decision = evaluateStiHubRouteProtection({
    pathname,
    method: req.method,
    sessionToken,
    enforceStrictLock,
  });

  if (!decision.allowed) {
    if (decision.redirectTo) {
      const redirectRes = NextResponse.redirect(new URL(decision.redirectTo, req.url));
      if (sessionToken && decision.statusCode !== 403) {
        redirectRes.cookies.delete('stihub_session');
      }
      return applySecurityHeaders(redirectRes, decision.reason);
    }
    return applySecurityHeaders(
      NextResponse.json(
        {
          error:
            decision.reason === 'ERP_PROPOSAL_ROLE_FORBIDDEN'
              ? 'Acesso negado: somente perfis ERP Administrador ou ERP Comercial podem editar ou restaurar versões de propostas.'
              : decision.statusCode === 403
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
