import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildProposalCopyDraft,
  proposalCopyCreatedToast,
  recalculateProposalValidity,
} from '../src/app/lib/proposal-copy';
import type { ErpCommercialProposal } from '../src/db/types';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

function base(patch: Partial<ErpCommercialProposal> = {}): ErpCommercialProposal {
  return {
    id: 'prop-origem-4726',
    code: '4726',
    title: 'Fornecimento de Switches',
    budgetType: 'PRODUTOS',
    companyName: 'FOXCONN BRASIL',
    companyCnpj: '00.000.000/0001-00',
    status: 'ENVIADA',
    contractMonths: 24,
    proposalDate: '2026-11-10',
    validUntil: '2026-11-25',
    slaTier: 'CORPORATIVO_8X5_NBD',
    slaAvailabilityPercent: '99,50%',
    slaResponseHours: 4,
    setupFee: 500,
    monthlyRecurringTotal: 0,
    oneTimeSetupTotal: 8500,
    totalContractValue: 8500,
    shippingCost: 0,
    paymentCondition: 'Boleto',
    sellerName: 'Marcelo Mira',
    version: 3,
    versionHistory: [
      {
        version: 3,
        versionLabel: 'v3.0',
        savedAt: '2026-11-20T12:00:00Z',
        savedBy: 'Marcelo Mira',
        changedFields: ['itens'],
        changeSummary: 'Ajuste',
        snapshot: { title: 'Fornecimento de Switches' },
      },
    ],
    statusHistory: [{ status: 'ENVIADA', changedAt: '2026-11-11T10:00:00Z' } as never],
    convertedContractId: 'ctr-1',
    convertedInvoiceId: 'inv-1',
    digitalSignature: { signedAt: '2026-11-12T10:00:00Z' } as never,
    approvalMode: 'MANUAL',
    approvalJustification: 'ok',
    approvedBy: 'admin',
    approvedAt: '2026-11-12T10:00:00Z',
    approvalIdempotencyKeySha256: 'abc',
    lastEmailSentAt: '2026-11-11T11:00:00Z',
    emailHistory: [{ sentAt: '2026-11-11T11:00:00Z' } as never],
    firstViewedAt: '2026-11-11T12:00:00Z',
    lastViewedAt: '2026-11-12T12:00:00Z',
    viewCount: 4,
    sellerUserId: 'user-1',
    createdByServiceAccount: true,
    createdAt: '2026-11-10T15:00:00Z',
    updatedAt: '2026-11-20T12:00:00Z',
    items: [
      {
        id: 'i1',
        description: 'Switch Cisco 3850',
        quantity: 1,
        unitPrice: 8500,
        isRecurring: false,
        totalMonthly: 8500,
        subtotal: 8500,
        fiscalNature: 'VENDA_EQUIPAMENTO',
        itemType: 'PRODUCT',
      },
    ],
    ...patch,
  } as ErpCommercialProposal;
}

describe('Gerar cópia do orçamento abre a cópia para edição', () => {
  const now = new Date('2026-11-25T18:00:00.000Z');

  it('recalcula a validade com a mesma janela a partir de hoje', () => {
    assert.equal(
      recalculateProposalValidity({ proposalDate: '2026-11-10', validUntil: '2026-11-25' }, now),
      '2026-12-10'
    );
    assert.equal(recalculateProposalValidity({}, now), '2026-12-10', 'padrão de 15 dias quando não há validade');
  });

  it('a cópia nasce Versão 1, rascunho, data de hoje, sem histórico de envio, link ou aprovação', () => {
    const copy = buildProposalCopyDraft(base(), { nextCode: '4727', now, newId: 'prop-copy-1' });
    assert.equal(copy.id, 'prop-copy-1');
    assert.equal(copy.code, '4727');
    assert.equal(copy.status, 'RASCUNHO');
    assert.equal(copy.version, 1);
    assert.equal(copy.proposalDate, '2026-11-25');
    assert.equal(copy.validUntil, '2026-12-10');
    assert.deepEqual(copy.versionHistory, []);
    assert.deepEqual(copy.statusHistory, []);
    assert.equal(copy.convertedContractId, null);
    assert.equal(copy.convertedInvoiceId, null);
    assert.equal(copy.digitalSignature, null);
    assert.equal(copy.approvalMode, undefined);
    assert.equal(copy.approvalJustification, undefined);
    assert.equal(copy.approvedBy, undefined);
    assert.equal(copy.approvedAt, undefined);
    assert.equal(copy.approvalIdempotencyKeySha256, undefined);
    assert.equal(copy.lastEmailSentAt, null);
    assert.deepEqual(copy.emailHistory, []);
    assert.equal(copy.firstViewedAt, null);
    assert.equal(copy.lastViewedAt, null);
    assert.equal(copy.viewCount, 0);
    assert.equal(copy.sellerUserId, undefined);
    assert.equal(copy.createdByServiceAccount, undefined);
    assert.equal((copy as unknown as Record<string, unknown>).gcSource, undefined);
    assert.equal((copy as unknown as Record<string, unknown>).__summary, undefined);
    assert.ok(copy.items[0].id !== 'i1');
    assert.equal(copy.items[0].description, 'Switch Cisco 3850');
    assert.equal(copy.companyName, 'FOXCONN BRASIL');
    assert.notEqual(copy.id, 'prop-origem-4726');
  });

  it('em produtos, respeita o PR #44: sem SLA, setup zerado, prazo 1 e título automático se o nome era o padrão', () => {
    const withAuto = buildProposalCopyDraft(
      base({ title: 'Orçamento de Produtos nº 4726 — FOXCONN BRASIL' }),
      { nextCode: '4727', now, newId: 'prop-copy-2' }
    );
    assert.equal(withAuto.title, 'Orçamento de Produtos nº 4727 — FOXCONN BRASIL');
    assert.equal(withAuto.slaTier, 'SEM_SLA_ESPECIFICO');
    assert.equal(withAuto.slaAvailabilityPercent, '');
    assert.equal(withAuto.slaResponseHours, 0);
    assert.equal(withAuto.contractMonths, 1);
    assert.equal(withAuto.setupFee, 0);

    const withCustom = buildProposalCopyDraft(base({ title: 'Fornecimento de Switches' }), {
      nextCode: '4727',
      now,
      newId: 'prop-copy-3',
    });
    assert.equal(withCustom.title, 'Fornecimento de Switches (Cópia)');
  });

  it('em locação, o nome ganha (Cópia) e o SLA/contrato seguem iguais', () => {
    const copy = buildProposalCopyDraft(
      base({
        budgetType: 'LOCACAO',
        title: 'Locação PABX',
        contractMonths: 36,
        slaTier: 'CORPORATIVO_8X5_NBD',
        setupFee: 1500,
        items: [
          {
            id: 'i1',
            sku: 'PABX-01',
            description: 'PABX',
            ncmOrServiceCode: 'NCM 8517.62.14',
            quantity: 1,
            unitPrice: 2000,
            discountPercent: 0,
            isRecurring: true,
            totalMonthly: 2000,
            subtotal: 2000,
            fiscalNature: 'LOCACAO_BENS_MOVEIS',
            itemType: 'PRODUCT',
          },
        ],
      }),
      { nextCode: '4728', now, newId: 'prop-copy-4' }
    );
    assert.equal(copy.title, 'Locação PABX (Cópia)');
    assert.equal(copy.budgetType, 'LOCACAO');
    assert.equal(copy.contractMonths, 36);
    assert.equal(copy.slaTier, 'CORPORATIVO_8X5_NBD');
    assert.equal(copy.setupFee, 1500);
  });


  it('título legado "Orçamento #N" e (Cópia) viram o padrão com o número novo, sem herdar o negócio', () => {
    const evamind = base({
      id: 'prop-gc-409244925',
      code: '4699',
      title: 'Orçamento #4699 — EVAMIND SERVICOS DE TECNOLOGIA DA INFORMACAO LTDA',
      budgetType: 'LOCACAO',
      companyName: 'EVAMIND SERVICOS DE TECNOLOGIA DA INFORMACAO LTDA',
      dealId: 'deal-1795640092157-ugbt',
      monthlyRecurringTotal: 1450,
      totalContractValue: 34800,
      contractMonths: 24,
      proposalDate: '2026-10-30',
      validUntil: '2026-10-30',
    });
    const copy = buildProposalCopyDraft(evamind, { nextCode: '4727', now, newId: 'prop-copy-evamind' });
    assert.equal(copy.title, 'Orçamento de Locação nº 4727 — EVAMIND SERVICOS DE TECNOLOGIA DA INFORMACAO LTDA');
    assert.equal(copy.dealId, null);
    assert.equal(copy.validUntil, '2026-12-10');

    const fromCopy = buildProposalCopyDraft(
      { ...copy, id: 'prop-4727', code: '4727', title: 'Orçamento #4699 — EVAMIND SERVICOS DE TECNOLOGIA DA INFORMACAO LTDA (Cópia)', dealId: 'deal-1795640092157-ugbt' },
      { nextCode: '4728', now: new Date('2026-11-26T13:11:15.000Z'), newId: 'prop-copy-evamind-2' }
    );
    assert.equal(fromCopy.title, 'Orçamento de Locação nº 4728 — EVAMIND SERVICOS DE TECNOLOGIA DA INFORMACAO LTDA');
    assert.equal(fromCopy.dealId, null);
    assert.doesNotMatch(fromCopy.title, /4699|Cópia/i);
  });

  it('o aviso é discreto e cita o número de origem', () => {
    assert.equal(proposalCopyCreatedToast('4726'), 'Cópia do orçamento #4726 criada');
    assert.equal(proposalCopyCreatedToast('GC-ORC-4726'), 'Cópia do orçamento #4726 criada');
  });

  it('a listagem e a tela do orçamento abrem a cópia no formulário, sem gravar até o salvar', () => {
    const tab = src('src/app/components/ErpGestaoClickTab.tsx');
    const modal = src('src/app/components/ErpEditModals.tsx');
    const fnStart = tab.indexOf('const handleDuplicateProposal =');
    const fn = tab.slice(fnStart, fnStart + 2200);
    assert.match(fn, /buildProposalCopyDraft/);
    assert.match(fn, /setIsCreatingProposalModal\(true\)/);
    assert.match(fn, /setEditingProposal\(draft\)/);
    assert.match(fn, /proposalCopyCreatedToast/);
    assert.equal(fn.includes('method: "POST"') || fn.includes("method: 'POST'"), false, 'a cópia não deve ser POST até o usuário salvar');
    assert.equal(fn.includes('/api/erp/proposals"') && fn.includes('JSON.stringify(copyPayload)'), false);

    assert.match(tab, /data-testid="menu-gerar-copia"/);
    assert.match(tab, /key=\{editingProposal\.id\}/);
    assert.match(tab, /onGenerateCopy=\{isCreatingProposalModal \? undefined/);
    assert.match(modal, /data-testid="proposal-generate-copy"/);
    assert.match(modal, /Gerar cópia/);
  });
});
