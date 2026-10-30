// ============================================================================
// STI-hub — Pacote C (29/10/2026)
// (2) senha nova >= 12 (reset, PATCH /me, convite, UIs); senhas existentes seguem validas
// (3) exigencia geral de sessao para TODA chamada a rota nao publica (so contexto confiavel)
//     e body._sessionToken nunca e lido
// (4) logout: cookie de remocao com os mesmos atributos + revogacao best-effort por instancia
// (5) /api/auth/session so pelo cookie (?token= ignorado)
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NextRequest } from 'next/server';
import { signStiHubSessionToken, STIHUB_TOTP_ROTATION_EPOCH } from '../src/app/lib/auth';
import { createInMemoryRepository } from '../src/db/repository';
import { buildClearSessionCookie, buildSessionCookie, CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import { PASSWORD_RESET_MIN_LENGTH, passwordVersionOf, signPasswordResetToken } from '../src/api/password-reset';
import { NEW_PASSWORD_MIN_LENGTH } from '../src/app/lib/password-policy';
import { forwardToCrmRouter } from '../src/app/api/_bridge';

const HTTP = { _fromHttpBridge: '1' };
const ADMIN = 'marcelo.mira@setatelecom.com.br';
const SELLER = 'vendedor.pacotec@setatelecom.com.br';
const PW12 = 'SenhaNova#2026A'; // 15
const PW11 = 'Curta#2026A'; // 11

function tokenFor(uid: string, email: string, roleId: string, extra: Record<string, unknown> = {}) {
  return signStiHubSessionToken({
    uid, email, name: 'Teste', roleId, scope: roleId === 'SUPER_ADMIN' ? 'TODOS' : 'PROPRIOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000, ...extra,
  } as Parameters<typeof signStiHubSessionToken>[0]);
}
const adminTok = () => tokenFor('usr-seta-01', ADMIN, 'SUPER_ADMIN', { canManageUsersRbac: true });
function withSeller(pw = 'SenhaAntiga8') {
  const repo = createInMemoryRepository();
  repo.upsertRbacUser({ email: SELLER, name: 'Vendedor C', roleId: 'VENDEDOR_SALES', password: pw } as Parameters<typeof repo.upsertRbacUser>[0]);
  repo.upsertRbacUser({ email: SELLER, totpConfigured: true, totpEpoch: STIHUB_TOTP_ROTATION_EPOCH } as Parameters<typeof repo.upsertRbacUser>[0]);
  const rec = repo.findRbacUserRecord('', SELLER)!;
  return { repo, rec, router: new CrmApiRouter(repo), tok: (e: Record<string, unknown> = {}) => tokenFor(rec.id, SELLER, 'VENDEDOR_SALES', e) };
}
function attrs(cookie: string): string[] {
  return cookie.split(';').slice(1).map((a) => a.trim()).filter((a) => !/^(Max-Age|Expires)=/i.test(a)).sort();
}

describe('Pacote C (2): senha nova com no minimo 12 caracteres', () => {
  it('constante unica = 12 (password-reset.ts e politica compartilhada)', () => {
    assert.equal(NEW_PASSWORD_MIN_LENGTH, 12);
    assert.equal(PASSWORD_RESET_MIN_LENGTH, 12);
  });

  it('redefinir senha: 11 => 400; 12+ => 200', async () => {
    const { repo, rec, router } = withSeller();
    const mk = () => signPasswordResetToken({ uid: rec.id, email: SELLER, pv: passwordVersionOf(repo.findRbacUserRecord(rec.id, '') as { passwordChangedAt?: string }) }).token;
    const short = await router.dispatch({ method: 'POST', path: '/api/auth/reset-password', query: { ...HTTP, _clientIp: '10.1.1.1' }, body: { token: mk(), password: PW11 } });
    assert.equal(short.status, 400);
    assert.match(JSON.stringify(short.body), /12 caracteres/);
    const ok = await router.dispatch({ method: 'POST', path: '/api/auth/reset-password', query: { ...HTTP, _clientIp: '10.1.1.1' }, body: { token: mk(), password: PW12 } });
    assert.equal(ok.status, 200);
  });

  it('PATCH /api/auth/me: newPassword com 11 => 400; com 12+ => 200', async () => {
    const { router, tok } = withSeller();
    const su = tok({ mfaStepUpAt: Date.now() - 1000 });
    const short = await router.dispatch({ method: 'PATCH', path: '/api/auth/me', query: { ...HTTP, _sessionToken: su }, body: { newPassword: PW11, currentPassword: 'SenhaAntiga8' } });
    assert.equal(short.status, 400);
    assert.match(JSON.stringify(short.body), /12 caracteres/);
    const ok = await router.dispatch({ method: 'PATCH', path: '/api/auth/me', query: { ...HTTP, _sessionToken: su }, body: { newPassword: PW12, currentPassword: 'SenhaAntiga8' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });

  it('aceite de convite: 11 => recusado; 12+ => senha salva', () => {
    const { repo } = withSeller();
    const inv1 = repo.createUserInvite(SELLER);
    const r1 = repo.acceptUserInvite({ token: inv1.inviteToken!, password: PW11 });
    assert.equal(r1.ok, false);
    assert.match(String(r1.error), /12 caracteres/);
    const r2 = repo.acceptUserInvite({ token: inv1.inviteToken!, password: PW12 });
    assert.equal(r2.ok, true, String(r2.error));
  });

  it('senha EXISTENTE com menos de 12 continua valida no login (nada e invalidado)', async () => {
    const { router: r2 } = withSeller('Antiga#88'); // 9 caracteres (senha existente)
    const login = await r2.dispatch({ method: 'POST', path: '/api/auth/login', query: { ...HTTP }, body: { email: SELLER, password: 'Antiga#88' } });
    assert.equal(login.status, 200);
  });

  it('UIs (convite/login, redefinir-senha, Minha Conta) usam a politica de 12 e nao falam mais em 6', () => {
    for (const f of ['src/app/login/page.tsx', 'src/app/redefinir-senha/page.tsx', 'src/app/components/UserAccountModal.tsx']) {
      const s = fs.readFileSync(f, 'utf8');
      assert.ok(s.includes('NEW_PASSWORD_MIN_LENGTH'), `${f} usa a constante`);
      assert.equal(/m[ií]n(imo|\.)?\s*(de\s*)?6\s*caracteres|minLength=\{6\}|length\s*<\s*6\b/i.test(s), false, `${f} sem regra de 6`);
    }
  });
});

describe('Pacote C (3): exigencia geral de sessao para toda chamada', () => {
  it('chamada INTERNA sem sessao a rota nao publica => 401; contexto confiavel => 200', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    for (const p of ['/api/deals', '/api/companies', '/api/bootstrap', '/api/erp/financial/summary', '/api/tickets']) {
      const r = await router.dispatch({ method: 'GET', path: p });
      assert.equal(r.status, 401, `${p} interno sem sessao`);
    }
    const ok = await router.dispatch({ method: 'GET', path: '/api/deals', context: TRUSTED_INTERNAL_CONTEXT });
    assert.equal(ok.status, 200);
  });

  it('body._sessionToken nunca e lido (interno ou HTTP); query._sessionToken (bridge) vale', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    const admin = adminTok();
    assert.equal((await router.dispatch({ method: 'GET', path: '/api/deals', body: { _sessionToken: admin } })).status, 401);
    assert.equal((await router.dispatch({ method: 'POST', path: '/api/deals', query: { ...HTTP }, body: { _sessionToken: admin, title: 'x' } })).status, 401);
    assert.equal((await router.dispatch({ method: 'GET', path: '/api/admin/users', body: { _sessionToken: admin } })).status, 401);
    assert.equal((await router.dispatch({ method: 'GET', path: '/api/deals', query: { _sessionToken: admin } })).status, 200);
    const viaBridge = await forwardToCrmRouter(new NextRequest('https://sti-hub.local/api/deals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ _sessionToken: admin }) }));
    assert.equal(viaBridge.status, 401);
  });

  it('_cronAuthorized em chamada interna (sem bridge) nao libera o daily-sync', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    assert.equal((await router.dispatch({ method: 'GET', path: '/api/erp/daily-sync', query: { _cronAuthorized: '1' } })).status, 401);
  });

  it('nenhum body._sessionToken no router', () => {
    const s = fs.readFileSync('src/api/router.ts', 'utf8');
    assert.equal(/typeof body\._sessionToken/.test(s), false);
  });
});

describe('Pacote C (4): logout com cookie de remocao igual ao de sessao + revogacao best-effort', () => {
  it('cookie de remocao tem os mesmos atributos (Path, HttpOnly, SameSite, Secure) do cookie de sessao', async () => {
    const prev = process.env.VERCEL;
    try {
      for (const v of ['1', undefined]) {
        if (v === undefined) delete process.env.VERCEL; else process.env.VERCEL = v;
        const set = buildSessionCookie('abc.def');
        const clear = buildClearSessionCookie();
        assert.deepEqual(attrs(clear), attrs(set), `VERCEL=${v}`);
        assert.match(clear, /^stihub_session=;/);
        assert.match(clear, /Max-Age=0/);
        if (v === '1') assert.ok(attrs(clear).includes('Secure'));
        const router = new CrmApiRouter(createInMemoryRepository());
        const out = await router.dispatch({ method: 'POST', path: '/api/auth/logout', query: { ...HTTP } });
        assert.equal(out.headers?.['Set-Cookie'], clear);
      }
    } finally {
      if (prev === undefined) delete process.env.VERCEL; else process.env.VERCEL = prev;
    }
  });

  it('token usado no logout fica revogado nesta instancia ate expirar; outro token segue valido', async () => {
    const { router, tok } = withSeller();
    const t = tok();
    const other = tok({ iat: Date.now() - 500 });
    assert.equal((await router.dispatch({ method: 'GET', path: '/api/auth/me', query: { ...HTTP, _sessionToken: t } })).status, 200);
    const out = await router.dispatch({ method: 'POST', path: '/api/auth/logout', query: { ...HTTP, _sessionToken: t } });
    assert.equal(out.status, 200);
    assert.equal((await router.dispatch({ method: 'GET', path: '/api/auth/me', query: { ...HTTP, _sessionToken: t } })).status, 401, 'revogado');
    assert.equal((await router.dispatch({ method: 'GET', path: '/api/deals', query: { ...HTTP, _sessionToken: t } })).status, 401, 'revogado em qualquer rota');
    const sess = await router.dispatch({ method: 'GET', path: '/api/auth/session', query: { ...HTTP, _sessionToken: t } });
    assert.equal((sess.body as { data: { authenticated: boolean } }).data.authenticated, false);
    assert.equal((await router.dispatch({ method: 'GET', path: '/api/auth/me', query: { ...HTTP, _sessionToken: other } })).status, 200, 'outro token intacto');
  });
});

describe('Pacote C (5): /api/auth/session so pelo cookie', () => {
  it('?token= (query ou caminho) e ignorado; cookie via bridge autentica', async () => {
    const { router, tok, repo } = withSeller();
    void repo;
    const t = tok();
    const viaQuery = await router.dispatch({ method: 'GET', path: '/api/auth/session', query: { ...HTTP, token: t } });
    assert.equal((viaQuery.body as { data: { authenticated: boolean } }).data.authenticated, false);
    const viaPath = await router.dispatch({ method: 'GET', path: `/api/auth/session?token=${encodeURIComponent(t)}`, query: { ...HTTP } });
    assert.equal((viaPath.body as { data: { authenticated: boolean } }).data.authenticated, false);
    const viaCookie = await router.dispatch({ method: 'GET', path: '/api/auth/session', query: { ...HTTP, _sessionToken: t } });
    assert.equal((viaCookie.body as { data: { authenticated: boolean } }).data.authenticated, true);
    const src = fs.readFileSync('src/api/router.ts', 'utf8');
    assert.equal(/query\.token\s*\|\|\s*query\._sessionToken/.test(src), false);
  });
});
