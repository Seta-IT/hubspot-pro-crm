// ============================================================================
// STI-hub — Assistente: aprendizado contínuo (25/11/2026).
// Lições explícitas do usuário ("sempre faça X", "não é assim, é Y"), feedback (gostei / nao gostei) com
// motivo e escolhas de acessórios viram memória por usuário (tabela assistente_memorias).
// As relevantes entram no prompt das próximas conversas. Regras duras:
//  - nunca aprender senha, token, chave, cartão ou outro segredo;
//  - Trava Fiscal: uma lição nunca mistura CNPJs distintos; lição ligada a um CNPJ só é
//    usada quando a conversa atual trata desse mesmo CNPJ.
// ============================================================================
import { foldTexto } from './identificadores';
import type { MemoriaAprendida, TipoMemoria } from './conversas-store';

export const MAX_MEMORIAS_NO_PROMPT = 12;

const SEGREDO_RE = [
  /\b(senha|password|passwd|pwd|token|secret|segredo|chave (?:de )?api|api[_ -]?key|bearer|otp|codigo de verificacao|2fa|mfa|totp)\b/i,
  /\b(?:stihub_svc_|sk-|sk_|pk_|ghp_|gho_|xox[abpr]-|AKIA)[A-Za-z0-9._-]{4,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\./,
  /-----BEGIN [A-Z ]+-----/,
  /\b(?:\d[ -]?){13,19}\b/, // numero de cartao (e outros numeros longos demais para uma licao)
  /\b[A-Za-z0-9+/_-]{32,}={0,2}\b/,
  /\b(cvv|cvc|cartao de credito|numero do cartao)\b/i,
];

/** Texto com cara de segredo nunca vira memória. */
export function contemSegredo(texto: string): boolean {
  const t = String(texto || '');
  const semCnpj = t.replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, ' ');
  return SEGREDO_RE.some((re) => re.test(re.flags.includes('i') ? foldTexto(semCnpj) : semCnpj));
}

/** CNPJs (14 digitos) citados no texto, sem repetir. */
export function cnpjsDoTexto(texto: string): string[] {
  const out = new Set<string>();
  for (const m of String(texto || '').matchAll(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g)) {
    const d = m[0].replace(/\D+/g, '');
    if (d.length === 14) out.add(d);
  }
  return [...out];
}

const GATILHOS: Array<{ re: RegExp; tipo: TipoMemoria }> = [
  { re: /^(?:a partir de agora|daqui (?:pra|para) frente|de agora em diante|sempre que|sempre|nunca|jamais|evite|prefiro|eu prefiro|lembre(?:-se)? (?:que|de)|lembra (?:que|de)|anote (?:que|isso)|aprenda (?:que|isso)|guarde (?:que|isso)|nao faca mais|para de|pare de)\b/, tipo: 'preferencia' },
  { re: /^(?:nao e assim|nao e isso|esta errado|ta errado|errado|corrigindo|correcao|na verdade|o certo e|o correto e)\b/, tipo: 'correcao' },
];

export type LicaoDetectada =
  | { ok: true; tipo: TipoMemoria; texto: string; cnpj: string | null }
  | { ok: false; motivo: 'segredo' | 'cnpjs_distintos' };

/**
 * Detecta uma lição explícita na mensagem do usuário. null = não é lição.
 * "sempre faça X", "nunca ...", "prefiro ...", "não é assim, é Y", "lembre que ...".
 */
export function detectarLicao(texto: string): LicaoDetectada | null {
  const bruto = String(texto || '').trim();
  if (!bruto || bruto.length > 600) return null;
  const t = foldTexto(bruto).replace(/^[,.;:!\s-]+/, '');
  const g = GATILHOS.find((x) => x.re.test(t));
  if (!g) return null;
  // Pergunta nao e licao ("sempre aparece isso?").
  if (/\?\s*$/.test(bruto) && g.tipo === 'preferencia' && !/^(sempre|nunca)\b.*\b(faca|faça|use|mostre|traga|coloque|inclua|pergunte|responda)\b/i.test(bruto)) return null;
  if (contemSegredo(bruto)) return { ok: false, motivo: 'segredo' };
  const cnpjs = cnpjsDoTexto(bruto);
  if (cnpjs.length > 1) return { ok: false, motivo: 'cnpjs_distintos' };
  const limpo = bruto.replace(/\s+/g, ' ').slice(0, 500);
  return { ok: true, tipo: g.tipo, texto: limpo.charAt(0).toUpperCase() + limpo.slice(1), cnpj: cnpjs[0] || null };
}

export const RESPOSTA_LICAO_SEGREDO = 'Não guardo senhas, tokens, chaves ou dados de cartão. Essa mensagem não foi aprendida.';
export const RESPOSTA_LICAO_CNPJS = 'Trava Fiscal: uma lição não pode misturar CNPJs distintos. Mande uma lição para cada CNPJ.';

export function respostaLicaoGravada(texto: string, cnpj: string | null): string {
  return `Anotado. Vou seguir isso nas próximas conversas${cnpj ? ` (só para o CNPJ ${formatarCnpj14(cnpj)})` : ''}:\n"${texto}"\nVocê vê, edita ou apaga em "O que o assistente aprendeu".`;
}

const formatarCnpj14 = (d: string) => `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;

/** Lição a partir de um "não gostei" com motivo (ou null se o motivo não serve). */
export function licaoDeFeedback(motivo: string, pergunta: string): LicaoDetectada | null {
  const m = String(motivo || '').replace(/\s+/g, ' ').trim();
  if (m.length < 3) return null;
  if (contemSegredo(m) || contemSegredo(pergunta)) return { ok: false, motivo: 'segredo' };
  const cnpjs = new Set([...cnpjsDoTexto(m), ...cnpjsDoTexto(pergunta)]);
  if (cnpjs.size > 1) return { ok: false, motivo: 'cnpjs_distintos' };
  const p = String(pergunta || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  return { ok: true, tipo: 'feedback', texto: `Resposta reprovada${p ? ` para "${p}"` : ''}: ${m}`.slice(0, 500), cnpj: [...cnpjs][0] || null };
}

const STOP = new Set('a o os as de do da dos das e em no na nos nas um uma para pra por com que se nao sim sempre nunca faca fazer quando isso essa esse ser e me mim meu minha'.split(' '));
const palavras = (t: string) => new Set(foldTexto(t).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));

/**
 * Memórias que entram no prompt: ativas, sem as de sugestão de acessório (usadas na
 * busca do cadastro), sem as de outro CNPJ (Trava Fiscal), mais parecidas com a conversa
 * primeiro e depois as mais recentes.
 */
export function selecionarMemorias(memorias: MemoriaAprendida[], mensagens: Array<{ texto: string }>, max = MAX_MEMORIAS_NO_PROMPT): MemoriaAprendida[] {
  const conversa = mensagens.slice(-8).map((m) => m.texto).join('\n');
  const cnpjsConversa = new Set(cnpjsDoTexto(conversa));
  const pc = palavras(conversa);
  const candidatas = memorias.filter((m) => m.ativa && m.tipo !== 'sugestao' && (!m.cnpj || cnpjsConversa.has(m.cnpj)) && !contemSegredo(m.texto));
  const pontua = (m: MemoriaAprendida) => {
    let s = 0;
    for (const w of palavras(m.texto)) if (pc.has(w)) s += 1;
    if (m.cnpj) s += 3;
    if (m.tipo === 'correcao') s += 0.5;
    return s;
  };
  return candidatas
    .map((m) => ({ m, s: pontua(m) }))
    .sort((a, b) => b.s - a.s || b.m.atualizadaEm.localeCompare(a.m.atualizadaEm))
    .slice(0, max)
    .map((x) => x.m);
}

/** Bloco do prompt com as lições do usuário. */
export function blocoMemoriasParaPrompt(memorias: MemoriaAprendida[]): string {
  if (!memorias.length) return '';
  const linhas = memorias.map((m) => `- ${m.tipo === 'correcao' ? 'Correção' : m.tipo === 'feedback' ? 'Feedback' : 'Preferência'}${m.cnpj ? ` (CNPJ ${formatarCnpj14(m.cnpj)})` : ''}: ${m.texto.replace(/\s+/g, ' ').slice(0, 300)}`);
  return [
    'O que este usuário já ensinou (siga, desde que não conflite com as regras acima, segurança, RBAC, confirmação de gravações e Trava Fiscal):',
    ...linhas,
  ].join('\n');
}
