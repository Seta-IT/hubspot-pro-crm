// ============================================================================
// STI-hub — Pacote L (01/11/2026, hotfix CISO): aceite publico (/approve) so de proposta existente
// (body.proposal e dados comerciais do corpo ignorados; 404 identico ao GET; sem aceite repetido;
// rate-limit), equipments nao-objeto (400 na entrada e leitura tolerante do legado), journal sem
// alterar/excluir fatura existente sem a alcada fiscal, PATCH de fatura com alcada fiscal, /pay
// com alcada financeira, item sem ncmOrServiceCode no aceite e POST de contrato por allowlist.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository, CrmRepository } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import type { ErpRentalContract } from '../src/db/types';

let ipn = 1;
const ip = () => `198.51.100.${(ipn++ % 250) + 1}`;
const tokFor = (repo: CrmRepository, uid: string, extra: Record<string, unknown> = {}) => {
  const r = repo.findRbacUserRecord(uid, '')!;
  return signStiHubSessionToken({
    uid: r.id, email: r.email, name: r.name, roleId: r.roleId, scope: r.scope,
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000, ...extra,
  } as Parameters<typeof signStiHubSessionToken>[0]);
};
const ADMIN = 'usr-seta-01', GER = 'usr-seta-02', VEND = 'usr-seta-03', FIN = 'usr-seta-04', FISCAL = 'usr-seta-06';
const mk = () => {
  const repo = createInMemoryRepository();
  const router = new CrmApiRouter(repo);
  const q = (uid: string, extra?: Record<string, unknown>) => ({ _fromHttpBridge: '1', _clientIp: ip(), _sessionToken: tokFor(repo, uid, extra) });
  const anon = () => ({ _fromHttpBridge: '1', _clientIp: ip() });
  const audits = (a: string) => repo.listSecurityAuditLogs(10000).logs.filter((l) => l.action === a).length;
  return { repo, router, q, anon, audits };
};
type E = ReturnType<typeof mk>;
type Body = { code?: string; error?: string; data?: Record<string, any> };
const b = (r: { body: unknown }) => r.body as Body;
const sig = { signerName: 'Fulano de Tal', signerCpf: '529.982.247-25', signerRole: 'Diretor', modality: 'GOV_BR_OURO', acceptedTerms: true, signerEmail: 'fulano@exemplo.invalid' };
const forged = (id: string) => ({ ...sig, proposal: { id, code: 'PROP-FORJ', title: 'Forjada', companyName: 'Empresa Forjada', status: 'ENVIADA', items: [{ id: 'x', description: 'x', quantity: 1, unitPrice: 50000, isRecurring: true, ncmOrServiceCode: 'NCM 8517.62.14' }] } });
const mkProp = async (E: E, extra: Record<string, unknown> = {}) =>
  b(await E.router.dispatch({
    context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: '/api/erp/proposals',
    body: { title: 'L aprov', companyName: 'L SA', status: 'ENVIADA', contactName: 'Fulano', items: [{ id: 'i1', description: 'Item', quantity: 2, unitPrice: 100, isRecurring: true, ncmOrServiceCode: 'NCM 8517.62.14' }], ...extra },
  })).data!;
const counts = (E: E) => ({ inv: E.repo.listInvoices().length, ctr: E.repo.listRentalContracts().length, props: E.repo.listProposals().length });

describe('Pacote L (1): /approve publico so aceita proposta existente', () => {
  it('probe exato do parecer K: POST anonimo em id inexistente com body.proposal forjada => 404 identico ao GET, 0 contrato, 0 fatura, 0 proposta', async () => {
    const E = mk();
    const c0 = counts(E);
    const r = await E.router.dispatch({ method: 'POST', path: '/api/erp/proposals/prop-forjada-k/approve', query: E.anon(), body: forged('prop-forjada-k') });
    const g = await E.router.dispatch({ method: 'GET', path: '/api/erp/proposals/prop-forjada-k', query: E.anon() });
    assert.equal(r.status, 404, JSON.stringify(r.body));
    assert.equal(g.status, 404);
    assert.deepEqual(r.body, g.body, '404 identico ao do GET');
    assert.deepEqual(counts(E), c0, 'nada criado');
    assert.equal(E.repo.listInvoices().some((i) => /Forjada/.test(String(i.companyName))), false);
    assert.equal(E.repo.listRentalContracts().some((c) => /Forjada/.test(String(c.companyName))), false);
  });

  it('mesmo ataque autenticado (vendedor, gerente, admin) e com o payload no topo do corpo => 404 e nada criado', async () => {
    const E = mk();
    const c0 = counts(E);
    for (const who of [VEND, GER, ADMIN]) {
      const r = await E.router.dispatch({ method: 'POST', path: `/api/erp/proposals/prop-forj-${who}/approve`, query: E.q(who), body: forged(`prop-forj-${who}`) });
      assert.equal(r.status, 404, `${who}: ${JSON.stringify(r.body)}`);
    }
    const flat = { ...sig, id: 'prop-flat', title: 'Forjada flat', companyName: 'Empresa Forjada', items: [{ id: 'x', description: 'x', quantity: 1, unitPrice: 50000 }] };
    const r2 = await E.router.dispatch({ method: 'POST', path: '/api/erp/proposals/prop-flat/approve', query: E.anon(), body: flat });
    assert.equal(r2.status, 404);
    assert.deepEqual(counts(E), c0);
  });

  it('repositorio: approveProposalAndConvertToContract nunca cria proposta a partir do input', () => {
    const E = mk();
    const c0 = counts(E);
    const res = E.repo.approveProposalAndConvertToContract('prop-repo-forj', { ...sig, proposal: forged('prop-repo-forj').proposal, title: 'X', companyName: 'Y' } as any);
    assert.equal(res, null);
    assert.deepEqual(counts(E), c0);
  });

  it('aceite legitimo (link antigo, sem token) de proposta existente continua: 200, contrato + 1a fatura com dados do SERVIDOR; body.proposal e valores do corpo ignorados', async () => {
    const E = mk();
    const p = await mkProp(E);
    const c0 = counts(E);
    const r = await E.router.dispatch({
      method: 'POST', path: `/api/erp/proposals/${p.id}/approve`, query: E.anon(),
      body: { ...sig, proposal: { ...p, companyName: 'Empresa Forjada', monthlyRecurringTotal: 99999, items: [{ id: 'z', description: 'z', quantity: 1, unitPrice: 50000 }] }, monthlyRecurringTotal: 99999, companyName: 'Empresa Forjada', items: [{ unitPrice: 50000 }] },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const d = b(r).data!;
    assert.equal(d.contract.companyName, 'L SA');
    assert.equal(d.contract.monthlyValue, p.monthlyRecurringTotal);
    assert.equal(d.contract.equipments.length, 1);
    assert.equal(d.contract.equipments[0].unitMonthlyRent, 100);
    assert.notEqual(d.invoice.companyName, 'Empresa Forjada');
    assert.equal(d.proposal.status, 'CONVERTIDA_CONTRATO');
    assert.equal(d.digitalSignature.signerName, 'Fulano de Tal');
    const after = counts(E);
    assert.equal(after.ctr, c0.ctr + 1);
    assert.equal(after.inv, c0.inv + 1, '1a fatura gerada no aceite (comportamento atual mantido)');
    assert.equal(after.props, c0.props);
    const stored = E.repo.listProposals().find((x) => x.id === p.id)!;
    assert.equal(stored.companyName, 'L SA', 'proposta do servidor nao foi sobrescrita');
    // aceite pelo codigo da proposta (link antigo por codigo) tambem resolve a existente
    const p2 = await mkProp(E);
    const r3 = await E.router.dispatch({ method: 'POST', path: `/api/erp/proposals/${encodeURIComponent(String(p2.code).toLowerCase())}/approve`, query: E.anon(), body: sig });
    assert.equal(r3.status, 200, JSON.stringify(r3.body));
  });

  it('sem aceite repetido: 2o aceite => 409 e nenhum contrato/fatura a mais; status nao aceitavel => 409', async () => {
    const E = mk();
    const p = await mkProp(E);
    const r1 = await E.router.dispatch({ method: 'POST', path: `/api/erp/proposals/${p.id}/approve`, query: E.anon(), body: sig });
    assert.equal(r1.status, 200);
    const c1 = counts(E);
    const r2 = await E.router.dispatch({ method: 'POST', path: `/api/erp/proposals/${p.id}/approve`, query: E.anon(), body: sig });
    assert.equal(r2.status, 409);
    assert.equal(b(r2).code, 'PROPOSAL_ALREADY_APPROVED');
    assert.deepEqual(counts(E), c1);
    // assinatura ja registrada sem convertedContractId (legado) tambem conta como aceite
    const p3 = await mkProp(E);
    const st = E.repo.listProposals().find((x) => x.id === p3.id)!;
    (st as any).digitalSignature = { signedAt: new Date().toISOString() };
    const r4 = await E.router.dispatch({ method: 'POST', path: `/api/erp/proposals/${p3.id}/approve`, query: E.anon(), body: sig });
    assert.equal(r4.status, 409);
    for (const status of ['RECUSADA', 'CANCELADA', 'EXPIRADA']) {
      const px = await mkProp(E, { status });
      const stx = E.repo.listProposals().find((x) => x.id === px.id)!;
      (stx as any).status = status;
      const rx = await E.router.dispatch({ method: 'POST', path: `/api/erp/proposals/${px.id}/approve`, query: E.anon(), body: sig });
      assert.equal(rx.status, 409, `${status}: ${JSON.stringify(rx.body)}`);
    }
  });

  it('do corpo so entram os campos do aceite: statusObservation anonima e descartada; validacao continua (400)', async () => {
    const E = mk();
    const p = await mkProp(E);
    const bad = await E.router.dispatch({ method: 'POST', path: `/api/erp/proposals/${p.id}/approve`, query: E.anon(), body: { ...sig, acceptedTerms: 'true' } });
    assert.equal(bad.status, 400);
    const r = await E.router.dispatch({ method: 'POST', path: `/api/erp/proposals/${p.id}/approve`, query: E.anon(), body: { ...sig, statusObservation: 'texto injetado pelo anonimo' } });
    assert.equal(r.status, 200);
    const hist = E.repo.listProposals().find((x) => x.id === p.id)!.statusHistory || [];
    assert.equal(hist.some((h) => /injetado/.test(String(h.notes))), false);
  });

  it('rate-limit por IP no aceite publico (429), sem afetar o contexto interno', async () => {
    const E = mk();
    const fixed = { _fromHttpBridge: '1', _clientIp: '203.0.113.77' };
    let last = 0;
    for (let i = 0; i < 31; i++) {
      last = (await E.router.dispatch({ method: 'POST', path: `/api/erp/proposals/prop-nao-existe-${i}/approve`, query: fixed, body: sig })).status;
    }
    assert.equal(last, 429);
    const p = await mkProp(E);
    const t = await E.router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: `/api/erp/proposals/${p.id}/approve`, body: sig });
    assert.equal(t.status, 200);
  });
});

describe('Pacote L (4): item da proposta sem ncmOrServiceCode nao derruba o aceite', () => {
  it('aceite => 200 com NCM padrao', async () => {
    const E = mk();
    const p = await mkProp(E, { items: [{ id: 'i1', description: 'Sem NCM', quantity: 1, unitPrice: 10, isRecurring: true }] });
    const st = E.repo.listProposals().find((x) => x.id === p.id)!;
    for (const it of st.items) delete (it as any).ncmOrServiceCode;
    const r = await E.router.dispatch({ method: 'POST', path: `/api/erp/proposals/${p.id}/approve`, query: E.anon(), body: sig });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(b(r).data!.contract.equipments[0].ncm, '8517.62.14');
  });
});

describe('Pacote L (2): equipments com item nao-objeto', () => {
  const badLists: unknown[] = [[null], [1], ['x'], [[{}]], 'abc', { a: 1 }, null];
  it('PATCH/PUT/POST de contrato => 400 CONTRACT_FIELD_INVALID e nada gravado; bootstrap e overview seguem 200', async () => {
    for (const eq of badLists) {
      const E = mk();
      const ct = E.repo.listRentalContracts()[0];
      const before = JSON.stringify(ct);
      const c0 = counts(E);
      for (const [m, p, who] of [['PATCH', `/api/erp/rental-contracts/${ct.id}`, VEND], ['PUT', `/api/erp/contracts/${ct.id}`, ADMIN], ['PATCH', `/api/erp/rental-contracts/ctr-l-upsert`, ADMIN]] as const) {
        const r = await E.router.dispatch({ method: m, path: p, query: E.q(who), body: { title: 't', companyName: 'c', equipments: eq } });
        assert.equal(r.status, 400, `${m} ${p} ${JSON.stringify(eq)} => ${r.status}`);
        assert.equal(b(r).code, 'CONTRACT_FIELD_INVALID');
      }
      for (const p of ['/api/erp/rental-contracts', '/api/erp/contracts']) {
        const r = await E.router.dispatch({ method: 'POST', path: p, query: E.q(VEND), body: { title: 't', companyName: 'c', equipments: eq } });
        assert.equal(r.status, 400, `POST ${p} ${JSON.stringify(eq)}`);
      }
      assert.equal(JSON.stringify(E.repo.listRentalContracts().find((c) => c.id === ct.id)), before);
      assert.equal(counts(E).ctr, c0.ctr);
      for (const [u, p] of [[ADMIN, '/api/bootstrap'], [VEND, '/api/bootstrap'], [ADMIN, '/api/erp/overview']] as const) {
        assert.equal((await E.router.dispatch({ method: 'GET', path: p, query: E.q(u) })).status, 200);
      }
    }
  });

  it('lista valida de objetos continua aceita (PATCH 200)', async () => {
    const E = mk();
    const ct = E.repo.listRentalContracts()[0];
    const r = await E.router.dispatch({ method: 'PATCH', path: `/api/erp/rental-contracts/${ct.id}`, query: E.q(ADMIN), body: { equipments: ct.equipments } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  it('journal (probe K): vendedor com equipments [null] nao derruba bootstrap/overview; item invalido descartado', async () => {
    const E = mk();
    const later = new Date(Date.now() + 60000).toISOString();
    const r = await E.router.dispatch({ method: 'POST', path: '/api/state/reconcile', query: E.q(VEND), body: { journal: { upsertedContracts: [{ id: 'ctr-l-dos', title: 'dos', companyName: 'x', status: 'ATIVO', equipments: [null, { quantity: 2, description: 'ok' }, 3], updatedAt: later }] } } });
    assert.ok(r.status < 500);
    for (const [u, p] of [[ADMIN, '/api/bootstrap'], [VEND, '/api/bootstrap'], [ADMIN, '/api/erp/overview']] as const) {
      assert.equal((await E.router.dispatch({ method: 'GET', path: p, query: E.q(u) })).status, 200, `${u} ${p}`);
    }
    const c = E.repo.listRentalContracts().find((x) => x.id === 'ctr-l-dos');
    if (c) assert.ok(c.equipments.every((eq) => eq && typeof eq === 'object'));
  });

  it('dado legado ja gravado com [null] / nao-array: leitura tolerante (bootstrap/overview 200, objetos validos preservados)', async () => {
    const E = mk();
    const list = E.repo.getErpState().rentalContracts;
    const keep = list[0].equipments[0];
    (list[0] as any).equipments = [null, keep, 'x', [1]];
    (list[1] as any).equipments = 'abc';
    for (const [u, p] of [[ADMIN, '/api/bootstrap'], [VEND, '/api/bootstrap'], [ADMIN, '/api/erp/overview']] as const) {
      assert.equal((await E.router.dispatch({ method: 'GET', path: p, query: E.q(u) })).status, 200, `${u} ${p}`);
    }
    const c0 = E.repo.listRentalContracts().find((c) => c.id === list[0].id)!;
    assert.deepEqual(c0.equipments, keep ? [keep] : []);
    assert.deepEqual(E.repo.listRentalContracts().find((c) => c.id === list[1].id)!.equipments, []);
  });
});

describe('Pacote L (3): fatura/NF existente so com alcada', () => {
  const later = (n: number) => new Date(Date.now() + n * 60000).toISOString();
  it('probe K: vendedor altera NF existente pelo journal (valor, numero, status) => ignorado e auditado; inclusive id em outra caixa', async () => {
    const E = mk();
    const inv0 = E.repo.listInvoices()[0];
    const before = JSON.stringify(inv0);
    const a0 = E.audits('ERP_FISCAL_ISSUANCE_DENIED');
    for (const id of [inv0.id, inv0.id.toUpperCase(), ` ${inv0.id} `]) {
      await E.router.dispatch({ method: 'POST', path: '/api/state/reconcile', query: E.q(VEND), body: { journal: { upsertedInvoices: [{ ...inv0, id, grossAmount: 1, netAmount: 1, documentNumber: 'NF-FORJADA', status: 'PAGA', updatedAt: later(2) }] } } });
    }
    await E.router.dispatch({ method: 'POST', path: '/api/bootstrap', query: E.q(VEND), body: { reconcileJournal: { upsertedInvoices: [{ ...inv0, grossAmount: 2, updatedAt: later(3) }] } } });
    const now = E.repo.listInvoices().find((i) => i.id === inv0.id)!;
    assert.equal(JSON.stringify(now), before, 'NF intacta');
    assert.equal(E.repo.listInvoices().some((i) => i.documentNumber === 'NF-FORJADA'), false);
    assert.ok(E.audits('ERP_FISCAL_ISSUANCE_DENIED') - a0 >= 4, 'tentativas auditadas');
  });

  it('vendedor exclui NF pelo journal => ignorado e auditado; eco identico nao gera auditoria', async () => {
    const E = mk();
    const inv0 = E.repo.listInvoices()[0];
    const n0 = E.repo.listInvoices().length;
    const a0 = E.audits('ERP_FISCAL_ISSUANCE_DENIED');
    await E.router.dispatch({ method: 'POST', path: '/api/state/reconcile', query: E.q(VEND), body: { journal: { deletedInvoiceIds: [inv0.id, inv0.documentNumber] } } });
    assert.equal(E.repo.listInvoices().length, n0);
    assert.ok(E.audits('ERP_FISCAL_ISSUANCE_DENIED') > a0);
    const a1 = E.audits('ERP_FISCAL_ISSUANCE_DENIED');
    await E.router.dispatch({ method: 'POST', path: '/api/state/reconcile', query: E.q(VEND), body: { journal: { upsertedInvoices: [structuredClone(inv0)] } } });
    assert.equal(E.audits('ERP_FISCAL_ISSUANCE_DENIED'), a1, 'eco do proprio navegador nao e tentativa');
  });

  it('com a alcada fiscal (admin, financeiro) o journal ainda altera a NF', async () => {
    for (const who of [ADMIN, FIN]) {
      const E = mk();
      const inv0 = E.repo.listInvoices()[0];
      await E.router.dispatch({ method: 'POST', path: '/api/state/reconcile', query: E.q(who), body: { journal: { upsertedInvoices: [{ ...inv0, observations: 'ajuste L', updatedAt: later(2) }] } } });
      assert.equal((E.repo.listInvoices().find((i) => i.id === inv0.id) as any).observations, 'ajuste L', who);
    }
  });

  it('PATCH/PUT /api/erp/invoices/:id e /fiscal-documents/:id: vendedor e gerente => 403 auditado; fiscal/financeiro/admin => 200', async () => {
    const E = mk();
    const inv0 = E.repo.listInvoices()[0];
    const before = JSON.stringify(inv0);
    for (const who of [VEND, GER]) {
      for (const [m, p] of [['PATCH', `/api/erp/invoices/${inv0.id}`], ['PUT', `/api/erp/fiscal-documents/${inv0.id}`]] as const) {
        const a0 = E.audits('ERP_FISCAL_ISSUANCE_DENIED');
        const r = await E.router.dispatch({ method: m, path: p, query: E.q(who), body: { grossAmount: 1, documentNumber: 'NF-FORJADA' } });
        assert.equal(r.status, 403, `${who} ${m} ${p}`);
        assert.equal(b(r).code, 'ERP_FISCAL_ISSUANCE_FORBIDDEN');
        assert.equal(E.audits('ERP_FISCAL_ISSUANCE_DENIED'), a0 + 1);
      }
    }
    assert.equal(JSON.stringify(E.repo.listInvoices().find((i) => i.id === inv0.id)), before);
    for (const who of [FISCAL, FIN, ADMIN]) {
      const r = await E.router.dispatch({ method: 'PATCH', path: `/api/erp/invoices/${inv0.id}`, query: E.q(who), body: { observations: `ok ${who}` } });
      assert.equal(r.status, 200, `${who}: ${JSON.stringify(r.body)}`);
    }
    const noMfa = await E.router.dispatch({ method: 'PATCH', path: `/api/erp/invoices/${inv0.id}`, query: E.q(FIN, { mfaVerified: false }), body: { observations: 'x' } });
    assert.ok(noMfa.status === 401 || noMfa.status === 403);
  });

  it('/api/erp/invoices/:id/pay: so financeiro (Financeiro/Bancos EDIT/FULL) ou admin; vendedor, gerente e fiscal => 403 auditado', async () => {
    const E = mk();
    const open = E.repo.listInvoices().find((i) => i.status !== 'PAGA') || E.repo.listInvoices()[0];
    for (const who of [VEND, GER, FISCAL]) {
      const a0 = E.audits('ERP_FINANCE_PAYMENT_DENIED');
      const r = await E.router.dispatch({ method: 'POST', path: `/api/erp/invoices/${open.id}/pay`, query: E.q(who), body: {} });
      assert.equal(r.status, 403, `${who}: ${r.status}`);
      assert.equal(b(r).code, 'ERP_FINANCE_PAYMENT_FORBIDDEN');
      assert.equal(E.audits('ERP_FINANCE_PAYMENT_DENIED'), a0 + 1);
    }
    assert.equal(E.repo.listInvoices().find((i) => i.id === open.id)!.status, open.status, 'status intacto');
    const ok = await E.router.dispatch({ method: 'POST', path: `/api/erp/invoices/${open.id}/pay`, query: E.q(FIN), body: {} });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const ok2 = await E.router.dispatch({ method: 'POST', path: `/api/erp/invoices/${open.id}/pay`, query: E.q(ADMIN), body: {} });
    assert.equal(ok2.status, 200);
    const anon = await E.router.dispatch({ method: 'POST', path: `/api/erp/invoices/${open.id}/pay`, query: E.anon(), body: {} });
    assert.equal(anon.status, 401);
  });
});

describe('Pacote L (5): POST de contrato descarta chaves desconhecidas (allowlist do PATCH)', () => {
  it('variantes de caixa, ZWSP, snake_case, invoices e trilhas do servidor nao sao gravadas', async () => {
    const E = mk();
    const r = await E.router.dispatch({
      method: 'POST', path: '/api/erp/rental-contracts', query: E.q(ADMIN),
      body: {
        title: 'L allow', companyName: 'L SA', monthlyValue: 10,
        GenerateNextInvoiceOnSave: true, ['generateNextInvoiceOnSave\u200b']: true, generate_next_invoice_on_save: true,
        invoices: [{ id: 'inv-x', grossAmount: 1 }], SavedBy: 'x', versionHistory: [{ v: 99 }], createdAt: '2000-01-01T00:00:00.000Z', __proto__x: 1,
      },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const c = E.repo.listRentalContracts().find((x) => x.id === b(r).data!.id) as ErpRentalContract & Record<string, unknown>;
    for (const k of ['GenerateNextInvoiceOnSave', 'generateNextInvoiceOnSave\u200b', 'generate_next_invoice_on_save', 'invoices', 'SavedBy', '__proto__x']) {
      assert.equal(k in c, false, `chave ${JSON.stringify(k)} nao deve ser gravada`);
    }
    assert.notEqual(c.createdAt, '2000-01-01T00:00:00.000Z');
    assert.equal(c.title, 'L allow');
    assert.equal(c.monthlyValue, 10);
  });

  it('id do cliente continua aceito (sem colisao) e colisao segue 409', async () => {
    const E = mk();
    const r = await E.router.dispatch({ method: 'POST', path: '/api/erp/rental-contracts', query: E.q(ADMIN), body: { id: 'ctr-l-cliente', title: 't', companyName: 'c', monthlyValue: 1 } });
    assert.equal(r.status, 201);
    assert.equal(b(r).data!.id, 'ctr-l-cliente');
    const r2 = await E.router.dispatch({ method: 'POST', path: '/api/erp/rental-contracts', query: E.q(ADMIN), body: { id: 'ctr-l-cliente', title: 't', companyName: 'c', monthlyValue: 1 } });
    assert.equal(r2.status, 409);
  });
});
