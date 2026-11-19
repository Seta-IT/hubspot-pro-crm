// Uso (Postgres LOCAL descartavel, nunca producao/Neon):
//   mkdir -p /tmp/pgtest && cd /tmp/pgtest && npm i @electric-sql/pglite @electric-sql/pglite-socket
//   (no repo) npx tsc -p tsconfig.build.json
//   PGLITE_DIR=/tmp/pgtest WT=$PWD node scripts/sql-local/validate-marketing-sql.cjs
// Validacao do SQL (mkt_*, crm_distributed_locks, crm_email_messages.trackingStats) num Postgres LOCAL
// descartavel (PGlite = Postgres compilado para WASM, em memoria, exposto em 127.0.0.1). Sem rede externa.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const WT = process.env.WT || process.cwd();
const { PGlite } = require(`${process.env.PGLITE_DIR || '/tmp/pgtest'}/node_modules/@electric-sql/pglite`);
const { PGLiteSocketServer } = require(`${process.env.PGLITE_DIR || '/tmp/pgtest'}/node_modules/@electric-sql/pglite-socket`);
const { Pool } = require(`${WT}/node_modules/pg`);
delete process.env.DATABASE_URL; delete process.env.POSTGRES_URL;
process.env.STI_HUB_MAILBOX_ENC_KEY = crypto.randomBytes(32).toString('base64url');
const D = `${WT}/dist/src`;
const { PostgresLockStore } = require(`${D}/db/distributed-lock`);
const { PostgresMarketingStore } = require(`${D}/modules/marketing/marketing-store`);
const { PostgresMailboxStore } = require(`${D}/modules/email/mailbox-store`);
const { createInMemoryRepository } = require(`${D}/db/repository`);
const tpl = require(`${D}/modules/marketing/template-service`);
const disp = require(`${D}/modules/marketing/campaign-dispatcher`);
// EXTRA: um ou mais modulos (separados por virgula), cada um async ({ pool, D, assert }) => string[].
const extraChecks = (process.env.EXTRA || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => require(x));

(async () => {
  const db = await PGlite.create();
  const v = await db.query('select version()');
  const server = new PGLiteSocketServer({ db, port: 54329, host: '127.0.0.1' });
  await server.start();
  const pool = new Pool({ host: '127.0.0.1', port: 54329, user: 'postgres', database: 'postgres', max: 1 });
  pool.on('error', (e) => console.log('pool error', e.message));
  server.addEventListener?.('error', (e) => console.log('server error', e.detail?.message || e));
  // PGlite-socket (0.2.x) derruba a conexao depois de um erro de chave duplicada com parametros longos
  // (limitacao do servidor WASM, nao do SQL). Este invólucro so reabre a conexao e repete a consulta
  // seguinte uma vez; o erro original continua chegando ao chamador.
  const rawPool = pool;
  const q = {
    async query(text, params) {
      try {
        return await rawPool.query(text, params);
      } catch (e) {
        if (!/Connection terminated/.test(String(e && e.message))) throw e;
        await new Promise((r) => setTimeout(r, 50));
        return rawPool.query(text, params);
      }
    },
  };
  const out = [];
  const ok = (m) => { out.push(`OK  ${m}`); };
  try {
    ok(`servidor: ${v.rows[0].version.split(',')[0]}`);
    // ---- trava global
    const lock = new PostgresLockStore(q);
    assert.equal(await lock.acquire('t:1', 'a', 60000), true);
    assert.equal(await lock.acquire('t:1', 'b', 60000), false);
    assert.equal((await lock.peek('t:1')).owner, 'a');
    await lock.release('t:1', 'b');
    assert.equal((await lock.peek('t:1')).owner, 'a', 'release de outro dono nao libera');
    await lock.release('t:1', 'a');
    assert.equal(await lock.peek('t:1'), null);
    assert.equal(await lock.acquire('t:2', 'a', 1000), true);
    await q.query(`UPDATE crm_distributed_locks SET expires_at = now() - interval '1 second' WHERE lock_key = 't:2'`);
    assert.equal(await lock.acquire('t:2', 'b', 60000), true, 'expirada => outro dono assume (CAS)');
    const races = await Promise.all(Array.from({ length: 10 }, (_, i) => lock.acquire('t:race', `o${i}`, 60000)));
    assert.equal(races.filter(Boolean).length, 1, 'corrida: exatamente 1 vencedor');
    ok('crm_distributed_locks: DDL, acquire/CAS, release so do dono, peek, expiracao, corrida 10x => 1');

    // ---- marketing store
    const store = new PostgresMarketingStore(q);
    const { template } = await tpl.createTemplate(store, { name: 'T', purpose: 'NEWSLETTER_TECNICA', subject: 'S', blocks: [{ type: 'text', text: 'oi {{firstName}}' }] }, 'a@x.test');
    await tpl.submitTemplateForReview(store, template.id, 'a@x.test');
    await tpl.approveTemplate(store, template.id, 'b@x.test');
    await tpl.saveTemplateDraft(store, template.id, { subject: 'S2', blocks: [{ type: 'divider' }] }, 'a@x.test');
    assert.equal((await store.listVersions(template.id)).length, 2);
    await assert.rejects(store.insertVersion({ templateId: template.id, version: 2, subject: 'x', preheader: '', blocks: [], createdBy: 'x', createdAt: new Date().toISOString() }), (e) => e.code === '23505');
    assert.equal((await tpl.getSendableVersion(store, template.id)).version.subject, 'S');
    assert.equal((await store.listTemplates()).length, 1);
    ok('mkt_templates / mkt_template_versions: versoes, PK (template, versao) recusa duplicada, versao aprovada');

    const now = new Date().toISOString();
    const row = (c) => ({ campaignId: 'cmp-1', contactId: c, email: `${c}@example.test`, templateId: template.id, templateVersion: 1, purpose: 'NEWSLETTER_TECNICA', status: 'QUEUED', reason: null, attempts: 0, provider: null, providerMessageId: null, trackingId: null, queuedAt: now, nextAttemptAt: now, sentAt: null, deliveredAt: null, bouncedAt: null, complainedAt: null, unsubscribedAt: null, updatedAt: now });
    let r = await store.enqueueSends([row('c1'), row('c2')]);
    assert.deepEqual(r, { inserted: 2, existing: 0 });
    r = await store.enqueueSends([row('c1'), row('c3')]);
    assert.deepEqual(r, { inserted: 1, existing: 1 });
    assert.equal((await store.listDueSends(new Date(Date.now() + 1000).toISOString(), 10)).length, 3);
    await store.updateSend('cmp-1', 'c1', { status: 'SENT', sentAt: now, providerMessageId: 'pm-1' });
    assert.equal((await store.findSendByProviderMessageId('pm-1')).contactId, 'c1');
    assert.equal(await store.countSentSince(new Date(Date.now() - 60000).toISOString()), 1);
    assert.equal((await store.listDueSends(new Date(Date.now() + 1000).toISOString(), 10)).length, 2);
    await store.updateSend('cmp-1', 'c2', { status: 'SENDING', updatedAt: new Date(Date.now() - 2 * 3600e3).toISOString() });
    assert.equal((await store.listStaleSending(new Date(Date.now() - 3600e3).toISOString(), 10)).length, 1);
    assert.equal((await store.listSendsByCampaign('cmp-1')).length, 3);
    const ev = { id: 'e1', providerEventId: 'resend:1', campaignId: 'cmp-1', contactId: 'c1', type: 'DELIVERED', at: now, detail: null };
    assert.equal(await store.recordEvent(ev), true);
    assert.equal(await store.recordEvent({ ...ev, id: 'e2' }), false, 'provider_event_id unico');
    assert.equal((await store.listEvents('cmp-1')).length, 1);
    ok('mkt_sends / mkt_events: idempotencia (campanha, contato), fila, provider id, taxa, presos em SENDING, evento unico');

    // ---- rastreio
    const mailbox = new PostgresMailboxStore(q);
    const tid = crypto.randomBytes(18).toString('base64url');
    await mailbox.insertMessage({ id: 'eml-1', accountId: null, ownerEmail: null, externalId: 'mkt:cmp-1:c1', conversationId: null, internetMessageId: null, direction: 'ENVIADO', source: 'STI_HUB', fromAddress: 'news@example.test', fromName: 'X', to: ['c1@example.test'], cc: [], subject: 's', bodyPreview: '', occurredAt: now, contactId: null, companyId: null, dealId: null, trackingId: tid, links: ['https://example.test'], openCount: 0, clickCount: 0, lastOpenedAt: null, lastClickedAt: null, createdAt: now });
    await mailbox.recordOpen(tid, Date.now() + 60000);
    assert.equal(await mailbox.recordClick(tid, 0, Date.now() + 61000), 'https://example.test');
    assert.equal(await mailbox.recordClick(tid, 5, Date.now() + 61000), null);
    const st = await mailbox.trackingStats([tid, 'inexistente']);
    assert.equal(st.length, 1);
    assert.equal(st[0].openCount, 1);
    assert.equal(st[0].clickCount, 1);
    ok('crm_email_messages: insert de campanha (sem conta/dono), recordOpen, recordClick, trackingStats (ANY($1::text[]))');

    // ---- ponta a ponta com Postgres (fila + trava + store), ESP/DNS falsos
    const repo = createInMemoryRepository();
    const contacts = repo.listContacts().slice(0, 2);
    contacts.forEach((c, i) => Object.assign(c, { email: `pg${i}@example.test`, lgpdConsent: true, subscriptionStatus: 'SUBSCRIBED', isValidEmail: true, isDisposableEmail: false, communicationCategories: ['NEWSLETTER_TECNICA'] }));
    repo.getState().suppressionList = [];
    const calls = [];
    const env = { MARKETING_LIVE_SEND: 'true', MARKETING_ESP_PROVIDER: 'resend', MARKETING_RESEND_API_KEY: 're_falsa', MARKETING_FROM_EMAIL: 'news@news.example.test', MARKETING_POSTAL_ADDRESS: 'Rua Exemplo, 100 - Sao Paulo/SP', MARKETING_UNSUBSCRIBE_SECRET: 'u'.repeat(40) };
    const dns = { 'send.news.example.test': [['v=spf1 include:amazonses.com ~all']], 'resend._domainkey.news.example.test': [['p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQ']], '_dmarc.news.example.test': [['v=DMARC1; p=reject']] };
    const deps = () => ({ store, mailbox, env, lock, sleep: async () => {}, origin: 'https://sti-hub.example.test', resolver: async (h) => dns[h] || [], esp: { fetch: async (url, init) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ id: `re-${calls.length}` }), text: async () => '' }; } } });
    await disp.enqueueCampaign(repo, deps(), { campaignId: 'cmp-2', templateId: template.id, contacts });
    const [a, b] = await Promise.all([disp.processMarketingQueue(repo, deps()), disp.processMarketingQueue(repo, deps())]);
    assert.equal(a.sent + b.sent, 2);
    assert.equal(calls.length, 2);
    const again = await disp.processMarketingQueue(repo, deps());
    assert.equal(again.sent, 0);
    const f = await disp.campaignFunnel(deps(), 'cmp-2');
    assert.equal(f.sent, 2);
    ok('ponta a ponta no Postgres: 2 execucoes concorrentes => 2 envios (1 por contato), reexecucao => 0, funil');
    for (const check of extraChecks) for (const m of await check({ pool: q, D, assert })) ok(m);
  } catch (err) {
    out.push(`FALHA ${err && err.stack || err}`);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
    await server.stop().catch(() => {});
    await db.close().catch(() => {});
    console.log(out.join('\n'));
  }
})();
