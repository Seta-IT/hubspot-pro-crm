import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  displayProposalPaymentCondition,
  formatInstallmentPaymentCondition,
  formatMonthlyPaymentCondition,
} from '../src/app/lib/proposal-monthly-billing';
import { toPublicProposalDto } from '../src/app/lib/proposal-public-dto';
import { toInternalProposalSummary } from '../src/app/lib/internal-proposal-summary';
import { buildInternalProposalSheet } from '../src/app/lib/internal-proposal-sheet';
import type { ErpCommercialProposal } from '../src/db/types';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

function proposal(patch: Partial<ErpCommercialProposal>): ErpCommercialProposal {
  return {
    id: 'prop-resumo',
    code: '4726',
    title: 'Venda de Switches Cisco C3850',
    budgetType: 'PRODUTOS',
    companyName: 'FOXCONN BRASIL INDUSTRIA E COMERCIO LTDA',
    status: 'ENVIADA',
    contractMonths: 1,
    paymentCondition: 'Boleto / PIX Corporativo — Vencimento dia 10',
    monthlyRecurringTotal: 0,
    oneTimeSetupTotal: 0,
    totalContractValue: 13240,
    items: [],
    createdAt: '2026-11-25T19:32:30.700Z',
    updatedAt: '2026-11-27T17:13:31.793Z',
    ...patch,
  } as ErpCommercialProposal;
}

describe('Resumo da condição de pagamento com parcelas e data completa', () => {
  it('produtos: forma, quantidade e vencimento completo; 1x usa Vencimento e Nx usa 1º vencimento', () => {
    assert.equal(
      formatInstallmentPaymentCondition({
        paymentMethod: 'BOLETO',
        installmentCount: 1,
        firstDueDate: '2026-12-12',
      }),
      'Boleto • 1x • Vencimento 12/12/2026'
    );
    assert.equal(
      formatInstallmentPaymentCondition({
        paymentMethod: 'PIX',
        installmentCount: 3,
        firstDueDate: '2026-12-10',
      }),
      'Pix • 3x • 1º vencimento 10/12/2026'
    );
    assert.equal(
      displayProposalPaymentCondition(
        proposal({
          paymentCondition: 'Boleto / PIX Corporativo — Vencimento dia 10',
          installments: [{ number: 1, dueDate: '2026-12-12', amount: 13240, paymentMethod: 'BOLETO' }],
        })
      ),
      'Boleto • 1x • Vencimento 12/12/2026'
    );
    assert.equal(
      displayProposalPaymentCondition(
        proposal({
          paymentCondition: 'Parcelado em 3x',
          installments: [
            { number: 1, dueDate: '2026-12-10', amount: 1000, paymentMethod: 'BOLETO' },
            { number: 2, dueDate: '2027-01-10', amount: 1000, paymentMethod: 'BOLETO' },
            { number: 3, dueDate: '2027-02-10', amount: 1000, paymentMethod: 'BOLETO' },
          ],
        })
      ),
      'Boleto • 3x • 1º vencimento 10/12/2026'
    );
  });

  it('substitui texto livre antigo quando há data real, e não inventa data se não houver', () => {
    assert.equal(
      displayProposalPaymentCondition(
        proposal({
          paymentCondition: 'Boleto / PIX Corporativo — Vencimento dia 10',
          installments: [],
        })
      ),
      'Boleto / PIX Corporativo — Vencimento dia 10'
    );
    assert.equal(
      displayProposalPaymentCondition(
        proposal({
          paymentCondition: 'À Vista (BOLETO) — Vencimento 2026-12-12',
        })
      ),
      'Boleto • 1x • Vencimento 12/12/2026'
    );
  });

  it('locação, serviço e spare parts usam mensalidades e o 1º vencimento completo', () => {
    assert.equal(
      formatMonthlyPaymentCondition({
        contractMonths: 6,
        paymentMethod: 'BOLETO',
        billingDueRule: 'EVERY_30_DAYS',
        billingFirstDueDate: '2026-12-10',
      }),
      'Boleto • 6 mensalidades • 1º vencimento 10/12/2026'
    );
    assert.equal(
      displayProposalPaymentCondition(
        proposal({
          budgetType: 'LOCACAO',
          contractMonths: 6,
          paymentCondition: 'Boleto / PIX Corporativo — Vencimento dia 10',
          billingDueRule: 'FIXED_DAY',
          billingDueDay: 10,
          billingFirstDueDate: '2026-12-10',
        })
      ),
      'Boleto / Pix • 6 mensalidades • 1º vencimento 10/12/2026'
    );
    assert.equal(
      displayProposalPaymentCondition(
        proposal({
          budgetType: 'SERVICOS',
          contractMonths: 12,
          paymentCondition: 'a_vista',
          billingFirstDueDate: '2026-12-15',
          installments: [{ number: 1, dueDate: '2026-12-15', amount: 200, paymentMethod: 'PIX' }],
        })
      ),
      'Pix • 12 mensalidades • 1º vencimento 15/12/2026'
    );
    assert.equal(
      displayProposalPaymentCondition(
        proposal({
          budgetType: 'SPARE_PARTS',
          contractMonths: 1,
          paymentCondition: '',
          billingFirstDueDate: '2026-12-15',
          installments: [{ number: 1, dueDate: '2026-12-15', amount: 340, paymentMethod: 'TED' }],
        })
      ),
      'Ted • 1 mensalidade • 1º vencimento 15/12/2026'
    );
  });

  it('o DTO público, a folha interna e o resumo interno usam o mesmo texto gerado', () => {
    const prod = proposal({
      paymentCondition: 'Boleto / PIX Corporativo — Vencimento dia 10',
      installments: [{ number: 1, dueDate: '2026-12-12', amount: 13240, paymentMethod: 'BOLETO' }],
    });
    const expected = 'Boleto • 1x • Vencimento 12/12/2026';
    assert.equal(toPublicProposalDto(prod).paymentCondition, expected);
    assert.equal(
      toInternalProposalSummary(prod).conditions.find((c) => c.testId === 'internal-proposal-payment')?.value,
      expected
    );

    const locacao = proposal({
      budgetType: 'LOCACAO',
      contractMonths: 6,
      paymentCondition: 'texto antigo dia 10',
      billingFirstDueDate: '2026-12-10',
      installments: [{ number: 1, dueDate: '2026-12-10', amount: 1000, paymentMethod: 'BOLETO' }],
    });
    const monthly = 'Boleto • 6 mensalidades • 1º vencimento 10/12/2026';
    assert.equal(toPublicProposalDto(locacao).paymentCondition, monthly);
    assert.equal(buildInternalProposalSheet(locacao, 'LOCACAO').paymentRows[0].method, monthly);
  });

  it('o link público, o atalho /p/ e o formulário leem o texto pelo mesmo helper', () => {
    const page = src('src/app/proposta/[id]/page.tsx');
    const short = src('src/app/p/[code]/page.tsx');
    const form = src('src/app/components/ErpEditModals.tsx');
    const pdf = src('src/app/lib/internal-proposal-pdf.ts');
    assert.match(page, /displayProposalPaymentCondition\(proposal\)/);
    assert.match(short, /PublicProposalPrintPage/);
    assert.match(form, /value=\{displayProposalPaymentCondition\(draft\)/);
    assert.match(src('src/app/lib/internal-proposal-summary.ts'), /displayProposalPaymentCondition\(proposal\)/);
    assert.match(src('src/app/lib/internal-proposal-sheet.ts'), /displayProposalPaymentCondition\(proposal\)/);
    assert.match(pdf, /printInternalProposal|InternalProposalSummaryModel/);
  });
});
