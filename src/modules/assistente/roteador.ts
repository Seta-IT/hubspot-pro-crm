// ============================================================================
// STI-hub — Assistente: roteador de intencao deterministico (antes do modelo).
//
// Entende o pedido em linguagem natural (sem acento, com erro de digitacao, datas
// relativas e sinonimos: orcamento = proposta, OS = ordem de servico, NF = nota) e
// decide sem o modelo quando o caso e claro:
//   - duvida sobre o sistema => resposta da base de conhecimento;
//   - identificador (numero, prop-..., link, CNPJ, e-mail, chave...) => busca;
//   - lista/relatorio/painel => ferramenta de leitura com os filtros.
// Pedidos de gravacao (criar, editar, abrir OS/chamado) e o que nao for claro
// seguem para o modelo. A rota so PROPOE: o usuario ainda confirma no cartao.
// ============================================================================
import { extrairIdentificadores, foldTexto, normalizarPergunta, type Identificador } from './identificadores';
import { buscarConhecimento, pareceDuvida } from './conhecimento';
import { PERGUNTA_QUAL_REGISTRO, pedidoSobreRegistro, rotaDoContexto, type RegistroContexto } from './contexto';

export type RotaAssistente =
  | { tipo: 'ferramenta'; ferramenta: string; args: Record<string, unknown>; motivo: string }
  | { tipo: 'texto'; texto: string; motivo: string };

export const FUSO_SETA = 'America/Sao_Paulo';

// ---------------------------------------------------------------------------
// Datas relativas (fuso de Brasilia)
// ---------------------------------------------------------------------------
export function hojeIso(agora: number, timeZone = FUSO_SETA): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(agora));
  const g = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoDe = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
};
const ultimoDia = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const somarDias = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDe(y, m, d + n);
};
const mesInteiro = (y: number, m: number) => {
  const dt = new Date(Date.UTC(y, m - 1, 1));
  const yy = dt.getUTCFullYear();
  const mm = dt.getUTCMonth() + 1;
  return { de: isoDe(yy, mm, 1), ate: isoDe(yy, mm, ultimoDia(yy, mm)), mes: `${yy}-${pad(mm)}` };
};

const MESES: Record<string, number> = {
  janeiro: 1, jan: 1, fevereiro: 2, fev: 2, marco: 3, mar: 3, abril: 4, abr: 4, maio: 5, junho: 6, jun: 6, julho: 7, jul: 7,
  agosto: 8, ago: 8, setembro: 9, set: 9, outubro: 10, out: 10, novembro: 11, nov: 11, dezembro: 12, dez: 12,
};

export interface Periodo {
  de: string;
  ate: string;
  /** Preenchido quando o periodo e exatamente um mes (AAAA-MM). */
  mes?: string;
  /** Trecho reconhecido (para tirar da busca). */
  trecho: string;
}

/** "mês passado", "ontem", "últimos 30 dias", "outubro de 2025", "10/2026", "01/10/2026 a 15/10/2026"... */
export function periodoRelativo(texto: string, agora: number): Periodo | null {
  const t = normalizarPergunta(texto);
  const hoje = hojeIso(agora);
  const [Y, M] = hoje.split('-').map(Number);
  let m: RegExpMatchArray | null;
  const toIso = (d: string) => {
    const x = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!x) return '';
    const yy = x[3].length === 2 ? 2000 + Number(x[3]) : Number(x[3]);
    return isoDe(yy, Number(x[2]), Number(x[1]));
  };
  if ((m = t.match(/\b(?:de|entre)?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:a|ate|e)\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\b/))) {
    return { de: toIso(m[1]), ate: toIso(m[2]), trecho: m[0] };
  }
  if ((m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) return { de: m[0], ate: m[0], trecho: m[0] };
  if ((m = t.match(/\b(?:em |dia |no dia )?(\d{1,2}\/\d{1,2}\/\d{4})\b/))) {
    const d = toIso(m[1]);
    return { de: d, ate: d, trecho: m[0] };
  }
  if ((m = t.match(/\b(\d{4})-(\d{2})\b/))) return { ...mesInteiro(Number(m[1]), Number(m[2])), trecho: m[0] };
  if ((m = t.match(/\b(\d{1,2})\/(\d{4})\b/))) return { ...mesInteiro(Number(m[2]), Number(m[1])), trecho: m[0] };
  if ((m = t.match(/\bhoje\b/))) return { de: hoje, ate: hoje, trecho: m[0] };
  if ((m = t.match(/\banteontem\b/))) return { de: somarDias(hoje, -2), ate: somarDias(hoje, -2), trecho: m[0] };
  if ((m = t.match(/\bontem\b/))) return { de: somarDias(hoje, -1), ate: somarDias(hoje, -1), trecho: m[0] };
  if ((m = t.match(/\bamanha\b/))) return { de: somarDias(hoje, 1), ate: somarDias(hoje, 1), trecho: m[0] };
  if ((m = t.match(/\b(?:nos |nas )?ultim[oa]s (\d{1,3}) dias\b/))) return { de: somarDias(hoje, -(Number(m[1]) - 1)), ate: hoje, trecho: m[0] };
  if ((m = t.match(/\b(?:nos |nas )?proxim[oa]s (\d{1,3}) dias\b/))) return { de: hoje, ate: somarDias(hoje, Number(m[1])), trecho: m[0] };
  const dow = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
  const segunda = (iso: string) => somarDias(iso, -((dow(iso) + 6) % 7));
  if ((m = t.match(/\bsemana passada\b|\bultima semana\b|\bsemana anterior\b/))) {
    const s = somarDias(segunda(hoje), -7);
    return { de: s, ate: somarDias(s, 6), trecho: m[0] };
  }
  if ((m = t.match(/\b(?:esta|essa|nesta|nessa|desta|dessa) semana\b|\bsemana atual\b/))) return { de: segunda(hoje), ate: hoje, trecho: m[0] };
  if ((m = t.match(/\bproxima semana\b|\bsemana que vem\b/))) {
    const s = somarDias(segunda(hoje), 7);
    return { de: s, ate: somarDias(s, 6), trecho: m[0] };
  }
  if ((m = t.match(/\bmes passado\b|\bultimo mes\b|\bmes anterior\b/))) return { ...mesInteiro(Y, M - 1), trecho: m[0] };
  if ((m = t.match(/\bproximo mes\b|\bmes que vem\b/))) return { ...mesInteiro(Y, M + 1), trecho: m[0] };
  if ((m = t.match(/\b(?:este|esse|neste|nesse|deste|desse|do|no) mes\b|\bmes atual\b|\bmes corrente\b/))) return { ...mesInteiro(Y, M), trecho: m[0] };
  if ((m = t.match(/\bano passado\b|\bano anterior\b/))) return { de: `${Y - 1}-01-01`, ate: `${Y - 1}-12-31`, trecho: m[0] };
  if ((m = t.match(/\b(?:este|esse|neste|nesse|deste|desse) ano\b|\bano atual\b/))) return { de: `${Y}-01-01`, ate: `${Y}-12-31`, trecho: m[0] };
  const nomes = Object.keys(MESES).sort((a, b) => b.length - a.length).join('|');
  if ((m = t.match(new RegExp(`\\b(?:em |de |no mes de )?(${nomes})(?:\\s*(?:de|/)?\\s*(\\d{4}))?\\b`)))) {
    const mm = MESES[m[1]];
    // abreviacoes curtas (mar, set, out...) so contam com ano ou com "em/de"
    if (m[1].length <= 3 && !m[2] && !/^(em|de|no mes de) /.test(m[0])) return null;
    const yy = m[2] ? Number(m[2]) : mm > M ? Y - 1 : Y;
    return { ...mesInteiro(yy, mm), trecho: m[0] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Vocabulario de intencao
// ---------------------------------------------------------------------------
type EntidadeRota =
  | 'painel' | 'contas_receber' | 'contas_pagar' | 'notas_fiscais' | 'faturas' | 'ordens_servico' | 'chamados' | 'propostas'
  | 'contratos' | 'fornecedores' | 'estoque' | 'produtos' | 'vendas' | 'negocios' | 'contatos' | 'empresas';

const ENTIDADE_RE: Array<[EntidadeRota, RegExp]> = [
  ['contas_receber', /\b(contas? a receber|a receber|recebiveis|titulos a receber)\b/],
  ['contas_pagar', /\b(contas? a pagar|a pagar|pagaveis|titulos a pagar|despesas)\b/],
  ['notas_fiscais', /\b(notas?(?: fisca(?:l|is))?|nfs?-?e|nf|nfcom|nfc-?e|danfe)\b/],
  ['faturas', /\b(faturas?|boletos?|cobrancas?)\b/],
  ['ordens_servico', /\b((?:ordem|ordens) de servicos?|o\.s\.?)\b/],
  ['chamados', /\b(chamados?|tickets?)\b/],
  ['propostas', /\b(propostas?|orcamentos?)\b/],
  ['contratos', /\b(contratos?|locacoes)\b/],
  ['fornecedores', /\b(fornecedor(?:es)?|transportadoras?)\b/],
  ['estoque', /\b(estoque|estoques)\b/],
  ['produtos', /\b(produtos?|catalogo|equipamentos?|itens cadastrados|servicos cadastrados|lista de precos?|tabela de precos?)\b/],
  ['vendas', /\b(vendas?|pedidos? de venda)\b/],
  ['negocios', /\b(negocios?|deals?|funil)\b/],
  ['contatos', /\b(contatos?)\b/],
  ['empresas', /\b(clientes?|empresas?)\b/],
];

const PAINEL_RE = /\b(painel|dashboard|faturamento|faturado|faturamos|faturou|taxa de aprovacao|feitas (?:e|x) aprovadas|resumo do mes|quanto (?:vendemos|recebemos|faturamos)|recebemos|indicadores|kpis?)\b/;

/** Verbos de gravacao: o pedido vai para o modelo (que propoe a acao com cartao). */
const GRAVACAO_RE = new RegExp(
  String.raw`\b(` +
    [
      'adicion(?:e|a|ar)', 'acrescent(?:e|a|ar)', 'inclu(?:a|i|ir)', 'insir(?:a)?', 'inserir', 'alter(?:e|a|ar)', 'mud(?:e|a|ar)', 'troque', 'trocar', 'troca',
      'atualiz(?:e|a|ar)', 'edit(?:e|a|ar)', 'corrij(?:a)?', 'corrigir', 'cri(?:e|a|ar)', 'cadastr(?:e|a|ar)', 'mont(?:e|a|ar)', 'exclu(?:a|i|ir)',
      'delet(?:e|a|ar)', 'remov(?:a|e|er)', 'apag(?:ue|a|ar)', 'envi(?:e|a|ar)', 'mand(?:e|a|ar)', 'emit(?:a|e|ir)', 'aprov(?:e|a|ar)', 'cancel(?:e|a|ar)',
      'duplic(?:a|ar)', 'duplique', 'convert(?:a|e|er)', 'lanc(?:e|a|ar)', 'dar baixa', 'baixar', 'coloque', 'colocar', 'registr(?:e|a|ar)', 'faca', 'fazer',
      'gere', 'gerar(?! relatorio)', 'coloca', 'bota', 'botar', 'poe', 'ponha', 'tira', 'tirar', 'retire', 'retirar', 'aument(?:e|a|ar)',
      'diminu(?:a|i|ir)', 'reduz(?:a|ir)?', 'ajust(?:e|a|ar)', 'desconto de', 'nova os', 'novo chamado', 'nova proposta', 'novo orcamento',
      'abr(?:a|e|ir)(?: um| uma| o| a| novo| nova)? (?:chamado|ticket|os|o\\.s\\.|ordem)',
    ].join('|') +
    String.raw`)\b`,
);

const DIAGNOSTICO_RE = /\b(expirou|expirada|deu erro|nao funciona|nao consigo|nao abre|nao abriu|nao esta abrindo|nao abrindo|nao localizad[ao]|nao encontr\w*|nao aparece|nao acho|nao consigo abrir|link invalido|invalid[ao]|erro|sem permissao|por que|porque|pq|sumiu)\b/;

const DADOS_RE = /\b(liste|listar|lista|mostre|mostrar|mostra|me mostra|me de|quais|qual o total|quantos|quantas|quanto|ver|veja|traga|trazer|exiba|exibir|relatorio|consulte|consultar|buscar|busque|procure|procurar|pesquise|pesquisar|encontre|localize|localizar|ache|achar|tem algum|tem alguma|existe algum|existe alguma|status|situacao)\b/;

const BUSCA_LIVRE_RE = /\b(?:procure|procurar|busque|buscar|pesquise|pesquisar|encontre|encontrar|localize|localizar|ache|achar|quem e|dados d[aoe]|cadastro d[aoe]|informacoes d[aoe]|ficha d[aoe])\b\s*(?:por |pelo |pela |o |a |os |as |um |uma )?(.+)$/;

const RELATORIO_RE = /\b(relatorio|total|totais|soma|somar|somatorio|quanto|quantos|quantas|resumo|por mes|por situacao|agrupad\w*|mensal|mes a mes)\b/;

const STOP = new Set(
  (
    'quais qual quanto quantos quantas me mostre mostrar mostra liste listar lista ver veja traga traz trazer exiba consulte consultar todos todas tudo os as o a ' +
    'link links url pdf pdfs passe passa copie copia copiar ' +
    'de do da dos das no na nos nas em para pra pro com por que e ou um uma uns umas meu minha meus minhas nosso nossa nossos nossas tem temos ha existe existem ' +
    'relatorio total totais soma somar resumo valor valores cliente clientes empresa empresas sobre busque buscar procure procurar pesquise pesquisar ' +
    'encontre encontrar localize localizar ache achar ultimos ultimas ultimo ultima mes meses ano semana hoje ontem passado passada este esse esta essa ' +
    'recusados recusado enviados enviado emitidos emitido aprovado convertidos convertido rascunhos quitada quitado fechado fechada suspensa suspensas renovacao atraso resolvidos resolvidas resolvido fechados fechadas quitadas quitados tabela precos preco dados informacoes ficha vence vencem vencer vencendo vencimento deste desse desta dessa neste nesse nesta nessa atual agrupado agrupar agrupados situacao status preciso quero gostaria saber favor pf ai sistema sti hub ' +
    'erp crm cadastrados cadastradas cadastro registrados lista ativos ativas ativo ativa inativos inativas vencidos vencidas vencido vencida atrasados atrasadas ' +
    'atrasado atrasada abertos abertas aberto aberta pagos pagas pago paga emitidas emitida pendentes pendente encerrados encerrados encerrado encerrada ' +
    'cancelados canceladas cancelado cancelada concluidas concluidos concluida concluido rascunho rascunhos enviadas enviada aprovadas aprovada aprovados ' +
    'recusadas recusada convertidas convertida negociacao andamento implantacao suspensos suspenso renovacao proxima proximos zerado zerados sem baixo minimo ' +
    'acabando disponivel disponiveis dia dias agora favor tambem so apenas mais recentes recente novos novas maior maiores menor por mes mensal ' +
    'contas conta receber pagar titulos notas nota fiscal fiscais nf faturas fatura boletos boleto cobrancas cobranca ordens ordem servico servicos os chamados chamado tickets ticket ' +
    'propostas proposta orcamentos orcamento contratos contrato locacoes fornecedores fornecedor transportadoras estoque estoques produtos produto catalogo ' +
    'equipamentos equipamento vendas venda negocios negocio contatos contato painel dashboard faturamento faturado eletronica eletronicas'
  ).split(/\s+/),
);

interface StatusRota {
  status?: string;
}

function statusDa(ent: EntidadeRota, t: string): StatusRota {
  const has = (re: RegExp) => re.test(t);
  if (ent === 'propostas') {
    if (has(/\brascunhos?\b/)) return { status: 'RASCUNHO' };
    if (has(/\bem negociacao\b|\bnegociacao\b/)) return { status: 'EM_NEGOCIACAO' };
    if (has(/\bconvertid[ao]s?\b/)) return { status: 'CONVERTIDA_CONTRATO' };
    if (has(/\baprovad[ao]s?\b|\bganh[ao]s?\b|\bfechad[ao]s?\b/)) return { status: 'APROVADA' };
    if (has(/\brecusad[ao]s?\b|\bperdid[ao]s?\b|\brejeitad[ao]s?\b/)) return { status: 'RECUSADA' };
    if (has(/\benviad[ao]s?\b/)) return { status: 'ENVIADA' };
    return {};
  }
  if (has(/\b(vencid[ao]s?|atrasad[ao]s?|em atraso|inadimplentes?)\b/)) return { status: 'vencido' };
  if (ent === 'estoque' || ent === 'produtos') {
    if (has(/\b(sem estoque|zerad[ao]s?|acabou|acabaram|esgotad[ao]s?)\b/)) return { status: 'sem estoque' };
    if (has(/\b(abaixo do minimo|estoque baixo|acabando|baixo)\b/)) return { status: 'abaixo do minimo' };
    if (has(/\binativ[ao]s?\b/)) return { status: 'inativo' };
    return {};
  }
  if (has(/\b(pag[ao]s|quitad[ao]s?|recebid[ao]s|liquidad[ao]s?)\b/)) return { status: ent === 'faturas' || ent === 'notas_fiscais' ? 'PAGA' : 'PAGO' };
  if (has(/\bcancelad[ao]s?\b/)) return { status: 'cancel' };
  if (has(/\b(encerrad[ao]s?|finalizad[ao]s?)\b/)) return { status: ent === 'contratos' ? 'ENCERRADO' : 'conclu' };
  if (has(/\bconcluid[ao]s?\b|\bresolvid[ao]s?\b|\bfechad[ao]s?\b/)) return { status: ent === 'chamados' ? 'resolvido' : 'conclu' };
  if (has(/\bem implantacao\b|\bimplantacao\b/)) return { status: 'EM_IMPLANTACAO' };
  if (has(/\bsuspens[ao]s?\b/)) return { status: 'SUSPENSO' };
  if (has(/\brenovacao\b|\ba vencer\b|\bvencendo\b/)) return { status: ent === 'contratos' ? 'RENOVACAO_PROXIMA' : 'aberto' };
  if (has(/\bem andamento\b/)) return { status: 'em andamento' };
  if (has(/\b(em aberto|abert[ao]s?|pendentes?|a pagar|a receber|nao pag[ao]s?)\b/) && ent !== 'contas_receber' && ent !== 'contas_pagar') return { status: 'aberto' };
  if ((ent === 'contas_receber' || ent === 'contas_pagar') && has(/\b(em aberto|abert[ao]s?|pendentes?|nao pag[ao]s?)\b/)) return { status: 'aberto' };
  if (has(/\bativ[ao]s?\b|\bvigentes?\b/)) return { status: ent === 'contratos' ? 'ATIVO' : 'ativo' };
  if (has(/\bemitid[ao]s?\b/)) return { status: 'EMITIDA' };
  return {};
}

/** Sobra do texto depois de tirar palavras de comando, entidade, situacao e periodo => termo de busca. */
export function termoDeBusca(original: string, periodo: Periodo | null): string {
  let base = foldTexto(original).replace(/[?!.,;:()"“”]/g, ' ');
  if (periodo?.trecho) base = normalizarPergunta(base).replace(periodo.trecho, ' ');
  const toks = base.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const tok of toks) {
    const corr = normalizarPergunta(tok);
    if (STOP.has(tok) || STOP.has(corr)) continue;
    if (/^\d{1,2}$/.test(tok)) continue;
    if (tok.length < 2) continue;
    out.push(tok);
  }
  return out.join(' ').trim().slice(0, 80);
}

function detectarEntidade(t: string, raw: string): EntidadeRota | null {
  for (const [ent, re] of ENTIDADE_RE) {
    if (ent === 'notas_fiscais' && /\bnotas? de (?:debito|credito)\b/.test(t)) continue;
    if (re.test(t)) return ent;
  }
  // "OS" maiusculo, ou "as/das/minhas OS"
  if (/\bO\.?S\.?\b/.test(raw) || /\b(as|das|nas|minhas|quantas|todas as|liste as|ver as) os\b/.test(t) || /\bos (abertas|em aberto|fechadas|concluidas|pendentes|atrasadas|do cliente|da empresa)\b/.test(t)) {
    return 'ordens_servico';
  }
  return null;
}

function rotaIdentificadores(ids: Identificador[], t: string): RotaAssistente {
  const diag = DIAGNOSTICO_RE.test(t);
  const link = ids.find((i) => i.tipo === 'link_proposta');
  if (ids.length === 1 && ids[0].tipo === 'proposta' && !diag) {
    return { tipo: 'ferramenta', ferramenta: 'consultar_propostas', args: { busca: ids[0].valor }, motivo: 'numero de orcamento' };
  }
  const partes = ids.map((i) => {
    switch (i.tipo) {
      case 'link_proposta':
        return i.link?.area === 'interno' ? `/interno/proposta/${i.valor}` : i.link?.area === 'curto' ? `/p/${i.valor}` : `/proposta/${i.valor}`;
      case 'id_proposta':
        return i.valor;
      case 'proposta':
        return `orçamento ${i.valor}`;
      case 'contrato':
        return `contrato ${i.valor}`;
      case 'fatura':
        return `fatura ${i.valor}`;
      case 'nota':
        return `nota ${i.valor}`;
      case 'chave_nfe':
        return i.valor;
      case 'os':
        return `OS ${i.valor}`;
      case 'chamado':
        return `chamado ${i.valor}`;
      case 'cnpj':
        return `CNPJ ${i.valor}`;
      case 'cpf':
        return `CPF ${i.valor}`;
      case 'email':
        return i.valor;
      case 'telefone':
        return `telefone ${i.valor}`;
      case 'codigo':
        return i.valor;
      default:
        return `número ${i.valor}`;
    }
  });
  const args: Record<string, unknown> = { termo: partes.join(' ').slice(0, 300) };
  if (diag || (link && link.link?.area !== 'interno' && !link.link?.comToken)) args.contexto = 'nao_abre';
  if (link?.link?.comToken) args.link_com_assinatura = true;
  return { tipo: 'ferramenta', ferramenta: 'buscar', args, motivo: `identificador ${ids.map((i) => i.tipo).join('+')}` };
}

const ENTIDADE_CONSULTAR: Partial<Record<EntidadeRota, string>> = {
  contas_receber: 'contas_receber', contas_pagar: 'contas_pagar', notas_fiscais: 'notas_fiscais', faturas: 'faturas',
  ordens_servico: 'ordens_servico', chamados: 'chamados', contratos: 'contratos', fornecedores: 'fornecedores', estoque: 'estoque',
  produtos: 'produtos', vendas: 'vendas', negocios: 'negocios', contatos: 'contatos', empresas: 'empresas',
};

/**
 * Decide a rota sem o modelo, ou null para seguir ao modelo.
 * Nunca grava nada: ferramentas sao propostas e passam pelo cartao de confirmacao.
 */
export function rotearPergunta(texto: string, opts: { agora: number; respondendoPergunta?: boolean; contexto?: RegistroContexto | null }): RotaAssistente | null {
  const raw = String(texto || '').trim();
  if (!raw || raw.length > 2000) return null;
  // O assistente fez uma pergunta (ex.: "qual das empresas?"): a resposta depende do historico => modelo.
  if (opts.respondendoPergunta) return null;
  const t = normalizarPergunta(raw);
  if (!t || /^(oi|ola|bom dia|boa tarde|boa noite|obrigad[oa]|valeu|ok|blz|beleza|sim|nao|isso|confirmo|cancela)\b[\s!.?]*$/.test(t)) return null;
  const ids = extrairIdentificadores(raw);
  // "Como/onde/o que e/por que..." sem identificador: resposta da base de conhecimento.
  if (!ids.length && /^(como|onde|o que|oque|pra que|para que|por que|porque|pq|qual a diferenca|e possivel|tem como|da pra|da para|a seta)\b/.test(t) && !/^como (esta|estao|anda|andam|ficou|ficaram|vai|vao)\b/.test(t)) {
    const kb = buscarConhecimento(raw, 3);
    if (kb) return { tipo: 'texto', texto: kb.entrada.resposta, motivo: `conhecimento:${kb.entrada.id}` };
    // "Como faço X?" sem assunto da base: e duvida, nao pedido de lista => modelo.
    if (/^(como|onde|o que|oque|pra que|para que|qual a diferenca)\b/.test(t)) return null;
  }
  // "traga o link da proposta", "manda o PDF", "versão contrato dela": age sobre o ultimo registro
  // citado; sem registro na conversa, pergunta qual (nunca busca pela palavra "link").
  const pedido = pedidoSobreRegistro(raw);
  if (pedido) {
    if (opts.contexto) {
      const r = rotaDoContexto(opts.contexto);
      return { tipo: 'ferramenta', ferramenta: r.ferramenta, args: r.args, motivo: `registro em contexto (${pedido})` };
    }
    return { tipo: 'texto', texto: PERGUNTA_QUAL_REGISTRO, motivo: `sem registro em contexto (${pedido})` };
  }
  // Pedido de gravacao: o modelo monta a acao (rascunho, edicao, OS, chamado) com cartao.
  if (GRAVACAO_RE.test(t) && !/\brelatorio\b/.test(t)) return null;
  // Valor em reais junto do pedido ("4709 com 2.800,00 de locomoção") costuma ser edição => modelo.
  if (/r\$\s?\d|\b\d{1,3}(?:\.\d{3})*,\d{2}\b/.test(t)) return null;

  // Duvida com identificador ("por que a proposta prop-... nao abre?") => busca com diagnostico.
  if (ids.length) return rotaIdentificadores(ids, t);

  const periodo = periodoRelativo(raw, opts.agora);
  const duvidaForte = pareceDuvida(raw) || (/\?\s*$/.test(raw) && !DADOS_RE.test(t));
  if (duvidaForte) {
    const kb = buscarConhecimento(raw);
    if (kb) return { tipo: 'texto', texto: kb.entrada.resposta, motivo: `conhecimento:${kb.entrada.id}` };
  }

  const ent = detectarEntidade(t, raw);
  const painel = PAINEL_RE.test(t) && (!ent || ent === 'propostas' && /\b(feitas|taxa|aprovacao)\b/.test(t));
  if (painel) {
    const args: Record<string, unknown> = {};
    if (periodo?.mes) args.mes = periodo.mes;
    return { tipo: 'ferramenta', ferramenta: 'painel', args, motivo: 'painel' };
  }

  if (ent) {
    const st = statusDa(ent, t);
    const busca = termoDeBusca(raw, periodo);
    const relatorio = RELATORIO_RE.test(t);
    if (ent === 'propostas') {
      if (relatorio && periodo?.mes && !busca) return { tipo: 'ferramenta', ferramenta: 'painel', args: { mes: periodo.mes }, motivo: 'propostas do mes => painel' };
      const args: Record<string, unknown> = {};
      if (busca) args.busca = busca;
      if (st.status) args.status = st.status;
      if (periodo) {
        args.de = periodo.de;
        args.ate = periodo.ate;
      }
      return { tipo: 'ferramenta', ferramenta: 'consultar_propostas', args, motivo: 'lista de propostas' };
    }
    if (ent === 'empresas' && busca && !relatorio) {
      return { tipo: 'ferramenta', ferramenta: 'buscar', args: { termo: busca }, motivo: 'cliente por nome' };
    }
    const entidade = ENTIDADE_CONSULTAR[ent]!;
    const args: Record<string, unknown> = { entidade };
    if (busca) args.busca = busca;
    if (st.status) args.status = st.status;
    if (periodo) {
      args.de = periodo.de;
      args.ate = periodo.ate;
    }
    if (relatorio) {
      if (/\b(por mes|mensal|mes a mes|cada mes)\b/.test(t)) args.agrupar_por = 'mes';
      return { tipo: 'ferramenta', ferramenta: 'relatorio', args, motivo: `relatorio ${entidade}` };
    }
    return { tipo: 'ferramenta', ferramenta: 'consultar', args, motivo: `lista ${entidade}` };
  }

  const livre = t.match(BUSCA_LIVRE_RE);
  if (livre) {
    const termo = termoDeBusca(livre[1], periodo) || livre[1].trim();
    if (termo.length >= 2) return { tipo: 'ferramenta', ferramenta: 'buscar', args: { termo: termo.slice(0, 120) }, motivo: 'busca livre' };
  }

  // Duvida mais fraca (sem "como/onde"), mas com assunto claro da base.
  const kb = buscarConhecimento(raw, /\?\s*$/.test(raw) ? 3 : 5);
  if (kb && (duvidaForte || /\?\s*$/.test(raw) || DIAGNOSTICO_RE.test(t))) return { tipo: 'texto', texto: kb.entrada.resposta, motivo: `conhecimento:${kb.entrada.id}` };
  return null;
}
