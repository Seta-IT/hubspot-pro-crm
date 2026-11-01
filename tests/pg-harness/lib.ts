// Harness Neon Free: proxy TCP que conta os bytes vindos do Postgres + instancias em processos.
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fork, ChildProcess } from 'node:child_process';

export interface ByteProxy {
  port: number;
  /** bytes Postgres -> app (o que o Neon cobra como egress) */
  fromDb(): number;
  /** bytes app -> Postgres */
  toDb(): number;
  reset(): void;
  close(): Promise<void>;
}

export function startByteProxy(upstreamHost: string, upstreamPort: number): Promise<ByteProxy> {
  let down = 0;
  let up = 0;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    const upstream = net.connect(upstreamPort, upstreamHost);
    sockets.add(client);
    sockets.add(upstream);
    client.on('data', (d) => { up += d.length; upstream.write(d); });
    upstream.on('data', (d) => { down += d.length; client.write(d); });
    const end = () => { client.destroy(); upstream.destroy(); sockets.delete(client); sockets.delete(upstream); };
    client.on('close', end); upstream.on('close', end);
    client.on('error', end); upstream.on('error', end);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({
        port,
        fromDb: () => down,
        toDb: () => up,
        reset: () => { down = 0; up = 0; },
        close: () => new Promise<void>((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
      });
    });
  });
}

export interface Instance {
  call<T = Record<string, unknown>>(op: string, payload?: Record<string, unknown>): Promise<T>;
  dispatch(req: Record<string, unknown>): Promise<{ status: number; body: unknown; headers?: Record<string, string> }>;
  stop(): Promise<void>;
  child: ChildProcess;
}

export function startInstance(opts: { distRoot: string; databaseUrl: string; env?: Record<string, string> }): Promise<Instance> {
  const worker = path.join(__dirname, 'instance-worker.js');
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stihub-inst-'));
  const child = fork(worker, [opts.distRoot], {
    execArgv: [],
    cwd: storeDir,
    env: {
      ...process.env,
      // --import=./dist/... relativo ao cwd do teste: torna absoluto (o worker roda em outro cwd).
      NODE_OPTIONS: String(process.env.NODE_OPTIONS || '').replace(/--import=\.\//g, `--import=${process.cwd()}/`),
      DATABASE_URL: opts.databaseUrl,
      DATABASE_POSTGRES_URL: '',
      CRM_STORE_PATH: path.join(storeDir, 'crm-store.json'),
      VERCEL: '',
      VERCEL_ENV: '',
      GESTAOCLICK_ACCESS_TOKEN: '',
      ...(opts.env || {}),
    },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const errLog: string[] = [];
  child.stderr?.on('data', (d: Buffer) => { errLog.push(d.toString()); if (errLog.length > 50) errLog.shift(); });
  child.once('exit', (code) => { if (code && process.env.STIHUB_HARNESS_DEBUG) console.error(`[worker exit ${code}]`, errLog.join('')); });
  let seq = 0;
  const pending = new Map<number, (v: Record<string, unknown>) => void>();
  child.on('message', (m: Record<string, unknown>) => {
    const id = m.id as number | undefined;
    if (id !== undefined && pending.has(id)) {
      pending.get(id)!(m);
      pending.delete(id);
    }
  });
  const call = <T,>(op: string, payload: Record<string, unknown> = {}) =>
    new Promise<T>((resolve, reject) => {
      const id = ++seq;
      pending.set(id, (m) => (m.error ? reject(new Error(String(m.error))) : resolve(m as T)));
      child.send({ id, op, ...payload });
    });
  return new Promise((resolve, reject) => {
    child.once('message', (m: Record<string, unknown>) => {
      if (!m.ready) return reject(new Error('worker nao iniciou'));
      resolve({
        child,
        call,
        dispatch: async (req) => ((await call<{ res: { status: number; body: unknown; headers?: Record<string, string> } }>('dispatch', { req })).res),
        stop: async () => {
          await call('exit').catch(() => undefined);
          child.kill();
          fs.rmSync(storeDir, { recursive: true, force: true });
        },
      });
    });
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`worker saiu antes de ficar pronto (codigo ${code})`)));
  });
}

export function sessionFromSetCookie(headers?: Record<string, string>): string {
  const m = String(headers?.['Set-Cookie'] || '').match(/stihub_session=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : '';
}

/** Evita cruzar a borda da janela TOTP de 30 s no meio de um login. */
export async function safeTotpWindow(): Promise<void> {
  const rem = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (rem < 5) await new Promise((r) => setTimeout(r, rem * 1000 + 400));
}
