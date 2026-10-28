'use client';

import React, { useState, useEffect } from 'react';
import { Sparkles, CheckCircle2, X, Zap, Pencil, Save, Trash2 } from 'lucide-react';
import {
  BuyingRoleType,
  Company,
  Contact,
  Deal,
  LeadStatus,
  LifecycleStage,
  TimelineEvent,
} from '../../db/types';
import { CompletenessResult } from '../../modules/data-health/completeness';
import { CrmTask } from '../../db/types';
import { HubSpotCardEmailComposer, HubSpotRecordTasksSection } from './HubSpotEmailAndTasksPanel';
import {
  BUYING_ROLE_OPTIONS,
  SETA_OWNER_OPTIONS,
  formatBRL,
  formatDateTimeBR,
  formatRelativeDays,
  getBuyingRoleBadge,
  getBuyingRoleLabel,
  getIcpTierBadge,
  getLifecycleBadge,
} from './ui-helpers';

export interface DetailedContactResponse extends Contact {
  company: Company | null;
  deals: Deal[];
  timeline: TimelineEvent[];
  tasks?: CrmTask[];
  completenessDetail: CompletenessResult;
}

interface ContactDetailDrawerProps {
  contactDetail: DetailedContactResponse | null;
  companies: Company[];
  allContacts?: Contact[];
  onRefreshContact?: () => Promise<void> | void;
  loadingDetail: boolean;
  enrichingId: string | null;
  enrichmentFeedback: string | null;
  initialEditMode?: boolean;
  onClose: () => void;
  onSingleEnrich: (contactId: string) => Promise<void>;
  onUpdateContact: (contactId: string, patch: Record<string, unknown>) => Promise<void>;
  onDeleteContact: (contactId: string) => Promise<void>;
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
  companies,
  allContacts = [],
  onRefreshContact,
  loadingDetail,
  enrichingId,
  enrichmentFeedback,
  initialEditMode = false,
  onClose,
  onSingleEnrich,
  onUpdateContact,
  onDeleteContact,
  onAddContactActivity,
}: ContactDetailDrawerProps) {
  const [isEditing, setIsEditing] = useState(initialEditMode);
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Edit form fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [lifecycleStage, setLifecycleStage] = useState<LifecycleStage>('LEAD');
  const [leadStatus, setLeadStatus] = useState<LeadStatus>('NEW');
  const [buyingRole, setBuyingRole] = useState<BuyingRoleType>('DECISOR');
  const [isUnworked, setIsUnworked] = useState<boolean>(false);
  const [ownerName, setOwnerName] = useState('Marcelo Lopes Mira');
  const [city, setCity] = useState('');
  const [stateUf, setStateUf] = useState('');

  const [actType, setActType] = useState<'NOTE' | 'CALL' | 'EMAIL' | 'MEETING' | 'TASK'>('NOTE');
  const [actTitle, setActTitle] = useState('');
  const [actBody, setActBody] = useState('');
  const [savingActivity, setSavingActivity] = useState(false);

  useEffect(() => {
    setIsEditing(initialEditMode);
    setConfirmDelete(false);
  }, [initialEditMode, contactDetail?.id]);

  useEffect(() => {
    if (contactDetail) {
      setFirstName(contactDetail.firstName || '');
      setLastName(contactDetail.lastName || '');
      setEmail(contactDetail.email || '');
      setPhone(contactDetail.phone || '');
      setJobTitle(contactDetail.jobTitle || '');
      setCompanyId(contactDetail.companyId || '');
      setLifecycleStage(contactDetail.lifecycleStage || 'LEAD');
      setLeadStatus(contactDetail.leadStatus || 'NEW');
      setBuyingRole(contactDetail.buyingRole || 'DECISOR');
      setIsUnworked(Boolean(contactDetail.isUnworked));
      const props = contactDetail.customProperties || {};
      setOwnerName(
        String(
          contactDetail.ownerName ||
            props.ownerName ||
            contactDetail.ownerId ||
            'Marcelo Lopes Mira'
        )
      );
      setCity(String(props.city || contactDetail.company?.city || ''));
      setStateUf(String(props.state || contactDetail.company?.state || ''));
    }
  }, [contactDetail]);

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactDetail || !firstName.trim() || !email.trim()) return;
    setSavingEdit(true);
    try {
      const cleanOwner = ownerName.trim() || 'Marcelo Lopes Mira';
      await onUpdateContact(contactDetail.id, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
        jobTitle: jobTitle.trim() || null,
        companyId: companyId || null,
        lifecycleStage,
        leadStatus,
        buyingRole,
        isUnworked,
        ownerId: cleanOwner.toLowerCase().includes('evelyn')
          ? 'owner-evelyn'
          : 'owner-marcello',
        ownerName: cleanOwner,
        city: city.trim() || undefined,
        state: stateUf.trim() || undefined,
      });
      setIsEditing(false);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!contactDetail) return;
    setDeleting(true);
    try {
      await onDeleteContact(contactDetail.id);
      onClose();
    } finally {
      setDeleting(false);
    }
  };

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
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex justify-end">
      <div className="bg-white w-full max-w-2xl h-full shadow-2xl border-l border-slate-200 flex flex-col overflow-hidden">
        <div className="px-4 sm:px-6 py-4 bg-[#1e293b] text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-[#ff7a59] text-white font-normal flex items-center justify-center text-sm shrink-0">
              {contactDetail?.firstName?.charAt(0) || 'C'}
              {contactDetail?.lastName?.charAt(0) || ''}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-white truncate">
                  {contactDetail
                    ? `${contactDetail.firstName} ${contactDetail.lastName}`
                    : 'Carregando contato...'}
                </h3>
                {contactDetail && getLifecycleBadge(contactDetail.lifecycleStage)}
                {contactDetail?.buyingRole && getBuyingRoleBadge(contactDetail.buyingRole)}
                {contactDetail?.isUnworked && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-normal bg-amber-400 text-slate-950">
                    Lead Intocado
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-300 mt-0.5 truncate">
                {contactDetail?.jobTitle || 'Cargo não informado'}{' '}
                {contactDetail?.company ? `• ${contactDetail.company.name}` : ''}
                {contactDetail?.ownerName ? ` • Carteira: ${contactDetail.ownerName}` : ''}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-end sm:self-auto">
            {contactDetail && (
              <>
                <button
                  type="button"
                  onClick={() => setIsEditing((v) => !v)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-normal transition ${
                    isEditing
                      ? 'bg-amber-500 text-white'
                      : 'bg-white text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <Pencil className="w-3.5 h-3.5" />
                  {isEditing ? 'Fechar Edição' : 'Editar Contato'}
                </button>
                <button
                  type="button"
                  disabled={enrichingId === contactDetail.id}
                  onClick={() => onSingleEnrich(contactDetail.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-normal transition disabled:opacity-50"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {enrichingId === contactDetail.id ? 'Enriquecendo...' : 'Enriquecer'}
                </button>
              </>
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

        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-6">
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

              {/* EDIT FORM MODE */}
              {isEditing && (
                <form
                  onSubmit={handleSaveEdit}
                  className="p-5 rounded-2xl border-2 border-[#ff7a59] bg-orange-50/30 space-y-4 shadow-sm"
                >
                  <div className="flex items-center justify-between border-b border-orange-200/70 pb-3">
                    <div className="flex items-center gap-2">
                      <Pencil className="w-4 h-4 text-[#ff7a59]" />
                      <h4 className="text-sm font-semibold text-slate-900">
                        Editar Dados do Contato &amp; Papel ABM
                      </h4>
                    </div>
                    <span className="text-[11px] font-normal text-slate-500">
                      Recálculo automático de Score &amp; Completude
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-[11px] font-normal uppercase text-slate-600 mb-1">
                        Nome *
                      </label>
                      <input
                        type="text"
                        required
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-[#ff7a59]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-normal uppercase text-slate-600 mb-1">
                        Sobrenome
                      </label>
                      <input
                        type="text"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-[#ff7a59]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-[11px] font-normal uppercase text-slate-600 mb-1">
                        E-mail Corporativo *
                      </label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-[#ff7a59]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-normal uppercase text-slate-600 mb-1">
                        Telefone / WhatsApp
                      </label>
                      <input
                        type="text"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="(11) 98888-7766"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-[#ff7a59]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-[11px] font-normal uppercase text-slate-600 mb-1">
                        Cargo Executivo
                      </label>
                      <input
                        type="text"
                        value={jobTitle}
                        onChange={(e) => setJobTitle(e.target.value)}
                        placeholder="Ex: Diretor de TI / CTO"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-[#ff7a59]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-normal uppercase text-slate-600 mb-1">
                        Empresa Vinculada
                      </label>
                      <select
                        value={companyId}
                        onChange={(e) => setCompanyId(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-[#ff7a59]"
                      >
                        <option value="">Sem empresa vinculada</option>
                        {companies.map((comp) => (
                          <option key={comp.id} value={comp.id}>
                            {comp.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-[11px] font-normal uppercase text-slate-600 mb-1">
                        Papel de Compra ABM (Buying Role)
                      </label>
                      <select
                        value={buyingRole}
                        onChange={(e) => setBuyingRole(e.target.value as BuyingRoleType)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-normal text-slate-900 focus:outline-none focus:border-[#ff7a59]"
                      >
                        {BUYING_ROLE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-normal uppercase text-slate-600 mb-1">
                        Proprietário da Carteira (Owner Seta)
                      </label>
                      <input
                        type="text"
                        list="seta-owners-drawer-list"
                        value={ownerName}
                        onChange={(e) => setOwnerName(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-[#ff7a59]"
                      />
                      <datalist id="seta-owners-drawer-list">
                        {SETA_OWNER_OPTIONS.map((ow) => (
                          <option key={ow} value={ow} />
                        ))}
                      </datalist>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-[11px] font-normal uppercase text-slate-600 mb-1">
                        Estágio do Funil (Lifecycle)
                      </label>
                      <select
                        value={lifecycleStage}
                        onChange={(e) => setLifecycleStage(e.target.value as LifecycleStage)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-[#ff7a59]"
                      >
                        <option value="SUBSCRIBER">Assinante</option>
                        <option value="LEAD">Lead</option>
                        <option value="MQL">MQL</option>
                        <option value="SQL">SQL Qualificado</option>
                        <option value="OPPORTUNITY">Oportunidade</option>
                        <option value="CUSTOMER">Cliente Ativo</option>
                        <option value="EVANGELIST">Promotor</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-normal uppercase text-slate-600 mb-1">
                        Status do Lead
                      </label>
                      <select
                        value={leadStatus}
                        onChange={(e) => setLeadStatus(e.target.value as LeadStatus)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-[#ff7a59]"
                      >
                        <option value="NEW">Novo</option>
                        <option value="OPEN">Aberto</option>
                        <option value="IN_PROGRESS">Em Andamento</option>
                        <option value="OPEN_DEAL">Negócio Aberto</option>
                        <option value="ATTEMPTED_TO_CONTACT">Tentativa de Contato</option>
                        <option value="CONNECTED">Conectado</option>
                        <option value="BAD_TIMING">Timing Futuro</option>
                        <option value="UNQUALIFIED">Desqualificado</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 items-end">
                    <div>
                      <label className="block text-[11px] font-normal uppercase text-slate-600 mb-1">
                        Cidade
                      </label>
                      <input
                        type="text"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        placeholder="São Paulo"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-[#ff7a59]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-normal uppercase text-slate-600 mb-1">
                        UF
                      </label>
                      <input
                        type="text"
                        value={stateUf}
                        onChange={(e) => setStateUf(e.target.value)}
                        placeholder="SP"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-[#ff7a59]"
                      />
                    </div>
                    <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-amber-300 bg-amber-50/70 text-xs font-normal text-amber-950 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isUnworked}
                        onChange={(e) => setIsUnworked(e.target.checked)}
                        className="rounded border-amber-400 text-[#ff7a59] focus:ring-[#ff7a59]"
                      />
                      <span>Lead Intocado (Unworked)</span>
                    </label>
                  </div>

                  <div className="pt-3 border-t border-orange-200/70 flex flex-wrap items-center justify-between gap-2">
                    {!confirmDelete ? (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-rose-700 hover:bg-rose-100 text-xs font-normal transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Excluir Contato
                      </button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-normal text-rose-700">Confirmar exclusão?</span>
                        <button
                          type="button"
                          disabled={deleting}
                          onClick={handleConfirmDelete}
                          className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-normal"
                        >
                          {deleting ? 'Excluindo...' : 'Sim, Excluir'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(false)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-normal text-slate-700 bg-white"
                        >
                          Não
                        </button>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsEditing(false)}
                        className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs font-normal text-slate-700 hover:bg-slate-50"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={savingEdit}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-normal shadow-sm transition disabled:opacity-50"
                      >
                        <Save className="w-3.5 h-3.5" />
                        {savingEdit ? 'Salvando...' : 'Salvar Alterações'}
                      </button>
                    </div>
                  </div>
                </form>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-normal uppercase text-slate-500">
                      Lead Score Preditivo
                    </span>
                    <span className="text-lg font-normal text-emerald-600">
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
                    <span className="text-xs font-normal uppercase text-slate-500">
                      Índice de Completude
                    </span>
                    <span className="text-lg font-normal text-indigo-600">
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
                      <span className="text-[11px] font-normal uppercase tracking-wider text-[#e05835]">
                        Próxima Melhor Ação Recomendada (Next Best Action)
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-normal bg-orange-100 text-[#e05835]">
                        Prioridade {contactDetail.nextBestAction.priority} • Prazo:{' '}
                        {contactDetail.nextBestAction.suggestedDueInDays}d
                      </span>
                    </div>
                    <h4 className="text-sm font-semibold text-slate-900">
                      {contactDetail.nextBestAction.title}
                    </h4>
                    <p className="text-xs text-slate-600">{contactDetail.nextBestAction.reason}</p>
                  </div>
                </div>
              )}

              <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Dados Cadastrais, Papel ABM &amp; Smart Data
                  </h4>
                  {!isEditing && (
                    <button
                      type="button"
                      onClick={() => setIsEditing(true)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-orange-50 hover:bg-orange-100 text-[#e05835] border border-orange-200 text-xs font-normal transition"
                    >
                      <Pencil className="w-3 h-3" />
                      Editar Campos
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  <div>
                    <span className="text-slate-400 block">E-mail</span>
                    <span className="font-normal text-slate-800 break-all">
                      {contactDetail.email}
                    </span>
                    <span
                      className={`inline-block mt-0.5 text-[10px] font-normal ${
                        contactDetail.isValidEmail ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {contactDetail.isValidEmail
                        ? contactDetail.isCorporateEmail
                          ? 'Corporativo Válido'
                          : 'Pessoal Válido'
                        : 'E-mail Inválido/Descartável'}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block">Telefone (Padrão E.164)</span>
                    <span className="font-normal text-slate-800">
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
                    <span className="font-normal text-slate-800">
                      {contactDetail.jobTitle || '—'}
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      {contactDetail.seniority || '—'} • Dept: {contactDetail.department || '—'}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block">Papel de Compra (ABM)</span>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      {contactDetail.buyingRole
                        ? getBuyingRoleBadge(contactDetail.buyingRole)
                        : <span className="font-normal text-slate-700">{getBuyingRoleLabel(contactDetail.buyingRole)}</span>}
                      {contactDetail.isUnworked && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-normal">
                          Intocado
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    <span className="text-slate-400 block">Proprietário da Carteira</span>
                    <span className="font-normal text-slate-800">
                      {contactDetail.ownerName ||
                        (contactDetail.customProperties?.ownerName as string) ||
                        'Marcelo Lopes Mira'}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block">Empresa Vinculada</span>
                    <span className="font-normal text-slate-800 block">
                      {contactDetail.company?.name || 'Não vinculada'}
                    </span>
                    {contactDetail.company && (
                      <div className="flex flex-wrap items-center gap-1 mt-0.5">
                        {contactDetail.company.isTargetAccount && (
                          <span className="px-1.5 py-0.5 rounded bg-orange-50 text-[#e05835] border border-orange-200 text-[10px] font-normal">
                            Conta Alvo ABM
                          </span>
                        )}
                        {contactDetail.company.icpTier && getIcpTierBadge(contactDetail.company.icpTier)}
                      </div>
                    )}
                  </div>

                  <div>
                    <span className="text-slate-400 block">Fonte de Enriquecimento</span>
                    <span className="font-normal text-indigo-700">
                      {contactDetail.enrichmentSource || 'Manual / Não enriquecido'}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block">Última Interação</span>
                    <span className="font-normal text-slate-800">
                      {formatRelativeDays(contactDetail.lastActivityAt)}
                    </span>
                  </div>
                </div>

                {Object.keys(contactDetail.customProperties || {}).length > 0 && (
                  <div className="pt-3 border-t border-slate-100">
                    <span className="text-[11px] font-normal text-slate-500 block mb-1.5">
                      Propriedades Customizadas &amp; Inferidas:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(contactDetail.customProperties).map(([k, v]) => (
                        <span
                          key={k}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-medium"
                        >
                          <span>{k}:</span> {String(v)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
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
                          <div className="font-normal text-slate-900">{d.title}</div>
                          <div className="text-slate-500">
                            Status: {d.status} • Probabilidade: {d.probability}%
                          </div>
                        </div>
                        <div className="text-sm font-normal text-slate-900">
                          {formatBRL(d.value)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* HUBSPOT EMAIL COMPOSER (WITH TEMPLATES, SNIPPETS & FOLLOW-UP TASK) */}
              <HubSpotCardEmailComposer
                primaryContact={contactDetail}
                company={contactDetail.company}
                linkedContacts={
                  contactDetail.companyId
                    ? allContacts.filter((c) => c.companyId === contactDetail.companyId)
                    : []
                }
                allContacts={allContacts}
                onSent={() => {
                  onRefreshContact?.();
                }}
              />

              {/* HUBSPOT TASKS & FOLLOW-UP SECTION FOR THIS CONTACT */}
              <HubSpotRecordTasksSection
                contactId={contactDetail.id}
                companyId={contactDetail.companyId}
                defaultAssignee={contactDetail.ownerName || "Marcelo Lopes Mira"}
                initialTasks={contactDetail.tasks}
                onTasksChanged={() => {
                  onRefreshContact?.();
                }}
              />

              <form
                onSubmit={handleAddActivitySubmit}
                className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-normal uppercase text-slate-700">
                    Registrar Interação na Timeline
                  </span>
                  <select
                    value={actType}
                    onChange={(e) =>
                      setActType(e.target.value as 'NOTE' | 'CALL' | 'EMAIL' | 'MEETING' | 'TASK')
                    }
                    className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-xs font-normal text-slate-700"
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
                    className="px-4 py-1.5 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-normal transition"
                  >
                    {savingActivity ? 'Salvando...' : 'Adicionar à Timeline'}
                  </button>
                </div>
              </form>

              <div className="space-y-2.5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Timeline Unificada de Interações ({contactDetail.timeline?.length || 0})
                </h4>
                {contactDetail.timeline?.map((evt) => (
                  <div
                    key={evt.id}
                    className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1"
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-normal">
                        {evt.type}
                      </span>
                      <span className="text-slate-400">{formatDateTimeBR(evt.createdAt)}</span>
                    </div>
                    <div className="text-xs font-normal text-slate-900">{evt.title}</div>
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
