import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PROPOSAL_SERVICE_PILL_OPTIONS,
  computeProposalTotals,
  resolveProposalDocumentHeadings,
} from '../src/app/lib/proposal-share';
import { resolveInternalProposalKind, toInternalProposalSummary } from '../src/app/lib/internal-proposal-summary';
import type { ErpCommercialProposal } from '../src/db/types';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

function proposal(patch: Partial<ErpCommercialProposal>): ErpCommercialProposal {
  return {
    id: 'prop-pecas',
    code: '5001',
    title: 'Proposta de Spare Parts / Hard Parts',
    budgetType: 'SPARE_PARTS',
    companyName: 'Cliente Peças',
    status: 'RASCUNHO',
    contractMonths: 24,
    monthlyRecurringTotal: 0,
    shippingCost: 40,
    shippingCarrier: 'Correios / SEDEX',
    deliveryAddress: 'Rua das Peças, 10',
    deliveryLeadTime: '5 dias úteis',
    items: [
      {
        id: 'p',
        sku: 'FAN-1',
        description: 'Ventoinha',
        ncmOrServiceCode: '',
        quantity: 2,
        unitPrice: 150,
        discountPercent: 0,
        isRecurring: false,
        totalMonthly: 300,
        fiscalNature: 'VENDA_EQUIPAMENTO',
      },
    ],
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    ...patch,
  } as ErpCommercialProposal;
}

describe('Spare Parts / Hard Parts é tipo de orçamento', () => {
  it('não é mais um botão de tipo de serviço e o total é de venda, com frete', () => {
    assert.deepEqual([...PROPOSAL_SERVICE_PILL_OPTIONS], ['Suporte Técnico', 'Configuração', 'Instalação']);
    const headings = resolveProposalDocumentHeadings({ budgetType: 'SPARE_PARTS' });
    assert.equal(headings.dividerTitle, 'Proposta de Spare Parts / Hard Parts');
    assert.equal(headings.isSpareParts, true);
    assert.equal(headings.isServices, false);

    const parts = computeProposalTotals(proposal({}));
    assert.equal(parts.budgetType, 'SPARE_PARTS');
    assert.equal(parts.contractMonths, 1);
    assert.equal(parts.shippingCost, 40);
    assert.equal(parts.totalContractValue, 340);

    const antigo = computeProposalTotals(
      proposal({
        budgetType: 'SERVICOS',
        serviceType: 'Spare Parts / Hard Parts',
        contractMonths: 12,
        items: [
          {
            id: 's',
            sku: '',
            description: 'Cobertura de peças',
            ncmOrServiceCode: '',
            quantity: 1,
            unitPrice: 200,
            discountPercent: 0,
            isRecurring: true,
            totalMonthly: 200,
            fiscalNature: 'SERVICO_TECNICO_TI_TELECOM',
          },
        ],
      })
    );
    assert.equal(antigo.budgetType, 'SERVICOS');
    assert.equal(antigo.serviceType, 'Spare Parts / Hard Parts');
    assert.equal(antigo.contractMonths, 12);
    assert.equal(antigo.shippingCost, 40);
    assert.equal(resolveInternalProposalKind(antigo), 'SPARE_PARTS');
  });

  it('a folha nova não é mensal e a proposta antiga de serviço continua serviço', () => {
    const sheet = toInternalProposalSummary(proposal({})).sheet;
    assert.equal(sheet.headline, 'Proposta de Spare Parts / Hard Parts');
    assert.match(sheet.monthlyLine, /Valor total/);
    assert.doesNotMatch(sheet.monthlyLine, /Valor Mensal/);
    assert.match(sheet.freightLine, /40,00/);
    assert.match(sheet.clientAddress, /Peças/);
    assert.equal(sheet.readjustmentLine, '');

    const antigo = toInternalProposalSummary(
      proposal({
        budgetType: 'SERVICOS',
        serviceType: 'Suporte Técnico, Spare Parts / Hard Parts, Configuração e Instalação',
        contractMonths: 12,
      })
    ).sheet;
    assert.match(antigo.headline, /Proposta de Serviço/);
    assert.equal(antigo.headline.includes('Spare Parts / Hard Parts'), false);

    const form = src('src/app/components/ErpEditModals.tsx');
    assert.match(form, /value:\s*'SPARE_PARTS'/);
    assert.match(src('src/app/components/GestaoClickSidebar.tsx'), /ORC_SPARE_PARTS/);
  });
});
