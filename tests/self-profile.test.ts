// ============================================================================
// STI-hub — PATCH /api/auth/me (Minha Conta, self-service): 12 testes da spec
// /workspace/specs/self-profile-patch-auth-me.md + GET /api/auth/me sem sessao => 401.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { signStiHubSessionToken, STIHUB_TOTP_ROTATION_EPOCH } from '../src/app/lib/auth';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';
import { SELF_PROFILE_DENYLIST } from '../src/api/self-profile';
import { hashServiceToken, SALES_AGENT_SERVICE_ID, SALES_AGENT_TOKEN_ENV } from '../src/app/lib/service-account';
import { middleware } from '../src/middleware';

const HTTP = { _fromHttpBridge: '1' };
const SELLER_EMAIL = 'vendedor.perfil@setatelecom.com.br';
const SELLER_PW = 'SenhaVendedor#2026';
const NEW_PW = 'NovaSenhaVend#2027';
const SENSITIVE = /"(totpSecret|totpSecretFormatted|passwordHash|otpauthUri|currentTotpCode|demoTotpCode|otpCode|sessionToken|qrCodeSvgDataUrl)"/;

function setup() {
  const repo = createInMemoryRepository();
  repo.upsertRbacUser({
    email: SELLER_EMAIL, name: 'Vendedor Perfil', roleId: 'VENDEDOR_SALES', password: SELLER_PW,
    phone: '(11) 3958-4929', department: 'Comercial', jobTitle: 'Executivo de Contas',
  } as Parameters<typeof repo.upsertRbacUser>[0]);
  repo.upsertRbacUser({ email: SELLER_EMAIL, totpConfigured: true, totpEpoch: STIHUB_TOTP_ROTATION_EPOCH, mfaMethod: 'TOTP_AUTHENTICATOR' } as Parameters<typeof repo.upsertRbacUser>[0]);
  const rec = repo.findRbacUserRecord('', SELLER_EMAIL)!;
  const router = new CrmApiRouter(repo);
  const tok = (extra: Record<string, unknown> = {}) =>
    signStiHubSessionToken({
      uid: rec.id, email: SELLER_EMAIL, name: rec.name, roleId: 'VENDEDOR_SALES', scope: 'PROPRIOS',
      enabledModules: ['CRM'], moduleAccess: { crm: true, erp: false, chamados: false },
      mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000, ...extra,
    } as Parameters<typeof signStiHubSessionToken>[0]);
  const patch = (body: Record<string, unknown>, t: string | null = tok(), path = '/api/auth/me', q: Record<string, string> = {}) =>
    router.dispatch({ method: 'PATCH', path, query: { ...HTTP, ...(t ? { _sessionToken: t } : {}), ...q }, body });
  const snapshot = () => JSON.stringify(repo.findRbacUserRecord(rec.id, '')!);
  return { repo, router, rec, tok, patch, snapshot, stepUp: () => tok({ mfaStepUpAt: Date.now() - 1000 }) };
}
const code = (r: { body: unknown }) => (r.body as { code?: string }).code;

describe('PATCH /api/auth/me (Minha Conta, self-service)', () => {
  it('1. sem sessao => 401; sem MFA => 401; conta de servico => 403; GET sem sessao => 401 sem perfil', async () => {
    const { patch, tok, router } = setup();
    assert.equal((await patch({ name: 'X Y' }, null)).status, 401);
    assert.equal((await patch({ name: 'X Y' }, tok({ mfaVerified: false }))).status, 401);
    const anonGet = await router.dispatch({ method: 'GET', path: '/api/auth/me', query: { ...HTTP } });
    assert.equal(anonGet.status, 401);
    assert.equal(JSON.stringify(anonGet.body).includes('"profile"'), false);
    const internalGet = await router.dispatch({ method: 'GET', path: '/api/auth/me' });
    assert.equal(internalGet.status, 401, 'chamada interna sem sessao tambem 401');
    // conta de servico (Bearer stihub_svc_), router e middleware
    const token = `stihub_svc_${randomBytes(32).toString('base64url')}`;
    const prev = process.env[SALES_AGENT_TOKEN_ENV];
    process.env[SALES_AGENT_TOKEN_ENV] = createHash('sha256').update(token).digest('hex');
    try {
      const { repo, router: r2 } = setup();
      repo.setServiceAccountActive(SALES_AGENT_SERVICE_ID, true, { email: 'marcelo.mira@setatelecom.com.br' });
      const svc = await r2.dispatch({ method: 'PATCH', path: '/api/auth/me', query: { ...HTTP, _svcBearer: '1', _svcTokenSha256: hashServiceToken(token), _clientIp: '200.1.1.1' }, body: { name: 'Robo' } });
      assert.equal(svc.status, 403);
      const mw = middleware(new NextRequest('https://sti-hub.local/api/auth/me', { method: 'PATCH', headers: { authorization: `Bearer ${token}` } }));
      assert.equal(mw.status, 403);
    } finally {
      if (prev === undefined) delete process.env[SALES_AGENT_TOKEN_ENV];
      else process.env[SALES_AGENT_TOKEN_ENV] = prev;
    }
  });

  it('2. vendedor altera name e phone => 200 e so esses campos mudam', async () => {
    const { patch, repo, rec } = setup();
    const before = { ...repo.findRbacUserRecord(rec.id, '')! } as Record<string, unknown>;
    const res = await patch({ name: '  Vendedor   Renomeado ', phone: '(11) 98765-4321' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const after = repo.findRbacUserRecord(rec.id, '')! as unknown as Record<string, unknown>;
    assert.equal(after.name, 'Vendedor Renomeado');
    assert.notEqual(after.phone, before.phone);
    for (const k of Object.keys(before)) {
      if (['name', 'phone', 'updatedAt'].includes(k)) continue;
      assert.deepEqual(after[k], before[k], `campo ${k} nao pode mudar`);
    }
    const dto = (res.body as { data: { user: Record<string, unknown> } }).data.user;
    assert.deepEqual(Object.keys(dto).filter((k) => k !== 'iamSeal').sort(), ['avatarUrl', 'department', 'email', 'id', 'jobTitle', 'mfaMethod', 'name', 'phone', 'preferences', 'roleId']);
  });

  it('3. cada campo proibido (denylist, _*, department/jobTitle, newEmail, desconhecido) => 400 e registro inalterado', async () => {
    const fields = [...SELF_PROFILE_DENYLIST, '_sessionToken', '_qualquer', 'department', 'jobTitle', 'newEmail', 'campoInventado', 'userId'];
    for (const f of fields) {
      const { patch, snapshot } = setup();
      const before = snapshot();
      const res = await patch({ [f]: f === 'active' ? false : 'SUPER_ADMIN', name: 'Nome Valido' });
      assert.equal(res.status, 400, `${f} => 400`);
      assert.ok(['SELF_PROFILE_FORBIDDEN_FIELD', 'SELF_TARGET_ONLY'].includes(String(code(res))), `${f}: ${code(res)}`);
      assert.ok(((res.body as { rejectedKeys?: string[] }).rejectedKeys || []).includes(f), `${f} listado`);
      assert.equal(snapshot(), before, `${f}: registro inalterado`);
    }
    const { patch } = setup();
    const nested = await patch({ preferences: { homeScreen: null, roleId: 'SUPER_ADMIN' } });
    assert.equal(nested.status, 400, 'chave extra dentro de preferences tambem e rejeitada');
  });

  it('4. alvo de outro usuario no corpo ou na URL => 400 SELF_TARGET_ONLY e o outro fica intacto', async () => {
    const { patch, repo } = setup();
    const other = JSON.stringify(repo.findRbacUserRecord('usr-seta-01', 'marcelo.mira@setatelecom.com.br'));
    for (const body of [{ id: 'usr-seta-01', name: 'Hack' }, { userId: 'usr-seta-01', name: 'Hack' }, { email: 'marcelo.mira@setatelecom.com.br', name: 'Hack' }]) {
      const r = await patch(body);
      assert.equal(r.status, 400);
      assert.equal(code(r), 'SELF_TARGET_ONLY');
    }
    const viaUrl = await patch({ name: 'Hack' }, undefined, '/api/auth/me?userId=usr-seta-01');
    assert.equal(viaUrl.status, 400);
    assert.equal(JSON.stringify(repo.findRbacUserRecord('usr-seta-01', 'marcelo.mira@setatelecom.com.br')), other);
  });

  it('5. newPassword: 403 sem step-up; 401 com senha atual errada (contador sobe); 200 certo, sessoes antigas invalidas e login com a nova', async () => {
    const { patch, stepUp, tok, repo, router } = setup();
    const oldSession = tok();
    const no = await patch({ newPassword: NEW_PW, currentPassword: SELLER_PW });
    assert.equal(no.status, 403);
    assert.equal(code(no), 'STEP_UP_REQUIRED');
    const su = stepUp();
    const before = repo.getFailedPasswordAttempts(SELLER_EMAIL);
    const wrong = await patch({ newPassword: NEW_PW, currentPassword: 'senha-errada-123' }, su);
    assert.equal(wrong.status, 401);
    assert.equal(repo.getFailedPasswordAttempts(SELLER_EMAIL), before + 1, 'contador de falhas sobe');
    const ok = await patch({ newPassword: NEW_PW, currentPassword: SELLER_PW }, su);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const cookie = String(ok.headers?.['Set-Cookie'] || '');
    assert.match(cookie, /^stihub_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax/);
    const newTok = decodeURIComponent(cookie.match(/stihub_session=([^;]*)/)![1]);
    assert.equal((await router.dispatch({ method: 'GET', path: '/api/auth/me', query: { ...HTTP, _sessionToken: oldSession } })).status, 401, 'sessao antiga invalidada');
    assert.equal((await router.dispatch({ method: 'GET', path: '/api/auth/me', query: { ...HTTP, _sessionToken: newTok } })).status, 200, 'cookie novo vale');
    const loginNew = await router.dispatch({ method: 'POST', path: '/api/auth/login', query: { ...HTTP }, body: { email: SELLER_EMAIL, password: NEW_PW } });
    assert.equal(loginNew.status, 200, 'login com a senha nova');
    const loginOld = await router.dispatch({ method: 'POST', path: '/api/auth/login', query: { ...HTTP }, body: { email: SELLER_EMAIL, password: SELLER_PW } });
    assert.notEqual(loginOld.status, 200, 'senha antiga nao vale mais');
    // 5 erros em 15 min => bloqueio
    const s2 = setup();
    const su2 = s2.stepUp();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await s2.patch({ newPassword: NEW_PW, currentPassword: `errada-${i}-xyz` }, su2)).status);
    assert.deepEqual(statuses, [401, 401, 401, 401, 429]);
  });

  it('6. mfaMethod: 403 sem step-up, 200 com step-up; TOTP sem pareamento => 400', async () => {
    const { patch, stepUp, repo, rec } = setup();
    assert.equal((await patch({ mfaMethod: 'EMAIL_OTP' })).status, 403);
    assert.equal(repo.findRbacUserRecord(rec.id, '')!.mfaMethod, 'TOTP_AUTHENTICATOR');
    const ok = await patch({ mfaMethod: 'EMAIL_OTP' }, stepUp());
    assert.equal(ok.status, 200);
    assert.equal(repo.findRbacUserRecord(rec.id, '')!.mfaMethod, 'EMAIL_OTP');
    repo.upsertRbacUser({ email: SELLER_EMAIL, totpConfigured: false } as Parameters<typeof repo.upsertRbacUser>[0]);
    const unpaired = await patch({ mfaMethod: 'TOTP_AUTHENTICATOR' }, stepUp());
    assert.equal(unpaired.status, 400);
    assert.equal(code(unpaired), 'TOTP_NOT_PAIRED');
  });

  it('7. step-up com mais de 10 min => 403', async () => {
    const { patch, tok } = setup();
    const r = await patch({ mfaMethod: 'EMAIL_OTP' }, tok({ mfaStepUpAt: Date.now() - 11 * 60 * 1000 }));
    assert.equal(r.status, 403);
    assert.equal(code(r), 'STEP_UP_REQUIRED');
  });

  it('8. PATCH misto sem step-up => 403 e o name nao muda (atomico)', async () => {
    const { patch, snapshot } = setup();
    const before = snapshot();
    const r = await patch({ name: 'Nome Novo Misto', newPassword: NEW_PW, currentPassword: SELLER_PW });
    assert.equal(r.status, 403);
    assert.equal(snapshot(), before);
  });

  it('9. 11a requisicao no minuto => 429 PROFILE_RATE_LIMITED', async () => {
    const { patch } = setup();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await patch({ name: `Nome Teste ${i}` })).status);
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(200));
    assert.equal(statuses[10], 429);
  });

  it('10. respostas (GET e PATCH) nunca trazem totpSecret, passwordHash, otpauthUri nem currentTotpCode', async () => {
    const { patch, router, tok, stepUp } = setup();
    const t = tok();
    const g = await router.dispatch({ method: 'GET', path: '/api/auth/me', query: { ...HTTP, _sessionToken: t } });
    assert.equal(g.status, 200);
    assert.equal(SENSITIVE.test(JSON.stringify(g.body)), false);
    for (const r of [await patch({ name: 'Nome Seguro' }), await patch({ newPassword: NEW_PW, currentPassword: SELLER_PW }, stepUp())]) {
      assert.equal(r.status, 200);
      assert.equal(SENSITIVE.test(JSON.stringify(r.body)), false);
    }
  });

  it('11. a auditoria registra so nomes de campos (sem senha, codigo ou segredo)', async () => {
    const { patch, stepUp, repo } = setup();
    await patch({ roleId: 'SUPER_ADMIN' });
    await patch({ mfaMethod: 'EMAIL_OTP' });
    await patch({ newPassword: NEW_PW, currentPassword: 'senha-errada-999' }, stepUp());
    await patch({ name: 'Nome Auditado', phone: '(11) 98765-4321' });
    await patch({ newPassword: NEW_PW, currentPassword: SELLER_PW }, stepUp());
    const logs = repo.listSecurityAuditLogs(200).logs.filter((l) => String(l.resource).includes('/api/auth/me'));
    const actions = logs.map((l) => l.action);
    for (const a of ['SELF_PROFILE_FORBIDDEN_FIELD', 'SELF_PROFILE_STEP_UP_REQUIRED', 'SELF_PROFILE_UPDATED', 'SELF_PASSWORD_CHANGED']) {
      assert.ok(actions.includes(a), `auditoria ${a}`);
    }
    // actorName e a identidade do ator (nao um valor do PATCH); todo o resto nao pode ter valores.
    const all = JSON.stringify(logs.map(({ actorName: _n, ...rest }) => rest));
    for (const secret of [NEW_PW, SELLER_PW, 'senha-errada-999', 'Nome Auditado', '98765-4321']) {
      assert.equal(all.includes(secret), false, 'auditoria sem valores');
    }
  });

  it('12. /API/AUTH/ME/ e %2F seguem a mesma regra; PATCH/GET anonimos barrados no middleware', async () => {
    const { patch, repo, rec } = setup();
    for (const p of ['/API/AUTH/ME/', '/api/auth%2Fme', '/api//auth/me']) {
      assert.equal((await patch({ name: 'Nome Variante' }, null, p)).status, 401, `${p} anonimo`);
      assert.equal((await patch({ roleId: 'SUPER_ADMIN' }, undefined, p)).status, 400, `${p} denylist`);
    }
    assert.equal(repo.findRbacUserRecord(rec.id, '')!.roleId, 'VENDEDOR_SALES');
    for (const p of ['/api/auth/me', '/API/AUTH/ME/', '/api/auth%2Fme', '/api/auth/me/']) {
      for (const m of ['PATCH', 'GET']) {
        const res = middleware(new NextRequest(`https://sti-hub.local${p}`, { method: m }));
        // /api/... => 401 JSON; variante em caixa alta e tratada como pagina => 307 para /login.
        assert.ok([401, 307].includes(res.status), `middleware ${m} ${p} anonimo barrado (${res.status})`);
        assert.equal(res.headers.get('x-middleware-next'), null, `${m} ${p} nao segue adiante`);
      }
    }
    // sessao valida passa pelo middleware
    const { tok } = setup();
    const ok = middleware(new NextRequest('https://sti-hub.local/api/auth/me', { method: 'PATCH', headers: { cookie: `stihub_session=${tok()}` } }));
    assert.notEqual(ok.status, 401);
  });
});

describe('UserAccountModal integrado ao PATCH /api/auth/me', () => {
  it('usa PATCH /api/auth/me, nao envia mfaEnabled/department/jobTitle e trata STEP_UP_REQUIRED', async () => {
    const fs = await import('node:fs');
    const m = fs.readFileSync('src/app/components/UserAccountModal.tsx', 'utf8');
    assert.ok(m.includes("fetch('/api/auth/me'") && m.includes("method: 'PATCH'"));
    assert.equal(m.includes('/api/admin/users'), false, 'nao usa mais a rota de admin');
    assert.equal(/mfaEnabled\s*:/.test(m), false);
    assert.equal(/patch\.(department|jobTitle)\s*=/.test(m), false, 'departamento/cargo somente leitura');
    assert.ok(m.includes("'STEP_UP_REQUIRED'") && m.includes('patch.currentPassword = currentPassword'));
  });
});
