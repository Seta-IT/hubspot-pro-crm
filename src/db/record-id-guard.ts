// ============================================================================
// STI-hub — Pacote J (01/11/2026): ids e codigos de registro unicos na criacao.
// A1 (v3-review): POST de proposta com o `id` de outra criava uma "sombra" que passava a
// responder pelo link e pelo aceite. Regra: criacao NUNCA sobrepoe nem duplica um registro
// existente. Colisao => RecordIdConflictError (HTTP 409 no router).
// ============================================================================

export type RecordConflictCode =
  | 'PROPOSAL_ID_CONFLICT'
  | 'PROPOSAL_CODE_CONFLICT'
  | 'CONTACT_ID_CONFLICT'
  | 'COMPANY_ID_CONFLICT'
  | 'DEAL_ID_CONFLICT'
  | 'TICKET_ID_CONFLICT'
  | 'CONTRACT_ID_CONFLICT'
  | 'CONTRACT_NUMBER_CONFLICT';

export class RecordIdConflictError extends Error {
  readonly status = 409;
  constructor(readonly code: RecordConflictCode, message: string) {
    super(message);
    this.name = 'RecordIdConflictError';
  }
}

export function isRecordIdConflictError(err: unknown): err is RecordIdConflictError {
  return err instanceof RecordIdConflictError || (
    typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'RecordIdConflictError' &&
    typeof (err as { code?: unknown }).code === 'string'
  );
}

/** Chave de comparacao: sem espacos nas pontas, caixa ignorada (a busca por id/codigo ignora caixa). */
export const refKey = (v: unknown): string => String(v ?? '').trim().toLowerCase();

/** Conjunto de referencias ocupadas (ids e codigos, sem caixa) de uma colecao. */
export function occupiedRefs<T>(items: readonly T[], pick: (it: T) => unknown[]): Set<string> {
  const out = new Set<string>();
  for (const it of items || []) {
    for (const v of pick(it)) {
      const k = refKey(v);
      if (k) out.add(k);
    }
  }
  return out;
}

/** Lanca 409 se o id informado pelo chamador ja existir na colecao (comparacao sem caixa). */
export function assertNewRecordId<T extends { id?: unknown }>(
  items: readonly T[] | undefined,
  id: unknown,
  code: RecordConflictCode,
  label: string
): void {
  const k = refKey(id);
  if (!k) return;
  if ((items || []).some((it) => refKey(it && it.id) === k)) {
    throw new RecordIdConflictError(code, `Já existe ${label} com este identificador. Crie sem informar "id" (o servidor gera um novo).`);
  }
}

/**
 * Proximo codigo sequencial livre no formato PREFIXO-<n> (preserva o formato historico
 * PROP-2026-00<n>): parte de `start` e avanca ate nao colidir com nenhum id/codigo ocupado.
 */
export function nextFreeCode(occupied: Set<string>, start: number, format: (n: number) => string): string {
  let n = Math.max(1, Math.floor(start));
  for (let guard = 0; guard < 100000; guard++, n++) {
    const c = format(n);
    if (!occupied.has(refKey(c))) return c;
  }
  return format(Date.now());
}

export const formatProposalCode = (n: number): string => `PROP-2026-00${n}`;
