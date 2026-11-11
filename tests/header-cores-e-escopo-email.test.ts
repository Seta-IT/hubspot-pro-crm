// Cabecalho + menu por sistema (CRM laranja claro, Chamados verde, ERP azul) e parecer CISO 04/11.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMailboxScopeRestricted, canSeeRecordInScope } from '../src/api/mailbox-routes';

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
const page = readFileSync(join(process.cwd(), 'src/app/page.tsx'), 'utf8');
const tw = readFileSync(join(process.cwd(), 'tailwind.config.js'), 'utf8');
const mailbox = readFileSync(join(process.cwd(), 'src/api/mailbox-routes.ts'), 'utf8');
const rbac = readFileSync(join(process.cwd(), 'src/app/components/StiHubAdminRbacPanel.tsx'), 'utf8');
const crmSidebar = readFileSync(join(process.cwd(), 'src/app/components/CrmSidebar.tsx'), 'utf8');
const serviceDesk = readFileSync(join(process.cwd(), 'src/app/components/ServiceDeskTab.tsx'), 'utf8');

function lum(h: string) {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrastWhite(h: string) {
  return 1.05 / (lum(h) + 0.05);
}

describe('Cabecalho e menu por sistema (t139u/t140u/t141u)', () => {
  it('cores sólidas sem degradê (t215u): CRM #D9541E; Chamados verde; ERP azul', () => {
    assert.match(css, /--sti-header-crm:\s*linear-gradient\(#D9541E, #D9541E\)/i);
    assert.match(css, /--sti-header-service:\s*linear-gradient\(#047857, #047857\)/);
    assert.match(css, /--sti-header-erp:\s*linear-gradient\(#1e3a6e, #1e3a6e\)/);
    for (const sys of ['crm', 'service', 'erp']) {
      const m = css.match(new RegExp(`--sti-header-${sys}:\\s*([^;]+);`));
      const hexes = new Set((m![1].match(/#[0-9a-f]{6}/gi) || []).map((h) => h.toUpperCase()));
      assert.equal(hexes.size, 1, `${sys} deve ser cor sólida`);
    }
    assert.match(css, /#D9541E/i);
    assert.ok(css.includes('#047857')); // accent/botões Chamados
  });
  for (const sys of ['erp', 'service']) {
    it(`token --sti-header-${sys}: texto branco font-semibold com contraste >= 3:1`, () => {
      const m = css.match(new RegExp(`--sti-header-${sys}:\\s*([^;]+);`));
      assert.ok(m);
      const hexes = m![1].match(/#[0-9a-f]{6}/gi) || [];
      assert.ok(hexes.length >= 2);
      for (const h of hexes) assert.ok(contrastWhite(h) >= 3, `${sys} ${h} = ${contrastWhite(h).toFixed(2)}`);
    });
  }
  it('token --sti-header-crm: #D9541E sólido; branco em #D9541E opção E (t222u)', () => {
    const m = css.match(/--sti-header-crm:\s*([^;]+);/);
    assert.ok(m);
    const hexes = (m![1].match(/#[0-9a-f]{6}/gi) || []).map((h) => h.toUpperCase());
    assert.ok(hexes.includes('#D9541E'));
    assert.ok(contrastWhite('#BC4718') >= 3, `hover ${contrastWhite('#BC4718').toFixed(2)}`);
    // t219u: 30% mais escuro que #F47B3C; texto branco passa AA.
    assert.ok(contrastWhite('#D9541E') >= 3.5, `CRM ${contrastWhite('#D9541E').toFixed(2)}`);
  });
  it('accent por data-system: CRM #D9541E, Chamados verde (#047857), ERP azul', () => {
    assert.match(css, /\[data-system="crm"\][\s\S]*?--sti-accent:\s*#D9541E/i);
    assert.match(css, /\[data-system="crm"\][\s\S]*?--sti-accent-hover:\s*#BC4718/i);
    assert.match(css, /\[data-system="crm"\][\s\S]*?--sti-accent-soft:\s*#FEF1EA/i);
    assert.match(css, /\[data-system="service"\][\s\S]*?--sti-accent:\s*#047857/);
    assert.match(css, /\[data-system="erp"\][\s\S]*?--sti-accent:\s*#1e3a6e/);
    assert.match(tw, /DEFAULT: 'var\(--sti-accent\)'/);
  });
  it('shell usa data-system; menu nao tem faixa azul propria', () => {
    assert.match(page, /data-system=\{headerSystem\}/);
    assert.match(page, /var\(--sti-header-\$\{headerSystem\}\)/);
    assert.match(page, /data-testid="sti-system-menu"/);
    assert.ok(!page.includes('#26467d'));
    assert.ok(!page.includes('bg-[linear-gradient(90deg,#26467d'));
    assert.ok(!page.includes('bg-[linear-gradient(90deg,#1e3a6e_0%'));
  });
  it('layout CRM/Chamados nao usa #1e3a6e solto como destaque (usa accent)', () => {
    assert.ok(!page.includes('bg-[#1e3a6e]'));
    assert.ok(!page.includes('text-[#1e3a6e]'));
    assert.ok(!crmSidebar.includes('#1e3a6e'));
    assert.ok(!serviceDesk.includes('text-[#1e3a6e]'));
    assert.ok(!serviceDesk.includes('bg-[#0d2b4e] hover:bg-[#1e3a6e]'));
  });
  it('botao accent: CRM #D9541E com branco ~4,0:1 (t222u); Chamados AA', () => {
    const crm = contrastWhite('#D9541E');
    assert.ok(crm >= 3.5, `CRM ${crm.toFixed(2)}`);
    assert.ok(contrastWhite('#047857') >= 4.5);
    assert.ok(contrastWhite('#BC4718') >= 3);
  });
});

describe('Parecer CISO 04/11', () => {
  it('Reenviar convite depende de canManageUsersRbac, nao de Full Control', () => {
    assert.match(rbac, /const canManageInvites = actorIsSuperAdmin \|\| actorCanManageUsersRbac;/);
  });
  it('POST /api/mailbox/send aplica canSeeRecordInScope com o mesmo 404', () => {
    const send = mailbox.slice(mailbox.indexOf("sub === '/send'"), mailbox.indexOf("sub === '/sync'"));
    assert.match(send, /canSeeRecordInScope\(deps\.repo, actor, v\)/);
    assert.match(send, /MAILBOX_RECORD_NOT_FOUND/);
    // Escopo vem antes de 409 (caixa) para nao revelar existencia.
    const scopeAt = send.indexOf('canSeeRecordInScope');
    const noAccAt = send.indexOf('MAILBOX_NO_ACCOUNT');
    assert.ok(scopeAt > 0 && noAccAt > scopeAt);
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
