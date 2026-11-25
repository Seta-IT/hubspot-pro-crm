// ============================================================================
// STI-hub — Assistente: conversas separadas e persistentes, encerrar/apagar e aprendizado
// contínuo (t170u, 25/11/2026).
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryAssistenteStore, ASSISTENTE_MIGRATIONS, sanearItem, tituloAutomatico } from '../src/modules/assistente/conversas-store';
import { CONFIRMA_APAGAR_TODAS, handleAssistenteApi } from '../src/modules/assistente/conversas-api';
import { blocoMemoriasParaPrompt, contemSegredo, detectarLicao, selecionarMemorias } from '../src/modules/assistente/memoria';
import { handleChat, type AssistenteDeps } from '../src/modules/assistente/service';
import type { AssistenteUser } from '../src/modules/assistente/tools';

const ANA: AssistenteUser = { uid: 'usr-ana', email: 'ana@seta.test', name: 'Ana', roleId: 'SALES_REP', moduleAccess: { crm: true, erp: true, chamados: true } };
const BIA: AssistenteUser = { ...ANA, uid: 'usr-bia', email: 'bia@seta.test', name: 'Bia' };
const GESTOR: AssistenteUser = { ...ANA, uid: 'usr-ger', roleId: 'SUPER_ADMIN' };
const api = (store: MemoryAssistenteStore, user: AssistenteUser) => (method: any, segs: string[], body?: unknown, query?: string) =>
  handleAssistenteApi({ method, segs, body, query: new URLSearchParams(query || '') }, user, store);

describe('conversas — CRUD, histórico e título automático', () => {
  it('cria, salva itens (com cartões e botões), lista com título da 1ª pergunta e busca', async () => {
    const store = new MemoryAssistenteStore();
    const ana = api(store, ANA);
    const c = await ana('POST', ['conversas']);
    assert.equal(c.status, 201);
    const id = (c.body.data as any).id;
    const salvar = await ana('POST', ['conversas', id, 'itens'], {
      itens: [
        { id: 'u1', item: { tipo: 'usuario', texto: 'gere uma proposta de 1 switch cisco 3850 para a Foxconn' } },
        { id: 'a1', item: { tipo: 'escolha_produto', texto: 'Encontrei 3 modelos', opcoes: [{ codigo: 'WS-C3850-48P-S' }] } },
        { id: 'a2', item: { tipo: 'proposta', estado: 'pendente', proposta: { token: 'tok-secreto-uso-unico', titulo: 'Criar rascunho de proposta', linhas: ['Tipo: Produtos'] } } },
      ],
    });
    assert.equal(salvar.status, 200);
    const lista = await ana('GET', ['conversas']);
    const r = (lista.body.data as any[])[0];
    assert.equal(r.titulo, 'Gere uma proposta de 1 switch cisco 3850 para a Foxconn');
    assert.equal(r.mensagens, 3);
    const aberta = await ana('GET', ['conversas', id]);
    const itens = (aberta.body.data as any).itens;
    assert.equal(itens[1].item.tipo, 'escolha_produto', 'cards/botões voltam ao reabrir');
    assert.equal(itens[2].item.proposta.token, undefined, 'token do cartão nunca é gravado');
    assert.equal(itens[2].item.estado, 'expirada');
    assert.equal(((await ana('GET', ['conversas'], undefined, 'busca=3850')).body.data as any[]).length, 1);
    assert.equal(((await ana('GET', ['conversas'], undefined, 'busca=fatura')).body.data as any[]).length, 0);
  });

  it('título automático curto; itens com PDF/base64 são limpos', () => {
    assert.equal(tituloAutomatico(''), 'Nova conversa');
    assert.ok(tituloAutomatico('a'.repeat(200)).length <= 61);
    const s = sanearItem({ tipo: 'resultado', resultado: { pdfBase64: 'xxx', arquivo: 'data:application/pdf;base64,AAAA', mensagem: 'ok' } })!;
    assert.deepEqual(s, { tipo: 'resultado', resultado: { mensagem: 'ok' } });
  });

  it('migração aditiva: só CREATE TABLE/INDEX IF NOT EXISTS (nada de DROP/ALTER destrutivo)', () => {
    for (const m of ASSISTENTE_MIGRATIONS) {
      assert.doesNotMatch(m.sql, /\bDROP\b|\bTRUNCATE\b|^\s*DELETE\b|\bALTER\b/im);
      for (const stmt of m.sql.split(';').map((x) => x.trim()).filter(Boolean)) assert.match(stmt, /^CREATE (TABLE|INDEX|UNIQUE INDEX) IF NOT EXISTS/i, stmt.slice(0, 60));
    }
  });
});

describe('conversas — encerrar, reabrir e apagar (só o dono, com confirmação e auditoria)', () => {
  it('encerrar deixa só leitura; reabrir permite continuar', async () => {
    const store = new MemoryAssistenteStore();
    const ana = api(store, ANA);
    const id = ((await ana('POST', ['conversas'])).body.data as any).id;
    const enc = await ana('PATCH', ['conversas', id], { status: 'encerrada' });
    assert.equal((enc.body.data as any).status, 'encerrada');
    assert.ok((enc.body.data as any).encerradaEm);
    const bloq = await ana('POST', ['conversas', id, 'itens'], { itens: [{ id: 'u1', item: { tipo: 'usuario', texto: 'oi' } }] });
    assert.equal(bloq.status, 409);
    await ana('PATCH', ['conversas', id], { status: 'aberta' });
    assert.equal((await ana('POST', ['conversas', id, 'itens'], { itens: [{ id: 'u1', item: { tipo: 'usuario', texto: 'oi' } }] })).status, 200);
    assert.deepEqual(store.auditoria.map((a) => a.acao), ['conversa.encerrar', 'conversa.reabrir']);
  });

  it('apagar exige confirmação; outro usuário não lê, não encerra e não apaga (404)', async () => {
    const store = new MemoryAssistenteStore();
    const ana = api(store, ANA);
    const bia = api(store, BIA);
    const id = ((await ana('POST', ['conversas'])).body.data as any).id;
    assert.equal((await bia('GET', ['conversas', id])).status, 404);
    assert.equal((await bia('PATCH', ['conversas', id], { status: 'encerrada' })).status, 404);
    assert.equal((await bia('DELETE', ['conversas', id], { confirmar: true })).status, 404);
    assert.equal((await bia('GET', ['conversas'])).body.data instanceof Array && ((await bia('GET', ['conversas'])).body.data as any[]).length, 0);
    assert.equal((await ana('DELETE', ['conversas', id])).status, 400, 'sem confirmação não apaga');
    assert.equal((await ana('DELETE', ['conversas', id], { confirmar: true })).status, 200);
    assert.equal((await ana('GET', ['conversas', id])).status, 404);
    const aud = store.auditoria.find((a) => a.acao === 'conversa.apagar')!;
    assert.equal(aud.ownerUid, ANA.uid);
    assert.equal(aud.alvo, id);
  });

  it('"apagar todas as minhas conversas" com confirmação apaga só as do dono', async () => {
    const store = new MemoryAssistenteStore();
    const ana = api(store, ANA);
    const bia = api(store, BIA);
    await ana('POST', ['conversas']);
    await ana('POST', ['conversas']);
    await bia('POST', ['conversas']);
    assert.equal((await ana('DELETE', ['conversas'], { confirmar: 'sim' })).status, 400);
    const r = await ana('DELETE', ['conversas'], { confirmar: CONFIRMA_APAGAR_TODAS });
    assert.equal(r.body.apagadas, 2);
    assert.equal(((await bia('GET', ['conversas'])).body.data as any[]).length, 1);
    assert.ok(store.auditoria.some((a) => a.acao === 'conversas.apagar_todas' && a.ownerUid === ANA.uid));
  });
});

describe('aprendizado contínuo — memória por usuário, segredos e Trava Fiscal', () => {
  it('detecta lições explícitas e recusa segredos e CNPJs misturados', () => {
    assert.deepEqual(detectarLicao('sempre coloque frete incluso nas propostas da Foxconn'), { ok: true, tipo: 'preferencia', texto: 'Sempre coloque frete incluso nas propostas da Foxconn', cnpj: null });
    assert.equal((detectarLicao('não é assim, é Ted e não Boleto') as any).tipo, 'correcao');
    assert.equal(detectarLicao('quais propostas estão abertas?'), null);
    assert.deepEqual(detectarLicao('lembre que minha senha do portal é abc123'), { ok: false, motivo: 'segredo' });
    assert.deepEqual(detectarLicao('sempre use o token sk-abcdefghijklmnop'), { ok: false, motivo: 'segredo' });
    assert.deepEqual(detectarLicao('sempre trate 11.222.333/0001-81 e 08.513.212/0001-30 juntos'), { ok: false, motivo: 'cnpjs_distintos' });
    assert.equal((detectarLicao('sempre use Pix para o CNPJ 08.513.212/0001-30') as any).cnpj, '08513212000130');
    assert.ok(contemSegredo('Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.x'));
    assert.ok(!contemSegredo('frete incluso para 08.513.212/0001-30'));
  });

  it('chat: "sempre ..." vira memória e entra no prompt das próximas conversas; outro CNPJ fica de fora', async () => {
    const store = new MemoryAssistenteStore();
    let ultimoPrompt = '';
    const d: AssistenteDeps = {
      llm: { async complete(msgs: any[]) { ultimoPrompt = msgs[0].content; return { text: 'ok', toolCalls: [], model: 't' }; } } as any,
      api: async () => ({ status: 404, body: {} }),
      user: ANA,
      secret: 'segredo-teste-conversas-0123456789abcdef',
      sid: 's',
      now: () => Date.now(),
      rateLimit: async () => true,
      consumeNonce: async () => true,
      audit: async () => {},
      aprendizado: {
        listarMemorias: () => store.listarMemorias(ANA.uid),
        criarMemoria: (m: any) => store.criarMemoria(ANA.uid, m),
        listarRegras: () => store.listarRegras(),
      },
    };
    const r = await handleChat({ mensagens: [{ papel: 'usuario', texto: 'sempre responda com o número da proposta em negrito' }] }, d);
    assert.match(String(r.body.texto), /^Anotado/);
    await handleChat({ mensagens: [{ papel: 'usuario', texto: 'sempre use Pix para o CNPJ 08.513.212/0001-30' }] }, d);
    assert.equal((await store.listarMemorias(ANA.uid)).length, 2);
    assert.equal((await store.listarMemorias(BIA.uid)).length, 0, 'memória é por usuário');
    // Conversa nova, sem o CNPJ: só a lição geral entra no prompt.
    await handleChat({ mensagens: [{ papel: 'usuario', texto: 'escreva uma frase curta de boas-vindas' }] }, d);
    assert.match(ultimoPrompt, /O que este usuário já ensinou/);
    assert.match(ultimoPrompt, /número da proposta em negrito/);
    assert.doesNotMatch(ultimoPrompt, /Pix para o CNPJ/);
    // Conversa sobre o CNPJ: a lição dele entra (Trava Fiscal: só o mesmo CNPJ).
    const mems = await store.listarMemorias(ANA.uid);
    const comCnpj = blocoMemoriasParaPrompt(selecionarMemorias(mems, [{ texto: 'proposta para 08.513.212/0001-30' }]));
    assert.match(comCnpj, /Pix para o CNPJ/);
    const outroCnpj = blocoMemoriasParaPrompt(selecionarMemorias(mems, [{ texto: 'proposta para 11.222.333/0001-81' }]));
    assert.doesNotMatch(outroCnpj, /Pix para o CNPJ/);
    // Segredo nunca é aprendido.
    const s = await handleChat({ mensagens: [{ papel: 'usuario', texto: 'lembre que a senha do ERP é Seta@2026' }] }, d);
    assert.match(String(s.body.texto), /Não guardo senhas/);
    assert.equal((await store.listarMemorias(ANA.uid)).length, 2);
  });

  it('tela "O que o assistente aprendeu": listar, editar, desativar e apagar; 👎 com motivo vira lição', async () => {
    const store = new MemoryAssistenteStore();
    const ana = api(store, ANA);
    const bia = api(store, BIA);
    const m = await ana('POST', ['memorias'], { texto: 'Prefiro propostas com validade de 10 dias' });
    assert.equal(m.status, 201);
    const mid = (m.body.data as any).id;
    assert.equal((await ana('POST', ['memorias'], { texto: 'lembre do token ghp_abcdefghijklmnopqrstuvwxyz' })).status, 400);
    assert.equal((await ana('PATCH', ['memorias', mid], { texto: 'Prefiro validade de 15 dias' })).status, 200);
    assert.equal((await bia('PATCH', ['memorias', mid], { ativa: false })).status, 404, 'outro usuário não edita');
    assert.equal((await bia('DELETE', ['memorias', mid])).status, 404);
    assert.equal((await ana('PATCH', ['memorias', mid], { ativa: false })).status, 200);
    const sel = selecionarMemorias(await store.listarMemorias(ANA.uid), [{ texto: 'validade' }]);
    assert.equal(sel.length, 0, 'desativada não entra no prompt');
    // Feedback 👎 com motivo
    const cid = ((await ana('POST', ['conversas'])).body.data as any).id;
    await ana('POST', ['conversas', cid, 'itens'], { itens: [{ id: 'a1', item: { tipo: 'assistente', texto: 'resposta' } }] });
    const fb = await ana('POST', ['conversas', cid, 'feedback'], { itemId: 'a1', nota: 'negativo', motivo: 'faltou o link da proposta', pergunta: 'traga a proposta 4709' });
    assert.equal(fb.status, 200);
    const mems = await store.listarMemorias(ANA.uid);
    const licao = mems.find((x) => x.tipo === 'feedback')!;
    assert.match(licao.texto, /Resposta reprovada para "traga a proposta 4709": faltou o link da proposta/);
    assert.match(blocoMemoriasParaPrompt([licao]), /Feedback: Resposta reprovada/);
    assert.equal((await ana('DELETE', ['memorias', mid])).status, 200);
    assert.ok(store.auditoria.some((a) => a.acao === 'memoria.apagar'));
  });

  it('regras de acessórios: todos leem; só gestor edita', async () => {
    const store = new MemoryAssistenteStore();
    const ana = api(store, ANA);
    const ger = api(store, GESTOR);
    assert.equal((await ana('GET', ['regras'])).body.podeEditar, false);
    assert.equal((await ana('POST', ['regras'], { familia: 'C9200-*', categoria: 'fonte', padrao: 'PWR-C5-*' })).status, 403);
    const r = await ger('POST', ['regras'], { familia: 'c9200-*', categoria: 'fonte', padrao: 'pwr-c5-*', excluir: '*BLANK*' });
    assert.equal(r.status, 201);
    assert.equal((r.body.data as any).familia, 'C9200-*');
    assert.equal((await ger('POST', ['regras'], { familia: 'x; DROP TABLE', categoria: 'fonte', padrao: 'y' })).status, 400);
  });
});
