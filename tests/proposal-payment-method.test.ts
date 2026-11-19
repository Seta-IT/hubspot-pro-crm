import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  displayPaymentConditionText,
  isCreditCardPaymentChoice,
  proposalPaymentMethodLabel,
  proposalPaymentMethodOptions,
  selectableContractPaymentMethods,
  PROPOSAL_PAYMENT_METHOD_OPTIONS,
} from '../src/app/lib/proposal-payment-method';

const src = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('Formas de pagamento — Boleto, Pix e Ted / Transferência', () => {
  it('a lista de escolha tem exatamente as 3 opções, nesta ordem', () => {
    assert.deepEqual(
      PROPOSAL_PAYMENT_METHOD_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
      [
        { value: 'BOLETO', label: 'Boleto' },
        { value: 'PIX', label: 'Pix' },
        { value: 'TED', label: 'Ted / Transferência' },
      ]
    );
    const options = proposalPaymentMethodOptions();
    assert.equal(options.length, 3);
    assert.equal(options.some((o) => o.value === 'CARTAO_CREDITO'), false);
  });

  it('Faturamento Mensal continua disponível em orçamento de contrato, e cartão só aparece desabilitado quando já é o valor salvo', () => {
    const withBilling = proposalPaymentMethodOptions({ includeMonthlyBilling: true });
    assert.equal(withBilling.some((o) => o.value === 'FATURAMENTO_MENSAL' && !o.disabled), true);
    assert.equal(withBilling.some((o) => o.value === 'CARTAO_CREDITO'), false);

    const legacy = proposalPaymentMethodOptions({ currentValue: 'CARTAO_CREDITO' });
    const card = legacy.find((o) => o.value === 'CARTAO_CREDITO');
    assert.ok(card);
    assert.equal(card?.label, 'Cartão de Crédito');
    assert.equal(card?.disabled, true);
    assert.equal(legacy.filter((o) => !o.disabled).map((o) => o.label).join(','), 'Boleto,Pix,Ted / Transferência');
  });

  it('rótulos e resumo exibem os nomes novos, sem reescrever o código interno', () => {
    assert.equal(proposalPaymentMethodLabel('BOLETO'), 'Boleto');
    assert.equal(proposalPaymentMethodLabel('PIX'), 'Pix');
    assert.equal(proposalPaymentMethodLabel('TED'), 'Ted / Transferência');
    assert.equal(proposalPaymentMethodLabel('CARTAO_CREDITO'), 'Cartão de Crédito');
    assert.equal(proposalPaymentMethodLabel('FATURAMENTO_MENSAL'), 'Faturamento Mensal');
    assert.equal(proposalPaymentMethodLabel('Boleto'), 'Boleto');
    assert.equal(
      displayPaymentConditionText('À Vista (BOLETO) — Vencimento 2026-12-10'),
      'À Vista (Boleto) — Vencimento 2026-12-10'
    );
    assert.equal(
      displayPaymentConditionText('Parcelado em 3x (Boleto Bancário Híbrido PIX)'),
      'Parcelado em 3x (Boleto)'
    );
    assert.equal(
      displayPaymentConditionText('Parcela 1/3 (CARTAO_CREDITO)'),
      'Parcela 1/3 (Cartão de Crédito)'
    );
    assert.equal(displayPaymentConditionText('PIX Empresarial'), 'Pix');
    assert.equal(displayPaymentConditionText('TED / Transferência Bancária'), 'Ted / Transferência');
  });

  it('sugestões de contrato/fatura omitem cartão, mas preservam o valor já gravado no documento', () => {
    const methods = [
      'Boleto Inter',
      'PIX Automático Inter',
      'Transferência / TED Bancária',
      'Cartão de Crédito Recorrente',
    ];
    assert.deepEqual(selectableContractPaymentMethods(methods), [
      'Boleto Inter',
      'PIX Automático Inter',
      'Transferência / TED Bancária',
    ]);
    assert.deepEqual(selectableContractPaymentMethods(methods, 'Cartão de Crédito Recorrente'), methods);
    assert.equal(isCreditCardPaymentChoice('CARTAO_CREDITO'), true);
    assert.equal(isCreditCardPaymentChoice('Cartão de Crédito'), true);
    assert.equal(isCreditCardPaymentChoice('Boleto Inter'), false);
  });

  it('orçamento e proposta pública não oferecem cartão; o PDV permanece intocado', () => {
    const modal = src('src/app/components/ErpEditModals.tsx');
    const page = src('src/app/proposta/[id]/page.tsx');
    const contract = src('src/app/lib/contract-billing-utils.ts');
    const pdv = src('src/app/components/SetaErpTenPillarsAndPdv.tsx');
    const dto = src('src/app/lib/proposal-public-dto.ts');

    assert.ok(modal.includes('proposalPaymentMethodOptions'));
    assert.equal(modal.includes("value: 'CARTAO_CREDITO'"), false);
    assert.equal(modal.includes('Cartão de Crédito'), false);
    assert.ok(page.includes('proposalPaymentMethodLabel'));
    assert.equal(page.includes('CreditCard'), false);
    assert.ok(dto.includes('proposalPaymentMethodLabel'));
    assert.equal(contract.includes('Cartão de Crédito Recorrente'), false);
    assert.ok(contract.includes('por boleto, Pix ou Ted / Transferência'));
    assert.ok(pdv.includes("{ id: 'CARTAO', label: 'Cartão Crédito / Débito'"));
  });
});
