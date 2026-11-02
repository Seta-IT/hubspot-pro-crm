/**
 * Numeracao de orcamentos/propostas no padrao GestaoClick: numero sequencial puro
 * (ex.: "4695", exibido como "#4695" / "Orcamento 4695"), sem prefixo PROP-AAAA-.
 *
 * - Importados do GestaoClick ("GC-ORC-4696") => "4696".
 * - Seeds antigos sem numero GC (PROP-2026-001..005) => continuam a sequencia real
 *   do GestaoClick a partir do maior numero importado (4698): 4699..4703.
 * - Demais codigos legados PROP-AAAA-NNN (criados no STI-hub) => proximo numero livre (max+1),
 *   na ordem de criacao.
 * O id de rota (/proposta/prop-seta-001) nunca muda; so o campo `code`.
 */

export const GESTAOCLICK_LAST_IMPORTED_PROPOSAL_NUMBER = 4698;

/** Mapa fixo dos seeds antigos (sem numero real no GestaoClick) para a sequencia GC. */
export const LEGACY_PROPOSAL_CODE_MAP: Readonly<Record<string, string>> = {
  'PROP-2026-001': '4699',
  'PROP-2026-002': '4700',
  'PROP-2026-003': '4701',
  'PROP-2026-004': '4702',
  'PROP-2026-005': '4703',
};

const LEGACY_PROP_RE = /^PROP-\d{4}-\d+$/i;

export function isLegacyProposalCode(code: unknown): boolean {
  return LEGACY_PROP_RE.test(String(code ?? '').trim());
}

/** Numero GC do codigo ("4695", "#4695", "GC-ORC-4695", "Orçamento 4695"); null se nao for numero GC. */
export function extractGcProposalNumber(code: unknown): number | null {
  const raw = String(code ?? '').trim();
  if (!raw) return null;
  const mapped = LEGACY_PROPOSAL_CODE_MAP[raw.toUpperCase()];
  if (mapped) return Number(mapped);
  const m = raw.match(/^(?:GC-ORC-|#|or[cç]amento\s*#?\s*)?(\d{1,9})$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Codigo exibido: numero GC quando houver; senao o codigo original. */
export function formatProposalDisplayCode(code: unknown): string {
  const n = extractGcProposalNumber(code);
  return n !== null ? String(n) : String(code ?? '').trim();
}

/** Proximo numero sequencial GC (max+1), nunca abaixo da sequencia importada. */
export function nextGcProposalNumber(codes: Array<unknown>): number {
  let max = GESTAOCLICK_LAST_IMPORTED_PROPOSAL_NUMBER;
  for (const c of codes || []) {
    const n = extractGcProposalNumber(c);
    if (n !== null && n > max && n < 1_000_000) max = n;
  }
  return max + 1;
}

type CodedProposal = { id?: string; code?: string; createdAt?: string };

/**
 * Migracao no load: converte GC-ORC-N / PROP-2026-00N (mapa) para o numero GC e atribui
 * max+1 aos demais PROP-AAAA-NNN. Nao cria colisao: se o numero ja for de outra proposta,
 * mantem o codigo atual (a exibicao continua mostrando o numero). Retorna id -> [antigo, novo].
 */
export function migrateLegacyProposalCodes<T extends CodedProposal>(proposals: T[]): Map<string, [string, string]> {
  const changes = new Map<string, [string, string]>();
  const list = (proposals || []).filter(Boolean);
  const taken = new Map<string, string>(); // codigo -> id
  for (const p of list) {
    const c = String(p.code || '').trim();
    if (c && !isLegacyProposalCode(c) && !/^GC-ORC-/i.test(c)) taken.set(c, String(p.id || ''));
  }
  const setCode = (p: T, next: string) => {
    const prev = String(p.code || '');
    if (prev === next) return;
    p.code = next;
    taken.set(next, String(p.id || ''));
    changes.set(String(p.id || ''), [prev, next]);
  };
  // 1) conversoes diretas (GC-ORC-N e mapa fixo dos seeds)
  for (const p of list) {
    const c = String(p.code || '').trim();
    const direct = /^GC-ORC-\d+$/i.test(c) || Boolean(LEGACY_PROPOSAL_CODE_MAP[c.toUpperCase()]);
    if (!direct) continue;
    const n = String(extractGcProposalNumber(c));
    const owner = taken.get(n);
    if (owner === undefined || owner === String(p.id || '')) setCode(p, n);
    // GC-ORC-N repetido = o mesmo orcamento real do GestaoClick (mantem; exibe o numero).
    // PROP-AAAA-NNN cujo numero do mapa ja e de outra proposta => segue para max+1 (passo 2).
  }
  // 2) demais PROP-AAAA-NNN: proximo numero livre, na ordem de criacao
  const pending = list
    .filter((p) => isLegacyProposalCode(p.code))
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.code).localeCompare(String(b.code)));
  for (const p of pending) {
    let n = nextGcProposalNumber([...taken.keys()]);
    while (taken.has(String(n))) n++;
    setCode(p, String(n));
  }
  return changes;
}

/** Codigos exibidos por id sem alterar a lista (mesma regra da migracao do servidor). */
export function buildProposalDisplayCodeMap(proposals: CodedProposal[]): Map<string, string> {
  const clone = (proposals || []).filter(Boolean).map((p) => ({ id: p.id, code: p.code, createdAt: p.createdAt }));
  migrateLegacyProposalCodes(clone);
  return new Map(clone.map((p) => [String(p.id || ''), formatProposalDisplayCode(p.code)]));
}
