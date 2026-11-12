// ============================================================================
// Plano de limpeza de chamados SetaDesk.
// Nunca apaga setadesk_email_messages, setadesk_email_outbox nem
// setadesk_integration_outbox. Chamados com linha vinculada nessas tabelas
// sao pulados e relatados.
// ============================================================================

export const SETADESK_PURGE_PROTECTED_TABLES = [
  'setadesk_email_messages',
  'setadesk_email_outbox',
  'setadesk_integration_outbox',
] as const;

export const SETADESK_PURGE_PROTECTED_TICKET_IDS_SQL = `
SELECT DISTINCT ticket_id AS id
FROM (
  SELECT ticket_id FROM setadesk_email_messages WHERE ticket_id IS NOT NULL
  UNION
  SELECT ticket_id FROM setadesk_email_outbox WHERE ticket_id IS NOT NULL
  UNION
  SELECT ticket_id FROM setadesk_integration_outbox WHERE ticket_id IS NOT NULL
) s
`.trim();

export const SETADESK_PURGE_LOCK_PROTECTED_SQL =
  'LOCK TABLE setadesk_email_messages, setadesk_email_outbox, setadesk_integration_outbox IN SHARE MODE';

export const SETADESK_PURGE_DELETE_TICKETS_SQL =
  'DELETE FROM setadesk_tickets WHERE id = ANY($1::text[])';

export const SETADESK_PURGE_DELETE_TOMBSTONES_SQL =
  'DELETE FROM setadesk_ticket_tombstones WHERE ticket_id = ANY($1::text[]) OR ticket_key = ANY($2::text[])';

/** SQL de exclusao efetivamente usado pelo purge. Nao inclui as tabelas protegidas. */
export const SETADESK_PURGE_DELETE_STATEMENTS = [
  SETADESK_PURGE_DELETE_TICKETS_SQL,
  SETADESK_PURGE_DELETE_TOMBSTONES_SQL,
] as const;

export interface SetaDeskPurgeTicketRef {
  id: string;
  key?: string;
}

export interface SetaDeskPurgePlan {
  purgeIds: string[];
  purgeKeys: string[];
  skipped: Array<{ id: string; key: string }>;
  skippedReason: string;
}

export const SETADESK_PURGE_SKIP_REASON =
  'Chamados com e-mail, outbox de e-mail ou outbox de integracao vinculados foram pulados. As tabelas setadesk_email_messages, setadesk_email_outbox e setadesk_integration_outbox nao sao apagadas.';

export function planSetaDeskTicketPurge(input: {
  tickets: SetaDeskPurgeTicketRef[];
  protectedTicketIds: string[];
}): SetaDeskPurgePlan {
  const protectedIds = new Set((input.protectedTicketIds || []).filter(Boolean));
  const purgeIds: string[] = [];
  const purgeKeys: string[] = [];
  const skipped: Array<{ id: string; key: string }> = [];
  for (const t of input.tickets || []) {
    if (!t?.id) continue;
    if (protectedIds.has(t.id)) {
      skipped.push({ id: t.id, key: t.key || t.id });
      continue;
    }
    purgeIds.push(t.id);
    if (t.key) purgeKeys.push(t.key);
  }
  return {
    purgeIds,
    purgeKeys,
    skipped,
    skippedReason: skipped.length ? SETADESK_PURGE_SKIP_REASON : '',
  };
}

export function setaDeskPurgeSqlTouchesProtectedTables(sql: string): boolean {
  const text = String(sql || '');
  return SETADESK_PURGE_PROTECTED_TABLES.some((table) =>
    new RegExp(`DELETE\\s+FROM\\s+${table}\\b`, 'i').test(text)
  );
}
