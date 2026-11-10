// ============================================================================
// STI-hub ERP - Relatórios expansível com 9 submenus (padrão GestãoClick).
// Cada submenu tem ícone de linha e abre uma tela só com o título. Sem rede.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GESTAO_CLICK_MENU_TREE, erpReportTitle } from '../src/app/components/GestaoClickSidebar';
import { filterErpMenuTree, resolveErpConfigAccess } from '../src/app/lib/erp-config-access';

const rel = GESTAO_CLICK_MENU_TREE.find((g) => g.id === 'RELATORIOS');

describe('Relatórios - submenus', () => {
  it('9 submenus na ordem do GestãoClick, todos com ícone', () => {
    assert.deepEqual(rel?.subItems?.map((s) => s.label), ['Cadastros', 'Vendas', 'Ordens de serviços', 'Estoque', 'Financeiro', 'Contratos', 'Fiscal', 'Personalizados', 'Logs do sistema']);
    for (const s of rel?.subItems || []) assert.ok(s.icon, `${s.label} sem ícone`);
  });

  it('cada submenu abre uma tela só com o título', () => {
    assert.equal(erpReportTitle('REL_VENDAS'), 'Relatórios de Vendas');
    assert.equal(erpReportTitle('REL_LOGS'), 'Logs do sistema');
    assert.equal(erpReportTitle(undefined), 'Relatórios');
    for (const s of rel?.subItems || []) assert.match(erpReportTitle(s.id), /^(Relatórios|Logs)/);
    const tab = readFileSync(join(process.cwd(), 'src/app/components/ErpGestaoClickTab.tsx'), 'utf8');
    const block = tab.slice(tab.indexOf('data-testid="relatorios-somente-titulo"'), tab.indexOf('data-testid="relatorios-somente-titulo"') + 400);
    assert.match(block, /erpReportTitle\(activeSubId\)/);
    assert.doesNotMatch(block, /<table|Kpi|grid-cols/);
  });

  it('visibilidade continua pela regra existente (sem permissão, Relatórios some)', () => {
    const semPerm = resolveErpConfigAccess({ authenticated: true, mfaVerified: true, user: { erpRole: 'ERP_COMMERCIAL' }, effectiveActionGuards: {} });
    const admin = resolveErpConfigAccess({ authenticated: true, mfaVerified: true, user: { erpRole: 'ERP_ADMIN' }, effectiveActionGuards: { canManageUsersRbac: true } });
    assert.equal(filterErpMenuTree(GESTAO_CLICK_MENU_TREE, semPerm).some((g) => g.id === 'RELATORIOS'), semPerm.canViewReports);
    assert.equal(filterErpMenuTree(GESTAO_CLICK_MENU_TREE, admin).find((g) => g.id === 'RELATORIOS')?.subItems?.length, 9);
  });
});
