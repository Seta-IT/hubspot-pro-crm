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
    for (const s of ['erp:fiscal:write', 'erp:invoices:write', 'erp:banks:write', 'crm:sequences:write', 'erp:gestaoclick:write', 'crm:contacts:delete']) {
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
    const rn = await send(env, key, 'POST', `/api/v1/erp/contracts/${ctr.id}/renew`, { months: 12 });
    assert.equal(rn.status, 200, JSON.stringify(rn.body));
    const storedC = erp.rentalContracts.find((x) => x.id === ctr.id)!;
    const cv = (storedC.versionHistory || [])[0]?.versionNumber;
    if (cv) {
      const cr = await send(env, key, 'POST', `/api/v1/erp/contracts/${ctr.id}/restore-version`, { targetVersion: cv });
      assert.equal(cr.status, 200, JSON.stringify(cr.body));
    }
    for (const k of erp.rentalContracts.filter((x) => x.id === ctr.id) as any[]) {
      assert.notEqual(k.generateNextInvoiceOnSave, true);
      assert.equal(k.autoSendEmailOnBilling, false);
      assert.notEqual(k.dunningRuleEnabled, true);
    }

    // OS
    const os = await send(env, key, 'POST', '/api/v1/erp/service-orders', { companyId: env.ids.coAna, description: 'Instalacao', technicianName: 'Tec 1' });
    assert.equal(os.status, 201, JSON.stringify(os.body));
    const osId = body(os).data.id;
    assert.equal(body(os).data.status, 'Em aberto');
    assert.equal((await send(env, key, 'PATCH', `/api/v1/erp/service-orders/${osId}`, { totalAmount: 150 })).status, 200);
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
    assert.equal((await send(env, key, 'PATCH', `/api/v1/erp/sales-orders/${body(so).data.id}`, { status: 'Concluido' })).status, 200);
    const po = await send(env, key, 'POST', '/api/v1/erp/purchase-orders', { supplierId: 'sup-1', totalAmount: 500, itemsSummary: '10x cabo' });
    assert.equal(po.status, 201, JSON.stringify(po.body));
    assert.equal(body(po).data.supplierName, 'Fornecedor Um');
    assert.equal((await send(env, key, 'PATCH', `/api/v1/erp/purchase-orders/${body(po).data.id}`, { status: 'Recebido' })).status, 200);
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
