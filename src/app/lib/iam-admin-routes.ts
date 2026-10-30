// ============================================================================
// STI-hub — Hotfix 29/10/2026: autorizacao IAM por COLECAO normalizada (nao por prefixo cru)
// Edge-safe (sem node:crypto): usado pelo middleware e pelo router.
//
// Toda rota que le ou escreve usuarios, papeis, IAM, seguranca ou contas de servico exige
// canManageUsersRbac no servidor, inclusive GET de listagem:
//   /api/admin/*, /api/rbac/*, /api/iam/* (qualquer caixa, barra final, //, %2F, \, ./..)
//   + /api/auth/send-invite (alias "publico" que emitia convite e devolvia o link)
// Self-service (/api/me/preferences, /api/auth/me) NAO esta aqui: continua so do proprio usuario.
// ============================================================================

/** Colecoes (2o segmento apos /api) administrativas de IAM. */
export const IAM_ADMIN_COLLECTIONS = ['admin', 'rbac', 'iam'] as const;

/** Rotas fora dessas colecoes que tambem escrevem usuarios/convites (aliases). */
export const IAM_ADMIN_ALIAS_PATHS = ['/api/auth/send-invite'] as const;

/** Perfis cujo papel padrao concede canManageUsersRbac (fallback do middleware p/ sessoes antigas). */
export const IAM_ADMIN_DEFAULT_ROLE_IDS = ['SUPER_ADMIN', 'DIRETORIA'] as const;

/**
 * Normaliza um caminho para decisao de autorizacao: remove query/hash, decodifica %xx
 * repetidamente (inclusive %2F), troca \ por /, colapsa //, resolve . e .., baixa a caixa
 * e remove a barra final.
 */
export function normalizeApiPathForAuthz(rawPath: string | null | undefined): string {
  let s = String(rawPath || '/');
  s = s.split('?')[0].split('#')[0];
  for (let i = 0; i < 5; i++) {
    let decoded = s;
    try {
      decoded = decodeURIComponent(s);
    } catch {
      decoded = s.replace(/%2f/gi, '/').replace(/%5c/gi, '\\').replace(/%2e/gi, '.');
    }
    if (decoded === s) break;
    s = decoded;
  }
  s = s.replace(/\\/g, '/').toLowerCase();
  const out: string[] = [];
  for (const rawSeg of s.split('/')) {
    const seg = rawSeg.trim();
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return `/${out.join('/')}`;
}

/** true => rota administrativa de IAM (exige canManageUsersRbac em QUALQUER metodo). */
export function isIamAdminRoute(rawPath: string | null | undefined): boolean {
  const n = normalizeApiPathForAuthz(rawPath);
  if ((IAM_ADMIN_ALIAS_PATHS as readonly string[]).includes(n)) return true;
  const segs = n.split('/').filter(Boolean);
  if (segs[0] !== 'api' || segs.length < 2) return false;
  // tambem pega "/api/admin" ou "/api/rbac" sozinhos e prefixos colados (ex.: /api/rbac.json)
  const head = segs[1].replace(/[^a-z].*$/, '');
  return (IAM_ADMIN_COLLECTIONS as readonly string[]).includes(segs[1]) ||
    (IAM_ADMIN_COLLECTIONS as readonly string[]).includes(head);
}

/**
 * Decisao do middleware (defesa em profundidade) a partir das claims ASSINADAS da sessao.
 * Sessao nova carrega canManageUsersRbac; sessao antiga (sem o campo) cai no papel padrao.
 * O router continua autoritativo (guardas efetivos com overrides).
 */
export function claimsMayManageIam(
  claims: { roleId?: string; canManageUsersRbac?: boolean } | null | undefined
): boolean {
  if (!claims) return false;
  if (typeof claims.canManageUsersRbac === 'boolean') return claims.canManageUsersRbac;
  return (IAM_ADMIN_DEFAULT_ROLE_IDS as readonly string[]).includes(String(claims.roleId || '').toUpperCase());
}

/** PATCH/GET /api/auth/me (Minha Conta): nunca publica, mesmo sob o prefixo /api/auth (qualquer caixa/%2F/barra). */
export const SELF_PROFILE_PATH = '/api/auth/me';
export function isSelfProfileRoute(rawPath: string | null | undefined): boolean {
  return normalizeApiPathForAuthz(rawPath) === SELF_PROFILE_PATH;
}
