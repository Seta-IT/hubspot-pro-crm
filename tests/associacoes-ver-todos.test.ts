// ============================================================================
// STI-hub — "Exibir todos os … associados" abre o painel com a lista completa
// (pedido do Marcéllo, 26/11/2026). Também confirma o e-mail sintético como "--".
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AssociatedRecordsListPanel from '../src/app/components/AssociatedRecordsListPanel';
import { displayContactEmail, isInventedContactEmail } from '../src/modules/data-health/invented-contact-email';

const src = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

describe('Exibir todos os associados', () => {
  it('o clique abre um painel com a lista completa, não só expande o cartão', () => {
    const drawer = src('src/app/components/DealRecordDrawer.tsx');
    const panel = src('src/app/components/AssociatedRecordsListPanel.tsx');
    assert.match(drawer, /<AssociatedRecordsListPanel/);
    assert.match(drawer, /setViewAllKind\('contacts'\)/);
    assert.match(drawer, /setViewAllKind\('companies'\)/);
    assert.match(drawer, /setViewAllKind\('tickets'\)/);
    assert.match(drawer, /setViewAllKind\('deals'\)/);
    assert.match(drawer, /setViewAllKind\('proposals'\)/);
    assert.match(drawer, /setViewAllKind\('contracts'\)/);
    assert.match(drawer, /deal-assoc-view-all-\$\{card\.id\}/);
    assert.match(drawer, /deal-assoc-view-all-panel-\$\{viewAllKind\}/);
    assert.match(drawer, /Exibir todos os contatos associados/);
    assert.match(drawer, /Exibir todas as empresas associadas/);
    assert.match(drawer, /Exibir todos os tickets associados/);
    assert.match(drawer, /Exibir todos os negócios associados/);
    assert.match(drawer, /Exibir todas as propostas associadas/);
    assert.doesNotMatch(drawer, /setShowAllAssoc/);
    assert.match(panel, /data-assoc-view-all="1"/);
    assert.match(panel, /role="dialog"/);
  });

  it('o painel lista todos os itens e permite buscar', () => {
    const html = renderToStaticMarkup(
      React.createElement(AssociatedRecordsListPanel, {
        title: 'Contatos associados',
        countLabel: '2 contatos associados',
        testId: 'deal-assoc-view-all-panel-contacts',
        items: [
          { id: 'c1', searchText: 'Victor --', content: React.createElement('div', null, 'Victor', React.createElement('div', null, '--')) },
          { id: 'c2', searchText: 'Ana ana@evamind.com', content: React.createElement('div', null, 'Ana', React.createElement('div', null, 'ana@evamind.com')) },
        ],
        onClose: () => {},
      })
    );
    assert.ok(html.includes('Contatos associados'));
    assert.ok(html.includes('2 contatos associados'));
    assert.ok(html.includes('Victor'));
    assert.ok(html.includes('Ana'));
    assert.ok(html.includes('--'));
    assert.ok(html.includes('data-assoc-view-all="1"'));
  });

  it('a barra lateral mascara e-mail inventado do Victor como --', () => {
    const invented = 'victor.qyf0@contato.setatelecom.com.br';
    assert.equal(isInventedContactEmail(invented), true);
    assert.equal(displayContactEmail(invented), '--');
    const drawer = src('src/app/components/DealRecordDrawer.tsx');
    assert.match(drawer, /displayContactEmail\(c\.email\)/);
  });
});
