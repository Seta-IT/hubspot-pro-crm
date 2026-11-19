// ============================================================================
// STI-hub — Assistente de IA interno (etapa 1): ferramentas, confirmacao e permissoes.
// Sem rede: o modelo e um duble; as rotas sao o CrmApiRouter em memoria com sessao assinada.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';
import { resolveStiHubSigningSecret, signStiHubSessionToken } from '../src/app/lib/auth';
import { ASSISTENTE_TOOLS, buscaCombina, catalogoAcoes, getTool, parseNumeroBR, refProposta, resolverEmpresa, toolDefinitionsFor, type ApiCaller, type ApiCallRequest, type AssistenteUser } from '../src/modules/assistente/tools';
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

  it('com o roteador real: editar_proposta acrescenta a despesa na proposta exata e recalcula o total', async () => {
    const { repo, tokErp, tokCrm, callerFor } = setupRouter();
    const criada = repo.createProposal({
      title: 'Locação teste assistente',
      companyName: 'Cliente Teste',
      status: 'RASCUNHO',
      contractMonths: 12,
      items: [{ id: 'it-1', sku: '', description: 'Servidor', itemType: 'PRODUCT', fiscalNature: 'LOCACAO_BENS_MOVEIS', ncmOrServiceCode: '', quantity: 1, unitPrice: 1000, discountPercent: 0, isRecurring: true, totalMonthly: 1000 }],
    } as never);
    const numero = String(criada.code);
    const tool = getTool('editar_proposta')!;
    const api = callerFor(tokErp);
    const prep = await tool.preparar!(tool.schema.parse({ proposta: numero, adicionar_itens: [{ descricao: 'Despesas de locomoção e hospedagem', valor_unitario: 2800 }] }), api);
    assert.equal(prep.ok, true, prep.ok ? '' : prep.texto);
    if (!prep.ok) return;
    assert.equal(prep.args.alvo?.id, criada.id);
    const antes = repo.listProposals().find((x) => x.id === criada.id)!;
    const r = await tool.executar(prep.args, api);
    assert.equal(r.ok, true, r.ok ? '' : r.mensagem);
    const depois = repo.listProposals().find((x) => x.id === criada.id)!;
    assert.equal(depois.items.length, antes.items.length + 1);
    assert.equal(depois.items[depois.items.length - 1].unitPrice, 2800);
    assert.equal(Math.round((depois.totalContractValue - antes.totalContractValue) * 100) / 100, 2800);
    // Sem ERP, nem a localização passa (mesmo portão da tela).
    const negado = await tool.preparar!(tool.schema.parse({ proposta: numero, adicionar_itens: [{ descricao: 'x', valor_unitario: 1 }] }), callerFor(tokCrm));
    assert.equal(negado.ok, false);
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

  it('timeout no principal: o reserva usa o resto do orçamento, não só timeoutMs', async () => {
    let now = 0;
    const timeouts: Array<{ model: string; ms: number }> = [];
    const realSetTimeout = globalThis.setTimeout;
    const c2 = { ...cfg, timeoutMs: 25_000, totalBudgetMs: 80_000 };
    const client = createOmniRouteClient(
      c2,
      async (_u, init) => {
        const body = JSON.parse(String(init.body));
        if (body.model === 'm1') {
          now += 25_000; // principal travou ate o timeout
          const e = new Error('aborted');
          e.name = 'AbortError';
          throw e;
        }
        now += 33_000; // reserva lento (mistral-large medido em ~33 s)
        return new Response(JSON.stringify({ model: 'm2', choices: [{ message: { content: 'ok' } }] }), { status: 200 });
      },
      () => now,
    );
    (globalThis as any).setTimeout = (fn: () => void, ms: number) => {
      timeouts.push({ model: timeouts.length ? 'm2' : 'm1', ms });
      return realSetTimeout(fn, 0x7fffffff);
    };
    try {
      const r = await client.complete([{ role: 'user', content: 'oi' }], []);
      assert.equal(r.text, 'ok');
    } finally {
      (globalThis as any).setTimeout = realSetTimeout;
    }
    assert.deepEqual(timeouts, [{ model: 'm1', ms: 25_000 }, { model: 'm2', ms: 55_000 }]);
  });

  it('resposta cortada só com raciocínio (finish_reason=length, sem conteúdo) cai para o reserva', async () => {
    const models: string[] = [];
    const client = createOmniRouteClient(cfg, async (_u, init) => {
      const body = JSON.parse(String(init.body));
      models.push(body.model);
      assert.equal(body.max_tokens, 2048);
      if (body.model === 'm1') return new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: null } }] }), { status: 200 });
      return new Response(JSON.stringify({ model: 'm2', choices: [{ finish_reason: 'tool_calls', message: { content: '', tool_calls: [{ function: { name: 'consultar_propostas', arguments: '{"busca":"4709"}' } }] } }] }), { status: 200 });
    });
    const r = await client.complete([{ role: 'user', content: 'oi' }], []);
    assert.deepEqual(models, ['m1', 'm2']);
    assert.equal(r.toolCalls[0].name, 'consultar_propostas');
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
    assert.equal(c.model, 'nvidia/nemotron-3.5-lightning-30b-a3b');
    assert.equal(c.totalBudgetMs, 80_000);
    assert.equal(c.fallbackModel, 'mistralai/mistral-large-4-1t-a52b');
  });
});

// ---------------------------------------------------------------------------
describe('assistente — fluxo da proposta (A3C cloud, 36 meses)', () => {
  const A3 = [
    { id: 'co-a3c', name: 'A3CLOUD.IT LTDA', cnpj: '10.455.355/0001-29' },
    { id: 'co-a3', name: 'A3 CLOUD TECNOLOGIA DA INFORMACAO LTDA', cnpj: '11.504.452/0001-27' },
    { id: 'co-b', name: 'Beta SA', cnpj: '' },
  ];
  const PEDIDO = 'gere uma proposta locaçao de 36 meses para A3C cloud de 3 servidores dell r640 com 256Gb de ram e 3 SSDs de 2tb cada';
  const ITENS = [{ descricao: 'Servidor Dell R640, 256 GB RAM, 3 SSD 2 TB', quantidade: 3, tipo: 'locacao' }];
  // Busca do servidor e literal (como a rota real): "A3C cloud" nao acha nada; sem search devolve tudo.
  const companiesRoute = (r: ApiCallRequest) => {
    const q = new URL(`http://x${r.path}`).searchParams.get('search');
    const data = q ? A3.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())) : A3;
    return { status: 200, body: { data } };
  };

  it('busca tolerante: "A3C cloud" acha A3CLOUD e A3 CLOUD, ignorando espaço, ponto e maiúsculas', () => {
    assert.equal(buscaCombina('A3C cloud', ['A3CLOUD.IT LTDA']), true);
    assert.equal(buscaCombina('A3C cloud', ['A3 CLOUD TECNOLOGIA DA INFORMACAO LTDA']), true);
    assert.equal(buscaCombina('a3cloud.it', ['A3CLOUD.IT LTDA']), true);
    assert.equal(buscaCombina('A3C cloud', ['Beta SA']), false);
  });

  it('consultar empresas devolve ao modelo a quantidade, os nomes e o CNPJ', async () => {
    const { api } = fakeApi({ 'GET /api/companies': companiesRoute });
    const r = await getTool('consultar')!.executar({ entidade: 'empresas', busca: 'A3C cloud' }, api);
    assert.equal(r.ok && r.tabela?.linhas.length, 2);
    assert.match(r.resumoParaModelo, /2 encontrados/);
    assert.match(r.resumoParaModelo, /A3CLOUD\.IT LTDA \(CNPJ 10\.455\.355\/0001-29\)/);
    assert.match(r.resumoParaModelo, /A3 CLOUD TECNOLOGIA/);
  });

  it('turno 1: proposta com 2 empresas possíveis pergunta qual, sem gravar nada', async () => {
    const { api, calls } = fakeApi({ 'GET /api/companies': companiesRoute });
    const llm = fakeLlm({ toolCalls: [{ name: 'criar_rascunho_proposta', args: { cliente: 'A3C cloud', prazo_meses: 36, itens: ITENS } }] });
    const r = await handleChat({ mensagens: [{ papel: 'usuario', texto: PEDIDO }] }, deps({ api, llm }));
    assert.equal(r.body.tipo, 'texto');
    assert.match(String(r.body.texto), /Encontrei 2 empresas/);
    assert.match(String(r.body.texto), /A3CLOUD\.IT LTDA/);
    assert.match(String(r.body.texto), /A3 CLOUD TECNOLOGIA/);
    assert.match(String(r.body.texto), /Qual delas\?/);
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
  });

  it('turno 2: com a empresa escolhida, o histórico vai ao modelo e sai o cartão de rascunho que grava 36 meses', async () => {
    const { api, calls } = fakeApi({
      'GET /api/companies': companiesRoute,
      'POST /api/erp/proposals': (r) => ({ status: 201, body: { data: { id: 'prop-9', code: '2001', ...r.body } } }),
    });
    const llm = fakeLlm({ toolCalls: [{ name: 'criar_rascunho_proposta', args: { cliente: 'A3CLOUD.IT LTDA', prazo_meses: '36', itens: ITENS } }] });
    const d = deps({ api, llm });
    const historico = [
      { papel: 'usuario' as const, texto: PEDIDO },
      { papel: 'assistente' as const, texto: 'Encontrei 2 empresas para "A3C cloud": 1) A3CLOUD.IT LTDA (CNPJ 10.455.355/0001-29); 2) A3 CLOUD TECNOLOGIA DA INFORMACAO LTDA (CNPJ 11.504.452/0001-27). Qual delas?' },
      { papel: 'usuario' as const, texto: 'a primeira' },
    ];
    const chat = await handleChat({ mensagens: historico }, d);
    const enviados = llm.calls[0].messages.map((m: any) => m.content).join('\n');
    assert.match(enviados, /36 meses para A3C cloud/);
    assert.match(enviados, /a primeira/);
    assert.equal(chat.body.tipo, 'proposta');
    const prop = chat.body.proposta as any;
    assert.equal(prop.ferramenta, 'criar_rascunho_proposta');
    const linhas = prop.linhas.join('\n');
    assert.match(linhas, /Cliente: A3CLOUD\.IT LTDA — CNPJ 10\.455\.355\/0001-29/);
    assert.match(linhas, /Prazo: 36 meses/);
    assert.match(linhas, /3 x Servidor Dell R640.*valor a definir/);
    const ok = await handleExecute({ token: prop.token, confirmar: true }, d);
    assert.equal(ok.body.ok, true);
    const post = calls.find((c) => c.method === 'POST')!;
    assert.equal(post.body?.companyId, 'co-a3c');
    assert.equal(post.body?.contractMonths, 36);
    assert.equal(post.body?.budgetType, 'LOCACAO');
    assert.equal(post.body?.status, 'RASCUNHO');
    assert.equal((post.body?.items as any[])[0].quantity, 3);
    assert.equal((post.body?.items as any[])[0].unitPrice, 0);
  });

  it('uma empresa só: o cartão sai direto no primeiro turno', async () => {
    const { api } = fakeApi({ 'GET /api/companies': (r) => ({ status: 200, body: { data: r.path.includes('search') ? [] : [A3[0], A3[2]] } }) });
    const llm = fakeLlm({ toolCalls: [{ name: 'criar_rascunho_proposta', args: { cliente: 'A3C cloud', prazo_meses: 36, itens: ITENS } }] });
    const r = await handleChat({ mensagens: [{ papel: 'usuario', texto: PEDIDO }] }, deps({ api, llm }));
    assert.equal(r.body.tipo, 'proposta');
    assert.match((r.body.proposta as any).linhas.join('\n'), /A3CLOUD\.IT LTDA/);
  });

  it('CNPJ no cliente prevalece: a busca por nome não troca para outra empresa', async () => {
    const { api } = fakeApi({
      'GET /api/companies': (r) => {
        const q = new URL(`http://x${r.path}`).searchParams.get('search');
        // A busca pelo nome devolve só a outra empresa; a lista completa tem as duas.
        if (q) return { status: 200, body: { data: [A3[1]] } };
        return { status: 200, body: { data: A3 } };
      },
    });
    const emp = await resolverEmpresa('A3CLOUD.IT LTDA — CNPJ 10.455.355/0001-29', api);
    assert.equal(emp.ok, true);
    if (emp.ok) assert.equal(emp.company.id, 'co-a3c');
  });

  it('CNPJ assinado ausente no cadastro visível não cai em empresa de nome parecido', async () => {
    const { api } = fakeApi({
      'GET /api/companies': () => ({ status: 200, body: { data: [A3[1]] } }),
    });
    const emp = await resolverEmpresa('A3CLOUD.IT LTDA — CNPJ 10.455.355/0001-29', api);
    assert.equal(emp.ok, false);
  });

  it('catálogo genérico: ações com rotas e disponibilidade por módulo; título e valor são opcionais', () => {
    const cat = catalogoAcoes();
    assert.ok(cat.every((c) => c.rotas.length > 0));
    assert.ok(cat.find((c) => c.acao === 'criar_rascunho_proposta')!.rotas.includes('POST /api/erp/proposals'));
    const def = toolDefinitionsFor(ALL).find((t) => t.function.name === 'criar_rascunho_proposta')!;
    assert.deepEqual((def.function.parameters as any).required, ['cliente', 'itens']);
    assert.deepEqual((def.function.parameters as any).properties.itens.items.required, ['descricao', 'quantidade']);
    assert.equal(ASSISTENTE_TOOLS.every((t) => typeof t.disponivel === 'function'), true);
  });
});

// ---------------------------------------------------------------------------
describe('assistente — propostas: localizar 4709 e acrescentar despesa', () => {
  const PROP = {
    id: 'prop-stihub-1',
    code: '4709',
    title: 'Locação de servidores',
    companyName: 'A3CLOUD.IT LTDA',
    companyCnpj: '10.455.355/0001-29',
    status: 'RASCUNHO',
    contractMonths: 12,
    updatedAt: '2026-11-19T10:00:00.000Z',
    items: [{ id: 'i1', sku: '', description: 'Servidor Dell R640', itemType: 'PRODUCT', fiscalNature: 'LOCACAO_BENS_MOVEIS', ncmOrServiceCode: '', quantity: 1, unitPrice: 1000, discountPercent: 0, isRecurring: true, totalMonthly: 1000 }],
    monthlyRecurringTotal: 1000,
    oneTimeSetupTotal: 0,
    shippingCost: 0,
    totalContractValue: 12000,
  };
  const OUTRA = { ...PROP, id: 'prop-stihub-2', code: '14709', companyName: 'Beta SA', updatedAt: '2026-11-01T00:00:00.000Z' };
  function propApi(p: any = PROP) {
    let current = { ...p };
    return fakeApi({
      // Rota em memória ignora ?q= (devolve tudo); o assistente casa o número exato.
      'GET /api/erp/proposals': () => ({ status: 200, body: { data: [OUTRA, current], total: 2 } }),
      [`GET /api/erp/proposals/${p.id}`]: () => ({ status: 200, body: { data: current } }),
      [`PATCH /api/erp/proposals/${p.id}`]: (r) => {
        current = { ...current, ...r.body, updatedAt: '2026-11-19T11:00:00.000Z', totalContractValue: 14800 };
        return { status: 200, body: { data: current } };
      },
    });
  }
  const EDIT_CALL = { name: 'editar_proposta', args: { proposta: '4709', adicionar_itens: [{ descricao: 'Despesas de locomoção e hospedagem', valor_unitario: '2.800,00' }] } };

  it('valores em formato brasileiro e referência da proposta', () => {
    assert.equal(parseNumeroBR('2.800,00'), 2800);
    assert.equal(parseNumeroBR('2800,00'), 2800);
    assert.equal(parseNumeroBR('R$ 2.800'), 2800);
    assert.equal(parseNumeroBR('2800.50'), 2800.5);
    assert.equal(parseNumeroBR('abc'), 'abc');
    assert.equal(refProposta('proposta 4709'), '4709');
    assert.equal(refProposta('#4709'), '4709');
  });

  it('consultar_propostas pelo número traz número, cliente, total, situação e itens (não confunde 14709)', async () => {
    const { api, calls } = propApi();
    const r = await getTool('consultar_propostas')!.executar({ busca: '4709' }, api);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.match(r.mensagem, /Proposta 4709 de A3CLOUD\.IT LTDA/);
    assert.match(r.resumoParaModelo, /cliente A3CLOUD\.IT LTDA; situação Rascunho; total R\$\s?12\.000,00/);
    assert.match(r.resumoParaModelo, /1\) Servidor Dell R640 x1/);
    assert.equal(r.tabela?.linhas.length, 1);
    assert.ok(calls.some((c) => c.path === '/api/erp/proposals/prop-stihub-1'));
    assert.ok(calls.every((c) => !c.path.startsWith('/api/deals')), 'nunca consulta negócios');
  });

  it('chat: o cartão mostra número, cliente, a despesa e o total antes e depois; executar grava só na proposta do cartão', async () => {
    const { api, calls } = propApi();
    const llm = fakeLlm({ toolCalls: [EDIT_CALL] });
    const d = deps({ api, llm });
    const chat = await handleChat({ mensagens: [{ papel: 'usuario', texto: 'localize a proposta 4709 e adicione o valor de 2800,00 para despesas de locomoção e hospedagem' }] }, d);
    assert.equal(chat.body.tipo, 'proposta');
    const prop = chat.body.proposta as any;
    assert.equal(prop.ferramenta, 'editar_proposta');
    assert.equal(prop.titulo, 'Editar a proposta 4709');
    const linhas = prop.linhas.join('\n');
    assert.match(linhas, /Proposta: 4709/);
    assert.match(linhas, /Cliente: A3CLOUD\.IT LTDA — CNPJ 10\.455\.355\/0001-29/);
    assert.match(linhas, /Adicionar: Despesas de locomoção e hospedagem x1 a R\$\s?2\.800,00 \(cobrança única\)/);
    assert.match(linhas, /Antes: .*contrato R\$\s?12\.000,00/);
    assert.match(linhas, /Depois: .*contrato R\$\s?14\.800,00/);
    assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0, 'o chat não grava');
    const ok = await handleExecute({ token: prop.token, confirmar: true }, d);
    assert.equal(ok.body.ok, true);
    const patch = calls.filter((c) => c.method === 'PATCH');
    assert.equal(patch.length, 1);
    assert.equal(patch[0].path, '/api/erp/proposals/prop-stihub-1');
    assert.equal(patch[0].body?.expectedUpdatedAt, PROP.updatedAt);
    const itens = patch[0].body?.items as any[];
    assert.equal(itens.length, 2);
    assert.equal(itens[1].unitPrice, 2800);
    assert.equal(itens[1].isRecurring, false);
    assert.equal(d.audits[0].tool, 'editar_proposta');
    assert.equal(d.audits[0].modulo, 'ERP');
    const again = await handleExecute({ token: prop.token, confirmar: true }, d);
    assert.equal(again.status, 409, 'nonce de uso único');
  });

  it('a proposta mudou depois do cartão: não grava', async () => {
    const { api, calls } = propApi();
    const d = deps({ api, llm: fakeLlm({ toolCalls: [EDIT_CALL] }) });
    const chat = await handleChat({ mensagens: [{ papel: 'usuario', texto: 'adicione 2800 de despesas na 4709' }] }, d);
    const token = (chat.body.proposta as any).token;
    const changed = fakeApi({
      'GET /api/erp/proposals/prop-stihub-1': () => ({ status: 200, body: { data: { ...PROP, updatedAt: '2026-11-19T10:30:00.000Z' } } }),
    });
    const r = await handleExecute({ token, confirmar: true }, { ...d, api: changed.api });
    assert.equal(r.body.ok, false);
    assert.match(String(r.body.mensagem), /alterada depois que o cartão/);
    assert.equal(changed.calls.filter((c) => c.method === 'PATCH').length + calls.filter((c) => c.method === 'PATCH').length, 0);
  });

  it('proposta do GestãoClick: avisa da divergência e não monta cartão', async () => {
    const { api, calls } = propApi({ ...PROP, id: 'prop-gc-98765' });
    const r = await handleChat({ mensagens: [{ papel: 'usuario', texto: 'adicione 2800 na 4709' }] }, deps({ api, llm: fakeLlm({ toolCalls: [EDIT_CALL] }) }));
    assert.equal(r.body.tipo, 'texto');
    assert.match(String(r.body.texto), /veio do GestãoClick/);
    assert.match(String(r.body.texto), /não envia alterações de volta/);
    assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0);
  });

  it('proposta aprovada: edição bloqueada', async () => {
    const { api } = propApi({ ...PROP, status: 'APROVADA' });
    const r = await handleChat({ mensagens: [{ papel: 'usuario', texto: 'adicione 2800 na 4709' }] }, deps({ api, llm: fakeLlm({ toolCalls: [EDIT_CALL] }) }));
    assert.equal(r.body.tipo, 'texto');
    assert.match(String(r.body.texto), /aprovada e não pode ser editada/);
  });

  it('alvo enviado pelo modelo é ignorado (só o servidor define a proposta do cartão)', async () => {
    const { api } = propApi();
    const forged = { name: 'editar_proposta', args: { ...EDIT_CALL.args, alvo: { id: 'prop-stihub-2', code: '14709', updatedAt: 'x', linhas: ['falso'] } } };
    const r = await handleChat({ mensagens: [{ papel: 'usuario', texto: 'x' }] }, deps({ api, llm: fakeLlm({ toolCalls: [forged] }) }));
    assert.equal(r.body.tipo, 'proposta');
    assert.match((r.body.proposta as any).linhas.join('\n'), /Proposta: 4709/);
    assert.doesNotMatch((r.body.proposta as any).linhas.join('\n'), /falso/);
  });

  it('rotas e ferramentas: PATCH só em /api/erp/proposals/:id; ferramentas de proposta só com ERP; prompt manda propostas para consultar_propostas', async () => {
    assert.equal(isAllowedAssistenteRoute('PATCH', '/api/erp/proposals/prop-1'), true);
    assert.equal(isAllowedAssistenteRoute('PATCH', '/api/erp/contracts/c1'), false);
    assert.equal(isAllowedAssistenteRoute('GET', '/api/erp/proposals?q=4709'), true);
    const erpNames = toolDefinitionsFor(ALL).map((t) => t.function.name);
    assert.ok(erpNames.includes('consultar_propostas') && erpNames.includes('editar_proposta'));
    const crmNames = toolDefinitionsFor(CRM_ONLY).map((t) => t.function.name);
    assert.ok(!crmNames.includes('consultar_propostas') && !crmNames.includes('editar_proposta'));
    const llm = fakeLlm({ text: 'ok' });
    await handleChat({ mensagens: [{ papel: 'usuario', texto: 'oi' }] }, deps({ llm }));
    const system = llm.calls[0].messages[0].content as string;
    assert.match(system, /consultar_propostas/);
    assert.match(system, /Nunca use consultar com entidade negocios para propostas/);
    assert.match(system, /2\.800,00/);
  });
});
