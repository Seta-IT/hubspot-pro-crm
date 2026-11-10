import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { TRUSTED_INTERNAL_CONTEXT, CrmApiRouter } from '../src/api/router';
import { createInMemoryRepository } from './helpers/legacy-proposal-fixtures';
import {
  RECORD_IN_USE_CODE,
  countRecordUsage,
  formatRecordUsageText,
  recordInUseBody,
  recordUsageTotal,
} from '../src/modules/erp/record-in-use';

describe('t197u/t198u bloqueio de exclusão — texto e contagens', () => {
  it('formata "Usado em 3 contratos e 1 proposta."', () => {
    const text = formatRecordUsageText({
      contracts: 3,
      proposals: 1,
      deals: 0,
      invoices: 0,
      issuedInvoices: 0,
      measurements: 0,
      serviceOrders: 0,
      financialEntries: 0,
      boletos: 0,
    });
    assert.equal(text, 'Usado em 3 contratos e 1 proposta.');
  });

  it('cliente/empresa conta contratos, propostas, negócios, faturas e OS', () => {
    const counts = countRecordUsage(
      'company',
      { id: 'co-1', name: 'Cliente Exemplo LTDA', cnpj: '00.000.000/0001-00' },
      {
        contracts: [{ companyId: 'co-1' }, { companyName: 'cliente exemplo ltda' }],
        proposals: [{ companyCnpj: '00000000000100' }],
        deals: [{ companyId: 'co-1' }, { companyId: 'other' }],
        invoices: [{ companyId: 'co-1' }],
        serviceOrders: [{ companyName: 'Cliente Exemplo LTDA' }],
      }
    );
    assert.equal(counts.contracts, 2);
    assert.equal(counts.proposals, 1);
    assert.equal(counts.deals, 1);
    assert.equal(counts.invoices, 1);
    assert.equal(counts.serviceOrders, 1);
    assert.equal(recordUsageTotal(counts), 6);
  });

  it('contato conta contratos, propostas, negócios e OS via chamado', () => {
    const counts = countRecordUsage(
      'contact',
      { id: 'ct-1' },
      {
        contracts: [{ contactId: 'ct-1' }],
        proposals: [{ contactId: 'ct-1' }, { contactId: 'x' }],
        deals: [{ contactId: 'ct-1' }],
        invoices: [{ companyName: 'Algo' }],
        tickets: [{ contactId: 'ct-1', serviceOrderId: 'os-9' }],
        serviceOrders: [{ id: 'os-9', code: 'OS-9' }],
      }
    );
    assert.equal(counts.contracts, 1);
    assert.equal(counts.proposals, 1);
    assert.equal(counts.deals, 1);
    assert.equal(counts.invoices, 0);
    assert.equal(counts.serviceOrders, 1);
  });

  it('produto casa sku, código e descrição em contrato, proposta e fatura', () => {
    const counts = countRecordUsage(
      'catalogItem',
      { id: 'cat-1', name: 'Rádio Enlace', sku: 'GC-EQ-1', gestaoClickCode: 'GC-EQ-1' },
      {
        contracts: [{ equipments: [{ skuGestaoClick: 'GC-EQ-1' }] }],
        proposals: [{ items: [{ sku: 'gc-eq-1' }] }, { items: [{ description: 'rádio enlace' }] }],
        invoices: [{ itemsDescription: [{ description: 'Radio Enlace' }] }],
      }
    );
    assert.equal(counts.contracts, 1);
    assert.equal(counts.proposals, 2);
    assert.equal(counts.invoices, 1);
  });

  it('contrato conta faturas emitidas e medições; rascunho não entra nas emitidas', () => {
    const counts = countRecordUsage(
      'rentalContract',
      { id: 'ctr-1', contractNumber: 'CT-1' },
      {
        invoices: [
          { rentalContractId: 'ctr-1', status: 'EMITIDA', measurementNumber: 'BM-01' },
          { contractNumber: 'CT-1', status: 'PAGA' },
          { rentalContractId: 'ctr-1', status: 'RASCUNHO', measurementNumber: 'BM-02' },
        ],
      }
    );
    assert.equal(counts.issuedInvoices, 2);
    assert.equal(counts.measurements, 2);
  });

  it('proposta conta contrato gerado e fatura vinculada', () => {
    const counts = countRecordUsage(
      'proposal',
      { id: 'pr-1', code: 'P-100', convertedContractId: 'ctr-9', convertedInvoiceId: 'inv-9' },
      {
        contracts: [{ id: 'ctr-9' }, { proposalId: 'pr-1' }],
        invoices: [{ id: 'inv-9' }, { proposalNumber: 'P-100' }],
      }
    );
    assert.equal(counts.contracts, 2);
    assert.equal(counts.invoices, 2);
  });

  it('pipeline e etapa contam negócios', () => {
    const pipe = countRecordUsage('pipeline', { id: 'pipe-1' }, {
      deals: [{ pipelineId: 'pipe-1' }, { pipelineId: 'pipe-2' }],
    });
    const stage = countRecordUsage('pipelineStage', { id: 'st-1', pipelineId: 'pipe-1' }, {
      deals: [
        { pipelineId: 'pipe-1', stageId: 'st-1' },
        { pipelineId: 'pipe-2', stageId: 'st-1' },
      ],
    });
    assert.equal(pipe.deals, 1);
    assert.equal(stage.deals, 1);
  });

  it('conta bancária casa lançamento, fatura e boleto pelo nome', () => {
    const counts = countRecordUsage(
      'bankAccount',
      { id: 'bk-1', name: 'Banco Inter' },
      {
        financialEntries: [
          { id: 'f1', paymentMethod: 'Boleto Banco Inter', description: ' mensalidade' },
          { id: 'f2', paymentMethod: 'PIX Itaú' },
        ],
        invoices: [
          { id: 'i1', paymentMethodLabel: 'Boleto Banco Inter', boletoDigitableLine: '34191.79001 01043.510047 91020.150008 8 98650001200000' },
        ],
        bankAccounts: [{ id: 'bk-1', name: 'Banco Inter' }],
      }
    );
    assert.equal(counts.financialEntries, 1);
    assert.equal(counts.invoices, 1);
    assert.ok(counts.boletos >= 1);
  });

  it('lançamento financeiro só bloqueia se houver fatura ou boleto vinculado', () => {
    const used = countRecordUsage(
      'financialEntry',
      { id: 'fin-1' },
      {
        financialEntries: [{ id: 'fin-1', invoiceId: 'inv-1' }],
        invoices: [{ id: 'inv-1', boletoDigitableLine: '34191.79001 01043.510047 91020.150008 8 98650001200000' }],
      }
    );
    const free = countRecordUsage(
      'financialEntry',
      { id: 'fin-2' },
      {
        financialEntries: [{ id: 'fin-2', invoiceId: null, description: 'ajuste manual' }],
        invoices: [{ id: 'inv-1' }],
      }
    );
    assert.equal(used.invoices, 1);
    assert.equal(used.boletos, 1);
    assert.equal(recordUsageTotal(free), 0);
  });

  it('corpo 409 RECORD_IN_USE e o modal não oferece Inativar', () => {
    const body = recordInUseBody(
      countRecordUsage('company', { id: 'co-1' }, { contracts: [{ companyId: 'co-1' }] })
    );
    assert.equal(body.code, RECORD_IN_USE_CODE);
    assert.equal(body.error, 'Não é possível excluir.');
    assert.match(body.usageText, /Usado em 1 contrato/);
    const src = readFileSync(path.join(process.cwd(), 'src/app/components/CannotDeleteModal.tsx'), 'utf8');
    assert.match(src, /Não é possível excluir/);
    assert.match(src, />\s*Fechar\s*</);
    assert.equal(/Inativar/.test(src), false);
  });
});

describe('t197u DELETE 409 RECORD_IN_USE nas rotas', () => {
  it('não exclui empresa vinculada a contrato e libera empresa sem vínculo', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const used = repo.createCompany({ name: 'Cliente Com Contrato LTDA', cnpj: '11.111.111/0001-11' });
    const free = repo.createCompany({ name: 'Cliente Livre LTDA', cnpj: '22.222.222/0001-22' });
    repo.createRentalContract({
      companyId: used.id,
      companyName: used.name,
      companyCnpj: used.cnpj,
      title: 'Contrato teste',
    } as Parameters<typeof repo.createRentalContract>[0]);

    const blocked = await router.dispatch({
      context: TRUSTED_INTERNAL_CONTEXT,
      method: 'DELETE',
      path: `/api/companies/${used.id}`,
      body: {},
      query: {},
    });
    assert.equal(blocked.status, 409);
    const body = blocked.body as { code: string; usageText: string };
    assert.equal(body.code, RECORD_IN_USE_CODE);
    assert.match(body.usageText, /contrato/);

    const allowed = await router.dispatch({
      context: TRUSTED_INTERNAL_CONTEXT,
      method: 'DELETE',
      path: `/api/companies/${free.id}`,
      body: {},
      query: {},
    });
    assert.equal(allowed.status, 200);
  });

  it('não exclui pipeline com negócio e permite etapa sem negócio', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const pipe = repo.createPipeline({
      name: 'Pipeline teste vínculo',
      stages: [
        { id: 'st-nova', pipelineId: 'tmp', name: 'Nova', order: 1, defaultProbability: 10, dealRottingDays: 14, isClosed: false, isWon: false },
        { id: 'st-vazia', pipelineId: 'tmp', name: 'Vazia', order: 2, defaultProbability: 20, dealRottingDays: 14, isClosed: false, isWon: false },
      ],
    });
    const usedStage = pipe.stages[0];
    const freeStage = pipe.stages[1];
    repo.createDeal({
      title: 'Negócio no funil',
      value: 100,
      pipelineId: pipe.id,
      stageId: usedStage.id,
    } as Parameters<typeof repo.createDeal>[0]);

    const blockedPipe = await router.dispatch({
      context: TRUSTED_INTERNAL_CONTEXT,
      method: 'DELETE',
      path: `/api/pipelines/${pipe.id}`,
      body: {},
      query: {},
    });
    assert.equal(blockedPipe.status, 409);

    const blockedStage = await router.dispatch({
      context: TRUSTED_INTERNAL_CONTEXT,
      method: 'DELETE',
      path: `/api/pipelines/${pipe.id}/stages/${usedStage.id}`,
      body: {},
      query: {},
    });
    assert.equal(blockedStage.status, 409);

    const allowedStage = await router.dispatch({
      context: TRUSTED_INTERNAL_CONTEXT,
      method: 'DELETE',
      path: `/api/pipelines/${pipe.id}/stages/${freeStage.id}`,
      body: {},
      query: {},
    });
    assert.equal(allowedStage.status, 200);
  });
});
