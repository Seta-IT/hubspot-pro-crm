// ============================================================================
// STI-hub — Pacote J (01/11/2026): A1 (sombra de proposta por id/codigo; mesma defesa em
// upsert, journal, contatos, empresas, negocios, contratos e chamados), A2 (proposta sem code
// derrubava toda edicao), daily-sync so com 2FA + admin/ERP FULL (cron preservado), enum de
// status no POST de chamado, /api/bootstrap com RBAC minimo para nao-admin, auto-NF so para o
// perfil privilegiado (D-I2), CNPJ normalizado (D-I3), IPv6 por /64 (D-I4) e sessao do
// navegador por allowlist (D-I6).
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signStiHubSessionToken, sanitizeActiveSessionForStorage } from '../src/app/lib/auth';
import { createInMemoryRepository, CrmRepository } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import { buildFullControlForModule } from '../src/modules/erp/rbac-seed';
import { RecordIdConflictError } from '../src/db/record-id-guard';
import { rateLimitIpKey } from '../src/api/client-ip';
import { LoginIpFailureGuard } from '../src/api/login-ip-guard';
import { parseGestaoClickConfigPatch } from '../src/api/gestaoclick-config-guard';
import type { ErpCommercialProposal } from '../src/db/types';

const HTTP = { _fromHttpBridge: '1' };
const tok = (uid: string, email: string, roleId: string, extra: Record<string, unknown> = {}) =>
  signStiHubSessionToken({
    uid, email, name: 'Teste', roleId, scope: roleId === 'SUPER_ADMIN' ? 'TODOS' : 'PROPRIOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000, ...extra,
  } as Parameters<typeof signStiHubSessionToken>[0]);
const ADMIN_EMAIL = 'marcelo.mira@setatelecom.com.br';
const SELLER_EMAIL = 'marialuiza@setatelecom.com.br';
const A = (extra: Record<string, unknown> = {}) => ({ ...HTTP, _sessionToken: tok('usr-seta-01', ADMIN_EMAIL, 'SUPER_ADMIN', { canManageUsersRbac: true, ...extra }) });
const S = () => ({ ...HTTP, _sessionToken: tok('usr-seta-03', SELLER_EMAIL, 'VENDEDOR_SALES') });
const ANON = () => ({ ...HTTP });
type Body = { code?: string; error?: string; data?: Record<string, unknown> };
const props = (repo: CrmRepository, id: string) => repo.listProposals().filter((p) => p.id === id);

describe('Pacote J (A1): proposta nunca e sobreposta/duplicada pelo id ou codigo do cliente', () => {
  it('ataque exato do probe: vendedor POST com o id da proposta de outro => id ignorado; a original continua no link', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const victim = props(repo, 'prop-seta-002')[0];
    const before = JSON.stringify(victim);
    const c = await router.dispatch({
      method: 'POST', path: '/api/erp/proposals', query: S(),
      body: { id: victim.id, code: victim.code, title: 'Proposta trocada', companyName: victim.companyName, status: 'ENVIADA', items: [{ id: 'i', description: 'Item do golpe', quantity: 1, unitPrice: 99999, isRecurring: true }] },
    });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    const created = (c.body as Body).data as unknown as ErpCommercialProposal;
    assert.notEqual(created.id, victim.id, 'id do cliente ignorado');
    assert.notEqual(String(created.code).toLowerCase(), String(victim.code).toLowerCase(), 'codigo do cliente ignorado');
    assert.equal(props(repo, victim.id).length, 1, 'sem duplicata');
    assert.equal(JSON.stringify(props(repo, victim.id)[0]), before, 'original intacta');
    assert.equal(repo.listProposals().filter((p) => String(p.code).toLowerCase() === String(victim.code).toLowerCase()).length, 1);
    // Link / leitura pelo id e pelo codigo continuam na original.
    for (const ref of [victim.id, victim.code]) {
      const g = await router.dispatch({ method: 'GET', path: `/api/erp/proposals/${encodeURIComponent(ref)}`, query: A() });
      assert.equal(g.status, 200);
      assert.equal(((g.body as Body).data as Record<string, unknown>).title, victim.title, ref);
    }
    // PATCH do atacante pelo id da vitima nao atinge a copia criada.
    assert.equal(props(repo, created.id)[0].title, 'Proposta trocada');
  });

  it('variacao de caixa do id e id = codigo de outra tambem nao criam sombra (POST de sessao)', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    for (const id of ['PROP-SETA-002', '4700', ' prop-seta-002 ']) {
      const c = await router.dispatch({ method: 'POST', path: '/api/erp/proposals', query: S(), body: { id, title: 'X', companyName: 'C' } });
      assert.equal(c.status, 201);
      assert.ok(!['prop-seta-002', '4700'].includes(String(((c.body as Body).data as Record<string, unknown>).id).trim().toLowerCase()));
    }
    const keys = repo.listProposals().flatMap((p) => [p.id.toLowerCase(), String(p.code).toLowerCase()]);
    assert.equal(keys.filter((k) => k === 'prop-seta-002').length, 1);
    assert.equal(keys.filter((k) => k === '4700').length, 1);
  });

  it('contexto interno: id/codigo ja existente => 409 (repositorio lanca RecordIdConflictError)', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    for (const body of [{ id: 'prop-seta-002' }, { id: 'Prop-Seta-002' }, { id: '4699' }, { code: '4701' }, { code: 'prop-seta-004' }]) {
      const r = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: '/api/erp/proposals', body: { ...body, title: 'T', companyName: 'C' } });
      assert.equal(r.status, 409, JSON.stringify(body));
      assert.match(String((r.body as Body).code), /^PROPOSAL_(ID|CODE)_CONFLICT$/);
    }
    assert.throws(() => repo.createProposal({ id: 'prop-seta-001', title: 'x' }), RecordIdConflictError);
    const ok = repo.createProposal({ title: 'Nova sem id' });
    assert.match(ok.id, /^prop-/);
    assert.ok(ok.code && repo.listProposals().filter((p) => p.code === ok.code).length === 1, 'codigo gerado unico');
  });

  it('upsert (PATCH de id inexistente): nao duplica codigo e id com caixa trocada => 409', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const r = await router.dispatch({ method: 'PATCH', path: '/api/erp/proposals/prop-nova-upsert', query: A(), body: { title: 'Upsert', code: '4700' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const up = props(repo, 'prop-nova-upsert')[0];
    assert.ok(up && up.code.toLowerCase() !== '4700', 'codigo ocupado => servidor gera outro');
    const r2 = await router.dispatch({ method: 'PATCH', path: '/api/erp/proposals/PROP-SETA-002', query: A(), body: { title: 'Sombra por caixa' } });
    assert.equal(r2.status, 409);
    assert.equal(props(repo, 'prop-seta-002')[0].title !== 'Sombra por caixa', true);
  });

  it('journal: proposta nova com id de outra (caixa/codigo) e descartada; codigo ocupado/ausente => codigo do servidor', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const fut = new Date(Date.now() + 60_000).toISOString();
    const victimBefore = JSON.stringify(props(repo, 'prop-seta-002')[0]);
    const r = await router.dispatch({
      method: 'POST', path: '/api/state/reconcile', query: S(),
      body: { journal: { upsertedProposals: [
        { id: 'PROP-SETA-002', title: 'Sombra caixa', updatedAt: fut },
        { id: '4700', title: 'Sombra codigo', updatedAt: fut },
        { id: 'jn-dup-code', code: '4700', title: 'Codigo da vitima', updatedAt: fut },
        { id: 'jn-ok', code: 'PROP-JN-1', title: 'Nova legitima', updatedAt: fut },
      ] } },
    });
    assert.equal(r.status, 200);
    const all = repo.listProposals();
    assert.ok(!all.some((p) => p.id === 'PROP-SETA-002' || p.id === '4700'), 'sombras descartadas');
    assert.equal(all.filter((p) => String(p.code).toLowerCase() === '4700').length, 1, 'codigo da vitima nao duplica');
    assert.ok(props(repo, 'jn-dup-code')[0].code && props(repo, 'jn-dup-code')[0].code !== '4700');
    assert.equal(props(repo, 'jn-ok')[0].code, 'PROP-JN-1');
    assert.equal(JSON.stringify(props(repo, 'prop-seta-002')[0]), victimBefore);
    // Existente: o journal nao troca o codigo para o de outra nem o apaga.
    const cur = props(repo, 'prop-seta-004')[0];
    await router.dispatch({ method: 'POST', path: '/api/state/reconcile', query: A(), body: { journal: { upsertedProposals: [{ ...cur, code: '4700', updatedAt: new Date(Date.now() + 120_000).toISOString() }] } } });
    assert.equal(props(repo, 'prop-seta-004')[0].code, cur.code);
    await router.dispatch({ method: 'POST', path: '/api/state/reconcile', query: A(), body: { journal: { upsertedProposals: [{ ...cur, code: null, updatedAt: new Date(Date.now() + 180_000).toISOString() }] } } });
    assert.equal(props(repo, 'prop-seta-004')[0].code, cur.code);
    // Numeracao GestaoClick: codigo legado PROP-AAAA-NNN do navegador nao troca o numero do servidor.
    await router.dispatch({ method: 'POST', path: '/api/state/reconcile', query: A(), body: { journal: { upsertedProposals: [{ ...cur, code: 'PROP-2026-004', updatedAt: new Date(Date.now() + 240_000).toISOString() }] } } });
    assert.equal(props(repo, 'prop-seta-004')[0].code, '4702');
  });

  it('contatos, empresas, negocios e contratos: POST com id existente => 409 e nada muda; numero de contrato nao duplica', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const contact = repo.listContacts()[0];
    const company = repo.listCompanies()[0];
    const deal = repo.listDeals()[0];
    const contract = repo.listRentalContracts()[0];
    const snap = JSON.stringify([contact, company, deal, contract]);
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['/api/contacts', { id: contact.id, firstName: 'Sombra', email: 'sombra@example.com' }, 'CONTACT_ID_CONFLICT'],
      ['/api/companies', { id: company.id, name: 'Sombra Ltda' }, 'COMPANY_ID_CONFLICT'],
      ['/api/deals', { id: deal.id, title: 'Sombra', value: 1 }, 'DEAL_ID_CONFLICT'],
      ['/api/erp/rental-contracts', { id: contract.id, title: 'Sombra', companyName: 'X', monthlyValue: 1 }, 'CONTRACT_ID_CONFLICT'],
    ];
    for (const [path, body, code] of cases) {
      const r = await router.dispatch({ method: 'POST', path, query: A(), body });
      assert.equal(r.status, 409, `${path} ${JSON.stringify(r.body)}`);
      assert.equal((r.body as Body).code, code);
    }
    assert.equal(repo.listContacts().filter((c) => c.id === contact.id).length, 1);
    assert.equal(repo.listCompanies().filter((c) => c.id === company.id).length, 1);
    assert.equal(repo.listDeals().filter((d) => d.id === deal.id).length, 1);
    assert.equal(repo.listRentalContracts().filter((c) => c.id === contract.id).length, 1);
    assert.equal(JSON.stringify([repo.getContactById(contact.id), repo.getCompanyById(company.id), repo.listDeals().find((d) => d.id === deal.id), repo.listRentalContracts().find((c) => c.id === contract.id)]), snap);
    const r = await router.dispatch({ method: 'POST', path: '/api/erp/rental-contracts', query: A(), body: { title: 'Novo', companyName: 'X', monthlyValue: 1, contractNumber: contract.contractNumber } });
    assert.equal(r.status, 201);
    assert.equal(repo.listRentalContracts().filter((c) => c.contractNumber === contract.contractNumber).length, 1);
    assert.throws(() => repo.createServiceTicket({ id: repo.listServiceTickets()[0].id, subject: 'x' }), RecordIdConflictError);
  });
});

describe('Pacote J (A2): proposta sem code nao derruba as edicoes', () => {
  it('journal com proposta sem code => servidor preenche; PATCH do admin em outra proposta segue 200', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const fut = new Date(Date.now() + 60_000).toISOString();
    const rj = await router.dispatch({ method: 'POST', path: '/api/state/reconcile', query: S(), body: { journal: { upsertedProposals: [{ id: 'jn-nocode', title: 'sem code', sellerEmail: SELLER_EMAIL, updatedAt: fut }] } } });
    assert.equal(rj.status, 200);
    const nc = props(repo, 'jn-nocode')[0];
    assert.ok(nc && typeof nc.code === 'string' && nc.code.length > 0, 'code preenchido pelo servidor');
    const p = await router.dispatch({ method: 'PATCH', path: '/api/erp/proposals/prop-seta-002', query: A(), body: { title: 'admin edita outra' } });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    const p2 = await router.dispatch({ method: 'PATCH', path: '/api/erp/proposals/jn-nocode', query: A(), body: { title: 'edita a propria' } });
    assert.equal(p2.status, 200);
  });

  it('estado ja gravado com proposta sem code (dado legado) continua editavel e o code e preenchido sem perder dados', async () => {
    const repo = createInMemoryRepository();
    const state = structuredClone(repo.getState()) as ReturnType<CrmRepository['getState']> & { erp: NonNullable<ReturnType<CrmRepository['getState']>['erp']> };
    const legacy = { ...state.erp.proposals[2], id: 'legacy-nocode', title: 'Legado' } as Record<string, unknown>;
    delete legacy.code;
    state.erp.proposals.push(legacy as unknown as ErpCommercialProposal);
    repo.loadState(state);
    const router = new CrmApiRouter(repo);
    for (const [id, title] of [['prop-seta-002', 'ok 1'], ['legacy-nocode', 'ok 2']]) {
      const r = await router.dispatch({ method: 'PATCH', path: `/api/erp/proposals/${id}`, query: A(), body: { title } });
      assert.equal(r.status, 200, `${id} ${JSON.stringify(r.body)}`);
    }
    const leg = props(repo, 'legacy-nocode')[0];
    assert.equal(leg.title, 'ok 2');
    assert.ok(leg.code);
    assert.equal(repo.listProposals().length, state.erp.proposals.length, 'nenhuma proposta perdida');
    assert.equal(repo.deleteProposal('nao-existe'), false);
  });
});

describe('Pacote J (3): /api/erp/daily-sync so com 2FA + admin/ERP FULL; cron preservado', () => {
  it('vendedor 403 (POST e GET ?trigger=1 e GET), anonimo 401, sem 2FA bloqueado; admin e ERP FULL 200; cron 200', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    for (const [method, q] of [['POST', {}], ['GET', { trigger: '1' }], ['GET', {}]] as const) {
      const r = await router.dispatch({ method, path: '/api/erp/daily-sync', query: { ...S(), ...q }, body: {} });
      assert.equal(r.status, 403, `${method} ${JSON.stringify(q)}`);
      assert.equal((r.body as Body).code, 'ERP_DAILY_SYNC_FORBIDDEN');
    }
    assert.ok(repo.listSecurityAuditLogs(10000).logs.some((l) => l.action === 'ERP_DAILY_SYNC_DENIED' && l.actorEmail === SELLER_EMAIL));
    assert.equal((await router.dispatch({ method: 'POST', path: '/api/erp/daily-sync', query: ANON(), body: {} })).status, 401);
    const noMfa = await router.dispatch({ method: 'POST', path: '/api/erp/daily-sync', query: A({ mfaVerified: false }), body: {} });
    assert.ok([401, 403].includes(noMfa.status));
    // _cronAuthorized forjado em POST ou sem bridge nao vale.
    assert.equal((await router.dispatch({ method: 'POST', path: '/api/erp/daily-sync', query: { ...S(), _cronAuthorized: '1' }, body: {} })).status, 403);
    assert.equal((await router.dispatch({ method: 'POST', path: '/api/erp/daily-sync', query: A(), body: {} })).status, 200);
    const cron = await router.dispatch({ method: 'GET', path: '/api/erp/daily-sync', query: { ...HTTP, _cronAuthorized: '1' } });
    assert.equal(cron.status, 200, JSON.stringify(cron.body).slice(0, 200));
    const seller = repo.findRbacUserRecord('usr-seta-03', SELLER_EMAIL)!;
    repo.upsertRbacUser({ ...seller, ...buildFullControlForModule('ERP', seller) } as never);
    const full = await router.dispatch({ method: 'POST', path: '/api/erp/daily-sync', query: S(), body: {} });
    assert.equal(full.status, 200, 'controle TOTAL do ERP');
  });
});

describe('Pacote J (4): POST /api/tickets com enums', () => {
  it('status/prioridade/categoria/canal fora do enum => 400 sem criar; validos/ausentes => 201', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const n0 = repo.listServiceTickets().length;
    for (const extra of [{ status: 'HACKED_STATUS' }, { status: 'open' }, { status: 1 }, { status: { a: 1 } }, { priority: 'URGENTE' }, { category: 'X' }, { channel: 'SMS' }]) {
      const r = await router.dispatch({ method: 'POST', path: '/api/tickets', query: A(), body: { subject: 'Teste', ...extra } });
      assert.equal(r.status, 400, JSON.stringify(extra));
      assert.equal((r.body as Body).code, 'TICKET_CREATE_FIELD_INVALID');
    }
    assert.equal(repo.listServiceTickets().length, n0);
    const ok = await router.dispatch({ method: 'POST', path: '/api/tickets', query: A(), body: { subject: 'Ok', status: 'IN_PROGRESS', priority: 'HIGH', category: 'INCIDENT', channel: 'EMAIL' } });
    assert.equal(ok.status, 201);
    assert.equal(((ok.body as Body).data as Record<string, unknown>).status, 'IN_PROGRESS');
    const def = await router.dispatch({ method: 'POST', path: '/api/tickets', query: A(), body: { subject: 'Padrao', status: '' } });
    assert.equal(def.status, 201);
    assert.equal(((def.body as Body).data as Record<string, unknown>).status, 'OPEN');
  });
});

describe('Pacote J (5): /api/bootstrap com RBAC minimo para nao-admin', () => {
  it('vendedor: so o proprio usuario e o proprio papel; sem auditLogs, securityConfig nem e-mails de outros', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    repo.appendSecurityAuditLog({ actorEmail: ADMIN_EMAIL, actorName: 'A', actorRole: 'SUPER_ADMIN', action: 'X_TESTE_J', module: 'IAM_RBAC', resource: 'r', status: 'SUCCESS', details: 'segredo-de-auditoria-j' });
    for (const [method, path] of [['GET', '/api/bootstrap'], ['GET', '/api/state'], ['POST', '/api/state/reconcile']] as const) {
      const r = await router.dispatch({ method, path, query: S(), body: {} });
      assert.equal(r.status, 200, path);
      const rbac = ((r.body as Body).data as Record<string, unknown>).rbac as Record<string, unknown[]> & { securityConfig: Record<string, unknown> };
      assert.equal(rbac.users.length, 1, path);
      assert.equal((rbac.users[0] as Record<string, unknown>).email, SELLER_EMAIL);
      assert.ok(rbac.roles.length <= 1 && rbac.roles.every((x) => (x as Record<string, unknown>).id === 'VENDEDOR_SALES'));
      assert.deepEqual(rbac.auditLogs, []);
      assert.deepEqual(rbac.securityConfig, {});
      const j = JSON.stringify(rbac);
      assert.ok(!j.includes(ADMIN_EMAIL) && !j.includes('segredo-de-auditoria-j') && !/passwordHash|totpSecret/.test(j), path);
    }
  });

  it('admin (canManageUsersRbac) segue com o RBAC completo (painel IAM)', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const r = await router.dispatch({ method: 'GET', path: '/api/bootstrap', query: A() });
    const rbac = ((r.body as Body).data as Record<string, unknown>).rbac as Record<string, unknown[]>;
    assert.equal(rbac.users.length, repo.getRbacState().users.length);
    assert.ok(rbac.roles.length > 1);
    assert.ok(!/"passwordHash"|"totpSecret"/.test(JSON.stringify(rbac)));
  });
});

describe('Pacote J (6): config GestaoClick (D-I2, D-I3)', () => {
  it('auto-NF: admin liga/desliga com auditoria; vendedor 403; nao-booleano 400', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const prev = repo.getErpOverview().gestaoClickConfig.autoGenerateMonthlyRentalInvoices;
    const next = !prev;
    const s = await router.dispatch({ method: 'PATCH', path: '/api/erp/gestaoclick/config', query: S(), body: { autoGenerateMonthlyRentalInvoices: next } });
    assert.equal(s.status, 403);
    assert.equal(parseGestaoClickConfigPatch({ autoGenerateMonthlyRentalInvoices: 'true' }).ok, false);
    const r = await router.dispatch({ method: 'PATCH', path: '/api/erp/gestaoclick/config', query: A(), body: { autoGenerateMonthlyRentalInvoices: next } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(repo.getErpOverview().gestaoClickConfig.autoGenerateMonthlyRentalInvoices, next);
    const log = repo.listSecurityAuditLogs(10000).logs.find((l) => l.action === 'GESTAOCLICK_CONFIG_UPDATED');
    assert.ok(log && log.details.includes('"field":"autoGenerateMonthlyRentalInvoices"'));
  });

  it('CNPJ gravado so com digitos (pontuado, espacado ou cru => mesmo valor); excecao de DV da Seta intacta', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    for (const v of ['14.806.925/0001-32', '14 806 925 0001 32', '14806925000132']) {
      const r = await router.dispatch({ method: 'PATCH', path: '/api/erp/gestaoclick/config', query: A(), body: { companyCnpj: v } });
      assert.equal(r.status, 200, v);
      assert.equal(repo.getErpOverview().gestaoClickConfig.companyCnpj, '14806925000132', v);
    }
  });
});

describe('Pacote J (D-I4): IPv6 agrupado por /64 nos limites de login', () => {
  it('rateLimitIpKey', () => {
    assert.equal(rateLimitIpKey('203.0.113.7'), '203.0.113.7');
    assert.equal(rateLimitIpKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:db8:1:2::/64');
    assert.equal(rateLimitIpKey('2001:DB8:1:2::1'), '2001:db8:1:2::/64');
    assert.equal(rateLimitIpKey('2001:0db8:0001:0002:0:0:0:ffff'), '2001:db8:1:2::/64');
    assert.equal(rateLimitIpKey('2001:db8::'), '2001:db8:0:0::/64');
    assert.equal(rateLimitIpKey('::ffff:198.51.100.9'), '198.51.100.9');
    assert.equal(rateLimitIpKey('fe80::1%eth0'), 'fe80:0:0:0::/64');
    assert.equal(rateLimitIpKey(undefined), 'sem-ip');
    assert.notEqual(rateLimitIpKey('2001:db8:1:2::1'), rateLimitIpKey('2001:db8:1:3::1'));
  });

  it('20 e-mails a partir de enderecos diferentes do mesmo /64 => o /64 inteiro fica bloqueado', () => {
    const g = new LoginIpFailureGuard();
    const now = Date.now();
    for (let i = 0; i < LoginIpFailureGuard.DISTINCT_EMAILS_PER_IP; i++) {
      g.hit(`2001:db8:aa:bb::${(i + 1).toString(16)}`, `vitima${i}@x.com`, now);
    }
    assert.equal(g.isBlocked('2001:db8:aa:bb:ffff::9', 'outro@x.com', now), true);
    assert.equal(g.isBlocked('2001:db8:aa:bc::1', 'outro@x.com', now), false, 'outro /64 nao afetado');
  });
});

describe('Pacote J (D-I6): sessao do navegador por allowlist, sem corte por profundidade', () => {
  it('chaves fora do formato caem em qualquer nivel; dados legitimos profundos ficam', () => {
    const s = sanitizeActiveSessionForStorage({
      authenticated: true,
      mfaVerified: true,
      role: {
        id: 'VENDEDOR_SALES', name: 'Vendedor', secretKey: 'K1', pwdHash: 'H1',
        crmItemPermissions: { contacts: { view: true, edit: false, delete: false, privateKey: 'P1' }, hash: { view: true } },
        actionGuards: { canManageUsersRbac: false, credentials: { pin: '1234' } },
        modulePermissions: { CRM: 'FULL', passwd: 'X1' },
      },
      erpPermissions: { maxDiscountPercent: 10, sealed: 'S1', a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } },
      effectiveActionGuards: { canExportData: true, pin: '9999' },
      enabledModules: ['CRM', 'ERP', { evil: 1 }],
    } as Record<string, unknown>) as Record<string, unknown>;
    const j = JSON.stringify(s);
    for (const bad of ['K1', 'H1', 'P1', '1234', 'X1', 'S1', '9999', 'evil', '"hash"', '"a"']) assert.ok(!j.includes(bad), bad);
    const role = s.role as Record<string, Record<string, Record<string, unknown>>>;
    assert.equal(role.crmItemPermissions.contacts.view, true, 'mapa de permissoes por item preservado (nivel 4)');
    assert.equal(role.modulePermissions.CRM, 'FULL');
    assert.equal((s.erpPermissions as Record<string, unknown>).maxDiscountPercent, 10);
    assert.equal((s.effectiveActionGuards as Record<string, unknown>).canExportData, true);
    assert.deepEqual(s.enabledModules, ['CRM', 'ERP']);
  });
});
