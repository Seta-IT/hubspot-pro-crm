// ============================================================================
// Configurações Fiscais (02/11/2026): padrão homologação, 403 ao trocar para produção sem
// permissão, CSC mascarado e numeração separada por ambiente (integrada ao numerador do #11).
// ============================================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { ErpImportDeclarationInfo } from '../src/db/types';
import { RawImportItemDraft } from '../src/modules/erp/sebrae-nfe-import-engine';
import { maskCsc, normalizeCpfOrCnpj, FISCAL_PRODUCTION_CONFIRMATION } from '../src/modules/erp/fiscal-settings';

const ROOT = path.resolve(__dirname, '..', '..');
const PATH = '/api/erp/fiscal-settings';
const CSC = 'ABCDEF1234567890XYZ9';

function sessionFor(uid: string, email: string, roleId: string) {
  const iat = Date.now();
  return signStiHubSessionToken({
    uid,
    email,
    name: 'Teste Config Fiscal',
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
// Auditoria/contabilidade (FISCAL_CONTABIL): sem canIssueFiscalDocuments e sem admin
const auditor = () => ({ _sessionToken: sessionFor('usr-seta-22', 'auditoria@setatelecom.com.br', 'FISCAL_CONTABIL') });

function setup() {
  const repo = createInMemoryRepository();
  return { repo, router: new CrmApiRouter(repo) };
}

type View = {
  nfe: { environment: string; serie: string; additionalInfo: string; numbering: { next: Record<string, number>; lastIssued: Record<string, number> } };
  nfce: { environment: string; serie: string; tokenId: string; cscConfigured: boolean; cscMasked: string; csc?: string; numbering: { next: Record<string, number>; lastIssued: Record<string, number> } };
  nfse: { environment: string; rpsSerie: string; standard: string; operationNature: string; specialRegime: string; numbering: { next: Record<string, number>; lastIssued: Record<string, number> } };
  xmlDownloadAuthorizations: Array<{ document: string; type: string }>;
  certificate: { status: string; uploadEnabled: boolean };
  emitter: { companyCnpj: string; taxRegime: string; taxRegimeNote: string; readOnly: boolean };
  productionWarning: string;
};

async function getView(router: CrmApiRouter): Promise<View> {
  const r = await router.dispatch({ method: 'GET', path: PATH, query: admin() });
  assert.equal(r.status, 200);
  return (r.body as { data: View }).data;
}

function baseDi(): ErpImportDeclarationInfo {
  return {
    nDI: '26/1998012-3', dDI: '2026-10-20', xLocDesemb: 'VIRACOPOS - CAMPINAS', UFDesemb: 'SP', dDesemb: '2026-10-22',
    tpViaTransp: '4', vAFRMM: 0, tpIntermedio: '1', cExportador: 'FORTINET-US', currency: 'USD', exchangeRatePtax: 5.5,
    fobTotalForeign: 1000, freteInternacionalBrl: 0, seguroInternacionalBrl: 0, taxaSiscomexTotalBrl: 0,
    outrasDespesasAduaneirasBrl: 0, somarTributosEmVOutroSimples: true, exporterIdEstrangeiro: 'US-CA-94086-FGT',
    exporterName: 'FORTINET, INC.', exporterAddress: '899 Kifer Road, Sunnyvale, CA', exporterCountryCodeBacen: '2496',
    exporterCountryName: 'ESTADOS UNIDOS', additions: [{ nAdicao: '1', nSeqAdic: '1', cFabricante: 'FORTINET-US', vDescDI: 0 }],
  };
}
function baseItem(): RawImportItemDraft {
  return {
    id: 'it-1', cProd: 'GC-EQ-00102', xProd: 'APPLIANCE FIREWALL FORTIGATE 100F', ncm: '85176259', cfop: '3.102', uCom: 'UN',
    qCom: 1, fobUnitForeign: 1000, iiRatePercent: 12, ipiRatePercent: 5, pisRatePercent: 2.1, cofinsRatePercent: 9.65,
    icmsRatePercent: 18, icmsReductionPercent: 0, nAdicao: '1', nSeqAdic: '1', cFabricante: 'FORTINET-US',
  };
}
const emitImport = (router: CrmApiRouter) =>
  router.dispatch({ method: 'POST', path: '/api/erp/nfe-importacao/emit', query: admin(), body: { serie: '1', natOp: 'IMPORTACAO', crt: '1', di: baseDi(), rawItems: [baseItem()] } });

describe('Configurações Fiscais — ambiente padrão HOMOLOGAÇÃO', () => {
  it('NF-e, NFC-e e NFS-e começam em homologação, com séries e opções do GestaoClick', async () => {
    const { router } = setup();
    const v = await getView(router);
    assert.equal(v.nfe.environment, 'HOMOLOGACAO');
    assert.equal(v.nfce.environment, 'HOMOLOGACAO');
    assert.equal(v.nfse.environment, 'HOMOLOGACAO');
    assert.equal(v.nfe.serie, '1');
    assert.equal(v.nfce.serie, '2');
    assert.equal(v.nfce.tokenId, '000001');
    assert.equal(v.nfse.rpsSerie, '10001');
    assert.equal(v.nfse.standard, 'INTEGRADORA');
    assert.equal(v.nfse.operationNature, 'TRIBUTAVEL_NAO_RETER_PIS_COFINS');
    assert.equal(v.nfse.specialRegime, 'MEEPP');
    assert.match(v.nfe.additionalInfo, /optante pelo simples nacional/i);
    assert.equal(v.certificate.status, 'NAO_CONFIGURADO');
    assert.equal(v.certificate.uploadEnabled, false);
    assert.equal(v.emitter.readOnly, true);
    assert.equal(v.emitter.taxRegimeNote, 'aguardando confirmação');
    assert.match(v.productionWarning, /GestaoClick deve PARAR de emitir na mesma série/);
  });

  it('a NF-e de importação sai em homologação (tpAmb=2) e não consome a numeração de produção', async () => {
    const { router } = setup();
    const r = await emitImport(router);
    assert.equal(r.status, 201);
    const meta = (r.body as { importMetadata: { environment: string; sefazXmlContent: string; nNF: string } }).importMetadata;
    assert.equal(meta.environment, 'HOMOLOGACAO');
    assert.ok(meta.sefazXmlContent.includes('<tpAmb>2</tpAmb>'));
    const v = await getView(router);
    assert.equal(v.nfe.numbering.next.PRODUCAO, 2177);
    assert.equal(v.nfe.numbering.lastIssued.HOMOLOGACAO, Number(meta.nNF));
  });

  it('sem sessão => 401 no GET e no PUT', async () => {
    const { router } = setup();
    assert.equal((await router.dispatch({ method: 'GET', path: PATH })).status, 401);
    assert.equal((await router.dispatch({ method: 'PUT', path: PATH, body: { nfe: { environment: 'PRODUCAO' } } })).status, 401);
  });
});

describe('Configurações Fiscais — troca para PRODUÇÃO', () => {
  it('403 sem canIssueFiscalDocuments/admin, mesmo com a confirmação; negativa auditada e nada muda', async () => {
    const { repo, router } = setup();
    const r = await router.dispatch({
      method: 'PUT',
      path: PATH,
      query: auditor(),
      body: { nfe: { environment: 'PRODUCAO' }, confirmProductionSwitch: FISCAL_PRODUCTION_CONFIRMATION },
    });
    assert.equal(r.status, 403);
    assert.equal((r.body as { code: string }).code, 'FISCAL_PRODUCTION_SWITCH_FORBIDDEN');
    const logs = repo.listSecurityAuditLogs(20).logs as Array<{ action: string; status: string; actorEmail: string }>;
    const denied = logs.find((l) => l.action === 'FISCAL_ENVIRONMENT_PRODUCTION_DENIED');
    assert.ok(denied, 'negativa registrada na auditoria');
    assert.equal(denied!.status, 'BLOCKED');
    assert.equal(denied!.actorEmail, 'auditoria@setatelecom.com.br');
    assert.equal((await getView(router)).nfe.environment, 'HOMOLOGACAO');
  });

  it('com permissão mas sem confirmação explícita => 409 com o aviso do GestaoClick', async () => {
    const { router } = setup();
    const r = await router.dispatch({ method: 'PUT', path: PATH, query: admin(), body: { nfse: { environment: 'PRODUCAO' } } });
    assert.equal(r.status, 409);
    const b = r.body as { code: string; warning: string; documents: string[] };
    assert.equal(b.code, 'FISCAL_PRODUCTION_CONFIRMATION_REQUIRED');
    assert.deepEqual(b.documents, ['nfse']);
    assert.match(b.warning, /GestaoClick/);
    assert.equal((await getView(router)).nfse.environment, 'HOMOLOGACAO');
  });

  it('com permissão + confirmação => produção, auditado; a NF-e de importação usa 2177 e tpAmb=1', async () => {
    const { repo, router } = setup();
    const r = await router.dispatch({
      method: 'PUT',
      path: PATH,
      query: admin(),
      body: { nfe: { environment: 'PRODUCAO' }, confirmProductionSwitch: FISCAL_PRODUCTION_CONFIRMATION },
    });
    assert.equal(r.status, 200);
    assert.equal((r.body as { data: View }).data.nfe.environment, 'PRODUCAO');
    const logs = repo.listSecurityAuditLogs(20).logs as Array<{ action: string; status: string; details: string }>;
    const changed = logs.find((l) => l.action === 'FISCAL_ENVIRONMENT_CHANGED');
    assert.ok(changed);
    assert.match(changed!.details, /HOMOLOGACAO -> PRODUCAO/);
    const e = await emitImport(router);
    assert.equal(e.status, 201);
    const meta = (e.body as { importMetadata: { nNF: string; environment: string; sefazXmlContent: string } }).importMetadata;
    assert.equal(meta.nNF, '2177');
    assert.equal(meta.environment, 'PRODUCAO');
    assert.ok(meta.sefazXmlContent.includes('<tpAmb>1</tpAmb>'));
    // Voltar para homologação não pede confirmação
    const back = await router.dispatch({ method: 'PUT', path: PATH, query: admin(), body: { nfe: { environment: 'HOMOLOGACAO' } } });
    assert.equal(back.status, 200);
  });
});

describe('Configurações Fiscais — CSC é segredo', () => {
  it('PUT grava o CSC, mas GET/PUT/overview/bootstrap/auditoria nunca o devolvem em claro', async () => {
    const { repo, router } = setup();
    const put = await router.dispatch({ method: 'PUT', path: PATH, query: admin(), body: { nfce: { csc: CSC, tokenId: '000002' } } });
    assert.equal(put.status, 200);
    assert.ok(!JSON.stringify(put.body).includes(CSC));
    const v = await getView(router);
    assert.equal(v.nfce.cscConfigured, true);
    assert.equal(v.nfce.csc, undefined);
    assert.equal(v.nfce.cscMasked, maskCsc(CSC));
    assert.ok(v.nfce.cscMasked.endsWith('XYZ9'));
    assert.ok(!JSON.stringify(v).includes(CSC));
    assert.equal(repo.getFiscalDocumentSettings().nfce.csc, CSC, 'o CSC fica guardado no servidor');
    const overview = await router.dispatch({ method: 'GET', path: '/api/erp/overview', query: admin() });
    assert.ok(!JSON.stringify(overview.body).includes(CSC));
    const boot = await router.dispatch({ method: 'GET', path: '/api/bootstrap', query: admin() });
    assert.ok(!JSON.stringify(boot.body).includes(CSC));
    const logs = repo.listSecurityAuditLogs(50).logs;
    assert.ok(!JSON.stringify(logs).includes(CSC), 'CSC nunca entra na auditoria');
    assert.ok(JSON.stringify(logs).includes('[CSC REDIGIDO]'));
  });

  it('CSC inválido => 400 sem ecoar o valor', async () => {
    const { router } = setup();
    const bad = 'curto!!segredo';
    const r = await router.dispatch({ method: 'PUT', path: PATH, query: admin(), body: { nfce: { csc: bad } } });
    assert.equal(r.status, 400);
    assert.ok(!JSON.stringify(r.body).includes(bad));
  });
});

describe('Configurações Fiscais — numeração separada por ambiente', () => {
  it('produção parte do seed do GestaoClick (NF-e 2176/1, NFC-e 0/2, RPS 735/10001); homologação começa em 1', async () => {
    const { repo, router } = setup();
    const v = await getView(router);
    assert.equal(v.nfe.numbering.lastIssued.PRODUCAO, 2176);
    assert.equal(v.nfe.numbering.next.PRODUCAO, 2177);
    assert.equal(v.nfce.numbering.lastIssued.PRODUCAO, 0);
    assert.equal(v.nfce.numbering.next.PRODUCAO, 1);
    assert.equal(v.nfse.numbering.lastIssued.PRODUCAO, 735);
    assert.equal(v.nfse.numbering.next.PRODUCAO, 736);
    assert.equal(v.nfce.numbering.next.HOMOLOGACAO, 1);
    assert.equal(v.nfse.numbering.next.HOMOLOGACAO, 1);
    assert.equal(repo.peekNextFiscalNumber('55', '3', 'HOMOLOGACAO'), 1);

    // Reservas atômicas por ambiente não se misturam
    assert.deepEqual(repo.reserveFiscalNumber('55', '1', null, 'PRODUCAO'), { ok: true, nNF: 2177 });
    assert.deepEqual(repo.reserveFiscalNumber('55', '1', null, 'PRODUCAO'), { ok: true, nNF: 2178 });
    assert.deepEqual(repo.reserveFiscalNumber('55', '3', null, 'HOMOLOGACAO'), { ok: true, nNF: 1 });
    assert.deepEqual(repo.reserveFiscalNumber('RPS', '10001', null, 'PRODUCAO'), { ok: true, nNF: 736 });
    assert.deepEqual(repo.reserveFiscalNumber('RPS', '10001', null, 'HOMOLOGACAO'), { ok: true, nNF: 1 });
    assert.deepEqual(repo.reserveFiscalNumber('65', '2', null, 'PRODUCAO'), { ok: true, nNF: 1 });
    // Número já usado em produção => recusado; o mesmo número em homologação é livre
    assert.deepEqual(repo.reserveFiscalNumber('55', '1', 2177, 'PRODUCAO'), { ok: false, nextAvailable: 2179 });
    assert.equal(repo.peekNextFiscalNumber('55', '3', 'PRODUCAO'), 1);

    // O seed é aplicado uma vez só (não volta o contador para 2176)
    const again = await getView(router);
    assert.equal(again.nfe.numbering.next.PRODUCAO, 2179);
  });
});

describe('Configurações Fiscais — validação zod e campos protegidos', () => {
  it('CNPJ, regime, município e certificado não entram pelo PUT (400); autXML valida o DV', async () => {
    const { router } = setup();
    for (const body of [
      { companyCnpj: '14806925000132' },
      { taxRegime: 'SIMPLES_NACIONAL' },
      { nfe: { municipality: '3550308' } },
      { certificate: { status: 'VALIDO' } },
      { nfe: { environment: 'PRODUCAO_X' } },
      { xmlDownloadAuthorizations: ['11.222.333/0001-82'] },
    ]) {
      const r = await router.dispatch({ method: 'PUT', path: PATH, query: admin(), body });
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    const ok = await router.dispatch({
      method: 'PUT',
      path: PATH,
      query: admin(),
      body: { xmlDownloadAuthorizations: ['11.222.333/0001-81', '529.982.247-25'] },
    });
    assert.equal(ok.status, 200);
    const v = (ok.body as { data: View }).data;
    assert.deepEqual(v.xmlDownloadAuthorizations.map((a) => [a.document, a.type]), [['11222333000181', 'CNPJ'], ['52998224725', 'CPF']]);
    assert.equal(normalizeCpfOrCnpj('529.982.247-24'), null);
  });

  it('a tela fica em Fiscal > Configurações fiscais, sem contador, e o router não lê body._sessionToken', () => {
    const sidebar = fs.readFileSync(path.join(ROOT, 'src/app/components/GestaoClickSidebar.tsx'), 'utf8');
    assert.match(sidebar, /\{ id: 'FIS_CONFIGURACOES', label: 'Configurações fiscais' \}/);
    const tab = fs.readFileSync(path.join(ROOT, 'src/app/components/ErpGestaoClickTab.tsx'), 'utf8');
    assert.match(tab, /activeSubId === "FIS_CONFIGURACOES"/);
    const panel = fs.readFileSync(path.join(ROOT, 'src/app/components/FiscalSettingsPanel.tsx'), 'utf8');
    assert.match(panel, /Em breve/);
    assert.match(panel, /disabled aria-disabled/);
    const router = fs.readFileSync(path.join(ROOT, 'src/api/router.ts'), 'utf8');
    assert.equal(/typeof body\._sessionToken/.test(router), false);
  });
});
