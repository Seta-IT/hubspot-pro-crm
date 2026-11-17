// ============================================================================
// STI-hub — Assistente de IA interno (etapa 1): configuracao e limites.
// Segredos so do ambiente (OMNIROUTE_API_KEY); nunca logados nem enviados ao cliente.
// ============================================================================

export const DEFAULT_OMNIROUTE_MODEL = 'minimaxai/minimax-m3.1-flash';
export const DEFAULT_OMNIROUTE_FALLBACK_MODEL = 'mistralai/mistral-large-4-1t-a52b';

export interface AssistenteConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  fallbackModel: string;
  /** Timeout de cada chamada ao OmniRoute (ms). */
  timeoutMs: number;
}

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
  /** Tokens maximos da resposta do modelo. */
  maxCompletionTokens: 800,
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
  };
}
