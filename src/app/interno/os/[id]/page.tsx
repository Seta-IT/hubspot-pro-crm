'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { ServiceOrderDocumentModel } from '../../../../modules/erp/service-order-document';
import { downloadServiceOrderPdfFromModel } from '../../../lib/service-order-pdf-client';

/**
 * Link de acesso da OS. O middleware exige sessao antes desta pagina;
 * sem login o navegador vai para /login?next=... e volta aqui depois.
 */
export default function InternalServiceOrderPage() {
  const params = useParams();
  const rawId = decodeURIComponent(String(params?.id || '')).trim();
  const [doc, setDoc] = useState<{ model: ServiceOrderDocumentModel; fileName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!rawId) {
      setError('Ordem de serviço não identificada.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    const next = `/interno/os/${encodeURIComponent(rawId)}`;
    fetch(`/api/erp/service-orders/${encodeURIComponent(rawId)}/document`, {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'manual',
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401 || res.status === 0 || res.type === 'opaqueredirect') {
          window.location.assign(`/login?next=${encodeURIComponent(next)}`);
          return;
        }
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.data) {
          setError(res.status === 403 ? 'Seu perfil não tem permissão para ver esta OS.' : 'Ordem de serviço não encontrada.');
          setLoading(false);
          return;
        }
        setDoc({ model: json.data as ServiceOrderDocumentModel, fileName: String(json.fileName || 'OS.pdf') });
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Não foi possível carregar a OS.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rawId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f4f6f9] flex items-center justify-center p-6">
        <p className="text-sm font-semibold text-[#1e3a6e]">Carregando ordem de serviço...</p>
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="min-h-screen bg-[#f4f6f9] flex items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center">
          <p className="text-sm text-slate-700">{error || 'Ordem de serviço não encontrada.'}</p>
          <a href="/" className="mt-4 inline-flex rounded-md bg-[#1e3a6e] px-4 py-2 text-xs font-semibold text-white">
            Voltar ao STI-hub
          </a>
        </div>
      </div>
    );
  }

  const m = doc.model;
  const cell = (label: string, value: string) => (
    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-xs font-semibold text-slate-900 whitespace-pre-wrap">{value}</div>
    </div>
  );
  const heading = (title: string) => (
    <h2 className="mt-4 rounded bg-[#1e3a6e] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white">{title}</h2>
  );
  return (
    <div className="min-h-screen bg-[#f4f6f9] p-4 md:p-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-3 flex justify-end gap-2">
          <button
            type="button"
            data-testid="os-baixar-pdf"
            onClick={() => downloadServiceOrderPdfFromModel(m, doc.fileName)}
            className="rounded-md bg-[#1e3a6e] px-4 py-2 text-xs font-semibold text-white cursor-pointer"
          >
            Baixar PDF
          </button>
        </div>
        <article className="rounded-md border border-slate-200 bg-white p-6">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-[#1e3a6e] pb-3">
            <div>
              <div className="text-lg font-semibold text-[#1e3a6e]">SETA TELECOM | STI IT</div>
              <div className="text-xs text-slate-700">{m.issuer.legalName} - CNPJ {m.issuer.cnpj}</div>
              <div className="text-[11px] text-slate-500">{m.issuer.addressLine}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-semibold uppercase text-slate-500">Ordem de serviço</div>
              <div className="text-2xl font-semibold text-[#1e3a6e]">Nº {m.osCode}</div>
            </div>
          </header>
          {heading('Dados do cliente')}
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
            {cell('Cliente', m.customerName)}
            {cell('CNPJ do cliente', m.customerCnpj)}
            {cell('Chamado', m.ticketKey ? `${m.ticketKey}${m.ticketSubject ? ` - ${m.ticketSubject}` : ''}` : 'Não informado')}
          </div>
          {heading('Equipamento e atendimento')}
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
            {cell('Equipamento / modelo', m.equipment)}
            {cell('Nº de série', m.serialNumber)}
            {cell('Situação', m.status)}
            {cell('Técnico responsável', m.technician)}
            {cell('Entrada', m.entryDate)}
            {cell('Finalização', m.resolvedAt)}
          </div>
          {heading('Defeito relatado')}
          <p className="mt-2 whitespace-pre-wrap text-xs text-slate-800">{m.reportedDefect}</p>
          {heading('Interações')}
          <ul className="mt-2 space-y-2">
            {m.interactions.length === 0 && <li className="text-xs text-slate-500">Sem interações registradas.</li>}
            {m.interactions.map((it, i) => (
              <li key={i} className="border-b border-slate-100 pb-2">
                <div className="text-[11px] font-semibold text-[#1e3a6e]">
                  {it.at} - {it.author}
                </div>
                <div className="whitespace-pre-wrap text-xs text-slate-800">{it.text}</div>
              </li>
            ))}
          </ul>
          {heading('Solução validada')}
          <p className="mt-2 whitespace-pre-wrap text-xs text-slate-800">{m.validatedSolution}</p>
        </article>
      </div>
    </div>
  );
}
