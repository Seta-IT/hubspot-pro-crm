// ============================================================================
// SetaDesk - Envio da outbox de e-mails automaticos (Mail.Send).
// Idempotente: um item por (tipo, chamado) via dedupe_key unica; reivindicacao
// atomica (PENDING -> SENDING); retry com backoff; item preso em SENDING vira
// FAILED (nunca reenviado, para nao duplicar). Erros gravados so como codigo.
// ============================================================================

import { SetaDeskGraphError, type SetaDeskGraphClient } from './graph-app-client';
import { isMailboxPermitted } from './config';
import { isOutboundPublic } from './parse';
import { newId, type SetaDeskEmailStore } from './store';
import { SETADESK_SYSTEM_AUTHOR } from './templates';

/** Minutos de espera apos a tentativa n (1-based). Depois da ultima, FAILED. */
export const OUTBOX_BACKOFF_MINUTES = [1, 5, 15, 60, 360] as const;
export const OUTBOX_MAX_ATTEMPTS = OUTBOX_BACKOFF_MINUTES.length + 1;
export const OUTBOX_STALE_SENDING_MINUTES = 15;

export function nextAttemptDelayMinutes(attempts: number): number | null {
  if (attempts >= OUTBOX_MAX_ATTEMPTS) return null;
  return OUTBOX_BACKOFF_MINUTES[Math.max(0, attempts - 1)] ?? null;
}

export function outboxErrorCode(err: unknown): string {
  if (err instanceof SetaDeskGraphError) return `${err.code}:${err.status}${err.graphCode ? `:${err.graphCode}` : ''}`.slice(0, 160);
  return 'SEND_FAILED';
}

export interface OutboxRunResult {
  sent: number;
  retried: number;
  failed: number;
  staleFailed: number;
}

export async function processSetaDeskOutbox(
  store: SetaDeskEmailStore,
  graph: SetaDeskGraphClient,
  opts: { now?: () => Date; limit?: number } = {}
): Promise<OutboxRunResult> {
  const now = opts.now || (() => new Date());
  const result: OutboxRunResult = { sent: 0, retried: 0, failed: 0, staleFailed: 0 };
  result.staleFailed = await store.failStaleSending(OUTBOX_STALE_SENDING_MINUTES, now().toISOString());
  const items = await store.claimDueOutbox(Math.min(Math.max(opts.limit || 20, 1), 100), now().toISOString());
  for (const item of items) {
    // CISO 17/11: a caixa de envio e conferida de novo na hora do envio (lista fixa em producao).
    if (!isMailboxPermitted(item.fromMailbox)) {
      await store.completeOutbox(item.id, { status: 'FAILED', lastError: 'MAILBOX_NOT_ALLOWED' });
      result.failed += 1;
      continue;
    }
    try {
      await graph.sendReply({
        mailbox: item.fromMailbox,
        providerMessageId: item.replyToProviderMessageId,
        to: item.to,
        cc: item.cc,
        subject: item.subject,
        bodyText: item.bodyText,
        bodyHtml: item.bodyHtml,
      });
    } catch (err) {
      const delay = nextAttemptDelayMinutes(item.attempts);
      if (delay === null) {
        await store.completeOutbox(item.id, { status: 'FAILED', lastError: outboxErrorCode(err) });
        result.failed += 1;
      } else {
        await store.completeOutbox(item.id, {
          status: 'PENDING',
          lastError: outboxErrorCode(err),
          nextAttemptAt: new Date(now().getTime() + delay * 60_000).toISOString(),
        });
        result.retried += 1;
      }
      continue;
    }
    const sentAt = now().toISOString();
    await store.completeOutbox(item.id, { status: 'SENT', sentAt, lastError: null });
    result.sent += 1;
    // Registro no historico do chamado. Pacote H: publico so se todos os destinatarios
    // forem o solicitante ou o contato; papel AGENT; autor = sistema (envio automatico).
    try {
      await store.withTx(async (tx) => {
        const t = await tx.getTicketById(item.ticketId);
        if (!t) return;
        const contactEmail = await tx.contactEmailOf(t.contactId);
        const isPublic = isOutboundPublic({ to: item.to, cc: item.cc }, { requesterEmail: t.requesterEmail, contactEmail });
        await tx.insertComment({
          id: `cm-${item.id}`,
          ticketId: t.id,
          author: SETADESK_SYSTEM_AUTHOR,
          authorEmail: item.fromMailbox,
          authorRole: 'AGENT',
          isInternal: !isPublic,
          body: `${item.subject}\n\n${item.bodyText}`,
          bodyHtml: item.bodyHtml,
          source: 'EMAIL',
          emailMessageId: null,
          createdAt: sentAt,
        });
      });
    } catch {
      // O envio ja aconteceu; falha no registro do comentario nao reenvia.
    }
  }
  return result;
}

export { newId };
