'use client';

import React, { useState } from 'react';
import {
  Workflow as WorkflowIcon,
  Mail,
  Play,
  Plus,
  ArrowRight,
  Zap,
  Filter,
  Power,
  Terminal,
  X,
} from 'lucide-react';
import {
  Contact,
  Deal,
  EmailSequence,
  SequenceStep,
  Workflow,
  WorkflowActionType,
  WorkflowConditionOperator,
  WorkflowExecution,
  WorkflowStep,
  WorkflowTriggerType,
} from '../../db/types';
import SequencesSection, { EnrichedEnrollment } from './SequencesSection';
import { formatDateTimeBR } from './ui-helpers';

interface AutomationsSequencesTabProps {
  workflows: Workflow[];
  executions: WorkflowExecution[];
  sequences: EmailSequence[];
  enrollments: EnrichedEnrollment[];
  contacts: Contact[];
  deals: Deal[];
  onToggleWorkflow: (workflowId: string, isActive: boolean) => Promise<void>;
  onTriggerWorkflowTest: (payload: {
    workflowId?: string;
    triggerType: WorkflowTriggerType;
    entityType: 'CONTACT' | 'COMPANY' | 'DEAL';
    entityId: string;
  }) => Promise<WorkflowExecution[]>;
  onCreateWorkflow: (payload: {
    name: string;
    description: string;
    triggerType: WorkflowTriggerType;
    steps: WorkflowStep[];
  }) => Promise<void>;
  onEnrollContact: (payload: {
    sequenceId: string;
    contactId: string;
    dealId?: string | null;
  }) => Promise<void>;
  onAdvanceStep: (enrollmentId: string) => Promise<void>;
  onRecordInteraction: (payload: {
    enrollmentId: string;
    action: 'OPEN' | 'CLICK' | 'REPLY';
    replySnippet?: string;
  }) => Promise<{ autoPaused: boolean } | null>;
  onCreateSequence: (payload: {
    name: string;
    description: string;
    category: 'OUTBOUND' | 'INBOUND_NURTURE' | 'FOLLOW_UP' | 'REENGAGEMENT';
    steps: SequenceStep[];
  }) => Promise<void>;
}

const TRIGGER_LABELS: Record<WorkflowTriggerType, string> = {
  CONTACT_CREATED: 'Contato Criado (CONTACT_CREATED)',
  DEAL_STAGE_CHANGED: 'Estágio de Negócio Alterado (DEAL_STAGE_CHANGED)',
  SCORE_THRESHOLD: 'Lead Score Atingiu Limite (SCORE_THRESHOLD)',
  FORM_SUBMITTED: 'Formulário Submetido (FORM_SUBMITTED)',
  DATA_HEALTH_ISSUE: 'Alerta de Saúde da Base (DATA_HEALTH_ISSUE)',
};

export default function AutomationsSequencesTab({
  workflows,
  executions,
  sequences,
  enrollments,
  contacts,
  deals,
  onToggleWorkflow,
  onTriggerWorkflowTest,
  onCreateWorkflow,
  onEnrollContact,
  onAdvanceStep,
  onRecordInteraction,
  onCreateSequence,
}: AutomationsSequencesTabProps) {
  const [activeTab, setActiveTab] = useState<'WORKFLOWS' | 'SEQUENCES'>('WORKFLOWS');
  const [testTargetContactId, setTestTargetContactId] = useState<string>(
    contacts[0]?.id || 'cont-marina'
  );
  const [testTargetDealId, setTestTargetDealId] = useState<string>(
    deals[0]?.id || 'deal-nubank-revops'
  );
  const [execStatusFilter, setExecStatusFilter] = useState<'ALL' | 'COMPLETED' | 'SKIPPED' | 'FAILED'>('ALL');
  const [runningTestWfId, setRunningTestWfId] = useState<string | null>(null);
  const [lastExecutionResult, setLastExecutionResult] = useState<WorkflowExecution | null>(null);

  // Create Workflow Modal
  const [showCreateWfModal, setShowCreateWfModal] = useState(false);
  const [wfName, setWfName] = useState('');
  const [wfDesc, setWfDesc] = useState('');
  const [wfTrigger, setWfTrigger] = useState<WorkflowTriggerType>('CONTACT_CREATED');
  const [condField, setCondField] = useState('email');
  const [condOp, setCondOp] = useState<WorkflowConditionOperator>('IS_NOT_EMPTY');
  const [condVal, setCondVal] = useState('');
  const [actType, setActType] = useState<WorkflowActionType>('ENRICH_RECORD');
  const [actParam, setActParam] = useState('Qualificar lead prioritário');
  const [creatingWf, setCreatingWf] = useState(false);

  const filteredExecutions =
    execStatusFilter === 'ALL'
      ? executions
      : executions.filter((e) => e.status === execStatusFilter);

  const handleRunTest = async (wf: Workflow) => {
    setRunningTestWfId(wf.id);
    try {
      const isDealTrigger = wf.triggerType === 'DEAL_STAGE_CHANGED';
      const entityType = isDealTrigger ? 'DEAL' : 'CONTACT';
      const entityId = isDealTrigger ? testTargetDealId : testTargetContactId;

      const res = await onTriggerWorkflowTest({
        workflowId: wf.id,
        triggerType: wf.triggerType,
        entityType,
        entityId,
      });
      if (res && res.length > 0) {
        setLastExecutionResult(res[0]);
      }
    } finally {
      setRunningTestWfId(null);
    }
  };

  const handleCreateWorkflowSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wfName.trim()) return;
    setCreatingWf(true);
    try {
      const steps: WorkflowStep[] = [
        {
          id: `step-cond-${Date.now()}`,
          type: 'CONDITION',
          condition: {
            field: condField,
            operator: condOp,
            value: condVal || undefined,
          },
        },
        {
          id: `step-act-${Date.now()}`,
          type: 'ACTION',
          actionType: actType,
          actionConfig:
            actType === 'CREATE_TASK'
              ? { title: actParam.trim() || 'Tarefa automática do workflow', dueInDays: 1 }
              : actType === 'UPDATE_PROPERTY'
                ? { field: 'leadStatus', value: actParam.trim() || 'OPEN' }
                : actType === 'SEND_EMAIL'
                  ? { subject: actParam.trim() || 'Boas-vindas Executivas' }
                  : actType === 'ASSIGN_OWNER'
                    ? { ownerId: actParam.trim() || 'owner-marcello' }
                    : actType === 'ENROLL_SEQUENCE'
                      ? { sequenceId: sequences[0]?.id || 'seq-outbound-enterprise' }
                      : actType === 'NOTIFY_OWNER'
                        ? { channel: 'In-App & Slack', message: actParam.trim() || 'Lead quente aguardando contato' }
                        : actType === 'SEND_WEBHOOK'
                          ? { url: actParam.trim() || 'https://api.gestaoclick.com/v1/mcp' }
                          : { overwrite: false },
        },
      ];

      await onCreateWorkflow({
        name: wfName.trim(),
        description: wfDesc.trim() || 'Fluxo de automação criado no Construtor Visual.',
        triggerType: wfTrigger,
        steps,
      });
      setWfName('');
      setWfDesc('');
      setShowCreateWfModal(false);
    } finally {
      setCreatingWf(false);
    }
  };

  const activeWfCount = workflows.filter((w) => w.isActive).length;
  const pausedOnReplyCount = enrollments.filter((e) => e.status === 'PAUSED_ON_REPLY').length;

  return (
    <div className="space-y-6">
      {/* TOP KPI STRIP FOR AUTOMATIONS & SEQUENCES */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <span className="text-xs font-semibold text-slate-500">Workflows Ativos (24x7)</span>
          <div className="text-2xl font-semibold text-slate-900 mt-1">
            {activeWfCount} / {workflows.length}
          </div>
          <span className="text-[11px] text-emerald-600 font-semibold">
            Gatilhos de Contato, Form, Deal, Score e Data Health
          </span>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <span className="text-xs font-semibold text-slate-500">Execuções Auditadas</span>
          <div className="text-2xl font-semibold text-[#ff7a59] mt-1">
            {executions.length}
          </div>
          <span className="text-[11px] text-slate-500">
            Logs passo a passo persistidos em banco
          </span>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <span className="text-xs font-semibold text-slate-500">Cadências Multi-etapas</span>
          <div className="text-2xl font-semibold text-indigo-700 mt-1">
            {sequences.length} cadências
          </div>
          <span className="text-[11px] text-slate-500">
            {enrollments.length} contatos monitorados no funil
          </span>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <span className="text-xs font-semibold text-slate-500">Pausados na Resposta (Auto-Pause)</span>
          <div className="text-2xl font-semibold text-emerald-600 mt-1">
            {pausedOnReplyCount} leads
          </div>
          <span className="text-[11px] text-emerald-700 font-semibold">
            Status PAUSED_ON_REPLY + Score +15 pts
          </span>
        </div>
      </div>

      {/* SUB-NAVIGATION: WORKFLOWS VS SEQUENCES */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200">
            <button
              type="button"
              onClick={() => setActiveTab('WORKFLOWS')}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
                activeTab === 'WORKFLOWS'
                  ? 'bg-[#1e293b] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <WorkflowIcon className="w-4 h-4 text-[#ff7a59]" />
              Fluxos de Automação (Workflows) ({workflows.length})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('SEQUENCES')}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
                activeTab === 'SEQUENCES'
                  ? 'bg-[#1e293b] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Mail className="w-4 h-4 text-[#ff7a59]" />
              Cadências de E-mail &amp; Follow-up ({sequences.length})
            </button>
          </div>
        </div>

        {activeTab === 'WORKFLOWS' && (
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
              <span>Contato p/ Teste:</span>
              <select
                value={testTargetContactId}
                onChange={(e) => setTestTargetContactId(e.target.value)}
                className="bg-transparent font-semibold text-slate-900 focus:outline-none"
              >
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
              <span>Deal p/ Teste:</span>
              <select
                value={testTargetDealId}
                onChange={(e) => setTestTargetDealId(e.target.value)}
                className="bg-transparent font-semibold text-slate-900 focus:outline-none max-w-[180px] truncate"
              >
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => setShowCreateWfModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-semibold shadow-sm transition"
            >
              <Plus className="w-4 h-4" />
              Novo Workflow
            </button>
          </div>
        )}
      </div>

      {/* TAB 1: VISUAL WORKFLOW BUILDER & EXECUTION LOGS */}
      {activeTab === 'WORKFLOWS' && (
        <div className="space-y-6">
          {/* Last Triggered Execution Live Toast */}
          {lastExecutionResult && (
            <div className="bg-slate-900 text-white rounded-2xl p-5 border border-[#ff7a59] shadow-lg space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-[#ff7a59]" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#ff987f]">
                    Execução de Workflow Concluída em Tempo Real ({lastExecutionResult.status})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setLastExecutionResult(null)}
                  className="text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="text-sm font-semibold">
                {lastExecutionResult.workflowName} • Entidade: {lastExecutionResult.entityType}:
                {lastExecutionResult.entityId}
              </div>
              <div className="space-y-1.5 bg-slate-950 p-3.5 rounded-xl border border-slate-800 text-xs font-mono">
                {lastExecutionResult.logs.map((log, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        log.status === 'SUCCESS'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-amber-500/20 text-amber-300'
                      }`}
                    >
                      {log.status}
                    </span>
                    <span className="text-slate-400">[{log.stepType}]</span>
                    <span className="text-slate-100">{log.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Workflows Cards with Visual Chain: Trigger -> Conditions -> Actions */}
          <div className="space-y-4">
            {workflows.map((wf) => {
              const isRunning = runningTestWfId === wf.id;

              return (
                <div
                  key={wf.id}
                  className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
                >
                  <div className="px-6 py-4 bg-slate-50/70 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                            wf.isActive
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : 'bg-slate-200 text-slate-600'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              wf.isActive ? 'bg-emerald-600' : 'bg-slate-500'
                            }`}
                          />
                          {wf.isActive ? 'Ativo' : 'Pausado'}
                        </span>
                        <h3 className="text-base font-semibold text-slate-900">{wf.name}</h3>
                      </div>
                      {wf.description && (
                        <p className="text-xs text-slate-500">{wf.description}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-slate-500 mr-2">
                        Execuções: <strong className="text-slate-900">{wf.enrolledCount}</strong>
                      </span>

                      <button
                        type="button"
                        onClick={() => onToggleWorkflow(wf.id, !wf.isActive)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition"
                      >
                        <Power className="w-3.5 h-3.5" />
                        {wf.isActive ? 'Pausar' : 'Ativar'}
                      </button>

                      <button
                        type="button"
                        disabled={isRunning}
                        onClick={() => handleRunTest(wf)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-semibold shadow-xs transition disabled:opacity-50"
                      >
                        <Play className="w-3.5 h-3.5" />
                        {isRunning ? 'Executando...' : 'Disparar Teste Agora'}
                      </button>
                    </div>
                  </div>

                  {/* VISUAL FLOW CHAIN: GATILHO -> CONDIÇÕES -> AÇÕES */}
                  <div className="p-6 overflow-x-auto">
                    <div className="flex items-center gap-3 min-w-max">
                      {/* Trigger Block */}
                      <div className="w-64 p-4 rounded-xl bg-[#1e293b] text-white border border-slate-700 shadow-xs">
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#ff987f]">
                          <Zap className="w-3.5 h-3.5 text-[#ff7a59]" />
                          1. Gatilho (Trigger)
                        </div>
                        <div className="text-xs font-semibold mt-1.5">
                          {TRIGGER_LABELS[wf.triggerType] || wf.triggerType}
                        </div>
                        <div className="text-[11px] text-slate-300 mt-1">
                          {Object.keys(wf.triggerConfig || {}).length > 0
                            ? JSON.stringify(wf.triggerConfig)
                            : 'Escuta eventos em tempo real'}
                        </div>
                      </div>

                      {/* Steps Chain */}
                      {wf.steps.map((step, idx) => (
                        <React.Fragment key={step.id}>
                          <ArrowRight className="w-5 h-5 text-slate-400 shrink-0" />
                          <div
                            className={`w-64 p-4 rounded-xl border shadow-xs ${
                              step.type === 'CONDITION'
                                ? 'bg-amber-50/50 border-amber-200'
                                : 'bg-indigo-50/40 border-indigo-200'
                            }`}
                          >
                            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider">
                              <span
                                className={
                                  step.type === 'CONDITION'
                                    ? 'text-amber-800'
                                    : 'text-indigo-800'
                                }
                              >
                                {idx + 2}. {step.type === 'CONDITION' ? 'Condição (SE)' : 'Ação Automática'}
                              </span>
                            </div>

                            {step.type === 'CONDITION' && step.condition ? (
                              <div className="mt-1.5 text-xs text-slate-800">
                                Campo <strong>{step.condition.field}</strong>{' '}
                                <code className="px-1 py-0.5 rounded bg-amber-100 text-amber-900 font-semibold">
                                  {step.condition.operator}
                                </code>{' '}
                                <strong>{String(step.condition.value ?? '')}</strong>
                              </div>
                            ) : (
                              <div className="mt-1.5 space-y-1">
                                <div className="text-xs font-semibold text-slate-900">
                                  {step.actionType}
                                </div>
                                <div className="text-[11px] text-slate-600 truncate">
                                  {step.actionConfig
                                    ? Object.entries(step.actionConfig)
                                        .map(([k, v]) => `${k}: ${String(v)}`)
                                        .join(' • ')
                                    : 'Execução imediata'}
                                </div>
                              </div>
                            )}
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Workflow Execution Audit Log */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/60 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">
                Histórico Auditável de Execuções de Workflows ({filteredExecutions.length})
              </h3>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white border border-slate-200 text-xs">
                <Filter className="w-3.5 h-3.5 text-slate-500" />
                <select
                  value={execStatusFilter}
                  onChange={(e) =>
                    setExecStatusFilter(
                      e.target.value as 'ALL' | 'COMPLETED' | 'SKIPPED' | 'FAILED'
                    )
                  }
                  className="bg-transparent font-semibold text-slate-700 focus:outline-none"
                >
                  <option value="ALL">Todos os Status ({executions.length})</option>
                  <option value="COMPLETED">COMPLETED</option>
                  <option value="SKIPPED">SKIPPED (Condição Falsa)</option>
                  <option value="FAILED">FAILED</option>
                </select>
              </div>
            </div>
            <div className="p-6 space-y-3">
              {filteredExecutions.slice(0, 10).map((exec) => (
                <div
                  key={exec.id}
                  className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded font-semibold text-[10px] ${
                          exec.status === 'COMPLETED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {exec.status}
                      </span>
                      <strong className="text-slate-900">
                        {exec.workflowName || exec.workflowId}
                      </strong>
                      <span className="text-slate-500">
                        ({exec.entityType}: {exec.entityId})
                      </span>
                    </div>
                    <span className="text-slate-400">{formatDateTimeBR(exec.startedAt)}</span>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {exec.logs.map((l, i) => (
                      <span
                        key={i}
                        className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-[11px] text-slate-700"
                      >
                        <strong>{l.actionType || l.stepType}:</strong> {l.message}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: MULTI-STEP EMAIL SEQUENCES */}
      {activeTab === 'SEQUENCES' && (
        <SequencesSection
          sequences={sequences}
          enrollments={enrollments}
          contacts={contacts}
          deals={deals}
          onEnrollContact={onEnrollContact}
          onAdvanceStep={onAdvanceStep}
          onRecordInteraction={onRecordInteraction}
          onCreateSequence={onCreateSequence}
        />
      )}

      {/* CREATE WORKFLOW MODAL */}
      {showCreateWfModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="px-6 py-4 bg-[#1e293b] text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <WorkflowIcon className="w-5 h-5 text-[#ff7a59]" />
                <h3 className="text-base font-semibold">Criar Novo Workflow de Automação</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateWfModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateWorkflowSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
                  Nome do Fluxo *
                </label>
                <input
                  type="text"
                  required
                  value={wfName}
                  onChange={(e) => setWfName(e.target.value)}
                  placeholder="Ex: Alerta Executivo para Leads Enterprise"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
                  1. Gatilho (Trigger)
                </label>
                <select
                  value={wfTrigger}
                  onChange={(e) => setWfTrigger(e.target.value as WorkflowTriggerType)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-900 bg-white"
                >
                  <option value="CONTACT_CREATED">Quando um Contato é Criado (CONTACT_CREATED)</option>
                  <option value="FORM_SUBMITTED">Quando um Formulário Web é Submetido (FORM_SUBMITTED)</option>
                  <option value="SCORE_THRESHOLD">Quando Lead Score Atinge Limite (SCORE_THRESHOLD)</option>
                  <option value="DEAL_STAGE_CHANGED">Quando Negócio Muda de Etapa (DEAL_STAGE_CHANGED)</option>
                  <option value="DATA_HEALTH_ISSUE">Quando Alerta de Saúde da Base Ocorre (DATA_HEALTH_ISSUE)</option>
                </select>
              </div>

              <div className="p-3.5 rounded-xl bg-amber-50/60 border border-amber-200 space-y-2">
                <span className="text-xs font-semibold text-amber-900 block">
                  2. Condição de Filtragem (IF)
                </span>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={condField}
                    onChange={(e) => setCondField(e.target.value)}
                    placeholder="Campo (ex: email)"
                    className="px-2.5 py-1.5 rounded-lg border border-amber-300 bg-white text-xs text-slate-900"
                  />
                  <select
                    value={condOp}
                    onChange={(e) => setCondOp(e.target.value as WorkflowConditionOperator)}
                    className="px-2.5 py-1.5 rounded-lg border border-amber-300 bg-white text-xs text-slate-900"
                  >
                    <option value="IS_NOT_EMPTY">IS_NOT_EMPTY</option>
                    <option value="GREATER_THAN">GREATER_THAN</option>
                    <option value="LESS_THAN">LESS_THAN</option>
                    <option value="EQUALS">EQUALS</option>
                    <option value="NOT_EQUALS">NOT_EQUALS</option>
                    <option value="CONTAINS">CONTAINS</option>
                  </select>
                  <input
                    type="text"
                    value={condVal}
                    onChange={(e) => setCondVal(e.target.value)}
                    placeholder="Valor (opcional)"
                    className="px-2.5 py-1.5 rounded-lg border border-amber-300 bg-white text-xs text-slate-900"
                  />
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-indigo-50/60 border border-indigo-200 space-y-2">
                <span className="text-xs font-semibold text-indigo-900 block">
                  3. Ação Automática (THEN)
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <select
                    value={actType}
                    onChange={(e) => setActType(e.target.value as WorkflowActionType)}
                    className="px-2.5 py-1.5 rounded-lg border border-indigo-300 bg-white text-xs text-slate-900"
                  >
                    <option value="ENRICH_RECORD">Enriquecer Registro (ENRICH_RECORD)</option>
                    <option value="CREATE_TASK">Criar Tarefa Comercial (CREATE_TASK)</option>
                    <option value="UPDATE_PROPERTY">Atualizar Propriedade (UPDATE_PROPERTY)</option>
                    <option value="SEND_EMAIL">Disparar E-mail Automático (SEND_EMAIL)</option>
                    <option value="ENROLL_SEQUENCE">Inscrever em Cadência (ENROLL_SEQUENCE)</option>
                    <option value="ASSIGN_OWNER">Atribuir Proprietário (ASSIGN_OWNER)</option>
                    <option value="NOTIFY_OWNER">Notificar Executivo (NOTIFY_OWNER)</option>
                    <option value="SEND_WEBHOOK">Disparar Webhook ERP/MCP (SEND_WEBHOOK)</option>
                  </select>
                  <input
                    type="text"
                    value={actParam}
                    onChange={(e) => setActParam(e.target.value)}
                    placeholder="Parâmetro / assunto / URL"
                    className="px-2.5 py-1.5 rounded-lg border border-indigo-300 bg-white text-xs text-slate-900"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateWfModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingWf}
                  className="px-5 py-2 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-semibold"
                >
                  {creatingWf ? 'Salvando...' : 'Ativar Workflow'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
