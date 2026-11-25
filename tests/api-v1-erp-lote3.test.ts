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
  async function consent(env: Env, scope: string, extra: Record<string, string>) {
    const redirect = 'https://client.example/callback';
    const reg = await handleOAuth(req('POST', '/api/oauth/register', { body: { client_name: 'Agente', redirect_uris: [redirect] } }), env.deps);
    const clientId = body(reg).client_id as string;
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
  it('admin: follow-up, cadencia ativa, aceite, workflow (ativar/disparar), campanha, cobranca em lote', async () => {
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
    // aceite da proposta
    const ap = await twoStep(env, key, '/api/v1/erp/proposals/prop-ana/approve', { signerName: 'Fulano de Tal', signerCpf: '529.982.247-25', signerRole: 'Diretor', modality: 'GOV_BR_OURO', acceptedTerms: true });
    assert.equal(ap.c.status, 200, JSON.stringify(ap.c.body));
    assert.ok(['APROVADA', 'CONVERTIDA_CONTRATO'].includes(String(env.repo.getErpState().proposals.find((p) => p.id === 'prop-ana')!.status)));
    const again = await prepare(env, key, '/api/v1/erp/proposals/prop-ana/approve', { signerName: 'Fulano de Tal', signerCpf: '529.982.247-25', signerRole: 'Diretor', modality: 'GOV_BR_OURO', acceptedTerms: true });
    assert.equal(again.status, 409);
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
    const p = await prepare(env, key, '/api/v1/comms/email/send', { to: ['cliente@empresa.com'], subject: 'Proposta', body: 'Segue', contactId: env.ids.cAna });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assert.equal(body(p).data.preview.from, ADMIN.email);
    const c = await commit(env, key, '/api/v1/comms/email/send', { to: ['cliente@empresa.com'], subject: 'Proposta', body: 'Segue', contactId: env.ids.cAna }, body(p).data.confirmationToken);
    // sem caixa do Outlook conectada no teste: o app recusa, mas reconhece o dono como ator (nao "so usuarios")
    assert.notEqual(body(c).code, 'MAILBOX_USER_ONLY', JSON.stringify(c.body));
    assert.ok([200, 409, 503].includes(c.status), JSON.stringify(c.body));
    // ficha fora da carteira => 404
    grant(env, ANA.uid, {});
    const ana = await keyFor(env, ANA.uid, 'PROPRIOS', ['comms:send'], { crm: true, chamados: false, erp: true });
    assert.equal((await prepare(env, ana, '/api/v1/comms/email/send', { to: ['x@y.com'], subject: 'a', body: 'b', contactId: (env.repo.listContacts().find((x: any) => x.ownerName === 'Carla Outra') as any).id })).status, 404);
    // links publicos: o dono vira ator (sem sessao), segredo ausente => 503 fail-closed do app
    const pl = await twoStep(env, key, '/api/v1/erp/proposals/prop-carla/public-link');
    assert.notEqual(body(pl.c).code, 'MFA_AUTH_REQUIRED', JSON.stringify(pl.c.body));
    assert.ok([200, 503].includes(pl.c.status), JSON.stringify(pl.c.body));
    const il = await twoStep(env, key, '/api/v1/erp/invoices/inv-1/public-link');
    assert.notEqual(body(il.c).code, 'MFA_AUTH_REQUIRED', JSON.stringify(il.c.body));
    assert.ok([200, 404, 503].includes(il.c.status), JSON.stringify(il.c.body));
  });

  it('negacoes: aceite sem canApproveProposals, campanha/ativacao sem TODOS, contrato fora da carteira', async () => {
    const env = makeEnv();
    const k = await createKey(env, { name: 'x', scopes: ['erp:proposals:approve'], portfolioScope: 'PROPRIOS', moduleAccess: { crm: true, chamados: false, erp: true }, ownerUserId: BRUNO.uid, confirmDangerousScopes: true });
    assert.equal(k.res.status, 422);
    grant(env, ANA.uid, { canApproveProposals: true });
    grantMarketing(env, ANA.uid);
    const ana = await keyFor(env, ANA.uid, 'PROPRIOS', ['erp:proposals:approve', 'crm:marketing:dispatch', 'crm:automation:activate', 'comms:send'], { crm: true, chamados: false, erp: true });
    assert.equal((await prepare(env, ana, '/api/v1/erp/proposals/prop-carla/approve', { signerName: 'Fulano', signerCpf: '529.982.247-25', signerRole: 'Dir', modality: 'GOV_BR_OURO', acceptedTerms: true })).status, 404);
    assert.equal((await prepare(env, ana, '/api/v1/marketing/campaigns/cmp-x/dispatch', { templateId: 't', segmentId: 's' })).status, 403);
    const wf = env.repo.createWorkflow({ name: 'WF', triggerType: 'CONTACT_CREATED' as never, isActive: false, steps: [] } as never) as any;
    assert.equal((await prepare(env, ana, `/api/v1/automation/workflows/${wf.id}/activate`)).status, 403);
    // ANA so tem VIEW em contratos => cobranca em lote negada
    assert.equal((await prepare(env, ana, '/api/v1/erp/contracts/batch-email', { contractIds: ['ctr-ana'] })).status, 403);
  });
});
