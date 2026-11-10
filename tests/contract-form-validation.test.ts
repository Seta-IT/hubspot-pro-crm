import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  countValidContractProducts,
  isValidContractProduct,
  validateRentalContractForm,
} from '../src/modules/erp/contract-form-validation';
import { filterCatalogProducts } from '../src/app/components/CatalogProductCombobox';
import { computeFixedMenuPosition } from '../src/app/components/FixedPortalMenu';
import type { ErpCatalogItem } from '../src/db/types';

const validEq = {
  skuGestaoClick: 'GC-EQ-001',
  description: 'Roteador',
  quantity: 2,
  unitMonthlyRent: 375,
};

const baseDraft = {
  title: 'Contrato Nubank',
  companyName: 'Nubank',
  startDate: '2026-01-01',
  endDate: '2027-12-31',
  dueDay: 10,
  paymentMethod: 'Boleto Inter',
  emailAutomationMode: 'Enviar lembrete de pagamento e boleto',
  nextBillingDate: '2026-12-10',
  equipments: [validEq],
};

describe('Validação do contrato de locação', () => {
  it('aceita um contrato com pelo menos um produto válido', () => {
    const result = validateRentalContractForm(baseDraft);
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
    assert.equal(countValidContractProducts(baseDraft.equipments), 1);
  });

  it('bloqueia salvar sem nenhum produto e aponta a aba Produtos', () => {
    const result = validateRentalContractForm({ ...baseDraft, equipments: [] });
    assert.equal(result.ok, false);
    assert.equal(result.banner, 'Adicione pelo menos um produto.');
    assert.equal(result.firstTab, 'PRODUTOS');
    assert.ok(result.errors.some((e) => e.field === 'equipments' && e.tab === 'PRODUTOS'));
  });

  it('ignora linha vazia e ainda exige um produto válido', () => {
    const result = validateRentalContractForm({
      ...baseDraft,
      equipments: [{ skuGestaoClick: '', description: '', quantity: 0, unitMonthlyRent: 0 }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.banner, 'Adicione pelo menos um produto.');
    assert.equal(isValidContractProduct({ description: '', quantity: 1, unitMonthlyRent: 10 }), false);
  });

  it('rejeita quantidade <= 0 e preço negativo no produto nomeado', () => {
    const qty = validateRentalContractForm({
      ...baseDraft,
      equipments: [{ ...validEq, quantity: 0 }],
    });
    assert.equal(qty.ok, false);
    assert.ok(qty.errors.some((e) => e.field === 'equipments.0.quantity'));
    assert.equal(qty.firstTab, 'PRODUTOS');

    const price = validateRentalContractForm({
      ...baseDraft,
      equipments: [{ ...validEq, unitMonthlyRent: -1 }],
    });
    assert.equal(price.ok, false);
    assert.ok(price.errors.some((e) => e.field === 'equipments.0.unitMonthlyRent'));
  });

  it('valida nome, cliente, vigência, vencimento e medição', () => {
    const empty = validateRentalContractForm({
      title: '  ',
      companyName: '',
      startDate: '2026-12-01',
      endDate: '2026-01-01',
      dueDay: 40,
      paymentMethod: '',
      emailAutomationMode: '',
      nextBillingDate: '',
      measurementNumber: 'BM-10/2026',
      measurementPeriod: '',
      equipments: [validEq],
    });
    assert.equal(empty.ok, false);
    const fields = empty.errors.map((e) => e.field);
    assert.ok(fields.includes('title'));
    assert.ok(fields.includes('companyName'));
    assert.ok(fields.includes('endDate'));
    assert.ok(fields.includes('dueDay'));
    assert.ok(fields.includes('paymentMethod'));
    assert.ok(fields.includes('emailAutomationMode'));
    assert.ok(fields.includes('nextBillingDate'));
    assert.ok(fields.includes('measurementPeriod'));
    assert.equal(
      empty.errors.find((e) => e.field === 'endDate')?.tab,
      'DADOS_GERAIS'
    );
    assert.equal(
      empty.errors.find((e) => e.field === 'dueDay')?.tab,
      'FATURAMENTO_RECIBOS'
    );
  });
});

describe('Busca de produtos semelhantes no catálogo', () => {
  const catalog = [
    {
      id: '1',
      gestaoClickCode: 'WS-C3850',
      name: 'Switch Cisco Locação',
      category: 'EQUIPAMENTO_LOCACAO',
      fiscalNature: 'LOCACAO_BENS_MOVEIS',
      ncmOrLc116: '8517.62.59',
      cfopDefault: '5.908',
      stockAvailable: 4,
      stockRentedInClients: 2,
      monthlyRentalPrice: 375,
      saleOrSetupPrice: 9000,
      isActive: true,
    },
    {
      id: '2',
      gestaoClickCode: 'FGT-100F',
      name: 'Fortigate 100F',
      category: 'EQUIPAMENTO_LOCACAO',
      fiscalNature: 'LOCACAO_BENS_MOVEIS',
      ncmOrLc116: '8517.62.59',
      cfopDefault: '5.908',
      stockAvailable: 1,
      stockRentedInClients: 0,
      monthlyRentalPrice: 890,
      saleOrSetupPrice: 0,
      isActive: true,
    },
    {
      id: '3',
      gestaoClickCode: 'INATIVO',
      name: 'Aparelho Inativo',
      category: 'EQUIPAMENTO_LOCACAO',
      fiscalNature: 'LOCACAO_BENS_MOVEIS',
      ncmOrLc116: '8517.62.59',
      cfopDefault: '5.908',
      stockAvailable: 0,
      stockRentedInClients: 0,
      monthlyRentalPrice: 10,
      saleOrSetupPrice: 0,
      isActive: false,
    },
  ] as ErpCatalogItem[];

  it('busca por nome ou código, sem acento e sem diferenciar maiúsculas, e limita a 10', () => {
    const byName = filterCatalogProducts(catalog, 'LOCACAO');
    assert.equal(byName.length, 1);
    assert.equal(byName[0].gestaoClickCode, 'WS-C3850');

    const byCode = filterCatalogProducts(catalog, 'fgt');
    assert.equal(byCode[0].name, 'Fortigate 100F');

    const none = filterCatalogProducts(catalog, 'xyz-nao-existe');
    assert.equal(none.length, 0);

    const inactive = filterCatalogProducts(catalog, 'inativo');
    assert.equal(inactive.length, 0);
  });
});



describe('Menu ⋮ em portal com posição fixed', () => {
  it('abre para baixo quando há espaço e alinha à direita do botão, com largura mínima', () => {
    const pos = computeFixedMenuPosition(
      { top: 80, bottom: 108, left: 1000, right: 1028 },
      { width: 240, estimatedHeight: 320, viewportWidth: 1280, viewportHeight: 800 }
    );
    assert.equal(pos.openUp, false);
    assert.equal(pos.width, 240);
    assert.ok(pos.left <= 1028 - 240 || pos.left === 8);
    assert.ok(pos.top >= 108);
  });

  it('abre para cima quando não há espaço embaixo', () => {
    const pos = computeFixedMenuPosition(
      { top: 740, bottom: 768, left: 1200, right: 1272 },
      { width: 240, estimatedHeight: 360, viewportWidth: 1280, viewportHeight: 800 }
    );
    assert.equal(pos.openUp, true);
    assert.ok(pos.top + pos.maxHeight <= 740 + 1);
    assert.ok(pos.left + pos.width <= 1280);
  });
});

describe('Centro de custo e Plano de contas editáveis', () => {
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

  it('o cadastro auxiliar edita registros existentes com chave estável (sem remount ao digitar)', () => {
    const src = read('src/app/components/ContractBillingPanels.tsx');
    assert.equal(src.includes('key={`${item}-${idx}`}'), false);
    assert.ok(src.includes('key={`${l.key}-${idx}`}'));
    assert.ok(src.includes('data-testid={`aux-list-${l.key}`}'));
  });

  it('proposta e contrato têm campo editável de Plano de contas, e o PATCH da proposta persiste o valor', () => {
    const modal = read('src/app/components/ErpEditModals.tsx');
    assert.ok(modal.includes('data-testid="proposal-chart-of-accounts"'));
    assert.ok(modal.includes('data-testid="contract-chart-of-accounts"'));
    assert.ok(modal.includes("updateDraft({ chartOfAccounts: e.target.value })"));
    assert.ok(modal.includes("setDraft({ ...draft, chartOfAccounts: e.target.value })"));
    const router = read('src/api/router.ts');
    assert.ok(router.includes("'costCenter', 'chartOfAccounts',"));
    const types = read('src/db/types.ts');
    assert.ok(types.includes('chartOfAccounts?: string;'));
  });
});
