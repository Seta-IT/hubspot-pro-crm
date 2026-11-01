// ============================================================================
// STI-hub — Pacote K (01/11/2026): D-I2 (fatura/NF por qualquer caminho exige a alcada fiscal de
// /generate-invoice; flag autoGenerateMonthlyRentalInvoices respeitada na geracao ao salvar;
// negativas auditadas), CNPJ do /api/admin/settings so com digitos, journal de contratos com
// numero duplicado e de contatos/empresas/negocios com id em outra caixa, POST /tickets com id
// existente (201 com id novo, documentado) e exce\u00e7\u00e3o do CNPJ -32 intacta.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository, CrmRepository } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import { validateCnpj } from '../src/modules/data-health/validators';
import type { ErpRentalContract } from '../src/db/types';

const HTTP = { _fromHttpBridge: '1' };
const tok = (uid: string, email: string, roleId: string, extra: Record<string, unknown> = {}) =>
  signStiHubSessionToken({
    uid, email, name: 'Teste', roleId, scope: roleId === 'SUPER_ADMIN' ? 'TODOS' : 'PROPRIOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000, ...extra,
  } as Parameters<typeof signStiHubSessionToken>[0]);
const SELLER_EMAIL = 'marialuiza@setatelecom.com.br';
const A = () => ({ ...HTTP, _sessionToken: tok('usr-seta-01', 'marcelo.mira@setatelecom.com.br', 'SUPER_ADMIN', { canManageUsersRbac: true }) });
const S = () => ({ ...HTTP, _sessionToken: tok('usr-seta-03', SELLER_EMAIL, 'VENDEDOR_SALES') });
const G = () => ({ ...HTTP, _sessionToken: tok('usr-seta-02', 'evelyn@setatelecom.com.br', 'GERENTE_COMERCIAL') });
const F = () => ({ ...HTTP, _sessionToken: tok('usr-seta-06', 'fiscal@setatelecom.com.br', 'FISCAL_CONTABIL') });
type Body = { code?: string; error?: string; data?: Record<string, unknown> };
const code = (r: { body: unknown }) => (r.body as Body).code;
const invCount = (repo: CrmRepository) => repo.listInvoices().length;
const firstContract = (repo: CrmRepository): ErpRentalContract => repo.listRentalContracts()[0];
const deniedLogs = (repo: CrmRepository, email: string) =>
  repo.listSecurityAuditLogs(10000).logs.filter((l) => l.action === 'ERP_FISCAL_ISSUANCE_DENIED' && l.actorEmail === email);
const setAutoFlag = (repo: CrmRepository, v: boolean) => {
  repo.updateGestaoClickConfig({ autoGenerateMonthlyRentalInvoices: v } as Parameters<CrmRepository['updateGestaoClickConfig']>[0]);
  assert.equal(repo.getErpOverview().gestaoClickConfig.autoGenerateMonthlyRentalInvoices, v);
};

describe('Pacote K (D-I2): generateNextInvoiceOnSave exige a alcada fiscal de /generate-invoice', () => {
  it('ataque exato do parecer: vendedor PATCH {generateNextInvoiceOnSave:true} com a flag em false => 403, nenhuma fatura, contrato intacto, auditado', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    setAutoFlag(repo, false);
    const ct = firstContract(repo);
    const before = JSON.stringify(repo.listRentalContracts().find((c) => c.id === ct.id));
    const n0 = invCount(repo);
    const r = await router.dispatch({ method: 'PATCH', path: `/api/erp/rental-contracts/${ct.id}`, query: S(), body: { generateNextInvoiceOnSave: true } });
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.equal(code(r), 'ERP_FISCAL_ISSUANCE_FORBIDDEN');
    assert.equal(invCount(repo), n0, 'nenhuma fatura criada');
    assert.equal(JSON.stringify(repo.listRentalContracts().find((c) => c.id === ct.id)), before, 'contrato intacto (sem nova versao)');
    const g = await router.dispatch({ method: 'POST', path: `/api/erp/rental-contracts/${ct.id}/generate-invoice`, query: S(), body: {} });
    assert.equal(g.status, 403);
    assert.equal(code(g), 'ERP_FISCAL_ISSUANCE_FORBIDDEN', 'mesma resposta de /generate-invoice');
    assert.ok(deniedLogs(repo, SELLER_EMAIL).length >= 2, 'negativas auditadas (PATCH e /generate-invoice)');
  });

  it('vendedor e gerente: PUT, POST, alias /api/erp/contracts e PATCH-upsert de id novo tambem dao 403 (flag ligada ou desligada)', async () => {
    for (const flag of [true, false]) {
      const repo = createInMemoryRepository();
      const router = new CrmApiRouter(repo);
      setAutoFlag(repo, flag);
      const ct = firstContract(repo);
      const n0 = invCount(repo);
      const c0 = repo.listRentalContracts().length;
      for (const q of [S, G]) {
        const reqs: Array<[string, string, Record<string, unknown>]> = [
          ['PUT', `/api/erp/rental-contracts/${ct.id}`, { generateNextInvoiceOnSave: true }],
          ['PATCH', `/api/erp/contracts/${ct.id}`, { generateNextInvoiceOnSave: true, title: 'X' }],
          ['PATCH', `/api/erp/rental-contracts/${encodeURIComponent(ct.contractNumber)}`, { generateNextInvoiceOnSave: true }],
          ['POST', '/api/erp/rental-contracts', { title: 'Novo', companyName: 'Cliente', monthlyValue: 100, generateNextInvoiceOnSave: true }],
          ['POST', '/api/erp/contracts', { title: 'Novo', companyName: 'Cliente', monthlyValue: 100, generateNextInvoiceOnSave: true }],
          ['PATCH', '/api/erp/rental-contracts/ctr-upsert-k', { title: 'Upsert', companyName: 'Cliente', monthlyValue: 100, generateNextInvoiceOnSave: true }],
        ];
        for (const [method, p, body] of reqs) {
          const r = await router.dispatch({ method, path: p, query: q(), body });
          assert.equal(r.status, 403, `${method} ${p} flag=${flag}: ${JSON.stringify(r.body)}`);
          assert.equal(code(r), 'ERP_FISCAL_ISSUANCE_FORBIDDEN');
        }
      }
      assert.equal(invCount(repo), n0, 'nenhuma fatura');
      assert.equal(repo.listRentalContracts().length, c0, 'nenhum contrato criado pelo pedido negado');
    }
  });

  it('vendedor: edicao normal do contrato (sem a chave ou com false) continua 200; valor nao booleano => 400', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const ct = firstContract(repo);
    const n0 = invCount(repo);
    const ok1 = await router.dispatch({ method: 'PATCH', path: `/api/erp/rental-contracts/${ct.id}`, query: S(), body: { contractNotes: 'nota K' } });
    assert.equal(ok1.status, 200);
    const ok2 = await router.dispatch({ method: 'PATCH', path: `/api/erp/rental-contracts/${ct.id}`, query: S(), body: { generateNextInvoiceOnSave: false, contractNotes: 'nota K2' } });
    assert.equal(ok2.status, 200);
    for (const v of ['true', 1, {}, null]) {
      const bad = await router.dispatch({ method: 'PATCH', path: `/api/erp/rental-contracts/${ct.id}`, query: S(), body: { generateNextInvoiceOnSave: v } });
      assert.equal(bad.status, 400, String(v));
      assert.equal(code(bad), 'CONTRACT_FIELD_INVALID');
    }
    assert.equal(invCount(repo), n0);
  });

  it('admin e perfil fiscal (nao admin) geram normalmente com a flag ligada; flag desligada => 409 ERP_AUTO_INVOICE_DISABLED e /generate-invoice segue disponivel', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    setAutoFlag(repo, true);
    const ct = firstContract(repo);
    for (const q of [A, F]) {
      const n0 = invCount(repo);
      const r = await router.dispatch({ method: 'PATCH', path: `/api/erp/rental-contracts/${ct.id}`, query: q(), body: { generateNextInvoiceOnSave: true } });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(invCount(repo), n0 + 1, 'uma fatura gerada');
      assert.equal(((r.body as Body).data as Record<string, unknown>).generateNextInvoiceOnSave, false);
    }
    const nPost = invCount(repo);
    const created = await router.dispatch({ method: 'POST', path: '/api/erp/rental-contracts', query: F(), body: { title: 'Novo fiscal', companyName: 'Cliente', monthlyValue: 100, generateNextInvoiceOnSave: true } });
    assert.equal(created.status, 201);
    assert.equal(invCount(repo), nPost + 1);

    setAutoFlag(repo, false);
    const before = JSON.stringify(repo.listRentalContracts().find((c) => c.id === ct.id));
    for (const q of [A, F]) {
      const n0 = invCount(repo);
      const r = await router.dispatch({ method: 'PATCH', path: `/api/erp/rental-contracts/${ct.id}`, query: q(), body: { generateNextInvoiceOnSave: true, contractNotes: 'nao grava' } });
      assert.equal(r.status, 409);
      assert.equal(code(r), 'ERP_AUTO_INVOICE_DISABLED');
      assert.equal(invCount(repo), n0);
    }
    const internal = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'PATCH', path: `/api/erp/rental-contracts/${ct.id}`, body: { generateNextInvoiceOnSave: true } });
    assert.equal(internal.status, 409, 'flag vale tambem no contexto interno');
    assert.equal(JSON.stringify(repo.listRentalContracts().find((c) => c.id === ct.id)), before, 'contrato intacto');
    assert.ok(repo.listSecurityAuditLogs(10000).logs.some((l) => l.action === 'ERP_AUTO_INVOICE_DISABLED'));
    for (const q of [A, F]) {
      const n0 = invCount(repo);
      const g = await router.dispatch({ method: 'POST', path: `/api/erp/rental-contracts/${ct.id}/generate-invoice`, query: q(), body: {} });
      assert.equal(g.status, 201, 'emissao manual continua com a flag desligada');
      assert.equal(invCount(repo), n0 + 1);
    }
  });

  it('outros caminhos que geram fatura/NF sem a alcada: batch-billing, NF-e de importacao, devolucao parcial, generate-remessa, invoices => 403 auditado', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const ct = firstContract(repo);
    const n0 = invCount(repo);
    const reqs: Array<[string, Record<string, unknown>]> = [
      ['/api/erp/rental-contracts/batch-billing', { competenceMonth: '12/2026', items: [{ contractId: ct.id }] }],
      ['/api/erp/rental-contracts/batch-billing', {}],
      ['/api/erp/nfe-importacao/emit', { serie: '1', nNF: '99' }],
      [`/api/erp/rental-contracts/${ct.id}/partial-return`, { itemsToReturn: [{ equipmentIdx: 0, quantityReturned: 1 }] }],
      [`/api/erp/contracts/${ct.id}/partial-return`, { itemsToReturn: [{ equipmentIdx: 0, quantityReturned: 1 }], emitReturnNfe: false }],
      [`/api/erp/rental-contracts/${ct.id}/generate-remessa`, {}],
      ['/api/erp/invoices', { companyName: 'X', grossAmount: 10 }],
      ['/api/erp/fiscal-documents', { companyName: 'X', grossAmount: 10 }],
    ];
    const logs0 = deniedLogs(repo, SELLER_EMAIL).length;
    for (const [p, body] of reqs) {
      const r = await router.dispatch({ method: 'POST', path: p, query: S(), body });
      assert.equal(r.status, 403, `${p}: ${JSON.stringify(r.body)}`);
      assert.equal(code(r), 'ERP_FISCAL_ISSUANCE_FORBIDDEN');
    }
    assert.equal(invCount(repo), n0, 'nenhuma fatura/NF');
    assert.equal(deniedLogs(repo, SELLER_EMAIL).length, logs0 + reqs.length, 'cada negativa auditada');
    // Devolucao parcial SEM emissao (as duas flags false) nao e emissao fiscal: segue o fluxo normal.
    const noEmit = await router.dispatch({ method: 'POST', path: `/api/erp/rental-contracts/${ct.id}/partial-return`, query: S(), body: { itemsToReturn: [{ equipmentIdx: 0, quantityReturned: 1 }], emitReturnNfe: false, emitProRataInvoice: false } });
    assert.notEqual(noEmit.status, 403);
    assert.equal(invCount(repo), n0);
    // Perfil fiscal faz o faturamento em lote.
    const fb = await router.dispatch({ method: 'POST', path: '/api/erp/rental-contracts/batch-billing', query: F(), body: { competenceMonth: '12/2026', items: [{ contractId: ct.id }] } });
    assert.equal(fb.status, 201);
    assert.ok(invCount(repo) > n0);
  });

  it('journal: vendedor nao cria fatura/NF (state/reconcile, _reconcileJournal e bootstrap); contrato do journal nunca gera fatura; perfil fiscal cria', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const n0 = invCount(repo);
    const fake = (id: string) => ({ id, documentNumber: `FAT-K-${id}`, documentType: 'FATURA_LOCACAO', companyName: 'X', grossAmount: 999, netAmount: 999, status: 'EMITIDA', updatedAt: new Date(Date.now() + 60000).toISOString() });
    const r1 = await router.dispatch({ method: 'POST', path: '/api/state/reconcile', query: S(), body: { journal: { upsertedInvoices: [fake('inv-k-1')] } } });
    assert.equal(r1.status, 200);
    const r2 = await router.dispatch({ method: 'GET', path: '/api/erp/overview', query: S(), body: { _reconcileJournal: { upsertedInvoices: [fake('inv-k-2')] } } });
    assert.ok(r2.status < 500);
    const r3 = await router.dispatch({ method: 'POST', path: '/api/bootstrap', query: S(), body: { reconcileJournal: { upsertedInvoices: [fake('inv-k-3')] } } });
    assert.equal(r3.status, 200);
    assert.equal(invCount(repo), n0, 'nenhuma fatura do journal do vendedor');
    assert.ok(deniedLogs(repo, SELLER_EMAIL).some((l) => String(l.resource).startsWith('journal')));
    // Atualizacao de fatura EXISTENTE pelo journal segue como antes (mesma regra do PATCH /api/erp/invoices/:id).
    const existing = repo.listInvoices()[0];
    await router.dispatch({ method: 'POST', path: '/api/state/reconcile', query: S(), body: { journal: { upsertedInvoices: [{ ...existing, id: existing.id.toUpperCase() === existing.id ? existing.id : existing.id.toUpperCase(), notes: 'k', updatedAt: new Date(Date.now() + 120000).toISOString() }] } } });
    assert.equal(invCount(repo), n0, 'variacao de caixa do id da fatura e a mesma fatura (sem nova)');
    // Contrato do journal com generateNextInvoiceOnSave:true nao gera fatura e e gravado com false.
    const ctrJ = { id: 'ctr-journal-k', contractNumber: 'LOC-2026-K1', title: 'J', companyName: 'C', monthlyValue: 10, generateNextInvoiceOnSave: true, updatedAt: new Date().toISOString() };
    await router.dispatch({ method: 'POST', path: '/api/state/reconcile', query: A(), body: { journal: { upsertedContracts: [ctrJ] } } });
    assert.equal(invCount(repo), n0);
    assert.equal(repo.listRentalContracts().find((c) => c.id === 'ctr-journal-k')?.generateNextInvoiceOnSave, false);
    // Perfil fiscal: o journal cria a fatura nova.
    await router.dispatch({ method: 'POST', path: '/api/state/reconcile', query: F(), body: { journal: { upsertedInvoices: [fake('inv-k-fiscal')] } } });
    assert.equal(invCount(repo), n0 + 1);
  });

  it('cron: a sincronizacao diaria (unico cron do vercel.json) nao gera fatura/NF', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const n0 = invCount(repo);
    const cron = await router.dispatch({ method: 'GET', path: '/api/erp/daily-sync', query: { ...HTTP, _cronAuthorized: '1' } });
    assert.equal(cron.status, 200);
    assert.equal(invCount(repo), n0);
    const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'vercel.json'), 'utf8')) as { crons?: Array<{ path: string }> };
    assert.deepEqual((vercel.crons || []).map((c) => c.path), ['/api/erp/daily-sync'], 'novo cron precisa passar pela alcada fiscal/flag');
  });
});

describe('Pacote K: /api/admin/settings grava companyEmitter.cnpj so com digitos', () => {
  it('formatado, com espacos ou so digitos => 14806925000132 no emitente e na config; nao-texto/vazio => 400; outra raiz => 400', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    for (const cnpj of ['14.806.925/0001-32', ' 14806925000132 ', '14 806 925 0001 32']) {
      const r = await router.dispatch({ method: 'PUT', path: '/api/admin/settings', query: A(), body: { companyEmitter: { cnpj } } });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(((r.body as Body).data as { companyEmitter: { cnpj: string } }).companyEmitter.cnpj, '14806925000132');
      assert.equal(repo.getErpOverview().gestaoClickConfig.companyCnpj, '14806925000132');
      const g = await router.dispatch({ method: 'GET', path: '/api/admin/settings', query: A() });
      assert.equal(((g.body as Body).data as { companyEmitter: { cnpj: string } }).companyEmitter.cnpj, '14806925000132');
    }
    for (const cnpj of [14806925000132, '', '   ', null, { a: 1 }]) {
      const r = await router.dispatch({ method: 'PATCH', path: '/api/admin/settings', query: A(), body: { companyEmitter: { cnpj } } });
      assert.equal(r.status, 400, JSON.stringify(cnpj));
    }
    const other = await router.dispatch({ method: 'PUT', path: '/api/admin/settings', query: A(), body: { companyEmitter: { cnpj: '07.228.550/0001-19' } } });
    assert.equal(other.status, 400);
    assert.equal(repo.getErpOverview().gestaoClickConfig.companyCnpj, '14806925000132');
    const seller = await router.dispatch({ method: 'PUT', path: '/api/admin/settings', query: S(), body: { companyEmitter: { cnpj: '14.806.925/0001-32' } } });
    assert.equal(seller.status, 403);
  });
});

describe('Pacote K: journal de contratos (numero) e de contatos/empresas/negocios (id sem caixa)', () => {
  const later = () => new Date(Date.now() + 60000).toISOString();
  it('contrato novo com numero ja usado recebe o proximo livre; repetido no lote tambem; existente nao assume numero de outro', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const [c1, c2] = repo.listRentalContracts();
    const r = await router.dispatch({
      method: 'POST', path: '/api/state/reconcile', query: S(), body: { journal: { upsertedContracts: [
        { id: 'ctr-jk-1', contractNumber: c1.contractNumber, title: 'A', companyName: 'C', monthlyValue: 1, updatedAt: later() },
        { id: 'ctr-jk-2', contractNumber: c1.contractNumber.toLowerCase(), title: 'B', companyName: 'C', monthlyValue: 1, updatedAt: later() },
        { id: 'ctr-jk-3', contractNumber: 'LOC-K-NOVO', title: 'C', companyName: 'C', monthlyValue: 1, updatedAt: later() },
        { id: 'ctr-jk-4', contractNumber: 'loc-k-novo', title: 'D', companyName: 'C', monthlyValue: 1, updatedAt: later() },
        { id: 'ctr-jk-5', title: 'Sem numero', companyName: 'C', monthlyValue: 1, updatedAt: later() },
        { ...c2, contractNumber: c1.contractNumber, updatedAt: later() },
      ] } },
    });
    assert.equal(r.status, 200);
    const all = repo.listRentalContracts();
    const nums = all.map((c) => String(c.contractNumber || '').trim().toLowerCase());
    assert.equal(new Set(nums).size, nums.length, `sem numero duplicado: ${nums.join(',')}`);
    assert.ok(nums.every(Boolean));
    assert.equal(all.find((c) => c.id === c1.id)?.contractNumber, c1.contractNumber, 'dono original mantem o numero');
    assert.equal(all.find((c) => c.id === c2.id)?.contractNumber, c2.contractNumber, 'existente nao assume numero ocupado');
    assert.equal(all.find((c) => c.id === 'ctr-jk-3')?.contractNumber, 'LOC-K-NOVO');
    assert.match(String(all.find((c) => c.id === 'ctr-jk-1')?.contractNumber), /^LOC-2026-\d+$/);
    // Contrato minimo do journal (sem equipments) nao derruba o bootstrap/overview (antes: 500 para todos).
    assert.ok(Array.isArray(all.find((c) => c.id === 'ctr-jk-5')?.equipments));
    for (const q of [A, S]) {
      const b = await router.dispatch({ method: 'GET', path: '/api/bootstrap', query: q() });
      assert.equal(b.status, 200);
      const o = await router.dispatch({ method: 'GET', path: '/api/erp/overview', query: q() });
      assert.equal(o.status, 200);
    }
  });

  it('contrato do journal com id em outra caixa = o mesmo contrato (sem duplicar)', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const c1 = firstContract(repo);
    const n = repo.listRentalContracts().length;
    await router.dispatch({ method: 'POST', path: '/api/state/reconcile', query: S(), body: { journal: { upsertedContracts: [{ ...c1, id: c1.id.toUpperCase(), contractNotes: 'via journal K', updatedAt: later() }] } } });
    assert.equal(repo.listRentalContracts().length, n);
    assert.equal(repo.listRentalContracts().find((c) => c.id === c1.id)?.contractNotes, 'via journal K');
  });

  it('contato/empresa/negocio com id em outra caixa nao criam registro novo e atualizam o proprio registro; ambiguo e descartado', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const ct = repo.listContacts()[0];
    const co = repo.listCompanies()[0];
    const dl = repo.listDeals()[0];
    const n = { c: repo.listContacts().length, co: repo.listCompanies().length, d: repo.listDeals().length };
    const others = repo.listContacts().slice(1).map((c) => JSON.stringify(c));
    const r = await router.dispatch({
      method: 'POST', path: '/api/state/reconcile', query: S(), body: { journal: {
        upsertedContacts: [{ ...ct, id: ` ${ct.id.toUpperCase()} `, jobTitle: 'Cargo K', updatedAt: later() }, { ...ct, id: ct.id.toUpperCase(), updatedAt: later() }],
        upsertedCompanies: [{ ...co, id: co.id.toUpperCase(), updatedAt: later() }],
        upsertedDeals: [{ ...dl, id: dl.id.toUpperCase(), updatedAt: later() }],
      } },
    });
    assert.equal(r.status, 200);
    assert.equal(repo.listContacts().length, n.c, 'sem contato novo');
    assert.equal(repo.listCompanies().length, n.co, 'sem empresa nova');
    assert.equal(repo.listDeals().length, n.d, 'sem negocio novo');
    assert.equal(repo.listContacts().filter((c) => c.id.trim().toLowerCase() === ct.id.toLowerCase()).length, 1);
    assert.ok(repo.listContacts().some((c) => c.id === ct.id), 'id canonico preservado');
    assert.deepEqual(repo.listContacts().filter((c) => c.id !== ct.id).map((c) => JSON.stringify(c)).sort(), others.sort(), 'nenhum outro contato sobreposto');
    // Novo id (sem colisao) continua criando; repetido em outra caixa no mesmo lote vira um so.
    await router.dispatch({ method: 'POST', path: '/api/state/reconcile', query: S(), body: { journal: { upsertedContacts: [
      { ...ct, id: 'cont-k-novo', email: 'k@example.com', updatedAt: later() }, { ...ct, id: 'CONT-K-NOVO', email: 'k@example.com', updatedAt: later() },
    ] } } });
    assert.equal(repo.listContacts().length, n.c + 1);
    // Ambiguo (dois existentes diferem so na caixa): nunca escolhe um ao acaso.
    const st = repo.getState();
    st.contacts.push({ ...structuredClone(st.contacts[0]), id: 'cont-amb-k' }, { ...structuredClone(st.contacts[0]), id: 'CONT-AMB-K' });
    const snap = JSON.stringify(st.contacts.filter((c) => c.id.toLowerCase() === 'cont-amb-k'));
    await router.dispatch({ method: 'POST', path: '/api/state/reconcile', query: S(), body: { journal: { upsertedContacts: [{ ...ct, id: 'Cont-Amb-K', jobTitle: 'X', updatedAt: later() }] } } });
    assert.equal(JSON.stringify(repo.getState().contacts.filter((c) => c.id.toLowerCase() === 'cont-amb-k')), snap);
  });
});

describe('Pacote K: POST /api/tickets com id existente (documentado: 201 com id novo)', () => {
  it('id existente no corpo => 201 com id gerado pelo servidor; o chamado original continua intacto', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const orig = repo.listServiceTickets()[0];
    const before = JSON.stringify(orig);
    const r = await router.dispatch({ method: 'POST', path: '/api/tickets', query: A(), body: { id: orig.id, subject: 'id existente K' } });
    assert.equal(r.status, 201);
    const id = String(((r.body as Body).data as Record<string, unknown>).id);
    assert.notEqual(id.toLowerCase(), orig.id.toLowerCase());
    assert.equal(JSON.stringify(repo.listServiceTickets().find((t) => t.id === orig.id)), before);
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'api', 'router.ts'), 'utf8');
    assert.ok(src.includes('Pacote K (documentado): POST /api/tickets NUNCA repassa o "id"'));
  });
});

describe('Pacote K: excecao do CNPJ -32 intacta (aguarda confirmacao na Receita)', () => {
  it('14.806.925/0001-32 continua valido; -33 e outra raiz com -32 invalidos; a linha da excecao nao mudou', () => {
    assert.equal(validateCnpj('14.806.925/0001-32').isValid, true);
    assert.equal(validateCnpj('14.806.925/0001-33').isValid, false);
    assert.equal(validateCnpj('11.222.333/0001-32').isValid, false);
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'modules', 'data-health', 'validators.ts'), 'utf8');
    assert.ok(src.includes("digits !== '14806925000132'"));
  });
});
