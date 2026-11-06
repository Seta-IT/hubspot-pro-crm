'use client';

// t33u: short link opaco do cliente: /p/<codigo>. O servidor (GET /api/p/<codigo>) valida o
// codigo (existencia, expiracao, revogacao, rate limit) e devolve o id e o token assinado.
// Correcao comercial incrementa a versao interna e NAO invalida o codigo: a folha A4 (a mesma
// de /proposta/[id]) mostra a proposta atual.
import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { FileText } from 'lucide-react';
import { ProposalLinkOverrideContext, type ProposalLinkOverride } from '../../lib/proposal-link-override';
import PublicProposalPrintPage from '../../proposta/[id]/page';

export default function ProposalShortLinkPage() {
  const params = useParams<{ code: string }>();
  const code = String(params?.code || '').trim();
  const [override, setOverride] = useState<ProposalLinkOverride>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'invalid'>('loading');

  useEffect(() => {
    let active = true;
    if (!/^[A-Za-z0-9]{10}$/.test(code)) {
      setState('invalid');
      return;
    }
    fetch(`/api/p/${encodeURIComponent(code)}`, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then(async (r) => ({ ok: r.ok, json: await r.json().catch(() => null) }))
      .then(({ ok, json }) => {
        if (!active) return;
        const proposalId = typeof json?.proposalId === 'string' ? json.proposalId : '';
        const token = typeof json?.token === 'string' ? json.token : '';
        if (ok && proposalId && token) {
          setOverride({ proposalId, token });
          setState('ok');
        } else {
          setState('invalid');
        }
      })
      .catch(() => {
        if (active) setState('invalid');
      });
    return () => {
      active = false;
    };
  }, [code]);

  if (state === 'ok' && override) {
    return (
      <ProposalLinkOverrideContext.Provider value={override}>
        <PublicProposalPrintPage />
      </ProposalLinkOverrideContext.Provider>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f6f9] flex items-center justify-center p-6">
      <div className="bg-white rounded-lg border border-slate-200 p-8 shadow-sm text-center max-w-lg w-full space-y-3">
        <FileText className="w-10 h-10 text-[#1e3a6e] mx-auto" />
        {state === 'loading' ? (
          <p className="text-sm text-slate-800">Carregando Proposta Comercial Seta Telecom...</p>
        ) : (
          <>
            <h1 className="text-lg text-slate-900">Link de proposta inválido ou expirado</h1>
            <p className="text-xs text-slate-600 leading-relaxed">
              Este link é inválido ou expirou. Solicite um novo link ao seu consultor Seta Telecom.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
