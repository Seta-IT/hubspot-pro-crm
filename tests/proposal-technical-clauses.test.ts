import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildInternalProposalSheet } from '../src/app/lib/internal-proposal-sheet';
import { SETA_INTERNAL_CLAUSES, SETA_INTERNAL_CONFIDENTIALITY } from '../src/app/lib/internal-proposal-copy';
import {
  buildDefaultTechnicalSupportClauses,
  displayProposalTechnicalClauses,
  isDefaultTechnicalSupportClauses,
  isTechnicalSupportProposal,
  looksLikeLegacyEquipmentTechnicalClauses,
  resolveTechnicalClausesOnEdit,
  TECHNICAL_SUPPORT_CONFIDENTIALITY,
  TECHNICAL_SUPPORT_ITEM_1,
  TECHNICAL_SUPPORT_ITEM_3,
  TECHNICAL_SUPPORT_ITEM_4,
  TECHNICAL_SUPPORT_ITEM_5_AVULSO,
  TECHNICAL_SUPPORT_ITEM_5_MONTHLY,
} from '../src/app/lib/proposal-technical-clauses';
import type { ErpCommercialProposal } from '../src/db/types';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const LEGACY_EQUIPMENT_TEXT = `As informações contidas nesta proposta comercial são de caráter sigiloso, com intuito de evitar a divulgação a terceiros de qualquer informação trocada entre as partes, que estejam diretamente relacionadas ao serviço prestado ao cliente.
Este termo de confidencialidade é firmado com o intuito de proibir a divulgação e utilização não autorizada das informações confidenciais trocadas entre as PARTES por ocasião da realização do Serviço contratado pelo CLIENTE, mediante proposta assinada pelo mesmo.

1. Os equipamentos descritos na NF de remessa serão enviados ao Contratante na modalidade de comodato.
2. A Prazo inicial da Locação será de XX meses, podendo ser prorrogado, caso haja interesse das partes. O valor total da locação é de R$ XXXXXXX
3. Será concedido o prazo de 10 dias úteis para assinatura do Contrato de Locação pela Contratante, a contar do efetivo recebimento dos equipamentos.
4. Caso o contrato não seja formalizado em até 30 dias, a Contratada fica desde já autorizada a faturar os equipamentos em nome da Contratante, no valor descrito na NF de remessa.
5. O prazo de entrega será estimado. Serão considerados caso fortuito ou força maior, eventuais atrasos na entrega dos equipamentos provenientes de processos de importação (atrasos decorrentes de transporte aéreo ou marítimo, desembaraço aduaneiro, greves de servidores da Receita Federal). Tais fatos não podem ensejar multa por descumprimento contractual, ou incidência de multa.`;

function proposal(patch: Partial<ErpCommercialProposal> = {}): ErpCommercialProposal {
  return {
    id: 'prop-suporte',
    code: '4802',
    title: 'Suporte técnico',
    budgetType: 'SERVICOS',
    serviceType: 'Suporte Técnico',
    companyName: 'Cliente',
    status: 'RASCUNHO',
    contractMonths: 24,
    monthlyRecurringTotal: 2500,
    totalContractValue: 60000,
    deliveryLeadTime: '10 dias úteis após o aceite',
    items: [],
    oneTimeSetupTotal: 0,
    shippingCost: 0,
    technicalClauses: '',
    createdAt: '2026-11-19T00:00:00.000Z',
    updatedAt: '2026-11-19T00:00:00.000Z',
    ...patch,
  } as ErpCommercialProposal;
}

describe('Texto padrão das observações de suporte técnico', () => {
  it('reconhece só proposta SERVICOS cujo tipo inclui Suporte Técnico', () => {
    assert.equal(isTechnicalSupportProposal({ budgetType: 'SERVICOS', serviceType: 'Suporte Técnico' }), true);
    assert.equal(isTechnicalSupportProposal({ budgetType: 'SERVICOS', serviceType: '' }), true);
    assert.equal(
      isTechnicalSupportProposal({ budgetType: 'SERVICOS', serviceType: 'Spare Parts / Hard Parts' }),
      false
    );
    assert.equal(
      isTechnicalSupportProposal({ budgetType: 'CONJUNTO', serviceType: 'Suporte Técnico' }),
      false
    );
    assert.equal(isTechnicalSupportProposal({ budgetType: 'LOCACAO', serviceType: 'Suporte Técnico' }), false);
    assert.equal(isTechnicalSupportProposal({ budgetType: 'PRODUTOS' }), false);
  });

  it('variante mensal/contrato usa vigência > 1 mês, itens 2 e 5 aprovados e valores da proposta', () => {
    const text = buildDefaultTechnicalSupportClauses(proposal({ contractMonths: 12, monthlyRecurringTotal: 1800 }));
    assert.ok(text.startsWith(TECHNICAL_SUPPORT_CONFIDENTIALITY));
    assert.ok(text.includes(TECHNICAL_SUPPORT_ITEM_1));
    assert.ok(text.includes(TECHNICAL_SUPPORT_ITEM_3));
    assert.ok(text.includes(TECHNICAL_SUPPORT_ITEM_4));
    assert.ok(
      text.includes(
        '2. O prazo inicial da prestação de serviços será de 12 meses, podendo ser prorrogado, caso haja interesse das partes. O valor mensal do suporte técnico é de R$ 1.800,00.'
      )
    );
    assert.ok(text.includes(TECHNICAL_SUPPORT_ITEM_5_MONTHLY));
    assert.equal(text.includes(TECHNICAL_SUPPORT_ITEM_5_AVULSO), false);
    assert.equal(text.includes('atendimento único'), false);
    assert.equal(text.includes('Contrato de Locação'), false);
    assert.equal(text.includes('comodato'), false);
  });

  it('variante único/pontual usa contractMonths === 1 (serviço avulso) e os itens 2 e 5 aprovados', () => {
    const text = buildDefaultTechnicalSupportClauses(
      proposal({
        contractMonths: 1,
        monthlyRecurringTotal: 0,
        totalContractValue: 3200,
        deliveryLeadTime: '7 dias úteis após o aceite',
      })
    );
    assert.ok(text.includes(TECHNICAL_SUPPORT_CONFIDENTIALITY));
    assert.ok(text.includes(TECHNICAL_SUPPORT_ITEM_1));
    assert.ok(text.includes(TECHNICAL_SUPPORT_ITEM_3));
    assert.ok(text.includes(TECHNICAL_SUPPORT_ITEM_4));
    assert.ok(
      text.includes(
        '2. O serviço será executado em atendimento único, no prazo de 7 dias úteis a contar do aceite desta proposta, pelo valor total de R$ 3.200,00.'
      )
    );
    assert.ok(text.includes(TECHNICAL_SUPPORT_ITEM_5_AVULSO));
    assert.equal(text.includes('Contrato de Prestação de Serviços'), false);
    assert.equal(text.includes('comodato'), false);
  });

  it('sem valor ou prazo de entrega gravados, mantém os placeholders XX e XXXXXXX', () => {
    const monthly = buildDefaultTechnicalSupportClauses(
      proposal({ contractMonths: 24, monthlyRecurringTotal: 0, totalContractValue: 0, deliveryLeadTime: '' })
    );
    assert.ok(monthly.includes('será de 24 meses'));
    assert.ok(monthly.includes('R$ XXXXXXX'));
    const avulso = buildDefaultTechnicalSupportClauses(
      proposal({ contractMonths: 1, monthlyRecurringTotal: 0, totalContractValue: 0, deliveryLeadTime: '' })
    );
    assert.ok(avulso.includes('prazo de XX dias úteis'));
    assert.ok(avulso.includes('R$ XXXXXXX'));
    const noMonths = buildDefaultTechnicalSupportClauses(
      proposal({ contractMonths: 0, monthlyRecurringTotal: 0, totalContractValue: 0, deliveryLeadTime: '' })
    );
    assert.ok(noMonths.includes('será de XX meses'));
    assert.ok(noMonths.includes('R$ XXXXXXX'));
  });

  it('não reescreve texto já salvo (inclusive o antigo de equipamentos) e só preenche vazio ou template', () => {
    const saved = proposal({ technicalClauses: LEGACY_EQUIPMENT_TEXT });
    assert.equal(looksLikeLegacyEquipmentTechnicalClauses(LEGACY_EQUIPMENT_TEXT), true);
    assert.equal(
      resolveTechnicalClausesOnEdit(saved, { ...saved, contractMonths: 12 }, { contractMonths: 12 }),
      LEGACY_EQUIPMENT_TEXT
    );
    assert.equal(
      displayProposalTechnicalClauses(saved),
      LEGACY_EQUIPMENT_TEXT.trim() // cleanProposalTechnicalClauses trims; this text has no SLA junk
    );

    const empty = proposal({ technicalClauses: '' });
    const filled = resolveTechnicalClausesOnEdit(empty, empty, {});
    assert.ok(isDefaultTechnicalSupportClauses(filled));
    assert.ok(filled.includes('12 meses') === false);
    assert.ok(filled.includes('24 meses'));

    const nextAvulso = { ...empty, contractMonths: 1 as const, technicalClauses: filled };
    const switched = resolveTechnicalClausesOnEdit(empty, nextAvulso, { contractMonths: 1 });
    assert.ok(switched.includes('atendimento único'));
    assert.ok(isDefaultTechnicalSupportClauses(switched));

    const typed = resolveTechnicalClausesOnEdit(
      empty,
      { ...empty, technicalClauses: 'Texto customizado do vendedor.' },
      { technicalClauses: 'Texto customizado do vendedor.' }
    );
    assert.equal(typed, 'Texto customizado do vendedor.');
  });

  it('folha interna de suporte usa as cláusulas de suporte e a de locação permanece no texto de locação', () => {
    const supportSheet = buildInternalProposalSheet(proposal({ technicalClauses: '' }), 'SERVICO');
    assert.equal(supportSheet.confidentiality, TECHNICAL_SUPPORT_CONFIDENTIALITY);
    assert.ok(supportSheet.clauses.some((c) => c.body.includes('prestação de serviços de suporte técnico')));
    assert.equal(supportSheet.clauses.some((c) => /comodato|Contrato de Locação/i.test(`${c.title} ${c.body}`)), false);

    const legacySheet = buildInternalProposalSheet(
      proposal({ technicalClauses: LEGACY_EQUIPMENT_TEXT }),
      'SERVICO'
    );
    assert.ok(legacySheet.confidentiality.includes('comodato'));
    assert.equal(legacySheet.clauses.length, 0);

    const rental = proposal({ budgetType: 'LOCACAO', serviceType: undefined, technicalClauses: '' });
    const rentalSheet = buildInternalProposalSheet(rental, 'LOCACAO');
    assert.equal(rentalSheet.confidentiality, SETA_INTERNAL_CONFIDENTIALITY);
    assert.deepEqual(rentalSheet.clauses, [...SETA_INTERNAL_CLAUSES]);
  });

  it('editor, criação e página pública usam o texto padrão só em suporte técnico', () => {
    const editor = src('src/app/components/ErpEditModals.tsx');
    assert.match(editor, /resolveTechnicalClausesOnEdit/);
    const tab = src('src/app/components/ErpGestaoClickTab.tsx');
    assert.match(tab, /buildDefaultTechnicalSupportClauses\(draftNew\)/);
    const repo = src('src/db/repository.ts');
    assert.match(repo, /isTechnicalSupportProposal/);
    assert.match(repo, /buildDefaultTechnicalSupportClauses/);
    const page = src('src/app/proposta/[id]/page.tsx');
    assert.match(page, /displayProposalTechnicalClauses\(proposal\)/);
  });
});
