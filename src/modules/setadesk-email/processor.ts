// ============================================================================
// SetaDesk - Processamento de um e-mail de entrada (regras de negocio).
// ----------------------------------------------------------------------------
//  1. Fila pela caixa destinataria (setadesk_pipelines.mailbox, fila ativa).
//  2. Deduplicacao SOMENTE pelo Message-ID identico (indice unico).
//  3. Anti-loop: auto-respostas, bounces, caixas das filas e nao-mensagens sao
//     registrados como IGNORED_* e nao abrem chamado nem geram resposta.
//  4. Threading: In-Reply-To -> References (mensagens conhecidas) -> [PREFIX-n]
//     no assunto -> chamado novo. Em TODOS os passos o remetente precisa participar
//     do chamado (solicitante, cc ou contato); se nao, chamado novo + sugestao.
//  5. Nunca funde chamados: assunto parecido do mesmo solicitante gera so uma
//     SUGESTAO em setadesk_related_tickets (status SUGGESTED).
//  6. Resposta do participante vira comentario publico (papel CUSTOMER, origem EMAIL).
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
    // CISO 17/11: a mesma regra de participante vale para In-Reply-To, References e [PREFIX-n].
    // Remetente que nao participa do chamado (solicitante, cc ou contato) NUNCA entra num chamado
    // existente: abre chamado novo com sugestao de relacao.
    let target: StoredTicket | null = null;
    let linkedBy: string | null = null;
    const mismatches: Array<{ ticket: StoredTicket; reason: string }> = [];
    const consider = async (t: StoredTicket | null, via: string, mismatchReason: string): Promise<boolean> => {
      if (!t) return false;
      if (await isParticipant(tx, t, from)) {
        target = t;
        linkedBy = via;
        return true;
      }
      if (!mismatches.some((m) => m.ticket.id === t.id)) mismatches.push({ ticket: t, reason: mismatchReason });
      return false;
    };
    if (email.inReplyTo) {
      const ids = await tx.findTicketIdsByMessageIds([email.inReplyTo]);
      if (ids[0]) await consider(await tx.getTicketById(ids[0]), 'IN_REPLY_TO', 'THREAD_SENDER_NOT_PARTICIPANT');
    }
    if (!target && email.references.length) {
      const ids = await tx.findTicketIdsByMessageIds(email.references);
      for (const id of ids) {
        if (await consider(await tx.getTicketById(id), 'REFERENCES', 'THREAD_SENDER_NOT_PARTICIPANT')) break;
      }
    }
    if (!target) {
      for (const key of extractSubjectTicketKeys(email.subject, prefixes)) {
        const t = await tx.getTicketByKey(key);
        if (!t) continue;
        await consider(t, 'SUBJECT_KEY', 'SUBJECT_KEY_SENDER_NOT_PARTICIPANT');
        break;
      }
    }

    if (target) {
      const t0: StoredTicket = target;
      // So chega aqui remetente participante (regra acima): comentario publico.
      const participant = true;
      const commentId = newId('cm-email');
      await tx.insertComment({
        id: commentId,
        ticketId: t0.id,
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
      if (t0.status === 'WAITING_CUSTOMER') {
        await tx.setTicketStatus(t0.id, 'WAITING_CUSTOMER', 'IN_PROGRESS', 'EMAIL');
      }
      await tx.touchTicket(t0.id);
      await tx.updateEmailMessage(pk, { ticketId: t0.id, commentId, processingStatus: 'LINKED', linkedBy });
      await tx.insertNotification('TICKET_EMAIL_REPLY', t0.id, `Resposta por e-mail em ${t0.key}`, '', `TICKET_EMAIL_REPLY:${pk}`);
      return { action: 'APPENDED', ticketId: t0.id, ticketKey: t0.key, linkedBy: linkedBy!, isInternal: !participant } as const;
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
    for (const m of mismatches) {
      await tx.insertRelatedSuggestion(ticketId, m.ticket.id, m.reason, 1);
    }
    const since = new Date(now.getTime() - RELATED_SUGGESTION_WINDOW_DAYS * 86400_000).toISOString();
    for (const t of await tx.findRecentRequesterTickets(from, since, ticketId)) {
      if (mismatches.some((m) => m.ticket.id === t.id)) continue;
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
