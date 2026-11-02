// ============================================================================
// STI-hub ERP - visibilidade do menu ERP > Configurações (e PDV oculto na UI)
// Entrada: GET /api/auth/session (calculado no servidor a partir do cookie
// assinado). Regra pela matriz do rbac.ts (padrão do perfil ERP + papel + usuário),
// espelhando o servidor:
//  - Itens que dependem de /api/admin/* (Usuários, Gerais, Empresa, E-mails...):
//    o servidor exige admin IAM com 2FA (canManageUsersRbac) em qualquer método,
//    e a matriz precisa liberar 'erp.configuracoes_empresa'.view.
//  - Certificado digital: mesma leitura de src/api/certificate-routes.ts
//    (admin com 2FA, ou 2FA + 'erp.fiscal_notas'/'erp.configuracoes_empresa' view,
//    ou fiscalIssuanceAccess VIEW/EDIT/FULL).
//  - Sincronização GestãoClick e regime/parâmetros fiscais (POST /api/erp/gestaoclick/sync,
//    PATCH /api/erp/gestaoclick/config, /api/erp/daily-sync): mesma regra do
//    gestaoClickPrivilege do router.ts = 2FA + (admin IAM ou controle TOTAL do ERP,
//    isModuleFullControl de rbac-seed.ts).
// É só interface: o servidor continua revalidando cada chamada.
// ============================================================================
import { buildDefaultErpItemPermissions, ERP_ROLES_CATALOG, type ErpAccountRole } from './rbac';
import { isModuleFullControl } from '../../modules/erp/rbac-seed';

type ItemPerms = Record<string, { view?: boolean } | undefined>;

export interface ErpConfigSessionLike {
  authenticated?: boolean;
  mfaVerified?: boolean;
  user?: {
    erpRole?: string;
    erpItemPermissions?: ItemPerms;
    enabledModules?: string[];
    erpPermissions?: Record<string, unknown> | null;
  } | null;
  role?: { erpRole?: string; erpItemPermissions?: ItemPerms } | null;
  effectiveActionGuards?: { canManageUsersRbac?: boolean } | null;
  enabledModules?: string[];
  erpPermissions?: ({ erpRole?: string; fiscalIssuanceAccess?: string } & Record<string, unknown>) | null;
}

export interface ErpConfigAccess {
  /** Admin IAM com 2FA (canManageUsersRbac + mfaVerified): única chave da Central de Administração. */
  isAdmin: boolean;
  /** Relatórios do ERP: 2FA + 'erp.relatorios_logs'.view na matriz (ou admin). Só os indicadores, sem administração. */
  canViewReports: boolean;
  canViewAdminConfig: boolean;
  canReadCertificate: boolean;
  /** Sincronizar GestãoClick e alterar regime/parâmetros fiscais: 2FA + (admin ou controle TOTAL do ERP). */
  canSyncGestaoClick: boolean;
}

export const NO_ERP_CONFIG_ACCESS: ErpConfigAccess = {
  isAdmin: false,
  canViewReports: false,
  canViewAdminConfig: false,
  canReadCertificate: false,
  canSyncGestaoClick: false,
};

/** Mensagem neutra para 401/403 das rotas GestãoClick (sync, config, daily-sync). null para outros status. */
export function gestaoClickDeniedMessage(status: number, action: 'sync' | 'config'): string | null {
  if (status !== 401 && status !== 403) return null;
  return action === 'sync'
    ? 'Sem permissão para sincronizar o GestãoClick. Esta ação exige 2FA e perfil administrador ou controle total do ERP.'
    : 'Sem permissão para alterar a configuração fiscal. Esta ação exige 2FA e perfil administrador ou controle total do ERP.';
}

/** Item 'Balcão (PDV)' oculto do menu por decisão do Marcéllo (02/11/2026). Rotas, lógica e dados do PDV seguem intactos. */
export const ERP_HIDDEN_MENU_SUB_ITEMS = ['VENDAS_BALCAO'] as const;

export function resolveErpConfigAccess(session: ErpConfigSessionLike | null | undefined): ErpConfigAccess {
  if (!session || session.authenticated !== true) return NO_ERP_CONFIG_ACCESS;
  const mfa = session.mfaVerified === true;
  const isAdmin = mfa && session.effectiveActionGuards?.canManageUsersRbac === true;
  const erpRoleRaw = String(session.user?.erpRole || session.erpPermissions?.erpRole || session.role?.erpRole || 'ERP_NONE');
  const erpRole = (erpRoleRaw in ERP_ROLES_CATALOG ? erpRoleRaw : 'ERP_NONE') as ErpAccountRole;
  const items: ItemPerms = {
    ...buildDefaultErpItemPermissions(erpRole),
    ...(session.role?.erpItemPermissions || {}),
    ...(session.user?.erpItemPermissions || {}),
  };
  const configView = items['erp.configuracoes_empresa']?.view === true;
  const fiscalView = items['erp.fiscal_notas']?.view === true;
  const fiscalLevel = String(session.erpPermissions?.fiscalIssuanceAccess || 'NONE');
  const actor = {
    enabledModules: session.user?.enabledModules ?? session.enabledModules ?? [],
    erpPermissions: session.user?.erpPermissions ?? session.erpPermissions ?? undefined,
  } as unknown as Parameters<typeof isModuleFullControl>[0];
  return {
    isAdmin,
    canViewReports: mfa && (isAdmin || items['erp.relatorios_logs']?.view === true),
    canViewAdminConfig: isAdmin && configView,
    canReadCertificate: mfa && (isAdmin || configView || fiscalView || ['VIEW', 'EDIT', 'FULL'].includes(fiscalLevel)),
    canSyncGestaoClick: mfa && (isAdmin || isModuleFullControl(actor, 'ERP')),
  };
}

/** Visibilidade de um item (ou de uma tela) de ERP > Configurações. Ids desconhecidos seguem a regra de admin. */
export function isErpConfigItemVisible(access: ErpConfigAccess | null | undefined, subId: string): boolean {
  if (!access) return false;
  if (subId === 'CFG_CERTIFICADO') return access.canReadCertificate;
  return access.canViewAdminConfig;
}

export interface MenuGroupLike<TSub extends { id: string }> {
  id: string;
  subItems?: TSub[];
}

/**
 * Árvore visível do menu ERP: remove o PDV (só interface) e, em Configurações,
 * cada item sem permissão; o grupo some quando não sobra nenhum item.
 * access null (sessão ainda carregando) => Configurações oculto.
 */
export function filterErpMenuTree<TSub extends { id: string }, TGroup extends MenuGroupLike<TSub>>(
  tree: TGroup[],
  access: ErpConfigAccess | null | undefined
): TGroup[] {
  const out: TGroup[] = [];
  for (const g of tree) {
    let subs = g.subItems?.filter((s) => !(ERP_HIDDEN_MENU_SUB_ITEMS as readonly string[]).includes(s.id));
    if (g.id === 'RELATORIOS' && !access?.canViewReports) continue;
    if (g.id === 'CONFIGURACOES') {
      subs = (subs || []).filter((s) => isErpConfigItemVisible(access, s.id));
      if (subs.length === 0) continue;
    }
    out.push(g.subItems ? { ...g, subItems: subs } : g);
  }
  return out;
}

/** Central de Administração (StiHubAdminRbacPanel): admin com 2FA; perfil com leitura do certificado só na tela dedicada dele. */
export function canOpenAdminCentral(
  access: ErpConfigAccess | null | undefined,
  opts: { singleView?: boolean; subView?: string } = {}
): boolean {
  if (!access) return false;
  if (access.isAdmin) return true;
  return opts.singleView === true && opts.subView === 'CERTIFICATE_A1' && access.canReadCertificate;
}

/** Primeiro item de Configurações que a pessoa pode abrir, ou null. */
export function firstVisibleErpConfigItem(access: ErpConfigAccess | null | undefined, subIds: string[]): string | null {
  return subIds.find((id) => isErpConfigItemVisible(access, id)) || null;
}
