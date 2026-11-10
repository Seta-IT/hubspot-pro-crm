/** Contagem de vínculos de um item de cadastro auxiliar (centro de custo, plano de contas, etc.). */

export type AuxUsageKind = 'costCenters' | 'chartOfAccountsList' | 'paymentMethods' | 'emailAutomationOptions';

export type AuxUsageCounts = {
  contracts: number;
  proposals: number;
  invoices: number;
  financialEntries: number;
  purchaseOrders: number;
};

export type AuxUsageSources = {
  contracts?: Array<{ costCenter?: string | null; chartOfAccounts?: string | null; paymentMethod?: string | null; emailAutomationMode?: string | null }>;
  proposals?: Array<{ costCenter?: string | null; chartOfAccounts?: string | null }>;
  invoices?: Array<{
    costCenter?: string | null;
    chartOfAccounts?: string | null;
    paymentMethodLabel?: string | null;
    paymentMethod?: string | null;
  }>;
  financialEntries?: Array<{ costCenter?: string | null; paymentMethod?: string | null }>;
  purchaseOrders?: Array<{ costCenter?: string | null }>;
};

export function normalizeAuxLabel(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function matches(recordValue: unknown, label: string): boolean {
  const n = normalizeAuxLabel(recordValue);
  return Boolean(n) && n === normalizeAuxLabel(label);
}

function count(list: unknown[] | undefined, pred: (row: any) => boolean): number {
  let total = 0;
  for (const row of list || []) {
    if (pred(row)) total += 1;
  }
  return total;
}

export function countAuxOptionUsage(kind: AuxUsageKind, label: string, sources: AuxUsageSources = {}): AuxUsageCounts {
  const empty: AuxUsageCounts = { contracts: 0, proposals: 0, invoices: 0, financialEntries: 0, purchaseOrders: 0 };
  if (!String(label || '').trim()) return empty;
  if (kind === 'costCenters') {
    return {
      contracts: count(sources.contracts, (r) => matches(r.costCenter, label)),
      proposals: count(sources.proposals, (r) => matches(r.costCenter, label)),
      invoices: count(sources.invoices, (r) => matches(r.costCenter, label)),
      financialEntries: count(sources.financialEntries, (r) => matches(r.costCenter, label)),
      purchaseOrders: count(sources.purchaseOrders, (r) => matches(r.costCenter, label)),
    };
  }
  if (kind === 'chartOfAccountsList') {
    return {
      contracts: count(sources.contracts, (r) => matches(r.chartOfAccounts, label)),
      proposals: count(sources.proposals, (r) => matches(r.chartOfAccounts, label)),
      invoices: count(sources.invoices, (r) => matches(r.chartOfAccounts, label)),
      financialEntries: 0,
      purchaseOrders: 0,
    };
  }
  if (kind === 'paymentMethods') {
    return {
      contracts: count(sources.contracts, (r) => matches(r.paymentMethod, label)),
      proposals: 0,
      invoices: count(sources.invoices, (r) => matches(r.paymentMethodLabel, label) || matches(r.paymentMethod, label)),
      financialEntries: count(sources.financialEntries, (r) => matches(r.paymentMethod, label)),
      purchaseOrders: 0,
    };
  }
  return {
    contracts: count(sources.contracts, (r) => matches(r.emailAutomationMode, label)),
    proposals: 0,
    invoices: 0,
    financialEntries: 0,
    purchaseOrders: 0,
  };
}

export function auxUsageTotal(c: AuxUsageCounts): number {
  return c.contracts + c.proposals + c.invoices + c.financialEntries + c.purchaseOrders;
}

export function auxUsageKindLabel(kind: AuxUsageKind): string {
  if (kind === 'costCenters') return 'Este centro de custo';
  if (kind === 'chartOfAccountsList') return 'Este plano de contas';
  if (kind === 'paymentMethods') return 'Esta forma de pagamento';
  return 'Este item';
}

function part(n: number, one: string, many: string): string | null {
  if (n <= 0) return null;
  return `${n} ${n === 1 ? one : many}`;
}

export function formatAuxOptionUsageText(kind: AuxUsageKind, counts: AuxUsageCounts): string {
  const parts = [
    part(counts.contracts, 'contrato', 'contratos'),
    part(counts.proposals, 'proposta', 'propostas'),
    part(counts.invoices, 'fatura', 'faturas'),
    part(counts.financialEntries, 'lançamento financeiro', 'lançamentos financeiros'),
    part(counts.purchaseOrders, 'pedido de compra', 'pedidos de compra'),
  ].filter((p): p is string => Boolean(p));
  const subject = auxUsageKindLabel(kind);
  if (parts.length === 0) return `${subject} não tem vínculos.`;
  if (parts.length === 1) return `${subject} está em ${parts[0]}.`;
  const last = parts.pop();
  return `${subject} está em ${parts.join(', ')} e ${last}.`;
}
