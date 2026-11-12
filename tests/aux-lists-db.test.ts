import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { CrmApiRouter } from '../src/api/router';
import { createInMemoryRepository, type CrmRepository } from '../src/db/repository';
import { DEFAULT_CONTRACT_AUX_OPTIONS } from '../src/app/lib/contract-billing-utils';
import {
  MemoryAuxListsStore,
  loadAuxListsOrSeed,
  resetDefaultAuxListsStore,
  seedAuxListItems,
  stableAuxId,
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

describe('Listas auxiliares no banco (centro de custo e plano de contas)', () => {
  it('o seed preserva os valores atuais das listas fixas', () => {
    const seed = seedAuxListItems();
    assert.deepEqual(
      seed.filter((i) => i.kind === 'costCenters').map((i) => i.label),
      DEFAULT_CONTRACT_AUX_OPTIONS.costCenters
    );
    assert.deepEqual(
      seed.filter((i) => i.kind === 'chartOfAccountsList').map((i) => i.label),
      DEFAULT_CONTRACT_AUX_OPTIONS.chartOfAccountsList
    );
    assert.equal(
      stableAuxId('costCenters', 'LOCAÇÃO DE EQUIPAMENTO'),
      'cc-locacao-de-equipamento'
    );
  });

  it('store em memória cria, edita e recusa duplicata; fallback devolve o seed', async () => {
    const store = new MemoryAuxListsStore();
    const created = await store.create('costCenters', 'NOVO CENTRO');
    assert.equal(created.label, 'NOVO CENTRO');
    const renamed = await store.update(created.id, 'CENTRO EDITADO');
    assert.equal(renamed?.label, 'CENTRO EDITADO');
    await assert.rejects(() => store.create('costCenters', 'centro editado'), /Já existe/);
    const fallback = await loadAuxListsOrSeed(
      { list: async () => { throw new Error('db down'); }, create: async () => { throw new Error('db down'); }, update: async () => null, delete: async () => null }
    );
    assert.deepEqual(
      fallback.costCenters.map((i) => i.label),
      DEFAULT_CONTRACT_AUX_OPTIONS.costCenters
    );
  });

  it('GET /api/erp/aux-lists devolve o seed e exige módulo ERP', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const ok = await router.dispatch({
      method: 'GET',
      path: '/api/erp/aux-lists',
      query: { ...HTTP, _sessionToken: tokFor(repo), _clientIp: '198.51.100.10' },
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const data = (ok.body as { data: { costCenters: Array<{ label: string }>; chartOfAccountsList: Array<{ label: string }> } }).data;
    assert.deepEqual(data.costCenters.map((i) => i.label), DEFAULT_CONTRACT_AUX_OPTIONS.costCenters);
    assert.deepEqual(data.chartOfAccountsList.map((i) => i.label), DEFAULT_CONTRACT_AUX_OPTIONS.chartOfAccountsList);

    const blocked = await router.dispatch({
      method: 'GET',
      path: '/api/erp/aux-lists',
      query: {
        ...HTTP,
        _clientIp: '198.51.100.11',
        _sessionToken: tokFor(repo, 'usr-seta-05', {
          enabledModules: ['CHAMADOS'],
          moduleAccess: { crm: false, erp: false, chamados: true },
        }),
      },
    });
    assert.equal(blocked.status, 403, JSON.stringify(blocked.body));
    assert.equal((blocked.body as { code: string }).code, 'MODULE_ERP_FORBIDDEN');
  });

  it('POST cria item; DELETE de item em uso retorna 409 e item livre é excluído; PATCH edita o que está em uso', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const q = () => ({ ...HTTP, _sessionToken: tokFor(repo), _clientIp: '198.51.100.12' });

    const created = await router.dispatch({
      method: 'POST',
      path: '/api/erp/aux-lists',
      query: q(),
      body: { kind: 'costCenters', label: 'CENTRO LIVRE' },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const freeId = (created.body as { data: { id: string } }).data.id;

    const contract = repo.createRentalContract({
      title: 'Contrato com centro em uso',
      companyName: 'Cliente Aux LTDA',
      companyCnpj: '00.000.000/0001-00',
      monthlyValue: 100,
      costCenter: 'LOCAÇÃO DE EQUIPAMENTO',
    });
    assert.equal(contract.costCenter, 'LOCAÇÃO DE EQUIPAMENTO');

    const listed = await router.dispatch({ method: 'GET', path: '/api/erp/aux-lists', query: q() });
    const inUse = (listed.body as { data: { costCenters: Array<{ id: string; label: string }> } }).data.costCenters.find(
      (i) => i.label === 'LOCAÇÃO DE EQUIPAMENTO'
    )!;
    assert.ok(inUse);

    const denied = await router.dispatch({
      method: 'DELETE',
      path: `/api/erp/aux-lists/${inUse.id}`,
      query: q(),
    });
    assert.equal(denied.status, 409, JSON.stringify(denied.body));
    assert.equal((denied.body as { code: string }).code, 'AUX_LIST_IN_USE');
    assert.match((denied.body as { error: string }).error, /contrato/i);
    assert.equal(((denied.body as { error: string }).error).toLowerCase().includes('inativar'), false);

    const renamed = await router.dispatch({
      method: 'PATCH',
      path: `/api/erp/aux-lists/${inUse.id}`,
      query: q(),
      body: { label: 'LOCAÇÃO DE EQUIPAMENTO — EDITADO' },
    });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
    assert.equal((renamed.body as { data: { label: string } }).data.label, 'LOCAÇÃO DE EQUIPAMENTO — EDITADO');
    // o contrato salvo continua com o valor original e permanece editável
    const stored = repo.listRentalContracts().find((c) => c.id === contract.id)!;
    assert.equal(stored.costCenter, 'LOCAÇÃO DE EQUIPAMENTO');

    const removed = await router.dispatch({
      method: 'DELETE',
      path: `/api/erp/aux-lists/${freeId}`,
      query: q(),
    });
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
  });

  it('migração, rotas e tela de cadastro ligam as listas ao banco', () => {
    const root = process.cwd();
    const migrate = readFileSync(path.join(root, 'src/db/cli-migrate.ts'), 'utf8');
    assert.match(migrate, /ensureErpAuxListsSchema/);
    const store = readFileSync(path.join(root, 'src/modules/erp/aux-lists-store.ts'), 'utf8');
    assert.match(store, /CREATE TABLE IF NOT EXISTS erp_aux_list_items/);
    const router = readFileSync(path.join(root, 'src/api/router.ts'), 'utf8');
    assert.match(router, /isAuxListsRoute/);
    const manager = readFileSync(path.join(root, 'src/app/components/ContractBillingPanels.tsx'), 'utf8');
    assert.match(manager, /useContractAuxiliaryOptions/);
    assert.match(manager, /disabled=\{inUse\}/);
    assert.match(manager, /\{inUse \? 'Em uso' : 'Excluir'\}/);
    assert.doesNotMatch(manager, /Inativar/);
    const hook = readFileSync(path.join(root, 'src/app/lib/use-contract-aux-options.ts'), 'utf8');
    assert.match(hook, /\/api\/erp\/aux-lists/);
  });
});
