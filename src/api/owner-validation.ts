// ============================================================================
// Pacote G (30/10/2026): ownerName = RESPONSAVEL atribuido a um registro (contato, empresa,
// negocio, campanha). E distinto do AUTOR de um evento (este vem sempre da sessao).
// Por isso nao e ignorado: quando o cliente envia um ownerName NOVO (diferente do atual do
// registro), ele precisa ser um responsavel conhecido:
//   - usuario do IAM (nome ou e-mail);
//   - lista oficial SETA_OWNER_OPTIONS (seletores do front);
//   - responsavel ja presente nos dados (legado HubSpot/GestaoClick), para nao quebrar registros
//     existentes nem reatribuicoes entre responsaveis reais.
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
 * Responsaveis ATIVOS conhecidos. Pacote H: usuario IAM inativo, opcao "(Inativo)" da lista
 * oficial e nomes legados que batem com usuario inativo NAO entram (nao podem ser atribuidos
 * de novo; o valor atual de um registro continua aceito sem mudanca).
 */
export function buildKnownOwnerSet(u: OwnerUniverse): Set<string> {
  const set = new Set<string>();
  const inactive = new Set<string>();
  for (const x of u.users || []) {
    if (x?.active === false) {
      if (x.name) inactive.add(normalizeOwnerName(x.name));
      if (x.email) inactive.add(normalizeOwnerName(x.email));
    }
  }
  const add = (n: string | null | undefined) => {
    if (!n || isInactiveLabel(n)) return;
    const k = normalizeOwnerName(n);
    if (k && !inactive.has(k)) set.add(k);
  };
  for (const n of SETA_OWNER_OPTIONS) add(n);
  for (const x of u.users || []) {
    if (x?.active === false) continue;
    add(x?.name);
    add(x?.email);
  }
  for (const n of u.existingOwnerNames || []) add(n);
  return set;
}

/** Valor nao vazio (ja limpo) igual ao atual ou conhecido e ativo => ok. */
export function isAssignableOwnerName(value: unknown, current: string | null | undefined, known: Set<string>): boolean {
  if (typeof value !== 'string') return false;
  const n = normalizeOwnerName(value);
  if (!n) return false;
  if (current && normalizeOwnerName(current) === n) return true;
  return known.has(n);
}
