import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildDealFieldPatch,
  canDeleteDealsFromPermissions,
  canEditDealsFromPermissions,
  distinctLastContactAt,
  parseDealCurrencyInput,
  parseDealDateInput,
  shouldShowLostReason,
  shouldShowWonReason,
  toDateInputValue,
} from '../src/app/lib/deal-sidebar-edit';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';
import { canEditCrmDealsKanban } from '../src/modules/erp/rbac-seed';
import type { StiHubUserRecord } from '../src/db/types';

const src = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

const baseDeal = {
  title: 'Nubank Enterprise',
  value: 280000,
  mrr: 11667,
  contractMonths: 24,
  expectedCloseDate: '2026-12-15T12:00:00.000Z',
  ownerId: 'usr-marcelo',
  ownerName: 'Marcelo Lopes Mira',
  wonReason: null as string | null,
  lostReason: null as string | null,
  nextBestAction: {
    actionType: 'FOLLOW_UP',
    title: 'Ligar para o decisor',
    reason: 'Proposta em análise',
    priority: 'HIGH',
    suggestedDueInDays: 2,
  },
  customProperties: {
    solutionTag: 'PABX em nuvem',
    acquisitionChannel: 'Indicação',
    description: 'Upgrade da operação',
    otherFlag: true,
  },
};

describe('edição inline do painel Sobre esse Negócio', () => {
  it('monta o patch de cada campo preenchível sem apagar outras custom properties', () => {
    assert.deepEqual(buildDealFieldPatch('title', '  Nubank CI  ', baseDeal), { title: 'Nubank CI' });
    assert.deepEqual(buildDealFieldPatch('mrr', 'R$ 2.000,00', baseDeal), { mrr: 2000, value: 48000 });
    assert.deepEqual(buildDealFieldPatch('value', '120000', baseDeal), { value: 120000, mrr: 5000 });

    const solution = buildDealFieldPatch('solution', 'URA + ramais', baseDeal);
    assert.equal((solution.customProperties as Record<string, unknown>).solutionTag, 'URA + ramais');
    assert.equal((solution.customProperties as Record<string, unknown>).otherFlag, true);

    const acquisition = buildDealFieldPatch('acquisition', 'Inbound', baseDeal);
    assert.equal(
      (acquisition.customProperties as Record<string, unknown>).acquisitionChannel,
      'Inbound'
    );

    const description = buildDealFieldPatch('description', 'Novo texto', baseDeal);
    assert.equal((description.customProperties as Record<string, unknown>).description, 'Novo texto');

    const next = buildDealFieldPatch('nextStep', 'Enviar contraproposta', baseDeal);
    assert.deepEqual(next.nextBestAction, {
      actionType: 'FOLLOW_UP',
      title: 'Enviar contraproposta',
      reason: 'Proposta em análise',
      priority: 'HIGH',
      suggestedDueInDays: 2,
    });
    assert.deepEqual(buildDealFieldPatch('nextStep', '  ', baseDeal), { nextBestAction: null });

    const close = buildDealFieldPatch('closedate', '2027-01-20', baseDeal);
    assert.equal(typeof close.expectedCloseDate, 'string');
    assert.ok(String(close.expectedCloseDate).startsWith('2027-01-20'));
    assert.deepEqual(buildDealFieldPatch('closedate', '', baseDeal), { expectedCloseDate: null });

    const owners = [
      { id: 'usr-evelyn', name: 'Evelyn Ternero Seta Telecom' },
      { id: 'usr-marcelo', name: 'Marcelo Lopes Mira' },
    ];
    assert.deepEqual(buildDealFieldPatch('owner', 'usr-evelyn', baseDeal, { ownerOptions: owners }), {
      ownerName: 'Evelyn Ternero Seta Telecom',
      ownerId: 'usr-evelyn',
    });
    assert.deepEqual(buildDealFieldPatch('wonReason', 'Assinou o contrato', baseDeal), {
      wonReason: 'Assinou o contrato',
    });
    assert.deepEqual(buildDealFieldPatch('lostReason', 'Preço', baseDeal), { lostReason: 'Preço' });
  });

  it('rejeita nome vazio, moeda inválida e data inválida', () => {
    assert.throws(() => buildDealFieldPatch('title', '   ', baseDeal), /obrigatório/);
    assert.throws(() => buildDealFieldPatch('mrr', 'abc', baseDeal), /valor mensal válido/);
    assert.throws(() => buildDealFieldPatch('closedate', '31/31/2026', baseDeal), /data de fechamento válida/);
  });

  it('interpreta moeda e data no padrão brasileiro', () => {
    assert.equal(parseDealCurrencyInput('R$ 1.667,50'), 1667.5);
    assert.equal(parseDealCurrencyInput('1.667'), 1667);
    assert.equal(parseDealCurrencyInput('1667.5'), 1667.5);
    assert.equal(parseDealCurrencyInput(''), 0);
    assert.equal(parseDealCurrencyInput('xyz'), null);
    const iso = parseDealDateInput('15/12/2026');
    assert.ok(iso && iso.startsWith('2026-12-15'));
    assert.equal(toDateInputValue('2026-12-15T12:00:00.000Z'), '2026-12-15');
    assert.equal(parseDealDateInput(''), null);
  });

  it('só mostra motivo de ganho ou perda na etapa correspondente', () => {
    const won = { id: 'stage-won', name: 'Ganho', isWon: true, isClosed: true };
    const lost = { id: 'stage-lost', name: 'Perdido', isWon: false, isClosed: true };
    const open = { id: 'stage-proposal', name: 'Proposta Enviada', isWon: false, isClosed: false };
    assert.equal(shouldShowWonReason(won), true);
    assert.equal(shouldShowLostReason(won), false);
    assert.equal(shouldShowWonReason(lost), false);
    assert.equal(shouldShowLostReason(lost), true);
    assert.equal(shouldShowWonReason(open), false);
    assert.equal(shouldShowLostReason(open), false);
  });

  it('omite Último contato quando ele só repete a última atividade', () => {
    const same = '2026-11-10T14:00:00.000Z';
    assert.equal(
      distinctLastContactAt({ lastActivityAt: same, customProperties: { notes_last_contacted: same } }),
      null
    );
    assert.equal(distinctLastContactAt({ lastActivityAt: same, customProperties: {} }), null);
    assert.equal(
      distinctLastContactAt({
        lastActivityAt: same,
        customProperties: { notes_last_contacted: '2026-10-01T10:00:00.000Z' },
      }),
      '2026-10-01T10:00:00.000Z'
    );
  });

  it('respeita o RBAC de crm.deals_kanban e não trava quando a matriz não veio', () => {
    assert.equal(canEditDealsFromPermissions(null), true);
    assert.equal(canDeleteDealsFromPermissions(undefined), true);
    assert.equal(
      canEditDealsFromPermissions({
        crmItemPermissions: { 'crm.deals_kanban': { edit: true, delete: false } },
      }),
      true
    );
    assert.equal(
      canDeleteDealsFromPermissions({
        crmItemPermissions: { 'crm.deals_kanban': { edit: true, delete: false } },
      }),
      false
    );
    assert.equal(
      canEditDealsFromPermissions({
        itemPermissions: { 'crm.deals_kanban': { edit: false, delete: false } },
      }),
      false
    );
  });

  it('o painel edita inline, tira redundâncias e move Excluir para Ações', () => {
    const drawer = src('src/app/components/DealRecordDrawer.tsx');
    const inline = src('src/app/components/DealInlineProperty.tsx');
    const tab = src('src/app/components/DealsKanbanTab.tsx');
    const page = src('src/app/page.tsx');

    assert.ok(drawer.includes('DealInlineProperty'));
    assert.ok(drawer.includes('buildDealFieldPatch'));
    assert.ok(drawer.includes("onStageChange(deal.id"));
    assert.ok(drawer.includes('data-testid="deal-actions-menu"'));
    assert.ok(drawer.includes('data-testid="deal-action-delete"'));
    assert.ok(drawer.includes('shouldShowWonReason'));
    assert.ok(drawer.includes('shouldShowLostReason'));
    assert.ok(drawer.includes('distinctLastContactAt'));
    assert.ok(!drawer.includes('Editar nome'));
    assert.ok(!drawer.includes('É negócio fechado'));
    assert.ok(!drawer.includes("label: 'Pessoa de contato'"));
    assert.ok(!/Sobre esse Negócio[\s\S]{0,800}<Trash2/.test(drawer));

    assert.ok(inline.includes("data-testid={`deal-inline-${fieldKey}`}"));
    assert.ok(inline.includes("key === 'Enter'"));
    assert.ok(inline.includes("key === 'Escape'"));
    assert.ok(inline.includes('onBlur'));
    assert.ok(inline.includes('Salvo'));

    assert.ok(tab.includes('canEditDeal'));
    assert.ok(tab.includes('canDeleteDeal'));
    assert.ok(tab.includes('ownerOptions'));
    assert.ok(drawer.includes('silent: true') || drawer.includes('silent:true'));
    assert.ok(page.includes('canEditDealsFromPermissions'));
    assert.ok(page.includes('canDeleteDealsFromPermissions'));
  });
});

const HTTP = { _fromHttpBridge: '1' };

function sessionTok(uid: string, email: string, roleId: string, extra: Record<string, unknown> = {}) {
  return signStiHubSessionToken({
    uid,
    email,
    name: 'Teste',
    roleId,
    scope: roleId === 'SUPER_ADMIN' ? 'TODOS' : 'PROPRIOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'],
    moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true,
    mfaMethod: 'TOTP_AUTHENTICATOR',
    iat: Date.now() - 1000,
    exp: Date.now() + 3_600_000,
    ...extra,
  } as Parameters<typeof signStiHubSessionToken>[0]);
}

function setKanbanEdit(user: StiHubUserRecord, edit: boolean | null) {
  const crmItems = { ...(user.crmItemPermissions || {}) };
  const items = { ...(user.itemPermissions || {}) };
  if (edit === null) {
    delete crmItems['crm.deals_kanban'];
    delete items['crm.deals_kanban'];
  } else {
    crmItems['crm.deals_kanban'] = { view: true, edit, delete: false };
    items['crm.deals_kanban'] = { view: true, edit, delete: false };
  }
  user.crmItemPermissions = crmItems;
  user.itemPermissions = items;
}

describe('RBAC de edição de negócios (PATCH /api/deals/:id)', () => {
  it('canEditCrmDealsKanban: matriz, admin e Full Control', () => {
    assert.equal(canEditCrmDealsKanban(null), false);
    assert.equal(canEditCrmDealsKanban({ crmItemPermissions: {} }), false);
    assert.equal(
      canEditCrmDealsKanban({ crmItemPermissions: { 'crm.deals_kanban': { view: true, edit: false, delete: false } } }),
      false
    );
    assert.equal(
      canEditCrmDealsKanban({ crmItemPermissions: { 'crm.deals_kanban': { view: true, edit: true, delete: false } } }),
      true
    );
    assert.equal(canEditCrmDealsKanban({ roleId: 'VENDEDOR_SALES' }, { canManageUsersRbac: true }), true);
    assert.equal(canEditCrmDealsKanban({ crmRole: 'CRM_ADMIN' }), true);
    assert.equal(
      canEditCrmDealsKanban({
        enabledModules: ['CRM'],
        crmPermissions: {
          crmRole: 'CRM_SALES_MANAGER',
          portfolioScope: 'TODOS',
          contactsAccess: 'FULL',
          companiesAccess: 'FULL',
          dealsFunnelAccess: 'FULL',
          ticketsServiceDeskAccess: 'FULL',
          marketingAutomationAccess: 'FULL',
          canExportCrmData: true,
          canMergeCrmRecords: true,
          canDeleteCrmRecords: true,
        },
        crmItemPermissions: { 'crm.deals_kanban': { view: true, edit: false, delete: false } },
      }),
      true
    );
  });

  it('403 sem crm.deals_kanban.edit, com auditoria BLOCKED e mensagem genérica', async () => {
    const repo = createInMemoryRepository();
    const seller = repo.findRbacUserRecord('usr-seta-03', '')!;
    setKanbanEdit(seller, false);
    const deal = repo.listDeals()[0];
    const before = deal.title;
    const router = new CrmApiRouter(repo);
    const res = await router.dispatch({
      method: 'PATCH',
      path: `/api/deals/${deal.id}`,
      query: { ...HTTP, _sessionToken: sessionTok(seller.id, seller.email, seller.roleId) },
      body: { title: 'Titulo que nao deve gravar' },
    });
    assert.equal(res.status, 403);
    const body = JSON.stringify(res.body);
    assert.match(body, /CRM_EDIT_FORBIDDEN/);
    assert.match(body, /Permissão negada \(Painel CRM\): seu usuário não possui permissão para editar negócios\./);
    assert.ok(!body.includes('deals_kanban'));
    assert.ok(!body.includes('FOLLOWUP_SEQUENCE'));
    assert.equal(repo.getDealById(deal.id)!.title, before);
    const blocked = repo.listSecurityAuditLogs().logs.filter((l) => l.action === 'IAM_CRM_DEAL_EDIT_BLOCKED');
    assert.ok(blocked.length >= 1);
    assert.equal(blocked[0].status, 'BLOCKED');
  });

  it('200 com crm.deals_kanban.edit', async () => {
    const repo = createInMemoryRepository();
    const seller = repo.findRbacUserRecord('usr-seta-03', '')!;
    setKanbanEdit(seller, true);
    const deal = repo.listDeals()[0];
    const router = new CrmApiRouter(repo);
    const res = await router.dispatch({
      method: 'PATCH',
      path: `/api/deals/${deal.id}`,
      query: { ...HTTP, _sessionToken: sessionTok(seller.id, seller.email, seller.roleId) },
      body: { title: 'Negocio com permissao de edicao' },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(repo.getDealById(deal.id)!.title, 'Negocio com permissao de edicao');
  });

  it('200 para admin e para Full Control do CRM mesmo sem edit na matriz', async () => {
    const repo = createInMemoryRepository();
    const deal = repo.listDeals()[0];
    const router = new CrmApiRouter(repo);

    const admin = repo.findRbacUserRecord('usr-seta-01', '')!;
    setKanbanEdit(admin, false);
    const adminRes = await router.dispatch({
      method: 'PATCH',
      path: `/api/deals/${deal.id}`,
      query: {
        ...HTTP,
        _sessionToken: sessionTok(admin.id, admin.email, admin.roleId, { canManageUsersRbac: true }),
      },
      body: { title: 'Admin atualizou o negocio' },
    });
    assert.equal(adminRes.status, 200, JSON.stringify(adminRes.body));
    assert.equal(repo.getDealById(deal.id)!.title, 'Admin atualizou o negocio');

    const seller = repo.findRbacUserRecord('usr-seta-03', '')!;
    setKanbanEdit(seller, false);
    seller.enabledModules = ['CRM', 'ERP'];
    seller.moduleAccess = { crm: true, erp: true, chamados: false };
    seller.crmPermissions = {
      ...(seller.crmPermissions || ({} as StiHubUserRecord['crmPermissions'])),
      contactsAccess: 'FULL',
      companiesAccess: 'FULL',
      dealsFunnelAccess: 'FULL',
      marketingAutomationAccess: 'FULL',
      canExportCrmData: true,
      canMergeCrmRecords: true,
      canDeleteCrmRecords: true,
    } as StiHubUserRecord['crmPermissions'];
    const fcRes = await router.dispatch({
      method: 'PUT',
      path: `/api/deals/${deal.id}`,
      query: { ...HTTP, _sessionToken: sessionTok(seller.id, seller.email, seller.roleId) },
      body: { title: 'Full Control atualizou o negocio' },
    });
    assert.equal(fcRes.status, 200, JSON.stringify(fcRes.body));
    assert.equal(repo.getDealById(deal.id)!.title, 'Full Control atualizou o negocio');
  });
});
