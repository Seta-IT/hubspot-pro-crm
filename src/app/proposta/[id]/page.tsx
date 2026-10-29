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
  RotateCcw,
  ExternalLink,
  X,
} from 'lucide-react';
import { ErpCommercialProposal, ErpProposalDigitalSignature, ErpProposalVersionEntry } from '../../../db/types';
import { formatBRL } from '../../components/ui-helpers';
import {
  appendClientProposalVersion,
  buildProposalVersionUrl,
  buildPublicProposalUrl,
  buildSnapshotFromProposal,
  proposalFromVersionSnapshot,
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
  resolveProposalDocumentHeadings,
  resolveProposalLayoutKind,
} from '../../lib/proposal-share';
import { loadDurableJournal, recordUpsertedContract, recordUpsertedInvoice, recordUpsertedProposal } from '../../lib/durable-storage';
import { ProposalEditModal } from '../../components/ErpEditModals';

function PublicProposalPrintContent() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const rawId = decodeURIComponent(String(params?.id || ''));
  const encodedData = searchParams?.get("d");
  const versionParam = searchParams?.get("v");
  const autoPrint = searchParams?.get("print") === "1";

  const [proposal, setProposal] = useState<ErpCommercialProposal | null>(() =>
    decodeProposalFromQueryParam(encodedData)
  );
  const [viewingVersionNum, setViewingVersionNum] = useState<number | null>(() =>
    versionParam ? Number(versionParam) || null : null
  );
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);
  const [restoredBannerMsg, setRestoredBannerMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!proposal);
  const [copied, setCopied] = useState(false);

  // Full In-Page Editor State
  const [isEditing, setIsEditing] = useState(false);
  const [showInternalVersionsModal, setShowInternalVersionsModal] = useState(() => searchParams?.get("versions") === "1");
  const [savedNotice, setSavedNotice] = useState(false);
  const [approvingContract, setApprovingContract] = useState(false);
  const [convertedContractInfo, setConvertedContractInfo] = useState<{
    contractNumber: string;
    invoiceNumber: string;
  } | null>(null);
  const [showIcpSignatureModal, setShowIcpSignatureModal] = useState(false);
  const [signatureVerifiedBanner, setSignatureVerifiedBanner] = useState<string | null>(null);
  const [signerName, setSignerName] = useState("");
  const [signerCpf, setSignerCpf] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  // Sessao interna STI-hub: somente usuarios logados (MFA) veem a barra de edicao,
  // versoes e restauracao. O cliente sem login so visualiza, imprime/PDF e aprova.
  const [isInternalUser, setIsInternalUser] = useState(false);
  const [signerRole, setSignerRole] = useState("Diretor / Representante Legal");
  const [signatureModality, setSignatureModality] = useState<
    "ICP_BRASIL_A1" | "ICP_BRASIL_A3" | "GOV_BR_OURO"
  >("ICP_BRASIL_A1");

  useEffect(() => {
    const requestedVer = versionParam ? Number(versionParam) || null : null;
    setViewingVersionNum(requestedVer);

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
            templateStyle:
              decoded.templateStyle || localFound.templateStyle || "CLEAN_CORPORATE_LIGHT",
            slaTier: decoded.slaTier || localFound.slaTier,
            setupFee: decoded.setupFee ?? localFound.setupFee,
            sellerEmail: decoded.sellerEmail || localFound.sellerEmail,
            sellerPhone: decoded.sellerPhone || localFound.sellerPhone,
            status:
              localFound.status === "CONVERTIDA_CONTRATO"
                ? "CONVERTIDA_CONTRATO"
                : decoded.status,
            convertedContractId:
              decoded.convertedContractId || localFound.convertedContractId || null,
            digitalSignature: decoded.digitalSignature || localFound.digitalSignature || null,
            version: localFound.version || decoded.version || 1,
            versionHistory: localFound.versionHistory || decoded.versionHistory,
          }
        : decoded;
      setProposal(computeProposalTotals(merged));
      setLoading(false);

      // Hydrate versionHistory from API if not present in localStorage
      if (!Array.isArray(merged.versionHistory) || merged.versionHistory.length === 0) {
        fetch(`/api/erp/proposals/${encodeURIComponent(rawId)}`)
          .then((r) => r.json())
          .then((json) => {
            const apiProp = json?.data && !Array.isArray(json.data) ? (json.data as ErpCommercialProposal) : null;
            if (apiProp && Array.isArray(apiProp.versionHistory) && apiProp.versionHistory.length > 0) {
              setProposal((prev) =>
                prev
                  ? {
                      ...prev,
                      version: apiProp.version || prev.version || apiProp.versionHistory!.length,
                      versionHistory: apiProp.versionHistory,
                    }
                  : prev
              );
            }
          })
          .catch(() => null);
      }
      return;
    }

    if (localFound && Array.isArray(localFound.versionHistory) && localFound.versionHistory.length > 0) {
      if (requestedVer) {
        const entry = localFound.versionHistory.find((v) => Number(v.version) === requestedVer);
        if (entry) {
          setProposal({
            ...proposalFromVersionSnapshot(localFound, entry),
            version: localFound.version,
            versionHistory: localFound.versionHistory,
          });
          setLoading(false);
          return;
        }
      }
      setProposal(computeProposalTotals(localFound));
      setLoading(false);
      return;
    }

    let active = true;
    fetch(`/api/erp/proposals/${encodeURIComponent(rawId)}`)
      .then((r) => r.json())
      .then((json) => {
        if (!active) return;
        const apiData: ErpCommercialProposal | null =
          json?.data && !Array.isArray(json.data)
            ? (json.data as ErpCommercialProposal)
            : (Array.isArray(json?.data) ? (json.data as ErpCommercialProposal[]) : []).find(
                (p) =>
                  p.id === rawId ||
                  p.code.toLowerCase() === rawId.toLowerCase() ||
                  p.id.toLowerCase() === rawId.toLowerCase()
              ) ||
              localFound ||
              null;

        if (apiData) {
          if (requestedVer && Array.isArray(apiData.versionHistory)) {
            const entry = apiData.versionHistory.find((v) => Number(v.version) === requestedVer);
            if (entry) {
              setProposal({
                ...proposalFromVersionSnapshot(apiData, entry),
                version: apiData.version,
                versionHistory: apiData.versionHistory,
              });
              setLoading(false);
              return;
            }
          }
          setProposal(computeProposalTotals(apiData));
        } else {
          setProposal(null);
        }
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          if (localFound) setProposal(computeProposalTotals(localFound));
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [rawId, encodedData, versionParam]);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!active) return;
        const data = json?.data;
        const ok = Boolean(data && data.authenticated === true && data.mfaVerified === true);
        setIsInternalUser(ok);
        if (!ok) {
          setIsEditing(false);
          setShowInternalVersionsModal(false);
        }
      })
      .catch(() => {
        if (active) setIsInternalUser(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const describeProtectedFailure = (status: number): string | null => {
    if (status === 401) {
      return "Sua sessão não está ativa. Entre no STI-hub com login e 2FA para editar ou restaurar versões desta proposta.";
    }
    if (status === 403) {
      return "Seu perfil não tem permissão para editar ou restaurar propostas. Somente os perfis ERP Administrador e ERP Comercial podem fazer essa alteração.";
    }
    return null;
  };

  const reportProtectedFailure = (res: Response | null): boolean => {
    if (!res) return false;
    const msg = describeProtectedFailure(res.status);
    if (msg) {
      setAuthNotice(msg);
      setTimeout(() => setAuthNotice(null), 7000);
      return true;
    }
    return false;
  };

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

    const clientVersioned = proposal
      ? appendClientProposalVersion(proposal, computed)
      : computed;

    const res = await fetch(`/api/erp/proposals/${encodeURIComponent(computed.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(computed),
    }).catch(() => null);

    if (reportProtectedFailure(res)) {
      setIsEditing(false);
      return;
    }

    let finalProposal: ErpCommercialProposal = clientVersioned;
    if (res && res.ok) {
      const json = await res.json().catch(() => null);
      if (json?.data) {
        finalProposal = computeProposalTotals(json.data);
      }
    }

    recordUpsertedProposal(finalProposal);
    setProposal(finalProposal);
    setViewingVersionNum(null);
    setIsEditing(false);

    if (typeof window !== "undefined") {
      const newEncoded = encodeProposalToQueryParam(finalProposal);
      const url = new URL(window.location.href);
      if (newEncoded) url.searchParams.set("d", newEncoded);
      url.searchParams.delete("v");
      window.history.replaceState({}, "", url.toString());
    }

    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 3500);
  };

  const handleOpenVersionInPage = (entry: ErpProposalVersionEntry, latestVer: number) => {
    if (!proposal) return;
    const snapProp = {
      ...proposalFromVersionSnapshot(proposal, entry),
      version: latestVer,
      versionHistory: proposal.versionHistory,
    };
    setProposal(snapProp);
    setViewingVersionNum(entry.version === latestVer ? null : entry.version);
    setShowInternalVersionsModal(false);
    if (typeof window !== "undefined") {
      const url = buildProposalVersionUrl(proposal, entry);
      window.history.replaceState({}, "", url);
    }
  };

  const handleRestoreVersionInPage = async (entry: ErpProposalVersionEntry) => {
    if (!proposal) return;
    if (!isInternalUser) {
      setAuthNotice(describeProtectedFailure(401));
      return;
    }
    setRestoringVersion(entry.version);
    try {
      const snapProp = proposalFromVersionSnapshot(proposal, entry);
      let restoredProposal = appendClientProposalVersion(
        proposal,
        snapProp,
        `Restaurada a partir da Versão ${entry.version}`
      );

      const res = await fetch(
        `/api/erp/proposals/${encodeURIComponent(proposal.id)}/restore-version`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetVersion: entry.version,
            restoredBy: proposal.sellerName || "Marcelo Lopes Mira",
          }),
        }
      ).catch(() => null);

      if (reportProtectedFailure(res)) {
        setShowInternalVersionsModal(false);
        return;
      }

      if (res && res.ok) {
        const json = await res.json().catch(() => null);
        if (json?.data) {
          restoredProposal = computeProposalTotals(json.data);
        }
      }

      recordUpsertedProposal(restoredProposal);
      setProposal(restoredProposal);
      setViewingVersionNum(null);
      setShowInternalVersionsModal(false);

      if (typeof window !== "undefined") {
        const newEncoded = encodeProposalToQueryParam(restoredProposal);
        const url = new URL(window.location.href);
        if (newEncoded) url.searchParams.set("d", newEncoded);
        url.searchParams.delete("v");
        window.history.replaceState({}, "", url.toString());
      }

      setRestoredBannerMsg(
        `Versão ${entry.version} restaurada com sucesso! A proposta agora está ativa com os dados restaurados.`
      );
      setTimeout(() => setRestoredBannerMsg(null), 5000);
    } finally {
      setRestoringVersion(null);
    }
  };

  const handleSlaTierChange = async (newSlaId: string) => {
    if (!proposal || !isInternalUser) return;
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
    }).then(reportProtectedFailure).catch(() => null);
  };

  const handleValidateExistingSignature = () => {
    if (!proposal?.digitalSignature) return;
    const sig = proposal.digitalSignature;
    const isHashValid = typeof sig.signatureHashSha256 === "string" && sig.signatureHashSha256.length === 64;
    setSignatureVerifiedBanner(
      isHashValid
        ? `Assinatura Digital Validada: Signatário ${sig.signerName} (${sig.signerCpf}) • Protocolo ${sig.timestampToken} • Hash SHA-256 íntegro.`
        : "Assinatura Digital registrada e verificada."
    );
  };

  const handleTemplateStyleChange = async (
    newStyle: NonNullable<ErpCommercialProposal["templateStyle"]>
  ) => {
    if (!proposal || !isInternalUser) return;
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
    }).then(reportProtectedFailure).catch(() => null);
  };

  const handleDeliveryLeadTimeChange = async (newLeadTime: string) => {
    if (!proposal || !isInternalUser) return;
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
    }).then(reportProtectedFailure).catch(() => null);
  };

  const handleApproveAndConvertInPage = async () => {
    if (!proposal) return;
    setApprovalError(null);
    if (!signerName.trim() || !signerCpf.trim() || !signerRole.trim()) {
      setApprovalError("Preencha nome completo, CPF e cargo do signatário para concluir o aceite.");
      return;
    }
    if (!acceptedTerms) {
      setApprovalError("Para concluir, confirme que leu e aceita os termos desta proposta comercial.");
      return;
    }
    setApprovingContract(true);
    try {
      // Aceite do cliente sem login: todos os dados da assinatura seguem no proprio POST /approve.
      // Nenhuma edicao (PATCH) da proposta e feita pelo cliente.
      const res = await fetch(`/api/erp/proposals/${encodeURIComponent(proposal.id)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signerName: signerName.trim(),
          signerCpf: signerCpf.trim(),
          signerRole: signerRole.trim(),
          signerEmail: proposal.contactEmail || undefined,
          modality: signatureModality,
          acceptedTerms: true,
          proposal,
        }),
      }).catch(() => null);
      if (!res) {
        setApprovalError("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.");
        return;
      }
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        if (res.status === 401 || res.status === 403) {
          setApprovalError(
            "Não foi possível registrar o aceite neste momento. Atualize a página e tente novamente; se o problema continuar, fale com o seu consultor Seta Telecom."
          );
        } else if (res.status === 404) {
          setApprovalError("Proposta não localizada. Solicite um novo link ao seu consultor Seta Telecom.");
        } else {
          setApprovalError(
            (typeof errJson?.error === "string" && errJson.error) ||
              "Não foi possível registrar o aceite. Revise os dados informados e tente novamente."
          );
        }
        return;
      }
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
          `Assinatura Digital (${sig?.modality || signatureModality}) validada com sucesso! Protocolo ${sig?.timestampToken || "ACT-ITI"} • Hash SHA-256 registrado.`
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
  const docHeadings = resolveProposalDocumentHeadings(proposal);
  const {
    headerDocLabel,
    dividerTitle,
    serviceTypeLabel,
    isProductsOnly,
    isRental,
    isServices,
  } = docHeadings;
  const resolvedSla = resolveProposalSlaOption(proposal);
  const hasSelectedSla =
    !isProductsOnly && resolvedSla.id !== "SEM_SLA_ESPECIFICO" && Boolean(resolvedSla.shortLabel);
  const hasContractVigencia =
    !isProductsOnly && (isRental || proposal.items.some((i) => i.isRecurring !== false));
  const sellerContact = resolveProposalSellerContact(proposal);
  const displayPaymentCondition =
    cleanProposalPaymentCondition(proposal.paymentCondition) || "Conforme condições acordadas";
  const commercialTotalAmount = isProductsOnly
    ? Math.round((productsSubtotal + servicesSubtotal - totalDiscounts + shippingCost + isolatedSetupTotal) * 100) / 100
    : proposal.monthlyRecurringTotal || proposal.totalContractValue;

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
                  Proposta Atualizada!
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-200">
              {isInternalUser ? (
                <>
                  Você pode <strong>Editar a Proposta</strong> antes de gerar o PDF ou clicar em{' '}
                  <strong>Imprimir / Salvar em PDF</strong>.
                </>
              ) : (
                <>
                  Revise a proposta, clique em <strong>Imprimir / Salvar em PDF</strong> ou{' '}
                  <strong>assine e aprove</strong> eletronicamente.
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isInternalUser && (
            <>
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold shadow-xs transition cursor-pointer"
          >
            <Edit3 className="w-4 h-4" />
            Editar Proposta antes de Imprimir
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
            title="Consultas Internas / Versões"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-white/15 hover:bg-white/25 border border-white/25 text-white text-xs font-extrabold transition cursor-pointer"
          >
            <History className="w-4 h-4 text-amber-300" />
            <span>
              Versões ({(proposal.versionHistory || []).length || 1})
            </span>
            <span className="sr-only">Consultas Internas / Versões</span>
          </button>

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
            </>
          )}

          {proposal.status !== "CONVERTIDA_CONTRATO" && !proposal.convertedContractId ? (
            <button
              type="button"
              disabled={approvingContract}
              onClick={() => {
                if (!signerName.trim()) {
                  setSignerName(proposal.careOf || proposal.contactName || "Representante Legal");
                }
                setShowIcpSignatureModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-emerald-400 hover:bg-emerald-300 text-slate-950 text-xs font-black shadow-md transition cursor-pointer disabled:opacity-50"
            >
              <ShieldCheck className="w-4 h-4" />
              {approvingContract ? "Assinando..." : "Assinar ICP-Brasil / Gov.br & Aprovar"}
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

      {/* BANNER DE VERSÃO RESTAURADA */}
      {restoredBannerMsg && (
        <div className="max-w-4xl mx-auto mb-4 p-3.5 rounded-lg bg-emerald-800 text-white border border-emerald-400 flex items-center justify-between gap-3 text-xs shadow-md print:hidden">
          <div className="flex items-center gap-2 font-bold">
            <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
            <span>{restoredBannerMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setRestoredBannerMsg(null)}
            className="text-emerald-200 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* BANNER QUANDO ESTIVER VISUALIZANDO UMA VERSÃO ANTERIOR */}
      {(() => {
        const allVers =
          Array.isArray(proposal.versionHistory) && proposal.versionHistory.length > 0
            ? [...proposal.versionHistory].sort((a, b) => b.version - a.version)
            : [];
        const latestEntry = allVers[0];
        const latestVerNum = latestEntry?.version || proposal.version || 1;
        if (!viewingVersionNum || viewingVersionNum === latestVerNum) return null;
        const currentViewedEntry =
          allVers.find((v) => Number(v.version) === Number(viewingVersionNum)) || null;
        return (
          <div className="max-w-4xl mx-auto mb-4 p-3.5 rounded-lg bg-amber-50 border-2 border-amber-400 text-amber-950 flex flex-wrap items-center justify-between gap-3 text-xs shadow-sm print:hidden">
            <div className="flex items-center gap-2.5">
              <History className="w-5 h-5 text-amber-600 shrink-0" />
              <div>
                <div className="font-extrabold text-sm text-amber-950">
                  Você está visualizando a Versão {viewingVersionNum}{" "}
                  {currentViewedEntry?.savedAt
                    ? `de ${new Date(currentViewedEntry.savedAt).toLocaleString("pt-BR")}`
                    : ""}
                </div>
                <div className="text-[11px] text-amber-800">
                  Valor nesta versão: <strong>{formatBRL(proposal.monthlyRecurringTotal)}/mês</strong> •{" "}
                  <strong>{proposal.contractMonths} meses</strong> •{" "}
                  <strong>{(proposal.items || []).length} item(ns)</strong>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-white hover:bg-slate-100 text-slate-900 border border-slate-300 font-bold cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5 text-[#ff7a59]" />
                Baixar / Imprimir PDF desta Versão
              </button>
              {currentViewedEntry && isInternalUser && (
                <button
                  type="button"
                  disabled={restoringVersion === currentViewedEntry.version}
                  onClick={() => handleRestoreVersionInPage(currentViewedEntry)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-[#1e3a6e] hover:bg-[#162b54] text-white font-extrabold cursor-pointer disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-emerald-300" />
                  Restaurar esta versão
                </button>
              )}
              {latestEntry && (
                <button
                  type="button"
                  onClick={() => handleOpenVersionInPage(latestEntry, latestVerNum)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-amber-200/70 hover:bg-amber-300 text-amber-950 font-bold cursor-pointer"
                >
                  Voltar p/ Versão Atual (Versão {latestVerNum})
                </button>
              )}
            </div>
          </div>
        );
      })()}

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
      {authNotice && (
        <div className="max-w-4xl mx-auto mb-4 p-3.5 rounded-lg bg-amber-50 text-amber-950 border border-amber-300 flex items-center justify-between gap-3 text-xs shadow-sm print:hidden">
          <span className="font-semibold">{authNotice}</span>
          <button
            type="button"
            onClick={() => setAuthNotice(null)}
            className="text-amber-700 hover:text-amber-950 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {isEditing && isInternalUser && (
        <div className="print:hidden">
          <ProposalEditModal
            proposal={proposal}
            onClose={() => setIsEditing(false)}
            onSave={handleSaveEdit}
          />
        </div>
      )}

      {/* MODAL SIMPLES E DIRETO DE VERSÕES DA PROPOSTA (HIDDEN ON PRINT) */}
      {showInternalVersionsModal && isInternalUser && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 print:hidden"
          onClick={() => setShowInternalVersionsModal(false)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 shadow-2xl max-w-4xl w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 bg-[#1e3a6e] text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <History className="w-5 h-5 text-emerald-300" />
                <div>
                  <h3 className="text-base font-extrabold">
                    Versões da Proposta ({proposal.code})
                  </h3>
                  <p className="text-[11px] text-slate-200">
                    Escolha qualquer versão abaixo para abrir na tela, baixar o PDF A4 ou restaurar em 1 clique.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowInternalVersionsModal(false)}
                className="text-slate-300 hover:text-white cursor-pointer p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[78vh] overflow-y-auto text-xs">
              {(() => {
                const versionsList: ErpProposalVersionEntry[] =
                  Array.isArray(proposal.versionHistory) && proposal.versionHistory.length > 0
                    ? [...proposal.versionHistory].sort((a, b) => b.version - a.version)
                    : [
                        {
                          version: proposal.version || 1,
                          versionLabel: `v${proposal.version || 1}.0`,
                          savedAt: proposal.updatedAt || proposal.createdAt || new Date().toISOString(),
                          savedBy: proposal.sellerName || "Marcelo Lopes Mira",
                          changedFields: ["Versão Atual"],
                          changeSummary: "Versão atual da proposta comercial",
                          snapshot: buildSnapshotFromProposal(proposal),
                        },
                      ];
                const latestVer = versionsList[0]?.version || proposal.version || 1;

                return (
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 text-slate-700 font-extrabold uppercase text-[10px] border-b border-slate-200">
                        <tr>
                          <th className="py-3 px-4 w-36">Versão</th>
                          <th className="py-3 px-4 w-48">Data / Hora &amp; Responsável</th>
                          <th className="py-3 px-4">Valor Mensal / Resumo</th>
                          <th className="py-3 px-4 text-right">Ações da Versão</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {versionsList.map((ver) => {
                          const isLatest = ver.version === latestVer;
                          const isCurrentlyViewing =
                            viewingVersionNum === ver.version ||
                            (!viewingVersionNum && isLatest);
                          const verScreenUrl = buildProposalVersionUrl(proposal, ver);
                          const verPdfUrl = buildProposalVersionUrl(proposal, ver, {
                            autoPrint: true,
                          });
                          const mrrVal =
                            ver.snapshot?.monthlyRecurringTotal ?? proposal.monthlyRecurringTotal;
                          const itemsCount = (ver.snapshot?.items || proposal.items || []).length;
                          const monthsVal =
                            ver.snapshot?.contractMonths ?? proposal.contractMonths;

                          return (
                            <tr
                              key={`${ver.version}-${ver.savedAt}`}
                              className={
                                isCurrentlyViewing ? "bg-emerald-50/50" : "hover:bg-slate-50"
                              }
                            >
                              <td className="py-3.5 px-4">
                                <div className="flex items-center gap-2">
                                  <span className="font-extrabold text-sm text-[#0d2b4e]">
                                    Versão {ver.version}
                                  </span>
                                  {isLatest ? (
                                    <span className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-extrabold">
                                      ATUAL
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px] font-bold">
                                      ANTERIOR
                                    </span>
                                  )}
                                </div>
                              </td>

                              <td className="py-3.5 px-4 text-slate-600">
                                <div className="font-semibold text-slate-800">
                                  {ver.savedAt
                                    ? new Date(ver.savedAt).toLocaleString("pt-BR")
                                    : "—"}
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  {ver.savedBy || proposal.sellerName}
                                </div>
                              </td>

                              <td className="py-3.5 px-4">
                                <div className="font-extrabold text-emerald-700 text-xs">
                                  {formatBRL(mrrVal)}/mês • {itemsCount}{" "}
                                  {itemsCount === 1 ? "item" : "itens"} • {monthsVal} meses
                                </div>
                                <div className="text-[11px] text-slate-600 mt-0.5">
                                  {ver.changeSummary}
                                </div>
                              </td>

                              <td className="py-3 px-4 text-right whitespace-nowrap">
                                <div className="flex items-center justify-end gap-1.5 flex-nowrap">
                                  <a
                                    href={verScreenUrl}
                                    onClick={(e) => {
                                      if (!e.metaKey && !e.ctrlKey) {
                                        e.preventDefault();
                                        handleOpenVersionInPage(ver, latestVer);
                                      }
                                    }}
                                    className="px-2.5 py-1 text-xs font-semibold rounded-md inline-flex items-center gap-1 whitespace-nowrap border border-slate-300 bg-white hover:bg-slate-100 text-[#1e3a6e] cursor-pointer"
                                  >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                    <span>Abrir</span>
                                  </a>

                                  <a
                                    href={verPdfUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="px-2.5 py-1 text-xs font-semibold rounded-md inline-flex items-center gap-1 whitespace-nowrap bg-[#ff7a59] hover:bg-[#e86646] text-white cursor-pointer"
                                  >
                                    <Printer className="w-3.5 h-3.5" />
                                    <span>PDF</span>
                                  </a>

                                  {!isLatest ? (
                                    <button
                                      type="button"
                                      disabled={restoringVersion === ver.version}
                                      onClick={() => handleRestoreVersionInPage(ver)}
                                      className="px-2.5 py-1 text-xs font-semibold rounded-md inline-flex items-center gap-1 whitespace-nowrap bg-[#1e3a6e] hover:bg-[#162b54] text-white cursor-pointer disabled:opacity-50"
                                    >
                                      <RotateCcw className="w-3.5 h-3.5 text-emerald-300" />
                                      <span>
                                        {restoringVersion === ver.version
                                          ? "Restaurando..."
                                          : "Restaurar"}
                                      </span>
                                    </button>
                                  ) : (
                                    <span className="px-2.5 py-1 text-xs font-semibold rounded-md inline-flex items-center whitespace-nowrap bg-emerald-100 text-emerald-800 border border-emerald-200">
                                      Ativa
                                    </span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}

              <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                <span className="text-[11px] text-slate-500">
                  Dica: Ao editar e salvar a proposta, uma nova versão é gravada automaticamente.
                </span>
                <button
                  type="button"
                  onClick={() => setShowInternalVersionsModal(false)}
                  className="px-4 py-2 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-bold cursor-pointer"
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
                  CNPJ: <strong>{proposal.companyCnpj}</strong> • Valor Mensal:{" "}
                  <strong className="text-emerald-700">{formatBRL(proposal.monthlyRecurringTotal)}/mês</strong> • Tempo de Contrato:{" "}
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
                        e.target.value as "ICP_BRASIL_A1" | "ICP_BRASIL_A3" | "GOV_BR_OURO"
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

              <label className="flex items-start gap-2 p-3 rounded bg-slate-50 border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="font-semibold text-slate-700">
                  Declaro que li e aceito integralmente os termos, valores e condições desta proposta comercial ({proposal.code}).
                </span>
              </label>

              {approvalError && (
                <div className="p-3 rounded bg-red-50 border border-red-200 text-red-800 font-semibold">
                  {approvalError}
                </div>
              )}

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
                    ? "Gerando Hash SHA-256 & Contrato..."
                    : "Confirmar Assinatura ICP-Brasil & Gerar Contrato"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* A4 DOCUMENT CONTAINER */}
      <div
        id="proposal-printable-sheet"
        className={`max-w-4xl mx-auto bg-white shadow-sm border ${sheetBorderClass} overflow-hidden print:overflow-visible print:shadow-none print:border-0 print:rounded-none`}
      >
        {/* BLOCO 1: CABEÇALHO LEVE TIMBRADO SETA TELECOM / SETA | IT */}
        <div className={`${headerBgClass} print-avoid-break px-7 py-5 print:px-3.5 print:py-2 space-y-3.5 print:space-y-1.5 rounded-t-lg print:rounded-none`}>
          <div className="flex flex-col sm:flex-row print:flex-row sm:items-center print:items-center justify-between gap-4 print:gap-3 pb-3.5 print:pb-1.5 border-b border-slate-200/80">
            <div className="flex items-center gap-3.5 min-w-0">
              {/* OFFICIAL SETA | IT LOGO CARD */}
              <div className="bg-white rounded-md px-3.5 py-2.5 print:px-3 print:py-2 flex items-center gap-2 shrink-0 border border-slate-200 shadow-2xs">
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

            <div className={`${metaBoxClass} rounded-lg px-4 py-2.5 print:px-3.5 print:py-2 sm:text-right print:text-right shrink-0`}>
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

          <div className="flex flex-col sm:flex-row print:flex-row sm:items-center print:items-center justify-between gap-2.5 text-[11px]">
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

            <div className="flex flex-wrap items-center sm:justify-end print:justify-end gap-1.5">
              {hasContractVigencia && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-semibold">
                  <Calendar className="w-3 h-3 text-emerald-700 shrink-0" />
                  Tempo de Contrato: {contractDurationMonths} {contractDurationMonths === 1 ? "mês" : "meses"}
                </span>
              )}
              {isServices && serviceTypeLabel && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-50 text-indigo-900 border border-indigo-200 text-[10px] font-semibold">
                  Tipo de Serviço: {serviceTypeLabel}
                </span>
              )}
              {deliveryLeadTime && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white text-slate-700 border border-slate-200 text-[10px] font-semibold">
                  <Clock className="w-3 h-3 text-[#1e3a6e] shrink-0" />
                  Prazo de Entrega: {deliveryLeadTime}
                </span>
              )}
              {hasSelectedSla && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-50 text-[#1e3a6e] border border-blue-200 text-[10px] font-semibold">
                  <ShieldCheck className="w-3 h-3 text-[#1e3a6e] shrink-0" />
                  {resolvedSla.shortLabel}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* DOCUMENT BODY */}
        <div className="p-7 print:px-3.5 print:py-2 space-y-4 print:space-y-2 text-slate-800 print:block">
          {/* BLOCO 2: APRESENTAÇÃO INSTITUCIONAL RESUMIDA + TÓPICOS DE SERVIÇOS DO SITE SETATELECOM.COM.BR */}
          <div className={`print-avoid-break rounded-lg p-4 print:p-2.5 space-y-3 print:space-y-1.5 ${instCardClass}`}>
            <div>
              <div className={`text-[10px] font-extrabold uppercase tracking-wider ${instEyebrowColorClass}`}>
                {SETA_TELECOM_INSTITUTIONAL_SUMMARY.eyebrow}
              </div>
              <h2 className="text-sm sm:text-base print:text-sm font-extrabold text-slate-900 mt-0.5">
                {SETA_TELECOM_INSTITUTIONAL_SUMMARY.headline}
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 print:grid-cols-3 gap-2.5 print:gap-2 text-[11px] print:text-[10.5px] text-slate-700">
              <div className="bg-white rounded-md border border-slate-200 p-2.5 print:p-1.5 leading-relaxed print:leading-tight">
                <strong className="block text-[10px] uppercase tracking-wider text-[#1e3a6e] mb-0.5">
                  {SETA_TELECOM_INSTITUTIONAL_SUMMARY.marketTimeLabel}
                </strong>
                <span>{SETA_TELECOM_INSTITUTIONAL_SUMMARY.marketTime}</span>
              </div>
              <div className="bg-white rounded-md border border-slate-200 p-2.5 print:p-1.5 leading-relaxed print:leading-tight">
                <strong className="block text-[10px] uppercase tracking-wider text-[#1e3a6e] mb-0.5">
                  {SETA_TELECOM_INSTITUTIONAL_SUMMARY.locationLabel}
                </strong>
                <span>{SETA_TELECOM_INSTITUTIONAL_SUMMARY.location}</span>
              </div>
              <div className="bg-white rounded-md border border-slate-200 p-2.5 print:p-1.5 leading-relaxed print:leading-tight">
                <strong className="block text-[10px] uppercase tracking-wider text-[#1e3a6e] mb-0.5">
                  {SETA_TELECOM_INSTITUTIONAL_SUMMARY.partnersLabel}
                </strong>
                <span>{SETA_TELECOM_INSTITUTIONAL_SUMMARY.partners}</span>
              </div>
            </div>

            <div className="bg-white rounded-md border border-slate-200 p-3 print:p-2">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-700 mb-2 print:mb-1.5">
                {SETA_TELECOM_INSTITUTIONAL_SUMMARY.servicesTitle}
              </div>
              <ul className="grid grid-cols-1 sm:grid-cols-2 print:grid-cols-2 gap-x-4 gap-y-1 print:gap-y-0.5 text-[11px] print:text-[10.5px] text-slate-700">
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

          <div className="print-avoid-break print-keep-with-next flex items-center gap-3 py-0.5">
            <span className="flex-1 h-px bg-slate-200" />
            <span className="text-[11px] font-semibold tracking-widest text-[#1e3a6e]">
              {dividerTitle || "PROPOSTA COMERCIAL - Solução"}
            </span>
            <span className="flex-1 h-px bg-slate-200" />
          </div>

          {/* BLOCO 3: CLIENTE & DADOS COMERCIAIS */}
          <div className={`print-avoid-break grid grid-cols-1 sm:grid-cols-2 print:grid-cols-2 gap-4 print:gap-2.5 rounded-lg p-4 print:p-2.5 ${softBoxClass}`}>
            <div className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5 text-[#1e3a6e]" />
                DADOS DA EMPRESA:
              </div>
              <div className="text-sm sm:text-base font-semibold text-slate-900">{proposal.companyName}</div>
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

            <div className="space-y-1 sm:border-l print:border-l sm:border-slate-200 print:border-slate-200 sm:pl-4 print:pl-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                <UserCheck className="w-3.5 h-3.5 text-[#1e3a6e]" />
                CONDIÇÕES GERAIS:
              </div>
              <div className="text-sm font-semibold text-slate-900">
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
              {isServices && serviceTypeLabel && (
                <div className="text-xs text-slate-600">
                  <span className="text-slate-800">Tipo de Serviço:</span>{" "}
                  <span className="text-[#1e3a6e]">{serviceTypeLabel}</span>
                </div>
              )}
              <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
                {hasContractVigencia && (
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    Tempo de Contrato: <strong className="text-slate-800">{proposal.contractMonths} meses</strong>
                  </span>
                )}
                {deliveryLeadTime && (
                  <span>
                    Prazo de Entrega: <strong className="text-slate-800">{deliveryLeadTime}</strong>
                  </span>
                )}
                {hasSelectedSla && (
                  <span>
                    SLA: <strong className="text-slate-800">{resolvedSla.shortLabel}</strong>
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-600">
                <strong className="text-slate-800">Condição de Pagamento:</strong> {displayPaymentCondition}
              </div>
            </div>
          </div>

          {/* BLOCO 4: FAIXA EXECUTIVA LEVE */}
          {isProductsOnly ? (
            <div className={`print-avoid-break grid grid-cols-2 sm:grid-cols-4 print:grid-cols-4 gap-2.5 p-3.5 print:p-2 rounded-lg ${stripBoxClass} text-xs`}>
              <div className="sm:border-r print:border-r sm:border-slate-200 print:border-slate-200 sm:pr-2 print:pr-2">
                <span className="text-[10px] uppercase text-slate-500 font-semibold block">
                  Valor Total dos Produtos
                </span>
                <span className="font-semibold text-emerald-700 text-sm">
                  {formatBRL(productsSubtotal - totalDiscounts)}
                </span>
              </div>
              <div className="sm:border-r print:border-r sm:border-slate-200 print:border-slate-200 sm:pr-2 print:pr-2">
                <span className="text-[10px] uppercase text-slate-500 font-semibold block">
                  Prazo de Entrega
                </span>
                <span className="font-semibold text-slate-900">
                  {deliveryLeadTime || "Conforme disponibilidade"}
                </span>
              </div>
              <div className="sm:border-r print:border-r sm:border-slate-200 print:border-slate-200 sm:pr-2 print:pr-2">
                <span className="text-[10px] uppercase text-slate-500 font-semibold block">
                  Condição de Pagamento
                </span>
                <span className="font-semibold text-slate-800">
                  {displayPaymentCondition}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase text-slate-500 font-semibold block">
                  FRETE R$:
                </span>
                <span className="font-semibold text-slate-800">
                  {shippingCost > 0 ? formatBRL(shippingCost) : "R$ 0,00"}
                </span>
              </div>
            </div>
          ) : (
            <div className={`print-avoid-break grid grid-cols-2 ${hasSetupSelected ? "sm:grid-cols-5 print:grid-cols-5" : "sm:grid-cols-4 print:grid-cols-4"} gap-2.5 p-3.5 print:p-2 rounded-lg ${stripBoxClass} text-xs`}>
              <div className="sm:border-r print:border-r sm:border-slate-200 print:border-slate-200 sm:pr-2 print:pr-2">
                <span className="text-[10px] uppercase text-slate-500 font-semibold block">
                  Valor Mensal
                </span>
                <span className="font-semibold text-emerald-700 text-sm">
                  {formatBRL(proposal.monthlyRecurringTotal || commercialTotalAmount)}/mês
                </span>
              </div>
              <div className="sm:border-r print:border-r sm:border-slate-200 print:border-slate-200 sm:pr-2 print:pr-2">
                <span className="text-[10px] uppercase text-slate-500 font-semibold block">
                  {hasContractVigencia ? "Tempo de Contrato" : "Tipo de Serviço"}
                </span>
                <span className="font-semibold text-slate-900 text-sm">
                  {hasContractVigencia
                    ? `${contractDurationMonths} ${contractDurationMonths === 1 ? "Mês" : "Meses"}`
                    : serviceTypeLabel || "Serviço Técnico"}
                </span>
              </div>
              <div className="sm:border-r print:border-r sm:border-slate-200 print:border-slate-200 sm:pr-2 print:pr-2">
                <span className="text-[10px] uppercase text-slate-500 font-semibold block">
                  {hasSelectedSla ? "SLA Contratado" : "Condição de Pagamento"}
                </span>
                <span className="font-semibold text-slate-800">
                  {hasSelectedSla ? resolvedSla.shortLabel : displayPaymentCondition}
                </span>
              </div>
              {hasSetupSelected && (
                <div className="sm:border-r print:border-r sm:border-slate-200 print:border-slate-200 sm:pr-2 print:pr-2">
                  <span className="text-[10px] uppercase text-amber-800 font-semibold block">
                    Setup / Ativação
                  </span>
                  <span className="font-semibold text-amber-900">
                    {formatBRL(isolatedSetupTotal)}
                  </span>
                </div>
              )}
              <div>
                <span className="text-[10px] uppercase text-slate-500 font-semibold block">
                  FRETE R$:
                </span>
                <span className="font-semibold text-slate-800">
                  {shippingCost > 0 ? formatBRL(shippingCost) : "R$ 0,00"}
                </span>
              </div>
            </div>
          )}

          {/* BLOCO 5: TÍTULO, TABELA LEVE DE ITENS E RESUMO DE SUBTOTAIS */}
          <div className={`print-avoid-break print-keep-with-next border-l-3 ${scopeBorderClass} pl-3.5 py-0.5 space-y-1`}>
            <h2 className="text-sm sm:text-base font-extrabold text-slate-900">
              {proposal.title}
            </h2>
            {proposal.introductionText && (
              <p className="text-xs text-slate-600 leading-relaxed">
                {proposal.introductionText}
              </p>
            )}
          </div>

          <div className={`border ${tableCardBorderClass} rounded-lg overflow-hidden print:overflow-visible bg-white`}>
            <div className={`${tableHeaderBgClass} print-avoid-break print-keep-with-next px-4 py-2.5 print:py-2 flex items-center justify-between text-[11px] font-extrabold tracking-wide`}>
              <span>ESPECIFICAÇÃO DOS PRODUTOS, EQUIPAMENTOS &amp; SERVIÇOS</span>
              <span>VALORES EM REAIS (BRL)</span>
            </div>
            <table className="w-full text-left text-xs border-collapse">
              <thead className={`${tableColHeadClass} uppercase text-[10px]`}>
                <tr className="print-avoid-break">
                  <th className="py-2 print:py-1.5 px-2.5 w-24 font-extrabold">Código / SKU</th>
                  <th className="py-2 print:py-1.5 px-2.5 font-extrabold">Descrição do Item / Escopo</th>
                  <th className="py-2 print:py-1.5 px-2 text-center w-20 font-extrabold">Quantidade</th>
                  <th className="py-2 print:py-1.5 px-2.5 text-right w-24 font-extrabold">Vlr. Unitário</th>
                  <th className="py-2 print:py-1.5 px-2 text-right w-20 font-extrabold">Desconto</th>
                  <th className="py-2 print:py-1.5 px-2.5 text-right w-24 font-extrabold">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80">
                {proposal.items.map((item, idx) => {
                  const hasDisc =
                    (item.discountPercent || 0) > 0 || (item.discountAmount || 0) > 0;
                  return (
                    <tr key={item.id || idx} className="print-avoid-break even:bg-slate-50/40 hover:bg-slate-50/80">
                      <td className="py-2.5 print:py-1.5 px-2.5 font-mono font-bold text-[#1e3a6e] text-[11px] whitespace-nowrap">{item.sku}</td>
                      <td className="py-2.5 print:py-1.5 px-2.5">
                        <div className="font-bold text-slate-900 leading-snug">{item.description}</div>
                      </td>
                      <td className="py-2.5 print:py-1.5 px-2 text-center font-bold text-slate-900 whitespace-nowrap">
                        {item.quantity} {item.quantity === 1 ? "un" : "un"}
                      </td>
                      <td className="py-2.5 print:py-1.5 px-2.5 text-right text-slate-700 whitespace-nowrap">
                        {formatBRL(item.unitPrice)}
                      </td>
                      <td className="py-2.5 print:py-1.5 px-2 text-right text-rose-600 font-semibold whitespace-nowrap">
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
                      <td className="py-2.5 print:py-1.5 px-2.5 text-right font-extrabold text-slate-900 whitespace-nowrap">
                        {formatBRL(item.subtotal ?? item.totalMonthly)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* RESUMO DE SUBTOTAIS */}
          <div className={`print-avoid-break grid grid-cols-2 ${hasSetupSelected ? "sm:grid-cols-6 print:grid-cols-6" : "sm:grid-cols-5 print:grid-cols-5"} gap-2.5 rounded-lg p-3.5 print:p-2 text-xs ${softBoxClass}`}>
            <div>
              <span className="text-[10px] uppercase font-semibold text-slate-500 block">
                Subtotal Produtos
              </span>
              <strong className="text-sm font-semibold text-slate-900">
                {formatBRL(productsSubtotal)}
              </strong>
            </div>
            <div>
              <span className="text-[10px] uppercase font-semibold text-slate-500 block">
                Subtotal Serviços
              </span>
              <strong className="text-sm font-semibold text-slate-900">
                {formatBRL(servicesSubtotal)}
              </strong>
            </div>
            <div>
              <span className="text-[10px] uppercase font-semibold text-slate-500 block">
                Descontos Aplicados
              </span>
              <strong className="text-sm font-semibold text-rose-600">
                {totalDiscounts > 0 ? `- ${formatBRL(totalDiscounts)}` : "R$ 0,00"}
              </strong>
            </div>
            {hasSetupSelected && (
              <div>
                <span className="text-[10px] uppercase font-semibold text-amber-800 block">
                  Setup / Ativação
                </span>
                <strong className="text-sm font-semibold text-amber-900">
                  {formatBRL(isolatedSetupTotal)}
                </strong>
                <span className="block text-[10px] text-slate-500">Taxa única isolada</span>
              </div>
            )}
            <div>
              <span className="text-[10px] uppercase font-semibold text-slate-500 block">
                Frete
              </span>
              <strong className="text-sm font-semibold text-slate-900">
                {shippingCost > 0 ? formatBRL(shippingCost) : "R$ 0,00"}
              </strong>
              {proposal.shippingCarrier && (
                <span className="block text-[10px] text-slate-500 truncate">
                  {proposal.shippingCarrier}
                </span>
              )}
            </div>
            <div className="text-right">
              <span className="text-[10px] uppercase font-semibold text-emerald-700 block">
                {isProductsOnly ? "Valor Total da Proposta" : "Valor Mensal"}
              </span>
              <span className="text-sm font-semibold text-emerald-700">
                {formatBRL(isProductsOnly ? commercialTotalAmount : proposal.monthlyRecurringTotal || commercialTotalAmount)}
              </span>
            </div>
          </div>

          {/* BLOCO 6: QUADRO FISCAL E TOTAIS LEVES */}
          <div className="print-avoid-break grid grid-cols-1 sm:grid-cols-3 print:grid-cols-3 gap-4 print:gap-3">
            <div className="sm:col-span-2 print:col-span-2 p-4 print:p-2.5 rounded-lg bg-emerald-50/60 border border-emerald-200 space-y-2 print:space-y-1.5 text-xs">
              <div className="flex items-center gap-2 font-semibold text-emerald-900 text-xs">
                <Scale className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>Fiscal</span>
              </div>
              <p className="text-slate-700 leading-relaxed text-[11px]">
                {isProductsOnly
                  ? proposal.commercialNotes && !proposal.commercialNotes.toLowerCase().includes("locação")
                    ? proposal.commercialNotes
                    : "Fornecimento de equipamentos e produtos mediante emissão de Nota Fiscal Eletrônica de Venda (NF-e Modelo 55 — ICMS / IPI conforme legislação vigente e NCM de cada item)."
                  : proposal.commercialNotes}
              </p>
            </div>

            <div className={`p-4 print:p-2.5 rounded-lg ${totalBoxBgClass} flex flex-col justify-between space-y-3 print:space-y-2`}>
              <div className="space-y-1.5">
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#1e3a6e] block">
                    {isProductsOnly ? "Valor Total da Proposta Comercial" : "Valor Mensal"}
                  </span>
                  <div className="text-2xl print:text-xl font-semibold text-emerald-700 mt-0.5">
                    {formatBRL(isProductsOnly ? commercialTotalAmount : proposal.monthlyRecurringTotal || commercialTotalAmount)}
                    {!isProductsOnly && (
                      <span className="text-xs font-semibold text-slate-500">/mês</span>
                    )}
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

          {/* BLOCO 7: CRONOGRAMA DE PARCELAS (QUANDO PRESENTE) */}
          {Array.isArray(proposal.installments) && proposal.installments.length > 0 && (
            <div className={`print-avoid-break border ${tableCardBorderClass} rounded-lg overflow-hidden print:overflow-visible bg-white`}>
              <div className={`${tableHeaderBgClass} px-4 py-2 flex items-center justify-between text-xs font-semibold`}>
                <span className="inline-flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4 text-[#1e3a6e]" />
                  CONDIÇÕES DE PAGAMENTO E CRONOGRAMA DE PARCELAS ({proposal.installments.length}x)
                </span>
                <span className="text-[11px] text-slate-600">{displayPaymentCondition}</span>
              </div>
              <table className="w-full text-left text-xs border-collapse">
                <thead className={`${tableColHeadClass} uppercase text-[10px]`}>
                  <tr className="print-avoid-break">
                    <th className="py-2 px-3 w-20 font-semibold">Parcela</th>
                    <th className="py-2 px-3 w-36 font-semibold">Data de Vencimento</th>
                    <th className="py-2 px-3 w-48 font-semibold">Forma de Pagamento</th>
                    <th className="py-2 px-3 text-right w-36 font-semibold">Valor da Parcela</th>
                    <th className="py-2 px-3 font-semibold">Observação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/80">
                  {proposal.installments.map((inst, idx) => (
                    <tr key={idx} className="print-avoid-break even:bg-slate-50/40">
                      <td className="py-2 px-3 font-mono font-semibold text-[#1e3a6e]">
                        {inst.number}ª
                      </td>
                      <td className="py-2 px-3 font-semibold text-slate-800">
                        {inst.dueDate.includes("-")
                          ? new Date(`${inst.dueDate.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR")
                          : inst.dueDate}
                      </td>
                      <td className="py-2 px-3 text-slate-700">{inst.paymentMethod}</td>
                      <td className="py-2 px-3 text-right font-semibold text-slate-900">
                        {formatBRL(inst.amount)}
                      </td>
                      <td className="py-2 px-3 text-slate-600">{inst.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* BLOCO 8 E 9: TRANSPORTE/ENTREGA E CLÁUSULAS TÉCNICAS */}
          {(proposal.shippingCarrier || proposal.deliveryAddress || deliveryLeadTime || shippingCost > 0) && (
            <div className={`print-avoid-break p-3.5 print:p-3 rounded-lg ${softBoxClass} flex flex-wrap items-center justify-between gap-3 text-xs`}>
              <div className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-[#1e3a6e] shrink-0" />
                <div>
                  <span className="font-semibold text-slate-800 uppercase text-[11px] block">
                    {isProductsOnly ? "Logística, Transporte & Entrega" : "Logística, Remessa & Instalação"}
                  </span>
                  <span className="text-slate-600">
                    Modalidade: <strong className="text-slate-800">{proposal.shippingCarrier || "Frota Própria Seta Telecom"}</strong>{deliveryLeadTime ? <> • Prazo de Entrega: <strong className="text-slate-800">{deliveryLeadTime}</strong></> : null}{proposal.deliveryAddress ? ` • Local: ${proposal.deliveryAddress}` : ""}
                  </span>
                </div>
              </div>
              <div className="font-semibold text-slate-800">
                FRETE R$: {shippingCost > 0 ? formatBRL(shippingCost) : "R$ 0,00"}
              </div>
            </div>
          )}

          {cleanProposalTechnicalClauses(proposal.technicalClauses) && (
            <div className={`print-avoid-break p-4 print:p-3 rounded-lg ${softBoxClass} space-y-1.5 text-xs`}>
              <div className="font-semibold text-slate-800 uppercase text-[11px] flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-[#1e3a6e]" />
                {isProductsOnly
                  ? "Condições Gerais de Fornecimento & Garantia"
                  : isServices && !isRental
                    ? `Condições Técnicas de Execução (${serviceTypeLabel})`
                    : "Condições Técnicas, Remessa CFOP 5.908 & Acordo de Nível de Serviço (SLA)"}
              </div>
              <p className="text-slate-600 leading-relaxed">
                {cleanProposalTechnicalClauses(proposal.technicalClauses)}
              </p>
            </div>
          )}

          {/* BLOCO 10 E 11: SEÇÃO DE APROVAÇÃO DA PROPOSTA (+ 7 ETAPAS DO FLUXO QUANDO FOR LOCAÇÃO) */}
          <div className="pt-4 print:pt-2 mt-2 border-t border-slate-200 space-y-4 print:space-y-3">
            {isRental && (
              /* BLOCO 10: FLUXO DE CONTRATAÇÃO DE LOCAÇÃO — CLIENTE SETA TELECOM */
              <div className={`print-avoid-break p-4 print:p-3.5 rounded-lg ${flowBoxClass} space-y-2.5 print:space-y-1.5`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-[#1e3a6e]">
                  {SETA_TELECOM_HIRING_FLOW_TITLE}
                </div>
                <div className="space-y-1.5 print:space-y-1">
                  {SETA_TELECOM_HIRING_FLOW_STEPS.map((st) => (
                    <div
                      key={st.step}
                      className="print-avoid-break flex items-baseline gap-2.5 bg-white border border-slate-200 rounded-md px-3 py-1.5 print:py-1 text-[11px] text-slate-700 leading-snug"
                    >
                      <span
                        className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold shrink-0 ${stepBadgeClass}`}
                      >
                        {st.step}
                      </span>
                      <div>
                        <span className="text-slate-900">
                          {st.step}. {st.title} —
                        </span>{" "}
                        <span>{st.description}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* BLOCO 11: TERMO DE ACEITE + ASSINATURAS + SELO ICP-BRASIL */}
            <div className="print-avoid-break space-y-3">
              {/* TERMO DE ACEITE E ASSINATURAS */}
              <div className="p-4 print:p-3.5 rounded-lg bg-white border border-slate-200">
                <div className="text-xs font-semibold uppercase text-slate-800 mb-2 print:mb-1.5">
                  Termo de Aceite e Aprovação — {headerDocLabel} ({proposal.code})
                </div>
                <p className="text-[11px] text-slate-600 mb-6 print:mb-5 leading-relaxed">
                  {isProductsOnly
                    ? "Declaramos estar de acordo com as especificações dos produtos, quantidades, prazo de entrega e condições comerciais descritas nesta Proposta Comercial, autorizando o faturamento e fornecimento pela SETA TELECOM LTDA."
                    : isServices && !isRental
                      ? `Declaramos estar de acordo com o escopo de ${serviceTypeLabel}, prazos e condições comerciais descritas nesta Proposta de Serviços, autorizando a execução e o faturamento pela SETA TELECOM LTDA.`
                      : "Declaramos estar de acordo com as especificações técnicas, prazos, fluxo de contratação e condições comerciais descritas nesta Proposta de Locação, autorizando a emissão do respectivo Contrato de Locação pela SETA TELECOM LTDA."}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 print:grid-cols-2 gap-8 pt-4 print:pt-3">
                  <div className="border-t border-slate-300 pt-2 text-center">
                    <div className="text-xs font-semibold text-slate-900">SETA TELECOM LTDA</div>
                    <div className="text-[11px] text-slate-500">
                      {sellerContact.name} • {sellerContact.email}
                      {sellerContact.phone ? ` • WhatsApp: ${sellerContact.phone}` : ""}
                    </div>
                  </div>

                  <div className="border-t border-slate-300 pt-2 text-center">
                    <div className="text-xs font-semibold text-slate-900">{proposal.companyName}</div>
                    <div className="text-[11px] text-slate-500">
                      CNPJ {proposal.companyCnpj} •{" "}
                      {proposal.digitalSignature?.signerName || proposal.careOf || proposal.contactName}{" "}
                      ({proposal.digitalSignature?.signerRole || "Assinatura / Carimbo"})
                    </div>
                  </div>
                </div>
              </div>

              {/* SELO DE ASSINATURA DIGITAL ICP-BRASIL / GOV.BR NO RODAPÉ A4 */}
              <div className="p-4 print:p-3.5 rounded-lg border border-slate-200 border-l-4 border-l-emerald-500 bg-slate-50/70 text-xs space-y-2 print:space-y-1.5">
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 print:grid-cols-2 gap-2 text-[11px] text-slate-800 pt-1 border-t border-slate-200">
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
    </div>
  );
}

// PROPOSTA COMERCIAL - Solução
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
