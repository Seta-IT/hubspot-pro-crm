import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import {
  FOLLOWUP_DEFAULT_TEMPLATES,
  FOLLOWUP_SCHEDULE_OFFSET_DAYS,
  FOLLOWUP_TRIGGER_STAGES,
  isProposalFollowupEnabled,
} from '../src/modules/deals/proposal-followup-config';
import {
  civilDateInTimezone,
  formatFollowupStatus,
  getFollowupStatus,
  isFollowupTriggerStage,
  nextBusinessInstant,
  pauseFollowup,
  processDueFollowups,
  renderFollowupTemplate,
  resumeFollowup,
  scheduleFollowupStep,
  stopFollowupForDeal,
  stopFollowupForProposal,
  type FollowupSendDeps,
} from '../src/modules/deals/proposal-followup-service';

const FLAG = 'FOLLOWUP_SEQUENCE_ENABLED';
const savedFlag = process.env[FLAG];

function setFlag(on: boolean) {
  if (on) process.env[FLAG] = 'true';
  else delete process.env[FLAG];
}

afterEach(() => {
  if (savedFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = savedFlag;
});


function enrollDeal(repo: ReturnType<typeof createInMemoryRepository>, dealId: string, enteredAt = new Date('2026-11-02T12:00:00.000Z')) {
  const d = repo.getDealById(dealId)!;
  if (d.stageId === 'stage-proposal') repo.updateDeal(dealId, { stageId: 'stage-discovery' });
  repo.updateDeal(dealId, { stageId: 'stage-proposal' });
  const enr = repo.getActiveProposalFollowup(dealId);
  if (!enr) return undefined;
  enr.enteredAt = enteredAt.toISOString();
  enr.nextSendAt = scheduleFollowupStep(enteredAt, 0, enteredAt).toISOString();
  repo.saveProposalFollowupEnrollment(enr);
  return enr;
}

let testDealSeq = 0;
function createEnrollableDeal(repo: ReturnType<typeof createInMemoryRepository>, enteredAt = new Date('2026-11-02T12:00:00.000Z')) {
  testDealSeq += 1;
  const n = testDealSeq;
  const contact = repo.createContact({
    firstName: 'Contato',
    lastName: `Followup ${n}`,
    email: `followup.teste.${n}@empresa${n}.com.br`,
    companyName: `Empresa Followup ${n}`,
    lgpdConsent: true,
    subscriptionStatus: 'SUBSCRIBED',
  });
  const deal = repo.createDeal({
    title: `Negócio follow-up ${n}`,
    value: 10000,
    pipelineId: 'pipe-enterprise-b2b',
    stageId: 'stage-discovery',
    contactId: contact.id,
    companyId: contact.companyId,
    ownerId: 'owner-marcello',
    ownerName: 'Marcelo Lopes Mira',
    status: 'OPEN',
  });
  const enr = enrollDeal(repo, deal.id, enteredAt);
  if (!enr) throw new Error(`falha ao inscrever negócio sintético ${deal.id}`);
  return { deal, contact, enr };
}

function mockSend(): FollowupSendDeps & { sent: Array<{ subject: string; to: string[]; trackingId: string }>; messages: Array<{ direction: string; conversationId?: string | null; trackingId?: string | null; clickCount?: number }> } {
  const sent: Array<{ subject: string; to: string[]; trackingId: string }> = [];
  const messages: Array<{ direction: string; conversationId?: string | null; trackingId?: string | null; clickCount?: number }> = [];
  return {
    sent,
    messages,
    async listAccounts(ownerEmail: string) {
      return [{ id: 'mbx-test', ownerEmail, mailboxAddress: ownerEmail || 'vendas@setatelecom.com.br', status: 'ATIVADO' }];
    },
    async listDealMessages() {
      return messages;
    },
    async sendMail(input) {
      sent.push({ subject: input.subject, to: input.to, trackingId: input.trackingId });
      messages.push({ direction: 'ENVIADO', conversationId: 'conv-1', trackingId: input.trackingId, clickCount: 0 });
      return { id: `eml-${sent.length}`, conversationId: 'conv-1', trackingId: input.trackingId };
    },
  };
}

describe('Sequência de follow-up da proposta enviada', () => {
  it('a agenda tem 9 passos com intervalos crescentes e a flag começa desligada', () => {
    assert.deepEqual([...FOLLOWUP_SCHEDULE_OFFSET_DAYS], [2, 5, 9, 12, 17, 24, 32, 40, 49]);
    delete process.env[FLAG];
    assert.equal(isProposalFollowupEnabled(), false);
    process.env[FLAG] = 'true';
    assert.equal(isProposalFollowupEnabled(), true);
  });

  it('mapeia a etapa equivalente quando o funil não tem "Proposta Enviada"', () => {
    assert.equal(isFollowupTriggerStage('pipe-enterprise-b2b', 'stage-proposal'), true);
    assert.equal(isFollowupTriggerStage('pipeline-locacao-equipamentos', 'stage-loc-simulacao'), true);
    assert.equal(isFollowupTriggerStage('pipeline-expansao-renovacao', 'stage-exp-proposta'), true);
    assert.equal(isFollowupTriggerStage('pipeline-cotacoes-compras', 'stage-cot-rfq'), false);
    assert.equal(FOLLOWUP_TRIGGER_STAGES.filter((s) => s.match === 'equivalent').map((s) => s.stageId).sort().join(','), 'stage-exp-proposta,stage-loc-simulacao');
  });

  it('agenda D2 num sábado para a segunda-feira seguinte, às 08:30 em São Paulo', () => {
    // Sexta 6/11/2026 15:00 SP: D2 = domingo 8/11 -> segunda 9/11 08:30 SP.
    const entered = new Date('2026-11-06T18:00:00.000Z'); // 15:00 SP (UTC-3)
    const due = scheduleFollowupStep(entered, 0);
    assert.equal(civilDateInTimezone(due), '2026-11-09');
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(due);
    const g = (t: string) => parts.find((p) => p.type === t)?.value;
    assert.equal(`${g('hour')}:${g('minute')}`, '08:30');
    const holiday = nextBusinessInstant(new Date('2026-04-21T12:00:00.000Z')); // Tiradentes (terça)
    assert.equal(civilDateInTimezone(holiday), '2026-04-22');
  });

  it('substitui {contato}, {empresa}, {negocio}, {link_proposta} e {vendedor}', () => {
    const out = renderFollowupTemplate(
      'Olá, {contato} da {empresa} sobre {negocio}. {link_proposta} — {vendedor}',
      { contato: 'Ana', empresa: 'Totvs', negocio: 'PABX', link_proposta: 'https://sti-hub.vercel.app/p/abc', vendedor: 'Evelyn' }
    );
    assert.equal(out, 'Olá, Ana da Totvs sobre PABX. https://sti-hub.vercel.app/p/abc — Evelyn');
    assert.match(renderFollowupTemplate('Oi {{contact.firstName}} ({{company.name}})', { contato: 'Ana', empresa: 'Totvs', negocio: 'x', link_proposta: '', vendedor: 'E' }), /Oi Ana \(Totvs\)/);
  });

  it('com a flag desligada, mudar de etapa não inscreve e o cron não envia', async () => {
    setFlag(false);
    const repo = createInMemoryRepository();
    const deal = repo.listDeals().find((d) => d.id === 'deal-loggi-discovery');
    assert.ok(deal);
    repo.updateDeal(deal!.id, { stageId: 'stage-proposal' });
    assert.equal(repo.getLatestProposalFollowup(deal!.id), undefined);
    const deps = mockSend();
    const result = await processDueFollowups(repo, deps, new Date());
    assert.equal(result.enabled, false);
    assert.equal(result.sent, 0);
    assert.equal(deps.sent.length, 0);
  });

  it('inscreve ao entrar na etapa, envia no vencimento, é idempotente e respeita o limite por execução', async () => {
    setFlag(true);
    const repo = createInMemoryRepository();
    const deal = repo.listDeals().find((d) => d.id === 'deal-loggi-discovery')!;
    const entered = new Date('2026-11-02T12:00:00.000Z'); // segunda
    const enr = enrollDeal(repo, deal.id, entered);
    assert.ok(enr);
    assert.equal(enr!.status, 'ACTIVE');
    assert.equal(enr!.nextStepIndex, 0);
    const deps = mockSend();
    const beforeDue = await processDueFollowups(repo, deps, new Date('2026-11-03T12:00:00.000Z'));
    assert.equal(beforeDue.sent, 0);
    const first = await processDueFollowups(repo, deps, new Date('2026-11-04T12:00:00.000Z')); // D2
    assert.equal(first.sent, 1);
    assert.equal(deps.sent.length, 1);
    assert.match(deps.sent[0].subject, /Loggi|proposta|Proposta/i);
    const again = await processDueFollowups(repo, deps, new Date('2026-11-04T13:00:00.000Z'));
    assert.equal(again.sent, 0);
    assert.equal(deps.sent.length, 1);
    assert.equal(repo.getLatestProposalFollowup(deal.id)!.sentCount, 1);
    const evts = repo.listTimelineEvents({ dealId: deal.id, type: 'EMAIL' });
    assert.ok(evts.some((e) => /Follow-up da proposta enviado/.test(e.title)));
    // restante da agenda não vence ainda; limite 0 não envia o próximo mesmo se vencido
    const limited = await processDueFollowups(repo, deps, new Date('2026-12-31T12:00:00.000Z'), 0);
    assert.equal(limited.sent, 0);
  });

  it('para na resposta, no clique, na visualização/aceite da proposta, na mudança de etapa, no ganho/perda e na pausa manual — e o pixel de abertura não para', async () => {
    setFlag(true);
    const repo = createInMemoryRepository();
    const nextEnroll = () => createEnrollableDeal(repo);

    const a = nextEnroll();
    stopFollowupForDeal(repo, a.deal.id, 'EMAIL_REPLY');
    assert.equal(repo.getLatestProposalFollowup(a.deal.id)!.stopReason, 'EMAIL_REPLY');

    const b = nextEnroll();
    const deps = mockSend();
    await processDueFollowups(repo, deps, new Date('2026-11-04T12:00:00.000Z'));
    assert.equal(repo.getLatestProposalFollowup(b.deal.id)!.sentCount, 1);
    deps.messages[0].clickCount = 1;
    const afterClick = await processDueFollowups(repo, deps, new Date('2026-11-07T12:00:00.000Z'));
    assert.ok(afterClick.stopped >= 1);
    assert.equal(repo.getLatestProposalFollowup(b.deal.id)!.stopReason, 'EMAIL_CLICK');

    const c = nextEnroll();
    stopFollowupForProposal(repo, { dealId: c.deal.id }, 'PROPOSAL_VIEW');
    assert.equal(repo.getLatestProposalFollowup(c.deal.id)!.stopReason, 'PROPOSAL_VIEW');

    const d = nextEnroll();
    stopFollowupForProposal(repo, { dealId: d.deal.id }, 'PROPOSAL_ACCEPT');
    assert.equal(repo.getLatestProposalFollowup(d.deal.id)!.stopReason, 'PROPOSAL_ACCEPT');

    const e = nextEnroll();
    assert.ok(repo.getActiveProposalFollowup(e.deal.id));
    repo.updateDeal(e.deal.id, { stageId: 'stage-negotiation' });
    assert.equal(repo.getLatestProposalFollowup(e.deal.id)!.stopReason, 'STAGE_CHANGED');

    const f = nextEnroll();
    repo.updateDeal(f.deal.id, { stageId: 'stage-won' });
    assert.equal(repo.getLatestProposalFollowup(f.deal.id)!.stopReason, 'DEAL_WON');

    const g = nextEnroll();
    pauseFollowup(repo, g.deal.id);
    assert.equal(getFollowupStatus(repo, g.deal.id).statusLabel, 'Pausada');
    assert.equal(getFollowupStatus(repo, g.deal.id).canResume, true);
    const deps2 = mockSend();
    await processDueFollowups(repo, deps2, new Date('2026-11-04T12:00:00.000Z'));
    assert.equal(deps2.sent.length, 0);
    resumeFollowup(repo, g.deal.id, new Date('2026-11-04T12:00:00.000Z'));
    assert.equal(getFollowupStatus(repo, g.deal.id).statusLabel, 'Ativa');

    stopFollowupForDeal(repo, g.deal.id, 'EMAIL_OPEN' as 'EMAIL_CLICK');
    assert.equal(repo.getLatestProposalFollowup(g.deal.id)!.status, 'ACTIVE');
    assert.equal(repo.getLatestProposalFollowup(g.deal.id)!.stopReason, null);
  });

  it('não envia para contato sem e-mail válido nem para quem cancelou a inscrição ou o consentimento LGPD', () => {
    setFlag(true);
    const repo = createInMemoryRepository();
    const deal = repo.getDealById('deal-loggi-discovery')!;
    const contact = repo.getContactById(deal.contactId!)!;
    repo.updateContact(contact.id, { isValidEmail: false });
    repo.updateDeal(deal.id, { stageId: 'stage-proposal', stageEnteredAt: '2026-11-02T12:00:00.000Z' });
    assert.equal(repo.getLatestProposalFollowup(deal.id)?.stopReason, 'NO_VALID_EMAIL');

    const other = repo.listDeals().find((d) => d.status === 'OPEN' && d.stageId !== 'stage-proposal' && d.contactId && d.id !== deal.id)!;
    const c2 = repo.getContactById(other.contactId!)!;
    repo.updateContact(c2.id, { lgpdConsent: false, subscriptionStatus: 'UNSUBSCRIBED_MARKETING' });
    repo.updateDeal(other.id, { stageId: 'stage-proposal', stageEnteredAt: '2026-11-02T12:00:00.000Z' });
    assert.equal(repo.getLatestProposalFollowup(other.id)?.stopReason, 'UNSUBSCRIBED');
  });

  it('o cron autenticado internamente devolve enabled=false com a flag desligada; pausar e retomar passam no detalhe', async () => {
    setFlag(false);
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const cron = await router.dispatch({
      method: 'GET',
      path: '/api/crm/proposal-followup',
      query: {},
      body: {},
      context: TRUSTED_INTERNAL_CONTEXT,
    });
    assert.equal(cron.status, 200);
    assert.equal((cron.body as { data: { enabled: boolean; sent: number } }).data.enabled, false);
    assert.equal((cron.body as { data: { sent: number } }).data.sent, 0);

    setFlag(true);
    const deal = repo.getDealById('deal-loggi-discovery')!;
    repo.updateDeal(deal.id, { stageId: 'stage-proposal', stageEnteredAt: '2026-11-02T12:00:00.000Z' });
    const paused = await router.dispatch({
      method: 'POST',
      path: `/api/deals/${deal.id}/proposal-followup`,
      query: {},
      body: { action: 'pause' },
      context: TRUSTED_INTERNAL_CONTEXT,
    });
    assert.equal(paused.status, 200);
    assert.equal((paused.body as { data: { statusLabel: string } }).data.statusLabel, 'Pausada');
    const src = readFileSync(join(process.cwd(), 'src/app/components/DealRecordDrawer.tsx'), 'utf8');
    assert.ok(src.includes('data-testid="proposal-followup-status"'));
    assert.ok(src.includes('Pausar'));
    const vw = readFileSync(join(process.cwd(), 'vercel.json'), 'utf8');
    assert.ok(vw.includes('/api/crm/proposal-followup'));
  });
});
