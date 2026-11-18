import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brDateToIso, brMonthGrid, isoToBrDate, maskBrDateInput } from '../src/app/lib/br-date';
import { formatIsoDatePt } from '../src/app/lib/internal-proposal-summary';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('Datas do orçamento em dd/mm/aaaa', () => {
  it('converte ISO e dd/mm/aaaa sem trocar dia e mês', () => {
    assert.equal(isoToBrDate('2026-12-03'), '03/12/2026');
    assert.equal(isoToBrDate('2026-12-03T15:00:00.000Z'), '03/12/2026');
    assert.equal(brDateToIso('03/12/2026'), '2026-12-03');
    assert.equal(brDateToIso('12/03/2026'), '2026-03-12');
    assert.equal(maskBrDateInput('03122026'), '03/12/2026');
    assert.equal(maskBrDateInput('03/12'), '03/12');
    assert.equal(brDateToIso('03/12'), null);
    assert.equal(brDateToIso('32/12/2026'), null);
    assert.equal(brDateToIso('03/13/2026'), null);
    assert.equal(brDateToIso(''), null);
    const grid = brMonthGrid(2026, 12);
    assert.equal(grid[0], null);
    assert.deepEqual(grid[1], { day: 1, iso: '2026-12-01' });
  });

  it('o formulário do orçamento não usa o date nativo e as telas exibem dd/mm/aaaa', () => {
    const form = src('src/app/components/ErpEditModals.tsx');
    const proposal = form.slice(
      form.indexOf('export function ProposalEditModal'),
      form.indexOf('export function ContractEditModal')
    );
    assert.doesNotMatch(proposal, /type="date"/);
    assert.match(proposal, /BrDateInput/);
    assert.match(proposal, /Até \{isoToBrDate\(draft\.validUntil\)\}/);
    assert.match(src('src/app/components/BrDateInput.tsx'), /placeholder="dd\/mm\/aaaa"/);
    assert.match(src('src/app/components/ErpGestaoClickTab.tsx'), /isoToBrDate\(prop\.proposalDate\)/);
    assert.match(src('src/app/components/ErpGestaoClickTab.tsx'), /isoToBrDate\(prop\.validUntil\)/);
    assert.match(src('src/app/proposta/[id]/page.tsx'), /isoToBrDate\(proposal\.proposalDate\)/);
    assert.match(src('src/app/proposta/[id]/page.tsx'), /isoToBrDate\(inst\.dueDate\)/);
    assert.equal(formatIsoDatePt('2026-12-03'), '03/12/2026');
    assert.match(src('src/app/lib/internal-proposal-sheet.ts'), /proposalDateLabel: formatIsoDatePt/);
    assert.match(src('src/app/lib/internal-proposal-pdf.ts'), /sheet\.proposalDateLabel/);
  });
});
