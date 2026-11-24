// ============================================================================
// STI-hub — Assistente: texto copiável, respostas completas com links/PDF e registro
// em contexto (pedido do Marcéllo, 24/11/2026: "permitir que os textos do chat com a IA
// possam ser copiados" e "sempre trazer as informações na forma mais completa possível,
// junto com links e opções para copiar PDFs").
// Caso do print: depois do orçamento 4725, "traga o link da proposta" listava 39 propostas
// com "link" no nome (UP LINK FIBRA, ROUTERLINK...). Agora age sobre o 4725.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { rotearPergunta } from '../src/modules/assistente/roteador';
import {
  MARCA_CONTEXTO,
  PERGUNTA_QUAL_REGISTRO,
  marcaContexto,
  pedidoSobreRegistro,
  registroEmContexto,
  rotaDoContexto,
  termoGenerico,
  type RegistroContexto,
} from '../src/modules/assistente/contexto';
import {
  acoesProposta,
  detalhesProposta,
  getTool,
  resumoValorProposta,
  type ApiCaller,
  type ApiCallRequest,
  type AssistenteUser,
} from '../src/modules/assistente/tools';
import { ajustarPorContexto, handleChat, handleExecute, type AssistenteDeps, type AssistenteAuditEntry } from '../src/modules/assistente/service';
import type { LlmClient } from '../src/modules/assistente/omniroute-client';
import { ALVO_SECAO_ERP, tabelaParaTsv, textoDoCartao, textoDoResultado, urlAbsoluta } from '../src/app/lib/assistente-chat-texto';

const AGORA = Date.parse('2026-11-24T15:00:00-03:00');
const SECRET = 'segredo-de-teste-assistente-copiar-0123456789';
const ALL: AssistenteUser = { uid: 'usr-ana', email: 'ana@seta.test', name: 'Ana', roleId: 'SUPER_ADMIN', moduleAccess: { crm: true, erp: true, chamados: true } };
const CRM_ONLY: AssistenteUser = { ...ALL, uid: 'usr-bia', moduleAccess: { crm: true, erp: false, chamados: false } };

const PROP_4725 = {
  id: 'prop-1795473263142-d5b63b',
  code: '4725',
  title: 'Locação de servidor',
  companyName: 'Condomínio do Parangaba',
  companyCnpj: '11222333000181',
  contactName: 'Síndico Carlos',
  contactEmail: 'sindico@parangaba.test',
  status: 'ENVIADA',
  budgetType: 'LOCACAO',
  contractMonths: 36,
  monthlyRecurringTotal: 2350,
  oneTimeSetupTotal: 0,
  totalContractValue: 84600,
  validUntil: '2026-12-07',
  sellerName: 'Marcéllo Míra',
  sellerEmail: 'marcello@seta.test',
  paymentCondition: 'Boleto',
  createdAt: '2026-11-23T22:34:00.000Z',
  items: [{ description: 'Servidor Dell R640', quantity: 1, unitPrice: 2350, isRecurring: true }],
};
/** Lista do modo tabela: sem itens (a ficha completa vem do GET por id). */
const PROP_4725_LISTA = { ...PROP_4725, items: undefined };
const PROP_AVULSA = {
  id: 'prop-4709',
  code: '4709',
  companyName: 'Dafiti Group',
  status: 'ENVIADA',
  budgetType: 'SERVICOS',
  contractMonths: 1,
  monthlyRecurringTotal: 0,
  totalContractValue: 18600,
  validUntil: '2099-01-10',
  items: [{ description: 'Visita técnica', quantity: 1, unitPrice: 18600, isRecurring: false }],
};
const PROP_SETUP = {
  id: 'prop-4800',
  code: '4800',
  companyName: 'Alfa Ltda',
  status: 'RASCUNHO',
  budgetType: 'LOCACAO',
  contractMonths: 24,
  monthlyRecurringTotal: 1000,
  oneTimeSetupTotal: 500,
  totalContractValue: 24500,
  validUntil: '2099-01-10',
  items: [{ description: 'Notebook', quantity: 2, unitPrice: 500, isRecurring: true }],
};
const OUTRAS = [
  { id: 'prop-9001', code: '9001', companyName: 'UP LINK FIBRA', status: 'ENVIADA', totalContractValue: 1 },
  { id: 'prop-9002', code: '9002', companyName: 'ROUTERLINK', status: 'ENVIADA', totalContractValue: 1 },
];
const CONTRATOS = [{ id: 'c1', contractNumber: 'LOC-2026-101', companyName: 'Alfa Ltda', companyCnpj: '11.222.333/0001-81', status: 'ATIVO', monthlyValue: 1000, startDate: '2026-01-10', endDate: '2028-01-09', contractMonths: 24, readjustmentIndex: 'IGP-M', dueDay: 10, equipments: [{ description: 'Notebook Dell' }] }];
const FATURAS = [
  { id: 'f1', documentNumber: 'FAT-1234', documentType: 'FATURA_LOCACAO', companyName: 'Alfa Ltda', companyCnpj: '11.222.333/0001-81', status: 'EMITIDA', grossAmount: 1000, issueDate: '2026-09-01', dueDate: '2026-09-10', boletoDigitableLine: '23793.38128 60000.000003 00000.000400 1 84340000001000' },
  { id: 'f2', documentNumber: '4567', documentType: 'NFSE_SERVICO', companyName: 'Beta SA', status: 'PAGA', grossAmount: 300, issueDate: '2026-10-02', dueDate: '2026-10-12', paidAt: '2026-10-11', verificationCodeOrKey: 'ABC123' },
];
const OVERVIEW = { serviceOrders: [{ id: 'os-1', code: '1203', companyName: 'Alfa Ltda', description: 'Troca de fonte', status: 'Em aberto', totalAmount: 150, entryDate: '20/11/2026', technicianName: 'Rafa', equipmentName: 'Servidor R640' }], suppliers: [] };
const TICKETS = [{ id: 't1', key: 'SETA-123', subject: 'Impressora parada', status: 'OPEN', priority: 'HIGH', createdAt: '2026-11-20T10:00:00Z', requesterName: 'João', requesterEmail: 'joao@alfa.test', company: { name: 'Alfa Ltda' } }];

function fakeApi(over: Record<string, (r: ApiCallRequest) => { status: number; body: any }> = {}) {
  const calls: ApiCallRequest[] = [];
  const props: any[] = [PROP_4725_LISTA, PROP_AVULSA, PROP_SETUP, ...OUTRAS];
  const routes: Record<string, (r: ApiCallRequest) => { status: number; body: any }> = {
    'GET /api/erp/proposals': (r) => {
      const q = (new URLSearchParams(r.path.split('?')[1] || '').get('q') || '').toLowerCase();
      const data = q ? props.filter((p) => `${p.id} ${p.code} ${p.companyName} ${p.title || ''}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(q)) : props;
      return { status: 200, body: { data, total: data.length } };
    },
    'GET /api/erp/proposals/prop-1795473263142-d5b63b': () => ({ status: 200, body: { data: PROP_4725 } }),
    'GET /api/erp/proposals/prop-4709': () => ({ status: 200, body: { data: PROP_AVULSA } }),
    'GET /api/erp/proposals/prop-4800': () => ({ status: 200, body: { data: PROP_SETUP } }),
    'GET /api/erp/contracts': () => ({ status: 200, body: { data: CONTRATOS } }),
    'GET /api/erp/invoices': () => ({ status: 200, body: { data: FATURAS } }),
    'GET /api/erp/overview': () => ({ status: 200, body: { data: OVERVIEW } }),
    'GET /api/tickets': () => ({ status: 200, body: { data: TICKETS } }),
    'GET /api/companies': () => ({ status: 200, body: { data: [] } }),
    'GET /api/contacts': () => ({ status: 200, body: { data: [] } }),
    'GET /api/erp/catalog': () => ({ status: 200, body: { data: [] } }),
    ...over,
  };
  const api: ApiCaller = async (r) => {
    calls.push(r);
    const h = routes[`${r.method} ${r.path.split('?')[0]}`];
    return h ? h(r) : { status: 404, body: { error: 'nao encontrado' } };
  };
  return { api, calls };
}

function llmFake(resposta?: { name: string; args: any }): LlmClient & { calls: number } {
  const o = {
    calls: 0,
    async complete() {
      o.calls += 1;
      return { text: '', toolCalls: resposta ? [resposta] : [], model: 'teste' };
    },
  };
  return o as any;
}

function deps(over: Partial<AssistenteDeps> = {}): AssistenteDeps & { audits: AssistenteAuditEntry[] } {
  const audits: AssistenteAuditEntry[] = [];
  const nonces = new Set<string>();
  return {
    llm: llmFake(),
    api: fakeApi().api,
    user: ALL,
    secret: SECRET,
    sid: 'sessao-1',
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

type Msg = { papel: 'usuario' | 'assistente'; texto: string };
const PERGUNTA_PRINT = 'Proposta Comercial #prop-1795473263142-d5b63b não localizada, por que essa proposta não abre?';

/** Primeira volta do print: busca + Confirmar => historico igual ao do navegador. */
async function primeiraVolta(d: AssistenteDeps): Promise<{ historico: Msg[]; exec: any }> {
  const chat = await handleChat({ mensagens: [{ papel: 'usuario', texto: PERGUNTA_PRINT }] }, d);
  assert.equal(chat.body.tipo, 'proposta');
  const exec = await handleExecute({ token: (chat.body.proposta as any).token, confirmar: true }, d);
  assert.equal(exec.body.ok, true);
  const historico: Msg[] = [
    { papel: 'usuario', texto: PERGUNTA_PRINT },
    { papel: 'assistente', texto: `Ação preparada: ${(chat.body.proposta as any).titulo} (confirmada).` },
    { papel: 'assistente', texto: `Resultado: ${exec.body.resumoParaModelo}` },
  ];
  return { historico, exec: exec.body };
}

const CTX_4725: RegistroContexto = { tipo: 'proposta', ref: '4725' };
const CTX_CONTRATO: RegistroContexto = { tipo: 'contrato', ref: 'LOC-2026-101' };

// ---------------------------------------------------------------------------
// 1) Caso exato do print
// ---------------------------------------------------------------------------
describe('assistente — caso do print: "traga o link da proposta" depois do 4725', () => {
  it('a primeira resposta já vem completa: ficha, valores pela regra, validade, vendedor e botões', async () => {
    const d = deps({ api: fakeApi().api });
    const { exec } = await primeiraVolta(d);
    const msg = String(exec.mensagem);
    assert.match(msg, /4725/);
    assert.match(msg, /Parangaba/);
    assert.match(msg, /R\$\s?2\.350,00\/mês por 36 meses/);
    assert.match(msg, /sem a assinatura do cliente/);
    const ficha = Object.fromEntries((exec.detalhes as any[]).map((x) => [x.rotulo, x.valor]));
    assert.equal(ficha['Cliente'], 'Condomínio do Parangaba');
    assert.equal(ficha['CNPJ'], '11.222.333/0001-81');
    assert.equal(ficha['Situação'], 'Enviada');
    assert.equal(ficha['Tipo'], 'Locação');
    assert.match(ficha['Mensal'], /2\.350,00\/mês/);
    assert.equal(ficha['Prazo'], '36 meses');
    assert.match(ficha['Total do contrato'], /84\.600,00/);
    assert.equal(ficha['Validade'], '07/12/2026');
    assert.match(ficha['Vendedor'], /Marcéllo Míra/);
    assert.match(ficha['Contato'], /sindico@parangaba\.test/);
    assert.equal(ficha['Criada em'], '23/11/2026');
    assert.match(ficha['Itens'], /Servidor Dell R640/);
    const tipos = (exec.acoes as any[]).map((a) => a.tipo);
    assert.deepEqual(tipos, ['abrir', 'link_cliente_proposta', 'versao_contrato', 'pdf_proposta', 'link_pdf']);
    assert.equal(exec.tabela.colunas[1], 'Descrição', 'a tabela é a dos itens');
    assert.match(String(exec.resumoParaModelo), /Registro em contexto: proposta \[4725\]\./);
    assert.doesNotMatch(String(exec.resumoParaModelo), /Parangaba/);
  });

  it('"traga o link da proposta" age sobre o 4725 (não busca "link"), sem chamar o modelo', async () => {
    const { api, calls } = fakeApi();
    const llm = llmFake();
    const d = deps({ api, llm });
    const { historico } = await primeiraVolta(d);
    const chat = await handleChat({ mensagens: [...historico, { papel: 'usuario', texto: 'traga o link da proposta' }] }, d);
    assert.equal(chat.body.tipo, 'proposta');
    const card = chat.body.proposta as any;
    assert.equal(card.ferramenta, 'consultar_propostas');
    assert.ok(card.linhas.includes('Busca: "4725"'), card.linhas.join(' | '));
    assert.ok(!card.linhas.some((l: string) => /"link"/.test(l)), 'o termo "link" não vira busca');
    assert.equal(llm.calls, 0);
    calls.length = 0;
    const exec = await handleExecute({ token: card.token, confirmar: true }, d);
    assert.equal(exec.body.ok, true);
    assert.match(String(exec.body.mensagem), /^Proposta 4725 de Condomínio do Parangaba/);
    assert.doesNotMatch(String(exec.body.mensagem), /39 propostas|UP LINK|ROUTERLINK/);
    const acoes = exec.body.acoes as any[];
    const link = acoes.find((a) => a.tipo === 'link_cliente_proposta');
    assert.equal(link.propostaId, 'prop-1795473263142-d5b63b');
    assert.equal(link.rotulo, 'Copiar link do cliente');
    assert.equal(acoes.find((a) => a.tipo === 'versao_contrato').href, '/interno/proposta/prop-1795473263142-d5b63b');
    assert.equal(acoes.find((a) => a.tipo === 'link_pdf').href, '/interno/proposta/prop-1795473263142-d5b63b?pdf=1');
    assert.ok(acoes.find((a) => a.tipo === 'pdf_proposta'));
    assert.ok(!calls.some((c) => c.method !== 'GET'), 'só leitura: nada gravado');
    assert.ok(!calls.some((c) => /public-link/.test(c.path)), 'o link assinado não é gerado no servidor do assistente');
    const json = JSON.stringify(exec.body);
    assert.doesNotMatch(json, /#t=|"token"|signature|assinatura=/i, 'nenhum token na resposta');
  });

  it('sem registro na conversa, pergunta qual proposta (e não lista nada)', async () => {
    const llm = llmFake();
    const { api, calls } = fakeApi();
    const r = await handleChat({ mensagens: [{ papel: 'usuario', texto: 'traga o link da proposta' }] }, deps({ api, llm }));
    assert.equal(r.body.tipo, 'texto');
    assert.equal(r.body.texto, PERGUNTA_QUAL_REGISTRO);
    assert.equal(llm.calls, 0);
    assert.equal(calls.length, 0);
  });

  it('depois da pergunta, "4725" traz a ficha do 4725 (a pergunta não trava o roteador)', async () => {
    const llm = llmFake();
    const r = await handleChat(
      {
        mensagens: [
          { papel: 'usuario', texto: 'traga o link da proposta' },
          { papel: 'assistente', texto: PERGUNTA_QUAL_REGISTRO },
          { papel: 'usuario', texto: '4725' },
        ],
      },
      deps({ llm }),
    );
    assert.equal(r.body.tipo, 'proposta');
    assert.equal((r.body.proposta as any).ferramenta, 'consultar_propostas');
    assert.ok((r.body.proposta as any).linhas.includes('Busca: "4725"'));
  });

  it('registro citado pelo usuário (sem confirmar a busca) também vale como contexto', async () => {
    const r = await handleChat(
      {
        mensagens: [
          { papel: 'usuario', texto: PERGUNTA_PRINT },
          { papel: 'assistente', texto: 'Ação preparada: Buscar no STI-hub (aguardando confirmação).' },
          { papel: 'usuario', texto: 'traga o link da proposta' },
        ],
      },
      deps(),
    );
    assert.equal((r.body.proposta as any).ferramenta, 'consultar_propostas');
    assert.ok((r.body.proposta as any).linhas.includes('Busca: "prop-1795473263142-d5b63b"'));
  });

  it('o modelo mandando busca "link" é corrigido para o registro em contexto', async () => {
    const llm = llmFake({ name: 'consultar_propostas', args: { busca: 'link', limite: 20 } });
    const hist: Msg[] = [
      { papel: 'assistente', texto: `Resultado: Busca universal: 1 registro (Orçamento).${marcaContexto({ tipo: 'proposta', id: 'prop-1795473263142-d5b63b', codigo: '4725' })}` },
      // texto que o roteador não decide (vai ao modelo)
      { papel: 'usuario', texto: 'e aí, consegue me ajudar com aquilo de antes' },
    ];
    const r = await handleChat({ mensagens: hist }, deps({ llm }));
    assert.equal(llm.calls, 1);
    assert.equal((r.body.proposta as any).ferramenta, 'consultar_propostas');
    assert.ok((r.body.proposta as any).linhas.includes('Busca: "4725"'));
  });

  it('o modelo mandando busca "link" sem contexto => pergunta qual proposta', async () => {
    const llm = llmFake({ name: 'consultar_propostas', args: { busca: 'link' } });
    const r = await handleChat({ mensagens: [{ papel: 'usuario', texto: 'e aí, consegue me ajudar com aquilo de antes' }] }, deps({ llm }));
    assert.equal(r.body.tipo, 'texto');
    assert.equal(r.body.texto, PERGUNTA_QUAL_REGISTRO);
  });
});

// ---------------------------------------------------------------------------
// 2) Roteamento com registro em contexto
// ---------------------------------------------------------------------------
const PEDIDOS_CONTEXTO = [
  'traga o link da proposta',
  'traga o link',
  'me passa o link',
  'manda o link dela',
  'qual o link da proposta?',
  'link do cliente',
  'copia o link do cliente',
  'copie o link',
  'gera o link',
  'link',
  'o link do orçamento',
  'manda o pdf',
  'baixar pdf',
  'baixe o PDF da proposta',
  'pdf',
  'quero o pdf dela',
  'imprimir a proposta',
  'versão contrato',
  'versão do contrato dela',
  'me manda a versão contrato',
  'quais os dados dela',
  'detalhes dessa proposta',
  'abre ela',
  'abrir a proposta',
  'traga os itens desse orçamento',
  'qual a validade dela?',
  'quem é o vendedor dessa proposta',
  'informações completas dela',
];

describe('assistente — pedido sobre o registro em contexto', () => {
  for (const frase of PEDIDOS_CONTEXTO) {
    it(`com contexto 4725: "${frase}" => consultar_propostas 4725`, () => {
      const r = rotearPergunta(frase, { agora: AGORA, contexto: CTX_4725 });
      assert.ok(r && r.tipo === 'ferramenta', JSON.stringify(r));
      assert.equal(r.ferramenta, 'consultar_propostas');
      assert.deepEqual(r.args, { busca: '4725' });
    });
    it(`sem contexto: "${frase}" => pergunta qual`, () => {
      const r = rotearPergunta(frase, { agora: AGORA, contexto: null });
      assert.ok(r && r.tipo === 'texto', JSON.stringify(r));
      assert.equal(r.texto, PERGUNTA_QUAL_REGISTRO);
    });
  }

  it('contrato em contexto: "pdf do contrato" busca o contrato citado', () => {
    const r = rotearPergunta('manda o pdf do contrato', { agora: AGORA, contexto: CTX_CONTRATO });
    assert.ok(r && r.tipo === 'ferramenta');
    assert.equal(r.ferramenta, 'buscar');
    assert.deepEqual(r.args, { termo: 'contrato LOC-2026-101' });
  });

  const NAO_SAO_PEDIDO: Array<[string, (r: ReturnType<typeof rotearPergunta>) => boolean]> = [
    ['link da proposta 4709', (r) => r?.tipo === 'ferramenta' && r.ferramenta === 'consultar_propostas' && (r.args as any).busca === '4709'],
    ['pdf do orçamento 4709', (r) => r?.tipo === 'ferramenta' && (r.args as any).busca === '4709'],
    ['propostas enviadas este mês', (r) => r?.tipo === 'ferramenta' && r.ferramenta === 'consultar_propostas' && (r.args as any).status === 'ENVIADA'],
    ['liste os contratos ativos', (r) => r?.tipo === 'ferramenta' && r.ferramenta === 'consultar'],
    ['mude a validade dela para 10/12/2026', (r) => r === null],
    ['altere o vendedor dessa proposta', (r) => r === null],
    ['envie o link por e-mail ao cliente', (r) => !(r?.tipo === 'ferramenta' && r.ferramenta === 'consultar_propostas' && (r.args as any).busca === '4725')],
    ['manda o link no whatsapp do cliente', (r) => !(r?.tipo === 'ferramenta' && (r.args as any).busca === '4725')],
    ['como gero o link do cliente?', (r) => r?.tipo === 'texto' && /Copiar link do cliente/.test(r.texto)],
    ['bom dia', (r) => r === null],
  ];
  for (const [frase, ok] of NAO_SAO_PEDIDO) {
    it(`não sequestra: "${frase}"`, () => {
      const r = rotearPergunta(frase, { agora: AGORA, contexto: CTX_4725 });
      assert.ok(ok(r), JSON.stringify(r));
    });
  }

  it('pedidoSobreRegistro classifica o pedido', () => {
    assert.equal(pedidoSobreRegistro('traga o link da proposta'), 'link');
    assert.equal(pedidoSobreRegistro('manda o pdf'), 'pdf');
    assert.equal(pedidoSobreRegistro('versão contrato dela'), 'versao_contrato');
    assert.equal(pedidoSobreRegistro('quais os dados dela'), 'detalhes');
    assert.equal(pedidoSobreRegistro('link da proposta 4725'), null, 'com número, a rota normal decide');
    assert.equal(pedidoSobreRegistro('quais os dados'), null, 'sem referência, não é pedido sobre registro');
    assert.equal(pedidoSobreRegistro('propostas com link'), null);
  });

  it('termoGenerico: palavras de tipo/ação não são busca', () => {
    for (const t of ['link', 'pdf', 'proposta', 'o link da proposta', 'Versão contrato', 'PDF do orçamento', 'link do cliente']) assert.equal(termoGenerico(t), true, t);
    for (const t of ['4725', 'parangaba', 'up link fibra', 'routerlink', 'prop-1795473263142-d5b63b', '']) assert.equal(termoGenerico(t), false, t);
  });

  it('ajustarPorContexto só troca busca genérica', () => {
    assert.deepEqual(ajustarPorContexto('consultar_propostas', { busca: 'link' }, CTX_4725), { nome: 'consultar_propostas', args: { busca: '4725' } });
    assert.deepEqual(ajustarPorContexto('buscar', { termo: 'pdf' }, CTX_CONTRATO), { nome: 'buscar', args: { termo: 'contrato LOC-2026-101' } });
    assert.deepEqual(ajustarPorContexto('consultar_propostas', { busca: 'parangaba' }, CTX_4725), { nome: 'consultar_propostas', args: { busca: 'parangaba' } });
    assert.deepEqual(ajustarPorContexto('consultar_propostas', { status: 'ENVIADA' }, CTX_4725), { nome: 'consultar_propostas', args: { status: 'ENVIADA' } });
    assert.deepEqual(ajustarPorContexto('consultar_propostas', { busca: 'proposta' }, null), { texto: PERGUNTA_QUAL_REGISTRO });
  });

  it('rotaDoContexto para cada tipo', () => {
    assert.deepEqual(rotaDoContexto({ tipo: 'fatura', ref: 'FAT-1234' }), { ferramenta: 'buscar', args: { termo: 'fatura FAT-1234' } });
    assert.deepEqual(rotaDoContexto({ tipo: 'nota', ref: '4567' }), { ferramenta: 'buscar', args: { termo: 'nota 4567' } });
    assert.deepEqual(rotaDoContexto({ tipo: 'ordem_servico', ref: '1203' }), { ferramenta: 'buscar', args: { termo: 'OS 1203' } });
    assert.deepEqual(rotaDoContexto({ tipo: 'chamado', ref: 'SETA-123' }), { ferramenta: 'buscar', args: { termo: 'chamado SETA-123' } });
  });
});

// ---------------------------------------------------------------------------
// 3) Registro em contexto a partir do histórico
// ---------------------------------------------------------------------------
describe('assistente — registroEmContexto', () => {
  it('marcaContexto: formato fixo, sem tipos desconhecidos', () => {
    assert.equal(marcaContexto({ tipo: 'proposta', id: 'prop-1', codigo: '4725' }), ` ${MARCA_CONTEXTO} proposta [4725].`);
    assert.equal(marcaContexto({ tipo: 'proposta', id: 'prop-1' }), ` ${MARCA_CONTEXTO} proposta [prop-1].`);
    assert.equal(marcaContexto({ tipo: 'empresa', id: 'x' }), '');
    assert.equal(marcaContexto(undefined), '');
  });
  it('pega o registro mais recente (marca do resultado vence o texto antigo)', () => {
    const r = registroEmContexto([
      { papel: 'usuario', texto: 'proposta 4709' },
      { papel: 'assistente', texto: `Resultado: x.${marcaContexto({ tipo: 'proposta', id: 'p', codigo: '4709' })}` },
      { papel: 'usuario', texto: 'contrato LOC-2026-101' },
      { papel: 'assistente', texto: `Resultado: y.${marcaContexto({ tipo: 'contrato', id: 'c1', codigo: 'LOC-2026-101' })}` },
      { papel: 'usuario', texto: 'manda o pdf' },
    ]);
    assert.deepEqual(r, { tipo: 'contrato', ref: 'LOC-2026-101' });
  });
  it('ignora a mensagem atual e links curtos /p/', () => {
    assert.equal(registroEmContexto([{ papel: 'usuario', texto: 'proposta 4725' }]), null);
    assert.equal(registroEmContexto([{ papel: 'usuario', texto: 'https://sti-hub.setatelecom.com.br/p/AbC123xYz9' }, { papel: 'usuario', texto: 'link' }]), null);
  });
  it('identificador digitado pelo usuário: prop-..., número, chamado, OS', () => {
    const z = (t: string) => registroEmContexto([{ papel: 'usuario', texto: t }, { papel: 'usuario', texto: 'link' }]);
    assert.deepEqual(z(PERGUNTA_PRINT), { tipo: 'proposta', ref: 'prop-1795473263142-d5b63b' });
    assert.deepEqual(z('orçamento 4725'), { tipo: 'proposta', ref: '4725' });
    assert.deepEqual(z('chamado SETA-123'), { tipo: 'chamado', ref: 'SETA-123' });
    assert.deepEqual(z('OS 1203'), { tipo: 'ordem_servico', ref: '1203' });
  });
});

// ---------------------------------------------------------------------------
// 4) Fichas completas pelas regras do resumo
// ---------------------------------------------------------------------------
describe('assistente — ficha completa e ações', () => {
  const fichaDe = (p: any) => Object.fromEntries(detalhesProposta(p).map((x) => [x.rotulo, x.valor]));
  it('serviço pontual: pagamento único, sem /mês e sem prazo', () => {
    const f = fichaDe(PROP_AVULSA);
    assert.match(f['Pagamento único'], /18\.600,00/);
    assert.equal(f['Tipo'], 'Serviço pontual (pagamento único)');
    assert.ok(!Object.values(f).some((v) => /\/mês/.test(String(v))));
    assert.equal(f['Mensal'], undefined);
    assert.equal(resumoValorProposta(PROP_AVULSA), 'R$ 18.600,00 em pagamento único');
  });
  it('locação com setup: mensal e setup separado (valor único)', () => {
    const f = fichaDe(PROP_SETUP);
    assert.match(f['Mensal'], /1\.000,00\/mês/);
    const setup = Object.entries(f).find(([k]) => /valor único, separado/.test(k));
    assert.ok(setup, JSON.stringify(f));
    assert.match(String(setup![1]), /500,00/);
    assert.match(resumoValorProposta(PROP_SETUP), /\/mês por 24 meses \+ R\$\s?500,00 de .* \(único\)/);
  });
  it('rascunho: sem botão de link do cliente (emitir mudaria a situação) e com aviso', () => {
    const tipos = acoesProposta(PROP_SETUP).map((a) => a.tipo);
    assert.ok(!tipos.includes('link_cliente_proposta'));
    assert.ok(tipos.includes('aviso'));
    assert.ok(tipos.includes('versao_contrato') && tipos.includes('pdf_proposta') && tipos.includes('link_pdf'));
  });
  it('validade vencida aparece marcada', () => {
    const f = fichaDe({ ...PROP_4725, validUntil: '2020-01-10' });
    assert.match(f['Validade'], /vencida/);
  });
  it('ações sem token e com id codificado', () => {
    const a = acoesProposta({ ...PROP_4725, id: 'prop gc/1' });
    const json = JSON.stringify(a);
    assert.match(json, /\/interno\/proposta\/prop%20gc%2F1/);
    assert.doesNotMatch(json, /#t=/);
  });

  it('busca universal de contrato, fatura, NF, OS e chamado traz ficha, ações e registro', async () => {
    const { api } = fakeApi();
    const t = getTool('buscar')!;
    const contrato: any = await t.executar({ termo: 'contrato LOC-2026-101' }, api);
    assert.equal(contrato.registro.tipo, 'contrato');
    const fc = Object.fromEntries(contrato.detalhes.map((x: any) => [x.rotulo, x.valor]));
    assert.equal(fc['Reajuste'], 'IGP-M');
    assert.equal(fc['Dia de vencimento'], '10');
    assert.match(fc['Equipamentos'], /Notebook Dell/);
    assert.deepEqual(contrato.acoes[0].alvo, { type: 'CONTRACT', id: 'c1' });

    const fatura: any = await t.executar({ termo: 'fatura FAT-1234' }, api);
    assert.equal(fatura.registro.tipo, 'fatura');
    const ff = Object.fromEntries(fatura.detalhes.map((x: any) => [x.rotulo, x.valor]));
    assert.match(ff['Linha digitável'], /23793/);
    assert.ok(fatura.acoes.some((a: any) => a.tipo === 'link_cliente_fatura' && a.faturaId === 'f1'));

    const nota: any = await t.executar({ termo: 'nota 4567' }, api);
    assert.equal(nota.registro.tipo, 'nota');
    assert.ok(!nota.acoes.some((a: any) => a.tipo === 'link_cliente_fatura'), 'NF não tem link de fatura');

    const os: any = await t.executar({ termo: 'OS 1203' }, api);
    assert.equal(os.registro.tipo, 'ordem_servico');
    assert.ok(os.detalhes.some((x: any) => x.rotulo === 'Técnico' && x.valor === 'Rafa'));

    const ch: any = await t.executar({ termo: 'chamado SETA-123' }, api);
    assert.equal(ch.registro.tipo, 'chamado');
    assert.deepEqual(ch.acoes[0].alvo, { type: 'TICKET', id: 't1', query: 'SETA-123' });
  });

  it('busca de orçamento pela lista sem itens busca a ficha completa pelo id (mesmo RBAC)', async () => {
    const { api, calls } = fakeApi();
    const r: any = await getTool('buscar')!.executar({ termo: 'prop-1795473263142-d5b63b' }, api);
    assert.ok(r.detalhes.some((x: any) => x.rotulo === 'Itens'));
    assert.ok(calls.some((c) => c.path === '/api/erp/proposals/prop-1795473263142-d5b63b'));
    assert.ok(calls.every((c) => c.method === 'GET'));
  });

  it('RBAC: sem ERP, o pedido de link não consulta propostas', async () => {
    const { api, calls } = fakeApi();
    const r = await handleChat(
      { mensagens: [{ papel: 'usuario', texto: 'orçamento 4725' }, { papel: 'assistente', texto: `Resultado: x.${marcaContexto({ tipo: 'proposta', id: 'p', codigo: '4725' })}` }, { papel: 'usuario', texto: 'traga o link da proposta' }] },
      deps({ api, user: CRM_ONLY, llm: llmFake() }),
    );
    assert.notEqual((r.body.proposta as any)?.ferramenta, 'consultar_propostas');
    assert.equal(calls.length, 0);
  });

  it('RBAC: 403 no GET da proposta => sem ficha e sem botões', async () => {
    const { api } = fakeApi({ 'GET /api/erp/proposals/prop-1795473263142-d5b63b': () => ({ status: 403, body: { error: 'Sem permissão' } }) });
    const r: any = await getTool('consultar_propostas')!.executar({ busca: '4725' }, api);
    assert.equal(r.ok, false);
    assert.equal(r.acoes, undefined);
  });
});

// ---------------------------------------------------------------------------
// 5) Texto copiável (funções do navegador) e fontes da tela
// ---------------------------------------------------------------------------
describe('assistente — texto copiável', () => {
  it('tabela vira texto tabulado (sem quebrar colunas)', () => {
    assert.equal(tabelaParaTsv({ colunas: ['Número', 'Cliente'], linhas: [['4725', 'Condomínio\tdo Parangaba'], ['4709', 'Dafiti\nGroup']] }), 'Número\tCliente\n4725\tCondomínio do Parangaba\n4709\tDafiti Group');
  });
  it('resposta completa: mensagem, totais, ficha e tabela', () => {
    const t = textoDoResultado({
      mensagem: 'Proposta 4725 de Condomínio do Parangaba.',
      totais: [{ rotulo: 'Número', valor: '4725' }],
      detalhes: [{ rotulo: 'Validade', valor: '07/12/2026' }],
      tabela: { colunas: ['Item', 'Descrição'], linhas: [['1', 'Servidor Dell R640']] },
    });
    assert.equal(t, 'Proposta 4725 de Condomínio do Parangaba.\n\nValidade: 07/12/2026\n\nItem\tDescrição\n1\tServidor Dell R640');
  });
  it('sem ficha, os totais entram no texto copiado', () => {
    assert.equal(textoDoResultado({ mensagem: '2 faturas.', totais: [{ rotulo: 'Total', valor: 'R$ 1.050,00' }] }), '2 faturas.\n\nTotal: R$ 1.050,00');
  });
  it('cartão de confirmação copiável', () => {
    assert.equal(textoDoCartao({ texto: '', titulo: 'Consultar propostas', linhas: ['Busca: "4725"'] }), 'Consultar propostas\nBusca: "4725"');
  });
  it('urlAbsoluta só aceita caminhos do próprio STI-hub', () => {
    assert.equal(urlAbsoluta('/interno/proposta/prop-1?pdf=1', 'https://sti-hub.setatelecom.com.br/'), 'https://sti-hub.setatelecom.com.br/interno/proposta/prop-1?pdf=1');
    assert.equal(urlAbsoluta('//evil.test/x', 'https://sti-hub.setatelecom.com.br'), '');
    assert.equal(urlAbsoluta('https://evil.test/x', 'https://sti-hub.setatelecom.com.br'), '');
  });
  it('"Abrir no sistema" usa as seções da busca global', () => {
    assert.deepEqual(ALVO_SECAO_ERP, { PROPOSAL: 'ORCAMENTOS', CONTRACT: 'CONTRATOS', INVOICE: 'FISCAL', SERVICE_ORDER: 'ORDENS_SERVICOS', CUSTOMER: 'CADASTROS' });
  });

  const painel = fs.readFileSync(path.join(process.cwd(), 'src/app/components/AssistenteIaPanel.tsx'), 'utf8');
  it('painel permite seleção (o cabeçalho tem select-none) e não bloqueia cópia', () => {
    assert.match(painel, /select-text/);
    assert.match(painel, /userSelect: 'text'/);
    assert.doesNotMatch(painel, /select-none|onCopy|oncopy|onContextMenu|onSelectStart|preventDefault\(\);\s*\}\s*\}\s*onCopy/);
    const header = fs.readFileSync(path.join(process.cwd(), 'src/app/page.tsx'), 'utf8');
    assert.match(header, /<header[^>]*select-none/, 'é por isso que o painel força select-text');
  });
  it('botão Copiar em cada resposta, "Copiado", copiar tabela e copiar cartão', () => {
    assert.match(painel, /'Copiado'/);
    assert.match(painel, /BotaoCopiar texto=\{it\.texto\}/);
    assert.match(painel, /textoDoResultado\(r\)/);
    assert.match(painel, /textoDoCartao\(/);
    assert.match(painel, /Copiar tabela/);
    assert.match(painel, /tabelaParaTsv\(r\.tabela\)/);
  });
  it('links do cliente são pedidos no clique pela rota existente; PDF sob demanda pela Versão contrato', () => {
    assert.match(painel, /requestSignedProposalLink\(a\.propostaId\)/);
    assert.match(painel, /requestSignedInvoiceLink\(a\.faturaId\)/);
    assert.match(painel, /\/api\/interno\/proposta\/\$\{encodeURIComponent\(a\.propostaId\)\}/);
    assert.match(painel, /downloadInternalProposalPdf\(/);
    assert.doesNotMatch(painel, /console\.(log|info|debug)/, 'nada de logar URL/token');
    assert.doesNotMatch(painel, /localStorage|sessionStorage/, 'o link não é guardado');
  });
  it('Versão contrato com ?pdf=1 baixa o PDF ao abrir (uma vez) e mantém o login', () => {
    const interno = fs.readFileSync(path.join(process.cwd(), 'src/app/interno/proposta/[id]/page.tsx'), 'utf8');
    assert.match(interno, /get\('pdf'\) !== '1'/);
    assert.match(interno, /pdfBaixado\.current = true;\s*downloadInternalProposalPdf\(model\)/);
    assert.match(interno, /\?pdf=1/);
  });
  it('"Abrir no sistema" ligado à navegação da tela', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'src/app/page.tsx'), 'utf8');
    assert.match(page, /onAbrirRegistro=\{\(alvo\) => \{/);
    assert.match(page, /setInitialTicketIdForDrawer\(alvo\.id\)/);
    assert.match(page, /ALVO_SECAO_ERP\[alvo\.type\]/);
  });
});
