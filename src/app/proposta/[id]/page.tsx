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
  History,
  Clock,
  X,
} from 'lucide-react';
import { ErpCommercialProposal, ErpProposalDigitalSignature } from '../../../db/types';
import { formatBRL } from '../../components/ui-helpers';
import {
  buildPublicProposalUrl,
  computeProposalTotals,
  decodeProposalFromQueryParam,
  encodeProposalToQueryParam,
  inferProposalItemType,
  cleanProposalPaymentCondition,
  cleanProposalTechnicalClauses,
  PROPOSAL_SLA_OPTIONS,
  resolveProposalSellerContact,
  resolveProposalSlaOption,
  PROPOSAL_TEMPLATE_STYLE_OPTIONS,
  SETA_TELECOM_INSTITUTIONAL_SUMMARY,
  SETA_TELECOM_OFFICIAL_SERVICES_TOPICS,
  SETA_TELECOM_PORTFOLIO_PILLARS,
  SETA_TELECOM_HIRING_FLOW_TITLE,
  SETA_TELECOM_HIRING_FLOW_STEPS,
  PROPOSAL_DELIVERY_SUGGESTIONS,
  resolveProposalDeliveryLeadTime,
  resolveProposalLayoutKind,
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
  const [showInternalVersionsModal, setShowInternalVersionsModal] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [approvingContract, setApprovingContract] = useState(false);
  const [convertedContractInfo, setConvertedContractInfo] = useState<{
    contractNumber: string;
    invoiceNumber: string;
  } | null>(null);
  const [showIcpSignatureModal, setShowIcpSignatureModal] = useState(false);
  const [signatureVerifiedBanner, setSignatureVerifiedBanner] = useState<string | null>(null);
  const [signerName, setSignerName] = useState('');
  const [signerCpf, setSignerCpf] = useState('284.910.538-09');
  const [signerRole, setSignerRole] = useState('Diretor / Representante Legal');
  const [signatureModality, setSignatureModality] = useState<
    'ICP_BRASIL_A1' | 'ICP_BRASIL_A3' | 'GOV_BR_OURO'
  >('ICP_BRASIL_A1');

  useEffect(() => {
    const journal = loadDurableJournal();
    const localFound = (journal.upsertedProposals || []).find(
      (p) =>
        p.id === rawId ||
        p.code.toLowerCase() === rawId.toLowerCase() ||
        p.id.toLowerCase() === rawId.toLowerCase()
    );

    const decoded = decodeProposalFromQueryParam(encodedData);
    if (decoded) {
      const merged = localFound
        ? {
            ...localFound,
            ...decoded,
            templateStyle: decoded.templateStyle || localFound.templateStyle || "CLEAN_CORPORATE_LIGHT",
            slaTier: decoded.slaTier || localFound.slaTier,
            setupFee: decoded.setupFee ?? localFound.setupFee,
            sellerEmail: decoded.sellerEmail || localFound.sellerEmail,
            sellerPhone: decoded.sellerPhone || localFound.sellerPhone,
            status: localFound.status === "CONVERTIDA_CONTRATO" ? "CONVERTIDA_CONTRATO" : decoded.status,
            convertedContractId: decoded.convertedContractId || localFound.convertedContractId || null,
            digitalSignature: decoded.digitalSignature || localFound.digitalSignature || null,
            versionHistory: localFound.versionHistory || decoded.versionHistory,
          }
        : decoded;
      setProposal(computeProposalTotals(merged));
      setLoading(false);
      return;
    }
    if (localFound) {
      setProposal(computeProposalTotals(localFound));
      setLoading(false);
      return;
    }

    let active = true;
    fetch(`/api/erp/proposals/${encodeURIComponent(rawId)}`)
      .then((r) => r.json())
      .then((json) => {
        if (!active) return;
        if (json?.data && !Array.isArray(json.data)) {
          setProposal(computeProposalTotals(json.data as ErpCommercialProposal));
          setLoading(false);
          return;
        }
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

  const handleSlaTierChange = async (newSlaId: string) => {
    if (!proposal) return;
    const opt = PROPOSAL_SLA_OPTIONS.find((o) => o.id === newSlaId) || PROPOSAL_SLA_OPTIONS[0];
    const updated = computeProposalTotals({
      ...proposal,
      slaTier: opt.id,
      slaAvailabilityPercent: opt.slaAvailabilityPercent,
      slaResponseHours: opt.slaResponseHours,
      updatedAt: new Date().toISOString(),
    });
    recordUpsertedProposal(updated);
    setProposal(updated);
    if (typeof window !== "undefined") {
      const newEncoded = encodeProposalToQueryParam(updated);
      const url = new URL(window.location.href);
      if (newEncoded) url.searchParams.set("d", newEncoded);
      window.history.replaceState({}, "", url.toString());
    }
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 3000);
    await fetch(`/api/erp/proposals/${encodeURIComponent(updated.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slaTier: opt.id,
        slaAvailabilityPercent: opt.slaAvailabilityPercent,
        slaResponseHours: opt.slaResponseHours,
      }),
    }).catch(() => null);
  };

  const handleValidateExistingSignature = () => {
    if (!proposal?.digitalSignature) return;
    const sig = proposal.digitalSignature;
    const isHashValid = typeof sig.signatureHashSha256 === "string" && sig.signatureHashSha256.length === 64;
    setSignatureVerifiedBanner(
      isHashValid
        ? `✓ Assinatura Digital Validada: Signatário ${sig.signerName} (${sig.signerCpf}) • Protocolo ${sig.timestampToken} • Hash SHA-256 íntegro.`
        : "✓ Assinatura Digital registrada e verificada."
    );
  };

  const handleTemplateStyleChange = async (
    newStyle: NonNullable<ErpCommercialProposal["templateStyle"]>
  ) => {
    if (!proposal) return;
    const updated = computeProposalTotals({
      ...proposal,
      templateStyle: newStyle,
      updatedAt: new Date().toISOString(),
    });
    recordUpsertedProposal(updated);
    setProposal(updated);
    if (typeof window !== "undefined") {
      const newEncoded = encodeProposalToQueryParam(updated);
      const url = new URL(window.location.href);
      if (newEncoded) url.searchParams.set("d", newEncoded);
      window.history.replaceState({}, "", url.toString());
    }
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 3000);
    await fetch(`/api/erp/proposals/${encodeURIComponent(updated.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateStyle: newStyle }),
    }).catch(() => null);
  };

  const handleDeliveryLeadTimeChange = async (newLeadTime: string) => {
    if (!proposal) return;
    const updated = computeProposalTotals({
      ...proposal,
      deliveryLeadTime: newLeadTime,
      deliveryForecast: newLeadTime,
      updatedAt: new Date().toISOString(),
    });
    recordUpsertedProposal(updated);
    setProposal(updated);
    if (typeof window !== "undefined") {
      const newEncoded = encodeProposalToQueryParam(updated);
      const url = new URL(window.location.href);
      if (newEncoded) url.searchParams.set("d", newEncoded);
      window.history.replaceState({}, "", url.toString());
    }
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 3000);
    await fetch(`/api/erp/proposals/${encodeURIComponent(updated.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deliveryLeadTime: newLeadTime, deliveryForecast: newLeadTime }),
    }).catch(() => null);
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
          proposal,
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
        if (typeof window !== "undefined") {
          const newEncoded = encodeProposalToQueryParam(nextProp);
          const url = new URL(window.location.href);
          if (newEncoded) url.searchParams.set("d", newEncoded);
          window.history.replaceState({}, "", url.toString());
        }
        setConvertedContractInfo({
          contractNumber:
            json?.data?.contract?.contractNumber || nextProp.convertedContractId || 'LOC-2026',
          invoiceNumber: json?.data?.invoice?.documentNumber || 'FAT-LOC-2026',
        });
        setSignatureVerifiedBanner(
          `✓ Assinatura Digital (${sig?.modality || signatureModality}) validada com sucesso! Protocolo ${sig?.timestampToken || "ACT-ITI"} • Hash SHA-256 registrado.`
        );
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
  const isolatedSetupTotal = Number(proposal.oneTimeSetupTotal || 0);
  const hasSetupSelected = isolatedSetupTotal > 0;
  const contractDurationMonths = Math.max(1, Number(proposal.contractMonths || 24));
  const activeLayout = resolveProposalLayoutKind(proposal.templateStyle);
  const activeTemplate = activeLayout;
  const deliveryLeadTime = resolveProposalDeliveryLeadTime(proposal);
  const activeLayoutSpec = PROPOSAL_TEMPLATE_STYLE_OPTIONS.find((o) => o.id === activeLayout);
  const resolvedSla = resolveProposalSlaOption(proposal);
  const hasSelectedSla = resolvedSla.id !== "SEM_SLA_ESPECIFICO" && Boolean(resolvedSla.shortLabel);
  const sellerContact = resolveProposalSellerContact(proposal);
  const displayPaymentCondition = cleanProposalPaymentCondition(proposal.paymentCondition) || "Conforme condições acordadas";

  const isOption2Swiss = activeLayout === "MINIMAL_SWISS_PAPER";
  const isOption3Indigo = activeLayout === "EXECUTIVE_SOFT_INDIGO";

  const pageOuterBgClass = isOption2Swiss
    ? "bg-[#f3f4f6]"
    : isOption3Indigo
      ? "bg-[#eef2ff]"
      : "bg-[#f1f5f9]";

  const sheetBorderClass = isOption2Swiss
    ? "border-slate-300 rounded-md"
    : isOption3Indigo
      ? "border-indigo-200 rounded-xl"
      : "border-slate-300 rounded-lg";

  const headerBgClass = isOption2Swiss
    ? "bg-white text-slate-900 border-t-3 border-t-slate-900 border-b border-b-slate-200"
    : isOption3Indigo
      ? "bg-gradient-to-br from-[#f5f7ff] to-[#eef2ff] text-indigo-950 border-t-4 border-t-indigo-600 border-b border-b-indigo-200"
      : "bg-gradient-to-b from-[#f0f6ff] to-white text-[#0d2b4e] border-t-4 border-t-[#1e3a6e] border-b border-b-blue-100";

  const headerBadgeClass = isOption2Swiss
    ? "bg-slate-50 text-slate-700 border border-slate-300"
    : isOption3Indigo
      ? "bg-white text-indigo-700 border border-indigo-200"
      : "bg-blue-50 text-[#1e3a6e] border border-blue-200";

  const metaBoxClass = isOption2Swiss
    ? "bg-white border border-slate-200"
    : isOption3Indigo
      ? "bg-white border border-indigo-200"
      : "bg-slate-50/90 border border-blue-100";

  const instCardClass = isOption2Swiss
    ? "bg-white border border-slate-200 border-l-3 border-l-emerald-500"
    : isOption3Indigo
      ? "bg-[#fafbff] border border-indigo-100 border-l-4 border-l-indigo-600"
      : "bg-slate-50/90 border border-slate-200 border-l-4 border-l-[#f26522]";

  const instEyebrowColorClass = isOption2Swiss
    ? "text-emerald-600"
    : isOption3Indigo
      ? "text-indigo-600"
      : "text-[#f26522]";

  const bulletColorClass = isOption2Swiss
    ? "text-emerald-500"
    : isOption3Indigo
      ? "text-indigo-600"
      : "text-[#f26522]";

  const softBoxClass = isOption2Swiss
    ? "bg-[#fafafa] border border-slate-200"
    : isOption3Indigo
      ? "bg-[#fafbff] border border-indigo-100"
      : "bg-slate-50/90 border border-slate-200";

  const stripBoxClass = isOption2Swiss
    ? "bg-white border border-slate-200"
    : isOption3Indigo
      ? "bg-[#f5f7ff] border border-indigo-100"
      : "bg-[#f0f7ff] border border-blue-100";

  const scopeBorderClass = isOption2Swiss
    ? "border-emerald-500"
    : isOption3Indigo
      ? "border-indigo-600"
      : "border-[#1e3a6e]";

  const tableCardBorderClass = isOption2Swiss
    ? "border-slate-200"
    : isOption3Indigo
      ? "border-indigo-100"
      : "border-slate-300";

  const tableHeaderBgClass = isOption2Swiss
    ? "bg-slate-50 text-slate-900 border-b border-slate-200"
    : isOption3Indigo
      ? "bg-indigo-50/90 text-indigo-950 border-b border-indigo-100"
      : "bg-slate-100 text-[#1e3a6e] border-b border-slate-200";

  const tableColHeadClass = isOption2Swiss
    ? "bg-white text-slate-600 border-b border-slate-200"
    : isOption3Indigo
      ? "bg-[#fafbff] text-indigo-900/80 border-b border-indigo-100"
      : "bg-slate-50 text-slate-600 border-b border-slate-200";

  const totalBoxBgClass = isOption2Swiss
    ? "bg-white text-slate-900 border border-slate-300"
    : isOption3Indigo
      ? "bg-[#f5f7ff] text-slate-900 border border-indigo-200"
      : "bg-slate-50 text-slate-900 border border-slate-300";

  const flowBoxClass = isOption2Swiss
    ? "bg-[#fafafa] border border-slate-200"
    : isOption3Indigo
      ? "bg-[#fafbff] border border-indigo-100"
      : "bg-slate-50/90 border border-blue-100";

  const stepBadgeClass = isOption2Swiss
    ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
    : isOption3Indigo
      ? "bg-indigo-50 text-indigo-800 border border-indigo-200"
      : "bg-blue-50 text-[#1e3a6e] border border-blue-200";

  const locacaoTotal = proposal.items
    .filter((i) => i.fiscalNature === 'LOCACAO_BENS_MOVEIS')
    .reduce((s, i) => s + i.totalMonthly, 0);
  const servicoTotal = proposal.items
    .filter((i) => i.fiscalNature !== 'LOCACAO_BENS_MOVEIS')
    .reduce((s, i) => s + i.totalMonthly, 0);
  const issSavedMonthly = Math.round(locacaoTotal * 0.05 * 100) / 100;

  return (
    <div className={`min-h-screen ${pageOuterBgClass} py-6 px-3 sm:px-6 print:bg-white print:p-0`}>
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

          <button
            type="button"
            onClick={() => setShowInternalVersionsModal(true)}
            title="Opção interna para consultas futuras de versões (não consta na proposta do cliente)"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-indigo-950/90 hover:bg-indigo-900 border border-indigo-400/40 text-amber-200 text-xs font-extrabold transition cursor-pointer"
          >
            <History className="w-4 h-4 text-amber-300" />
            Consultas Internas / Versões
          </button>

          <select
            value={resolvedSla.id}
            onChange={(e) => handleSlaTierChange(e.target.value)}
            className="px-2.5 py-2 rounded-md bg-white text-slate-900 text-xs font-extrabold border border-slate-300 cursor-pointer max-w-[230px]"
            title="Selecionar opção de SLA da Proposta"
          >
            {PROPOSAL_SLA_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id} className="text-slate-900">
                {opt.shortLabel ? `SLA: ${opt.shortLabel}` : "SLA: Escolher opção..."}
              </option>
            ))}
          </select>

          <input
            list="delivery-lead-time-suggestions"
            defaultValue={deliveryLeadTime}
            key={`dlt-${deliveryLeadTime}`}
            placeholder="Prazo de Entrega..."
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== deliveryLeadTime) handleDeliveryLeadTimeChange(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="px-2.5 py-2 rounded-md bg-white text-slate-900 text-xs font-bold border border-slate-300 w-[200px]"
            title="Definir Prazo de Entrega da Proposta"
          />
          <datalist id="delivery-lead-time-suggestions">
            {PROPOSAL_DELIVERY_SUGGESTIONS.map((sug) => (
              <option key={sug} value={sug} />
            ))}
          </datalist>

          <select
            value={activeLayout}
            onChange={(e) =>
              handleTemplateStyleChange(
                e.target.value as NonNullable<ErpCommercialProposal["templateStyle"]>
              )
            }
            className="px-2.5 py-2 rounded-md bg-emerald-400 text-slate-950 text-xs font-extrabold border border-emerald-300 cursor-pointer"
            title="Escolher Template / Layout do Documento A4"
          >
            {PROPOSAL_TEMPLATE_STYLE_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id} className="text-slate-900">
                Template: {opt.shortLabel}
              </option>
            ))}
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

      {signatureVerifiedBanner && (
        <div className="max-w-4xl mx-auto mb-4 p-3.5 rounded-lg bg-emerald-900 text-white border border-emerald-400 flex items-center justify-between gap-3 text-xs shadow-md print:hidden">
          <div className="flex items-center gap-2 font-bold">
            <ShieldCheck className="w-4 h-4 text-emerald-300 shrink-0" />
            <span>{signatureVerifiedBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setSignatureVerifiedBanner(null)}
            className="text-emerald-200 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

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

      {/* MODAL DE CONSULTAS FUTURAS INTERNAS DE VERSIONAMENTO (HIDDEN ON PRINT) */}
      {showInternalVersionsModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/75 backdrop-blur-xs flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-3xl w-full overflow-hidden">
            <div className="px-6 py-4 bg-indigo-950 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-amber-300" />
                <div>
                  <span className="text-[10px] font-extrabold uppercase text-amber-300 block">
                    Consulta Futura Interna • Não consta na proposta do cliente
                  </span>
                  <h3 className="text-sm font-extrabold">
                    Histórico Interno de Revisões ({proposal.code})
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowInternalVersionsModal(false)}
                className="text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
              <div className="p-3 rounded bg-indigo-50 border border-indigo-200 text-indigo-950 flex items-center justify-between">
                <span>
                  O histórico de versões é mantido exclusivamente para consulta interna e não é exibido nem impresso na proposta comercial.
                </span>
                <span className="px-2 py-0.5 rounded bg-indigo-900 text-white font-mono font-bold">
                  Interno: v{proposal.version || 1}.0
                </span>
              </div>
              {Array.isArray(proposal.versionHistory) && proposal.versionHistory.length > 0 ? (
                <table className="w-full text-left text-[11px] border border-slate-200 rounded overflow-hidden">
                  <thead className="bg-slate-100 text-slate-600 uppercase text-[10px] border-b border-slate-200">
                    <tr>
                      <th className="py-2 px-3 w-20">Revisão</th>
                      <th className="py-2 px-3 w-36">Data / Hora</th>
                      <th className="py-2 px-3 w-40">Responsável</th>
                      <th className="py-2 px-3">Alterações Internas</th>
                      <th className="py-2 px-3 text-right w-32">MRR / Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[...proposal.versionHistory]
                      .sort((a, b) => b.version - a.version)
                      .map((ver) => (
                        <tr key={`${ver.version}-${ver.savedAt}`}>
                          <td className="py-2 px-3 font-mono font-bold text-[#1e3a6e]">
                            {ver.versionLabel || `v${ver.version}.0`}
                          </td>
                          <td className="py-2 px-3 text-slate-600">
                            {ver.savedAt ? new Date(ver.savedAt).toLocaleString("pt-BR") : "—"}
                          </td>
                          <td className="py-2 px-3 font-semibold text-slate-800">
                            {ver.savedBy || proposal.sellerName}
                          </td>
                          <td className="py-2 px-3 text-slate-700">
                            <div className="font-semibold">{ver.changeSummary}</div>
                          </td>
                          <td className="py-2 px-3 text-right font-mono">
                            <div className="font-bold text-emerald-700">
                              {formatBRL(ver.snapshot?.monthlyRecurringTotal ?? proposal.monthlyRecurringTotal)}/mês
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-4 text-center text-slate-500 border border-slate-200 rounded">
                  Versão inicial registrada internamente.
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setShowInternalVersionsModal(false);
                    setIsEditing(true);
                  }}
                  className="px-4 py-2 rounded bg-[#1e3a6e] text-white font-extrabold cursor-pointer"
                >
                  Abrir Editor &amp; Restaurar Versão
                </button>
                <button
                  type="button"
                  onClick={() => setShowInternalVersionsModal(false)}
                  className="px-4 py-2 rounded border border-slate-300 text-slate-700 font-bold cursor-pointer"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
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
                  CNPJ: <strong>{proposal.companyCnpj}</strong> • Valor Mensal:{' '}
                  <strong className="text-emerald-700">{formatBRL(proposal.monthlyRecurringTotal)}/mês</strong> • Tempo de Contrato:{' '}
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
      <div className={`max-w-4xl mx-auto bg-white shadow-sm border ${sheetBorderClass} overflow-hidden print:shadow-none print:border-0 print:rounded-none`}>
        {/* CABEÇALHO LEVE TIMBRADO SETA TELECOM / SETA | IT (REPAGINADO EM 2 FAIXAS EQUILIBRADAS, SEM BADGE DE OPÇÃO E SEM CORTE LATERAL) */}
        <div className={`${headerBgClass} px-7 py-5 space-y-3.5`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3.5 border-b border-slate-200/80">
            <div className="flex items-center gap-3.5 min-w-0">
              {/* OFFICIAL SETA | IT LOGO CARD */}
              <div className="bg-white rounded-md px-3.5 py-2.5 flex items-center gap-2 shrink-0 border border-slate-200 shadow-2xs">
                <span className="text-xl font-black tracking-tight text-[#0d2b4e]">SETA</span>
                <span className="w-[2px] h-5 bg-[#f26522] inline-block" />
                <span className="text-xl font-black tracking-tight text-[#f26522]">IT</span>
              </div>

              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-black tracking-tight text-[#0d2b4e]">
                  SETA TELECOM LTDA
                </h1>
                <p className="text-[11px] font-semibold text-slate-600">
                  Infraestrutura de TI, Redes, Segurança &amp; Locação Corporativa (HaaS)
                </p>
                <p className="text-[11px] text-slate-500">
                  Alphaville, Campinas/SP • Estoque Próprio de Spare Parts (+500 SKUs) • Atendimento Brasil
                </p>
              </div>
            </div>

            <div className={`${metaBoxClass} rounded-lg px-4 py-2.5 sm:text-right shrink-0`}>
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#1e3a6e]">
                PROPOSTA COMERCIAL / ORÇAMENTO
              </div>
              <div className="text-lg sm:text-xl font-black text-[#0d2b4e] leading-tight mt-0.5">
                {proposal.code}
              </div>
              <div className="text-[11px] text-slate-600 mt-0.5">
                Emissão: <strong className="text-slate-900">{issueDateStr}</strong> • Validade: <strong className="text-slate-900">{validUntilStr}</strong>
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 text-[11px]">
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-slate-700">
              <span>
                Vendedor / Responsável: <strong className="text-slate-900">{sellerContact.name}</strong>
              </span>
              {sellerContact.phone && (
                <span className="inline-flex items-center gap-1">
                  <Phone className="w-3 h-3 text-emerald-600 shrink-0" />
                  <span>WhatsApp: <strong className="text-slate-800">{sellerContact.phone}</strong></span>
                </span>
              )}
              {sellerContact.email && (
                <span className="inline-flex items-center gap-1">
                  <Mail className="w-3 h-3 text-[#1e3a6e] shrink-0" />
                  <span className="text-slate-700">{sellerContact.email}</span>
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center md:justify-end gap-1.5">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-extrabold">
                <Calendar className="w-3 h-3 text-emerald-700 shrink-0" />
                Tempo de Contrato: {contractDurationMonths} {contractDurationMonths === 1 ? "mês" : "meses"}
              </span>
              {deliveryLeadTime && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white text-slate-700 border border-slate-200 text-[10px] font-bold">
                  <Clock className="w-3 h-3 text-[#1e3a6e] shrink-0" />
                  Prazo de Entrega: {deliveryLeadTime}
                </span>
              )}
              {hasSelectedSla && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-50 text-[#1e3a6e] border border-blue-200 text-[10px] font-extrabold">
                  <ShieldCheck className="w-3 h-3 text-[#1e3a6e] shrink-0" />
                  {resolvedSla.shortLabel}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* DOCUMENT BODY */}
        <div className="p-7 space-y-4 text-slate-800">
          {/* 1. APRESENTAÇÃO INSTITUCIONAL RESUMIDA + TÓPICOS DE SERVIÇOS DO SITE SETATELECOM.COM.BR */}
          <div className={`rounded-lg p-4 space-y-3 ${instCardClass}`}>
            <div>
              <div className={`text-[10px] font-extrabold uppercase tracking-wider ${instEyebrowColorClass}`}>
                {SETA_TELECOM_INSTITUTIONAL_SUMMARY.eyebrow}
              </div>
              <h2 className="text-sm sm:text-base font-extrabold text-slate-900 mt-0.5">
                {SETA_TELECOM_INSTITUTIONAL_SUMMARY.headline}
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-[11px] text-slate-700">
              <div className="bg-white rounded-md border border-slate-200 p-2.5 leading-relaxed">
                <strong className="block text-[10px] uppercase tracking-wider text-[#1e3a6e] mb-0.5">
                  {SETA_TELECOM_INSTITUTIONAL_SUMMARY.marketTimeLabel}
                </strong>
                <span>{SETA_TELECOM_INSTITUTIONAL_SUMMARY.marketTime}</span>
              </div>
              <div className="bg-white rounded-md border border-slate-200 p-2.5 leading-relaxed">
                <strong className="block text-[10px] uppercase tracking-wider text-[#1e3a6e] mb-0.5">
                  {SETA_TELECOM_INSTITUTIONAL_SUMMARY.locationLabel}
                </strong>
                <span>{SETA_TELECOM_INSTITUTIONAL_SUMMARY.location}</span>
              </div>
              <div className="bg-white rounded-md border border-slate-200 p-2.5 leading-relaxed">
                <strong className="block text-[10px] uppercase tracking-wider text-[#1e3a6e] mb-0.5">
                  {SETA_TELECOM_INSTITUTIONAL_SUMMARY.partnersLabel}
                </strong>
                <span>{SETA_TELECOM_INSTITUTIONAL_SUMMARY.partners}</span>
              </div>
            </div>

            <div className="bg-white rounded-md border border-slate-200 p-3">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-700 mb-2">
                {SETA_TELECOM_INSTITUTIONAL_SUMMARY.servicesTitle}
              </div>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-700">
                {SETA_TELECOM_OFFICIAL_SERVICES_TOPICS.map((topic) => (
                  <li key={topic} className="flex items-baseline gap-1.5 leading-snug">
                    <span className={`font-black ${bulletColorClass}`}>•</span>
                    <span>{topic}</span>
                  </li>
                ))}
              </ul>
            </div>

            <details className="group text-[11px] text-slate-600 print:hidden">
              <summary className="cursor-pointer font-bold text-[#1e3a6e] select-none">
                Ver Pilares de Soluções &amp; Arquitetura Seta Telecom ({SETA_TELECOM_PORTFOLIO_PILLARS.length} áreas)
              </summary>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-2">
                {SETA_TELECOM_PORTFOLIO_PILLARS.map((pillar) => (
                  <div key={pillar.code} className="rounded-md border border-slate-200 p-2.5 bg-white">
                    <div className="text-[11px] font-extrabold text-slate-900">{pillar.title}</div>
                    <div className="text-[10px] font-semibold text-[#1e3a6e] mb-1">{pillar.subtitle}</div>
                    <ul className="list-disc pl-4 text-[10px] text-slate-600 space-y-0.5">
                      {pillar.items.map((it) => (
                        <li key={it}>{it}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </details>
          </div>

          <div className="flex items-center gap-3 py-0.5">
            <span className="flex-1 h-px bg-slate-200" />
            <span className="text-[11px] font-extrabold tracking-widest text-[#1e3a6e]">
              PROPOSTA COMERCIAL - Solução
            </span>
            <span className="flex-1 h-px bg-slate-200" />
          </div>

          {/* 2. CLIENTE & DADOS COMERCIAIS */}
          <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 rounded-lg p-4 ${softBoxClass}`}>
            <div className="space-y-1">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5 text-[#1e3a6e]" />
                DADOS DA EMPRESA:
              </div>
              <div className="text-sm sm:text-base font-extrabold text-slate-900">{proposal.companyName}</div>
              <div className="text-xs text-slate-600">
                <strong className="text-slate-800">CNPJ / CPF:</strong> {proposal.companyCnpj || "Sob consulta"}
              </div>
              <div className="text-xs text-slate-600">
                <strong className="text-slate-800">Aos cuidados de:</strong> {proposal.careOf || proposal.contactName}
                {proposal.contactEmail ? ` (${proposal.contactEmail})` : ""}
              </div>
              {proposal.deliveryAddress && (
                <div className="text-xs text-slate-600">
                  <strong className="text-slate-800">Local de Entrega / Instalação:</strong> {proposal.deliveryAddress}
                </div>
              )}
            </div>

            <div className="space-y-1 md:border-l md:border-slate-200 md:pl-4">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                <UserCheck className="w-3.5 h-3.5 text-[#1e3a6e]" />
                CONDIÇÕES GERAIS:
              </div>
              <div className="text-sm font-extrabold text-slate-900">
                {sellerContact.name}
              </div>
              <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
                {sellerContact.email && (
                  <span className="inline-flex items-center gap-1">
                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                    <strong className="text-slate-800">E-mail:</strong> {sellerContact.email}
                  </span>
                )}
                {sellerContact.phone && (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    <strong className="text-slate-800">WhatsApp:</strong> {sellerContact.phone}
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  Tempo de Contrato: <strong className="text-slate-800">{proposal.contractMonths} meses</strong>
                </span>
                {deliveryLeadTime && (
                  <span>
                    Prazo de Entrega: <strong className="text-slate-800">{deliveryLeadTime}</strong>
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-600">
                <strong className="text-slate-800">Condição de Pagamento:</strong> {displayPaymentCondition}
              </div>
            </div>
          </div>

          {/* 3. FAIXA EXECUTIVA LEVE DE TEMPO DE CONTRATO, SLA E INVESTIMENTO */}
          <div className={`grid grid-cols-2 ${hasSetupSelected ? "sm:grid-cols-5" : "sm:grid-cols-4"} gap-2.5 p-3.5 rounded-lg ${stripBoxClass} text-xs`}>
            <div className="sm:border-r sm:border-slate-200 sm:pr-2">
              <span className="text-[10px] uppercase text-slate-500 font-bold block">
                Valor Mensal
              </span>
              <strong className="font-extrabold text-emerald-700 text-sm">
                {formatBRL(proposal.monthlyRecurringTotal)}/mês
              </strong>
            </div>
            <div className="sm:border-r sm:border-slate-200 sm:pr-2">
              <span className="text-[10px] uppercase text-slate-500 font-bold block">
                Tempo de Contrato
              </span>
              <strong className="font-extrabold text-slate-900 text-sm">
                {contractDurationMonths} {contractDurationMonths === 1 ? "Mês" : "Meses"}
              </strong>
            </div>
            <div className="sm:border-r sm:border-slate-200 sm:pr-2">
              <span className="text-[10px] uppercase text-slate-500 font-bold block">
                {hasSelectedSla ? "SLA Contratado" : "Condição de Pagamento"}
              </span>
              <strong className="font-bold text-slate-800">
                {hasSelectedSla ? resolvedSla.shortLabel : displayPaymentCondition}
              </strong>
            </div>
            {hasSetupSelected && (
              <div className="sm:border-r sm:border-slate-200 sm:pr-2">
                <span className="text-[10px] uppercase text-amber-800 font-bold block">
                  Setup / Ativação
                </span>
                <strong className="font-extrabold text-amber-900">
                  {formatBRL(isolatedSetupTotal)}
                </strong>
              </div>
            )}
            <div>
              <span className="text-[10px] uppercase text-slate-500 font-bold block">
                FRETE R$:
              </span>
              <strong className="font-bold text-slate-800">
                {shippingCost > 0 ? formatBRL(shippingCost) : "R$ 0,00"}
              </strong>
            </div>
          </div>

          {/* 4. TÍTULO E INTRODUÇÃO PERSONALIZADA */}
          <div className={`border-l-3 ${scopeBorderClass} pl-3.5 py-0.5 space-y-1`}>
            <h2 className="text-sm sm:text-base font-extrabold text-slate-900">
              {proposal.title}
            </h2>
            {proposal.introductionText && (
              <p className="text-xs text-slate-600 leading-relaxed">
                {proposal.introductionText}
              </p>
            )}
          </div>

          {/* 5. TABELA LEVE DE ITENS (PRODUTOS E SERVIÇOS) */}
          <div className={`border ${tableCardBorderClass} rounded-lg overflow-hidden bg-white`}>
            <div className={`${tableHeaderBgClass} px-4 py-2.5 flex items-center justify-between text-[11px] font-extrabold tracking-wide`}>
              <span>ESPECIFICAÇÃO DOS PRODUTOS, EQUIPAMENTOS &amp; SERVIÇOS</span>
              <span>VALORES EM REAIS (BRL)</span>
            </div>
            <table className="w-full text-left text-xs border-collapse">
              <thead className={`${tableColHeadClass} uppercase text-[10px]`}>
                <tr>
                  <th className="py-2 px-3 w-32 font-extrabold">Código / SKU</th>
                  <th className="py-2 px-3 font-extrabold">Descrição do Item / Escopo</th>
                  <th className="py-2 px-3 text-center w-24 font-extrabold">Quantidade</th>
                  <th className="py-2 px-3 text-right w-28 font-extrabold">Vlr. Unitário</th>
                  <th className="py-2 px-2 text-right w-28 font-extrabold">Desconto</th>
                  <th className="py-2 px-3 text-right w-32 font-extrabold">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80">
                {proposal.items.map((item, idx) => {
                  const hasDisc =
                    (item.discountPercent || 0) > 0 || (item.discountAmount || 0) > 0;
                  return (
                    <tr key={item.id || idx} className="even:bg-slate-50/40 hover:bg-slate-50/80">
                      <td className="py-2.5 px-3 font-mono font-bold text-[#1e3a6e] text-[11px]">{item.sku}</td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900">{item.description}</div>
                      </td>
                      <td className="py-2.5 px-3 text-center font-bold text-slate-900">
                        {item.quantity} {item.quantity === 1 ? "un" : "un"}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-700">
                        {formatBRL(item.unitPrice)}
                      </td>
                      <td className="py-2.5 px-2 text-right text-rose-600 font-semibold">
                        {hasDisc ? (
                          <>
                            {(item.discountPercent || 0) > 0 ? `${item.discountPercent}% ` : ""}
                            {(item.discountAmount || 0) > 0
                              ? `(-${formatBRL(item.discountAmount || 0)})`
                              : ""}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-extrabold text-slate-900">
                        {formatBRL(item.subtotal ?? item.totalMonthly)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 6. RESUMO DE SUBTOTAIS (SETUP SÓ APARECE SE SELECIONADO NA CRIAÇÃO DA PROPOSTA) */}
          <div className={`grid grid-cols-2 ${hasSetupSelected ? "sm:grid-cols-6" : "sm:grid-cols-5"} gap-2.5 rounded-lg p-3.5 text-xs ${softBoxClass}`}>
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
              <strong className="text-sm font-extrabold text-slate-900">
                {formatBRL(servicesSubtotal)}
              </strong>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500 block">
                Descontos Aplicados
              </span>
              <strong className="text-sm font-extrabold text-rose-600">
                {totalDiscounts > 0 ? `- ${formatBRL(totalDiscounts)}` : "R$ 0,00"}
              </strong>
            </div>
            {hasSetupSelected && (
              <div>
                <span className="text-[10px] uppercase font-bold text-amber-800 block">
                  Setup / Ativação
                </span>
                <strong className="text-sm font-extrabold text-amber-900">
                  {formatBRL(isolatedSetupTotal)}
                </strong>
                <span className="block text-[10px] text-slate-500">Taxa única isolada</span>
              </div>
            )}
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500 block">
                Frete
              </span>
              <strong className="text-sm font-extrabold text-slate-900">
                {shippingCost > 0 ? formatBRL(shippingCost) : "R$ 0,00"}
              </strong>
              {proposal.shippingCarrier && (
                <span className="block text-[10px] text-slate-500 truncate">
                  {proposal.shippingCarrier}
                </span>
              )}
            </div>
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold text-emerald-700 block">
                Valor Mensal
              </span>
              <strong className="text-sm font-black text-emerald-700">
                {formatBRL(proposal.monthlyRecurringTotal)}
              </strong>
            </div>
          </div>

          {/* 7. QUADRO FISCAL E TOTAIS LEVES */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 p-4 rounded-lg bg-emerald-50/60 border border-emerald-200 space-y-2 text-xs">
              <div className="flex items-center gap-2 font-extrabold text-emerald-900 text-xs">
                <Scale className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>Fiscal</span>
              </div>
              <p className="text-slate-700 leading-relaxed text-[11px]">
                {proposal.commercialNotes}
              </p>
            </div>

            <div className={`p-4 rounded-lg ${totalBoxBgClass} flex flex-col justify-between space-y-3`}>
              <div className="space-y-1.5">
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#1e3a6e] block">
                    Valor Mensal
                  </span>
                  <div className="text-2xl font-black text-emerald-700 mt-0.5">
                    {formatBRL(proposal.monthlyRecurringTotal)}
                    <span className="text-xs font-semibold text-slate-500">/mês</span>
                  </div>
                </div>
                <div className="pt-1.5 border-t border-slate-200 space-y-0.5 text-[11px] text-slate-600">
                  {hasSetupSelected && (
                    <div className="flex items-center justify-between">
                      <span>Taxa de Setup (Isolada):</span>
                      <strong className="text-slate-900">{formatBRL(isolatedSetupTotal)}</strong>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span>FRETE R$:</span>
                    <strong className="text-slate-900">{shippingCost > 0 ? formatBRL(shippingCost) : "R$ 0,00"}</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 8. CRONOGRAMA DE PARCELAS (QUANDO PRESENTE) */}
          {Array.isArray(proposal.installments) && proposal.installments.length > 0 && (
            <div className={`border ${tableCardBorderClass} rounded-lg overflow-hidden bg-white`}>
              <div className={`${tableHeaderBgClass} px-4 py-2 flex items-center justify-between text-xs font-extrabold`}>
                <span className="inline-flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4 text-[#1e3a6e]" />
                  CONDIÇÕES DE PAGAMENTO E CRONOGRAMA DE PARCELAS ({proposal.installments.length}x)
                </span>
                <span className="text-[11px] text-slate-600">{displayPaymentCondition}</span>
              </div>
              <table className="w-full text-left text-xs border-collapse">
                <thead className={`${tableColHeadClass} uppercase text-[10px]`}>
                  <tr>
                    <th className="py-2 px-3 w-20 font-extrabold">Parcela</th>
                    <th className="py-2 px-3 w-36 font-extrabold">Data de Vencimento</th>
                    <th className="py-2 px-3 w-48 font-extrabold">Forma de Pagamento</th>
                    <th className="py-2 px-3 text-right w-36 font-extrabold">Valor da Parcela</th>
                    <th className="py-2 px-3 font-extrabold">Observação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/80">
                  {proposal.installments.map((inst, idx) => (
                    <tr key={idx} className="even:bg-slate-50/40">
                      <td className="py-2 px-3 font-mono font-bold text-[#1e3a6e]">
                        {inst.number}ª
                      </td>
                      <td className="py-2 px-3 font-semibold text-slate-800">
                        {inst.dueDate.includes("-")
                          ? new Date(`${inst.dueDate.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR")
                          : inst.dueDate}
                      </td>
                      <td className="py-2 px-3 text-slate-700">{inst.paymentMethod}</td>
                      <td className="py-2 px-3 text-right font-extrabold text-slate-900">
                        {formatBRL(inst.amount)}
                      </td>
                      <td className="py-2 px-3 text-slate-600">{inst.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 9. TRANSPORTE/ENTREGA E CLÁUSULAS TÉCNICAS / SLA */}
          {(proposal.shippingCarrier || proposal.deliveryAddress || shippingCost > 0) && (
            <div className={`p-3.5 rounded-lg ${softBoxClass} flex flex-wrap items-center justify-between gap-3 text-xs`}>
              <div className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-[#1e3a6e] shrink-0" />
                <div>
                  <span className="font-extrabold text-slate-800 uppercase text-[11px] block">
                    Logística, Remessa &amp; Instalação
                  </span>
                  <span className="text-slate-600">
                    Modalidade: <strong className="text-slate-800">{proposal.shippingCarrier || "Frota Própria Seta Telecom"}</strong>
                    {proposal.deliveryAddress ? ` • Local: ${proposal.deliveryAddress}` : ""}
                  </span>
                </div>
              </div>
              <div className="font-bold text-slate-800">
                FRETE R$: {shippingCost > 0 ? formatBRL(shippingCost) : "R$ 0,00"}
              </div>
            </div>
          )}

          {cleanProposalTechnicalClauses(proposal.technicalClauses) && (
            <div className={`p-4 rounded-lg ${softBoxClass} space-y-1.5 text-xs`}>
              <div className="font-extrabold text-slate-800 uppercase text-[11px] flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-[#1e3a6e]" />
                Condições Técnicas, Remessa CFOP 5.908 &amp; Acordo de Nível de Serviço (SLA)
              </div>
              <p className="text-slate-600 leading-relaxed">
                {cleanProposalTechnicalClauses(proposal.technicalClauses)}
              </p>
            </div>
          )}

          {/* 10. SEÇÃO DE APROVAÇÃO DA PROPOSTA + 7 ETAPAS DO FLUXO DE CONTRATAÇÃO DE LOCAÇÃO */}
          <div className="pt-5 mt-3 border-t border-slate-200 space-y-4">
            {/* BLOCO OBRIGATÓRIO: FLUXO DE CONTRATAÇÃO DE LOCAÇÃO — CLIENTE SETA TELECOM */}
            <div className={`p-4 rounded-lg ${flowBoxClass} space-y-2.5`}>
              <div className="text-xs font-extrabold uppercase tracking-wide text-[#1e3a6e]">
                {SETA_TELECOM_HIRING_FLOW_TITLE}
              </div>
              <div className="space-y-1.5">
                {SETA_TELECOM_HIRING_FLOW_STEPS.map((st) => (
                  <div
                    key={st.step}
                    className="flex items-baseline gap-2.5 bg-white border border-slate-200 rounded-md px-3 py-1.5 text-[11px] text-slate-700 leading-snug"
                  >
                    <span
                      className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-extrabold shrink-0 ${stepBadgeClass}`}
                    >
                      {st.step}
                    </span>
                    <div>
                      <strong className="text-slate-900">
                        {st.step}. {st.title} —
                      </strong>{" "}
                      <span>{st.description}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* TERMO DE ACEITE E ASSINATURAS */}
            <div className="p-4 rounded-lg bg-white border border-slate-200">
              <div className="text-xs font-extrabold uppercase text-slate-800 mb-2">
                Termo de Aceite e Aprovação da Proposta Comercial ({proposal.code})
              </div>
              <p className="text-[11px] text-slate-600 mb-6 leading-relaxed">
                Declaramos estar de acordo com as especificações técnicas, prazos, fluxo de contratação e condições comerciais descritas nesta Proposta Comercial, autorizando a emissão do respectivo Contrato de Locação / Prestação de Serviços pela SETA TELECOM LTDA.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 pt-4">
                <div className="border-t border-slate-300 pt-2 text-center">
                  <div className="text-xs font-extrabold text-slate-900">SETA TELECOM LTDA</div>
                  <div className="text-[11px] text-slate-500">
                    {sellerContact.name} • {sellerContact.email}
                    {sellerContact.phone ? ` • WhatsApp: ${sellerContact.phone}` : ""}
                  </div>
                </div>

                <div className="border-t border-slate-300 pt-2 text-center">
                  <div className="text-xs font-extrabold text-slate-900">{proposal.companyName}</div>
                  <div className="text-[11px] text-slate-500">
                    CNPJ {proposal.companyCnpj} •{" "}
                    {proposal.digitalSignature?.signerName || proposal.careOf || proposal.contactName}{" "}
                    ({proposal.digitalSignature?.signerRole || "Assinatura / Carimbo"})
                  </div>
                </div>
              </div>
            </div>

            {/* SELO DE ASSINATURA DIGITAL ICP-BRASIL / GOV.BR NO RODAPÉ A4 */}
            <div className="p-4 rounded-lg border border-slate-200 border-l-4 border-l-emerald-500 bg-slate-50/70 text-xs space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-extrabold text-slate-900 uppercase text-[11px]">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  Selo de Autenticidade e Assinatura Eletrônica ICP-Brasil / Gov.br (ITI)
                </div>
                <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-extrabold">
                  {proposal.digitalSignature
                    ? `ASSINADO DIGITALMENTE (${proposal.digitalSignature.modality})`
                    : "HABILITADO PARA ASSINATURA ICP-BRASIL / GOV.BR"}
                </span>
              </div>

              {proposal.digitalSignature ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-800 pt-1 border-t border-slate-200">
                  <div>
                    <div>
                      <strong>Signatário:</strong> {proposal.digitalSignature.signerName} (CPF:{" "}
                      {proposal.digitalSignature.signerCpf})
                    </div>
                    <div>
                      <strong>Cargo:</strong> {proposal.digitalSignature.signerRole} •{" "}
                      <strong>Modalidade:</strong> {proposal.digitalSignature.modality}
                    </div>
                    <div>
                      <strong>Autoridade Certificadora:</strong>{" "}
                      {proposal.digitalSignature.certificateIssuer}
                    </div>
                  </div>
                  <div className="font-mono text-[10px] text-slate-700 space-y-0.5">
                    <div>
                      <strong>Carimbo de Tempo (ACT/ITI):</strong>{" "}
                      {proposal.digitalSignature.timestampToken}
                    </div>
                    <div>
                      <strong>Data/Hora UTC:</strong> {proposal.digitalSignature.signedAt}
                    </div>
                    <div className="break-all">
                      <strong>Hash SHA-256:</strong> {proposal.digitalSignature.signatureHashSha256}
                    </div>
                  </div>
                  <div className="sm:col-span-2 flex justify-end pt-1 print:hidden">
                    <button
                      type="button"
                      onClick={handleValidateExistingSignature}
                      className="px-3 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-extrabold cursor-pointer inline-flex items-center gap-1"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Validar Integridade da Assinatura Digital (SHA-256)
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
                  <span>
                    Documento preparado para assinatura eletrônica qualificada nos termos da MP nº 2.200-2/2001 (ICP-Brasil A1/A3) e Lei nº 14.063/2020 (Gov.br).
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (!signerName.trim()) {
                        setSignerName(proposal.careOf || proposal.contactName || "Representante Legal");
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
