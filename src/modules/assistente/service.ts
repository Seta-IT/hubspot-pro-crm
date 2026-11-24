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
const chatSchema = z.object({ mensagens: z.array(mensagemSchema).min(1).max(60) });
const execSchema = z.object({ token: z.string().min(10).max(16_000), confirmar: z.boolean() });

function systemPrompt(user: AssistenteUser, now: number): string {
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
    'Proposta ou orçamento novo: chame criar_rascunho_proposta direto, sem consultar empresas antes. Passe o cliente como o usuário escreveu (o sistema identifica a empresa e pergunta se houver mais de uma), o prazo em meses e cada item com descrição e quantidade. Se o valor unitário não foi dito, omita: o item fica a definir. Não peça valores antes de montar o rascunho.',
    'Ex.: "proposta de locação de 36 meses para X de 3 servidores Dell R640 com 256 GB e 3 SSDs de 2 TB" => criar_rascunho_proposta {cliente:"X", prazo_meses:36, itens:[{descricao:"Servidor Dell R640, 256 GB RAM, 3 SSD 2 TB", quantidade:3, tipo:"locacao"}]}.',
    'Use o histórico: se o usuário já pediu uma proposta e agora escolheu ou confirmou a empresa (por nome, CNPJ ou número da lista), chame criar_rascunho_proposta com essa empresa e os itens do pedido original.',
    'Link, PDF, Versão contrato ou dados completos "da proposta/dela/desse orçamento" sem número: use o "Registro em contexto" do histórico (consultar_propostas com esse número). Nunca use "link", "pdf", "proposta" ou "contrato" como termo de busca; sem registro no histórico, pergunte qual é o número. Os botões de link do cliente, Versão contrato e PDF aparecem junto do resultado.',
    'Não repita uma consulta que já está no histórico. Resultados chegam como "Resultado: ..." com o mínimo (quantidade e, para empresas, nome e CNPJ); o resto é mostrado direto ao usuário. Nunca invente números, nomes ou registros.',
    'Se houver mais de uma empresa possível, pergunte qual, listando as opções. Se faltar algo que impeça a ação (ex.: nenhum item), pergunte só isso.',
    'Antes de qualquer ação o usuário confirma num cartão; não diga que algo foi feito, diga que preparou a ação para confirmação.',
    'Datas sempre no formato AAAA-MM-DD nos argumentos.',
    'Fora do seu escopo: emitir nota fiscal, emitir recibo, dar baixa em pagamento, aprovar ou converter proposta, enviar e-mail, WhatsApp ou qualquer mensagem a clientes, excluir registros e alterar usuários ou permissões. Se pedirem, explique que ainda não está disponível e indique a tela do sistema.',
    'Nunca peça nem repita senhas, tokens ou chaves.',
    'Base de conhecimento do STI-hub (use para dúvidas de "como faço", regras e erros; responda em texto, sem ferramenta):',
    resumoConhecimentoParaPrompt(),
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
  if (!deps.llm) return err(503, 'ASSISTENTE_DESLIGADO', 'O assistente de IA ainda não está configurado neste ambiente.');
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
    const respondendoPergunta = !!anterior && anterior.papel === 'assistente' && /\?\s*$/.test(anterior.texto.trim());
    // Resposta a "Qual proposta ou registro você quer?": número puro = número do orçamento.
    const respostaQual = !!anterior && anterior.papel === 'assistente' && anterior.texto.trim() === PERGUNTA_QUAL_REGISTRO && /^\s*(?:n[ºo°]?\s*)?#?\d{1,7}\s*$/i.test(last.texto);
    const textoRota = respostaQual ? `orçamento ${last.texto.replace(/\D+/g, '')}` : last.texto;
    rota = rotearPergunta(textoRota, { agora: deps.now(), respondendoPergunta, contexto });
  } catch {
    rota = null;
  }
  if (rota?.tipo === 'texto') return { status: 200, body: { tipo: 'texto', texto: rota.texto } };
  if (rota?.tipo === 'ferramenta') {
    const t = getTool(rota.ferramenta);
    if (t && t.disponivel(deps.user) && userCanUseTool(t, rota.args, deps.user)) {
      const viaRota = await proporAcao(t.name, rota.args, '', deps);
      if (viaRota.status === 200 && viaRota.body.tipo === 'proposta') return viaRota;
    }
  }

  let result;
  try {
    result = await deps.llm.complete([{ role: 'system', content: systemPrompt(deps.user, deps.now()) }, ...history], toolDefinitionsFor(deps.user));
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
  return proporAcao(ajuste.nome, ajuste.args, result.text || '', deps);
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
async function proporAcao(nome: string, rawArgs: unknown, textoModelo: string, deps: AssistenteDeps): Promise<ServiceResponse> {
  const uid = deps.user.uid;
  const tool = getTool(nome);
  if (!tool) return { status: 200, body: { tipo: 'texto', texto: 'Essa ação não está disponível nesta etapa do assistente.' } };
  const cleaned = coerceNumbers(tool.name, cleanArgs(rawArgs || {}));
  const args = tool.coagir ? tool.coagir(cleaned) : cleaned;
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
// Executar (somente apos Confirmar)
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
    return { status: 200, body: { ok: false, mensagem: result.mensagem, resumoParaModelo: result.resumoParaModelo } };
  }
  const { ok: _ok, ...rest } = result;
  void _ok;
  // Marca o registro para o proximo pedido ("traga o link da proposta") agir sobre ele.
  const resumoParaModelo = `${rest.resumoParaModelo || ''}${marcaContexto(rest.registro)}`.trim();
  return { status: 200, body: { ok: true, ...rest, resumoParaModelo } };
}
