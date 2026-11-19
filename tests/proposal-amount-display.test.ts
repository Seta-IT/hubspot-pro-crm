import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildProposalInstallments,
  computeProposalTotals,
  isOneTimeChargeProposal,
  proposalSetupFeeLabel,
  resolveEffectiveProposalBudgetType,
  resolveProposalAmountDisplay,
  resolveProposalCommercialFigures,
  resolveProposalDocumentHeadings,
  storedMonthlyAppearsToIncludeSetup,
  resolveProposalCommercialPresentation,
} from '../src/app/lib/proposal-share';
import { toInternalProposalSummary } from '../src/app/lib/internal-proposal-summary';
import { displayProposalTechnicalClauses } from '../src/app/lib/proposal-technical-clauses';
import { SETA_INTERNAL_CLAUSES, SETA_INTERNAL_PROPOSAL_NOTICES } from '../src/app/lib/internal-proposal-copy';
import { buildInternalProposalPrintHtml } from '../src/app/lib/internal-proposal-pdf';
import { dealIsOneTimeCharge } from '../src/modules/deals/proposal-deal-link';
import type { ErpCommercialProposal } from '../src/db/types';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

function baseProposal(patch: Partial<ErpCommercialProposal>): ErpCommercialProposal {
  return {
    id: 'prop-amt',
    code: '4709',
    title: 'Mapeamento de Cabeamento, Desinstalação',
    budgetType: 'SERVICOS',
    companyName: 'NEC',
    status: 'ENVIADA',
    contractMonths: 1,
    monthlyRecurringTotal: 2800,
    items: [
      {
        id: 's1',
        description: 'Mapeamento de Cabeamento, Desinstalação',
        quantity: 1,
        unitPrice: 2800,
        isRecurring: true,
        totalMonthly: 2800,
        subtotal: 2800,
        fiscalNature: 'SERVICO_TECNICO_TI_TELECOM',
      },
    ],
    setupFee: 0,
    oneTimeSetupTotal: 0,
    shippingCost: 0,
    totalContractValue: 2800,
    createdAt: '2026-11-19T00:00:00.000Z',
    updatedAt: '2026-11-19T00:00:00.000Z',
    ...patch,
  } as ErpCommercialProposal;
}

function locacaoComSetup(): ErpCommercialProposal {
  return baseProposal({
    id: 'prop-loc',
    code: '4710',
    title: 'Locação de switches',
    budgetType: 'LOCACAO',
    contractMonths: 36,
    monthlyRecurringTotal: 2000,
    setupFee: 800,
    oneTimeSetupTotal: 800,
    shippingCost: 150,
    totalContractValue: 2000 * 36 + 800 + 150,
    items: [
      {
        id: 'r1',
        sku: 'SW',
        description: 'Switch 24p',
        ncmOrServiceCode: '8517.62.14',
        quantity: 2,
        unitPrice: 1000,
        discountPercent: 0,
        isRecurring: true,
        totalMonthly: 2000,
        subtotal: 2000,
        fiscalNature: 'LOCACAO_BENS_MOVEIS',
      },
    ],
  });
}

describe('Exibição do valor da proposta: avulso sem /mês e setup fora da mensalidade', () => {
  it('serviço avulso (4709) mostra o total sem /mês; serviço mensal e locação mantêm /mês', () => {
    const avulso = resolveProposalAmountDisplay(baseProposal({}));
    assert.equal(isOneTimeChargeProposal(baseProposal({})), true);
    assert.equal(avulso.oneTime, true);
    assert.equal(avulso.amount, 2800);
    assert.equal(avulso.suffix, '');
    assert.equal(avulso.label, 'Pagamento único');

    const mensal = resolveProposalAmountDisplay(
      baseProposal({ contractMonths: 12, monthlyRecurringTotal: 1800, totalContractValue: 21600 })
    );
    assert.equal(mensal.oneTime, false);
    assert.equal(mensal.amount, 1800);
    assert.equal(mensal.suffix, '/mês');
    assert.equal(mensal.label, 'Valor mensal');

    const locacao = resolveProposalAmountDisplay(locacaoComSetup());
    assert.equal(locacao.oneTime, false);
    assert.equal(locacao.amount, 2000);
    assert.equal(locacao.monthlyAmount, 2000);
    assert.equal(locacao.setupAmount, 800);
    assert.equal(locacao.suffix, '/mês');
    assert.notEqual(locacao.amount, 2000 + 800);
    assert.equal(locacao.totalAmount, 2000 * 36 + 800 + 150);
  });

  it('computeProposalTotals de locação não soma o setup na mensalidade', () => {
    const computed = computeProposalTotals(
      locacaoComSetup()
    );
    assert.equal(computed.monthlyRecurringTotal, 2000);
    assert.equal(computed.setupFee, 800);
    assert.equal(computed.oneTimeSetupTotal, 800);
    assert.equal(computed.shippingCost, 150);
    assert.equal(computed.totalContractValue, 2000 * 36 + 800 + 150);
  });

  it('se o setup vier como item único, a mensalidade calculada e a exibida ficam só com a locação', () => {
    const draft = computeProposalTotals(
      baseProposal({
          budgetType: 'LOCACAO',
          contractMonths: 36,
          monthlyRecurringTotal: 0,
          setupFee: 0,
          oneTimeSetupTotal: 0,
          shippingCost: 0,
          items: [
            {
              id: 'r1',
              sku: 'SW',
              description: 'Switch',
              ncmOrServiceCode: '',
              quantity: 1,
              unitPrice: 2000,
              discountPercent: 0,
              isRecurring: true,
              totalMonthly: 2000,
              subtotal: 2000,
              fiscalNature: 'LOCACAO_BENS_MOVEIS',
            },
            {
              id: 's1',
              sku: 'SET',
              description: 'Ativação / setup',
              ncmOrServiceCode: '',
              quantity: 1,
              unitPrice: 800,
              discountPercent: 0,
              isRecurring: false,
              totalMonthly: 800,
              subtotal: 800,
              fiscalNature: 'SERVICO_TECNICO_TI_TELECOM',
            },
          ],
        })
    );
    assert.equal(draft.monthlyRecurringTotal, 2000);
    assert.equal(draft.oneTimeSetupTotal, 800);
    const display = resolveProposalAmountDisplay(draft);
    assert.equal(display.amount, 2000);
    assert.equal(display.setupAmount, 800);
    const figures = resolveProposalCommercialFigures(draft);
    assert.equal(figures.monthly, 2000);
    assert.equal(figures.oneTime, false);
  });

  it('parcelas de locação não rateiam o setup nas mensalidades', () => {
    const built = buildProposalInstallments(locacaoComSetup(), {
      count: 36,
      method: 'BOLETO',
      firstDueDate: '2026-12-10',
      methodLabel: 'Boleto',
    });
    const setupRows = built.installments.filter((i) => /setup|ativação/i.test(String(i.notes || '')));
    const freightRows = built.installments.filter((i) => /frete/i.test(String(i.notes || '')));
    const monthlyRows = built.installments.filter((i) => /mensalidade/i.test(String(i.notes || '')));
    assert.equal(setupRows.length, 1);
    assert.equal(setupRows[0].amount, 800);
    assert.equal(freightRows.length, 1);
    assert.equal(freightRows[0].amount, 150);
    assert.equal(monthlyRows.length, 36);
    assert.ok(monthlyRows.every((row) => row.amount === 2000));
    assert.equal(
      monthlyRows.reduce((s, r) => s + r.amount, 0),
      2000 * 36
    );
    assert.match(built.paymentCondition, /Setup \/ Ativação/);
    assert.match(built.paymentCondition, /pagamento único/);
    assert.doesNotMatch(built.paymentCondition, /Parcelado em 36x de/);
  });

  it('serviço avulso continua podendo parcelar o total único, sem chamar de mensalidade', () => {
    const built = buildProposalInstallments(baseProposal({}), {
      count: 2,
      method: 'PIX',
      firstDueDate: '2026-12-01',
      methodLabel: 'Pix',
    });
    assert.equal(built.installments.length, 2);
    assert.equal(built.installments[0].amount + built.installments[1].amount, 2800);
    assert.match(built.installments[0].notes || '', /pagamento único/i);
    assert.doesNotMatch(built.installments[0].notes || '', /mensalidade/i);
  });

  it('folha interna da locação mostra setup separado e fora do valor mensal', () => {
    const sheet = toInternalProposalSummary(locacaoComSetup()).sheet;
    assert.match(sheet.monthlyLine, /Valor Mensal/);
    assert.match(sheet.monthlyLine, /2\.000,00/);
    assert.doesNotMatch(sheet.monthlyLine, /2\.800,00|2\.150,00/);
    const setupRow = sheet.summaryRows.find((row) => /setup|ativação/i.test(row.label));
    assert.ok(setupRow, 'resumo deve ter linha de setup');
    assert.match(setupRow!.value, /800,00/);
    assert.match(setupRow!.value, /pagamento único/i);
    const setupPay = sheet.paymentRows.find((row) => /setup|ativação/i.test(row.note));
    assert.ok(setupPay);
    assert.match(setupPay!.amount, /800,00/);
    const monthlyPay = sheet.paymentRows.find((row) => /mensalidade/i.test(row.note));
    assert.ok(monthlyPay);
    assert.match(monthlyPay!.amount, /2\.000,00/);
  });

  it('detecta valor mensal gravado somado com setup, sem alterar o registro', () => {
    const somado = locacaoComSetup();
    somado.monthlyRecurringTotal = 2800;
    assert.equal(storedMonthlyAppearsToIncludeSetup(somado), true);
    const correto = locacaoComSetup();
    assert.equal(storedMonthlyAppearsToIncludeSetup(correto), false);
  });

  it('negócio de serviço avulso no CRM não deve ser tratado como mensalidade', () => {
    assert.equal(dealIsOneTimeCharge({ contractMonths: 1, mrr: 2800, value: 2800 }), true);
    assert.equal(dealIsOneTimeCharge({ contractMonths: 36, mrr: 2000, value: 72800 }), false);
    assert.equal(dealIsOneTimeCharge({ contractMonths: 1, mrr: 2000, value: 2800 }), false);
  });

  it('lista, cartões, PDF interno, editor e CRM usam o helper e não forçam /mês no avulso', () => {
    const list = src('src/app/components/ErpGestaoClickTab.tsx');
    assert.match(list, /resolveProposalAmountDisplay\(prop\)/);
    assert.match(list, /formatBRL\(amount\.amount\)}.{0,8}amount\.suffix/);
    assert.doesNotMatch(list, /formatBRL\(prop\.monthlyRecurringTotal \|\| prop\.totalContractValue\)\/mês/);
    assert.doesNotMatch(list, /formatBRL\(prop\.monthlyRecurringTotal\)\/mês/);

    const form = src('src/app/components/ErpEditModals.tsx');
    assert.match(form, /buildProposalInstallments\(draft/);

    const page = src('src/app/proposta/[id]/page.tsx');
    assert.match(page, /resolveProposalAmountDisplay/);

    const kanban = src('src/app/components/DealsKanbanTab.tsx');
    assert.match(kanban, /dealShowsMonthlyAmount/);
    assert.match(kanban, /showsMonthly \? `\$\{formatBRL\(mrr\)\}\/mês` : formatBRL\(deal\.value\)/);
  });
});

function publicViewFacts(proposal: ErpCommercialProposal) {
  const headings = resolveProposalDocumentHeadings(proposal);
  const amount = resolveProposalAmountDisplay(proposal);
  const figures = resolveProposalCommercialFigures(proposal);
  return {
    budgetType: headings.effectiveBudgetType,
    isServices: headings.isServices && !headings.isRental,
    isRental: headings.isRental,
    oneTime: amount.oneTime || figures.oneTime,
    amount: amount.amount,
    monthlyAmount: amount.monthlyAmount,
    setupAmount: amount.setupAmount,
    setupLabel: proposalSetupFeeLabel(proposal),
    amountLabel: amount.label,
    technicalClauses: displayProposalTechnicalClauses(proposal),
  };
}

function internViewFacts(proposal: ErpCommercialProposal) {
  const model = toInternalProposalSummary(proposal);
  const sheet = model.sheet;
  const clausesText = [sheet.confidentiality, ...sheet.clauses.map((c) => `${c.title} ${c.body}`)].join('\n');
  return { model, sheet, clausesText };
}

describe('Folha interna segue as mesmas regras da proposta pública', () => {
  it('serviço avulso (4709): mesmo tipo, valor único, rótulos sem /mês e sem cláusulas de locação', () => {
    const proposal = baseProposal({
      id: 'prop-nec-dafiti-svc-20261105',
      serviceType: 'Mapeamento de Cabeamento, Desinstalação',
      technicalClauses: '',
    });
    const pub = publicViewFacts(proposal);
    const { model, sheet, clausesText } = internViewFacts(proposal);

    assert.equal(pub.budgetType, 'SERVICOS');
    assert.equal(pub.isServices, true);
    assert.equal(pub.oneTime, true);
    assert.equal(pub.amount, 2800);
    assert.equal(pub.amountLabel, 'Pagamento único');
    assert.equal(pub.technicalClauses, '');

    assert.equal(model.kind, 'SERVICO');
    assert.match(model.kindLabel, /serviço/i);
    assert.equal(sheet.grandTotalLabel, 'TOTAL:');
    assert.equal(sheet.unitPriceColumn, 'Vr. unitário');
    assert.equal(sheet.subtotalColumn, 'Subtotal');
    assert.match(sheet.itemsTotalLabel, /SERVIÇOS:/);
    assert.doesNotMatch(sheet.itemsTotalLabel, /mensal/i);
    assert.match(sheet.monthlyLine, /pagamento único/i);
    assert.match(sheet.productsMonthly, /2\.800,00/);
    assert.equal(sheet.clauses.length, 0);
    assert.doesNotMatch(clausesText, /Remessa dos equipamentos|Contrato de Locação|vigência da locação/i);
    assert.equal(sheet.showContractNumber, false);
    assert.equal(sheet.contractHint, '');
  });

  it('serviço mensal: valor mensal igual nos dois lados, sem cláusulas de remessa de locação', () => {
    const proposal = baseProposal({
      contractMonths: 12,
      monthlyRecurringTotal: 1800,
      totalContractValue: 21600,
      serviceType: 'Suporte N1/N2',
      technicalClauses: '',
    });
    const pub = publicViewFacts(proposal);
    const { model, sheet, clausesText } = internViewFacts(proposal);
    assert.equal(pub.budgetType, 'SERVICOS');
    assert.equal(pub.oneTime, false);
    assert.equal(pub.amount, 1800);
    assert.equal(pub.amountLabel, 'Valor mensal');
    assert.equal(model.kind, 'SERVICO');
    assert.equal(sheet.grandTotalLabel, 'TOTAL MENSAL:');
    assert.equal(sheet.unitPriceColumn, 'Vr. unit. mensal');
    assert.match(sheet.monthlyLine, /Valor Mensal/);
    assert.match(sheet.monthlyLine, /1\.800,00/);
    assert.doesNotMatch(clausesText, /Remessa dos equipamentos|Contrato de Locação/i);
    assert.equal(sheet.showContractNumber, true);
    assert.match(sheet.contractHint, /convertida em contrato$/);
    assert.equal(sheet.contractHint.includes('locação'), false);
  });

  it('locação com setup: mensalidade e setup iguais nos dois lados, setup fora do total mensal', () => {
    const proposal = locacaoComSetup();
    const pub = publicViewFacts(proposal);
    const { model, sheet } = internViewFacts(proposal);
    assert.equal(pub.budgetType, 'LOCACAO');
    assert.equal(pub.isRental, true);
    assert.equal(pub.oneTime, false);
    assert.equal(pub.amount, 2000);
    assert.equal(pub.setupAmount, 800);
    assert.equal(pub.setupLabel, 'Setup / Ativação');
    assert.equal(model.kind, 'LOCACAO');
    assert.equal(sheet.grandTotalLabel, 'TOTAL MENSAL:');
    assert.equal(sheet.showSetup, true);
    assert.match(sheet.setupAmount, /800,00/);
    assert.match(sheet.totalMonthly, /2\.000,00/);
    assert.doesNotMatch(sheet.totalMonthly, /2\.800,00|2\.150,00/);
    assert.deepEqual(sheet.clauses, [...SETA_INTERNAL_CLAUSES]);
    assert.equal(sheet.showContractNumber, true);
    assert.match(sheet.contractHint, /contrato de locação/);
  });

  it('serviço sem budgetType gravado é inferido como serviço, não como locação', () => {
    const proposal = baseProposal({ budgetType: undefined, modality: 'SERVICE' });
    assert.equal(resolveEffectiveProposalBudgetType(proposal), 'SERVICOS');
    assert.equal(publicViewFacts(proposal).budgetType, 'SERVICOS');
    assert.equal(toInternalProposalSummary(proposal).kind, 'SERVICO');
  });

  it('visão interna e PDF deixam de hardcodar TOTAL MENSAL e cláusulas de locação em serviço', () => {
    const view = src('src/app/components/InternalProposalSummaryView.tsx');
    const pdf = src('src/app/lib/internal-proposal-pdf.ts');
    assert.match(view, /sheet\.grandTotalLabel/);
    assert.match(view, /sheet\.unitPriceColumn/);
    assert.match(view, /sheet\.showContractNumber/);
    assert.match(view, /sheet\.contractHint/);
    assert.doesNotMatch(view, />TOTAL MENSAL:</);
    assert.doesNotMatch(view, />Vr\. unit\. mensal</);
    assert.match(pdf, /sheet\.grandTotalLabel/);
    assert.match(pdf, /sheet\.unitPriceColumn/);
    assert.match(pdf, /sheet\.showContractNumber/);
    assert.doesNotMatch(pdf, /<span>TOTAL MENSAL:</);
  });
});

describe('Folha interna: condições sem duplicar nem metadados brutos', () => {
  const dumpedNotes = [
    'Proposta Comercial',
    'Prazo de Entrega Estimado: 1 dia',
    ...SETA_INTERNAL_PROPOSAL_NOTICES.map((n) => `>>> ${n}`),
    '||| Criada por Assistente de Vendas (serviço).',
  ].join('\n');

  it('4720 (serviço avulso): um prazo oficial, avisos só à direita, sem barra de contrato', () => {
    const proposal = baseProposal({
      id: 'prop-1795018862851-b57740',
      code: '4720',
      proposalDate: '2026-11-18',
      deliveryLeadTime: '8 dias úteis',
      monthlyRecurringTotal: 2500,
      totalContractValue: 2500,
      commercialNotes: dumpedNotes,
      items: [
        {
          id: 'i1',
          sku: 'SVC-001',
          description: 'Serviço avulso',
          fiscalNature: 'SERVICO_TECNICO_TI_TELECOM',
          ncmOrServiceCode: '',
          quantity: 1,
          unitPrice: 2500,
          discountPercent: 0,
          isRecurring: false,
          totalMonthly: 2500,
        },
      ],
    });
    const sheet = toInternalProposalSummary(proposal).sheet;
    const html = buildInternalProposalPrintHtml(toInternalProposalSummary(proposal)).replace(/\u00A0/g, ' ');
    assert.deepEqual(
      sheet.summaryRows.map((row) => row.label),
      ['Proposta', 'Valor total (pagamento único)', 'Prazo de entrega estimado']
    );
    assert.equal(sheet.summaryRows[2].value, '8 dias úteis');
    assert.equal(sheet.summaryRows.some((row) => /1 dia/i.test(row.value)), false);
    assert.equal(sheet.summaryRows.some((row) => /Proposta Comercial/i.test(`${row.label} ${row.value}`)), false);
    assert.equal(sheet.summaryRows.some((row) => />>>|\|\|\||Criada por Assistente/i.test(`${row.label} ${row.value}`)), false);
    assert.equal(sheet.commercialNoteLines.length, 0);
    assert.equal(sheet.notices.length, SETA_INTERNAL_PROPOSAL_NOTICES.length);
    assert.equal(sheet.showContractNumber, false);
    assert.doesNotMatch(html, /Nº do contrato|contrato de locação|>>>|Criada por Assistente|1 dia/);
    assert.equal((html.match(/A disponibilidade dos produtos/g) || []).length, 1);
    assert.equal((html.match(/Ptax no dia de faturamento/g) || []).length, 1);
  });

  it('4709 (prop-nec-dafiti-svc-20261105): layout limpo e sem barra de contrato', () => {
    const proposal = baseProposal({
      id: 'prop-nec-dafiti-svc-20261105',
      commercialNotes: 'Proposta Comercial\nPrazo de Entrega Estimado: 1 dia\nCriada por Assistente de Vendas (serviço).',
    });
    const sheet = toInternalProposalSummary(proposal).sheet;
    const html = buildInternalProposalPrintHtml(toInternalProposalSummary(proposal));
    assert.equal(sheet.summaryRows.length, 3);
    assert.equal(sheet.commercialNoteLines.length, 0);
    assert.equal(sheet.showContractNumber, false);
    assert.doesNotMatch(html, /Nº do contrato|Criada por Assistente/);
  });

  it('produtos também escondem a barra de contrato; prazo extra legítimo permanece', () => {
    const products = baseProposal({
      budgetType: 'PRODUTOS',
      contractMonths: 1,
      monthlyRecurringTotal: 500,
      commercialNotes: 'Prazo extra: 2 dias\nCriada por Assistente de Vendas (serviço).',
    });
    const sheet = toInternalProposalSummary(products).sheet;
    assert.equal(toInternalProposalSummary(products).kind, 'PRODUTOS');
    assert.equal(sheet.showContractNumber, false);
    assert.equal(sheet.summaryRows.find((row) => row.label === 'Prazo extra')?.value, '2 dias');
    assert.doesNotMatch(sheet.commercialNoteLines.join('\n'), /Criada por Assistente/);
  });
});


function live4709(): ErpCommercialProposal {
  return baseProposal({
    id: 'prop-nec-dafiti-svc-20261105',
    code: '4709',
    title: 'Mapeamento de Cabeamento e Retirada de Equipamentos — DAFITI (Extrema/MG)',
    budgetType: 'SERVICOS',
    serviceType: 'Mapeamento de Cabeamento, Desinstalação',
    contractMonths: 1,
    monthlyRecurringTotal: 2800,
    oneTimeSetupTotal: 15800,
    setupFee: 0,
    shippingCost: 0,
    totalContractValue: 18600,
    productsSubtotal: 0,
    servicesSubtotal: 18600,
    paymentCondition: '15 dias — PIX ou Boleto',
    items: [
      {
        id: 'i1',
        sku: '',
        description: 'Mapeamento físico de cabeamento UTP, identificação e eliminação de fibras ópticas e retirada de switches/APs — CD Dafiti Extrema/MG (equipe de 6 pessoas)',
        fiscalNature: 'SERVICO_TECNICO_TI_TELECOM',
        ncmOrServiceCode: '',
        quantity: 1,
        unitPrice: 15800,
        discountPercent: 0,
        isRecurring: false,
        itemType: 'SERVICE',
        subtotal: 15800,
        totalMonthly: 15800,
      },
      {
        id: 'i2',
        sku: '',
        description: 'Despesas de Locomoção / Hospedagem',
        fiscalNature: 'SERVICO_TECNICO_TI_TELECOM',
        ncmOrServiceCode: '',
        quantity: 1,
        unitPrice: 2800,
        discountPercent: 0,
        isRecurring: true,
        itemType: 'SERVICE',
        subtotal: 2800,
        totalMonthly: 2800,
      },
    ],
  });
}

describe('Folha interna e lista usam o mesmo cálculo da proposta pública (4709/4720)', () => {
  it('4709: total único R$ 18.600, as duas linhas, Serviço 15.800 só como taxa (sem somar de novo)', () => {
    const proposal = live4709();
    const pub = resolveProposalCommercialPresentation(proposal);
    const amount = resolveProposalAmountDisplay(proposal);
    const sheet = toInternalProposalSummary(proposal).sheet;
    const html = buildInternalProposalPrintHtml(toInternalProposalSummary(proposal)).replace(/\u00A0/g, ' ');

    assert.equal(pub.servicesSubtotal, 18600);
    assert.equal(pub.displaySetupAmount, 15800);
    assert.equal(pub.hasSetupSelected, true);
    assert.equal(pub.uniquePayment, true);
    assert.equal(pub.commercialTotalAmount, 18600);
    assert.equal(amount.amount, 18600);
    assert.equal(amount.suffix, '');
    assert.equal(amount.setupAmount, 15800);
    assert.equal(amount.oneTime, true);

    assert.equal(sheet.lines.length, 2);
    assert.match(sheet.lines[0].name, /Mapeamento físico/);
    assert.equal(sheet.lines[0].subtotal, '15.800,00');
    assert.equal(sheet.lines[1].name, 'Despesas de Locomoção / Hospedagem');
    assert.equal(sheet.lines[1].subtotal, '2.800,00');
    const totalRow = sheet.summaryRows.find((row) => /Valor total \(pagamento único\)/i.test(row.label));
    assert.match((totalRow?.value || '').replace(/\u00A0/g, ' '), /R\$ 18\.600,00/);
    assert.match(sheet.totalMonthly.replace(/\u00A0/g, ' '), /R\$ 18\.600,00/);
    assert.equal(sheet.showSetup, true);
    assert.match(sheet.setupAmount.replace(/\u00A0/g, ' '), /R\$ 15\.800,00/);
    assert.equal(sheet.paymentRows.length, 1);
    assert.match(sheet.paymentRows[0].amount.replace(/\u00A0/g, ' '), /R\$ 18\.600,00/);
    assert.doesNotMatch(html, /34\.400,00/);
    assert.match(html, /18\.600,00/);
    assert.match(html, /Mapeamento físico/);
    assert.match(html, /Despesas de Locomoção \/ Hospedagem/);
  });

  it('4720: serviço avulso de R$ 2.500 permanece íntegro, sem setup extra', () => {
    const proposal = baseProposal({
      id: 'prop-1795018862851-b57740',
      code: '4720',
      title: 'Suporte Técnico',
      budgetType: 'SERVICOS',
      serviceType: 'Suporte Técnico',
      contractMonths: 1,
      monthlyRecurringTotal: 2500,
      oneTimeSetupTotal: 0,
      setupFee: 0,
      shippingCost: 0,
      totalContractValue: 2500,
      servicesSubtotal: 2500,
      paymentCondition: 'À vista — Pagamento único',
      items: [
        {
          id: 'i1',
          sku: '',
          description: 'Suporte Técnico Presencial/ Configuração',
          fiscalNature: 'SERVICO_TECNICO_TI_TELECOM',
          ncmOrServiceCode: '',
          quantity: 1,
          unitPrice: 2500,
          discountPercent: 0,
          isRecurring: true,
          itemType: 'SERVICE',
          subtotal: 2500,
          totalMonthly: 2500,
        },
      ],
    });
    const pub = resolveProposalCommercialPresentation(proposal);
    const sheet = toInternalProposalSummary(proposal).sheet;
    assert.equal(pub.commercialTotalAmount, 2500);
    assert.equal(pub.hasSetupSelected, false);
    assert.equal(resolveProposalAmountDisplay(proposal).amount, 2500);
    assert.equal(sheet.lines.length, 1);
    assert.match(sheet.totalMonthly.replace(/\u00A0/g, ' '), /R\$ 2\.500,00/);
    assert.equal(sheet.showSetup, false);
    assert.equal(sheet.paymentRows.length, 1);
    assert.match(sheet.paymentRows[0].amount.replace(/\u00A0/g, ' '), /R\$ 2\.500,00/);
  });

  it('folha pública, folha interna e lista compartilham resolveProposalCommercialPresentation', () => {
    const page = src('src/app/proposta/[id]/page.tsx');
    const sheet = src('src/app/lib/internal-proposal-sheet.ts');
    const share = src('src/app/lib/proposal-share.ts');
    assert.match(share, /export function resolveProposalCommercialPresentation/);
    assert.match(page, /resolveProposalCommercialPresentation\(proposal\)/);
    assert.match(sheet, /resolveProposalCommercialPresentation\(proposal\)/);
    assert.match(src('src/app/lib/proposal-share.ts'), /resolveProposalAmountDisplay\(/);
  });

  it('rótulo visível passa a Versão contrato, sem mudar a rota /interno/proposta', () => {
    const page = src('src/app/proposta/[id]/page.tsx');
    const erp = src('src/app/components/ErpGestaoClickTab.tsx');
    const kanban = src('src/app/components/DealsKanbanTab.tsx');
    const view = src('src/app/components/InternalProposalSummaryView.tsx');
    const pdf = src('src/app/lib/internal-proposal-pdf.ts');
    const intern = src('src/app/interno/proposta/[id]/page.tsx');
    assert.match(page, /Abrir Versão contrato/);
    assert.match(page, /Copiar Versão contrato/);
    assert.match(erp, /Abrir Versão contrato/);
    assert.match(erp, /Copiar Versão contrato/);
    assert.match(kanban, /Copiar Versão contrato/);
    assert.match(view, /Versão contrato/);
    assert.match(pdf, /Versão contrato —/);
    assert.doesNotMatch(page, /Abrir Link interno/);
    assert.doesNotMatch(erp, /Abrir Link interno/);
    assert.match(intern, /\/interno\/proposta\//);
    assert.match(src('src/app/lib/internal-proposal-summary.ts'), /INTERNAL_PROPOSAL_PATH_PREFIX = '\/interno\/proposta'/);
    assert.match(page, /openInternalProposalLink/);
    assert.match(erp, /openInternalProposalLink/);
  });
});
