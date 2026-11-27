import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ErpCatalogItem, ErpProposalItem } from '../src/db/types';
import { computeProposalTotals } from '../src/app/lib/proposal-share';
import {
  catalogPriceForTable,
  catalogPriceTables,
  formatPtBrDecimal,
  formatPtBrMoney,
  inferPriceTableId,
  lineNetAmount,
  looksLikeFiscalCode,
  parsePtBrDecimal,
  priceTablesFromGcValores,
  proposalItemDetails,
  resolveDiscountType,
  PRICE_TABLE_ATACADO,
  PRICE_TABLE_VAREJO,
} from '../src/app/lib/proposal-item-grid';
import { applyBudgetTypeToItems } from '../src/app/components/ProposalItemsGrid';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const catalogItem: ErpCatalogItem = {
  id: 'cat-1',
  gestaoClickCode: 'AP-C3850',
  name: 'Access Point C3850',
  category: 'VENDA_HARDWARE',
  fiscalNature: 'VENDA_EQUIPAMENTO',
  ncmOrLc116: 'NCM 8517.62.59',
  cfopDefault: '5.102',
  stockAvailable: 10,
  stockRentedInClients: 0,
  monthlyRentalPrice: 80,
  saleOrSetupPrice: 325,
  wholesalePrice: 280,
  isActive: true,
};

describe('Grade de produtos do orçamento (padrão GestãoClick)', () => {
  it('formata e lê números em pt-BR com duas casas', () => {
    assert.equal(formatPtBrDecimal(1625, 2), '1.625,00');
    assert.equal(formatPtBrDecimal(325, 2), '325,00');
    assert.equal(formatPtBrDecimal(5, 2), '5,00');
    assert.equal(formatPtBrMoney(3250), 'R$ 3.250,00');
    assert.equal(parsePtBrDecimal('1.625,00'), 1625);
    assert.equal(parsePtBrDecimal('325,00'), 325);
    assert.equal(parsePtBrDecimal('5,00'), 5);
    assert.equal(parsePtBrDecimal('3645'), 3645);
  });

  it('Detalhes é campo livre e não exibe NCM preenchido automaticamente', () => {
    assert.equal(looksLikeFiscalCode('NCM 8517.62.59'), true);
    assert.equal(looksLikeFiscalCode('8517.62.59'), true);
    assert.equal(looksLikeFiscalCode('LC 116/03 Item 01.07'), true);
    assert.equal(looksLikeFiscalCode('Cor branca, 5 unidades'), false);
    assert.equal(proposalItemDetails({ ncmOrServiceCode: 'NCM 8517.62.59' }), '');
    assert.equal(proposalItemDetails({ details: 'Cabo incluso', ncmOrServiceCode: 'NCM 8517.62.59' }), 'Cabo incluso');
    assert.equal(proposalItemDetails({ ncmOrServiceCode: 'Referência do cliente' }), 'Referência do cliente');
  });

  it('Varejo e Atacado puxam o preço certo do catálogo', () => {
    const tables = catalogPriceTables(catalogItem, false);
    assert.deepEqual(
      tables.map((t) => ({ id: t.id, name: t.name, price: t.price })),
      [
        { id: PRICE_TABLE_VAREJO, name: 'Varejo', price: 325 },
        { id: PRICE_TABLE_ATACADO, name: 'Atacado', price: 280 },
      ]
    );
    assert.equal(catalogPriceForTable(catalogItem, 'VAREJO', 'PRODUCT', false), 325);
    assert.equal(catalogPriceForTable(catalogItem, 'ATACADO', 'PRODUCT', false), 280);
    assert.equal(inferPriceTableId({ unitPrice: 280 }, catalogItem, false), PRICE_TABLE_ATACADO);
    assert.equal(inferPriceTableId({ unitPrice: 325 }, catalogItem, false), PRICE_TABLE_VAREJO);
    assert.equal(
      catalogPriceForTable(catalogItem, 'VAREJO', 'PRODUCT', true),
      80,
      'na locação o Varejo usa o preço mensal'
    );
  });

  it('aceita as tabelas valores[] do GestãoClick', () => {
    const tables = priceTablesFromGcValores([
      { tipo_id: '1', nome_tipo: 'Varejo', valor_venda: 325 },
      { tipo_id: '2', nome_tipo: 'Atacado', valor_venda: 280 },
    ]);
    assert.equal(tables.length, 2);
    assert.equal(tables[0].name, 'Varejo');
    assert.equal(tables[1].price, 280);
    const item: ErpCatalogItem = { ...catalogItem, priceTables: tables };
    assert.equal(catalogPriceForTable(item, '2', 'PRODUCT', false), 280);
  });

  it('calcula o subtotal da linha com desconto em R$ ou % (5 × 325 = 1.625)', () => {
    assert.equal(lineNetAmount({ quantity: 5, unitPrice: 325 }), 1625);
    assert.equal(lineNetAmount({ quantity: 5, unitPrice: 325, discountPercent: 10 }), 1462.5);
    assert.equal(lineNetAmount({ quantity: 5, unitPrice: 325, discountAmount: 25 }), 1600);
    assert.equal(resolveDiscountType({ discountPercent: 10 }), 'PERCENT');
    assert.equal(resolveDiscountType({ discountAmount: 25, discountType: 'BRL' }), 'BRL');
  });

  it('computeProposalTotals soma o total de produtos com o mesmo cálculo', () => {
    const items: ErpProposalItem[] = [
      {
        id: 'i1',
        sku: 'AP-C3850',
        description: 'Access Point C3850',
        itemType: 'PRODUCT',
        fiscalNature: 'VENDA_EQUIPAMENTO',
        ncmOrServiceCode: 'NCM 8517.62.59',
        details: '',
        priceTableId: 'VAREJO',
        priceTableName: 'Varejo',
        quantity: 5,
        unitPrice: 325,
        discountPercent: 0,
        discountAmount: 0,
        isRecurring: false,
        totalMonthly: 0,
      },
      {
        id: 'i2',
        sku: 'AP-C3850',
        description: 'Access Point C3850',
        itemType: 'PRODUCT',
        fiscalNature: 'VENDA_EQUIPAMENTO',
        ncmOrServiceCode: '',
        quantity: 5,
        unitPrice: 325,
        discountPercent: 0,
        isRecurring: false,
        totalMonthly: 0,
      },
    ];
    const totals = computeProposalTotals({
      id: 'p1',
      code: '4728',
      title: 'Orçamento',
      budgetType: 'PRODUTOS',
      companyName: 'EVAMIND',
      companyCnpj: '00.000.000/0001-00',
      status: 'RASCUNHO',
      contractMonths: 1,
      monthlyRecurringTotal: 0,
      setupFee: 0,
      oneTimeSetupTotal: 0,
      totalContractValue: 0,
      shippingCost: 0,
      items,
    } as never);
    assert.equal(totals.productsSubtotal, 3250);
    assert.equal(totals.items[0].subtotal, 1625);
    assert.equal(formatPtBrMoney(totals.productsSubtotal || 0), 'R$ 3.250,00');
  });

  it('ao trocar o tipo de orçamento, o preço de catálogo respeita a tabela da linha', () => {
    const item: ErpProposalItem = {
      id: 'i1',
      sku: 'AP-C3850',
      description: 'Access Point C3850',
      itemType: 'PRODUCT',
      fiscalNature: 'VENDA_EQUIPAMENTO',
      ncmOrServiceCode: '',
      priceTableId: 'VAREJO',
      quantity: 1,
      unitPrice: 325,
      discountPercent: 0,
      isRecurring: false,
      totalMonthly: 325,
    };
    const next = applyBudgetTypeToItems([item], 'LOCACAO', undefined, [catalogItem]);
    assert.equal(next[0].fiscalNature, 'LOCACAO_BENS_MOVEIS');
    assert.equal(next[0].isRecurring, true);
    assert.equal(next[0].unitPrice, 80, 'Varejo na locação passa a usar o preço mensal');
  });

  it('a grade de produtos e a de serviços seguem o layout do GestãoClick', () => {
    const grid = src('src/app/components/ProposalItemsGrid.tsx');
    assert.ok(grid.includes('Adicione os produtos do orçamento'));
    assert.ok(grid.includes('Adicione os serviços do orçamento'));
    assert.ok(grid.includes('quantidade, valor e desconto por linha.'));
    assert.ok(grid.includes('Adicionar {nounSingular}'));
    assert.ok(grid.includes('Total de {noun}'));
    assert.ok(grid.includes('Tipo<span className="text-rose-600">*</span>'));
    assert.ok(grid.includes('tabela de preço'));
    assert.ok(grid.includes('Desconto em %'));
    assert.ok(grid.includes('Desconto em reais'));
    assert.ok(grid.includes('Editar produto'));
    assert.ok(grid.includes('title="Excluir"'));
    assert.ok(grid.includes('Limpar produto'));
    assert.ok(grid.includes('formatPtBrDecimal'));
    assert.ok(grid.includes('bg-white'));
    assert.ok(grid.includes('Digite ou cole o produto'));
    // A linha vazia acinzentada com campos desabilitados não volta.
    assert.equal(grid.includes('opacity-70'), false);
    assert.equal(grid.includes('disabled placeholder="Detalhes"'), false);
    assert.equal(grid.includes("isProduct ? 'Produtos' : 'Serviços'"), false);
    assert.equal(grid.includes("placeholder=\"0,00 ou %\""), false);
  });
});
