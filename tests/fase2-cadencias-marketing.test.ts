// ============================================================================
// Fase 2 (Modulo C) — Cadencias Comerciais Avancadas + Menu Marketing / E-mails de Marketing
// ============================================================================
import { describe, it } from 'node:test';
import { TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';
import {
  OFFICIAL_10_CADENCE_STATES_CATALOG,
  OFFICIAL_13_EXIT_RULES_CATALOG,
  SequenceService,
  formatLocalYmd,
  getTimezoneOffsetMinutes,
} from '../src/modules/sequences/sequence-service';
import type { EmailSequence, MarketingEmailBroadcast } from '../src/db/types';
import {
  buildMarketingEmailsCsv,
  checkMarketingEmailHealth,
} from '../src/app/components/MarketingEmailsManager';

const SEQ_21D = 'seq-seta-21d-prospeccao';
const CONTACT = 'cont-marina';

function freshEnrollment() {
  const repo = createInMemoryRepository();
  const svc = new SequenceService();
  const { enrollment } = svc.enrollContact(repo, {
    sequenceId: SEQ_21D,
    contactId: CONTACT,
    forceMoveFromConflicting: true,
    allowReentryOverride: true,
  });
  return { repo, svc, enrollment };
}

describe('Fase 2 — catálogo: cadência de 21 dias, 13 regras de saída e 10 estados', () => {
  it('seed possui a cadência seq-seta-21d com 7 passos nos dias 1,3,5,7,10,14,21 e 13 regras', () => {
    const repo = createInMemoryRepository();
    const seq = repo.getSequenceById(SEQ_21D) as EmailSequence;
    assert.ok(seq, 'cadência de 21 dias deve existir no seed');
    assert.deepEqual(
      seq.steps.map((s) => s.dayOffset),
      [1, 3, 5, 7, 10, 14, 21]
    );
    assert.equal(seq.exitRules?.length, 13);
    assert.ok(seq.sendingWindow && seq.sendingWindow.dailyMailboxSendLimit > 0);
  });

  it('13 regras com gatilhos únicos e 10 estados canônicos únicos', () => {
    assert.equal(OFFICIAL_13_EXIT_RULES_CATALOG.length, 13);
    assert.equal(new Set(OFFICIAL_13_EXIT_RULES_CATALOG.map((r) => r.trigger)).size, 13);
    assert.equal(OFFICIAL_10_CADENCE_STATES_CATALOG.length, 10);
    assert.equal(new Set(OFFICIAL_10_CADENCE_STATES_CATALOG.map((s) => s.state)).size, 10);
  });

  for (const rule of OFFICIAL_13_EXIT_RULES_CATALOG) {
    it(`regra ${rule.trigger} leva ao estado ${rule.targetCanonicalState} e respeita a assinatura global`, () => {
      const { repo, svc, enrollment } = freshEnrollment();
      const res = svc.evaluateExitRule(repo, { enrollmentId: enrollment.id, trigger: rule.trigger });
      assert.equal(res.canonicalState, rule.targetCanonicalState);
      assert.equal(res.globalSubscriptionPreserved, rule.preservesGlobalSubscription);
      const contact = repo.getContactById(CONTACT);
      if (rule.preservesGlobalSubscription) {
        assert.notEqual(contact?.subscriptionStatus, 'UNSUBSCRIBED_MARKETING');
      }
    });
  }
});

describe('Fase 2 — janela comercial com fuso do destinatário', () => {
  const svc = new SequenceService();

  it('calcula offsets de fuso via Intl', () => {
    assert.equal(getTimezoneOffsetMinutes(new Date('2026-10-29T12:00:00Z'), 'America/Sao_Paulo'), -180);
    assert.equal(getTimezoneOffsetMinutes(new Date('2026-10-29T12:00:00Z'), 'America/Manaus'), -240);
    assert.equal(getTimezoneOffsetMinutes(new Date('2026-10-29T12:00:00Z'), 'Fuso/Invalido'), 0);
    assert.equal(formatLocalYmd(new Date('2026-10-30T02:00:00Z'), 'America/Sao_Paulo'), '2026-10-29');
  });

  it('sexta 20h (SP) pula fim de semana e feriado de Finados, agenda terça 08:30 hora local', () => {
    const r = svc.calculateNextBusinessExecutionWindow({
      baseDate: '2026-10-30T23:00:00.000Z',
      delayDays: 0,
      recipientTimezone: 'America/Sao_Paulo',
    });
    assert.equal(r.scheduledAtIso, '2026-11-03T11:30:00.000Z');
    assert.equal(r.scheduledLocalDisplay, '2026-11-03 08:30');
    assert.ok(r.skippedHolidayDates.includes('2026-11-02'));
    assert.equal(r.skippedWeekendDays, 2);
    assert.equal(r.timezoneUsed, 'America/Sao_Paulo');
  });

  it('respeita o fuso do destinatário (Manaus 08:00 -> 08:30 local)', () => {
    const manaus = svc.calculateNextBusinessExecutionWindow({
      baseDate: '2026-10-29T12:00:00.000Z',
      recipientTimezone: 'America/Manaus',
    });
    assert.equal(manaus.scheduledAtIso, '2026-10-29T12:30:00.000Z');
    const sp = svc.calculateNextBusinessExecutionWindow({
      baseDate: '2026-10-29T12:00:00.000Z',
      recipientTimezone: 'America/Sao_Paulo',
    });
    assert.equal(sp.scheduledAtIso, '2026-10-29T12:00:00.000Z');
    assert.equal(sp.adjustedForBusinessHours, false);
  });
});

describe('Fase 2 — limite diário por caixa postal', () => {
  it('bloqueia inscrição quando o limite do dia foi atingido e zera na virada do dia', () => {
    const repo = createInMemoryRepository();
    const svc = new SequenceService();
    const seq = repo.getSequenceById(SEQ_21D) as EmailSequence;
    const today = formatLocalYmd(new Date(), seq.sendingWindow!.defaultTimezone);
    seq.sendingWindow!.currentTodaySent = seq.sendingWindow!.dailyMailboxSendLimit;
    seq.sendingWindow!.currentTodayDate = today;
    assert.throws(
      () => svc.enrollContact(repo, { sequenceId: SEQ_21D, contactId: CONTACT, forceMoveFromConflicting: true, allowReentryOverride: true }),
      /Limite diário da caixa postal/
    );
    seq.sendingWindow!.currentTodayDate = '2000-01-01';
    const { sequence } = svc.enrollContact(repo, {
      sequenceId: SEQ_21D,
      contactId: CONTACT,
      forceMoveFromConflicting: true,
      allowReentryOverride: true,
    });
    assert.equal(sequence.sendingWindow!.currentTodaySent, 1);
    assert.equal(sequence.sendingWindow!.currentTodayDate, today);
  });

  it('adia o próximo passo de e-mail sem avançar a inscrição quando o limite é atingido', () => {
    const { repo, svc, enrollment } = freshEnrollment();
    const seq = repo.getSequenceById(SEQ_21D) as EmailSequence;
    seq.sendingWindow!.currentTodaySent = seq.sendingWindow!.dailyMailboxSendLimit;
    const res = svc.advanceStep(repo, enrollment.id);
    assert.equal(res.deferredByMailboxLimit, true);
    assert.equal(res.enrollment.currentStepOrder, 1);
    assert.equal(res.enrollment.history[res.enrollment.history.length - 1].action, 'DEFERRED_MAILBOX_LIMIT');
    assert.ok(res.enrollment.nextStepDueAt && new Date(res.enrollment.nextStepDueAt).getTime() > Date.now());
  });
});

describe('Fase 2 — versionamento e clonagem via /api/sequences', () => {
  it('UPDATE_SEQUENCE gera nova versão com snapshot; CLONE cria v1 sem histórico', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const before = repo.getSequenceById(SEQ_21D) as EmailSequence;
    const v0 = before.version || 1;
    const newSteps = before.steps.map((s) => ({ ...s, subject: `${s.subject} (rev)` }));
    const upd = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT,
      method: 'POST',
      path: '/api/sequences',
      body: { action: 'UPDATE_SEQUENCE', sequenceId: SEQ_21D, updates: { steps: newSteps } },
    });
    assert.equal(upd.status, 200);
    const updated = (upd.body as { data: EmailSequence }).data;
    assert.equal(updated.version, v0 + 1);
    assert.equal(updated.versionHistory?.[0].version, v0);
    assert.deepEqual(updated.versionHistory?.[0].changedFields, ['steps']);
    assert.ok(!updated.versionHistory?.[0].steps[0].subject.endsWith('(rev)'));

    const cl = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT,
      method: 'POST',
      path: '/api/sequences',
      body: { action: 'CLONE_SEQUENCE', sequenceId: SEQ_21D, newName: 'Cópia 21 dias' },
    });
    assert.equal(cl.status, 201);
    const cloned = (cl.body as { data: EmailSequence }).data;
    assert.equal(cloned.name, 'Cópia 21 dias');
    assert.equal(cloned.version, 1);
    assert.deepEqual(cloned.versionHistory || [], []);
    assert.equal(cloned.steps.length, 7);
    assert.equal(cloned.sentCount, 0);
  });
});

describe('Marketing — 14 e-mails de marketing e menu lateral', () => {
  it('GET /api/marketing/emails retorna os 14 e-mails e CLONE cria rascunho com data atual', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const list = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'GET', path: '/api/marketing/emails' });
    assert.equal(list.status, 200);
    const emails = (list.body as { data: MarketingEmailBroadcast[] }).data;
    assert.equal(emails.length, 14);

    const cl = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT,
      method: 'POST',
      path: '/api/marketing/emails',
      body: { action: 'CLONE', emailId: emails[0].id },
    });
    assert.equal(cl.status, 201);
    const cloned = (cl.body as { data: MarketingEmailBroadcast }).data;
    assert.equal(cloned.status, 'DRAFT');
    assert.match(cloned.updatedAtDisplay, /^\d{1,2} de [A-Za-zç]+ de \d{4} \d{2}:\d{2}$/);
    assert.equal(repo.listMarketingEmails().length, 15);
  });

  it('CSV de exportação contém cabeçalho com as colunas da listagem e uma linha por e-mail', () => {
    const repo = createInMemoryRepository();
    const emails = repo.listMarketingEmails();
    const csv = buildMarketingEmailsCsv(emails);
    const lines = csv.replace(/^\uFEFF/, '').split('\n');
    assert.equal(lines[0], 'Nome;Status;Tipo;Entregue;Taxa de abertura;Taxa de cliques;Última atualização;Atualizado por;Data de envio');
    assert.equal(lines.length, 15);
    // Integridade: o e-mail "(Clonar)" do seed deve gerar alerta
    const clonedName = emails.find((e) => /\(Clonar\)/.test(e.name));
    assert.ok(clonedName && checkMarketingEmailHealth(clonedName).some((i) => i.includes('Clonar')));
  });

  it('barra lateral do CRM exibe o menu Marketing expansível com os 4 subitens e mantém Fluxos de Automação', () => {
    const root = process.cwd();
    const sidebar = fs.readFileSync(path.join(root, 'src/app/components/CrmSidebar.tsx'), 'utf8');
    for (const label of ['E-mails de Marketing', 'Campanhas & ROI', 'Segmentos & Lead Scoring', 'Formulários & Leads']) {
      assert.ok(sidebar.includes(`label: '${label}'`), `subitem ${label}`);
    }
    assert.ok(sidebar.includes('<span className="truncate">Marketing</span>'));
    assert.ok(sidebar.includes('Fluxos de Automação'));
    assert.ok(sidebar.includes('marketingEmailsCount'));
    const page = fs.readFileSync(path.join(root, 'src/app/page.tsx'), 'utf8');
    assert.ok(page.includes('onSelectMarketingSubView'));
    assert.ok(page.includes('marketingView={marketingSubView}'));
    const mgr = fs.readFileSync(path.join(root, 'src/app/components/MarketingEmailsManager.tsx'), 'utf8');
    for (const t of ['Gerenciar', 'Modelos', 'Analisar', 'Integridade', 'Todos os e-mails', 'Rascunhos', 'Programados', 'Enviados', 'Arquivada', 'Exportar CSV', 'Data de envio', 'Atualizado por']) {
      assert.ok(mgr.includes(t), `tela de e-mails deve conter "${t}"`);
    }
  });

  it('arquivos da Fase 2 / Marketing não contêm emojis', () => {
    const root = process.cwd();
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{FE0F}]/u;
    for (const f of [
      'src/app/components/CrmSidebar.tsx',
      'src/app/components/MarketingEmailsManager.tsx',
      'src/app/components/MarketingAndSalesHubSuites.tsx',
      'src/app/components/SequenceCadenceStudio.tsx',
      'src/app/components/SequencesSection.tsx',
      'src/app/components/FormsBuilderTab.tsx',
    ]) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      assert.ok(!emoji.test(src), `${f} contém emoji`);
    }
  });
});
