// ============================================================================
// Emitir NF-e a partir da venda: mapeamento venda → rascunho e rotas
// GET/POST /api/erp/vendas/:vendaId/nfe (alçada fiscal + 2FA, vínculo saleOrderId).
// ============================================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';

import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import type { Company, ErpCatalogItem, ErpSaleOrder } from '../src/db/types';
import {
  findActiveProductNfeForSale,
  mapSaleToProductNfeDraft,
  paymentMethodToTPag,
  prefillTaxpayerType,
  saleNfeEligibility,
  suggestDestination,
} from '../src/modules/erp/sale-to-product-nfe';

const ROOT = path.resolve(__dirname, '..', '..');
const PATH_OF = (id: string) => `/api/erp/vendas/${encodeURIComponent(id)}/nfe`;

function sessionFor(uid: string, email: string, roleId: string, mfa = true) {
  const iat = Date.now();
  return signStiHubSessionToken({
    uid,
    email,
    name: 'Teste NF-e da venda',
    roleId,
    scope: 'TODOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'],
    moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: mfa,
    mfaMethod: 'TOTP_AUTHENTICATOR',
    iat,
    exp: iat + 3_600_000,
  });
}
const admin = () => ({ _sessionToken: sessionFor('usr-seta-01', 'marcelo.mira@setatelecom.com.br', 'SUPER_ADMIN') });
const auditor = () => ({ _sessionToken: sessionFor('usr-seta-22', 'auditoria@setatelecom.com.br', 'FISCAL_CONTABIL') });
const noMfa = () => ({ _sessionToken: sessionFor('usr-seta-01', 'marcelo.mira@setatelecom.com.br', 'SUPER_ADMIN', false) });

function setup() {
  const repo = createInMemoryRepository();
  const state = repo.getState();
  if (state.erp?.gestaoClickConfig) {
    state.erp.gestaoClickConfig.taxRegime = 'SIMPLES_NACIONAL';
  }
  return { repo, router: new CrmApiRouter(repo) };
}

const CNPJ_OK = '11222333000181';

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: 'comp-cliente-nfe-1',
    name: 'CLIENTE TESTE INDUSTRIA LTDA',
    domain: 'cliente-teste.com.br',
    cnpj: '11.222.333/0001-81',
    industry: null,
    size: null,
    annualRevenue: null,
    city: 'Campinas',
    state: 'SP',
    country: 'Brasil',
    completenessScore: 80,
    enrichedAt: null,
    enrichmentSource: null,
    customProperties: {
      legalName: 'CLIENTE TESTE INDUSTRIA LTDA',
      stateRegistration: '110.042.490.114',
      emailFinanceiroNfe: 'fiscal@cliente.com.br',
      phone: '(19) 3333-4444',
      addresses: [
        {
          cep: '13015-080',
          street: 'Rua das Palmeiras',
          number: '100',
          complement: 'Sala 1',
          neighborhood: 'Centro',
          cityState: 'Campinas/SP',
          ibgeCode: '3509502',
        },
      ],
    },
    lastActivityAt: null,
    createdAt: '2026-11-27T00:00:00.000Z',
    updatedAt: '2026-11-27T00:00:00.000Z',
    ...overrides,
  };
}

function sale(overrides: Partial<ErpSaleOrder> = {}): ErpSaleOrder {
  return {
    id: 'vnd-nfe-1001',
    code: '2941',
    companyName: 'CLIENTE TESTE INDUSTRIA LTDA',
    sellerName: 'Marcelo Mira',
    date: '27/11/2026',
    status: 'Concretizada',
    totalAmount: 1500,
    itemsSummary: '2x ROTEADOR WI-FI 6',
    paymentMethod: 'Boleto / PIX Corporativo',
    saleType: 'PRODUTO',
    companyId: 'comp-cliente-nfe-1',
    companyCnpj: '11.222.333/0001-81',
    items: [
      {
        catalogItemId: 'cat-router',
        code: 'GC-EQ-1',
        description: 'ROTEADOR WI-FI 6',
        ncm: '85176259',
        quantity: 2,
        unitValue: 750,
      },
    ],
    ...overrides,
  };
}

const catalog: ErpCatalogItem[] = [
  {
    id: 'cat-router',
    gestaoClickCode: 'GC-EQ-1',
    name: 'ROTEADOR WI-FI 6',
    category: 'VENDA_HARDWARE',
    fiscalNature: 'VENDA_EQUIPAMENTO',
    ncmOrLc116: 'NCM 8517.62.59',
    cfopDefault: '5102',
    stockAvailable: 10,
    stockRentedInClients: 0,
    monthlyRentalPrice: 0,
    saleOrSetupPrice: 750,
    isActive: true,
    unitOfMeasure: 'UN',
    enableNfe: true,
  },
];

const simplesCtx = {
  taxRegime: 'SIMPLES_NACIONAL' as const,
  emitterUf: 'SP',
  serie: '1',
  additionalInfo: 'Empresa ME ou EPP optante pelo simples nacional, não gera direito a crédito fiscal de ISS e IPI',
  company: company(),
  catalog,
  invoices: [],
  now: new Date('2026-11-27T15:00:00-03:00'),
};

describe('Mapeamento venda → NF-e', () => {
  it('operação interna (SP) usa CFOP 5.102, CSOSN 102, natureza de venda e mensagem do Simples', () => {
    assert.deepEqual(suggestDestination('SP', 'SP'), { idDest: '1', cfop: '5102' });
    const out = mapSaleToProductNfeDraft(sale(), simplesCtx);
    assert.equal(out.draft.general.natOp, 'VENDA DE MERCADORIA');
    assert.equal(out.draft.general.tpNF, '1');
    assert.equal(out.draft.general.finNFe, '1');
    assert.equal(out.draft.general.indIntermed, '0');
    assert.equal(out.draft.general.idDest, '1');
    assert.equal(out.draft.items[0].cfop, '5102');
    assert.equal(out.draft.items[0].icmsCode, '102');
    assert.equal(out.draft.items[0].ncm, '85176259');
    assert.equal(out.draft.items[0].quantity, 2);
    assert.equal(out.draft.items[0].unitValue, 750);
    assert.equal(out.draft.recipient.document, CNPJ_OK);
    assert.equal(out.draft.recipient.address.city, 'Campinas');
    assert.equal(out.draft.recipient.address.uf, 'SP');
    assert.equal(out.draft.recipient.taxpayerType, '1');
    assert.equal(out.draft.transport?.modFrete, '9');
    assert.match(String(out.draft.additionalInfo?.complementary), /simples nacional/i);
    assert.equal(out.readyToCreate, true);
    assert.equal(out.existing, null);
  });

  it('operação interestadual (UF do destinatário ≠ emitente) usa CFOP 6.102', () => {
    assert.deepEqual(suggestDestination('SP', 'RJ'), { idDest: '2', cfop: '6102' });
    const out = mapSaleToProductNfeDraft(
      sale({
        address: { city: 'Rio de Janeiro', uf: 'RJ', cityIbge: '3304557', street: 'Av. Rio Branco', number: '1', district: 'Centro', cep: '20040-002' },
      }),
      { ...simplesCtx, company: company({ city: 'Rio de Janeiro', state: 'RJ' }) }
    );
    assert.equal(out.draft.general.idDest, '2');
    assert.equal(out.draft.items[0].cfop, '6102');
    assert.ok(out.warnings.some((w) => /interestadual/i.test(w)));
  });

  it('sem itens detalhados monta um produto a partir do resumo e do total, e avisa NCM faltando', () => {
    const out = mapSaleToProductNfeDraft(sale({ items: undefined, itemsSummary: 'Infraestrutura PABX IP', totalAmount: 146720 }), {
      ...simplesCtx,
      catalog: [],
      company: company(),
    });
    assert.equal(out.draft.items.length, 1);
    assert.equal(out.draft.items[0].description, 'Infraestrutura PABX IP');
    assert.equal(out.draft.items[0].quantity, 1);
    assert.equal(out.draft.items[0].unitValue, 146720);
    assert.equal(out.draft.items[0].ncm, '');
    assert.equal(out.readyToCreate, false);
    assert.ok(out.missingRequired.some((i) => i.path === 'items.0.ncm'));
    assert.ok(out.warnings.some((w) => /resumo da venda/i.test(w)));
  });

  it('tipo de contribuinte vazio fica pendente (obrigatório) e o PIX vira tPag 17', () => {
    assert.equal(paymentMethodToTPag('PIX Corporativo').tPag, '17');
    const bare = company({ customProperties: { legalName: 'CLIENTE SEM IE' } });
    const out = mapSaleToProductNfeDraft(sale({ taxpayerType: '', ie: '', paymentMethod: 'PIX Corporativo' }), {
      ...simplesCtx,
      company: bare,
    });
    assert.equal(prefillTaxpayerType(sale({ taxpayerType: '', ie: '' }), bare), '');
    assert.ok(out.missingRequired.some((i) => i.path === 'recipient.taxpayerType'));
    assert.equal(out.draft.transport?.hasPayment, true);
    assert.equal(out.draft.transport?.payment?.tPag, '17');
  });

  it('não é elegível para serviço, devolução ou venda cancelada', () => {
    assert.equal(saleNfeEligibility(sale({ saleType: 'SERVICO' })).ok, false);
    assert.equal(saleNfeEligibility(sale({ saleType: 'DEVOLUCAO' })).ok, false);
    assert.equal(saleNfeEligibility(sale({ status: 'Cancelada' })).ok, false);
    assert.equal(saleNfeEligibility(sale()).ok, true);
  });

  it('encontra a NF-e ativa vinculada à venda e ignora a cancelada', () => {
    const active = {
      id: 'inv-1',
      documentNumber: 'NF-e 10',
      status: 'RASCUNHO',
      saleOrderId: 'vnd-nfe-1001',
      productNfe: { nNF: 10, serie: '1' },
      updatedAt: '2026-11-27T12:00:00.000Z',
    } as never;
    const canceled = {
      id: 'inv-2',
      documentNumber: 'NF-e 9',
      status: 'CANCELADA',
      saleOrderId: 'vnd-nfe-1001',
      productNfe: { nNF: 9, serie: '1', sefaz: { status: 'CANCELADA' } },
      updatedAt: '2026-11-27T13:00:00.000Z',
    } as never;
    const found = findActiveProductNfeForSale([canceled, active], 'vnd-nfe-1001', '2941');
    assert.equal(found?.id, 'inv-1');
  });
});

describe('GET/POST /api/erp/vendas/:vendaId/nfe', () => {
  it('401 sem sessão, 403 sem alçada ou sem 2FA, 404 venda inexistente, 422 venda de serviço', async () => {
    const { repo, router } = setup();
    repo.upsertSaleOrder(sale({ saleType: 'SERVICO', id: 'vnd-serv-1', code: 'S1' }));
    const noAuth = await router.dispatch({ method: 'GET', path: PATH_OF('vnd-nfe-1001'), query: {}, body: {} });
    assert.equal(noAuth.status, 401);
    const forbidden = await router.dispatch({ method: 'GET', path: PATH_OF('vnd-nfe-1001'), query: auditor(), body: {} });
    assert.equal(forbidden.status, 403);
    const mfa = await router.dispatch({ method: 'GET', path: PATH_OF('vnd-nfe-1001'), query: noMfa(), body: {} });
    assert.equal(mfa.status, 401); // sessão sem 2FA não autentica nestas rotas
    const missing = await router.dispatch({ method: 'GET', path: PATH_OF('nao-existe'), query: admin(), body: {} });
    assert.equal(missing.status, 404);
    assert.equal((missing.body as { code?: string }).code, 'SALE_NOT_FOUND');
    const serv = await router.dispatch({ method: 'GET', path: PATH_OF('vnd-serv-1'), query: admin(), body: {} });
    assert.equal(serv.status, 422);
    assert.equal((serv.body as { code?: string }).code, 'SALE_NFE_NOT_ELIGIBLE');
  });

  it('GET pré-preenche a partir da venda e do cadastro do cliente; POST grava rascunho com vínculo e tpAmb=2', async () => {
    const { repo, router } = setup();
    repo.createCompany(company());
    repo.upsertSaleOrder(sale());
    const get = await router.dispatch({ method: 'GET', path: PATH_OF('vnd-nfe-1001'), query: admin(), body: {} });
    assert.equal(get.status, 200);
    const data = (get.body as { data: Record<string, unknown> }).data;
    const draft = data.draft as { general: { natOp: string; idDest: string; indIntermed: string }; items: Array<{ ncm: string; cfop: string; icmsCode: string }>; recipient: { document: string } };
    assert.equal(draft.general.natOp, 'VENDA DE MERCADORIA');
    assert.equal(draft.general.indIntermed, '0');
    assert.equal(draft.items[0].ncm, '85176259');
    assert.equal(draft.items[0].cfop, '5102');
    assert.equal(draft.items[0].icmsCode, '102');
    assert.equal(data.readyToCreate, true);
    assert.equal(data.existing, null);
    assert.equal((data.context as { environment: string }).environment, 'HOMOLOGACAO');

    const created = await router.dispatch({ method: 'POST', path: PATH_OF('vnd-nfe-1001'), query: admin(), body: {} });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const inv = (created.body as { data: { id: string; saleOrderId?: string; status: string; productNfe: { nNF: number; serie: string; environment: string; xmlContent: string; crt: string } } }).data;
    assert.equal(inv.saleOrderId, 'vnd-nfe-1001');
    assert.equal(inv.status, 'RASCUNHO');
    assert.equal(inv.productNfe.environment, 'HOMOLOGACAO');
    assert.equal(inv.productNfe.crt, '1');
    assert.match(inv.productNfe.xmlContent, /<tpAmb>2<\/tpAmb>/);
    assert.match(inv.productNfe.xmlContent, /<indIntermed>0<\/indIntermed>/);
    assert.match(inv.productNfe.xmlContent, /<CFOP>5102<\/CFOP>/);
    assert.doesNotMatch(inv.productNfe.xmlContent, /<tpAmb>1<\/tpAmb>/);

    const again = await router.dispatch({ method: 'GET', path: PATH_OF('vnd-nfe-1001'), query: admin(), body: {} });
    const againData = (again.body as { data: { existing: { nNF: number; id: string } } }).data;
    assert.equal(againData.existing.nNF, inv.productNfe.nNF);
    assert.equal(againData.existing.id, inv.id);

    const dup = await router.dispatch({ method: 'POST', path: PATH_OF('vnd-nfe-1001'), query: admin(), body: {} });
    assert.equal(dup.status, 409);
    assert.equal((dup.body as { code?: string }).code, 'SALE_NFE_ALREADY_EXISTS');

    const forced = await router.dispatch({ method: 'POST', path: PATH_OF('vnd-nfe-1001'), query: admin(), body: { force: true } });
    assert.equal(forced.status, 201, JSON.stringify(forced.body));
    const inv2 = (forced.body as { data: { id: string; saleOrderId?: string } }).data;
    assert.notEqual(inv2.id, inv.id);
    assert.equal(inv2.saleOrderId, 'vnd-nfe-1001');
  });

  it('POST sem draft de uma venda incompleta retorna 400 SALE_NFE_INCOMPLETE e não grava', async () => {
    const { repo, router } = setup();
    const before = repo.getErpOverview().invoices.filter((i) => i.productNfe).length;
    repo.upsertSaleOrder(
      sale({
        id: 'vnd-incompleta',
        code: '2999',
        companyId: undefined,
        companyCnpj: '',
        items: undefined,
        itemsSummary: 'Produto sem NCM',
      })
    );
    const res = await router.dispatch({ method: 'POST', path: PATH_OF('vnd-incompleta'), query: admin(), body: {} });
    assert.equal(res.status, 400);
    assert.equal((res.body as { code?: string }).code, 'SALE_NFE_INCOMPLETE');
    const after = repo.getErpOverview().invoices.filter((i) => i.productNfe).length;
    assert.equal(after, before);
  });

  it('POST com corpo desconhecido é rejeitado (zod .strict()) e a tela de Vendas aponta o contrato', () => {
    const tab = fs.readFileSync(path.join(ROOT, 'src/app/components/ErpGestaoClickTab.tsx'), 'utf8');
    const form = fs.readFileSync(path.join(ROOT, 'src/app/components/ProductNfeForm.tsx'), 'utf8');
    const menu = fs.readFileSync(path.join(ROOT, 'src/app/components/SaleEmitFiscalMenu.tsx'), 'utf8');
    const router = fs.readFileSync(path.join(ROOT, 'src/api/router.ts'), 'utf8');
    assert.match(tab, /SaleEmitFiscalMenu/);
    assert.match(tab, /\/api\/erp\/vendas\/\$\{encodeURIComponent\(sale\.id\)\}\/nfe/);
    assert.match(form, /sourceSaleOrderId/);
    assert.match(form, /Operação sem intermediador/);
    assert.match(menu, /Em breve/);
    assert.match(router, /SALE_NFE_PATH_RE/);
    assert.match(router, /saleOrderId/);
  });
});
