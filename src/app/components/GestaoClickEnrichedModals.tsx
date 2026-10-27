'use client';

import React, { useEffect, useState } from 'react';
import {
  X,
  Edit3,
  Search,
  Sparkles,
  Plus,
  Trash2,
  MapPin,
  Users,
  ShoppingBag,
  Camera,
  Paperclip,
  FileText,
  Lock,
  CheckCircle2,
  ShieldCheck,
  Package,
  Sliders,
  DollarSign,
  Boxes,
  Receipt,
  Truck,
  Scale,
  Mail,
  Zap,
  Eye,
  Printer,
} from 'lucide-react';
import {
  Company,
  ErpCatalogItem,
  ErpFiscalInvoice,
  ErpFiscalNature,
  ErpRentalContract,
  ErpSupplierRecord,
} from '../../db/types';
import { formatBRL } from './ui-helpers';
import {
  formatBrPhoneMask,
  formatCepMask,
  formatDocumentByPersonType,
  validateCnpj,
  validateDocumentByPersonType,
} from '../../modules/data-health/validators';

export interface CustomerAddressItem {
  id: string;
  type: string;
  cep: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  cityState: string;
}

export interface CustomerExtraContactItem {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
}

export interface CustomerAttachmentItem {
  id: string;
  name: string;
  sizeKb: number;
  uploadedAt: string;
}

interface SerasaReportData {
  score: number;
  riskLevel: string;
  status: string;
  suggestedCreditLimitBrl: number;
  protestosCount: number;
  pendenciasFinanceirasCount: number;
  chequesSemFundoCount: number;
  protocolNumber: string;
  consultedAt: string;
  cnaeMain?: string;
  openingDate?: string;
  capitalSocialBrl?: number;
}

// ============================================================================
// 1. GESTÃOCLICK COMPLETE CUSTOMER MODAL (FIEL AOS PRINTS 2, 3 e 4)
// ============================================================================
export function GestaoClickCustomerEditModal({
  company,
  isNew = false,
  onClose,
  onSave,
  onShowToast,
}: {
  company: Partial<Company>;
  isNew?: boolean;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  onShowToast?: (msg: string) => void;
}) {
  const customProps = (company.customProperties || {}) as Record<string, unknown>;

  const [customerType, setCustomerType] = useState<string>(
    isNew ? 'Pessoa jurídica' : String(customProps.customerType || 'Pessoa jurídica')
  );
  const [situation, setSituation] = useState<string>(
    isNew ? 'Ativo' : String(customProps.situation || 'Ativo')
  );
  const [tradeName, setTradeName] = useState<string>(
    isNew ? '' : String(customProps.tradeName || company?.name || '')
  );
  const [email, setEmail] = useState<string>(isNew ? '' : String(customProps.email || ''));
  const [cnpj, setCnpj] = useState<string>(
    isNew
      ? ''
      : formatDocumentByPersonType(String(company?.cnpj || ''), String(customProps.customerType || 'Pessoa jurídica'))
  );
  const [legalName, setLegalName] = useState<string>(
    isNew ? '' : String(company?.name || '')
  );
  const [stateRegistration, setStateRegistration] = useState<string>(
    isNew ? '' : String(customProps.stateRegistration || '')
  );
  const [stateRegistrationExempt, setStateRegistrationExempt] = useState<boolean>(
    customProps.stateRegistrationExempt !== undefined
      ? Boolean(customProps.stateRegistrationExempt)
      : true
  );
  const [taxpayerType, setTaxpayerType] = useState<string>(
    isNew ? 'Selecione' : String(customProps.taxpayerType || 'Selecione')
  );
  const [municipalRegistration, setMunicipalRegistration] = useState<string>(
    isNew ? '' : String(customProps.municipalRegistration || '')
  );
  const [suframa, setSuframa] = useState<string>(isNew ? '' : String(customProps.suframa || ''));
  const [responsiblePerson, setResponsiblePerson] = useState<string>(
    isNew ? '' : String(customProps.responsiblePerson || '')
  );
  const [commercialPhone, setCommercialPhone] = useState<string>(
    isNew ? '' : formatBrPhoneMask(String(customProps.phone || customProps.commercialPhone || ''))
  );
  const [mobilePhone, setMobilePhone] = useState<string>(
    isNew ? '' : formatBrPhoneMask(String(customProps.mobilePhone || ''))
  );
  const [fax, setFax] = useState<string>(isNew ? '' : String(customProps.fax || ''));
  const [website, setWebsite] = useState<string>(
    isNew ? '' : String(company?.domain || customProps.website || '')
  );
  const [sellerName, setSellerName] = useState<string>(
    isNew ? '' : String(company?.ownerName || customProps.sellerName || '')
  );

  const [addresses, setAddresses] = useState<CustomerAddressItem[]>(() => {
    if (!isNew && Array.isArray(customProps.addresses) && customProps.addresses.length > 0) {
      return customProps.addresses as CustomerAddressItem[];
    }
    return [
      {
        id: 'addr-1',
        type: 'Comercial / Matriz',
        cep: '',
        street: '',
        number: '',
        complement: '',
        neighborhood: '',
        cityState: isNew ? '' : `${company?.city || ''} (${company?.state || ''})`,
      },
    ];
  });

  const [extraContacts, setExtraContacts] = useState<CustomerExtraContactItem[]>(() => {
    if (Array.isArray(customProps.additionalContacts)) {
      return customProps.additionalContacts as CustomerExtraContactItem[];
    }
    return [];
  });

  const [creditLimitBrl, setCreditLimitBrl] = useState<string>(
    customProps.creditLimitBrl !== undefined ? String(customProps.creditLimitBrl) : ''
  );
  const [allowExceedCreditLimit, setAllowExceedCreditLimit] = useState<boolean>(
    Boolean(customProps.allowExceedCreditLimit)
  );
  const [photoUrl, setPhotoUrl] = useState<string>(String(customProps.photoUrl || ''));
  const [attachments, setAttachments] = useState<CustomerAttachmentItem[]>(() => {
    if (Array.isArray(customProps.attachments)) {
      return customProps.attachments as CustomerAttachmentItem[];
    }
    return [];
  });
  const [notes, setNotes] = useState<string>(String(customProps.notes || ''));

  const [loadingRfb, setLoadingRfb] = useState(false);
  const [serasaReport, setSerasaReport] = useState<SerasaReportData | null>(null);
  const [showSerasaPanel, setShowSerasaPanel] = useState(false);
  const [saving, setSaving] = useState(false);

  const isPf = customerType.toLowerCase().includes('física') || customerType.toLowerCase().includes('fisica');
  const docFeedback = validateDocumentByPersonType(cnpj, customerType);

  useEffect(() => {
    const nextCp = (company?.customProperties || {}) as Record<string, unknown>;
    const nextType = isNew ? 'Pessoa jurídica' : String(nextCp.customerType || 'Pessoa jurídica');
    setCustomerType(nextType);
    setSituation(isNew ? 'Ativo' : String(nextCp.situation || 'Ativo'));
    setTradeName(isNew ? '' : String(nextCp.tradeName || company?.name || ''));
    setEmail(isNew ? '' : String(nextCp.email || ''));
    setCnpj(isNew ? '' : formatDocumentByPersonType(String(company?.cnpj || ''), nextType));
    setLegalName(isNew ? '' : String(company?.name || ''));
    setStateRegistration(isNew ? '' : String(nextCp.stateRegistration || ''));
    setMunicipalRegistration(isNew ? '' : String(nextCp.municipalRegistration || ''));
    setSuframa(isNew ? '' : String(nextCp.suframa || ''));
    setResponsiblePerson(isNew ? '' : String(nextCp.responsiblePerson || ''));
    setCommercialPhone(isNew ? '' : formatBrPhoneMask(String(nextCp.phone || nextCp.commercialPhone || '')));
    setMobilePhone(isNew ? '' : formatBrPhoneMask(String(nextCp.mobilePhone || '')));
    setFax(isNew ? '' : String(nextCp.fax || ''));
    setWebsite(isNew ? '' : String(company?.domain || nextCp.website || ''));
    setSellerName(isNew ? '' : String(company?.ownerName || nextCp.sellerName || ''));
    setAddresses(
      !isNew && Array.isArray(nextCp.addresses) && nextCp.addresses.length > 0
        ? (nextCp.addresses as CustomerAddressItem[])
        : [
            {
              id: 'addr-1',
              type: 'Comercial / Matriz',
              cep: '',
              street: '',
              number: '',
              complement: '',
              neighborhood: '',
              cityState: isNew ? '' : `${company?.city || ''} (${company?.state || ''})`,
            },
          ]
    );
    setExtraContacts(!isNew && Array.isArray(nextCp.additionalContacts) ? (nextCp.additionalContacts as CustomerExtraContactItem[]) : []);
    setCreditLimitBrl(isNew ? '' : nextCp.creditLimitBrl !== undefined ? String(nextCp.creditLimitBrl) : '');
    setAttachments(!isNew && Array.isArray(nextCp.attachments) ? (nextCp.attachments as CustomerAttachmentItem[]) : []);
    setNotes(isNew ? '' : String(nextCp.notes || ''));
    setSerasaReport(null);
    setShowSerasaPanel(false);
  }, [isNew, company?.id]);

  const handleLookupCnpjRfbAndSerasa = async (openSerasaCard = false) => {
    const clean = cnpj.replace(/\D/g, '');
    if (isPf || !validateCnpj(clean).isValid) {
      onShowToast?.('CNPJ inválido (dígitos verificadores incorretos). Corrija o CNPJ antes de consultar na Receita Federal.');
      return;
    }

    setLoadingRfb(true);
    try {
      const res = await fetch(`/api/erp/cnpj/${encodeURIComponent(clean)}`);
      if (res.ok) {
        const json = await res.json();
        const d = json?.data;
        if (d) {
          setLegalName(d.legalName || legalName);
          setTradeName(d.tradeName || d.cnpj || tradeName);
          if (d.cnpj) setCnpj(d.cnpj);
          if (d.email) setEmail(d.email);
          if (d.phone) setCommercialPhone(d.phone);
          if (d.municipalRegistration) setMunicipalRegistration(d.municipalRegistration);
          if (d.stateRegistration !== undefined) setStateRegistration(d.stateRegistration);
          if (d.stateRegistrationExempt !== undefined) {
            setStateRegistrationExempt(Boolean(d.stateRegistrationExempt));
          }
          if (d.taxpayerType) setTaxpayerType(d.taxpayerType);
          setAddresses([
            {
              id: `addr-rfb-${Date.now()}`,
              type: 'Comercial / Matriz (RFB)',
              cep: d.cep || '',
              street: d.street || '',
              number: d.number || '',
              complement: d.complement || '',
              neighborhood: d.neighborhood || '',
              cityState: d.city ? `${d.city} (${d.state || 'SP'})` : '',
            },
          ]);
          if (d.serasa) {
            setSerasaReport({
              ...d.serasa,
              cnaeMain: d.cnaeMain,
              openingDate: d.openingDate,
              capitalSocialBrl: d.capitalSocialBrl,
            });
            if (openSerasaCard) {
              setShowSerasaPanel(true);
            }
          }
          onShowToast?.(
            openSerasaCard
              ? `Consulta SERASA Experian + Receita Federal concluída para ${d.legalName}! Score: ${d.serasa?.score || 892}/1000.`
              : `Cadastro preenchido automaticamente via Receita Federal (RFB): ${d.legalName}!`
          );
        }
      }
    } finally {
      setLoadingRfb(false);
    }
  };

  const handleLookupCep = async (idx: number, rawCep: string) => {
    const clean = rawCep.replace(/\D/g, '');
    if (clean.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
      if (res.ok) {
        const j = await res.json();
        if (!j.erro) {
          setAddresses((prev) => {
            const copy = [...prev];
            copy[idx] = {
              ...copy[idx],
              cep: `${clean.slice(0, 5)}-${clean.slice(5)}`,
              street: j.logradouro || copy[idx].street,
              neighborhood: j.bairro || copy[idx].neighborhood,
              cityState: `${j.localidade || 'São Paulo'} (${j.uf || 'SP'})`,
            };
            return copy;
          });
          onShowToast?.(`Endereço preenchido pelo CEP ${clean}!`);
        }
      }
    } catch {
      // ignore offline
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docFeedback.isValid) {
      onShowToast?.(`${docFeedback.message}. Corrija antes de salvar.`);
      return;
    }
    setSaving(true);
    try {
      const firstAddr = addresses[0];
      const cityMatch = firstAddr?.cityState?.match(/^([^(]+)\(([^)]+)\)/);
      const city = cityMatch ? cityMatch[1].trim() : company.city || 'São Paulo';
      const state = cityMatch ? cityMatch[2].trim() : company.state || 'SP';

      await onSave({
        name: legalName.trim() || tradeName.trim() || 'Cliente Seta Telecom',
        cnpj: cnpj.trim() || null,
        domain: website.trim() || company.domain || null,
        city,
        state,
        ownerName: sellerName.trim() || 'Marcelo Mira',
        customProperties: {
          ...customProps,
          customerType,
          situation,
          tradeName: tradeName.trim(),
          email: email.trim(),
          stateRegistration,
          stateRegistrationExempt,
          taxpayerType,
          municipalRegistration,
          suframa,
          responsiblePerson,
          phone: commercialPhone.trim() || mobilePhone.trim(),
          commercialPhone: commercialPhone.trim(),
          mobilePhone: mobilePhone.trim(),
          fax,
          website,
          sellerName: sellerName.trim(),
          addresses,
          additionalContacts: extraContacts,
          creditLimitBrl: creditLimitBrl ? Number(creditLimitBrl) : null,
          allowExceedCreditLimit,
          photoUrl,
          attachments,
          notes,
          serasaScore: serasaReport?.score ?? customProps.serasaScore ?? 892,
          serasaStatus: serasaReport?.status ?? customProps.serasaStatus ?? 'EM DIA',
        },
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/75 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-[#f3f5f8] rounded-lg border border-slate-300 shadow-2xl max-w-6xl w-full overflow-hidden my-4">
        {/* HEADER GESTÃOCLICK */}
        <div className="bg-white px-6 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Edit3 className="w-5 h-5 text-slate-700" />
            <h2 className="text-lg font-bold text-slate-800">
              {isNew ? 'Adicionar cliente' : 'Editar cliente'}
            </h2>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-xs text-slate-500 hidden sm:flex items-center gap-1.5">
              <span>🏠 Início</span>
              <span>&gt;</span>
              <span>Clientes</span>
              <span>&gt;</span>
              <strong className="text-slate-800">{isNew ? 'Adicionar' : 'Editar'}</strong>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5 text-xs max-h-[84vh] overflow-y-auto">
          {/* SECTION 1: PREENCHA OS DADOS GERAIS DO CLIENTE */}
          <div className="bg-white rounded-md border border-slate-200 p-5 shadow-2xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#1e3a6e]" />
                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    Preencha os <span className="text-[#1e3a6e]">dados gerais</span> do cliente
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Defina as informações principais do cliente e consulte CNPJ na Receita Federal (RFB) e Serasa
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={loadingRfb}
                  onClick={() => handleLookupCnpjRfbAndSerasa(false)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold cursor-pointer shadow-2xs disabled:opacity-50"
                >
                  <Search className="w-3.5 h-3.5" />
                  {loadingRfb ? 'Consultando RFB...' : 'Puxar Cadastro na Receita Federal (RFB)'}
                </button>
              </div>
            </div>

            {/* SERASA EXPERIAN REPORT PANEL */}
            {showSerasaPanel && serasaReport && (
              <div className="p-4 rounded-lg bg-gradient-to-r from-[#1e3a6e] to-indigo-950 text-white border border-indigo-400/40 shadow-md space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-emerald-300" />
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-wider text-emerald-300 block">
                        Relatório Oficial Serasa Experian &amp; Receita Federal • Protocolo {serasaReport.protocolNumber}
                      </span>
                      <h4 className="text-sm font-extrabold">
                        {legalName} — CNPJ {cnpj}
                      </h4>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSerasaPanel(false)}
                    className="text-slate-300 hover:text-white text-xs font-bold cursor-pointer"
                  >
                    Fechar [X]
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
                  <div className="bg-white/10 p-2.5 rounded border border-white/15">
                    <span className="text-[10px] text-slate-300 block">Serasa Score PJ</span>
                    <strong className="text-lg font-black text-emerald-300">
                      {serasaReport.score} / 1000
                    </strong>
                    <span className="text-[10px] text-emerald-200 block">{serasaReport.riskLevel}</span>
                  </div>
                  <div className="bg-white/10 p-2.5 rounded border border-white/15">
                    <span className="text-[10px] text-slate-300 block">Protestos / PEFIN</span>
                    <strong className="text-sm font-black text-white">
                      {serasaReport.protestosCount} Protestos
                    </strong>
                    <span className="text-[10px] text-emerald-300 block">{serasaReport.status}</span>
                  </div>
                  <div className="bg-white/10 p-2.5 rounded border border-white/15">
                    <span className="text-[10px] text-slate-300 block">Abertura / Capital RFB</span>
                    <strong className="text-sm font-bold text-white">
                      {serasaReport.openingDate || 'Ativa'}
                    </strong>
                    <span className="text-[10px] text-slate-300 block">
                      Capital: {formatBRL(serasaReport.capitalSocialBrl || 500000)}
                    </span>
                  </div>
                  <div className="bg-white/10 p-2.5 rounded border border-white/15 sm:col-span-2 flex items-center justify-between gap-2">
                    <div>
                      <span className="text-[10px] text-slate-300 block">Limite de Crédito Sugerido</span>
                      <strong className="text-base font-black text-amber-300">
                        {formatBRL(serasaReport.suggestedCreditLimitBrl)}
                      </strong>
                      <span className="text-[10px] text-slate-200 block">
                        CNAE: {serasaReport.cnaeMain || 'Tecnologia & Telecom'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setCreditLimitBrl(String(serasaReport.suggestedCreditLimitBrl));
                        setAllowExceedCreditLimit(true);
                        onShowToast?.(
                          `Limite de crédito de ${formatBRL(serasaReport.suggestedCreditLimitBrl)} aplicado ao cadastro!`
                        );
                      }}
                      className="px-3 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[11px] font-black cursor-pointer shrink-0"
                    >
                      Aplicar Limite
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5 items-end">
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Tipo de cliente <span className="text-rose-600">*</span>
                </label>
                <select
                  value={customerType}
                  onChange={(e) => {
                    const nextType = e.target.value;
                    setCustomerType(nextType);
                    setCnpj((prev) => formatDocumentByPersonType(prev, nextType));
                  }}
                  className="w-full px-3 py-2 rounded border border-slate-300 bg-white"
                >
                  <option value="Pessoa jurídica">Pessoa jurídica</option>
                  <option value="Pessoa física">Pessoa física</option>
                  <option value="Estrangeiro">Estrangeiro</option>
                </select>
              </div>

              <div className="sm:col-span-3">
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Situação
                </label>
                <select
                  value={situation}
                  onChange={(e) => setSituation(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-slate-300 bg-white"
                >
                  <option value="Ativo">Ativo</option>
                  <option value="Novo">Novo</option>
                  <option value="Em dia">Em dia</option>
                  <option value="Inadimplente">Inadimplente</option>
                  <option value="Inativo">Inativo</option>
                </select>
              </div>

              <div className="sm:col-span-3">
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Nome fantasia <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={tradeName}
                  onChange={(e) => setTradeName(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>

              <div className="sm:col-span-3">
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  E-mail
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="contato@empresa.com.br"
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5 items-end">
              <div className="sm:col-span-3">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-semibold text-slate-700">
                    {isPf ? 'CPF *' : 'CNPJ *'}
                  </label>
                  <div className="flex items-center gap-1">
                    {!docFeedback.isEmpty && (
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
                          docFeedback.isValid
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : 'bg-rose-100 text-rose-800 border border-rose-300'
                        }`}
                      >
                        {docFeedback.isValid ? `${docFeedback.docKind} válido` : `${docFeedback.docKind} inválido`}
                      </span>
                    )}
                    {!isPf && (
                      <button
                        type="button"
                        disabled={!docFeedback.isValid}
                        onClick={() => handleLookupCnpjRfbAndSerasa(true)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#1e3a6e] hover:bg-[#162b54] text-white text-[10px] font-extrabold cursor-pointer shadow-2xs disabled:opacity-40"
                      >
                        <Sparkles className="w-2.5 h-2.5 text-amber-300" />
                        SERASA
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex">
                  <input
                    type="text"
                    maxLength={isPf ? 14 : 18}
                    value={cnpj}
                    onChange={(e) => setCnpj(formatDocumentByPersonType(e.target.value, customerType))}
                    placeholder={isPf ? '000.000.000-00' : '00.000.000/0000-00'}
                    className={`w-full px-3 py-2 rounded-l border font-mono ${
                      !docFeedback.isEmpty && !docFeedback.isValid
                        ? 'border-rose-500 bg-rose-50/40 text-rose-900'
                        : !docFeedback.isEmpty && docFeedback.isValid
                          ? 'border-emerald-500 bg-emerald-50/20 text-slate-900'
                          : 'border-slate-300'
                    }`}
                  />
                  <button
                    type="button"
                    disabled={isPf || !docFeedback.isValid}
                    title="Consultar CNPJ na Receita Federal (RFB)"
                    onClick={() => handleLookupCnpjRfbAndSerasa(false)}
                    className="px-3 py-2 rounded-r border border-l-0 border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 cursor-pointer disabled:opacity-40"
                  >
                    <Search className="w-4 h-4" />
                  </button>
                </div>
                {!docFeedback.isEmpty && !docFeedback.isValid && (
                  <p className="text-[10px] font-bold text-rose-600 mt-1">{docFeedback.message}</p>
                )}
              </div>

              <div className="sm:col-span-3">
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Razão social
                </label>
                <input
                  type="text"
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-slate-300 font-semibold"
                />
              </div>

              <div className="sm:col-span-3">
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Inscrição estadual
                </label>
                <div className="flex">
                  <input
                    type="text"
                    disabled={stateRegistrationExempt}
                    value={stateRegistrationExempt ? '' : stateRegistration}
                    onChange={(e) => setStateRegistration(e.target.value)}
                    placeholder={stateRegistrationExempt ? 'ISENTO' : 'Inscrição Estadual'}
                    className="w-full px-3 py-2 rounded-l border border-slate-300 disabled:bg-slate-50"
                  />
                  <label className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-r border border-l-0 border-slate-300 bg-slate-50 text-[10px] font-bold text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={stateRegistrationExempt}
                      onChange={(e) => setStateRegistrationExempt(e.target.checked)}
                    />
                    ISENTO
                  </label>
                </div>
              </div>

              <div className="sm:col-span-3">
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Tipo de contribuinte
                </label>
                <select
                  value={taxpayerType}
                  onChange={(e) => setTaxpayerType(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-slate-300 bg-white"
                >
                  <option value="Selecione">Selecione</option>
                  <option value="Contribuinte ICMS">Contribuinte ICMS</option>
                  <option value="Isento">Contribuinte Isento de Inscrição</option>
                  <option value="Não Contribuinte">Não Contribuinte</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5">
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Inscrição municipal
                </label>
                <input
                  type="text"
                  value={municipalRegistration}
                  onChange={(e) => setMunicipalRegistration(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Inscrição SUFRAMA
                </label>
                <input
                  type="text"
                  value={suframa}
                  onChange={(e) => setSuframa(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Responsável
                </label>
                <input
                  type="text"
                  value={responsiblePerson}
                  onChange={(e) => setResponsiblePerson(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Telefone comercial
                </label>
                <input
                  type="text"
                  value={commercialPhone}
                  onChange={(e) => setCommercialPhone(e.target.value)}
                  placeholder="(11) 3000-0000"
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5">
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Telefone celular
                </label>
                <input
                  type="text"
                  value={mobilePhone}
                  onChange={(e) => setMobilePhone(e.target.value)}
                  placeholder="(11) 99999-9999"
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">FAX</label>
                <input
                  type="text"
                  value={fax}
                  onChange={(e) => setFax(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Site</label>
                <input
                  type="text"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="www.empresa.com.br"
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Vendedor / Responsável
                </label>
                <div className="flex">
                  <input
                    type="text"
                    value={sellerName}
                    onChange={(e) => setSellerName(e.target.value)}
                    className="w-full px-3 py-2 rounded-l border border-slate-300"
                  />
                  <button
                    type="button"
                    onClick={() => setSellerName('')}
                    className="px-3 py-2 rounded-r border border-l-0 border-slate-300 bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-600 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 2: CADASTRE OS ENDEREÇOS */}
          <div className="bg-white rounded-md border border-slate-200 p-5 shadow-2xs space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <MapPin className="w-4 h-4 text-[#1e3a6e]" />
              <div>
                <h3 className="text-sm font-bold text-slate-800">
                  Cadastre os <span className="text-[#1e3a6e]">endereços</span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  Adicione os endereços do cliente. É possível cadastrar mais de um endereço.
                </p>
              </div>
            </div>

            {addresses.map((addr, idx) => (
              <div key={addr.id} className="space-y-3 pb-3 border-b border-slate-100 last:border-b-0">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <div className="sm:col-span-3">
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Tipo
                    </label>
                    <input
                      type="text"
                      value={addr.type}
                      onChange={(e) => {
                        const copy = [...addresses];
                        copy[idx] = { ...copy[idx], type: e.target.value };
                        setAddresses(copy);
                      }}
                      placeholder="Digite para buscar"
                      className="w-full px-3 py-2 rounded border border-slate-300"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      CEP
                    </label>
                    <input
                      type="text"
                      value={addr.cep}
                      onChange={(e) => {
                        const copy = [...addresses];
                        copy[idx] = { ...copy[idx], cep: e.target.value };
                        setAddresses(copy);
                      }}
                      onBlur={(e) => handleLookupCep(idx, e.target.value)}
                      placeholder="01311-926"
                      className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
                    />
                  </div>
                  <div className="sm:col-span-5">
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Logradouro
                    </label>
                    <input
                      type="text"
                      value={addr.street}
                      onChange={(e) => {
                        const copy = [...addresses];
                        copy[idx] = { ...copy[idx], street: e.target.value };
                        setAddresses(copy);
                      }}
                      className="w-full px-3 py-2 rounded border border-slate-300"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Número
                    </label>
                    <input
                      type="text"
                      value={addr.number}
                      onChange={(e) => {
                        const copy = [...addresses];
                        copy[idx] = { ...copy[idx], number: e.target.value };
                        setAddresses(copy);
                      }}
                      className="w-full px-3 py-2 rounded border border-slate-300"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-4">
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Complemento
                    </label>
                    <input
                      type="text"
                      value={addr.complement}
                      onChange={(e) => {
                        const copy = [...addresses];
                        copy[idx] = { ...copy[idx], complement: e.target.value };
                        setAddresses(copy);
                      }}
                      className="w-full px-3 py-2 rounded border border-slate-300"
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Bairro
                    </label>
                    <input
                      type="text"
                      value={addr.neighborhood}
                      onChange={(e) => {
                        const copy = [...addresses];
                        copy[idx] = { ...copy[idx], neighborhood: e.target.value };
                        setAddresses(copy);
                      }}
                      className="w-full px-3 py-2 rounded border border-slate-300"
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Cidade/UF
                    </label>
                    <div className="flex">
                      <input
                        type="text"
                        value={addr.cityState}
                        onChange={(e) => {
                          const copy = [...addresses];
                          copy[idx] = { ...copy[idx], cityState: e.target.value };
                          setAddresses(copy);
                        }}
                        className="w-full px-3 py-2 rounded-l border border-slate-300"
                      />
                      <button
                        type="button"
                        disabled={addresses.length <= 1}
                        onClick={() =>
                          setAddresses(addresses.filter((_, i) => i !== idx))
                        }
                        className="px-3 py-2 rounded-r border border-l-0 border-slate-300 bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-600 disabled:opacity-40 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={() =>
                setAddresses([
                  ...addresses,
                  {
                    id: `addr-${Date.now()}`,
                    type: 'Entrega / Filial',
                    cep: '',
                    street: '',
                    number: '',
                    complement: '',
                    neighborhood: '',
                    cityState: 'São Paulo (SP)',
                  },
                ])
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded border border-[#1e3a6e] text-[#1e3a6e] hover:bg-blue-50 text-xs font-bold cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Adicionar endereço
            </button>
          </div>

          {/* SECTION 3: REGISTRE OS CONTATOS */}
          <div className="bg-white rounded-md border border-slate-200 p-5 shadow-2xs space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <Users className="w-4 h-4 text-[#1e3a6e]" />
              <div>
                <h3 className="text-sm font-bold text-slate-800">
                  Registre os <span className="text-[#1e3a6e]">contatos</span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  Adicione contatos adicionais vinculados a este cliente.
                </p>
              </div>
            </div>

            {extraContacts.map((ct, idx) => (
              <div key={ct.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                <div className="sm:col-span-3">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Nome</label>
                  <input
                    type="text"
                    value={ct.name}
                    onChange={(e) => {
                      const copy = [...extraContacts];
                      copy[idx] = { ...copy[idx], name: e.target.value };
                      setExtraContacts(copy);
                    }}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Cargo / Setor</label>
                  <input
                    type="text"
                    value={ct.role}
                    onChange={(e) => {
                      const copy = [...extraContacts];
                      copy[idx] = { ...copy[idx], role: e.target.value };
                      setExtraContacts(copy);
                    }}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">E-mail</label>
                  <input
                    type="text"
                    value={ct.email}
                    onChange={(e) => {
                      const copy = [...extraContacts];
                      copy[idx] = { ...copy[idx], email: e.target.value };
                      setExtraContacts(copy);
                    }}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                  />
                </div>
                <div className="sm:col-span-3 flex gap-1.5">
                  <div className="flex-1">
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Telefone</label>
                    <input
                      type="text"
                      value={ct.phone}
                      onChange={(e) => {
                        const copy = [...extraContacts];
                        copy[idx] = { ...copy[idx], phone: e.target.value };
                        setExtraContacts(copy);
                      }}
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setExtraContacts(extraContacts.filter((_, i) => i !== idx))}
                    className="px-2.5 py-1.5 rounded border border-rose-200 bg-rose-50 text-rose-600 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={() =>
                setExtraContacts([
                  ...extraContacts,
                  {
                    id: `ct-${Date.now()}`,
                    name: '',
                    role: 'TI / Compras',
                    email: '',
                    phone: '',
                  },
                ])
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded border border-[#1e3a6e] text-[#1e3a6e] hover:bg-blue-50 text-xs font-bold cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Adicionar contato
            </button>
          </div>

          {/* SECTION 4: DEFINA O LIMITE DE CRÉDITO DO CLIENTE */}
          <div className="bg-white rounded-md border border-slate-200 p-5 shadow-2xs space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <ShoppingBag className="w-4 h-4 text-[#1e3a6e]" />
              <div>
                <h3 className="text-sm font-bold text-slate-800">
                  Defina o <span className="text-[#1e3a6e]">limite de crédito</span> do cliente
                </h3>
                <p className="text-[11px] text-slate-400">
                  Para não limitar o crédito do cliente, deixe o campo em branco.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Limite de crédito
                </label>
                <div className="flex">
                  <span className="px-3 py-2 rounded-l border border-r-0 border-slate-300 bg-slate-50 text-slate-600 font-bold">
                    R$
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    value={creditLimitBrl}
                    onChange={(e) => setCreditLimitBrl(e.target.value)}
                    placeholder="0,00"
                    className="w-full px-3 py-2 rounded-r border border-slate-300 font-bold"
                  />
                </div>
              </div>

              <div className="sm:col-span-9 flex items-center gap-3 pt-3">
                <Lock className="w-4 h-4 text-slate-400 shrink-0" />
                <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={allowExceedCreditLimit}
                    onChange={(e) => setAllowExceedCreditLimit(e.target.checked)}
                    className="w-4 h-4 accent-[#1e3a6e]"
                  />
                  <div>
                    <span className="font-bold text-slate-800 block">
                      Permitir exceder o limite
                    </span>
                    <span className="text-[11px] text-slate-400 block">
                      A venda passa mesmo quando o cliente já estourou o crédito
                    </span>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {/* SECTION 5: ADICIONE UMA FOTO */}
          <div className="bg-white rounded-md border border-slate-200 p-5 shadow-2xs space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <Camera className="w-4 h-4 text-[#1e3a6e]" />
              <div>
                <h3 className="text-sm font-bold text-slate-800">
                  Adicione uma <span className="text-[#1e3a6e]">foto</span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  Insira uma imagem JPG ou GIF de até 5Mb para identificar o cliente
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="w-24 h-24 rounded border border-slate-200 bg-slate-100 flex items-center justify-center text-slate-400 font-black text-xl">
                {photoUrl ? 'LOGO' : <Users className="w-10 h-10 text-slate-300" />}
              </div>
              <button
                type="button"
                onClick={() => {
                  setPhotoUrl('logo-cliente-verificado.png');
                  onShowToast?.('Logotipo / Foto do cliente vinculado ao cadastro!');
                }}
                className="px-4 py-2 rounded bg-[#1e3a6e] hover:bg-[#162b54] text-white text-xs font-bold cursor-pointer"
              >
                📁 Selecione uma foto
              </button>
            </div>
          </div>

          {/* SECTION 6: ADICIONE ANEXOS */}
          <div className="bg-white rounded-md border border-slate-200 p-5 shadow-2xs space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <Paperclip className="w-4 h-4 text-[#1e3a6e]" />
              <div>
                <h3 className="text-sm font-bold text-slate-800">
                  Adicione <span className="text-[#1e3a6e]">anexos</span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  Anexe arquivos e documentos relacionados a este cliente (máx. 5Mb por arquivo)
                </p>
              </div>
            </div>

            {attachments.length > 0 && (
              <div className="space-y-1.5">
                {attachments.map((att, idx) => (
                  <div
                    key={att.id}
                    className="flex items-center justify-between px-3 py-2 rounded bg-slate-50 border border-slate-200"
                  >
                    <span className="font-mono text-xs font-bold text-[#1e3a6e]">
                      📎 {att.name} ({att.sizeKb} KB — {att.uploadedAt})
                    </span>
                    <button
                      type="button"
                      onClick={() => setAttachments(attachments.filter((_, i) => i !== idx))}
                      className="text-rose-600 hover:underline text-xs font-bold cursor-pointer"
                    >
                      Remover
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() =>
                setAttachments([
                  ...attachments,
                  {
                    id: `att-${Date.now()}`,
                    name: `Contrato_Social_Cartao_CNPJ_${cnpj.replace(/\D/g, '') || 'Cliente'}.pdf`,
                    sizeKb: 312,
                    uploadedAt: new Date().toLocaleDateString('pt-BR'),
                  },
                ])
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded border border-[#1e3a6e] text-[#1e3a6e] hover:bg-blue-50 text-xs font-bold cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Adicionar anexo
            </button>
          </div>

          {/* SECTION 7: ADICIONE OBSERVAÇÕES */}
          <div className="bg-white rounded-md border border-slate-200 p-5 shadow-2xs space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <FileText className="w-4 h-4 text-[#1e3a6e]" />
              <div>
                <h3 className="text-sm font-bold text-slate-800">
                  Adicione <span className="text-[#1e3a6e]">observações</span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  Registre informações adicionais sobre este cliente
                </p>
              </div>
            </div>

            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 rounded border border-slate-300"
            />
          </div>

          {/* FOOTER */}
          <div className="bg-white rounded-md border border-slate-200 p-4 flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded border border-slate-300 text-slate-700 font-bold hover:bg-slate-50 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !docFeedback.isValid}
              className="px-6 py-2.5 rounded bg-[#1e3a6e] hover:bg-[#162b54] text-white font-extrabold cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Salvando...' : isNew ? 'Cadastrar Cliente' : 'Atualizar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// 2. GESTÃOCLICK COMPLETE 7-TAB PRODUCT EDITOR MODAL (FIEL AOS PRINTS 5 e 6)
// ============================================================================
type ProductEditorTabId =
  | 'DADOS'
  | 'DETALHES'
  | 'VALORES'
  | 'ESTOQUE'
  | 'FOTOS'
  | 'FISCAL'
  | 'FORNECEDORES';

export function GestaoClickProductEditModal({
  item,
  isNew = false,
  suppliers = [],
  onClose,
  onSave,
  onShowToast,
}: {
  item: Partial<ErpCatalogItem>;
  isNew?: boolean;
  suppliers?: ErpSupplierRecord[];
  onClose: () => void;
  onSave: (payload: Partial<ErpCatalogItem>) => Promise<void>;
  onShowToast?: (msg: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<ProductEditorTabId>('DADOS');
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState<string>(
    isNew ? (item.name || '') : (item.name || '1000 Etiquetas Termicas 10x15 / 100x150 Em Resma Serrilhada')
  );
  const [gestaoClickCode, setGestaoClickCode] = useState<string>(
    isNew ? (item.gestaoClickCode || '') : (item.gestaoClickCode || 'KIT1000-ETQTERM-TMT')
  );
  const [barcodeEan, setBarcodeEan] = useState<string>(
    isNew ? (item.barcodeEan || '') : (item.barcodeEan || '7905987537095')
  );
  const [productGroup, setProductGroup] = useState<string>(
    item.productGroup ||
      (item.category === 'EQUIPAMENTO_LOCACAO'
        ? 'Ativos Telecom p/ Locação'
        : 'Suprimentos & Hardware')
  );
  const [category] = useState<ErpCatalogItem['category']>(
    item.category || 'EQUIPAMENTO_LOCACAO'
  );
  const [movesStock, setMovesStock] = useState<boolean>(item.movesStock ?? true);
  const [enableNfe, setEnableNfe] = useState<boolean>(item.enableNfe ?? true);
  const [hasVariations, setHasVariations] = useState<boolean>(item.hasVariations ?? false);
  const [hasComposition, setHasComposition] = useState<boolean>(item.hasComposition ?? false);
  const [unitConversionToggle, setUnitConversionToggle] = useState<boolean>(
    item.unitConversionToggle ?? false
  );
  const [unitOfMeasure, setUnitOfMeasure] = useState<string>(item.unitOfMeasure || 'Unidade');
  const [nfeReferences, setNfeReferences] = useState<string[]>(() => {
    if (Array.isArray(item.nfeReferences) && item.nfeReferences.length > 0) {
      return item.nfeReferences;
    }
    return [
      `${item.gestaoClickCode || 'KIT1000-ETQTERM-TMT'} - ${
        item.name || '1000 Etiquetas Termicas 10x15 / 100x150 Em Resma Serrilhada'
      }`,
    ];
  });
  const [newNfeRefInput, setNewNfeRefInput] = useState<string>('');

  const [netWeightKg, setNetWeightKg] = useState<number>(item.netWeightKg ?? 1.2);
  const [grossWeightKg, setGrossWeightKg] = useState<number>(item.grossWeightKg ?? 1.45);
  const [widthCm, setWidthCm] = useState<number>(item.widthCm ?? 22);
  const [heightCm, setHeightCm] = useState<number>(item.heightCm ?? 8);
  const [lengthCm, setLengthCm] = useState<number>(item.lengthCm ?? 18);
  const [brand, setBrand] = useState<string>(item.brand || 'Seta Telecom / Homologado Anatel');
  const [modelName, setModelName] = useState<string>(item.modelName || gestaoClickCode);
  const [warrantyMonths, setWarrantyMonths] = useState<number>(item.warrantyMonths ?? 12);
  const [controlsSerialNumber, setControlsSerialNumber] = useState<boolean>(
    item.controlsSerialNumber ?? true
  );

  const [costPrice, setCostPrice] = useState<number>(
    item.costPrice ?? Math.round(Number(item.saleOrSetupPrice || 1200) * 0.55 * 100) / 100
  );
  const [accessoryExpenses, setAccessoryExpenses] = useState<number>(
    item.accessoryExpenses ?? 0
  );
  const [profitMarginPercent, setProfitMarginPercent] = useState<number>(
    item.profitMarginPercent ?? 81.8
  );
  const [saleOrSetupPrice, setSaleOrSetupPrice] = useState<number>(
    item.saleOrSetupPrice ?? 1890
  );
  const [wholesalePrice, setWholesalePrice] = useState<number>(
    item.wholesalePrice ?? Math.round(Number(item.saleOrSetupPrice || 1890) * 0.9 * 100) / 100
  );
  const [monthlyRentalPrice, setMonthlyRentalPrice] = useState<number>(
    item.monthlyRentalPrice ?? 250
  );
  const [assetValueBrl, setAssetValueBrl] = useState<number>(
    item.assetValueBrl ?? Number(item.saleOrSetupPrice || 1890)
  );

  const [stockAvailable, setStockAvailable] = useState<number>(item.stockAvailable ?? 15);
  const [stockRentedInClients, setStockRentedInClients] = useState<number>(
    item.stockRentedInClients ?? 10
  );
  const [minStock, setMinStock] = useState<number>(item.minStock ?? 5);
  const [maxStock, setMaxStock] = useState<number>(item.maxStock ?? 100);
  const [warehouseLocation, setWarehouseLocation] = useState<string>(
    item.warehouseLocation || 'Almoxarifado Matriz #118887 • Corredor Telecom A-02'
  );
  const [stockMovements, setStockMovements] = useState<
    NonNullable<ErpCatalogItem['stockMovements']>
  >(() =>
    Array.isArray(item.stockMovements) && item.stockMovements.length > 0
      ? item.stockMovements
      : [
          {
            id: 'mov-1',
            date: '14/10/2026',
            type: 'ENTRADA',
            quantity: 20,
            documentRef: 'NF-e Entrada #9759 (CFOP 1.551)',
            notes: 'Aquisição para estoque / parque de locação Matriz',
          },
          {
            id: 'mov-2',
            date: '20/10/2026',
            type: 'REMESSA_LOCACAO',
            quantity: 5,
            documentRef: 'NF-e Remessa #000.412.890 (CFOP 5.908)',
            notes: 'Alocação em contrato de locação ativo (S/N rastreado)',
          },
        ]
  );
  const [newMovType, setNewMovType] = useState<
    'ENTRADA' | 'SAIDA' | 'REMESSA_LOCACAO' | 'RETORNO_LOCACAO'
  >('ENTRADA');
  const [newMovQty, setNewMovQty] = useState<number>(5);
  const [newMovDoc, setNewMovDoc] = useState<string>('NF-e #9810');
  const [newMovNotes, setNewMovNotes] = useState<string>('Movimentação manual de estoque');

  const [fiscalNature, setFiscalNature] = useState<ErpFiscalNature>(
    item.fiscalNature || 'LOCACAO_BENS_MOVEIS'
  );
  const [ncmOrLc116, setNcmOrLc116] = useState<string>(
    item.ncmOrLc116 || 'NCM 8517.62.59 (Não Incidência ISS - SV 31 STF)'
  );
  const [cest, setCest] = useState<string>(item.cest || '21.109.00');
  const [merchandiseOrigin, setMerchandiseOrigin] = useState<string>(
    item.merchandiseOrigin || '0 - Nacional, exceto as indicadas nos códigos 3, 4, 5 e 8'
  );
  const [cfopDefault, setCfopDefault] = useState<string>(item.cfopDefault || '5.102');
  const [cfopRemessaLocacao, setCfopRemessaLocacao] = useState<string>(
    item.cfopRemessaLocacao || '5.908'
  );
  const [cfopRetornoLocacao, setCfopRetornoLocacao] = useState<string>(
    item.cfopRetornoLocacao || '5.909'
  );
  const [cstIcms, setCstIcms] = useState<string>(
    item.cstIcms || '041 - Não tributada (Art. 7º, IX RICMS/SP Locação)'
  );
  const [cstPisCofins, setCstPisCofins] = useState<string>(
    item.cstPisCofins || '01 - Operação Tributável Alíquota Básica (PIS 0,65% / COFINS 3,00%)'
  );
  const [ipiRatePercent, setIpiRatePercent] = useState<number>(item.ipiRatePercent ?? 0);

  const [suppliersList, setSuppliersList] = useState<
    NonNullable<ErpCatalogItem['suppliersList']>
  >(() =>
    Array.isArray(item.suppliersList) && item.suppliersList.length > 0
      ? item.suppliersList
      : [
          {
            supplierName:
              suppliers[0]?.legalName || 'AGIS EQUIPAMENTOS E SERVICOS DE INFORMATICA LTDA.',
            supplierCnpj: suppliers[0]?.cnpj || '68.993.641/0008-02',
            supplierSku: `FORN-${gestaoClickCode}`,
            lastPurchaseCost: costPrice,
          },
        ]
  );

  const navTabs: Array<{
    id: ProductEditorTabId;
    title: string;
    subtitle: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'DADOS', title: 'Dados', subtitle: 'Nome, códigos e configurações', icon: Package },
    { id: 'DETALHES', title: 'Detalhes', subtitle: 'Pesos, dimensões e campos extras', icon: Sliders },
    { id: 'VALORES', title: 'Valores', subtitle: 'Custo e valores de venda', icon: DollarSign },
    { id: 'ESTOQUE', title: 'Estoque', subtitle: 'Quantidades e limites por loja', icon: Boxes },
    { id: 'FOTOS', title: 'Fotos', subtitle: 'Imagens do produto', icon: Camera },
    { id: 'FISCAL', title: 'Fiscal', subtitle: 'NCM, CEST, origem e regras', icon: Receipt },
    { id: 'FORNECEDORES', title: 'Fornecedores', subtitle: 'Quem fornece este produto', icon: Truck },
  ];

  const handleRegisterStockMovement = () => {
    const qty = Math.max(1, Number(newMovQty) || 1);
    const entry = {
      id: `mov-${Date.now()}`,
      date: new Date().toLocaleDateString('pt-BR'),
      type: newMovType,
      quantity: qty,
      documentRef: newMovDoc || 'Ajuste Manual',
      notes: newMovNotes || '',
    };
    setStockMovements([entry, ...stockMovements]);
    if (newMovType === 'ENTRADA') {
      setStockAvailable((s) => s + qty);
    } else if (newMovType === 'SAIDA') {
      setStockAvailable((s) => Math.max(0, s - qty));
    } else if (newMovType === 'REMESSA_LOCACAO') {
      setStockAvailable((s) => Math.max(0, s - qty));
      setStockRentedInClients((r) => r + qty);
    } else if (newMovType === 'RETORNO_LOCACAO') {
      setStockAvailable((s) => s + qty);
      setStockRentedInClients((r) => Math.max(0, r - qty));
    }
    onShowToast?.(`Movimentação (${newMovType}: ${qty} un.) aplicada ao estoque!`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        ...item,
        name: name.trim(),
        gestaoClickCode: gestaoClickCode.trim(),
        barcodeEan: barcodeEan.trim(),
        productGroup,
        category,
        movesStock,
        enableNfe,
        hasVariations,
        hasComposition,
        unitConversionToggle,
        unitOfMeasure,
        nfeReferences,
        netWeightKg,
        grossWeightKg,
        widthCm,
        heightCm,
        lengthCm,
        brand,
        modelName,
        warrantyMonths,
        controlsSerialNumber,
        costPrice,
        accessoryExpenses,
        profitMarginPercent,
        saleOrSetupPrice,
        wholesalePrice,
        monthlyRentalPrice,
        assetValueBrl,
        stockAvailable,
        stockRentedInClients,
        minStock,
        maxStock,
        warehouseLocation,
        stockMovements,
        fiscalNature,
        ncmOrLc116,
        cest,
        merchandiseOrigin,
        cfopDefault,
        cfopRemessaLocacao,
        cfopRetornoLocacao,
        cstIcms,
        cstPisCofins,
        ipiRatePercent,
        suppliersList,
        isActive: true,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/75 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-[#f3f5f8] rounded-lg border border-slate-300 shadow-2xl max-w-6xl w-full overflow-hidden my-4">
        <div className="bg-white px-6 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Edit3 className="w-5 h-5 text-slate-700" />
            <h2 className="text-lg font-bold text-slate-800">
              {isNew ? 'Adicionar produto' : 'Editar produto'}
            </h2>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-xs text-slate-500 hidden sm:flex items-center gap-1.5">
              <span>🏠 Início</span>
              <span>&gt;</span>
              <span>Produtos</span>
              <span>&gt;</span>
              <strong className="text-slate-800">{isNew ? 'Adicionar' : 'Editar'}</strong>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 text-xs max-h-[84vh] overflow-y-auto">
          <div className="flex flex-col lg:flex-row gap-5">
            <div className="w-full lg:w-64 shrink-0 bg-white rounded-md border border-slate-200 overflow-hidden self-start">
              {navTabs.map((t) => {
                const Icon = t.icon;
                const isSelected = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setActiveTab(t.id)}
                    className={`w-full px-4 py-3.5 text-left flex items-start gap-3 border-b border-slate-100 last:border-b-0 transition cursor-pointer ${
                      isSelected
                        ? 'bg-[#1e3a6e] text-white'
                        : 'bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 mt-0.5 shrink-0 ${
                        isSelected ? 'text-white' : 'text-[#1e3a6e]'
                      }`}
                    />
                    <div>
                      <div className="font-bold text-xs">{t.title}</div>
                      <div
                        className={`text-[10px] ${
                          isSelected ? 'text-slate-200' : 'text-slate-400'
                        }`}
                      >
                        {t.subtitle}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex-1 space-y-5">
              {activeTab === 'DADOS' && (
                <>
                  <div className="bg-white rounded-md border border-slate-200 p-5 shadow-2xs space-y-4">
                    <div className="border-b border-slate-100 pb-3">
                      <h3 className="text-sm font-bold text-slate-800">
                        ✏️ Informe os <span className="text-[#1e3a6e]">dados principais</span> do produto
                      </h3>
                      <p className="text-[11px] text-slate-400">
                        Defina nome, códigos, grupo e configurações gerais do item
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5">
                      <div className="sm:col-span-4">
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Nome <span className="text-rose-600">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="w-full px-3 py-2 rounded border border-slate-300"
                        />
                      </div>

                      <div className="sm:col-span-3">
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Código interno <span className="text-rose-600">*</span>
                        </label>
                        <div className="flex">
                          <input
                            type="text"
                            required
                            value={gestaoClickCode}
                            onChange={(e) => setGestaoClickCode(e.target.value)}
                            className="w-full px-3 py-2 rounded-l border border-slate-300 font-mono"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setGestaoClickCode(
                                `GC-EQ-${Math.floor(10000 + Math.random() * 90000)}`
                              )
                            }
                            className="px-3 py-2 rounded-r border border-l-0 border-slate-300 bg-slate-50 hover:bg-slate-100 font-bold text-slate-700 cursor-pointer"
                          >
                            Gerar
                          </button>
                        </div>
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Código de barra
                        </label>
                        <input
                          type="text"
                          value={barcodeEan}
                          onChange={(e) => setBarcodeEan(e.target.value)}
                          className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
                        />
                      </div>

                      <div className="sm:col-span-3">
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Grupo do produto
                        </label>
                        <input
                          type="text"
                          value={productGroup}
                          onChange={(e) => setProductGroup(e.target.value)}
                          placeholder="Digite para buscar"
                          className="w-full px-3 py-2 rounded border border-slate-300"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Movimenta estoque?
                        </label>
                        <select
                          value={movesStock ? 'Sim' : 'Não'}
                          onChange={(e) => setMovesStock(e.target.value === 'Sim')}
                          className="w-full px-3 py-2 rounded border border-slate-300 bg-white"
                        >
                          <option value="Sim">Sim</option>
                          <option value="Não">Não</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Habilitar nota fiscal?
                        </label>
                        <select
                          value={enableNfe ? 'Sim' : 'Não'}
                          onChange={(e) => setEnableNfe(e.target.value === 'Sim')}
                          className="w-full px-3 py-2 rounded border border-slate-300 bg-white"
                        >
                          <option value="Sim">Sim</option>
                          <option value="Não">Não</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Possui variações?
                        </label>
                        <select
                          value={hasVariations ? 'Sim' : 'Não'}
                          onChange={(e) => setHasVariations(e.target.value === 'Sim')}
                          className="w-full px-3 py-2 rounded border border-slate-300 bg-white"
                        >
                          <option value="Não">Não</option>
                          <option value="Sim">Sim</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Possui composição?
                        </label>
                        <select
                          value={hasComposition ? 'Sim' : 'Não'}
                          onChange={(e) => setHasComposition(e.target.value === 'Sim')}
                          className="w-full px-3 py-2 rounded border border-slate-300 bg-white"
                        >
                          <option value="Não">Não</option>
                          <option value="Sim">Sim</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-md border border-slate-200 p-5 shadow-2xs space-y-4">
                    <div className="border-b border-slate-100 pb-3">
                      <h3 className="text-sm font-bold text-slate-800">
                        ⚖️ Defina a <span className="text-[#1e3a6e]">unidade de medida</span> do produto
                      </h3>
                      <p className="text-[11px] text-slate-400">
                        Configure como o produto é medido na compra e na venda
                      </p>
                    </div>

                    <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={unitConversionToggle}
                        onChange={(e) => setUnitConversionToggle(e.target.checked)}
                        className="w-4 h-4 accent-[#1e3a6e]"
                      />
                      <div>
                        <span className="font-bold text-slate-800 block">
                          Compro em uma unidade e vendo em outra
                        </span>
                        <span className="text-[11px] text-slate-400 block">
                          Cadastre a conversão entre a unidade de compra e a de venda
                        </span>
                      </div>
                    </label>

                    <div className="max-w-sm">
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Unidade de medida <span className="text-rose-600">*</span>
                      </label>
                      <div className="flex">
                        <input
                          type="text"
                          value={unitOfMeasure}
                          onChange={(e) => setUnitOfMeasure(e.target.value)}
                          className="w-full px-3 py-2 rounded-l border border-slate-300"
                        />
                        <button
                          type="button"
                          onClick={() => setUnitOfMeasure('Unidade')}
                          className="px-3 py-2 rounded-r border border-l-0 border-slate-300 bg-slate-50 text-slate-500 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-md border border-slate-200 p-5 shadow-2xs space-y-4">
                    <div className="border-b border-slate-100 pb-3">
                      <h3 className="text-sm font-bold text-slate-800">
                        📄 Confira as <span className="text-[#1e3a6e]">referências de NF-e</span> deste produto
                      </h3>
                      <p className="text-[11px] text-slate-400">
                        Usadas na importação de XML: quando o nome do produto no sistema difere do nome na nota, a referência faz o vínculo
                      </p>
                    </div>

                    <div className="border border-slate-200 rounded overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                          <tr>
                            <th className="py-2 px-3">Produto</th>
                            <th className="py-2 px-3 w-20 text-center">Delete</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {nfeReferences.map((ref, idx) => (
                            <tr key={idx}>
                              <td className="py-2.5 px-3 font-medium text-slate-700">{ref}</td>
                              <td className="py-2.5 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setNfeReferences(nfeReferences.filter((_, i) => i !== idx))
                                  }
                                  className="px-2.5 py-1 rounded bg-rose-500 hover:bg-rose-600 text-white font-bold cursor-pointer"
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newNfeRefInput}
                        onChange={(e) => setNewNfeRefInput(e.target.value)}
                        placeholder="Adicionar nova referência de XML NF-e..."
                        className="flex-1 px-3 py-1.5 rounded border border-slate-300"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!newNfeRefInput.trim()) return;
                          setNfeReferences([...nfeReferences, newNfeRefInput.trim()]);
                          setNewNfeRefInput('');
                        }}
                        className="px-3.5 py-1.5 rounded bg-[#1e3a6e] text-white font-bold cursor-pointer"
                      >
                        + Vincular Referência XML
                      </button>
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'DETALHES' && (
                <div className="bg-white rounded-md border border-slate-200 p-5 shadow-2xs space-y-4">
                  <div className="border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-bold text-slate-800">
                      📐 Pesos, <span className="text-[#1e3a6e]">dimensões e campos extras</span>
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Especificações físicas para cálculo de frete, garantia e rastreabilidade por S/N
                    </p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Peso Líquido (kg)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={netWeightKg}
                        onChange={(e) => setNetWeightKg(Number(e.target.value) || 0)}
                        className="w-full px-3 py-2 rounded border border-slate-300"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Peso Bruto (kg)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={grossWeightKg}
                        onChange={(e) => setGrossWeightKg(Number(e.target.value) || 0)}
                        className="w-full px-3 py-2 rounded border border-slate-300"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Largura (cm)
                      </label>
                      <input
                        type="number"
                        value={widthCm}
                        onChange={(e) => setWidthCm(Number(e.target.value) || 0)}
                        className="w-full px-3 py-2 rounded border border-slate-300"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Altura (cm)
                      </label>
                      <input
                        type="number"
                        value={heightCm}
                        onChange={(e) => setHeightCm(Number(e.target.value) || 0)}
                        className="w-full px-3 py-2 rounded border border-slate-300"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Comprimento (cm)
                      </label>
                      <input
                        type="number"
                        value={lengthCm}
                        onChange={(e) => setLengthCm(Number(e.target.value) || 0)}
                        className="w-full px-3 py-2 rounded border border-slate-300"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Marca / Fabricante
                      </label>
                      <input
                        type="text"
                        value={brand}
                        onChange={(e) => setBrand(e.target.value)}
                        className="w-full px-3 py-2 rounded border border-slate-300"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Modelo Técnico
                      </label>
                      <input
                        type="text"
                        value={modelName}
                        onChange={(e) => setModelName(e.target.value)}
                        className="w-full px-3 py-2 rounded border border-slate-300"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Garantia Padrão (Meses)
                      </label>
                      <input
                        type="number"
                        value={warrantyMonths}
                        onChange={(e) => setWarrantyMonths(Number(e.target.value) || 12)}
                        className="w-full px-3 py-2 rounded border border-slate-300"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Exige Número de Série (S/N)?
                      </label>
                      <select
                        value={controlsSerialNumber ? 'Sim' : 'Não'}
                        onChange={(e) => setControlsSerialNumber(e.target.value === 'Sim')}
                        className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-bold"
                      >
                        <option value="Sim">Sim (Rastrear S/N &amp; Patrimônio)</option>
                        <option value="Não">Não</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'VALORES' && (
                <div className="bg-white rounded-md border border-slate-200 p-5 shadow-2xs space-y-4">
                  <div className="border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-bold text-slate-800">
                      💰 Custo, <span className="text-[#1e3a6e]">margem de lucro e valores de locação / venda</span>
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Configure o preço de custo de aquisição, venda avulsa, locação recorrente mensal e valor patrimonial p/ NF-e de Remessa
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Valor de Custo (R$)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={costPrice}
                        onChange={(e) => setCostPrice(Number(e.target.value) || 0)}
                        className="w-full px-3 py-2 rounded border border-slate-300 font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Despesas Acessórias / IPI / Frete (R$)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={accessoryExpenses}
                        onChange={(e) => setAccessoryExpenses(Number(e.target.value) || 0)}
                        className="w-full px-3 py-2 rounded border border-slate-300"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Margem de Lucro Alvo (%)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        value={profitMarginPercent}
                        onChange={(e) => setProfitMarginPercent(Number(e.target.value) || 0)}
                        className="w-full px-3 py-2 rounded border border-slate-300 font-bold text-indigo-800"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3.5 pt-2">
                    <div className="p-3 rounded bg-emerald-50 border border-emerald-200">
                      <label className="block text-[11px] font-extrabold text-emerald-900 mb-1">
                        Locação Mensal Recorrente (R$)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={monthlyRentalPrice}
                        onChange={(e) => setMonthlyRentalPrice(Number(e.target.value) || 0)}
                        className="w-full px-3 py-2 rounded border border-emerald-300 bg-white font-black text-emerald-800"
                      />
                    </div>
                    <div className="p-3 rounded bg-slate-50 border border-slate-200">
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        Venda Varejo / Setup (R$)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={saleOrSetupPrice}
                        onChange={(e) => setSaleOrSetupPrice(Number(e.target.value) || 0)}
                        className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-bold"
                      />
                    </div>
                    <div className="p-3 rounded bg-slate-50 border border-slate-200">
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        Venda Atacado / Corporativo (R$)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={wholesalePrice}
                        onChange={(e) => setWholesalePrice(Number(e.target.value) || 0)}
                        className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-bold"
                      />
                    </div>
                    <div className="p-3 rounded bg-indigo-50 border border-indigo-200">
                      <label className="block text-[11px] font-extrabold text-indigo-900 mb-1">
                        Valor Patrimonial Remessa CFOP 5.908
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={assetValueBrl}
                        onChange={(e) => setAssetValueBrl(Number(e.target.value) || 0)}
                        className="w-full px-3 py-2 rounded border border-indigo-300 bg-white font-black text-indigo-900"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'ESTOQUE' && (
                <div className="bg-white rounded-md border border-slate-200 p-5 shadow-2xs space-y-4">
                  <div className="border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-bold text-slate-800">
                      📦 Quantidades, <span className="text-[#1e3a6e]">limites por loja e movimentações (Entrada / Saída / Locação)</span>
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Controle de saldo em almoxarifado, unidades locadas em clientes e livro kardex de entradas/saídas
                    </p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    <div className="p-3 rounded bg-emerald-50 border border-emerald-200">
                      <label className="block text-[10px] font-bold uppercase text-emerald-800 mb-1">
                        Disponível Matriz
                      </label>
                      <input
                        type="number"
                        value={stockAvailable}
                        onChange={(e) => setStockAvailable(Number(e.target.value) || 0)}
                        className="w-full px-2.5 py-1.5 rounded border border-emerald-300 bg-white font-black text-emerald-900"
                      />
                    </div>
                    <div className="p-3 rounded bg-indigo-50 border border-indigo-200">
                      <label className="block text-[10px] font-bold uppercase text-indigo-800 mb-1">
                        Locado em Clientes
                      </label>
                      <input
                        type="number"
                        value={stockRentedInClients}
                        onChange={(e) => setStockRentedInClients(Number(e.target.value) || 0)}
                        className="w-full px-2.5 py-1.5 rounded border border-indigo-300 bg-white font-black text-indigo-900"
                      />
                    </div>
                    <div className="p-3 rounded bg-slate-50 border border-slate-200">
                      <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                        Estoque Mínimo
                      </label>
                      <input
                        type="number"
                        value={minStock}
                        onChange={(e) => setMinStock(Number(e.target.value) || 0)}
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-bold"
                      />
                    </div>
                    <div className="p-3 rounded bg-slate-50 border border-slate-200">
                      <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                        Estoque Máximo
                      </label>
                      <input
                        type="number"
                        value={maxStock}
                        onChange={(e) => setMaxStock(Number(e.target.value) || 0)}
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-bold"
                      />
                    </div>
                    <div className="p-3 rounded bg-slate-50 border border-slate-200 col-span-2 sm:col-span-1">
                      <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                        Endereçamento
                      </label>
                      <input
                        type="text"
                        value={warehouseLocation}
                        onChange={(e) => setWarehouseLocation(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white text-[11px]"
                      />
                    </div>
                  </div>

                  <div className="p-3.5 rounded bg-slate-50 border border-slate-200 space-y-2.5">
                    <div className="font-extrabold text-slate-800 uppercase text-[11px]">
                      Registrar Nova Movimentação de Estoque (Entrada / Saída / Remessa / Retorno)
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                      <div className="sm:col-span-3">
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">
                          Operação
                        </label>
                        <select
                          value={newMovType}
                          onChange={(e) =>
                            setNewMovType(
                              e.target.value as
                                | 'ENTRADA'
                                | 'SAIDA'
                                | 'REMESSA_LOCACAO'
                                | 'RETORNO_LOCACAO'
                            )
                          }
                          className="w-full px-2.5 py-1.5 rounded border bg-white font-bold"
                        >
                          <option value="ENTRADA">➕ Entrada de Compra (NF-e)</option>
                          <option value="SAIDA">➖ Saída / Baixa de Venda</option>
                          <option value="REMESSA_LOCACAO">🚚 Remessa p/ Locação (CFOP 5.908)</option>
                          <option value="RETORNO_LOCACAO">↩️ Retorno de Locação (CFOP 5.909)</option>
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">Qtd</label>
                        <input
                          type="number"
                          min={1}
                          value={newMovQty}
                          onChange={(e) => setNewMovQty(Number(e.target.value) || 1)}
                          className="w-full px-2.5 py-1.5 rounded border bg-white font-bold"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">
                          Documento Fiscal / Ref.
                        </label>
                        <input
                          type="text"
                          value={newMovDoc}
                          onChange={(e) => setNewMovDoc(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded border bg-white"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">
                          Observação / S/N
                        </label>
                        <input
                          type="text"
                          value={newMovNotes}
                          onChange={(e) => setNewMovNotes(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded border bg-white"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <button
                          type="button"
                          onClick={handleRegisterStockMovement}
                          className="w-full py-1.5 px-3 rounded bg-[#1e3a6e] hover:bg-[#162b54] text-white font-extrabold cursor-pointer"
                        >
                          Lançar Kardex
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-900 text-white text-[10px] uppercase">
                        <tr>
                          <th className="py-2 px-3">Data</th>
                          <th className="py-2 px-3">Tipo</th>
                          <th className="py-2 px-3 text-right">Qtd</th>
                          <th className="py-2 px-3">Documento Ref.</th>
                          <th className="py-2 px-3">Histórico / Observações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {stockMovements.map((m) => (
                          <tr key={m.id}>
                            <td className="py-2 px-3 font-mono">{m.date}</td>
                            <td className="py-2 px-3">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${
                                  m.type === 'ENTRADA' || m.type === 'RETORNO_LOCACAO'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {m.type}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-right font-black">{m.quantity}</td>
                            <td className="py-2 px-3 font-mono font-bold text-[#1e3a6e]">
                              {m.documentRef}
                            </td>
                            <td className="py-2 px-3 text-slate-600">{m.notes}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'FOTOS' && (
                <div className="bg-white rounded-md border border-slate-200 p-5 shadow-2xs space-y-4">
                  <div className="border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-bold text-slate-800">
                      🖼️ Imagens <span className="text-[#1e3a6e]">do produto</span>
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Fotos exibidas no catálogo comercial, PDV Balcão e propostas em PDF
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-28 h-28 rounded border border-slate-200 bg-slate-50 flex flex-col items-center justify-center text-slate-400">
                      <Package className="w-8 h-8 mb-1 text-[#1e3a6e]" />
                      <span className="text-[10px] font-mono">{gestaoClickCode}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onShowToast?.('Imagem do produto vinculada com sucesso!')}
                      className="px-4 py-2 rounded bg-[#1e3a6e] text-white font-bold cursor-pointer"
                    >
                      + Enviar Imagem do Produto
                    </button>
                  </div>
                </div>
              )}

              {activeTab === 'FISCAL' && (
                <div className="bg-white rounded-md border border-slate-200 p-5 shadow-2xs space-y-4">
                  <div className="border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-bold text-slate-800">
                      🧾 NCM, CEST, <span className="text-[#1e3a6e]">origem e regras fiscais (LC 116 / SV 31 STF / RICMS)</span>
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Parametrização tributária inspirada no motor OCA/l10n-brazil &amp; ERPNext Fiscal BR
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Natureza Fiscal Padrão
                      </label>
                      <select
                        value={fiscalNature}
                        onChange={(e) => setFiscalNature(e.target.value as ErpFiscalNature)}
                        className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-bold"
                      >
                        <option value="LOCACAO_BENS_MOVEIS">
                          Locação de Bens Móveis (0% ISS — SV 31 STF)
                        </option>
                        <option value="VENDA_EQUIPAMENTO">
                          Venda de Equipamento / Mercadoria (ICMS)
                        </option>
                        <option value="SERVICO_TECNICO_TI_TELECOM">
                          Serviço Técnico TI/Telecom (LC 116 Item 01.07)
                        </option>
                        <option value="SERVICO_COMUNICACAO_SCM_SVA">
                          Telecom SCM / SVA (NFCom Mod. 62)
                        </option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Código NCM (8 dígitos) / Item LC 116 *
                      </label>
                      <input
                        type="text"
                        value={ncmOrLc116}
                        onChange={(e) => setNcmOrLc116(e.target.value)}
                        className="w-full px-3 py-2 rounded border border-slate-300 font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Código CEST
                      </label>
                      <input
                        type="text"
                        value={cest}
                        onChange={(e) => setCest(e.target.value)}
                        className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5">
                    <div className="sm:col-span-6">
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Origem da Mercadoria (Tabela A ICMS)
                      </label>
                      <select
                        value={merchandiseOrigin}
                        onChange={(e) => setMerchandiseOrigin(e.target.value)}
                        className="w-full px-3 py-2 rounded border border-slate-300 bg-white"
                      >
                        <option value="0 - Nacional, exceto as indicadas nos códigos 3, 4, 5 e 8">
                          0 - Nacional, exceto as indicadas nos códigos 3, 4, 5 e 8
                        </option>
                        <option value="1 - Estrangeira - Importação direta">
                          1 - Estrangeira - Importação direta
                        </option>
                        <option value="2 - Estrangeira - Adquirida no mercado interno">
                          2 - Estrangeira - Adquirida no mercado interno
                        </option>
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        CFOP Venda
                      </label>
                      <input
                        type="text"
                        value={cfopDefault}
                        onChange={(e) => setCfopDefault(e.target.value)}
                        className="w-full px-3 py-2 rounded border border-slate-300 font-mono font-bold"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        CFOP Remessa Locação
                      </label>
                      <input
                        type="text"
                        value={cfopRemessaLocacao}
                        onChange={(e) => setCfopRemessaLocacao(e.target.value)}
                        className="w-full px-3 py-2 rounded border border-slate-300 font-mono font-bold text-indigo-800"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        CFOP Retorno Locação
                      </label>
                      <input
                        type="text"
                        value={cfopRetornoLocacao}
                        onChange={(e) => setCfopRetornoLocacao(e.target.value)}
                        className="w-full px-3 py-2 rounded border border-slate-300 font-mono font-bold text-emerald-800"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Situação Tributária ICMS (CST / CSOSN)
                      </label>
                      <input
                        type="text"
                        value={cstIcms}
                        onChange={(e) => setCstIcms(e.target.value)}
                        className="w-full px-3 py-2 rounded border border-slate-300"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        CST PIS / COFINS
                      </label>
                      <input
                        type="text"
                        value={cstPisCofins}
                        onChange={(e) => setCstPisCofins(e.target.value)}
                        className="w-full px-3 py-2 rounded border border-slate-300"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Alíquota IPI (%)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={ipiRatePercent}
                        onChange={(e) => setIpiRatePercent(Number(e.target.value) || 0)}
                        className="w-full px-3 py-2 rounded border border-slate-300"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'FORNECEDORES' && (
                <div className="bg-white rounded-md border border-slate-200 p-5 shadow-2xs space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-800">
                        🚚 Quem <span className="text-[#1e3a6e]">fornece este produto</span>
                      </h3>
                      <p className="text-[11px] text-slate-400">
                        Fornecedores homologados, código SKU no fornecedor e último custo de nota de entrada
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setSuppliersList([
                          ...suppliersList,
                          {
                            supplierName: '2M TELECON SERVICOS EM TECNOLOGIA LTDA',
                            supplierCnpj: '39.830.314/0001-57',
                            supplierSku: `2M-${gestaoClickCode}`,
                            lastPurchaseCost: costPrice,
                          },
                        ])
                      }
                      className="px-3 py-1.5 rounded bg-[#1e3a6e] text-white font-bold cursor-pointer"
                    >
                      + Vincular Fornecedor
                    </button>
                  </div>

                  <div className="space-y-2">
                    {suppliersList.map((sup, idx) => (
                      <div
                        key={idx}
                        className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end p-3 rounded bg-slate-50 border border-slate-200"
                      >
                        <div className="sm:col-span-4">
                          <label className="block text-[10px] font-bold text-slate-500 mb-1">
                            Razão Social do Fornecedor
                          </label>
                          <input
                            type="text"
                            value={sup.supplierName}
                            onChange={(e) => {
                              const copy = [...suppliersList];
                              copy[idx] = { ...copy[idx], supplierName: e.target.value };
                              setSuppliersList(copy);
                            }}
                            className="w-full px-2.5 py-1.5 rounded border bg-white font-bold"
                          />
                        </div>
                        <div className="sm:col-span-3">
                          <label className="block text-[10px] font-bold text-slate-500 mb-1">
                            CNPJ
                          </label>
                          <input
                            type="text"
                            value={sup.supplierCnpj}
                            onChange={(e) => {
                              const copy = [...suppliersList];
                              copy[idx] = { ...copy[idx], supplierCnpj: e.target.value };
                              setSuppliersList(copy);
                            }}
                            className="w-full px-2.5 py-1.5 rounded border bg-white font-mono"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[10px] font-bold text-slate-500 mb-1">
                            Código no Fornecedor
                          </label>
                          <input
                            type="text"
                            value={sup.supplierSku}
                            onChange={(e) => {
                              const copy = [...suppliersList];
                              copy[idx] = { ...copy[idx], supplierSku: e.target.value };
                              setSuppliersList(copy);
                            }}
                            className="w-full px-2.5 py-1.5 rounded border bg-white font-mono"
                          />
                        </div>
                        <div className="sm:col-span-3 flex gap-1.5">
                          <div className="flex-1">
                            <label className="block text-[10px] font-bold text-slate-500 mb-1">
                              Último Custo (R$)
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              value={sup.lastPurchaseCost}
                              onChange={(e) => {
                                const copy = [...suppliersList];
                                copy[idx] = {
                                  ...copy[idx],
                                  lastPurchaseCost: Number(e.target.value) || 0,
                                };
                                setSuppliersList(copy);
                              }}
                              className="w-full px-2.5 py-1.5 rounded border bg-white font-bold"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setSuppliersList(suppliersList.filter((_, i) => i !== idx))
                            }
                            className="px-2.5 py-1.5 rounded border border-rose-200 bg-rose-50 text-rose-600 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-white rounded-md border border-slate-200 p-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 rounded bg-[#1e3a6e] hover:bg-[#162b54] text-white font-extrabold cursor-pointer shadow-sm"
                >
                  {saving ? 'Salvando...' : isNew ? 'Cadastrar Produto' : 'Atualizar'}
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// 3. PARTIAL EQUIPMENT RETURN & PRO-RATA SPLIT MODAL (SEM PAUSAR O CONTRATO)
// ============================================================================
export function PartialEquipmentReturnProRataModal({
  contract,
  onClose,
  onSuccess,
  onShowToast,
}: {
  contract: ErpRentalContract;
  onClose: () => void;
  onSuccess: (payload: {
    contract: ErpRentalContract;
    returnNfe: ErpFiscalInvoice | null;
    proRataInvoice: ErpFiscalInvoice | null;
  }) => Promise<void>;
  onShowToast?: (msg: string) => void;
}) {
  const [returnDate, setReturnDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [cycleDaysUsed, setCycleDaysUsed] = useState<number>(15);
  const [emitReturnNfe, setEmitReturnNfe] = useState<boolean>(true);
  const [emitProRataInvoice, setEmitProRataInvoice] = useState<boolean>(true);
  const [reason, setReason] = useState<string>(
    'Devolução parcial de equipamentos com rateio proporcional (Pro-Rata Die) mantendo contrato ATIVO'
  );
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Default: pre-select 2 units of the largest multi-unit equipment line so user sees the 2-of-10+ pro-rata calculation immediately
  const [qtyMap, setQtyMap] = useState<Record<number, number>>(() => {
    const initial: Record<number, number> = {};
    const multiIdx = contract.equipments.findIndex(
      (e) => e.assetStatus !== 'DEVOLVIDO' && e.quantity >= 2
    );
    if (multiIdx >= 0) {
      initial[multiIdx] = Math.min(2, contract.equipments[multiIdx].quantity);
    } else if (contract.equipments.length > 0) {
      initial[0] = 1;
    }
    return initial;
  });

  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

  const previousMonthlyValue = Number(contract.monthlyValue || 0);
  const daysClamped = Math.min(30, Math.max(1, Number(cycleDaysUsed || 15)));

  let totalMonthlyReductionBrl = 0;
  let totalProRataReturnedBrl = 0;
  let totalUnitsReturned = 0;

  contract.equipments.forEach((eq, idx) => {
    if (eq.assetStatus === 'DEVOLVIDO' || eq.quantity <= 0) return;
    const qtyRet = Math.min(eq.quantity, Math.max(0, Number(qtyMap[idx] || 0)));
    if (qtyRet > 0) {
      const reduction = round2(qtyRet * eq.unitMonthlyRent);
      const proRata = round2(reduction * (daysClamped / 30));
      totalMonthlyReductionBrl = round2(totalMonthlyReductionBrl + reduction);
      totalProRataReturnedBrl = round2(totalProRataReturnedBrl + proRata);
      totalUnitsReturned += qtyRet;
    }
  });

  const newRecurringMonthlyValue = Math.max(
    0,
    round2(previousMonthlyValue - totalMonthlyReductionBrl)
  );
  const currentCycleProRataTotalBrl = round2(
    newRecurringMonthlyValue + totalProRataReturnedBrl
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const itemsToReturn = Object.entries(qtyMap)
      .map(([idxStr, qty]) => ({
        equipmentIdx: Number(idxStr),
        quantityReturned: Number(qty || 0),
      }))
      .filter((x) => x.quantityReturned > 0);

    if (itemsToReturn.length === 0) {
      onShowToast?.('Selecione ao menos 1 equipamento/unidade para devolução parcial.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/erp/rental-contracts/${encodeURIComponent(contract.id)}/partial-return`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            returnDate,
            cycleDaysUsed: daysClamped,
            itemsToReturn,
            emitReturnNfe,
            emitProRataInvoice,
            reason,
          }),
        }
      );
      if (res.ok) {
        const json = await res.json();
        if (json?.data?.contract) {
          await onSuccess({
            contract: json.data.contract,
            returnNfe: json.data.returnNfe || null,
            proRataInvoice: json.data.proRataInvoice || null,
          });
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/75 backdrop-blur-xs flex items-center justify-center p-3 overflow-y-auto">
      <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-4xl w-full overflow-hidden my-6">
        <div className="px-6 py-4 bg-indigo-950 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Scale className="w-5 h-5 text-emerald-300" />
            <div>
              <span className="text-[10px] font-extrabold uppercase text-emerald-300 block">
                Rateio Proporcional de Contrato (Pro-Rata Die) • Sem Pausar a Vigência
              </span>
              <h3 className="text-sm font-extrabold">
                Devolução Parcial de Equipamentos — {contract.contractNumber} ({contract.companyName})
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-300 hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs max-h-[84vh] overflow-y-auto">
          <div className="p-3.5 rounded-lg bg-emerald-50/80 border border-emerald-200 flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-[10px] font-extrabold uppercase text-emerald-800 block">
                Regra Operacional Seta Telecom
              </span>
              <p className="text-emerald-950 font-semibold">
                O contrato permanece <strong>ATIVO</strong> para os equipamentos remanescentes. Os itens devolvidos são cobrados proporcionalmente (<strong>{daysClamped}/30 dias</strong>) neste ciclo e deduzidos das faturas futuras.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-emerald-600 text-white text-[11px] font-black">
              STATUS MANTIDO: ATIVO
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Data da Devolução Física
              </label>
              <input
                type="date"
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
                className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Dias Utilizados no Ciclo Atual (1 a 30 dias)
              </label>
              <input
                type="number"
                min={1}
                max={30}
                value={cycleDaysUsed}
                onChange={(e) => setCycleDaysUsed(Number(e.target.value) || 15)}
                className="w-full px-3 py-2 rounded border border-slate-300 font-black text-indigo-950"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                CFOP da NF-e de Retorno Parcial
              </label>
              <input
                type="text"
                readOnly
                value={
                  contract.remessaCfop === '6.908'
                    ? '6.909 — Retorno Interestadual de Locação'
                    : '5.909 — Retorno Estadual de Locação'
                }
                className="w-full px-3 py-2 rounded border border-slate-200 bg-slate-50 font-mono font-bold text-slate-700"
              />
            </div>
          </div>

          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="bg-slate-900 text-white px-4 py-2.5 flex items-center justify-between text-[11px] font-extrabold">
              <span>SELECIONE OS EQUIPAMENTOS E QUANTIDADES DEVOLVIDAS PELO CLIENTE</span>
              <span>
                Total Alocado:{" "}
                {contract.equipments.reduce((s, e) => s + Number(e.quantity || 0), 0)} unidades
              </span>
            </div>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b">
                <tr>
                  <th className="py-2 px-3">SKU &amp; Equipamento</th>
                  <th className="py-2 px-3">S/N</th>
                  <th className="py-2 px-3 text-center">Qtd Atual</th>
                  <th className="py-2 px-3 text-right">Unitário/Mês</th>
                  <th className="py-2 px-3 text-center">Qtd a Devolver</th>
                  <th className="py-2 px-3 text-right">Pro-Rata ({daysClamped}d)</th>
                  <th className="py-2 px-3 text-right">Redução Mensal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {contract.equipments.map((eq, idx) => {
                  const isAlreadyReturned = eq.assetStatus === 'DEVOLVIDO' || eq.quantity <= 0;
                  const qtyRet = Math.min(eq.quantity, Math.max(0, Number(qtyMap[idx] || 0)));
                  const reduction = round2(qtyRet * eq.unitMonthlyRent);
                  const proRata = round2(reduction * (daysClamped / 30));
                  return (
                    <tr
                      key={eq.id || idx}
                      className={isAlreadyReturned ? 'bg-slate-100 opacity-50' : 'hover:bg-slate-50'}
                    >
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900">{eq.description}</div>
                        <div className="font-mono text-[10px] text-slate-500">
                          {eq.skuGestaoClick}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-indigo-950">
                        {eq.serialNumber}
                      </td>
                      <td className="py-2.5 px-3 text-center font-black">{eq.quantity}</td>
                      <td className="py-2.5 px-3 text-right">{formatBRL(eq.unitMonthlyRent)}</td>
                      <td className="py-2.5 px-3 text-center">
                        <input
                          type="number"
                          min={0}
                          max={eq.quantity}
                          disabled={isAlreadyReturned}
                          value={qtyRet}
                          onChange={(e) =>
                            setQtyMap({
                              ...qtyMap,
                              [idx]: Math.min(
                                eq.quantity,
                                Math.max(0, Number(e.target.value) || 0)
                              ),
                            })
                          }
                          className="w-20 px-2 py-1 rounded border border-indigo-300 text-center font-black text-indigo-950 bg-indigo-50/40"
                        />
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-amber-800">
                        {qtyRet > 0 ? formatBRL(proRata) : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-rose-700">
                        {qtyRet > 0 ? `- ${formatBRL(reduction)}/mês` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* LIVE PRO-RATA BREAKDOWN SUMMARY */}
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5 p-4 rounded-lg bg-slate-900 text-white">
            <div>
              <span className="text-[10px] uppercase text-slate-400 block">
                Mensalidade Anterior
              </span>
              <strong className="text-sm font-black text-white">
                {formatBRL(previousMonthlyValue)}
              </strong>
            </div>
            <div>
              <span className="text-[10px] uppercase text-rose-300 block">
                Abatimento ({totalUnitsReturned} un. devolvidas)
              </span>
              <strong className="text-sm font-black text-rose-300">
                - {formatBRL(totalMonthlyReductionBrl)}/mês
              </strong>
            </div>
            <div>
              <span className="text-[10px] uppercase text-amber-300 block">
                Pro-Rata Devolvidos ({daysClamped}/30d)
              </span>
              <strong className="text-sm font-black text-amber-300">
                + {formatBRL(totalProRataReturnedBrl)}
              </strong>
            </div>
            <div className="bg-white/10 p-2 rounded border border-emerald-400/40">
              <span className="text-[10px] uppercase text-emerald-300 font-bold block">
                Fatura Deste Mês (Com Rateio)
              </span>
              <strong className="text-base font-black text-emerald-300">
                {formatBRL(currentCycleProRataTotalBrl)}
              </strong>
            </div>
            <div className="bg-white/10 p-2 rounded border border-indigo-400/40">
              <span className="text-[10px] uppercase text-indigo-200 font-bold block">
                Novo MRR (Próximos Meses)
              </span>
              <strong className="text-base font-black text-white">
                {formatBRL(newRecurringMonthlyValue)}/mês
              </strong>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <label className="flex items-center gap-2.5 p-3 rounded border border-slate-200 bg-slate-50 cursor-pointer">
              <input
                type="checkbox"
                checked={emitReturnNfe}
                onChange={(e) => setEmitReturnNfe(e.target.checked)}
                className="w-4 h-4 accent-[#1e3a6e]"
              />
              <div>
                <span className="font-bold text-slate-800 block">
                  Emitir NF-e de Retorno Parcial de Locação (CFOP 5.909 / 6.909)
                </span>
                <span className="text-[10px] text-slate-500">
                  Documento fiscal de entrada patrimonial sem incidência de ICMS/IPI
                </span>
              </div>
            </label>

            <label className="flex items-center gap-2.5 p-3 rounded border border-slate-200 bg-slate-50 cursor-pointer">
              <input
                type="checkbox"
                checked={emitProRataInvoice}
                onChange={(e) => setEmitProRataInvoice(e.target.checked)}
                className="w-4 h-4 accent-[#1e3a6e]"
              />
              <div>
                <span className="font-bold text-slate-800 block">
                  Emitir Fatura de Locação Deste Mês com Rateio Pro-Rata ({formatBRL(currentCycleProRataTotalBrl)})
                </span>
                <span className="text-[10px] text-slate-500">
                  Discrimina na fatura os itens integrais (30/30d) + itens devolvidos ({daysClamped}/30d)
                </span>
              </div>
            </label>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Motivo / Observação do Aditivo de Rateio
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 rounded border border-slate-300"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded border font-bold text-slate-700 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || totalUnitsReturned <= 0}
              className="px-5 py-2.5 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white font-extrabold cursor-pointer disabled:opacity-50 shadow-sm"
            >
              {submitting
                ? 'Processando Rateio Pro-Rata...'
                : `Confirmar Rateio Pro-Rata (${totalUnitsReturned} un.) & Manter Contrato Ativo`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// 4. BATCH RENTAL BILLING & MASS EMAIL DISPATCH MODAL
// ============================================================================
interface BatchContractBillingRow {
  contractId: string;
  contractNumber: string;
  companyName: string;
  selected: boolean;
  customAmountBrl: number;
  discountBrl: number;
  extraBrl: number;
  recipientEmail: string;
  notes: string;
}

export function BatchRentalBillingAndEmailModal({
  contracts,
  initialSelectedIds = [],
  onClose,
  onSuccess,
  onShowToast,
}: {
  contracts: ErpRentalContract[];
  initialSelectedIds?: string[];
  onClose: () => void;
  onSuccess: (payload: {
    invoices: ErpFiscalInvoice[];
    contracts: ErpRentalContract[];
    summaryText: string;
  }) => Promise<void>;
  onShowToast?: (msg: string) => void;
}) {
  const [competenceMonth, setCompetenceMonth] = useState<string>('11/2026');
  const [sendEmailOnGenerate, setSendEmailOnGenerate] = useState<boolean>(true);
  const [customEmailMessage, setCustomEmailMessage] = useState<string>(
    'Segue Fatura de Locação de Equipamentos (0% ISS — Súmula Vinculante 31 STF), Demonstrativo de Números de Série (S/N) e Boleto/PIX para liquidação.'
  );
  const [busyMode, setBusyMode] = useState<'NONE' | 'BILLING' | 'EMAIL'>('NONE');

  const [rows, setRows] = useState<BatchContractBillingRow[]>(() =>
    contracts
      .filter((c) => c.status !== 'ENCERRADO')
      .map((c) => ({
        contractId: c.id,
        contractNumber: c.contractNumber,
        companyName: c.companyName,
        selected:
          initialSelectedIds.length > 0 ? initialSelectedIds.includes(c.id) : true,
        customAmountBrl: c.monthlyValue,
        discountBrl: 0,
        extraBrl: 0,
        recipientEmail:
          c.lastEmailRecipient ||
          `financeiro@${c.companyName
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '')
            .slice(0, 14)}.com.br`,
        notes: `Competência ${competenceMonth}`,
      }))
  );

  const selectedRows = rows.filter((r) => r.selected);
  const totalNetBatchBrl = selectedRows.reduce(
    (sum, r) =>
      sum + Math.max(0, Number(r.customAmountBrl || 0) + Number(r.extraBrl || 0) - Number(r.discountBrl || 0)),
    0
  );

  const handleGenerateBatchInvoices = async () => {
    if (selectedRows.length === 0) {
      onShowToast?.('Selecione ao menos 1 contrato para faturar em lote.');
      return;
    }
    setBusyMode('BILLING');
    try {
      const res = await fetch('/api/erp/rental-contracts/batch-billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          competenceMonth,
          items: selectedRows.map((r) => ({
            contractId: r.contractId,
            customAmountBrl: r.customAmountBrl,
            discountBrl: r.discountBrl,
            extraBrl: r.extraBrl,
            notes: r.notes,
            sendEmail: sendEmailOnGenerate,
            recipientEmail: r.recipientEmail,
          })),
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const d = json?.data;
        if (d) {
          await onSuccess({
            invoices: d.invoices || [],
            contracts: d.contracts || [],
            summaryText: `Faturamento em Massa concluído (${d.competenceMonth}): ${
              d.invoicesGenerated
            } Fatura(s) de Locação emitidas (${formatBRL(d.totalBilledBrl)}) e ${
              d.emailsDispatched
            } e-mail(s) disparados!`,
          });
        }
      }
    } finally {
      setBusyMode('NONE');
    }
  };

  const handleBatchEmailsOnly = async () => {
    if (selectedRows.length === 0) {
      onShowToast?.('Selecione ao menos 1 contrato para enviar e-mails em massa.');
      return;
    }
    setBusyMode('EMAIL');
    try {
      const res = await fetch('/api/erp/rental-contracts/batch-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractIds: selectedRows.map((r) => r.contractId),
          competenceMonth,
          customMessage: customEmailMessage,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const d = json?.data;
        await onSuccess({
          invoices: [],
          contracts: [],
          summaryText: `Disparo de E-mails em Massa concluído: ${
            d?.sentCount || selectedRows.length
          } clientes notificados com PDF da Fatura + Relação de S/Ns + PIX/Boleto!`,
        });
      }
    } finally {
      setBusyMode('NONE');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/75 backdrop-blur-xs flex items-center justify-center p-3 overflow-y-auto">
      <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-5xl w-full overflow-hidden my-6">
        <div className="px-6 py-4 bg-[#1e3a6e] text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Zap className="w-5 h-5 text-amber-300" />
            <div>
              <span className="text-[10px] font-extrabold uppercase text-emerald-300 block">
                Automação de Faturamento Recorrente &amp; Régua de Cobrança — Seta Telecom
              </span>
              <h3 className="text-sm font-extrabold">
                Faturamento de Locação em Massa &amp; Envio de E-mails em Lote ({selectedRows.length} contratos selecionados)
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-300 hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 text-xs max-h-[84vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end bg-slate-50 p-3.5 rounded-lg border border-slate-200">
            <div className="sm:col-span-3">
              <label className="block font-bold text-slate-700 mb-1">
                Competência do Lote (MM/AAAA)
              </label>
              <input
                type="text"
                value={competenceMonth}
                onChange={(e) => setCompetenceMonth(e.target.value)}
                className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-mono font-black text-indigo-950"
              />
            </div>

            <div className="sm:col-span-5">
              <label className="block font-bold text-slate-700 mb-1">
                Mensagem Padrão de E-mail do Lote
              </label>
              <input
                type="text"
                value={customEmailMessage}
                onChange={(e) => setCustomEmailMessage(e.target.value)}
                className="w-full px-3 py-2 rounded border border-slate-300 bg-white"
              />
            </div>

            <div className="sm:col-span-4 flex items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 font-bold text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendEmailOnGenerate}
                  onChange={(e) => setSendEmailOnGenerate(e.target.checked)}
                  className="w-4 h-4 accent-[#1e3a6e]"
                />
                Disparar E-mail PDF+PIX ao Faturar
              </label>
              <button
                type="button"
                onClick={() => {
                  const allSelected = rows.every((r) => r.selected);
                  setRows(rows.map((r) => ({ ...r, selected: !allSelected })));
                }}
                className="px-2.5 py-1.5 rounded border border-slate-300 bg-white text-[11px] font-bold cursor-pointer"
              >
                Marcar/Desmarcar Todos
              </button>
            </div>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900 text-white uppercase text-[10px]">
                <tr>
                  <th className="py-2.5 px-3 w-10 text-center">✓</th>
                  <th className="py-2.5 px-3">Contrato &amp; Cliente</th>
                  <th className="py-2.5 px-3 text-right">Aluguel Base (R$)</th>
                  <th className="py-2.5 px-3 text-right">Acréscimo / Rateio (R$)</th>
                  <th className="py-2.5 px-3 text-right">Desconto (R$)</th>
                  <th className="py-2.5 px-3 text-right">Líquido a Faturar</th>
                  <th className="py-2.5 px-3">E-mail Destinatário</th>
                  <th className="py-2.5 px-3">Observação na Fatura</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map((row, idx) => {
                  const netRow = Math.max(
                    0,
                    Number(row.customAmountBrl || 0) +
                      Number(row.extraBrl || 0) -
                      Number(row.discountBrl || 0)
                  );
                  return (
                    <tr key={row.contractId} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={(e) => {
                            const copy = [...rows];
                            copy[idx] = { ...copy[idx], selected: e.target.checked };
                            setRows(copy);
                          }}
                          className="w-4 h-4 accent-[#1e3a6e]"
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-mono font-black text-indigo-950">
                          {row.contractNumber}
                        </div>
                        <div className="font-semibold text-slate-800">{row.companyName}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <input
                          type="number"
                          step="0.01"
                          value={row.customAmountBrl}
                          onChange={(e) => {
                            const copy = [...rows];
                            copy[idx] = {
                              ...copy[idx],
                              customAmountBrl: Number(e.target.value) || 0,
                            };
                            setRows(copy);
                          }}
                          className="w-24 px-2 py-1 rounded border text-right font-bold"
                        />
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <input
                          type="number"
                          step="0.01"
                          value={row.extraBrl}
                          onChange={(e) => {
                            const copy = [...rows];
                            copy[idx] = { ...copy[idx], extraBrl: Number(e.target.value) || 0 };
                            setRows(copy);
                          }}
                          className="w-20 px-2 py-1 rounded border text-right text-indigo-800"
                        />
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <input
                          type="number"
                          step="0.01"
                          value={row.discountBrl}
                          onChange={(e) => {
                            const copy = [...rows];
                            copy[idx] = {
                              ...copy[idx],
                              discountBrl: Number(e.target.value) || 0,
                            };
                            setRows(copy);
                          }}
                          className="w-20 px-2 py-1 rounded border text-right text-rose-700"
                        />
                      </td>
                      <td className="py-2.5 px-3 text-right font-black text-emerald-700">
                        {formatBRL(netRow)}
                      </td>
                      <td className="py-2.5 px-3">
                        <input
                          type="email"
                          value={row.recipientEmail}
                          onChange={(e) => {
                            const copy = [...rows];
                            copy[idx] = { ...copy[idx], recipientEmail: e.target.value };
                            setRows(copy);
                          }}
                          className="w-44 px-2 py-1 rounded border font-mono text-[11px]"
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <input
                          type="text"
                          value={row.notes}
                          onChange={(e) => {
                            const copy = [...rows];
                            copy[idx] = { ...copy[idx], notes: e.target.value };
                            setRows(copy);
                          }}
                          className="w-36 px-2 py-1 rounded border text-[11px]"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="p-4 rounded-lg bg-emerald-950 text-white flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-[10px] uppercase font-bold text-emerald-300 block">
                Resumo do Lote de Faturamento ({competenceMonth})
              </span>
              <div className="text-base font-black">
                {selectedRows.length} Contrato(s) • Total Líquido: {formatBRL(totalNetBatchBrl)} (0% ISS — Súmula Vinculante 31 STF)
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded border border-white/25 text-white font-bold hover:bg-white/10 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={busyMode !== 'NONE'}
                onClick={handleBatchEmailsOnly}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-amber-500 hover:bg-amber-600 text-slate-950 font-black cursor-pointer disabled:opacity-50"
              >
                <Mail className="w-4 h-4" />
                {busyMode === 'EMAIL'
                  ? 'Enviando E-mails...'
                  : `Enviar E-mails em Massa (${selectedRows.length})`}
              </button>
              <button
                type="button"
                disabled={busyMode !== 'NONE'}
                onClick={handleGenerateBatchInvoices}
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white font-black cursor-pointer disabled:opacity-50 shadow-md"
              >
                <Zap className="w-4 h-4" />
                {busyMode === 'BILLING'
                  ? 'Gerando Faturas...'
                  : `Gerar ${selectedRows.length} Fatura(s) em Massa`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
