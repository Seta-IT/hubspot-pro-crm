// Fase 6: checagens de mkt_experiments (testes A/B) e ai_marketing_suggestions (IA com aprovacao)
// no Postgres LOCAL descartavel (PGlite). Nunca em producao/Neon.
// Uso: EXTRA=$PWD/scripts/sql-local/validate-enterprise-sql.cjs PGLITE_DIR=/tmp/pgtest WT=$PWD \
//      node scripts/sql-local/validate-marketing-sql.cjs
module.exports = async ({ pool, D, assert }) => {
  const out = [];
  const { PostgresExperimentStore } = require(`${D}/modules/enterprise/experiment-store`);
  const { PostgresAiSuggestionStore } = require(`${D}/modules/enterprise/ai-marketing`);
  const now = '2026-11-19T12:00:00.000Z';
  const exp = (id, campaignId, p = {}) => ({
    id, campaignId, name: 'Teste', kind: 'AB', metric: 'HUMAN_CLICK', purpose: 'NEWSLETTER_TECNICA',
    variants: [{ id: 'A', label: 'A', templateId: 't1', templateVersion: 1, subjectOverride: null }, { id: 'B', label: 'B', templateId: 't2', templateVersion: 1, subjectOverride: 'X' }],
    testPercent: 20, alpha: 0.05, power: 0.8, baselineRate: 0.02, baselineSource: 'x', minDetectableLift: 0.3, minPerVariant: 100, winnerMode: 'AUTO',
    minHoursBeforeDecision: 4, maxTestHours: 72, sendTimeOptimization: false, testSendAt: null, audienceContactIds: ['c1', 'c2'], status: 'DRAFT',
    testStartedAt: null, testContacts: 0, holdoutContactIds: [], blockedAtStart: 0, winnerVariantId: null, decisionMode: null, decidedBy: null, decidedAt: null,
    decision: null, rolloutQueued: 0, rolloutBlocked: 0, reviewTaskId: null, lastEvaluatedAt: null, warnings: [], createdBy: 'a@x.test', createdAt: now, updatedAt: now, ...p,
  });

  const store = new PostgresExperimentStore(pool);
  await store.save(exp('mexp-1', 'cmp-1'));
  await store.save(exp('mexp-1', 'cmp-1', { name: 'Renomeado' }));
  assert.equal((await store.get('mexp-1')).name, 'Renomeado', 'upsert pelo id');
  assert.equal((await store.getByCampaign('cmp-1')).id, 'mexp-1');
  const uq = await pool.query(`SELECT indexdef FROM pg_indexes WHERE tablename = 'mkt_experiments'`);
  assert.ok(uq.rows.some((r) => /UNIQUE/i.test(r.indexdef) && /campaign_id/.test(r.indexdef)), 'um teste por campanha (UNIQUE campaign_id)');
  assert.ok(uq.rows.some((r) => /status/.test(r.indexdef)), 'indice por status');
  // CAS: DRAFT -> TESTING so uma vez, mesmo em paralelo.
  const [a, b] = await Promise.all([store.transition('mexp-1', ['DRAFT'], { status: 'TESTING', testContacts: 10 }), store.transition('mexp-1', ['DRAFT'], { status: 'TESTING', testContacts: 20 })]);
  assert.equal([a, b].filter(Boolean).length, 1, 'so uma transicao vence');
  const cur = await store.get('mexp-1');
  assert.equal(cur.status, 'TESTING');
  assert.deepEqual((await store.listByStatus(['TESTING'])).map((e) => e.id), ['mexp-1']);
  const col = await pool.query(`SELECT status FROM mkt_experiments WHERE id = 'mexp-1'`);
  assert.equal(col.rows[0].status, 'TESTING', 'coluna status acompanha o JSON');
  const [w1, w2] = await Promise.all([
    store.transition('mexp-1', ['TESTING', 'NEEDS_DECISION'], { status: 'WINNER_SELECTED', winnerVariantId: 'A' }),
    store.transition('mexp-1', ['TESTING', 'NEEDS_DECISION'], { status: 'WINNER_SELECTED', winnerVariantId: 'B' }),
  ]);
  assert.equal([w1, w2].filter(Boolean).length, 1, 'um unico vencedor');
  const nochange = await store.transition('mexp-1', ['DRAFT'], { status: 'CANCELLED' });
  assert.equal(nochange, null);
  const idPatch = await store.transition('mexp-1', ['WINNER_SELECTED'], { status: 'COMPLETED', id: 'outro', campaignId: 'outra' });
  assert.equal(idPatch.id, 'mexp-1');
  assert.equal(idPatch.campaignId, 'cmp-1', 'id e campanha nao mudam por patch');
  await store.save(exp('mexp-2', 'cmp-2'));
  assert.equal((await store.list()).length, 2);
  await new PostgresExperimentStore(pool).get('mexp-2');
  out.push('mkt_experiments: DDL idempotente, upsert, UNIQUE por campanha, CAS DRAFT->TESTING e vencedor unico em paralelo');

  const ai = new PostgresAiSuggestionStore(pool);
  const sug = (id, by, at) => ({ id, kind: 'SUBJECT', status: 'PENDING_APPROVAL', target: { type: 'BRIEF', id: null }, items: [{ text: 'x', rationale: 'y' }], summary: null, confidence: 0.4, confidenceLevel: 'BAIXA', modelConfidence: 0.9, dataConfidence: 0.35, evidence: [], basedOn: [], caveats: [], model: 'm', createdBy: by, createdAt: at, decidedBy: null, decidedAt: null, decisionNote: null });
  await ai.save(sug('aisg-1', 'a@x.test', '2026-11-19T12:00:00.000Z'));
  await ai.save(sug('aisg-2', 'a@x.test', '2026-11-19T13:00:00.000Z'));
  await ai.save(sug('aisg-3', 'b@x.test', '2026-11-19T14:00:00.000Z'));
  assert.deepEqual((await ai.list({ createdBy: 'a@x.test', limit: 50 })).map((s) => s.id), ['aisg-2', 'aisg-1'], 'so do autor, mais recente primeiro');
  assert.equal((await ai.list({ limit: 50 })).length, 3);
  const [p1, p2] = await Promise.all([ai.transition('aisg-1', ['PENDING_APPROVAL'], { status: 'APPROVED', decidedBy: 'a@x.test' }), ai.transition('aisg-1', ['PENDING_APPROVAL'], { status: 'REJECTED', decidedBy: 'c@x.test' })]);
  assert.equal([p1, p2].filter(Boolean).length, 1, 'decisao unica');
  const st = await pool.query(`SELECT status FROM ai_marketing_suggestions WHERE id = 'aisg-1'`);
  assert.equal(st.rows[0].status, (await ai.get('aisg-1')).status);
  const idx = await pool.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'ai_marketing_suggestions'`);
  assert.ok(idx.rows.some((r) => r.indexname === 'ai_marketing_suggestions_owner_idx'));
  out.push('ai_marketing_suggestions: DDL idempotente, lista por autor, CAS de aprovacao/rejeicao unico');
  return out;
};
