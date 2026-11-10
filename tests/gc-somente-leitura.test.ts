// ============================================================================
// GestaoClick somente leitura: a sinc e so na direcao GC > STI-hub.
// POST, PUT, PATCH e DELETE no cliente HTTP do GC sao recusados sem rede.
// GET e o sync (leitura + gravacao no STI-hub) continuam funcionando.
// ============================================================================
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GestaoClickReadOnlyError,
  GESTAOCLICK_READ_ONLY_CODE,
  assertGestaoClickReadOnlyMethod,
  gestaoClickFetch,
} from '../src/modules/erp/gestaoclick-http';
import {
  fetchLiveGestaoClickSnapshot,
  lookupEntityByCnpjInGestaoClick,
  probeGestaoClickMcp,
  setRuntimeGestaoClickCredentials,
} from '../src/modules/erp/gestaoclick-client';

const root = process.cwd();
const src = (p: string) => readFileSync(join(root, p), 'utf8');

const creds = {
  accessToken: 'test-access-token',
  secretAccessToken: 'test-secret-access-token',
  apiBaseUrl: 'https://api.gestaoclick.com/api',
  mcpServerUrl: 'https://api.gestaoclick.com/v1/mcp',
};

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

function installFetchMock(handler: (url: string, method: string) => Response | Promise<Response>) {
  const calls: Array<{ url: string; method: string }> = [];
  const prev = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { method?: string }) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input instanceof Request
            ? input.url
            : String((input as { url?: string })?.url || input);
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET') || 'GET').toUpperCase();
    calls.push({ url, method });
    return handler(url, method);
  }) as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = prev;
    },
  };
}

function gcListResponse(data: Array<Record<string, unknown>> = []): Response {
  return new Response(JSON.stringify({ data, meta: { total_registros: data.length, total_paginas: 1 } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Trava somente-GET do cliente HTTP do GestaoClick', () => {
  it('assertGestaoClickReadOnlyMethod recusa POST, PUT, PATCH e DELETE com codigo explicito', () => {
    for (const method of WRITE_METHODS) {
      assert.throws(
        () => assertGestaoClickReadOnlyMethod(method),
        (err: unknown) => {
          assert.ok(err instanceof GestaoClickReadOnlyError);
          assert.equal(err.code, GESTAOCLICK_READ_ONLY_CODE);
          assert.equal(err.method, method);
          assert.match(err.message, /somente leitura/);
          assert.match(err.message, new RegExp(method));
          assert.match(err.message, /nenhuma chamada de rede foi feita/);
          return true;
        }
      );
    }
  });

  it('assertGestaoClickReadOnlyMethod aceita GET (e o padrao vazio)', () => {
    assert.doesNotThrow(() => assertGestaoClickReadOnlyMethod('GET'));
    assert.doesNotThrow(() => assertGestaoClickReadOnlyMethod('get'));
    assert.doesNotThrow(() => assertGestaoClickReadOnlyMethod(undefined));
  });

  it('gestaoClickFetch recusa POST, PUT, PATCH e DELETE sem chamar a rede', async () => {
    const mock = installFetchMock(() => {
      throw new Error('rede nao deveria ter sido chamada');
    });
    try {
      for (const method of WRITE_METHODS) {
        await assert.rejects(
          () => gestaoClickFetch('https://api.gestaoclick.com/api/clientes', { method }),
          (err: unknown) => {
            assert.ok(err instanceof GestaoClickReadOnlyError);
            assert.equal(err.method, method);
            return true;
          }
        );
      }
      assert.equal(mock.calls.length, 0, 'nenhuma chamada de rede nos metodos de escrita');
    } finally {
      mock.restore();
    }
  });

  it('gestaoClickFetch recusa Request com metodo POST sem chamar a rede', async () => {
    const mock = installFetchMock(() => {
      throw new Error('rede nao deveria ter sido chamada');
    });
    try {
      await assert.rejects(
        () => gestaoClickFetch(new Request('https://api.gestaoclick.com/v1/mcp', { method: 'POST' })),
        GestaoClickReadOnlyError
      );
      assert.equal(mock.calls.length, 0);
    } finally {
      mock.restore();
    }
  });

  it('gestaoClickFetch aceita GET e dispara a rede so com GET', async () => {
    const mock = installFetchMock(() => gcListResponse([{ id: '1' }]));
    try {
      const res = await gestaoClickFetch('https://api.gestaoclick.com/api/lojas', { method: 'GET' });
      assert.equal(res.ok, true);
      const json = (await res.json()) as { data: Array<{ id: string }> };
      assert.equal(json.data[0].id, '1');
      assert.equal(mock.calls.length, 1);
      assert.equal(mock.calls[0].method, 'GET');
      assert.match(mock.calls[0].url, /\/lojas$/);
    } finally {
      mock.restore();
    }
  });
});

describe('Probe MCP e sync: sem escrita no GestaoClick', () => {
  let mock: ReturnType<typeof installFetchMock> | null = null;

  afterEach(() => {
    mock?.restore();
    mock = null;
  });

  it('probeGestaoClickMcp nao faz chamada de rede e nao marca o MCP como online', async () => {
    mock = installFetchMock(() => {
      throw new Error('probe nao deveria chamar a rede');
    });
    const result = await probeGestaoClickMcp(creds);
    assert.equal(result.online, false);
    assert.equal(result.serverInfo, undefined);
    assert.equal(mock.calls.length, 0);
  });

  it('lookupEntityByCnpjInGestaoClick so usa GET e devolve o cadastro do GC', async () => {
    const cnpj = '14806925000132';
    mock = installFetchMock((url, method) => {
      assert.equal(method, 'GET', `metodo inesperado no lookup: ${method} ${url}`);
      if (url.includes('/clientes')) {
        return gcListResponse([
          {
            id: 'gc-cli-1',
            razao_social: 'SETA TELECOM LTDA',
            nome: 'Seta Telecom',
            cnpj,
            ativo: '1',
            enderecos: [],
            contatos: [],
          },
        ]);
      }
      return gcListResponse([]);
    });
    const found = await lookupEntityByCnpjInGestaoClick(cnpj, creds);
    assert.ok(found);
    assert.equal(found?.entityType, 'CLIENTE');
    assert.equal(found?.razaoSocial, 'SETA TELECOM LTDA');
    assert.equal(found?.cnpjDigits, cnpj);
    assert.ok(mock.calls.length >= 1);
    assert.ok(mock.calls.every((c) => c.method === 'GET'));
    assert.ok(mock.calls.every((c) => !c.url.includes('/v1/mcp')));
  });

  it('fetchLiveGestaoClickSnapshot (sync) so usa GET e continua mapeando o GC', async () => {
    mock = installFetchMock((url, method) => {
      assert.equal(method, 'GET', `metodo inesperado no sync: ${method} ${url}`);
      if (url.includes('/lojas')) {
        return gcListResponse([{ id: '118887', nome: 'Matriz' }]);
      }
      if (url.includes('/usuarios')) {
        return gcListResponse([{ id: 'u1', nome: 'Operador' }]);
      }
      return gcListResponse([]);
    });
    setRuntimeGestaoClickCredentials(creds);
    const snapshot = await fetchLiveGestaoClickSnapshot({ forceRefresh: true, credentials: creds });
    assert.ok(snapshot);
    assert.equal(snapshot?.liveConnected, true);
    assert.equal(snapshot?.store.id, '118887');
    assert.equal(snapshot?.store.nome, 'Matriz');
    assert.equal(snapshot?.mcpStatus, 'ONLINE');
    assert.ok(mock.calls.length >= 2);
    assert.ok(mock.calls.every((c) => c.method === 'GET'));
    assert.ok(
      mock.calls.every((c) => !c.url.includes('/v1/mcp')),
      'sync nao deve mais chamar o MCP'
    );
  });
});

describe('Auditoria de fontes: nenhum ponto de escrita no GC permanece ativo', () => {
  it('o cliente HTTP do GC nao usa POST, PUT, PATCH ou DELETE', () => {
    const client = src('src/modules/erp/gestaoclick-client.ts');
    const http = src('src/modules/erp/gestaoclick-http.ts');
    assert.match(http, /gestaoClickFetch/);
    assert.match(client, /gestaoClickFetch/);
    assert.doesNotMatch(client, /method:\s*['"]POST['"]/);
    assert.doesNotMatch(client, /method:\s*['"]PUT['"]/);
    assert.doesNotMatch(client, /method:\s*['"]PATCH['"]/);
    assert.doesNotMatch(client, /method:\s*['"]DELETE['"]/);
    assert.match(client, /somente GC > STI-hub/);
  });

  it('o script de migracao de cadastros so faz GET na API do GC', () => {
    const script = src('scripts/gc-migrate-cadastros.ts');
    assert.match(script, /assertGcGetOnly/);
    assert.match(script, /const method = 'GET'/);
    assert.doesNotMatch(script, /method:\s*['"]POST['"]/);
    assert.doesNotMatch(script, /method:\s*['"]PUT['"]/);
    assert.doesNotMatch(script, /method:\s*['"]PATCH['"]/);
    assert.doesNotMatch(script, /method:\s*['"]DELETE['"]/);
  });

  it('nao ha cron, rota ou botao que chame a API do GC com metodo de escrita', () => {
    const vercel = src('vercel.json');
    assert.match(vercel, /\/api\/erp\/daily-sync/);
    const router = src('src/api/router.ts');
    assert.match(router, /\/api\/erp\/gestaoclick\/sync/);
    assert.match(router, /syncLiveGestaoClick/);
    const tab = src('src/app/components/ErpGestaoClickTab.tsx');
    assert.match(tab, /fetch\('\/api\/erp\/gestaoclick\/sync', \{ method: 'POST' \}\)/);
    const combined = [router, tab, src('src/modules/erp/daily-sync-service.ts')].join('\n');
    assert.doesNotMatch(combined, /api\.gestaoclick\.com[^'"\n]*method:\s*['"]POST['"]/);
  });
});
