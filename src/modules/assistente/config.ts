// ============================================================================
// STI-hub — Assistente de IA interno (etapa 1): configuracao e limites.
// Segredos so do ambiente (OMNIROUTE_API_KEY); nunca logados nem enviados ao cliente.
// ============================================================================

// minimax-m3.1-flash parou de responder no OmniRoute (18/11: timeout de 90 s no upstream).
// nemotron-3.5-lightning respondeu o mesmo pedido com ferramentas em 4-7 s.
export const DEFAULT_OMNIROUTE_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';
export const DEFAULT_OMNIROUTE_FALLBACK_MODEL = 'mistralai/mistral-large-4-1t-a52b';

export interface AssistenteConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  fallbackModel: string;
  /** Timeout da chamada ao modelo principal (ms). */
  timeoutMs: number;
  /**
   * Orcamento total da conversa com o OmniRoute (ms), principal + reserva. O reserva usa o
   * que sobrar (pode passar de timeoutMs). Deve caber no maxDuration da rota (90 s).
   */
  totalBudgetMs?: number;
}

/** Orcamento padrao: 80 s, com folga para a rota de maxDuration 90 s. */
export const DEFAULT_TOTAL_BUDGET_MS = 80_000;

export const ASSISTENTE_LIMITS = {
  /** Mensagens por usuario por minuto (chat). */
  perUserPerMinute: 10,
  /** Mensagens por usuario por hora. */
  perUserPerHour: 120,
  /** Execucoes confirmadas por usuario por minuto. */
  executePerUserPerMinute: 20,
  /** Tamanho maximo de UMA mensagem do usuario (caracteres). */
  maxMessageChars: 2000,
  /** Mensagens de historico enviadas ao modelo. */
  maxHistoryMessages: 12,
  /** Soma maxima de caracteres do historico enviado ao modelo. */
  maxHistoryChars: 12000,
  /** Corpo maximo aceito pelas rotas do assistente (bytes). */
  maxBodyBytes: 64 * 1024,
  /** Validade da proposta de acao (ms) ate o usuario confirmar. */
  proposalTtlMs: 10 * 60 * 1000,
  /**
   * Tokens maximos da resposta do modelo. O nemotron gasta parte em raciocinio: com 800, 2 de 8
   * pedidos de edicao acabavam so no raciocinio (finish_reason=length, sem resposta).
   */
  maxCompletionTokens: 2048,
} as const;

const clampInt = (raw: string | undefined, def: number, min: number, max: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : def;
};

/** Le a configuracao do ambiente. null = assistente desligado (sem URL ou sem chave). */
export function readAssistenteConfig(env: NodeJS.ProcessEnv = process.env): AssistenteConfig | null {
  const baseUrl = String(env.OMNIROUTE_BASE_URL || '').trim().replace(/\/+$/, '');
  const apiKey = String(env.OMNIROUTE_API_KEY || '').trim();
  if (!baseUrl || !apiKey) return null;
  if (!/^https:\/\//i.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(baseUrl)) return null;
  return {
    baseUrl,
    apiKey,
    model: String(env.OMNIROUTE_MODEL || '').trim() || DEFAULT_OMNIROUTE_MODEL,
    fallbackModel: String(env.OMNIROUTE_FALLBACK_MODEL || '').trim() || DEFAULT_OMNIROUTE_FALLBACK_MODEL,
    timeoutMs: clampInt(env.OMNIROUTE_TIMEOUT_MS, 25_000, 3_000, 60_000),
    totalBudgetMs: clampInt(env.OMNIROUTE_TOTAL_BUDGET_MS, DEFAULT_TOTAL_BUDGET_MS, 10_000, 85_000),
  };
}
