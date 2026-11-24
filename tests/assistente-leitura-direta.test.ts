// ============================================================================
// STI-hub — Assistente: leitura sem confirmação, gravação com confirmação (24/11/2026).
// Aprovado pelo Marcéllo: "Sem confirmação" para consultas/buscas/base/painel/fichas.
// O que grava ou altera dados continua com o cartão "Confirmar". RBAC segue valendo.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ASSISTENTE_TOOLS, type ApiCaller, type ApiCallRequest, type AssistenteUser } from '../src/modules/assistente/tools';
import { handleChat, handleExecute, type AssistenteDeps, type AssistenteAuditEntry } from '../src/modules/assistente/service';
import type { LlmClient } from '../src/modules/assistente/omniroute-client';

const AGORA = Date.parse('2026-11-24T15:00:00-03:00');
const ALL: AssistenteUser = { uid: 'usr-ana', email: 'ana@seta.test', name: 'Ana', roleId: 'SUPER_ADMIN', moduleAccess: { crm: true, erp: true, chamados: true } };
const CRM_ONLY: AssistenteUser = { ...ALL, uid: 'usr-bia', moduleAccess: { crm: true, erp: false, chamados: false } };
const ERP_ONLY: AssistenteUser = { ...ALL, uid: 'usr-eva', moduleAccess: { crm: false, erp: true, chamados: false } };

const PROP = { id: 'prop-1795473263142-d5b63b', code: '4725', companyName: 'Condomínio do Parangaba', status: 'ENVIADA', budgetType: 'LOCACAO', contractMonths: 36, monthlyRecurringTotal: 2350, totalContractValue: 84600, validUntil: '2099-12-07', items: [{ description: 'Servidor', quantity: 1, unitPrice: 2350 }] };

function fakeApi(over: Record<string, (r: ApiCallRequest) => { status: number; body: any }> = {}) {
  const calls: ApiCallRequest[] = [];
  const routes: Record<string, (r: ApiCallRequest) => { status: number; body: any }> = {
    'GET /api/erp/proposals': () => ({ status: 200, body: { data: [PROP], total: 1 } }),
    [`GET /api/erp/proposals/${PROP.id}`]: () => ({ status: 200, body: { data: PROP } }),
    'GET /api/erp/contracts': () => ({ status: 200, body: { data: [{ id: 'c1', contractNumber: 'LOC-1', companyName: 'Alfa', status: 'ATIVO', monthlyValue: 10 }] } }),
    'GET /api/erp/invoices': () => ({ status: 200, body: { data: [] } }),
    'GET /api/erp/fiscal-documents': () => ({ status: 200, body: { data: [] } }),
    'GET /api/erp/overview': () => ({ status: 200, body: { data: { serviceOrders: [], suppliers: [] } } }),
    'GET /api/erp/dashboard': () => ({ status: 200, body: { data: { proposalsCreated: 3, proposalsApproved: 1, financeVisible: false } } }),
    'GET /api/tickets': () => ({ status: 200, body: { data: [] } }),
    'GET /api/companies': () => ({ status: 200, body: { data: [{ id: 'co1', name: 'Alfa Ltda', cnpj: '11222333000181' }] } }),
    'GET /api/contacts': () => ({ status: 200, body: { data: [] } }),
    'GET /api/erp/catalog': () => ({ status: 200, body: { data: [] } }),
    'POST /api/tickets': () => ({ status: 201, body: { data: { id: 't9', key: 'SETA-9' } } }),
    ...over,
  };
  const api: ApiCaller = async (r) => {
    calls.push(r);
    const h = routes[`${r.method} ${r.path.split('?')[0]}`];
    return h ? h(r) : { status: 404, body: { error: 'nao encontrado' } };
  };
  return { api, calls };
}

function llm(toolCall?: { name: string; args: any }): LlmClient & { calls: number } {
  const o = {
    calls: 0,
    async complete() {
      o.calls += 1;
      return { text: '', toolCalls: toolCall ? [toolCall] : [], model: 't' };
    },
  };
  return o as any;
}

function deps(over: Partial<AssistenteDeps> = {}): AssistenteDeps & { audits: AssistenteAuditEntry[] } {
  const audits: AssistenteAuditEntry[] = [];
  const nonces = new Set<string>();
  return {
    llm: llm(),
    api: fakeApi().api,
    user: ALL,
    secret: 'segredo-de-teste-leitura-direta-0123456789',
    sid: 's1',
    now: () => AGORA,
    async rateLimit() {
      return true;
    },
    async consumeNonce(n: string) {
      if (nonces.has(n)) return false;
      nonces.add(n);
      return true;
    },
    async audit(e: AssistenteAuditEntry) {
      audits.push(e);
    },
    audits,
    ...over,
  } as AssistenteDeps & { audits: AssistenteAuditEntry[] };
}
const msg = (texto: string) => ({ mensagens: [{ papel: 'usuario' as const, texto }] });

describe('assistente — leitura executa direto (sem "Confirmar")', () => {
  const LEITURAS: Array<[string, string]> = [
    ['orçamento 4725', 'consultar_propostas'],
    ['Proposta Comercial #prop-1795473263142-d5b63b não localizada, por que essa proposta não abre?', 'buscar'],
    ['CNPJ 11.222.333/0001-81', 'buscar'],
    ['contratos ativos', 'consultar'],
    ['faturas vencidas', 'consultar'],
    ['relatório de contratos por situação', 'relatorio'],
    ['painel de outubro', 'painel'],
    ['propostas enviadas este mês', 'consultar_propostas'],
  ];
  for (const [texto, ferramenta] of LEITURAS) {
    it(`"${texto}" => resultado na hora (${ferramenta}), só GET, auditado, sem token`, async () => {
      const { api, calls } = fakeApi();
      const d = deps({ api });
      const r = await handleChat(msg(texto), d);
      assert.equal(r.status, 200);
      assert.equal(r.body.tipo, 'resultado', JSON.stringify(r.body).slice(0, 200));
      assert.equal(r.body.proposta, undefined);
      assert.equal((r.body.acao as any).ferramenta, ferramenta);
      assert.equal((r.body.acao as any).acao, 'leitura');
      assert.equal(typeof (r.body.resultado as any).mensagem, 'string');
      assert.doesNotMatch(JSON.stringify(r.body), /"token"/);
      assert.ok(calls.length > 0 && calls.every((c) => c.method === 'GET'), 'nada gravado');
      assert.equal(d.audits.length, 1);
      assert.equal(d.audits[0].tipo, 'leitura');
      assert.equal(d.audits[0].tool, ferramenta);
    });
  }

  it('leitura escolhida pelo modelo também sai direto', async () => {
    const { api, calls } = fakeApi();
    const m = llm({ name: 'consultar', args: { entidade: 'contratos' } });
    const r = await handleChat(msg('e aí, me ajuda com aquilo'), deps({ api, llm: m }));
    assert.equal(m.calls, 1);
    assert.equal(r.body.tipo, 'resultado');
    assert.ok(calls.every((c) => c.method === 'GET'));
  });

  it('base de conhecimento responde em texto, sem cartão e sem chamar rota', async () => {
    const { api, calls } = fakeApi();
    const r = await handleChat(msg('a Seta aceita cartão de crédito?'), deps({ api }));
    assert.equal(r.body.tipo, 'texto');
    assert.equal(calls.length, 0);
  });

  it('erro da rota (403) volta como resultado com a mensagem, auditado como falha', async () => {
    const { api } = fakeApi({ 'GET /api/erp/contracts': () => ({ status: 403, body: { error: 'Sem permissão' } }) });
    const d = deps({ api });
    const r = await handleChat(msg('contratos ativos'), d);
    assert.equal(r.body.tipo, 'resultado');
    assert.equal((r.body.resultado as any).ok, false);
    assert.equal(d.audits[0].ok, false);
  });

  it('limite de execuções vale também para consultas diretas', async () => {
    const { api, calls } = fakeApi();
    const d = deps({ api, async rateLimit(bucket: string) { return !bucket.startsWith('exec:'); } });
    const r = await handleChat(msg('contratos ativos'), d);
    assert.equal(r.status, 429);
    assert.equal(calls.length, 0);
  });
});

describe('assistente — RBAC nas consultas diretas', () => {
  it('sem ERP: "contratos ativos" não consulta nada', async () => {
    const { api, calls } = fakeApi();
    const r = await handleChat(msg('contratos ativos'), deps({ api, user: CRM_ONLY }));
    assert.notEqual(r.body.tipo, 'resultado');
    assert.equal(calls.length, 0);
  });
  it('sem Chamados: "chamados abertos" não consulta nada', async () => {
    const { api, calls } = fakeApi();
    const r = await handleChat(msg('chamados abertos'), deps({ api, user: ERP_ONLY }));
    assert.notEqual(r.body.tipo, 'resultado');
    assert.ok(!calls.some((c) => c.path.startsWith('/api/tickets')));
  });
  it('sem ERP: o modelo pedindo consultar_propostas recebe recusa, sem rota', async () => {
    const { api, calls } = fakeApi();
    const r = await handleChat(msg('quero ver uma coisa'), deps({ api, user: CRM_ONLY, llm: llm({ name: 'consultar_propostas', args: { busca: '4725' } }) }));
    assert.equal(r.body.tipo, 'texto');
    assert.equal(calls.length, 0);
  });
});

describe('assistente — gravação continua com "Confirmar"', () => {
  const GRAVACOES: Array<[string, { name: string; args: any }]> = [
    ['abra um chamado: impressora parada', { name: 'abrir_chamado', args: { assunto: 'Impressora parada' } }],
    ['abra uma OS para a Alfa trocar a fonte', { name: 'abrir_os', args: { cliente: 'Alfa Ltda', descricao: 'Trocar a fonte' } }],
    ['crie uma proposta de locação para a Alfa', { name: 'criar_rascunho_proposta', args: { cliente: 'Alfa Ltda', prazo_meses: 12, itens: [{ descricao: 'Notebook', quantidade: 1 }] } }],
    ['adicione 2800 de despesas na proposta 4725', { name: 'editar_proposta', args: { proposta: '4725', adicionar_itens: [{ descricao: 'Despesas', valor_unitario: 2800, tipo: 'despesa', cobranca: 'unica' }] } }],
  ];
  for (const [texto, call] of GRAVACOES) {
    it(`"${texto}" => cartão (${call.name}), nada gravado antes do Confirmar`, async () => {
      const { api, calls } = fakeApi();
      const d = deps({ api, llm: llm(call) });
      const r = await handleChat(msg(texto), d);
      assert.equal(r.body.tipo, 'proposta', JSON.stringify(r.body).slice(0, 300));
      assert.equal((r.body.proposta as any).acao, 'gravacao');
      assert.ok((r.body.proposta as any).token);
      assert.ok(calls.every((c) => c.method === 'GET'), 'só leituras de preparo');
      assert.equal(d.audits.length, 0);
    });
  }

  it('Confirmar executa a gravação uma vez; Cancelar não executa', async () => {
    const { api, calls } = fakeApi();
    const d = deps({ api, llm: llm({ name: 'abrir_chamado', args: { assunto: 'Impressora parada' } }) });
    const r = await handleChat(msg('abra um chamado'), d);
    const token = (r.body.proposta as any).token;
    assert.equal((await handleExecute({ token, confirmar: false }, d)).body.cancelado, true);
    assert.ok(!calls.some((c) => c.method === 'POST'));
    const ok = await handleExecute({ token, confirmar: true }, d);
    assert.equal(ok.body.ok, true);
    assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
    assert.equal((await handleExecute({ token, confirmar: true }, d)).status, 409);
  });

  it('catálogo: toda ferramenta de leitura só usa GET; toda que grava é "gravacao"', () => {
    for (const t of ASSISTENTE_TOOLS) {
      const escreve = t.rotas.some((r) => !r.startsWith('GET '));
      if (t.tipo === 'leitura') assert.ok(!escreve, `${t.name} é leitura e tem rota de escrita`);
      if (escreve) assert.equal(t.tipo, 'gravacao', t.name);
    }
    assert.deepEqual(ASSISTENTE_TOOLS.filter((t) => t.tipo === 'gravacao').map((t) => t.name).sort(), ['abrir_chamado', 'abrir_os', 'criar_rascunho_proposta', 'editar_proposta']);
  });
});

describe('assistente — painel', () => {
  const painel = fs.readFileSync(path.join(process.cwd(), 'src/app/components/AssistenteIaPanel.tsx'), 'utf8');
  it('subtítulo novo e sem o antigo', () => {
    assert.match(painel, /Consultas são imediatas; alterações pedem confirmação/);
    assert.doesNotMatch(painel, /Confirma cada ação antes de executar/);
  });
  it('mostra o resultado direto quando o servidor devolve tipo "resultado"', () => {
    assert.match(painel, /data\?\.tipo === 'resultado' && data\.resultado/);
    assert.match(painel, /data-testid="assistente-consulta"/);
  });
  it('o link do cliente (cria/reaproveita /p/) só sai no clique explícito do botão', () => {
    assert.match(painel, /Só acontece neste clique/);
    assert.match(painel, /onClick=\{async \(\) => \{\s*set\(i, \{ tipo: 'carregando', texto: 'Gerando o link do cliente…' \}\);/);
  });
});
