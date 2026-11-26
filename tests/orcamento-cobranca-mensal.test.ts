import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  displayProposalPaymentCondition,
  formatMonthlyPaymentCondition,
  isMonthlyBillingBudgetType,
} from '../src/app/lib/proposal-monthly-billing';
import { toPublicProposalDto } from '../src/app/lib/proposal-public-dto';
import { toInternalProposalSummary } from '../src/app/lib/internal-proposal-summary';
import { buildInternalProposalSheet } from '../src/app/lib/internal-proposal-sheet';
import type { ErpCommercialProposal } from '../src/db/types';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

function proposalEditorSource(): string {
  const form = src('src/app/components/ErpEditModals.tsx');
  const start = form.indexOf('export function ProposalEditModal');
  const end = form.indexOf('export function ContractEditModal');
  return form.slice(start, end);
}

function proposal(patch: Partial<ErpCommercialProposal>): ErpCommercialProposal {
  return {
    id: 'prop-mensal',
    code: '4801',
    title: 'Locação',
    budgetType: 'LOCACAO',
    companyName: 'Cliente Mensal',
    status: 'ENVIADA',
    contractMonths: 6,
    paymentCondition: 'a_vista',
    monthlyRecurringTotal: 1000,
    oneTimeSetupTotal: 0,
    totalContractValue: 6000,
    items: [],
    createdAt: '2026-11-26T00:00:00.000Z',
    updatedAt: '2026-11-26T00:00:00.000Z',
    ...patch,
  } as ErpCommercialProposal;
}

describe('Cobrança mensal em locação, serviço e spare parts', () => {
  it('reconhece locação, serviço e o tipo próprio Spare Parts, e não produtos', () => {
    assert.equal(isMonthlyBillingBudgetType('LOCACAO'), true);
    assert.equal(isMonthlyBillingBudgetType('SERVICOS'), true);
    assert.equal(isMonthlyBillingBudgetType('SPARE_PARTS'), true);
    assert.equal(isMonthlyBillingBudgetType('PRODUTOS'), false);
    assert.equal(isMonthlyBillingBudgetType('CONJUNTO'), false);
  });

  it('monta o resumo em português e nunca devolve a_vista cru', () => {
    assert.equal(
      formatMonthlyPaymentCondition({
        contractMonths: 6,
        paymentMethod: 'BOLETO',
        billingDueRule: 'EVERY_30_DAYS',
      }),
      'Mensal • 6 meses • Boleto • vencimento a cada 30 dias'
    );
    assert.equal(
      formatMonthlyPaymentCondition({
        contractMonths: 1,
        paymentMethod: 'PIX',
        billingDueRule: 'FIXED_DAY',
        billingDueDay: 10,
      }),
      'Mensal • 1 mês • Pix • vencimento no dia 10'
    );
    assert.equal(
      formatMonthlyPaymentCondition({
        contractMonths: 12,
        paymentMethod: 'TED',
        billingDueRule: 'EVERY_30_DAYS',
      }),
      'Mensal • 12 meses • Ted • vencimento a cada 30 dias'
    );

    assert.equal(displayProposalPaymentCondition(proposal({ paymentCondition: 'a_vista' })), 'À vista');
    assert.equal(
      displayProposalPaymentCondition(
        proposal({
          paymentCondition: 'a_vista',
          billingDueRule: 'EVERY_30_DAYS',
        })
      ),
      'Mensal • 6 meses • Boleto • vencimento a cada 30 dias'
    );
    assert.equal(
      displayProposalPaymentCondition(
        proposal({
          paymentCondition: 'Boleto 15 dias',
          billingDueRule: 'EVERY_30_DAYS',
        })
      ),
      'Boleto 15 dias'
    );
  });

  it('o formulário esconde parcelas nesses tipos e mantém o bloco de parcelas em produtos', () => {
    const editor = proposalEditorSource();
    const monthlyStart = editor.indexOf('data-testid="proposal-monthly-billing"');
    const parcelsStart = editor.indexOf('Parcelas e vencimentos');
    assert.ok(monthlyStart > 0);
    assert.ok(parcelsStart > monthlyStart);
    const monthly = editor.slice(monthlyStart, parcelsStart);
    assert.match(monthly, /Cobrança mensal/);
    assert.match(monthly, /Forma de Pagamento/);
    assert.match(monthly, /1º Vencimento/);
    assert.match(monthly, /Vencimento das mensalidades/);
    assert.match(monthly, /A cada 30 dias/);
    assert.match(monthly, /Dia fixo/);
    assert.match(monthly, /Dia do mês/);
    assert.match(monthly, /Resumo da Condição de Pagamento/);
    assert.doesNotMatch(monthly, /Nº Parcelas/);
    assert.doesNotMatch(monthly, /Gerar Parcelas/);
    assert.doesNotMatch(monthly, /À Vista/);
    assert.doesNotMatch(monthly, /includeMonthlyBilling/);

    const parcels = editor.slice(parcelsStart);
    assert.match(parcels, /Nº Parcelas/);
    assert.match(parcels, /À Vista/);
    assert.match(parcels, /36x/);
    assert.match(parcels, /Gerar Parcelas/);
    assert.match(editor, /buildProposalInstallments\(draft/);
  });

  it('o link público, o DTO e a folha interna usam o texto legível e não listam parcelas nesses tipos', () => {
    const page = src('src/app/proposta/[id]/page.tsx');
    assert.match(page, /displayProposalPaymentCondition\(proposal\)/);
    assert.match(page, /!isMonthlyBillingBudgetType\(proposal\.budgetType\) && Array\.isArray\(proposal\.installments\)/);

    const withInstallments = proposal({
      paymentCondition: 'a_vista',
      billingDueRule: 'EVERY_30_DAYS',
      installments: [
        { number: 1, dueDate: '2026-12-10', amount: 1000, paymentMethod: 'BOLETO' },
        { number: 2, dueDate: '2027-01-10', amount: 1000, paymentMethod: 'BOLETO' },
      ],
    });
    const dto = toPublicProposalDto(withInstallments);
    assert.equal(dto.installments.length, 0);
    assert.equal(dto.paymentCondition, 'Mensal • 6 meses • Boleto • vencimento a cada 30 dias');
    assert.equal(dto.paymentCondition.includes('a_vista'), false);

    const produtos = toPublicProposalDto(
      proposal({
        budgetType: 'PRODUTOS',
        paymentCondition: 'Parcelado em 2x',
        installments: [
          { number: 1, dueDate: '2026-12-10', amount: 500, paymentMethod: 'BOLETO' },
          { number: 2, dueDate: '2027-01-10', amount: 500, paymentMethod: 'BOLETO' },
        ],
      })
    );
    assert.equal(produtos.installments.length, 2);
    assert.equal(produtos.paymentCondition, 'Parcelado em 2x');

    const summary = toInternalProposalSummary(withInstallments);
    const payment = summary.conditions.find((c) => c.testId === 'internal-proposal-payment');
    assert.equal(payment?.value, 'Mensal • 6 meses • Boleto • vencimento a cada 30 dias');
    assert.equal(String(payment?.value || '').includes('a_vista'), false);

    const sheet = buildInternalProposalSheet(withInstallments, 'LOCACAO');
    assert.equal(sheet.paymentRows.length >= 1, true);
    assert.equal(sheet.paymentRows[0].method, 'Mensal • 6 meses • Boleto • vencimento a cada 30 dias');
    assert.equal(sheet.paymentRows.some((row) => /parcela 2/i.test(row.note + row.due)), false);
  });

  it('serviço e spare parts também entram na cobrança mensal, e o allowlist grava a regra', () => {
    const servico = displayProposalPaymentCondition(
      proposal({
        budgetType: 'SERVICOS',
        serviceType: 'Spare Parts / Hard Parts',
        contractMonths: 12,
        paymentCondition: '',
        billingDueRule: 'FIXED_DAY',
        billingDueDay: 15,
        installments: [{ number: 1, dueDate: '2026-12-15', amount: 200, paymentMethod: 'PIX' }],
      })
    );
    assert.equal(servico, 'Mensal • 12 meses • Pix • vencimento no dia 15');

    const pecas = displayProposalPaymentCondition(
      proposal({
        budgetType: 'SPARE_PARTS',
        contractMonths: 1,
        paymentCondition: '',
        billingDueRule: 'EVERY_30_DAYS',
        installments: [{ number: 1, dueDate: '2026-12-15', amount: 340, paymentMethod: 'TED' }],
      })
    );
    assert.equal(pecas, 'Mensal • 1 mês • Ted • vencimento a cada 30 dias');

    const router = src('src/api/router.ts');
    assert.match(router, /'billingDueRule', 'billingDueDay', 'billingFirstDueDate'/);
  });
});
