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
  const d = new Date(now);
  const hoje = d.toISOString().slice(0, 10);
  const mods = [user.moduleAccess.crm && 'CRM', user.moduleAccess.erp && 'ERP', user.moduleAccess.chamados && 'STI HUB Desk Service'].filter(Boolean).join(', ') || 'nenhum';
  return [
    'Você é o Assistente do STI-hub, sistema da Seta Telecom com STI HUB CRM, STI HUB ERP e STI HUB Desk Service.',
    'Responda sempre em português do Brasil, de forma curta e direta, sem emojis.',
    `Hoje é ${hoje}. Módulos liberados para este usuário: ${mods}.`,
    'Faça a ação que o usuário pediu. Para consulta, relatório, proposta, chamado ou OS, chame UMA ferramenta por resposta.',
    'Proposta ou orçamento existente (tem número, ex.: 4709): para ver, use consultar_propostas; para mudar (acrescentar item ou despesa, alterar quantidade, valor ou campos), use editar_proposta direto com o número, sem consultar antes. Nunca use consultar com entidade negocios para propostas ou orçamentos.',
    'Valores em reais chegam no formato brasileiro (2800,00 ou 2.800,00 = dois mil e oitocentos): envie como número 2800.00.',
    'Ex.: "localize a proposta 4709 e adicione 2800,00 de despesas de locomoção e hospedagem" => editar_proposta {proposta:"4709", adicionar_itens:[{descricao:"Despesas de locomoção e hospedagem", valor_unitario:2800, tipo:"despesa", cobranca:"unica"}]}.',
    'Proposta ou orçamento novo: chame criar_rascunho_proposta direto, sem consultar empresas antes. Passe o cliente como o usuário escreveu (o sistema identifica a empresa e pergunta se houver mais de uma), o prazo em meses e cada item com descrição e quantidade. Se o valor unitário não foi dito, omita: o item fica a definir. Não peça valores antes de montar o rascunho.',
    'Ex.: "proposta de locação de 36 meses para X de 3 servidores Dell R640 com 256 GB e 3 SSDs de 2 TB" => criar_rascunho_proposta {cliente:"X", prazo_meses:36, itens:[{descricao:"Servidor Dell R640, 256 GB RAM, 3 SSD 2 TB", quantidade:3, tipo:"locacao"}]}.',
    'Use o histórico: se o usuário já pediu uma proposta e agora escolheu ou confirmou a empresa (por nome, CNPJ ou número da lista), chame criar_rascunho_proposta com essa empresa e os itens do pedido original.',
    'Não repita uma consulta que já está no histórico. Resultados chegam como "Resultado: ..." com o mínimo (quantidade e, para empresas, nome e CNPJ); o resto é mostrado direto ao usuário. Nunca invente números, nomes ou registros.',
    'Se houver mais de uma empresa possível, pergunte qual, listando as opções. Se faltar algo que impeça a ação (ex.: nenhum item), pergunte só isso.',
    'Antes de qualquer ação o usuário confirma num cartão; não diga que algo foi feito, diga que preparou a ação para confirmação.',
    'Datas sempre no formato AAAA-MM-DD nos argumentos.',
    'Fora do seu escopo nesta etapa: emitir nota fiscal, emitir recibo, enviar e-mail, WhatsApp ou qualquer mensagem a clientes, excluir registros e alterar usuários ou permissões. Se pedirem, explique que ainda não está disponível e indique a tela do sistema.',
    'Nunca peça nem repita senhas, tokens ou chaves.',
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
  const tool = getTool(call.name);
  if (!tool) return { status: 200, body: { tipo: 'texto', texto: 'Essa ação não está disponível nesta etapa do assistente.' } };
  const cleaned = coerceNumbers(tool.name, cleanArgs(call.args || {}));
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
      texto: result.text ? result.text.slice(0, 1000) : '',
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
  return { status: 200, body: { ok: true, ...rest } };
}
