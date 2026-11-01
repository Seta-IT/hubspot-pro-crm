// ============================================================================
// Harness Neon Free: UMA "instancia serverless" do STI-hub num processo proprio (fork).
// Uso: fork(worker, [distRoot]) com env DATABASE_URL / CRM_STORE_PATH proprios.
// Mensagens: {id, op:'dispatch', req} | {id, op:'setPasswords', users:[{email,password}]}
//            | {id, op:'stats'} | {id, op:'exit'}
// distRoot permite rodar o MESMO harness contra o build antigo (origin/main) e o novo.
// ============================================================================
import path from 'node:path';

const distRoot = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { CrmApiRouter } = require(path.join(distRoot, 'src/api/router.js'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pgMod = require(path.join(distRoot, 'src/db/postgres.js'));

const router = new CrmApiRouter();

type Msg = { id: number; op: string; req?: unknown; users?: Array<{ email: string; password: string }> };

process.on('message', async (msg: Msg) => {
  const reply = (payload: unknown) => process.send?.({ id: msg.id, ...((payload as object) || {}) });
  try {
    if (msg.op === 'dispatch') {
      const res = await router.dispatch(msg.req);
      reply({ res });
    } else if (msg.op === 'setPasswords') {
      // Prepara senhas conhecidas (banco LOCAL de teste) e persiste pelo caminho normal de escrita.
      await router.dispatch({ method: 'GET', path: '/api/health', query: {} });
      const repo = router.getRepository();
      for (const u of msg.users || []) repo.upsertRbacUser({ email: u.email, password: u.password });
      if (router.pgSync) await router.pgSync.commit(repo);
      else await pgMod.syncStateToPostgres(repo.getState());
      reply({ ok: true });
    } else if (msg.op === 'digest') {
      // Digest do estado em memoria (chaves ordenadas) para comparar instancias.
      await router.dispatch({ method: 'GET', path: '/api/health', query: {} });
      const stable = (v: unknown): string => {
        if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
        if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
        const o = v as Record<string, unknown>;
        return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
      };
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const digest = require('node:crypto').createHash('sha256').update(stable(router.getRepository().getState())).digest('hex');
      reply({ digest });
    } else if (msg.op === 'stats') {
      reply({ stats: router.pgSync ? router.pgSync.stats : null });
    } else if (msg.op === 'exit') {
      await pgMod.closePostgresPool().catch(() => undefined);
      reply({ ok: true });
      setTimeout(() => process.exit(0), 10);
    }
  } catch (err) {
    reply({ error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
  }
});
process.send?.({ ready: true });
