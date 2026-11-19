// ============================================================================
// STI-hub — Fase 2 (19/11/2026): interruptores do envio real das cadencias comerciais.
//   SEQUENCES_LIVE_SEND            desligado por padrao. Desligado => cadencias so simulam (comportamento
//                                  anterior: contadores e historico, nenhum e-mail sai).
//   SEQUENCES_TEST_RECIPIENTS      lista (virgula/ponto e virgula/espaco) de destinatarios de teste. Quando
//                                  definida, envio real SO para esses enderecos; o resto fica pendente.
//   SEQUENCES_MAX_PER_MAILBOX_HOUR limite de envios de cadencia por caixa por hora (padrao 20).
//   SEQUENCES_MAX_PER_MAILBOX_DAY  limite por caixa por dia local (padrao 100; nunca acima do limite
//                                  diario configurado na janela de envio da cadencia).
// ============================================================================
import type { EmailSequence, SequenceStep } from '../../db/types';

const TRUE_RE = /^(1|true|on|yes|sim)$/i;

export function isSequenceLiveSendEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return TRUE_RE.test(String(env.SEQUENCES_LIVE_SEND || '').trim());
}

/** null => sem allowlist (todos os contatos elegiveis). Conjunto vazio nunca acontece. */
export function resolveSequenceTestRecipients(env: NodeJS.ProcessEnv = process.env): Set<string> | null {
  const raw = String(env.SEQUENCES_TEST_RECIPIENTS || '').trim();
  if (!raw) return null;
  const list = raw
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  return list.length ? new Set(list) : null;
}

function positiveInt(raw: string | undefined, fallback: number, max: number): number {
  const n = Number(String(raw ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

export function resolveMailboxSendLimits(
  seq: Pick<EmailSequence, 'sendingWindow'> | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): { perHour: number; perDay: number } {
  const perHour = positiveInt(env.SEQUENCES_MAX_PER_MAILBOX_HOUR, 20, 500);
  const envDay = positiveInt(env.SEQUENCES_MAX_PER_MAILBOX_DAY, 100, 2000);
  const seqDay = seq?.sendingWindow?.dailyMailboxSendLimit;
  const perDay = seqDay && seqDay > 0 ? Math.min(envDay, seqDay) : envDay;
  return { perHour, perDay };
}

/** Passos que saem automaticamente pela caixa do dono. */
export function isAutoEmailStep(step: Pick<SequenceStep, 'stepType' | 'requiresManualApproval'> | null | undefined): boolean {
  if (!step) return false;
  if (step.requiresManualApproval) return false;
  return step.stepType === 'AUTO_EMAIL' || step.stepType === 'EMAIL' || step.stepType === 'FOLLOW_UP' || step.stepType === 'BREAKUP';
}

/** Passo de e-mail que exige acao do vendedor (vira tarefa no modo real). */
export function isManualEmailStep(step: Pick<SequenceStep, 'stepType' | 'requiresManualApproval'> | null | undefined): boolean {
  if (!step) return false;
  if (step.stepType === 'MANUAL_EMAIL') return true;
  const emailish = step.stepType === 'AUTO_EMAIL' || step.stepType === 'EMAIL' || step.stepType === 'FOLLOW_UP' || step.stepType === 'BREAKUP';
  return emailish && Boolean(step.requiresManualApproval);
}

export function stepIdempotencyKey(enrollmentId: string, stepOrder: number): string {
  return `${enrollmentId}:${stepOrder}`;
}
