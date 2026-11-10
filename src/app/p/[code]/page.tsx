'use client';

// t33u / t200u: short link opaco /p/<codigo> para proposta ou fatura emitida.
import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ProposalLinkOverrideContext, type ProposalLinkOverride } from '../../lib/proposal-link-override';
import PublicProposalPrintPage from '../../proposta/[id]/page';
import PublicInvoiceView, { PublicDocumentLinkFallback } from '../../components/PublicInvoiceView';
import type { PublicInvoiceDto } from '../../lib/invoice-public-dto';

export default function PublicShortLinkPage() {
  const params = useParams<{ code: string }>();
  const code = String(params?.code || '').trim();
  const [override, setOverride] = useState<ProposalLinkOverride>(null);
  const [invoice, setInvoice] = useState<{ dto: PublicInvoiceDto; issuerAddress?: string } | null>(null);
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
        if (ok && json?.kind === 'invoice' && json?.data) {
          setInvoice({ dto: json.data as PublicInvoiceDto, issuerAddress: json.issuerAddress });
          setState('ok');
          return;
        }
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

  if (state === 'ok' && invoice) {
    return <PublicInvoiceView dto={invoice.dto} issuerAddress={invoice.issuerAddress} />;
  }
  if (state === 'ok' && override) {
    return (
      <ProposalLinkOverrideContext.Provider value={override}>
        <PublicProposalPrintPage />
      </ProposalLinkOverrideContext.Provider>
    );
  }
  return <PublicDocumentLinkFallback loading={state === 'loading'} />;
}
