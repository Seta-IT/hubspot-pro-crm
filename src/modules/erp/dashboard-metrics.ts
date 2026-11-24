/**
 * Painel ERP (tela Início + fluxo de caixa do Financeiro) calculado em tempo real pelos dados
 * do próprio STI-hub (19/11/2026, aprovado por Marcéllo). Nada aqui vem do GestãoClick nem de
 * números fixos: sem dados, o indicador é zero.
 *
 * Regras (as mesmas no mês corrente e nos gráficos dos últimos 6 meses):
 * - Propostas feitas: criadas no mês, exceto RASCUNHO. Valor = total da proposta.
 * - Propostas aprovadas: aprovadas ou convertidas (contrato/fatura) no mês. A data é a primeira
 *   entrada APROVADA/CONVERTIDA do histórico; sem histórico, approvedAt; sem os dois, a última
 *   atualização da proposta.
 * - Taxa de aprovação: aprovadas no mês / feitas no mês (quantidade e valor).
 * - Faturado: faturas EMITIDA ou PAGA pela data de emissão (issueDate); CANCELADA nunca entra.
 * - Recebido / Pago no mês: lançamentos PAGO com vencimento no mês; previsto = todos os
 *   lançamentos com vencimento no mês. A receber / A pagar hoje: em aberto ou atrasados que
 *   vencem hoje.
 * - Vendas: propostas aprovadas/convertidas no mês + vendas importadas (sem as canceladas).
 * - Datas aceitas: AAAA-MM-DD, ISO com hora (convertido para America/Sao_Paulo) e DD/MM/AAAA.
 */
import type { ErpBankAccount, ErpDashboardSummary, ErpFinancialEntry, ErpFiscalInvoice, ErpSaleOrder } from '../../db/types';

export const DASHBOARD_TIME_ZONE = 'America/Sao_Paulo';
export const DASHBOARD_MONTHS = 6;

const MONTH_LABELS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export interface DashboardProposalRow {
  status: string | null;
  total: number;
  /** true = veio do GestãoClick (gc_id); false = criada no STI-hub. */
  fromGc: boolean;
  createdAt: string | null;
  /** Data da aprovação/conversão já resolvida (ver resolveProposalApprovalDate). */
  approvedAt: string | null;
}

export interface DashboardCount {
  count: number;
  value: number;
}

export interface ErpLiveDashboardMonth {
  month: string; // AAAA-MM
  label: string; // 'nov'
  proposalsMade: DashboardCount;
  proposalsApproved: DashboardCount;
  invoiced: DashboardCount | null;
  recebimentos: number | null;
  pagamentos: number | null;
  saldo: number | null;
  vendas: number;
}

export interface ErpLiveDashboard {
  source: 'STI-hub';
  month: string;
  monthLabel: string;
  today: string;
  generatedAt: string;
  financeVisible: boolean;
  proposals: {
    made: DashboardCount & { bySource: { stihub: DashboardCount; gc: DashboardCount } };
    approved: DashboardCount & { bySource: { stihub: DashboardCount; gc: DashboardCount } };
    /** Percentual (0-100+, uma casa) por quantidade; null quando não houve proposta feita. */
    approvalRate: number | null;
    approvalRateValue: number | null;
  };
  invoiced: DashboardCount | null;
  sales: { monthTotal: number; fromProposals: number; imported: number };
  /** Quantidade de lançamentos recebidos/pagos com vencimento no mês (rodapé dos cards). */
  counts: { receivedMonth: number; paidMonth: number };
  /** Mesmo formato do resumo antigo, agora calculado (campos financeiros zerados sem alçada). */
  summary: ErpDashboardSummary;
  monthly: ErpLiveDashboardMonth[];
}

const round2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function ymdInZone(d: Date, timeZone = DASHBOARD_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function validYmd(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/**
 * Normaliza uma data do sistema para AAAA-MM-DD no fuso de São Paulo.
 * Aceita AAAA-MM-DD, ISO com hora (com Z/offset é convertido; sem fuso usa a data escrita),
 * DD/MM/AAAA (com ou sem hora) e Date. Inválido => null.
 */
export function toLocalYmd(value: unknown, timeZone = DASHBOARD_TIME_ZONE): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? ymdInZone(value, timeZone) : null;
  const raw = String(value).trim();
  let m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\D.*)?$/.exec(raw);
  if (m) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validYmd(y, mo, d) ? `${m[3]}-${m[2]}-${m[1]}` : null;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(raw);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!validYmd(y, mo, d)) return null;
  const rest = m[4] || '';
  if (/^[T ]\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/i.test(rest)) {
    const dt = new Date(raw.replace(' ', 'T'));
    if (Number.isFinite(dt.getTime())) return ymdInZone(dt, timeZone);
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function monthOf(value: unknown): string | null {
  const ymd = toLocalYmd(value);
  return ymd ? ymd.slice(0, 7) : null;
}

export function isValidMonthParam(v: unknown): v is string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(v || ''));
  return Boolean(m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[1]) >= 2000 && Number(m[1]) <= 2100);
}

/** Últimos `n` meses terminando em `month` (inclusive), do mais antigo para o mais novo. */
export function lastMonths(month: string, n = DASHBOARD_MONTHS): string[] {
  const [y, m] = month.split('-').map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const idx = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`);
  }
  return out;
}

export function monthLabel(month: string): string {
  return MONTH_LABELS[Number(month.slice(5, 7)) - 1] || month;
}

export const APPROVED_PROPOSAL_STATUSES = ['APROVADA', 'CONVERTIDA_CONTRATO'];

export function isApprovedProposal(status: unknown, converted = false): boolean {
  return converted || APPROVED_PROPOSAL_STATUSES.includes(String(status || ''));
}

/** Data da aprovação: 1ª entrada APROVADA/CONVERTIDA do histórico > approvedAt > última atualização. */
export function resolveProposalApprovalDate(p: {
  status?: unknown;
  converted?: boolean;
  statusHistory?: Array<{ date?: unknown; status?: unknown }> | null;
  approvedAt?: unknown;
  updatedAt?: unknown;
}): string | null {
  if (!isApprovedProposal(p.status, p.converted)) return null;
  const hist = Array.isArray(p.statusHistory) ? p.statusHistory : [];
  const first = hist.find((h) => h && APPROVED_PROPOSAL_STATUSES.includes(String(h.status || '')) && toLocalYmd(h.date));
  if (first) return String(first.date);
  if (toLocalYmd(p.approvedAt)) return String(p.approvedAt);
  if (toLocalYmd(p.updatedAt)) return String(p.updatedAt);
  return null;
}

/** Converte uma proposta (formato do JSON/tabela) na linha mínima que o painel usa. */
export function proposalToDashboardRow(p: Record<string, any>): DashboardProposalRow {
  const converted = p.status === 'CONVERTIDA_CONTRATO' || Boolean(p.convertedContractId) || Boolean(p.convertedInvoiceId);
  const fromGc = Boolean((p.gcSource && p.gcSource.id) || /^prop-gc-\d+$/.test(String(p.id || '')));
  return {
    status: p.status ? String(p.status) : null,
    total: round2(num(p.monthlyRecurringTotal) + num(p.oneTimeSetupTotal) + num(p.shippingCost)),
    fromGc,
    createdAt: p.createdAt ? String(p.createdAt) : null,
    approvedAt: resolveProposalApprovalDate({ ...p, converted }),
  };
}

const emptyCount = (): DashboardCount => ({ count: 0, value: 0 });
const add = (c: DashboardCount, v: number) => {
  c.count += 1;
  c.value = round2(c.value + v);
};

export function formatBrlServer(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(round2(v));
}

function isCancelledSale(status: unknown): boolean {
  return /cancel/i.test(String(status || ''));
}

export interface ComputeDashboardInput {
  month: string; // AAAA-MM
  today: string; // AAAA-MM-DD (São Paulo)
  proposals: DashboardProposalRow[];
  invoices: Array<Pick<ErpFiscalInvoice, 'status' | 'issueDate' | 'netAmount' | 'grossAmount'>>;
  financialEntries: Array<Pick<ErpFinancialEntry, 'type' | 'status' | 'amount' | 'dueDate'>>;
  salesOrders: Array<Pick<ErpSaleOrder, 'date' | 'status' | 'totalAmount'>>;
  bankAccounts: ErpBankAccount[];
  /** Sem alçada financeira: recebido/pago/faturado/saldos saem zerados e financeVisible=false. */
  includeFinance: boolean;
  /** Escopo restrito (só as próprias propostas): vendas importadas do GC não entram. */
  includeImportedSales: boolean;
  generatedAt?: string;
}

export function computeErpDashboard(input: ComputeDashboardInput): ErpLiveDashboard {
  const months = lastMonths(input.month);
  const monthSet = new Set(months);
  const byMonth = new Map<string, ErpLiveDashboardMonth>();
  for (const m of months) {
    byMonth.set(m, {
      month: m,
      label: monthLabel(m),
      proposalsMade: emptyCount(),
      proposalsApproved: emptyCount(),
      invoiced: input.includeFinance ? emptyCount() : null,
      recebimentos: input.includeFinance ? 0 : null,
      pagamentos: input.includeFinance ? 0 : null,
      saldo: input.includeFinance ? 0 : null,
      vendas: 0,
    });
  }
  const madeBySource = { stihub: emptyCount(), gc: emptyCount() };
  const approvedBySource = { stihub: emptyCount(), gc: emptyCount() };
  const salesFromProposals = new Map<string, number>();
  const salesImported = new Map<string, number>();

  for (const p of input.proposals) {
    const total = num(p.total);
    if (String(p.status || '') !== 'RASCUNHO') {
      const cm = monthOf(p.createdAt);
      if (cm && monthSet.has(cm)) {
        add(byMonth.get(cm)!.proposalsMade, total);
        if (cm === input.month) add(p.fromGc ? madeBySource.gc : madeBySource.stihub, total);
      }
    }
    const am = p.approvedAt ? monthOf(p.approvedAt) : null;
    if (am && monthSet.has(am)) {
      add(byMonth.get(am)!.proposalsApproved, total);
      salesFromProposals.set(am, round2((salesFromProposals.get(am) || 0) + total));
      if (am === input.month) add(p.fromGc ? approvedBySource.gc : approvedBySource.stihub, total);
    }
  }

  if (input.includeImportedSales) {
    for (const s of input.salesOrders) {
      if (isCancelledSale(s.status)) continue;
      const sm = monthOf(s.date);
      if (sm && monthSet.has(sm)) salesImported.set(sm, round2((salesImported.get(sm) || 0) + num(s.totalAmount)));
    }
  }
  for (const m of months) {
    byMonth.get(m)!.vendas = round2((salesFromProposals.get(m) || 0) + (salesImported.get(m) || 0));
  }

  // Financeiro
  let receivableToday = 0;
  let receivableTodayCount = 0;
  let payableToday = 0;
  let payableTodayCount = 0;
  let receivedMonth = 0;
  let receivedPlanned = 0;
  let paidMonth = 0;
  let paidPlanned = 0;
  let receivedCount = 0;
  let paidCount = 0;
  if (input.includeFinance) {
    for (const inv of input.invoices) {
      if (inv.status !== 'EMITIDA' && inv.status !== 'PAGA') continue;
      const im = monthOf(inv.issueDate);
      if (!im || !monthSet.has(im)) continue;
      const v = num(inv.netAmount) || num(inv.grossAmount);
      add(byMonth.get(im)!.invoiced!, v);
    }
    for (const e of input.financialEntries) {
      const due = toLocalYmd(e.dueDate);
      if (!due) continue;
      const amount = num(e.amount);
      const open = e.status === 'ABERTO' || e.status === 'ATRASADO';
      const paid = e.status === 'PAGO';
      const dm = due.slice(0, 7);
      if (e.type === 'RECEBER') {
        if (open && due === input.today) {
          receivableToday += amount;
          receivableTodayCount += 1;
        }
        if (dm === input.month) {
          receivedPlanned += amount;
          if (paid) {
            receivedMonth += amount;
            receivedCount += 1;
          }
        }
        if (paid && monthSet.has(dm)) byMonth.get(dm)!.recebimentos = round2(byMonth.get(dm)!.recebimentos! + amount);
      } else if (e.type === 'PAGAR') {
        if (open && due === input.today) {
          payableToday += amount;
          payableTodayCount += 1;
        }
        if (dm === input.month) {
          paidPlanned += amount;
          if (paid) {
            paidMonth += amount;
            paidCount += 1;
          }
        }
        if (paid && monthSet.has(dm)) byMonth.get(dm)!.pagamentos = round2(byMonth.get(dm)!.pagamentos! + amount);
      }
    }
    for (const m of months) {
      const row = byMonth.get(m)!;
      row.saldo = round2((row.recebimentos || 0) - (row.pagamentos || 0));
    }
  }

  const monthly = months.map((m) => byMonth.get(m)!);
  const cur = byMonth.get(input.month)!;
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
  const titles = (n: number) => (n === 0 ? 'Nenhum título vence hoje' : n === 1 ? '1 título vence hoje' : `${n} títulos vencem hoje`);

  const accounts = input.includeFinance ? input.bankAccounts || [] : [];
  const balance = round2(accounts.reduce((a, b) => a + num(b.balance), 0));
  const negative = accounts.filter((a) => num(a.balance) < 0).length;

  const saldoRows = input.includeFinance ? monthly : [];
  const best = saldoRows.length ? saldoRows.reduce((a, b) => ((b.saldo || 0) > (a.saldo || 0) ? b : a)) : null;
  const worst = saldoRows.length ? saldoRows.reduce((a, b) => ((b.saldo || 0) < (a.saldo || 0) ? b : a)) : null;
  const salesTotal = round2(monthly.reduce((a, r) => a + r.vendas, 0));
  const salesAvg = round2(salesTotal / monthly.length);

  const summary: ErpDashboardSummary = {
    availableBalanceToday: balance,
    bankAccountsSummaryText: accounts.length
      ? `${accounts.length} ${accounts.length === 1 ? 'conta bancária' : 'contas bancárias'} · ${negative} com saldo negativo`
      : 'Nenhuma conta bancária cadastrada',
    receivableToday: round2(receivableToday),
    receivableTodaySubtitle: titles(receivableTodayCount),
    payableToday: round2(payableToday),
    payableTodaySubtitle: titles(payableTodayCount),
    receivedMonth: round2(receivedMonth),
    receivedMonthPlanned: round2(receivedPlanned),
    receivedMonthPercent: receivedPlanned > 0 ? Math.min(100, Math.round((receivedMonth / receivedPlanned) * 100)) : 0,
    paidMonth: round2(paidMonth),
    paidMonthPlanned: round2(paidPlanned),
    paidMonthPercent: paidPlanned > 0 ? Math.min(100, Math.round((paidMonth / paidPlanned) * 100)) : 0,
    cashFlowPeriodBalance: round2(saldoRows.reduce((a, r) => a + (r.saldo || 0), 0)),
    cashFlowBestMonth: best ? `${best.label} · ${formatBrlServer(best.saldo || 0)}` : '-',
    cashFlowWorstMonth: worst ? `${worst.label} · ${formatBrlServer(worst.saldo || 0)}` : '-',
    cashFlowMonthly: monthly.map((r) => ({
      month: r.label,
      recebimentos: r.recebimentos || 0,
      pagamentos: r.pagamentos || 0,
      saldo: r.saldo || 0,
    })),
    salesPeriodTotal: salesTotal,
    salesMonthlyAverage: salesAvg,
    salesCurrentMonthToDate: cur.vendas,
    salesMonthly: monthly.map((r) => ({ month: r.label, vendas: r.vendas, media: salesAvg })),
  };

  return {
    source: 'STI-hub',
    month: input.month,
    monthLabel: monthLabel(input.month),
    today: input.today,
    generatedAt: input.generatedAt || new Date().toISOString(),
    financeVisible: input.includeFinance,
    proposals: {
      made: { ...cur.proposalsMade, bySource: madeBySource },
      approved: { ...cur.proposalsApproved, bySource: approvedBySource },
      approvalRate: pct(cur.proposalsApproved.count, cur.proposalsMade.count),
      approvalRateValue: pct(cur.proposalsApproved.value, cur.proposalsMade.value),
    },
    invoiced: cur.invoiced,
    sales: {
      monthTotal: cur.vendas,
      fromProposals: salesFromProposals.get(input.month) || 0,
      imported: salesImported.get(input.month) || 0,
    },
    counts: { receivedMonth: receivedCount, paidMonth: paidCount },
    summary,
    monthly,
  };
}

/** Data de hoje (AAAA-MM-DD) no fuso de São Paulo. */
export function todayInSaoPaulo(now = new Date()): string {
  return ymdInZone(now);
}
