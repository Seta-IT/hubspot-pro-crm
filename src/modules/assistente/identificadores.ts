// ============================================================================
// STI-hub — Assistente: reconhecimento de identificadores e normalizacao de texto.
//
// Modulo puro (sem rede, sem dados): recebe o texto do usuario e devolve os
// identificadores encontrados (link colado, id prop-..., numero de orcamento,
// contrato, fatura, nota, OS, chamado, CNPJ/CPF, e-mail, telefone...) e o texto
// normalizado (sem acento, minusculo, com erros de digitacao comuns corrigidos).
// Usado pela busca universal e pelo roteador de intencao. Nunca devolve o token
// de um link assinado: so registra que ele existia.
// ============================================================================

export type TipoIdentificador =
  | 'link_proposta'
  | 'id_proposta'
  | 'proposta'
  | 'contrato'
  | 'fatura'
  | 'nota'
  | 'chave_nfe'
  | 'os'
  | 'chamado'
  | 'cnpj'
  | 'cpf'
  | 'email'
  | 'telefone'
  | 'numero'
  | 'codigo';

export interface LinkInfo {
  /** publico = /proposta/<id>; interno = Versao contrato (/interno/proposta/<id>); curto = /p/<codigo>. */
  area: 'publico' | 'interno' | 'curto';
  /** O link colado tinha a assinatura do cliente (#t=...). O token nunca e guardado. */
  comToken: boolean;
  versao?: number;
}

export interface Identificador {
  tipo: TipoIdentificador;
  /** Valor normalizado para busca (ex.: so digitos no CNPJ, id do link). */
  valor: string;
  /** Texto curto para mostrar ao usuario (sem token). */
  rotulo: string;
  link?: LinkInfo;
}

/** Sem acento, minusculo, espacos simples. */
export function foldTexto(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export const soDigitos = (v: unknown) => String(v ?? '').replace(/\D+/g, '');

export function formatarCnpj(d: string): string {
  const s = soDigitos(d);
  return s.length === 14 ? `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}` : s;
}

export function formatarCpf(d: string): string {
  const s = soDigitos(d);
  return s.length === 11 ? `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}` : s;
}

/** Digitos verificadores do CPF (rejeita sequencias repetidas). */
export function cpfValido(v: string): boolean {
  const s = soDigitos(v);
  if (s.length !== 11 || /^(\d)\1{10}$/.test(s)) return false;
  const dv = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(s[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(s[9]) && dv(10) === Number(s[10]);
}

/** Digitos verificadores do CNPJ (rejeita sequencias repetidas). */
export function cnpjValido(v: string): boolean {
  const s = soDigitos(v);
  if (s.length !== 14 || /^(\d)\1{13}$/.test(s)) return false;
  const calc = (len: number) => {
    const pesos = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(s[i]) * pesos[i];
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(s[12]) && calc(13) === Number(s[13]);
}

// ---------------------------------------------------------------------------
// Correcao de digitacao: palavras do dominio do STI-hub
// ---------------------------------------------------------------------------
/** Palavras do dominio para as quais uma palavra digitada errada pode ser corrigida. */
const VOCABULARIO = [
  'orcamento', 'orcamentos', 'proposta', 'propostas', 'contrato', 'contratos', 'fatura', 'faturas', 'chamado', 'chamados',
  'ordem', 'ordens', 'servico', 'servicos', 'nota', 'notas', 'fiscal', 'fiscais', 'cliente', 'clientes', 'fornecedor',
  'fornecedores', 'produto', 'produtos', 'estoque', 'financeiro', 'vencido', 'vencidos', 'vencida', 'vencidas', 'atrasado',
  'atrasados', 'atrasada', 'atrasadas', 'receber', 'painel', 'relatorio', 'faturamento', 'locacao',
  'locacoes', 'aprovada', 'aprovadas', 'aprovado', 'aprovados', 'recusada', 'recusadas', 'rascunho', 'rascunhos', 'enviada', 'enviadas',
  'negociacao', 'convertida', 'convertidas', 'empresa', 'empresas', 'contato', 'contatos', 'vendas', 'negocio', 'negocios',
  'ticket', 'tickets', 'boleto', 'boletos', 'pagamento', 'pagamentos', 'encerrado', 'encerrados',
  'cancelada', 'canceladas', 'pendente', 'pendentes', 'cadastro', 'equipamento', 'equipamentos', 'catalogo',
  'dashboard', 'localizada', 'localizado', 'encontrada', 'encontrado', 'permissao', 'invalido', 'invalida', 'cartao', 'credito',
  'reajuste', 'vigencia', 'disponivel', 'disponiveis', 'telefone', 'transferencia', 'renovacao', 'aprovacao',
  'mensalidade', 'despesas', 'recebimentos', 'versao', 'versoes', 'assinatura', 'sincronizacao', 'gestaoclick',
];
/** Palavras conhecidas que nunca sao "corrigidas" (evita abrir => abril, pagas => pagar). */
const CONHECIDAS = [
  ...VOCABULARIO,
  'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  'abrir', 'abra', 'abre', 'abriu', 'abrindo', 'cadastrar', 'editar', 'alterar', 'criar', 'emitir', 'enviar', 'gerar', 'aprovar', 'converter',
  'revalidar', 'copiar', 'misturar', 'mostrar', 'mostre', 'listar', 'liste', 'procure', 'procurar', 'pesquise', 'pesquisar', 'encontre',
  'localize', 'localizar', 'buscar', 'busque', 'quantos', 'quantas', 'quanto', 'pagas', 'pagos', 'pagar', 'pago', 'paga', 'pagou', 'quitadas', 'quitados',
  'resolvidos', 'resolvidas', 'resolvido', 'fechados', 'fechadas', 'concluidas', 'concluidos', 'concluida', 'concluido', 'andamento',
  'implantacao', 'suspensos', 'suspenso', 'inativo', 'inativos', 'inativa', 'inativas', 'ativo', 'ativos', 'ativa', 'ativas', 'precos',
  'preco', 'tabela', 'dados', 'atraso', 'emitidas', 'emitida', 'emitidos', 'enviados', 'enviado', 'recusados', 'recusado', 'vencem', 'vence',
  'vencer', 'vencendo', 'vencimento', 'ontem', 'semana', 'passado', 'passada', 'proximo', 'proxima', 'ultimos', 'ultimas', 'todas', 'todos',
  'minhas', 'meus', 'nossos', 'nossas', 'faturamos', 'faturou', 'faturado', 'recebemos', 'recebido', 'recebidos', 'aberto', 'abertos',
  'aberta', 'abertas', 'contas', 'mensal', 'balcao', 'diferenca', 'entre', 'existe', 'existem', 'aparece', 'aparecer', 'sumiu', 'consigo',
  'funciona', 'funcionar', 'mostra', 'antes', 'depois', 'sempre', 'nunca', 'porque', 'quando', 'quais', 'sobre', 'sessao', 'expirou',
  'expirada', 'senha', 'acesso', 'negado', 'login', 'usuario', 'perfil', 'modulo', 'modulos', 'alcada', 'banco', 'bancos', 'saldo',
  'setup', 'valor', 'valores', 'total', 'totais', 'unico', 'pontual', 'avulso', 'mensais', 'meses', 'prazo', 'validade', 'link', 'links',
  'interno', 'interna', 'publico', 'token', 'cliente', 'cidade', 'estado', 'nome', 'razao', 'social', 'fantasia', 'email', 'celular',
  'whatsapp', 'endereco', 'numero', 'codigo', 'chave', 'serie', 'tecnico', 'laudo', 'equipe', 'filial', 'matriz', 'pedido', 'pedidos',
  'compra', 'compras', 'parcela', 'parcelas', 'parcelar', 'debito', 'agora', 'favor', 'obrigado', 'obrigada', 'ajuda', 'ajudar', 'preciso',
  'quero', 'gostaria', 'saber', 'tambem', 'apenas', 'somente', 'ainda', 'nenhum', 'nenhuma', 'algum', 'alguma', 'grupo', 'dafiti',
  'parangaba', 'condominio', 'servidor', 'servidores', 'switch', 'cloud', 'telecom', 'seta', 'hoje', 'amanha', 'anteontem', 'mesmo', 'mesma',
];
const VOCAB_SET = new Set(CONHECIDAS);

/** Abreviacoes e sinonimos que viram a palavra canonica. */
const ABREVIACOES: Record<string, string> = {
  orc: 'orcamento', orcs: 'orcamentos', orca: 'orcamento', orçs: 'orcamentos', prop: 'proposta', props: 'propostas',
  contr: 'contrato', ctr: 'contrato', fat: 'fatura', fats: 'faturas', nf: 'nota', nfs: 'notas', nfe: 'nota', nfse: 'nota',
  nfcom: 'nota', nfce: 'nota', danfe: 'nota', qtd: 'quantos', qto: 'quanto', qts: 'quantos', vc: 'voce', pq: 'por que',
  porque: 'por que', tbm: 'tambem', tb: 'tambem', cad: 'cadastro', forn: 'fornecedor', cli: 'cliente', clis: 'clientes',
  hj: 'hoje', dash: 'dashboard', rel: 'relatorio', estq: 'estoque', fin: 'financeiro', obs: 'observacoes',
};

function distancia(a: string, b: string, max: number): number {
  // Damerau-Levenshtein (OSA): troca de duas letras vizinhas ("fatruas") custa 1.
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = [];
  for (let i = 0; i <= a.length; i++) d.push([i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + custo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/** Corrige uma palavra pelo vocabulario do sistema (so quando ha um unico candidato proximo). */
export function corrigirPalavra(w: string): string {
  if (ABREVIACOES[w]) return ABREVIACOES[w];
  if (w.length < 5 || VOCAB_SET.has(w) || /\d/.test(w)) return w;
  const max = w.length >= 8 ? 2 : 1;
  let bestD = max + 1;
  let cands: string[] = [];
  for (const v of VOCABULARIO) {
    const d = distancia(w, v, max);
    if (d < bestD) {
      bestD = d;
      cands = [v];
    } else if (d === bestD && d <= max) {
      cands.push(v);
    }
  }
  if (!cands.length || bestD > max) return w;
  if (cands.length === 1) return cands[0];
  // Empate entre singular/plural da mesma palavra nao e ambiguidade real.
  const raiz = (x: string) => x.replace(/(es|s)$/, '');
  if (cands.every((c) => raiz(c) === raiz(cands[0]))) {
    const plural = w.endsWith('s');
    return cands.find((c) => c.endsWith('s') === plural) || cands[0];
  }
  return w;
}

/** Texto sem acento, minusculo, pontuacao leve removida e digitacao corrigida palavra a palavra. */
export function normalizarPergunta(v: unknown): string {
  return foldTexto(v)
    .replace(/[“”"'`´]/g, ' ')
    .split(/(\s+|[,;:!?()\[\]{}])/)
    .map((tok) => (/^[a-z]+$/.test(tok) ? corrigirPalavra(tok) : tok))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Extracao de identificadores
// ---------------------------------------------------------------------------
const NUM_PREFIXO = String.raw`\s*(?:n[o°º.]*\s*|num(?:ero)?\.?\s*|#\s*|:\s*|de numero\s*)?`;

/** Remove os trechos ja reconhecidos (troca por espaco) para nao contar duas vezes. */
function apagar(s: string, re: RegExp): string {
  return s.replace(re, (m) => ' '.repeat(m.length));
}

function push(out: Identificador[], id: Identificador) {
  if (!out.some((o) => o.tipo === id.tipo && o.valor === id.valor)) out.push(id);
}

export function extrairIdentificadores(texto: unknown): Identificador[] {
  let s = String(texto ?? '').slice(0, 4000);
  const out: Identificador[] = [];

  // 1) Links colados: /proposta/<id>[/v/<n>][#t=...], /interno/proposta/<id>, /p/<codigo>
  const linkRe = /(?:https?:\/\/[^\s/]+)?\/(interno\/proposta|proposta|p)\/([A-Za-z0-9._~%-]+)(?:\/v\/(\d+))?([^\s]*)/gi;
  for (const m of s.matchAll(linkRe)) {
    let id = m[2];
    try {
      id = decodeURIComponent(id);
    } catch {
      /* mantem como veio */
    }
    const area: LinkInfo['area'] = m[1].toLowerCase() === 'p' ? 'curto' : m[1].toLowerCase().startsWith('interno') ? 'interno' : 'publico';
    const resto = m[4] || '';
    const comToken = /(?:[#?&])t=[^&\s]{8,}/.test(resto);
    const versao = m[3] ? Number(m[3]) : undefined;
    push(out, {
      tipo: 'link_proposta',
      valor: id,
      rotulo: area === 'interno' ? `Versão contrato /interno/proposta/${id}` : area === 'curto' ? `link curto /p/${id}` : `link /proposta/${id}${versao ? `/v/${versao}` : ''}`,
      link: { area, comToken, ...(versao ? { versao } : {}) },
    });
  }
  s = apagar(s, linkRe);

  // 2) Id interno da proposta
  const propRe = /\bprop-[a-z0-9]+(?:-[a-z0-9]+)*\b/gi;
  for (const m of s.matchAll(propRe)) push(out, { tipo: 'id_proposta', valor: m[0].toLowerCase(), rotulo: m[0] });
  s = apagar(s, propRe);

  // 3) E-mail
  const emailRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
  for (const m of s.matchAll(emailRe)) push(out, { tipo: 'email', valor: m[0].toLowerCase(), rotulo: m[0].toLowerCase() });
  s = apagar(s, emailRe);

  // 4) Chave de acesso da NF-e/NFCom (44 digitos, com ou sem espacos)
  const chaveRe = /\b(?:\d{4}[ .]?){10}\d{4}\b/g;
  for (const m of s.matchAll(chaveRe)) {
    const d = soDigitos(m[0]);
    if (d.length === 44) push(out, { tipo: 'chave_nfe', valor: d, rotulo: `chave ${d.slice(0, 6)}…${d.slice(-6)}` });
  }
  s = apagar(s, chaveRe);

  // 5) CNPJ (com ou sem mascara) e CPF
  const cnpjRe = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
  for (const m of s.matchAll(cnpjRe)) {
    const d = soDigitos(m[0]);
    if (d.length === 14) push(out, { tipo: 'cnpj', valor: d, rotulo: `CNPJ ${formatarCnpj(d)}` });
  }
  s = apagar(s, cnpjRe);
  const cpfMaskRe = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;
  for (const m of s.matchAll(cpfMaskRe)) push(out, { tipo: 'cpf', valor: soDigitos(m[0]), rotulo: `CPF ${m[0]}` });
  s = apagar(s, cpfMaskRe);

  // 6) Telefone: com DDD entre parenteses, +55, ou separado por traco/espaco
  const foneRe = /(?:\+?55[\s-]?)?(?:\(\d{2}\)\s?|\b\d{2}[\s-])9?\d{4}[-\s]\d{4}\b/g;
  for (const m of s.matchAll(foneRe)) {
    const d = soDigitos(m[0]).replace(/^55(?=\d{10,11}$)/, '');
    if (d.length >= 10 && d.length <= 11) push(out, { tipo: 'telefone', valor: d, rotulo: `telefone ${m[0].trim()}` });
  }
  s = apagar(s, foneRe);
  // 11 digitos soltos: CPF valido ou celular; 10 digitos com contexto de telefone.
  const onzeRe = /\b\d{10,11}\b/g;
  const foldAll = foldTexto(s);
  const contextoFone = /\b(tel|telefone|fone|celular|cel|whats|whatsapp|zap)\b/.test(foldAll);
  const contextoCpf = /\bcpf\b/.test(foldAll);
  for (const m of s.matchAll(onzeRe)) {
    const d = m[0];
    if (d.length === 11 && (contextoCpf || (cpfValido(d) && !contextoFone))) push(out, { tipo: 'cpf', valor: d, rotulo: `CPF ${formatarCpf(d)}` });
    else if (contextoFone || (d.length === 11 && d[2] === '9')) push(out, { tipo: 'telefone', valor: d, rotulo: `telefone ${d}` });
  }
  s = s.replace(onzeRe, (m) => (out.some((o) => o.valor === m) ? ' '.repeat(m.length) : m));

  // 7) Numeros com o tipo dito pelo usuario (texto sem acento; o tamanho muda, por isso nao apaga do original)
  const f = normalizarPergunta(s);
  const achados = new Set<string>();
  const comTipo = (tipo: TipoIdentificador, re: RegExp, rotulo: (v: string) => string, norm: (v: string) => string = (v) => v) => {
    for (const m of f.matchAll(re)) {
      const v = norm(m[1].replace(/[.,;:]+$/, ''));
      if (!v) continue;
      achados.add(m[1].replace(/[.,;:]+$/, ''));
      push(out, { tipo, valor: v, rotulo: rotulo(v) });
    }
  };
  comTipo('proposta', /\bgc-orc-(\d{1,9})\b/g, (v) => `orçamento ${v}`);
  comTipo(
    'proposta',
    new RegExp(String.raw`\b(?:propostas?|or[cç]amentos?|orcs?|orca|props?|cotacao)(?:\s+comercial)?${NUM_PREFIXO}(\d{1,9})\b`, 'g'),
    (v) => `orçamento ${v}`,
  );
  comTipo(
    'contrato',
    new RegExp(String.raw`\b(?:contratos?)(?:\s+de\s+(?:locacao|servicos?))?${NUM_PREFIXO}([a-z]{0,8}-?\d[a-z0-9./-]*)`, 'g'),
    (v) => `contrato ${v.toUpperCase()}`,
  );
  comTipo('fatura', new RegExp(String.raw`\b(?:faturas?|boletos?|cobrancas?|recibos?)${NUM_PREFIXO}([a-z]{0,8}-?\d[a-z0-9./-]*)`, 'g'), (v) => `fatura ${v.toUpperCase()}`);
  comTipo(
    'nota',
    new RegExp(String.raw`\b(?:notas? fisca(?:l|is)(?: eletronicas?)?(?: de servicos?)?|notas?|nfs-?e|nf-?e|nfcom|nfc-?e|nf|danfe)${NUM_PREFIXO}(\d[\d./-]*)`, 'g'),
    (v) => `nota ${v}`,
    (v) => v.replace(/[./]/g, '').replace(/^0+(?=\d)/, ''),
  );
  comTipo('os', new RegExp(String.raw`\b(?:(?:ordem|ordens) de servicos?|ordem|o\.?s\.?)${NUM_PREFIXO}(\d{1,9})\b`, 'g'), (v) => `OS ${v}`);
  comTipo('chamado', new RegExp(String.raw`\b(?:chamados?|tickets?|card|issue|jira)${NUM_PREFIXO}([a-z][a-z0-9]{1,9}-\d{1,7}|\d{1,9})\b`, 'g'), (v) => `chamado ${v.toUpperCase()}`, (v) => v.toUpperCase());

  // 8) Codigo estilo PREFIXO-123 (chamado Jira, LOC-2026-101 etc.) sem tipo dito
  const codRe = /\b[A-Z][A-Z0-9]{1,9}(?:-[A-Z0-9]+)*-\d{1,7}\b/g;
  for (const m of s.matchAll(codRe)) {
    if (achados.has(m[0].toLowerCase())) continue;
    if (out.some((o) => o.valor.toUpperCase() === m[0].toUpperCase())) continue;
    if (/^GC-ORC-\d+$/i.test(m[0])) continue;
    push(out, { tipo: 'codigo', valor: m[0].toUpperCase(), rotulo: `código ${m[0].toUpperCase()}` });
  }

  // 9) Numero solto (#4709, "a 4709") quando nada mais foi reconhecido com ele
  for (const m of f.matchAll(/(?:^|[\s#(])#?(\d{3,9})\b(?![.,]\d)/g)) {
    const v = m[1];
    if (achados.has(v) || out.some((o) => o.valor === v || o.valor.endsWith(`-${v}`) || soDigitos(o.valor) === v)) continue;
    if (/^(19|20)\d{2}$/.test(v)) continue; // ano
    push(out, { tipo: 'numero', valor: v, rotulo: `número ${v}` });
  }
  return out.slice(0, 6);
}

/** Identificadores fortes: dispensam palavra de tipo para justificar uma busca. */
export function identificadorForte(i: Identificador): boolean {
  return i.tipo !== 'numero';
}
