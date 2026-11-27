// ============================================================================
// Faixa de vencimentos nos próximos 30 dias (topo do STI-hub).
// ============================================================================
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import { evaluateStiHubRouteProtection } from '../src/middleware';
import { addCalendarDays } from '../src/app/lib/br-date';
import {
  buildUpcomingExpirations,
  clearExpirationCache,
  isDateInExpirationWindow,
  isOpenExpiringContract,
  isOpenExpiringInvoice,
  isOpenExpiringProposal,
  type ExpirationAccess,
} from '../src/modules/erp/upcoming-expirations';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const HTTP = { _fromHttpBridge: '1' };
const TODAY = '2026-11-27';
const ALL: ExpirationAccess = {
  contracts: true,
  invoices: true,
  receivables: true,
  payables: true,
  proposals: true,
  certificate: true,
};

function certView(notAfterIso: string) {
  return { present: true, notAfter: notAfterIso };
}

describe('Regras de janela e texto da faixa', () => {
  it('inclui hoje, o 30º dia e o que já venceu; exclui o 31º dia e data inválida', () => {
    assert.equal(isDateInExpirationWindow(TODAY, TODAY), true);
    assert.equal(isDateInExpirationWindow(addCalendarDays(TODAY, 30), TODAY), true);
    assert.equal(isDateInExpirationWindow(addCalendarDays(TODAY, 31), TODAY), false);
    assert.equal(isDateInExpirationWindow('2026-10-01', TODAY), true);
    assert.equal(isDateInExpirationWindow('10/12/2026', TODAY), true);
    assert.equal(isDateInExpirationWindow('invalido', TODAY), false);
    assert.equal(isDateInExpirationWindow('', TODAY), false);
  });

  it('contratos encerrados, faturas pagas e propostas recusadas ficam de fora', () => {
    assert.equal(isOpenExpiringContract({ endDate: addCalendarDays(TODAY, 5), status: 'ATIVO' }, TODAY), true);
    assert.equal(isOpenExpiringContract({ endDate: addCalendarDays(TODAY, 5), status: 'ENCERRADO' }, TODAY), false);
    assert.equal(isOpenExpiringInvoice({ dueDate: addCalendarDays(TODAY, 5), status: 'EMITIDA' }, TODAY), true);
    assert.equal(isOpenExpiringInvoice({ dueDate: addCalendarDays(TODAY, 5), status: 'PAGA' }, TODAY), false);
    assert.equal(isOpenExpiringInvoice({ dueDate: addCalendarDays(TODAY, 5), status: 'CANCELADA' }, TODAY), false);
    assert.equal(isOpenExpiringProposal({ validUntil: addCalendarDays(TODAY, 5), status: 'ENVIADA' }, TODAY), true);
    assert.equal(isOpenExpiringProposal({ validUntil: addCalendarDays(TODAY, 5), status: 'RECUSADA' }, TODAY), false);
    assert.equal(isOpenExpiringProposal({ validUntil: addCalendarDays(TODAY, 5), status: 'APROVADA' }, TODAY), false);
  });

  it('monta o texto curto com a contagem por tipo e o certificado em dias', () => {
    const nowMs = Date.parse(`${TODAY}T15:00:00-03:00`);
    const certAfter = new Date(nowMs + 12 * 86_400_000).toISOString();
    const data = buildUpcomingExpirations({
      today: TODAY,
      nowMs,
      access: ALL,
      contracts: [
        { endDate: addCalendarDays(TODAY, 10), status: 'ATIVO' },
        { endDate: addCalendarDays(TODAY, 20), status: 'ATIVO' },
        { endDate: addCalendarDays(TODAY, 20), status: 'ENCERRADO' },
        { endDate: addCalendarDays(TODAY, 40), status: 'ATIVO' },
      ],
      invoices: [{ dueDate: addCalendarDays(TODAY, 2), status: 'EMITIDA' }],
      financial: [
        { dueDate: addCalendarDays(TODAY, 3), status: 'ABERTO', type: 'RECEBER' },
        { dueDate: addCalendarDays(TODAY, 3), status: 'ABERTO', type: 'PAGAR' },
        { dueDate: addCalendarDays(TODAY, 3), status: 'PAGO', type: 'RECEBER' },
      ],
      proposals: 5,
      certificate: certView(certAfter),
    });
    assert.equal(
      data.text,
      'Vencimentos nos próximos 30 dias: 2 contratos • 1 fatura • 1 conta a receber • 1 conta a pagar • 5 propostas • certificado digital em 12 dias'
    );
    assert.equal(data.items[0].target.type, 'erp');
    if (data.items[0].target.type === 'erp') {
      assert.equal(data.items[0].target.section, 'CONTRATOS');
      assert.equal(data.items[0].target.status, 'VENCE_30');
    }
    const cert = data.items.find((i) => i.kind === 'certificado');
    assert.equal(cert?.target.type, 'settings');
    if (cert?.target.type === 'settings') assert.equal(cert.target.itemId, 'tools-certificate');
  });

  it('respeita o RBAC: só entra o tipo autorizado, e some a faixa quando não há nada', () => {
    const data = buildUpcomingExpirations({
      today: TODAY,
      access: { ...ALL, contracts: false, invoices: false, receivables: false, payables: false, certificate: false },
      contracts: [{ endDate: addCalendarDays(TODAY, 1), status: 'ATIVO' }],
      invoices: [{ dueDate: addCalendarDays(TODAY, 1), status: 'EMITIDA' }],
      financial: [{ dueDate: addCalendarDays(TODAY, 1), status: 'ABERTO', type: 'RECEBER' }],
      proposals: 2,
    });
    assert.equal(data.text, 'Vencimentos nos próximos 30 dias: 2 propostas');
    assert.deepEqual(data.items.map((i) => i.kind), ['propostas']);

    const empty = buildUpcomingExpirations({
      today: TODAY,
      access: ALL,
      contracts: [{ endDate: addCalendarDays(TODAY, 60), status: 'ATIVO' }],
      invoices: [],
      financial: [],
      proposals: 0,
    });
    assert.equal(empty.text, '');
    assert.equal(empty.items.length, 0);
  });

  it('certificado vencido usa o rótulo vencido', () => {
    const nowMs = Date.parse(`${TODAY}T15:00:00-03:00`);
    const data = buildUpcomingExpirations({
      today: TODAY,
      nowMs,
      access: { ...ALL, contracts: false, invoices: false, receivables: false, payables: false, proposals: false },
      certificate: certView(new Date(nowMs - 2 * 86_400_000).toISOString()),
    });
    assert.equal(data.text, 'Vencimentos nos próximos 30 dias: certificado digital vencido');
  });
});

describe('GET /api/erp/vencimentos', () => {
  beforeEach(() => clearExpirationCache());

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

  it('sem sessão: 401; o middleware exige autenticação', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const anon = await router.dispatch({ method: 'GET', path: '/api/erp/vencimentos', query: { ...HTTP } });
    assert.equal(anon.status, 401);
    const mw = evaluateStiHubRouteProtection({ pathname: '/api/erp/vencimentos', method: 'GET', sessionToken: null });
    assert.equal(mw.allowed, false);
    assert.equal(mw.statusCode, 401);
  });

  it('admin vê os tipos existentes; o texto segue o formato combinado; cache curto não muda o payload', async () => {
    const repo = createInMemoryRepository();
    const today = new Date().toISOString().slice(0, 10);
    repo.createRentalContract({
      title: 'Contrato faixa de vencimento',
      companyName: 'Cliente Teste Faixa',
      monthlyValue: 100,
      status: 'ATIVO',
      endDate: addCalendarDays(today, 8),
    });
    repo.createInvoice({
      companyName: 'Cliente Teste Faixa',
      grossAmount: 200,
      documentType: 'FATURA_LOCACAO',
      dueDate: addCalendarDays(today, 4),
      status: 'EMITIDA',
    });
    repo.createFinancialEntry({
      description: 'Receber faixa',
      amount: 200,
      type: 'RECEBER',
      status: 'ABERTO',
      dueDate: addCalendarDays(today, 4),
    });
    const router = new CrmApiRouter(repo);
    const token = sessionFor(repo, 'usr-seta-01');
    const r = await router.dispatch({ method: 'GET', path: '/api/erp/vencimentos', query: { ...HTTP, _sessionToken: token } });
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
    const d = (r.body as { data: { text: string; items: Array<{ kind: string; target: { type: string } }> } }).data;
    assert.match(d.text, /^Vencimentos nos próximos 30 dias:/);
    const kinds = d.items.map((i) => i.kind);
    assert.ok(kinds.includes('contratos'), JSON.stringify(kinds));
    assert.ok(kinds.includes('faturas'), JSON.stringify(kinds));
    assert.ok(kinds.includes('contas_receber'), JSON.stringify(kinds));
    const r2 = await router.dispatch({ method: 'GET', path: '/api/erp/vencimentos', query: { ...HTTP, _sessionToken: token } });
    assert.equal((r2.body as { cached?: boolean }).cached, true);
    assert.equal((r2.body as { data: { text: string } }).data.text, d.text);
  });

  it('sem alçada financeira: não mostra contas a receber nem a pagar', async () => {
    const repo = createInMemoryRepository();
    const today = new Date().toISOString().slice(0, 10);
    repo.createFinancialEntry({
      description: 'Receber oculto',
      amount: 50,
      type: 'RECEBER',
      status: 'ABERTO',
      dueDate: addCalendarDays(today, 2),
    });
    const maria = repo.findRbacUserRecord('usr-seta-03', '')!;
    Object.assign(maria as object, {
      erpRole: 'ERP_COMMERCIAL',
      moduleAccess: { ...(maria as any).moduleAccess, erp: true },
      enabledModules: ['CRM', 'ERP', 'CHAMADOS'],
      erpItemPermissions: {
        ...((maria as any).erpItemPermissions || {}),
        'erp.financeiro_pagar_receber': { view: false, edit: false, delete: false },
        'erp.financeiro_bancos_dre': { view: false, edit: false, delete: false },
        'erp.fiscal_notas': { view: false, edit: false, delete: false },
        'erp.contratos_locacoes': { view: false, edit: false, delete: false },
        'erp.configuracoes_empresa': { view: false, edit: false, delete: false },
      },
    });
    Object.assign(maria.erpPermissions as object, {
      erpRole: 'ERP_COMMERCIAL',
      financeBanksAccess: 'NONE',
      fiscalIssuanceAccess: 'NONE',
      proposalsQuotesAccess: 'FULL',
      rentalContractsAccess: 'NONE',
    });
    const router = new CrmApiRouter(repo);
    const r = await router.dispatch({
      method: 'GET',
      path: '/api/erp/vencimentos',
      query: { ...HTTP, _sessionToken: sessionFor(repo, 'usr-seta-03') },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
    const kinds = ((r.body as { data: { items: Array<{ kind: string }> } }).data.items || []).map((i) => i.kind);
    assert.ok(!kinds.includes('contas_receber'), JSON.stringify(kinds));
    assert.ok(!kinds.includes('contas_pagar'), JSON.stringify(kinds));
    assert.ok(!kinds.includes('faturas'), JSON.stringify(kinds));
  });

  it('contexto interno responde 200', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const r = await router.dispatch({
      context: TRUSTED_INTERNAL_CONTEXT,
      method: 'GET',
      path: '/api/erp/vencimentos',
      query: {},
    });
    assert.equal(r.status, 200);
    assert.ok((r.body as { data: { items: unknown[] } }).data.items);
  });
});

describe('Tela: faixa no topo, logo abaixo do cabeçalho', () => {
  it('page.tsx renderiza a faixa dentro do bloco sticky do cabeçalho e o componente não inventa configuração', () => {
    const page = src('src/app/page.tsx');
    const headerClose = page.indexOf('</header>');
    const strip = page.indexOf('<VencimentosStrip');
    const stickyEnd = page.indexOf('</div>', strip);
    assert.ok(headerClose > 0 && strip > headerClose, 'a faixa deve vir depois do </header>');
    assert.ok(stickyEnd > strip, 'a faixa fica no mesmo bloco sticky do cabeçalho');
    assert.match(page, /handleExpirationNavigate/);
    const comp = src('src/app/components/VencimentosStrip.tsx');
    assert.match(comp, /data-testid="sti-vencimentos-strip"/);
    assert.match(comp, /\/api\/erp\/vencimentos/);
    assert.doesNotMatch(comp, /localStorage/);
  });
});
