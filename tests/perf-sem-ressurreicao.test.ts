// ============================================================================
// Perf/integridade 19/11/2026 (lote 1-b): registro apagado nao "ressuscita".
// (a) ensureErp nao reinjeta seed (faturas/pedidos de compra) em base ja inicializada;
// (b) tombstones no proprio estado (crm_state_v1.recordTombstones, sem DDL): o journal antigo
//     do navegador nao recria id apagado no servidor;
// (c) o servidor confirma (reconciliation.journalAck) e o navegador limpa o journal enviado.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryRepository, ClientDurableJournal } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import { pruneAcknowledgedJournal } from '../src/app/lib/durable-storage';

const SEED_INVOICE = 'inv-nfe-rem-0412';

describe('Lote 1-b (a): seed nao volta em base inicializada', () => {
  it('fatura de seed apagada continua apagada nas proximas leituras e no proximo request', () => {
    const repo = createInMemoryRepository();
    assert.ok(repo.listInvoices().some((i) => i.id === SEED_INVOICE), 'pre-condicao: seed presente');
    assert.equal(repo.deleteInvoice(SEED_INVOICE), true);
    assert.ok(!repo.listInvoices().some((i) => i.id === SEED_INVOICE));
    // Proximo request: estado relido do banco (loadState) e ensureErp de novo.
    const next = createInMemoryRepository();
    next.loadState(structuredClone(repo.getState()));
    assert.ok(!next.listInvoices().some((i) => i.id === SEED_INVOICE));
    assert.ok(next.getState().recordTombstones?.['erp.invoices']?.[SEED_INVOICE]);
  });

  it('base inicializada sem pedidos de compra nao recebe os de seed; base vazia ainda recebe', () => {
    const repo = createInMemoryRepository();
    const st = structuredClone(repo.getState());
    st.erp!.purchaseOrders = [];
    const r2 = createInMemoryRepository();
    r2.loadState(st);
    r2.listInvoices(); // passa por ensureErp
    assert.deepEqual(r2.getState().erp!.purchaseOrders, []);

    const empty = structuredClone(repo.getState());
    empty.erp!.invoices = [];
    empty.erp!.rentalContracts = [];
    empty.erp!.purchaseOrders = [];
    empty.erp!.salesOrders = [];
    empty.erp!.serviceOrders = [];
    empty.erp!.proposals = [];
    delete empty.recordTombstones;
    const r3 = createInMemoryRepository();
    r3.loadState(empty);
    r3.listInvoices();
    assert.ok(r3.getState().erp!.invoices.some((i) => i.id === SEED_INVOICE), 'base vazia: seed continua');
    assert.ok((r3.getState().erp!.purchaseOrders || []).length > 0);
  });
});

describe('Lote 1-b (b): tombstones bloqueiam a recriacao pelo journal antigo', () => {
  it('apagar contrato/fatura/empresa e reenviar o journal antigo: nao volta; edicao e criacao nova seguem', () => {
    const repo = createInMemoryRepository();
    const contract = structuredClone(repo.listRentalContracts()[0]);
    const invoice = structuredClone(repo.listInvoices().find((i) => i.id !== SEED_INVOICE)!);
    const company = structuredClone(repo.getState().companies[0]);
    const keep = structuredClone(repo.getState().companies[1]);
    // Journal antigo do navegador (gravado ANTES da exclusao, nunca limpo).
    const oldJournal: ClientDurableJournal = {
      upsertedContracts: [contract],
      upsertedInvoices: [invoice],
      upsertedCompanies: [company, { ...keep, name: keep.name + ' (editado)', updatedAt: new Date(Date.now() + 60000).toISOString() }],
    };
    assert.equal(repo.deleteRentalContract(contract.id), true);
    assert.equal(repo.deleteInvoice(invoice.id), true);
    assert.equal(repo.deleteCompany(company.id), true);

    // Proximo request (estado relido) + journal antigo.
    const next = createInMemoryRepository();
    next.loadState(structuredClone(repo.getState()));
    const offline = { ...structuredClone(contract), id: 'ctr-offline-novo-1', contractNumber: 'OFF-0001' };
    const rec = next.reconcileClientState({ ...oldJournal, upsertedContracts: [contract, offline] });
    assert.equal(rec.tombstoneBlocked, 3);
    assert.ok(!next.listRentalContracts().some((c) => c.id === contract.id), 'contrato apagado nao voltou');
    assert.ok(!next.listInvoices().some((i) => i.id === invoice.id), 'fatura apagada nao voltou');
    assert.ok(!next.getState().companies.some((c) => c.id === company.id), 'empresa apagada nao voltou');
    assert.ok(next.listRentalContracts().some((c) => c.id === 'ctr-offline-novo-1'), 'criacao offline nova segue');
    assert.ok(next.getState().companies.some((c) => c.id === keep.id && c.name.endsWith('(editado)')), 'edicao segue');
  });

  it('exclusao aplicada pelo proprio journal tambem vira tombstone', () => {
    const repo = createInMemoryRepository();
    const contract = structuredClone(repo.listRentalContracts()[0]);
    repo.reconcileClientState({ deletedContractIds: [contract.id] });
    assert.ok(repo.getState().recordTombstones?.['erp.rentalContracts']?.[contract.id]);
    const rec = repo.reconcileClientState({ upsertedContracts: [contract] });
    assert.equal(rec.tombstoneBlocked, 1);
    assert.ok(!repo.listRentalContracts().some((c) => c.id === contract.id));
  });

  it('addRecordTombstones (expurgo direto no estado) e guarda contra colecao zerada', () => {
    const repo = createInMemoryRepository();
    repo.addRecordTombstones('erp.invoices', ['inv-expurgada-1']);
    const rec = repo.reconcileClientState({ upsertedInvoices: [{ ...structuredClone(repo.listInvoices()[0]), id: 'inv-expurgada-1' }] });
    assert.equal(rec.tombstoneBlocked, 1);
    // Colecao grande zerada de uma vez nao gera tombstone em massa.
    const st = repo.getState();
    const before = st.companies.length;
    assert.ok(before > 10);
    st.companies = [];
    (repo as unknown as { save: () => void }).save();
    assert.equal(Object.keys(repo.getState().recordTombstones?.companies || {}).length, 0);
  });
});

describe('Lote 1-b (c): journalAck e limpeza do journal no navegador', () => {
  it('bootstrap com journal devolve reconciliation.journalAck=true e nao ressuscita o apagado', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const contract = structuredClone(repo.listRentalContracts()[0]);
    assert.equal(repo.deleteRentalContract(contract.id), true);
    const res = await router.dispatch({
      method: 'POST',
      path: '/api/bootstrap',
      query: {},
      body: { reconcileJournal: { upsertedContracts: [contract] } },
      context: TRUSTED_INTERNAL_CONTEXT,
    });
    assert.equal(res.status, 200);
    const body = res.body as { reconciliation: { journalAck?: boolean; tombstoneBlocked?: number } };
    assert.equal(body.reconciliation.journalAck, true);
    assert.equal(body.reconciliation.tombstoneBlocked, 1);
    assert.ok(!repo.listRentalContracts().some((c) => c.id === contract.id));
  });

  it('bootstrap sem journal nao devolve journalAck', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    const res = await router.dispatch({ method: 'POST', path: '/api/bootstrap', query: {}, body: {}, context: TRUSTED_INTERNAL_CONTEXT });
    assert.equal((res.body as { reconciliation: { journalAck?: boolean } }).reconciliation.journalAck, undefined);
  });

  it('pruneAcknowledgedJournal remove so o que foi enviado; mantem o que chegou depois e os chamados', () => {
    const a = { id: 'a', updatedAt: '1' };
    const a2 = { id: 'a', updatedAt: '2' };
    const sent: ClientDurableJournal = {
      upsertedContracts: [a as never],
      deletedInvoiceIds: ['x'],
      upsertedTickets: [{ id: 't1' } as never],
    };
    const current: ClientDurableJournal = {
      upsertedContracts: [a as never, a2 as never],
      deletedInvoiceIds: ['x', 'y'],
      upsertedTickets: [{ id: 't1' } as never],
    };
    const out = pruneAcknowledgedJournal(current, sent);
    assert.deepEqual(out.upsertedContracts, [a2]);
    assert.deepEqual(out.deletedInvoiceIds, ['y']);
    assert.equal(out.upsertedTickets.length, 1);
    assert.equal(out.upsertedCompanies.length, 0);
  });

  it('page.tsx limpa o journal so com journalAck do servidor', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/app/page.tsx', 'utf8');
    assert.match(src, /reconciliation\?\.journalAck === true\) acknowledgeDurableJournal\(reconcileJournal\)/);
  });
});
