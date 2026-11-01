// ============================================================================
// STI-hub — Pacote I (01/11/2026): config GestaoClick (D2) com 2FA + admin/ERP FULL, allowlist
// e auditoria; leitura da config sem campos tecnicos; contador de login por HMAC do e-mail (D1);
// limite por IP + e-mail (D3); sessao do navegador sem segredos em qualquer nivel (8); newStatus
// do comentario de chamado; contrato sem chaves desconhecidas; ownerName canonico do RBAC;
// ContactDetailDrawer sem ownerName vazio.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { signStiHubSessionToken, sanitizeActiveSessionForStorage } from '../src/app/lib/auth';
import { createInMemoryRepository, CrmRepository } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import { buildFullControlForModule } from '../src/modules/erp/rbac-seed';
import { parseGestaoClickConfigPatch, toGestaoClickConfigView, GESTAOCLICK_CONFIG_EDITABLE_KEYS } from '../src/api/gestaoclick-config-guard';
import { RENTAL_CONTRACT_PATCH_KEYS, RENTAL_CONTRACT_SERVER_ONLY_KEYS, pickRentalContractPatch } from '../src/api/contract-patch-guard';
import { LoginIpFailureGuard } from '../src/api/login-ip-guard';
import { parseTicketCommentStatus } from '../src/api/ticket-guards';
import { buildOwnerCanonicalMap, resolveOwnerNameToStore } from '../src/api/owner-validation';

const HTTP = { _fromHttpBridge: '1' };
const ROOT = path.resolve(__dirname, '..', '..');
const src = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const tok = (uid: string, email: string, roleId: string, extra: Record<string, unknown> = {}) =>
  signStiHubSessionToken({
    uid, email, name: 'Teste', roleId, scope: roleId === 'SUPER_ADMIN' ? 'TODOS' : 'PROPRIOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000, ...extra,
  } as Parameters<typeof signStiHubSessionToken>[0]);
const ADMIN_EMAIL = 'marcelo.mira@setatelecom.com.br';
const SELLER_EMAIL = 'marialuiza@setatelecom.com.br';
const adminTok = (extra: Record<string, unknown> = {}) => tok('usr-seta-01', ADMIN_EMAIL, 'SUPER_ADMIN', { canManageUsersRbac: true, ...extra });
const sellerTok = () => tok('usr-seta-03', SELLER_EMAIL, 'VENDEDOR_SALES');
const A = () => ({ ...HTTP, _sessionToken: adminTok() });
const S = () => ({ ...HTTP, _sessionToken: sellerTok() });
type Body = { code?: string; error?: string; data?: Record<string, unknown> };

describe('Pacote I (D2): PATCH/POST /api/erp/gestaoclick/config', () => {
  const cfgOf = (repo: CrmRepository) => repo.getErpOverview().gestaoClickConfig;
  const send = (router: CrmApiRouter, body: Record<string, unknown>, q: Record<string, string>, method = 'PATCH') =>
    router.dispatch({ method, path: '/api/erp/gestaoclick/config', query: q, body });

  it('vendedor => 403 (PATCH e POST) e nada muda; anonimo => 401; admin sem 2FA => 401/403; tentativa auditada', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const before = JSON.stringify(cfgOf(repo));
    const attack = { defaultIssRatePercent: 42, taxRegime: 'SIMPLES_NACIONAL', companyCnpj: '00.000.000/0001-91', autoGenerateMonthlyRentalInvoices: false };
    for (const m of ['PATCH', 'POST']) {
      const r = await send(router, attack, S(), m);
      assert.equal(r.status, 403, m);
      assert.equal((r.body as Body).code, 'GESTAOCLICK_CONFIG_FORBIDDEN');
    }
    assert.equal((await send(router, { taxRegime: 'LUCRO_REAL' }, { ...HTTP })).status, 401);
    const noMfa = await send(router, { taxRegime: 'LUCRO_REAL' }, { ...HTTP, _sessionToken: adminTok({ mfaVerified: false }) });
    assert.ok([401, 403].includes(noMfa.status), String(noMfa.status));
    assert.equal(JSON.stringify(cfgOf(repo)), before, 'config intacta');
    assert.ok(repo.listSecurityAuditLogs(10000).logs.some((l) => l.action === 'GESTAOCLICK_CONFIG_UPDATE_DENIED' && l.actorEmail === SELLER_EMAIL));
  });

  it('admin com 2FA salva os campos da tela; auditoria com antes e depois, sem segredos', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const prevIss = cfgOf(repo).defaultIssRatePercent;
    const r = await send(router, { defaultIssRatePercent: 2.5, taxRegime: 'LUCRO_REAL', storeName: 'Matriz I', companyCnpj: '14.806.925/0001-32', municipalRegistration: '123', stateRegistration: 'ISENTO', companyLegalName: 'SETA TELECOM LTDA' }, A());
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const cfg = cfgOf(repo);
    assert.equal(cfg.defaultIssRatePercent, 2.5);
    assert.equal(cfg.taxRegime, 'LUCRO_REAL');
    assert.equal(cfg.storeName, 'Matriz I');
    const log = repo.listSecurityAuditLogs(10000).logs.find((l) => l.action === 'GESTAOCLICK_CONFIG_UPDATED')!;
    assert.ok(log, 'auditoria gravada');
    assert.equal(log.actorEmail, ADMIN_EMAIL);
    assert.match(log.details, /"field":"defaultIssRatePercent","before":[^,]+,"after":2\.5/);
    assert.ok(log.details.includes(String(prevIss)));
    assert.ok(!/Masked|token|apiBaseUrl/i.test(log.details));
    const data = (r.body as Body).data!;
    assert.ok(!String(data.accessTokenMasked || '').includes('218b7f'), 'resposta com mascara curta');
  });

  it('usuario com controle TOTAL do ERP (nao admin) e 2FA => 200', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const seller = repo.findRbacUserRecord('usr-seta-03', SELLER_EMAIL)!;
    repo.upsertRbacUser({ ...seller, ...buildFullControlForModule('ERP', seller) } as never);
    const r = await send(router, { taxRegime: 'LUCRO_REAL' }, S());
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  it('campos proibidos/desconhecidos/invalidos => 400 (mesmo para admin) e nada muda', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const before = JSON.stringify(cfgOf(repo));
    const bodies: Array<[Record<string, unknown>, string]> = [
      [{ apiBaseUrl: 'https://evil.example' }, 'GESTAOCLICK_CONFIG_FIELD_NOT_ALLOWED'],
      [{ mcpServerUrl: 'https://evil.example' }, 'GESTAOCLICK_CONFIG_FIELD_NOT_ALLOWED'],
      [{ accessTokenMasked: 'x' }, 'GESTAOCLICK_CONFIG_FIELD_NOT_ALLOWED'],
      [{ secretTokenMasked: 'x' }, 'GESTAOCLICK_CONFIG_FIELD_NOT_ALLOWED'],
      [{ fooMasked: 'x' }, 'GESTAOCLICK_CONFIG_FIELD_NOT_ALLOWED'],
      [{ syncHistory: [] }, 'GESTAOCLICK_CONFIG_FIELD_NOT_ALLOWED'],
      [{ liveTotals: {} }, 'GESTAOCLICK_CONFIG_FIELD_NOT_ALLOWED'],
      [{ users: [] }, 'GESTAOCLICK_CONFIG_FIELD_NOT_ALLOWED'],
      [{ API_BASE_URL: 'x' }, 'GESTAOCLICK_CONFIG_FIELD_NOT_ALLOWED'],
      [{ autoGenerateMonthlyRentalInvoices: 'false' }, 'GESTAOCLICK_CONFIG_INVALID'], // Pacote J (D-I2): booleano estrito
      [{ connected: false }, 'GESTAOCLICK_CONFIG_FIELD_NOT_ALLOWED'],
      [{ lastSyncAt: 'x' }, 'GESTAOCLICK_CONFIG_FIELD_NOT_ALLOWED'],
      [{ taxRegime: 'LUCRO_REAL', __proto__x: 1 }, 'GESTAOCLICK_CONFIG_FIELD_NOT_ALLOWED'],
      [{ defaultIssRatePercent: 42 }, 'GESTAOCLICK_CONFIG_INVALID'],
      [{ defaultIssRatePercent: '2' }, 'GESTAOCLICK_CONFIG_INVALID'],
      [{ taxRegime: 'MEI' }, 'GESTAOCLICK_CONFIG_INVALID'],
      [{ companyCnpj: '11.222.333/0001-81' }, 'GESTAOCLICK_CONFIG_INVALID'],
      [{ companyCnpj: '14.806.925/0001-00' }, 'GESTAOCLICK_CONFIG_INVALID'],
      [{}, 'GESTAOCLICK_CONFIG_EMPTY'],
    ];
    for (const [body, code] of bodies) {
      const r = await send(router, body, A());
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal((r.body as Body).code, code, JSON.stringify(body));
      assert.ok(!JSON.stringify(r.body).includes('evil.example'));
    }
    const proto = JSON.parse('{"__proto__": {"x": 1}, "taxRegime": "LUCRO_REAL"}');
    assert.equal((await send(router, proto, A())).status, 400);
    assert.equal(JSON.stringify(cfgOf(repo)), before);
  });

  it('allowlist = exatamente os campos que a tela de config envia', () => {
    const tab = src('src/app/components/ErpGestaoClickTab.tsx');
    const sent = new Set<string>(['taxRegime', 'autoGenerateMonthlyRentalInvoices']); // handleChangeTaxRegime; Pacote J (D-I2): auto-NF so pela API privilegiada
    for (const m of tab.matchAll(/\{ key: ["'](companyLegalName|companyCnpj|municipalRegistration|stateRegistration|defaultIssRatePercent|storeName)["']/g)) sent.add(m[1]);
    assert.deepEqual([...GESTAOCLICK_CONFIG_EDITABLE_KEYS].sort(), [...sent].sort());
    assert.equal(parseGestaoClickConfigPatch({ taxRegime: 'LUCRO_REAL' }).ok, true);
    assert.match(tab, /gcConfigErrorMessage/);
  });

  it('GET (status, overview, bootstrap): nao-admin nao recebe tokens mascarados, URLs nem usuarios; admin so mascara curta', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const cfg = repo.getErpOverview().gestaoClickConfig as unknown as Record<string, unknown>;
    cfg.users = [{ id: 'u1', nome: 'GC User', email: 'gc.user@exemplo.com', telefone: '11999990000', ativo: true }];
    cfg.apiBaseUrl = 'https://api.gestaoclick.example';
    const reads = async (q: Record<string, string>) => {
      const st = await router.dispatch({ method: 'GET', path: '/api/erp/gestaoclick/status', query: q });
      const ov = await router.dispatch({ method: 'GET', path: '/api/erp/overview', query: q });
      const bs = await router.dispatch({ method: 'GET', path: '/api/bootstrap', query: q });
      return [
        (st.body as Body).data!,
        ((ov.body as Body).data as Record<string, unknown>).gestaoClickConfig as Record<string, unknown>,
        (((bs.body as Body).data as Record<string, unknown>).erp as Record<string, unknown>).gestaoClickConfig as Record<string, unknown>,
      ];
    };
    for (const v of await reads(S())) {
      assert.ok(v && typeof v === 'object');
      const j = JSON.stringify(v);
      assert.ok(!j.includes('218b7f') && !j.includes('d5402c') && !j.includes('826f0'), 'sem pedaco do token');
      assert.ok(!j.includes('gc.user@exemplo.com') && !j.includes('api.gestaoclick.example'));
      assert.equal(v.companyCnpj, '14.806.925/0001-32', 'dados fiscais continuam visiveis');
    }
    for (const v of await reads(A())) {
      const j = JSON.stringify(v);
      assert.ok(!j.includes('218b7f'), 'admin: sem o inicio do token');
      assert.match(String(v.accessTokenMasked), /^••••.{4}$/);
    }
    const anon = await router.dispatch({ method: 'GET', path: '/api/erp/gestaoclick/status', query: { ...HTTP } });
    assert.equal(anon.status, 401);
    assert.equal(toGestaoClickConfigView({ accessTokenMasked: '' }, false).accessTokenMasked, '');
  });
});

describe('Pacote I (D1): contador de login por HMAC do e-mail, igual para conta real e inexistente', () => {
  it('com o mapa cheio, conta real e e-mail inexistente travam no mesmo erro; vitima bloqueada continua bloqueada', () => {
    const repo = createInMemoryRepository();
    const REAL = SELLER_EMAIL;
    const FAKE = 'ninguem.aqui@setatelecom.com.br';
    const VICTIM = ADMIN_EMAIL;
    for (let i = 0; i < 6; i++) repo.initiateLoginChallenge(VICTIM, 'Errada#2026XX', '203.0.113.1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = (repo as any).loginAttemptTracker as Map<string, unknown>;
    const now = Date.now();
    for (let i = 0; map.size < CrmRepository.LOGIN_TRACKER_MAX; i++) {
      map.set(`k${i}`, { failedAttempts: 1, firstAttemptMs: now, lockedUntilMs: 0, lastAttemptMs: now });
    }
    const lockedAt = (email: string) => {
      for (let i = 1; i <= 12; i++) {
        const r = repo.initiateLoginChallenge(email, 'Errada#2026XX', '203.0.113.9');
        if (/bloqueada/.test(String(r.error))) return i;
      }
      return -1;
    };
    const realAt = lockedAt(REAL);
    const fakeAt = lockedAt(FAKE);
    assert.equal(realAt, 7);
    assert.equal(fakeAt, realAt, 'mesmo comportamento: nao revela quem tem conta');
    assert.match(String(repo.initiateLoginChallenge(VICTIM, 'Errada#2026XX').error), /bloqueada/);
    assert.ok(map.size <= CrmRepository.LOGIN_TRACKER_MAX);
    assert.ok(![...map.keys()].some((k) => k.includes('@')), 'e-mail em claro nao fica no mapa (so as chaves de teste)');
  });
  it('sem mapa cheio: conta real e inexistente tambem travam no mesmo erro; chave nao contem o e-mail', () => {
    const repo = createInMemoryRepository();
    const at = (email: string) => {
      for (let i = 1; i <= 12; i++) if (/bloqueada/.test(String(repo.initiateLoginChallenge(email, 'x').error))) return i;
      return -1;
    };
    assert.equal(at('nao.existe@exemplo.com'), at(SELLER_EMAIL));
    assert.ok(!repo.loginTrackerKey(SELLER_EMAIL).includes('marialuiza'));
    assert.equal(repo.loginTrackerKey(' MariaLuiza@SetaTelecom.com.br '), repo.loginTrackerKey(SELLER_EMAIL));
    assert.ok(!/isKnownAccount/.test(src('src/db/repository.ts')));
  });
});

describe('Pacote I (D3): limite de login por IP + e-mail', () => {
  it('NAT: um usuario errando muito nao tranca o colega com a senha certa', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const IP = '198.51.100.20';
    const login = (email: string, password: string) =>
      router.dispatch({ method: 'POST', path: '/api/auth/login', query: { ...HTTP, _clientIp: IP }, body: { email, password } });
    for (let i = 0; i < 25; i++) await login('colega.distraido@exemplo.com', 'Errada#2026XX');
    // o mesmo par (IP, e-mail) ja recebe 429
    assert.equal((await login('colega.distraido@exemplo.com', 'Errada#2026XX')).status, 429);
    // outro usuario do mesmo IP segue chegando a verificacao de senha (401 aqui, nao 429)
    const other = await login('outra.pessoa@exemplo.com', 'Errada#2026XX');
    assert.equal(other.status, 401);
    const g = new LoginIpFailureGuard();
    for (let i = 0; i < 50; i++) g.hit(IP, 'a@x.com');
    assert.equal(g.isBlocked(IP, 'a@x.com'), true);
    assert.equal(g.isBlocked(IP, 'b@x.com'), false, 'colega com outro e-mail nao e bloqueado');
  });
  it('pulverizacao: 20 e-mails diferentes => IP inteiro 429; teto total por IP', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    const login = (email: string, ip: string) =>
      router.dispatch({ method: 'POST', path: '/api/auth/login', query: { ...HTTP, _clientIp: ip }, body: { email, password: 'Errada#2026XX' } });
    for (let i = 0; i < 20; i++) assert.equal((await login(`spray${i}@exemplo.com`, '198.51.100.30')).status, 401);
    const r = await login('qualquer@exemplo.com', '198.51.100.30');
    assert.equal(r.status, 429);
    assert.equal((r.body as Body).code, 'LOGIN_IP_RATE_LIMITED');
    assert.equal((await login('qualquer@exemplo.com', '198.51.100.31')).status, 401);
    const g = new LoginIpFailureGuard();
    for (let i = 0; i < 19; i++) for (let j = 0; j < 6; j++) g.hit('1.2.3.4', `u${i}@x.com`);
    assert.equal(g.isBlocked('1.2.3.4', 'novo@x.com'), true, '>= 100 falhas no IP');
  });
});

describe('Pacote I (8): sessao do navegador sem segredos em qualquer nivel', () => {
  it('passwordHash, secret, totpSecret, iamSeal e tokens somem em profundidade (objetos e arrays)', () => {
    const s = sanitizeActiveSessionForStorage({
      authenticated: true,
      mfaVerified: true,
      user: { id: 'u', name: 'N', passwordHash: 'h' },
      role: { id: 'R', nested: { passwordHash: 'HASH1', deeper: [{ secret: 'SEG1', ok: 1 }] }, policy: { secret: 'SEG2', keep: true } },
      effectiveActionGuards: { canManageUsersRbac: true, totpSecret: 'TOTP1', sub: { TOTP_SECRET: 'TOTP2' } },
      crmPermissions: { contactsAccess: 'FULL', iamSeal: 'SELO1', x: { Iam_Seal: 'SELO2', sessionToken: 'TK1', refresh_token: 'TK2' } },
      erpPermissions: { a: { b: { c: { d: { e: { f: { g: { h: { password: 'PW' } } } } } } } } },
      moduleAccess: JSON.parse('{"__proto__": {"polluted": true}, "crm": true}'),
    } as Record<string, unknown>) as Record<string, unknown>;
    const j = JSON.stringify(s);
    for (const bad of ['HASH1', 'SEG1', 'SEG2', 'TOTP1', 'TOTP2', 'SELO1', 'SELO2', 'TK1', 'TK2', 'PW', '"h"', 'polluted']) {
      assert.ok(!j.includes(bad), bad);
    }
    assert.equal((s.effectiveActionGuards as Record<string, unknown>).canManageUsersRbac, true, 'guardas preservadas');
    assert.equal((s.crmPermissions as Record<string, unknown>).contactsAccess, 'FULL');
    assert.equal((s.role as Record<string, unknown>).policy, undefined, 'Pacote J (D-I6): allowlist por nivel'); 
    assert.equal((s.role as Record<string, unknown>).id, 'R');
    assert.equal((s.moduleAccess as Record<string, unknown>).crm, true);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });
});

describe('Pacote I: newStatus do comentario de chamado', () => {
  it('status fora do enum => 400 (POST e ADD_COMMENT); valido segue as regras do PATCH (SLA pausa)', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const t = repo.listServiceTickets().find((x) => x.status === 'OPEN' || x.status === 'IN_PROGRESS')!;
    const n = repo.getServiceTicketById(t.id)!.comments.length;
    for (const newStatus of ['HACKED_STATUS', 'resolved', 1, { a: 1 }]) {
      const r = await router.dispatch({ method: 'POST', path: `/api/tickets/${t.id}/comments`, query: A(), body: { body: 'x', newStatus } });
      assert.equal(r.status, 400, JSON.stringify(newStatus));
      assert.equal((r.body as Body).code, 'TICKET_COMMENT_STATUS_INVALID');
      const r2 = await router.dispatch({ method: 'PATCH', path: `/api/tickets/${t.id}`, query: A(), body: { action: 'ADD_COMMENT', body: 'x', newStatus } });
      assert.equal(r2.status, 400);
    }
    assert.equal(repo.getServiceTicketById(t.id)!.comments.length, n, 'nada gravado');
    assert.notEqual(repo.getServiceTicketById(t.id)!.status, 'HACKED_STATUS');
    const ok = await router.dispatch({ method: 'POST', path: `/api/tickets/${t.id}/comments`, query: A(), body: { body: 'aguardando', newStatus: 'WAITING_CUSTOMER' } });
    assert.equal(ok.status, 201);
    const after = repo.getServiceTicketById(t.id)!;
    assert.equal(after.status, 'WAITING_CUSTOMER');
    assert.ok(after.slaPausedAt, 'pausa de SLA aplicada como no PATCH');
    const res = await router.dispatch({ method: 'POST', path: `/api/tickets/${t.id}/comments`, query: A(), body: { body: 'resolvido', newStatus: 'RESOLVED' } });
    assert.equal(res.status, 201);
    const r3 = repo.getServiceTicketById(t.id)!;
    assert.equal(r3.status, 'RESOLVED');
    assert.ok(r3.resolvedAt);
    assert.equal(r3.slaPausedAt ?? null, null, 'retomada do SLA ao sair de WAITING_CUSTOMER');
    assert.deepEqual(parseTicketCommentStatus(''), { ok: true });
    assert.equal(parseTicketCommentStatus('CLOSED').ok, true);
  });
});

describe('Pacote I: contrato descarta chaves desconhecidas', () => {
  it('SavedBy, saved_by, chaves inventadas e __proto__ nao sao gravadas; campos conhecidos sim', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const c = repo.listRentalContracts()[0];
    const body = JSON.parse(JSON.stringify({ monthlyValue: (c.monthlyValue || 0) + 3, SavedBy: 'Forjado', saved_by: 'Forjado', UpdatedBy: 'Forjado', campoInventado: 'Forjado', costCenter: 'CC-I' }));
    body['__proto__'] = { polluted: 'Forjado' };
    const r = await router.dispatch({ method: 'PATCH', path: `/api/erp/rental-contracts/${c.id}`, query: A(), body });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const after = repo.listRentalContracts().find((x) => x.id === c.id)! as unknown as Record<string, unknown>;
    assert.ok(!JSON.stringify(after).includes('Forjado'));
    assert.equal(after.costCenter, 'CC-I');
    assert.equal(after.monthlyValue, (c.monthlyValue || 0) + 3);
    assert.deepEqual(pickRentalContractPatch({ SavedBy: 1, title: 't' }), { patch: { title: 't' }, dropped: ['SavedBy'] });
  });
  it('allowlist do contrato = interface ErpRentalContract menos os campos do servidor', () => {
    const types = src('src/db/types.ts');
    const block = types.slice(types.indexOf('export interface ErpRentalContract {'));
    const body = block.slice(0, block.indexOf('\n}'));
    const keys = [...body.matchAll(/^ {2}([A-Za-z0-9_]+)\??:/gm)].map((m) => m[1]);
    const expected = keys.filter((k) => !(RENTAL_CONTRACT_SERVER_ONLY_KEYS as readonly string[]).includes(k)).sort();
    assert.deepEqual([...RENTAL_CONTRACT_PATCH_KEYS].sort(), expected);
  });
});

describe('Pacote I: ownerName so de usuario ativo do RBAC (ou opcao oficial), canonico', () => {
  it('nome so dos dados => 400; caixa/acentos diferentes => grava o nome canonico; e-mail => nome', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const c = repo.listContacts().find((x) => x.ownerName)!;
    const other = repo.listContacts().find((x) => x.id !== c.id)!;
    (other as { ownerName?: string }).ownerName = 'Nome So Nos Dados';
    const put = (ownerName: unknown) => router.dispatch({ method: 'PUT', path: `/api/contacts/${c.id}`, query: A(), body: { ownerName } });
    const r = await put('Nome So Nos Dados');
    assert.equal(r.status, 400);
    assert.equal((r.body as Body).code, 'OWNER_NOT_FOUND');
    const rbacUser = (repo.getRbacState().users as Array<{ name: string; email: string; active?: boolean }>).find(
      (u) => u.active !== false && u.name && !/inativ/i.test(u.name) && u.name !== c.ownerName
    )!;
    const weird = rbacUser.name.toUpperCase().replace(/A/g, 'Á');
    const ok = await put(`  ${weird} `);
    assert.ok(ok.status < 300, JSON.stringify(ok.body));
    assert.equal(repo.getContactById(c.id)!.ownerName, rbacUser.name);
    await put('Contato Seta Telecom');
    assert.equal(repo.getContactById(c.id)!.ownerName, 'Contato Seta Telecom', 'opcao oficial do seletor continua aceita');
    const byEmail = await put(rbacUser.email.toUpperCase());
    assert.ok(byEmail.status < 300);
    assert.equal(repo.getContactById(c.id)!.ownerName, rbacUser.name);
    const map = buildOwnerCanonicalMap({ users: [{ name: 'Ana Inativa', email: 'ana@x.com', active: false }] });
    assert.equal(resolveOwnerNameToStore('ana inativa', null, map), null);
    assert.equal(resolveOwnerNameToStore('EVELYN ternero seta TELECOM', null, buildOwnerCanonicalMap({ users: [] })), 'Evelyn Ternero Seta Telecom');
    assert.equal(resolveOwnerNameToStore('legado x', 'Legado X', map), 'Legado X', 'valor atual sem mudanca passa');
  });
  it('ContactDetailDrawer: nao manda ownerName vazio nem reatribui sem mudanca', () => {
    const d = src('src/app/components/ContactDetailDrawer.tsx');
    assert.ok(!/ownerName\.trim\(\) \|\| 'Marcelo Lopes Mira'/.test(d));
    assert.match(d, /ownerChanged = cleanOwner !== '' && cleanOwner !== initialOwnerName\.trim\(\)/);
    assert.match(d, /\.\.\.\(ownerChanged/);
  });
});

describe('Pacote I: CSAT do portal', () => {
  it('recordTicketCsat nao existe na main: a rota segue com updateServiceTicket (registrado)', () => {
    const repoSrc = src('src/db/repository.ts');
    const r = src('src/api/router.ts');
    if (/recordTicketCsat\(/.test(repoSrc)) {
      // apos o merge do SetaDesk: ou o router usa recordTicketCsat, ou o caminho transitorio
      // (updateServiceTicket so com csatScore -> recordTicketCsat) continua no repositorio.
      assert.ok(/recordTicketCsat\(/.test(r) || /keys\[0\] === 'csatScore'/.test(repoSrc));
    } else assert.match(r, /updateServiceTicket\(ticket\.id, \{ csatScore: Math\.round\(score\) \}\)/);
  });
});

describe('Pacote I: contexto interno', () => {
  it('contexto interno confiavel continua salvando a config (sync/cron)', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const r = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'PATCH', path: '/api/erp/gestaoclick/config', body: { taxRegime: 'LUCRO_REAL' } });
    assert.equal(r.status, 200);
  });
});
