// ============================================================================
// Pacote G (30/10/2026): ownerName = RESPONSAVEL atribuido a um registro (contato, empresa,
// negocio, campanha). E distinto do AUTOR de um evento (este vem sempre da sessao).
// Por isso nao e ignorado: quando o cliente envia um ownerName NOVO (diferente do atual do
// registro), ele precisa ser um responsavel conhecido:
//   - usuario do IAM (nome ou e-mail);
//   - lista oficial SETA_OWNER_OPTIONS (seletores do front);
//   - (ate o Pacote H) responsavel ja presente nos dados; Pacote I: nao mais (ver abaixo).
// Valor igual ao atual passa (formularios reenviam o registro inteiro). Desconhecido => 400.
// Pacote H: string vazia => 400 (limpar = null explicito, so admin); usuario inativo => 400;
// o valor gravado e normalizado (trim + espacos colapsados).
// ============================================================================
import { SETA_OWNER_OPTIONS } from '../app/lib/owner-options';

export function normalizeOwnerName(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pacote H: forma gravada do responsavel (trim + espacos colapsados). */
export function cleanOwnerName(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

const isInactiveLabel = (n: string) => /\(inativ[oa]\)/i.test(n);

export interface OwnerUniverse {
  users: Array<{ name?: string; email?: string; active?: boolean }>;
  existingOwnerNames: Array<string | null | undefined>;
}

/**
 * Pacote I: responsaveis atribuiveis = usuarios ATIVOS do RBAC (nome ou e-mail) + a lista oficial
 * SETA_OWNER_OPTIONS (o que os seletores do front oferecem), sem "(Inativo)". Nomes que existem
 * SO nos dados (legado HubSpot/GestaoClick) NAO entram mais (o valor atual de um registro continua
 * aceito sem mudanca). Chave = forma normalizada (sem caixa/acentos/espacos extras); valor = nome
 * CANONICO a gravar (nome do usuario no RBAC; ou a opcao oficial).
 */
export function buildOwnerCanonicalMap(u: Pick<OwnerUniverse, 'users'>): Map<string, string> {
  const map = new Map<string, string>();
  const inactive = new Set<string>();
  for (const x of u.users || []) {
    if (x?.active === false) {
      if (x.name) inactive.add(normalizeOwnerName(x.name));
      if (x.email) inactive.add(normalizeOwnerName(x.email));
    }
  }
  for (const x of u.users || []) {
    if (!x || x.active === false || !x.name || isInactiveLabel(x.name)) continue;
    const canonical = cleanOwnerName(x.name);
    map.set(normalizeOwnerName(x.name), canonical);
    if (x.email) map.set(normalizeOwnerName(x.email), canonical);
  }
  for (const n of SETA_OWNER_OPTIONS) {
    if (isInactiveLabel(n)) continue;
    const k = normalizeOwnerName(n);
    if (k && !inactive.has(k) && !map.has(k)) map.set(k, n);
  }
  return map;
}

/** Compatibilidade: conjunto das chaves normalizadas atribuiveis (existingOwnerNames e ignorado). */
export function buildKnownOwnerSet(u: OwnerUniverse): Set<string> {
  return new Set(buildOwnerCanonicalMap(u).keys());
}

/** Valor nao vazio (ja limpo) igual ao atual ou conhecido e ativo => ok. */
export function isAssignableOwnerName(value: unknown, current: string | null | undefined, known: Set<string>): boolean {
  if (typeof value !== 'string') return false;
  const n = normalizeOwnerName(value);
  if (!n) return false;
  if (current && normalizeOwnerName(current) === n) return true;
  return known.has(n);
}

/**
 * Pacote I: nome a gravar. Igual ao atual (sem diferenciar caixa/acentos) => o atual, exatamente;
 * responsavel atribuivel => o nome canonico; senao null (400).
 */
export function resolveOwnerNameToStore(
  value: string,
  current: string | null | undefined,
  canonical: Map<string, string>
): string | null {
  const n = normalizeOwnerName(value);
  if (!n) return null;
  if (current && normalizeOwnerName(current) === n) return current;
  return canonical.get(n) ?? null;
}
