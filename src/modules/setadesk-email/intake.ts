// ============================================================================
// SetaDesk - Ciclo de entrada: delta query (Mail.Read) por caixa + envio da outbox.
// ----------------------------------------------------------------------------
// Escolha: delta query periodica em vez de webhook (change notifications). Motivos:
//  - nao exige endpoint publico novo (o webhook precisaria entrar na lista publica
//    do middleware, arquivo que este lote nao altera) nem renovacao de subscription
//    a cada <= 3 dias; o cursor fica no banco (setadesk_mail_sync_state.delta_link);
//  - tolerante a falhas: se o ciclo cai, o proximo retoma do ultimo cursor salvo, e
//    a deduplicacao por Message-ID torna o reprocessamento seguro.
// Primeira execucao de uma caixa: grava intake_started_at = agora e so le mensagens
// recebidas a partir dai (nunca importa o historico da caixa nem responde e-mails antigos).
// Nunca marca como lido nem move mensagens (somente GET).
// Log: apenas contagens e codigos (sem enderecos, assuntos, tokens ou configuracao).
// ============================================================================

import { allowedIntakeMailboxes, isSetaDeskEmailIntakeEnabled } from './config';
import { SetaDeskGraphError, type SetaDeskGraphClient } from './graph-app-client';
import { processSetaDeskOutbox, type OutboxRunResult } from './outbox';
import { normalizeGraphMessage } from './parse';
import { processInboundEmail, type ProcessContext } from './processor';
import type { SetaDeskEmailStore } from './store';

export interface MailboxRunSummary {
  pipelineId: string;
  prefix: string;
  pages: number;
  created: number;
  appended: number;
  duplicates: number;
  ignored: number;
  skippedBeforeStart: number;
  errorCode: string | null;
}

export type IntakeRunResult =
  | { enabled: false }
  | { enabled: true; mailboxes: MailboxRunSummary[]; outbox: OutboxRunResult | null };

export interface IntakeRunOptions {
  store: SetaDeskEmailStore;
  graph: SetaDeskGraphClient;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  resolveRequester?: ProcessContext['resolveRequester'];
  maxPagesPerMailbox?: number;
  log?: (line: string) => void;
}

function errCode(err: unknown): string {
  if (err instanceof SetaDeskGraphError) return `${err.code}:${err.status}${err.graphCode ? `:${err.graphCode}` : ''}`.slice(0, 160);
  return 'INTAKE_PROCESSING_FAILED';
}

export async function runSetaDeskEmailIntake(opts: IntakeRunOptions): Promise<IntakeRunResult> {
  const env = opts.env || process.env;
  if (!isSetaDeskEmailIntakeEnabled(env)) return { enabled: false };
  const now = opts.now || (() => new Date());
  const log = opts.log || ((line: string) => console.info(line));
  const allow = new Set(allowedIntakeMailboxes(env));
  const pipelines = await opts.store.listPipelines();
  const targets = pipelines.filter((p) => p.isActive && p.mailbox && allow.has(p.mailbox.toLowerCase()));
  const summaries: MailboxRunSummary[] = [];

  for (const pl of targets) {
    const mailbox = pl.mailbox!.toLowerCase();
    const s: MailboxRunSummary = {
      pipelineId: pl.id, prefix: pl.prefix, pages: 0, created: 0, appended: 0, duplicates: 0, ignored: 0, skippedBeforeStart: 0, errorCode: null,
    };
    summaries.push(s);
    try {
      let state = await opts.store.getSyncState(mailbox);
      if (!state || !state.intakeStartedAt) {
        await opts.store.saveSyncState(mailbox, { intakeStartedAt: now().toISOString() });
        state = await opts.store.getSyncState(mailbox);
      }
      const startedAt = state!.intakeStartedAt!;
      let cursor = state!.deltaLink;
      const maxPages = Math.min(Math.max(opts.maxPagesPerMailbox || 5, 1), 20);
      for (let i = 0; i < maxPages; i += 1) {
        const page = await opts.graph.deltaPage(mailbox, cursor, startedAt);
        s.pages += 1;
        for (const item of page.items) {
          if (item.removed) continue;
          if (item.receivedDateTime && Date.parse(item.receivedDateTime) < Date.parse(startedAt)) {
            s.skippedBeforeStart += 1;
            continue;
          }
          const email = normalizeGraphMessage(await opts.graph.getMessage(mailbox, item.id));
          if (email.receivedAt && Date.parse(email.receivedAt) < Date.parse(startedAt)) {
            s.skippedBeforeStart += 1;
            continue;
          }
          const r = await processInboundEmail(opts.store, email, {
            mailbox, pipelines, resolveRequester: opts.resolveRequester, now,
          });
          if (r.action === 'CREATED') s.created += 1;
          else if (r.action === 'APPENDED') s.appended += 1;
          else if (r.action === 'DUPLICATE') s.duplicates += 1;
          else s.ignored += 1;
        }
        // Cursor so avanca depois da pagina inteira processada.
        cursor = page.nextLink || page.deltaLink || cursor;
        await opts.store.saveSyncState(mailbox, { deltaLink: cursor, errorCode: null });
        if (!page.nextLink) break;
      }
    } catch (err) {
      s.errorCode = errCode(err);
      try {
        await opts.store.saveSyncState(mailbox, { errorCode: s.errorCode });
      } catch {
        // ignora
      }
    }
  }

  let outbox: OutboxRunResult | null = null;
  try {
    outbox = await processSetaDeskOutbox(opts.store, opts.graph, { now });
  } catch (err) {
    log(`[SetaDesk e-mail] outbox falhou: ${errCode(err)}`);
  }
  log(
    `[SetaDesk e-mail] ciclo: ${summaries
      .map((s) => `${s.prefix} criados=${s.created} respostas=${s.appended} duplicados=${s.duplicates} ignorados=${s.ignored} erro=${s.errorCode || '-'}`)
      .join('; ') || 'nenhuma caixa autorizada'}; outbox enviados=${outbox?.sent ?? 0} retry=${outbox?.retried ?? 0} falhas=${outbox?.failed ?? 0}`
  );
  return { enabled: true, mailboxes: summaries, outbox };
}
