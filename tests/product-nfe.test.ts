// ============================================================================
// NF-e de produtos (Fiscal > Notas de produtos, padrão GestaoClick — 02/11/2026):
// rascunho em homologação, número do ambiente certo, xNome de homologação, validação (zod),
// 403 sem alçada fiscal, totais do erp-tax-engine, exclusão só de rascunho.
// ============================================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { ErpFiscalInvoice } from '../src/db/types';
import { FISCAL_PRODUCTION_CONFIRMATION } from '../src/modules/erp/fiscal-settings';
import { calculateBrazilianTaxBreakdown } from '../src/modules/erp/erp-tax-engine';
import { computeNfeAccessKeyDv } from '../src/modules/erp/sebrae-nfe-import-engine';
import {
  HOMOLOGATION_RECIPIENT_NAME,
  computeProductNfeTotals,
  isValidCnpjDv,
  isValidCpfDv,
  suggestIcmsCode,
} from '../src/modules/erp/product-nfe-engine';

const ROOT = path.resolve(__dirname, '..', '..');
const PATH = '/api/erp/nfe-produtos';

function sessionFor(uid: string, email: string, roleId: string) {
  const iat = Date.now();
  return signStiHubSessionToken({
    uid,
    email,
    name: 'Teste NF-e produtos',
    roleId,
    scope: 'TODOS',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'],
    moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true,
    mfaMethod: 'TOTP_AUTHENTICATOR',
    iat,
    exp: iat + 3_600_000,
  });
}
const admin = () => ({ _sessionToken: sessionFor('usr-seta-01', 'marcelo.mira@setatelecom.com.br', 'SUPER_ADMIN') });
const auditor = () => ({ _sessionToken: sessionFor('usr-seta-22', 'auditoria@setatelecom.com.br', 'FISCAL_CONTABIL') });

function setup() {
  const repo = createInMemoryRepository();
  return { repo, router: new CrmApiRouter(repo) };
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    general: {
      natOp: 'VENDA DE MERCADORIA',
      issueDateTime: '2026-11-02T16:30',
      tpNF: '1',
      indFinal: '1',
      saida: 'NA_EMISSAO',
      finNFe: '1',
      tpEmis: '1',
      idDest: '1',
      indPres: '1',
      hasReferencedNfe: false,
    },
    recipient: {
      documentType: 'CNPJ',
      document: '11.222.333/0001-81',
      name: 'CLIENTE TESTE & FILHOS <LTDA>',
      taxpayerType: '1',
      ie: '110.042.490.114',
      address: { cep: '01310-100', street: 'Av. Paulista', number: '1000', complement: '', district: 'Bela Vista', city: 'São Paulo', uf: 'SP', cityIbge: '3550308' },
      country: 'Brasil',
      phone: '(11) 3333-4444',
      email: 'fiscal@cliente.com.br',
      hasDeliveryAddress: false,
      hasPickupAddress: false,
    },
    items: [
      { code: 'GC-EQ-1', description: 'ROTEADOR WI-FI 6', ncm: '85176259', cfop: '5102', unit: 'UN', quantity: 2, unitValue: 150.5, icmsCode: '00' },
      { code: 'GC-EQ-2', description: 'SWITCH 24P', ncm: '85176259', cfop: '5102', unit: 'UN', quantity: 1, unitValue: 899.0, icmsCode: '00' },
    ],
    transport: { modFrete: '9' },
    totals: { discountValue: 0, adjustedTotal: null },
    additionalInfo: { complementary: 'Documento emitido por ME ou EPP optante pelo Simples Nacional.' },
    ...overrides,
  };
}

const create = (router: CrmApiRouter, body: unknown, query = admin()) => router.dispatch({ method: 'POST', path: PATH, query, body });

describe('NF-e de produtos — rascunho', () => {
  it('cadastra como RASCUNHO em HOMOLOGAÇÃO (padrão), tpAmb=2, sem financeiro, com auditoria', async () => {
    const { repo, router } = setup();
    const finBefore = repo.getErpOverview().financialEntries.length;
    const r = await create(router, draft());
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const inv = (r.body as { data: ErpFiscalInvoice }).data;
    assert.equal(inv.status, 'RASCUNHO');
    assert.equal(inv.documentType, 'NFE_VENDA_PRODUTO');
    assert.equal(inv.productNfe!.environment, 'HOMOLOGACAO');
    assert.ok(inv.productNfe!.xmlContent.includes('<tpAmb>2</tpAmb>'));
    assert.ok(inv.productNfe!.xmlContent.includes('RASCUNHO NAO AUTORIZADO'));
    assert.equal(repo.getErpOverview().financialEntries.length, finBefore, 'rascunho não gera financeiro');
    const logs = repo.listSecurityAuditLogs(20).logs as Array<{ action: string }>;
    assert.ok(logs.some((l) => l.action === 'ERP_PRODUCT_NFE_DRAFT_CREATED'));
    // chave de acesso com DV real
    const key = inv.productNfe!.accessKey;
    assert.equal(key.length, 44);
    assert.equal(computeNfeAccessKeyDv(key.slice(0, 43)), key.slice(43));
    assert.equal(inv.verificationCodeOrKey, key);
    assert.ok(inv.productNfe!.xmlContent.includes(`Id="NFe${key}"`));
  });

  it('em homologação o xNome do destinatário é o texto obrigatório e o nome real fica no cadastro; XML escapado', async () => {
    const { router } = setup();
    const r = await create(router, draft());
    const inv = (r.body as { data: ErpFiscalInvoice }).data;
    const xml = inv.productNfe!.xmlContent;
    const dest = xml.slice(xml.indexOf('<dest>'), xml.indexOf('</dest>'));
    assert.ok(dest.includes(`<xNome>${HOMOLOGATION_RECIPIENT_NAME}</xNome>`));
    assert.equal(dest.includes('CLIENTE TESTE'), false);
    assert.equal(inv.companyName, 'CLIENTE TESTE & FILHOS <LTDA>');
    assert.equal(/<LTDA>/.test(xml), false);
    assert.ok(dest.includes('<CNPJ>11222333000181</CNPJ>'));
  });

  it('numeração do ambiente: homologação usa a sequência de homologação; produção continua do GestaoClick (2177)', async () => {
    const { repo, router } = setup();
    const ctx = await router.dispatch({ method: 'GET', path: `${PATH}/context`, query: admin() });
    assert.equal(ctx.status, 200);
    const c = (ctx.body as { data: { environment: string; serie: string; nextNumber: number } }).data;
    assert.equal(c.environment, 'HOMOLOGACAO');
    assert.equal(c.serie, '1');
    const h1 = (await create(router, draft())).body as { data: ErpFiscalInvoice };
    assert.equal(h1.data.productNfe!.nNF, c.nextNumber);
    const h2 = (await create(router, draft())).body as { data: ErpFiscalInvoice };
    assert.equal(h2.data.productNfe!.nNF, c.nextNumber + 1);
    assert.equal(repo.peekNextFiscalNumber('55', '1', 'PRODUCAO'), 2177, 'homologação não consome produção');

    const sw = await router.dispatch({
      method: 'PUT',
      path: '/api/erp/fiscal-settings',
      query: admin(),
      body: { nfe: { environment: 'PRODUCAO' }, confirmProductionSwitch: FISCAL_PRODUCTION_CONFIRMATION },
    });
    assert.equal(sw.status, 200);
    const p = (await create(router, draft())).body as { data: ErpFiscalInvoice };
    assert.equal(p.data.productNfe!.environment, 'PRODUCAO');
    assert.equal(p.data.productNfe!.nNF, 2177);
    assert.equal(p.data.documentNumber, 'NF-e 2177 - série 1');
    const xml = p.data.productNfe!.xmlContent;
    assert.ok(xml.includes('<tpAmb>1</tpAmb>'));
    assert.ok(xml.includes('<nNF>2177</nNF>'));
    assert.ok(xml.includes('<xNome>CLIENTE TESTE &amp; FILHOS &lt;LTDA&gt;</xNome>'), 'produção usa o nome real, escapado');
    assert.equal(p.data.status, 'RASCUNHO');
    assert.equal(repo.peekNextFiscalNumber('55', '1', 'PRODUCAO'), 2178);
  });

  it('número informado já usado no ambiente => 409 com o próximo disponível', async () => {
    const { router } = setup();
    const first = (await create(router, draft())).body as { data: ErpFiscalInvoice };
    const n = first.data.productNfe!.nNF;
    const d = draft();
    (d.general as Record<string, unknown>).number = n;
    const r = await create(router, d);
    assert.equal(r.status, 409);
    assert.equal((r.body as { code: string; nextAvailable: number }).code, 'PRODUCT_NFE_NUMBER_IN_USE');
    assert.equal((r.body as { nextAvailable: number }).nextAvailable, n + 1);
  });
});

describe('NF-e de produtos — validação e permissão', () => {
  it('400 (zod) para CNPJ com DV inválido, sem itens, campo desconhecido e NCM inválido', async () => {
    const { router } = setup();
    const badDoc = draft();
    (badDoc.recipient as Record<string, unknown>).document = '11.222.333/0001-82';
    const r1 = await create(router, badDoc);
    assert.equal(r1.status, 400);
    assert.equal((r1.body as { code: string }).code, 'PRODUCT_NFE_INVALID_INPUT');
    assert.match((r1.body as { error: string }).error, /CNPJ do destinatário inválido/);

    assert.equal((await create(router, draft({ items: [] }))).status, 400);
    assert.equal((await create(router, { ...draft(), hacker: true })).status, 400);
    const badNcm = draft();
    (badNcm.items as Array<Record<string, unknown>>)[0].ncm = '8517';
    assert.equal((await create(router, badNcm)).status, 400);
    const noIe = draft();
    (noIe.recipient as Record<string, unknown>).ie = '';
    assert.match(((await create(router, noIe)).body as { error: string }).error, /inscrição estadual/);
    assert.equal(isValidCpfDv('529.982.247-25'), true);
    assert.equal(isValidCpfDv('529.982.247-24'), false);
    assert.equal(isValidCnpjDv('11.222.333/0001-81'), true);
  });

  it('403 sem canIssueFiscalDocuments (auditado) e 401 sem sessão; nada é gravado', async () => {
    const { repo, router } = setup();
    const before = repo.getErpOverview().invoices.length;
    const r = await create(router, draft(), auditor());
    assert.equal(r.status, 403);
    assert.equal((r.body as { code: string }).code, 'ERP_FISCAL_ISSUANCE_FORBIDDEN');
    const logs = repo.listSecurityAuditLogs(20).logs as Array<{ action: string; actorEmail: string }>;
    assert.ok(logs.some((l) => l.action === 'ERP_FISCAL_ISSUANCE_DENIED' && l.actorEmail === 'auditoria@setatelecom.com.br'));
    const noSess = await router.dispatch({ method: 'POST', path: PATH, body: draft() });
    assert.equal(noSess.status, 401);
    // sessão no corpo não vale
    const inBody = await router.dispatch({ method: 'POST', path: PATH, body: { ...draft(), _sessionToken: admin()._sessionToken } });
    assert.ok(inBody.status === 401 || inBody.status === 400);
    assert.equal(repo.getErpOverview().invoices.length, before);
    assert.equal((await router.dispatch({ method: 'GET', path: `${PATH}/context` })).status, 401);
  });

  it('exclusão: só rascunho; 403 sem alçada; 409 para nota não-rascunho', async () => {
    const { repo, router } = setup();
    const inv = ((await create(router, draft())).body as { data: ErpFiscalInvoice }).data;
    assert.equal((await router.dispatch({ method: 'DELETE', path: `${PATH}/${inv.id}`, query: auditor() })).status, 403);
    const issued = repo.getErpOverview().invoices.find((i) => i.status !== 'RASCUNHO')!;
    assert.equal((await router.dispatch({ method: 'DELETE', path: `${PATH}/${issued.id}`, query: admin() })).status, 404, 'nota que não é NF-e de produtos do ERP');
    const raw = repo.getErpOverview().invoices.find((i) => i.id === inv.id)!;
    raw.status = 'EMITIDA';
    // simula nota emitida (status alterado no estado em memória)
    const erp = repo.getErpState();
    const target = erp.invoices.find((i) => i.id === inv.id)!;
    target.status = 'EMITIDA';
    assert.equal((await router.dispatch({ method: 'DELETE', path: `${PATH}/${inv.id}`, query: admin() })).status, 409);
    target.status = 'RASCUNHO';
    assert.equal((await router.dispatch({ method: 'DELETE', path: `${PATH}/${inv.id}`, query: admin() })).status, 200);
    assert.equal(repo.getErpOverview().invoices.some((i) => i.id === inv.id), false);
  });
});

describe('NF-e de produtos — totais (erp-tax-engine) e regime configurado', () => {
  it('regime normal (CST 00): ICMS/PIS/COFINS do erp-tax-engine; vNF = produtos − desconto + frete', () => {
    const t = computeProductNfeTotals(
      {
        items: [
          { quantity: 2, unitValue: 150.5, icmsCode: '00' },
          { quantity: 1, unitValue: 899, icmsCode: '00' },
        ],
        transport: { freightValue: 50 },
        totals: { discountValue: 100 },
      },
      'LUCRO_PRESUMIDO'
    );
    assert.equal(t.crt, '3');
    assert.equal(t.vProd, 1200);
    assert.equal(t.vNF, 1150);
    assert.equal(t.vBC, 1150);
    const engine = calculateBrazilianTaxBreakdown({ grossAmount: 1250, discountAmount: 100, documentType: 'NFE_VENDA_PRODUTO', taxRegime: 'LUCRO_PRESUMIDO' });
    assert.ok(Math.abs(t.vICMS - engine.icmsAmount) <= 0.02);
    assert.ok(Math.abs(t.vPIS - engine.pisAmount) <= 0.02);
    assert.ok(Math.abs(t.vCOFINS - engine.cofinsAmount) <= 0.02);
    assert.equal(t.items.reduce((s, i) => Math.round((s + i.vDesc) * 100) / 100, 0), 100, 'rateio do desconto fecha');
  });

  it('Simples Nacional (CSOSN 102): sem destaque de ICMS/PIS/COFINS; "Ajustar total" vira desconto/outras despesas', () => {
    const items = [{ quantity: 3, unitValue: 100, icmsCode: suggestIcmsCode('SIMPLES_NACIONAL') }];
    const t = computeProductNfeTotals({ items }, 'SIMPLES_NACIONAL');
    assert.equal(t.crt, '1');
    assert.equal(items[0].icmsCode, '102');
    assert.equal(t.vICMS, 0);
    assert.equal(t.vBC, 0);
    assert.equal(t.vPIS, 0);
    assert.ok(t.vTotTrib > 0, 'tributos aproximados estimados pelo motor');
    const down = computeProductNfeTotals({ items, totals: { adjustedTotal: 280 } }, 'SIMPLES_NACIONAL');
    assert.equal(down.vNF, 280);
    assert.equal(down.vDesc, 20);
    const up = computeProductNfeTotals({ items, totals: { adjustedTotal: 310 } }, 'SIMPLES_NACIONAL');
    assert.equal(up.vNF, 310);
    assert.equal(up.vOutro, 10);
  });

  it('usa o regime CONFIGURADO, não o altera, e avisa quando diverge das informações adicionais', async () => {
    const { repo, router } = setup();
    const cfgBefore = JSON.stringify({
      r: repo.getErpOverview().gestaoClickConfig.taxRegime,
      c: repo.getErpOverview().gestaoClickConfig.companyCnpj,
    });
    const r = await create(router, draft());
    const body = r.body as { data: ErpFiscalInvoice; warnings: string[] };
    const regime = repo.getErpOverview().gestaoClickConfig.taxRegime;
    assert.equal(body.data.productNfe!.taxRegime, regime);
    assert.ok(body.data.productNfe!.xmlContent.includes(`<CRT>${regime === 'SIMPLES_NACIONAL' ? '1' : '3'}</CRT>`));
    if (regime !== 'SIMPLES_NACIONAL') assert.ok(body.warnings.some((w) => /NÃO foi alterado/.test(w)));
    assert.equal(
      JSON.stringify({ r: repo.getErpOverview().gestaoClickConfig.taxRegime, c: repo.getErpOverview().gestaoClickConfig.companyCnpj }),
      cfgBefore
    );
    assert.ok(body.data.productNfe!.xmlContent.includes('<cMun>3550308</cMun>'));
  });
});

describe('NF-e de produtos — tela', () => {
  it('Fiscal > Notas de produtos usa a tela NF-e; ações SEFAZ desabilitadas; certificado ligado à tela própria', () => {
    const tab = fs.readFileSync(path.join(ROOT, 'src/app/components/ErpGestaoClickTab.tsx'), 'utf8');
    assert.match(tab, /<ProductNfeWorkspace/);
    const list = fs.readFileSync(path.join(ROOT, 'src/app/components/ProductNfeWorkspace.tsx'), 'utf8');
    for (const label of ['Emitir selecionadas', 'Imprimir DANFEs', 'Importar XMLs', 'Exportar XMLs', 'Cartas de correção', 'Inutilizar numeração', 'Exportar Excel', 'Certificado digital', 'Excluir notas fiscais']) {
      assert.ok(list.includes(label), label);
    }
    assert.match(list, /Disponível após integração SEFAZ|PRODUCT_NFE_SEFAZ_PENDING_HINT/);
    const form = fs.readFileSync(path.join(ROOT, 'src/app/components/ProductNfeForm.tsx'), 'utf8');
    for (const label of ['Dados gerais', 'Destinatário', 'Produtos', 'Transporte', 'Totais', 'Informações adicionais', 'Cadastrar e emitir', 'Possui NF-referenciada']) {
      assert.ok(form.includes(label), label);
    }
    const panel = fs.readFileSync(path.join(ROOT, 'src/app/components/FiscalSettingsPanel.tsx'), 'utf8');
    assert.match(panel, /\/api\/erp\/certificate/);
    assert.match(panel, /onOpenCertificate/);
    assert.equal(/Em breve/.test(panel), false);
    const router = fs.readFileSync(path.join(ROOT, 'src/api/router.ts'), 'utf8');
    assert.equal(/typeof body\._sessionToken/.test(router), false);
  });
});
