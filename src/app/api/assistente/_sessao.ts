// STI-hub — Assistente: sessão do usuário (cookie stihub_session + MFA) comum às rotas do
// assistente, e a rota genérica das conversas / memória aprendida / regras de acessórios.
import { NextRequest, NextResponse } from 'next/server';
import { verifyStiHubSessionToken } from '../../lib/auth';
import { isSessionTokenRevoked } from '../../lib/session-revocation';
import { readBodyWithCap } from '../../lib/bridge-body-limit';
import type { AssistenteUser } from '../../../modules/assistente/tools';
import { getAssistenteStore } from '../../../modules/assistente/conversas-store';
import { handleAssistenteApi, type ApiReq } from '../../../modules/assistente/conversas-api';

export const NO_STORE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export const jsonAssistente = (status: number, body: unknown) => NextResponse.json(body, { status, headers: NO_STORE });

export type SessaoAssistente = { user: AssistenteUser; sessionToken: string };

/** Usuário da sessão MFA, ou null. */
export function sessaoAssistente(req: NextRequest): SessaoAssistente | null {
  const sessionToken = req.cookies.get('stihub_session')?.value || req.headers.get('x-stihub-session') || '';
  const verified = sessionToken && !isSessionTokenRevoked(sessionToken) ? verifyStiHubSessionToken(sessionToken) : null;
  const claims = verified?.valid ? verified.claims : null;
  if (!claims || !claims.mfaVerified || !claims.uid) return null;
  const enabled = Array.isArray(claims.enabledModules) ? claims.enabledModules : [];
  const ma = claims.moduleAccess || { crm: enabled.includes('CRM'), erp: enabled.includes('ERP'), chamados: enabled.includes('CHAMADOS') };
  return {
    sessionToken,
    user: {
      uid: String(claims.uid),
      email: String(claims.email || ''),
      name: String(claims.name || ''),
      roleId: String(claims.roleId || ''),
      moduleAccess: { crm: ma.crm === true, erp: ma.erp === true, chamados: ma.chamados === true },
    },
  };
}

const MAX_BODY = 600_000;

/** Rota genérica: /api/assistente/{conversas|memorias|regras}/... */
export async function rotaAssistenteApi(req: NextRequest, recurso: 'conversas' | 'memorias' | 'regras', slug: string[] | undefined): Promise<NextResponse> {
  const s = sessaoAssistente(req);
  if (!s) return jsonAssistente(401, { error: 'Sessão corporativa STI-hub com MFA obrigatória.', code: 'MFA_AUTH_REQUIRED' });
  const method = req.method.toUpperCase() as ApiReq['method'];
  // Mutação só da própria origem (defesa extra contra CSRF além do SameSite do cookie).
  if (method !== 'GET') {
    const origin = req.headers.get('origin');
    if (origin && origin !== new URL(req.url).origin) return jsonAssistente(403, { error: 'Origem não permitida.', code: 'ORIGEM' });
  }
  let body: unknown = undefined;
  if (method !== 'GET') {
    const capped = await readBodyWithCap(req, MAX_BODY);
    if (!capped.ok) return jsonAssistente(413, { error: 'Pedido grande demais.', code: 'BODY_TOO_LARGE' });
    try {
      body = capped.text ? JSON.parse(capped.text) : undefined;
    } catch {
      return jsonAssistente(400, { error: 'JSON inválido.', code: 'ENTRADA_INVALIDA' });
    }
  }
  try {
    const out = await handleAssistenteApi({ method, segs: [recurso, ...(slug || [])], query: new URL(req.url).searchParams, body }, s.user, getAssistenteStore());
    return jsonAssistente(out.status, out.body);
  } catch (e) {
    console.error('[assistente] erro na API de conversas', e instanceof Error ? e.message : 'erro');
    return jsonAssistente(500, { error: 'Erro interno.', code: 'ERRO_INTERNO' });
  }
}
