import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { signStiHubSessionToken } from '../src/app/lib/auth';
import { CrmApiRouter } from '../src/api/router';
import { createInMemoryRepository, type CrmRepository } from '../src/db/repository';
import type { ErpFiscalInvoice, ErpRentalContract } from '../src/db/types';
import {
  buildContractEmailBody,
  buildContractEmailPayload,
  buildContractEmailSubject,
} from '../src/app/lib/contract-email-payload';
import {
  contractEmailNeedsInvoice,
  contractEmailWantsProposalLink,
  defaultSelectedContractAttachments,
  resolveContractEmailAttachments,
  selectedInvoiceAttachmentKinds,
} from '../src/modules/erp/contract-email-compose';
import {
  addRecipientChips,
  joinRecipientList,
  parseRecipientList,
  rankRecipientSuggestions,
  tokenizeRecipientInput,
  toRecipientChip,
} from '../src/modules/erp/email-recipients';

const HTTP = { _fromHttpBridge: '1' };
const saved: Record<string, string | undefined> = {};

before(() => {
  saved.STI_HUB_SESSION_SECRET = process.env.STI_HUB_SESSION_SECRET;
  process.env.STI_HUB_SESSION_SECRET = process.env.STI_HUB_SESSION_SECRET || 's'.repeat(48);
});

after(() => {
  if (saved.STI_HUB_SESSION_SECRET === undefined) delete process.env.STI_HUB_SESSION_SECRET;
  else process.env.STI_HUB_SESSION_SECRET = saved.STI_HUB_SESSION_SECRET;
});

function sampleContract(overrides: Partial<ErpRentalContract> = {}): ErpRentalContract {
  return {
    id: 'ctr-loc-107',
    contractNumber: 'LOC-2026-107',
    title: 'Locação MUNDIVOX',
    companyId: 'co-mundivox',
    companyName: 'MUNDIVOX COMUNICACOES LTDA',
    companyCnpj: '07.228.550/0001-19',
    contactId: null,
    dealId: null,
    proposalId: null,
    monthlyValue: 4320,
    dueDay: 10,
    startDate: '2026-01-10',
    endDate: '2027-01-10',
    contractMonths: 12,
    readjustmentIndex: 'IPCA',
    status: 'ATIVO',
    equipments: [],
    remessaNfeNumber: '',
    remessaCfop: '5.908',
    legalBasisNote: '',
    lastBilledCompetence: null,
    nextDueDate: '2026-11-10',
    billingRecipientEmails: ['financeiro@mundivox.example'],
    createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
    ...overrides,
  };
}

function sampleInvoice(overrides: Partial<ErpFiscalInvoice> = {}): ErpFiscalInvoice {
  return {
    id: 'inv-1',
    documentNumber: 'FAT-2026-088',
    documentType: 'FATURA_LOCACAO',
    competenceMonth: '11/2026',
    companyId: 'co-mundivox',
    companyName: 'MUNDIVOX COMUNICACOES LTDA',
    companyCnpj: '07.228.550/0001-19',
    companyAddress: 'Rua A, 1',
    rentalContractId: 'ctr-loc-107',
    proposalId: null,
    dealId: null,
    grossAmount: 4320,
    discountAmount: 0,
    netAmount: 4320,
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
    itemsDescription: [{ description: 'Rádio', quantity: 1, unitValue: 4320, totalValue: 4320 }],
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
      netReceivableAmount: 4320,
      legalExemptionNotice: 'SV 31',
    },
    contractNumber: 'LOC-2026-107',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

const tokFor = (repo: CrmRepository, uid = 'usr-seta-01') => {
  const r = repo.findRbacUserRecord(uid, '')!;
  return signStiHubSessionToken({
    uid: r.id,
    email: r.email,
    name: r.name,
    roleId: r.roleId,
    scope: r.scope,
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'],
    moduleAccess: { crm: true, erp: true, chamados: true },
    mfaVerified: true,
    mfaMethod: 'TOTP_AUTHENTICATOR',
    iat: Date.now() - 1000,
    exp: Date.now() + 3_600_000,
  } as Parameters<typeof signStiHubSessionToken>[0]);
};

describe('t211u anexos do e-mail do contrato', () => {
  it('sem fatura e sem proposta: opções desabilitadas com motivo, e proposta nunca bloqueia o envio', () => {
    const resolved = resolveContractEmailAttachments({
      proposalId: null,
      invoice: null,
    });
    assert.equal(resolved.linkedProposalId, '');
    assert.equal(resolved.options.receipt.available, false);
    assert.equal(resolved.options.receipt.reason, 'Sem fatura emitida');
    assert.equal(resolved.options.boleto.available, false);
    assert.equal(resolved.options.boleto.reason, 'Sem fatura emitida');
    assert.equal(resolved.options.pix.available, false);
    assert.equal(resolved.options.pix.reason, 'Sem fatura emitida');
    assert.equal(resolved.options.remessa.available, false);
    assert.equal(resolved.options.remessa.reason, 'Sem NF/XML/DANFE');
    assert.equal(resolved.options.proposal.available, false);
    assert.equal(resolved.options.proposal.reason, 'Sem proposta vinculada');
    const selected = defaultSelectedContractAttachments(resolved.options);
    assert.deepEqual(selected, { receipt: false, boleto: false, proposal: false, pix: false, remessa: false });
    assert.equal(contractEmailWantsProposalLink(selected, ''), false);
    assert.equal(contractEmailNeedsInvoice(selected), false);
  });

  it('fatura com boleto, Pix e NF habilita os anexos correspondentes', () => {
    const line = '34191.79001 01043.510047 91020.150008 8 98650001200000';
    const pix = '00020126580014BR.GOV.BCB.PIX0136financeiro@setatelecom.com.br5204000053039865802BR5913SETA TELECOM6009SAO PAULO';
    const resolved = resolveContractEmailAttachments({
      proposalId: 'prop-1',
      invoice: {
        boletoDigitableLine: line,
        pixCopyPaste: pix,
        remessaNfeNumber: '359',
        remessaNfeKey: '35261100000000000000550010000001231000001234',
      },
    });
    assert.equal(resolved.options.receipt.available, true);
    assert.equal(resolved.options.boleto.available, true);
    assert.equal(resolved.options.pix.available, true);
    assert.equal(resolved.options.remessa.available, true);
    assert.equal(resolved.options.proposal.available, true);
    const selected = defaultSelectedContractAttachments(resolved.options);
    assert.equal(selected.proposal, true);
    assert.deepEqual(selectedInvoiceAttachmentKinds(selected), ['receipt', 'remessa', 'boleto', 'pix']);
    assert.equal(contractEmailWantsProposalLink(selected, 'prop-1'), true);
  });

  it('placeholders de boleto/Pix não habilitam o anexo e a proposta sem id permanece desabilitada', () => {
    const resolved = resolveContractEmailAttachments({
      invoice: {
        boletoDigitableLine: 'será gerado ao finalizar',
        pixCopyPaste: 'gerado ao finalizar',
      },
    });
    assert.equal(resolved.options.receipt.available, true);
    assert.equal(resolved.options.boleto.available, false);
    assert.equal(resolved.options.boleto.reason, 'Sem linha digitável');
    assert.equal(resolved.options.pix.available, false);
    assert.equal(resolved.options.pix.reason, 'Sem código Pix');
    assert.equal(resolved.options.proposal.available, false);
    assert.equal(resolved.options.proposal.reason, 'Sem proposta vinculada');
  });

  it('assunto e corpo do contrato começam neutros e citam os anexos selecionados', () => {
    const selected = { receipt: true, boleto: true, proposal: false, pix: true, remessa: false };
    const subject = buildContractEmailSubject({
      contractNumber: 'LOC-2026-107',
      companyName: 'MUNDIVOX COMUNICACOES LTDA',
      selected,
    });
    assert.match(subject, /Contrato #LOC-2026-107/);
    assert.match(subject, /Recibo, Boleto, QR Code Pix/);
    assert.doesNotMatch(subject, /Proposta/);
    const body = buildContractEmailBody({
      recipientName: 'Ana',
      companyName: 'MUNDIVOX COMUNICACOES LTDA',
      contractNumber: 'LOC-2026-107',
      selected,
      invoiceCode: 'FAT-2026-088',
      boletoLine: '34191.79001 01043.510047 91020.150008 8 98650001200000',
      pixCode: '00020126580014BR.GOV.BCB.PIX0136financeiro@setatelecom.com.br5204000053039865802BR5913SETA TELECOM6009SAO PAULO',
    });
    assert.match(body, /Olá, Ana,/);
    assert.match(body, /contrato #LOC-2026-107/);
    assert.match(body, /Recibo da fatura FAT-2026-088/);
    assert.match(body, /Boleto/);
    assert.match(body, /QR Code Pix/);
    assert.doesNotMatch(body, /Proposta comercial/);
  });

  it('payload do contrato sem proposta vinculada não pede identificador de proposta', () => {
    const payload = buildContractEmailPayload(sampleContract(), {
      invoices: [sampleInvoice()],
    });
    assert.equal(payload.contractId, 'ctr-loc-107');
    assert.equal(payload.proposalId, null);
    assert.equal(payload.invoiceId, 'inv-1');
    assert.equal(payload.docType, 'RENTAL_RECEIPT');
    assert.equal(payload.recipientEmail, 'financeiro@mundivox.example');
    assert.equal(payload.invoiceChoices?.length, 1);
    assert.equal(contractEmailWantsProposalLink({ proposal: false }, payload.proposalId), false);
  });

  it('com várias faturas emitidas, a mais recente vem primeiro e a proposta vinculada aparece', () => {
    const payload = buildContractEmailPayload(sampleContract({ proposalId: 'prop-xyz' }), {
      invoices: [
        sampleInvoice({ id: 'inv-old', documentNumber: 'FAT-2026-010', competenceMonth: '10/2026', issueDate: '2026-10-01', createdAt: '2026-10-01T00:00:00.000Z' }),
        sampleInvoice({ id: 'inv-new', documentNumber: 'FAT-2026-088', competenceMonth: '11/2026', issueDate: '2026-11-01', createdAt: '2026-11-01T00:00:00.000Z' }),
      ],
    });
    assert.equal(payload.invoiceId, 'inv-new');
    assert.equal(payload.invoiceChoices?.[0].id, 'inv-new');
    assert.equal(payload.invoiceChoices?.[1].id, 'inv-old');
    assert.equal(payload.proposalId, 'prop-xyz');
  });

  it('o modal de contrato troca o tipo de e-mail por anexos e usa etiquetas de destinatário', () => {
    const composer = readFileSync(path.join(process.cwd(), 'src/app/components/ClientEmailComposerModal.tsx'), 'utf8');
    const opener = readFileSync(path.join(process.cwd(), 'src/app/components/ErpGestaoClickTab.tsx'), 'utf8');
    const compose = readFileSync(path.join(process.cwd(), 'src/modules/erp/contract-email-compose.ts'), 'utf8');
    assert.match(composer, /data-testid="contract-send-attachments"/);
    assert.match(compose, /Sem proposta vinculada/);
    assert.match(compose, /QR Code Pix/);
    assert.match(composer, /opt\.reason/);
    assert.match(composer, /isContractSend/);
    assert.match(composer, /email-recipient-to/);
    assert.match(composer, /label="Cco"/);
    assert.match(composer, /contractEmailWantsProposalLink/);
    assert.match(opener, /buildContractEmailPayload/);
    assert.doesNotMatch(
      opener.slice(opener.indexOf('ENVIAR_EMAIL'), opener.indexOf('ENVIAR_EMAIL') + 700),
      /docType: "TICKET_REPLY"/
    );
  });
});

describe('t211u destinatários em etiquetas', () => {
  it('vírgula, ponto e vírgula e Enter separam endereços livres', () => {
    assert.deepEqual(tokenizeRecipientInput('ana@cliente.com,').completed, ['ana@cliente.com']);
    assert.deepEqual(tokenizeRecipientInput('ana@cliente.com; bruno@cliente.com').completed, ['ana@cliente.com']);
    assert.equal(tokenizeRecipientInput('ana@cliente.com; bruno@cliente.com').rest, 'bruno@cliente.com');
    const chips = parseRecipientList('ana@cliente.com, invalido, fiscal@setatelecom.com.br');
    assert.equal(chips.length, 3);
    assert.equal(chips[0].invalid, false);
    assert.equal(chips[1].email, 'invalido');
    assert.equal(chips[1].invalid, true);
    assert.equal(chips[2].invalid, false);
    assert.equal(joinRecipientList(chips), 'ana@cliente.com, invalido, fiscal@setatelecom.com.br');
  });

  it('valida o formato e respeita o limite de 20 destinatários no total', () => {
    assert.equal(toRecipientChip('nao-e-email').invalid, true);
    assert.equal(toRecipientChip('ok@setatelecom.com.br').invalid, false);
    const existing = parseRecipientList(Array.from({ length: 18 }, (_, i) => `u${i}@ex.com`).join(', '));
    const next = addRecipientChips(existing, ['mais@ex.com', 'outro@ex.com', 'estouro@ex.com'], { otherCount: 1, max: 20 });
    assert.equal(next.chips.length, 19);
    assert.equal(next.limitReached, true);
    assert.equal(next.chips.some((c) => c.email === 'estouro@ex.com'), false);
  });

  it('ordena contatos do cliente, depois os demais, depois usuários internos', () => {
    const ranked = rankRecipientSuggestions([
      { email: 'interno@setatelecom.com.br', name: 'Interno', source: 'internal', companyName: 'Seta Telecom' },
      { email: 'outro@ex.com', name: 'Outro', source: 'contact', companyName: 'Outra' },
      { email: 'ana@mundivox.example', name: 'Ana', source: 'company_contact', companyName: 'MUNDIVOX' },
    ]);
    assert.deepEqual(ranked.map((r) => r.source), ['company_contact', 'contact', 'internal']);
  });
});

describe('GET /api/communications/recipients', () => {
  it('exige sessão e devolve só nome, e-mail, origem e empresa', async () => {
    const repo = createInMemoryRepository();
    const router = new CrmApiRouter(repo);
    const noAuth = await router.dispatch({
      method: 'GET',
      path: '/api/communications/recipients',
      query: { ...HTTP, q: 'ana' },
    });
    assert.equal(noAuth.status, 401);

    const company = repo.createCompany({ name: 'MUNDIVOX COMUNICACOES LTDA' });
    repo.createContact({ firstName: 'Ana', lastName: 'Cliente', email: 'ana.cliente@mundivox.example', companyId: company.id });
    repo.createContact({ firstName: 'Bruno', lastName: 'Outro', email: 'bruno.outro@exemplo.invalid' });
    repo.upsertRbacUser({
      email: 'interno.lote@setatelecom.com.br',
      name: 'Interno Lote',
      roleId: 'VENDEDOR_SALES',
    } as Parameters<typeof repo.upsertRbacUser>[0]);

    const companyHits = await router.dispatch({
      method: 'GET',
      path: '/api/communications/recipients',
      query: { ...HTTP, _sessionToken: tokFor(repo), q: 'ana', companyId: company.id, _clientIp: '198.51.100.81' },
    });
    assert.equal(companyHits.status, 200, JSON.stringify(companyHits.body));
    const companyData = (companyHits.body as { data: Array<Record<string, unknown>> }).data;
    assert.equal(companyData[0].email, 'ana.cliente@mundivox.example');
    assert.equal(companyData[0].source, 'company_contact');
    assert.equal(Object.keys(companyData[0]).sort().join(','), 'companyName,email,name,source');

    const internalHits = await router.dispatch({
      method: 'GET',
      path: '/api/communications/recipients',
      query: { ...HTTP, _sessionToken: tokFor(repo), q: 'interno.lote', _clientIp: '198.51.100.82' },
    });
    assert.equal(internalHits.status, 200);
    const internalData = (internalHits.body as { data: Array<Record<string, unknown>> }).data;
    assert.ok(internalData.some((row) => row.email === 'interno.lote@setatelecom.com.br' && row.source === 'internal'));
    assert.equal(JSON.stringify(internalHits.body).includes('totpSecret'), false);
    assert.equal(JSON.stringify(internalHits.body).includes('passwordHash'), false);
    assert.equal(JSON.stringify(internalHits.body).includes('roleId'), false);
  });
});
