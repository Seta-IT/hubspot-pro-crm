/**
 * Janelas de atividade da ficha (Observacao, Tarefa, Reuniao, Registrar ... do "Mais").
 * Regras puras: prazos em dias uteis, opcoes do "Mais", payloads das rotas existentes
 * (POST /api/timeline e POST /api/tasks) e a semana da agenda de reunioes.
 */
export type TimelineKind = 'NOTE' | 'EMAIL' | 'CALL' | 'TASK' | 'MEETING';

const WEEKDAYS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const MONTHS = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];

export function addBusinessDays(from: Date, n: number): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}

export function isoDate(d: Date): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export type DueOptionId = 'today' | 'tomorrow' | '2bd' | '3bd' | '1w' | '2w' | '1m' | '3m' | 'custom';

export function dueOptions(now: Date): Array<{ id: DueOptionId; label: string; date: string }> {
  const plusDays = (n: number) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() + n);
    return d;
  };
  const plusMonths = (n: number) => new Date(now.getFullYear(), now.getMonth() + n, now.getDate());
  const bd2 = addBusinessDays(now, 2);
  const bd3 = addBusinessDays(now, 3);
  return [
    { id: 'today', label: 'Hoje', date: isoDate(plusDays(0)) },
    { id: 'tomorrow', label: `Amanhã (${WEEKDAYS[plusDays(1).getDay()]})`, date: isoDate(plusDays(1)) },
    { id: '2bd', label: `Em 2 dias úteis (${WEEKDAYS[bd2.getDay()]})`, date: isoDate(bd2) },
    { id: '3bd', label: `Em 3 dias úteis (${WEEKDAYS[bd3.getDay()]})`, date: isoDate(bd3) },
    { id: '1w', label: 'Em 1 semana', date: isoDate(plusDays(7)) },
    { id: '2w', label: 'Em 2 semanas', date: isoDate(plusDays(14)) },
    { id: '1m', label: 'Em 1 mês', date: isoDate(plusMonths(1)) },
    { id: '3m', label: 'Em 3 meses', date: isoDate(plusMonths(3)) },
    { id: 'custom', label: 'Data personalizada', date: isoDate(bd2) },
  ];
}

export const REMINDER_OPTIONS: Array<{ id: string; label: string; minutes: number | null }> = [
  { id: 'none', label: 'Nenhum lembrete', minutes: null },
  { id: 'at', label: 'Na hora de vencimento da tarefa', minutes: 0 },
  { id: '15', label: '15 minutos antes', minutes: 15 },
  { id: '30', label: '30 minutos antes', minutes: 30 },
  { id: '60', label: '1 hora antes', minutes: 60 },
  { id: '1440', label: '1 dia antes', minutes: 1440 },
];

export const TASK_TYPES = [
  { id: 'TODO', label: 'Tarefas' },
  { id: 'CALL', label: 'Chamada' },
  { id: 'EMAIL', label: 'E-mail' },
] as const;

export const TASK_PRIORITIES = [
  { id: 'NONE', label: 'Nenhuma' },
  { id: 'LOW', label: 'Baixa' },
  { id: 'MEDIUM', label: 'Média' },
  { id: 'HIGH', label: 'Alta' },
] as const;

export const CALL_OUTCOMES = ['Conectado', 'Ocupado', 'Sem resposta', 'Deixou correio de voz', 'Deixou mensagem ao vivo', 'Número errado'];
export const MEETING_OUTCOMES = ['Agendada', 'Concluída', 'Remarcada', 'Não compareceu', 'Cancelada'];

/** Itens do "Mais" (os pagos no outro sistema — sequencias, criar WhatsApp — ficam de fora). */
export type MoreOptionId = 'SMS' | 'POSTAL' | 'EMAIL' | 'CALL' | 'LINKEDIN' | 'WHATSAPP' | 'MEETING';
export const MORE_ACTIVITY_OPTIONS: Array<{ id: MoreOptionId; label: string; type: TimelineKind; channel: string; outcomes?: string[] }> = [
  { id: 'SMS', label: 'Registrar SMS', type: 'NOTE', channel: 'SMS' },
  { id: 'POSTAL', label: 'Registrar correio postal', type: 'NOTE', channel: 'POSTAL_MAIL' },
  { id: 'EMAIL', label: 'Registrar um e-mail', type: 'EMAIL', channel: 'EMAIL' },
  { id: 'CALL', label: 'Registrar uma chamada', type: 'CALL', channel: 'CALL', outcomes: CALL_OUTCOMES },
  { id: 'LINKEDIN', label: 'Registrar uma mensagem do LinkedIn', type: 'NOTE', channel: 'LINKEDIN' },
  { id: 'WHATSAPP', label: 'Registrar uma mensagem do WhatsApp', type: 'NOTE', channel: 'WHATSAPP' },
  { id: 'MEETING', label: 'Registrar uma reunião', type: 'MEETING', channel: 'MEETING', outcomes: MEETING_OUTCOMES },
];

function norm(v: string): string {
  return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export function filterMoreOptions(search: string) {
  const q = norm(search);
  return q ? MORE_ACTIVITY_OPTIONS.filter((o) => norm(o.label).includes(q)) : MORE_ACTIVITY_OPTIONS;
}

/** Registro associado a atividade (a timeline aceita 1 negocio, 1 contato e 1 empresa). */
export interface ActivityAssoc {
  dealId?: string | null;
  contactId?: string | null;
  companyId?: string | null;
}

export function assocCount(a: ActivityAssoc): number {
  return [a.dealId, a.contactId, a.companyId].filter(Boolean).length;
}

export function assocLabel(a: ActivityAssoc): string {
  const n = assocCount(a);
  return `Associado a ${n} registro${n === 1 ? '' : 's'}`;
}

export function firstLine(text: string, max = 120): string {
  const line = text.split('\n').map((s) => s.trim()).find(Boolean) || '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function buildNotePayload(body: string, assoc: ActivityAssoc) {
  const clean = body.trim();
  return { type: 'NOTE' as const, title: firstLine(clean) || 'Observação', body: clean, metadata: { source: 'ACTIVITY_WINDOW' }, ...assoc };
}

export function buildLogPayload(
  option: (typeof MORE_ACTIVITY_OPTIONS)[number],
  input: { body: string; occurredDate: string; occurredTime: string; outcome?: string },
  assoc: ActivityAssoc
) {
  const clean = input.body.trim();
  const titleBase = option.label.replace(/^Registrar (um |uma )?/, '');
  const title = `${titleBase.charAt(0).toUpperCase()}${titleBase.slice(1)}${input.outcome ? ` — ${input.outcome}` : ''}`;
  return {
    type: option.type,
    title,
    body: clean,
    metadata: {
      source: 'ACTIVITY_LOG',
      channel: option.channel,
      occurredAt: `${input.occurredDate}T${input.occurredTime || '00:00'}:00`,
      ...(input.outcome ? { outcome: input.outcome } : {}),
    },
    ...assoc,
  };
}

export function buildTaskPayload(
  input: {
    title: string;
    notes: string;
    type: string;
    priority: string;
    queueName: string;
    dueDate: string;
    dueTime: string;
    reminderMinutes: number | null;
    assignedTo: string;
    repeat?: string | null;
  },
  assoc: ActivityAssoc
) {
  return {
    title: input.title.trim(),
    notes: input.repeat ? `${input.notes.trim()}${input.notes.trim() ? '\n\n' : ''}Repetir: ${input.repeat}` : input.notes.trim(),
    type: input.type,
    priority: input.priority,
    status: 'NOT_STARTED',
    queueName: input.queueName,
    dueDate: input.dueDate,
    dueTime: input.dueTime,
    reminderMinutesBefore: input.reminderMinutes,
    assignedTo: input.assignedTo,
    contactId: assoc.contactId || null,
    companyId: assoc.companyId || null,
    dealId: assoc.dealId || null,
  };
}

/** Tarefa de acompanhamento da observacao ("Criar uma tarefa de ... para acompanhar ..."). */
export function followUpTaskFromNote(body: string, typeId: string, dueDate: string, assignedTo: string, assoc: ActivityAssoc) {
  return buildTaskPayload(
    {
      title: `Acompanhar: ${firstLine(body, 80) || 'observação'}`,
      notes: body.trim(),
      type: typeId,
      priority: 'NONE',
      queueName: '',
      dueDate,
      dueTime: '10:00',
      reminderMinutes: 0,
      assignedTo,
    },
    assoc
  );
}

// ---------------------------------------------------------------- Reuniao / agenda
export function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wd = x.getDay();
  x.setDate(x.getDate() - (wd === 0 ? 6 : wd - 1));
  return x;
}

export function weekDays(start: Date, hideWeekends: boolean): Date[] {
  const n = hideWeekends ? 5 : 7;
  return Array.from({ length: n }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

export function weekRangeLabel(start: Date, hideWeekends: boolean): string {
  const days = weekDays(start, hideWeekends);
  const a = days[0];
  const b = days[days.length - 1];
  return `${a.getDate()} de ${MONTHS[a.getMonth()]} - ${b.getDate()} de ${MONTHS[b.getMonth()]}, ${b.getFullYear()}`;
}

export function dayHeader(d: Date): string {
  return `${WEEKDAYS[d.getDay()].slice(0, 3).toUpperCase()} ${d.getDate()}`;
}

export function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map((x) => Number(x) || 0);
  const total = (h * 60 + m + minutes + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export const MEETING_DURATIONS = [15, 30, 45, 60, 90, 120];

export function buildMeetingPayload(
  input: {
    title: string;
    hostName: string;
    date: string;
    startTime: string;
    durationMin: number;
    attendees: string[];
    location: string;
    reminders: number[];
    description: string;
    internalNote?: string;
  },
  assoc: ActivityAssoc
) {
  const endTime = addMinutesToTime(input.startTime, input.durationMin);
  return {
    type: 'MEETING' as const,
    title: input.title.trim() || 'Reunião',
    body: [input.description.trim(), input.internalNote?.trim() ? `Observação interna: ${input.internalNote.trim()}` : ''].filter(Boolean).join('\n\n'),
    metadata: {
      source: 'MEETING_SCHEDULER',
      hostName: input.hostName,
      startAt: `${input.date}T${input.startTime}:00`,
      endAt: `${input.date}T${endTime}:00`,
      durationMin: input.durationMin,
      attendees: input.attendees,
      location: input.location.trim(),
      reminderMinutesBefore: input.reminders,
      timeZone: 'America/Sao_Paulo',
      invitesSent: false,
    },
    ...assoc,
  };
}

/** Compromissos da semana: reunioes da timeline (metadata.startAt) e tarefas com vencimento. */
export interface AgendaItem {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  start: string; // HH:mm
  end: string; // HH:mm
  kind: 'MEETING' | 'TASK' | 'DRAFT';
}

export function agendaFromSources(
  events: Array<{ id: string; type: string; title: string; metadata?: Record<string, unknown>; actor?: string }>,
  tasks: Array<{ id: string; title: string; dueDate?: string; dueTime?: string; assignedTo?: string }>,
  userName: string | null | undefined
): AgendaItem[] {
  const me = norm(String(userName || ''));
  const mine = (who: unknown) => !me || (norm(String(who || '')) !== '' && norm(String(who || '')).includes(me));
  const out: AgendaItem[] = [];
  for (const e of events) {
    if (e.type !== 'MEETING') continue;
    const s = String(e.metadata?.startAt || '');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) continue;
    if (!mine(e.metadata?.hostName || e.actor)) continue;
    const en = String(e.metadata?.endAt || '');
    out.push({ id: e.id, title: e.title, date: s.slice(0, 10), start: s.slice(11, 16), end: /T\d{2}:\d{2}/.test(en) ? en.slice(11, 16) : addMinutesToTime(s.slice(11, 16), 30), kind: 'MEETING' });
  }
  for (const t of tasks) {
    if (!t.dueDate || !mine(t.assignedTo)) continue;
    const st = t.dueTime || '09:00';
    out.push({ id: t.id, title: t.title, date: t.dueDate, start: st, end: addMinutesToTime(st, 30), kind: 'TASK' });
  }
  return out;
}
