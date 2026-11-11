// Mensagens exibidas ao cliente no Portal quando responder ou avaliar um chamado falha.
// Somente UI: nao expoe detalhes tecnicos (status, codigo ou texto do servidor).

export const PORTAL_UI_RATE_LIMIT_MESSAGE = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
export const PORTAL_UI_REPLY_ERROR_MESSAGE =
  'Não foi possível enviar sua mensagem no momento. Tente novamente em instantes; seu texto foi mantido.';
export const PORTAL_UI_CSAT_ERROR_MESSAGE =
  'Não foi possível registrar sua avaliação no momento. Tente novamente em instantes.';

/** status: codigo HTTP da resposta, ou null quando a requisicao nem chegou ao servidor. */
export function portalActionErrorMessage(status: number | null, kind: 'REPLY' | 'CSAT'): string {
  if (status === 429) return PORTAL_UI_RATE_LIMIT_MESSAGE;
  return kind === 'REPLY' ? PORTAL_UI_REPLY_ERROR_MESSAGE : PORTAL_UI_CSAT_ERROR_MESSAGE;
}
