// ============================================================================
// STI-hub — Pacote F (29/10/2026): portal sem nome real do contato; /api/health minimo para
// anonimo; sem findStiHubUserByEmail; autoria padrao = sessao ou "Sistema STI-hub";
// rede de testes deny-by-default.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as authLib from '../src/app/lib/auth';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';

const HTTP = { _fromHttpBridge: '1' };
const tok = (uid: string, email: string, roleId: string, extra: Record<string, unknown> = {}) =>
  signStiHubSessionToken({
    uid, email, name: 'Teste', roleId, scope: roleId === 'SUPER_ADMIN' ? 'TODOS' : 'PROPRIOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000, ...extra,
  } as Parameters<typeof signStiHubSessionToken>[0]);
const ADMIN = 'marcelo.mira@setatelecom.com.br';
const adminTok = () => tok('usr-seta-01', ADMIN, 'SUPER_ADMIN', { canManageUsersRbac: true });
let ip = 0;

describe('Pacote F (2): POST /api/portal/tickets nao revela o nome do contato do CRM', () => {
  const create = (router: CrmApiRouter, body: Record<string, unknown>) =>
    router.dispatch({ method: 'POST', path: '/api/portal/tickets', query: { ...HTTP, _clientIp: `192.0.2.${++ip}` }, body });
  const normalize = (b: unknown) =>
    JSON.parse(JSON.stringify(b).replace(/"key":"[^"]+"/g, '"key":"K"').replace(/"\d{4}-\d{2}-\d{2}T[^"]+"/g, '"T"'));

  it('contato existente x inexistente => resposta identica; autor = nome do formulario', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const t = repo.listServiceTickets().find((x) => x.contactId && repo.getContactById(x.contactId)?.email)!;
    const contact = repo.getContactById(t.contactId!)!;
    const base = { subject: 'Queda do link', description: 'sem sinal', name: 'Nome Do Formulario' };
    const a = await create(router, { ...base, email: contact.email });
    const b = await create(router, { ...base, email: 'ninguem.cadastrado@exemplo.com' });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.deepEqual(normalize(a.body), normalize(b.body));
    const txt = JSON.stringify(a.body);
    assert.ok(!txt.includes(contact.firstName) || contact.firstName === 'Nome', 'nome real do contato nao aparece');
    assert.equal((a.body as { data: { comments: Array<{ author: string }> } }).data.comments[0].author, 'Nome Do Formulario');
  });

  it('sem nome no formulario => "Cliente" (exista ou nao o contato)', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const t = repo.listServiceTickets().find((x) => x.contactId && repo.getContactById(x.contactId)?.email)!;
    const email = repo.getContactById(t.contactId!)!.email;
    for (const e of [email, 'outro.novo@exemplo.com']) {
      const r = await create(router, { subject: 'X', description: 'Y', email: e });
      assert.equal((r.body as { data: { comments: Array<{ author: string }> } }).data.comments[0].author, 'Cliente');
    }
  });
});

describe('Pacote F (3): /api/health', () => {
  it('anonimo e nao-admin => exatamente {status:"ok"}; admin => detalhes', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const anon = await router.dispatch({ method: 'GET', path: '/api/health', query: { ...HTTP }, body: {} });
    assert.equal(anon.status, 200);
    assert.deepEqual(anon.body, { status: 'ok' });
    repo.upsertRbacUser({ email: 'vend.f@setatelecom.com.br', name: 'Vend F', roleId: 'VENDEDOR_SALES' } as Parameters<typeof repo.upsertRbacUser>[0]);
    const v = repo.findRbacUserRecord('', 'vend.f@setatelecom.com.br')!;
    const vend = await router.dispatch({ method: 'GET', path: '/api/health', query: { ...HTTP, _sessionToken: tok(v.id, v.email, 'VENDEDOR_SALES') }, body: {} });
    assert.deepEqual(vend.body, { status: 'ok' });
    const adm = await router.dispatch({ method: 'GET', path: '/api/health', query: { ...HTTP, _sessionToken: adminTok() }, body: {} });
    const d = adm.body as Record<string, unknown>;
    assert.equal(d.status, 'ok');
    assert.ok(d.counts && d.database, 'admin ve modo do banco e contagens');
  });
});

describe('Pacote F (4): sem usuario/autor padrao fixo', () => {
  it('findStiHubUserByEmail foi removido', () => {
    assert.equal((authLib as Record<string, unknown>).findStiHubUserByEmail, undefined);
  });

  it('autoria: sessao => nome do usuario da sessao; contexto interno => "Sistema STI-hub"', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const adminName = repo.findRbacUserRecord('usr-seta-01', '')!.name;
    const company = repo.listCompanies()[0];
    await router.dispatch({ method: 'PUT', path: `/api/companies/${company.id}`, query: { ...HTTP, _sessionToken: adminTok() }, body: { industry: 'Telecom F' } });
    await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'PUT', path: `/api/companies/${company.id}`, body: { industry: 'Telecom F2' } });
    const actors = repo.listTimelineEvents({ companyId: company.id }).slice(0, 2).map((e) => (e as { actor?: string }).actor);
    assert.ok(actors.includes(adminName), JSON.stringify(actors));
    assert.ok(actors.includes('Sistema STI-hub'), JSON.stringify(actors));
    const ticket = repo.listServiceTickets()[0];
    const c = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: `/api/tickets/${ticket.id}/comments`, body: { body: 'nota' } });
    assert.ok(c.status < 300, JSON.stringify(c.body));
    const last = repo.getServiceTicketById(ticket.id)!.comments.at(-1)!;
    assert.equal(last.author, 'Sistema STI-hub');
    assert.notEqual(last.author, 'Marcéllo Mira');
  });
});

describe('Pacote F (5): rede dos testes deny-by-default', () => {
  it('host externo qualquer => 503 bloqueado; loopback nao e bloqueado pelo guarda', async () => {
    for (const url of ['https://example.com/', 'https://api.hubapi.com/crm/v3/objects/contacts', 'http://10.0.0.1/']) {
      const r = await fetch(url);
      assert.equal(r.status, 503, url);
      assert.equal(((await r.json()) as { name: string }).name, 'test_network_blocked');
    }
    // loopback segue para a rede real (porta fechada => erro de conexao, nao resposta do guarda)
    await assert.rejects(() => fetch('http://127.0.0.1:1/'));
  });
});
