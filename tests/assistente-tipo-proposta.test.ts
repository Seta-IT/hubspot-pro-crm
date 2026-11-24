// ============================================================================
// STI-hub — Assistente: o rascunho de proposta começa pelo TIPO (24/11/2026).
// Caso: "você pode gerar uma proposta?" pedia cliente/itens/prazo sem perguntar o tipo
// ("Não questionou os tipos de propostas???"). Agora: tipo primeiro (Produtos, Serviços
// pontual ou mensal, Locação), depois os campos certos de cada tipo. Pagamento só Boleto,
// Pix ou Ted / Transferência. A criação continua com o cartão "Confirmar".
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getTool, toolDefinitionsFor, type ApiCaller, type ApiCallRequest, type AssistenteUser } from '../src/modules/assistente/tools';
import { corpoRascunhoProposta } from '../src/modules/assistente/tools';
import { fluxoNovaProposta, handleChat, handleExecute, type AssistenteDeps, type AssistenteAuditEntry } from '../src/modules/assistente/service';
import {
  PERGUNTA_SERVICO_MODO, PERGUNTA_TIPO_PROPOSTA, pedidoNovaProposta, tipoPropostaDaConversa, tipoPropostaNoTexto,
} from '../src/modules/assistente/proposta-tipo';
import { buscarConhecimento } from '../src/modules/assistente/conhecimento';
import type { LlmClient } from '../src/modules/assistente/omniroute-client';

const AGORA = Date.parse('2026-11-24T17:00:00-03:00');
const ALL: AssistenteUser = { uid: 'usr-ana', email: 'ana@seta.test', name: 'Ana', roleId: 'SUPER_ADMIN', moduleAccess: { crm: true, erp: true, chamados: true } };
const CRM_ONLY: AssistenteUser = { ...ALL, uid: 'usr-bia', moduleAccess: { crm: true, erp: false, chamados: false } };
const EMPRESA = { id: 'co1', name: 'Alfa Ltda', cnpj: '11222333000181' };

function fakeApi() {
  const calls: ApiCallRequest[] = [];
  const api: ApiCaller = async (r) => {
    calls.push(r);
    const k = `${r.method} ${r.path.split('?')[0]}`;
    if (k === 'GET /api/companies') return { status: 200, body: { data: [EMPRESA] } };
    if (k === 'POST /api/erp/proposals') return { status: 201, body: { data: { id: 'prop-n1', code: '4800', ...(r.body as any) } } };
    return { status: 404, body: { error: 'nao encontrado' } };
  };
  return { api, calls };
}

function llm(toolCall?: { name: string; args: any }, text = ''): LlmClient & { calls: number; ultimo: any[] } {
  const o = {
    calls: 0,
    ultimo: [] as any[],
    async complete(messages: any[]) {
      o.calls += 1;
      o.ultimo = messages;
      return { text, toolCalls: toolCall ? [toolCall] : [], model: 't' };
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
    secret: 'segredo-de-teste-tipo-proposta-0123456789',
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
type M = { papel: 'usuario' | 'assistente'; texto: string };
const u = (texto: string): M => ({ papel: 'usuario', texto });
const a = (texto: string): M => ({ papel: 'assistente', texto });

describe('assistente — proposta nova pergunta o tipo primeiro', () => {
  for (const frase of ['voce pode gerar uma proposta?', 'você pode gerar uma proposta?', 'quero fazer um orçamento', 'cria uma proposta pra mim', 'preciso de uma proposta', 'nova proposta', 'monte um orçamento para a Alfa']) {
    it(`"${frase}" => pergunta o tipo, sem modelo e sem gravar`, async () => {
      const { api, calls } = fakeApi();
      const l = llm();
      const r = await handleChat({ mensagens: [u(frase)] }, deps({ api, llm: l }));
      assert.equal(r.status, 200);
      assert.equal(r.body.tipo, 'texto');
      assert.equal(r.body.texto, PERGUNTA_TIPO_PROPOSTA);
      for (const t of ['Produtos', 'Serviços — pontual', 'Serviços — mensal', 'Locação']) assert.ok(String(r.body.texto).includes(t), t);
      assert.equal(l.calls, 0);
      assert.equal(calls.length, 0);
    });
  }

  it('o caso do print: não pede cliente/itens/prazo antes do tipo', async () => {
    const r = await handleChat({ mensagens: [u('voce pode gerar uma proposta?')] }, deps());
    assert.doesNotMatch(String(r.body.texto), /Cliente|Itens|Prazo/);
  });

  it('pedidos sobre propostas existentes não viram criação', () => {
    for (const t of ['gere o pdf da proposta 4725', 'traga o link da proposta', 'quais propostas estão abertas?', 'como faço uma proposta?', 'edite a proposta 4709', 'propostas de locação']) {
      assert.equal(pedidoNovaProposta(t), false, t);
    }
  });

  it('usuário sem ERP: não oferece criar proposta', async () => {
    const r = await handleChat({ mensagens: [u('pode gerar uma proposta?')] }, deps({ user: CRM_ONLY }));
    assert.match(String(r.body.texto), /não tem acesso ao módulo ERP/);
    assert.equal(toolDefinitionsFor(CRM_ONLY).some((t) => t.function.name === 'criar_rascunho_proposta'), false);
  });
});

describe('assistente — depois do tipo, os campos certos de cada tipo', () => {
  const resposta = (r: string) => fluxoNovaProposta([u('pode gerar uma proposta?'), a(PERGUNTA_TIPO_PROPOSTA), u(r)], ALL) || '';

  it('locação: prazo em meses, mensalidade, setup/ativação separado, índice de reajuste, pagamento', () => {
    for (const r of ['4', 'locação', 'Locação', 'aluguel']) {
      const t = resposta(r);
      assert.match(t, /^Proposta de Locação\. Me passe:/, r);
      assert.match(t, /Prazo do contrato em meses/);
      assert.match(t, /Mensalidade/);
      assert.match(t, /Setup \/ ativação: valor único, cobrado à parte da mensalidade/);
      assert.match(t, /Índice de reajuste: IPCA, IGP-M, IST \(Anatel\) ou fixo/);
      assert.match(t, /Forma de pagamento: Boleto, Pix ou Ted \/ Transferência/);
      assert.doesNotMatch(t, /Frete|cart[aã]o/i);
    }
  });

  it('serviço sem modo: pergunta pontual ou mensal; depois pede os campos do modo', () => {
    assert.equal(resposta('serviços'), PERGUNTA_SERVICO_MODO);
    const hist = [u('pode gerar uma proposta?'), a(PERGUNTA_TIPO_PROPOSTA), u('serviço'), a(PERGUNTA_SERVICO_MODO)];
    const pontual = fluxoNovaProposta([...hist, u('pontual')], ALL) || '';
    assert.match(pontual, /^Proposta de Serviços — pontual \(pagamento único\)\. Me passe:/);
    assert.match(pontual, /Valor do serviço \(pagamento único\)/);
    assert.doesNotMatch(pontual, /meses|reajuste|Mensalidade/);
    const mensal = fluxoNovaProposta([...hist, u('mensal')], ALL) || '';
    assert.match(mensal, /^Proposta de Serviços — mensal\. Me passe:/);
    assert.match(mensal, /Prazo do contrato em meses/);
    assert.match(mensal, /Valor mensal/);
    assert.match(mensal, /Índice de reajuste/);
  });

  it('números 2 e 3 escolhem serviço pontual e mensal', () => {
    assert.match(resposta('2'), /Serviços — pontual/);
    assert.match(resposta('3'), /Serviços — mensal/);
  });

  it('produtos: itens, quantidades, valor, frete e prazo de entrega', () => {
    const t = resposta('1');
    assert.match(t, /^Proposta de Produtos \(venda\)\. Me passe:/);
    assert.match(t, /Itens: descrição e quantidade/);
    assert.match(t, /Frete/);
    assert.match(t, /Prazo de entrega/);
    assert.match(t, /Boleto, Pix ou Ted \/ Transferência/);
    assert.doesNotMatch(t, /reajuste|Setup/);
  });

  it('pedido já com o tipo e sem dados ("quero uma proposta de locação"): pula a pergunta do tipo', async () => {
    const r = await handleChat({ mensagens: [u('quero uma proposta de locação')] }, deps());
    assert.match(String(r.body.texto), /^Proposta de Locação\. Me passe:/);
    const s = await handleChat({ mensagens: [u('gera uma proposta de serviço')] }, deps());
    assert.equal(s.body.texto, PERGUNTA_SERVICO_MODO);
  });

  it('a resposta aos campos vai ao modelo (não vira consulta de contratos/produtos)', async () => {
    const l = llm(undefined, 'ok');
    const hist = [u('pode gerar uma proposta?'), a(PERGUNTA_TIPO_PROPOSTA), u('locação'), a(fluxoNovaProposta([u('pode gerar uma proposta?'), a(PERGUNTA_TIPO_PROPOSTA), u('locação')], ALL)!), u('Alfa, 3 equipamentos Dell R640, 36 meses, 1.500,00 por mês, setup 800, IPCA, boleto')];
    const r = await handleChat({ mensagens: hist }, deps({ llm: l }));
    assert.equal(l.calls, 1);
    assert.equal(r.body.tipo, 'texto');
  });
});

describe('assistente — ferramenta de criação exige o tipo', () => {
  it('schema: tipo_proposta obrigatório e forma de pagamento só boleto/pix/ted', () => {
    const def = toolDefinitionsFor(ALL).find((t) => t.function.name === 'criar_rascunho_proposta')!;
    const p = def.function.parameters as any;
    assert.ok(p.required.includes('tipo_proposta'));
    assert.deepEqual(p.properties.tipo_proposta.enum, ['produtos', 'servico_pontual', 'servico_mensal', 'locacao']);
    assert.deepEqual(p.properties.forma_pagamento.enum, ['boleto', 'pix', 'ted']);
    assert.equal(p.properties.itens.items.properties.tipo, undefined);
    const tool = getTool('criar_rascunho_proposta')!;
    assert.equal(tool.schema.safeParse({ cliente: 'Alfa', itens: [{ descricao: 'x', quantidade: 1 }] }).success, false);
    assert.equal(tool.schema.safeParse({ cliente: 'Alfa', tipo_proposta: 'produtos', itens: [{ descricao: 'x', quantidade: 1 }], forma_pagamento: 'cartao' }).success, false);
    assert.equal(tool.schema.safeParse({ cliente: 'Alfa', tipo_proposta: 'locacao', itens: [{ descricao: 'x', quantidade: 1 }] }).success, false, 'locação sem prazo');
    assert.equal(tool.schema.safeParse({ cliente: 'Alfa', tipo_proposta: 'locacao', prazo_meses: 36, itens: [{ descricao: 'x', quantidade: 1 }] }).success, true);
  });

  it('modelo chama sem tipo e o usuário não disse: pergunta o tipo, sem cartão', async () => {
    const { api, calls } = fakeApi();
    const l = llm({ name: 'criar_rascunho_proposta', args: { cliente: 'Alfa', itens: [{ descricao: 'Switch', quantidade: 2 }] } });
    const r = await handleChat({ mensagens: [u('para a Alfa: 2 switches')] }, deps({ api, llm: l }));
    assert.equal(r.body.tipo, 'texto');
    assert.equal(r.body.texto, PERGUNTA_TIPO_PROPOSTA);
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
  });

  it('modelo esquece o tipo que o usuário já escolheu: usa o da conversa (nunca chuta)', () => {
    assert.equal(tipoPropostaDaConversa([u('pode gerar uma proposta?'), a(PERGUNTA_TIPO_PROPOSTA), u('4'), a('Proposta de Locação. Me passe:'), u('Alfa, 2 servidores')]), 'locacao');
    assert.equal(tipoPropostaDaConversa([u('pode gerar uma proposta?'), a(PERGUNTA_TIPO_PROPOSTA), u('serviço'), a(PERGUNTA_SERVICO_MODO), u('mensal')]), 'servico_mensal');
    assert.equal(tipoPropostaDaConversa([u('contratos de locação'), a('...'), u('gere uma proposta'), a(PERGUNTA_TIPO_PROPOSTA), u('Alfa, 2 servidores')]), null);
    assert.equal(tipoPropostaNoTexto('serviço de instalação avulso'), 'servico_pontual');
    assert.equal(tipoPropostaNoTexto('suporte mensal por 12 meses'), 'servico_mensal');
  });

  it('cartão é recusado com as três formas aceitas', async () => {
    const l = llm({ name: 'criar_rascunho_proposta', args: { cliente: 'Alfa', tipo_proposta: 'produtos', itens: [{ descricao: 'Switch', quantidade: 2 }], forma_pagamento: 'cartão de crédito' } });
    const r = await handleChat({ mensagens: [u('gere uma proposta de produtos para a Alfa, 2 switches, no cartão')] }, deps({ llm: l }));
    assert.match(String(r.body.texto), /não aceita cartão.*Boleto, Pix ou Ted \/ Transferência/);
  });

  it('locação: cartão de confirmação com setup à parte, reajuste e pagamento; Confirmar grava o rascunho certo', async () => {
    const { api, calls } = fakeApi();
    const l = llm({
      name: 'criar_rascunho_proposta',
      args: { cliente: 'Alfa', tipo_proposta: 'Locação', prazo_meses: '36', itens: [{ descricao: 'Servidor Dell R640', quantidade: '3', valor_unitario: '1.500,00' }], setup: '800,00', indice_reajuste: 'igpm', forma_pagamento: 'Pix' },
    });
    const d = deps({ api, llm: l });
    const r = await handleChat({ mensagens: [u('gere uma proposta de locação de 36 meses para a Alfa de 3 servidores Dell R640 a 1.500,00 por mês, setup 800,00, IGP-M, pix')] }, d);
    assert.equal(r.body.tipo, 'proposta');
    const card = r.body.proposta as any;
    const linhas = card.linhas.join('\n');
    assert.match(linhas, /Tipo: Locação/);
    assert.match(linhas, /Prazo: 36 meses/);
    assert.match(linhas, /Mensalidade: R\$\s?4\.500,00/);
    assert.match(linhas, /Setup \/ ativação: R\$\s?800,00 \(pagamento único, à parte da mensalidade\)/);
    assert.match(linhas, /Índice de reajuste: IGP-M/);
    assert.match(linhas, /Forma de pagamento: Pix/);
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0, 'nada grava antes do Confirmar');
    const ok = await handleExecute({ token: card.token, confirmar: true }, d);
    assert.equal(ok.body.ok, true);
    const post = calls.find((c) => c.method === 'POST')!;
    const b = post.body as any;
    assert.equal(b.status, 'RASCUNHO');
    assert.equal(b.budgetType, 'LOCACAO');
    assert.equal(b.contractMonths, 36);
    assert.equal(b.setupFee, 800);
    assert.equal(b.readjustmentIndex, 'IGP-M');
    assert.equal(b.items[0].unitPrice, 1500, 'mensalidade sem o setup somado');
    assert.equal(b.items[0].isRecurring, true);
    assert.equal(b.items[0].fiscalNature, 'LOCACAO_BENS_MOVEIS');
    assert.ok(b.installments.every((i: any) => i.paymentMethod === 'PIX'));
    assert.ok(b.installments.some((i: any) => i.amount === 800 && /pagamento único/.test(i.notes)));
    assert.ok(b.installments.some((i: any) => i.amount === 4500));
    const again = await handleExecute({ token: card.token, confirmar: true }, d);
    assert.equal(again.status, 409);
  });

  it('serviço pontual: SERVICOS de 1 mês (pagamento único), sem reajuste nem setup', () => {
    const b = corpoRascunhoProposta(
      getTool('criar_rascunho_proposta')!.coagir!({ cliente: 'Alfa', tipo_proposta: 'servico_pontual', prazo_meses: 12, indice_reajuste: 'IPCA', itens: [{ descricao: 'Configuração de firewall', quantidade: 1, valor_unitario: 2500 }], forma_pagamento: 'ted' }),
      EMPRESA, AGORA,
    ) as any;
    assert.equal(b.budgetType, 'SERVICOS');
    assert.equal(b.contractMonths, 1);
    assert.equal(b.readjustmentIndex, undefined);
    assert.equal(b.setupFee, 0);
    assert.equal(b.items[0].itemType, 'SERVICE');
    assert.equal(b.installments[0].paymentMethod, 'TED');
    assert.equal(b.installments[0].amount, 2500);
    assert.match(b.paymentCondition, /Pagamento único|Ted \/ Transferência/);
  });

  it('serviço mensal: SERVICOS com prazo, valor mensal e reajuste padrão IPCA', () => {
    const b = corpoRascunhoProposta({ cliente: 'Alfa', tipo_proposta: 'servico_mensal', prazo_meses: 12, itens: [{ descricao: 'Suporte técnico', quantidade: 1, valor_unitario: 900 }] }, EMPRESA, AGORA) as any;
    assert.equal(b.budgetType, 'SERVICOS');
    assert.equal(b.contractMonths, 12);
    assert.equal(b.readjustmentIndex, 'IPCA');
    assert.equal(b.installments[0].paymentMethod, 'BOLETO');
  });

  it('produtos: venda (não recorrente) com frete, prazo de entrega e itens a definir sem parcelas zeradas', () => {
    const b = corpoRascunhoProposta({ cliente: 'Alfa', tipo_proposta: 'produtos', itens: [{ descricao: 'Switch 24p', quantidade: 2 }], frete: 150, prazo_entrega: '10 dias úteis', forma_pagamento: 'boleto' }, EMPRESA, AGORA) as any;
    assert.equal(b.budgetType, 'PRODUTOS');
    assert.equal(b.contractMonths, 1);
    assert.equal(b.items[0].isRecurring, false);
    assert.equal(b.items[0].fiscalNature, 'VENDA_EQUIPAMENTO');
    assert.equal(b.shippingCost, 150);
    assert.equal(b.deliveryLeadTime, '10 dias úteis');
    assert.equal(b.installments, undefined);
    assert.match(b.paymentCondition, /^Boleto/);
    assert.equal(b.readjustmentIndex, undefined);
  });
});

describe('assistente — base de conhecimento dos tipos de proposta', () => {
  it('explica os tipos, os campos de cada um e as formas de pagamento', () => {
    const kb = buscarConhecimento('quais os tipos de proposta?', 3);
    assert.ok(kb);
    const t = kb!.entrada.resposta;
    for (const s of ['Produtos', 'Serviços pontual', 'Serviços mensal', 'Locação', 'setup/ativação cobrado à parte', 'índice de reajuste', 'Boleto, Pix ou Ted / Transferência', 'pergunto o tipo']) assert.ok(t.includes(s), s);
    assert.doesNotMatch(t, /Locação Pura|cartão/i);
  });
});
