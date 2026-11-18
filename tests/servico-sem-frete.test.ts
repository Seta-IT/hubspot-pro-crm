import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeProposalTotals, proposalHidesFreight } from '../src/app/lib/proposal-share';
import { toInternalProposalSummary } from '../src/app/lib/internal-proposal-summary';
import type { ErpCommercialProposal } from '../src/db/types';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

function proposal(patch: Partial<ErpCommercialProposal>): ErpCommercialProposal {
  return {
    id: 'prop-frete',
    code: '4901',
    title: 'Suporte',
    budgetType: 'SERVICOS',
    companyName: 'Cliente',
    status: 'RASCUNHO',
    contractMonths: 12,
    monthlyRecurringTotal: 1000,
    shippingCost: 80,
    shippingCarrier: 'Correios / SEDEX',
    deliveryAddress: 'Av. Paulista, 1000',
    deliveryLeadTime: '7 dias úteis após o aceite',
    items: [
      {
        id: 's',
        sku: 'SUP',
        description: 'Suporte',
        ncmOrServiceCode: '',
        quantity: 1,
        unitPrice: 1000,
        discountPercent: 0,
        isRecurring: true,
        totalMonthly: 1000,
        fiscalNature: 'SERVICO_TECNICO_TI_TELECOM',
      },
    ],
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    ...patch,
  } as ErpCommercialProposal;
}

describe('Frete some só com Suporte Técnico', () => {
  it('zera o frete quando o tipo contém Suporte Técnico e mantém nos demais', () => {
    for (const serviceType of [
      'Suporte Técnico',
      'Suporte Técnico & Spare Parts (Hard Parts)',
      'Suporte Técnico, Spare Parts / Hard Parts, Configuração e Instalação',
    ]) {
      const servico = computeProposalTotals(proposal({ serviceType }));
      assert.equal(proposalHidesFreight(servico), true, serviceType);
      assert.equal(servico.shippingCost, 0, serviceType);
      assert.equal(servico.totalContractValue, 12000, serviceType);
    }

    for (const serviceType of [
      'Spare Parts / Hard Parts',
      'Configuração',
      'Instalação',
      'Configuração & Instalação',
    ]) {
      const servico = computeProposalTotals(proposal({ serviceType }));
      assert.equal(proposalHidesFreight(servico), false, serviceType);
      assert.equal(servico.shippingCost, 80, serviceType);
      assert.equal(servico.totalContractValue, 12080, serviceType);
    }

    const locacao = computeProposalTotals(
      proposal({
        budgetType: 'LOCACAO',
        contractMonths: 12,
        items: [
          {
            id: 'r',
            sku: 'SW',
            description: 'Switch',
            ncmOrServiceCode: '',
            quantity: 1,
            unitPrice: 1000,
            discountPercent: 0,
            isRecurring: true,
            totalMonthly: 1000,
            fiscalNature: 'LOCACAO_BENS_MOVEIS',
          },
        ],
      })
    );
    assert.equal(locacao.shippingCost, 80);
    assert.equal(locacao.totalContractValue, 12080);

    const produtos = computeProposalTotals(
      proposal({
        budgetType: 'PRODUTOS',
        contractMonths: 1,
        items: [
          {
            id: 'p',
            sku: 'SSD',
            description: 'SSD',
            ncmOrServiceCode: '',
            quantity: 1,
            unitPrice: 200,
            discountPercent: 0,
            isRecurring: false,
            totalMonthly: 200,
            fiscalNature: 'VENDA_EQUIPAMENTO',
          },
        ],
      })
    );
    assert.equal(produtos.shippingCost, 80);
    assert.equal(produtos.totalContractValue, 280);
  });

  it('esconde frete na folha só com Suporte Técnico e conserva o prazo do SLA', () => {
    const servico = toInternalProposalSummary(proposal({ serviceType: 'Suporte Técnico' })).sheet;
    assert.match(servico.deliveryLine, /7 dias úteis/);
    assert.equal(servico.freightLine, '');
    assert.equal(servico.showFreight, false);
    assert.equal(servico.summaryRows.some((row) => row.label === 'Frete'), false);
    assert.equal(servico.paymentRows.some((row) => /frete/i.test(row.note)), false);
    assert.doesNotMatch(servico.clientAddress, /Paulista/);

    const spare = toInternalProposalSummary(
      proposal({ serviceType: 'Spare Parts / Hard Parts' })
    ).sheet;
    assert.match(spare.deliveryLine, /7 dias úteis/);
    assert.match(spare.freightLine, /80,00/);
    assert.match(spare.clientAddress, /Paulista/);

    const locacao = toInternalProposalSummary(
      proposal({ budgetType: 'LOCACAO', contractMonths: 12 })
    ).sheet;
    assert.match(locacao.freightLine, /80,00/);
    assert.match(locacao.clientAddress, /Paulista/);

    const form = src('src/app/components/ErpEditModals.tsx');
    const proposalForm = form.slice(
      form.indexOf('export function ProposalEditModal'),
      form.indexOf('export function ContractEditModal')
    );
    assert.match(proposalForm, /Prazo de Entrega/);
    assert.match(proposalForm, /!proposalHidesFreight\(draft\)/);
    assert.match(proposalForm, /Frete e entrega/);
    assert.match(proposalForm, /\[x\] \$\{pill\}/);
    const page = src('src/app/proposta/[id]/page.tsx');
    assert.match(page, /hideServiceFreight/);
    assert.match(page, /endere\[cç\]o de entrega/);
  });
});
