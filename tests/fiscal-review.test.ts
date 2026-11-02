// ============================================================================
// Revisão Fiscal 29/10/2026 — testes dos itens #3, #5, #6, #7, #8, #9, #10, #11, #12, #16, #17,
// #21, #22, #23, #24 e #25 (NF-e de Importação Sebrae 4.01 / Simples Nacional e motor tributário)
// ============================================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { calculateBrazilianTaxBreakdown } from '../src/modules/erp/erp-tax-engine';
import {
  buildNfeAccessKey,
  calculateSebraeImportNfe,
  computeNfeAccessKeyDv,
  decodeImportFileBytes,
  escapeXml,
  formatSaoPauloDateTime,
  ImportCnpjMismatchError,
  MAX_IMPORT_FILE_BYTES,
  parseImportFileToSebraeDraft,
  RawImportItemDraft,
  sanitizeTxtField,
  SEBRAE_REFERENCE_CASES,
} from '../src/modules/erp/sebrae-nfe-import-engine';
import { ErpImportDeclarationInfo } from '../src/db/types';

const NE000007_CNPJ = '18.456.789/0001-90'; // CNPJ presente no I18 do caso de referência NE000007

function baseDi(overrides: Partial<ErpImportDeclarationInfo> = {}): ErpImportDeclarationInfo {
  return {
    nDI: '26/1998012-3',
    dDI: '2026-10-20',
    xLocDesemb: 'VIRACOPOS - CAMPINAS',
    UFDesemb: 'SP',
    dDesemb: '2026-10-22',
    tpViaTransp: '4',
    vAFRMM: 0,
    tpIntermedio: '1',
    cExportador: 'FORTINET-US',
    currency: 'USD',
    exchangeRatePtax: 1,
    fobTotalForeign: 1000,
    freteInternacionalBrl: 0,
    seguroInternacionalBrl: 0,
    taxaSiscomexTotalBrl: 0,
    outrasDespesasAduaneirasBrl: 0,
    somarTributosEmVOutroSimples: true,
    exporterIdEstrangeiro: 'US-CA-94086-FGT',
    exporterName: 'FORTINET, INC.',
    exporterAddress: '899 Kifer Road, Sunnyvale, CA',
    exporterCountryCodeBacen: '2496',
    exporterCountryName: 'ESTADOS UNIDOS',
    additions: [{ nAdicao: '1', nSeqAdic: '1', cFabricante: 'FORTINET-US', vDescDI: 0 }],
    ...overrides,
  };
}

function baseItem(overrides: Partial<RawImportItemDraft> = {}): RawImportItemDraft {
  return {
    id: 'it-1',
    cProd: 'GC-EQ-00102',
    xProd: 'APPLIANCE FIREWALL FORTIGATE 100F',
    ncm: '85176259',
    cfop: '3.102',
    uCom: 'UN',
    qCom: 1,
    fobUnitForeign: 1000,
    iiRatePercent: 12,
    ipiRatePercent: 5,
    pisRatePercent: 2.1,
    cofinsRatePercent: 9.65,
    icmsRatePercent: 18,
    icmsReductionPercent: 0,
    nAdicao: '1',
    nSeqAdic: '1',
    cFabricante: 'FORTINET-US',
    ...overrides,
  };
}

function adminQuery() {
  return { _sessionToken: sessionFor('usr-seta-01', 'marcelo.mira@setatelecom.com.br', 'SUPER_ADMIN') };
}

function emitBody(overrides: Record<string, unknown> = {}) {
  return {
    serie: '1',
    natOp: 'IMPORTACAO DE MERCADORIA PARA COMERCIALIZACAO',
    crt: '1',
    di: baseDi({ exchangeRatePtax: 5.5, freteInternacionalBrl: 1000, seguroInternacionalBrl: 200 }),
    rawItems: [baseItem({ qCom: 2 })],
    ...overrides,
  };
}

function sessionFor(uid: string, email: string, roleId: string) {
  const iat = Date.now();
  return signStiHubSessionToken({
    uid,
    email,
    name: 'Teste Fiscal',
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

function isValidAccessKey(key: string): boolean {
  return /^\d{44}$/.test(key) && computeNfeAccessKeyDv(key.slice(0, 43)) === key[43];
}

describe('Revisão Fiscal #3 / #21 — TXT Sebrae NE000007 (frete x seguro e valores da DI preservados)', () => {
  it('lê frete 800 e seguro 200 após o realinhamento do CFOP e preserva BC ICMS 21.924,76 do arquivo', () => {
    const draft = parseImportFileToSebraeDraft(SEBRAE_REFERENCE_CASES.NE000007.txt, 'NE000007.txt', {
      emitterCnpj: NE000007_CNPJ,
    });
    const t = draft.computedMeta.totals;
    assert.equal(draft.di.freteInternacionalBrl, 800);
    assert.equal(draft.di.seguroInternacionalBrl, 200);
    assert.equal(t.vProd, 15000);
    assert.equal(t.vFrete, 800);
    assert.equal(t.vSeg, 200);
    assert.equal(t.vAduaneiro, 16000);
    assert.equal(t.vII, 1920);
    assert.equal(t.vIPI, 896);
    assert.equal(t.vPIS, 336);
    assert.equal(t.vCOFINS, 1544);
    assert.equal(t.vBC_ICMS, 21924.76);
    assert.equal(t.vICMS, 3946.46);
    assert.equal(t.vOutro, 5924.76);
    assert.equal(t.vNF, 24740.76); // = W02 vNF do arquivo
    assert.equal(draft.computedMeta.items[0].declaredValuesApplied, true);
  });

  it('se o usuário alterar a quantidade, os valores declarados deixam de valer e o item é recalculado', () => {
    const draft = parseImportFileToSebraeDraft(SEBRAE_REFERENCE_CASES.NE000007.txt, 'NE000007.txt', {
      emitterCnpj: NE000007_CNPJ,
    });
    const edited = draft.rawItems.map((it) => ({ ...it, qCom: 10 }));
    const meta = calculateSebraeImportNfe({ ...draft, rawItems: edited, emitterCnpj: NE000007_CNPJ });
    assert.equal(meta.items[0].declaredValuesApplied, undefined);
    assert.equal(meta.totals.vProd, 7500);
  });
});

describe('Revisão Fiscal #21 / #16 — ICMS por dentro (caso controlado)', () => {
  it('VA 1000, II 120, IPI 56, PIS 21, COFINS 96,50 => BC 1.577,44 e ICMS 283,94', () => {
    const meta = calculateSebraeImportNfe({
      serie: '1',
      nNF: '50',
      natOp: 'IMPORTACAO',
      di: baseDi(),
      rawItems: [baseItem()],
    });
    const it = meta.items[0];
    assert.equal(it.valorAduaneiroBrl, 1000);
    assert.equal(it.iiAmountBrl, 120);
    assert.equal(it.ipiAmountBrl, 56);
    assert.equal(it.pisAmountBrl, 21);
    assert.equal(it.cofinsAmountBrl, 96.5);
    assert.equal(meta.totals.vBC_ICMS, 1577.44);
    assert.equal(meta.totals.vICMS, 283.94);

    // #16: o motor tributário usa os valores congelados (não mais 18% "por fora" = 180)
    const tax = calculateBrazilianTaxBreakdown({
      grossAmount: meta.totals.vNF,
      documentType: 'NFE_IMPORTACAO',
      importMetadata: meta,
    });
    assert.equal(tax.icmsAmount, 283.94);
    assert.equal(tax.pisAmount, 21);
    assert.equal(tax.cofinsAmount, 96.5);
    assert.equal(tax.netReceivableAmount, meta.totals.vNF);
  });

  it('PATCH na NF-e de importação não recalcula nem corrompe os tributos (#16)', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const res = await router.dispatch({ query: adminQuery(),
      method: 'POST',
      path: '/api/erp/nfe-importacao/emit',
      body: emitBody({ di: baseDi(), rawItems: [baseItem()] }),
    });
    assert.equal(res.status, 201);
    const created = (res.body as { data: { id: string; grossAmount: number; taxBreakdown: { icmsAmount: number } } }).data;
    assert.equal(created.taxBreakdown.icmsAmount, 283.94);
    const patched = repo.updateInvoice(created.id, { grossAmount: 1, notesField: 'x' } as never);
    assert.ok(patched);
    assert.equal(patched!.grossAmount, created.grossAmount);
    assert.equal(patched!.taxBreakdown.icmsAmount, 283.94);
  });
});

describe('Revisão Fiscal #17 — rateio e casas decimais', () => {
  it('rateio de frete 100 entre 3 itens iguais fecha em 100 com o resíduo no último item', () => {
    const items = [1, 2, 3].map((n) => baseItem({ id: `it-${n}`, cProd: `SKU-${n}`, fobUnitForeign: 100 }));
    const meta = calculateSebraeImportNfe({
      serie: '1',
      nNF: '51',
      natOp: 'IMPORTACAO',
      di: baseDi({ freteInternacionalBrl: 100, seguroInternacionalBrl: 10 }),
      rawItems: items,
    });
    assert.deepEqual(meta.items.map((i) => i.vFreteShareBrl), [33.33, 33.33, 33.34]);
    assert.equal(meta.totals.vFrete, 100);
    assert.equal(meta.totals.vSeg, 10);
  });

  it('vUnCom com 10 casas decimais no XML e no TXT', () => {
    const meta = calculateSebraeImportNfe({
      serie: '1',
      nNF: '52',
      natOp: 'IMPORTACAO',
      di: baseDi({ exchangeRatePtax: 5.4321 }),
      rawItems: [baseItem({ fobUnitForeign: 1.23456789, qCom: 1000 })],
    });
    assert.equal(meta.items[0].vUnComBrl, 6.7062962353);
    assert.ok(meta.sefazXmlContent!.includes('<vUnCom>6.7062962353</vUnCom>'));
    assert.ok(meta.sebraeTxtContent!.includes('|6.7062962353|'));
    assert.equal(meta.items[0].vProdBrl, 6706.3);
  });
});

describe('Revisão Fiscal #6 — chave de acesso, data/hora e rótulo de rascunho', () => {
  it('monta chave de 44 dígitos com DV módulo 11 (AAMM, série, nNF, cNF aleatório)', () => {
    const { key, dv } = buildNfeAccessKey({
      cUF: '35',
      aamm: '2610',
      cnpj: '14.806.925/0001-32',
      mod: '55',
      serie: '1',
      nNF: '15',
      tpEmis: '1',
      cNF: '48213907',
    });
    assert.equal(key.length, 44);
    assert.equal(key.slice(0, 43), '3526101480692500013255001000000015148213907');
    assert.equal(dv, computeNfeAccessKeyDv(key.slice(0, 43)));
    assert.ok(isValidAccessKey(key));

    const issuedAt = new Date('2026-10-30T01:40:00.000Z'); // 22h40 de 29/10 em São Paulo
    const meta1 = calculateSebraeImportNfe({ serie: '2', nNF: '777', natOp: 'IMP', di: baseDi(), rawItems: [baseItem()], emitterCnpj: '14.806.925/0001-32', issuedAt });
    const meta2 = calculateSebraeImportNfe({ serie: '2', nNF: '777', natOp: 'IMP', di: baseDi(), rawItems: [baseItem()], emitterCnpj: '14.806.925/0001-32', issuedAt });
    assert.ok(isValidAccessKey(meta1.accessKey!));
    assert.equal(meta1.accessKey!.slice(2, 6), '2610');
    assert.equal(meta1.accessKey!.slice(6, 20), '14806925000132');
    assert.equal(meta1.accessKey!.slice(22, 25), '002');
    assert.equal(meta1.accessKey!.slice(25, 34), '000000777');
    assert.equal(meta1.accessKey!.slice(35, 43), meta1.cNF);
    assert.notEqual(meta1.cNF, '01020100');
    assert.notEqual(meta1.cNF, meta2.cNF, 'cNF deve ser aleatório');
    assert.equal(meta1.dhEmi, '2026-10-29T22:40:00-03:00');
    assert.ok(meta1.sefazXmlContent!.includes(`<infNFe Id="NFe${meta1.accessKey}"`));
    assert.ok(meta1.sefazXmlContent!.includes(`<cDV>${meta1.accessKey![43]}</cDV>`));
    assert.ok(meta1.sefazXmlContent!.includes('<dhEmi>2026-10-29T22:40:00-03:00</dhEmi>'));
    assert.ok(meta1.sebraeTxtContent!.includes(`A|4.00|NFe${meta1.accessKey}|`));
  });

  it('XML é rotulado como rascunho não autorizado (sem nfeProc / protNFe)', () => {
    const meta = calculateSebraeImportNfe({ serie: '1', nNF: '53', natOp: 'IMP', di: baseDi(), rawItems: [baseItem()] });
    assert.equal(meta.documentStatus, 'RASCUNHO_NAO_AUTORIZADO');
    assert.ok(!meta.sefazXmlContent!.includes('nfeProc'));
    assert.ok(!meta.sefazXmlContent!.includes('protNFe'));
    assert.ok(meta.sefazXmlContent!.includes('RASCUNHO NAO AUTORIZADO'));
  });

  it('formatSaoPauloDateTime usa o fuso America/Sao_Paulo (não UTC com sufixo -03:00)', () => {
    assert.equal(formatSaoPauloDateTime(new Date('2026-01-01T02:30:00Z')).dhEmi, '2025-12-31T23:30:00-03:00');
    assert.equal(formatSaoPauloDateTime(new Date('2026-01-01T02:30:00Z')).aamm, '2512');
  });
});

describe('Revisão Fiscal #9 — injeção no XML/TXT gerado', () => {
  it('escapa & < > " \' no XML e remove | e quebras de linha no TXT', () => {
    const evil = 'ROTEADOR <script>alert("x")</script> & CIA \'X\' |I|FAKE\nW02|0';
    const meta = calculateSebraeImportNfe({
      serie: '1',
      nNF: '54',
      natOp: 'IMPORTACAO | TESTE\nZ|',
      di: baseDi({ exporterName: 'ACME <b>&</b> "LTDA"' }),
      rawItems: [baseItem({ xProd: evil })],
    });
    const xml = meta.sefazXmlContent!;
    assert.ok(!xml.includes('<script>'));
    assert.ok(xml.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; CIA &apos;X&apos;'));
    assert.ok(xml.includes('<xNome>ACME &lt;b&gt;&amp;&lt;/b&gt; &quot;LTDA&quot;</xNome>'));
    const txtLines = meta.sebraeTxtContent!.split('\n');
    const iLine = txtLines.find((l) => l.startsWith('I|'))!;
    assert.equal(iLine.split('|').length, 25, 'o registro I não pode ganhar colunas extras');
    assert.equal(txtLines.filter((l) => l.startsWith('W02|')).length, 1, 'nenhum registro W02 injetado');
    assert.ok(!txtLines.some((l) => l.startsWith('Z|') && l.includes('TESTE')), 'natOp não injeta registro Z');
    assert.equal(sanitizeTxtField('A|B\r\nC', 60), 'A B C');
    assert.equal(sanitizeTxtField('X'.repeat(200), 120).length, 120);
    assert.equal(escapeXml(`<&>"'`), '&lt;&amp;&gt;&quot;&apos;');
  });
});

describe('Revisão Fiscal #8 / #23 — parser XML seguro, XML malicioso e XML grande', () => {
  it('bloqueia DOCTYPE/ENTITY (XXE e billion laughs) e XML malformado', () => {
    const lol = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]><NFe><infNFe>&lol2;</infNFe></NFe>';
    assert.throws(() => parseImportFileToSebraeDraft(lol, 'lol.xml'), /DOCTYPE|ENTITY/);
    assert.throws(() => parseImportFileToSebraeDraft('<NFe><infNFe><det></infNFe>', 'bad.xml'), /XML malformado/);
  });

  it('rejeita arquivo acima de 2 MB (413 na rota) e processa XML grande válido em tempo linear', async () => {
    const huge = '<NFe>' + ' '.repeat(MAX_IMPORT_FILE_BYTES + 10) + '</NFe>';
    const router = new CrmApiRouter(createInMemoryRepository());
    const res = await router.dispatch({ query: adminQuery(),
      method: 'POST',
      path: '/api/erp/nfe-importacao/parse-file',
      body: { filename: 'grande.xml', content: huge },
    });
    assert.equal(res.status, 413);

    const meta = calculateSebraeImportNfe({
      serie: '1',
      nNF: '60',
      natOp: 'IMP',
      di: baseDi(),
      rawItems: Array.from({ length: 400 }, (_, i) => baseItem({ id: `x${i}`, cProd: `SKU-${i}`, xProd: `ITEM GRANDE ${i} ${'D'.repeat(80)}` })),
      emitterCnpj: '14.806.925/0001-32',
    });
    const bigXml = meta.sefazXmlContent!;
    assert.ok(bigXml.length > 400_000, `XML de teste deve ter mais de 400 KB (tem ${bigXml.length})`);
    const t0 = Date.now();
    const draft = parseImportFileToSebraeDraft(bigXml, 'grande.xml', { emitterCnpj: '14.806.925/0001-32' });
    const elapsed = Date.now() - t0;
    assert.equal(draft.rawItems.length, 400);
    assert.ok(elapsed < 3000, `parse de XML de ${(bigXml.length / 1024).toFixed(0)} KB levou ${elapsed} ms`);
  });

  it('tag exata: <PIS> não casa com <PISOutr> e entidades predefinidas são decodificadas', () => {
    const meta = calculateSebraeImportNfe({
      serie: '1',
      nNF: '61',
      natOp: 'IMP',
      di: baseDi({ exporterName: 'AT&T GLOBAL' }),
      rawItems: [baseItem({ xProd: 'CABO "CAT6" <BLINDADO> & CONECTOR' })],
      emitterCnpj: '14.806.925/0001-32',
    });
    const draft = parseImportFileToSebraeDraft(meta.sefazXmlContent!, 'nota.xml', { emitterCnpj: '14.806.925/0001-32' });
    assert.equal(draft.rawItems[0].xProd, 'CABO "CAT6" <BLINDADO> & CONECTOR');
    assert.equal(draft.di.exporterName, 'AT&T GLOBAL');
    assert.equal(draft.rawItems[0].pisRatePercent, 2.1);
    assert.equal(draft.rawItems[0].cstPisCofins, '70');
    assert.equal(draft.computedMeta.totals.vICMS, meta.totals.vICMS);
  });
});

describe('Revisão Fiscal #5 — trava de CNPJ na importação', () => {
  it('TXT/XML de outro CNPJ => erro de trava; mesmo CNPJ completo => aceito', () => {
    assert.throws(
      () => parseImportFileToSebraeDraft(SEBRAE_REFERENCE_CASES.NE000007.txt, 'NE000007.txt', { emitterCnpj: '14.806.925/0001-32' }),
      (err: unknown) => err instanceof ImportCnpjMismatchError && err.fileCnpj === '18456789000190'
    );
    const meta = calculateSebraeImportNfe({ serie: '1', nNF: '62', natOp: 'IMP', di: baseDi(), rawItems: [baseItem()], emitterCnpj: '11.222.333/0001-81' });
    assert.throws(
      () => parseImportFileToSebraeDraft(meta.sefazXmlContent!, 'outro.xml', { emitterCnpj: '14.806.925/0001-32' }),
      ImportCnpjMismatchError
    );
    // mesma raiz, filial diferente => bloqueado (comparação do CNPJ completo)
    const filial = calculateSebraeImportNfe({ serie: '1', nNF: '63', natOp: 'IMP', di: baseDi(), rawItems: [baseItem()], emitterCnpj: '14.806.925/0002-13' });
    assert.throws(
      () => parseImportFileToSebraeDraft(filial.sebraeTxtContent!, 'filial.txt', { emitterCnpj: '14.806.925/0001-32' }),
      ImportCnpjMismatchError
    );
    const ok = parseImportFileToSebraeDraft(SEBRAE_REFERENCE_CASES.NE000007.txt, 'NE000007.txt', { emitterCnpj: NE000007_CNPJ });
    assert.ok(ok.fileCnpjs.some((c) => c.cnpj === '18456789000190'));
  });

  it('rota parse-file devolve 409 e registra auditoria; emit grava companyCnpj vazio e idEstrangeiro separado', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const configured = repo.getErpOverview().gestaoClickConfig.companyCnpj;
    const res = await router.dispatch({ query: adminQuery(),
      method: 'POST',
      path: '/api/erp/nfe-importacao/parse-file',
      body: { filename: 'NE000007.txt', content: SEBRAE_REFERENCE_CASES.NE000007.txt },
    });
    assert.equal(res.status, 409);
    const body = res.body as { code: string; configuredCnpj: string; fileCnpj: string };
    assert.equal(body.code, 'IMPORT_CNPJ_MISMATCH');
    assert.equal(body.configuredCnpj, configured, 'o CNPJ configurado não é alterado');
    assert.equal(body.fileCnpj, '18456789000190');
    const logs = repo.listSecurityAuditLogs(20).logs as Array<{ action: string; status: string }>;
    assert.ok(logs.some((l) => l.action === 'NFE_IMPORT_CNPJ_MISMATCH_BLOCKED' && l.status === 'BLOCKED'));
    assert.equal(repo.getErpOverview().gestaoClickConfig.companyCnpj, configured);

    const emitRes = await router.dispatch({ query: adminQuery(), method: 'POST', path: '/api/erp/nfe-importacao/emit', body: emitBody() });
    assert.equal(emitRes.status, 201);
    const inv = (emitRes.body as { data: { companyCnpj: string; counterpartyForeignId: string } }).data;
    assert.equal(inv.companyCnpj, '');
    assert.equal(inv.counterpartyForeignId, 'US-CA-94086-FGT');
  });
});

describe('Revisão Fiscal #7 — permissão canIssueFiscalDocuments nas rotas de importação', () => {
  it('usuário sem alçada fiscal => 403 em /emit, /calculate e /parse-file; administrador => permitido', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const auditor = sessionFor('usr-seta-22', 'auditoria@setatelecom.com.br', 'FISCAL_CONTABIL');
    for (const p of ['/api/erp/nfe-importacao/emit', '/api/erp/nfe-importacao/calculate', '/api/erp/nfe-importacao/parse-file']) {
      const res = await router.dispatch({
        method: 'POST',
        path: p,
        query: { _sessionToken: auditor },
        body: p.endsWith('parse-file') ? { filename: 'a.txt', content: SEBRAE_REFERENCE_CASES.NE000007.txt } : emitBody(),
      });
      assert.equal(res.status, 403, `${p} deve exigir canIssueFiscalDocuments`);
      assert.equal((res.body as { code: string }).code, 'ERP_FISCAL_ISSUANCE_FORBIDDEN');
    }
    const admin = sessionFor('usr-seta-01', 'marcelo.mira@setatelecom.com.br', 'SUPER_ADMIN');
    const ok = await router.dispatch({
      method: 'POST',
      path: '/api/erp/nfe-importacao/calculate',
      query: { _sessionToken: admin },
      body: emitBody(),
    });
    assert.equal(ok.status, 200);
  });
});

describe('Revisão Fiscal #10 / #11 — validação de entrada, numerador e status da nota de entrada', () => {
  it('entradas inválidas => 400 (sem di, PTAX ausente, valor negativo, alíquota inválida)', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    const cases: Array<Record<string, unknown>> = [
      { serie: '1', rawItems: [baseItem()] },
      emitBody({ di: { ...baseDi(), exchangeRatePtax: undefined } }),
      emitBody({ di: baseDi({ exchangeRatePtax: 0 }) }),
      emitBody({ rawItems: [baseItem({ qCom: -1 })] }),
      emitBody({ rawItems: [baseItem({ fobUnitForeign: -10 })] }),
      emitBody({ rawItems: [baseItem({ iiRatePercent: 'abc' as unknown as number })] }),
      emitBody({ rawItems: [baseItem({ icmsRatePercent: 150 })] }),
      emitBody({ rawItems: [] }),
    ];
    for (const body of cases) {
      for (const p of ['/api/erp/nfe-importacao/calculate', '/api/erp/nfe-importacao/emit']) {
        const res = await router.dispatch({ query: adminQuery(), method: 'POST', path: p, body });
        assert.equal(res.status, 400, `${p} com ${JSON.stringify(body).slice(0, 120)}`);
      }
    }
    assert.throws(
      () => calculateSebraeImportNfe({ serie: '1', nNF: '1', natOp: 'X', di: { ...baseDi(), exchangeRatePtax: 0 }, rawItems: [baseItem()] }),
      /PTAX/
    );
  });

  it('numerador atômico por série: números sequenciais sem repetição e 409 para número já usado', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const r1 = await router.dispatch({ query: adminQuery(), method: 'POST', path: '/api/erp/nfe-importacao/emit', body: emitBody() });
    const r2 = await router.dispatch({ query: adminQuery(), method: 'POST', path: '/api/erp/nfe-importacao/emit', body: emitBody() });
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 201);
    const n1 = Number((r1.body as { importMetadata: { nNF: string } }).importMetadata.nNF);
    const n2 = Number((r2.body as { importMetadata: { nNF: string } }).importMetadata.nNF);
    assert.ok(n1 > 12, 'não reaproveita o nNF 12 do exemplo já emitido');
    assert.equal(n2, n1 + 1);
    const dup = await router.dispatch({ query: adminQuery(), method: 'POST', path: '/api/erp/nfe-importacao/emit', body: emitBody({ nNF: String(n1) }) });
    assert.equal(dup.status, 409);
    assert.equal((dup.body as { nextAvailable: number }).nextAvailable, n2 + 1);
    const serie2 = await router.dispatch({ query: adminQuery(), method: 'POST', path: '/api/erp/nfe-importacao/emit', body: emitBody({ serie: '2' }) });
    assert.equal((serie2.body as { importMetadata: { nNF: string } }).importMetadata.nNF, '1');

    const inv = (r1.body as { data: { status: string; paymentMethod: string; paidAt: string | null; verificationCodeOrKey: string } }).data;
    assert.equal(inv.status, 'ENTRADA_REGISTRADA');
    assert.equal(inv.paymentMethod, 'NAO_APLICAVEL');
    assert.equal(inv.paidAt, null);
    assert.ok(isValidAccessKey(inv.verificationCodeOrKey.replace(/\s/g, '')));
  });
});

describe('Revisão Fiscal #12 — NF-e de retorno de locação (entrada CFOP 1.909 / 2.909)', () => {
  it('gera NFE_RETORNO_LOCACAO pelo mesmo valor da remessa, sem piso de R$ 100 e sem status PAGA', () => {
    const repo = createInMemoryRepository();
    const before = repo.listRentalContracts().find((c) => c.id === 'ctr-loc-101')!;
    const eq = before.equipments[2];
    const unitAsset = eq.quantity > 0 ? Number(eq.assetValueBrl || 0) / eq.quantity : 0;
    const result = repo.applyPartialEquipmentReturn('ctr-loc-101', {
      returnDate: '2026-10-25',
      cycleDaysUsed: 15,
      itemsToReturn: [{ equipmentIdx: 2, quantityReturned: 1 }],
      emitReturnNfe: true,
      emitProRataInvoice: false,
    });
    assert.ok(result?.returnNfe);
    const nfe = result!.returnNfe!;
    assert.equal(nfe.documentType, 'NFE_RETORNO_LOCACAO');
    assert.ok(nfe.cfop!.startsWith('1.909'));
    assert.equal(nfe.status, 'ENTRADA_REGISTRADA');
    assert.equal(nfe.paidAt, null);
    assert.equal(nfe.grossAmount, Math.round(unitAsset * 100) / 100);
    assert.equal(nfe.itemsDescription[0].unitValue, Math.round(unitAsset * 100) / 100);
    assert.equal(result!.returnEntry.returnedItems[0].returnNfeCfop, '1.909');
    const tax = calculateBrazilianTaxBreakdown({ grossAmount: 50, documentType: 'NFE_RETORNO_LOCACAO' });
    assert.equal(tax.netReceivableAmount, 50);
    assert.equal(tax.totalTaxesEstimated, 0);
  });
});

describe('Revisão Fiscal #21 / #24 — NFS-e no Simples, retenção de R$ 10 e texto da fatura de locação', () => {
  it('NFS-e de empresa do Simples Nacional não sofre retenção de IRRF nem de CSRF', () => {
    const tax = calculateBrazilianTaxBreakdown({ grossAmount: 10000, documentType: 'NFSE_SERVICO', taxRegime: 'SIMPLES_NACIONAL' });
    assert.equal(tax.irrfWithheldAmount, 0);
    assert.equal(tax.csrfWithheldAmount, 0);
    assert.equal(tax.totalWithheld, 0);
    assert.equal(tax.netReceivableAmount, 10000);
  });

  it(
    'IRRF de exatamente R$ 10,00 é dispensado (Lei 9.430/96, art. 67: retenção <= R$ 10)',
    { todo: 'depende do item #13 (erp-tax-engine usa ">= 10"), fora do escopo desta correção' },
    () => {
      const tax = calculateBrazilianTaxBreakdown({ grossAmount: 666.67, documentType: 'NFSE_SERVICO', taxRegime: 'LUCRO_PRESUMIDO' });
      assert.equal(Math.round(666.67 * 0.015 * 100) / 100, 10);
      assert.equal(tax.irrfWithheldAmount, 0);
    }
  );

  it('fatura de locação cita o fundamento correto (art. 30 da Lei 10.833, veto ao item 3.01 e SV 31)', () => {
    const tax = calculateBrazilianTaxBreakdown({ grossAmount: 1000, documentType: 'FATURA_LOCACAO' });
    assert.ok(!tax.legalExemptionNotice.includes('1.234'));
    assert.ok(!tax.legalExemptionNotice.includes('8.846'));
    assert.ok(tax.legalExemptionNotice.includes('art. 30 da Lei nº 10.833/2003'));
    assert.ok(tax.legalExemptionNotice.includes('item 3.01'));
    assert.ok(tax.legalExemptionNotice.includes('Súmula Vinculante nº 31'));
  });
});

describe('Revisão Fiscal #25 — codificação do TXT', () => {
  it('detecta ISO-8859-1 / Windows-1252 e UTF-8', () => {
    const latin1 = Uint8Array.from(Buffer.from('Z||IMPORTAÇÃO DE MERCADORIA - SÃO PAULO|', 'latin1'));
    const r1 = decodeImportFileBytes(latin1);
    assert.equal(r1.encoding, 'windows-1252');
    assert.ok(r1.text.includes('IMPORTAÇÃO') && r1.text.includes('SÃO PAULO'));
    const utf8 = Uint8Array.from(Buffer.from('\uFEFFZ||IMPORTAÇÃO|', 'utf8'));
    const r2 = decodeImportFileBytes(utf8);
    assert.equal(r2.encoding, 'utf-8');
    assert.equal(r2.text, 'Z||IMPORTAÇÃO|');
    const xmlLatin = Uint8Array.from(Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><a>Ç</a>', 'latin1'));
    assert.equal(decodeImportFileBytes(xmlLatin).text.endsWith('<a>Ç</a>'), true);
  });
});

describe('Revisão Fiscal #22 — sem abas duplicadas nem contadores no topo do Fiscal', () => {
  it('ErpGestaoClickTab não tem barra de sub-abas com (N) e usa o mesmo id FIS_TODAS da sidebar', () => {
    const root = path.resolve(__dirname, '..', '..');
    const tab = fs.readFileSync(path.join(root, 'src/app/components/ErpGestaoClickTab.tsx'), 'utf8');
    const ws = fs.readFileSync(path.join(root, 'src/app/components/SebraeImportNfeWorkspace.tsx'), 'utf8');
    const sidebar = fs.readFileSync(path.join(root, 'src/app/components/GestaoClickSidebar.tsx'), 'utf8');
    assert.ok(!tab.includes('Todos os Documentos ('));
    assert.ok(!/Notas de Produtos \(\$\{/.test(tab));
    assert.ok(!tab.includes('FIS_TODOS'));
    assert.ok(sidebar.includes('FIS_TODAS'));
    assert.ok(!ws.includes('Produtos & Impostos CSOSN 900 (${'));
  });
});
