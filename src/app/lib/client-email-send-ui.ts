/** Aviso quando o envio caiu no Resend depois de o Outlook recusar (401/403). */
export const EMAIL_OUTLOOK_FALLBACK_NOTICE =
  'O e-mail saiu pelo servidor, não pela sua caixa do Outlook. Confira se chegou e se as respostas virão para o seu endereço.';

export type ClientEmailPublicRelay = 'outlook' | 'resend';
