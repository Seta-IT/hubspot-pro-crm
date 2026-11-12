import type { ErpFiscalInvoice, ErpInvoiceEmailHistoryEntry, ErpRentalContract } from '../../db/types';
import { matchInvoicesForContract } from './contract-billing-utils';

export type EmailSendHistoryEntry = ErpInvoiceEmailHistoryEntry & {
  sourceLabel?: string;
};

export function mergeEmailHistoryEntries(
  current: ErpInvoiceEmailHistoryEntry[] | undefined,
  entry: ErpInvoiceEmailHistoryEntry | null | undefined
): ErpInvoiceEmailHistoryEntry[] {
  const list = [...(current || [])];
  if (!entry || !entry.sentAt) return list;
  const key = historyEntryKey(entry);
  if (list.some((item) => historyEntryKey(item) === key)) return list;
  return [...list, entry];
}

export function historyEntryKey(entry: Pick<ErpInvoiceEmailHistoryEntry, 'protocol' | 'sentAt' | 'to'>): string {
  const protocol = String(entry.protocol || '').trim();
  if (protocol) return `p:${protocol}`;
  return `t:${entry.sentAt}|${entry.to || ''}`;
}

export function collectContractEmailHistory(
  contract: Pick<ErpRentalContract, 'id' | 'contractNumber' | 'emailHistory' | 'proposalId'>,
  invoices: ErpFiscalInvoice[] = []
): EmailSendHistoryEntry[] {
  const fromContract: EmailSendHistoryEntry[] = (contract.emailHistory || []).map((entry) => ({
    ...entry,
    sourceLabel: 'Contrato',
  }));
  const fromInvoices: EmailSendHistoryEntry[] = matchInvoicesForContract(contract as ErpRentalContract, invoices).flatMap(
    (inv) =>
      (inv.emailHistory || []).map((entry) => ({
        ...entry,
        sourceLabel: inv.documentNumber || 'Fatura',
      }))
  );
  const merged = new Map<string, EmailSendHistoryEntry>();
  for (const entry of [...fromContract, ...fromInvoices]) {
    const key = historyEntryKey(entry);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, entry);
      continue;
    }
    if (existing.sourceLabel === 'Contrato' && entry.sourceLabel && entry.sourceLabel !== 'Contrato') {
      merged.set(key, { ...existing, ...entry, sourceLabel: entry.sourceLabel });
    }
  }
  return [...merged.values()].sort((a, b) => String(b.sentAt || '').localeCompare(String(a.sentAt || '')));
}

export function formatEmailHistoryWhen(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Cco não entra no histórico exibido (contrato, fatura e proposta). */
export function withoutEmailHistoryBcc<T extends { bcc?: string | null }>(
  entry: T
): Omit<T, 'bcc'> {
  const { bcc: _bcc, ...rest } = entry;
  void _bcc;
  return rest;
}

export function withoutEmailHistoryBccList<T extends { bcc?: string | null }>(
  list?: readonly T[] | null
): Array<Omit<T, 'bcc'>> {
  return (list || []).map(withoutEmailHistoryBcc);
}

export function emailHistoryRecipientsLabel(entry: Pick<ErpInvoiceEmailHistoryEntry, 'to' | 'cc'>): string {
  const to = String(entry.to || '').trim();
  const cc = String(entry.cc || '').trim();
  if (to && cc) return `Para ${to} (cópia para ${cc})`;
  if (to) return `Para ${to}`;
  return 'Envio registrado';
}
