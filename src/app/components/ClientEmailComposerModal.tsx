'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { buildClientEmailGreeting } from '../lib/client-email-greeting';
import { proposalEmailLinkGate, requestSignedProposalLink, type SignedLinkState } from '../lib/proposal-link-client';
import { requestSignedInvoiceLink } from '../lib/invoice-link-client';
import { buildContractEmailBody, buildContractEmailSubject } from '../lib/contract-email-payload';
import {
  defaultSelectedInvoiceAttachments,
  type InvoiceSendAttachmentAvailability,
  type InvoiceSendAttachmentKind,
} from '../../modules/erp/invoice-send-attachments';
import {
  CONTRACT_EMAIL_ATTACHMENT_KINDS,
  CONTRACT_EMAIL_ATTACHMENT_LABELS,
  contractEmailNeedsInvoice,
  contractEmailWantsProposalLink,
  defaultSelectedContractAttachments,
  resolveContractEmailAttachments,
  selectedInvoiceAttachmentKinds,
  type ContractAttachmentState,
  type ContractEmailInvoiceChoice,
} from '../../modules/erp/contract-email-compose';
import {
  joinRecipientList,
  parseRecipientList,
  type EmailRecipientChip,
} from '../../modules/erp/email-recipients';
import EmailRecipientField from './email/EmailRecipientField';
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
  AlertTriangle,
} from 'lucide-react';
import { formatBRL } from './ui-helpers';
import { recordTimelineEvent } from '../lib/durable-storage';
import { redactProposalLinkTokens } from '../lib/proposal-link-redact';

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
  invoiceId?: string | null;
  remessaNfeNumber?: string;
  remessaAccessKey?: string;
  invoiceAttachments?: InvoiceSendAttachmentAvailability;
  receiptHtml?: string;
  remessaXml?: string;
  contractId?: string | null;
  contractNumber?: string | null;
  invoiceChoices?: ContractEmailInvoiceChoice[];
}

const DOC_TYPE_META: Record<
  StiHubEmailDocType,
  { label: string; badge: string; defaultCc: string }
> = {
  PROPOSAL: {
    label: 'Proposta / Orçamento',
    badge: 'Proposta',
    defaultCc: 'comercial@setatelecom.com.br',
  },
  TICKET_REPLY: {
    label: 'Resposta de chamado',
    badge: 'Chamado',
    defaultCc: 'suporte@setatelecom.com.br',
  },
  BOLETO: {
    label: 'Boleto e Pix',
    badge: 'Cobrança',
    defaultCc: 'financeiro@setatelecom.com.br',
  },
  RENTAL_RECEIPT: {
    label: 'Recibo de locação',
    badge: 'Recibo',
    defaultCc: 'faturamento@setatelecom.com.br',
  },
  FISCAL_INVOICE: {
    label: 'Nota fiscal',
    badge: 'Nota fiscal',
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
  const pdfLink = p.invoiceId
    ? (p.publicPdfUrl || '')
    : (p.publicPdfUrl ||
      (typeof window !== 'undefined'
        ? `${window.location.origin}/proposta/${encodeURIComponent(p.proposalId || code)}`
        : `https://sti-hub.vercel.app/proposta/${encodeURIComponent(p.proposalId || code)}`));
  const greeting = buildClientEmailGreeting(p);

  if (docType === 'PROPOSAL') {
    return `${greeting}

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
    return `${greeting}

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
${p.invoiceId
    ? (p.boletoLine ? `• Linha Digitável do Boleto:
${p.boletoLine}
` : '')
    : `• Linha Digitável do Boleto (Banco Inter / Itaú):
${p.boletoLine || '34191.79001 01043.510047 91020.150008 7 98900000432000'}
`}
${p.invoiceId
    ? (p.pixCode ? `• Código PIX Copia e Cola:
${p.pixCode}
` : '')
    : `• Código PIX Copia e Cola (CNPJ Seta Telecom):
${p.pixCode || '00020126580014BR.GOV.BCB.PIX0136financeiro@setatelecom.com.br5204000053039865802BR5917SETA TELECOM LTDA6009SAO PAULO'}
`}
${p.invoiceId ? (pdfLink ? `Link da fatura para o cliente:
${pdfLink}` : 'Link da fatura para o cliente:') : `Link para 2ª Via / Recibo em PDF:
${pdfLink}`}

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
${p.invoiceId ? '' : `• Linha Digitável Boleto: ${p.boletoLine || '34191.79001 01043.510047 91020.150008 8 98650001200000'}
`}
${p.invoiceId ? (pdfLink ? `Link da fatura / recibo para o cliente:
${pdfLink}` : 'Link da fatura / recibo para o cliente:') : `Link Oficial da Fatura / Recibo de Locação para Impressão PDF:
${pdfLink}`}

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

${p.invoiceId ? (pdfLink ? `Link da fatura para o cliente:
${pdfLink}` : 'Link da fatura para o cliente:') : `Link para Visualização e Impressão do DANFE / Espelho Fiscal em PDF:
${pdfLink}`}

Atenciosamente,
Departamento Fiscal • SETA TELECOM LTDA (SETA | IT)
CNPJ 14.806.925/0001-32 • fiscal@setatelecom.com.br`;
}

function initialContractAttach(payload: ClientEmailInitialPayload): ContractAttachmentState {
  const latest = payload.invoiceChoices?.[0];
  const resolved = resolveContractEmailAttachments({
    proposalId: payload.proposalId,
    invoice: latest || payload.invoiceId
      ? {
          boletoDigitableLine: latest?.boletoLine || payload.boletoLine,
          pixCopyPaste: latest?.pixCode || payload.pixCode,
          remessaNfeNumber: latest?.remessaNfeNumber || payload.remessaNfeNumber,
          remessaNfeKey: latest?.remessaAccessKey || payload.remessaAccessKey,
          rentalContractId: payload.contractId,
          contractNumber: payload.contractNumber,
        }
      : null,
    remessaDocs: [],
  });
  if (payload.invoiceAttachments) {
    resolved.options.receipt.available = payload.invoiceAttachments.receipt.available;
    resolved.options.boleto.available = payload.invoiceAttachments.boleto.available;
    resolved.options.pix.available = payload.invoiceAttachments.pix.available;
    resolved.options.remessa.available = payload.invoiceAttachments.remessa.available;
    resolved.options.boleto.reason = payload.invoiceAttachments.boleto.available ? '' : (payload.invoiceId ? 'Sem linha digitável' : 'Sem fatura emitida');
    resolved.options.pix.reason = payload.invoiceAttachments.pix.available ? '' : (payload.invoiceId ? 'Sem código Pix' : 'Sem fatura emitida');
    resolved.options.remessa.reason = payload.invoiceAttachments.remessa.available ? '' : 'Sem NF/XML/DANFE';
    resolved.options.receipt.reason = payload.invoiceAttachments.receipt.available ? '' : 'Sem fatura emitida';
  }
  return defaultSelectedContractAttachments(resolved.options);
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
  const isContractSend = Boolean(payload.contractId);
  const [docType, setDocType] = useState<StiHubEmailDocType>(payload.docType);
  const [toChips, setToChips] = useState<EmailRecipientChip[]>(() => parseRecipientList(payload.recipientEmail));
  const [ccChips, setCcChips] = useState<EmailRecipientChip[]>(() =>
    parseRecipientList(DOC_TYPE_META[payload.docType].defaultCc)
  );
  const [bccChips, setBccChips] = useState<EmailRecipientChip[]>([]);
  const [subject, setSubject] = useState<string>(() =>
    buildDefaultSubject(payload, payload.docType)
  );
  const [body, setBody] = useState<string>(() => buildDefaultBody(payload, payload.docType));
  const [subjectDirty, setSubjectDirty] = useState(false);
  const [bodyDirty, setBodyDirty] = useState(false);
  const invoiceAvailInitial = payload.invoiceAttachments;
  const isInvoiceSend = Boolean(payload.invoiceId && invoiceAvailInitial) && !isContractSend;
  const [selectedAttach, setSelectedAttach] = useState<Record<InvoiceSendAttachmentKind, boolean>>(() =>
    invoiceAvailInitial ? defaultSelectedInvoiceAttachments(invoiceAvailInitial) : { receipt: true, remessa: false, boleto: false, pix: false }
  );
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>(payload.invoiceId || payload.invoiceChoices?.[0]?.id || '');
  const [selectedContractAttach, setSelectedContractAttach] = useState<ContractAttachmentState>(() =>
    initialContractAttach(payload)
  );
  const selectedChoice = (payload.invoiceChoices || []).find((c) => c.id === selectedInvoiceId) || payload.invoiceChoices?.[0];
  const contractResolved = resolveContractEmailAttachments({
    proposalId: payload.proposalId,
    invoice: selectedChoice || payload.invoiceId
      ? {
          boletoDigitableLine: selectedChoice?.boletoLine || payload.boletoLine,
          pixCopyPaste: selectedChoice?.pixCode || payload.pixCode,
          remessaNfeNumber: selectedChoice?.remessaNfeNumber || payload.remessaNfeNumber,
          remessaNfeKey: selectedChoice?.remessaAccessKey || payload.remessaAccessKey,
          rentalContractId: payload.contractId,
          contractNumber: payload.contractNumber,
        }
      : null,
  });
  if (selectedChoice?.invoiceAttachments) {
    contractResolved.options.receipt.available = selectedChoice.invoiceAttachments.receipt.available;
    contractResolved.options.boleto.available = selectedChoice.invoiceAttachments.boleto.available;
    contractResolved.options.pix.available = selectedChoice.invoiceAttachments.pix.available;
    contractResolved.options.remessa.available = selectedChoice.invoiceAttachments.remessa.available;
    contractResolved.options.boleto.reason = selectedChoice.invoiceAttachments.boleto.available ? '' : 'Sem linha digitável';
    contractResolved.options.pix.reason = selectedChoice.invoiceAttachments.pix.available ? '' : 'Sem código Pix';
    contractResolved.options.remessa.reason = selectedChoice.invoiceAttachments.remessa.available ? '' : 'Sem NF/XML/DANFE';
    contractResolved.options.receipt.reason = selectedChoice.invoiceAttachments.receipt.available ? '' : 'Sem fatura emitida';
  }
  const contractOptions = contractResolved.options;
  const invoiceAvail = isInvoiceSend ? invoiceAvailInitial : selectedChoice?.invoiceAttachments || invoiceAvailInitial;
  const [signedInvoiceUrl, setSignedInvoiceUrl] = useState<string | null>(payload.publicPdfUrl || null);
  const [pixQrSrc, setPixQrSrc] = useState<string>('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentProtocol, setSentProtocol] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [signedProposalUrl, setSignedProposalUrl] = useState<string | null>(null);
  const alreadySigned = Boolean(payload.publicPdfUrl && payload.publicPdfUrl.includes('#t='));
  const wantsProposal = isContractSend
    ? contractEmailWantsProposalLink(selectedContractAttach, payload.proposalId)
    : docType === 'PROPOSAL';
  const [signedLink, setSignedLink] = useState<SignedLinkState>(() =>
    alreadySigned || (isContractSend && !payload.proposalId) ? { status: 'not-needed' } : wantsProposal ? { status: 'loading' } : { status: 'not-needed' }
  );
  const [linkAttempt, setLinkAttempt] = useState(0);
  const [gateError, setGateError] = useState<string | null>(null);

  const toEmail = joinRecipientList(toChips);
  const ccEmail = joinRecipientList(ccChips);
  const bccEmail = joinRecipientList(bccChips);

  // Link assinado (29/10): proposta para o cliente so abre com o link gerado no servidor.
  // Se o corpo padrao trouxe o link antigo (sem assinatura), troca pelo link assinado.
  // Checagem final v4: se a emissao falhar, o compositor mostra o erro e bloqueia o envio.
  useEffect(() => {
    if (!wantsProposal || alreadySigned) {
      if (!wantsProposal) setSignedLink({ status: 'not-needed' });
      return;
    }
    if (!payload.proposalId) {
      setSignedLink({ status: 'not-needed' });
      return;
    }
    let active = true;
    setSignedLink({ status: 'loading' });
    requestSignedProposalLink(payload.proposalId || '').then((r) => {
      if (!active) return;
      if (!r.ok) {
        setSignedLink({ status: 'error', error: r.error });
        return;
      }
      setSignedProposalUrl(r.url);
      setSignedLink({ status: 'ok', url: r.url });
      setGateError(null);
      const unsigned = defaultProposalPdfLink(payload);
      setBody((prev) => (unsigned && prev.includes(unsigned) ? prev.split(unsigned).join(r.url) : prev));
    });
    return () => {
      active = false;
    };
  }, [payload, wantsProposal, alreadySigned, linkAttempt]);

  const activeInvoiceId = isContractSend ? selectedInvoiceId : payload.invoiceId;

  useEffect(() => {
    if (!activeInvoiceId) return;
    let active = true;
    requestSignedInvoiceLink(activeInvoiceId).then((r) => {
      if (!active) return;
      if (!r.ok) return;
      setSignedInvoiceUrl(r.url);
      setBody((prev) => {
        if (prev.includes(r.url)) return prev;
        if (prev.includes('Link da fatura / recibo para o cliente:')) {
          return prev.replace('Link da fatura / recibo para o cliente:', `Link da fatura / recibo para o cliente:\n${r.url}`);
        }
        if (prev.includes('Link da fatura para o cliente:')) {
          return prev.replace('Link da fatura para o cliente:', `Link da fatura para o cliente:\n${r.url}`);
        }
        return `${prev}\n\nLink da fatura para o cliente:\n${r.url}`;
      });
    });
    return () => {
      active = false;
    };
  }, [activeInvoiceId]);

  useEffect(() => {
    if (!isContractSend || subjectDirty && bodyDirty) return;
    const nextSubject = buildContractEmailSubject({
      contractNumber: payload.contractNumber || payload.documentCode,
      companyName: payload.companyName,
      selected: selectedContractAttach,
    });
    const nextBody = buildContractEmailBody({
      recipientName: payload.recipientName,
      companyName: payload.companyName,
      companyCnpj: payload.companyCnpj,
      contractNumber: payload.contractNumber || payload.documentCode,
      amountLabel: payload.amountBrl !== undefined ? formatBRL(payload.amountBrl) : undefined,
      dueDate: payload.dueDate,
      selected: selectedContractAttach,
      invoiceCode: selectedChoice?.documentNumber,
      invoiceUrl: signedInvoiceUrl || undefined,
      proposalUrl: signedProposalUrl || undefined,
      boletoLine: selectedChoice?.boletoLine || payload.boletoLine,
      pixCode: selectedChoice?.pixCode || payload.pixCode,
      remessaNumber: selectedChoice?.remessaNfeNumber || payload.remessaNfeNumber,
      remessaKey: selectedChoice?.remessaAccessKey || payload.remessaAccessKey,
    });
    if (!subjectDirty) setSubject(nextSubject);
    if (!bodyDirty) setBody(nextBody);
  }, [
    isContractSend,
    selectedContractAttach,
    selectedChoice,
    signedInvoiceUrl,
    signedProposalUrl,
    payload,
    subjectDirty,
    bodyDirty,
  ]);

  const selectedPixCode = (isInvoiceSend || isContractSend) && invoiceAvail?.pix.available
    && ((isContractSend && selectedContractAttach.pix) || (isInvoiceSend && selectedAttach.pix))
    ? invoiceAvail.pix.code
    : '';
  useEffect(() => {
    if (!selectedPixCode) {
      setPixQrSrc('');
      return;
    }
    let active = true;
    import('qrcode')
      .then((QR) => QR.toDataURL(selectedPixCode, { margin: 1, width: 180 }))
      .then((url) => {
        if (active) setPixQrSrc(url);
      })
      .catch(() => {
        if (active) setPixQrSrc('');
      });
    return () => {
      active = false;
    };
  }, [selectedPixCode]);

  const linkGate = proposalEmailLinkGate({
    isProposal: wantsProposal,
    state: signedLink,
    body,
    unsignedUrl: alreadySigned ? undefined : defaultProposalPdfLink(payload),
  });

  const handleSwitchDocType = (nextType: StiHubEmailDocType) => {
    setDocType(nextType);
    setCcChips(parseRecipientList(DOC_TYPE_META[nextType].defaultCc));
    const updatedPayload = { ...payload, customSubject: undefined, customBody: undefined };
    setSubject(buildDefaultSubject(updatedPayload, nextType));
    const nextBody = buildDefaultBody(updatedPayload, nextType);
    const unsigned = defaultProposalPdfLink(payload);
    setBody(signedProposalUrl && unsigned && nextBody.includes(unsigned) ? nextBody.split(unsigned).join(signedProposalUrl) : nextBody);
    setSubjectDirty(false);
    setBodyDirty(false);
  };

  const outgoingText = useMemo(() => {
    let text = body;
    const avail = invoiceAvail;
    const attach = isContractSend ? selectedContractAttach : selectedAttach;
    if ((isInvoiceSend || isContractSend) && avail) {
      if (attach.boleto && avail.boleto.available && avail.boleto.line && !text.includes(avail.boleto.line)) {
        text += `\n\nLinha digitável do boleto:\n${avail.boleto.line}`;
      }
      if (attach.pix && avail.pix.available && avail.pix.code && !text.includes(avail.pix.code)) {
        text += `\n\nCódigo Pix (copia e cola):\n${avail.pix.code}`;
      }
      if (attach.remessa && avail.remessa.available) {
        const bits = [
          avail.remessa.number ? `Número: ${avail.remessa.number}` : '',
          avail.remessa.accessKey ? `Chave de acesso: ${avail.remessa.accessKey}` : '',
        ].filter(Boolean);
        if (bits.length && !bits.some((b) => text.includes(b))) {
          text += `\n\nNF-e de remessa:\n${bits.join('\n')}`;
        }
      }
    }
    return text;
  }, [body, isInvoiceSend, isContractSend, invoiceAvail, selectedAttach, selectedContractAttach]);

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!toEmail.trim()) {
      setSendError('Informe pelo menos um destinatário válido.');
      return;
    }
    if ([...toChips, ...ccChips, ...bccChips].some((chip) => chip.invalid)) {
      setSendError('Há destinatários com e-mail inválido.');
      return;
    }
    if (!linkGate.ok) {
      setGateError(linkGate.error);
      return;
    }
    setSending(true);
    try {
      const sendInvoiceId = isContractSend
        ? (contractEmailNeedsInvoice(selectedContractAttach) ? selectedInvoiceId : '')
        : payload.invoiceId;
      const selectedAttachments = isContractSend
        ? selectedInvoiceAttachmentKinds(selectedContractAttach)
        : isInvoiceSend
          ? (Object.keys(selectedAttach) as Array<keyof typeof selectedAttach>).filter((k) => selectedAttach[k])
          : undefined;
      const res = await fetch('/api/communications/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docType,
          to: toEmail.trim(),
          cc: ccEmail.trim(),
          bcc: bccEmail.trim() || undefined,
          subject: subject.trim(),
          body: outgoingText,
          companyName: payload.companyName,
          documentCode: payload.documentCode,
          amountBrl: payload.amountBrl,
          publicPdfUrl: signedInvoiceUrl || signedProposalUrl || payload.publicPdfUrl,
          contactId: payload.contactId,
          companyId: payload.companyId,
          dealId: payload.dealId,
          ticketId: payload.ticketId,
          proposalId: payload.proposalId,
          invoiceId: sendInvoiceId || undefined,
          contractId: isContractSend ? payload.contractId || undefined : undefined,
          selectedAttachments,
        }),
      });
      if (!res.ok) {
        // CISO 04/11: falha real de envio nao vira "enviado" (nada e registrado).
        let msg = 'Não foi possível enviar o e-mail. Tente novamente.';
        try {
          const j = await res.json();
          if (j?.error) msg = String(j.error);
        } catch {}
        setSendError(msg);
        return;
      }
      setSendError(null);
      const json = await res.json();
      const protocol = json?.data?.protocol || `STI-MAIL-${Date.now().toString().slice(-6)}`;
      setSentProtocol(protocol);

      recordTimelineEvent({
        id: `evt-mail-${Date.now()}`,
        type: 'EMAIL',
        // A1: o historico local (journal) nunca guarda o token do link assinado.
        title: redactProposalLinkTokens(`E-mail enviado [${DOC_TYPE_META[docType].badge}]: ${subject}`),
        body: `Para: ${toEmail}${ccEmail ? ` (CC: ${ccEmail})` : ''} • Protocolo: ${protocol}`,
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
  )}${bccEmail.trim() ? `&bcc=${encodeURIComponent(bccEmail.trim())}` : ''}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(outgoingText)}`;

  const toggleContractAttach = (kind: keyof ContractAttachmentState, available: boolean, checked: boolean) => {
    if (!available) return;
    setSelectedContractAttach((prev) => ({ ...prev, [kind]: checked }));
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto print:hidden">
      <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-3xl w-full overflow-hidden my-6">
        <div className="px-6 py-4 bg-[#1e3a6e] text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-white/15 flex items-center justify-center">
              <Mail className="w-4 h-4 text-emerald-300" />
            </div>
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300 block">
                E-mail
              </span>
              <h3 className="text-sm sm:text-base font-semibold">
                Enviar por e-mail
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
              E-mail enviado
            </h4>
            <p className="text-xs text-slate-600 max-w-lg mx-auto">
              O documento <strong>{DOC_TYPE_META[docType].badge}</strong> foi disparado para{' '}
              <strong className="text-[#1e3a6e]">{toEmail}</strong>{ccEmail ? <> (cópia para {ccEmail})</> : null} e registrado na Linha do Tempo do cliente no STI-hub.
            </p>
            <div className="inline-block px-4 py-2 rounded bg-slate-100 border border-slate-200 font-mono text-xs font-semibold text-slate-800">
              Protocolo: {sentProtocol}
            </div>
            <div className="pt-4 flex flex-wrap items-center justify-center gap-3">
              <a
                href={mailtoHref}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Abrir no app de e-mail
              </a>
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2 rounded bg-[#1e3a6e] text-white text-xs font-semibold cursor-pointer"
              >
                Concluir
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSendEmail} className="p-6 space-y-4 text-xs max-h-[82vh] overflow-y-auto">
            {!isContractSend && (
            <div>
              <label className="block font-semibold text-slate-700 mb-1.5">
                Tipo de e-mail
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
            )}

            <div className="rounded-md border border-slate-200 px-3 py-1">
              <EmailRecipientField
                label="Para"
                testId="email-recipient-to"
                chips={toChips}
                onChange={setToChips}
                companyId={payload.companyId}
                siblingCount={ccChips.length + bccChips.length}
                placeholder="Nome ou e-mail"
              />
              <EmailRecipientField
                label="Cc"
                testId="email-recipient-cc"
                chips={ccChips}
                onChange={setCcChips}
                companyId={payload.companyId}
                siblingCount={toChips.length + bccChips.length}
              />
              <EmailRecipientField
                label="Cco"
                testId="email-recipient-bcc"
                chips={bccChips}
                onChange={setBccChips}
                companyId={payload.companyId}
                siblingCount={toChips.length + ccChips.length}
              />
              <div className="flex items-center gap-2 py-1.5">
                <span className="w-16 shrink-0 text-xs font-semibold text-slate-500">Assunto</span>
                <input
                  type="text"
                  required
                  value={subject}
                  onChange={(e) => {
                    setSubjectDirty(true);
                    setSubject(e.target.value);
                  }}
                  className="w-full outline-none bg-transparent font-semibold text-slate-900 py-1"
                />
              </div>
            </div>

            {isContractSend ? (
              <div data-testid="contract-send-attachments" className="p-3 rounded-md border border-slate-200 bg-slate-50 space-y-2">
                <div className="flex items-center gap-2 text-slate-800 font-semibold">
                  <Paperclip className="w-4 h-4 text-[#1e3a6e] shrink-0" />
                  Anexos
                </div>
                {(payload.invoiceChoices || []).length > 1 && (
                  <label className="block">
                    <span className="block font-semibold text-slate-700 mb-1">Fatura / competência</span>
                    <select
                      data-testid="contract-email-invoice-select"
                      value={selectedInvoiceId}
                      onChange={(e) => {
                        const nextId = e.target.value;
                        setSelectedInvoiceId(nextId);
                        const nextChoice = (payload.invoiceChoices || []).find((c) => c.id === nextId);
                        if (!nextChoice) return;
                        setSelectedContractAttach((prev) => ({
                          ...prev,
                          receipt: nextChoice.invoiceAttachments.receipt.available && prev.receipt,
                          boleto: nextChoice.invoiceAttachments.boleto.available && prev.boleto,
                          pix: nextChoice.invoiceAttachments.pix.available && prev.pix,
                          remessa: nextChoice.invoiceAttachments.remessa.available && prev.remessa,
                        }));
                        setSignedInvoiceUrl(null);
                      }}
                      className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-semibold text-slate-800"
                    >
                      {(payload.invoiceChoices || []).map((choice) => (
                        <option key={choice.id} value={choice.id}>{choice.label}</option>
                      ))}
                    </select>
                  </label>
                )}
                {CONTRACT_EMAIL_ATTACHMENT_KINDS.map((kind) => {
                  const opt = contractOptions[kind];
                  return (
                    <label
                      key={kind}
                      className={`flex items-center gap-2 text-xs font-semibold ${opt.available ? 'text-slate-800 cursor-pointer' : 'text-slate-400 cursor-not-allowed'}`}
                    >
                      <input
                        type="checkbox"
                        className="rounded border-slate-300"
                        disabled={!opt.available}
                        checked={opt.available && selectedContractAttach[kind]}
                        onChange={(e) => toggleContractAttach(kind, opt.available, e.target.checked)}
                      />
                      <span>{CONTRACT_EMAIL_ATTACHMENT_LABELS[kind]}</span>
                      {!opt.available && opt.reason ? (
                        <span className="text-[11px] font-semibold text-slate-400">{opt.reason}</span>
                      ) : null}
                    </label>
                  );
                })}
                {selectedContractAttach.pix && pixQrSrc && invoiceAvail?.pix.available && (
                  <div className="pt-1 flex items-start gap-3">
                    <img src={pixQrSrc} alt="QR Code Pix" width={120} height={120} className="border border-slate-200 rounded bg-white" />
                    <p className="font-mono text-[10px] text-slate-700 break-all">{invoiceAvail.pix.code}</p>
                  </div>
                )}
              </div>
            ) : isInvoiceSend && invoiceAvail ? (
              <div data-testid="invoice-send-attachments" className="p-3 rounded-md border border-slate-200 bg-slate-50 space-y-2">
                <div className="flex items-center gap-2 text-slate-800 font-semibold">
                  <Paperclip className="w-4 h-4 text-[#1e3a6e] shrink-0" />
                  Anexos e dados da fatura
                </div>
                {([
                  { kind: 'receipt' as const, label: 'Recibo (PDF)', available: invoiceAvail.receipt.available },
                  { kind: 'remessa' as const, label: 'NF de remessa (DANFE/XML)', available: invoiceAvail.remessa.available },
                  { kind: 'boleto' as const, label: 'Boleto (PDF e linha digitável)', available: invoiceAvail.boleto.available },
                  { kind: 'pix' as const, label: 'Código Pix (copia e cola e QR)', available: invoiceAvail.pix.available },
                ]).map((opt) => (
                  <label
                    key={opt.kind}
                    className={`flex items-center gap-2 text-xs font-semibold ${opt.available ? 'text-slate-800 cursor-pointer' : 'text-slate-400 cursor-not-allowed'}`}
                  >
                    <input
                      type="checkbox"
                      className="rounded border-slate-300"
                      disabled={!opt.available}
                      checked={opt.available && selectedAttach[opt.kind]}
                      onChange={(e) => setSelectedAttach((prev) => ({ ...prev, [opt.kind]: e.target.checked }))}
                    />
                    <span>{opt.label}</span>
                    {!opt.available && <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Indisponível</span>}
                  </label>
                ))}
                {selectedAttach.pix && pixQrSrc && (
                  <div className="pt-1 flex items-start gap-3">
                    <img src={pixQrSrc} alt="QR Code Pix" width={120} height={120} className="border border-slate-200 rounded bg-white" />
                    <p className="font-mono text-[10px] text-slate-700 break-all">{invoiceAvail.pix.code}</p>
                  </div>
                )}
              </div>
            ) : (
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
            )}

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Mensagem
              </label>
              <textarea
                rows={10}
                value={body}
                onChange={(e) => {
                  setBodyDirty(true);
                  setBody(e.target.value);
                }}
                className="w-full px-3.5 py-2.5 rounded border border-slate-300 font-sans text-xs leading-relaxed text-slate-800"
              />
            </div>

            {wantsProposal && signedLink.status === 'loading' && (
              <div role="status" className="p-2.5 rounded border border-slate-200 bg-slate-50 text-slate-700">
                Gerando o link assinado da proposta para o cliente…
              </div>
            )}
            {wantsProposal && (signedLink.status === 'error' || gateError) && !linkGate.ok && (
              <div role="alert" className="p-3 rounded border border-red-300 bg-red-50 text-red-800 flex items-start justify-between gap-3">
                <span className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{gateError || linkGate.error}</span>
                </span>
                {signedLink.status === 'error' && (
                  <button
                    type="button"
                    onClick={() => { setGateError(null); setLinkAttempt((n) => n + 1); }}
                    className="px-3 py-1.5 rounded border border-red-300 bg-white text-red-800 font-semibold cursor-pointer shrink-0"
                  >
                    Tentar de novo
                  </button>
                )}
              </div>
            )}

            <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!linkGate.ok}
                  title={linkGate.ok ? undefined : linkGate.error}
                  onClick={() => {
                    if (!linkGate.ok) {
                      setGateError(linkGate.error);
                      return;
                    }
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
                  href={linkGate.ok ? mailtoHref : undefined}
                  aria-disabled={!linkGate.ok}
                  onClick={(ev) => {
                    if (!linkGate.ok) {
                      ev.preventDefault();
                      setGateError(linkGate.error);
                    }
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded border border-slate-300 bg-white hover:bg-slate-50 font-semibold text-slate-700 ${linkGate.ok ? '' : 'opacity-50 cursor-not-allowed'}`}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Abrir no Cliente de E-mail
                </a>
              </div>

              <div className="flex items-center gap-2">
                {sendError && (
                  <span role="alert" data-testid="email-send-error" className="text-xs text-red-700">
                    {sendError}
                  </span>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded border border-slate-300 font-semibold text-slate-700 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={sending || !linkGate.ok}
                  title={linkGate.ok ? undefined : linkGate.error}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded bg-accent hover:bg-accent-hover text-white font-semibold shadow-sm cursor-pointer disabled:opacity-50"
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
