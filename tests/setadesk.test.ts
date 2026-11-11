// ============================================================================
// SetaDesk - chaves SD-, esquema Postgres e camada de dados dos chamados
// O bloco "Postgres real" so roda com SETADESK_TEST_DATABASE_URL definido
// (banco descartavel); sem ele e ignorado, sem tocar em nenhum banco.
// ============================================================================

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryRepository, SERVICE_TICKET_EDITABLE_FIELDS } from '../src/db/repository';
import { TicketTeamPatchSchema } from '../src/api/ticket-guards';
import { CrmApiRouter, shouldLoadSetaDeskTicketsForRoute, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import {
  portalActionErrorMessage,
  PORTAL_UI_RATE_LIMIT_MESSAGE,
} from '../src/app/portal/portal-feedback';
import {
  SETADESK_ALIGN_SEQUENCE_SQL,
  SETADESK_DEFAULT_TICKET_PREFIX,
  SETADESK_JIRA_IMPORT_PROJECT,
  SETADESK_MIGRATIONS,
  SETADESK_SEED_PIPELINES,
  SETADESK_TICKET_KEY_PREFIX,
  maxAllocatedSetaDeskNumber,
} from '../src/db/setadesk-schema';
import {
  buildBaseline,
  diffTicketsAgainstBaseline,
  isLegacyDemoServiceTicket,
  SETADESK_LEGACY_DEMO_TICKET_IDS,
  SETADESK_LEGACY_DEMO_TICKET_KEYS,
  ticketKeysNeededForRoute,
} from '../src/db/setadesk-store';
import { canManageSetaDeskPipelines } from '../src/api/setadesk-pipeline-guards';
import { setaDeskPurgeApplyDenial } from '../src/db/cli-purge-tickets';

describe('SetaDesk - geracao de chave TEC-/FIN- (fallback sem Postgres)', () => {
  it('a numeracao TEC acompanha o STT importado; JSM- e DEV- nao entram na sequencia', () => {
    const repo = createInMemoryRepository();
    repo.createServiceTicket({ subject: 'Importado', key: 'TEC-123', jiraKey: 'STT-123' });
    repo.createServiceTicket({ subject: 'Legado JSM', key: 'JSM-5000' });
    repo.createServiceTicket({ subject: 'Projeto DEV fora do escopo', key: 'DEV-99' });
    const a = repo.createServiceTicket({ subject: 'Primeiro novo' });
    const b = repo.createServiceTicket({ subject: 'Segundo novo' });
    assert.equal(SETADESK_TICKET_KEY_PREFIX, 'TEC');
    assert.equal(SETADESK_DEFAULT_TICKET_PREFIX, 'TEC');
    assert.equal(SETADESK_JIRA_IMPORT_PROJECT, 'STT');
    assert.equal(a.key, 'TEC-124');
    assert.equal(b.key, 'TEC-125');
  });

  it('chave STT-n (ainda nao convertida) tambem reserva o numero SD-n', () => {
    const repo = createInMemoryRepository();
    repo.createServiceTicket({ subject: 'Legado com chave Jira', key: 'STT-248' });
    const next = repo.createServiceTicket({ subject: 'Novo apos o maior STT' });
    assert.equal(next.key, 'TEC-249');
    assert.equal(maxAllocatedSetaDeskNumber(repo.getState().serviceTickets || []), 249);
  });

  it('nao reutiliza numero apos exclusao (contador proprio monotono)', () => {
    const repo = createInMemoryRepository();
    const a = repo.createServiceTicket({ subject: 'A' });
    const b = repo.createServiceTicket({ subject: 'B' });
    assert.ok(repo.deleteServiceTicket(b.id));
    const c = repo.createServiceTicket({ subject: 'C' });
    assert.equal(a.key, 'TEC-1');
    assert.equal(c.key, 'TEC-3');
  });

  it('usa chaves reservadas (sequencia do Postgres) antes do contador local e ignora colisoes', () => {
    const repo = createInMemoryRepository();
    repo.createServiceTicket({ subject: 'Existente', key: 'TEC-41' });
    repo.reserveTicketKeys(['TEC-41', 'TEC-42']);
    const t = repo.createServiceTicket({ subject: 'Com reserva' });
    assert.equal(t.key, 'TEC-42');
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

  it('POST /api/tickets devolve chave TEC- e mantem chamados demo JSM- acessiveis', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    const res = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: '/api/tickets', query: {}, body: { subject: 'Teste TEC' } });
    assert.equal(res.status, 201);
    const key = (res.body as { data: { key: string } }).data.key;
    assert.match(key, /^TEC-\d+$/);
    const legacy = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'GET', path: '/api/tickets/JSM-101', query: {}, body: {} });
    assert.equal(legacy.status, 200);
  });

  it('FIN acompanha o numero do AF; TEC permanece independente', () => {
    const repo = createInMemoryRepository();
    repo.createServiceTicket({ subject: 'AF importado', key: 'FIN-1032', jiraKey: 'AF-1032', pipelineId: 'pl-fin' });
    repo.createServiceTicket({ subject: 'STT importado', key: 'TEC-248', jiraKey: 'STT-248', pipelineId: 'pl-tec' });
    const fin = repo.createServiceTicket({ subject: 'Novo financeiro', pipelineId: 'pl-fin', category: 'BILLING' });
    const tec = repo.createServiceTicket({ subject: 'Novo tecnico', pipelineId: 'pl-tec' });
    assert.equal(fin.key, 'FIN-1033');
    assert.equal(fin.pipelineId, 'pl-fin');
    assert.equal(tec.key, 'TEC-249');
    assert.equal(tec.pipelineId, 'pl-tec');
  });

  it('lista, cria e edita pipelines; POST exige admin ou coordenador', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    const list = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'GET', path: '/api/tickets/pipelines', query: {}, body: {} });
    assert.equal(list.status, 200);
    const body = list.body as { data: Array<{ id: string; prefix: string }>; canManage: boolean };
    assert.deepEqual(body.data.map((p) => p.prefix).sort(), ['FIN', 'TEC']);
    assert.equal(body.canManage, true);
    const created = await router.dispatch({
      context: TRUSTED_INTERNAL_CONTEXT,
      method: 'POST',
      path: '/api/tickets/pipelines',
      query: {},
      body: { name: 'Qualidade', prefix: 'QLD', mailbox: 'qualidade@setatelecom.com.br' },
    });
    assert.equal(created.status, 201);
    const row = (created.body as { data: { id: string; prefix: string; mailbox: string } }).data;
    assert.equal(row.prefix, 'QLD');
    const patched = await router.dispatch({
      context: TRUSTED_INTERNAL_CONTEXT,
      method: 'PATCH',
      path: `/api/tickets/pipelines/${row.id}`,
      query: {},
      body: { name: 'Qualidade e Processos' },
    });
    assert.equal(patched.status, 200);
    assert.equal((patched.body as { data: { name: string } }).data.name, 'Qualidade e Processos');
    const denied = await router.dispatch({ method: 'POST', path: '/api/tickets/pipelines', query: {}, body: { name: 'X', prefix: 'XXX' } });
    assert.ok([401, 403].includes(denied.status), `esperado 401 ou 403, veio ${denied.status}`);
  });

  it('GET /api/tickets filtra por pipelineId', async () => {
    const repo = createInMemoryRepository();
    repo.createServiceTicket({ subject: 'Tec', pipelineId: 'pl-tec' });
    repo.createServiceTicket({ subject: 'Fin', pipelineId: 'pl-fin', category: 'BILLING' });
    const router = new CrmApiRouter(repo);
    const res = await router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'GET', path: '/api/tickets', query: { pipelineId: 'pl-fin' }, body: {} });
    assert.equal(res.status, 200);
    const data = (res.body as { data: Array<{ subject: string; pipelineId?: string }> }).data;
    assert.ok(data.length >= 1);
    assert.ok(data.every((t) => t.pipelineId === 'pl-fin'));
  });
});


describe('SetaDesk - pipelines e purge (guardas)', () => {
  it('canManageSetaDeskPipelines libera admin, coordenador e contexto interno', () => {
    assert.equal(canManageSetaDeskPipelines({ trustedInternal: true, session: null }), true);
    assert.equal(canManageSetaDeskPipelines({ session: null }), false);
    assert.equal(
      canManageSetaDeskPipelines({
        session: {
          authenticated: true,
          mfaVerified: true,
          effectiveActionGuards: { canManageUsersRbac: true },
        },
      }),
      true
    );
    assert.equal(
      canManageSetaDeskPipelines({
        session: { authenticated: true, mfaVerified: true, user: { role: 'SUPPORT_NOC_OS', crmRole: 'CRM_SERVICE_NOC' } },
      }),
      true
    );
    assert.equal(
      canManageSetaDeskPipelines({
        session: { authenticated: true, mfaVerified: true, user: { role: 'SALES_REP', crmRole: 'CRM_SALES_REP' } },
      }),
      false
    );
    assert.equal(
      canManageSetaDeskPipelines({
        session: { authenticated: true, mfaVerified: false, user: { role: 'SUPER_ADMIN', crmRole: 'CRM_ADMIN' } },
      }),
      false
    );
  });

  it('purge e dry-run por padrao e exige SETADESK_PURGE_CONFIRM=1', () => {
    assert.match(setaDeskPurgeApplyDenial({}) || '', /SETADESK_PURGE_CONFIRM=1/);
    assert.match(setaDeskPurgeApplyDenial({ SETADESK_PURGE_CONFIRM: '1' }) || '', /DATABASE_URL/);
    assert.equal(setaDeskPurgeApplyDenial({ SETADESK_PURGE_CONFIRM: '1', DATABASE_URL: 'postgres://local/test' }), null);
  });
});

describe('SetaDesk - esquema e diff (sem banco)', () => {
  const sql = SETADESK_MIGRATIONS.map((m) => m.sql).join('\n');

  it('migracoes sao idempotentes (IF NOT EXISTS) e com ids unicos', () => {
    const ids = SETADESK_MIGRATIONS.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
      if (/^SELECT\s+setval\b/i.test(stmt)) continue;
      if (/^DROP INDEX IF EXISTS\b/i.test(stmt)) continue;
      if (/^INSERT INTO\b/i.test(stmt) && /ON CONFLICT/i.test(stmt)) continue;
      if (
        /^ALTER TABLE\b/i.test(stmt) &&
        /setadesk_ticket_comments/i.test(stmt) &&
        /is_internal SET DEFAULT TRUE/i.test(stmt) &&
        /IF EXISTS/i.test(stmt)
      ) {
        continue;
      }
      if (/^ALTER TABLE\b/i.test(stmt) && /ADD COLUMN IF NOT EXISTS/i.test(stmt) && /IF EXISTS/i.test(stmt)) {
        continue;
      }
      assert.match(stmt, /IF NOT EXISTS/i, `comando sem IF NOT EXISTS: ${stmt.slice(0, 80)}`);
    }
    assert.match(SETADESK_ALIGN_SEQUENCE_SQL, /setval\('/);
    assert.match(SETADESK_ALIGN_SEQUENCE_SQL, /jira_key FROM '\^STT-\(\[0-9\]\+\)\$/);
    assert.equal(SETADESK_MIGRATIONS.some((m) => m.id === '0002_align_seq_stt'), true);
    const m3 = SETADESK_MIGRATIONS.find((m) => m.id === '0003_comments_internal_default');
    assert.ok(m3);
    assert.match(m3!.sql, /ALTER TABLE IF EXISTS setadesk_ticket_comments/);
    assert.match(m3!.sql, /is_internal SET DEFAULT TRUE/);
    assert.doesNotMatch(m3!.sql, /setadesk_tickets\b/);
    const m4 = SETADESK_MIGRATIONS.find((m) => m.id === '0004_pipelines_and_history_uidx');
    assert.ok(m4);
    assert.match(m4!.sql, /CREATE TABLE IF NOT EXISTS setadesk_pipelines/);
    assert.match(m4!.sql, /setadesk_ticket_seq_tec/);
    assert.match(m4!.sql, /setadesk_ticket_seq_fin/);
    assert.match(m4!.sql, /ADD COLUMN IF NOT EXISTS pipeline_id/);
    assert.match(m4!.sql, /DROP INDEX IF EXISTS setadesk_history_external_uidx/);
    assert.match(m4!.sql, /ON setadesk_ticket_history \(ticket_id, source, external_id\)/);
    assert.equal(SETADESK_SEED_PIPELINES.map((s) => s.prefix).join(','), 'TEC,FIN');
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
    assert.equal(ticketKeysNeededForRoute('POST', '/api/tickets/TEC-1/comments', {}), 0);
  });
});

describe('SetaDesk - demos do legado e carga so em rota autenticada de chamados', () => {
  it('reconhece de forma deterministica os 5 chamados demo JSM-101..105', () => {
    assert.equal(SETADESK_LEGACY_DEMO_TICKET_IDS.length, 5);
    assert.equal(SETADESK_LEGACY_DEMO_TICKET_KEYS.length, 5);
    for (const key of SETADESK_LEGACY_DEMO_TICKET_KEYS) {
      assert.equal(isLegacyDemoServiceTicket({ key }), true, key);
    }
    for (const id of SETADESK_LEGACY_DEMO_TICKET_IDS) {
      assert.equal(isLegacyDemoServiceTicket({ id }), true, id);
    }
    assert.equal(isLegacyDemoServiceTicket({ id: 'tkt-jsm-101', key: 'JSM-101' }), true);
    assert.equal(isLegacyDemoServiceTicket({ key: 'JSM-106' }), false);
    assert.equal(isLegacyDemoServiceTicket({ key: 'TEC-7' }), false);
    assert.equal(isLegacyDemoServiceTicket({ key: 'STT-101' }), false);
    assert.equal(isLegacyDemoServiceTicket({ id: 'tkt-jira-11262', key: 'TEC-123' }), false);
  });

  it('rota publica nao carrega setadesk_tickets; so /api/tickets autenticada carrega', () => {
    const publicPaths: Array<[string, string]> = [
      ['GET', '/api/health'],
      ['GET', '/api/auth/session'],
      ['POST', '/api/auth/login'],
      ['GET', '/api/portal/tickets'],
      ['POST', '/api/portal/tickets'],
      ['POST', '/api/portal/tickets/JSM-101/csat'],
      ['GET', '/api/erp/proposals/prop-1'],
      ['POST', '/api/erp/proposals/prop-1/approve'],
      ['GET', '/api/p/abcdef1234'],
      ['GET', '/portal'],
      ['GET', '/proposta/prop-1'],
    ];
    for (const [method, path] of publicPaths) {
      assert.equal(
        shouldLoadSetaDeskTicketsForRoute(method, path),
        false,
        `${method} ${path} nao pode carregar`
      );
    }
    assert.equal(shouldLoadSetaDeskTicketsForRoute('GET', '/api/tickets'), true);
    assert.equal(shouldLoadSetaDeskTicketsForRoute('POST', '/api/tickets'), true);
    assert.equal(shouldLoadSetaDeskTicketsForRoute('GET', '/api/tickets/TEC-1'), true);
    assert.equal(shouldLoadSetaDeskTicketsForRoute('POST', '/api/tickets/TEC-1/comments'), true);
    assert.equal(shouldLoadSetaDeskTicketsForRoute('GET', '/api/tickets/pipelines'), true);
    assert.equal(shouldLoadSetaDeskTicketsForRoute('GET', '/api/companies'), false);
    assert.equal(shouldLoadSetaDeskTicketsForRoute('POST', '/api/forms/submit'), false);
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
  repo.setServiceTicketSystemFields(t.id, {
    requesterEmail: 'solicitante.oculto@exemplo.com',
    ccEmails: ['cc.oculto@exemplo.com'],
    jiraKey: 'STT-777',
    jiraId: '99999',
    source: 'EMAIL',
  });
  repo.setServiceTicketSystemFields(t.id, { assigneeAgent: 'tecnico.oculto@setatelecom.com.br' });
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

describe('SetaDesk - updateServiceTicket com allowlist (defesa no repository)', () => {
  function setup() {
    const repo = createInMemoryRepository();
    const t = repo.listServiceTickets().find((x) => x.contactId)!;
    repo.addTicketComment(t.id, { author: 'Agente', authorRole: 'AGENT', isInternal: true, body: 'SEGREDO INTERNO' });
    const before = JSON.parse(JSON.stringify(repo.getServiceTicketById(t.id)!));
    return { repo, id: t.id as string, before };
  }

  it('ignora comments: nao troca o array nem forja comentario de cliente retroativo', () => {
    const { repo, id, before } = setup();
    const forged = [{ id: 'forjado', author: 'Cliente', authorRole: 'CUSTOMER', isInternal: false, body: 'forjado', createdAt: '2020-01-01T00:00:00.000Z' }];
    const out = repo.updateServiceTicket(id, { comments: forged } as never)!;
    assert.deepEqual(out.comments, before.comments);
    assert.ok(!out.comments.some((c) => c.id === 'forjado'));
  });

  it('notas internas nao viram publicas via update', () => {
    const { repo, id, before } = setup();
    const flipped = before.comments.map((c: Record<string, unknown>) => ({ ...c, isInternal: false }));
    repo.updateServiceTicket(id, { comments: flipped, status: 'IN_PROGRESS' } as never);
    const after = repo.getServiceTicketById(id)!;
    const secret = after.comments.find((c) => c.body === 'SEGREDO INTERNO')!;
    assert.equal(secret.isInternal, true);
    assert.equal(after.status, 'IN_PROGRESS', 'campo permitido no mesmo patch continua aplicado');
  });

  const blocked: Array<[string, unknown]> = [
    ['csatScore', 1],
    ['firstRespondedAt', '2020-01-01T00:00:00.000Z'],
    ['contactId', 'contato-de-outro-cliente'],
    ['slaFirstResponseDueAt', '2099-01-01T00:00:00.000Z'],
    ['slaResolutionDueAt', '2099-01-01T00:00:00.000Z'],
    ['slaPausedAt', '2020-01-01T00:00:00.000Z'],
    ['totalPausedMinutes', 99999],
    ['slaStatus', 'ON_TRACK'],
    ['resolvedAt', '2020-01-01T00:00:00.000Z'],
    ['closedAt', '2020-01-01T00:00:00.000Z'],
    ['createdAt', '2020-01-01T00:00:00.000Z'],
    ['channel', 'EMAIL'],
    ['requesterEmail', 'invasor@exemplo.com'],
    ['ccEmails', ['invasor@exemplo.com']],
    ['jiraKey', 'STT-1'],
    ['source', 'JIRA'],
    ['serviceOrderId', 'os-falsa'],
  ];
  for (const [field, value] of blocked) {
    it(`campo bloqueado no patch: ${field}`, () => {
      const { repo, id, before } = setup();
      // junto com outro campo, para nao cair no caminho transitorio do CSAT do portal
      repo.updateServiceTicket(id, { [field]: value, tags: ['triagem'] } as never);
      const after = repo.getServiceTicketById(id)! as unknown as Record<string, unknown>;
      assert.notDeepEqual(after[field], value, `${field} nao pode assumir o valor do patch`);
      if (field !== 'totalPausedMinutes') assert.deepEqual(after[field] ?? null, before[field] ?? null, `${field} nao pode mudar via update`);
      else assert.equal(after[field] ?? 0, before[field] ?? 0);
      assert.deepEqual(after.tags, ['triagem']);
    });
  }

  it('id e key nao mudam via update', () => {
    const { repo, id, before } = setup();
    const out = repo.updateServiceTicket(id, { id: 'x', key: 'TEC-999999', subject: 'Novo assunto' } as never)!;
    assert.equal(out.id, before.id);
    assert.equal(out.key, before.key);
    assert.equal(out.subject, 'Novo assunto');
  });

  it('campos editaveis continuam funcionando (status, prioridade com SLA recalculado, fila)', () => {
    const { repo, id, before } = setup();
    const out = repo.updateServiceTicket(id, {
      status: 'WAITING_CUSTOMER', priority: before.priority === 'LOW' ? 'CRITICAL' : 'LOW',
      assignee: 'N2', description: 'desc',
    })!;
    assert.equal(out.status, 'WAITING_CUSTOMER');
    assert.ok(out.slaPausedAt, 'pausa de SLA calculada pelo servidor');
    assert.notEqual(out.slaResolutionDueAt, before.slaResolutionDueAt);
    assert.equal(out.assignee, 'N2');
  });

  it('allowlist do repository = campos do TicketTeamPatchSchema (pacote H)', () => {
    assert.deepEqual([...SERVICE_TICKET_EDITABLE_FIELDS].sort(), Object.keys(TicketTeamPatchSchema.shape).sort());
  });

  for (const [field, value] of [
    ['queue', 'N2'],
    ['assigneeAgent', 'agente@setatelecom.com.br'],
    ['companyId', 'empresa-de-outro-cliente'],
    ['dealId', 'negocio-de-outro-cliente'],
  ] as const) {
    it(`fora da allowlist do repository: ${field} (so caminho proprio)`, () => {
      const { repo, id, before } = setup();
      repo.updateServiceTicket(id, { [field]: value, tags: ['triagem'] } as never);
      const after = repo.getServiceTicketById(id)! as unknown as Record<string, unknown>;
      assert.deepEqual(after[field] ?? null, before[field] ?? null);
      assert.deepEqual(after.tags, ['triagem']);
    });
  }

  it('queue/assigneeAgent so por setServiceTicketSystemFields', () => {
    const { repo, id } = setup();
    const out = repo.setServiceTicketSystemFields(id, { queue: 'N2', assigneeAgent: 'agente@setatelecom.com.br' })!;
    assert.equal(out.queue, 'N2');
    assert.equal(out.assigneeAgent, 'agente@setatelecom.com.br');
  });

  it('CSAT: recordTicketCsat valida 1..5; patch so com csatScore e o caminho transitorio do portal', () => {
    const { repo, id } = setup();
    assert.equal(repo.recordTicketCsat(id, 0), null);
    assert.equal(repo.recordTicketCsat(id, 6), null);
    assert.equal(repo.recordTicketCsat(id, 4)!.csatScore, 4);
    assert.equal(repo.updateServiceTicket(id, { csatScore: 9 })!, null);
    assert.equal(repo.getServiceTicketById(id)!.csatScore, 4);
    assert.equal(repo.updateServiceTicket(id, { csatScore: 5 })!.csatScore, 5);
  });

  it('addTicketComment: papel fora de AGENT/CUSTOMER vira AGENT', () => {
    const { repo, id } = setup();
    const out = repo.addTicketComment(id, { author: 'X', authorRole: 'SYSTEM_ADMIN' as never, body: 'ROLE LIVRE' })!;
    assert.equal(out.comments.at(-1)!.authorRole, 'AGENT');
  });

  it('PATCH /api/tickets/:id pelo router: campo fora do schema => 400 e nada muda (pacote H)', async () => {
    const { repo, id, before } = setup();
    const router = new CrmApiRouter(repo);
    const flipped = before.comments.map((c: Record<string, unknown>) => ({ ...c, isInternal: false }));
    const r = await router.dispatch({
      method: 'PATCH', path: `/api/tickets/${before.key}`, query: {}, context: TRUSTED_INTERNAL_CONTEXT,
      body: { comments: flipped, contactId: 'outro', firstRespondedAt: '2020-01-01T00:00:00.000Z', priority: 'HIGH' },
    });
    assert.equal(r.status, 400);
    const rb = r.body as { code: string; fields: string[] };
    assert.equal(rb.code, 'TICKET_PATCH_FIELD_NOT_ALLOWED');
    assert.deepEqual([...rb.fields].sort(), ['comments', 'contactId', 'firstRespondedAt']);
    const after = repo.getServiceTicketById(id)!;
    assert.equal(after.contactId, before.contactId);
    assert.equal(after.firstRespondedAt ?? null, before.firstRespondedAt ?? null);
    assert.equal(after.comments.find((c) => c.body === 'SEGREDO INTERNO')!.isInternal, true);
    assert.equal(after.priority, before.priority, 'patch recusado inteiro, inclusive o campo valido');
  });

  for (const field of ['queue', 'assigneeAgent', 'companyId', 'dealId']) {
    it(`PATCH /api/tickets/:id pelo router: ${field} => 400 TICKET_PATCH_FIELD_NOT_ALLOWED`, async () => {
      const { repo, before } = setup();
      const r = await new CrmApiRouter(repo).dispatch({
        method: 'PATCH', path: `/api/tickets/${before.key}`, query: {}, context: TRUSTED_INTERNAL_CONTEXT,
        body: { [field]: 'x', priority: 'HIGH' },
      });
      assert.equal(r.status, 400);
      assert.deepEqual((r.body as { fields: string[] }).fields, [field]);
    });
  }

  it('PATCH /api/tickets/:id pelo router: campos que o ServiceDeskTab envia => 200', async () => {
    const { repo, id, before } = setup();
    const router = new CrmApiRouter(repo);
    for (const body of [
      { status: 'IN_PROGRESS' }, { assignee: 'N2' }, { priority: 'HIGH' },
      { equipmentSerial: 'SN-TESTE-1' }, { equipmentSerial: null }, { contractId: null },
    ]) {
      const r = await router.dispatch({ method: 'PATCH', path: `/api/tickets/${before.key}`, query: {}, context: TRUSTED_INTERNAL_CONTEXT, body });
      assert.equal(r.status, 200, JSON.stringify(body));
    }
    const after = repo.getServiceTicketById(id)!;
    assert.equal(after.status, 'IN_PROGRESS');
    assert.equal(after.assignee, 'N2');
    assert.equal(after.priority, 'HIGH');
  });

  it('comentario da equipe pelo router: interno por padrao; isInternal:false explicito publica e audita', async () => {
    const { repo, id, before } = setup();
    const router = new CrmApiRouter(repo);
    const audits = () => repo.listSecurityAuditLogs(10000).logs.filter((l) => l.action === 'TICKET_COMMENT_PUBLIC').length;
    const n0 = audits();
    const r1 = await router.dispatch({
      method: 'POST', path: `/api/tickets/${before.key}/comments`, query: {}, context: TRUSTED_INTERNAL_CONTEXT,
      body: { body: 'SEM FLAG' },
    });
    assert.ok(r1.status >= 200 && r1.status < 300, String(r1.status));
    const r2 = await router.dispatch({
      method: 'POST', path: `/api/tickets/${before.key}/comments`, query: {}, context: TRUSTED_INTERNAL_CONTEXT,
      body: { body: 'PUBLICO EXPLICITO', isInternal: false },
    });
    assert.ok(r2.status >= 200 && r2.status < 300, String(r2.status));
    assert.equal(audits(), n0 + 1, 'so o publico explicito gera auditoria');
    const cs = repo.getServiceTicketById(id)!.comments;
    assert.equal(cs.find((c) => c.body === 'SEM FLAG')!.isInternal, true);
    assert.equal(cs.find((c) => c.body === 'PUBLICO EXPLICITO')!.isInternal, false);
    assert.equal(cs.find((c) => c.body === 'SEM FLAG')!.authorRole, 'AGENT');
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
    await pool.query('DROP SEQUENCE IF EXISTS setadesk_ticket_seq, setadesk_ticket_seq_tec, setadesk_ticket_seq_fin');
    await pool.query('DROP TABLE IF EXISTS setadesk_pipelines CASCADE');
  });

  after(async () => {
    await pg.closePostgresPool();
    if (savedUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedUrl;
  });

  it('aplica migracoes uma vez e reaplicar e no-op', async () => {
    const first = await store.ensureSetaDeskSchema();
    assert.deepEqual(first, ['0001_setadesk_core', '0002_align_seq_stt', '0003_comments_internal_default', '0004_pipelines_and_history_uidx']);
    store.resetSetaDeskSchemaCache();
    const second = await store.ensureSetaDeskSchema();
    assert.deepEqual(second, []);
    const def = await pg.getPostgresPool()!.query(
      `SELECT column_default FROM information_schema.columns
        WHERE table_name = 'setadesk_ticket_comments' AND column_name = 'is_internal'`
    );
    assert.match(String(def.rows[0].column_default), /true/i);
  });

  it('nao copia os 5 chamados demo JSM-101..105; copia legado real e emite SD- sem colidir', async () => {
    const repo = createInMemoryRepository();
    const demos = (repo.getState().serviceTickets || []).filter((t) => store.isLegacyDemoServiceTicket(t));
    assert.equal(demos.length, 5);
    repo.createServiceTicket({ subject: 'ja TEC', key: 'TEC-7' });
    const legacy = repo.getState().serviceTickets;
    const loaded = await store.loadSetaDeskTickets(legacy);
    assert.ok(loaded);
    assert.equal(loaded!.tickets.some((t) => store.isLegacyDemoServiceTicket(t)), false);
    assert.equal(loaded!.tickets.length, 1);
    assert.equal(loaded!.tickets[0].key, 'TEC-7');
    const same = await store.loadSetaDeskTickets(legacy);
    assert.equal(same!.tickets.length, 1, 'nada duplicado ao recarregar, demos continuam de fora');
    const extra = { ...loaded!.tickets[0], id: 'tkt-legado-x1', key: 'X-1', comments: [] as never[] };
    const again = await store.loadSetaDeskTickets([...legacy, extra]);
    assert.equal(again!.tickets.length, 2, 'chamado legado novo (nao demo) e copiado');
    const keys = await store.reserveSetaDeskTicketKeys(2);
    assert.deepEqual(keys, ['TEC-8', 'TEC-9']);
  });

  it('legado mais novo atualiza a tabela; legado mais antigo nao sobrescreve', async () => {
    const base = (await store.loadSetaDeskTickets([]))!;
    const t7 = base.tickets.find((t) => t.key === 'TEC-7')!;
    const newer = { ...t7, subject: 'Editado no legado', updatedAt: new Date(Date.parse(t7.updatedAt) + 60000).toISOString() };
    const r1 = (await store.loadSetaDeskTickets([newer]))!;
    assert.equal(r1.tickets.find((t) => t.id === t7.id)!.subject, 'Editado no legado');
    const older = { ...t7, subject: 'Velho', updatedAt: new Date(Date.parse(t7.updatedAt) - 60000).toISOString() };
    const r2 = (await store.loadSetaDeskTickets([older]))!;
    assert.equal(r2.tickets.find((t) => t.id === t7.id)!.subject, 'Editado no legado');
  });

  it('sync grava novos/alterados, comentarios idempotentes, historico, notificacao e exclusao', async () => {
    const loaded = (await store.loadSetaDeskTickets([]))!;
    const repo = createInMemoryRepository();
    repo.replaceServiceTickets(loaded.tickets);
    const seed = repo.createServiceTicket({ subject: 'Alvo do sync', key: 'TEC-20', id: 'tkt-sync-alvo' });
    const doomed = repo.createServiceTicket({ subject: 'A apagar', key: 'TEC-21', id: 'tkt-sync-apagar' });
    await store.syncSetaDeskTickets(repo.getState().serviceTickets, loaded.baseline);
    const afterSeed = (await store.loadSetaDeskTickets([]))!;
    const [key] = await store.reserveSetaDeskTicketKeys(1);
    repo.reserveTicketKeys([key]);
    const t = repo.createServiceTicket({ subject: 'Via sync', requesterEmail: 'c@x.com', ccEmails: ['d@x.com'] });
    assert.equal(t.key, key);
    repo.addTicketComment(t.id, { author: 'Agente', body: 'Primeira resposta' });
    repo.updateServiceTicket(seed.id, { status: 'IN_PROGRESS', priority: 'CRITICAL' });
    repo.deleteServiceTicket(doomed.id);
    const r = await store.syncSetaDeskTickets(repo.getState().serviceTickets, afterSeed.baseline, 'tester@setatelecom.com.br');
    assert.equal(r.upserted, 2);
    assert.equal(r.deleted, 1);
    // segunda chamada sem mudancas => nada a gravar
    assert.deepEqual(await store.syncSetaDeskTickets(repo.getState().serviceTickets, afterSeed.baseline), { upserted: 0, deleted: 0 });

    const reread = (await store.loadSetaDeskTickets([]))!;
    const back = reread.tickets.find((x) => x.key === key)!;
    assert.equal(back.requesterEmail, 'c@x.com');
    assert.deepEqual(back.ccEmails, ['d@x.com']);
    assert.equal(back.comments.length, 1);
    assert.ok(!reread.tickets.some((x) => x.id === doomed.id));
    // apagado no SetaDesk nao ressuscita a partir do snapshot legado
    const reread2 = (await store.loadSetaDeskTickets([doomed]))!;
    assert.ok(!reread2.tickets.some((x) => x.id === doomed.id));
    // demos continuam de fora
    const legacy105 = createInMemoryRepository().getServiceTicketById('JSM-105')!;
    const reread3 = (await store.loadSetaDeskTickets([legacy105]))!;
    assert.ok(!reread3.tickets.some((x) => store.isLegacyDemoServiceTicket(x)));

    const pool = pg.getPostgresPool()!;
    const hist = await pool.query(`SELECT field FROM setadesk_ticket_history h JOIN setadesk_tickets t ON t.id = h.ticket_id WHERE t.id = $1 ORDER BY field`, [seed.id]);
    assert.ok(hist.rows.map((x) => x.field).includes('priority'));
    const notif = await pool.query(`SELECT count(*)::int AS n FROM setadesk_notifications WHERE ticket_id = $1`, [t.id]);
    assert.equal(notif.rows[0].n, 1);
    // jira_key unico
    await pool.query(`UPDATE setadesk_tickets SET jira_key = 'STT-1' WHERE key = $1`, [key]);
    await pool.query(`UPDATE setadesk_tickets SET jira_key = 'STT-2' WHERE key = 'TEC-7'`);
    await assert.rejects(pool.query(`UPDATE setadesk_tickets SET jira_key = 'stt-1' WHERE key = 'TEC-7'`));
    // message_id unico (case-insensitive)
    await pool.query(`INSERT INTO setadesk_email_messages (id, direction, message_id) VALUES ('m1', 'INBOUND', '<A@b>')`);
    await assert.rejects(pool.query(`INSERT INTO setadesk_email_messages (id, direction, message_id) VALUES ('m2', 'INBOUND', '<a@B>')`));
  });

  it('chamado novo com chave local colidente e reemitido pela sequencia', async () => {
    const loaded = (await store.loadSetaDeskTickets([]))!;
    const repo = createInMemoryRepository();
    repo.replaceServiceTickets(loaded.tickets);
    repo.createServiceTicket({ subject: 'Colisao', key: 'TEC-7', id: 'tkt-colisao' });
    await store.syncSetaDeskTickets(repo.getState().serviceTickets, loaded.baseline);
    const reread = (await store.loadSetaDeskTickets([]))!;
    const saved = reread.tickets.find((x) => x.id === 'tkt-colisao')!;
    assert.match(saved.key, /^TEC-\d+$/);
    assert.notEqual(saved.key, 'TEC-7');
    assert.equal(reread.tickets.filter((x) => x.key === 'TEC-7').length, 1);
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
    const contact = seedRepo.listContacts().find((c) => c.email)!;
    const email = contact.email;
    const base = (await store.loadSetaDeskTickets([]))!;
    seedRepo.replaceServiceTickets(base.tickets);
    const created = seedRepo.createServiceTicket({
      subject: 'Lido do Postgres',
      key: 'TEC-30',
      id: 'tkt-portal-dto',
      contactId: contact.id,
    });
    seedRepo.setServiceTicketSystemFields(created.id, {
      requesterEmail: 'solicitante.oculto@exemplo.com',
      ccEmails: ['cc.oculto@exemplo.com'],
      jiraKey: 'STT-777',
      jiraId: '99999',
    });
    seedRepo.setServiceTicketSystemFields(created.id, { assigneeAgent: 'tecnico.oculto@setatelecom.com.br' });
    await store.syncSetaDeskTickets(seedRepo.getState().serviceTickets, base.baseline);
    const reread = (await store.loadSetaDeskTickets([]))!;
    const fromDb = reread.tickets.find((t) => t.id === created.id)!;
    assert.equal(fromDb.jiraKey, 'STT-777');
    assert.deepEqual(fromDb.ccEmails, ['cc.oculto@exemplo.com']);
    const repo = createInMemoryRepository();
    repo.replaceServiceTickets(reread.tickets);
    const data = await assertPortalDtoMinimal(new CrmApiRouter(repo), created.key, email);
    assert.equal(data.subject, 'Lido do Postgres');
  });

  it('comentario gravado e append-only: visibilidade e corpo nao mudam por estado em memoria', async () => {
    const base = (await store.loadSetaDeskTickets([]))!;
    const repo = createInMemoryRepository();
    repo.replaceServiceTickets(base.tickets);
    const t = base.tickets[0];
    repo.addTicketComment(t.id, { author: 'Agente', isInternal: true, body: 'NOTA INTERNA PG' });
    await store.syncSetaDeskTickets(repo.getState().serviceTickets, base.baseline);
    const mem = repo.getServiceTicketById(t.id)!;
    const note = mem.comments.find((c) => c.body === 'NOTA INTERNA PG')!;
    note.isInternal = false; // simula estado adulterado em memoria
    note.body = 'adulterado';
    mem.updatedAt = new Date(Date.now() + 1000).toISOString();
    await store.syncSetaDeskTickets(repo.getState().serviceTickets, base.baseline);
    const row = await pg.getPostgresPool()!.query(`SELECT is_internal, body FROM setadesk_ticket_comments WHERE id = $1`, [note.id]);
    assert.equal(row.rows[0].is_internal, true);
    assert.equal(row.rows[0].body, 'NOTA INTERNA PG');
  });

  it('mudanca de csatScore e contactId fica no historico', async () => {
    const base = (await store.loadSetaDeskTickets([]))!;
    const repo = createInMemoryRepository();
    repo.replaceServiceTickets(base.tickets);
    const t = base.tickets[0];
    repo.recordTicketCsat(t.id, 3);
    await store.syncSetaDeskTickets(repo.getState().serviceTickets, base.baseline, 'auditoria@setatelecom.com.br');
    const h = await pg.getPostgresPool()!.query(
      `SELECT field, new_value, actor FROM setadesk_ticket_history WHERE ticket_id = $1 AND field = 'csatScore' ORDER BY id DESC LIMIT 1`, [t.id]);
    assert.equal(h.rows[0].new_value, 3);
    assert.equal(h.rows[0].actor, 'auditoria@setatelecom.com.br');
  });

  it('applyJiraImport grava STT, e idempotente e alinha a sequencia para max(STT)+1', async () => {
    const { mapJiraIssue } = await import('../src/db/setadesk-jira-map');
    const mapped = mapJiraIssue({
      id: '90001',
      key: 'STT-248',
      fields: {
        summary: 'Ponta da sequencia',
        status: { name: 'Aguardando Suporte' },
        priority: { name: 'Low' },
        issuetype: { name: 'Task' },
        created: '2025-01-01T12:00:00.000-0300',
        updated: '2025-01-02T12:00:00.000-0300',
        comment: {
          comments: [
            {
              id: 'c-pub',
              jsdPublic: true,
              body: 'publico',
              created: '2025-01-01T13:00:00.000-0300',
              author: { displayName: 'Cliente', accountType: 'customer' },
            },
            {
              id: 'c-int',
              jsdPublic: false,
              body: 'interno',
              created: '2025-01-01T14:00:00.000-0300',
              author: { displayName: 'Agente', accountType: 'atlassian' },
            },
          ],
        },
        attachment: [
          { id: 'att-1', filename: 'foto.jpg', size: 10, mimeType: 'image/jpeg', content: 'https://example.test/foto.jpg' },
        ],
        labels: [],
      },
    });
    assert.equal(mapped.ticket.key, 'TEC-248');
    assert.equal(mapped.ticket.comments.find((c) => c.body === 'publico')!.isInternal, false);
    assert.equal(mapped.ticket.comments.find((c) => c.body === 'interno')!.isInternal, true);
    const plan = [{ action: 'create' as const, reason: 'test', mapped }];
    const first = await store.applyJiraImport(plan, { maxStt: 248 });
    assert.equal(first.created, 1);
    assert.equal(first.nextSequenceValue, 249);
    const second = await store.applyJiraImport(plan, { maxStt: 248 });
    assert.equal(second.created, 0);
    assert.equal(second.skipped, 1);
    assert.equal(second.nextSequenceValue, 249);
    const keys = await store.reserveSetaDeskTicketKeys(1);
    assert.equal(keys[0], 'TEC-249');
    const row = await pg.getPostgresPool()!.query(
      `SELECT is_internal, body FROM setadesk_ticket_comments WHERE ticket_id = $1 ORDER BY body`,
      [mapped.ticket.id]
    );
    assert.equal(row.rows.find((r) => r.body === 'publico').is_internal, false);
    assert.equal(row.rows.find((r) => r.body === 'interno').is_internal, true);
  });
});
