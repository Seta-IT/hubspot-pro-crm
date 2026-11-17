// ============================================================================
// SetaDesk - Primeira abertura do chamado por um usuario interno.
// Chamado pelo modal (POST /api/tickets/:id/mark-viewed), nao pelo GET do detalhe,
// para nao disparar com prefetch. Grava first_viewed_at/by uma unica vez e, so em
// chamado aberto por e-mail e ainda em aberto, enfileira UMA vez o aviso
// "estamos analisando" ("Chamado em atendimento", texto aprovado; flag propria desligada por padrao).
// ============================================================================

import { isSetaDeskAnalysisNoticeEnabled, isSetaDeskEmailIntakeEnabled } from './config';
import { newId, type SetaDeskEmailStore } from './store';
import { buildAnalysisNoticeEmail } from './templates';

export type MarkViewedResult =
  | { recorded: false; reason: 'INTAKE_DISABLED' | 'NOT_FOUND' }
  | { recorded: true; firstTime: boolean; analysisQueued: boolean };

const CLOSED = new Set(['RESOLVED', 'CLOSED']);

export async function markSetaDeskTicketViewed(
  store: SetaDeskEmailStore,
  idOrKey: string,
  viewer: string,
  opts: { env?: Record<string, string | undefined>; now?: () => Date } = {}
): Promise<MarkViewedResult> {
  const env = opts.env || process.env;
  if (!isSetaDeskEmailIntakeEnabled(env)) return { recorded: false, reason: 'INTAKE_DISABLED' };
  const nowIso = (opts.now ? opts.now() : new Date()).toISOString();
  const r = await store.markFirstViewed(idOrKey, String(viewer || 'desconhecido').slice(0, 200), nowIso);
  if (!r) return { recorded: false, reason: 'NOT_FOUND' };
  if (!r.firstTime) return { recorded: true, firstTime: false, analysisQueued: false };
  const t = r.ticket;
  if (!isSetaDeskAnalysisNoticeEnabled(env) || t.channel !== 'EMAIL' || t.source !== 'EMAIL' || CLOSED.has(t.status) || !t.requesterEmail) {
    return { recorded: true, firstTime: true, analysisQueued: false };
  }
  const analysisQueued = await store.withTx(async (tx) => {
    const original = await tx.originalInboundMessage(t.id);
    const pipeline = await tx.getPipelineById(t.pipelineId);
    const fromMailbox = (original?.mailbox || pipeline?.mailbox || '').toLowerCase();
    if (!fromMailbox) return false;
    const tpl = buildAnalysisNoticeEmail(t.key);
    return tx.enqueueOutbox({
      id: newId('obx'),
      ticketId: t.id,
      kind: 'ANALYSIS_NOTICE',
      dedupeKey: `ANALYSIS_NOTICE:${t.id}`,
      to: [t.requesterEmail!],
      cc: [],
      subject: tpl.subject,
      bodyText: tpl.bodyText,
      bodyHtml: tpl.bodyHtml,
      inReplyTo: original?.messageId || null,
      references: original ? [...original.references, original.messageId].slice(-20) : [],
      fromMailbox,
      replyToProviderMessageId: original?.providerMessageId || null,
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: nowIso,
      lastError: null,
      sentAt: null,
    });
  });
  return { recorded: true, firstTime: true, analysisQueued };
}
