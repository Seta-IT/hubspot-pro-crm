// ============================================================================
// STI-hub — Fase 6: otimizacao de horario de envio (Send Time Optimization).
// Sugere o melhor horario pelo historico de ENGAJAMENTO HUMANO (clique humano provavel da Fase 5,
// resposta, formulario) — nunca por abertura (Apple MPP abre sozinho). Sempre dentro da janela
// comercial, no fuso America/Sao_Paulo. Sem dados suficientes: segmento -> base -> padrao.
// ============================================================================
import type { CrmRepository } from '../../db/repository';
import type { SignalStore } from '../analytics/signal-store';

export const SEND_TIME_TZ = 'America/Sao_Paulo';
export const STO_MIN_CONTACT_EVENTS = 3;
export const STO_MIN_SEGMENT_EVENTS = 10;
export const STO_MIN_GLOBAL_EVENTS = 20;
export const STO_DEFAULT_HOUR = 10;
export const STO_HISTORY_DAYS = 180;

export interface SendWindow {
  startHour: number;
  /** Exclusivo (18 = ultimo horario 17:00). */
  endHour: number;
  weekdays: number[];
  holidays: string[];
}

export function resolveSendWindow(env: NodeJS.ProcessEnv = process.env): SendWindow {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(env.SEND_TIME_WINDOW || '').trim());
  let startHour = 8;
  let endHour = 18;
  if (m) {
    const s = Number(m[1]);
    const e = Number(m[2]);
    if (s >= 0 && e <= 24 && e - s >= 1) {
      startHour = s;
      endHour = e;
    }
  }
  const wd = String(env.SEND_TIME_WEEKDAYS || '').split(',').map((x) => x.trim()).filter(Boolean).map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6);
  const holidays = String(env.SEND_TIME_HOLIDAYS || '').split(',').map((x) => x.trim()).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
  return { startHour, endHour, weekdays: wd.length ? [...new Set(wd)].sort() : [1, 2, 3, 4, 5], holidays };
}

const FMT = new Intl.DateTimeFormat('en-US', { timeZone: SEND_TIME_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function spParts(ms: number): { weekday: number; hour: number; minute: number; dateKey: string } {
  const p = Object.fromEntries(FMT.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { weekday: WD[p.weekday], hour: Number(p.hour) % 24, minute: Number(p.minute), dateKey: `${p.year}-${p.month}-${p.day}` };
}

/** Instante UTC de "dateKey hh:00" em Sao Paulo. */
export function spToUtc(dateKey: string, hour: number): number {
  const [y, mo, d] = dateKey.split('-').map(Number);
  let guess = Date.UTC(y, mo - 1, d, hour + 3);
  for (let i = 0; i < 3; i++) {
    const p = spParts(guess);
    const diff = (p.dateKey === dateKey ? p.hour - hour : p.dateKey > dateKey ? p.hour + 24 - hour : p.hour - 24 - hour) * 3600000;
    if (diff === 0) break;
    guess -= diff;
  }
  return guess;
}

const WD_LABEL = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export function spDisplay(ms: number): string {
  const p = spParts(ms);
  return `${WD_LABEL[p.weekday]}, ${p.dateKey.slice(8, 10)}/${p.dateKey.slice(5, 7)} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')} (horário de Brasília)`;
}

export type SendTimeSource = 'CONTATO' | 'SEGMENTO' | 'BASE' | 'PADRAO';
export const SEND_TIME_SOURCE_LABELS: Record<SendTimeSource, string> = {
  CONTATO: 'Histórico do próprio contato',
  SEGMENTO: 'Histórico do segmento/empresa',
  BASE: 'Histórico de toda a base',
  PADRAO: 'Padrão (sem dados suficientes)',
};

export interface SendTimeSuggestion {
  at: string;
  localDisplay: string;
  source: SendTimeSource;
  confidence: number;
  events: number;
  hour: number;
  weekday: number;
  reason: string;
}

function isAllowed(ms: number, w: SendWindow): boolean {
  const p = spParts(ms);
  return w.weekdays.includes(p.weekday) && !w.holidays.includes(p.dateKey) && p.hour >= w.startHour && p.hour < w.endHour;
}

export function suggestSendTime(input: {
  contactEvents?: string[];
  segmentEvents?: string[];
  globalEvents?: string[];
  notBefore: Date;
  window: SendWindow;
  maxDelayHours?: number;
}): SendTimeSuggestion {
  const w = input.window;
  const maxDelay = Math.min(14 * 24, Math.max(1, input.maxDelayHours ?? 72));
  const c = input.contactEvents || [];
  const s = input.segmentEvents || [];
  const g = input.globalEvents || [];
  let source: SendTimeSource = 'PADRAO';
  let events: string[] = [];
  if (c.length >= STO_MIN_CONTACT_EVENTS) [source, events] = ['CONTATO', c];
  else if (s.length >= STO_MIN_SEGMENT_EVENTS) [source, events] = ['SEGMENTO', s];
  else if (g.length >= STO_MIN_GLOBAL_EVENTS) [source, events] = ['BASE', g];

  // Histograma (dia da semana x hora), com a hora levada para dentro da janela comercial.
  const clampH = (h: number) => Math.min(w.endHour - 1, Math.max(w.startHour, h));
  const byHour = new Array(24).fill(0);
  const byWdHour: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const at of events) {
    const ms = Date.parse(at);
    if (!Number.isFinite(ms)) continue;
    const p = spParts(ms);
    const h = clampH(p.hour);
    byHour[h]++;
    byWdHour[p.weekday][h]++;
  }
  const smooth = (arr: number[], h: number) => arr[h] + 0.5 * ((arr[h - 1] || 0) + (arr[h + 1] || 0));
  const useWeekday = events.length >= 10;
  const score = (ms: number) => {
    const p = spParts(ms);
    if (source === 'PADRAO') return p.hour === STO_DEFAULT_HOUR ? 1 : 0;
    return smooth(byHour, p.hour) + (useWeekday ? 2 * smooth(byWdHour[p.weekday], p.hour) : 0);
  };

  // Candidatos: inicio de cada hora de notBefore ate notBefore + maxDelay (o primeiro = agora).
  const start = input.notBefore.getTime();
  const candidates: number[] = [];
  if (isAllowed(start, w)) candidates.push(start);
  for (let t = Math.ceil(start / 3600000) * 3600000; t <= start + maxDelay * 3600000; t += 3600000) {
    if (t !== start && isAllowed(t, w) && spParts(t).minute === 0) candidates.push(t);
  }
  // Nada na janela dentro do prazo (ex.: feriado prolongado): primeiro horario comercial depois.
  if (!candidates.length) {
    for (let t = Math.ceil(start / 3600000) * 3600000, i = 0; i < 24 * 30; t += 3600000, i++) {
      if (isAllowed(t, w)) {
        // todos os horarios permitidos do primeiro dia util disponivel (a pontuacao escolhe)
        const day = spParts(t).dateKey;
        for (let u = t; spParts(u).dateKey === day; u += 3600000) if (isAllowed(u, w)) candidates.push(u);
        break;
      }
    }
  }
  let best = candidates[0] ?? start;
  let bestScore = -1;
  for (const t of candidates) {
    const sc = score(t);
    if (sc > bestScore) {
      best = t;
      bestScore = sc;
    }
  }
  // Nao atrasa sem ganho: se enviar ja tem >= 90% da melhor pontuacao, envia ja.
  if (candidates.length && source !== 'PADRAO' && score(candidates[0]) >= 0.9 * bestScore) best = candidates[0];
  const n = events.length;
  const confidence =
    source === 'CONTATO' ? Math.min(0.9, 0.4 + n * 0.05) : source === 'SEGMENTO' ? Math.min(0.7, 0.3 + n * 0.01) : source === 'BASE' ? Math.min(0.5, 0.2 + n * 0.002) : 0.1;
  const p = spParts(best);
  const reason =
    source === 'PADRAO'
      ? `Sem engajamento humano suficiente (contato ${c.length}, segmento ${s.length}, base ${g.length}); usado o padrão de ${STO_DEFAULT_HOUR}h em dia útil.`
      : `${SEND_TIME_SOURCE_LABELS[source]}: ${n} interação(ões) humana(s); horário com mais engajamento dentro da janela ${w.startHour}h-${w.endHour}h.`;
  return { at: new Date(best).toISOString(), localDisplay: spDisplay(best), source, confidence: Math.round(confidence * 100) / 100, events: n, hour: p.hour, weekday: p.weekday, reason };
}

/** Engajamento humano por contato (clique humano provavel, resposta, formulario). */
export async function collectHumanEngagement(repo: CrmRepository, signals: SignalStore, now: Date): Promise<{ byContact: Map<string, string[]>; all: string[] }> {
  const since = new Date(now.getTime() - STO_HISTORY_DAYS * 86400000).toISOString();
  const byContact = new Map<string, string[]>();
  const add = (cid: string | null | undefined, at: string | null | undefined) => {
    if (!cid || !at || at < since) return;
    byContact.set(cid, [...(byContact.get(cid) || []), at]);
  };
  for (const s of await signals.listSince(since, now.toISOString(), 50000)) if (s.classification === 'CLICK_HUMAN') add(s.contactId, s.at);
  for (const e of repo.listSequenceEnrollments()) add(e.contactId, e.repliedAt);
  for (const f of repo.listFormSubmissions()) add(f.contactId, f.submittedAt);
  return { byContact, all: [...byContact.values()].flat() };
}

/** Sugestao para um contato: proprio historico, depois empresa (segmento), depois base. */
export function suggestForContact(repo: CrmRepository, eng: { byContact: Map<string, string[]>; all: string[] }, contactId: string, notBefore: Date, window: SendWindow, segmentContactIds?: string[]): SendTimeSuggestion {
  const contact = repo.getContactById(contactId);
  const seg = segmentContactIds?.length
    ? segmentContactIds
    : contact?.companyId
      ? repo.listContacts().filter((c) => c.companyId === contact.companyId).map((c) => c.id)
      : [];
  return suggestSendTime({
    contactEvents: eng.byContact.get(contactId) || [],
    segmentEvents: seg.flatMap((id) => eng.byContact.get(id) || []),
    globalEvents: eng.all,
    notBefore,
    window,
  });
}
