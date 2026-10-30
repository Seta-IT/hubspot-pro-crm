// ============================================================================
// STI-hub — Pacote G (30/10/2026): portal reply/csat sem nome do CRM; varredura recursiva de
// credenciais nas rotas IAM; autoria sempre da sessao (ownerName validado); rede dos testes
// bloqueada em socket/DNS; login generico; 5b; IP confiavel; sessao ativa so com exibicao;
// cabecalhos de proposta.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import dns from 'node:dns';
import { NextResponse } from 'next/server';
import { signStiHubSessionToken, sanitizeActiveSessionForStorage, toActiveSessionDisplayUser } from '../src/app/lib/auth';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter, findForbiddenIamCredentialFields, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import { resolveTrustedClientIp } from '../src/api/client-ip';
import { LOGIN_GENERIC_ERROR } from '../src/db/password-hash';
import { applyBaseSecurityHeaders } from '../src/middleware';
import { isSensitiveProposalPath } from '../src/app/lib/sensitive-paths';

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
let ipN = 0;
const pq = () => ({ ...HTTP, _clientIp: `198.51.100.${++ipN % 250}` });
type DtoComments = { data: { comments: Array<{ author: string; body: string }> } };

describe('Pacote G (1): portal reply/csat e POST anonimo', () => {
  it('reply e csat => autor = nome do formulario ou "Cliente", nunca o contato do CRM', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const t = repo.listServiceTickets().find((x) => x.contactId && repo.getContactById(x.contactId)?.email)!;
    const c = repo.getContactById(t.contactId!)!;
    const real = `${c.firstName} ${c.lastName}`.trim();
    const r1 = await router.dispatch({ method: 'POST', path: `/api/portal/tickets/${t.key}/reply`, query: pq(), body: { email: c.email, body: 'resposta G' } });
    assert.equal(r1.status, 201, JSON.stringify(r1.body));
    const last1 = (r1.body as DtoComments).data.comments.at(-1)!;
    assert.equal(last1.author, 'Cliente');
    const r2 = await router.dispatch({ method: 'POST', path: `/api/portal/tickets/${t.key}/reply`, query: pq(), body: { email: c.email, body: 'resposta G2', name: 'Nome Do Form' } });
    assert.equal((r2.body as DtoComments).data.comments.at(-1)!.author, 'Nome Do Form');
    const r3 = await router.dispatch({ method: 'POST', path: `/api/portal/tickets/${t.key}/csat`, query: pq(), body: { email: c.email, score: 5, feedback: 'otimo' } });
    assert.equal(r3.status, 200);
    const csatC = (r3.body as DtoComments).data.comments.find((x) => x.body.startsWith('Avaliação CSAT'))!;
    assert.equal(csatC.author, 'Cliente');
    const novos = repo.getServiceTicketById(t.id)!.comments.slice(-3);
    for (const cm of novos) assert.notEqual(cm.author, real);
  });

  it('POST anonimo: nome de empresa digitado NAO vincula a empresa existente; resposta identica', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const comp = repo.listCompanies()[0];
    const nCompanies = repo.listCompanies().length;
    const norm = (b: unknown) => JSON.parse(JSON.stringify(b).replace(/"key":"[^"]+"/g, '"key":"K"').replace(/"\d{4}-\d{2}-\d{2}T[^"]+"/g, '"T"'));
    const a = await router.dispatch({ method: 'POST', path: '/api/portal/tickets', query: pq(), body: { subject: 'S', description: 'D', email: 'g1.novo@exemplo.com', companyName: comp.name } });
    const b = await router.dispatch({ method: 'POST', path: '/api/portal/tickets', query: pq(), body: { subject: 'S', description: 'D', email: 'g2.novo@exemplo.com', companyName: 'Empresa Que Nao Existe SA' } });
    assert.equal(a.status, 201);
    assert.deepEqual(norm(a.body), norm(b.body));
    assert.ok(!JSON.stringify(a.body).includes(comp.name), 'nada do CRM volta na resposta');
    const keyA = (a.body as { data: { key: string } }).data.key;
    const tA = repo.listServiceTickets().find((x) => x.key === keyA)!;
    assert.equal(tA.companyId, null, 'nao vinculou a empresa existente pelo nome digitado');
    assert.equal(repo.listCompanies().length, nCompanies, 'nenhuma empresa criada');
    assert.ok(tA.comments.some((x) => x.isInternal && x.body.includes(comp.name)), 'empresa informada fica em nota interna');
  });
});

describe('Pacote G (2): varredura recursiva de credenciais nas rotas IAM', () => {
  const P = '/api/admin/users/usr-x';
  it('variantes de nome, aninhado, query e transporte fora do topo => recusados', () => {
    const cases: Array<[Record<string, unknown>, Record<string, unknown> | undefined]> = [
      [{ password_hash: 'x' }, undefined],
      [{ PASSWORDHASH: 'x' }, undefined],
      [{ 'totp-secret': 'x' }, undefined],
      [{ profile: { lastUsedTotpTimeStep: 1 } }, undefined],
      [{ iamUsersOverride: [{ id: 'a', passwordHash: 'x' }] }, undefined],
      [{ iamUsersOverride: [{ id: 'a', password: 'Qualquer#12345' }] }, undefined],
      [{ user: { password: 'Qualquer#12345' } }, undefined],
      [{ nested: { iamUsersOverride: [] } }, undefined],
      [{}, { passwordHash: 'x' }],
      [{}, { password: 'Qualquer#12345' }],
      [{}, { iam_users_override: '[]' }],
    ];
    for (const [body, query] of cases) {
      assert.ok(findForbiddenIamCredentialFields(P, 'PUT', body, query).length > 0, JSON.stringify({ body, query }));
    }
  });
  it('password no topo so no POST/PUT/PATCH de usuario; override no topo e campos normais passam', () => {
    assert.deepEqual(findForbiddenIamCredentialFields('/api/admin/users', 'POST', { password: 'SenhaNova#2026A', name: 'X' }), []);
    assert.deepEqual(findForbiddenIamCredentialFields(P, 'PATCH', { password: 'SenhaNova#2026A' }), []);
    assert.ok(findForbiddenIamCredentialFields('/api/admin/settings', 'PUT', { password: 'SenhaNova#2026A' }).length > 0);
    assert.ok(findForbiddenIamCredentialFields(P, 'DELETE', { password: 'SenhaNova#2026A' }).length > 0);
    assert.deepEqual(
      findForbiddenIamCredentialFields(P, 'PUT', {
        name: 'X', passwordChangedAt: 'x', totpConfigured: true, smtpPass: 'y',
        iamUsersOverride: [{ id: 'a', name: 'A', iamSeal: 'opaco', totpConfigured: true }],
        iamDeletedUsersOverride: [],
      }, { _sessionToken: 't', _clientIp: '1.2.3.4' }),
      []
    );
  });
  it('router: 400 IAM_FORBIDDEN_CREDENTIAL_FIELD e nada aplicado', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const before = repo.findRbacUserRecord('usr-seta-01', '')!.passwordHash;
    for (const body of [{ password_hash: 'scrypt$1$x' }, { iamUsersOverride: [{ id: 'usr-seta-01', 'Password-Hash': 'x' }] }]) {
      const r = await router.dispatch({ method: 'PUT', path: '/api/admin/users/usr-seta-01', query: { ...HTTP, _sessionToken: adminTok() }, body });
      assert.equal(r.status, 400);
      assert.equal((r.body as { code: string }).code, 'IAM_FORBIDDEN_CREDENTIAL_FIELD');
    }
    assert.equal(repo.findRbacUserRecord('usr-seta-01', '')!.passwordHash, before);
  });
});

describe('Pacote G (3): autoria sempre da sessao; ownerName validado', () => {
  it('/api/timeline: actor/author/id/createdAt do cliente ignorados', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const adminName = repo.findRbacUserRecord('usr-seta-01', '')!.name;
    const r = await router.dispatch({
      method: 'POST', path: '/api/timeline', query: { ...HTTP, _sessionToken: adminTok() },
      body: { type: 'NOTE', title: 'G', actor: 'Marcéllo Mira Falso', author: 'X', ownerName: 'Y', id: 'evt-forjado', createdAt: '2000-01-01T00:00:00.000Z' },
    });
    assert.equal(r.status, 201);
    const ev = (r.body as { data: { id: string; actor: string; createdAt: string } }).data;
    assert.equal(ev.actor, adminName);
    assert.notEqual(ev.id, 'evt-forjado');
    assert.notEqual(ev.createdAt, '2000-01-01T00:00:00.000Z');
  });
  it('comentario de chamado (POST e PATCH ADD_COMMENT): author do cliente ignorado', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const adminName = repo.findRbacUserRecord('usr-seta-01', '')!.name;
    const t = repo.listServiceTickets()[0];
    await router.dispatch({ method: 'POST', path: `/api/tickets/${t.id}/comments`, query: { ...HTTP, _sessionToken: adminTok() }, body: { body: 'n1', author: 'Fulano Forjado' } });
    assert.equal(repo.getServiceTicketById(t.id)!.comments.at(-1)!.author, adminName);
    await router.dispatch({ method: 'PATCH', path: `/api/tickets/${t.id}`, query: { ...HTTP, _sessionToken: adminTok() }, body: { action: 'ADD_COMMENT', body: 'n2', author: 'Fulano Forjado' } });
    assert.equal(repo.getServiceTicketById(t.id)!.comments.at(-1)!.author, adminName);
    // contexto interno confiavel (servidor) pode informar o autor
    await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: `/api/tickets/${t.id}/comments`, body: { body: 'n3', author: 'Integração SetaDesk' } });
    assert.equal(repo.getServiceTicketById(t.id)!.comments.at(-1)!.author, 'Integração SetaDesk');
  });
  it('contato: actor da timeline = sessao (nao o ownerName); ownerName novo desconhecido => 400', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const adminName = repo.findRbacUserRecord('usr-seta-01', '')!.name;
    const c = repo.listContacts()[0];
    const put = (body: Record<string, unknown>) => router.dispatch({ method: 'PUT', path: `/api/contacts/${c.id}`, query: { ...HTTP, _sessionToken: adminTok() }, body });
    const bad = await put({ ownerName: 'Pessoa Inventada da Silva' });
    assert.equal(bad.status, 400);
    assert.equal((bad.body as { code: string }).code, 'OWNER_NOT_FOUND');
    assert.equal(repo.getContactById(c.id)!.ownerName, c.ownerName);
    const same = await put({ ownerName: c.ownerName, jobTitle: 'Gerente G' });
    assert.ok(same.status < 300, JSON.stringify(same.body));
    const official = await put({ ownerName: 'Evelyn Ternero Seta Telecom', jobTitle: 'Gerente G2' });
    assert.ok(official.status < 300, JSON.stringify(official.body));
    const iamUser = await put({ ownerName: adminName.toUpperCase(), jobTitle: 'Gerente G3' });
    assert.ok(iamUser.status < 300, JSON.stringify(iamUser.body));
    const ev = repo.listTimelineEvents({ contactId: c.id })[0] as { actor: string };
    assert.equal(ev.actor, adminName);
    const cr = await router.dispatch({ method: 'POST', path: '/api/companies', query: { ...HTTP, _sessionToken: adminTok() }, body: { name: 'Empresa G', ownerName: 'Ninguem Conhecido' } });
    assert.equal(cr.status, 400);
  });
  it('front sem autor/responsavel fixo nos pontos apontados', () => {
    assert.ok(!/actor:\s*'Marcéllo Mira'/.test(src('src/app/page.tsx')));
    assert.ok(!/\|\|\s*'Marcelo Lopes Mira'/.test(src('src/app/components/GestaoClickCompanyModal.tsx')));
    assert.ok(!/\|\|\s*["']Marcelo Lopes Mira["']/.test(src('src/app/components/ErpGestaoClickTab.tsx')));
    assert.ok(!/useState\("Marcelo Lopes Mira"\)/.test(src('src/app/components/ErpGestaoClickTab.tsx')));
  });
});

describe('Pacote G (4): socket e DNS bloqueados nos testes', () => {
  const expectBlocked = (fn: (done: (e?: Error | null) => void) => void) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('sem erro de bloqueio (timeout)')), 3000);
      fn((e) => {
        clearTimeout(timer);
        if (e && /test_network_blocked/.test(String(e.message) + String(e.name))) resolve();
        else reject(e || new Error('conectou'));
      });
    });
  it('net.connect, tls.connect, https.get => bloqueados', async () => {
    await expectBlocked((done) => net.connect(80, 'example.com').on('error', done).on('connect', () => done()));
    await expectBlocked((done) => net.connect({ host: '10.1.2.3', port: 5432 }).on('error', done).on('connect', () => done()));
    await expectBlocked((done) => tls.connect({ host: 'example.com', port: 443 }).on('error', done).on('secureConnect', () => done()));
    await expectBlocked((done) => https.get('https://example.com/').on('error', done).on('response', () => done()));
  });
  it('dns.lookup / resolve4 / promises => bloqueados', async () => {
    await expectBlocked((done) => dns.lookup('example.com', (e) => done(e)));
    await expectBlocked((done) => dns.resolve4('example.com', (e) => done(e)));
    await assert.rejects(() => dns.promises.lookup('example.com'), /test_network_blocked/);
  });
  it('pg e nodemailer nao alcancam a rede', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Client } = require('pg');
    const c = new Client({ host: 'db.example.com', port: 5432, user: 'u', password: 'p', database: 'd', connectionTimeoutMillis: 2000 });
    await assert.rejects(() => c.connect(), /test_network_blocked|ENOTFOUND|ECONNREFUSED/);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodemailer = require('nodemailer');
    const tr = nodemailer.createTransport({ host: 'smtp.example.com', port: 587, auth: { user: 'u', pass: 'p' }, connectionTimeout: 2000 });
    await assert.rejects(() => tr.sendMail({ from: 'a@exemplo.com', to: 'b@exemplo.com', subject: 's', text: 't' }), /test_network_blocked|ENOTFOUND|ECONNREFUSED/);
    const log = fs.readFileSync(process.env.STI_HUB_TEST_NET_LOG || '/tmp/stihub-test-net-blocked.log', 'utf8');
    assert.match(log, /db\.example\.com/);
    assert.match(log, /smtp\.example\.com/);
  });
  it('loopback continua liberado', async () => {
    const srv = net.createServer((s) => s.end('ok'));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as net.AddressInfo).port;
    const data = await new Promise<string>((resolve, reject) => {
      const s = net.connect(port, '127.0.0.1');
      let buf = '';
      s.on('data', (d) => (buf += d)).on('end', () => resolve(buf)).on('error', reject);
    });
    srv.close();
    assert.equal(data, 'ok');
  });
});

describe('Pacote G (5): menores', () => {
  it('(a) login: mesma resposta para e-mail inexistente, senha errada e bloqueio', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    const login = (email: string, password: string) => router.dispatch({ method: 'POST', path: '/api/auth/login', query: { ...HTTP }, body: { email, password } });
    const t0 = Date.now();
    const a = await login('nao.existe.g@setatelecom.com.br', 'Errada#2026XX');
    const tA = Date.now() - t0;
    const t1 = Date.now();
    const b = await login('marcelo.mira@setatelecom.com.br', 'Errada#2026XX');
    const tB = Date.now() - t1;
    assert.equal(a.status, 401);
    assert.deepEqual(a, b);
    assert.equal((a.body as { error: string }).error, LOGIN_GENERIC_ERROR);
    // os dois caminhos fazem ~1 scrypt (tempo da mesma ordem de grandeza)
    assert.ok(tA >= 5 && tB >= 5, `${tA}ms/${tB}ms`);
    // bloqueio por tentativas vale tambem para e-mail inexistente (nao revela a conta)
    const msgs: string[] = [];
    for (let i = 0; i < 7; i++) msgs.push(JSON.stringify((await login('fantasma.g@setatelecom.com.br', 'Errada#2026XX')).body));
    assert.match(msgs.at(-1)!, /bloqueada/);
  });
  it('(b) PUT admin: senha curta => 400 antes de comparar com a atual', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    repo.upsertRbacUser({ email: 'curta.g@setatelecom.com.br', name: 'Curta', roleId: 'VENDEDOR_SALES', password: 'Antiga#8' } as Parameters<typeof repo.upsertRbacUser>[0]);
    const rec = repo.findRbacUserRecord('', 'curta.g@setatelecom.com.br')!;
    const put = (password: string) => router.dispatch({ method: 'PUT', path: `/api/admin/users/${rec.id}`, query: { ...HTTP, _sessionToken: adminTok() }, body: { password } });
    const eq = await put('Antiga#8');
    const diff = await put('Outra#99');
    assert.equal(eq.status, 400);
    assert.deepEqual(eq, diff);
  });
  it('(c) IP confiavel: x-vercel-forwarded-for > x-real-ip; XFF so fora da Vercel', () => {
    const h = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null });
    assert.equal(resolveTrustedClientIp(h({ 'x-vercel-forwarded-for': '203.0.113.9', 'x-forwarded-for': '6.6.6.6' }), true), '203.0.113.9');
    assert.equal(resolveTrustedClientIp(h({ 'x-real-ip': '203.0.113.10', 'x-forwarded-for': '6.6.6.6' }), true), '203.0.113.10');
    assert.equal(resolveTrustedClientIp(h({ 'x-forwarded-for': '6.6.6.6' }), true), undefined);
    assert.equal(resolveTrustedClientIp(h({ 'x-forwarded-for': '192.0.2.1, 10.0.0.1' }), false), '192.0.2.1');
    assert.equal(resolveTrustedClientIp(h({ 'x-vercel-forwarded-for': '<script>' }), true), undefined);
    assert.match(src('src/app/api/_bridge.ts'), /resolveTrustedClientIp\(req\.headers\)/);
  });
  it('(d) sessao ativa no localStorage so com campos de exibicao', () => {
    const u = {
      id: 'usr-seta-01', email: 'm@x.com', name: 'M', roleId: 'SUPER_ADMIN', department: 'TI',
      passwordHash: 'h', password: 'p', totpSecret: 's', totpConfigured: true, totpEpoch: 3, mfaEnabled: true,
      iamSeal: 'selo', lastUsedTotpTimeStep: 9, crmPermissions: { a: 1 },
    };
    assert.deepEqual(toActiveSessionDisplayUser(u), { id: 'usr-seta-01', email: 'm@x.com', name: 'M', roleId: 'SUPER_ADMIN', department: 'TI' });
    const s = sanitizeActiveSessionForStorage({ authenticated: true, mfaVerified: true, user: u, passwordHash: 'x' });
    assert.equal((s as Record<string, unknown>).passwordHash, undefined);
    assert.equal(JSON.stringify(s).includes('selo'), false);
    assert.match(src('src/app/login/page.tsx'), /user: toActiveSessionDisplayUser\(data\?\.user\)/);
  });
});

describe('Pacote G (steering): cabecalhos de proposta', () => {
  it('/proposta/* e /api/erp/proposals/* => no-referrer, no-store, noindex; demais mantem strict-origin', () => {
    for (const p of ['/proposta/abc', '/proposta', '/api/erp/proposals', '/api/erp/proposals/p1/approve', '//proposta/x']) {
      assert.ok(isSensitiveProposalPath(p), p);
      const r = applyBaseSecurityHeaders(NextResponse.next(), 'x', p);
      assert.equal(r.headers.get('Referrer-Policy'), 'no-referrer');
      assert.equal(r.headers.get('Cache-Control'), 'no-store');
      assert.equal(r.headers.get('X-Robots-Tag'), 'noindex');
    }
    for (const p of ['/login', '/api/erp/proposalsX', '/propostas', '/api/contacts']) {
      const r = applyBaseSecurityHeaders(NextResponse.next(), 'x', p);
      assert.equal(r.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin', p);
      assert.equal(r.headers.get('X-Robots-Tag'), null, p);
    }
    assert.match(src('src/app/api/_bridge.ts'), /isSensitiveProposalPath\(req\.nextUrl\.pathname\)/);
  });
});

describe('Pacote G (steering 00:21): restore-version, send-email e cabecalhos da proposta', () => {
  it('restore-version e send-email usam o autor da sessao (sem ator fixo)', () => {
    const r = src('src/api/router.ts');
    assert.ok(!/body\.restoredBy : undefined/.test(r));
    assert.equal((r.match(/ctx\.trustedInternal && typeof body\.restoredBy === 'string' \? body\.restoredBy : this\.sessionActorName\(query\)/g) || []).length, 2);
    assert.ok(!/'Marcelo Lopes Mira \(/.test(r), 'sem ator fixo no send-email');
    assert.ok(!/senderName: body\.senderName \? String\(body\.senderName\) : 'Marcelo Lopes Mira'/.test(r));
  });
  it('varredura so em body/query das rotas IAM: X-Proposal-Token e Idempotency-Key nao sao barrados', () => {
    assert.deepEqual(
      findForbiddenIamCredentialFields('/api/admin/users/usr-x', 'PUT', { name: 'X', idempotencyKey: 'k' }, { 'Idempotency-Key': 'k', 'X-Proposal-Token': 't', proposalToken: 't' }),
      []
    );
    assert.match(src('src/api/router.ts'), /if \(isIamAdminRoute\(cleanPath\)\) \{\n\s+const forbidden = findForbiddenIamCredentialFields\(/);
  });
  it('IP confiavel vem dos headers (nao de req.ip)', () => {
    assert.ok(!/req\.ip\b/.test(src('src/app/api/_bridge.ts')));
    assert.ok(!/req\.ip\b/.test(src('src/api/client-ip.ts')));
  });
});
