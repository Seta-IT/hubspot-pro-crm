// Fase 5: checagens de crm_engagement_signals e da busca por tracking_id em crm_email_messages,
// no Postgres LOCAL descartavel (PGlite). Nunca em producao/Neon.
// Uso: EXTRA=$PWD/scripts/sql-local/validate-analytics-sql.cjs PGLITE_DIR=/tmp/pgtest WT=$PWD \
//      node scripts/sql-local/validate-marketing-sql.cjs
module.exports = async ({ pool, D, assert }) => {
  const out = [];
  const { PostgresSignalStore } = require(`${D}/modules/analytics/signal-store`);
  const { PostgresMailboxStore } = require(`${D}/modules/email/mailbox-store`);
  const { recordTrackedSignal } = require(`${D}/modules/analytics/signal-recorder`);
  const { syncSequenceEngagement } = require(`${D}/modules/analytics/engagement-sync`);
  const { createInMemoryRepository } = require(`${D}/db/repository`);
  const signals = new PostgresSignalStore(pool);
  const base = Date.parse('2026-11-19T12:00:00.000Z');
  const at = (s) => new Date(base + s * 1000).toISOString();
  const mk = (id, p) => ({ id, source: 'TRACKING', kind: 'OPEN', classification: 'OPEN_OBSERVED', reasons: ['x'], at: at(0), trackingId: 'tr-a', contactId: 'c-a', campaignId: null, messageSource: 'CRM', url: null, linkIndex: null, uaFamily: 'Navegador', ipNetwork: '200.1.2.0/24', secondsSinceSent: 100, ...p });

  assert.equal(await signals.record(mk('s1', {})), true);
  assert.equal(await signals.record(mk('s1', {})), false, 'id repetido ignorado (ON CONFLICT DO NOTHING)');
  await signals.record(mk('s2', { kind: 'CLICK', classification: 'CLICK_HUMAN', at: at(600), url: 'https://example.test/a' }));
  await signals.record(mk('s3', { kind: 'CLICK', classification: 'CLICK_BOT', at: at(5), trackingId: 'tr-b', contactId: 'c-b' }));
  const since = await signals.listSince(at(-10), at(10000), 100);
  assert.deepEqual(since.map((s) => s.id), ['s1', 's3', 's2'], 'ordenado por data');
  assert.equal((await signals.listSince(at(100), at(10000), 100)).length, 1, 'filtro de periodo');
  assert.deepEqual((await signals.listByTracking(['tr-a'])).map((s) => s.id), ['s1', 's2']);
  assert.deepEqual((await signals.listByTracking([])).length, 0);
  assert.deepEqual((await signals.listByContact('c-a', 10)).map((s) => s.id), ['s2', 's1'], 'mais recente primeiro');
  const idx = await pool.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'crm_engagement_signals' ORDER BY 1`);
  assert.ok(idx.rows.length >= 4, JSON.stringify(idx.rows));
  await new PostgresSignalStore(pool).record(mk('s4', { at: at(1) }));
  out.push('crm_engagement_signals: DDL idempotente, PK recusa repetido sem erro, periodo/tracking/contato e indices');

  // getByTrackingId + gravacao do sinal a partir da mensagem rastreada.
  const mailbox = new PostgresMailboxStore(pool);
  const tid = 'trk-analytics-sql-1';
  await mailbox.insertMessage({ id: 'eml-an-1', accountId: null, ownerEmail: null, externalId: 'mkt:cmp-9:c9', conversationId: null, internetMessageId: null, direction: 'ENVIADO', source: 'STI_HUB', fromAddress: 'news@example.test', fromName: 'X', to: ['c9@example.test'], cc: [], subject: 's', bodyPreview: '', occurredAt: at(-3600), contactId: null, companyId: null, dealId: null, trackingId: tid, links: ['https://example.test/z'], openCount: 0, clickCount: 0, lastOpenedAt: null, lastClickedAt: null, createdAt: at(-3600) });
  assert.equal((await mailbox.getByTrackingId(tid)).id, 'eml-an-1');
  assert.equal(await mailbox.getByTrackingId('inexistente'), null);
  const s = await recordTrackedSignal(mailbox, signals, { kind: 'CLICK', trackingId: tid, linkIndex: 0, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36', ip: '189.10.20.30', at: at(0) });
  assert.equal(s.classification, 'CLICK_HUMAN');
  assert.equal(s.campaignId, 'cmp-9');
  const saved = (await signals.listByTracking([tid]))[0];
  assert.equal(saved.ipNetwork, '189.10.20.0/24');
  assert.ok(!JSON.stringify(saved).includes('189.10.20.30'));
  out.push('crm_email_messages.getByTrackingId + sinal classificado gravado (IP truncado)');

  // Sincronizacao com as cadencias lendo do Postgres.
  const repo = createInMemoryRepository();
  const c = repo.listContacts()[0];
  const seq = repo.listSequences()[0];
  repo.saveSequenceEnrollment({ id: 'enr-sql', sequenceId: seq.id, contactId: c.id, dealId: null, status: 'ACTIVE', currentStepOrder: 1, stepsCompleted: 1, sentCount: 1, openCount: 0, clickCount: 0, repliedAt: null, replySnippet: null, nextStepDueAt: null, stepDeliveries: [{ stepOrder: 1, idempotencyKey: 'k', status: 'SENT', attempts: 1, trackingId: 'tr-a', sentAt: at(-100), updatedAt: at(-100) }], history: [], enrolledAt: at(-100), updatedAt: at(-100) });
  const r1 = await syncSequenceEngagement(repo, signals);
  const r2 = await syncSequenceEngagement(repo, signals);
  assert.equal(r1.enrollmentsUpdated, 1);
  assert.equal(r2.enrollmentsUpdated, 0);
  const e = repo.listSequenceEnrollments().find((x) => x.id === 'enr-sql');
  assert.deepEqual([e.openCount, e.clickCount], [1, 1]);
  out.push('sincronizacao rastreio -> contadores da cadencia a partir do Postgres (idempotente)');
  return out;
};
