import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ErpCommercialProposal, ErpProposalItem } from '../src/db/types';
import { proposalItemDetails } from '../src/app/lib/proposal-item-grid';
import { toPublicProposalDto, publicDtoToRenderableProposal } from '../src/app/lib/proposal-public-dto';
import { buildInternalProposalSheet } from '../src/app/lib/internal-proposal-sheet';
import { encodeProposalToQueryParam, decodeProposalFromQueryParam } from '../src/app/lib/proposal-share';
import { clientProposalIntroduction, DEFAULT_PROPOSAL_INTRODUCTION, displayProposalTitle } from '../src/app/lib/proposal-title';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

function sampleProposal(items: Partial<ErpProposalItem>[]): ErpCommercialProposal {
  return {
    id: 'prop-detalhes',
    code: '4800',
    title: 'Proposta com detalhes',
    companyId: null,
    companyName: 'Cliente',
    companyCnpj: '03.241.757/0001-65',
    contactId: null,
    contactName: '',
    dealId: null,
    sellerName: 'Marcelo Lopes Mira',
    status: 'ENVIADA',
    contractMonths: 12,
    paymentCondition: 'À vista',
    validUntil: '2026-12-31',
    items: items.map((it, idx) => ({
      id: it.id || `it-${idx + 1}`,
      sku: it.sku ?? '90943156',
      description: it.description || 'Dell PowerEdge 2x Gold 6152',
      itemType: it.itemType || 'PRODUCT',
      fiscalNature: it.fiscalNature || 'VENDA_EQUIPAMENTO',
      ncmOrServiceCode: it.ncmOrServiceCode ?? 'NCM 8471.50.10',
      details: it.details,
      quantity: it.quantity ?? 1,
      unitPrice: it.unitPrice ?? 3645,
      discountPercent: it.discountPercent ?? 0,
      discountAmount: it.discountAmount ?? 0,
      subtotal: it.subtotal ?? 3645,
      isRecurring: it.isRecurring ?? false,
      totalMonthly: it.totalMonthly ?? 3645,
    })),
    monthlyRecurringTotal: 0,
    oneTimeSetupTotal: 3645,
    totalContractValue: 3645,
    commercialNotes: '',
    technicalClauses: '',
    createdAt: '2026-11-26T00:00:00.000Z',
    updatedAt: '2026-11-26T00:00:00.000Z',
    version: 1,
  };
}

describe('Detalhes do item na visualização e no PDF da proposta', () => {
  it('o DTO público leva o texto livre e omite NCM; a folha A4 e o PDF interno exibem abaixo do nome', () => {
    const proposal = sampleProposal([
      { details: '6x SSD 1Tb. 256Gb Ram DDR4' },
      {
        id: 'it-svc',
        sku: 'SUP-N1',
        description: 'Suporte técnico remoto N1/N2',
        itemType: 'SERVICE',
        fiscalNature: 'SERVICO_TECNICO_TI_TELECOM',
        ncmOrServiceCode: '',
        details: 'Atendimento 8x5, até 4 horas',
        unitPrice: 1100,
        subtotal: 1100,
        totalMonthly: 1100,
        isRecurring: true,
      },
    ]);

    assert.equal(proposalItemDetails(proposal.items[0]), '6x SSD 1Tb. 256Gb Ram DDR4');
    assert.equal(proposalItemDetails({ ncmOrServiceCode: 'NCM 8471.50.10' }), '');

    const dto = toPublicProposalDto(proposal);
    assert.equal(dto.items[0].details, '6x SSD 1Tb. 256Gb Ram DDR4');
    assert.equal(dto.items[1].details, 'Atendimento 8x5, até 4 horas');
    const dtoJson = JSON.stringify(dto);
    assert.doesNotMatch(dtoJson, /NCM 8471\.50\.10/);
    assert.doesNotMatch(dtoJson, /ncmOrServiceCode|"sku"/);

    const renderable = publicDtoToRenderableProposal(dto, 'prop-detalhes');
    assert.equal(proposalItemDetails(renderable.items[0]), '6x SSD 1Tb. 256Gb Ram DDR4');
    assert.equal(proposalItemDetails(renderable.items[1]), 'Atendimento 8x5, até 4 horas');
    assert.equal(renderable.items[0].ncmOrServiceCode, '');
    assert.equal(renderable.items[0].sku, '');

    const page = src('src/app/proposta/[id]/page.tsx');
    assert.ok(page.includes('proposalItemDetails'));
    assert.ok(page.includes('data-testid="proposal-item-details"'));
    assert.match(page, /item\.description[\s\S]{0,400}itemDetails/);

    const sheet = buildInternalProposalSheet(proposal, 'PRODUTOS');
    assert.equal(sheet.lines[0].name, 'Dell PowerEdge 2x Gold 6152');
    assert.match(sheet.lines[0].detail, /6x SSD 1Tb\. 256Gb Ram DDR4/);
    assert.match(sheet.lines[0].detail, /NCM 8471\.50\.10/);
    assert.equal(sheet.lines[1].name, 'Suporte técnico remoto N1/N2');
    assert.equal(sheet.lines[1].detail, 'Atendimento 8x5, até 4 horas');

    const encoded = encodeProposalToQueryParam(proposal);
    const decoded = decodeProposalFromQueryParam(encoded);
    assert.ok(decoded);
    assert.equal(proposalItemDetails(decoded!.items[0]), '6x SSD 1Tb. 256Gb Ram DDR4');
    assert.equal(proposalItemDetails(decoded!.items[1]), 'Atendimento 8x5, até 4 horas');
  });
});

describe('Folha e PDF do cliente sem título interno nem parágrafo fixo', () => {
  it('omite o parágrafo padrão e mantém só introdução personalizada, sem apagar o dado', () => {
    assert.equal(clientProposalIntroduction(DEFAULT_PROPOSAL_INTRODUCTION), '');
    assert.equal(clientProposalIntroduction(`  ${DEFAULT_PROPOSAL_INTRODUCTION}  `), '');
    assert.equal(
      clientProposalIntroduction(`${DEFAULT_PROPOSAL_INTRODUCTION}\nPrazo de instalação: 10 dias úteis.`),
      'Prazo de instalação: 10 dias úteis.'
    );
    assert.equal(clientProposalIntroduction('Escopo alinhado com a equipe de campo.'), 'Escopo alinhado com a equipe de campo.');
    assert.equal(
      displayProposalTitle({ title: 'Orçamento #4699 — EVAMIND SOLUCOES EM TECNOLOGIA LTDA (Cópia)', code: '4699', companyName: 'EVAMIND' }),
      'Orçamento #4699 — EVAMIND SOLUCOES EM TECNOLOGIA LTDA (Cópia)'
    );
  });

  it('a folha /proposta não renderiza o título interno nem o parágrafo fixo; o ERP continua mostrando o título', () => {
    const page = src('src/app/proposta/[id]/page.tsx');
    const tab = src('src/app/components/ErpGestaoClickTab.tsx');
    const repo = src('src/db/repository.ts');
    assert.ok(page.includes('clientProposalIntroduction'));
    assert.equal(page.includes('displayProposalTitle(proposal)'), false);
    assert.equal(page.includes(DEFAULT_PROPOSAL_INTRODUCTION), false);
    assert.match(page, /shownIntroduction \? \(/);
    assert.ok(tab.includes('displayProposalTitle(prop)'));
    assert.ok(repo.includes('DEFAULT_PROPOSAL_INTRODUCTION'));
    assert.ok(repo.includes('input.introductionText ||'));
  });
});
