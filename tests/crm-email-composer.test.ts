import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRUSTED_INTERNAL_CONTEXT, CrmApiRouter } from '../src/api/router';
import { createInMemoryRepository } from '../src/db/repository';
import {
  addBusinessDays,
  associationsForMailboxSend,
  canSendCrmEmailFromPermissions,
  countTimelineAssociations,
  defaultRecipientsForRecord,
  defaultTimelineAssociations,
  fillTemplateVars,
  followUpDueYmd,
  formatFollowUpOptionLabel,
  isWeekendOrHolidayYmd,
  timelineEventAppearsOn,
  todayYmd,
} from '../src/app/lib/email-composer';

const SRC = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('compositor de e-mail — dias úteis da tarefa', () => {
  const holidays = ['2026-11-20', '2026-12-25'];

  it('pula sábado, domingo e feriado ao somar dias úteis', () => {
    // quinta 12/11/2026 + 2 úteis = segunda 16/11 (pula sáb 14 e dom 15)
    assert.equal(addBusinessDays('2026-11-12', 2, holidays), '2026-11-16');
    // sexta 13/11 + 2 úteis = terça 17/11
    assert.equal(addBusinessDays('2026-11-13', 2, holidays), '2026-11-17');
    // quinta 19/11 + 1 útil = segunda 23/11 (pula feriado 20, sáb 21 e dom 22)
    assert.equal(addBusinessDays('2026-11-19', 1, holidays), '2026-11-23');
  });

  it('calcula cada opção e mostra o dia da semana da data', () => {
    // quinta 12/11/2026
    assert.equal(followUpDueYmd('tomorrow', '2026-11-12'), '2026-11-13');
    assert.equal(followUpDueYmd('business_2', '2026-11-12', null, holidays), '2026-11-16');
    assert.equal(followUpDueYmd('business_3', '2026-11-12', null, holidays), '2026-11-17');
    assert.equal(followUpDueYmd('week_1', '2026-11-12'), '2026-11-19');
    assert.equal(followUpDueYmd('week_2', '2026-11-12'), '2026-11-26');
    assert.equal(followUpDueYmd('month_1', '2026-11-12'), '2026-12-12');
    assert.equal(followUpDueYmd('custom', '2026-11-12', '2026-11-30'), '2026-11-30');
    const label = formatFollowUpOptionLabel('business_2', '2026-11-12', null, holidays);
    assert.match(label, /Em 2 dias úteis/);
    assert.match(label, /seg/);
    assert.match(label, /16\/11/);
    assert.match(formatFollowUpOptionLabel('tomorrow', '2026-11-12'), /Amanhã \(sex, 13\/11\)/);
  });

  it('todayYmd usa o fuso informado e isWeekendOrHolidayYmd reconhece fim de semana', () => {
    const thursday = new Date('2026-11-12T18:00:00-03:00');
    assert.equal(todayYmd(thursday, 'America/Sao_Paulo'), '2026-11-12');
    assert.equal(isWeekendOrHolidayYmd('2026-11-14'), true);
    assert.equal(isWeekendOrHolidayYmd('2026-11-13', []), false);
  });
});

describe('compositor de e-mail — destinatários por tipo de registro', () => {
  const ana = { id: 'ct-ana', email: 'ana@totvs.com', firstName: 'Ana', lastName: 'Silva' };
  const bruno = { id: 'ct-bruno', email: 'bruno@totvs.com', firstName: 'Bruno', lastName: 'Costa' };
  const semEmail = { id: 'ct-x', email: '', firstName: 'Sem' };
  const dup = { id: 'ct-ana-2', email: 'ANA@totvs.com', firstName: 'Ana', lastName: 'Outro' };

  it('contato usa só o e-mail do próprio registro', () => {
    const rec = defaultRecipientsForRecord({
      kind: 'contact',
      contact: ana,
      associatedContacts: [bruno],
    });
    assert.deepEqual(rec, [{ email: 'ana@totvs.com', name: 'Ana Silva', contactId: 'ct-ana' }]);
  });

  it('empresa e negócio incluem o contato principal e os associados, sem duplicar e-mail', () => {
    const companyRec = defaultRecipientsForRecord({
      kind: 'company',
      contact: ana,
      associatedContacts: [bruno, semEmail, dup],
    });
    assert.equal(companyRec.length, 2);
    assert.equal(companyRec[0].email, 'ana@totvs.com');
    assert.equal(companyRec[1].email, 'bruno@totvs.com');
    assert.equal(companyRec[1].contactId, 'ct-bruno');

    const dealRec = defaultRecipientsForRecord({
      kind: 'deal',
      contact: null,
      associatedContacts: [bruno, ana],
    });
    assert.equal(dealRec.length, 2);
    assert.equal(dealRec[0].contactId, 'ct-bruno');
  });
});

describe('compositor de e-mail — associação na timeline', () => {
  it('preenche negócio+contato+empresa no deal, e não leva negócio no contato/empresa', () => {
    const deal = defaultTimelineAssociations({
      kind: 'deal',
      deal: { id: 'd1', title: 'TOTVS Cloud' },
      contact: { id: 'c1', firstName: 'Ana', lastName: 'Silva', email: 'ana@totvs.com' },
      company: { id: 'co1', name: 'TOTVS' },
    });
    assert.equal(countTimelineAssociations(deal), 3);
    assert.deepEqual(associationsForMailboxSend(deal), {
      contactId: 'c1',
      companyId: 'co1',
      dealId: 'd1',
    });

    const contact = defaultTimelineAssociations({
      kind: 'contact',
      deal: { id: 'd1', title: 'não deve entrar' },
      contact: { id: 'c1', firstName: 'Ana', lastName: 'Silva' },
      company: { id: 'co1', name: 'TOTVS' },
    });
    assert.equal(contact.dealId, null);
    assert.equal(contact.companyId, 'co1');
    assert.equal(countTimelineAssociations(contact), 2);

    const company = defaultTimelineAssociations({
      kind: 'company',
      deal: { id: 'd1', title: 'não deve entrar' },
      contact: { id: 'c1', firstName: 'Ana' },
      company: { id: 'co1', name: 'TOTVS' },
    });
    assert.equal(company.dealId, null);
    assert.equal(company.contactId, 'c1');
    assert.equal(countTimelineAssociations(company), 2);
  });

  it('o mesmo evento aparece na timeline dos três registros associados', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const pipe = repo.createPipeline({
      name: 'Pipeline timeline e-mail',
      stages: [
        { id: 'st-email-tl', pipelineId: 'tmp', name: 'Aberta', order: 1, defaultProbability: 10, dealRottingDays: 14, isClosed: false, isWon: false },
      ],
    });
    const company = repo.createCompany({ name: 'Empresa Timeline', cnpj: '33.333.333/0001-33' });
    const contact = repo.createContact({ firstName: 'Lia', email: 'lia@exemplo.invalid', companyId: company.id });
    const deal = repo.createDeal({
      title: 'Negócio Timeline',
      value: 10,
      pipelineId: pipe.id,
      stageId: pipe.stages[0].id,
      companyId: company.id,
      contactId: contact.id,
    } as Parameters<typeof repo.createDeal>[0]);

    const assoc = defaultTimelineAssociations({
      kind: 'deal',
      deal: { id: deal.id, title: deal.title },
      contact: { id: contact.id, firstName: contact.firstName, email: contact.email },
      company: { id: company.id, name: company.name },
    });
    const created = await router.dispatch({
      context: TRUSTED_INTERNAL_CONTEXT,
      method: 'POST',
      path: '/api/timeline',
      body: {
        type: 'EMAIL',
        title: 'Assunto do e-mail',
        body: 'Prévia',
        ...associationsForMailboxSend(assoc),
      },
      query: {},
    });
    assert.equal(created.status, 201);
    const evt = (created.body as { data: { id: string; contactId: string; companyId: string; dealId: string } }).data;
    assert.equal(evt.contactId, contact.id);
    assert.equal(evt.companyId, company.id);
    assert.equal(evt.dealId, deal.id);
    assert.equal(timelineEventAppearsOn(evt, { contactId: contact.id }), true);
    assert.equal(timelineEventAppearsOn(evt, { companyId: company.id }), true);
    assert.equal(timelineEventAppearsOn(evt, { dealId: deal.id }), true);
    assert.equal(timelineEventAppearsOn(evt, { dealId: 'outro' }), false);

    const byDeal = await router.dispatch({
      context: TRUSTED_INTERNAL_CONTEXT,
      method: 'GET',
      path: '/api/timeline',
      query: { dealId: deal.id },
    });
    const byContact = await router.dispatch({
      context: TRUSTED_INTERNAL_CONTEXT,
      method: 'GET',
      path: '/api/timeline',
      query: { contactId: contact.id },
    });
    const byCompany = await router.dispatch({
      context: TRUSTED_INTERNAL_CONTEXT,
      method: 'GET',
      path: '/api/timeline',
      query: { companyId: company.id },
    });
    const idOf = (res: { body: unknown }) =>
      ((res.body as { data: Array<{ id: string }> }).data || []).map((e) => e.id);
    assert.ok(idOf(byDeal).includes(evt.id));
    assert.ok(idOf(byContact).includes(evt.id));
    assert.ok(idOf(byCompany).includes(evt.id));
  });
});

describe('compositor de e-mail — permissão, variáveis e UI', () => {
  it('envio fica fail-closed sem permissão conhecida', () => {
    assert.equal(canSendCrmEmailFromPermissions(null, 'deal'), false);
    assert.equal(canSendCrmEmailFromPermissions({}, 'deal'), false);
    assert.equal(canSendCrmEmailFromPermissions({ moduleAccess: { crm: false }, crmPermissions: { dealsFunnelAccess: 'EDIT' } }, 'deal'), false);
    assert.equal(canSendCrmEmailFromPermissions({ crmPermissions: { dealsFunnelAccess: 'NONE' } }, 'deal'), false);
    assert.equal(canSendCrmEmailFromPermissions({ crmPermissions: { dealsFunnelAccess: 'EDIT' } }, 'deal'), true);
    assert.equal(canSendCrmEmailFromPermissions({ crmPermissions: { contactsAccess: 'VIEW' } }, 'contact'), true);
    assert.equal(canSendCrmEmailFromPermissions({ crmPermissions: { contactsAccess: 'VIEW' } }, 'deal'), false);
  });

  it('preenche variáveis do contato, empresa e negócio no modelo', () => {
    const subject = fillTemplateVars('Proposta para {{company.name}}', {
      company: { name: 'TOTVS' },
    });
    const body = fillTemplateVars('Olá {{contact.firstName}} / {{firstName}}, negócio {{deal.title}} ({{deal.value}}).', {
      contact: { firstName: 'Ana', lastName: 'Silva' },
      deal: { title: 'Cloud', value: 1200 },
    });
    assert.equal(subject, 'Proposta para TOTVS');
    assert.equal(body, 'Olá Ana / Ana, negócio Cloud (1200).');
    assert.equal(fillTemplateVars('x {{desconhecida}}', {}), 'x {{desconhecida}}');
  });

  it('o compositor é uma janela flutuante compartilhada nas 3 fichas, com abas e itens desabilitados', () => {
    const modal = SRC('src/app/components/email/CrmEmailComposerModal.tsx');
    const section = SRC('src/app/components/email/CrmRecordEmailSection.tsx');
    const drawer = SRC('src/app/components/DealRecordDrawer.tsx');
    const contacts = SRC('src/app/components/ContactsCompaniesTab.tsx');
    const contactDrawer = SRC('src/app/components/ContactDetailDrawer.tsx');

    assert.match(modal, /fixed bottom-/);
    assert.match(modal, /aria-label="Minimizar"/);
    assert.match(modal, /aria-label="Expandir"/);
    assert.match(modal, /aria-label="Fechar"/);
    assert.match(modal, /Modelos/);
    assert.match(modal, /Sequências/);
    assert.match(modal, /Documentos/);
    assert.match(modal, /Meetings/);
    assert.match(modal, /Orçamentos/);
    assert.match(modal, /composer-tab-documents/);
    assert.match(modal, /composer-tab-meetings/);
    assert.match(modal, /disabled/);
    assert.match(modal, /Agendar envio/);
    assert.match(modal, /Criar uma tarefa de/);
    assert.match(modal, /Associado a/);
    assert.match(modal, /requestSignedProposalLink/);
    assert.match(modal, /\/api\/sequences\/enroll/);
    assert.match(modal, /mailboxApi\('\/send'/);
    assert.match(modal, /\/api\/timeline/);
    assert.match(modal, /\/api\/tasks/);
    assert.match(modal, /NO_SEND_PERMISSION_REASON/);
    assert.match(modal, /canSendEmail/);

    assert.match(section, /CrmEmailComposerModal/);
    assert.match(drawer, /CrmEmailComposerModal/);
    assert.match(contacts, /CrmEmailComposerModal|CrmRecordEmailSection/);
    assert.match(contactDrawer, /CrmEmailComposerModal|CrmRecordEmailSection/);
    assert.match(drawer, /canSendEmail/);
    assert.match(contacts, /canSendEmail|canSendContactEmail/);
  });
});
