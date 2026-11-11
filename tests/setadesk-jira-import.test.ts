// ============================================================================
// SetaDesk - mapeamento e plano de importacao Jira STT (sem banco, sem rede)
// ============================================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeRealtimeTicketSla } from '../src/api/router';
import {
  mapJiraCategory,
  mapJiraChannel,
  mapJiraComments,
  mapJiraChangelog,
  mapJiraIssue,
  mapJiraPriority,
  mapJiraStatus,
  planJiraImport,
  ticketKeyFromJira,
  sdKeyFromStt,
  toIso,
} from '../src/db/setadesk-jira-map';
import { setaDeskImportApplyDenial } from '../src/db/cli-import-jira';

const issue = (over: Record<string, unknown> = {}) =>
  ({
    id: '11262',
    key: 'STT-123',
    fields: {
      summary: 'Troca de switch SN: FDO1707Z0PG',
      description: 'Cliente sem sinal no link.',
      status: { name: 'Aguardando Cliente' },
      priority: { name: 'Low' },
      issuetype: { name: '[System] Service request' },
      created: '2025-05-21T19:30:43.014-0300',
      updated: '2026-04-22T15:43:28.397-0300',
      resolutiondate: null,
      reporter: { displayName: 'Cliente Exemplo', accountType: 'customer' },
      assignee: { displayName: 'Tecnico', accountType: 'atlassian', emailAddress: 'tecnico@example.com' },
      labels: [],
      comment: { comments: [], total: 0 },
      attachment: [{ id: '1', filename: 'foto.jpg', size: 10, mimeType: 'image/jpeg', content: 'https://example.test/foto.jpg' }],
      customFields: {
        'Request Type': { id: 'customfield_10010', value: { requestType: { name: 'Solicitação enviada por e-mail' } } },
        '[CHART] Date of First Response': { id: 'customfield_10024', value: '2025-05-22T08:39:41.574-0300' },
      },
      ...(over.fields as object || {}),
    },
    ...over,
  }) as Record<string, unknown>;

describe('SetaDesk - mapeamento Jira STT', () => {
  it('STT-n vira TEC-n e AF-n vira FIN-n', () => {
    assert.equal(ticketKeyFromJira('STT-123'), 'TEC-123');
    assert.equal(ticketKeyFromJira('AF-45'), 'FIN-45');
    assert.equal(sdKeyFromStt('STT-123'), 'TEC-123');
    assert.equal(ticketKeyFromJira('DEV-123'), null);
    assert.equal(ticketKeyFromJira('STT-0'), null);
  });

  it('mapeia status e prioridade conforme o plano aprovado', () => {
    assert.equal(mapJiraStatus('Fechado').status, 'CLOSED');
    assert.equal(mapJiraStatus('Done').status, 'CLOSED');
    assert.equal(mapJiraStatus('RMA Recebido / Resolvido').status, 'RESOLVED');
    assert.deepEqual(mapJiraStatus('RMA Enviado').tags, ['RMA_ENVIADO']);
    assert.equal(mapJiraStatus('Aguardando Cliente').status, 'WAITING_CUSTOMER');
    assert.equal(mapJiraStatus('Processando').status, 'IN_PROGRESS');
    assert.equal(mapJiraStatus('Aguardando Suporte').status, 'OPEN');
    assert.equal(mapJiraPriority('Highest'), 'CRITICAL');
    assert.equal(mapJiraPriority('High'), 'HIGH');
    assert.equal(mapJiraPriority('Medium'), 'MEDIUM');
    assert.equal(mapJiraPriority('Low'), 'LOW');
    assert.equal(mapJiraPriority(null), 'MEDIUM');
    assert.equal(mapJiraCategory('Task').category, 'SUPPORT');
    assert.equal(mapJiraCategory('Support', 'AF').category, 'BILLING');
    assert.equal(mapJiraCategory('Bug', 'AF').category, 'BUG');
    assert.equal(mapJiraCategory('New Feature', 'AF').category, 'FEATURE_REQUEST');
    assert.deepEqual(mapJiraCategory('Developer escalation', 'AF').tags, ['ESCALADO_DESENVOLVIMENTO']);
    assert.equal(mapJiraCategory('Support', 'STT').category, 'SUPPORT');
    assert.equal(mapJiraChannel('Solicitação enviada por e-mail'), 'EMAIL');
  });

  it('converte data Jira com offset -0300 e extrai serial, anexos e SLA historico sem BREACHED', () => {
    assert.equal(toIso('2025-05-21T19:30:43.014-0300'), '2025-05-21T22:30:43.014Z');
    const changelog = {
      values: [
        {
          id: '1',
          created: '2025-10-06T15:43:18.090-0300',
          author: { displayName: 'Agente' },
          items: [{ field: 'status', fromString: 'RMA Enviado', toString: 'Aguardando Cliente' }],
        },
      ],
    };
    const mapped = mapJiraIssue(issue(), { changelog });
    assert.equal(mapped.ticket.key, 'TEC-123');
    assert.equal(mapped.ticket.jiraKey, 'STT-123');
    assert.equal(mapped.ticket.status, 'WAITING_CUSTOMER');
    assert.equal(mapped.ticket.priority, 'LOW');
    assert.equal(mapped.ticket.channel, 'EMAIL');
    assert.equal(mapped.ticket.equipmentSerial, 'FDO1707Z0PG');
    assert.equal(mapped.ticket.requesterEmail, null);
    assert.equal(mapped.ticket.requesterName, 'Cliente Exemplo');
    assert.ok(mapped.missingFields.includes('requesterEmail'));
    assert.equal(mapped.attachments.length, 1);
    assert.equal(mapped.attachments[0].source, 'JIRA_REF');
    assert.equal(mapped.ticket.slaPausedAt, '2025-10-06T18:43:18.090Z');
    assert.equal(computeRealtimeTicketSla(mapped.ticket).slaStatus, 'ON_TRACK');
    const closed = mapJiraIssue(
      issue({
        fields: {
          ...(issue().fields as object),
          status: { name: 'Fechado' },
          resolutiondate: '2025-06-01T10:00:00.000-0300',
          resolution: { name: 'Done' },
        },
      })
    );
    assert.equal(closed.ticket.status, 'CLOSED');
    assert.equal(closed.ticket.resolvedAt, '2025-06-01T13:00:00.000Z');
    assert.equal(computeRealtimeTicketSla(closed.ticket).slaStatus, 'ON_TRACK');
  });

  it('plano de importacao e idempotente por jira_key e import_hash', () => {
    const mapped = mapJiraIssue(issue());
    const first = planJiraImport([mapped], new Map());
    assert.equal(first[0].action, 'create');
    const second = planJiraImport(
      [mapped],
      new Map([
        [
          'STT-123',
          {
            jiraKey: 'STT-123',
            importHash: mapped.importHash,
            externalUpdatedAt: mapped.ticket.externalUpdatedAt,
          },
        ],
      ])
    );
    assert.equal(second[0].action, 'skip');
  });

  it('comentario so e publico se jsdPublic === true (fail-closed)', () => {
    const commentsOf = (jsdPublic: unknown) =>
      mapJiraComments(
        issue({
          fields: {
            ...(issue().fields as object),
            comment: {
              comments: [
                {
                  id: 'c1',
                  jsdPublic,
                  body: 'texto',
                  created: '2025-05-21T19:30:43.014-0300',
                  author: { displayName: 'Agente', accountType: 'atlassian' },
                },
              ],
            },
          },
        })
      );
    assert.equal(commentsOf(true)[0].isInternal, false);
    assert.equal(commentsOf(false)[0].isInternal, true);
    assert.equal(commentsOf('true')[0].isInternal, true, 'string true nao publica');
    assert.equal(commentsOf('false')[0].isInternal, true);
    assert.equal(commentsOf(undefined)[0].isInternal, true);
    assert.equal(commentsOf(null)[0].isInternal, true);
    assert.equal(commentsOf(1)[0].isInternal, true);
    assert.equal(commentsOf(0)[0].isInternal, true);
  });

  it('--apply continua exigindo SETADESK_IMPORT_APPLY=1 e DATABASE_URL; cadeado do CISO removido', () => {
    assert.match(
      setaDeskImportApplyDenial({}) || '',
      /SETADESK_IMPORT_APPLY=1/
    );
    assert.match(
      setaDeskImportApplyDenial({ SETADESK_IMPORT_APPLY: '1' }) || '',
      /DATABASE_URL/
    );
    assert.equal(
      setaDeskImportApplyDenial({ SETADESK_IMPORT_APPLY: '1', DATABASE_URL: 'postgres://local/test' }),
      null
    );
    assert.doesNotMatch(setaDeskImportApplyDenial({}) || '', /CISO/i);
    assert.doesNotMatch(setaDeskImportApplyDenial({ SETADESK_IMPORT_APPLY: '1' }) || '', /CISO/i);
  });
  it('changelog external_id inclui a chave Jira para nao colidir entre itens', () => {
    const raw = {
      values: [
        {
          id: '999',
          created: '2025-01-01T12:00:00.000-0300',
          author: { displayName: 'Agente' },
          items: [{ field: 'status', fromString: 'Open', toString: 'Processando' }],
        },
      ],
    };
    const a = mapJiraChangelog(raw, 'STT-112');
    const b = mapJiraChangelog(raw, 'STT-113');
    assert.equal(a[0].externalId, 'STT-112:999:0:status');
    assert.equal(b[0].externalId, 'STT-113:999:0:status');
    assert.notEqual(a[0].externalId, b[0].externalId);
  });

  it('AF Support vira chamado FIN- com categoria BILLING', () => {
    const mapped = mapJiraIssue({
      id: '22365',
      key: 'AF-1032',
      fields: {
        summary: 'Envio de faturamento',
        status: { name: 'Aguardando Suporte' },
        priority: { name: 'Low' },
        issuetype: { name: 'Support' },
        created: '2026-09-25T10:00:00.000-0300',
        updated: '2026-09-25T10:00:00.000-0300',
        comment: { comments: [], total: 0 },
        attachment: [],
        labels: [],
      },
    });
    assert.equal(mapped.ticket.key, 'FIN-1032');
    assert.equal(mapped.ticket.pipelineId, 'pl-fin');
    assert.equal(mapped.ticket.category, 'BILLING');
    assert.equal(mapped.ticket.status, 'OPEN');
    assert.equal(mapped.ticket.priority, 'LOW');
    assert.equal(mapped.ticket.jiraProjectKey, 'AF');
  });

});
