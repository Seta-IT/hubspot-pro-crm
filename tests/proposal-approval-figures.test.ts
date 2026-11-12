import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveProposalCommercialFigures } from '../src/app/lib/proposal-share';
import { lookupServerProposal } from '../src/app/lib/proposal-approval-lookup';
import { toInternalProposalSummary } from '../src/app/lib/internal-proposal-summary';
import type { ErpCommercialProposal } from '../src/db/types';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('Resumo da assinatura e da folha interna', () => {
  it('usa o mensal dos itens e o prazo do texto quando o gravado é R$ 0,00 e 1 mês', () => {
    const figures = resolveProposalCommercialFigures({
      budgetType: 'LOCACAO',
      modality: 'RENTAL',
      monthlyRecurringTotal: 0,
      contractMonths: 1,
      commercialNotes: 'Locação de bens móveis — 36 meses (IPCA).',
      items: [
        { fiscalNature: 'LOCACAO_BENS_MOVEIS', isRecurring: false, quantity: 2, unitPrice: 780, subtotal: 1560, totalMonthly: 1560 },
        { fiscalNature: 'LOCACAO_BENS_MOVEIS', isRecurring: true, quantity: 6, unitPrice: 215, subtotal: 1290, totalMonthly: 1290 },
      ],
    });
    assert.equal(figures.monthly, 2850);
    assert.equal(figures.months, 36);

    const kept = resolveProposalCommercialFigures({
      monthlyRecurringTotal: 4490,
      contractMonths: 36,
      items: [{ quantity: 1, unitPrice: 10, subtotal: 10, totalMonthly: 10, isRecurring: true }],
    });
    assert.equal(kept.monthly, 4490);
    assert.equal(kept.months, 36);
  });

  it('a folha interna e o modal usam a mesma conta, sem assinar nada', () => {
    const proposal = {
      id: 'prop-local-4712',
      code: '4712',
      title: 'Locação Via Itália',
      budgetType: 'LOCACAO',
      companyId: null,
      companyName: 'Via Itália',
      companyCnpj: '07.638.845/0001-56',
      contactId: null,
      contactName: '',
      dealId: null,
      sellerName: 'Marcelo Lopes Mira',
      status: 'ENVIADA',
      contractMonths: 1,
      monthlyRecurringTotal: 0,
      paymentCondition: '',
      validUntil: '2026-11-20',
      commercialNotes: 'Locação — 36 meses.',
      technicalClauses: '',
      internalNotes: 'NOTA_INTERNA_4712',
      items: [
        {
          id: 'a',
          sku: 'FG-40F',
          description: 'FortiGate 40F',
          fiscalNature: 'LOCACAO_BENS_MOVEIS',
          ncmOrServiceCode: '',
          quantity: 2,
          unitPrice: 780,
          discountPercent: 0,
          isRecurring: true,
          totalMonthly: 1560,
        },
      ],
      oneTimeSetupTotal: 0,
      totalContractValue: 0,
      createdAt: '2026-11-06T00:00:00.000Z',
      updatedAt: '2026-11-06T00:00:00.000Z',
      version: 1,
    } as ErpCommercialProposal;
    const sheet = toInternalProposalSummary(proposal).sheet;
    assert.match(sheet.summaryRows[0].value, /Locação - 36 meses/);
    assert.match(sheet.summaryRows[1].value.replace(/\u00A0/g, ' '), /R\$ 1\.560,00/);
    assert.doesNotMatch(JSON.stringify(sheet.summaryRows), /NOTA_INTERNA_4712/);
    const page = src('src/app/proposta/[id]/page.tsx');
    assert.match(page, /commercialFigures\.monthly/);
    assert.match(page, /commercialFigures\.months === 1 \? "mês" : "meses"/);
    assert.match(page, /lookupServerProposal\(proposal\)/);
    assert.match(page, /Não foi possível localizar este orçamento no servidor/);
  });
});

describe('Aceite interno: achar o orçamento no servidor sem assinar', () => {
  it('o id local da época do 402 não existe; o código 4712 devolve o registro, e o POST de aceite não é chamado', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string) => {
      const url = String(input);
      calls.push(url);
      assert.doesNotMatch(url, /\/approve$/);
      if (url.endsWith('/prop-local-4712')) {
        return { ok: false, status: 404, json: async () => ({ error: 'não encontrada' }) };
      }
      if (url.endsWith('/4712')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              id: 'prop-gc-4712',
              code: '4712',
              monthlyRecurringTotal: 4490,
              contractMonths: 36,
              items: [],
            },
          }),
        };
      }
      throw new Error(`url inesperada ${url}`);
    }) as typeof fetch;
    const found = await lookupServerProposal({ id: 'prop-local-4712', code: '4712' }, fetchImpl);
    assert.equal(found?.id, 'prop-gc-4712');
    assert.equal(found?.monthlyRecurringTotal, 4490);
    assert.equal(found?.contractMonths, 36);
    assert.deepEqual(calls, [
      '/api/erp/proposals/prop-local-4712',
      '/api/erp/proposals/4712',
    ]);
  });
});
