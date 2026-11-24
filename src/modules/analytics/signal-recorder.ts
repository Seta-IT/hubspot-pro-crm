// Fase 5: grava o sinal classificado de uma abertura/clique rastreado (rota publica /api/email-track).
// Nunca muda a resposta da rota; falha de gravacao e engolida pelo chamador.
import type { MailboxStore } from '../email/mailbox-store';
import { classifySignal, newSignalId, type SignalKind } from './signal-classifier';
import type { EngagementSignal, SignalStore } from './signal-store';

export async function recordTrackedSignal(
  mailbox: MailboxStore,
  signals: SignalStore,
  input: { kind: SignalKind; trackingId: string; linkIndex?: number | null; userAgent: string | null; ip: string | null; method?: string; at?: string; env?: NodeJS.ProcessEnv }
): Promise<EngagementSignal | null> {
  const msg = await mailbox.getByTrackingId(input.trackingId);
  if (!msg) return null;
  const at = input.at || new Date().toISOString();
  const prior = input.kind === 'CLICK' ? (await signals.listByTracking([input.trackingId])).filter((s) => s.kind === 'CLICK').map((s) => s.at) : [];
  const c = classifySignal({ kind: input.kind, userAgent: input.userAgent, ip: input.ip, sentAt: msg.occurredAt, at, priorClickTimes: prior, method: input.method, env: input.env });
  const mkt = /^mkt:([^:]+):/.exec(String(msg.externalId || ''));
  const url = input.kind === 'CLICK' && typeof input.linkIndex === 'number' ? msg.links[input.linkIndex] || null : null;
  const sig: EngagementSignal = {
    id: newSignalId(),
    source: 'TRACKING',
    kind: input.kind,
    classification: c.classification,
    reasons: c.reasons,
    at,
    trackingId: input.trackingId,
    contactId: msg.contactId,
    campaignId: mkt ? mkt[1] : null,
    messageSource: mkt ? 'MARKETING' : 'CRM',
    url,
    linkIndex: input.kind === 'CLICK' ? (input.linkIndex ?? null) : null,
    uaFamily: c.uaFamily,
    ipNetwork: c.ipNetwork,
    secondsSinceSent: c.secondsSinceSent,
  };
  await signals.record(sig);
  return sig;
}
