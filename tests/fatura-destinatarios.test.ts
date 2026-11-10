// ============================================================================
// Destinatários da fatura no contrato: persistência, normalização e disparo em lote
// (sem envio real de e-mail).
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import {
  billingRecipientEmailsText,
  parseBillingRecipientEmails,
} from '../src/modules/erp/billing-recipient-emails';
import type { ErpRentalContract } from '../src/db/types';

const ctx = { context: TRUSTED_INTERNAL_CONTEXT as typeof TRUSTED_INTERNAL_CONTEXT };

function src(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

async function createContract(
  router: CrmApiRouter,
  body: Record<string, unknown>
): Promise<ErpRentalContract> {
  const res = await router.dispatch({
    ...ctx,
    method: 'POST',
    path: '/api/erp/rental-contracts',
    body: {
      title: 'Contrato destinatários',
      companyName: 'Cliente Teste',
      monthlyValue: 150,
      paymentMethod: 'Boleto Inter',
      emailAutomationMode: 'Enviar lembrete de pagamento e boleto',
      nextBillingDate: '2026-12-10',
      ...body,
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return (res.body as { data: ErpRentalContract }).data;
}

describe('parseBillingRecipientEmails', () => {
  it('aceita vírgula, ponto e vírgula e quebra de linha, valida e remove duplicatas', () => {
    assert.deepEqual(
      parseBillingRecipientEmails('financeiro@example.com, contas.pagar@example.com'),
      ['financeiro@example.com', 'contas.pagar@example.com']
    );
    assert.deepEqual(
      parseBillingRecipientEmails('financeiro@example.com; contas.pagar@example.com'),
      ['financeiro@example.com', 'contas.pagar@example.com']
    );
    assert.deepEqual(
      parseBillingRecipientEmails('financeiro@example.com\ncontas.pagar@example.com'),
      ['financeiro@example.com', 'contas.pagar@example.com']
    );
    assert.deepEqual(
      parseBillingRecipientEmails(['Financeiro@example.com', 'financeiro@example.com', 'nao-email', 'contas.pagar@example.com']),
      ['financeiro@example.com', 'contas.pagar@example.com']
    );
    assert.deepEqual(parseBillingRecipientEmails(''), []);
    assert.deepEqual(parseBillingRecipientEmails(undefined), []);
    assert.equal(billingRecipientEmailsText(['a@example.com', 'b@example.com']), 'a@example.com, b@example.com');
    assert.equal(billingRecipientEmailsText('legado@example.com'), 'legado@example.com');
  });
});

describe('Contrato: destinatários da fatura persistem na criação, atualização e leitura', () => {
  it('cria e atualiza contrato com 2 destinatários e os devolve na leitura', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);

    const created = await createContract(router, {
      billingRecipientEmails: ['financeiro@example.com', 'contas.pagar@example.com'],
    });
    assert.deepEqual(created.billingRecipientEmails, ['financeiro@example.com', 'contas.pagar@example.com']);

    const listed = repo.listRentalContracts().find((c) => c.id === created.id);
    assert.deepEqual(listed?.billingRecipientEmails, ['financeiro@example.com', 'contas.pagar@example.com']);

    const getRes = await router.dispatch({
      ...ctx,
      method: 'GET',
      path: '/api/erp/rental-contracts',
    });
    assert.equal(getRes.status, 200);
    const fromList = ((getRes.body as { data: ErpRentalContract[] }).data).find((c) => c.id === created.id);
    assert.deepEqual(fromList?.billingRecipientEmails, ['financeiro@example.com', 'contas.pagar@example.com']);

    const patched = await router.dispatch({
      ...ctx,
      method: 'PATCH',
      path: `/api/erp/rental-contracts/${created.id}`,
      body: {
        billingRecipientEmails: ['novo@example.com', 'financeiro@example.com', 'novo@example.com', 'invalido'],
      },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
    const after = (patched.body as { data: ErpRentalContract }).data;
    assert.deepEqual(after.billingRecipientEmails, ['novo@example.com', 'financeiro@example.com']);
    assert.deepEqual(
      repo.listRentalContracts().find((c) => c.id === created.id)?.billingRecipientEmails,
      ['novo@example.com', 'financeiro@example.com']
    );
  });

  it('normaliza texto com vírgula, ponto e vírgula e quebra de linha; limpar o campo grava lista vazia', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const created = await createContract(router, { billingRecipientEmails: [] });

    const byComma = await router.dispatch({
      ...ctx,
      method: 'PATCH',
      path: `/api/erp/rental-contracts/${created.id}`,
      body: { billingRecipientEmails: 'alpha@example.com, beta@example.com' },
    });
    assert.deepEqual((byComma.body as { data: ErpRentalContract }).data.billingRecipientEmails, [
      'alpha@example.com',
      'beta@example.com',
    ]);

    const bySemi = await router.dispatch({
      ...ctx,
      method: 'PATCH',
      path: `/api/erp/rental-contracts/${created.id}`,
      body: { billingRecipientEmails: 'alpha@example.com; beta@example.com' },
    });
    assert.deepEqual((bySemi.body as { data: ErpRentalContract }).data.billingRecipientEmails, [
      'alpha@example.com',
      'beta@example.com',
    ]);

    const byLine = await router.dispatch({
      ...ctx,
      method: 'PATCH',
      path: `/api/erp/rental-contracts/${created.id}`,
      body: { billingRecipientEmails: 'alpha@example.com\nbeta@example.com' },
    });
    assert.deepEqual((byLine.body as { data: ErpRentalContract }).data.billingRecipientEmails, [
      'alpha@example.com',
      'beta@example.com',
    ]);

    const cleared = await router.dispatch({
      ...ctx,
      method: 'PATCH',
      path: `/api/erp/rental-contracts/${created.id}`,
      body: { billingRecipientEmails: '' },
    });
    assert.deepEqual((cleared.body as { data: ErpRentalContract }).data.billingRecipientEmails, []);
    assert.deepEqual(repo.listRentalContracts().find((c) => c.id === created.id)?.billingRecipientEmails, []);
  });

  it('persiste o select de envio por e-mail e os checkboxes de automação, régua e próxima fatura', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const created = await createContract(router, {
      emailAutomationMode: 'Enviar lembrete de pagamento e boleto',
      autoSendEmailOnBilling: true,
      dunningRuleEnabled: true,
      generateNextInvoiceOnSave: false,
    });

    const patched = await router.dispatch({
      ...ctx,
      method: 'PATCH',
      path: `/api/erp/rental-contracts/${created.id}`,
      body: {
        emailAutomationMode: 'Não enviar e-mail',
        autoSendEmailOnBilling: false,
        dunningRuleEnabled: false,
        generateNextInvoiceOnSave: false,
      },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
    const after = (patched.body as { data: ErpRentalContract }).data;
    assert.equal(after.emailAutomationMode, 'Não enviar e-mail');
    assert.equal(after.autoSendEmailOnBilling, false);
    assert.equal(after.dunningRuleEnabled, false);
    assert.equal(after.generateNextInvoiceOnSave, false);

    const stored = repo.listRentalContracts().find((c) => c.id === created.id)!;
    assert.equal(stored.emailAutomationMode, 'Não enviar e-mail');
    assert.equal(stored.autoSendEmailOnBilling, false);
    assert.equal(stored.dunningRuleEnabled, false);
    assert.equal(stored.generateNextInvoiceOnSave, false);
  });

  it('batchSendContractBillingEmails usa os destinatários salvos e não inventa outro endereço', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const created = await createContract(router, {
      billingRecipientEmails: ['financeiro@example.com', 'contas.pagar@example.com'],
      lastEmailRecipient: 'legado@outro.com',
    });

    const res = await router.dispatch({
      ...ctx,
      method: 'POST',
      path: '/api/erp/rental-contracts/batch-email',
      body: { contractIds: [created.id] },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const data = (
      res.body as {
        data: { sentCount: number; recipients: Array<{ email: string; contractNumber: string }> };
      }
    ).data;
    assert.equal(data.sentCount, 2);
    assert.deepEqual(
      data.recipients.map((r) => r.email),
      ['financeiro@example.com', 'contas.pagar@example.com']
    );
    const stored = repo.listRentalContracts().find((c) => c.id === created.id)!;
    assert.equal(stored.lastEmailRecipient, 'financeiro@example.com, contas.pagar@example.com');
    const payload = JSON.stringify(res.body);
    assert.equal(payload.includes('@outro.com'), false);
    assert.equal(/financeiro@[a-z0-9]+\.com\.br/.test(payload), false);
  });
});

describe('Modal de contrato aplica o texto dos destinatários ao salvar', () => {
  it('ErpEditModals normaliza recipientEmailsText no salvamento e no onChange', () => {
    const modal = src('src/app/components/ErpEditModals.tsx');
    const start = modal.indexOf('export function ContractEditModal');
    const end = modal.indexOf('export function InvoiceEditModal', start);
    const block = modal.slice(start, end);
    assert.match(block, /draftWithRecipientEmails/);
    assert.match(block, /parseBillingRecipientEmails\(recipientEmailsText\)/);
    assert.match(block, /parseBillingRecipientEmails\(text\)/);
    assert.match(block, /await onSave\(draftWithRecipientEmails\(\)\)/);
    assert.doesNotMatch(block, /[\u{1F300}-\u{1FAFF}]/u);
  });
});

describe('handleSaveEditedContract não trata resposta não-ok como salvo', () => {
  it('POST/PATCH com erro mostra a mensagem do servidor e não atualiza o estado local', () => {
    const tab = src('src/app/components/ErpGestaoClickTab.tsx');
    const start = tab.indexOf('const handleSaveEditedContract =');
    const end = tab.indexOf('const handleDeleteContract =', start);
    assert.ok(start > 0 && end > start);
    const block = tab.slice(start, end);
    assert.match(block, /if \(!res\.ok\)/);
    assert.match(block, /json\?\.error/);
    assert.match(block, /Não foi possível salvar o contrato/);
    assert.match(block, /return false/);
    const failAt = block.indexOf('if (!res.ok)');
    const upsertAt = block.indexOf('recordUpsertedContract');
    const successAt = block.indexOf('salvo com sucesso');
    const refreshAt = block.indexOf('onRefresh()');
    assert.ok(failAt >= 0 && failAt < upsertAt, 'recordUpsertedContract só depois do teste de erro');
    assert.ok(failAt < successAt, 'toast de sucesso só depois do teste de erro');
    assert.ok(failAt < refreshAt, 'onRefresh só depois do teste de erro');
    assert.doesNotMatch(block, /res\.ok \? \(await res\.json\(\)\)\?\.data \|\| updated : updated/);
    assert.doesNotMatch(block, /[\u{1F300}-\u{1FAFF}]/u);
  });
});
