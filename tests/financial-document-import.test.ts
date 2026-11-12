// ============================================================================
// Conciliação bancária: importação de PDF (fatura de cartão / boleto) e XML (NF-e) para Contas a Pagar.
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBrDate,
  parseBrMoney,
  parseCardStatementText,
  parseFinancialPdfText,
  parseFinancialXml,
  parseNfeXml,
  parseSimpleDocumentText,
  suggestPayableMatches,
} from '../src/modules/erp/financial-document-import';
import { extractPdfText } from '../src/modules/erp/pdf-text-extract';
import { createInMemoryRepository } from '../src/db/repository';
import { CrmApiRouter, TRUSTED_INTERNAL_CONTEXT } from '../src/api/router';
import { isLargeBodyRoute } from '../src/app/lib/bridge-body-limit';

const SAMPLE_NFE = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe><infNFe Id="NFe35261112345678000199550010000123451000123456" versao="4.00">
    <ide><cUF>35</cUF><nNF>12345</nNF><serie>1</serie><dhEmi>2026-11-05T10:30:00-03:00</dhEmi></ide>
    <emit><CNPJ>12345678000199</CNPJ><xNome>Fornecedor Link &amp; Hardware LTDA</xNome></emit>
    <total><ICMSTot><vProd>3000.00</vProd><vNF>3000.00</vNF></ICMSTot></total>
    <cobr>
      <fat><nFat>12345</nFat><vOrig>3000.00</vOrig><vLiq>3000.00</vLiq></fat>
      <dup><nDup>001</nDup><dVenc>2026-12-05</dVenc><vDup>1500.00</vDup></dup>
      <dup><nDup>002</nDup><dVenc>2027-01-05</dVenc><vDup>1500.00</vDup></dup>
    </cobr>
  </infNFe></NFe>
</nfeProc>`;

const SAMPLE_CARD = `Banco Inter - Fatura do Cartão de Crédito
Seta Telecom LTDA
Vencimento: 15/12/2026
Total da fatura: R$ 3.482,90
Data Descrição Valor
28/10 PAGAMENTO EFETUADO -2.100,00
03/11 AMAZON WEB SERVICES 1.250,00
05/11 GOOGLE WORKSPACE 389,90
12/11 POSTO SHELL SP 243,00
20/11 MERCADO LIVRE PARC 02/05 1.600,00`;

const SAMPLE_BOLETO = `Recibo do Pagador
Beneficiário: Vivo Telefônica Brasil S.A. CNPJ 02.558.157/0001-62
Número do documento: 778899
Vencimento: 20/11/2026
Valor do documento: R$ 1.289,40
Boleto bancário`;

/** PDF mínimo com uma linha de texto por item (Helvetica), xref correto. */
function buildPdf(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = ['BT', '/F1 10 Tf', '14 TL', '40 800 Td', ...lines.map((l) => `(${esc(l)}) Tj T*`), 'ET'].join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

describe('Conciliação bancária: parsers de PDF e XML', () => {
  it('valores e datas no formato brasileiro', () => {
    assert.equal(parseBrMoney('R$ 1.234,56'), 1234.56);
    assert.equal(parseBrMoney('-2.100,00'), -2100);
    assert.equal(parseBrMoney('389,90'), 389.9);
    assert.equal(parseBrMoney('1500.00'), 1500);
    assert.ok(Number.isNaN(parseBrMoney('abc')));
    assert.equal(parseBrDate('15/12/2026'), '2026-12-15');
    assert.equal(parseBrDate('2026-11-05T10:30:00-03:00'), '2026-11-05');
    assert.equal(parseBrDate('03/11', '2026-12-15'), '2026-11-03');
    assert.equal(parseBrDate('28/12', '2027-01-10'), '2026-12-28');
    assert.equal(parseBrDate('31/02/2026'), '');
  });

  it('NF-e: emitente, número, emissão, total e uma parcela por duplicata', () => {
    const r = parseNfeXml(SAMPLE_NFE);
    assert.equal(r.kind, 'NFE_XML');
    assert.equal(r.issuerName, 'Fornecedor Link & Hardware LTDA');
    assert.equal(r.issuerCnpj, '12.345.678/0001-99');
    assert.equal(r.documentNumber, '12345');
    assert.equal(r.issueDate, '2026-11-05');
    assert.equal(r.totalAmount, 3000);
    assert.equal(r.items.length, 2);
    assert.deepEqual(r.items.map((i) => [i.dueDate, i.amount, i.role]), [
      ['2026-12-05', 1500, 'PARCELA'],
      ['2027-01-05', 1500, 'PARCELA'],
    ]);
    assert.match(r.items[0].description, /NF-e 12345\/1 parcela 001/);
    assert.deepEqual(r.warnings, []);
    assert.equal(parseFinancialXml(SAMPLE_NFE).kind, 'NFE_XML');
  });

  it('NF-e sem cobr: um título pelo vNF com vencimento na emissão (e aviso)', () => {
    const xml = SAMPLE_NFE.replace(/<cobr>[\s\S]*<\/cobr>/, '');
    const r = parseNfeXml(xml);
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].amount, 3000);
    assert.equal(r.items[0].dueDate, '2026-11-05');
    assert.equal(r.warnings.length, 1);
  });

  it('XML com DOCTYPE/ENTITY é recusado e XML genérico com lançamentos é lido', () => {
    assert.throws(() => parseFinancialXml('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><x>&a;</x>'), /DOCTYPE/);
    const generic = `<lancamentos><lancamento><descricao>Aluguel sala</descricao><vencimento>10/12/2026</vencimento><valor>2.500,00</valor></lancamento>
      <lancamento><descricao>Energia</descricao><vencimento>2026-12-12</vencimento><valor>612.35</valor></lancamento></lancamentos>`;
    const r = parseFinancialXml(generic);
    assert.equal(r.kind, 'XML_GENERICO');
    assert.deepEqual(r.items.map((i) => [i.description, i.dueDate, i.amount]), [
      ['Aluguel sala', '2026-12-10', 2500],
      ['Energia', '2026-12-12', 612.35],
    ]);
  });

  it('fatura de cartão: total, vencimento, compras e pagamento anterior ignorado', () => {
    const r = parseCardStatementText(SAMPLE_CARD);
    assert.equal(r.kind, 'FATURA_CARTAO');
    assert.equal(r.issuerName, 'Banco Inter');
    assert.equal(r.dueDate, '2026-12-15');
    assert.equal(r.totalAmount, 3482.9);
    assert.equal(r.items[0].role, 'TOTAL');
    assert.equal(r.items[0].amount, 3482.9);
    const lines = r.items.filter((i) => i.role === 'LINHA');
    assert.deepEqual(lines.map((l) => [l.date, l.companyName, l.amount]), [
      ['2026-11-03', 'AMAZON WEB SERVICES', 1250],
      ['2026-11-05', 'GOOGLE WORKSPACE', 389.9],
      ['2026-11-12', 'POSTO SHELL SP', 243],
      ['2026-11-20', 'MERCADO LIVRE PARC 02/05', 1600],
    ]);
    assert.ok(r.warnings.some((w) => /ignorada/.test(w)));
    assert.equal(parseFinancialPdfText(SAMPLE_CARD).kind, 'FATURA_CARTAO');
  });

  it('boleto simples: valor, vencimento, beneficiário e CNPJ', () => {
    const r = parseSimpleDocumentText(SAMPLE_BOLETO);
    assert.equal(r.kind, 'DOCUMENTO_SIMPLES');
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].amount, 1289.4);
    assert.equal(r.items[0].dueDate, '2026-11-20');
    assert.equal(r.items[0].companyName, 'Vivo Telefônica Brasil S.A.');
    assert.equal(r.issuerCnpj, '02.558.157/0001-62');
    assert.equal(parseFinancialPdfText(SAMPLE_BOLETO).kind, 'DOCUMENTO_SIMPLES');
  });

  it('PDF sem texto (escaneado) volta como não reconhecido com aviso', () => {
    const r = parseFinancialPdfText('   \n ');
    assert.equal(r.kind, 'DESCONHECIDO');
    assert.equal(r.items.length, 0);
    assert.match(r.warnings[0], /escaneado/);
  });

  it('pareamento: mesmo valor e vencimento mais próximo; compras da fatura ficam como detalhe', () => {
    const entries = [
      { id: 'a', type: 'PAGAR', status: 'ABERTO', amount: 1500, dueDate: '2026-12-30' },
      { id: 'b', type: 'PAGAR', status: 'ABERTO', amount: 1500, dueDate: '2026-12-06' },
      { id: 'c', type: 'RECEBER', status: 'ABERTO', amount: 1500, dueDate: '2026-12-05' },
      { id: 'd', type: 'PAGAR', status: 'PAGO', amount: 1500, dueDate: '2027-01-05' },
      { id: 'e', type: 'PAGAR', status: 'ABERTO', amount: 389.9, dueDate: '2026-12-15' },
    ];
    const nfe = suggestPayableMatches(parseNfeXml(SAMPLE_NFE).items, entries);
    assert.equal(nfe[0].match?.entryId, 'b');
    assert.equal(nfe[0].suggestedAction, 'MATCH');
    assert.equal(nfe[1].match?.entryId, 'a');
    const card = suggestPayableMatches(parseCardStatementText(SAMPLE_CARD).items, entries);
    assert.equal(card[0].suggestedAction, 'CREATE');
    assert.ok(card.slice(1).every((c) => c.suggestedAction === 'IGNORE' && c.match === null));
  });

  it('extrai texto de PDF no servidor e reconhece a fatura', async () => {
    const pdf = buildPdf(SAMPLE_CARD.normalize('NFD').replace(/[\u0300-\u036f]/g, '').split('\n'));
    const { text, pages } = await extractPdfText(pdf);
    assert.equal(pages, 1);
    const r = parseFinancialPdfText(text);
    assert.equal(r.kind, 'FATURA_CARTAO');
    assert.equal(r.totalAmount, 3482.9);
    assert.equal(r.items.filter((i) => i.role === 'LINHA').length, 4);
    await assert.rejects(() => extractPdfText(new Uint8Array(Buffer.from('nao e pdf'))), /PDF/);
  });
});

describe('Conciliação bancária: rotas de prévia e confirmação', () => {
  it('prévia não grava; confirmação cria títulos e guarda só metadados; reimportação => 409', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const call = (path: string, body: Record<string, unknown>) =>
      router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path, query: {}, body } as never);
    const before = repo.getErpOverview().financialEntries.length;
    const prev = await call('/api/erp/financial/import-document', { fileName: 'nfe.xml', fileType: 'xml', content: SAMPLE_NFE });
    assert.equal(prev.status, 200);
    const data = (prev.body as { data: { sha256: string; kind: string; items: Array<Record<string, unknown>> } }).data;
    assert.equal(data.kind, 'NFE_XML');
    assert.match(data.sha256, /^[a-f0-9]{64}$/);
    assert.equal(data.items.length, 2);
    assert.equal(repo.getErpOverview().financialEntries.length, before);
    assert.equal(repo.listFinancialDocumentImports().length, 0);

    const items = data.items.map((i) => ({ ...i, action: 'CREATE' }));
    const conf = await call('/api/erp/financial/import-document/confirm', {
      fileName: 'nfe.xml', fileType: 'xml', sha256: data.sha256, kind: data.kind, items,
    });
    assert.equal(conf.status, 201);
    assert.equal((conf.body as { createdCount: number }).createdCount, 2);
    const created = repo.getErpOverview().financialEntries.filter((e) => e.id.startsWith('fin-doc-'));
    assert.equal(created.length, 2);
    assert.ok(created.every((e) => e.type === 'PAGAR' && e.status === 'ABERTO'));
    const meta = repo.listFinancialDocumentImports();
    assert.equal(meta.length, 1);
    assert.equal(meta[0].fileName, 'nfe.xml');
    assert.equal(meta[0].sha256, data.sha256);
    assert.ok(!JSON.stringify(meta[0]).includes('<nfeProc'), 'o conteúdo do arquivo não é gravado');

    const again = await call('/api/erp/financial/import-document/confirm', {
      fileName: 'nfe.xml', fileType: 'xml', sha256: data.sha256, kind: data.kind, items,
    });
    assert.equal(again.status, 409);
    const prev2 = await call('/api/erp/financial/import-document', { fileName: 'nfe.xml', fileType: 'xml', content: SAMPLE_NFE });
    assert.ok((prev2.body as { data: { alreadyImportedAt: string | null } }).data.alreadyImportedAt);
    // agora as parcelas existem: a prévia sugere parear
    const sugg = (prev2.body as { data: { items: Array<{ suggestedAction: string }> } }).data.items;
    assert.ok(sugg.every((s) => s.suggestedAction === 'MATCH'));
  });

  it('prévia de PDF e erros de entrada', async () => {
    const router = new CrmApiRouter(createInMemoryRepository());
    const call = (body: Record<string, unknown>) =>
      router.dispatch({ context: TRUSTED_INTERNAL_CONTEXT, method: 'POST', path: '/api/erp/financial/import-document', query: {}, body } as never);
    const pdf = Buffer.from(buildPdf(SAMPLE_BOLETO.normalize('NFD').replace(/[\u0300-\u036f]/g, '').split('\n'))).toString('base64');
    const ok = await call({ fileName: 'boleto.pdf', fileType: 'pdf', contentBase64: pdf });
    assert.equal(ok.status, 200);
    const d = (ok.body as { data: { kind: string; totalAmount: number } }).data;
    assert.equal(d.kind, 'DOCUMENTO_SIMPLES');
    assert.equal(d.totalAmount, 1289.4);
    assert.equal((await call({ fileName: 'x.doc', fileType: 'doc', content: 'x' })).status, 400);
    assert.equal((await call({ fileName: 'x.xml', fileType: 'xml', content: '<a><b></a>' })).status, 422);
    assert.equal((await call({ fileName: 'x.pdf', fileType: 'pdf', contentBase64: Buffer.from('oi').toString('base64') })).status, 422);
    assert.equal(isLargeBodyRoute('POST', '/api/erp/financial/import-document'), true);
  });
});
