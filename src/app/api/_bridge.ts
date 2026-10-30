import { NextRequest, NextResponse } from 'next/server';
import { BRIDGE_RESERVED_KEYS, CrmApiRouter } from '../../api/router';
import { constantTimeEqual, STIHUB_TOTP_ENROLLED_COOKIE } from '../lib/auth';
import { hashServiceToken, parseServiceBearer, SERVICE_MAX_BODY_BYTES } from '../lib/service-account';

const router = new CrmApiRouter();

/** Remove do corpo do cliente toda chave interna reservada ao bridge (_fromHttpBridge, _cronAuthorized, _sessionToken...). */
export function stripReservedBodyKeys(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const out = { ...(body as Record<string, unknown>) };
  for (const k of BRIDGE_RESERVED_KEYS) delete out[k];
  return out;
}

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

  // Conta de servico: Bearer stihub_svc_... sem credencial de sessao. O token bruto nao
  // segue adiante: o router recebe so o SHA-256 e revalida tudo (defesa em profundidade).
  const svcToken = sessionCookie ? null : parseServiceBearer(req.headers.get('authorization'));
  if (svcToken !== null) {
    const declaredLen = Number(req.headers.get('content-length') || '0');
    if (Number.isFinite(declaredLen) && declaredLen > SERVICE_MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: 'Corpo da requisição acima do limite permitido para a conta de serviço.', code: 'SVC_BODY_TOO_LARGE' },
        { status: 413, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    const svcQuery: Record<string, string | undefined> = { ...query };
    delete svcQuery._sessionToken;
    svcQuery._svcBearer = '1';
    svcQuery._svcTokenSha256 = svcToken ? hashServiceToken(svcToken) : '';
    const forwardedForSvc = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '';
    svcQuery._clientIp = forwardedForSvc.split(',')[0]?.trim() || undefined;
    svcQuery._fromHttpBridge = '1';
    let svcBody: unknown = undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const text = await req.text().catch(() => '');
      if (text.length > SERVICE_MAX_BODY_BYTES) {
        return NextResponse.json(
          { error: 'Corpo da requisição acima do limite permitido para a conta de serviço.', code: 'SVC_BODY_TOO_LARGE' },
          { status: 413, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      try {
        svcBody = text ? JSON.parse(text) : {};
      } catch {
        svcBody = {};
      }
    }
    const svcRes = await router.dispatch({ method: req.method, path, query: svcQuery, body: stripReservedBodyKeys(svcBody) });
    const svcHeaders: Record<string, string> = {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'no-referrer',
    };
    for (const [k, v] of Object.entries(svcRes.headers || {})) {
      if (k.toLowerCase() !== 'set-cookie') svcHeaders[k] = v; // conta de servico nunca recebe cookie
    }
    return NextResponse.json(svcRes.body, { status: svcRes.status, headers: svcHeaders });
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

  // As chaves internas da query sao SEMPRE definidas aqui (sobrescrevem qualquer valor);
  // _cronAuthorized so existe se o Bearer CRON_SECRET bateu acima.
  if (query._cronAuthorized !== '1') delete query._cronAuthorized;
  const res = await router.dispatch({
    method: req.method,
    path,
    query,
    body: stripReservedBodyKeys(body),
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
