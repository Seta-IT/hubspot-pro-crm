import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import { createInMemoryRepository, type CrmRepository } from '../src/db/repository';
import {
  DEFAULT_CONTACT_DEPARTMENTS,
  DEFAULT_CONTACT_POSITIONS,
  optionsWithLegacyValue,
} from '../src/app/lib/contact-field-lists';
import {
  MemoryAuxListsStore,
  resetDefaultAuxListsStore,
  seedItemsForKind,
} from '../src/modules/erp/aux-lists-store';

const HTTP = { _fromHttpBridge: '1' };
const saved: Record<string, string | undefined> = {};

before(() => {
  saved.STI_HUB_SESSION_SECRET = process.env.STI_HUB_SESSION_SECRET;
  process.env.STI_HUB_SESSION_SECRET = process.env.STI_HUB_SESSION_SECRET || 's'.repeat(48);
});

after(() => {
  if (saved.STI_HUB_SESSION_SECRET === undefined) delete process.env.STI_HUB_SESSION_SECRET;
  else process.env.STI_HUB_SESSION_SECRET = saved.STI_HUB_SESSION_SECRET;
  resetDefaultAuxListsStore();
});

beforeEach(() => {
  resetDefaultAuxListsStore(new MemoryAuxListsStore());
});

const tokFor = (repo: CrmRepository, uid = 'usr-seta-01', extra: Record<string, unknown> = {}) => {
  const r = repo.findRbacUserRecord(uid, '')!;
  return signStiHubSessionToken({
    uid: r.id,
    email: r.email,
    name: r.name,
    roleId: r.roleId,
    scope: r.scope,
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'],
    moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true,
    mfaMethod: 'TOTP_AUTHENTICATOR',
    iat: Date.now() - 1000,
    exp: Date.now() + 3_600_000,
    ...extra,
  } as Parameters<typeof signStiHubSessionToken>[0]);
};

describe('Posição e Área: listas configuráveis', () => {
  it('o seed inicial tem as opções pedidas e valores antigos entram como opção extra', () => {
    assert.deepEqual(seedItemsForKind('contactPosition').map((i) => i.label), [...DEFAULT_CONTACT_POSITIONS]);
    assert.deepEqual(seedItemsForKind('contactDepartment').map((i) => i.label), [...DEFAULT_CONTACT_DEPARTMENTS]);
    const withLegacy = optionsWithLegacyValue(DEFAULT_CONTACT_DEPARTMENTS, 'Compras de TI / Telecom');
    assert.equal(withLegacy[0].legacy, true);
    assert.equal(withLegacy[0].value, 'Compras de TI / Telecom');
    const kept = optionsWithLegacyValue(DEFAULT_CONTACT_DEPARTMENTS, 'TI');
    assert.equal(kept.some((o) => o.legacy), false);
    assert.ok(kept.some((o) => o.value === 'TI'));
  });

  it('store cria, renomeia, reordena e desativa sem apagar o item', async () => {
    const store = new MemoryAuxListsStore([]);
    const a = await store.create('contactPosition', 'Diretor');
    const b = await store.create('contactPosition', 'Gerente');
    const renamed = await store.update(a.id, 'Diretor Executivo');
    assert.equal(renamed?.label, 'Diretor Executivo');
    const reordered = await store.reorder('contactPosition', [b.id, a.id]);
    assert.deepEqual(reordered.map((i) => i.label), ['Gerente', 'Diretor Executivo']);
    const off = await store.update(b.id, { active: false });
    assert.equal(off?.active, false);
    const visible = await store.list('contactPosition', { includeInactive: false });
    assert.deepEqual(visible.map((i) => i.label), ['Diretor Executivo']);
    const all = await store.list('contactPosition', { includeInactive: true });
    assert.equal(all.length, 2);
  });

  it('GET /api/crm/contact-field-lists exige sessão e devolve o seed', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const anon = await router.dispatch({ method: 'GET', path: '/api/crm/contact-field-lists', query: { ...HTTP, _clientIp: '198.51.100.21' } });
    assert.equal(anon.status, 401);

    const ok = await router.dispatch({
      context: TRUSTED_INTERNAL_CONTEXT,
      method: 'GET',
      path: '/api/crm/contact-field-lists',
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const data = (ok.body as { data: { contactPosition: Array<{ label: string }>; contactDepartment: Array<{ label: string }> } }).data;
    assert.deepEqual(data.contactPosition.map((i) => i.label), [...DEFAULT_CONTACT_POSITIONS]);
    assert.deepEqual(data.contactDepartment.map((i) => i.label), [...DEFAULT_CONTACT_DEPARTMENTS]);
  });

  it('admin adiciona, renomeia, reordena e desativa; usuário comum não escreve', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const admin = () => ({ ...HTTP, _sessionToken: tokFor(repo), _clientIp: '198.51.100.22' });
    const created = await router.dispatch({
      method: 'POST',
      path: '/api/crm/contact-field-lists',
      query: admin(),
      body: { kind: 'contactDepartment', label: 'Facilities' },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = (created.body as { data: { id: string } }).data.id;

    const renamed = await router.dispatch({
      method: 'PATCH',
      path: `/api/crm/contact-field-lists/${id}`,
      query: admin(),
      body: { label: 'Facilities & Facilities' },
    });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body));

    const listed = await router.dispatch({
      method: 'GET',
      path: '/api/crm/contact-field-lists?includeInactive=1',
      query: admin(),
    });
    const depts = (listed.body as { data: { contactDepartment: Array<{ id: string; label: string }> } }).data.contactDepartment;
    const ids = [id, ...depts.filter((d) => d.id !== id).map((d) => d.id)];
    const reordered = await router.dispatch({
      method: 'POST',
      path: '/api/crm/contact-field-lists/reorder',
      query: admin(),
      body: { kind: 'contactDepartment', ids },
    });
    assert.equal(reordered.status, 200, JSON.stringify(reordered.body));
    assert.equal((reordered.body as { data: Array<{ id: string }> }).data[0].id, id);

    const off = await router.dispatch({
      method: 'PATCH',
      path: `/api/crm/contact-field-lists/${id}`,
      query: admin(),
      body: { active: false },
    });
    assert.equal(off.status, 200);
    assert.equal((off.body as { data: { active: boolean } }).data.active, false);

    const visible = await router.dispatch({ method: 'GET', path: '/api/crm/contact-field-lists', query: admin() });
    const visibleDepts = (visible.body as { data: { contactDepartment: Array<{ label: string }> } }).data.contactDepartment;
    assert.equal(visibleDepts.some((d) => d.label.startsWith('Facilities')), false);

    const denied = await router.dispatch({
      method: 'POST',
      path: '/api/crm/contact-field-lists',
      query: {
        ...HTTP,
        _clientIp: '198.51.100.23',
        _sessionToken: tokFor(repo, 'usr-seta-05', {
          enabledModules: ['CRM'],
          moduleAccess: { crm: true, erp: false, chamados: false },
        }),
      },
      body: { kind: 'contactPosition', label: 'Hack' },
    });
    assert.equal(denied.status, 403, JSON.stringify(denied.body));
  });

  it('migração aditiva, formulários e tela de configurações ligam as listas', () => {
    const root = process.cwd();
    const store = readFileSync(path.join(root, 'src/modules/erp/aux-lists-store.ts'), 'utf8');
    assert.match(store, /ALTER TABLE erp_aux_list_items ADD COLUMN IF NOT EXISTS active/);
    assert.match(store, /contactPosition/);
    const router = readFileSync(path.join(root, 'src/api/router.ts'), 'utf8');
    assert.match(router, /isContactFieldListsRoute/);
    assert.doesNotMatch(router, /src\/middleware\.ts/);
    const panel = readFileSync(path.join(root, 'src/app/components/AssociationSidePanel.tsx'), 'utf8');
    assert.match(panel, /ContactFieldSelect/);
    assert.match(panel, /label: 'Posição'/);
    assert.match(panel, /label: 'Área'/);
    const settings = readFileSync(path.join(root, 'src/app/components/ContactFieldListsSettings.tsx'), 'utf8');
    assert.match(settings, /Desativar/);
    assert.match(settings, /Reativar/);
    assert.match(settings, /reorder/);
    const nav = readFileSync(path.join(root, 'src/app/lib/hubspot-nav.ts'), 'utf8');
    assert.match(nav, /data-contact-lists/);
    const drawer = readFileSync(path.join(root, 'src/app/components/ContactDetailDrawer.tsx'), 'utf8');
    assert.match(drawer, /CONTACT_POSITION_KIND/);
    assert.match(drawer, /CONTACT_DEPARTMENT_KIND/);
  });
});
