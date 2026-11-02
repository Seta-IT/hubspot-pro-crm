// ============================================================================
// STI-hub ERP - B1/B2 da revisão CISO (02/11/2026) e PDV oculto na interface.
// Sem rede: funções puras e leitura das fontes.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  filterErpMenuTree,
  firstVisibleErpConfigItem,
  isErpConfigItemVisible,
  resolveErpConfigAccess,
} from '../src/app/lib/erp-config-access';
import { GESTAO_CLICK_MENU_TREE } from '../src/app/components/GestaoClickSidebar';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const cfgIds = (GESTAO_CLICK_MENU_TREE.find((g) => g.id === 'CONFIGURACOES')?.subItems || []).map((s) => s.id);

const admin = { authenticated: true, mfaVerified: true, user: { erpRole: 'ERP_ADMIN' }, effectiveActionGuards: { canManageUsersRbac: true } };
const vendedor = { authenticated: true, mfaVerified: true, user: { erpRole: 'ERP_COMMERCIAL' }, effectiveActionGuards: { canManageUsersRbac: false } };
const fiscal = {
  authenticated: true,
  mfaVerified: true,
  user: { erpRole: 'ERP_FINANCE' },
  effectiveActionGuards: { canManageUsersRbac: false },
  erpPermissions: { erpRole: 'ERP_FINANCE', fiscalIssuanceAccess: 'FULL' },
};

describe('B2: Configurações por permissão (matriz rbac.ts + sessão do servidor)', () => {
  it('admin com 2FA vê todos os itens de Configurações', () => {
    const acc = resolveErpConfigAccess(admin);
    for (const id of cfgIds) assert.equal(isErpConfigItemVisible(acc, id), true, id);
  });

  it('admin sem 2FA verificado não vê nada', () => {
    const acc = resolveErpConfigAccess({ ...admin, mfaVerified: false });
    for (const id of cfgIds) assert.equal(isErpConfigItemVisible(acc, id), false, id);
  });

  it('Vendedor (ERP_COMMERCIAL) não vê o grupo Configurações', () => {
    const tree = filterErpMenuTree(GESTAO_CLICK_MENU_TREE, resolveErpConfigAccess(vendedor));
    assert.equal(tree.some((g) => g.id === 'CONFIGURACOES'), false);
    assert.equal(firstVisibleErpConfigItem(resolveErpConfigAccess(vendedor), cfgIds), null);
  });

  it('Fiscal não admin vê só o Certificado digital (leitura), como no servidor', () => {
    const acc = resolveErpConfigAccess(fiscal);
    const tree = filterErpMenuTree(GESTAO_CLICK_MENU_TREE, acc);
    const cfg = tree.find((g) => g.id === 'CONFIGURACOES');
    assert.deepEqual(cfg?.subItems?.map((s) => s.id), ['CFG_CERTIFICADO']);
    assert.equal(isErpConfigItemVisible(acc, 'CFG_GERAIS'), false);
  });

  it('matriz do usuário prevalece sobre o padrão do perfil', () => {
    const revogado = { ...admin, user: { erpRole: 'ERP_ADMIN', erpItemPermissions: { 'erp.configuracoes_empresa': { view: false } } } };
    const acc = resolveErpConfigAccess(revogado);
    assert.equal(isErpConfigItemVisible(acc, 'CFG_GERAIS'), false);
    assert.equal(isErpConfigItemVisible(acc, 'CFG_CERTIFICADO'), true);
  });

  it('sessão carregando ou anônima: Configurações oculto (fail closed); ids desconhecidos seguem a regra de admin', () => {
    assert.equal(filterErpMenuTree(GESTAO_CLICK_MENU_TREE, null).some((g) => g.id === 'CONFIGURACOES'), false);
    assert.equal(isErpConfigItemVisible(resolveErpConfigAccess({ authenticated: false }), 'CFG_CERTIFICADO'), false);
    assert.equal(isErpConfigItemVisible(resolveErpConfigAccess(vendedor), 'CONFIGURACOES'), false);
    assert.equal(isErpConfigItemVisible(resolveErpConfigAccess(admin), 'CONFIGURACOES'), true);
  });

  it('tela também é bloqueada e redirecionada no ERP (URL/estado)', () => {
    const erp = src('src/app/components/ErpGestaoClickTab.tsx');
    assert.match(erp, /activeSection === 'CONFIGURACOES' && cfgScreenAllowed/);
    assert.match(erp, /firstVisibleErpConfigItem\(erpConfigAccess/);
    assert.match(erp, /menuTree=\{visibleMenuTree\}/);
    assert.doesNotMatch(erp, /\{GESTAO_CLICK_MENU_TREE\.map\(/);
  });
});

describe('PDV oculto só na interface', () => {
  it('Balcão (PDV) sai do menu, mas continua definido na árvore e no código', () => {
    const tree = filterErpMenuTree(GESTAO_CLICK_MENU_TREE, resolveErpConfigAccess(admin));
    const vendas = tree.find((g) => g.id === 'VENDAS');
    assert.ok(vendas);
    assert.equal(vendas!.subItems!.some((s) => s.id === 'VENDAS_BALCAO'), false);
    assert.ok(GESTAO_CLICK_MENU_TREE.find((g) => g.id === 'VENDAS')!.subItems!.some((s) => s.id === 'VENDAS_BALCAO'));
    assert.match(src('src/app/components/ErpGestaoClickTab.tsx'), /VENDAS_BALCAO/);
  });
});

describe('B1: Ambiente de emissão só grava com canManage do servidor', () => {
  it('Salvar e Séries fiscais só com canManage; select desabilitado sem ele', () => {
    const tsx = src('src/app/components/CertificateA1UploadCard.tsx');
    const sec = tsx.slice(tsx.indexOf('Seção 3: ambiente de emissão'));
    assert.match(sec, /footer=\{\s*canManage \?/);
    assert.match(sec, /disabled=\{!canManage\}/);
    assert.match(sec, /if \(canManage\) environment\.onChange/);
    assert.match(sec, /Somente administradores com 2FA podem alterar o ambiente de emissão/);
    assert.match(tsx, /const canManage = cert\?\.canManage === true;/);
  });
});
