// ============================================================================
// NF-e de produtos — lista (padrão GestãoClick) ligada à SEFAZ-SP homologação (26/11/2026):
// situação derivada do estado SEFAZ, menu ⋮ por linha (Assinar / Transmitir no topo, CC-e,
// Cancelar e Baixar XML só para autorizada, Excluir desabilitado após transmissão), mensagens
// claras (cStat/xMotivo, 409 sem certificado, 422 emitente incompleto) e rascunho XML sem
// endereço inventado (renderEmitterXml usa Configurações > Empresa).
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ErpFiscalInvoice, ErpProductNfeSefazState } from '../src/db/types';
import {
  describeSefazError,
  describeSefazSuccess,
  isSefazTransmitted,
  productNfeRowActions,
  productNfeSituacao,
  TRANSMIT_CONFIRMATION_TEXT,
  xmlDownloadSource,
} from '../src/modules/erp/product-nfe-row-actions';
import {
  draftEmitterPendingFields,
  generateSebrae401Txt,
  renderEmitterXml,
} from '../src/modules/erp/sebrae-nfe-import-engine';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter } from '../src/api/router';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import ProductNfeWorkspace from '../src/app/components/ProductNfeWorkspace';

const ROOT = path.resolve(__dirname, '..', '..');

function todaySp(): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

function sefaz(partial: Partial<ErpProductNfeSefazState>): ErpProductNfeSefazState {
  return {
    environment: 'HOMOLOGACAO',
    status: 'AUTORIZADA',
    accessKey: '3'.repeat(44),
    cNF: '12345678',
    cDV: '1',
    dhEmi: '2026-11-26T10:00:00-03:00',
    cStat: '100',
    xMotivo: 'Autorizado o uso da NF-e',
    message: '',
    nRec: '',
    nProt: '135260000000001',
    dhRecbto: '',
    signedXml: '<NFe/>',
    nfeProcXml: '<nfeProc/>',
    attempts: 1,
    lastAttemptAt: '2026-11-26T13:00:00.000Z',
    lastAttemptBy: 'teste',
    events: [],
    ...partial,
  } as ErpProductNfeSefazState;
}

let seq = 0;
function inv(opts: { status?: ErpFiscalInvoice['status']; sefaz?: ErpProductNfeSefazState; environment?: 'HOMOLOGACAO' | 'PRODUCAO' } = {}): ErpFiscalInvoice {
  seq += 1;
  return {
    id: `inv-${seq}`,
    documentNumber: `NF-e ${seq} - série 1`,
    documentType: 'NFE_VENDA_PRODUTO',
    issueDate: todaySp(),
    companyName: `CLIENTE ${seq}`,
    companyCnpj: '11.222.333/0001-81',
    netAmount: 100,
    status: opts.status || 'RASCUNHO',
    verificationCodeOrKey: '',
    productNfe: {
      environment: opts.environment || 'HOMOLOGACAO',
      modelo: '55',
      serie: '1',
      nNF: seq,
      accessKey: '',
      xmlContent: '<NFe>rascunho</NFe>',
      totals: { vNF: 100 },
      ...(opts.sefaz ? { sefaz: opts.sefaz } : {}),
    },
  } as unknown as ErpFiscalInvoice;
}

const ids = (i: ErpFiscalInvoice) => productNfeRowActions(i).map((a) => a.id);
const action = (i: ErpFiscalInvoice, id: string) => productNfeRowActions(i).find((a) => a.id === id);
const cce = { kind: 'CCE' as const, tpEvento: '110110', nSeqEvento: 1, cStat: '135', xMotivo: 'Evento registrado', nProt: '1', dhRegEvento: '', registered: true, procXml: '<procEventoNFe/>', at: '', by: '' };

describe('NF-e de produtos — situação derivada do estado SEFAZ', () => {
  it('Aprovada (100), Corrigida (CC-e), Cancelada, Rejeitada (cStat/xMotivo), Em processamento e Rascunho', () => {
    assert.equal(productNfeSituacao(inv({ status: 'EMITIDA', sefaz: sefaz({}) })).label, 'Aprovada');
    assert.equal(productNfeSituacao(inv({ status: 'EMITIDA', sefaz: sefaz({}) })).tone, 'green');
    const corr = productNfeSituacao(inv({ status: 'EMITIDA', sefaz: sefaz({ events: [cce] }) }));
    assert.equal(corr.label, 'Corrigida');
    assert.equal(corr.tone, 'cyan');
    // CC-e rejeitada não muda a situação
    assert.equal(productNfeSituacao(inv({ status: 'EMITIDA', sefaz: sefaz({ events: [{ ...cce, registered: false }] }) })).label, 'Aprovada');
    const canc = productNfeSituacao(inv({ status: 'CANCELADA', sefaz: sefaz({ status: 'CANCELADA', cStat: '135' }) }));
    assert.equal(canc.label, 'Cancelada');
    assert.equal(canc.tone, 'red');
    const rej = productNfeSituacao(inv({ sefaz: sefaz({ status: 'REJEITADA', cStat: '226', xMotivo: 'Rejeicao: Codigo da UF diverge', nProt: '', nfeProcXml: '' }) }));
    assert.equal(rej.label, 'Rejeitada');
    assert.equal(rej.detail, '226 — Rejeicao: Codigo da UF diverge');
    const proc = productNfeSituacao(inv({ sefaz: sefaz({ status: 'EM_PROCESSAMENTO', cStat: '105', nRec: '351000000000001', nProt: '', nfeProcXml: '' }) }));
    assert.equal(proc.label, 'Em processamento');
    assert.equal(proc.detail, 'Recibo 351000000000001');
    assert.equal(productNfeSituacao(inv()).label, 'Rascunho');
    assert.equal(productNfeSituacao(inv({ sefaz: sefaz({ status: 'ERRO', message: 'Sem protNFe', cStat: '', nfeProcXml: '' }) })).label, 'Pendente');
  });
});

describe('NF-e de produtos — menu ⋮ da linha', () => {
  it('rascunho: "Assinar / Transmitir" no topo; CC-e/Cancelar desabilitados; Excluir habilitado', () => {
    const r = inv();
    assert.equal(ids(r)[0], 'TRANSMITIR');
    assert.equal(action(r, 'TRANSMITIR')!.label, 'Assinar / Transmitir');
    assert.equal(action(r, 'TRANSMITIR')!.disabledHint, undefined);
    assert.ok(action(r, 'CARTA_CORRECAO')!.disabledHint);
    assert.ok(action(r, 'CANCELAR')!.disabledHint);
    assert.equal(action(r, 'EXCLUIR')!.disabledHint, undefined);
    assert.equal(xmlDownloadSource(r), 'RASCUNHO');
    assert.deepEqual(
      productNfeRowActions(r).map((a) => a.label).slice(1),
      ['Imprimir DANFE', 'Enviar por e-mail', 'Enviar por WhatsApp', 'Gerar financeiro', 'Baixar XML', 'Carta de correção', 'Duplicar NF-e', 'Cancelar NF-e', 'Excluir']
    );
  });

  it('rejeitada/falha: pode transmitir de novo; falha com chave oferece Consultar', () => {
    const rej = inv({ sefaz: sefaz({ status: 'REJEITADA', nProt: '', nfeProcXml: '' }) });
    assert.equal(ids(rej)[0], 'TRANSMITIR');
    assert.equal(isSefazTransmitted(rej), false);
    assert.equal(action(rej, 'EXCLUIR')!.disabledHint, undefined);
    const erro = inv({ sefaz: sefaz({ status: 'ERRO', nProt: '', nfeProcXml: '' }) });
    assert.deepEqual(ids(erro).slice(0, 2), ['TRANSMITIR', 'CONSULTAR']);
  });

  it('em processamento: sem reenvio, só Consultar; Excluir desabilitado', () => {
    const p = inv({ sefaz: sefaz({ status: 'EM_PROCESSAMENTO', nProt: '', nfeProcXml: '' }) });
    assert.ok(!ids(p).includes('TRANSMITIR'));
    assert.equal(ids(p)[0], 'CONSULTAR');
    assert.match(action(p, 'EXCLUIR')!.disabledHint!, /transmitida/);
  });

  it('autorizada: CC-e, Cancelar e Baixar XML (nfeProc pela rota SEFAZ) ligados; sem transmitir; Excluir desabilitado', () => {
    const a = inv({ status: 'EMITIDA', sefaz: sefaz({}) });
    assert.ok(!ids(a).includes('TRANSMITIR'));
    assert.equal(action(a, 'CARTA_CORRECAO')!.disabledHint, undefined);
    assert.equal(action(a, 'CANCELAR')!.disabledHint, undefined);
    assert.equal(action(a, 'BAIXAR_XML')!.disabledHint, undefined);
    assert.equal(xmlDownloadSource(a), 'SEFAZ');
    assert.match(action(a, 'EXCLUIR')!.disabledHint!, /transmitida/);
    const c = inv({ status: 'CANCELADA', sefaz: sefaz({ status: 'CANCELADA' }) });
    assert.ok(action(c, 'CANCELAR')!.disabledHint);
    assert.ok(action(c, 'EXCLUIR')!.disabledHint);
  });

  it('nota em PRODUÇÃO: "Assinar / Transmitir" aparece desabilitado (trava de produção)', () => {
    const p = inv({ environment: 'PRODUCAO' });
    assert.match(action(p, 'TRANSMITIR')!.disabledHint!, /PRODUÇÃO/);
  });

  it('confirmação cita HOMOLOGAÇÃO e "sem valor fiscal"', () => {
    const t = TRANSMIT_CONFIRMATION_TEXT('NF-e 1 - série 1');
    assert.match(t, /HOMOLOGAÇÃO/);
    assert.match(t, /sem valor fiscal/);
  });
});

describe('NF-e de produtos — mensagens das rotas SEFAZ', () => {
  it('rejeição mostra cStat/xMotivo; autorizada mostra protocolo; processamento orienta Consultar', () => {
    const rej = describeSefazSuccess('transmitir', { status: 'REJEITADA', cStat: '539', xMotivo: 'Rejeicao: Duplicidade de NF-e' });
    assert.equal(rej.tone, 'error');
    assert.match(rej.message, /cStat 539 — Rejeicao: Duplicidade de NF-e/);
    const ok = describeSefazSuccess('transmitir', { status: 'AUTORIZADA', cStat: '100', xMotivo: 'Autorizado o uso da NF-e', nProt: '135260000000001' });
    assert.equal(ok.tone, 'success');
    assert.match(ok.message, /HOMOLOGAÇÃO.*135260000000001/);
    assert.match(describeSefazSuccess('transmitir', { status: 'EM_PROCESSAMENTO', cStat: '105', nRec: '1' }).message, /Consultar/);
    assert.match(describeSefazSuccess('cancelar', { event: { cStat: '135', xMotivo: 'Evento registrado', registered: true } }).message, /Cancelamento registrado/);
    assert.equal(describeSefazSuccess('carta-correcao', { event: { cStat: '573', xMotivo: 'Rejeicao: Duplicidade', registered: false } }).tone, 'error');
  });

  it('409 sem certificado, 422 emitente incompleto, 403 alçada/2FA, 401 sessão e 403 produção', () => {
    const cert = describeSefazError(409, { code: 'CERT_NOT_CONFIGURED', error: 'Certificado digital A1 não configurado (Configurações > Certificado digital).' });
    assert.equal(cert.openCertificate, true);
    assert.match(cert.message, /Certificado digital A1 não configurado/);
    const em = describeSefazError(422, { code: 'NFE_EMITTER_DATA_INCOMPLETE', error: 'x', details: ['CNPJ do emitente com DV inválido', 'CEP do emitente'] });
    assert.match(em.message, /Dados do emitente incompletos.*CNPJ do emitente com DV inválido; CEP do emitente/);
    assert.match(describeSefazError(403, { code: 'ERP_FISCAL_ISSUANCE_FORBIDDEN' }).message, /alçada fiscal.*2FA/);
    assert.match(describeSefazError(401, null).message, /2FA/);
    assert.match(describeSefazError(403, { code: 'SEFAZ_PRODUCTION_BLOCKED', error: 'Transmissão em PRODUÇÃO bloqueada.' }).message, /PRODUÇÃO/);
  });
});

describe('NF-e de produtos — tela (renderização)', () => {
  it('lista mostra os badges de situação e o botão ⋮ em cada linha; layout atual mantido (XML/DANFE)', () => {
    const invoices = [
      inv({ status: 'EMITIDA', sefaz: sefaz({}) }),
      inv({ status: 'EMITIDA', sefaz: sefaz({ events: [cce] }) }),
      inv({ status: 'CANCELADA', sefaz: sefaz({ status: 'CANCELADA' }) }),
      inv({ sefaz: sefaz({ status: 'REJEITADA', cStat: '226', xMotivo: 'Rejeicao: UF diverge', nProt: '', nfeProcXml: '' }) }),
      inv({ sefaz: sefaz({ status: 'EM_PROCESSAMENTO', nRec: '351', nProt: '', nfeProcXml: '' }) }),
      inv(),
    ];
    const html = renderToStaticMarkup(
      React.createElement(ProductNfeWorkspace, {
        invoices,
        companies: [],
        suppliers: [],
        catalog: [],
        onRefresh: async () => undefined,
        onShowToast: () => undefined,
        onOpenCertificate: () => undefined,
        onPrintInvoice: () => undefined,
      })
    );
    for (const label of ['Aprovada', 'Corrigida', 'Cancelada', 'Rejeitada', 'Em processamento', 'Rascunho']) assert.ok(html.includes(`>${label}</span>`), label);
    assert.ok(html.includes('226 — Rejeicao: UF diverge'));
    // cores no componente (src/app, varrido pelo Tailwind): Aprovada verde, Corrigida ciano, Cancelada vermelho
    assert.match(html, /bg-emerald-500[^"]*"[^>]*>Aprovada</);
    assert.match(html, /bg-cyan-500[^"]*"[^>]*>Corrigida</);
    assert.match(html, /bg-rose-600[^"]*"[^>]*>Cancelada</);
    assert.equal((html.match(/aria-label="Ações da NF-e /g) || []).length, invoices.length);
    assert.ok(html.includes('>DANFE<'));
    assert.ok(html.includes('Mais ações'));
  });

  it('a tela chama as rotas SEFAZ (transmitir, consultar, cancelar, carta-correcao, xml) e confirma antes de transmitir', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/app/components/ProductNfeWorkspace.tsx'), 'utf8');
    assert.match(src, /\/sefaz\/\$\{action\}/);
    assert.match(src, /\/sefaz\/xml/);
    assert.match(src, /window\.confirm\(TRANSMIT_CONFIRMATION_TEXT/);
    for (const a of ["'transmitir'", "'consultar'", "'cancelar'", "'carta-correcao'"]) assert.ok(src.includes(a), a);
    assert.equal(/_sessionToken/.test(src), false, 'sessão vai pelo cookie, como nas outras ações fiscais');
  });
});

describe('Rascunho XML/TXT — emitente sem dados inventados (renderEmitterXml)', () => {
  const base = { emitterName: 'SETA TELECOM LTDA', emitterCnpj: '14.806.925/0001-39', emitterIe: '149.882.410.114', emitterUf: 'SP' };

  it('sem endereço configurado: nada de Av. Paulista/CEP/cMun fixos; PENDENTE explícito; CNPJ sem padEnd', () => {
    const xml = renderEmitterXml({ ...base, emitterCnpj: '14.806.925/0001' }, '3');
    assert.ok(!/PAULISTA|01310100|3550308|BELA VISTA|SETA IT TELECOM/.test(xml), xml);
    assert.match(xml, /<CNPJ>148069250001<\/CNPJ>/, 'CNPJ incompleto não é completado com zeros');
    assert.match(xml, /PENDENTE.*CNPJ \(14 dígitos\).*logradouro.*município \(código IBGE\).*CEP/);
    assert.match(xml, /<cMun><\/cMun>/);
    assert.ok(!xml.includes('<xFant>'));
  });

  it('com Configurações > Empresa: usa logradouro, número, bairro, IBGE, município, CEP e telefone de lá', () => {
    const emitter = {
      ...base,
      address: { tradeName: 'SETA IT', street: 'Rua Guapuruvu', number: '242', complement: 'Sala 31', district: 'Alphaville', cityIbge: '3509502', cityName: 'Campinas', uf: 'SP', cep: '13098-322', phone: '(19) 3000-0000' },
    };
    const xml = renderEmitterXml(emitter, '3');
    for (const frag of ['<xLgr>RUA GUAPURUVU</xLgr>', '<nro>242</nro>', '<cMun>3509502</cMun>', '<CEP>13098322</CEP>', '<fone>1930000000</fone>', '<CNPJ>14806925000139</CNPJ>', '<IE>149882410114</IE>']) {
      assert.ok(xml.toUpperCase().includes(frag.toUpperCase()), frag);
    }
    assert.ok(!xml.includes('PENDENTE'));
    assert.deepEqual(draftEmitterPendingFields(emitter), []);
  });

  it('TXT Sebrae (C05/B) também sai da configuração, sem endereço/IE fixos', () => {
    const txt = generateSebrae401Txt(
      {
        serie: '1', nNF: '7', natOp: 'IMPORTACAO', crt: '1', finNFe: '1', indFinal: '0', indPres: '0', indIntermed: '0', accessKey: '',
        di: { exporterName: 'X', exporterIdEstrangeiro: '1', exporterAddress: 'Y', exporterCountryCodeBacen: '1600', exporterCountryName: 'CHINA' },
        items: [], totals: {}, infCpl: '',
      } as never,
      { ...base, emitterIe: '', address: { street: 'Rua Guapuruvu', number: '242', district: 'Alphaville', cityIbge: '3509502', cityName: 'Campinas', uf: 'SP', cep: '13098322' } }
    );
    assert.ok(!/AV PAULISTA|01310100|3550308|149882410114|1139584929/.test(txt), txt);
    assert.match(txt, /C05\|RUA GUAPURUVU\|242\|\|ALPHAVILLE\|3509502\|CAMPINAS\|SP\|13098322\|/i);
  });

  it('rota: rascunho criado usa o endereço/IBGE de Dados da Empresa (cMunFG do emitente), não 3550308 fixo', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const token = signStiHubSessionToken({
      uid: 'usr-seta-01', email: 'marcelo.mira@setatelecom.com.br', name: 'Teste', roleId: 'SUPER_ADMIN', scope: 'TODOS',
      enabledModules: ['CRM', 'ERP', 'CHAMADOS'], moduleAccess: { crm: true, erp: true, chamados: true }, mfaVerified: true, mfaMethod: 'TOTP_AUTHENTICATOR', iat: Date.now(), exp: Date.now() + 3600_000,
    } as never);
    const q = { _sessionToken: token };
    const put = await router.dispatch({ method: 'PUT', path: '/api/admin/settings', query: q, body: { companyEmitter: { cep: '13098-322', ibgeCode: '3509502', city: 'Campinas' } } });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    const r = await router.dispatch({
      method: 'POST',
      path: '/api/erp/nfe-produtos',
      query: q,
      body: {
        general: { natOp: 'VENDA DE MERCADORIA', issueDateTime: '2026-11-26T10:00', tpNF: '1', indFinal: '0', saida: 'NA_EMISSAO', finNFe: '1', tpEmis: '1', idDest: '1', indPres: '1', hasReferencedNfe: false },
        recipient: {
          documentType: 'CNPJ', document: '11.222.333/0001-81', name: 'CLIENTE', taxpayerType: '1', ie: '110042490114',
          address: { cep: '01310-100', street: 'AV PAULISTA', number: '1000', complement: '', district: 'BELA VISTA', city: 'SAO PAULO', uf: 'SP', cityIbge: '3550308' },
          country: 'Brasil', phone: '', email: '', hasDeliveryAddress: false, hasPickupAddress: false,
        },
        items: [{ code: 'EQ-1', description: 'ROTEADOR', ncm: '85176259', cfop: '5102', unit: 'UN', quantity: 1, unitValue: 100, icmsCode: '00' }],
        transport: { modFrete: '9' },
        totals: { discountValue: 0, adjustedTotal: null },
        additionalInfo: { complementary: '' },
      },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const xml = (r.body as { data: ErpFiscalInvoice }).data.productNfe!.xmlContent;
    assert.match(xml, /<cMunFG>3509502<\/cMunFG>/);
    const emit = xml.slice(xml.indexOf('<emit>'), xml.indexOf('</emit>'));
    assert.match(emit, /<cMun>3509502<\/cMun>/);
    assert.match(emit, /<CEP>13098322<\/CEP>/);
    assert.ok(!/PAULISTA|01310100|3550308/.test(emit), emit);
  });
});
