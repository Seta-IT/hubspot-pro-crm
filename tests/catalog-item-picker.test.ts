import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createSeedErpState } from '../src/modules/erp/erp-seed';
import {
  buildContractEquipmentFromCatalog,
  catalogPriceFor,
  catalogRentalPrice,
  compactQuery,
  filterCatalogProducts,
  isServiceCatalogItem,
} from '../src/app/lib/catalog-search';
import type { ErpCatalogItem } from '../src/db/types';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const seedCatalog: ErpCatalogItem[] = createSeedErpState().catalog;
const productPool = seedCatalog.filter((c) => c.isActive !== false && !isServiceCatalogItem(c));

const extra: ErpCatalogItem[] = [
  {
    ...(seedCatalog[0] as ErpCatalogItem),
    id: 'cat-x-c9200',
    gestaoClickCode: 'C9200L-24P-4G-E',
    name: 'Switch Catalyst 9200L 24 portas PoE+',
    brand: 'Cisco',
    modelName: 'Catalyst 9200L',
    isActive: true,
  },
  {
    ...(seedCatalog[0] as ErpCatalogItem),
    id: 'cat-x-mikrotik',
    gestaoClickCode: 'RB4011IGS+RM',
    name: 'Roteador MikroTik RB4011',
    brand: 'MikroTik',
    modelName: 'RB4011',
    isActive: true,
  },
];

describe('Campo de produtos compartilhado entre orçamento e contrato', () => {
  it('"c3850" acha o WS-C3850-48F-S no catálogo semente', () => {
    const hits = filterCatalogProducts(productPool, 'c3850', 8);
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].gestaoClickCode, 'WS-C3850-48F-S');
  });

  it('busca no código ignora separadores e maiúsculas', () => {
    for (const q of ['C3850', 'wsc3850', 'ws c3850', 'WS-C3850-48F', 'c3850 48f', 'c3850-48fs']) {
      const hits = filterCatalogProducts(productPool, q, 8);
      assert.ok(hits.some((c) => c.gestaoClickCode === 'WS-C3850-48F-S'), `"${q}" deveria achar WS-C3850-48F-S`);
    }
    assert.equal(compactQuery('WS-C3850-48F-S'), 'wsc385048fs');
  });

  it('"cisco" acha os itens Cisco pela marca e pelo nome, e não traz serviços na aba Produtos', () => {
    const pool = [...productPool, ...extra];
    const hits = filterCatalogProducts(pool, 'cisco', 50);
    assert.ok(hits.some((c) => c.gestaoClickCode === 'C9200L-24P-4G-E'));
    assert.equal(hits.some((c) => c.gestaoClickCode === 'RB4011IGS+RM'), false);
    assert.equal(hits.some((c) => isServiceCatalogItem(c)), false);
    for (const c of hits) {
      const hay = `${c.name} ${c.brand} ${c.modelName} ${c.gestaoClickCode}`.toLowerCase();
      assert.ok(hay.includes('cisco'), `${c.gestaoClickCode} não parece Cisco`);
    }
  });

  it('código que começa com a busca vem primeiro', () => {
    const pool = [...extra, ...productPool];
    const hits = filterCatalogProducts(pool, 'c9200', 8);
    assert.equal(hits[0].gestaoClickCode, 'C9200L-24P-4G-E');
  });

  it('contrato e orçamento dão o mesmo resultado para "c3850" e "cisco"', () => {
    for (const q of ['c3850', 'cisco']) {
      const contract = filterCatalogProducts(productPool, q, 8).map((c) => c.gestaoClickCode);
      const quote = filterCatalogProducts(productPool, q, 8).map((c) => c.gestaoClickCode);
      assert.deepEqual(contract, quote);
      assert.ok(contract.length >= 1, `"${q}" sem resultado`);
    }
  });

  it('adicionar pelo campo preenche código, nome e valor mensal igual ao orçamento de locação', () => {
    const sw = productPool.find((c) => c.gestaoClickCode === 'WS-C3850-48F-S')!;
    const eq = buildContractEquipmentFromCatalog(sw, 'c3850', { remessaCfop: '6.908' });
    assert.equal(eq.skuGestaoClick, 'WS-C3850-48F-S');
    assert.equal(eq.description, sw.name);
    assert.equal(eq.quantity, 1);
    assert.equal(eq.unitMonthlyRent, catalogRentalPrice(sw));
    assert.equal(eq.unitMonthlyRent, catalogPriceFor(sw, 'PRODUCT', true));
    assert.equal(eq.remessaCfop, '6.908');
    assert.match(eq.ncm, /^\d{4}\.\d{2}\.\d{2}$/);

    const free = buildContractEquipmentFromCatalog(null, '  Item avulso  ');
    assert.equal(free.skuGestaoClick, '');
    assert.equal(free.description, 'Item avulso');
    assert.equal(free.unitMonthlyRent, 0);
  });

  it('orçamento e contrato renderizam o mesmo componente CatalogItemPicker', () => {
    const grid = read('src/app/components/ProposalItemsGrid.tsx');
    const modal = read('src/app/components/ErpEditModals.tsx');
    assert.ok(grid.includes("from './CatalogItemPicker'"));
    assert.ok(grid.includes('<CatalogItemPicker'));
    assert.ok(modal.includes("from './CatalogItemPicker'"));
    const tabStart = modal.indexOf('data-testid="contract-products-tab"');
    const tabEnd = modal.indexOf("activeTab === 'DOCUMENTO_HISTORICO'", tabStart);
    const tab = modal.slice(tabStart, tabEnd);
    assert.ok(tab.includes('<CatalogItemPicker'));
    assert.ok(tab.includes('buildContractEquipmentFromCatalog('));
    assert.ok(tab.includes('S/N') && tab.includes('Qtd.') && tab.includes('Valor mensal'));
    assert.ok(tab.includes('setProductToDeleteIdx(idx)'), 'excluir continua pedindo confirmação');
    assert.equal(fs.existsSync(path.join(process.cwd(), 'src/app/components/CatalogProductCombobox.tsx')), false);
    assert.equal(/CatalogProductCombobox/.test(modal + grid), false);
  });

  it('o modal do contrato recebe o mesmo catálogo do orçamento (dados do ERP)', () => {
    const tab = read('src/app/components/ErpGestaoClickTab.tsx');
    const start = tab.indexOf('<ContractEditModal');
    assert.ok(tab.slice(start, tab.indexOf('/>', start)).includes('catalog={catalog}'));
    const picker = read('src/app/components/CatalogItemPicker.tsx');
    assert.ok(picker.includes('Adicionar novo'));
    assert.ok(picker.includes("e.key === 'Enter'"));
  });
});
