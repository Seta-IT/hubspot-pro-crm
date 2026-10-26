'use client';

import React, { useState } from 'react';
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
} from 'lucide-react';
import { Company } from '../../db/types';

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
  mode?: 'CREATE' | 'EDIT';
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
  canDelete = true,
  onClose,
  onSave,
  onDelete,
}: GestaoClickCompanyModalProps) {
  const company = companyProp !== undefined ? companyProp : (initialCompany ?? null);
  const isNew = isNewProp !== undefined ? isNewProp : mode === 'CREATE' || !company?.id;
  const cp = (company?.customProperties || {}) as Record<string, unknown>;
  const firstAddr = Array.isArray(cp.addresses) && cp.addresses[0]
    ? (cp.addresses[0] as Record<string, unknown>)
    : {};

  // Bloco 1: Dados Gerais & Fiscais
  const [personType, setPersonType] = useState<string>(
    String(cp.customerType || 'Pessoa Jurídica')
  );
  const [situation, setSituation] = useState<string>(String(cp.situation || 'Ativo'));
  const [internalCode, setInternalCode] = useState<string>(
    String(cp.gestaoClickClientId || cp.internalCode || `GC-${Math.floor(1000 + Math.random() * 9000)}`)
  );
  const [cnpj, setCnpj] = useState<string>(String(company?.cnpj || ''));
  const [legalName, setLegalName] = useState<string>(String(company?.name || ''));
  const [tradeName, setTradeName] = useState<string>(
    String(cp.tradeName || company?.name || '')
  );
  const [stateRegistration, setStateRegistration] = useState<string>(
    String(cp.stateRegistration || 'ISENTO')
  );
  const [ieIndicator, setIeIndicator] = useState<string>(
    String(cp.ieIndicator || 'Contribuinte Isento')
  );
  const [municipalRegistration, setMunicipalRegistration] = useState<string>(
    String(cp.municipalRegistration || '')
  );
  const [suframa, setSuframa] = useState<string>(String(cp.suframa || ''));
  const [taxRegime, setTaxRegime] = useState<string>(
    String(cp.taxRegime || 'Lucro Presumido')
  );
  const [cnaeMain, setCnaeMain] = useState<string>(
    String(cp.cnaeMain || '61.10-8-03')
  );
  const [cnaeDescription, setCnaeDescription] = useState<string>(
    String(cp.cnaeDescription || company?.industry || 'Serviços de Telecomunicações e TI')
  );
  const [openingDate, setOpeningDate] = useState<string>(
    String(cp.openingDate || '2015-03-10')
  );
  const [companySize, setCompanySize] = useState<string>(
    String(company?.size || 'Médio / Grande Porte')
  );
  const [shareCapital, setShareCapital] = useState<string>(
    String(cp.shareCapital ?? company?.annualRevenue ?? 1500000)
  );
  const [ownerName, setOwnerName] = useState<string>(
    String(company?.ownerName || cp.sellerName || 'Marcelo Lopes Mira')
  );

  // Bloco 2: Endereço Completo + IBGE
  const [cep, setCep] = useState<string>(String(firstAddr.cep || cp.cep || '01310-100'));
  const [street, setStreet] = useState<string>(
    String(firstAddr.street || cp.street || 'Avenida Paulista')
  );
  const [number, setNumber] = useState<string>(String(firstAddr.number || cp.number || '1000'));
  const [complement, setComplement] = useState<string>(
    String(firstAddr.complement || cp.complement || '')
  );
  const [neighborhood, setNeighborhood] = useState<string>(
    String(firstAddr.neighborhood || cp.neighborhood || 'Bela Vista')
  );
  const [city, setCity] = useState<string>(String(company?.city || 'São Paulo'));
  const [uf, setUf] = useState<string>(String(company?.state || 'SP'));
  const [ibgeCode, setIbgeCode] = useState<string>(String(cp.ibgeCode || '3550308'));

  // Bloco 3: Contatos & Comunicação
  const [commercialPhone, setCommercialPhone] = useState<string>(
    String(cp.phone || '(11) 3958-4929')
  );
  const [whatsappPhone, setWhatsappPhone] = useState<string>(
    String(cp.whatsappPhone || '(11) 93958-4929')
  );
  const [commercialEmail, setCommercialEmail] = useState<string>(
    String(cp.emailComercial || (company?.domain ? `contato@${company.domain}` : ''))
  );
  const [financialNfeEmail, setFinancialNfeEmail] = useState<string>(
    String(cp.emailFinanceiroNfe || (company?.domain ? `nfe@${company.domain}` : ''))
  );
  const [domain, setDomain] = useState<string>(String(company?.domain || ''));
  const [additionalContacts, setAdditionalContacts] = useState<AdditionalCompanyContact[]>(() => {
    if (Array.isArray(cp.additionalContacts) && cp.additionalContacts.length > 0) {
      return cp.additionalContacts as AdditionalCompanyContact[];
    }
    return [
      {
        id: 'ac-1',
        name: 'Departamento Financeiro / Compras',
        role: 'Financeiro & Faturamento',
        email: company?.domain ? `financeiro@${company.domain}` : 'financeiro@cliente.com.br',
        phone: '(11) 3958-4929',
      },
    ];
  });

  // Bloco 4: Dados Financeiros & Faturamento
  const [creditLimitBrl, setCreditLimitBrl] = useState<string>(
    String(cp.creditLimitBrl ?? 150000)
  );
  const [defaultPaymentCondition, setDefaultPaymentCondition] = useState<string>(
    String(cp.defaultPaymentCondition || 'Boleto 30 DDL')
  );
  const [preferredBank, setPreferredBank] = useState<string>(
    String(cp.preferredBank || 'Banco Inter')
  );
  const [billingDueDay, setBillingDueDay] = useState<string>(
    String(cp.billingDueDay || '10')
  );
  const [taxWithholdingConfig, setTaxWithholdingConfig] = useState<string>(
    String(cp.taxWithholdingConfig || 'Dispensa ISS Locação (SV 31 STF) / Retenção IRRF+CSRF em Serviços')
  );
  const [fiscalNotes, setFiscalNotes] = useState<string>(
    String(cp.notes || 'Cadastro corporativo validado na Receita Federal e sincronizado com o GestãoClick #118887.')
  );

  // Receita Federal Lookup & 2-Step Deletion States
  const [lookingUpCnpj, setLookingUpCnpj] = useState(false);
  const [receitaStatusBanner, setReceitaStatusBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirmStep, setShowDeleteConfirmStep] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleLookupReceitaFederal = async (rawVal?: string) => {
    const targetCnpj = rawVal !== undefined ? rawVal : cnpj;
    const digits = targetCnpj.replace(/\D+/g, '');
    if (digits.length !== 14) {
      setReceitaStatusBanner('Digite os 14 números do CNPJ para consultar na Receita Federal.');
      return;
    }
    setLookingUpCnpj(true);
    setReceitaStatusBanner(null);
    try {
      const res = await fetch(`/api/cnpj/lookup?cnpj=${encodeURIComponent(digits)}`);
      if (res.ok) {
        const json = await res.json();
        const d = json.data;
        if (d) {
          setCnpj(d.cnpj);
          setLegalName(d.razaoSocial);
          setTradeName(d.nomeFantasia || d.razaoSocial);
          setSituation(d.situacaoCadastral === 'ATIVA' ? 'Ativo' : 'Inativo');
          setOpeningDate(d.dataAbertura || '2015-01-10');
          setCnaeMain(d.cnaePrincipal || '61.10-8-03');
          setCnaeDescription(d.cnaeDescricao || 'Serviços de Telecomunicações e TI');
          setCompanySize(d.porte || 'Médio / Grande Porte');
          setShareCapital(String(d.capitalSocial || 1000000));
          setStateRegistration(d.inscricaoEstadual || 'ISENTO');
          setIeIndicator(d.indicadorIe || 'Contribuinte Isento');
          setMunicipalRegistration(d.inscricaoMunicipal || '');
          setTaxRegime(d.regimeTributario || 'Lucro Presumido');
          setCep(d.cep || cep);
          setStreet(d.logradouro || street);
          setNumber(d.numero || number);
          setComplement(d.complemento || '');
          setNeighborhood(d.bairro || neighborhood);
          setCity(d.cidade || city);
          setUf(d.uf || uf);
          setIbgeCode(d.codigoIbge || '3550308');
          if (d.telefone) setCommercialPhone(d.telefone);
          if (d.celularWhatsapp) setWhatsappPhone(d.celularWhatsapp);
          if (d.emailComercial) setCommercialEmail(d.emailComercial);
          if (d.emailFinanceiroNfe) setFinancialNfeEmail(d.emailFinanceiroNfe);
          if (d.website) setDomain(d.website);
          setReceitaStatusBanner(
            `SITUAÇÃO ${d.situacaoCadastral} NA RECEITA FEDERAL — Dados oficiais preenchidos automaticamente (${d.source}).`
          );
        }
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
    if (!legalName.trim()) return;
    setSaving(true);
    try {
      await onSave(
        {
          ...(company?.id ? { id: company.id } : {}),
          name: legalName.trim(),
          cnpj: cnpj.trim() || null,
          domain: domain.trim() || null,
          industry: cnaeDescription.trim() || 'Telecomunicações & TI',
          size: companySize,
          annualRevenue: Number(shareCapital) || 1500000,
          city: city.trim() || 'São Paulo',
          state: uf.trim() || 'SP',
          ownerName,
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
            sellerName: ownerName,
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
                cityState: `${city} (${uf})`,
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
        <div className="px-6 py-3.5 bg-[#1e3a6e] text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Building2 className="w-5 h-5 text-emerald-300" />
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-300 block">
                Padrão Oficial GestãoClick (#118887) &amp; Receita Federal do Brasil
              </span>
              <h2 className="text-sm sm:text-base font-extrabold">
                {isNew
                  ? 'Adicionar Cliente / Empresa (Cadastro Completo)'
                  : `Editar Cadastro de Cliente / Empresa — ${legalName}`}
              </h2>
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

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs max-h-[84vh] overflow-y-auto">
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

          {/* BLOCO 1: DADOS GERAIS & FISCAIS (COM BUSCA AUTOMÁTICA POR CNPJ NA RECEITA FEDERAL) */}
          <div className="bg-white rounded-md border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-800">
                  1. Dados Gerais, CNPJ (Receita Federal) &amp; Enquadramento Fiscal
                </h3>
                <p className="text-[11px] text-slate-500">
                  Digite os 14 dígitos do CNPJ ou clique em Consultar CNPJ na Receita Federal para preenchimento automático.
                </p>
              </div>
              <span className="px-2.5 py-0.5 rounded bg-blue-50 text-[#1e3a6e] border border-blue-200 text-[10px] font-extrabold">
                Trava Fiscal de CNPJ Ativa
              </span>
            </div>

            <div className="p-5 space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Tipo de Pessoa *
                  </label>
                  <select
                    value={personType}
                    onChange={(e) => setPersonType(e.target.value)}
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
                    className="w-full px-2.5 py-2 rounded border border-slate-300 font-mono bg-slate-50"
                  />
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    CNPJ / CPF *
                  </label>
                  <input
                    type="text"
                    required
                    value={cnpj}
                    onChange={(e) => {
                      const val = e.target.value;
                      setCnpj(val);
                      if (val.replace(/\D+/g, '').length === 14) {
                        handleLookupReceitaFederal(val);
                      }
                    }}
                    placeholder="00.000.000/0001-00"
                    className="w-full px-3 py-2 rounded border border-slate-300 font-mono font-bold text-slate-900"
                  />
                </div>

                <div className="sm:col-span-3">
                  <button
                    type="button"
                    disabled={lookingUpCnpj}
                    onClick={() => handleLookupReceitaFederal()}
                    className="w-full py-2 px-3 rounded bg-[#1e3a6e] hover:bg-[#162b54] text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    <Search className="w-3.5 h-3.5 text-emerald-300" />
                    {lookingUpCnpj ? 'Consultando RFB...' : 'Consultar CNPJ na Receita Federal'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-5">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Razão Social / Nome Completo *
                  </label>
                  <input
                    type="text"
                    required
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    className="w-full px-3 py-2 rounded border border-slate-300 font-bold text-slate-900"
                  />
                </div>

                <div className="sm:col-span-4">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Nome Fantasia
                  </label>
                  <input
                    type="text"
                    value={tradeName}
                    onChange={(e) => setTradeName(e.target.value)}
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
                  value={cep}
                  onChange={(e) => {
                    setCep(e.target.value);
                    if (e.target.value.replace(/\D+/g, '').length === 8) {
                      handleLookupCep(e.target.value);
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
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Número *</label>
                <input
                  type="text"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Complemento</label>
                <input
                  type="text"
                  value={complement}
                  onChange={(e) => setComplement(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>

              <div className="sm:col-span-4">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Bairro *</label>
                <input
                  type="text"
                  value={neighborhood}
                  onChange={(e) => setNeighborhood(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>
              <div className="sm:col-span-4">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Cidade *</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
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
                    { id: `ac-${Date.now()}`, name: '', role: 'TI / Compras', email: '', phone: '' },
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
                    onChange={(e) => setCommercialPhone(e.target.value)}
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
                    onChange={(e) => setWhatsappPhone(e.target.value)}
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
                          copy[idx].phone = e.target.value;
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
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>
            </div>
          </div>

          {/* RODAPÉ COM ZONA DE SEGURANÇA (EXCLUSÃO SOMENTE DENTRO DO CADASTRO COM CONFIRMAÇÃO EM 2 ETAPAS) */}
          <div className="bg-white rounded-md border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              {!isNew && company?.id && onDelete && canDelete && (
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
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2.5 rounded bg-[#1e3a6e] hover:bg-[#162b54] text-white text-xs font-extrabold shadow-sm cursor-pointer disabled:opacity-50"
              >
                {saving ? 'Salvando Cadastro...' : isNew ? 'Cadastrar Cliente / Empresa' : 'Salvar Alterações do Cadastro'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
