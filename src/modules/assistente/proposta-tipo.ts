// ============================================================================
// STI-hub — Assistente: tipo da proposta antes do rascunho (24/11/2026).
//
// Caso: "você pode gerar uma proposta?" e o assistente pediu cliente/itens/prazo sem
// perguntar o TIPO ("Não questionou os tipos de propostas???"). Agora o rascunho
// sempre comeca pelo tipo (Produtos, Serviços pontual ou mensal, Locação) e depois
// pede os campos certos de cada tipo. Forma de pagamento: só Boleto, Pix ou
// Ted / Transferência. So texto: nada aqui grava dados.
// ============================================================================
import { foldTexto } from './identificadores';

export type TipoProposta = 'produtos' | 'servico_pontual' | 'servico_mensal' | 'locacao';
export const TIPOS_PROPOSTA: readonly TipoProposta[] = ['produtos', 'servico_pontual', 'servico_mensal', 'locacao'];

export const ROTULO_TIPO_PROPOSTA: Record<TipoProposta, string> = {
  produtos: 'Produtos (venda)',
  servico_pontual: 'Serviços — pontual (pagamento único)',
  servico_mensal: 'Serviços — mensal',
  locacao: 'Locação',
};

export type FormaPagamento = 'boleto' | 'pix' | 'ted';
export const FORMAS_PAGAMENTO: readonly FormaPagamento[] = ['boleto', 'pix', 'ted'];
/** Valor interno gravado nas parcelas (mesmo da tela de orcamento). */
export const FORMA_PAGAMENTO_ERP: Record<FormaPagamento, string> = { boleto: 'BOLETO', pix: 'PIX', ted: 'TED' };
export const ROTULO_FORMA_PAGAMENTO: Record<FormaPagamento, string> = { boleto: 'Boleto', pix: 'Pix', ted: 'Ted / Transferência' };
export const TEXTO_FORMAS_PAGAMENTO = 'Boleto, Pix ou Ted / Transferência';

export const INDICES_REAJUSTE = ['IPCA', 'IGP-M', 'IST_ANATEL', 'FIXO'] as const;
export type IndiceReajuste = (typeof INDICES_REAJUSTE)[number];
export const ROTULO_INDICE: Record<IndiceReajuste, string> = { IPCA: 'IPCA', 'IGP-M': 'IGP-M', IST_ANATEL: 'IST (Anatel)', FIXO: 'Fixo (sem reajuste)' };

/** Primeira linha da pergunta: o servidor reconhece a resposta seguinte por ela. */
export const CABECALHO_PERGUNTA_TIPO = 'Antes de montar o rascunho: qual é o tipo da proposta?';
export const PERGUNTA_TIPO_PROPOSTA = [
  CABECALHO_PERGUNTA_TIPO,
  '1. Produtos (venda)',
  '2. Serviços — pontual (pagamento único)',
  '3. Serviços — mensal',
  '4. Locação',
  'Responda com o número ou o nome do tipo.',
].join('\n');

export const PERGUNTA_SERVICO_MODO = 'O serviço é pontual (pagamento único) ou mensal?';

const COMUM_CLIENTE = '- Cliente: nome ou CNPJ, como você conhece';
const COMUM_PAGAMENTO = `- Forma de pagamento: ${TEXTO_FORMAS_PAGAMENTO}`;
const COMUM_TITULO = '- Título (opcional)';

const CAMPOS: Record<TipoProposta, string[]> = {
  locacao: [
    COMUM_CLIENTE,
    '- Equipamentos: descrição e quantidade de cada um',
    '- Prazo do contrato em meses (ex.: 12, 24, 36)',
    '- Mensalidade: valor mensal de cada item (se ainda não tiver, fica a definir)',
    '- Setup / ativação: valor único, cobrado à parte da mensalidade (ou "sem setup")',
    '- Índice de reajuste: IPCA, IGP-M, IST (Anatel) ou fixo',
    COMUM_PAGAMENTO,
    COMUM_TITULO,
  ],
  servico_mensal: [
    COMUM_CLIENTE,
    '- Serviços: descrição de cada um (ex.: suporte técnico, NOC)',
    '- Prazo do contrato em meses',
    '- Valor mensal de cada serviço (se ainda não tiver, fica a definir)',
    '- Setup / implantação: valor único, à parte da mensalidade (opcional)',
    '- Índice de reajuste: IPCA, IGP-M, IST (Anatel) ou fixo',
    COMUM_PAGAMENTO,
    COMUM_TITULO,
  ],
  servico_pontual: [
    COMUM_CLIENTE,
    '- Serviço: descrição do que será feito (ex.: configuração, instalação)',
    '- Valor do serviço (pagamento único); despesas como locomoção e hospedagem entram como item à parte',
    COMUM_PAGAMENTO,
    COMUM_TITULO,
  ],
  produtos: [
    COMUM_CLIENTE,
    '- Itens: descrição e quantidade de cada produto',
    '- Valor unitário de cada item (se ainda não tiver, fica a definir)',
    '- Frete: valor (ou "sem frete")',
    '- Prazo de entrega (opcional)',
    COMUM_PAGAMENTO,
    COMUM_TITULO,
  ],
};

export function perguntaCamposDoTipo(tipo: TipoProposta): string {
  return [`Proposta de ${ROTULO_TIPO_PROPOSTA[tipo]}. Me passe:`, ...CAMPOS[tipo], 'Com isso eu monto o rascunho para você confirmar (nada é enviado ao cliente).'].join('\n');
}

/** Pedido de proposta/orcamento NOVO ("pode gerar uma proposta?", "quero fazer um orçamento"). */
export function pedidoNovaProposta(texto: string): boolean {
  const t = foldTexto(texto);
  if (!/\b(propostas?|orcamentos?|cotac(?:ao|oes))\b/.test(t)) return false;
  // Proposta existente (numero, codigo, link) e edicao/consulta, nao criacao.
  if (/\b(?:proposta|orcamento)\s*(?:n[o°º.]*\s*|#\s*)?\d{3,}\b|prop-[a-z0-9]|\/p\/|\/proposta\//.test(t)) return false;
  // Pedido sobre propostas que ja existem (PDF, link, listar, editar, aprovar...): nao e criacao.
  if (/\b(pdf|link|versao contrato|envi\w*|mand\w*|aprov\w*|convert\w*|edit\w*|alter\w*|adicion\w*|acrescent\w*|duplic\w*|exclu\w*|cancel\w*|recus\w*|list\w*|quais|quantas|quantos|consult\w*|mostr\w*|ver|veja|busc\w*|procur\w*|localiz\w*|relatorio|abertas|enviadas|aprovadas|vencidas|minhas|ultimas?|como|onde)\b/.test(t)) return false;
  if (/^(?:uma?\s+)?(?:proposta|orcamento)\s+(?:de|para|pra)\s/.test(t) && tipoPropostaNoTexto(t)) return true;
  return /\b(ger(?:e|a|ar)|cri(?:e|a|ar)|mont(?:e|a|ar)|fa(?:ca|z|zer)|elabor(?:e|a|ar)|prepar(?:e|a|ar)|emit(?:a|e|ir)|nov[ao]|preciso de (?:uma|um)|quero (?:uma|um)|queria (?:uma|um)|gostaria de (?:uma|um))\b/.test(t);
}

/**
 * Tipo dito no texto. 'servico' = falou serviço sem dizer se é pontual ou mensal.
 * respostaNumerica: o texto responde a pergunta do tipo (1 a 4).
 */
export function tipoPropostaNoTexto(texto: string, respostaNumerica = false): TipoProposta | 'servico' | null {
  const t = foldTexto(texto);
  if (respostaNumerica) {
    const n = t.match(/^\s*(?:opcao\s*|tipo\s*)?([1-4])\s*[).:-]?\s*$/);
    if (n) return TIPOS_PROPOSTA[Number(n[1]) - 1];
  }
  if (/\b(locac(?:ao|oes)|locar|alug(?:uel|ar|ado|ados)|haas|comodato)\b/.test(t)) return 'locacao';
  const servico = /\b(servicos?|suporte|manutencao|instalacao|configuracao|consultoria|noc|mao de obra)\b/.test(t);
  if (servico || /^\s*(pontual|avulso|mensal)\s*$/.test(t)) {
    if (/\b(pontua(?:l|is)|avuls[oa]s?|pagamento unico|unica vez|uma vez so|uma vez)\b/.test(t)) return 'servico_pontual';
    if (/\b(mensa(?:l|is)|mensalidade|recorrentes?|por mes|ao mes|contrato de suporte|\d{1,3} meses)\b/.test(t)) return 'servico_mensal';
    return 'servico';
  }
  if (/\b(produtos?|vendas?|vender|compra|comprar|equipamentos? (?:para|pra) venda|hardware|licencas?)\b/.test(t)) return 'produtos';
  return null;
}

/** Texto do assistente e a pergunta do tipo / do modo do serviço? */
export const ehPerguntaTipo = (texto: string) => String(texto || '').trim().startsWith(CABECALHO_PERGUNTA_TIPO);
export const ehPerguntaModoServico = (texto: string) => String(texto || '').trim() === PERGUNTA_SERVICO_MODO;

/** Mensagem do assistente que faz parte do fluxo do rascunho (a resposta seguinte vai ao modelo, nao ao roteador). */
export const ehPerguntaFluxoProposta = (texto: string) => {
  const t = String(texto || '').trim();
  return ehPerguntaTipo(t) || ehPerguntaModoServico(t) || (/^Proposta de .+\. Me passe:/.test(t)) || t === MENSAGEM_SEM_CARTAO;
};

/** Pedido curto, só com o tipo (sem cliente, itens ou valores): falta pedir os campos do tipo. */
export function pedidoSemDetalhes(texto: string): boolean {
  const t = foldTexto(texto).replace(/[?!.,;:()"]/g, ' ');
  if (/\d/.test(t)) return false;
  const vazias = new Set(
    ('voce vc pode poderia consegue consegues me uma um o a de do da para pra pro por favor pf gerar gere gera criar crie cria montar monte monta fazer faca faz ' +
      'elaborar elabore preparar prepare emitir abrir nova novo quero queria gostaria preciso proposta propostas orcamento orcamentos cotacao tipo ' +
      'locacao aluguel servico servicos produto produtos venda pontual avulso mensal e com sim ok rascunho').split(' '),
  );
  return t.split(/\s+/).filter((w) => w && !vazias.has(w)).length === 0;
}

type Msg = { papel: 'usuario' | 'assistente'; texto: string };

/**
 * Tipo que o usuario JA escolheu nesta conversa (do mais recente ao mais antigo), para o
 * modelo que esquece de mandar tipo_proposta. Nunca chuta: so o que o usuario disse.
 */
export function tipoPropostaDaConversa(mensagens: Msg[]): TipoProposta | null {
  let modoServico: 'servico' | null = null;
  for (let k = mensagens.length - 1, n = 0; k >= 0 && n < 12; k--, n++) {
    const m = mensagens[k];
    if (m.papel !== 'usuario') continue;
    const anterior = k > 0 ? mensagens[k - 1] : null;
    const numerica = !!anterior && anterior.papel === 'assistente' && ehPerguntaTipo(anterior.texto);
    const tipo = tipoPropostaNoTexto(m.texto, numerica);
    if (tipo === 'servico') {
      modoServico = 'servico';
    } else if (tipo) {
      if (modoServico && (tipo === 'produtos' || tipo === 'locacao')) return null;
      return tipo;
    }
    // O pedido que abriu esta proposta e o limite: nao herda tipo de conversa anterior.
    if (pedidoNovaProposta(m.texto)) break;
  }
  return null;
}

/** Normaliza o que o modelo manda ("locação", "servico mensal", "Ted") para os valores da ferramenta. */
export function normalizarTipoProposta(v: unknown): TipoProposta | 'servico' | undefined {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  const t = foldTexto(v).replace(/[\s-]+/g, '_');
  if ((TIPOS_PROPOSTA as readonly string[]).includes(t)) return t as TipoProposta;
  const r = tipoPropostaNoTexto(v.replace(/_/g, ' '));
  return r ?? undefined;
}

export function normalizarFormaPagamento(v: unknown): FormaPagamento | 'cartao' | undefined {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  const t = foldTexto(v);
  if (/cartao|credito|debito/.test(t)) return 'cartao';
  if (/\bboleto\b/.test(t)) return 'boleto';
  if (/\bpix\b/.test(t)) return 'pix';
  if (/\b(ted|transferencia|doc)\b/.test(t)) return 'ted';
  return undefined;
}

export function normalizarIndice(v: unknown): IndiceReajuste | undefined {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  const t = foldTexto(v).replace(/[\s_.-]+/g, '');
  if (t.startsWith('ipca')) return 'IPCA';
  if (t.startsWith('igpm') || t.startsWith('igp')) return 'IGP-M';
  if (t.startsWith('ist') || t.includes('anatel')) return 'IST_ANATEL';
  if (/^(fixo|semreajuste|nenhum|sem)$/.test(t)) return 'FIXO';
  return undefined;
}

export const MENSAGEM_SEM_CARTAO = `A Seta não aceita cartão. A forma de pagamento da proposta pode ser só ${TEXTO_FORMAS_PAGAMENTO}. Qual delas?`;
