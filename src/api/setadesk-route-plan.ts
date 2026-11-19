// ============================================================================
// SetaDesk E1 (18/11/2026): quais chamados cada rota carrega das tabelas setadesk_*.
// ----------------------------------------------------------------------------
// O crm_state_v1 nao guarda mais serviceTickets. Toda rota que le ou grava chamado
// precisa carregar das tabelas setadesk_* (fonte de verdade), no menor recorte possivel:
//   - /api/tickets*: todos (comportamento anterior), com baseline e sync;
//   - portal publico: so o chamado da chave informada (1 linha), nunca a lista;
//   - rotas que so criam (portal, formulario, importacao HubSpot): nenhum chamado, com sync;
//   - e-mail do CRM vinculado a chamado: so aquele chamado, com sync;
//   - DELETE de cadastro (checagem de uso): todos sem historico, somente leitura.
// O bootstrap continua com a regra propria (permissao de Chamados, sem comentarios).
// ============================================================================

export type SetaDeskRouteLoadPlan = {
  /** undefined => todos; [] => nenhum; lista => so estes id/key/legacy_key. */
  refs?: string[];
  includeComments: boolean;
  /** true => guarda baseline e grava as mudancas nas setadesk_* depois da rota. */
  sync: boolean;
};

const PORTAL_ACTION_RE = /^\/api\/portal\/tickets\/([^/]+)\/(reply|csat)$/;

function cleanRef(v: unknown): string | null {
  const s = String(v ?? '').trim().slice(0, 64);
  return s ? s : null;
}

/**
 * Plano de carga para rotas FORA de /api/tickets* e do bootstrap. Devolve null quando a rota
 * nao precisa de chamados (a lista em memoria fica vazia).
 */
export function setaDeskLoadPlanForRoute(
  method: string,
  cleanPath: string,
  query: Record<string, string | undefined>,
  body: Record<string, unknown> | null | undefined
): SetaDeskRouteLoadPlan | null {
  const m = String(method || '').toUpperCase();
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;

  if (cleanPath === '/api/portal/tickets') {
    if (m === 'GET') {
      const ref = cleanRef(query.key || query.ticket);
      return { refs: ref ? [ref] : [], includeComments: true, sync: false };
    }
    if (m === 'POST') return { refs: [], includeComments: false, sync: true };
    return null;
  }
  const portalAction = cleanPath.match(PORTAL_ACTION_RE);
  if (portalAction && m === 'POST') {
    let ref: string | null = null;
    try {
      ref = cleanRef(decodeURIComponent(portalAction[1]));
    } catch {
      ref = null;
    }
    return { refs: ref ? [ref] : [], includeComments: true, sync: true };
  }
  if (m === 'POST' && (cleanPath === '/api/forms/submit' || cleanPath === '/api/migration/hubspot')) {
    return { refs: [], includeComments: false, sync: true };
  }
  if (m === 'POST' && cleanPath === '/api/communications/send-email') {
    const ref = cleanRef(b.ticketId);
    return ref ? { refs: [ref], includeComments: true, sync: true } : null;
  }
  // Checagem "registro em uso" (empresa, contato, negocio, contrato...): le, nao grava chamados.
  if (m === 'DELETE' && cleanPath.startsWith('/api/') && !cleanPath.startsWith('/api/tickets')) {
    return { includeComments: false, sync: false };
  }
  return null;
}

// ----------------------------------------------------------------------------
// Paginacao das listas de chamados (GET /api/tickets).
// ----------------------------------------------------------------------------
export const TICKETS_PAGE_DEFAULT_LIMIT = 100;
export const TICKETS_PAGE_MAX_LIMIT = 500;

export type TicketsPageParams = { limit: number; offset: number };

export function encodeTicketsCursor(offset: number): string {
  return Buffer.from(`o:${Math.max(0, Math.floor(offset))}`, 'utf8').toString('base64url');
}

export function decodeTicketsCursor(cursor: unknown): number | null {
  if (typeof cursor !== 'string' || !cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const m = raw.match(/^o:(\d{1,9})$/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/** limit (1..500, padrao 100) e offset (ou cursor opaco devolvido em nextCursor). */
export function parseTicketsPageParams(query: Record<string, string | undefined>): TicketsPageParams {
  const rawLimit = Number(query.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit >= 1
    ? Math.min(Math.floor(rawLimit), TICKETS_PAGE_MAX_LIMIT)
    : TICKETS_PAGE_DEFAULT_LIMIT;
  const fromCursor = decodeTicketsCursor(query.cursor);
  const rawOffset = Number(query.offset);
  const offset = fromCursor !== null
    ? fromCursor
    : Number.isFinite(rawOffset) && rawOffset > 0
      ? Math.floor(rawOffset)
      : 0;
  return { limit, offset };
}

export function paginateTickets<T>(list: T[], params: TicketsPageParams): {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
  nextCursor: string | null;
} {
  const total = list.length;
  const data = list.slice(params.offset, params.offset + params.limit);
  const end = params.offset + data.length;
  const hasMore = end < total;
  return {
    data,
    total,
    limit: params.limit,
    offset: params.offset,
    hasMore,
    nextOffset: hasMore ? end : null,
    nextCursor: hasMore ? encodeTicketsCursor(end) : null,
  };
}
