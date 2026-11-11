// Recibo/Fatura de Locação no template da proposta (módulo comum proposal-sheet-theme) e
// seletor de modelo reaproveitado. Sem rede.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildDraftRentalInvoiceFromContract,
  buildStandaloneInvoiceHtml,
  omitLocacaoPuraLabel,
} from '../src/app/lib/contract-billing-utils';
import { PROPOSAL_SHEET_TW } from '../src/app/lib/proposal-sheet-theme';
import { PROPOSAL_TEMPLATE_STYLE_OPTIONS } from '../src/app/lib/proposal-share';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const inv = {
  documentNumber: 'FAT-LOC-T-1', documentType: 'FATURA_LOCACAO', competenceMonth: '11/2026', issueDate: '2026-11-02',
  dueDate: '2026-12-23', companyName: 'Cliente Teste', companyCnpj: '00.000.000/0001-00', companyAddress: 'SP',
  grossAmount: 750, discountAmount: 0, netAmount: 750, cfop: 'N/A (Fatura de Locação ref. NF-e Remessa CFOP 5.908 nº 2164)',
  cstIcms: '41 - Não Tributada',
  boletoDigitableLine: '07790.00116 12345.678901', pixCopyPaste: '00020126580014br.gov.bcb.pix',
  itemsDescription: [{ description: 'Switch', serialNumber: 'SN1', quantity: 1, unitValue: 750, totalValue: 750 }],
  taxBreakdown: { taxRegime: 'LUCRO_PRESUMIDO', legalExemptionNotice: 'Locação pura de bens móveis. Súmula Vinculante 31 do STF' },
  remessaNfeNumber: '2164', sellerName: 'Marcelo Mira',
} as never;

describe('Recibo de Locação no template da proposta', () => {
  it('usa o módulo comum e o mesmo seletor de modelo da proposta', () => {
    const page = src('src/app/proposta/[id]/page.tsx');
    assert.ok(page.includes('PROPOSAL_SHEET_TW[activeLayout]'));
    assert.ok(page.includes('<ProposalTemplateSelect'));
    assert.ok(src('src/app/components/ContractBillingPanels.tsx').includes('<ProposalTemplateSelect'));
    assert.ok(src('src/app/components/ErpGestaoClickTab.tsx').includes('<ProposalTemplateSelect'));
    assert.deepEqual(Object.keys(PROPOSAL_SHEET_TW).sort(), PROPOSAL_TEMPLATE_STYLE_OPTIONS.map((o) => o.id).sort());
  });

  it('padrão Clean Corporate Light; conteúdo fiscal igual em todos os modelos', () => {
    assert.ok(buildStandaloneInvoiceHtml(inv).includes('data-template="CLEAN_CORPORATE_LIGHT"'));
    for (const o of PROPOSAL_TEMPLATE_STYLE_OPTIONS) {
      const html = buildStandaloneInvoiceHtml(inv, null, { templateStyle: o.id });
      assert.ok(html.includes(`data-template="${o.id}"`), o.id);
      for (const must of ['0% ISS — SV 31 STF', 'ISS: R$ 0,00 (0%)', 'CST ICMS: 41', '07790.00116 12345.678901', '00020126580014br.gov.bcb.pix', 'R$&nbsp;750,00'.replace('&nbsp;', '\u00a0')]) {
        assert.ok(html.includes(must), `${o.id}: ${must}`);
      }
      assert.ok(html.includes('@page { size: A4 portrait; margin: 7mm; }'));
      assert.doesNotMatch(html, /Formato Compacto/);
    }
    const draft = buildStandaloneInvoiceHtml(inv, null, { draft: true, templateStyle: 'EXECUTIVE_SOFT_INDIGO' });
    assert.ok(draft.includes('RASCUNHO — NÃO É DOCUMENTO FISCAL / pré-visualização'));
    assert.ok(!draft.includes('ccl-topbar"'));
  });

  it('ajusta a fatura: sem remessa, canhoto, N/S, vendedor, logística ou contrato; PIX/boleto copiáveis', () => {
    assert.equal(omitLocacaoPuraLabel('Locação Pura de Bens Móveis'), 'Locação de Bens Móveis');
    assert.equal(omitLocacaoPuraLabel('locação pura de bens'), 'locação de bens');

    const bodyOf = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gi, '');
    for (const o of PROPOSAL_TEMPLATE_STYLE_OPTIONS) {
      const html = buildStandaloneInvoiceHtml(inv, null, { templateStyle: o.id });
      const body = bodyOf(html);
      assert.ok(body.includes('Locação'), `${o.id}: mantém Locação`);
      assert.doesNotMatch(body, /loca[cç][aã]o\s+pura/i, `${o.id}: sem Locação Pura`);
      assert.doesNotMatch(body, /Nota Fiscal de Remessa|NF de Remessa|NF-e Remessa|NF Remessa/i, `${o.id}: sem NF remessa`);
      assert.doesNotMatch(body, /2164/, `${o.id}: não exibe o número da remessa`);
      assert.doesNotMatch(body, /N[ºo]\s*de S[eé]rie|\bN\/S\b|\bS\/N\b|\bSN1\b/, `${o.id}: sem coluna N/S`);
      assert.doesNotMatch(body, /Vendedor|Respons[áa]vel/i, `${o.id}: sem vendedor/responsável`);
      assert.doesNotMatch(body, /Contrato e log[ií]stica|Cidade Entrega|Transportadora|Endereço entrega/i, `${o.id}: sem seções contrato/logística`);
      assert.doesNotMatch(body, /Assinatura|Carimbo|class="ccl-sign|Recebimento — Fatura/i, `${o.id}: sem canhoto/assinatura`);
      assert.ok(html.includes('Locação de bens móveis — não incidência de ISSQN (SV 31 STF).'), `${o.id}: fiscal resumido`);
      assert.ok(html.includes('class="receipt-copy'), `${o.id}: campo copiável`);
      assert.ok(html.includes('data-copy="07790.00116 12345.678901"'), `${o.id}: boleto copiável`);
      assert.ok(html.includes('data-copy="00020126580014br.gov.bcb.pix"'), `${o.id}: PIX copiável`);
      assert.ok(html.includes('navigator.clipboard'), `${o.id}: clipboard`);
      assert.ok(html.includes("execCommand('copy')") || html.includes('execCommand("copy")'), `${o.id}: fallback copy`);
      assert.ok(html.includes('Copiado'), `${o.id}: feedback Copiado`);
      assert.ok(html.includes('clique para copiar'), `${o.id}: dica de clique`);
      assert.ok(html.includes('.receipt-copy-hint, .receipt-copy-feedback { display: none !important; }'), `${o.id}: dica e feedback ocultos na impressão`);
    }

    const draft = buildStandaloneInvoiceHtml(inv, null, { draft: true, templateStyle: 'CLEAN_CORPORATE_LIGHT' });
    assert.doesNotMatch(draft, /loca[cç][aã]o\s+pura/i);
    assert.doesNotMatch(draft, /Nota Fiscal de Remessa|NF-e Remessa|\bSN1\b|Vendedor|Assinatura|Contrato e log[ií]stica/i);
    assert.ok(draft.includes('Boleto e PIX serão gerados somente ao finalizar o faturamento'));
    assert.ok(!draft.includes('class="receipt-copy'));

    const draftInv = buildDraftRentalInvoiceFromContract(
      {
        id: 'ctr-1',
        contractNumber: 'LOC-2026-101',
        remessaNfeNumber: '2164',
        remessaCfop: '5.908',
        companyName: 'Cliente Teste',
        companyCnpj: '00.000.000/0001-00',
        contractMonths: 24,
        monthlyValue: 750,
        equipments: [{ description: 'Switch', serialNumber: 'SN1', quantity: 1, unitMonthlyRent: 750 }],
        sellerName: 'Marcelo Mira',
      } as never,
      { issueDate: '2026-11-02', competenceMonth: '11/2026' },
      0
    );
    assert.equal(draftInv.remessaNfeNumber, '2164');
    assert.equal(draftInv.sellerName, 'Marcelo Mira');
    assert.equal(draftInv.itemsDescription?.[0]?.serialNumber, 'SN1');
  });
});
