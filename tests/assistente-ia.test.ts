// ============================================================================
// STI-hub — Assistente de IA interno (etapa 1): ferramentas, confirmacao e permissoes.
// Sem rede: o modelo e um duble; as rotas sao o CrmApiRouter em memoria com sessao assinada.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';
import { resolveStiHubSigningSecret, signStiHubSessionToken } from '../src/app/lib/auth';
import { ASSISTENTE_TOOLS, getTool, toolDefinitionsFor, type ApiCaller, type ApiCallRequest, type AssistenteUser } from '../src/modules/assistente/tools';
import { handleChat, handleExecute, redactSecrets, type AssistenteAuditEntry, type AssistenteDeps } from '../src/modules/assistente/service';
import { sessionBinding, signActionToken, signAuditReceipt, verifyActionToken } from '../src/modules/assistente/confirmation';
import { createSessionApiCaller, isAllowedAssistenteRoute } from '../src/modules/assistente/api-caller';
import { createOmniRouteClient, LlmError, type LlmClient, type LlmResult } from '../src/modules/assistente/omniroute-client';
import { readAssistenteConfig } from '../src/modules/assistente/config';

const SECRET = 'segredo-de-teste-assistente-0123456789abcdef';
const ALL: AssistenteUser = { uid: 'usr-ana', email: 'ana@seta.test', name: 'Ana', roleId: 'SUPER_ADMIN', moduleAccess: { crm: true, erp: true, chamados: true } };
const CRM_ONLY: AssistenteUser = { ...ALL, uid: 'usr-bia', moduleAccess: { crm: true, erp: false, chamados: false } };

function fakeApi(routes: Record<string, (r: ApiCallRequest) => { status: number; body: any }>) {
  const calls: ApiCallRequest[] = [];
  const api: ApiCaller = async (r) => {
    calls.push(r);
    const key = `${r.method} ${r.path.split('?')[0]}`;
    const h = routes[key];
    return h ? h(r) : { status: 404, body: { error: 'nao encontrado' } };
  };
  return { api, calls };
}

const CONTRATOS = [
  { id: 'c1', contractNumber: 'LOC-1', companyName: 'Alfa Ltda', status: 'ATIVO', monthlyValue: 1000, startDate: '2026-01-10' },
  { id: 'c2', contractNumber: 'LOC-2', companyName: 'Beta SA', status: 'ENCERRADO', monthlyValue: 500, startDate: '2025-05-01' },
  { id: 'c3', contractNumber: 'LOC-3', companyName: 'Alfa Ltda', status: 'EM_IMPLANTACAO', monthlyValue: 250, startDate: '2026-03-02' },
];
const COMPANIES = [
  { id: 'co-1', name: 'Alfa Ltda', cnpj: '11.222.333/0001-81' },
  { id: 'co-2', name: 'Alfa Distribuidora', cnpj: '' },
];

function fakeLlm(result: Partial<LlmResult> | Error): LlmClient & { calls: any[] } {
  const calls: any[] = [];
  return {
    calls,
    async complete(messages, tools) {
      calls.push({ messages, tools });
      if (result instanceof Error) throw result;
      return { text: '', toolCalls: [], model: 'teste', ...result };
    },
  };
}

function deps(over: Partial<AssistenteDeps> = {}): AssistenteDeps & { audits: AssistenteAuditEntry[] } {
  const audits: AssistenteAuditEntry[] = [];
  const nonces = new Set<string>();
  const hits = new Map<string, number>();
  return {
    llm: fakeLlm({ text: 'Olá' }),
    api: fakeApi({}).api,
    user: ALL,
    secret: SECRET,
    sid: 'sessao-1',
    now: () => Date.now(),
    async rateLimit(bucket, limit) {
      const n = (hits.get(bucket) || 0) + 1;
      hits.set(bucket, n);
      return n <= limit;
    },
    async consumeNonce(n) {
      if (nonces.has(n)) return false;
      nonces.add(n);
      return true;
    },
    async audit(e) {
      audits.push(e);
    },
    audits,
    ...over,
  } as AssistenteDeps & { audits: AssistenteAuditEntry[] };
}

// ---------------------------------------------------------------------------
describe('assistente — ferramentas', () => {
  it('consultar filtra por situação, busca e período e ordena pelos mais recentes', async () => {
    const { api } = fakeApi({ 'GET /api/erp/contracts': () => ({ status: 200, body: { data: CONTRATOS } }) });
    const t = getTool('consultar')!;
    const r = await t.executar({ entidade: 'contratos', busca: 'alfa', de: '2026-01-01' }, api);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.tabela?.linhas.length, 2);
    assert.equal(r.tabela?.linhas[0][0], 'LOC-3');
    assert.doesNotMatch(r.resumoParaModelo, /Alfa|LOC-/, 'o resumo ao modelo nao leva dados');
    const s = await t.executar({ entidade: 'contratos', status: 'em implantacao' }, api);
    assert.equal(s.ok && s.tabela?.linhas.length, 1);
  });

  it('relatorio soma valores por situação', async () => {
    const { api } = fakeApi({ 'GET /api/erp/contracts': () => ({ status: 200, body: { data: CONTRATOS } }) });
    const r = await getTool('relatorio')!.executar({ entidade: 'contratos' }, api);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.totais?.[0].valor, '3');
    assert.match(r.totais?.[1].valor || '', /1\.750,00/);
  });

  it('vendas e OS vêm do overview do ERP', async () => {
    const { api, calls } = fakeApi({
      'GET /api/erp/overview': () => ({ status: 200, body: { data: { salesOrders: [{ code: 'V1', companyName: 'X', status: 'Concluída', totalAmount: 10, date: '2026-11-01' }], serviceOrders: [] } } }),
    });
    const r = await getTool('relatorio')!.executar({ entidade: 'vendas', agrupar_por: 'mes' }, api);
    assert.equal(r.ok && r.tabela?.linhas[0][0], '2026-11');
    assert.equal(calls[0].path, '/api/erp/overview');
  });

  it('erro 403 da rota vira mensagem de permissão negada', async () => {
    const { api } = fakeApi({ 'GET /api/erp/invoices': () => ({ status: 403, body: { error: 'sem alçada' } }) });
    const r = await getTool('consultar')!.executar({ entidade: 'faturas' }, api);
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.mensagem : '', /Permissão negada/);
  });

  it('rascunho de proposta: resolve a empresa e grava como RASCUNHO, sem enviar', async () => {
    const { api, calls } = fakeApi({
      'GET /api/companies': () => ({ status: 200, body: { data: COMPANIES } }),
      'POST /api/erp/proposals': (r) => ({ status: 201, body: { data: { id: 'prop-1', code: '1001', ...r.body } } }),
    });
    const args = { cliente: 'alfa ltda', titulo: 'Locação de PABX', itens: [{ descricao: 'PABX', quantidade: 2, valor_unitario: 300, tipo: 'locacao' as const }] };
    const r = await getTool('criar_rascunho_proposta')!.executar(args, api);
    assert.equal(r.ok, true);
    const post = calls.find((c) => c.method === 'POST')!;
    assert.equal(post.body?.status, 'RASCUNHO');
    assert.equal(post.body?.companyId, 'co-1');
    assert.equal((post.body?.items as any[])[0].unitPrice, 300);
    assert.equal(calls.some((c) => /send|email|approve/.test(c.path)), false);
  });

  it('rascunho de proposta: empresa ambígua não grava nada', async () => {
    const { api, calls } = fakeApi({ 'GET /api/companies': () => ({ status: 200, body: { data: COMPANIES } }) });
    const r = await getTool('criar_rascunho_proposta')!.executar({ cliente: 'Alfa', titulo: 'T', itens: [{ descricao: 'x', quantidade: 1, valor_unitario: 1 }] }, api);
    assert.equal(r.ok, false);
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
  });

  it('abrir chamado mapeia prioridade e categoria do Service Desk', async () => {
    const { api, calls } = fakeApi({ 'POST /api/tickets': () => ({ status: 201, body: { data: { id: 't1', key: 'TEC-9' } } }) });
    const r = await getTool('abrir_chamado')!.executar({ assunto: 'Sem internet', prioridade: 'alta', categoria: 'incidente' }, api);
    assert.equal(r.ok, true);
    assert.equal(calls[0].body?.priority, 'HIGH');
    assert.equal(calls[0].body?.category, 'INCIDENT');
  });

  it('abrir OS gera código seguinte e id novo, nunca sobrescreve OS existente', async () => {
    const { api, calls } = fakeApi({
      'GET /api/companies': () => ({ status: 200, body: { data: [COMPANIES[0]] } }),
      'GET /api/erp/overview': () => ({ status: 200, body: { data: { serviceOrders: [{ id: 'os-a', code: '1600' }] } } }),
      'POST /api/erp/service-orders': (r) => ({ status: 200, body: { data: r.body } }),
    });
    const r = await getTool('abrir_os')!.executar({ cliente: 'Alfa Ltda', descricao: 'Troca de equipamento' }, api);
    assert.equal(r.ok, true);
    const post = calls.find((c) => c.method === 'POST')!;
    assert.equal(post.body?.code, '1601');
    assert.notEqual(post.body?.id, 'os-a');
    assert.equal(post.body?.status, 'Em aberto');
  });

  it('schemas recusam campos desconhecidos e valores fora do limite', () => {
    assert.equal(getTool('consultar')!.schema.safeParse({ entidade: 'contratos', limite: 500 }).success, false);
    assert.equal(getTool('abrir_chamado')!.schema.safeParse({ assunto: 'x', id: 'TEC-1' }).success, false);
    assert.equal(getTool('consultar')!.schema.safeParse({ entidade: 'usuarios' }).success, false);
  });

  it('etapa 1 não tem nota fiscal, recibo nem envio a clientes', () => {
    const names = ASSISTENTE_TOOLS.map((t) => t.name).join(' ');
    assert.doesNotMatch(names, /nota|nfe|nfse|recibo|enviar|email|whatsapp|excluir|delete/i);
  });
});

// ---------------------------------------------------------------------------
describe('assistente — fluxo de confirmação', () => {
  it('chat só propõe: nenhuma rota é chamada antes do Confirmar', async () => {
    const { api, calls } = fakeApi({});
    const llm = fakeLlm({ toolCalls: [{ name: 'consultar', args: { entidade: 'contratos', status: 'ATIVO', busca: null } as any }] });
    const d = deps({ api, llm });
    const r = await handleChat({ mensagens: [{ papel: 'usuario', texto: 'contratos ativos?' }] }, d);
    assert.equal(r.status, 200);
    assert.equal(r.body.tipo, 'proposta');
    const p = r.body.proposta as any;
    assert.equal(p.acao, 'leitura');
    assert.ok(p.token);
    assert.equal(calls.length, 0);
    assert.equal(d.audits.length, 0);
  });

  it('Cancelar não executa nem audita; Confirmar executa uma vez e audita', async () => {
    const { api, calls } = fakeApi({ 'POST /api/tickets': () => ({ status: 201, body: { data: { id: 't1', key: 'TEC-1' } } }) });
    const llm = fakeLlm({ toolCalls: [{ name: 'abrir_chamado', args: { assunto: 'Impressora parada' } }] });
    const d = deps({ api, llm });
    const chat = await handleChat({ mensagens: [{ papel: 'usuario', texto: 'abra um chamado' }] }, d);
    const token = (chat.body.proposta as any).token;
    const cancel = await handleExecute({ token, confirmar: false }, d);
    assert.equal(cancel.body.cancelado, true);
    assert.equal(calls.length, 0);
    assert.equal(d.audits.length, 0);
    const ok = await handleExecute({ token, confirmar: true }, d);
    assert.equal(ok.body.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(d.audits.length, 1);
    assert.equal(d.audits[0].tool, 'abrir_chamado');
    assert.equal(d.audits[0].modulo, 'CHAMADOS');
    const again = await handleExecute({ token, confirmar: true }, d);
    assert.equal(again.status, 409);
    assert.equal(calls.length, 1);
  });

  it('falha da ação também vai para a auditoria', async () => {
    const { api } = fakeApi({ 'POST /api/tickets': () => ({ status: 403, body: { error: 'negado' } }) });
    const d = deps({ api });
    const { token } = signActionToken(SECRET, { uid: ALL.uid, sid: 'sessao-1', tool: 'abrir_chamado', args: { assunto: 'x' }, exp: Date.now() + 60_000 });
    const r = await handleExecute({ token, confirmar: true }, d);
    assert.equal(r.body.ok, false);
    assert.equal(d.audits[0].ok, false);
    assert.equal(d.audits[0].status, 403);
  });

  it('token de outro usuário, outra sessão, adulterado ou expirado é recusado', async () => {
    const d = deps();
    const base = { uid: ALL.uid, sid: 'sessao-1', tool: 'consultar', args: { entidade: 'contratos' }, exp: Date.now() + 60_000 };
    const other = signActionToken(SECRET, { ...base, uid: 'usr-outro' }).token;
    assert.equal((await handleExecute({ token: other, confirmar: true }, d)).status, 403);
    const otherSess = signActionToken(SECRET, { ...base, sid: 'sessao-2' }).token;
    assert.equal((await handleExecute({ token: otherSess, confirmar: true }, d)).status, 403);
    const expired = signActionToken(SECRET, { ...base, exp: Date.now() - 1 }).token;
    assert.equal((await handleExecute({ token: expired, confirmar: true }, d)).status, 410);
    const good = signActionToken(SECRET, base).token;
    const [body, mac] = good.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    payload.tool = 'abrir_chamado';
    payload.args = { assunto: 'forjado' };
    const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${mac}`;
    assert.equal((await handleExecute({ token: forged, confirmar: true }, d)).status, 403);
    assert.equal(d.audits.length, 0);
    assert.equal(verifyActionToken('outro-segredo', good, { uid: ALL.uid, sid: 'sessao-1', now: Date.now() }).ok, false);
  });

  it('argumentos inválidos do modelo viram pergunta, sem proposta', async () => {
    const d = deps({ llm: fakeLlm({ toolCalls: [{ name: 'criar_rascunho_proposta', args: { cliente: 'Alfa' } }] }) });
    const r = await handleChat({ mensagens: [{ papel: 'usuario', texto: 'faça uma proposta' }] }, d);
    assert.equal(r.body.tipo, 'texto');
    assert.match(String(r.body.texto), /titulo|itens/);
  });

  it('limites: tamanho da mensagem e mensagens por minuto', async () => {
    const d = deps();
    const long = await handleChat({ mensagens: [{ papel: 'usuario', texto: 'x'.repeat(2001) }] }, d);
    assert.equal(long.status, 413);
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await handleChat({ mensagens: [{ papel: 'usuario', texto: 'oi' }] }, d)).status;
    assert.equal(last, 429);
  });

  it('erros do provedor viram 429/504/502 sem detalhes internos', async () => {
    const r1 = await handleChat({ mensagens: [{ papel: 'usuario', texto: 'oi' }] }, deps({ llm: fakeLlm(new LlmError('LLM_RATE_LIMITED', 'x', 429)) }));
    assert.equal(r1.status, 429);
    const r2 = await handleChat({ mensagens: [{ papel: 'usuario', texto: 'oi' }] }, deps({ llm: fakeLlm(new LlmError('LLM_TIMEOUT', 'x')) }));
    assert.equal(r2.status, 504);
    const r3 = await handleChat({ mensagens: [{ papel: 'usuario', texto: 'oi' }] }, deps({ llm: null }));
    assert.equal(r3.status, 503);
  });

  it('segredos digitados pelo usuário não chegam ao modelo', async () => {
    const llm = fakeLlm({ text: 'ok' });
    await handleChat({ mensagens: [{ papel: 'usuario', texto: 'minha senha: Abc123!@# e o token stihub_svc_abcdefghijklmnop Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijk' }] }, deps({ llm }));
    const sent = JSON.stringify(llm.calls[0].messages);
    assert.doesNotMatch(sent, /Abc123|stihub_svc_abc|eyJhbGci/);
    assert.match(redactSecrets('api_key=xyz123'), /\[removido\]/);
  });
});

// ---------------------------------------------------------------------------
describe('assistente — permissões', () => {
  it('ferramentas oferecidas ao modelo seguem os módulos do usuário', () => {
    const names = toolDefinitionsFor(CRM_ONLY).map((t) => t.function.name);
    assert.ok(names.includes('consultar'));
    assert.equal(names.includes('abrir_os'), false);
    assert.equal(names.includes('criar_rascunho_proposta'), false);
    assert.equal(names.includes('abrir_chamado'), false);
  });

  it('usuário sem ERP não recebe proposta de consulta de contratos', async () => {
    const d = deps({ user: CRM_ONLY, llm: fakeLlm({ toolCalls: [{ name: 'consultar', args: { entidade: 'contratos' } }] }) });
    const r = await handleChat({ mensagens: [{ papel: 'usuario', texto: 'contratos' }] }, d);
    assert.equal(r.body.tipo, 'texto');
    assert.match(String(r.body.texto), /ERP/);
  });

  it('executar recusa se o usuário perdeu o módulo depois da proposta', async () => {
    const { api, calls } = fakeApi({});
    const d = deps({ user: CRM_ONLY, api });
    const { token } = signActionToken(SECRET, { uid: CRM_ONLY.uid, sid: 'sessao-1', tool: 'abrir_os', args: { cliente: 'A', descricao: 'B' }, exp: Date.now() + 60_000 });
    const r = await handleExecute({ token, confirmar: true }, d);
    assert.equal(r.status, 403);
    assert.equal(calls.length, 0);
  });

  it('o caller do assistente só alcança as rotas da etapa 1', () => {
    assert.equal(isAllowedAssistenteRoute('GET', '/api/erp/contracts'), true);
    assert.equal(isAllowedAssistenteRoute('POST', '/api/erp/invoices'), false);
    assert.equal(isAllowedAssistenteRoute('POST', '/api/communications/send-email'), false);
    assert.equal(isAllowedAssistenteRoute('GET', '/api/admin/users'), false);
    assert.equal(isAllowedAssistenteRoute('GET', '/api/erp/../admin/users'), false);
  });

  function setupRouter() {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const mk = (id: string, email: string, erp: boolean) => {
      repo.upsertRbacUser({ id, email, name: id, roleId: 'SUPER_ADMIN' as never, scope: 'TODOS' as never, moduleAccess: { crm: true, erp, chamados: true }, active: true });
      const u = repo.getRbacState().users.find((x) => x.id === id)!;
      u.active = true;
      u.moduleAccess = { crm: true, erp, chamados: true };
      return signStiHubSessionToken({
        uid: id,
        email,
        name: id,
        roleId: 'SUPER_ADMIN',
        scope: 'TODOS',
        enabledModules: erp ? ['CRM', 'ERP', 'CHAMADOS'] : ['CRM', 'CHAMADOS'],
        moduleAccess: { crm: true, erp, chamados: true },
        canManageUsersRbac: false,
        mfaVerified: true,
        mfaMethod: 'TOTP_AUTHENTICATOR',
        iat: Date.now(),
        exp: Date.now() + 3_600_000,
      } as Parameters<typeof signStiHubSessionToken>[0]);
    };
    const tokErp = mk('usr-erp', 'erp@seta.test', true);
    const tokCrm = mk('usr-crm', 'crm@seta.test', false);
    const callerFor = (tok: string) =>
      createSessionApiCaller(tok, (r) => router.dispatch({ method: r.method, path: r.path, query: { _sessionToken: tok, _fromHttpBridge: '1' }, body: r.body }));
    return { repo, router, tokErp, tokCrm, callerFor };
  }

  it('com o roteador real: sem módulo ERP a consulta de contratos é barrada pelo mesmo portão do middleware', async () => {
    const { tokCrm, tokErp, callerFor } = setupRouter();
    const denied = await getTool('consultar')!.executar({ entidade: 'contratos' }, callerFor(tokCrm));
    assert.equal(denied.ok, false);
    assert.equal(!denied.ok && denied.status, 403);
    const allowed = await getTool('consultar')!.executar({ entidade: 'contratos' }, callerFor(tokErp));
    assert.equal(allowed.ok, true);
  });

  it('com o roteador real: sem sessão válida nada é executado', async () => {
    const { callerFor } = setupRouter();
    const r = await getTool('consultar')!.executar({ entidade: 'empresas' }, callerFor('token-invalido'));
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 401);
  });

  it('auditoria no roteador: grava só recibo assinado do próprio usuário', async () => {
    const { repo, tokErp, callerFor } = setupRouter();
    const api = callerFor(tokErp);
    const secret = resolveStiHubSigningSecret();
    const before = (repo.getRbacState().auditLogs || []).length;
    const recibo = signAuditReceipt(secret, { uid: 'usr-erp', tool: 'consultar', tipo: 'leitura', modulo: 'ERP', ok: true, status: 200, titulo: 'Consultar contratos', detalhe: 'Tipo: contratos', at: Date.now(), n: 'abc' });
    const ok = await api({ method: 'POST', path: '/api/assistente/auditoria', body: { recibo } });
    assert.equal(ok.status, 201);
    const logs = repo.getRbacState().auditLogs || [];
    assert.equal(logs.length, before + 1);
    assert.equal(logs[0].action, 'ASSISTENTE_IA_ACAO_EXECUTADA');
    assert.equal(logs[0].actorEmail, 'erp@seta.test');
    const forjado = signAuditReceipt('segredo-falso', { uid: 'usr-erp', tool: 'x', tipo: 'leitura', modulo: 'ERP', ok: true, status: 200, titulo: 't', detalhe: 'd', at: Date.now(), n: 'x' });
    assert.equal((await api({ method: 'POST', path: '/api/assistente/auditoria', body: { recibo: forjado } })).status, 400);
    const outro = signAuditReceipt(secret, { uid: 'usr-crm', tool: 'x', tipo: 'leitura', modulo: 'ERP', ok: true, status: 200, titulo: 't', detalhe: 'd', at: Date.now(), n: 'y' });
    assert.equal((await api({ method: 'POST', path: '/api/assistente/auditoria', body: { recibo: outro } })).status, 400);
    const velho = signAuditReceipt(secret, { uid: 'usr-erp', tool: 'x', tipo: 'leitura', modulo: 'ERP', ok: true, status: 200, titulo: 't', detalhe: 'd', at: Date.now() - 10 * 60_000, n: 'z' });
    assert.equal((await api({ method: 'POST', path: '/api/assistente/auditoria', body: { recibo: velho } })).status, 400);
  });

  it('sessionBinding não expõe o token da sessão', () => {
    const b = sessionBinding('token-de-sessao-secreto');
    assert.equal(b.length, 32);
    assert.doesNotMatch(b, /token/);
  });
});

// ---------------------------------------------------------------------------
describe('assistente — cliente OmniRoute', () => {
  const cfg = { baseUrl: 'https://omniroute.test/v1', apiKey: 'chave-super-secreta-123', model: 'm1', fallbackModel: 'm2', timeoutMs: 5000 };

  it('429 no modelo principal cai para o modelo reserva', async () => {
    const models: string[] = [];
    const client = createOmniRouteClient(cfg, async (_u, init) => {
      const body = JSON.parse(String(init.body));
      models.push(body.model);
      assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer chave-super-secreta-123');
      if (body.model === 'm1') return new Response('{}', { status: 429 });
      return new Response(JSON.stringify({ model: 'm2', choices: [{ message: { content: '<think>x</think>Oi', tool_calls: [{ function: { name: 'consultar', arguments: '{"entidade":"contratos"}' } }] } }] }), { status: 200 });
    });
    const r = await client.complete([{ role: 'user', content: 'oi' }], []);
    assert.deepEqual(models, ['m1', 'm2']);
    assert.equal(r.text, 'Oi');
    assert.deepEqual(r.toolCalls[0], { name: 'consultar', args: { entidade: 'contratos' } });
  });

  it('502 nos dois modelos vira LlmError sem a chave na mensagem', async () => {
    const client = createOmniRouteClient(cfg, async () => new Response('bad gateway', { status: 502 }));
    await assert.rejects(client.complete([{ role: 'user', content: 'oi' }], []), (e: unknown) => {
      assert.ok(e instanceof LlmError);
      assert.doesNotMatch(String((e as Error).message), /chave-super-secreta/);
      return true;
    });
  });

  it('401 não tenta o reserva (credencial recusada)', async () => {
    let n = 0;
    const client = createOmniRouteClient(cfg, async () => {
      n++;
      return new Response('{}', { status: 401 });
    });
    await assert.rejects(client.complete([{ role: 'user', content: 'oi' }], []));
    assert.equal(n, 1);
  });

  it('configuração: sem URL/chave fica desligado; só https', () => {
    assert.equal(readAssistenteConfig({} as NodeJS.ProcessEnv), null);
    assert.equal(readAssistenteConfig({ OMNIROUTE_BASE_URL: 'http://exemplo.com/v1', OMNIROUTE_API_KEY: 'k' } as NodeJS.ProcessEnv), null);
    const c = readAssistenteConfig({ OMNIROUTE_BASE_URL: 'https://x.test/v1/', OMNIROUTE_API_KEY: 'k' } as NodeJS.ProcessEnv)!;
    assert.equal(c.baseUrl, 'https://x.test/v1');
    assert.equal(c.model, 'minimaxai/minimax-m3.1-flash');
    assert.equal(c.fallbackModel, 'mistralai/mistral-large-4-1t-a52b');
  });
});
