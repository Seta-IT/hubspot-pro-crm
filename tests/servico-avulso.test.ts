import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeProposalTotals,
  isAvulsoServiceProposal,
  readablePaymentCondition,
  resolveProposalCommercialFigures,
} from '../src/app/lib/proposal-share';
import { toInternalProposalSummary } from '../src/app/lib/internal-proposal-summary';
import { buildInternalProposalPdf } from '../src/app/lib/internal-proposal-pdf';
import type { ErpCommercialProposal } from '../src/db/types';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

function proposal(patch: Partial<ErpCommercialProposal>): ErpCommercialProposal {
  return {
    id: 'prop-avulso',
    code: '4801',
    title: 'Suporte avulso',
    budgetType: 'SERVICOS',
    companyName: 'Cliente Avulso',
    status: 'RASCUNHO',
    contractMonths: 1,
    monthlyRecurringTotal: 1500,
    readjustmentIndex: 'IPCA',
    introductionText: 'Valor Mensal de R$ 1.500,00 por 1 mês, com reajuste anual pelo IPCA.',
    paymentCondition: 'Boleto',
    items: [
      {
        id: 's1',
        description: 'Suporte técnico',
        quantity: 1,
        unitPrice: 1500,
        isRecurring: true,
        totalMonthly: 1500,
        subtotal: 1500,
        fiscalNature: 'SERVICO_TECNICO_TI_TELECOM',
      },
    ],
    oneTimeSetupTotal: 0,
    shippingCost: 0,
    totalContractValue: 0,
    internalNotes: 'NOTA_INTERNA_AVULSO',
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    ...patch,
  } as ErpCommercialProposal;
}

describe('Serviço avulso é pagamento único', () => {
  it('reconhece só serviço com a vigência gravada 1 e mantém locação e mensal', () => {
    assert.equal(isAvulsoServiceProposal({ budgetType: 'SERVICOS', contractMonths: 1 }), true);
    assert.equal(isAvulsoServiceProposal({ budgetType: 'LOCACAO', contractMonths: 1 }), false);
    assert.equal(isAvulsoServiceProposal({ budgetType: 'PRODUTOS', contractMonths: 1 }), false);
    assert.equal(isAvulsoServiceProposal({ budgetType: 'SERVICOS', contractMonths: 12 }), false);

    const avulso = resolveProposalCommercialFigures(proposal({}));
    assert.equal(avulso.oneTime, true);
    assert.equal(avulso.months, 0);
    assert.equal(avulso.monthly, 1500);

    const mensal = resolveProposalCommercialFigures(proposal({ contractMonths: 12, monthlyRecurringTotal: 800 }));
    assert.equal(mensal.oneTime, false);
    assert.equal(mensal.months, 12);
    assert.equal(mensal.monthly, 800);

    const locacao = resolveProposalCommercialFigures(
      proposal({
        budgetType: 'LOCACAO',
        modality: 'RENTAL',
        contractMonths: 1,
        monthlyRecurringTotal: 900,
        commercialNotes: 'Locação — 36 meses.',
        items: [
          {
            id: 'r',
            sku: 'SW',
            description: 'Switch',
            ncmOrServiceCode: '',
            quantity: 1,
            unitPrice: 900,
            discountPercent: 0,
            isRecurring: true,
            totalMonthly: 900,
            fiscalNature: 'LOCACAO_BENS_MOVEIS',
          },
        ],
      })
    );
    assert.equal(locacao.oneTime, false);
    assert.equal(locacao.months, 36);
    assert.equal(locacao.monthly, 900);
  });

  it('não multiplica o serviço avulso por meses e multiplica a vigência mensal', () => {
    const avulso = computeProposalTotals(proposal({ shippingCost: 40, setupFee: 100 }));
    assert.equal(avulso.contractMonths, 1);
    assert.equal(avulso.shippingCost, 0);
    assert.equal(avulso.totalContractValue, 1600);

    const mensal = computeProposalTotals(proposal({ contractMonths: 12, shippingCost: 0, setupFee: 0 }));
    assert.equal(mensal.contractMonths, 12);
    assert.equal(mensal.totalContractValue, 18000);

    const locacao = computeProposalTotals(
      proposal({
        budgetType: 'LOCACAO',
        contractMonths: 1,
        shippingCost: 0,
        setupFee: 0,
        items: [
          {
            id: 'r',
            sku: 'SW',
            description: 'Switch',
            ncmOrServiceCode: '',
            quantity: 1,
            unitPrice: 900,
            discountPercent: 0,
            isRecurring: true,
            totalMonthly: 900,
            fiscalNature: 'LOCACAO_BENS_MOVEIS',
          },
        ],
        monthlyRecurringTotal: 900,
      })
    );
    assert.equal(locacao.contractMonths, 1);
    assert.equal(locacao.totalContractValue, 900);
  });

  it('folha interna, PDF e aceite do avulso não falam em mês, IPCA nem mensalidade', () => {
    const summary = toInternalProposalSummary(proposal({}));
    const sheet = summary.sheet;
    assert.equal(sheet.headline, 'Proposta de Serviço');
    assert.match(sheet.monthlyLine, /Valor total \(pagamento único\)/);
    assert.equal(sheet.readjustmentLine, '');
    assert.equal(sheet.paymentRows[0].due, 'Pagamento único');
    assert.doesNotMatch(JSON.stringify(sheet.summaryRows), /Valor mensal|Reajuste anual|1 mês|mensalidades/i);
    assert.doesNotMatch(JSON.stringify(sheet.paymentRows), /IPCA|mensalidade/i);
    assert.doesNotMatch(JSON.stringify(sheet), /NOTA_INTERNA_AVULSO/);
    assert.equal(summary.termValue, 'Pagamento único');
    assert.equal(summary.periodLabel, 'Valor total (pagamento único)');
    assert.equal(summary.conditions.some((row) => row.label === 'Índice de reajuste'), false);

    const mensal = toInternalProposalSummary(proposal({ contractMonths: 24 })).sheet;
    assert.match(mensal.headline, /24 meses/);
    assert.match(mensal.monthlyLine, /Valor Mensal/);
    assert.match(mensal.readjustmentLine, /IPCA/);
    assert.match(mensal.paymentRows[0].due, /24 mensalidades/);

    const pdf = Buffer.from(buildInternalProposalPdf(summary)).toString('latin1');
    assert.match(pdf, /pagamento/);
    assert.doesNotMatch(pdf, /mensalidades/);
    assert.doesNotMatch(pdf, /NOTA_INTERNA_AVULSO/);
    assert.equal((pdf.match(/\/Type \/Page(?!s)/g) || []).length, 1);

    const page = src('src/app/proposta/[id]/page.tsx');
    const form = src('src/app/components/ErpEditModals.tsx');
    assert.match(form, /Avulso \(pagamento único\)/);
    assert.match(form, /value:\s*'1'/);
    assert.doesNotMatch(form, /Avulso \/ 1 mês/);
    assert.match(page, /Valor total \(pagamento único\)/);
    assert.match(page, /valor total \(pagamento único\) descrito nesta Proposta de Serviços/);
  });

  it('no formulário, o avulso mostra Pagamento único e Total, e o resumo não fica a_vista', () => {
    assert.equal(readablePaymentCondition('a_vista'), 'À vista');
    assert.equal(readablePaymentCondition('pagamento_unico'), 'Pagamento único');
    assert.equal(readablePaymentCondition('Boleto 30 dias'), 'Boleto 30 dias');

    const rewritten = computeProposalTotals(proposal({ paymentCondition: 'a_vista' }));
    assert.equal(rewritten.paymentCondition, 'À vista');
    const mensal = computeProposalTotals(proposal({ contractMonths: 12, paymentCondition: 'a_vista' }));
    assert.equal(mensal.paymentCondition, 'a_vista');

    const form = src('src/app/components/ErpEditModals.tsx');
    assert.match(form, /Pagamento único/);
    assert.match(form, /isAvulsoServiceProposal\(draft\) \? "Total"/);
    assert.match(form, /À vista — Pagamento único/);
    assert.match(form, /Parcelado em \$\{count\}x de \$\{formatBRL\(perInstallment\)\} — Pagamento único/);
    assert.match(form, /label: '2x'/);
    assert.doesNotMatch(form, /preset\.n === 1/);
  });
});
