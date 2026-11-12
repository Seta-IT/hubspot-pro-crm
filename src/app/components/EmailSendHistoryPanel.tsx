"use client";
import React from 'react';
import type { ErpFiscalInvoice, ErpInvoiceEmailHistoryEntry, ErpRentalContract } from '../../db/types';
import {
  collectContractEmailHistory,
  emailHistoryRecipientsLabel,
  formatEmailHistoryWhen,
  withoutEmailHistoryBcc,
  type EmailSendHistoryEntry,
} from '../lib/email-send-history';

const ATTACHMENT_LABELS: Record<string, string> = {
  receipt: 'Recibo',
  boleto: 'Boleto',
  pix: 'Pix',
  remessa: 'NF de remessa',
  proposal: 'Proposta',
  contrato: 'Contrato',
};

function attachmentLabel(kind: string): string {
  return ATTACHMENT_LABELS[kind] || kind;
}

export function EmailSendHistoryPanel({
  entries,
  contract,
  invoices,
  emptyText = 'Nenhum envio registrado ainda.',
  compact = false,
}: {
  entries?: EmailSendHistoryEntry[] | ErpInvoiceEmailHistoryEntry[];
  contract?: Pick<ErpRentalContract, 'id' | 'contractNumber' | 'emailHistory' | 'proposalId'>;
  invoices?: ErpFiscalInvoice[];
  emptyText?: string;
  compact?: boolean;
}) {
  const rawList: EmailSendHistoryEntry[] = entries
    ? entries.map((entry) => entry)
    : contract
      ? collectContractEmailHistory(contract, invoices || [])
      : [];
  const list: EmailSendHistoryEntry[] = rawList.map((entry) => withoutEmailHistoryBcc(entry));

  return (
    <div data-testid="email-send-history" className={compact ? 'space-y-1.5 text-xs' : 'rounded-lg border border-slate-200 bg-white p-3 space-y-2 text-xs'}>
      <h4 className="text-sm font-semibold text-slate-900">
        Histórico de envios de e-mail ({list.length})
      </h4>
      {list.length === 0 ? (
        <p className="text-xs font-semibold text-slate-500">{emptyText}</p>
      ) : (
        <ul className="space-y-1.5">
          {list.map((entry) => (
            <li
              key={entry.protocol || `${entry.sentAt}-${entry.to}`}
              className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2 space-y-0.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-800">{emailHistoryRecipientsLabel(entry)}</span>
                <span className="font-semibold text-slate-500">{formatEmailHistoryWhen(entry.sentAt)}</span>
              </div>
              {entry.subject ? <div className="font-semibold text-slate-700">{entry.subject}</div> : null}
              <div className="font-semibold text-slate-500">
                Protocolo {entry.protocol}
                {entry.sourceLabel ? ` • ${entry.sourceLabel}` : ''}
                {entry.actor ? ` • ${entry.actor}` : ''}
                {entry.attachments && entry.attachments.length > 0
                  ? ` • ${entry.attachments.map(attachmentLabel).join(', ')}`
                  : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
