// ============================================================================
// SetaDesk - Processamento de um e-mail de entrada (regras de negocio).
// ----------------------------------------------------------------------------
//  1. Fila pela caixa destinataria (setadesk_pipelines.mailbox, fila ativa).
//  2. Deduplicacao SOMENTE pelo Message-ID identico (indice unico).
//  3. Anti-loop: auto-respostas, bounces, caixas das filas e nao-mensagens sao
//     registrados como IGNORED_* e nao abrem chamado nem geram resposta.
//  4. Threading: In-Reply-To -> References (mensagens conhecidas) -> [PREFIX-n]
//     no assunto (so se o remetente participa do chamado) -> chamado novo.
//  5. Nunca funde chamados: assunto parecido do mesmo solicitante gera so uma
//     SUGESTAO em setadesk_related_tickets (status SUGGESTED).
//  6. Resposta do cliente vira comentario (papel CUSTOMER, origem EMAIL). Publico
//     so se o remetente e o solicitante, um cc do chamado ou o contato; senao, interno.
//  7. Chamado novo: confirmacao enfileirada (uma por chamado, dedupe_key).
//  8. Anexos: apenas metadados (nome, tipo, tamanho), sem upload.
// ============================================================================

import { buildConfirmationEmail } from './templates';
import { classifyIgnorable, extractSubjectTicketKeys, subjectSimilarity, type InboundEmail } from './parse';
import { newId, type EmailMessageRecord, type IntakePipeline, type SetaDeskEmailStore, type SetaDeskEmailTx, type StoredTicket } from './store';

export type ProcessResult =
  | { action: 'CREATED'; ticketId: string; ticketKey: string; confirmationQueued: boolean }
  | { action: 'APPENDED'; ticketId: string; ticketKey: string; linkedBy: string; isInternal: boolean }
  | { action: 'DUPLICATE' }
  | { action: 'IGNORED'; reason: string };

export interface ProcessContext {
  /** Caixa que recebeu (a que esta sendo lida). */
  mailbox: string;
  pipelines: IntakePipeline[];
  resolveRequester?: (email: string) => { contactId: string | null; companyId: string | null };
  now?: () => Date;
}

const QUEUE_BY_CATEGORY: Record<'SUPPORT' | 'BILLING', string> = {
  SUPPORT: 'NOC N1 - Triagem & Monitoramento Zabbix',
  BILLING: 'Financeiro & Faturamento Telecom',
};

export const RELATED_SUGGESTION_MIN_SCORE = 0.5;
/** Confirmacoes automaticas por remetente por hora (o 4o chamado na mesma hora nao recebe). */
export const CONFIRMATIONS_MAX_PER_SENDER_PER_HOUR = 3;
export const RELATED_SUGGESTION_WINDOW_DAYS = 14;

export function pipelineForMailbox(pipelines: IntakePipeline[], mailbox: string): IntakePipeline | null {
  const m = mailbox.trim().toLowerCase();
  return pipelines.find((p) => p.isActive && (p.mailbox || '').trim().toLowerCase() === m) || null;
}

async function isParticipant(tx: SetaDeskEmailTx, t: StoredTicket, email: string): Promise<boolean> {
  const e = email.toLowerCase();
  if ((t.requesterEmail || '').toLowerCase() === e) return true;
  if ((t.ccEmails || []).some((c) => c.toLowerCase() === e)) return true;
  const contactEmail = await tx.contactEmailOf(t.contactId);
  return Boolean(contactEmail && contactEmail.toLowerCase() === e);
}

export async function processInboundEmail(
  store: SetaDeskEmailStore,
  email: InboundEmail,
  ctx: ProcessContext
): Promise<ProcessResult> {
  const now = ctx.now ? ctx.now() : new Date();
  const pipeline = pipelineForMailbox(ctx.pipelines, ctx.mailbox);
  if (!pipeline) return { action: 'IGNORED', reason: 'UNKNOWN_MAILBOX' };
  const ownMailboxes = ctx.pipelines.map((p) => (p.mailbox || '').toLowerCase()).filter(Boolean);
  const ignore = classifyIgnorable(email, ownMailboxes);
  const prefixes = ctx.pipelines.map((p) => p.prefix);

  return store.withTx(async (tx) => {
    const pk = newId('em');
    const row: EmailMessageRecord = {
      id: pk,
      ticketId: null,
      commentId: null,
      direction: 'INBOUND',
      messageId: email.messageId,
      inReplyTo: email.inReplyTo,
      references: email.references,
      conversationId: email.conversationId,
      provider: 'GRAPH',
      providerMessageId: email.providerMessageId,
      mailbox: pipeline.mailbox!.toLowerCase(),
      fromEmail: email.fromEmail,
      fromName: email.fromName,
      to: email.to,
      cc: email.cc,
      subject: email.subject,
      kind: ignore ? ignore : 'CUSTOMER',
      isAutoSubmitted: ignore === 'AUTO_REPLY' || ignore === 'BOUNCE',
      processingStatus: ignore ? `IGNORED_${ignore}` : 'RECEIVED',
      linkedBy: null,
      headers: email.headers,
      receivedAt: email.receivedAt,
      // Mensagem ignorada nao guarda corpo nem anexos (minimizacao).
      bodyText: ignore ? null : email.bodyText,
      bodyHtml: ignore ? null : email.bodyHtml,
      attachments: ignore ? [] : email.attachments,
    };
    if (!(await tx.claimEmailMessage(row))) return { action: 'DUPLICATE' } as const;
    if (ignore) return { action: 'IGNORED', reason: ignore } as const;
    const from = email.fromEmail!;

    // ---- Threading ----
    let target: StoredTicket | null = null;
    let linkedBy: string | null = null;
    if (email.inReplyTo) {
      const ids = await tx.findTicketIdsByMessageIds([email.inReplyTo]);
      if (ids[0]) {
        target = await tx.getTicketById(ids[0]);
        linkedBy = 'IN_REPLY_TO';
      }
    }
    if (!target && email.references.length) {
      const ids = await tx.findTicketIdsByMessageIds(email.references);
      if (ids[0]) {
        target = await tx.getTicketById(ids[0]);
        linkedBy = 'REFERENCES';
      }
    }
    let subjectKeyMismatch: StoredTicket | null = null;
    if (!target) {
      for (const key of extractSubjectTicketKeys(email.subject, prefixes)) {
        const t = await tx.getTicketByKey(key);
        if (!t) continue;
        if (await isParticipant(tx, t, from)) {
          target = t;
          linkedBy = 'SUBJECT_KEY';
        } else {
          subjectKeyMismatch = t;
        }
        break;
      }
    }

    if (target) {
      const participant = await isParticipant(tx, target, from);
      const commentId = newId('cm-email');
      await tx.insertComment({
        id: commentId,
        ticketId: target.id,
        author: email.fromName || from,
        authorEmail: from,
        authorRole: 'CUSTOMER',
        isInternal: !participant,
        body: email.bodyText || '(e-mail sem texto)',
        bodyHtml: email.bodyHtml,
        source: 'EMAIL',
        emailMessageId: email.messageId,
        createdAt: email.receivedAt || now.toISOString(),
      });
      if (target.status === 'WAITING_CUSTOMER') {
        await tx.setTicketStatus(target.id, 'WAITING_CUSTOMER', 'IN_PROGRESS', 'EMAIL');
      }
      await tx.touchTicket(target.id);
      await tx.updateEmailMessage(pk, { ticketId: target.id, commentId, processingStatus: 'LINKED', linkedBy });
      await tx.insertNotification('TICKET_EMAIL_REPLY', target.id, `Resposta por e-mail em ${target.key}`, '', `TICKET_EMAIL_REPLY:${pk}`);
      return { action: 'APPENDED', ticketId: target.id, ticketKey: target.key, linkedBy: linkedBy!, isInternal: !participant } as const;
    }

    // ---- Chamado novo ----
    const category: 'SUPPORT' | 'BILLING' = pipeline.prefix === 'FIN' || pipeline.id === 'pl-fin' ? 'BILLING' : 'SUPPORT';
    const key = await tx.nextTicketKey(pipeline);
    const ticketId = newId('tkt-email');
    const link = ctx.resolveRequester ? ctx.resolveRequester(from) : { contactId: null, companyId: null };
    const created = now.toISOString();
    await tx.insertTicket({
      id: ticketId,
      key,
      pipelineId: pipeline.id,
      subject: email.subject,
      description: email.bodyText || '(e-mail sem texto)',
      category,
      priority: 'MEDIUM',
      queue: QUEUE_BY_CATEGORY[category],
      requesterEmail: from,
      requesterName: email.fromName,
      ccEmails: email.cc.filter((c) => !ownMailboxes.includes(c)),
      contactId: link.contactId,
      companyId: link.companyId,
      slaFirstResponseDueAt: new Date(now.getTime() + 4 * 3600_000).toISOString(),
      slaResolutionDueAt: new Date(now.getTime() + 24 * 3600_000).toISOString(),
      createdAt: created,
    });
    await tx.updateEmailMessage(pk, { ticketId, processingStatus: 'TICKET_CREATED', linkedBy: 'NEW_TICKET' });

    // Sugestoes de relacao (nunca fusao).
    if (subjectKeyMismatch) {
      await tx.insertRelatedSuggestion(ticketId, subjectKeyMismatch.id, 'SUBJECT_KEY_SENDER_NOT_PARTICIPANT', 1);
    }
    const since = new Date(now.getTime() - RELATED_SUGGESTION_WINDOW_DAYS * 86400_000).toISOString();
    for (const t of await tx.findRecentRequesterTickets(from, since, ticketId)) {
      if (subjectKeyMismatch && t.id === subjectKeyMismatch.id) continue;
      const score = subjectSimilarity(email.subject, t.subject);
      if (score >= RELATED_SUGGESTION_MIN_SCORE) {
        await tx.insertRelatedSuggestion(ticketId, t.id, 'SIMILAR_SUBJECT_SAME_REQUESTER', Math.round(score * 10000) / 10000);
      }
    }

    // CISO 17/11: anti-loop/backscatter. Outro sistema automatico sem cabecalhos de auto-resposta
    // (ou um remetente forjado) abriria um chamado novo a cada confirmacao. Acima do limite por
    // remetente na ultima hora, o chamado e aberto mas a confirmacao nao e enviada.
    const hourAgo = new Date(now.getTime() - 3600_000).toISOString();
    const recentFromSender = await tx.findRecentRequesterTickets(from, hourAgo, ticketId);
    if (recentFromSender.length >= CONFIRMATIONS_MAX_PER_SENDER_PER_HOUR) {
      await tx.insertNotification('TICKET_CREATED', ticketId, `Novo chamado ${key}`, email.subject, `TICKET_CREATED:${ticketId}`);
      return { action: 'CREATED', ticketId, ticketKey: key, confirmationQueued: false } as const;
    }
    const tpl = buildConfirmationEmail(key);
    const confirmationQueued = await tx.enqueueOutbox({
      id: newId('obx'),
      ticketId,
      kind: 'CONFIRMATION',
      dedupeKey: `CONFIRMATION:${ticketId}`,
      to: [from],
      cc: [],
      subject: tpl.subject,
      bodyText: tpl.bodyText,
      bodyHtml: tpl.bodyHtml,
      inReplyTo: email.messageId,
      references: [...email.references, email.messageId].slice(-20),
      fromMailbox: pipeline.mailbox!.toLowerCase(),
      replyToProviderMessageId: email.providerMessageId,
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: created,
      lastError: null,
      sentAt: null,
    });
    await tx.insertNotification('TICKET_CREATED', ticketId, `Novo chamado ${key}`, email.subject, `TICKET_CREATED:${ticketId}`);
    return { action: 'CREATED', ticketId, ticketKey: key, confirmationQueued } as const;
  });
}
