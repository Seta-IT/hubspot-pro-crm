'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { InternalProposalSummaryView } from '../../../components/InternalProposalSummaryView';
import type { InternalProposalSummaryModel } from '../../../lib/internal-proposal-summary';

/**
 * Visão interna resumida. O middleware exige sessão antes desta página;
 * sem login o navegador vai para /login?next=... e volta aqui depois.
 */
export default function InternalProposalPage() {
  const params = useParams();
  const rawId = decodeURIComponent(String(params?.id || '')).trim();
  const [model, setModel] = useState<InternalProposalSummaryModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!rawId) {
      setError('Proposta não identificada.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    const next = `/interno/proposta/${encodeURIComponent(rawId)}`;
    fetch(`/api/interno/proposta/${encodeURIComponent(rawId)}`, {
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
          setError(
            res.status === 403
              ? 'Seu perfil não tem permissão para ver esta proposta.'
              : res.status === 404
                ? 'Proposta comercial não encontrada.'
                : 'Não foi possível carregar a visão interna.'
          );
          setLoading(false);
          return;
        }
        setModel(json.data as InternalProposalSummaryModel);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Não foi possível carregar a visão interna.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rawId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f4f6f9] flex items-center justify-center p-6">
        <p className="text-sm font-semibold text-[#1e3a6e]">Carregando orçamento...</p>
      </div>
    );
  }

  if (!model) {
    return (
      <div className="min-h-screen bg-[#f4f6f9] flex items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center">
          <p className="text-sm text-slate-700">{error || 'Proposta comercial não encontrada.'}</p>
          <a href="/" className="mt-4 inline-flex rounded-md bg-[#1e3a6e] px-4 py-2 text-xs font-semibold text-white">
            Voltar ao STI-hub
          </a>
        </div>
      </div>
    );
  }

  return <InternalProposalSummaryView model={model} />;
}
