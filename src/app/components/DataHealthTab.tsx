'use client';

import React, { useState } from 'react';
import {
  ShieldCheck,
  Sparkles,
  GitMerge,
  AlertTriangle,
  CheckCircle2,
  Clock,
  MailWarning,
  FileWarning,
  RefreshCw,
  ArrowRight,
  Users,
  Building2,
  X,
} from 'lucide-react';
import { Company, Contact } from '../../db/types';
import { detectProtectedBranchCompanies, DuplicateCandidatePair } from '../../modules/data-health/deduplication';
import { AutoCleanResult, DataHealthSummaryReport } from '../../modules/data-health/health-service';
import { formatBRL } from './ui-helpers';

export interface DuplicatesPayload {
  contactDuplicates: DuplicateCandidatePair<Contact>[];
  companyDuplicates: DuplicateCandidatePair<Company>[];
  totalDuplicates: number;
}

interface DataHealthTabProps {
  summary: DataHealthSummaryReport | null;
  duplicates: DuplicatesPayload | null;
  contacts: Contact[];
  companies: Company[];
  loading: boolean;
  onRefresh: () => void;
  onMergeDuplicate: (params: {
    entityType: 'CONTACT' | 'COMPANY';
    primaryId: string;
    duplicateId: string;
  }) => Promise<void>;
  onAutoClean: () => Promise<AutoCleanResult | null>;
  onEnrichEntity: (entityType: 'CONTACT' | 'COMPANY', entityId: string) => Promise<void>;
  onNavigateToContact: (contactId: string) => void;
}

export default function DataHealthTab({
  summary,
  duplicates,
  contacts,
  companies,
  loading,
  onRefresh,
  onMergeDuplicate,
  onAutoClean,
  onEnrichEntity,
  onNavigateToContact,
}: DataHealthTabProps) {
  const [mergingKey, setMergingKey] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [autoCleanReport, setAutoCleanReport] = useState<AutoCleanResult | null>(null);
  const [enrichingEntityId, setEnrichingEntityId] = useState<string | null>(null);
  const [reassignTarget, setReassignTarget] = useState('Marcelo Lopes Mira');
  const [reassigning, setReassigning] = useState(false);
  const [reassignMsg, setReassignMsg] = useState<string | null>(null);

  const handleReassignOrphans = async () => {
    setReassigning(true);
    try {
      const res = await fetch('/api/data-health/reassign-orphans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetOwnerName: reassignTarget }),
      });
      if (res.ok) {
        const j = await res.json();
        const d = j.data;
        setReassignMsg(
          `Carteira de ex-vendedores reatribuída para ${d.targetOwnerName}: ${d.contactsReassigned} contato(s), ${d.companiesReassigned} empresa(s) e ${d.dealsReassigned} negócio(s) transferidos!`
        );
        onRefresh();
      }
    } finally {
      setReassigning(false);
    }
  };

  const [activeIssueTab, setActiveIssueTab] = useState<
    'DUPLICATES' | 'INCOMPLETE' | 'INVALID' | 'STALE'
  >('DUPLICATES');

  const handleRunAutoClean = async () => {
    setCleaning(true);
    try {
      const res = await onAutoClean();
      if (res) {
        setAutoCleanReport(res);
      }
    } finally {
      setCleaning(false);
    }
  };

  const handleMerge = async (
    entityType: 'CONTACT' | 'COMPANY',
    primaryId: string,
    duplicateId: string
  ) => {
    const key = `${entityType}-${primaryId}-${duplicateId}`;
    setMergingKey(key);
    try {
      await onMergeDuplicate({ entityType, primaryId, duplicateId });
    } finally {
      setMergingKey(null);
    }
  };

  if (loading && !summary) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-44 bg-white rounded-2xl border border-slate-200" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-white rounded-xl border border-slate-200" />
          ))}
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
        <p className="text-slate-600 mb-4">Não foi possível carregar o diagnóstico de saúde da base.</p>
        <button
          type="button"
          onClick={onRefresh}
          className="px-4 py-2 bg-[#ff7a59] text-white rounded-lg font-medium"
        >
          Recarregar Diagnóstico
        </button>
      </div>
    );
  }

  const incompleteContacts = contacts.filter((c) => c.completenessScore < 65);
  const incompleteCompanies = companies.filter((c) => c.completenessScore < 65);
  const invalidContacts = contacts.filter((c) => !c.isValidEmail || (c.phone && !c.isValidPhone));
  const protectedBranches = detectProtectedBranchCompanies(companies);

  const statusBadgeColor =
    summary.statusLabel === 'EXCELLENT'
      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40'
      : summary.statusLabel === 'GOOD'
        ? 'bg-teal-500/20 text-teal-200 border-teal-400/40'
        : summary.statusLabel === 'ATTENTION'
          ? 'bg-amber-500/20 text-amber-200 border-amber-400/40'
          : 'bg-rose-500/20 text-rose-200 border-rose-400/40';

  const statusTextPt =
    summary.statusLabel === 'EXCELLENT'
      ? 'Excelente'
      : summary.statusLabel === 'GOOD'
        ? 'Bom / Estável'
        : summary.statusLabel === 'ATTENTION'
          ? 'Requer Atenção'
          : 'Crítico';

  return (
    <div className="space-y-6">
      {/* HERO GLOBAL HEALTH SCORE & 1-CLICK AUTO-CLEAN */}
      <div className="bg-gradient-to-br from-[#1e293b] via-[#1e293b] to-[#0f172a] rounded-2xl p-6 text-white shadow-lg border border-slate-800">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-6">
            {/* Circular / Gauge Score */}
            <div className="w-28 h-28 rounded-2xl bg-slate-900/90 border-2 border-[#ff7a59] flex flex-col items-center justify-center shrink-0 shadow-inner">
              <span className="text-3xl font-extrabold text-white">{summary.globalHealthScore}</span>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                de 100 pts
              </span>
              <span
                className={`mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusBadgeColor}`}
              >
                {statusTextPt}
              </span>
            </div>

            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#ff7a59]/20 border border-[#ff7a59]/40 text-[#ff987f] text-xs font-semibold">
                <ShieldCheck className="w-3.5 h-3.5 text-[#ff7a59]" />
                Central de Saúde e Higienização da Base (Data Health)
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-white">
                Diagnóstico Global de Integridade, Duplicidades e Frescor Comercial
              </h2>
              <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
                Algoritmos Jaro-Winkler + Levenshtein para detecção fuzzy de duplicados, validação de dígitos verificadores CNPJ Mod-11, padronização E.164 (+55) e enriquecimento corporativo.
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end gap-2.5 shrink-0">
            <button
              type="button"
              disabled={cleaning}
              onClick={handleRunAutoClean}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs sm:text-sm font-bold shadow-md transition disabled:opacity-60"
            >
              <Sparkles className={`w-4 h-4 ${cleaning ? 'animate-spin' : ''}`} />
              {cleaning
                ? 'Executando Higienização...'
                : 'Higienização Automática em 1 Clique (Auto-Clean)'}
            </button>
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reescanear Base Agora
            </button>
          </div>
        </div>

        {/* 4 Breakdown Sub-Scores (Clicáveis) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6 pt-5 border-t border-slate-700/80">
          <button
            type="button"
            onClick={() => setActiveIssueTab('INCOMPLETE')}
            className="text-left bg-slate-800/70 hover:bg-slate-800 hover:border-indigo-400 rounded-xl p-3.5 border border-slate-700 transition cursor-pointer"
          >
            <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
              <span>Completude Ponderada (30%) →</span>
              <strong className="text-white">{summary.breakdown.completenessHealth}%</strong>
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-400 rounded-full"
                style={{ width: `${summary.breakdown.completenessHealth}%` }}
              />
            </div>
          </button>

          <button
            type="button"
            onClick={() => setActiveIssueTab('INVALID')}
            className="text-left bg-slate-800/70 hover:bg-slate-800 hover:border-emerald-400 rounded-xl p-3.5 border border-slate-700 transition cursor-pointer"
          >
            <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
              <span>Validade E-mail/E.164 (25%) →</span>
              <strong className="text-white">{summary.breakdown.validityHealth}%</strong>
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-400 rounded-full"
                style={{ width: `${summary.breakdown.validityHealth}%` }}
              />
            </div>
          </button>

          <button
            type="button"
            onClick={() => setActiveIssueTab('DUPLICATES')}
            className="text-left bg-slate-800/70 hover:bg-slate-800 hover:border-[#ff7a59] rounded-xl p-3.5 border border-slate-700 transition cursor-pointer"
          >
            <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
              <span>Livre de Duplicidades (25%) →</span>
              <strong className="text-white">{summary.breakdown.deduplicationHealth}%</strong>
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#ff7a59] rounded-full"
                style={{ width: `${summary.breakdown.deduplicationHealth}%` }}
              />
            </div>
          </button>

          <button
            type="button"
            onClick={() => setActiveIssueTab('STALE')}
            className="text-left bg-slate-800/70 hover:bg-slate-800 hover:border-amber-400 rounded-xl p-3.5 border border-slate-700 transition cursor-pointer"
          >
            <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
              <span>Frescor &amp; Atividade (20%) →</span>
              <strong className="text-white">{summary.breakdown.freshnessHealth}%</strong>
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-400 rounded-full"
                style={{ width: `${summary.breakdown.freshnessHealth}%` }}
              />
            </div>
          </button>
        </div>
      </div>

      {/* AUTO-CLEAN RESULT BANNER */}
      {autoCleanReport && (
        <div className="bg-emerald-950 text-white rounded-2xl p-5 border border-emerald-700 shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <h3 className="text-sm font-bold text-emerald-200 uppercase tracking-wider">
                Relatório de Higienização Automática Concluída!
              </h3>
            </div>
            <p className="text-xs text-emerald-100">
              Score Global evoluído de <strong>{autoCleanReport.previousHealthScore}</strong> para{' '}
              <strong className="text-emerald-300 text-sm">{autoCleanReport.newHealthScore}/100</strong> •{' '}
              <strong>{autoCleanReport.contactsMerged}</strong> par(es) de contatos unificados •{' '}
              <strong>{autoCleanReport.companiesMerged}</strong> par(es) de empresas unificadas •{' '}
              <strong>{autoCleanReport.recordsNormalized}</strong> registros padronizados (E.164/Domínio) •{' '}
              <strong>{autoCleanReport.recordsEnriched}</strong> registros enriquecidos!
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAutoCleanReport(null)}
            className="text-xs text-emerald-300 hover:text-white self-end sm:self-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* RECOMMENDATIONS BAR */}
      {summary.recommendations.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
            Plano de Higienização Recomendado pelo Motor Data Health
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {summary.recommendations.map((rec, i) => (
              <div
                key={i}
                className="flex items-start gap-2.5 p-3 rounded-xl bg-orange-50/50 border border-orange-200/70 text-xs text-slate-800"
              >
                <AlertTriangle className="w-4 h-4 text-[#ff7a59] shrink-0 mt-0.5" />
                <span>{rec}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AUDITORIA HUBSPOT SETA TELECOM (4369067): REATRIBUIÇÃO DE 41 EX-VENDEDORES INATIVOS */}
      <div className="bg-white rounded-2xl border-2 border-[#ff7a59]/50 p-5 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-[#ff7a59]/15 text-[#e05835] border border-[#ff7a59]/30">
              AUDITORIA PORTAL HUBSPOT 4369067 • SETA TELECOM
            </span>
            <span className="text-xs font-bold text-slate-500">
              44 proprietários mapeados (3 ativos hoje vs. 41 ex-vendedores inativos)
            </span>
          </div>
          <h3 className="text-sm sm:text-base font-extrabold text-slate-900">
            Reatribuição em 1 Clique de Carteira Órfã de Ex-Vendedores Inativos
          </h3>
          <p className="text-xs text-slate-600">
            Transfira automaticamente contatos, empresas e negócios presos em ex-vendedores inativos (como <em>Gabriel Lopes</em>, <em>Roberto Carquejo</em>, <em>Felipe Seta</em>, <em>Karis Marketing</em>) para os proprietários ativos da Seta Telecom.
          </p>
          {reassignMsg && (
            <div className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg inline-block mt-1">
              ✅ {reassignMsg}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <select
            value={reassignTarget}
            onChange={(e) => setReassignTarget(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-800 bg-slate-50"
          >
            <option value="Marcelo Lopes Mira">Transferir p/ Marcelo Lopes Mira</option>
            <option value="Evelyn Ternero Seta Telecom">
              Transferir p/ Evelyn Ternero Seta Telecom
            </option>
          </select>

          <button
            type="button"
            disabled={reassigning}
            onClick={handleReassignOrphans}
            className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold shadow-sm transition cursor-pointer disabled:opacity-50"
          >
            {reassigning ? 'Transferindo Carteira...' : 'Reatribuir Carteira Órfã Agora'}
          </button>
        </div>
      </div>

      {/* NAVIGATION TABS FOR HEALTH CATEGORIES */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
        <button
          type="button"
          onClick={() => setActiveIssueTab('DUPLICATES')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition ${
            activeIssueTab === 'DUPLICATES'
              ? 'bg-[#1e293b] text-white shadow-xs'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <GitMerge className="w-4 h-4 text-[#ff7a59]" />
          Pares Duplicados ({duplicates?.totalDuplicates ?? 0})
        </button>

        <button
          type="button"
          onClick={() => setActiveIssueTab('INCOMPLETE')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition ${
            activeIssueTab === 'INCOMPLETE'
              ? 'bg-[#1e293b] text-white shadow-xs'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <FileWarning className="w-4 h-4 text-amber-500" />
          Registros Incompletos ({incompleteContacts.length + incompleteCompanies.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveIssueTab('INVALID')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition ${
            activeIssueTab === 'INVALID'
              ? 'bg-[#1e293b] text-white shadow-xs'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <MailWarning className="w-4 h-4 text-rose-500" />
          E-mails / Telefones Inválidos ({invalidContacts.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveIssueTab('STALE')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition ${
            activeIssueTab === 'STALE'
              ? 'bg-[#1e293b] text-white shadow-xs'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Clock className="w-4 h-4 text-indigo-500" />
          Obsoletos &gt;90d &amp; Deal Rotting ({summary.staleRecords.length + summary.rottingDeals.length})
        </button>
      </div>

      {/* TAB 1: DUPLICATES SIDE-BY-SIDE COMPARISON & MERGE */}
      {activeIssueTab === 'DUPLICATES' && (
        <div className="space-y-6">
          {(!duplicates || duplicates.totalDuplicates === 0) ? (
            <div className="bg-white rounded-2xl border border-emerald-200 p-8 text-center space-y-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
              <h3 className="text-base font-bold text-slate-900">
                Zero Duplicidades Pendentes na Base!
              </h3>
              <p className="text-xs text-slate-500">
                Todos os contatos e empresas foram unificados com preservação integral de Timeline e Negócios.
              </p>
            </div>
          ) : (
            <>
              {/* Contact Duplicates */}
              {duplicates.contactDuplicates.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#ff7a59]" />
                    Duplicidades de Contatos Detectadas ({duplicates.contactDuplicates.length})
                  </h3>

                  {duplicates.contactDuplicates.map((pair) => {
                    const key = `CONTACT-${pair.primary.id}-${pair.duplicate.id}`;
                    const isMerging = mergingKey === key;

                    return (
                      <div
                        key={key}
                        className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
                      >
                        <div className="px-6 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5">
                            <span className="px-2.5 py-1 rounded-full text-xs font-extrabold bg-amber-100 text-amber-900 border border-amber-300">
                              Confiança: {pair.confidenceScore}%
                            </span>
                            <span className="text-xs font-semibold text-slate-700">
                              Motivos: {pair.matchReasons.join(' • ')}
                            </span>
                          </div>

                          <button
                            type="button"
                            disabled={isMerging}
                            onClick={() =>
                              handleMerge('CONTACT', pair.primary.id, pair.duplicate.id)
                            }
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-bold shadow-sm transition disabled:opacity-50"
                          >
                            <GitMerge className="w-4 h-4" />
                            {isMerging
                              ? 'Unificando Registros...'
                              : 'Mesclar Registros (Smart Merge)'}
                          </button>
                        </div>

                        <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
                          {/* Primary Record */}
                          <div className="p-4 rounded-xl border-2 border-emerald-200 bg-emerald-50/20 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px] uppercase">
                                Registro Principal (Mantido)
                              </span>
                              <span className="text-slate-500">
                                Completude: <strong>{pair.primary.completenessScore}%</strong>
                              </span>
                            </div>
                            <div className="text-sm font-bold text-slate-900">
                              {pair.primary.firstName} {pair.primary.lastName}
                            </div>
                            <div className="space-y-1 text-slate-600">
                              <div>
                                <strong>E-mail:</strong> {pair.primary.email}
                              </div>
                              <div>
                                <strong>Telefone:</strong> {pair.primary.phone || '—'}
                              </div>
                              <div>
                                <strong>Cargo:</strong> {pair.primary.jobTitle || '—'}
                              </div>
                              <div>
                                <strong>Estágio:</strong> {pair.primary.lifecycleStage} (Score{' '}
                                {pair.primary.leadScore})
                              </div>
                            </div>
                          </div>

                          {/* Duplicate Record */}
                          <div className="p-4 rounded-xl border border-rose-200 bg-rose-50/20 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold text-[10px] uppercase">
                                Registro Duplicado (Absorvido)
                              </span>
                              <span className="text-slate-500">
                                Completude: <strong>{pair.duplicate.completenessScore}%</strong>
                              </span>
                            </div>
                            <div className="text-sm font-bold text-slate-900">
                              {pair.duplicate.firstName} {pair.duplicate.lastName}
                            </div>
                            <div className="space-y-1 text-slate-600">
                              <div>
                                <strong>E-mail:</strong> {pair.duplicate.email}
                              </div>
                              <div>
                                <strong>Telefone:</strong> {pair.duplicate.phone || '—'}
                              </div>
                              <div>
                                <strong>Cargo:</strong> {pair.duplicate.jobTitle || '—'}
                              </div>
                              <div>
                                <strong>Estágio:</strong> {pair.duplicate.lifecycleStage} (Score{' '}
                                {pair.duplicate.leadScore})
                              </div>
                            </div>
                          </div>

                          {/* Suggested Unified Result */}
                          <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50/30 space-y-2">
                            <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 font-bold text-[10px] uppercase inline-block">
                              Resultado Pós-Merge (Sem Perda)
                            </span>
                            <div className="text-sm font-bold text-indigo-950">
                              {String(pair.suggestedMerge.mergedFields.firstName || '')}{' '}
                              {String(pair.suggestedMerge.mergedFields.lastName || '')}
                            </div>
                            <div className="space-y-1 text-slate-700">
                              <div>
                                <strong>E-mail Final:</strong>{' '}
                                {String(pair.suggestedMerge.mergedFields.email || '')}
                              </div>
                              <div>
                                <strong>Cargo Final:</strong>{' '}
                                {String(pair.suggestedMerge.mergedFields.jobTitle || '—')}
                              </div>
                              <div>
                                <strong>Histórico Movido:</strong>{' '}
                                {pair.suggestedMerge.timelineEventsToMove} evento(s) de timeline e{' '}
                                {pair.suggestedMerge.dealsToMove} negócio(s) preservados!
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* REGRA FISCAL DE PROTEÇÃO MATRIZ / FILIAL (CNPJs DISTINTOS NÃO UNIFICÁVEIS) */}
              <div className="bg-white rounded-2xl border border-indigo-200 p-5 shadow-xs space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-indigo-600" />
                    <div>
                      <h3 className="text-sm font-extrabold text-slate-900">
                        🛡️ Trava Fiscal Ativa: Empresas com CNPJs Diferentes Não Podem Ser Unificadas
                      </h3>
                      <p className="text-xs text-slate-500">
                        Mesmo que compartilhem o mesmo domínio corporativo ou razão social (ex: Matriz <code>/0001-</code> e Filial <code>/0002-</code>), CNPJs distintos possuem personalidade jurídica e faturamento próprios.
                      </p>
                    </div>
                  </div>
                  <span className="px-3 py-1 rounded-full text-[11px] font-extrabold bg-indigo-50 text-indigo-800 border border-indigo-200">
                    🛡️ CNPJs Distintos — Unificação Bloqueada (Matriz/Filial)
                  </span>
                </div>

                {protectedBranches.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    {protectedBranches.map((pb) => (
                      <div
                        key={`${pb.companyA.id}-${pb.companyB.id}`}
                        className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <div className="font-bold text-slate-900">
                            {pb.companyA.name} (<span className="font-mono text-indigo-700">{pb.companyA.cnpj}</span>)
                            {' '}×{' '}
                            {pb.companyB.name} (<span className="font-mono text-indigo-700">{pb.companyB.cnpj}</span>)
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {pb.sharedDomainOrGroup} • {pb.reason}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled
                          className="px-3 py-1.5 rounded-lg bg-slate-200 text-slate-500 text-xs font-extrabold cursor-not-allowed"
                        >
                          🛡️ CNPJs Distintos — Unificação Bloqueada
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Company Duplicates */}
              {duplicates.companyDuplicates.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-[#ff7a59]" />
                    Duplicidades de Empresas Detectadas ({duplicates.companyDuplicates.length})
                  </h3>

                  {duplicates.companyDuplicates.map((pair) => {
                    const key = `COMPANY-${pair.primary.id}-${pair.duplicate.id}`;
                    const isMerging = mergingKey === key;

                    return (
                      <div
                        key={key}
                        className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
                      >
                        <div className="px-6 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5">
                            <span className="px-2.5 py-1 rounded-full text-xs font-extrabold bg-amber-100 text-amber-900 border border-amber-300">
                              Confiança: {pair.confidenceScore}%
                            </span>
                            <span className="text-xs font-semibold text-slate-700">
                              Motivos: {pair.matchReasons.join(' • ')}
                            </span>
                          </div>

                          <button
                            type="button"
                            disabled={isMerging}
                            onClick={() =>
                              handleMerge('COMPANY', pair.primary.id, pair.duplicate.id)
                            }
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-bold shadow-sm transition disabled:opacity-50"
                          >
                            <GitMerge className="w-4 h-4" />
                            {isMerging
                              ? 'Unificando Empresas...'
                              : 'Mesclar Empresas (Smart Merge)'}
                          </button>
                        </div>

                        <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
                          <div className="p-4 rounded-xl border-2 border-emerald-200 bg-emerald-50/20 space-y-1.5">
                            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px] uppercase">
                              Empresa Principal ({pair.primary.completenessScore}%)
                            </span>
                            <div className="text-sm font-bold text-slate-900">
                              {pair.primary.name}
                            </div>
                            <div>
                              <strong>Domínio:</strong> {pair.primary.domain || '—'}
                            </div>
                            <div>
                              <strong>CNPJ:</strong> {pair.primary.cnpj || '—'}
                            </div>
                            <div>
                              <strong>Setor:</strong> {pair.primary.industry || '—'}
                            </div>
                          </div>

                          <div className="p-4 rounded-xl border border-rose-200 bg-rose-50/20 space-y-1.5">
                            <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold text-[10px] uppercase">
                              Empresa Duplicada ({pair.duplicate.completenessScore}%)
                            </span>
                            <div className="text-sm font-bold text-slate-900">
                              {pair.duplicate.name}
                            </div>
                            <div>
                              <strong>Domínio:</strong> {pair.duplicate.domain || '—'}
                            </div>
                            <div>
                              <strong>CNPJ:</strong> {pair.duplicate.cnpj || '—'}
                            </div>
                            <div>
                              <strong>Setor:</strong> {pair.duplicate.industry || '—'}
                            </div>
                          </div>

                          <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50/30 space-y-1.5">
                            <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 font-bold text-[10px] uppercase">
                              Conta Unificada
                            </span>
                            <div className="text-sm font-bold text-indigo-950">
                              {String(pair.suggestedMerge.mergedFields.name || '')}
                            </div>
                            <div>
                              <strong>CNPJ Validado:</strong>{' '}
                              {String(pair.suggestedMerge.mergedFields.cnpj || '—')}
                            </div>
                            <div>
                              <strong>Vínculos Preservados:</strong>{' '}
                              {pair.suggestedMerge.contactsToMove ?? 0} contato(s) e{' '}
                              {pair.suggestedMerge.dealsToMove} negócio(s)
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 2: INCOMPLETE CONTACTS & COMPANIES */}
      {activeIssueTab === 'INCOMPLETE' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-900">
              Contatos com Baixa Completude (&lt;65%) ({incompleteContacts.length})
            </h3>
            {incompleteContacts.length === 0 ? (
              <p className="text-xs text-slate-500">Todos os contatos possuem alta completude!</p>
            ) : (
              <div className="space-y-3">
                {incompleteContacts.map((c) => (
                  <div
                    key={c.id}
                    className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/20 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="text-xs font-bold text-slate-900">
                        {c.firstName} {c.lastName} ({c.completenessScore}%)
                      </div>
                      <div className="text-xs text-slate-500">{c.email}</div>
                      <div className="text-[11px] text-amber-800 mt-1">
                        Ausentes:{' '}
                        {[
                          !c.phone ? 'Telefone' : null,
                          !c.jobTitle ? 'Cargo' : null,
                          !c.companyId ? 'Empresa' : null,
                        ]
                          .filter(Boolean)
                          .join(', ')}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={enrichingEntityId === c.id}
                      onClick={async () => {
                        setEnrichingEntityId(c.id);
                        try {
                          await onEnrichEntity('CONTACT', c.id);
                        } finally {
                          setEnrichingEntityId(null);
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shrink-0 transition"
                    >
                      {enrichingEntityId === c.id ? 'Enriquecendo...' : 'Enriquecer Agora'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-900">
              Empresas Incompletas (&lt;65%) ({incompleteCompanies.length})
            </h3>
            {incompleteCompanies.length === 0 ? (
              <p className="text-xs text-slate-500">Todas as empresas possuem dados completos!</p>
            ) : (
              <div className="space-y-3">
                {incompleteCompanies.map((comp) => (
                  <div
                    key={comp.id}
                    className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/20 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="text-xs font-bold text-slate-900">
                        {comp.name} ({comp.completenessScore}%)
                      </div>
                      <div className="text-xs text-slate-500">{comp.domain || 'Sem domínio'}</div>
                      <div className="text-[11px] text-amber-800 mt-1">
                        Ausentes:{' '}
                        {[
                          !comp.cnpj ? 'CNPJ' : null,
                          !comp.industry ? 'Setor' : null,
                          !comp.size ? 'Porte' : null,
                        ]
                          .filter(Boolean)
                          .join(', ')}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={enrichingEntityId === comp.id}
                      onClick={async () => {
                        setEnrichingEntityId(comp.id);
                        try {
                          await onEnrichEntity('COMPANY', comp.id);
                        } finally {
                          setEnrichingEntityId(null);
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shrink-0 transition"
                    >
                      {enrichingEntityId === comp.id ? 'Enriquecendo...' : 'Enriquecer Conta'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: INVALID EMAILS & PHONES */}
      {activeIssueTab === 'INVALID' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-slate-900">
            Registros com E-mail Descartável / Inválido ou Telefone Fora do Padrão E.164 ({invalidContacts.length})
          </h3>
          {invalidContacts.length === 0 ? (
            <p className="text-xs text-slate-500">Nenhum e-mail ou telefone inválido encontrado.</p>
          ) : (
            <div className="space-y-3">
              {invalidContacts.map((c) => (
                <div
                  key={c.id}
                  className="p-4 rounded-xl border border-rose-200 bg-rose-50/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">
                        {c.firstName} {c.lastName}
                      </span>
                      {!c.isValidEmail && (
                        <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-bold">
                          E-mail Descartável / Inválido: {c.email}
                        </span>
                      )}
                      {c.phone && !c.isValidPhone && (
                        <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-bold">
                          Telefone Inválido: {c.phone}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600">
                      Cargo: {c.jobTitle || '—'} • Bloqueado preventivamente em disparos de cadência para proteger reputação do domínio.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigateToContact(c.id)}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 shrink-0"
                  >
                    Inspecionar Contato
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: STALE RECORDS (>90 DAYS) & ROTTING DEALS */}
      {activeIssueTab === 'STALE' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-900">
              Registros Obsoletos (&gt;90 dias sem interação) ({summary.staleRecords.length})
            </h3>
            {summary.staleRecords.map((rec) => (
              <div
                key={`${rec.entityType}-${rec.entityId}`}
                className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between gap-3 text-xs"
              >
                <div>
                  <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px] font-bold mr-2">
                    {rec.entityType}
                  </span>
                  <strong className="text-slate-900">{rec.name}</strong>
                  <div className="text-slate-500 mt-0.5">
                    {rec.emailOrDomain || '—'} • Inativo há{' '}
                    <strong className="text-rose-600">{rec.daysInactive} dias</strong>
                  </div>
                </div>
                {rec.entityType === 'CONTACT' && (
                  <button
                    type="button"
                    onClick={() => onNavigateToContact(rec.entityId)}
                    className="px-2.5 py-1 rounded-lg bg-slate-900 text-white font-semibold text-[11px]"
                  >
                    Reengajar
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-900">
              Negócios Estagnados (Deal Rotting) ({summary.rottingDeals.length})
            </h3>
            {summary.rottingDeals.map((deal) => (
              <div
                key={deal.dealId}
                className="p-3.5 rounded-xl border border-rose-200 bg-rose-50/20 flex items-center justify-between gap-3 text-xs"
              >
                <div>
                  <div className="font-bold text-slate-900">{deal.title}</div>
                  <div className="text-slate-600 mt-0.5">
                    Etapa: <strong>{deal.stageName}</strong> • {deal.daysSinceLastActivity}d sem atividade (SLA:{' '}
                    {deal.dealRottingDays}d)
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-extrabold text-rose-700">{formatBRL(deal.value)}</div>
                  <div className="text-[10px] text-rose-600 font-semibold">
                    +{deal.daysOverdue}d atrasado
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
