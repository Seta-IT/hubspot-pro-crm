import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  inferGcProposalBudgetType,
  inferGcContractMonths,
  fiscalNatureForBudgetType,
} from '../src/modules/erp/gc-proposal-budget-type';

describe('inferGcProposalBudgetType — regra compartilhada do import e do sync', () => {
  it('1. centro de custo com LOCA vira Locação com confiança alta', () => {
    const r = inferGcProposalBudgetType({ nome_centro_custo: 'Locação de Equipamentos', produtos: [{}] });
    assert.equal(r.budgetType, 'LOCACAO');
    assert.equal(r.confidence, 'alta');
  });

  it('2. "Proposta de locação" e valor mensal na introdução viram Locação (alta)', () => {
    const r = inferGcProposalBudgetType({
      introducao: 'Proposta de locação de Servidores Dell - 2 meses\nValor  Mensal de  R$18.000,00\n>>> aviso',
      produtos: [{ produto: { nome_produto: 'Dell PowerEdge' } }],
    });
    assert.equal(r.budgetType, 'LOCACAO');
    assert.equal(r.confidence, 'alta');
    assert.equal(inferGcContractMonths({
      introducao: 'Proposta de locação de Servidores Dell - 2 meses\nValor  Mensal de  R$18.000,00',
    }), 2);
  });

  it('3. proposta de spare mensal / RMA vira Serviço, não Produto', () => {
    const r = inferGcProposalBudgetType({
      introducao: 'Proposta Comercial - 64775C | SPARE PART 12 Meses Valor Mensal de R$770,00',
      produtos: [{ produto: { nome_produto: 'ABERTURA DE CHAMADO  24x7 RMA 8x5' } }],
    });
    assert.equal(r.budgetType, 'SERVICOS');
    assert.equal(r.confidence, 'alta');
    assert.equal(r.reason, 'spare_contrato');
  });

  it('4. prestação de serviço que só cita contrato de locação como contexto vira Serviço', () => {
    const r = inferGcProposalBudgetType({
      nome_centro_custo: 'PRESTAÇÃO DE SERVIÇO',
      introducao: 'Proposta Comercial - Prestação de Serviços Valores para proposta do contrato de locação no prazo de 60 meses',
      servicos: [{ servico: { nome_servico: 'Configuração + Instalação - APs Ubiquiti' } }],
    });
    assert.equal(r.budgetType, 'SERVICOS');
    assert.equal(r.confidence, 'alta');
  });

  it('5. "Spare" só no SKU Cisco continua Produto', () => {
    const r = inferGcProposalBudgetType({
      introducao: 'Proposta Comercial Prazo de Entrega Estimado: 21 a 30 dias',
      produtos: [{ produto: { nome_produto: 'N9K-C93108TC-EX Spare(No Acc kit,PS&fan)' } }],
    });
    assert.equal(r.budgetType, 'PRODUTOS');
    assert.equal(r.confidence, 'alta');
  });

  it('6. só itens de serviço (sem produtos) vira Serviço', () => {
    const r = inferGcProposalBudgetType({
      servicos: [{ servico: { nome_servico: 'Suporte Técnico' } }],
    });
    assert.equal(r.budgetType, 'SERVICOS');
  });

  it('7. sem sinal comercial, o padrão é Produtos', () => {
    const r = inferGcProposalBudgetType({
      nome_centro_custo: 'VENDAS',
      introducao: 'Proposta Comercial Prazo de Entrega Estimado: 7 dias',
      produtos: [{ produto: { nome_produto: 'SL-44-SEC-K9' } }],
    });
    assert.equal(r.budgetType, 'PRODUTOS');
  });

  it('AWS / consultoria vira Serviço mesmo com valor mensal', () => {
    const r = inferGcProposalBudgetType({
      nome_centro_custo: 'Consultoria - AWS',
      introducao: 'Proposta AWS valor mensal 12 Meses',
      servicos: [{ servico: { nome_servico: 'Implementação AWS' } }, { servico: { nome_servico: 'Manutenção AWS' } }],
    });
    assert.equal(r.budgetType, 'SERVICOS');
  });

  it('só o modelo padrão "XX meses" nas observações não vira Locação', () => {
    const r = inferGcProposalBudgetType({
      introducao: 'Proposta Comercial Prazo de Entrega Estimado: 7 dias',
      observacoes:
        'Os equipamentos serão enviados ao Contratante na modalidade de comodato. 2. A Prazo inicial da Locação será de XX meses, podendo ser prorrogado.',
      produtos: [{ produto: { nome_produto: 'SL-44-SEC-K9' } }],
    });
    assert.equal(r.budgetType, 'PRODUTOS');
    assert.equal(r.confidence, 'media');
    assert.equal(inferGcContractMonths({ observacoes: 'Prazo inicial da Locação será de XX meses' }), 1);
  });

  it('não usa o item curinga de locação do sync antigo como sinal', () => {
    const r = inferGcProposalBudgetType({
      introducao: '',
      produtos: [{ produto: { nome_produto: 'Solução de Locação de Infraestrutura Telecom & TI (Orçamento GestãoClick #4701)' } }],
    });
    assert.equal(r.budgetType, 'PRODUTOS');
    assert.notEqual(r.confidence, 'alta');
  });

  it('não confunde alocação/colocação com locação', () => {
    const r = inferGcProposalBudgetType({
      introducao: 'O cliente confirmará a premissa considerada pela Dell para alocação de riscos. Aceite com a colocação de pedido de compra.',
      produtos: [{ produto: { nome_produto: 'Servidor Dell' } }],
    });
    assert.equal(r.budgetType, 'PRODUTOS');
  });

  it('naturezas fiscais seguem o tipo (sem padrão indevido de locação em produto)', () => {
    assert.equal(fiscalNatureForBudgetType('PRODUTOS'), 'VENDA_EQUIPAMENTO');
    assert.equal(fiscalNatureForBudgetType('LOCACAO'), 'LOCACAO_BENS_MOVEIS');
    assert.equal(fiscalNatureForBudgetType('SERVICOS'), 'SERVICO_TECNICO_TI_TELECOM');
  });
});

describe('sync e import passam a usar a regra compartilhada', () => {
  const root = process.cwd();

  it('o import deixa de classificar só pelo centro de custo', () => {
    const src = fs.readFileSync(path.join(root, 'scripts/proposals-table/import-proposals.ts'), 'utf8');
    assert.match(src, /inferGcProposalBudgetType/);
    assert.doesNotMatch(src, /function budgetTypeOf/);
  });

  it('o mapper do sync pagina orçamentos, grava o tipo e não usa o item curinga', () => {
    const src = fs.readFileSync(path.join(root, 'src/modules/erp/gestaoclick-client.ts'), 'utf8');
    assert.match(src, /fetchAllGcPages\('\/orcamentos'/);
    assert.doesNotMatch(src, /orcamentosRes\.data\.slice\(0,\s*12\)/);
    assert.doesNotMatch(src, /Solução de Locação de Infraestrutura Telecom/);
    assert.match(src, /inferGcProposalBudgetType/);
    assert.match(src, /budgetType/);
  });
});
