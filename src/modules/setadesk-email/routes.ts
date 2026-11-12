// ============================================================================
// SetaDesk - Rotas da entrada de e-mail (chamadas pelo router; sem I/O de sessao aqui).
//   POST /api/tickets/email-intake/poll   ciclo manual (admin/coordenador) ou cron futuro
//   POST /api/tickets/:id/mark-viewed     primeira abertura pelo modal (Chamados)
// Ambas escrevem direto nas tabelas setadesk_* e NAO carregam a lista de chamados
// (isSetaDeskEmailDirectRoute), para nao gerar transferencia extra no Neon.
// ============================================================================

export const SETADESK_EMAIL_POLL_PATH = '/api/tickets/email-intake/poll';
const MARK_VIEWED_RE = /^\/api\/tickets\/([^/]+)\/mark-viewed$/;

export function matchMarkViewedPath(cleanPath: string): string | null {
  const m = String(cleanPath || '').match(MARK_VIEWED_RE);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

export function isSetaDeskEmailDirectRoute(method: string, path: string): boolean {
  const clean = (path || '/').replace(/\/+$/, '') || '/';
  if (method !== 'POST') return false;
  return clean === SETADESK_EMAIL_POLL_PATH || matchMarkViewedPath(clean) !== null;
}
