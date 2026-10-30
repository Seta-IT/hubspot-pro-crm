// ============================================================================
// SetaDesk - chaves SD-, esquema Postgres e camada de dados dos chamados
// O bloco "Postgres real" so roda com SETADESK_TEST_DATABASE_URL definido
// (banco descartavel); sem ele e ignorado, sem tocar em nenhum banco.
// ============================================================================

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import {
  portalActionErrorMessage,
  PORTAL_UI_RATE_LIMIT_MESSAGE,
} from '../src/app/portal/portal-feedback';
import { SETADESK_MIGRATIONS, SETADESK_TICKET_KEY_PREFIX } from '../src/db/setadesk-schema';
import {
  buildBaseline,
  diffTicketsAgainstBaseline,
  ticketKeysNeededForRoute,
} from '../src/db/setadesk-store';

describe('SetaDesk - geracao de chave SD- (fallback sem Postgres)', () => {
  it('nao depende do maior numero de outras chaves (JSM-/Jira)', () => {
    const repo = createInMemoryRepository();
    // Simula chamados legados/importados com numeros altos em outros prefixos.
    repo.createServiceTicket({ subject: 'Legado Jira', key: 'STT-9876' });
    repo.createServiceTicket({ subject: 'Legado JSM', key: 'JSM-5000' });
    const a = repo.createServiceTicket({ subject: 'Primeiro SetaDesk' });
    const b = repo.createServiceTicket({ subject: 'Segundo SetaDesk' });
    assert.equal(SETADESK_TICKET_KEY_PREFIX, 'SD');
    assert.equal(a.key, 'SD-1');
    assert.equal(b.key, 'SD-2');
  });

  it('nao reutiliza numero apos exclusao (contador proprio monotono)', () => {
    const repo = createInMemoryRepository();
    const a = repo.createServiceTicket({ subject: 'A' });
    const b = repo.createServiceTicket({ subject: 'B' });
    assert.ok(repo.deleteServiceTicket(b.id));
    const c = repo.createServiceTicket({ subject: 'C' });
    assert.equal(a.key, 'SD-1');
    assert.equal(c.key, 'SD-3');
  });

  it('usa chaves reservadas (sequencia do Postgres) antes do contador local e ignora colisoes', () => {
    const repo = createInMemoryRepository();
    repo.createServiceTicket({ subject: 'Existente', key: 'SD-41' });
    repo.reserveTicketKeys(['SD-41', 'SD-42']);
    const t = repo.createServiceTicket({ subject: 'Com reserva' });
    assert.equal(t.key, 'SD-42');
    assert.deepEqual(repo.clearReservedTicketKeys(), []);
  });

  it('guarda campos SetaDesk opcionais (solicitante, cc, fila x tecnico, origem)', () => {
    const repo = createInMemoryRepository();
    const t = repo.createServiceTicket({
      subject: 'Sem sinal no link',
      requesterEmail: ' Cliente@Exemplo.com.br ',
      ccEmails: ['A@x.com', ' '],
      queue: 'NOC N1 - Triagem & Monitoramento Zabbix',
      assigneeAgent: 'tecnico@setatelecom.com.br',
      source: 'EMAIL',
    });
    assert.equal(t.requesterEmail, 'cliente@exemplo.com.br');
    assert.deepEqual(t.ccEmails, ['a@x.com']);
    assert.equal(t.assigneeAgent, 'tecnico@setatelecom.com.br');
    assert.equal(t.source, 'EMAIL');
  });

  it('POST /api/tickets devolve chave SD- e mantem chamados demo JSM- acessiveis', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    const res = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: '/api/tickets', query: {}, body: { subject: 'Teste SD' } });
    assert.equal(res.status, 201);
    const key = (res.body as { data: { key: string } }).data.key;
    assert.match(key, /^SD-\d+$/);
    const legacy = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'GET', path: '/api/tickets/JSM-101', query: {}, body: {} });
    assert.equal(legacy.status, 200);
  });
});

describe('SetaDesk - esquema e diff (sem banco)', () => {
  const sql = SETADESK_MIGRATIONS.map((m) => m.sql).join('\n');

  it('migracoes sao idempotentes (IF NOT EXISTS) e com ids unicos', () => {
    const ids = SETADESK_MIGRATIONS.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
      assert.match(stmt, /IF NOT EXISTS/i, `comando sem IF NOT EXISTS: ${stmt.slice(0, 80)}`);
    }
  });

  it('tem indices unicos de idempotencia (jira_key, jira_id, message_id, ids externos)', () => {
    for (const idx of [
      'setadesk_tickets_key_uidx',
      'setadesk_tickets_jira_key_uidx',
      'setadesk_tickets_jira_id_uidx',
      'setadesk_comments_external_uidx',
      'setadesk_email_message_id_uidx',
      'setadesk_attachments_external_uidx',
      'setadesk_outbox_dedupe_uidx',
    ]) {
      assert.match(sql, new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS ${idx}`));
    }
    assert.match(sql, /CREATE SEQUENCE IF NOT EXISTS setadesk_ticket_seq/);
  });

  it('diff detecta somente chamados novos, alterados e removidos', () => {
    const repo = createInMemoryRepository();
    const tickets = repo.getState().serviceTickets;
    const baseline = buildBaseline(tickets);
    assert.deepEqual(diffTicketsAgainstBaseline(tickets, baseline), { changed: [], deletedIds: [] });
    const created = repo.createServiceTicket({ subject: 'Novo' });
    repo.updateServiceTicket('JSM-102', { priority: 'CRITICAL' });
    repo.deleteServiceTicket('JSM-105');
    const d = diffTicketsAgainstBaseline(repo.getState().serviceTickets, baseline);
    assert.deepEqual(d.changed.map((t) => t.key).sort(), [created.key, 'JSM-102'].sort());
    assert.equal(d.deletedIds.length, 1);
  });

  it('reserva chaves apenas em rotas que criam chamados', () => {
    assert.equal(ticketKeysNeededForRoute('POST', '/api/tickets', {}), 1);
    assert.equal(ticketKeysNeededForRoute('POST', '/api/portal/tickets', {}), 1);
    assert.equal(ticketKeysNeededForRoute('POST', '/api/forms/submit', {}), 1);
    assert.equal(ticketKeysNeededForRoute('POST', '/api/migration/hubspot', { tickets: [1, 2, 3] }), 3);
    assert.equal(ticketKeysNeededForRoute('GET', '/api/tickets', {}), 0);
    assert.equal(ticketKeysNeededForRoute('POST', '/api/tickets/SD-1/comments', {}), 0);
  });
});


const PORTAL_HTTP = { _fromHttpBridge: '1' };
let portalIpSeq = 1;
const portalIp = () => `203.0.113.${(portalIpSeq++ % 250) + 1}`;
const PORTAL_DTO_KEYS = ['comments', 'createdAt', 'key', 'resolvedAt', 'status', 'subject', 'updatedAt'];
const SETADESK_SECRETS = ['cc.oculto@exemplo.com', 'STT-777', 'tecnico.oculto@setatelecom.com.br', 'solicitante.oculto@exemplo.com'];

function enrichWithSetaDeskFields(repo: ReturnType<typeof createInMemoryRepository>) {
  const t = repo.listServiceTickets().find((x) => x.contactId && repo.getContactById(x.contactId)?.email)!;
  const email = repo.getContactById(t.contactId!)!.email;
  repo.updateServiceTicket(t.id, {
    requesterEmail: 'solicitante.oculto@exemplo.com',
    ccEmails: ['cc.oculto@exemplo.com'],
    jiraKey: 'STT-777',
    jiraId: '99999',
    assigneeAgent: 'tecnico.oculto@setatelecom.com.br',
    source: 'EMAIL',
  });
  return { key: repo.getServiceTicketById(t.id)!.key, email };
}

async function assertPortalDtoMinimal(router: CrmApiRouter, key: string, email: string) {
  const r = await router.dispatch({ method: 'GET', path: '/api/portal/tickets', query: { ...PORTAL_HTTP, _clientIp: portalIp(), key, email }, body: {} });
  assert.equal(r.status, 200);
  const data = (r.body as { data: Record<string, unknown> }).data;
  assert.deepEqual(Object.keys(data).sort(), PORTAL_DTO_KEYS);
  const raw = JSON.stringify(r.body);
  for (const secret of SETADESK_SECRETS) assert.ok(!raw.includes(secret), `vazou ${secret}`);
  for (const c of data.comments as Array<Record<string, unknown>>) {
    assert.deepEqual(Object.keys(c).sort(), ['author', 'authorRole', 'body', 'createdAt']);
  }
  return data;
}

describe('SetaDesk - portal do cliente continua com DTO minimo', () => {
  it('campos SetaDesk (solicitante, cc, jira, tecnico) nao aparecem no portal', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const { key, email } = enrichWithSetaDeskFields(repo);
    await assertPortalDtoMinimal(router, key, email);
  });

  it('POST /api/portal/tickets grava requester_email normalizado e nao o devolve', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const r = await router.dispatch({
      method: 'POST', path: '/api/portal/tickets', query: { ...PORTAL_HTTP, _clientIp: portalIp() },
      body: { subject: 'Sem sinal', email: '  Solicitante.Portal@Exemplo.COM ', name: 'Cliente Portal' },
    });
    assert.equal(r.status, 201);
    const data = (r.body as { data: { key: string } }).data;
    assert.deepEqual(Object.keys(data).sort(), PORTAL_DTO_KEYS);
    assert.ok(!JSON.stringify(r.body).toLowerCase().includes('solicitante.portal@exemplo.com'));
    assert.equal(repo.getServiceTicketById(data.key)!.requesterEmail, 'solicitante.portal@exemplo.com');
    const g = await router.dispatch({
      method: 'GET', path: '/api/portal/tickets',
      query: { ...PORTAL_HTTP, _clientIp: portalIp(), key: data.key, email: 'solicitante.portal@exemplo.com' }, body: {},
    });
    assert.equal(g.status, 200);
    assert.ok(!('requesterEmail' in (g.body as { data: object }).data));
  });

  it('mensagens de erro do portal: 429 especifico; demais genericos, sem detalhe tecnico', () => {
    assert.equal(PORTAL_UI_RATE_LIMIT_MESSAGE, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
    assert.equal(portalActionErrorMessage(429, 'REPLY'), PORTAL_UI_RATE_LIMIT_MESSAGE);
    assert.equal(portalActionErrorMessage(429, 'CSAT'), PORTAL_UI_RATE_LIMIT_MESSAGE);
    for (const st of [400, 404, 500, 503, null]) {
      for (const kind of ['REPLY', 'CSAT'] as const) {
        const m = portalActionErrorMessage(st, kind);
        assert.notEqual(m, PORTAL_UI_RATE_LIMIT_MESSAGE);
        assert.doesNotMatch(m, /\d{3}|erro interno|stack|exception|null/i);
        assert.doesNotMatch(m, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
      }
    }
  });
});

const TEST_DB = process.env.SETADESK_TEST_DATABASE_URL;

describe('SetaDesk - Postgres real (descartavel)', { skip: !TEST_DB }, () => {
  let store: typeof import('../src/db/setadesk-store');
  let pg: typeof import('../src/db/postgres');
  const savedUrl = process.env.DATABASE_URL;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    pg = await import('../src/db/postgres');
    store = await import('../src/db/setadesk-store');
    await pg.closePostgresPool();
    store.resetSetaDeskSchemaCache();
    const pool = pg.getPostgresPool()!;
    await pool.query(`DROP TABLE IF EXISTS setadesk_schema_migrations, setadesk_notification_reads, setadesk_notifications,
      setadesk_integration_outbox, setadesk_email_outbox, setadesk_related_tickets, setadesk_ticket_history,
      setadesk_ticket_attachments, setadesk_email_messages, setadesk_ticket_comments, setadesk_tickets,
      setadesk_queues, setadesk_meta, setadesk_mail_sync_state, setadesk_ticket_tombstones CASCADE`);
    await pool.query('DROP SEQUENCE IF EXISTS setadesk_ticket_seq');
  });

  after(async () => {
    await pg.closePostgresPool();
    if (savedUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedUrl;
  });

  it('aplica migracoes uma vez e reaplicar e no-op', async () => {
    const first = await store.ensureSetaDeskSchema();
    assert.deepEqual(first, ['0001_setadesk_core']);
    store.resetSetaDeskSchemaCache();
    const second = await store.ensureSetaDeskSchema();
    assert.deepEqual(second, []);
  });

  it('reconcilia chamados do snapshot legado (copia faltantes); sequencia emite SD- sem colidir', async () => {
    const repo = createInMemoryRepository();
    repo.createServiceTicket({ subject: 'ja SD', key: 'SD-7' });
    const legacy = repo.getState().serviceTickets;
    const loaded = await store.loadSetaDeskTickets(legacy);
    assert.ok(loaded);
    assert.equal(loaded!.tickets.length, legacy.length);
    const jsm = loaded!.tickets.find((t) => t.key === 'JSM-101')!;
    assert.equal(jsm.legacyKey, 'JSM-101');
    assert.ok(jsm.comments.length >= 0);
    const same = await store.loadSetaDeskTickets(legacy);
    assert.equal(same!.tickets.length, legacy.length, 'nada duplicado ao recarregar');
    const again = await store.loadSetaDeskTickets([...legacy, { ...legacy[0], id: 'outro', key: 'X-1', comments: [] }]);
    assert.equal(again!.tickets.length, legacy.length + 1, 'chamado legado novo e copiado');
    const keys = await store.reserveSetaDeskTicketKeys(2);
    assert.deepEqual(keys, ['SD-8', 'SD-9']);
  });

  it('legado mais novo atualiza a tabela; legado mais antigo nao sobrescreve', async () => {
    const base = (await store.loadSetaDeskTickets([]))!;
    const t101 = base.tickets.find((t) => t.key === 'JSM-101')!;
    const newer = { ...t101, subject: 'Editado no legado', updatedAt: new Date(Date.parse(t101.updatedAt) + 60000).toISOString() };
    const r1 = (await store.loadSetaDeskTickets([newer]))!;
    assert.equal(r1.tickets.find((t) => t.id === t101.id)!.subject, 'Editado no legado');
    const older = { ...t101, subject: 'Velho', updatedAt: new Date(Date.parse(t101.updatedAt) - 60000).toISOString() };
    const r2 = (await store.loadSetaDeskTickets([older]))!;
    assert.equal(r2.tickets.find((t) => t.id === t101.id)!.subject, 'Editado no legado');
  });

  it('sync grava novos/alterados, comentarios idempotentes, historico, notificacao e exclusao', async () => {
    const loaded = (await store.loadSetaDeskTickets([]))!;
    const repo = createInMemoryRepository();
    repo.replaceServiceTickets(loaded.tickets);
    const [key] = await store.reserveSetaDeskTicketKeys(1);
    repo.reserveTicketKeys([key]);
    const t = repo.createServiceTicket({ subject: 'Via sync', requesterEmail: 'c@x.com', ccEmails: ['d@x.com'] });
    assert.equal(t.key, key);
    repo.addTicketComment(t.id, { author: 'Agente', body: 'Primeira resposta' });
    repo.updateServiceTicket('JSM-102', { status: 'IN_PROGRESS', priority: 'CRITICAL' });
    repo.deleteServiceTicket('JSM-105');
    const r = await store.syncSetaDeskTickets(repo.getState().serviceTickets, loaded.baseline, 'tester@setatelecom.com.br');
    assert.equal(r.upserted, 2);
    assert.equal(r.deleted, 1);
    // segunda chamada sem mudancas => nada a gravar
    assert.deepEqual(await store.syncSetaDeskTickets(repo.getState().serviceTickets, loaded.baseline), { upserted: 0, deleted: 0 });

    const reread = (await store.loadSetaDeskTickets([]))!;
    const back = reread.tickets.find((x) => x.key === key)!;
    assert.equal(back.requesterEmail, 'c@x.com');
    assert.deepEqual(back.ccEmails, ['d@x.com']);
    assert.equal(back.comments.length, 1);
    assert.ok(!reread.tickets.some((x) => x.key === 'JSM-105'));
    // apagado no SetaDesk nao ressuscita a partir do snapshot legado
    const legacy105 = createInMemoryRepository().getServiceTicketById('JSM-105')!;
    const reread2 = (await store.loadSetaDeskTickets([legacy105]))!;
    assert.ok(!reread2.tickets.some((x) => x.key === 'JSM-105'));

    const pool = pg.getPostgresPool()!;
    const hist = await pool.query(`SELECT field FROM setadesk_ticket_history h JOIN setadesk_tickets t ON t.id = h.ticket_id WHERE t.key = 'JSM-102' ORDER BY field`);
    assert.ok(hist.rows.map((x) => x.field).includes('priority'));
    const notif = await pool.query(`SELECT count(*)::int AS n FROM setadesk_notifications WHERE ticket_id = $1`, [t.id]);
    assert.equal(notif.rows[0].n, 1);
    // jira_key unico
    await pool.query(`UPDATE setadesk_tickets SET jira_key = 'STT-1' WHERE key = $1`, [key]);
    await assert.rejects(pool.query(`UPDATE setadesk_tickets SET jira_key = 'stt-1' WHERE key = 'JSM-101'`));
    // message_id unico (case-insensitive)
    await pool.query(`INSERT INTO setadesk_email_messages (id, direction, message_id) VALUES ('m1', 'INBOUND', '<A@b>')`);
    await assert.rejects(pool.query(`INSERT INTO setadesk_email_messages (id, direction, message_id) VALUES ('m2', 'INBOUND', '<a@B>')`));
  });

  it('chamado novo com chave local colidente e reemitido pela sequencia', async () => {
    const loaded = (await store.loadSetaDeskTickets([]))!;
    const repo = createInMemoryRepository();
    repo.replaceServiceTickets(loaded.tickets);
    repo.createServiceTicket({ subject: 'Colisao', key: 'SD-7', id: 'tkt-colisao' });
    await store.syncSetaDeskTickets(repo.getState().serviceTickets, loaded.baseline);
    const reread = (await store.loadSetaDeskTickets([]))!;
    const saved = reread.tickets.find((x) => x.id === 'tkt-colisao')!;
    assert.match(saved.key, /^SD-\d+$/);
    assert.notEqual(saved.key, 'SD-7');
    assert.equal(reread.tickets.filter((x) => x.key === 'SD-7').length, 1);
  });
  it('chamado aberto pelo portal persiste requester_email no Postgres', async () => {
    const base = (await store.loadSetaDeskTickets([]))!;
    const repo = createInMemoryRepository();
    repo.replaceServiceTickets(base.tickets);
    const router = new CrmApiRouter(repo);
    const r = await router.dispatch({
      method: 'POST', path: '/api/portal/tickets', query: { ...PORTAL_HTTP, _clientIp: portalIp() },
      body: { subject: 'Portal -> Postgres', email: ' Pg.Portal@Exemplo.com', name: 'Cliente PG' },
    });
    assert.equal(r.status, 201);
    const key = (r.body as { data: { key: string } }).data.key;
    await store.syncSetaDeskTickets(repo.getState().serviceTickets, base.baseline);
    const row = await pg.getPostgresPool()!.query(`SELECT requester_email FROM setadesk_tickets WHERE key = $1`, [key]);
    assert.equal(row.rows[0].requester_email, 'pg.portal@exemplo.com');
  });

  it('portal le do store Postgres e devolve so o DTO minimo', async () => {
    const seedRepo = createInMemoryRepository();
    const { key, email } = enrichWithSetaDeskFields(seedRepo);
    const base = (await store.loadSetaDeskTickets([]))!;
    const enriched = seedRepo.getServiceTicketById(key)!;
    const stored = base.tickets.find((t) => t.key === key)!;
    seedRepo.replaceServiceTickets(base.tickets);
    seedRepo.updateServiceTicket(stored.id, {
      requesterEmail: enriched.requesterEmail, ccEmails: enriched.ccEmails, jiraKey: enriched.jiraKey,
      jiraId: enriched.jiraId, assigneeAgent: enriched.assigneeAgent, subject: 'Lido do Postgres',
    });
    await store.syncSetaDeskTickets(seedRepo.getState().serviceTickets, base.baseline);
    const reread = (await store.loadSetaDeskTickets([]))!;
    const fromDb = reread.tickets.find((t) => t.key === key)!;
    assert.equal(fromDb.jiraKey, 'STT-777');
    assert.deepEqual(fromDb.ccEmails, ['cc.oculto@exemplo.com']);
    const repo = createInMemoryRepository();
    repo.replaceServiceTickets(reread.tickets);
    const data = await assertPortalDtoMinimal(new CrmApiRouter(repo), key, email);
    assert.equal(data.subject, 'Lido do Postgres');
  });
});
