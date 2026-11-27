// ============================================================================
// STI-hub — Assistente de IA (etapa 1): fluxo de conversa e de confirmacao.
//
// 1) POST /api/assistente/chat: o modelo (OmniRoute) responde em texto ou PROPOE uma acao.
//    Nada e executado aqui: a proposta volta assinada (token) com um resumo para o cartao.
// 2) POST /api/assistente/executar: so depois do "Confirmar" do usuario. O servidor confere
//    o token (usuario + sessao + validade + uso unico), revalida os argumentos e executa a
//    ferramenta pelas rotas da tela com a sessao do usuario. Toda execucao vai para a auditoria.
// O modelo nunca recebe dados do sistema nem segredos; so as mensagens do usuario (redigidas).
// ============================================================================
import {
  PERGUNTA_SERVICO_MODO, PERGUNTA_TIPO_PROPOSTA, ehPerguntaFluxoProposta, ehPerguntaModoServico, ehPerguntaTipo, pedidoNovaProposta, pedidoSemDetalhes, perguntaCamposDoTipo,
  tipoPropostaDaConversa, tipoPropostaNoTexto,
} from './proposta-tipo';
import { z } from 'zod';
import { ASSISTENTE_LIMITS } from './config';
import { LlmError, type LlmClient, type LlmMessage } from './omniroute-client';
import {
  getTool,
  parseNumeroBR,
  toolDefinitionsFor,
  userCanUseTool,
  type ApiCaller,
  type AssistenteUser,
  type ToolResult,
} from './tools';
import { signActionToken, verifyActionToken } from './confirmation';
import { rotearPergunta, hojeIso } from './roteador';
import { resumoConhecimentoParaPrompt } from './conhecimento';
import { exemplosDialogoParaPrompt } from './treinamento';
import { avancarFluxo, fluxoSchema, respostaCurtaDeCampo, selecaoSchema, textoMemoriaSugestao, type SaidaFluxo } from './fluxo-proposta';
import { RESPOSTA_LICAO_CNPJS, RESPOSTA_LICAO_SEGREDO, blocoMemoriasParaPrompt, detectarLicao, respostaLicaoGravada, selecionarMemorias } from './memoria';
import type { MemoriaAprendida, RegraAcessorio, TipoMemoria } from './conversas-store';
import { PERGUNTA_QUAL_REGISTRO, marcaContexto, registroEmContexto, rotaDoContexto, termoGenerico, type RegistroContexto } from './contexto';

export interface AssistenteAuditEntry {
  tool: string;
  tipo: 'leitura' | 'gravacao';
  modulo: 'CRM' | 'ERP' | 'CHAMADOS';
  ok: boolean;
  status: number;
  titulo: string;
  detalhe: string;
  registro?: string;
}

export interface AssistenteDeps {
  llm: LlmClient | null;
  api: ApiCaller;
  user: AssistenteUser;
  secret: string;
  /** Vinculo da sessao (hash), nunca o token. */
  sid: string;
  now(): number;
  /** true = dentro do limite. */
  rateLimit(bucket: string, limit: number, windowMs: number): Promise<boolean>;
  /** true = primeiro uso do nonce (false = ja usado). */
  consumeNonce(nonce: string, ttlMs: number): Promise<boolean>;
  audit(entry: AssistenteAuditEntry): Promise<void>;
  /** Aprendizado contínuo (memória do usuário e regras de acessórios). Opcional em testes antigos. */
  aprendizado?: {
    listarMemorias(): Promise<MemoriaAprendida[]>;
    criarMemoria(m: { tipo: TipoMemoria; texto: string; cnpj?: string | null; dados?: MemoriaAprendida['dados'] }): Promise<MemoriaAprendida | null>;
    listarRegras(): Promise<RegraAcessorio[]>;
  };
}

export interface ServiceResponse {
  status: number;
  body: Record<string, unknown>;
}

const err = (status: number, code: string, error: string): ServiceResponse => ({ status, body: { error, code } });

// ---------------------------------------------------------------------------
// Protecoes de conteudo
// ---------------------------------------------------------------------------
/** Remove do texto qualquer coisa com cara de segredo antes de mandar ao modelo. */
export function redactSecrets(text: string): string {
  return String(text || '')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '[removido]')
    .replace(/\b(?:stihub_svc_|sk-|sk_|pk_|ghp_|gho_|xox[abpr]-|AKIA)[A-Za-z0-9._-]{6,}/g, '[removido]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+)?/g, '[removido]')
    .replace(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, '[removido]')
    .replace(/\b(senha|password|token|secret|chave|api[_ -]?key)\s*[:=]\s*\S+/gi, '$1: [removido]')
    .replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, '[removido]');
}

const mensagemSchema = z.object({
  papel: z.enum(['usuario', 'assistente']),
  texto: z.string().max(ASSISTENTE_LIMITS.maxMessageChars * 2),
});
const chatSchema = z.object({
  mensagens: z.array(mensagemSchema).min(1).max(60),
  /** Estado do rascunho de proposta pendente nesta conversa (slot-filling). */
  fluxo: fluxoSchema.nullable().optional(),
  /** Clique numa lista (modelo, acessórios, empresa, tipo). */
  selecao: selecaoSchema.optional(),
  conversaId: z.string().max(80).optional(),
});
const execSchema = z.object({ token: z.string().min(10).max(16_000), confirmar: z.boolean() });

function systemPrompt(user: AssistenteUser, now: number, memorias = ''): string {
  const hoje = hojeIso(now);
  const mods = [user.moduleAccess.crm && 'CRM', user.moduleAccess.erp && 'ERP', user.moduleAccess.chamados && 'STI HUB Desk Service'].filter(Boolean).join(', ') || 'nenhum';
  return [
    'Você é o Assistente do STI-hub, sistema da Seta Telecom com STI HUB CRM, STI HUB ERP e STI HUB Desk Service.',
    'Responda sempre em português do Brasil, de forma curta e direta, sem emojis. Quando houver registro, cite o número dele.',
    `Hoje é ${hoje} (horário de Brasília). Módulos liberados para este usuário: ${mods}.`,
    'Entenda pedidos informais, com erros de digitação e sinônimos: orçamento = proposta; OS = O.S. = ordem de serviço; NF/NF-e/NFS-e/NFCom = nota fiscal; boleto/cobrança = fatura; cliente = empresa; chamado = ticket. Converta datas relativas (hoje, ontem, mês passado, semana passada, últimos 30 dias, outubro) para AAAA-MM-DD.',
    'Faça a ação que o usuário pediu. Para consulta, relatório, proposta, chamado ou OS, chame UMA ferramenta por resposta.',
    'Para achar qualquer registro por número, código prop-..., link colado (/proposta/..., /interno/proposta/..., /p/...), contrato, fatura, nota ou chave de 44 dígitos, OS, chave de chamado (ex.: SETA-123), CNPJ/CPF, e-mail, telefone ou nome parcial, use buscar. Se perguntarem por que algo "não abre" ou "não foi localizado", use buscar com contexto nao_abre. Nunca diga que não encontrou algo sem chamar uma ferramenta: você não vê os dados.',
    'Listas e relatórios: consultar/relatorio com a entidade certa (contratos, vendas, ordens_servico, empresas, fornecedores, contatos, faturas, notas_fiscais, contas_receber, contas_pagar, produtos, estoque, chamados, negocios) e situação quando dita (vencido, aberto, pago, ATIVO, ENCERRADO, sem estoque). Painel do mês (feitas x aprovadas, faturado): painel.',
    'Proposta ou orçamento existente (tem número, ex.: 4709): para ver, use consultar_propostas; para mudar (acrescentar item ou despesa, alterar quantidade, valor ou campos), use editar_proposta direto com o número, sem consultar antes. Nunca use consultar com entidade negocios para propostas ou orçamentos.',
    'Valores em reais chegam no formato brasileiro (2800,00 ou 2.800,00 = dois mil e oitocentos): envie como número 2800.00.',
    'Ex.: "localize a proposta 4709 e adicione 2800,00 de despesas de locomoção e hospedagem" => editar_proposta {proposta:"4709", adicionar_itens:[{descricao:"Despesas de locomoção e hospedagem", valor_unitario:2800, tipo:"despesa", cobranca:"unica"}]}.',
    'Proposta ou orçamento novo: o PRIMEIRO passo é o tipo. Se o usuário não disse o tipo, não chame ferramenta: pergunte "Qual é o tipo da proposta? 1. Produtos (venda) 2. Serviços — pontual (pagamento único) 3. Serviços — mensal 4. Locação". Se disse só "serviço", pergunte se é pontual ou mensal.',
    'Com o tipo definido, peça os campos certos dele (só os que faltam): Locação = equipamentos e quantidades, prazo em meses, mensalidade por item, setup/ativação à parte (valor único, nunca somado na mensalidade) e índice de reajuste (IPCA, IGP-M, IST Anatel ou fixo); Serviço mensal = serviços, prazo em meses, valor mensal, setup/implantação opcional e índice de reajuste; Serviço pontual = descrição e valor do serviço (pagamento único, sem prazo em meses); Produtos = itens, quantidades, valor unitário, frete e prazo de entrega. Em todos: cliente e forma de pagamento.',
    'Forma de pagamento: só Boleto, Pix ou Ted / Transferência (forma_pagamento boleto, pix ou ted). Nunca ofereça nem aceite cartão.',
    'Quando tiver tipo, cliente e itens, chame criar_rascunho_proposta com tipo_proposta, sem consultar empresas antes (o sistema identifica a empresa e pergunta se houver mais de uma). Valor não dito: omita (fica a definir).',
    'Ex.: "proposta de locação de 36 meses para X de 3 servidores Dell R640 com 256 GB, mensalidade 1.500,00 cada, setup 800,00, IPCA, boleto" => criar_rascunho_proposta {cliente:"X", tipo_proposta:"locacao", prazo_meses:36, itens:[{descricao:"Servidor Dell R640, 256 GB RAM", quantidade:3, valor_unitario:1500}], setup:800, indice_reajuste:"IPCA", forma_pagamento:"boleto"}.',
    'Use o histórico: se o usuário já pediu uma proposta e agora escolheu ou confirmou a empresa (por nome, CNPJ ou número da lista), chame criar_rascunho_proposta com essa empresa, o tipo e os itens do pedido original.',
    'Link, PDF, Versão contrato ou dados completos "da proposta/dela/desse orçamento" sem número: use o "Registro em contexto" do histórico (consultar_propostas com esse número). Nunca use "link", "pdf", "proposta" ou "contrato" como termo de busca; sem registro no histórico, pergunte qual é o número. Os botões de link do cliente, Versão contrato e PDF aparecem junto do resultado.',
    'Não repita uma consulta que já está no histórico. Resultados chegam como "Resultado: ..." com o mínimo (quantidade e, para empresas, nome e CNPJ); o resto é mostrado direto ao usuário. Nunca invente números, nomes ou registros.',
    'Se houver mais de uma empresa possível, pergunte qual, listando as opções. Se faltar algo que impeça a ação (ex.: nenhum item), pergunte só isso.',
    'Consultas, buscas, relatórios e painel executam na hora e o resultado aparece direto para o usuário. Ações que gravam ou alteram dados (rascunho, edição de proposta, chamado, OS) passam por um cartão de confirmação: para essas, não diga que algo foi feito, diga que preparou a ação para confirmação.',
    'Datas sempre no formato AAAA-MM-DD nos argumentos.',
    'Fora do seu escopo: emitir nota fiscal, emitir recibo, dar baixa em pagamento, aprovar ou converter proposta, enviar e-mail, WhatsApp ou qualquer mensagem a clientes, excluir registros e alterar usuários ou permissões. Se pedirem, explique que ainda não está disponível e indique a tela do sistema.',
    'Nunca peça nem repita senhas, tokens ou chaves.',
    'Rascunho em andamento: use o histórico inteiro da conversa. Não pergunte de novo o que já foi respondido (tipo, cliente, itens, prazo, valor, forma, reajuste). Se o usuário repetir o pedido, reaproveite o que já foi dito e pergunte só o que falta. Valores como 45,00/mês, 45,00/mes, 45 mensal ou com erro de digitação ("45,00/m6es") são a mensalidade; "por 24 meses" é o prazo do contrato.',
    exemplosDialogoParaPrompt(),
    'Base de conhecimento do STI-hub (use para dúvidas de "como faço", regras e erros; responda em texto, sem ferramenta):',
    resumoConhecimentoParaPrompt(),
    ...(memorias ? [memorias] : []),
  ].join('\n');
}

function buildHistory(mensagens: Array<{ papel: 'usuario' | 'assistente'; texto: string }>): LlmMessage[] | null {
  const recent = mensagens.slice(-ASSISTENTE_LIMITS.maxHistoryMessages);
  const out: LlmMessage[] = [];
  let total = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i];
    const texto = redactSecrets(m.texto.slice(0, ASSISTENTE_LIMITS.maxMessageChars)).trim();
    if (!texto) continue;
    if (total + texto.length > ASSISTENTE_LIMITS.maxHistoryChars) break;
    total += texto.length;
    out.unshift({ role: m.papel === 'usuario' ? 'user' : 'assistant', content: texto });
  }
  return out.length && out[out.length - 1].role === 'user' ? out : null;
}

/** Remove null/'' que os modelos costumam mandar em campos opcionais. */
export function cleanArgs(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(cleanArgs);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val === null || val === undefined || (typeof val === 'string' && !val.trim())) continue;
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      out[k] = cleanArgs(val);
    }
    return out;
  }
  if (typeof v === 'string' && /^-?\d+(?:[.,]\d+)?$/.test(v.trim())) return v; // numeros em texto ficam para o zod recusar
  return v;
}

function coerceNumbers(tool: string, args: any): any {
  // Modelos as vezes mandam "1500" em vez de 1500 nos itens; converte so campos numericos conhecidos.
  const num = parseNumeroBR; // "2.800,00", "2800,00", "R$ 2.800" => 2800
  if (tool === 'criar_rascunho_proposta' && Array.isArray(args?.itens)) {
    args.itens = args.itens.map((i: any) => (i && typeof i === 'object' ? { ...i, quantidade: num(i.quantidade), valor_unitario: num(i.valor_unitario) } : i));
  }
  if ((tool === 'consultar' || tool === 'relatorio') && args && 'limite' in args) args.limite = num(args.limite);
  if (tool === 'criar_rascunho_proposta' && args && 'prazo_meses' in args) args.prazo_meses = num(args.prazo_meses);
  return args;
}

const MODULO_ROTULO: Record<string, string> = { crm: 'CRM', erp: 'ERP', chamados: 'STI HUB Desk Service' };

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
export async function handleChat(rawBody: unknown, deps: AssistenteDeps): Promise<ServiceResponse> {
  const parsed = chatSchema.safeParse(rawBody);
  if (!parsed.success) return err(400, 'ENTRADA_INVALIDA', 'Mensagem inválida.');
  const last = parsed.data.mensagens[parsed.data.mensagens.length - 1];
  if (last.papel !== 'usuario' || !last.texto.trim()) return err(400, 'ENTRADA_INVALIDA', 'Envie uma mensagem.');
  if (last.texto.length > ASSISTENTE_LIMITS.maxMessageChars) {
    return err(413, 'MENSAGEM_LONGA', `Mensagem acima de ${ASSISTENTE_LIMITS.maxMessageChars} caracteres.`);
  }
  const uid = deps.user.uid;
  if (!(await deps.rateLimit(`chat:m:${uid}`, ASSISTENTE_LIMITS.perUserPerMinute, 60_000))) {
    return err(429, 'LIMITE_MENSAGENS', 'Muitas mensagens em pouco tempo. Aguarde um minuto.');
  }
  if (!(await deps.rateLimit(`chat:h:${uid}`, ASSISTENTE_LIMITS.perUserPerHour, 3_600_000))) {
    return err(429, 'LIMITE_MENSAGENS', 'Limite de mensagens por hora atingido. Tente mais tarde.');
  }
  const history = buildHistory(parsed.data.mensagens);
  if (!history) return err(400, 'ENTRADA_INVALIDA', 'Envie uma mensagem.');

  // Aprendizado: lição explícita ("sempre faça X", "não é assim, é Y") vira memória do usuário.
  if (!parsed.data.selecao) {
    const licao = detectarLicao(last.texto);
    if (licao && deps.aprendizado) {
      if (!licao.ok) return { status: 200, body: { tipo: 'texto', texto: licao.motivo === 'segredo' ? RESPOSTA_LICAO_SEGREDO : RESPOSTA_LICAO_CNPJS, fluxo: parsed.data.fluxo ?? null } };
      const m = await deps.aprendizado.criarMemoria({ tipo: licao.tipo, texto: licao.texto, cnpj: licao.cnpj }).catch(() => null);
      if (m) return { status: 200, body: { tipo: 'texto', texto: respostaLicaoGravada(m.texto, m.cnpj), memoria: { id: m.id }, fluxo: parsed.data.fluxo ?? null } };
    }
  }

  let memorias: MemoriaAprendida[] = [];
  let regras: RegraAcessorio[] = [];
  if (deps.aprendizado) {
    [memorias, regras] = await Promise.all([deps.aprendizado.listarMemorias().catch(() => []), deps.aprendizado.listarRegras().catch(() => [])]);
  }

  // Rascunho de proposta guiado (tipo inferido, cadastro de produtos, acessórios, slot-filling).
  if (deps.user.moduleAccess.erp) {
    let saida: SaidaFluxo | null = null;
    try {
      saida = await avancarFluxo(
        { texto: last.texto, selecao: parsed.data.selecao ?? null, fluxo: parsed.data.fluxo ?? null, mensagens: parsed.data.mensagens },
        {
          api: deps.api,
          memorias,
          regras,
          aprender: deps.aprendizado
            ? async ({ familia, item, aceito }) => {
                const texto = textoMemoriaSugestao(familia, item);
                const atual = memorias.find((m) => m.tipo === 'sugestao' && m.texto === texto);
                const aceitos = Number(atual?.dados?.aceitos || 0) + (aceito ? 1 : 0);
                const recusados = Number(atual?.dados?.recusados || 0) + (aceito ? 0 : 1);
                await deps.aprendizado!.criarMemoria({ tipo: 'sugestao', texto, dados: { base: familia, item, aceitos, recusados } });
              }
            : undefined,
        },
      );
    } catch {
      saida = { tipo: 'texto', texto: 'Não consegui continuar o rascunho agora. Tente de novo.', fluxo: parsed.data.fluxo ?? null };
    }
    if (saida && saida.tipo !== 'servico' && saida.tipo !== 'legado') return respostaFluxo(saida, deps, parsed.data.mensagens);
  } else if (parsed.data.selecao) {
    return { status: 200, body: { tipo: 'texto', texto: 'Seu usuário não tem acesso ao módulo ERP, então não posso montar propostas.', fluxo: null } };
  }
  if (parsed.data.selecao) return { status: 200, body: { tipo: 'texto', texto: 'Essa lista expirou. Peça a proposta de novo.', fluxo: null } };
  if (!deps.llm) return err(503, 'ASSISTENTE_DESLIGADO', 'O assistente de IA ainda não está configurado neste ambiente.');

  // Proposta nova de serviço: primeiro o tipo, depois os campos do tipo (sem depender do modelo).
  const fluxo = fluxoNovaProposta(parsed.data.mensagens, deps.user);
  if (fluxo) return { status: 200, body: { tipo: 'texto', texto: fluxo } };

  // Roteador deterministico: duvidas do sistema e buscas/listas claras sem depender do modelo.
  // A ferramenta continua so PROPOSTA (cartao de confirmacao), igual a do modelo.
  let rota: ReturnType<typeof rotearPergunta> = null;
  let contexto: RegistroContexto | null = null;
  try {
    contexto = registroEmContexto(parsed.data.mensagens);
  } catch {
    contexto = null;
  }
  try {
    const msgs = parsed.data.mensagens;
    const anterior = msgs.length >= 2 ? msgs[msgs.length - 2] : null;
    const respondendoPergunta = !!anterior && anterior.papel === 'assistente' && (/\?\s*$/.test(anterior.texto.trim()) || ehPerguntaFluxoProposta(anterior.texto));
    // Resposta a "Qual proposta ou registro você quer?": número puro = número do orçamento.
    const respostaQual = !!anterior && anterior.papel === 'assistente' && anterior.texto.trim() === PERGUNTA_QUAL_REGISTRO && /^\s*(?:n[ºo°]?\s*)?#?\d{1,7}\s*$/i.test(last.texto);
    const textoRota = respostaQual ? `orçamento ${last.texto.replace(/\D+/g, '')}` : last.texto;
    // Pedido de proposta nova com dados: vai ao modelo (que monta o rascunho), nunca vira consulta.
    // t195u: resposta curta a uma pergunta do rascunho ("boleto", "IGP-M", "sim") também nunca
    // vira consulta (antes "boleto" abria "Consultar faturas").
    const respostaDoRascunho = !!anterior && anterior.papel === 'assistente' && respostaCurtaDeCampo(last.texto) &&
      anterior.texto.trim() !== PERGUNTA_QUAL_REGISTRO &&
      (ehPerguntaFluxoProposta(anterior.texto) || /forma de pagamento|reajuste|prazo do contrato|rascunho/i.test(anterior.texto));
    rota = pedidoNovaProposta(last.texto) || respostaDoRascunho ? null : rotearPergunta(textoRota, { agora: deps.now(), respondendoPergunta, contexto });
  } catch {
    rota = null;
  }
  if (rota?.tipo === 'texto') return { status: 200, body: { tipo: 'texto', texto: rota.texto } };
  if (rota?.tipo === 'ferramenta') {
    const t = getTool(rota.ferramenta);
    if (t && t.disponivel(deps.user) && userCanUseTool(t, rota.args, deps.user)) {
      const viaRota = await proporAcao(t.name, rota.args, '', deps, parsed.data.mensagens);
      if (viaRota.status === 200 && (viaRota.body.tipo === 'proposta' || viaRota.body.tipo === 'resultado')) return viaRota;
      if (viaRota.status === 429) return viaRota;
    }
  }

  let result;
  try {
    const bloco = blocoMemoriasParaPrompt(selecionarMemorias(memorias, parsed.data.mensagens));
    result = await deps.llm.complete([{ role: 'system', content: systemPrompt(deps.user, deps.now(), bloco) }, ...history], toolDefinitionsFor(deps.user));
  } catch (e) {
    const code = e instanceof LlmError ? e.code : 'LLM_UNAVAILABLE';
    if (code === 'LLM_RATE_LIMITED') return err(429, code, 'O provedor de IA está no limite de uso. Tente de novo em instantes.');
    if (code === 'LLM_TIMEOUT') return err(504, code, 'O provedor de IA demorou demais. Tente de novo.');
    return err(502, code, 'O provedor de IA está indisponível agora. Tente de novo em instantes.');
  }

  const call = result.toolCalls[0];
  if (!call) {
    const texto = (result.text || '').slice(0, 4000) || 'Não entendi. Pode reformular?';
    return { status: 200, body: { tipo: 'texto', texto } };
  }
  // O modelo as vezes manda "link"/"pdf"/"proposta" como termo de busca: usa o registro em contexto.
  const ajuste = ajustarPorContexto(call.name, call.args || {}, contexto);
  if ('texto' in ajuste) return { status: 200, body: { tipo: 'texto', texto: ajuste.texto } };
  return proporAcao(ajuste.nome, ajuste.args, result.text || '', deps, parsed.data.mensagens);
}

type Msg = { papel: 'usuario' | 'assistente'; texto: string };

/** Saída do fluxo guiado => corpo da resposta (cartão de confirmação só via proporAcao). */
async function respostaFluxo(saida: Exclude<SaidaFluxo, { tipo: 'servico' } | { tipo: 'legado' }>, deps: AssistenteDeps, mensagens: Msg[]): Promise<ServiceResponse> {
  if (saida.tipo === 'cartao') {
    const r = await proporAcao('criar_rascunho_proposta', saida.args, saida.texto, deps, mensagens);
    if (r.status === 200) r.body = { ...r.body, fluxo: saida.fluxo };
    return r;
  }
  return { status: 200, body: { ...saida } };
}

/**
 * Passos de texto do rascunho de proposta: pergunta o tipo, o modo do servico e os campos
 * do tipo. Null = segue o fluxo normal (o modelo monta o rascunho com os dados).
 */
export function fluxoNovaProposta(mensagens: Msg[], user: AssistenteUser): string | null {
  const last = mensagens[mensagens.length - 1];
  if (!last || last.papel !== 'usuario') return null;
  const anterior = mensagens.length >= 2 ? mensagens[mensagens.length - 2] : null;
  const aposTipo = !!anterior && anterior.papel === 'assistente' && ehPerguntaTipo(anterior.texto);
  const aposModo = !!anterior && anterior.papel === 'assistente' && ehPerguntaModoServico(anterior.texto);
  const pedido = pedidoNovaProposta(last.texto);
  if (!aposTipo && !aposModo && !pedido) return null;
  if (!user.moduleAccess.erp) return pedido ? 'Seu usuário não tem acesso ao módulo ERP, então não posso montar propostas.' : null;
  const tipo = tipoPropostaNoTexto(last.texto, aposTipo);
  if (aposTipo || aposModo) {
    if (tipo === 'servico') return PERGUNTA_SERVICO_MODO;
    if (aposModo && tipo !== 'servico_pontual' && tipo !== 'servico_mensal') {
      const modo = tipoPropostaNoTexto(`servico ${last.texto}`);
      if (modo === 'servico_pontual' || modo === 'servico_mensal') return pedidoSemDetalhes(last.texto) ? perguntaCamposDoTipo(modo) : null;
      return null;
    }
    if (!tipo) return null; // resposta fora do esperado: o modelo le o historico
    // O pedido original ja trazia cliente/itens: o modelo monta com o historico + o tipo.
    const pedidoOriginal = mensagens.length >= 3 ? mensagens[mensagens.length - 3] : null;
    if (pedidoOriginal && pedidoOriginal.papel === 'usuario' && !pedidoSemDetalhes(pedidoOriginal.texto)) return null;
    const soOpcao = aposTipo && /^\s*(?:opcao\s*|tipo\s*)?[1-4]\s*[).:-]?\s*$/i.test(last.texto);
    return soOpcao || pedidoSemDetalhes(last.texto) ? perguntaCamposDoTipo(tipo) : null;
  }
  if (!tipo) return PERGUNTA_TIPO_PROPOSTA;
  if (tipo === 'servico') return PERGUNTA_SERVICO_MODO;
  return pedidoSemDetalhes(last.texto) ? perguntaCamposDoTipo(tipo) : null;
}

/** Busca so com palavra generica => registro em contexto (ou pergunta qual). */
export function ajustarPorContexto(
  nome: string,
  args: any,
  contexto: RegistroContexto | null,
): { nome: string; args: any } | { texto: string } {
  const generico =
    (nome === 'consultar_propostas' && args && typeof args.busca === 'string' && termoGenerico(args.busca) && !args.status && !args.de && !args.ate) ||
    (nome === 'buscar' && args && termoGenerico(args.termo));
  if (!generico) return { nome, args };
  if (!contexto) return { texto: PERGUNTA_QUAL_REGISTRO };
  const r = rotaDoContexto(contexto);
  return { nome: r.ferramenta, args: r.args };
}

/** Valida, confere modulos, prepara (so leitura) e assina a proposta de acao para o cartao. */
async function proporAcao(nome: string, rawArgs: unknown, textoModelo: string, deps: AssistenteDeps, mensagens: Msg[] = []): Promise<ServiceResponse> {
  const uid = deps.user.uid;
  const tool = getTool(nome);
  if (!tool) return { status: 200, body: { tipo: 'texto', texto: 'Essa ação não está disponível nesta etapa do assistente.' } };
  const cleaned: any = coerceNumbers(tool.name, cleanArgs(rawArgs || {}));
  // Modelo que esquece o tipo da proposta: usa o que o USUARIO ja escolheu na conversa (nunca chuta).
  if (tool.name === 'criar_rascunho_proposta' && cleaned && typeof cleaned === 'object' && !cleaned.tipo_proposta) {
    const tipoConversa = tipoPropostaDaConversa(mensagens);
    if (tipoConversa) cleaned.tipo_proposta = tipoConversa;
  }
  const args = tool.coagir ? tool.coagir(cleaned) : cleaned;
  if (tool.faltando && tool.disponivel(deps.user)) {
    const pergunta = tool.faltando(args);
    if (pergunta) return { status: 200, body: { tipo: 'texto', texto: pergunta } };
  }
  const valid = tool.schema.safeParse(args);
  if (!valid.success) {
    const campos = valid.error.issues.map((i) => i.path.join('.') || '(dados)').slice(0, 6).join(', ');
    return { status: 200, body: { tipo: 'texto', texto: `Faltam ou estão inválidos alguns dados para essa ação (${campos}). Pode detalhar?` } };
  }
  if (!userCanUseTool(tool, valid.data, deps.user)) {
    const falta = tool.modulos(valid.data).filter((m) => !deps.user.moduleAccess[m]).map((m) => MODULO_ROTULO[m]).join(', ');
    return { status: 200, body: { tipo: 'texto', texto: `Seu usuário não tem acesso ao módulo ${falta}, então não posso fazer essa ação.` } };
  }
  // Preparo so-leitura (ex.: identificar a empresa) antes do cartao, com a sessao do usuario.
  let finalArgs: any = valid.data;
  if (tool.preparar) {
    let prep: { ok: true; args: unknown } | { ok: false; texto: string };
    try {
      prep = await tool.preparar(valid.data, deps.api);
    } catch {
      prep = { ok: false, texto: 'Não consegui consultar o cadastro agora. Tente de novo.' };
    }
    if (!prep.ok) return { status: 200, body: { tipo: 'texto', texto: prep.texto } };
    const again = tool.schema.safeParse(prep.args);
    if (!again.success) return { status: 200, body: { tipo: 'texto', texto: 'Não consegui preparar essa ação. Pode detalhar?' } };
    finalArgs = again.data;
  }
  const resumo = tool.resumo(finalArgs);
  // Leitura (consultas, buscas, fichas, painel): executa direto, sem cartao (aprovado pelo
  // Marcéllo em 24/11/2026: "Sem confirmação"). Mesma sessao/RBAC das telas e auditoria.
  // So o que grava ou altera dados continua com o cartao Confirmar.
  if (tool.tipo === 'leitura') {
    if (!(await deps.rateLimit(`exec:m:${uid}`, ASSISTENTE_LIMITS.executePerUserPerMinute, 60_000))) {
      return err(429, 'LIMITE_EXECUCOES', 'Muitas consultas em pouco tempo. Aguarde um minuto.');
    }
    const body = await executarFerramenta(tool, finalArgs, deps);
    return {
      status: 200,
      body: {
        tipo: 'resultado',
        texto: textoModelo ? textoModelo.slice(0, 1000) : '',
        acao: { ferramenta: tool.name, acao: tool.tipo, titulo: resumo.titulo, linhas: resumo.linhas },
        resultado: body,
      },
    };
  }
  const { token } = signActionToken(deps.secret, {
    uid,
    sid: deps.sid,
    tool: tool.name,
    args: finalArgs as Record<string, unknown>,
    exp: deps.now() + ASSISTENTE_LIMITS.proposalTtlMs,
  });
  return {
    status: 200,
    body: {
      tipo: 'proposta',
      texto: textoModelo ? textoModelo.slice(0, 1000) : '',
      proposta: { token, ferramenta: tool.name, acao: tool.tipo, titulo: resumo.titulo, linhas: resumo.linhas },
    },
  };
}

// ---------------------------------------------------------------------------
// Executar (gravacao: somente apos Confirmar; leitura ja sai direto do chat)
// ---------------------------------------------------------------------------
function moduloAuditoria(mods: string[], tool: string): 'CRM' | 'ERP' | 'CHAMADOS' {
  if (mods.includes('chamados') || tool === 'abrir_chamado') return 'CHAMADOS';
  if (mods.includes('erp')) return 'ERP';
  return 'CRM';
}

export async function handleExecute(rawBody: unknown, deps: AssistenteDeps): Promise<ServiceResponse> {
  const parsed = execSchema.safeParse(rawBody);
  if (!parsed.success) return err(400, 'ENTRADA_INVALIDA', 'Pedido de execução inválido.');
  const check = verifyActionToken(deps.secret, parsed.data.token, { uid: deps.user.uid, sid: deps.sid, now: deps.now() });
  if (!check.ok) {
    if (check.code === 'TOKEN_EXPIRED') return err(410, check.code, 'Essa proposta expirou. Peça de novo ao assistente.');
    return err(403, check.code, 'Proposta de ação inválida para esta sessão.');
  }
  if (!parsed.data.confirmar) return { status: 200, body: { cancelado: true } };
  const p = check.payload;
  if (!(await deps.rateLimit(`exec:m:${deps.user.uid}`, ASSISTENTE_LIMITS.executePerUserPerMinute, 60_000))) {
    return err(429, 'LIMITE_EXECUCOES', 'Muitas ações em pouco tempo. Aguarde um minuto.');
  }
  const tool = getTool(p.tool);
  if (!tool) return err(400, 'FERRAMENTA_DESCONHECIDA', 'Ação não disponível.');
  const valid = tool.schema.safeParse(p.args);
  if (!valid.success) return err(400, 'ENTRADA_INVALIDA', 'Dados da ação inválidos.');
  if (!userCanUseTool(tool, valid.data, deps.user)) return err(403, 'MODULO_NEGADO', 'Seu usuário não tem acesso a esse módulo.');
  if (!(await deps.consumeNonce(p.n, ASSISTENTE_LIMITS.proposalTtlMs + 60_000))) {
    return err(409, 'JA_EXECUTADA', 'Essa ação já foi confirmada antes.');
  }
  return { status: 200, body: await executarFerramenta(tool, valid.data, deps) };
}

/** Executa a ferramenta com a sessao do usuario, audita e monta a resposta (sem token). */
async function executarFerramenta(tool: NonNullable<ReturnType<typeof getTool>>, args: any, deps: AssistenteDeps): Promise<Record<string, unknown>> {
  const valid = { data: args };
  const resumo = tool.resumo(valid.data);
  let result: ToolResult;
  try {
    result = await tool.executar(valid.data, deps.api);
  } catch {
    result = { ok: false, status: 500, mensagem: 'Erro interno ao executar a ação.', resumoParaModelo: 'Falhou por erro interno.' };
  }
  await deps.audit({
    tool: tool.name,
    tipo: tool.tipo,
    modulo: moduloAuditoria(tool.modulos(valid.data), tool.name),
    ok: result.ok,
    status: result.ok ? 200 : result.status,
    titulo: resumo.titulo,
    detalhe: resumo.linhas.join(' | ').slice(0, 900),
    registro: result.ok && result.registro ? `${result.registro.tipo}:${result.registro.codigo || result.registro.id}` : undefined,
  });
  if (!result.ok) {
    return { ok: false, mensagem: result.mensagem, resumoParaModelo: result.resumoParaModelo };
  }
  const { ok: _ok, ...rest } = result;
  void _ok;
  // Marca o registro para o proximo pedido ("traga o link da proposta") agir sobre ele.
  const resumoParaModelo = `${rest.resumoParaModelo || ''}${marcaContexto(rest.registro)}`.trim();
  return { ok: true, ...rest, resumoParaModelo };
}
