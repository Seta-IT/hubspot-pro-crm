// Identificacao dos 5 chamados de demonstracao do seed (JSM-101..105).
// Modulo sem dependencia de Postgres, para uso no servidor e no cliente.

/** Ids dos 5 chamados de demonstracao do seed (crm_kv_store). Nunca entram em setadesk_tickets. */
export const SETADESK_LEGACY_DEMO_TICKET_IDS = [
  'tkt-jsm-101',
  'tkt-jsm-102',
  'tkt-jsm-103',
  'tkt-jsm-104',
  'tkt-jsm-105',
] as const;

/** Chaves dos 5 chamados de demonstracao do seed. */
export const SETADESK_LEGACY_DEMO_TICKET_KEYS = [
  'JSM-101',
  'JSM-102',
  'JSM-103',
  'JSM-104',
  'JSM-105',
] as const;

/** Deterministico: so os 5 demos JSM-101..105 (id tkt-jsm-101..105 ou chave JSM-101..105). */
export function isLegacyDemoServiceTicket(t: { id?: string | null; key?: string | null }): boolean {
  const id = String(t.id || '').trim().toLowerCase();
  if ((SETADESK_LEGACY_DEMO_TICKET_IDS as readonly string[]).includes(id)) return true;
  const key = String(t.key || '').trim().toUpperCase();
  return (SETADESK_LEGACY_DEMO_TICKET_KEYS as readonly string[]).includes(key);
}
