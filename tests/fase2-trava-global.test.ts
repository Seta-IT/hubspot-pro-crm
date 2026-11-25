// ============================================================================
// Trava global entre instancias (19/11/2026): lease com expiracao (Postgres em producao).
// Duas execucoes concorrentes do executor de cadencias, em "instancias" diferentes (repositorios
// separados com o mesmo estado), nunca enviam o mesmo passo duas vezes. Graph sempre mockado.
// ============================================================================
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createInMemoryRepository } from '../src/db/repository';
import { SequenceService } from '../src/modules/sequences/sequence-service';
import {
  MemoryLockStore,
  PostgresLockStore,
  LOCK_ACQUIRE_SQL,
  type DistributedLockStore,
} from '../src/db/distributed-lock';
import {
  SEQUENCE_RUN_LOCK_KEY,
  runSequenceScheduler,
  sequenceStepClaimKey,
  type ResolvedMailbox,
  type SequenceMailer,
  type SequenceMailSendInput,
} from '../src/modules/sequences/sequence-live-sender';

const SEQ = 'seq-seta-21d-prospeccao';
const CONTACT = 'cont-marina';
const OWNER = 'marcelo.mira@setatelecom.com.br';
const WED_14H = new Date('2026-11-18T17:00:00.000Z');

let savedFlag: string | undefined;
beforeEach(() => {
  savedFlag = process.env.SEQUENCES_LIVE_SEND;
  process.env.SEQUENCES_LIVE_SEND = 'true';
});
afterEach(() => {
  if (savedFlag === undefined) delete process.env.SEQUENCES_LIVE_SEND;
  else process.env.SEQUENCES_LIVE_SEND = savedFlag;
});

function sharedMailer(delayMs = 20) {
  const sends: SequenceMailSendInput[] = [];
  const mb: ResolvedMailbox = { ok: true, accountId: 'mbx-1', ownerEmail: OWNER, mailboxAddress: OWNER, displayName: 'Marcelo', accessToken: 'x' };
  const mailer: SequenceMailer = {
    async resolveMailbox() {
      await new Promise((r) => setTimeout(r, delayMs));
      return mb;
    },
    async send(input) {
      await new Promise((r) => setTimeout(r, delayMs));
      sends.push(input);
      return { messageId: `g-${sends.length}`, conversationId: `c-${sends.length}`, internetMessageId: null, trackingId: null };
    },
    async listInboxSince() {
      return [];
    },
  };
  return { mailer, sends };
}

/** "Instancia A" com uma inscricao vencida e "instancia B" com o MESMO estado (copia). */
function twoInstances() {
  const a = createInMemoryRepository();
  const svc = new SequenceService();
  const { enrollment } = svc.enrollContact(a, { sequenceId: SEQ, contactId: CONTACT, forceMoveFromConflicting: true, allowReentryOverride: true, enrolledByEmail: OWNER });
  const e = a.getSequenceEnrollmentById(enrollment.id)!;
  e.nextStepDueAt = new Date(WED_14H.getTime() - 60_000).toISOString();
  a.saveSequenceEnrollment(e);
  const b = createInMemoryRepository();
  b.loadState(structuredClone(a.getState()));
  return { a, b, id: enrollment.id };
}

describe('Trava global: contrato do lease', () => {
  it('memoria: so um dono por vez; expira; liberar exige ser o dono', async () => {
    let t = 1_000_000;
    const store = new MemoryLockStore(() => t);
    assert.equal(await store.acquire('k:1', 'A', 5000), true);
    assert.equal(await store.acquire('k:1', 'B', 5000), false);
    await store.release('k:1', 'B');
    assert.equal(await store.acquire('k:1', 'B', 5000), false, 'nao-dono nao libera');
    t += 6000;
    assert.equal(await store.acquire('k:1', 'B', 5000), true, 'expirada pode ser tomada');
    assert.equal((await store.peek('k:1'))!.owner, 'B');
    await store.release('k:1', 'B');
    assert.equal(await store.peek('k:1'), null);
    await assert.rejects(store.acquire("x'; drop table", 'A', 1000));
  });

  it('postgres: compare-and-set atomico em uma linha (INSERT ON CONFLICT ... WHERE expires_at < now())', async () => {
    assert.match(LOCK_ACQUIRE_SQL, /ON CONFLICT \(lock_key\) DO UPDATE/);
    assert.match(LOCK_ACQUIRE_SQL, /WHERE crm_distributed_locks\.expires_at < now\(\)/);
    assert.match(LOCK_ACQUIRE_SQL, /RETURNING owner/);
    const calls: Array<{ text: string; params?: unknown[] }> = [];
    let held = false;
    const db = {
      async query(text: string, params?: unknown[]) {
        calls.push({ text, params });
        if (text.startsWith('INSERT INTO crm_distributed_locks')) {
          if (held) return { rows: [] };
          held = true;
          return { rows: [{ owner: params![1] }] };
        }
        if (text.startsWith('DELETE')) {
          held = false;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [] };
      },
    };
    const store = new PostgresLockStore(db);
    assert.equal(await store.acquire('sequences:run', 'A', 60_000), true);
    assert.equal(await store.acquire('sequences:run', 'B', 60_000), false);
    await store.release('sequences:run', 'A');
    assert.equal(await store.acquire('sequences:run', 'B', 60_000), true);
    // Perf 25/11: o DDL so roda se o catalogo disser que falta (1a chamada = leitura do catalogo).
    assert.ok(calls[0].text.includes('to_regclass'));
    assert.ok((calls[0].params![0] as string[]).includes('crm_distributed_locks'));
    const ins = calls.find((c) => c.text.startsWith('INSERT'))!;
    assert.deepEqual(ins.params, ['sequences:run', 'A', 60000]);
  });
});

describe('Trava global: executor de cadencias em duas instancias', () => {
  it('duas execucoes concorrentes (instancias diferentes, mesmo estado) enviam o passo UMA vez', async () => {
    const { a, b } = twoInstances();
    const lock = new MemoryLockStore();
    const m = sharedMailer();
    const [ra, rb] = await Promise.all([
      runSequenceScheduler(a, { mailer: m.mailer, now: WED_14H, lock }),
      runSequenceScheduler(b, { mailer: m.mailer, now: WED_14H, lock }),
    ]);
    assert.equal(m.sends.length, 1, 'nunca duplica entre instancias');
    assert.equal(ra.sent + rb.sent, 1);
    assert.equal((ra.skippedReasons.RUN_LOCKED_ELSEWHERE || 0) + (rb.skippedReasons.RUN_LOCKED_ELSEWHERE || 0), 1);
    assert.equal(await lock.peek(SEQUENCE_RUN_LOCK_KEY), null, 'trava da execucao liberada ao final');
  });

  it('instancia com estado velho (passo ainda agendado) nao reenvia: a reserva do passo ja existe', async () => {
    const { a, b, id } = twoInstances();
    let clock = Date.now();
    const lock = new MemoryLockStore(() => clock);
    const m = sharedMailer(1);
    await runSequenceScheduler(a, { mailer: m.mailer, now: WED_14H, lock, lockClock: () => clock });
    assert.equal(m.sends.length, 1);
    assert.ok(await lock.peek(sequenceStepClaimKey(`${id}:1`)), 'reserva do envio mantida');
    // B roda depois com o estado de antes do envio.
    const rb = await runSequenceScheduler(b, { mailer: m.mailer, now: WED_14H, lock, lockClock: () => clock });
    assert.equal(m.sends.length, 1);
    assert.equal(rb.skippedReasons.CLAIMED_ELSEWHERE, 1);
    assert.equal(b.getSequenceEnrollmentById(id)!.stepDeliveries![0].status, 'SCHEDULED', 'nada mudou em B');
    // Horas depois, B ainda sem ver o envio: marca envio incerto e cria tarefa, sem reenviar.
    clock += 2 * 60 * 60 * 1000;
    const rb2 = await runSequenceScheduler(b, { mailer: m.mailer, now: WED_14H, lock, lockClock: () => clock });
    assert.equal(m.sends.length, 1);
    assert.equal(rb2.errors, 1);
    assert.equal(b.getSequenceEnrollmentById(id)!.stepDeliveries![0].reasonCode, 'SEND_UNCERTAIN');
  });

  it('recarrega o estado depois de obter a trava; falha ao recarregar => nao envia', async () => {
    const { a } = twoInstances();
    const lock = new MemoryLockStore();
    const m = sharedMailer(1);
    let reloads = 0;
    const r = await runSequenceScheduler(a, { mailer: m.mailer, now: WED_14H, lock, reloadState: async () => void reloads++ });
    assert.equal(reloads, 1);
    assert.equal(r.sent, 1);
    const { a: a2 } = twoInstances();
    const r2 = await runSequenceScheduler(a2, { mailer: m.mailer, now: WED_14H, lock, reloadState: async () => { throw new Error('pg fora'); } });
    assert.equal(r2.sent, 0);
    assert.equal(r2.skippedReasons.STATE_RELOAD_FAILED, 1);
  });

  it('banco da trava indisponivel => fail-closed (nenhum envio)', async () => {
    const { a } = twoInstances();
    const broken: DistributedLockStore = {
      async acquire() { throw new Error('pg fora'); },
      async release() {},
      async peek() { return null; },
    };
    const m = sharedMailer(1);
    const r = await runSequenceScheduler(a, { mailer: m.mailer, now: WED_14H, lock: broken });
    assert.equal(m.sends.length, 0);
    assert.equal(r.skippedReasons.RUN_LOCK_UNAVAILABLE, 1);
  });
});
