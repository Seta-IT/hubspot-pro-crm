// Layout do link do cliente e do editor de orçamento no celular. A impressão A4 permanece.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('Proposta responsiva no celular', () => {
  it('a página pública não rola na horizontal e empilha itens e parcelas; a tabela A4 continua na impressão', () => {
    const page = src('src/app/proposta/[id]/page.tsx');
    assert.match(page, /data-testid="proposal-public-page"/);
    assert.match(page, /overflow-x-hidden/);
    assert.match(page, /print:overflow-visible/);
    assert.match(page, /data-testid="proposal-items-cards"/);
    assert.match(page, /sm:hidden print:hidden/);
    assert.match(page, /data-testid="proposal-installments-cards"/);
    assert.match(page, /hidden w-full text-left text-xs border-collapse sm:table print:table/);
    assert.match(page, /print:px-3\.5/);
    assert.match(page, /min-h-11 sm:min-h-0/);
    assert.equal(page.includes('internalNotes'), false);
  });

  it('a grade e os totais do editor cabem na largura, com rolagem só na tabela', () => {
    const grid = src('src/app/components/ProposalItemsGrid.tsx');
    const modal = src('src/app/components/ErpEditModals.tsx');
    assert.match(grid, /data-testid=\{`proposal-grid-\$\{noun\}-scroll`\}/);
    assert.match(grid, /overflow-x-auto/);
    assert.match(grid, /min-w-\[760px\]/);
    assert.match(modal, /data-testid="proposal-edit-form"/);
    assert.match(modal, /overflow-x-hidden/);
    assert.match(modal, /min-w-0 sm:min-w-\[11rem\]/);
    const formAt = modal.indexOf('data-testid="proposal-edit-form"');
    const freightAt = modal.indexOf('Frete e entrega', formAt);
    const totalsAt = modal.indexOf('Totais e pagamento', formAt);
    const billingAt = modal.indexOf('Cobrança mensal', formAt);
    assert.ok(formAt > 0 && freightAt > formAt && totalsAt > freightAt && billingAt > totalsAt);
  });
});
