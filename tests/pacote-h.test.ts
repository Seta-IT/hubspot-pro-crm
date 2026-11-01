// ============================================================================
// STI-hub — Pacote H (01/11/2026): PATCH de chamado com allowlist; comentario com papel do
// servidor e interno por padrao; send-email publico so p/ o proprio cliente; bloqueio de login
// sem despejo da vitima + limite por IP; autoria do contrato pela sessao; rede de testes
// (lookup customizado, dgram, dns.*); ownerName; sessao no navegador; sync GestaoClick.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import dns from 'node:dns';
import dgram from 'node:dgram';
import { signStiHubSessionToken, sanitizeActiveSessionForStorage } from '../src/app/lib/auth';
import { createInMemoryRepository, CrmRepository } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import { emailCommentIsPublic, parseTicketTeamPatch, resolveTeamCommentVisibility } from '../src/api/ticket-guards';
import { buildKnownOwnerSet, isAssignableOwnerName } from '../src/api/owner-validation';

const HTTP = { _fromHttpBridge: '1' };
const ROOT = path.resolve(__dirname, '..', '..');
const src = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const tok = (uid: string, email: string, roleId: string, extra: Record<string, unknown> = {}) =>
  signStiHubSessionToken({
    uid, email, name: 'Teste', roleId, scope: roleId === 'SUPER_ADMIN' ? 'TODOS' : 'PROPRIOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000, ...extra,
  } as Parameters<typeof signStiHubSessionToken>[0]);
const adminTok = () => tok('usr-seta-01', 'marcelo.mira@setatelecom.com.br', 'SUPER_ADMIN', { canManageUsersRbac: true });
const sellerTok = () => tok('usr-seta-03', 'marialuiza@setatelecom.com.br', 'VENDEDOR_SALES');
const A = () => ({ ...HTTP, _sessionToken: adminTok() });

describe('Pacote H (1): PATCH /api/tickets/:id com allowlist estrita', () => {
  it('campos proibidos => 400 e nada muda; campos da equipe passam', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const t = repo.listServiceTickets().find((x) => x.comments.some((c) => c.isInternal)) || repo.listServiceTickets()[0];
    const before = JSON.stringify(repo.getServiceTicketById(t.id));
    const forbidden: Array<Record<string, unknown>> = [
      { comments: t.comments.map((c) => ({ ...c, isInternal: false })) },
      { csatScore: 5 },
      { firstRespondedAt: '2000-01-01T00:00:00.000Z' },
      { contactId: 'ctc-outro' },
      { slaStatus: 'ON_TRACK' },
      { slaResolutionDueAt: '2099-01-01T00:00:00.000Z' },
      { resolvedAt: '2000-01-01T00:00:00.000Z' },
      { key: 'X-1' },
      { status: 'OPEN', comments: [] },
      { status: 'NAO_EXISTE' },
    ];
    for (const body of forbidden) {
      const r = await router.dispatch({ method: 'PATCH', path: `/api/tickets/${t.id}`, query: A(), body });
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal((r.body as { code: string }).code, 'TICKET_PATCH_FIELD_NOT_ALLOWED');
    }
    assert.equal(JSON.stringify(repo.getServiceTicketById(t.id)), before, 'nada aplicado');
    for (const body of [{ status: 'IN_PROGRESS' }, { priority: 'HIGH' }, { assignee: 'NOC N2' }, { equipmentSerial: 'SN-H1' }, { contractId: null }]) {
      const r = await router.dispatch({ method: 'PATCH', path: `/api/tickets/${t.id}`, query: A(), body });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
    assert.equal(repo.getServiceTicketById(t.id)!.equipmentSerial, 'SN-H1');
    assert.equal(parseTicketTeamPatch({ csatScore: 1 }).ok, false);
  });

  it('comentario: papel AGENT do servidor, interno por padrao, publico so com false explicito + auditoria', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const t = repo.listServiceTickets()[0];
    const post = (body: Record<string, unknown>) => router.dispatch({ method: 'POST', path: `/api/tickets/${t.id}/comments`, query: A(), body });
    const last = () => repo.getServiceTicketById(t.id)!.comments.at(-1)!;
    await post({ body: 'h1', authorRole: 'CUSTOMER' });
    assert.equal(last().authorRole, 'AGENT');
    assert.equal(last().isInternal, true, 'sem isInternal => interno');
    await post({ body: 'h2', isInternal: 'false' });
    assert.equal(last().isInternal, true, 'string "false" nao publica');
    await post({ body: 'h3', isInternal: 0 });
    assert.equal(last().isInternal, true);
    const nAudit = repo.listSecurityAuditLogs(10000).logs.filter((l) => l.action === 'TICKET_COMMENT_PUBLIC').length;
    await post({ body: 'h4', isInternal: false });
    assert.equal(last().isInternal, false);
    const audits = repo.listSecurityAuditLogs(10000).logs.filter((l) => l.action === 'TICKET_COMMENT_PUBLIC');
    assert.equal(audits.length, nAudit + 1);
    // PATCH action ADD_COMMENT usa a mesma regra
    await router.dispatch({ method: 'PATCH', path: `/api/tickets/${t.id}`, query: A(), body: { action: 'ADD_COMMENT', body: 'h5', authorRole: 'CUSTOMER' } });
    assert.equal(last().authorRole, 'AGENT');
    assert.equal(last().isInternal, true);
    // contexto interno confiavel (integracao) pode registrar como CUSTOMER
    await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: `/api/tickets/${t.id}/comments`, body: { body: 'h6', authorRole: 'CUSTOMER', isInternal: false } });
    assert.equal(last().authorRole, 'CUSTOMER');
    assert.equal(resolveTeamCommentVisibility(undefined), true);
    assert.equal(resolveTeamCommentVisibility(false), false);
  });

  it('front: comentario pelo endpoint de comentario, sem autor fixo e sem CSAT pela equipe', () => {
    const tab = src('src/app/components/ServiceDeskTab.tsx');
    assert.ok(!/onUpdateTicket\([^)]*csatScore/.test(tab));
    assert.ok(!/comments:/.test(tab.match(/onUpdateTicket\(activeTicket\.id, \{[^}]*\}/g)?.join('\n') || ''));
    assert.ok(!/'Marcéllo Mira \(NOC Seta Telecom\)'/.test(tab));
    assert.match(src('src/app/page.tsx'), /\/api\/tickets\/\$\{ticketIdOrKey\}\/comments/);
  });
});

describe('Pacote H (2): send-email publico so para o proprio cliente', () => {
  it('regra pura (normalizada; to/cc/bcc)', () => {
    const tk = ['Cliente@Exemplo.com', null];
    assert.equal(emailCommentIsPublic({ to: ' cliente@exemplo.COM ' }, tk), true);
    assert.equal(emailCommentIsPublic({ to: 'Cliente <cliente@exemplo.com>' }, tk), true);
    assert.equal(emailCommentIsPublic({ to: 'cliente@exemplo.com', cc: 'outro@x.com' }, tk), false);
    assert.equal(emailCommentIsPublic({ to: 'cliente@exemplo.com', bcc: ['outro@x.com'] }, tk), false);
    assert.equal(emailCommentIsPublic({ to: 'cliente@exemplo.com; outro@x.com' }, tk), false);
    assert.equal(emailCommentIsPublic({ to: 'cliente@exemplo.com' }, [null, undefined]), false);
    assert.equal(emailCommentIsPublic({ to: '' }, tk), false);
  });
  it('rota: terceiro => interno; so o contato => publico; autor da sessao, papel AGENT', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const adminName = repo.findRbacUserRecord('usr-seta-01', '')!.name;
    const t = repo.listServiceTickets().find((x) => x.contactId && repo.getContactById(x.contactId)?.email)!;
    const email = repo.getContactById(t.contactId!)!.email!;
    const send = (extra: Record<string, unknown>) =>
      router.dispatch({ method: 'POST', path: '/api/communications/send-email', query: A(), body: { subject: 'S', body: 'corpo', ticketId: t.id, ...extra } });
    const last = () => repo.getServiceTicketById(t.id)!.comments.at(-1)!;
    await send({ to: 'terceiro@exemplo.com' });
    assert.equal(last().isInternal, true);
    await send({ to: email, cc: 'terceiro@exemplo.com' });
    assert.equal(last().isInternal, true);
    await send({ to: email, bcc: 'terceiro@exemplo.com' });
    assert.equal(last().isInternal, true);
    await send({ to: `  ${email.toUpperCase()} ` });
    assert.equal(last().isInternal, false);
    assert.equal(last().authorRole, 'AGENT');
    assert.ok(last().author.startsWith(adminName));
  });
});

describe('Pacote H (3): bloqueio de login', () => {
  const VICTIM = 'marcelo.mira@setatelecom.com.br';
  it('mapa cheio com 5000 falhas recentes + 1 e-mail falso NAO libera a vitima bloqueada', () => {
    const repo = createInMemoryRepository();
    for (let i = 0; i < 6; i++) repo.initiateLoginChallenge(VICTIM, 'Errada#2026XX', '203.0.113.1');
    const locked = repo.initiateLoginChallenge(VICTIM, 'Errada#2026XX', '203.0.113.1');
    assert.match(String(locked.error), /bloqueada/);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = (repo as any).loginAttemptTracker as Map<string, unknown>;
    const now = Date.now();
    for (let i = 0; map.size < CrmRepository.LOGIN_TRACKER_MAX; i++) {
      map.set(`falso${i}@exemplo.com`, { failedAttempts: 1, firstAttemptMs: now, lockedUntilMs: 0, lastAttemptMs: now });
    }
    for (let i = 0; i < 3; i++) repo.initiateLoginChallenge(`novo${i}@exemplo.com`, 'x', '203.0.113.2');
    assert.ok(map.has(VICTIM), 'vitima continua no mapa');
    assert.ok(!map.has('novo0@exemplo.com'), 'e-mail desconhecido nao ganha entrada com o mapa cheio');
    assert.ok(map.size <= CrmRepository.LOGIN_TRACKER_MAX);
    assert.match(String(repo.initiateLoginChallenge(VICTIM, 'Errada#2026XX').error), /bloqueada/);
  });
  it('entradas frias (sem bloqueio, >15 min) sao despejadas; conta real sempre registrada', () => {
    const repo = createInMemoryRepository();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = (repo as any).loginAttemptTracker as Map<string, { lastAttemptMs?: number }>;
    const old = Date.now() - 60 * 60 * 1000;
    for (let i = 0; map.size < CrmRepository.LOGIN_TRACKER_MAX; i++) {
      map.set(`frio${i}@exemplo.com`, { failedAttempts: 1, firstAttemptMs: old, lockedUntilMs: 0, lastAttemptMs: old } as never);
    }
    repo.initiateLoginChallenge('novo.frio@exemplo.com', 'x');
    assert.ok(map.has('novo.frio@exemplo.com'));
    assert.ok(map.size <= CrmRepository.LOGIN_TRACKER_MAX);
  });
  it('limite por IP: 20 falhas em 10 min => 429 no mesmo IP; outro IP segue; sem IP fixo', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    const login = (email: string, ip: string) =>
      router.dispatch({ method: 'POST', path: '/api/auth/login', query: { ...HTTP, _clientIp: ip }, body: { email, password: 'Errada#2026XX' } });
    for (let i = 0; i < 20; i++) assert.equal((await login(`ip${i}@exemplo.com`, '198.51.100.7')).status, 401);
    const r = await login('ip99@exemplo.com', '198.51.100.7');
    assert.equal(r.status, 429);
    assert.equal((r.body as { code: string }).code, 'LOGIN_IP_RATE_LIMITED');
    assert.equal((await login('ip99@exemplo.com', '198.51.100.8')).status, 401);
    assert.ok(!src('src/api/router.ts').includes('189.112.44.18'));
    const repoSrc = src('src/db/repository.ts');
    const loginFn = repoSrc.slice(repoSrc.indexOf('initiateLoginChallenge('), repoSrc.indexOf('initiateLoginChallenge(') + 400);
    assert.ok(!loginFn.includes('189.112.44.18'));
  });
  it('auditoria grava o IP confiavel', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    await router.dispatch({ method: 'POST', path: '/api/auth/login', query: { ...HTTP, _clientIp: '192.0.2.55' }, body: { email: VICTIM, password: 'Errada#2026XX' } });
    assert.ok(repo.listSecurityAuditLogs(50).logs.some((l) => l.ipAddress === '192.0.2.55'));
  });
});

describe('Pacote H (4): contrato com autoria da sessao', () => {
  it('PATCH ignora savedBy/updatedBy/versionHistory/statusHistory do corpo', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const adminName = repo.findRbacUserRecord('usr-seta-01', '')!.name;
    const c = repo.listRentalContracts()[0];
    const nVer = (c.versionHistory || []).length;
    const r = await router.dispatch({
      method: 'PATCH', path: `/api/erp/rental-contracts/${c.id}`, query: A(),
      body: { monthlyValue: (c.monthlyValue || 0) + 7, savedBy: 'Forjado', updatedBy: 'Forjado', sellerName: c.sellerName, versionHistory: [], statusHistory: [] },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const after = repo.listRentalContracts().find((x) => x.id === c.id)!;
    const hist = after.versionHistory || [];
    assert.ok(hist.length >= Math.max(nVer, 1), 'historico nao foi apagado');
    assert.equal(hist[0]!.savedBy, adminName, 'versao mais nova (primeira) com autor da sessao');
    assert.ok(!JSON.stringify(after).includes('Forjado'));
  });
});

describe('Pacote H (5): rede bloqueada nos testes (lookup customizado, dgram, dns.*)', () => {
  const expectBlocked = (fn: (done: (e?: Error | null) => void) => void) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('sem erro de bloqueio (timeout)')), 3000);
      fn((e) => {
        clearTimeout(timer);
        if (e && /test_network_blocked/.test(String(e.message) + String(e.name))) resolve();
        else reject(e || new Error('conectou'));
      });
    });
  const evilLookup = (_h: string, o: { all?: boolean }, cb: (e: Error | null, a: unknown, f?: number) => void) =>
    o && o.all ? cb(null, [{ address: '93.184.216.34', family: 4 }]) : cb(null, '93.184.216.34', 4);
  it('net.connect/createConnection com lookup que resolve para IP externo => bloqueado', async () => {
    await expectBlocked((done) => net.connect({ host: 'localhost', port: 80, lookup: evilLookup as never }).on('error', done).on('connect', () => done()));
    await expectBlocked((done) => net.createConnection({ host: 'localhost', port: 80, lookup: evilLookup as never }).on('error', done).on('connect', () => done()));
  });
  it('dgram send/connect externo => bloqueado', async () => {
    await expectBlocked((done) => {
      const s = dgram.createSocket('udp4');
      s.send(Buffer.from('x'), 53, '8.8.8.8', (e) => { s.close(); done(e); });
    });
    await expectBlocked((done) => {
      const s = dgram.createSocket('udp4');
      s.on('error', (e) => { s.close(); done(e); });
      s.connect(53, '8.8.8.8', () => { s.close(); done(); });
    });
  });
  it('dns.reverse, lookupService, resolveNs/Ptr/Soa (callback e promises) => bloqueados', async () => {
    await expectBlocked((done) => dns.reverse('8.8.8.8', (e) => done(e)));
    await expectBlocked((done) => dns.lookupService('8.8.8.8', 53, (e) => done(e)));
    await expectBlocked((done) => dns.resolveNs('example.com', (e) => done(e)));
    await expectBlocked((done) => dns.resolvePtr('example.com', (e) => done(e)));
    await expectBlocked((done) => dns.resolveSoa('example.com', (e) => done(e)));
    for (const fn of ['reverse', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveCaa', 'resolveNaptr'] as const) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await assert.rejects(() => (dns.promises as any)[fn](fn === 'reverse' ? '8.8.8.8' : 'example.com'), /test_network_blocked/, fn);
    }
    await assert.rejects(() => dns.promises.lookupService('8.8.8.8', 53), /test_network_blocked/);
  });
  it('loopback com lookup customizado continua liberado', async () => {
    const srv = net.createServer((s) => s.end('ok'));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as net.AddressInfo).port;
    const okLookup = (_h: string, o: { all?: boolean }, cb: (e: Error | null, a: unknown, f?: number) => void) =>
      o && o.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        let buf = '';
        net.connect({ host: 'localhost', port, lookup: okLookup as never }).on('data', (d) => (buf += d)).on('end', () => resolve(buf)).on('error', reject);
      });
      assert.equal(data, 'ok');
    } finally {
      srv.close();
    }
  });
});

describe('Pacote H (6): ownerName e sessao no navegador', () => {
  it('vazio => 400; null so admin; inativo => 400; normaliza; sem mudanca passa', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const c = repo.listContacts().find((x) => x.ownerName)!;
    const put = (body: Record<string, unknown>, q = A()) => router.dispatch({ method: 'PUT', path: `/api/contacts/${c.id}`, query: q, body });
    assert.equal((await put({ ownerName: '   ' })).status, 400);
    const nul = await router.dispatch({ method: 'POST', path: '/api/companies', query: { ...HTTP, _sessionToken: sellerTok() }, body: { name: 'Empresa H', ownerName: null } });
    assert.equal(nul.status, 403);
    const inactive = repo.findRbacUserRecord('usr-seta-17', '')!;
    assert.equal(inactive.active, false);
    const ina = await put({ ownerName: inactive.name });
    assert.equal(ina.status, 400);
    assert.equal((ina.body as { code: string }).code, 'OWNER_NOT_FOUND');
    const ok = await put({ ownerName: '  Evelyn   Ternero  Seta Telecom ' });
    assert.ok(ok.status < 300, JSON.stringify(ok.body));
    assert.equal(repo.getContactById(c.id)!.ownerName, 'Evelyn Ternero Seta Telecom');
    const same = await put({ ownerName: 'Evelyn Ternero Seta Telecom', jobTitle: 'H' });
    assert.ok(same.status < 300);
    assert.equal(isAssignableOwnerName('', null, buildKnownOwnerSet({ users: [], existingOwnerNames: [] })), false);
    assert.ok(!src('src/api/router.ts').includes("findRbacUserRecord('', '')"));
  });
  it('registro sem responsavel reenviado sem mudanca (formulario) continua salvando', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const d = repo.getState().deals[0];
    (d as { ownerName?: string | null }).ownerName = '';
    const r = await router.dispatch({ method: 'PUT', path: `/api/deals/${d.id}`, query: A(), body: { ownerName: '', title: d.title } });
    assert.ok(r.status < 300, JSON.stringify(r.body));
    (d as { ownerName?: string | null }).ownerName = null;
    const r2 = await router.dispatch({ method: 'PUT', path: `/api/deals/${d.id}`, query: { ...HTTP, _sessionToken: sellerTok() }, body: { ownerName: null, title: d.title } });
    assert.notEqual((r2.body as { code?: string }).code, 'OWNER_CLEAR_ADMIN_ONLY');
  });
  it('sanitizeActiveSessionForStorage: allowlist no topo', () => {
    const s = sanitizeActiveSessionForStorage({
      authenticated: true, mfaVerified: true, user: { id: 'u', name: 'N', iamSeal: 'selo' },
      sessionToken: 'tok', challengeId: 'c', qualquerCoisa: { x: 1 }, iamSeal: 'selo2', loggedAt: 'x',
    } as Record<string, unknown>) as Record<string, unknown>;
    assert.deepEqual(Object.keys(s).sort(), ['authenticated', 'loggedAt', 'mfaVerified', 'user']);
    assert.ok(!JSON.stringify(s).includes('selo'));
  });
});

describe('Pacote H (7): POST /api/erp/gestaoclick/sync', () => {
  it('credencial/URL no corpo => 400; vendedor => 403; anonimo => 401', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    const sync = (body: Record<string, unknown>, q: Record<string, string>) => router.dispatch({ method: 'POST', path: '/api/erp/gestaoclick/sync', query: q, body });
    for (const body of [{ accessToken: 'x' }, { secretAccessToken: 'y' }, { apiBaseUrl: 'https://evil.example' }, { access_token: 'x' }]) {
      const r = await sync(body, A());
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal((r.body as { code: string }).code, 'GESTAOCLICK_CREDENTIALS_IN_BODY');
      assert.ok(!JSON.stringify(r.body).includes('evil.example'));
    }
    assert.equal((await sync({}, { ...HTTP, _sessionToken: sellerTok() })).status, 403);
    assert.ok([401, 403].includes((await sync({}, { ...HTTP, _sessionToken: tok('usr-seta-01', 'marcelo.mira@setatelecom.com.br', 'SUPER_ADMIN', { canManageUsersRbac: true, mfaVerified: false }) })).status));
    assert.equal((await sync({}, { ...HTTP })).status, 401);
    assert.match(src('src/app/components/ErpGestaoClickTab.tsx'), /fetch\('\/api\/erp\/gestaoclick\/sync', \{ method: 'POST' \}\)/);
  });
});
