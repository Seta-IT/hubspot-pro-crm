// Troca de produto/serviço numa linha já preenchida do orçamento.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ErpCatalogItem, ErpProposalItem } from '../src/db/types';
import { replaceProposalGridItem } from '../src/app/components/ProposalItemsGrid';
import { isAutomaticFiscalDetail, proposalLineDetailsText } from '../src/app/lib/proposal-item-details';
import { computeProposalTotals } from '../src/app/lib/proposal-share';
import { buildInternalProposalSheet } from '../src/app/lib/internal-proposal-sheet';

function product(patch: Partial<ErpCatalogItem> = {}): ErpCatalogItem {
  return {
    id: 'cat-1',
    gestaoClickCode: 'WS-OLD',
    name: 'Switch antigo',
    category: 'VENDA_HARDWARE',
    fiscalNature: 'VENDA_EQUIPAMENTO',
    ncmOrLc116: 'NCM 1111.11.11',
    cfopDefault: '5.102',
    stockAvailable: 1,
    stockRentedInClients: 0,
    monthlyRentalPrice: 80,
    saleOrSetupPrice: 1000,
    isActive: true,
    unitOfMeasure: 'CX',
    ...patch,
  };
}

function line(patch: Partial<ErpProposalItem> = {}): ErpProposalItem {
  return {
    id: 'item-1',
    sku: 'WS-OLD',
    description: 'Switch antigo',
    itemType: 'PRODUCT',
    unit: 'UN',
    fiscalNature: 'VENDA_EQUIPAMENTO',
    ncmOrServiceCode: 'NCM 1111.11.11',
    quantity: 4,
    unitPrice: 1000,
    discountPercent: 10,
    discountAmount: 0,
    subtotal: 3600,
    isRecurring: false,
    totalMonthly: 3600,
    ...patch,
  };
}

describe('Troca de produto numa linha existente', () => {
  it('substitui código, descrição, NCM, unidade e preço e mantém a quantidade', () => {
    const next = product({
      id: 'cat-2',
      gestaoClickCode: '47411662',
      name: 'WS-C3850-48F-S',
      ncmOrLc116: 'NCM 8517.62.59',
      saleOrSetupPrice: 2500,
      unitOfMeasure: 'UN',
    });
    const replaced = replaceProposalGridItem(line(), next, { kind: 'PRODUCT', budgetType: 'PRODUTOS' });
    assert.equal(replaced.id, 'item-1');
    assert.equal(replaced.quantity, 4);
    assert.equal(replaced.discountPercent, 10);
    assert.equal(replaced.sku, '47411662');
    assert.equal(replaced.description, 'WS-C3850-48F-S');
    assert.equal(replaced.ncmOrServiceCode, 'NCM 8517.62.59');
    assert.equal(proposalLineDetailsText(replaced), '');
    assert.equal(replaced.lineDetails, undefined);
    assert.equal(replaced.unit, 'UN');
    assert.equal(replaced.unitPrice, 2500);
    assert.notEqual(replaced.description, 'Switch antigo');

    const totals = computeProposalTotals({
      items: [replaced],
      budgetType: 'PRODUTOS',
      shippingCost: 0,
      discountAmount: 0,
      discountPercentGlobal: 0,
    } as never);
    assert.equal(totals.items[0].quantity, 4);
    assert.equal(totals.items[0].subtotal, 9000);
    assert.equal(totals.productsSubtotal, 9000);
  });

  it('a linha de serviço troca da mesma forma e a locação usa o preço mensal', () => {
    const service = product({
      id: 'srv-2',
      gestaoClickCode: 'SRV-NOC',
      name: 'Suporte NOC 8x5',
      category: 'SERVICO_TECNICO_LC116',
      fiscalNature: 'SERVICO_TECNICO_TI_TELECOM',
      ncmOrLc116: 'LC 116/03 Item 01.07',
      monthlyRentalPrice: 450,
      saleOrSetupPrice: 0,
      unitOfMeasure: 'SV',
    });
    const current = line({
      sku: 'SRV-OLD',
      description: 'Visita avulsa',
      itemType: 'SERVICE',
      fiscalNature: 'SERVICO_TECNICO_TI_TELECOM',
      quantity: 2,
      unitPrice: 100,
      isRecurring: true,
    });
    const replaced = replaceProposalGridItem(current, service, {
      kind: 'SERVICE',
      budgetType: 'SERVICOS',
      serviceType: 'Suporte Técnico',
    });
    assert.equal(replaced.quantity, 2);
    assert.equal(replaced.sku, 'SRV-NOC');
    assert.equal(replaced.description, 'Suporte NOC 8x5');
    assert.equal(replaced.ncmOrServiceCode, 'LC 116/03 Item 01.07');
    assert.equal(replaced.unitPrice, 450);
    assert.equal((replaced as { serviceKind?: string }).serviceKind, 'Suporte Técnico');

    const rental = replaceProposalGridItem(line({ quantity: 3, isRecurring: true }), product({ monthlyRentalPrice: 120, saleOrSetupPrice: 9000 }), {
      kind: 'PRODUCT',
      budgetType: 'LOCACAO',
    });
    assert.equal(rental.quantity, 3);
    assert.equal(rental.unitPrice, 120);
    assert.equal(rental.isRecurring, true);
    assert.equal(rental.fiscalNature, 'LOCACAO_BENS_MOVEIS');
  });

  it('a linha existente usa o mesmo campo de busca; a linha vazia continua só acrescentando', () => {
    const grid = readFileSync(join(process.cwd(), 'src/app/components/ProposalItemsGrid.tsx'), 'utf8');
    const picker = readFileSync(join(process.cwd(), 'src/app/components/CatalogItemPicker.tsx'), 'utf8');
    const rowStart = grid.indexOf('rows.map(({ item, idx })');
    const emptyStart = grid.indexOf('Linha vazia sempre pronta');
    const row = grid.slice(rowStart, emptyStart);
    const empty = grid.slice(emptyStart);
    assert.match(row, /onSelectItem=/);
    assert.match(row, /replaceProposalGridItem/);
    assert.match(empty, /onAdd=\{appendItem\}/);
    assert.equal(empty.includes('onSelectItem'), false);
    assert.match(picker, /onPointerDown=\{keepOpenOnTouch\}/);
    assert.match(picker, /onSelectItem/);
    assert.match(grid, /proposalLineDetailsText\(item\)/);
    assert.match(grid, /lineDetails: e\.target\.value/);
    assert.equal(grid.includes('value={item.ncmOrServiceCode'), false);
  });

  it('Detalhes não mostra o NCM automático; o texto digitado permanece', () => {
    assert.equal(isAutomaticFiscalDetail('NCM 8517.62.59'), true);
    assert.equal(isAutomaticFiscalDetail('NCM 8517.62.14 (0% ISS — SV 31 STF)'), true);
    assert.equal(isAutomaticFiscalDetail('LC 116/03 Item 01.07'), true);
    assert.equal(isAutomaticFiscalDetail('8517.62.59'), true);
    assert.equal(isAutomaticFiscalDetail('rack 2U, cor preta'), false);

    const old = line();
    assert.equal(proposalLineDetailsText(old), '');
    assert.equal(old.ncmOrServiceCode, 'NCM 1111.11.11');

    const typed = line({ ncmOrServiceCode: 'NCM 8517.62.59', lineDetails: 'rack 2U' });
    assert.equal(proposalLineDetailsText(typed), 'rack 2U');

    const legacyNote = line({ ncmOrServiceCode: 'instalação no térreo' });
    assert.equal(proposalLineDetailsText(legacyNote), 'instalação no térreo');

    const swapped = replaceProposalGridItem(legacyNote, product({ ncmOrLc116: 'NCM 8517.62.59', gestaoClickCode: '47411662', name: 'Switch novo' }), {
      kind: 'PRODUCT',
      budgetType: 'PRODUTOS',
    });
    assert.equal(swapped.ncmOrServiceCode, 'NCM 8517.62.59');
    assert.equal(swapped.lineDetails, 'instalação no térreo');
    assert.equal(proposalLineDetailsText(swapped), 'instalação no térreo');

    const sheet = buildInternalProposalSheet({
      id: 'prop-1',
      code: '4726',
      title: 'Teste',
      budgetType: 'PRODUTOS',
      status: 'RASCUNHO',
      companyName: 'Cliente',
      items: [old, typed],
    } as never, 'PRODUTOS');
    assert.equal(sheet.lines[0].detail, '');
    assert.equal(sheet.lines[1].detail, 'rack 2U');
    assert.equal(JSON.stringify(sheet).includes('NCM 1111.11.11'), false);
    assert.equal(JSON.stringify(sheet).includes('NCM 8517.62.59'), false);
  });
});
