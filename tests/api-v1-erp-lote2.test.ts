// ============================================================================
// STI-hub — API v1 + MCP — Fase 2 / Lote 2 (24/11/2026): ESCRITAS REVERSIVEIS no ERP e CRM.
// Cobre: cada ferramenta (REST e MCP), negacoes (escopo, modulo, alcada EDICAO, TODOS, carteira,
// valor mascarado, campo desconhecido), garantia de que nenhuma escrita gera fatura/NF/e-mail/
// ativacao, Idempotency-Key obrigatoria (428) + replay, auditoria antes/depois e consentimento.
// Sem rede e sem Postgres real (store de integracao em memoria SOMENTE de teste).
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createInMemoryRepository, type CrmRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { RouterDataPort } from '../src/modules/integration/data-port';
import { TestOnlyMemoryIntegrationStore } from '../src/modules/integration/store-memory';
import { defaultLimits, type IntegrationDeps } from '../src/modules/integration/runtime';
import type { IntegrationHttpRequest, IntegrationHttpResponse } from '../src/modules/integration/http';
import { handleRestV1 } from '../src/modules/integration/rest';
import { handleMcp } from '../src/modules/integration/mcp';
import { handleOAuth } from '../src/modules/integration/oauth';
import { handleIamIntegrationKeys } from '../src/modules/integration/iam-keys';
import { buildOpenApiDocument } from '../src/modules/integration/openapi';
import { INTEGRATION_USE_CASES } from '../src/modules/integration/use-cases';
import { LOTE1_SCOPES, LOTE2_WRITE_SCOPES, isBlockedScope, validateRequestedScopes } from '../src/modules/integration/scopes';
import { LOTE2_WRITE_OPERATIONS } from '../src/modules/integration/use-cases';
import { finishIdempotency } from '../src/modules/integration/executor';
import { PLAN_EXPANSION_FLAG, PLAN_EXPANSION_OPERATIONS } from '../src/modules/integration/use-cases';
import { salesOrderVersion, serviceOrderVersion } from '../src/modules/erp/service-order-version';
import { assertKvRecordPreconditions, fullSchemaDdl, KV_RECORD_PRECONDITION_SQL, KvRecordVersionConflictError, syncStateToPostgres } from '../src/db/postgres';
import { INTEGRATION_SCHEMA_SQL, PostgresIntegrationStore } from '../src/modules/integration/store-postgres';
import { API_V1_MANUAL_MIGRATION_SQL, API_V1_MANUAL_TABLES } from '../src/modules/integration/migrations/api-v1-manual-migration';
import { applyRecordOwnerBackfill, BACKFILL_INSERT_SQL, planRecordOwnerBackfill } from '../src/modules/integration/migrations/record-owners-backfill';

// Ponto (9): este arquivo testa tambem editar OS e criar/editar pedido de venda => liga a flag.
process.env[PLAN_EXPANSION_FLAG] = '1';

const soV = (env: { repo: { getErpState(): any } }, id: string) => salesOrderVersion((env.repo.getErpState().salesOrders || []).find((x: any) => x.id === id) || null);
const ORIGIN = 'https://stihub.test';
const CSC_SECRET = 'CSCSEGREDO1234567890ABCD';
const GC_TOKEN_MASK = 'gcTok-XYZ-123456';
const EMP_PHONE = '(11) 98765-4321';


type U = { uid: string; email: string; name: string; roleId: string; scope: string; admin?: boolean; erp?: boolean };
const ADMIN: U = { uid: 'usr-api-admin', email: 'admin.api@seta.test', name: 'Admin API', roleId: 'SUPER_ADMIN', scope: 'TODOS', admin: true, erp: true };
const ANA: U = { uid: 'usr-ana', email: 'ana@seta.test', name: 'Ana Vendas', roleId: 'GERENTE_COMERCIAL', scope: 'PROPRIOS', erp: true };
const BRUNO: U = { uid: 'usr-bruno', email: 'bruno@seta.test', name: 'Bruno Vendas', roleId: 'VENDEDOR_SALES', scope: 'PROPRIOS', erp: true };
const CARLA: U = { uid: 'usr-carla', email: 'carla@seta.test', name: 'Carla Outra', roleId: 'VENDEDOR_SALES', scope: 'PROPRIOS', erp: true };
const FIN: U = { uid: 'usr-fin', email: 'fin@seta.test', name: 'Fernanda Financeiro', roleId: 'FINANCEIRO_FATURAMENTO', scope: 'TODOS', erp: true };

function session(u: U) {
  return signStiHubSessionToken({
    uid: u.uid,
    email: u.email,
    name: u.name,
    roleId: u.roleId,
    scope: u.scope,
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'],
    moduleAccess: { crm: true, erp: u.erp !== false, chamados: true },
    canManageUsersRbac: u.admin === true,
    mfaVerified: true,
    mfaMethod: 'TOTP_AUTHENTICATOR',
    iat: Date.now(),
    exp: Date.now() + 3_600_000,
  } as never);
}

const FULL_ERP = {
  financeBanksAccess: 'FULL',
  fiscalIssuanceAccess: 'FULL',
  proposalsQuotesAccess: 'FULL',
  stockOsSalesAccess: 'FULL',
  rentalContractsAccess: 'FULL',
  canViewBankBalances: true,
};
const SELLER_ERP = {
  financeBanksAccess: 'NONE',
  fiscalIssuanceAccess: 'NONE',
  proposalsQuotesAccess: 'EDIT',
  stockOsSalesAccess: 'VIEW',
  rentalContractsAccess: 'VIEW',
  canViewBankBalances: false,
};

interface Env {
  repo: CrmRepository;
  router: CrmApiRouter;
  store: TestOnlyMemoryIntegrationStore;
  deps: IntegrationDeps;
  ids: Record<string, string>;
}

function userRec(env: Env, id: string) {
  const u = env.repo.getRbacState().users.find((x) => x.id === id);
  assert.ok(u, id);
  return u!;
}

function makeEnv(): Env {
  const repo = createInMemoryRepository();
  const router = new CrmApiRouter(repo);
  const users = [ADMIN, ANA, BRUNO, CARLA, FIN];
  for (const u of users) {
    repo.upsertRbacUser({ id: u.uid, email: u.email, name: u.name, roleId: u.roleId as never, scope: u.scope as never, active: true });
  }
  for (const u of users) {
    const r = repo.getRbacState().users.find((x) => x.id === u.uid)!;
    r.active = true;
    r.scope = u.scope as never;
    r.moduleAccess = { crm: true, erp: u.erp !== false, chamados: true };
    r.crmPermissions = {
      ...(r.crmPermissions as NonNullable<typeof r.crmPermissions>),
      portfolioScope: u.scope as never,
      contactsAccess: 'FULL',
      companiesAccess: 'FULL',
      dealsFunnelAccess: 'FULL',
      ticketsServiceDeskAccess: 'FULL',
      marketingAutomationAccess: 'VIEW',
    };
    const perms = u.uid === ADMIN.uid || u.uid === FIN.uid ? FULL_ERP : SELLER_ERP;
    r.erpPermissions = { ...(r.erpPermissions as NonNullable<typeof r.erpPermissions>), erpRole: 'X', maxDiscountPercent: 0, canIssueFiscalDocuments: false, canApproveProposals: false, canDeleteErpRecords: false, ...(perms as object) } as never;
  }
  const coAna = repo.createCompany({ name: 'Empresa Ana Ltda', ownerName: 'Ana Vendas' });
  const coCarla = repo.createCompany({ name: 'Empresa Carla SA', ownerName: 'Carla Outra' });
  const cAna = repo.createContact({ firstName: 'Cliente', lastName: 'DaAna', email: 'cliente.ana@empresa-a.com.br', ownerId: 'usr-ana', ownerName: 'Ana Vendas' });
  const cCarla = repo.createContact({ firstName: 'Zuleica', lastName: 'DaCarla', email: 'zuleica@empresa-c.com.br', ownerId: 'usr-carla', ownerName: 'Carla Outra' });
  const tAna = repo.createTask({ title: 'Ligar para cliente da Ana', assignedTo: 'Ana Vendas', contactId: cAna.id } as never);
  const tCarla = repo.createTask({ title: 'Tarefa da Carla', assignedTo: 'Carla Outra', contactId: cCarla.id } as never);

  const erp = repo.getErpState();
  const now = new Date().toISOString();
  const proposal = (id: string, code: string, seller: U, companyId: string | null) =>
    ({
      id, code, title: `Proposta ${code}`, status: 'ENVIADA', companyId, companyName: 'Cliente X', companyCnpj: '', contactId: null, contactName: 'Fulano',
      dealId: null, sellerName: seller.name, sellerEmail: seller.email, sellerUserId: seller.uid, contractMonths: 12, paymentCondition: '30d', validUntil: '2026-12-31',
      items: [{ id: 'it1', sku: 'SKU1', description: 'Item', fiscalNature: 'LOCACAO', ncmOrServiceCode: '', quantity: 2, unitPrice: 100, discountPercent: 0, isRecurring: true, totalMonthly: 200 }],
      monthlyRecurringTotal: 200, oneTimeSetupTotal: 0, totalContractValue: 2400, commercialNotes: '', technicalClauses: '', internalNotes: 'NOTA-INTERNA-NAO-VAZA',
      version: 2, versionHistory: [{ version: 1, versionLabel: 'v1', savedAt: now, savedBy: seller.email, changedFields: ['title'], changeSummary: 'criada', snapshot: { segredo: 'SNAPSHOT-NAO-VAZA' } }],
      createdAt: now, updatedAt: now,
    }) as never;
  erp.proposals.push(proposal('prop-ana', 'ORC-9001', ANA, coAna.id), proposal('prop-carla', 'ORC-9002', CARLA, coCarla.id));
  const contract = (id: string, num: string, seller: string, companyId: string | null) =>
    ({
      id, contractNumber: num, title: `Contrato ${num}`, companyId, companyName: 'Cliente', companyCnpj: '', contactId: null, dealId: null, proposalId: null,
      monthlyValue: 500, dueDay: 10, startDate: '2026-01-01', endDate: '2026-12-31', contractMonths: 12, readjustmentIndex: 'IPCA', status: 'ATIVO',
      equipments: [{ id: 'eq1', skuGestaoClick: 'EQ1', description: 'Roteador', serialNumber: 'SN1', ncm: '', quantity: 1, unitMonthlyRent: 500, assetValueBrl: 0, remessaCfop: '5.908', remessaNfeKey: '' }],
      remessaNfeNumber: '', remessaCfop: '5.908', legalBasisNote: '', lastBilledCompetence: null, sellerName: seller, paymentLinkUrl: 'https://pay.example/SEGREDO',
      version: 1, versionHistory: [], createdAt: now, updatedAt: now,
    }) as never;
  erp.rentalContracts.push(contract('ctr-ana', 'CT-001', 'Ana Vendas', null), contract('ctr-carla-co', 'CT-002', 'Outro Vendedor', coCarla.id), contract('ctr-ana-co', 'CT-003', 'Outro Vendedor', coAna.id));
  erp.serviceOrders = [
    { id: 'os-ana', code: 'OS-1', companyName: 'C', sellerName: 'Outro', technicianName: 'Ana Vendas', entryDate: '2026-11-01', exitDate: '', status: 'ABERTA', totalAmount: 90, description: 'Troca' },
    { id: 'os-carla', code: 'OS-2', companyName: 'C', sellerName: 'Carla Outra', technicianName: 'Tec', entryDate: '2026-11-02', exitDate: '', status: 'ABERTA', totalAmount: 80, description: 'Visita' },
  ] as never;
  erp.salesOrders = [
    { id: 'so-ana', code: 'PV-1', companyName: 'C', sellerName: 'Ana Vendas', date: '2026-11-01', status: 'OK', totalAmount: 10, itemsSummary: 'x' },
    { id: 'so-carla', code: 'PV-2', companyName: 'C', sellerName: 'Carla Outra', date: '2026-11-02', status: 'OK', totalAmount: 20, itemsSummary: 'y' },
  ] as never;
  erp.purchaseOrders = [{ id: 'po-1', code: 'PC-1', supplierName: 'Forn', issueDate: '2026-11-01', status: 'RECEBIDO', nfeNumber: '123', nfeAccessKey: 'CHAVE-NAO-VAZA', totalAmount: 1000 }] as never;
  erp.suppliers = [{ id: 'sup-1', name: 'Fornecedor Um', legalName: 'Forn Um Ltda', cnpj: '11.111.111/0001-11', phone: '1111', email: 'f@f.com', active: true }] as never;
  erp.employees = [{ id: 'emp-1', name: 'Colaborador Um', role: 'Tecnico', email: 'c@seta.test', phone: EMP_PHONE, active: true }] as never;
  erp.bankAccounts = [{ id: 'bank-1', name: 'Banco X', lastMovedAt: now, balance: 12345.67, status: 'POSITIVE' }] as never;
  erp.financialEntries.push({ id: 'fin-1', type: 'RECEBER', category: 'LOCACAO', description: 'Mensalidade', companyName: 'C', costCenter: 'CC', amount: 500, dueDate: '2026-11-10', paidAt: null, status: 'ABERTO', invoiceId: null, paymentMethod: 'PIX' } as never);
  erp.invoices.push({
    id: 'inv-1', documentNumber: 'NF-777', documentType: 'FATURA_LOCACAO', competenceMonth: '11/2026', companyId: null, companyName: 'C', companyCnpj: '', companyAddress: 'Rua',
    rentalContractId: 'ctr-ana', proposalId: null, dealId: null, grossAmount: 500, discountAmount: 0, netAmount: 500, status: 'EMITIDA', issueDate: '2026-11-01', dueDate: '2026-11-10',
    paidAt: null, paymentMethod: 'BOLETO_PIX', cfop: null, cstIcms: null, cstPisCofins: null, verificationCodeOrKey: 'KEY1', pixCopyPaste: 'PIX-COPIA-NAO-VAZA', boletoDigitableLine: 'BOLETO-NAO-VAZA',
    itemsDescription: [{ description: 'Locacao', quantity: 1, unitValue: 500, totalValue: 500 }], taxBreakdown: {}, createdAt: now, updatedAt: now,
  } as never);
  erp.catalog.push({ id: 'cat-1', gestaoClickCode: 'P-1', name: 'Roteador AX', category: 'EQUIPAMENTO_LOCACAO', fiscalNature: 'LOCACAO', cfopDefault: '5.908', stockAvailable: 3, stockRentedInClients: 1, monthlyRentalPrice: 99, saleOrSetupPrice: 500, isActive: true, costPrice: 321, profitMarginPercent: 40 } as never);
  erp.fiscalDocumentSettings = {
    nfe: { environment: 'HOMOLOGACAO', serie: '1', removeIcmsFromPisCofinsBase: false, simplifiedDanfe: false, additionalInfo: '' },
    nfce: { environment: 'HOMOLOGACAO', serie: '2', tokenId: '000001', csc: CSC_SECRET, additionalInfo: '' },
    nfse: { standard: 'ABRASF', environment: 'HOMOLOGACAO', rpsSerie: '10001', operationNature: 'X', specialRegime: 'X', taxApportionment: 'X', cityClassification: '', cityOperationIndicator: '', additionalInfo: '' },
    xmlDownloadAuthorizations: ['11144477735'],
    certificate: { status: 'VALIDO', validUntil: '2027-01-01', certificateCnpj: '99999999000199', uploadEnabled: false },
    productionSeedApplied: false,
    updatedAt: now,
    updatedBy: 'admin',
  } as never;
  (erp.gestaoClickConfig as any).accessTokenMasked = GC_TOKEN_MASK;
  (erp.gestaoClickConfig as any).secretTokenMasked = GC_TOKEN_MASK;
  (erp.gestaoClickConfig as any).apiBaseUrl = 'https://gc.internal.example/api';

  const store = new TestOnlyMemoryIntegrationStore();
  const deps: IntegrationDeps = {
    store,
    createDataPort: () => new RouterDataPort(router),
    now: () => new Date(),
    limits: { ...defaultLimits(), perCredentialPerMinute: 5000, oauthPerIpPerMinute: 1000 },
  };
  return { repo, router, store, deps, ids: { coAna: coAna.id, coCarla: coCarla.id, cAna: cAna.id, tAna: tAna.id, tCarla: tCarla.id } };
}

function req(method: string, path: string, opts: { headers?: Record<string, string>; body?: unknown; query?: Record<string, string>; session?: string } = {}): IntegrationHttpRequest {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.headers || {})) headers[k.toLowerCase()] = v;
  return { method, path, headers, query: opts.query || {}, body: opts.body, cookies: opts.session ? { stihub_session: opts.session } : {}, ip: '200.10.10.11', origin: ORIGIN };
}
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const body = (r: IntegrationHttpResponse) => r.body as any;
const rpc = (token: string, msg: unknown) => req('POST', '/api/mcp', { headers: { ...bearer(token), accept: 'application/json, text/event-stream' }, body: msg });

async function createKey(env: Env, input: Record<string, unknown>) {
  const res = await handleIamIntegrationKeys(req('POST', '/api/iam/integration-keys', { session: session(ADMIN), body: input }), env.deps);
  return { res, secret: body(res)?.secret as string };
}
async function keyFor(env: Env, owner: string, portfolioScope: string, scopes: string[], moduleAccess = { crm: true, chamados: false, erp: true }) {
  const k = await createKey(env, { name: `k ${owner}`, scopes, portfolioScope, moduleAccess, ownerUserId: owner });
  assert.equal(k.res.status, 201, JSON.stringify(k.res.body));
  return k.secret;
}
const get = (env: Env, key: string, path: string, query: Record<string, string> = {}) => handleRestV1(req('GET', path, { headers: bearer(key), query }), env.deps);

// ---------------------------------------------------------------------------
// Helpers do Lote 2
// ---------------------------------------------------------------------------
const W = [...LOTE2_WRITE_SCOPES];
const ALL_MODULES = { crm: true, chamados: true, erp: true };
let idemSeq = 0;
const nextIdem = () => `lote2-test-${++idemSeq}-${randomBytes(4).toString('hex')}`;
function send(env: Env, key: string, method: string, path: string, payload: unknown, idem: string | null | undefined = undefined) {
  const headers: Record<string, string> = { ...bearer(key) };
  const k = idem === undefined ? (method === 'POST' ? nextIdem() : null) : idem;
  if (k) headers['idempotency-key'] = k;
  return handleRestV1(req(method, path, { headers, body: payload }), env.deps);
}
function grantMarketing(env: Env, uid: string) {
  const r = userRec(env, uid);
  r.crmPermissions = { ...(r.crmPermissions as NonNullable<typeof r.crmPermissions>), marketingAutomationAccess: 'FULL' as never };
}
async function adminKey(env: Env) {
  grantMarketing(env, ADMIN.uid);
  return keyFor(env, ADMIN.uid, 'TODOS', [...W, ...LOTE1_SCOPES, 'tickets:read'], ALL_MODULES as never);
}
function addTicket(env: Env) {
  return env.repo.createServiceTicket({
    subject: 'Roteador sem sinal',
    description: 'TEXTO-DO-CLIENTE-NAO-COPIADO',
    category: 'SUPPORT',
    priority: 'HIGH',
    status: 'OPEN',
    channel: 'EMAIL',
    contactId: env.ids.cAna,
    companyId: env.ids.coAna,
    pipelineId: 'pl-tec',
  } as never);
}
const lastAudit = (env: Env, action: string) => [...env.store.audit].reverse().find((a) => a.action === action);

// ---------------------------------------------------------------------------
describe('Lote 2: catalogo de escritas, escopos e OpenAPI', () => {
  it('31 escritas POST/PATCH na allowlist fechada; criacoes exigem Idempotency-Key; 9 escopos :write liberados', () => {
    const writes = INTEGRATION_USE_CASES.filter((u) => LOTE2_WRITE_SCOPES.has(u.requiredScope));
    assert.equal(writes.length, 31);
    assert.equal(LOTE2_WRITE_OPERATIONS.size, 31);
    assert.equal(LOTE2_WRITE_SCOPES.size, 9);
    for (const uc of writes) {
      assert.ok(LOTE2_WRITE_OPERATIONS.has(uc.operationId), uc.operationId);
      assert.ok(['POST', 'PATCH'].includes(uc.method), uc.toolName);
      assert.equal(uc.mutation, true, uc.toolName);
      if (uc.method === 'POST' && !uc.idempotent) assert.equal(uc.requireIdempotencyKey, true, uc.toolName);
      assert.ok(!/delete|merge|approve|aprovar|accept|aceite|send|enviar|emit|pay|baixa|activate|ativar|trigger|enroll|xml|import/i.test(uc.toolName), uc.toolName);
    }
    for (const s of W) {
      assert.equal(isBlockedScope(s), false, s);
      assert.equal(validateRequestedScopes(`crm:contacts:read ${s}`).ok, true, s);
    }
    for (const s of ['erp:fiscal:write', 'erp:invoices:write', 'erp:banks:delete', 'crm:sequences:write', 'erp:gestaoclick:write', 'crm:contacts:delete']) {
      assert.equal(validateRequestedScopes(`crm:contacts:read ${s}`).ok, false, s);
    }
    const doc = buildOpenApiDocument() as any;
    const create = doc.paths['/api/v1/erp/proposals'].post;
    assert.ok(create);
    const idemParam = create.parameters.find((p: { name: string }) => p.name === 'Idempotency-Key');
    assert.equal(idemParam.required, true);
    assert.equal(create['x-idempotency-key-required'], true);
    assert.ok(create.responses['428']);
    assert.ok(doc.paths['/api/v1/erp/contracts/{id}'].patch);
    for (const ops of Object.values(doc.paths as Record<string, Record<string, unknown>>)) {
      assert.ok(!('put' in ops) && !('delete' in ops));
    }
  });
});

// ---------------------------------------------------------------------------
describe('Lote 2: cada ferramenta (admin, TODOS) sem gerar fatura/NF/e-mail/ativacao', () => {
  it('REST: cria/edita/restaura/renova/duplica/conclui e mantem as invariantes', async () => {
    const env = makeEnv();
    const key = await adminKey(env);
    const erp = env.repo.getErpState();
    const invoicesBefore = erp.invoices.length;
    const enrollBefore = env.repo.listSequenceEnrollments().length;

    // Orcamentos
    const p = await send(env, key, 'POST', '/api/v1/erp/proposals', { title: 'Orc API', companyId: env.ids.coAna, items: [{ description: 'Roteador', quantity: 2, unitPrice: 100 }] });
    assert.equal(p.status, 201, JSON.stringify(p.body));
    const prop = body(p).data;
    assert.equal(prop.status, 'RASCUNHO');
    assert.equal(prop.companyName, 'Empresa Ana Ltda');
    const pu = await send(env, key, 'PATCH', `/api/v1/erp/proposals/${prop.id}`, { title: 'Orc API v2', status: 'EM_NEGOCIACAO' });
    assert.equal(pu.status, 200, JSON.stringify(pu.body));
    assert.equal(body(pu).data.title, 'Orc API v2');
    const stored = erp.proposals.find((x) => x.id === prop.id)!;
    const v = (stored.versionHistory || []).map((h) => h.version)[0];
    if (v) {
      const pr = await send(env, key, 'POST', `/api/v1/erp/proposals/${prop.id}/restore-version`, { targetVersion: v });
      assert.equal(pr.status, 200, JSON.stringify(pr.body));
    }
    assert.ok(!['APROVADA', 'CONVERTIDA_CONTRATO'].includes(String(erp.proposals.find((x) => x.id === prop.id)!.status)));

    // Contratos
    const c = await send(env, key, 'POST', '/api/v1/erp/contracts', { title: 'Contrato API', companyId: env.ids.coAna, equipments: [{ description: 'Switch', quantity: 1, unitMonthlyRent: 300 }] });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    const ctr = body(c).data;
    const cu = await send(env, key, 'PATCH', `/api/v1/erp/contracts/${ctr.id}`, { dueDay: 15, contractNotes: 'ajuste' });
    assert.equal(cu.status, 200, JSON.stringify(cu.body));
    const storedC = erp.rentalContracts.find((x) => x.id === ctr.id)!;
    const cv = (storedC.versionHistory || [])[0]?.versionNumber;
    if (cv) {
      const cr = await send(env, key, 'POST', `/api/v1/erp/contracts/${ctr.id}/restore-version`, { targetVersion: cv });
      assert.equal(cr.status, 200, JSON.stringify(cr.body));
    }
    // CISO 26/11: o conector nunca ativa; renovar so contrato ja ATIVO (ativado pela tela).
    assert.equal(body(await send(env, key, 'POST', `/api/v1/erp/contracts/${ctr.id}/renew`, { months: 12 })).code, 'CONTRACT_RENEW_WOULD_ACTIVATE');
    erp.rentalContracts.find((x) => x.id === ctr.id)!.status = 'ATIVO' as never;
    const rn = await send(env, key, 'POST', `/api/v1/erp/contracts/${ctr.id}/renew`, { months: 12 });
    assert.equal(rn.status, 200, JSON.stringify(rn.body));
    for (const k of erp.rentalContracts.filter((x) => x.id === ctr.id) as any[]) {
      assert.notEqual(k.generateNextInvoiceOnSave, true);
      assert.equal(k.autoSendEmailOnBilling, false);
      assert.notEqual(k.dunningRuleEnabled, true);
    }

    // OS
    const os = await send(env, key, 'POST', '/api/v1/erp/service-orders', { companyId: env.ids.coAna, description: 'Instalacao' });
    assert.equal(os.status, 201, JSON.stringify(os.body));
    const osId = body(os).data.id;
    assert.equal(body(os).data.status, 'Em aberto');
    assert.equal((await send(env, key, 'PATCH', `/api/v1/erp/service-orders/${osId}`, { totalAmount: 150, expectedVersion: body(os).data.version })).status, 200);
    const st = await send(env, key, 'POST', `/api/v1/erp/service-orders/${osId}/status`, { status: 'Em andamento', note: 'iniciado' });
    assert.equal(st.status, 200, JSON.stringify(st.body));
    assert.equal(body(st).data.status, 'Em andamento');
    const dup = await send(env, key, 'POST', `/api/v1/erp/service-orders/${osId}/duplicate`, { entryDate: '01/12/2026', measurementPeriodStart: '01/12/2026', measurementPeriodEnd: '31/12/2026' });
    assert.equal(dup.status, 201, JSON.stringify(dup.body));
    assert.notEqual(body(dup).data.id, osId);
    const ticket = addTicket(env);
    const ft = await send(env, key, 'POST', '/api/v1/erp/service-orders/from-ticket', { ticketId: ticket.id });
    assert.equal(ft.status, 201, JSON.stringify(ft.body));
    assert.equal(body(ft).data.ticketId, ticket.id);
    const ftOs = (erp.serviceOrders || []).find((s) => s.id === body(ft).data.id)!;
    assert.ok(!String(ftOs.description).includes('TEXTO-DO-CLIENTE'));

    // Pedidos, fornecedores, catalogo, listas, financeiro
    const so = await send(env, key, 'POST', '/api/v1/erp/sales-orders', { companyId: env.ids.coAna, totalAmount: 99, itemsSummary: '1x cabo' });
    assert.equal(so.status, 201, JSON.stringify(so.body));
    assert.equal((await send(env, key, 'PATCH', `/api/v1/erp/sales-orders/${body(so).data.id}`, { status: 'Em andamento' , expectedVersion: soV(env, body(so).data.id) })).status, 200);
    const po = await send(env, key, 'POST', '/api/v1/erp/purchase-orders', { supplierId: 'sup-1', totalAmount: 500, itemsSummary: '10x cabo' });
    assert.equal(po.status, 201, JSON.stringify(po.body));
    assert.equal(body(po).data.supplierName, 'Fornecedor Um');
    assert.equal((await send(env, key, 'PATCH', `/api/v1/erp/purchase-orders/${body(po).data.id}`, { status: 'Em andamento' })).status, 200);
    const sup = await send(env, key, 'POST', '/api/v1/erp/suppliers', { name: 'Fornecedor Dois', supplierType: 'TRANSPORTADORA' });
    assert.equal(sup.status, 201, JSON.stringify(sup.body));
    assert.equal((await send(env, key, 'PATCH', `/api/v1/erp/suppliers/${body(sup).data.id}`, { cityState: 'SP/SP' })).status, 200);
    const cat = await send(env, key, 'POST', '/api/v1/erp/catalog', { name: 'Cabo CAT6', code: 'CAB-6', monthlyRentalPrice: 5, costPrice: 2 });
    assert.equal(cat.status, 201, JSON.stringify(cat.body));
    assert.equal(body(cat).data.stockAvailable, 0);
    assert.equal(body(cat).data.costPrice, 2);
    assert.equal((await send(env, key, 'PATCH', `/api/v1/erp/catalog/${body(cat).data.id}`, { brand: 'Furukawa' })).status, 200);
    assert.equal((await send(env, key, 'POST', '/api/v1/erp/catalog', { name: 'Outro', code: 'cab-6' })).status, 409);
    const aux = await send(env, key, 'POST', '/api/v1/erp/aux-lists', { kind: 'costCenters', label: 'CC API' });
    assert.equal(aux.status, 201, JSON.stringify(aux.body));
    assert.equal((await send(env, key, 'PATCH', `/api/v1/erp/aux-lists/${body(aux).data.id}`, { label: 'CC API 2' })).status, 200);
    const fin = await send(env, key, 'POST', '/api/v1/erp/financial-entries', { type: 'PAGAR', description: 'Compra cabos', amount: 500, dueDate: '2026-12-10' });
    assert.equal(fin.status, 201, JSON.stringify(fin.body));
    assert.equal(body(fin).data.status, 'ABERTO');
    assert.equal(body(fin).data.paidAt, null);
    assert.equal((await send(env, key, 'PATCH', `/api/v1/erp/financial-entries/${body(fin).data.id}`, { amount: 550 })).status, 200);

    // CRM: tarefas e rascunhos
    const t = await send(env, key, 'POST', '/api/v1/crm/tasks', { title: 'Follow-up API', contactId: env.ids.cAna, assignedUserId: ANA.uid });
    assert.equal(t.status, 201, JSON.stringify(t.body));
    assert.equal(body(t).data.assignedTo, 'Ana Vendas');
    assert.equal((await send(env, key, 'PATCH', `/api/v1/crm/tasks/${body(t).data.id}`, { priority: 'HIGH' })).status, 200);
    const done = await send(env, key, 'POST', `/api/v1/crm/tasks/${body(t).data.id}/complete`, {});
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(body(done).data.status, 'COMPLETED');
    const seq = await send(env, key, 'POST', '/api/v1/automation/sequences/drafts', { name: 'Cadencia API', steps: [{ dayOffset: 0, stepType: 'MANUAL_EMAIL', subject: 'Oi' }] });
    assert.equal(seq.status, 201, JSON.stringify(seq.body));
    assert.equal(body(seq).data.isActive, false);
    const wf = await send(env, key, 'POST', '/api/v1/automation/workflows', { name: 'WF API', triggerType: 'CONTACT_CREATED', steps: [{ type: 'ACTION', actionType: 'CREATE_TASK' }] });
    assert.equal(wf.status, 201, JSON.stringify(wf.body));
    assert.equal(body(wf).data.isActive, false);
    const wfu = await send(env, key, 'PATCH', `/api/v1/automation/workflows/${body(wf).data.id}`, { name: 'WF API 2' });
    assert.equal(wfu.status, 200, JSON.stringify(wfu.body));
    assert.equal(body(wfu).data.isActive, false);
    const cmp = await send(env, key, 'POST', '/api/v1/marketing/campaigns', { name: 'Campanha API' });
    assert.equal(cmp.status, 201, JSON.stringify(cmp.body));
    assert.equal(body(cmp).data.status, 'PAUSED');
    assert.equal(body(cmp).data.sentCount, 0);
    assert.equal(body(cmp).data.attributedRevenueBrl, 0);
    assert.equal(body(cmp).data.ownerName, 'Admin API');

    // Invariantes globais: nada faturado/emitido/ativado/inscrito/pago.
    assert.equal(erp.invoices.length, invoicesBefore);
    assert.equal(env.repo.listSequenceEnrollments().length, enrollBefore);
    assert.equal(env.repo.listSequences().find((s) => s.id === body(seq).data.id)!.isActive, false);
    assert.equal(env.repo.listWorkflows().find((w) => w.id === body(wf).data.id)!.isActive, false);
    assert.equal(env.repo.listWorkflowExecutions().filter((e: any) => e.workflowId === body(wf).data.id).length, 0);
    assert.ok(erp.financialEntries.every((f) => f.id !== body(fin).data.id || (f.status !== 'PAGO' && !f.paidAt)));
    assert.ok(erp.rentalContracts.every((k: any) => k.generateNextInvoiceOnSave !== true || !String(k.id).includes('-api-')));
  });
});

// ---------------------------------------------------------------------------
describe('Lote 2: negacoes fail-closed', () => {
  it('escopo, modulo, alcada EDICAO, TODOS, carteira, desconto, campo desconhecido e valor mascarado', async () => {
    const env = makeEnv();
    const admin = await adminKey(env);
    // Sem o escopo :write => 403
    const readOnly = await keyFor(env, ADMIN.uid, 'TODOS', [...LOTE1_SCOPES], ALL_MODULES as never);
    assert.equal((await send(env, readOnly, 'POST', '/api/v1/erp/proposals', { title: 'x', companyName: 'X', items: [{ description: 'a', quantity: 1, unitPrice: 1 }] })).status, 403);
    // Escopo acima da alcada do dono na criacao da chave (Ana: contratos VIEW, estoque/OS VIEW, sem financeiro)
    for (const s of ['erp:contracts:write', 'erp:orders:write', 'erp:financial:write', 'crm:automation:write']) {
      const k = await createKey(env, { name: 'x', scopes: [s], portfolioScope: 'PROPRIOS', moduleAccess: ALL_MODULES, ownerUserId: ANA.uid });
      assert.equal(k.res.status, 422, s);
      assert.equal(body(k.res).code, 'SCOPE_EXCEEDS_OWNER_ACCESS', s);
    }
    // Modulo ERP desligado na chave => 403
    const k1 = await createKey(env, { name: 'x', scopes: ['erp:catalog:write'], portfolioScope: 'TODOS', moduleAccess: { crm: true, chamados: false, erp: false }, ownerUserId: ADMIN.uid });
    assert.equal(k1.res.status, 422);
    // Modulo ERP retirado do dono depois da emissao => 403 MODULE_FORBIDDEN
    const fin0 = await keyFor(env, FIN.uid, 'TODOS', ['erp:catalog:write'], ALL_MODULES as never);
    userRec(env, FIN.uid).moduleAccess = { crm: true, erp: false, chamados: true } as never;
    const r0 = await send(env, fin0, 'POST', '/api/v1/erp/catalog', { name: 'x' });
    assert.equal(r0.status, 403);
    assert.equal(body(r0).code, 'MODULE_FORBIDDEN');
    userRec(env, FIN.uid).moduleAccess = { crm: true, erp: true, chamados: true } as never;
    // Alcada rebaixada depois da emissao da chave => 403 (teto vivo do dono)
    const fin = await keyFor(env, FIN.uid, 'TODOS', ['erp:catalog:write', 'erp:financial:write'], ALL_MODULES as never);
    const finRec = userRec(env, FIN.uid);
    finRec.erpPermissions = { ...(finRec.erpPermissions as object), stockOsSalesAccess: 'VIEW' } as never;
    assert.equal((await send(env, fin, 'POST', '/api/v1/erp/catalog', { name: 'x' })).status, 403);
    // Carteira PROPRIOS => entidades sem dono (catalogo/financeiro/fornecedor) exigem TODOS
    const adminProprios = await keyFor(env, ADMIN.uid, 'PROPRIOS', ['erp:catalog:write', 'erp:financial:write', 'erp:records:write'], ALL_MODULES as never);
    assert.equal((await send(env, adminProprios, 'POST', '/api/v1/erp/catalog', { name: 'x' })).status, 403);
    assert.equal((await send(env, adminProprios, 'POST', '/api/v1/erp/financial-entries', { type: 'PAGAR', description: 'x', amount: 1, dueDate: '2026-12-01' })).status, 403);
    assert.equal((await send(env, adminProprios, 'POST', '/api/v1/erp/suppliers', { name: 'x' })).status, 403);
    // Ana (PROPRIOS): so os proprios orcamentos; vendedor imutavel; desconto acima do teto (0%)
    const ana = await keyFor(env, ANA.uid, 'PROPRIOS', ['erp:proposals:write', 'erp:proposals:read', 'crm:tasks:write'], ALL_MODULES as never);
    assert.equal((await send(env, ana, 'PATCH', '/api/v1/erp/proposals/prop-carla', { title: 'invadir' })).status, 404);
    const ownOk = await send(env, ana, 'PATCH', '/api/v1/erp/proposals/prop-ana', { title: 'Minha proposta' });
    assert.equal(ownOk.status, 200, JSON.stringify(ownOk.body));
    const items = [{ description: 'a', quantity: 1, unitPrice: 10 }];
    const other = await send(env, ana, 'POST', '/api/v1/erp/proposals', { title: 'x', companyId: env.ids.coAna, items, sellerUserId: CARLA.uid });
    assert.equal(body(other).code, 'OWNER_IMMUTABLE');
    const disc = await send(env, ana, 'POST', '/api/v1/erp/proposals', { title: 'x', companyId: env.ids.coAna, items: [{ ...items[0], discountPercent: 5 }] });
    assert.equal(disc.status, 403);
    assert.equal(body(disc).code, 'DISCOUNT_ABOVE_LIMIT');
    assert.equal((await send(env, ana, 'POST', '/api/v1/erp/proposals', { title: 'x', companyId: env.ids.coCarla, items })).status, 404);
    assert.equal((await send(env, ana, 'POST', '/api/v1/crm/tasks', { title: 'x', assignedUserId: CARLA.uid })).status, 403);
    assert.equal((await send(env, ana, 'PATCH', `/api/v1/crm/tasks/${env.ids.tCarla}`, { title: 'x' })).status, 404);
    // Situacoes que aprovam/convertem e campos que faturam/enviam/pagam => 400 (Zod strict)
    for (const [path, payload] of [
      ['/api/v1/erp/proposals', { title: 'x', companyName: 'X', items, status: 'APROVADA' }],
      ['/api/v1/erp/proposals', { title: 'x', companyName: 'X', items, publicLinkToken: 'abc' }],
      ['/api/v1/erp/contracts', { title: 'x', companyName: 'X', equipments: [{ description: 'a', quantity: 1, unitMonthlyRent: 1 }], generateNextInvoiceOnSave: true }],
      ['/api/v1/erp/contracts', { title: 'x', companyName: 'X', equipments: [{ description: 'a', quantity: 1, unitMonthlyRent: 1 }], autoSendEmailOnBilling: true }],
      ['/api/v1/erp/contracts', { title: 'x', companyName: 'X', equipments: [{ description: 'a', quantity: 1, unitMonthlyRent: 1 }], status: 'FATURAMENTO' }],
      ['/api/v1/erp/financial-entries', { type: 'PAGAR', description: 'x', amount: 1, dueDate: '2026-12-01', status: 'PAGO' }],
      ['/api/v1/erp/financial-entries', { type: 'PAGAR', description: 'x', amount: 1, dueDate: '2026-12-01', paidAt: '2026-12-01' }],
      ['/api/v1/erp/purchase-orders', { supplierName: 'X', totalAmount: 1, nfeAccessKey: '123' }],
      ['/api/v1/automation/workflows', { name: 'x', triggerType: 'CONTACT_CREATED', isActive: true }],
      ['/api/v1/automation/workflows', { name: 'x', triggerType: 'CONTACT_CREATED', steps: [{ type: 'ACTION', actionType: 'SEND_EMAIL' }] }],
      ['/api/v1/automation/sequences/drafts', { name: 'x', isActive: true }],
      ['/api/v1/marketing/campaigns', { name: 'x', status: 'ACTIVE' }],
    ] as Array<[string, unknown]>) {
      const r = await send(env, admin, 'POST', path, payload);
      assert.equal(r.status, 400, `${path} ${JSON.stringify(payload)} => ${r.status}`);
    }
    // Valor mascarado => 422
    const masked = await send(env, admin, 'PATCH', '/api/v1/erp/suppliers/sup-1', { phone: '****4321' });
    assert.equal(masked.status, 422);
    assert.equal(body(masked).code, 'MASKED_VALUE_REJECTED');
    // PATCH vazio => 422; inexistente => 404 (sem upsert)
    assert.equal((await send(env, admin, 'PATCH', '/api/v1/erp/contracts/ctr-ana', {})).status, 422);
    assert.equal((await send(env, admin, 'PATCH', '/api/v1/erp/contracts/nao-existe', { dueDay: 5 })).status, 404);
    assert.equal((await send(env, admin, 'PATCH', '/api/v1/erp/proposals/nao-existe', { title: 'x' })).status, 404);
    assert.ok(!env.repo.getErpState().rentalContracts.some((c) => c.id === 'nao-existe'));
    assert.ok(!env.repo.getErpState().proposals.some((c) => c.id === 'nao-existe'));
    // Travas de estado: aprovado, pago, XML, workflow ativo
    const erp = env.repo.getErpState();
    (erp.proposals.find((x) => x.id === 'prop-carla') as any).status = 'APROVADA';
    assert.equal(body(await send(env, admin, 'PATCH', '/api/v1/erp/proposals/prop-carla', { title: 'x' })).code, 'PROPOSAL_LOCKED');
    (erp.financialEntries.find((x) => x.id === 'fin-1') as any).status = 'PAGO';
    assert.equal((await send(env, admin, 'PATCH', '/api/v1/erp/financial-entries/fin-1', { amount: 1 })).status, 409);
    assert.equal((await send(env, admin, 'PATCH', '/api/v1/erp/purchase-orders/po-1', { status: 'x' })).status, 409);
    const active = env.repo.createWorkflow({ name: 'Ativo', triggerType: 'CONTACT_CREATED' as never });
    assert.equal(active.isActive, true);
    assert.equal((await send(env, admin, 'PATCH', `/api/v1/automation/workflows/${active.id}`, { name: 'x' })).status, 409);
    // Ticket fora da carteira => 404
    const anaOs = await keyFor(env, ADMIN.uid, 'PROPRIOS', ['erp:orders:write', 'tickets:read'], ALL_MODULES as never);
    const t = addTicket(env);
    assert.equal((await send(env, anaOs, 'POST', '/api/v1/erp/service-orders/from-ticket', { ticketId: t.id })).status, 404);
  });

  it('camada de dados: allowlist de rotas e corpo seguro (fatura/e-mail/ativacao/pagamento) mesmo se um handler errar', async () => {
    const env = makeEnv();
    const port = new RouterDataPort(env.router);
    const invoicesBefore = env.repo.getErpState().invoices.length;
    await assert.rejects(() => port.write('POST', '/api/erp/invoices', {}));
    await assert.rejects(() => port.write('POST', '/api/erp/financial/fin-1/pay', {}));
    await assert.rejects(() => port.write('POST', '/api/erp/rental-contracts/ctr-ana/generate-invoice', {}));
    await assert.rejects(() => port.write('PATCH', '/api/erp/rental-contracts/ctr-ana', { generateNextInvoiceOnSave: true }));
    await assert.rejects(() => port.write('POST', '/api/erp/rental-contracts', { autoSendEmailOnBilling: true }));
    await assert.rejects(() => port.write('POST', '/api/workflows', { name: 'x', triggerType: 'CONTACT_CREATED' }));
    await assert.rejects(() => port.write('POST', '/api/workflows', { action: 'TRIGGER', triggerType: 'CONTACT_CREATED', entityId: 'c1', isActive: false }));
    await assert.rejects(() => port.write('POST', '/api/sequences', { action: 'ENROLL', isActive: false }));
    await assert.rejects(() => port.write('POST', '/api/marketing/campaigns', { name: 'x' }));
    await assert.rejects(() => port.write('PATCH', '/api/erp/financial/fin-1', { status: 'PAGO' }));
    await assert.rejects(() => port.write('PATCH', '/api/erp/proposals/prop-ana', { status: 'APROVADA' }));
    assert.equal(env.repo.getErpState().invoices.length, invoicesBefore);
  });
});

// ---------------------------------------------------------------------------
describe('Lote 2: Idempotency-Key, auditoria antes/depois e MCP', () => {
  it('sem chave => 428; replay devolve o mesmo registro; mesma chave com outro corpo => 409', async () => {
    const env = makeEnv();
    const key = await adminKey(env);
    const payload = { name: 'Item idem', code: 'IDEM-1' };
    const none = await send(env, key, 'POST', '/api/v1/erp/catalog', payload, null);
    assert.equal(none.status, 428);
    assert.equal(body(none).code, 'IDEMPOTENCY_KEY_REQUIRED');
    assert.equal(lastAudit(env, 'erp.catalog.create')?.statusCode, 428);
    const k = nextIdem();
    const a = await send(env, key, 'POST', '/api/v1/erp/catalog', payload, k);
    assert.equal(a.status, 201, JSON.stringify(a.body));
    const b = await send(env, key, 'POST', '/api/v1/erp/catalog', payload, k);
    assert.equal(b.status, 201);
    assert.equal(b.headers['Idempotent-Replayed'], 'true');
    assert.equal(body(b).data.id, body(a).data.id);
    assert.equal(env.repo.getErpState().catalog.filter((c) => c.gestaoClickCode === 'IDEM-1').length, 1);
    const c = await send(env, key, 'POST', '/api/v1/erp/catalog', { ...payload, name: 'Outro' }, k);
    assert.equal(c.status, 409);
    // Renovar tambem exige chave (cada chamada soma meses)
    assert.equal((await send(env, key, 'POST', '/api/v1/erp/contracts/ctr-ana/renew', { months: 1 }, null)).status, 428);
  });

  it('auditoria registra entidade, operacao, campos alterados e antes/depois sem dados sensiveis', async () => {
    const env = makeEnv();
    const key = await adminKey(env);
    const r = await send(env, key, 'PATCH', '/api/v1/erp/suppliers/sup-1', { cityState: 'Campinas/SP', email: 'novo@forn.com' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const a = lastAudit(env, 'erp.suppliers.update');
    assert.ok(a?.details, JSON.stringify(a));
    const d = a!.details as any;
    assert.equal(d.entity, 'erp.supplier');
    assert.equal(d.entityId, 'sup-1');
    assert.equal(d.op, 'update');
    assert.deepEqual([...d.changedFields].sort(), ['cityState', 'email']);
    assert.equal(d.after.cityState, 'Campinas/SP');
    assert.equal(d.after.email, '[omitido]');
    assert.ok(!JSON.stringify(d).includes('novo@forn.com'));
  });

  it('MCP: tools/list lista as escritas; tools/call de criacao exige _meta idempotencyKey', async () => {
    const env = makeEnv();
    const key = await adminKey(env);
    const tools = await handleMcp(rpc(key, { jsonrpc: '2.0', id: 1, method: 'tools/list' }), env.deps);
    const names = (body(tools).result.tools as Array<{ name: string }>).map((t) => t.name);
    for (const n of ['erp_proposals_create', 'erp_contract_renew', 'erp_service_order_from_ticket', 'crm_tasks_complete', 'crm_workflows_create_draft', 'crm_marketing_campaigns_create_draft']) {
      assert.ok(names.includes(n), n);
    }
    const args = { title: 'Via MCP', assignedUserId: ADMIN.uid };
    const noKey = await handleMcp(rpc(key, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'crm_tasks_create', arguments: args } }), env.deps);
    assert.equal(body(noKey).result.isError, true);
    assert.match(JSON.stringify(body(noKey).result), /IDEMPOTENCY_KEY_REQUIRED/);
    const ok = await handleMcp(rpc(key, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'crm_tasks_create', arguments: args, _meta: { 'stihub/idempotencyKey': nextIdem() } } }), env.deps);
    assert.equal(body(ok).result.isError, false, JSON.stringify(body(ok)));
    assert.equal(body(ok).result.structuredContent.data.title, 'Via MCP');
    const upd = await handleMcp(rpc(key, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'erp_service_order_status_change', arguments: { id: 'os-carla', status: 'Concluída' } } }), env.deps);
    assert.equal(body(upd).result.isError, false, JSON.stringify(body(upd)));
  });
});

// ---------------------------------------------------------------------------
describe('Lote 2: consentimento OAuth mostra escritas em vermelho e omite as acima do perfil', () => {
  function pkcePair() {
    const verifier = randomBytes(32).toString('base64url');
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
  }
  it('Bruno: erp:proposals:write marcada como ESCRITA; contratos/financeiro (sem alcada) nao concedidos', async () => {
    const env = makeEnv();
    const redirect = 'https://client.example/callback';
    const reg = await handleOAuth(req('POST', '/api/oauth/register', { body: { client_name: 'Agente', redirect_uris: [redirect] } }), env.deps);
    assert.equal(reg.status, 201);
    const clientId = body(reg).client_id as string;
    for (const s of W) assert.ok(String(body(reg).scope).split(' ').includes(s), s);
    const { verifier, challenge } = pkcePair();
    const scope = 'erp:proposals:read erp:proposals:write erp:contracts:write erp:financial:write';
    const q = { response_type: 'code', client_id: clientId, redirect_uri: redirect, scope, state: 's1', code_challenge: challenge, code_challenge_method: 'S256' };
    const sess = session(BRUNO);
    const page = await handleOAuth(req('GET', '/api/oauth/authorize', { query: q, session: sess }), env.deps);
    assert.equal(page.status, 200, JSON.stringify(page).slice(0, 400));
    const html = page.text || '';
    assert.match(html, /<li class="write">&#9888; ESCRITA: <code>erp:proposals:write<\/code>/);
    assert.match(html, /\.write\{color:#b91c1c/);
    assert.match(html, /Escritas no ERP somente reversiveis/);
    assert.match(html, /Nao concedidos \(acima do seu perfil\): .*erp:contracts:write/);
    assert.match(html, /Nao concedidos \(acima do seu perfil\): .*erp:financial:write/);
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
    const post = await handleOAuth(req('POST', '/api/oauth/authorize', { session: sess, body: { ...q, csrf, decision: 'approve', portfolio_scope: 'PROPRIOS' } }), env.deps);
    assert.equal(post.status, 302);
    const code = new URL(post.redirect!).searchParams.get('code')!;
    const tok = await handleOAuth(req('POST', '/api/oauth/token', { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: { grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: redirect, code_verifier: verifier } }), env.deps);
    assert.equal(tok.status, 200, JSON.stringify(tok.body));
    assert.deepEqual(String(body(tok).scope).split(' ').sort(), ['erp:proposals:read', 'erp:proposals:write']);
  });
});

// ---------------------------------------------------------------------------
// Correcoes do CISO (25/11/2026) — testes de regressao, um por item
// ---------------------------------------------------------------------------
function grantErp(env: Env, uid: string, patch: Record<string, unknown>) {
  const r = userRec(env, uid);
  r.erpPermissions = { ...(r.erpPermissions as object), ...patch } as never;
}
const OS_EDIT = { stockOsSalesAccess: 'EDIT' };
const FULL_CONTROL = {
  financeBanksAccess: 'FULL', fiscalIssuanceAccess: 'FULL', proposalsQuotesAccess: 'FULL', stockOsSalesAccess: 'FULL', rentalContractsAccess: 'FULL',
  canIssueFiscalDocuments: true, canApproveProposals: true, canDeleteErpRecords: true,
};

describe('Lote 2 / CISO: correcoes de regressao', () => {
  it('1. situacao de pedido de venda/compra: lista fechada, normalizada; faturado/pago/aprovado bloqueados', async () => {
    const env = makeEnv();
    const key = await adminKey(env);
    for (const status of ['Faturado', 'FATURADO', 'faturádo', 'Pago', 'Aprovado', 'aprovada', 'Concretizada']) {
      const r = await send(env, key, 'POST', '/api/v1/erp/sales-orders', { companyName: 'Cli', totalAmount: 10, itemsSummary: 'x', status });
      assert.equal(r.status, 403, `${status}: ${JSON.stringify(r.body)}`);
      assert.equal(body(r).code, 'ORDER_STATUS_FORBIDDEN');
      const p = await send(env, key, 'POST', '/api/v1/erp/purchase-orders', { supplierName: 'F', totalAmount: 10, status });
      assert.equal(p.status, 403, status);
    }
    assert.equal(body(await send(env, key, 'POST', '/api/v1/erp/sales-orders', { companyName: 'Cli', totalAmount: 10, itemsSummary: 'x', status: 'Qualquer' })).code, 'ORDER_STATUS_INVALID');
    const ok = await send(env, key, 'POST', '/api/v1/erp/sales-orders', { companyName: 'Cli', totalAmount: 10, itemsSummary: 'x', status: 'EM ANDAMENTO' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(body(ok).data.status, 'Em andamento', 'canonicalizado');
    const id = body(ok).data.id;
    const fat = await send(env, key, 'PATCH', `/api/v1/erp/sales-orders/${id}`, { status: 'Faturado' , expectedVersion: soV(env, id) });
    assert.equal(fat.status, 403);
    assert.equal(env.repo.getErpState().salesOrders!.find((x: any) => x.id === id)!.status, 'Em andamento');
    // pedido ja faturado (tela/sync) nao e editado
    (env.repo.getErpState().salesOrders as any[]).push({ id: 'so-fat', code: 'PV-9', companyName: 'C', sellerName: 'Admin API', date: '2026-11-01', status: 'Faturado', totalAmount: 1, itemsSummary: 'z' });
    assert.equal(body(await send(env, key, 'PATCH', '/api/v1/erp/sales-orders/so-fat', { status: 'Em aberto' , expectedVersion: soV(env, 'so-fat') })).code, 'ORDER_LOCKED');
    const po = await send(env, key, 'POST', '/api/v1/erp/purchase-orders', { supplierName: 'F', totalAmount: 10, status: 'em aberto' });
    assert.equal(po.status, 201);
    assert.equal(body(await send(env, key, 'PATCH', `/api/v1/erp/purchase-orders/${body(po).data.id}`, { status: 'Pago' })).code, 'ORDER_STATUS_FORBIDDEN');
  });

  it('2. posse por ID na escrita: homonimo nao edita; sem ID de dono so TODOS/controle total', async () => {
    const env = makeEnv();
    // homonimo: Carla renomeada para "Ana Vendas" (mesmo nome da Ana)
    userRec(env, CARLA.uid).name = 'Ana Vendas';
    for (const u of [ANA.uid, CARLA.uid]) grantErp(env, u, { ...OS_EDIT, rentalContractsAccess: 'EDIT' });
    const ana = await keyFor(env, ANA.uid, 'PROPRIOS', ['erp:orders:write', 'erp:orders:read', 'erp:contracts:write', 'erp:proposals:write']);
    const carla = await keyFor(env, CARLA.uid, 'PROPRIOS', ['erp:orders:write', 'erp:orders:read', 'erp:contracts:write', 'erp:proposals:write']);
    const os = await send(env, ana, 'POST', '/api/v1/erp/service-orders', { companyName: 'Cli', description: 'x' });
    assert.equal(os.status, 201, JSON.stringify(os.body));
    const osd = body(os).data;
    // Carla (mesmo nome) ve pela tela/nome, mas nao escreve: ID do dono e da Ana => 404 neutro
    assert.equal((await send(env, carla, 'POST', `/api/v1/erp/service-orders/${osd.id}/status`, { status: 'Em andamento' })).status, 404);
    assert.equal((await send(env, carla, 'PATCH', `/api/v1/erp/service-orders/${osd.id}`, { description: 'y', expectedVersion: osd.version })).status, 404);
    assert.equal((await send(env, ana, 'POST', `/api/v1/erp/service-orders/${osd.id}/status`, { status: 'Em andamento' })).status, 200);
    const so = await send(env, ana, 'POST', '/api/v1/erp/sales-orders', { companyName: 'Cli', totalAmount: 5, itemsSummary: 'x' });
    assert.equal(so.status, 201);
    assert.equal((await send(env, carla, 'PATCH', `/api/v1/erp/sales-orders/${body(so).data.id}`, { itemsSummary: 'roubo' , expectedVersion: soV(env, body(so).data.id) })).status, 404);
    assert.equal((await send(env, ana, 'PATCH', `/api/v1/erp/sales-orders/${body(so).data.id}`, { itemsSummary: 'ok' , expectedVersion: soV(env, body(so).data.id) })).status, 200);
    const ct = await send(env, ana, 'POST', '/api/v1/erp/contracts', { title: 'C', companyName: 'Cli', equipments: [{ description: 'R', quantity: 1, unitMonthlyRent: 10 }] });
    assert.equal(ct.status, 201, JSON.stringify(ct.body));
    assert.equal((await send(env, carla, 'PATCH', `/api/v1/erp/contracts/${body(ct).data.id}`, { contractNotes: 'x' })).status, 404);
    assert.equal((await send(env, ana, 'PATCH', `/api/v1/erp/contracts/${body(ct).data.id}`, { contractNotes: 'x' })).status, 200);
    // registro sem ID de dono (criado pela tela, posse so por nome): PROPRIOS => 403 fail-closed
    (env.repo.getErpState().salesOrders as any[]).find((x) => x.id === 'so-ana').status = 'Em aberto';
    const noId = await send(env, ana, 'PATCH', '/api/v1/erp/sales-orders/so-ana', { itemsSummary: 'x' , expectedVersion: soV(env, 'so-ana') });
    assert.equal(noId.status, 403);
    assert.equal(body(noId).code, 'OWNER_ID_REQUIRED');
    assert.equal(body(await send(env, ana, 'PATCH', '/api/v1/erp/contracts/ctr-ana', { contractNotes: 'x' })).code, 'OWNER_ID_REQUIRED');
    const osTec = await send(env, ana, 'POST', '/api/v1/erp/service-orders/os-ana/status', { status: 'Em andamento' });
    assert.equal(body(osTec).code, 'OWNER_ID_REQUIRED', 'tecnico por nome nao da posse de escrita');
    // ... controle total do ERP (mesmo PROPRIOS) libera registro sem ID de dono
    grantErp(env, ANA.uid, FULL_CONTROL);
    assert.equal((await send(env, ana, 'PATCH', '/api/v1/erp/sales-orders/so-ana', { itemsSummary: 'x' , expectedVersion: soV(env, 'so-ana') })).status, 200);
    // proposta: posse pelo sellerUserId (ID), nunca pelo nome
    (env.repo.getErpState().proposals as any[]).find((p) => p.id === 'prop-carla').sellerName = 'Ana Vendas';
    assert.equal((await send(env, ana, 'PATCH', '/api/v1/erp/proposals/prop-carla', { title: 'x' })).status, 404);
    // tarefa (CRM): responsavel so por nome => sem ID => 403; criada pelo conector => posse por ID
    const crmAna = await keyFor(env, ANA.uid, 'PROPRIOS', ['crm:tasks:write', 'crm:tasks:read']);
    assert.equal(body(await send(env, crmAna, 'PATCH', `/api/v1/crm/tasks/${env.ids.tAna}`, { title: 'x' })).code, 'OWNER_ID_REQUIRED');
    const tk = await send(env, crmAna, 'POST', '/api/v1/crm/tasks', { title: 'Nova' });
    assert.equal(tk.status, 201, JSON.stringify(tk.body));
    assert.equal((await send(env, crmAna, 'PATCH', `/api/v1/crm/tasks/${body(tk).data.id}`, { title: 'Nova 2' })).status, 200);
    const crmCarla = await keyFor(env, CARLA.uid, 'PROPRIOS', ['crm:tasks:write', 'crm:tasks:read']);
    assert.equal((await send(env, crmCarla, 'PATCH', `/api/v1/crm/tasks/${body(tk).data.id}`, { title: 'homonimo' })).status, 404);
  });

  it('3. OS a partir de chamado: vendedor = ator da integracao, na carteira dele; OS existente so se na carteira', async () => {
    const env = makeEnv();
    grantErp(env, ANA.uid, OS_EDIT);
    const ana = await keyFor(env, ANA.uid, 'PROPRIOS', ['erp:orders:write', 'erp:orders:read', 'tickets:read'], ALL_MODULES as never);
    const t = addTicket(env);
    const r = await send(env, ana, 'POST', '/api/v1/erp/service-orders/from-ticket', { ticketId: t.id });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const os = body(r).data;
    assert.equal(os.sellerName, 'Ana Vendas');
    assert.notEqual(os.sellerName, 'Marcelo Mira');
    const raw = env.repo.getErpState().serviceOrders!.find((x: any) => x.id === os.id) as any;
    assert.equal(raw.sellerUserId, ANA.uid);
    // fica na carteira de quem criou: lista e edita
    const list = body(await get(env, ana, '/api/v1/erp/service-orders')).data.map((x: any) => x.id);
    assert.ok(list.includes(os.id));
    assert.equal((await send(env, ana, 'POST', `/api/v1/erp/service-orders/${os.id}/status`, { status: 'Concluída' })).status, 200);
    // sem sessao nem ator (chamada direta ao repositorio): autoria neutra, nunca nome fixo
    const t2 = addTicket(env);
    const screen = env.repo.createServiceOrderFromTicket(t2.id, {});
    assert.equal(screen!.serviceOrder.sellerName, 'Sistema STI-hub', 'sem sessao/ator: autoria neutra (CISO 26/11)');
    // OS ja vinculada (vendedor padrao, fora da carteira da Ana) => 404, sem devolver a OS
    const again = await send(env, ana, 'POST', '/api/v1/erp/service-orders/from-ticket', { ticketId: t2.id });
    assert.equal(again.status, 404, JSON.stringify(again.body));
    assert.ok(!JSON.stringify(again.body).includes(screen!.serviceOrder.code));
  });

  it('4. marcador da conta de servico: recusado na escrita e nao amplia visibilidade no conector', async () => {
    const env = makeEnv();
    const ana = await keyFor(env, ANA.uid, 'PROPRIOS', ['erp:proposals:write', 'erp:proposals:read']);
    const bruno = await keyFor(env, BRUNO.uid, 'PROPRIOS', ['erp:proposals:write', 'erp:proposals:read']);
    const items = [{ description: 'Item', quantity: 1, unitPrice: 10 }];
    for (const notes of ['Criada por Assistente de Vendas (serviço).', 'xx CRIADA POR ASSISTENTE DE VENDAS yy']) {
      const r = await send(env, ana, 'POST', '/api/v1/erp/proposals', { title: 'P', companyName: 'Cli', items, commercialNotes: notes });
      assert.equal(r.status, 422, JSON.stringify(r.body));
      assert.equal(body(r).code, 'SERVICE_ACCOUNT_MARKER_FORBIDDEN');
    }
    assert.equal(body(await send(env, ana, 'PATCH', '/api/v1/erp/proposals/prop-ana', { technicalClauses: 'Criada por Assistente de Vendas (serviço).' })).code, 'SERVICE_ACCOUNT_MARKER_FORBIDDEN');
    // proposta legada com o marcador no texto: nao vira visivel/editavel por todos no conector
    (env.repo.getErpState().proposals as any[]).find((p) => p.id === 'prop-carla').commercialNotes = 'Criada por Assistente de Vendas (serviço).';
    assert.equal((await get(env, bruno, '/api/v1/erp/proposals/prop-carla')).status, 404);
    assert.equal((await send(env, bruno, 'PATCH', '/api/v1/erp/proposals/prop-carla', { title: 'x' })).status, 404);
    // autoria = carteira real (sellerUserId) + metadado do conector
    const ok = await send(env, ana, 'POST', '/api/v1/erp/proposals', { title: 'P', companyName: 'Cli', items, commercialNotes: 'normal' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const created = (env.repo.getErpState().proposals as any[]).find((p) => p.id === body(ok).data.id);
    assert.equal(created.sellerUserId, ANA.uid);
    assert.notEqual(created.createdByServiceAccount, true);
    assert.equal(await env.store.getRecordOwner('erp.proposal', created.id), ANA.uid);
    assert.equal((await get(env, bruno, `/api/v1/erp/proposals/${created.id}`)).status, 404);
  });

  it('5. contrato nasce so EM_IMPLANTACAO ou PENDENTE_ASSINATURA', async () => {
    const env = makeEnv();
    const key = await adminKey(env);
    const base = { title: 'C', companyName: 'Cli', equipments: [{ description: 'R', quantity: 1, unitMonthlyRent: 10 }] };
    for (const status of ['ATIVO', 'SUSPENSO', 'RENOVACAO_PROXIMA']) {
      const r = await send(env, key, 'POST', '/api/v1/erp/contracts', { ...base, status });
      assert.equal(r.status, 400, status);
    }
    const p = await send(env, key, 'POST', '/api/v1/erp/contracts', { ...base, status: 'PENDENTE_ASSINATURA' });
    assert.equal(p.status, 201);
    assert.equal(body(p).data.status, 'PENDENTE_ASSINATURA');
    const d = await send(env, key, 'POST', '/api/v1/erp/contracts', base);
    assert.equal(body(d).data.status, 'EM_IMPLANTACAO');
    // camada de dados tambem recusa (defesa em profundidade)
    await assert.rejects(new RouterDataPort(env.router).write('POST', '/api/erp/rental-contracts', { ...base, status: 'ATIVO' }));
  });

  it('6. idempotencia: 5xx depois de escrever nao libera a chave (retry => 409, sem segundo registro)', async () => {
    const env = makeEnv();
    const key = await adminKey(env);
    const before = env.repo.getErpState().salesOrders!.length;
    // falha DEPOIS da gravacao interna (ex.: store da posse indisponivel)
    const orig = env.store.insertRecordOwner.bind(env.store);
    env.store.insertRecordOwner = async () => {
      throw new Error('falha simulada');
    };
    const idem = 'ciso-retry-5xx-0001';
    const payload = { companyName: 'Cli', totalAmount: 10, itemsSummary: 'x' };
    const first = await send(env, key, 'POST', '/api/v1/erp/sales-orders', payload, idem);
    assert.ok(first.status >= 500, String(first.status));
    env.store.insertRecordOwner = orig;
    const retry = await send(env, key, 'POST', '/api/v1/erp/sales-orders', payload, idem);
    assert.equal(retry.status, 409, JSON.stringify(retry.body));
    assert.equal(body(retry).code, 'IDEMPOTENCY_PREVIOUS_ATTEMPT_FAILED');
    assert.equal(env.repo.getErpState().salesOrders!.length, before + 1, 'um unico registro');
    // em andamento (reserva antes de executar) => 409
    const fresh = 'ciso-inflight-0001';
    const p1 = send(env, key, 'POST', '/api/v1/erp/sales-orders', payload, fresh);
    const p2 = send(env, key, 'POST', '/api/v1/erp/sales-orders', payload, fresh);
    const [a, b] = await Promise.all([p1, p2]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
    assert.equal(env.repo.getErpState().salesOrders!.length, before + 2);
    // 5xx SEM escrita => libera (retry retoma)
    const store = env.store;
    await store.putIdempotency({ actorScopeKey: 'a', idempotencyKey: 'k', method: 'POST', path: '/x', requestHash: 'h', statusCode: 0, responseBody: null, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await finishIdempotency(store, { kind: 'reserved', actor: 'a', key: 'k' }, 503, {}, { writeAttempted: false });
    assert.equal(await store.getIdempotency('a', 'k', new Date().toISOString()), null);
  });

  it('7. update de OS: controle otimista (expectedVersion obrigatoria; versao antiga => 409)', async () => {
    const env = makeEnv();
    const key = await adminKey(env);
    const os = body(await send(env, key, 'POST', '/api/v1/erp/service-orders', { companyName: 'Cli', description: 'a' })).data;
    assert.match(os.version, /^v1-[0-9a-f]{24}$/);
    assert.equal((await send(env, key, 'PATCH', `/api/v1/erp/service-orders/${os.id}`, { description: 'sem versao' })).status, 400);
    const u1 = await send(env, key, 'PATCH', `/api/v1/erp/service-orders/${os.id}`, { description: 'b', expectedVersion: os.version });
    assert.equal(u1.status, 200, JSON.stringify(u1.body));
    assert.notEqual(body(u1).data.version, os.version);
    // segundo cliente com a versao antiga => 409, sem sobrescrever
    const u2 = await send(env, key, 'PATCH', `/api/v1/erp/service-orders/${os.id}`, { description: 'c', expectedVersion: os.version });
    assert.equal(u2.status, 409);
    assert.equal(body(u2).code, 'VERSION_CONFLICT');
    assert.equal(body(u2).currentVersion, body(u1).data.version);
    assert.equal((env.repo.getErpState().serviceOrders!.find((x: any) => x.id === os.id) as any).description, 'b');
    // mudanca pela tela tambem invalida a versao
    (env.repo.getErpState().serviceOrders!.find((x: any) => x.id === os.id) as any).technicianName = 'Outro Tec';
    assert.equal((await send(env, key, 'PATCH', `/api/v1/erp/service-orders/${os.id}`, { description: 'd', expectedVersion: body(u1).data.version })).status, 409);
  });
});

describe('Lote 2 / ponto (9): editar OS e criar/editar pedido de venda atras de flag', () => {
  it('flag desligada (padrao): fora do tools/list e do OpenAPI, REST 404 e nada gravado; ligada: funciona', async () => {
    const env = makeEnv();
    const key = await adminKey(env);
    const prev = process.env[PLAN_EXPANSION_FLAG];
    delete process.env[PLAN_EXPANSION_FLAG];
    try {
      const before = env.repo.getErpState().salesOrders!.length;
      const so = await send(env, key, 'POST', '/api/v1/erp/sales-orders', { companyName: 'Cli', totalAmount: 1, itemsSummary: 'x' });
      // mesma URL da leitura => 405 (metodo inexistente); nada gravado
      const gone = [404, 405];
      assert.ok(gone.includes(so.status), String(so.status));
      assert.equal(env.repo.getErpState().salesOrders!.length, before);
      assert.ok(gone.includes((await send(env, key, 'PATCH', '/api/v1/erp/sales-orders/so-ana', { itemsSummary: 'x' , expectedVersion: soV(env, 'so-ana') })).status));
      assert.ok(gone.includes((await send(env, key, 'PATCH', '/api/v1/erp/service-orders/os-ana', { description: 'x', expectedVersion: 'v1-x' })).status));
      // leitura e as demais escritas de OS seguem ligadas
      assert.equal((await get(env, key, '/api/v1/erp/sales-orders')).status, 200);
      assert.equal((await send(env, key, 'POST', '/api/v1/erp/service-orders', { companyName: 'Cli' })).status, 201);
      const list = await handleMcp(rpc(key, { jsonrpc: '2.0', id: 1, method: 'tools/list' }), env.deps);
      const names = (body(list).result.tools as Array<{ name: string }>).map((t) => t.name);
      for (const n of ['erp_service_orders_update', 'erp_sales_orders_create', 'erp_sales_orders_update']) assert.ok(!names.includes(n), n);
      assert.ok(names.includes('erp_service_orders_create'));
      const call = await handleMcp(rpc(key, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'erp_sales_orders_create', arguments: {}, _meta: { 'stihub/idempotencyKey': 'p9-mcp-0001' } } }), env.deps);
      assert.ok(body(call).error || body(call).result?.isError);
      const doc = buildOpenApiDocument() as any;
      const ops = Object.values(doc.paths).flatMap((p: any) => Object.values(p).map((o: any) => o.operationId));
      for (const id of PLAN_EXPANSION_OPERATIONS) assert.ok(!ops.includes(id), id);
      assert.ok(ops.includes('erp.service_orders.create'));
    } finally {
      process.env[PLAN_EXPANSION_FLAG] = prev ?? '1';
    }
    const on = await send(env, key, 'POST', '/api/v1/erp/sales-orders', { companyName: 'Cli', totalAmount: 1, itemsSummary: 'x' });
    assert.equal(on.status, 201);
  });
});

// ---------------------------------------------------------------------------
// Parecer do CISO de 26/11/2026 — Lote 2: regressao de cada item
// ---------------------------------------------------------------------------
describe('Lote 2 / CISO 26/11: correcoes de regressao', () => {
  const ctrBase = { title: 'C', companyName: 'Cli', equipments: [{ description: 'R', quantity: 1, unitMonthlyRent: 10 }] };

  it('1. contrato nunca chega a ATIVO/SUSPENSO pelo conector (PATCH, renew, restore_version)', async () => {
    const env = makeEnv();
    const key = await adminKey(env);
    const erp = env.repo.getErpState();
    const c = await send(env, key, 'POST', '/api/v1/erp/contracts', { ...ctrBase, status: 'PENDENTE_ASSINATURA' });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    const id = body(c).data.id;
    const stored = () => erp.rentalContracts.find((x) => x.id === id)! as any;
    // PATCH
    for (const st of ['ATIVO', 'SUSPENSO', 'RENOVACAO_PROXIMA']) {
      const r = await send(env, key, 'PATCH', `/api/v1/erp/contracts/${id}`, { status: st });
      assert.equal(r.status, 400, st);
      assert.equal(stored().status, 'PENDENTE_ASSINATURA');
    }
    assert.equal((await send(env, key, 'PATCH', `/api/v1/erp/contracts/${id}`, { status: 'EM_IMPLANTACAO' })).status, 200);
    // renew: PENDENTE/EM_IMPLANTACAO/SUSPENSO => 409, status intacto
    for (const st of ['PENDENTE_ASSINATURA', 'EM_IMPLANTACAO', 'SUSPENSO']) {
      stored().status = st;
      const rn = await send(env, key, 'POST', `/api/v1/erp/contracts/${id}/renew`, { months: 1 });
      assert.equal(rn.status, 409, st);
      assert.equal(body(rn).code, 'CONTRACT_RENEW_WOULD_ACTIVATE');
      assert.equal(stored().status, st);
    }
    // contrato ATIVO/SUSPENSO (pela tela): o conector nao tira do lugar
    stored().status = 'SUSPENSO';
    const back = await send(env, key, 'PATCH', `/api/v1/erp/contracts/${id}`, { status: 'EM_IMPLANTACAO' });
    assert.equal(body(back).code, 'CONTRACT_STATUS_FORBIDDEN');
    assert.equal(stored().status, 'SUSPENSO');
    // restore_version: revisao com status ATIVO/SUSPENSO nao e restaurada
    stored().status = 'EM_IMPLANTACAO';
    stored().versionHistory = [
      { versionNumber: 90, savedAt: 'x', savedBy: 'x', snapshot: { ...stored(), status: 'ATIVO', versionHistory: undefined } },
      { versionNumber: 91, savedAt: 'x', savedBy: 'x', snapshot: { ...stored(), status: 'SUSPENSO', versionHistory: undefined } },
    ];
    for (const v of [90, 91]) {
      const rv = await send(env, key, 'POST', `/api/v1/erp/contracts/${id}/restore-version`, { targetVersion: v });
      assert.equal(rv.status, 403, String(v));
      assert.equal(body(rv).code, 'CONTRACT_STATUS_FORBIDDEN');
      assert.equal(stored().status, 'EM_IMPLANTACAO');
    }
    // camada de dados tambem recusa PATCH ativando
    await assert.rejects(new RouterDataPort(env.router).write('PATCH', `/api/erp/rental-contracts/${id}`, { status: 'ATIVO' }));
    assert.equal(stored().status, 'EM_IMPLANTACAO');
  });

  it('2. OS aberta a partir de chamado pela TELA grava o usuario da sessao (nunca nome fixo)', async () => {
    const env = makeEnv();
    const t = addTicket(env);
    const r = await env.router.dispatch({ method: 'POST', path: `/api/tickets/${t.id}/create-os`, query: { _fromHttpBridge: '1', _sessionToken: session(ANA) }, body: {} } as never);
    assert.ok(r.status === 201 || r.status === 200, JSON.stringify(r.body));
    const os = (r.body as any).data.serviceOrder;
    assert.equal(os.sellerName, 'Ana Vendas');
    assert.equal(os.sellerUserId, ANA.uid);
    assert.notEqual(os.sellerName, 'Marcelo Mira');
    // PATCH action CREATE_OS (outro caminho da tela) => idem
    const t2 = addTicket(env);
    const r2 = await env.router.dispatch({ method: 'PATCH', path: `/api/tickets/${t2.id}`, query: { _fromHttpBridge: '1', _sessionToken: session(BRUNO) }, body: { action: 'CREATE_OS' } } as never);
    assert.equal(r2.status, 200, JSON.stringify(r2.body));
    assert.equal((r2.body as any).serviceOrder.sellerName, 'Bruno Vendas');
    assert.equal((r2.body as any).serviceOrder.sellerUserId, BRUNO.uid);
    // sem sessao/ator => autoria neutra
    assert.equal(env.repo.createServiceOrderFromTicket(addTicket(env).id, {})!.serviceOrder.sellerName, 'Sistema STI-hub');
  });

  it('3a. OS: compare-and-swap na rota — escrita concorrente entre a leitura e a gravacao => 409, nada sobrescrito', async () => {
    const env = makeEnv();
    const key = await adminKey(env);
    const os = body(await send(env, key, 'POST', '/api/v1/erp/service-orders', { companyName: 'Cli', description: 'orig' })).data;
    // outro escritor grava DEPOIS da checagem do conector e ANTES da gravacao (janela TOCTOU antiga)
    const realPort = env.deps.createDataPort;
    env.deps.createDataPort = () => {
      const port = realPort() as RouterDataPort;
      const write = port.write.bind(port);
      port.write = async (m, p, b, o) => {
        if (p === '/api/erp/service-orders') (env.repo.getErpState().serviceOrders!.find((x: any) => x.id === os.id) as any).description = 'outro escritor';
        return write(m, p, b, o);
      };
      return port;
    };
    const r = await send(env, key, 'PATCH', `/api/v1/erp/service-orders/${os.id}`, { description: 'conector', expectedVersion: os.version });
    env.deps.createDataPort = realPort;
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(body(r).code, 'VERSION_CONFLICT');
    assert.equal((env.repo.getErpState().serviceOrders!.find((x: any) => x.id === os.id) as any).description, 'outro escritor', 'nao sobrescreveu');
    // a rota do app recusa versao velha sozinha (checa e grava no mesmo passo)
    const direct = await new RouterDataPort(env.router).write('POST', '/api/erp/service-orders', { id: os.id, code: os.code, status: os.status, companyName: 'Cli', description: 'x' }, { expectedVersion: os.version });
    assert.equal(direct.status, 409);
    assert.equal((direct.body as any).code, 'RECORD_VERSION_CONFLICT');
  });

  it('3b. CAS transacional no Postgres: SELECT ... FOR UPDATE + versao do banco; diferente => ROLLBACK, sem gravar o JSON', async () => {
    const rec = { id: 'so-1', code: 'PV-1', status: 'Em aberto', companyName: 'C', sellerName: 'A', date: '2026-11-01', totalAmount: 1, itemsSummary: 'x' };
    const v = salesOrderVersion(rec);
    assert.match(KV_RECORD_PRECONDITION_SQL, /FOR UPDATE/);
    const mk = (arr: unknown[]) => {
      const seen: string[] = [];
      const client = {
        query: async (t: string) => {
          seen.push(t.trim());
          if (/FOR UPDATE/.test(t)) return { rows: [{ arr }] };
          return { rows: [] };
        },
        release: () => undefined,
      };
      return { seen, client, pool: { query: client.query, connect: async () => client } };
    };
    await assertKvRecordPreconditions(mk([rec]).client, [{ collection: 'salesOrders', id: 'so-1', expectedVersion: v }]);
    await assert.rejects(assertKvRecordPreconditions(mk([{ ...rec, totalAmount: 2 }]).client, [{ collection: 'salesOrders', id: 'so-1', expectedVersion: v }]), KvRecordVersionConflictError);
    await assert.rejects(assertKvRecordPreconditions(mk([]).client, [{ collection: 'salesOrders', id: 'so-1', expectedVersion: v }]), KvRecordVersionConflictError);
    const changed = mk([{ ...rec, itemsSummary: 'mudou' }]);
    await assert.rejects(
      syncStateToPostgres({ erp: { proposals: [], salesOrders: [rec] } } as any, { pool: changed.pool as any, recordPreconditions: [{ collection: 'salesOrders', id: 'so-1', expectedVersion: v }] }),
      KvRecordVersionConflictError
    );
    const begin = changed.seen.indexOf('BEGIN');
    const lock = changed.seen.findIndex((t) => /FOR UPDATE/.test(t));
    assert.ok(begin >= 0 && lock > begin, 'trava dentro da transacao');
    assert.ok(changed.seen.includes('ROLLBACK') && !changed.seen.includes('COMMIT'));
    assert.ok(!changed.seen.some((t) => /INSERT INTO crm_kv_store/.test(t)), 'JSON nao gravado');
  });

  it('3c/6. pedido de venda: expectedVersion obrigatoria; versao velha => 409; CAS na rota', async () => {
    const env = makeEnv();
    const key = await adminKey(env);
    const so = body(await send(env, key, 'POST', '/api/v1/erp/sales-orders', { companyName: 'Cli', totalAmount: 5, itemsSummary: 'x' })).data;
    assert.ok(so.version.startsWith('v1-'));
    assert.equal((await send(env, key, 'PATCH', `/api/v1/erp/sales-orders/${so.id}`, { itemsSummary: 'y' })).status, 400, 'sem expectedVersion');
    const ok = await send(env, key, 'PATCH', `/api/v1/erp/sales-orders/${so.id}`, { itemsSummary: 'y', expectedVersion: so.version });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const stale = await send(env, key, 'PATCH', `/api/v1/erp/sales-orders/${so.id}`, { itemsSummary: 'z', expectedVersion: so.version });
    assert.equal(stale.status, 409);
    assert.equal(body(stale).code, 'VERSION_CONFLICT');
    assert.equal((env.repo.getErpState().salesOrders!.find((x: any) => x.id === so.id) as any).itemsSummary, 'y');
    const direct = await new RouterDataPort(env.router).write('PATCH', `/api/erp/records/salesOrders/${so.id}`, { itemsSummary: 'w' }, { expectedVersion: so.version });
    assert.equal(direct.status, 409);
  });

  it('4. gravador de dono nunca sobrescreve; troca so pela mudanca de responsavel com TODOS', async () => {
    const env = makeEnv();
    const at = new Date().toISOString();
    assert.equal(await env.store.insertRecordOwner({ entity: 'erp.contract', recordId: 'x1', ownerUserId: ANA.uid, createdAt: at }), true);
    assert.equal(await env.store.insertRecordOwner({ entity: 'erp.contract', recordId: 'x1', ownerUserId: CARLA.uid, createdAt: at }), false);
    assert.equal(await env.store.getRecordOwner('erp.contract', 'x1'), ANA.uid);
    // CAS da troca: dono atual diferente do esperado => false
    assert.equal(await env.store.transferRecordOwner('erp.contract', 'x1', CARLA.uid, BRUNO.uid, at), false);
    assert.equal(await env.store.getRecordOwner('erp.contract', 'x1'), ANA.uid);
    // SQL do Postgres: insercao so se ausente (nunca DO UPDATE)
    const sqls: string[] = [];
    const pg = new PostgresIntegrationStore({ query: async (t: string) => (sqls.push(t), { rows: [], rowCount: 0 }) });
    assert.equal(await pg.insertRecordOwner({ entity: 'e', recordId: 'r', ownerUserId: 'u', createdAt: at }), false);
    const ins = sqls.find((t) => /INSERT INTO api_record_owners/.test(t))!;
    assert.match(ins, /ON CONFLICT \(entity, record_id\) DO NOTHING/);
    assert.doesNotMatch(ins, /DO UPDATE/);
    // fluxo: TODOS troca o vendedor do contrato => dono transferido; PROPRIOS nunca reatribui tarefa
    const key = await adminKey(env);
    const c = body(await send(env, key, 'POST', '/api/v1/erp/contracts', ctrBase)).data;
    assert.equal(await env.store.getRecordOwner('erp.contract', c.id), ADMIN.uid);
    const up = await send(env, key, 'PATCH', `/api/v1/erp/contracts/${c.id}`, { sellerUserId: ANA.uid });
    assert.equal(up.status, 200, JSON.stringify(up.body));
    assert.equal(await env.store.getRecordOwner('erp.contract', c.id), ANA.uid);
    const crmAna = await keyFor(env, ANA.uid, 'PROPRIOS', ['crm:tasks:write', 'crm:tasks:read']);
    const tk = body(await send(env, crmAna, 'POST', '/api/v1/crm/tasks', { title: 'Minha' })).data;
    userRec(env, ANA.uid).scope = 'EQUIPE' as never;
    (userRec(env, ANA.uid).crmPermissions as any).portfolioScope = 'EQUIPE';
    const teamKey = await createKey(env, { name: 'k ana eq', scopes: ['crm:tasks:write', 'crm:tasks:read'], portfolioScope: 'EQUIPE', moduleAccess: { crm: true, chamados: false, erp: true }, ownerUserId: ANA.uid, teamMemberIds: [BRUNO.uid] });
    assert.equal(teamKey.res.status, 201, JSON.stringify(teamKey.res.body));
    const re = await send(env, teamKey.secret, 'PATCH', `/api/v1/crm/tasks/${tk.id}`, { assignedUserId: BRUNO.uid });
    assert.equal(re.status, 403, JSON.stringify(re.body));
    assert.equal(body(re).code, 'OWNER_TRANSFER_FORBIDDEN');
    assert.equal(await env.store.getRecordOwner('crm.task', tk.id), ANA.uid, 'dono intacto');
  });

  it('5. tabelas fora do boot; sem a migracao manual o conector falha fechado; carga de donos com homonimos no relatorio', async () => {
    assert.doesNotMatch(INTEGRATION_SCHEMA_SQL, /api_record_owners/);
    assert.doesNotMatch(fullSchemaDdl(), /api_record_owners/);
    assert.match(API_V1_MANUAL_MIGRATION_SQL, /CREATE TABLE IF NOT EXISTS api_record_owners/);
    assert.deepEqual([...API_V1_MANUAL_TABLES], ['api_record_owners']);
    const env = makeEnv();
    const key = await adminKey(env);
    env.store.manualMigrationApplied = false;
    const before = env.repo.getErpState().salesOrders!.length;
    const w = await send(env, key, 'POST', '/api/v1/erp/sales-orders', { companyName: 'Cli', totalAmount: 5, itemsSummary: 'x' });
    assert.equal(w.status, 503);
    assert.equal(body(w).code, 'MIGRATION_REQUIRED');
    assert.equal(env.repo.getErpState().salesOrders!.length, before, 'nada gravado');
    assert.equal((await get(env, key, '/api/v1/erp/sales-orders')).status, 200, 'leitura segue');
    // carga inicial: ID > e-mail > nome unico; homonimo => relatorio, sem atribuir; idempotente
    const users = [
      { id: 'u1', name: 'Ana Vendas', email: 'ana@x' },
      { id: 'u2', name: 'Joao Silva', email: 'j1@x' },
      { id: 'u3', name: 'JOÃO  silva', email: 'j2@x' },
    ];
    const input = {
      users,
      proposals: [{ id: 'p1', sellerUserId: 'u1' }, { id: 'p2', sellerEmail: 'ANA@x' }, { id: 'p3', sellerName: 'Joao Silva' }],
      contracts: [{ id: 'c1', sellerName: 'ana vendas' }, { id: 'c2', sellerName: 'Ninguem' }],
      serviceOrders: [{ id: 'o1', sellerUserId: 'orfao', sellerName: 'Ana Vendas' }],
      salesOrders: [{ id: 's1', sellerName: 'João Silva' }],
      tasks: [{ id: 't1', assignedTo: 'Ana Vendas' }],
    };
    const plan = planRecordOwnerBackfill(input, new Set());
    const got = Object.fromEntries(plan.assign.map((a) => [`${a.entity}:${a.recordId}`, `${a.ownerUserId}/${a.via}`]));
    assert.deepEqual(got, { 'erp.proposal:p1': 'u1/id', 'erp.proposal:p2': 'u1/email', 'erp.contract:c1': 'u1/name', 'erp.service_order:o1': 'u1/name', 'crm.task:t1': 'u1/name' });
    assert.deepEqual(plan.ambiguous.map((a) => `${a.entity}:${a.recordId}:${a.candidateUserIds.join('|')}`).sort(), ['erp.proposal:p3:u2|u3', 'erp.sales_order:s1:u2|u3']);
    assert.deepEqual(plan.unresolved.map((u) => u.recordId), ['c2']);
    // idempotente: quem ja tem dono e pulado; gravacao so com DO NOTHING
    const again = planRecordOwnerBackfill(input, new Set(['erp.proposal\u0000p1', 'crm.task\u0000t1']));
    assert.equal(again.alreadyOwned, 2);
    assert.equal(again.assign.length, plan.assign.length - 2);
    const sqls: string[] = [];
    const res = await applyRecordOwnerBackfill({ query: async (t: string) => (sqls.push(t), { rows: [], rowCount: 1 }) }, plan, 'now');
    assert.equal(res.inserted, plan.assign.length);
    assert.ok(sqls.every((t) => /ON CONFLICT \(entity, record_id\) DO NOTHING/.test(t)));
    assert.match(BACKFILL_INSERT_SQL, /DO NOTHING/);
  });

  it('6. ponto (9) com a flag ligada: OS Concluida/Cancelada travada; tecnico so valido e autorizado', async () => {
    const env = makeEnv();
    grantErp(env, ANA.uid, OS_EDIT);
    const ana = await keyFor(env, ANA.uid, 'PROPRIOS', ['erp:orders:write', 'erp:orders:read']);
    const os = body(await send(env, ana, 'POST', '/api/v1/erp/service-orders', { companyName: 'Cli', description: 'x' })).data;
    const raw = () => env.repo.getErpState().serviceOrders!.find((x: any) => x.id === os.id) as any;
    // texto livre nao e aceito
    assert.equal((await send(env, ana, 'PATCH', `/api/v1/erp/service-orders/${os.id}`, { technicianName: 'Qualquer', expectedVersion: os.version })).status, 400);
    const v = () => serviceOrderVersion(raw());
    // outro usuario fora da carteira (PROPRIOS) => 422
    const out = await send(env, ana, 'PATCH', `/api/v1/erp/service-orders/${os.id}`, { technicianUserId: CARLA.uid, expectedVersion: v() });
    assert.equal(body(out).code, 'TECHNICIAN_INVALID');
    // inexistente => 422
    assert.equal(body(await send(env, ana, 'PATCH', `/api/v1/erp/service-orders/${os.id}`, { technicianUserId: 'usr-nao-existe', expectedVersion: v() })).code, 'TECHNICIAN_INVALID');
    // ele mesmo, com acesso a OS => ok (nome do cadastro + ID)
    const me = await send(env, ana, 'PATCH', `/api/v1/erp/service-orders/${os.id}`, { technicianUserId: ANA.uid, expectedVersion: v() });
    assert.equal(me.status, 200, JSON.stringify(me.body));
    assert.equal(raw().technicianName, 'Ana Vendas');
    assert.equal(raw().technicianUserId, ANA.uid);
    // TODOS: usuario sem acesso a OS no ERP => nao autorizado; homonimo => ambiguo
    const key = await adminKey(env);
    (userRec(env, BRUNO.uid).erpPermissions as any).stockOsSalesAccess = 'NONE';
    assert.equal(body(await send(env, key, 'PATCH', `/api/v1/erp/service-orders/${os.id}`, { technicianUserId: BRUNO.uid, expectedVersion: v() })).code, 'TECHNICIAN_NOT_AUTHORIZED');
    userRec(env, CARLA.uid).name = 'Ana Vendas';
    assert.equal(body(await send(env, key, 'PATCH', `/api/v1/erp/service-orders/${os.id}`, { technicianUserId: ANA.uid, expectedVersion: v() })).code, 'TECHNICIAN_AMBIGUOUS');
    userRec(env, CARLA.uid).name = 'Carla Outra';
    // OS concluida/cancelada nao e editada
    for (const st of ['Concluída', 'Cancelada', 'CONCLUIDA']) {
      raw().status = st;
      const r = await send(env, ana, 'PATCH', `/api/v1/erp/service-orders/${os.id}`, { description: 'mudar', expectedVersion: v() });
      assert.equal(r.status, 409, st);
      assert.equal(body(r).code, 'SERVICE_ORDER_LOCKED');
      assert.equal(raw().description, 'x');
    }
  });
});
