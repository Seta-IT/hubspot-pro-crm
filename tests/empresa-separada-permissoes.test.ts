// ============================================================================
// t198u (27/11/2026): "os dados da empresa estao misturando com as permissões do meu user".
// 1) Tela: a ficha do usuário (cadastro + permissões) ficava aberta embaixo de Dados da Empresa ao
//    trocar de aba/menu. 2) Dados: salvar Dados da Empresa mandava junto a cópia local de usuários
//    e o servidor regravava cadastro/permissões com ela. 3) GET de Dados da Empresa devolvia rbac.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';

const HTTP = { _fromHttpBridge: '1' };
const tok = (uid: string, email: string, roleId: string, extra: Record<string, unknown> = {}) =>
  signStiHubSessionToken({
    uid, email, name: 'Teste', roleId, scope: roleId === 'SUPER_ADMIN' ? 'TODOS' : 'PROPRIOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now() - 1000, exp: Date.now() + 3_600_000, ...extra,
  } as Parameters<typeof signStiHubSessionToken>[0]);
const MARCELO = 'marcelo.mira@setatelecom.com.br';
const A = () => ({ ...HTTP, _sessionToken: tok('usr-seta-01', MARCELO, 'SUPER_ADMIN', { canManageUsersRbac: true }) });
const snapshot = (repo: ReturnType<typeof createInMemoryRepository>) =>
  JSON.stringify(repo.getRbacState().users.map((u) => ({ ...u, updatedAt: undefined })));

describe('t198u: Dados da Empresa separados das permissões do usuário (servidor)', () => {
  it('salvar Dados da Empresa com a cópia local de usuários junto não altera cadastro nem permissões', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const before = snapshot(repo);
    const me = repo.findRbacUserRecord('usr-seta-01', MARCELO)!;
    assert.ok(me, 'usuário do Marcelo existe no seed');
    // cópia como o navegador guarda (sem campos de senha/2FA, que o cliente já remove)
    const { totpSecret: _t, lastUsedTotpTimeStep: _l, passwordHash: _p, totpSecretFormatted: _f, ...meClient } = me as unknown as Record<string, unknown>;
    void _t; void _l; void _p; void _f;
    const staleCopy = [{
      ...meClient,
      roleId: 'VENDEDOR_SALES',
      scope: 'PROPRIOS',
      department: 'STI SOLUCOES EM TI',
      jobTitle: 'Razão Social',
      phone: '(19) 2376-9773',
      enabledModules: ['CRM'],
      crmPermissions: { ...(me.crmPermissions || {}), canDeleteRecords: false },
      erpPermissions: undefined,
      legalName: 'STI SOLUCOES EM TI COMERCIAL IMPORTADORA E EXPORTADORA LTDA',
      cnpj: '09449088000106',
    }];
    const r = await router.dispatch({
      method: 'PUT',
      path: '/api/admin/settings',
      query: A(),
      body: {
        companyEmitter: { cnpj: '09.449.088/0001-06', legalName: 'STI SOLUCOES EM TI COMERCIAL IMPORTADORA E EXPORTADORA LTDA', phone: '(19) 2376-9773' },
        iamUsersOverride: staleCopy,
        iamDeletedUsersOverride: ['evelyn@setatelecom.com.br'],
      },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(repo.getErpOverview().gestaoClickConfig.companyCnpj, '09449088000106', 'empresa salva');
    assert.equal(snapshot(repo), before, 'usuários e permissões intactos');
    const after = repo.findRbacUserRecord('usr-seta-01', MARCELO)! as unknown as Record<string, unknown>;
    assert.equal(after.roleId, 'SUPER_ADMIN');
    assert.equal(after.legalName, undefined, 'nenhum dado da empresa no registro do usuário');
    assert.equal(after.cnpj, undefined);
    assert.ok(repo.findRbacUserRecord('usr-seta-02', 'evelyn@setatelecom.com.br'), 'nenhum usuário apagado');
  });

  it('GET de Dados da Empresa não devolve usuários nem permissões', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const g = await router.dispatch({ method: 'GET', path: '/api/admin/settings', query: A() });
    assert.equal(g.status, 200);
    const data = (g.body as { data: Record<string, unknown> }).data;
    assert.ok(data.companyEmitter, 'empresa presente');
    assert.equal(data.rbac, undefined, 'sem rbac/usuários');
    assert.ok(!JSON.stringify(data).includes('crmPermissions'));
  });

  it('as rotas de usuários continuam aplicando a edição do admin (RBAC intacto)', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const r = await router.dispatch({ method: 'GET', path: '/api/admin/rbac', query: A() });
    assert.equal(r.status, 200);
    assert.ok(((r.body as { data: { users: unknown[] } }).data.users || []).length > 0);
  });
});

describe('t198u: Dados da Empresa separados das permissões do usuário (tela)', () => {
  const src = readFileSync('src/app/components/StiHubAdminRbacPanel.tsx', 'utf8');
  it('a ficha do usuário só aparece na aba Usuários', () => {
    assert.ok(src.includes("{subView === 'USERS_RBAC' && editingUser && (() => {"));
    assert.ok(!/\n\s*\{editingUser && \(\(\) => \{/.test(src), 'sem ficha solta fora da aba Usuários');
  });
  it('trocar para outra aba fecha a ficha do usuário', () => {
    const i = src.indexOf("if (subView !== 'USERS_RBAC') {");
    assert.ok(i > 0);
    assert.ok(src.slice(i, i + 120).includes('setEditingUser(null)'));
  });
  it('salvar Dados da Empresa não envia a cópia local de usuários', () => {
    const i = src.indexOf('const handleSaveAdminSettings');
    const block = src.slice(i, src.indexOf('};', i));
    assert.ok(block.includes('body: JSON.stringify(patch)'));
    assert.ok(!block.includes('iamUsersOverride'));
    assert.ok(!block.includes('iamDeletedUsersOverride'));
  });
});
