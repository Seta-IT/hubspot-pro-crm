// ============================================================================
// STI-hub — API v1 + MCP: Fase 2 / Lote 3c — FINANCEIRO (sempre carteira TODOS).
// Baixa de lancamento e de fatura, conciliacao OFX, confirmacao de importacao de documento
// (PDF/XML), importacao de XML de compra e contas bancarias (criar/editar; excluir so com saldo
// zero e sem uso). Sempre em duas etapas (dangerous.ts).
// ============================================================================
import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import { rejectMaskedValues, requireAllPortfolio, userHasErpAccess } from './common';
import { defineDangerous, unwrapDangerous } from './dangerous';
import { collections, str } from './erp';
import { IdSchema, notFound, text, UseCaseError, type UseCaseContext, type UseCaseDefinition } from './types';

const enc = encodeURIComponent;
const base = { tag: 'ERP' as const, requiredModule: 'erp' as const, domain: 'erp' as const };
const MAX_TEXT = 3 * 1024 * 1024;

function requireFinance(ctx: UseCaseContext, what: string): void {
  requireAllPortfolio(ctx, what);
  if (!userHasErpAccess(ctx.owner, 'finance', 'EDIT')) throw new UseCaseError(403, 'OWNER_ACCESS_INSUFFICIENT', 'O usuario dono nao tem edicao no Financeiro/Bancos.', { area: 'finance' });
}
const isPaid = (s: unknown) => ['PAGO', 'PAGA', 'RECEBIDO', 'LIQUIDADO'].includes(String(s || '').toUpperCase());

// ---------------------------------------------------------------------------
// Baixas
// ---------------------------------------------------------------------------
const erpFinancialPay = defineDangerous({
  ...base,
  name: 'erp_financial_entries_pay',
  operationId: 'erp.financial_entries.pay',
  path: '/api/v1/erp/financial-entries/{id}/pay',
  pathParams: ['id'],
  requiredScope: 'erp:financial:settle',
  op: 'pay',
  summary: 'Dar baixa (pagar/receber) em lancamento financeiro',
  description: 'Marca o lancamento em aberto como pago/recebido hoje. Carteira TODOS + edicao do Financeiro.',
  inputSchema: z.object({ id: IdSchema }).strict(),
  async plan(input, ctx) {
    requireFinance(ctx, 'Baixa financeira');
    const f: any = (await collections(ctx)).financialEntries.find((x) => x.id === input.id);
    if (!f) throw notFound('Lancamento');
    if (isPaid(f.status)) throw new UseCaseError(409, 'ALREADY_SETTLED', 'Lancamento ja baixado.');
    return {
      entity: 'erp.financial_entry',
      entityId: f.id,
      before: { status: str(f.status), paidAt: f.paidAt ?? null },
      preview: { action: 'DAR_BAIXA', id: f.id, type: str(f.type), description: str(f.description), companyName: str(f.companyName), amount: Number(f.amount) || 0, dueDate: str(f.dueDate) },
      effects: ['Lancamento passa a PAGO (data de hoje) e entra no realizado/DRE.'],
      run: async () => {
        const r = unwrapDangerous(await ctx.data.dangerous('POST', `/api/erp/financial/${enc(f.id)}/pay`, {}), 'Lancamento');
        return { id: f.id, status: str(r?.status) || 'PAGO', paidAt: str(r?.paidAt) || null };
      },
    };
  },
});

const erpInvoicesPay = defineDangerous({
  ...base,
  name: 'erp_invoices_pay',
  operationId: 'erp.invoices.pay',
  path: '/api/v1/erp/invoices/{id}/pay',
  pathParams: ['id'],
  requiredScope: 'erp:financial:settle',
  op: 'pay',
  summary: 'Dar baixa de pagamento em fatura',
  description: 'Marca a fatura como paga (e o titulo vinculado, pela regra do app). Carteira TODOS + edicao do Financeiro.',
  inputSchema: z.object({ id: IdSchema }).strict(),
  async plan(input, ctx) {
    requireFinance(ctx, 'Baixa de fatura');
    const inv: any = (await collections(ctx)).invoices.find((x) => x.id === input.id || str(x.documentNumber) === input.id);
    if (!inv) throw notFound('Fatura');
    if (isPaid(inv.status) || inv.paidAt) throw new UseCaseError(409, 'ALREADY_SETTLED', 'Fatura ja paga.');
    if (/CANCEL/i.test(String(inv.status))) throw new UseCaseError(409, 'INVOICE_CANCELLED', 'Fatura cancelada nao recebe baixa.');
    return {
      entity: 'erp.invoice',
      entityId: inv.id,
      before: { status: str(inv.status), paidAt: inv.paidAt ?? null },
      preview: { action: 'DAR_BAIXA', id: inv.id, documentNumber: str(inv.documentNumber), companyName: str(inv.companyName), netAmount: Number(inv.netAmount) || 0, dueDate: str(inv.dueDate) },
      effects: ['Fatura passa a PAGA (data de hoje).'],
      run: async () => {
        const r = unwrapDangerous(await ctx.data.dangerous('POST', `/api/erp/invoices/${enc(inv.id)}/pay`, {}), 'Fatura');
        return { id: inv.id, status: str(r?.status) || null, paidAt: str(r?.paidAt) || null };
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Conciliacao OFX (previa calculada sem gravar)
// ---------------------------------------------------------------------------
function parseOfx(ofx: string) {
  const blocks = ofx.match(/<STMTTRN>[\s\S]*?(?:<\/STMTTRN>|(?=<STMTTRN>)|$)/gi) || [];
  const tag = (blk: string, name: string) => {
    const m = blk.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'));
    return m ? m[1].trim() : '';
  };
  return blocks
    .map((blk) => {
      const raw = tag(blk, 'DTPOSTED');
      return { fitId: tag(blk, 'FITID'), date: raw.length >= 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : '', amount: Number(tag(blk, 'TRNAMT').replace(',', '.')) || 0 };
    })
    .filter((t) => t.amount !== 0);
}

const erpFinancialReconcileOfx = defineDangerous({
  ...base,
  name: 'erp_financial_reconcile_ofx',
  operationId: 'erp.financial.reconcile_ofx',
  path: '/api/v1/erp/financial/reconcile-ofx',
  pathParams: [],
  requiredScope: 'erp:financial:settle',
  op: 'reconcile',
  summary: 'Conciliar extrato OFX',
  description:
    'Concilia o extrato OFX com os lancamentos. autoPayMatched=true da baixa nos casados; autoCreateMissing=true cria lancamentos para o que nao casou. Carteira TODOS + edicao do Financeiro.',
  inputSchema: z
    .object({
      bankId: IdSchema,
      ofxContent: z.string().min(20).max(MAX_TEXT),
      autoPayMatched: z.boolean().default(false),
      autoCreateMissing: z.boolean().default(false),
    })
    .strict(),
  async plan(input, ctx) {
    requireFinance(ctx, 'Conciliacao OFX');
    const cols = await collections(ctx);
    if (!cols.bankAccounts.some((b) => b.id === input.bankId) && !/^\d{3}$/.test(input.bankId)) throw notFound('Conta bancaria');
    const tx = parseOfx(input.ofxContent);
    if (!tx.length) throw new UseCaseError(422, 'OFX_EMPTY', 'Nenhuma transacao encontrada no OFX.');
    const open = cols.financialEntries.filter((e: any) => !isPaid(e.status));
    const used = new Set<string>();
    let matches = 0;
    for (const t of tx) {
      const want = t.amount > 0 ? 'RECEBER' : 'PAGAR';
      const c: any = open.find((e: any) => !used.has(e.id) && e.type === want && Math.abs(Math.abs(t.amount) - Number(e.amount)) < 0.01);
      if (c) {
        used.add(c.id);
        matches++;
      }
    }
    const sha = (await import('node:crypto')).createHash('sha256').update(input.ofxContent).digest('hex').slice(0, 16);
    return {
      entity: 'erp.financial_reconciliation',
      entityId: `ofx-${sha}`,
      before: null,
      preview: {
        action: 'CONCILIAR_OFX',
        bankId: input.bankId,
        transactions: tx.length,
        credits: Math.round(tx.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0) * 100) / 100,
        debits: Math.round(tx.filter((t) => t.amount < 0).reduce((a, t) => a + t.amount, 0) * 100) / 100,
        probableMatches: matches,
        autoPayMatched: input.autoPayMatched,
        autoCreateMissing: input.autoCreateMissing,
      },
      effects: [
        'Registra a conciliacao do extrato.',
        ...(input.autoPayMatched ? [`Ate ${matches} lancamento(s) recebem baixa.`] : []),
        ...(input.autoCreateMissing ? ['Transacoes sem par viram lancamentos novos.'] : []),
      ],
      run: async () => {
        const r = await ctx.data.dangerous('POST', '/api/erp/financial/reconcile-ofx', { bankId: input.bankId, ofxContent: input.ofxContent, autoPayMatched: input.autoPayMatched, autoCreateMissing: input.autoCreateMissing });
        unwrapDangerous(r, 'Conciliacao');
        const b: any = r.body || {};
        const rec = Array.isArray(b.reconciledEntries) ? b.reconciledEntries : [];
        return { matchedCount: Number(b.matchedCount) || 0, paidCount: rec.filter((x: any) => x?.paid === true).length };
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Importacao de documento (PDF/XML): previa = leitura; commit = confirmacao
// ---------------------------------------------------------------------------
const Decision = z.object({ ref: text(60).min(1), action: z.enum(['MATCH', 'CREATE', 'IGNORE']), entryId: IdSchema.optional() }).strict();
const erpFinancialImportDocument = defineDangerous({
  ...base,
  name: 'erp_financial_import_document',
  operationId: 'erp.financial.import_document',
  path: '/api/v1/erp/financial/import-document',
  pathParams: [],
  requiredScope: 'erp:financial:settle',
  op: 'import',
  summary: 'Importar documento financeiro (boleto/nota em PDF ou XML)',
  description:
    'Le o PDF/XML (previa com as sugestoes de pareamento) e, no commit, confirma: parear com titulo a pagar existente (MATCH) ou criar titulo (CREATE). Sem "decisions" usa as sugestoes do app. Carteira TODOS + edicao do Financeiro.',
  inputSchema: z
    .object({
      fileName: text(200).min(1),
      fileType: z.enum(['pdf', 'xml']),
      content: z.string().max(MAX_TEXT).optional(),
      contentBase64: z.string().max(Math.ceil((MAX_TEXT * 4) / 3) + 8).optional(),
      decisions: z.array(Decision).max(200).optional(),
    })
    .strict(),
  async plan(input, ctx) {
    requireFinance(ctx, 'Importacao de documento');
    if (input.fileType === 'xml' ? !input.content : !input.contentBase64) throw new UseCaseError(422, 'VALIDATION_ERROR', 'XML vai em "content"; PDF vai em "contentBase64".');
    const parsedRes = await ctx.data.dangerous('POST', '/api/erp/financial/import-document', { fileName: input.fileName, fileType: input.fileType, content: input.content, contentBase64: input.contentBase64 });
    const parsed: any = unwrapDangerous(parsedRes, 'Documento');
    if (parsed.alreadyImportedAt) throw new UseCaseError(409, 'ALREADY_IMPORTED', `Arquivo ja importado em ${String(parsed.alreadyImportedAt).slice(0, 10)}.`);
    const suggestions: any[] = Array.isArray(parsed.items) ? parsed.items : [];
    const byRef = new Map((input.decisions || []).map((d) => [d.ref, d]));
    const items = suggestions.map((s, i) => {
      const ref = str(s.ref) || `item-${i + 1}`;
      const d = byRef.get(ref);
      const suggested = s.suggestedEntryId || s.match?.entryId || s.entryId || null;
      const action = d ? d.action : suggested ? 'MATCH' : 'CREATE';
      return { ...s, ref, action, entryId: action === 'MATCH' ? d?.entryId || suggested : null };
    });
    for (const ref of byRef.keys()) if (!items.some((i) => i.ref === ref)) throw new UseCaseError(422, 'UNKNOWN_ITEM_REF', `Item ${ref} nao existe no documento.`);
    return {
      entity: 'erp.financial_document_import',
      entityId: str(parsed.sha256).slice(0, 64),
      before: null,
      preview: {
        action: 'IMPORTAR_DOCUMENTO',
        kind: str(parsed.kind),
        issuerName: parsed.issuerName ?? null,
        documentNumber: parsed.documentNumber ?? null,
        totalAmount: parsed.totalAmount ?? null,
        warnings: parsed.warnings || [],
        items: items.map((i) => ({ ref: i.ref, description: str(i.description), amount: Number(i.amount) || 0, dueDate: str(i.dueDate), action: i.action, entryId: i.entryId })),
      },
      effects: ['Itens CREATE viram titulos a pagar; MATCH vincula ao titulo existente. O arquivo fica registrado (nao reimporta).'],
      run: async () => {
        const r = unwrapDangerous(
          await ctx.data.dangerous('POST', '/api/erp/financial/import-document/confirm', {
            fileName: input.fileName,
            fileType: input.fileType,
            sha256: parsed.sha256,
            kind: parsed.kind,
            issuerName: parsed.issuerName,
            issuerCnpj: parsed.issuerCnpj,
            documentNumber: parsed.documentNumber,
            items,
          }),
          'Importacao'
        );
        return { imported: true, createdCount: Number(r?.createdCount) || 0, matchedCount: Number(r?.matchedCount) || 0 };
      },
    };
  },
});

// ---------------------------------------------------------------------------
// XML de compra (NF-e de entrada)
// ---------------------------------------------------------------------------
const xmlTag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([^<]{0,200})</${name}>`, 'i'))?.[1]?.trim() || null;
const erpPurchasesImportXml = defineDangerous({
  ...base,
  name: 'erp_purchases_import_xml',
  operationId: 'erp.purchases.import_xml',
  path: '/api/v1/erp/purchases/import-xml',
  pathParams: [],
  requiredScope: 'erp:financial:settle',
  op: 'import',
  summary: 'Importar XML de NF-e de compra',
  description: 'Cria o pedido de compra a partir do XML da NF-e de entrada (e da entrada no estoque, se autoReceiveStock). Carteira TODOS + edicao do Financeiro e de Estoque/OS/Vendas.',
  inputSchema: z
    .object({
      xmlContent: z.string().min(50).max(MAX_TEXT),
      cfopEntrada: z.string().regex(/^\d\.?\d{3}$/).optional(),
      costCenter: text(120).optional(),
      autoReceiveStock: z.boolean().default(false),
    })
    .strict(),
  async plan(input, ctx) {
    requireFinance(ctx, 'Importacao de XML de compra');
    if (!userHasErpAccess(ctx.owner, 'stockOsSales', 'EDIT')) throw new UseCaseError(403, 'OWNER_ACCESS_INSUFFICIENT', 'O usuario dono nao tem edicao em Estoque/OS/Vendas.');
    const x = input.xmlContent;
    if (!/<infNFe/i.test(x)) throw new UseCaseError(422, 'XML_NOT_NFE', 'O arquivo nao parece uma NF-e (infNFe ausente).');
    const key = x.match(/Id="NFe(\d{44})"/)?.[1] || xmlTag(x, 'chNFe');
    return {
      entity: 'erp.purchase_order',
      entityId: key || 'xml',
      before: null,
      preview: { action: 'IMPORTAR_XML_COMPRA', accessKey: key, number: xmlTag(x, 'nNF'), supplier: xmlTag(x, 'xNome'), totalAmount: Number(xmlTag(x, 'vNF')) || null, items: (x.match(/<det\s/gi) || []).length, autoReceiveStock: input.autoReceiveStock },
      effects: ['Cria pedido de compra RECEBIDO com os itens da nota.', ...(input.autoReceiveStock ? ['Da entrada no estoque.'] : [])],
      run: async () => {
        const r = unwrapDangerous(await ctx.data.dangerous('POST', '/api/erp/purchases/import-xml', { xmlContent: x, cfopEntrada: input.cfopEntrada, costCenter: input.costCenter, autoReceiveStock: input.autoReceiveStock }), 'Compra');
        const po = r?.purchaseOrder || r;
        return { purchaseOrderId: str(po?.id) || null, code: str(po?.code) || null, totalAmount: Number(po?.totalAmount) || 0 };
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Contas bancarias
// ---------------------------------------------------------------------------
const money = z.number().finite().min(-1_000_000_000).max(1_000_000_000);
const bankStatus = (b: number) => (b > 0 ? 'POSITIVE' : b < 0 ? 'NEGATIVE' : 'ZERO');
const bankBase = { ...base, requiredScope: 'erp:banks:write' as const };

const erpBanksCreate = defineDangerous({
  ...bankBase,
  name: 'erp_bank_accounts_create',
  operationId: 'erp.bank_accounts.create',
  path: '/api/v1/erp/bank-accounts',
  pathParams: [],
  op: 'create',
  summary: 'Cadastrar conta bancaria',
  description: 'Cadastra conta bancaria com saldo inicial. Carteira TODOS + edicao do Financeiro + ver saldos bancarios.',
  inputSchema: z.object({ name: text(120).min(2), initialBalance: money.default(0) }).strict(),
  async plan(input, ctx) {
    requireFinance(ctx, 'Contas bancarias');
    rejectMaskedValues(input);
    const cols = await collections(ctx);
    if (cols.bankAccounts.some((b) => str(b.name).toLowerCase() === input.name.toLowerCase())) throw new UseCaseError(409, 'BANK_ACCOUNT_EXISTS', 'Ja existe conta bancaria com esse nome.');
    const id = `bank-api-${randomUUID().slice(0, 18)}`;
    return {
      entity: 'erp.bank_account',
      entityId: input.name,
      before: null,
      preview: { action: 'CRIAR_CONTA_BANCARIA', name: input.name, initialBalance: input.initialBalance },
      effects: ['Saldo inicial entra no saldo disponivel do painel.'],
      run: async () => {
        const r = unwrapDangerous(
          await ctx.data.dangerous('POST', '/api/erp/records/bankAccounts', { id, name: input.name, balance: input.initialBalance, status: bankStatus(input.initialBalance), lastMovedAt: new Date().toISOString() }),
          'Conta bancaria'
        );
        return { id: str(r?.id) || id, name: str(r?.name) || input.name, balance: Number(r?.balance) || 0 };
      },
    };
  },
});

const erpBanksUpdate = defineDangerous({
  ...bankBase,
  name: 'erp_bank_accounts_update',
  operationId: 'erp.bank_accounts.update',
  path: '/api/v1/erp/bank-accounts/{id}/update',
  pathParams: ['id'],
  op: 'update',
  summary: 'Editar conta bancaria (nome/ajuste de saldo)',
  description: 'Renomeia a conta e/ou ajusta o saldo (ajuste manual auditado). Carteira TODOS + edicao do Financeiro + ver saldos bancarios.',
  inputSchema: z.object({ id: IdSchema, name: text(120).min(2).optional(), balance: money.optional() }).strict(),
  async plan(input, ctx) {
    requireFinance(ctx, 'Contas bancarias');
    rejectMaskedValues(input);
    if (input.name === undefined && input.balance === undefined) throw new UseCaseError(422, 'EMPTY_PATCH', 'Informe name e/ou balance.');
    const b: any = (await collections(ctx)).bankAccounts.find((x) => x.id === input.id);
    if (!b) throw notFound('Conta bancaria');
    const patch: Record<string, unknown> = { ...b };
    if (input.name !== undefined) patch.name = input.name;
    if (input.balance !== undefined) Object.assign(patch, { balance: input.balance, status: bankStatus(input.balance), lastMovedAt: new Date().toISOString() });
    return {
      entity: 'erp.bank_account',
      entityId: b.id,
      before: { name: str(b.name), balance: Number(b.balance) || 0 },
      preview: { action: 'EDITAR_CONTA_BANCARIA', id: b.id, from: { name: str(b.name), balance: Number(b.balance) || 0 }, to: { name: patch.name, balance: patch.balance } },
      effects: input.balance !== undefined ? ['Ajuste manual de saldo (sem lancamento de contrapartida).'] : ['So o nome muda.'],
      run: async () => {
        const r = unwrapDangerous(await ctx.data.dangerous('PATCH', `/api/erp/records/bankAccounts/${enc(b.id)}`, patch), 'Conta bancaria');
        return { id: b.id, name: str(r?.name), balance: Number(r?.balance) || 0 };
      },
    };
  },
});

const erpBanksDelete = defineDangerous({
  ...bankBase,
  requiredScope: 'erp:records:delete',
  name: 'erp_bank_accounts_delete',
  operationId: 'erp.bank_accounts.delete',
  path: '/api/v1/erp/bank-accounts/{id}/delete',
  pathParams: ['id'],
  op: 'delete',
  summary: 'Excluir conta bancaria (so saldo zero e sem uso)',
  description: 'Exclui conta bancaria SEM saldo e sem uso (o app recusa se houver lancamentos vinculados). Carteira TODOS + edicao do Financeiro + canDeleteErpRecords + ver saldos.',
  inputSchema: z.object({ id: IdSchema }).strict(),
  async plan(input, ctx) {
    requireFinance(ctx, 'Contas bancarias');
    if (!ctx.owner.erpAccess.canViewBankBalances) throw new UseCaseError(403, 'OWNER_ACCESS_INSUFFICIENT', 'Exige permissao de ver saldos bancarios.');
    const b: any = (await collections(ctx)).bankAccounts.find((x) => x.id === input.id);
    if (!b) throw notFound('Conta bancaria');
    if (Math.abs(Number(b.balance) || 0) >= 0.005) throw new UseCaseError(409, 'BANK_ACCOUNT_HAS_BALANCE', 'Conta com saldo nao e excluida pelo conector.');
    return {
      entity: 'erp.bank_account',
      entityId: b.id,
      before: { name: str(b.name), balance: 0 },
      preview: { action: 'EXCLUIR', entity: 'erp.bank_account', id: b.id, name: str(b.name), balance: 0 },
      effects: ['Exclusao definitiva.'],
      run: async () => {
        unwrapDangerous(await ctx.data.dangerous('DELETE', `/api/erp/records/bankAccounts/${enc(b.id)}`, {}), 'Conta bancaria');
        return { deleted: true, deletedId: b.id };
      },
    };
  },
});

export const lote3cUseCases: UseCaseDefinition[] = [
  ...erpFinancialPay,
  ...erpInvoicesPay,
  ...erpFinancialReconcileOfx,
  ...erpFinancialImportDocument,
  ...erpPurchasesImportXml,
  ...erpBanksCreate,
  ...erpBanksUpdate,
  ...erpBanksDelete,
];
