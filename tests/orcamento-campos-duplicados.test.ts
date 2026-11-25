import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeProposalTotals } from '../src/app/lib/proposal-share';
import { defaultProposalTitle, displayProposalTitle, proposalTypeTitleLabel } from '../src/app/lib/proposal-title';
import { buildProposalCopyDraft } from '../src/app/lib/proposal-copy';
import type { ErpCommercialProposal } from '../src/db/types';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

function base(patch: Partial<ErpCommercialProposal> = {}): ErpCommercialProposal {
  return {
    id: 'prop-campos-dup',
    code: '4801',
    title: '',
    budgetType: 'SERVICOS',
    companyName: 'ACME TELECOM',
    companyCnpj: '00.000.000/0001-00',
    status: 'RASCUNHO',
    contractMonths: 24,
    monthlyRecurringTotal: 1000,
    setupFee: 500,
    oneTimeSetupTotal: 500,
    totalContractValue: 24500,
    shippingCost: 0,
    slaTier: 'CORPORATIVO_8X5_NBD',
    slaAvailabilityPercent: 99.5,
    slaResponseHours: 8,
    items: [
      {
        id: 'i1',
        description: 'Suporte mensal',
        quantity: 1,
        unitPrice: 1000,
        isRecurring: true,
        totalMonthly: 1000,
        subtotal: 1000,
        fiscalNature: 'SERVICO_COMUNICACAO',
        itemType: 'SERVICE',
        sku: 'GC-SV-001',
        ncmOrServiceCode: '1.05',
        discountPercent: 0,
      },
    ],
    ...patch,
  } as ErpCommercialProposal;
}

describe('Campos duplicados e nome automático no orçamento', () => {
  it('gera o título automático por tipo e preserva títulos já gravados', () => {
    assert.equal(proposalTypeTitleLabel('PRODUTOS'), 'Orçamento de Produtos');
    assert.equal(proposalTypeTitleLabel('SERVICOS'), 'Orçamento de Serviços');
    assert.equal(proposalTypeTitleLabel('LOCACAO'), 'Orçamento de Locação');
    assert.equal(proposalTypeTitleLabel('CONJUNTO'), 'Orçamento conjunto');
    assert.equal(proposalTypeTitleLabel('SPARE_PARTS'), 'Spare Parts / Hard Parts');

    assert.equal(
      defaultProposalTitle({ budgetType: 'SERVICOS', code: '4801', companyName: 'ACME TELECOM' }),
      'Orçamento de Serviços nº 4801 — ACME TELECOM'
    );
    assert.equal(
      defaultProposalTitle({ budgetType: 'LOCACAO', code: 'GC-ORC-4801', companyName: 'ACME TELECOM' }),
      'Orçamento de Locação nº 4801 — ACME TELECOM'
    );
    assert.equal(
      defaultProposalTitle({ budgetType: 'CONJUNTO', code: '4801', companyName: '' }),
      'Orçamento conjunto nº 4801'
    );
    assert.equal(
      defaultProposalTitle({ budgetType: 'SPARE_PARTS', code: '4801', companyName: 'ACME TELECOM' }),
      'Spare Parts / Hard Parts nº 4801 — ACME TELECOM'
    );

    assert.equal(
      displayProposalTitle({
        title: 'Suporte anual PABX',
        budgetType: 'SERVICOS',
        code: '4801',
        companyName: 'ACME TELECOM',
      }),
      'Suporte anual PABX',
      'títulos antigos permanecem iguais'
    );
    assert.equal(
      displayProposalTitle({ title: '   ', budgetType: 'SERVICOS', code: '4801', companyName: 'ACME TELECOM' }),
      'Orçamento de Serviços nº 4801 — ACME TELECOM'
    );

    const filled = computeProposalTotals(base({ title: '' }));
    assert.equal(filled.title, 'Orçamento de Serviços nº 4801 — ACME TELECOM');
    const kept = computeProposalTotals(base({ title: 'Suporte anual PABX' }));
    assert.equal(kept.title, 'Suporte anual PABX');
  });

  it('cópia com título automático deixa o nome vazio para regenerar com o novo número; título customizado ganha (Cópia)', () => {
    const auto = buildProposalCopyDraft(
      base({ title: 'Orçamento de Serviços nº 4801 — ACME TELECOM' }),
      { newId: 'copy-1', nextCode: '4802', now: new Date('2026-11-25T12:00:00-03:00') }
    );
    assert.equal(auto.title, 'Orçamento de Serviços nº 4802 — ACME TELECOM');

    const custom = buildProposalCopyDraft(base({ title: 'Suporte anual PABX' }), {
      newId: 'copy-2',
      nextCode: '4803',
      now: new Date('2026-11-25T12:00:00-03:00'),
    });
    assert.equal(custom.title, 'Suporte anual PABX (Cópia)');
  });

  it('remove duplicatas e o campo de nome no formulário de criação/edição, sem exigir título na API', () => {
    const modal = src('src/app/components/ErpEditModals.tsx');
    const tab = src('src/app/components/ErpGestaoClickTab.tsx');
    const router = src('src/api/router.ts');

    assert.equal(modal.includes('Nome da proposta'), false);
    assert.equal(modal.includes('SLA contratado'), false);
    assert.equal(modal.includes('Vigência / Contrato'), false);
    assert.ok(modal.includes('SLA (Nível de Serviço)'));
    assert.ok(modal.includes('Prazo do contrato (meses)'));
    assert.ok(modal.includes('proposalSetupFeeLabel'));
    assert.equal([...modal.matchAll(/Prazo do contrato \(meses\)/g)].length, 1);
    assert.ok(modal.includes('SLA (Nível de Serviço)'));
    assert.equal((modal.match(/ariaLabel="SLA \(Nível de Serviço\)"/g) || []).length, 1);

    assert.ok(
      modal.includes('turningAvulso') && modal.includes('À vista — Pagamento único'),
      'efeito avulso de Serviços (1 mês) permanece no Prazo do contrato (meses)'
    );
    assert.ok(modal.includes('draft.budgetType !== "PRODUTOS" && draft.budgetType !== "SPARE_PARTS"'));

    assert.equal(tab.includes('Nome da proposta *'), false);
    assert.equal(tab.includes('if (!propTitle.trim()) return;'), false);

    assert.equal(router.includes("!body.title && body.budgetType !== 'PRODUTOS'"), false);
    assert.equal(router.includes('O campo "title" da proposta é obrigatório.'), false);
    assert.ok(router.includes('Nome da proposta não é obrigatório'));
    assert.equal(modal.includes('Campos personalizados'), false);
    assert.equal(modal.includes('Locação & Conectividade'), false);
    assert.ok(modal.includes("{ value: 'LOCACAO', label: 'Locação' }"));
  });
});
