// ============================================================================
// STI-hub ERP - Painel (Início + fluxo de caixa) calculado em tempo real pelos dados do
// STI-hub (aprovado pelo Marcéllo em 19/11/2026). Regras de cálculo, rota e tela.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import { evaluateStiHubRouteProtection } from '../src/middleware';
import {
  computeErpDashboard,
  isValidMonthParam,
  lastMonths,
  proposalToDashboardRow,
  resolveProposalApprovalDate,
  toLocalYmd,
  type ComputeDashboardInput,
  type DashboardProposalRow,
} from '../src/modules/erp/dashboard-metrics';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const HTTP = { _fromHttpBridge: '1' };

function base(over: Partial<ComputeDashboardInput> = {}): ComputeDashboardInput {
  return {
    month: '2026-11',
    today: '2026-11-19',
    proposals: [],
    invoices: [],
    financialEntries: [],
    salesOrders: [],
    bankAccounts: [],
    includeFinance: true,
    includeImportedSales: true,
    generatedAt: '2026-11-19T17:00:00.000Z',
    ...over,
  };
}

const P = (over: Partial<DashboardProposalRow>): DashboardProposalRow => ({
  status: 'ENVIADA',
  total: 100,
  fromGc: false,
  createdAt: '2026-11-05T12:00:00.000Z',
  approvedAt: null,
  ...over,
});

describe('Datas mistas (ISO e DD/MM/AAAA) no fuso de São Paulo', () => {
  it('normaliza AAAA-MM-DD, ISO com fuso, ISO sem fuso e DD/MM/AAAA', () => {
    assert.equal(toLocalYmd('2026-11-19'), '2026-11-19');
    assert.equal(toLocalYmd('2026-11-19T15:00:00.000Z'), '2026-11-19');
    // 01/12 às 02:00 UTC ainda é 30/11 em São Paulo (UTC-3).
    assert.equal(toLocalYmd('2026-12-01T02:00:00.000Z'), '2026-11-30');
    assert.equal(toLocalYmd('2026-12-01T02:00:00'), '2026-12-01');
    assert.equal(toLocalYmd('03/11/2026'), '2026-11-03');
    assert.equal(toLocalYmd('03/11/2026 10:20'), '2026-11-03');
    assert.equal(toLocalYmd('31/02/2026'), null);
    assert.equal(toLocalYmd(''), null);
    assert.equal(toLocalYmd(null), null);
    assert.equal(toLocalYmd('ontem'), null);
  });
  it('janela de 6 meses atravessa a virada do ano; mes= é validado', () => {
    assert.deepEqual(lastMonths('2026-02'), ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
    assert.ok(isValidMonthParam('2026-11'));
    assert.ok(!isValidMonthParam('2026-13'));
    assert.ok(!isValidMonthParam('11/2026'));
  });
});

describe('Propostas feitas x aprovadas', () => {
  it('feitas = criadas no mês sem RASCUNHO; aprovadas = aprovadas/convertidas no mês; taxa e origem', () => {
    const d = computeErpDashboard(
      base({
        proposals: [
          P({ total: 1000 }),
          P({ total: 500, fromGc: true, createdAt: '06/11/2026' }),
          P({ status: 'RASCUNHO', total: 9999 }),
          P({ status: 'RECUSADA', total: 200 }),
          P({ status: 'CONVERTIDA_CONTRATO', total: 300, approvedAt: '2026-11-12T19:43:06.753Z' }),
          // criada em outubro e aprovada em novembro: conta como aprovada em nov e feita em out
          P({ status: 'APROVADA', total: 700, fromGc: true, createdAt: '2026-10-20', approvedAt: '2026-11-02T13:00:00Z' }),
          // criada fora da janela
          P({ createdAt: '2025-01-10' }),
        ],
      })
    );
    assert.equal(d.proposals.made.count, 4);
    assert.equal(d.proposals.made.value, 2000);
    assert.deepEqual(d.proposals.made.bySource.gc, { count: 1, value: 500 });
    assert.deepEqual(d.proposals.made.bySource.stihub, { count: 3, value: 1500 });
    assert.equal(d.proposals.approved.count, 2);
    assert.equal(d.proposals.approved.value, 1000);
    assert.deepEqual(d.proposals.approved.bySource.gc, { count: 1, value: 700 });
    assert.equal(d.proposals.approvalRate, 50);
    assert.equal(d.proposals.approvalRateValue, 50);
    const out = d.monthly.find((m) => m.month === '2026-10')!;
    assert.equal(out.proposalsMade.count, 1);
    assert.equal(out.proposalsApproved.count, 0);
  });
  it('sem propostas: zero e taxa nula (nunca número inventado)', () => {
    const d = computeErpDashboard(base());
    assert.equal(d.proposals.made.count, 0);
    assert.equal(d.proposals.approved.value, 0);
    assert.equal(d.proposals.approvalRate, null);
  });
  it('data da aprovação: 1º APROVADA/CONVERTIDA do histórico > approvedAt > atualização; não aprovada => null', () => {
    assert.equal(
      resolveProposalApprovalDate({
        status: 'CONVERTIDA_CONTRATO',
        statusHistory: [
          { date: '2026-11-06T15:47:07Z', status: 'RASCUNHO' },
          { date: '2026-11-12T19:43:06Z', status: 'CONVERTIDA_CONTRATO' },
          { date: '2026-11-13T15:36:27Z', status: 'CONVERTIDA_CONTRATO' },
        ],
        approvedAt: '2026-11-20',
        updatedAt: '2026-11-13',
      }),
      '2026-11-12T19:43:06Z'
    );
    assert.equal(resolveProposalApprovalDate({ status: 'APROVADA', approvedAt: '10/11/2026', updatedAt: '2026-11-15' }), '10/11/2026');
    assert.equal(resolveProposalApprovalDate({ status: 'APROVADA', updatedAt: '2026-11-15T10:00:00Z' }), '2026-11-15T10:00:00Z');
    assert.equal(resolveProposalApprovalDate({ status: 'ENVIADA', approvedAt: '2026-11-15' }), null);
    assert.equal(resolveProposalApprovalDate({ status: 'ENVIADA', converted: true, updatedAt: '2026-11-15' }), '2026-11-15');
  });
  it('proposalToDashboardRow usa o total da lista e a origem GC', () => {
    const r = proposalToDashboardRow({ id: 'prop-gc-123', status: 'APROVADA', monthlyRecurringTotal: 100, oneTimeSetupTotal: 50, shippingCost: 10, createdAt: '2026-11-01', statusHistory: [{ date: '2026-11-03', status: 'APROVADA' }] });
    assert.equal(r.total, 160);
    assert.equal(r.fromGc, true);
    assert.equal(r.approvedAt, '2026-11-03');
  });
});

describe('Faturado, financeiro e vendas', () => {
  it('faturado = EMITIDA ou PAGA por issueDate; CANCELADA e VENCIDA fora', () => {
    const d = computeErpDashboard(
      base({
        invoices: [
          { status: 'EMITIDA', issueDate: '2026-11-03', netAmount: 1000, grossAmount: 1100 },
          { status: 'PAGA', issueDate: '2026-11-10T12:00:00Z', netAmount: 500, grossAmount: 500 },
          { status: 'CANCELADA', issueDate: '2026-11-10', netAmount: 999, grossAmount: 999 },
          { status: 'VENCIDA', issueDate: '2026-11-10', netAmount: 7, grossAmount: 7 },
          { status: 'EMITIDA', issueDate: '2026-10-31', netAmount: 300, grossAmount: 300 },
        ],
      })
    );
    assert.deepEqual(d.invoiced, { count: 2, value: 1500 });
    assert.deepEqual(d.monthly.find((m) => m.month === '2026-10')!.invoiced, { count: 1, value: 300 });
  });
  it('recebido/pago = PAGO com vencimento no mês; previsto = vencendo no mês; hoje = em aberto vencendo hoje', () => {
    const d = computeErpDashboard(
      base({
        financialEntries: [
          { type: 'RECEBER', status: 'PAGO', amount: 100, dueDate: '2026-11-05' },
          { type: 'RECEBER', status: 'ABERTO', amount: 300, dueDate: '2026-11-25' },
          { type: 'RECEBER', status: 'ABERTO', amount: 50, dueDate: '19/11/2026' },
          { type: 'RECEBER', status: 'PAGO', amount: 999, dueDate: '2026-10-05' },
          { type: 'PAGAR', status: 'PAGO', amount: 40, dueDate: '2026-11-02' },
          { type: 'PAGAR', status: 'ATRASADO', amount: 60, dueDate: '2026-11-19' },
        ],
      })
    );
    const s = d.summary;
    assert.equal(s.receivedMonth, 100);
    assert.equal(s.receivedMonthPlanned, 450);
    assert.equal(s.receivedMonthPercent, 22);
    assert.equal(s.paidMonth, 40);
    assert.equal(s.paidMonthPlanned, 100);
    assert.equal(s.receivableToday, 50);
    assert.equal(s.receivableTodaySubtitle, '1 título vence hoje');
    assert.equal(s.payableToday, 60);
    assert.deepEqual(d.counts, { receivedMonth: 1, paidMonth: 1 });
    const nov = s.cashFlowMonthly[5];
    assert.deepEqual(nov, { month: 'nov', recebimentos: 100, pagamentos: 40, saldo: 60 });
    assert.equal(s.cashFlowMonthly[4].recebimentos, 999);
    assert.equal(s.cashFlowPeriodBalance, 1059);
    assert.match(s.cashFlowBestMonth, /^out · /);
  });
  it('vendas = propostas aprovadas no mês + vendas importadas (DD/MM/AAAA, sem canceladas)', () => {
    const d = computeErpDashboard(
      base({
        proposals: [P({ status: 'APROVADA', total: 1000, approvedAt: '2026-11-04' })],
        salesOrders: [
          { date: '10/11/2026', status: 'Concretizada', totalAmount: 250 },
          { date: '11/11/2026', status: 'Cancelada', totalAmount: 9999 },
          { date: '10/09/2026', status: 'Concretizada', totalAmount: 100 },
        ],
      })
    );
    assert.deepEqual(d.sales, { monthTotal: 1250, fromProposals: 1000, imported: 250 });
    assert.equal(d.summary.salesCurrentMonthToDate, 1250);
    assert.equal(d.summary.salesPeriodTotal, 1350);
    assert.equal(d.summary.salesMonthly.length, 6);
  });
  it('sem alçada financeira: valores financeiros zerados/nulos e financeVisible=false', () => {
    const d = computeErpDashboard(
      base({
        includeFinance: false,
        invoices: [{ status: 'EMITIDA', issueDate: '2026-11-03', netAmount: 1000, grossAmount: 1000 }],
        financialEntries: [{ type: 'RECEBER', status: 'PAGO', amount: 100, dueDate: '2026-11-05' }],
        bankAccounts: [{ id: 'b', name: 'Banco', lastMovedAt: '', balance: 5000, status: 'POSITIVE' }],
      })
    );
    assert.equal(d.financeVisible, false);
    assert.equal(d.invoiced, null);
    assert.equal(d.summary.receivedMonth, 0);
    assert.equal(d.summary.availableBalanceToday, 0);
    assert.equal(d.monthly[5].recebimentos, null);
  });
  it('vazio = zero em tudo', () => {
    const s = computeErpDashboard(base()).summary;
    for (const k of ['availableBalanceToday', 'receivableToday', 'payableToday', 'receivedMonth', 'paidMonth', 'salesPeriodTotal'] as const) {
      assert.equal(s[k], 0, k);
    }
    assert.equal(s.bankAccountsSummaryText, 'Nenhuma conta bancária cadastrada');
  });
});

describe('GET /api/erp/dashboard', () => {
  function sessionFor(repo: ReturnType<typeof createInMemoryRepository>, uid: string) {
    const rec = repo.findRbacUserRecord(uid, '')!;
    return signStiHubSessionToken({
      uid: rec.id,
      email: rec.email,
      name: rec.name,
      roleId: rec.roleId,
      scope: rec.scope,
      enabledModules: ['CRM', 'ERP', 'CHAMADOS'],
      moduleAccess: { crm: true, erp: true, chamados: true },
      mfaVerified: true,
      mfaMethod: 'TOTP_AUTHENTICATOR',
      iat: Date.now() - 1000,
      exp: Date.now() + 3_600_000,
    } as Parameters<typeof signStiHubSessionToken>[0]);
  }

  it('contexto interno: 200, calculado pelo estado (sem o resumo congelado)', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const r = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'GET', path: '/api/erp/dashboard', query: { mes: '2026-11' } });
    assert.equal(r.status, 200);
    const d = (r.body as { data: any }).data;
    assert.equal(d.source, 'STI-hub');
    assert.equal(d.month, '2026-11');
    assert.equal(d.monthly.length, 6);
    // Os números fixos do seed/baseline (out/2026) nunca aparecem como recebido/pago do mês.
    assert.notEqual(d.summary.receivedMonth, 287508.95);
    assert.notEqual(d.summary.paidMonth, 167157.67);
  });

  it('admin vê o financeiro; sem sessão => 401 no middleware', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const r = await router.dispatch({ method: 'GET', path: '/api/erp/dashboard', query: { ...HTTP, _sessionToken: sessionFor(repo, 'usr-seta-01') } });
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
    assert.equal((r.body as { data: { financeVisible: boolean } }).data.financeVisible, true);
    const anon = await router.dispatch({ method: 'GET', path: '/api/erp/dashboard', query: { ...HTTP } });
    assert.equal(anon.status, 401);
    const mw = evaluateStiHubRouteProtection({ pathname: '/api/erp/dashboard', method: 'GET', sessionToken: null });
    assert.equal(mw.allowed, false);
    assert.equal(mw.statusCode, 401);
  });

  it('perfil sem Financeiro/Bancos: financeVisible=false; escopo PROPRIOS conta só as próprias propostas', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const maria = repo.findRbacUserRecord('usr-seta-03', '')!;
    Object.assign(maria as object, { moduleAccess: { ...(maria as any).moduleAccess, erp: true }, enabledModules: ['CRM', 'ERP', 'CHAMADOS'] });
    Object.assign(maria.erpPermissions as object, { financeBanksAccess: 'NONE', proposalsQuotesAccess: 'FULL' });
    const now = new Date().toISOString();
    repo.createProposal({ title: 'Minha', companyName: 'C', sellerEmail: maria.email, status: 'ENVIADA', items: [], monthlyRecurringTotal: 10, oneTimeSetupTotal: 0, createdAt: now } as never);
    repo.createProposal({ title: 'Outra', companyName: 'C', sellerEmail: 'outro@setatelecom.com.br', status: 'ENVIADA', items: [], monthlyRecurringTotal: 20, oneTimeSetupTotal: 0, createdAt: now } as never);
    const r = await router.dispatch({ method: 'GET', path: '/api/erp/dashboard', query: { ...HTTP, _sessionToken: sessionFor(repo, 'usr-seta-03') } });
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
    const d = (r.body as { data: any }).data;
    assert.equal(d.financeVisible, false);
    assert.equal(d.invoiced, null);
    assert.equal(d.summary.availableBalanceToday, 0);
    if (String(maria.scope) !== 'TODOS') {
      assert.equal(d.proposals.made.count, 1);
      assert.equal(d.sales.imported, 0);
    }
  });
});

describe('Tela: sem números fixos, cor única', () => {
  const dash = src('src/app/components/GestaoClickDashboard.tsx');
  const tab = src('src/app/components/ErpGestaoClickTab.tsx');
  const fin = src('src/app/components/ErpFinanceiroAndBanksView.tsx');
  it('o Início não usa baseline nem o dashboardSummary congelado', () => {
    assert.doesNotMatch(dash, /SETA_DASHBOARD_BASELINE|SETA_BANK_BASELINE|287508|2201765|\?\? 153|\?\? 43\)|\?\? 1378|out até hoje/);
    assert.doesNotMatch(tab, /summary=\{dashboardSummary\}|dashboardSummary=\{dashboardSummary\}/);
    assert.match(tab, /fetch\('\/api\/erp\/dashboard'/);
    assert.match(tab, /dashboardSummary=\{liveDashboard\?\.summary\}/);
  });
  it('card Propostas feitas x aprovadas, Faturado e Vendas do mês', () => {
    assert.match(dash, /Propostas feitas x aprovadas em \{currentMonthLabel\(\)\}/);
    assert.match(dash, /Taxa de aprovação/);
    assert.match(dash, /Faturado em \{currentMonthLabel\(\)\}/);
  });
  it('sem verde/vermelho nos gráficos e indicadores (cor única #1e3a6e)', () => {
    assert.doesNotMatch(dash, /#15803d|#16a34a|#dc2626|bg-green-700|bg-red-600|text-emerald|text-rose-700/);
    assert.doesNotMatch(fin, /bg-emerald-500 rounded-t|bg-rose-500 rounded-t/);
  });
});
