import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { proposalSetupFeeLabel } from '../src/app/lib/proposal-share';
import { toInternalProposalSummary } from '../src/app/lib/internal-proposal-summary';
import type { ErpCommercialProposal } from '../src/db/types';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

function base(patch: Partial<ErpCommercialProposal>): ErpCommercialProposal {
  return {
    id: 'prop-setup-label',
    code: '4901',
    title: 'Proposta teste',
    companyName: 'Cliente Teste',
    status: 'RASCUNHO',
    contractMonths: 12,
    monthlyRecurringTotal: 1000,
    setupFee: 15800,
    oneTimeSetupTotal: 15800,
    shippingCost: 0,
    items: [
      {
        id: 'i1',
        description: 'Item',
        quantity: 1,
        unitPrice: 1000,
        isRecurring: true,
        totalMonthly: 1000,
        subtotal: 1000,
        fiscalNature: 'SERVICO_TECNICO_TI_TELECOM',
      },
    ],
    ...patch,
  } as ErpCommercialProposal;
}

describe('Rótulo Setup / Ativação vira Serviço só em propostas de serviço', () => {
  it('SERVICOS usa Serviço em todas as variantes; locação, conjunto e produtos mantêm o texto antigo', () => {
    const servico = { budgetType: 'SERVICOS' as const };
    const locacao = { budgetType: 'LOCACAO' as const };
    const conjunto = { budgetType: 'CONJUNTO' as const };
    const produtos = { budgetType: 'PRODUTOS' as const };

    assert.equal(proposalSetupFeeLabel(servico), 'Serviço');
    assert.equal(proposalSetupFeeLabel(servico, 'unique'), 'Serviço');
    assert.equal(proposalSetupFeeLabel(servico, 'isolated'), 'Serviço:');
    assert.equal(proposalSetupFeeLabel(servico, 'internal'), 'Serviço');
    assert.equal(proposalSetupFeeLabel(servico, 'include'), 'Incluir serviço (R$)');
    assert.equal(proposalSetupFeeLabel(servico, 'empty'), 'Sem serviço');
    assert.equal(proposalSetupFeeLabel(servico, 'placeholder'), 'Valor do serviço');
    assert.equal(proposalSetupFeeLabel(servico, 'footer'), 'Serviço');
    assert.equal(proposalSetupFeeLabel({ budgetType: 'servicos' }), 'Serviço');

    assert.equal(proposalSetupFeeLabel(locacao), 'Setup / Ativação');
    assert.equal(proposalSetupFeeLabel(locacao, 'unique'), 'Setup único');
    assert.equal(proposalSetupFeeLabel(locacao, 'isolated'), 'Taxa de Setup (Isolada):');
    assert.equal(proposalSetupFeeLabel(locacao, 'internal'), 'Instalação / setup');
    assert.equal(proposalSetupFeeLabel(locacao, 'include'), 'Incluir setup (R$)');
    assert.equal(proposalSetupFeeLabel(locacao, 'empty'), 'Sem setup');
    assert.equal(proposalSetupFeeLabel(locacao, 'placeholder'), 'Valor do setup');
    assert.equal(proposalSetupFeeLabel(locacao, 'footer'), 'Setup');

    assert.equal(proposalSetupFeeLabel(conjunto), 'Setup / Ativação');
    assert.equal(proposalSetupFeeLabel(conjunto, 'unique'), 'Setup único');
    assert.equal(proposalSetupFeeLabel(produtos), 'Setup / Ativação');
    assert.equal(proposalSetupFeeLabel({}), 'Setup / Ativação');
  });

  it('folha interna de serviço com taxa única exibe Serviço; locação mantém Instalação / setup', () => {
    const servico = toInternalProposalSummary(base({
      budgetType: 'SERVICOS',
      modality: 'SERVICE',
      serviceType: 'Mapeamento de Cabeamento, Desinstalação',
    }));
    assert.equal(servico.kind, 'SERVICO');
    assert.equal(servico.oneTimeRows.find((r) => r.testId === 'internal-proposal-setup')?.label, 'Serviço');

    const locacao = toInternalProposalSummary(base({
      budgetType: 'LOCACAO',
      modality: 'RENTAL',
    }));
    assert.equal(locacao.kind, 'LOCACAO');
    assert.equal(locacao.oneTimeRows.find((r) => r.testId === 'internal-proposal-setup')?.label, 'Instalação / setup');
  });

  it('folha pública, prévia e modal usam o helper e não deixam o rótulo de serviço fixo no código', () => {
    const page = src('src/app/proposta/[id]/page.tsx');
    const modals = src('src/app/components/ErpEditModals.tsx');
    const summary = src('src/app/lib/internal-proposal-summary.ts');

    assert.equal(page.includes('Setup / Ativação'), false);
    assert.equal(page.includes('Taxa de Setup (Isolada):'), false);
    assert.ok(page.includes('commercialView.setupFeeLabel') || page.includes('proposalSetupFeeLabel(proposal)'));
    assert.ok(page.includes("proposalSetupFeeLabel(proposal, 'isolated')"));
    assert.ok(src('src/app/lib/proposal-share.ts').includes('proposalSetupFeeLabel(proposal)'));

    assert.equal(modals.includes('Setup único'), false);
    assert.equal(modals.includes('Incluir setup (R$)'), false);
    assert.ok(modals.includes("proposalSetupFeeLabel(draft, 'unique')"));
    assert.ok(modals.includes("proposalSetupFeeLabel(draft, 'include')"));
    assert.ok(modals.includes("proposalSetupFeeLabel(draft, 'footer')"));

    assert.equal(summary.includes("'Instalação / setup'"), false);
    assert.ok(summary.includes("proposalSetupFeeLabel(proposal, 'internal')"));
  });
});
