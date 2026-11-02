// ============================================================================
// STI-hub ERP - Relatórios e Central de Administração por perfil (pós-B2, revisão CISO).
// Sem rede: funções puras e leitura das fontes.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canOpenAdminCentral, filterErpMenuTree, resolveErpConfigAccess } from '../src/app/lib/erp-config-access';
import { GESTAO_CLICK_MENU_TREE } from '../src/app/components/GestaoClickSidebar';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const admin = resolveErpConfigAccess({ authenticated: true, mfaVerified: true, user: { erpRole: 'ERP_ADMIN' }, effectiveActionGuards: { canManageUsersRbac: true } });
const vendedor = resolveErpConfigAccess({ authenticated: true, mfaVerified: true, user: { erpRole: 'ERP_COMMERCIAL' }, effectiveActionGuards: { canManageUsersRbac: false } });
const fiscal = resolveErpConfigAccess({
  authenticated: true,
  mfaVerified: true,
  user: { erpRole: 'ERP_FINANCE' },
  effectiveActionGuards: { canManageUsersRbac: false },
  erpPermissions: { erpRole: 'ERP_FINANCE', fiscalIssuanceAccess: 'FULL' },
});
const pdv = resolveErpConfigAccess({ authenticated: true, mfaVerified: true, user: { erpRole: 'ERP_PDV_BALCAO' }, effectiveActionGuards: { canManageUsersRbac: false } });

describe('Central de Administração: só admin com 2FA', () => {
  it('admin abre a Central inteira', () => {
    assert.equal(canOpenAdminCentral(admin), true);
    assert.equal(canOpenAdminCentral(admin, { subView: 'EMAIL_TEMPLATES' }), true);
  });
  it('Vendedor não abre nenhuma vista da Central', () => {
    for (const subView of ['USERS_RBAC', 'EMAIL_TEMPLATES', 'COMPANY_EMITTER', 'CERTIFICATE_A1']) {
      assert.equal(canOpenAdminCentral(vendedor, { subView }), false, subView);
      assert.equal(canOpenAdminCentral(vendedor, { subView, singleView: true }), false, subView);
    }
  });
  it('Fiscal só vê a tela dedicada do certificado (leitura), nunca abas ou e-mails', () => {
    assert.equal(canOpenAdminCentral(fiscal, { singleView: true, subView: 'CERTIFICATE_A1' }), true);
    assert.equal(canOpenAdminCentral(fiscal, { subView: 'CERTIFICATE_A1' }), false);
    assert.equal(canOpenAdminCentral(fiscal, { singleView: true, subView: 'EMAIL_TEMPLATES' }), false);
    assert.equal(canOpenAdminCentral(fiscal, { subView: 'USERS_RBAC' }), false);
  });
  it('admin sem 2FA ou sessão carregando: fechado', () => {
    const semMfa = resolveErpConfigAccess({ authenticated: true, mfaVerified: false, user: { erpRole: 'ERP_ADMIN' }, effectiveActionGuards: { canManageUsersRbac: true } });
    assert.equal(canOpenAdminCentral(semMfa), false);
    assert.equal(canOpenAdminCentral(null), false);
  });
});

describe('Relatórios do ERP por perfil', () => {
  it('indicadores para quem tem erp.relatorios_logs; administração só para admin', () => {
    assert.equal(admin.canViewReports && admin.canViewAdminConfig, true);
    assert.equal(vendedor.canViewReports, true);
    assert.equal(vendedor.canViewAdminConfig, false);
    assert.equal(fiscal.canViewReports, true);
    assert.equal(fiscal.canViewAdminConfig, false);
  });
  it('perfil sem relatórios na matriz (PDV) não vê o grupo Relatórios', () => {
    assert.equal(pdv.canViewReports, false);
    assert.equal(filterErpMenuTree(GESTAO_CLICK_MENU_TREE, pdv).some((g) => g.id === 'RELATORIOS'), false);
    assert.equal(filterErpMenuTree(GESTAO_CLICK_MENU_TREE, vendedor).some((g) => g.id === 'RELATORIOS'), true);
    assert.equal(filterErpMenuTree(GESTAO_CLICK_MENU_TREE, null).some((g) => g.id === 'RELATORIOS'), false);
  });
  it('tela de Relatórios: ações de administração e a Central só com canViewAdminConfig', () => {
    const erp = src('src/app/components/ErpGestaoClickTab.tsx');
    const block = erp.slice(erp.indexOf("activeSection === 'RELATORIOS' && reportsScreenAllowed"));
    assert.match(block, /\{canAdminErpConfig && !isCfgSection && \(\s*<div className="flex items-center gap-2">[\s\S]*Editar Dados da Empresa[\s\S]*Sincronizar Agora/);
    assert.match(block, /rbacState && \(activeSection === 'CONFIGURACOES' \|\| canAdminErpConfig\)/);
    assert.match(block, /access=\{erpConfigAccess\}/);
    assert.match(erp, /erpConfigAccess\.canViewReports\) return;\s*setActiveSection\('INICIO'\)/);
  });
});

describe('Outros caminhos para a Central e modelos de e-mail', () => {
  it('StiHubAdminRbacPanel e AdminSettingsCenterTab têm o gate antes de qualquer aba', () => {
    const panel = src('src/app/components/StiHubAdminRbacPanel.tsx');
    const gate = panel.indexOf('if (!canOpenAdminCentral(effectiveAccess, { singleView, subView }))');
    assert.ok(gate > 0);
    assert.ok(gate < panel.indexOf('{/* Sub-navigation Tabs */}'));
    assert.ok(gate < panel.indexOf("subView === 'EMAIL_TEMPLATES' && ("));
    const legacy = src('src/app/components/AdminSettingsCenterTab.tsx');
    assert.ok(legacy.indexOf('centralAccess?.isAdmin !== true') > 0);
    assert.ok(legacy.indexOf('centralAccess?.isAdmin !== true') < legacy.indexOf('{/* HEADER BAR */}'));
  });
  it('CRM: menu, pílula, menu do usuário e Minha Conta só levam à Central para admin', () => {
    const page = src('src/app/page.tsx');
    assert.match(page, /const canOpenAdminCentralUi = adminCentralAccess\?\.isAdmin === true;/);
    assert.match(page, /\{canOpenAdminCentralUi && \(\s*<button[\s\S]*?Políticas IAM \(Painel CRM/);
    assert.match(page, /filter\(\(pill\) => pill\.id !== 'ADMIN_RBAC' \|\| canOpenAdminCentralUi\)/);
    assert.match(page, /onSelectAdminRbac=\{canOpenAdminCentralUi \?/);
    assert.match(page, /onOpenAdminIam=\{canOpenAdminCentralUi \?/);
    assert.match(page, /access=\{adminCentralAccess\}/);
  });
  it('compositor de e-mail: criar modelo segue o canManage do servidor (pacote O: Marketing EDIT/FULL ou admin)', () => {
    const tsx = src('src/app/components/HubSpotEmailAndTasksPanel.tsx');
    assert.match(tsx, /const \[canManageEmailTemplates, setCanManageEmailTemplates\] = useState\(false\);/);
    assert.match(tsx, /setCanManageEmailTemplates\(j\?\.canManage === true\);/);
    assert.match(tsx, /\{canManageEmailTemplates && \(\s*<button[\s\S]*?Salvar atual como Template/);
    assert.match(tsx, /\{canManageEmailTemplates && showNewTemplateForm && \(/);
    assert.match(tsx, /if \(!canManageEmailTemplates\) return;/);
  });
});
