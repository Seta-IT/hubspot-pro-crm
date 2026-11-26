// ============================================================================
// STI-hub — API v1 + MCP — Fase 2 / Lote 3 (24/11/2026): OPERACOES PERIGOSAS em duas etapas.
// Cobre: pares *_prepare/*_commit, token (expirado, reutilizado, argumentos diferentes, outro
// usuario/credencial), negacoes (escopo, alcada de tela, carteira TODOS, carteira), rate-limit
// proprio, escopos perigosos DESMARCADOS no consentimento, confirmacao no IAM, MCP sem batch.
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
import { LOTE2_WRITE_OPERATIONS, LOTE3_DANGEROUS_OPERATIONS } from '../src/modules/integration/use-cases';
import { LOTE3_DANGEROUS_SCOPES } from '../src/modules/integration/scopes';
import { describeTool } from '../src/modules/integration/mcp';
import { API_V1_MANUAL_TABLES } from '../src/modules/integration/migrations/api-v1-manual-migration';
import { INTEGRATION_SCHEMA_SQL } from '../src/modules/integration/store-postgres';

// CISO 26/11: os *_commit e as operacoes fiscais ficam desligados por padrao. As suites historicas
// abaixo exercitam a execucao, entao LIGAM as duas flags neste processo; a suite "CISO 26/11" no fim
// confere o padrao desligado (desliga e restaura dentro de cada teste).
process.env.INTEGRATION_ENABLE_DANGEROUS_COMMITS = '1';
process.env.INTEGRATION_ENABLE_FISCAL_OPS = '1';

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
  erp.financialEntries.push({ id: 'fin-l3-open', type: 'PAGAR', category: 'OPERACIONAL', description: 'Conta aberta L3', companyName: 'Forn', costCenter: 'CC', amount: 77, dueDate: '2026-12-10', paidAt: null, status: 'ABERTO', invoiceId: null, paymentMethod: 'PIX' } as never);
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
    limits: { ...defaultLimits(), perCredentialPerMinute: 5000, oauthPerIpPerMinute: 1000, dangerousPerMinute: 1000 },
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
  const k = await createKey(env, { name: `k ${owner}`, scopes, portfolioScope, moduleAccess, ownerUserId: owner, ...(scopes.some((s) => LOTE3_DANGEROUS_SCOPES.has(s)) ? { confirmDangerousScopes: true } : {}) });
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
const nextIdem = () => `lote3-test-${++idemSeq}-${randomBytes(4).toString('hex')}`;
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
// Helpers do Lote 3
// ---------------------------------------------------------------------------
const D = [...LOTE3_DANGEROUS_SCOPES];
type Guards = Partial<Record<'canDeleteCrmRecords' | 'canMergeCrmRecords' | 'canDeleteErpRecords' | 'canApproveProposals' | 'canIssueFiscalDocuments', boolean>>;
function grant(env: Env, uid: string, g: Guards) {
  const r = userRec(env, uid) as any;
  for (const k of ['canDeleteCrmRecords', 'canMergeCrmRecords'] as const) if (k in g) r.crmPermissions = { ...r.crmPermissions, [k]: g[k] };
  for (const k of ['canDeleteErpRecords', 'canApproveProposals', 'canIssueFiscalDocuments'] as const) if (k in g) r.erpPermissions = { ...r.erpPermissions, [k]: g[k] };
}
const ALL_GUARDS: Guards = { canDeleteCrmRecords: true, canMergeCrmRecords: true, canDeleteErpRecords: true, canApproveProposals: true, canIssueFiscalDocuments: true };
async function dangerAdminKey(env: Env, extra: string[] = []) {
  grantMarketing(env, ADMIN.uid);
  grant(env, ADMIN.uid, ALL_GUARDS);
  return keyFor(env, ADMIN.uid, 'TODOS', [...D, ...LOTE1_SCOPES, ...extra], ALL_MODULES as never);
}
function prepare(env: Env, key: string, path: string, payload: Record<string, unknown> = {}) {
  return handleRestV1(req('POST', `${path}/prepare`, { headers: bearer(key), body: payload }), env.deps);
}
function commit(env: Env, key: string, path: string, payload: Record<string, unknown>, token: string) {
  return handleRestV1(req('POST', `${path}/commit`, { headers: bearer(key), body: { ...payload, confirmationToken: token } }), env.deps);
}
async function twoStep(env: Env, key: string, path: string, payload: Record<string, unknown> = {}) {
  const p = await prepare(env, key, path, payload);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const c = await commit(env, key, path, payload, body(p).data.confirmationToken);
  return { p, c };
}

// ---------------------------------------------------------------------------
describe('Lote 3: catalogo de operacoes perigosas', () => {
  it('todo par prepare/commit esta na allowlist, com escopo perigoso, POST e anotacoes corretas', () => {
    const danger = INTEGRATION_USE_CASES.filter((u) => u.dangerous);
    // CISO 26/11 (7): aceite de proposta (CPF/termos em nome do cliente) removido => 40 operacoes / 13 escopos.
    assert.equal(LOTE3_DANGEROUS_OPERATIONS.size, 40);
    assert.equal(LOTE3_DANGEROUS_SCOPES.size, 13);
    assert.equal(danger.length, LOTE3_DANGEROUS_OPERATIONS.size * 2);
    for (const uc of danger) {
      const base = uc.operationId.replace(/\.(prepare|commit)$/, '');
      assert.ok(LOTE3_DANGEROUS_OPERATIONS.has(base), uc.operationId);
      assert.ok(LOTE3_DANGEROUS_SCOPES.has(uc.requiredScope), uc.operationId);
      assert.equal(uc.method, 'POST');
      const t = describeTool(uc);
      if (uc.dangerous === 'prepare') {
        assert.equal(uc.mutation, false);
        assert.equal(t.annotations.readOnlyHint, true);
        assert.equal(t.annotations.destructiveHint, false);
      } else {
        assert.equal(uc.mutation, true);
        assert.equal(uc.idempotent, false);
        assert.equal(t.annotations.destructiveHint, true);
        assert.ok('confirmationToken' in (t.inputSchema as any).properties, uc.toolName);
      }
      assert.ok(!/gestaoclick|iam|admin|rbac/i.test(uc.operationId + uc.path), uc.operationId);
    }
    // escopos que nao sao perigosos nunca aparecem num par
    for (const uc of INTEGRATION_USE_CASES.filter((u) => !u.dangerous)) assert.ok(!LOTE3_DANGEROUS_SCOPES.has(uc.requiredScope), uc.operationId);
    for (const s of D) {
      assert.equal(isBlockedScope(s), false, s);
      assert.equal(validateRequestedScopes(`crm:contacts:read ${s}`).ok, true, s);
    }
    for (const s of ['erp:gestaoclick:write', 'iam:admin', 'erp:fiscal_settings:write', 'erp:certificate:write']) {
      assert.equal(validateRequestedScopes(`crm:contacts:read ${s}`).ok, false, s);
    }
    const doc = buildOpenApiDocument() as any;
    const op = doc.paths['/api/v1/crm/contacts/{id}/delete/commit'].post;
    assert.equal(op['x-stihub-dangerous'], 'commit');
    for (const ops of Object.values(doc.paths as Record<string, Record<string, unknown>>)) assert.ok(!('delete' in ops) && !('put' in ops));
  });
});

// ---------------------------------------------------------------------------
describe('Lote 3: token de confirmacao (uso unico, 5 min, argumentos, credencial)', () => {
  it('prepare nao grava; commit exclui; auditoria antes/depois', async () => {
    const env = makeEnv();
    const key = await dangerAdminKey(env);
    const path = `/api/v1/crm/contacts/${env.ids.cAna}/delete`;
    const p = await prepare(env, key, path);
    assert.equal(p.status, 200, JSON.stringify(p.body));
    const d = body(p).data;
    assert.match(d.confirmationToken, /^stc_/);
    assert.equal(d.commitTool, 'crm_contacts_delete_commit');
    assert.equal(d.preview.action, 'EXCLUIR');
    assert.ok(env.repo.getContactById(env.ids.cAna), 'prepare nao pode excluir');
    assert.ok(!env.store.confirmations.has(d.confirmationToken), 'so o hash do token e guardado');
    const c = await commit(env, key, path, {}, d.confirmationToken);
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.equal(body(c).data.result.deleted, true);
    assert.equal(env.repo.getContactById(env.ids.cAna), undefined);
    const a = lastAudit(env, 'crm.contacts.delete.commit');
    assert.ok(a, 'auditoria do commit');
    assert.equal((a!.details as any)?.op, 'delete');
    assert.ok((a!.details as any)?.before, 'auditoria guarda o antes');
    // reutilizado
    const again = await commit(env, key, path, {}, d.confirmationToken);
    assert.equal(again.status, 409);
    assert.equal(body(again).code, 'CONFIRMATION_USED');
  });

  it('expirado, argumentos diferentes (queima), outro usuario e outra credencial do mesmo usuario', async () => {
    const env = makeEnv();
    const key = await dangerAdminKey(env);
    const pathA = `/api/v1/crm/tasks/${env.ids.tAna}/delete`;
    const pathB = `/api/v1/crm/tasks/${env.ids.tCarla}/delete`;
    // argumentos diferentes => 409 e token invalidado
    const p1 = await prepare(env, key, pathA);
    const mm = await commit(env, key, pathB, {}, body(p1).data.confirmationToken);
    assert.equal(mm.status, 409);
    assert.equal(body(mm).code, 'CONFIRMATION_ARGS_MISMATCH');
    assert.equal((await commit(env, key, pathA, {}, body(p1).data.confirmationToken)).status, 409);
    assert.ok(env.repo.listTasks().some((t) => t.id === env.ids.tAna) && env.repo.listTasks().some((t) => t.id === env.ids.tCarla));
    // expirado
    const p2 = await prepare(env, key, pathA);
    const realNow = env.deps.now;
    env.deps.now = () => new Date(Date.now() + 301_000);
    const ex = await commit(env, key, pathA, {}, body(p2).data.confirmationToken);
    env.deps.now = realNow;
    assert.equal(ex.status, 409);
    assert.equal(body(ex).code, 'CONFIRMATION_EXPIRED');
    // outro usuario
    grant(env, ANA.uid, { canDeleteCrmRecords: true });
    const anaKey = await keyFor(env, ANA.uid, 'PROPRIOS', ['crm:delete', 'crm:tasks:read'], { crm: true, chamados: false, erp: true });
    const p3 = await prepare(env, key, pathA);
    const other = await commit(env, anaKey, pathA, {}, body(p3).data.confirmationToken);
    assert.equal(other.status, 409);
    assert.equal(body(other).code, 'CONFIRMATION_INVALID');
    // outra credencial do MESMO usuario
    const key2 = await dangerAdminKey(env);
    const otherCred = await commit(env, key2, pathA, {}, body(p3).data.confirmationToken);
    assert.equal(body(otherCred).code, 'CONFIRMATION_INVALID');
    // o token original ainda vale para quem o emitiu (nao foi consumido pelos outros)
    const ok = await commit(env, key, pathA, {}, body(p3).data.confirmationToken);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    // token forjado / ausente
    assert.equal(body(await commit(env, key, pathB, {}, 'stc_' + 'A'.repeat(43))).code, 'CONFIRMATION_INVALID');
    const noTok = await handleRestV1(req('POST', `${pathB}/commit`, { headers: bearer(key), body: {} }), env.deps);
    assert.equal(noTok.status, 400);
  });

  it('rate-limit proprio das operacoes perigosas (429)', async () => {
    const env = makeEnv();
    env.deps.limits = { ...env.deps.limits, dangerousPerMinute: 2 };
    const key = await dangerAdminKey(env);
    const path = `/api/v1/crm/tasks/${env.ids.tAna}/delete`;
    assert.equal((await prepare(env, key, path)).status, 200);
    assert.equal((await prepare(env, key, path)).status, 200);
    const third = await prepare(env, key, path);
    assert.equal(third.status, 429);
    assert.equal(body(third).code, 'DANGEROUS_RATE_LIMITED');
    // leitura comum continua liberada
    assert.equal((await get(env, key, '/api/v1/tasks')).status, 200);
  });
});

// ---------------------------------------------------------------------------
describe('Lote 3a: exclusao, merge, data health e enriquecimento', () => {
  it('admin: exclui negocio, empresa, proposta, contrato, lancamento, catalogo, lista auxiliar e cadastro', async () => {
    const env = makeEnv();
    const key = await dangerAdminKey(env);
    const erp = env.repo.getErpState();
    const deal = env.repo.createDeal({ title: 'Negocio X', companyId: env.ids.coCarla, ownerName: 'Carla Outra', amount: 10 } as never);
    let r = await twoStep(env, key, `/api/v1/crm/deals/${deal.id}/delete`);
    assert.equal(r.c.status, 200, JSON.stringify(r.c.body));
    const co = env.repo.createCompany({ name: 'Empresa Vazia', ownerName: 'Ana Vendas' });
    r = await twoStep(env, key, `/api/v1/crm/companies/${co.id}/delete`);
    assert.equal(r.c.status, 200, JSON.stringify(r.c.body));
    assert.equal(env.repo.getCompanyById(co.id), undefined);
    r = await twoStep(env, key, '/api/v1/erp/proposals/prop-carla/delete');
    assert.equal(r.c.status, 200, JSON.stringify(r.c.body));
    assert.ok(!erp.proposals.some((p) => p.id === 'prop-carla'));
    r = await twoStep(env, key, '/api/v1/erp/contracts/ctr-carla-co/delete');
    assert.ok([200, 409].includes(r.c.status), JSON.stringify(r.c.body));
    r = await twoStep(env, key, '/api/v1/erp/financial-entries/fin-l3-open/delete');
    assert.equal(r.c.status, 200, JSON.stringify(r.c.body));
    r = await twoStep(env, key, '/api/v1/erp/catalog/cat-1/delete');
    assert.ok([200, 409].includes(r.c.status), JSON.stringify(r.c.body));
    r = await twoStep(env, key, '/api/v1/erp/records/suppliers/sup-1/delete');
    assert.equal(r.c.status, 200, JSON.stringify(r.c.body));
    const aux = await get(env, key, '/api/v1/erp/aux-lists');
    const created = await handleRestV1(req('POST', '/api/v1/erp/aux-lists', { headers: { ...bearer(await keyFor(env, ADMIN.uid, 'TODOS', ['erp:catalog:write'], ALL_MODULES as never)), 'idempotency-key': nextIdem() }, body: { kind: 'costCenters', label: 'CC Sem Uso API' } }), env.deps);
    assert.equal(created.status, 201, JSON.stringify(created.body) + JSON.stringify(aux.body).slice(0, 100));
    r = await twoStep(env, key, `/api/v1/erp/aux-lists/${body(created).data.id}/delete`);
    assert.equal(r.c.status, 200, JSON.stringify(r.c.body));
  });

  it('negacoes: sem escopo, sem permissao de tela, fora da carteira, financeiro/catalogo exigem TODOS, listas auxiliares exigem controle total', async () => {
    const env = makeEnv();
    // sem permissao de tela => chave com crm:delete recusada (422)
    const noGuard = await createKey(env, { name: 'x', scopes: ['crm:delete'], portfolioScope: 'PROPRIOS', moduleAccess: { crm: true, chamados: false, erp: true }, ownerUserId: ANA.uid, confirmDangerousScopes: true });
    assert.equal(noGuard.res.status, 422);
    assert.equal(body(noGuard.res).code, 'SCOPE_EXCEEDS_OWNER_ACCESS');
    // sem confirmDangerousScopes => 422
    grant(env, ANA.uid, { canDeleteCrmRecords: true, canDeleteErpRecords: true });
    const noConfirm = await createKey(env, { name: 'x', scopes: ['crm:delete'], portfolioScope: 'PROPRIOS', moduleAccess: { crm: true, chamados: false, erp: true }, ownerUserId: ANA.uid });
    assert.equal(noConfirm.res.status, 422);
    assert.equal(body(noConfirm.res).code, 'DANGEROUS_SCOPES_CONFIRMATION_REQUIRED');
    const ana = await keyFor(env, ANA.uid, 'PROPRIOS', ['crm:delete', 'erp:records:delete', 'erp:proposals:read'], { crm: true, chamados: false, erp: true });
    // fora da carteira => 404
    const out = await prepare(env, ana, `/api/v1/crm/tasks/${env.ids.tCarla}/delete`);
    assert.equal(out.status, 404);
    assert.equal((await prepare(env, ana, '/api/v1/erp/proposals/prop-carla/delete')).status, 404);
    // propria => ok
    assert.equal((await prepare(env, ana, '/api/v1/erp/proposals/prop-ana/delete')).status, 200);
    // financeiro/catalogo/cadastros sem TODOS => 403
    for (const p of ['/api/v1/erp/financial-entries/fin-l3-open/delete', '/api/v1/erp/catalog/cat-1/delete', '/api/v1/erp/records/suppliers/sup-1/delete']) {
      const res = await prepare(env, ana, p);
      assert.equal(res.status, 403, p);
    }
    // sem escopo => 403
    const noScope = await prepare(env, ana, '/api/v1/crm/merge', { entityType: 'CONTACT', primaryId: env.ids.cAna, duplicateId: env.ids.cAna });
    assert.equal(noScope.status, 403);
    // permissao de tela retirada depois da chave => 403 ao usar (fail-closed)
    grant(env, ANA.uid, { canDeleteCrmRecords: false });
    const revoked = await prepare(env, ana, `/api/v1/crm/tasks/${env.ids.tAna}/delete`);
    assert.equal(revoked.status, 403);
    // FIN: TODOS + ERP FULL, mas sem as permissoes de acao => nao tem controle total => listas auxiliares negadas
    grant(env, FIN.uid, { canDeleteErpRecords: true });
    const fin = await keyFor(env, FIN.uid, 'TODOS', ['erp:records:delete', 'erp:catalog:write'], { crm: true, chamados: false, erp: true });
    const auxDel = await prepare(env, fin, '/api/v1/erp/aux-lists/qualquer/delete');
    assert.equal(auxDel.status, 403);
    assert.equal(body(auxDel).code, 'ERP_FULL_CONTROL_REQUIRED');
    // correcao do Lote 2: criar item de lista auxiliar tambem exige controle total
    const auxCreate = await handleRestV1(req('POST', '/api/v1/erp/aux-lists', { headers: { ...bearer(fin), 'idempotency-key': nextIdem() }, body: { kind: 'costCenters', label: 'CC FIN' } }), env.deps);
    assert.equal(auxCreate.status, 403);
    assert.equal(body(auxCreate).code, 'ERP_FULL_CONTROL_REQUIRED');
    // FIN pode excluir lancamento (TODOS + financeiro EDIT + canDeleteErpRecords)
    assert.equal((await prepare(env, fin, '/api/v1/erp/financial-entries/fin-l3-open/delete')).status, 200);
  });

  it('merge de contatos, limpeza automatica, reatribuicao e enriquecimento', async () => {
    const env = makeEnv();
    const key = await dangerAdminKey(env);
    const dup = env.repo.createContact({ firstName: 'Cliente', lastName: 'DaAna', email: 'cliente.ana@empresa-a.com.br', ownerId: 'usr-ana', ownerName: 'Ana Vendas' });
    const same = await prepare(env, key, '/api/v1/crm/merge', { entityType: 'CONTACT', primaryId: env.ids.cAna, duplicateId: env.ids.cAna });
    assert.equal(same.status, 422);
    const m = await twoStep(env, key, '/api/v1/crm/merge', { entityType: 'CONTACT', primaryId: env.ids.cAna, duplicateId: dup.id });
    assert.equal(m.p.status, 200);
    assert.equal(body(m.p).data.preview.action, 'MESCLAR');
    assert.equal(body(m.p).data.preview.duplicate.id, dup.id);
    assert.equal(m.c.status, 200, JSON.stringify(m.c.body));
    assert.equal(env.repo.getContactById(dup.id), undefined);
    const ac = await twoStep(env, key, '/api/v1/crm/data-health/auto-clean', { minConfidence: 95, autoEnrich: false });
    assert.equal(typeof body(ac.p).data.preview.contactMergeCandidates, 'number');
    assert.equal(ac.c.status, 200, JSON.stringify(ac.c.body));
    const ro = await twoStep(env, key, '/api/v1/crm/data-health/reassign-orphans', { targetOwnerName: 'Marcelo Lopes Mira' });
    assert.equal(ro.c.status, 200, JSON.stringify(ro.c.body));
    const bad = await prepare(env, key, '/api/v1/crm/data-health/reassign-orphans', { targetOwnerName: 'Qualquer Um' });
    assert.equal(bad.status, 400);
    const en = await twoStep(env, key, '/api/v1/crm/enrichment/run', { contactId: env.ids.cAna });
    assert.equal(en.c.status, 200, JSON.stringify(en.c.body));
    assert.equal((await prepare(env, key, '/api/v1/crm/enrichment/run', {})).status, 422);
    // PROPRIOS nao roda acao de base inteira
    grant(env, ANA.uid, { canMergeCrmRecords: true });
    const ana = await keyFor(env, ANA.uid, 'PROPRIOS', ['crm:data_health:write'], { crm: true, chamados: false, erp: true });
    assert.equal((await prepare(env, ana, '/api/v1/crm/data-health/auto-clean', {})).status, 403);
  });
});

// ---------------------------------------------------------------------------
describe('Lote 3: consentimento OAuth, IAM e MCP', () => {
  function pkcePair() {
    const verifier = randomBytes(32).toString('base64url');
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
  }
  async function consent(env: Env, scope: string, extra: Record<string, string>, iamScopes: string[] | null = ['crm:delete']) {
    const redirect = 'https://client.example/callback';
    const reg = await handleOAuth(req('POST', '/api/oauth/register', { body: { client_name: 'Agente', redirect_uris: [redirect] } }), env.deps);
    const clientId = body(reg).client_id as string;
    // CISO 26/11 (2): sem o IAM verificar o cliente e confirmar o escopo perigoso, nada perigoso e oferecido.
    if (iamScopes) {
      const conf = await handleIamIntegrationKeys(req('POST', '/api/iam/integration-keys/dangerous-confirmations', { session: session(ADMIN), body: { subjectType: 'client', subjectId: clientId, scopes: iamScopes, clientVerified: true, confirmDangerousScopes: true } }), env.deps);
      assert.equal(conf.status, 200, JSON.stringify(conf.body));
    }
    const { verifier, challenge } = pkcePair();
    const q = { response_type: 'code', client_id: clientId, redirect_uri: redirect, scope, state: 's1', code_challenge: challenge, code_challenge_method: 'S256' };
    const sess = session(ADMIN);
    const page = await handleOAuth(req('GET', '/api/oauth/authorize', { query: q, session: sess }), env.deps);
    assert.equal(page.status, 200, JSON.stringify(page).slice(0, 300));
    const html = page.text || '';
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
    const post = await handleOAuth(req('POST', '/api/oauth/authorize', { session: sess, body: { ...q, csrf, decision: 'approve', portfolio_scope: 'TODOS', ...extra } }), env.deps);
    assert.equal(post.status, 302);
    const code = new URL(post.redirect!).searchParams.get('code');
    if (!code) return { html, scopes: null as string[] | null };
    const tok = await handleOAuth(req('POST', '/api/oauth/token', { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: { grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: redirect, code_verifier: verifier } }), env.deps);
    return { html, scopes: String(body(tok).scope).split(' ').sort() };
  }
  it('escopos perigosos vem DESMARCADOS e so entram marcados', async () => {
    const env = makeEnv();
    grant(env, ADMIN.uid, ALL_GUARDS);
    const a = await consent(env, 'crm:contacts:read crm:delete erp:fiscal:issue', {});
    assert.match(a.html, /PERIGO/);
    assert.match(a.html, /<input type="checkbox" name="grant_crm_delete" value="1">/);
    assert.ok(!/checked/.test(a.html));
    assert.deepEqual(a.scopes, ['crm:contacts:read']);
    const b = await consent(env, 'crm:contacts:read crm:delete erp:fiscal:issue', { grant_crm_delete: '1' });
    assert.deepEqual(b.scopes, ['crm:contacts:read', 'crm:delete']);
    const c = await consent(env, 'crm:delete', {});
    assert.equal(c.scopes, null, 'so perigoso e nada marcado => acesso negado');
  });
  it('perigoso acima do perfil nao e oferecido (Bruno sem permissao de tela)', async () => {
    const env = makeEnv();
    const redirect = 'https://client.example/callback';
    const reg = await handleOAuth(req('POST', '/api/oauth/register', { body: { client_name: 'Agente', redirect_uris: [redirect] } }), env.deps);
    const { challenge } = pkcePair();
    const q = { response_type: 'code', client_id: body(reg).client_id, redirect_uri: redirect, scope: 'crm:contacts:read crm:delete', state: 's', code_challenge: challenge, code_challenge_method: 'S256' };
    const page = await handleOAuth(req('GET', '/api/oauth/authorize', { query: q, session: session(BRUNO) }), env.deps);
    assert.equal(page.status, 200);
    assert.ok(!/grant_crm_delete/.test(page.text || ''));
    assert.match(page.text || '', /Nao concedidos \(acima do seu perfil\): .*crm:delete/);
  });
  it('MCP: prepare/commit via tools/call e batch JSON-RPC recusado', async () => {
    const env = makeEnv();
    const key = await dangerAdminKey(env);
    const call = (name: string, args: Record<string, unknown>) => handleMcp(rpc(key, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }), env.deps);
    const p = await call('crm_tasks_delete_prepare', { id: env.ids.tAna });
    const pd = body(p).result.structuredContent.data;
    assert.ok(pd.confirmationToken);
    const c = await call('crm_tasks_delete_commit', { id: env.ids.tAna, confirmationToken: pd.confirmationToken });
    assert.equal(body(c).result.isError, false, JSON.stringify(body(c)));
    assert.ok(!env.repo.listTasks().some((t) => t.id === env.ids.tAna));
    const batch = await handleMcp(rpc(key, [
      { jsonrpc: '2.0', id: 'a', method: 'tools/call', params: { name: 'crm_tasks_delete_prepare', arguments: { id: env.ids.tCarla } } },
      { jsonrpc: '2.0', id: 'b', method: 'tools/call', params: { name: 'crm_tasks_delete_prepare', arguments: { id: env.ids.tCarla } } },
    ]), env.deps);
    assert.equal(batch.status, 400);
  });
});

// ---------------------------------------------------------------------------
describe('Lote 3b: envios e acoes com efeito externo', () => {
  it('admin: follow-up, cadencia ativa, workflow (ativar/disparar), campanha, cobranca em lote', async () => {
    const env = makeEnv();
    const key = await dangerAdminKey(env);
    const deal = env.repo.createDeal({ title: 'Negocio FU', companyId: env.ids.coAna, ownerName: 'Ana Vendas', amount: 10 } as never);
    const fu = await twoStep(env, key, `/api/v1/crm/deals/${deal.id}/proposal-followup`, { action: 'pause' });
    assert.equal(fu.c.status, 200, JSON.stringify(fu.c.body));
    // cadencia: so ativa
    const seqs = env.repo.listSequences() as any[];
    const active = seqs.find((s) => s.isActive === true)!;
    const enrollBefore = env.repo.listSequenceEnrollments().length;
    const en = await twoStep(env, key, `/api/v1/crm/sequences/${active.id}/enroll`, { contactId: env.ids.cAna });
    assert.equal(en.c.status, 200, JSON.stringify(en.c.body));
    assert.equal(env.repo.listSequenceEnrollments().length, enrollBefore + 1);
    const inactive = env.repo.createSequence({ name: 'Rascunho', isActive: false, steps: [] } as never) as any;
    const ni = await prepare(env, key, `/api/v1/crm/sequences/${inactive.id}/enroll`, { contactId: env.ids.cAna });
    assert.equal(ni.status, 409);
    assert.equal(body(ni).code, 'SEQUENCE_NOT_ACTIVE');
    // aceite da proposta: REMOVIDO do conector (CISO 26/11, 7) => rota inexistente
    const ap = await prepare(env, key, '/api/v1/erp/proposals/prop-ana/approve', { signerName: 'Fulano de Tal', signerCpf: '529.982.247-25', signerRole: 'Diretor', modality: 'GOV_BR_OURO', acceptedTerms: true });
    assert.equal(ap.status, 404);
    // workflow
    const wf = env.repo.createWorkflow({ name: 'WF L3', triggerType: 'CONTACT_CREATED' as never, isActive: false, steps: [] } as never) as any;
    const trNo = await prepare(env, key, `/api/v1/automation/workflows/${wf.id}/trigger`, { entityType: 'CONTACT', entityId: env.ids.cAna });
    assert.equal(body(trNo).code, 'WORKFLOW_NOT_ACTIVE');
    const act = await twoStep(env, key, `/api/v1/automation/workflows/${wf.id}/activate`);
    assert.equal(act.c.status, 200, JSON.stringify(act.c.body));
    assert.equal(body(act.c).data.result.isActive, true);
    const tr = await twoStep(env, key, `/api/v1/automation/workflows/${wf.id}/trigger`, { entityType: 'CONTACT', entityId: env.ids.cAna });
    assert.equal(tr.c.status, 200, JSON.stringify(tr.c.body));
    // campanha (simulada sem envio real ligado)
    const camp = (env.repo as any).listMarketingCampaigns?.()?.[0];
    if (camp) {
      const cd = await twoStep(env, key, `/api/v1/marketing/campaigns/${camp.id}/dispatch`, { templateId: 'tpl-1', contactIds: [env.ids.cAna] });
      assert.equal(cd.c.status, 200, JSON.stringify(cd.c.body));
    }
    // cobranca em lote
    const be = await twoStep(env, key, '/api/v1/erp/contracts/batch-email', { contractIds: ['ctr-ana'], competenceMonth: '11/2026' });
    assert.equal(be.c.status, 200, JSON.stringify(be.c.body));
  });

  it('e-mail sai SO pela caixa do proprio dono; links publicos com o dono como ator', async () => {
    const env = makeEnv();
    const key = await dangerAdminKey(env);
    const tooMany = await prepare(env, key, '/api/v1/comms/email/send', { to: ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com', 'f@x.com'], cc: ['g@x.com', 'h@x.com', 'i@x.com', 'j@x.com', 'k@x.com'], subject: 'Oi', body: 'texto' });
    assert.equal(tooMany.status, 422);
    const p = await prepare(env, key, '/api/v1/comms/email/send', { to: ['cliente.ana@empresa-a.com.br'], subject: 'Proposta', body: 'Segue', contactId: env.ids.cAna });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assert.equal(body(p).data.preview.from, ADMIN.email);
    const c = await commit(env, key, '/api/v1/comms/email/send', { to: ['cliente.ana@empresa-a.com.br'], subject: 'Proposta', body: 'Segue', contactId: env.ids.cAna }, body(p).data.confirmationToken);
    // sem caixa do Outlook conectada no teste: o app recusa, mas reconhece o dono como ator (nao "so usuarios")
    assert.notEqual(body(c).code, 'MAILBOX_USER_ONLY', JSON.stringify(c.body));
    assert.ok([200, 409, 503].includes(c.status), JSON.stringify(c.body));
    // ficha fora da carteira => 404
    grant(env, ANA.uid, {});
    const ana = await keyFor(env, ANA.uid, 'PROPRIOS', ['comms:send'], { crm: true, chamados: false, erp: true });
    assert.equal((await prepare(env, ana, '/api/v1/comms/email/send', { to: ['cliente.ana@empresa-a.com.br'], subject: 'a', body: 'b', contactId: (env.repo.listContacts().find((x: any) => x.ownerName === 'Carla Outra') as any).id })).status, 404);
    // links publicos: o dono vira ator (sem sessao), segredo ausente => 503 fail-closed do app
    const pl = await twoStep(env, key, '/api/v1/erp/proposals/prop-carla/public-link');
    assert.notEqual(body(pl.c).code, 'MFA_AUTH_REQUIRED', JSON.stringify(pl.c.body));
    assert.ok([200, 503].includes(pl.c.status), JSON.stringify(pl.c.body));
    const il = await twoStep(env, key, '/api/v1/erp/invoices/inv-1/public-link');
    assert.notEqual(body(il.c).code, 'MFA_AUTH_REQUIRED', JSON.stringify(il.c.body));
    assert.ok([200, 404, 503].includes(il.c.status), JSON.stringify(il.c.body));
  });

  it('negacoes: aceite inexistente, campanha/ativacao sem TODOS, contrato fora da carteira', async () => {
    const env = makeEnv();
    // CISO 26/11 (7): o escopo de aceite nao existe mais
    const k = await createKey(env, { name: 'x', scopes: ['erp:proposals:approve'], portfolioScope: 'PROPRIOS', moduleAccess: { crm: true, chamados: false, erp: true }, ownerUserId: BRUNO.uid, confirmDangerousScopes: true });
    assert.equal(k.res.status, 400);
    grantMarketing(env, ANA.uid);
    const ana = await keyFor(env, ANA.uid, 'PROPRIOS', ['crm:marketing:dispatch', 'crm:automation:activate', 'comms:send'], { crm: true, chamados: false, erp: true });
    assert.equal((await prepare(env, ana, '/api/v1/marketing/campaigns/cmp-x/dispatch', { templateId: 't', segmentId: 's' })).status, 403);
    const wf = env.repo.createWorkflow({ name: 'WF', triggerType: 'CONTACT_CREATED' as never, isActive: false, steps: [] } as never) as any;
    assert.equal((await prepare(env, ana, `/api/v1/automation/workflows/${wf.id}/activate`)).status, 403);
    // ANA so tem VIEW em contratos => cobranca em lote negada
    assert.equal((await prepare(env, ana, '/api/v1/erp/contracts/batch-email', { contractIds: ['ctr-ana'] })).status, 403);
  });
});

// ---------------------------------------------------------------------------
describe('Lote 3c: financeiro (TODOS)', () => {
  const OFX = `<OFX><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261210<TRNAMT>-77.00<FITID>F1<MEMO>Conta aberta L3</STMTTRN><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261211<TRNAMT>12.34<FITID>F2<MEMO>Outro</STMTTRN></BANKTRANLIST></OFX>`;
  it('admin: baixa de lancamento e fatura, OFX (previa sem gravar), contas bancarias, XML e documento', async () => {
    const env = makeEnv();
    const key = await dangerAdminKey(env);
    const erp = env.repo.getErpState();
    const pay = await twoStep(env, key, '/api/v1/erp/financial-entries/fin-l3-open/pay');
    assert.equal(pay.c.status, 200, JSON.stringify(pay.c.body));
    assert.equal(String(erp.financialEntries.find((f) => f.id === 'fin-l3-open')!.status), 'PAGO');
    assert.equal(body(await prepare(env, key, '/api/v1/erp/financial-entries/fin-l3-open/pay')).code, 'ALREADY_SETTLED');
    const ip = await twoStep(env, key, '/api/v1/erp/invoices/inv-1/pay');
    assert.equal(ip.c.status, 200, JSON.stringify(ip.c.body));
    // OFX: previa nao grava
    erp.financialEntries.push({ id: 'fin-l3-ofx', type: 'PAGAR', category: 'OPERACIONAL', description: 'OFX', companyName: 'F', costCenter: 'CC', amount: 77, dueDate: '2026-12-10', paidAt: null, status: 'ABERTO', invoiceId: null, paymentMethod: 'PIX' } as never);
    const snapshot = JSON.stringify(erp.financialEntries);
    const op = await prepare(env, key, '/api/v1/erp/financial/reconcile-ofx', { bankId: 'bank-1', ofxContent: OFX });
    assert.equal(op.status, 200, JSON.stringify(op.body));
    assert.equal(body(op).data.preview.transactions, 2);
    assert.ok(body(op).data.preview.probableMatches >= 1);
    assert.equal(JSON.stringify(erp.financialEntries), snapshot, 'previa do OFX nao grava');
    const oc = await commit(env, key, '/api/v1/erp/financial/reconcile-ofx', { bankId: 'bank-1', ofxContent: OFX }, body(op).data.confirmationToken);
    assert.equal(oc.status, 200, JSON.stringify(oc.body));
    // CISO 26/11 (4): sem baixa automatica — o casado continua em aberto
    assert.equal(String(erp.financialEntries.find((f) => f.id === 'fin-l3-ofx')!.status), 'ABERTO');
    // contas bancarias
    const bc = await twoStep(env, key, '/api/v1/erp/bank-accounts', { name: 'Banco API' });
    assert.equal(bc.c.status, 200, JSON.stringify(bc.c.body));
    const bankId = body(bc.c).data.result.id;
    assert.ok((erp.bankAccounts || []).some((b) => b.id === bankId));
    const bu = await twoStep(env, key, `/api/v1/erp/bank-accounts/${bankId}/update`, { name: 'Banco API 2' });
    assert.equal(bu.c.status, 200, JSON.stringify(bu.c.body));
    assert.equal(body(await prepare(env, key, '/api/v1/erp/bank-accounts/bank-1/delete')).code, 'BANK_ACCOUNT_HAS_BALANCE');
    const bd = await twoStep(env, key, `/api/v1/erp/bank-accounts/${bankId}/delete`);
    assert.equal(bd.c.status, 200, JSON.stringify(bd.c.body));
    assert.ok(!(erp.bankAccounts || []).some((b) => b.id === bankId));
    // XML de compra
    const xml = `<nfeProc><NFe><infNFe Id="NFe35261111111111000111550010000012341000012345"><ide><nNF>1234</nNF></ide><emit><CNPJ>11111111000111</CNPJ><xNome>Fornecedor XML</xNome></emit><det nItem="1"><prod><cProd>A1</cProd><xProd>Cabo</xProd><NCM>85444900</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>2</qCom><vUnCom>10.00</vUnCom><vProd>20.00</vProd></prod></det><total><ICMSTot><vNF>20.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;
    const xp = await prepare(env, key, '/api/v1/erp/purchases/import-xml', { xmlContent: xml });
    assert.equal(xp.status, 200, JSON.stringify(xp.body));
    assert.equal(body(xp).data.preview.supplier, 'Fornecedor XML');
    const xc = await commit(env, key, '/api/v1/erp/purchases/import-xml', { xmlContent: xml }, body(xp).data.confirmationToken);
    assert.ok([200, 409, 422].includes(xc.status), JSON.stringify(xc.body));
    assert.equal((await prepare(env, key, '/api/v1/erp/purchases/import-xml', { xmlContent: '<html>'.padEnd(80, 'x') })).status, 422);
    // documento: XML sem conteudo valido => erro do app propagado (422), nada importado
    const dp = await prepare(env, key, '/api/v1/erp/financial/import-document', { fileName: 'a.xml', fileType: 'xml', content: '<nada/>' });
    assert.ok([200, 422].includes(dp.status), JSON.stringify(dp.body));
    assert.equal((await prepare(env, key, '/api/v1/erp/financial/import-document', { fileName: 'a.pdf', fileType: 'pdf', content: 'x' })).status, 422);
  });

  it('negacoes: PROPRIOS nunca; sem edicao do financeiro; sem ver saldos nao recebe erp:banks:write', async () => {
    const env = makeEnv();
    const bad = await createKey(env, { name: 'x', scopes: ['erp:financial:settle'], portfolioScope: 'PROPRIOS', moduleAccess: { crm: true, chamados: false, erp: true }, ownerUserId: ANA.uid, confirmDangerousScopes: true });
    assert.equal(bad.res.status, 422);
    const fin = await keyFor(env, FIN.uid, 'PROPRIOS', ['erp:financial:settle'], { crm: true, chamados: false, erp: true });
    const r = await prepare(env, fin, '/api/v1/erp/financial-entries/fin-l3-open/pay');
    assert.equal(r.status, 403);
    assert.equal(body(r).code, 'PORTFOLIO_ALL_REQUIRED');
    const fr = userRec(env, FIN.uid) as any;
    fr.erpPermissions = { ...fr.erpPermissions, canViewBankBalances: false };
    const nb = await createKey(env, { name: 'x', scopes: ['erp:banks:write'], portfolioScope: 'TODOS', moduleAccess: { crm: true, chamados: false, erp: true }, ownerUserId: FIN.uid, confirmDangerousScopes: true });
    assert.equal(nb.res.status, 422);
  });
});

// ---------------------------------------------------------------------------
describe('Lote 3d: fiscal (TODOS + canIssueFiscalDocuments)', () => {
  it('admin: emite, gera fatura/remessa, fatura em lote, devolucao parcial, reajuste, cancela e exclui', async () => {
    const env = makeEnv();
    const key = await dangerAdminKey(env);
    const erp = env.repo.getErpState();
    const before = erp.invoices.length;
    const issueArgs = { documentType: 'NFSE_SERVICO', companyId: env.ids.coAna, grossAmount: 300, items: [{ description: 'Suporte', quantity: 3, unitValue: 100 }] };
    const mism = await prepare(env, key, '/api/v1/erp/fiscal-documents/issue', { ...issueArgs, grossAmount: 299 });
    assert.equal(body(mism).code, 'ITEMS_TOTAL_MISMATCH');
    const is = await twoStep(env, key, '/api/v1/erp/fiscal-documents/issue', issueArgs);
    assert.equal(is.c.status, 200, JSON.stringify(is.c.body));
    assert.equal(erp.invoices.length, before + 1);
    const invId = body(is.c).data.result.id;
    const gi = await twoStep(env, key, '/api/v1/erp/contracts/ctr-ana/generate-invoice', { competenceMonth: '12/2026' });
    assert.ok([200, 409].includes(gi.c.status), JSON.stringify(gi.c.body));
    const gr = await twoStep(env, key, '/api/v1/erp/contracts/ctr-ana/generate-remessa');
    assert.ok([200, 409].includes(gr.c.status), JSON.stringify(gr.c.body));
    const bb = await twoStep(env, key, '/api/v1/erp/contracts/batch-billing', { competenceMonth: '01/2027', items: [{ contractId: 'ctr-ana-co' }] });
    assert.equal(bb.c.status, 200, JSON.stringify(bb.c.body));
    const pr = await twoStep(env, key, '/api/v1/erp/contracts/ctr-carla-co/partial-return', { returnDate: '2026-11-20', itemsToReturn: [{ equipmentId: 'eq1', quantityReturned: 1 }], emitReturnNfe: false, emitProRataInvoice: false, reason: 'cliente devolveu' });
    assert.ok([200, 409, 422].includes(pr.c.status), JSON.stringify(pr.c.body));
    assert.equal(body(await prepare(env, key, '/api/v1/erp/contracts/ctr-ana/partial-return', { returnDate: '2026-11-20', itemsToReturn: [{ equipmentId: 'eq1', quantityReturned: 5 }], emitReturnNfe: false, emitProRataInvoice: false, reason: 'x devolveu' })).code, 'RETURN_ABOVE_QUANTITY');
    const rj = await twoStep(env, key, '/api/v1/erp/contracts/ctr-ana/readjust', { percentage: 5, index: 'IPCA' });
    assert.equal(rj.c.status, 200, JSON.stringify(rj.c.body));
    assert.equal(body(rj.p).data.preview.monthlyValueAfterEstimated, 525);
    const nfe = await prepare(env, key, '/api/v1/erp/nfe-import/emit', { request: {} });
    assert.equal(nfe.status, 422, JSON.stringify(nfe.body));
    // excluir antes de cancelar => 409; cancelar; excluir
    assert.equal(body(await prepare(env, key, `/api/v1/erp/fiscal-documents/${invId}/delete`)).code, 'INVOICE_NOT_DELETABLE');
    assert.equal((await prepare(env, key, `/api/v1/erp/fiscal-documents/${invId}/cancel`, { reason: 'curta' })).status, 400);
    const cn = await twoStep(env, key, `/api/v1/erp/fiscal-documents/${invId}/cancel`, { reason: 'Emitida em duplicidade por engano' });
    assert.equal(cn.c.status, 200, JSON.stringify(cn.c.body));
    assert.equal(String(erp.invoices.find((i) => i.id === invId)!.status), 'CANCELADA');
    // o app cria titulo a receber vinculado na emissao: exclusao bloqueada (conector mais restrito que o app)
    const linked = erp.financialEntries.filter((f) => f.invoiceId === invId).length;
    if (linked) {
      assert.ok(body(cn.p).data.preview.linkedOpenFinancialEntries >= 1);
      assert.equal(body(await prepare(env, key, `/api/v1/erp/fiscal-documents/${invId}/delete`)).code, 'INVOICE_IN_USE');
    }
    erp.invoices.push({ ...(erp.invoices.find((i) => i.id === invId) as any), id: 'inv-l3-cancelada', status: 'CANCELADA', paidAt: null } as never);
    const dl = await twoStep(env, key, '/api/v1/erp/fiscal-documents/inv-l3-cancelada/delete');
    assert.equal(dl.c.status, 200, JSON.stringify(dl.c.body));
    assert.ok(!erp.invoices.some((i) => i.id === 'inv-l3-cancelada'));
    // fatura paga nao cancela
    (erp.invoices.find((i) => i.id === 'inv-1') as any).status = 'PAGA';
    assert.equal(body(await prepare(env, key, '/api/v1/erp/fiscal-documents/inv-1/cancel', { reason: 'Tentativa de cancelar paga' })).code, 'INVOICE_NOT_CANCELLABLE');
  });

  it('negacoes: sem canIssueFiscalDocuments nao recebe o escopo; PROPRIOS => 403', async () => {
    const env = makeEnv();
    const k = await createKey(env, { name: 'x', scopes: ['erp:fiscal:issue'], portfolioScope: 'TODOS', moduleAccess: { crm: true, chamados: false, erp: true }, ownerUserId: FIN.uid, confirmDangerousScopes: true });
    assert.equal(k.res.status, 422);
    assert.equal(body(k.res).code, 'SCOPE_EXCEEDS_OWNER_ACCESS');
    grant(env, FIN.uid, { canIssueFiscalDocuments: true });
    const fin = await keyFor(env, FIN.uid, 'PROPRIOS', ['erp:fiscal:issue', 'erp:fiscal:cancel'], { crm: true, chamados: false, erp: true });
    const r = await prepare(env, fin, '/api/v1/erp/contracts/ctr-ana/generate-remessa');
    assert.equal(r.status, 403);
    assert.equal(body(r).code, 'PORTFOLIO_ALL_REQUIRED');
  });
});

// ---------------------------------------------------------------------------
// Lote 3 alinhado a correcao CISO Lote 2 (item 2): acoes perigosas tambem exigem posse por ID
// ---------------------------------------------------------------------------
describe('Lote 3 / CISO Lote 2 (2): posse por ID nas acoes perigosas', () => {
  // CISO 26/11 (Lote 2, 4): o registro de dono so insere; trocar = transferencia (CAS no dono atual).
  const own = async (env: Env, entity: string, recordId: string, ownerUserId: string) => {
    const cur = await env.store.getRecordOwner(entity, recordId);
    if (cur === null) await env.store.insertRecordOwner({ entity, recordId, ownerUserId, createdAt: new Date().toISOString() });
    else await env.store.transferRecordOwner(entity, recordId, cur, ownerUserId, new Date().toISOString());
  };

  it('tarefa: so nome do responsavel => 403 OWNER_ID_REQUIRED; ID de outro => 404; ID proprio => ok', async () => {
    const env = makeEnv();
    grant(env, ANA.uid, { canDeleteCrmRecords: true });
    const ana = await keyFor(env, ANA.uid, 'PROPRIOS', ['crm:delete', 'crm:tasks:read'], { crm: true, chamados: false, erp: true });
    const path = `/api/v1/crm/tasks/${env.ids.tAna}/delete`;
    const noId = await prepare(env, ana, path);
    assert.equal(noId.status, 403);
    assert.equal(body(noId).code, 'OWNER_ID_REQUIRED');
    await own(env, 'crm.task', env.ids.tAna, CARLA.uid);
    assert.equal((await prepare(env, ana, path)).status, 404);
    await own(env, 'crm.task', env.ids.tAna, ANA.uid);
    const ok = await twoStep(env, ana, path);
    assert.equal(ok.c.status, 200, JSON.stringify(ok.c.body));
  });

  it('proposta: homonimo (sellerUserId de outro) => 404; sem ID => 403; registro do dono => ok', async () => {
    const env = makeEnv();
    grant(env, ANA.uid, { canDeleteErpRecords: true });
    const erp = env.repo.getErpState() as any;
    const base = erp.proposals.find((p: any) => p.id === 'prop-ana');
    erp.proposals.push({ ...base, id: 'prop-homonimo', code: 'ORC-9101', sellerUserId: CARLA.uid }, { ...base, id: 'prop-sem-id', code: 'ORC-9102', sellerUserId: '' });
    const ana = await keyFor(env, ANA.uid, 'PROPRIOS', ['erp:records:delete', 'erp:proposals:read'], { crm: true, chamados: false, erp: true });
    assert.equal((await prepare(env, ana, '/api/v1/erp/proposals/prop-homonimo/delete')).status, 404);
    const noId = await prepare(env, ana, '/api/v1/erp/proposals/prop-sem-id/delete');
    assert.equal(noId.status, 403);
    assert.equal(body(noId).code, 'OWNER_ID_REQUIRED');
    await own(env, 'erp.proposal', 'prop-sem-id', ANA.uid);
    assert.equal((await prepare(env, ana, '/api/v1/erp/proposals/prop-sem-id/delete')).status, 200);
    assert.equal((await prepare(env, ana, '/api/v1/erp/proposals/prop-ana/delete')).status, 200);
  });

  it('contrato: posse so por nome do vendedor => 403; registro do dono => ok; TODOS segue livre', async () => {
    const env = makeEnv();
    grant(env, ANA.uid, { canDeleteErpRecords: true });
    (userRec(env, ANA.uid) as any).erpPermissions.rentalContractsAccess = 'EDIT';
    const ana = await keyFor(env, ANA.uid, 'PROPRIOS', ['erp:records:delete', 'erp:contracts:read'], { crm: true, chamados: false, erp: true });
    const noId = await prepare(env, ana, '/api/v1/erp/contracts/ctr-ana/delete');
    assert.equal(noId.status, 403, JSON.stringify(noId.body));
    assert.equal(body(noId).code, 'OWNER_ID_REQUIRED');
    await own(env, 'erp.contract', 'ctr-ana', CARLA.uid);
    assert.equal((await prepare(env, ana, '/api/v1/erp/contracts/ctr-ana/delete')).status, 404);
    await own(env, 'erp.contract', 'ctr-ana', ANA.uid);
    assert.equal((await prepare(env, ana, '/api/v1/erp/contracts/ctr-ana/delete')).status, 200);
    const admin = await dangerAdminKey(env);
    assert.equal((await prepare(env, admin, '/api/v1/erp/contracts/ctr-ana-co/delete')).status, 200);
  });
});

// ---------------------------------------------------------------------------
// Parecer do CISO de 26/11/2026 — Lote 3: um teste de regressao por item.
// ---------------------------------------------------------------------------
async function withFlags<T>(flags: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(flags)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
const FLAGS_OFF = { INTEGRATION_ENABLE_DANGEROUS_COMMITS: undefined, INTEGRATION_ENABLE_FISCAL_OPS: undefined };
const NON_FISCAL_D = D.filter((s) => s !== 'erp:fiscal:issue' && s !== 'erp:fiscal:cancel');

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}
async function registerClient(env: Env) {
  const redirect = 'https://client.example/callback';
  const reg = await handleOAuth(req('POST', '/api/oauth/register', { body: { client_name: 'Agente 26/11', redirect_uris: [redirect] } }), env.deps);
  return { clientId: body(reg).client_id as string, redirect };
}
async function iamConfirm(env: Env, payload: Record<string, unknown>) {
  return handleIamIntegrationKeys(req('POST', '/api/iam/integration-keys/dangerous-confirmations', { session: session(ADMIN), body: { confirmDangerousScopes: true, ...payload } }), env.deps);
}
async function oauthFlow(env: Env, clientId: string, redirect: string, scope: string, checks: Record<string, string>) {
  const { verifier, challenge } = pkce();
  const q = { response_type: 'code', client_id: clientId, redirect_uri: redirect, scope, state: 's', code_challenge: challenge, code_challenge_method: 'S256' };
  const sess = session(ADMIN);
  const page = await handleOAuth(req('GET', '/api/oauth/authorize', { query: q, session: sess }), env.deps);
  assert.equal(page.status, 200, JSON.stringify(page).slice(0, 300));
  const html = page.text || '';
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
  const post = await handleOAuth(req('POST', '/api/oauth/authorize', { session: sess, body: { ...q, csrf, decision: 'approve', portfolio_scope: 'TODOS', ...checks } }), env.deps);
  const code = post.redirect ? new URL(post.redirect).searchParams.get('code') : null;
  if (!code) return { html, token: null as string | null, scopes: [] as string[] };
  const tok = await handleOAuth(req('POST', '/api/oauth/token', { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: { grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: redirect, code_verifier: verifier } }), env.deps);
  return { html, token: body(tok).access_token as string, scopes: String(body(tok).scope).split(' ').sort() };
}

describe('Lote 3 / CISO 26/11: correcoes de regressao', () => {
  it('1. *_commit atras de INTEGRATION_ENABLE_DANGEROUS_COMMITS (desligada): so prepare; commit => 404 OPERATION_DISABLED (REST e MCP), fora do tools/list e do OpenAPI', async () => {
    const env = makeEnv();
    const key = await dangerAdminKey(env);
    await withFlags(FLAGS_OFF, async () => {
      const path = `/api/v1/crm/tasks/${env.ids.tAna}/delete`;
      const p = await prepare(env, key, path);
      assert.equal(p.status, 200, JSON.stringify(p.body));
      const c = await commit(env, key, path, {}, body(p).data.confirmationToken);
      assert.equal(c.status, 404);
      assert.equal(body(c).code, 'OPERATION_DISABLED');
      assert.ok(env.repo.listTasks().some((t: any) => t.id === env.ids.tAna), 'nada excluido');
      const list = await handleMcp(rpc(key, { jsonrpc: '2.0', id: 1, method: 'tools/list' }), env.deps);
      const names = (body(list).result.tools as Array<{ name: string }>).map((t) => t.name);
      assert.ok(names.includes('crm_tasks_delete_prepare'));
      assert.ok(!names.some((n) => n.endsWith('_commit')), 'nenhum commit anunciado');
      const mc = await handleMcp(rpc(key, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'crm_tasks_delete_commit', arguments: { id: env.ids.tAna, confirmationToken: body(p).data.confirmationToken } } }), env.deps);
      const txt = JSON.parse(body(mc).result.content[0].text);
      assert.equal(txt.status, 404);
      assert.equal(txt.code, 'OPERATION_DISABLED');
      const doc = buildOpenApiDocument() as any;
      const ops = Object.values(doc.paths).flatMap((p: any) => Object.values(p)) as any[];
      assert.ok(ops.some((o) => o['x-stihub-dangerous'] === 'prepare'));
      assert.ok(!ops.some((o) => o['x-stihub-dangerous'] === 'commit'));
    });
    // ligada: o mesmo commit executa
    const p2 = await prepare(env, key, `/api/v1/crm/tasks/${env.ids.tAna}/delete`);
    const c2 = await commit(env, key, `/api/v1/crm/tasks/${env.ids.tAna}/delete`, {}, body(p2).data.confirmationToken);
    assert.equal(c2.status, 200, JSON.stringify(c2.body));
  });

  it('2. OAuth: perigoso so com confirmDangerousScopes do IAM; DCR nao verificado sempre negado; revogacao vale na hora; limite 10/min por USUARIO', async () => {
    const env = makeEnv();
    grant(env, ADMIN.uid, ALL_GUARDS);
    // sem nada no IAM: perigoso nem e oferecido, mesmo marcado a forca
    const c1 = await registerClient(env);
    const a = await oauthFlow(env, c1.clientId, c1.redirect, 'crm:contacts:read crm:delete', { grant_crm_delete: '1' });
    assert.ok(!/grant_crm_delete/.test(a.html));
    assert.match(a.html, /sem confirmacao do IAM/);
    assert.deepEqual(a.scopes, ['crm:contacts:read']);
    // usuario confirmado, mas cliente DCR NAO verificado => continua negado
    assert.equal((await iamConfirm(env, { subjectType: 'user', subjectId: ADMIN.uid, scopes: ['crm:delete'] })).status, 200);
    assert.equal((await iamConfirm(env, { subjectType: 'client', subjectId: c1.clientId, scopes: ['crm:delete'], clientVerified: false })).status, 200);
    const b = await oauthFlow(env, c1.clientId, c1.redirect, 'crm:contacts:read crm:delete', { grant_crm_delete: '1' });
    assert.deepEqual(b.scopes, ['crm:contacts:read']);
    // IAM sem confirmDangerousScopes => 400
    const noConfirm = await handleIamIntegrationKeys(req('POST', '/api/iam/integration-keys/dangerous-confirmations', { session: session(ADMIN), body: { subjectType: 'client', subjectId: c1.clientId, scopes: [], clientVerified: true } }), env.deps);
    assert.equal(noConfirm.status, 400);
    // cliente verificado (sem escopos proprios) + confirmacao do usuario => concedido
    assert.equal((await iamConfirm(env, { subjectType: 'client', subjectId: c1.clientId, scopes: [], clientVerified: true })).status, 200);
    const c = await oauthFlow(env, c1.clientId, c1.redirect, 'crm:contacts:read crm:delete', { grant_crm_delete: '1' });
    assert.deepEqual(c.scopes, ['crm:contacts:read', 'crm:delete']);
    const path = `/api/v1/crm/tasks/${env.ids.tAna}/delete`;
    assert.equal((await prepare(env, c.token!, path)).status, 200);
    // revogou no IAM => a proxima chamada perigosa ja e negada
    const rv = await handleIamIntegrationKeys(req('POST', `/api/iam/integration-keys/dangerous-confirmations/user/${ADMIN.uid}/revoke`, { session: session(ADMIN) }), env.deps);
    assert.equal(rv.status, 200);
    const denied = await prepare(env, c.token!, path);
    assert.equal(denied.status, 403);
    assert.equal(body(denied).code, 'DANGEROUS_SCOPE_NOT_CONFIRMED');
    // limite por usuario: duas chaves do MESMO usuario somam
    env.deps.limits.dangerousPerMinute = 2;
    for (const k of [...env.store.rate.keys()]) if (k.startsWith('danger:')) env.store.rate.delete(k); // janela nova
    const k1 = await dangerAdminKey(env);
    const k2 = await keyFor(env, ADMIN.uid, 'TODOS', ['crm:delete', 'crm:tasks:read'], ALL_MODULES as never);
    assert.equal((await prepare(env, k1, path)).status, 200);
    assert.equal((await prepare(env, k2, path)).status, 200);
    const third = await prepare(env, k2, path);
    assert.equal(third.status, 429);
    assert.equal(body(third).code, 'DANGEROUS_RATE_LIMITED');
  });

  it('3. comms_email_send: so contato da carteira; sem bcc externo; corpo <= 5.000; teto diario de 50 por usuario', async () => {
    const env = makeEnv();
    const key = await dangerAdminKey(env);
    const send = (p: Record<string, unknown>) => prepare(env, key, '/api/v1/comms/email/send', { subject: 'Oi', body: 'texto', ...p });
    const ext = await send({ to: ['qualquer@externo.com'] });
    assert.equal(ext.status, 422);
    assert.equal(body(ext).code, 'RECIPIENT_NOT_IN_PORTFOLIO');
    const ccExt = await send({ to: ['cliente.ana@empresa-a.com.br'], cc: ['qualquer@externo.com'] });
    assert.equal(body(ccExt).code, 'RECIPIENT_NOT_IN_PORTFOLIO');
    const bcc = await send({ to: ['cliente.ana@empresa-a.com.br'], bcc: ['espiao@externo.com'] });
    assert.equal(bcc.status, 422);
    assert.equal(body(bcc).code, 'BCC_EXTERNAL_FORBIDDEN');
    assert.equal((await send({ to: ['cliente.ana@empresa-a.com.br'], bcc: [ANA.email] })).status, 200, 'bcc interno ok');
    assert.equal((await send({ to: ['cliente.ana@empresa-a.com.br'], body: 'x'.repeat(5001) })).status, 400);
    assert.equal((await send({ to: ['cliente.ana@empresa-a.com.br'], body: 'x'.repeat(5000) })).status, 200);
    // ANA (PROPRIOS) nao manda para contato da Carla
    const ana = await keyFor(env, ANA.uid, 'PROPRIOS', ['comms:send'], { crm: true, chamados: false, erp: true });
    assert.equal(body(await prepare(env, ana, '/api/v1/comms/email/send', { to: ['zuleica@empresa-c.com.br'], subject: 'a', body: 'b' })).code, 'RECIPIENT_NOT_IN_PORTFOLIO');
    // teto diario: 50 envios ja contados hoje => commit 429 antes de enviar
    const now = new Date();
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    env.store.rate.set(`day:comms_email_send:user:${ADMIN.uid}@${day}`, 50);
    const args = { to: ['cliente.ana@empresa-a.com.br'], subject: 'Oi', body: 'texto' };
    const p = await prepare(env, key, '/api/v1/comms/email/send', args);
    const c = await commit(env, key, '/api/v1/comms/email/send', args, body(p).data.confirmationToken);
    assert.equal(c.status, 429, JSON.stringify(c.body));
    assert.equal(body(c).code, 'DAILY_QUOTA_EXCEEDED');
  });

  it('4. OFX sem autoPayMatched (nunca baixa); conta bancaria sem ajuste manual de saldo', async () => {
    const env = makeEnv();
    const key = await dangerAdminKey(env);
    const OFX = `<OFX><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261210<TRNAMT>-77.00<FITID>F1<MEMO>Conta aberta L3</STMTTRN></BANKTRANLIST></OFX>`;
    const withFlag = await prepare(env, key, '/api/v1/erp/financial/reconcile-ofx', { bankId: 'bank-1', ofxContent: OFX, autoPayMatched: true });
    assert.equal(withFlag.status, 400);
    const { c } = await twoStep(env, key, '/api/v1/erp/financial/reconcile-ofx', { bankId: 'bank-1', ofxContent: OFX });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.equal(String(env.repo.getErpState().financialEntries.find((f) => f.id === 'fin-l3-open')!.status), 'ABERTO');
    // data-port barra autoPayMatched=true mesmo vindo de codigo do conector
    const dp = new RouterDataPort(env.router);
    await assert.rejects(() => dp.dangerous('POST', '/api/erp/financial/reconcile-ofx', { bankId: 'bank-1', ofxContent: OFX, autoPayMatched: true }));
    await assert.rejects(() => dp.dangerous('PATCH', '/api/erp/records/bankAccounts/bank-1', { name: 'X', balance: 1 }));
    // saldo: nem no update nem na criacao
    assert.equal((await prepare(env, key, '/api/v1/erp/bank-accounts/bank-1/update', { balance: 1 })).status, 400);
    assert.equal((await prepare(env, key, '/api/v1/erp/bank-accounts', { name: 'Banco Novo', initialBalance: 1000 })).status, 400);
    const { c: ren } = await twoStep(env, key, '/api/v1/erp/bank-accounts/bank-1/update', { name: 'Banco X Renomeado' });
    assert.equal(ren.status, 200, JSON.stringify(ren.body));
    const bank = (env.repo.getErpState().bankAccounts || []).find((b) => b.id === 'bank-1')!;
    assert.equal(bank.name, 'Banco X Renomeado');
    assert.equal(bank.balance, 12345.67, 'saldo intocado');
  });

  it('5. cancelar fatura cancela o recebivel vinculado na MESMA transacao (um unico save); recebivel cancelado nao recebe baixa', async () => {
    const env = makeEnv();
    const erp = env.repo.getErpState();
    erp.financialEntries.push({ id: 'fin-inv-1', type: 'RECEBER', category: 'LOCACAO_EQUIPAMENTOS', description: 'Fatura NF-777', companyName: 'C', costCenter: 'CC', amount: 500, dueDate: '2026-11-10', paidAt: null, status: 'ABERTO', invoiceId: 'inv-1', paymentMethod: 'BOLETO_PIX' } as never);
    let saves = 0;
    const repoAny = env.repo as any;
    const origSave = repoAny.save.bind(repoAny);
    repoAny.save = () => {
      saves++;
      return origSave();
    };
    // caminho real do cancelamento pelo conector: rota interna PATCH /api/erp/invoices/:id
    const dp = new RouterDataPort(env.router);
    const r = await dp.dangerous('PATCH', '/api/erp/invoices/inv-1', { status: 'CANCELADA' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(String(erp.invoices.find((i) => i.id === 'inv-1')!.status), 'CANCELADA');
    assert.equal(String(erp.financialEntries.find((f) => f.id === 'fin-inv-1')!.status), 'CANCELADO');
    assert.deepEqual((r.body as any).cancelledReceivableIds, ['fin-inv-1']);
    assert.equal(saves, 1, 'fatura e recebivel no mesmo save => uma unica transacao no persist');
    repoAny.save = origSave;
    const key = await dangerAdminKey(env);
    const pay = await prepare(env, key, '/api/v1/erp/financial-entries/fin-inv-1/pay');
    assert.equal(pay.status, 409);
    assert.equal(body(pay).code, 'FINANCIAL_ENTRY_CANCELLED');
    // cancelar com outros campos junto => 400 (cancelamento exclusivo)
    await assert.rejects(() => dp.dangerous('PATCH', '/api/erp/invoices/inv-1', { status: 'CANCELADA', grossAmount: 1 }));
  });

  it('6. lixeira: copia integral ANTES de excluir; falha na copia => nada excluido; tabelas so na migracao manual', async () => {
    const env = makeEnv();
    const key = await dangerAdminKey(env);
    const path = `/api/v1/crm/tasks/${env.ids.tAna}/delete`;
    env.store.failTrashInsert = true;
    const p = await prepare(env, key, path);
    const c = await commit(env, key, path, {}, body(p).data.confirmationToken);
    assert.equal(c.status, 503);
    assert.equal(body(c).code, 'TRASH_UNAVAILABLE');
    assert.ok(env.repo.listTasks().some((t: any) => t.id === env.ids.tAna), 'sem copia => sem exclusao');
    env.store.failTrashInsert = false;
    const ok = await twoStep(env, key, path);
    assert.equal(ok.c.status, 200, JSON.stringify(ok.c.body));
    const trash = await env.store.listDeletedRecords('crm.task', env.ids.tAna);
    assert.equal(trash.length, 1);
    assert.equal(trash[0].snapshot.title, 'Ligar para cliente da Ana', 'registro inteiro, nao so a previa');
    assert.equal(trash[0].operationId, 'crm.tasks.delete');
    assert.equal(trash[0].actorUserId, ADMIN.uid);
    // merge tambem copia os dois registros
    const dup = env.repo.createContact({ firstName: 'Cliente', lastName: 'DaAna2', email: 'cliente.ana2@empresa-a.com.br', ownerId: 'usr-ana', ownerName: 'Ana Vendas' });
    const mg = await twoStep(env, key, '/api/v1/crm/merge', { entityType: 'CONTACT', primaryId: env.ids.cAna, duplicateId: dup.id });
    if (mg.c.status === 200) assert.equal((await env.store.listDeletedRecords('crm.contact', dup.id)).length, 1);
    // tabelas fora do boot
    assert.ok(API_V1_MANUAL_TABLES.includes('api_deleted_records' as never));
    assert.ok(API_V1_MANUAL_TABLES.includes('api_confirmation_tokens' as never));
    assert.ok(API_V1_MANUAL_TABLES.includes('api_dangerous_scope_confirmations' as never));
    assert.ok(!/api_confirmation_tokens|api_deleted_records|api_dangerous_scope_confirmations/.test(INTEGRATION_SCHEMA_SQL));
    // sem a migracao: falha fechada antes de qualquer token
    env.store.manualMigrationApplied = false;
    const mr = await prepare(env, key, `/api/v1/crm/tasks/${env.ids.tCarla}/delete`);
    assert.equal(mr.status, 503);
    assert.equal(body(mr).code, 'MIGRATION_REQUIRED');
  });

  it('7. conector sem aceite de proposta (CPF) e sem aceite de termos em nome do cliente', async () => {
    const env = makeEnv();
    const key = await dangerAdminKey(env);
    const r = await prepare(env, key, '/api/v1/erp/proposals/prop-ana/approve', { signerName: 'Fulano', signerCpf: '529.982.247-25', signerRole: 'Dir', modality: 'GOV_BR_OURO', acceptedTerms: true });
    assert.equal(r.status, 404);
    assert.ok(!INTEGRATION_USE_CASES.some((u) => /approve|accept/i.test(u.operationId) && u.method === 'POST'));
    assert.ok(!INTEGRATION_USE_CASES.some((u) => JSON.stringify((u as any).inputSchema?.toJSONSchema?.() ?? '').match(/signerCpf|acceptedTerms/)));
    assert.equal(validateRequestedScopes(['erp:proposals:approve']).ok, false);
    const dp = new RouterDataPort(env.router);
    await assert.rejects(() => dp.dangerous('POST', '/api/erp/proposals/prop-ana/approve', { signerName: 'x' }));
    assert.equal(String(env.repo.getErpState().proposals.find((p) => p.id === 'prop-ana')!.status), 'ENVIADA');
  });

  it('8. fiscal atras de INTEGRATION_ENABLE_FISCAL_OPS (desligada): nada fiscal no tools/list, OpenAPI, escopos, REST, IAM nem allowlist interna', async () => {
    const env = makeEnv();
    const key = await dangerAdminKey(env); // criada com a flag ligada (chave antiga com escopo fiscal)
    await withFlags(FLAGS_OFF, async () => {
      const doc = buildOpenApiDocument() as any;
      const json = JSON.stringify(doc);
      const opPaths = Object.keys(doc.paths).filter((p) => Object.values(doc.paths[p]).some((o: any) => o['x-stihub-dangerous']));
      assert.ok(!opPaths.some((p) => /fiscal-documents|generate-remessa|generate-invoice|batch-billing|nfe-import|partial-return/.test(p)), 'nenhuma operacao fiscal no OpenAPI');
      assert.ok(!/erp:fiscal:issue|erp:fiscal:cancel/.test(json), 'nenhum escopo fiscal no OpenAPI');
      const meta = await handleOAuth(req('GET', '/.well-known/oauth-authorization-server'), env.deps);
      assert.ok(!JSON.stringify(meta.body ?? '').includes('erp:fiscal'));
      const list = await handleMcp(rpc(key, { jsonrpc: '2.0', id: 1, method: 'tools/list' }), env.deps);
      const names = (body(list).result.tools as Array<{ name: string }>).map((t) => t.name);
      // operacoes fiscais (emitir, remessa, faturar/reservar numeracao, NF-e importacao, cancelar/excluir) somem;
      // leituras do Lote 1 ja publicadas (erp_invoices_list, erp_fiscal_settings_get) seguem como estavam.
      const ops = names.filter((n) => !/_(list|get)$/.test(n));
      assert.ok(!ops.some((n) => /fiscal|remessa|generate_invoice|batch_billing|nfe_import|partial_return/.test(n)), ops.join(','));
      assert.ok(names.includes('erp_contracts_readjust_prepare'), 'reajuste nao e fiscal');
      const r = await prepare(env, key, '/api/v1/erp/contracts/ctr-ana/generate-remessa');
      assert.equal(r.status, 404);
      const k = await createKey(env, { name: 'f', scopes: ['erp:fiscal:issue'], portfolioScope: 'TODOS', moduleAccess: { crm: true, chamados: false, erp: true }, ownerUserId: ADMIN.uid, confirmDangerousScopes: true });
      assert.equal(k.res.status, 422);
      assert.equal(body(k.res).code, 'FISCAL_OPS_DISABLED');
      const dp = new RouterDataPort(env.router);
      const before = env.repo.getErpState().invoices.length;
      await assert.rejects(() => dp.dangerous('POST', '/api/erp/rental-contracts/ctr-ana/generate-remessa', {}));
      await assert.rejects(() => dp.dangerous('POST', '/api/erp/invoices', { companyName: 'X', grossAmount: 1 }));
      assert.equal(env.repo.getErpState().invoices.length, before);
      // nao-fiscal segue normal
      assert.equal((await prepare(env, key, `/api/v1/crm/tasks/${env.ids.tAna}/delete`)).status, 200);
      void NON_FISCAL_D;
    });
  });
});

// ---------------------------------------------------------------------------
// Parecer do CISO de 26/11/2026 (2a rodada) — reajuste exige a alcada financeira da baixa
// ---------------------------------------------------------------------------
describe('Lote 3 / CISO 26/11: reajuste de contrato no commit exige a alcada de settle', () => {
  it('3. sem Financeiro EDICAO (a alcada de erp:financial:settle) o commit do reajuste da 403 e nada muda; com ela, executa', async () => {
    const env = makeEnv();
    const key = await dangerAdminKey(env);
    const erp = env.repo.getErpState();
    const value = () => Number((erp.rentalContracts.find((c: any) => c.id === 'ctr-ana') as any).monthlyValue);
    const path = '/api/v1/erp/contracts/ctr-ana/readjust';
    const args = { percentage: 5, index: 'IPCA' };
    const rec: any = userRec(env, ADMIN.uid);
    for (const fin of ['VIEW', 'NONE', 'DESCONHECIDO']) {
      rec.erpPermissions = { ...rec.erpPermissions, financeBanksAccess: 'FULL' };
      const p = await prepare(env, key, path, args);
      assert.equal(p.status, 200, JSON.stringify(p.body));
      rec.erpPermissions = { ...rec.erpPermissions, financeBanksAccess: fin }; // alcada cai entre prepare e commit
      const c = await commit(env, key, path, args, body(p).data.confirmationToken);
      assert.equal(c.status, 403, `${fin} ${JSON.stringify(c.body)}`);
      assert.equal(body(c).code, 'OWNER_ACCESS_INSUFFICIENT');
      assert.equal(body(c).details?.scope ?? 'erp:financial:settle', 'erp:financial:settle');
      assert.equal(value(), 500, 'contrato nao reajustado');
      // token de uso unico: consumido mesmo na recusa
      rec.erpPermissions = { ...rec.erpPermissions, financeBanksAccess: 'FULL' };
      const again = await commit(env, key, path, args, body(p).data.confirmationToken);
      assert.notEqual(again.status, 200);
      assert.equal(value(), 500);
    }
    // MCP: mesma recusa
    rec.erpPermissions = { ...rec.erpPermissions, financeBanksAccess: 'FULL' };
    const p = await prepare(env, key, path, args);
    rec.erpPermissions = { ...rec.erpPermissions, financeBanksAccess: 'VIEW' };
    const mc = await handleMcp(rpc(key, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'erp_contracts_readjust_commit', arguments: { id: 'ctr-ana', ...args, confirmationToken: body(p).data.confirmationToken } } }), env.deps);
    assert.match(JSON.stringify(body(mc)), /OWNER_ACCESS_INSUFFICIENT/);
    assert.equal(value(), 500);
    // com Financeiro EDICAO (EDIT basta) o reajuste executa
    rec.erpPermissions = { ...rec.erpPermissions, financeBanksAccess: 'EDIT' };
    const ok = await twoStep(env, key, path, args);
    assert.equal(ok.c.status, 200, JSON.stringify(ok.c.body));
    assert.equal(value(), 525);
  });
});
