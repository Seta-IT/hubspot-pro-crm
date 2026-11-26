import type { CrmRecordAuditFieldChange } from '../../db/types';

/** Campos internos/derivados que não entram no "antes/depois" da auditoria. */
const IGNORED_FIELDS = new Set(['updatedAt', 'createdAt', 'completenessScore', 'lastActivityAt']);

const norm = (v: unknown) => (v === undefined ? null : v);

/**
 * Compara dois snapshots de registro e devolve apenas os campos alterados (antes/depois).
 * Considera só as chaves presentes em "after" ou "before" (shallow, com comparação JSON).
 */
export function diffRecordFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined
): CrmRecordAuditFieldChange[] {
  const a = before || {};
  const b = after || {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changes: CrmRecordAuditFieldChange[] = [];
  for (const k of keys) {
    if (IGNORED_FIELDS.has(k)) continue;
    const va = norm(a[k]);
    const vb = norm(b[k]);
    if (JSON.stringify(va) !== JSON.stringify(vb)) changes.push({ field: k, before: va, after: vb });
  }
  return changes;
}

export const OWNER_FIELDS = ['ownerId', 'ownerName'];

export function isOwnerChange(changes: CrmRecordAuditFieldChange[]): boolean {
  return changes.some((c) => OWNER_FIELDS.includes(c.field));
}

export function contactLabel(c: { firstName?: string; lastName?: string; email?: string | null } | null | undefined): string {
  if (!c) return '';
  return `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email || '';
}
