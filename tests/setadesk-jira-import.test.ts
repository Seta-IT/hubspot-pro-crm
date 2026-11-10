// ============================================================================
// SetaDesk - mapeamento e plano de importacao Jira STT (sem banco, sem rede)
// ============================================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeRealtimeTicketSla } from '../src/api/router';
import {
  mapJiraCategory,
  mapJiraChannel,
  mapJiraIssue,
  mapJiraPriority,
  mapJiraStatus,
  planJiraImport,
  sdKeyFromStt,
  toIso,
} from '../src/db/setadesk-jira-map';

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
  it('STT-n vira SD-n', () => {
    assert.equal(sdKeyFromStt('STT-123'), 'SD-123');
    assert.equal(sdKeyFromStt('DEV-123'), null);
    assert.equal(sdKeyFromStt('STT-0'), null);
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
    assert.equal(mapped.ticket.key, 'SD-123');
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
});
