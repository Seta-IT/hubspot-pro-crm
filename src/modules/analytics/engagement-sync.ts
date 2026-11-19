// ============================================================================
// Fase 5 (pendencia da Fase 2): liga aberturas/cliques rastreados aos contadores das cadencias.
// Para cada passo enviado de verdade (stepDeliveries com trackingId), soma os sinais classificados
// e grava em delivery.engagement; os contadores da inscricao passam a refletir o rastreio real
// (abertura = passo com abertura observada; clique = passo com clique humano provavel).
// Idempotente: recalcula a partir dos sinais (nunca soma duas vezes). Nao envia nada.
// ============================================================================
import type { CrmRepository } from '../../db/repository';
import type { SignalStore } from './signal-store';

export interface DeliveryEngagement {
  opensObserved: number;
  opensMachine: number;
  clicksHuman: number;
  clicksBot: number;
  firstHumanClickAt: string | null;
  syncedAt: string;
}

export async function syncSequenceEngagement(repo: CrmRepository, signals: SignalStore, now = new Date()): Promise<{ enrollmentsUpdated: number; deliveriesWithSignals: number }> {
  const enrollments = repo.listSequenceEnrollments().filter((e) => (e.stepDeliveries || []).some((d) => d.trackingId && d.status === 'SENT'));
  const ids = enrollments.flatMap((e) => (e.stepDeliveries || []).map((d) => d.trackingId).filter((x): x is string => Boolean(x)));
  const byTracking = new Map<string, Awaited<ReturnType<SignalStore['listByTracking']>>>();
  for (let i = 0; i < ids.length; i += 5000) {
    for (const s of await signals.listByTracking(ids.slice(i, i + 5000))) byTracking.set(s.trackingId!, [...(byTracking.get(s.trackingId!) || []), s]);
  }
  let enrollmentsUpdated = 0;
  let deliveriesWithSignals = 0;
  for (const e of enrollments) {
    let changed = false;
    let stepsOpened = 0;
    let stepsClicked = 0;
    const deliveries = (e.stepDeliveries || []).map((d) => {
      const sig = d.trackingId ? byTracking.get(d.trackingId) || [] : [];
      if (!sig.length) return d;
      deliveriesWithSignals++;
      const eng: DeliveryEngagement = {
        opensObserved: sig.filter((s) => s.classification === 'OPEN_OBSERVED').length,
        opensMachine: sig.filter((s) => s.classification === 'OPEN_MACHINE').length,
        clicksHuman: sig.filter((s) => s.classification === 'CLICK_HUMAN').length,
        clicksBot: sig.filter((s) => s.classification === 'CLICK_BOT').length,
        firstHumanClickAt: sig.find((s) => s.classification === 'CLICK_HUMAN')?.at || null,
        syncedAt: now.toISOString(),
      };
      if (eng.opensObserved > 0) stepsOpened++;
      if (eng.clicksHuman > 0) stepsClicked++;
      const prev = (d as { engagement?: DeliveryEngagement }).engagement;
      const same = prev && prev.opensObserved === eng.opensObserved && prev.opensMachine === eng.opensMachine && prev.clicksHuman === eng.clicksHuman && prev.clicksBot === eng.clicksBot;
      if (same) return d;
      changed = true;
      return { ...d, engagement: eng };
    });
    const openCount = Math.max(e.openCount || 0, stepsOpened);
    const clickCount = Math.max(e.clickCount || 0, stepsClicked);
    if (changed || openCount !== e.openCount || clickCount !== e.clickCount) {
      repo.saveSequenceEnrollment({ ...e, stepDeliveries: deliveries, openCount, clickCount });
      enrollmentsUpdated++;
    }
  }
  return { enrollmentsUpdated, deliveriesWithSignals };
}
