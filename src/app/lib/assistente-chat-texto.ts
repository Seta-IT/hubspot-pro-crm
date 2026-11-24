// ============================================================================
// STI-hub — Assistente: texto copiável das mensagens do chat (24/11/2026).
// Pedido do Marcéllo: "permitir que os textos do chat com a IA possam ser copiados".
// Funções puras (testáveis) + cópia com fallback quando o navegador nega a área de
// transferência. Nada aqui gera ou guarda token: links do cliente são pedidos no clique.
// ============================================================================

export interface TabelaChat {
  colunas: string[];
  linhas: string[][];
}

export interface ResultadoChatTexto {
  mensagem: string;
  totais?: Array<{ rotulo: string; valor: string }>;
  detalhes?: Array<{ rotulo: string; valor: string }>;
  tabela?: TabelaChat;
}

/** Destino interno de "Abrir no sistema" => seção do ERP (mesmo da busca global do cabeçalho). */
export const ALVO_SECAO_ERP: Record<string, string> = {
  PROPOSAL: 'ORCAMENTOS',
  CONTRACT: 'CONTRATOS',
  INVOICE: 'FISCAL',
  SERVICE_ORDER: 'ORDENS_SERVICOS',
  CUSTOMER: 'CADASTROS',
};

const limpa = (v: unknown) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();

/** Tabela como texto tabulado (cola certo no Excel/Sheets e em e-mail). */
export function tabelaParaTsv(t: TabelaChat): string {
  return [t.colunas, ...t.linhas].map((r) => r.map(limpa).join('\t')).join('\n');
}

/** Texto completo de um resultado: mensagem, totais, ficha e tabela. */
export function textoDoResultado(r: ResultadoChatTexto): string {
  const partes: string[] = [];
  if (r.mensagem) partes.push(r.mensagem.trim());
  // Com a ficha completa, os totais repetiriam os mesmos dados.
  if (r.totais?.length && !r.detalhes?.length) partes.push(r.totais.map((t) => `${t.rotulo}: ${t.valor}`).join('\n'));
  if (r.detalhes?.length) partes.push(r.detalhes.map((d) => `${d.rotulo}: ${d.valor}`).join('\n'));
  if (r.tabela?.linhas?.length) partes.push(tabelaParaTsv(r.tabela));
  return partes.join('\n\n');
}

/** Texto de um cartão de ação (pedido de confirmação). */
export function textoDoCartao(c: { texto?: string; titulo: string; linhas: string[] }): string {
  return [c.texto?.trim(), c.titulo, ...c.linhas].filter(Boolean).join('\n');
}

/** URL absoluta a partir de um caminho do próprio STI-hub (nunca de outro domínio). */
export function urlAbsoluta(caminho: string, origin: string): string {
  const c = String(caminho || '');
  if (!c.startsWith('/') || c.startsWith('//')) return '';
  return `${String(origin || '').replace(/\/+$/, '')}${c}`;
}

/** Copia para a área de transferência; sem permissão, usa um textarea temporário. */
export async function copiarTexto(texto: string): Promise<boolean> {
  const t = String(texto || '');
  if (!t) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(t);
      return true;
    }
  } catch {
    // cai no fallback
  }
  try {
    if (typeof document === 'undefined') return false;
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
