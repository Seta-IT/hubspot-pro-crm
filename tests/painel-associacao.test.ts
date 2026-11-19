// ============================================================================
// STI-hub — Painel de associacao (Criar novo | Adicionar existente) e janelas de atividade
// (Observacao, Tarefa, Reuniao, Mais) da ficha do negocio. Busca no servidor (nome, e-mail,
// telefone, CNPJ; sem acento/caixa), total, ordenacao, paginacao; associacoes extras do
// negocio em customProperties; payloads das rotas existentes /api/timeline e /api/tasks.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import { dealMatchesAssociationSearch, parseAssociationSort, sortForAssociation } from '../src/api/association-search';
import {
  buildAssociationSearchUrl,
  buildCreateBody,
  buildDealAssociationPatch,
  contactRowLabel,
  createSecondaryEnabled,
  createValid,
  pageWindow,
  parseAssociationSearchResponse,
  prefillFromQuery,
  readAssocIds,
  totalPages,
} from '../src/app/lib/association-panel';
import {
  addBusinessDays,
  agendaFromSources,
  assocLabel,
  buildLogPayload,
  buildMeetingPayload,
  buildNotePayload,
  buildTaskPayload,
  dueOptions,
  filterMoreOptions,
  followUpTaskFromNote,
  MORE_ACTIVITY_OPTIONS,
  startOfWeek,
  weekRangeLabel,
} from '../src/app/lib/activity-composer';
import AssociationSidePanel from '../src/app/components/AssociationSidePanel';
import { MeetingSchedulerModal, MoreActivitiesMenu, NoteWindow, TaskWindow } from '../src/app/components/ActivityWindows';

const src = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');
const get = async (router: CrmApiRouter, path: string, query: Record<string, string>) =>
  (await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'GET', path, query })) as { status: number; body: any };
const post = async (router: CrmApiRouter, path: string, body: Record<string, unknown>) =>
  (await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path, body })) as { status: number; body: any };

describe('Painel de associacao: busca no servidor', () => {
  it('GET /api/contacts busca e-mail sem acento/caixa, devolve total e pagina', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const c = await post(router, '/api/contacts', { firstName: 'Válmir', lastName: 'Deus', email: 'valmir.deus@la.nec.com', phone: '+55 11 98888-7777' });
    assert.ok(c.status < 300, JSON.stringify(c.body));
    for (const q of ['valmir.deus@la.nec.com', 'VALMIR', 'válmir deus', '98888']) {
      const r = await get(router, '/api/contacts', { search: q, sort: 'recent', limit: '10', offset: '0' });
      assert.equal(r.status, 200);
      assert.ok(r.body.data.some((x: any) => x.email === 'valmir.deus@la.nec.com'), q);
      assert.equal(typeof r.body.total, 'number');
    }
    const all = await get(router, '/api/contacts', { sort: 'name_asc', limit: '2', offset: '0' });
    assert.equal(all.body.data.length <= 2, true);
    assert.ok(all.body.total >= all.body.data.length);
    const p2 = await get(router, '/api/contacts', { sort: 'name_asc', limit: '2', offset: '2' });
    if (all.body.total > 2) assert.notEqual(p2.body.data[0]?.id, all.body.data[0]?.id);
  });

  it('GET /api/deals filtra por busca, pagina e mantem o forecast de todos', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const full = await get(router, '/api/deals', {});
    assert.equal(full.status, 200);
    const page = await get(router, '/api/deals', { limit: '1', offset: '0', sort: 'name_asc' });
    assert.equal(page.body.data.length <= 1, true);
    assert.equal(page.body.total, full.body.data.length);
    assert.deepEqual(page.body.forecast, full.body.forecast);
    const first = full.body.data[0];
    if (first) {
      const r = await get(router, '/api/deals', { search: String(first.title).toUpperCase(), limit: '10' });
      assert.ok(r.body.data.some((d: any) => d.id === first.id));
    }
  });

  it('ordenacao e filtro de negocio', () => {
    assert.equal(parseAssociationSort('name_desc'), 'name_desc');
    assert.equal(parseAssociationSort('drop table'), null);
    const l = [
      { id: 'a', n: 'Érico', createdAt: '2026-01-01' },
      { id: 'b', n: 'abel', createdAt: '2026-03-01' },
      { id: 'c', n: 'Carla', createdAt: '2026-02-01' },
    ];
    assert.deepEqual(sortForAssociation(l, 'recent', (x) => x.n).map((x) => x.id), ['b', 'c', 'a']);
    assert.deepEqual(sortForAssociation(l, 'oldest', (x) => x.n).map((x) => x.id), ['a', 'c', 'b']);
    assert.deepEqual(sortForAssociation(l, 'name_asc', (x) => x.n).map((x) => x.id), ['b', 'c', 'a']);
    assert.equal(sortForAssociation(l, null, (x) => x.n), l);
    const d = { title: 'Locação NEC', company: { name: 'NEC Brasil', cnpj: '12.345.678/0001-90' }, contact: { firstName: 'Valmir', email: 'valmir.deus@la.nec.com', phone: '11 3333-4444' } };
    assert.equal(dealMatchesAssociationSearch(d, 'locacao'), true);
    assert.equal(dealMatchesAssociationSearch(d, '12345678'), true);
    assert.equal(dealMatchesAssociationSearch(d, 'la.nec.com'), true);
    assert.equal(dealMatchesAssociationSearch(d, 'outra'), false);
  });
});

describe('Painel de associacao: regras do cliente', () => {
  it('URL, resposta, paginas e rotulo', () => {
    assert.equal(buildAssociationSearchUrl('contacts', { q: ' a@b.com ', sort: 'recent', page: 3, pageSize: 25 }), '/api/contacts?search=a%40b.com&sort=recent&limit=25&offset=50');
    assert.equal(buildAssociationSearchUrl('tickets', { q: '', sort: 'recent', page: 1, pageSize: 10 }), '/api/tickets?limit=10&offset=0');
    const r = parseAssociationSearchResponse('contacts', { data: [{ id: 'c1', email: 'x@y.com' }], total: 8353 });
    assert.equal(r.total, 8353);
    assert.equal(r.rows[0].label, 'x@y.com');
    assert.equal(contactRowLabel({ id: '1', firstName: 'Ana', lastName: 'Lima', email: 'ana@x.com' }), 'Ana Lima (ana@x.com)');
    assert.equal(totalPages(8353, 10), 836);
    assert.deepEqual(pageWindow(1, 836), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(pageWindow(836, 836).at(-1), 836);
    assert.deepEqual(pageWindow(1, 2), [1, 2]);
  });

  it('Criar novo: campos esmaecidos ate nome/e-mail; e-mail buscado vira prefill', () => {
    assert.equal(createSecondaryEnabled('contacts', {}), false);
    assert.equal(createSecondaryEnabled('contacts', { email: 'v@x.com' }), true);
    assert.equal(createValid('contacts', { email: 'invalido' }), false);
    assert.equal(createValid('contacts', { email: 'valmir.deus@la.nec.com' }), true);
    assert.deepEqual(prefillFromQuery('contacts', 'valmir.deus@la.nec.com'), { email: 'valmir.deus@la.nec.com' });
    const body = buildCreateBody('contacts', { email: 'valmir.deus@la.nec.com' }, { ownerName: 'Marcéllo' });
    assert.equal(body.firstName, 'valmir.deus');
    assert.equal(body.ownerName, 'Marcéllo');
  });

  it('associacoes do negocio: principal vazio recebe o 1o, demais em customProperties mesclado', () => {
    const deal = { id: 'd1', contactId: null, companyId: 'co1', customProperties: { foo: 1, associatedCompanyIds: ['co2'] } };
    const p1 = buildDealAssociationPatch(deal, 'contacts', ['c1', 'c2']);
    assert.equal(p1.contactId, 'c1');
    assert.deepEqual((p1.customProperties as any).associatedContactIds, ['c2']);
    assert.equal((p1.customProperties as any).foo, 1, 'nao perde propriedades');
    const p2 = buildDealAssociationPatch(deal, 'companies', ['co3', 'co2']);
    assert.equal(p2.companyId, undefined);
    assert.deepEqual(readAssocIds(p2.customProperties as any, 'companies').sort(), ['co2', 'co3']);
    const p3 = buildDealAssociationPatch(deal, 'deals', ['d1', 'd9']);
    assert.deepEqual(readAssocIds(p3.customProperties as any, 'deals'), ['d9'], 'nao associa a si mesmo');
  });

  it('PATCH /api/deals/:id grava as associacoes extras', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const deal = (await get(router, '/api/deals', {})).body.data[0];
    const patch = buildDealAssociationPatch(deal, 'tickets', ['tk-1']);
    const r = (await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'PATCH', path: `/api/deals/${deal.id}`, body: patch })) as any;
    assert.ok(r.status < 300, JSON.stringify(r.body));
    const after = repo.listDeals().find((d: any) => d.id === deal.id) as any;
    assert.deepEqual(readAssocIds(after.customProperties, 'tickets'), ['tk-1']);
  });

  it('render: painel com Salvar/Cancelar, abas e contador; Criar novo esmaecido', () => {
    const html = renderToStaticMarkup(
      React.createElement(AssociationSidePanel, { kind: 'contacts', associatedIds: [], onSave: async () => {}, onClose: () => {}, canCreate: true })
    );
    for (const t of ['Criar novo', 'Adicionar existente', 'Salvar', 'Cancelar']) assert.ok(html.includes(t), t);
    const create = renderToStaticMarkup(
      React.createElement(AssociationSidePanel, { kind: 'contacts', associatedIds: [], onSave: async () => {}, onClose: () => {}, canCreate: true, initialTab: 'create' })
    );
    assert.ok(create.includes('Comece inserindo o nome, o e-mail ou ambos do(a) Contato.'));
    assert.ok(create.includes('Criar e adicionar outro'));
    assert.ok(!/hubspot|gest[aã]o ?click/i.test(html + create));
  });
});

describe('Janelas de atividade', () => {
  const seg = new Date(2026, 10, 19, 9, 0); // quinta 19/11/2026
  it('prazos em dias uteis e semana da agenda', () => {
    assert.equal(addBusinessDays(seg, 2).getDate(), 23, 'quinta + 2 uteis = segunda');
    assert.equal(dueOptions(seg).find((o) => o.id === '2bd')!.label, 'Em 2 dias úteis (Segunda-feira)');
    const w = startOfWeek(new Date(2026, 10, 18));
    assert.equal(weekRangeLabel(w, true), '16 de nov. - 20 de nov., 2026');
  });

  it('Mais: lista e busca; sem itens pagos', () => {
    assert.deepEqual(
      MORE_ACTIVITY_OPTIONS.map((o) => o.label),
      ['Registrar SMS', 'Registrar correio postal', 'Registrar um e-mail', 'Registrar uma chamada', 'Registrar uma mensagem do LinkedIn', 'Registrar uma mensagem do WhatsApp', 'Registrar uma reunião']
    );
    assert.deepEqual(filterMoreOptions('whats').map((o) => o.id), ['WHATSAPP']);
    const html = renderToStaticMarkup(React.createElement(MoreActivitiesMenu, { onPick: () => {}, onClose: () => {}, extra: [{ id: 'p', label: 'Gerar proposta', onClick: () => {} }] }));
    assert.ok(html.includes('Registrar uma mensagem do WhatsApp') && html.includes('Gerar proposta'));
  });

  it('payloads das rotas existentes', () => {
    const assoc = { dealId: 'd1', contactId: 'c1', companyId: null };
    assert.equal(assocLabel(assoc), 'Associado a 2 registros');
    const n = buildNotePayload('Linha 1\nLinha 2', assoc);
    assert.equal(n.type, 'NOTE');
    assert.equal(n.title, 'Linha 1');
    assert.equal(n.contactId, 'c1');
    const wa = MORE_ACTIVITY_OPTIONS.find((o) => o.id === 'WHATSAPP')!;
    const l = buildLogPayload(wa, { body: 'oi', occurredDate: '2026-11-19', occurredTime: '10:30' }, assoc);
    assert.equal(l.metadata.channel, wa.channel);
    assert.equal(l.metadata.occurredAt, '2026-11-19T10:30:00');
    const t = buildTaskPayload({ title: ' Ligar ', notes: '', type: 'TODO', priority: 'HIGH', queueName: '', dueDate: '2026-11-23', dueTime: '10:00', reminderMinutes: 0, assignedTo: 'Marcéllo' }, assoc);
    assert.equal(t.title, 'Ligar');
    assert.equal(t.dealId, 'd1');
    assert.equal(followUpTaskFromNote('Revisar contrato', 'TODO', '2026-11-23', 'M', assoc).title, 'Acompanhar: Revisar contrato');
    const m = buildMeetingPayload({ title: 'Kickoff', hostName: 'M', date: '2026-11-19', startTime: '14:00', durationMin: 30, attendees: ['a@b.com'], location: '', reminders: [], description: '' }, assoc);
    assert.equal(m.metadata.endAt, '2026-11-19T14:30:00');
    assert.equal(m.metadata.invitesSent, false);
    const ag = agendaFromSources([{ id: 'e1', type: 'MEETING', title: 'Kickoff', metadata: m.metadata }], [{ id: 't1', title: 'Ligar', dueDate: '2026-11-20', dueTime: '10:00', assignedTo: 'M' }], 'M');
    assert.deepEqual(ag.map((a) => [a.kind, a.start, a.end]), [['MEETING', '14:00', '14:30'], ['TASK', '10:00', '10:30']]);
  });

  it('POST /api/timeline aceita a observacao com contato/empresa/metadata', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const deal = repo.listDeals()[0] as any;
    const r = await post(router, '/api/timeline', { ...buildNotePayload('Teste painel', { dealId: deal.id, contactId: deal.contactId || null, companyId: deal.companyId || null }) });
    assert.ok(r.status < 300, JSON.stringify(r.body));
  });

  it('render: Observacao com "Criar observação" desabilitado vazio; Tarefa; Reuniao sem Upgrade/Bot anotador', () => {
    const common = { recordChip: 'Negócio X', candidates: [{ kind: 'deal' as const, id: 'd1', label: 'Negócio X' }], initialAssoc: { dealId: 'd1' }, minimized: false, onMinimize: () => {}, onClose: () => {}, currentUserName: 'Marcéllo', now: seg };
    const note = renderToStaticMarkup(React.createElement(NoteWindow, { ...common, onCreateNote: async () => {}, onCreateTask: async () => {} }));
    assert.match(note, /<button[^>]*disabled=""[^>]*>Criar observação/);
    assert.ok(note.includes('Associado a 1 registro'));
    assert.ok(note.includes('Em 2 dias úteis (Segunda-feira)'));
    const task = renderToStaticMarkup(React.createElement(TaskWindow, { ...common, onCreateTask: async () => {} }));
    for (const t of ['Criar tarefa', 'Lembrete', 'Prioridade', 'Atribuído a']) assert.ok(task.includes(t), t);
    const meet = renderToStaticMarkup(React.createElement(MeetingSchedulerModal, { ...common, agenda: [], onSchedule: async () => {} }));
    for (const t of ['Agendar reunião', 'Ocultar fins de semana', 'America/Sao_Paulo', '16 de nov. - 20 de nov., 2026']) assert.ok(meet.includes(t), t);
    assert.ok(!/upgrade|bot anotador/i.test(meet));
  });

  it('ficha do negocio usa o painel novo; seletor antigo removido', () => {
    const drawer = src('src', 'app', 'components', 'DealRecordDrawer.tsx');
    assert.ok(drawer.includes('<AssociationSidePanel'));
    assert.ok(drawer.includes('<NoteWindow') && drawer.includes('<TaskWindow') && drawer.includes('<MeetingSchedulerModal') && drawer.includes('<MoreActivitiesMenu'));
    assert.equal(existsSync(join(process.cwd(), 'src', 'app', 'components', 'DealAssociationPicker.tsx')), false);
  });
});
