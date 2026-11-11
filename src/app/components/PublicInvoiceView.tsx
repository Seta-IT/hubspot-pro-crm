'use client';

import React, { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { buildStandaloneInvoiceHtml } from '../lib/contract-billing-utils';
import { publicInvoiceToSheetInvoice, type PublicInvoiceDto } from '../lib/invoice-public-dto';
import { defaultIssuerAddressLine } from '../lib/company-issuer-address';

function PixQr({ code }: { code: string }) {
  const [src, setSrc] = useState<string>('');
  useEffect(() => {
    let active = true;
    import('qrcode')
      .then((QR) => QR.toDataURL(code, { margin: 1, width: 180 }))
      .then((url) => {
        if (active) setSrc(url);
      })
      .catch(() => {
        if (active) setSrc('');
      });
    return () => {
      active = false;
    };
  }, [code]);
  if (!src) return null;
  return <img src={src} alt="QR Code Pix" width={180} height={180} className="border border-slate-200 rounded bg-white" />;
}

export default function PublicInvoiceView({ dto, issuerAddress }: { dto: PublicInvoiceDto; issuerAddress?: string }) {
  const sheet = publicInvoiceToSheetInvoice(dto);
  const html = buildStandaloneInvoiceHtml(sheet, null, {
    templateStyle: 'CLEAN_CORPORATE_LIGHT',
    embedded: true,
    publicClient: true,
    issuerAddress: issuerAddress || dto.issuerAddress || defaultIssuerAddressLine(),
  });
  return (
    <div className="min-h-screen bg-[#f4f6f9] py-6 px-3">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <iframe title="Fatura / Recibo A4" srcDoc={html} className="w-full bg-white block border-0" style={{ height: '78vh' }} />
        </div>
        {dto.attachments.pix && dto.pixCopyPaste && (
          <div className="bg-white rounded-lg border border-slate-200 p-4 flex flex-wrap gap-4 items-start">
            <div className="flex-1 min-w-[200px]">
              <h2 className="text-sm font-semibold text-slate-900">Pix</h2>
              <p className="text-[11px] text-slate-500 mb-1">Copia e cola</p>
              <p className="font-mono text-[11px] text-slate-900 break-all">{dto.pixCopyPaste}</p>
            </div>
            <PixQr code={dto.pixCopyPaste} />
          </div>
        )}
      </div>
    </div>
  );
}

export function PublicDocumentLinkFallback({ loading }: { loading: boolean }) {
  return (
    <div className="min-h-screen bg-[#f4f6f9] flex items-center justify-center p-6">
      <div className="bg-white rounded-lg border border-slate-200 p-8 shadow-sm text-center max-w-lg w-full space-y-3">
        <FileText className="w-10 h-10 text-[#1e3a6e] mx-auto" />
        {loading ? (
          <p className="text-sm text-slate-800">Carregando documento Seta Telecom...</p>
        ) : (
          <>
            <h1 className="text-lg text-slate-900">Link inválido ou expirado</h1>
            <p className="text-xs text-slate-600 leading-relaxed">
              Este link é inválido, expirou ou o documento foi atualizado. Solicite um novo link ao seu consultor Seta Telecom.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
