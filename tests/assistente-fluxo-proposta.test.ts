// ============================================================================
// STI-hub — Assistente: rascunho de proposta guiado (25/11/2026).
// t171u: "gere uma proposta de 1 switch cisco 3850" => lista dos modelos do cadastro =>
//        acessórios compatíveis (só itens reais) => cartão de confirmação.
// t172u: tipo inferido pela frase; quantidade aproveitada; valor do cadastro; frete/prazo/
//        forma com padrão, sem bloquear; cliente resolvido no cadastro.
// t173u: resposta numerada "1 Venda / 1 C3850 / 3 incluso / 4 ok / 5 Boleto" continua a
//        proposta (slot-filling) em vez de virar "Consultar faturas".
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ApiCaller, ApiCallRequest, AssistenteUser } from '../src/modules/assistente/tools';
import { handleChat, handleExecute, type AssistenteDeps } from '../src/modules/assistente/service';
import {
  buscarModelos, casaPadrao, lerResposta, normalizarProduto, sugerirAcessorios, textoMemoriaSugestao, type FluxoProposta,
} from '../src/modules/assistente/fluxo-proposta';
import { MemoryAssistenteStore, REGRAS_ACESSORIOS_PADRAO, type RegraAcessorio } from '../src/modules/assistente/conversas-store';
import { tipoPropostaNoTexto } from '../src/modules/assistente/proposta-tipo';
import type { LlmClient } from '../src/modules/assistente/omniroute-client';

const AGORA = Date.parse('2026-11-25T15:00:00-03:00');
const USER: AssistenteUser = { uid: 'usr-marcello', email: 'm@seta.test', name: 'Marcéllo', roleId: 'SUPER_ADMIN', moduleAccess: { crm: true, erp: true, chamados: true } };
const FOXCONN = { id: 'co-fox', name: 'FOXCONN BRASIL INDUSTRIA E COMERCIO LTDA', cnpj: '08.513.212/0001-30' };
const p = (codigo: string, nome: string, venda = 0, estoque = 0, loc = 0) => ({ id: `p-${codigo}`, gestaoClickCode: codigo, name: nome, saleOrSetupPrice: venda, monthlyRentalPrice: loc, stockAvailable: estoque, isActive: true });

// Recorte real do cadastro (códigos conferidos no ERP em 25/11/2026).
const CATALOGO = [
  p('WS-C3850-48P-S', 'WS-C3850-48P-S - Stackable 48 10/100/1000 Ethernet PoE+ ports.', 3596.52, 2),
  p('WS-C3850-48F-S', 'WS-C3850-48F-S - Stackable 48 10/100/1000 Ethernet PoE+ ports.', 0, 4, 375),
  p('WS-C3850-48T-L', 'WS-C3850-48T-L - Stackable 48 10/100/1000 Ethernet ports.', 0, 8),
  p('PWR-C1-1100WAC', 'PWR-C1-1100WAC - 1100W AC Config 1 Power Supply', 0, 72),
  p('PWR-C1-350WAC', 'PWR-C1-350WAC - 350W AC Config 1 Power Supply', 0, 0),
  p('PWR-C1-BLANK', 'PWR-C1-BLANK - Config 1 Power Supply Blank', 0, 3),
  p('C3850-NM-4-1G', 'C3850-NM-4-1G - 4 x Gigabit Ethernet network module spare', 0, 6),
  p('GLC-SX-MMD', 'GLC-SX-MMD - Cisco GLC-SX-MMD 1000BASE-SX SFP transceiver module, MMF, 850nm, DOM', 0, 10),
  p('GLC-FE-100 FX-RGD', 'GLC-FE-100FX-RGD - 100BASE-FX Rugged SFP for Fast Ethernet SFP Ports', 0, 5),
  p('SFP-10G-SR', 'SFP-10G-SR - 10GBASE-SR SFP+ module for MMF', 0, 1),
  p('RCKMNT-T1 C3850 C3650', 'RCKMNT-T1 - 1U rack mount for Cisco 3850 / 3650 switch, with brackets and screws.', 0, 2),
  p('PWR-C2-640WAC', 'PWR-C2-640WAC - 640 WAC power supply spare', 0, 1),
  p('ASR-920-PWR-A', 'ASR-920-PWR-A – 250W AC Power Supply for ASR-920', 0, 0),
];
const CATALOGO_UM_3850 = CATALOGO.filter((x) => x.gestaoClickCode === 'WS-C3850-48P-S' || !x.gestaoClickCode.startsWith('WS-C3850'))
  .filter((x) => !/^(PWR-C1|C3850-NM|GLC|SFP|RCKMNT)/.test(x.gestaoClickCode));

function fakeApi(catalogo = CATALOGO, empresas: any[] = [FOXCONN]) {
  const calls: ApiCallRequest[] = [];
  const api: ApiCaller = async (r) => {
    calls.push(r);
    const k = `${r.method} ${r.path.split('?')[0]}`;
    if (k === 'GET /api/companies') return { status: 200, body: { data: empresas } };
    if (k === 'GET /api/erp/catalog') return { status: 200, body: { data: catalogo } };
    if (k === 'GET /api/erp/invoices') return { status: 200, body: { data: [] } };
    if (k === 'POST /api/erp/proposals') return { status: 201, body: { data: { id: 'prop-n1', code: '4810', ...(r.body as any) } } };
    return { status: 404, body: { error: 'nao encontrado' } };
  };
  return { api, calls };
}

function llmQueNaoDeveSerChamado(): LlmClient & { calls: number } {
  const o = { calls: 0, async complete() { o.calls += 1; return { text: '', toolCalls: [{ name: 'consultar', args: { entidade: 'faturas', busca: 'c3850 incluso ok' } }], model: 't' }; } };
  return o as any;
}

function deps(api: ApiCaller, store = new MemoryAssistenteStore()): AssistenteDeps & { llm: ReturnType<typeof llmQueNaoDeveSerChamado>; store: MemoryAssistenteStore } {
  const nonces = new Set<string>();
  const llm = llmQueNaoDeveSerChamado();
  return {
    llm,
    api,
    user: USER,
    secret: 'segredo-de-teste-fluxo-proposta-0123456789',
    sid: 's1',
    now: () => AGORA,
    async rateLimit() { return true; },
    async consumeNonce(n: string) { if (nonces.has(n)) return false; nonces.add(n); return true; },
    async audit() {},
    aprendizado: {
      listarMemorias: () => store.listarMemorias(USER.uid),
      criarMemoria: (m: any) => store.criarMemoria(USER.uid, m),
      listarRegras: () => store.listarRegras(),
    },
    store,
  } as any;
}

type M = { papel: 'usuario' | 'assistente'; texto: string };

/** Simula o painel: guarda o histórico e o estado do fluxo da conversa entre as mensagens. */
function conversa(d: AssistenteDeps) {
  const mensagens: M[] = [];
  let fluxo: FluxoProposta | null = null;
  return {
    get fluxo() { return fluxo; },
    async diz(texto: string, selecao?: unknown) {
      mensagens.push({ papel: 'usuario', texto });
      const r = await handleChat({ mensagens, fluxo, ...(selecao ? { selecao } : {}) }, d);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      fluxo = (r.body.fluxo as FluxoProposta) ?? null;
      const resposta = String(r.body.texto || (r.body as any).proposta?.titulo || r.body.tipo);
      mensagens.push({ papel: 'assistente', texto: resposta });
      return r.body as any;
    },
  };
}

describe('t173u — resposta numerada continua a proposta (slot-filling)', () => {
  it('Foxconn → switch c3850 → "1 Venda / 1 C3850 / 3 incluso / 4 ok / 5 Boleto" termina no cartão de Produtos', async () => {
    const { api, calls } = fakeApi(CATALOGO_UM_3850);
    const d = deps(api);
    const c = conversa(d);

    const r1 = await c.diz('gere uma proposta de venda para a Foxconn');
    assert.equal(r1.tipo, 'texto');
    assert.doesNotMatch(r1.texto, /Qual é o tipo|qual é o tipo/i, 'venda => Produtos, sem perguntar o tipo');
    assert.match(r1.texto, /Proposta de Produtos \(venda\) para FOXCONN/);
    assert.equal(c.fluxo?.tipo, 'produtos');

    const r2 = await c.diz('switch cisco c3850');
    // Um único 3850 no cadastro: escolhido direto, sem acessórios neste recorte => cartão.
    assert.equal(r2.tipo, 'proposta', JSON.stringify(r2));

    const r3 = await c.diz('1 Venda\n1 C3850\n3 incluso\n4 ok\n5 Boleto');
    assert.equal(r3.tipo, 'proposta', JSON.stringify(r3));
    const linhas: string[] = r3.proposta.linhas;
    assert.ok(linhas.some((l) => l.startsWith('Tipo: Produtos')), linhas.join('\n'));
    assert.ok(linhas.some((l) => /^Cliente: FOXCONN BRASIL/.test(l)));
    assert.ok(linhas.some((l) => /^1 x WS-C3850-48P-S .* a R\$\s?3\.596,52$/.test(l)), linhas.join('\n'));
    assert.ok(linhas.includes('Frete: incluso (sem cobrança à parte)'), linhas.join('\n'));
    assert.ok(linhas.includes('Forma de pagamento: Boleto'), linhas.join('\n'));
    assert.ok(linhas.some((l) => /^Prazo de entrega: conforme disponibilidade/.test(l)));
    assert.equal(d.llm.calls, 0, 'nunca vai ao modelo (que inventava "Consultar faturas")');
    assert.ok(!calls.some((x) => x.path.startsWith('/api/erp/invoices')), 'não consulta faturas');
    assert.ok(!calls.some((x) => x.method === 'POST'), 'nada gravado antes do Confirmar');

    // Confirmar grava a proposta de Produtos com o código do cadastro, frete incluso e Boleto.
    const ex = await handleExecute({ token: r3.proposta.token, confirmar: true }, d);
    assert.equal(ex.status, 200);
    const post = calls.find((x) => x.method === 'POST' && x.path === '/api/erp/proposals');
    const body = post?.body as any;
    assert.equal(body.budgetType, 'PRODUTOS');
    assert.equal(body.items[0].sku, 'WS-C3850-48P-S');
    assert.equal(body.items[0].unitPrice, 3596.52);
    assert.equal(body.shippingCost, 0);
    assert.match(body.paymentCondition, /Boleto/);
    assert.match(body.internalNotes, /Frete incluso/);
  });

  it('mesma sequência com vários 3850: lista de modelos mantida, campos anotados, e o cartão sai após escolher', async () => {
    const { api } = fakeApi();
    const d = deps(api);
    const c = conversa(d);
    await c.diz('gere uma proposta de venda para a Foxconn');
    const r2 = await c.diz('switch cisco c3850');
    assert.equal(r2.tipo, 'escolha_produto');
    assert.deepEqual(r2.opcoes.map((o: any) => o.codigo).sort(), ['WS-C3850-48F-S', 'WS-C3850-48P-S', 'WS-C3850-48T-L']);
    const r3 = await c.diz('1 Venda\n1 C3850\n3 incluso\n4 ok\n5 Boleto');
    assert.equal(r3.tipo, 'escolha_produto', 'continua no fluxo (não vira consulta)');
    assert.match(r3.texto, /frete incluso/);
    assert.match(r3.texto, /pagamento Boleto/);
    assert.equal(c.fluxo?.freteIncluso, true);
    assert.equal(c.fluxo?.forma, 'boleto');
    const r4 = await c.diz('Modelo: WS-C3850-48P-S', { tipo: 'modelo', codigo: 'WS-C3850-48P-S' });
    assert.equal(r4.tipo, 'sugestao_acessorios');
    const r5 = await c.diz('Sem acessórios', { tipo: 'acessorios', itens: [] });
    assert.equal(r5.tipo, 'proposta');
    assert.ok(r5.proposta.linhas.includes('Frete: incluso (sem cobrança à parte)'));
    assert.ok(r5.proposta.linhas.includes('Forma de pagamento: Boleto'));
    assert.equal(d.llm.calls, 0);
  });

  it('conversa antiga (sem estado salvo): os 5 campos numerados pedidos pelo assistente são preenchidos pela resposta numerada', async () => {
    const { api, calls } = fakeApi(CATALOGO_UM_3850);
    const d = deps(api);
    const mensagens: M[] = [
      { papel: 'usuario', texto: 'gere uma proposta de venda para a Foxconn' },
      { papel: 'assistente', texto: 'Qual produto?' },
      { papel: 'usuario', texto: 'switch cisco c3850' },
      { papel: 'assistente', texto: 'Para montar a proposta preciso de:\n1. Tipo de proposta\n2. Quantidade e modelo\n3. Frete\n4. Prazo de entrega\n5. Forma de pagamento' },
      { papel: 'usuario', texto: '1 Venda\n1 C3850\n3 incluso\n4 ok\n5 Boleto' },
    ];
    const r = await handleChat({ mensagens }, d);
    assert.equal(r.body.tipo, 'proposta', JSON.stringify(r.body));
    const linhas = (r.body as any).proposta.linhas as string[];
    assert.ok(linhas.includes('Frete: incluso (sem cobrança à parte)'));
    assert.ok(linhas.includes('Forma de pagamento: Boleto'));
    assert.ok(linhas.some((l) => l.startsWith('1 x WS-C3850-48P-S')));
    assert.ok(!calls.some((x) => x.path.startsWith('/api/erp/invoices')));
    assert.equal(d.llm.calls, 0);
  });

  it('lerResposta: "1 Venda / 1 C3850 / 3 incluso / 4 ok / 5 Boleto" (com barras) vira os campos certos', () => {
    const s = lerResposta('1 Venda / 1 C3850 / 3 incluso / 4 ok / 5 Boleto', { etapa: 'modelo', tipo: 'produtos' });
    assert.equal(s.tipo, 'produtos');
    assert.equal(s.quantidade, 1);
    assert.equal(s.termo, 'c3850');
    assert.equal(s.freteIncluso, true);
    assert.equal(s.forma, 'boleto');
    assert.equal(s.cliente, undefined);
  });

  it('só troca de intenção com pedido claramente novo; "cancelar" encerra o rascunho', async () => {
    const { api } = fakeApi();
    const d = deps(api);
    const c = conversa(d);
    await c.diz('gere uma proposta de venda para a Foxconn');
    const r = await c.diz('liste as faturas vencidas');
    assert.notEqual(r.tipo, 'escolha_produto');
    assert.equal(c.fluxo, null, 'pedido novo sai do fluxo');
    const c2 = conversa(d);
    await c2.diz('gere uma proposta de venda para a Foxconn');
    const r2 = await c2.diz('cancelar');
    assert.match(r2.texto, /cancelei/);
    assert.equal(c2.fluxo, null);
  });
});

describe('t171u — modelos do cadastro e acessórios compatíveis', () => {
  const regras: RegraAcessorio[] = REGRAS_ACESSORIOS_PADRAO.map((r, i) => ({ ...r, id: `r${i}` }));
  const cat = CATALOGO.map(normalizarProduto).filter(Boolean) as any[];

  it('"gere uma proposta de 1 switch cisco 3850": pergunta o tipo e, em Produtos, abre a lista de modelos WS-C3850-*', async () => {
    const { api, calls } = fakeApi();
    const d = deps(api);
    const c = conversa(d);
    const r1 = await c.diz('gere uma proposta de 1 switch cisco 3850');
    assert.match(r1.texto, /qual é o tipo da proposta/i, 'switch pode ser venda ou locação: pergunta o tipo');
    const r2 = await c.diz('1');
    assert.equal(r2.tipo, 'escolha_produto');
    assert.equal(r2.quantidade, 1);
    for (const o of r2.opcoes) assert.match(o.codigo, /^WS-C3850-/);
    const p48 = r2.opcoes.find((o: any) => o.codigo === 'WS-C3850-48P-S');
    assert.equal(p48.preco, 3596.52);
    assert.equal(p48.estoque, 2);
    // Acessórios e itens de outra família não entram na lista de modelos.
    assert.ok(!r2.opcoes.some((o: any) => /PWR|NM|RCKMNT/.test(o.codigo)));

    const r3 = await c.diz('Modelo: WS-C3850-48P-S', { tipo: 'modelo', codigo: 'WS-C3850-48P-S' });
    assert.equal(r3.tipo, 'sugestao_acessorios');
    const cods = r3.grupos.flatMap((g: any) => g.itens.map((i: any) => i.codigo));
    assert.ok(cods.includes('PWR-C1-1100WAC') && cods.includes('PWR-C1-350WAC'), 'fontes PWR-C1-*');
    assert.ok(cods.includes('C3850-NM-4-1G'), 'uplink C3850-NM-*');
    assert.ok(cods.includes('GLC-SX-MMD') && cods.includes('SFP-10G-SR'), 'ópticos SFP/SFP+');
    assert.ok(!cods.includes('PWR-C1-BLANK'), 'blank excluído');
    assert.ok(!cods.includes('GLC-FE-100 FX-RGD'), 'Fast Ethernet excluído');
    assert.ok(!cods.includes('PWR-C2-640WAC') && !cods.includes('ASR-920-PWR-A'), 'outra família fora');
    for (const cod of cods) assert.ok(CATALOGO.some((x) => x.gestaoClickCode === cod), `${cod} existe no cadastro`);

    // Escolhe 2 fontes + 1 uplink; tenta enfiar item inventado (ignorado).
    const r4 = await c.diz('Acessórios', { tipo: 'acessorios', itens: [
      { codigo: 'PWR-C1-1100WAC', quantidade: 2 }, { codigo: 'C3850-NM-4-1G', quantidade: 1 }, { codigo: 'INVENTADO-123', quantidade: 5 },
    ] });
    assert.equal(r4.tipo, 'escolha_cliente' === r4.tipo ? 'escolha_cliente' : 'texto');
    assert.match(r4.texto, /Para qual cliente/);
    const r5 = await c.diz('Foxconn');
    assert.equal(r5.tipo, 'proposta');
    const linhas: string[] = r5.proposta.linhas;
    assert.ok(linhas.some((l) => l.startsWith('1 x WS-C3850-48P-S')));
    assert.ok(linhas.some((l) => l.startsWith('2 x PWR-C1-1100WAC')));
    assert.ok(linhas.some((l) => l.startsWith('1 x C3850-NM-4-1G')));
    assert.ok(!linhas.some((l) => /INVENTADO/.test(l)));
    assert.ok(!calls.some((x) => x.method === 'POST'));

    // Aprendizado: aceitos gravados; o mesmo 3850 de novo já vem com eles marcados.
    const mem = await d.store.listarMemorias(USER.uid);
    const aceita = mem.find((m) => m.texto === textoMemoriaSugestao('WS-C3850-*', 'PWR-C1-1100WAC'));
    assert.equal(aceita?.dados?.aceitos, 1);
    const recusada = mem.find((m) => m.texto === textoMemoriaSugestao('WS-C3850-*', 'PWR-C1-350WAC'));
    assert.equal(recusada?.dados?.recusados, 1, 'fonte não escolhida na mesma categoria conta como recusa');
    const sug = sugerirAcessorios(cat.find((x) => x.codigo === 'WS-C3850-48P-S'), cat, regras, mem, 'produtos');
    assert.equal(sug[0].codigo, 'PWR-C1-1100WAC');
    assert.equal(sug[0].marcado, true);
    assert.equal(sug.find((x) => x.codigo === 'PWR-C1-350WAC')?.marcado, false);
  });

  it('recusado 3 vezes sai da sugestão; regras editáveis mudam a compatibilidade', () => {
    const base = cat.find((x) => x.codigo === 'WS-C3850-48T-L');
    const mem = [{ id: 'm1', tipo: 'sugestao', texto: 'x', cnpj: null, dados: { base: 'WS-C3850-*', item: 'GLC-SX-MMD', aceitos: 0, recusados: 3 }, origemConversaId: null, ativa: true, criadaEm: '', atualizadaEm: '' }] as any;
    assert.ok(!sugerirAcessorios(base, cat, regras, mem, 'produtos').some((x) => x.codigo === 'GLC-SX-MMD'));
    const semFontes = regras.map((r) => (r.padrao === 'PWR-C1-*' ? { ...r, ativa: false } : r));
    assert.ok(!sugerirAcessorios(base, cat, semFontes, [], 'produtos').some((x) => x.categoria === 'fonte'));
  });

  it('casaPadrao e busca: códigos com espaço no cadastro casam o padrão compacto', () => {
    assert.ok(casaPadrao('RCKMNT-T1 C3850 C3650', 'RCKMNT-T1*'));
    assert.ok(casaPadrao('WS-C3850-48P-S', 'WS-C3850-*'));
    assert.ok(!casaPadrao('WS-C3650-24TS', 'WS-C3850-*'));
    assert.deepEqual(buscarModelos(cat, 'WS-C3850-48P-S', regras).map((x) => x.codigo)[0], 'WS-C3850-48P-S');
  });
});

describe('t172u — tipo inferido, quantidade, valor do cadastro e padrões', () => {
  it('tipo pela frase', () => {
    assert.equal(tipoPropostaNoTexto('gere uma proposta de venda para a Foxconn'), 'produtos');
    assert.equal(tipoPropostaNoTexto('quero vender 2 switches'), 'produtos');
    assert.equal(tipoPropostaNoTexto('proposta de instalação de rack'), 'servico_pontual');
    assert.equal(tipoPropostaNoTexto('proposta de suporte para a Alfa'), 'servico_mensal');
    assert.equal(tipoPropostaNoTexto('proposta de monitoramento'), 'servico_mensal');
    assert.equal(tipoPropostaNoTexto('alugar 3 servidores'), 'locacao');
  });

  it('"gere uma proposta de venda de 2 switch c3850 para a Foxconn": quantidade 2 aproveitada e valor do cadastro', async () => {
    const { api } = fakeApi(CATALOGO_UM_3850);
    const d = deps(api);
    const c = conversa(d);
    const r = await c.diz('gere uma proposta de venda de 2 switch c3850 para a Foxconn');
    assert.equal(r.tipo, 'proposta', JSON.stringify(r));
    const linhas: string[] = r.proposta.linhas;
    assert.ok(linhas.some((l) => /^2 x WS-C3850-48P-S .* a R\$\s?3\.596,52$/.test(l)), linhas.join('\n'));
    assert.ok(linhas.includes('Frete: a definir (padrão; ajuste se precisar)'));
    assert.ok(linhas.some((l) => l.startsWith('Forma de pagamento: Boleto (padrão')));
    // Ajuste sem recomeçar: "pix e frete 150".
    const r2 = await c.diz('pix e frete 150');
    assert.equal(r2.tipo, 'proposta');
    assert.ok(r2.proposta.linhas.includes('Forma de pagamento: Pix'));
    assert.ok(r2.proposta.linhas.some((l: string) => /^Frete: R\$\s?150,00$/.test(l)));
  });

  it('cliente com mais de um cadastro: lista para escolher', async () => {
    const { api } = fakeApi(CATALOGO_UM_3850, [FOXCONN, { id: 'co-fox2', name: 'FOXCONN TECNOLOGIA LTDA', cnpj: '11.222.333/0001-81' }]);
    const d = deps(api);
    const c = conversa(d);
    const r = await c.diz('gere uma proposta de venda para a Foxconn');
    assert.equal(r.tipo, 'escolha_cliente');
    assert.equal(r.opcoes.length, 2);
    const r2 = await c.diz('2');
    assert.match(r2.texto, /Proposta de Produtos \(venda\) para FOXCONN TECNOLOGIA LTDA/);
  });
});
