/**
 * Faixa de vencimentos nos próximos 30 dias (pedido do Marcéllo, 27/11/2026).
 * Só conta o que o sistema já tem: vigência de contratos, vencimento de faturas e
 * lançamentos financeiros, validade de propostas e o certificado digital A1.
 * Datas em calendário de America/Sao_Paulo. Inclui o que já venceu e ainda está aberto.
 */
import { addCalendarDays } from '../../app/lib/br-date';
import { todayInSaoPaulo, toLocalYmd } from './dashboard-metrics';

/** Só o que a faixa precisa do certificado (evita puxar o módulo A1 / node-forge no cliente). */
export interface ExpirationCertificateView {
  present?: boolean;
  notAfter?: string | null;
}

export const EXPIRATION_WINDOW_DAYS = 30;
export const EXPIRATION_CACHE_TTL_MS = 60_000;

export const OPEN_PROPOSAL_STATUSES = [
  'RASCUNHO',
  'ENVIADA',
  'EM_NEGOCIACAO',
  'FATURAMENTO',
] as const;

export const OPEN_INVOICE_STATUSES = ['EMITIDA', 'VENCIDA'] as const;
export const OPEN_FINANCIAL_STATUSES = ['ABERTO', 'ATRASADO'] as const;
export const CLOSED_CONTRACT_STATUS = 'ENCERRADO';

export type ExpirationKind =
  | 'contratos'
  | 'faturas'
  | 'contas_receber'
  | 'contas_pagar'
  | 'propostas'
  | 'certificado';

export type ExpirationNavTarget =
  | { type: 'erp'; section: 'CONTRATOS' | 'FISCAL' | 'FINANCEIRO' | 'ORCAMENTOS'; subId: string; status: string }
  | { type: 'settings'; itemId: string };

export interface ExpirationItem {
  kind: ExpirationKind;
  count: number;
  label: string;
  target: ExpirationNavTarget;
  daysToExpire?: number;
}

export interface ExpirationAccess {
  contracts: boolean;
  invoices: boolean;
  receivables: boolean;
  payables: boolean;
  proposals: boolean;
  certificate: boolean;
}

export interface UpcomingExpirationsResult {
  windowDays: number;
  today: string;
  text: string;
  items: ExpirationItem[];
}

const CERT_TARGET: ExpirationNavTarget = { type: 'settings', itemId: 'tools-certificate' };

export function expirationUntilDate(today: string, windowDays = EXPIRATION_WINDOW_DAYS): string {
  return addCalendarDays(today, windowDays);
}

/** Vence até o fim da janela (hoje + N dias), inclusive o que já passou. */
export function isDateInExpirationWindow(
  value: unknown,
  today: string,
  windowDays = EXPIRATION_WINDOW_DAYS
): boolean {
  const ymd = toLocalYmd(value);
  if (!ymd) return false;
  return ymd <= expirationUntilDate(today, windowDays);
}

export function isOpenExpiringContract(
  contract: { endDate?: unknown; status?: unknown },
  today: string,
  windowDays = EXPIRATION_WINDOW_DAYS
): boolean {
  if (String(contract.status || '') === CLOSED_CONTRACT_STATUS) return false;
  return isDateInExpirationWindow(contract.endDate, today, windowDays);
}

export function isOpenExpiringInvoice(
  invoice: { dueDate?: unknown; status?: unknown },
  today: string,
  windowDays = EXPIRATION_WINDOW_DAYS
): boolean {
  if (!OPEN_INVOICE_STATUSES.includes(String(invoice.status || '') as (typeof OPEN_INVOICE_STATUSES)[number])) {
    return false;
  }
  return isDateInExpirationWindow(invoice.dueDate, today, windowDays);
}

export function isOpenExpiringFinancial(
  entry: { dueDate?: unknown; status?: unknown; type?: unknown },
  type: 'RECEBER' | 'PAGAR',
  today: string,
  windowDays = EXPIRATION_WINDOW_DAYS
): boolean {
  if (String(entry.type || '') !== type) return false;
  if (!OPEN_FINANCIAL_STATUSES.includes(String(entry.status || '') as (typeof OPEN_FINANCIAL_STATUSES)[number])) {
    return false;
  }
  return isDateInExpirationWindow(entry.dueDate, today, windowDays);
}

export function isOpenExpiringProposal(
  proposal: { validUntil?: unknown; status?: unknown },
  today: string,
  windowDays = EXPIRATION_WINDOW_DAYS
): boolean {
  if (!OPEN_PROPOSAL_STATUSES.includes(String(proposal.status || '') as (typeof OPEN_PROPOSAL_STATUSES)[number])) {
    return false;
  }
  return isDateInExpirationWindow(proposal.validUntil, today, windowDays);
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function certificateLabel(daysToExpire: number): string {
  if (daysToExpire < 0) return 'certificado digital vencido';
  if (daysToExpire === 0) return 'certificado digital vence hoje';
  return `certificado digital em ${daysToExpire} ${daysToExpire === 1 ? 'dia' : 'dias'}`;
}

export function certificateExpiringInfo(
  view: ExpirationCertificateView | null | undefined,
  nowMs = Date.now()
): { include: boolean; daysToExpire: number } {
  if (!view?.present || !view.notAfter) return { include: false, daysToExpire: 0 };
  const na = Date.parse(view.notAfter);
  const daysToExpire = Math.floor((na - nowMs) / 86_400_000);
  if (!Number.isFinite(na)) return { include: false, daysToExpire: 0 };
  return { include: daysToExpire <= EXPIRATION_WINDOW_DAYS, daysToExpire };
}

export function buildUpcomingExpirations(input: {
  today?: string;
  nowMs?: number;
  access: ExpirationAccess;
  contracts?: Array<{ endDate?: unknown; status?: unknown }>;
  invoices?: Array<{ dueDate?: unknown; status?: unknown }>;
  financial?: Array<{ dueDate?: unknown; status?: unknown; type?: unknown }>;
  proposals?: Array<{ validUntil?: unknown; status?: unknown }> | number;
  certificate?: ExpirationCertificateView | null;
  windowDays?: number;
}): UpcomingExpirationsResult {
  const today = input.today || todayInSaoPaulo();
  const nowMs = input.nowMs ?? Date.now();
  const windowDays = input.windowDays ?? EXPIRATION_WINDOW_DAYS;
  const access = input.access;
  const items: ExpirationItem[] = [];

  if (access.contracts) {
    const count = (input.contracts || []).filter((c) => isOpenExpiringContract(c, today, windowDays)).length;
    if (count > 0) {
      items.push({
        kind: 'contratos',
        count,
        label: plural(count, 'contrato', 'contratos'),
        target: { type: 'erp', section: 'CONTRATOS', subId: 'CTR_TODOS', status: 'VENCE_30' },
      });
    }
  }

  if (access.invoices) {
    const count = (input.invoices || []).filter((i) => isOpenExpiringInvoice(i, today, windowDays)).length;
    if (count > 0) {
      items.push({
        kind: 'faturas',
        count,
        label: plural(count, 'fatura', 'faturas'),
        target: { type: 'erp', section: 'FISCAL', subId: 'FIS_TODAS', status: 'A_VENCER_30' },
      });
    }
  }

  if (access.receivables) {
    const count = (input.financial || []).filter((e) => isOpenExpiringFinancial(e, 'RECEBER', today, windowDays)).length;
    if (count > 0) {
      items.push({
        kind: 'contas_receber',
        count,
        label: plural(count, 'conta a receber', 'contas a receber'),
        target: { type: 'erp', section: 'FINANCEIRO', subId: 'FIN_RECEBER', status: 'A_VENCER_30' },
      });
    }
  }

  if (access.payables) {
    const count = (input.financial || []).filter((e) => isOpenExpiringFinancial(e, 'PAGAR', today, windowDays)).length;
    if (count > 0) {
      items.push({
        kind: 'contas_pagar',
        count,
        label: plural(count, 'conta a pagar', 'contas a pagar'),
        target: { type: 'erp', section: 'FINANCEIRO', subId: 'FIN_PAGAR', status: 'A_VENCER_30' },
      });
    }
  }

  if (access.proposals) {
    const count =
      typeof input.proposals === 'number'
        ? input.proposals
        : (input.proposals || []).filter((p) => isOpenExpiringProposal(p, today, windowDays)).length;
    if (count > 0) {
      items.push({
        kind: 'propostas',
        count,
        label: plural(count, 'proposta', 'propostas'),
        target: { type: 'erp', section: 'ORCAMENTOS', subId: 'ORC_TODOS', status: 'A_VENCER_30' },
      });
    }
  }

  if (access.certificate) {
    const info = certificateExpiringInfo(input.certificate, nowMs);
    if (info.include) {
      items.push({
        kind: 'certificado',
        count: 1,
        label: certificateLabel(info.daysToExpire),
        target: CERT_TARGET,
        daysToExpire: info.daysToExpire,
      });
    }
  }

  const text =
    items.length === 0
      ? ''
      : `Vencimentos nos próximos ${windowDays} dias: ${items.map((i) => i.label).join(' • ')}`;

  return { windowDays, today, text, items };
}

const expirationCache = new Map<string, { expiresAt: number; data: UpcomingExpirationsResult }>();

export function readExpirationCache(key: string, nowMs = Date.now()): UpcomingExpirationsResult | null {
  const hit = expirationCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= nowMs) {
    expirationCache.delete(key);
    return null;
  }
  return hit.data;
}

export function writeExpirationCache(
  key: string,
  data: UpcomingExpirationsResult,
  nowMs = Date.now(),
  ttlMs = EXPIRATION_CACHE_TTL_MS
): void {
  expirationCache.set(key, { expiresAt: nowMs + ttlMs, data });
  if (expirationCache.size > 200) {
    for (const [k, v] of expirationCache) {
      if (v.expiresAt <= nowMs) expirationCache.delete(k);
    }
  }
}

/** Só para testes. */
export function clearExpirationCache(): void {
  expirationCache.clear();
}
