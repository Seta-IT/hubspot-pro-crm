import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeFixedMenuPosition } from '../src/app/components/FixedPortalMenu';
import {
  findSelectOptionByQuery,
  moveSelectHighlight,
} from '../src/app/components/AppSelect';

const src = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('AppSelect — navegação e posicionamento', () => {
  it('move o destaque com setas, Home e End, sem passar dos limites', () => {
    assert.equal(moveSelectHighlight(-1, 'ArrowDown', 4), 0);
    assert.equal(moveSelectHighlight(0, 'ArrowDown', 4), 1);
    assert.equal(moveSelectHighlight(3, 'ArrowDown', 4), 3);
    assert.equal(moveSelectHighlight(-1, 'ArrowUp', 4), 3);
    assert.equal(moveSelectHighlight(2, 'ArrowUp', 4), 1);
    assert.equal(moveSelectHighlight(2, 'Home', 4), 0);
    assert.equal(moveSelectHighlight(0, 'End', 4), 3);
    assert.equal(moveSelectHighlight(1, 'Enter', 4), 1);
    assert.equal(moveSelectHighlight(0, 'ArrowDown', 0), -1);
  });

  it('localiza opção pelo prefixo digitado, pulando itens desabilitados', () => {
    const options = [
      { label: 'Boleto Bancário Híbrido PIX' },
      { label: 'PIX Empresarial' },
      { label: 'TED / Transferência Bancária' },
      { label: 'Cartão de Crédito', disabled: true },
    ];
    assert.equal(findSelectOptionByQuery(options, 'pix'), 1);
    assert.equal(findSelectOptionByQuery(options, 't'), 2);
    assert.equal(findSelectOptionByQuery(options, 'c'), -1);
    assert.equal(findSelectOptionByQuery(options, ''), -1);
    assert.equal(findSelectOptionByQuery(options, 'boleto', 2), 0);
  });

  it('abre a lista logo abaixo do campo, com a mesma largura e alinhada à esquerda', () => {
    const pos = computeFixedMenuPosition(
      { top: 80, bottom: 108, left: 200, right: 440 },
      { align: 'stretch', estimatedHeight: 200, viewportWidth: 1280, viewportHeight: 800 }
    );
    assert.equal(pos.openUp, false);
    assert.equal(pos.width, 240);
    assert.equal(pos.left, 200);
    assert.ok(pos.top >= 108);
  });

  it('o alinhamento stretch não altera o menu kebab alinhado à direita', () => {
    const pos = computeFixedMenuPosition(
      { top: 80, bottom: 108, left: 1000, right: 1028 },
      { width: 240, estimatedHeight: 320, viewportWidth: 1280, viewportHeight: 800 }
    );
    assert.equal(pos.openUp, false);
    assert.equal(pos.width, 240);
    assert.ok(pos.left <= 1028 - 240 || pos.left === 8);
    assert.ok(pos.top >= 108);
  });
});

describe('Droplist do orçamento e da fatura no padrão visual do sistema', () => {
  it('Forma de Pagamento do orçamento usa AppSelect, não o select nativo', () => {
    const modal = src('src/app/components/ErpEditModals.tsx');
    const select = src('src/app/components/AppSelect.tsx');
    assert.ok(modal.includes("import { AppSelect } from './AppSelect'"));
    assert.ok(modal.includes('testId="proposal-payment-method"'));
    assert.ok(modal.includes("ariaLabel=\"Forma de Pagamento\""));
    const paymentStart = modal.indexOf('Forma de Pagamento');
    const paymentSlice = modal.slice(paymentStart, paymentStart + 1800);
    assert.ok(paymentSlice.includes('<AppSelect'));
    assert.ok(!paymentSlice.includes('<select'));
    assert.ok(paymentSlice.includes('Boleto Bancário Híbrido PIX'));
    assert.ok(select.includes("role=\"listbox\""));
    assert.ok(select.includes("'Escape'"));
    assert.ok(select.includes('bg-[#e8eef6] text-[#1e3a6e]'));
    assert.ok(select.includes('align="stretch"'));
    assert.ok(select.includes('lockWidth'));
  });

  it('o % do desconto fica no mesmo grupo do input, sem quebrar linha', () => {
    const modal = src('src/app/components/ErpEditModals.tsx');
    const start = modal.indexOf('data-testid="proposal-discount-inputs"');
    assert.ok(start > 0);
    const slice = modal.slice(start, start + 2500);
    assert.ok(slice.includes('flex-nowrap'));
    assert.ok(slice.includes('whitespace-nowrap'));
    assert.ok(slice.includes('inline-flex items-center shrink-0'));
    assert.match(slice, />\s*%/);
    assert.ok(slice.includes('self-stretch'));
  });

  it('os demais selects do orçamento e da fatura usam o mesmo AppSelect', () => {
    const modal = src('src/app/components/ErpEditModals.tsx');
    const proposalEnd = modal.indexOf('export function ContractEditModal');
    const invoiceStart = modal.indexOf('export function InvoiceEditModal');
    const invoiceEnd = modal.indexOf('export function GenericRecordEditModal');
    const proposal = modal.slice(0, proposalEnd);
    const invoice = modal.slice(invoiceStart, invoiceEnd);
    assert.equal(proposal.includes('<select'), false, 'ProposalEditModal ainda tem <select nativo');
    assert.equal(invoice.includes('<select'), false, 'InvoiceEditModal ainda tem <select nativo');
    assert.ok(proposal.includes('ariaLabel="Tipo de orçamento"'));
    assert.ok(proposal.includes('Locação & Conectividade'));
    assert.ok(invoice.includes('ariaLabel="Tipo Fiscal"'));
    assert.ok(invoice.includes('InvoiceExtraFieldsPanel'));

    const extra = src('src/app/components/ContractBillingPanels.tsx');
    const extraStart = extra.indexOf('export function InvoiceExtraFieldsPanel');
    const extraSlice = extra.slice(extraStart, extraStart + 8000);
    assert.ok(extraSlice.includes('<AppSelect'));
    assert.ok(extraSlice.includes('ariaLabel="Modalidade de Frete"'));
    assert.equal(
      extraSlice.includes('<select'),
      false,
      'InvoiceExtraFieldsPanel ainda tem <select nativo'
    );

    const tpl = src('src/app/components/ProposalTemplateSelect.tsx');
    assert.ok(tpl.includes('<AppSelect'));
    assert.equal(tpl.includes('<select'), false);
  });
});
