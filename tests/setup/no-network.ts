// ============================================================================
// STI-hub — setup global dos testes (carregado via NODE_OPTIONS=--import em CADA processo
// do node --test). Garante que a suite NUNCA chama a Resend de verdade:
//  1. NODE_ENV=test e remocao de RESEND_API_KEY / RESEND_ADMIN_API_KEY do ambiente;
//  2. fetch global com guarda: chamada a api.resend.com que nao foi mockada pelo proprio
//     teste e BLOQUEADA (sem rede) e registrada em arquivo; o pos-check da suite falha se
//     houver qualquer registro (tests/setup/assert-no-resend.ts).
//  3. brasilapi.com.br / receitaws.com.br / publica.cnpj.ws: mock local 404 (sem rede).
//  4. Pacote F: DENY-BY-DEFAULT para fetch — so 127.0.0.1/localhost/::1 passam; o resto recebe
//     503 bloqueado e e registrado em /tmp/stihub-test-net-blocked.log.
//  5. Pacote G: em NODE_ENV=test tambem bloqueia, abaixo do fetch, toda conexao de saida
//     net/tls/http/https (monkeypatch de net.Socket.prototype.connect, por onde passam
//     net.connect, tls.connect, http(s).request, pg e nodemailer) e o DNS (dns.lookup,
//     dns.resolve*, dns.promises.*) para hosts que nao sejam loopback. Socket unix (path) passa.
//  6. Pacote H: lookup customizado em net.connect/createConnection (o endereco RESOLVIDO tambem
//     precisa ser loopback; checado no callback do lookup e de novo no 'connect' do socket),
//     dgram (send/connect) e todos os dns.resolve*, reverse e lookupService (callback e promises).
// ============================================================================
import fs from 'node:fs';
import net from 'node:net';
import dns from 'node:dns';
import dgram from 'node:dgram';

export const CNPJ_HOSTS = ['brasilapi.com.br', 'receitaws.com.br', 'publica.cnpj.ws'];
export const CNPJ_ATTEMPTS_FILE = process.env.STI_HUB_TEST_CNPJ_LOG || '/tmp/stihub-test-cnpj-mocked.log';
export const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1', '[::1]'];
export const NET_BLOCKED_FILE = process.env.STI_HUB_TEST_NET_LOG || '/tmp/stihub-test-net-blocked.log';
export const RESEND_ATTEMPTS_FILE = process.env.STI_HUB_TEST_RESEND_LOG || '/tmp/stihub-test-resend-attempts.log';

(process.env as Record<string, string>).NODE_ENV = 'test';
delete process.env.RESEND_API_KEY;
delete process.env.RESEND_ADMIN_API_KEY;

const realFetch = globalThis.fetch;
const guardedFetch = (async (input: unknown, init?: unknown) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String((input as { url?: string })?.url || '');
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = '';
  }
  if (host === 'api.resend.com' || host.endsWith('.resend.com')) {
    const hdrs = (init as { headers?: Record<string, string> } | undefined)?.headers || {};
    const selfTest = hdrs['x-stihub-guard-selftest'] === '1';
    if (!selfTest) try {
      fs.appendFileSync(RESEND_ATTEMPTS_FILE, `${new Date().toISOString()} ${process.argv[1] || ''} ${host}\n`);
    } catch {
      // registro opcional
    }
    return new Response(JSON.stringify({ message: 'Bloqueado no ambiente de testes (sem rede real).', name: 'test_network_blocked' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }
  // HOTFIX 29/10 (menor b): APIs publicas de CNPJ (cnpj-lookup-service.ts) NUNCA vao a rede
  // nos testes. Mock deterministico 404 => o servico cai no cadastro local/fallback.
  if (CNPJ_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    try {
      fs.appendFileSync(CNPJ_ATTEMPTS_FILE, `${new Date().toISOString()} ${process.argv[1] || ''} ${host}\n`);
    } catch {
      // registro opcional
    }
    return new Response(JSON.stringify({ message: 'CNPJ mockado no ambiente de testes (sem rede real).', name: 'test_network_mocked' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }
  // Pacote F: DENY-BY-DEFAULT. So loopback (127.0.0.1 / localhost / ::1) vai a rede real;
  // qualquer outro host e bloqueado (503) e registrado em NET_BLOCKED_FILE.
  if (LOOPBACK_HOSTS.includes(host)) {
    return realFetch(input as Parameters<typeof fetch>[0], init as Parameters<typeof fetch>[1]);
  }
  try {
    fs.appendFileSync(NET_BLOCKED_FILE, `${new Date().toISOString()} ${process.argv[1] || ''} ${host || '(url invalida)'}\n`);
  } catch {
    // registro opcional
  }
  return new Response(JSON.stringify({ message: 'Rede externa bloqueada no ambiente de testes (deny-by-default).', name: 'test_network_blocked' }), {
    status: 503,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;
(guardedFetch as unknown as { __stihubResendGuard: boolean }).__stihubResendGuard = true;
globalThis.fetch = guardedFetch;

// ============================================================================
// Pacote G: bloqueio de socket/DNS (deny-by-default abaixo do fetch).
// ============================================================================
export function isLoopbackHost(h: unknown): boolean {
  const host = String(h ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true; // net sem host => localhost
  return host === 'localhost' || host === '::1' || host === '::ffff:127.0.0.1' || /^127\.\d+\.\d+\.\d+$/.test(host);
}

function logBlocked(kind: string, host: string): void {
  try {
    fs.appendFileSync(NET_BLOCKED_FILE, `${new Date().toISOString()} ${process.argv[1] || ''} ${host || '(sem host)'} [${kind}]\n`);
  } catch {
    // registro opcional
  }
}

function blockedError(kind: string, host: string): NodeJS.ErrnoException {
  const err = new Error(`test_network_blocked: ${kind} para ${host} bloqueado no ambiente de testes (deny-by-default).`) as NodeJS.ErrnoException;
  err.code = 'ECONNREFUSED';
  (err as { name: string }).name = 'test_network_blocked';
  return err;
}

if (process.env.NODE_ENV === 'test') {
  const realConnect = net.Socket.prototype.connect;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (net.Socket.prototype as any).connect = function guardedConnect(this: net.Socket, ...args: any[]) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0]; // normalizeArgs interno do node
    let host: unknown;
    let isPath = false;
    if (first && typeof first === 'object') {
      isPath = typeof first.path === 'string' && first.path !== '';
      host = first.host ?? first.hostname;
    } else if (typeof first === 'string' && !/^\d+$/.test(first)) {
      isPath = true; // connect(path)
    } else {
      host = typeof args[1] === 'string' ? args[1] : undefined;
    }
    if (!isPath && !isLoopbackHost(host)) {
      const h = String(host);
      logBlocked('socket', h);
      const err = blockedError('conexao', h);
      process.nextTick(() => this.destroy(err));
      return this;
    }
    if (!isPath) {
      // Pacote H: lookup customizado pode resolver "localhost" para um IP externo.
      if (first && typeof first === 'object' && typeof first.lookup === 'function') {
        const userLookup = first.lookup;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        first.lookup = (hn: string, opts: any, cb: any) => {
          const done = typeof opts === 'function' ? opts : cb;
          const o = typeof opts === 'function' ? {} : opts;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          userLookup(hn, o, (e: any, addr: any, fam: any) => {
            if (e) return done(e);
            const list = Array.isArray(addr) ? addr.map((a) => a?.address) : [addr];
            const bad = list.find((a) => !isLoopbackHost(a));
            if (bad !== undefined) {
              logBlocked('socket.lookup', `${hn}->${bad}`);
              return done(blockedError('conexao (lookup customizado)', `${hn}->${bad}`));
            }
            return done(null, addr, fam);
          });
        };
      }
      // Defesa extra: endereco remoto efetivo precisa ser loopback.
      this.once('connect', () => {
        const ra = this.remoteAddress;
        if (ra && !isLoopbackHost(ra)) {
          logBlocked('socket.remote', ra);
          this.destroy(blockedError('conexao (endereco remoto)', ra));
        }
      });
    }
    return realConnect.apply(this, args as Parameters<typeof realConnect>);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrapCb = (name: string, real: (...a: any[]) => any) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function guardedDns(this: unknown, hostname: unknown, ...rest: any[]) {
      if (isLoopbackHost(hostname)) return real.call(this, hostname, ...rest);
      logBlocked(`dns.${name}`, String(hostname));
      const cb = rest.reverse().find((x) => typeof x === 'function');
      const err = blockedError(`dns.${name}`, String(hostname));
      err.code = 'ENOTFOUND';
      if (cb) process.nextTick(() => cb(err));
      return undefined;
    };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrapPromise = (name: string, real: (...a: any[]) => Promise<any>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function guardedDnsP(this: unknown, hostname: unknown, ...rest: any[]) {
      if (isLoopbackHost(hostname)) return real.call(this, hostname, ...rest);
      logBlocked(`dns.promises.${name}`, String(hostname));
      const err = blockedError(`dns.promises.${name}`, String(hostname));
      err.code = 'ENOTFOUND';
      throw err;
    };
  const DNS_FNS = [
    'lookup', 'lookupService', 'reverse',
    'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr',
    'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTlsa', 'resolveTxt',
  ] as const;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = dns as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dp = dns.promises as any;
  for (const fn of DNS_FNS) {
    if (typeof d[fn] === 'function') d[fn] = wrapCb(fn, d[fn]);
    if (typeof dp[fn] === 'function') dp[fn] = wrapPromise(fn, dp[fn]);
  }
  // Resolver de instancia (new dns.Resolver()) tambem nao sai.
  for (const R of [d.Resolver, dp.Resolver]) {
    if (!R?.prototype) continue;
    for (const fn of DNS_FNS) {
      if (typeof R.prototype[fn] === 'function') {
        R.prototype[fn] = R === d.Resolver ? wrapCb(fn, R.prototype[fn]) : wrapPromise(fn, R.prototype[fn]);
      }
    }
  }
}

// Pacote H: UDP (dgram) so para loopback.
if (process.env.NODE_ENV === 'test') {
  const proto = dgram.Socket.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const realSend = proto.send;
  proto.send = function guardedSend(this: dgram.Socket, ...args: unknown[]) {
    // send(msg, [offset, length,] port, [address], [cb]): address = 1a string apos msg
    const addr = args.slice(1).find((a) => typeof a === 'string') as string | undefined;
    if (addr !== undefined && !isLoopbackHost(addr)) {
      logBlocked('dgram.send', addr);
      const cb = args.reverse().find((a) => typeof a === 'function') as ((e: Error) => void) | undefined;
      const err = blockedError('dgram.send', addr);
      if (cb) process.nextTick(() => cb(err));
      else process.nextTick(() => this.emit('error', err));
      return undefined;
    }
    return realSend.apply(this, args);
  };
  const realDConnect = proto.connect;
  if (typeof realDConnect === 'function') {
    proto.connect = function guardedDConnect(this: dgram.Socket, ...args: unknown[]) {
      const addr = typeof args[1] === 'string' ? (args[1] as string) : undefined;
      if (addr !== undefined && !isLoopbackHost(addr)) {
        logBlocked('dgram.connect', addr);
        const err = blockedError('dgram.connect', addr);
        process.nextTick(() => this.emit('error', err));
        return undefined;
      }
      return realDConnect.apply(this, args);
    };
  }
}
