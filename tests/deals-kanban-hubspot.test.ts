import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  compareDealsBySortKey,
  countActiveDealFilters,
  formatDealAgeLabel,
  formatDealPropertyDate,
  isInCloseDateRange,
  isInPastDateRange,
} from '../src/app/lib/deals-kanban-format';

const src = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

describe('Kanban de Negócios no padrão HubSpot', () => {
  it('formata idade, datas reais e intervalos de filtro', () => {
    const now = new Date('2026-11-10T15:00:00.000-03:00');
    assert.equal(formatDealAgeLabel('2026-08-09T12:00:00.000Z', now), 'há 3 meses');
    assert.equal(formatDealAgeLabel('2026-11-09T12:00:00.000Z', now), 'há 1 dia');
    assert.equal(formatDealAgeLabel('2025-11-10T12:00:00.000Z', now), 'há 1 ano');
    assert.equal(formatDealPropertyDate(null), '—');
    assert.equal(formatDealPropertyDate('2026-08-09T12:00:00.000Z'), '09/08/2026');
    assert.equal(isInPastDateRange('2026-10-20T12:00:00.000Z', '30', now), true);
    assert.equal(isInPastDateRange('2026-01-01T12:00:00.000Z', '30', now), false);
    assert.equal(isInCloseDateRange('2026-11-01T12:00:00.000Z', 'OVERDUE', now), true);
    assert.equal(isInCloseDateRange('2026-12-01T12:00:00.000Z', 'NEXT_30', now), true);
    assert.equal(
      compareDealsBySortKey({ title: 'B', value: 1, createdAt: '2026-01-01' }, { title: 'A', value: 2, createdAt: '2026-02-01' }, 'title'),
      'B'.localeCompare('A', 'pt-BR')
    );
    assert.equal(countActiveDealFilters({ searchQuery: 'loggi', filterOwner: 'ALL' }), 1);
    assert.equal(countActiveDealFilters({ filterCloseRange: 'OVERDUE', filterRottingOnly: true }), 2);
  });

  it('o quadro traz o chrome do HubSpot e não inventa data de fechamento no card', () => {
    const tab = src('src/app/components/DealsKanbanTab.tsx');
    for (const token of [
      'Negócios',
      'Meus negócios',
      'Todos os negócios',
      'Filtro (',
      'Classificar por',
      'Proprietário do negócio',
      'Data de criação',
      'Data da última atividade',
      'Data de fechamento',
      'Apagar tudo',
      'Filtros avançados',
      'Valor total',
      'Valor ponderado',
      'data-testid="deals-kanban-board"',
      'data-testid="deals-board-footer"',
      '<PipelineSelect',
      "handleSelectViewMode('KANBAN')",
      "handleSelectViewMode('LIST')",
      "'COMPACT_GRID'",
      "'TIMELINE_FORECAST'",
      "'BY_OWNER_PRIORITY'",
      'stihub_deals_view_mode',
      'deals-forecast-kpis',
      'deals-sales-tools-panel',
      'Ferramentas avançadas',
    ]) {
      assert.ok(tab.includes(token), `faltou ${token}`);
    }
    assert.ok(!tab.includes('Arraste e solte os cards'));
    assert.ok(!tab.includes('total nos 3 funis'));
    assert.ok(!tab.includes('30/11/2026'));
    assert.ok(tab.includes('formatDealPropertyDate(deal.expectedCloseDate)'));
    assert.ok(tab.includes('SalesHubProToolsStrip'));
    const select = src('src/app/components/PipelineSelect.tsx');
    assert.ok(select.includes('aria-expanded'));
    const drawer = src('src/app/components/DealRecordDrawer.tsx');
    assert.ok(drawer.includes('export default function DealRecordDrawer'));
  });
});
