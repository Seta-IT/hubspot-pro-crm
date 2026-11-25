// ============================================================================
// STI-hub — API v1 + MCP: Fase 2 / Lote 2 — ESCRITAS REVERSIVEIS no ERP (24/11/2026).
// Orcamentos (criar/editar/restaurar versao), contratos (criar/editar/restaurar/renovar),
// OS (criar/mudar situacao/duplicar/abrir a partir de chamado), pedidos de venda e compra,
// catalogo, listas auxiliares, fornecedores e lancamentos financeiros em aberto.
//
// Travas (fail-closed, contexto interno confiavel => tudo conferido AQUI):
// - escopo :write + modulo ERP + alcada de EDICAO da tela; carteira (dono) ou TODOS quando a
//   entidade nao tem dono (catalogo, listas, fornecedores, compras, financeiro);
// - Zod strict: campo fora da allowlist => 400; valor mascarado (***) => 422;
// - nunca: aprovar/aceitar/converter orcamento, link publico, envio de e-mail, gerar fatura/NF/
//   remessa (generateNextInvoiceOnSave sempre false), baixa/pagamento, importar XML, excluir;
// - auditoria antes/depois (recordWriteAudit) e Idempotency-Key obrigatoria nas criacoes.
// ============================================================================
import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import type { ErpCommercialProposal, ErpRentalContract, ErpServiceOrder, ServiceTicket } from '../../../db/types';
import { nextServiceOrderCode, SERVICE_ORDER_STATUSES } from '../../erp/service-order-workflow';
import { companyInScope, contactInScope, dealInScope, ticketInScope } from '../portfolio';
import {
  erpFullControl,
  recordWriteAudit,
  rejectMaskedValues,
  requireAllPortfolio,
  requireOwnerAccess,
  requireOwnerScope,
  unwrapWrite,
  userHasErpAccess,
} from './common';
import {
  allServiceOrders,
  CatalogItemDto,
  collections,
  ContractDto,
  erpOwner,
  FinancialEntryDto,
  findContract,
  loadOwnedProposal,
  norm,
  num,
  ProposalDto,
  PurchaseOrderDto,
  SaleOrderDto,
  ServiceOrderDto,
  serviceOrderInScope,
  showCatalogCost,
  str,
  strOrNull,
  SupplierDto,
  toCatalogItem,
  toContract,
  toProposal,
  toServiceOrder,
} from './erp';
import { defineUseCase, IdSchema, IsoDateSchema, notFound, text, UseCaseError, type UseCaseContext } from './types';

const one = <T extends z.ZodType>(item: T) => z.object({ data: item });

const w = {
  tag: 'ERP' as const,
  requiredModule: 'erp' as const,
  domain: 'erp' as const,
  mutation: true,
};
const createBase = { ...w, method: 'POST' as const, idempotent: false, successStatus: 201 as const, requireIdempotencyKey: true };
const updateBase = { ...w, method: 'PATCH' as const, idempotent: true, successStatus: 200 as const };
const actionBase = { ...w, method: 'POST' as const, idempotent: false, successStatus: 200 as const };

const money = z.number().finite().min(0).max(1_000_000_000);
const pct = z.number().finite().min(0).max(100);
const DateText = z.string().trim().regex(/^(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})$/, 'data invalida (AAAA-MM-DD ou DD/MM/AAAA)');
const newId = (prefix: string) => `${prefix}-api-${randomUUID().slice(0, 18)}`;
const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

function nonEmpty(patch: Record<string, unknown>): void {
  if (Object.keys(patch).length === 0) throw new UseCaseError(422, 'EMPTY_PATCH', 'Nenhum campo para atualizar.');
}

/** Empresa/contato/negocio do CRM vinculados: inexistente ou fora da carteira => 404 neutro. */
async function crmLinks(ctx: UseCaseContext, ids: { companyId?: string | null; contactId?: string | null; dealId?: string | null }) {
  if (!ids.companyId && !ids.contactId && !ids.dealId) return { company: undefined, contact: undefined, deal: undefined };
  const snap = await ctx.data.snapshot('crm');
  const company = ids.companyId ? snap.companies.find((c) => c.id === ids.companyId) : undefined;
  if (ids.companyId && (!company || !companyInScope(ctx.portfolio, company))) throw notFound('Empresa');
  const contact = ids.contactId ? snap.contacts.find((c) => c.id === ids.contactId) : undefined;
  if (ids.contactId && (!contact || !contactInScope(ctx.portfolio, contact))) throw notFound('Contato');
  const deal = ids.dealId ? snap.deals.find((d) => d.id === ids.dealId) : undefined;
  if (ids.dealId && (!deal || !dealInScope(ctx.portfolio, deal))) throw notFound('Negocio');
  return { company, contact, deal };
}

/** Vendedor responsavel: PROPRIOS/EQUIPE => sempre o dono; TODOS => usuario ativo informado (ou o dono). */
function resolveSeller(ctx: UseCaseContext, sellerUserId: string | undefined): { id: string; name: string; email: string } {
  if (!sellerUserId || sellerUserId === ctx.owner.id) return { id: ctx.owner.id, name: ctx.owner.name, email: ctx.owner.email };
  if (ctx.auth.portfolioScope !== 'TODOS') {
    throw new UseCaseError(403, 'OWNER_IMMUTABLE', 'Com carteira PROPRIOS/EQUIPE o responsavel e sempre o dono da credencial.', { fields: ['sellerUserId'] });
  }
  const u = ctx.allUsers.find((x) => x.id === sellerUserId && x.active);
  if (!u) throw new UseCaseError(422, 'SELLER_INVALID', 'Vendedor informado nao existe ou esta inativo.', { fields: ['sellerUserId'] });
  return { id: u.id, name: u.name, email: u.email };
}

function maxDiscount(ctx: UseCaseContext): number {
  const v = Number(ctx.owner.erpAccess?.maxDiscountPercent);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

// ---------------------------------------------------------------------------
// ORCAMENTOS / PROPOSTAS
// ---------------------------------------------------------------------------
/** Situacoes que o conector pode gravar. Aprovar/converter (e "Enviada") ficam so na tela. */
const ProposalStatusInput = z.enum(['RASCUNHO', 'EM_NEGOCIACAO', 'RECUSADA']);
const LOCKED_PROPOSAL_STATUS = new Set(['APROVADA', 'CONVERTIDA_CONTRATO']);
const FiscalNatureInput = z.enum(['LOCACAO_BENS_MOVEIS', 'SERVICO_TECNICO_TI_TELECOM', 'SERVICO_COMUNICACAO_SCM_SVA', 'VENDA_EQUIPAMENTO']);
const ProposalItemInput = z
  .object({
    sku: text(80).optional(),
    description: text(500).min(1),
    itemType: z.enum(['PRODUCT', 'SERVICE']).optional(),
    unit: text(20).optional(),
    fiscalNature: FiscalNatureInput.optional(),
    ncmOrServiceCode: text(30).optional(),
    quantity: z.number().finite().positive().max(1_000_000),
    unitPrice: money,
    discountPercent: pct.optional(),
    isRecurring: z.boolean().optional(),
  })
  .strict();
const proposalFields = () =>
  ({
    budgetType: z.enum(['PRODUTOS', 'SERVICOS', 'CONJUNTO', 'LOCACAO', 'SPARE_PARTS']).optional(),
    companyId: IdSchema.optional(),
    companyName: text(200).min(1).optional(),
    contactId: IdSchema.optional(),
    contactName: text(200).optional(),
    dealId: IdSchema.optional(),
    contractMonths: z.number().int().min(0).max(120).optional(),
    readjustmentIndex: z.enum(['IPCA', 'IGP-M', 'FIXO', 'IST_ANATEL']).optional(),
    paymentCondition: text(300).optional(),
    validUntil: IsoDateSchema.optional(),
    deliveryLeadTime: text(200).optional(),
    shippingCost: money.optional(),
    discountPercentGlobal: pct.optional(),
    commercialNotes: text(8000).optional(),
    technicalClauses: text(8000).optional(),
    status: ProposalStatusInput.optional(),
    sellerUserId: IdSchema.optional(),
  }) as const;
const ProposalItems = z.array(ProposalItemInput).min(1).max(200);

function checkDiscounts(ctx: UseCaseContext, input: { discountPercentGlobal?: number; items?: Array<{ discountPercent?: number }> }) {
  const cap = maxDiscount(ctx);
  const over: string[] = [];
  if ((input.discountPercentGlobal ?? 0) > cap) over.push('discountPercentGlobal');
  (input.items || []).forEach((i, idx) => {
    if ((i.discountPercent ?? 0) > cap) over.push(`items[${idx}].discountPercent`);
  });
  if (over.length) {
    throw new UseCaseError(403, 'DISCOUNT_ABOVE_LIMIT', `Desconto acima do teto do usuario dono (${cap}%).`, { fields: over, maxDiscountPercent: cap });
  }
}

async function proposalBody(ctx: UseCaseContext, input: Record<string, unknown>) {
  const { sellerUserId, items, ...rest } = input as Record<string, unknown> & { items?: Array<Record<string, unknown>> };
  const body: Record<string, unknown> = { ...rest };
  const links = await crmLinks(ctx, { companyId: rest.companyId as string, contactId: rest.contactId as string, dealId: rest.dealId as string });
  if (links.company) {
    body.companyName = links.company.name;
    body.companyCnpj = str(links.company.cnpj);
  }
  if (links.contact && !rest.contactName) body.contactName = `${str(links.contact.firstName)} ${str(links.contact.lastName)}`.trim();
  if (items) {
    body.items = items.map((i) => ({
      id: newId('it'),
      sku: str(i.sku),
      description: i.description,
      ...(i.itemType ? { itemType: i.itemType } : {}),
      ...(i.unit ? { unit: i.unit } : {}),
      fiscalNature: i.fiscalNature || (i.itemType === 'SERVICE' ? 'SERVICO_TECNICO_TI_TELECOM' : 'LOCACAO_BENS_MOVEIS'),
      ncmOrServiceCode: str(i.ncmOrServiceCode),
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discountPercent: i.discountPercent ?? 0,
      isRecurring: i.isRecurring === true,
      totalMonthly: 0,
    }));
  }
  return { body, sellerUserId: sellerUserId as string | undefined };
}

function assertProposalUnlocked(p: ErpCommercialProposal): void {
  if (LOCKED_PROPOSAL_STATUS.has(str(p.status)) || p.convertedContractId) {
    throw new UseCaseError(409, 'PROPOSAL_LOCKED', 'Orcamento aprovado/convertido nao e alterado pela integracao.');
  }
}

export const erpProposalsCreate = defineUseCase({
  ...createBase,
  operationId: 'erp.proposals.create',
  toolName: 'erp_proposals_create',
  path: '/api/v1/erp/proposals',
  pathParams: [],
  summary: 'Criar orcamento/proposta',
  description:
    'Cria um orcamento (RASCUNHO, EM_NEGOCIACAO ou RECUSADA). Vendedor = dono da credencial (outro so com carteira TODOS). Desconto limitado ao teto do usuario. ' +
    'Sem aprovar/aceitar/converter, gerar link publico, enviar ou criar negocio no CRM. Idempotency-Key obrigatoria.',
  requiredScope: 'erp:proposals:write',
  inputSchema: z.object({ title: text(200).min(1), items: ProposalItems, ...proposalFields() }).strict(),
  outputSchema: one(ProposalDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:proposals:write');
    rejectMaskedValues(input);
    checkDiscounts(ctx, input);
    if (!input.companyId && !input.companyName) {
      throw new UseCaseError(422, 'COMPANY_REQUIRED', 'Informe companyId (empresa do CRM) ou companyName.', { fields: ['companyId', 'companyName'] });
    }
    const { body, sellerUserId } = await proposalBody(ctx, input);
    const seller = resolveSeller(ctx, sellerUserId);
    body.sellerName = seller.name;
    body.sellerEmail = seller.email;
    body.status = input.status || 'RASCUNHO';
    const created = unwrapWrite(await ctx.data.write('POST', '/api/erp/proposals', body), 'Proposta') as ErpCommercialProposal;
    const out = toProposal(created);
    recordWriteAudit(ctx, 'erp.proposal', 'create', out.id, null, out);
    return { data: out };
  },
});

export const erpProposalsUpdate = defineUseCase({
  ...updateBase,
  operationId: 'erp.proposals.update',
  toolName: 'erp_proposals_update',
  path: '/api/v1/erp/proposals/{id}',
  pathParams: ['id'],
  summary: 'Editar orcamento/proposta',
  description:
    'Edita campos permitidos (PATCH strict) de um orcamento da carteira. Orcamento APROVADO/CONVERTIDO nao e editado (409). ' +
    'Situacao so RASCUNHO/EM_NEGOCIACAO/RECUSADA. Troca de vendedor so com carteira TODOS. expectedUpdatedAt opcional (controle otimista).',
  requiredScope: 'erp:proposals:write',
  inputSchema: z
    .object({ id: IdSchema, expectedUpdatedAt: z.string().max(40).optional(), title: text(200).min(1).optional(), items: ProposalItems.optional(), ...proposalFields() })
    .strict(),
  outputSchema: one(ProposalDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:proposals:write');
    const { id, expectedUpdatedAt, ...patch } = input;
    nonEmpty(patch);
    rejectMaskedValues(patch);
    checkDiscounts(ctx, patch);
    const current = await loadOwnedProposal(ctx, id);
    assertProposalUnlocked(current);
    const { body, sellerUserId } = await proposalBody(ctx, patch);
    if (sellerUserId !== undefined) {
      const seller = resolveSeller(ctx, sellerUserId);
      body.sellerName = seller.name;
      body.sellerEmail = seller.email;
    }
    if (expectedUpdatedAt) body.expectedUpdatedAt = expectedUpdatedAt;
    const updated = unwrapWrite(await ctx.data.write('PATCH', `/api/erp/proposals/${encodeURIComponent(current.id)}`, body), 'Proposta') as ErpCommercialProposal;
    const out = toProposal(updated);
    recordWriteAudit(ctx, 'erp.proposal', 'update', out.id, toProposal(current), out);
    return { data: out };
  },
});

export const erpProposalRestoreVersion = defineUseCase({
  ...actionBase,
  idempotent: true,
  operationId: 'erp.proposals.restore_version',
  toolName: 'erp_proposal_restore_version',
  path: '/api/v1/erp/proposals/{id}/restore-version',
  pathParams: ['id'],
  summary: 'Restaurar versao de orcamento',
  description:
    'Restaura uma revisao anterior (gera nova versao). Bloqueado se o orcamento estiver aprovado/convertido, se a revisao levar a APROVADA/CONVERTIDA ' +
    'ou (carteira PROPRIOS/EQUIPE) se a revisao trocar o vendedor.',
  requiredScope: 'erp:proposals:write',
  inputSchema: z.object({ id: IdSchema, targetVersion: z.number().int().min(1).max(10_000) }).strict(),
  outputSchema: one(ProposalDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:proposals:write');
    const current = await loadOwnedProposal(ctx, input.id);
    assertProposalUnlocked(current);
    const entry = (Array.isArray(current.versionHistory) ? current.versionHistory : []).find((v) => Number(v.version) === input.targetVersion);
    if (!entry) throw notFound('Versao do orcamento');
    const snap = asRecord(entry.snapshot);
    if (LOCKED_PROPOSAL_STATUS.has(str(snap.status).trim().toUpperCase())) {
      throw new UseCaseError(403, 'PROPOSAL_STATUS_RESTORE_FORBIDDEN', 'Esta revisao mudaria a situacao para Aprovada/Convertida.');
    }
    if (ctx.auth.portfolioScope !== 'TODOS' && snap.sellerEmail !== undefined && norm(snap.sellerEmail) !== norm(current.sellerEmail)) {
      throw new UseCaseError(403, 'PROPOSAL_OWNER_IMMUTABLE', 'A revisao trocaria o vendedor (so carteira TODOS).', { fields: ['sellerEmail'] });
    }
    const restored = unwrapWrite(
      await ctx.data.write('POST', `/api/erp/proposals/${encodeURIComponent(current.id)}/restore-version`, {
        targetVersion: input.targetVersion,
        restoredBy: `${ctx.owner.name} (API v1)`,
      }),
      'Proposta'
    ) as ErpCommercialProposal;
    const out = toProposal(restored);
    recordWriteAudit(ctx, 'erp.proposal', 'restore_version', out.id, toProposal(current), out);
    return { data: out };
  },
});

// ---------------------------------------------------------------------------
// CONTRATOS DE LOCACAO (nunca fatura/remessa/NF: generateNextInvoiceOnSave sempre false)
// ---------------------------------------------------------------------------
const ContractStatusInput = z.enum(['ATIVO', 'EM_IMPLANTACAO', 'RENOVACAO_PROXIMA', 'PENDENTE_ASSINATURA', 'SUSPENSO']);
const EquipmentInput = z
  .object({
    id: IdSchema.optional(),
    sku: text(80).optional(),
    description: text(500).min(1),
    serialNumber: text(120).optional(),
    ncm: text(20).optional(),
    quantity: z.number().finite().positive().max(100_000),
    unitMonthlyRent: money,
  })
  .strict();
const Equipments = z.array(EquipmentInput).min(1).max(500);
const contractFields = () =>
  ({
    companyId: IdSchema.optional(),
    companyName: text(200).min(1).optional(),
    contactId: IdSchema.optional(),
    dealId: IdSchema.optional(),
    proposalId: IdSchema.optional(),
    monthlyValue: money.optional(),
    dueDay: z.number().int().min(1).max(31).optional(),
    startDate: IsoDateSchema.optional(),
    endDate: IsoDateSchema.optional(),
    contractMonths: z.number().int().min(1).max(120).optional(),
    readjustmentIndex: z.enum(['IPCA', 'IGP-M', 'FIXO', 'IST_ANATEL']).optional(),
    status: ContractStatusInput.optional(),
    contractTemplateModel: z.enum(['MODELO_LOCACAO_BENS_MOVEIS', 'MODELO_PRESTACAO_SERVICOS_TI', 'MODELO_TERMO_ASSINATURA_CLOUD']).optional(),
    customClausesText: text(20000).optional(),
    contractNotes: text(8000).optional(),
    costCenter: text(120).optional(),
    chartOfAccounts: text(120).optional(),
    paymentMethod: text(80).optional(),
    externalContractNumber: text(80).optional(),
    customerPurchaseOrderNumber: text(80).optional(),
    discountPercent: pct.optional(),
    sellerUserId: IdSchema.optional(),
  }) as const;

/** Monta o corpo do contrato; equipamentos existentes preservam campos do servidor (remessa, patrimonio). */
async function contractBody(ctx: UseCaseContext, input: Record<string, unknown>, current: ErpRentalContract | null) {
  const { sellerUserId, equipments, ...rest } = input as Record<string, unknown> & { equipments?: Array<Record<string, unknown>> };
  const body: Record<string, unknown> = { ...rest };
  const links = await crmLinks(ctx, { companyId: rest.companyId as string, contactId: rest.contactId as string, dealId: rest.dealId as string });
  if (links.company) {
    body.companyName = links.company.name;
    body.companyCnpj = str(links.company.cnpj);
  }
  if (equipments) {
    const prev = new Map((current?.equipments || []).filter((e) => e && typeof e === 'object').map((e) => [e.id, e]));
    body.equipments = equipments.map((e) => {
      const old = e.id ? prev.get(String(e.id)) : undefined;
      if (e.id && !old) {
        throw new UseCaseError(422, 'EQUIPMENT_UNKNOWN', 'Equipamento com id inexistente neste contrato (omita o id para incluir um novo).', { fields: ['equipments'] });
      }
      return {
        ...(old || {}),
        id: old ? old.id : newId('eq'),
        skuGestaoClick: str(e.sku ?? old?.skuGestaoClick),
        description: e.description,
        serialNumber: str(e.serialNumber ?? old?.serialNumber),
        ncm: str(e.ncm ?? old?.ncm),
        quantity: e.quantity,
        unitMonthlyRent: e.unitMonthlyRent,
      };
    });
  }
  if (sellerUserId !== undefined) body.sellerName = resolveSeller(ctx, sellerUserId as string).name;
  // Trava do Lote 2: salvar contrato NUNCA gera fatura/remessa/NF.
  body.generateNextInvoiceOnSave = false;
  return body;
}

export const erpContractsCreate = defineUseCase({
  ...createBase,
  operationId: 'erp.contracts.create',
  toolName: 'erp_contracts_create',
  path: '/api/v1/erp/contracts',
  pathParams: [],
  summary: 'Criar contrato de locacao',
  description:
    'Cria um contrato (sem gerar fatura, remessa ou NF; e-mail automatico de cobranca e regua desligados). Vendedor = dono da credencial (outro so com TODOS). ' +
    'Campos de faturamento/remessa/link de pagamento/assinatura nao sao aceitos. Idempotency-Key obrigatoria.',
  requiredScope: 'erp:contracts:write',
  inputSchema: z.object({ title: text(200).min(1), equipments: Equipments, ...contractFields() }).strict(),
  outputSchema: one(ContractDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:contracts:write');
    rejectMaskedValues(input);
    if (!input.companyId && !input.companyName) {
      throw new UseCaseError(422, 'COMPANY_REQUIRED', 'Informe companyId (empresa do CRM) ou companyName.', { fields: ['companyId', 'companyName'] });
    }
    const body = await contractBody(ctx, input, null);
    if (input.sellerUserId === undefined) body.sellerName = ctx.owner.name;
    body.status = input.status || 'EM_IMPLANTACAO';
    body.autoSendEmailOnBilling = false;
    body.dunningRuleEnabled = false;
    if (body.monthlyValue === undefined) {
      body.monthlyValue = (body.equipments as Array<{ quantity: number; unitMonthlyRent: number }>).reduce((s, e) => s + e.quantity * e.unitMonthlyRent, 0);
    }
    const created = unwrapWrite(await ctx.data.write('POST', '/api/erp/rental-contracts', body), 'Contrato') as ErpRentalContract;
    const out = toContract(created);
    recordWriteAudit(ctx, 'erp.contract', 'create', out.id, null, out);
    return { data: out };
  },
});

export const erpContractsUpdate = defineUseCase({
  ...updateBase,
  operationId: 'erp.contracts.update',
  toolName: 'erp_contracts_update',
  path: '/api/v1/erp/contracts/{id}',
  pathParams: ['id'],
  summary: 'Editar contrato de locacao',
  description: 'Edita campos permitidos (PATCH strict) de um contrato da carteira. Nunca gera fatura/remessa/NF. Contrato ENCERRADO nao e editado (409).',
  requiredScope: 'erp:contracts:write',
  inputSchema: z.object({ id: IdSchema, title: text(200).min(1).optional(), equipments: Equipments.optional(), ...contractFields() }).strict(),
  outputSchema: one(ContractDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:contracts:write');
    const { id, ...patch } = input;
    nonEmpty(patch);
    rejectMaskedValues(patch);
    const current = await findContract(ctx, id);
    if (current.status === 'ENCERRADO') throw new UseCaseError(409, 'CONTRACT_CLOSED', 'Contrato encerrado nao e editado pela integracao.');
    const body = await contractBody(ctx, patch, current);
    const updated = unwrapWrite(await ctx.data.write('PATCH', `/api/erp/rental-contracts/${encodeURIComponent(current.id)}`, body), 'Contrato') as ErpRentalContract;
    const out = toContract(updated);
    recordWriteAudit(ctx, 'erp.contract', 'update', out.id, toContract(current), out);
    return { data: out };
  },
});

export const erpContractRestoreVersion = defineUseCase({
  ...actionBase,
  idempotent: true,
  operationId: 'erp.contracts.restore_version',
  toolName: 'erp_contract_restore_version',
  path: '/api/v1/erp/contracts/{id}/restore-version',
  pathParams: ['id'],
  summary: 'Restaurar versao de contrato',
  description: 'Restaura uma revisao anterior do contrato (gera nova versao). Nunca fatura; revisao com faturamento ao salvar ligado e recusada (409).',
  requiredScope: 'erp:contracts:write',
  inputSchema: z.object({ id: IdSchema, targetVersion: z.number().int().min(1).max(10_000) }).strict(),
  outputSchema: one(ContractDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:contracts:write');
    const current = await findContract(ctx, input.id);
    if (current.status === 'ENCERRADO') throw new UseCaseError(409, 'CONTRACT_CLOSED', 'Contrato encerrado nao e alterado pela integracao.');
    const entry = (Array.isArray(current.versionHistory) ? current.versionHistory : []).find((v) => Number(v.versionNumber) === input.targetVersion);
    if (!entry) throw notFound('Versao do contrato');
    const snap = asRecord(entry.snapshot);
    if (snap.generateNextInvoiceOnSave === true) {
      throw new UseCaseError(409, 'CONTRACT_RESTORE_WOULD_BILL', 'Esta revisao tem faturamento ao salvar ligado; restaure pela tela.');
    }
    if (ctx.auth.portfolioScope !== 'TODOS' && snap.sellerName !== undefined && norm(snap.sellerName) !== norm(current.sellerName)) {
      throw new UseCaseError(403, 'CONTRACT_OWNER_IMMUTABLE', 'A revisao trocaria o vendedor (so carteira TODOS).', { fields: ['sellerName'] });
    }
    const restored = unwrapWrite(
      await ctx.data.write('POST', `/api/erp/rental-contracts/${encodeURIComponent(current.id)}/restore-version`, {
        targetVersion: input.targetVersion,
        restoredBy: `${ctx.owner.name} (API v1)`,
      }),
      'Contrato'
    ) as ErpRentalContract;
    const out = toContract(restored);
    recordWriteAudit(ctx, 'erp.contract', 'restore_version', out.id, toContract(current), out);
    return { data: out };
  },
});

export const erpContractRenew = defineUseCase({
  ...actionBase,
  requireIdempotencyKey: true,
  operationId: 'erp.contracts.renew',
  toolName: 'erp_contract_renew',
  path: '/api/v1/erp/contracts/{id}/renew',
  pathParams: ['id'],
  summary: 'Renovar vigencia do contrato',
  description: 'Estende a vigencia em N meses (1-60) e marca ATIVO. Nao fatura. Idempotency-Key obrigatoria (cada chamada soma meses).',
  requiredScope: 'erp:contracts:write',
  inputSchema: z.object({ id: IdSchema, months: z.number().int().min(1).max(60) }).strict(),
  outputSchema: one(ContractDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:contracts:write');
    const current = await findContract(ctx, input.id);
    if (current.status === 'ENCERRADO') throw new UseCaseError(409, 'CONTRACT_CLOSED', 'Contrato encerrado nao e renovado pela integracao.');
    const renewed = unwrapWrite(
      await ctx.data.write('POST', `/api/erp/rental-contracts/${encodeURIComponent(current.id)}/renew`, { months: input.months }),
      'Contrato'
    ) as ErpRentalContract;
    const out = toContract(renewed);
    recordWriteAudit(ctx, 'erp.contract', 'renew', out.id, toContract(current), out);
    return { data: out };
  },
});

// ---------------------------------------------------------------------------
// ORDENS DE SERVICO
// ---------------------------------------------------------------------------
const OsStatusInput = z.enum(SERVICE_ORDER_STATUSES as unknown as [string, ...string[]]);
const osFields = () =>
  ({
    companyId: IdSchema.optional(),
    companyName: text(200).min(1).optional(),
    technicianName: text(120).optional(),
    entryDate: DateText.optional(),
    exitDate: DateText.optional(),
    totalAmount: money.optional(),
    description: text(8000).optional(),
    measurementPeriodStart: DateText.optional(),
    measurementPeriodEnd: DateText.optional(),
    equipmentName: text(200).optional(),
    serialNumber: text(120).optional(),
    technicalReport: text(8000).optional(),
    priority: z.enum(['BAIXA', 'NORMAL', 'ALTA', 'CRITICA']).optional(),
  }) as const;

async function findOwnedServiceOrder(ctx: UseCaseContext, id: string): Promise<ErpServiceOrder> {
  const list = await allServiceOrders(ctx, {});
  const s = list.find((x) => x.id === id || x.code === id);
  if (!s || !serviceOrderInScope(s, erpOwner(ctx))) throw notFound('Ordem de servico');
  return s;
}

export const erpServiceOrdersCreate = defineUseCase({
  ...createBase,
  operationId: 'erp.service_orders.create',
  toolName: 'erp_service_orders_create',
  path: '/api/v1/erp/service-orders',
  pathParams: [],
  summary: 'Criar ordem de servico',
  description:
    'Cria uma OS (codigo sequencial do servidor; vendedor = dono da credencial, outro so com TODOS). Sem emitir NFS-e nem enviar e-mail. Idempotency-Key obrigatoria.',
  requiredScope: 'erp:orders:write',
  inputSchema: z.object({ status: OsStatusInput.default('Em aberto'), sellerUserId: IdSchema.optional(), ...osFields() }).strict(),
  outputSchema: one(ServiceOrderDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:orders:write');
    rejectMaskedValues(input);
    const { sellerUserId, ...rest } = input;
    const links = await crmLinks(ctx, { companyId: rest.companyId });
    const companyName = links.company?.name || rest.companyName;
    if (!companyName) throw new UseCaseError(422, 'COMPANY_REQUIRED', 'Informe companyId (empresa do CRM) ou companyName.', { fields: ['companyId', 'companyName'] });
    const seller = resolveSeller(ctx, sellerUserId);
    const existing = await allServiceOrders(ctx, {});
    const body: Record<string, unknown> = {
      ...rest,
      id: newId('os'),
      code: nextServiceOrderCode(existing),
      companyName,
      ...(links.company ? { companyCnpj: str(links.company.cnpj) } : {}),
      sellerName: seller.name,
      technicianName: rest.technicianName ?? '',
      entryDate: rest.entryDate ?? '',
      exitDate: rest.exitDate ?? '',
      totalAmount: rest.totalAmount ?? 0,
      description: rest.description ?? '',
    };
    const created = unwrapWrite(await ctx.data.write('POST', '/api/erp/service-orders', body), 'Ordem de servico') as ErpServiceOrder;
    const out = toServiceOrder(created);
    recordWriteAudit(ctx, 'erp.service_order', 'create', out.id, null, out);
    return { data: out };
  },
});

export const erpServiceOrdersUpdate = defineUseCase({
  ...updateBase,
  operationId: 'erp.service_orders.update',
  toolName: 'erp_service_orders_update',
  path: '/api/v1/erp/service-orders/{id}',
  pathParams: ['id'],
  summary: 'Editar ordem de servico',
  description: 'Edita campos permitidos (PATCH strict) de uma OS da carteira. Situacao muda so por erp_service_order_status_change.',
  requiredScope: 'erp:orders:write',
  inputSchema: z.object({ id: IdSchema, ...osFields() }).strict(),
  outputSchema: one(ServiceOrderDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:orders:write');
    const { id, ...patch } = input;
    nonEmpty(patch);
    rejectMaskedValues(patch);
    const current = await findOwnedServiceOrder(ctx, id);
    const links = await crmLinks(ctx, { companyId: patch.companyId });
    const body: Record<string, unknown> = { ...current, ...patch, id: current.id, code: current.code, status: current.status };
    delete body.statusHistory;
    if (links.company) {
      body.companyName = links.company.name;
      body.companyCnpj = str(links.company.cnpj);
    }
    const updated = unwrapWrite(await ctx.data.write('POST', '/api/erp/service-orders', body), 'Ordem de servico') as ErpServiceOrder;
    const out = toServiceOrder(updated);
    recordWriteAudit(ctx, 'erp.service_order', 'update', out.id, toServiceOrder(current), out);
    return { data: out };
  },
});

export const erpServiceOrderStatusChange = defineUseCase({
  ...actionBase,
  idempotent: true,
  operationId: 'erp.service_orders.status_change',
  toolName: 'erp_service_order_status_change',
  path: '/api/v1/erp/service-orders/{id}/status',
  pathParams: ['id'],
  summary: 'Mudar situacao da OS',
  description: 'Muda a situacao (Em aberto, Em andamento, Aguardando peca, Concluida, Cancelada) com nota opcional no historico. Nao emite NFS-e.',
  requiredScope: 'erp:orders:write',
  inputSchema: z.object({ id: IdSchema, status: OsStatusInput, note: text(500).optional() }).strict(),
  outputSchema: one(ServiceOrderDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:orders:write');
    rejectMaskedValues(input);
    const current = await findOwnedServiceOrder(ctx, input.id);
    const updated = unwrapWrite(
      await ctx.data.write('POST', `/api/erp/service-orders/${encodeURIComponent(current.id)}/status`, {
        status: input.status,
        ...(input.note ? { note: input.note } : {}),
      }),
      'Ordem de servico'
    ) as ErpServiceOrder;
    const out = toServiceOrder(updated);
    recordWriteAudit(ctx, 'erp.service_order', 'status_change', out.id, toServiceOrder(current), out);
    return { data: out };
  },
});

export const erpServiceOrderDuplicate = defineUseCase({
  ...createBase,
  operationId: 'erp.service_orders.duplicate',
  toolName: 'erp_service_order_duplicate',
  path: '/api/v1/erp/service-orders/{id}/duplicate',
  pathParams: ['id'],
  summary: 'Duplicar OS (nova medicao)',
  description: 'Cria uma nova OS a partir de outra da carteira, com nova data de entrada e periodo de medicao (DD/MM/AAAA). Idempotency-Key obrigatoria.',
  requiredScope: 'erp:orders:write',
  inputSchema: z.object({ id: IdSchema, entryDate: DateText, measurementPeriodStart: DateText, measurementPeriodEnd: DateText }).strict(),
  outputSchema: one(ServiceOrderDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:orders:write');
    const current = await findOwnedServiceOrder(ctx, input.id);
    const { id: _id, ...dup } = input;
    const created = unwrapWrite(
      await ctx.data.write('POST', `/api/erp/service-orders/${encodeURIComponent(current.id)}/duplicate`, dup),
      'Ordem de servico'
    ) as ErpServiceOrder;
    const out = toServiceOrder(created);
    recordWriteAudit(ctx, 'erp.service_order', 'duplicate', out.id, null, out);
    return { data: out };
  },
});

export const erpServiceOrderFromTicket = defineUseCase({
  ...createBase,
  operationId: 'erp.service_orders.create_from_ticket',
  toolName: 'erp_service_order_from_ticket',
  path: '/api/v1/erp/service-orders/from-ticket',
  pathParams: [],
  summary: 'Abrir OS a partir de chamado',
  description:
    'Abre (ou devolve a ja vinculada) OS a partir de um chamado da carteira. Exige tambem modulo Chamados e leitura de chamados. ' +
    'Efeito colateral do app: chamado ABERTO passa a EM_ANDAMENTO e recebe comentario interno. Descricao padrao "Chamado <chave>" (nao copia o texto do cliente). Idempotency-Key obrigatoria.',
  requiredScope: 'erp:orders:write',
  inputSchema: z
    .object({ ticketId: z.string().trim().min(1).max(80), technicianName: text(120).optional(), totalAmount: money.optional(), description: text(8000).optional() })
    .strict(),
  outputSchema: one(ServiceOrderDto.extend({ ticketId: z.string(), ticketKey: z.string() })),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:orders:write');
    rejectMaskedValues(input);
    if (!ctx.auth.moduleAccess.chamados) {
      throw new UseCaseError(403, 'MODULE_FORBIDDEN', 'Modulo chamados nao habilitado para esta credencial ou para o usuario dono.');
    }
    requireOwnerAccess(ctx, 'tickets', 'VIEW');
    const snap = await ctx.data.snapshot('tickets');
    const lower = input.ticketId.toLowerCase();
    const t = snap.tickets.find((x) => x.id === input.ticketId || String(x.key || '').toLowerCase() === lower) as ServiceTicket | undefined;
    const contacts = new Map(snap.contacts.map((c) => [c.id, c]));
    const companies = new Map(snap.companies.map((c) => [c.id, c]));
    if (!t || !ticketInScope(ctx.portfolio, t, { contact: (i) => contacts.get(i), company: (i) => companies.get(i) })) throw notFound('Chamado');
    const res = unwrapWrite(
      await ctx.data.write('POST', `/api/tickets/${encodeURIComponent(t.id)}/create-os`, {
        ...(input.technicianName ? { technicianName: input.technicianName } : {}),
        ...(input.totalAmount !== undefined ? { totalAmount: input.totalAmount } : {}),
        description: input.description || `Chamado ${str(t.key) || t.id}`,
      }),
      'Chamado'
    ) as { ticket: ServiceTicket; serviceOrder: ErpServiceOrder };
    const out = { ...toServiceOrder(res.serviceOrder), ticketId: t.id, ticketKey: str(t.key) };
    recordWriteAudit(ctx, 'erp.service_order', 'create_from_ticket', out.id, null, { ...toServiceOrder(res.serviceOrder), ticketKey: out.ticketKey });
    return { data: out };
  },
});

// ---------------------------------------------------------------------------
// PEDIDOS DE VENDA / COMPRA E FORNECEDORES (rota /api/erp/records/*, upsert com merge)
// ---------------------------------------------------------------------------
const toSaleOrder = (s: Record<string, unknown>): z.infer<typeof SaleOrderDto> => ({
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
});
const toPurchaseOrder = (p: Record<string, unknown>): z.infer<typeof PurchaseOrderDto> => ({
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
});
const toSupplier = (s: Record<string, unknown>): z.infer<typeof SupplierDto> => ({
  id: str(s.id),
  name: str(s.name),
  legalName: str(s.legalName),
  cnpj: str(s.cnpj),
  supplierType: strOrNull(s.supplierType),
  email: str(s.email),
  phone: str(s.phone),
  cityState: strOrNull(s.cityState),
  active: s.active !== false,
});

const saleFields = () =>
  ({
    companyId: IdSchema.optional(),
    companyName: text(200).min(1).optional(),
    date: DateText.optional(),
    status: text(60).min(1).optional(),
    totalAmount: money.optional(),
    itemsSummary: text(2000).optional(),
    paymentMethod: text(80).optional(),
    saleType: z.enum(['PRODUTO', 'SERVICO', 'BALCAO']).optional(),
    sellerUserId: IdSchema.optional(),
  }) as const;

function nextCode(list: Array<{ code?: string }>, prefix: string): string {
  const max = list.reduce((m, r) => Math.max(m, Number(String(r?.code || '').replace(/\D/g, '')) || 0), 0);
  return `${prefix}${String(max + 1).padStart(5, '0')}`;
}

export const erpSalesOrdersCreate = defineUseCase({
  ...createBase,
  operationId: 'erp.sales_orders.create',
  toolName: 'erp_sales_orders_create',
  path: '/api/v1/erp/sales-orders',
  pathParams: [],
  summary: 'Criar pedido de venda',
  description: 'Cria um pedido de venda (vendedor = dono; outro so com TODOS). Sem faturar, emitir NF ou baixar estoque. Idempotency-Key obrigatoria.',
  requiredScope: 'erp:orders:write',
  inputSchema: z.object({ ...saleFields(), totalAmount: money, itemsSummary: text(2000).min(1) }).strict(),
  outputSchema: one(SaleOrderDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:orders:write');
    rejectMaskedValues(input);
    const { sellerUserId, companyId, ...rest } = input;
    const links = await crmLinks(ctx, { companyId });
    const companyName = links.company?.name || rest.companyName;
    if (!companyName) throw new UseCaseError(422, 'COMPANY_REQUIRED', 'Informe companyId (empresa do CRM) ou companyName.', { fields: ['companyId', 'companyName'] });
    const seller = resolveSeller(ctx, sellerUserId);
    const list = (await collections(ctx)).salesOrders;
    const body = {
      ...rest,
      id: newId('so'),
      code: nextCode(list, 'PV-API-'),
      companyName,
      sellerName: seller.name,
      date: rest.date || new Date().toISOString().slice(0, 10),
      status: rest.status || 'Em aberto',
    };
    const saved = unwrapWrite(await ctx.data.write('POST', '/api/erp/records/salesOrders', body), 'Pedido de venda');
    const out = toSaleOrder(saved);
    recordWriteAudit(ctx, 'erp.sales_order', 'create', out.id, null, out);
    return { data: out };
  },
});

export const erpSalesOrdersUpdate = defineUseCase({
  ...updateBase,
  operationId: 'erp.sales_orders.update',
  toolName: 'erp_sales_orders_update',
  path: '/api/v1/erp/sales-orders/{id}',
  pathParams: ['id'],
  summary: 'Editar pedido de venda',
  description: 'Edita um pedido de venda da carteira (PATCH strict). Troca de vendedor so com TODOS.',
  requiredScope: 'erp:orders:write',
  inputSchema: z.object({ id: IdSchema, ...saleFields() }).strict(),
  outputSchema: one(SaleOrderDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:orders:write');
    const { id, sellerUserId, companyId, ...patch } = input;
    nonEmpty({ ...patch, ...(sellerUserId ? { sellerUserId } : {}), ...(companyId ? { companyId } : {}) });
    rejectMaskedValues(patch);
    const o = erpOwner(ctx);
    const current = (await collections(ctx)).salesOrders.find((s) => s && s.id === id);
    if (!current || (o && norm(current.sellerName) !== norm(o.name))) throw notFound('Pedido de venda');
    const links = await crmLinks(ctx, { companyId });
    const body: Record<string, unknown> = { ...patch };
    if (links.company) body.companyName = links.company.name;
    if (sellerUserId !== undefined) body.sellerName = resolveSeller(ctx, sellerUserId).name;
    const saved = unwrapWrite(await ctx.data.write('PATCH', `/api/erp/records/salesOrders/${encodeURIComponent(current.id)}`, body), 'Pedido de venda');
    const out = toSaleOrder(saved);
    recordWriteAudit(ctx, 'erp.sales_order', 'update', out.id, toSaleOrder(current as unknown as Record<string, unknown>), out);
    return { data: out };
  },
});

const purchaseFields = () =>
  ({
    supplierId: IdSchema.optional(),
    supplierName: text(200).min(1).optional(),
    issueDate: DateText.optional(),
    status: text(60).min(1).optional(),
    itemsSummary: text(2000).optional(),
    costCenter: text(120).optional(),
    totalAmount: money.optional(),
  }) as const;

async function purchaseSupplier(ctx: UseCaseContext, supplierId: string | undefined) {
  if (!supplierId) return undefined;
  const s = (await collections(ctx)).suppliers.find((x) => x && x.id === supplierId);
  if (!s) throw notFound('Fornecedor');
  return s;
}

export const erpPurchaseOrdersCreate = defineUseCase({
  ...createBase,
  operationId: 'erp.purchase_orders.create',
  toolName: 'erp_purchase_orders_create',
  path: '/api/v1/erp/purchase-orders',
  pathParams: [],
  summary: 'Criar pedido de compra',
  description: 'Cria um pedido de compra manual (carteira TODOS). Sem importar XML de NF-e, dar entrada em estoque ou gerar contas a pagar. Idempotency-Key obrigatoria.',
  requiredScope: 'erp:orders:write',
  inputSchema: z.object({ ...purchaseFields(), totalAmount: money }).strict(),
  outputSchema: one(PurchaseOrderDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:orders:write');
    requireAllPortfolio(ctx, 'pedidos de compra');
    rejectMaskedValues(input);
    const { supplierId, ...rest } = input;
    const sup = await purchaseSupplier(ctx, supplierId);
    const supplierName = sup?.name || rest.supplierName;
    if (!supplierName) throw new UseCaseError(422, 'SUPPLIER_REQUIRED', 'Informe supplierId ou supplierName.', { fields: ['supplierId', 'supplierName'] });
    const list = (await collections(ctx)).purchaseOrders;
    const body = {
      ...rest,
      id: newId('po'),
      code: nextCode(list, 'PC-API-'),
      supplierName,
      ...(sup ? { supplierCnpj: str(sup.cnpj) } : {}),
      issueDate: rest.issueDate || new Date().toISOString().slice(0, 10),
      status: rest.status || 'Em aberto',
      nfeNumber: '',
    };
    const saved = unwrapWrite(await ctx.data.write('POST', '/api/erp/records/purchaseOrders', body), 'Pedido de compra');
    const out = toPurchaseOrder(saved);
    recordWriteAudit(ctx, 'erp.purchase_order', 'create', out.id, null, out);
    return { data: out };
  },
});

export const erpPurchaseOrdersUpdate = defineUseCase({
  ...updateBase,
  operationId: 'erp.purchase_orders.update',
  toolName: 'erp_purchase_orders_update',
  path: '/api/v1/erp/purchase-orders/{id}',
  pathParams: ['id'],
  summary: 'Editar pedido de compra',
  description: 'Edita um pedido de compra manual (carteira TODOS). Pedido originado de XML de NF-e nao e editado (409).',
  requiredScope: 'erp:orders:write',
  inputSchema: z.object({ id: IdSchema, ...purchaseFields() }).strict(),
  outputSchema: one(PurchaseOrderDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:orders:write');
    requireAllPortfolio(ctx, 'pedidos de compra');
    const { id, supplierId, ...patch } = input;
    nonEmpty({ ...patch, ...(supplierId ? { supplierId } : {}) });
    rejectMaskedValues(patch);
    const current = (await collections(ctx)).purchaseOrders.find((p) => p && p.id === id);
    if (!current) throw notFound('Pedido de compra');
    if (current.nfeAccessKey || (Array.isArray(current.parsedItems) && current.parsedItems.length > 0)) {
      throw new UseCaseError(409, 'PURCHASE_FROM_XML_LOCKED', 'Pedido importado de XML de NF-e nao e editado pela integracao.');
    }
    const sup = await purchaseSupplier(ctx, supplierId);
    const body: Record<string, unknown> = { ...patch };
    if (sup) {
      body.supplierName = sup.name;
      body.supplierCnpj = str(sup.cnpj);
    }
    const saved = unwrapWrite(await ctx.data.write('PATCH', `/api/erp/records/purchaseOrders/${encodeURIComponent(current.id)}`, body), 'Pedido de compra');
    const out = toPurchaseOrder(saved);
    recordWriteAudit(ctx, 'erp.purchase_order', 'update', out.id, toPurchaseOrder(current as unknown as Record<string, unknown>), out);
    return { data: out };
  },
});

const supplierFields = () =>
  ({
    name: text(200).min(1).optional(),
    legalName: text(200).optional(),
    cnpj: z.string().trim().regex(/^[0-9./-]{11,20}$/, 'CPF/CNPJ invalido').optional(),
    phone: text(40).optional(),
    email: z.string().trim().email().max(200).optional(),
    active: z.boolean().optional(),
    supplierType: z.enum(['FORNECEDOR', 'TRANSPORTADORA']).optional(),
    cityState: text(120).optional(),
  }) as const;

export const erpSuppliersCreate = defineUseCase({
  ...createBase,
  operationId: 'erp.suppliers.create',
  toolName: 'erp_suppliers_create',
  path: '/api/v1/erp/suppliers',
  pathParams: [],
  summary: 'Cadastrar fornecedor',
  description: 'Cadastra fornecedor/transportadora (carteira TODOS; CPF/CNPJ validado pelo servidor). Idempotency-Key obrigatoria.',
  requiredScope: 'erp:records:write',
  inputSchema: z.object({ ...supplierFields(), name: text(200).min(1) }).strict(),
  outputSchema: one(SupplierDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:records:write');
    requireAllPortfolio(ctx, 'fornecedores');
    rejectMaskedValues(input);
    const body = { legalName: '', cnpj: '', phone: '', email: '', active: true, ...input, id: newId('sup') };
    const saved = unwrapWrite(await ctx.data.write('POST', '/api/erp/records/suppliers', body), 'Fornecedor');
    const out = toSupplier(saved);
    recordWriteAudit(ctx, 'erp.supplier', 'create', out.id, null, out);
    return { data: out };
  },
});

export const erpSuppliersUpdate = defineUseCase({
  ...updateBase,
  operationId: 'erp.suppliers.update',
  toolName: 'erp_suppliers_update',
  path: '/api/v1/erp/suppliers/{id}',
  pathParams: ['id'],
  summary: 'Editar fornecedor',
  description: 'Edita um fornecedor (carteira TODOS, PATCH strict).',
  requiredScope: 'erp:records:write',
  inputSchema: z.object({ id: IdSchema, ...supplierFields() }).strict(),
  outputSchema: one(SupplierDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:records:write');
    requireAllPortfolio(ctx, 'fornecedores');
    const { id, ...patch } = input;
    nonEmpty(patch);
    rejectMaskedValues(patch);
    const current = (await collections(ctx)).suppliers.find((s) => s && s.id === id);
    if (!current) throw notFound('Fornecedor');
    const saved = unwrapWrite(await ctx.data.write('PATCH', `/api/erp/records/suppliers/${encodeURIComponent(current.id)}`, patch), 'Fornecedor');
    const out = toSupplier(saved);
    recordWriteAudit(ctx, 'erp.supplier', 'update', out.id, toSupplier(current as unknown as Record<string, unknown>), out);
    return { data: out };
  },
});

// ---------------------------------------------------------------------------
// CATALOGO E LISTAS AUXILIARES (sem dono => carteira TODOS)
// ---------------------------------------------------------------------------
const CatalogCategory = z.enum(['EQUIPAMENTO_LOCACAO', 'SERVICO_TECNICO_LC116', 'TELECOM_SCM_SVA', 'VENDA_HARDWARE']);
const catalogFields = () =>
  ({
    code: z.string().trim().regex(/^[A-Za-z0-9._ -]{1,60}$/, 'codigo invalido').optional(),
    name: text(200).min(1).optional(),
    category: CatalogCategory.optional(),
    productGroup: text(120).optional(),
    brand: text(120).optional(),
    modelName: text(120).optional(),
    unitOfMeasure: text(20).optional(),
    isActive: z.boolean().optional(),
    monthlyRentalPrice: money.optional(),
    saleOrSetupPrice: money.optional(),
    warrantyMonths: z.number().int().min(0).max(240).optional(),
    minStock: z.number().int().min(0).max(1_000_000).optional(),
    maxStock: z.number().int().min(0).max(1_000_000).optional(),
    warehouseLocation: text(120).optional(),
    /** Custo/margem: exigem alcada Financeiro EDICAO. */
    costPrice: money.optional(),
    profitMarginPercent: z.number().finite().min(-100).max(10_000).optional(),
  }) as const;

function catalogBody(ctx: UseCaseContext, input: Record<string, unknown>): Record<string, unknown> {
  const { code, ...rest } = input;
  if ((rest.costPrice !== undefined || rest.profitMarginPercent !== undefined) && !userHasErpAccess(ctx.owner, 'finance', 'EDIT')) {
    throw new UseCaseError(403, 'FIELD_REQUIRES_FINANCE', 'Custo e margem exigem alcada Financeiro (edicao) no usuario dono.', {
      fields: ['costPrice', 'profitMarginPercent'].filter((f) => rest[f] !== undefined),
    });
  }
  return { ...rest, ...(code !== undefined ? { gestaoClickCode: code } : {}) };
}

async function assertCatalogCodeFree(ctx: UseCaseContext, code: string | undefined, selfId?: string) {
  if (!code) return;
  const clash = (await collections(ctx)).catalog.find((c) => c && c.id !== selfId && str(c.gestaoClickCode).toLowerCase() === code.toLowerCase());
  if (clash) throw new UseCaseError(409, 'CATALOG_CODE_CONFLICT', 'Ja existe item do catalogo com este codigo.', { fields: ['code'] });
}

export const erpCatalogCreate = defineUseCase({
  ...createBase,
  operationId: 'erp.catalog.create',
  toolName: 'erp_catalog_create',
  path: '/api/v1/erp/catalog',
  pathParams: [],
  summary: 'Cadastrar produto/servico',
  description:
    'Cadastra item do catalogo (carteira TODOS). Estoque comeca em 0 e nao e movimentado; dados fiscais ficam no padrao (editar na tela). Custo/margem exigem Financeiro EDICAO. Idempotency-Key obrigatoria.',
  requiredScope: 'erp:catalog:write',
  inputSchema: z.object({ ...catalogFields(), name: text(200).min(1) }).strict(),
  outputSchema: one(CatalogItemDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:catalog:write');
    requireAllPortfolio(ctx, 'catalogo');
    rejectMaskedValues(input);
    await assertCatalogCodeFree(ctx, input.code);
    const body = {
      monthlyRentalPrice: 0,
      saleOrSetupPrice: 0,
      ...catalogBody(ctx, input),
      id: newId('cat'),
      stockAvailable: 0,
      stockRentedInClients: 0,
    };
    // A rota de criacao so grava os campos basicos; os demais (marca, custo, ...) vao num PATCH em seguida.
    const BASIC = new Set(['id', 'name', 'gestaoClickCode', 'category', 'stockAvailable', 'stockRentedInClients', 'monthlyRentalPrice', 'saleOrSetupPrice']);
    const extras = Object.fromEntries(Object.entries(body).filter(([k]) => !BASIC.has(k)));
    const basic = Object.fromEntries(Object.entries(body).filter(([k]) => BASIC.has(k)));
    let created = unwrapWrite(await ctx.data.write('POST', '/api/erp/catalog', basic), 'Item do catalogo');
    if (Object.keys(extras).length) {
      created = unwrapWrite(await ctx.data.write('PATCH', `/api/erp/catalog/${encodeURIComponent(str(created.id))}`, extras), 'Item do catalogo');
    }
    const out = toCatalogItem(created, showCatalogCost(ctx));
    recordWriteAudit(ctx, 'erp.catalog_item', 'create', out.id, null, out);
    return { data: out };
  },
});

export const erpCatalogUpdate = defineUseCase({
  ...updateBase,
  operationId: 'erp.catalog.update',
  toolName: 'erp_catalog_update',
  path: '/api/v1/erp/catalog/{id}',
  pathParams: ['id'],
  summary: 'Editar produto/servico',
  description: 'Edita item do catalogo (carteira TODOS, PATCH strict). Estoque, movimentacoes e dados fiscais nao sao editaveis pela integracao.',
  requiredScope: 'erp:catalog:write',
  inputSchema: z.object({ id: IdSchema, ...catalogFields() }).strict(),
  outputSchema: one(CatalogItemDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:catalog:write');
    requireAllPortfolio(ctx, 'catalogo');
    const { id, ...patch } = input;
    nonEmpty(patch);
    rejectMaskedValues(patch);
    const current = (await collections(ctx)).catalog.find((c) => c && c.id === id);
    if (!current) throw notFound('Item do catalogo');
    await assertCatalogCodeFree(ctx, patch.code, current.id);
    const body = catalogBody(ctx, patch);
    const updated = unwrapWrite(await ctx.data.write('PATCH', `/api/erp/catalog/${encodeURIComponent(current.id)}`, body), 'Item do catalogo');
    const show = showCatalogCost(ctx);
    const out = toCatalogItem(updated, show);
    recordWriteAudit(ctx, 'erp.catalog_item', 'update', out.id, toCatalogItem(current, show), out);
    return { data: out };
  },
});

/** Lote 3 (correcao CISO do Lote 2): listas auxiliares na tela exigem admin ERP ou controle total do ERP. */
function requireErpFullControl(ctx: UseCaseContext): void {
  if (!erpFullControl(ctx.owner)) {
    throw new UseCaseError(403, 'ERP_FULL_CONTROL_REQUIRED', 'Listas auxiliares exigem administrador do ERP ou controle total do ERP (mesma regra da tela).');
  }
}

const AuxItemDto = z.object({ id: z.string(), kind: z.string(), label: z.string(), sortOrder: z.number() });
const toAuxItem = (i: Record<string, unknown>): z.infer<typeof AuxItemDto> => ({ id: str(i.id), kind: str(i.kind), label: str(i.label), sortOrder: num(i.sortOrder) });

export const erpAuxListItemsCreate = defineUseCase({
  ...createBase,
  operationId: 'erp.aux_lists.create',
  toolName: 'erp_aux_list_items_create',
  path: '/api/v1/erp/aux-lists',
  pathParams: [],
  summary: 'Incluir item em lista auxiliar',
  description: 'Inclui centro de custo (costCenters) ou conta do plano de contas (chartOfAccountsList). Carteira TODOS. Idempotency-Key obrigatoria.',
  requiredScope: 'erp:catalog:write',
  inputSchema: z.object({ kind: z.enum(['costCenters', 'chartOfAccountsList']), label: text(120).min(1) }).strict(),
  outputSchema: one(AuxItemDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:catalog:write');
    requireAllPortfolio(ctx, 'listas auxiliares');
    requireErpFullControl(ctx);
    rejectMaskedValues(input);
    const created = unwrapWrite(await ctx.data.write('POST', '/api/erp/aux-lists', { kind: input.kind, label: input.label }), 'Lista auxiliar');
    const out = toAuxItem(created);
    recordWriteAudit(ctx, 'erp.aux_list_item', 'create', out.id, null, out);
    return { data: out };
  },
});

export const erpAuxListItemsUpdate = defineUseCase({
  ...updateBase,
  operationId: 'erp.aux_lists.update',
  toolName: 'erp_aux_list_items_update',
  path: '/api/v1/erp/aux-lists/{id}',
  pathParams: ['id'],
  summary: 'Renomear item de lista auxiliar',
  description: 'Renomeia um item de lista auxiliar (carteira TODOS).',
  requiredScope: 'erp:catalog:write',
  inputSchema: z.object({ id: IdSchema, label: text(120).min(1) }).strict(),
  outputSchema: one(AuxItemDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:catalog:write');
    requireAllPortfolio(ctx, 'listas auxiliares');
    requireErpFullControl(ctx);
    rejectMaskedValues(input);
    const updated = unwrapWrite(await ctx.data.write('PATCH', `/api/erp/aux-lists/${encodeURIComponent(input.id)}`, { label: input.label }), 'Item da lista');
    const out = toAuxItem(updated);
    recordWriteAudit(ctx, 'erp.aux_list_item', 'update', out.id, null, out);
    return { data: out };
  },
});

// ---------------------------------------------------------------------------
// LANCAMENTOS FINANCEIROS (so em aberto; nunca baixa/pagamento)
// ---------------------------------------------------------------------------
const FinCategory = z.enum(['LOCACAO_EQUIPAMENTOS', 'SERVICOS_TI_TELECOM', 'FORNECEDOR_LINK_HARDWARE', 'IMPOSTOS_TRIBUTOS', 'OPERACIONAL']);
const finFields = () =>
  ({
    type: z.enum(['RECEBER', 'PAGAR']).optional(),
    category: FinCategory.optional(),
    description: text(300).min(1).optional(),
    companyName: text(200).optional(),
    costCenter: text(120).optional(),
    amount: z.number().finite().positive().max(1_000_000_000).optional(),
    dueDate: IsoDateSchema.optional(),
    status: z.enum(['ABERTO', 'ATRASADO']).optional(),
    paymentMethod: text(80).optional(),
  }) as const;
const toFinancial = (f: Record<string, unknown>): z.infer<typeof FinancialEntryDto> => ({
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
});

export const erpFinancialEntriesCreate = defineUseCase({
  ...createBase,
  operationId: 'erp.financial_entries.create',
  toolName: 'erp_financial_entries_create',
  path: '/api/v1/erp/financial-entries',
  pathParams: [],
  summary: 'Criar lancamento financeiro (em aberto)',
  description:
    'Cria conta a receber/pagar EM ABERTO (Financeiro EDICAO + carteira TODOS). Sem baixa, pagamento, conciliacao, boleto/PIX ou vinculo com nota. Idempotency-Key obrigatoria.',
  requiredScope: 'erp:financial:write',
  inputSchema: z.object({ ...finFields(), type: z.enum(['RECEBER', 'PAGAR']), description: text(300).min(1), amount: z.number().finite().positive().max(1_000_000_000), dueDate: IsoDateSchema }).strict(),
  outputSchema: one(FinancialEntryDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:financial:write');
    requireAllPortfolio(ctx, 'financeiro');
    rejectMaskedValues(input);
    const body = { ...input, id: newId('fin'), status: input.status || 'ABERTO', paidAt: null, invoiceId: null };
    const created = unwrapWrite(await ctx.data.write('POST', '/api/erp/financial', body), 'Lancamento financeiro');
    const out = toFinancial(created);
    recordWriteAudit(ctx, 'erp.financial_entry', 'create', out.id, null, out);
    return { data: out };
  },
});

export const erpFinancialEntriesUpdate = defineUseCase({
  ...updateBase,
  operationId: 'erp.financial_entries.update',
  toolName: 'erp_financial_entries_update',
  path: '/api/v1/erp/financial-entries/{id}',
  pathParams: ['id'],
  summary: 'Editar lancamento financeiro (em aberto)',
  description: 'Edita lancamento EM ABERTO/ATRASADO (Financeiro EDICAO + TODOS). Lancamento pago ou vinculado a nota nao e editado (409). Nunca marca como pago.',
  requiredScope: 'erp:financial:write',
  inputSchema: z.object({ id: IdSchema, ...finFields() }).strict(),
  outputSchema: one(FinancialEntryDto),
  async handler(input, ctx) {
    requireOwnerScope(ctx, 'erp:financial:write');
    requireAllPortfolio(ctx, 'financeiro');
    const { id, ...patch } = input;
    nonEmpty(patch);
    rejectMaskedValues(patch);
    const current = (await collections(ctx)).financialEntries.find((f) => f && f.id === id);
    if (!current) throw notFound('Lancamento financeiro');
    if (current.status === 'PAGO' || current.paidAt || current.invoiceId) {
      throw new UseCaseError(409, 'FINANCIAL_ENTRY_LOCKED', 'Lancamento pago ou vinculado a nota fiscal nao e editado pela integracao.');
    }
    const updated = unwrapWrite(await ctx.data.write('PATCH', `/api/erp/financial/${encodeURIComponent(current.id)}`, patch), 'Lancamento financeiro');
    const out = toFinancial(updated);
    recordWriteAudit(ctx, 'erp.financial_entry', 'update', out.id, toFinancial(current as unknown as Record<string, unknown>), out);
    return { data: out };
  },
});

export const ERP_WRITE_USE_CASES = [
  erpProposalsCreate,
  erpProposalsUpdate,
  erpProposalRestoreVersion,
  erpContractsCreate,
  erpContractsUpdate,
  erpContractRestoreVersion,
  erpContractRenew,
  erpServiceOrdersCreate,
  erpServiceOrdersUpdate,
  erpServiceOrderStatusChange,
  erpServiceOrderDuplicate,
  erpServiceOrderFromTicket,
  erpSalesOrdersCreate,
  erpSalesOrdersUpdate,
  erpPurchaseOrdersCreate,
  erpPurchaseOrdersUpdate,
  erpSuppliersCreate,
  erpSuppliersUpdate,
  erpCatalogCreate,
  erpCatalogUpdate,
  erpAuxListItemsCreate,
  erpAuxListItemsUpdate,
  erpFinancialEntriesCreate,
  erpFinancialEntriesUpdate,
] as const;
