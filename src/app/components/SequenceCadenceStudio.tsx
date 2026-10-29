'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Copy,
  GitBranch,
  History,
  Plus,
  Save,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import type {
  CanonicalSequenceEnrollmentState,
  EmailSequence,
  SendingWindowConfig,
  SequenceEnrollment,
  SequenceExitRuleConfig,
  SequenceExitRuleTrigger,
  SequenceStep,
  SequenceStepType,
} from '../../db/types';
import { formatDateTimeBR } from './ui-helpers';

// ============================================================================
// Fase 2 (Modulo C) — Estudio de Cadencias Comerciais Avancadas
// Editor de passos, janela comercial / fuso / limite por caixa postal,
// 10 estados rastreaveis, 13 regras de saida (configuracao + simulador),
// versionamento e clonagem. Consome /api/sequences (acoes reais do backend).
// ============================================================================

export const TEN_CADENCE_STATES: Array<{
  state: CanonicalSequenceEnrollmentState;
  labelPt: string;
  tone: string;
}> = [
  { state: 'IN_SEQUENCE', labelPt: 'Em cadência', tone: 'bg-blue-50 text-blue-800 border-blue-200' },
  { state: 'WAITING_NEXT_STEP', labelPt: 'Aguardando próximo passo', tone: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
  { state: 'PAUSED', labelPt: 'Pausado', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  { state: 'COMPLETED', labelPt: 'Concluído', tone: 'bg-slate-100 text-slate-700 border-slate-200' },
  { state: 'REPLIED', labelPt: 'Respondeu', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  { state: 'MEETING_SCHEDULED', labelPt: 'Reunião agendada', tone: 'bg-teal-50 text-teal-800 border-teal-200' },
  { state: 'REMOVED_MANUALLY', labelPt: 'Removido manualmente', tone: 'bg-orange-50 text-orange-800 border-orange-200' },
  { state: 'REMOVED_AUTOMATICALLY', labelPt: 'Removido automaticamente', tone: 'bg-purple-50 text-purple-800 border-purple-200' },
  { state: 'UNSUBSCRIBED_FROM_COMMUNICATIONS', labelPt: 'Descadastrado de comunicações', tone: 'bg-rose-50 text-rose-800 border-rose-200' },
  { state: 'BLOCKED_BY_DELIVERABILITY', labelPt: 'Bloqueado por entregabilidade', tone: 'bg-red-50 text-red-800 border-red-200' },
];

/** Espelho cliente de resolveCanonicalEnrollmentState (sequence-service.ts). */
export function canonicalStateOf(
  e: Pick<SequenceEnrollment, 'status' | 'canonicalEnrollmentState'>
): CanonicalSequenceEnrollmentState {
  if (e.canonicalEnrollmentState) return e.canonicalEnrollmentState;
  switch (e.status) {
    case 'WAITING_NEXT_STEP':
      return 'WAITING_NEXT_STEP';
    case 'PAUSED':
    case 'PAUSED_MANUAL':
      return 'PAUSED';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'PAUSED_ON_REPLY':
    case 'REPLIED':
      return 'REPLIED';
    case 'MEETING_BOOKED':
    case 'MEETING_SCHEDULED':
      return 'MEETING_SCHEDULED';
    case 'MANUAL_STOP':
    case 'REMOVED_MANUAL':
    case 'REMOVED_MANUALLY':
      return 'REMOVED_MANUALLY';
    case 'REMOVED_AUTOMATIC':
    case 'REMOVED_AUTOMATICALLY':
      return 'REMOVED_AUTOMATICALLY';
    case 'UNSUBSCRIBED':
    case 'UNSUBSCRIBED_GLOBAL':
    case 'UNSUBSCRIBED_FROM_COMMUNICATIONS':
      return 'UNSUBSCRIBED_FROM_COMMUNICATIONS';
    case 'BOUNCED':
    case 'BLOCKED_DELIVERABILITY':
    case 'BLOCKED_BY_DELIVERABILITY':
      return 'BLOCKED_BY_DELIVERABILITY';
    default:
      return 'IN_SEQUENCE';
  }
}

const STEP_TYPE_OPTIONS: Array<{ value: SequenceStepType; label: string }> = [
  { value: 'AUTO_EMAIL', label: 'E-mail automático' },
  { value: 'MANUAL_EMAIL', label: 'E-mail manual (aprovação)' },
  { value: 'SALES_TASK', label: 'Tarefa do vendedor' },
  { value: 'PHONE_CALL', label: 'Ligação' },
  { value: 'REMINDER', label: 'Lembrete' },
  { value: 'CALENDAR_MEETING', label: 'Convite de reunião' },
  { value: 'BRANCH_CONDITION', label: 'Ramificação condicional' },
  { value: 'TRANSFER_TO_NURTURE', label: 'Transferir para nutrição' },
];

const CONDITION_OPTIONS: Array<{ value: NonNullable<SequenceStep['condition']>; label: string }> = [
  { value: 'ALWAYS', label: 'Sempre' },
  { value: 'IF_NO_REPLY', label: 'Se não respondeu' },
  { value: 'IF_OPENED', label: 'Se abriu' },
  { value: 'IF_HIGH_ENGAGEMENT', label: 'Se alto engajamento' },
];

const DEFAULT_WINDOW: SendingWindowConfig = {
  businessHoursStart: '08:30',
  businessHoursEnd: '18:00',
  businessDaysOnly: true,
  skipHolidays: true,
  holidayDates: [],
  respectRecipientTimezone: true,
  defaultTimezone: 'America/Sao_Paulo',
  dailyMailboxSendLimit: 150,
  currentTodaySent: 0,
  senderMailbox: 'marcello@setatelecom.com.br',
  sendingProvider: 'OUTLOOK_M365',
};

const TIMEZONE_OPTIONS = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Fortaleza',
  'America/Recife',
  'America/Cuiaba',
  'America/Rio_Branco',
  'America/Noronha',
  'America/New_York',
  'Europe/Lisbon',
  'UTC',
];

async function postSequenceAction(body: Record<string, unknown>): Promise<{
  ok: boolean;
  data?: unknown;
  error?: string;
}> {
  try {
    const res = await fetch('/api/sequences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json?.error || `Falha HTTP ${res.status}` };
    return { ok: true, data: json?.data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Falha de rede.' };
  }
}

function resetStepCounters(steps: SequenceStep[]): SequenceStep[] {
  const stamp = Date.now();
  return steps.map((s, i) => ({
    ...s,
    id: `step-${stamp}-${i + 1}`,
    stepOrder: i + 1,
    sentCount: 0,
    openCount: 0,
    clickCount: 0,
    replyCount: 0,
  }));
}

interface SequenceCadenceStudioProps {
  sequence: EmailSequence;
  allSequences: EmailSequence[];
  enrollments: Array<SequenceEnrollment & { contact?: { firstName: string; lastName: string; email: string } | null }>;
  selectedStateFilter: CanonicalSequenceEnrollmentState | 'ALL';
  onSelectStateFilter: (s: CanonicalSequenceEnrollmentState | 'ALL') => void;
  onChanged?: () => Promise<void> | void;
  onSelectSequence?: (sequenceId: string) => void;
  onFeedback?: (msg: string) => void;
}

export default function SequenceCadenceStudio({
  sequence,
  allSequences,
  enrollments,
  selectedStateFilter,
  onSelectStateFilter,
  onChanged,
  onSelectSequence,
  onFeedback,
}: SequenceCadenceStudioProps) {
  const [panel, setPanel] = useState<'STEPS' | 'WINDOW' | 'EXIT_RULES' | 'VERSIONS'>('STEPS');
  const [draftSteps, setDraftSteps] = useState<SequenceStep[]>(sequence.steps || []);
  const [draftWindow, setDraftWindow] = useState<SendingWindowConfig>({
    ...DEFAULT_WINDOW,
    ...(sequence.sendingWindow || {}),
  });
  const [holidaysText, setHolidaysText] = useState((sequence.sendingWindow?.holidayDates || []).join(', '));
  const [draftRules, setDraftRules] = useState<SequenceExitRuleConfig[]>(sequence.exitRules || []);
  const [draftExitScope, setDraftExitScope] = useState<'CONTACT_ONLY' | 'ENTIRE_COMPANY'>(
    sequence.exitScope || 'CONTACT_ONLY'
  );
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Simulador de janela
  const [simBaseDate, setSimBaseDate] = useState('');
  const [simDelayDays, setSimDelayDays] = useState('2');
  const [simDelayHours, setSimDelayHours] = useState('0');
  const [simTimezone, setSimTimezone] = useState('America/Sao_Paulo');
  const [simWindowResult, setSimWindowResult] = useState<{
    scheduledAtIso: string;
    scheduledLocalDisplay?: string;
    adjustedForBusinessHours: boolean;
    skippedWeekendDays: number;
    skippedHolidayDates: string[];
    timezoneUsed: string;
  } | null>(null);

  // Simulador de regras de saida
  const [simEnrollmentId, setSimEnrollmentId] = useState('');
  const [simTrigger, setSimTrigger] = useState<SequenceExitRuleTrigger>('CONTACT_REPLIED');
  const [simDetail, setSimDetail] = useState('');
  const [simScope, setSimScope] = useState<'' | 'CONTACT_ONLY' | 'ENTIRE_COMPANY'>('');
  const [simRuleResult, setSimRuleResult] = useState<string | null>(null);

  // Clonagem
  const [cloneName, setCloneName] = useState('');

  useEffect(() => {
    setDraftSteps(sequence.steps || []);
    setDraftWindow({ ...DEFAULT_WINDOW, ...(sequence.sendingWindow || {}) });
    setHolidaysText((sequence.sendingWindow?.holidayDates || []).join(', '));
    setDraftRules(sequence.exitRules || []);
    setDraftExitScope(sequence.exitScope || 'CONTACT_ONLY');
    setSimRuleResult(null);
    setSimWindowResult(null);
    setErrorMsg(null);
  }, [sequence.id, sequence.version, sequence.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const seqEnrollments = useMemo(
    () => enrollments.filter((e) => e.sequenceId === sequence.id),
    [enrollments, sequence.id]
  );

  const stateCounts = useMemo(() => {
    const counts = {} as Record<CanonicalSequenceEnrollmentState, number>;
    TEN_CADENCE_STATES.forEach((s) => (counts[s.state] = 0));
    seqEnrollments.forEach((e) => {
      const st = canonicalStateOf(e);
      counts[st] = (counts[st] || 0) + 1;
    });
    return counts;
  }, [seqEnrollments]);

  const activeEnrollmentsForSim = seqEnrollments.filter((e) =>
    ['IN_SEQUENCE', 'WAITING_NEXT_STEP', 'PAUSED'].includes(canonicalStateOf(e))
  );

  const template21d = allSequences.find((s) => s.id === 'seq-seta-21d-prospeccao');

  const mailboxLimit = draftWindow.dailyMailboxSendLimit || 150;
  const sentToday = sequence.sendingWindow?.currentTodaySent || 0;
  const mailboxPct = Math.min(100, Math.round((sentToday / Math.max(1, mailboxLimit)) * 100));

  const saveUpdates = async (updates: Partial<EmailSequence>, successMsg: string) => {
    setSaving(true);
    setErrorMsg(null);
    const res = await postSequenceAction({ action: 'UPDATE_SEQUENCE', sequenceId: sequence.id, updates });
    setSaving(false);
    if (!res.ok) {
      setErrorMsg(res.error || 'Falha ao salvar.');
      return;
    }
    const updated = res.data as EmailSequence | undefined;
    onFeedback?.(`${successMsg} Nova versão: v${updated?.version ?? '?'}.`);
    await onChanged?.();
  };

  const updateStep = (idx: number, patch: Partial<SequenceStep>) => {
    setDraftSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    setDraftSteps((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next.map((s, i) => ({ ...s, stepOrder: i + 1 }));
    });
  };

  const removeStep = (idx: number) => {
    setDraftSteps((prev) => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, stepOrder: i + 1 })));
  };

  const addStep = () => {
    setDraftSteps((prev) => {
      const last = prev[prev.length - 1];
      const nextDay = (last?.dayOffset || 0) + 2;
      return [
        ...prev,
        {
          id: `step-${Date.now()}-${prev.length + 1}`,
          stepOrder: prev.length + 1,
          dayOffset: nextDay,
          delayDays: prev.length === 0 ? 0 : 2,
          delayHours: 0,
          waitForEvent: 'NONE',
          subject: 'Novo passo da cadência para {{companyName}}',
          bodyTemplate: 'Olá {{firstName}}, ...',
          stepType: 'AUTO_EMAIL',
          condition: prev.length === 0 ? 'ALWAYS' : 'IF_NO_REPLY',
          sentCount: 0,
          openCount: 0,
          clickCount: 0,
          replyCount: 0,
        },
      ];
    });
  };

  const handleSaveSteps = async () => {
    if (draftSteps.length === 0) {
      setErrorMsg('A cadência precisa de ao menos 1 passo.');
      return;
    }
    const normalized = draftSteps.map((s, i) => ({ ...s, stepOrder: i + 1 }));
    await saveUpdates({ steps: normalized }, 'Passos da cadência salvos.');
  };

  const handleSaveWindow = async () => {
    const holidayDates = holidaysText
      .split(/[\s,;]+/)
      .map((d) => d.trim())
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    await saveUpdates(
      {
        sendingWindow: {
          ...draftWindow,
          holidayDates,
          dailyMailboxSendLimit: Math.max(1, Number(draftWindow.dailyMailboxSendLimit) || 150),
          currentTodaySent: sequence.sendingWindow?.currentTodaySent || 0,
          currentTodayDate: sequence.sendingWindow?.currentTodayDate,
        },
      },
      'Janela comercial e limite por caixa postal salvos.'
    );
  };

  const handleSaveRules = async () => {
    await saveUpdates({ exitRules: draftRules, exitScope: draftExitScope }, 'Regras automáticas de saída salvas.');
  };

  const handleCalcWindow = async () => {
    setErrorMsg(null);
    const res = await postSequenceAction({
      action: 'CALCULATE_WINDOW',
      baseDate: simBaseDate ? new Date(simBaseDate).toISOString() : undefined,
      delayDays: Number(simDelayDays) || 0,
      delayHours: Number(simDelayHours) || 0,
      sendingWindow: {
        ...draftWindow,
        holidayDates: holidaysText
          .split(/[\s,;]+/)
          .map((d) => d.trim())
          .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
      },
      recipientTimezone: simTimezone,
    });
    if (!res.ok) {
      setErrorMsg(res.error || 'Falha ao calcular janela.');
      return;
    }
    setSimWindowResult(res.data as typeof simWindowResult);
  };

  const handleSimulateRule = async () => {
    if (!simEnrollmentId) {
      setErrorMsg('Selecione uma inscrição ativa para simular a regra de saída.');
      return;
    }
    setErrorMsg(null);
    const res = await postSequenceAction({
      action: 'TRIGGER_EXIT_RULE',
      enrollmentId: simEnrollmentId,
      trigger: simTrigger,
      reasonDetail: simDetail || undefined,
      replySnippet: simTrigger === 'CONTACT_REPLIED' ? simDetail || undefined : undefined,
      scopeOverride: simScope || undefined,
    });
    if (!res.ok) {
      setErrorMsg(res.error || 'Falha ao aplicar regra.');
      return;
    }
    const d = res.data as {
      canonicalState: CanonicalSequenceEnrollmentState;
      globalSubscriptionPreserved: boolean;
      companyColleaguesExited: unknown[];
      dealTransferredToNegotiation: boolean;
      updatedDealStageId: string | null;
    };
    const label = TEN_CADENCE_STATES.find((s) => s.state === d.canonicalState)?.labelPt || d.canonicalState;
    const msg = [
      `Regra ${simTrigger} aplicada. Novo estado: ${label}.`,
      d.globalSubscriptionPreserved
        ? 'Assinatura de comunicações preservada (saída somente da cadência).'
        : 'Contato bloqueado/descadastrado das comunicações (supressão aplicada).',
      d.companyColleaguesExited?.length
        ? `${d.companyColleaguesExited.length} colega(s) da mesma empresa também saíram (escopo empresa).`
        : '',
      d.dealTransferredToNegotiation ? `Negócio movido para negociação (${d.updatedDealStageId}).` : '',
    ]
      .filter(Boolean)
      .join(' ');
    setSimRuleResult(msg);
    setSimEnrollmentId('');
    onFeedback?.(msg);
    await onChanged?.();
  };

  const handleClone = async () => {
    setErrorMsg(null);
    const res = await postSequenceAction({
      action: 'CLONE_SEQUENCE',
      sequenceId: sequence.id,
      newName: cloneName.trim() || undefined,
    });
    if (!res.ok) {
      setErrorMsg(res.error || 'Falha ao clonar.');
      return;
    }
    const cloned = res.data as EmailSequence;
    setCloneName('');
    onFeedback?.(`Cadência clonada como "${cloned.name}" (v1, métricas zeradas).`);
    await onChanged?.();
    if (cloned?.id) onSelectSequence?.(cloned.id);
  };

  const ruleOptions = (sequence.exitRules && sequence.exitRules.length > 0 ? sequence.exitRules : draftRules) || [];

  return (
    <div className="border-t border-slate-200 bg-white">
      {/* 10 ESTADOS RASTREAVEIS */}
      <div className="px-6 pt-5 pb-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            10 estados rastreáveis da cadência ({seqEnrollments.length} inscrições)
          </h4>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="px-2 py-0.5 rounded bg-slate-900 text-white font-semibold">v{sequence.version || 1}</span>
            <span className="text-slate-500">Atualizada em {formatDateTimeBR(sequence.updatedAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5" data-testid="cadence-ten-states">
          <button
            type="button"
            onClick={() => onSelectStateFilter('ALL')}
            className={`px-2.5 py-1 rounded-full border text-[11px] font-semibold ${
              selectedStateFilter === 'ALL' ? 'bg-[#1e293b] text-white border-[#1e293b]' : 'bg-white text-slate-700 border-slate-200'
            }`}
          >
            Todos ({seqEnrollments.length})
          </button>
          {TEN_CADENCE_STATES.map((s) => (
            <button
              key={s.state}
              type="button"
              title={s.state}
              onClick={() => onSelectStateFilter(s.state)}
              className={`px-2.5 py-1 rounded-full border text-[11px] font-semibold transition ${
                selectedStateFilter === s.state ? 'ring-2 ring-[#ff7a59] ' : ''
              }${s.tone}`}
            >
              {s.labelPt} ({stateCounts[s.state] || 0})
            </button>
          ))}
        </div>
      </div>

      {/* TABS DO ESTUDIO */}
      <div className="px-6 flex flex-wrap items-center gap-1.5 border-b border-slate-200">
        {(
          [
            ['STEPS', 'Editor de passos'],
            ['WINDOW', 'Janela comercial & caixa postal'],
            ['EXIT_RULES', '13 regras de saída & simulador'],
            ['VERSIONS', 'Versões & clonagem'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setPanel(id)}
            className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition ${
              panel === id ? 'border-[#ff7a59] text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {errorMsg && (
        <div className="mx-6 mt-3 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          {errorMsg}
        </div>
      )}

      <div className="p-6 text-xs space-y-3">
        {/* EDITOR DE PASSOS */}
        {panel === 'STEPS' && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-slate-500">
                Edite tipo, dia, atraso, condição e conteúdo de cada passo. Variáveis: {'{{firstName}}'}, {'{{lastName}}'}, {'{{companyName}}'}. Salvar gera nova versão; inscrições existentes mantêm a versão em que entraram.
              </p>
              <div className="flex flex-wrap gap-2">
                {template21d && template21d.id !== sequence.id && (
                  <button
                    type="button"
                    onClick={() => setDraftSteps(resetStepCounters(structuredClone(template21d.steps)))}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <CalendarClock className="w-3.5 h-3.5" /> Aplicar modelo de 21 dias
                  </button>
                )}
                <button
                  type="button"
                  onClick={addStep}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Plus className="w-3.5 h-3.5" /> Adicionar passo
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveSteps}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white font-semibold disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" /> {saving ? 'Salvando...' : 'Salvar passos'}
                </button>
              </div>
            </div>

            {/* Linha do tempo de dias */}
            <div className="flex items-center gap-1 overflow-x-auto py-1" data-testid="cadence-timeline">
              {draftSteps.map((s, i) => (
                <div key={s.id} className="flex items-center gap-1 shrink-0">
                  <span className="px-2 py-1 rounded bg-slate-900 text-white text-[10px] font-semibold">
                    Dia {s.dayOffset}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {STEP_TYPE_OPTIONS.find((o) => o.value === s.stepType)?.label || s.stepType}
                  </span>
                  {i < draftSteps.length - 1 && <span className="text-slate-300 px-1">&rarr;</span>}
                </div>
              ))}
            </div>

            <div className="space-y-2">
              {draftSteps.map((s, idx) => (
                <div key={s.id} className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-[#1e293b] text-white text-[10px] font-semibold">
                      Passo {idx + 1}
                    </span>
                    <select
                      value={s.stepType}
                      onChange={(e) => updateStep(idx, { stepType: e.target.value as SequenceStepType })}
                      className="px-2 py-1 rounded border border-slate-300 bg-white"
                    >
                      {STEP_TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                      {!STEP_TYPE_OPTIONS.some((o) => o.value === s.stepType) && (
                        <option value={s.stepType}>{s.stepType}</option>
                      )}
                    </select>
                    <label className="inline-flex items-center gap-1">
                      Dia
                      <input
                        type="number"
                        min={1}
                        value={s.dayOffset}
                        onChange={(e) => updateStep(idx, { dayOffset: Math.max(1, Number(e.target.value) || 1) })}
                        className="w-14 px-1.5 py-1 rounded border border-slate-300"
                      />
                    </label>
                    <label className="inline-flex items-center gap-1">
                      Atraso (dias)
                      <input
                        type="number"
                        min={0}
                        value={s.delayDays}
                        onChange={(e) => updateStep(idx, { delayDays: Math.max(0, Number(e.target.value) || 0) })}
                        className="w-14 px-1.5 py-1 rounded border border-slate-300"
                      />
                    </label>
                    <label className="inline-flex items-center gap-1">
                      (horas)
                      <input
                        type="number"
                        min={0}
                        value={s.delayHours || 0}
                        onChange={(e) => updateStep(idx, { delayHours: Math.max(0, Number(e.target.value) || 0) })}
                        className="w-14 px-1.5 py-1 rounded border border-slate-300"
                      />
                    </label>
                    <select
                      value={s.condition || 'ALWAYS'}
                      onChange={(e) => updateStep(idx, { condition: e.target.value as SequenceStep['condition'] })}
                      className="px-2 py-1 rounded border border-slate-300 bg-white"
                    >
                      {CONDITION_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={Boolean(s.requiresManualApproval)}
                        onChange={(e) => updateStep(idx, { requiresManualApproval: e.target.checked })}
                      />
                      Exige aprovação
                    </label>
                    <div className="ml-auto flex items-center gap-1">
                      <button type="button" title="Mover para cima" onClick={() => moveStep(idx, -1)} className="p-1 rounded hover:bg-white border border-transparent hover:border-slate-200">
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" title="Mover para baixo" onClick={() => moveStep(idx, 1)} className="p-1 rounded hover:bg-white border border-transparent hover:border-slate-200">
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" title="Remover passo" onClick={() => removeStep(idx)} className="p-1 rounded text-rose-600 hover:bg-rose-50">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={s.subject}
                    onChange={(e) => updateStep(idx, { subject: e.target.value })}
                    placeholder={s.stepType === 'SALES_TASK' || s.stepType === 'PHONE_CALL' ? 'Título da tarefa' : 'Assunto'}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white"
                  />
                  <textarea
                    rows={2}
                    value={s.bodyTemplate}
                    onChange={(e) => updateStep(idx, { bodyTemplate: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white"
                  />
                  {s.stepType === 'TRANSFER_TO_NURTURE' && (
                    <input
                      type="text"
                      value={s.nurtureCampaignId || ''}
                      onChange={(e) => updateStep(idx, { nurtureCampaignId: e.target.value })}
                      placeholder="ID da campanha de nutrição (ex: cmp-1)"
                      className="w-64 px-2.5 py-1.5 rounded border border-slate-300 bg-white font-mono"
                    />
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* JANELA COMERCIAL & CAIXA POSTAL */}
        {panel === 'WINDOW' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 space-y-3">
              <h5 className="font-semibold text-slate-900">Janela de envio (horário comercial, dias úteis, feriados e fuso)</h5>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-0.5">
                  <span className="block text-slate-500">Início</span>
                  <input type="time" value={draftWindow.businessHoursStart} onChange={(e) => setDraftWindow((w) => ({ ...w, businessHoursStart: e.target.value }))} className="w-full px-2 py-1.5 rounded border border-slate-300" />
                </label>
                <label className="space-y-0.5">
                  <span className="block text-slate-500">Fim</span>
                  <input type="time" value={draftWindow.businessHoursEnd} onChange={(e) => setDraftWindow((w) => ({ ...w, businessHoursEnd: e.target.value }))} className="w-full px-2 py-1.5 rounded border border-slate-300" />
                </label>
              </div>
              <div className="flex flex-wrap gap-3">
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={draftWindow.businessDaysOnly} onChange={(e) => setDraftWindow((w) => ({ ...w, businessDaysOnly: e.target.checked }))} />
                  Somente dias úteis
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={draftWindow.skipHolidays} onChange={(e) => setDraftWindow((w) => ({ ...w, skipHolidays: e.target.checked }))} />
                  Pular feriados
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={draftWindow.respectRecipientTimezone} onChange={(e) => setDraftWindow((w) => ({ ...w, respectRecipientTimezone: e.target.checked }))} />
                  Usar fuso do destinatário
                </label>
              </div>
              <label className="block space-y-0.5">
                <span className="block text-slate-500">Fuso padrão</span>
                <select value={draftWindow.defaultTimezone} onChange={(e) => setDraftWindow((w) => ({ ...w, defaultTimezone: e.target.value }))} className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white">
                  {Array.from(new Set([draftWindow.defaultTimezone, ...TIMEZONE_OPTIONS])).map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </label>
              <label className="block space-y-0.5">
                <span className="block text-slate-500">Feriados (AAAA-MM-DD, separados por vírgula)</span>
                <textarea rows={2} value={holidaysText} onChange={(e) => setHolidaysText(e.target.value)} className="w-full px-2 py-1.5 rounded border border-slate-300 font-mono text-[11px]" />
              </label>
            </div>

            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-slate-200 space-y-3">
                <h5 className="font-semibold text-slate-900">Limite por caixa postal &amp; motor de envio</h5>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-0.5 col-span-2">
                    <span className="block text-slate-500">Caixa postal remetente</span>
                    <input type="email" value={draftWindow.senderMailbox} onChange={(e) => setDraftWindow((w) => ({ ...w, senderMailbox: e.target.value }))} className="w-full px-2 py-1.5 rounded border border-slate-300" />
                  </label>
                  <label className="space-y-0.5">
                    <span className="block text-slate-500">Limite diário (envios)</span>
                    <input type="number" min={1} value={draftWindow.dailyMailboxSendLimit} onChange={(e) => setDraftWindow((w) => ({ ...w, dailyMailboxSendLimit: Number(e.target.value) || 1 }))} className="w-full px-2 py-1.5 rounded border border-slate-300" />
                  </label>
                  <label className="space-y-0.5">
                    <span className="block text-slate-500">Motor</span>
                    <select value={draftWindow.sendingProvider} onChange={(e) => setDraftWindow((w) => ({ ...w, sendingProvider: e.target.value as SendingWindowConfig['sendingProvider'] }))} className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white">
                      <option value="OUTLOOK_M365">Outlook / M365 (vendas 1:1)</option>
                      <option value="MARKETING_ESP">Provedor de marketing (ESP)</option>
                    </select>
                  </label>
                </div>
                <div>
                  <div className="flex items-center justify-between text-[11px] text-slate-600">
                    <span>Uso hoje: {sentToday} / {mailboxLimit}</span>
                    <span>{mailboxPct}%</span>
                  </div>
                  <div className="h-2 rounded bg-slate-100 overflow-hidden">
                    <div className={`h-full ${mailboxPct >= 90 ? 'bg-rose-500' : mailboxPct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${mailboxPct}%` }} />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Ao atingir o limite, novas inscrições são retidas e passos de e-mail são adiados para a próxima janela comercial. O contador zera na virada do dia ({draftWindow.defaultTimezone}).
                  </p>
                </div>
                <button type="button" disabled={saving} onClick={handleSaveWindow} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white font-semibold disabled:opacity-50">
                  <Save className="w-3.5 h-3.5" /> {saving ? 'Salvando...' : 'Salvar janela e limites'}
                </button>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 space-y-2">
                <h5 className="font-semibold text-slate-900">Simulador de próximo envio</h5>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-0.5 col-span-2">
                    <span className="block text-slate-500">Data/hora base (vazio = agora)</span>
                    <input type="datetime-local" value={simBaseDate} onChange={(e) => setSimBaseDate(e.target.value)} className="w-full px-2 py-1.5 rounded border border-slate-300" />
                  </label>
                  <label className="space-y-0.5">
                    <span className="block text-slate-500">Atraso (dias)</span>
                    <input type="number" min={0} value={simDelayDays} onChange={(e) => setSimDelayDays(e.target.value)} className="w-full px-2 py-1.5 rounded border border-slate-300" />
                  </label>
                  <label className="space-y-0.5">
                    <span className="block text-slate-500">Atraso (horas)</span>
                    <input type="number" min={0} value={simDelayHours} onChange={(e) => setSimDelayHours(e.target.value)} className="w-full px-2 py-1.5 rounded border border-slate-300" />
                  </label>
                  <label className="space-y-0.5 col-span-2">
                    <span className="block text-slate-500">Fuso do destinatário</span>
                    <select value={simTimezone} onChange={(e) => setSimTimezone(e.target.value)} className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white">
                      {TIMEZONE_OPTIONS.map((tz) => (
                        <option key={tz} value={tz}>{tz}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <button type="button" onClick={handleCalcWindow} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white font-semibold">
                  <CalendarClock className="w-3.5 h-3.5" /> Calcular
                </button>
                {simWindowResult && (
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-0.5" data-testid="cadence-window-result">
                    <div>
                      Próximo envio (hora local do destinatário): <strong>{simWindowResult.scheduledLocalDisplay || simWindowResult.scheduledAtIso}</strong> ({simWindowResult.timezoneUsed})
                    </div>
                    <div className="text-slate-500">UTC: {simWindowResult.scheduledAtIso}</div>
                    <div className="text-slate-500">
                      Ajustado ao horário comercial: {simWindowResult.adjustedForBusinessHours ? 'sim' : 'não'} | Fins de semana pulados: {simWindowResult.skippedWeekendDays} | Feriados pulados: {simWindowResult.skippedHolidayDates.join(', ') || 'nenhum'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 13 REGRAS DE SAIDA + SIMULADOR */}
        {panel === 'EXIT_RULES' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 p-4 rounded-xl border border-slate-200 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h5 className="font-semibold text-slate-900">13 regras automáticas de saída ({draftRules.filter((r) => r.enabled).length} ativas)</h5>
                <label className="inline-flex items-center gap-1.5">
                  Escopo padrão
                  <select value={draftExitScope} onChange={(e) => setDraftExitScope(e.target.value as 'CONTACT_ONLY' | 'ENTIRE_COMPANY')} className="px-2 py-1 rounded border border-slate-300 bg-white">
                    <option value="CONTACT_ONLY">Somente o contato</option>
                    <option value="ENTIRE_COMPANY">Empresa inteira</option>
                  </select>
                </label>
              </div>
              <p className="text-slate-500">
                Regras comerciais (1 a 9) encerram apenas a cadência e não descadastram o contato. Regras 10 a 13 bloqueiam envios e atualizam a lista de supressão.
              </p>
              <div className="divide-y divide-slate-100" data-testid="cadence-exit-rules">
                {draftRules.map((r, idx) => (
                  <div key={r.trigger} className="py-2 flex flex-wrap items-center gap-2">
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={(e) => setDraftRules((prev) => prev.map((x, i) => (i === idx ? { ...x, enabled: e.target.checked } : x)))}
                    />
                    <div className="flex-1 min-w-[220px]">
                      <div className="font-semibold text-slate-900">{r.label}</div>
                      <div className="text-[11px] text-slate-500">{r.description}</div>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${TEN_CADENCE_STATES.find((s) => s.state === r.targetCanonicalState)?.tone || ''}`}>
                      {TEN_CADENCE_STATES.find((s) => s.state === r.targetCanonicalState)?.labelPt || r.targetCanonicalState}
                    </span>
                    <select
                      value={r.scope}
                      onChange={(e) => setDraftRules((prev) => prev.map((x, i) => (i === idx ? { ...x, scope: e.target.value as 'CONTACT_ONLY' | 'ENTIRE_COMPANY' } : x)))}
                      className="px-2 py-1 rounded border border-slate-300 bg-white"
                    >
                      <option value="CONTACT_ONLY">Contato</option>
                      <option value="ENTIRE_COMPANY">Empresa</option>
                    </select>
                  </div>
                ))}
              </div>
              <button type="button" disabled={saving} onClick={handleSaveRules} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white font-semibold disabled:opacity-50">
                <Save className="w-3.5 h-3.5" /> {saving ? 'Salvando...' : 'Salvar regras'}
              </button>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 space-y-2">
              <h5 className="font-semibold text-slate-900 flex items-center gap-1.5">
                <GitBranch className="w-4 h-4 text-[#ff7a59]" /> Simulador de regras de saída
              </h5>
              <p className="text-slate-500">Aplica a regra de verdade na inscrição escolhida (motor de cadências).</p>
              <select value={simEnrollmentId} onChange={(e) => setSimEnrollmentId(e.target.value)} className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white">
                <option value="">Selecione uma inscrição ativa ({activeEnrollmentsForSim.length})</option>
                {activeEnrollmentsForSim.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.contact ? `${e.contact.firstName} ${e.contact.lastName}` : e.contactId} — passo {e.currentStepOrder}
                  </option>
                ))}
              </select>
              <select value={simTrigger} onChange={(e) => setSimTrigger(e.target.value as SequenceExitRuleTrigger)} className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white">
                {ruleOptions.map((r) => (
                  <option key={r.trigger} value={r.trigger}>{r.label}</option>
                ))}
              </select>
              <select value={simScope} onChange={(e) => setSimScope(e.target.value as '' | 'CONTACT_ONLY' | 'ENTIRE_COMPANY')} className="w-full px-2 py-1.5 rounded border border-slate-300 bg-white">
                <option value="">Escopo: conforme regra</option>
                <option value="CONTACT_ONLY">Escopo: somente o contato</option>
                <option value="ENTIRE_COMPANY">Escopo: empresa inteira</option>
              </select>
              <input type="text" value={simDetail} onChange={(e) => setSimDetail(e.target.value)} placeholder="Detalhe / trecho da resposta (opcional)" className="w-full px-2 py-1.5 rounded border border-slate-300" />
              <button type="button" onClick={handleSimulateRule} className="w-full inline-flex justify-center items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white font-semibold">
                Aplicar regra
              </button>
              {simRuleResult && (
                <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900" data-testid="cadence-rule-result">
                  {simRuleResult}
                </div>
              )}
            </div>
          </div>
        )}

        {/* VERSOES & CLONAGEM */}
        {panel === 'VERSIONS' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 space-y-2">
              <h5 className="font-semibold text-slate-900 flex items-center gap-1.5">
                <History className="w-4 h-4 text-[#1e3a6e]" /> Histórico de versões (atual: v{sequence.version || 1})
              </h5>
              {(sequence.versionHistory || []).length === 0 ? (
                <p className="text-slate-500">Nenhuma alteração estrutural registrada ainda. Cada salvamento de passos, janela ou regras gera uma nova versão com snapshot da anterior.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {(sequence.versionHistory || []).map((v) => (
                    <div key={`${v.version}-${v.savedAt}`} className="py-1.5 flex items-center justify-between gap-2">
                      <span className="font-semibold">v{v.version}</span>
                      <span className="text-slate-500">{formatDateTimeBR(v.savedAt)}</span>
                      <span className="text-slate-600">{v.steps.length} passos</span>
                      <span className="text-[11px] text-slate-500 truncate">{v.changedFields.join(', ') || 'configuração'}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-slate-500">
                Inscrições em andamento por versão:{' '}
                {Object.entries(
                  seqEnrollments.reduce<Record<string, number>>((acc, e) => {
                    const k = `v${e.enrolledVersion || 1}`;
                    acc[k] = (acc[k] || 0) + 1;
                    return acc;
                  }, {})
                )
                  .map(([k, n]) => `${k}: ${n}`)
                  .join(' | ') || 'nenhuma'}
              </p>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 space-y-2">
              <h5 className="font-semibold text-slate-900 flex items-center gap-1.5">
                <Copy className="w-4 h-4 text-[#ff7a59]" /> Clonar cadência
              </h5>
              <p className="text-slate-500">Cria uma cópia (v1) com os mesmos passos, janela e regras, com métricas zeradas.</p>
              <input type="text" value={cloneName} onChange={(e) => setCloneName(e.target.value)} placeholder={`${sequence.name} (Clonar)`} className="w-full px-2 py-1.5 rounded border border-slate-300" />
              <button type="button" onClick={handleClone} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#1e3a6e] text-white font-semibold">
                <Copy className="w-3.5 h-3.5" /> Clonar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
