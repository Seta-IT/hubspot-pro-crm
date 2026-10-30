// ============================================================================
// STI-hub — HOTFIX 29/10/2026: regressao dos DOIS vazamentos para anonimos + menores.
// (1) /api/auth/session sem sessao devolvia o perfil SUPER_ADMIN (fallback usr-seta-01).
// (2) /api/portal/tickets sem filtro listava todos os chamados (CNPJ, contrato, comentarios).
// + token HMAC por chamado do portal (pronto, ainda nao aceito pelas rotas).
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signStiHubSessionToken, verifyStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';
import {
  PORTAL_GENERIC_DENIED_MESSAGE,
  PORTAL_IP_LIMIT,
  PORTAL_KEY_LIMIT,
  signPortalTicketAccessToken,
  verifyPortalTicketAccessToken,
} from '../src/api/portal-access';

const HTTP = { _fromHttpBridge: '1' };
const ADMIN = 'marcelo.mira@setatelecom.com.br';

function tokenFor(uid: string, email: string, roleId: string, extra: Record<string, unknown> = {}) {
  return signStiHubSessionToken({
    uid, email, name: 'Teste', roleId, scope: roleId === 'SUPER_ADMIN' ? 'TODOS' : 'PROPRIOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000, ...extra,
  } as Parameters<typeof signStiHubSessionToken>[0]);
}
const adminTok = () => tokenFor('usr-seta-01', ADMIN, 'SUPER_ADMIN', { canManageUsersRbac: true });

function fresh() {
  const repo = createInMemoryRepository();
  return { repo, router: new CrmApiRouter(repo) };
}
let ipSeq = 0;
const nextIp = () => `198.51.100.${(ipSeq++ % 250) + 1}`;

function ticketWithContact(repo: ReturnType<typeof createInMemoryRepository>) {
  const t = repo.listServiceTickets().find((x) => x.contactId && repo.getContactById(x.contactId)?.email);
  assert.ok(t, 'seed precisa de um chamado com contato');
  const email = repo.getContactById(t!.contactId!)!.email;
  return { t: t!, email };
}

// ---------------------------------------------------------------------------
describe('HOTFIX (1): /api/auth/session sem sessao NAO tem usuario', () => {
  const SENSITIVE = /usr-seta-01|SUPER_ADMIN|marcelo\.mira|"user"|"role"|effectiveActionGuards|Permissions|enabledModules|moduleAccess/;

  it('sem cookie => exatamente {authenticated:false, mfaVerified:false}', async () => {
    const { router } = fresh();
    for (const method of ['GET', 'POST'] as const) {
      const r = await router.dispatch({ method, path: '/api/auth/session', query: { ...HTTP }, body: {} });
      assert.equal(r.status, 200);
      assert.deepEqual((r.body as { data: unknown }).data, { authenticated: false, mfaVerified: false });
      assert.doesNotMatch(JSON.stringify(r.body), SENSITIVE);
    }
  });

  it('token invalido/adulterado/expirado => sem usuario', async () => {
    const { router } = fresh();
    const good = adminTok();
    const bad = [
      'lixo',
      `${good.slice(0, -3)}AAA`,
      tokenFor('usr-seta-01', ADMIN, 'SUPER_ADMIN', { exp: Date.now() - 1000 }),
    ];
    for (const tok of bad) {
      const r = await router.dispatch({ method: 'GET', path: '/api/auth/session', query: { ...HTTP, _sessionToken: tok }, body: {} });
      assert.deepEqual((r.body as { data: unknown }).data, { authenticated: false, mfaVerified: false });
      assert.doesNotMatch(JSON.stringify(r.body), SENSITIVE);
    }
  });

  it('token assinado de usuario inexistente/sem e-mail NAO cai no primeiro usuario (SUPER_ADMIN)', () => {
    const { repo } = fresh();
    const tok = tokenFor('usr-nao-existe', '', 'VENDEDOR_SALES');
    const s = repo.resolveSessionFromToken(tok);
    assert.equal(s.authenticated, false);
    assert.doesNotMatch(JSON.stringify(s), SENSITIVE);
  });

  it('sessao real do admin segue funcionando', async () => {
    const { router } = fresh();
    const r = await router.dispatch({ method: 'GET', path: '/api/auth/session', query: { ...HTTP, _sessionToken: adminTok() }, body: {} });
    const d = (r.body as { data: { authenticated: boolean; user?: { id: string } } }).data;
    assert.equal(d.authenticated, true);
    assert.equal(d.user?.id, 'usr-seta-01');
  });

  it('repositorio: busca estrita sem fallback; MFA sem identificador/usuario inexistente falha', () => {
    const { repo } = fresh();
    assert.equal(repo.findEffectiveUserAndRole(''), null);
    assert.equal(repo.findEffectiveUserAndRole('ninguem@exemplo.com'), null);
    assert.throws(() => repo.getEffectiveUserAndRole('ninguem@exemplo.com'), /STIHUB_USER_NOT_FOUND/);
    assert.throws(() => repo.getEffectiveUserAndRole(undefined), /STIHUB_USER_NOT_FOUND/);
    assert.equal(repo.verifyMfaAndCreateSession({ code: '123456' }).ok, false);
    assert.equal(repo.verifyMfaAndCreateSession({ email: 'ninguem@exemplo.com', code: '123456' }).ok, false);
  });

  it('/api/auth/setup-totp sem alvo => 400 (antes caia no e-mail do admin)', async () => {
    const { router } = fresh();
    const r = await router.dispatch({ method: 'GET', path: '/api/auth/setup-totp', query: { ...HTTP }, body: {} });
    assert.equal(r.status, 400);
    assert.doesNotMatch(JSON.stringify(r.body), /otpauth|marcelo\.mira|secret/i);
  });

  it('GET /api/auth/me sem sessao => 401 sem dados', async () => {
    const { router } = fresh();
    const r = await router.dispatch({ method: 'GET', path: '/api/auth/me', query: { ...HTTP }, body: {} });
    assert.equal(r.status, 401);
    assert.doesNotMatch(JSON.stringify(r.body), SENSITIVE);
  });
});

// ---------------------------------------------------------------------------
describe('HOTFIX (2): /api/portal/* — nunca lista; chave + e-mail; DTO minimo; auditoria', () => {
  const get = (router: CrmApiRouter, q: Record<string, string>, ip = nextIp()) =>
    router.dispatch({ method: 'GET', path: '/api/portal/tickets', query: { ...HTTP, _clientIp: ip, ...q }, body: {} });

  it('sem filtro completo => 400 e nenhum dado (inclusive ?search= e so um dos campos)', async () => {
    const { repo, router } = fresh();
    const { t, email } = ticketWithContact(repo);
    for (const q of [{}, { search: 'a' }, { search: '' }, { key: t.key }, { email }, { ticket: t.key }, { key: '', email }]) {
      const r = await get(router, q as Record<string, string>);
      assert.equal(r.status, 400, JSON.stringify(q));
      const s = JSON.stringify(r.body);
      assert.equal((r.body as { data?: unknown }).data, undefined);
      assert.doesNotMatch(s, new RegExp(t.subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  it('chave errada, e-mail errado e chamado inexistente => MESMA resposta generica (404)', async () => {
    const { repo, router } = fresh();
    const { t, email } = ticketWithContact(repo);
    const a = await get(router, { key: t.key, email: 'outra.pessoa@exemplo.com' });
    const b = await get(router, { key: 'SD-999999', email });
    const c = await get(router, { key: t.key.toLowerCase() === t.key ? `${t.key}X` : t.key.toLowerCase(), email });
    for (const r of [a, b, c]) {
      assert.equal(r.status, 404);
      assert.deepEqual(r.body, { error: PORTAL_GENERIC_DENIED_MESSAGE, code: 'PORTAL_NOT_FOUND' });
    }
  });

  it('chave + e-mail corretos (e-mail sem diferenciar maiusculas) => DTO publico minimo', async () => {
    const { repo, router } = fresh();
    const { t, email } = ticketWithContact(repo);
    repo.addTicketComment(t.id, { author: 'NOC', authorRole: 'AGENT', isInternal: true, body: 'NOTA-INTERNA-SECRETA-XYZ' });
    repo.addTicketComment(t.id, { author: 'terceiro@outra.com', authorRole: 'AGENT', isInternal: false, body: 'resposta publica' });
    const r = await get(router, { key: t.key, email: `  ${email.toUpperCase()} ` });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const d = (r.body as { data: Record<string, unknown> }).data;
    assert.deepEqual(Object.keys(d).sort(), ['comments', 'createdAt', 'key', 'resolvedAt', 'status', 'subject', 'updatedAt']);
    assert.equal(d.key, t.key);
    const s = JSON.stringify(r.body);
    assert.doesNotMatch(s, /NOTA-INTERNA-SECRETA-XYZ|isInternal|cnpj|contract|contactId|companyId|serviceOrder|"cc|@/i);
    for (const c of d.comments as Array<Record<string, unknown>>) {
      assert.deepEqual(Object.keys(c).sort(), ['author', 'authorRole', 'body', 'createdAt']);
    }
  });

  it('rate-limit por IP', async () => {
    const { repo, router } = fresh();
    const { email } = ticketWithContact(repo);
    const ip = '203.0.113.7';
    let last = 0;
    for (let i = 0; i <= PORTAL_IP_LIMIT.max; i++) last = (await get(router, { key: `SD-${1000 + i}`, email }, ip)).status;
    assert.equal(last, 429);
  });

  it('rate-limit por chave do chamado (mesmo vindo de IPs diferentes)', async () => {
    const { repo, router } = fresh();
    const { t, email } = ticketWithContact(repo);
    let last = 0;
    for (let i = 0; i <= PORTAL_KEY_LIMIT.max; i++) last = (await get(router, { key: t.key, email: `x${i}@ataque.com` })).status;
    assert.equal(last, 429);
    // a chave bloqueada nao abre nem com o e-mail certo enquanto durar a janela
    assert.equal((await get(router, { key: t.key, email })).status, 429);
  });

  it('toda consulta (sucesso, negada, sem filtro, rate-limit) gera auditoria, com e-mail mascarado', async () => {
    const { repo, router } = fresh();
    const { t, email } = ticketWithContact(repo);
    const count = () => (repo.getRbacState().auditLogs || []).filter((l) => l.action.startsWith('PORTAL_')).length;
    const before = count();
    await get(router, {});
    await get(router, { key: t.key, email: 'errado@exemplo.com' });
    await get(router, { key: t.key, email });
    assert.equal(count(), before + 3);
    const logs = (repo.getRbacState().auditLogs || []).filter((l) => l.action.startsWith('PORTAL_'));
    assert.ok(logs.some((l) => l.status === 'SUCCESS'));
    assert.ok(logs.some((l) => l.status === 'BLOCKED'));
    for (const l of logs) {
      assert.equal(l.module, 'CHAMADOS');
      assert.ok(!JSON.stringify(l).includes(email.toLowerCase()), 'e-mail completo nao vai para a auditoria');
      assert.notEqual(l.actorRole, 'SUPER_ADMIN');
    }
  });

  it('reply e csat exigem chave + e-mail; respondem so o DTO minimo', async () => {
    const { repo, router } = fresh();
    const { t, email } = ticketWithContact(repo);
    const post = (action: string, body: Record<string, unknown>) =>
      router.dispatch({ method: 'POST', path: `/api/portal/tickets/${encodeURIComponent(t.key)}/${action}`, query: { ...HTTP, _clientIp: nextIp() }, body });
    assert.equal((await post('reply', { body: 'oi' })).status, 400);
    const wrong = await post('reply', { body: 'oi', email: 'intruso@exemplo.com' });
    assert.equal(wrong.status, 404);
    assert.deepEqual(wrong.body, { error: PORTAL_GENERIC_DENIED_MESSAGE, code: 'PORTAL_NOT_FOUND' });
    const commentsBefore = repo.getServiceTicketById(t.id)!.comments.length;
    assert.equal(repo.getServiceTicketById(t.id)!.comments.length, commentsBefore);
    const ok = await post('reply', { body: 'retorno do cliente', email });
    assert.equal(ok.status, 201);
    assert.deepEqual(Object.keys((ok.body as { data: object }).data).sort(), ['comments', 'createdAt', 'key', 'resolvedAt', 'status', 'subject', 'updatedAt']);
    assert.equal((await post('csat', { score: 5 })).status, 400);
    assert.equal((await post('csat', { score: 5, email: 'intruso@exemplo.com' })).status, 404);
    const cs = await post('csat', { score: 4, email });
    assert.equal(cs.status, 200);
    assert.doesNotMatch(JSON.stringify(cs.body), /cnpj|contract|contactId|csatScore|@/i);
  });

  it('abertura de chamado devolve so o DTO minimo; outras rotas /api/portal/* => 404 generico', async () => {
    const { router } = fresh();
    const r = await router.dispatch({
      method: 'POST', path: '/api/portal/tickets', query: { ...HTTP, _clientIp: nextIp() },
      body: { subject: 'Queda do link', email: 'novo.cliente@exemplo.com', name: 'Novo Cliente', description: 'sem sinal' },
    });
    assert.equal(r.status, 201);
    assert.deepEqual(Object.keys((r.body as { data: object }).data).sort(), ['comments', 'createdAt', 'key', 'resolvedAt', 'status', 'subject', 'updatedAt']);
    for (const [method, path] of [['GET', '/api/portal/tickets/SD-1'], ['DELETE', '/api/portal/tickets'], ['GET', '/api/portal/contacts']] as const) {
      const x = await router.dispatch({ method, path, query: { ...HTTP, _clientIp: nextIp() }, body: {} });
      assert.equal(x.status, 404, `${method} ${path}`);
      assert.equal((x.body as { data?: unknown }).data, undefined);
    }
  });
});

// ---------------------------------------------------------------------------
describe('Portal: token HMAC por chamado (pronto, ainda nao aceito pelas rotas)', () => {
  it('assina/verifica; adulterado, expirado, outro chamado ou outro e-mail => invalido', () => {
    const { token, claims } = signPortalTicketAccessToken({ ticketId: 'SD-7', email: 'Cliente@Exemplo.com', expiresInMs: 60_000 });
    assert.equal(claims.em, 'cliente@exemplo.com');
    assert.equal(verifyPortalTicketAccessToken(token, { ticketId: 'SD-7', email: 'CLIENTE@exemplo.com' }).valid, true);
    assert.equal(verifyPortalTicketAccessToken(`${token.slice(0, -2)}xx`).valid, false);
    assert.equal(verifyPortalTicketAccessToken(token, { ticketId: 'SD-8' }).valid, false);
    assert.equal(verifyPortalTicketAccessToken(token, { email: 'outro@exemplo.com' }).valid, false);
    assert.equal(verifyPortalTicketAccessToken(token, { nowMs: claims.exp + 1 }).valid, false);
  });

  it('chave separada: token do portal nao e sessao e sessao nao e token do portal', () => {
    const { token } = signPortalTicketAccessToken({ ticketId: 'SD-7', email: 'c@e.com' });
    assert.equal(verifyStiHubSessionToken(token).valid, false);
    assert.equal(verifyPortalTicketAccessToken(adminTok()).valid, false);
  });

  it('as rotas ainda nao aceitam o token (sem e-mail => 400)', async () => {
    const { repo, router } = fresh();
    const { t, email } = ticketWithContact(repo);
    const { token } = signPortalTicketAccessToken({ ticketId: t.key, email });
    const r = await router.dispatch({ method: 'GET', path: '/api/portal/tickets', query: { ...HTTP, _clientIp: nextIp(), key: t.key, token }, body: {} });
    assert.equal(r.status, 400);
  });
});
