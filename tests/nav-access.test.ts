import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import {
  resolveActiveRbacUser,
  resolveNavModuleAccess,
  NO_MODULE_ACCESS,
} from '../src/app/lib/nav-access';
import { visibleNavItems, type NavAccessContext } from '../src/app/lib/hubspot-nav';

const ADMIN = {
  id: 'usr-marcello',
  email: 'marcello@setatelecom.com.br',
  moduleAccess: { crm: true, erp: true, chamados: true },
  enabledModules: ['CRM', 'ERP', 'CHAMADOS'],
};

const ADMIN_ACCESS: NavAccessContext = {
  moduleAccess: ADMIN.moduleAccess,
  erpConfig: {
    isAdmin: true,
    canViewReports: true,
    canViewAdminConfig: true,
    canReadCertificate: true,
    canSyncGestaoClick: true,
  },
};

describe('Acesso do menu lateral (sessão e RBAC)', () => {
  test('admin com CRM vê Início, Negócios e Contatos', () => {
    const labels = visibleNavItems(ADMIN_ACCESS).map((i) => i.id);
    assert.ok(labels.includes('home'));
    assert.ok(labels.includes('deals'));
    assert.ok(labels.includes('contacts'));
    assert.ok(labels.includes('companies'));
  });

  test('sem permissão (fail-closed) nenhum item aparece', () => {
    const empty: NavAccessContext = {
      moduleAccess: NO_MODULE_ACCESS,
      erpConfig: null,
    };
    assert.deepEqual(visibleNavItems(empty), []);
  });

  test('sessão ainda não resolvida fica pending e sem módulos', () => {
    const result = resolveNavModuleAccess({ user: null, session: null, sessionResolved: false });
    assert.equal(result.pending, true);
    assert.deepEqual(result.access, NO_MODULE_ACCESS);
  });

  test('sessão anônima resolvida fecha o menu', () => {
    const result = resolveNavModuleAccess({
      user: null,
      session: { authenticated: false },
      sessionResolved: true,
    });
    assert.equal(result.pending, false);
    assert.deepEqual(result.access, NO_MODULE_ACCESS);
  });

  test('sessão autenticada com CRM libera o menu mesmo sem o registro RBAC ter chegado', () => {
    const result = resolveNavModuleAccess({
      user: null,
      session: { authenticated: true, moduleAccess: { crm: true, erp: false, chamados: false } },
      sessionResolved: true,
    });
    assert.equal(result.pending, false);
    assert.equal(result.access.crm, true);
    assert.equal(result.access.erp, false);
    const items = visibleNavItems({ moduleAccess: result.access, erpConfig: null });
    assert.ok(items.some((i) => i.id === 'home'));
    assert.ok(items.some((i) => i.id === 'deals'));
    assert.ok(items.every((i) => i.module === 'crm' || i.module === 'any'));
  });

  test('o usuário RBAC já resolvido prevalece sobre a sessão', () => {
    const result = resolveNavModuleAccess({
      user: ADMIN,
      session: { authenticated: true, moduleAccess: { crm: false, erp: false, chamados: false } },
      sessionResolved: true,
    });
    assert.deepEqual(result.access, ADMIN.moduleAccess);
    assert.equal(result.pending, false);
  });

  test('casa o usuário da sessão por e-mail quando o id difere', () => {
    const listed = { id: 'usr-db', email: ADMIN.email };
    const found = resolveActiveRbacUser({
      users: [listed, { id: 'usr-other', email: 'outro@seta.test' }],
      sessionUserId: 'uid-jwt-diferente',
      sessionEmail: ADMIN.email,
      sessionUser: { id: 'uid-jwt-diferente', email: ADMIN.email },
    });
    assert.equal(found, listed);
  });

  test('usa o usuário da sessão quando a lista RBAC vem vazia', () => {
    const sessionUser = { id: ADMIN.id, email: ADMIN.email };
    const found = resolveActiveRbacUser({
      users: [],
      sessionUserId: ADMIN.id,
      sessionEmail: ADMIN.email,
      sessionUser,
    });
    assert.equal(found, sessionUser);
  });

  test('sem sessão e sem correspondência retorna null (fail-closed)', () => {
    const found = resolveActiveRbacUser({
      users: [ADMIN],
      sessionUserId: null,
      sessionEmail: null,
      sessionUser: null,
      prev: null,
      savedUserId: null,
    });
    assert.equal(found, null);
  });

  test('e-mail parecido não herda módulos de outro usuário', () => {
    const listed = { id: 'usr-db', email: 'marcello@seta.test' };
    for (const other of ['marcelo@seta.test', 'marcello@seta.test.br', 'marcello@seta.testx', 'xmarcello@seta.test']) {
      const found = resolveActiveRbacUser({
        users: [listed],
        sessionUserId: 'uid-jwt',
        sessionEmail: other,
        sessionUser: { id: 'uid-jwt', email: other },
      });
      assert.notEqual(found, listed, other);
      assert.equal(found?.id, 'uid-jwt');
    }
  });

  test('e-mail duplicado na lista RBAC não escolhe o primeiro registro', () => {
    const first = { id: 'usr-a', email: 'mesmo@seta.test', moduleAccess: { crm: true, erp: true, chamados: true } };
    const second = { id: 'usr-b', email: 'mesmo@seta.test', moduleAccess: { crm: true, erp: false, chamados: false } };
    const sessionUser = { id: 'uid-jwt', email: 'mesmo@seta.test' };
    const found = resolveActiveRbacUser({
      users: [first, second],
      sessionUserId: 'uid-jwt',
      sessionEmail: 'MESMO@seta.test',
      sessionUser,
    });
    assert.equal(found, sessionUser);
  });

  test('casa e-mail único com diferença só de maiúsculas', () => {
    const listed = { id: 'usr-db', email: 'Admin@Seta.Test' };
    const found = resolveActiveRbacUser({
      users: [listed, { id: 'usr-other', email: 'outro@seta.test' }],
      sessionUserId: 'uid-jwt-diferente',
      sessionEmail: 'admin@seta.test',
      sessionUser: { id: 'uid-jwt-diferente', email: 'admin@seta.test' },
    });
    assert.equal(found, listed);
  });

  test('sem sessão, localStorage ou usuário residual não escolhe ninguém da lista', () => {
    const found = resolveActiveRbacUser({
      users: [ADMIN, { id: 'usr-other', email: 'outro@seta.test' }],
      sessionUserId: null,
      sessionEmail: null,
      sessionUser: null,
      prev: ADMIN,
      savedUserId: ADMIN.id,
    });
    assert.equal(found, null);
  });

  test('sessão anônima resolvida ignora usuário residual e esvazia o menu', () => {
    const result = resolveNavModuleAccess({
      user: ADMIN,
      session: { authenticated: false },
      sessionResolved: true,
    });
    assert.equal(result.pending, false);
    assert.deepEqual(result.access, NO_MODULE_ACCESS);
  });

  test('page.tsx e CrmSidebar usam a sessão cedo e o esqueleto pendente', () => {
    const root = process.cwd();
    const page = fs.readFileSync(path.join(root, 'src/app/page.tsx'), 'utf8');
    const sidebar = fs.readFileSync(path.join(root, 'src/app/components/CrmSidebar.tsx'), 'utf8');
    assert.match(page, /resolveNavModuleAccess/);
    assert.match(page, /resolveActiveRbacUser/);
    assert.match(page, /setActiveRbacUser\(\(prev\) => prev \?\? data\.user\)/);
    assert.match(sidebar, /hubspot-app-nav-pending/);
    assert.match(sidebar, /access\.permissionsPending/);
    assert.doesNotMatch(page, /moduleAccess: activeRbacUser \? userModuleAccess : \{ crm: false, erp: false, chamados: false \}/);
  });
});
