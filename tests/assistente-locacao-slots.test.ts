// ============================================================================
// STI-hub — Assistente: rascunho de LOCAÇÃO com estado na conversa (t195u, 27/11/2026).
// Conversa real (print do Marcéllo): "gere uma proposta para a MK Jacuipe de locação de um cabo
// stack cisco de 1m por 24 meses no valor de 45,00/m6es" → (repetido) → "IGP-M" → "boleto".
// Antes: a IA repetia a mesma pergunta e "boleto" abria "Consultar faturas" (236 faturas).
// Agora: o rascunho (Locação, MK BR S.A de Conceição do Jacuípe, STACK-T1-1M, 24 meses,
// R$ 45,00/mês) fica no estado da conversa; respostas curtas preenchem o que falta.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ApiCaller, ApiCallRequest, AssistenteUser } from '../src/modules/assistente/tools';
import { handleChat, handleExecute, type AssistenteDeps } from '../src/modules/assistente/service';
import { buscarModelos, lerLinha, normalizarMensal, normalizarProduto, respostaCurtaDeCampo, termoProduto, type FluxoProposta } from '../src/modules/assistente/fluxo-proposta';
import { MemoryAssistenteStore, REGRAS_ACESSORIOS_PADRAO, type RegraAcessorio } from '../src/modules/assistente/conversas-store';
import { DIALOGOS_PROPOSTA, exemplosDialogoParaPrompt } from '../src/modules/assistente/treinamento';
import { buscarConhecimento, responderConhecimento } from '../src/modules/assistente/conhecimento';
import { foldTexto } from '../src/modules/assistente/identificadores';
import type { LlmClient } from '../src/modules/assistente/omniroute-client';

const AGORA = Date.parse('2026-11-27T12:00:00-03:00');
const USER: AssistenteUser = { uid: 'usr-marcello', email: 'm@seta.test', name: 'Marcéllo', roleId: 'SUPER_ADMIN', moduleAccess: { crm: true, erp: true, chamados: true } };
const p = (codigo: string, nome: string, venda = 0, estoque = 0, loc = 0) => ({ id: `p-${codigo}`, gestaoClickCode: codigo, name: nome, saleOrSetupPrice: venda, monthlyRentalPrice: loc, stockAvailable: estoque, isActive: true });

// Recorte real do cadastro (conferido em 27/11/2026).
const CATALOGO = [
  p('STACK-T1-1M', 'STACK-T1-1M - Cisco StackWise-480 1m stacking cable for Cisco Catalyst 3850 Series', 0, 2),
  p('STACK-T1-50CM', 'STACK-T1-50CM - Cisco Stackwise-480 Stacking Cable, 50CM, For Cisco Catalyst 3850', 0, 3),
  p('CAB-STACK-50CM (CABO STACK 3750)', 'CAB-STACK-50CM - Cisco 3750 StackWise Cables CAB-STACK-50CM Cisco StackWise 50CM Stacking', 0, 12),
  p('STACK-T3-3M', 'STACK-T3-3M -3 m stacking cable for C9300L Series Switches', 0, -1),
  p('CAB-SPWR-30CM', 'CAB-SPWR-30CM - Catalyst Stack Power Cable 30cm', 0, 2),
  p('CAB-STK-E-0.5M', 'CAB-STK-E-0.5M - Cisco FlexStack Stacking Cables for Catalyst 2960-S,2960-X, 2960-XR Series', 0, 0),
  p('WS-C3850-48F-S', 'WS-C3850-48F-S - Stackable 48 10/100/1000 Ethernet PoE+ ports.', 0, 4, 375),
  p('WS-C3850-48P-S', 'WS-C3850-48P-S - Stackable 48 10/100/1000 Ethernet PoE+ ports.', 3596.52, 2),
  p('PWR-C1-1100WAC', 'PWR-C1-1100WAC - 1100W AC Config 1 Power Supply', 0, 72),
  p('GLC-SX-MMD', 'GLC-SX-MMD - Cisco GLC-SX-MMD 1000BASE-SX SFP transceiver module, MMF, 850nm, DOM', 0, 10),
  p('SFP-10G-SR', 'SFP-10G-SR - 10GBASE-SR SFP+ module for MMF', 0, 1),
  p('WS-G5486', 'WS-G5486 - GBIC de longa distância 1000BASE-LX/LH (monomodo ou multimodo)', 0, 1),
];
// Cadastro real de empresas: MK BR S.A tem duas unidades em Conceição do Jacuípe (BA) e uma em Manaus.
const MK_MATRIZ = { id: 'comp-gc-44332070', name: 'MK BR S.A', cnpj: '07.666.567/0001-40', city: 'Conceição do Jacuípe', state: 'BA' };
const MK_FILIAL = { id: 'comp-gc-41979068', name: 'MK BR S.A', cnpj: '07.666.567/0002-21', city: 'Conceição do Jacuípe', state: 'BA' };
const MK_MANAUS = { id: 'comp-gc-41923689', name: 'MK BR S.A', cnpj: '07.666.567/0007-36', city: 'Manaus', state: 'AM' };
const JACUZZI = { id: 'comp-gc-4977832', name: 'JACUZZI DO BRASIL INDUSTRIA E COMERCIO LTDA', cnpj: '59.105.007/0001-10', city: 'Itu', state: 'SP' };
const FOXCONN = { id: 'co-fox', name: 'FOXCONN BRASIL INDUSTRIA E COMERCIO LTDA', cnpj: '08.513.212/0001-30', city: 'Jundiaí', state: 'SP' };
const EMPRESAS = [MK_MATRIZ, MK_FILIAL, MK_MANAUS, JACUZZI, FOXCONN];

const PEDIDO = 'gere uma proposta para a MK Jacuipe de locação de um cabo stack cisco de 1m por 24 meses no valor de 45,00/m6es';

function fakeApi(empresas: any[] = EMPRESAS) {
  const calls: ApiCallRequest[] = [];
  const api: ApiCaller = async (r) => {
    calls.push(r);
    const k = `${r.method} ${r.path.split('?')[0]}`;
    if (k === 'GET /api/companies') return { status: 200, body: { data: empresas } };
    if (k === 'GET /api/erp/catalog') return { status: 200, body: { data: CATALOGO } };
    if (k === 'GET /api/erp/invoices') return { status: 200, body: { data: Array.from({ length: 236 }, (_, i) => ({ id: `f${i}` })) } };
    if (k === 'POST /api/erp/proposals') return { status: 201, body: { data: { id: 'prop-mk1', code: '4890', status: 'RASCUNHO', ...(r.body as any) } } };
    return { status: 404, body: { error: 'nao encontrado' } };
  };
  return { api, calls };
}

/** Modelo que reproduz o erro do print: se for chamado, pede consulta de faturas. */
function llmQueNaoDeveSerChamado(): LlmClient & { calls: number } {
  const o = { calls: 0, async complete() { o.calls += 1; return { text: '', toolCalls: [{ name: 'consultar', args: { entidade: 'faturas' } }], model: 't' }; } };
  return o as any;
}

function deps(api: ApiCaller, store = new MemoryAssistenteStore()) {
  const nonces = new Set<string>();
  const llm = llmQueNaoDeveSerChamado();
  return {
    llm, api, user: USER, secret: 'segredo-de-teste-locacao-slots-0123456789', sid: 's1', now: () => AGORA,
    async rateLimit() { return true; },
    async consumeNonce(n: string) { if (nonces.has(n)) return false; nonces.add(n); return true; },
    async audit() {},
    aprendizado: {
      listarMemorias: () => store.listarMemorias(USER.uid),
      criarMemoria: (m: any) => store.criarMemoria(USER.uid, m),
      listarRegras: () => store.listarRegras(),
    },
  } as AssistenteDeps & { llm: ReturnType<typeof llmQueNaoDeveSerChamado> };
}

type M = { papel: 'usuario' | 'assistente'; texto: string };

/** Simula o painel: histórico + estado do fluxo entre as mensagens (persistido na conversa). */
function conversa(d: AssistenteDeps, inicio: { mensagens?: M[]; fluxo?: FluxoProposta | null } = {}) {
  const mensagens: M[] = [...(inicio.mensagens || [])];
  let fluxo: FluxoProposta | null = inicio.fluxo ?? null;
  return {
    mensagens,
    get fluxo() { return fluxo; },
    async diz(texto: string, selecao?: unknown) {
      mensagens.push({ papel: 'usuario', texto });
      const r = await handleChat({ mensagens, fluxo, ...(selecao ? { selecao } : {}) }, d);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      fluxo = (r.body.fluxo as FluxoProposta) ?? null;
      mensagens.push({ papel: 'assistente', texto: String(r.body.texto || (r.body as any).proposta?.titulo || r.body.tipo) });
      return r.body as any;
    },
  };
}

const semFaturas = (calls: ApiCallRequest[]) => assert.ok(!calls.some((x) => x.path.startsWith('/api/erp/invoices')), 'nunca consulta faturas');

function confereCartaoMk(r: any, forma = 'Boleto', indice = 'IGP-M') {
  assert.equal(r.tipo, 'proposta', JSON.stringify(r));
  const linhas: string[] = r.proposta.linhas;
  const txt = linhas.join('\n');
  assert.ok(linhas.some((l) => l.startsWith('Tipo: Locação')), txt);
  assert.ok(linhas.some((l) => /^Cliente: MK BR S\.A/.test(l)), txt);
  assert.ok(linhas.some((l) => /^1 x STACK-T1-1M .* a R\$\s?45,00\/mês$/.test(l)), txt);
  assert.ok(linhas.includes('Prazo: 24 meses'), txt);
  assert.ok(linhas.some((l) => l.startsWith(`Índice de reajuste: ${indice}`)), txt);
  assert.ok(linhas.some((l) => l.startsWith(`Forma de pagamento: ${forma}`)), txt);
}

describe('t195u — conversa da MK Jacuípe (locação) reproduzida exatamente', () => {
  it('pedido → pedido repetido → "IGP-M" → "boleto" → escolha da unidade: cartão de Locação com tudo, sem faturas', async () => {
    const { api, calls } = fakeApi();
    const d = deps(api);
    const c = conversa(d);

    // 1) Pedido completo: tudo anotado; só falta a unidade da MK BR S.A (2 CNPJs em Conceição do Jacuípe).
    const r1 = await c.diz(PEDIDO);
    assert.equal(r1.tipo, 'escolha_cliente', JSON.stringify(r1));
    assert.match(r1.texto, /24 meses/);
    assert.match(r1.texto, /R\$\s?45,00\/mês/);
    assert.deepEqual(r1.opcoes.map((o: any) => o.cnpj).sort(), ['07.666.567/0001-40', '07.666.567/0002-21'], 'Manaus e Jacuzzi ficam fora');
    assert.doesNotMatch(r1.texto, /forma de pagamento|reajuste/i, 'não pergunta o que tem padrão');
    assert.equal(c.fluxo?.tipo, 'locacao');
    assert.equal(c.fluxo?.prazoMeses, 24);
    assert.equal(c.fluxo?.itens[0]?.codigo, 'STACK-T1-1M');
    assert.equal(c.fluxo?.itens[0]?.valor, 45);

    // 2) Mesmo pedido de novo: reaproveita o rascunho e pergunta só a unidade.
    const r2 = await c.diz(PEDIDO);
    assert.equal(r2.tipo, 'escolha_cliente');
    assert.match(r2.texto, /reaproveitei o rascunho/);
    assert.equal(c.fluxo?.itens.length, 1);

    // 3) "IGP-M" e 4) "boleto": preenchem o rascunho, nunca viram consulta.
    const r3 = await c.diz('IGP-M');
    assert.equal(r3.tipo, 'escolha_cliente');
    assert.match(r3.texto, /reajuste IGP-M/);
    const r4 = await c.diz('boleto');
    assert.equal(r4.tipo, 'escolha_cliente');
    assert.match(r4.texto, /pagamento Boleto/);
    assert.equal(c.fluxo?.indice, 'IGP-M');
    assert.equal(c.fluxo?.forma, 'boleto');

    // 5) Escolhe a unidade (número da lista): cartão de confirmação completo.
    const r5 = await c.diz('1');
    confereCartaoMk(r5);
    assert.equal(d.llm.calls, 0, 'nada vai ao modelo');
    semFaturas(calls);
    assert.ok(!calls.some((x) => x.method === 'POST'), 'nada gravado antes do Confirmar');

    // Confirmar: grava a Locação com o item do cadastro e mostra os links do rascunho.
    const ex = await handleExecute({ token: r5.proposta.token, confirmar: true }, d);
    assert.equal(ex.status, 200, JSON.stringify(ex.body));
    const body = calls.find((x) => x.method === 'POST' && x.path === '/api/erp/proposals')?.body as any;
    assert.equal(body.budgetType, 'LOCACAO');
    assert.equal(body.items[0].sku, 'STACK-T1-1M');
    assert.equal(body.items[0].unitPrice, 45);
    assert.equal(body.contractMonths, 24);
    assert.equal(body.readjustmentIndex, 'IGP-M');
    assert.match(body.paymentCondition, /Boleto/);
    assert.ok([MK_MATRIZ.id, MK_FILIAL.id].includes(body.companyId), 'uma unidade só (Trava Fiscal)');
    const acoes = (ex.body as any).acoes as any[];
    assert.ok(acoes.some((a) => a.tipo === 'versao_contrato'), 'link da Versão contrato');
    assert.ok(acoes.some((a) => a.tipo === 'abrir'));
    assert.ok(!acoes.some((a) => a.tipo === 'link_cliente_proposta'), 'link do cliente de rascunho não é emitido no chat');
  });

  it('cliente único: o pedido já sai no cartão; "IGP-M", "boleto", "pix", "ted", "IPCA", "sim" e número ajustam sem trocar de intenção', async () => {
    const { api, calls } = fakeApi([MK_MATRIZ, MK_MANAUS, JACUZZI]);
    const d = deps(api);
    const c = conversa(d);
    const r1 = await c.diz(PEDIDO);
    confereCartaoMk(r1, 'Boleto', 'IPCA');
    assert.ok(r1.proposta.linhas.some((l: string) => /IPCA \(padrão\)/.test(l)));
    confereCartaoMk(await c.diz('IGP-M'), 'Boleto', 'IGP-M');
    confereCartaoMk(await c.diz('pix'), 'Pix', 'IGP-M');
    confereCartaoMk(await c.diz('ted'), 'Ted', 'IGP-M');
    confereCartaoMk(await c.diz('boleto'), 'Boleto', 'IGP-M');
    confereCartaoMk(await c.diz('IPCA'), 'Boleto', 'IPCA');
    confereCartaoMk(await c.diz('sim'), 'Boleto', 'IPCA');
    const n = await c.diz('36');
    assert.equal(n.tipo, 'texto');
    assert.match(n.texto, /para qual campo/);
    assert.equal(c.fluxo?.prazoMeses, 24, 'número solto não muda o prazo sozinho');
    const m = await c.diz('36 meses');
    assert.equal(m.tipo, 'proposta');
    assert.ok(m.proposta.linhas.includes('Prazo: 36 meses'));
    const rep = await c.diz(PEDIDO);
    assert.equal(rep.tipo, 'proposta', 'pedido repetido reaproveita o rascunho');
    assert.match(rep.texto, /reaproveitei o rascunho/);
    assert.equal(d.llm.calls, 0);
    semFaturas(calls);
  });

  it('conversa reaberta sem o estado (ou de quando ia ao modelo): "IGP-M" e "boleto" remontam o rascunho pelo histórico', async () => {
    const { api, calls } = fakeApi([MK_MATRIZ, JACUZZI]);
    const d = deps(api);
    const pergunta = 'Qual a forma de pagamento: Boleto, Pix ou Ted / Transferência? Vou usar IPCA como índice de reajuste, salvo se quiser outro (IGP-M, IST Anatel ou fixo).';
    const historico: M[] = [
      { papel: 'usuario', texto: PEDIDO },
      { papel: 'assistente', texto: pergunta },
      { papel: 'usuario', texto: PEDIDO },
      { papel: 'assistente', texto: pergunta },
      { papel: 'usuario', texto: 'IGP-M' },
      { papel: 'assistente', texto: 'Forma de pagamento: Boleto, Pix ou Ted / Transferência? (padrão boleto)' },
    ];
    const c = conversa(d, { mensagens: historico, fluxo: null });
    const r = await c.diz('boleto');
    confereCartaoMk(r, 'Boleto', 'IGP-M');
    assert.equal(d.llm.calls, 0);
    semFaturas(calls);
  });

  it('depois de várias rodadas e reabrindo a conversa com o estado salvo, continua do mesmo ponto', async () => {
    const { api } = fakeApi();
    const d = deps(api);
    const c1 = conversa(d);
    await c1.diz(PEDIDO);
    await c1.diz('IGP-M');
    // "Reabre": novo painel com o histórico e o fluxo persistidos na conversa (JSON ida e volta).
    const salvo = JSON.parse(JSON.stringify(c1.fluxo));
    const c2 = conversa(d, { mensagens: c1.mensagens, fluxo: salvo });
    const r = await c2.diz('pix');
    assert.equal(r.tipo, 'escolha_cliente');
    const fim = await c2.diz('Escolhida', { tipo: 'cliente', indice: 0 });
    confereCartaoMk(fim, 'Pix', 'IGP-M');
    assert.equal(d.llm.calls, 0);
  });

  it('pedido novo de verdade troca de intenção ("liste as faturas vencidas")', async () => {
    const { api } = fakeApi([MK_MATRIZ]);
    const d = deps(api);
    const c = conversa(d);
    await c.diz(PEDIDO);
    const mensagens: M[] = [...c.mensagens, { papel: 'usuario', texto: 'liste as faturas vencidas' }];
    const r = await handleChat({ mensagens, fluxo: c.fluxo }, d);
    assert.notEqual((r.body as any).tipo, 'escolha_cliente');
    assert.ok(!(r.body as any).fluxo || (r.body as any).tipo !== 'proposta');
  });
});

describe('t195u — entendimento robusto (valor, prazo, tipo, item)', () => {
  const variacoes: Array<[string, number]> = [
    ['no valor de 45,00/mês', 45], ['no valor de 45,00/mes', 45], ['no valor de 45,00/m6es', 45], ['45,00 mensal', 45],
    ['R$ 45,00 por mês', 45], ['R$45,00/mês', 45], ['mensalidade de 1.250,50', 1250.5], ['45 reais por mês', 45],
  ];
  for (const [trecho, valor] of variacoes) {
    it(`"${trecho}" = R$ ${valor} por mês; "por 24 meses" = prazo; "de locação" = Locação; "cabo stack 1m" = item`, () => {
      const s = lerLinha(`gere uma proposta para a MK Jacuipe de locação de um cabo stack cisco de 1m por 24 meses ${trecho}`);
      assert.equal(s.tipo, 'locacao');
      assert.equal(s.prazoMeses, 24);
      assert.equal(s.valor, valor);
      assert.equal(s.cliente, 'MK Jacuipe');
      assert.equal(s.termo, 'cabo stack 1m');
      assert.equal(s.quantidade, undefined, '"1m" é medida, não quantidade');
    });
  }

  it('normalizarMensal cobre "/mês", "/mes", "/m6es", "p/ mês", "ao mês", "mensal"', () => {
    for (const x of ['45,00/mes', '45,00 / m6es', '45,00/mensal', '45 mensal']) assert.match(normalizarMensal(foldTexto(x)), /45(,00)? por mes/, x);
    assert.match(normalizarMensal(foldTexto('45 p/ mês')), /por mes/);
    assert.match(normalizarMensal(foldTexto('45 ao mês')), /por mes/);
    assert.doesNotMatch(normalizarMensal(foldTexto('por 24 meses')), /por mes\b/, 'prazo não vira mensalidade');
  });

  it('"cabo stack" é acessório de switch: acha só o STACK-T1-1M no cadastro; sinônimos SFP/GBIC/fonte', () => {
    const cat = CATALOGO.map(normalizarProduto).filter(Boolean) as any[];
    const regras: RegraAcessorio[] = REGRAS_ACESSORIOS_PADRAO.map((r, i) => ({ ...r, id: `r${i}` })) as any;
    assert.equal(termoProduto('locação de um cabo stack cisco de 1m'), 'cabo stack 1m');
    assert.deepEqual(buscarModelos(cat, 'cabo stack 1m', regras).map((x) => x.codigo), ['STACK-T1-1M']);
    assert.ok(buscarModelos(cat, 'cabo stack', regras).length >= 4, 'sem medida: lista os cabos stack para escolher');
    assert.deepEqual(buscarModelos(cat, 'gbic', regras).map((x) => x.codigo).sort(), ['GLC-SX-MMD', 'SFP-10G-SR', 'WS-G5486'].sort());
    assert.deepEqual(buscarModelos(cat, 'fonte 1100w', regras).map((x) => x.codigo), ['PWR-C1-1100WAC']);
    assert.deepEqual(buscarModelos(cat, 'cabo stackpower', regras).map((x) => x.codigo), ['CAB-SPWR-30CM']);
  });

  it('respostas curtas reconhecidas como campo do rascunho', () => {
    for (const x of ['boleto', 'pix', 'ted', 'IGP-M', 'IPCA', 'sim', '24', '24 meses', 'frete incluso']) assert.ok(respostaCurtaDeCampo(x), x);
    for (const x of ['liste as faturas vencidas', 'gere uma proposta de venda para a Foxconn', 'faturas em aberto']) assert.ok(!respostaCurtaDeCampo(x), x);
  });
});

describe('t195u — diálogos de treinamento (few-shot) rodam no fluxo real', () => {
  for (const dlg of DIALOGOS_PROPOSTA) {
    it(`${dlg.id}: ${dlg.titulo}`, async () => {
      const { api, calls } = fakeApi(dlg.id === 'locacao-mk-jacuipe' ? EMPRESAS : [FOXCONN]);
      const d = deps(api);
      const c = conversa(d);
      let r: any;
      for (const t of dlg.turnos) {
        r = await c.diz(t.usuario);
        if (r.tipo === 'escolha_produto') r = await c.diz(`Modelo: ${dlg.final.codigo}`, { tipo: 'modelo', codigo: dlg.final.codigo });
      }
      if (r.tipo === 'sugestao_acessorios') r = await c.diz('seguir sem acessórios');
      assert.equal(r.tipo, 'proposta', `${dlg.id}: ${JSON.stringify(r)}`);
      const f = c.fluxo!;
      assert.equal(f.tipo, dlg.final.tipo);
      assert.equal(f.itens[0].codigo, dlg.final.codigo);
      assert.equal(f.itens[0].quantidade, dlg.final.quantidade);
      if (dlg.final.valor !== undefined) assert.equal(f.itens[0].valor, dlg.final.valor);
      if (dlg.final.prazoMeses) assert.equal(f.prazoMeses, dlg.final.prazoMeses);
      if (dlg.final.forma) assert.equal(f.forma ?? 'boleto', dlg.final.forma);
      if (dlg.final.indice) assert.equal(f.indice ?? 'IPCA', dlg.final.indice);
      if (dlg.final.freteIncluso) assert.equal(f.freteIncluso, true);
      assert.equal(d.llm.calls, 0);
      semFaturas(calls);
    });
  }

  it('os exemplos entram no prompt do modelo, sem dados sensíveis', () => {
    const t = exemplosDialogoParaPrompt();
    assert.match(t, /MK Jacuipe/);
    assert.match(t, /nunca transforme "boleto"/);
    assert.doesNotMatch(t, /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/, 'sem CNPJ no prompt');
  });
});

describe('t195u — base de conhecimento ampliada (dados reais do sistema)', () => {
  const casos: Array<[string, string, RegExp]> = [
    ['o que é cabo stack?', 'glossario-rede', /STACK-T1-1M/],
    ['qual o código do gbic?', 'glossario-rede', /WS-G5486/],
    ['o que é fonte redundante do 3850?', 'glossario-rede', /PWR-C1-/],
    ['como funciona a cobrança mensal de spare parts?', 'tipos-orcamento-cobranca', /Spare Parts/],
    ['posso parcelar orçamento de produtos?', 'tipos-orcamento-cobranca', /parcelas/],
    ['quais os índices de reajuste?', 'indices-reajuste', /IGP-M/],
    ['qual a validade padrão da proposta?', 'validade-padrao', /15 dias/],
    ['locação tem ISS?', 'recibo-locacao-iss', /0% ISS/],
    ['como continuar a proposta respondendo curto?', 'proposta-pelo-assistente', /boleto/],
  ];
  for (const [q, id, re] of casos) {
    it(`"${q}" → ${id}`, () => {
      const r = buscarConhecimento(q);
      assert.equal(r?.entrada.id, id, `${q} => ${r?.entrada.id}`);
      assert.match(responderConhecimento(q) || '', re);
    });
  }
  it('formas de pagamento continuam só Boleto, Pix e Ted (sem cartão)', () => {
    assert.match(responderConhecimento('aceita cartão?') || '', /Boleto, Pix e Ted/);
  });
});
