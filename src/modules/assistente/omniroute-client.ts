// ============================================================================
// STI-hub — Assistente de IA: cliente do OmniRoute (API compativel com a OpenAI).
// Modelo principal + reserva; 429/502/503/504/timeout => tenta a reserva.
// A chave vai so no header Authorization e nunca aparece em erro, log ou resposta.
// ============================================================================
import type { AssistenteConfig } from './config';
import { ASSISTENTE_LIMITS, DEFAULT_TOTAL_BUDGET_MS } from './config';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface LlmToolCall {
  name: string;
  /** Argumentos ja decodificados (objeto) ou null se o JSON veio invalido. */
  args: Record<string, unknown> | null;
}

export interface LlmResult {
  text: string;
  toolCalls: LlmToolCall[];
  model: string;
}

export type LlmErrorCode = 'LLM_RATE_LIMITED' | 'LLM_UNAVAILABLE' | 'LLM_TIMEOUT' | 'LLM_BAD_RESPONSE' | 'LLM_AUTH';

export class LlmError extends Error {
  constructor(public readonly code: LlmErrorCode, message: string, public readonly status?: number) {
    super(message);
    this.name = 'LlmError';
  }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface LlmClient {
  complete(messages: LlmMessage[], tools: LlmToolDefinition[]): Promise<LlmResult>;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

function parseArgs(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Remove raciocinio interno (<think>...</think>) que alguns modelos devolvem no texto. */
export function stripReasoning(text: string): string {
  return String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '').trim();
}

export function createOmniRouteClient(
  cfg: AssistenteConfig,
  fetchImpl: FetchLike = (u, i) => fetch(u, i),
  clock: () => number = () => Date.now(),
): LlmClient {
  async function callModel(model: string, messages: LlmMessage[], tools: LlmToolDefinition[], timeoutMs: number): Promise<LlmResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await doCall(model, messages, tools, ctrl.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  async function doCall(model: string, messages: LlmMessage[], tools: LlmToolDefinition[], signal: AbortSignal): Promise<LlmResult> {
    let res: Response;
    try {
      res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model,
          messages,
          tools: tools.length ? tools : undefined,
          tool_choice: tools.length ? 'auto' : undefined,
          temperature: 0.2,
          max_tokens: ASSISTENTE_LIMITS.maxCompletionTokens,
        }),
        signal,
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw new LlmError('LLM_TIMEOUT', 'O provedor de IA demorou demais para responder.');
      throw new LlmError('LLM_UNAVAILABLE', 'Provedor de IA indisponível.');
    }
    if (res.status === 401 || res.status === 403) throw new LlmError('LLM_AUTH', 'Credencial do provedor de IA recusada.', res.status);
    if (res.status === 429) throw new LlmError('LLM_RATE_LIMITED', 'Limite do provedor de IA atingido.', 429);
    if (!res.ok) throw new LlmError('LLM_UNAVAILABLE', `Provedor de IA respondeu ${res.status}.`, res.status);
    let json: any;
    try {
      json = await res.json();
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || signal.aborted) throw new LlmError('LLM_TIMEOUT', 'O provedor de IA demorou demais para responder.');
      throw new LlmError('LLM_BAD_RESPONSE', 'Resposta inválida do provedor de IA.');
    }
    const msg = json?.choices?.[0]?.message;
    if (!msg || typeof msg !== 'object') throw new LlmError('LLM_BAD_RESPONSE', 'Resposta sem mensagem do provedor de IA.');
    // Cortado por tamanho sem texto nem ferramenta (gastou tudo raciocinando): tenta o reserva.
    const vazio = !(Array.isArray(msg.tool_calls) && msg.tool_calls.length) && !stripReasoning(typeof msg.content === 'string' ? msg.content : '');
    if (vazio && json?.choices?.[0]?.finish_reason === 'length') throw new LlmError('LLM_BAD_RESPONSE', 'Resposta do provedor de IA cortada sem conteúdo.');
    const toolCalls: LlmToolCall[] = (Array.isArray(msg.tool_calls) ? msg.tool_calls : [])
      .filter((t: any) => t && t.function && typeof t.function.name === 'string')
      .map((t: any) => ({ name: String(t.function.name), args: parseArgs(t.function.arguments) }));
    return { text: stripReasoning(typeof msg.content === 'string' ? msg.content : ''), toolCalls, model: String(json?.model || model) };
  }

  return {
    async complete(messages, tools) {
      const models = [cfg.model, cfg.fallbackModel].filter((m, i, a) => m && a.indexOf(m) === i);
      // Orcamento unico: o principal tem ate timeoutMs; o reserva (ultimo) usa todo o resto,
      // para um modelo lento mas vivo (ex.: mistral-large ~25-35 s) nao estourar por 25 s fixos.
      const deadline = clock() + (cfg.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS);
      let last: LlmError | null = null;
      for (let i = 0; i < models.length; i++) {
        const model = models[i];
        const remaining = deadline - clock();
        if (remaining < 3_000) break;
        const timeoutMs = i === models.length - 1 ? remaining : Math.min(cfg.timeoutMs, remaining);
        try {
          return await callModel(model, messages, tools, timeoutMs);
        } catch (err) {
          const e = err instanceof LlmError ? err : new LlmError('LLM_UNAVAILABLE', 'Provedor de IA indisponível.');
          last = e;
          const retryable = e.code === 'LLM_TIMEOUT' || e.code === 'LLM_RATE_LIMITED' || e.code === 'LLM_BAD_RESPONSE' || (e.status !== undefined && RETRYABLE.has(e.status));
          if (!retryable) throw e;
        }
      }
      throw last || new LlmError('LLM_TIMEOUT', 'O provedor de IA demorou demais para responder.');
    },
  };
}
