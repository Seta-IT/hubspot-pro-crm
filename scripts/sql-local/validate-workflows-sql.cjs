// Fase 4: checagens extras das tabelas wf_* no Postgres LOCAL descartavel (PGlite).
// Uso: EXTRA=$PWD/scripts/sql-local/validate-workflows-sql.cjs PGLITE_DIR=/tmp/pgtest WT=$PWD \
//      node scripts/sql-local/validate-marketing-sql.cjs
module.exports = async ({ pool, D, assert }) => {
  const out = [];
  const { PostgresWorkflowStore } = require(`${D}/modules/workflows/dag/store`);
  const { PostgresLockStore } = require(`${D}/db/distributed-lock`);
  const { createInMemoryRepository } = require(`${D}/db/repository`);
  const eng = require(`${D}/modules/workflows/dag/engine`);
  const store = new PostgresWorkflowStore(pool);
  let t = Date.parse('2026-11-19T12:00:00.000Z');
  const now = () => new Date(t);
  const env = { WORKFLOWS_LIVE: 'true' };

  // Definicao + versoes (PK workflow/versao), simulacao obrigatoria, ativacao.
  const repo = createInMemoryRepository();
  const c = repo.listContacts()[0];
  c.customProperties = {};
  const graph = {
    trigger: { type: 'CUSTOM_EVENT', config: {} },
    startNodeId: 't',
    nodes: [
      { id: 't', kind: 'ACTION', action: 'TAG', config: { tag: 'sql', mode: 'ADD' }, next: 'd' },
      { id: 'd', kind: 'DELAY', config: { minutes: 30 }, next: 'k' },
      { id: 'k', kind: 'ACTION', action: 'CREATE_TASK', config: { title: 'Tarefa SQL' }, next: null },
    ],
    reentry: { mode: 'NEVER', cooldownDays: 0 },
  };
  const def = await eng.createWorkflowDefinition(store, { name: 'SQL', graph }, 'a@x.test', now());
  await eng.saveWorkflowDraft(store, def.id, { graph }, 'a@x.test', now());
  assert.equal((await store.listVersions(def.id)).length, 2);
  await assert.rejects(store.insertVersion({ workflowId: def.id, version: 2, graph, createdBy: 'x', createdAt: now().toISOString() }), (e) => e.code === '23505');
  await assert.rejects(eng.activateWorkflow(store, def.id, 'a@x.test', now()), /Simule/);
  const sim = await eng.simulateWorkflow(repo, { store, env, now }, (await store.getDefinition(def.id)).graph, c.id);
  assert.equal(sim.ok, true);
  await eng.recordSimulation(store, def.id, sim, now());
  await eng.activateWorkflow(store, def.id, 'a@x.test', now());
  out.push('wf_definitions / wf_versions: versoes, PK (fluxo, versao) recusa duplicada, ativacao exige simulacao');

  // Eventos idempotentes por id.
  assert.equal(await eng.emitWorkflowEvent({ store, env, now }, { type: 'CUSTOM_EVENT', contactId: c.id, eventId: 'ev-sql-1' }), true);
  assert.equal(await eng.emitWorkflowEvent({ store, env, now }, { type: 'CUSTOM_EVENT', contactId: c.id, eventId: 'ev-sql-1' }), false);
  assert.equal((await store.listPendingEvents(10)).length, 1);
  out.push('wf_events: ON CONFLICT (id) DO NOTHING => evento repetido nao duplica');

  // Dois ticks concorrentes com a trava global no Postgres.
  const lock = new PostgresLockStore(pool);
  const deps = { store, env, lock, now };
  const [a, b] = await Promise.all([eng.runWorkflowsTick(repo, deps), eng.runWorkflowsTick(repo, deps)]);
  assert.ok([a.skipped, b.skipped].includes('RUN_LOCKED_ELSEWHERE'), JSON.stringify([a, b]));
  const runs = await store.listRunsFor(def.id, c.id);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'WAITING');
  const r2 = await eng.runWorkflowsTick(repo, deps);
  assert.equal(r2.runsStarted, 0);
  assert.equal(r2.stepsExecuted, 0);
  t += 31 * 60000;
  const r3 = await eng.runWorkflowsTick(repo, deps);
  assert.equal(r3.runsCompleted, 1);
  assert.equal(repo.listTasks().filter((x) => x.title === 'Tarefa SQL').length, 1);
  const steps = await store.listSteps(runs[0].id);
  assert.deepEqual(steps.map((s) => [s.nodeId, s.outcome]), [['t', 'DONE'], ['d', 'DONE'], ['k', 'DONE']]);
  out.push('wf_runs / wf_run_steps: 2 ticks simultaneos => 1 execucao; atraso; reprocesso nao repete; historico em ordem');

  // Reserva do no (PK run/no) e UNIQUE (fluxo, evento).
  assert.equal(await store.claimStep({ runId: runs[0].id, nodeId: 'k', seq: 9, kind: 'ACTION', action: 'CREATE_TASK', outcome: 'STARTED', message: '', port: null, at: now().toISOString(), finishedAt: null }), false);
  assert.equal(await store.createRun({ ...runs[0], id: 'wfr-outro' }), false, 'UNIQUE (workflow_id, trigger_event_id)');
  assert.equal((await store.listRunsByContact(c.id, 10)).length, 1);
  out.push('wf_run_steps PK (run, no) e wf_runs UNIQUE (fluxo, evento): sem execucao dupla');
  return out;
};
