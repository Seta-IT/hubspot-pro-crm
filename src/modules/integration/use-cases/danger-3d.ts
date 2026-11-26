// ============================================================================
// STI-hub — API v1 + MCP: Fase 2 / Lote 3d — FISCAL (sempre carteira TODOS + edicao Fiscal +
// permissao de tela canIssueFiscalDocuments). Emitir documento fiscal, gerar fatura/remessa de
// contrato, faturamento em lote, devolucao parcial, reajuste, NF-e de importacao, cancelar e
// excluir nota. Sempre em duas etapas (dangerous.ts). Certificado A1 e configuracoes fiscais: FORA.
// ============================================================================
import { z } from 'zod/v4';
import { companyInScope } from '../portfolio';
import { rejectMaskedValues, requireAllPortfolio, userHasErpAccess } from './common';
import { defineDangerous, unwrapDangerous } from './dangerous';
import { collections, findContract, findWritableContract, str } from './erp';
import { IdSchema, notFound, text, UseCaseError, type UseCaseContext, type UseCaseDefinition } from './types';

const enc = encodeURIComponent;
const base = { tag: 'ERP' as const, requiredModule: 'erp' as const, domain: 'erp' as const, requiredScope: 'erp:fiscal:issue' as const };
const money = z.number().finite().min(0).max(1_000_000_000);
const Competence = z.string().regex(/^\d{2}\/\d{4}$/, 'competencia MM/AAAA');
const DateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data AAAA-MM-DD');

function requireFiscal(ctx: UseCaseContext, what: string, alsoContracts = false): void {
  requireAllPortfolio(ctx, what);
  if (!userHasErpAccess(ctx.owner, 'fiscal', 'EDIT')) throw new UseCaseError(403, 'OWNER_ACCESS_INSUFFICIENT', 'O usuario dono nao tem edicao no Fiscal.', { area: 'fiscal' });
  if (alsoContracts && !userHasErpAccess(ctx.owner, 'contracts', 'EDIT')) throw new UseCaseError(403, 'OWNER_ACCESS_INSUFFICIENT', 'O usuario dono nao tem edicao em Contratos.', { area: 'contracts' });
}
const invoiceView = (i: any) => ({ id: str(i?.id), documentNumber: str(i?.documentNumber) || null, documentType: str(i?.documentType) || null, status: str(i?.status) || null, netAmount: Number(i?.netAmount) || 0 });

// ---------------------------------------------------------------------------
// Emitir documento fiscal avulso
// ---------------------------------------------------------------------------
const IssueType = z.enum(['FATURA_LOCACAO', 'NFSE_SERVICO', 'NFE_VENDA_PRODUTO', 'NFCOM_TELECOM']);
const erpFiscalIssue = defineDangerous({
  ...base,
  name: 'erp_fiscal_documents_issue',
  operationId: 'erp.fiscal_documents.issue',
  path: '/api/v1/erp/fiscal-documents/issue',
  pathParams: [],
  op: 'issue',
  summary: 'Emitir fatura/NF avulsa',
  description: 'Emite fatura de locacao, NFS-e, NF-e de venda ou NFCom para uma empresa do CRM (impostos calculados pelo app). Carteira TODOS + Fiscal EDIT + canIssueFiscalDocuments.',
  inputSchema: z
    .object({
      documentType: IssueType,
      companyId: IdSchema,
      grossAmount: money.gt(0),
      discountAmount: money.default(0),
      competenceMonth: Competence.optional(),
      dueDate: DateText.optional(),
      rentalContractId: IdSchema.optional(),
      items: z.array(z.object({ description: text(200).min(1), quantity: z.number().positive().max(100000), unitValue: money }).strict()).min(1).max(100),
    })
    .strict(),
  async plan(input, ctx) {
    requireFiscal(ctx, 'Emissao fiscal');
    rejectMaskedValues(input);
    if (input.discountAmount > input.grossAmount) throw new UseCaseError(422, 'DISCOUNT_ABOVE_GROSS', 'Desconto maior que o valor bruto.');
    const snap = await ctx.data.snapshot('crm');
    const co: any = snap.companies.find((c) => c.id === input.companyId && companyInScope(ctx.portfolio, c));
    if (!co) throw notFound('Empresa');
    if (input.rentalContractId) await findContract(ctx, input.rentalContractId);
    const itemsTotal = Math.round(input.items.reduce((a, i) => a + i.quantity * i.unitValue, 0) * 100) / 100;
    if (Math.abs(itemsTotal - input.grossAmount) > 0.01) throw new UseCaseError(422, 'ITEMS_TOTAL_MISMATCH', `Soma dos itens (${itemsTotal}) difere do valor bruto.`);
    return {
      entity: 'erp.invoice',
      entityId: co.id,
      before: null,
      preview: { action: 'EMITIR_DOCUMENTO_FISCAL', documentType: input.documentType, company: { id: co.id, name: str(co.name), cnpj: str(co.cnpj) || null }, grossAmount: input.grossAmount, discountAmount: input.discountAmount, items: input.items.length, competenceMonth: input.competenceMonth || null },
      effects: ['Documento fiscal emitido com numeracao propria; para desfazer, so cancelamento.'],
      run: async () => {
        const r = unwrapDangerous(
          await ctx.data.dangerous('POST', '/api/erp/invoices', {
            documentType: input.documentType,
            companyId: co.id,
            companyName: str(co.name),
            companyCnpj: str(co.cnpj),
            grossAmount: input.grossAmount,
            discountAmount: input.discountAmount,
            competenceMonth: input.competenceMonth,
            dueDate: input.dueDate,
            rentalContractId: input.rentalContractId,
            itemsDescription: input.items.map((i) => ({ description: i.description, quantity: i.quantity, unitValue: i.unitValue, totalValue: Math.round(i.quantity * i.unitValue * 100) / 100 })),
          }),
          'Documento fiscal'
        );
        return invoiceView(r);
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Contrato: gerar fatura, gerar remessa, faturamento em lote, devolucao parcial, reajuste
// ---------------------------------------------------------------------------
const erpContractsGenerateInvoice = defineDangerous({
  ...base,
  name: 'erp_contracts_generate_invoice',
  operationId: 'erp.contracts.generate_invoice',
  path: '/api/v1/erp/contracts/{id}/generate-invoice',
  pathParams: ['id'],
  op: 'issue',
  summary: 'Gerar fatura mensal do contrato',
  description: 'Gera a fatura da competencia do contrato (regras do app: valor, vencimento, impostos). Carteira TODOS + Fiscal e Contratos EDIT + canIssueFiscalDocuments.',
  inputSchema: z.object({ id: IdSchema, competenceMonth: Competence, dueDate: DateText.optional() }).strict(),
  async plan(input, ctx) {
    requireFiscal(ctx, 'Gerar fatura', true);
    const c: any = await findWritableContract(ctx, input.id);
    const dup = (await collections(ctx)).invoices.find((i: any) => i.rentalContractId === c.id && str(i.competenceMonth) === input.competenceMonth && !/CANCEL/i.test(String(i.status)));
    return {
      entity: 'erp.contract',
      entityId: c.id,
      before: { lastBilledCompetence: c.lastBilledCompetence ?? null },
      preview: { action: 'GERAR_FATURA', contract: { id: c.id, contractNumber: str(c.contractNumber), companyName: str(c.companyName), monthlyValue: Number(c.monthlyValue) || 0 }, competenceMonth: input.competenceMonth, existingInvoiceForCompetence: dup ? invoiceView(dup) : null },
      effects: ['Emite a fatura da competencia.', ...(dup ? ['ATENCAO: ja existe fatura nesta competencia.'] : [])],
      run: async () => {
        const body: Record<string, unknown> = { competenceMonth: input.competenceMonth };
        if (input.dueDate) body.dueDate = input.dueDate;
        return invoiceView(unwrapDangerous(await ctx.data.dangerous('POST', `/api/erp/rental-contracts/${enc(c.id)}/generate-invoice`, body), 'Contrato'));
      },
    };
  },
});

const erpContractsGenerateRemessa = defineDangerous({
  ...base,
  name: 'erp_contracts_generate_remessa',
  operationId: 'erp.contracts.generate_remessa',
  path: '/api/v1/erp/contracts/{id}/generate-remessa',
  pathParams: ['id'],
  op: 'issue',
  summary: 'Gerar NF-e de remessa do contrato',
  description: 'Gera a NF-e de remessa de locacao dos equipamentos do contrato. Carteira TODOS + Fiscal e Contratos EDIT + canIssueFiscalDocuments.',
  inputSchema: z.object({ id: IdSchema }).strict(),
  async plan(input, ctx) {
    requireFiscal(ctx, 'Gerar remessa', true);
    const c: any = await findWritableContract(ctx, input.id);
    const eq = Array.isArray(c.equipments) ? c.equipments : [];
    return {
      entity: 'erp.contract',
      entityId: c.id,
      before: { remessaNfeNumber: str(c.remessaNfeNumber) || null },
      preview: { action: 'GERAR_REMESSA', contract: { id: c.id, contractNumber: str(c.contractNumber), companyName: str(c.companyName) }, equipments: eq.length, existingRemessa: str(c.remessaNfeNumber) || null },
      effects: ['Emite NF-e de remessa (CFOP de remessa para locacao).'],
      run: async () => invoiceView(unwrapDangerous(await ctx.data.dangerous('POST', `/api/erp/rental-contracts/${enc(c.id)}/generate-remessa`, {}), 'Contrato')),
    };
  },
});

const BatchItem = z
  .object({ contractId: IdSchema, customAmountBrl: money.optional(), discountBrl: money.optional(), extraBrl: money.optional(), notes: text(500).optional() })
  .strict();
const erpContractsBatchBilling = defineDangerous({
  ...base,
  name: 'erp_contracts_batch_billing',
  operationId: 'erp.contracts.batch_billing',
  path: '/api/v1/erp/contracts/batch-billing',
  pathParams: [],
  op: 'issue',
  summary: 'Faturamento em lote dos contratos',
  description: 'Gera as faturas da competencia para ate 100 contratos (sem envio de e-mail pelo conector). Carteira TODOS + Fiscal e Contratos EDIT + canIssueFiscalDocuments.',
  inputSchema: z.object({ competenceMonth: Competence, items: z.array(BatchItem).min(1).max(100) }).strict(),
  async plan(input, ctx) {
    requireFiscal(ctx, 'Faturamento em lote', true);
    const ids = input.items.map((i) => i.contractId);
    if (new Set(ids).size !== ids.length) throw new UseCaseError(422, 'DUPLICATE_CONTRACT', 'Contrato repetido no lote.');
    const list: any[] = [];
    for (const id of ids) list.push(await findWritableContract(ctx, id));
    const total = list.reduce((a, c, i) => a + (input.items[i].customAmountBrl ?? Number(c.monthlyValue) ?? 0) - (input.items[i].discountBrl || 0) + (input.items[i].extraBrl || 0), 0);
    return {
      entity: 'erp.contract',
      entityId: `lote-${input.competenceMonth}`,
      before: null,
      preview: { action: 'FATURAR_EM_LOTE', competenceMonth: input.competenceMonth, contracts: list.map((c) => ({ id: c.id, contractNumber: str(c.contractNumber), companyName: str(c.companyName) })), estimatedTotal: Math.round(total * 100) / 100 },
      effects: [`${list.length} fatura(s) emitida(s). Nenhum e-mail sai por este comando.`],
      run: async () => {
        const items = input.items.map((i, idx) => ({ ...i, contractId: list[idx].id, sendEmail: false }));
        const r = unwrapDangerous(await ctx.data.dangerous('POST', '/api/erp/rental-contracts/batch-billing', { competenceMonth: input.competenceMonth, items }), 'Contratos');
        const created = Array.isArray(r?.invoices) ? r.invoices : Array.isArray(r?.created) ? r.created : [];
        return { invoicesCreated: created.length || Number(r?.createdCount) || 0, skipped: Number(r?.skippedCount) || (Array.isArray(r?.skipped) ? r.skipped.length : 0) };
      },
    };
  },
});

const erpContractsPartialReturn = defineDangerous({
  ...base,
  name: 'erp_contracts_partial_return',
  operationId: 'erp.contracts.partial_return',
  path: '/api/v1/erp/contracts/{id}/partial-return',
  pathParams: ['id'],
  op: 'issue',
  summary: 'Devolucao parcial de equipamentos',
  description: 'Registra a devolucao parcial; emitReturnNfe/emitProRataInvoice sao OBRIGATORIOS e explicitos (NF de retorno e fatura pro-rata). Carteira TODOS + Fiscal e Contratos EDIT + canIssueFiscalDocuments.',
  inputSchema: z
    .object({
      id: IdSchema,
      returnDate: DateText,
      cycleDaysUsed: z.number().int().min(0).max(31).optional(),
      itemsToReturn: z.array(z.object({ equipmentId: IdSchema.optional(), serialNumber: text(80).optional(), quantityReturned: z.number().int().positive().max(100000) }).strict()).min(1).max(200),
      emitReturnNfe: z.boolean(),
      emitProRataInvoice: z.boolean(),
      reason: text(500).min(3),
    })
    .strict(),
  async plan(input, ctx) {
    requireFiscal(ctx, 'Devolucao parcial', true);
    const c: any = await findWritableContract(ctx, input.id);
    const eq: any[] = Array.isArray(c.equipments) ? c.equipments : [];
    for (const it of input.itemsToReturn) {
      if (!it.equipmentId && !it.serialNumber) throw new UseCaseError(422, 'VALIDATION_ERROR', 'Cada item precisa de equipmentId ou serialNumber.');
      const e = eq.find((x) => (it.equipmentId && x.id === it.equipmentId) || (it.serialNumber && x.serialNumber === it.serialNumber));
      if (!e) throw new UseCaseError(422, 'EQUIPMENT_NOT_IN_CONTRACT', 'Equipamento nao pertence ao contrato.');
      if (it.quantityReturned > (Number(e.quantity) || 0)) throw new UseCaseError(422, 'RETURN_ABOVE_QUANTITY', 'Quantidade devolvida maior que a locada.');
    }
    return {
      entity: 'erp.contract',
      entityId: c.id,
      before: { equipments: eq.length, monthlyValue: Number(c.monthlyValue) || 0 },
      preview: { action: 'DEVOLUCAO_PARCIAL', contract: { id: c.id, contractNumber: str(c.contractNumber) }, items: input.itemsToReturn, emitReturnNfe: input.emitReturnNfe, emitProRataInvoice: input.emitProRataInvoice },
      effects: ['Contrato perde os itens devolvidos e o valor mensal e recalculado.', ...(input.emitReturnNfe ? ['Emite NF-e de retorno.'] : []), ...(input.emitProRataInvoice ? ['Emite fatura pro-rata.'] : [])],
      run: async () => {
        const { id: _id, ...rest } = input;
        const r = unwrapDangerous(await ctx.data.dangerous('POST', `/api/erp/rental-contracts/${enc(c.id)}/partial-return`, rest), 'Contrato');
        return { contractId: c.id, monthlyValue: Number(r?.contract?.monthlyValue ?? r?.newMonthlyValue) || null, returnNfeId: str(r?.returnNfe?.id) || null, proRataInvoiceId: str(r?.proRataInvoice?.id) || null };
      },
    };
  },
});

const erpContractsReadjust = defineDangerous({
  ...base,
  requiredScope: 'erp:contracts:readjust',
  name: 'erp_contracts_readjust',
  operationId: 'erp.contracts.readjust',
  path: '/api/v1/erp/contracts/{id}/readjust',
  pathParams: ['id'],
  op: 'readjust',
  // CISO 26/11 (2a rodada): executar o reajuste exige a mesma alcada financeira da baixa (Financeiro EDICAO).
  commitOwnerScopes: ['erp:financial:settle'],
  summary: 'Aplicar reajuste ao contrato',
  description: 'Aplica reajuste percentual (indice) ao valor mensal do contrato. Carteira TODOS + Contratos EDIT; o commit exige tambem a alcada financeira da baixa (Financeiro EDIT).',
  inputSchema: z.object({ id: IdSchema, percentage: z.number().finite().min(-50).max(100), index: z.enum(['IPCA', 'IGP-M', 'FIXO', 'IST_ANATEL']), note: text(500).optional() }).strict(),
  async plan(input, ctx) {
    requireAllPortfolio(ctx, 'Reajuste de contrato');
    if (!userHasErpAccess(ctx.owner, 'contracts', 'EDIT')) throw new UseCaseError(403, 'OWNER_ACCESS_INSUFFICIENT', 'O usuario dono nao tem edicao em Contratos.');
    const c: any = await findWritableContract(ctx, input.id);
    const before = Number(c.monthlyValue) || 0;
    const after = Math.round(before * (1 + input.percentage / 100) * 100) / 100;
    return {
      entity: 'erp.contract',
      entityId: c.id,
      before: { monthlyValue: before },
      preview: { action: 'REAJUSTAR_CONTRATO', contract: { id: c.id, contractNumber: str(c.contractNumber), companyName: str(c.companyName) }, index: input.index, percentage: input.percentage, monthlyValueBefore: before, monthlyValueAfterEstimated: after },
      effects: ['Valor mensal e itens sao reajustados; proximas faturas usam o novo valor.'],
      run: async () => {
        const r = unwrapDangerous(await ctx.data.dangerous('POST', `/api/erp/rental-contracts/${enc(c.id)}/readjust`, { percentage: input.percentage, index: input.index, note: input.note }), 'Contrato');
        return { contractId: c.id, monthlyValue: Number(r?.monthlyValue ?? r?.contract?.monthlyValue) || null };
      },
    };
  },
});

// ---------------------------------------------------------------------------
// NF-e de importacao (previa pelo /calculate, que so "espia" a numeracao)
// ---------------------------------------------------------------------------
const erpNfeImportEmit = defineDangerous({
  ...base,
  name: 'erp_nfe_import_emit',
  operationId: 'erp.nfe_import.emit',
  path: '/api/v1/erp/nfe-import/emit',
  pathParams: [],
  op: 'issue',
  summary: 'Emitir NF-e de importacao',
  description: 'Emite a NF-e de importacao (DI/adicoes) com a mesma entrada validada da tela ("request"). Previa = calculo do app sem reservar numero. Carteira TODOS + Fiscal EDIT + canIssueFiscalDocuments.',
  inputSchema: z.object({ request: z.record(z.string(), z.unknown()) }).strict(),
  async plan(input, ctx) {
    requireFiscal(ctx, 'NF-e de importacao');
    rejectMaskedValues(input.request);
    if (JSON.stringify(input.request).length > 512 * 1024) throw new UseCaseError(413, 'PAYLOAD_TOO_LARGE', 'Entrada da NF-e acima de 512 KB.');
    const calc: any = unwrapDangerous(await ctx.data.dangerous('POST', '/api/erp/nfe-importacao/calculate', input.request), 'NF-e de importacao');
    const meta = calc?.meta || calc;
    return {
      entity: 'erp.invoice',
      entityId: 'nfe-importacao',
      before: null,
      preview: { action: 'EMITIR_NFE_IMPORTACAO', nNF: str(meta?.nNF || meta?.ide?.nNF) || null, serie: str(meta?.serie || meta?.ide?.serie) || null, environment: str(meta?.environment || meta?.tpAmb) || null, totalNF: Number(meta?.totals?.vNF ?? meta?.vNF ?? meta?.totalNF) || null },
      effects: ['Reserva o numero da NF-e (nunca reaproveitado) e registra a nota de entrada.'],
      run: async () => invoiceView(unwrapDangerous(await ctx.data.dangerous('POST', '/api/erp/nfe-importacao/emit', input.request), 'NF-e de importacao')?.invoice ?? {}),
    };
  },
});

// ---------------------------------------------------------------------------
// Cancelar e excluir nota
// ---------------------------------------------------------------------------
async function findInvoice(ctx: UseCaseContext, id: string): Promise<any> {
  const inv = (await collections(ctx)).invoices.find((i: any) => i.id === id || str(i.documentNumber) === id);
  if (!inv) throw notFound('Documento fiscal');
  return inv;
}
const cancelBase = { ...base, requiredScope: 'erp:fiscal:cancel' as const };

const erpFiscalCancel = defineDangerous({
  ...cancelBase,
  name: 'erp_fiscal_documents_cancel',
  operationId: 'erp.fiscal_documents.cancel',
  path: '/api/v1/erp/fiscal-documents/{id}/cancel',
  pathParams: ['id'],
  op: 'cancel',
  summary: 'Cancelar fatura/NF',
  description: 'Cancela documento EMITIDA/VENCIDA (nunca PAGA). Justificativa obrigatoria (15+ caracteres, vai para a auditoria). Carteira TODOS + Fiscal EDIT + canIssueFiscalDocuments.',
  inputSchema: z.object({ id: IdSchema, reason: text(255).min(15) }).strict(),
  async plan(input, ctx) {
    requireFiscal(ctx, 'Cancelamento fiscal');
    const inv = await findInvoice(ctx, input.id);
    const st = String(inv.status || '').toUpperCase();
    if (!['EMITIDA', 'VENCIDA'].includes(st) || inv.paidAt) throw new UseCaseError(409, 'INVOICE_NOT_CANCELLABLE', `Documento ${st || 'sem status'} nao pode ser cancelado pelo conector.`);
    const linkedOpen = (await collections(ctx)).financialEntries.filter((f: any) => f.invoiceId === inv.id && f.type === 'RECEBER' && !/PAGO|CANCEL/i.test(String(f.status))).length;
    return {
      entity: 'erp.invoice',
      entityId: inv.id,
      before: { status: st },
      preview: { action: 'CANCELAR_DOCUMENTO_FISCAL', ...invoiceView(inv), companyName: str(inv.companyName), reason: input.reason, linkedOpenFinancialEntries: linkedOpen },
      effects: ['Documento passa a CANCELADA.', ...(linkedOpen ? [`${linkedOpen} lancamento(s) a receber em aberto vinculado(s) passam a CANCELADO na mesma transacao.`] : [])],
      run: async () => {
        const res = await ctx.data.dangerous('PATCH', `/api/erp/invoices/${enc(inv.id)}`, { status: 'CANCELADA' });
        const r = unwrapDangerous(res, 'Documento fiscal');
        const ids = Array.isArray((res.body as any)?.cancelledReceivableIds) ? (res.body as any).cancelledReceivableIds.map(String).slice(0, 200) : [];
        return { ...invoiceView(r), reason: input.reason, cancelledReceivableIds: ids };
      },
    };
  },
});

const erpFiscalDelete = defineDangerous({
  ...cancelBase,
  name: 'erp_fiscal_documents_delete',
  operationId: 'erp.fiscal_documents.delete',
  path: '/api/v1/erp/fiscal-documents/{id}/delete',
  pathParams: ['id'],
  op: 'delete',
  summary: 'Excluir fatura/NF CANCELADA',
  description: 'Exclui o registro de um documento JA CANCELADO e nao pago (o app nao confere uso: o conector so permite apos o cancelamento). Carteira TODOS + Fiscal EDIT + canIssueFiscalDocuments.',
  inputSchema: z.object({ id: IdSchema }).strict(),
  async plan(input, ctx) {
    requireFiscal(ctx, 'Exclusao de documento fiscal');
    const inv = await findInvoice(ctx, input.id);
    if (String(inv.status || '').toUpperCase() !== 'CANCELADA' || inv.paidAt) throw new UseCaseError(409, 'INVOICE_NOT_DELETABLE', 'So documento CANCELADO e nao pago pode ser excluido pelo conector.');
    const linked = (await collections(ctx)).financialEntries.filter((f: any) => f.invoiceId === inv.id).length;
    if (linked > 0) throw new UseCaseError(409, 'INVOICE_IN_USE', `Documento vinculado a ${linked} lancamento(s) financeiro(s).`);
    return {
      entity: 'erp.invoice',
      entityId: inv.id,
      before: invoiceView(inv),
      preview: { action: 'EXCLUIR', entity: 'erp.invoice', ...invoiceView(inv) },
      effects: ['Exclusao no app; copia integral fica na lixeira do conector.'],
      trash: [{ entity: 'erp.invoice', recordId: inv.id, record: inv }],
      run: async () => {
        unwrapDangerous(await ctx.data.dangerous('DELETE', `/api/erp/invoices/${enc(inv.id)}`, {}), 'Documento fiscal');
        return { deleted: true, deletedId: inv.id };
      },
    };
  },
});

export const lote3dUseCases: UseCaseDefinition[] = [
  ...erpFiscalIssue,
  ...erpContractsGenerateInvoice,
  ...erpContractsGenerateRemessa,
  ...erpContractsBatchBilling,
  ...erpContractsPartialReturn,
  ...erpContractsReadjust,
  ...erpNfeImportEmit,
  ...erpFiscalCancel,
  ...erpFiscalDelete,
];
