// ============================================================================
// SetaDesk - Textos dos e-mails automaticos.
// CONFIRMACAO: texto APROVADO pelo Marcelo (chave real TEC-/FIN-).
// ANALISE ("Chamado em atendimento"): texto APROVADO pelo Marcello em 17/11/2026; so sai com
// SETADESK_EMAIL_ANALYSIS_NOTICE_ENABLED ligada.
// ============================================================================

import { escapeHtml } from '../email/email-html';

export type SetaDeskAutoEmailKind = 'CONFIRMATION' | 'ANALYSIS_NOTICE';

export interface SetaDeskAutoEmail {
  subject: string;
  bodyText: string;
  bodyHtml: string;
}

const SIGNATURE = 'Equipe de Suporte Seta Telecom.';

function toHtml(paragraphs: string[]): string {
  return paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
}

export function buildConfirmationEmail(ticketKey: string): SetaDeskAutoEmail {
  const key = String(ticketKey).trim().toUpperCase();
  const paragraphs = [
    'Olá,',
    `recebemos seu e-mail e abrimos o chamado ${key}. Para acompanhar ou enviar mais informações, basta responder a este e-mail mantendo o número no assunto.`,
    SIGNATURE,
  ];
  return {
    subject: `[${key}] Recebemos sua solicitação`,
    bodyText: `Olá, recebemos seu e-mail e abrimos o chamado ${key}. Para acompanhar ou enviar mais informações, basta responder a este e-mail mantendo o número no assunto. ${SIGNATURE}`,
    bodyHtml: toHtml(paragraphs),
  };
}

/** Texto APROVADO pelo Marcello (17/11/2026). Envio depende de SETADESK_EMAIL_ANALYSIS_NOTICE_ENABLED. */
export function buildAnalysisNoticeEmail(ticketKey: string): SetaDeskAutoEmail {
  const key = String(ticketKey).trim().toUpperCase();
  const main = `o chamado ${key} já está com um técnico da nossa equipe e está sendo tratado dentro do prazo de atendimento. Vamos responder por este e-mail com o andamento ou a solução. Se tiver mais informações, responda mantendo o número no assunto.`;
  return {
    subject: `[${key}] Chamado em atendimento`,
    bodyText: `Olá, ${main} ${SIGNATURE}`,
    bodyHtml: toHtml(['Olá,', main, SIGNATURE]),
  };
}

export function buildAutoEmail(kind: SetaDeskAutoEmailKind, ticketKey: string): SetaDeskAutoEmail {
  return kind === 'CONFIRMATION' ? buildConfirmationEmail(ticketKey) : buildAnalysisNoticeEmail(ticketKey);
}

export const SETADESK_SYSTEM_AUTHOR = 'SetaDesk (automático)';
