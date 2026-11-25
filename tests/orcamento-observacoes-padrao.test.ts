import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyProposalCommercialNotesDefault,
  commercialNoteFromDefaults,
  isProposalNoteDefaultTypeKey,
  mergeProposalNoteDefaults,
  proposalNoteDefaultTypeKey,
  seedProposalNoteDefaults,
  SYSTEM_DEFAULT_COMMERCIAL_NOTES,
} from '../src/app/lib/proposal-note-defaults';
import {
  handleProposalNoteDefaultsRoute,
} from '../src/api/proposal-note-defaults-routes';
import {
  ERP_PROPOSAL_NOTE_DEFAULTS_SCHEMA_SQL,
  MemoryProposalNoteDefaultsStore,
} from '../src/modules/erp/proposal-note-defaults-store';
import { buildProposalCopyDraft } from '../src/app/lib/proposal-copy';
import type { ErpCommercialProposal } from '../src/db/types';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

function base(patch: Partial<ErpCommercialProposal> = {}): ErpCommercialProposal {
  return {
    id: 'prop-notes',
    code: '4901',
    title: 'Proposta teste',
    budgetType: 'LOCACAO',
    companyName: 'ACME',
    status: 'RASCUNHO',
    contractMonths: 24,
    monthlyRecurringTotal: 1000,
    setupFee: 0,
    oneTimeSetupTotal: 0,
    totalContractValue: 24000,
    shippingCost: 0,
    commercialNotes: '',
    items: [
      {
        id: 'i1',
        description: 'Locação de PABX',
        quantity: 1,
        unitPrice: 1000,
        isRecurring: true,
        totalMonthly: 1000,
        subtotal: 1000,
        fiscalNature: 'LOCACAO_BENS_MOVEIS',
        itemType: 'PRODUCT',
        sku: 'GC-EQ-1',
        ncmOrServiceCode: '8517',
        discountPercent: 0,
      },
    ],
    ...patch,
  } as ErpCommercialProposal;
}

describe('Observações comerciais padrão por tipo de proposta', () => {
  it('classifica o tipo e usa o texto padrão atual do sistema no seed', () => {
    assert.equal(proposalNoteDefaultTypeKey({ budgetType: 'PRODUTOS' }), 'PRODUTOS');
    assert.equal(proposalNoteDefaultTypeKey({ budgetType: 'LOCACAO', contractMonths: 12 }), 'LOCACAO');
    assert.equal(proposalNoteDefaultTypeKey({ budgetType: 'SERVICOS', contractMonths: 1 }), 'SERVICOS_PONTUAL');
    assert.equal(proposalNoteDefaultTypeKey({ budgetType: 'SERVICOS', contractMonths: 24 }), 'SERVICOS_MENSAL');
    assert.equal(proposalNoteDefaultTypeKey({ budgetType: 'CONJUNTO' }), null);
    assert.equal(proposalNoteDefaultTypeKey({ budgetType: 'SPARE_PARTS' }), null);
    assert.equal(isProposalNoteDefaultTypeKey('LOCACAO'), true);
    assert.equal(isProposalNoteDefaultTypeKey('CONJUNTO'), false);

    const seed = seedProposalNoteDefaults();
    assert.equal(seed.PRODUTOS, SYSTEM_DEFAULT_COMMERCIAL_NOTES);
    assert.equal(seed.SERVICOS_PONTUAL, SYSTEM_DEFAULT_COMMERCIAL_NOTES);
    assert.equal(seed.SERVICOS_MENSAL, SYSTEM_DEFAULT_COMMERCIAL_NOTES);
    assert.equal(seed.LOCACAO, SYSTEM_DEFAULT_COMMERCIAL_NOTES);
    assert.ok(SYSTEM_DEFAULT_COMMERCIAL_NOTES.includes('LC 116/2003'));
  });

  it('preenche vazio, reaplica ao trocar o tipo se o texto ainda é o padrão, e preserva texto editado', () => {
    const defaults = mergeProposalNoteDefaults({
      PRODUTOS: 'Obs produtos',
      SERVICOS_PONTUAL: 'Obs pontual',
      SERVICOS_MENSAL: 'Obs mensal',
      LOCACAO: 'Obs locação',
    });

    assert.equal(
      applyProposalCommercialNotesDefault({
        currentNotes: '',
        nextTypeKey: 'LOCACAO',
        defaults,
      }),
      'Obs locação'
    );
    assert.equal(
      applyProposalCommercialNotesDefault({
        currentNotes: 'Obs locação',
        previousTypeKey: 'LOCACAO',
        nextTypeKey: 'SERVICOS_MENSAL',
        defaults,
      }),
      'Obs mensal'
    );
    assert.equal(
      applyProposalCommercialNotesDefault({
        currentNotes: 'Texto do vendedor',
        previousTypeKey: 'LOCACAO',
        nextTypeKey: 'PRODUTOS',
        defaults,
      }),
      'Texto do vendedor'
    );
    assert.equal(
      applyProposalCommercialNotesDefault({
        currentNotes: '   ',
        previousTypeKey: 'SERVICOS_MENSAL',
        nextTypeKey: 'SERVICOS_PONTUAL',
        defaults,
      }),
      'Obs pontual'
    );
    assert.equal(
      applyProposalCommercialNotesDefault({
        currentNotes: '',
        nextTypeKey: null,
        defaults,
      }),
      ''
    );
    assert.equal(commercialNoteFromDefaults(defaults, 'PRODUTOS'), 'Obs produtos');
  });

  it('grava e lê os padrões na store em memória, sem alterar proposta existente na cópia com texto', async () => {
    const store = new MemoryProposalNoteDefaultsStore();
    const listed = await store.list();
    assert.equal(listed.LOCACAO, SYSTEM_DEFAULT_COMMERCIAL_NOTES);
    const saved = await store.save({ LOCACAO: 'Novo padrão de locação', PRODUTOS: 'Novo padrão de produtos' });
    assert.equal(saved.LOCACAO, 'Novo padrão de locação');
    assert.equal(saved.PRODUTOS, 'Novo padrão de produtos');
    assert.equal(saved.SERVICOS_MENSAL, SYSTEM_DEFAULT_COMMERCIAL_NOTES);

    const withNotes = buildProposalCopyDraft(base({ commercialNotes: 'Texto já gravado' }), {
      nextCode: '4902',
      now: new Date('2026-11-25T12:00:00-03:00'),
    });
    assert.equal(withNotes.commercialNotes, 'Texto já gravado');

    const empty = buildProposalCopyDraft(base({ commercialNotes: '' }), {
      nextCode: '4903',
      now: new Date('2026-11-25T12:00:00-03:00'),
    });
    assert.equal(empty.commercialNotes, '');
  });

  it('GET devolve o mapa e PUT persiste; tipo inválido é recusado', async () => {
    const store = new MemoryProposalNoteDefaultsStore();
    const getRes = await handleProposalNoteDefaultsRoute('GET', {}, 'tester', store);
    assert.equal(getRes.status, 200);
    assert.equal((getRes.body as { data: { LOCACAO: string } }).data.LOCACAO, SYSTEM_DEFAULT_COMMERCIAL_NOTES);

    const putRes = await handleProposalNoteDefaultsRoute(
      'PUT',
      { data: { SERVICOS_PONTUAL: 'Padrão pontual' } },
      'tester',
      store
    );
    assert.equal(putRes.status, 200);
    assert.equal((putRes.body as { data: { SERVICOS_PONTUAL: string } }).data.SERVICOS_PONTUAL, 'Padrão pontual');
    assert.equal((await store.list()).SERVICOS_PONTUAL, 'Padrão pontual');

    const bad = await handleProposalNoteDefaultsRoute('PUT', { data: { CONJUNTO: 'x' } }, 'tester', store);
    assert.equal(bad.status, 400);
  });

  it('migração é aditiva, o formulário remove a Capa e a tela de configurações existe', () => {
    assert.ok(ERP_PROPOSAL_NOTE_DEFAULTS_SCHEMA_SQL.includes('CREATE TABLE IF NOT EXISTS erp_proposal_note_defaults'));
    assert.ok(ERP_PROPOSAL_NOTE_DEFAULTS_SCHEMA_SQL.includes('type_key TEXT PRIMARY KEY'));
    assert.equal(ERP_PROPOSAL_NOTE_DEFAULTS_SCHEMA_SQL.includes('DROP TABLE'), false);
    assert.ok(src('src/db/cli-migrate.ts').includes('ensureProposalNoteDefaultsSchema'));

    const modal = src('src/app/components/ErpEditModals.tsx');
    assert.equal(modal.includes('Campos personalizados'), false);
    assert.equal(modal.includes('coverText'), false);
    assert.equal(modal.includes('Locação & Conectividade'), false);
    assert.ok(modal.includes("{ value: 'LOCACAO', label: 'Locação' }"));
    assert.ok(modal.includes('applyProposalCommercialNotesDefault'));
    assert.ok(modal.includes('Observações Comerciais &amp; Fiscais (Sai no PDF)'));

    const tab = src('src/app/components/ErpGestaoClickTab.tsx');
    const sidebar = src('src/app/components/GestaoClickSidebar.tsx');
    const router = src('src/api/router.ts');
    assert.ok(sidebar.includes("id: 'CFG_ORCAMENTO_OBS'"));
    assert.ok(sidebar.includes('Observações da proposta'));
    assert.ok(tab.includes('ProposalNoteDefaultsPage'));
    assert.ok(src('src/app/components/ProposalNoteDefaultsPage.tsx').includes('proposal-note-defaults-page'));
    assert.ok(router.includes('isProposalNoteDefaultsRoute'));
    assert.ok(router.includes('loadProposalNoteDefaults'));
    assert.ok(src('src/db/repository.ts').includes('applyProposalCommercialNotesDefault'));
  });
});
