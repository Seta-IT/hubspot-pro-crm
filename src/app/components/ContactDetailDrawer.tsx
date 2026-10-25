'use client';

import React, { useState } from 'react';
import { Sparkles, CheckCircle2, X, Zap } from 'lucide-react';
import { Company, Contact, Deal, TimelineEvent } from '../../db/types';
import { CompletenessResult } from '../../modules/data-health/completeness';
import { formatBRL, formatDateTimeBR, formatRelativeDays, getLifecycleBadge } from './ui-helpers';

export interface DetailedContactResponse extends Contact {
  company: Company | null;
  deals: Deal[];
  timeline: TimelineEvent[];
  completenessDetail: CompletenessResult;
}

interface ContactDetailDrawerProps {
  contactDetail: DetailedContactResponse | null;
  loadingDetail: boolean;
  enrichingId: string | null;
  enrichmentFeedback: string | null;
  onClose: () => void;
  onSingleEnrich: (contactId: string) => Promise<void>;
  onAddContactActivity: (payload: {
    contactId: string;
    companyId?: string | null;
    type: 'NOTE' | 'CALL' | 'EMAIL' | 'MEETING' | 'TASK';
    title: string;
    body?: string;
  }) => Promise<void>;
}

export default function ContactDetailDrawer({
  contactDetail,
  loadingDetail,
  enrichingId,
  enrichmentFeedback,
  onClose,
  onSingleEnrich,
  onAddContactActivity,
}: ContactDetailDrawerProps) {
  const [actType, setActType] = useState<'NOTE' | 'CALL' | 'EMAIL' | 'MEETING' | 'TASK'>('NOTE');
  const [actTitle, setActTitle] = useState('');
  const [actBody, setActBody] = useState('');
  const [savingActivity, setSavingActivity] = useState(false);

  const handleAddActivitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactDetail || !actTitle.trim()) return;
    setSavingActivity(true);
    try {
      await onAddContactActivity({
        contactId: contactDetail.id,
        companyId: contactDetail.companyId,
        type: actType,
        title: actTitle.trim(),
        body: actBody.trim() || undefined,
      });
      setActTitle('');
      setActBody('');
    } finally {
      setSavingActivity(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex justify-end">
      <div className="bg-white w-full max-w-2xl h-full shadow-2xl border-l border-slate-200 flex flex-col overflow-hidden">
        <div className="px-6 py-4 bg-[#1e293b] text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-[#ff7a59] text-white font-bold flex items-center justify-center text-sm">
              {contactDetail?.firstName?.charAt(0) || 'C'}
              {contactDetail?.lastName?.charAt(0) || ''}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">
                  {contactDetail
                    ? `${contactDetail.firstName} ${contactDetail.lastName}`
                    : 'Carregando contato...'}
                </h3>
                {contactDetail && getLifecycleBadge(contactDetail.lifecycleStage)}
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                {contactDetail?.jobTitle || 'Cargo não informado'}{' '}
                {contactDetail?.company ? `• ${contactDetail.company.name}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {contactDetail && (
              <button
                type="button"
                disabled={enrichingId === contactDetail.id}
                onClick={() => onSingleEnrich(contactDetail.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-semibold transition disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {enrichingId === contactDetail.id ? 'Enriquecendo...' : 'Enriquecimento Inteligente'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {loadingDetail || !contactDetail ? (
            <div className="space-y-4 animate-pulse">
              <div className="h-24 bg-slate-100 rounded-xl" />
              <div className="h-32 bg-slate-100 rounded-xl" />
              <div className="h-48 bg-slate-100 rounded-xl" />
            </div>
          ) : (
            <>
              {enrichmentFeedback && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-medium flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{enrichmentFeedback}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-slate-500">
                      Lead Score Preditivo
                    </span>
                    <span className="text-lg font-extrabold text-emerald-600">
                      {contactDetail.leadScore}/100
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full"
                      style={{ width: `${contactDetail.leadScore}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Combina senioridade ({contactDetail.seniority || 'ANALYST'}), fit corporativo, completude e engajamento em negócios.
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-slate-500">
                      Índice de Completude
                    </span>
                    <span className="text-lg font-extrabold text-indigo-600">
                      {contactDetail.completenessScore}%
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-600 rounded-full"
                      style={{ width: `${contactDetail.completenessScore}%` }}
                    />
                  </div>
                  {contactDetail.completenessDetail?.missingFields?.length > 0 ? (
                    <p className="text-[11px] text-amber-700 font-medium">
                      Campos ausentes: {contactDetail.completenessDetail.missingFields.join(', ')}
                    </p>
                  ) : (
                    <p className="text-[11px] text-emerald-700 font-medium">
                      Todos os 6 critérios ponderados estão 100% preenchidos e validados!
                    </p>
                  )}
                </div>
              </div>

              {contactDetail.nextBestAction && (
                <div className="p-4 rounded-xl bg-gradient-to-r from-orange-50 via-amber-50/60 to-white border border-orange-200 flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-[#ff7a59] text-white shrink-0">
                    <Zap className="w-4 h-4" />
                  </div>
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#e05835]">
                        Próxima Melhor Ação Recomendada (Next Best Action)
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-[#e05835]">
                        Prioridade {contactDetail.nextBestAction.priority} • Prazo:{' '}
                        {contactDetail.nextBestAction.suggestedDueInDays}d
                      </span>
                    </div>
                    <h4 className="text-sm font-bold text-slate-900">
                      {contactDetail.nextBestAction.title}
                    </h4>
                    <p className="text-xs text-slate-600">{contactDetail.nextBestAction.reason}</p>
                  </div>
                </div>
              )}

              <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Dados Cadastrais & Smart Data
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  <div>
                    <span className="text-slate-400 block">E-mail</span>
                    <span className="font-semibold text-slate-800 break-all">
                      {contactDetail.email}
                    </span>
                    <span
                      className={`inline-block mt-0.5 text-[10px] font-bold ${
                        contactDetail.isValidEmail ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {contactDetail.isValidEmail
                        ? contactDetail.isCorporateEmail
                          ? '✓ Corporativo Válido'
                          : '✓ Pessoal Válido'
                        : '✕ E-mail Inválido/Descartável'}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block">Telefone (Padrão E.164)</span>
                    <span className="font-semibold text-slate-800">
                      {contactDetail.phone || 'Não informado'}
                    </span>
                    {contactDetail.normalizedPhone && (
                      <span className="block text-[10px] text-emerald-600 font-medium">
                        E.164: {contactDetail.normalizedPhone}
                      </span>
                    )}
                  </div>

                  <div>
                    <span className="text-slate-400 block">Cargo / Senioridade</span>
                    <span className="font-semibold text-slate-800">
                      {contactDetail.jobTitle || '—'}
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      {contactDetail.seniority || '—'} • Dept: {contactDetail.department || '—'}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block">Empresa Vinculada</span>
                    <span className="font-semibold text-slate-800">
                      {contactDetail.company?.name || 'Não vinculada'}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block">Fonte de Enriquecimento</span>
                    <span className="font-semibold text-indigo-700">
                      {contactDetail.enrichmentSource || 'Manual / Não enriquecido'}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block">Última Interação</span>
                    <span className="font-semibold text-slate-800">
                      {formatRelativeDays(contactDetail.lastActivityAt)}
                    </span>
                  </div>
                </div>

                {Object.keys(contactDetail.customProperties || {}).length > 0 && (
                  <div className="pt-3 border-t border-slate-100">
                    <span className="text-[11px] font-bold text-slate-500 block mb-1.5">
                      Propriedades Customizadas & Inferidas:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(contactDetail.customProperties).map(([k, v]) => (
                        <span
                          key={k}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-medium"
                        >
                          <strong>{k}:</strong> {String(v)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Negócios Vinculados ({contactDetail.deals?.length || 0})
                </h4>
                {contactDetail.deals?.length === 0 ? (
                  <p className="text-xs text-slate-400">Nenhum negócio vinculado a este contato.</p>
                ) : (
                  <div className="space-y-2">
                    {contactDetail.deals.map((d) => (
                      <div
                        key={d.id}
                        className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between text-xs"
                      >
                        <div>
                          <div className="font-bold text-slate-900">{d.title}</div>
                          <div className="text-slate-500">
                            Status: {d.status} • Probabilidade: {d.probability}%
                          </div>
                        </div>
                        <div className="text-sm font-extrabold text-slate-900">
                          {formatBRL(d.value)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <form
                onSubmit={handleAddActivitySubmit}
                className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase text-slate-700">
                    Registrar Interação na Timeline
                  </span>
                  <select
                    value={actType}
                    onChange={(e) =>
                      setActType(e.target.value as 'NOTE' | 'CALL' | 'EMAIL' | 'MEETING' | 'TASK')
                    }
                    className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700"
                  >
                    <option value="NOTE">Nota</option>
                    <option value="CALL">Ligação</option>
                    <option value="EMAIL">E-mail</option>
                    <option value="MEETING">Reunião</option>
                    <option value="TASK">Tarefa</option>
                  </select>
                </div>
                <input
                  type="text"
                  required
                  value={actTitle}
                  onChange={(e) => setActTitle(e.target.value)}
                  placeholder="Resumo da atividade..."
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-800"
                />
                <textarea
                  rows={2}
                  value={actBody}
                  onChange={(e) => setActBody(e.target.value)}
                  placeholder="Observações detalhadas..."
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-800"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingActivity}
                    className="px-4 py-1.5 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-semibold transition"
                  >
                    {savingActivity ? 'Salvando...' : 'Adicionar à Timeline'}
                  </button>
                </div>
              </form>

              <div className="space-y-2.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Timeline Unificada de Interações ({contactDetail.timeline?.length || 0})
                </h4>
                {contactDetail.timeline?.map((evt) => (
                  <div
                    key={evt.id}
                    className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1"
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-bold">
                        {evt.type}
                      </span>
                      <span className="text-slate-400">{formatDateTimeBR(evt.createdAt)}</span>
                    </div>
                    <div className="text-xs font-bold text-slate-900">{evt.title}</div>
                    {evt.body && <p className="text-xs text-slate-600">{evt.body}</p>}
                    <div className="text-[11px] text-slate-400">Registrado por: {evt.actor}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
