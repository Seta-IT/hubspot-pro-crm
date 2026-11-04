// Cabecalho por sistema (CRM laranja, Chamados verde, ERP azul-marinho) e ajustes do parecer CISO 04/11.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMailboxScopeRestricted, canSeeRecordInScope } from '../src/api/mailbox-routes';

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
const page = readFileSync(join(process.cwd(), 'src/app/page.tsx'), 'utf8');
const rbac = readFileSync(join(process.cwd(), 'src/app/components/StiHubAdminRbacPanel.tsx'), 'utf8');

function lum(h: string) {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

describe('Cabecalho por sistema', () => {
  for (const sys of ['crm', 'erp', 'service']) {
    it(`token --sti-header-${sys} com contraste AA para texto branco`, () => {
      const m = css.match(new RegExp(`--sti-header-${sys}:\\s*([^;]+);`));
      assert.ok(m);
      const hexes = m![1].match(/#[0-9a-f]{6}/gi) || [];
      assert.ok(hexes.length >= 2);
      for (const h of hexes) assert.ok(1.05 / (lum(h) + 0.05) >= 4.5, `${sys} ${h}`);
    });
  }
  it('header usa o token do sistema ativo, sem cor solta', () => {
    assert.match(page, /var\(--sti-header-\$\{headerSystem\}\)/);
    assert.match(page, /activeModule === 'SERVICE_DESK' \? 'service' : isCrmActive \? 'crm' : 'erp'/);
    assert.ok(!page.includes('bg-[linear-gradient(90deg,#1e3a6e_0%'));
  });
});

describe('Parecer CISO 04/11', () => {
  it('Reenviar convite depende de canManageUsersRbac, nao de Full Control', () => {
    assert.match(rbac, /const canManageInvites = actorIsSuperAdmin \|\| actorCanManageUsersRbac;/);
  });
  const repo = {
    getContactById: (id: string) => ({ c1: { ownerId: 'u1' }, c2: { ownerId: 'u2' } } as Record<string, { ownerId: string }>)[id],
    getDealById: (id: string) => ({ d1: { ownerId: 'vend@seta.com' } } as Record<string, { ownerId: string }>)[id],
    listContacts: () => [{ ownerId: 'u2', companyId: 'e1' }, { ownerId: 'u1', companyId: 'e2' }],
    listDeals: () => [],
  } as never;
  const base = { email: 'vend@seta.com', name: 'V', roleId: 'VENDEDOR', access: { contact: true, company: true, deal: true }, id: 'u1' };
  it('PROPRIOS/EQUIPE veem so os proprios registros', () => {
    for (const scope of ['PROPRIOS', 'EQUIPE']) {
      const a = { ...base, isAdmin: false, scope };
      assert.equal(isMailboxScopeRestricted(a), true);
      assert.equal(canSeeRecordInScope(repo, a, { contactId: 'c1' }), true);
      assert.equal(canSeeRecordInScope(repo, a, { contactId: 'c2' }), false);
      assert.equal(canSeeRecordInScope(repo, a, { dealId: 'd1' }), true);
      assert.equal(canSeeRecordInScope(repo, a, { companyId: 'e2' }), true);
      assert.equal(canSeeRecordInScope(repo, a, { companyId: 'e1' }), false);
    }
  });
  it('TODOS e admin veem tudo', () => {
    assert.equal(canSeeRecordInScope(repo, { ...base, isAdmin: false, scope: 'TODOS' }, { contactId: 'c2' }), true);
    assert.equal(canSeeRecordInScope(repo, { ...base, isAdmin: true, scope: 'PROPRIOS' }, { contactId: 'c2' }), true);
  });
});
