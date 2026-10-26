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
} from 'lucide-react';
import { ErpCommercialProposal } from '../../../db/types';
import { formatBRL } from '../../components/ui-helpers';
import {
  buildPublicProposalUrl,
  decodeProposalFromQueryParam,
} from '../../lib/proposal-share';
import { loadDurableJournal } from '../../lib/durable-storage';

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

  useEffect(() => {
    const decoded = decodeProposalFromQueryParam(encodedData);
    if (decoded) {
      setProposal(decoded);
      setLoading(false);
      return;
    }

    // Check browser durable journal first
    const journal = loadDurableJournal();
    const localFound = (journal.upsertedProposals || []).find(
      (p) => p.id === rawId || p.code.toLowerCase() === rawId.toLowerCase()
    );
    if (localFound) {
      setProposal(localFound);
      setLoading(false);
      return;
    }

    // Fetch from API
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
          ) || list[0] || null;
        setProposal(match);
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
    if (proposal && autoPrint) {
      const timer = setTimeout(() => {
        window.print();
      }, 450);
      return () => clearTimeout(timer);
    }
  }, [proposal, autoPrint]);

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
            Proposta Comercial #{rawId}
          </h1>
          <p className="text-xs text-slate-600">
            Não foi possível localizar esta proposta sem o código de verificação completo. Volte ao painel da Seta Telecom para gerar o link público com assinatura digital.
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

  const issueDateStr = proposal.createdAt
    ? new Date(proposal.createdAt).toLocaleDateString('pt-BR')
    : new Date().toLocaleDateString('pt-BR');
  const validUntilStr = proposal.validUntil
    ? proposal.validUntil.includes('-') && proposal.validUntil.length >= 10
      ? new Date(proposal.validUntil).toLocaleDateString('pt-BR')
      : proposal.validUntil
    : '15 dias';

  const recurringItems = proposal.items.filter((i) => i.isRecurring);
  const setupItems = proposal.items.filter((i) => !i.isRecurring);
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
                Portal do Cliente • Documento Oficial
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-white/15">
                {proposal.code}
              </span>
            </div>
            <p className="text-[11px] text-slate-200">
              Clique em <strong>Imprimir / Salvar em PDF</strong> para baixar o documento timbrado em formato A4.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleCopyPublicLink}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-white/15 hover:bg-white/25 text-white text-xs font-bold transition cursor-pointer"
          >
            {copied ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                Link Copiado!
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
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold shadow-md transition cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            Imprimir / Salvar em PDF
          </button>
        </div>
      </div>

      {/* A4 DOCUMENT CONTAINER */}
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-xl border border-slate-200 overflow-hidden print:shadow-none print:border-0 print:rounded-none">
        {/* HEADER TIMBRADO SETA TELECOM / SETA IT */}
        <div className="bg-gradient-to-r from-[#1e3a6e] via-[#244682] to-[#1e3a6e] text-white px-8 py-6 border-b-4 border-[#ff7a59]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              {/* SETA IT LOGO BOX */}
              <div className="bg-white rounded-lg px-4 py-2.5 shadow-sm flex items-center gap-1.5 shrink-0">
                <span className="text-xl font-black tracking-tight text-[#1e3a6e]">SETA</span>
                <div className="flex items-center gap-0.5">
                  <span className="w-1.5 h-5 bg-emerald-500 rounded-xs inline-block" />
                  <span className="w-1.5 h-5 bg-amber-500 rounded-xs inline-block" />
                  <span className="w-1.5 h-5 bg-sky-500 rounded-xs inline-block" />
                  <span className="w-1.5 h-5 bg-rose-500 rounded-xs inline-block" />
                </div>
                <span className="text-xl font-black tracking-tight text-slate-800">IT</span>
              </div>

              <div>
                <h1 className="text-lg sm:text-xl font-black tracking-tight">
                  SETA TELECOM LTDA
                </h1>
                <p className="text-xs text-slate-200">
                  CNPJ: 14.806.925/0001-32 • Loja Matriz #118887 • GestãoClick ERP-GROK
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
        <div className="p-8 space-y-6 text-slate-800">
          {/* CLIENT & COMMERCIAL METADATA */}
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
                <strong>Aos cuidados de (Decisor):</strong> {proposal.contactName}
              </div>
            </div>

            <div className="space-y-1 md:border-l md:border-slate-200 md:pl-4">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                <UserCheck className="w-3.5 h-3.5 text-[#1e3a6e]" />
                Responsável Comercial Seta Telecom
              </div>
              <div className="text-sm font-extrabold text-slate-900">{proposal.sellerName}</div>
              <div className="text-xs text-slate-600 flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>
                  Prazo Contratual: <strong>{proposal.contractMonths} meses</strong>
                </span>
              </div>
              <div className="text-xs text-slate-600">
                <strong>Condição de Pagamento:</strong> {proposal.paymentCondition}
              </div>
            </div>
          </div>

          {/* PROPOSAL OBJECT / TITLE */}
          <div className="border-l-4 border-[#1e3a6e] pl-4 py-1">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#1e3a6e]">
              Objeto da Proposta Comercial
            </span>
            <h2 className="text-base sm:text-lg font-black text-slate-900 mt-0.5">
              {proposal.title}
            </h2>
          </div>

          {/* ITEMS TABLE */}
          <div className="border border-slate-300 rounded-lg overflow-hidden">
            <div className="bg-[#1e3a6e] text-white px-4 py-2.5 flex items-center justify-between text-xs font-extrabold">
              <span>ESPECIFICAÇÃO DOS EQUIPAMENTOS, LICENÇAS &amp; SERVIÇOS</span>
              <span>VALORES EM REAIS (BRL)</span>
            </div>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-600 uppercase text-[10px] border-b border-slate-300">
                <tr>
                  <th className="py-2.5 px-3">Código / SKU</th>
                  <th className="py-2.5 px-3">Descrição do Item / Equipamento</th>
                  <th className="py-2.5 px-3">Enquadramento Fiscal</th>
                  <th className="py-2.5 px-3 text-center">Qtd</th>
                  <th className="py-2.5 px-3 text-right">Vlr. Unitário</th>
                  <th className="py-2.5 px-3 text-right">Subtotal Mensal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {proposal.items.map((item, idx) => (
                  <tr key={item.id || idx} className="hover:bg-slate-50/80">
                    <td className="py-3 px-3 font-mono font-bold text-slate-800">
                      {item.sku}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-bold text-slate-900">{item.description}</div>
                      <div className="text-[10px] text-slate-500">
                        Classificação: {item.ncmOrServiceCode} •{' '}
                        {item.isRecurring ? 'Mensal Recorrente' : 'Taxa Única (Setup/Venda)'}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          item.fiscalNature === 'LOCACAO_BENS_MOVEIS'
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-indigo-50 text-indigo-800 border border-indigo-200'
                        }`}
                      >
                        {item.fiscalNature === 'LOCACAO_BENS_MOVEIS'
                          ? 'Locação Pura (0% ISS — SV 31 STF)'
                          : item.fiscalNature === 'SERVICO_TECNICO_TI_TELECOM'
                            ? 'Serviço TI/Telecom (LC 116 01.07)'
                            : 'Equipamento / Telecom'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center font-bold">{item.quantity}</td>
                    <td className="py-3 px-3 text-right font-medium">
                      {formatBRL(item.unitPrice)}
                    </td>
                    <td className="py-3 px-3 text-right font-black text-slate-900">
                      {formatBRL(item.totalMonthly)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* FINANCIAL & TAX SUMMARY */}
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
                    + Taxa Única de Ativação/Frete: <strong>{formatBRL(proposal.oneTimeSetupTotal)}</strong>
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-white/15">
                <span className="text-[10px] uppercase font-bold text-slate-300 block">
                  Valor Global do Contrato ({proposal.contractMonths} meses)
                </span>
                <div className="text-lg font-extrabold text-white">
                  {formatBRL(proposal.totalContractValue)}
                </div>
                <span className="text-[10px] text-emerald-300">
                  {recurringItems.length} item(ns) recorrente(s) • {setupItems.length} setup
                </span>
              </div>
            </div>
          </div>

          {/* TECHNICAL CLAUSES & SLA */}
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
            <div className="font-extrabold text-slate-800 uppercase text-[11px] flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[#1e3a6e]" />
              Condições Técnicas, Remessa CFOP 5.908 &amp; Acordo de Nível de Serviço (SLA)
            </div>
            <p className="text-slate-600 leading-relaxed">{proposal.technicalClauses}</p>
          </div>

          {/* SIGNATURE BLOCK FOR CLIENT ACCEPTANCE */}
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
                  CNPJ {proposal.companyCnpj} • {proposal.contactName} (Assinatura / Carimbo)
                </div>
              </div>
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
