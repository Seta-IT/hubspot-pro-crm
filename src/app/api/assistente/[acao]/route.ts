// STI-hub — Assistente de IA interno (etapa 1): POST /api/assistente/chat e /api/assistente/executar.
// A sessao e a do usuario logado (cookie stihub_session); as ferramentas passam pelo mesmo
// bridge/roteador da tela. Nenhum segredo vai ao navegador nem ao modelo.
import { NextRequest, NextResponse } from 'next/server';
import { forwardToCrmRouter } from '../../_bridge';
import { resolveStiHubSigningSecret, STIHUB_TOTP_ENROLLED_COOKIE, verifyStiHubSessionToken } from '../../../lib/auth';
import { isSessionTokenRevoked } from '../../../lib/session-revocation';
import { readBodyWithCap } from '../../../lib/bridge-body-limit';
import { SlidingWindowRateLimiter } from '../../../../api/password-reset';
import { ASSISTENTE_LIMITS, readAssistenteConfig } from '../../../../modules/assistente/config';
import { createOmniRouteClient } from '../../../../modules/assistente/omniroute-client';
import { createSessionApiCaller } from '../../../../modules/assistente/api-caller';
import { sessionBinding, signAuditReceipt } from '../../../../modules/assistente/confirmation';
import { handleChat, handleExecute, type AssistenteDeps } from '../../../../modules/assistente/service';
import type { AssistenteUser } from '../../../../modules/assistente/tools';
import { resolveIntegrationDeps } from '../../../../modules/integration/runtime';
import { randomBytes } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 90 s: principal (OMNIROUTE_TIMEOUT_MS) + reserva com o resto do orcamento de 80 s.
export const maxDuration = 90;

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const limiters = new Map<string, SlidingWindowRateLimiter>();
const usedNonces = new Map<string, number>();

function memoryHit(bucket: string, limit: number, windowMs: number): boolean {
  const key = `${limit}:${windowMs}`;
  let l = limiters.get(key);
  if (!l) {
    l = new SlidingWindowRateLimiter(limit, windowMs);
    limiters.set(key, l);
  }
  return l.hit(bucket);
}

async function distributedHit(bucket: string, limit: number, windowMs: number, failClosed = false): Promise<boolean> {
  // Store do Postgres (mesma tabela de rate-limit da API v1). Rate-limit de chat falha aberto
  // (disponibilidade). Consumo do nonce de confirmacao falha fechado: sem store, nao executa de novo.
  try {
    const store = resolveIntegrationDeps().store;
    if (!store) return !failClosed;
    const now = Date.now();
    const start = Math.floor(now / windowMs) * windowMs;
    const r = await store.hitRateLimit(`assistente:${bucket}`, new Date(start).toISOString(), new Date(now).toISOString());
    return r.count <= limit;
  } catch {
    return !failClosed;
  }
}

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(req: NextRequest, { params }: { params: { acao: string } }) {
  const acao = params?.acao;
  if (acao !== 'chat' && acao !== 'executar') return json(404, { error: 'Não encontrado.' });

  const sessionToken = req.cookies.get('stihub_session')?.value || req.headers.get('x-stihub-session') || '';
  const verified = sessionToken && !isSessionTokenRevoked(sessionToken) ? verifyStiHubSessionToken(sessionToken) : null;
  const claims = verified?.valid ? verified.claims : null;
  if (!claims || !claims.mfaVerified || !claims.uid) {
    return json(401, { error: 'Sessão corporativa STI-hub com MFA obrigatória.', code: 'MFA_AUTH_REQUIRED' });
  }

  const capped = await readBodyWithCap(req, ASSISTENTE_LIMITS.maxBodyBytes);
  if (!capped.ok) return json(413, { error: 'Pedido grande demais.', code: 'BODY_TOO_LARGE' });
  let body: unknown = null;
  try {
    body = capped.text ? JSON.parse(capped.text) : null;
  } catch {
    return json(400, { error: 'JSON inválido.', code: 'ENTRADA_INVALIDA' });
  }

  let secret: string;
  try {
    secret = resolveStiHubSigningSecret();
  } catch {
    return json(503, { error: 'Assistente indisponível.', code: 'ASSISTENTE_INDISPONIVEL' });
  }

  const enabled = Array.isArray(claims.enabledModules) ? claims.enabledModules : [];
  const ma = claims.moduleAccess || { crm: enabled.includes('CRM'), erp: enabled.includes('ERP'), chamados: enabled.includes('CHAMADOS') };
  const user: AssistenteUser = {
    uid: String(claims.uid),
    email: String(claims.email || ''),
    name: String(claims.name || ''),
    roleId: String(claims.roleId || ''),
    moduleAccess: { crm: ma.crm === true, erp: ma.erp === true, chamados: ma.chamados === true },
  };

  const origin = new URL(req.url).origin;
  const enrolled = req.cookies.get(STIHUB_TOTP_ENROLLED_COOKIE)?.value;
  const api = createSessionApiCaller(sessionToken, async (r) => {
    // Requisicao interna identica a da tela: mesmo cookie de sessao, mesmo bridge e roteador.
    const headers = new Headers({ 'content-type': 'application/json', accept: 'application/json' });
    headers.set('cookie', `stihub_session=${sessionToken}${enrolled ? `; ${STIHUB_TOTP_ENROLLED_COOKIE}=${enrolled}` : ''}`);
    for (const h of ['x-forwarded-for', 'x-real-ip', 'x-vercel-forwarded-for', 'user-agent']) {
      const v = req.headers.get(h);
      if (v) headers.set(h, v);
    }
    const inner = new NextRequest(new URL(r.path, origin), {
      method: r.method,
      headers,
      body: r.method === 'POST' || r.method === 'PATCH' ? JSON.stringify(r.body || {}) : undefined,
    });
    const res = await forwardToCrmRouter(inner);
    let out: unknown = null;
    try {
      out = await res.json();
    } catch {
      out = null;
    }
    return { status: res.status, body: out };
  });

  const cfg = readAssistenteConfig();
  const deps: AssistenteDeps = {
    llm: cfg ? createOmniRouteClient(cfg) : null,
    api,
    user,
    secret,
    sid: sessionBinding(sessionToken),
    now: () => Date.now(),
    async rateLimit(bucket, limit, windowMs) {
      if (!memoryHit(bucket, limit, windowMs)) return false;
      return distributedHit(bucket, limit, windowMs);
    },
    async consumeNonce(nonce, ttlMs) {
      const now = Date.now();
      for (const [k, exp] of usedNonces) if (exp < now) usedNonces.delete(k);
      if (usedNonces.has(nonce)) return false;
      // Fail-closed no store: se o rate-limit compartilhado nao estiver disponivel, recusa
      // em vez de permitir replay do token de confirmacao em outra instancia.
      const ok = await distributedHit(`nonce:${nonce}`, 1, Math.max(ttlMs, 60_000), true);
      if (ok) usedNonces.set(nonce, now + ttlMs);
      return ok;
    },
    async audit(entry) {
      const recibo = signAuditReceipt(secret, { uid: user.uid, ...entry, at: Date.now(), n: randomBytes(8).toString('hex') });
      const r = await api({ method: 'POST', path: '/api/assistente/auditoria', body: { recibo } }).catch(() => null);
      if (!r || r.status !== 201) console.error('[assistente] falha ao gravar auditoria', r?.status ?? 'erro');
    },
  };

  const out = acao === 'chat' ? await handleChat(body, deps) : await handleExecute(body, deps);
  return json(out.status, out.body);
}
