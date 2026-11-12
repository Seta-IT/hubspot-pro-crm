/**
 * Textos fixos da folha interna aprovada (modelo v3).
 * O CNPJ 09.449.088/0001-06 é de um template antigo e nunca pode ser impresso.
 */
export const FORBIDDEN_TEMPLATE_CNPJ = '09.449.088/0001-06';
export const FORBIDDEN_TEMPLATE_CNPJ_DIGITS = '09449088000106';

export const SETA_INTERNAL_BRAND_TITLE = 'SETA TELECOM | STI IT';

export const SETA_INTERNAL_PROPOSAL_NOTICES: readonly string[] = [
  'A disponibilidade dos produtos e preços podem sofrer alterações sem aviso prévio.',
  'Para cotações com valores em dólar, serão convertidos em BRL (Reais) com a Ptax no dia de faturamento.',
  'Apresentamos, abaixo, a nossa proposta para o fornecimento de uma solução com tecnologia que se enquadre nas suas necessidades, oferecendo um desempenho de última geração capaz de gerar melhores resultados à sua empresa.',
  'Somos uma empresa nacional com 15 anos de atividade e nossa relação com uma ampla variedade de fornecedores e fabricantes nos permite oferecer produtos e serviços com preços bastante competitivos, além de contar com tecnologias atualizadas constantemente.',
  'Esta proposta contempla exclusivamente os itens descritos abaixo.',
];

export const SETA_INTERNAL_CONFIDENTIALITY =
  'As informações constantes desta Proposta Comercial, bem como quaisquer dados, documentos, condições comerciais e informações trocadas entre as PARTES em razão da contratação, são confidenciais e não poderão ser divulgadas ou utilizadas para finalidade diversa da execução da presente contratação, salvo mediante autorização expressa da outra PARTE ou por obrigação legal.';

export const SETA_INTERNAL_CLAUSES: readonly { title: string; body: string }[] = [
  {
    title: '1. Remessa dos equipamentos',
    body: 'Os equipamentos serão enviados ao CLIENTE mediante documento fiscal próprio de remessa, permanecendo sob propriedade da CONTRATADA durante toda a vigência da locação.',
  },
  {
    title: '2. Prazo e valor da locação',
    body: 'O prazo da locação, os valores, a periodicidade de faturamento e as demais condições comerciais serão aqueles expressamente estabelecidos nesta Proposta Comercial, podendo eventual prorrogação ocorrer mediante acordo entre as PARTES.',
  },
  {
    title: '3. Formalização do Contrato de Locação',
    body: 'O CLIENTE terá o prazo de até 10 (dez) dias úteis, contados do recebimento dos equipamentos, para assinatura do respectivo Contrato de Locação. A ausência de formalização do contrato não prejudicará a validade da Proposta aceita nem a cobrança dos valores correspondentes ao período em que os equipamentos permanecerem em posse e utilização do CLIENTE.',
  },
  {
    title: '4. Não formalização do contrato',
    body: 'Caso o Contrato de Locação não seja formalizado no prazo máximo de 30 (trinta) dias, por fato imputável ao CLIENTE, a CONTRATADA poderá exigir a devolução imediata dos equipamentos ou, mediante concordância entre as PARTES, realizar o respectivo faturamento para aquisição, conforme os valores aplicáveis.',
  },
  {
    title: '5. Prazo de entrega',
    body: 'Os prazos de entrega são estimados. Eventuais atrasos decorrentes de caso fortuito, força maior, transporte nacional ou internacional, processos de importação, desembaraço aduaneiro, fiscalização, greves de servidores públicos ou outros fatos alheios ao controle da CONTRATADA não caracterizarão inadimplemento e não ensejarão aplicação de multas ou penalidades. Nessas hipóteses, o prazo de entrega será automaticamente prorrogado pelo período necessário à normalização da situação.',
  },
];

export function cnpjDigits(value: unknown): string {
  return String(value || '').replace(/\D+/g, '');
}

export function isForbiddenTemplateCnpj(value: unknown): boolean {
  return cnpjDigits(value) === FORBIDDEN_TEMPLATE_CNPJ_DIGITS;
}
