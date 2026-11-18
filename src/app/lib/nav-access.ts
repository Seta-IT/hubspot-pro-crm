/** Resolução do acesso de navegação a partir da sessão e do usuário RBAC. */

export type NavModuleAccess = { crm: boolean; erp: boolean; chamados: boolean };

export const NO_MODULE_ACCESS: NavModuleAccess = { crm: false, erp: false, chamados: false };

export type NavAccessSource = {
  moduleAccess?: Partial<NavModuleAccess> | null;
  enabledModules?: string[] | null;
} | null | undefined;

export type NavSessionHint = {
  authenticated?: boolean;
  moduleAccess?: Partial<NavModuleAccess> | null;
  enabledModules?: string[] | null;
  user?: (NavAccessSource & { id?: string; email?: string | null }) | null;
} | null;

export function moduleAccessFromRecord(src: NavAccessSource): NavModuleAccess | null {
  if (!src) return null;
  if (src.moduleAccess && typeof src.moduleAccess === 'object') {
    return {
      crm: src.moduleAccess.crm === true,
      erp: src.moduleAccess.erp === true,
      chamados: src.moduleAccess.chamados === true,
    };
  }
  if (Array.isArray(src.enabledModules) && src.enabledModules.length > 0) {
    const mods = src.enabledModules.map((m) => String(m).toUpperCase());
    return {
      crm: mods.includes('CRM'),
      erp: mods.includes('ERP'),
      chamados: mods.includes('CHAMADOS'),
    };
  }
  return null;
}

/**
 * Acesso do menu: usuário RBAC, depois sessão autenticada.
 * Sem sessão resolvida, pending=true (esqueleto, nenhum item clicável).
 * Sessão ausente ou anônima => todos os módulos false (fail-closed).
 */
export function resolveNavModuleAccess(input: {
  user?: NavAccessSource;
  session?: NavSessionHint;
  sessionResolved: boolean;
}): { access: NavModuleAccess; pending: boolean } {
  const fromUser = moduleAccessFromRecord(input.user);
  if (fromUser) return { access: fromUser, pending: false };
  if (input.session?.authenticated === true) {
    const fromSession = moduleAccessFromRecord(input.session.user) || moduleAccessFromRecord(input.session);
    if (fromSession) return { access: fromSession, pending: false };
  }
  if (!input.sessionResolved) return { access: NO_MODULE_ACCESS, pending: true };
  return { access: NO_MODULE_ACCESS, pending: false };
}

function sameId(a?: string | null, b?: string | null): boolean {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  if (!left || !right) return false;
  return left === right || left.toLowerCase() === right.toLowerCase();
}

function sameEmail(a?: string | null, b?: string | null): boolean {
  const left = String(a || '').trim().toLowerCase();
  const right = String(b || '').trim().toLowerCase();
  return Boolean(left && right && left === right);
}

/**
 * Escolhe o usuário ativo da sessão (id ou e-mail). Se a lista RBAC vier
 * vazia ou sem o registro, usa o próprio usuário da sessão autenticada.
 * Nunca cai no primeiro da lista.
 */
export function resolveActiveRbacUser<T extends { id: string; email?: string | null }>(input: {
  users?: T[] | null;
  sessionUserId?: string | null;
  sessionEmail?: string | null;
  sessionUser?: T | null;
  prev?: T | null;
  savedUserId?: string | null;
}): T | null {
  const users = Array.isArray(input.users) ? input.users : [];
  const find = (id?: string | null, email?: string | null): T | null => {
    if (id) {
      const hit = users.find((u) => sameId(u.id, id));
      if (hit) return hit;
    }
    if (email) {
      const hit = users.find((u) => sameEmail(u.email, email));
      if (hit) return hit;
    }
    return null;
  };

  const fromSession = find(input.sessionUserId, input.sessionEmail);
  if (fromSession) return fromSession;
  if (input.sessionUser && (input.sessionUserId || input.sessionEmail || input.sessionUser.id)) {
    return input.sessionUser;
  }
  if (input.prev) return find(input.prev.id, input.prev.email) || input.prev;
  if (input.savedUserId) return find(input.savedUserId, null);
  return null;
}

export function readSavedSessionUserId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = JSON.parse(window.localStorage.getItem('stihub_active_session_v1') || 'null');
    const id = saved?.user?.id;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}
