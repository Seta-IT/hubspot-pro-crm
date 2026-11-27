// ============================================================================
// STI-hub — Assistente: exemplos de diálogo de proposta (t195u, 27/11/2026).
//
// Os mesmos diálogos servem para duas coisas:
//  1) few-shot no prompt do modelo (como continuar um rascunho em várias rodadas);
//  2) casos de teste automatizados (tests/assistente-locacao-slots.test.ts) rodando no fluxo
//     guiado com um recorte real do cadastro.
// Itens e clientes são do cadastro real (conferidos em 27/11/2026); nada é inventado.
// ============================================================================

export interface TurnoExemplo {
  usuario: string;
  /** O que o assistente faz nessa rodada (texto curto para o prompt). */
  assistente: string;
}

export interface DialogoExemplo {
  id: string;
  titulo: string;
  turnos: TurnoExemplo[];
  /** Estado final esperado do rascunho (conferido nos testes). */
  final: {
    tipo: 'produtos' | 'locacao';
    codigo: string;
    quantidade: number;
    valor?: number;
    prazoMeses?: number;
    forma?: 'boleto' | 'pix' | 'ted';
    indice?: 'IPCA' | 'IGP-M' | 'IST_ANATEL' | 'FIXO';
    freteIncluso?: boolean;
  };
}

export const DIALOGOS_PROPOSTA: DialogoExemplo[] = [
  {
    id: 'locacao-mk-jacuipe',
    titulo: 'Locação com valor e prazo na frase, respostas curtas depois',
    turnos: [
      {
        usuario: 'gere uma proposta para a MK Jacuipe de locação de um cabo stack cisco de 1m por 24 meses no valor de 45,00/m6es',
        assistente: 'Anota Locação, STACK-T1-1M do cadastro, 24 meses e R$ 45,00/mês; MK BR S.A tem duas unidades em Conceição do Jacuípe: lista as duas (CNPJ) para escolher.',
      },
      {
        usuario: 'gere uma proposta para a MK Jacuipe de locação de um cabo stack cisco de 1m por 24 meses no valor de 45,00/m6es',
        assistente: 'Reaproveita o rascunho; pergunta só a unidade da MK BR S.A (não repete forma de pagamento nem reajuste).',
      },
      { usuario: 'IGP-M', assistente: 'Anota reajuste IGP-M e continua pedindo só a unidade.' },
      { usuario: 'boleto', assistente: 'Anota pagamento Boleto (nunca abre consulta de faturas) e continua pedindo só a unidade.' },
      { usuario: '1', assistente: 'Mostra o cartão de confirmação: Locação, 1 x STACK-T1-1M a R$ 45,00/mês, 24 meses, IGP-M, Boleto.' },
    ],
    final: { tipo: 'locacao', codigo: 'STACK-T1-1M', quantidade: 1, valor: 45, prazoMeses: 24, forma: 'boleto', indice: 'IGP-M' },
  },
  {
    id: 'venda-foxconn-numerada',
    titulo: 'Venda com resposta numerada',
    turnos: [
      { usuario: 'gere uma proposta de venda para a Foxconn', assistente: 'Tipo Produtos (venda); cliente Foxconn do cadastro; pergunta produto e quantidade.' },
      { usuario: 'switch cisco c3850', assistente: 'Acha o WS-C3850 do cadastro e prepara o cartão com os padrões (frete a definir, Boleto).' },
      { usuario: '1 Venda\n1 C3850\n3 incluso\n4 ok\n5 Boleto', assistente: 'Linhas numeradas preenchem os campos: frete incluso, padrão aceito, Boleto; mostra o cartão de Produtos.' },
    ],
    final: { tipo: 'produtos', codigo: 'WS-C3850-48P-S', quantidade: 1, forma: 'boleto', freteIncluso: true },
  },
  {
    id: 'locacao-3850-foxconn',
    titulo: 'Locação de switch com valor mensal e Pix',
    turnos: [
      { usuario: 'proposta de locação de 2 switch WS-C3850-48F-S para a Foxconn por 12 meses R$ 375,00/mês', assistente: 'Locação, 2 x WS-C3850-48F-S a R$ 375,00/mês, 12 meses; sugere acessórios compatíveis do cadastro.' },
      { usuario: 'seguir sem acessórios', assistente: 'Mostra o cartão com IPCA e Boleto como padrão.' },
      { usuario: 'pix', assistente: 'Troca a forma para Pix e mostra o cartão de novo.' },
    ],
    final: { tipo: 'locacao', codigo: 'WS-C3850-48F-S', quantidade: 2, valor: 375, prazoMeses: 12, forma: 'pix' },
  },
];

/** Bloco curto para o prompt do modelo. */
export function exemplosDialogoParaPrompt(): string {
  return [
    'Exemplos de diálogo de proposta (continue o mesmo rascunho; respostas curtas preenchem o que falta; nunca transforme "boleto", "pix", "IGP-M", "sim" ou um número em consulta):',
    ...DIALOGOS_PROPOSTA.map((d) =>
      [`# ${d.titulo}`, ...d.turnos.map((t) => `Usuário: ${t.usuario.replace(/\n/g, ' / ')}\nAssistente: ${t.assistente}`)].join('\n'),
    ),
  ].join('\n');
}
