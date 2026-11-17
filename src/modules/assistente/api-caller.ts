// ============================================================================
// STI-hub — Assistente de IA: chamada as rotas /api COMO o usuario logado.
// Mesmo portao do middleware (evaluateStiHubRouteProtection: sessao MFA + modulo) e depois
// o roteador com a sessao do usuario (sem contexto interno confiavel). Lista fixa de rotas:
// o assistente nao alcanca nenhuma rota fora das ferramentas da etapa 1.
// ============================================================================
import { evaluateStiHubRouteProtection } from '../../middleware';
import type { ApiCallRequest, ApiCallResponse, ApiCaller } from './tools';

const ALLOWED: Array<{ method: 'GET' | 'POST'; path: RegExp }> = [
  { method: 'GET', path: /^\/api\/erp\/contracts$/ },
  { method: 'GET', path: /^\/api\/erp\/overview$/ },
  { method: 'GET', path: /^\/api\/erp\/invoices$/ },
  { method: 'GET', path: /^\/api\/companies$/ },
  { method: 'GET', path: /^\/api\/contacts$/ },
  { method: 'GET', path: /^\/api\/deals$/ },
  { method: 'POST', path: /^\/api\/erp\/proposals$/ },
  { method: 'POST', path: /^\/api\/tickets$/ },
  { method: 'POST', path: /^\/api\/erp\/service-orders$/ },
  { method: 'POST', path: /^\/api\/assistente\/auditoria$/ },
];

export function isAllowedAssistenteRoute(method: string, path: string): boolean {
  const pathname = String(path || '').split('?')[0];
  if (pathname.includes('..') || pathname.includes('//') || /%2e|%2f/i.test(pathname)) return false;
  return ALLOWED.some((r) => r.method === method && r.path.test(pathname));
}

export type SessionDispatch = (req: ApiCallRequest) => Promise<ApiCallResponse>;

export function createSessionApiCaller(sessionToken: string, dispatch: SessionDispatch): ApiCaller {
  return async (req) => {
    if (!isAllowedAssistenteRoute(req.method, req.path)) {
      return { status: 403, body: { error: 'Rota fora do escopo do assistente.', code: 'ASSISTENTE_ROTA_NEGADA' } };
    }
    const pathname = req.path.split('?')[0];
    const decision = evaluateStiHubRouteProtection({ pathname, method: req.method, sessionToken, enforceStrictLock: true });
    if (!decision.allowed) {
      return {
        status: decision.statusCode === 403 ? 403 : 401,
        body: {
          error:
            decision.statusCode === 403
              ? `Acesso negado pela política IAM${decision.requiredModule ? `: módulo ${decision.requiredModule} não habilitado` : ''}.`
              : 'Sessão inválida ou expirada.',
          code: decision.reason,
        },
      };
    }
    return dispatch(req);
  };
}
