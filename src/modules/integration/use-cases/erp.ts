// ============================================================================
// STI-hub — API v1 + MCP: Fase 2 / Lote 1 — casos de uso de LEITURA do ERP.
//
// Somente GET. Nenhuma escrita, emissao, baixa, envio, exclusao, merge, GestaoClick
// (sync/config) ou IAM. Toda autorizacao e feita AQUI (o RouterDataPort usa o contexto
// interno confiavel, que pula a sessao do router):
//  - escopo + moduleAccess.erp (credencial x usuario dono);
//  - alcadas de TELA do ERP do dono (proposalsQuotesAccess, rentalContractsAccess,
//    stockOsSalesAccess, financeBanksAccess, fiscalIssuanceAccess, canViewBankBalances),
//    fail-closed (ausente/desconhecido => nega);
//  - carteira: propostas/contratos/OS/vendas por dono (PROPRIOS/EQUIPE => so o dono da
//    credencial, como a tela do ERP); financeiro, fiscal, bancos, compras, colaboradores,
//    painel e sincronizacao exigem carteira efetiva TODOS;
//  - dados sensiveis: saldos so com canViewBankBalances; colaboradores so administrador
//    (telefone mascarado); custo/margem do catalogo so com alcada Financeiro; segredos
//    fiscais (CSC, token do CSC, certificado) e credenciais GestaoClick nunca saem.
// ============================================================================
import { z } from 'zod/v4';
import type {
  ErpCatalogItem,
  ErpCommercialProposal,
  ErpRentalContract,
  ErpServiceOrder,
} from '../../../db/types';
import { isServiceCreatedProposal } from '../../../app/lib/proposal-client-view';
import type { ErpCollections } from '../data-port';
import { includesText, isErpAdmin, requireAllPortfolio, requireOwnerScope, userHasErpAccess } from './common';
import {
  CursorSchema,
  defineUseCase,
  IdSchema,
  LimitSchema,
  notFound,
  PageInfoSchema,
  paginate,
  SearchSchema,
  UseCaseError,
  type UseCaseContext,
} from './types';

const listOf = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item), page: PageInfoSchema });
const one = <T extends z.ZodType>(item: T) => z.object({ data: item });
export const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));
export const strOrNull = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : String(v));
export const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const norm = (v: unknown): string =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
const MonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'mes invalido (AAAA-MM)');
const CompetenceSchema = z.string().regex(/^(0[1-9]|1[0-2])\/\d{4}$/, 'competencia invalida (MM/AAAA)');
const DateFilter = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data invalida (AAAA-MM-DD)');
const AggregateSchema = z.record(z.string(), z.unknown());

const base = {
  tag: 'ERP' as const,
  requiredModule: 'erp' as const,
  domain: 'erp' as const,
  method: 'GET' as const,
  idempotent: true,
  mutation: false,
  successStatus: 200 as const,
};

// ---------------------------------------------------------------------------
// Carteira do ERP
// ---------------------------------------------------------------------------
export interface ErpOwner {
  id: string;
  email: string;
  name: string;
}

/** null => carteira TODOS (sem filtro). PROPRIOS/EQUIPE => so o dono da credencial (como a tela). */
export function erpOwner(ctx: UseCaseContext): ErpOwner | null {
  if (ctx.auth.portfolioScope === 'TODOS') return null;
  return { id: ctx.owner.id, email: ctx.owner.email.toLowerCase(), name: ctx.owner.name };
}

/** Mesma regra do router (isProposalOwnedBy): sellerUserId gravado pelo servidor; senao e-mail. */
export function proposalOwnedBy(p: Pick<ErpCommercialProposal, 'sellerUserId' | 'sellerEmail' | 'createdByServiceAccount' | 'commercialNotes'>, o: ErpOwner): boolean {
  if (isServiceCreatedProposal(p)) return true;
  if (p.sellerUserId) return norm(p.sellerUserId) !== '' && norm(p.sellerUserId) === norm(o.id);
  return norm(p.sellerEmail) !== '' && norm(p.sellerEmail) === norm(o.email);
}

export async function companyIdsOwnedBy(ctx: UseCaseContext, o: ErpOwner): Promise<Set<string>> {
  const snap = await ctx.data.snapshot('crm');
  const ids = new Set<string>();
  for (const c of snap.companies) {
    const owner = norm(c.ownerName);
    if (owner && (owner === norm(o.name) || owner === norm(o.email))) ids.add(c.id);
  }
  return ids;
}

export function contractInScope(c: ErpRentalContract, o: ErpOwner | null, ownedCompanies: Set<string>): boolean {
  if (!o) return true;
  if (c.sellerName && norm(c.sellerName) === norm(o.name)) return true;
  return !!c.companyId && ownedCompanies.has(c.companyId);
}

export function serviceOrderInScope(s: Pick<ErpServiceOrder, 'sellerName' | 'technicianName'>, o: ErpOwner | null): boolean {
  if (!o) return true;
  const n = norm(o.name);
  return !!n && (norm(s.sellerName) === n || norm(s.technicianName) === n);
}

function decodeOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  const decoded = Number(Buffer.from(cursor, 'base64url').toString('utf8').replace(/^o:/, ''));
  if (!Number.isInteger(decoded) || decoded < 0) throw new UseCaseError(400, 'CURSOR_INVALID', 'Cursor de paginacao invalido.');
  return decoded;
}
const encodeOffset = (n: number) => Buffer.from(`o:${n}`, 'utf8').toString('base64url');

export function unwrapRead(res: { status: number; body: any }, what: string): any {
  if (res.status === 404) throw notFound(what);
  if (res.status < 200 || res.status >= 300) throw new UseCaseError(502, 'UPSTREAM_ERROR', `Falha interna ao ler ${what}.`);
  return res.body;
}

export async function collections(ctx: UseCaseContext): Promise<ErpCollections> {
  return ctx.data.erpCollections();
}

// ---------------------------------------------------------------------------
// DTOs (allowlist explicita de campos)
// ---------------------------------------------------------------------------
export const ProposalSummaryDto = z.object({
  id: z.string(),
  code: z.string(),
  title: z.string(),
  status: z.string(),
  budgetType: z.string().nullable(),
  companyId: z.string().nullable(),
  companyName: z.string(),
  contactId: z.string().nullable(),
  contactName: z.string(),
  dealId: z.string().nullable(),
  sellerName: z.string(),
  sellerEmail: z.string().nullable(),
  proposalDate: z.string().nullable(),
  validUntil: z.string().nullable(),
  monthlyRecurringTotal: z.number(),
  oneTimeSetupTotal: z.number(),
  totalContractValue: z.number(),
  contractMonths: z.number(),
  convertedContractId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const toProposalSummary = (p: ErpCommercialProposal): z.infer<typeof ProposalSummaryDto> => ({
  id: str(p.id),
  code: str(p.code),
  title: str(p.title),
  status: str(p.status),
  budgetType: strOrNull(p.budgetType),
  companyId: strOrNull(p.companyId),
  companyName: str(p.companyName),
  contactId: strOrNull(p.contactId),
  contactName: str(p.contactName),
  dealId: strOrNull(p.dealId),
  sellerName: str(p.sellerName),
  sellerEmail: strOrNull(p.sellerEmail),
  proposalDate: strOrNull(p.proposalDate),
  validUntil: strOrNull(p.validUntil),
  monthlyRecurringTotal: num(p.monthlyRecurringTotal),
  oneTimeSetupTotal: num(p.oneTimeSetupTotal),
  totalContractValue: num(p.totalContractValue),
  contractMonths: num(p.contractMonths),
  convertedContractId: strOrNull(p.convertedContractId),
  createdAt: str(p.createdAt),
  updatedAt: str(p.updatedAt || p.createdAt),
});

export const ProposalDto = ProposalSummaryDto.extend({
  companyCnpj: z.string(),
  paymentCondition: z.string(),
  commercialNotes: z.string(),
  technicalClauses: z.string(),
  discountPercentGlobal: z.number(),
  discountAmount: z.number(),
  shippingCost: z.number(),
  deliveryLeadTime: z.string().nullable(),
  version: z.number(),
  items: z.array(
    z.object({
      id: z.string(),
      sku: z.string(),
      description: z.string(),
      itemType: z.string().nullable(),
      quantity: z.number(),
      unitPrice: z.number(),
      discountPercent: z.number(),
      subtotal: z.number(),
      isRecurring: z.boolean(),
      totalMonthly: z.number(),
    })
  ),
});
export const toProposal = (p: ErpCommercialProposal): z.infer<typeof ProposalDto> => ({
  ...toProposalSummary(p),
  companyCnpj: str(p.companyCnpj),
  paymentCondition: str(p.paymentCondition),
  commercialNotes: str(p.commercialNotes),
  technicalClauses: str(p.technicalClauses),
  discountPercentGlobal: num(p.discountPercentGlobal),
  discountAmount: num(p.discountAmount),
  shippingCost: num(p.shippingCost),
  deliveryLeadTime: strOrNull(p.deliveryLeadTime),
  version: num(p.version || 1),
  items: (Array.isArray(p.items) ? p.items : []).slice(0, 500).map((i) => ({
    id: str(i.id),
    sku: str(i.sku),
    description: str(i.description),
    itemType: strOrNull(i.itemType),
    quantity: num(i.quantity),
    unitPrice: num(i.unitPrice),
    discountPercent: num(i.discountPercent),
    subtotal: num(i.subtotal ?? num(i.quantity) * num(i.unitPrice)),
    isRecurring: i.isRecurring === true,
    totalMonthly: num(i.totalMonthly),
  })),
});

export const VersionDto = z.object({
  version: z.number(),
  versionLabel: z.string(),
  savedAt: z.string(),
  savedBy: z.string(),
  changedFields: z.array(z.string()),
  changeSummary: z.string(),
});

export const ContractSummaryDto = z.object({
  id: z.string(),
  contractNumber: z.string(),
  title: z.string(),
  status: z.string(),
  modality: z.string().nullable(),
  companyId: z.string().nullable(),
  companyName: z.string(),
  proposalId: z.string().nullable(),
  sellerName: z.string().nullable(),
  monthlyValue: z.number(),
  contractMonths: z.number(),
  dueDay: z.number(),
  startDate: z.string(),
  endDate: z.string(),
  nextDueDate: z.string().nullable(),
  readjustmentIndex: z.string(),
  lastBilledCompetence: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const toContractSummary = (c: ErpRentalContract): z.infer<typeof ContractSummaryDto> => ({
  id: str(c.id),
  contractNumber: str(c.contractNumber),
  title: str(c.title),
  status: str(c.status),
  modality: strOrNull(c.modality),
  companyId: strOrNull(c.companyId),
  companyName: str(c.companyName),
  proposalId: strOrNull(c.proposalId),
  sellerName: strOrNull(c.sellerName),
  monthlyValue: num(c.monthlyValue),
  contractMonths: num(c.contractMonths),
  dueDay: num(c.dueDay),
  startDate: str(c.startDate),
  endDate: str(c.endDate),
  nextDueDate: strOrNull(c.nextDueDate),
  readjustmentIndex: str(c.readjustmentIndex),
  lastBilledCompetence: strOrNull(c.lastBilledCompetence),
  createdAt: str(c.createdAt),
  updatedAt: str(c.updatedAt || c.createdAt),
});
export const ContractDto = ContractSummaryDto.extend({
  companyCnpj: z.string(),
  paymentMethod: z.string().nullable(),
  billingRecurrence: z.string().nullable(),
  contractNotes: z.string().nullable(),
  version: z.number(),
  equipments: z.array(
    z.object({
      id: z.string(),
      sku: z.string(),
      description: z.string(),
      serialNumber: z.string(),
      quantity: z.number(),
      unitMonthlyRent: z.number(),
    })
  ),
});
export const toContract = (c: ErpRentalContract): z.infer<typeof ContractDto> => ({
  ...toContractSummary(c),
  companyCnpj: str(c.companyCnpj),
  paymentMethod: strOrNull(c.paymentMethod),
  billingRecurrence: strOrNull(c.billingRecurrence),
  contractNotes: strOrNull(c.contractNotes),
  version: num(c.version || 1),
  equipments: (Array.isArray(c.equipments) ? c.equipments : []).slice(0, 500).filter((e) => e && typeof e === 'object').map((e) => ({
    id: str(e.id),
    sku: str(e.skuGestaoClick),
    description: str(e.description),
    serialNumber: str(e.serialNumber),
    quantity: num(e.quantity),
    unitMonthlyRent: num(e.unitMonthlyRent),
  })),
});

export const ServiceOrderDto = z.object({
  id: z.string(),
  code: z.string(),
  status: z.string(),
  companyId: z.string().nullable(),
  companyName: z.string(),
  sellerName: z.string(),
  technicianName: z.string(),
  entryDate: z.string(),
  exitDate: z.string(),
  totalAmount: z.number(),
  priority: z.string().nullable(),
  description: z.string(),
  equipmentName: z.string().nullable(),
  serialNumber: z.string().nullable(),
});
export const toServiceOrder = (s: ErpServiceOrder): z.infer<typeof ServiceOrderDto> => ({
  id: str(s.id),
  code: str(s.code),
  status: str(s.status),
  companyId: strOrNull(s.companyId),
  companyName: str(s.companyName),
  sellerName: str(s.sellerName),
  technicianName: str(s.technicianName),
  entryDate: str(s.entryDate),
  exitDate: str(s.exitDate),
  totalAmount: num(s.totalAmount),
  priority: strOrNull(s.priority),
  description: str(s.description).slice(0, 4000),
  equipmentName: strOrNull(s.equipmentName),
  serialNumber: strOrNull(s.serialNumber),
});

export const SaleOrderDto = z.object({
  id: z.string(),
  code: z.string(),
  companyName: z.string(),
  sellerName: z.string(),
  date: z.string(),
  status: z.string(),
  totalAmount: z.number(),
  itemsSummary: z.string(),
  saleType: z.string().nullable(),
  paymentMethod: z.string().nullable(),
});
export const PurchaseOrderDto = z.object({
  id: z.string(),
  code: z.string(),
  supplierName: z.string(),
  supplierCnpj: z.string().nullable(),
  issueDate: z.string(),
  status: z.string(),
  nfeNumber: z.string(),
  itemsSummary: z.string().nullable(),
  costCenter: z.string().nullable(),
  totalAmount: z.number(),
});

export const CatalogItemDto = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  category: z.string(),
  productGroup: z.string().nullable(),
  brand: z.string().nullable(),
  modelName: z.string().nullable(),
  unitOfMeasure: z.string().nullable(),
  isActive: z.boolean(),
  stockAvailable: z.number(),
  stockRentedInClients: z.number(),
  monthlyRentalPrice: z.number(),
  saleOrSetupPrice: z.number(),
  /** Custo e margem: so com alcada Financeiro (VIEW+); senao null. */
  costPrice: z.number().nullable(),
  profitMarginPercent: z.number().nullable(),
});
export const toCatalogItem = (c: ErpCatalogItem, showCost: boolean): z.infer<typeof CatalogItemDto> => ({
  id: str(c.id),
  code: str(c.gestaoClickCode),
  name: str(c.name),
  category: str(c.category),
  productGroup: strOrNull(c.productGroup),
  brand: strOrNull(c.brand),
  modelName: strOrNull(c.modelName),
  unitOfMeasure: strOrNull(c.unitOfMeasure),
  isActive: c.isActive !== false,
  stockAvailable: num(c.stockAvailable),
  stockRentedInClients: num(c.stockRentedInClients),
  monthlyRentalPrice: num(c.monthlyRentalPrice),
  saleOrSetupPrice: num(c.saleOrSetupPrice),
  costPrice: showCost && c.costPrice !== undefined ? num(c.costPrice) : null,
  profitMarginPercent: showCost && c.profitMarginPercent !== undefined ? num(c.profitMarginPercent) : null,
});

export const SupplierDto = z.object({
  id: z.string(),
  name: z.string(),
  legalName: z.string(),
  cnpj: z.string(),
  supplierType: z.string().nullable(),
  email: z.string(),
  phone: z.string(),
  cityState: z.string().nullable(),
  active: z.boolean(),
});
const EmployeeDto = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  email: z.string(),
  /** Mascarado (so os 4 ultimos digitos). */
  phoneMasked: z.string(),
  active: z.boolean(),
});
export function maskPhone(v: unknown): string {
  const d = String(v ?? '').replace(/\D/g, '');
  if (!d) return '';
  return `****${d.slice(-4)}`;
}

export const FinancialEntryDto = z.object({
  id: z.string(),
  type: z.string(),
  category: z.string(),
  description: z.string(),
  companyName: z.string(),
  costCenter: z.string(),
  amount: z.number(),
  dueDate: z.string(),
  paidAt: z.string().nullable(),
  status: z.string(),
  invoiceId: z.string().nullable(),
  paymentMethod: z.string(),
});
const BankAccountDto = z.object({
  id: z.string(),
  name: z.string(),
  balance: z.number(),
  status: z.string(),
  lastMovedAt: z.string(),
});

export const InvoiceSummaryDto = z.object({
  id: z.string(),
  documentNumber: z.string(),
  documentType: z.string(),
  status: z.string(),
  competenceMonth: z.string(),
  companyId: z.string().nullable(),
  companyName: z.string(),
  companyCnpj: z.string(),
  rentalContractId: z.string().nullable(),
  proposalId: z.string().nullable(),
  grossAmount: z.number(),
  discountAmount: z.number(),
  netAmount: z.number(),
  issueDate: z.string(),
  dueDate: z.string(),
  paidAt: z.string().nullable(),
  paymentMethod: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const toInvoiceSummary = (i: any): z.infer<typeof InvoiceSummaryDto> => ({
  id: str(i.id),
  documentNumber: str(i.documentNumber),
  documentType: str(i.documentType),
  status: str(i.status),
  competenceMonth: str(i.competenceMonth),
  companyId: strOrNull(i.companyId),
  companyName: str(i.companyName),
  companyCnpj: str(i.companyCnpj),
  rentalContractId: strOrNull(i.rentalContractId),
  proposalId: strOrNull(i.proposalId),
  grossAmount: num(i.grossAmount),
  discountAmount: num(i.discountAmount),
  netAmount: num(i.netAmount),
  issueDate: str(i.issueDate),
  dueDate: str(i.dueDate),
  paidAt: strOrNull(i.paidAt),
  paymentMethod: str(i.paymentMethod),
  createdAt: str(i.createdAt),
  updatedAt: str(i.updatedAt || i.createdAt),
});
export const InvoiceDto = InvoiceSummaryDto.extend({
  cfop: z.string().nullable(),
  verificationCodeOrKey: z.string(),
  items: z.array(z.object({ description: z.string(), quantity: z.number(), unitValue: z.number(), totalValue: z.number() })),
});
const toInvoice = (i: any): z.infer<typeof InvoiceDto> => ({
  ...toInvoiceSummary(i),
  cfop: strOrNull(i.cfop),
  verificationCodeOrKey: str(i.verificationCodeOrKey),
  items: (Array.isArray(i.itemsDescription) ? i.itemsDescription : []).slice(0, 500).map((it: any) => ({
    description: str(it?.description),
    quantity: num(it?.quantity),
    unitValue: num(it?.unitValue),
    totalValue: num(it?.totalValue),
  })),
});

/** Configuracoes fiscais: allowlist SEM CSC, token do CSC, CNPJ do certificado ou autXML. */
export const FiscalSettingsDto = z.object({
  nfe: z.object({ environment: z.string(), serie: z.string(), simplifiedDanfe: z.boolean() }),
  nfce: z.object({ environment: z.string(), serie: z.string(), cscConfigured: z.boolean() }),
  nfse: z.object({ environment: z.string(), standard: z.string(), rpsSerie: z.string() }),
  xmlDownloadAuthorizationsCount: z.number(),
  certificate: z.object({ status: z.string(), validUntil: z.string().nullable() }),
  updatedAt: z.string().nullable(),
});

const GcStatusDto = z.object({
  connected: z.boolean(),
  storeName: z.string().nullable(),
  mcpStatus: z.string().nullable(),
  lastSyncAt: z.string().nullable(),
  recentSyncs: z.array(z.object({ timestamp: z.string(), status: z.string(), summary: z.string(), recordsSynced: z.number() })),
});

// ---------------------------------------------------------------------------
// PAINEL / SINCRONIZACAO
// ---------------------------------------------------------------------------
export const erpDashboardGet = defineUseCase({
  ...base,
  operationId: 'erp.dashboard.get',
  toolName: 'erp_dashboard_get',
  path: '/api/v1/erp/dashboard',
  pathParams: [],
  summary: 'Painel do ERP',
  description:
    'Painel do ERP (propostas feitas/aprovadas, vendas e, com alcada Financeiro, faturado/recebido/pago e saldos) dos ultimos 6 meses. Exige carteira TODOS.',
  requiredScope: 'erp:dashboard:read',
  inputSchema: z.object({ month: MonthSchema.optional() }).strict(),
  outputSchema: one(AggregateSchema),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:dashboard:read');
    requireAllPortfolio(ctx, 'O painel do ERP');
    const finance = userHasErpAccess(ctx.owner, 'finance', 'VIEW');
    const body = unwrapRead(
      await ctx.data.read('/api/erp/dashboard', { ...(input.month ? { mes: input.month } : {}), ...(finance ? {} : { _integrationIncludeFinance: '0' }) }),
      'Painel'
    );
    const data = body?.data && typeof body.data === 'object' ? { ...(body.data as Record<string, unknown>) } : {};
    // Correcao CISO (Lote 1, a): saldo bancario so com canViewBankBalances (mesma regra dos saldos
    // em contas bancarias). Sem a permissao => campos de saldo null (nunca o valor).
    const banks = ctx.owner.erpAccess.canViewBankBalances === true;
    if (data.summary && typeof data.summary === 'object') {
      data.summary = { ...(data.summary as Record<string, unknown>), ...(banks ? {} : { availableBalanceToday: null, bankAccountsSummaryText: null }) };
    }
    data.bankBalancesVisible = banks && data.financeVisible !== false;
    return { data };
  },
});

export const erpSyncStatusGet = defineUseCase({
  ...base,
  operationId: 'erp.sync_status.get',
  toolName: 'erp_sync_status_get',
  path: '/api/v1/erp/sync-status',
  pathParams: [],
  summary: 'Status da sincronizacao com o ERP de origem',
  description: 'Status da conexao e das ultimas sincronizacoes (somente leitura; sem credenciais, sem disparo). Exige carteira TODOS.',
  requiredScope: 'erp:dashboard:read',
  inputSchema: z.object({}).strict(),
  outputSchema: one(GcStatusDto),
  async handler(_input, ctx) {
    requireOwnerScope(ctx, 'erp:dashboard:read');
    requireAllPortfolio(ctx, 'O status da sincronizacao');
    const cfg: any = (await collections(ctx)).gestaoClickConfig || {};
    const hist = Array.isArray(cfg.syncHistory) ? cfg.syncHistory : [];
    return {
      data: {
        connected: cfg.connected === true,
        storeName: strOrNull(cfg.storeName),
        mcpStatus: strOrNull(cfg.mcpStatus),
        lastSyncAt: strOrNull(cfg.lastSyncAt),
        recentSyncs: hist.slice(-10).reverse().map((h: any) => ({
          timestamp: str(h?.timestamp),
          status: str(h?.status),
          summary: str(h?.summary).slice(0, 500),
          recordsSynced: num(h?.recordsSynced),
        })),
      },
    };
  },
});

// ---------------------------------------------------------------------------
// PROPOSTAS / ORCAMENTOS
// ---------------------------------------------------------------------------
export async function loadOwnedProposal(ctx: UseCaseContext, id: string): Promise<ErpCommercialProposal> {
  const res = await ctx.data.read(`/api/erp/proposals/${encodeURIComponent(id)}`);
  const body = unwrapRead(res, 'Proposta');
  const p = body?.data as ErpCommercialProposal | undefined;
  if (!p || typeof p !== 'object' || !p.id) throw notFound('Proposta');
  const o = erpOwner(ctx);
  if (o && !proposalOwnedBy(p, o)) throw notFound('Proposta');
  return p;
}

export const erpProposalsList = defineUseCase({
  ...base,
  operationId: 'erp.proposals.list',
  toolName: 'erp_proposals_list',
  path: '/api/v1/erp/proposals',
  pathParams: [],
  summary: 'Listar orcamentos/propostas',
  description:
    'Lista orcamentos/propostas comerciais. Carteira PROPRIOS/EQUIPE: so as do dono da credencial (como a tela do ERP); TODOS: todas. Busca por codigo/titulo/cliente, filtro por situacao, empresa ou negocio.',
  requiredScope: 'erp:proposals:read',
  inputSchema: z
    .object({
      limit: LimitSchema,
      cursor: CursorSchema,
      search: SearchSchema,
      status: z.string().regex(/^[A-Z_]{2,40}$/).optional(),
      companyId: IdSchema.optional(),
      dealId: IdSchema.optional(),
    })
    .strict(),
  outputSchema: listOf(ProposalSummaryDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:proposals:read');
    const o = erpOwner(ctx);
    const offset = decodeOffset(input.cursor);
    const query: Record<string, string> = {
      limit: String(input.limit),
      offset: String(offset),
      ...(input.search ? { q: input.search } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.companyId ? { companyId: input.companyId } : {}),
      ...(input.dealId ? { dealId: input.dealId } : {}),
      ...(o ? { _integrationOwnerId: o.id, _integrationOwnerEmail: o.email } : {}),
    };
    const body = unwrapRead(await ctx.data.read('/api/erp/proposals', query), 'Propostas');
    let rows = (Array.isArray(body?.data) ? body.data : []) as ErpCommercialProposal[];
    // Defesa em profundidade: carteira conferida de novo aqui (modo tabela e JSON).
    if (o) rows = rows.filter((p) => proposalOwnedBy(p, o));
    if (body?.storage === 'table') {
      const total = Math.max(0, Number(body.total) || 0);
      const next = offset + input.limit < total ? encodeOffset(offset + input.limit) : null;
      return { data: rows.slice(0, input.limit).map(toProposalSummary), page: { limit: input.limit, nextCursor: next, total } };
    }
    // Modo JSON: a rota devolve a lista completa; filtros e paginacao aqui.
    const filtered = rows
      .filter(
        (p) =>
          (!input.status || p.status === input.status) &&
          (!input.companyId || p.companyId === input.companyId) &&
          (!input.dealId || p.dealId === input.dealId) &&
          includesText(input.search, p.code, p.title, p.companyName, p.contactName)
      )
      .sort((a, b) => str(b.updatedAt || b.createdAt).localeCompare(str(a.updatedAt || a.createdAt)) || a.id.localeCompare(b.id));
    const { data, page } = paginate(filtered, input.limit, input.cursor);
    return { data: data.map(toProposalSummary), page };
  },
});

export const erpProposalsGet = defineUseCase({
  ...base,
  operationId: 'erp.proposals.get',
  toolName: 'erp_proposals_get',
  path: '/api/v1/erp/proposals/{id}',
  pathParams: ['id'],
  summary: 'Obter orcamento/proposta',
  description: 'Detalhe de um orcamento/proposta (com itens) por id ou codigo. Fora da carteira responde 404.',
  requiredScope: 'erp:proposals:read',
  inputSchema: z.object({ id: IdSchema }).strict(),
  outputSchema: one(ProposalDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:proposals:read');
    return { data: toProposal(await loadOwnedProposal(ctx, input.id)) };
  },
});

export const erpProposalVersionsList = defineUseCase({
  ...base,
  operationId: 'erp.proposals.versions.list',
  toolName: 'erp_proposal_versions_list',
  path: '/api/v1/erp/proposals/{id}/versions',
  pathParams: ['id'],
  summary: 'Historico de versoes do orcamento',
  description: 'Versoes salvas de um orcamento (metadados: versao, data, autor, campos alterados). Sem restaurar.',
  requiredScope: 'erp:proposals:read',
  inputSchema: z.object({ id: IdSchema }).strict(),
  outputSchema: one(z.object({ proposalId: z.string(), code: z.string(), currentVersion: z.number(), versions: z.array(VersionDto) })),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:proposals:read');
    const p = await loadOwnedProposal(ctx, input.id);
    const body = unwrapRead(await ctx.data.read(`/api/erp/proposals/${encodeURIComponent(p.id)}/versions`), 'Proposta');
    const hist = Array.isArray(body?.data?.versionHistory) ? body.data.versionHistory : [];
    return {
      data: {
        proposalId: str(p.id),
        code: str(p.code),
        currentVersion: num(body?.data?.currentVersion || p.version || 1),
        versions: hist.slice(-200).map((v: any) => ({
          version: num(v?.version),
          versionLabel: str(v?.versionLabel),
          savedAt: str(v?.savedAt),
          savedBy: str(v?.savedBy),
          changedFields: (Array.isArray(v?.changedFields) ? v.changedFields : []).slice(0, 100).map(String),
          changeSummary: str(v?.changeSummary).slice(0, 1000),
        })),
      },
    };
  },
});

export const erpProposalAcceptanceGet = defineUseCase({
  ...base,
  operationId: 'erp.proposals.acceptance.get',
  toolName: 'erp_proposal_acceptance_get',
  path: '/api/v1/erp/proposals/{id}/acceptance',
  pathParams: ['id'],
  summary: 'Status de aceite do orcamento',
  description: 'Se o cliente aceitou, quando, e quantas vezes o link foi visto. Somente leitura (nao aprova nem gera link).',
  requiredScope: 'erp:proposals:read',
  inputSchema: z.object({ id: IdSchema }).strict(),
  outputSchema: one(
    z.object({
      proposalId: z.string(),
      code: z.string(),
      status: z.string(),
      accepted: z.boolean(),
      acceptedAt: z.string().nullable(),
      signatureModality: z.string().nullable(),
      convertedContractId: z.string().nullable(),
      firstViewedAt: z.string().nullable(),
      lastViewedAt: z.string().nullable(),
      viewCount: z.number(),
    })
  ),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:proposals:read');
    const p = await loadOwnedProposal(ctx, input.id);
    const body = unwrapRead(await ctx.data.read(`/api/erp/proposals/${encodeURIComponent(p.id)}/acceptance-status`), 'Proposta');
    const d = body?.data || {};
    return {
      data: {
        proposalId: str(d.proposalId || p.id),
        code: str(d.code || p.code),
        status: str(d.status || p.status),
        accepted: d.acceptance?.accepted === true,
        acceptedAt: strOrNull(d.acceptance?.acceptedAt),
        signatureModality: strOrNull(d.acceptance?.signatureModality),
        convertedContractId: strOrNull(d.acceptance?.convertedContractId),
        firstViewedAt: strOrNull(d.firstViewedAt),
        lastViewedAt: strOrNull(d.lastViewedAt),
        viewCount: num(d.viewCount),
      },
    };
  },
});

// ---------------------------------------------------------------------------
// CONTRATOS DE LOCACAO
// ---------------------------------------------------------------------------
export async function contractsInScope(ctx: UseCaseContext): Promise<ErpRentalContract[]> {
  const o = erpOwner(ctx);
  const owned = o ? await companyIdsOwnedBy(ctx, o) : new Set<string>();
  return (await collections(ctx)).rentalContracts.filter((c) => c && contractInScope(c, o, owned));
}
export async function findContract(ctx: UseCaseContext, id: string): Promise<ErpRentalContract> {
  const c = (await contractsInScope(ctx)).find((x) => x.id === id || norm(x.contractNumber) === norm(id));
  if (!c) throw notFound('Contrato');
  return c;
}

export const erpContractsList = defineUseCase({
  ...base,
  operationId: 'erp.contracts.list',
  toolName: 'erp_contracts_list',
  path: '/api/v1/erp/contracts',
  pathParams: [],
  summary: 'Listar contratos de locacao',
  description:
    'Lista contratos. Carteira PROPRIOS/EQUIPE: contratos do vendedor dono da credencial ou de empresas do CRM sob sua responsabilidade; TODOS: todos.',
  requiredScope: 'erp:contracts:read',
  inputSchema: z
    .object({
      limit: LimitSchema,
      cursor: CursorSchema,
      search: SearchSchema,
      status: z.string().regex(/^[A-Z_]{2,40}$/).optional(),
      companyId: IdSchema.optional(),
    })
    .strict(),
  outputSchema: listOf(ContractSummaryDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:contracts:read');
    const rows = (await contractsInScope(ctx))
      .filter(
        (c) =>
          (!input.status || c.status === input.status) &&
          (!input.companyId || c.companyId === input.companyId) &&
          includesText(input.search, c.contractNumber, c.title, c.companyName, c.externalContractNumber)
      )
      .sort((a, b) => str(b.updatedAt || b.createdAt).localeCompare(str(a.updatedAt || a.createdAt)) || a.id.localeCompare(b.id));
    const { data, page } = paginate(rows, input.limit, input.cursor);
    return { data: data.map(toContractSummary), page };
  },
});

export const erpContractsGet = defineUseCase({
  ...base,
  operationId: 'erp.contracts.get',
  toolName: 'erp_contracts_get',
  path: '/api/v1/erp/contracts/{id}',
  pathParams: ['id'],
  summary: 'Obter contrato de locacao',
  description: 'Detalhe de um contrato (com equipamentos) por id ou numero. Fora da carteira responde 404.',
  requiredScope: 'erp:contracts:read',
  inputSchema: z.object({ id: IdSchema }).strict(),
  outputSchema: one(ContractDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:contracts:read');
    return { data: toContract(await findContract(ctx, input.id)) };
  },
});

export const erpContractVersionsList = defineUseCase({
  ...base,
  operationId: 'erp.contracts.versions.list',
  toolName: 'erp_contract_versions_list',
  path: '/api/v1/erp/contracts/{id}/versions',
  pathParams: ['id'],
  summary: 'Historico de versoes do contrato',
  description: 'Versoes salvas de um contrato (metadados). Sem restaurar.',
  requiredScope: 'erp:contracts:read',
  inputSchema: z.object({ id: IdSchema }).strict(),
  outputSchema: one(z.object({ contractId: z.string(), contractNumber: z.string(), currentVersion: z.number(), versions: z.array(VersionDto) })),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:contracts:read');
    const c = await findContract(ctx, input.id);
    const hist = Array.isArray(c.versionHistory) ? c.versionHistory : [];
    return {
      data: {
        contractId: str(c.id),
        contractNumber: str(c.contractNumber),
        currentVersion: num(c.version || 1),
        versions: hist.slice(-200).map((v: any) => ({
          version: num(v?.versionNumber),
          versionLabel: str(v?.versionLabel),
          savedAt: str(v?.savedAt),
          savedBy: str(v?.savedBy),
          changedFields: (Array.isArray(v?.changedFields) ? v.changedFields : []).slice(0, 100).map(String),
          changeSummary: str(v?.changeSummary).slice(0, 1000),
        })),
      },
    };
  },
});

// ---------------------------------------------------------------------------
// OS, VENDAS, COMPRAS
// ---------------------------------------------------------------------------
const OS_PAGE = 200;
/**
 * Sugestao CISO (Lote 1): cada pagina recarrega o estado; teto de 10 paginas (2.000 OS) por
 * chamada. Acima disso => 422 pedindo filtro (nunca lista parcial, que esconderia OS da carteira).
 */
export const OS_MAX_PAGES_PER_CALL = 10;
/** Cache por requisicao (a porta de dados e criada por requisicao): mesma consulta nao recarrega. */
const osCache = new WeakMap<object, Map<string, Promise<ErpServiceOrder[]>>>();

/** Todas as OS (modo tabela ou JSON) pela rota da tela, paginando com teto por chamada. */
export async function allServiceOrders(ctx: UseCaseContext, filters: Record<string, string>): Promise<ErpServiceOrder[]> {
  let byPort = osCache.get(ctx.data);
  if (!byPort) {
    byPort = new Map();
    osCache.set(ctx.data, byPort);
  }
  const key = JSON.stringify(Object.entries(filters).sort());
  const hit = byPort.get(key);
  if (hit) return hit;
  const run = (async () => {
    const out: ErpServiceOrder[] = [];
    for (let page = 0; page < OS_MAX_PAGES_PER_CALL; page += 1) {
      const body = unwrapRead(await ctx.data.read('/api/erp/service-orders', { ...filters, limit: String(OS_PAGE), offset: String(page * OS_PAGE) }), 'Ordens de servico');
      const rows = (Array.isArray(body?.data) ? body.data : []) as ErpServiceOrder[];
      out.push(...rows);
      if (rows.length < OS_PAGE || out.length >= Number(body?.total || 0)) return out;
    }
    throw new UseCaseError(422, 'TOO_MANY_RECORDS', `Mais de ${OS_MAX_PAGES_PER_CALL * OS_PAGE} OS nesta consulta: refine com search/status/companyId.`);
  })();
  byPort.set(key, run);
  run.catch(() => byPort!.delete(key));
  return run;
}

export const erpServiceOrdersList = defineUseCase({
  ...base,
  operationId: 'erp.service_orders.list',
  toolName: 'erp_service_orders_list',
  path: '/api/v1/erp/service-orders',
  pathParams: [],
  summary: 'Listar ordens de servico',
  description: 'Lista OS. Carteira PROPRIOS/EQUIPE: OS em que o dono da credencial e vendedor ou tecnico; TODOS: todas.',
  requiredScope: 'erp:orders:read',
  inputSchema: z
    .object({
      limit: LimitSchema,
      cursor: CursorSchema,
      search: SearchSchema,
      status: z.string().trim().min(1).max(60).optional(),
      companyId: IdSchema.optional(),
    })
    .strict(),
  outputSchema: listOf(ServiceOrderDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:orders:read');
    const o = erpOwner(ctx);
    const filters: Record<string, string> = {
      ...(input.search ? { q: input.search } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.companyId ? { companyId: input.companyId } : {}),
    };
    if (!o) {
      const offset = decodeOffset(input.cursor);
      const body = unwrapRead(await ctx.data.read('/api/erp/service-orders', { ...filters, limit: String(input.limit), offset: String(offset) }), 'Ordens de servico');
      const rows = (Array.isArray(body?.data) ? body.data : []) as ErpServiceOrder[];
      const total = Math.max(0, Number(body?.total) || 0);
      return {
        data: rows.slice(0, input.limit).map(toServiceOrder),
        page: { limit: input.limit, nextCursor: offset + input.limit < total ? encodeOffset(offset + input.limit) : null, total },
      };
    }
    const rows = (await allServiceOrders(ctx, filters)).filter((s) => serviceOrderInScope(s, o));
    const { data, page } = paginate(rows, input.limit, input.cursor);
    return { data: data.map(toServiceOrder), page };
  },
});

export const erpServiceOrdersGet = defineUseCase({
  ...base,
  operationId: 'erp.service_orders.get',
  toolName: 'erp_service_orders_get',
  path: '/api/v1/erp/service-orders/{id}',
  pathParams: ['id'],
  summary: 'Obter ordem de servico',
  description: 'Detalhe de uma OS por id ou codigo. Fora da carteira responde 404.',
  requiredScope: 'erp:orders:read',
  inputSchema: z.object({ id: IdSchema }).strict(),
  outputSchema: one(ServiceOrderDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:orders:read');
    const o = erpOwner(ctx);
    const found = (await allServiceOrders(ctx, {})).find((s) => s.id === input.id || norm(s.code) === norm(input.id));
    if (!found || !serviceOrderInScope(found, o)) throw notFound('Ordem de servico');
    return { data: toServiceOrder(found) };
  },
});

export const erpSalesOrdersList = defineUseCase({
  ...base,
  operationId: 'erp.sales_orders.list',
  toolName: 'erp_sales_orders_list',
  path: '/api/v1/erp/sales-orders',
  pathParams: [],
  summary: 'Listar pedidos de venda',
  description: 'Lista pedidos de venda. Carteira PROPRIOS/EQUIPE: so os do vendedor dono da credencial; TODOS: todos.',
  requiredScope: 'erp:orders:read',
  inputSchema: z.object({ limit: LimitSchema, cursor: CursorSchema, search: SearchSchema, status: z.string().trim().min(1).max(60).optional() }).strict(),
  outputSchema: listOf(SaleOrderDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:orders:read');
    const o = erpOwner(ctx);
    const rows = (await collections(ctx)).salesOrders
      .filter(
        (s) =>
          s &&
          (!o || (!!norm(o.name) && norm(s.sellerName) === norm(o.name))) &&
          (!input.status || s.status === input.status) &&
          includesText(input.search, s.code, s.companyName, s.itemsSummary)
      )
      .sort((a, b) => str(b.date).localeCompare(str(a.date)) || str(a.id).localeCompare(str(b.id)));
    const { data, page } = paginate(rows, input.limit, input.cursor);
    return {
      data: data.map((s) => ({
        id: str(s.id),
        code: str(s.code),
        companyName: str(s.companyName),
        sellerName: str(s.sellerName),
        date: str(s.date),
        status: str(s.status),
        totalAmount: num(s.totalAmount),
        itemsSummary: str(s.itemsSummary).slice(0, 2000),
        saleType: strOrNull(s.saleType),
        paymentMethod: strOrNull(s.paymentMethod),
      })),
      page,
    };
  },
});

export const erpPurchaseOrdersList = defineUseCase({
  ...base,
  operationId: 'erp.purchase_orders.list',
  toolName: 'erp_purchase_orders_list',
  path: '/api/v1/erp/purchase-orders',
  pathParams: [],
  summary: 'Listar pedidos de compra',
  description: 'Lista pedidos de compra/entradas (sem dono). Exige carteira TODOS.',
  requiredScope: 'erp:orders:read',
  inputSchema: z.object({ limit: LimitSchema, cursor: CursorSchema, search: SearchSchema }).strict(),
  outputSchema: listOf(PurchaseOrderDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:orders:read');
    requireAllPortfolio(ctx, 'Pedidos de compra');
    const rows = (await collections(ctx)).purchaseOrders
      .filter((p) => p && includesText(input.search, p.code, p.supplierName, p.nfeNumber, p.itemsSummary))
      .sort((a, b) => str(b.issueDate).localeCompare(str(a.issueDate)) || str(a.id).localeCompare(str(b.id)));
    const { data, page } = paginate(rows, input.limit, input.cursor);
    return {
      data: data.map((p) => ({
        id: str(p.id),
        code: str(p.code),
        supplierName: str(p.supplierName),
        supplierCnpj: strOrNull(p.supplierCnpj),
        issueDate: str(p.issueDate),
        status: str(p.status),
        nfeNumber: str(p.nfeNumber),
        itemsSummary: strOrNull(p.itemsSummary),
        costCenter: strOrNull(p.costCenter),
        totalAmount: num(p.totalAmount),
      })),
      page,
    };
  },
});

// ---------------------------------------------------------------------------
// CATALOGO E LISTAS AUXILIARES
// ---------------------------------------------------------------------------
export const showCatalogCost = (ctx: UseCaseContext) => userHasErpAccess(ctx.owner, 'finance', 'VIEW');

export const erpCatalogList = defineUseCase({
  ...base,
  operationId: 'erp.catalog.list',
  toolName: 'erp_catalog_list',
  path: '/api/v1/erp/catalog',
  pathParams: [],
  summary: 'Listar produtos e servicos',
  description: 'Catalogo de produtos/servicos/equipamentos com estoque e precos. Custo e margem so com alcada Financeiro.',
  requiredScope: 'erp:catalog:read',
  inputSchema: z.object({ limit: LimitSchema, cursor: CursorSchema, search: SearchSchema, activeOnly: z.coerce.boolean().optional() }).strict(),
  outputSchema: listOf(CatalogItemDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:catalog:read');
    const showCost = showCatalogCost(ctx);
    const rows = (await collections(ctx)).catalog
      .filter((c) => c && (!input.activeOnly || c.isActive !== false) && includesText(input.search, c.name, c.gestaoClickCode, c.brand, c.modelName, c.barcodeEan, c.productGroup))
      .sort((a, b) => str(a.name).localeCompare(str(b.name)) || str(a.id).localeCompare(str(b.id)));
    const { data, page } = paginate(rows, input.limit, input.cursor);
    return { data: data.map((c) => toCatalogItem(c, showCost)), page };
  },
});

export const erpCatalogGet = defineUseCase({
  ...base,
  operationId: 'erp.catalog.get',
  toolName: 'erp_catalog_get',
  path: '/api/v1/erp/catalog/{id}',
  pathParams: ['id'],
  summary: 'Obter produto/servico',
  description: 'Detalhe de um item do catalogo por id ou codigo.',
  requiredScope: 'erp:catalog:read',
  inputSchema: z.object({ id: IdSchema }).strict(),
  outputSchema: one(CatalogItemDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:catalog:read');
    const c = (await collections(ctx)).catalog.find((x) => x && (x.id === input.id || norm(x.gestaoClickCode) === norm(input.id)));
    if (!c) throw notFound('Item do catalogo');
    return { data: toCatalogItem(c, showCatalogCost(ctx)) };
  },
});

export const erpAuxListsGet = defineUseCase({
  ...base,
  operationId: 'erp.aux_lists.get',
  toolName: 'erp_aux_lists_get',
  path: '/api/v1/erp/aux-lists',
  pathParams: [],
  summary: 'Listas auxiliares',
  description: 'Centros de custo e plano de contas usados nos cadastros (somente leitura).',
  requiredScope: 'erp:catalog:read',
  inputSchema: z.object({}).strict(),
  outputSchema: one(
    z.object({
      costCenters: z.array(z.object({ id: z.string(), label: z.string() })),
      chartOfAccounts: z.array(z.object({ id: z.string(), label: z.string() })),
    })
  ),
  async handler(_input, ctx) {
    requireOwnerScope(ctx, 'erp:catalog:read');
    const body = unwrapRead(await ctx.data.read('/api/erp/aux-lists'), 'Listas auxiliares');
    const pick = (l: unknown) => (Array.isArray(l) ? l : []).slice(0, 1000).map((i: any) => ({ id: str(i?.id), label: str(i?.label) }));
    return { data: { costCenters: pick(body?.data?.costCenters), chartOfAccounts: pick(body?.data?.chartOfAccountsList) } };
  },
});

// ---------------------------------------------------------------------------
// CADASTROS: FORNECEDORES E COLABORADORES
// ---------------------------------------------------------------------------
export const erpSuppliersList = defineUseCase({
  ...base,
  operationId: 'erp.suppliers.list',
  toolName: 'erp_suppliers_list',
  path: '/api/v1/erp/suppliers',
  pathParams: [],
  summary: 'Listar fornecedores',
  description: 'Fornecedores e transportadoras cadastrados.',
  requiredScope: 'erp:records:read',
  inputSchema: z.object({ limit: LimitSchema, cursor: CursorSchema, search: SearchSchema }).strict(),
  outputSchema: listOf(SupplierDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:records:read');
    const rows = (await collections(ctx)).suppliers
      .filter((s) => s && includesText(input.search, s.name, s.legalName, s.cnpj, s.email))
      .sort((a, b) => str(a.name).localeCompare(str(b.name)) || str(a.id).localeCompare(str(b.id)));
    const { data, page } = paginate(rows, input.limit, input.cursor);
    return {
      data: data.map((s) => ({
        id: str(s.id),
        name: str(s.name),
        legalName: str(s.legalName),
        cnpj: str(s.cnpj),
        supplierType: strOrNull(s.supplierType),
        email: str(s.email),
        phone: str(s.phone),
        cityState: strOrNull(s.cityState),
        active: s.active !== false,
      })),
      page,
    };
  },
});

export const erpEmployeesList = defineUseCase({
  ...base,
  operationId: 'erp.employees.list',
  toolName: 'erp_employees_list',
  path: '/api/v1/erp/employees',
  pathParams: [],
  summary: 'Listar colaboradores (sensivel)',
  description: 'Colaboradores cadastrados (nome, funcao, e-mail; telefone mascarado). DADO SENSIVEL: so administrador (SUPER_ADMIN/DIRETORIA) com carteira TODOS.',
  requiredScope: 'erp:records:read',
  inputSchema: z.object({ limit: LimitSchema, cursor: CursorSchema, search: SearchSchema }).strict(),
  outputSchema: listOf(EmployeeDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:records:read');
    requireAllPortfolio(ctx, 'Colaboradores');
    if (!isErpAdmin(ctx.owner)) {
      throw new UseCaseError(403, 'SENSITIVE_DATA_FORBIDDEN', 'Colaboradores: somente administrador (SUPER_ADMIN/DIRETORIA).');
    }
    const rows = (await collections(ctx)).employees
      .filter((e) => e && includesText(input.search, e.name, e.role, e.email))
      .sort((a, b) => str(a.name).localeCompare(str(b.name)) || str(a.id).localeCompare(str(b.id)));
    const { data, page } = paginate(rows, input.limit, input.cursor);
    return {
      data: data.map((e) => ({ id: str(e.id), name: str(e.name), role: str(e.role), email: str(e.email), phoneMasked: maskPhone(e.phone), active: e.active !== false })),
      page,
    };
  },
});

// ---------------------------------------------------------------------------
// FINANCEIRO E BANCOS
// ---------------------------------------------------------------------------
export const erpFinancialEntriesList = defineUseCase({
  ...base,
  operationId: 'erp.financial_entries.list',
  toolName: 'erp_financial_entries_list',
  path: '/api/v1/erp/financial-entries',
  pathParams: [],
  summary: 'Listar lancamentos financeiros',
  description: 'Contas a receber e a pagar (somente leitura; sem baixa). Exige carteira TODOS + alcada Financeiro (VIEW+).',
  requiredScope: 'erp:financial:read',
  inputSchema: z
    .object({
      limit: LimitSchema,
      cursor: CursorSchema,
      search: SearchSchema,
      type: z.enum(['RECEBER', 'PAGAR']).optional(),
      status: z.enum(['ABERTO', 'PAGO', 'ATRASADO']).optional(),
      dueFrom: DateFilter.optional(),
      dueTo: DateFilter.optional(),
    })
    .strict(),
  outputSchema: listOf(FinancialEntryDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:financial:read');
    requireAllPortfolio(ctx, 'O financeiro');
    const rows = (await collections(ctx)).financialEntries
      .filter(
        (f) =>
          f &&
          (!input.type || f.type === input.type) &&
          (!input.status || f.status === input.status) &&
          (!input.dueFrom || str(f.dueDate).slice(0, 10) >= input.dueFrom) &&
          (!input.dueTo || str(f.dueDate).slice(0, 10) <= input.dueTo) &&
          includesText(input.search, f.description, f.companyName, f.costCenter, f.category)
      )
      .sort((a, b) => str(b.dueDate).localeCompare(str(a.dueDate)) || str(a.id).localeCompare(str(b.id)));
    const { data, page } = paginate(rows, input.limit, input.cursor);
    return {
      data: data.map((f) => ({
        id: str(f.id),
        type: str(f.type),
        category: str(f.category),
        description: str(f.description),
        companyName: str(f.companyName),
        costCenter: str(f.costCenter),
        amount: num(f.amount),
        dueDate: str(f.dueDate),
        paidAt: strOrNull(f.paidAt),
        status: str(f.status),
        invoiceId: strOrNull(f.invoiceId),
        paymentMethod: str(f.paymentMethod),
      })),
      page,
    };
  },
});

export const erpFinancialDreGet = defineUseCase({
  ...base,
  operationId: 'erp.financial_dre.get',
  toolName: 'erp_financial_dre_get',
  path: '/api/v1/erp/dre',
  pathParams: [],
  summary: 'DRE gerencial',
  description: 'Demonstrativo de resultado da competencia (MM/AAAA). Exige carteira TODOS + alcada Financeiro (VIEW+).',
  requiredScope: 'erp:financial:read',
  inputSchema: z.object({ competenceMonth: CompetenceSchema.optional() }).strict(),
  outputSchema: one(AggregateSchema),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:financial:read');
    requireAllPortfolio(ctx, 'A DRE');
    const body = unwrapRead(await ctx.data.read('/api/erp/financial/dre', input.competenceMonth ? { competenceMonth: input.competenceMonth } : {}), 'DRE');
    const data = body?.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : {};
    return { data };
  },
});

export const erpBankAccountsList = defineUseCase({
  ...base,
  operationId: 'erp.bank_accounts.list',
  toolName: 'erp_bank_accounts_list',
  path: '/api/v1/erp/bank-accounts',
  pathParams: [],
  summary: 'Contas e saldos bancarios (sensivel)',
  description: 'Contas bancarias e saldos. DADO SENSIVEL: exige carteira TODOS + alcada Financeiro (VIEW+) + permissao "ver saldos bancarios". Sem movimentacao.',
  requiredScope: 'erp:banks:read',
  inputSchema: z.object({}).strict(),
  outputSchema: z.object({ data: z.array(BankAccountDto) }),
  async handler(_input, ctx) {
    requireOwnerScope(ctx, 'erp:banks:read');
    requireAllPortfolio(ctx, 'Saldos bancarios');
    const rows = (await collections(ctx)).bankAccounts.filter(Boolean).slice(0, 200);
    return {
      data: rows.map((b) => ({ id: str(b.id), name: str(b.name), balance: num(b.balance), status: str(b.status), lastMovedAt: str(b.lastMovedAt) })),
    };
  },
});

// ---------------------------------------------------------------------------
// FISCAL
// ---------------------------------------------------------------------------
export const erpInvoicesList = defineUseCase({
  ...base,
  operationId: 'erp.invoices.list',
  toolName: 'erp_invoices_list',
  path: '/api/v1/erp/invoices',
  pathParams: [],
  summary: 'Listar notas fiscais e faturas',
  description: 'Notas/faturas emitidas (somente leitura; sem emitir, cancelar ou dar baixa). Exige carteira TODOS + alcada Fiscal (VIEW+).',
  requiredScope: 'erp:fiscal:read',
  inputSchema: z
    .object({
      limit: LimitSchema,
      cursor: CursorSchema,
      search: SearchSchema,
      status: z.string().regex(/^[A-Z_]{2,40}$/).optional(),
      competenceMonth: z.string().regex(/^[0-9/-]{6,10}$/).optional(),
      companyId: IdSchema.optional(),
    })
    .strict(),
  outputSchema: listOf(InvoiceSummaryDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:fiscal:read');
    requireAllPortfolio(ctx, 'O fiscal');
    const rows = ((await collections(ctx)).invoices as any[])
      .filter(
        (i) =>
          i &&
          (!input.status || i.status === input.status) &&
          (!input.competenceMonth || i.competenceMonth === input.competenceMonth) &&
          (!input.companyId || i.companyId === input.companyId) &&
          includesText(input.search, i.documentNumber, i.companyName, i.companyCnpj)
      )
      .sort((a, b) => str(b.issueDate).localeCompare(str(a.issueDate)) || str(a.id).localeCompare(str(b.id)));
    const { data, page } = paginate(rows, input.limit, input.cursor);
    return { data: data.map(toInvoiceSummary), page };
  },
});

export const erpInvoicesGet = defineUseCase({
  ...base,
  operationId: 'erp.invoices.get',
  toolName: 'erp_invoices_get',
  path: '/api/v1/erp/invoices/{id}',
  pathParams: ['id'],
  summary: 'Obter nota fiscal/fatura',
  description: 'Detalhe de uma nota/fatura (itens, CFOP, chave). Sem PIX copia-e-cola, linha digitavel ou XML. Exige carteira TODOS + alcada Fiscal.',
  requiredScope: 'erp:fiscal:read',
  inputSchema: z.object({ id: IdSchema }).strict(),
  outputSchema: one(InvoiceDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:fiscal:read');
    requireAllPortfolio(ctx, 'O fiscal');
    const inv = ((await collections(ctx)).invoices as any[]).find((i) => i && (i.id === input.id || norm(i.documentNumber) === norm(input.id)));
    if (!inv) throw notFound('Nota fiscal');
    return { data: toInvoice(inv) };
  },
});

export const erpFiscalSettingsGet = defineUseCase({
  ...base,
  operationId: 'erp.fiscal_settings.get',
  toolName: 'erp_fiscal_settings_get',
  path: '/api/v1/erp/fiscal-settings',
  pathParams: [],
  summary: 'Configuracoes fiscais (mascaradas)',
  description: 'Ambiente e serie de NF-e/NFC-e/NFS-e e situacao do certificado. Segredos (CSC, token do CSC) NUNCA saem. Exige carteira TODOS + alcada Fiscal.',
  requiredScope: 'erp:fiscal:read',
  inputSchema: z.object({}).strict(),
  outputSchema: one(FiscalSettingsDto),
  async handler(_input, ctx) {
    requireOwnerScope(ctx, 'erp:fiscal:read');
    requireAllPortfolio(ctx, 'O fiscal');
    const s: any = (await collections(ctx)).fiscalDocumentSettings || {};
    return {
      data: {
        nfe: { environment: str(s.nfe?.environment || 'HOMOLOGACAO'), serie: str(s.nfe?.serie), simplifiedDanfe: s.nfe?.simplifiedDanfe === true },
        nfce: { environment: str(s.nfce?.environment || 'HOMOLOGACAO'), serie: str(s.nfce?.serie), cscConfigured: Boolean(s.nfce?.csc) },
        nfse: { environment: str(s.nfse?.environment || 'HOMOLOGACAO'), standard: str(s.nfse?.standard), rpsSerie: str(s.nfse?.rpsSerie) },
        xmlDownloadAuthorizationsCount: Array.isArray(s.xmlDownloadAuthorizations) ? s.xmlDownloadAuthorizations.length : 0,
        certificate: { status: str(s.certificate?.status || 'NAO_CONFIGURADO'), validUntil: strOrNull(s.certificate?.validUntil) },
        updatedAt: strOrNull(s.updatedAt),
      },
    };
  },
});

export const ERP_USE_CASES = [
  erpDashboardGet,
  erpSyncStatusGet,
  erpProposalsList,
  erpProposalsGet,
  erpProposalVersionsList,
  erpProposalAcceptanceGet,
  erpContractsList,
  erpContractsGet,
  erpContractVersionsList,
  erpServiceOrdersList,
  erpServiceOrdersGet,
  erpSalesOrdersList,
  erpPurchaseOrdersList,
  erpCatalogList,
  erpCatalogGet,
  erpAuxListsGet,
  erpSuppliersList,
  erpEmployeesList,
  erpFinancialEntriesList,
  erpFinancialDreGet,
  erpBankAccountsList,
  erpInvoicesList,
  erpInvoicesGet,
  erpFiscalSettingsGet,
];
