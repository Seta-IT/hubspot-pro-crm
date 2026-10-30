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

export interface OwnerUniverse {
  users: Array<{ name?: string; email?: string }>;
  existingOwnerNames: Array<string | null | undefined>;
}

export function buildKnownOwnerSet(u: OwnerUniverse): Set<string> {
  const set = new Set<string>();
  for (const n of SETA_OWNER_OPTIONS) set.add(normalizeOwnerName(n));
  for (const x of u.users || []) {
    if (x?.name) set.add(normalizeOwnerName(x.name));
    if (x?.email) set.add(normalizeOwnerName(x.email));
  }
  for (const n of u.existingOwnerNames || []) if (n) set.add(normalizeOwnerName(n));
  set.delete('');
  return set;
}

/** ok=false => 400 OWNER_NOT_FOUND. Ausente/vazio ou igual ao atual => ok. */
export function isAssignableOwnerName(value: unknown, current: string | null | undefined, known: Set<string>): boolean {
  if (value === undefined || value === null) return true;
  const n = normalizeOwnerName(value);
  if (!n) return true;
  if (current && normalizeOwnerName(current) === n) return true;
  return known.has(n);
}
