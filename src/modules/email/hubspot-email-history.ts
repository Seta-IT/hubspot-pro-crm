// ============================================================================
// STI-hub — Encaixe da importacao do historico de e-mails do HubSpot (04/11/2026).
// PREPARADO, NAO LIGADO: nenhuma rota chama este modulo ainda. Entra como etapa da
// importacao dos 100% (POST /api/migration/hubspot) quando o conector tiver leitura.
// Fonte: HubSpot CRM v3, objeto "emails" (engajamentos de e-mail), paginado por `after`,
// com associacoes a contatos, empresas e negocios. Escopos necessarios no app do HubSpot:
// HUBSPOT_EMAIL_IMPORT_SCOPES abaixo. Idempotente: source = HUBSPOT, externalId = hubspot:<id>.
// A lista "Nunca registrar" vale tambem para o historico importado.
// ============================================================================
import type { CrmEmailMessage, MailboxStore } from './mailbox-store';
import { newMailboxId } from './mailbox-store';
import { shouldLogEmail } from './never-log';

export const HUBSPOT_EMAIL_IMPORT_SCOPES = Object.freeze([
  'crm.objects.contacts.read',
  'crm.objects.companies.read',
  'crm.objects.deals.read',
  'sales-email-read',
]);

export const HUBSPOT_EMAIL_PROPERTIES = Object.freeze([
  'hs_timestamp',
  'hs_email_direction',
  'hs_email_subject',
  'hs_email_text',
  'hs_email_from_email',
  'hs_email_from_firstname',
  'hs_email_from_lastname',
  'hs_email_to_email',
  'hs_email_cc_email',
  'hs_email_thread_id',
  'hs_email_message_id',
  'hs_email_open_count',
  'hs_email_click_count',
]);

export interface HubSpotEmailObject {
  id: string;
  properties?: Record<string, string | null | undefined>;
  associations?: Record<string, { results?: Array<{ id: string }> }>;
}

export interface HubSpotEmailPage {
  results: HubSpotEmailObject[];
  nextAfter: string | null;
}

/** Converte ids do HubSpot nos ids do STI-hub (contatos/empresas/negocios ja importados). */
export interface HubSpotIdResolver {
  contact(hubspotId: string): string | null;
  company(hubspotId: string): string | null;
  deal(hubspotId: string): string | null;
}

const splitAddrs = (v: unknown) =>
  String(v || '')
    .split(/[;,\s]+/)
    .map((x) => x.trim().toLowerCase())
    .filter((x) => x.includes('@'));

const firstAssoc = (o: HubSpotEmailObject, key: string): string | null => o.associations?.[key]?.results?.[0]?.id || null;

export function mapHubSpotEmail(o: HubSpotEmailObject, ids: HubSpotIdResolver): CrmEmailMessage | null {
  const p = o.properties || {};
  if (!o.id) return null;
  const dir = String(p.hs_email_direction || '').toUpperCase();
  const at = p.hs_timestamp ? new Date(String(p.hs_timestamp)) : null;
  if (!at || Number.isNaN(at.getTime())) return null;
  const hsContact = firstAssoc(o, 'contacts');
  const hsCompany = firstAssoc(o, 'companies');
  const hsDeal = firstAssoc(o, 'deals');
  return {
    id: newMailboxId('eml'),
    accountId: null,
    ownerEmail: null,
    externalId: `hubspot:${o.id}`,
    conversationId: p.hs_email_thread_id ? `hubspot:${p.hs_email_thread_id}` : null,
    internetMessageId: p.hs_email_message_id ? String(p.hs_email_message_id) : null,
    direction: dir === 'INCOMING_EMAIL' ? 'RECEBIDO' : 'ENVIADO',
    source: 'HUBSPOT',
    fromAddress: String(p.hs_email_from_email || '').toLowerCase(),
    fromName: [p.hs_email_from_firstname, p.hs_email_from_lastname].filter(Boolean).join(' ').slice(0, 120),
    to: splitAddrs(p.hs_email_to_email),
    cc: splitAddrs(p.hs_email_cc_email),
    subject: String(p.hs_email_subject || '').slice(0, 500),
    bodyPreview: String(p.hs_email_text || '').replace(/\s+/g, ' ').trim().slice(0, 500),
    occurredAt: at.toISOString(),
    contactId: hsContact ? ids.contact(hsContact) : null,
    companyId: hsCompany ? ids.company(hsCompany) : null,
    dealId: hsDeal ? ids.deal(hsDeal) : null,
    trackingId: null,
    links: [],
    openCount: Math.max(0, Number(p.hs_email_open_count) || 0),
    clickCount: Math.max(0, Number(p.hs_email_click_count) || 0),
    lastOpenedAt: null,
    lastClickedAt: null,
    createdAt: new Date().toISOString(),
  };
}

export interface HubSpotEmailImportResult {
  pages: number;
  read: number;
  imported: number;
  duplicates: number;
  skippedNeverLog: number;
  skippedUnlinked: number;
  invalid: number;
}

/**
 * Importa o historico. `fetchPage(after)` busca uma pagina do HubSpot (quem chama decide o token).
 * dryRun => so conta, nao grava.
 */
export async function importHubSpotEmailHistory(opts: {
  store: MailboxStore;
  fetchPage: (after: string | null) => Promise<HubSpotEmailPage>;
  ids: HubSpotIdResolver;
  maxPages?: number;
  dryRun?: boolean;
}): Promise<HubSpotEmailImportResult> {
  const res: HubSpotEmailImportResult = { pages: 0, read: 0, imported: 0, duplicates: 0, skippedNeverLog: 0, skippedUnlinked: 0, invalid: 0 };
  const patterns = (await opts.store.listNeverLog()).map((e) => e.pattern);
  let after: string | null = null;
  const maxPages = opts.maxPages ?? 10_000;
  do {
    const page = await opts.fetchPage(after);
    res.pages++;
    for (const o of page.results || []) {
      res.read++;
      const m = mapHubSpotEmail(o, opts.ids);
      if (!m) {
        res.invalid++;
        continue;
      }
      if (!shouldLogEmail([m.fromAddress, ...m.to, ...m.cc], patterns)) {
        res.skippedNeverLog++;
        continue;
      }
      if (!m.contactId && !m.companyId && !m.dealId) {
        res.skippedUnlinked++;
        continue;
      }
      if (opts.dryRun) {
        res.imported++;
        continue;
      }
      if (await opts.store.insertMessage(m)) res.imported++;
      else res.duplicates++;
    }
    after = page.nextAfter;
  } while (after && res.pages < maxPages);
  return res;
}
