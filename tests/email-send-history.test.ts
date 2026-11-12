import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { ErpFiscalInvoice, ErpInvoiceEmailHistoryEntry, ErpRentalContract } from '../src/db/types';
import {
  collectContractEmailHistory,
  historyEntryKey,
  mergeEmailHistoryEntries,
} from '../src/app/lib/email-send-history';

const root = process.cwd();
const src = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

const entry = (partial: Partial<ErpInvoiceEmailHistoryEntry> & { protocol: string; to: string }): ErpInvoiceEmailHistoryEntry => ({
  sentAt: partial.sentAt || '2026-11-12T12:00:00.000Z',
  to: partial.to,
  cc: partial.cc,
  subject: partial.subject || 'Contrato',
  protocol: partial.protocol,
  actor: partial.actor,
  attachments: partial.attachments,
});

describe('histórico de envios de e-mail após o envio', () => {
  it('mergeEmailHistoryEntries acrescenta a entrada nova e ignora protocolo repetido', () => {
    const first = entry({ protocol: 'STI-MAIL-AAA', to: 'a@exemplo.invalid' });
    const once = mergeEmailHistoryEntries([], first);
    assert.equal(once.length, 1);
    const twice = mergeEmailHistoryEntries(once, { ...first, subject: 'Outro assunto' });
    assert.equal(twice.length, 1);
    const second = entry({ protocol: 'STI-MAIL-BBB', to: 'b@exemplo.invalid', sentAt: '2026-11-12T13:00:00.000Z' });
    const merged = mergeEmailHistoryEntries(twice, second);
    assert.equal(merged.length, 2);
    assert.equal(merged[1].protocol, 'STI-MAIL-BBB');
    assert.equal(historyEntryKey(first), 'p:STI-MAIL-AAA');
  });

  it('collectContractEmailHistory junta contrato e faturas e deduplica pelo protocolo', () => {
    const contract = {
      id: 'ctr-1',
      contractNumber: 'LOC-1',
      proposalId: null,
      emailHistory: [entry({ protocol: 'STI-MAIL-AAA', to: 'a@exemplo.invalid', subject: 'Contrato' })],
    } as Pick<ErpRentalContract, 'id' | 'contractNumber' | 'emailHistory' | 'proposalId'>;
    const invoices = [
      {
        id: 'inv-1',
        documentNumber: 'FAT-1',
        rentalContractId: 'ctr-1',
        contractNumber: 'LOC-1',
        emailHistory: [
          entry({ protocol: 'STI-MAIL-AAA', to: 'a@exemplo.invalid', subject: 'Contrato' }),
          entry({ protocol: 'STI-MAIL-CCC', to: 'c@exemplo.invalid', sentAt: '2026-11-12T14:00:00.000Z', subject: 'Fatura' }),
        ],
      } as ErpFiscalInvoice,
    ];
    const list = collectContractEmailHistory(contract, invoices);
    assert.equal(list.length, 2);
    assert.equal(list[0].protocol, 'STI-MAIL-CCC');
    assert.equal(list[0].sourceLabel, 'FAT-1');
    assert.equal(list[1].protocol, 'STI-MAIL-AAA');
  });

  it('o modal e as telas do contrato atualizam o histórico sem depender de recarregar a página', () => {
    const tab = src('src/app/components/ErpGestaoClickTab.tsx');
    assert.match(tab, /onSentSuccess=\{\(msg\) => \{/);
    assert.match(tab, /void onRefresh\(\);/);
    assert.equal(tab.includes('if (emailModalPayload.invoiceId) void onRefresh()'), false);

    const composer = src('src/app/components/ClientEmailComposerModal.tsx');
    assert.match(composer, /mergeEmailHistoryEntries/);
    assert.match(composer, /EmailSendHistoryPanel/);
    assert.match(composer, /setEmailHistory/);
    assert.match(composer, /emailHistoryEntry/);

    const billing = src('src/app/components/ContractBillingPanels.tsx');
    assert.match(billing, /EmailSendHistoryPanel/);
    assert.match(billing, /contract=\{contract\} invoices=\{list\}/);

    const deals = src('src/app/components/DealsKanbanTab.tsx');
    assert.match(deals, /onRefreshAll/);
    const page = src('src/app/page.tsx');
    assert.match(page, /void fetchAllCrmData\(\);/);
  });
});

describe('teto do histórico de e-mail', () => {
  it('capEmailHistory mantém só as 50 entradas mais recentes', async () => {
    const { capEmailHistory, EMAIL_HISTORY_MAX } = await import('../src/db/repository');
    assert.equal(EMAIL_HISTORY_MAX, 50);
    const list = Array.from({ length: 60 }, (_, i) => entry({ protocol: `P${i}`, to: 'a@exemplo.invalid' }));
    const capped = capEmailHistory(list);
    assert.equal(capped.length, 50);
    assert.equal(capped[0].protocol, 'P10');
    assert.equal(capped[49].protocol, 'P59');
    assert.equal(capEmailHistory(list.slice(0, 3)).length, 3);
  });

  it('contrato e fatura aplicam o teto, e o nome do anexo é cortado em 200 caracteres', () => {
    const repo = src('src/db/repository.ts');
    assert.equal((repo.match(/emailHistory: capEmailHistory\(/g) || []).length, 2);
    assert.match(src('src/api/router.ts'), /String\(x\)\.slice\(0, 200\)\)\.slice\(0, 4\)/);
  });
});
