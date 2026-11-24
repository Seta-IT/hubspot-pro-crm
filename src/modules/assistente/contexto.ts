// ============================================================================
// STI-hub — Assistente: registro em contexto da conversa (24/11/2026).
//
// Caso do print: depois de achar o orcamento 4725 o usuario pediu "traga o link da
// proposta" e o assistente buscou propostas com o termo "link". Agora pedidos de link,
// PDF, Versao contrato ou "os dados dela" sem numero agem sobre o ULTIMO registro citado
// na conversa; sem registro, o assistente pergunta qual. Palavras como link, pdf,
// proposta e contrato nunca viram termo de busca.
// So texto: o servidor le o historico que o chat ja manda (sem dados novos do cliente).
// ============================================================================
import { extrairIdentificadores, foldTexto, type Identificador } from './identificadores';

export type TipoRegistroContexto = 'proposta' | 'contrato' | 'fatura' | 'nota' | 'ordem_servico' | 'chamado';

export interface RegistroContexto {
  tipo: TipoRegistroContexto;
  /** Numero/codigo (ex.: 4725, LOC-2026-101, SETA-123) ou id prop-... */
  ref: string;
}

/** Marcador que o servidor acrescenta ao resumo do resultado (vai no historico como texto). */
export const MARCA_CONTEXTO = 'Registro em contexto:';

export function marcaContexto(registro: { tipo: string; id: string; codigo?: string } | undefined): string {
  if (!registro) return '';
  const tipo = String(registro.tipo || '');
  const ref = String(registro.codigo || registro.id || '').replace(/[\[\]\n]/g, '').trim().slice(0, 80);
  if (!ref || !/^(proposta|contrato|fatura|nota|ordem_servico|chamado)$/.test(tipo)) return '';
  return ` ${MARCA_CONTEXTO} ${tipo} [${ref}].`;
}

const MARCA_RE = /Registro em contexto: (proposta|contrato|fatura|nota|ordem_servico|chamado) \[([^\]\n]{1,80})\]/g;

function doIdentificador(i: Identificador): RegistroContexto | null {
  switch (i.tipo) {
    case 'id_proposta':
    case 'link_proposta':
      return i.link?.area === 'curto' ? null : { tipo: 'proposta', ref: i.valor };
    case 'proposta':
      return { tipo: 'proposta', ref: i.valor };
    case 'contrato':
      return { tipo: 'contrato', ref: i.valor };
    case 'fatura':
      return { tipo: 'fatura', ref: i.valor };
    case 'nota':
      return { tipo: 'nota', ref: i.valor };
    case 'os':
      return { tipo: 'ordem_servico', ref: i.valor };
    case 'chamado':
      return { tipo: 'chamado', ref: i.valor };
    default:
      return null;
  }
}

/** Ultimo registro citado (resultado confirmado ou identificador digitado), do mais recente ao mais antigo. */
export function registroEmContexto(mensagens: Array<{ papel: 'usuario' | 'assistente'; texto: string }>, ignorarUltima = true): RegistroContexto | null {
  const lista = ignorarUltima ? mensagens.slice(0, -1) : mensagens.slice();
  for (let k = lista.length - 1, n = 0; k >= 0 && n < 16; k--, n++) {
    const m = lista[k];
    const texto = String(m?.texto || '');
    if (m.papel === 'assistente') {
      const marcas = [...texto.matchAll(MARCA_RE)];
      if (marcas.length) {
        const ult = marcas[marcas.length - 1];
        return { tipo: ult[1] as TipoRegistroContexto, ref: ult[2].trim() };
      }
      continue;
    }
    for (const i of extrairIdentificadores(texto)) {
      const r = doIdentificador(i);
      if (r) return r;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pedido sobre o registro (link, PDF, Versao contrato, dados completos) sem identificador
// ---------------------------------------------------------------------------
export type PedidoRegistro = 'link' | 'pdf' | 'versao_contrato' | 'detalhes';

const LINK_RE = /\b(link|links|url|endereco|enderecos)\b/;
const PDF_RE = /\b(pdf|pdfs|pds|imprimir|impressao|baixar|baixe|download)\b/;
const VERSAO_RE = /\bversao (?:de |do |para |pro )?contrato\b/;
const DETALHE_RE = /\b(detalhes?|detalhad[ao]|dados|itens|valores?|validade|vendedor|completo|completa|informacoes|ficha|resumo|abr[ae]|abrir)\b/;
/** Referencia a algo ja citado: "dela", "dessa proposta", "do orcamento"... */
const ANAFORA_RE = /\b(dela|dele|desse|dessa|deste|desta|nessa|nesse|essa|esse|esta|este|ela|ele|mesm[ao]|da proposta|do orcamento|do contrato|da fatura|da nota|da os|do chamado|a proposta|o orcamento|o contrato|a fatura)\b/;
/** Enviar ao cliente por e-mail/WhatsApp e outra acao (fora do escopo): nao e copiar link. */
const ENVIO_EXTERNO_RE = /\b(e-?mail|email|whats\w*|zap|sms)\b/;
/** Verbos de gravacao fortes: nunca tratar como pedido de link/ficha. */
const ESCRITA_RE = /\b(adicion\w*|acrescent\w*|inclu[ai]\w*|alter[ae]\w*|mud[ae]\w*|atualiz\w*|edit[ae]\w*|corrij\w*|corrigir|cri[ae]r?|cadastr\w*|exclu[ai]\w*|delet\w*|remov\w*|apag\w*|aprov\w*|cancel\w*|convert\w*|duplic\w*|renov\w*|reajust\w*|troc\w*|coloqu\w*|coloca|tir[ae]|aument\w*|diminu\w*|ajust\w*)\b/;
/** Lista/relatorio ("propostas com link enviado este mes") continua nas rotas de lista. */
const LISTA_RE = /\b(propostas|orcamentos|contratos|faturas|notas|chamados|liste|listar|lista|todas|todos|quantas|quantos|relatorio)\b/;

export function pedidoSobreRegistro(texto: string): PedidoRegistro | null {
  const raw = String(texto || '').trim();
  if (!raw || raw.length > 400) return null;
  if (extrairIdentificadores(raw).length) return null;
  const t = foldTexto(raw).replace(/[?!.,;:()"“”]/g, ' ').replace(/\s+/g, ' ').trim();
  if (ESCRITA_RE.test(t) || ENVIO_EXTERNO_RE.test(t) || LISTA_RE.test(t)) return null;
  if (VERSAO_RE.test(t)) return 'versao_contrato';
  if (PDF_RE.test(t)) return 'pdf';
  if (LINK_RE.test(t)) return 'link';
  if (DETALHE_RE.test(t) && ANAFORA_RE.test(t)) return 'detalhes';
  return null;
}

/** Termo que e so palavra generica ("link", "pdf", "proposta", "o link da proposta"): nao e busca. */
const GENERICAS = new Set(
  (
    'link links url endereco pdf pdfs pds versao contrato contratos proposta propostas orcamento orcamentos comercial fatura faturas nota notas fiscal ' +
    'os chamado chamado registro documento arquivo cliente do da de o a os as um uma esse essa este esta dele dela desse dessa deste desta ' +
    'traga traz trazer me mande manda mandar passe passa passar copie copia copiar gere gera gerar baixar baixe download abrir abra abre ver mostre mostra ' +
    'qual quais e eh o seu sua por favor pf completo completa dados detalhes'
  ).split(/\s+/),
);

export function termoGenerico(termo: unknown): boolean {
  const toks = foldTexto(String(termo || '')).replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);
  return toks.length > 0 && toks.every((t) => GENERICAS.has(t));
}

/** Argumentos da ferramenta de leitura que traz a ficha completa do registro em contexto. */
export function rotaDoContexto(ctx: RegistroContexto): { ferramenta: string; args: Record<string, unknown> } {
  if (ctx.tipo === 'proposta') return { ferramenta: 'consultar_propostas', args: { busca: ctx.ref } };
  const prefixo: Record<Exclude<TipoRegistroContexto, 'proposta'>, string> = {
    contrato: 'contrato',
    fatura: 'fatura',
    nota: 'nota',
    ordem_servico: 'OS',
    chamado: 'chamado',
  };
  return { ferramenta: 'buscar', args: { termo: `${prefixo[ctx.tipo]} ${ctx.ref}`.slice(0, 300) } };
}

export const PERGUNTA_QUAL_REGISTRO =
  'Qual proposta ou registro você quer? Me diga o número (ex.: 4725), o código prop-..., o link colado ou o nome do cliente, e eu trago os dados completos com o link do cliente, a Versão contrato e o PDF.';
