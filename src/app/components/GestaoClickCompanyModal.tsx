'use client';

import React, { useEffect, useState } from 'react';
import {
  Building2,
  Search,
  CheckCircle2,
  MapPin,
  Phone,
  Wallet,
  Plus,
  Trash2,
  X,
  AlertTriangle,
  ShieldCheck,
  Pencil,
} from 'lucide-react';
import { Company } from '../../db/types';
import {
  formatBrPhoneMask,
  formatCepMask,
  formatDocumentByPersonType,
  validateCnpj,
  validateDocumentByPersonType,
} from '../../modules/data-health/validators';

export interface AdditionalCompanyContact {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
}

export interface GestaoClickCompanyFormPayload {
  name: string;
  domain?: string;
  cnpj?: string;
  industry?: string;
  size?: string;
  annualRevenue?: number;
  city?: string;
  state?: string;
  icpTier?: 'TIER_1' | 'TIER_2' | 'TIER_3';
  isTargetAccount?: boolean;
  ownerName?: string;
  customProperties?: Record<string, unknown>;
  [key: string]: unknown;
}

interface GestaoClickCompanyModalProps {
  company?: Partial<Company> | null;
  initialCompany?: Partial<Company> | null;
  isNew?: boolean;
  mode?: 'CREATE' | 'EDIT' | 'VIEW';
  readOnly?: boolean;
  canDelete?: boolean;
  onClose: () => void;
  onSave: (payload: any, secondArg?: any) => Promise<void>;
  onDelete?: (companyId: string) => Promise<void>;
}

export default function GestaoClickCompanyModal({
  company: companyProp,
  initialCompany,
  isNew: isNewProp,
  mode,
  readOnly: readOnlyProp = false,
  canDelete = true,
  onClose,
  onSave,
  onDelete,
}: GestaoClickCompanyModalProps) {
  const company = companyProp !== undefined ? companyProp : (initialCompany ?? null);
  const isNew = isNewProp !== undefined ? isNewProp : mode === 'CREATE' || !company?.id;
  const [isReadOnly, setIsReadOnly] = useState<boolean>(
    Boolean(readOnlyProp || mode === 'VIEW')
  );
  const cp = (company?.customProperties || {}) as Record<string, unknown>;
  const firstAddr =
    !isNew && Array.isArray(cp.addresses) && cp.addresses[0]
      ? (cp.addresses[0] as Record<string, unknown>)
      : {};

  // Bloco 1: Dados Gerais & Fiscais
  const [personType, setPersonType] = useState<string>(
    isNew ? 'Pessoa Jurídica' : String(cp.customerType || 'Pessoa Jurídica')
  );
  const [situation, setSituation] = useState<string>(
    isNew ? 'Ativo' : String(cp.situation || 'Ativo')
  );
  const [internalCode, setInternalCode] = useState<string>(
    isNew ? '' : String(cp.gestaoClickClientId || cp.internalCode || '')
  );
  const [cnpj, setCnpj] = useState<string>(
    isNew
      ? ''
      : formatDocumentByPersonType(String(company?.cnpj || ''), String(cp.customerType || 'Pessoa Jurídica'))
  );
  const [legalName, setLegalName] = useState<string>(
    isNew ? '' : String(company?.name || '')
  );
  const [tradeName, setTradeName] = useState<string>(
    isNew ? '' : String(cp.tradeName || company?.name || '')
  );
  const [stateRegistration, setStateRegistration] = useState<string>(
    isNew ? '' : String(cp.stateRegistration || '')
  );
  const [ieIndicator, setIeIndicator] = useState<string>(
    isNew ? 'Contribuinte Isento' : String(cp.ieIndicator || 'Contribuinte Isento')
  );
  const [municipalRegistration, setMunicipalRegistration] = useState<string>(
    isNew ? '' : String(cp.municipalRegistration || '')
  );
  const [suframa, setSuframa] = useState<string>(
    isNew ? '' : String(cp.suframa || '')
  );
  const [taxRegime, setTaxRegime] = useState<string>(
    isNew ? 'Lucro Presumido' : String(cp.taxRegime || 'Lucro Presumido')
  );
  const [cnaeMain, setCnaeMain] = useState<string>(
    isNew ? '' : String(cp.cnaeMain || '')
  );
  const [cnaeDescription, setCnaeDescription] = useState<string>(
    isNew ? '' : String(cp.cnaeDescription || company?.industry || '')
  );
  const [openingDate, setOpeningDate] = useState<string>(
    isNew ? '' : String(cp.openingDate || '')
  );
  const [companySize, setCompanySize] = useState<string>(
    isNew ? '' : String(company?.size || '')
  );
  const [shareCapital, setShareCapital] = useState<string>(
    isNew ? '' : cp.shareCapital !== undefined ? String(cp.shareCapital) : company?.annualRevenue !== undefined ? String(company.annualRevenue) : ''
  );
  const [ownerName, setOwnerName] = useState<string>(
    isNew ? '' : String(company?.ownerName || cp.sellerName || '')
  );

  // Bloco 2: Endereço Completo + IBGE
  const [cep, setCep] = useState<string>(
    isNew ? '' : formatCepMask(String(firstAddr.cep || cp.cep || ''))
  );
  const [street, setStreet] = useState<string>(
    isNew ? '' : String(firstAddr.street || cp.street || '')
  );
  const [number, setNumber] = useState<string>(
    isNew ? '' : String(firstAddr.number || cp.number || '')
  );
  const [complement, setComplement] = useState<string>(
    isNew ? '' : String(firstAddr.complement || cp.complement || '')
  );
  const [neighborhood, setNeighborhood] = useState<string>(
    isNew ? '' : String(firstAddr.neighborhood || cp.neighborhood || '')
  );
  const [city, setCity] = useState<string>(
    isNew ? '' : String(company?.city || '')
  );
  const [uf, setUf] = useState<string>(
    isNew ? '' : String(company?.state || '')
  );
  const [ibgeCode, setIbgeCode] = useState<string>(
    isNew ? '' : String(cp.ibgeCode || '')
  );

  // Bloco 3: Contatos & Comunicação
  const [commercialPhone, setCommercialPhone] = useState<string>(
    isNew ? '' : formatBrPhoneMask(String(cp.phone || ''))
  );
  const [whatsappPhone, setWhatsappPhone] = useState<string>(
    isNew ? '' : formatBrPhoneMask(String(cp.whatsappPhone || ''))
  );
  const [commercialEmail, setCommercialEmail] = useState<string>(
    isNew ? '' : String(cp.emailComercial || '')
  );
  const [financialNfeEmail, setFinancialNfeEmail] = useState<string>(
    isNew ? '' : String(cp.emailFinanceiroNfe || '')
  );
  const [domain, setDomain] = useState<string>(
    isNew ? '' : String(company?.domain || '')
  );
  const [additionalContacts, setAdditionalContacts] = useState<AdditionalCompanyContact[]>(() => {
    if (!isNew && Array.isArray(cp.additionalContacts) && cp.additionalContacts.length > 0) {
      return cp.additionalContacts as AdditionalCompanyContact[];
    }
    return [];
  });

  // Bloco 4: Dados Financeiros & Faturamento
  const [creditLimitBrl, setCreditLimitBrl] = useState<string>(
    isNew ? '' : cp.creditLimitBrl !== undefined ? String(cp.creditLimitBrl) : ''
  );
  const [defaultPaymentCondition, setDefaultPaymentCondition] = useState<string>(
    isNew ? 'Boleto 30 DDL' : String(cp.defaultPaymentCondition || 'Boleto 30 DDL')
  );
  const [preferredBank, setPreferredBank] = useState<string>(
    isNew ? 'Banco Inter' : String(cp.preferredBank || 'Banco Inter')
  );
  const [billingDueDay, setBillingDueDay] = useState<string>(
    isNew ? '' : String(cp.billingDueDay || '')
  );
  const [taxWithholdingConfig, setTaxWithholdingConfig] = useState<string>(
    isNew ? '' : String(cp.taxWithholdingConfig || '')
  );
  const [fiscalNotes, setFiscalNotes] = useState<string>(
    isNew ? '' : String(cp.notes || '')
  );

  // Receita Federal Lookup, Validation & 2-Step Deletion States
  const [lookingUpCnpj, setLookingUpCnpj] = useState(false);
  const [receitaStatusBanner, setReceitaStatusBanner] = useState<string | null>(null);
  const [validationErrorBanner, setValidationErrorBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirmStep, setShowDeleteConfirmStep] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reset all fields whenever modal opens in New Mode vs Edit Mode
  useEffect(() => {
    const nextCp = (company?.customProperties || {}) as Record<string, unknown>;
    const nextAddr =
      !isNew && Array.isArray(nextCp.addresses) && nextCp.addresses[0]
        ? (nextCp.addresses[0] as Record<string, unknown>)
        : {};
    const nextPersonType = isNew ? 'Pessoa Jurídica' : String(nextCp.customerType || 'Pessoa Jurídica');

    setPersonType(nextPersonType);
    setSituation(isNew ? 'Ativo' : String(nextCp.situation || 'Ativo'));
    setInternalCode(isNew ? '' : String(nextCp.gestaoClickClientId || nextCp.internalCode || ''));
    setCnpj(isNew ? '' : formatDocumentByPersonType(String(company?.cnpj || ''), nextPersonType));
    setLegalName(isNew ? '' : String(company?.name || ''));
    setTradeName(isNew ? '' : String(nextCp.tradeName || company?.name || ''));
    setStateRegistration(isNew ? '' : String(nextCp.stateRegistration || ''));
    setIeIndicator(isNew ? 'Contribuinte Isento' : String(nextCp.ieIndicator || 'Contribuinte Isento'));
    setMunicipalRegistration(isNew ? '' : String(nextCp.municipalRegistration || ''));
    setSuframa(isNew ? '' : String(nextCp.suframa || ''));
    setTaxRegime(isNew ? 'Lucro Presumido' : String(nextCp.taxRegime || 'Lucro Presumido'));
    setCnaeMain(isNew ? '' : String(nextCp.cnaeMain || ''));
    setCnaeDescription(isNew ? '' : String(nextCp.cnaeDescription || company?.industry || ''));
    setOpeningDate(isNew ? '' : String(nextCp.openingDate || ''));
    setCompanySize(isNew ? '' : String(company?.size || ''));
    setShareCapital(
      isNew
        ? ''
        : nextCp.shareCapital !== undefined
          ? String(nextCp.shareCapital)
          : company?.annualRevenue !== undefined
            ? String(company.annualRevenue)
            : ''
    );
    setOwnerName(isNew ? '' : String(company?.ownerName || nextCp.sellerName || ''));
    setCep(isNew ? '' : formatCepMask(String(nextAddr.cep || nextCp.cep || '')));
    setStreet(isNew ? '' : String(nextAddr.street || nextCp.street || ''));
    setNumber(isNew ? '' : String(nextAddr.number || nextCp.number || ''));
    setComplement(isNew ? '' : String(nextAddr.complement || nextCp.complement || ''));
    setNeighborhood(isNew ? '' : String(nextAddr.neighborhood || nextCp.neighborhood || ''));
    setCity(isNew ? '' : String(company?.city || ''));
    setUf(isNew ? '' : String(company?.state || ''));
    setIbgeCode(isNew ? '' : String(nextCp.ibgeCode || ''));
    setCommercialPhone(isNew ? '' : formatBrPhoneMask(String(nextCp.phone || '')));
    setWhatsappPhone(isNew ? '' : formatBrPhoneMask(String(nextCp.whatsappPhone || '')));
    setCommercialEmail(isNew ? '' : String(nextCp.emailComercial || ''));
    setFinancialNfeEmail(isNew ? '' : String(nextCp.emailFinanceiroNfe || ''));
    setDomain(isNew ? '' : String(company?.domain || ''));
    setAdditionalContacts(
      !isNew && Array.isArray(nextCp.additionalContacts)
        ? (nextCp.additionalContacts as AdditionalCompanyContact[])
        : []
    );
    setCreditLimitBrl(isNew ? '' : nextCp.creditLimitBrl !== undefined ? String(nextCp.creditLimitBrl) : '');
    setDefaultPaymentCondition(isNew ? 'Boleto 30 DDL' : String(nextCp.defaultPaymentCondition || 'Boleto 30 DDL'));
    setPreferredBank(isNew ? 'Banco Inter' : String(nextCp.preferredBank || 'Banco Inter'));
    setBillingDueDay(isNew ? '' : String(nextCp.billingDueDay || ''));
    setTaxWithholdingConfig(isNew ? '' : String(nextCp.taxWithholdingConfig || ''));
    setFiscalNotes(isNew ? '' : String(nextCp.notes || ''));
    setReceitaStatusBanner(null);
    setValidationErrorBanner(null);
    setShowDeleteConfirmStep(false);
  }, [isNew, company?.id]);

  const isPf = personType.toLowerCase().includes('física') || personType.toLowerCase().includes('fisica');
  const docFeedback = validateDocumentByPersonType(cnpj, personType);

  const handlePersonTypeChange = (nextType: string) => {
    setPersonType(nextType);
    setCnpj((prev) => formatDocumentByPersonType(prev, nextType));
    setValidationErrorBanner(null);
  };

  const handleLookupReceitaFederal = async (rawVal?: string) => {
    const targetCnpj = rawVal !== undefined ? rawVal : cnpj;
    const digits = targetCnpj.replace(/\D+/g, '');
    if (isPf) {
      setValidationErrorBanner('A consulta automática na Receita Federal aplica-se apenas a Pessoa Jurídica (CNPJ 14 dígitos).');
      return;
    }
    const check = validateCnpj(digits);
    if (!check.isValid) {
      setValidationErrorBanner(
        check.reason === 'INVALID_CHECK_DIGITS' || check.reason === 'REPEATED_DIGITS'
          ? 'CNPJ inválido (dígitos verificadores incorretos). Corrija o CNPJ antes de consultar na Receita Federal.'
          : 'Digite os 14 números de um CNPJ matematicamente válido para consultar na Receita Federal.'
      );
      return;
    }
    setLookingUpCnpj(true);
    setReceitaStatusBanner(null);
    setValidationErrorBanner(null);
    try {
      const res = await fetch(`/api/cnpj/lookup?cnpj=${encodeURIComponent(digits)}`);
      const json = await res.json();
      if (!res.ok) {
        setValidationErrorBanner(json?.error || 'Não foi possível consultar o CNPJ informado.');
        return;
      }
      const d = json.data;
      if (d) {
        setCnpj(formatDocumentByPersonType(d.cnpj || digits, 'Pessoa Jurídica'));
        setLegalName(d.razaoSocial || '');
        setTradeName(d.nomeFantasia || d.razaoSocial || '');
        setSituation(d.situacaoCadastral === 'ATIVA' ? 'Ativo' : 'Inativo');
        setOpeningDate(d.dataAbertura || '');
        setCnaeMain(d.cnaePrincipal || '');
        setCnaeDescription(d.cnaeDescricao || '');
        setCompanySize(d.porte || '');
        setShareCapital(d.capitalSocial ? String(d.capitalSocial) : '');
        setStateRegistration(d.inscricaoEstadual || 'ISENTO');
        setIeIndicator(d.indicadorIe || 'Contribuinte Isento');
        setMunicipalRegistration(d.inscricaoMunicipal || '');
        setTaxRegime(d.regimeTributario || 'Lucro Presumido');
        setCep(formatCepMask(d.cep || ''));
        setStreet(d.logradouro || '');
        setNumber(d.numero || '');
        setComplement(d.complemento || '');
        setNeighborhood(d.bairro || '');
        setCity(d.cidade || '');
        setUf(d.uf || '');
        setIbgeCode(d.codigoIbge || '');
        if (d.telefone) setCommercialPhone(formatBrPhoneMask(d.telefone));
        if (d.celularWhatsapp) setWhatsappPhone(formatBrPhoneMask(d.celularWhatsapp));
        if (d.emailComercial) setCommercialEmail(d.emailComercial);
        if (d.emailFinanceiroNfe) setFinancialNfeEmail(d.emailFinanceiroNfe);
        if (d.website) setDomain(d.website);
        setReceitaStatusBanner(
          `SITUAÇÃO ${d.situacaoCadastral} NA RECEITA FEDERAL — Dados oficiais preenchidos automaticamente (${d.source}).`
        );
      }
    } finally {
      setLookingUpCnpj(false);
    }
  };

  const handleLookupCep = async (rawCep: string) => {
    const clean = rawCep.replace(/\D+/g, '');
    if (clean.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
      if (res.ok) {
        const j = await res.json();
        if (!j.erro) {
          if (j.logradouro) setStreet(j.logradouro);
          if (j.bairro) setNeighborhood(j.bairro);
          if (j.localidade) setCity(j.localidade);
          if (j.uf) setUf(j.uf);
          if (j.ibge) setIbgeCode(j.ibge);
        }
      }
    } catch {
      // ignore offline
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!legalName.trim()) {
      setValidationErrorBanner('Informe a Razão Social / Nome Completo do cliente.');
      return;
    }
    if (!docFeedback.isValid) {
      setValidationErrorBanner(
        `${docFeedback.message}. Corrija o ${docFeedback.docKind} antes de salvar o cadastro.`
      );
      return;
    }
    setValidationErrorBanner(null);
    setSaving(true);
    try {
      await onSave(
        {
          ...(company?.id && !isNew ? { id: company.id } : {}),
          name: legalName.trim(),
          cnpj: docFeedback.formatted || cnpj.trim() || null,
          domain: domain.trim() || null,
          industry: cnaeDescription.trim() || 'Telecomunicações & TI',
          size: companySize || 'Médio / Grande Porte',
          annualRevenue: Number(shareCapital) || 0,
          city: city.trim() || 'São Paulo',
          state: uf.trim() || 'SP',
          ownerName: ownerName.trim() || 'Marcelo Lopes Mira',
          customProperties: {
            ...cp,
            customerType: personType,
            situation,
            internalCode,
            tradeName: tradeName.trim() || legalName.trim(),
            stateRegistration,
            ieIndicator,
            municipalRegistration,
            suframa,
            taxRegime,
            cnaeMain,
            cnaeDescription,
            openingDate,
            shareCapital: Number(shareCapital) || 0,
            sellerName: ownerName.trim() || 'Marcelo Lopes Mira',
            cep,
            street,
            number,
            complement,
            neighborhood,
            ibgeCode,
            phone: commercialPhone,
            whatsappPhone,
            emailComercial: commercialEmail,
            emailFinanceiroNfe: financialNfeEmail,
            creditLimitBrl: Number(creditLimitBrl) || 0,
            defaultPaymentCondition,
            preferredBank,
            billingDueDay: Number(billingDueDay) || 10,
            taxWithholdingConfig,
            notes: fiscalNotes,
            addresses: [
              {
                id: 'addr-main',
                type: 'Comercial / Faturamento',
                cep,
                street,
                number,
                complement,
                neighborhood,
                cityState: city ? `${city} (${uf || 'SP'})` : '',
                ibgeCode,
              },
            ],
            additionalContacts,
          },
        },
        mode ? (isNew ? undefined : company?.id) : isNew
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-[#f3f5f8] rounded-lg border border-slate-300 shadow-2xl max-w-5xl w-full overflow-hidden my-4">
        {/* TOP HEADER GESTÃOCLICK / STI-HUB */}
        <div className="sticky top-0 z-20 px-4 sm:px-6 py-3.5 bg-[#1e3a6e] text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Building2 className="w-5 h-5 text-emerald-300" />
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-300 block">
                Padrão Oficial GestãoClick (#118887) &amp; Receita Federal do Brasil
              </span>
              <h2 className="text-sm sm:text-base font-extrabold">
                {isNew
                  ? 'Novo Cadastro de Cliente / Empresa (Em Branco)'
                  : isReadOnly
                    ? `Consultar Cadastro de Cliente / Empresa — ${legalName}`
                    : `Editar Cadastro de Cliente / Empresa — ${legalName}`}
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isReadOnly && !isNew && (
              <button
                type="button"
                onClick={() => setIsReadOnly(false)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold shadow-xs cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>Habilitar Edição</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-slate-300 hover:text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-3 sm:p-5 space-y-4 text-xs max-h-[86vh] overflow-y-auto">
          {/* VALIDATION ERROR BANNER */}
          {validationErrorBanner && (
            <div className="p-3 rounded-md bg-rose-950 text-white border border-rose-500 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold text-rose-200">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{validationErrorBanner}</span>
              </div>
              <button
                type="button"
                onClick={() => setValidationErrorBanner(null)}
                className="text-slate-300 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* RECEITA FEDERAL CONFIRMATION BANNER */}
          {receitaStatusBanner && (
            <div className="p-3 rounded-md bg-emerald-950 text-white border border-emerald-500 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold text-emerald-300">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{receitaStatusBanner}</span>
              </div>
              <button
                type="button"
                onClick={() => setReceitaStatusBanner(null)}
                className="text-slate-300 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <fieldset disabled={isReadOnly} className="space-y-4">
          {/* BLOCO 1: DADOS GERAIS & FISCAIS */}
          <div className="bg-white rounded-md border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-800">
                  1. Dados Gerais, {isPf ? 'CPF (Pessoa Física)' : 'CNPJ (Receita Federal)'} &amp; Enquadramento Fiscal
                </h3>
                <p className="text-[11px] text-slate-500">
                  {isPf
                    ? 'Digite os 11 dígitos do CPF com validação matemática oficial (Módulo 11).'
                    : 'Digite os 14 dígitos do CNPJ (validação Módulo 11) ou clique em Consultar CNPJ na Receita Federal.'}
                </p>
              </div>
              <span className="px-2.5 py-0.5 rounded bg-blue-50 text-[#1e3a6e] border border-blue-200 text-[10px] font-extrabold">
                Validação Módulo 11 &amp; Trava Fiscal Ativa
              </span>
            </div>

            <div className="p-5 space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-start">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Tipo de Pessoa *
                  </label>
                  <select
                    value={personType}
                    onChange={(e) => handlePersonTypeChange(e.target.value)}
                    className="w-full px-2.5 py-2 rounded border border-slate-300 bg-white font-semibold"
                  >
                    <option value="Pessoa Jurídica">Pessoa Jurídica (PJ)</option>
                    <option value="Pessoa Física">Pessoa Física (PF)</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Situação Cadastral
                  </label>
                  <select
                    value={situation}
                    onChange={(e) => setSituation(e.target.value)}
                    className="w-full px-2.5 py-2 rounded border border-slate-300 bg-white font-semibold"
                  >
                    <option value="Ativo">Ativo</option>
                    <option value="Inativo">Inativo</option>
                    <option value="Bloqueado">Bloqueado</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Código Interno
                  </label>
                  <input
                    type="text"
                    value={internalCode}
                    onChange={(e) => setInternalCode(e.target.value)}
                    placeholder="Automático / Opcional"
                    className="w-full px-2.5 py-2 rounded border border-slate-300 font-mono bg-slate-50"
                  />
                </div>

                <div className="sm:col-span-3">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-bold text-slate-700">
                      {isPf ? 'CPF *' : 'CNPJ *'}
                    </label>
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
                  </div>
                  <input
                    type="text"
                    required
                    maxLength={isPf ? 14 : 18}
                    value={cnpj}
                    onChange={(e) => {
                      const masked = formatDocumentByPersonType(e.target.value, personType);
                      setCnpj(masked);
                      setValidationErrorBanner(null);
                      const digits = masked.replace(/\D+/g, '');
                      if (!isPf && digits.length === 14 && validateCnpj(digits).isValid) {
                        handleLookupReceitaFederal(masked);
                      }
                    }}
                    placeholder={isPf ? '000.000.000-00' : '00.000.000/0000-00'}
                    className={`w-full px-3 py-2 rounded border font-mono font-bold transition ${
                      !docFeedback.isEmpty && !docFeedback.isValid
                        ? 'border-rose-500 bg-rose-50/40 text-rose-900 focus:outline-none focus:ring-2 focus:ring-rose-500/30'
                        : !docFeedback.isEmpty && docFeedback.isValid
                          ? 'border-emerald-500 bg-emerald-50/20 text-slate-900'
                          : 'border-slate-300 text-slate-900'
                    }`}
                  />
                  {!docFeedback.isEmpty && !docFeedback.isValid && (
                    <p className="text-[10px] font-bold text-rose-600 mt-1">
                      {docFeedback.message}
                    </p>
                  )}
                </div>

                <div className="sm:col-span-3 pt-5">
                  <button
                    type="button"
                    disabled={lookingUpCnpj || isPf || !docFeedback.isValid}
                    onClick={() => handleLookupReceitaFederal()}
                    title={
                      isPf
                        ? 'Consulta na Receita Federal disponível apenas para CNPJ (PJ)'
                        : !docFeedback.isValid
                          ? 'Informe um CNPJ matematicamente válido (14 dígitos) para consultar'
                          : 'Consultar CNPJ na Receita Federal'
                    }
                    className="w-full py-2 px-3 rounded bg-[#1e3a6e] hover:bg-[#162b54] text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Search className="w-3.5 h-3.5 text-emerald-300" />
                    {lookingUpCnpj ? 'Consultando RFB...' : 'Consultar CNPJ na Receita Federal'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-5">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    {isPf ? 'Nome Completo *' : 'Razão Social / Nome Empresarial *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    placeholder={isPf ? 'Digite o nome completo' : 'Digite a razão social da empresa'}
                    className="w-full px-3 py-2 rounded border border-slate-300 font-bold text-slate-900"
                  />
                </div>

                <div className="sm:col-span-4">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    {isPf ? 'Apelido / Nome Comercial' : 'Nome Fantasia'}
                  </label>
                  <input
                    type="text"
                    value={tradeName}
                    onChange={(e) => setTradeName(e.target.value)}
                    placeholder="Opcional"
                    className="w-full px-3 py-2 rounded border border-slate-300"
                  />
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Vendedor / Executivo Responsável
                  </label>
                  <select
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    className="w-full px-2.5 py-2 rounded border border-slate-300 bg-white font-semibold"
                  >
                    <option value="">Selecione o responsável</option>
                    <option value="Marcelo Lopes Mira">Marcelo Lopes Mira</option>
                    <option value="Evelyn Ternero Seta Telecom">Evelyn Ternero Seta Telecom</option>
                    <option value="Michelle da Rocha">Michelle da Rocha</option>
                    <option value="Paula Campos">Paula Campos</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-3">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Indicador de IE
                  </label>
                  <select
                    value={ieIndicator}
                    onChange={(e) => {
                      setIeIndicator(e.target.value);
                      if (e.target.value === 'Contribuinte Isento') setStateRegistration('ISENTO');
                    }}
                    className="w-full px-2.5 py-2 rounded border border-slate-300 bg-white"
                  >
                    <option value="Contribuinte ICMS">Contribuinte ICMS</option>
                    <option value="Contribuinte Isento">Contribuinte Isento</option>
                    <option value="Não Contribuinte">Não Contribuinte</option>
                  </select>
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Inscrição Estadual (IE)
                  </label>
                  <input
                    type="text"
                    value={stateRegistration}
                    onChange={(e) => setStateRegistration(e.target.value)}
                    placeholder="ISENTO ou nº da IE"
                    className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Inscrição Municipal (IM)
                  </label>
                  <input
                    type="text"
                    value={municipalRegistration}
                    onChange={(e) => setMunicipalRegistration(e.target.value)}
                    placeholder="Opcional"
                    className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    SUFRAMA
                  </label>
                  <input
                    type="text"
                    value={suframa}
                    onChange={(e) => setSuframa(e.target.value)}
                    placeholder="Opcional"
                    className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Regime Tributário
                  </label>
                  <select
                    value={taxRegime}
                    onChange={(e) => setTaxRegime(e.target.value)}
                    className="w-full px-2.5 py-2 rounded border border-slate-300 bg-white font-semibold"
                  >
                    <option value="Lucro Real">Lucro Real</option>
                    <option value="Lucro Presumido">Lucro Presumido</option>
                    <option value="Simples Nacional">Simples Nacional</option>
                    <option value="MEI">MEI</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    CNAE Principal
                  </label>
                  <input
                    type="text"
                    value={cnaeMain}
                    onChange={(e) => setCnaeMain(e.target.value)}
                    placeholder="00.00-0-00"
                    className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
                  />
                </div>

                <div className="sm:col-span-4">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Descrição da Atividade Econômica
                  </label>
                  <input
                    type="text"
                    value={cnaeDescription}
                    onChange={(e) => setCnaeDescription(e.target.value)}
                    placeholder="Atividade principal da empresa"
                    className="w-full px-3 py-2 rounded border border-slate-300"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Data de Abertura
                  </label>
                  <input
                    type="text"
                    value={openingDate}
                    onChange={(e) => setOpeningDate(e.target.value)}
                    placeholder="AAAA-MM-DD"
                    className="w-full px-3 py-2 rounded border border-slate-300"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Porte da Empresa
                  </label>
                  <input
                    type="text"
                    value={companySize}
                    onChange={(e) => setCompanySize(e.target.value)}
                    placeholder="Ex.: Médio / Grande"
                    className="w-full px-3 py-2 rounded border border-slate-300"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Capital Social (R$)
                  </label>
                  <input
                    type="number"
                    value={shareCapital}
                    onChange={(e) => setShareCapital(e.target.value)}
                    placeholder="0,00"
                    className="w-full px-3 py-2 rounded border border-slate-300 font-semibold"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* BLOCO 2: ENDEREÇOS (COMERCIAL, COBRANÇA E ENTREGA + CÓDIGO IBGE) */}
          <div className="bg-white rounded-md border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-[#1e3a6e]" />
              <h3 className="text-sm font-bold text-slate-800">
                2. Endereço Comercial, Cobrança e Instalação (Com Busca Automática ViaCEP &amp; IBGE)
              </h3>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">CEP *</label>
                <input
                  type="text"
                  maxLength={9}
                  value={cep}
                  onChange={(e) => {
                    const maskedCep = formatCepMask(e.target.value);
                    setCep(maskedCep);
                    if (maskedCep.replace(/\D+/g, '').length === 8) {
                      handleLookupCep(maskedCep);
                    }
                  }}
                  placeholder="00000-000"
                  className="w-full px-3 py-2 rounded border border-slate-300 font-mono font-bold"
                />
              </div>
              <div className="sm:col-span-5">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Logradouro *</label>
                <input
                  type="text"
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  placeholder="Rua, Avenida, Alameda..."
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Número *</label>
                <input
                  type="text"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="Nº"
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Complemento</label>
                <input
                  type="text"
                  value={complement}
                  onChange={(e) => setComplement(e.target.value)}
                  placeholder="Andar, Sala, Bloco..."
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>

              <div className="sm:col-span-4">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Bairro *</label>
                <input
                  type="text"
                  value={neighborhood}
                  onChange={(e) => setNeighborhood(e.target.value)}
                  placeholder="Bairro"
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>
              <div className="sm:col-span-4">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Cidade *</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Município"
                  className="w-full px-3 py-2 rounded border border-slate-300 font-semibold"
                />
              </div>
              <div className="sm:col-span-1">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">UF *</label>
                <input
                  type="text"
                  maxLength={2}
                  value={uf}
                  onChange={(e) => setUf(e.target.value.toUpperCase())}
                  placeholder="UF"
                  className="w-full px-2.5 py-2 rounded border border-slate-300 font-bold text-center"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Código IBGE Município (NF-e)
                </label>
                <input
                  type="text"
                  value={ibgeCode}
                  onChange={(e) => setIbgeCode(e.target.value)}
                  placeholder="7 dígitos IBGE"
                  className="w-full px-3 py-2 rounded border border-slate-300 font-mono bg-slate-50"
                />
              </div>
            </div>
          </div>

          {/* BLOCO 3: CONTATOS & COMUNICAÇÃO */}
          <div className="bg-white rounded-md border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-[#1e3a6e]" />
                <h3 className="text-sm font-bold text-slate-800">
                  3. Contatos, E-mail Fiscal (NF-e / Boletos) &amp; Interlocutores Adicionais
                </h3>
              </div>
              <button
                type="button"
                onClick={() =>
                  setAdditionalContacts((prev) => [
                    ...prev,
                    { id: `ac-${Date.now()}`, name: '', role: '', email: '', phone: '' },
                  ])
                }
                className="px-2.5 py-1 rounded bg-[#1e3a6e] text-white text-[11px] font-bold cursor-pointer"
              >
                + Adicionar Contato na Empresa
              </button>
            </div>
            <div className="p-5 space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Telefone Comercial
                  </label>
                  <input
                    type="text"
                    value={commercialPhone}
                    onChange={(e) => setCommercialPhone(formatBrPhoneMask(e.target.value))}
                    placeholder="(00) 0000-0000"
                    className="w-full px-3 py-2 rounded border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Celular / WhatsApp
                  </label>
                  <input
                    type="text"
                    value={whatsappPhone}
                    onChange={(e) => setWhatsappPhone(formatBrPhoneMask(e.target.value))}
                    placeholder="(00) 90000-0000"
                    className="w-full px-3 py-2 rounded border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    E-mail Principal (Comercial)
                  </label>
                  <input
                    type="email"
                    value={commercialEmail}
                    onChange={(e) => setCommercialEmail(e.target.value)}
                    placeholder="contato@empresa.com.br"
                    className="w-full px-3 py-2 rounded border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    E-mail Financeiro / NF-e / Boletos
                  </label>
                  <input
                    type="email"
                    value={financialNfeEmail}
                    onChange={(e) => setFinancialNfeEmail(e.target.value)}
                    placeholder="nfe@empresa.com.br"
                    className="w-full px-3 py-2 rounded border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Site / Domínio Corporativo
                  </label>
                  <input
                    type="text"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    placeholder="empresa.com.br"
                    className="w-full px-3 py-2 rounded border border-slate-300 font-mono"
                  />
                </div>
              </div>

              {additionalContacts.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <span className="text-[11px] font-bold text-slate-600 block">
                    Contatos Adicionais da Empresa (Compras, Financeiro, TI / NOC):
                  </span>
                  {additionalContacts.map((ac, idx) => (
                    <div key={ac.id} className="grid grid-cols-12 gap-2 items-center">
                      <input
                        type="text"
                        placeholder="Nome do contato"
                        value={ac.name}
                        onChange={(e) => {
                          const copy = [...additionalContacts];
                          copy[idx].name = e.target.value;
                          setAdditionalContacts(copy);
                        }}
                        className="col-span-3 px-2.5 py-1.5 rounded border border-slate-300"
                      />
                      <input
                        type="text"
                        placeholder="Cargo / Depto"
                        value={ac.role}
                        onChange={(e) => {
                          const copy = [...additionalContacts];
                          copy[idx].role = e.target.value;
                          setAdditionalContacts(copy);
                        }}
                        className="col-span-3 px-2.5 py-1.5 rounded border border-slate-300"
                      />
                      <input
                        type="email"
                        placeholder="E-mail"
                        value={ac.email}
                        onChange={(e) => {
                          const copy = [...additionalContacts];
                          copy[idx].email = e.target.value;
                          setAdditionalContacts(copy);
                        }}
                        className="col-span-3 px-2.5 py-1.5 rounded border border-slate-300"
                      />
                      <input
                        type="text"
                        placeholder="Telefone / Ramal"
                        value={ac.phone}
                        onChange={(e) => {
                          const copy = [...additionalContacts];
                          copy[idx].phone = formatBrPhoneMask(e.target.value);
                          setAdditionalContacts(copy);
                        }}
                        className="col-span-2 px-2.5 py-1.5 rounded border border-slate-300"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setAdditionalContacts((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="col-span-1 text-rose-600 hover:bg-rose-50 p-1.5 rounded flex justify-center cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* BLOCO 4: DADOS FINANCEIROS & FATURAMENTO */}
          <div className="bg-white rounded-md border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
              <Wallet className="w-4 h-4 text-[#1e3a6e]" />
              <h3 className="text-sm font-bold text-slate-800">
                4. Dados Financeiros, Limite de Crédito, Banco Preferencial &amp; Observações Fiscais
              </h3>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Limite de Crédito (R$)
                  </label>
                  <input
                    type="number"
                    value={creditLimitBrl}
                    onChange={(e) => setCreditLimitBrl(e.target.value)}
                    placeholder="0,00"
                    className="w-full px-3 py-2 rounded border border-slate-300 font-bold text-emerald-700"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Condição de Pagamento Padrão
                  </label>
                  <select
                    value={defaultPaymentCondition}
                    onChange={(e) => setDefaultPaymentCondition(e.target.value)}
                    className="w-full px-2.5 py-2 rounded border border-slate-300 bg-white font-semibold"
                  >
                    <option value="Boleto 15 DDL">Boleto 15 DDL</option>
                    <option value="Boleto 30 DDL">Boleto 30 DDL</option>
                    <option value="PIX Corporativo">PIX Corporativo</option>
                    <option value="Transferência TED">Transferência TED</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Banco / Conta Preferencial
                  </label>
                  <select
                    value={preferredBank}
                    onChange={(e) => setPreferredBank(e.target.value)}
                    className="w-full px-2.5 py-2 rounded border border-slate-300 bg-white font-semibold"
                  >
                    <option value="Banco Inter">Banco Inter (#237906)</option>
                    <option value="Banco Itaú">Banco Itaú (#142155)</option>
                    <option value="Conta Integrada">Conta Integrada (#710407)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Dia Vencimento Locação
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={billingDueDay}
                    onChange={(e) => setBillingDueDay(e.target.value)}
                    placeholder="Ex.: 10"
                    className="w-full px-3 py-2 rounded border border-slate-300 font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Regra de Retenção de Impostos
                  </label>
                  <input
                    type="text"
                    value={taxWithholdingConfig}
                    onChange={(e) => setTaxWithholdingConfig(e.target.value)}
                    placeholder="Opcional"
                    className="w-full px-3 py-2 rounded border border-slate-300"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Observações Internas &amp; Cláusulas Fiscais do Cliente
                </label>
                <textarea
                  rows={2}
                  value={fiscalNotes}
                  onChange={(e) => setFiscalNotes(e.target.value)}
                  placeholder="Observações cadastrais, fiscais ou comerciais..."
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>
            </div>
          </div>

          </fieldset>

          {/* RODAPÉ COM ZONA DE SEGURANÇA */}
          <div className="sticky bottom-0 z-20 bg-white rounded-md border border-slate-200 p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3 shadow-lg">
            <div>
              {!isNew && !isReadOnly && company?.id && onDelete && canDelete && (
                <>
                  {!showDeleteConfirmStep ? (
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirmStep(true)}
                      className="px-3.5 py-2 rounded border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold cursor-pointer transition"
                    >
                      Excluir Cadastro
                    </button>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2 p-2 rounded bg-rose-50 border border-rose-300">
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                      <span className="text-xs font-extrabold text-rose-800">
                        Confirma a exclusão definitiva deste cadastro?
                      </span>
                      <button
                        type="button"
                        disabled={deleting}
                        onClick={async () => {
                          setDeleting(true);
                          try {
                            await onDelete(company.id!);
                            onClose();
                          } finally {
                            setDeleting(false);
                          }
                        }}
                        className="px-3 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold cursor-pointer"
                      >
                        {deleting ? 'Excluindo...' : 'Confirmar Exclusão Definitiva'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowDeleteConfirmStep(false)}
                        className="px-2.5 py-1 rounded border border-slate-300 bg-white text-slate-700 text-xs font-bold cursor-pointer"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                {isReadOnly ? 'Fechar Consulta' : 'Cancelar'}
              </button>
              {isReadOnly ? (
                <button
                  type="button"
                  onClick={() => setIsReadOnly(false)}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold shadow-sm cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Editar Cadastro</span>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={saving || !docFeedback.isValid || !legalName.trim()}
                  title={
                    !docFeedback.isValid
                      ? docFeedback.message
                      : !legalName.trim()
                        ? 'Preencha a Razão Social / Nome Completo'
                        : 'Salvar Cadastro'
                  }
                  className="px-6 py-2.5 rounded bg-[#1e3a6e] hover:bg-[#162b54] text-white text-xs font-extrabold shadow-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {saving
                    ? 'Salvando Cadastro...'
                    : isNew
                      ? 'Cadastrar Cliente / Empresa'
                      : 'Salvar Alterações do Cadastro'}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
