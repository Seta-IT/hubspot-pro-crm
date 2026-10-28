'use client';

import React, { useState, useEffect } from 'react';
import {
  CheckSquare,
  Play,
  Plus,
  CalendarClock,
  Phone,
  Mail,
  ListTodo,
  Trash2,
  ArrowUpRight,
  SkipForward,
  CheckCircle2,
  X,
} from 'lucide-react';
import {
  Company,
  Contact,
  CrmTask,
  CrmTaskPriority,
  CrmTaskType,
  Deal,
} from '../../db/types';
import {
  SETA_OWNER_OPTIONS,
  formatDateTimeBR,
} from './ui-helpers';
import { HUBSPOT_TASK_QUEUES } from './HubSpotEmailAndTasksPanel';
import { recordDeletedTask, recordUpsertedTask } from '../lib/durable-storage';

export interface EnrichedCrmTask extends CrmTask {
  contact?: Contact | null;
  company?: Company | null;
  deal?: Deal | null;
}

interface HubSpotTasksQueueViewProps {
  contacts: Contact[];
  companies: Company[];
  onOpenContactDrawer: (contactId: string) => void;
  onOpenCompanyDrawer: (companyId: string) => void;
}

export default function HubSpotTasksQueueView({
  contacts,
  companies,
  onOpenContactDrawer,
  onOpenCompanyDrawer,
}: HubSpotTasksQueueViewProps) {
  const [tasks, setTasks] = useState<EnrichedCrmTask[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [queueFilter, setQueueFilter] = useState<string>('ALL');
  const [dueFilter, setDueFilter] = useState<'ALL' | 'OVERDUE' | 'TODAY' | 'UPCOMING' | 'COMPLETED'>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');
  const [ownerFilter, setOwnerFilter] = useState<string>('ALL');

  // Queue Player (HubSpot Play Queue Mode)
  const [playingQueue, setPlayingQueue] = useState<boolean>(false);
  const [currentQueueIndex, setCurrentQueueIndex] = useState<number>(0);

  // Create Modal
  const [showNewTaskModal, setShowNewTaskModal] = useState(false);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [type, setType] = useState<CrmTaskType>('CALL');
  const [priority, setPriority] = useState<CrmTaskPriority>('HIGH');
  const [queueName, setQueueName] = useState<string>('Follow-up Comercial');
  const [dueDate, setDueDate] = useState<string>(() =>
    new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  );
  const [dueTime, setDueTime] = useState<string>('09:30');
  const [reminderMinutesBefore, setReminderMinutesBefore] = useState<number>(15);
  const [assignedTo, setAssignedTo] = useState<string>('Marcelo Lopes Mira');
  const [contactId, setContactId] = useState<string>('');
  const [companyId, setCompanyId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tasks', { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        setTasks(j.data || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const todayYmd = new Date().toISOString().slice(0, 10);

  const filteredTasks = tasks.filter((t) => {
    if (queueFilter !== 'ALL' && t.queueName !== queueFilter) return false;
    if (typeFilter !== 'ALL' && t.type !== typeFilter) return false;
    if (priorityFilter !== 'ALL' && t.priority !== priorityFilter) return false;
    if (ownerFilter !== 'ALL' && !t.assignedTo.toLowerCase().includes(ownerFilter.toLowerCase())) {
      return false;
    }

    if (dueFilter === 'COMPLETED') {
      return t.status === 'COMPLETED';
    }
    if (dueFilter === 'OVERDUE') {
      return t.status !== 'COMPLETED' && t.dueDate < todayYmd;
    }
    if (dueFilter === 'TODAY') {
      return t.status !== 'COMPLETED' && t.dueDate === todayYmd;
    }
    if (dueFilter === 'UPCOMING') {
      return t.status !== 'COMPLETED' && t.dueDate > todayYmd;
    }
    return true;
  });

  const playableTasks = filteredTasks.filter((t) => t.status !== 'COMPLETED');
  const activeQueueTask = playingQueue ? playableTasks[currentQueueIndex] || null : null;

  const handleToggleComplete = async (task: EnrichedCrmTask) => {
    const isCompleted = task.status === 'COMPLETED';
    const url = isCompleted ? `/api/tasks/${task.id}` : `/api/tasks/${task.id}/complete`;
    const res = await fetch(url, {
      method: isCompleted ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: isCompleted ? JSON.stringify({ status: 'NOT_STARTED' }) : JSON.stringify({}),
    });
    if (res.ok) {
      const j = await res.json();
      if (j.data) {
        recordUpsertedTask(j.data);
        setTasks((prev) =>
          prev.map((t) => (t.id === task.id ? { ...t, ...j.data } : t))
        );
      }
    }
  };

  const handlePostpone = async (task: EnrichedCrmTask, addDays: number) => {
    const baseMs = task.dueDate ? new Date(`${task.dueDate}T12:00:00`).getTime() : Date.now();
    const nextDate = new Date(Math.max(Date.now(), baseMs) + addDays * 86400000)
      .toISOString()
      .slice(0, 10);
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dueDate: nextDate }),
    });
    if (res.ok) {
      const j = await res.json();
      if (j.data) {
        recordUpsertedTask(j.data);
        setTasks((prev) =>
          prev.map((t) => (t.id === task.id ? { ...t, ...j.data } : t))
        );
      }
    }
  };

  const handleDelete = async (taskId: string) => {
    recordDeletedTask(taskId);
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          notes: notes.trim(),
          type,
          priority,
          status: 'NOT_STARTED',
          queueName,
          dueDate,
          dueTime,
          reminderMinutesBefore,
          assignedTo,
          contactId: contactId || null,
          companyId: companyId || null,
        }),
      });
      if (res.ok) {
        const j = await res.json();
        if (j.data) {
          recordUpsertedTask(j.data);
          setTasks((prev) => [j.data, ...prev]);
        }
        setTitle('');
        setNotes('');
        setShowNewTaskModal(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const openCount = tasks.filter((t) => t.status !== 'COMPLETED').length;
  const overdueCount = tasks.filter((t) => t.status !== 'COMPLETED' && t.dueDate < todayYmd).length;
  const todayCount = tasks.filter((t) => t.status !== 'COMPLETED' && t.dueDate === todayYmd).length;
  const completedCount = tasks.filter((t) => t.status === 'COMPLETED').length;

  return (
    <div className="space-y-4">
      {/* KPI & QUEUE PLAYER BAR */}
      <div className="bg-white rounded-[6px] border border-[#cbd6e2] p-4 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {[
            { id: 'ALL', label: `Todas (${tasks.length})`, tone: 'slate' },
            { id: 'OVERDUE', label: `Atrasadas (${overdueCount})`, tone: 'rose' },
            { id: 'TODAY', label: `Vencem Hoje (${todayCount})`, tone: 'amber' },
            { id: 'UPCOMING', label: `Próximos Dias (${Math.max(0, openCount - overdueCount - todayCount)})`, tone: 'indigo' },
            { id: 'COMPLETED', label: `Concluídas (${completedCount})`, tone: 'emerald' },
          ].map((b) => {
            const active = dueFilter === b.id;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => setDueFilter(b.id as typeof dueFilter)}
                className={`px-3 py-1.5 rounded-[4px] text-xs font-bold border transition cursor-pointer ${
                  active
                    ? 'bg-[#213343] text-white border-[#213343]'
                    : 'bg-[#f5f8fa] text-[#33475b] border-[#cbd6e2] hover:bg-white'
                }`}
              >
                {b.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={playableTasks.length === 0}
            onClick={() => {
              setCurrentQueueIndex(0);
              setPlayingQueue((v) => !v);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-[4px] bg-[#0091ae] hover:bg-[#007a94] text-white text-xs font-extrabold shadow-2xs transition cursor-pointer disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            {playingQueue
              ? 'Encerrar Fila HubSpot'
              : `Iniciar Fila (${playableTasks.length} Tarefas)`}
          </button>

          <button
            type="button"
            onClick={() => setShowNewTaskModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-[4px] bg-[#ff7a59] hover:bg-[#ff8f73] text-white text-xs font-extrabold shadow-2xs transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Criar Tarefa
          </button>
        </div>
      </div>

      {/* HUBSPOT QUEUE PLAYER ACTIVE BANNER */}
      {playingQueue && activeQueueTask && (
        <div className="bg-gradient-to-r from-[#213343] via-[#1e293b] to-[#0f172a] text-white rounded-xl p-5 border-2 border-[#0091ae] shadow-lg space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 pb-3">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-[#0091ae] text-white text-[10px] font-extrabold uppercase">
                HubSpot Queue Player Ativo • Tarefa {currentQueueIndex + 1} de {playableTasks.length}
              </span>
              <span className="text-xs font-bold text-slate-300">
                Fila: {activeQueueTask.queueName} • Vencimento: {activeQueueTask.dueDate} às {activeQueueTask.dueTime}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setPlayingQueue(false)}
              className="text-xs text-slate-300 hover:text-white cursor-pointer"
            >
              Fechar Player
            </button>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-base font-extrabold text-white">{activeQueueTask.title}</h3>
              {activeQueueTask.notes && (
                <p className="text-xs text-slate-300">{activeQueueTask.notes}</p>
              )}
              <div className="flex flex-wrap items-center gap-3 text-xs text-emerald-300 pt-1">
                {activeQueueTask.contact && (
                  <span>
                    Contato: <strong>{activeQueueTask.contact.firstName} {activeQueueTask.contact.lastName}</strong> ({activeQueueTask.contact.email})
                  </span>
                )}
                {activeQueueTask.company && (
                  <span>
                    Empresa: <strong>{activeQueueTask.company.name}</strong>
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {activeQueueTask.contactId && (
                <button
                  type="button"
                  onClick={() => onOpenContactDrawer(activeQueueTask.contactId!)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white text-slate-900 text-xs font-extrabold hover:bg-slate-100 cursor-pointer"
                >
                  Abrir Ficha 360° &amp; Enviar E-mail
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  await handleToggleComplete(activeQueueTask);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-extrabold cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                Concluir &amp; Próxima
              </button>
              <button
                type="button"
                onClick={() =>
                  setCurrentQueueIndex((idx) => (idx + 1) % Math.max(1, playableTasks.length))
                }
                className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold cursor-pointer"
              >
                <SkipForward className="w-3.5 h-3.5" />
                Pular
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FILTER BAR */}
      <div className="bg-[#f5f8fa] rounded-[6px] border border-[#cbd6e2] p-3 grid grid-cols-1 sm:grid-cols-4 gap-2.5 text-xs">
        <select
          value={queueFilter}
          onChange={(e) => setQueueFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded border border-[#cbd6e2] bg-white font-semibold text-[#33475b]"
        >
          <option value="ALL">Fila HubSpot: Todas as Filas</option>
          {HUBSPOT_TASK_QUEUES.map((q) => (
            <option key={q} value={q}>
              Fila: {q}
            </option>
          ))}
        </select>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded border border-[#cbd6e2] bg-white font-semibold text-[#33475b]"
        >
          <option value="ALL">Tipo: Todos (Ligação, E-mail, A fazer)</option>
          <option value="CALL">Ligação (Call)</option>
          <option value="EMAIL">E-mail</option>
          <option value="TODO">A fazer (To-do)</option>
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded border border-[#cbd6e2] bg-white font-semibold text-[#33475b]"
        >
          <option value="ALL">Prioridade: Todas</option>
          <option value="HIGH">Alta Prioridade</option>
          <option value="MEDIUM">Média Prioridade</option>
          <option value="LOW">Baixa Prioridade</option>
        </select>

        <select
          value={ownerFilter}
          onChange={(e) => setOwnerFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded border border-[#cbd6e2] bg-white font-semibold text-[#33475b]"
        >
          <option value="ALL">Proprietário: Todos</option>
          <option value="Marcelo">Marcelo Lopes Mira</option>
          <option value="Evelyn">Evelyn Ternero Seta Telecom</option>
        </select>
      </div>

      {/* TASKS TABLE */}
      <div className="bg-white rounded-[6px] border border-[#cbd6e2] shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#cbd6e2] bg-[#f5f8fa] text-[11px] font-bold uppercase tracking-wider text-[#516f90]">
                <th className="py-3 px-4">Status &amp; Tarefa de Follow-up</th>
                <th className="py-3 px-4">Tipo &amp; Fila HubSpot</th>
                <th className="py-3 px-4">Contato / Empresa Associada</th>
                <th className="py-3 px-4">Prioridade &amp; Prazo</th>
                <th className="py-3 px-4">Proprietário</th>
                <th className="py-3 px-4 text-right">Ações Rápidas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    Carregando fila de tarefas...
                  </td>
                </tr>
              ) : filteredTasks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    Nenhuma tarefa encontrada para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filteredTasks.map((task) => {
                  const isDone = task.status === 'COMPLETED';
                  const isOverdue = !isDone && task.dueDate < todayYmd;
                  const isToday = !isDone && task.dueDate === todayYmd;

                  return (
                    <tr
                      key={task.id}
                      className={`hover:bg-[#eaf0f6]/50 transition ${
                        isDone ? 'bg-slate-50/70 opacity-75' : ''
                      }`}
                    >
                      <td className="py-3.5 px-4 max-w-md">
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={isDone}
                            onChange={() => handleToggleComplete(task)}
                            className="mt-0.5 w-4 h-4 rounded border-slate-300 text-emerald-600 cursor-pointer"
                          />
                          <div>
                            <div
                              className={`font-bold text-[#33475b] ${
                                isDone ? 'line-through text-slate-400' : ''
                              }`}
                            >
                              {task.title}
                            </div>
                            {task.notes && (
                              <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">
                                {task.notes}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="flex flex-col items-start gap-1">
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 font-bold text-[10px]">
                            {task.type === 'CALL'
                              ? 'Ligação'
                              : task.type === 'EMAIL'
                                ? 'E-mail'
                                : 'A fazer'}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-[#eaf0f6] text-[#0091ae] font-bold text-[10px]">
                            {task.queueName}
                          </span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="space-y-0.5">
                          {task.contact ? (
                            <button
                              type="button"
                              onClick={() => onOpenContactDrawer(task.contact!.id)}
                              className="font-bold text-[#0091ae] hover:underline block text-left cursor-pointer"
                            >
                              {task.contact.firstName} {task.contact.lastName}
                            </button>
                          ) : null}
                          {task.company ? (
                            <button
                              type="button"
                              onClick={() => onOpenCompanyDrawer(task.company!.id)}
                              className="text-[11px] font-semibold text-slate-700 hover:underline block text-left cursor-pointer"
                            >
                              {task.company.name}
                            </button>
                          ) : null}
                          {!task.contact && !task.company && (
                            <span className="text-slate-400 italic">Sem vínculo</span>
                          )}
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="flex flex-col items-start gap-1">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              task.priority === 'HIGH'
                                ? 'bg-rose-100 text-rose-800'
                                : task.priority === 'MEDIUM'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {task.priority === 'HIGH'
                              ? 'Alta'
                              : task.priority === 'MEDIUM'
                                ? 'Média'
                                : 'Baixa'}
                          </span>
                          <span
                            className={`text-[11px] font-bold ${
                              isOverdue
                                ? 'text-rose-600'
                                : isToday
                                  ? 'text-amber-700'
                                  : 'text-slate-600'
                            }`}
                          >
                            {isOverdue ? 'Atrasada: ' : isToday ? 'Hoje: ' : ''}
                            {task.dueDate} às {task.dueTime}
                          </span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 font-semibold text-slate-700">
                        {task.assignedTo}
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {task.contactId && (
                            <button
                              type="button"
                              onClick={() => onOpenContactDrawer(task.contactId!)}
                              className="px-2.5 py-1 rounded bg-[#0091ae] hover:bg-[#007a94] text-white font-bold text-[11px] cursor-pointer"
                            >
                              Abrir Ficha / E-mail
                            </button>
                          )}
                          {!isDone && (
                            <button
                              type="button"
                              onClick={() => handlePostpone(task, 1)}
                              className="px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 font-bold text-[11px] text-slate-700 cursor-pointer"
                            >
                              +1d
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDelete(task.id)}
                            className="p-1.5 rounded text-slate-400 hover:text-rose-600 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE TASK MODAL */}
      {showNewTaskModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="px-6 py-4 bg-[#1e293b] text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckSquare className="w-5 h-5 text-[#ff7a59]" />
                <h3 className="text-base font-bold">Nova Tarefa de Follow-up (Padrão HubSpot)</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowNewTaskModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateTask} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-bold uppercase text-slate-600 mb-1">
                  Título da Tarefa *
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex: Follow-up proposta comercial com decisor"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold uppercase text-slate-600 mb-1">Tipo</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as CrmTaskType)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-semibold"
                  >
                    <option value="CALL">Ligação</option>
                    <option value="EMAIL">E-mail</option>
                    <option value="TODO">A fazer</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold uppercase text-slate-600 mb-1">
                    Prioridade
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as CrmTaskPriority)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-semibold"
                  >
                    <option value="HIGH">Alta</option>
                    <option value="MEDIUM">Média</option>
                    <option value="LOW">Baixa</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold uppercase text-slate-600 mb-1">
                    Fila HubSpot
                  </label>
                  <select
                    value={queueName}
                    onChange={(e) => setQueueName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-semibold"
                  >
                    {HUBSPOT_TASK_QUEUES.map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold uppercase text-slate-600 mb-1">
                    Data Vencimento
                  </label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white"
                  />
                </div>
                <div>
                  <label className="block font-bold uppercase text-slate-600 mb-1">Horário</label>
                  <input
                    type="time"
                    value={dueTime}
                    onChange={(e) => setDueTime(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white"
                  />
                </div>
                <div>
                  <label className="block font-bold uppercase text-slate-600 mb-1">Lembrete</label>
                  <select
                    value={reminderMinutesBefore}
                    onChange={(e) => setReminderMinutesBefore(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white"
                  >
                    <option value={15}>15 min antes</option>
                    <option value={30}>30 min antes</option>
                    <option value={60}>1 hora antes</option>
                    <option value={1440}>1 dia antes</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold uppercase text-slate-600 mb-1">
                    Contato Vinculado
                  </label>
                  <select
                    value={contactId}
                    onChange={(e) => {
                      setContactId(e.target.value);
                      const found = contacts.find((c) => c.id === e.target.value);
                      if (found?.companyId) setCompanyId(found.companyId);
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white"
                  >
                    <option value="">Opcional: selecionar contato...</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.firstName} {c.lastName} ({c.email})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold uppercase text-slate-600 mb-1">
                    Empresa Vinculada
                  </label>
                  <select
                    value={companyId}
                    onChange={(e) => setCompanyId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white"
                  >
                    <option value="">Opcional: selecionar empresa...</option>
                    {companies.map((comp) => (
                      <option key={comp.id} value={comp.id}>
                        {comp.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold uppercase text-slate-600 mb-1">
                  Responsável (Proprietário)
                </label>
                <select
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-semibold"
                >
                  {SETA_OWNER_OPTIONS.filter((o) => !o.includes('Inativo')).map((ow) => (
                    <option key={ow} value={ow}>
                      {ow}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold uppercase text-slate-600 mb-1">
                  Notas / Contexto
                </label>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Observações detalhadas para o follow-up..."
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewTaskModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 font-semibold text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white font-bold shadow-sm transition cursor-pointer"
                >
                  {saving ? 'Criando...' : 'Criar Tarefa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
