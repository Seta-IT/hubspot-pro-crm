import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { displayProposalVersionSummary } from '../src/app/lib/proposal-version-summary';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('esconder "Versão inicial da Proposta Comercial #N"', () => {
  it('esconde o resumo automático da versão inicial e mantém os demais', () => {
    assert.equal(
      displayProposalVersionSummary('Versão inicial da Proposta Comercial #4728'),
      '',
    );
    assert.equal(
      displayProposalVersionSummary('Versão inicial da Proposta Comercial #4728 (v1.0)'),
      '',
    );
    assert.equal(
      displayProposalVersionSummary('Versão inicial da Proposta Comercial #Nova'),
      '',
    );
    assert.equal(displayProposalVersionSummary('  Versão inicial da Proposta Comercial #1  '), '');
    assert.equal(displayProposalVersionSummary('Ajuste comercial aprovado'), 'Ajuste comercial aprovado');
    assert.equal(displayProposalVersionSummary('Versão 1 (Original) — Escopo inicial (24 meses • R$ 1,00/mês)'), 'Versão 1 (Original) — Escopo inicial (24 meses • R$ 1,00/mês)');
    assert.equal(displayProposalVersionSummary('Versão atual da proposta comercial'), 'Versão atual da proposta comercial');
    assert.equal(displayProposalVersionSummary('Versão inicial do contrato CTR-1'), 'Versão inicial do contrato CTR-1');
    assert.equal(displayProposalVersionSummary(''), '');
    assert.equal(displayProposalVersionSummary(undefined), '');
  });

  it('o formulário, o modal de status e o link da proposta usam o filtro e não inventam texto substituto', () => {
    const modal = src('src/app/components/ErpEditModals.tsx');
    const tab = src('src/app/components/ErpGestaoClickTab.tsx');
    const page = src('src/app/proposta/[id]/page.tsx');
    const repo = src('src/db/repository.ts');

    for (const [name, text] of [
      ['ErpEditModals', modal],
      ['ErpGestaoClickTab', tab],
      ['proposta/[id]/page', page],
    ] as const) {
      assert.match(text, /displayProposalVersionSummary\(ver\.changeSummary\)/, `${name} deve filtrar changeSummary`);
      assert.doesNotMatch(
        text,
        /Versão inicial da Proposta Comercial #/,
        `${name} não deve mais exibir ou gerar o texto automático`,
      );
    }

    assert.doesNotMatch(
      repo,
      /Versão inicial da Proposta Comercial #/,
      'o repositório não deve mais gerar o texto automático em fallbacks novos',
    );
    assert.match(
      repo,
      /versionHistory\.length === 0[\s\S]*changeSummary:\s*['"]{2}/,
      'fallback novo do repositório deixa o resumo vazio, sem texto inventado',
    );
  });
});
