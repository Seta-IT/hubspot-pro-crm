'use client';

/**
 * Janelas de atividade da ficha (padrao: janela flutuante embaixo a direita).
 *  - FloatingActivityWindow: base com minimizar / expandir / fechar, Esc fecha, redimensionavel;
 *    minimizada mantem o rascunho (o conteudo continua montado).
 *  - NoteWindow (Observacao), TaskWindow (Tarefa), LogActivityWindow (itens do "Mais" e Chamada),
 *    MoreActivitiesMenu (popover "Mais") e MeetingSchedulerModal (Reuniao / Programacao).
 * Gravacao: callbacks do pai, que usam POST /api/timeline e POST /api/tasks (rotas existentes).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Italic,
  Link2,
  Maximize2,
  Minimize2,
  Minus,
  Paperclip,
  RemoveFormatting,
  Search,
  Underline,
  X,
} from 'lucide-react';
import {
  MEETING_DURATIONS,
  MORE_ACTIVITY_OPTIONS,
  REMINDER_OPTIONS,
  TASK_PRIORITIES,
  TASK_TYPES,
  addMinutesToTime,
  assocLabel,
  buildLogPayload,
  buildMeetingPayload,
  buildNotePayload,
  buildTaskPayload,
  dayHeader,
  dueOptions,
  filterMoreOptions,
  followUpTaskFromNote,
  isoDate,
  startOfWeek,
  weekDays,
  weekRangeLabel,
  type ActivityAssoc,
  type AgendaItem,
  type DueOptionId,
  type MoreOptionId,
} from '../lib/activity-composer';

export type TimelinePayload = ReturnType<typeof buildNotePayload> | ReturnType<typeof buildLogPayload> | ReturnType<typeof buildMeetingPayload>;
export type TaskPayload = ReturnType<typeof buildTaskPayload>;

export interface AssocCandidate {
  kind: 'deal' | 'contact' | 'company';
  id: string;
  label: string;
}

// ------------------------------------------------------------------ base
export function FloatingActivityWindow({
  title,
  minimized,
  onMinimize,
  onClose,
  children,
  footer,
  testId,
}: {
  title: string;
  minimized: boolean;
  onMinimize: (v: boolean) => void;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
  testId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[data-assoc-panel-open="1"]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const size = expanded ? { width: 'min(92vw, 960px)', height: 'min(88vh, 760px)' } : { width: 'min(92vw, 600px)', height: 'min(80vh, 560px)' };
  return (
    <div
      role="dialog"
      aria-label={title}
      data-testid={testId}
      className="fixed bottom-0 right-6 z-[65] bg-white rounded-t-lg shadow-2xl border border-slate-300 flex flex-col overflow-hidden"
      style={minimized ? { width: 320 } : { ...size, resize: 'both', minWidth: 380, minHeight: 300 }}
    >
      <header className="px-3 py-2 bg-[#0b6b7a] text-white flex items-center gap-2 shrink-0">
        <button type="button" onClick={() => onMinimize(!minimized)} aria-label={minimized ? 'Restaurar' : 'Minimizar'} className="p-1 rounded hover:bg-white/15 cursor-pointer">
          {minimized ? <ChevronDown className="w-4 h-4 rotate-180" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        <span className="text-sm font-semibold flex-1 truncate">{title}</span>
        {!minimized ? (
          <button type="button" onClick={() => setExpanded((v) => !v)} aria-label={expanded ? 'Reduzir' : 'Expandir'} className="p-1 rounded hover:bg-white/15 cursor-pointer">
            {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        ) : null}
        <button type="button" onClick={onClose} aria-label="Fechar" className="p-1 rounded hover:bg-white/15 cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </header>
      <div className={minimized ? 'hidden' : 'flex-1 min-h-0 overflow-y-auto'}>{children}</div>
      {!minimized ? <footer className="px-4 py-3 border-t border-slate-200 bg-white shrink-0">{footer}</footer> : null}
    </div>
  );
}

// ------------------------------------------------------------------ editor
export function RichTextArea({ placeholder, onChange, testId, minHeight = 140 }: { placeholder: string; onChange: (text: string) => void; testId?: string; minHeight?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [empty, setEmpty] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  const exec = (cmd: string, value?: string) => {
    ref.current?.focus();
    try {
      document.execCommand(cmd, false, value);
    } catch {
      /* navegador sem execCommand */
    }
    emit();
  };
  const emit = () => {
    const text = ref.current?.innerText || '';
    setEmpty(!text.trim());
    onChange(text);
  };
  const Btn = ({ label, onClick, children, disabled }: { label: string; onClick?: () => void; children: React.ReactNode; disabled?: boolean }) => (
    <button
      type="button"
      title={disabled ? `${label} (em breve)` : label}
      aria-label={label}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="p-1.5 rounded text-slate-600 hover:bg-slate-100 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
    >
      {children}
    </button>
  );
  return (
    <div className="space-y-1">
      <div className="relative">
        {empty ? <div className="absolute left-0 top-0 text-sm text-slate-400 pointer-events-none">{placeholder}</div> : null}
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={placeholder}
          data-testid={testId}
          onInput={emit}
          className="text-sm text-slate-900 outline-none whitespace-pre-wrap"
          style={{ minHeight }}
        />
      </div>
      <div className="flex items-center gap-0.5 border-t border-slate-100 pt-1 relative">
        <Btn label="Negrito" onClick={() => exec('bold')}>
          <Bold className="w-4 h-4" />
        </Btn>
        <Btn label="Itálico" onClick={() => exec('italic')}>
          <Italic className="w-4 h-4" />
        </Btn>
        <Btn label="Sublinhado" onClick={() => exec('underline')}>
          <Underline className="w-4 h-4" />
        </Btn>
        <Btn label="Limpar formatação" onClick={() => exec('removeFormat')}>
          <RemoveFormatting className="w-4 h-4" />
        </Btn>
        <Btn label="Mais" onClick={() => setMoreOpen((v) => !v)}>
          <span className="text-xs font-semibold flex items-center">
            Mais <ChevronDown className="w-3 h-3" />
          </span>
        </Btn>
        <span className="w-px h-4 bg-slate-200 mx-1" />
        <Btn
          label="Inserir link"
          onClick={() => {
            const url = typeof window !== 'undefined' ? window.prompt('Endereço do link (https://...)') : null;
            if (url && /^https?:\/\//i.test(url.trim())) exec('createLink', url.trim());
          }}
        >
          <Link2 className="w-4 h-4" />
        </Btn>
        <Btn label="Imagem" disabled>
          <ImageIcon className="w-4 h-4" />
        </Btn>
        <Btn label="Anexo" disabled>
          <Paperclip className="w-4 h-4" />
        </Btn>
        {moreOpen ? (
          <div className="absolute bottom-9 left-24 z-10 bg-white border border-slate-200 rounded-md shadow-lg py-1 text-xs">
            {[
              ['strikeThrough', 'Tachado'],
              ['insertUnorderedList', 'Lista com marcadores'],
              ['insertOrderedList', 'Lista numerada'],
            ].map(([cmd, label]) => (
              <button
                key={cmd}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  exec(cmd);
                  setMoreOpen(false);
                }}
                className="block w-full text-left px-3 py-1.5 hover:bg-slate-50 cursor-pointer"
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ associado a
export function AssociatedToDropdown({
  candidates,
  value,
  onChange,
  onOpenPanel,
}: {
  candidates: AssocCandidate[];
  value: ActivityAssoc;
  onChange: (v: ActivityAssoc) => void;
  onOpenPanel?: (kind: 'contacts' | 'companies') => void;
}) {
  const [open, setOpen] = useState(false);
  const isOn = (c: AssocCandidate) =>
    c.kind === 'deal' ? value.dealId === c.id : c.kind === 'contact' ? value.contactId === c.id : value.companyId === c.id;
  const toggle = (c: AssocCandidate) => {
    if (c.kind === 'deal') return; // o registro de origem fica sempre associado
    const key = c.kind === 'contact' ? 'contactId' : 'companyId';
    onChange({ ...value, [key]: isOn(c) ? null : c.id });
  };
  return (
    <div className="relative inline-block">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs font-semibold text-[#0b6b7a] flex items-center gap-1 cursor-pointer" data-testid="activity-assoc-toggle">
        {assocLabel(value)} <ChevronDown className="w-3 h-3" />
      </button>
      {open ? (
        <div className="absolute bottom-6 left-0 z-20 w-72 bg-white border border-slate-200 rounded-md shadow-xl p-2 space-y-1 text-xs">
          {(['deal', 'contact', 'company'] as const).map((k) => {
            const list = candidates.filter((c) => c.kind === k);
            if (!list.length) return null;
            return (
              <div key={k}>
                <div className="px-1 pt-1 text-[10px] font-semibold uppercase text-slate-500">{k === 'deal' ? 'Negócio' : k === 'contact' ? 'Contato (1)' : 'Empresa (1)'}</div>
                {list.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-slate-50 cursor-pointer">
                    <input type="checkbox" checked={isOn(c)} disabled={c.kind === 'deal'} onChange={() => toggle(c)} className="accent-[#0b6b7a]" />
                    <span className="truncate">{c.label}</span>
                  </label>
                ))}
              </div>
            );
          })}
          {onOpenPanel ? (
            <div className="flex gap-3 border-t border-slate-100 pt-1.5 px-1">
              <button type="button" onClick={() => { setOpen(false); onOpenPanel('contacts'); }} className="font-semibold text-[#0b6b7a] hover:underline cursor-pointer">
                + Outro contato
              </button>
              <button type="button" onClick={() => { setOpen(false); onOpenPanel('companies'); }} className="font-semibold text-[#0b6b7a] hover:underline cursor-pointer">
                + Outra empresa
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const btnPrimary =
  'px-4 py-2 rounded-md bg-[#ff5c35] text-white text-sm font-semibold cursor-pointer disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed';
const field = 'px-2.5 py-1.5 rounded-md border border-slate-300 text-sm bg-white';

interface CommonProps {
  recordChip: string;
  candidates: AssocCandidate[];
  initialAssoc: ActivityAssoc;
  minimized: boolean;
  onMinimize: (v: boolean) => void;
  onClose: () => void;
  onOpenAssocPanel?: (kind: 'contacts' | 'companies', apply: (id: string) => void) => void;
  currentUserName?: string | null;
  now?: Date;
}

function useAssoc(initial: ActivityAssoc, onOpenAssocPanel: CommonProps['onOpenAssocPanel']) {
  const [assoc, setAssoc] = useState<ActivityAssoc>(initial);
  const openPanel = onOpenAssocPanel
    ? (kind: 'contacts' | 'companies') => onOpenAssocPanel(kind, (id) => setAssoc((a) => ({ ...a, [kind === 'contacts' ? 'contactId' : 'companyId']: id })))
    : undefined;
  return { assoc, setAssoc, openPanel };
}

// ------------------------------------------------------------------ observacao
export function NoteWindow(p: CommonProps & { onCreateNote: (t: TimelinePayload) => Promise<void>; onCreateTask: (t: TaskPayload) => Promise<void> }) {
  const now = p.now || new Date();
  const [body, setBody] = useState('');
  const [followUp, setFollowUp] = useState(false);
  const [followType, setFollowType] = useState('TODO');
  const opts = useMemo(() => dueOptions(now), [now]);
  const [followDue, setFollowDue] = useState<DueOptionId>('2bd');
  const [saving, setSaving] = useState(false);
  const { assoc, setAssoc, openPanel } = useAssoc(p.initialAssoc, p.onOpenAssocPanel);
  const submit = async () => {
    if (!body.trim()) return;
    setSaving(true);
    try {
      await p.onCreateNote(buildNotePayload(body, assoc));
      if (followUp) {
        const due = opts.find((o) => o.id === followDue)?.date || isoDate(now);
        await p.onCreateTask(followUpTaskFromNote(body, followType, due, p.currentUserName || '', assoc));
      }
      p.onClose();
    } finally {
      setSaving(false);
    }
  };
  return (
    <FloatingActivityWindow
      title="Observação"
      testId="activity-window-note"
      minimized={p.minimized}
      onMinimize={p.onMinimize}
      onClose={p.onClose}
      footer={
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap text-xs text-slate-700">
            <AssociatedToDropdown candidates={p.candidates} value={assoc} onChange={setAssoc} onOpenPanel={openPanel} />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-700 flex-wrap">
            <input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} className="accent-[#0b6b7a]" />
            Criar uma tarefa de
            <select value={followType} onChange={(e) => setFollowType(e.target.value)} className="font-semibold text-[#0b6b7a] bg-transparent cursor-pointer">
              {TASK_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            para acompanhar
            <select value={followDue} onChange={(e) => setFollowDue(e.target.value as DueOptionId)} className="font-semibold text-[#0b6b7a] bg-transparent cursor-pointer">
              {opts
                .filter((o) => o.id !== 'custom')
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
            </select>
          </label>
          <button type="button" className={btnPrimary} disabled={!body.trim() || saving} onClick={() => void submit()} data-testid="note-create">
            {saving ? 'Criando…' : 'Criar observação'}
          </button>
        </div>
      }
    >
      <div className="px-4 py-3 space-y-3">
        <div className="text-sm text-slate-700 flex items-center gap-2">
          Para
          <span className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-800">{p.recordChip}</span>
        </div>
        <RichTextArea placeholder="Comece a digitar para adicionar uma observação..." onChange={setBody} testId="note-body" />
      </div>
    </FloatingActivityWindow>
  );
}

// ------------------------------------------------------------------ tarefa
export function TaskWindow(p: CommonProps & { onCreateTask: (t: TaskPayload) => Promise<void>; assignees?: string[]; queues?: string[] }) {
  const now = p.now || new Date();
  const opts = useMemo(() => dueOptions(now), [now]);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState<DueOptionId>('2bd');
  const [customDate, setCustomDate] = useState(opts.find((o) => o.id === '2bd')?.date || isoDate(now));
  const [time, setTime] = useState('10:00');
  const [reminder, setReminder] = useState('at');
  const [repeat, setRepeat] = useState(false);
  const [repeatEvery, setRepeatEvery] = useState('Semanalmente');
  const [type, setType] = useState('TODO');
  const [priority, setPriority] = useState('NONE');
  const [queue, setQueue] = useState('');
  const [assignee, setAssignee] = useState(p.currentUserName || '');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const { assoc, setAssoc, openPanel } = useAssoc(p.initialAssoc, p.onOpenAssocPanel);
  const dueDate = due === 'custom' ? customDate : opts.find((o) => o.id === due)?.date || isoDate(now);
  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await p.onCreateTask(
        buildTaskPayload(
          {
            title,
            notes,
            type,
            priority,
            queueName: queue,
            dueDate,
            dueTime: time,
            reminderMinutes: REMINDER_OPTIONS.find((r) => r.id === reminder)?.minutes ?? null,
            assignedTo: assignee,
            repeat: repeat ? repeatEvery : null,
          },
          assoc
        )
      );
      p.onClose();
    } finally {
      setSaving(false);
    }
  };
  const assignees = Array.from(new Set([p.currentUserName || '', ...(p.assignees || [])].filter(Boolean)));
  const L = ({ children }: { children: React.ReactNode }) => <span className="block text-xs font-semibold text-slate-700 mb-1">{children}</span>;
  return (
    <FloatingActivityWindow
      title="Tarefa"
      testId="activity-window-task"
      minimized={p.minimized}
      onMinimize={p.onMinimize}
      onClose={p.onClose}
      footer={
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <AssociatedToDropdown candidates={p.candidates} value={assoc} onChange={setAssoc} onOpenPanel={openPanel} />
          <button type="button" className={btnPrimary} disabled={!title.trim() || saving} onClick={() => void submit()} data-testid="task-create">
            {saving ? 'Criando…' : 'Criar tarefa'}
          </button>
        </div>
      }
    >
      <div className="px-4 py-3 space-y-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Insira o título da tarefa" className="w-full text-base font-semibold outline-none placeholder:text-slate-400" data-testid="task-title" />
        <div className="grid grid-cols-2 gap-3">
          <label>
            <L>Data de vencimento</L>
            <div className="flex gap-2">
              <select value={due} onChange={(e) => setDue(e.target.value as DueOptionId)} className={`${field} flex-1 min-w-0`}>
                {opts.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={`${field} w-24`} aria-label="Hora" />
            </div>
            {due === 'custom' ? <input type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)} className={`${field} mt-2 w-full`} /> : null}
          </label>
          <label>
            <L>Lembrete</L>
            <select value={reminder} onChange={(e) => setReminder(e.target.value)} className={`${field} w-full`}>
              {REMINDER_OPTIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} className="accent-[#0b6b7a]" />
          Definido para repetir
          {repeat ? (
            <select value={repeatEvery} onChange={(e) => setRepeatEvery(e.target.value)} className="font-semibold text-[#0b6b7a] bg-transparent">
              {['Diariamente', 'Semanalmente', 'Mensalmente', 'A cada 3 meses', 'A cada 6 meses', 'Anualmente'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          ) : null}
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label>
            <L>Tipo de tarefa</L>
            <select value={type} onChange={(e) => setType(e.target.value)} className={`${field} w-full`}>
              {TASK_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <L>Prioridade</L>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className={`${field} w-full`}>
              {TASK_PRIORITIES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <L>Fila</L>
            <select value={queue} onChange={(e) => setQueue(e.target.value)} className={`${field} w-full`}>
              <option value="">Nenhuma</option>
              {(p.queues || []).map((q) => (
                <option key={q}>{q}</option>
              ))}
            </select>
          </label>
          <label>
            <L>Atribuído a</L>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={`${field} w-full`}>
              {assignees.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="border-t border-slate-100 pt-3">
          <RichTextArea placeholder="Observações..." onChange={setNotes} minHeight={90} />
        </div>
      </div>
    </FloatingActivityWindow>
  );
}

// ------------------------------------------------------------------ registrar (Mais / Chamada)
export function LogActivityWindow(p: CommonProps & { optionId: MoreOptionId; onCreateLog: (t: TimelinePayload) => Promise<void> }) {
  const option = MORE_ACTIVITY_OPTIONS.find((o) => o.id === p.optionId) || MORE_ACTIVITY_OPTIONS[0];
  const now = p.now || new Date();
  const [date, setDate] = useState(isoDate(now));
  const [time, setTime] = useState(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
  const [outcome, setOutcome] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const { assoc, setAssoc, openPanel } = useAssoc(p.initialAssoc, p.onOpenAssocPanel);
  const submit = async () => {
    if (!body.trim()) return;
    setSaving(true);
    try {
      await p.onCreateLog(buildLogPayload(option, { body, occurredDate: date, occurredTime: time, outcome }, assoc));
      p.onClose();
    } finally {
      setSaving(false);
    }
  };
  return (
    <FloatingActivityWindow
      title={option.label}
      testId={`activity-window-log-${option.id}`}
      minimized={p.minimized}
      onMinimize={p.onMinimize}
      onClose={p.onClose}
      footer={
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <AssociatedToDropdown candidates={p.candidates} value={assoc} onChange={setAssoc} onOpenPanel={openPanel} />
          <button type="button" className={btnPrimary} disabled={!body.trim() || saving} onClick={() => void submit()} data-testid="log-create">
            {saving ? 'Registrando…' : 'Registrar'}
          </button>
        </div>
      }
    >
      <div className="px-4 py-3 space-y-3">
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="text-sm text-slate-700 flex items-center gap-2">
            Para <span className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-800">{p.recordChip}</span>
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {option.outcomes ? (
            <label>
              <span className="block text-xs font-semibold text-slate-700 mb-1">Resultado</span>
              <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className={`${field} w-full`}>
                <option value="">Selecionar</option>
                {option.outcomes.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            <span className="block text-xs font-semibold text-slate-700 mb-1">Data</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${field} w-full`} />
          </label>
          <label>
            <span className="block text-xs font-semibold text-slate-700 mb-1">Hora</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={`${field} w-full`} />
          </label>
        </div>
        <RichTextArea placeholder="Descreva a atividade..." onChange={setBody} testId="log-body" />
      </div>
    </FloatingActivityWindow>
  );
}

// ------------------------------------------------------------------ "Mais"
export function MoreActivitiesMenu({
  onPick,
  onClose,
  extra = [],
}: {
  onPick: (id: MoreOptionId) => void;
  onClose: () => void;
  /** Acoes da ficha que ja existiam no botao (ex.: Gerar proposta). */
  extra?: Array<{ id: string; label: string; onClick: () => void }>;
}) {
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  const list = filterMoreOptions(q);
  return (
    <div ref={ref} className="absolute z-[66] top-full mt-2 right-0 w-72 bg-white border border-slate-200 rounded-md shadow-xl" data-testid="more-activities-menu">
      <div className="p-2 border-b border-slate-100 relative">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar" className="w-full pl-2.5 pr-8 py-1.5 rounded-md border border-slate-300 text-sm" />
        <Search className="w-4 h-4 text-slate-500 absolute right-4 top-1/2 -translate-y-1/2" />
      </div>
      <ul className="max-h-64 overflow-y-auto py-1">
        {list.map((o) => (
          <li key={o.id}>
            <button type="button" onClick={() => onPick(o.id)} className="w-full text-left px-3 py-2 text-sm text-slate-800 hover:bg-slate-50 cursor-pointer">
              {o.label}
            </button>
          </li>
        ))}
        {!list.length ? <li className="px-3 py-2 text-sm text-slate-500">Nenhuma opção.</li> : null}
        {extra.length ? <li className="border-t border-slate-100 my-1" /> : null}
        {extra.map((x) => (
          <li key={x.id}>
            <button type="button" onClick={x.onClick} className="w-full text-left px-3 py-2 text-sm text-slate-800 hover:bg-slate-50 cursor-pointer">
              {x.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ reuniao
export function MeetingSchedulerModal(
  p: Omit<CommonProps, 'minimized' | 'onMinimize'> & {
    onSchedule: (t: TimelinePayload) => Promise<void>;
    agenda: AgendaItem[];
    hosts?: string[];
    defaultAttendees?: string[];
    defaultTitle?: string;
  }
) {
  const now = p.now || new Date();
  const [host, setHost] = useState(p.currentUserName || '');
  const [title, setTitle] = useState(p.defaultTitle || '');
  const [date, setDate] = useState(isoDate(now));
  const [start, setStart] = useState(() => {
    const h = Math.min(22, now.getHours() + 1);
    return `${String(h).padStart(2, '0')}:00`;
  });
  const [duration, setDuration] = useState(30);
  const [attendees, setAttendees] = useState<string[]>(p.defaultAttendees || []);
  const [attendeeInput, setAttendeeInput] = useState('');
  const [location, setLocation] = useState('');
  const [reminders, setReminders] = useState<number[]>([]);
  const [description, setDescription] = useState('');
  const [internalOpen, setInternalOpen] = useState(false);
  const [internal, setInternal] = useState('');
  const [weekStart, setWeekStart] = useState(() => startOfWeek(now));
  const [hideWeekends, setHideWeekends] = useState(true);
  const [saving, setSaving] = useState(false);
  const { assoc, setAssoc, openPanel } = useAssoc(p.initialAssoc, p.onOpenAssocPanel);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[data-assoc-panel-open="1"]')) p.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p]);

  const days = weekDays(weekStart, hideWeekends);
  const HOUR_FROM = 7;
  const HOUR_TO = 20;
  const ROW = 40; // px por hora
  const toY = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return ((h - HOUR_FROM) * 60 + m) * (ROW / 60);
  };
  const end = addMinutesToTime(start, duration);
  const items: AgendaItem[] = [...p.agenda, { id: 'draft', title: title || 'Nova reunião', date, start, end, kind: 'DRAFT' }];

  const submit = async () => {
    setSaving(true);
    try {
      await p.onSchedule(
        buildMeetingPayload({ title, hostName: host, date, startTime: start, durationMin: duration, attendees, location, reminders, description, internalNote: internal }, assoc)
      );
      p.onClose();
    } finally {
      setSaving(false);
    }
  };
  const L = ({ children }: { children: React.ReactNode }) => <span className="block text-xs font-semibold text-slate-700 mb-1">{children}</span>;
  const hosts = Array.from(new Set([p.currentUserName || '', ...(p.hosts || [])].filter(Boolean)));

  return (
    <div className="fixed inset-0 z-[66] bg-slate-900/40 flex items-center justify-center p-4" data-testid="meeting-scheduler" onClick={p.onClose}>
      <div role="dialog" aria-label="Programação" className="bg-white rounded-lg shadow-2xl w-full max-w-[1180px] h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="px-5 py-3 bg-[#0b6b7a] text-white flex items-center justify-between">
          <h2 className="text-base font-semibold">Programação</h2>
          <button type="button" onClick={p.onClose} aria-label="Fechar" className="p-1 rounded hover:bg-white/15 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </header>
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[420px_1fr]">
          <div className="overflow-y-auto px-5 py-4 space-y-4 border-r border-slate-200">
            <label className="block">
              <L>Host</L>
              <div className="flex gap-4 text-xs mb-2">
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked readOnly className="accent-[#0b6b7a]" /> Usuário
                </label>
                <label className="flex items-center gap-1.5 opacity-40" title="Em breve">
                  <input type="radio" disabled /> Roteamento de reunião
                </label>
              </div>
              <select value={host} onChange={(e) => setHost(e.target.value)} className={`${field} w-full`}>
                {hosts.map((h) => (
                  <option key={h}>{h}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <L>Título</L>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={`${field} w-full`} data-testid="meeting-title" />
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label>
                <L>Data de início</L>
                <input type="date" value={date} onChange={(e) => { setDate(e.target.value); const d = new Date(`${e.target.value}T12:00:00`); if (!Number.isNaN(d.getTime())) setWeekStart(startOfWeek(d)); }} className={`${field} w-full`} />
              </label>
              <label>
                <L>Hora de início</L>
                <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={`${field} w-full`} />
              </label>
              <label>
                <L>Fim do tempo</L>
                <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={`${field} w-full`}>
                  {MEETING_DURATIONS.map((m) => (
                    <option key={m} value={m}>
                      {m < 60 ? `${m} min` : `${m / 60} h`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              <L>Participantes</L>
              <div className="flex flex-wrap gap-1 mb-1">
                {attendees.map((a) => (
                  <span key={a} className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-xs flex items-center gap-1">
                    {a}
                    <button type="button" onClick={() => setAttendees((x) => x.filter((y) => y !== a))} aria-label={`Remover ${a}`} className="cursor-pointer">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <input
                value={attendeeInput}
                onChange={(e) => setAttendeeInput(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ',') && attendeeInput.trim()) {
                    e.preventDefault();
                    setAttendees((x) => Array.from(new Set([...x, attendeeInput.trim()])));
                    setAttendeeInput('');
                  }
                }}
                placeholder="E-mail ou nome e Enter"
                className={`${field} w-full`}
              />
            </label>
            <label className="block">
              <L>Localização</L>
              <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Endereço ou link da reunião" className={`${field} w-full`} />
            </label>
            <div>
              <L>E-mails de lembrete agendados</L>
              {reminders.map((r, i) => (
                <div key={i} className="flex items-center gap-2 mb-1">
                  <select
                    value={r}
                    onChange={(e) => setReminders((x) => x.map((y, j) => (j === i ? Number(e.target.value) : y)))}
                    className={`${field} flex-1`}
                  >
                    {[15, 30, 60, 1440].map((m) => (
                      <option key={m} value={m}>
                        {m < 60 ? `${m} minutos antes` : m === 60 ? '1 hora antes' : '1 dia antes'}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={() => setReminders((x) => x.filter((_, j) => j !== i))} aria-label="Remover lembrete" className="p-1 cursor-pointer">
                    <Minus className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => setReminders((x) => [...x, 60])} className="text-xs font-semibold text-[#0b6b7a] hover:underline cursor-pointer">
                + Adicionar lembrete
              </button>
              <p className="text-[11px] text-slate-500 mt-1">Os lembretes ficam gravados na reunião; nenhum convite externo é enviado daqui.</p>
            </div>
            <div>
              <L>Descrição do participante</L>
              <RichTextArea placeholder="O que os participantes devem saber..." onChange={setDescription} minHeight={80} />
            </div>
            <div className="flex items-center gap-4">
              <AssociatedToDropdown candidates={p.candidates} value={assoc} onChange={setAssoc} onOpenPanel={openPanel} />
              <button type="button" onClick={() => setInternalOpen((v) => !v)} className="text-xs font-semibold text-[#0b6b7a] hover:underline cursor-pointer">
                + Adicionar observação interna
              </button>
            </div>
            {internalOpen ? <textarea value={internal} onChange={(e) => setInternal(e.target.value)} rows={3} className={`${field} w-full`} placeholder="Só a equipe vê" /> : null}
          </div>
          <div className="flex flex-col min-h-0">
            <div className="px-4 py-2 border-b border-slate-200 flex items-center gap-2 text-sm flex-wrap">
              <button type="button" onClick={() => setWeekStart(startOfWeek(now))} className="px-2.5 py-1 rounded border border-slate-300 text-xs font-semibold cursor-pointer">
                Hoje
              </button>
              <button type="button" onClick={() => setWeekStart((w) => new Date(w.getFullYear(), w.getMonth(), w.getDate() - 7))} aria-label="Semana anterior" className="p-1 cursor-pointer">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => setWeekStart((w) => new Date(w.getFullYear(), w.getMonth(), w.getDate() + 7))} aria-label="Próxima semana" className="p-1 cursor-pointer">
                <ChevronRight className="w-4 h-4" />
              </button>
              <span className="font-semibold text-slate-800" data-testid="meeting-week-label">{weekRangeLabel(weekStart, hideWeekends)}</span>
              <label className="ml-auto flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={hideWeekends} onChange={(e) => setHideWeekends(e.target.checked)} className="accent-[#0b6b7a]" />
                Ocultar fins de semana
              </label>
              <span className="text-xs text-slate-500 flex items-center gap-1">
                <CalendarDays className="w-3.5 h-3.5" /> America/Sao_Paulo
              </span>
            </div>
            <div className="flex-1 min-h-0 overflow-auto">
              <div className="grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(110px, 1fr))` }}>
                <div />
                {days.map((d) => (
                  <div key={d.toISOString()} className={`px-2 py-1.5 text-xs font-semibold border-b border-slate-200 ${isoDate(d) === isoDate(now) ? 'text-[#0b6b7a]' : 'text-slate-600'}`}>
                    {dayHeader(d)}
                  </div>
                ))}
                <div className="relative" style={{ height: (HOUR_TO - HOUR_FROM) * ROW }}>
                  {Array.from({ length: HOUR_TO - HOUR_FROM }, (_, i) => (
                    <div key={i} className="absolute right-1 text-[10px] text-slate-400" style={{ top: i * ROW - 6 }}>
                      {String(HOUR_FROM + i).padStart(2, '0')}:00
                    </div>
                  ))}
                </div>
                {days.map((d) => {
                  const ds = isoDate(d);
                  return (
                    <div
                      key={ds}
                      className="relative border-l border-slate-100"
                      style={{ height: (HOUR_TO - HOUR_FROM) * ROW, backgroundImage: `repeating-linear-gradient(to bottom, #eef2f6 0 1px, transparent 1px ${ROW}px)` }}
                      onDoubleClick={(e) => {
                        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                        const mins = Math.max(0, Math.floor(((e.clientY - rect.top) / ROW) * 2) * 30);
                        setDate(ds);
                        setStart(addMinutesToTime(`${String(HOUR_FROM).padStart(2, '0')}:00`, mins));
                      }}
                      title="Clique duas vezes para escolher o horário"
                    >
                      {items
                        .filter((it) => it.date === ds)
                        .map((it) => {
                          const top = Math.max(0, toY(it.start));
                          const h = Math.max(18, toY(it.end) - toY(it.start));
                          const cls = it.kind === 'DRAFT' ? 'bg-[#ff5c35] text-white' : it.kind === 'TASK' ? 'bg-amber-100 text-amber-900 border border-amber-200' : 'bg-sky-100 text-sky-900 border border-sky-200';
                          return (
                            <div key={`${it.kind}-${it.id}`} className={`absolute left-1 right-1 rounded px-1.5 py-0.5 text-[10px] font-semibold overflow-hidden ${cls}`} style={{ top, height: h }} data-testid={it.kind === 'DRAFT' ? 'meeting-draft-slot' : undefined}>
                              {it.start} {it.title}
                            </div>
                          );
                        })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        <footer className="px-5 py-3 border-t border-slate-200 flex items-center gap-2">
          <button type="button" className={btnPrimary} disabled={saving} onClick={() => void submit()} data-testid="meeting-schedule">
            {saving ? 'Agendando…' : 'Agendar reunião'}
          </button>
          <button type="button" onClick={p.onClose} className="px-4 py-2 rounded-md border border-[#ff5c35] text-[#ff5c35] text-sm font-semibold cursor-pointer">
            Cancelar
          </button>
        </footer>
      </div>
    </div>
  );
}
