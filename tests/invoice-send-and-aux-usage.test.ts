import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';
import {
  auxUsageTotal,
  countAuxOptionUsage,
  formatAuxOptionUsageText,
} from '../src/modules/erp/aux-option-usage';
import {
  defaultSelectedInvoiceAttachments,
  isIssuedInvoiceStatus,
  isStoredBoletoLine,
  isStoredPixCode,
  resolveInvoiceSendAttachments,
} from '../src/modules/erp/invoice-send-attachments';
import { signInvoiceLinkToken, verifyInvoiceLinkToken } from '../src/app/lib/invoice-link';
import { signProposalLinkToken, verifyProposalLinkToken } from '../src/app/lib/proposal-link';
import { toPublicInvoiceDto } from '../src/app/lib/invoice-public-dto';
import type { ErpFiscalInvoice } from '../src/db/types';

const savedSecret = process.env.STI_HUB_PROPOSAL_LINK_SECRET;

function sampleInvoice(overrides: Partial<ErpFiscalInvoice> = {}): ErpFiscalInvoice {
  return {
    id: 'inv-1',
    documentNumber: 'FAT-2026-001',
    documentType: 'FATURA_LOCACAO',
    competenceMonth: '11/2026',
    companyId: 'co-1',
    companyName: 'Cliente Exemplo LTDA',
    companyCnpj: '00.000.000/0001-00',
    companyAddress: 'Rua A, 1',
    rentalContractId: 'ctr-1',
    proposalId: null,
    dealId: null,
    grossAmount: 1000,
    discountAmount: 0,
    netAmount: 1000,
    status: 'EMITIDA',
    issueDate: '2026-11-01',
    dueDate: '2026-11-10',
    paidAt: null,
    paymentMethod: 'BOLETO_PIX',
    serviceCodeLc116: null,
    cfop: '5949',
    cstIcms: null,
    cstPisCofins: null,
    verificationCodeOrKey: '',
    pixCopyPaste: '',
    boletoDigitableLine: '',
    itemsDescription: [{ description: 'Rádio', quantity: 1, unitValue: 1000, totalValue: 1000 }],
    taxBreakdown: {
      taxRegime: 'LUCRO_PRESUMIDO',
      issRatePercent: 0,
      issAmount: 0,
      issWithheld: false,
      pisRatePercent: 0,
      pisAmount: 0,
      cofinsRatePercent: 0,
      cofinsAmount: 0,
      irpjEstimatedAmount: 0,
      csllEstimatedAmount: 0,
      irrfWithheldRatePercent: 0,
      irrfWithheldAmount: 0,
      csrfWithheldRatePercent: 0,
      csrfWithheldAmount: 0,
      icmsRatePercent: 0,
      icmsAmount: 0,
      totalTaxesEstimated: 0,
      totalWithheld: 0,
      netReceivableAmount: 1000,
      legalExemptionNotice: 'SV 31',
    },
    contractNumber: 'CT-1',
    proposalNumber: null,
    remessaNfeNumber: null,
    costCenter: 'COMERCIAL',
    chartOfAccounts: '3.1 Receita',
    billingRecipientEmails: ['interno@setatelecom.com.br'],
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('t198u cadastro auxiliar em uso', () => {
  it('conta vínculos normalizando acento e caixa', () => {
    const usage = countAuxOptionUsage('costCenters', 'Comércio', {
      contracts: [{ costCenter: 'COMERCIO' }, { costCenter: 'comércio' }, { costCenter: 'Outro' }],
      invoices: [{ costCenter: 'Comercio' }],
    });
    assert.equal(usage.contracts, 2);
    assert.equal(usage.invoices, 1);
    assert.equal(auxUsageTotal(usage), 3);
  });

  it('texto factual sem alternativa de exclusão', () => {
    const text = formatAuxOptionUsageText('chartOfAccountsList', {
      contracts: 1,
      proposals: 2,
      invoices: 0,
      financialEntries: 0,
      purchaseOrders: 0,
    });
    assert.equal(text, 'Este plano de contas está em 1 contrato e 2 propostas.');
    assert.equal(text.toLowerCase().includes('inativar'), false);
    assert.equal(text.toLowerCase().includes('exclua'), false);
  });

  it('modal de bloqueio só tem Fechar e não oferece Inativar', () => {
    const src = readFileSync(
      path.join(process.cwd(), 'src/app/components/ContractBillingPanels.tsx'),
      'utf8'
    );
    assert.match(src, /Não é possível excluir/);
    assert.match(src, /data-testid="aux-cannot-delete-modal"/);
    assert.match(src, />Fechar</);
    const modal = src.slice(src.indexOf('aux-cannot-delete-modal'), src.indexOf('aux-cannot-delete-modal') + 900);
    assert.equal(/Inativar/.test(modal), false);
    assert.match(src, /title=\{inUse \? 'Em uso' : 'Excluir'\}/);
    assert.match(src, /disabled=\{inUse\}/);
    assert.match(src, /\{inUse \? 'Em uso' : 'Excluir'\}/);
  });
});

describe('t202u documentos já existentes da fatura', () => {
  it('recibo sempre disponível; placeholders de boleto/Pix não entram', () => {
    const avail = resolveInvoiceSendAttachments({
      boletoDigitableLine: 'será gerado ao finalizar',
      pixCopyPaste: 'gerado ao finalizar',
    });
    assert.equal(avail.receipt.available, true);
    assert.equal(avail.boleto.available, false);
    assert.equal(avail.boleto.hasPdf, false);
    assert.equal(avail.pix.available, false);
    const selected = defaultSelectedInvoiceAttachments(avail);
    assert.deepEqual(selected, { receipt: true, remessa: false, boleto: false, pix: false });
  });

  it('reconhece linha digitável e EMV Pix reais e remessa com chave', () => {
    const line = '34191.79001 01043.510047 91020.150008 8 98650001200000';
    const pix = '00020126580014BR.GOV.BCB.PIX0136financeiro@setatelecom.com.br5204000053039865802BR5913SETA TELECOM6009SAO PAULO';
    assert.equal(isStoredBoletoLine(line), true);
    assert.equal(isStoredPixCode(pix), true);
    const avail = resolveInvoiceSendAttachments(
      { remessaNfeNumber: '123', remessaNfeKey: '35261100000000000000550010000001231000001234', boletoDigitableLine: line, pixCopyPaste: pix }
    );
    assert.equal(avail.remessa.available, true);
    assert.equal(avail.boleto.available, true);
    assert.equal(avail.boleto.hasPdf, false);
    assert.equal(avail.pix.available, true);
    const selected = defaultSelectedInvoiceAttachments(avail);
    assert.deepEqual(selected, { receipt: true, remessa: true, boleto: true, pix: true });
  });

  it('DTO público omite dados internos e só expõe documentos existentes', () => {
    const dto = toPublicInvoiceDto(
      sampleInvoice({
        pixCopyPaste: '00020126580014BR.GOV.BCB.PIX0136financeiro@setatelecom.com.br5204000053039865802BR5913SETA TELECOM6009SAO PAULO',
        remessaNfeNumber: 'NF-9',
      })
    );
    const json = JSON.stringify(dto);
    assert.equal(json.includes('COMERCIAL'), false);
    assert.equal(json.includes('3.1 Receita'), false);
    assert.equal(json.includes('interno@setatelecom.com.br'), false);
    assert.equal(json.includes('co-1'), false);
    assert.equal(json.includes('ctr-1'), false);
    assert.equal(dto.remessaNfeNumber, 'NF-9');
    assert.equal(dto.attachments.remessa, true);
    assert.equal(dto.attachments.pix, true);
    assert.equal(dto.attachments.boleto, false);
    assert.ok(dto.issuerAddress);
  });
});

describe('t199u/t200u status emitido e tokens de link', () => {
  it('reconhece faturas emitidas e não as rascunho', () => {
    assert.equal(isIssuedInvoiceStatus('EMITIDA'), true);
    assert.equal(isIssuedInvoiceStatus('PAGA'), true);
    assert.equal(isIssuedInvoiceStatus('VENCIDA'), true);
    assert.equal(isIssuedInvoiceStatus('CANCELADA'), true);
    assert.equal(isIssuedInvoiceStatus('RASCUNHO'), false);
    assert.equal(isIssuedInvoiceStatus('ENTRADA_REGISTRADA'), false);
  });

  it('token de fatura não vale como proposta e vice-versa', () => {
    process.env.STI_HUB_PROPOSAL_LINK_SECRET = 'c'.repeat(48);
    const inv = signInvoiceLinkToken({ invoiceId: 'inv-99', ttlDays: 7, nowMs: Date.now() });
    const prop = signProposalLinkToken({ proposalId: 'prop-99', version: 1, ttlDays: 7, nowMs: Date.now() });
    assert.equal(verifyInvoiceLinkToken(inv.token, { invoiceId: 'inv-99' }).valid, true);
    assert.equal(verifyInvoiceLinkToken(prop.token, { invoiceId: 'inv-99' }).valid, false);
    assert.equal(verifyProposalLinkToken(inv.token, { proposalId: 'prop-99' }).valid, false);
    assert.equal(verifyProposalLinkToken(prop.token, { proposalId: 'prop-99' }).valid, true);
    if (savedSecret === undefined) delete process.env.STI_HUB_PROPOSAL_LINK_SECRET;
    else process.env.STI_HUB_PROPOSAL_LINK_SECRET = savedSecret;
  });

  it('janela Enviar tem Cco e caixas da fatura emitida', () => {
    const src = readFileSync(path.join(process.cwd(), 'src/app/components/ClientEmailComposerModal.tsx'), 'utf8');
    assert.match(src, /label="Cco"/);
    assert.match(src, /data-testid="invoice-send-attachments"/);
    assert.match(src, /Recibo \(PDF\)/);
    assert.match(src, /NF de remessa \(DANFE\/XML\)/);
    assert.match(src, /Boleto \(PDF e linha digitável\)/);
    assert.match(src, /Código Pix \(copia e cola e QR\)/);
    assert.match(src, /Indisponível/);
  });
});
