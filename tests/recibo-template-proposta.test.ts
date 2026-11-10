// Recibo/Fatura de Locação no template da proposta (módulo comum proposal-sheet-theme) e
// seletor de modelo reaproveitado. Sem rede.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildStandaloneInvoiceHtml } from '../src/app/lib/contract-billing-utils';
import { PROPOSAL_SHEET_TW } from '../src/app/lib/proposal-sheet-theme';
import { PROPOSAL_TEMPLATE_STYLE_OPTIONS } from '../src/app/lib/proposal-share';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const inv = {
  documentNumber: 'FAT-LOC-T-1', documentType: 'FATURA_LOCACAO', competenceMonth: '11/2026', issueDate: '2026-11-02',
  dueDate: '2026-12-23', companyName: 'Cliente Teste', companyCnpj: '00.000.000/0001-00', companyAddress: 'SP',
  grossAmount: 750, discountAmount: 0, netAmount: 750, cfop: 'N/A', cstIcms: '41 - Não Tributada',
  boletoDigitableLine: '07790.00116 12345.678901', pixCopyPaste: '00020126580014br.gov.bcb.pix',
  itemsDescription: [{ description: 'Switch', serialNumber: 'SN1', quantity: 1, unitValue: 750, totalValue: 750 }],
  taxBreakdown: { taxRegime: 'LUCRO_PRESUMIDO', legalExemptionNotice: 'Súmula Vinculante 31 do STF' },
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
});
