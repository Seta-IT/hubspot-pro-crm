'use client';

import React, { useState, useEffect } from 'react';
import {
  Users,
  Building2,
  Search,
  Sparkles,
  Plus,
  CheckCircle2,
  ArrowUpRight,
  X,
  Globe,
  Zap,
  Pencil,
  Save,
  Trash2,
} from 'lucide-react';
import { Company, Contact, Deal, LifecycleStage, TimelineEvent } from '../../db/types';
import { CompletenessResult } from '../../modules/data-health/completeness';
import ContactDetailDrawer, { DetailedContactResponse } from './ContactDetailDrawer';
import {
  formatBRL,
  formatDateTimeBR,
  getLeadStatusLabel,
  getLifecycleBadge,
  getScoreColorClasses,
} from './ui-helpers';

export interface EnrichedContactItem extends Contact {
  company?: Company | null;
}

export interface EnrichedCompanyItem extends Company {
  contactsCount?: number;
  dealsCount?: number;
  totalDealValue?: number;
}

export interface DetailedCompanyResponse extends Company {
  contacts: Contact[];
  deals: Deal[];
  timeline: TimelineEvent[];
  completenessDetail: CompletenessResult;
}

interface ContactsCompaniesTabProps {
  onUpdateContact: (contactId: string, patch: Record<string, unknown>) => Promise<void>;
  onDeleteContact: (contactId: string) => Promise<void>;
  onUpdateCompany: (companyId: string, patch: Record<string, unknown>) => Promise<void>;
  onDeleteCompany: (companyId: string) => Promise<void>;
  contacts: EnrichedContactItem[];
  companies: EnrichedCompanyItem[];
  initialSelectedContactId?: string | null;
  onClearInitialContact?: () => void;
  onCreateContact: (payload: {
    email: string;
    firstName: string;
    lastName?: string;
    phone?: string;
    jobTitle?: string;
    lifecycleStage?: LifecycleStage;
    companyId?: string;
  }) => Promise<void>;
  onCreateCompany: (payload: {
    name: string;
    domain?: string;
    cnpj?: string;
    industry?: string;
    size?: string;
    annualRevenue?: number;
    city?: string;
    state?: string;
  }) => Promise<void>;
  onEnrichContact: (contactId: string) => Promise<{
    fieldsUpdated: string[];
    domain: string | null;
    source: string | null;
  } | null>;
  onEnrichCompany: (companyId: string) => Promise<{
    fieldsUpdated: string[];
    source: string | null;
  } | null>;
  onBatchEnrichAll: () => Promise<{ enrichedCount: number; totalScanned: number } | null>;
  onAddContactActivity: (payload: {
    contactId: string;
    companyId?: string | null;
    type: 'NOTE' | 'CALL' | 'EMAIL' | 'MEETING' | 'TASK';
    title: string;
    body?: string;
  }) => Promise<void>;
}

export default function ContactsCompaniesTab({
  contacts,
  companies,
  initialSelectedContactId,
  onClearInitialContact,
  onCreateContact,
  onUpdateContact,
  onDeleteContact,
  onCreateCompany,
  onUpdateCompany,
  onDeleteCompany,
  onEnrichContact,
  onEnrichCompany,
  onBatchEnrichAll,
  onAddContactActivity,
}: ContactsCompaniesTabProps) {
  const [subView, setSubView] = useState<'CONTACTS' | 'COMPANIES'>('CONTACTS');
  const [searchQuery, setSearchQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('ALL');
  const [minScoreFilter, setMinScoreFilter] = useState<number>(0);

  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [contactInitialEdit, setContactInitialEdit] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [companyDetail, setCompanyDetail] = useState<DetailedCompanyResponse | null>(null);
  const [loadingCompanyDetail, setLoadingCompanyDetail] = useState(false);
  const [editCompName, setEditCompName] = useState('');
  const [editCompDomain, setEditCompDomain] = useState('');
  const [editCompCnpj, setEditCompCnpj] = useState('');
  const [editCompIndustry, setEditCompIndustry] = useState('');
  const [editCompSize, setEditCompSize] = useState('201-500 funcionários');
  const [editCompRevenue, setEditCompRevenue] = useState('');
  const [editCompCity, setEditCompCity] = useState('');
  const [editCompState, setEditCompState] = useState('');
  const [editCompTier, setEditCompTier] = useState('ENTERPRISE');
  const [editCompOwner, setEditCompOwner] = useState('Marcéllo Mira');
  const [savingCompanyEdit, setSavingCompanyEdit] = useState(false);
  const [confirmCompanyDelete, setConfirmCompanyDelete] = useState(false);
  const [deletingCompany, setDeletingCompany] = useState(false);
  const [contactDetail, setContactDetail] = useState<DetailedContactResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [enrichmentFeedback, setEnrichmentFeedback] = useState<string | null>(null);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [batchEnriching, setBatchEnriching] = useState(false);

  const [domainInput, setDomainInput] = useState('');
  const [domainPreview, setDomainPreview] = useState<{
    isCorporate: boolean;
    domain: string | null;
    adapterName: string | null;
    profile: {
      name: string;
      cnpj: string;
      industry: string;
      size: string;
      annualRevenue: number;
      city: string;
      state: string;
    } | null;
  } | null>(null);
  const [lookingUpDomain, setLookingUpDomain] = useState(false);

  const [showNewContactModal, setShowNewContactModal] = useState(false);
  const [cFirstName, setCFirstName] = useState('');
  const [cLastName, setCLastName] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cJobTitle, setCJobTitle] = useState('');
  const [cStage, setCStage] = useState<LifecycleStage>('LEAD');
  const [cCompanyId, setCCompanyId] = useState('');
  const [savingContact, setSavingContact] = useState(false);

  const [showNewCompanyModal, setShowNewCompanyModal] = useState(false);
  const [compName, setCompName] = useState('');
  const [compDomain, setCompDomain] = useState('');
  const [compCnpj, setCompCnpj] = useState('');
  const [compIndustry, setCompIndustry] = useState('');
  const [compSize, setCompSize] = useState('201-500 funcionários');
  const [compRevenue, setCompRevenue] = useState('50000000');
  const [compCity, setCompCity] = useState('São Paulo');
  const [compState, setCompState] = useState('SP');
  const [savingCompany, setSavingCompany] = useState(false);

  const fetchContactDetail = async (id: string) => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/contacts/${id}`);
      if (res.ok) {
        const json = await res.json();
        setContactDetail(json.data);
      }
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => {
    if (initialSelectedContactId) {
      setSubView('CONTACTS');
      setSelectedContactId(initialSelectedContactId);
      fetchContactDetail(initialSelectedContactId);
      onClearInitialContact?.();
    }
  }, [initialSelectedContactId]);

  const fetchCompanyDetail = async (id: string) => {
    setLoadingCompanyDetail(true);
    try {
      const res = await fetch(`/api/companies/${id}`);
      if (res.ok) {
        const json = await res.json();
        const data: DetailedCompanyResponse = json.data;
        setCompanyDetail(data);
        setEditCompName(data.name || '');
        setEditCompDomain(data.domain || '');
        setEditCompCnpj(data.cnpj || '');
        setEditCompIndustry(data.industry || '');
        setEditCompSize(data.size || '201-500 funcionários');
        setEditCompRevenue(data.annualRevenue !== null && data.annualRevenue !== undefined ? String(data.annualRevenue) : '');
        setEditCompCity(data.city || '');
        setEditCompState(data.state || '');
        const props = data.customProperties || {};
        setEditCompTier(String(props.tier || 'ENTERPRISE'));
        setEditCompOwner(String(props.accountExecutive || props.accountOwner || 'Marcéllo Mira'));
      }
    } finally {
      setLoadingCompanyDetail(false);
    }
  };

  const handleSelectContact = (id: string, openInEditMode = false) => {
    setContactInitialEdit(openInEditMode);
    setSelectedContactId(id);
    setEnrichmentFeedback(null);
    fetchContactDetail(id);
  };

  const handleSelectCompany = (id: string) => {
    setSelectedCompanyId(id);
    setConfirmCompanyDelete(false);
    setEnrichmentFeedback(null);
    fetchCompanyDetail(id);
  };

  const handleSaveCompanyEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompanyId || !editCompName.trim()) return;
    setSavingCompanyEdit(true);
    try {
      await onUpdateCompany(selectedCompanyId, {
        name: editCompName.trim(),
        domain: editCompDomain.trim() || null,
        cnpj: editCompCnpj.trim() || null,
        industry: editCompIndustry.trim() || null,
        size: editCompSize.trim() || null,
        sizeRange: editCompSize.trim() || null,
        annualRevenue: editCompRevenue.trim() ? Number(editCompRevenue) : null,
        annualRevenueBrl: editCompRevenue.trim() ? Number(editCompRevenue) : null,
        city: editCompCity.trim() || null,
        state: editCompState.trim() || null,
        tier: editCompTier,
        accountOwner: editCompOwner.trim() || 'Marcéllo Mira',
      });
      await fetchCompanyDetail(selectedCompanyId);
    } finally {
      setSavingCompanyEdit(false);
    }
  };

  const handleConfirmCompanyDelete = async () => {
    if (!selectedCompanyId) return;
    setDeletingCompany(true);
    try {
      await onDeleteCompany(selectedCompanyId);
      setSelectedCompanyId(null);
      setCompanyDetail(null);
    } finally {
      setDeletingCompany(false);
    }
  };

  const handleSingleEnrich = async (contactId: string) => {
    setEnrichingId(contactId);
    setEnrichmentFeedback(null);
    try {
      const result = await onEnrichContact(contactId);
      if (result) {
        const msg =
          result.fieldsUpdated.length > 0
            ? `Enriquecimento concluído via ${result.source || 'Catálogo Corporativo'}! Campos atualizados: ${result.fieldsUpdated.join(', ')}.`
            : `Registro validado no domínio ${result.domain || 'corporativo'} (todos os campos já estavam completos).`;
        setEnrichmentFeedback(msg);
      }
      if (selectedContactId === contactId) {
        await fetchContactDetail(contactId);
      }
    } finally {
      setEnrichingId(null);
    }
  };

  const handleBatchEnrich = async () => {
    setBatchEnriching(true);
    setEnrichmentFeedback(null);
    try {
      const res = await onBatchEnrichAll();
      if (res) {
        setEnrichmentFeedback(
          `Enriquecimento em lote concluído: ${res.enrichedCount} de ${res.totalScanned} contatos enriquecidos automaticamente.`
        );
      }
      if (selectedContactId) {
        await fetchContactDetail(selectedContactId);
      }
    } finally {
      setBatchEnriching(false);
    }
  };

  const handleLookupDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domainInput.trim()) return;
    setLookingUpDomain(true);
    try {
      const res = await fetch('/api/enrichment/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: domainInput.trim() }),
      });
      if (res.ok) {
        const json = await res.json();
        setDomainPreview(json.data);
      }
    } finally {
      setLookingUpDomain(false);
    }
  };

  const handleCreateContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cEmail.trim() || !cFirstName.trim()) return;
    setSavingContact(true);
    try {
      await onCreateContact({
        email: cEmail.trim(),
        firstName: cFirstName.trim(),
        lastName: cLastName.trim() || undefined,
        phone: cPhone.trim() || undefined,
        jobTitle: cJobTitle.trim() || undefined,
        lifecycleStage: cStage,
        companyId: cCompanyId || undefined,
      });
      setCFirstName('');
      setCLastName('');
      setCEmail('');
      setCPhone('');
      setCJobTitle('');
      setCCompanyId('');
      setShowNewContactModal(false);
    } finally {
      setSavingContact(false);
    }
  };

  const handleCreateCompanySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!compName.trim()) return;
    setSavingCompany(true);
    try {
      await onCreateCompany({
        name: compName.trim(),
        domain: compDomain.trim() || undefined,
        cnpj: compCnpj.trim() || undefined,
        industry: compIndustry.trim() || undefined,
        size: compSize.trim() || undefined,
        annualRevenue: Number(compRevenue) || undefined,
        city: compCity.trim() || undefined,
        state: compState.trim() || undefined,
      });
      setCompName('');
      setCompDomain('');
      setCompCnpj('');
      setCompIndustry('');
      setShowNewCompanyModal(false);
    } finally {
      setSavingCompany(false);
    }
  };

  const filteredContacts = contacts.filter((c) => {
    if (stageFilter !== 'ALL' && c.lifecycleStage !== stageFilter) return false;
    if (minScoreFilter > 0 && c.leadScore < minScoreFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const fullName = `${c.firstName} ${c.lastName}`.toLowerCase();
      const emailMatch = c.email.toLowerCase().includes(q);
      const jobMatch = c.jobTitle?.toLowerCase().includes(q);
      const compMatch = c.company?.name?.toLowerCase().includes(q);
      return Boolean(fullName.includes(q) || emailMatch || jobMatch || compMatch);
    }
    return true;
  });

  const filteredCompanies = companies.filter((comp) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return Boolean(
        comp.name.toLowerCase().includes(q) ||
          comp.domain?.toLowerCase().includes(q) ||
          comp.industry?.toLowerCase().includes(q) ||
          comp.cnpj?.includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200">
              <button
                type="button"
                onClick={() => setSubView('CONTACTS')}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition ${
                  subView === 'CONTACTS'
                    ? 'bg-[#1e293b] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Users className="w-4 h-4 text-[#ff7a59]" />
                Contatos ({contacts.length})
              </button>
              <button
                type="button"
                onClick={() => setSubView('COMPANIES')}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition ${
                  subView === 'COMPANIES'
                    ? 'bg-[#1e293b] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Building2 className="w-4 h-4 text-[#ff7a59]" />
                Empresas B2B ({companies.length})
              </button>
            </div>
            <div className="hidden sm:block text-xs text-slate-500">
              Lead Scoring preditivo (0-100), Next Best Action e Enriquecimento por domínio corporativo.
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={batchEnriching}
              onClick={handleBatchEnrich}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-bold transition disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4 text-indigo-600" />
              {batchEnriching ? 'Enriquecendo Base...' : 'Enriquecer Base em Lote'}
            </button>

            <button
              type="button"
              onClick={() => setShowNewCompanyModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition"
            >
              <Plus className="w-4 h-4" />
              Nova Empresa
            </button>

            <button
              type="button"
              onClick={() => setShowNewContactModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-bold shadow-sm transition"
            >
              <Plus className="w-4 h-4" />
              Novo Contato
            </button>
          </div>
        </div>

        {enrichmentFeedback && (
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-2 text-xs text-emerald-800 font-medium">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{enrichmentFeedback}</span>
            </div>
            <button
              type="button"
              onClick={() => setEnrichmentFeedback(null)}
              className="text-emerald-600 hover:text-emerald-900"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 pt-2 border-t border-slate-100">
          <div className="lg:col-span-5 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                subView === 'CONTACTS'
                  ? 'Buscar contato por nome, e-mail corporativo, cargo ou empresa...'
                  : 'Buscar empresa por razão social, domínio, CNPJ ou setor...'
              }
              className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#ff7a59]"
            />
          </div>

          {subView === 'CONTACTS' ? (
            <div className="lg:col-span-3 flex items-center gap-2">
              <select
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value)}
                className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 bg-white focus:outline-none focus:border-[#ff7a59]"
              >
                <option value="ALL">Todas as Etapas (Lifecycle)</option>
                <option value="LEAD">Lead</option>
                <option value="MQL">MQL</option>
                <option value="SQL">SQL Qualificado</option>
                <option value="OPPORTUNITY">Oportunidade</option>
                <option value="CUSTOMER">Cliente Ativo</option>
              </select>

              <select
                value={minScoreFilter}
                onChange={(e) => setMinScoreFilter(Number(e.target.value))}
                className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 bg-white focus:outline-none focus:border-[#ff7a59]"
              >
                <option value={0}>Qualquer Score</option>
                <option value={80}>Score ≥ 80 (Quentes)</option>
                <option value={60}>Score ≥ 60</option>
              </select>
            </div>
          ) : (
            <div className="lg:col-span-3 flex items-center text-xs text-slate-500">
              Catálogo corporativo com validação CNPJ Mod-11 e inferência de porte.
            </div>
          )}

          <form onSubmit={handleLookupDomain} className="lg:col-span-4 flex items-center gap-2">
            <div className="relative flex-1">
              <Globe className="w-3.5 h-3.5 text-indigo-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                placeholder="Testar domínio/e-mail (ex: @loggi.com, @totvs.com.br)"
                className="w-full pl-8 pr-3 py-2 rounded-xl border border-indigo-200 bg-indigo-50/30 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <button
              type="submit"
              disabled={lookingUpDomain}
              className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shrink-0 transition"
            >
              {lookingUpDomain ? '...' : 'Inspecionar'}
            </button>
          </form>
        </div>

        {domainPreview && (
          <div className="p-3.5 rounded-xl bg-indigo-950 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
                  {domainPreview.isCorporate ? 'Domínio Corporativo B2B' : 'Provedor Gratuito / Pessoal'}
                </span>
                <span className="text-xs font-bold text-white">{domainPreview.domain}</span>
                {domainPreview.adapterName && (
                  <span className="text-[11px] text-indigo-300">Fonte: {domainPreview.adapterName}</span>
                )}
              </div>
              {domainPreview.profile ? (
                <p className="text-xs text-indigo-100">
                  <strong>{domainPreview.profile.name}</strong> • Setor: {domainPreview.profile.industry} • Porte:{' '}
                  {domainPreview.profile.size} • Receita Est.: {formatBRL(domainPreview.profile.annualRevenue)} •{' '}
                  {domainPreview.profile.city}/{domainPreview.profile.state}
                </p>
              ) : (
                <p className="text-xs text-indigo-200">
                  Nenhum perfil corporativo encontrado para este domínio.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setDomainPreview(null)}
              className="text-xs text-indigo-300 hover:text-white self-end sm:self-center"
            >
              Fechar
            </button>
          </div>
        )}
      </div>

      {subView === 'CONTACTS' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 lg:hidden">
            {filteredContacts.map((contact) => {
              const scoreStyle = getScoreColorClasses(contact.leadScore);
              const isEnriching = enrichingId === contact.id;
              return (
                <div
                  key={contact.id}
                  onClick={() => handleSelectContact(contact.id, false)}
                  className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3 cursor-pointer hover:border-[#ff7a59] transition"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-slate-800 text-white font-bold flex items-center justify-center text-xs shrink-0">
                        {contact.firstName.charAt(0)}
                        {contact.lastName ? contact.lastName.charAt(0) : ''}
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 text-sm truncate">
                          {contact.firstName} {contact.lastName}
                        </div>
                        <div className="text-xs text-slate-500 truncate">{contact.email}</div>
                        <div className="text-xs font-medium text-slate-700 truncate">
                          {contact.jobTitle || 'Sem cargo'} • {contact.company?.name || 'Sem empresa'}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {getLifecycleBadge(contact.lifecycleStage)}
                      <span className={`text-xs font-extrabold ${scoreStyle.text}`}>
                        Score {contact.leadScore}
                      </span>
                    </div>
                  </div>
                  <div
                    className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectContact(contact.id, true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white font-bold text-xs shadow-xs transition"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      ✏️ Editar Contato
                    </button>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isEnriching}
                        onClick={() => handleSingleEnrich(contact.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-semibold text-xs transition"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        {isEnriching ? '...' : 'Enriquecer'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectContact(contact.id, false)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs transition"
                      >
                        Ficha 360°
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="hidden lg:block bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="py-3.5 px-4">Contato & Cargo</th>
                  <th className="py-3.5 px-4">Empresa</th>
                  <th className="py-3.5 px-4">Etapa & Status</th>
                  <th className="py-3.5 px-4">Lead Score (0-100)</th>
                  <th className="py-3.5 px-4">Completude</th>
                  <th className="py-3.5 px-4">Próxima Melhor Ação (IA)</th>
                  <th className="py-3.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80 text-xs">
                {filteredContacts.map((contact) => {
                  const scoreStyle = getScoreColorClasses(contact.leadScore);
                  const isEnriching = enrichingId === contact.id;

                  return (
                    <tr
                      key={contact.id}
                      onClick={() => handleSelectContact(contact.id)}
                      className="hover:bg-orange-50/30 transition cursor-pointer group"
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-slate-800 text-white font-bold flex items-center justify-center text-xs shrink-0">
                            {contact.firstName.charAt(0)}
                            {contact.lastName ? contact.lastName.charAt(0) : ''}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 group-hover:text-[#ff7a59] transition flex items-center gap-1.5">
                              {contact.firstName} {contact.lastName}
                              {!contact.isValidEmail && (
                                <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-bold">
                                  E-mail Inválido
                                </span>
                              )}
                            </div>
                            <div className="text-slate-500 flex items-center gap-2 mt-0.5">
                              <span>{contact.email}</span>
                              {contact.jobTitle && (
                                <>
                                  <span>•</span>
                                  <span className="font-medium text-slate-700">{contact.jobTitle}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        {contact.company ? (
                          <div>
                            <div className="font-semibold text-slate-800">{contact.company.name}</div>
                            <div className="text-[11px] text-slate-400">
                              {contact.company.industry || contact.company.domain}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">Não vinculada</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="flex flex-col items-start gap-1">
                          {getLifecycleBadge(contact.lifecycleStage)}
                          <span className="text-[11px] text-slate-500">
                            {getLeadStatusLabel(contact.leadStatus)}
                          </span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="w-32 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className={`font-extrabold text-sm ${scoreStyle.text}`}>
                              {contact.leadScore}
                            </span>
                            <span className="text-[10px] font-semibold text-slate-500">
                              {scoreStyle.label}
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${scoreStyle.bar}`}
                              style={{ width: `${contact.leadScore}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded-md font-bold text-[11px] ${
                              contact.completenessScore >= 85
                                ? 'bg-emerald-50 text-emerald-700'
                                : contact.completenessScore >= 65
                                  ? 'bg-amber-50 text-amber-800'
                                  : 'bg-rose-50 text-rose-700'
                            }`}
                          >
                            {contact.completenessScore}%
                          </span>
                          {contact.enrichedAt && (
                            <span className="text-indigo-600">
                              <Sparkles className="w-3.5 h-3.5" />
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 max-w-xs">
                        {contact.nextBestAction ? (
                          <div className="p-2 rounded-lg bg-slate-50 border border-slate-200/80">
                            <div className="font-bold text-slate-800 flex items-center gap-1">
                              <Zap className="w-3 h-3 text-[#ff7a59] shrink-0" />
                              <span className="truncate">{contact.nextBestAction.title}</span>
                            </div>
                            <div className="text-[11px] text-slate-500 truncate mt-0.5">
                              {contact.nextBestAction.reason}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      <td
                        className="py-3.5 px-4 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleSelectContact(contact.id, true)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-orange-50 hover:bg-orange-100 text-[#e05835] border border-orange-200 font-bold text-[11px] transition"
                          >
                            <Pencil className="w-3 h-3" />
                            ✏️ Editar
                          </button>
                          <button
                            type="button"
                            disabled={isEnriching}
                            onClick={() => handleSingleEnrich(contact.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-semibold text-[11px] transition disabled:opacity-50"
                          >
                            <Sparkles className="w-3 h-3" />
                            {isEnriching ? '...' : 'Enriquecer'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSelectContact(contact.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold text-[11px] transition"
                          >
                            Ficha 360°
                            <ArrowUpRight className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}

      {subView === 'COMPANIES' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCompanies.map((company) => (
            <div
              key={company.id}
              onClick={() => handleSelectCompany(company.id)}
              className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:border-[#ff7a59] transition flex flex-col justify-between gap-4 cursor-pointer group"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-900 text-[#ff7a59] font-bold flex items-center justify-center text-sm shrink-0">
                      {company.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">{company.name}</h3>
                      <p className="text-xs text-slate-500">
                        {company.domain || 'Sem domínio'} • {company.city || 'Brasil'}/{company.state || 'BR'}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                      company.completenessScore >= 85
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-amber-50 text-amber-800 border border-amber-200'
                    }`}
                  >
                    {company.completenessScore}% completo
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <div>
                    <span className="text-[10px] uppercase text-slate-400 block">CNPJ</span>
                    <span className="font-semibold text-slate-800">{company.cnpj || 'Não informado'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase text-slate-400 block">Setor</span>
                    <span className="font-semibold text-slate-800 truncate block">
                      {company.industry || 'Não classificado'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase text-slate-400 block">Porte</span>
                    <span className="font-semibold text-slate-800">{company.size || '—'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase text-slate-400 block">Faturamento Anual</span>
                    <span className="font-semibold text-slate-800">
                      {company.annualRevenue ? formatBRL(company.annualRevenue) : '—'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3 text-slate-600">
                  <span>
                    <strong>{company.contactsCount ?? 0}</strong> contatos
                  </span>
                  <span>•</span>
                  <span>
                    <strong>{company.dealsCount ?? 0}</strong> deals ({formatBRL(company.totalDealValue ?? 0)})
                  </span>
                </div>

                <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => handleSelectCompany(company.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-orange-50 hover:bg-orange-100 text-[#e05835] border border-orange-200 font-bold text-xs transition"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    ✏️ Editar Empresa
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setEnrichingId(company.id);
                    try {
                      const res = await onEnrichCompany(company.id);
                      if (res) {
                        setEnrichmentFeedback(
                          `Empresa "${company.name}" enriquecida via ${res.source || 'Catálogo'}!`
                        );
                      }
                    } finally {
                      setEnrichingId(null);
                    }
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-xs transition"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {enrichingId === company.id ? '...' : 'Enriquecer'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedContactId && (
        <ContactDetailDrawer
          contactDetail={contactDetail}
          companies={companies}
          loadingDetail={loadingDetail}
          enrichingId={enrichingId}
          enrichmentFeedback={enrichmentFeedback}
          initialEditMode={contactInitialEdit}
          onClose={() => {
            setSelectedContactId(null);
            setContactDetail(null);
            setContactInitialEdit(false);
          }}
          onSingleEnrich={handleSingleEnrich}
          onUpdateContact={async (contactId, patch) => {
            await onUpdateContact(contactId, patch);
            await fetchContactDetail(contactId);
          }}
          onDeleteContact={async (contactId) => {
            await onDeleteContact(contactId);
            setSelectedContactId(null);
            setContactDetail(null);
          }}
          onAddContactActivity={async (payload) => {
            await onAddContactActivity(payload);
            await fetchContactDetail(payload.contactId);
          }}
        />
      )}

      {selectedCompanyId && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex justify-end">
          <div className="bg-white w-full max-w-2xl h-full shadow-2xl border-l border-slate-200 flex flex-col overflow-hidden">
            <div className="px-4 sm:px-6 py-4 bg-[#1e293b] text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-[#ff7a59] text-white font-bold flex items-center justify-center text-sm shrink-0">
                  {companyDetail?.name?.slice(0, 2).toUpperCase() || 'EM'}
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-white truncate">
                    {companyDetail ? companyDetail.name : 'Carregando empresa...'}
                  </h3>
                  <p className="text-xs text-slate-300 mt-0.5 truncate">
                    {companyDetail?.domain || 'Sem domínio'} • CNPJ: {companyDetail?.cnpj || 'Não informado'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 self-end sm:self-auto">
                {companyDetail && (
                  <button
                    type="button"
                    disabled={enrichingId === companyDetail.id}
                    onClick={async () => {
                      setEnrichingId(companyDetail.id);
                      try {
                        const res = await onEnrichCompany(companyDetail.id);
                        if (res) {
                          setEnrichmentFeedback(
                            `Empresa "${companyDetail.name}" enriquecida via ${res.source || 'Catálogo Corporativo'}!`
                          );
                        }
                        await fetchCompanyDetail(companyDetail.id);
                      } finally {
                        setEnrichingId(null);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-semibold transition disabled:opacity-50"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    {enrichingId === companyDetail.id ? 'Enriquecendo...' : '⚡ Enriquecer CNPJ/Domínio'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCompanyId(null);
                    setCompanyDetail(null);
                  }}
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-6">
              {loadingCompanyDetail || !companyDetail ? (
                <div className="space-y-4 animate-pulse">
                  <div className="h-24 bg-slate-100 rounded-xl" />
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

                  <form
                    onSubmit={handleSaveCompanyEdit}
                    className="p-5 rounded-2xl border-2 border-[#ff7a59] bg-orange-50/30 space-y-4 shadow-sm"
                  >
                    <div className="flex items-center justify-between border-b border-orange-200/70 pb-3">
                      <div className="flex items-center gap-2">
                        <Pencil className="w-4 h-4 text-[#ff7a59]" />
                        <h4 className="text-sm font-extrabold text-slate-900">
                          Editar Cadastro da Empresa B2B
                        </h4>
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                        Completude: {companyDetail.completenessScore}%
                      </span>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                        Razão Social / Nome da Empresa *
                      </label>
                      <input
                        type="text"
                        required
                        value={editCompName}
                        onChange={(e) => setEditCompName(e.target.value)}
                        className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-[#ff7a59]"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div>
                        <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                          Domínio Corporativo
                        </label>
                        <input
                          type="text"
                          value={editCompDomain}
                          onChange={(e) => setEditCompDomain(e.target.value)}
                          placeholder="ex: totvs.com.br"
                          className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-[#ff7a59]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                          CNPJ (Validação Mod-11)
                        </label>
                        <input
                          type="text"
                          value={editCompCnpj}
                          onChange={(e) => setEditCompCnpj(e.target.value)}
                          placeholder="00.000.000/0001-00"
                          className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-[#ff7a59]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div>
                        <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                          Setor / Indústria (Industry)
                        </label>
                        <input
                          type="text"
                          value={editCompIndustry}
                          onChange={(e) => setEditCompIndustry(e.target.value)}
                          placeholder="Ex: Software Enterprise & ERP"
                          className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-[#ff7a59]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                          Porte (Size Range)
                        </label>
                        <select
                          value={editCompSize}
                          onChange={(e) => setEditCompSize(e.target.value)}
                          className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-[#ff7a59]"
                        >
                          <option value="1-50 funcionários">1-50 funcionários</option>
                          <option value="51-200 funcionários">51-200 funcionários</option>
                          <option value="201-500 funcionários">201-500 funcionários</option>
                          <option value="501-1000 funcionários">501-1000 funcionários</option>
                          <option value="1000+ funcionários">1000+ funcionários</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                      <div>
                        <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                          Receita Anual (R$)
                        </label>
                        <input
                          type="number"
                          value={editCompRevenue}
                          onChange={(e) => setEditCompRevenue(e.target.value)}
                          placeholder="50000000"
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-[#ff7a59]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                          Tier da Conta
                        </label>
                        <select
                          value={editCompTier}
                          onChange={(e) => setEditCompTier(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-[#ff7a59]"
                        >
                          <option value="ENTERPRISE">ENTERPRISE</option>
                          <option value="MID_MARKET">MID_MARKET</option>
                          <option value="SMB">SMB</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                          Executivo da Conta
                        </label>
                        <input
                          type="text"
                          value={editCompOwner}
                          onChange={(e) => setEditCompOwner(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-[#ff7a59]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3.5">
                      <div>
                        <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                          Cidade
                        </label>
                        <input
                          type="text"
                          value={editCompCity}
                          onChange={(e) => setEditCompCity(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-[#ff7a59]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                          UF
                        </label>
                        <input
                          type="text"
                          value={editCompState}
                          onChange={(e) => setEditCompState(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-[#ff7a59]"
                        />
                      </div>
                    </div>

                    <div className="pt-3 border-t border-orange-200/70 flex flex-wrap items-center justify-between gap-2">
                      {!confirmCompanyDelete ? (
                        <button
                          type="button"
                          onClick={() => setConfirmCompanyDelete(true)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-rose-700 hover:bg-rose-100 text-xs font-bold transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Excluir Empresa
                        </button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-rose-700">Confirmar exclusão?</span>
                          <button
                            type="button"
                            disabled={deletingCompany}
                            onClick={handleConfirmCompanyDelete}
                            className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold"
                          >
                            {deletingCompany ? 'Excluindo...' : 'Sim, Excluir'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmCompanyDelete(false)}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 bg-white"
                          >
                            Não
                          </button>
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCompanyId(null);
                            setCompanyDetail(null);
                          }}
                          className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Fechar
                        </button>
                        <button
                          type="submit"
                          disabled={savingCompanyEdit}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-bold shadow-sm transition disabled:opacity-50"
                        >
                          <Save className="w-3.5 h-3.5" />
                          {savingCompanyEdit ? 'Salvando...' : 'Salvar Alterações'}
                        </button>
                      </div>
                    </div>
                  </form>

                  <div className="space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Contatos Vinculados ({companyDetail.contacts?.length || 0})
                    </h4>
                    {companyDetail.contacts?.length === 0 ? (
                      <p className="text-xs text-slate-400">Nenhum executivo vinculado a esta empresa.</p>
                    ) : (
                      <div className="space-y-2">
                        {companyDetail.contacts.map((c) => (
                          <div
                            key={c.id}
                            className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between text-xs"
                          >
                            <div>
                              <div className="font-bold text-slate-900">
                                {c.firstName} {c.lastName}
                              </div>
                              <div className="text-slate-500">
                                {c.jobTitle || 'Sem cargo'} • {c.email}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedCompanyId(null);
                                setCompanyDetail(null);
                                handleSelectContact(c.id, true);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:border-[#ff7a59] text-slate-800 font-bold text-[11px]"
                            >
                              <Pencil className="w-3 h-3 text-[#ff7a59]" />
                              Editar Contato
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Negócios no Pipeline ({companyDetail.deals?.length || 0})
                    </h4>
                    {companyDetail.deals?.length === 0 ? (
                      <p className="text-xs text-slate-400">Nenhum negócio vinculado a esta empresa.</p>
                    ) : (
                      <div className="space-y-2">
                        {companyDetail.deals.map((d) => (
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
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showNewContactModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="px-6 py-4 bg-[#1e293b] text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-[#ff7a59]" />
                <h3 className="text-base font-bold">Novo Contato (Auto-Workflow & Smart Score)</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowNewContactModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateContactSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                    Nome *
                  </label>
                  <input
                    type="text"
                    required
                    value={cFirstName}
                    onChange={(e) => setCFirstName(e.target.value)}
                    placeholder="Ex: Fernanda"
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                    Sobrenome
                  </label>
                  <input
                    type="text"
                    value={cLastName}
                    onChange={(e) => setCLastName(e.target.value)}
                    placeholder="Ex: Lima"
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                  E-mail Corporativo *
                </label>
                <input
                  type="email"
                  required
                  value={cEmail}
                  onChange={(e) => setCEmail(e.target.value)}
                  placeholder="Ex: fernanda.lima@mercadolivre.com.br"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Dica: Ao usar domínio corporativo, o workflow de enriquecimento vincula a empresa automaticamente!
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                    Telefone / WhatsApp
                  </label>
                  <input
                    type="text"
                    value={cPhone}
                    onChange={(e) => setCPhone(e.target.value)}
                    placeholder="(11) 98888-7766"
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                    Cargo Executivo
                  </label>
                  <input
                    type="text"
                    value={cJobTitle}
                    onChange={(e) => setCJobTitle(e.target.value)}
                    placeholder="Ex: Diretora de Operações"
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                    Estágio do Funil (Lifecycle)
                  </label>
                  <select
                    value={cStage}
                    onChange={(e) => setCStage(e.target.value as LifecycleStage)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white"
                  >
                    <option value="LEAD">Lead</option>
                    <option value="MQL">MQL</option>
                    <option value="SQL">SQL</option>
                    <option value="OPPORTUNITY">Oportunidade</option>
                    <option value="CUSTOMER">Cliente</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                    Empresa (Opcional se corporativo)
                  </label>
                  <select
                    value={cCompanyId}
                    onChange={(e) => setCCompanyId(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white"
                  >
                    <option value="">Inferir pelo domínio ou sem vínculo</option>
                    {companies.map((comp) => (
                      <option key={comp.id} value={comp.id}>
                        {comp.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewContactModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingContact}
                  className="px-5 py-2 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-semibold shadow-sm transition"
                >
                  {savingContact ? 'Criando...' : 'Criar Contato'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showNewCompanyModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="px-6 py-4 bg-[#1e293b] text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-[#ff7a59]" />
                <h3 className="text-base font-bold">Cadastrar Nova Empresa B2B</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowNewCompanyModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCompanySubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                  Razão Social / Nome Fantasia *
                </label>
                <input
                  type="text"
                  required
                  value={compName}
                  onChange={(e) => setCompName(e.target.value)}
                  placeholder="Ex: Stone Pagamentos S.A."
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                    Domínio Corporativo
                  </label>
                  <input
                    type="text"
                    value={compDomain}
                    onChange={(e) => setCompDomain(e.target.value)}
                    placeholder="Ex: stone.com.br"
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                    CNPJ (Validação Mod-11)
                  </label>
                  <input
                    type="text"
                    value={compCnpj}
                    onChange={(e) => setCompCnpj(e.target.value)}
                    placeholder="18.236.120/0001-58"
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                    Setor / Indústria
                  </label>
                  <input
                    type="text"
                    value={compIndustry}
                    onChange={(e) => setCompIndustry(e.target.value)}
                    placeholder="Ex: Fintech & Meios de Pagamento"
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                    Porte
                  </label>
                  <select
                    value={compSize}
                    onChange={(e) => setCompSize(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white"
                  >
                    <option value="1-50 funcionários">1-50 funcionários</option>
                    <option value="51-200 funcionários">51-200 funcionários</option>
                    <option value="201-500 funcionários">201-500 funcionários</option>
                    <option value="501-1000 funcionários">501-1000 funcionários</option>
                    <option value="1000+ funcionários">1000+ funcionários</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                    Receita Anual (R$)
                  </label>
                  <input
                    type="number"
                    value={compRevenue}
                    onChange={(e) => setCompRevenue(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                    Cidade
                  </label>
                  <input
                    type="text"
                    value={compCity}
                    onChange={(e) => setCompCity(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                    UF
                  </label>
                  <input
                    type="text"
                    value={compState}
                    onChange={(e) => setCompState(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm text-slate-900"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewCompanyModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingCompany}
                  className="px-5 py-2 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-semibold shadow-sm transition"
                >
                  {savingCompany ? 'Salvando...' : 'Criar Empresa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
