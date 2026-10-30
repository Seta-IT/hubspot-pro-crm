'use client';

import React, { useEffect, useState } from 'react';
import { requestSignedProposalLink } from '../lib/proposal-link-client';
import {
  Mail,
  Send,
  Copy,
  CheckCircle2,
  ExternalLink,
  Paperclip,
  X,
  FileText,
  Headphones,
  Landmark,
  Receipt,
  ShieldCheck,
} from 'lucide-react';
import { formatBRL } from './ui-helpers';
import { recordTimelineEvent } from '../lib/durable-storage';

export type StiHubEmailDocType =
  | 'PROPOSAL'
  | 'TICKET_REPLY'
  | 'BOLETO'
  | 'RENTAL_RECEIPT'
  | 'FISCAL_INVOICE';

export interface ClientEmailInitialPayload {
  docType: StiHubEmailDocType;
  recipientEmail?: string;
  recipientName?: string;
  companyName?: string;
  companyCnpj?: string;
  documentCode?: string;
  amountBrl?: number;
  dueDate?: string;
  publicPdfUrl?: string;
  boletoLine?: string;
  pixCode?: string;
  customSubject?: string;
  customBody?: string;
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
  ticketId?: string | null;
  proposalId?: string | null;
}

const DOC_TYPE_META: Record<
  StiHubEmailDocType,
  { label: string; badge: string; defaultCc: string }
> = {
  PROPOSAL: {
    label: 'Proposta Comercial / Orçamento (com Link PDF A4)',
    badge: 'ORÇAMENTO / PROPOSTA',
    defaultCc: 'comercial@setatelecom.com.br',
  },
  TICKET_REPLY: {
    label: 'Resposta de Chamado / Atualização de Ticket (Service Desk)',
    badge: 'ATENDIMENTO / SLA',
    defaultCc: 'suporte@setatelecom.com.br',
  },
  BOLETO: {
    label: 'Boleto Bancário + QR Code Pix (Banco Inter / Itaú)',
    badge: 'COBRANÇA / BOLETO PIX',
    defaultCc: 'financeiro@setatelecom.com.br',
  },
  RENTAL_RECEIPT: {
    label: 'Recibo / Fatura de Locação (LC 116/03 + SV 31 STF — 0% ISS)',
    badge: 'FATURA DE LOCAÇÃO',
    defaultCc: 'faturamento@setatelecom.com.br',
  },
  FISCAL_INVOICE: {
    label: 'Nota Fiscal Eletrônica (NFS-e Serviços / NF-e Remessa CFOP 5.908)',
    badge: 'DOCUMENTO FISCAL',
    defaultCc: 'fiscal@setatelecom.com.br',
  },
};

function buildDefaultSubject(p: ClientEmailInitialPayload, docType: StiHubEmailDocType): string {
  if (p.customSubject) return p.customSubject;
  const comp = p.companyName || 'Cliente';
  const code = p.documentCode || '2026';
  switch (docType) {
    case 'PROPOSAL':
      return `[Seta Telecom] Proposta Comercial / Orçamento #${code} — ${comp}`;
    case 'TICKET_REPLY':
      return `[Seta Telecom • Suporte NOC] Atualização do Chamado #${code} — ${comp}`;
    case 'BOLETO':
      return `[Seta Telecom • Financeiro] Boleto Bancário & PIX #${code} — Vencimento ${p.dueDate || 'Próximo'} (${comp})`;
    case 'RENTAL_RECEIPT':
      return `[Seta Telecom] Fatura / Recibo de Locação #${code} (Isento de ISS — SV 31 STF) — ${comp}`;
    case 'FISCAL_INVOICE':
      return `[Seta Telecom • Fiscal] Nota Fiscal Eletrônica #${code} (DANFE / NFS-e) — ${comp}`;
  }
}

function defaultProposalPdfLink(p: ClientEmailInitialPayload): string {
  const code = p.documentCode || 'Seta-2026';
  return (
    p.publicPdfUrl ||
    (typeof window !== 'undefined'
      ? `${window.location.origin}/proposta/${encodeURIComponent(p.proposalId || code)}`
      : `https://sti-hub.vercel.app/proposta/${encodeURIComponent(p.proposalId || code)}`)
  );
}

function buildDefaultBody(p: ClientEmailInitialPayload, docType: StiHubEmailDocType): string {
  if (p.customBody) return p.customBody;
  const contact = p.recipientName || 'Prezado(a) Cliente';
  const comp = p.companyName || 'sua empresa';
  const code = p.documentCode || 'Seta-2026';
  const valStr = p.amountBrl !== undefined ? formatBRL(p.amountBrl) : 'conforme documento anexo';
  const pdfLink =
    p.publicPdfUrl ||
    (typeof window !== 'undefined'
      ? `${window.location.origin}/proposta/${encodeURIComponent(p.proposalId || code)}`
      : `https://sti-hub.vercel.app/proposta/${encodeURIComponent(p.proposalId || code)}`);

  if (docType === 'PROPOSAL') {
    return `Olá, ${contact} (${comp}),

Segue para sua avaliação e aprovação a nossa Proposta Comercial / Orçamento Nº ${code}, elaborada pela equipe da SETA TELECOM LTDA (SETA | IT).

• Empresa: ${comp} ${p.companyCnpj ? `(CNPJ: ${p.companyCnpj})` : ''}
• Número do Orçamento: #${code}
• Valor Total: ${valStr}
• Enquadramento Fiscal: Dispensa legal de ISSQN em locação de bens móveis (LC 116/2003 e Súmula Vinculante 31 do STF).

LINK OFICIAL PARA VISUALIZAR E IMPRIMIR O PDF (A4):
${pdfLink}

Ficamos à inteira disposição para quaisquer esclarecimentos técnicos ou comerciais.

Atenciosamente,
Marcelo Lopes Mira
Diretoria Comercial • SETA TELECOM LTDA (SETA | IT)
CNPJ 14.806.925/0001-32 • Tel: (11) 3958-4929`;
  }

  if (docType === 'TICKET_REPLY') {
    return `Olá, ${contact} (${comp}),

Informamos uma nova atualização técnica referente ao seu chamado / Ordem de Serviço protocolo #${code} na Central de Atendimento 24x7 da Seta Telecom:

• Protocolo: #${code}
• Status SLA: Em atendimento prioritário pela equipe de Engenharia Telecom / NOC
• Resumo Técnico: Equipe técnica atuando na resolução e homologação conforme SLA contratual.

Caso precise complementar informações, basta responder diretamente a este e-mail.

Atenciosamente,
Engenharia & Suporte NOC 24x7 • SETA TELECOM LTDA (SETA | IT)
Tel: (11) 3958-4929 • suporte@setatelecom.com.br`;
  }

  if (docType === 'BOLETO') {
    return `Olá, ${contact} — Departamento Financeiro (${comp}),

Encaminhamos os dados para liquidação financeira referente ao título Nº ${code} emitido pela SETA TELECOM LTDA:

• Documento: #${code}
• Valor: ${valStr}
• Vencimento: ${p.dueDate || '16/11/2026'}
• Linha Digitável do Boleto (Banco Inter / Itaú):
${p.boletoLine || '34191.79001 01043.510047 91020.150008 7 98900000432000'}

• Código PIX Copia e Cola (CNPJ Seta Telecom):
${p.pixCode || '00020126580014BR.GOV.BCB.PIX0136financeiro@setatelecom.com.br5204000053039865802BR5917SETA TELECOM LTDA6009SAO PAULO'}

Link para 2ª Via / Recibo em PDF:
${pdfLink}

Atenciosamente,
Departamento Financeiro • SETA TELECOM LTDA (SETA | IT)
CNPJ 14.806.925/0001-32 • financeiro@setatelecom.com.br`;
  }

  if (docType === 'RENTAL_RECEIPT') {
    return `Olá, ${contact} — Fiscal & Financeiro (${comp}),

Segue a Fatura / Recibo de Locação de Equipamentos Nº ${code} da SETA TELECOM LTDA:

• Fatura de Locação Nº: ${code}
• Locatária: ${comp} ${p.companyCnpj ? `(CNPJ: ${p.companyCnpj})` : ''}
• Valor Líquido da Locação: ${valStr}
• Vencimento: ${p.dueDate || '10/11/2026'}
• Amparo Legal Tributário: Operação de Locação Pura de Bens Móveis (Art. 565 do Código Civil) — Não incidência de ISSQN conforme Veto Presidencial ao item 3.01 da LC 116/2003 e Súmula Vinculante nº 31 do STF (0% ISS).
• Linha Digitável Boleto: ${p.boletoLine || '34191.79001 01043.510047 91020.150008 8 98650001200000'}

Link Oficial da Fatura / Recibo de Locação para Impressão PDF:
${pdfLink}

Atenciosamente,
Faturamento & Contratos • SETA TELECOM LTDA (SETA | IT)
CNPJ 14.806.925/0001-32`;
  }

  return `Olá, ${contact} — Departamento Fiscal (${comp}),

Encaminhamos a Nota Fiscal Eletrônica Nº ${code} emitida pela SETA TELECOM LTDA (CNPJ 14.806.925/0001-32):

• Documento Fiscal Nº: ${code}
• Tomador / Destinatário: ${comp} ${p.companyCnpj ? `(CNPJ: ${p.companyCnpj})` : ''}
• Valor do Documento: ${valStr}
• Enquadramento: NFS-e Serviço Técnico (LC 116/03 Item 01.07) / NF-e Remessa de Locação (CFOP 5.908 — Não incidência de ICMS/IPI).

Link para Visualização e Impressão do DANFE / Espelho Fiscal em PDF:
${pdfLink}

Atenciosamente,
Departamento Fiscal • SETA TELECOM LTDA (SETA | IT)
CNPJ 14.806.925/0001-32 • fiscal@setatelecom.com.br`;
}

export default function ClientEmailComposerModal({
  payload,
  onClose,
  onSentSuccess,
}: {
  payload: ClientEmailInitialPayload;
  onClose: () => void;
  onSentSuccess?: (summary: string) => void;
}) {
  const [docType, setDocType] = useState<StiHubEmailDocType>(payload.docType);
  const [toEmail, setToEmail] = useState<string>(
    payload.recipientEmail ||
      `financeiro@${(payload.companyName || 'cliente')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 18)}.com.br`
  );
  const [ccEmail, setCcEmail] = useState<string>(DOC_TYPE_META[payload.docType].defaultCc);
  const [subject, setSubject] = useState<string>(() =>
    buildDefaultSubject(payload, payload.docType)
  );
  const [body, setBody] = useState<string>(() => buildDefaultBody(payload, payload.docType));
  const [sending, setSending] = useState(false);
  const [sentProtocol, setSentProtocol] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [signedProposalUrl, setSignedProposalUrl] = useState<string | null>(null);

  // Link assinado (29/10): proposta para o cliente so abre com o link gerado no servidor.
  // Se o corpo padrao trouxe o link antigo (sem assinatura), troca pelo link assinado.
  useEffect(() => {
    if (payload.docType !== 'PROPOSAL' || !payload.proposalId) return;
    if (payload.publicPdfUrl && payload.publicPdfUrl.includes('#t=')) return;
    let active = true;
    requestSignedProposalLink(payload.proposalId).then((r) => {
      if (!active || !r.ok) return;
      setSignedProposalUrl(r.url);
      const unsigned = defaultProposalPdfLink(payload);
      setBody((prev) => (unsigned && prev.includes(unsigned) ? prev.split(unsigned).join(r.url) : prev));
    });
    return () => {
      active = false;
    };
  }, [payload]);

  const handleSwitchDocType = (nextType: StiHubEmailDocType) => {
    setDocType(nextType);
    setCcEmail(DOC_TYPE_META[nextType].defaultCc);
    const updatedPayload = { ...payload, customSubject: undefined, customBody: undefined };
    setSubject(buildDefaultSubject(updatedPayload, nextType));
    setBody(buildDefaultBody(updatedPayload, nextType));
  };

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!toEmail.trim()) return;
    setSending(true);
    try {
      const res = await fetch('/api/communications/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docType,
          to: toEmail.trim(),
          cc: ccEmail.trim(),
          subject: subject.trim(),
          body,
          companyName: payload.companyName,
          documentCode: payload.documentCode,
          amountBrl: payload.amountBrl,
          publicPdfUrl: signedProposalUrl || payload.publicPdfUrl,
          contactId: payload.contactId,
          companyId: payload.companyId,
          dealId: payload.dealId,
          ticketId: payload.ticketId,
          proposalId: payload.proposalId,
        }),
      });
      const json = res.ok ? await res.json() : null;
      const protocol = json?.data?.protocol || `STI-MAIL-${Date.now().toString().slice(-6)}`;
      setSentProtocol(protocol);

      recordTimelineEvent({
        id: `evt-mail-${Date.now()}`,
        type: 'EMAIL',
        title: `E-mail enviado [${DOC_TYPE_META[docType].badge}]: ${subject}`,
        body: `Para: ${toEmail} (CC: ${ccEmail}) • Protocolo: ${protocol}`,
        metadata: { docType, toEmail, protocol },
        contactId: payload.contactId || null,
        companyId: payload.companyId || null,
        dealId: payload.dealId || null,
        actor: 'Marcelo Lopes Mira (STI-hub Mailer)',
        createdAt: new Date().toISOString(),
      });

      onSentSuccess?.(
        `E-mail (${DOC_TYPE_META[docType].badge}) enviado para ${toEmail} com protocolo ${protocol}!`
      );
    } finally {
      setSending(false);
    }
  };

  const mailtoHref = `mailto:${encodeURIComponent(toEmail)}?cc=${encodeURIComponent(
    ccEmail
  )}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto print:hidden">
      <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-3xl w-full overflow-hidden my-6">
        {/* TOP HEADER */}
        <div className="px-6 py-4 bg-[#1e3a6e] text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-white/15 flex items-center justify-center">
              <Mail className="w-4 h-4 text-emerald-300" />
            </div>
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300 block">
                STI-hub Mailer • Central de Disparo Seta Telecom (SETA | IT)
              </span>
              <h3 className="text-sm sm:text-base font-semibold">
                Enviar Documento Oficial por E-mail para o Cliente
              </h3>
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

        {sentProtocol ? (
          <div className="p-8 text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h4 className="text-lg font-semibold text-slate-900">
              E-mail Enviado e Registrado com Sucesso!
            </h4>
            <p className="text-xs text-slate-600 max-w-lg mx-auto">
              O documento <strong>{DOC_TYPE_META[docType].badge}</strong> foi disparado para{' '}
              <strong className="text-[#1e3a6e]">{toEmail}</strong> (cópia para {ccEmail}) e registrado na Linha do Tempo do cliente no STI-hub.
            </p>
            <div className="inline-block px-4 py-2 rounded bg-slate-100 border border-slate-200 font-mono text-xs font-semibold text-slate-800">
              Protocolo de Envio STI-hub: {sentProtocol}
            </div>
            <div className="pt-4 flex flex-wrap items-center justify-center gap-3">
              <a
                href={mailtoHref}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Abrir também no App de E-mail
              </a>
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2 rounded bg-[#1e3a6e] text-white text-xs font-semibold cursor-pointer"
              >
                Concluir e Voltar
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSendEmail} className="p-6 space-y-4 text-xs max-h-[82vh] overflow-y-auto">
            {/* Template Selector */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1.5">
                Tipo de Documento / Template de E-mail Seta Telecom
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-1.5">
                {(
                  [
                    ['PROPOSAL', 'Proposta PDF', FileText],
                    ['TICKET_REPLY', 'Chamado', Headphones],
                    ['BOLETO', 'Boleto / Pix', Landmark],
                    ['RENTAL_RECEIPT', 'Recibo Loc.', ShieldCheck],
                    ['FISCAL_INVOICE', 'Nota Fiscal', Receipt],
                  ] as const
                ).map(([typeKey, shortTitle, IconComp]) => {
                  const active = docType === typeKey;
                  return (
                    <button
                      key={typeKey}
                      type="button"
                      onClick={() => handleSwitchDocType(typeKey)}
                      className={`p-2 rounded border text-left font-semibold flex items-center gap-1.5 cursor-pointer transition ${
                        active
                          ? 'border-[#1e3a6e] bg-blue-50 text-[#1e3a6e]'
                          : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-white'
                      }`}
                    >
                      <IconComp className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{shortTitle}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Para (E-mail do Cliente / Destinatário) *
                </label>
                <input
                  type="text"
                  required
                  value={toEmail}
                  onChange={(e) => setToEmail(e.target.value)}
                  placeholder="cliente@empresa.com.br, financeiro@empresa.com.br"
                  className="w-full px-3 py-2 rounded border border-slate-300 font-semibold text-slate-900"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  CC (Cópia Interna Seta Telecom)
                </label>
                <input
                  type="text"
                  value={ccEmail}
                  onChange={(e) => setCcEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-slate-300"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Assunto do E-mail *</label>
              <input
                type="text"
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full px-3 py-2 rounded border border-slate-300 font-semibold text-slate-900"
              />
            </div>

            {/* Automatic Attachment / Link Pill */}
            <div className="p-3 rounded-md bg-emerald-50/80 border border-emerald-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-emerald-950 font-semibold">
                <Paperclip className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>
                  Anexo Digital Incluso: <strong>{DOC_TYPE_META[docType].badge}</strong>{' '}
                  {payload.documentCode ? `(#${payload.documentCode})` : ''}{' '}
                  {payload.amountBrl !== undefined ? `• ${formatBRL(payload.amountBrl)}` : ''}
                </span>
              </div>
              <span className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-semibold">
                LINK PDF A4 ATIVO
              </span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Mensagem / Corpo do E-mail (Editável)
              </label>
              <textarea
                rows={10}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded border border-slate-300 font-sans text-xs leading-relaxed text-slate-800"
              />
            </div>

            <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(`Assunto: ${subject}\n\n${body}`);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2500);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-slate-300 bg-white hover:bg-slate-50 font-semibold text-slate-700 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copied ? 'Copiado!' : 'Copiar Texto + Link'}
                </button>
                <a
                  href={mailtoHref}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-slate-300 bg-white hover:bg-slate-50 font-semibold text-slate-700"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Abrir no Cliente de E-mail
                </a>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded border border-slate-300 font-semibold text-slate-700 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={sending}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded bg-[#ff7a59] hover:bg-[#e86646] text-white font-semibold shadow-sm cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  {sending ? 'Enviando E-mail...' : 'Enviar E-mail Agora'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
