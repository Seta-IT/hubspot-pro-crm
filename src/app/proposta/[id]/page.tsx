'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import {
  Printer,
  Copy,
  CheckCircle2,
  ShieldCheck,
  Building2,
  Phone,
  Mail,
  FileText,
  Scale,
  ArrowLeft,
  Calendar,
  UserCheck,
  Edit3,
  Truck,
  CreditCard,
} from 'lucide-react';
import { ErpCommercialProposal, ErpProposalDigitalSignature } from '../../../db/types';
import { formatBRL } from '../../components/ui-helpers';
import {
  buildPublicProposalUrl,
  computeProposalTotals,
  decodeProposalFromQueryParam,
  encodeProposalToQueryParam,
  inferProposalItemType,
} from '../../lib/proposal-share';
import { loadDurableJournal, recordUpsertedContract, recordUpsertedInvoice, recordUpsertedProposal } from '../../lib/durable-storage';
import { ProposalEditModal } from '../../components/ErpEditModals';

function PublicProposalPrintContent() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const rawId = decodeURIComponent(String(params?.id || ''));
  const encodedData = searchParams?.get('d');
  const autoPrint = searchParams?.get('print') === '1';

  const [proposal, setProposal] = useState<ErpCommercialProposal | null>(() =>
    decodeProposalFromQueryParam(encodedData)
  );
  const [loading, setLoading] = useState<boolean>(!proposal);
  const [copied, setCopied] = useState(false);

  // Full In-Page Editor State
  const [isEditing, setIsEditing] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [approvingContract, setApprovingContract] = useState(false);
  const [convertedContractInfo, setConvertedContractInfo] = useState<{
    contractNumber: string;
    invoiceNumber: string;
  } | null>(null);
  const [showIcpSignatureModal, setShowIcpSignatureModal] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [signerCpf, setSignerCpf] = useState('284.910.538-09');
  const [signerRole, setSignerRole] = useState('Diretor / Representante Legal');
  const [signatureModality, setSignatureModality] = useState<
    'ICP_BRASIL_A1' | 'ICP_BRASIL_A3' | 'GOV_BR_OURO'
  >('ICP_BRASIL_A1');

  useEffect(() => {
    const decoded = decodeProposalFromQueryParam(encodedData);
    if (decoded) {
      setProposal(computeProposalTotals(decoded));
      setLoading(false);
      return;
    }

    const journal = loadDurableJournal();
    const localFound = (journal.upsertedProposals || []).find(
      (p) =>
        p.id === rawId ||
        p.code.toLowerCase() === rawId.toLowerCase() ||
        p.id.toLowerCase() === rawId.toLowerCase()
    );
    if (localFound) {
      setProposal(computeProposalTotals(localFound));
      setLoading(false);
      return;
    }

    let active = true;
    fetch('/api/erp/proposals')
      .then((r) => r.json())
      .then((json) => {
        if (!active) return;
        const list: ErpCommercialProposal[] = Array.isArray(json?.data) ? json.data : [];
        const match =
          list.find(
            (p) =>
              p.id === rawId ||
              p.code.toLowerCase() === rawId.toLowerCase() ||
              p.id.toLowerCase() === rawId.toLowerCase()
          ) || null;
        setProposal(match ? computeProposalTotals(match) : null);
        setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [rawId, encodedData]);

  useEffect(() => {
    if (proposal && autoPrint && !isEditing) {
      const timer = setTimeout(() => {
        window.print();
      }, 450);
      return () => clearTimeout(timer);
    }
  }, [proposal, autoPrint, isEditing]);

  const handleSaveEdit = async (updated: ErpCommercialProposal) => {
    const computed = computeProposalTotals({
      ...updated,
      updatedAt: new Date().toISOString(),
    });

    const res = await fetch(`/api/erp/proposals/${encodeURIComponent(computed.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(computed),
    });
    const finalProposal: ErpCommercialProposal = res.ok
      ? computeProposalTotals((await res.json())?.data || computed)
      : computed;

    recordUpsertedProposal(finalProposal);
    setProposal(finalProposal);
    setIsEditing(false);

    if (typeof window !== 'undefined') {
      const newEncoded = encodeProposalToQueryParam(finalProposal);
      const url = new URL(window.location.href);
      if (newEncoded) url.searchParams.set('d', newEncoded);
      window.history.replaceState({}, '', url.toString());
    }

    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 3500);
  };

  const handleApproveAndConvertInPage = async () => {
    if (!proposal) return;
    setApprovingContract(true);
    try {
      const effectiveSignerName =
        signerName.trim() || proposal.careOf || proposal.contactName || 'Representante Legal Autorizado';
      await fetch(`/api/erp/proposals/${encodeURIComponent(proposal.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proposal),
      }).catch(() => null);

      const res = await fetch(`/api/erp/proposals/${encodeURIComponent(proposal.id)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signerName: effectiveSignerName,
          signerCpf: signerCpf.trim() || '284.910.538-09',
          signerRole: signerRole.trim() || 'Diretor / Representante Legal',
          modality: signatureModality,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const sig: ErpProposalDigitalSignature | undefined =
          json?.data?.digitalSignature || json?.data?.proposal?.digitalSignature;
        const nextProp: ErpCommercialProposal = json?.data?.proposal || {
          ...proposal,
          status: 'CONVERTIDA_CONTRATO',
          convertedContractId: json?.data?.contract?.id || `ctr-${Date.now()}`,
          digitalSignature: sig || null,
        };
        if (json?.data?.proposal) recordUpsertedProposal(json.data.proposal);
        if (json?.data?.contract) recordUpsertedContract(json.data.contract);
        if (json?.data?.invoice) recordUpsertedInvoice(json.data.invoice);
        setProposal(nextProp);
        setConvertedContractInfo({
          contractNumber:
            json?.data?.contract?.contractNumber || nextProp.convertedContractId || 'LOC-2026',
          invoiceNumber: json?.data?.invoice?.documentNumber || 'FAT-LOC-2026',
        });
        setShowIcpSignatureModal(false);
      }
    } finally {
      setApprovingContract(false);
    }
  };

  const handleCopyPublicLink = () => {
    if (!proposal) return;
    const url = buildPublicProposalUrl(proposal);
    navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f4f6f9] flex items-center justify-center p-6">
        <div className="bg-white rounded-lg border border-slate-200 p-8 shadow-sm text-center max-w-md w-full">
          <div className="w-10 h-10 rounded-full border-3 border-[#1e3a6e] border-t-transparent animate-spin mx-auto mb-3" />
          <p className="text-sm font-bold text-slate-800">
            Carregando Proposta Comercial Seta Telecom...
          </p>
        </div>
      </div>
    );
  }

  if (!proposal) {
    return (
      <div className="min-h-screen bg-[#f4f6f9] flex items-center justify-center p-6">
        <div className="bg-white rounded-lg border border-slate-200 p-8 shadow-sm text-center max-w-lg w-full space-y-4">
          <FileText className="w-12 h-12 text-[#1e3a6e] mx-auto" />
          <h1 className="text-lg font-extrabold text-slate-900">
            Proposta Comercial #{rawId || 'Não identificada'} não localizada
          </h1>
          <p className="text-xs text-slate-600 leading-relaxed">
            Não encontramos nenhum orçamento com o identificador <strong>{rawId}</strong> e nenhum payload compartilhado (<code>?d=</code>) foi informado na URL. Volte ao painel da Seta Telecom para abrir ou gerar o link público da proposta desejada.
          </p>
          <a
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md bg-[#1e3a6e] text-white text-xs font-bold hover:bg-[#162b54] transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar para o CRM &amp; ERP Seta Telecom
          </a>
        </div>
      </div>
    );
  }

  const issueDateStr = proposal.proposalDate
    ? proposal.proposalDate.includes('-')
      ? new Date(`${proposal.proposalDate.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')
      : proposal.proposalDate
    : proposal.createdAt
      ? new Date(proposal.createdAt).toLocaleDateString('pt-BR')
      : new Date().toLocaleDateString('pt-BR');

  const validUntilStr = proposal.validUntil
    ? proposal.validUntil.includes('-') && proposal.validUntil.length >= 10
      ? new Date(`${proposal.validUntil.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')
      : proposal.validUntil
    : '15 dias';

  const recurringItems = proposal.items.filter((i) => i.isRecurring !== false);
  const setupItems = proposal.items.filter((i) => i.isRecurring === false);

  const productsSubtotal =
    proposal.productsSubtotal ??
    proposal.items
      .filter((i) => inferProposalItemType(i) === 'PRODUCT')
      .reduce((s, i) => s + Number(i.subtotal ?? i.totalMonthly ?? 0), 0);

  const servicesSubtotal =
    proposal.servicesSubtotal ??
    proposal.items
      .filter((i) => inferProposalItemType(i) === 'SERVICE')
      .reduce((s, i) => s + Number(i.subtotal ?? i.totalMonthly ?? 0), 0);

  const itemDiscountsSum = proposal.items.reduce((acc, it) => {
    const gross = Math.max(1, Number(it.quantity || 1)) * Number(it.unitPrice || 0);
    const net = Number(it.subtotal ?? it.totalMonthly ?? gross);
    return acc + Math.max(0, gross - net);
  }, 0);

  const globalDiscountVal =
    Number(proposal.discountAmount || 0) +
    Math.round(
      (productsSubtotal + servicesSubtotal) *
        (Number(proposal.discountPercentGlobal || 0) / 100) *
        100
    ) /
      100;

  const totalDiscounts = Math.round((itemDiscountsSum + globalDiscountVal) * 100) / 100;
  const shippingCost = Number(proposal.shippingCost || 0);

  const locacaoTotal = proposal.items
    .filter((i) => i.fiscalNature === 'LOCACAO_BENS_MOVEIS')
    .reduce((s, i) => s + i.totalMonthly, 0);
  const servicoTotal = proposal.items
    .filter((i) => i.fiscalNature !== 'LOCACAO_BENS_MOVEIS')
    .reduce((s, i) => s + i.totalMonthly, 0);
  const issSavedMonthly = Math.round(locacaoTotal * 0.05 * 100) / 100;

  return (
    <div className="min-h-screen bg-[#e9eef5] py-6 px-3 sm:px-6 print:bg-white print:p-0">
      {/* TOP ACTION BAR (HIDDEN ON PRINT) */}
      <div className="max-w-4xl mx-auto mb-5 bg-[#1e3a6e] text-white rounded-lg px-4 py-3.5 shadow-lg flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-xs font-bold transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Painel Seta Telecom
          </a>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-300">
                Portal do Cliente • Documento Oficial A4
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-white/15">
                {proposal.code}
              </span>
              {savedNotice && (
                <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-500 text-slate-950">
                  ✓ Proposta Atualizada!
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-200">
              Você pode <strong>Editar a Proposta</strong> antes de gerar o PDF ou clicar em{' '}
              <strong>Imprimir / Salvar em PDF</strong>.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold shadow-xs transition cursor-pointer"
          >
            <Edit3 className="w-4 h-4" />
            ✏️ Editar Proposta antes de Imprimir
          </button>

          <button
            type="button"
            onClick={handleCopyPublicLink}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-white/15 hover:bg-white/25 text-white text-xs font-bold transition cursor-pointer"
          >
            {copied ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                Link Atualizado Copiado!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                Copiar Link p/ Cliente
              </>
            )}
          </button>

          <select
            value={proposal.templateStyle || 'SETA_PREMIUM_TELECOM'}
            onChange={(e) =>
              setProposal({
                ...proposal,
                templateStyle: e.target.value as ErpCommercialProposal['templateStyle'],
              })
            }
            className="px-2.5 py-2 rounded-md bg-white/15 text-white text-xs font-extrabold border border-white/25 cursor-pointer"
            title="Escolher Template Visual do Documento A4"
          >
            <option value="SETA_PREMIUM_TELECOM" className="text-slate-900">
              Template: Seta Premium Telecom
            </option>
            <option value="EXECUTIVO_CORPORATIVO" className="text-slate-900">
              Template: Executivo Corporativo B2B
            </option>
            <option value="LOCACAO_DETALHADA_SLA" className="text-slate-900">
              Template: Locação + SLA &amp; Rateio Pro-Rata
            </option>
          </select>

          {proposal.status !== 'CONVERTIDA_CONTRATO' && !proposal.convertedContractId ? (
            <button
              type="button"
              disabled={approvingContract}
              onClick={() => {
                if (!signerName.trim()) {
                  setSignerName(proposal.careOf || proposal.contactName || 'Representante Legal');
                }
                setShowIcpSignatureModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-emerald-400 hover:bg-emerald-300 text-slate-950 text-xs font-black shadow-md transition cursor-pointer disabled:opacity-50"
            >
              <ShieldCheck className="w-4 h-4" />
              {approvingContract ? 'Assinando...' : 'Assinar ICP-Brasil / Gov.br & Aprovar'}
            </button>
          ) : (
            <a
              href="/"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-emerald-400 text-slate-950 text-xs font-black"
            >
              <CheckCircle2 className="w-4 h-4" />
              Contrato Gerado ({convertedContractInfo?.contractNumber || proposal.convertedContractId})
            </a>
          )}

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold shadow-md transition cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            Imprimir / Salvar em PDF
          </button>
        </div>
      </div>

      {/* FULL GESTÃOCLICK PROPOSAL EDITOR MODAL (HIDDEN ON PRINT) */}
      {isEditing && (
        <div className="print:hidden">
          <ProposalEditModal
            proposal={proposal}
            onClose={() => setIsEditing(false)}
            onSave={handleSaveEdit}
          />
        </div>
      )}

      {showIcpSignatureModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/75 backdrop-blur-xs flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="px-6 py-4 bg-[#1e3a6e] text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-300" />
                <div>
                  <span className="text-[10px] font-extrabold uppercase text-emerald-300 block">
                    Validade Jurídica MP 2.200-2/2001 &amp; Lei 14.063/2020
                  </span>
                  <h3 className="text-sm font-extrabold">
                    Assinatura Eletrônica ICP-Brasil / Gov.br ({proposal.code})
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowIcpSignatureModal(false)}
                className="text-slate-300 hover:text-white text-xs font-bold cursor-pointer"
              >
                Fechar
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs text-slate-800">
              <div className="p-3 rounded bg-slate-50 border border-slate-200 space-y-1">
                <div className="font-bold text-slate-900">{proposal.companyName}</div>
                <div className="text-slate-600">
                  CNPJ: <strong>{proposal.companyCnpj}</strong> • Mensalidade (MRR):{' '}
                  <strong className="text-emerald-700">{formatBRL(proposal.monthlyRecurringTotal)}/mês</strong> • Prazo:{' '}
                  <strong>{proposal.contractMonths} meses</strong>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Nome Completo do Signatário (Representante Legal) *
                  </label>
                  <input
                    type="text"
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    placeholder="Ex.: Carlos Eduardo Almeida"
                    className="w-full px-3 py-2 rounded border border-slate-300 font-semibold"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">CPF do Signatário *</label>
                    <input
                      type="text"
                      value={signerCpf}
                      onChange={(e) => setSignerCpf(e.target.value)}
                      placeholder="000.000.000-00"
                      className="w-full px-3 py-2 rounded border border-slate-300 font-mono font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Cargo / Qualificação *</label>
                    <input
                      type="text"
                      value={signerRole}
                      onChange={(e) => setSignerRole(e.target.value)}
                      placeholder="Diretor / Procurador"
                      className="w-full px-3 py-2 rounded border border-slate-300 font-semibold"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Modalidade de Certificação Digital
                  </label>
                  <select
                    value={signatureModality}
                    onChange={(e) =>
                      setSignatureModality(
                        e.target.value as 'ICP_BRASIL_A1' | 'ICP_BRASIL_A3' | 'GOV_BR_OURO'
                      )
                    }
                    className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-bold text-[#1e3a6e]"
                  >
                    <option value="ICP_BRASIL_A1">
                      Certificado Digital e-CNPJ / e-CPF ICP-Brasil Tipo A1
                    </option>
                    <option value="ICP_BRASIL_A3">
                      Token / Smartcard Criptográfico ICP-Brasil Tipo A3
                    </option>
                    <option value="GOV_BR_OURO">
                      Assinatura Eletrônica Avançada / Qualificada Gov.br (Nível Ouro — ITI)
                    </option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowIcpSignatureModal(false)}
                  className="px-4 py-2 rounded border border-slate-300 text-slate-700 font-bold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={approvingContract}
                  onClick={handleApproveAndConvertInPage}
                  className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {approvingContract
                    ? 'Gerando Hash SHA-256 & Contrato...'
                    : 'Confirmar Assinatura ICP-Brasil & Gerar Contrato'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* A4 DOCUMENT CONTAINER */}
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-xl border border-slate-200 overflow-hidden print:shadow-none print:border-0 print:rounded-none">
        {/* HEADER TIMBRADO SETA TELECOM / SETA | IT */}
        <div className="bg-gradient-to-r from-[#1e3a6e] via-[#244682] to-[#1e3a6e] text-white px-8 py-6 border-b-4 border-[#f26522]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              {/* OFFICIAL SETA | IT LOGO CARD */}
              <div className="bg-white rounded-md px-4 py-2.5 shadow-sm flex items-center gap-2 shrink-0 border border-slate-200">
                <span className="text-xl font-black tracking-tight text-[#0d2b4e]">SETA</span>
                <span className="w-[2px] h-5 bg-[#f26522] inline-block" />
                <span className="text-xl font-black tracking-tight text-[#f26522]">IT</span>
              </div>

              <div>
                <h1 className="text-lg sm:text-xl font-black tracking-tight">
                  SETA TELECOM LTDA
                </h1>
                <p className="text-xs text-slate-200">
                  CNPJ: 14.806.925/0001-32 • Loja {proposal.storeName || 'Matriz'} #118887 • GestãoClick ERP-GROK
                </p>
                <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-200 mt-1">
                  <span className="inline-flex items-center gap-1">
                    <Phone className="w-3 h-3 text-emerald-300" /> (11) 3958-4929
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Mail className="w-3 h-3 text-emerald-300" /> comercial@setatelecom.com.br
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-white/10 backdrop-blur-xs border border-white/20 rounded-lg px-4 py-3 text-right shrink-0">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-300">
                PROPOSTA COMERCIAL / ORÇAMENTO
              </div>
              <div className="text-xl font-black text-white mt-0.5">{proposal.code}</div>
              <div className="text-[11px] text-slate-200 mt-0.5">
                Emissão: <strong>{issueDateStr}</strong> • Validade: <strong>{validUntilStr}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* DOCUMENT BODY */}
        <div className="p-8 space-y-5 text-slate-800">
          {/* CLIENTE & DADOS COMERCIAIS */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-[#f8fafc] border border-slate-200 rounded-lg p-4">
            <div className="space-y-1">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5 text-[#1e3a6e]" />
                Dados da Empresa Cliente (Proponente / Locatária)
              </div>
              <div className="text-base font-black text-slate-900">{proposal.companyName}</div>
              <div className="text-xs text-slate-600">
                <strong>CNPJ / CPF:</strong> {proposal.companyCnpj || 'Sob consulta'}
              </div>
              <div className="text-xs text-slate-600">
                <strong>Aos cuidados de:</strong> {proposal.careOf || proposal.contactName}
                {proposal.contactEmail ? ` (${proposal.contactEmail})` : ''}
              </div>
              {proposal.deliveryAddress && (
                <div className="text-xs text-slate-600">
                  <strong>Local de Entrega / Instalação:</strong> {proposal.deliveryAddress}
                </div>
              )}
            </div>

            <div className="space-y-1 md:border-l md:border-slate-200 md:pl-4">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                <UserCheck className="w-3.5 h-3.5 text-[#1e3a6e]" />
                Condições Gerais &amp; Executivo Seta Telecom
              </div>
              <div className="text-sm font-extrabold text-slate-900">
                {proposal.sellerName}{' '}
                <span className="text-xs font-normal text-slate-500">
                  ({proposal.salesChannel || 'Comercial B2B / Consultivo'})
                </span>
              </div>
              <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  Prazo Contratual: <strong>{proposal.contractMonths} meses</strong>
                </span>
                <span>
                  Prazo de Entrega: <strong>{proposal.deliveryForecast || 'Imediato (até 48h)'}</strong>
                </span>
              </div>
              <div className="text-xs text-slate-600">
                <strong>Centro de Custo / Unidade:</strong>{' '}
                {proposal.costCenter || 'Comercial Telecom & TI'} • Loja {proposal.storeName || 'Matriz'}
              </div>
              <div className="text-xs text-slate-600">
                <strong>Condição de Pagamento:</strong> {proposal.paymentCondition}
              </div>
            </div>
          </div>

          {/* FAIXA EXECUTIVA DE SLA, REAJUSTE E RATEIO PROPORCIONAL (PRO-RATA DIE) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3.5 rounded-lg bg-indigo-950 text-white text-xs">
            <div>
              <span className="text-[10px] uppercase text-emerald-300 font-bold block">
                Template &amp; Modalidade
              </span>
              <strong className="font-extrabold">
                {proposal.templateStyle === 'LOCACAO_DETALHADA_SLA'
                  ? 'Locação + SLA & Pro-Rata'
                  : proposal.templateStyle === 'EXECUTIVO_CORPORATIVO'
                    ? 'Executivo Corporativo B2B'
                    : 'Seta Premium Telecom'}
              </strong>
            </div>
            <div>
              <span className="text-[10px] uppercase text-emerald-300 font-bold block">
                SLA Atendimento NOC 24x7
              </span>
              <strong className="font-extrabold">
                {proposal.slaAvailabilityPercent || '99,95%'} • Resp. {proposal.slaResponseHours || 4}h
              </strong>
            </div>
            <div>
              <span className="text-[10px] uppercase text-emerald-300 font-bold block">
                Índice de Reajuste Anual
              </span>
              <strong className="font-extrabold">
                {proposal.readjustmentIndex || 'IPCA'} (12 meses)
              </strong>
            </div>
            <div>
              <span className="text-[10px] uppercase text-emerald-300 font-bold block">
                Flexibilidade Contratual
              </span>
              <strong className="font-extrabold">
                Rateio Pro-Rata s/ Pausar Contrato
              </strong>
            </div>
          </div>

          {/* OBJETO E INTRODUÇÃO PERSONALIZADA */}
          <div className="border-l-4 border-[#1e3a6e] pl-4 py-1 space-y-1.5">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#1e3a6e]">
              Objeto da Proposta Comercial
            </span>
            <h2 className="text-base sm:text-lg font-black text-slate-900">
              {proposal.title}
            </h2>
            {proposal.introductionText && (
              <p className="text-xs text-slate-600 leading-relaxed">
                {proposal.introductionText}
              </p>
            )}
          </div>

          {/* TABELA DE ITENS (PRODUTOS E SERVIÇOS) */}
          <div className="border border-slate-300 rounded-lg overflow-hidden">
            <div className="bg-[#1e3a6e] text-white px-4 py-2.5 flex items-center justify-between text-xs font-extrabold">
              <span>ESPECIFICAÇÃO DOS PRODUTOS, EQUIPAMENTOS &amp; SERVIÇOS TÉCNICOS</span>
              <span>VALORES EM REAIS (BRL)</span>
            </div>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-600 uppercase text-[10px] border-b border-slate-300">
                <tr>
                  <th className="py-2.5 px-3">Código / SKU</th>
                  <th className="py-2.5 px-3">Descrição do Item / Escopo</th>
                  <th className="py-2.5 px-3">Tipo &amp; Enquadramento Fiscal</th>
                  <th className="py-2.5 px-2 text-center">Qtd</th>
                  <th className="py-2.5 px-3 text-right">Vlr. Unitário</th>
                  <th className="py-2.5 px-2 text-right">Desconto</th>
                  <th className="py-2.5 px-3 text-right">Subtotal Líquido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {proposal.items.map((item, idx) => {
                  const isSrv = inferProposalItemType(item) === 'SERVICE';
                  const hasDisc =
                    (item.discountPercent || 0) > 0 || (item.discountAmount || 0) > 0;
                  return (
                    <tr key={item.id || idx} className="hover:bg-slate-50/80">
                      <td className="py-3 px-3 font-mono font-bold text-slate-800">{item.sku}</td>
                      <td className="py-3 px-3">
                        <div className="font-bold text-slate-900">{item.description}</div>
                        <div className="text-[10px] text-slate-500">
                          Classificação: {item.ncmOrServiceCode} •{' '}
                          {item.isRecurring !== false
                            ? 'Mensal Recorrente (MRR)'
                            : 'Taxa Única (Setup / Venda)'}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            item.fiscalNature === 'LOCACAO_BENS_MOVEIS'
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : isSrv
                                ? 'bg-indigo-50 text-indigo-800 border border-indigo-200'
                                : 'bg-blue-50 text-blue-800 border border-blue-200'
                          }`}
                        >
                          {item.fiscalNature === 'LOCACAO_BENS_MOVEIS'
                            ? 'Produto • Locação Pura (0% ISS — SV 31 STF)'
                            : item.fiscalNature === 'SERVICO_TECNICO_TI_TELECOM'
                              ? 'Serviço • TI/Telecom (LC 116)'
                              : item.fiscalNature === 'SERVICO_COMUNICACAO_SCM_SVA'
                                ? 'Serviço • Telecom SCM/SVA'
                                : 'Produto • Equipamento / Hardware'}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-center font-bold">
                        {item.quantity} {item.unit || ''}
                      </td>
                      <td className="py-3 px-3 text-right font-medium">
                        {formatBRL(item.unitPrice)}
                      </td>
                      <td className="py-3 px-2 text-right text-rose-600 font-semibold">
                        {hasDisc ? (
                          <>
                            {(item.discountPercent || 0) > 0 ? `${item.discountPercent}% ` : ''}
                            {(item.discountAmount || 0) > 0
                              ? `(-${formatBRL(item.discountAmount || 0)})`
                              : ''}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-black text-slate-900">
                        {formatBRL(item.subtotal ?? item.totalMonthly)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* RESUMO DE SUBTOTAIS (PRODUTOS, SERVIÇOS, DESCONTOS, FRETE) */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-xs">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500 block">
                Subtotal Produtos
              </span>
              <strong className="text-sm font-extrabold text-slate-900">
                {formatBRL(productsSubtotal)}
              </strong>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500 block">
                Subtotal Serviços
              </span>
              <strong className="text-sm font-extrabold text-indigo-900">
                {formatBRL(servicesSubtotal)}
              </strong>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500 block">
                Descontos Aplicados
              </span>
              <strong className="text-sm font-extrabold text-rose-600">
                {totalDiscounts > 0 ? `- ${formatBRL(totalDiscounts)}` : 'R$ 0,00'}
              </strong>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500 block">
                Frete / Transporte
              </span>
              <strong className="text-sm font-extrabold text-slate-900">
                {shippingCost > 0 ? formatBRL(shippingCost) : 'Cortesia / Incluso'}
              </strong>
              {proposal.shippingCarrier && (
                <span className="block text-[10px] text-slate-500 truncate">
                  {proposal.shippingCarrier}
                </span>
              )}
            </div>
            <div className="col-span-2 sm:col-span-1 text-right">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">
                Setup Único + Frete
              </span>
              <strong className="text-sm font-extrabold text-slate-900">
                {formatBRL(proposal.oneTimeSetupTotal)}
              </strong>
            </div>
          </div>

          {/* QUADRO DE AMPARO LEGAL E TOTAIS (MRR / TCV) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 p-4 rounded-lg bg-emerald-50/70 border border-emerald-200 space-y-2 text-xs">
              <div className="flex items-center gap-2 font-extrabold text-emerald-950 uppercase text-[11px]">
                <Scale className="w-4 h-4 text-emerald-700 shrink-0" />
                Amparo Legal &amp; Segregação Tributária (LC 116/2003 + STF SV 31)
              </div>
              <p className="text-emerald-900 leading-relaxed text-[11px]">
                {proposal.commercialNotes}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-emerald-200/80 text-[11px]">
                <div>
                  <span className="text-emerald-700 block">Parcela Locação (0% ISS):</span>
                  <strong className="text-emerald-950">{formatBRL(locacaoTotal)}/mês</strong>
                </div>
                <div>
                  <span className="text-emerald-700 block">Parcela Serviços (NFS-e):</span>
                  <strong className="text-emerald-950">{formatBRL(servicoTotal)}/mês</strong>
                </div>
                <div>
                  <span className="text-emerald-700 block">Economia Tributária ISS:</span>
                  <strong className="text-emerald-950">{formatBRL(issSavedMonthly)}/mês</strong>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-lg bg-[#1e3a6e] text-white flex flex-col justify-between space-y-3">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300 block">
                  Investimento Mensal (MRR)
                </span>
                <div className="text-2xl font-black text-emerald-300 mt-0.5">
                  {formatBRL(proposal.monthlyRecurringTotal)}
                  <span className="text-xs font-normal text-slate-200">/mês</span>
                </div>
                {proposal.oneTimeSetupTotal > 0 && (
                  <div className="text-[11px] text-slate-200 mt-1">
                    + Taxa Única de Ativação/Frete:{' '}
                    <strong>{formatBRL(proposal.oneTimeSetupTotal)}</strong>
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-white/15">
                <span className="text-[10px] uppercase font-bold text-slate-300 block">
                  Valor Global do Orçamento / TCV ({proposal.contractMonths} meses)
                </span>
                <div className="text-lg font-extrabold text-white">
                  {formatBRL(proposal.totalContractValue)}
                </div>
                <span className="text-[10px] text-emerald-300">
                  {recurringItems.length} item(ns) recorrente(s) • {setupItems.length} único/setup
                </span>
              </div>
            </div>
          </div>

          {/* CRONOGRAMA DE PARCELAS (QUANDO PRESENTE) */}
          {Array.isArray(proposal.installments) && proposal.installments.length > 0 && (
            <div className="border border-slate-300 rounded-lg overflow-hidden">
              <div className="bg-slate-100 px-4 py-2 border-b border-slate-300 flex items-center justify-between text-xs font-extrabold text-slate-800">
                <span className="inline-flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4 text-[#1e3a6e]" />
                  CONDIÇÕES DE PAGAMENTO E CRONOGRAMA DE PARCELAS ({proposal.installments.length}x)
                </span>
                <span className="text-[11px] text-slate-600">{proposal.paymentCondition}</span>
              </div>
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] border-b border-slate-200">
                  <tr>
                    <th className="py-2 px-3 w-20">Parcela</th>
                    <th className="py-2 px-3 w-36">Data de Vencimento</th>
                    <th className="py-2 px-3 w-48">Forma de Pagamento</th>
                    <th className="py-2 px-3 text-right w-36">Valor da Parcela</th>
                    <th className="py-2 px-3">Observação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {proposal.installments.map((inst, idx) => (
                    <tr key={idx}>
                      <td className="py-2 px-3 font-mono font-bold text-[#1e3a6e]">
                        {inst.number}ª
                      </td>
                      <td className="py-2 px-3 font-semibold">
                        {inst.dueDate.includes('-')
                          ? new Date(`${inst.dueDate.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')
                          : inst.dueDate}
                      </td>
                      <td className="py-2 px-3">{inst.paymentMethod}</td>
                      <td className="py-2 px-3 text-right font-extrabold text-slate-900">
                        {formatBRL(inst.amount)}
                      </td>
                      <td className="py-2 px-3 text-slate-600">{inst.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* TRANSPORTE E ENTREGA (QUANDO INFORMADO) */}
          {(proposal.shippingCarrier || proposal.deliveryAddress || shippingCost > 0) && (
            <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-[#1e3a6e] shrink-0" />
                <div>
                  <span className="font-extrabold text-slate-800 uppercase text-[11px] block">
                    Logística, Remessa &amp; Instalação
                  </span>
                  <span className="text-slate-600">
                    Modalidade: <strong>{proposal.shippingCarrier || 'Frota Própria Seta Telecom'}</strong>
                    {proposal.deliveryAddress ? ` • Local: ${proposal.deliveryAddress}` : ''}
                  </span>
                </div>
              </div>
              <div className="font-bold text-slate-800">
                Frete: {shippingCost > 0 ? formatBRL(shippingCost) : 'Isento / Cortesia'}
              </div>
            </div>
          )}

          {/* CLÁUSULAS TÉCNICAS & SLA */}
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
            <div className="font-extrabold text-slate-800 uppercase text-[11px] flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[#1e3a6e]" />
              Condições Técnicas, Remessa CFOP 5.908 &amp; Acordo de Nível de Serviço (SLA)
            </div>
            <p className="text-slate-600 leading-relaxed">{proposal.technicalClauses}</p>
          </div>

          {/* TERMO DE ACEITE E ASSINATURAS */}
          <div className="pt-6 mt-4 border-t-2 border-slate-200">
            <div className="text-xs font-extrabold uppercase text-slate-700 mb-4">
              Termo de Aceite e Aprovação da Proposta Comercial ({proposal.code})
            </div>
            <p className="text-[11px] text-slate-500 mb-8">
              Declaramos estar de acordo com as especificações técnicas, prazos e condições comerciais descritas nesta Proposta Comercial, autorizando a emissão do respectivo Contrato de Locação / Prestação de Serviços pela SETA TELECOM LTDA.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 pt-6">
              <div className="border-t border-slate-400 pt-2 text-center">
                <div className="text-xs font-extrabold text-slate-900">SETA TELECOM LTDA</div>
                <div className="text-[11px] text-slate-500">
                  CNPJ 14.806.925/0001-32 • {proposal.sellerName}
                </div>
              </div>

              <div className="border-t border-slate-400 pt-2 text-center">
                <div className="text-xs font-extrabold text-slate-900">{proposal.companyName}</div>
                <div className="text-[11px] text-slate-500">
                  CNPJ {proposal.companyCnpj} •{' '}
                  {proposal.digitalSignature?.signerName || proposal.careOf || proposal.contactName}{' '}
                  ({proposal.digitalSignature?.signerRole || 'Assinatura / Carimbo'})
                </div>
              </div>
            </div>

            {/* SELO DE ASSINATURA DIGITAL ICP-BRASIL / GOV.BR NO RODAPÉ A4 */}
            <div className="mt-6 p-4 rounded-lg border border-emerald-300 bg-emerald-50/70 text-xs space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-extrabold text-emerald-950 uppercase text-[11px]">
                  <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                  Selo de Autenticidade e Assinatura Eletrônica ICP-Brasil / Gov.br (ITI)
                </div>
                <span className="px-2 py-0.5 rounded bg-emerald-700 text-white text-[10px] font-extrabold">
                  {proposal.digitalSignature
                    ? `ASSINADO DIGITALMENTE (${proposal.digitalSignature.modality})`
                    : 'HABILITADO PARA ASSINATURA ICP-BRASIL / GOV.BR'}
                </span>
              </div>

              {proposal.digitalSignature ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-emerald-950 pt-1 border-t border-emerald-200">
                  <div>
                    <div>
                      <strong>Signatário:</strong> {proposal.digitalSignature.signerName} (CPF:{' '}
                      {proposal.digitalSignature.signerCpf})
                    </div>
                    <div>
                      <strong>Cargo:</strong> {proposal.digitalSignature.signerRole} •{' '}
                      <strong>Modalidade:</strong> {proposal.digitalSignature.modality}
                    </div>
                    <div>
                      <strong>Autoridade Certificadora:</strong>{' '}
                      {proposal.digitalSignature.certificateIssuer}
                    </div>
                  </div>
                  <div className="font-mono text-[10px] text-emerald-900 space-y-0.5">
                    <div>
                      <strong>Carimbo de Tempo (ACT/ITI):</strong>{' '}
                      {proposal.digitalSignature.timestampToken}
                    </div>
                    <div>
                      <strong>Data/Hora UTC:</strong> {proposal.digitalSignature.signedAt}
                    </div>
                    <div className="break-all">
                      <strong>Hash SHA-256:</strong> {proposal.digitalSignature.signatureHashSha256}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-emerald-900">
                  <span>
                    Documento preparado para assinatura eletrônica qualificada nos termos da MP nº 2.200-2/2001 (ICP-Brasil A1/A3) e Lei nº 14.063/2020 (Gov.br).
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (!signerName.trim()) {
                        setSignerName(proposal.careOf || proposal.contactName || 'Representante Legal');
                      }
                      setShowIcpSignatureModal(true);
                    }}
                    className="px-3 py-1 rounded bg-[#1e3a6e] hover:bg-[#162b54] text-white text-[11px] font-extrabold cursor-pointer print:hidden"
                  >
                    Assinar com ICP-Brasil / Gov.br
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PublicProposalPrintPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#f4f6f9] flex items-center justify-center p-6">
          <div className="bg-white rounded-lg border border-slate-200 p-8 shadow-sm text-center max-w-md w-full">
            <p className="text-sm font-bold text-slate-800">
              Carregando Proposta Comercial Seta Telecom...
            </p>
          </div>
        </div>
      }
    >
      <PublicProposalPrintContent />
    </Suspense>
  );
}
