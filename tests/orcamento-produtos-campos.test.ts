import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeProposalTotals } from '../src/app/lib/proposal-share';
import { toInternalProposalSummary } from '../src/app/lib/internal-proposal-summary';
import { defaultProductsProposalTitle, displayProposalTitle } from '../src/app/lib/proposal-title';
import type { ErpCommercialProposal } from '../src/db/types';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

function base(patch: Partial<ErpCommercialProposal> = {}): ErpCommercialProposal {
  return {
    id: 'prop-produtos-campos',
    code: '4726',
    title: '',
    budgetType: 'PRODUTOS',
    companyName: 'FOXCONN BRASIL',
    companyCnpj: '00.000.000/0001-00',
    status: 'RASCUNHO',
    contractMonths: 1,
    monthlyRecurringTotal: 0,
    setupFee: 0,
    oneTimeSetupTotal: 8500,
    totalContractValue: 8500,
    shippingCost: 0,
    items: [
      {
        id: 'i1',
        description: 'Switch Cisco 3850',
        quantity: 1,
        unitPrice: 8500,
        isRecurring: false,
        totalMonthly: 8500,
        subtotal: 8500,
        fiscalNature: 'VENDA_EQUIPAMENTO',
        itemType: 'PRODUCT',
      },
    ],
    ...patch,
  } as ErpCommercialProposal;
}

describe('Orçamento de produtos: SLA, nome, setup e prazo de contrato', () => {
  it('gera o título automático e preserva um nome já gravado', () => {
    assert.equal(
      defaultProductsProposalTitle({ code: '4726', companyName: 'FOXCONN BRASIL' }),
      'Orçamento de Produtos nº 4726 — FOXCONN BRASIL'
    );
    assert.equal(
      defaultProductsProposalTitle({ code: 'GC-ORC-4726', companyName: 'FOXCONN BRASIL' }),
      'Orçamento de Produtos nº 4726 — FOXCONN BRASIL'
    );
    assert.equal(
      defaultProductsProposalTitle({ code: '4726', companyName: '' }),
      'Orçamento de Produtos nº 4726'
    );
    assert.equal(
      displayProposalTitle({ budgetType: 'PRODUTOS', code: '4726', companyName: 'FOXCONN BRASIL' }),
      'Orçamento de Produtos nº 4726 — FOXCONN BRASIL'
    );
    assert.equal(
      displayProposalTitle({
        title: 'Fornecimento de Switches',
        budgetType: 'PRODUTOS',
        code: '4726',
        companyName: 'FOXCONN BRASIL',
      }),
      'Fornecimento de Switches',
      'orçamentos antigos com nome continuam com o mesmo título'
    );
    assert.equal(
      displayProposalTitle({
        title: '',
        budgetType: 'LOCACAO',
        code: '4726',
        companyName: 'FOXCONN BRASIL',
      }),
      '',
      'locação sem nome não recebe o padrão de produtos'
    );
  });

  it('computeProposalTotals preenche o título vazio só em produtos e mantém o gravado', () => {
    const filled = computeProposalTotals(base({ title: '' }));
    assert.equal(filled.title, 'Orçamento de Produtos nº 4726 — FOXCONN BRASIL');
    assert.equal(filled.slaTier, 'SEM_SLA_ESPECIFICO');

    const kept = computeProposalTotals(base({ title: 'Venda Cisco 3850' }));
    assert.equal(kept.title, 'Venda Cisco 3850');

    const locacao = computeProposalTotals(base({ budgetType: 'LOCACAO', title: '', contractMonths: 24 }));
    assert.equal(locacao.title, '');
  });

  it('versão contrato e folha interna não exibem SLA em orçamento de produtos', () => {
    const summary = toInternalProposalSummary(base({ title: '', slaTier: 'CORPORATIVO_8X5_NBD' }));
    assert.equal(summary.kind, 'PRODUTOS');
    assert.equal(summary.title, 'Orçamento de Produtos nº 4726 — FOXCONN BRASIL');
    assert.equal(summary.conditions.some((row) => row.testId === 'internal-proposal-sla'), false);
    assert.equal(summary.conditions.some((row) => /SLA/i.test(row.label)), false);
    assert.equal(summary.sheet.slaLine, '');
    assert.equal(summary.sheet.summaryRows.some((row) => row.label === 'SLA'), false);

    const locacao = toInternalProposalSummary(base({ budgetType: 'LOCACAO', title: 'Locação PABX', contractMonths: 24, slaTier: 'CORPORATIVO_8X5_NBD' }));
    assert.equal(locacao.conditions.some((row) => row.testId === 'internal-proposal-sla'), true);
  });

  it('formulário de produtos oculta SLA, nome, setup e prazo de contrato, e deixa um só Prazo de Entrega no bloco de dados', () => {
    const modal = src('src/app/components/ErpEditModals.tsx');
    const router = src('src/api/router.ts');
    const page = src('src/app/proposta/[id]/page.tsx');
    const tab = src('src/app/components/ErpGestaoClickTab.tsx');

    assert.equal([...modal.matchAll(/Prazo de Entrega/g)].length, 2, 'comentário + um rótulo no topo; o do bloco azul some');
    assert.ok(modal.includes('placeholder="Ex.: 10 dias úteis"'));
    assert.equal(modal.includes('placeholder="Ex.: 10 dias úteis após o aceite"'), false);

    assert.ok(modal.includes('{draft.budgetType !== "PRODUTOS" && (') && modal.includes('SLA (Nível de Serviço)'));
    assert.ok(modal.includes('Nome da proposta') && modal.includes('{draft.budgetType !== "PRODUTOS" && ('));
    assert.ok(modal.includes('Prazo do contrato (meses)') && modal.includes('{draft.budgetType !== "PRODUTOS" && ('));
    assert.ok(modal.includes('draft.budgetType !== "PRODUTOS" && draft.budgetType !== "SPARE_PARTS"'));
    assert.ok(modal.includes('proposalSetupFeeLabel'));

    assert.ok(router.includes("!body.title && body.budgetType !== 'PRODUTOS'"));
    assert.ok(page.includes('displayProposalTitle(proposal)'));
    assert.ok(tab.includes('displayProposalTitle(prop)'));
  });
});
