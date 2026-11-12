// A barra lateral de cada sistema é a própria. No ERP não aparece a barra do CRM (t236u/t237u).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(process.cwd(), 'src/app/page.tsx'), 'utf8');

const CRM_SHELL = 'rounded-lg overflow-hidden border border-slate-300 shadow-md bg-[#f3f5f8]';

describe('Barra lateral por sistema (t236u/t237u)', () => {
  it('o casco com CrmSidebar só aparece no CRM (isCrmActive), não no ERP nem em Chamados', () => {
    const shellStart = page.indexOf(CRM_SHELL);
    assert.ok(shellStart > 0, 'casco visual do CRM deve existir');
    const preceding = page.slice(Math.max(0, shellStart - 200), shellStart);
    assert.match(preceding, /\{isCrmActive && \(/);
    assert.equal(page.includes("{activeModule !== 'SETTINGS_HUB' && ("), false);

    const crmSidebarAt = page.indexOf('<CrmSidebar');
    assert.ok(crmSidebarAt > shellStart, 'CrmSidebar deve ficar dentro do casco do CRM');
  });

  it('ErpGestaoClickTab e ServiceDeskTab ficam fora do casco do CRM e o ERP não esconde a própria barra', () => {
    const shellStart = page.indexOf(CRM_SHELL);
    const erpAt = page.indexOf('<ErpGestaoClickTab');
    const serviceAt = page.indexOf('<ServiceDeskTab');
    assert.ok(erpAt > 0 && serviceAt > 0 && shellStart > 0);
    assert.ok(erpAt < shellStart, 'ErpGestaoClickTab deve ser renderizado fora do casco do CRM');
    assert.ok(serviceAt < shellStart, 'ServiceDeskTab deve ser renderizado fora do casco do CRM');
    assert.equal(page.includes('hideSidebar'), false, 'page.tsx não deve esconder a barra do ERP');
  });
});
