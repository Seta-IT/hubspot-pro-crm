/** Bloqueio de exclusão quando o registro ainda tem vínculos (t197u / t198u). */

export const RECORD_IN_USE_CODE = 'RECORD_IN_USE' as const;

export type RecordUsageKind =
  | 'company'
  | 'contact'
  | 'catalogItem'
  | 'rentalContract'
  | 'proposal'
  | 'pipeline'
  | 'pipelineStage'
  | 'bankAccount'
  | 'chartOfAccounts'
  | 'financialEntry'
  | 'deal';

export type RecordUsageCounts = {
  contracts: number;
  proposals: number;
  deals: number;
  invoices: number;
  issuedInvoices: number;
  measurements: number;
  serviceOrders: number;
  financialEntries: number;
  boletos: number;
};

export type RecordUsageSources = {
  contracts?: Array<{
    id?: string | null;
    contractNumber?: string | null;
    companyId?: string | null;
    companyName?: string | null;
    companyCnpj?: string | null;
    contactId?: string | null;
    dealId?: string | null;
    proposalId?: string | null;
    proposalNumber?: string | null;
    chartOfAccounts?: string | null;
    paymentMethod?: string | null;
    equipments?: Array<{ id?: string | null; skuGestaoClick?: string | null; description?: string | null }>;
    measurementNumber?: string | null;
  }>;
  proposals?: Array<{
    id?: string | null;
    code?: string | null;
    companyId?: string | null;
    companyName?: string | null;
    companyCnpj?: string | null;
    contactId?: string | null;
    dealId?: string | null;
    convertedContractId?: string | null;
    convertedInvoiceId?: string | null;
    chartOfAccounts?: string | null;
    items?: Array<{ sku?: string | null; description?: string | null }>;
  }>;
  deals?: Array<{
    id?: string | null;
    companyId?: string | null;
    contactId?: string | null;
    pipelineId?: string | null;
    stageId?: string | null;
  }>;
  invoices?: Array<{
    id?: string | null;
    status?: string | null;
    companyId?: string | null;
    companyName?: string | null;
    companyCnpj?: string | null;
    rentalContractId?: string | null;
    contractNumber?: string | null;
    proposalId?: string | null;
    proposalNumber?: string | null;
    dealId?: string | null;
    chartOfAccounts?: string | null;
    paymentMethod?: string | null;
    paymentMethodLabel?: string | null;
    boletoDigitableLine?: string | null;
    measurementNumber?: string | null;
    itemsDescription?: Array<{ description?: string | null; serialNumber?: string | null }>;
  }>;
  serviceOrders?: Array<{
    id?: string | null;
    code?: string | null;
    companyName?: string | null;
  }>;
  tickets?: Array<{
    contactId?: string | null;
    companyId?: string | null;
    serviceOrderId?: string | null;
  }>;
  financialEntries?: Array<{
    id?: string | null;
    companyName?: string | null;
    invoiceId?: string | null;
    paymentMethod?: string | null;
    description?: string | null;
    costCenter?: string | null;
    type?: string | null;
  }>;
  bankAccounts?: Array<{ id?: string | null; name?: string | null }>;
  catalog?: Array<{
    id?: string | null;
    name?: string | null;
    gestaoClickCode?: string | null;
  }>;
};

export type RecordUsageRef = {
  id?: string | null;
  name?: string | null;
  cnpj?: string | null;
  email?: string | null;
  sku?: string | null;
  gestaoClickCode?: string | null;
  contractNumber?: string | null;
  code?: string | null;
  pipelineId?: string | null;
  convertedContractId?: string | null;
  convertedInvoiceId?: string | null;
};

const ISSUED = new Set(['EMITIDA', 'PAGA', 'VENCIDA', 'CANCELADA']);

export function emptyRecordUsage(): RecordUsageCounts {
  return {
    contracts: 0,
    proposals: 0,
    deals: 0,
    invoices: 0,
    issuedInvoices: 0,
    measurements: 0,
    serviceOrders: 0,
    financialEntries: 0,
    boletos: 0,
  };
}

export function recordUsageTotal(counts: RecordUsageCounts): number {
  return (
    counts.contracts +
    counts.proposals +
    counts.deals +
    counts.invoices +
    counts.issuedInvoices +
    counts.measurements +
    counts.serviceOrders +
    counts.financialEntries +
    counts.boletos
  );
}

export function normalizeUsageValue(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function digitsOnly(value: unknown): string {
  return String(value ?? '').replace(/\D+/g, '');
}

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function isFilled(value: unknown): boolean {
  const n = clean(value);
  if (!n) return false;
  const low = n.toLowerCase();
  return low !== '—' && low !== '-' && low !== 'n/a';
}

function idsEqual(a: unknown, b: unknown): boolean {
  const left = clean(a);
  const right = clean(b);
  return Boolean(left) && Boolean(right) && left.toLowerCase() === right.toLowerCase();
}

function namesEqual(a: unknown, b: unknown): boolean {
  const left = normalizeUsageValue(a);
  const right = normalizeUsageValue(b);
  return Boolean(left) && Boolean(right) && left === right;
}

function cnpjEqual(a: unknown, b: unknown): boolean {
  const left = digitsOnly(a);
  const right = digitsOnly(b);
  return Boolean(left) && Boolean(right) && left.length >= 8 && left === right;
}

function companyMatches(
  row: { companyId?: string | null; companyName?: string | null; companyCnpj?: string | null },
  ref: RecordUsageRef
): boolean {
  if (ref.id && idsEqual(row.companyId, ref.id)) return true;
  if (ref.cnpj && cnpjEqual(row.companyCnpj, ref.cnpj)) return true;
  if (ref.name && namesEqual(row.companyName, ref.name)) return true;
  return false;
}

function countList<T>(list: T[] | undefined, pred: (row: T) => boolean): number {
  let total = 0;
  for (const row of list || []) {
    if (pred(row)) total += 1;
  }
  return total;
}

function isIssuedInvoiceStatus(status: unknown): boolean {
  return ISSUED.has(String(status || '').toUpperCase());
}

function hasBoleto(invoice: { boletoDigitableLine?: string | null; paymentMethod?: string | null; paymentMethodLabel?: string | null }): boolean {
  if (isFilled(invoice.boletoDigitableLine) && digitsOnly(invoice.boletoDigitableLine).length >= 44) return true;
  const method = `${invoice.paymentMethod || ''} ${invoice.paymentMethodLabel || ''}`;
  return /boleto/i.test(method);
}

function productKeys(ref: RecordUsageRef): string[] {
  const keys = [ref.id, ref.sku, ref.gestaoClickCode, ref.name]
    .map((v) => normalizeUsageValue(v))
    .filter(Boolean);
  return Array.from(new Set(keys));
}

function productMatches(keys: string[], sku?: string | null, description?: string | null, id?: string | null): boolean {
  if (keys.length === 0) return false;
  const values = [id, sku, description].map((v) => normalizeUsageValue(v)).filter(Boolean);
  return values.some((v) => keys.includes(v));
}

export function inferBankAccountName(
  text: unknown,
  accounts: Array<{ id?: string | null; name?: string | null }> = []
): string | null {
  const raw = normalizeUsageValue(text);
  if (!raw) return null;
  for (const acc of accounts) {
    const name = normalizeUsageValue(acc.name);
    const id = normalizeUsageValue(acc.id);
    if (name && (raw.includes(name) || name.includes(raw))) return String(acc.name);
    if (id && raw === id) return String(acc.name || acc.id);
  }
  if (raw.includes('inter')) return 'Banco Inter';
  if (raw.includes('itau') || raw.includes('itaú')) return 'Banco Itaú';
  if (raw.includes('integrada')) return 'Conta Integrada';
  return null;
}

function bankTextMatches(ref: RecordUsageRef, ...parts: unknown[]): boolean {
  const blob = parts.filter((p) => isFilled(p)).join(' ');
  if (!blob) return false;
  if (ref.id && idsEqual(blob, ref.id)) return true;
  const inferred = inferBankAccountName(blob, ref.name ? [{ id: ref.id, name: ref.name }] : []);
  if (ref.name && inferred && namesEqual(inferred, ref.name)) return true;
  if (ref.name && normalizeUsageValue(blob).includes(normalizeUsageValue(ref.name))) return true;
  return false;
}

function part(n: number, one: string, many: string): string | null {
  if (n <= 0) return null;
  return `${n} ${n === 1 ? one : many}`;
}

export function formatRecordUsageText(counts: RecordUsageCounts): string {
  const parts = [
    part(counts.contracts, 'contrato', 'contratos'),
    part(counts.proposals, 'proposta', 'propostas'),
    part(counts.deals, 'negócio', 'negócios'),
    part(counts.invoices, 'fatura', 'faturas'),
    part(counts.issuedInvoices, 'fatura emitida', 'faturas emitidas'),
    part(counts.measurements, 'medição', 'medições'),
    part(counts.serviceOrders, 'ordem de serviço', 'ordens de serviço'),
    part(counts.financialEntries, 'lançamento', 'lançamentos'),
    part(counts.boletos, 'boleto', 'boletos'),
  ].filter((p): p is string => Boolean(p));
  if (parts.length === 0) return 'Este registro está em uso.';
  if (parts.length === 1) return `Usado em ${parts[0]}.`;
  const last = parts.pop();
  return `Usado em ${parts.join(', ')} e ${last}.`;
}

export function recordInUseBody(counts: RecordUsageCounts): {
  error: string;
  code: typeof RECORD_IN_USE_CODE;
  usage: RecordUsageCounts;
  usageText: string;
} {
  return {
    error: 'Não é possível excluir.',
    code: RECORD_IN_USE_CODE,
    usage: counts,
    usageText: formatRecordUsageText(counts),
  };
}

export function parseRecordInUseResponse(payload: unknown): { inUse: true; usageText: string; usage?: RecordUsageCounts } | null {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as { code?: string; usageText?: string; usage?: RecordUsageCounts; error?: string };
  if (body.code !== RECORD_IN_USE_CODE) return null;
  return {
    inUse: true,
    usageText: body.usageText || formatRecordUsageText(body.usage || emptyRecordUsage()),
    usage: body.usage,
  };
}

export function countRecordUsage(
  kind: RecordUsageKind,
  ref: RecordUsageRef,
  sources: RecordUsageSources = {}
): RecordUsageCounts {
  const counts = emptyRecordUsage();
  if (kind === 'company') {
    counts.contracts = countList(sources.contracts, (r) => companyMatches(r, ref));
    counts.proposals = countList(sources.proposals, (r) => companyMatches(r, ref));
    counts.deals = countList(sources.deals, (r) => idsEqual(r.companyId, ref.id));
    counts.invoices = countList(sources.invoices, (r) => companyMatches(r, ref));
    const osIds = new Set(
      (sources.tickets || [])
        .filter((t) => idsEqual(t.companyId, ref.id) && isFilled(t.serviceOrderId))
        .map((t) => normalizeUsageValue(t.serviceOrderId))
    );
    counts.serviceOrders = countList(
      sources.serviceOrders,
      (os) => namesEqual(os.companyName, ref.name) || osIds.has(normalizeUsageValue(os.id)) || osIds.has(normalizeUsageValue(os.code))
    );
    return counts;
  }
  if (kind === 'contact') {
    counts.contracts = countList(sources.contracts, (r) => idsEqual(r.contactId, ref.id));
    counts.proposals = countList(sources.proposals, (r) => idsEqual(r.contactId, ref.id));
    counts.deals = countList(sources.deals, (r) => idsEqual(r.contactId, ref.id));
    const osIds = new Set(
      (sources.tickets || [])
        .filter((t) => idsEqual(t.contactId, ref.id) && isFilled(t.serviceOrderId))
        .map((t) => normalizeUsageValue(t.serviceOrderId))
    );
    counts.serviceOrders = countList(
      sources.serviceOrders,
      (os) => osIds.has(normalizeUsageValue(os.id)) || osIds.has(normalizeUsageValue(os.code))
    );
    // faturas: o documento fiscal não tem contactId; não inventar vínculo
    return counts;
  }
  if (kind === 'catalogItem') {
    const keys = productKeys(ref);
    counts.contracts = countList(sources.contracts, (r) =>
      (r.equipments || []).some((eq) => productMatches(keys, eq.skuGestaoClick, eq.description, eq.id))
    );
    counts.proposals = countList(sources.proposals, (r) =>
      (r.items || []).some((it) => productMatches(keys, it.sku, it.description))
    );
    counts.invoices = countList(sources.invoices, (r) =>
      (r.itemsDescription || []).some((it) => productMatches(keys, null, it.description))
    );
    return counts;
  }
  if (kind === 'rentalContract') {
    const linked = (inv: NonNullable<RecordUsageSources['invoices']>[number]) =>
      idsEqual(inv.rentalContractId, ref.id) || (ref.contractNumber ? idsEqual(inv.contractNumber, ref.contractNumber) : false);
    counts.issuedInvoices = countList(sources.invoices, (inv) => linked(inv) && isIssuedInvoiceStatus(inv.status));
    counts.measurements = countList(
      sources.invoices,
      (inv) => linked(inv) && isFilled(inv.measurementNumber)
    );
    return counts;
  }
  if (kind === 'proposal') {
    counts.contracts = countList(
      sources.contracts,
      (c) =>
        idsEqual(c.proposalId, ref.id) ||
        (ref.code ? idsEqual(c.proposalNumber, ref.code) : false) ||
        idsEqual(c.id, ref.convertedContractId)
    );
    counts.invoices = countList(
      sources.invoices,
      (inv) =>
        idsEqual(inv.proposalId, ref.id) ||
        (ref.code ? idsEqual(inv.proposalNumber, ref.code) : false) ||
        idsEqual(inv.id, ref.convertedInvoiceId)
    );
    return counts;
  }
  if (kind === 'pipeline') {
    counts.deals = countList(sources.deals, (d) => idsEqual(d.pipelineId, ref.id));
    return counts;
  }
  if (kind === 'pipelineStage') {
    counts.deals = countList(
      sources.deals,
      (d) => idsEqual(d.stageId, ref.id) && (!ref.pipelineId || idsEqual(d.pipelineId, ref.pipelineId))
    );
    return counts;
  }
  if (kind === 'bankAccount') {
    counts.financialEntries = countList(sources.financialEntries, (e) =>
      bankTextMatches(ref, e.paymentMethod, e.description)
    );
    counts.invoices = countList(sources.invoices, (inv) =>
      bankTextMatches(ref, inv.paymentMethod, inv.paymentMethodLabel)
    );
    counts.boletos = countList(
      sources.invoices,
      (inv) => hasBoleto(inv) && bankTextMatches(ref, inv.paymentMethod, inv.paymentMethodLabel, inv.boletoDigitableLine)
    );
    counts.boletos += countList(
      sources.financialEntries,
      (e) => /boleto/i.test(String(e.paymentMethod || '')) && bankTextMatches(ref, e.paymentMethod, e.description)
    );
    return counts;
  }
  if (kind === 'chartOfAccounts') {
    const label = ref.name || ref.id || '';
    counts.contracts = countList(sources.contracts, (r) => namesEqual(r.chartOfAccounts, label));
    counts.proposals = countList(sources.proposals, (r) => namesEqual(r.chartOfAccounts, label));
    counts.invoices = countList(sources.invoices, (r) => namesEqual(r.chartOfAccounts, label));
    counts.boletos = countList(
      sources.invoices,
      (r) => namesEqual(r.chartOfAccounts, label) && hasBoleto(r)
    );
    return counts;
  }
  if (kind === 'financialEntry') {
    const entry = (sources.financialEntries || []).find((e) => idsEqual(e.id, ref.id));
    const invoiceId = entry?.invoiceId;
    counts.invoices = invoiceId ? countList(sources.invoices, (inv) => idsEqual(inv.id, invoiceId)) : 0;
    counts.boletos = invoiceId
      ? countList(sources.invoices, (inv) => idsEqual(inv.id, invoiceId) && hasBoleto(inv))
      : 0;
    return counts;
  }
  if (kind === 'deal') {
    counts.contracts = countList(sources.contracts, (r) => idsEqual(r.dealId, ref.id));
    counts.proposals = countList(sources.proposals, (r) => idsEqual(r.dealId, ref.id));
    counts.invoices = countList(sources.invoices, (r) => idsEqual(r.dealId, ref.id));
    return counts;
  }
  return counts;
}

