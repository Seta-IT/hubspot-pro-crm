// ============================================================================
// STI-hub — API v1 + MCP: Fase 2 / Lote 3a — EXCLUSAO, MERGE, DATA HEALTH e ENRIQUECIMENTO.
// Sempre em duas etapas (dangerous.ts). Alem do escopo e da alcada do dono:
//  - CRM: registro precisa estar na carteira efetiva (fora => o mesmo 404);
//  - ERP: area da tela em EDIT; entidades sem dono (financeiro, catalogo, cadastros) => carteira TODOS;
//  - listas auxiliares: admin ERP ou controle total do ERP (mesma regra da tela);
//  - data health/merge em massa e enriquecimento: carteira TODOS.
// A regra de "em uso" (409) continua sendo a do app (rotas internas).
// ============================================================================
import { z } from 'zod/v4';
import { companyInScope, contactInScope, dealInScope } from '../portfolio';
import { erpFullControl, requireAllPortfolio, userHasAccess, userHasErpAccess, type ErpArea } from './common';
import { unwrapRead as unwrapCrmRead } from './crm-extra';
import { defineDangerous, unwrapDangerous, type DangerousPlan } from './dangerous';
import { findTask } from './crm-write';
import { allServiceOrders, collections, findWritableContract, loadWritableProposal, str } from './erp';
import { IdSchema, notFound, UseCaseError, type UseCaseContext, type UseCaseDefinition } from './types';

const enc = encodeURIComponent;
const idOnly = z.object({ id: IdSchema }).strict();

function requireErpArea(ctx: UseCaseContext, area: ErpArea): void {
  if (!userHasErpAccess(ctx.owner, area, 'EDIT')) {
    throw new UseCaseError(403, 'OWNER_ACCESS_INSUFFICIENT', `O usuario dono nao tem edicao na area ${area} do ERP.`, { area });
  }
}
function requireCrmArea(ctx: UseCaseContext, area: 'contacts' | 'companies' | 'deals'): void {
  if (!userHasAccess(ctx.owner, area, 'EDIT')) {
    throw new UseCaseError(403, 'OWNER_ACCESS_INSUFFICIENT', `O usuario dono nao tem edicao em ${area} no CRM.`, { area });
  }
}

const delPlan = (entity: string, id: string, preview: Record<string, unknown>, path: string, ctx: UseCaseContext, what: string, effects: string[] = []): DangerousPlan => ({
  entity,
  entityId: id,
  before: preview,
  preview: { action: 'EXCLUIR', entity, ...preview },
  effects: ['Exclusao definitiva (sem lixeira pelo conector).', ...effects],
  run: async () => {
    const body = unwrapDangerous(await ctx.data.dangerous('DELETE', path, {}), what);
    return { deleted: true, deletedId: str(body?.deletedId) || id };
  },
});

// ---------------------------------------------------------------------------
// CRM: contatos, empresas, negocios, tarefas
// ---------------------------------------------------------------------------
const crmDelete = (name: string, entity: string, label: string, area: 'contacts' | 'companies' | 'deals', route: string) =>
  defineDangerous({
    name: `crm_${name}_delete`,
    operationId: `crm.${name}.delete`,
    path: `/api/v1/crm/${name}/{id}/delete`,
    pathParams: ['id'],
    tag: 'CRM',
    requiredModule: 'crm',
    domain: 'crm',
    requiredScope: 'crm:delete',
    op: 'delete',
    summary: `Excluir ${label}`,
    description: `Exclui ${label} da carteira efetiva (permissao de tela canDeleteCrmRecords + edicao). Bloqueado pelo app se estiver em uso.`,
    inputSchema: idOnly,
    async plan(input, ctx) {
      requireCrmArea(ctx, area);
      const snap = await ctx.data.snapshot('crm');
      let rec: any;
      if (area === 'contacts') rec = snap.contacts.find((x) => x.id === input.id && contactInScope(ctx.portfolio, x));
      else if (area === 'companies') rec = snap.companies.find((x) => x.id === input.id && companyInScope(ctx.portfolio, x));
      else rec = snap.deals.find((x) => x.id === input.id && dealInScope(ctx.portfolio, x));
      if (!rec) throw notFound(label);
      const preview: Record<string, unknown> = {
        id: rec.id,
        name: str(rec.name || rec.title || [rec.firstName, rec.lastName].filter(Boolean).join(' ')),
        ownerName: str(rec.ownerName) || null,
      };
      if (area === 'deals') Object.assign(preview, { stage: str(rec.stage) || null, amount: Number(rec.amount) || 0 });
      const effects: string[] = [];
      if (area === 'companies') effects.push(`Contatos vinculados: ${snap.contacts.filter((c: any) => c.companyId === rec.id).length}; negocios: ${snap.deals.filter((d: any) => d.companyId === rec.id).length}.`);
      return delPlan(entity, rec.id, preview, `/api/${route}/${enc(rec.id)}`, ctx, label, effects);
    },
  });

const crmTasksDelete = defineDangerous({
  name: 'crm_tasks_delete',
  operationId: 'crm.tasks.delete',
  path: '/api/v1/crm/tasks/{id}/delete',
  pathParams: ['id'],
  tag: 'CRM',
  requiredModule: 'crm',
  domain: 'crm',
  requiredScope: 'crm:delete',
  op: 'delete',
  summary: 'Excluir tarefa',
  description: 'Exclui tarefa da carteira efetiva (canDeleteCrmRecords).',
  inputSchema: idOnly,
  async plan(input, ctx) {
    const t: any = await findTask(ctx, input.id);
    return delPlan('crm.task', t.id, { id: t.id, title: str(t.title), status: str(t.status) || null, dueDate: str(t.dueDate) || null }, `/api/tasks/${enc(t.id)}`, ctx, 'Tarefa');
  },
});

// ---------------------------------------------------------------------------
// ERP: propostas, contratos, lancamentos, catalogo, listas auxiliares, cadastros
// ---------------------------------------------------------------------------
const erpDeleteBase = { tag: 'ERP' as const, requiredModule: 'erp' as const, domain: 'erp' as const, requiredScope: 'erp:records:delete' as const, op: 'delete', pathParams: ['id'], inputSchema: idOnly };

const erpProposalsDelete = defineDangerous({
  ...erpDeleteBase,
  name: 'erp_proposals_delete',
  operationId: 'erp.proposals.delete',
  path: '/api/v1/erp/proposals/{id}/delete',
  summary: 'Excluir proposta comercial',
  description: 'Exclui proposta da carteira efetiva (canDeleteErpRecords + edicao de propostas). Proposta convertida/em uso => recusado pelo app.',
  async plan(input, ctx) {
    requireErpArea(ctx, 'proposals');
    const p: any = await loadWritableProposal(ctx, input.id);
    return delPlan('erp.proposal', p.id, { id: p.id, code: str(p.code) || null, companyName: str(p.companyName) || null, status: str(p.status) || null, totalAmount: Number(p.totalAmount ?? p.total) || 0 }, `/api/erp/proposals/${enc(p.id)}`, ctx, 'Proposta');
  },
});

const erpContractsDelete = defineDangerous({
  ...erpDeleteBase,
  name: 'erp_contracts_delete',
  operationId: 'erp.contracts.delete',
  path: '/api/v1/erp/contracts/{id}/delete',
  summary: 'Excluir contrato de locacao',
  description: 'Exclui contrato da carteira efetiva (canDeleteErpRecords + edicao de contratos). Contrato com faturas/remessas => recusado pelo app.',
  async plan(input, ctx) {
    requireErpArea(ctx, 'contracts');
    const c: any = await findWritableContract(ctx, input.id);
    return delPlan('erp.contract', c.id, { id: c.id, contractNumber: str(c.contractNumber) || null, companyName: str(c.companyName) || null, status: str(c.status) || null }, `/api/erp/rental-contracts/${enc(c.id)}`, ctx, 'Contrato');
  },
});

const erpFinancialDelete = defineDangerous({
  ...erpDeleteBase,
  name: 'erp_financial_entries_delete',
  operationId: 'erp.financial_entries.delete',
  path: '/api/v1/erp/financial-entries/{id}/delete',
  summary: 'Excluir lancamento financeiro',
  description: 'Exclui lancamento financeiro (carteira TODOS, edicao do financeiro, canDeleteErpRecords). Lancamento baixado/conciliado => recusado.',
  async plan(input, ctx) {
    requireAllPortfolio(ctx, 'Excluir lancamento financeiro');
    requireErpArea(ctx, 'finance');
    const f: any = (await collections(ctx)).financialEntries.find((x) => x.id === input.id);
    if (!f) throw notFound('Lancamento');
    if (String(f.status || '').toUpperCase() === 'PAGO' || String(f.status || '').toUpperCase() === 'RECEBIDO') {
      throw new UseCaseError(409, 'FINANCIAL_ENTRY_SETTLED', 'Lancamento ja baixado nao e excluido pelo conector.');
    }
    return delPlan('erp.financial_entry', f.id, { id: f.id, type: str(f.type) || null, description: str(f.description) || null, amount: Number(f.amount) || 0, dueDate: str(f.dueDate) || null, status: str(f.status) || null }, `/api/erp/financial/${enc(f.id)}`, ctx, 'Lancamento');
  },
});

const erpCatalogDelete = defineDangerous({
  ...erpDeleteBase,
  name: 'erp_catalog_items_delete',
  operationId: 'erp.catalog.delete',
  path: '/api/v1/erp/catalog/{id}/delete',
  summary: 'Excluir item do catalogo',
  description: 'Exclui item do catalogo (carteira TODOS, edicao de estoque/OS/vendas, canDeleteErpRecords). Item em uso => recusado pelo app.',
  async plan(input, ctx) {
    requireAllPortfolio(ctx, 'Excluir item do catalogo');
    requireErpArea(ctx, 'stockOsSales');
    const c: any = (await collections(ctx)).catalog.find((x) => x.id === input.id);
    if (!c) throw notFound('Item do catalogo');
    return delPlan('erp.catalog_item', c.id, { id: c.id, code: str(c.code) || null, name: str(c.name) || null }, `/api/erp/catalog/${enc(c.id)}`, ctx, 'Item do catalogo');
  },
});

const erpAuxDelete = defineDangerous({
  ...erpDeleteBase,
  name: 'erp_aux_list_items_delete',
  operationId: 'erp.aux_lists.delete',
  path: '/api/v1/erp/aux-lists/{id}/delete',
  summary: 'Excluir item de lista auxiliar',
  description: 'Exclui centro de custo/conta do plano (carteira TODOS + admin ERP ou controle total do ERP). Item em uso => recusado pelo app.',
  async plan(input, ctx) {
    requireAllPortfolio(ctx, 'Listas auxiliares');
    if (!erpFullControl(ctx.owner)) throw new UseCaseError(403, 'ERP_FULL_CONTROL_REQUIRED', 'Listas auxiliares exigem administrador do ERP ou controle total do ERP.');
    const data = unwrapCrmRead(await ctx.data.read('/api/erp/aux-lists'), 'Listas auxiliares')?.data || {};
    const all = [...(data.costCenters || []), ...(data.chartOfAccountsList || [])] as any[];
    const it = all.find((x) => x.id === input.id);
    if (!it) throw notFound('Item da lista');
    return delPlan('erp.aux_list_item', it.id, { id: it.id, kind: str(it.kind), label: str(it.label) }, `/api/erp/aux-lists/${enc(it.id)}`, ctx, 'Item da lista');
  },
});

const RecordKind = z.enum(['suppliers', 'salesOrders', 'purchaseOrders', 'serviceOrders']);
const erpRecordsDelete = defineDangerous({
  ...erpDeleteBase,
  name: 'erp_records_delete',
  operationId: 'erp.records.delete',
  path: '/api/v1/erp/records/{kind}/{id}/delete',
  pathParams: ['kind', 'id'],
  summary: 'Excluir cadastro do ERP',
  description: 'Exclui fornecedor, pedido de venda, pedido de compra ou OS (carteira TODOS, edicao de estoque/OS/vendas, canDeleteErpRecords). Em uso => recusado pelo app.',
  inputSchema: z.object({ kind: RecordKind, id: IdSchema }).strict(),
  async plan(input, ctx) {
    requireAllPortfolio(ctx, 'Excluir cadastro do ERP');
    requireErpArea(ctx, 'stockOsSales');
    let list: any[];
    if (input.kind === 'serviceOrders') list = await allServiceOrders(ctx, {});
    else list = ((await collections(ctx)) as any)[input.kind] || [];
    const r = list.find((x) => x && x.id === input.id);
    if (!r) throw notFound('Cadastro');
    return delPlan(`erp.${input.kind}`, r.id, { id: r.id, kind: input.kind, code: str(r.code || r.number) || null, name: str(r.name || r.companyName || r.supplierName || r.clientName) || null, status: str(r.status) || null }, `/api/erp/records/${input.kind}/${enc(r.id)}`, ctx, 'Cadastro');
  },
});

// ---------------------------------------------------------------------------
// MERGE, DATA HEALTH, ENRIQUECIMENTO
// ---------------------------------------------------------------------------
const crmRecordsMerge = defineDangerous({
  name: 'crm_records_merge',
  operationId: 'crm.records.merge',
  path: '/api/v1/crm/merge',
  pathParams: [],
  tag: 'CRM',
  requiredModule: 'crm',
  domain: 'crm',
  requiredScope: 'crm:merge',
  op: 'merge',
  summary: 'Mesclar contatos ou empresas duplicados',
  description: 'Mescla o duplicado no principal (o duplicado deixa de existir; negocios/historico vao para o principal). Ambos na carteira efetiva; canMergeCrmRecords. Empresas com CNPJs diferentes => 422 (regra fiscal).',
  inputSchema: z.object({ entityType: z.enum(['CONTACT', 'COMPANY']), primaryId: IdSchema, duplicateId: IdSchema }).strict(),
  async plan(input, ctx) {
    if (input.primaryId === input.duplicateId) throw new UseCaseError(422, 'MERGE_SAME_RECORD', 'Principal e duplicado precisam ser registros diferentes.');
    requireCrmArea(ctx, input.entityType === 'CONTACT' ? 'contacts' : 'companies');
    const snap = await ctx.data.snapshot('crm');
    const find = (id: string): any =>
      input.entityType === 'CONTACT'
        ? snap.contacts.find((x) => x.id === id && contactInScope(ctx.portfolio, x))
        : snap.companies.find((x) => x.id === id && companyInScope(ctx.portfolio, x));
    const a = find(input.primaryId);
    const b = find(input.duplicateId);
    if (!a || !b) throw notFound(input.entityType === 'CONTACT' ? 'Contato' : 'Empresa');
    const label = (r: any) => ({ id: r.id, name: str(r.name || [r.firstName, r.lastName].filter(Boolean).join(' ')), ownerName: str(r.ownerName) || null });
    const preview: Record<string, unknown> = { action: 'MESCLAR', entityType: input.entityType, primary: label(a), duplicate: label(b) };
    try {
      const dup = unwrapCrmRead(await ctx.data.read('/api/data-health/duplicates'), 'Duplicados')?.data || {};
      const plans = [...(dup.contactDuplicates || []), ...(dup.companyDuplicates || [])] as any[];
      const hit = plans.find((p) => {
        const s = p?.suggestedMerge || p;
        return (s?.primaryId === a.id && s?.duplicateId === b.id) || (s?.primaryId === b.id && s?.duplicateId === a.id);
      });
      const s = hit?.suggestedMerge || hit;
      if (s) Object.assign(preview, { confidenceScore: Number(s.confidenceScore) || 0, matchReasons: (s.matchReasons || []).slice(0, 10), dealsToMove: Number(s.dealsToMove) || 0, timelineEventsToMove: Number(s.timelineEventsToMove) || 0 });
    } catch {
      /* previa sem plano sugerido */
    }
    const route = input.entityType === 'COMPANY' ? '/api/companies/merge' : '/api/data-health/merge';
    return {
      entity: input.entityType === 'CONTACT' ? 'crm.contact' : 'crm.company',
      entityId: a.id,
      before: { primaryId: a.id, duplicateId: b.id },
      preview,
      effects: [`O registro ${b.id} sera removido e seus vinculos movidos para ${a.id}.`, 'Valores do principal prevalecem (sem fieldOverrides pelo conector).'],
      run: async () => {
        const r = unwrapDangerous(await ctx.data.dangerous('POST', route, { entityType: input.entityType, primaryId: a.id, duplicateId: b.id }), 'Registro');
        return { merged: true, primaryId: a.id, duplicateId: b.id, dealsMoved: Number(r?.dealsMoved ?? r?.dealsToMove) || 0 };
      },
    };
  },
});

const crmDataHealthAutoClean = defineDangerous({
  name: 'crm_data_health_auto_clean',
  operationId: 'crm.data_health.auto_clean',
  path: '/api/v1/crm/data-health/auto-clean',
  pathParams: [],
  tag: 'CRM',
  requiredModule: 'crm',
  domain: 'crm',
  requiredScope: 'crm:data_health:write',
  op: 'merge',
  summary: 'Limpeza automatica da base (mesclar duplicados)',
  description: 'Mescla automaticamente duplicados com confianca >= minConfidence (base inteira: carteira TODOS + canMergeCrmRecords). Opcionalmente enriquece.',
  inputSchema: z.object({ minConfidence: z.number().int().min(80).max(100).default(90), autoEnrich: z.boolean().default(false) }).strict(),
  async plan(input, ctx) {
    requireAllPortfolio(ctx, 'Limpeza automatica');
    const dup = unwrapCrmRead(await ctx.data.read('/api/data-health/duplicates'), 'Duplicados')?.data || {};
    const score = (p: any) => Number(p?.confidenceScore ?? p?.suggestedMerge?.confidenceScore) || 0;
    const contacts = (dup.contactDuplicates || []).filter((p: any) => score(p) >= input.minConfidence).length;
    const companies = (dup.companyDuplicates || []).filter((p: any) => score(p) >= input.minConfidence).length;
    return {
      entity: 'crm.data_health',
      entityId: 'auto-clean',
      before: { contactCandidates: contacts, companyCandidates: companies },
      preview: { action: 'LIMPEZA_AUTOMATICA', minConfidence: input.minConfidence, autoEnrich: input.autoEnrich, contactMergeCandidates: contacts, companyMergeCandidates: companies },
      effects: ['Duplicados acima do limiar serao mesclados (registros duplicados removidos).', 'CNPJs diferentes nunca sao unificados.'],
      run: async () => {
        const r = unwrapDangerous(await ctx.data.dangerous('POST', '/api/data-health/auto-clean', { minConfidence: input.minConfidence, autoEnrich: input.autoEnrich }), 'Limpeza');
        return { done: true, merged: Array.isArray(r?.mergeResults) ? r.mergeResults.length : Number(r?.mergedCount) || 0, enriched: Number(r?.enrichedCount) || 0 };
      },
    };
  },
});

const ReassignTarget = z.enum(['Marcelo Lopes Mira', 'Evelyn Ternero Seta Telecom']);
const crmDataHealthReassign = defineDangerous({
  name: 'crm_data_health_reassign_orphans',
  operationId: 'crm.data_health.reassign_orphans',
  path: '/api/v1/crm/data-health/reassign-orphans',
  pathParams: [],
  tag: 'CRM',
  requiredModule: 'crm',
  domain: 'crm',
  requiredScope: 'crm:data_health:write',
  op: 'reassign',
  summary: 'Reatribuir registros sem dono/dono inativo',
  description: 'Reatribui contatos/empresas/negocios sem dono ou com dono inativo para um dono ativo (base inteira: carteira TODOS + canMergeCrmRecords).',
  inputSchema: z.object({ targetOwnerName: ReassignTarget }).strict(),
  async plan(input, ctx) {
    requireAllPortfolio(ctx, 'Reatribuir orfaos');
    const snap = await ctx.data.snapshot('crm');
    const orphan = (r: any) => !r.ownerId || String(r.ownerId).includes('inativo') || String(r.ownerName || '').toLowerCase().includes('inativo');
    const preview = {
      action: 'REATRIBUIR_ORFAOS',
      targetOwnerName: input.targetOwnerName,
      contactsApprox: snap.contacts.filter(orphan).length,
      companiesApprox: snap.companies.filter(orphan).length,
      dealsApprox: snap.deals.filter(orphan).length,
    };
    return {
      entity: 'crm.data_health',
      entityId: 'reassign-orphans',
      before: null,
      preview,
      effects: ['Contagens aproximadas: o app tambem reatribui donos fora da lista de donos ativos.'],
      run: async () => {
        const r = unwrapDangerous(await ctx.data.dangerous('POST', '/api/data-health/reassign-orphans', { targetOwnerName: input.targetOwnerName }), 'Reatribuicao');
        return { targetOwnerName: input.targetOwnerName, contactsReassigned: Number(r?.contactsReassigned) || 0, companiesReassigned: Number(r?.companiesReassigned) || 0, dealsReassigned: Number(r?.dealsReassigned) || 0 };
      },
    };
  },
});

const crmEnrichmentRun = defineDangerous({
  name: 'crm_enrichment_run',
  operationId: 'crm.enrichment.run',
  path: '/api/v1/crm/enrichment/run',
  pathParams: [],
  tag: 'CRM',
  requiredModule: 'crm',
  domain: 'crm',
  requiredScope: 'crm:data_health:write',
  op: 'enrich',
  summary: 'Enriquecer contato ou empresa',
  description: 'Roda o enriquecimento de um contato ou empresa (pode criar/atualizar a empresa vinculada). Carteira TODOS.',
  inputSchema: z
    .object({ contactId: IdSchema.optional(), companyId: IdSchema.optional(), overwrite: z.boolean().default(false) })
    .strict(),
  async plan(input, ctx) {
    if (Boolean(input.contactId) === Boolean(input.companyId)) throw new UseCaseError(422, 'VALIDATION_ERROR', 'Informe contactId OU companyId.');
    requireAllPortfolio(ctx, 'Enriquecimento');
    const snap = await ctx.data.snapshot('crm');
    const rec: any = input.contactId ? snap.contacts.find((c) => c.id === input.contactId) : snap.companies.find((c) => c.id === input.companyId);
    if (!rec) throw notFound(input.contactId ? 'Contato' : 'Empresa');
    const id = String(input.contactId || input.companyId);
    return {
      entity: input.contactId ? 'crm.contact' : 'crm.company',
      entityId: id,
      before: null,
      preview: { action: 'ENRIQUECER', target: input.contactId ? 'CONTACT' : 'COMPANY', id, name: str(rec.name || [rec.firstName, rec.lastName].filter(Boolean).join(' ')), overwrite: input.overwrite },
      effects: input.overwrite ? ['overwrite=true: campos preenchidos podem ser sobrescritos.'] : ['So completa campos vazios.'],
      run: async () => {
        const body: Record<string, unknown> = { overwrite: input.overwrite };
        if (input.contactId) body.contactId = input.contactId;
        else body.companyId = input.companyId;
        const r = unwrapDangerous(await ctx.data.dangerous('POST', '/api/enrichment/run', body), 'Registro');
        const fields = [...(r?.contactFieldsUpdated || []), ...(r?.companyFieldsUpdated || []), ...(r?.fieldsUpdated || [])].map(String).slice(0, 50);
        return { enriched: true, fieldsUpdated: fields, companyCreated: Boolean(r?.isNewCompany) };
      },
    };
  },
});

export const lote3aUseCases: UseCaseDefinition[] = [
  ...crmDelete('contacts', 'crm.contact', 'Contato', 'contacts', 'contacts'),
  ...crmDelete('companies', 'crm.company', 'Empresa', 'companies', 'companies'),
  ...crmDelete('deals', 'crm.deal', 'Negocio', 'deals', 'deals'),
  ...crmTasksDelete,
  ...erpProposalsDelete,
  ...erpContractsDelete,
  ...erpFinancialDelete,
  ...erpCatalogDelete,
  ...erpAuxDelete,
  ...erpRecordsDelete,
  ...crmRecordsMerge,
  ...crmDataHealthAutoClean,
  ...crmDataHealthReassign,
  ...crmEnrichmentRun,
];
