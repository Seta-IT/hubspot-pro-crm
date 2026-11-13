// ============================================================================
// STI-hub — API v1 + MCP: carteira (portfolioScope) aplicada NO SERVIDOR em listagem,
// busca, GET e escrita. PROPRIOS = so o dono da credencial; EQUIPE = dono + membros da
// equipe gravados na credencial; TODOS = sem filtro de dono.
// Correspondencia de dono: ownerId, hubspotOwnerId ou ownerName/e-mail (sem caixa).
// ============================================================================
import type { Company, Contact, Deal, ServiceTicket, TimelineEvent } from '../../db/types';
import type { AuthContext } from './auth-context';
import type { IntegrationUser } from './data-port';

export interface PortfolioView {
  all: boolean;
  ids: Set<string>;
  hubspot: Set<string>;
  names: Set<string>;
  emails: Set<string>;
  users: IntegrationUser[];
}

const low = (v: unknown) => String(v ?? '').trim().toLowerCase();

export function buildPortfolioView(ctx: Pick<AuthContext, 'portfolioScope' | 'actorUserId' | 'teamMemberIds'>, users: IntegrationUser[]): PortfolioView {
  const allowedIds = new Set<string>([ctx.actorUserId]);
  if (ctx.portfolioScope === 'EQUIPE') for (const id of ctx.teamMemberIds) allowedIds.add(id);
  const inScope = users.filter((u) => allowedIds.has(u.id));
  return {
    all: ctx.portfolioScope === 'TODOS',
    ids: allowedIds,
    hubspot: new Set(inScope.map((u) => u.hubspotOwnerId).filter((x): x is string => !!x)),
    names: new Set(inScope.map((u) => low(u.name)).filter(Boolean)),
    emails: new Set(inScope.map((u) => low(u.email)).filter(Boolean)),
    users: inScope,
  };
}

function ownerMatches(v: PortfolioView, rec: { ownerId?: string | null; hubspotOwnerId?: string | null; ownerName?: string | null }): boolean {
  if (rec.ownerId && v.ids.has(String(rec.ownerId))) return true;
  if (rec.hubspotOwnerId && v.hubspot.has(String(rec.hubspotOwnerId))) return true;
  const n = low(rec.ownerName);
  return !!n && (v.names.has(n) || v.emails.has(n));
}

export const contactInScope = (v: PortfolioView, c: Contact) => v.all || ownerMatches(v, c);
export const companyInScope = (v: PortfolioView, c: Company) => v.all || ownerMatches(v, { hubspotOwnerId: c.hubspotOwnerId, ownerName: c.ownerName });
export const dealInScope = (v: PortfolioView, d: Deal) => v.all || ownerMatches(v, d);

export function activityInScope(
  v: PortfolioView,
  e: TimelineEvent,
  lookup: { contact: (id: string) => Contact | undefined; company: (id: string) => Company | undefined; deal: (id: string) => Deal | undefined }
): boolean {
  if (v.all) return true;
  const c = e.contactId ? lookup.contact(e.contactId) : undefined;
  if (c && contactInScope(v, c)) return true;
  const co = e.companyId ? lookup.company(e.companyId) : undefined;
  if (co && companyInScope(v, co)) return true;
  const d = e.dealId ? lookup.deal(e.dealId) : undefined;
  if (d && dealInScope(v, d)) return true;
  return false;
}

export function ticketInScope(
  v: PortfolioView,
  t: ServiceTicket,
  lookup: { contact: (id: string) => Contact | undefined; company: (id: string) => Company | undefined }
): boolean {
  if (v.all) return true;
  for (const who of [t.assigneeAgent, t.assignee]) {
    const n = low(who);
    if (n && (v.names.has(n) || v.emails.has(n))) return true;
  }
  const c = t.contactId ? lookup.contact(t.contactId) : undefined;
  if (c && contactInScope(v, c)) return true;
  const co = t.companyId ? lookup.company(t.companyId) : undefined;
  if (co && companyInScope(v, co)) return true;
  return false;
}

/** Dono permitido para escrita (atribuicao de responsavel) dentro da carteira. */
export function resolveAssignableOwner(
  v: PortfolioView,
  allUsers: IntegrationUser[],
  requestedId: string | undefined,
  defaultId: string
): IntegrationUser | null {
  const id = requestedId || defaultId;
  const u = allUsers.find((x) => x.id === id && x.active);
  if (!u) return null;
  if (!v.all && !v.ids.has(u.id)) return null;
  return u;
}
