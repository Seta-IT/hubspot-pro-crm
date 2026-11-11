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
