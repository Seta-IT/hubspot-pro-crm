'use client';

import React, { useState } from 'react';
import {
  Mail,
  Send,
  MousePointerClick,
  MessageSquareReply,
  PauseCircle,
  Play,
  Plus,
  UserPlus,
  CheckCircle2,
  Clock,
  Sparkles,
  X,
} from 'lucide-react';
import {
  Contact,
  Deal,
  EmailSequence,
  SequenceEnrollment,
  SequenceStep,
} from '../../db/types';
import { formatDateTimeBR } from './ui-helpers';

export interface EnrichedEnrollment extends SequenceEnrollment {
  contact: Contact | null;
}

interface SequencesSectionProps {
  sequences: EmailSequence[];
  enrollments: EnrichedEnrollment[];
  contacts: Contact[];
  deals: Deal[];
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

export default function SequencesSection({
  sequences,
  enrollments,
  contacts,
  deals,
  onEnrollContact,
  onAdvanceStep,
  onRecordInteraction,
  onCreateSequence,
}: SequencesSectionProps) {
  const [selectedSequenceId, setSelectedSequenceId] = useState<string>(
    sequences[0]?.id || 'seq-outbound-enterprise'
  );
  const [enrollContactId, setEnrollContactId] = useState<string>(contacts[0]?.id || '');
  const [enrollDealId, setEnrollDealId] = useState<string>('');
  const [enrolling, setEnrolling] = useState(false);

  const [replyModalEnrollment, setReplyModalEnrollment] = useState<EnrichedEnrollment | null>(null);
  const [replyText, setReplyText] = useState(
    'Olá Marcéllo! Excelente contato, vamos agendar a demonstração na quinta-feira às 15h!'
  );
  const [processingEnrollmentId, setProcessingEnrollmentId] = useState<string | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);

  // Create Sequence Modal
  const [showCreateSeqModal, setShowCreateSeqModal] = useState(false);
  const [seqName, setSeqName] = useState('');
  const [seqDesc, setSeqDesc] = useState('');
  const [seqCategory, setSeqCategory] = useState<
    'OUTBOUND' | 'INBOUND_NURTURE' | 'FOLLOW_UP' | 'REENGAGEMENT'
  >('OUTBOUND');
  const [step1Subject, setStep1Subject] = useState(
    'Diagnóstico Comercial & Receita para {{companyName}}'
  );
  const [step1Body, setStep1Body] = useState(
    'Olá {{firstName}}, preparamos um plano personalizado para acelerar o funil da {{companyName}}.'
  );
  const [step2Subject, setStep2Subject] = useState(
    'Re: Diagnóstico Comercial para {{companyName}} (Follow-up)'
  );
  const [step2Body, setStep2Body] = useState(
    '{{firstName}}, conseguiu avaliar o diagnóstico enviado? Podemos conversar 10 minutos esta semana?'
  );
  const [creatingSeq, setCreatingSeq] = useState(false);

  const activeSequence =
    sequences.find((s) => s.id === selectedSequenceId) || sequences[0] || null;

  const handleEnrollSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSequence || !enrollContactId) return;
    setEnrolling(true);
    try {
      await onEnrollContact({
        sequenceId: activeSequence.id,
        contactId: enrollContactId,
        dealId: enrollDealId || null,
      });
      setFeedbackBanner(
        `Contato inscrito com sucesso na cadência "${activeSequence.name}" (Passo 1 enviado automaticamente)!`
      );
    } finally {
      setEnrolling(false);
    }
  };

  const handleConfirmReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyModalEnrollment) return;
    setProcessingEnrollmentId(replyModalEnrollment.id);
    try {
      const res = await onRecordInteraction({
        enrollmentId: replyModalEnrollment.id,
        action: 'REPLY',
        replySnippet: replyText.trim(),
      });
      if (res?.autoPaused) {
        setFeedbackBanner(
          `Resposta registrada! A cadência de ${replyModalEnrollment.contact?.firstName || 'Lead'} foi PAUSADA AUTOMATICAMENTE (PAUSED_ON_REPLY) e o Lead Score foi elevado!`
        );
      }
      setReplyModalEnrollment(null);
    } finally {
      setProcessingEnrollmentId(null);
    }
  };

  const handleCreateSequenceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!seqName.trim()) return;
    setCreatingSeq(true);
    try {
      const steps: SequenceStep[] = [
        {
          id: `step-${Date.now()}-1`,
          stepOrder: 1,
          dayOffset: 1,
          delayDays: 0,
          subject: step1Subject.trim(),
          bodyTemplate: step1Body.trim(),
          stepType: 'EMAIL',
          condition: 'ALWAYS',
          sentCount: 0,
          openCount: 0,
          clickCount: 0,
          replyCount: 0,
        },
        {
          id: `step-${Date.now()}-2`,
          stepOrder: 2,
          dayOffset: 3,
          delayDays: 2,
          subject: step2Subject.trim(),
          bodyTemplate: step2Body.trim(),
          stepType: 'FOLLOW_UP',
          condition: 'IF_NO_REPLY',
          sentCount: 0,
          openCount: 0,
          clickCount: 0,
          replyCount: 0,
        },
      ];
      await onCreateSequence({
        name: seqName.trim(),
        description: seqDesc.trim() || 'Cadência comercial automatizada com pausa na resposta.',
        category: seqCategory,
        steps,
      });
      setSeqName('');
      setSeqDesc('');
      setShowCreateSeqModal(false);
    } finally {
      setCreatingSeq(false);
    }
  };

  return (
    <div className="space-y-6">
      {feedbackBanner && (
        <div className="p-4 rounded-xl bg-emerald-950 text-white border border-emerald-700 flex items-center justify-between gap-3 text-xs font-medium shadow-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{feedbackBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            className="text-emerald-300 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* SEQUENCES SELECTOR & CREATE BUTTON */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {sequences.map((seq) => (
            <button
              key={seq.id}
              type="button"
              onClick={() => setSelectedSequenceId(seq.id)}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold border transition text-left ${
                activeSequence?.id === seq.id
                  ? 'bg-[#1e293b] text-white border-[#1e293b] shadow-sm'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-[#ff7a59]'
              }`}
            >
              <div>{seq.name}</div>
              <div
                className={`text-[10px] mt-0.5 ${
                  activeSequence?.id === seq.id ? 'text-[#ff987f]' : 'text-slate-400'
                }`}
              >
                {seq.steps.length} etapas • Abertura {seq.openRate}% • Resposta {seq.replyRate}%
              </div>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setShowCreateSeqModal(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-bold shadow-sm transition shrink-0"
        >
          <Plus className="w-4 h-4" />
          Nova Cadência de E-mail
        </button>
      </div>

      {/* ACTIVE SEQUENCE FUNNEL METRICS & MULTI-STEP TIMELINE */}
      {activeSequence && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-200 bg-slate-50/60 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-orange-100 text-[#e05835]">
                  {activeSequence.category}
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                  <PauseCircle className="w-3.5 h-3.5" />
                  Auto-Pause ao Responder Ativo
                </span>
              </div>
              <h3 className="text-lg font-bold text-slate-900">{activeSequence.name}</h3>
              <p className="text-xs text-slate-600">{activeSequence.description}</p>
            </div>

            {/* Email Funnel Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
              <div className="bg-white p-3 rounded-xl border border-slate-200 text-center">
                <div className="text-[11px] text-slate-400 uppercase font-semibold">Enviados</div>
                <div className="text-lg font-extrabold text-slate-900">
                  {activeSequence.sentCount}
                </div>
                <div className="text-[10px] text-slate-500">
                  {activeSequence.enrolledCount} inscritos
                </div>
              </div>

              <div className="bg-white p-3 rounded-xl border border-slate-200 text-center">
                <div className="text-[11px] text-slate-400 uppercase font-semibold">Abertura</div>
                <div className="text-lg font-extrabold text-indigo-600">
                  {activeSequence.openRate}%
                </div>
                <div className="text-[10px] text-slate-500">
                  {activeSequence.openCount} aberturas
                </div>
              </div>

              <div className="bg-white p-3 rounded-xl border border-slate-200 text-center">
                <div className="text-[11px] text-slate-400 uppercase font-semibold">Cliques</div>
                <div className="text-lg font-extrabold text-amber-600">
                  {activeSequence.clickRate}%
                </div>
                <div className="text-[10px] text-slate-500">
                  {activeSequence.clickCount} cliques
                </div>
              </div>

              <div className="bg-emerald-50/70 p-3 rounded-xl border border-emerald-200 text-center">
                <div className="text-[11px] text-emerald-700 uppercase font-bold">Respostas</div>
                <div className="text-lg font-extrabold text-emerald-700">
                  {activeSequence.replyRate}%
                </div>
                <div className="text-[10px] text-emerald-600 font-medium">
                  {activeSequence.replyCount} responderam
                </div>
              </div>
            </div>
          </div>

          {/* Steps Visual Flow */}
          <div className="p-6 space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Estrutura de Passos e Templates da Cadência ({activeSequence.steps.length} Etapas)
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {activeSequence.steps.map((step) => (
                <div
                  key={step.id}
                  className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col justify-between gap-3 relative"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="px-2.5 py-0.5 rounded-full bg-[#1e293b] text-white text-[11px] font-bold">
                        Passo {step.stepOrder} • Dia {step.dayOffset}
                      </span>
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-orange-100 text-[#e05835]">
                        {step.stepType}
                      </span>
                    </div>

                    <div className="text-xs font-bold text-slate-900 leading-snug">
                      Assunto: {step.subject}
                    </div>
                    <p className="text-[11px] text-slate-600 line-clamp-3 bg-white p-2.5 rounded-lg border border-slate-200/80">
                      {step.bodyTemplate}
                    </p>
                  </div>

                  <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between text-[11px] text-slate-500">
                    <span>Env: {step.sentCount}</span>
                    <span>Ab: {step.openCount}</span>
                    <span>Cliq: {step.clickCount}</span>
                    <span className="font-bold text-emerald-700">Resp: {step.replyCount}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Enroll Contact Form */}
          <form
            onSubmit={handleEnrollSubmit}
            className="px-6 py-4 bg-slate-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-[#ff7a59]" />
              <span className="text-xs font-bold">
                Inscrever Contato nesta Cadência (Dispara Passo 1 Imediatamente):
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={enrollContactId}
                onChange={(e) => setEnrollContactId(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white"
              >
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName} ({c.email})
                  </option>
                ))}
              </select>

              <select
                value={enrollDealId}
                onChange={(e) => setEnrollDealId(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white"
              >
                <option value="">Sem negócio específico</option>
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>

              <button
                type="submit"
                disabled={enrolling}
                className="px-4 py-1.5 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-bold transition disabled:opacity-50"
              >
                {enrolling ? 'Inscrevendo...' : 'Inscrever Lead Agora'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ENROLLMENTS & AUTO-PAUSE ON REPLY MONITOR */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Monitor de Contatos Inscritos &amp; Pausa Automática na Resposta ({enrollments.length})
            </h3>
            <p className="text-xs text-slate-500">
              Simule avanço de etapa, abertura, clique ou resposta do lead para validar o encerramento imediato (`PAUSED_ON_REPLY`).
            </p>
          </div>
        </div>

        <div className="p-6 space-y-3">
          {enrollments.map((enr) => {
            const isPausedOnReply = enr.status === 'PAUSED_ON_REPLY';
            const isProcessing = processingEnrollmentId === enr.id;

            return (
              <div
                key={enr.id}
                className={`p-4 rounded-xl border transition ${
                  isPausedOnReply
                    ? 'border-emerald-300 bg-emerald-50/30'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                          isPausedOnReply
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : enr.status === 'ACTIVE'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {isPausedOnReply
                          ? '✓ PAUSED_ON_REPLY (Pausado Automaticamente — Lead Respondeu!)'
                          : `Status: ${enr.status}`}
                      </span>
                      <span className="text-xs font-bold text-slate-900">
                        {enr.contact
                          ? `${enr.contact.firstName} ${enr.contact.lastName} (${enr.contact.email})`
                          : enr.contactId}
                      </span>
                    </div>

                    <div className="text-xs text-slate-600 flex flex-wrap items-center gap-3">
                      <span>
                        Passo Atual: <strong>{enr.currentStepOrder}</strong> ({enr.stepsCompleted}{' '}
                        concluídos)
                      </span>
                      <span>•</span>
                      <span>Enviados: {enr.sentCount}</span>
                      <span>•</span>
                      <span>Aberturas: {enr.openCount}</span>
                      <span>•</span>
                      <span>Cliques: {enr.clickCount}</span>
                      {enr.nextStepDueAt && (
                        <>
                          <span>•</span>
                          <span className="text-indigo-600 font-medium">
                            Próximo disparo: {formatDateTimeBR(enr.nextStepDueAt)}
                          </span>
                        </>
                      )}
                    </div>

                    {enr.replySnippet && (
                      <div className="mt-2 p-2.5 rounded-lg bg-white border border-emerald-200 text-xs text-emerald-900">
                        <strong className="text-emerald-700">Resposta recebida do Lead:</strong>{' '}
                        &ldquo;{enr.replySnippet}&rdquo;
                      </div>
                    )}
                  </div>

                  {/* Interactive Controls for Enrollment */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {enr.status === 'ACTIVE' && (
                      <>
                        <button
                          type="button"
                          disabled={isProcessing}
                          onClick={async () => {
                            setProcessingEnrollmentId(enr.id);
                            try {
                              await onRecordInteraction({ enrollmentId: enr.id, action: 'OPEN' });
                            } finally {
                              setProcessingEnrollmentId(null);
                            }
                          }}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700"
                        >
                          + Abertura
                        </button>

                        <button
                          type="button"
                          disabled={isProcessing}
                          onClick={async () => {
                            setProcessingEnrollmentId(enr.id);
                            try {
                              await onRecordInteraction({ enrollmentId: enr.id, action: 'CLICK' });
                            } finally {
                              setProcessingEnrollmentId(null);
                            }
                          }}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700"
                        >
                          + Clique
                        </button>

                        <button
                          type="button"
                          disabled={isProcessing}
                          onClick={async () => {
                            setProcessingEnrollmentId(enr.id);
                            try {
                              await onAdvanceStep(enr.id);
                            } finally {
                              setProcessingEnrollmentId(null);
                            }
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition"
                        >
                          <Play className="w-3 h-3" />
                          Avançar Passo
                        </button>

                        <button
                          type="button"
                          disabled={isProcessing}
                          onClick={() => setReplyModalEnrollment(enr)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition"
                        >
                          <MessageSquareReply className="w-3.5 h-3.5" />
                          Simular Resposta (Auto-Pause)
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* SIMULATE REPLY MODAL */}
      {replyModalEnrollment && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 bg-emerald-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquareReply className="w-5 h-5 text-emerald-300" />
                <h3 className="text-sm font-bold">
                  Simular Resposta do Lead (Pausa Automática)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setReplyModalEnrollment(null)}
                className="text-emerald-200 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmReply} className="p-6 space-y-4">
              <p className="text-xs text-slate-600">
                Ao registrar a resposta de{' '}
                <strong>
                  {replyModalEnrollment.contact?.firstName} {replyModalEnrollment.contact?.lastName}
                </strong>
                , a inscrição mudará imediatamente para <code>PAUSED_ON_REPLY</code>, cancelará os próximos envios automáticos e registrará o e-mail na Timeline.
              </p>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                  Mensagem Recebida do Lead
                </label>
                <textarea
                  rows={3}
                  required
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs text-slate-900"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReplyModalEnrollment(null)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                >
                  Confirmar Resposta &amp; Pausar Cadência
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE SEQUENCE MODAL */}
      {showCreateSeqModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="px-6 py-4 bg-[#1e293b] text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail className="w-5 h-5 text-[#ff7a59]" />
                <h3 className="text-base font-bold">Criar Nova Cadência Multi-etapas</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateSeqModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSequenceSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                  Nome da Cadência *
                </label>
                <input
                  type="text"
                  required
                  value={seqName}
                  onChange={(e) => setSeqName(e.target.value)}
                  placeholder="Ex: Cadência Executiva Q4 - Expansão Fintechs"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                    Categoria
                  </label>
                  <select
                    value={seqCategory}
                    onChange={(e) =>
                      setSeqCategory(
                        e.target.value as
                          | 'OUTBOUND'
                          | 'INBOUND_NURTURE'
                          | 'FOLLOW_UP'
                          | 'REENGAGEMENT'
                      )
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs text-slate-900 bg-white"
                  >
                    <option value="OUTBOUND">Outbound Prospecção</option>
                    <option value="FOLLOW_UP">Follow-up Comercial</option>
                    <option value="INBOUND_NURTURE">Nutrição Inbound</option>
                    <option value="REENGAGEMENT">Reengajamento</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                    Descrição
                  </label>
                  <input
                    type="text"
                    value={seqDesc}
                    onChange={(e) => setSeqDesc(e.target.value)}
                    placeholder="Foco em decisores C-Level"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs text-slate-900"
                  />
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="text-xs font-bold text-slate-800">Passo 1 (Dia 1 - Envio Imediato)</div>
                <input
                  type="text"
                  value={step1Subject}
                  onChange={(e) => setStep1Subject(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900 bg-white"
                />
                <textarea
                  rows={2}
                  value={step1Body}
                  onChange={(e) => setStep1Body(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900 bg-white"
                />
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="text-xs font-bold text-slate-800">
                  Passo 2 (Dia 3 - Se não houver resposta)
                </div>
                <input
                  type="text"
                  value={step2Subject}
                  onChange={(e) => setStep2Subject(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900 bg-white"
                />
                <textarea
                  rows={2}
                  value={step2Body}
                  onChange={(e) => setStep2Body(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900 bg-white"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateSeqModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingSeq}
                  className="px-5 py-2 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-bold"
                >
                  {creatingSeq ? 'Criando...' : 'Salvar Cadência'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
