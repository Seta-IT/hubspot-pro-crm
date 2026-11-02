// ============================================================================
// STI-hub ERP - Sincronizar GestãoClick e regime/parâmetros fiscais por perfil
// (revisão CISO 02/11). Mesma regra do gestaoClickPrivilege do router.ts:
// 2FA + (admin IAM ou controle TOTAL do ERP). Sem rede: funções puras e fontes.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gestaoClickDeniedMessage, resolveErpConfigAccess, type ErpConfigSessionLike } from '../src/app/lib/erp-config-access';
import {
  buildDefaultErpPermissionsForRole,
  buildDefaultModuleAccessForRole,
  buildFullControlForModule,
} from '../src/modules/erp/rbac-seed';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

function sessionFor(roleId: 'SUPER_ADMIN' | 'OPERADOR_PDV_ESTOQUE' | 'ANALISTA_MARKETING' | 'FISCAL_CONTABIL', opts: { mfa?: boolean; erpFull?: boolean; admin?: boolean } = {}): ErpConfigSessionLike {
  const base = { roleId, ...buildDefaultModuleAccessForRole(roleId), erpPermissions: buildDefaultErpPermissionsForRole(roleId) };
  const user = (opts.erpFull ? { ...base, ...buildFullControlForModule('ERP', base as never) } : base) as unknown as NonNullable<ErpConfigSessionLike['user']>;
  return {
    authenticated: true,
    mfaVerified: opts.mfa !== false,
    user,
    enabledModules: (user as { enabledModules?: string[] }).enabledModules,
    erpPermissions: (user as { erpPermissions?: ErpConfigSessionLike['erpPermissions'] }).erpPermissions,
    effectiveActionGuards: { canManageUsersRbac: opts.admin === true },
  };
}

const admin = resolveErpConfigAccess(sessionFor('SUPER_ADMIN', { admin: true }));
const adminSem2fa = resolveErpConfigAccess(sessionFor('SUPER_ADMIN', { admin: true, mfa: false }));
const erpFull = resolveErpConfigAccess(sessionFor('FISCAL_CONTABIL', { erpFull: true }));
const erpFullSem2fa = resolveErpConfigAccess(sessionFor('FISCAL_CONTABIL', { erpFull: true, mfa: false }));
const pdv = resolveErpConfigAccess(sessionFor('OPERADOR_PDV_ESTOQUE'));
const marketing = resolveErpConfigAccess(sessionFor('ANALISTA_MARKETING'));

describe('Sincronizar GestãoClick / regime fiscal: 2FA + admin ou ERP FULL', () => {
  it('admin com 2FA pode; sem 2FA não', () => {
    assert.equal(admin.canSyncGestaoClick, true);
    assert.equal(adminSem2fa.canSyncGestaoClick, false);
  });
  it('ERP FULL com 2FA pode, sem ser admin; sem 2FA não', () => {
    assert.equal(erpFull.isAdmin, false);
    assert.equal(erpFull.canSyncGestaoClick, true);
    assert.equal(erpFullSem2fa.canSyncGestaoClick, false);
  });
  it('PDV (fiscal EDIT, estoque FULL) não pode', () => {
    assert.equal(pdv.canSyncGestaoClick, false);
  });
  it('Marketing não pode', () => {
    assert.equal(marketing.canSyncGestaoClick, false);
  });
  it('sessão anônima ou carregando não pode (fail closed)', () => {
    assert.equal(resolveErpConfigAccess(null).canSyncGestaoClick, false);
    assert.equal(resolveErpConfigAccess({ authenticated: false }).canSyncGestaoClick, false);
  });
});

describe('Aviso neutro no 401/403', () => {
  it('sync e config têm mensagem em português; outros status não', () => {
    assert.match(String(gestaoClickDeniedMessage(403, 'sync')), /^Sem permissão para sincronizar o GestãoClick/);
    assert.match(String(gestaoClickDeniedMessage(401, 'config')), /^Sem permissão para alterar a configuração fiscal/);
    assert.equal(gestaoClickDeniedMessage(500, 'sync'), null);
    assert.equal(gestaoClickDeniedMessage(200, 'config'), null);
  });
});

describe('Telas: controles escondidos pela mesma regra', () => {
  const tab = src('src/app/components/ErpGestaoClickTab.tsx');
  const dash = src('src/app/components/GestaoClickDashboard.tsx');
  const panel = src('src/app/components/StiHubAdminRbacPanel.tsx');
  it('ErpGestaoClickTab usa useErpConfigAccess e canSyncGestaoClick', () => {
    assert.match(tab, /useErpConfigAccess\(activeUser\?\.id \?\? null\)/);
    assert.match(tab, /canSyncGestaoClick = erpConfigAccess\?\.canSyncGestaoClick === true/);
  });
  it('botão Sincronizar do painel inicial só recebe onSync com permissão', () => {
    assert.match(tab, /onSync=\{canSyncGestaoClick \? handleSyncGestaoClick : undefined\}/);
    assert.match(dash, /onSync\?: \(\) => void/);
    assert.match(dash, /\{onSync && \(\s*<button/);
  });
  it('Fiscal > Auxiliares: select de regime e Editar Parâmetros só com permissão; senão, leitura', () => {
    const i = tab.indexOf('FIS_AUXILIARES" && (');
    const block = tab.slice(i, tab.indexOf('Editar Parâmetros Fiscais', i) + 400);
    assert.ok(block.indexOf('{canSyncGestaoClick ? (') > 0);
    assert.ok(block.indexOf('{canSyncGestaoClick ? (') < block.indexOf('handleChangeTaxRegime'));
    assert.match(block, /data-testid="regime-somente-leitura"/);
  });
  it('403 do sync e do daily-sync mostram aviso (não passam em silêncio)', () => {
    const h = tab.slice(tab.indexOf('const handleSyncGestaoClick'), tab.indexOf('const handleChangeTaxRegime'));
    assert.match(h, /gestaoClickDeniedMessage\(res\.status, 'sync'\)/);
    const d = panel.slice(panel.indexOf('const handleRunDailySyncNow'), panel.indexOf('const handleUpdateChecklistItem'));
    assert.match(d, /gestaoClickDeniedMessage\(res\.status, 'sync'\)/);
  });
});

describe('Configurações (todas as abas): sem cabeçalho, KPIs, banner e ações repetidas', () => {
  const tab = src('src/app/components/ErpGestaoClickTab.tsx');
  const panel = src('src/app/components/StiHubAdminRbacPanel.tsx');
  const start = tab.indexOf("activeSection === 'CONFIGURACOES' && cfgScreenAllowed && (");
  const cfg = tab.slice(start, tab.indexOf('</StiHubAdminRbacPanel>', start) > 0 ? tab.indexOf('</StiHubAdminRbacPanel>', start) : start + 4000);
  it('bloco de Configurações não tem KPIs nem Editar Dados da Empresa, regime ou Sincronizar Agora', () => {
    assert.ok(start > 0);
    assert.doesNotMatch(cfg, /MRR Locação|TCV Carteira|Editar Dados da Empresa|Sincronizar Agora|Configurações & Relatórios/);
  });
  it('banner da Central oculto em Configurações; barra de abas e lista com "+ Novo Usuário" mantidas', () => {
    assert.match(cfg, /<StiHubAdminRbacPanel\s+access=\{erpConfigAccess\}\s+hideTopBanner/);
    assert.match(panel, /\{!hideTopBanner && \(\s*<div data-testid="admin-central-banner"/);
    const users = panel.slice(panel.indexOf("{subView === 'USERS_RBAC' && !editingUser && ("));
    assert.match(users.slice(0, 6000), /\+ Novo Usuário\s*<\/button>/);
    assert.ok(panel.indexOf('Sub-navigation Tabs') > panel.indexOf('{!hideTopBanner && ('));
  });
});
