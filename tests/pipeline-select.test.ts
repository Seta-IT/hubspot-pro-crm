import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatPipelineDisplayName } from '../src/app/lib/pipeline-display';

describe('Seletor de pipeline (droplist HubSpot)', () => {
  it('remove o prefixo Pipeline N: do nome', () => {
    assert.equal(
      formatPipelineDisplayName('Pipeline 2: Venda de Equipamentos'),
      'Venda de Equipamentos'
    );
    assert.equal(
      formatPipelineDisplayName('Pipeline 1: Locação & Serviços'),
      'Locação & Serviços'
    );
    assert.equal(formatPipelineDisplayName('Sem prefixo'), 'Sem prefixo');
    assert.equal(formatPipelineDisplayName(''), '');
  });

  it('Kanban: painel escuro removido e droplist na barra', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/components/DealsKanbanTab.tsx'), 'utf8');
    assert.ok(!src.includes('PORTAL 4369067'));
    assert.ok(!src.includes('Selecione o Funil de Vendas ou Locação Recorrente'));
    assert.ok(!src.includes('STI-hub • Seletor de Pipeline'));
    assert.ok(!src.includes('Arraste e solte os cards'));
    assert.ok(!src.includes('total nos 3 funis'));
    assert.ok(src.includes('<PipelineSelect'));
    const comp = readFileSync(join(process.cwd(), 'src/app/components/PipelineSelect.tsx'), 'utf8');
    assert.ok(comp.includes('aria-expanded'));
    assert.ok(comp.includes("'Escape'"));
    assert.ok(comp.includes('role="listbox"'));
    assert.ok(comp.includes('formatPipelineDisplayName'));
    assert.ok(comp.includes('<Check'));
    assert.ok(comp.includes('bg-white'));
  });

  it('cabeçalho CRM esconde o seletor global no Funil', () => {
    const page = readFileSync(join(process.cwd(), 'src/app/page.tsx'), 'utf8');
    assert.ok(page.includes('activeModule !== "DEALS_KANBAN"'));
    assert.ok(page.includes('formatPipelineDisplayName(p.name)'));
    assert.ok(!page.includes('+ Novo Negócio (Deal)'));
  });
});
