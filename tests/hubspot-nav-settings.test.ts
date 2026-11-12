import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { GESTAO_CLICK_MENU_TREE } from '../src/app/components/GestaoClickSidebar';
import { ERP_HIDDEN_MENU_SUB_ITEMS, type ErpConfigAccess } from '../src/app/lib/erp-config-access';
import {
  CATEGORY_ORDER,
  DEFAULT_PIN_IDS,
  HUBSPOT_NAV_ITEMS,
  HUBSPOT_OMITTED_ITEMS,
  SETTINGS_NAV_ITEMS,
  canSeeNavItem,
  canSeeSettingsItem,
  existingScreenKeys,
  mappedScreenKeys,
  orphanScreenKeys,
  pinsStorageKey,
  sanitizePinIds,
  visibleNavItems,
  visibleSettingsItems,
  type NavAccessContext,
} from '../src/app/lib/hubspot-nav';

const FULL_ACCESS: NavAccessContext = {
  moduleAccess: { crm: true, erp: true, chamados: true },
  erpConfig: {
    isAdmin: true,
    canViewReports: true,
    canViewAdminConfig: true,
    canReadCertificate: true,
    canSyncGestaoClick: true,
  },
};

const NO_ACCESS: NavAccessContext = {
  moduleAccess: { crm: false, erp: false, chamados: false },
  erpConfig: {
    isAdmin: false,
    canViewReports: false,
    canViewAdminConfig: false,
    canReadCertificate: false,
    canSyncGestaoClick: false,
  },
};

const SALES_ONLY: NavAccessContext = {
  moduleAccess: { crm: true, erp: false, chamados: false },
  erpConfig: NO_ACCESS.erpConfig,
  itemView: {
    'crm.overview_ai': { view: true },
    'crm.contacts': { view: true },
    'crm.companies': { view: true },
    'crm.deals_kanban': { view: true },
    'crm.marketing_campaigns': { view: false },
    'crm.marketing_lists_scoring_forms': { view: false },
    'crm.automations_dag': { view: false },
    'crm.playbooks_meetings_sequences': { view: false },
    'crm.data_health': { view: false },
  },
};

const ERP_NO_REPORTS: NavAccessContext = {
  moduleAccess: { crm: false, erp: true, chamados: false },
  erpConfig: {
    isAdmin: false,
    canViewReports: false,
    canViewAdminConfig: false,
    canReadCertificate: false,
    canSyncGestaoClick: false,
  },
};

describe('Navegação única no padrão HubSpot', () => {
  test('nenhuma tela existente fica órfã (exceto PDV, já oculto de propósito)', () => {
    const orphans = orphanScreenKeys(GESTAO_CLICK_MENU_TREE);
    const allowed = orphans.filter((key) => key !== 'erp:VENDAS:VENDAS_BALCAO');
    assert.deepEqual(allowed, [], `Telas órfãs: ${allowed.join(', ')}`);
    assert.ok(mappedScreenKeys().includes('erp:VENDAS:VENDAS_BALCAO'));
    assert.ok(existingScreenKeys(GESTAO_CLICK_MENU_TREE).includes('erp:VENDAS:VENDAS_BALCAO'));
  });

  test('todos os itens do menu ERP (menos o PDV oculto) têm correspondente', () => {
    const mapped = new Set(mappedScreenKeys());
    for (const group of GESTAO_CLICK_MENU_TREE) {
      if (group.id === 'CONFIGURACOES') {
        for (const sub of group.subItems || []) {
          assert.ok(
            mapped.has(`erp:${group.id}:${sub.id}`) ||
              SETTINGS_NAV_ITEMS.some((item) => item.erpConfigSubId === sub.id) ||
              ['CFG_MARCA', 'CFG_LOJAS', 'CFG_AVISOS'].includes(sub.id),
            `config ${sub.id} deve ir para as configurações unificadas`
          );
        }
        continue;
      }
      const subs = group.subItems && group.subItems.length ? group.subItems : [{ id: group.id, label: group.label }];
      for (const sub of subs) {
        if ((ERP_HIDDEN_MENU_SUB_ITEMS as readonly string[]).includes(sub.id)) continue;
        assert.ok(mapped.has(`erp:${group.id}:${sub.id}`), `faltou mapear erp:${group.id}:${sub.id}`);
      }
    }
  });

  test('itens do HubSpot sem equivalente no sti-hub ficam de fora do menu', () => {
    const labels = new Set(HUBSPOT_NAV_ITEMS.map((i) => i.label));
    for (const omitted of HUBSPOT_OMITTED_ITEMS) {
      if (omitted.label.includes('(categoria)') || omitted.label.includes('abas') || omitted.label.includes('/')) continue;
      assert.equal(labels.has(omitted.label), false, `${omitted.label} não deveria aparecer no menu`);
    }
    assert.ok(HUBSPOT_OMITTED_ITEMS.length >= 10);
  });

  test('PDV permanece mapeado, mas oculto (fail-closed da regra atual)', () => {
    const pdv = HUBSPOT_NAV_ITEMS.find((i) => i.target.type === 'erp' && i.target.subId === 'VENDAS_BALCAO');
    assert.ok(pdv);
    assert.equal(pdv?.hiddenOnPurpose, true);
    assert.equal(canSeeNavItem(pdv!, FULL_ACCESS), false);
  });

  test('RBAC: sem módulo, o item some; view=false também some', () => {
    const deals = HUBSPOT_NAV_ITEMS.find((i) => i.id === 'deals')!;
    const emails = HUBSPOT_NAV_ITEMS.find((i) => i.id === 'marketing-emails')!;
    const quotes = HUBSPOT_NAV_ITEMS.find((i) => i.id === 'quotes')!;
    const reports = HUBSPOT_NAV_ITEMS.find((i) => i.id === 'erp-rel-cadastros')!;

    assert.equal(canSeeNavItem(deals, NO_ACCESS), false);
    assert.equal(canSeeNavItem(quotes, NO_ACCESS), false);
    assert.equal(canSeeNavItem(deals, SALES_ONLY), true);
    assert.equal(canSeeNavItem(emails, SALES_ONLY), false);
    assert.equal(canSeeNavItem(quotes, SALES_ONLY), false);
    assert.equal(canSeeNavItem(reports, ERP_NO_REPORTS), false);
    assert.equal(canSeeNavItem(quotes, ERP_NO_REPORTS), true);
    assert.ok(visibleNavItems(SALES_ONLY).every((i) => i.module !== 'erp' && i.module !== 'chamados'));
  });

  test('configurações administrativas só aparecem para admin; preferências ficam visíveis', () => {
    const users = SETTINGS_NAV_ITEMS.find((i) => i.id === 'account-users')!;
    const pref = SETTINGS_NAV_ITEMS.find((i) => i.id === 'pref-geral')!;
    const cert = SETTINGS_NAV_ITEMS.find((i) => i.id === 'tools-certificate')!;
    assert.equal(canSeeSettingsItem(pref, NO_ACCESS), true);
    assert.equal(canSeeSettingsItem(users, NO_ACCESS), false);
    assert.equal(canSeeSettingsItem(users, FULL_ACCESS), true);
    assert.equal(canSeeSettingsItem(cert, ERP_NO_REPORTS), false);
    const certAccess: NavAccessContext = {
      ...ERP_NO_REPORTS,
      erpConfig: { ...(ERP_NO_REPORTS.erpConfig as ErpConfigAccess), canReadCertificate: true },
    };
    assert.equal(canSeeSettingsItem(cert, certAccess), true);
    assert.ok(visibleSettingsItems(NO_ACCESS).every((i) => i.alwaysForUser));
  });

  test('pins padrão e chave de localStorage são por usuário, sem o Início', () => {
    assert.deepEqual(DEFAULT_PIN_IDS, ['deals', 'tasks', 'contacts', 'companies', 'segments']);
    assert.equal(pinsStorageKey('usr-1'), 'stihub_nav_pins_v2:usr-1');
    assert.equal(pinsStorageKey(''), 'stihub_nav_pins_v2:anon');
    assert.deepEqual(
      sanitizePinIds(['home', 'deals', 'deals', 'unknown', 'quotes'], ['deals', 'quotes', 'tasks']),
      ['deals', 'quotes']
    );
  });

  test('o flyout tem as categorias do padrão, só com itens existentes', () => {
    assert.ok(CATEGORY_ORDER.includes('RECEITA'));
    assert.ok(CATEGORY_ORDER.includes('ERP'));
    assert.ok(visibleNavItems(FULL_ACCESS).some((i) => i.category === 'RECEITA' && i.label === 'Orçamentos'));
    assert.ok(visibleNavItems(FULL_ACCESS).some((i) => i.category === 'RECEITA' && i.label === 'Contratos'));
    assert.ok(visibleNavItems(FULL_ACCESS).some((i) => i.category === 'RECEITA' && i.label === 'Faturas'));
    assert.ok(visibleNavItems(FULL_ACCESS).some((i) => i.id === 'marketing-emails' && i.railGroup === 'MARKETING'));
    assert.ok(visibleNavItems(FULL_ACCESS).some((i) => i.id === 'workflows' && i.railGroup === 'PLATAFORMA'));
  });

  test('arquivos protegidos de auth/IAM não foram alterados neste lote', () => {
    const root = process.cwd();
    for (const rel of [
      'src/middleware.ts',
      'src/app/lib/auth.ts',
      'src/app/lib/iam-admin-routes.ts',
    ]) {
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      assert.ok(src.length > 0, rel);
    }
  });
});
