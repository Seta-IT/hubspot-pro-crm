import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ErpCatalogItem } from '../src/db/types';
import { findExactCatalogMatch, catalogItemLabel } from '../src/app/lib/catalog-search';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const dell: ErpCatalogItem = {
  id: 'cat-dell',
  gestaoClickCode: '90943156',
  name: 'Dell PowerEdge 2x Gold 6152 22-Core 2.1GHz',
  category: 'VENDA_HARDWARE',
  fiscalNature: 'VENDA_EQUIPAMENTO',
  ncmOrLc116: 'NCM 8471.50.10',
  cfopDefault: '5.102',
  stockAvailable: 2,
  stockRentedInClients: 0,
  monthlyRentalPrice: 400,
  saleOrSetupPrice: 3645,
  isActive: true,
};

const switchCat: ErpCatalogItem = {
  ...dell,
  id: 'cat-sw',
  gestaoClickCode: 'WS-C3850-48F-S',
  name: 'Switch Cisco Catalyst 3850 48 portas',
  saleOrSetupPrice: 8500,
};

const catalog = [dell, switchCat];

describe('Colar produto na grade do orçamento', () => {
  it('casa o texto colado com o item do catálogo pelo código, pelo nome ou pelo rótulo "código - nome"', () => {
    assert.equal(findExactCatalogMatch(catalog, '90943156')?.id, 'cat-dell');
    assert.equal(findExactCatalogMatch(catalog, '90943.156')?.id, 'cat-dell');
    assert.equal(
      findExactCatalogMatch(catalog, 'Dell PowerEdge 2x Gold 6152 22-Core 2.1GHz')?.id,
      'cat-dell'
    );
    assert.equal(
      findExactCatalogMatch(catalog, catalogItemLabel(dell))?.id,
      'cat-dell'
    );
    assert.equal(
      findExactCatalogMatch(catalog, '90943156 - Dell PowerEdge 2x Gold 6152...')?.id,
      'cat-dell',
      'rótulo truncado com reticências (copiar da linha de cima) ainda casa pelo código'
    );
    assert.equal(findExactCatalogMatch(catalog, 'WS-C3850-48F-S')?.id, 'cat-sw');
    assert.equal(findExactCatalogMatch(catalog, 'produto que não existe'), null);
    assert.equal(findExactCatalogMatch(catalog, '90'), null, 'código curto demais não casa sozinho');
  });

  it('o campo de produto seleciona automaticamente no colar e não trava a linha', () => {
    const picker = src('src/app/components/CatalogItemPicker.tsx');
    const grid = src('src/app/components/ProposalItemsGrid.tsx');
    assert.ok(picker.includes('findExactCatalogMatch'));
    assert.ok(picker.includes('onPaste'));
    assert.ok(picker.includes('autoSelectIfExact'));
    assert.ok(grid.includes('proposal-grid-${noun}-draft'));
    assert.ok(grid.includes('draft-details'));
    assert.ok(grid.includes('startAddRow'));
    assert.ok(grid.includes('Digite ou cole o produto'));
    assert.equal(grid.includes('disabled placeholder="Detalhes"'), false);
    assert.equal(grid.includes('opacity-70'), false);
  });

  it('todas as telas de edição de orçamento/proposta usam a ProposalItemsGrid nova', () => {
    const modal = src('src/app/components/ErpEditModals.tsx');
    const tab = src('src/app/components/ErpGestaoClickTab.tsx');
    const page = src('src/app/proposta/[id]/page.tsx');
    const grid = src('src/app/components/ProposalItemsGrid.tsx');
    assert.ok(modal.includes('<ProposalItemsGrid'));
    assert.ok(modal.includes('kind="PRODUCT"') && modal.includes('kind="SERVICE"'));
    assert.ok(tab.includes('<ProposalEditModal'));
    assert.ok(page.includes('<ProposalEditModal'));
    assert.ok(grid.includes('Adicione os produtos do orçamento'));
    assert.ok(grid.includes('Total de {noun}'));
    assert.equal(grid.includes("isProduct ? 'Produtos' : 'Serviços'"), false);
    assert.equal(grid.includes('0,00 ou %'), false);
  });

  it('HTML da SPA não fica um ano no cache; só /_next/static permanece imutável', () => {
    const config = src('next.config.mjs');
    const layout = src('src/app/layout.tsx');
    assert.ok(config.includes("source: '/((?!_next/static/).*)'"));
    assert.ok(config.includes("value: HTML_NO_STORE") || config.includes('no-store, must-revalidate'));
    assert.ok(config.includes('Cloudflare-CDN-Cache-Control'));
    assert.ok(config.includes("source: '/_next/static/:path*'"));
    assert.ok(config.includes('max-age=31536000, immutable'));
    assert.ok(layout.includes("export const dynamic = 'force-dynamic'"));
    assert.ok(layout.includes('export const revalidate = 0'));
  });
});
