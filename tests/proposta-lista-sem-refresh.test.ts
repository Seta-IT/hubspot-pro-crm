// A lista de orçamentos precisa mostrar a proposta salva sem refresh da página.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ErpCommercialProposal } from '../src/db/types';
import {
  applyProposalSaveToListPage,
  emptyProposalListCounts,
  reconcileProposalListPage,
  type ProposalListSnapshot,
} from '../src/app/lib/proposal-list-sync';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

function row(patch: Partial<ErpCommercialProposal>): ErpCommercialProposal {
  return {
    id: 'prop-1',
    code: '4700',
    title: 'Orçamento antigo',
    budgetType: 'LOCACAO',
    companyName: 'Cliente A',
    status: 'ENVIADA',
    updatedAt: '2026-11-20T12:00:00.000Z',
    items: [],
    ...patch,
  } as ErpCommercialProposal;
}

function page(data: ErpCommercialProposal[], total = data.length): ProposalListSnapshot {
  return { data, total, counts: { ...emptyProposalListCounts(), TODOS: total } };
}

describe('Lista de orçamentos reflete o salvar sem refresh', () => {
  const query = { status: 'TODOS', type: 'TODOS', search: '', offset: 0, pageSize: 50 };

  it('criar coloca a proposta no topo da página atual e soma no total', () => {
    const before = page([row({ id: 'prop-a', code: '4720' }), row({ id: 'prop-b', code: '4719' })], 2);
    const created = row({
      id: 'prop-nova',
      code: '4726',
      title: 'Orçamento novo',
      status: 'RASCUNHO',
      updatedAt: '2026-11-25T15:00:00.000Z',
    });
    const after = applyProposalSaveToListPage(before, created, { ...query, isNew: true });
    assert.equal(after.data[0].id, 'prop-nova');
    assert.equal(after.data.length, 3);
    assert.equal(after.total, 3);
    assert.equal(before.data.some((p) => p.id === 'prop-nova'), false);
  });

  it('editar troca a linha e não aumenta o total', () => {
    const before = page([row({ id: 'prop-a', code: '4720', title: 'Antes' })], 1);
    const edited = row({
      id: 'prop-a',
      code: '4720',
      title: 'Depois',
      updatedAt: '2026-11-25T16:00:00.000Z',
    });
    const after = applyProposalSaveToListPage(before, edited, { ...query, isNew: false });
    assert.equal(after.data.length, 1);
    assert.equal(after.data[0].title, 'Depois');
    assert.equal(after.total, 1);
  });

  it('Gerar cópia, depois de salva, entra na lista como rascunho novo', () => {
    const before = page([row({ id: 'prop-origem', code: '4726', title: 'Fornecimento de Switches' })], 8);
    const copy = row({
      id: 'prop-copy-1',
      code: '4727',
      title: 'Fornecimento de Switches (Cópia)',
      status: 'RASCUNHO',
      budgetType: 'PRODUTOS',
      updatedAt: '2026-11-25T18:00:00.000Z',
    });
    const after = applyProposalSaveToListPage(before, copy, { ...query, isNew: true });
    assert.equal(after.data[0].id, 'prop-copy-1');
    assert.equal(after.data[0].status, 'RASCUNHO');
    assert.equal(after.total, 9);
    assert.ok(after.data.some((p) => p.id === 'prop-origem'));
  });

  it('um GET atrasado, sem a proposta nova, não apaga a linha; o GET atualizado tira a pendência', () => {
    const created = row({
      id: 'prop-nova',
      code: '4726',
      title: 'Orçamento novo',
      status: 'RASCUNHO',
      updatedAt: '2026-11-25T15:00:00.000Z',
    });
    const stale = page([row({ id: 'prop-a', code: '4720' })], 1);
    const kept = reconcileProposalListPage(stale, [created], query);
    assert.equal(kept.page.data[0].id, 'prop-nova');
    assert.equal(kept.page.total, 2);
    assert.equal(kept.pending.length, 1);

    const fresh = page(
      [created, row({ id: 'prop-a', code: '4720' })],
      2
    );
    const done = reconcileProposalListPage(fresh, kept.pending, query);
    assert.deepEqual(done.pending, []);
    assert.equal(done.page.data.filter((p) => p.id === 'prop-nova').length, 1);
    assert.equal(done.page.total, 2);
  });

  it('edição mais nova que o GET substitui o título velho', () => {
    const edited = row({ id: 'prop-a', code: '4720', title: 'Título novo', updatedAt: '2026-11-25T16:00:00.000Z' });
    const stale = page([row({ id: 'prop-a', code: '4720', title: 'Título velho', updatedAt: '2026-11-20T12:00:00.000Z' })], 1);
    const kept = reconcileProposalListPage(stale, [edited], query);
    assert.equal(kept.page.data[0].title, 'Título novo');
    assert.equal(kept.pending.length, 1);
  });

  it('a tela grava a linha na lista no salvar e o GET da lista não usa cache', () => {
    const tab = src('src/app/components/ErpGestaoClickTab.tsx');
    const saveAt = tab.indexOf('const handleSaveEditedProposal =');
    const save = tab.slice(saveAt, saveAt + 3500);
    assert.match(save, /rememberProposalOnList\(saved, isNew\)/);
    assert.ok(save.indexOf('rememberProposalOnList(saved, isNew)') < save.indexOf('await onRefresh()'));
    assert.match(tab, /fetch\(`\/api\/erp\/proposals\?\$\{qs\.toString\(\)\}`, \{ cache: 'no-store'/);
    const copyAt = tab.indexOf('const handleDuplicateProposal =');
    const copy = tab.slice(copyAt, copyAt + 2200);
    assert.equal(copy.includes("method: 'POST'") || copy.includes('method: "POST"'), false);
  });
});
