// ============================================================================
// STI-hub — API v1 + MCP — Fase 2 / Lote 1 (24/11/2026): LEITURA do ERP e do CRM restante.
// Cobre: cada ferramenta nova (REST e MCP), negacao por permissao/modulo ausente (fail-closed),
// carteira (propostas/contratos/OS/vendas por dono; financeiro/fiscal/bancos exigem TODOS),
// mascaramento (CSC, credenciais GestaoClick, telefone de colaborador, custo do catalogo,
// PIX/boleto), consentimento OAuth com os novos escopos e a trava "ERP somente leitura".
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
import { INTEGRATION_SCOPES, LOTE1_SCOPES, isBlockedScope, validateRequestedScopes } from '../src/modules/integration/scopes';
import { ownerMeetsScope } from '../src/modules/integration/use-cases/common';
import { ErpDashboardDto, maskPhone, OS_MAX_PAGES_PER_CALL, toDashboardDto } from '../src/modules/integration/use-cases/erp';
import { maskPiiText } from '../src/modules/integration/use-cases/crm-extra';

const ORIGIN = 'https://stihub.test';
const CSC_SECRET = 'CSCSEGREDO1234567890ABCD';
const GC_TOKEN_MASK = 'gcTok-XYZ-123456';
const EMP_PHONE = '(11) 98765-4321';

const ERP_SCOPES = [...LOTE1_SCOPES].filter((s) => s.startsWith('erp:'));
const CRM_EXTRA_SCOPES = [...LOTE1_SCOPES].filter((s) => s.startsWith('crm:'));

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
describe('Lote 1: catalogo, escopos e travas (ERP somente leitura)', () => {
  it('36 ferramentas novas, todas GET/mutation=false; 14 escopos novos no catalogo e no OpenAPI (tag ERP)', () => {
    const lote1 = INTEGRATION_USE_CASES.filter((u) => LOTE1_SCOPES.has(u.requiredScope));
    assert.equal(lote1.length, 36);
    assert.equal(LOTE1_SCOPES.size, 14);
    for (const uc of lote1) {
      assert.equal(uc.method, 'GET', uc.toolName);
      assert.equal(uc.mutation, false, uc.toolName);
      assert.match(uc.toolName, /^[a-z0-9_]{1,64}$/);
    }
    assert.equal(new Set(INTEGRATION_USE_CASES.map((u) => u.toolName)).size, INTEGRATION_USE_CASES.length);
    for (const s of LOTE1_SCOPES) {
      assert.ok((INTEGRATION_SCOPES as readonly string[]).includes(s), s);
      assert.equal(isBlockedScope(s), false, s);
    }
    const doc = buildOpenApiDocument() as any;
    assert.ok(doc.tags.some((t: { name: string }) => t.name === 'ERP'));
    for (const uc of lote1.filter((u) => u.requiredModule === 'erp')) {
      const p = uc.path;
      assert.ok(doc.paths[p]?.get, p);
      // Lote 2: o mesmo path pode ganhar POST/PATCH da allowlist; nunca PUT/DELETE.
      assert.ok(Object.keys(doc.paths[p]).every((m) => ['get', 'post', 'patch'].includes(m)), p);
    }
    const oauthScopes = Object.keys(doc.components.securitySchemes.oauth2.flows.authorizationCode.scopes);
    for (const s of LOTE1_SCOPES) assert.ok(oauthScopes.includes(s), s);
  });

  it('escrita/fiscal/financeiro/GestaoClick fora da allowlist seguem bloqueados', () => {
    for (const s of ['erp:fiscal:write', 'erp:financial:pay', 'erp:invoices:write', 'erp:banks:write', 'erp:gestaoclick:read', 'erp:*', 'erp:iam:read', 'crm:sequences:write', 'fiscal:nfe:read']) {
      assert.ok(isBlockedScope(s), s);
      const v = validateRequestedScopes(`crm:contacts:read ${s}`);
      assert.equal(v.ok, false, s);
    }
    assert.equal(validateRequestedScopes(ERP_SCOPES.join(' ')).ok, true);
  });
});

// ---------------------------------------------------------------------------
describe('Lote 1: cada ferramenta responde (admin, carteira TODOS, todas as alcadas)', () => {
  it('REST: todas as 36 rotas novas => 200 com contrato; MCP tools/list e tools/call', async () => {
    const env = makeEnv();
    const key = await keyFor(env, ADMIN.uid, 'TODOS', [...LOTE1_SCOPES], { crm: true, chamados: false, erp: true });
    const wf = env.repo.createWorkflow({ name: 'WF teste', triggerType: 'CONTACT_CREATED' as never });
    const ids: Record<string, string> = {
      '/api/v1/erp/proposals/{id}': 'prop-ana',
      '/api/v1/erp/proposals/{id}/versions': 'prop-ana',
      '/api/v1/erp/proposals/{id}/acceptance': 'ORC-9002',
      '/api/v1/erp/contracts/{id}': 'ctr-ana',
      '/api/v1/erp/contracts/{id}/versions': 'CT-002',
      '/api/v1/erp/service-orders/{id}': 'os-carla',
      '/api/v1/erp/catalog/{id}': 'cat-1',
      '/api/v1/erp/invoices/{id}': 'NF-777',
      '/api/v1/tasks/{id}': env.ids.tCarla,
      '/api/v1/automation/workflows/{id}': wf.id,
    };
    const lote1 = INTEGRATION_USE_CASES.filter((u) => LOTE1_SCOPES.has(u.requiredScope));
    for (const uc of lote1) {
      const path = uc.path.replace('{id}', ids[uc.path] || 'x');
      const r = await get(env, key, path);
      assert.equal(r.status, 200, `${uc.toolName} ${path}: ${JSON.stringify(r.body).slice(0, 300)}`);
      assert.ok(body(r).data !== undefined, uc.toolName);
    }
    // Conteudo de algumas respostas (admin TODOS ve tudo).
    const props = body(await get(env, key, '/api/v1/erp/proposals', { limit: '100' })).data.map((p: { id: string }) => p.id);
    assert.ok(props.includes('prop-ana') && props.includes('prop-carla'));
    const prop = body(await get(env, key, '/api/v1/erp/proposals/ORC-9001')).data;
    assert.equal(prop.id, 'prop-ana');
    assert.equal(prop.items.length, 1);
    const versions = body(await get(env, key, '/api/v1/erp/proposals/prop-ana/versions')).data;
    assert.equal(versions.versions[0].changeSummary, 'criada');
    const dash = body(await get(env, key, '/api/v1/erp/dashboard')).data;
    assert.equal(dash.financeVisible, true);
    const banks = body(await get(env, key, '/api/v1/erp/bank-accounts')).data;
    assert.equal(banks[0].balance, 12345.67);
    const cat = body(await get(env, key, '/api/v1/erp/catalog/cat-1')).data;
    assert.equal(cat.costPrice, 321);
    const emp = body(await get(env, key, '/api/v1/erp/employees')).data;
    assert.equal(emp[0].name, 'Colaborador Um');
    // Inexistente => 404 neutro
    assert.equal((await get(env, key, '/api/v1/erp/proposals/nao-existe')).status, 404);
    assert.equal((await get(env, key, '/api/v1/erp/invoices/nao-existe')).status, 404);
    // PUT/DELETE em rota ERP => 405 (Lote 2 so libera POST/PATCH da allowlist)
    for (const m of ['PUT', 'DELETE']) {
      const w = await handleRestV1(req(m, '/api/v1/erp/proposals', { headers: bearer(key), body: { title: 'x' } }), env.deps);
      assert.equal(w.status, 405, m);
    }

    // MCP: tools/list mostra as 36 novas; tools/call de uma ferramenta ERP com auditoria.
    const tools = await handleMcp(rpc(key, { jsonrpc: '2.0', id: 1, method: 'tools/list' }), env.deps);
    const names = (body(tools).result.tools as Array<{ name: string; annotations: { readOnlyHint: boolean } }>);
    for (const uc of lote1) assert.ok(names.some((t) => t.name === uc.toolName && t.annotations.readOnlyHint === true), uc.toolName);
    const call = await handleMcp(rpc(key, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'erp_contracts_list', arguments: { limit: 100 } } }), env.deps);
    assert.equal(body(call).result.isError, false, JSON.stringify(body(call)));
    const cids = body(call).result.structuredContent.data.map((c: { id: string }) => c.id);
    assert.ok(['ctr-ana', 'ctr-carla-co', 'ctr-ana-co'].every((id) => cids.includes(id)), JSON.stringify(cids));
    assert.ok(env.store.audit.some((a) => a.channel === 'mcp' && a.action === 'tools/call:erp_contracts_list' && a.statusCode === 200 && a.scope === 'erp:contracts:read'));
    assert.ok(env.store.audit.some((a) => a.channel === 'rest_v1' && a.action === 'erp.bank_accounts.list' && a.statusCode === 200));
    assert.ok(!JSON.stringify(env.store.audit).includes(key));
  });
});

// ---------------------------------------------------------------------------
describe('Lote 1: negacao por permissao/modulo ausente (fail-closed)', () => {
  it('chave nao pode pedir escopo ERP sem moduleAccess.erp, nem acima do modulo/alcada do dono', async () => {
    const env = makeEnv();
    const noModule = await createKey(env, { name: 'x', scopes: ['erp:proposals:read'], portfolioScope: 'PROPRIOS', moduleAccess: { crm: true, chamados: false }, ownerUserId: ANA.uid });
    assert.equal(noModule.res.status, 422);
    assert.equal(body(noModule.res).code, 'SCOPE_MODULE_MISMATCH');
    userRec(env, BRUNO.uid).moduleAccess = { crm: true, erp: false, chamados: true };
    const exceeds = await createKey(env, { name: 'x', scopes: ['erp:proposals:read'], portfolioScope: 'PROPRIOS', moduleAccess: { crm: true, chamados: false, erp: true }, ownerUserId: BRUNO.uid });
    assert.equal(body(exceeds.res).code, 'MODULE_EXCEEDS_OWNER');
    for (const s of ['erp:financial:read', 'erp:fiscal:read', 'erp:banks:read']) {
      const above = await createKey(env, { name: 'x', scopes: [s], portfolioScope: 'PROPRIOS', moduleAccess: { crm: true, chamados: false, erp: true }, ownerUserId: ANA.uid });
      assert.equal(body(above.res).code, 'SCOPE_EXCEEDS_OWNER_ACCESS', s);
    }
    assert.equal(env.store.keys.size, 0);
  });

  it('alcada revogada depois da chave => 403 em toda chamada; valor desconhecido => nega', async () => {
    const env = makeEnv();
    const key = await keyFor(env, FIN.uid, 'TODOS', ['erp:financial:read', 'erp:banks:read', 'erp:fiscal:read', 'erp:proposals:read', 'erp:orders:read']);
    assert.equal((await get(env, key, '/api/v1/erp/financial-entries')).status, 200);
    const fin = userRec(env, FIN.uid);
    (fin.erpPermissions as any).financeBanksAccess = 'NONE';
    const r1 = await get(env, key, '/api/v1/erp/financial-entries');
    assert.equal(r1.status, 403);
    assert.equal(body(r1).code, 'OWNER_ACCESS_INSUFFICIENT');
    (fin.erpPermissions as any).financeBanksAccess = 'SUPERPODER';
    assert.equal((await get(env, key, '/api/v1/erp/dre')).status, 403);
    (fin.erpPermissions as any).financeBanksAccess = 'VIEW';
    assert.equal((await get(env, key, '/api/v1/erp/dre')).status, 200);
    (fin.erpPermissions as any).canViewBankBalances = false;
    assert.equal(body(await get(env, key, '/api/v1/erp/bank-accounts')).code, 'OWNER_ACCESS_INSUFFICIENT');
    (fin.erpPermissions as any).fiscalIssuanceAccess = 'NONE';
    assert.equal((await get(env, key, '/api/v1/erp/invoices')).status, 403);
    (fin.erpPermissions as any).proposalsQuotesAccess = 'NONE';
    (fin.erpPermissions as any).stockOsSalesAccess = 'ROOT';
    assert.equal((await get(env, key, '/api/v1/erp/proposals')).status, 403);
    assert.equal((await get(env, key, '/api/v1/erp/service-orders')).status, 403);
    // modulo ERP desligado no cadastro do dono => 403 MODULE_FORBIDDEN para todas
    (fin.erpPermissions as any).financeBanksAccess = 'FULL';
    fin.moduleAccess = { crm: true, erp: false, chamados: true };
    const r2 = await get(env, key, '/api/v1/erp/financial-entries');
    assert.equal(r2.status, 403);
    assert.equal(body(r2).code, 'MODULE_FORBIDDEN');
    // MCP: tools/list some com o modulo; tools/call nega
    const tools = await handleMcp(rpc(key, { jsonrpc: '2.0', id: 1, method: 'tools/list' }), env.deps);
    assert.ok(Array.isArray(body(tools).result.tools));
    const call = await handleMcp(rpc(key, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'erp_financial_entries_list', arguments: {} } }), env.deps);
    assert.ok(body(call).error || body(call).result?.isError === true);
  });

  it('escopo ausente na credencial => 403 SCOPE_INSUFFICIENT; colaboradores so administrador', async () => {
    const env = makeEnv();
    const key = await keyFor(env, FIN.uid, 'TODOS', ['erp:records:read']);
    const r = await get(env, key, '/api/v1/erp/proposals');
    assert.equal(r.status, 403);
    assert.equal(body(r).code, 'SCOPE_INSUFFICIENT');
    assert.equal((await get(env, key, '/api/v1/erp/suppliers')).status, 200);
    const emp = await get(env, key, '/api/v1/erp/employees');
    assert.equal(emp.status, 403);
    assert.equal(body(emp).code, 'SENSITIVE_DATA_FORBIDDEN');
  });

  it('ownerMeetsScope: preset do papel quando a alcada nao esta no cadastro; desconhecido nega', () => {
    const base = { crmAccess: {}, roleId: 'VENDEDOR_SALES' };
    assert.equal(ownerMeetsScope({ ...base, erpAccess: { canViewBankBalances: false } } as never, 'erp:proposals:read'), false);
    assert.equal(ownerMeetsScope({ ...base, erpAccess: { proposals: 'VIEW', canViewBankBalances: false } } as never, 'erp:proposals:read'), true);
    assert.equal(ownerMeetsScope({ ...base, erpAccess: { finance: 'FULL', canViewBankBalances: false } } as never, 'erp:banks:read'), false);
    assert.equal(ownerMeetsScope({ ...base, erpAccess: { finance: 'FULL', canViewBankBalances: true } } as never, 'erp:banks:read'), true);
    assert.equal(ownerMeetsScope({ ...base, erpAccess: { fiscal: 'ADMIN', canViewBankBalances: false } } as never, 'erp:fiscal:read'), false);
    assert.equal(ownerMeetsScope({ crmAccess: { marketing: 'NONE' }, erpAccess: { canViewBankBalances: false }, roleId: 'X' } as never, 'crm:automation:read'), false);
  });
});

// ---------------------------------------------------------------------------
describe('Lote 1: carteira (PROPRIOS so o dono; empresa inteira exige TODOS)', () => {
  it('propostas, contratos, OS, vendas e tarefas filtradas pelo dono; fora => 404', async () => {
    const env = makeEnv();
    const key = await keyFor(env, ANA.uid, 'PROPRIOS', ['erp:proposals:read', 'erp:contracts:read', 'erp:orders:read', 'crm:tasks:read'], { crm: true, chamados: false, erp: true });
    const props = body(await get(env, key, '/api/v1/erp/proposals')).data.map((p: { id: string }) => p.id);
    assert.ok(props.includes('prop-ana'));
    assert.ok(!props.includes('prop-carla'));
    assert.equal((await get(env, key, '/api/v1/erp/proposals/prop-carla')).status, 404);
    assert.equal((await get(env, key, '/api/v1/erp/proposals/ORC-9002/versions')).status, 404);
    assert.equal((await get(env, key, '/api/v1/erp/proposals/prop-carla/acceptance')).status, 404);
    assert.equal((await get(env, key, '/api/v1/erp/proposals/prop-ana')).status, 200);
    const ctrs = body(await get(env, key, '/api/v1/erp/contracts')).data.map((c: { id: string }) => c.id).sort();
    assert.deepEqual(ctrs, ['ctr-ana', 'ctr-ana-co']);
    assert.equal((await get(env, key, '/api/v1/erp/contracts/ctr-carla-co')).status, 404);
    const os = body(await get(env, key, '/api/v1/erp/service-orders')).data.map((s: { id: string }) => s.id);
    assert.deepEqual(os, ['os-ana']);
    assert.equal((await get(env, key, '/api/v1/erp/service-orders/os-carla')).status, 404);
    const so = body(await get(env, key, '/api/v1/erp/sales-orders')).data.map((s: { id: string }) => s.id);
    assert.deepEqual(so, ['so-ana']);
    const tasks = body(await get(env, key, '/api/v1/tasks')).data.map((t: { id: string }) => t.id);
    assert.ok(tasks.includes(env.ids.tAna) && !tasks.includes(env.ids.tCarla));
    assert.equal((await get(env, key, `/api/v1/tasks/${env.ids.tCarla}`)).status, 404);
  });

  it('financeiro, fiscal, bancos, compras, colaboradores, painel e saude da base exigem carteira TODOS', async () => {
    const env = makeEnv();
    const key = await keyFor(env, ADMIN.uid, 'PROPRIOS', [...LOTE1_SCOPES]);
    for (const p of ['/api/v1/erp/financial-entries', '/api/v1/erp/dre', '/api/v1/erp/bank-accounts', '/api/v1/erp/invoices', '/api/v1/erp/invoices/inv-1', '/api/v1/erp/fiscal-settings', '/api/v1/erp/purchase-orders', '/api/v1/erp/employees', '/api/v1/erp/dashboard', '/api/v1/erp/sync-status', '/api/v1/analytics/insights', '/api/v1/data-health/summary', '/api/v1/data-health/duplicates']) {
      const r = await get(env, key, p);
      assert.equal(r.status, 403, p);
      assert.equal(body(r).code, 'PORTFOLIO_ALL_REQUIRED', p);
    }
    // credencial TODOS com dono PROPRIOS => teto do dono (PROPRIOS) vence
    const ana = await createKey(env, { name: 'x', scopes: ['erp:proposals:read'], portfolioScope: 'TODOS', moduleAccess: { crm: true, chamados: false, erp: true }, ownerUserId: ANA.uid });
    assert.equal(body(ana.res).code, 'PORTFOLIO_EXCEEDS_OWNER');
  });

  it('parametro interno de carteira so vale no contexto interno (HTTP e ignorado)', async () => {
    const env = makeEnv();
    const res = await env.router.dispatch({ method: 'GET', path: '/api/erp/proposals', query: { _fromHttpBridge: '1', _sessionToken: session(ADMIN), _integrationOwnerId: ANA.uid, _integrationOwnerEmail: ANA.email } });
    assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 200));
    const ids = ((res.body as any).data as Array<{ id: string }>).map((p) => p.id);
    assert.ok(ids.includes('prop-carla'), 'sem contexto interno o filtro do conector nao se aplica');
  });
});

// ---------------------------------------------------------------------------
describe('Lote 1: dados sensiveis e mascaramento', () => {
  it('segredos fiscais, credenciais GestaoClick, PIX/boleto, notas internas e snapshots nunca saem', async () => {
    const env = makeEnv();
    const key = await keyFor(env, ADMIN.uid, 'TODOS', [...LOTE1_SCOPES]);
    const fiscal = await get(env, key, '/api/v1/erp/fiscal-settings');
    assert.equal(fiscal.status, 200);
    assert.equal(body(fiscal).data.nfce.cscConfigured, true);
    const sync = await get(env, key, '/api/v1/erp/sync-status');
    const inv = await get(env, key, '/api/v1/erp/invoices/inv-1');
    const prop = await get(env, key, '/api/v1/erp/proposals/prop-ana');
    const versions = await get(env, key, '/api/v1/erp/proposals/prop-ana/versions');
    const ctr = await get(env, key, '/api/v1/erp/contracts/ctr-ana');
    const po = await get(env, key, '/api/v1/erp/purchase-orders');
    const all = JSON.stringify([fiscal.body, sync.body, inv.body, prop.body, versions.body, ctr.body, po.body]);
    for (const secret of [CSC_SECRET, '000001', '99999999000199', '11144477735', GC_TOKEN_MASK, 'gc.internal.example', 'PIX-COPIA-NAO-VAZA', 'BOLETO-NAO-VAZA', 'NOTA-INTERNA-NAO-VAZA', 'SNAPSHOT-NAO-VAZA', 'pay.example/SEGREDO', 'CHAVE-NAO-VAZA']) {
      assert.ok(!all.includes(secret), secret);
    }
    // MCP devolve o mesmo DTO
    const call = await handleMcp(rpc(key, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'erp_fiscal_settings_get', arguments: {} } }), env.deps);
    assert.ok(!JSON.stringify(body(call)).includes(CSC_SECRET));
  });

  it('colaboradores com telefone mascarado; custo do catalogo e financeiro do painel so com alcada Financeiro', async () => {
    const env = makeEnv();
    const admin = await keyFor(env, ADMIN.uid, 'TODOS', ['erp:records:read']);
    const emp = body(await get(env, admin, '/api/v1/erp/employees')).data[0];
    assert.equal(emp.phoneMasked, '****4321');
    assert.ok(!JSON.stringify(emp).includes('98765'));
    assert.equal(maskPhone(''), '');
    // dono TODOS sem alcada Financeiro
    userRec(env, BRUNO.uid).scope = 'TODOS' as never;
    (userRec(env, BRUNO.uid).crmPermissions as any).portfolioScope = 'TODOS';
    const bruno = await keyFor(env, BRUNO.uid, 'TODOS', ['erp:catalog:read', 'erp:dashboard:read']);
    const cat = body(await get(env, bruno, '/api/v1/erp/catalog/cat-1')).data;
    assert.equal(cat.costPrice, null);
    assert.equal(cat.profitMarginPercent, null);
    assert.equal(cat.saleOrSetupPrice, 500);
    const dash = body(await get(env, bruno, '/api/v1/erp/dashboard')).data;
    assert.equal(dash.financeVisible, false);
  });
});

// ---------------------------------------------------------------------------
describe('Lote 1: consentimento OAuth lista os novos escopos e omite os acima do perfil', () => {
  function pkcePair() {
    const verifier = randomBytes(32).toString('base64url');
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
  }
  it('Bruno (sem Financeiro/Fiscal) autoriza: escopos ERP acima do perfil nao sao concedidos', async () => {
    const env = makeEnv();
    const redirect = 'https://client.example/callback';
    const reg = await handleOAuth(req('POST', '/api/oauth/register', { body: { client_name: 'Agente', redirect_uris: [redirect] } }), env.deps);
    assert.equal(reg.status, 201);
    const clientId = body(reg).client_id as string;
    for (const s of LOTE1_SCOPES) assert.ok(String(body(reg).scope).split(' ').includes(s), s);
    const { verifier, challenge } = pkcePair();
    const scope = 'crm:contacts:read erp:proposals:read erp:financial:read erp:fiscal:read crm:marketing:read';
    const q = { response_type: 'code', client_id: clientId, redirect_uri: redirect, scope, state: 's1', code_challenge: challenge, code_challenge_method: 'S256' };
    const sess = session(BRUNO);
    const page = await handleOAuth(req('GET', '/api/oauth/authorize', { query: q, session: sess }), env.deps);
    assert.equal(page.status, 200, JSON.stringify(page).slice(0, 400));
    const html = page.text || '';
    assert.match(html, /erp:proposals:read/);
    assert.match(html, /Ler orcamentos\/propostas/);
    assert.match(html, /Nao concedidos \(acima do seu perfil\): .*erp:financial:read/);
    assert.match(html, /Somente leitura no ERP/);
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
    assert.ok(csrf);
    const post = await handleOAuth(req('POST', '/api/oauth/authorize', { session: sess, body: { ...q, csrf, decision: 'approve', portfolio_scope: 'PROPRIOS' } }), env.deps);
    assert.equal(post.status, 302);
    const code = new URL(post.redirect!).searchParams.get('code')!;
    const tok = await handleOAuth(req('POST', '/api/oauth/token', { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: { grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: redirect, code_verifier: verifier } }), env.deps);
    assert.equal(tok.status, 200, JSON.stringify(tok.body));
    const granted = String(body(tok).scope).split(' ').sort();
    assert.deepEqual(granted, ['crm:contacts:read', 'crm:marketing:read', 'erp:proposals:read']);
    const access = body(tok).access_token as string;
    const tools = await handleMcp(rpc(access, { jsonrpc: '2.0', id: 1, method: 'tools/list' }), env.deps);
    const names = (body(tools).result.tools as Array<{ name: string }>).map((t) => t.name);
    assert.ok(names.includes('erp_proposals_list'));
    assert.ok(!names.includes('erp_financial_entries_list'));
    const call = await handleMcp(rpc(access, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'erp_proposals_list', arguments: {} } }), env.deps);
    assert.equal(body(call).result.isError, false, JSON.stringify(body(call)));
    assert.deepEqual(body(call).result.structuredContent.data.map((p: { id: string }) => p.id), []);
  });

  it('usuario sem modulo ERP na sessao: escopos ERP omitidos; so ERP pedido => invalid_scope', async () => {
    const env = makeEnv();
    const redirect = 'https://client.example/callback';
    const reg = await handleOAuth(req('POST', '/api/oauth/register', { body: { client_name: 'Agente', redirect_uris: [redirect] } }), env.deps);
    const clientId = body(reg).client_id as string;
    const { challenge } = pkcePair();
    const q = { response_type: 'code', client_id: clientId, redirect_uri: redirect, scope: 'erp:proposals:read', state: 's1', code_challenge: challenge, code_challenge_method: 'S256' };
    const page = await handleOAuth(req('GET', '/api/oauth/authorize', { query: q, session: session({ ...ANA, erp: false }) }), env.deps);
    assert.equal(page.status, 302);
    assert.equal(new URL(page.redirect!).searchParams.get('error'), 'invalid_scope');
  });
});

// ---------------------------------------------------------------------------
// Correcoes do CISO (25/11/2026) — testes de regressao
// ---------------------------------------------------------------------------
describe('Lote 1 / CISO: correcoes de regressao', () => {
  it('(a) erp_dashboard_get: saldo bancario so com canViewBankBalances (senao null)', async () => {
    const env = makeEnv();
    const fin = await keyFor(env, FIN.uid, 'TODOS', ['erp:dashboard:read']);
    const withBanks = body(await get(env, fin, '/api/v1/erp/dashboard')).data;
    assert.equal(withBanks.financeVisible, true);
    assert.equal(withBanks.bankBalancesVisible, true);
    assert.equal(withBanks.summary.availableBalanceToday, 12345.67);
    (userRec(env, FIN.uid).erpPermissions as any).canViewBankBalances = false;
    const r = await get(env, fin, '/api/v1/erp/dashboard');
    assert.equal(r.status, 200);
    const noBanks = body(r).data;
    assert.equal(noBanks.financeVisible, true, 'continua vendo o financeiro');
    assert.equal(noBanks.bankBalancesVisible, false);
    assert.equal(noBanks.summary.availableBalanceToday, null);
    assert.equal(noBanks.summary.bankAccountsSummaryText, null);
    assert.ok(!JSON.stringify(noBanks).includes('12345.67'));
  });

  it('(b) insights e data health: DTO fechado, sem e-mail/telefone de contato', async () => {
    const env = makeEnv();
    // duplicado do contato da Ana (mesmo e-mail) => issue com suggestedMerge no app
    env.repo.createContact({ firstName: 'Cliente', lastName: 'DaAna', email: 'cliente.ana@empresa-a.com.br', phone: '(11) 91234-5678', ownerId: 'usr-ana', ownerName: 'Ana Vendas' } as never);
    const emails = env.repo.listContacts().map((c: any) => String(c.email || '')).filter(Boolean);
    assert.ok(emails.length > 0);
    const key = await keyFor(env, ADMIN.uid, 'TODOS', ['crm:analytics:read', 'crm:data_health:read']);
    for (const p of ['/api/v1/analytics/insights', '/api/v1/data-health/summary', '/api/v1/data-health/duplicates']) {
      const r = await get(env, key, p);
      assert.equal(r.status, 200, p);
      const json = JSON.stringify(body(r));
      for (const e of emails) assert.ok(!json.includes(e), `${p} vazou ${e}`);
      assert.ok(!json.includes('91234-5678'), `${p} vazou telefone`);
      for (const f of ['contactEmail', 'emailOrDomain', 'suggestedMerge', 'suggestedMessage', 'mergedFields']) assert.ok(!json.includes(`"${f}"`), `${p}: ${f}`);
    }
    const health = body(await get(env, key, '/api/v1/data-health/summary')).data;
    assert.deepEqual(Object.keys(health).sort(), ['breakdown', 'counts', 'generatedAt', 'globalHealthScore', 'issues', 'recommendations', 'rottingDeals', 'staleRecords', 'statusLabel']);
    const ins = body(await get(env, key, '/api/v1/analytics/insights')).data;
    assert.deepEqual(Object.keys(ins).sort(), ['atRiskDeals', 'executiveSummary', 'funnelBottlenecks', 'generatedAt', 'hiddenOpportunities', 'priorityFollowUps', 'revenueForecast']);
    assert.equal(maskPiiText('fale com joao@x.com.br ou (11) 98765-4321, total R$ 1.234.567,89'), 'fale com [e-mail omitido] ou [telefone omitido], total R$ 1.234.567,89');
  });

  it('sugestao: listagem de OS com teto de paginas por chamada (422, nunca parcial) e cache por requisicao', async () => {
    const env = makeEnv();
    const ana = await keyFor(env, ANA.uid, 'PROPRIOS', ['erp:orders:read']);
    let reads = 0;
    const orig = env.deps.createDataPort;
    env.deps.createDataPort = () => {
      const port = orig();
      const read = port.read.bind(port);
      port.read = (path: string, q?: Record<string, string>) => {
        if (path === '/api/erp/service-orders') reads += 1;
        return read(path, q);
      };
      return port;
    };
    const ok = await get(env, ana, '/api/v1/erp/service-orders');
    assert.equal(ok.status, 200);
    assert.equal(reads, 1);
    const erp = env.repo.getErpState();
    for (let i = 0; i < OS_MAX_PAGES_PER_CALL * 200 + 5; i += 1) {
      (erp.serviceOrders as any[]).push({ id: `os-x-${i}`, code: `OSX-${i}`, companyName: 'C', sellerName: 'Outro', technicianName: 'Tec', entryDate: '2026-11-01', exitDate: '', status: 'ABERTA', totalAmount: 1, description: '' });
    }
    reads = 0;
    const big = await get(env, ana, '/api/v1/erp/service-orders');
    assert.equal(big.status, 422, JSON.stringify(big.body));
    assert.equal(body(big).error?.code ?? body(big).code, 'TOO_MANY_RECORDS');
    assert.equal(reads, OS_MAX_PAGES_PER_CALL);
    const filtered = await get(env, ana, '/api/v1/erp/service-orders', { search: 'OS-1' });
    assert.equal(filtered.status, 200);
  });
});

// ---------------------------------------------------------------------------
// Parecer do CISO de 26/11/2026 — regressao
// ---------------------------------------------------------------------------
describe('Lote 1 / CISO 26/11: painel em DTO fechado (allowlist)', () => {
  it('campo novo/desconhecido do app nao vaza; financeiro e saldo seguem as alcadas', async () => {
    const raw = {
      month: '2026-11', monthLabel: 'nov', today: '2026-11-26', generatedAt: 'x', financeVisible: true, segredoNovo: 'NAO-VAZA-1',
      proposals: { made: { count: 1, value: 2, bySource: { stihub: { count: 1, value: 2 }, gc: { count: 0, value: 0 } }, extra: 'NAO-VAZA-2' }, approved: { count: 0, value: 0 }, approvalRate: 0, approvalRateValue: null },
      invoiced: { count: 3, value: 30 },
      sales: { monthTotal: 5, fromProposals: 1, imported: 4, leak: 'NAO-VAZA-3' },
      counts: { receivedMonth: 1, paidMonth: 2 },
      summary: { availableBalanceToday: 999.5, bankAccountsSummaryText: 'Banco X', receivableToday: 10, salesPeriodTotal: 7, cashFlowMonthly: [{ month: 'nov', saldo: 1 }], novoCampo: 'NAO-VAZA-4' },
      monthly: [{ month: '2026-11', label: 'nov', proposalsMade: { count: 1, value: 2 }, proposalsApproved: { count: 0, value: 0 }, invoiced: null, recebimentos: 1, pagamentos: 2, saldo: -1, vendas: 5, x: 'NAO-VAZA-5' }],
    };
    const full = toDashboardDto(raw, { finance: true, banks: true });
    ErpDashboardDto.parse(full); // strict: qualquer chave fora da allowlist quebraria aqui
    assert.ok(!JSON.stringify(full).includes('NAO-VAZA'));
    assert.equal((full.summary as any).cashFlowMonthly, undefined);
    assert.equal(full.summary.availableBalanceToday, 999.5);
    const noBanks = toDashboardDto(raw, { finance: true, banks: false });
    assert.equal(noBanks.summary.availableBalanceToday, null);
    assert.equal(noBanks.summary.bankAccountsSummaryText, null);
    assert.equal(noBanks.summary.receivableToday, 10);
    const noFin = toDashboardDto(raw, { finance: false, banks: true });
    assert.equal(noFin.financeVisible, false);
    assert.equal(noFin.bankBalancesVisible, false);
    assert.equal(noFin.invoiced, null);
    assert.equal(noFin.summary.receivableToday, null);
    assert.equal(noFin.summary.availableBalanceToday, null);
    assert.equal(noFin.monthly[0].recebimentos, null);
    assert.equal(noFin.summary.salesPeriodTotal, 7);
  });

  it('REST: o painel so devolve as chaves da allowlist', async () => {
    const env = makeEnv();
    const fin = await keyFor(env, FIN.uid, 'TODOS', ['erp:dashboard:read']);
    const r = await get(env, fin, '/api/v1/erp/dashboard');
    assert.equal(r.status, 200);
    const d = body(r).data;
    assert.deepEqual(Object.keys(d).sort(), Object.keys(ErpDashboardDto.shape).sort());
    assert.deepEqual(Object.keys(d.summary).sort(), Object.keys(ErpDashboardDto.shape.summary.shape).sort());
    assert.doesNotThrow(() => ErpDashboardDto.parse(d));
  });
});
